// Upgrade-Planer: geplante Upgrades auf Bauarbeiter/Labore verteilen und daraus
// Start-/Endzeiten und den Ressourcen-Bedarf über die Zeit berechnen. Reine Funktionen.

import { levelEntry } from './village.js';

/** Wer ein Upgrade ausführt – dieselben Gruppen wie bei den laufenden Upgrades. */
export function groupOf(item) {
  const bb = item.village === 'builder';
  switch (item.kind) {
    case 'building':
    case 'trap':
    case 'hero':
      return bb ? 'builder_builders' : 'home_builders';
    case 'troop':
    case 'spell':
      return bb ? 'star_lab' : 'lab';
    case 'pet':
      return 'pets';
    default:
      return null;
  }
}

/** Liste der Exemplare je Objekt aus dem Export. Laufende Upgrades zählen schon als Zielstufe. */
function instances(village) {
  const out = {};
  const sections = ['buildings', 'traps', 'heroes', 'units', 'spells', 'siege_machines', 'pets',
    'buildings2', 'traps2', 'heroes2', 'units2'];
  for (const s of sections) {
    for (const e of village[s] || []) {
      const lvl = (e.lvl || 0) + (typeof e.timer === 'number' ? 1 : 0);
      for (let i = 0; i < (e.cnt || 1); i++) (out[e.data] ||= []).push(lvl);
    }
  }
  return out;
}

/**
 * Nächster sinnvoller Plan-Eintrag für ein Objekt: das niedrigste Exemplar eine Stufe höher,
 * unter Berücksichtigung dessen, was schon im Plan steht. null, wenn alles bis `max` verplant ist.
 */
export function nextStep(village, plan, id, max, missing = 0) {
  const levels = [...(instances(village)[id] || []), ...Array(missing).fill(0)];
  for (const e of plan) if (e.id === id) bump(levels, e.to);
  levels.sort((a, b) => a - b);
  const low = levels[0];
  if (low === undefined || low >= max) return null;
  const to = low + 1;
  // n = das wievielte Exemplar auf Stufe `to` dieser Eintrag ergibt – daran erkennt man später, ob er erledigt ist
  return { id, to, n: levels.filter((l) => l >= to).length + 1 };
}

/** Wendet einen Plan-Eintrag auf die Exemplare an. Liefert 'ok', 'done' (schon erledigt) oder 'blocked'. */
function bump(levels, to) {
  const i = levels.indexOf(to - 1);
  if (i >= 0) { levels[i] = to; return 'ok'; }
  return levels.some((l) => l < to - 1) ? 'blocked' : 'done';
}

/**
 * Simuliert den Plan.
 * @param village  Dorf-Export
 * @param game     Spieldaten
 * @param plan     [{ id, to }] in gewünschter Reihenfolge
 * @param running  analyze(...).running – belegte Plätze und wann sie frei werden
 * @param slots    { gruppe: Anzahl Plätze }
 * @param options  { now, timeFactor, costFactor, lang }
 */
export function simulate(village, game, plan, running, slots, options = {}) {
  const { now = Date.now(), timeFactor = 1, costFactor = 1, lang = 'de' } = options;
  const exported = instances(village);
  const levels = structuredClone(exported);
  const free = {};
  for (const [g, n] of Object.entries(slots)) {
    const busy = running.filter((r) => r.group === g && r.finishAt > now).map((r) => r.finishAt);
    free[g] = [...busy, ...Array(Math.max(0, n - busy.length)).fill(now)].sort((a, b) => a - b);
  }

  const steps = [];
  const dropped = []; // erledigt oder nicht (mehr) möglich
  for (const [index, e] of plan.entries()) {
    const item = game.items[String(e.id)];
    const group = item && groupOf(item);
    if (!item || !group || !free[group]?.length) { dropped.push({ ...e, index, reason: 'unknown' }); continue; }
    if (e.n && (exported[e.id] || []).filter((l) => l >= e.to).length >= e.n) {
      dropped.push({ ...e, index, reason: 'done' }); // laut Export schon erreicht bzw. läuft
      continue;
    }
    const lv = (levels[e.id] ||= []);
    if (e.to === 1 && !lv.includes(0)) lv.push(0); // neues, noch nicht gebautes Exemplar
    if (bump(lv, e.to) !== 'ok') { dropped.push({ ...e, index, reason: 'blocked' }); continue; }

    const [, sec, cost, res] = levelEntry(item, e.to) || [0, 0, 0, ''];
    const queue = free[group];
    const start = Math.max(queue.shift(), now);
    const end = start + Math.round(sec * timeFactor) * 1000;
    queue.push(end);
    queue.sort((a, b) => a - b);
    steps.push({
      index,
      id: e.id,
      group,
      name: item.name[lang] || item.name.en,
      from: e.to - 1,
      to: e.to,
      start,
      end,
      cost: res === 'Diamonds' ? 0 : Math.round(cost * costFactor),
      resource: res,
    });
  }

  // Ressourcen-Bedarf in zeitlicher Reihenfolge, mit laufender Summe je Ressource
  const needs = [...steps].sort((a, b) => a.start - b.start || a.index - b.index);
  const total = {};
  for (const s of needs) {
    if (s.cost) total[s.resource] = (total[s.resource] || 0) + s.cost;
    s.cumulative = { ...total };
  }
  return { steps, needs, total, dropped };
}

/** Entfernt erledigte und unbekannte Einträge; blockierte bleiben (z. B. falsche Reihenfolge). */
export function cleanPlan(plan, dropped) {
  const remove = new Set(dropped.filter((d) => d.reason !== 'blocked').map((d) => d.index));
  return plan.filter((_, i) => !remove.has(i));
}
