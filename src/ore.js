// Erz-Rechner: wie viel glänzendes, glühendes und sternenförmiges Erz fehlt der Helden-Ausrüstung?

export const ORES = {
  CommonOre: { de: 'Glänzendes Erz', en: 'Shiny Ore' },
  RareOre: { de: 'Glühendes Erz', en: 'Glowy Ore' },
  EpicOre: { de: 'Sternenerz', en: 'Starry Ore' },
};

const BLACKSMITH = 1000070;

/** Höchste Stufe der Ausrüstung, ggf. begrenzt durch die Schmiede-Stufe. */
function maxEquipmentLevel(item, blacksmith) {
  if (blacksmith == null) return item.levels.length;
  let max = 1;
  item.levels.forEach((l, i) => { if (l[0] <= blacksmith) max = i + 1; });
  return max;
}

/**
 * Je Held: alle Ausrüstungen mit aktueller Stufe, Ziel-Stufe und fehlendem Erz.
 * @param options.useBlacksmith  true = Ziel nur bis zur aktuellen Schmiede-Stufe, sonst bis zum Maximum
 */
export function oreStatus(village, game, lang = 'de', options = {}) {
  const owned = new Map((village.equipment || []).map((e) => [e.data, e.lvl || 1]));
  const smith = Math.max(0, ...(village.buildings || []).filter((e) => e.data === BLACKSMITH).map((e) => e.lvl || 0));
  const cap = options.useBlacksmith ? smith : null;
  const heroes = new Map();
  const total = {};

  for (const [id, item] of Object.entries(game.items)) {
    if (item.kind !== 'equipment' || item.deprecated || !item.hero) continue;
    const heroItem = game.items[String(item.hero)];
    if (!heroItem || heroItem.village !== 'home') continue;
    const lvl = owned.get(Number(id));
    const to = maxEquipmentLevel(item, cap);
    const ore = {};
    if (lvl !== undefined) {
      for (let L = lvl + 1; L <= to; L++) {
        for (const [r, n] of Object.entries(item.ore[L - 1] || {})) ore[r] = (ore[r] || 0) + n;
      }
      for (const [r, n] of Object.entries(ore)) total[r] = (total[r] || 0) + n;
    }
    if (!heroes.has(item.hero)) heroes.set(item.hero, { id: item.hero, name: heroItem.name[lang] || heroItem.name.en, items: [], ore: {} });
    const h = heroes.get(item.hero);
    h.items.push({ id: Number(id), name: item.name[lang] || item.name.en, rarity: item.rarity, owned: lvl !== undefined, level: lvl ?? 0, to, ore });
    for (const [r, n] of Object.entries(ore)) h.ore[r] = (h.ore[r] || 0) + n;
  }
  for (const h of heroes.values()) {
    h.owned = h.items.filter((i) => i.owned).length;
    h.items.sort((a, b) => Number(b.owned) - Number(a.owned) || a.id - b.id);
  }
  return { blacksmith: smith, heroes: [...heroes.values()].sort((a, b) => a.id - b.id), total };
}
