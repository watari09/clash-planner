import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heroAvailability } from '../src/heroes.js';

const game = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const H = 3600e3;
const now = 1_000_000_000_000;
const village = { heroes: [{ data: 28000000, lvl: 60 }, { data: 28000001, lvl: 60 }, { data: 28000002, lvl: 30 }] };
const running = [{ id: 28000000, section: 'heroes', level: 61, finishAt: now + 10 * H }];

test('Helden: bereit-Zeit inkl. direkt anschließender geplanter Stufe', () => {
  const steps = [{ id: 28000000, start: now + 10 * H, end: now + 30 * H, to: 62 }];
  const { heroes, overlaps } = heroAvailability(village, game, running, steps, now);
  const king = heroes.find((h) => h.id === 28000000);
  assert.equal(king.readyAt, now + 30 * H);
  assert.equal(heroes.find((h) => h.id === 28000001).readyAt, now);
  assert.deepEqual(overlaps, []);
});

test('Helden: Warnung, wenn zwei gleichzeitig im Ausbau sind', () => {
  const steps = [{ id: 28000001, start: now + 5 * H, end: now + 20 * H, to: 61 }];
  const { overlaps } = heroAvailability(village, game, running, steps, now);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].from, now + 5 * H);
  assert.equal(overlaps[0].to, now + 10 * H);
  assert.deepEqual(overlaps[0].ids.sort(), [28000000, 28000001]);
  assert.equal(overlaps[0].planned, true);
});
