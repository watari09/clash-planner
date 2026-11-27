import { readVillage, analyze, progress, schedule, toIcs, icsCalendar, formatDuration, levelEntry, RESOURCES, GROUPS } from './village.js';
import { dashboard, dayView } from './dashboard.js';
import { nextStep, nextEquipStep, gearCandidates, planInstances, simulate, cleanPlan, groupOf, HOME_GROUPS } from './planner.js';
import { BOOST_TYPES, applyBoosts, runningKey, helperDay } from './boosts.js';
import { magicItems } from './magic.js';
import { bobStatus, TASK_TEXT } from './bob.js';
import { oreStatus, ORES } from './ore.js';
import { wallStatus, wallAfford } from './walls.js';
import { heroAvailability } from './heroes.js';
import { suggest, DAY } from './suggest.js';
import { t, LANG, setLang, locale } from './i18n.js';

// localStorage-Schlüssel
const STORE_VILLAGES = 'planner.villages'; // { tag: json-text }
const STORE_CURRENT = 'planner.current'; // tag des angezeigten Dorfs
const STORE_NAMES = 'planner.names'; // { tag: eigener Name } – z. B. "Hauptdorf", "Zweitaccount"
const STORE_SLOTS = 'planner.slots'; // vom Nutzer geänderte Platzanzahl je Gruppe
const STORE_BOOST = 'planner.boost'; // { time: %, cost: % } z. B. Goldpass/Season-Boost
const LEGACY_VILLAGE = 'planner.village'; // alte Version: nur ein Dorf
const STORE_TAB = 'planner.tab';
const STORE_LIST = 'planner.list'; // { sort, showDone, exclude: [filterKey], builders: { home, builder } }
const FILTERS = [
  ['defense', 'Verteidigung'], ['resource', 'Ressourcen'], ['army', 'Armee'], ['other', 'Sonstige'], ['traps', 'Fallen'],
  ['troop', 'Truppen'], ['spell', 'Zauber'], ['siege', 'Belagerung'],
]; // Beschriftung wird über t() übersetzt
const planKey = () => `planner.plan.${village?.tag || 'Dorf'}`; // [{ id, to, n }] je Dorf
const boostKey = () => `planner.boosts.${village?.tag || 'Dorf'}`; // [{ type, at, target? }] je Dorf
const historyKey = () => `planner.history.${village?.tag || 'Dorf'}`; // [{ at, th, bh, home, builder }] je Export
const targetKey = () => `planner.target.${village?.tag || 'Dorf'}`; // { home, builder } Ziel-Rathaus/-Meisterhütte

const $ = (id) => document.getElementById(id);
let game = null;
let village = null;
const openCats = new Set(); // aufgeklappte Kategorien bleiben beim Neuzeichnen offen
const openInst = new Set(); // aufgeklappte Exemplar-Listen (je Objekt-ID)

// ---------- Speicher ----------

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const villages = () => readJson(STORE_VILLAGES, {});
const getPlan = () => readJson(planKey(), []);
const setPlan = (plan) => localStorage.setItem(planKey(), JSON.stringify(plan));
const getBoosts = () => readJson(boostKey(), []);
const setBoosts = (b) => localStorage.setItem(boostKey(), JSON.stringify(b));

/** Auswertung inkl. eingetragener Boosts – Grundlage für Übersicht, Kalender und Plan. */
function current() {
  const r = analyze(village, game, LANG);
  // Boosts vor dem Export stecken schon in den Timern → aufräumen
  const events = getBoosts().filter((e) => e.at >= r.exportedAt);
  if (events.length !== getBoosts().length) setBoosts(events);
  const { running, applied } = applyBoosts(r.running, events, game, village);
  r.running = running;
  for (const g of r.groups) g.items = running.filter((x) => x.group === g.key);
  r.boosts = applied;
  // Gemeinsamer 23-h-Arbeitstag der Helfer; jeder Helfer einmal pro Arbeitstag
  const day = helperDay(r.exportedAt, r.helpers[0]?.readyAt ?? r.exportedAt, events);
  r.helperDayEnd = day.dayEnd;
  for (const h of r.helpers) {
    const type = Object.keys(BOOST_TYPES).find((k) => BOOST_TYPES[k].helper === h.id);
    if (type) h.readyAt = day.readyAt(type);
  }
  const tower = applied.filter((a) => a.type === 'clockTower').at(-1);
  if (tower) r.clockTowerReadyAt = Math.max(r.clockTowerReadyAt || 0, tower.at + game.boosts.clockTower.cooldown * 1000);
  return r;
}
const boost = () => ({ time: 0, cost: 0, ...readJson(STORE_BOOST, {}) });

function migrate() {
  const old = localStorage.getItem(LEGACY_VILLAGE);
  if (!old) return;
  try {
    const v = readVillage(old);
    const all = villages();
    all[v.tag || 'Dorf'] ||= old;
    localStorage.setItem(STORE_VILLAGES, JSON.stringify(all));
    localStorage.setItem(STORE_CURRENT, v.tag || 'Dorf');
  } catch { /* kaputter Altbestand wird ignoriert */ }
  localStorage.removeItem(LEGACY_VILLAGE);
}

// ---------- Formatierung ----------

// Formatierer hängen von der Sprache ab → bei Bedarf neu anlegen
let fmtLang = null;
let fmtTime; let fmtToday; let fmtAmount; let fmtInt; let fmtDec;
function formats() {
  if (fmtLang === LANG) return;
  fmtLang = LANG;
  const loc = locale();
  fmtTime = new Intl.DateTimeFormat(loc, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  fmtToday = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' });
  fmtAmount = new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 });
  fmtInt = new Intl.NumberFormat(loc);
  fmtDec = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });
}
const pct = (x) => (LANG === 'de' ? `${fmtDec.format(x)} %` : `${fmtDec.format(x)}%`);

function when(ms) {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return t('heute {t}', { t: fmtToday.format(d) });
  if (d.toDateString() === tomorrow.toDateString()) return t('morgen {t}', { t: fmtToday.format(d) });
  return fmtTime.format(d);
}

function days(sec) {
  if (sec <= 0) return t('nichts');
  if (sec >= 10 * 86400) return t('{n} Tage', { n: Math.round(sec / 86400) });
  return sec >= 86400 ? t('{n} Tage', { n: fmtDec.format(Math.round(sec / 8640) / 10) }) : formatDuration(sec);
}

function costText(cost, factor = 1) {
  const parts = Object.entries(cost)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${fmtAmount.format(Math.round(n * factor))} ${(RESOURCES[r] || ORES[r])?.[LANG] || r}`);
  return parts.join(' · ') || '–';
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

// ---------- Laden ----------

function load(text) {
  let v;
  try {
    v = readVillage(text);
  } catch (e) {
    showError(t(e.message));
    return;
  }
  showError('');
  const tag = v.tag || 'Dorf';
  const all = villages();
  all[tag] = text.trim();
  localStorage.setItem(STORE_VILLAGES, JSON.stringify(all));
  localStorage.setItem(STORE_CURRENT, tag);
  $('manual-box').hidden = true;
  $('json').value = '';
  showInput = false;
  select(tag);
}

function select(tag) {
  const all = villages();
  const text = all[tag] ?? Object.values(all)[0];
  village = text ? readVillage(text) : null;
  if (village) localStorage.setItem(STORE_CURRENT, village.tag || 'Dorf');
  render();
}

// ---------- Anzeige ----------

let showInput = false; // Einfügen-Karte: immer ohne Dorf, sonst nur auf Wunsch

function render() {
  formats();
  pickerCache = null;
  $('result').hidden = !village;
  $('input').hidden = !!village && !showInput;
  renderSwitcher();
  if (!village || !game) return;
  const r = current();
  const now = Date.now();
  pickerBusy = new Map();
  for (const x of r.running) if (!x.gearUp) pickerBusy.set(x.id, [...(pickerBusy.get(x.id) || []), x.finishAt]);
  const age = now - r.exportedAt;
  const ageText = age < 60000 ? t('gerade eben') : t('vor {d}', { d: formatDuration(Math.round(age / 1000)) });

  $('summary').replaceChildren(...[
    el('span', { class: 'big' }, t('Rathaus {n}', { n: r.townHall }), r.builderHall ? t(' · Meisterhütte {n}', { n: r.builderHall }) : ''),
    el('span', { class: age > 12 * 3600e3 ? 'warn small' : 'muted small' },
      t('Export {age} ({when})', { age: ageText, when: when(r.exportedAt) }),
      age > 12 * 3600e3 ? t(' – für aktuelle Zeiten neu exportieren.') : ''),
  ]);

  recordHistory(r);
  renderRunning(r, now);
  renderExtras(r, now);
  renderProgress(r);
  renderPlan(r, now);
  renderDash(r, now);
  renderMagic(r, now);
  renderOre();
  showTab(localStorage.getItem(STORE_TAB) || 'dash');
}

function showTab(tab) {
  localStorage.setItem(STORE_TAB, tab);
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab;
}

let toastTimer = 0;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2200);
}

/** Plätze je Gruppe wie in der Übersicht: Schätzung bzw. eigene Angabe, mindestens so viele wie gerade laufen. */
function slotsByGroup(r, now) {
  const overrides = readJson(STORE_SLOTS, {});
  return Object.fromEntries(r.groups.map((g) => [
    g.key,
    Math.max(overrides[g.key] ?? g.slots, g.items.filter((i) => i.finishAt > now).length),
  ]));
}

function renderSwitcher() {
  const all = villages();
  const tags = Object.keys(all);
  const current = village?.tag || 'Dorf';
  const names = readJson(STORE_NAMES, {});
  const label = (tag) => (names[tag] ? `${names[tag]} (${tag})` : tag);
  // Rathaus je Dorf für die Auswahl (ohne alles neu auszuwerten)
  const hall = (tag) => {
    try { return readVillage(all[tag]).buildings.find((b) => b.data === 1000001)?.lvl; } catch { return null; }
  };
  $('switcher').hidden = !village;
  $('switcher').replaceChildren(
    tags.length > 1
      ? el('select', { 'aria-label': t('Dorf wählen'), onchange: (e) => select(e.target.value) },
        tags.map((tag) => el('option', { value: tag, selected: tag === current }, `${label(tag)}${hall(tag) ? ` · ${t('RH {n}', { n: hall(tag) })}` : ''}`)))
      : el('span', { class: 'muted' }, t('Gespeichert: {tag}', { tag: label(current) })),
    el('button', {
      class: 'ghost small',
      onclick: () => {
        const n = prompt(t('Name für {tag} (z. B. Hauptdorf, Zweitaccount):', { tag: current }), names[current] || '');
        if (n === null) return;
        const all2 = readJson(STORE_NAMES, {});
        if (n.trim()) all2[current] = n.trim().slice(0, 30); else delete all2[current];
        localStorage.setItem(STORE_NAMES, JSON.stringify(all2));
        renderSwitcher();
      },
    }, t('Umbenennen')),
    el('button', {
      class: 'ghost small',
      onclick: () => { showInput = !showInput; render(); if (showInput) $('input').scrollIntoView({ behavior: 'smooth' }); },
    }, showInput ? t('Schließen') : t('Neu einfügen')),
    el('button', {
      class: 'ghost small',
      onclick: () => {
        if (!confirm(t('Dorf {tag} aus diesem Browser entfernen?', { tag: current }))) return;
        const rest = villages();
        delete rest[current];
        localStorage.setItem(STORE_VILLAGES, JSON.stringify(rest));
        select(Object.keys(rest)[0]);
      },
    }, t('Entfernen')),
  );
}

function renderRunning(r, now) {
  const overrides = readJson(STORE_SLOTS, {});
  $('groups').replaceChildren(...r.groups.filter((g) => g.slots > 0 || g.items.length).map((g) => {
    const active = g.items.filter((i) => i.finishAt > now);
    // Die Schätzung aus dem Export kann zu niedrig sein – nie weniger Plätze als laufende Upgrades
    const slots = Math.max(overrides[g.key] ?? g.slots, active.length);
    const free = Math.max(0, slots - active.length);
    const head = el('div', { class: 'group-head' },
      el('h3', {}, GROUP_ICON[g.key] ? icon(GROUP_ICON[g.key], 'head-ico') : null, g.title),
      el('button', {
        class: `slots ${free ? 'free' : ''}`,
        title: t('Anzahl der Plätze ändern'),
        onclick: () => {
          const v = prompt(t('Wie viele Plätze hat „{g}“?', { g: g.title }), String(slots));
          if (v === null) return;
          const n = parseInt(v, 10);
          const o = readJson(STORE_SLOTS, {});
          if (Number.isFinite(n) && n >= 0) o[g.key] = n; else delete o[g.key];
          localStorage.setItem(STORE_SLOTS, JSON.stringify(o));
          render();
        },
      }, free ? t('{n} frei', { n: free }) : t('{a}/{b} belegt', { a: active.length, b: slots })),
    );
    const list = el('ul', { class: 'items' }, g.items.map((i) => {
      const left = Math.round((i.finishAt - now) / 1000);
      const key = `r:${i.id}:${i.finishAt}`;
      return el('li', { class: `${left <= 0 ? 'done' : ''} with-picker` },
        el('span', { class: 'name' }, i.name,
          el('span', { class: 'lvl' }, i.supercharge ? ` ⚡${i.supercharge}` : i.gearUp ? ` · ${t('Gear-Up')}` : ` → ${i.level}`),
          runningShare(i, now) != null ? el('span', { class: 'bar thin' }, el('span', { style: `width:${runningShare(i, now)}%` })) : null,
          i.helper || i.goblin || i.master ? el('span', { class: 'sub' }, [
            i.master ? t('Meisterbauarbeiter im Heimatdorf') : null,
            i.helper ? (i.group === 'lab' ? t('Laborgehilfe arbeitet mit') : t('Lehrling arbeitet mit')) : null,
            i.recurrentHelper ? t('täglich') : null,
            i.goblin ? t('Goblin-Bauarbeiter') : null,
          ].filter(Boolean).join(' · ')) : null),
        el('span', { class: 'time' },
          el('b', {}, left > 0 ? formatDuration(left) : t('fertig ✓')),
          el('span', { class: 'muted' }, when(i.finishAt))),
        el('span', { class: 'adds' }, planButton(key, i.group)),
        picker(key, i.group, i.finishAt),
      );
    }));
    if (!g.items.length) list.append(el('li', { class: 'muted' }, t('Nichts in Arbeit')));
    return el('section', { class: `card group ${groupClass(g.key)}` }, head, list);
  }));
}

/** Anteil eines laufenden Upgrades, der schon erledigt ist (für den Balken). */
function runningShare(i, now) {
  const item = game.items[String(i.id)];
  if (!item) return null;
  const total = i.gearUp
    ? item.gearUp?.sec
    : i.supercharge
      ? item.supercharge?.levels?.[i.supercharge - 1]?.[0]
      : levelEntry(item, i.level)?.[1];
  if (!total) return null;
  return Math.max(0, Math.min(100, 100 - ((i.finishAt - now) / 1000 / total) * 100));
}

/** Einen Boost (Trank, Helfer, Uhrenturm …) jetzt eintragen und die Wirkung melden. */
function logBoost(type, target, recurrent) {
  setBoosts([...getBoosts(), { type, at: Date.now(), ...(target ? { target } : {}), ...(recurrent ? { recurrent: true } : {}) }]);
  render();
  const last = current().boosts.filter((b) => b.type === type).at(-1);
  const name = BOOST_TYPES[type][LANG] || BOOST_TYPES[type].de;
  toast(last?.saved ? t('{b}: {d} gespart', { b: name, d: formatDuration(Math.round(last.saved / 1000)) }) : t('{b} eingetragen – betrifft gerade kein laufendes Upgrade', { b: name }));
}

// Farbe je Gruppe (CSS-Klasse) und kleine Symbole für Boosts
const groupClass = (g) => ({ home_builders: 'g-home', lab: 'g-lab', pets: 'g-pets', builder_builders: 'g-bb', star_lab: 'g-star', equipment: 'g-equip' }[g] || '');
const BOOST_ICON = { builderPotion: '🔨', researchPotion: '⚗', clockTowerPotion: '⏱', petPotion: '🐾', builderBite: '🍪', labLicorice: '🍲', clockTower: '⏱', builderApprentice: '👷', labAssistant: '🧑‍🔬' };
// Offizielle Symbole aus dem Spiel (tools/extract_sprites.py → img/)
const IMAGES = new Set(['builderPotion', 'researchPotion', 'clockTowerPotion', 'petPotion', 'clockTower', 'builderBite', 'labLicorice',
  'Gold', 'Elixir', 'DarkElixir', 'Gold2', 'Elixir2', 'Diamonds', 'CommonOre', 'RareOre', 'EpicOre',
  'book-fighting', 'book-spells', 'book-heroes', 'book-building', 'builder', 'masterBuilder', 'bob']);
const icon = (name, cls = 'ico') => (IMAGES.has(name) ? el('img', { src: `img/${name}.webp`, alt: '', class: cls, loading: 'lazy', decoding: 'async' }) : null);
const boostIcon = (type) => icon(type, 'q-img') || BOOST_ICON[type];
const GROUP_ICON = { home_builders: 'builder', builder_builders: 'masterBuilder' };

/** Kosten mit farbigem Ressourcen-Punkt je Ressource (statt nur Text). */
function costEl(cost, factor = 1) {
  const parts = Object.entries(cost || {}).filter(([, n]) => n > 0);
  if (!parts.length) return el('span', { class: 'muted' }, '–');
  return el('span', { class: 'costs' }, parts.map(([r, n]) => el('span', {
    class: `res res-${r} ${IMAGES.has(r) ? 'has-ico' : ''}`, title: (RESOURCES[r] || ORES[r])?.[LANG] || r,
  }, icon(r, 'res-ico'), fmtAmount.format(Math.round(n * factor)))));
}

function renderExtras(r, now) {
  const row = (name, at) => {
    const left = Math.round((at - now) / 1000);
    return el('li', {}, el('span', { class: 'name' }, name),
      el('span', { class: 'time' }, el('b', {}, left > 0 ? t('in {d}', { d: formatDuration(left) }) : t('bereit')),
        left > 0 ? el('span', { class: 'muted' }, when(at)) : null));
  };
  const ready = r.helpers.filter((h) => h.id === 93000000 || h.id === 93000001).map((h) => row(t('{name} (Stufe {n})', { name: h.name, n: h.level }), h.readyAt));
  if (r.helperDayEnd > now) ready.push(el('li', { class: 'muted small' }, t('Arbeitstag der Helfer endet {t} – jeder Helfer kann pro Arbeitstag einmal arbeiten.', { t: when(r.helperDayEnd) })));
  if (r.clockTowerReadyAt) ready.push(row(t('Uhrenturm'), r.clockTowerReadyAt));

  // Eintragen: welche Boosts passen zu diesem Dorf?
  const slots = slotsByGroup(r, now);
  const available = Object.entries(BOOST_TYPES).filter(([, d]) => d.groups.some((g) => (slots[g] || 0) > 0));
  const add = logBoost;
  // Helfer und Uhrenturm haben eine Abklingzeit: erst danach eintragbar
  const readyAt = (type, d) => (d.helper ? r.helpers.find((h) => h.id === d.helper)?.readyAt
    : type === 'clockTower' ? r.clockTowerReadyAt : 0) || 0;
  const lock = (type, d) => {
    const at = readyAt(type, d);
    return at > now ? { disabled: true, title: t('bereit {t}', { t: when(at) }) } : {};
  };
  const buttons = available.filter(([, d]) => !d.single).map(([type, d]) =>
    el('button', { class: 'ghost small boost-btn', onclick: () => add(type), ...lock(type, d) }, icon(type, 'btn-ico'), d[LANG] || d.de));
  const singles = available.filter(([, d]) => d.single).map(([type, d]) => {
    const options = r.running.filter((x) => d.groups.includes(x.group) && x.finishAt > now);
    if (!options.length) return null;
    const label = d[LANG] || d.de;
    const select = el('select', { 'aria-label': t('{b}: Upgrade wählen', { b: label }) },
      options.map((x) => el('option', { value: x.key }, `${x.name} → ${x.level}`)));
    const fixed = el('input', { type: 'checkbox' });
    return el('div', { class: 'assign' },
      el('div', { class: 'row' }, select,
        el('button', { class: 'ghost small', onclick: () => add(type, select.value, fixed.checked), ...lock(type, d) },
          readyAt(type, d) > now ? t('{b}: bereit {t}', { b: label, t: when(readyAt(type, d)) }) : t('{b} zuweisen', { b: label }))),
      el('label', { class: 'check small' }, fixed, t(' fest zuteilen (jeden Arbeitstag, bis es fertig ist)')));
  });

  const logged = (r.boosts || []).map((b, i) => el('li', {},
    el('span', { class: 'name' }, BOOST_TYPES[b.type]?.[LANG] || b.type, b.recurrent ? t(' (fest)') : '', el('br'), el('span', { class: 'muted small' }, when(b.at))),
    el('span', { class: 'time' }, el('b', {}, b.saved ? `−${formatDuration(Math.round(b.saved / 1000))}` : t('ohne Wirkung')),
      el('button', {
        class: 'ghost small',
        onclick: () => { const all = getBoosts().sort((a, c) => a.at - c.at); all.splice(i, 1); setBoosts(all); render(); },
      }, t('Rückgängig')))));

  $('extras').replaceChildren(
    el('h3', {}, t('Helfer & Boosts')),
    el('ul', { class: 'items' }, ready),
    el('p', { class: 'muted small' }, t('Gerade benutzt? Eintragen, dann rechnet die Seite die Fertig-Zeiten neu – auch für Kalender und Plan. Mit dem nächsten Export verfallen die Einträge (dann stecken sie schon in den Timern).')),
    el('div', { class: 'row boosts' }, buttons),
    ...singles.filter(Boolean),
    ...(logged.length ? [el('ul', { class: 'items' }, logged)] : []),
  );
  $('extras').hidden = false;
}

// Grobe Vergleichbarkeit der Ressourcen für "günstigste": Dunkles Elixier ist ca. 100× seltener
const RESOURCE_WEIGHT = { DarkElixir: 100 };
const nextCost = (i) => (i.next ? i.next.cost * (RESOURCE_WEIGHT[i.next.resource] || 1) : Infinity);
const totalCost = (i) => Object.entries(i.cost || {}).reduce((n, [r, v]) => n + v * (RESOURCE_WEIGHT[r] || 1), 0);
const nextSec = (i) => i.next?.seconds ?? Infinity;
const SORTS = {
  total: { de: 'Längste Restzeit zuerst', fn: (a, b) => b.seconds - a.seconds },
  shortest: { de: 'Kürzeste Restzeit zuerst', fn: (a, b) => a.seconds - b.seconds },
  fastest: { de: 'Schnellste nächste Stufe', fn: (a, b) => nextSec(a) - nextSec(b) },
  slowest: { de: 'Längste nächste Stufe', fn: (a, b) => (b.next?.seconds ?? -1) - (a.next?.seconds ?? -1) },
  cheapest: { de: 'Günstigste nächste Stufe', fn: (a, b) => nextCost(a) - nextCost(b) },
  priciest: { de: 'Teuerste nächste Stufe', fn: (a, b) => (b.next ? nextCost(b) : -1) - (a.next ? nextCost(a) : -1) },
  cheapTotal: { de: 'Geringste Gesamtkosten', fn: (a, b) => totalCost(a) - totalCost(b) },
  name: { de: 'Name A–Z', fn: (a, b) => a.name.localeCompare(b.name) },
};

/** Goldpass-Auswahl (gilt nur fürs Heimatdorf) – im Fortschritt und im Plan. */
function goldPassChips() {
  const b = boost();
  const preset = (pct, label) => el('button', {
    class: `chip ${b.time === pct && b.cost === pct ? 'on' : ''}`,
    onclick: () => { localStorage.setItem(STORE_BOOST, JSON.stringify({ time: pct, cost: pct })); render(); },
  }, label);
  const custom = (b.time || b.cost) && !(b.time === b.cost && [17, 20].includes(b.time));
  return el('div', { class: 'chips' }, el('span', { class: 'muted' }, t('Goldpass:')),
    preset(0, t('keiner')), preset(17, t('realistisch 17 %')), preset(20, t('voll 20 %')),
    custom ? el('span', { class: 'chip on' }, t('eigener: −{a} % Zeit, −{b} % Kosten', { a: b.time, b: b.cost })) : null,
    el('span', { class: 'muted small' }, t('nur Heimatdorf')));
}

function listControls() {
  const opts = { sort: 'total', showDone: false, exclude: [], ...readJson(STORE_LIST, {}) };
  const save = (patch) => { localStorage.setItem(STORE_LIST, JSON.stringify({ ...opts, ...patch })); render(); };
  return el('section', { class: 'card controls' },
    goldPassChips(),
    el('div', { class: 'chips' }, el('span', { class: 'muted' }, t('Zeigen:')),
      FILTERS.map(([key, label]) => el('button', {
        class: `chip ${opts.exclude.includes(key) ? '' : 'on'}`,
        onclick: () => save({ exclude: opts.exclude.includes(key) ? opts.exclude.filter((k) => k !== key) : [...opts.exclude, key] }),
      }, t(label)))),
    el('label', {}, t('Sortieren: '),
      el('select', { onchange: (e) => save({ sort: e.target.value }) },
        Object.entries(SORTS).map(([k, d]) => el('option', { value: k, selected: k === opts.sort }, t(d.de))))),
    el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: opts.showDone, onchange: (e) => save({ showDone: e.target.checked }) }),
      t(' Fertige zeigen')));
}

function itemRow(i, tf, cf, category) {
  const isWall = category === 'walls';
  const counts = {};
  for (const l of i.levels) counts[l] = (counts[l] || 0) + 1;
  const levelsText = Object.entries(counts).map(([l, n]) => (n > 1 ? `${n}× ${l}` : l)).join(' · ');
  const nextText = i.next
    ? t('nächste: {a}→{b} · {d}', { a: i.next.level - 1, b: i.next.level, d: i.next.seconds ? days(i.next.seconds * tf) : t('sofort') })
      + (i.next.cost ? ` · ${costText({ [i.next.resource]: i.next.cost }, cf)}` : '')
    : null;
  const done = !i.count;
  const multi = !done && !isWall && !i.supercharge && i.levels.length > 1;
  const open = multi && openInst.has(i.id);
  const instList = open ? el('ul', { class: 'inst' }, planInstances(village, getPlan(), i.id, i.missing).map((x, k) => {
    const planned = x.level > x.start;
    return el('li', {},
      el('span', { class: 'name' }, t('Exemplar {k}', { k: k + 1 }),
        el('span', { class: 'lvl' }, ` · ${t('Stufe {n}', { n: x.start })}`),
        planned ? el('span', { class: 'planned' }, ` → ${t('geplant {n}', { n: x.level })}`) : null),
      x.level < i.to
        ? el('button', { class: 'add small-add', title: t('Dieses Exemplar eine Stufe weiter planen'), 'aria-label': t('{name} {a}→{b} planen', { name: i.name, a: x.level, b: x.level + 1 }), onclick: () => addToPlan(i, 1, x.level) }, '+')
        : el('span', { class: 'muted small' }, '✓'));
  })) : null;
  return el('li', { class: `${done ? 'done-item' : ''} ${open ? 'open' : ''}` },
    el('span', { class: 'grow' },
      el('span', { class: 'name' }, i.name, el('span', { class: 'lvl' }, done ? ` ${i.to} ✓` : ` → ${i.to}`),
        (i.levels.length > 1 || isWall) && !done ? el('span', { class: 'sub' }, t('Stufen: {l}', { l: levelsText })) : null,
        nextText ? el('span', { class: 'sub' }, nextText) : null),
      done ? null : el('span', { class: 'time' }, el('b', {}, i.seconds ? days(i.seconds * tf) : t('sofort')),
        costEl(i.cost, cf))),
    done || i.supercharge ? null : el('span', { class: 'adds' },
      el('button', { class: 'add', title: t('Nächste Stufe planen'), 'aria-label': t('{name} planen', { name: i.name }), onclick: () => addToPlan(i) }, '+'),
      isWall ? el('button', { class: 'add ten', title: t('10 Mauern planen'), 'aria-label': t('10× {name} planen', { name: i.name }), onclick: () => addToPlan(i, 10) }, '+10') : null,
      multi ? el('button', {
        class: `add ten ${open ? 'on' : ''}`, title: t('Exemplar einzeln wählen'), 'aria-expanded': String(open),
        onclick: () => { if (openInst.has(i.id)) openInst.delete(i.id); else openInst.add(i.id); render(); },
      }, t('Einzeln')) : null),
    instList);
}

function renderProgress(r) {
  const targets = readJson(targetKey(), {});
  const list = { sort: 'total', showDone: false, exclude: [], builders: {}, ...readJson(STORE_LIST, {}) };
  const p = progress(village, game, LANG, targets, { exclude: list.exclude });
  const b = boost();
  const tf = 1 - b.time / 100;
  const cf = 1 - b.cost / 100;
  const overrides = readJson(STORE_SLOTS, {});
  const slotsOf = (key) => Math.max(1, overrides[key] ?? r.groups.find((g) => g.key === key)?.slots ?? 1);

  const sections = [];
  for (const [v, title, builderKey] of [
    ['home', t('Rathaus'), 'home_builders'],
    ['builder', t('Meisterhütte'), 'builder_builders'],
  ]) {
    const x = p[v];
    if (!x) continue;
    const builders = list.builders?.[v] || slotsOf(builderKey);
    const setBuilders = (n) => {
      const cur = { sort: 'total', showDone: false, exclude: [], builders: {}, ...readJson(STORE_LIST, {}) };
      cur.builders = { ...(cur.builders || {}), [v]: n };
      localStorage.setItem(STORE_LIST, JSON.stringify(cur));
      render();
    };
    const builderSelect = el('select', { class: 'inline', 'aria-label': t('Anzahl Bauarbeiter'), onchange: (e) => setBuilders(Number(e.target.value)) },
      Array.from({ length: v === 'home' ? 7 : 3 }, (_, i) => i + 1).map((n) => el('option', { value: n, selected: n === builders }, String(n))));
    // Goldpass wirkt nur im Heimatdorf
    const vtf = v === 'home' ? tf : 1;
    const vcf = v === 'home' ? cf : 1;
    const realistic = schedule(x.builderChains, builders) * vtf;
    const allCost = {};
    for (const c of x.categories) for (const [res, n] of Object.entries(c.cost)) allCost[res] = (allCost[res] || 0) + n;

    const hallItem = game.items[v === 'home' ? '1000001' : '1000034'];
    const maxHall = hallItem.levels.length;
    const picker = el('select', {
      class: 'target', 'aria-label': t('Ziel-{t}', { t: title }),
      onchange: (e) => {
        const t = readJson(targetKey(), {});
        t[v] = e.target.value === 'rush' ? 'rush' : Number(e.target.value);
        localStorage.setItem(targetKey(), JSON.stringify(t));
        render();
      },
    }, [
      x.current > 1 ? el('option', { value: 'rush', selected: x.rush }, t('Rush Fixer: Max {t} {n}', { t: title, n: x.current - 1 })) : null,
      ...Array.from({ length: maxHall - x.current + 1 }, (_, i) => x.current + i).map((n) =>
        el('option', { value: n, selected: !x.rush && n === x.hall }, n === x.current ? t('{t} {n} (aktuell)', { t: title, n }) : `${title} ${n}`)),
    ]);
    sections.push(el('section', { class: 'card progress' },
      el('div', { class: 'group-head' },
        el('h3', {}, t('Fortschritt bis')),
        el('span', { class: 'pct' }, pct(x.percent))),
      picker,
      bar(x.percent),
      el('p', { class: 'muted small' },
        x.rush
          ? t('Was noch unter dem Maximum von {t} {n} liegt – also aus dem Rush nachzuholen ist', { t: title, n: x.hall })
          : t('Anteil der Bauzeit bis zum Maximum für {t} {n}', { t: title, n: x.hall }),
        x.hall > x.current ? t(' – inklusive {t}-Upgrade und allem, was bis dahin freigeschaltet wird', { t: title }) : '',
        t('. Bauarbeiter-Zeit berücksichtigt, dass ein Gebäude oder Held nicht von zwei Bauarbeitern gleichzeitig gebaut wird'),
        t('. Nach Stufen gezählt: {p} %.', { p: fmtDec.format(x.levelPercent) })),
      el('dl', { class: 'facts' },
        el('dt', {}, t('Bauarbeiter')),
        el('dd', {}, days(realistic), t(' mit '), builderSelect, builders === 1 ? t(' Bauarbeiter') : t(' Bauarbeitern')),
        el('dt', {}, v === 'home' ? t('Labor') : t('Sternlabor')),
        el('dd', {}, days(x.labSeconds * vtf)),
        x.petSeconds ? el('dt', {}, t('Begleiterhaus')) : null,
        x.petSeconds ? el('dd', {}, days(x.petSeconds * vtf)) : null,
        el('dt', {}, t('Kosten')),
        el('dd', {}, costEl(allCost, vcf)),
      ),
      x.categories.filter((c) => c.total > 0).map((c) => el('details', {
        class: 'cat',
        open: openCats.has(`${v}:${c.key}`),
        ontoggle: (e) => { if (e.target.open) openCats.add(`${v}:${c.key}`); else openCats.delete(`${v}:${c.key}`); },
      },
        el('summary', {},
          el('span', { class: 'name' }, c.title),
          el('span', { class: 'cat-pct' }, c.items.length ? pct(c.percent) : t('fertig ✓'))),
        bar(c.percent),
        (c.items.length || (list.showDone && c.doneItems.length))
          ? el('ul', { class: 'items' },
            [...c.items].sort(SORTS[list.sort]?.fn || SORTS.total.fn).map((i) => itemRow(i, vtf, vcf, c.key)),
            list.showDone ? c.doneItems.map((i) => itemRow(i, vtf, vcf, c.key)) : null)
          : el('p', { class: 'muted small' }, t('Alles auf Maximum.')),
      )),
      v === 'home' ? gearList() : null,
    ));
  }
  $('progress').replaceChildren(...[listControls(), historyCard(), ...sections, renderWalls(cf), renderBob(), renderBoost(b)].filter(Boolean));
}

// ---------- Verlauf ----------

/** Je Export ein Schnappschuss des Fortschritts zum Maximum des aktuellen Rathauses bzw. der Meisterhütte. */
function recordHistory(r) {
  const list = readJson(historyKey(), []);
  if (list.some((x) => x.at === r.exportedAt)) return;
  const p = progress(village, game, LANG, {});
  list.push({ at: r.exportedAt, th: p.home?.current, bh: p.builder?.current, home: p.home?.percent, builder: p.builder?.percent });
  list.sort((a, b) => a.at - b.at);
  localStorage.setItem(historyKey(), JSON.stringify(list.slice(-300)));
}

/** Liniendiagramm einer Reihe (0–100 %), Unterbrechung bei neuer Halle; Punkte mit Tooltip. */
function historyChart(points, key, hallKey, hallName, color) {
  const W = 320; const H = 120; const P = { l: 30, r: 10, t: 10, b: 20 };
  const t0 = points[0].at; const t1 = points.at(-1).at;
  const lo = Math.max(0, Math.floor(Math.min(...points.map((x) => x[key])) / 10) * 10 - 10);
  const x = (at) => P.l + (t1 > t0 ? (at - t0) / (t1 - t0) : 0.5) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - lo) / (100 - lo)) * (H - P.t - P.b);
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, ...kids) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    for (const c of kids) e.append(c);
    return e;
  };
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'hist', role: 'img', 'aria-label': t('Verlauf {h}', { h: hallName }) });
  for (const v of [lo, (lo + 100) / 2, 100]) {
    svg.append(svgEl('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(svgEl('text', { x: P.l - 4, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, `${Math.round(v)}`));
  }
  const fmtDay = new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit' });
  svg.append(svgEl('text', { x: P.l, y: H - 4, class: 'axis' }, fmtDay.format(t0)));
  svg.append(svgEl('text', { x: W - P.r, y: H - 4, class: 'axis', 'text-anchor': 'end' }, fmtDay.format(t1)));
  // je Hallen-Stufe eine eigene Linie (beim Rathaus-Upgrade fällt der Prozentwert)
  let seg = [];
  const flush = () => {
    if (seg.length > 1) svg.append(svgEl('polyline', { points: seg.map((q) => `${x(q.at)},${y(q[key])}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    seg = [];
  };
  points.forEach((q, i) => { if (i && q[hallKey] !== points[i - 1][hallKey]) flush(); seg.push(q); });
  flush();
  for (const q of points) {
    const g = svgEl('g', { class: 'pt' },
      svgEl('circle', { cx: x(q.at), cy: y(q[key]), r: 10, fill: 'transparent' }),
      svgEl('circle', { cx: x(q.at), cy: y(q[key]), r: 4, fill: color, stroke: 'var(--card)', 'stroke-width': 2 }),
      svgEl('title', {}, `${when(q.at)} · ${hallName} ${q[hallKey]} · ${pct(q[key])}`));
    svg.append(g);
  }
  return svg;
}

function historyCard() {
  const list = readJson(historyKey(), []);
  const rows = [];
  for (const [key, hallKey, name, color] of [['home', 'th', t('Rathaus'), 'var(--c-home)'], ['builder', 'bh', t('Meisterhütte'), 'var(--c-bb)']]) {
    const pts = list.filter((q) => typeof q[key] === 'number');
    if (!pts.length) continue;
    const last = pts.at(-1);
    const sameHall = pts.filter((q) => q[hallKey] === last[hallKey]);
    const first = sameHall[0];
    const delta = last[key] - first[key];
    rows.push(el('div', { class: 'hist-row' },
      el('p', { class: 'small' }, el('b', {}, `${name} ${last[hallKey]}: ${pct(last[key])}`), ' ',
        sameHall.length > 1
          ? el('span', { class: 'muted' }, t('{d} seit {t} ({n} Exporte)', { d: `${delta >= 0 ? '+' : '−'}${pct(Math.abs(delta))}`, t: when(first.at), n: sameHall.length }))
          : null),
      pts.length > 1 ? historyChart(pts, key, hallKey, name, color) : null));
  }
  if (!rows.length) return null;
  const many = list.length > 1;
  return el('details', {
    class: 'card cat history', open: openCats.has('history'),
    ontoggle: (e) => { if (e.target.open) openCats.add('history'); else openCats.delete('history'); },
  },
    el('summary', {}, el('span', { class: 'name' }, t('Verlauf')), el('span', { class: 'cat-pct' }, t('{n} Exporte', { n: list.length }))),
    ...rows,
    el('p', { class: 'muted small' }, many
      ? t('Fortschritt zum Maximum der jeweiligen Halle, je Export ein Punkt. Nach einem Rathaus-Upgrade beginnt eine neue Linie.')
      : t('Mit jedem neuen Export kommt ein Punkt dazu – dann siehst du hier, wie schnell du vorankommst.')));
}

// ---------- Mauern ----------

const STORE_WALLS = 'planner.wallHave'; // { home: { Gold, Elixir }, builder: { Gold2, Elixir2 } }

/** "1,5 Mio", "1.5m", "800k", "1.500.000" → Zahl */
function parseAmount(text) {
  const s = String(text).trim().toLowerCase().replace(/\s/g, '');
  const m = s.match(/^([\d.,]+)(k|m|mio\.?|mrd\.?|b)?$/);
  if (!m) return 0;
  let num = m[1];
  // Tausenderpunkte (1.500.000) vs. Dezimalzeichen (1,5 / 1.5)
  if (/^\d{1,3}([.,]\d{3})+$/.test(num) && !m[2]) num = num.replace(/[.,]/g, '');
  else num = num.replace(',', '.');
  const f = { k: 1e3, m: 1e6, mio: 1e6, 'mio.': 1e6, mrd: 1e9, 'mrd.': 1e9, b: 1e9 }[m[2]] || 1;
  return Math.round((parseFloat(num) || 0) * f);
}

function renderWalls(cf) {
  const cards = [];
  for (const [which, title, res] of [['home', t('Mauern im Heimatdorf'), ['Gold', 'Elixir']], ['builder', t('Mauern im Nachtdorf'), ['Gold2', 'Elixir2']]]) {
    const st = wallStatus(village, game, which, which === 'home' ? cf : 1);
    if (!st) continue;
    const key = `walls:${which}`;
    const have = readJson(STORE_WALLS, {})[which] || {};
    const afford = wallAfford(village, game, which, have, which === 'home' ? cf : 1);
    const levelsLine = st.byLevel.map((x) => `${x.count}× ${x.level}`).join(' · ');
    const input = (r) => el('label', { class: 'have' }, icon(r, 'res-ico'), (RESOURCES[r]?.[LANG] || r), ' ',
      el('input', {
        type: 'text', inputmode: 'decimal', placeholder: t('z. B. 12 Mio'), value: have[r] ? fmtInt.format(have[r]) : '',
        onchange: (e) => {
          const all = readJson(STORE_WALLS, {});
          all[which] = { ...(all[which] || {}), [r]: parseAmount(e.target.value) };
          localStorage.setItem(STORE_WALLS, JSON.stringify(all));
          openCats.add(key);
          render();
        },
      }));
    const done = st.byLevel.every((x) => x.level >= st.max);
    cards.push(el('details', {
      class: 'card cat walls', open: openCats.has(key),
      ontoggle: (e) => { if (e.target.open) openCats.add(key); else openCats.delete(key); },
    },
      el('summary', {}, el('span', { class: 'name' }, title), el('span', { class: 'cat-pct' }, done ? t('fertig ✓') : t('{n} Stufen fehlen', { n: fmtInt.format(st.missingLevels) }))),
      el('p', { class: 'small' }, t('{n} Mauern: {l}', { n: st.total, l: levelsLine })),
      el('p', { class: 'muted small' }, t('Maximum bei dieser Halle: Stufe {n}.', { n: st.max }),
        which === 'home' && st.missingLevels ? t(' Mit Mauerringen: {n} Ringe bis alles auf Maximum ist (1 Ring = 1 Mauer eine Stufe).', { n: fmtInt.format(st.missingLevels) }) : ''),
      done ? null : el('ul', { class: 'items' }, st.steps.map((x) => el('li', {},
        el('span', { class: 'name' }, `${x.from}→${x.to}`, el('span', { class: 'sub' }, t('{n} Mauern × {c}', { n: x.count, c: fmtAmount.format(x.each) }))),
        el('span', { class: 'time' }, el('b', {}, fmtAmount.format(x.total)), el('span', { class: 'pay' }, x.pay.map((r) => icon(r, 'res-ico'))))))),
      done ? null : el('dl', { class: 'facts' },
        Object.entries(st.totals).flatMap(([r, n]) => [el('dt', {}, t('Alles mit {r}', { r: RESOURCES[r]?.[LANG] || r })), el('dd', {}, costEl({ [r]: n }))])),
      done ? null : el('p', { class: 'muted small' }, Object.keys(st.totals).length > 1 ? t('Beide Ressourcen lassen sich beliebig mischen.') : t('Die unteren Stufen gehen nur mit Gold; ab Stufe {n} auch mit Elixier.', { n: game.items[String(st.id)].alt?.from ?? '–' })),
      done ? null : el('div', { class: 'wall-calc' },
        el('h4', {}, t('Was schaffe ich mit meinen Ressourcen?')),
        el('div', { class: 'row boost' }, res.map(input)),
        afford && (have[res[0]] || have[res[1]])
          ? el('p', { class: 'small' }, afford.upgrades
            ? t('{n} Mauer-Stufen (niedrigste zuerst). Danach: {l}', { n: afford.upgrades, l: afford.byLevel.map((x) => `${x.count}× ${x.level}`).join(' · ') })
            : t('Reicht noch nicht für die nächste Mauer.'),
          afford.upgrades ? el('span', { class: 'sub' }, t('Verbraucht: '), costEl(afford.spent)) : null)
          : null)));
  }
  return cards.length ? el('div', { class: 'walls-wrap' }, ...cards) : null;
}

/** Gear-Ups im Heimatdorf (macht der Meisterbauarbeiter) – mit Stand der Voraussetzungen und Plan-Knopf. */
function gearList() {
  if (!village.buildings2?.length) return null;
  const cands = gearCandidates(village, game, LANG);
  if (!cands.length) return null;
  const planned = new Set(getPlan().filter((e) => e.kind === 'gear').map((e) => e.id));
  const key = 'home:gear';
  return el('details', {
    class: 'cat', open: openCats.has(key),
    ontoggle: (e) => { if (e.target.open) openCats.add(key); else openCats.delete(key); },
  },
    el('summary', {}, el('span', { class: 'name' }, t('Gear-Ups')),
      el('span', { class: 'cat-pct' }, `${cands.filter((c) => c.geared).length}/${cands.length}${cands.some((c) => c.gearing) ? ' ⏳' : ''}`)),
    el('ul', { class: 'items' }, cands.map((c) => {
      const okHome = c.homeLevel >= c.needHome;
      const okBB = c.bbLevel >= c.needBB;
      if (c.gearing) {
        return el('li', {}, el('span', { class: 'name' }, c.name, el('span', { class: 'lvl' }, ` · ${t('läuft')}`),
          el('span', { class: 'sub' }, t('Meisterbauarbeiter im Heimatdorf'))));
      }
      return el('li', { class: c.geared ? 'done-item' : '' },
        el('span', { class: 'grow' },
          el('span', { class: 'name' }, c.name, el('span', { class: 'lvl' }, c.geared ? ' ✓' : ''),
            c.geared ? null : el('span', { class: 'sub' },
              `${okHome ? '✓' : '○'} ${c.name} ${c.homeLevel}/${c.needHome} · ${okBB ? '✓' : '○'} ${c.bbName} ${c.bbLevel}/${c.needBB}`)),
          c.geared ? null : el('span', { class: 'time' }, el('b', {}, days(c.seconds)), costEl(c.cost))),
        c.geared ? null : el('span', { class: 'adds' },
          el('button', {
            class: 'add', title: t('Gear-Up planen'), 'aria-label': t('{name} planen', { name: c.name }),
            disabled: planned.has(c.id),
            onclick: () => { setPlan([...getPlan(), { kind: 'gear', id: c.id }]); toast(t('Gear-Up {name} geplant', { name: c.name })); render(); },
          }, '+')));
    })),
    el('p', { class: 'muted small' }, t('Ein Gear-Up macht der Meisterbauarbeiter – im Plan belegt es einen Nachtdorf-Bauarbeiter.')));
}

const STORE_BOB_TOWER = 'planner.bobTower'; // Uhrenturm in der B.O.B.-Schätzung (Standard: ja)
const bobChoiceKey = () => `planner.bobChoice.${village?.tag || 'Dorf'}`; // { Aufgabentyp: Objekt-ID }

function renderBob() {
  if (!village.buildings2?.length) return null;
  // Was im Plan steht, wird sowieso gebaut → zählt für die Aufgaben schon mit
  const planned = {};
  for (const e of getPlan()) if (!e.kind) planned[e.id] = Math.max(planned[e.id] || 0, e.to);
  const choices = readJson(bobChoiceKey(), {});
  const useTower = readJson(STORE_BOB_TOWER, true);
  const s = bobStatus(village, game, LANG, { planned, choice: choices, clockTower: useTower });
  if (s.control.unlocked) return null;
  const doneCount = s.tasks.filter((t) => t.done).length;
  const rows = [];
  rows.push(el('li', {},
    el('span', { class: 'name' }, `${s.control.built ? '✓' : '○'} ${t('B.O.B.s Zentrale bauen')}`,
      el('span', { class: 'sub' }, s.control.built
        ? t('Stufe {a} von {b} – jede erledigte Aufgabe schaltet eine Stufe frei', { a: s.control.level, b: s.control.max })
        : t('ab Meisterhütte {n}', { n: s.control.requiredHall }))),
    el('span', { class: 'time' }, el('b', {}, s.control.built ? `${s.control.level}/${s.control.max}` : '0/1'))));
  for (const task of s.tasks) {
    const text = TASK_TEXT[task.type]?.[LANG] || task.type;
    const label = task.type === 'GearUp' ? `${text}: ${task.target}` : `${text} ${task.target}`;
    const steps = task.steps.map((x) => {
      const before = (x.prereq || []).map((p) => `${p.name} ${p.from !== undefined ? `${p.from}→${p.to}` : t('auf {n}', { n: p.to })} (${days(p.seconds)})`);
      const main = x.gearUp
        ? t('{name} umrüsten ({d}, {c})', { name: x.name, d: days(x.seconds), c: costText(x.cost) })
        : `${x.name} ${x.from}→${x.to} (${days(x.seconds)})`;
      const via = x.viaPlan ? ` ${t('(ab Stufe {n} aus dem Plan bzw. für ein Gear-Up)', { n: x.from })}` : '';
      return (before.length ? t('{main} – vorher {before}', { main, before: before.join(', ') }) : main) + via;
    });
    // Verteidigung/Truppe: selbst wählen, welche es werden soll
    const pick = task.steps[0];
    const chooser = task.options?.length > 1 && !task.done ? el('div', { class: 'bob-choice' },
      el('select', {
        class: 'inline', 'aria-label': t('Welche soll es werden?'),
        onchange: (e) => {
          const c = readJson(bobChoiceKey(), {});
          c[task.type] = Number(e.target.value);
          localStorage.setItem(bobChoiceKey(), JSON.stringify(c));
          render();
        },
      }, task.options.map((o) => el('option', { value: o.id, selected: o.id === pick?.id },
        `${o.name} ${o.from}→${o.to} · ${days(o.seconds)}${o === task.options[0] ? ` · ${t('am schnellsten')}` : ''}`))),
      pick?.seconds ? el('button', {
        class: 'ghost small',
        onclick: () => addToPlan({ id: pick.id, name: pick.name, to: pick.to, missing: 0 }, pick.to - pick.from, pick.from),
      }, t('Einplanen')) : null) : null;
    const blocked = { hall: 'Meisterhütte zu niedrig', lab: 'Sternlabor zu niedrig', gear: 'nicht genug umrüstbare Gebäude' }[task.blocked];
    rows.push(el('li', {},
      el('span', { class: 'name' }, `${task.done ? '✓' : '○'} ${label}`,
        steps.map((x) => el('span', { class: 'sub' }, x)),
        chooser,
        blocked ? el('span', { class: 'sub warn' }, t(blocked)) : null),
      el('span', { class: 'time' }, el('b', {}, `${task.current}/${task.target}`))));
  }
  return el('section', { class: 'card progress' },
    el('div', { class: 'group-head' }, el('h3', {}, t('6. Bauarbeiter (B.O.B.)')), el('span', { class: 'pct' }, `${doneCount}/${s.tasks.length}`)),
    el('p', { class: 'muted small' }, t('Aufgaben aus den Spieldaten; für jede offene der kürzeste Weg (Helden-Stufen so verteilt, dass sie parallel möglichst schnell fertig werden). Was schon im Plan steht oder für ein Gear-Up nötig ist, zählt mit – bei Verteidigung und Truppe kannst du auch selbst wählen.')),
    el('ul', { class: 'items' }, rows),
    el('dl', { class: 'facts' },
      el('dt', {}, t('Nachtdorf-Bauarbeiter')), el('dd', {}, t('{d} mit {n}', { d: days(s.totals.builderSeconds), n: s.totals.bbBuilders })),
      el('dt', {}, t('Sternlabor')), el('dd', {}, days(s.totals.labSeconds)),
      el('dt', {}, t('Gear-Ups')), el('dd', {}, days(s.totals.gearSeconds)),
      el('dt', {}, t('Frühestens')), el('dd', {}, el('b', {}, days(s.totals.seconds))),
      el('dt', {}, t('Kosten')), el('dd', {}, costEl(s.totals.cost))),
    s.totals.clockTower.level ? el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: useTower, onchange: (e) => { localStorage.setItem(STORE_BOB_TOWER, JSON.stringify(e.target.checked)); render(); } }),
      t(' Uhrenturm täglich nutzen (Stufe {n}: Nachtdorf etwa {p} % schneller)', { n: s.totals.clockTower.level, p: Math.round((1 / (useTower ? s.totals.clockTower.factor : bobStatus(village, game, LANG, { planned, choice: choices }).totals.clockTower.factor) - 1) * 100) })) : null,
    el('p', { class: 'muted small' }, t('Engpass sind meist die Nachtdorf-Helden: ein Held wird nie von zwei Bauarbeitern gleichzeitig ausgebaut. Die Zeiten bei den Aufgaben sind reine Bauzeiten; „Frühestens“ rechnet mit allen Nachtdorf-Bauarbeitern, ab jetzt frei, und dem Uhrenturm.')),
  );
}

function bar(percent) {
  return el('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 },
    el('span', { style: `width:${percent}%` }));
}

function renderBoost(b) {
  const input = (key, label) => el('label', {},
    label,
    el('input', {
      type: 'number', min: 0, max: 90, step: 1, value: b[key], inputmode: 'numeric',
      onchange: (e) => {
        const n = Math.max(0, Math.min(90, parseInt(e.target.value, 10) || 0));
        localStorage.setItem(STORE_BOOST, JSON.stringify({ ...boost(), [key]: n }));
        render();
      },
    }),
    ' %');
  return el('section', { class: 'card' },
    el('h3', {}, t('Eigener Rabatt')),
    el('p', { class: 'muted small' }, t('Z. B. durch Goldpass oder Season-Boost. Gilt fürs Heimatdorf – im Fortschritt, im Plan und in der Tagesansicht; laufende Upgrades stehen schon mit echter Restzeit im Export.')),
    el('div', { class: 'row boost' }, input('time', t('Bauzeit −')), input('cost', t('Kosten −'))),
  );
}

// ---------- Plan ----------

function addToPlan(i, times = 1, from) {
  const plan = getPlan();
  const added = [];
  let base = from;
  for (let k = 0; k < times; k++) {
    // mit `from`: genau dieses Exemplar weiterplanen, sonst das niedrigste
    const step = nextStep(village, plan, i.id, i.to, i.missing, base);
    if (!step) break;
    plan.push(step);
    added.push(step);
    if (base !== undefined) base = step.to;
  }
  if (!added.length) {
    toast(t('{name}: schon alles bis Stufe {n} geplant', { name: i.name, n: i.to }));
    return;
  }
  setPlan(plan);
  toast(added.length === 1
    ? t('{name} {a}→{b} geplant', { name: i.name, a: added[0].to - 1, b: added[0].to })
    : t('{n}× {name} geplant', { n: added.length, name: i.name }));
  render();
}

function addEquipToPlan(i) {
  const plan = getPlan();
  const step = nextEquipStep(village, plan, i.id, i.to);
  if (!step) { toast(t('{name}: schon alles bis Stufe {n} geplant', { name: i.name, n: i.to })); return; }
  setPlan([...plan, step]);
  toast(t('{name} {a}→{b} geplant', { name: i.name, a: step.to - 1, b: step.to }));
  render();
}

function movePlan(index, delta) {
  const plan = getPlan();
  const j = index + delta;
  if (j < 0 || j >= plan.length) return;
  [plan[index], plan[j]] = [plan[j], plan[index]];
  setPlan(plan);
  render();
}

function removePlan(index) {
  const plan = getPlan();
  plan.splice(index, 1);
  setPlan(plan);
  render();
}

let lastSim = null;

function renderPlan(r, now) {
  const b = boost();
  const slots = slotsByGroup(r, now);
  let plan = getPlan();
  let sim = simulate(village, game, plan, r.running, slots, { now, timeFactor: 1 - b.time / 100, costFactor: 1 - b.cost / 100, lang: LANG });
  // Laut neuem Export erledigte Einträge entfernen
  const cleaned = cleanPlan(plan, sim.dropped);
  if (cleaned.length !== plan.length) {
    const n = plan.length - cleaned.length;
    plan = cleaned;
    setPlan(plan);
    sim = simulate(village, game, plan, r.running, slots, { now, timeFactor: 1 - b.time / 100, costFactor: 1 - b.cost / 100, lang: LANG });
    toast(n === 1 ? t('1 geplantes Upgrade ist schon erledigt') : t('{n} geplante Upgrades sind schon erledigt', { n }));
  }
  lastSim = sim;

  $('plan-count').textContent = String(plan.length);
  $('plan-count').hidden = !plan.length;

  if (!plan.length) {
    $('plan').replaceChildren(el('section', { class: 'card controls' }, goldPassChips()), el('section', { class: 'card' },
      el('h3', {}, t('Noch nichts geplant')),
      el('p', { class: 'muted' }, t('Im Reiter „Fortschritt“ eine Kategorie aufklappen und beim gewünschten Upgrade auf + tippen. Jedes Tippen plant die nächste Stufe.')),
      el('p', { class: 'muted small' }, t('Der Plan verteilt die Upgrades auf deine Bauarbeiter bzw. das Labor – sobald einer frei wird – und zeigt, wann du welche Ressourcen bereithalten musst.'))));
    return;
  }

  const blocked = new Map(sim.dropped.filter((d) => d.reason === 'blocked').map((d) => [d.index, d]));
  const row = (index, content, cls = '') => el('li', { class: `plan-step ${cls}` },
    el('span', { class: 'grow' }, ...content),
    el('span', { class: 'tools' },
      el('button', { class: 'ghost', title: t('früher'), 'aria-label': t('nach oben'), onclick: () => movePlan(index, -1) }, '↑'),
      el('button', { class: 'ghost', title: t('später'), 'aria-label': t('nach unten'), onclick: () => movePlan(index, 1) }, '↓'),
      el('button', { class: 'ghost', title: t('entfernen'), 'aria-label': t('entfernen'), onclick: () => removePlan(index) }, '✕')));

  const cards = [...Object.keys(GROUPS), 'equipment'].map((g) => {
    const steps = sim.steps.filter((s) => s.group === g);
    const groupFor = (d) => (d.kind === 'equip' ? 'equipment' : d.kind === 'gear' ? 'builder_builders' : groupOf(game.items[String(d.id)]));
    const blockedHere = [...blocked.values()].filter((d) => game.items[String(d.id)] && groupFor(d) === g);
    if (!steps.length && !blockedHere.length) return null;
    const items = [
      ...steps.map((s) => ({ index: s.index, node: row(s.index, [
        el('span', { class: 'name' }, s.kind === 'gear' ? t('{name} umrüsten', { name: s.name }) : s.name,
          s.kind === 'gear' ? null : el('span', { class: 'lvl' }, ` ${s.from}→${s.to}`),
          el('br'), Object.keys(s.costs).length ? costEl(s.costs) : el('span', { class: 'muted small' }, t('kostenlos'))),
        s.kind === 'equip'
          ? el('span', { class: 'time' }, el('b', {}, t('sofort')))
          : el('span', { class: 'time' }, el('b', {}, t('ab {t}', { t: when(s.start) })),
            el('span', { class: 'muted' }, t('fertig {t}', { t: when(s.end) }))),
      ]) })),
      ...blockedHere.map((d) => ({ index: d.index, node: row(d.index, [
        el('span', { class: 'name' },
          d.kind === 'gear' ? t('{name} umrüsten', { name: game.items[String(d.id)].name[LANG] }) : `${game.items[String(d.id)].name[LANG]} ${d.to - 1}→${d.to}`,
          el('br'), el('span', { class: 'small' }, d.kind === 'gear' && d.gear
            ? t('Voraussetzung fehlt: {a} {b}/{c}, {d} {e}/{f}', { a: d.gear.name, b: d.gear.homeLevel, c: d.gear.needHome, d: d.gear.bbName, e: d.gear.bbLevel, f: d.gear.needBB })
            : t('Erst die Stufe davor planen bzw. weiter nach oben schieben.'))),
      ], 'blocked') })),
    ].sort((a, b2) => a.index - b2.index);
    return el('section', { class: 'card group' },
      el('div', { class: 'group-head' }, el('h3', {}, g === 'equipment' ? t('Ausrüstung') : GROUPS[g][LANG]),
        g === 'equipment' ? null : el('span', { class: 'muted small' }, t('{n} Plätze', { n: slots[g] || 0 }))),
      el('ul', { class: 'items' }, items.map((x) => x.node)));
  });

  const needs = el('section', { class: 'card' },
    el('h3', {}, t('Wann du welche Ressourcen brauchst')),
    el('p', { class: 'muted small' }, t('Zum Start jedes Upgrades muss die Summe bereitliegen. Rechts: Gesamtbedarf bis dahin.')),
    el('ul', { class: 'items' }, sim.needs.filter((s) => Object.keys(s.costs).length).map((s) => el('li', {},
      el('span', { class: 'name' }, el('b', {}, s.kind === 'equip' ? t('sofort') : when(s.start)), el('br'),
        s.kind === 'gear' ? t('{name} umrüsten', { name: s.name }) : `${s.name} ${s.from}→${s.to}`, el('br'),
        costEl(s.costs)),
      el('span', { class: 'time' }, el('span', { class: 'cum' }, t('bis dahin')),
        el('b', {}, costEl(Object.fromEntries(Object.keys(s.costs).map((k) => [k, s.cumulative[k]])))))))),
    el('dl', { class: 'facts' }, el('dt', {}, t('Gesamt')), el('dd', {}, costEl(sim.total))),
    el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: downloadPlanIcs }, t('Starts in Kalender')),
      el('button', { class: 'ghost', onclick: () => { if (confirm(t('Ganzen Plan löschen?'))) { setPlan([]); render(); } } }, t('Plan leeren'))),
  );

  const clash = heroAvailability(village, game, r.running, sim.steps, now, LANG).overlaps.filter((o) => o.planned);
  $('plan').replaceChildren(el('section', { class: 'card controls' }, goldPassChips()), heroWarning(clash), ...cards.filter(Boolean), needs);
}

function downloadPlanIcs() {
  if (!lastSim) return;
  const tag = (village.tag || 'dorf').replace(/[^A-Z0-9]/gi, '');
  const now = Date.now();
  const events = lastSim.steps.filter((s) => s.start > now).map((s) => {
    const what = s.kind === 'gear' ? t('{name} umrüsten', { name: s.name }) : `${s.name} ${s.from}→${s.to}`;
    return {
      uid: `${tag}-plan-${s.kind || 'lvl'}-${s.id}-${s.to || 0}-${Math.round(s.start / 60000)}`,
      start: s.start,
      title: t('{what} starten', { what }),
      description: Object.keys(s.costs).length ? t('{c} bereithalten.', { c: costText(s.costs) }) : '',
      alarm: t('Jetzt {what} starten', { what }),
    };
  });
  if (!events.length) { toast(t('Alle geplanten Starts sind schon jetzt möglich.')); return; }
  download(icsCalendar(events), 'clash-plan.ics');
}

function download(text, name) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- Dashboard ----------

let openPicker = null; // Schlüssel der aufgeklappten Plan-Auswahl
let dayIndex = 0; // angezeigter Tag im Karussell
let pickerCache = null; // Fortschritt je Render, für die Auswahl
let pickerBusy = new Map(); // Objekt-ID → Fertig-Zeiten laufender Upgrades

/**
 * Kandidaten für einen Platz, der zum Zeitpunkt `at` frei wird: offene Upgrades der passenden Kategorien,
 * die dann auch startbar sind (nicht alle Exemplare noch im Ausbau), sortiert wie im Fortschritt.
 */
function candidatesFor(group, at = Date.now()) {
  if (!pickerCache) {
    const list = { sort: 'total', exclude: [], ...readJson(STORE_LIST, {}) };
    pickerCache = { p: progress(village, game, LANG, readJson(targetKey(), {}), { exclude: list.exclude }), sort: list.sort };
  }
  const { p, sort } = pickerCache;
  const map = {
    home_builders: ['home', ['buildings', 'traps', 'heroes', 'walls']],
    lab: ['home', ['lab']],
    pets: ['home', ['pets']],
    builder_builders: ['builder', ['buildings', 'traps', 'heroes', 'walls']],
    star_lab: ['builder', ['lab']],
  };
  const [v, cats] = map[group] || [];
  if (!v || !p[v]) return [];
  return p[v].categories.filter((c) => cats.includes(c.key)).flatMap((c) => c.items)
    .filter((i) => i.count && !i.supercharge)
    // Freischalten (0→1) macht bei Truppen/Zaubern/Begleitern die Kaserne bzw. das Begleiterhaus, nicht das Labor
    .filter((i) => !(['lab', 'star_lab', 'pets'].includes(group) && i.next?.level === 1))
    // alle offenen Exemplare stecken zu diesem Zeitpunkt noch im Ausbau (z. B. ein Held) → nicht startbar
    .filter((i) => i.count > (pickerBusy.get(i.id) || []).filter((f) => f > at + 1000).length)
    .sort(SORTS[sort]?.fn || SORTS.total.fn);
}

/** "+"-Knopf, der eine Auswahl passender nächster Upgrades für diesen Platz aufklappt. */
function planButton(key, group, at) {
  const open = openPicker === key;
  return el('button', {
    class: `add ${open ? 'on' : ''}`, title: t('Nächstes Upgrade für diesen Platz planen'), 'aria-expanded': String(open),
    onclick: () => { openPicker = open ? null : key; render(); },
  }, open ? '–' : '+');
}

function picker(key, group, at) {
  if (openPicker !== key) return null;
  const items = candidatesFor(group, at);
  const shown = items.slice(0, 8);
  return el('div', { class: 'picker' },
    el('div', { class: 'muted small' }, t('Was soll danach kommen? (Sortierung wie im Fortschritt)')),
    shown.length
      ? el('ul', { class: 'items' }, shown.map((i) => el('li', {},
        el('span', { class: 'name' }, i.name,
          i.next ? el('span', { class: 'sub' }, `${i.next.level - 1}→${i.next.level} · ${i.next.seconds ? days(i.next.seconds) : t('sofort')} `, i.next.cost ? costEl({ [i.next.resource]: i.next.cost }) : null) : null),
        el('button', { class: 'add small-add', 'aria-label': t('{name} planen', { name: i.name }), onclick: () => { openPicker = null; addToPlan(i); } }, '+'))))
      : el('p', { class: 'muted small' }, t('Nichts mehr offen.')),
    el('button', { class: 'ghost small', onclick: () => { openPicker = null; showTab('progress'); } },
      items.length > shown.length ? t('Alle {n} im Fortschritt', { n: items.length }) : t('Zum Fortschritt')));
}

function renderDash(r, now) {
  const slots = slotsByGroup(r, now);
  const sim = lastSim || simulate(village, game, getPlan(), r.running, slots, { now, lang: LANG });
  const d = dashboard(r.running, sim, slots, { now, limit: 200 });
  const follow = new Map(d.upcoming.map((u) => [`${u.id}:${u.finishAt}`, u.next]));
  // Starts, die schon als "Danach" bei einer Fertigstellung bzw. einem freien Platz stehen, nicht doppelt zeigen
  const shownSteps = new Set([...d.upcoming.map((u) => u.next?.index), ...d.free.map((f) => f.next?.index)].filter((x) => x !== undefined));
  const daysList = dayView(r.running, sim, now, 7);
  const gname = (g) => GROUPS[g]?.[LANG] || g;
  const stepText = (s) => (s.kind === 'gear' ? t('{name} umrüsten', { name: s.name }) : `${s.name} ${s.from}→${s.to}`);
  const clock = (ms) => fmtToday.format(new Date(ms));

  // Eine Zeile "X wird fertig" – mit dem, was danach kommt, und einem + für weitere Planung
  const finishRow = (e) => {
    const u = e.item;
    const next = e.next ?? follow.get(`${u.id}:${u.finishAt}`);
    const key = `f:${u.id}:${u.finishAt}`;
    return el('li', { class: `ev ${groupClass(u.group)}` },
      el('span', { class: 'grow' },
        el('span', { class: 'at' }, clock(e.at)),
        el('span', { class: 'name' }, t('{name} fertig', { name: `${u.name}${u.gearUp ? ` (${t('Gear-Up')})` : u.supercharge ? ` ⚡${u.supercharge}` : ` → ${u.level}`}` }),
          el('span', { class: 'sub' }, gname(u.group), e.planned ? el('span', { class: 'tag' }, t('geplant')) : null),
          next
            ? el('span', { class: 'next' }, t('Danach: {what}', { what: stepText(next) }),
              Object.keys(next.costs).length ? el('span', { class: 'prep' }, t('bereitlegen:'), ' ', costEl(next.costs)) : null)
            : el('span', { class: 'next none' }, t('Danach: nichts geplant')))),
      el('span', { class: 'adds' }, planButton(key, u.group)),
      picker(key, u.group, u.finishAt));
  };
  const startRow = (e) => el('li', { class: 'ev start' },
    el('span', { class: 'grow' },
      el('span', { class: 'at' }, e.at <= now + 60e3 ? t('jetzt') : clock(e.at)),
      el('span', { class: 'name' }, t('Starten: {what}', { what: stepText(e.step) }),
        el('span', { class: 'sub' }, gname(e.step.group)),
        Object.keys(e.step.costs).length ? el('span', { class: 'prep' }, costEl(e.step.costs)) : null)));
  const visible = (entries) => entries.filter((e) => e.type === 'finish' || !shownSteps.has(e.step.index));
  const rowOf = (e) => (e.type === 'finish' ? finishRow(e) : startRow(e));
  const rows = (entries) => visible(entries).map(rowOf);

  // ----- Heute zu tun -----
  const todayBucket = daysList.find((b) => b.today) || { entries: [], prepare: {} };
  const todo = [];
  const dayTimes = { ...DAY, ...readJson(STORE_DAY, {}) };
  const suggested = new Set();
  let anySuggestion = false;
  for (const [k, f] of d.free.entries()) {
    const key = `free:${f.group}:${k}`;
    // nichts geplant → Vorschlag, der zur Tageszeit passt
    const factor = HOME_GROUPS.has(f.group) ? 1 - boost().time / 100 : 1;
    const sug = f.next ? null : suggest(candidatesFor(f.group, now), now, factor, dayTimes, suggested);
    if (sug) { suggested.add(sug.item.id); anySuggestion = true; }
    todo.push(el('li', { class: 'ev free' },
      el('span', { class: 'grow' },
        el('span', { class: 'at' }, t('jetzt')),
        el('span', { class: 'name' }, t('{g}: Platz frei', { g: gname(f.group) }),
          f.next ? el('span', { class: 'next' }, t('Jetzt starten: {what}', { what: stepText(f.next) }))
            : el('span', { class: 'next none' }, t('Nichts geplant für diesen Platz')),
          sug ? el('span', { class: 'suggest' },
            t('Vorschlag: {name} {a}→{b} · {d}', { name: sug.item.name, a: sug.item.next.level - 1, b: sug.item.next.level, d: days(sug.seconds) }),
            el('span', { class: 'sub' }, sug.mode === 'day'
              ? (sug.fits ? t('fertig {t} – vor dem Schlafengehen, dann gleich nachlegen', { t: when(now + sug.seconds * 1000) }) : t('läuft über Nacht – nichts Kürzeres offen'))
              : (sug.fits ? t('läuft bis {t} – der Platz arbeitet die ganze Nacht', { t: when(now + sug.seconds * 1000) }) : t('fertig {t} – nichts Längeres offen', { t: when(now + sug.seconds * 1000) }))),
            el('button', { class: 'ghost small', onclick: () => addToPlan(sug.item) }, t('Einplanen'))) : null)),
      el('span', { class: 'adds' }, planButton(key, f.group)),
      picker(key, f.group, now)));
  }
  const readyNow = r.helpers.filter((h) => (h.id === 93000000 || h.id === 93000001) && h.readyAt <= now).map((h) => h.name);
  if (readyNow.length) todo.push(el('li', { class: 'ev free' }, el('span', { class: 'grow' }, el('span', { class: 'at' }, t('jetzt')), el('span', { class: 'name' }, t('Bereit: ') + readyNow.join(', ')))));
  // Uhrenturm: bereit (mit Knopf) oder heute wieder bereit – ausblendbar über "Anpassen" in der Trank-Leiste
  const tower = r.clockTowerReadyAt;
  const endOfToday = new Date(now).setHours(24, 0, 0, 0);
  const timed = []; // Einträge mit Uhrzeit, chronologisch einsortiert
  if (tower && !quickHidden().includes('clockTower') && tower < endOfToday) {
    const ready = tower <= now;
    timed.push({ at: Math.max(tower, now), node: el('li', { class: 'ev g-bb' },
      el('span', { class: 'grow' },
        el('span', { class: 'at' }, ready ? t('jetzt') : clock(tower)),
        el('span', { class: 'name' }, icon('clockTower', 'head-ico'), ready ? t('Uhrenturm bereit') : t('Uhrenturm wieder bereit'),
          el('span', { class: 'sub' }, t('Boost für das Nachtdorf – nach dem Benutzen hier eintragen')))),
      ready ? el('span', { class: 'adds' }, el('button', { class: 'ghost small', onclick: () => logBoost('clockTower') }, t('Benutzt'))) : null) });
  }
  // geplante Starts "jetzt" sind schon bei den freien Plätzen erwähnt
  for (const e of visible(todayBucket.entries.filter((x) => !(x.type === 'start' && x.at <= now + 60e3)))) timed.push({ at: e.at, node: rowOf(e) });
  todo.push(...timed.sort((a, b) => a.at - b.at).map((x) => x.node));

  const cards = [el('section', { class: 'card today' },
    el('div', { class: 'group-head' }, el('h3', {}, t('Heute zu tun')), el('span', { class: 'muted small' }, new Intl.DateTimeFormat(locale(), { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(now)))),
    todo.length ? el('ul', { class: 'items' }, todo) : el('p', { class: 'muted' }, t('Heute steht nichts an.')),
    anySuggestion ? dayTimesLine(dayTimes) : null,
    Object.keys(todayBucket.prepare).length ? el('p', { class: 'prep-line' }, t('Heute bereitlegen:'), ' ', costEl(todayBucket.prepare)) : null)];
  cards.push(quickBoosts(r, now));
  cards.push(heroCard(r, now));

  if (!d.planned) {
    cards.push(el('section', { class: 'card hint-card' },
      el('h3', {}, t('Noch kein Plan')),
      el('p', { class: 'muted small' }, t('Tippe bei einem Upgrade auf + und wähle, was danach kommen soll – dann steht hier zu jedem Tag, was du starten und bereitlegen musst.'))));
  }

  // ----- Nächste Tage als Karussell (wischen oder Pfeile) -----
  const future = daysList.filter((x) => !x.today);
  if (future.length) {
    const slides = future.map((b) => {
      const date = new Date(b.day);
      const tomorrow = b.day - new Date(now).setHours(0, 0, 0, 0) === 86400e3;
      return el('section', { class: 'card day slide' },
        el('div', { class: 'group-head' },
          el('h3', {}, tomorrow ? t('Morgen') : new Intl.DateTimeFormat(locale(), { weekday: 'long', day: '2-digit', month: '2-digit' }).format(date)),
          Object.keys(b.prepare).length ? costEl(b.prepare) : null),
        el('ul', { class: 'items' }, rows(b.entries)));
    });
    const track = el('div', { class: 'carousel', tabindex: '0', 'aria-label': t('Nächste Tage') }, slides);
    const label = el('span', { class: 'muted small' });
    const index = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    const update = () => {
      const i = Math.min(index(), slides.length - 1);
      label.textContent = `${i + 1} / ${slides.length}`;
      prev.disabled = i <= 0;
      next.disabled = i >= slides.length - 1;
      dayIndex = i;
    };
    const go = (d) => track.scrollTo({ left: (index() + d) * track.clientWidth, behavior: 'smooth' });
    const prev = el('button', { class: 'ghost small', 'aria-label': t('vorheriger Tag'), onclick: () => go(-1) }, '‹');
    const next = el('button', { class: 'ghost small', 'aria-label': t('nächster Tag'), onclick: () => go(1) }, '›');
    track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
    cards.push(el('div', { class: 'carousel-wrap' },
      el('div', { class: 'carousel-head' }, el('h3', {}, t('Nächste Tage')), el('span', { class: 'carousel-nav' }, prev, label, next)),
      track));
    // nach dem Neuzeichnen am selben Tag bleiben
    requestAnimationFrame(() => { track.scrollLeft = Math.min(dayIndex, slides.length - 1) * track.clientWidth; update(); });
  }
  $('dash').replaceChildren(...cards.filter(Boolean));
}

/** Schnell-Leiste: die häufigsten Tränke mit einem Tipp eintragen; zeigt, ob gerade einer wirkt. */
const STORE_DAY = 'planner.day'; // { wake, sleep } – Stunden, für Vorschläge

function dayTimesLine(d) {
  const sel = (key) => el('select', {
    class: 'inline', 'aria-label': key === 'wake' ? t('Aufstehen') : t('Schlafengehen'),
    onchange: (e) => { localStorage.setItem(STORE_DAY, JSON.stringify({ ...d, [key]: Number(e.target.value) })); render(); },
  }, Array.from({ length: 24 }, (_, h) => el('option', { value: h, selected: h === d[key] }, `${h}:00`)));
  return el('p', { class: 'muted small day-times' }, t('Vorschläge passend zu deinem Tag: wach von '), sel('wake'), t(' bis '), sel('sleep'), '.');
}

// ---------- Helden ----------

const heroName = (id) => game.items[String(id)]?.name[LANG] || `#${id}`;

/** Warnung: mehrere Helden gleichzeitig im Ausbau (nur Zeiträume mit geplanten Upgrades). */
function heroWarning(overlaps) {
  if (!overlaps.length) return null;
  return el('section', { class: 'card warn-card' },
    el('h3', {}, t('Mehrere Helden gleichzeitig im Ausbau')),
    el('ul', { class: 'items' }, overlaps.map((o) => el('li', {},
      el('span', { class: 'name' }, o.ids.map(heroName).join(' + '),
        el('span', { class: 'sub' }, t('{a} bis {b}', { a: when(o.from), b: when(o.to) })))))),
    el('p', { class: 'muted small' }, t('In dieser Zeit fehlen dir die Helden bei Angriffen und im Clankrieg. Mit ↑/↓ lässt sich ein Helden-Upgrade verschieben.')));
}

function heroCard(r, now) {
  const { heroes, overlaps } = heroAvailability(village, game, r.running, lastSim?.steps || [], now, LANG);
  if (!heroes.length) return null;
  const allReady = Math.max(...heroes.map((h) => h.readyAt));
  return el('section', { class: 'card heroes' },
    el('div', { class: 'group-head' }, el('h3', {}, t('Helden')),
      el('span', { class: 'muted small' }, allReady <= now ? t('alle bereit') : t('alle bereit {t}', { t: when(allReady) }))),
    el('ul', { class: 'items' }, heroes.map((h) => {
      const next = h.busy.find((b) => b.planned && b.from > h.readyAt);
      return el('li', { class: h.readyAt > now ? 'busy' : 'ready' },
        el('span', { class: 'grow' },
          el('span', { class: 'name' }, h.name, el('span', { class: 'lvl' }, ` ${h.level}`),
            h.readyAt > now
              ? el('span', { class: 'sub' }, t('im Ausbau → {n}', { n: h.busy.filter((b) => b.to <= h.readyAt).at(-1)?.level ?? h.level + 1 }),
                h.busy.some((b) => b.planned && b.to <= h.readyAt) ? el('span', { class: 'tag' }, t('geplant')) : null)
              : null,
            next ? el('span', { class: 'sub' }, t('nächstes geplant: {t}', { t: when(next.from) })) : null),
          el('span', { class: 'time' }, el('b', {}, h.readyAt > now ? when(h.readyAt) : t('bereit ✓')))));
    })),
    overlaps.length ? el('p', { class: 'warn small' }, t('Achtung: {n}× sind mehrere Helden gleichzeitig im Ausbau – Details im Plan.', { n: overlaps.length })) : null);
}

const STORE_QUICK = 'planner.quickHidden'; // ausgeblendete Knöpfe der Trank-Leiste
const quickHidden = () => readJson(STORE_QUICK, []);
let quickEdit = false;

/** Schnell-Leiste: Tränke und Uhrenturm mit einem Tipp eintragen; Knöpfe über "Anpassen" ein-/ausblendbar. */
function quickBoosts(r, now) {
  const slots = slotsByGroup(r, now);
  const bb = !!(slots.builder_builders || slots.star_lab);
  const all = ['builderPotion', 'researchPotion', ...(bb ? ['clockTowerPotion', 'clockTower'] : [])];
  const hidden = quickHidden();
  const types = quickEdit ? all : all.filter((x) => !hidden.includes(x));
  const toggle = (type) => {
    const h = quickHidden();
    localStorage.setItem(STORE_QUICK, JSON.stringify(h.includes(type) ? h.filter((x) => x !== type) : [...h, type]));
    render();
  };
  const towerFamily = (x) => x === 'clockTower' || x === 'clockTowerPotion';
  return el('section', { class: 'card quick' },
    el('div', { class: 'group-head' },
      el('h3', {}, t('Tränke & Uhrenturm')),
      el('button', { class: 'ghost small', onclick: () => { quickEdit = !quickEdit; render(); } }, quickEdit ? t('Fertig') : t('Anpassen'))),
    el('div', { class: 'quick-row' }, types.map((type) => {
      const active = (r.boosts || []).filter((b) => (b.type === type || (towerFamily(type) && towerFamily(b.type))) && b.end > now)
        .reduce((m, b) => Math.max(m, b.end), 0);
      // Uhrenturm: kostenlos, aber mit Abklingzeit
      const cooling = type === 'clockTower' && r.clockTowerReadyAt > now;
      const iconEl = el('span', { class: 'q-icon', 'aria-hidden': 'true' }, boostIcon(type));
      const name = el('span', { class: 'q-name' }, BOOST_TYPES[type][LANG] || BOOST_TYPES[type].de);
      if (quickEdit) {
        const off = hidden.includes(type);
        return el('button', { class: `quick-btn q-${type} ${off ? 'off' : 'active'}`, onclick: () => toggle(type) },
          iconEl, name, el('span', { class: 'q-state' }, off ? t('ausgeblendet') : t('sichtbar')));
      }
      return el('button', { class: `quick-btn q-${type} ${active ? 'active' : ''}`, onclick: () => logBoost(type), disabled: cooling && !active },
        iconEl, name,
        el('span', { class: 'q-state' }, active
          ? t('aktiv bis {t}', { t: fmtToday.format(new Date(active)) })
          : cooling ? t('bereit {t}', { t: when(r.clockTowerReadyAt) }) : t('jetzt eintragen')));
    })),
    el('p', { class: 'muted small' }, quickEdit
      ? t('Tippe auf einen Knopf, um ihn ein- oder auszublenden. Der Uhrenturm verschwindet dann auch aus „Heute zu tun“.')
      : t('Mehrfach tippen = mehrere Tränke (verlängert die Dauer). Rückgängig unter „Laufend“ → Helfer & Boosts.')));
}

// ---------- Magische Gegenstände ----------

function renderMagic(r, now) {
  const m = magicItems(village, game, r.running, now, LANG);
  $('magic').replaceChildren(
    el('section', { class: 'card' },
      el('h3', {}, t('Wo lohnt sich ein Buch?')),
      el('p', { class: 'muted small' }, t('Ein Buch beendet ein Upgrade sofort – am meisten bringt es beim längsten. Berücksichtigt wird, was du jetzt starten kannst (Rathaus- bzw. Labor-Stufe); ⏳ = läuft schon, gezählt wird die Restzeit.'))),
    ...Object.entries(m).map(([key, book]) => el('section', { class: 'card group' },
      el('h3', {}, icon(`book-${key}`, 'head-ico'), book.title),
      book.items.length
        ? el('ol', { class: 'items ranking' }, book.items.map((i) => el('li', {},
          el('span', { class: 'name' }, i.name, el('span', { class: 'lvl' }, ` → ${i.to}`)),
          el('span', { class: 'time' }, el('b', {}, `${i.running ? '⏳ ' : ''}${formatDuration(i.seconds)}`)))))
        : el('p', { class: 'muted small' }, t('Nichts, wofür sich das Buch gerade lohnt.')))),
  );
}

// ---------- Erz-Rechner ----------

const STORE_ORE = 'planner.ore'; // { useBlacksmith: bool }
const RARITY = { common: 'gewöhnlich', epic: 'episch', legendary: 'legendär' }; // über t() übersetzt


function renderOre() {
  const opts = { useBlacksmith: false, ...readJson(STORE_ORE, {}) };
  const s = oreStatus(village, game, LANG, opts);
  $('ore').replaceChildren(
    el('section', { class: 'card' },
      el('h3', {}, t('Erz bis zum Maximum')),
      el('p', { class: 'muted small' }, t('Für jede Ausrüstung, die du besitzt: Erz von der aktuellen bis zur höchsten Stufe.')),
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: opts.useBlacksmith, onchange: (e) => { localStorage.setItem(STORE_ORE, JSON.stringify({ useBlacksmith: e.target.checked })); render(); } }),
        t(' Nur bis zur aktuellen Schmied-Stufe ({n})', { n: s.blacksmith })),
      el('dl', { class: 'facts' }, Object.keys(ORES).flatMap((k) => [el('dt', {}, icon(k, 'res-ico'), ORES[k][LANG]), el('dd', {}, el('b', {}, fmtInt.format(s.total[k] || 0)))]))),
    ...s.heroes.map((h) => el('section', { class: 'card group' },
      el('div', { class: 'group-head' }, el('h3', {}, h.name), el('span', { class: 'muted small' }, t('{a}/{b} besessen', { a: h.owned, b: h.items.length }))),
      el('p', { class: 'small' }, Object.keys(h.ore).length ? costEl(h.ore) : t('fertig ✓')),
      el('ul', { class: 'items' }, h.items.map((i) => el('li', { class: i.owned ? '' : 'done-item' },
        el('span', { class: 'grow' },
          el('span', { class: 'name' }, i.name, el('span', { class: 'sub' },
            (RARITY[i.rarity] ? t(RARITY[i.rarity]) : i.rarity) + (i.owned ? t(' · Stufe {a} → {b}', { a: i.level, b: i.to }) : t(' · nicht freigeschaltet')))),
          el('span', { class: 'time small' }, i.owned ? (Object.keys(i.ore).length ? costEl(i.ore) : t('fertig ✓')) : '–')),
        i.owned && i.level < i.to ? el('span', { class: 'adds' },
          el('button', { class: 'add', title: t('Nächste Stufe planen'), 'aria-label': t('{name} planen', { name: i.name }), onclick: () => addEquipToPlan(i) }, '+')) : null))))),
  );
}

// ---------- Kalender ----------

function downloadIcs() {
  download(toIcs(current(), Date.now(), LANG), 'clash-upgrades.ics');
}

// ---------- Start ----------

$('paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) throw new Error('leer');
    load(text);
  } catch {
    // Häufigster Fall: Der Browser hat beim ersten Mal um Erlaubnis gefragt und den Versuch dabei abgebrochen.
    // Kein Auto-Fokus aufs Textfeld, sonst springt die Tastatur auf.
    showError(t('Die Zwischenablage ließ sich nicht lesen. Hat dein Browser gerade um Erlaubnis gefragt? Dann erlauben und nochmal auf „Einfügen“ tippen. Sonst über „Von Hand einfügen“.'));
  }
});
$('manual').addEventListener('click', () => { $('manual-box').hidden = false; $('json').focus(); });
$('load').addEventListener('click', () => load($('json').value));
$('ics').addEventListener('click', downloadIcs);
for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));

/** Feste Texte der Seite (data-i18n = deutscher Text als Schlüssel, data-i18n-html mit HTML). */
function translatePage() {
  document.documentElement.lang = LANG;
  for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
  for (const e of document.querySelectorAll('[data-i18n-html]')) e.innerHTML = t(e.dataset.i18nHtml);
  $('lang').value = LANG;
}
$('lang').addEventListener('change', (e) => {
  setLang(e.target.value);
  translatePage();
  if (game) render();
});

// Hinweis „Zum Home-Bildschirm“: nur im Browser (nicht als installierte App) und bis man ihn schließt
const STORE_INSTALL = 'planner.installHint';
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
$('install').hidden = standalone || localStorage.getItem(STORE_INSTALL) === 'closed';
$('install-close').addEventListener('click', () => { localStorage.setItem(STORE_INSTALL, 'closed'); $('install').hidden = true; });

(async () => {
  translatePage();
  formats();
  game = await (await fetch('data/game.json')).json();
  $('data-version').textContent = game.version;
  migrate();
  select(localStorage.getItem(STORE_CURRENT));
  setInterval(render, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
})();

// Offline: Seite und Spieldaten zwischenspeichern (sw.js). Nicht auf localhost-Entwicklung angewiesen.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Offline-Modus weiter */ });
}
