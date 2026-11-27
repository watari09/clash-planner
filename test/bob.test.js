// Stand laut ClashTrack für dasselbe Dorf: B.O.B.-Zentrale gebaut (1/1), Gear-Up 1/3,
// Verteidigung 7/9, Helden 22/45. (Truppe: ClashTrack zeigt 10/18, im Export steht aber
// der Schweinegleiter auf 15 – wir richten uns nach dem Export.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVillage } from '../src/village.js';
import { bobStatus } from '../src/bob.js';

const game = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const village = readVillage(readFileSync(new URL('./fixtures/village-full.json', import.meta.url), 'utf8'));
const s = bobStatus(village, game);
const task = (type) => s.tasks.find((t) => t.type === type);

test('Stand der Aufgaben', () => {
  assert.equal(s.control.built, true);
  assert.equal(s.control.level, 1);
  assert.deepEqual([task('GearUp').current, task('GearUp').target], [1, 3]);
  assert.deepEqual([task('HighestBuilderDefenceLevel').current, task('HighestBuilderDefenceLevel').target], [7, 9]);
  assert.deepEqual([task('TotalBuilderHeroLevels').current, task('TotalBuilderHeroLevels').target], [22, 45]);
  assert.deepEqual([task('HighestBuilderTroopLevel').current, task('HighestBuilderTroopLevel').target], [15, 18]);
});

test('Helden: genau 23 Stufen werden verteilt', () => {
  const t = task('TotalBuilderHeroLevels');
  assert.equal(t.steps.reduce((n, x) => n + (x.to - x.from), 0), 23);
  assert.equal(t.blocked, null);
});

test('Gear-Ups: Bogenschützenturm und Minenwerfer fehlen, Multimörser muss erst auf 7', () => {
  const t = task('GearUp');
  assert.deepEqual(t.steps.map((x) => x.name).sort(), ['Bogenschützenturm', 'Minenwerfer']);
  const mortar = t.steps.find((x) => x.name === 'Minenwerfer');
  assert.ok(mortar.prereq.some((p) => p.name === 'Multimörser' && p.to === 7));
  assert.equal(mortar.seconds, 14 * 86400);
});

test('Zentrale: Stufen 2–5 kosten zusammen 6,5 Mio. Nachtdorf-Gold', () => {
  assert.equal(s.control.cost.Gold2, 500000 + 1000000 + 2000000 + 3000000);
  assert.ok(s.totals.seconds >= s.totals.labSeconds && s.totals.seconds >= s.totals.gearSeconds);
});

test('Verteidigung: geplante Stufen zählen mit, eigene Wahl geht vor', () => {
  const def = (o) => bobStatus(village, game, 'de', o).tasks.find((t) => t.type === 'HighestBuilderDefenceLevel');
  const fastest = def({}).steps[0];
  const other = def({}).options.find((o) => o.id !== fastest.id);
  // eigene Wahl
  assert.equal(def({ choice: { HighestBuilderDefenceLevel: other.id } }).steps[0].id, other.id);
  // steht die andere schon bis kurz vor dem Ziel im Plan, gewinnt sie
  const near = def({ planned: { [other.id]: other.to - 1 } }).steps[0];
  assert.equal(near.id, other.id);
  assert.equal(near.from, other.to - 1);
  assert.equal(near.viaPlan, true);
});
