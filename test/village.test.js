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
