// B.O.B.s Zentrale: Aufgaben für den 6. Bauarbeiter im Heimatdorf und der kürzeste Weg dorthin.
// Reine Funktionen; Aufgaben und Werte kommen aus den Spieldaten (game.bob, gearUp, Stufen).

import { levelEntry, maxLevel, schedule, levelTimer, isGearing } from './village.js';

export const TASK_TEXT = {
  GearUp: { de: 'Verteidigungen im Heimatdorf umrüsten (Gear-Up)', en: 'Gear up defenses in the Home Village' },
  HighestBuilderTroopLevel: { de: 'Eine Nachtdorf-Truppe auf Stufe', en: 'Upgrade any Builder Base troop to level' },
  HighestBuilderDefenceLevel: { de: 'Eine Nachtdorf-Verteidigung auf Stufe', en: 'Upgrade any Builder Base defense to level' },
  TotalBuilderHeroLevels: { de: 'Summe der Nachtdorf-Helden-Stufen', en: 'Combined Builder Base hero levels' },
};

const BUILDER_HALL = 1000034;
const STAR_LAB = 1000046;

/** Exemplare aus einer Export-Liste; laufende Upgrades zählen als Zielstufe. */
function instances(list) {
  const out = [];
  for (const e of list || []) {
    const lvl = (e.lvl || 0) + (typeof levelTimer(e) === 'number' ? 1 : 0);
    // ein laufender Gear-Up zählt für die Aufgabe schon mit
    for (let i = 0; i < (e.cnt || 1); i++) out.push({ id: e.data, lvl, gearUp: !!e.gear_up || isGearing(e) });
  }
  return out;
}

/** Zeit und Kosten, um ein Objekt von `from` auf `to` zu bringen (oder null, wenn die Grenze `cap` das verhindert). */
function path(item, from, to, cap) {
  if (to > maxLevel(item, cap)) return null;
  let seconds = 0;
  const cost = {};
  for (let L = from + 1; L <= to; L++) {
    const [, sec, c, res] = levelEntry(item, L) || [0, 0, 0, ''];
    seconds += sec;
    if (c && res !== 'Diamonds') cost[res] = (cost[res] || 0) + c;
  }
  return { seconds, cost };
}

const addCost = (a, b) => { for (const [r, n] of Object.entries(b)) a[r] = (a[r] || 0) + n; return a; };

/**
 * Stand und kürzester Weg zu B.O.B.
 * @returns {{ control, tasks: [...], totals, blocked }} – je Aufgabe current/target/done und der günstigste Weg.
 */
export function bobStatus(village, game, lang = 'de') {
  const b2 = instances(village.buildings2);
  const bh = Math.max(0, ...b2.filter((x) => x.id === BUILDER_HALL).map((x) => x.lvl));
  const starLabCap = maxLevel(game.items[String(STAR_LAB)], bh);
  const name = (id) => game.items[String(id)]?.name[lang] || `#${id}`;
  const controlId = game.bob.control;
  const controlLevel = Math.max(0, ...b2.filter((x) => x.id === controlId).map((x) => x.lvl));

  const tasks = [];
  const bbChains = []; // Nachtdorf-Bauarbeiter: je Kette nacheinander
  let labSeconds = 0;
  const gearChains = []; // Gear-Ups: macht der Meisterbauarbeiter, also nacheinander auf einem Nachtdorf-Bauarbeiter
  const homeChains = []; // Vorarbeit im Heimatdorf (Heimatdorf-Bauarbeiter)
  const cost = {};

  for (const t of game.bob.tasks) {
    const task = { type: t.type, target: t.target, current: 0, steps: [], blocked: null };
    if (t.type === 'HighestBuilderDefenceLevel') {
      const defs = b2.filter((x) => game.items[String(x.id)]?.group === 'defense');
      task.current = Math.max(0, ...defs.map((x) => x.lvl));
      if (task.current < t.target) {
        const options = defs.map((x) => ({ x, p: path(game.items[String(x.id)], x.lvl, t.target, bh) })).filter((o) => o.p);
        const best = options.sort((a, c) => a.p.seconds - c.p.seconds)[0];
        if (best) {
          task.steps.push({ id: best.x.id, name: name(best.x.id), from: best.x.lvl, to: t.target, ...best.p });
          bbChains.push(best.p.seconds);
          addCost(cost, best.p.cost);
        } else task.blocked = 'hall';
      }
    } else if (t.type === 'HighestBuilderTroopLevel') {
      const troops = instances(village.units2);
      task.current = Math.max(0, ...troops.map((x) => x.lvl));
      if (task.current < t.target) {
        const options = troops.map((x) => ({ x, p: path(game.items[String(x.id)], x.lvl, t.target, starLabCap) })).filter((o) => o.p);
        const best = options.sort((a, c) => a.p.seconds - c.p.seconds)[0];
        if (best) {
          task.steps.push({ id: best.x.id, name: name(best.x.id), from: best.x.lvl, to: t.target, ...best.p });
          labSeconds += best.p.seconds;
          addCost(cost, best.p.cost);
        } else task.blocked = 'lab';
      }
    } else if (t.type === 'TotalBuilderHeroLevels') {
      const heroes = instances(village.heroes2).map((x) => ({ ...x, start: x.lvl, item: game.items[String(x.id)] }));
      task.current = heroes.reduce((n, x) => n + x.lvl, 0);
      let missing = t.target - task.current;
      // Helden laufen parallel auf verschiedenen Bauarbeitern: jede Stufe dem Helden geben,
      // dessen Kette danach am kürzesten ist (so wird die längste Kette möglichst kurz)
      for (const h of heroes) h.chain = 0;
      while (missing > 0) {
        const next = heroes
          .map((h) => ({ h, e: h.lvl < maxLevel(h.item, bh) ? levelEntry(h.item, h.lvl + 1) : null }))
          .filter((o) => o.e)
          .sort((a, c) => (a.h.chain + a.e[1]) - (c.h.chain + c.e[1]))[0];
        if (!next) { task.blocked = 'hall'; break; }
        next.h.lvl += 1;
        next.h.chain += next.e[1];
        missing -= 1;
      }
      for (const h of heroes) {
        if (h.lvl === h.start) continue;
        const p = path(h.item, h.start, h.lvl, bh);
        task.steps.push({ id: h.id, name: name(h.id), from: h.start, to: h.lvl, ...p });
        bbChains.push(p.seconds);
        addCost(cost, p.cost);
      }
    } else if (t.type === 'GearUp') {
      const home = instances(village.buildings);
      task.current = home.filter((x) => x.gearUp).length;
      const geared = new Set(home.filter((x) => x.gearUp).map((x) => x.id));
      const th = Math.max(0, ...home.filter((x) => x.id === 1000001).map((x) => x.lvl));
      const candidates = [];
      for (const [id, item] of Object.entries(game.items)) {
        const g = item.gearUp;
        if (!g || geared.has(Number(id))) continue;
        const own = home.filter((x) => x.id === Number(id));
        if (!own.length) continue;
        // Heimatdorf-Gebäude auf die nötige Stufe (das höchste Exemplar)
        const top = Math.max(...own.map((x) => x.lvl));
        const homeP = top >= g.from ? { seconds: 0, cost: {} } : path(item, top, g.from, th);
        // Nachtdorf-Gebäude auf die nötige Stufe
        const req = game.items[String(g.requires)];
        const reqTop = Math.max(0, ...b2.filter((x) => x.id === g.requires).map((x) => x.lvl));
        const bbP = reqTop >= g.requiresLevel ? { seconds: 0, cost: {} } : path(req, reqTop, g.requiresLevel, bh);
        if (!homeP || !bbP) continue;
        candidates.push({ id: Number(id), item, g, homeP, bbP, reqTop, total: Math.max(homeP.seconds, bbP.seconds) + g.sec });
      }
      candidates.sort((a, c) => a.total - c.total);
      for (const c of candidates.slice(0, Math.max(0, t.target - task.current))) {
        task.steps.push({
          id: c.id, name: name(c.id), gearUp: true, seconds: c.g.sec, cost: { [c.g.resource]: c.g.cost },
          prereq: [
            c.homeP.seconds ? { id: c.id, name: name(c.id), to: c.g.from, ...c.homeP, village: 'home' } : null,
            c.bbP.seconds ? { id: c.g.requires, name: name(c.g.requires), from: c.reqTop, to: c.g.requiresLevel, ...c.bbP, village: 'builder' } : null,
          ].filter(Boolean),
        });
        if (c.bbP.seconds) bbChains.push(c.bbP.seconds);
        gearChains.push(c.g.sec);
        if (c.homeP.seconds) homeChains.push(c.homeP.seconds);
        addCost(cost, c.g.cost ? { [c.g.resource]: c.g.cost } : {});
        addCost(cost, c.homeP.cost);
        addCost(cost, c.bbP.cost);
      }
      if (task.current + task.steps.length < t.target) task.blocked = 'gear';
    }
    task.done = task.current >= t.target;
    tasks.push(task);
  }

  // Zentrale bauen bzw. auf Stufe 5 bringen (Stufe n braucht n-1 erledigte Aufgaben)
  const control = game.items[String(controlId)];
  const controlMax = control.levels.length;
  const controlCost = {};
  for (let L = controlLevel + 1; L <= controlMax; L++) {
    const [, , c, res] = levelEntry(control, L);
    if (c) controlCost[res] = (controlCost[res] || 0) + c;
  }
  addCost(cost, controlCost);

  const bbBuilders = Math.max(1, 1 + (b2.some((x) => x.id === 1000078) ? 1 : 0) + (b2.some((x) => x.id === 1000047) ? 1 : 0));
  const gearSeconds = gearChains.reduce((n, s) => n + s, 0);
  const builderSeconds = schedule(gearSeconds ? [...bbChains, gearSeconds] : bbChains, bbBuilders);
  const homeSeconds = Math.max(0, ...homeChains);
  return {
    control: { level: controlLevel, max: controlMax, unlocked: controlLevel >= controlMax, built: controlLevel > 0, requiredHall: control.levels[0][0], cost: controlCost },
    builderHall: bh,
    tasks,
    totals: {
      builderSeconds,
      bbBuilders,
      labSeconds,
      gearSeconds,
      homeSeconds,
      seconds: Math.max(builderSeconds, labSeconds, homeSeconds),
      cost,
    },
  };
}
