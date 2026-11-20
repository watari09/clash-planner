# Upgrade-Planer für Clash of Clans

Webseite: Dorf-Export aus Clash of Clans einfügen →

- laufende Upgrades mit sekundengenauer Fertig-Zeit, als Kalender-Erinnerungen (`.ics`) übernehmbar
- Fortschritt bis zum Maximum des aktuellen Rathauses bzw. der Meisterhütte: Prozent (nach Bauzeit), Bauarbeiter- und Labor-Tage, Kosten je Ressource, Liste aller offenen Upgrades
- mehrere Dörfer, Rabatt (Goldpass/Season-Boost) einstellbar

 Läuft komplett im Browser, keine Anmeldung, keine Daten auf einem Server.

## Entwicklung

```bash
python3 -m http.server 8765      # dann http://localhost:8765
npm test                         # Node ≥ 20, keine Abhängigkeiten
```

- `src/village.js` – Auswertung des Exports und Kalender-Erzeugung (ohne DOM, getestet)
- `src/app.js` – Oberfläche
- `data/game.json` – Namen, Stufen und Bauzeiten aller Spielobjekte

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
