// DSPで音源WAVを生成する（依存なし・再実行で全再生成）。
//   実行: node scripts/gen-audio.mjs
//   出力: audio/*.wav （効果音＝44.1kHzモノ / BGM＝32kHzモノ・ループ用シームレス化）
// 設計根拠は dev-log.md「BGM設計」、CONTEXT.md「局面フェーズ/競り合い度」参照。
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "audio");
mkdirSync(OUT, { recursive: true });

// ---- WAV書き出し（16bit PCM mono） ----
function writeWav(name, samples, sr) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(join(OUT, name), buf);
  return name + ` (${(buf.length / 1024).toFixed(0)}KB, ${(n / sr).toFixed(1)}s)`;
}

const TAU = Math.PI * 2;
const noise = () => Math.random() * 2 - 1;
// 一極ローパス（brass/woodの角を取る）
function lowpass(buf, cutoff, sr) {
  const dt = 1 / sr, rc = 1 / (TAU * cutoff), a = dt / (rc + dt);
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; }
  return buf;
}
// ピーク基準でレベルを揃える（小さすぎ/大きすぎを防ぐ）
function normalize(buf, target = 0.9) {
  let pk = 0; for (const v of buf) pk = Math.max(pk, Math.abs(v));
  if (pk > 0) { const g = target / pk; for (let i = 0; i < buf.length; i++) buf[i] *= g; }
  return buf;
}
// 簡易リバーブ（並列コムフィルタ）。残響感を付与する。
function reverb(dry, sr, { decay = 2.2, mix = 0.5 } = {}) {
  const N = dry.length, wet = new Float32Array(N);
  for (const Draw of [1116, 1188, 1277, 1356]) {
    const D = Math.round((Draw * sr) / 44100);
    const g = Math.pow(10, (-3 * (D / sr)) / decay);
    const cb = new Float32Array(N);
    for (let i = 0; i < N; i++) { cb[i] = dry[i] + (i >= D ? g * cb[i - D] : 0); wet[i] += cb[i]; }
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = dry[i] * (1 - mix) + (wet[i] / 4) * mix;
  return out;
}
// ループのつなぎ目を消す（末尾fadeを先頭にクロスフェード）
function seamless(buf, sr, fadeSec = 0.18) {
  const f = Math.min((sr * fadeSec) | 0, (buf.length / 2) | 0);
  const out = buf.slice(0, buf.length - f);
  for (let i = 0; i < f; i++) {
    const w = i / f;
    out[i] = out[i] * (1 - w) + buf[buf.length - f + i] * w; // tail→headへ
  }
  return out;
}
const semis = (base, s) => base * Math.pow(2, s / 12);

// 音を1つbufに足す（osc種・周波数・開始・長さ・音量・減衰）
function tone(buf, sr, { type = "sine", freq, t0, dur, gain = 0.3, attack = 0.005, decay = null, vib = 0 }) {
  const s0 = (t0 * sr) | 0, s1 = Math.min(buf.length, ((t0 + dur) * sr) | 0);
  const dk = decay == null ? dur : decay;
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / sr;
    const ph = TAU * freq * t * (1 + (vib ? 0.004 * Math.sin(TAU * vib * t) : 0));
    let w;
    if (type === "sine") w = Math.sin(ph);
    else if (type === "tri") w = Math.asin(Math.sin(ph)) * (2 / Math.PI);
    else if (type === "square") w = Math.sin(ph) >= 0 ? 1 : -1;
    else w = 2 * (((freq * t) % 1)) - 1; // saw
    const env = Math.min(1, t / attack) * Math.exp(-t / dk);
    buf[i] += w * gain * env;
  }
}
function blank(sec, sr) { return new Float32Array((sec * sr) | 0); }

// ===================== 効果音（44.1kHz） =====================
const SR = 44100;

// 着石「コツ」：今の打撃をベースに、頭=高く澄んだアタック、尻=控えめな低音アクセント＋軽い残響。
{
  const b = blank(0.42, SR); // reverbの残響が切れないよう長めに確保
  // 明るいトランジェント（中高域）＝小型スピーカーでも抜ける
  for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] += noise() * 0.8 * Math.exp(-t / 0.005); }
  lowpass(b, 7000, SR);
  // 頭：高く澄んだアタック（クリアな「チッ」）＝わずかにゲインを下げて尖りを抑える
  tone(b, SR, { type: "sine", freq: 2400, t0: 0, dur: 0.045, gain: 0.28, attack: 0.0004, decay: 0.012 });
  tone(b, SR, { type: "sine", freq: 3200, t0: 0, dur: 0.030, gain: 0.13, attack: 0.0004, decay: 0.008 });
  // ベース：今の「コツ」
  tone(b, SR, { type: "sine", freq: 950, t0: 0, dur: 0.05, gain: 0.6, decay: 0.018 }); // カチッ
  tone(b, SR, { type: "sine", freq: 520, t0: 0, dur: 0.08, gain: 0.45, decay: 0.03 }); // 木質
  tone(b, SR, { type: "sine", freq: 230, t0: 0, dur: 0.12, gain: 0.35, decay: 0.05 }); // ボディ
  // 尻：低音アクセント（控えめに・やや遅れて「ドゥン」）＝重みは出すが主張は抑える
  tone(b, SR, { type: "sine", freq: 120, t0: 0.018, dur: 0.17, gain: 0.28, attack: 0.004, decay: 0.085 });
  tone(b, SR, { type: "sine", freq: 80,  t0: 0.022, dur: 0.20, gain: 0.14, attack: 0.005, decay: 0.11 });
  const wet = reverb(b, SR, { decay: 1.0, mix: 0.20 }); // 最後に気持ちだけ残響
  console.log("✔", writeWav("place.wav", normalize(wet, 0.97), SR));
}

// 大量返し：シャキーン系の金属感＋高→低へ吸い込まれる「ヒュォー」（下降スウィープ＋残響）。
{
  const b = blank(1.6, SR);
  const sw = (0.55 * SR) | 0;
  for (let i = 0; i < sw; i++) {
    const t = i / SR, p = t / 0.55;
    const f = 4600 - 3700 * p * p;                 // 高→低へ吸い込まれる
    const env = Math.sin(Math.min(p, 1) * Math.PI) * 0.9;
    b[i] += Math.sin(TAU * f * t) * 0.20 * env;
    b[i] += Math.sin(TAU * f * 0.5 * t) * 0.12 * env; // 1オクターブ下＝厚み
  }
  // 吸引のノイズ（風を吸い込む気配・減衰）
  for (let i = 0; i < (0.55 * SR) | 0; i++) { const t = i / SR; b[i] += noise() * 0.12 * Math.exp(-t / 0.2); }
  // 余韻の金属リング（控えめ）
  [2600, 3400, 4300].forEach((f, k) =>
    tone(b, SR, { type: "sine", freq: f, t0: 0.2, dur: 1.0, gain: 0.09 / (1 + k * 0.4), attack: 0.002, decay: 0.3 }));
  const wet = reverb(b, SR, { decay: 1.7, mix: 0.38 });
  console.log("✔", writeWav("big_swoosh.wav", normalize(wet, 0.72), SR));
}

// 返し(1)：スッと持ち上げる音（短くスッキリ。washy/リバーブ感なし）
{
  const b = blank(0.10, SR);
  for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] += noise() * 0.45 * Math.exp(-t / 0.022); } // 短い気配
  for (let i = 0; i < (0.06 * SR) | 0; i++) { const t = i / SR; b[i] += Math.sin(TAU * (620 + 760 * (t / 0.06)) * t) * 0.10 * Math.exp(-t / 0.03); } // 上昇の芯
  lowpass(b, 3600, SR);
  console.log("✔", writeWav("flip_lift.wav", normalize(b, 0.45), SR));
}

// 返し(2)：コッと置く重厚な木のタップ（低め）。連鎖でこれが「ココここコツ」と連打される。
{
  const b = blank(0.13, SR);
  for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] += noise() * 0.4 * Math.exp(-t / 0.006); }
  lowpass(b, 3800, SR);
  tone(b, SR, { type: "sine", freq: 300, t0: 0, dur: 0.09, gain: 0.55, decay: 0.04 });  // 低い芯
  tone(b, SR, { type: "sine", freq: 165, t0: 0, dur: 0.11, gain: 0.4, decay: 0.06 });   // 重厚なボディ
  console.log("✔", writeWav("flip_land.wav", normalize(b, 0.85), SR));
}

// 角取り：剣を抜くような「シャキーン」（長めの上昇金属スウィング＋金属リング＋残響）。音量控えめ。
{
  const b = blank(2.2, SR);
  // 上昇する金属スウィング（shiiing）— やや長め
  const sw = (0.34 * SR) | 0;
  for (let i = 0; i < sw; i++) {
    const t = i / SR, p = t / 0.34;
    const f = 1400 + 5200 * p * p;                 // 加速して駆け上がる
    const env = Math.sin(Math.min(p, 1) * Math.PI) * 0.9;
    b[i] += Math.sin(TAU * f * t) * 0.22 * env;
    b[i] += Math.sin(TAU * f * 1.5 * t) * 0.10 * env; // 金属感の上倍音
  }
  // 頂点で鳴る金属リング（inharmonic・余韻）
  [3000, 4050, 5200, 6300].forEach((f, k) =>
    tone(b, SR, { type: "sine", freq: f, t0: 0.28, dur: 1.4, gain: 0.16 / (1 + k * 0.4), attack: 0.002, decay: 0.4 }));
  // きらめきの粒
  for (let i = (0.28 * SR) | 0; i < (0.55 * SR) | 0; i++) { const t = (i - 0.28 * SR) / SR; b[i] += noise() * 0.05 * Math.exp(-t / 0.05); }
  const wet = reverb(b, SR, { decay: 1.9, mix: 0.4 });
  console.log("✔", writeWav("bell.wav", normalize(wet, 0.7), SR));
}

// （逆転演出は廃止したため reversal.wav は生成しない）

// 勝利ファンファーレ（長調アルペジオ・brass様）
{
  const b = blank(1.4, SR), root = 392;
  [0, 4, 7, 12, 16, 19].forEach((s, i) =>
    tone(b, SR, { type: "saw", freq: semis(root, s), t0: i * 0.12, dur: 0.5, gain: 0.22, vib: 5, decay: 0.4 }));
  lowpass(b, 3000, SR);
  console.log("✔", writeWav("fanfare_win.wav", b, SR));
}

// 敗北（下降・短調）
{
  const b = blank(1.1, SR), root = 392;
  [0, -3, -7, -12].forEach((s, i) =>
    tone(b, SR, { type: "tri", freq: semis(root, s), t0: i * 0.18, dur: 0.6, gain: 0.28, decay: 0.5 }));
  console.log("✔", writeWav("fanfare_lose.wav", b, SR));
}

// ===================== BGM（32kHz・ループ） =====================
const BR = 32000;

// 通常（前半＋中盤）：静かで落ち着いたアンビエント・パッド（Am系の柔らかい和音）
{
  const L = 12, b = blank(L, BR);
  const chords = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]];
  chords.forEach((ch, ci) => ch.forEach((f) => {
    // 各和音3秒、緩やかな出入り
    const t0 = ci * 3;
    for (let i = (t0 * BR) | 0; i < ((t0 + 3.2) * BR) | 0 && i < b.length; i++) {
      const t = (i / BR) - t0;
      const env = Math.sin(Math.min(Math.max(t / 3.2, 0), 1) * Math.PI) * 0.9;
      b[i] += Math.sin(TAU * f * (i / BR)) * 0.06 * env;
      b[i] += Math.sin(TAU * f * 2 * (i / BR)) * 0.015 * env; // 薄い倍音
    }
  }));
  lowpass(b, 1500, BR);
  // 通常は穏やか＝控えめレベル（終盤との差を出す）
  console.log("✔", writeWav("bgm_normal.wav", normalize(seamless(b, BR), 0.55), BR));
}

// 終盤：暗めの駆けるギャロップ（道化師のギャロップ風の疾走感＝緊迫。ただし短調で暗く・ベル無し）
{
  const bpm = 152, beat = 60 / bpm, eighth = beat / 2, L = beat * 16, b = blank(L, BR);
  // Dマイナー。低音ブラスの疾走ベース（8分でroot/5thを刻む＝ギャロップ）
  const D2 = 73.4, A2 = 110, F2 = 87.3, bassSeq = [D2, A2, D2, A2, F2, A2, D2, A2];
  const eN = Math.round(L / eighth);
  for (let k = 0; k < eN; k++) {
    const f = bassSeq[k % bassSeq.length];
    tone(b, BR, { type: "saw", freq: f, t0: k * eighth, dur: eighth * 0.82, gain: 0.16, decay: eighth * 0.6 });
    // スネア様の駆動（各8分・表拍は強め）
    const s0 = (k * eighth * BR) | 0, accent = k % 2 === 0 ? 0.10 : 0.05;
    for (let j = 0; j < (0.05 * BR) | 0 && s0 + j < b.length; j++) { const t = j / BR; b[s0 + j] += noise() * accent * Math.exp(-t / 0.02); }
  }
  // 中域ブラスの短い短調モチーフ（緊迫・上ずらない暗さ）。2拍ごとに駆ける音型
  const D4 = 293.7, E4 = semis(293.7, 2), F4 = semis(293.7, 3), A4 = semis(293.7, 7), G4 = semis(293.7, 5);
  const motif = [A4, G4, F4, E4, F4, D4, E4, D4]; // 下降基調の短調モチーフ
  motif.forEach((f, k) => {
    tone(b, BR, { type: "saw", freq: f, t0: k * (2 * eighth), dur: eighth * 1.4, gain: 0.13, vib: 5, decay: eighth * 1.2 });
  });
  lowpass(b, 2400, BR); // 高域を抑えて暗く（木琴/ベルの華やかさを出さない）
  console.log("✔", writeWav("bgm_close.wav", normalize(seamless(b, BR), 0.85), BR));
}


console.log("→ 出力先:", OUT);
