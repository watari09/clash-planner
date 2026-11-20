import { readVillage, analyze, progress, toIcs, formatDuration, RESOURCES } from './village.js';

// localStorage-Schlüssel
const STORE_VILLAGES = 'planner.villages'; // { tag: json-text }
const STORE_CURRENT = 'planner.current'; // tag des angezeigten Dorfs
const STORE_SLOTS = 'planner.slots'; // vom Nutzer geänderte Platzanzahl je Gruppe
const STORE_BOOST = 'planner.boost'; // { time: %, cost: % } z. B. Goldpass/Season-Boost
const LEGACY_VILLAGE = 'planner.village'; // alte Version: nur ein Dorf

const $ = (id) => document.getElementById(id);
let game = null;
let village = null;

// ---------- Speicher ----------

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const villages = () => readJson(STORE_VILLAGES, {});
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
  const r = analyze(village, game);
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
  const extras = r.helpers.map((h) => row(`${h.name} (Stufe ${h.level})`, h.readyAt));
  if (r.clockTowerReadyAt) extras.push(row('Uhrenturm-Boost', r.clockTowerReadyAt));
  $('extras').replaceChildren(el('h3', {}, 'Helfer & Boosts'), el('ul', { class: 'items' }, extras));
  $('extras').hidden = !extras.length;
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
      x.categories.filter((c) => c.total > 0).map((c) => el('details', { class: 'cat' },
        el('summary', {},
          el('span', { class: 'name' }, c.title),
          el('span', { class: 'cat-pct' }, c.items.length ? `${String(c.percent).replace('.', ',')} %` : 'fertig ✓')),
        bar(c.percent),
        c.items.length
          ? el('ul', { class: 'items' }, c.items.map((i) => el('li', {},
            el('span', { class: 'name' }, i.name, i.count > 1 ? el('span', { class: 'lvl' }, ` ×${i.count}`) : null,
              el('span', { class: 'lvl' }, ` ${i.from}→${i.to}`)),
            el('span', { class: 'time' }, el('b', {}, days(i.seconds * tf)),
              el('span', { class: 'muted' }, costText(i.cost, cf))))))
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

// ---------- Kalender ----------

function downloadIcs() {
  const r = analyze(village, game);
  const blob = new Blob([toIcs(r)], { type: 'text/calendar;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'clash-upgrades.ics' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
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

(async () => {
  game = await (await fetch('data/game.json')).json();
  $('data-version').textContent = game.version;
  migrate();
  select(localStorage.getItem(STORE_CURRENT));
  setInterval(render, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
})();
