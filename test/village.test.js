// Ausschnitt aus einem echten Dorf-Export vom 20.11.2026 (Spieler-Tag ersetzt).
// Erwartete Werte = was das Spiel zu diesem Zeitpunkt angezeigt hat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVillage, analyze, toIcs, formatDuration } from '../src/village.js';

const game = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const village = readVillage(readFileSync(new URL('./fixtures/village.json', import.meta.url), 'utf8'));
const r = analyze(village, game);
const group = (key) => r.groups.find((g) => g.key === key);
const names = (key) => group(key).items.map((i) => `${i.name} ${i.level}`);

test('Heimatdorf-Bauarbeiter: 5 von 5 belegt, inkl. Held', () => {
  assert.deepEqual(names('home_builders'), [
    'X-Bogen 8', 'Großer Wächter 30', 'Squad-Kaserne 2', 'X-Bogen 7', 'X-Bogen 8',
  ]);
  assert.equal(group('home_builders').slots, 5);
});

test('Labor, Nachtdorf, Sternlabor', () => {
  assert.deepEqual(names('lab'), ['Drache 8']);
  assert.deepEqual(names('builder_builders'), ['Multimörser 6', 'Elixierlager 8', 'Sternlabor 9']);
  assert.deepEqual(names('star_lab'), ['Nachthexe 15']);
  assert.equal(group('builder_builders').slots, 3); // Meisterbauarbeiter + O.T.T.O. + B.O.T.O.
  assert.equal(group('pets').slots, 0);
});

test('Fertig-Zeiten sekundengenau aus Export-Zeitpunkt + Restzeit', () => {
  const mm = r.running.find((i) => i.id === 1000045);
  assert.equal(mm.finishAt, (1795199032 + 29280) * 1000);
  assert.equal(r.running[0].id, 1000045); // sortiert: Multimörser zuerst
});

test('Rathaus, Helfer, Uhrenturm', () => {
  assert.equal(r.townHall, 13);
  assert.equal(r.builderHall, 9);
  assert.equal(r.helpers[0].name, 'Bauarbeiterlehrling');
  assert.equal(r.clockTowerReadyAt, (1795199032 + 57004) * 1000);
});

test('Kalender: ein Termin pro Upgrade, stabile UID, Alarm zur Fertig-Zeit', () => {
  const ics = toIcs(r, village.timestamp * 1000);
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 10);
  assert.match(ics, /SUMMARY:Multimörser \(Stufe 6\) fertig/);
  assert.match(ics, /DTSTART:20261121T023152Z/);
  assert.match(ics, /UID:TEST-1000045-\d+@clash-planner/);
  assert.match(ics, /TRIGGER:PT0S/);
  assert.equal(toIcs(r, village.timestamp * 1000), ics);
});

test('Fehlermeldungen bei falschem Inhalt', () => {
  assert.throws(() => readVillage('hallo'), /kein gültiges JSON/);
  assert.throws(() => readVillage('{"a":1}'), /Dorf-Export/);
});

test('Dauer-Format', () => {
  assert.equal(formatDuration(29280), '8h 8m');
  assert.equal(formatDuration(652093), '7d 13h 8m');
  assert.equal(formatDuration(0), 'fertig');
});

// ---------- Fortschritt (komplettes Dorf, Rathaus 13 / Meisterhütte 9) ----------
import { progress, maxLevel } from '../src/village.js';
const full = readVillage(readFileSync(new URL('./fixtures/village-full.json', import.meta.url), 'utf8'));
const p = progress(full, game);
const item = (id) => game.items[String(id)];

test('Max-Stufen bei Rathaus 13 entsprechen dem Spiel', () => {
  assert.equal(maxLevel(item(1000021), 13), 8); // X-Bogen
  assert.equal(maxLevel(item(28000002), 13), 50); // Großer Wächter
  const labAt13 = maxLevel(item(1000007), 13);
  assert.equal(labAt13, 11); // Labor
  assert.equal(maxLevel(item(4000008), labAt13), 8); // Drache (Labor 11 bei Rathaus 13)
});

test('Fortschritt: Rathaus 13 und Meisterhütte 9 werden erkannt, Prozent plausibel', () => {
  assert.equal(p.home.hall, 13);
  assert.equal(p.builder.hall, 9);
  for (const v of [p.home, p.builder]) {
    assert.ok(v.percent > 0 && v.percent < 100, `Prozent ${v.percent}`);
    assert.ok(v.done <= v.total);
  }
});

test('Fortschritt: laufende X-Bögen zählen mit Restzeit, nicht mit voller Zeit', () => {
  const xbow = p.home.categories.find((c) => c.key === 'buildings').items.find((i) => i.id === 1000021);
  // 4 X-Bögen: 7→8 (läuft), 7→8 (läuft), 6→7 (läuft) + 7→8, einer schon auf 8
  assert.equal(xbow.count, 3);
  const lvl8 = item(1000021).levels[7][1];
  assert.equal(xbow.seconds, 203046 + 40011 + 181461 + lvl8);
});

test('Fortschritt: Mauern ohne Bauzeit, aber mit Kosten', () => {
  // Heimatdorf: 300 Mauern auf 14 = Maximum bei Rathaus 13
  const home = p.home.categories.find((c) => c.key === 'walls');
  assert.equal(home.items.length, 0);
  assert.equal(home.done, home.total);
  // Nachtdorf: viele Mauern noch niedrig
  const bb = p.builder.categories.find((c) => c.key === 'walls');
  assert.equal(bb.seconds, 0);
  assert.ok(Object.values(bb.cost).some((n) => n > 0));
});
