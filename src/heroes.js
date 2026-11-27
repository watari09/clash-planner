// Helden-Verfügbarkeit: wann ist welcher Held (Heimatdorf) wieder kampfbereit, und wo plant man
// mehrere Helden gleichzeitig ein (dann fehlen sie im Clankrieg / bei Angriffen).
// Reine Funktionen auf Basis von analyze().running und simulate().steps.

/**
 * @param village  Dorf-Export
 * @param game     Spieldaten
 * @param running  laufende Upgrades (mit Boosts)
 * @param steps    geplante Schritte aus simulate() (optional)
 * @returns { heroes: [{ id, name, level, busy: [{ from, to, level, planned }], readyAt }], overlaps: [{ from, to, ids }] }
 *   readyAt = Ende der zusammenhängenden Ausbauzeit ab jetzt (now, wenn gerade frei)
 */
export function heroAvailability(village, game, running, steps = [], now = Date.now(), lang = 'de') {
  const heroes = (village.heroes || [])
    .filter((h) => game.items[String(h.data)]?.kind === 'hero')
    .map((h) => {
      const item = game.items[String(h.data)];
      const busy = [
        ...running.filter((r) => r.id === h.data && r.section === 'heroes' && r.finishAt > now)
          .map((r) => ({ from: now, to: r.finishAt, level: r.level, planned: false })),
        ...steps.filter((s) => s.id === h.data && s.end > now)
          .map((s) => ({ from: Math.max(s.start, now), to: s.end, level: s.to, planned: true })),
      ].sort((a, b) => a.from - b.from);
      // bereit ab: Ende der ersten Ausbau-Kette, die jetzt läuft (direkt anschließende Stufen zählen mit)
      let readyAt = now;
      for (const b of busy) if (b.from <= readyAt + 60e3) readyAt = Math.max(readyAt, b.to);
      return { id: h.data, name: item.name[lang] || item.name.en, level: h.lvl || 0, busy, readyAt };
    });
  return { heroes, overlaps: overlaps(heroes) };
}

/** Zeiträume, in denen mindestens zwei Helden gleichzeitig im Ausbau sind (zusammengefasst). */
function overlaps(heroes) {
  const ev = [];
  for (const h of heroes) {
    for (const b of h.busy) {
      ev.push({ at: b.from, d: 1, id: h.id });
      ev.push({ at: b.to, d: -1, id: h.id });
    }
  }
  ev.sort((a, b) => a.at - b.at || a.d - b.d); // Ende vor Anfang bei gleicher Zeit
  const active = new Map();
  const out = [];
  let cur = null;
  for (const e of ev) {
    active.set(e.id, (active.get(e.id) || 0) + e.d);
    if (!active.get(e.id)) active.delete(e.id);
    if (active.size >= 2) {
      if (!cur) cur = { from: e.at, to: e.at, ids: new Set() };
      for (const id of active.keys()) cur.ids.add(id);
    } else if (cur) {
      cur.to = e.at;
      out.push({ ...cur, ids: [...cur.ids] });
      cur = null;
    }
  }
  // geplant = mindestens einer der beteiligten Ausbauten ist erst geplant (dann lässt er sich noch verschieben)
  return out.filter((o) => o.to > o.from).map((o) => ({
    ...o,
    planned: heroes.some((h) => o.ids.includes(h.id) && h.busy.some((b) => b.planned && b.from < o.to && b.to > o.from)),
  }));
}
