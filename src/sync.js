// Konto-Abgleich mit dem Server (server/worker.js). Logins vergibt nur der Betreiber; jede Person hat
// einen langen Zufallscode (Login-Link …#login=CODE). Abgeglichen werden alle "planner.*"-Einträge im
// localStorage, je Schlüssel mit Zeitstempel – der neuere gewinnt (auf dem Server und hier).

import { mergeKeys } from './merge.js';

const LOCAL = ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname);
// Lokal (Entwicklung) gegen `npx wrangler dev` in server/, sonst gegen den echten Server
export const API = LOCAL ? 'http://127.0.0.1:8787/v1/' : 'https://clash-planner.watari09.workers.dev/v1/';

const AUTH = 'planner.auth'; // { code, name, widget } – bleibt auf dem Gerät
const MTIME = 'planner.mtime'; // { key: Zeitstempel der letzten Änderung auf diesem Gerät bzw. vom Server }
const PUSHED = 'planner.pushedAt'; // bis wann alles hochgeladen ist
const DEVICE_ONLY = new Set([AUTH, MTIME, PUSHED, 'planner.tab', 'planner.installHint']);
const synced = (k) => k.startsWith('planner.') && !DEVICE_ONLY.has(k) && !k.startsWith('planner.sync.');

/**
 * Speicher-Hülle: merkt sich, wann ein abgeglichener Schlüssel zuletzt geändert wurde.
 * `store` ist localStorage (oder ein Ersatz in Tests).
 */
export function createSync(store, fetchImpl = globalThis.fetch?.bind(globalThis), now = () => Date.now()) {
  // Schreiben ohne Zeitstempel (für Übernahmen vom Server und eigene Verwaltung)
  let quiet = false;
  const raw = {
    set: (k, v) => { quiet = true; try { store.setItem(k, v); } finally { quiet = false; } },
    remove: (k) => { quiet = true; try { store.removeItem(k); } finally { quiet = false; } },
  };
  const readJson = (k, d) => { try { return JSON.parse(store.getItem(k)) ?? d; } catch { return d; } };
  const mtimes = () => readJson(MTIME, {});
  const touch = (k) => { if (quiet) return; const m = mtimes(); m[k] = now(); raw.set(MTIME, JSON.stringify(m)); };

  // Alle Schreibzugriffe der Seite laufen über localStorage → hier Zeitstempel mitschreiben
  const proto = Object.getPrototypeOf(store);
  if (!proto.__plannerTrack) {
    const track = new WeakMap(); // Speicher → touch
    const setItem = proto.setItem;
    const removeItem = proto.removeItem;
    proto.setItem = function (k, v) { const old = this.getItem(k); setItem.call(this, k, v); if (synced(k) && old !== String(v)) track.get(this)?.(k); };
    proto.removeItem = function (k) { const had = this.getItem(k) !== null; removeItem.call(this, k); if (synced(k) && had) track.get(this)?.(k); };
    proto.__plannerTrack = track;
  }
  proto.__plannerTrack.set(store, touch);

  const keys = () => {
    const out = {};
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (synced(k)) out[k] = { v: store.getItem(k), t: mtimes()[k] || 0 };
    }
    for (const [k, t] of Object.entries(mtimes())) if (synced(k) && !(k in out)) out[k] = { v: null, t }; // gelöscht
    return out;
  };

  /** Vom Server übernehmen, was dort neuer ist. Gibt zurück, ob sich hier etwas geändert hat. */
  const apply = (remote) => {
    const local = keys();
    const { keys: merged } = mergeKeys(local, remote);
    const m = mtimes();
    let changed = false;
    for (const [k, e] of Object.entries(merged)) {
      if (local[k] && local[k].t === e.t && local[k].v === e.v) continue;
      if (e.v === null) raw.remove(k); else raw.set(k, e.v);
      m[k] = e.t;
      changed = true;
    }
    raw.set(MTIME, JSON.stringify(m));
    return changed;
  };

  const auth = () => readJson(AUTH, null);
  const call = async (path, opts = {}) => {
    const a = auth();
    const res = await fetchImpl(API + path, { ...opts, cache: 'no-store', headers: { ...(opts.headers || {}), Authorization: `Bearer ${a?.code}` } });
    if (res.status === 401) throw Object.assign(new Error('login'), { login: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  return {
    auth,
    /** Mit Code anmelden; holt Name, Widget-Kennung und den Stand vom Server. */
    async login(code) {
      raw.set(AUTH, JSON.stringify({ code }));
      try {
        const me = await call('me');
        raw.set(AUTH, JSON.stringify({ code, name: me.name, widget: me.widget }));
        apply(me.keys);
        return me;
      } catch (e) {
        raw.remove(AUTH);
        throw e;
      }
    },
    logout() { raw.remove(AUTH); raw.remove(PUSHED); },
    /** Stand vom Server holen und übernehmen. true = hier hat sich etwas geändert. */
    async pull() {
      if (!auth()) return false;
      const me = await call('me');
      const a = auth();
      if (a && (a.name !== me.name || a.widget !== me.widget)) raw.set(AUTH, JSON.stringify({ ...a, name: me.name, widget: me.widget }));
      return apply(me.keys);
    },
    /** Lokale Änderungen seit dem letzten Hochladen senden (alles, wenn noch nie). */
    async push() {
      if (!auth()) return false;
      const since = Number(store.getItem(PUSHED) || -1);
      const all = keys();
      const pending = Object.fromEntries(Object.entries(all).filter(([, e]) => e.t > since || since < 0));
      if (!Object.keys(pending).length) return false;
      const started = now();
      const res = await call('me/keys', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: pending }) });
      raw.set(PUSHED, String(started));
      apply(res.keys);
      return true;
    },
    keys,
    apply,
  };
}

/** Widget-Stand lesen (ohne Login, nur mit Widget-Kennung). null = unbekannt. */
export async function widgetKeys(id) {
  const res = await fetch(`${API}widget/${id}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).keys;
}

/** Link zur Widget-Seite. */
export const widgetUrl = (id, base = location.href) => new URL(`widget.html#${id}`, base).href;
