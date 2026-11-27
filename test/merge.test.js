import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeKeys } from '../src/merge.js';

test('Abgleich: neuerer Wert gewinnt je Schlüssel, Löschen wird übernommen', () => {
  const base = { a: { v: '1', t: 10 }, b: { v: '2', t: 20 } };
  const { keys, changed } = mergeKeys(base, { a: { v: 'neu', t: 15 }, b: { v: 'alt', t: 5 }, c: { v: null, t: 30 } });
  assert.equal(changed, true);
  assert.deepEqual(keys, { a: { v: 'neu', t: 15 }, b: { v: '2', t: 20 }, c: { v: null, t: 30 } });
  assert.equal(mergeKeys(keys, { a: { v: 'x', t: 15 } }).changed, false); // Gleichstand: bleibt
  assert.equal(mergeKeys(keys, { a: { v: 5, t: 99 } }).changed, false); // ungültig
});
