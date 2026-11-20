// Magische Gegenstände: Wo lohnt sich ein Buch am meisten? Ein Buch beendet ein Upgrade sofort –
// also gewinnt das Upgrade mit der längsten (Rest-)Dauer. Reine Funktionen.

import { IDS, levelEntry } from './village.js';

export const BOOKS = {
  fighting: { de: 'Buch des Kampfes', match: (it) => it.kind === 'troop' },
  spells: { de: 'Buch der Zauber', match: (it) => it.kind === 'spell' },
  heroes: { de: 'Buch der Helden', match: (it) => it.kind === 'hero' },
  building: { de: 'Buch des Bauens', match: (it) => (it.kind === 'building' && it.name.en !== 'Wall') || it.kind === 'trap' },
};

const SECTIONS = ['buildings', 'traps', 'heroes', 'units', 'spells', 'siege_machines'];

/**
 * Ranking je Buch (nur Heimatdorf). Möglich ist, was jetzt startbar ist: Gebäude/Helden bis zum
 * aktuellen Rathaus, Truppen/Zauber bis zur aktuellen Labor-Stufe. Laufende Upgrades zählen mit Restzeit.
 * @param running  analyze(...).running (ggf. mit Boosts) – für Restzeiten
 */
export function magicItems(village, game, running, now = village.timestamp * 1000, lang = 'de', top = 10) {
  const th = Math.max(0, ...village.buildings.filter((e) => e.data === IDS.townHall).map((e) => e.lvl || 0));
  const lab = Math.max(0, ...village.buildings.filter((e) => e.data === IDS.laboratory).map((e) => e.lvl || 0));
  const best = {}; // je Objekt die beste Option: { id, name, to, seconds, running }

  const consider = (id, item, option) => {
    const cur = best[id];
    if (!cur || option.seconds > cur.seconds) best[id] = { id, name: item.name[lang] || item.name.en, ...option };
  };

  for (const r of running) {
    const item = game.items[String(r.id)];
    if (!item || item.village !== 'home' || r.finishAt <= now) continue;
    consider(r.id, item, { to: r.level, seconds: Math.round((r.finishAt - now) / 1000), running: true });
  }

  for (const s of SECTIONS) {
    for (const e of village[s] || []) {
      if (typeof e.timer === 'number') continue; // läuft schon → oben erfasst
      const item = game.items[String(e.data)];
      if (!item || item.village !== 'home') continue;
      const to = (e.lvl || 0) + 1;
      const entry = levelEntry(item, to);
      if (!entry) continue; // schon Max-Stufe
      const [req, sec] = entry;
      const cap = item.kind === 'troop' || item.kind === 'spell' ? lab : th;
      if (req > cap || !sec) continue;
      consider(e.data, item, { to, seconds: sec, running: false });
    }
  }

  return Object.fromEntries(Object.entries(BOOKS).map(([key, book]) => [key, {
    title: book.de,
    items: Object.values(best)
      .filter((o) => book.match(game.items[String(o.id)]))
      .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
      .slice(0, top),
  }]));
}
