// オフライン対応のサービスワーカー（アプリシェルをキャッシュ）。
const CACHE = "reversi-v16";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/main.js",
  "./src/rules.js",
  "./src/game.js",
  "./src/evaluate.js",
  "./src/events.js",
  "./src/notation.js",
  "./src/match.js",
  "./src/stats.js",
  "./src/exporter.js",
  "./src/audio.js",
  "./src/storage.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
  "./src/bgm.js",
  "./src/render3d.js",
  "./vendor/three.module.js",
  "./vendor/jsm/postprocessing/EffectComposer.js",
  "./vendor/jsm/postprocessing/RenderPass.js",
  "./vendor/jsm/postprocessing/ShaderPass.js",
  "./vendor/jsm/postprocessing/MaskPass.js",
  "./vendor/jsm/postprocessing/UnrealBloomPass.js",
  "./vendor/jsm/shaders/CopyShader.js",
  "./vendor/jsm/postprocessing/OutputPass.js",
  "./vendor/jsm/shaders/LuminosityHighPassShader.js",
  "./vendor/jsm/shaders/OutputShader.js",
  "./vendor/jsm/environments/RoomEnvironment.js",
  "./textures/board.png",
  "./audio/place.wav",
  "./audio/flip_lift.wav",
  "./audio/flip_land.wav",
  "./audio/bell.wav",
  "./audio/big_swoosh.wav",
  "./audio/fanfare_win.wav",
  "./audio/fanfare_lose.wav",
  "./audio/bgm_normal.wav",
  "./audio/bgm_close.wav",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュ優先（オフライン起動）。無ければネットへ。
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
