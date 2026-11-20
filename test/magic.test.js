// Erwartete Werte: ClashTrack "Magic Items" mit demselben Dorf (20.11.2026), Rathaus 13.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVillage, analyze } from '../src/village.js';
import { magicItems } from '../src/magic.js';

const game = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const village = readVillage(readFileSync(new URL('./fixtures/village-full.json', import.meta.url), 'utf8'));
const m = magicItems(village, game, analyze(village, game).running);
const D = 86400;
const top = (book, n) => m[book].items.slice(0, n).map((i) => [i.name, i.to, i.seconds]);

test('Buch des Kampfes: Lavahund → 6 (7d), Drachenreiter → 2 (5d 12h), dann Heiler/Belagerungskaserne (je 4d)', () => {
  assert.deepEqual(top('fighting', 2), [['Lavahund', 6, 7 * D], ['Drachenreiter', 2, 5.5 * D]]);
  const tied = m.fighting.items.slice(2, 4);
  assert.deepEqual(tied.map((i) => i.seconds), [4 * D, 4 * D]);
  assert.deepEqual(tied.map((i) => i.name).sort(), ['Belagerungskaserne', 'Heiler']);
});

test('Buch der Zauber: Rückrufzauber → 2 (7d), Frostzauber → 7 (5d)', () => {
  assert.deepEqual(top('spells', 2), [['Rückrufzauber', 2, 7 * D], ['Frostzauber', 7, 5 * D]]);
});

test('Buch der Helden: Barbarenkönig → 64 (4d), Bogenschützen-Königin → 59 (3d); laufender Wächter mit Restzeit', () => {
  assert.deepEqual(top('heroes', 2), [['Barbarenkönig', 64, 4 * D], ['Bogenschützen-Königin', 59, 3 * D]]);
  const warden = m.heroes.items.find((i) => i.name === 'Großer Wächter');
  assert.equal(warden.running, true);
  assert.equal(warden.seconds, 110355);
});

test('Laufender Drache steht mit Restzeit im Buch des Kampfes', () => {
  const dragon = m.fighting.items.find((i) => i.name === 'Drache');
  assert.equal(dragon.running, true);
  assert.equal(dragon.to, 8);
});
