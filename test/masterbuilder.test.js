// Export vom 25.11.2026: Meisterbauarbeiter rüstet im Heimatdorf den Bogenschützenturm um,
// zwei Roboter (O.T.T.O., B.O.T.O.) bauen im Nachtdorf, Bauarbeitertrank wirkt noch 9057 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVillage, analyze, progress } from '../src/village.js';
import { nextStep, simulate, gearCandidates } from '../src/planner.js';
import { applyBoosts, boostedFinish } from '../src/boosts.js';

const game = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const v = readVillage(readFileSync(new URL('./fixtures/village-mb.json', import.meta.url), 'utf8'));
const r = analyze(v, game);
const t0 = v.timestamp * 1000;
const group = (k) => r.groups.find((g) => g.key === k);

test('Belegung: Heimatdorf 5/5, Nachtdorf 3/3 (zwei Roboter + Meisterbauarbeiter im Heimatdorf)', () => {
  assert.equal(group('home_builders').items.length, 5);
  assert.equal(group('home_builders').slots, 5);
  assert.equal(group('builder_builders').items.length, 3);
  assert.equal(group('builder_builders').slots, 3);
  const gear = group('builder_builders').items.find((i) => i.gearUp);
  assert.equal(gear.name, 'Bogenschützenturm');
  assert.equal(gear.master, true);
});

test('Trank-Rest aus dem Export wirkt auf Heimatdorf-Bauarbeiter und den Meisterbauarbeiter, nicht aufs Labor', () => {
  const warden = r.running.find((x) => x.id === 28000002);
  assert.equal(warden.finishAt, boostedFinish(t0 + 169471e3, t0, 10, 9057));
  const gear = r.running.find((x) => x.gearUp);
  assert.equal(gear.finishAt, boostedFinish(t0 + 352760e3, t0, 10, 9057));
  const witch = r.running.find((x) => x.id === 4000042);
  assert.equal(witch.finishAt, t0 + 372347e3);
});

test('Uhrenturm beschleunigt nicht den Gear-Up im Heimatdorf, ein Bauarbeitertrank schon', () => {
  const gear = r.running.find((x) => x.gearUp);
  const tower = applyBoosts(r.running, [{ type: 'clockTower', at: t0 + 3 * 3600e3 }], game, v).running.find((x) => x.gearUp);
  assert.equal(tower.finishAt, gear.finishAt);
  const potion = applyBoosts(r.running, [{ type: 'builderPotion', at: t0 + 3 * 3600e3 }], game, v).running.find((x) => x.gearUp);
  assert.ok(potion.finishAt < gear.finishAt);
});

test('Plan: Luftabwehr startet, wenn der erste Heimatdorf-Bauarbeiter frei wird (Großer Wächter)', () => {
  const step = nextStep(v, [], 1000012, 11);
  const slots = { home_builders: 5, lab: 1, pets: 0, builder_builders: 3, star_lab: 1 };
  const s = simulate(v, game, [step], r.running, slots, { now: t0 });
  const firstHome = Math.min(...group('home_builders').items.map((i) => i.finishAt));
  assert.equal(s.steps[0].start, firstHome);
  assert.equal(firstHome, r.running.find((x) => x.id === 28000002).finishAt);
});

test('Fortschritt: Bogenschützenturm 15 gilt nicht als "im Upgrade auf 16"; Gear-Up läuft', () => {
  const b = progress(v, game).home.categories.find((c) => c.key === 'buildings');
  const archer = b.items.find((i) => i.id === 1000009) || b.doneItems.find((i) => i.id === 1000009);
  assert.ok(archer.levels.includes(15));
  assert.ok(!archer.levels.includes(16));
  const cand = gearCandidates(v, game).find((c) => c.id === 1000009);
  assert.equal(cand.gearing, true);
});

test('Fest zugeteilter Laborgehilfe heißt im Export "helper_recurrent"', () => {
  assert.equal(r.running.find((x) => x.id === 26000005).recurrentHelper, true);
});

test('Gear-Up Minenwerfer: erst wenn der Multimörser seinen Ausbau auf 7 beendet hat', () => {
  const slots = { home_builders: 5, lab: 1, pets: 0, builder_builders: 3, star_lab: 1 };
  const s = simulate(v, game, [{ kind: 'gear', id: 1000013 }], r.running, slots, { now: t0 });
  assert.ok(s.steps[0].start >= t0 + 585209e3);
});
