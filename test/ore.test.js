// Erwartete Werte: ClashTrack-Erzrechner mit demselben Dorf (Ziel = Maximalstufe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVillage } from '../src/village.js';
import { oreStatus } from '../src/ore.js';

const game = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const village = readVillage(readFileSync(new URL('./fixtures/village-full.json', import.meta.url), 'utf8'));
const s = oreStatus(village, game);
const item = (name) => s.heroes.flatMap((h) => h.items).find((i) => i.name === name);

test('Barbarenpuppe (Stufe 3) bis 18: 26.900 glänzend, 1.900 glühend', () => {
  assert.deepEqual(item('Barbarenpuppe').ore, { CommonOre: 26900, RareOre: 1900 });
});

test('Wutflasche (Stufe 5): 25.900 / 1.900; Riesenhandschuh (episch, 12): 43.500 / 3.000 / 450', () => {
  assert.deepEqual(item('Wutflasche').ore, { CommonOre: 25900, RareOre: 1900 });
  assert.deepEqual(item('Riesenhandschuh').ore, { CommonOre: 43500, RareOre: 3000, EpicOre: 450 });
});

test('Barbarenkönig: 9 Ausrüstungen inkl. neuer Blizzardaxt (legendär, bis 33)', () => {
  const king = s.heroes.find((h) => h.name === 'Barbarenkönig');
  assert.equal(king.items.length, 9);
  const axe = king.items.find((i) => i.name === 'Blizzardaxt');
  assert.equal(axe.rarity, 'legendary');
  assert.equal(axe.to, 33);
});

test('Nicht besessene Ausrüstung kostet nichts', () => {
  const missing = s.heroes.flatMap((h) => h.items).filter((i) => !i.owned);
  assert.ok(missing.length > 0);
  assert.ok(missing.every((i) => Object.keys(i.ore).length === 0));
});

test('Schmiede-Stufe begrenzt das Ziel', () => {
  const capped = oreStatus(village, game, 'de', { useBlacksmith: true });
  assert.ok(capped.total.CommonOre < s.total.CommonOre);
  assert.equal(capped.blacksmith, 6);
});
