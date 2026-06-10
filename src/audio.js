// 音の再生（DSP生成WAVファイルを再生）。効果音＋2段階BGM（通常/終盤接戦/終盤一方的）。
// iOS制約：init() は最初のユーザー操作後に呼ぶ。BGMと効果音は別々にミュート可。
const SFX_FILES = {
  place: "./audio/place.wav",
  flip_lift: "./audio/flip_lift.wav",
  flip_land: "./audio/flip_land.wav",
  bell: "./audio/bell.wav",
  big_swoosh: "./audio/big_swoosh.wav",
  fanfare_win: "./audio/fanfare_win.wav",
  fanfare_lose: "./audio/fanfare_lose.wav",
};
const BGM_FILES = {
  normal: "./audio/bgm_normal.wav",
  endgame: "./audio/bgm_close.wav", // 終盤は緊迫感の音のみ（一方的分岐は廃止）
};

import { effectiveGain } from "./settings.js";

const BGM_MASTER = 0.55; // BGMマスター基準音量（音量100%時）。少し下げた（旧0.7）
const SFX_MASTER = 0.9;  // 効果音マスター基準音量（音量100%時）
let ctx = null;
let sfxGain = null;
let bgmGain = null;
let sfxOn = true;
let bgmOn = true;
let bgmVol = 1; // BGM音量(0..1)。設定スライダーで変更。100%=マスターそのまま
let sfxVol = 1; // 効果音音量(0..1)

const rawBuffers = {}; // name -> ArrayBuffer（fetch済み・decode前）
const buffers = {};    // name -> AudioBuffer（decode済み）
const bgmTracks = {};  // state -> { src, gain }
let currentBgm = null;
let bgmRunning = false;

// 音源を更新したらここを上げる（Service Worker等の旧キャッシュを確実に回避）
const AUDIO_VER = 11;
// モジュール読込時にファイルを先読み（decodeはinit後）
for (const [k, url] of Object.entries({ ...SFX_FILES, ...BGM_FILES })) {
  fetch(`${url}?v=${AUDIO_VER}`).then((r) => r.arrayBuffer()).then((ab) => { rawBuffers[k] = ab; }).catch(() => {});
}

export function init() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  // 効果音マスターは音量のみ反映（ミュートは再生時に sfxOn でゲート）。BGMはミュート×音量を即反映。
  sfxGain = ctx.createGain(); sfxGain.gain.value = SFX_MASTER * sfxVol; sfxGain.connect(ctx.destination);
  bgmGain = ctx.createGain(); bgmGain.gain.value = effectiveGain(BGM_MASTER, bgmOn, bgmVol); bgmGain.connect(ctx.destination);
  // 先読み済みをdecode（slice：decodeはArrayBufferを消費するため複製）
  for (const [k, ab] of Object.entries(rawBuffers)) {
    ctx.decodeAudioData(ab.slice(0)).then((buf) => { buffers[k] = buf; }).catch(() => {});
  }
}

export function setSfxEnabled(on) { sfxOn = on; }
export function setBgmEnabled(on) {
  bgmOn = on;
  applyBgmGain();
}

// BGMマスターゲインを現在のミュート×音量に合わせて滑らかに更新する。
function applyBgmGain() {
  if (!bgmGain || !ctx) return;
  resetParam(bgmGain.gain, ctx.currentTime);
  try { bgmGain.gain.setTargetAtTime(effectiveGain(BGM_MASTER, bgmOn, bgmVol), ctx.currentTime, 0.05); } catch {}
}

// 音量(0..1)を設定。ミュート状態は保ったまま音量だけ変える（ミュート中の操作も値は記憶）。
export function setBgmVolume(v) {
  bgmVol = Math.min(1, Math.max(0, Number(v) || 0));
  applyBgmGain();
}
export function setSfxVolume(v) {
  sfxVol = Math.min(1, Math.max(0, Number(v) || 0));
  if (sfxGain && ctx) {
    resetParam(sfxGain.gain, ctx.currentTime);
    try { sfxGain.gain.setTargetAtTime(SFX_MASTER * sfxVol, ctx.currentTime, 0.05); } catch {}
  }
}
export function getBgmVolume() { return bgmVol; }
export function getSfxVolume() { return sfxVol; }

// AudioParam を安全に再スケジュールするための共通ヘルパ。
// cancelScheduledValues は「過去に開始して進行中の」曲線を終端できず、直後の
// setValueCurveAtTime / setTargetAtTime がその区間とオーバーラップして NotSupportedError を投げる。
// cancelAndHoldAtTime なら現在値に固定して曲線を確実に終端できる。未対応環境は段階的に縮退し、
// いかなる場合も例外を外へ漏らさない（音は非必須＝ゲーム進行をブロックさせない）。
function resetParam(param, now) {
  try {
    const hold = param.cancelAndHoldAtTime || param.webkitCancelAndHoldAtTime;
    if (hold) { hold.call(param, now); return; }
  } catch {}
  try { param.cancelScheduledValues(now); } catch {}
  try { param.setValueAtTime(param.value, now); } catch {}
}

function playBuffer(name, { rate = 1, gain = 1 } = {}) {
  if (!ctx || !sfxOn || !buffers[name]) return;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  src.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(g); g.connect(sfxGain);
  try { src.start(); } catch {}
}

// ---- 効果音 ----
// ① 着手の溜め：出現の瞬間に「フッ」（極小・flip_lit流用）、着地の瞬間に「コツ」（主役・やや大きめ）
export function playAppear() { playBuffer("flip_lift", { gain: 0.12 }); }
export function playPlace() { playBuffer("place", { gain: 1.0 }); }
// ② めくり：号砲の持ち上げで「スッ」を1回、各めくりの着地で「コツ」（連鎖で音程上昇）
export function playFlipLift() { playBuffer("flip_lift", { gain: 0.22 }); }
export function playFlipLand(i = 0) {
  const rate = 1 + Math.min(i, 14) * 0.045;
  playBuffer("flip_land", { rate, gain: 0.9 });
}

const EVENT_SOUND = {
  corner: ["bell", 0.85],
  bigFlip: ["big_swoosh", 0.8], // 大量返し：吸い込む「ヒュォー」
  // 逆転(reversal)は演出・音とも廃止（ユーザー要望）
  gameover: ["fanfare_win", 1.0],
  "gameover-draw": ["fanfare_lose", 0.7],
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

// 等パワークロスフェード（③ 急な転換を約3秒で緩やかに）
const XFADE_SEC = 6.0;     // クロスフェード時間（実時間・かなり緩やかに）
const BGM_LEVEL = 0.9;     // BGMの定常音量（normal基準）
// 音源ごとの聴感ラウドネス差を補正するトリム。A特性RMS実測で close は normal より
// 約1.5dBA大きい→0.84倍(=-1.5dB)で揃える。前半/終盤が同じ大きさに聞こえるように。
const BGM_TRIM = { normal: 1.0, endgame: 0.84 };
function trimLevel(state) { return BGM_LEVEL * (BGM_TRIM[state] ?? 1.0); }

// 等パワーフェード曲線を1本生成。dir='out'は level→0、'in'は 0→level。
// 指数<1でカーブが中央側に膨らみ、2曲が同時に大きく鳴る重複区間を増やす。
function eqPowerCurve(level, dir, steps = 64) {
  const c = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const ph = dir === "out" ? Math.cos((t * Math.PI) / 2) : Math.sin((t * Math.PI) / 2);
    c[i] = level * Math.pow(ph, 0.6);
  }
  return c;
}

// 局面に応じてBGMを切り替える（normal / endgame）。等パワーで約3秒かけて溶け合わせる。
// in/out で各トラックのトリム後レベルを使い、音源ごとの音量差を補正する。
export function setBgm(state, force = false) {
  if (!ctx || !bgmRunning) return;
  if (!force && state === currentBgm) return;
  // decodeがまだなら少し待って再試行
  if (!buffers[state]) { setTimeout(() => setBgm(state, force), 200); return; }
  const now = ctx.currentTime;
  // 既存トラックを等パワーでフェードアウト＆停止予約（各トラック自身のレベルから0へ）。
  // resetParam で進行中の曲線を現在値に固定して終端 → 新しい曲線はオーバーラップせず投げない。
  for (const [name, tr] of Object.entries(bgmTracks)) {
    if (name !== state) {
      resetParam(tr.gain.gain, now);
      try { tr.gain.gain.setValueCurveAtTime(eqPowerCurve(trimLevel(name), "out"), now, XFADE_SEC); } catch {}
      try { tr.src.stop(now + XFADE_SEC + 0.3); } catch {}
      delete bgmTracks[name];
    }
  }
  if (!bgmTracks[state]) bgmTracks[state] = startTrack(state);
  const tr = bgmTracks[state];
  if (tr) {
    const level = trimLevel(state);
    resetParam(tr.gain.gain, now);
    try {
      tr.gain.gain.setValueCurveAtTime(eqPowerCurve(level, "in"), now, XFADE_SEC);
      tr.gain.gain.setValueAtTime(level, now + XFADE_SEC); // フェード後は定常音量を維持
    } catch {}
  }
  currentBgm = state;
}

export function stopBgm() {
  bgmRunning = false;
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [name, tr] of Object.entries(bgmTracks)) {
    // 進行中のクロスフェード曲線を終端してから停止フェード。これが無いと
    // setTargetAtTime が曲線とオーバーラップして NotSupportedError を投げていた。
    resetParam(tr.gain.gain, now);
    try { tr.gain.gain.setTargetAtTime(0, now, 0.3); } catch {}
    try { tr.src.stop(now + 1.0); } catch {}
    delete bgmTracks[name];
  }
  currentBgm = null;
}

// ===================== 終局音バリアント（#8・比較ビルド・追記ブロック） =====================
// 豪華化案の音源を既存の読み込み機構へ追加し、EVENT_SOUND の終局系3タグの割り当てを
// 選択中バリアント（theme_gameover.js）へ差し替える。既存の音・再生経路は一切変更しない。
const GAMEOVER_SFX_FILES = {
  fanfare_win_royal: "./audio/fanfare_win_royal.wav",
  fanfare_lose_royal: "./audio/fanfare_lose_royal.wav",
  fanfare_shutout_royal: "./audio/fanfare_shutout_royal.wav",
  fanfare_win_orch: "./audio/fanfare_win_orch.wav",
  fanfare_lose_orch: "./audio/fanfare_lose_orch.wav",
  fanfare_shutout_orch: "./audio/fanfare_shutout_orch.wav",
};
// 先読み（冒頭の既存ループと同方式）。init() 前に届けば rawBuffers 経由で init がdecodeし、
// init() 後に届いた分はここで直接decodeする（後着の取りこぼし防止）。
for (const [k, url] of Object.entries(GAMEOVER_SFX_FILES)) {
  fetch(`${url}?v=${AUDIO_VER}`).then((r) => r.arrayBuffer()).then((ab) => {
    rawBuffers[k] = ab;
    if (ctx) ctx.decodeAudioData(ab.slice(0)).then((buf) => { buffers[k] = buf; }).catch(() => {});
  }).catch(() => {});
}

// 終局系タグの音割り当てを差し替える。sounds: { タグ: [バッファ名, ゲイン] }
// （theme_gameover.js のバリアント定義）。null・不正値は無視＝既定（現状の割り当て）のまま。
// 対象タグは終局3種に固定し、出し分け構造（タグ集合）は増減させない。
export function applyGameoverVariant(sounds) {
  if (!sounds || typeof sounds !== "object") return;
  for (const tag of ["gameover", "gameover-draw", "shutout"]) {
    const e = sounds[tag];
    if (Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number") {
      EVENT_SOUND[tag] = [e[0], e[1]];
    }
  }
}
