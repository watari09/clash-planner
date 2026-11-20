import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readVillage, analyze } from '../src/village.js';
import { boostedFinish, boostEffect, applyBoosts, runningKey } from '../src/boosts.js';

const game = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const village = readVillage(readFileSync(new URL('./fixtures/village-full.json', import.meta.url), 'utf8'));
const r = analyze(village, game);
const t0 = village.timestamp * 1000;
const H = 3600e3;

test('Boost-Rechnung: lange Restzeit verkürzt sich um (x-1) × Dauer', () => {
  assert.equal(boostedFinish(t0 + 20 * H, t0, 10, 3600), t0 + 11 * H);
});

test('Boost-Rechnung: wird es während des Boosts fertig, zählt nur der nötige Teil', () => {
  // 5 h Rest, 10-fach → nach 30 min fertig
  assert.equal(boostedFinish(t0 + 5 * H, t0, 10, 3600), t0 + 0.5 * H);
  assert.equal(boostedFinish(t0 - H, t0, 10, 3600), t0 - H); // schon fertig: unverändert
});

test('Werte aus den Spieldaten', () => {
  assert.deepEqual(boostEffect('builderPotion', game, village), { mult: 10, sec: 3600 });
  assert.deepEqual(boostEffect('researchPotion', game, village), { mult: 24, sec: 3600 });
  assert.deepEqual(boostEffect('builderApprentice', game, village), { mult: 4, sec: 3600 }); // Lehrling Stufe 3
  assert.deepEqual(boostEffect('clockTower', game, village), { mult: 10, sec: 28 * 60 }); // Uhrenturm Stufe 8
});

test('Bauarbeitertrank wirkt auf alle Heimatdorf-Bauarbeiter, nicht aufs Labor', () => {
  const { running } = applyBoosts(r.running, [{ type: 'builderPotion', at: t0 }], game, village);
  const xbow = running.find((x) => x.id === 1000021 && x.originalFinishAt === t0 + 40011e3);
  assert.equal(xbow.finishAt, t0 + 40011e3 - 9 * H);
  const dragon = running.find((x) => x.id === 4000008);
  assert.equal(dragon.finishAt, dragon.originalFinishAt);
});

test('Lehrling wirkt nur auf das gewählte Upgrade', () => {
  const warden = r.running.find((x) => x.id === 28000002);
  const { running, applied } = applyBoosts(r.running, [{ type: 'builderApprentice', at: t0, target: runningKey(warden) }], game, village);
  assert.equal(running.find((x) => x.id === 28000002).finishAt, warden.finishAt - 3 * H);
  assert.equal(applied[0].saved, 3 * H);
});

test('Uhrenturm wirkt auf Nachtdorf-Bauarbeiter und Sternlabor', () => {
  const { applied } = applyBoosts(r.running, [{ type: 'clockTower', at: t0 }], game, village);
  // 4 laufende Nachtdorf-Upgrades × 9 × 28 min
  assert.equal(applied[0].saved, 4 * 9 * 28 * 60e3);
});

test('Boosts vor dem Export-Zeitpunkt werden ignoriert', () => {
  const { applied } = applyBoosts(r.running, [{ type: 'builderPotion', at: t0 - 1 }], game, village);
  assert.equal(applied.length, 0);
});

import { helperReadyAt } from '../src/boosts.js';

test('Helfer nach Einsatz: wieder bereit zur gleichen Uhrzeit am nächsten Tag', () => {
  const ready = t0 + 44982e3; // laut Export
  assert.equal(helperReadyAt(ready, []), ready);
  assert.equal(helperReadyAt(ready, [ready + 2 * H]), ready + 24 * H);
  assert.equal(helperReadyAt(ready, [ready + 30 * H]), ready + 48 * H);
  assert.equal(helperReadyAt(ready, [ready - H]), ready); // noch in der Abklingzeit
});
