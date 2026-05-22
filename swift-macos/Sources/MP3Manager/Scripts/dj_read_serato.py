#!/usr/bin/env python3
"""Lê dados DJ do Serato armazenados nas tags ID3 do MP3 e retorna JSON."""
import sys
import json
import struct
import base64

def decode_markers2(data):
    """Decodifica o GEOB:Serato Markers2 e extrai cue points e loops."""
    cues  = []
    loops = []
    color = ""

    try:
        # Versão: primeiros 2 bytes (01 01)
        if len(data) < 2:
            return cues, loops, color

        # O conteúdo após o header é base64 com possíveis newlines
        b64_raw = data[2:]
        # Adicionar padding se necessário
        padding = (4 - len(b64_raw) % 4) % 4
        b64_padded = b64_raw + (b"=" * padding)
        decoded = base64.b64decode(b64_padded, validate=False)

        i = 0
        while i < len(decoded) - 5:
            entry_type = decoded[i]
            if i + 5 > len(decoded):
                break

            entry_size = struct.unpack(">I", decoded[i+1:i+5])[0]
            i += 5

            if i + entry_size > len(decoded):
                break

            entry_data = decoded[i:i + entry_size]
            i += entry_size

            if entry_type == 0x00:  # COLOR
                if len(entry_data) >= 4:
                    r, g, b = entry_data[1], entry_data[2], entry_data[3]
                    color = f"#{r:02X}{g:02X}{b:02X}"

            elif entry_type == 0x01:  # CUE ou LOOP
                if len(entry_data) < 13:
                    continue
                idx    = entry_data[0]
                pos_ms = struct.unpack(">I", entry_data[1:5])[0]
                r, g, b = entry_data[7], entry_data[8], entry_data[9]
                cue_color = f"#{r:02X}{g:02X}{b:02X}"

                # Nome (null-terminated string após os bytes fixos)
                name = ""
                if len(entry_data) > 13:
                    name_bytes = entry_data[13:]
                    null_pos = name_bytes.find(b"\x00")
                    if null_pos >= 0:
                        name = name_bytes[:null_pos].decode("utf-8", errors="replace")
                    else:
                        name = name_bytes.decode("utf-8", errors="replace")

                cues.append({
                    "index":       idx,
                    "position_ms": pos_ms,
                    "name":        name.strip(),
                    "color":       cue_color
                })

            elif entry_type == 0x02:  # LOOP
                if len(entry_data) < 17:
                    continue
                idx    = entry_data[0]
                in_ms  = struct.unpack(">I", entry_data[1:5])[0]
                out_ms = struct.unpack(">I", entry_data[5:9])[0]
                name   = ""
                if len(entry_data) > 17:
                    name_bytes = entry_data[17:]
                    null_pos = name_bytes.find(b"\x00")
                    name = name_bytes[:null_pos].decode("utf-8", errors="replace") if null_pos >= 0 else ""

                loops.append({
                    "index":  idx,
                    "in_ms":  in_ms,
                    "out_ms": out_ms,
                    "name":   name.strip()
                })

    except Exception:
        pass

    return cues, loops, color

def decode_autotags(data):
    """Decodifica GEOB:Serato Autotags: BPM e pitch."""
    try:
        parts = data.split(b"\x00")
        values = [p.decode("latin1", errors="ignore").strip() for p in parts if p]
        bpm   = values[0] if len(values) > 0 else ""
        pitch = values[1] if len(values) > 1 else ""
        # Remover prefixo de versão (ex: "\x01\x01122.96" → "122.96")
        bpm = "".join(c for c in bpm if c.isdigit() or c == ".")
        return bpm, pitch
    except Exception:
        return "", ""

def read_serato(filepath):
    try:
        from mutagen.id3 import ID3
        from mutagen.id3 import ID3NoHeaderError
    except ImportError:
        return {"error": "mutagen não instalado"}

    try:
        tags = ID3(filepath)
    except ID3NoHeaderError:
        return {"found": False, "source": "serato", "reason": "sem tags ID3"}
    except Exception as e:
        return {"error": str(e)}

    has_serato = any(k.startswith("GEOB:Serato") for k in tags.keys())
    if not has_serato:
        return {"found": False, "source": "serato", "reason": "sem dados Serato"}

    # BPM e key via Autotags
    bpm   = ""
    pitch = ""
    if "GEOB:Serato Autotags" in tags:
        bpm, pitch = decode_autotags(tags["GEOB:Serato Autotags"].data)

    # Key via tag padrão
    key = str(tags.get("TKEY", ""))

    # Play count
    play_count = 0
    if "TXXX:SERATO_PLAYCOUNT" in tags:
        try:
            play_count = int(str(tags["TXXX:SERATO_PLAYCOUNT"]))
        except Exception:
            pass

    # Cue points via Markers2
    cues  = []
    loops = []
    color = ""
    if "GEOB:Serato Markers2" in tags:
        cues, loops, color = decode_markers2(tags["GEOB:Serato Markers2"].data)

    return {
        "found":      True,
        "source":     "serato",
        "bpm":        bpm,
        "key":        key,
        "pitch":      pitch,
        "color":      color,
        "play_count": play_count,
        "cues":       cues[:8],
        "loops":      loops[:4],
        "has_beatgrid": "GEOB:Serato BeatGrid" in tags,
        "has_overview": "GEOB:Serato Overview" in tags,
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Uso: dj_read_serato.py <filepath>"}))
        sys.exit(1)

    result = read_serato(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
