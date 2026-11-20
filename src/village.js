// Auswertung des Dorf-JSON aus Clash of Clans (Einstellungen → Dorfdaten exportieren).
// Reine Funktionen ohne DOM, damit sie auch in Node getestet werden können.

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
    throw new Error('Das ist kein gültiges JSON. In Clash: Einstellungen → Dorfdaten exportieren, dann hier einfügen.');
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
  for (const [section, group] of Object.entries(SECTIONS)) {
    for (const e of village[section] || []) {
      if (typeof e.timer !== 'number') continue;
      running.push({
        id: e.data,
        name: itemName(game, e.data, lang),
        section,
        group,
        level: (e.lvl || 0) + 1, // Zielstufe
        finishAt: exportedAt + e.timer * 1000,
      });
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
 * Ein Termin pro laufendem Upgrade, mit Erinnerung zur Fertig-Zeit.
 * Die UID ist stabil (Spieler + Objekt + Fertig-Minute), damit ein erneuter Import
 * dieselben Termine aktualisiert statt sie zu verdoppeln.
 */
export function toIcs(result, now = Date.now()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//clash-planner//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const tag = (result.tag || 'dorf').replace(/[^A-Z0-9]/gi, '');
  for (const r of result.running) {
    if (r.finishAt <= now) continue;
    const minute = Math.round(r.finishAt / 60000);
    const group = GROUPS[r.group]?.de || '';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${tag}-${r.id}-${minute}@clash-planner`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(r.finishAt)}`,
      `DTEND:${icsDate(r.finishAt + 15 * 60000)}`,
      `SUMMARY:${icsText(`${r.name} (Stufe ${r.level}) fertig`)}`,
      `DESCRIPTION:${icsText(`${group} – ein Platz ist wieder frei.`)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(`${r.name} ist fertig`)}`,
      'TRIGGER:PT0S',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
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
export function progress(village, game, lang = 'de') {
  const out = {};
  for (const v of ['home', 'builder']) {
    const b = v === 'home' ? village.buildings : village.buildings2 || [];
    const hallId = v === 'home' ? IDS.townHall : IDS.builderHall;
    const hall = levelOf(b, hallId);
    if (!hall) continue;
    const labId = v === 'home' ? IDS.laboratory : IDS.starLab;
    const labCap = maxLevel(game.items[String(labId)], hall);
    const petCap = v === 'home' ? maxLevel(game.items[String(IDS.petHouse)], hall) : 0;
    const limits = game.limits[v][String(Math.min(hall, Math.max(...Object.keys(game.limits[v]).map(Number))))] || {};

    const rows = []; // je Objekt-Art: { id, name, cat, instances: [{lvl, timer}], cap }
    const add = (id, cat, cap, instances) => {
      const item = game.items[String(id)];
      if (!item || id === hallId) return;
      rows.push({ id, item, cat, cap, instances });
    };

    // Gebäude und Fallen aus der Grenzen-Tabelle
    const listsB = v === 'home' ? ['buildings', 'traps'] : ['buildings2', 'traps2'];
    const owned = {};
    for (const section of listsB) {
      for (const e of village[section] || []) {
        (owned[e.data] ||= []).push(...Array.from({ length: e.cnt || 1 }, () => ({ lvl: e.lvl || 0, timer: e.timer })));
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
    for (const [section, cat, cap] of unitLists) {
      for (const e of village[section] || []) add(e.data, cat, cap, [{ lvl: e.lvl || 0, timer: e.timer }]);
    }

    const cats = Object.fromEntries(CATEGORIES[v].map(([k, t]) => [k, {
      key: k, title: t[lang] || t.en, done: 0, total: 0, seconds: 0, totalSeconds: 0, cost: {}, items: [],
    }]));

    for (const { id, item, cat, cap, instances } of rows) {
      const max = maxLevel(item, cap);
      if (!max) continue;
      const first = item.first || 1;
      const agg = { id, name: item.name[lang] || item.name.en, count: 0, from: Infinity, to: max, seconds: 0, cost: {} };
      for (const ins of instances) {
        const total = max - first + 1;
        const cur = Math.min(Math.max(ins.lvl, first - 1), max);
        cats[cat].total += total;
        cats[cat].done += cur - first + 1;
        for (let L = first; L <= max; L++) cats[cat].totalSeconds += (levelEntry(item, L) || [0, 0])[1];
        if (cur >= max) continue;
        agg.count += 1;
        agg.from = Math.min(agg.from, ins.lvl);
        for (let L = cur + 1; L <= max; L++) {
          const [, sec, cost, res] = levelEntry(item, L) || [0, 0, 0, ''];
          if (res === 'Diamonds') { cats[cat].done += 1; continue; } // Kauf mit Edelsteinen, kein Upgrade
          const running = L === cur + 1 && typeof ins.timer === 'number';
          agg.seconds += running ? ins.timer : sec;
          if (!running && cost) agg.cost[res] = (agg.cost[res] || 0) + cost;
        }
      }
      if (agg.count) {
        const c = cats[cat];
        c.items.push(agg);
        c.seconds += agg.seconds;
        for (const [r, n] of Object.entries(agg.cost)) c.cost[r] = (c.cost[r] || 0) + n;
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
      // Hauptwert: Anteil der gesamten Bauzeit bis zum Maximum, der schon erledigt ist
      percent: totalSeconds ? pct(1 - leftSeconds / totalSeconds) : 100,
      levelPercent: total ? pct(done / total) : 100,
      done,
      total,
      categories: list,
      builderSeconds: sum(['buildings', 'traps', 'walls', 'heroes']),
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
