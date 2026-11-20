import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVillage, analyze } from '../src/village.js';
import { nextStep, simulate, cleanPlan, groupOf } from '../src/planner.js';

const game = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const village = readVillage(readFileSync(new URL('./fixtures/village-full.json', import.meta.url), 'utf8'));
const r = analyze(village, game);
const now = village.timestamp * 1000;
const slots = { home_builders: 5, lab: 1, pets: 0, builder_builders: 3, star_lab: 1 };
const H = 3600e3;
const CANNON = 1000008; // Kanone: 3×9, 1×10, 2×11, 1×12 (im Export)

test('nextStep nimmt das niedrigste Exemplar und beachtet den Plan', () => {
  const a = nextStep(village, [], CANNON, 17);
  // 7 Kanonen (9,9,9,10,11,11,12): 4 sind schon ≥ 10, die geplante wird die 5.
  assert.deepEqual(a, { id: CANNON, to: 10, n: 5 });
  const b = nextStep(village, [a], CANNON, 17);
  assert.deepEqual(b, { id: CANNON, to: 10, n: 6 });
  assert.equal(nextStep(village, [], CANNON, 9), null); // bis 9 alles erledigt
});

test('Simulation: Bauarbeiter werden frei, sobald laufende Upgrades fertig sind', () => {
  const plan = [nextStep(village, [], CANNON, 17)];
  const s = simulate(village, game, plan, r.running, slots, { now });
  assert.equal(s.steps.length, 1);
  // alle 5 Bauarbeiter belegt → Start, wenn der erste fertig ist (X-Bogen nach 40011 s)
  assert.equal(s.steps[0].start, now + 40011e3);
  const sec = game.items[String(CANNON)].levels[9][1]; // Stufe 10 erreichen
  assert.equal(s.steps[0].end, s.steps[0].start + sec * 1000);
  assert.equal(s.steps[0].group, 'home_builders');
});

test('Simulation: der nächste Plan geht an den Bauarbeiter, der zuerst frei ist', () => {
  const p1 = nextStep(village, [], CANNON, 17);
  const p2 = nextStep(village, [p1], CANNON, 17);
  const p3 = nextStep(village, [p1, p2], CANNON, 17);
  const s = simulate(village, game, [p1, p2, p3], r.running, slots, { now });
  // Kanone 9→10 dauert nur 4 h: derselbe Bauarbeiter ist früher frei als der Große Wächter fertig wird
  assert.equal(s.steps[1].start, s.steps[0].end);
  assert.equal(s.steps[2].start, s.steps[1].end);
  // mit einem langen Upgrade dazwischen springt der nächste Plan auf den Wächter-Bauarbeiter
  const xbow = { id: 1000021, to: 8, n: 4 }; // 3 X-Bögen sind (inkl. laufender) schon auf 8
  const s2 = simulate(village, game, [xbow, p1], r.running, slots, { now });
  assert.equal(s2.steps[1].start, now + 110355e3);
});

test('Ressourcen-Bedarf: zeitlich sortiert, laufende Summe, Rabatt wirkt', () => {
  const p1 = nextStep(village, [], CANNON, 17);
  const p2 = nextStep(village, [p1], CANNON, 17);
  const full = simulate(village, game, [p1, p2], r.running, slots, { now });
  const cost = game.items[String(CANNON)].levels[9][2];
  assert.equal(full.total.Gold, 2 * cost);
  assert.deepEqual(full.needs.map((n) => n.cumulative.Gold), [cost, 2 * cost]);
  const cheap = simulate(village, game, [p1], r.running, slots, { now, timeFactor: 0.8, costFactor: 0.8 });
  assert.equal(cheap.steps[0].costs.Gold, Math.round(cost * 0.8));
});

test('Labor und Nachtdorf haben eigene Warteschlangen', () => {
  const golem = { id: 4000009, to: 8, n: 1 }; // P.E.K.K.A 7→8 (ID 4000009)
  const s = simulate(village, game, [golem], r.running, slots, { now });
  assert.equal(s.steps[0].group, 'lab');
  assert.equal(s.steps[0].start, now + 330416e3); // Labor frei, wenn der Drache fertig ist
  assert.equal(groupOf(game.items['1000045']), 'builder_builders');
});

test('Erledigte Einträge fallen nach neuem Export raus, falsche Reihenfolge bleibt stehen', () => {
  const done = { id: 1000021, to: 8, n: 1 }; // X-Bogen auf 8: einer ist schon auf 8
  const blocked = { id: CANNON, to: 12, n: 2 }; // keine Kanone auf 11 frei? doch: 2×11 → ok
  const tooEarly = { id: CANNON, to: 11, n: 4 }; // 11 erreichen braucht eine Kanone auf 10 → eine ist da → ok
  const s = simulate(village, game, [done, blocked, tooEarly], r.running, slots, { now });
  assert.deepEqual(s.dropped.map((d) => d.reason), ['done']);
  assert.equal(cleanPlan([done, blocked, tooEarly], s.dropped).length, 2);
});

import { gearCandidates, nextEquipStep } from '../src/planner.js';

test('Gear-Up im Plan: belegt einen Nachtdorf-Bauarbeiter, Voraussetzungen werden geprüft', () => {
  const cands = gearCandidates(village, game);
  const archer = cands.find((c) => c.name === 'Bogenschützenturm');
  const mortar = cands.find((c) => c.name === 'Minenwerfer');
  assert.equal(cands.find((c) => c.name === 'Kanone').geared, true);
  const s = simulate(village, game, [{ kind: 'gear', id: archer.id }, { kind: 'gear', id: mortar.id }, { kind: 'gear', id: CANNON }], r.running, slots, { now });
  assert.equal(s.steps.length, 1);
  assert.equal(s.steps[0].group, 'builder_builders');
  assert.equal(s.steps[0].end - s.steps[0].start, 7 * 86400e3);
  assert.deepEqual(s.steps[0].costs, { Gold: 3000000 });
  assert.deepEqual(s.dropped.map((d) => d.reason), ['blocked', 'done']); // Multimörser erst 6, Kanone schon umgerüstet
});

test('Ausrüstung im Plan: sofort, Erz als Kosten, Stufen nacheinander', () => {
  const puppet = 90000000; // Barbarenpuppe, Stufe 3
  const e1 = nextEquipStep(village, [], puppet, 18);
  const e2 = nextEquipStep(village, [e1], puppet, 18);
  assert.deepEqual([e1.to, e2.to], [4, 5]);
  const s = simulate(village, game, [e1, e2], r.running, slots, { now });
  assert.equal(s.steps[0].start, now);
  assert.deepEqual(s.steps[0].costs, { CommonOre: 400 }); // 3→4
  assert.deepEqual(s.steps[1].costs, { CommonOre: 600 }); // 4→5
  assert.equal(s.total.CommonOre, 1000);
});
