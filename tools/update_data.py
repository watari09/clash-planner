#!/usr/bin/env python3
"""
Erzeugt data/game.json aus den offiziellen Spieldaten-Tabellen von Clash of Clans.

Supercell stellt die Tabellen unter game-assets.clashofclans.com/<fingerprint>/ bereit.
Den Fingerprint der aktuellen Version findet man in der APK des Spiels:
  unzip -p split_install_time_asset_pack.apk assets/fingerprint.json   → Feld "sha"

Aufruf:  python3 tools/update_data.py <fingerprint>
Nur Python-Standardbibliothek.
"""
import csv, io, json, lzma, sys, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"

# Tabelle → (Art, ID-Basis für Tabellen ohne GlobalID-Spalte)
TABLES = {
    "buildings": ("building", None),
    "traps": ("trap", None),
    "characters": ("troop", None),
    "spells": ("spell", None),
    "heroes": ("hero", 28000000),
    "pets": ("pet", 73000000),
    "character_items": ("equipment", 90000000),
    "villager_apprentices": ("helper", 93000000),
    "guardians": ("guardian", 107000000),
}


def unpack(data: bytes) -> bytes:
    if data[:4] == b"Sig:":           # signierte Datei: "Sig:" + 64 Byte Signatur
        data = data[68:]
    if data[:1] == b"]":              # LZMA mit 4-Byte-Größe → auf das 8-Byte-Format von .lzma erweitern
        data = data[:9] + b"\x00" * 4 + data[9:]
        return lzma.LZMADecompressor(format=lzma.FORMAT_ALONE).decompress(data)
    return data


def fetch(sha: str, path: str) -> str:
    cached = CACHE / sha / path
    if not cached.exists():
        url = f"https://game-assets.clashofclans.com/{sha}/{path}"
        raw = urllib.request.urlopen(url, timeout=60).read()
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(unpack(raw))
    return cached.read_text(encoding="utf-8")


# Felder, die in Folgezeilen leer bleiben, aber für alle Stufen gelten.
# Zeiten, Kosten und Voraussetzungen werden NICHT vererbt: leer heißt dort wirklich "keins"
# (z. B. hat die Max-Stufe einer Truppe keine Upgrade-Zeit mehr).
INHERIT = {"GlobalID", "TID", "VillageType", "BuildResource", "UpgradeResource", "Deprecated", "Disabled"}


def rows(text: str):
    """Liefert (Name, [Zeilen als dict]) je Objekt. Folgezeilen ohne Name sind weitere Stufen."""
    r = list(csv.reader(io.StringIO(text)))
    header, body = r[0], r[2:]          # Zeile 2 enthält die Datentypen
    objects = []
    for line in body:
        d = dict(zip(header, line))
        if d.get("Name"):
            objects.append((d["Name"], [d]))
        elif objects:
            first = objects[-1][1][0]
            objects[-1][1].append({k: (first.get(k, "") if v == "" and k in INHERIT else v) for k, v in d.items()})
    return objects


def clean(s: str) -> str:
    """Zeilenumbrüche aus Namen entfernen; "Bauarbeiter-\\nlehrling" → "Bauarbeiterlehrling"."""
    for nl in ("\\n", "\n"):
        s = s.replace("-" + nl, "").replace(nl, " ")
    return " ".join(s.split())


def num(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def seconds(d: dict) -> int:
    return (num(d.get("BuildTimeD")) * 86400 + num(d.get("BuildTimeH")) * 3600 + num(d.get("BuildTimeM")) * 60
            + num(d.get("BuildTimeS")) + num(d.get("UpgradeTimeH")) * 3600 + num(d.get("UpgradeTimeM")) * 60)


def requirement(kind: str, d: dict) -> int:
    """Voraussetzung für eine Stufe: Rathaus/Meisterhütte (Gebäude, Fallen, Helden, Helfer),
    Labor-/Sternlabor-/Begleiterhaus-Stufe (Truppen, Zauber, Begleiter) bzw. Schmiede-Stufe (Ausrüstung)."""
    if kind in ("building", "trap"):
        return num(d.get("TownHallLevel"))
    if kind in ("hero", "helper"):
        return num(d.get("RequiredTownHallLevel"))
    if kind in ("troop", "spell", "pet"):
        return num(d.get("LaboratoryLevel"))
    if kind == "equipment":
        return num(d.get("RequiredBlacksmithLevel"))
    return 0


def cost(d: dict) -> int:
    return num(d.get("BuildCost")) or num(d.get("UpgradeCost"))


def resource(d: dict) -> str:
    return d.get("BuildResource") or d.get("UpgradeResource") or ""


def level_table(kind: str, levels: list) -> list:
    """
    Einheitlich: Eintrag i = Stufe i+1 erreichen → [Voraussetzung, Sekunden, Kosten, Ressource].
    Gebäude/Fallen: Zeile n enthält schon Bau-/Upgradezeit *auf* Stufe n.
    Truppen/Zauber/Helden/Begleiter: Zeile n enthält die Zeit *von* n auf n+1 → um eins verschieben;
    Stufe 1 ist eine Freischaltung ohne Labor-Zeit.
    """
    if kind in ("building", "trap"):
        return [[requirement(kind, d), seconds(d), cost(d), resource(d)] for d in levels]
    out = []
    for i, d in enumerate(levels):
        prev = levels[i - 1] if i > 0 else None
        out.append([
            requirement(kind, d),
            seconds(prev) if prev else 0,
            cost(prev) if prev else 0,
            resource(prev) if prev else resource(d),
        ])
    return out


def limits(sha: str, ids_by_name: dict) -> dict:
    """Erlaubte Anzahl je Gebäude/Falle pro Rathaus-Stufe (Heimatdorf) bzw. Meisterhütten-Stufe (Nachtdorf).
    In townhall_levels.csv heißt ein leeres Feld "wie bei der vorigen Stufe"."""
    r = list(csv.reader(io.StringIO(fetch(sha, "logic/townhall_levels.csv"))))
    header = r[0]
    cols = [c for c in header if c in ids_by_name]
    out = {"home": {}, "builder": {}}
    prev = {}
    for line in r[2:]:
        d = dict(zip(header, line))
        level = num(d.get("Name"), None)
        if level is None:
            continue
        cur = {c: (num(d[c]) if d.get(c, "") != "" else prev.get(c, 0)) for c in cols}
        prev = cur
        for c, n in cur.items():
            if n:
                gid, village = ids_by_name[c]
                out[village].setdefault(str(level), {})[str(gid)] = n
    return out


def global_value(rows_, name, column="NumberValue"):
    """Wert aus globals.csv; Listen gehen über Folgezeilen ohne Namen weiter."""
    header = rows_[0]
    for i, r in enumerate(rows_):
        if r and r[0] == name:
            if column != "NumberArray":
                return num(r[header.index(column)])
            out = [num(r[header.index(column)])]
            for nxt in rows_[i + 1:]:
                if nxt[0]:
                    break
                out.append(num(nxt[header.index(column)]))
            return out
    raise KeyError(name)


def boosts(sha: str) -> dict:
    """Beschleuniger: Multiplikator (x-fache Geschwindigkeit) und Dauer in Sekunden."""
    g = list(csv.reader(io.StringIO(fetch(sha, "logic/globals.csv"))))
    c = {name: levels[0] for name, levels in rows(fetch(sha, "logic/consumables.csv"))}
    helpers = {name: [num(d.get("BoostMultiplier")) for d in levels]
               for name, levels in rows(fetch(sha, "logic/villager_apprentices.csv"))}
    return {
        "builderPotion": {"mult": global_value(g, "BOOSTER_BUILDERS_SPEEDUP"), "sec": global_value(g, "BOOSTER_BUILDERS_DURATION")},
        "researchPotion": {"mult": global_value(g, "BOOSTER_LABORATORY_SPEEDUP"), "sec": global_value(g, "BOOSTER_LABORATORY_DURATION")},
        "petPotion": {"mult": global_value(g, "BOOSTER_PET_SHOP_SPEEDUP"), "sec": global_value(g, "BOOSTER_PET_SHOP_DURATION")},
        "builderBite": {"mult": num(c["Builder Bite"]["BoostMultiplier"]), "sec": num(c["Builder Bite"]["DurationSeconds"])},
        "labLicorice": {"mult": num(c["Lab Licorice"]["BoostMultiplier"]), "sec": num(c["Lab Licorice"]["DurationSeconds"])},
        "clockTower": {"mult": global_value(g, "CLOCK_TOWER_BOOST_MULTIPLIER"),
                       "secByLevel": [m * 60 for m in global_value(g, "CLOCK_TOWER_BOOST_MINS", "NumberArray")],
                       "cooldown": global_value(g, "CLOCK_TOWER_BOOST_COOLDOWN_MINS") * 60},
        "clockTowerPotion": {"mult": global_value(g, "CLOCK_TOWER_BOOST_MULTIPLIER"), "sec": global_value(g, "BOOSTER_CLOCKTOWER_DURATION")},
        # Helfer: Stufe n → zusätzliche Stunden pro Stunde (Gesamtgeschwindigkeit n+1), 1 h lang
        "builderApprentice": {"extraByLevel": helpers["BuilderApprentice"], "sec": 3600},
        "labAssistant": {"extraByLevel": helpers["ResearchApprentice"], "sec": 3600},
    }


def gear_up(levels: list, first: dict, ids_by_name: dict):
    """Gear-Up (Heimatdorf-Verteidigung umrüsten): ab welcher Stufe, Kosten, Dauer und
    welches Nachtdorf-Gebäude auf welcher Stufe dafür nötig ist."""
    target = first.get("GearUpBuilding")
    if not target or target not in ids_by_name:
        return None
    for i, d in enumerate(levels):
        if num(d.get("GearUpCost")) or num(d.get("GearUpTime")):
            return {
                "from": i + 1,
                "cost": num(d.get("GearUpCost")),
                "resource": d.get("GearUpResource") or first.get("GearUpResource") or "Gold",
                "sec": num(d.get("GearUpTime")) * 60,
                "requires": ids_by_name[target][0],
                "requiresLevel": num(first.get("GearUpLevelRequirement")),
            }
    return None


def equipment_info(levels: list, first: dict, items: dict) -> dict:
    """Held, Seltenheit und Erz-Kosten je Stufe (Index i = Stufe i+1 erreichen; Zeile n = Kosten n→n+1)."""
    def ore(d):
        res = [r.strip() for r in (d.get("UpgradeResources") or "").split(";") if r.strip()]
        amounts = [num(a) for a in (d.get("UpgradeCosts") or "").split(";") if a.strip()]
        return dict(zip(res, amounts))
    hero_name = (first.get("AllowedCharacters") or "").split(";")[0].strip()
    hero = next((int(i) for i, it in items.items() if it["kind"] == "hero" and it["name"]["en"] == hero_name), None)
    return {
        "hero": hero,
        "rarity": (first.get("Rarity") or "").lower(),
        "deprecated": first.get("Deprecated") == "TRUE",
        "ore": [{}] + [ore(levels[i - 1]) for i in range(1, len(levels))],
    }


def filter_group(kind: str, first: dict):
    """Untergruppe für Filter: Gebäude nach Klasse, Labor nach Truppe/Zauber/Belagerung."""
    if kind == "building":
        cls = first.get("BuildingClass", "")
        return {"Defense": "defense", "Resource": "resource", "Army": "army"}.get(cls, "other")
    if kind == "troop":
        return "siege" if first.get("ProductionBuilding") == "Siege Workshop" else "troop"
    return None


def unlock_hall(kind: str, first: dict, ids_by_name: dict, items: dict):
    """
    Ab welchem Rathaus (bzw. welcher Meisterhütte) ein Objekt freigeschaltet werden kann – oder None,
    wenn es nicht regulär freischaltbar ist (Event-, Super-Truppen, Veraltetes, interne Einträge).
    Truppen/Zauber: Stufe der Kaserne/Zauberfabrik → deren Rathaus-Voraussetzung.
    Helden: Rathaus der ersten Stufe. Begleiter: Begleiterhaus-Stufe → Rathaus.
    """
    if first.get("Deprecated") == "TRUE" or first.get("EnabledByCalendar") or first.get("EnabledBySuperLicence"):
        return None

    def building_req(name, level):
        ref = ids_by_name.get(name)
        if not ref or level < 1:
            return None
        levels = items[str(ref[0])]["levels"]
        return levels[min(level, len(levels)) - 1][0] or None

    if kind in ("troop", "spell"):
        # beschworene/Fallen-Einheiten und gesperrte Einträge sind nicht trainierbar
        if first.get("DisableProduction") == "TRUE" or first.get("IsSecondaryTroop") == "TRUE":
            return None
        level = num(first.get("BarrackLevel")) if kind == "troop" else num(first.get("SpellForgeLevel"))
        return building_req(first.get("ProductionBuilding", ""), level)
    if kind == "hero":
        return num(first.get("RequiredTownHallLevel")) or None
    if kind == "pet":
        return building_req("Pet House", num(first.get("LaboratoryLevel")))
    return None


def bob_tasks(sha: str, ids_by_name: dict) -> dict:
    """Aufgaben für B.O.B.s Zentrale (6. Bauarbeiter im Heimatdorf) aus upgrade_tasks.csv."""
    r = list(csv.reader(io.StringIO(fetch(sha, "logic/upgrade_tasks.csv"))))
    header = r[1][1:]
    tasks = []
    for line in r[3:]:
        d = dict(zip(header, line[1:]))
        if d.get("Name") and d.get("Disabled") != "TRUE":
            tasks.append({"type": d["TaskType"], "target": num(d.get("Quantity"))})
    return {"control": ids_by_name["BB BOB Control"][0], "tasks": tasks}


def main(sha: str):
    texts = {"de": {}, "en": {}}
    for lang, path in (("de", "localization/de.csv"), ("en", "localization/texts.csv")):
        for line in list(csv.reader(io.StringIO(fetch(sha, path))))[2:]:
            if len(line) >= 2:
                texts[lang][line[0]] = line[1]

    items = {}
    ids_by_name = {}
    pending_gear = []
    for table, (kind, id_base) in TABLES.items():
        for index, (name, levels) in enumerate(rows(fetch(sha, f"logic/{table}.csv"))):
            first = levels[0]
            gid = num(first.get("GlobalID"), None) if id_base is None else id_base + index
            if gid is None:
                continue
            tid = first.get("TID", "")
            village = "builder" if first.get("VillageType") == "1" else "home"
            if kind in ("building", "trap"):
                ids_by_name[name] = (gid, village)
            items[str(gid)] = {
                "name": {lang: clean(texts[lang].get(tid, name)) for lang in texts},
                "kind": kind,
                "village": village,
                # Index i = Stufe (first + i) erreichen: [Voraussetzung, Sekunden, Kosten, Ressource]
                "levels": level_table(kind, levels),
            }
            # Manche Tabellen beginnen nicht bei Stufe 1 (Nachtdorf-Truppen ab "VisualLevel" 9);
            # der Dorf-Export zählt nach dieser sichtbaren Stufe.
            first_level = num(first.get("VisualLevel"), 1) or 1
            if first_level > 1:
                items[str(gid)]["first"] = first_level
            if first.get("GearUpBuilding"):
                pending_gear.append((str(gid), levels, first))  # Ziel steht evtl. weiter unten in der Tabelle
            group = filter_group(kind, first)
            if group:
                items[str(gid)]["group"] = group
            if kind == "equipment":
                items[str(gid)].update(equipment_info(levels, first, items))
            # zweite Bezahl-Möglichkeit (Mauern: ab Stufe 5 auch Elixier)
            alt = [(first_level + i, d["AltBuildResource"]) for i, d in enumerate(levels) if d.get("AltBuildResource")]
            if alt:
                items[str(gid)]["alt"] = {"from": alt[0][0], "res": alt[0][1]}
            unlock = unlock_hall(kind, first, ids_by_name, items)
            if unlock:
                items[str(gid)]["unlock"] = unlock

    # Supercharges ("mini levels"): zusätzliche Stufen für Gebäude auf Max-Stufe
    for name, levels in rows(fetch(sha, "logic/mini_levels.csv")):
        target = levels[0].get("TargetBuilding")
        if target in ids_by_name:
            items[str(ids_by_name[target][0])]["supercharge"] = {
                "townHall": num(levels[0].get("RequiredTownHallLevel")),
                # je Stufe: [Sekunden, Kosten, Ressource]
                "levels": [[seconds(d), num(d.get("BuildCost")), d.get("BuildResource") or levels[0].get("BuildResource", "")] for d in levels],
            }

    for gid, levels, first in pending_gear:
        gear = gear_up(levels, first, ids_by_name)
        if gear:
            items[gid]["gearUp"] = gear

    version = json.loads(fetch(sha, "fingerprint.json")).get("version")
    out = {"version": version, "fingerprint": sha, "generated": date.today().isoformat(),
           "items": items, "limits": limits(sha, ids_by_name), "boosts": boosts(sha), "bob": bob_tasks(sha, ids_by_name)}
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "game.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(items)} Objekte, Spielversion {version} → data/game.json")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
