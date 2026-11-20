import { readVillage, analyze, toIcs, formatDuration } from './village.js';

const STORE_JSON = 'planner.village';
const STORE_SLOTS = 'planner.slots'; // vom Nutzer geänderte Platzanzahl je Gruppe
const $ = (id) => document.getElementById(id);

let game = null;
let village = null;

const fmtTime = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtToday = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

function when(ms) {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `heute ${fmtToday.format(d)}`;
  if (d.toDateString() === tomorrow.toDateString()) return `morgen ${fmtToday.format(d)}`;
  return fmtTime.format(d);
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

function slotOverrides() {
  try { return JSON.parse(localStorage.getItem(STORE_SLOTS)) || {}; } catch { return {}; }
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

function load(text, { save = true } = {}) {
  try {
    village = readVillage(text);
  } catch (e) {
    showError(e.message);
    return;
  }
  showError('');
  if (save) localStorage.setItem(STORE_JSON, text.trim());
  $('manual-box').hidden = true;
  render();
}

function render() {
  if (!village || !game) return;
  const r = analyze(village, game);
  const now = Date.now();
  const overrides = slotOverrides();

  const age = now - r.exportedAt;
  const ageText = age < 60000 ? 'gerade eben' : `vor ${formatDuration(Math.round(age / 1000))}`;
  $('summary').replaceChildren(
    el('p', { class: 'big' }, `Rathaus ${r.townHall}`, r.builderHall ? ` · Meisterhütte ${r.builderHall}` : ''),
    r.tag ? el('p', { class: 'muted' }, `Spieler ${r.tag}`) : null,
    el('p', { class: age > 12 * 3600e3 ? 'warn' : 'muted' },
      `Export ${ageText} (${when(r.exportedAt)})`,
      age > 12 * 3600e3 ? ' – für aktuelle Zeiten neu exportieren.' : ''),
  );

  $('groups').replaceChildren(...r.groups.filter((g) => g.slots > 0 || g.items.length).map((g) => {
    const active = g.items.filter((i) => i.finishAt > now);
    // Die Schätzung aus dem Export kann zu niedrig sein (z. B. Nachtdorf) – nie weniger Plätze als laufende Upgrades
    const slots = Math.max(overrides[g.key] ?? g.slots, active.length);
    const free = Math.max(0, slots - active.length);
    const head = el('div', { class: 'group-head' },
      el('h3', {}, g.title),
      el('button', {
        class: `slots ${free ? 'free' : ''}`,
        title: 'Anzahl der Plätze ändern',
        onclick: () => {
          const v = prompt(`Wie viele Plätze hat „${g.title}“?`, String(slots));
          if (v === null) return;
          const n = parseInt(v, 10);
          const o = slotOverrides();
          if (Number.isFinite(n) && n >= 0) o[g.key] = n; else delete o[g.key];
          localStorage.setItem(STORE_SLOTS, JSON.stringify(o));
          render();
        },
      }, free ? `${free} frei` : `${active.length}/${slots} belegt`),
    );
    const list = el('ul', { class: 'items' }, g.items.map((i) => {
      const left = Math.round((i.finishAt - now) / 1000);
      return el('li', { class: left <= 0 ? 'done' : '' },
        el('span', { class: 'name' }, i.name, el('span', { class: 'lvl' }, ` → ${i.level}`)),
        el('span', { class: 'time' },
          el('b', {}, left > 0 ? formatDuration(left) : 'fertig ✓'),
          el('span', { class: 'muted' }, when(i.finishAt))),
      );
    }));
    if (!g.items.length) list.append(el('li', { class: 'muted' }, 'Nichts in Arbeit'));
    return el('section', { class: 'card group' }, head, list);
  }));

  const extras = [];
  for (const h of r.helpers) {
    const left = Math.round((h.readyAt - now) / 1000);
    extras.push(el('li', {}, el('span', { class: 'name' }, `${h.name} (Stufe ${h.level})`),
      el('span', { class: 'time' }, el('b', {}, left > 0 ? `in ${formatDuration(left)}` : 'bereit'), left > 0 ? el('span', { class: 'muted' }, when(h.readyAt)) : null)));
  }
  if (r.clockTowerReadyAt) {
    const left = Math.round((r.clockTowerReadyAt - now) / 1000);
    extras.push(el('li', {}, el('span', { class: 'name' }, 'Uhrenturm-Boost'),
      el('span', { class: 'time' }, el('b', {}, left > 0 ? `in ${formatDuration(left)}` : 'bereit'), left > 0 ? el('span', { class: 'muted' }, when(r.clockTowerReadyAt)) : null)));
  }
  $('extras').replaceChildren(el('h3', {}, 'Helfer & Boosts'), el('ul', { class: 'items' }, extras));
  $('extras').hidden = !extras.length;

  $('result').hidden = false;
}

function downloadIcs() {
  const r = analyze(village, game);
  const blob = new Blob([toIcs(r)], { type: 'text/calendar;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'clash-upgrades.ics' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

$('paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) throw new Error('leer');
    load(text);
  } catch {
    // Häufigster Fall: Der Browser hat beim ersten Mal um Erlaubnis gefragt und den Versuch dabei abgebrochen.
    // Kein Auto-Fokus aufs Textfeld, sonst springt die Tastatur auf.
    showError('Die Zwischenablage ließ sich nicht lesen. Hat dein Browser gerade um Erlaubnis gefragt? Dann erlauben und nochmal auf „Einfügen“ tippen. Sonst über „Von Hand einfügen“.');
  }
});
$('manual').addEventListener('click', () => { $('manual-box').hidden = false; $('json').focus(); });
$('load').addEventListener('click', () => load($('json').value));
$('ics').addEventListener('click', downloadIcs);

(async () => {
  game = await (await fetch('data/game.json')).json();
  $('data-version').textContent = game.version;
  const saved = localStorage.getItem(STORE_JSON);
  if (saved) load(saved, { save: false });
  setInterval(render, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
})();
