// Beschleuniger (Helfer, Tränke, Snacks, Uhrenturm) auf laufende Upgrades anwenden.
// Der Export enthält nur Restzeiten zum Export-Zeitpunkt; Boosts danach trägt der Nutzer ein.

/** Was der Nutzer eintragen kann. `groups`: betroffene Gruppen, `single`: nur ein ausgewähltes Upgrade. */
export const BOOST_TYPES = {
  builderPotion: { de: 'Bauarbeitertrank', en: 'Builder Potion', groups: ['home_builders'] },
  builderBite: { de: 'Bauarbeiterbissen', en: 'Builder Bite', groups: ['home_builders'] },
  builderApprentice: { de: 'Bauarbeiterlehrling', en: "Builder's Apprentice", groups: ['home_builders'], single: true, helper: 93000000 },
  researchPotion: { de: 'Forschungstrank', en: 'Research Potion', groups: ['lab'] },
  labLicorice: { de: 'Forschersuppe', en: 'Lab Licorice', groups: ['lab'] },
  labAssistant: { de: 'Laborgehilfe', en: 'Lab Assistant', groups: ['lab'], single: true, helper: 93000001 },
  petPotion: { de: 'Begleitertrank', en: 'Pet Potion', groups: ['pets'] },
  clockTower: { de: 'Uhrenturm', en: 'Clock Tower', groups: ['builder_builders', 'star_lab'] },
  clockTowerPotion: { de: 'Uhrenturm-Trank', en: 'Clock Tower Potion', groups: ['builder_builders', 'star_lab'] },
};

const CLOCK_TOWER = 1000039;

/**
 * Geschwindigkeit (x-fach) und Dauer eines eingetragenen Boosts.
 * Helfer: Stufe n arbeitet (n+1)-fach. Uhrenturm: Dauer hängt von seiner Stufe ab.
 */
export function boostEffect(type, game, village) {
  const b = game.boosts[type];
  if (type === 'builderApprentice' || type === 'labAssistant') {
    const id = BOOST_TYPES[type].helper;
    const lvl = (village.helpers || []).find((h) => h.data === id)?.lvl || 1;
    return { mult: (b.extraByLevel[lvl - 1] ?? lvl) + 1, sec: b.sec };
  }
  if (type === 'clockTower') {
    const lvl = Math.max(1, ...(village.buildings2 || []).filter((e) => e.data === CLOCK_TOWER).map((e) => e.lvl || 1));
    return { mult: b.mult, sec: b.secByLevel[Math.min(lvl, b.secByLevel.length) - 1] };
  }
  return { mult: b.mult, sec: b.sec };
}

/**
 * Neue Fertig-Zeit, wenn ab `at` für `sec` Sekunden `mult`-fach gearbeitet wird.
 * Wird das Upgrade innerhalb des Boosts fertig, zählt nur der nötige Teil.
 */
export function boostedFinish(finishAt, at, mult, sec) {
  if (finishAt <= at) return finishAt;
  const remaining = finishAt - at;
  const boosted = sec * 1000 * mult;
  if (remaining <= boosted) return at + remaining / mult;
  return finishAt - (mult - 1) * sec * 1000;
}

/** Stabiler Schlüssel für ein laufendes Upgrade (für Einzel-Boosts wie den Lehrling). */
export const runningKey = (r) => `${r.id}:${r.level}:${Math.round(r.finishAt / 60000)}`;

/**
 * Wendet Boost-Ereignisse [{ type, at, target? }] in zeitlicher Reihenfolge an.
 * Ereignisse vor dem Export-Zeitpunkt werden ignoriert – sie stecken schon in den Timern.
 * Gibt neue running-Liste zurück (sortiert) und je Ereignis die gesparte Zeit.
 */
export function applyBoosts(running, events, game, village) {
  const exportedAt = village.timestamp * 1000;
  const list = running.map((r) => ({ ...r, key: runningKey(r), originalFinishAt: r.finishAt }));
  const applied = [];
  const exportDayEnd = exportedAt + ((village.helpers || [])[0]?.helper_cooldown || 0) * 1000;
  const sorted = [...events].sort((a, b) => a.at - b.at);
  // Wird ein Trank aktiviert, während einer derselben Art noch wirkt, verlängert er nur die Dauer:
  // er beginnt also erst, wenn der vorige endet (Uhrenturm und Uhrenturm-Trank teilen sich das)
  const family = (type) => (type === 'clockTowerPotion' ? 'clockTower' : type);
  const windowEnd = {};
  for (const [i, ev] of sorted.entries()) {
    if (ev.at < exportedAt) continue;
    const def = BOOST_TYPES[ev.type];
    if (!def || !game.boosts?.[ev.type]) continue;
    const { mult, sec } = boostEffect(ev.type, game, village);
    let start = ev.at;
    if (!def.single) {
      const f = family(ev.type);
      start = Math.max(ev.at, windowEnd[f] || 0);
      windowEnd[f] = start + sec * 1000;
    }
    let saved = 0;
    for (const r of list) {
      if (!def.groups.includes(r.group)) continue;
      if (def.single && r.key !== ev.target) continue;
      const before = r.finishAt;
      r.finishAt = boostedFinish(r.finishAt, start, mult, sec);
      if (ev.recurrent && def.helper) {
        // fest zugeteilt: ab dem Ende dieses Arbeitstags jeden Tag wieder 1 h
        const day = helperDay(exportedAt, exportDayEnd, sorted.slice(0, i + 1).filter((x) => x.at >= exportedAt));
        r.finishAt = recurrentFinish(r.finishAt, day.dayEnd, mult, sec);
      }
      saved += before - r.finishAt;
    }
    applied.push({ ...ev, saved, mult, sec });
  }
  list.sort((a, b) => a.finishAt - b.finishAt);
  return { running: list, applied };
}

export const WORK_DAY = 23 * 3600e3;
export const HELPER_TYPES = ['builderApprentice', 'labAssistant'];

/**
 * Arbeitstag der Helfer (laut Supercell): Er dauert 23 h und beginnt, sobald ein Helfer zugewiesen wird.
 * Alle Helfer teilen sich diesen Arbeitstag; jeder kann darin einmal arbeiten.
 * Im Export steht nur der gemeinsame Countdown – wer darin schon gearbeitet hat, ist unbekannt.
 * Vorsichtige Annahme: Läuft beim Export ein Arbeitstag, gelten alle Helfer als schon eingesetzt.
 *
 * @param dayEnd  Ende des Arbeitstags laut Export (Export-Zeit + helper_cooldown)
 * @param events  eingetragene Helfer-Einsätze [{ type, at }]
 * @returns { dayEnd, used: Set, readyAt(type), nextDayStart(at) }
 */
export function helperDay(exportedAt, dayEnd, events) {
  let end = dayEnd;
  let used = new Set(dayEnd > exportedAt ? HELPER_TYPES : []);
  for (const ev of [...events].filter((e) => HELPER_TYPES.includes(e.type)).sort((a, b) => a.at - b.at)) {
    if (ev.at >= end) { // neuer Arbeitstag beginnt mit diesem Einsatz
      end = ev.at + WORK_DAY;
      used = new Set([ev.type]);
    } else {
      used.add(ev.type);
    }
  }
  return {
    dayEnd: end,
    used,
    readyAt: (type) => (used.has(type) ? end : 0),
  };
}

/**
 * Fest zugeteilter Helfer: arbeitet jeden Arbeitstag 1 h (mult-fach) am selben Upgrade, bis es fertig ist.
 * Der nächste Arbeitstag beginnt jeweils, sobald der vorige endet (`firstDay`), dann alle 23 h.
 */
export function recurrentFinish(finishAt, firstDay, mult, sec) {
  let f = finishAt;
  for (let start = firstDay; start < f; start += WORK_DAY) f = boostedFinish(f, start, mult, sec);
  return f;
}
