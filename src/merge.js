// Abgleich pro Schlüssel: { key: { v: Wert (String) oder null = gelöscht, t: Zeitstempel ms } }.
// Neuerer Zeitstempel gewinnt; bei Gleichstand bleibt der vorhandene Wert.

export function mergeKeys(base = {}, incoming = {}) {
  const out = { ...base };
  let changed = false;
  for (const [k, e] of Object.entries(incoming)) {
    if (!e || typeof e.t !== 'number' || !(e.v === null || typeof e.v === 'string')) continue;
    if (!out[k] || e.t > out[k].t) { out[k] = { v: e.v, t: e.t }; changed = true; }
  }
  return { keys: out, changed };
}
