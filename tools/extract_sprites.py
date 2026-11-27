#!/usr/bin/env python3
"""
Holt die offiziellen Symbole aus der Clash-of-Clans-APK (split_install_time_asset_pack.apk) und legt sie
verkleinert als WebP unter img/ ab. Grafiken © Supercell, Nutzung gemäß Supercells Richtlinie für Fan-Inhalte.

Aufbau der Spieldateien (Stand Spielversion 19.32):
  assets/base-attachments/<hash>.scattachment  – je Datei ein Asset; der ursprüngliche Pfad steht im Kopf
                                                   ("source_assets:/ui/sc/icons_79.sctx")
  ui/sc/icons_N.sctx                            – je ein Symbol: SCTX-Kopf, ab Byte 156 Zstandard,
                                                   darin ASTC-6x6-Blöcke (Breite/Höhe im Kopf)
Die Zuordnung Symbol → Texturnummer und die Drehungen unten ist von Hand aus ui/sc/icons.sc bzw. per Sichtprüfung ermittelt
und muss nach größeren Updates ggf. angepasst werden.

Aufruf:  python3 tools/extract_sprites.py <split_install_time_asset_pack.apk>
Braucht: Python-Pakete texture2ddecoder (ASTC-Decoder) und pillow.
"""
import re, struct, sys, zipfile
from collections import deque
from pathlib import Path
import compression.zstd as zstd
import texture2ddecoder
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "img"

# Name in der Seite → Texturnummer in ui/sc/icons_N.sctx
ICONS = {
    "builderPotion": 72, "researchPotion": 77, "clockTowerPotion": 73, "petPotion": 75,
    "clockTower": 54, "builderBite": 61, "labLicorice": 65,
    "Gold": 97, "Elixir": 92, "DarkElixir": 94, "Gold2": 91, "Elixir2": 93, "Diamonds": 96,
    "CommonOre": 100, "RareOre": 99, "EpicOre": 101,
    "book-fighting": 58, "book-spells": 60, "book-heroes": 59, "book-building": 56,
    "builder": 8, "masterBuilder": 10, "bob": 11,
}
SIZE = 64
# Manche Symbole liegen im Atlas gedreht: Grad im Uhrzeigersinn, um sie aufrecht zu stellen
ROTATE = {"builderPotion": -90, "builderBite": -90, "labLicorice": -90, "CommonOre": 270,
          "book-fighting": 270, "book-spells": 270, "book-heroes": 270}
# Drehung der Buch-Embleme (gegenüber dem Atlas), damit sie aufrecht auf dem Deckel stehen
EMBLEM_ROTATE = {"book-building": 180}


def index(apk):
    out = {}
    for n in apk.namelist():
        if n.startswith("assets/base-attachments/"):
            m = re.search(rb"source_assets:/([\x20-\x7e]+)", apk.open(n).read(200))
            if m:
                out[m.group(1).decode()] = n
    return out


def decode(data):
    """SCTX → Pillow-Bild (RGBA)."""
    i = data.find(b"SCTX")
    w, h = struct.unpack_from("<HH", data, i + 36)
    fmt = data[i + 40]
    if fmt != 5:
        raise ValueError(f"unbekanntes Texturformat {fmt}")
    raw = zstd.decompress(data[data.find(b"\x28\xb5\x2f\xfd"):])
    return Image.frombytes("RGBA", (w, h), texture2ddecoder.decode_astc(raw, w, h, 6, 6), "raw", "BGRA")


def parts(im, thr=40):
    """Zusammenhängende sichtbare Teile, größtes zuerst (je eine Liste von Pixeln)."""
    a = im.getchannel("A").load()
    w, h = im.size
    seen, out = set(), []
    for y in range(h):
        for x in range(w):
            if a[x, y] <= thr or (x, y) in seen:
                continue
            q, pts = deque([(x, y)]), []
            seen.add((x, y))
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        n = (cx + dx, cy + dy)
                        if 0 <= n[0] < w and 0 <= n[1] < h and n not in seen and a[n] > thr:
                            seen.add(n)
                            q.append(n)
            out.append(pts)
    return sorted(out, key=len, reverse=True)


def cut(im, pts):
    """Nur dieses Teil (mit weichem Rand), auf seine Fläche zugeschnitten."""
    mask = Image.new("L", im.size, 0)
    mp = mask.load()
    for p in pts:
        mp[p] = 255
    mask = mask.filter(ImageFilter.MaxFilter(3))
    out = im.copy()
    out.putalpha(Image.composite(im.getchannel("A"), Image.new("L", im.size, 0), mask))
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return out.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))


def build(name, im):
    rot = ROTATE.get(name, 0)
    turned = im.rotate(-rot, expand=True) if rot else im
    if name.startswith("book-"):
        # Im Spiel wird das Emblem per Animation auf den Deckel gesetzt; im Atlas liegt es daneben
        # (und nicht mitgedreht). Buch = größtes Teil, Emblem = zweitgrößtes, auf den Deckel legen.
        book = cut(turned, parts(turned)[0])
        emblem = cut(im, parts(im)[1])
        if name in EMBLEM_ROTATE:
            emblem = emblem.rotate(-EMBLEM_ROTATE[name], expand=True)
        f = 0.45 * book.width / max(emblem.size)
        emblem = emblem.resize((max(1, round(emblem.width * f)), max(1, round(emblem.height * f))), Image.LANCZOS)
        book.alpha_composite(emblem, (round(0.42 * book.width - emblem.width / 2), round(0.55 * book.height - emblem.height / 2)))
        return book
    if "Potion" in name:
        # freistehende Deko-Teile (Funken, Monde) weglassen
        return cut(turned, parts(turned)[0])
    return turned.crop(turned.getbbox())


def save(name, im):
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    im.save(OUT / f"{name}.webp", "WEBP", quality=85, method=6)


def main(path):
    apk = zipfile.ZipFile(path)
    idx = index(apk)
    OUT.mkdir(exist_ok=True)
    for name, n in ICONS.items():
        save(name, build(name, decode(apk.open(idx[f"ui/sc/icons_{n}.sctx"]).read())))
    print(f"{len(ICONS)} Symbole in img/")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
