// Speicher für den Upgrade-Planer.
//   PUT    /v1/state/<id>  – Stand ablegen (JSON, max. 300 KB), läuft nach 60 Tagen ohne Update ab
//   GET    /v1/state/<id>  – Stand lesen (für die Widget-Seite)
//   DELETE /v1/state/<id>  – Stand löschen
// <id> ist eine zufällige, geheime Kennung (≥ 22 Zeichen), die die Seite im Browser erzeugt.
// Wer die Kennung kennt, kann lesen und schreiben – mehr Schutz braucht es für Dorfdaten nicht.

const ID = /^[A-Za-z0-9_-]{22,64}$/;
const ORIGINS = ['https://watari09.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const MAX = 300_000;
const TTL = 60 * 86400;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (body, status = 200, extra = {}) => new Response(body, { status, headers: { ...cors, 'Cache-Control': 'no-store', ...extra } });
    if (req.method === 'OPTIONS') return reply(null, 204);

    const m = url.pathname.match(/^\/v1\/state\/([^/]+)$/);
    if (!m || !ID.test(m[1])) return reply('not found', 404);
    const key = `state:${m[1]}`;

    if (req.method === 'GET') {
      const v = await env.KV.get(key);
      return v ? reply(v, 200, { 'Content-Type': 'application/json; charset=utf-8' }) : reply('not found', 404);
    }
    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > MAX) return reply('too large', 413);
      let data;
      try { data = JSON.parse(text); } catch { return reply('bad json', 400); }
      if (!data || typeof data.village !== 'string') return reply('missing village', 400);
      await env.KV.put(key, text, { expirationTtl: TTL });
      return reply(null, 204);
    }
    if (req.method === 'DELETE') {
      await env.KV.delete(key);
      return reply(null, 204);
    }
    return reply('method not allowed', 405);
  },
};
