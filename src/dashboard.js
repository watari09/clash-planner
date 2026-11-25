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
 * Tagesansicht: Ereignisse nach Kalendertag gruppiert.
 * - finish: ein laufendes ODER geplantes Upgrade wird fertig; `next` = der Plan-Schritt, der danach
 *   auf demselben Platz startet (z. B. Wächter fertig → Sprungfalle → wenn die fertig ist → nächstes).
 * - start: ein geplanter Start, der keiner Fertigstellung zugeordnet ist (z. B. auf einem freien Platz).
 * @returns [{ day, today, entries: [{ type, at, item?, step?, next? }], prepare }]
 */
export function dayView(running, sim, now = Date.now(), days = 7) {
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = startOfDay(now);
  const until = today + days * 86400e3;
  const steps = (sim?.steps || []).filter((s) => s.kind !== 'equip');

  // Alle Fertigstellungen (laufend + geplant) in zeitlicher Reihenfolge; jede bekommt den Plan-Schritt,
  // der zur selben Zeit in derselben Gruppe startet
  const finishes = [
    ...running.filter((r) => r.finishAt > now).map((r) => ({ type: 'finish', at: r.finishAt, item: r, group: r.group })),
    ...steps.filter((s) => s.end > s.start).map((s) => ({
      type: 'finish', at: s.end, group: s.group, planned: true,
      item: { id: s.id, name: s.name, level: s.to, group: s.group, finishAt: s.end, gearUp: s.kind === 'gear', fromStep: s.index },
    })),
  ].sort((a, b) => a.at - b.at);
  const used = new Set();
  for (const f of finishes) {
    const next = steps.find((s) => !used.has(s.index) && s.group === f.group && Math.abs(s.start - f.at) < 1000);
    if (next) { used.add(next.index); f.next = next; }
  }
  const entries = [
    ...finishes.filter((f) => f.at < until),
    ...steps.filter((s) => !used.has(s.index) && s.start < until && s.start >= now - 60e3)
      .map((s) => ({ type: 'start', at: Math.max(s.start, now), step: s })),
  ].sort((a, b) => a.at - b.at || (a.type === 'finish' ? -1 : 1));

  const out = [];
  for (const e of entries) {
    const day = startOfDay(e.at);
    let bucket = out.find((b) => b.day === day);
    if (!bucket) { bucket = { day, today: day === today, entries: [], prepare: {} }; out.push(bucket); }
    bucket.entries.push(e);
    const step = e.type === 'start' ? e.step : e.next;
    if (step) for (const [r, n] of Object.entries(step.costs || {})) bucket.prepare[r] = (bucket.prepare[r] || 0) + n;
  }
  return out;
}
