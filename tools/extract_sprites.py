#!/usr/bin/env python3
"""
Holt die offiziellen Symbole aus der Clash-of-Clans-APK (split_install_time_asset_pack.apk) und legt sie
verkleinert als WebP unter img/ ab. Grafiken © Supercell, Nutzung gemäß Supercells Richtlinie für Fan-Inhalte.

Aufbau der Spieldateien (Stand Spielversion 19.32):
  assets/base-attachments/<hash>.scattachment  – je Datei ein Asset; der ursprüngliche Pfad steht im Kopf
                                                   ("source_assets:/ui/sc/icons_79.sctx")
  ui/sc/icons_N.sctx                            – je ein Symbol: SCTX-Kopf, ab Byte 156 Zstandard,
                                                   darin ASTC-6x6-Blöcke (Breite/Höhe im Kopf)
Die Zuordnung Symbol → Texturnummer unten ist von Hand aus ui/sc/icons.sc bzw. per Sichtprüfung ermittelt
und muss nach größeren Updates ggf. angepasst werden.

Aufruf:  python3 tools/extract_sprites.py <split_install_time_asset_pack.apk>
Braucht: Python-Paket texture2ddecoder (ASTC-Decoder), ImageMagick (magick).
"""
import json, re, struct, subprocess, sys, zipfile
from pathlib import Path
import compression.zstd as zstd
import texture2ddecoder

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "img"

# Name in der Seite → Texturnummer in ui/sc/icons_N.sctx
ICONS = {
    "builderPotion": 72, "researchPotion": 77, "clockTowerPotion": 73, "petPotion": 75,
    "clockTower": 54,
    "Gold": 97, "Elixir": 92, "DarkElixir": 94, "Gold2": 91, "Elixir2": 93, "Diamonds": 96,
    "CommonOre": 100, "RareOre": 99, "EpicOre": 101,
    "book-fighting": 58, "book-spells": 60, "book-heroes": 59, "book-building": 56,
    "builder": 8, "masterBuilder": 10, "bob": 11,
}
SIZE = 64
# manche Symbole liegen im Atlas gedreht (Grad, im Uhrzeigersinn)
ROTATE = {"builderPotion": -90}


def index(apk):
    out = {}
    for n in apk.namelist():
        if n.startswith("assets/base-attachments/"):
            m = re.search(rb"source_assets:/([\x20-\x7e]+)", apk.open(n).read(200))
            if m:
                out[m.group(1).decode()] = n
    return out


def decode(data):
    i = data.find(b"SCTX")
    w, h = struct.unpack_from("<HH", data, i + 36)
    fmt = data[i + 40]
    if fmt != 5:
        raise ValueError(f"unbekanntes Texturformat {fmt}")
    raw = zstd.decompress(data[data.find(b"\x28\xb5\x2f\xfd"):])
    return w, h, texture2ddecoder.decode_astc(raw, w, h, 6, 6)


def main(path):
    apk = zipfile.ZipFile(path)
    idx = index(apk)
    OUT.mkdir(exist_ok=True)
    for name, n in ICONS.items():
        w, h, bgra = decode(apk.open(idx[f"ui/sc/icons_{n}.sctx"]).read())
        # Tränke/Bücher haben im Atlas freistehende Deko-Teile (Funken, Monde): nur die größten Teile behalten
        keep = 1 if "Potion" in name else 2 if name.startswith("book-") else 0
        clean = ["(", "+clone", "-alpha", "extract", "-threshold", "15%",
                 "-define", f"connected-components:keep-top={keep}",
                 "-define", "connected-components:mean-color=true", "-connected-components", "8", ")",
                 "-compose", "CopyOpacity", "-composite"] if keep else []
        subprocess.run(["magick", "-size", f"{w}x{h}", "-depth", "8", "bgra:-",
                        *(["-rotate", str(ROTATE[name])] if name in ROTATE else []), *clean,
                        "-trim", "+repage", "-resize", f"{SIZE}x{SIZE}>", "-strip", "-quality", "85",
                        f"webp:{OUT / name}.webp"],
                       input=bgra, check=True)
    print(f"{len(ICONS)} Symbole in img/")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
