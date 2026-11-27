// Gemeinsame Auswertung für Seite und Widget: Export + eingetragene Boosts → laufende Upgrades,
// Helfer-Bereitschaft, Uhrenturm; Plätze je Gruppe. Ohne DOM und ohne localStorage.

import { applyBoosts, helperDay, BOOST_TYPES } from './boosts.js';

/** Boost-Einträge (nach dem Export) auf die Auswertung anwenden. Verändert `r`. */
export function applyEvents(r, events, game, village) {
  const { running, applied } = applyBoosts(r.running, events, game, village);
  r.running = running;
  for (const g of r.groups) g.items = running.filter((x) => x.group === g.key);
  r.boosts = applied;
  // Gemeinsamer 23-h-Arbeitstag der Helfer; jeder Helfer einmal pro Arbeitstag
  const day = helperDay(r.exportedAt, r.helpers[0]?.readyAt ?? r.exportedAt, events);
  r.helperDayEnd = day.dayEnd;
  for (const h of r.helpers) {
    const type = Object.keys(BOOST_TYPES).find((k) => BOOST_TYPES[k].helper === h.id);
    if (type) h.readyAt = day.readyAt(type);
  }
  const tower = applied.filter((a) => a.type === 'clockTower').at(-1);
  if (tower) r.clockTowerReadyAt = Math.max(r.clockTowerReadyAt || 0, tower.at + game.boosts.clockTower.cooldown * 1000);
  return r;
}

/** Plätze je Gruppe: Schätzung bzw. eigene Angabe, mindestens so viele wie gerade laufen. */
export function slotsByGroup(r, now, overrides = {}) {
  return Object.fromEntries(r.groups.map((g) => [
    g.key,
    Math.max(overrides[g.key] ?? g.slots, g.items.filter((i) => i.finishAt > now).length),
  ]));
}
