import { readVillage, analyze, progress, toIcs, icsCalendar, formatDuration, RESOURCES, GROUPS } from './village.js';
import { nextStep, simulate, cleanPlan, groupOf } from './planner.js';
import { BOOST_TYPES, applyBoosts, runningKey } from './boosts.js';

// localStorage-Schlüssel
const STORE_VILLAGES = 'planner.villages'; // { tag: json-text }
const STORE_CURRENT = 'planner.current'; // tag des angezeigten Dorfs
const STORE_SLOTS = 'planner.slots'; // vom Nutzer geänderte Platzanzahl je Gruppe
const STORE_BOOST = 'planner.boost'; // { time: %, cost: % } z. B. Goldpass/Season-Boost
const LEGACY_VILLAGE = 'planner.village'; // alte Version: nur ein Dorf
const STORE_TAB = 'planner.tab';
const planKey = () => `planner.plan.${village?.tag || 'Dorf'}`; // [{ id, to, n }] je Dorf
const boostKey = () => `planner.boosts.${village?.tag || 'Dorf'}`; // [{ type, at, target? }] je Dorf

const $ = (id) => document.getElementById(id);
let game = null;
let village = null;
const openCats = new Set(); // aufgeklappte Kategorien bleiben beim Neuzeichnen offen

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
  const r = analyze(village, game);
  // Boosts vor dem Export stecken schon in den Timern → aufräumen
  const events = getBoosts().filter((e) => e.at >= r.exportedAt);
  if (events.length !== getBoosts().length) setBoosts(events);
  const { running, applied } = applyBoosts(r.running, events, game, village);
  r.running = running;
  for (const g of r.groups) g.items = running.filter((x) => x.group === g.key);
  r.boosts = applied;
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

const fmtTime = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtToday = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtAmount = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });

function when(ms) {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `heute ${fmtToday.format(d)}`;
  if (d.toDateString() === tomorrow.toDateString()) return `morgen ${fmtToday.format(d)}`;
  return fmtTime.format(d);
}

function days(sec) {
  if (sec <= 0) return 'nichts';
  if (sec >= 10 * 86400) return `${Math.round(sec / 86400)} Tage`;
  return sec >= 86400 ? `${Math.round(sec / 8640) / 10} Tage`.replace('.', ',') : formatDuration(sec);
}

function costText(cost, factor = 1) {
  const parts = Object.entries(cost)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${fmtAmount.format(Math.round(n * factor))} ${RESOURCES[r]?.de || r}`);
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
    showError(e.message);
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

function render() {
  $('result').hidden = !village;
  renderSwitcher();
  if (!village || !game) return;
  const r = current();
  const now = Date.now();
  const age = now - r.exportedAt;
  const ageText = age < 60000 ? 'gerade eben' : `vor ${formatDuration(Math.round(age / 1000))}`;

  $('summary').replaceChildren(
    el('p', { class: 'big' }, `Rathaus ${r.townHall}`, r.builderHall ? ` · Meisterhütte ${r.builderHall}` : ''),
    r.tag ? el('p', { class: 'muted' }, `Spieler ${r.tag}`) : null,
    el('p', { class: age > 12 * 3600e3 ? 'warn' : 'muted' },
      `Export ${ageText} (${when(r.exportedAt)})`,
      age > 12 * 3600e3 ? ' – für aktuelle Zeiten neu exportieren.' : ''),
  );

  renderRunning(r, now);
  renderExtras(r, now);
  renderProgress(r);
  renderPlan(r, now);
  showTab(localStorage.getItem(STORE_TAB) || 'overview');
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
      ? el('select', { 'aria-label': 'Dorf wählen', onchange: (e) => select(e.target.value) },
        tags.map((t) => el('option', { value: t, selected: t === current }, t)))
      : el('span', { class: 'muted' }, `Gespeichert: ${current}`),
    el('button', {
      class: 'ghost small',
      onclick: () => {
        if (!confirm(`Dorf ${current} aus diesem Browser entfernen?`)) return;
        const rest = villages();
        delete rest[current];
        localStorage.setItem(STORE_VILLAGES, JSON.stringify(rest));
        select(Object.keys(rest)[0]);
      },
    }, 'Entfernen'),
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
        title: 'Anzahl der Plätze ändern',
        onclick: () => {
          const v = prompt(`Wie viele Plätze hat „${g.title}“?`, String(slots));
          if (v === null) return;
          const n = parseInt(v, 10);
          const o = readJson(STORE_SLOTS, {});
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
}

function renderExtras(r, now) {
  const row = (name, at) => {
    const left = Math.round((at - now) / 1000);
    return el('li', {}, el('span', { class: 'name' }, name),
      el('span', { class: 'time' }, el('b', {}, left > 0 ? `in ${formatDuration(left)}` : 'bereit'),
        left > 0 ? el('span', { class: 'muted' }, when(at)) : null));
  };
  const ready = r.helpers.filter((h) => h.id === 93000000 || h.id === 93000001).map((h) => row(`${h.name} (Stufe ${h.level})`, h.readyAt));
  if (r.clockTowerReadyAt) ready.push(row('Uhrenturm', r.clockTowerReadyAt));

  // Eintragen: welche Boosts passen zu diesem Dorf?
  const slots = slotsByGroup(r, now);
  const available = Object.entries(BOOST_TYPES).filter(([, d]) => d.groups.some((g) => (slots[g] || 0) > 0));
  const add = (type, target) => {
    setBoosts([...getBoosts(), { type, at: Date.now(), ...(target ? { target } : {}) }]);
    render();
    const last = current().boosts.at(-1);
    toast(last?.saved ? `${BOOST_TYPES[type].de}: ${formatDuration(Math.round(last.saved / 1000))} gespart` : `${BOOST_TYPES[type].de} eingetragen – betrifft gerade kein laufendes Upgrade`);
  };
  // Helfer und Uhrenturm haben eine Abklingzeit: erst danach eintragbar
  const readyAt = (type, d) => (d.helper ? r.helpers.find((h) => h.id === d.helper)?.readyAt
    : type === 'clockTower' ? r.clockTowerReadyAt : 0) || 0;
  const lock = (type, d) => {
    const at = readyAt(type, d);
    return at > now ? { disabled: true, title: `bereit ${when(at)}` } : {};
  };
  const buttons = available.filter(([, d]) => !d.single).map(([type, d]) =>
    el('button', { class: 'ghost small', onclick: () => add(type), ...lock(type, d) }, d.de));
  const singles = available.filter(([, d]) => d.single).map(([type, d]) => {
    const options = r.running.filter((x) => d.groups.includes(x.group) && x.finishAt > now);
    if (!options.length) return null;
    const select = el('select', { 'aria-label': `${d.de}: Upgrade wählen` },
      options.map((x) => el('option', { value: x.key }, `${x.name} → ${x.level}`)));
    return el('div', { class: 'row assign' }, select,
      el('button', { class: 'ghost small', onclick: () => add(type, select.value), ...lock(type, d) },
        readyAt(type, d) > now ? `${d.de}: bereit ${when(readyAt(type, d))}` : `${d.de} zuweisen`));
  });

  const logged = (r.boosts || []).map((b, i) => el('li', {},
    el('span', { class: 'name' }, BOOST_TYPES[b.type]?.de || b.type, el('br'), el('span', { class: 'muted small' }, when(b.at))),
    el('span', { class: 'time' }, el('b', {}, b.saved ? `−${formatDuration(Math.round(b.saved / 1000))}` : 'ohne Wirkung'),
      el('button', {
        class: 'ghost small',
        onclick: () => { const all = getBoosts().sort((a, c) => a.at - c.at); all.splice(i, 1); setBoosts(all); render(); },
      }, 'Rückgängig'))));

  $('extras').replaceChildren(
    el('h3', {}, 'Helfer & Boosts'),
    el('ul', { class: 'items' }, ready),
    el('p', { class: 'muted small' }, 'Gerade benutzt? Eintragen, dann rechnet die Seite die Fertig-Zeiten neu – auch für Kalender und Plan. Mit dem nächsten Export verfallen die Einträge (dann stecken sie schon in den Timern).'),
    el('div', { class: 'row boosts' }, buttons),
    ...singles.filter(Boolean),
    logged.length ? el('ul', { class: 'items' }, logged) : null,
  );
  $('extras').hidden = false;
}

function renderProgress(r) {
  const p = progress(village, game);
  const b = boost();
  const tf = 1 - b.time / 100;
  const cf = 1 - b.cost / 100;
  const overrides = readJson(STORE_SLOTS, {});
  const slotsOf = (key) => Math.max(1, overrides[key] ?? r.groups.find((g) => g.key === key)?.slots ?? 1);

  const sections = [];
  for (const [v, title, builderKey] of [
    ['home', 'Rathaus', 'home_builders'],
    ['builder', 'Meisterhütte', 'builder_builders'],
  ]) {
    const x = p[v];
    if (!x) continue;
    const builders = slotsOf(builderKey);
    const allCost = {};
    for (const c of x.categories) for (const [res, n] of Object.entries(c.cost)) allCost[res] = (allCost[res] || 0) + n;

    sections.push(el('section', { class: 'card progress' },
      el('div', { class: 'group-head' },
        el('h3', {}, `Fortschritt ${title} ${x.hall}`),
        el('span', { class: 'pct' }, `${String(x.percent).replace('.', ',')} %`)),
      bar(x.percent),
      el('p', { class: 'muted small' }, `Anteil der Bauzeit bis zum Maximum für ${title} ${x.hall}. Nach Stufen gezählt: ${String(x.levelPercent).replace('.', ',')} %.`),
      el('dl', { class: 'facts' },
        el('dt', {}, 'Bauarbeiter'),
        el('dd', {}, `${days((x.builderSeconds * tf) / builders)} mit ${builders} Bauarbeiter${builders === 1 ? '' : 'n'}`),
        el('dt', {}, v === 'home' ? 'Labor' : 'Sternlabor'),
        el('dd', {}, days(x.labSeconds * tf)),
        x.petSeconds ? el('dt', {}, 'Begleiterhaus') : null,
        x.petSeconds ? el('dd', {}, days(x.petSeconds * tf)) : null,
        el('dt', {}, 'Kosten'),
        el('dd', {}, costText(allCost, cf)),
      ),
      x.categories.filter((c) => c.total > 0).map((c) => el('details', {
        class: 'cat',
        open: openCats.has(`${v}:${c.key}`),
        ontoggle: (e) => { if (e.target.open) openCats.add(`${v}:${c.key}`); else openCats.delete(`${v}:${c.key}`); },
      },
        el('summary', {},
          el('span', { class: 'name' }, c.title),
          el('span', { class: 'cat-pct' }, c.items.length ? `${String(c.percent).replace('.', ',')} %` : 'fertig ✓')),
        bar(c.percent),
        c.items.length
          ? el('ul', { class: 'items' }, c.items.map((i) => el('li', {},
            el('span', { class: 'grow' },
              el('span', { class: 'name' }, i.name, i.count > 1 ? el('span', { class: 'lvl' }, ` ×${i.count}`) : null,
                el('span', { class: 'lvl' }, ` ${i.from}→${i.to}`)),
              el('span', { class: 'time' }, el('b', {}, days(i.seconds * tf)),
                el('span', { class: 'muted' }, costText(i.cost, cf)))),
            el('button', { class: 'add', title: 'Nächste Stufe planen', 'aria-label': `${i.name} planen`, onclick: () => addToPlan(i) }, '+'))))
          : el('p', { class: 'muted small' }, 'Alles auf Maximum.'),
      )),
    ));
  }
  $('progress').replaceChildren(...sections, renderBoost(b));
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
    el('h3', {}, 'Rabatt'),
    el('p', { class: 'muted small' }, 'Z. B. durch Goldpass oder Season-Boost. Wirkt nur auf die Fortschritts-Rechnung, nicht auf laufende Upgrades.'),
    el('div', { class: 'row boost' }, input('time', 'Bauzeit −'), input('cost', 'Kosten −')),
  );
}

// ---------- Plan ----------

function addToPlan(i) {
  const plan = getPlan();
  const step = nextStep(village, plan, i.id, i.to, i.missing);
  if (!step) {
    toast(`${i.name}: schon alles bis Stufe ${i.to} geplant`);
    return;
  }
  plan.push(step);
  setPlan(plan);
  toast(`${i.name} ${step.to - 1}→${step.to} geplant`);
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
  let sim = simulate(village, game, plan, r.running, slots, { now, timeFactor: 1 - b.time / 100, costFactor: 1 - b.cost / 100 });
  // Laut neuem Export erledigte Einträge entfernen
  const cleaned = cleanPlan(plan, sim.dropped);
  if (cleaned.length !== plan.length) {
    const n = plan.length - cleaned.length;
    plan = cleaned;
    setPlan(plan);
    sim = simulate(village, game, plan, r.running, slots, { now, timeFactor: 1 - b.time / 100, costFactor: 1 - b.cost / 100 });
    toast(`${n} geplante${n === 1 ? 's Upgrade ist' : ' Upgrades sind'} schon erledigt`);
  }
  lastSim = sim;

  $('plan-count').textContent = String(plan.length);
  $('plan-count').hidden = !plan.length;

  if (!plan.length) {
    $('plan').replaceChildren(el('section', { class: 'card' },
      el('h3', {}, 'Noch nichts geplant'),
      el('p', { class: 'muted' }, 'Im Reiter „Fortschritt“ eine Kategorie aufklappen und beim gewünschten Upgrade auf + tippen. Jedes Tippen plant die nächste Stufe.'),
      el('p', { class: 'muted small' }, 'Der Plan verteilt die Upgrades auf deine Bauarbeiter bzw. das Labor – sobald einer frei wird – und zeigt, wann du welche Ressourcen bereithalten musst.')));
    return;
  }

  const blocked = new Map(sim.dropped.filter((d) => d.reason === 'blocked').map((d) => [d.index, d]));
  const row = (index, content, cls = '') => el('li', { class: `plan-step ${cls}` },
    el('span', { class: 'grow' }, ...content),
    el('span', { class: 'tools' },
      el('button', { class: 'ghost', title: 'früher', 'aria-label': 'nach oben', onclick: () => movePlan(index, -1) }, '↑'),
      el('button', { class: 'ghost', title: 'später', 'aria-label': 'nach unten', onclick: () => movePlan(index, 1) }, '↓'),
      el('button', { class: 'ghost', title: 'entfernen', 'aria-label': 'entfernen', onclick: () => removePlan(index) }, '✕')));

  const cards = Object.keys(GROUPS).map((g) => {
    const steps = sim.steps.filter((s) => s.group === g);
    const blockedHere = [...blocked.values()].filter((d) => game.items[String(d.id)] && groupOf(game.items[String(d.id)]) === g);
    if (!steps.length && !blockedHere.length) return null;
    const items = [
      ...steps.map((s) => ({ index: s.index, node: row(s.index, [
        el('span', { class: 'name' }, s.name, el('span', { class: 'lvl' }, ` ${s.from}→${s.to}`),
          el('br'), el('span', { class: 'muted small' }, s.cost ? costText({ [s.resource]: s.cost }) : 'kostenlos')),
        el('span', { class: 'time' }, el('b', {}, `ab ${when(s.start)}`),
          el('span', { class: 'muted' }, `fertig ${when(s.end)}`)),
      ]) })),
      ...blockedHere.map((d) => ({ index: d.index, node: row(d.index, [
        el('span', { class: 'name' }, `${game.items[String(d.id)].name.de} ${d.to - 1}→${d.to}`,
          el('br'), el('span', { class: 'small' }, 'Erst die Stufe davor planen bzw. weiter nach oben schieben.')),
      ], 'blocked') })),
    ].sort((a, b2) => a.index - b2.index);
    return el('section', { class: 'card group' },
      el('div', { class: 'group-head' }, el('h3', {}, GROUPS[g].de), el('span', { class: 'muted small' }, `${slots[g] || 0} Plätze`)),
      el('ul', { class: 'items' }, items.map((x) => x.node)));
  });

  const needs = el('section', { class: 'card' },
    el('h3', {}, 'Wann du welche Ressourcen brauchst'),
    el('p', { class: 'muted small' }, 'Zum Start jedes Upgrades muss die Summe bereitliegen. Rechts: Gesamtbedarf bis dahin.'),
    el('ul', { class: 'items' }, sim.needs.filter((s) => s.cost).map((s) => el('li', {},
      el('span', { class: 'name' }, el('b', {}, when(s.start)), el('br'),
        `${s.name} ${s.from}→${s.to}`, el('br'), el('span', { class: 'muted small' }, costText({ [s.resource]: s.cost }))),
      el('span', { class: 'time' }, el('span', { class: 'cum' }, 'bis dahin'),
        el('b', {}, costText({ [s.resource]: s.cumulative[s.resource] })))))),
    el('dl', { class: 'facts' }, el('dt', {}, 'Gesamt'), el('dd', {}, costText(sim.total))),
    el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: downloadPlanIcs }, 'Starts in Kalender'),
      el('button', { class: 'ghost', onclick: () => { if (confirm('Ganzen Plan löschen?')) { setPlan([]); render(); } } }, 'Plan leeren')),
  );

  $('plan').replaceChildren(...cards.filter(Boolean), needs);
}

function downloadPlanIcs() {
  if (!lastSim) return;
  const tag = (village.tag || 'dorf').replace(/[^A-Z0-9]/gi, '');
  const now = Date.now();
  const events = lastSim.steps.filter((s) => s.start > now).map((s) => ({
    uid: `${tag}-plan-${s.id}-${s.to}-${Math.round(s.start / 60000)}`,
    start: s.start,
    title: `${s.name} ${s.from}→${s.to} starten`,
    description: s.cost ? `${costText({ [s.resource]: s.cost })} bereithalten.` : '',
    alarm: `Jetzt ${s.name} ${s.from}→${s.to} starten`,
  }));
  if (!events.length) { toast('Alle geplanten Starts sind schon jetzt möglich.'); return; }
  download(icsCalendar(events), 'clash-plan.ics');
}

function download(text, name) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- Kalender ----------

function downloadIcs() {
  download(toIcs(current()), 'clash-upgrades.ics');
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
    showError('Die Zwischenablage ließ sich nicht lesen. Hat dein Browser gerade um Erlaubnis gefragt? Dann erlauben und nochmal auf „Einfügen“ tippen. Sonst über „Von Hand einfügen“.');
  }
});
$('manual').addEventListener('click', () => { $('manual-box').hidden = false; $('json').focus(); });
$('load').addEventListener('click', () => load($('json').value));
$('ics').addEventListener('click', downloadIcs);
for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));

(async () => {
  game = await (await fetch('data/game.json')).json();
  $('data-version').textContent = game.version;
  migrate();
  select(localStorage.getItem(STORE_CURRENT));
  setInterval(render, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
})();
