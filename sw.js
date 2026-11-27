// Offline-Modus: Netz zuerst (immer aktuell, wenn online), sonst aus dem Zwischenspeicher.
// Die Liste wird von tools/build_sw.py erzeugt – nach neuen Dateien neu ausführen.
const CACHE = 'planner-v1';
const FILES = [
  "./",
  "index.html",
  "widget.html",
  "style.css",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "apple-touch-icon.png",
  "data/game.json",
  "src/app.js",
  "src/bob.js",
  "src/boosts.js",
  "src/dashboard.js",
  "src/heroes.js",
  "src/i18n.js",
  "src/magic.js",
  "src/merge.js",
  "src/ore.js",
  "src/planner.js",
  "src/state.js",
  "src/suggest.js",
  "src/sync.js",
  "src/village.js",
  "src/walls.js",
  "src/widget.js",
  "img/CommonOre.webp",
  "img/DarkElixir.webp",
  "img/Diamonds.webp",
  "img/Elixir.webp",
  "img/Elixir2.webp",
  "img/EpicOre.webp",
  "img/Gold.webp",
  "img/Gold2.webp",
  "img/RareOre.webp",
  "img/bob.webp",
  "img/book-building.webp",
  "img/book-fighting.webp",
  "img/book-heroes.webp",
  "img/book-spells.webp",
  "img/builder.webp",
  "img/builderBite.webp",
  "img/builderPotion.webp",
  "img/clockTower.webp",
  "img/clockTowerPotion.webp",
  "img/labLicorice.webp",
  "img/masterBuilder.webp",
  "img/petPotion.webp",
  "img/researchPotion.webp",
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
