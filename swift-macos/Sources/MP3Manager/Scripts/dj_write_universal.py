#!/usr/bin/env python3
"""
Grava dados DJ (cue points, BPM, key, etc.) nas tags ID3 do MP3
em formato universal (TXXX) + compatível com Serato (GEOB).
"""
import sys
import json
import struct
import base64

def write_dj_tags(filepath, dj_data):
    try:
        from mutagen.id3 import (
            ID3, TBPM, TKEY, TXXX, POPM,
            GEOB, ID3NoHeaderError
        )
    except ImportError:
        return {"error": "mutagen não instalado"}

    try:
        tags = ID3(filepath)
    except ID3NoHeaderError:
        tags = ID3()

    changed_fields = []

    # BPM
    bpm = str(dj_data.get("bpm", "")).strip()
    if bpm:
        tags["TBPM"] = TBPM(encoding=3, text=bpm)
        changed_fields.append("BPM")

    # Key
    key = str(dj_data.get("key", "")).strip()
    if key:
        tags["TKEY"] = TKEY(encoding=3, text=key)
        changed_fields.append("Key")

    # Rating (POPM frame)
    rating = dj_data.get("rating", None)
    if rating is not None and isinstance(rating, int):
        # POPM: 0–255, mapear 0-5 estrelas → 0,51,102,153,204,255
        popm_val = min(255, rating * 51)
        tags["POPM:MP3 Manager"] = POPM(email="MP3 Manager", rating=popm_val, count=0)
        changed_fields.append("Rating")

    # Cor da faixa
    color = str(dj_data.get("color", "")).strip()
    if color:
        tags["TXXX:DJ_TRACK_COLOR"] = TXXX(encoding=3, desc="DJ_TRACK_COLOR", text=color)
        changed_fields.append("Color")

    # Energy (se presente)
    energy = dj_data.get("energy", None)
    if energy is not None:
        tags["TXXX:DJ_ENERGY"] = TXXX(encoding=3, desc="DJ_ENERGY", text=str(energy))
        changed_fields.append("Energy")

    # Cue points → TXXX frames universais
    cues = dj_data.get("cues", [])
    # Limpar cues anteriores
    for i in range(8):
        for f in ["DJ_CUE_%d_POS", "DJ_CUE_%d_NAME", "DJ_CUE_%d_COLOR"]:
            key_to_del = f"TXXX:{f % i}"
            if key_to_del in tags:
                del tags[key_to_del]

    for idx, cue in enumerate(cues[:8]):
        pos = cue.get("position_ms", "")
        name = str(cue.get("name", "")).strip()
        cue_color = str(cue.get("color", "")).strip()

        if pos != "" and pos is not None:
            tags[f"TXXX:DJ_CUE_{idx}_POS"]   = TXXX(encoding=3, desc=f"DJ_CUE_{idx}_POS",   text=str(pos))
            tags[f"TXXX:DJ_CUE_{idx}_NAME"]  = TXXX(encoding=3, desc=f"DJ_CUE_{idx}_NAME",  text=name)
            tags[f"TXXX:DJ_CUE_{idx}_COLOR"] = TXXX(encoding=3, desc=f"DJ_CUE_{idx}_COLOR", text=cue_color)
            changed_fields.append(f"Cue {idx}")

    # Loops → TXXX frames universais
    loops = dj_data.get("loops", [])
    for i in range(4):
        for f in ["DJ_LOOP_%d_IN", "DJ_LOOP_%d_OUT", "DJ_LOOP_%d_NAME"]:
            key_to_del = f"TXXX:{f % i}"
            if key_to_del in tags:
                del tags[key_to_del]

    for idx, loop in enumerate(loops[:4]):
        in_ms  = loop.get("in_ms")
        out_ms = loop.get("out_ms")
        name   = str(loop.get("name", "")).strip()
        if in_ms is not None and out_ms is not None:
            tags[f"TXXX:DJ_LOOP_{idx}_IN"]   = TXXX(encoding=3, desc=f"DJ_LOOP_{idx}_IN",   text=str(in_ms))
            tags[f"TXXX:DJ_LOOP_{idx}_OUT"]  = TXXX(encoding=3, desc=f"DJ_LOOP_{idx}_OUT",  text=str(out_ms))
            tags[f"TXXX:DJ_LOOP_{idx}_NAME"] = TXXX(encoding=3, desc=f"DJ_LOOP_{idx}_NAME", text=name)
            changed_fields.append(f"Loop {idx}")

    # Fonte e timestamp
    source = str(dj_data.get("source", "")).strip()
    if source:
        tags["TXXX:DJ_SOURCE"] = TXXX(encoding=3, desc="DJ_SOURCE", text=source)

    # Compatibilidade Serato: reescrever GEOB:Serato Markers2 se tiver cues
    if cues:
        geob_data = build_serato_markers2(cues, loops, color)
        if geob_data:
            tags["GEOB:Serato Markers2"] = GEOB(
                encoding=0,
                mime="application/octet-stream",
                filename="",
                desc="Serato Markers2",
                data=geob_data
            )
            changed_fields.append("Serato Markers2")

    tags.save(filepath, v2_version=3)
    return {"ok": True, "changed": changed_fields}


def build_serato_markers2(cues, loops, color):
    """Constrói o binário GEOB:Serato Markers2 com cues e loops."""
    entries = bytearray()

    # COLOR entry (0x00)
    if color and color.startswith("#") and len(color) == 7:
        try:
            r = int(color[1:3], 16)
            g = int(color[3:5], 16)
            b = int(color[5:7], 16)
            color_entry = bytes([0x00, r, g, b])
            entries += b"\x00"                           # type
            entries += struct.pack(">I", len(color_entry))
            entries += color_entry
        except Exception:
            pass

    # CUE entries (0x01)
    for idx, cue in enumerate(cues[:8]):
        pos_ms = int(cue.get("position_ms", 0))
        name   = str(cue.get("name", "")).encode("utf-8")
        cue_color = cue.get("color", "#CC0000")
        try:
            r = int(cue_color[1:3], 16) if cue_color.startswith("#") else 0xCC
            g = int(cue_color[3:5], 16) if cue_color.startswith("#") else 0
            b = int(cue_color[5:7], 16) if cue_color.startswith("#") else 0
        except Exception:
            r, g, b = 0xCC, 0, 0

        entry_data = (
            bytes([idx]) +
            struct.pack(">I", pos_ms) +
            bytes([0x00]) +
            bytes([r, g, b]) +
            bytes([0x00, 0x00]) +
            name + b"\x00"
        )
        entries += b"\x01"
        entries += struct.pack(">I", len(entry_data))
        entries += entry_data

    # LOOP entries (0x02)
    for idx, loop in enumerate(loops[:4]):
        in_ms  = int(loop.get("in_ms", 0))
        out_ms = int(loop.get("out_ms", 0))
        name   = str(loop.get("name", "")).encode("utf-8")
        entry_data = (
            bytes([idx]) +
            struct.pack(">I", in_ms) +
            struct.pack(">I", out_ms) +
            bytes([0xFF, 0xFF, 0xFF, 0xFF]) +
            bytes([0x27, 0xAA, 0xE1]) +
            bytes([0x00, 0x00]) +
            bytes([0x01]) +
            name + b"\x00"
        )
        entries += b"\x02"
        entries += struct.pack(">I", len(entry_data))
        entries += entry_data

    if not entries:
        return None

    # Formatar como Serato: versão + base64 em linhas de 72 chars
    b64 = base64.b64encode(bytes(entries))
    # Inserir newlines a cada 72 bytes (formato Serato)
    lines = [b64[i:i+72] for i in range(0, len(b64), 72)]
    content = b"\n".join(lines)

    return b"\x01\x01" + content


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Uso: dj_write_universal.py <filepath> <dj_data_json>"}))
        sys.exit(1)

    filepath = sys.argv[1]
    dj_data  = json.loads(sys.argv[2])
    result   = write_dj_tags(filepath, dj_data)
    print(json.dumps(result, ensure_ascii=False))
