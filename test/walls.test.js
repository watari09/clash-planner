import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { levelEntry } from '../src/village.js';
import { wallStatus, wallAfford, payWith } from '../src/walls.js';

const game = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const wall = game.items['1000010'];
const mk = (walls, th = 13) => ({ tag: '#TEST', buildings: [{ data: 1000001, lvl: th }, ...walls.map(([lvl, cnt]) => ({ data: 1000010, lvl, cnt }))] });

test('Mauern: ab Stufe 5 auch mit Elixier', () => {
  assert.deepEqual(payWith(wall, 4), ['Gold']);
  assert.deepEqual(payWith(wall, 5), ['Gold', 'Elixir']);
});

test('Mauer-Stand: Stufen, Mauerringe, Kosten bis Max', () => {
  const st = wallStatus(mk([[12, 10], [13, 5], [14, 2]]), game);
  assert.equal(st.max, 14); // Rathaus 13 → Mauer 14
  assert.equal(st.total, 17);
  assert.equal(st.missingLevels, 10 * 2 + 5);
  const c13 = levelEntry(wall, 13)[2];
  const c14 = levelEntry(wall, 14)[2];
  assert.deepEqual(st.steps.map((s) => [s.to, s.count]), [[13, 10], [14, 15]]);
  assert.equal(st.totals.Gold, 10 * c13 + 15 * c14);
  assert.equal(st.totals.Elixir, st.totals.Gold);
  assert.equal(wallStatus(mk([[12, 10]]), game, 'home', 0.8).steps[0].each, Math.round(c13 * 0.8));
});

test('Mauer-Rechner: niedrigste zuerst, mit Gold und Elixier', () => {
  const c13 = levelEntry(wall, 13)[2];
  const a = wallAfford(mk([[12, 3], [13, 1]]), game, 'home', { Gold: c13, Elixir: c13 * 1.5 });
  assert.equal(a.upgrades, 2);
  assert.deepEqual(a.byLevel, [{ level: 12, count: 1 }, { level: 13, count: 3 }]);
  assert.equal(a.spent.Gold + a.spent.Elixir, 2 * c13);
  assert.equal(wallStatus(mk([]), game), null);
});
