// Widget-Ansicht: liest den Stand vom Server (Kennung im #-Teil des Links) und zeigt kompakt,
// was frei ist und was als Nächstes fertig wird. Gedacht für Web-Widget-Apps auf dem Startbildschirm.

import { readVillage, analyze, GROUPS } from './village.js';
import { simulate } from './planner.js';
import { dashboard } from './dashboard.js';
import { applyEvents, slotsByGroup } from './state.js';
import { download } from './sync.js';
import { t, setLang, LANG, locale } from './i18n.js';

const $ = (id) => document.getElementById(id);
const id = location.hash.slice(1);
let game = null;
let state = null;
let loadedAt = 0;

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

const GROUP_CLASS = { home_builders: 'g-home', lab: 'g-lab', pets: 'g-pets', builder_builders: 'g-bb', star_lab: 'g-star' };
const short = { home_builders: { de: 'Bauarbeiter', en: 'Builder' }, lab: { de: 'Labor', en: 'Lab' }, pets: { de: 'Begleiter', en: 'Pets' }, builder_builders: { de: 'Nachtdorf', en: 'Builder Base' }, star_lab: { de: 'Sternlabor', en: 'Star Lab' } };

function clock(ms, now) {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return fmt.format(d);
  if (days === 1) return `${t('morgen')} ${fmt.format(d)}`;
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

function left(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

function render() {
  const now = Date.now();
  const village = readVillage(state.village);
  const r = analyze(village, game, LANG);
  applyEvents(r, (state.boosts || []).filter((e) => e.at >= r.exportedAt), game, village);
  const slots = slotsByGroup(r, now, state.slots || {});
  const b = { time: 0, cost: 0, ...(state.boost || {}) };
  const sim = simulate(village, game, state.plan || [], r.running, slots, { now, timeFactor: 1 - b.time / 100, costFactor: 1 - b.cost / 100, lang: LANG });
  const d = dashboard(r.running, sim, slots, { now, limit: 6 });
  const gname = (g) => short[g]?.[LANG] || GROUPS[g]?.[LANG] || g;

  const free = d.free.map((f) => el('li', { class: `free ${GROUP_CLASS[f.group] || ''}` },
    el('span', { class: 'at' }, t('frei')),
    el('span', { class: 'name' }, gname(f.group), f.next ? ` → ${f.next.name}` : '')));
  const next = d.upcoming.map((u) => el('li', { class: GROUP_CLASS[u.group] || '' },
    el('span', { class: 'at' }, clock(u.finishAt, now)),
    el('span', { class: 'name' }, `${u.name}${u.gearUp ? ` (${t('Gear-Up')})` : ` → ${u.level}`}`),
    el('span', { class: 'muted' }, left(u.finishAt - now))));

  const info = [];
  if (r.clockTowerReadyAt && !(state.quickHidden || []).includes('clockTower')) {
    info.push(el('span', {}, el('img', { class: 'ico', src: 'img/clockTower.webp', alt: '' }),
      r.clockTowerReadyAt <= now ? el('b', {}, t('Uhrenturm bereit')) : `${t('Uhrenturm')} ${clock(r.clockTowerReadyAt, now)}`));
  }
  const busyHeroes = r.running.filter((x) => x.section === 'heroes' && x.finishAt > now);
  info.push(el('span', {}, busyHeroes.length
    ? t('Helden im Ausbau: {n}', { n: busyHeroes.map((h) => h.name).join(', ') })
    : t('alle Helden bereit')));

  const age = now - r.exportedAt;
  $('w').replaceChildren(
    el('header', {},
      el('h1', {}, state.name || `${t('Rathaus {n}', { n: r.townHall })}`),
      el('span', { class: 'muted' }, t('Export vor {d}', { d: left(age) }))),
    free.length ? el('ul', {}, free) : null,
    el('ul', {}, next.length ? next : el('li', {}, el('span', { class: 'name muted' }, t('Nichts im Ausbau')))),
    el('div', { class: 'row' }, info));
}

async function load() {
  try {
    state = await download(id);
    loadedAt = Date.now();
    if (!state) { $('w').replaceChildren(el('p', { class: 'err' }, t('Kein Stand gefunden – auf der Seite unter „Widget“ einrichten.'))); return; }
    if (state.lang) setLang(state.lang);
    render();
  } catch (e) {
    if (state) render(); // offline: letzten Stand weiter anzeigen
    else $('w').replaceChildren(el('p', { class: 'err' }, t('Keine Verbindung zum Server.')));
  }
}

(async () => {
  if (!id) { $('w').replaceChildren(el('p', { class: 'err' }, t('Kein Widget-Link – auf der Seite unter „Widget“ einrichten.'))); return; }
  game = await (await fetch('data/game.json')).json();
  await load();
  // Zeiten jede Minute neu, Stand alle 10 Minuten neu laden
  setInterval(() => { if (Date.now() - loadedAt > 10 * 60e3) load(); else if (state) render(); }, 60e3);
})();
