// Dashboard: was wird als Nächstes fertig, was startet danach (laut Plan), was muss man bereitlegen.
// Reine Funktion auf Basis von analyze(...) und simulate(...).

/**
 * @param running  laufende Upgrades (inkl. Boosts), sortiert oder unsortiert
 * @param sim      simulate(...)-Ergebnis für den aktuellen Plan
 * @param slots    { gruppe: Anzahl Plätze }
 * @param options  { now, limit, horizon } – horizon: Zeitraum für "bereitlegen" (ms)
 */
export function dashboard(running, sim, slots, options = {}) {
  const { now = Date.now(), limit = 6, horizon = 24 * 3600e3 } = options;
  const steps = sim?.steps || [];
  const used = new Set();
  // Plan-Schritt, der auf demselben Platz startet, wenn dieses Upgrade fertig ist
  const followUp = (group, at, depth = 0) => {
    const s = steps.find((x) => !used.has(x.index) && x.group === group && Math.abs(x.start - at) < 1000);
    if (!s) return null;
    used.add(s.index);
    // was danach auf demselben Platz folgt (eine Stufe tiefer reicht fürs Dashboard)
    return depth < 1 && s.end > s.start ? { ...s, then: followUp(group, s.end, depth + 1) } : s;
  };

  // Freie Plätze jetzt – und was der Plan dort sofort startet
  const free = [];
  for (const [group, n] of Object.entries(slots)) {
    const busy = running.filter((r) => r.group === group && r.finishAt > now).length;
    for (let k = busy; k < n; k++) free.push({ group, next: followUp(group, now) });
  }

  const upcoming = running
    .filter((r) => r.finishAt > now)
    .sort((a, b) => a.finishAt - b.finishAt)
    .slice(0, limit)
    .map((r) => ({ ...r, next: followUp(r.group, r.finishAt) }));

  // Was in den nächsten Stunden starten soll → Summe der Kosten zum Bereitlegen
  const soon = steps.filter((s) => s.start <= now + horizon && Object.keys(s.costs || {}).length);
  const prepare = {};
  for (const s of soon) for (const [r, n] of Object.entries(s.costs)) prepare[r] = (prepare[r] || 0) + n;

  return { free, upcoming, prepare, soonCount: soon.length, planned: steps.length > 0 };
}

/**
 * Tagesansicht: Ereignisse (laufende Upgrades fertig, geplante Starts) nach Kalendertag gruppiert.
 * @returns [{ day: Date (Tagesbeginn), today: bool, entries: [{ type: 'finish'|'start', at, item?, step? }], prepare }]
 */
export function dayView(running, sim, now = Date.now(), days = 7) {
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = startOfDay(now);
  const until = today + days * 86400e3;
  const entries = [
    ...running.filter((r) => r.finishAt > now && r.finishAt < until).map((r) => ({ type: 'finish', at: r.finishAt, item: r })),
    ...(sim?.steps || []).filter((s) => s.kind !== 'equip' && s.start < until && s.start >= now - 60e3).map((s) => ({ type: 'start', at: Math.max(s.start, now), step: s })),
  ].sort((a, b) => a.at - b.at || (a.type === 'finish' ? -1 : 1));
  const out = [];
  for (const e of entries) {
    const day = startOfDay(e.at);
    let bucket = out.find((b) => b.day === day);
    if (!bucket) { bucket = { day, today: day === today, entries: [], prepare: {} }; out.push(bucket); }
    bucket.entries.push(e);
    if (e.type === 'start') for (const [r, n] of Object.entries(e.step.costs || {})) bucket.prepare[r] = (bucket.prepare[r] || 0) + n;
  }
  return out;
}
