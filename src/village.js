import { boostedFinish, recurrentFinish } from './boosts.js';

// Auswertung des Dorf-JSON aus Clash of Clans (Einstellungen → „Dorfdaten im JSON-Format exportieren“).
// Reine Funktionen ohne DOM, damit sie auch in Node getestet werden können.

/**
 * Laufender Gear-Up: Gebäude mit Timer und "gear_up": 0. Den macht der Meisterbauarbeiter im
 * Heimatdorf; der Timer gehört dann zum Gear-Up, nicht zu einer neuen Stufe.
 */
export const isGearing = (e) => e.gear_up === 0 && typeof e.timer === 'number';
/** Timer einer Stufen-Erhöhung (undefined bei Gear-Up oder wenn nichts läuft). */
export const levelTimer = (e) => (isGearing(e) ? undefined : e.timer);

/** Spielobjekte, die gezählt werden. */
export const IDS = {
  townHall: 1000001,
  builderHut: 1000015,
  bobHut: 1000064,
  laboratory: 1000007,
  petHouse: 1000068,
  builderHall: 1000034,
  starLab: 1000046,
  ottoOutpost: 1000078, // O.T.T.O. als zweiter Nachtdorf-Bauarbeiter (ab Meisterhütte 6)
  botoShed: 1000047, // „B.O.T.O.s Schuppen“: dritter Nachtdorf-Bauarbeiter (ab Meisterhütte 2, 1000 Edelsteine)
};

/** Gruppen = wer arbeitet an einem Upgrade. */
export const GROUPS = {
  home_builders: { de: 'Heimatdorf · Bauarbeiter', en: 'Home Village · Builders' },
  lab: { de: 'Heimatdorf · Labor', en: 'Home Village · Laboratory' },
  pets: { de: 'Heimatdorf · Begleiterhaus', en: 'Home Village · Pet House' },
  builder_builders: { de: 'Nachtdorf · Bauarbeiter', en: 'Builder Base · Builders' },
  star_lab: { de: 'Nachtdorf · Sternlabor', en: 'Builder Base · Star Laboratory' },
};

/** Welche Liste im JSON zu welcher Gruppe gehört. */
const SECTIONS = {
  buildings: 'home_builders',
  traps: 'home_builders',
  heroes: 'home_builders',
  units: 'lab',
  spells: 'lab',
  siege_machines: 'lab',
  pets: 'pets',
  buildings2: 'builder_builders',
  traps2: 'builder_builders',
  heroes2: 'builder_builders',
  units2: 'star_lab',
};

/** Liest und prüft das eingefügte JSON. Wirft einen Fehler mit verständlicher Meldung. */
export function readVillage(text) {
  let v;
  try {
    v = JSON.parse(text.trim());
  } catch {
    throw new Error('Das ist kein gültiges JSON. In Clash: Einstellungen → „Dorfdaten im JSON-Format exportieren“, dann hier einfügen.');
  }
  if (!v || typeof v !== 'object' || !Array.isArray(v.buildings) || typeof v.timestamp !== 'number') {
    throw new Error('Das JSON sieht nicht wie ein Dorf-Export aus (es fehlen "buildings" oder "timestamp").');
  }
  return v;
}

function levelOf(list, id) {
  return Math.max(0, ...(list || []).filter((e) => e.data === id).map((e) => e.lvl || 0));
}

function countOf(list, id) {
  return (list || []).filter((e) => e.data === id).reduce((n, e) => n + (e.cnt || 1), 0);
}

export function itemName(game, id, lang = 'de') {
  const it = game.items[String(id)];
  return it ? it.name[lang] || it.name.en : `#${id}`;
}

/**
 * Laufende Upgrades und Auslastung.
 * finishAt in Millisekunden, aus Export-Zeitpunkt + Restsekunden (sekundengenau).
 */
export function analyze(village, game, lang = 'de') {
  const exportedAt = village.timestamp * 1000;
  const running = [];
  // Helfer, der gerade an einem Upgrade arbeitet (helper_timer): Stufe n → (n+1)-fach
  const helperMult = (group) => {
    const type = group === 'lab' ? 'labAssistant' : 'builderApprentice';
    const id = group === 'lab' ? 93000001 : 93000000;
    const lvl = (village.helpers || []).find((h) => h.data === id)?.lvl || 1;
    return (game.boosts?.[type]?.extraByLevel?.[lvl - 1] ?? lvl) + 1;
  };
  // Gemeinsamer Arbeitstag der Helfer: endet laut Export nach helper_cooldown
  const dayEnd = exportedAt + ((village.helpers || [])[0]?.helper_cooldown || 0) * 1000;
  for (const [section, group] of Object.entries(SECTIONS)) {
    for (const e of village[section] || []) {
      if (typeof e.timer !== 'number') continue;
      const item = game.items[String(e.data)];
      if (isGearing(e)) {
        // Meisterbauarbeiter im Heimatdorf: belegt einen Nachtdorf-Bauarbeiter, keinen Heimatdorf-Platz
        running.push({
          id: e.data, name: itemName(game, e.data, lang), section, group: 'builder_builders',
          level: e.lvl || 0, gearUp: true, master: true, finishAt: exportedAt + e.timer * 1000,
        });
        continue;
      }
      // Gebäude auf Max-Stufe mit Timer: läuft ein Supercharge
      const supercharging = item?.supercharge && (e.lvl || 0) >= item.levels.length;
      let finishAt = exportedAt + e.timer * 1000;
      if (typeof e.helper_timer === 'number' && e.helper_timer > 0) {
        finishAt = boostedFinish(finishAt, exportedAt, helperMult(group), e.helper_timer);
      }
      // Fest zugeteilter Helfer: ab dem nächsten Arbeitstag jeden Tag 1 h, bis das Upgrade fertig ist
      if (e.recurrent_helper || e.helper_recurrent) {
        finishAt = recurrentFinish(finishAt, Math.max(dayEnd, exportedAt), helperMult(group), 3600);
      }
      running.push({
        id: e.data,
        name: itemName(game, e.data, lang),
        section,
        group,
        level: supercharging ? e.lvl : (e.lvl || 0) + 1, // Zielstufe
        supercharge: supercharging ? (e.supercharge || 0) + 1 : undefined,
        finishAt,
        helper: typeof e.helper_timer === 'number' && e.helper_timer > 0,
        recurrentHelper: !!(e.recurrent_helper || e.helper_recurrent),
        goblin: !!e.extra, // Goblin-Bauarbeiter aus einem Event
      });
    }
  }
  // Bauarbeitertrank, der beim Export noch wirkt (boosts.builder_boost = Restsekunden):
  // beschleunigt die Heimatdorf-Bauarbeiter und den Meisterbauarbeiter im Heimatdorf
  const potionLeft = village.boosts?.builder_boost || 0;
  if (potionLeft > 0) {
    const mult = game.boosts?.builderPotion?.mult || 10;
    for (const r of running) {
      if (r.group === 'home_builders' || r.master) r.finishAt = boostedFinish(r.finishAt, exportedAt, mult, potionLeft);
    }
  }
  running.sort((a, b) => a.finishAt - b.finishAt);

  const b = village.buildings;
  const b2 = village.buildings2 || [];
  const slots = {
    home_builders: countOf(b, IDS.builderHut) + countOf(b, IDS.bobHut),
    lab: countOf(b, IDS.laboratory) > 0 ? 1 : 0,
    pets: countOf(b, IDS.petHouse) > 0 ? 1 : 0,
    // Meisterbauarbeiter + O.T.T.O. + B.O.T.O.
    builder_builders: b2.length
      ? 1 + (countOf(b2, IDS.ottoOutpost) > 0 ? 1 : 0) + (countOf(b2, IDS.botoShed) > 0 ? 1 : 0)
      : 0,
    star_lab: countOf(b2, IDS.starLab) > 0 ? 1 : 0,
  };

  const groups = Object.keys(GROUPS).map((key) => {
    const items = running.filter((r) => r.group === key);
    return { key, title: GROUPS[key][lang] || GROUPS[key].en, slots: slots[key], items };
  });

  const helpers = (village.helpers || []).map((h) => ({
    id: h.data,
    name: itemName(game, h.data, lang),
    level: h.lvl,
    readyAt: exportedAt + (h.helper_cooldown || 0) * 1000,
  }));

  return {
    tag: village.tag,
    exportedAt,
    townHall: levelOf(b, IDS.townHall),
    builderHall: levelOf(b2, IDS.builderHall),
    running,
    groups,
    helpers,
    clockTowerReadyAt: village.boosts?.clocktower_cooldown != null
      ? exportedAt + village.boosts.clocktower_cooldown * 1000 : null,
  };
}

// ---------- Kalender (.ics) ----------

function icsDate(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * Kalender-Datei aus Terminen { uid, start, title, description, alarm }.
 * Stabile UIDs sorgen dafür, dass ein erneuter Import aktualisiert statt verdoppelt.
 */
export function icsCalendar(events, now = Date.now()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//clash-planner//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@clash-planner`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.start + 15 * 60000)}`,
      `SUMMARY:${icsText(e.title)}`,
      `DESCRIPTION:${icsText(e.description || '')}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(e.alarm || e.title)}`,
      'TRIGGER:PT0S',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const ICS_TEXT = {
  de: { title: (n, l) => `${n} (Stufe ${l}) fertig`, desc: (g) => `${g} – ein Platz ist wieder frei.`, alarm: (n) => `${n} ist fertig` },
  en: { title: (n, l) => `${n} (level ${l}) done`, desc: (g) => `${g} – a slot is free again.`, alarm: (n) => `${n} is done` },
};

/** Ein Termin pro laufendem Upgrade, mit Erinnerung zur Fertig-Zeit. */
export function toIcs(result, now = Date.now(), lang = 'de') {
  const tag = (result.tag || 'dorf').replace(/[^A-Z0-9]/gi, '');
  const tx = ICS_TEXT[lang] || ICS_TEXT.de;
  return icsCalendar(result.running.filter((r) => r.finishAt > now).map((r) => ({
    uid: `${tag}-${r.id}-${Math.round(r.finishAt / 60000)}`,
    start: r.finishAt,
    title: tx.title(r.name, r.level),
    description: tx.desc(GROUPS[r.group]?.[lang] || GROUPS[r.group]?.de || ''),
    alarm: tx.alarm(r.name),
  })), now);
}

// ---------- Anzeige-Helfer ----------

export function formatDuration(sec) {
  if (sec <= 0) return 'fertig';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h${m ? ` ${m}m` : ''}`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------- Fortschritt: was fehlt bis zum Maximum der aktuellen Rathaus-/Meisterhütten-Stufe ----------

export const CATEGORIES = {
  home: [
    ['buildings', { de: 'Gebäude', en: 'Buildings' }],
    ['traps', { de: 'Fallen', en: 'Traps' }],
    ['walls', { de: 'Mauern', en: 'Walls' }],
    ['heroes', { de: 'Helden', en: 'Heroes' }],
    ['lab', { de: 'Labor', en: 'Laboratory' }],
    ['pets', { de: 'Begleiter', en: 'Pets' }],
    ['supercharge', { de: 'Supercharges', en: 'Supercharges' }],
  ],
  builder: [
    ['buildings', { de: 'Gebäude', en: 'Buildings' }],
    ['traps', { de: 'Fallen', en: 'Traps' }],
    ['walls', { de: 'Mauern', en: 'Walls' }],
    ['heroes', { de: 'Helden', en: 'Heroes' }],
    ['lab', { de: 'Sternlabor', en: 'Star Laboratory' }],
  ],
};

/** Daten für Stufe `level` erreichen: [Voraussetzung, Sekunden, Kosten, Ressource] oder undefined. */
export function levelEntry(item, level) {
  return item.levels[level - (item.first || 1)];
}

/** Höchste Stufe, deren Voraussetzung ≤ cap ist (0, wenn keine). */
export function maxLevel(item, cap) {
  const first = item.first || 1;
  let max = 0;
  item.levels.forEach((l, i) => { if (l[0] <= cap) max = first + i; });
  return max;
}

const isWall = (item) => item.name.en === 'Wall' || item.name.en === 'BB Wall' || /^(BB )?Wall$/.test(item.name.en);

/**
 * Fortschritt je Dorf. Zählt Stufen ("Level-Ups") und summiert Restzeit und Kosten je Ressource.
 * - Gebäude/Fallen: erlaubte Anzahl laut Rathaus; fehlende Exemplare zählen ab Stufe 0 (bauen).
 * - Truppen/Zauber/Belagerung/Begleiter: nur, was im Export steht (also freigeschaltet ist);
 *   Obergrenze über die maximale Labor-/Begleiterhaus-Stufe bei diesem Rathaus.
 * - Laufende Upgrades: die laufende Stufe zählt mit Restzeit und ohne Kosten (schon bezahlt).
 * - Mit Edelsteinen gekaufte Plätze (z. B. Bauhütten) und Rathaus/Meisterhütte selbst zählen nicht.
 */
/**
 * Filter-Schlüssel eines Objekts: Gebäude nach Klasse (defense/resource/army/other), Fallen,
 * Labor nach troop/spell/siege. Mauern, Helden und Begleiter werden nicht gefiltert (null).
 */
export function filterKey(item) {
  if (item.kind === 'trap') return 'traps';
  if (item.kind === 'spell') return 'spell';
  if (item.kind === 'building') return item.name.en === 'Wall' ? null : item.group || 'other';
  if (item.kind === 'troop') return item.group || 'troop';
  return null;
}

/**
 * Realistische Gesamtdauer für `n` parallele Bauarbeiter: Jedes Exemplar (z. B. ein Held) wird
 * nacheinander hochgestuft und kann nicht gleichzeitig von zwei Bauarbeitern gebaut werden.
 * Längste Ketten zuerst auf den jeweils am wenigsten belasteten Bauarbeiter (LPT-Verfahren).
 * Ergebnis ≥ max(Summe ÷ n, längste Kette).
 */
export function schedule(chains, n) {
  const load = Array(Math.max(1, n)).fill(0);
  for (const c of [...chains].sort((a, b) => b - a)) {
    let i = 0;
    for (let k = 1; k < load.length; k++) if (load[k] < load[i]) i = k;
    load[i] += c;
  }
  return Math.max(...load);
}

/**
 * targets[v]: Ziel-Rathaus/-Meisterhütte (Zahl) oder 'rush' = Maximum der vorherigen Stufe.
 * options.exclude: Filter-Schlüssel (siehe filterKey), die nicht mitgerechnet werden.
 */
export function progress(village, game, lang = 'de', targets = {}, options = {}) {
  const exclude = new Set(options.exclude || []);
  const out = {};
  for (const v of ['home', 'builder']) {
    const b = v === 'home' ? village.buildings : village.buildings2 || [];
    const hallId = v === 'home' ? IDS.townHall : IDS.builderHall;
    const current = levelOf(b, hallId);
    if (!current) continue;
    // Ziel: gewähltes Rathaus bzw. gewählte Meisterhütte, nie unter der aktuellen Stufe
    const hallItem = game.items[String(hallId)];
    const rush = targets[v] === 'rush';
    const hall = rush
      ? Math.max(1, current - 1)
      : Math.min(Math.max(targets[v] || current, current), hallItem.levels.length + (hallItem.first || 1) - 1);
    const labId = v === 'home' ? IDS.laboratory : IDS.starLab;
    const labCap = maxLevel(game.items[String(labId)], hall);
    const petCap = v === 'home' ? maxLevel(game.items[String(IDS.petHouse)], hall) : 0;
    const limits = game.limits[v][String(Math.min(hall, Math.max(...Object.keys(game.limits[v]).map(Number))))] || {};

    const rows = []; // je Objekt-Art: { id, name, cat, instances: [{lvl, timer}], cap, max? }
    const add = (id, cat, cap, instances, max) => {
      const item = game.items[String(id)];
      if (!item || (id === hallId && max === undefined)) return;
      if (exclude.has(filterKey(item))) return;
      // Erst nach dem Ziel freigeschaltet (z. B. beim Rush-Vergleich mit dem vorigen Rathaus): nicht mitzählen
      if (item.unlock && item.unlock > hall && id !== hallId) return;
      rows.push({ id, item, cat, cap, instances, max });
    };
    // Rathaus/Meisterhütte selbst nur, wenn ein höheres Ziel gewählt ist
    if (hall > current) {
      const e = b.find((x) => x.data === hallId);
      add(hallId, 'buildings', hall, [{ lvl: current, timer: e?.timer }], hall);
    }

    // Gebäude und Fallen aus der Grenzen-Tabelle
    const listsB = v === 'home' ? ['buildings', 'traps'] : ['buildings2', 'traps2'];
    const owned = {};
    for (const section of listsB) {
      for (const e of village[section] || []) {
        (owned[e.data] ||= []).push(...Array.from({ length: e.cnt || 1 }, () => ({ lvl: e.lvl || 0, timer: levelTimer(e), sc: e.supercharge || 0 })));
      }
    }
    for (const [id, allowed] of Object.entries(limits)) {
      const item = game.items[id];
      if (!item) continue;
      const have = owned[id] || [];
      const missing = Math.max(0, allowed - have.length);
      const inst = [...have.slice(0, allowed), ...Array.from({ length: missing }, () => ({ lvl: 0 }))];
      const cat = isWall(item) ? 'walls' : item.kind === 'trap' ? 'traps' : 'buildings';
      add(Number(id), cat, hall, inst);
    }

    // Helden, Labor, Begleiter: was im Export steht
    const unitLists = v === 'home'
      ? [['heroes', 'heroes', hall], ['units', 'lab', labCap], ['spells', 'lab', labCap], ['siege_machines', 'lab', labCap], ['pets', 'pets', petCap]]
      : [['heroes2', 'heroes', hall], ['units2', 'lab', labCap]];
    const seen = new Set();
    for (const [section, cat, cap] of unitLists) {
      for (const e of village[section] || []) {
        seen.add(e.data);
        add(e.data, cat, cap, [{ lvl: e.lvl || 0, timer: levelTimer(e) }]);
      }
    }
    // Noch nicht freigeschaltete Truppen, Zauber, Helden, Begleiter bis zum Ziel-Rathaus
    const catOf = (it) => (it.kind === 'hero' ? 'heroes' : it.kind === 'pet' ? 'pets' : 'lab');
    const capOf = (it) => (it.kind === 'hero' ? hall : it.kind === 'pet' ? petCap : labCap);
    for (const [id, it] of Object.entries(game.items)) {
      if (it.village !== v || !it.unlock || it.unlock > hall || seen.has(Number(id))) continue;
      add(Number(id), catOf(it), capOf(it), [{ lvl: 0 }]);
    }

    const cats = Object.fromEntries(CATEGORIES[v].map(([k, t]) => [k, {
      key: k, title: t[lang] || t.en, done: 0, total: 0, seconds: 0, totalSeconds: 0, cost: {}, items: [], doneItems: [],
      chains: [], // Restzeit je Exemplar (für die realistische Gesamtdauer)
    }]));

    for (const { id, item, cat, cap, instances, max: fixedMax } of rows) {
      const max = fixedMax ?? maxLevel(item, cap);
      if (!max) continue;
      const first = item.first || 1;
      const agg = {
        id, name: item.name[lang] || item.name.en, count: 0, from: Infinity, to: max, seconds: 0, cost: {},
        missing: instances.filter((i) => i.lvl === 0 && i.timer === undefined).length, // noch nicht gebaut
        // Stufen der einzelnen Exemplare (laufende zählen als Zielstufe), aufsteigend
        levels: instances.map((i) => (i.lvl || 0) + (typeof i.timer === 'number' ? 1 : 0)).sort((a, b) => a - b),
        next: null, // nächste Stufe des niedrigsten Exemplars: { level, seconds, cost, resource }
      };
      const low = agg.levels[0];
      if (low < max) {
        const [, sec, cost, res] = levelEntry(item, Math.max(low + 1, first)) || [0, 0, 0, ''];
        agg.next = { level: Math.max(low + 1, first), seconds: sec, cost: res === 'Diamonds' ? 0 : cost, resource: res };
      }
      for (const ins of instances) {
        const total = max - first + 1;
        const cur = Math.min(Math.max(ins.lvl, first - 1), max);
        cats[cat].total += total;
        cats[cat].done += cur - first + 1;
        for (let L = first; L <= max; L++) cats[cat].totalSeconds += (levelEntry(item, L) || [0, 0])[1];
        if (cur >= max) continue;
        agg.count += 1;
        let chain = 0;
        agg.from = Math.min(agg.from, ins.lvl);
        for (let L = cur + 1; L <= max; L++) {
          const [, sec, cost, res] = levelEntry(item, L) || [0, 0, 0, ''];
          if (res === 'Diamonds') { cats[cat].done += 1; continue; } // Kauf mit Edelsteinen, kein Upgrade
          const running = L === cur + 1 && typeof ins.timer === 'number';
          agg.seconds += running ? ins.timer : sec;
          chain += running ? ins.timer : sec;
          if (!running && cost) agg.cost[res] = (agg.cost[res] || 0) + cost;
        }
        if (chain) cats[cat].chains.push(chain);
      }
      if (!agg.count) cats[cat].doneItems.push(agg);
      if (agg.count) {
        const c = cats[cat];
        c.items.push(agg);
        c.seconds += agg.seconds;
        for (const [r, n] of Object.entries(agg.cost)) c.cost[r] = (c.cost[r] || 0) + n;
      }
    }

    // Supercharges: Gebäude auf ihrer letzten Stufe bekommen ab einem Rathaus zusätzliche Stufen
    if (cats.supercharge) {
      for (const [id, inst] of Object.entries(owned)) {
        const item = game.items[id];
        const sc = item?.supercharge;
        if (!sc || hall < sc.townHall || exclude.has(filterKey(item))) continue;
        const max = sc.levels.length;
        const agg = {
          id: Number(id), name: item.name[lang] || item.name.en, count: 0, from: Infinity, to: max, seconds: 0, cost: {},
          missing: 0, levels: [], next: null, supercharge: true,
        };
        const c = cats.supercharge;
        for (const ins of inst) {
          if (ins.lvl < item.levels.length) continue; // erst auf Max-Stufe möglich
          const running = typeof ins.timer === 'number';
          const cur = Math.min(ins.sc, max);
          agg.levels.push(cur + (running ? 1 : 0));
          c.total += max;
          c.done += cur;
          for (let L = 1; L <= max; L++) c.totalSeconds += sc.levels[L - 1][0];
          if (cur >= max) continue;
          agg.count += 1;
          agg.from = Math.min(agg.from, cur);
          let chain = 0;
          for (let L = cur + 1; L <= max; L++) {
            const [sec, cost, res] = sc.levels[L - 1];
            const isRunning = L === cur + 1 && running;
            agg.seconds += isRunning ? ins.timer : sec;
            chain += isRunning ? ins.timer : sec;
            if (!isRunning && cost) agg.cost[res] = (agg.cost[res] || 0) + cost;
          }
          if (chain) c.chains.push(chain);
        }
        agg.levels.sort((a, b) => a - b);
        if (agg.levels.length && agg.levels[0] < max) {
          const [sec, cost, res] = sc.levels[agg.levels[0]];
          agg.next = { level: agg.levels[0] + 1, seconds: sec, cost, resource: res };
        }
        if (agg.count) {
          c.items.push(agg);
          c.seconds += agg.seconds;
          for (const [r, n] of Object.entries(agg.cost)) c.cost[r] = (c.cost[r] || 0) + n;
        } else if (agg.levels.length) c.doneItems.push(agg);
      }
    }

    const list = Object.values(cats);
    for (const c of list) c.items.sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
    const done = list.reduce((n, c) => n + c.done, 0);
    const total = list.reduce((n, c) => n + c.total, 0);
    const totalSeconds = list.reduce((n, c) => n + c.totalSeconds, 0);
    const leftSeconds = list.reduce((n, c) => n + c.seconds, 0);
    for (const c of list) c.percent = c.totalSeconds ? pct(1 - c.seconds / c.totalSeconds) : (c.total ? pct(c.done / c.total) : 100);
    const sum = (keys) => list.filter((c) => keys.includes(c.key)).reduce((n, c) => n + c.seconds, 0);
    out[v] = {
      hall,
      current,
      // Hauptwert: Anteil der gesamten Bauzeit bis zum Maximum, der schon erledigt ist
      percent: totalSeconds ? pct(1 - leftSeconds / totalSeconds) : 100,
      levelPercent: total ? pct(done / total) : 100,
      done,
      total,
      categories: list,
      builderSeconds: sum(['buildings', 'traps', 'walls', 'heroes', 'supercharge']),
      builderChains: list.filter((c) => ['buildings', 'traps', 'walls', 'heroes', 'supercharge'].includes(c.key)).flatMap((c) => c.chains),
      rush,
      labSeconds: sum(['lab']),
      petSeconds: sum(['pets']),
    };
  }
  return out;
}

function pct(x) {
  return Math.floor(Math.max(0, Math.min(1, x)) * 1000) / 10;
}

export const RESOURCES = {
  Gold: { de: 'Gold', en: 'Gold' },
  Elixir: { de: 'Elixier', en: 'Elixir' },
  DarkElixir: { de: 'Dunkles Elixier', en: 'Dark Elixir' },
  Gold2: { de: 'Gold (Nachtdorf)', en: 'Builder Gold' },
  Elixir2: { de: 'Elixier (Nachtdorf)', en: 'Builder Elixir' },
};
