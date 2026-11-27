// Mauer-Rechner: Mauern je Stufe, Kosten bis zum Maximum, Mauerringe und was man sich gerade leisten kann.
// Reine Funktionen; Kosten und Stufen kommen aus den Spieldaten (alt = zweite Bezahl-Möglichkeit).

import { levelEntry, maxLevel } from './village.js';

export const WALL = { home: 1000010, builder: 1000033 };
const HALL = { home: 1000001, builder: 1000034 };
const LIST = { home: 'buildings', builder: 'buildings2' };

/** Ressourcen, mit denen man die Stufe `level` erreichen kann (1. = normale, 2. = alternative). */
export function payWith(item, level) {
  const [, , , res] = levelEntry(item, level) || [];
  const out = res ? [res] : [];
  if (item.alt && level >= item.alt.from && !out.includes(item.alt.res)) out.push(item.alt.res);
  return out;
}

/**
 * Stand der Mauern eines Dorfs.
 * @returns null ohne Mauern, sonst { id, max, total, byLevel: [{ level, count }], missingLevels (= Mauerringe bis Max),
 *          steps: [{ from, to, count, each, total, pay }] je Ausgangsstufe bis Max, totals: { Gold?, Elixir?, … } }
 *   `totals` je Ressource: was alles kosten würde, wenn man nur diese Ressource nutzt (sofern möglich).
 */
export function wallStatus(village, game, which = 'home', costFactor = 1) {
  const id = WALL[which];
  const item = game.items[String(id)];
  const list = village[LIST[which]] || [];
  const hall = Math.max(0, ...list.filter((e) => e.data === HALL[which]).map((e) => e.lvl || 0));
  const counts = new Map();
  for (const e of list) if (e.data === id) counts.set(e.lvl || 0, (counts.get(e.lvl || 0) || 0) + (e.cnt || 1));
  if (!item || !counts.size) return null;
  const max = maxLevel(item, hall);
  const byLevel = [...counts.entries()].map(([level, count]) => ({ level, count })).sort((a, b) => a.level - b.level);
  const steps = [];
  let missingLevels = 0;
  for (const { level, count } of byLevel) {
    if (level >= max) continue;
    missingLevels += (max - level) * count;
    for (let L = level + 1; L <= max; L++) {
      const each = Math.round((levelEntry(item, L)?.[2] || 0) * costFactor);
      steps.push({ from: L - 1, to: L, count, each, total: each * count, pay: payWith(item, L) });
    }
  }
  // gleiche Stufen zusammenfassen (Mauern auf 12 und 13 brauchen beide 13→14)
  const merged = new Map();
  for (const s of steps) {
    const m = merged.get(s.to);
    if (m) { m.count += s.count; m.total += s.total; } else merged.set(s.to, { ...s });
  }
  const totals = {};
  for (const s of merged.values()) for (const r of s.pay) totals[r] = (totals[r] || 0) + s.total;
  // nur Ressourcen, mit denen wirklich ALLE Schritte bezahlbar sind
  for (const r of Object.keys(totals)) if (![...merged.values()].every((s) => s.pay.includes(r))) delete totals[r];
  return {
    id, hall, max, total: byLevel.reduce((n, x) => n + x.count, 0), byLevel, missingLevels,
    steps: [...merged.values()].sort((a, b) => a.to - b.to), totals,
  };
}

/**
 * Wie viele Mauer-Stufen schafft man mit den vorhandenen Ressourcen? Immer die niedrigste Mauer zuerst
 * (so wie man es im Spiel meist macht); bezahlt wird mit der Ressource, von der relativ mehr übrig ist.
 * @param have { Gold: n, Elixir: n } (bzw. Gold2/Elixir2 im Nachtdorf)
 * @returns { upgrades, spent: {res: n}, byLevel: [{level,count}] danach, ringsSaved? }
 */
export function wallAfford(village, game, which, have, costFactor = 1) {
  const st = wallStatus(village, game, which, costFactor);
  if (!st) return null;
  const item = game.items[String(st.id)];
  const left = { ...have };
  const spent = {};
  const levels = new Map(st.byLevel.map((x) => [x.level, x.count]));
  let upgrades = 0;
  for (;;) {
    const low = Math.min(...[...levels.entries()].filter(([, n]) => n > 0).map(([l]) => l));
    if (!(low < st.max)) break;
    const each = Math.round((levelEntry(item, low + 1)?.[2] || 0) * costFactor);
    const options = payWith(item, low + 1).filter((r) => (left[r] || 0) >= each);
    if (!options.length) break;
    const r = options.sort((a, b) => (left[b] || 0) - (left[a] || 0))[0];
    left[r] -= each;
    spent[r] = (spent[r] || 0) + each;
    levels.set(low, levels.get(low) - 1);
    levels.set(low + 1, (levels.get(low + 1) || 0) + 1);
    upgrades += 1;
  }
  return {
    upgrades, spent, left,
    byLevel: [...levels.entries()].filter(([, n]) => n > 0).map(([level, count]) => ({ level, count })).sort((a, b) => a.level - b.level),
  };
}
