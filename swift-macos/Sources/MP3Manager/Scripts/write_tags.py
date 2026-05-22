#!/usr/bin/env python3
"""Escreve tags ID3 + capa em um arquivo MP3 usando mutagen."""
import sys
import json
import os
import urllib.request

try:
    from mutagen.id3 import (
        ID3, TIT2, TPE1, TALB, TDRC, TRCK,
        TBPM, TKEY, TCON, APIC, TXXX, error as ID3Error
    )
    from mutagen.id3 import ID3NoHeaderError
except ImportError:
    print("ERRO: mutagen não instalado. Execute: pip3 install mutagen")
    sys.exit(1)


def embed_cover(audio, cover_source: str):
    """Embeds cover from a local file path or remote URL."""
    try:
        if os.path.isfile(cover_source):
            with open(cover_source, "rb") as f:
                img_data = f.read()
            mime = "image/png" if cover_source.lower().endswith(".png") else "image/jpeg"
        else:
            req = urllib.request.Request(
                cover_source,
                headers={"User-Agent": "MP3Manager/1.0 (celio.bitran@gmail.com)"}
            )
            with urllib.request.urlopen(req, timeout=15) as r:
                img_data = r.read()
            url_lower = cover_source.lower().split("?")[0]
            mime = "image/png" if url_lower.endswith(".png") else "image/jpeg"

        audio.delall("APIC")
        audio.add(APIC(
            encoding=3,
            mime=mime,
            type=3,
            desc="Cover",
            data=img_data
        ))
        return True
    except Exception as e:
        sys.stderr.write(f"Aviso: não foi possível incorporar capa: {e}\n")
        return False


def write_tags(filepath: str, tags: dict, cover_source: str = ""):
    try:
        audio = ID3(filepath)
    except ID3NoHeaderError:
        audio = ID3()

    mapping = {
        "title":  lambda v: TIT2(encoding=3, text=v),
        "artist": lambda v: TPE1(encoding=3, text=v),
        "album":  lambda v: TALB(encoding=3, text=v),
        "year":   lambda v: TDRC(encoding=3, text=v),
        "track":  lambda v: TRCK(encoding=3, text=v),
        "bpm":    lambda v: TBPM(encoding=3, text=v),
        "key":    lambda v: TKEY(encoding=3, text=v),
        "genre":  lambda v: TCON(encoding=3, text=v),
    }

    frame_keys = {
        "title": "TIT2", "artist": "TPE1", "album": "TALB",
        "year": "TDRC", "track": "TRCK", "bpm": "TBPM",
        "key": "TKEY", "genre": "TCON",
    }

    for field, value in tags.items():
        if field == "rating":
            audio.delall("TXXX:RATING")
            if value and value != "0":
                audio.add(TXXX(encoding=3, desc="RATING", text=str(value)))
        elif field in mapping and value:
            audio[frame_keys[field]] = mapping[field](value)

    cover_ok = False
    if cover_source:
        cover_ok = embed_cover(audio, cover_source)

    audio.save(filepath, v2_version=3)
    print(json.dumps({"status": "ok", "cover_embedded": cover_ok}))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: write_tags.py <filepath> <tags_json> [cover_source]")
        sys.exit(1)

    filepath     = sys.argv[1]
    tags         = json.loads(sys.argv[2])
    cover_source = sys.argv[3] if len(sys.argv) > 3 else ""
    write_tags(filepath, tags, cover_source)
