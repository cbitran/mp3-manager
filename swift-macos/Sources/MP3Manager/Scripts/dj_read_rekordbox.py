#!/usr/bin/env python3
"""Lê dados DJ do banco Rekordbox para um arquivo MP3 e retorna JSON."""
import sys
import json
import os

def find_track(db, filepath):
    """Busca faixa pelo caminho completo ou nome do arquivo."""
    filename = os.path.basename(filepath)
    folder = os.path.dirname(filepath)

    # Busca exata pelo caminho
    all_tracks = db.get_content().all()
    for t in all_tracks:
        full = (t.FolderPath or "") + (t.FileNameL or "")
        if full == filepath or full == filepath.rstrip("/"):
            return t
        # Busca pelo nome do arquivo
        if (t.FileNameL or "") == filename or (t.FileNameS or "") == filename:
            return t
    return None

def get_key_name(db, key_id):
    """Retorna nome da tonalidade pelo ID."""
    if not key_id:
        return ""
    try:
        keys = db.get_key().all()
        key_map = {k.ID: k.ScaleName for k in keys}
        return key_map.get(key_id, "")
    except Exception:
        return ""

def get_color_hex(db, color_id):
    """Retorna hex da cor pelo ID."""
    rb_colors = {
        1:  "#E96E6E",  # Pink
        2:  "#E8821E",  # Orange
        3:  "#F0D15E",  # Yellow
        4:  "#89E54B",  # Green
        5:  "#30C2FF",  # Blue
        6:  "#C479D6",  # Purple
        7:  "#FF4A4A",  # Red
        8:  "#FF7A1A",  # Dark Orange
        9:  "#7ECD2A",  # Dark Green
        10: "#1AC0D8",  # Cyan
        11: "#7A5DFF",  # Violet
        12: "#FF69B4",  # Hot Pink
    }
    return rb_colors.get(color_id, "")

def read_track(filepath):
    try:
        from pyrekordbox import Rekordbox6Database
    except ImportError:
        return {"error": "pyrekordbox não instalado. Execute: pip3 install pyrekordbox"}

    try:
        db = Rekordbox6Database()
    except Exception as e:
        return {"error": f"Não foi possível abrir o banco Rekordbox: {e}"}

    track = find_track(db, filepath)
    if not track:
        return {"found": False, "source": "rekordbox"}

    # BPM: armazenado como inteiro × 100
    bpm = f"{track.BPM / 100:.2f}" if track.BPM and track.BPM > 0 else ""

    # Key: via KeyID
    key = get_key_name(db, track.KeyID)

    # Rating: 0–255 → 0–5
    rating = round((track.Rating or 0) / 51)

    # Cor da faixa
    color = get_color_hex(db, track.ColorID)

    # Comentário
    comment = str(track.Commnt or "").strip()

    # Cue points e loops
    cues = []
    loops = []
    try:
        cue_records = db.get_cue().filter_by(ContentID=track.ID).all()
        for c in cue_records:
            in_ms  = c.InMsec if c.InMsec and c.InMsec >= 0 else None
            out_ms = c.OutMsec if c.OutMsec and c.OutMsec >= 0 else None
            name   = str(c.Comment or "").strip()

            # Kind: 0=memory cue, 1=hot cue, 4=loop
            kind = c.Kind or 0
            if out_ms and out_ms > 0 and out_ms != in_ms:
                loops.append({
                    "in_ms":  in_ms,
                    "out_ms": out_ms,
                    "name":   name
                })
            elif in_ms is not None:
                cues.append({
                    "position_ms": in_ms,
                    "name":        name,
                    "color":       get_color_hex(db, c.ColorTableIndex),
                    "is_hot":      kind == 1
                })
    except Exception as e:
        pass

    return {
        "found":   True,
        "source":  "rekordbox",
        "bpm":     bpm,
        "key":     key,
        "rating":  rating,
        "color":   color,
        "comment": comment,
        "cues":    cues[:8],
        "loops":   loops[:4],
        "title":   str(track.Title or ""),
        "artist":  "",
        "album":   "",
        "year":    str(track.ReleaseYear or "") if track.ReleaseYear else "",
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Uso: dj_read_rekordbox.py <filepath>"}))
        sys.exit(1)

    result = read_track(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
