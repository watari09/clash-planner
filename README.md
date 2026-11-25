# Upgrade-Planer für Clash of Clans

**➜ Zur Seite: https://watari09.github.io/clash-planner/**

Webseite: Dorf-Export aus Clash of Clans einfügen →

- laufende Upgrades mit sekundengenauer Fertig-Zeit, als Kalender-Erinnerungen (`.ics`) übernehmbar
- Fortschritt bis zum Maximum des aktuellen oder eines gewählten Rathauses bzw. der Meisterhütte (inkl. Rathaus-Upgrade und allem, was bis dahin freigeschaltet wird): Prozent (nach Bauzeit), Bauarbeiter- und Labor-Tage, Kosten je Ressource, Liste aller offenen Upgrades
- Upgrade-Plan: gewünschte nächste Upgrades vormerken; sie werden auf die Bauarbeiter bzw. Labore verteilt, sobald diese frei werden → Start-/Endzeiten und wann welche Ressourcen bereitliegen müssen (auch als Kalender)
- Helfer & Boosts eintragen (Lehrling, Laborgehilfe, Bauarbeiter-/Forschungs-/Begleitertrank, Bauarbeiterbissen, Forschersuppe, Uhrenturm, Uhrenturm-Trank) → Fertig-Zeiten werden exakt neu berechnet, auch für Kalender und Plan
- Bauarbeiter-Zeit realistisch (ein Gebäude/Held nie doppelt gleichzeitig), Bauarbeiter-Anzahl und Goldpass (0/17/20 %) einstellbar, Filter nach Gebäudetyp und Labor-Art
- Rush Fixer: was noch unter dem Maximum des vorherigen Rathauses liegt
- Bücher: bester Einsatz von Buch des Kampfes/der Zauber/der Helden/des Bauens
- 6. Bauarbeiter (B.O.B.): Stand der vier Aufgaben aus den Spieldaten und kürzester Weg dorthin (Gear-Ups, Nachtdorf-Truppe/-Verteidigung, Helden-Summe)
- Erz-Rechner: glänzendes, glühendes und Sternenerz je Ausrüstung bis zum Maximum oder zur aktuellen Schmied-Stufe
- Listen sortierbar (Restzeit, schnellste/günstigste nächste Stufe), fertige ein-/ausblendbar, Stufen jedes Exemplars, Mauern in 10er-Schritten planen
- mehrere Dörfer, Rabatt (Goldpass/Season-Boost) einstellbar
- Start: „Heute zu tun“ und Tagesansicht der nächsten 7 Tage – was fertig wird, was laut Plan danach startet, was bereitzulegen ist; „+“ an jedem Upgrade plant direkt das nächste (nur, was zu dem Zeitpunkt startbar ist)
- Supercharges (ab Rathaus 17/18) im Fortschritt; Gear-Ups und Ausrüstung im Plan
- Helfer an laufenden Upgrades (`helper_timer`) und Goblin-Bauarbeiter (`extra`) aus dem Export berücksichtigt
- Als App auf den Home-Bildschirm (Manifest + Hinweis)
- Offizielle Spiel-Symbole für Tränke, Ressourcen, Erze, Bücher und Bauarbeiter (aus den Spieldateien)
- Deutsch und Englisch (Spielnamen aus den Spieldaten, Oberfläche über `src/i18n.js`)

 Läuft komplett im Browser, keine Anmeldung, keine Daten auf einem Server.

## Entwicklung

```bash
python3 -m http.server 8765      # dann http://localhost:8765
npm test                         # Node ≥ 20, keine Abhängigkeiten
```

- `src/village.js` – Auswertung des Exports, Fortschritt und Kalender-Erzeugung (ohne DOM, getestet)
- `src/boosts.js` – Beschleuniger auf laufende Upgrades anwenden (ohne DOM, getestet)
- `src/bob.js`, `src/ore.js`, `src/magic.js` – 6. Bauarbeiter, Erz-Rechner, Bücher (ohne DOM, getestet)
- `src/planner.js` – Upgrade-Plan: Verteilung auf Bauarbeiter/Labore, Ressourcen-Zeitplan (ohne DOM, getestet)
- `src/app.js` – Oberfläche
- `data/game.json` – Namen, Stufen und Bauzeiten aller Spielobjekte

## Symbole aktualisieren

Die Symbole unter `img/` sind die offiziellen Grafiken aus dem Spiel (© Supercell, Nutzung gemäß Fan-Content-Richtlinie). Sie werden aus der APK gelesen:

```bash
adb pull <pfad>/split_install_time_asset_pack.apk
python3 -m venv .research/venv && .research/venv/bin/pip install texture2ddecoder pillow   # ASTC-Decoder, Bildbearbeitung
.research/venv/bin/python tools/extract_sprites.py split_install_time_asset_pack.apk
```

## Spieldaten aktualisieren

`data/game.json` wird aus den offiziellen Spieldaten-Tabellen erzeugt, die Supercell unter `game-assets.clashofclans.com/<fingerprint>/` bereitstellt. Der Fingerprint der aktuellen Version steht in der APK:

```bash
adb shell pm path com.supercell.clashofclans          # Pfad von split_install_time_asset_pack.apk
adb pull <pfad>/split_install_time_asset_pack.apk
unzip -p split_install_time_asset_pack.apk assets/fingerprint.json | python3 -c "import sys,json;print(json.load(sys.stdin)['sha'])"
python3 tools/update_data.py <sha>
```

---

Dieser Inhalt ist nicht mit Supercell verbunden und wird nicht von Supercell unterstützt, gesponsert oder ausdrücklich genehmigt. Supercell ist nicht für ihn verantwortlich. Weitere Informationen: [Supercells Richtlinie für Fan-Inhalte](https://supercell.com/en/fan-content-policy/).
