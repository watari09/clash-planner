import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVillage, analyze } from '../src/village.js';
import { nextStep, simulate } from '../src/planner.js';
import { dashboard } from '../src/dashboard.js';

const game = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const village = readVillage(readFileSync(new URL('./fixtures/village-full.json', import.meta.url), 'utf8'));
const r = analyze(village, game);
const now = village.timestamp * 1000;
const slots = { home_builders: 5, lab: 1, pets: 0, builder_builders: 3, star_lab: 1 };

test('ohne Plan: nächste Fertigstellungen, kein Folge-Upgrade, nichts bereitzulegen', () => {
  const d = dashboard(r.running, simulate(village, game, [], r.running, slots, { now }), slots, { now });
  assert.equal(d.planned, false);
  assert.equal(d.upcoming[0].name, 'Multimörser');
  assert.equal(d.upcoming[0].next, null);
  assert.deepEqual(d.prepare, {});
  assert.equal(d.free.length, 0);
});

test('mit Plan: Folge-Upgrade auf dem frei werdenden Platz und Ressourcen zum Bereitlegen', () => {
  const p1 = nextStep(village, [], 1000008, 19); // Kanone → nächster freier Heimatdorf-Bauarbeiter
  const sim = simulate(village, game, [p1], r.running, slots, { now });
  const d = dashboard(r.running, sim, slots, { now, horizon: 24 * 3600e3 });
  const xbow = d.upcoming.find((u) => u.id === 1000021 && u.finishAt === now + 40011e3);
  assert.equal(xbow.next.name, 'Kanone');
  assert.equal(d.prepare.Gold, game.items['1000008'].levels[9][2]);
  assert.equal(d.planned, true);
});

test('freier Platz: geplantes Upgrade startet sofort', () => {
  const s2 = { ...slots, builder_builders: 4 }; // ein Nachtdorf-Platz frei
  const step = nextStep(village, [], 1000035, 9); // ein Nachtdorf-Gebäude, das gerade nicht ausgebaut wird
  const sim = simulate(village, game, [step], r.running, s2, { now });
  const d = dashboard(r.running, sim, s2, { now });
  assert.equal(d.free.length, 1);
  assert.equal(d.free[0].group, 'builder_builders');
  assert.equal(d.free[0].next?.id, 1000035);
});
