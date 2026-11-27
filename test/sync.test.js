import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../src/sync.js';
import { mergeKeys } from '../src/merge.js';

class Store {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i]; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

// Mini-Server wie server/worker.js (ein Konto)
function server() {
  let data = {};
  const fetch = async (url, opts = {}) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (opts.headers?.Authorization !== 'Bearer CODE_CODE_CODE_CODE_1') return { ok: false, status: 401 };
    if (url.endsWith('/me')) return ok({ name: 'Test', widget: 'W', keys: data });
    if (url.endsWith('/me/keys')) { data = mergeKeys(data, JSON.parse(opts.body).keys).keys; return ok({ keys: data }); }
    return { ok: false, status: 404 };
  };
  return { fetch, get: () => data };
}

test('zwei Geräte gleichen sich ab, neuere Änderung gewinnt', async () => {
  const srv = server();
  let clock = 1000;
  const a = new Store(); const b = new Store();
  const sa = createSync(a, srv.fetch, () => clock);
  const sb = createSync(b, srv.fetch, () => clock);
  a.setItem('planner.plan.#T', '[1]'); // vor dem Login, ohne Zeitstempel? → wird mitgezählt
  await sa.login('CODE_CODE_CODE_CODE_1');
  await sa.push();
  assert.equal(srv.get()['planner.plan.#T'].v, '[1]');

  await sb.login('CODE_CODE_CODE_CODE_1');
  assert.equal(b.getItem('planner.plan.#T'), '[1]');
  assert.equal(sb.auth().name, 'Test');

  clock = 2000; b.setItem('planner.plan.#T', '[1,2]'); await sb.push();
  clock = 3000; a.setItem('planner.boost', '{"time":20}'); await sa.push();
  await sa.pull();
  assert.equal(a.getItem('planner.plan.#T'), '[1,2]');
  await sb.pull();
  assert.equal(b.getItem('planner.boost'), '{"time":20}');

  // Löschen wird übertragen, gerätelokale Schlüssel nicht
  clock = 4000; a.removeItem('planner.boost'); a.setItem('planner.tab', 'plan'); await sa.push();
  await sb.pull();
  assert.equal(b.getItem('planner.boost'), null);
  assert.equal(b.getItem('planner.tab'), null);
});

test('falscher Code: Anmeldung schlägt fehl und bleibt abgemeldet', async () => {
  const s = createSync(new Store(), server().fetch);
  await assert.rejects(s.login('FALSCHFALSCHFALSCH12345'));
  assert.equal(s.auth(), null);
});
