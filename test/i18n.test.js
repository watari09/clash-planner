// Jeder Text, der in der Oberfläche über t() läuft, braucht eine englische Übersetzung –
// mit denselben Platzhaltern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EN } from '../src/i18n.js';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Texte aus t('…'), t(label) für Filter/Sortierung/Seltenheit/Blockaden, data-i18n im HTML
const keys = new Set([
  ...[...app.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")),
  ...[...app.matchAll(/\['\w+', '([^']+)'\]/g)].map((m) => m[1]), // FILTERS
  ...[...app.matchAll(/\{ de: '([^']+)', fn:/g)].map((m) => m[1]), // SORTS
  ...[...app.matchAll(/(?:common|epic|legendary): '([^']+)'/g)].map((m) => m[1]), // RARITY
  ...[...app.matchAll(/\{ hall: '([^']+)', lab: '([^']+)', gear: '([^']+)' \}/g)].flatMap((m) => m.slice(1)), // B.O.B.-Blockaden
  ...[...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]),
]);

test('alle Oberflächentexte haben eine englische Übersetzung', () => {
  const missing = [...keys].filter((k) => !(k in EN));
  assert.deepEqual(missing, []);
});

test('Platzhalter stimmen in beiden Sprachen überein', () => {
  const wrong = [...keys].filter((k) => k in EN && placeholders(k).join() !== placeholders(EN[k]).join());
  assert.deepEqual(wrong, []);
});

test('Fehlermeldungen beim Einlesen sind übersetzt', () => {
  const village = readFileSync(new URL('../src/village.js', import.meta.url), 'utf8');
  for (const m of village.matchAll(/throw new Error\('([^']+)'\)/g)) assert.ok(m[1] in EN, m[1]);
});
