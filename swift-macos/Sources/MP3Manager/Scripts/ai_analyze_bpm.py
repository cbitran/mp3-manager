#!/usr/bin/env python3
"""
AI BPM & Beat Grid analyzer using librosa.
Outputs JSON + writes Serato BeatGrid and universal TXXX tags.
Usage: ai_analyze_bpm.py <mp3_path> [--write]
"""
import sys
import json
import struct
import base64
import os
import warnings

warnings.filterwarnings("ignore")

def detect_key(y, sr):
    """
    Detecta tonalidade musical usando chroma CQT + Krumhansl-Schmuckler.
    Retorna string no formato 'Am', 'Dm', 'G', 'C#m', etc.
    """
    import librosa
    import numpy as np

    # Usa a faixa central da música (mais representativa que intro/outro)
    mid = len(y) // 4
    y_mid = y[mid: 3 * mid]

    chroma = librosa.feature.chroma_cqt(y=y_mid, sr=sr, bins_per_octave=36)
    chroma_mean = np.mean(chroma, axis=1)

    # Perfis de Krumhansl-Schmuckler (major e minor)
    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    keys  = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

    best_corr = -np.inf
    best_key  = "C"
    best_mode = "major"

    for i in range(12):
        shifted = np.roll(chroma_mean, -i)
        maj_c = float(np.corrcoef(shifted, major)[0, 1])
        min_c = float(np.corrcoef(shifted, minor)[0, 1])
        if maj_c > best_corr:
            best_corr = maj_c; best_key = keys[i]; best_mode = "major"
        if min_c > best_corr:
            best_corr = min_c; best_key = keys[i]; best_mode = "minor"

    return best_key if best_mode == "major" else f"{best_key}m"


def detect_cue_points(y, sr, bpm, first_beat_ms, max_cues=8):
    """
    Detecta até 8 cue points via análise de estrutura musical:
    - Mudanças de seção (segmentação espectral via librosa)
    - Snapped ao beat mais próximo para precisão DJ
    Retorna lista de dicts: {index, position_ms, label, color}
    """
    import librosa
    import numpy as np

    # Cores padrão Serato para cue points 1-8
    colors = ["#CC0000", "#CC8800", "#CCCC00", "#00CC00",
              "#00CCCC", "#0088CC", "#8800CC", "#CC00CC"]

    labels = ["Intro", "Verse", "Pre-Chorus", "Chorus",
              "Bridge", "Break", "Outro", "Drop"]

    # Segmentação estrutural via MFCC + recurrence matrix
    try:
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
        bounds = librosa.segment.agglomerative(mfcc, 8)
        bound_times = librosa.frames_to_time(bounds, sr=sr)
    except Exception:
        # Fallback: divisão uniforme em seções
        duration = len(y) / sr
        bound_times = np.linspace(0, duration, 10)[1:-1]

    # Snap cada boundary ao beat mais próximo
    beat_interval_s = 60.0 / bpm if bpm > 0 else 0.5
    first_beat_s    = first_beat_ms / 1000.0

    def snap_to_beat(t_s):
        if beat_interval_s <= 0:
            return t_s
        offset = (t_s - first_beat_s) / beat_interval_s
        snapped_offset = round(offset)
        return first_beat_s + snapped_offset * beat_interval_s

    cues = []
    seen_ms = set()
    for i, t in enumerate(bound_times):
        if len(cues) >= max_cues:
            break
        snapped = snap_to_beat(float(t))
        pos_ms  = int(round(max(0.0, snapped) * 1000))
        # Evitar cues duplicados ou muito próximos (< 2 beats)
        min_gap = int(beat_interval_s * 2 * 1000)
        if any(abs(pos_ms - s) < min_gap for s in seen_ms):
            continue
        seen_ms.add(pos_ms)
        cues.append({
            "index":       len(cues),
            "position_ms": pos_ms,
            "label":       labels[len(cues)] if len(cues) < len(labels) else f"Cue {len(cues)+1}",
            "color":       colors[len(cues) % len(colors)],
            "is_hot":      True,
        })

    return cues


def analyze(filepath):
    import librosa
    import numpy as np

    y, sr = librosa.load(filepath, sr=22050, mono=True)

    # Primary: BPM via beat_track (onset-envelope based)
    tempo_bt, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames", trim=False)
    beat_times_bt = librosa.frames_to_time(beat_frames, sr=sr)

    # Normalize tempo to scalar
    bpm_bt_val = float(np.squeeze(np.atleast_1d(tempo_bt)))

    # Secondary: PLP (Predominant Local Pulse) for refinement
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, aggregate=np.median)
    try:
        plp_result = librosa.beat.plp(onset_envelope=onset_env, sr=sr)
        bpm_plp_values = librosa.feature.tempo(onset_envelope=plp_result, sr=sr, aggregate=None)
        bpm_plp = float(np.median(np.atleast_1d(bpm_plp_values)))
    except Exception:
        bpm_plp = bpm_bt_val

    # Choose: prefer PLP if it aligns well with beat_track
    if abs(bpm_bt_val - bpm_plp) < 3.0:
        bpm_final = (bpm_bt_val + bpm_plp) / 2.0
    elif abs(bpm_bt_val * 2 - bpm_plp) < 3.0:
        bpm_final = bpm_plp
    elif abs(bpm_bt_val / 2 - bpm_plp) < 3.0:
        bpm_final = bpm_plp
    else:
        bpm_final = bpm_bt_val

    # Arredondamento: < 0.50 → trunca, >= 0.50 → sobe (round half-up)
    bpm_final = float(int(bpm_final + 0.5))

    # Beat times in ms, ensure non-empty
    beat_times_ms = [round(t * 1000, 1) for t in beat_times_bt.tolist()] if len(beat_times_bt) > 0 else []
    first_beat_ms = beat_times_ms[0] if beat_times_ms else 0.0

    # Confidence: ratio of beats that align with the detected BPM (within ±2%)
    if len(beat_times_bt) > 2:
        intervals = np.diff(beat_times_bt)
        expected_interval = 60.0 / bpm_final
        aligned = np.sum(np.abs(intervals - expected_interval) < expected_interval * 0.05)
        confidence = round(float(aligned) / len(intervals), 2)
    else:
        confidence = 0.5

    # Tonalidade musical
    key = ""
    try:
        key = detect_key(y, sr)
    except Exception:
        pass

    # Cue points (estrutura musical)
    cue_points = []
    try:
        cue_points = detect_cue_points(y, sr, bpm_final, first_beat_ms)
    except Exception:
        pass

    return {
        "bpm": bpm_final,
        "bpm_str": str(int(bpm_final)),
        "key": key,
        "cue_points": cue_points,
        "first_beat_offset_ms": first_beat_ms,
        "beat_times_ms": beat_times_ms,
        "beat_count": len(beat_times_ms),
        "confidence": confidence,
        "analyzer": "librosa-plp",
    }


def build_serato_beatgrid(bpm, first_beat_sec):
    """
    Serato BeatGrid binary format (GEOB:Serato BeatGrid):
    - 2 bytes header: 0x01 0x00
    - N non-terminal entries: float32 pos_secs (BE) + uint32 beats_till_next (BE)
    - 1 terminal entry: float32 pos_secs (BE) + float32 bpm (BE)
    - 1 footer byte: 0x00
    We write a single-section grid: 1 non-terminal at beat 0 with count=1, terminal at beat 1.
    """
    beat_interval = 60.0 / bpm

    data = bytearray()
    data += b'\x01\x00'

    pos0 = first_beat_sec
    pos1 = first_beat_sec + beat_interval

    # Non-terminal: position + beats_until_next (1 beat)
    data += struct.pack('>f', pos0)
    data += struct.pack('>I', 1)

    # Terminal: position + bpm as float
    data += struct.pack('>f', pos1)
    data += struct.pack('>f', bpm)

    data += b'\x00'
    return bytes(data)


def write_tags(filepath, bpm, first_beat_ms, beat_times_ms, confidence, key=""):
    from mutagen.id3 import ID3, TBPM, TXXX, GEOB, TKEY
    from mutagen.id3 import ID3NoHeaderError

    try:
        tags = ID3(filepath)
    except ID3NoHeaderError:
        tags = ID3()

    bpm_int = int(round(bpm))
    tags.add(TBPM(encoding=3, text=str(bpm_int)))
    if key:
        tags.add(TKEY(encoding=3, text=key))

    tags.add(TXXX(encoding=3, desc="DJ_BEATGRID_BPM",    text=f"{bpm:.2f}"))
    tags.add(TXXX(encoding=3, desc="DJ_BEATGRID_OFFSET", text=str(first_beat_ms)))
    tags.add(TXXX(encoding=3, desc="DJ_AI_CONFIDENCE",   text=str(confidence)))
    tags.add(TXXX(encoding=3, desc="DJ_AI_ANALYZER",     text="librosa-plp"))

    # Serato BeatGrid
    first_beat_sec = first_beat_ms / 1000.0
    grid_bytes = build_serato_beatgrid(bpm, first_beat_sec)
    tags.add(GEOB(
        encoding=0,
        mime='application/octet-stream',
        filename='BeatGrid',
        desc='Serato BeatGrid',
        data=grid_bytes
    ))

    # Virtual DJ style: also store beat grid as compact JSON for later export
    compact = {
        "bpm": bpm,
        "offset_ms": first_beat_ms,
        "beats": len(beat_times_ms),
        "confidence": confidence,
    }
    tags.add(TXXX(encoding=3, desc="DJ_AI_RESULT", text=json.dumps(compact)))

    tags.save(filepath, v2_version=3)
    return True


def build_serato_markers2(cue_points, bpm, first_beat_sec):
    """
    Constrói o payload base64 do GEOB:Serato Markers2.
    Inclui cue points (HOT CUE) e BPM lock.
    Formato: header + entradas length-prefixed + footer.
    """
    import base64

    def encode_color(hex_color):
        h = hex_color.lstrip("#")
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return bytes([r, g, b])

    entries = bytearray()

    for cue in cue_points:
        idx     = cue["index"]
        pos_ms  = cue["position_ms"]
        color   = cue.get("color", "#CC0000")
        label   = cue.get("label", f"Cue {idx+1}")

        # HOT CUE entry
        entry_type = b"CUE\x00"
        payload = bytearray()
        payload += b'\x00'                          # version
        payload += struct.pack('>B', idx)            # index
        payload += struct.pack('>I', pos_ms)         # position ms
        payload += b'\x00'                          # separator
        payload += encode_color(color)              # RGB color
        payload += b'\x00'                          # separator
        payload += label.encode('utf-8') + b'\x00'  # label null-terminated

        entry = entry_type + struct.pack('>I', len(payload)) + bytes(payload)
        entries += entry

    # Encode: Serato Markers2 = "application/octet-stream" base64 blob
    header  = b'\x01\x01'
    payload = header + bytes(entries) + b'\x00'
    return base64.b64encode(payload)


def write_serato_cues(filepath, cue_points, bpm, first_beat_sec):
    """Grava GEOB:Serato Markers2 com os cue points detectados."""
    from mutagen.id3 import ID3, GEOB
    from mutagen.id3 import ID3NoHeaderError
    try:
        tags = ID3(filepath)
    except ID3NoHeaderError:
        tags = ID3()

    markers2_data = build_serato_markers2(cue_points, bpm, first_beat_sec)
    tags.add(GEOB(
        encoding=0,
        mime='application/octet-stream',
        filename='Serato Markers2',
        desc='Serato Markers2',
        data=markers2_data
    ))
    tags.save(filepath, v2_version=3)
    return True


def write_rekordbox_xml(filepath, bpm, first_beat_offset_s, cue_points=None):
    """
    Cria ou atualiza ~/Music/rekordbox/rekordbox.xml com BPM, beat grid e cue points.
    Compatível com importação direta no rekordbox via File → Import.
    """
    import xml.etree.ElementTree as ET
    import urllib.parse
    from datetime import date

    possible = [
        os.path.expanduser("~/Music/rekordbox/rekordbox.xml"),
        os.path.expanduser("~/Documents/rekordbox/rekordbox.xml"),
    ]
    db_path = next((p for p in possible if os.path.exists(p)), possible[0])
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    # Ler metadados via mutagen
    title = artist = ""
    duration_s = bitrate = samplerate = 0
    try:
        from mutagen.id3 import ID3
        from mutagen.mp3 import MP3 as MutagenMP3
        tags = ID3(filepath)
        title  = str(tags.get("TIT2") or "")
        artist = str(tags.get("TPE1") or "")
        mp3info = MutagenMP3(filepath)
        duration_s = int(mp3info.info.length)
        bitrate    = int(mp3info.info.bitrate / 1000)
        samplerate = int(mp3info.info.sample_rate)
    except Exception:
        pass

    location   = "file://" + urllib.parse.quote(os.path.abspath(filepath))
    normalized = os.path.normpath(os.path.abspath(filepath))
    bpm_str    = f"{bpm:.2f}"
    inizio_str = f"{first_beat_offset_s:.3f}"
    today      = date.today().isoformat()

    # Carregar ou criar XML
    root = None
    if os.path.exists(db_path):
        try:
            tree = ET.parse(db_path)
            root = tree.getroot()
        except Exception:
            root = None

    if root is None:
        root       = ET.Element("DJ_PLAYLISTS", Version="1.0.0")
        ET.SubElement(root, "PRODUCT", Name="rekordbox", Version="6.0.0", Company="AlphaTheta")
        collection = ET.SubElement(root, "COLLECTION", Entries="0")
        playlists  = ET.SubElement(root, "PLAYLISTS")
        rnode      = ET.SubElement(playlists, "NODE", Type="0", Name="ROOT", Count="1")
        ET.SubElement(rnode, "NODE", Name="All Tracks", Type="1", KeyType="0", Entries="0")
    else:
        collection = root.find("COLLECTION")
        if collection is None:
            collection = ET.SubElement(root, "COLLECTION", Entries="0")

    # Localizar faixa pelo caminho do arquivo
    existing = None
    max_id   = 0
    for t in collection.findall("TRACK"):
        try:
            max_id = max(max_id, int(t.get("TrackID", "0")))
        except ValueError:
            pass
        try:
            t_path = os.path.normpath(
                urllib.parse.unquote(t.get("Location", "").replace("file://", ""))
            )
        except Exception:
            t_path = ""
        if t_path == normalized:
            existing = t
            break

    if existing is not None:
        # Atualizar BPM, beat grid e cue points
        existing.set("AverageBpm", bpm_str)
        for tempo in existing.findall("TEMPO"):
            existing.remove(tempo)
        ET.SubElement(existing, "TEMPO",
                      Inizio=inizio_str, Bpm=bpm_str, Metro="4/4", Battito="1")
        if cue_points:
            for pm in existing.findall("POSITION_MARK"):
                existing.remove(pm)
            for cue in cue_points:
                pos_s = cue["position_ms"] / 1000.0
                ET.SubElement(existing, "POSITION_MARK",
                              Name=cue.get("label", ""),
                              Type="0",
                              Start=f"{pos_s:.3f}",
                              Num=str(cue["index"]))
    else:
        # Adicionar nova entrada
        new_id     = max_id + 1
        file_size  = str(os.path.getsize(filepath)) if os.path.exists(filepath) else "0"
        track_elem = ET.SubElement(collection, "TRACK",
            TrackID   = str(new_id),
            Name      = title or os.path.splitext(os.path.basename(filepath))[0],
            Artist    = artist,
            Album     = "",
            Kind      = "MP3 File",
            Size      = file_size,
            TotalTime = str(duration_s),
            AverageBpm= bpm_str,
            DateAdded = today,
            BitRate   = str(bitrate),
            SampleRate= str(samplerate),
            Comments  = "",
            PlayCount = "0",
            Rating    = "0",
            Location  = location,
            Tonality  = "",
            Label     = "",
        )
        ET.SubElement(track_elem, "TEMPO",
                      Inizio=inizio_str, Bpm=bpm_str, Metro="4/4", Battito="1")

        # Adicionar cue points como POSITION_MARK
        for cue in (cue_points or []):
            pos_s = cue["position_ms"] / 1000.0
            ET.SubElement(track_elem, "POSITION_MARK",
                          Name=cue.get("label", ""),
                          Type="0",
                          Start=f"{pos_s:.3f}",
                          Num=str(cue["index"]))

        count = len(collection.findall("TRACK"))
        collection.set("Entries", str(count))

        # Atualizar playlist "All Tracks"
        for node in root.iter("NODE"):
            if node.get("Name") == "All Tracks":
                node.set("Entries", str(count))
                ET.SubElement(node, "TRACK", Key=str(new_id))
                break

    ET.ElementTree(root).write(db_path, encoding="utf-8", xml_declaration=True)
    return db_path


def write_virtualdj_xml(filepath, bpm):
    vdj_dir = os.path.expanduser("~/VirtualDJ")
    if not os.path.isdir(vdj_dir):
        return False

    db_path = os.path.join(vdj_dir, "VirtualDJ Local Database v2.xml")
    if not os.path.exists(db_path):
        return False

    import xml.etree.ElementTree as ET
    try:
        tree = ET.parse(db_path)
        root = tree.getroot()
        normalized = os.path.normpath(filepath)
        for song in root.iter("Song"):
            song_path = song.get("FilePath", "")
            if os.path.normpath(song_path) == normalized:
                song.set("Bpm", f"{bpm:.2f}")
                tree.write(db_path, encoding="utf-8", xml_declaration=True)
                return True
    except Exception:
        pass
    return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "filepath required"}))
        sys.exit(1)

    filepath = sys.argv[1]
    do_write = "--write" in sys.argv

    if not os.path.exists(filepath):
        print(json.dumps({"error": f"file not found: {filepath}"}))
        sys.exit(1)

    try:
        result = analyze(filepath)
        if do_write:
            written = write_tags(
                filepath,
                result["bpm"],
                result["first_beat_offset_ms"],
                result["beat_times_ms"],
                result["confidence"],
                result.get("key", ""),
            )

            # Serato cue points
            cues = result.get("cue_points", [])
            if cues:
                try:
                    write_serato_cues(
                        filepath, cues,
                        result["bpm"],
                        result["first_beat_offset_ms"] / 1000.0,
                    )
                except Exception as e:
                    sys.stderr.write(f"Aviso Serato cues: {e}\n")

            vdj_written = write_virtualdj_xml(filepath, result["bpm"])

            rekordbox_path = None
            try:
                rekordbox_path = write_rekordbox_xml(
                    filepath,
                    result["bpm"],
                    result["first_beat_offset_ms"] / 1000.0,
                    cue_points=cues,
                )
            except Exception as e:
                sys.stderr.write(f"Aviso rekordbox.xml: {e}\n")

            result["tags_written"]      = written
            result["virtualdj_updated"] = vdj_written
            result["rekordbox_updated"] = rekordbox_path is not None
            result["rekordbox_path"]    = rekordbox_path

        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
