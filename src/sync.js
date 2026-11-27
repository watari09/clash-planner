// Abgleich mit dem Widget-Server (server/worker.js): legt den Stand unter einer zufälligen,
// geheimen Kennung ab, damit ein Widget einen festen Link hat. Nur, wenn man es einschaltet.

const LOCAL = ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname);
// Lokal (Entwicklung) gegen `npx wrangler dev` in server/, sonst gegen den echten Server
export const API = LOCAL ? 'http://127.0.0.1:8787/v1/state/' : 'https://clash-planner.SUBDOMAIN.workers.dev/v1/state/';

/** Zufällige Kennung (128 Bit, base64url, 22 Zeichen). */
export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function upload(id, bundle) {
  const res = await fetch(API + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function download(id) {
  const res = await fetch(API + id, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function remove(id) {
  await fetch(API + id, { method: 'DELETE' });
}

/** Link zur Widget-Seite für diese Kennung (gleicher Ort wie die Seite). */
export const widgetUrl = (id, base = location.href) => new URL(`widget.html#${id}`, base).href;
