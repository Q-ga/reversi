// Web Audio による音の合成。効果音＋8bitチップチューンBGM（形勢3段階）。
// すべてコード生成（音源ファイル無し）。iOS制約のため init() は最初のタップ後に呼ぶ。

let ctx = null;
let sfxGain = null;
let bgmGain = null;
let sfxOn = true;
let bgmOn = true;

let bgmTimer = null;
let bgmStep = 0;
let bgmBand = "even";

// 8bit風の単音（矩形波）
function blip(freq, dur, when, gainNode, type = "square", vol = 0.2) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g);
  g.connect(gainNode);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

export function init() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  sfxGain = ctx.createGain();
  bgmGain = ctx.createGain();
  sfxGain.gain.value = 0.9;
  bgmGain.gain.value = bgmOn ? 0.25 : 0;
  sfxGain.connect(ctx.destination);
  bgmGain.connect(ctx.destination);
}

export function setSfxEnabled(on) {
  sfxOn = on;
}
export function setBgmEnabled(on) {
  bgmOn = on;
  if (bgmGain) bgmGain.gain.value = on ? 0.25 : 0;
}
export function isSfxEnabled() { return sfxOn; }
export function isBgmEnabled() { return bgmOn; }

// --- 効果音 ---
export function playPlace() {
  if (!ctx || !sfxOn) return;
  blip(180, 0.12, ctx.currentTime, sfxGain, "triangle", 0.35); // コトッ
}

// 連鎖めくり用：index が進むほど音程が上がる（滝/上昇コンボ）
export function playFlip(index = 0) {
  if (!ctx || !sfxOn) return;
  const freq = 440 + index * 45;
  blip(freq, 0.07, ctx.currentTime, sfxGain, "square", 0.18);
}

function arpUp(base, steps, gap, type = "square") {
  const t0 = ctx.currentTime;
  steps.forEach((semi, i) => blip(base * Math.pow(2, semi / 12), 0.12, t0 + i * gap, sfxGain, type, 0.25));
}

export function playEventSound(tag) {
  if (!ctx || !sfxOn) return;
  switch (tag) {
    case "corner": arpUp(523, [0, 4, 7, 12], 0.05); break;            // キラッ（上昇）
    case "reversal": arpUp(330, [0, 5, 9, 14, 19], 0.04, "sawtooth"); break;
    case "bigFlip": blip(120, 0.3, ctx.currentTime, sfxGain, "sawtooth", 0.25); break;
    case "gameover-win": arpUp(523, [0, 4, 7, 12, 16, 19], 0.09); break; // ファンファーレ
    case "gameover-lose": arpUp(440, [0, -3, -7, -12], 0.12, "triangle"); break;
    case "gameover-draw": arpUp(440, [0, 0], 0.15, "triangle"); break;
    case "shutout": arpUp(659, [0, 7, 12, 19, 24], 0.07); break;
    case "pass": blip(150, 0.15, ctx.currentTime, sfxGain, "triangle", 0.2); break;
    case "lastCell": blip(880, 0.08, ctx.currentTime, sfxGain, "square", 0.2); break;
    default: break;
  }
}

// --- BGM（形勢3段階のチップチューン） ---
// 各バンドで音階・テンポ・波形を変えてトーンを作り分ける。
const PATTERNS = {
  win:  { notes: [0, 4, 7, 12, 7, 4, 7, 9], root: 392, tempo: 150, type: "square" },   // 明るい長調・軽快
  even: { notes: [0, 3, 7, 3, 5, 3, 0, -2], root: 330, tempo: 110, type: "triangle" }, // 淡々・緊張
  lose: { notes: [0, -2, -5, -2, -7, -5, -2, 0], root: 294, tempo: 95, type: "sawtooth" }, // 不穏・低め
};

function bgmTick() {
  if (!ctx) return;
  const p = PATTERNS[bgmBand];
  const semi = p.notes[bgmStep % p.notes.length];
  const freq = p.root * Math.pow(2, semi / 12);
  if (bgmOn) blip(freq, 0.18, ctx.currentTime, bgmGain, p.type, 0.5);
  // ベース（1拍おき）
  if (bgmStep % 2 === 0 && bgmOn) {
    blip(p.root / 2, 0.22, ctx.currentTime, bgmGain, "triangle", 0.4);
  }
  bgmStep++;
  bgmTimer = setTimeout(bgmTick, 60000 / PATTERNS[bgmBand].tempo / 2);
}

export function startBgm() {
  if (!ctx || bgmTimer) return;
  bgmStep = 0;
  bgmTick();
}

export function stopBgm() {
  if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; }
}

// 形勢バンドの切替（クロスフェード風にgainを軽く揺らす）
export function setBand(band) {
  if (band === bgmBand) return;
  bgmBand = band;
  if (!ctx || !bgmOn) return;
  const now = ctx.currentTime;
  bgmGain.gain.cancelScheduledValues(now);
  bgmGain.gain.setValueAtTime(bgmGain.gain.value, now);
  bgmGain.gain.linearRampToValueAtTime(0.08, now + 0.15);
  bgmGain.gain.linearRampToValueAtTime(0.25, now + 0.5);
}
