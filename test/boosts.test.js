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

import { helperDay, recurrentFinish, WORK_DAY } from '../src/boosts.js';

test('Arbeitstag: gemeinsamer 23-h-Tag, jeder Helfer einmal pro Tag (Beispiel von Supercell)', () => {
  const t = 1e12;
  // alle bereit; Lehrling startet den Arbeitstag
  let d = helperDay(t, t, [{ type: 'builderApprentice', at: t }]);
  assert.equal(d.dayEnd, t + WORK_DAY);
  assert.equal(d.readyAt('builderApprentice'), t + WORK_DAY);
  assert.equal(d.readyAt('labAssistant'), 0); // darf im selben Arbeitstag noch arbeiten
  // 4 h später Laborgehilfe: Arbeitstag läuft weiter, endet unverändert
  d = helperDay(t, t, [{ type: 'builderApprentice', at: t }, { type: 'labAssistant', at: t + 4 * H }]);
  assert.equal(d.dayEnd, t + WORK_DAY);
  assert.equal(d.readyAt('labAssistant'), t + WORK_DAY);
  // nach Ende des Arbeitstags beginnt mit dem nächsten Einsatz ein neuer
  d = helperDay(t, t, [{ type: 'builderApprentice', at: t }, { type: 'builderApprentice', at: t + 30 * H }]);
  assert.equal(d.dayEnd, t + 30 * H + WORK_DAY);
});

test('Arbeitstag laut Export läuft noch: vorsichtig beide Helfer als eingesetzt', () => {
  const d = helperDay(t0, t0 + 44982e3, []);
  assert.equal(d.readyAt('builderApprentice'), t0 + 44982e3);
  assert.equal(d.readyAt('labAssistant'), t0 + 44982e3);
});

test('Fest zugeteilt: jeden Arbeitstag 1 h extra, bis fertig', () => {
  // 100 h Rest, Helfer 4-fach → spart 3 h pro Arbeitstag
  const f = recurrentFinish(t0 + 100 * H, t0, 4, 3600);
  // Arbeitstage bei 0, 23, 46, 69 h → 4 × 3 h = 12 h gespart, fertig bei 88 h (der Tag ab 92 h kommt zu spät)
  assert.equal(f, t0 + 88 * H);
});

test('Fest zugeteilt im Export (recurrent_helper) macht den Großen Wächter früher fertig', () => {
  const v = structuredClone(village);
  v.heroes.find((h) => h.data === 28000002).recurrent_helper = true;
  const w = analyze(v, game).running.find((x) => x.id === 28000002);
  // Rest 110355 s; erster Arbeitstag beginnt nach 44982 s, Lehrling Stufe 3 → 3 h je Tag
  assert.equal(w.finishAt, recurrentFinish(t0 + 110355e3, t0 + 44982e3, 4, 3600));
  assert.equal(w.finishAt, t0 + 110355e3 - 3 * H); // nur ein Arbeitstag fällt in die ~30,7 h Restzeit
});

test('Eingetragener Lehrling "fest zuteilen" wirkt auch an den Folgetagen', () => {
  const v = structuredClone(village);
  v.helpers.forEach((h) => { h.helper_cooldown = 0; }); // alle bereit
  const r2 = analyze(v, game);
  const warden = r2.running.find((x) => x.id === 28000002);
  const once = applyBoosts(r2.running, [{ type: 'builderApprentice', at: t0, target: runningKey(warden) }], game, v);
  const daily = applyBoosts(r2.running, [{ type: 'builderApprentice', at: t0, target: runningKey(warden), recurrent: true }], game, v);
  const f1 = once.running.find((x) => x.id === 28000002).finishAt;
  const f2 = daily.running.find((x) => x.id === 28000002).finishAt;
  assert.equal(f1, warden.finishAt - 3 * H);
  assert.equal(f2, warden.finishAt - 3 * H - 3 * H); // + ein weiterer Arbeitstag nach 23 h (Rest war ~30 h)
});

test('Zwei Bauarbeitertränke gleichzeitig: verlängern auf 2 h statt doppelt zu zählen', () => {
  // Upgrade mit 15 h Rest: richtig ist 10-fach für 2 h → fertig nach 1,5 h
  const run = [{ id: 1, level: 2, group: 'home_builders', finishAt: t0 + 15 * H }];
  const { running } = applyBoosts(run, [{ type: 'builderPotion', at: t0 }, { type: 'builderPotion', at: t0 }], game, village);
  assert.equal(running[0].finishAt, t0 + 1.5 * H);
  // 30 h Rest: 2 h × 9 h gespart
  const long = [{ id: 1, level: 2, group: 'home_builders', finishAt: t0 + 30 * H }];
  assert.equal(applyBoosts(long, [{ type: 'builderPotion', at: t0 }, { type: 'builderPotion', at: t0 + 0.5 * H }], game, village).running[0].finishAt, t0 + 12 * H);
  // nach Ablauf des ersten wieder ein eigener Zeitraum
  const later = applyBoosts(long, [{ type: 'builderPotion', at: t0 }, { type: 'builderPotion', at: t0 + 5 * H }], game, village).running[0].finishAt;
  assert.equal(later, t0 + 12 * H);
});

test('Forschungstrank: zwei gleichzeitig = 24-fach für 2 h, nicht doppelt gezählt', () => {
  const run = [{ id: 1, level: 2, group: 'lab', finishAt: t0 + 30 * H }];
  const { running } = applyBoosts(run, [{ type: 'researchPotion', at: t0 }, { type: 'researchPotion', at: t0 }], game, village);
  assert.equal(running[0].finishAt, t0 + 1.25 * H); // 30 h Arbeit / 24 = 1,25 h < 2 h Boost
});
