// Upgrade-Planer: geplante Upgrades auf Bauarbeiter/Labore verteilen und daraus
// Start-/Endzeiten und den Ressourcen-Bedarf über die Zeit berechnen. Reine Funktionen.

import { levelEntry, levelTimer, isGearing } from './village.js';

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

/** Gear-Up-fähige Heimatdorf-Gebäude mit Stand der Voraussetzungen. */
export function gearCandidates(village, game, lang = 'de') {
  const top = (list, id) => Math.max(0, ...(list || []).filter((e) => e.data === id).map((e) => (e.lvl || 0) + (typeof levelTimer(e) === 'number' ? 1 : 0)));
  return Object.entries(game.items).filter(([, it]) => it.gearUp).map(([id, it]) => {
    const g = it.gearUp;
    const geared = (village.buildings || []).some((e) => e.data === Number(id) && e.gear_up);
    const gearing = (village.buildings || []).some((e) => e.data === Number(id) && isGearing(e));
    const owned = (village.buildings || []).some((e) => e.data === Number(id));
    return {
      id: Number(id),
      name: it.name[lang] || it.name.en,
      geared,
      gearing, // läuft gerade (Meisterbauarbeiter)
      owned,
      homeLevel: top(village.buildings, Number(id)),
      needHome: g.from,
      bbLevel: top(village.buildings2, g.requires),
      // Ist die Nachtdorf-Voraussetzung erst mit einem laufenden Ausbau erfüllt: ab wann?
      bbReadyAt: Math.max(0, ...(village.buildings2 || [])
        .filter((e) => e.data === g.requires && typeof e.timer === 'number' && (e.lvl || 0) + 1 >= g.requiresLevel && (e.lvl || 0) < g.requiresLevel)
        .map((e) => (village.timestamp + e.timer) * 1000)),
      needBB: g.requiresLevel,
      bbName: game.items[String(g.requires)]?.name[lang],
      seconds: g.sec,
      cost: { [g.resource]: g.cost },
    };
  }).filter((c) => c.owned);
}

/** Nächste Ausrüstungs-Stufe für den Plan (Ausrüstung braucht keinen Bauarbeiter, nur Erz). */
export function nextEquipStep(village, plan, id, max) {
  let lvl = (village.equipment || []).find((e) => e.data === id)?.lvl;
  if (lvl === undefined) return null; // nicht freigeschaltet
  for (const e of plan) if (e.kind === 'equip' && e.id === id) lvl = Math.max(lvl, e.to);
  return lvl < max ? { kind: 'equip', id, to: lvl + 1 } : null;
}

/** Liste der Exemplare je Objekt aus dem Export. Laufende Upgrades zählen schon als Zielstufe. */
function instances(village) {
  const out = {};
  const sections = ['buildings', 'traps', 'heroes', 'units', 'spells', 'siege_machines', 'pets',
    'buildings2', 'traps2', 'heroes2', 'units2'];
  for (const s of sections) {
    for (const e of village[s] || []) {
      const lvl = (e.lvl || 0) + (typeof levelTimer(e) === 'number' ? 1 : 0);
      for (let i = 0; i < (e.cnt || 1); i++) (out[e.data] ||= []).push(lvl);
    }
  }
  return out;
}

/**
 * Exemplare eines Objekts mit Stufe laut Export und Stufe nach dem Plan, absteigend sortiert.
 * Exemplare gleicher Stufe sind im Spiel gleichwertig; Plan-Einträge werden der Reihe nach angewendet.
 */
export function planInstances(village, plan, id, missing = 0) {
  const list = [
    ...(instances(village)[id] || []).map((lvl) => ({ start: lvl, level: lvl })),
    ...Array.from({ length: missing }, () => ({ start: 0, level: 0 })),
  ];
  for (const e of plan) {
    if (e.id !== id || e.kind) continue;
    // bevorzugt ein Exemplar, das schon im Plan weitergestuft wurde (eine Kette bleibt am selben Exemplar)
    const cand = list.filter((x) => x.level === e.to - 1).sort((a, b) => (b.level - b.start) - (a.level - a.start))[0];
    if (cand) cand.level = e.to;
  }
  return list.sort((a, b) => b.level - a.level || b.start - a.start);
}

/**
 * Nächster Plan-Eintrag für ein Objekt. Ohne `from`: das niedrigste Exemplar eine Stufe höher.
 * Mit `from`: gezielt ein Exemplar, das (nach dem Plan) auf Stufe `from` steht – z. B. um eine
 * bestimmte Doppelkanone hochzuziehen. null, wenn nichts mehr bis `max` zu planen ist.
 */
export function nextStep(village, plan, id, max, missing = 0, from) {
  const levels = planInstances(village, plan, id, missing).map((x) => x.level);
  const base = from ?? Math.min(...levels);
  if (!levels.length || !levels.includes(base) || base >= max) return null;
  const to = base + 1;
  // n = das wievielte Exemplar auf Stufe `to` dieser Eintrag ergibt – daran erkennt man später, ob er erledigt ist
  return { id, to, n: levels.filter((l) => l >= to).length + 1 };
}

/**
 * Wendet einen Plan-Eintrag auf die Exemplare an (Objekte { lvl, readyAt }).
 * Nimmt das Exemplar auf Stufe to-1, das am frühesten verfügbar ist.
 * Liefert das Exemplar oder 'done' (schon erledigt) bzw. 'blocked'.
 */
function bump(list, to) {
  const cand = list.filter((x) => x.lvl === to - 1).sort((a, b) => a.readyAt - b.readyAt)[0];
  if (cand) return cand;
  return list.some((x) => x.lvl < to - 1) ? 'blocked' : 'done';
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
export const HOME_GROUPS = new Set(['home_builders', 'lab', 'pets']);

export function simulate(village, game, plan, running, slots, options = {}) {
  const { now = Date.now(), lang = 'de' } = options;
  // Goldpass-Rabatt gilt nur im Heimatdorf (Bauarbeiter, Labor, Begleiterhaus) – nicht im Nachtdorf, nicht für Erz
  const homeOnly = (f = 1) => (g) => (HOME_GROUPS.has(g) ? f : 1);
  const tf = homeOnly(options.timeFactor);
  const cf = homeOnly(options.costFactor);
  const exported = instances(village);
  // Exemplare mit Zeitpunkt, ab dem sie weiter ausgebaut werden können (laufende: erst wenn fertig)
  const levels = {};
  for (const [id, lvls] of Object.entries(exported)) {
    const runs = running.filter((r) => String(r.id) === id && !r.gearUp).map((r) => ({ level: r.level, at: r.finishAt }));
    levels[id] = lvls.map((lvl) => {
      const i = runs.findIndex((x) => x.level === lvl);
      const readyAt = i >= 0 ? runs.splice(i, 1)[0].at : now;
      return { lvl, readyAt };
    });
  }
  const free = {};
  for (const [g, n] of Object.entries(slots)) {
    const busy = running.filter((r) => r.group === g && r.finishAt > now).map((r) => r.finishAt);
    free[g] = [...busy, ...Array(Math.max(0, n - busy.length)).fill(now)].sort((a, b) => a - b);
  }

  const steps = [];
  const dropped = []; // erledigt oder nicht (mehr) möglich
  const equipLevels = new Map((village.equipment || []).map((x) => [x.data, x.lvl || 1]));
  const gearCands = new Map(gearCandidates(village, game, lang).map((c) => [c.id, c]));
  for (const [index, e] of plan.entries()) {
    const item = game.items[String(e.id)];
    if (e.kind === 'equip') {
      const cur = equipLevels.get(e.id);
      if (!item || cur === undefined) { dropped.push({ ...e, index, reason: 'unknown' }); continue; }
      if (cur >= e.to) { dropped.push({ ...e, index, reason: 'done' }); continue; }
      if (cur !== e.to - 1) { dropped.push({ ...e, index, reason: 'blocked' }); continue; }
      equipLevels.set(e.id, e.to);
      const costs = Object.fromEntries(Object.entries(item.ore?.[e.to - 1] || {}).map(([r, n]) => [r, n]));
      steps.push({ index, id: e.id, kind: 'equip', group: 'equipment', name: item.name[lang] || item.name.en, from: e.to - 1, to: e.to, start: now, end: now, costs });
      continue;
    }
    if (e.kind === 'gear') {
      const c = gearCands.get(e.id);
      if (!item || !c) { dropped.push({ ...e, index, reason: 'unknown' }); continue; }
      if (c.geared || c.gearing) { dropped.push({ ...e, index, reason: 'done' }); continue; }
      if (c.homeLevel < c.needHome || c.bbLevel < c.needBB) { dropped.push({ ...e, index, reason: 'blocked', gear: c }); continue; }
      const queue = free.builder_builders;
      if (!queue?.length) { dropped.push({ ...e, index, reason: 'unknown' }); continue; }
      const start = Math.max(queue.shift(), now, c.bbReadyAt || 0);
      const end = start + Math.round(c.seconds * tf('builder_builders')) * 1000;
      queue.push(end);
      queue.sort((a, b) => a - b);
      const costs = Object.fromEntries(Object.entries(c.cost).map(([r, n]) => [r, Math.round(n * cf('builder_builders'))]));
      steps.push({ index, id: e.id, kind: 'gear', group: 'builder_builders', name: c.name, start, end, costs });
      continue;
    }
    const group = item && groupOf(item);
    if (!item || !group || !free[group]?.length) { dropped.push({ ...e, index, reason: 'unknown' }); continue; }
    if (e.n && (exported[e.id] || []).filter((l) => l >= e.to).length >= e.n) {
      dropped.push({ ...e, index, reason: 'done' }); // laut Export schon erreicht bzw. läuft
      continue;
    }
    const lv = (levels[e.id] ||= []);
    if (e.to === 1 && !lv.some((x) => x.lvl === 0)) lv.push({ lvl: 0, readyAt: now }); // neues, noch nicht gebautes Exemplar
    const inst = bump(lv, e.to);
    if (typeof inst === 'string') { dropped.push({ ...e, index, reason: 'blocked' }); continue; }

    const [, sec, cost, res] = levelEntry(item, e.to) || [0, 0, 0, ''];
    const queue = free[group];
    // frühestens, wenn ein Platz frei ist UND dieses Exemplar nicht mehr im Ausbau steckt
    const start = Math.max(queue.shift(), inst.readyAt, now);
    const end = start + Math.round(sec * tf(group)) * 1000;
    queue.push(end);
    queue.sort((a, b) => a - b);
    inst.lvl = e.to;
    inst.readyAt = end;
    steps.push({
      index,
      id: e.id,
      group,
      name: item.name[lang] || item.name.en,
      from: e.to - 1,
      to: e.to,
      start,
      end,
      costs: res === 'Diamonds' || !cost ? {} : { [res]: Math.round(cost * cf(group)) },
    });
  }

  // Ressourcen-Bedarf in zeitlicher Reihenfolge, mit laufender Summe je Ressource
  const needs = [...steps].sort((a, b) => a.start - b.start || a.index - b.index);
  const total = {};
  for (const s of needs) {
    for (const [r, n] of Object.entries(s.costs)) total[r] = (total[r] || 0) + n;
    s.cumulative = { ...total };
  }
  return { steps, needs, total, dropped };
}

/** Entfernt erledigte und unbekannte Einträge; blockierte bleiben (z. B. falsche Reihenfolge). */
export function cleanPlan(plan, dropped) {
  const remove = new Set(dropped.filter((d) => d.reason !== 'blocked').map((d) => d.index));
  return plan.filter((_, i) => !remove.has(i));
}
