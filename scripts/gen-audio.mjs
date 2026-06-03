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

// 着石：木の打音（フィルタ済みノイズの短いトランジェント＋低い共鳴）
{
  const b = blank(0.16, SR);
  for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] += noise() * 0.6 * Math.exp(-t / 0.012); }
  lowpass(b, 2600, SR);
  tone(b, SR, { type: "sine", freq: 190, t0: 0, dur: 0.16, gain: 0.5, decay: 0.05 });
  tone(b, SR, { type: "sine", freq: 320, t0: 0, dur: 0.10, gain: 0.25, decay: 0.03 });
  console.log("✔", writeWav("place.wav", b, SR));
}

// 返し：短いクリック（エンジン側でplaybackRateを上げて音程上昇＝滝の連鎖）
{
  const b = blank(0.10, SR);
  for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] += noise() * 0.4 * Math.exp(-t / 0.008); }
  lowpass(b, 4000, SR);
  tone(b, SR, { type: "tri", freq: 520, t0: 0, dur: 0.09, gain: 0.4, decay: 0.04 });
  console.log("✔", writeWav("flip.wav", b, SR));
}

// 角取り：澄んだベル（倍音＋長めの減衰）
{
  const b = blank(1.3, SR);
  const base = 660;
  [[1, 0.5], [2.0, 0.3], [3.01, 0.18], [4.2, 0.12], [5.4, 0.08]].forEach(([m, g]) =>
    tone(b, SR, { type: "sine", freq: base * m, t0: 0, dur: 1.3, gain: g, attack: 0.002, decay: 0.55 }));
  console.log("✔", writeWav("bell.wav", b, SR));
}

// 逆転：駆け上がるスイープ
{
  const b = blank(0.6, SR);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR, f = 300 + 900 * (t / 0.6);
    b[i] += Math.sin(TAU * f * t) * 0.3 * Math.exp(-t / 0.4);
  }
  console.log("✔", writeWav("reversal.wav", b, SR));
}

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
  lowpass(b, 1400, BR);
  console.log("✔", writeWav("bgm_normal.wav", seamless(b, BR), BR));
}

// 終盤・接戦：白熱した緊迫感（解決しない持続音＋不協＋刻みパルス）
{
  const L = 8, b = blank(L, BR);
  // 半音/三全音でぶつかる持続ドローン
  [146.8, 155.6, 207.7].forEach((f) => {
    for (let i = 0; i < b.length; i++) {
      const t = i / BR, swell = 0.5 + 0.5 * Math.sin(TAU * 0.12 * t);
      b[i] += Math.sin(TAU * f * t) * 0.05 * swell;
    }
  });
  // 不規則めの刻み（心拍/緊張）
  for (let beat = 0; beat * 0.5 < L; beat++) {
    tone(b, BR, { type: "tri", freq: 880, t0: beat * 0.5, dur: 0.08, gain: 0.06, decay: 0.04 });
  }
  lowpass(b, 2200, BR);
  console.log("✔", writeWav("bgm_close.wav", seamless(b, BR), BR));
}

// 終盤・一方的：壮大で力強い行進曲（インペリアルマーチ参照：G minor・~100BPM・低音ブラス様＋ティンパニ）
{
  const bpm = 100, beat = 60 / bpm, L = beat * 16, b = blank(L, BR);
  const G4 = 392, Eb4 = semis(392, -4), Bb4 = semis(392, 3), G3 = 196, D3 = semis(196, 7);
  // 主旋律モチーフ（G G G | Eb Bb G）を低音ブラス様(saw+lowpass)で2回
  const motif = [
    [G4, 1], [G4, 1], [G4, 1], [Eb4, 0.75], [Bb4, 0.25], [G4, 1],
    [Eb4, 0.75], [Bb4, 0.25], [G4, 2],
  ];
  let tcur = 0;
  for (let rep = 0; rep < 2; rep++) {
    for (const [f, beats] of motif) {
      tone(b, BR, { type: "saw", freq: f / 2, t0: tcur, dur: beats * beat * 0.95, gain: 0.16, vib: 4, decay: beats * beat });
      tone(b, BR, { type: "saw", freq: f, t0: tcur, dur: beats * beat * 0.9, gain: 0.05, vib: 4, decay: beats * beat * 0.6 });
      tcur += beats * beat;
    }
  }
  // ベース・ペダル（G）と各拍のティンパニ様の低打撃で行進感
  for (let i = 0; i < (L / beat) | 0; i++) {
    tone(b, BR, { type: "sine", freq: i % 4 === 2 ? D3 : G3, t0: i * beat, dur: beat * 0.9, gain: 0.18, decay: beat * 0.5 });
    // ティンパニ：低いsine＋ピッチ落ち＋ノイズ
    const s0 = (i * beat * BR) | 0;
    for (let j = 0; j < (0.18 * BR) | 0 && s0 + j < b.length; j++) {
      const t = j / BR;
      b[s0 + j] += Math.sin(TAU * (110 - 50 * (t / 0.18)) * t) * 0.22 * Math.exp(-t / 0.09);
      b[s0 + j] += noise() * 0.05 * Math.exp(-t / 0.02);
    }
  }
  lowpass(b, 2600, BR);
  console.log("✔", writeWav("bgm_oneside.wav", seamless(b, BR), BR));
}

console.log("→ 出力先:", OUT);
