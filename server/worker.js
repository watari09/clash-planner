// Server für den Upgrade-Planer (Cloudflare Worker + KV).
//
// Konten vergibt nur der Betreiber (tools/users.mjs). Jede Person bekommt einen langen Zufallscode
// als Login; gespeichert wird nur dessen SHA-256. KV-Schlüssel:
//   token:<sha256(code)> → userId
//   user:<userId>        → { name, widget, created }
//   widget:<widgetId>    → userId          (Lesezugriff fürs Widget, ohne Login)
//   data:<userId>        → { keys: { localStorage-Schlüssel: { v, t } } }
//
//   GET  /v1/me             (Login) → { name, widget, keys }
//   PUT  /v1/me/keys        (Login) Body { keys } → zusammengeführt, Antwort { keys }
//   GET  /v1/widget/<id>            → { keys } (nur lesen)

import { mergeKeys } from '../src/merge.js';

const ORIGINS = ['https://watari09.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const MAX = 2_000_000;
const CODE = /^[A-Za-z0-9_-]{20,64}$/;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function userOf(req, env) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer (\S+)$/);
  if (!m || !CODE.test(m[1])) return null;
  return env.KV.get(`token:${await sha256(m[1])}`);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const data = async (uid) => JSON.parse((await env.KV.get(`data:${uid}`)) || '{"keys":{}}');

    if (url.pathname === '/v1/me' && req.method === 'GET') {
      const uid = await userOf(req, env);
      if (!uid) return json({ error: 'login' }, 401);
      const user = JSON.parse((await env.KV.get(`user:${uid}`)) || '{}');
      return json({ name: user.name || '', widget: user.widget || null, keys: (await data(uid)).keys });
    }
    if (url.pathname === '/v1/me/keys' && req.method === 'PUT') {
      const uid = await userOf(req, env);
      if (!uid) return json({ error: 'login' }, 401);
      const text = await req.text();
      if (text.length > MAX) return json({ error: 'too large' }, 413);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
      const { keys, changed } = mergeKeys((await data(uid)).keys, body?.keys);
      if (changed) await env.KV.put(`data:${uid}`, JSON.stringify({ keys }));
      return json({ keys });
    }
    const w = url.pathname.match(/^\/v1\/widget\/([A-Za-z0-9_-]{20,64})$/);
    if (w && req.method === 'GET') {
      const uid = await env.KV.get(`widget:${w[1]}`);
      if (!uid) return json({ error: 'not found' }, 404);
      return json({ keys: (await data(uid)).keys });
    }
    return json({ error: 'not found' }, 404);
  },
};
