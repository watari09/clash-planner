import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from '../src/suggest.js';

const c = (id, h) => ({ id, name: `#${id}`, next: { seconds: h * 3600 } });
const list = [c(1, 1), c(2, 5), c(3, 9), c(4, 14), c(5, 30), { id: 6, next: { seconds: 0 } }];
const at = (h) => new Date(2026, 10, 27, h, 0, 0).getTime();

test('tagsüber: längstes, das vor 22 Uhr fertig wird', () => {
  assert.equal(suggest(list, at(12)).item.id, 3); // 10 h bis 22 Uhr → 9 h
  assert.equal(suggest(list, at(21)).item.id, 1); // 1 h
  assert.equal(suggest([c(5, 30)], at(12)).fits, false);
});

test('abends: kürzestes, das bis 8 Uhr läuft', () => {
  assert.equal(suggest(list, at(23)).item.id, 3); // 9 h bis 8 Uhr → 9 h
  assert.equal(suggest(list, at(22)).item.id, 4); // 10 h → 14 h
  assert.equal(suggest(list, at(23), 1, undefined, new Set([3])).item.id, 4);
  assert.equal(suggest([{ id: 6, next: { seconds: 0 } }], at(23)), null);
});
