#!/usr/bin/env node
// Logins für den Upgrade-Planer verwalten (nur der Betreiber; braucht `npx wrangler login`).
//
//   node tools/users.mjs add "Name"     neuen Login anlegen → druckt den Login-Link
//   node tools/users.mjs list           alle Logins
//   node tools/users.mjs reset <id>     neuen Login-Link ausstellen (alter wird ungültig)
//   node tools/users.mjs remove <id>    Login samt Daten löschen
//
// Mit --local statt auf dem echten Server in der lokalen Entwicklungs-Datenbank (npx wrangler dev).
// Der Login-Code wird nur einmal angezeigt; gespeichert wird nur sein SHA-256.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SITE = 'https://watari09.github.io/clash-planner/';
const server = fileURLToPath(new URL('../server/', import.meta.url));
const args = process.argv.slice(2);
const local = args.includes('--local');
const [cmd, arg] = args.filter((a) => a !== '--local');
const where = local ? ['--local'] : ['--remote'];

const rand = (n) => randomBytes(n).toString('base64url');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const kv = (...a) => execFileSync('npx', ['wrangler', 'kv', 'key', ...a, '--binding', 'KV', ...where], { cwd: server, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (k, v) => kv('put', k, v);
const get = (k) => { try { return kv('get', k, '--text').trim(); } catch { return null; } };
const del = (k) => { try { kv('delete', k); } catch { /* schon weg */ } };
const user = (id) => { const v = get(`user:${id}`); return v ? JSON.parse(v) : null; };

function issue(id, u) {
  const code = rand(24);
  const token = sha(code);
  if (u.token) del(`token:${u.token}`);
  put(`token:${token}`, id);
  put(`user:${id}`, JSON.stringify({ ...u, token }));
  console.log(`\n${u.name} (${id})\nLogin-Link (nur jetzt sichtbar, privat weitergeben):\n  ${SITE}#login=${code}\n`);
}

if (cmd === 'add' && arg) {
  const id = rand(9);
  const widget = rand(16);
  put(`widget:${widget}`, id);
  issue(id, { name: arg, widget, created: new Date().toISOString() });
} else if (cmd === 'list') {
  const keys = JSON.parse(kv('list', '--prefix', 'user:'));
  if (!keys.length) console.log('Noch keine Logins.');
  for (const { name: k } of keys) {
    const id = k.slice(5);
    const u = user(id);
    console.log(`${id}  ${u?.name ?? '?'}  (seit ${u?.created?.slice(0, 10) ?? '?'})`);
  }
} else if (cmd === 'reset' && arg) {
  const u = user(arg);
  if (!u) { console.error('Unbekannte ID'); process.exit(1); }
  issue(arg, u);
} else if (cmd === 'remove' && arg) {
  const u = user(arg);
  if (!u) { console.error('Unbekannte ID'); process.exit(1); }
  if (u.token) del(`token:${u.token}`);
  if (u.widget) del(`widget:${u.widget}`);
  del(`data:${arg}`);
  del(`user:${arg}`);
  console.log(`${u.name} (${arg}) gelöscht.`);
} else {
  console.log(`Aufruf:
  node tools/users.mjs add "Name"     neuen Login anlegen
  node tools/users.mjs list           alle Logins
  node tools/users.mjs reset <id>     neuen Login-Link (alter wird ungültig)
  node tools/users.mjs remove <id>    Login samt Daten löschen
  (--local: lokale Entwicklungs-Datenbank)`);
}
