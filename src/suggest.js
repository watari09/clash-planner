// Vorschlag für einen freien Platz: ein Upgrade, dessen Dauer zu deinem Tag passt.
// Tagsüber: das längste, das noch vor dem Schlafengehen fertig wird (dann kannst du direkt nachlegen).
// Abends/nachts: das kürzeste, das bis zum Aufstehen läuft (der Platz arbeitet die ganze Nacht).

export const DAY = { wake: 8, sleep: 22 }; // Stunden

/** Nächster Zeitpunkt (ms) mit dieser Uhrzeit (Stunde) ab `now`. */
function nextHour(now, hour) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * @param candidates  [{ id, name, next: { seconds } }] – startbare Upgrades (Reihenfolge = Vorrang bei Gleichstand)
 * @param factor      Zeitfaktor (Goldpass)
 * @returns { item, seconds, mode: 'day'|'night', until } oder null
 */
export function suggest(candidates, now = Date.now(), factor = 1, day = DAY, skip = new Set()) {
  const list = candidates
    .filter((i) => i.next?.seconds > 0 && !skip.has(i.id))
    .map((i) => ({ item: i, seconds: Math.round(i.next.seconds * factor) }));
  if (!list.length) return null;
  const h = new Date(now).getHours() + new Date(now).getMinutes() / 60;
  const awake = h >= day.wake && h < day.sleep;
  const until = awake ? nextHour(now, day.sleep) : nextHour(now, day.wake);
  const gap = (until - now) / 1000;
  let pick;
  if (awake) {
    // längstes, das noch heute fertig wird; sonst das kürzeste
    const fit = list.filter((x) => x.seconds <= gap).sort((a, b) => b.seconds - a.seconds);
    pick = fit[0] || [...list].sort((a, b) => a.seconds - b.seconds)[0];
  } else {
    // kürzestes, das bis zum Aufstehen läuft; sonst das längste
    const fit = list.filter((x) => x.seconds >= gap).sort((a, b) => a.seconds - b.seconds);
    pick = fit[0] || [...list].sort((a, b) => b.seconds - a.seconds)[0];
  }
  return { ...pick, mode: awake ? 'day' : 'night', until, fits: awake ? pick.seconds <= gap : pick.seconds >= gap };
}
