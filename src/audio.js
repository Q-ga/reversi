// 音の再生（DSP生成WAVファイルを再生）。効果音＋2段階BGM（通常/終盤接戦/終盤一方的）。
// iOS制約：init() は最初のユーザー操作後に呼ぶ。BGMと効果音は別々にミュート可。
const SFX_FILES = {
  place: "./audio/place.wav",
  flip_lift: "./audio/flip_lift.wav",
  flip_land: "./audio/flip_land.wav",
  bell: "./audio/bell.wav",
  reversal: "./audio/reversal.wav",
  fanfare_win: "./audio/fanfare_win.wav",
  fanfare_lose: "./audio/fanfare_lose.wav",
};
const BGM_FILES = {
  normal: "./audio/bgm_normal.wav",
  endgame_close: "./audio/bgm_close.wav",
  endgame_oneside: "./audio/bgm_oneside.wav",
};

let ctx = null;
let sfxGain = null;
let bgmGain = null;
let sfxOn = true;
let bgmOn = true;

const rawBuffers = {}; // name -> ArrayBuffer（fetch済み・decode前）
const buffers = {};    // name -> AudioBuffer（decode済み）
const bgmTracks = {};  // state -> { src, gain }
let currentBgm = null;
let bgmRunning = false;

// 音源を更新したらここを上げる（Service Worker等の旧キャッシュを確実に回避）
const AUDIO_VER = 5;
// モジュール読込時にファイルを先読み（decodeはinit後）
for (const [k, url] of Object.entries({ ...SFX_FILES, ...BGM_FILES })) {
  fetch(`${url}?v=${AUDIO_VER}`).then((r) => r.arrayBuffer()).then((ab) => { rawBuffers[k] = ab; }).catch(() => {});
}

export function init() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(ctx.destination);
  bgmGain = ctx.createGain(); bgmGain.gain.value = bgmOn ? 0.7 : 0; bgmGain.connect(ctx.destination);
  // 先読み済みをdecode（slice：decodeはArrayBufferを消費するため複製）
  for (const [k, ab] of Object.entries(rawBuffers)) {
    ctx.decodeAudioData(ab.slice(0)).then((buf) => { buffers[k] = buf; }).catch(() => {});
  }
}

export function setSfxEnabled(on) { sfxOn = on; }
export function setBgmEnabled(on) {
  bgmOn = on;
  if (bgmGain && ctx) bgmGain.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, 0.05);
}
export function isSfxEnabled() { return sfxOn; }
export function isBgmEnabled() { return bgmOn; }

function playBuffer(name, { rate = 1, gain = 1 } = {}) {
  if (!ctx || !sfxOn || !buffers[name]) return;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  src.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(g); g.connect(sfxGain);
  src.start();
}

// ---- 効果音 ----
export function playPlace() { playBuffer("place", { gain: 0.9 }); }
// 連鎖めくり：スッと持ち上げる音→約0.44秒後にコツっと置く音（アニメの浮上→着地に同期）。
// indexが進むほど音程上昇＝滝の連鎖。
export function playFlip(i = 0) {
  const rate = 1 + Math.min(i, 14) * 0.05;
  playBuffer("flip_lift", { rate, gain: 0.6 });
  setTimeout(() => playBuffer("flip_land", { rate, gain: 0.6 }), 440);
}

const EVENT_SOUND = {
  corner: ["bell", 0.9],
  reversal: ["reversal", 0.9],
  "gameover-win": ["fanfare_win", 1.0],
  "gameover-lose": ["fanfare_lose", 1.0],
  shutout: ["fanfare_win", 1.0],
};
export function playEvent(tag) {
  const e = EVENT_SOUND[tag];
  if (e) playBuffer(e[0], { gain: e[1] });
}

// ---- BGM（2段階・クロスフェード） ----
function startTrack(state) {
  if (!ctx || !buffers[state]) return null;
  const src = ctx.createBufferSource();
  src.buffer = buffers[state];
  src.loop = true;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(g); g.connect(bgmGain);
  src.start();
  return { src, gain: g };
}

export function startBgm(state = "normal") {
  if (!ctx) return;
  bgmRunning = true;
  setBgm(state, true);
}

// 局面に応じてBGMを切り替える（normal / endgame_close / endgame_oneside）
export function setBgm(state, force = false) {
  if (!ctx || !bgmRunning) return;
  if (!force && state === currentBgm) return;
  // decodeがまだなら少し待って再試行
  if (!buffers[state]) { setTimeout(() => setBgm(state, force), 200); return; }
  const now = ctx.currentTime;
  // 既存トラックをフェードアウト＆停止予約
  for (const [name, tr] of Object.entries(bgmTracks)) {
    if (name !== state) {
      tr.gain.gain.cancelScheduledValues(now);
      tr.gain.gain.setTargetAtTime(0, now, 0.4);
      try { tr.src.stop(now + 1.5); } catch {}
      delete bgmTracks[name];
    }
  }
  if (!bgmTracks[state]) bgmTracks[state] = startTrack(state);
  const tr = bgmTracks[state];
  if (tr) { tr.gain.gain.cancelScheduledValues(now); tr.gain.gain.setTargetAtTime(0.9, now, 0.5); }
  currentBgm = state;
}

export function stopBgm() {
  bgmRunning = false;
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [name, tr] of Object.entries(bgmTracks)) {
    tr.gain.gain.setTargetAtTime(0, now, 0.3);
    try { tr.src.stop(now + 1.0); } catch {}
    delete bgmTracks[name];
  }
  currentBgm = null;
}
