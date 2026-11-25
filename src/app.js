import { readVillage, analyze, progress, schedule, toIcs, icsCalendar, formatDuration, levelEntry, RESOURCES, GROUPS } from './village.js';
import { dashboard, dayView } from './dashboard.js';
import { nextStep, nextEquipStep, gearCandidates, planInstances, simulate, cleanPlan, groupOf } from './planner.js';
import { BOOST_TYPES, applyBoosts, runningKey, helperDay } from './boosts.js';
import { magicItems } from './magic.js';
import { bobStatus, TASK_TEXT } from './bob.js';
import { oreStatus, ORES } from './ore.js';
import { t, LANG, setLang, locale } from './i18n.js';

// localStorage-Schlüssel
const STORE_VILLAGES = 'planner.villages'; // { tag: json-text }
const STORE_CURRENT = 'planner.current'; // tag des angezeigten Dorfs
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
  $('switcher').hidden = !village;
  $('switcher').replaceChildren(
    tags.length > 1
      ? el('select', { 'aria-label': t('Dorf wählen'), onchange: (e) => select(e.target.value) },
        tags.map((t) => el('option', { value: t, selected: t === current }, t)))
      : el('span', { class: 'muted' }, t('Gespeichert: {tag}', { tag: current })),
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
      el('h3', {}, g.title),
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
    return el('section', { class: `card group ${g.key.startsWith('builder') || g.key === 'star_lab' ? 'bb' : 'home'}` }, head, list);
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
  const add = (type, target, recurrent) => {
    setBoosts([...getBoosts(), { type, at: Date.now(), ...(target ? { target } : {}), ...(recurrent ? { recurrent: true } : {}) }]);
    render();
    const last = current().boosts.at(-1);
    const name = BOOST_TYPES[type][LANG] || BOOST_TYPES[type].de;
    toast(last?.saved ? t('{b}: {d} gespart', { b: name, d: formatDuration(Math.round(last.saved / 1000)) }) : t('{b} eingetragen – betrifft gerade kein laufendes Upgrade', { b: name }));
  };
  // Helfer und Uhrenturm haben eine Abklingzeit: erst danach eintragbar
  const readyAt = (type, d) => (d.helper ? r.helpers.find((h) => h.id === d.helper)?.readyAt
    : type === 'clockTower' ? r.clockTowerReadyAt : 0) || 0;
  const lock = (type, d) => {
    const at = readyAt(type, d);
    return at > now ? { disabled: true, title: t('bereit {t}', { t: when(at) }) } : {};
  };
  const buttons = available.filter(([, d]) => !d.single).map(([type, d]) =>
    el('button', { class: 'ghost small', onclick: () => add(type), ...lock(type, d) }, d[LANG] || d.de));
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

function listControls() {
  const opts = { sort: 'total', showDone: false, exclude: [], ...readJson(STORE_LIST, {}) };
  const save = (patch) => { localStorage.setItem(STORE_LIST, JSON.stringify({ ...opts, ...patch })); render(); };
  const b = boost();
  const preset = (pct, label) => el('button', {
    class: `chip ${b.time === pct && b.cost === pct ? 'on' : ''}`,
    onclick: () => { localStorage.setItem(STORE_BOOST, JSON.stringify({ time: pct, cost: pct })); render(); },
  }, label);
  return el('section', { class: 'card controls' },
    el('div', { class: 'chips' }, el('span', { class: 'muted' }, t('Goldpass:')),
      preset(0, t('keiner')), preset(17, t('realistisch 17 %')), preset(20, t('voll 20 %'))),
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
        el('span', { class: 'muted' }, costText(i.cost, cf)))),
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
    const realistic = schedule(x.builderChains, builders) * tf;
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
        el('dd', {}, days(x.labSeconds * tf)),
        x.petSeconds ? el('dt', {}, t('Begleiterhaus')) : null,
        x.petSeconds ? el('dd', {}, days(x.petSeconds * tf)) : null,
        el('dt', {}, t('Kosten')),
        el('dd', {}, costText(allCost, cf)),
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
            [...c.items].sort(SORTS[list.sort]?.fn || SORTS.total.fn).map((i) => itemRow(i, tf, cf, c.key)),
            list.showDone ? c.doneItems.map((i) => itemRow(i, tf, cf, c.key)) : null)
          : el('p', { class: 'muted small' }, t('Alles auf Maximum.')),
      )),
      v === 'home' ? gearList() : null,
    ));
  }
  $('progress').replaceChildren(...[listControls(), ...sections, renderBob(), renderBoost(b)].filter(Boolean));
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
          c.geared ? null : el('span', { class: 'time' }, el('b', {}, days(c.seconds)), el('span', { class: 'muted' }, costText(c.cost)))),
        c.geared ? null : el('span', { class: 'adds' },
          el('button', {
            class: 'add', title: t('Gear-Up planen'), 'aria-label': t('{name} planen', { name: c.name }),
            disabled: planned.has(c.id),
            onclick: () => { setPlan([...getPlan(), { kind: 'gear', id: c.id }]); toast(t('Gear-Up {name} geplant', { name: c.name })); render(); },
          }, '+')));
    })),
    el('p', { class: 'muted small' }, t('Ein Gear-Up macht der Meisterbauarbeiter – im Plan belegt es einen Nachtdorf-Bauarbeiter.')));
}

function renderBob() {
  if (!village.buildings2?.length) return null;
  const s = bobStatus(village, game, LANG);
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
      return before.length ? t('{main} – vorher {before}', { main, before: before.join(', ') }) : main;
    });
    const blocked = { hall: 'Meisterhütte zu niedrig', lab: 'Sternlabor zu niedrig', gear: 'nicht genug umrüstbare Gebäude' }[task.blocked];
    rows.push(el('li', {},
      el('span', { class: 'name' }, `${task.done ? '✓' : '○'} ${label}`,
        steps.map((x) => el('span', { class: 'sub' }, x)),
        blocked ? el('span', { class: 'sub warn' }, t(blocked)) : null),
      el('span', { class: 'time' }, el('b', {}, `${task.current}/${task.target}`))));
  }
  return el('section', { class: 'card progress' },
    el('div', { class: 'group-head' }, el('h3', {}, t('6. Bauarbeiter (B.O.B.)')), el('span', { class: 'pct' }, `${doneCount}/${s.tasks.length}`)),
    el('p', { class: 'muted small' }, t('Aufgaben aus den Spieldaten; für jede offene der kürzeste Weg (Helden-Stufen so verteilt, dass sie parallel möglichst schnell fertig werden).')),
    el('ul', { class: 'items' }, rows),
    el('dl', { class: 'facts' },
      el('dt', {}, t('Nachtdorf-Bauarbeiter')), el('dd', {}, t('{d} mit {n}', { d: days(s.totals.builderSeconds), n: s.totals.bbBuilders })),
      el('dt', {}, t('Sternlabor')), el('dd', {}, days(s.totals.labSeconds)),
      el('dt', {}, t('Gear-Ups')), el('dd', {}, days(s.totals.gearSeconds)),
      el('dt', {}, t('Frühestens')), el('dd', {}, el('b', {}, days(s.totals.seconds))),
      el('dt', {}, t('Kosten')), el('dd', {}, costText(s.totals.cost))),
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
    el('p', { class: 'muted small' }, t('Z. B. durch Goldpass oder Season-Boost. Wirkt nur auf die Fortschritts-Rechnung, nicht auf laufende Upgrades.')),
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
    $('plan').replaceChildren(el('section', { class: 'card' },
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
          el('br'), el('span', { class: 'muted small' }, Object.keys(s.costs).length ? costText(s.costs) : t('kostenlos'))),
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
        el('span', { class: 'muted small' }, costText(s.costs))),
      el('span', { class: 'time' }, el('span', { class: 'cum' }, t('bis dahin')),
        el('b', {}, costText(Object.fromEntries(Object.keys(s.costs).map((k) => [k, s.cumulative[k]])))))))),
    el('dl', { class: 'facts' }, el('dt', {}, t('Gesamt')), el('dd', {}, costText(sim.total))),
    el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: downloadPlanIcs }, t('Starts in Kalender')),
      el('button', { class: 'ghost', onclick: () => { if (confirm(t('Ganzen Plan löschen?'))) { setPlan([]); render(); } } }, t('Plan leeren'))),
  );

  $('plan').replaceChildren(...cards.filter(Boolean), needs);
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
          i.next ? el('span', { class: 'sub' }, `${i.next.level - 1}→${i.next.level} · ${i.next.seconds ? days(i.next.seconds) : t('sofort')}${i.next.cost ? ` · ${costText({ [i.next.resource]: i.next.cost })}` : ''}`) : null),
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
    return el('li', { class: `ev ${u.group.startsWith('builder') || u.group === 'star_lab' ? 'bb' : 'home'}` },
      el('span', { class: 'grow' },
        el('span', { class: 'at' }, clock(e.at)),
        el('span', { class: 'name' }, t('{name} fertig', { name: `${u.name}${u.gearUp ? ` (${t('Gear-Up')})` : u.supercharge ? ` ⚡${u.supercharge}` : ` → ${u.level}`}` }),
          el('span', { class: 'sub' }, gname(u.group), e.planned ? el('span', { class: 'tag' }, t('geplant')) : null),
          next
            ? el('span', { class: 'next' }, t('Danach: {what}', { what: stepText(next) }),
              Object.keys(next.costs).length ? el('span', { class: 'prep' }, t('bereitlegen: {c}', { c: costText(next.costs) })) : null)
            : el('span', { class: 'next none' }, t('Danach: nichts geplant')))),
      el('span', { class: 'adds' }, planButton(key, u.group)),
      picker(key, u.group, u.finishAt));
  };
  const startRow = (e) => el('li', { class: 'ev start' },
    el('span', { class: 'grow' },
      el('span', { class: 'at' }, e.at <= now + 60e3 ? t('jetzt') : clock(e.at)),
      el('span', { class: 'name' }, t('Starten: {what}', { what: stepText(e.step) }),
        el('span', { class: 'sub' }, gname(e.step.group)),
        Object.keys(e.step.costs).length ? el('span', { class: 'prep' }, costText(e.step.costs)) : null)));
  const rows = (entries) => entries
    .filter((e) => e.type === 'finish' || !shownSteps.has(e.step.index))
    .map((e) => (e.type === 'finish' ? finishRow(e) : startRow(e)));

  // ----- Heute zu tun -----
  const todayBucket = daysList.find((b) => b.today) || { entries: [], prepare: {} };
  const todo = [];
  for (const [k, f] of d.free.entries()) {
    const key = `free:${f.group}:${k}`;
    todo.push(el('li', { class: 'ev free' },
      el('span', { class: 'grow' },
        el('span', { class: 'at' }, t('jetzt')),
        el('span', { class: 'name' }, t('{g}: Platz frei', { g: gname(f.group) }),
          f.next ? el('span', { class: 'next' }, t('Jetzt starten: {what}', { what: stepText(f.next) })) : el('span', { class: 'next none' }, t('Nichts geplant für diesen Platz')))),
      el('span', { class: 'adds' }, planButton(key, f.group)),
      picker(key, f.group, now)));
  }
  const readyNow = r.helpers.filter((h) => (h.id === 93000000 || h.id === 93000001) && h.readyAt <= now).map((h) => h.name);
  if (r.clockTowerReadyAt && r.clockTowerReadyAt <= now) readyNow.push(t('Uhrenturm'));
  if (readyNow.length) todo.push(el('li', { class: 'ev free' }, el('span', { class: 'grow' }, el('span', { class: 'at' }, t('jetzt')), el('span', { class: 'name' }, t('Bereit: ') + readyNow.join(', ')))));
  // geplante Starts "jetzt" sind schon bei den freien Plätzen erwähnt
  todo.push(...rows(todayBucket.entries.filter((e) => !(e.type === 'start' && e.at <= now + 60e3))));

  const cards = [el('section', { class: 'card today' },
    el('div', { class: 'group-head' }, el('h3', {}, t('Heute zu tun')), el('span', { class: 'muted small' }, new Intl.DateTimeFormat(locale(), { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(now)))),
    todo.length ? el('ul', { class: 'items' }, todo) : el('p', { class: 'muted' }, t('Heute steht nichts an.')),
    Object.keys(todayBucket.prepare).length ? el('p', { class: 'prep-line' }, t('Heute bereitlegen: {c}', { c: costText(todayBucket.prepare) })) : null)];

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
          Object.keys(b.prepare).length ? el('span', { class: 'prep' }, costText(b.prepare)) : null),
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

// ---------- Magische Gegenstände ----------

function renderMagic(r, now) {
  const m = magicItems(village, game, r.running, now, LANG);
  $('magic').replaceChildren(
    el('section', { class: 'card' },
      el('h3', {}, t('Wo lohnt sich ein Buch?')),
      el('p', { class: 'muted small' }, t('Ein Buch beendet ein Upgrade sofort – am meisten bringt es beim längsten. Berücksichtigt wird, was du jetzt starten kannst (Rathaus- bzw. Labor-Stufe); ⏳ = läuft schon, gezählt wird die Restzeit.'))),
    ...Object.values(m).map((book) => el('section', { class: 'card group' },
      el('h3', {}, book.title),
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

function oreText(ore) {
  const parts = Object.keys(ORES).filter((k) => ore[k]).map((k) => `${fmtInt.format(ore[k])} ${ORES[k][LANG]}`);
  return parts.join(' · ') || t('fertig ✓');
}

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
      el('dl', { class: 'facts' }, Object.keys(ORES).flatMap((k) => [el('dt', {}, ORES[k][LANG]), el('dd', {}, el('b', {}, fmtInt.format(s.total[k] || 0)))]))),
    ...s.heroes.map((h) => el('section', { class: 'card group' },
      el('div', { class: 'group-head' }, el('h3', {}, h.name), el('span', { class: 'muted small' }, t('{a}/{b} besessen', { a: h.owned, b: h.items.length }))),
      el('p', { class: 'small' }, oreText(h.ore)),
      el('ul', { class: 'items' }, h.items.map((i) => el('li', { class: i.owned ? '' : 'done-item' },
        el('span', { class: 'grow' },
          el('span', { class: 'name' }, i.name, el('span', { class: 'sub' },
            (RARITY[i.rarity] ? t(RARITY[i.rarity]) : i.rarity) + (i.owned ? t(' · Stufe {a} → {b}', { a: i.level, b: i.to }) : t(' · nicht freigeschaltet')))),
          el('span', { class: 'time small' }, i.owned ? oreText(i.ore) : '–')),
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
