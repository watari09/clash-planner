#!/usr/bin/env python3
"""Aktualisiert die Dateiliste in sw.js (Offline-Modus): alle Skripte, Symbole, Spieldaten."""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
files = ["./", "index.html", "style.css", "manifest.webmanifest", "icon.svg", "icon-192.png", "apple-touch-icon.png", "data/game.json"]
files += sorted(f"src/{p.name}" for p in (ROOT / "src").glob("*.js"))
files += sorted(f"img/{p.name}" for p in (ROOT / "img").glob("*.webp"))
sw = (ROOT / "sw.js").read_text(encoding="utf-8")
listing = "[\n" + "".join(f"  {json.dumps(f)},\n" for f in files) + "]"
sw = re.sub(r"const FILES = \[.*?\];", f"const FILES = {listing};", sw, flags=re.S)
(ROOT / "sw.js").write_text(sw, encoding="utf-8")
print(f"{len(files)} Dateien in sw.js")
