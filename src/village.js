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
