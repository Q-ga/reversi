import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../src/variants.js";
import { BIG_FLIP_THRESHOLD } from "../src/events.js";
import {
  flipBaseRate, topCap, sparkPlan, harpPlan,
  FLIP_BASE_THEME, FLIP_TOP_THEME,
  createTopPlayer, registerFlipThemes, applyFlipVariants,
} from "../src/theme_flip.js";

// 上モノ層の playSfx 呼び出しを記録するフェイク
function sfxRecorder() {
  const calls = [];
  const playSfx = (name, opts = {}) => calls.push({ name, ...opts });
  return { calls, playSfx };
}

// audio 名前空間のフェイク（applyFlipVariants の依存注入先）
function fakeAudio() {
  const state = { base: null, top: "unset", sfx: [] };
  return {
    state,
    setFlipBase: (name, gain) => { state.base = { name, gain }; },
    setFlipTop: (p) => { state.top = p; },
    playSfx: (name, opts = {}) => { state.sfx.push({ name, ...opts }); },
  };
}

// ============ flipBaseRate（基音層のピッチ上昇則） ============

test("flipBaseRate: 既存 playFlipLand の式 1+min(i,14)*0.045 と完全一致する", () => {
  for (let i = 0; i <= 20; i++) {
    assert.equal(flipBaseRate(i), 1 + Math.min(i, 14) * 0.045);
  }
});

test("flipBaseRate: 1枚目は等倍・以降は単調増加・15枚目以降は頭打ち", () => {
  assert.equal(flipBaseRate(0), 1);
  for (let i = 0; i < 14; i++) assert.ok(flipBaseRate(i + 1) > flipBaseRate(i));
  assert.equal(flipBaseRate(14), flipBaseRate(20));
});

// ============ topCap（変動則：強度の天井は手の価値に比例） ============

test("topCap: total に対して単調非減少", () => {
  for (let t = 0; t < 12; t++) assert.ok(topCap(t + 1) >= topCap(t));
});

test("topCap: 小さな手は天井が低く（<1）、大量返しで満額に達する", () => {
  assert.ok(topCap(1) < 1);
  assert.ok(topCap(2) < 1);
  assert.equal(topCap(10), 1);
  assert.equal(topCap(20), 1); // 上限で頭打ち
});

// ============ sparkPlan（Balatro式キラリ積み上げ） ============

test("sparkPlan: ピッチ(rate)は i に対して単調増加し14で頭打ち", () => {
  for (let i = 0; i < 14; i++) {
    assert.ok(sparkPlan(i + 1, 10).rate > sparkPlan(i, 10).rate, `i=${i}`);
  }
  assert.equal(sparkPlan(14, 10).rate, sparkPlan(20, 10).rate);
});

test("sparkPlan: 明るさ(gain)は i に対して単調非減少（積み上がるほど強く）", () => {
  for (let i = 0; i < 16; i++) {
    assert.ok(sparkPlan(i + 1, 10).gain >= sparkPlan(i, 10).gain, `i=${i}`);
  }
});

test("sparkPlan: 変動則＝同じ i でも総返し枚数が大きいほど強い", () => {
  assert.ok(sparkPlan(3, 1).gain < sparkPlan(3, 10).gain);
});

test("sparkPlan: 全手最大演出禁止＝小さな手は最大強度に届かない", () => {
  assert.ok(sparkPlan(14, 1).gain < sparkPlan(14, 10).gain);
  assert.ok(sparkPlan(14, 2).gain < sparkPlan(14, 10).gain);
});

test("sparkPlan: 燃える(hot)のは大量返し（bigFlip閾値以上）の3枚目から", () => {
  // 閾値未満ではどの i でも燃えない
  for (let i = 0; i < 16; i++) assert.equal(sparkPlan(i, BIG_FLIP_THRESHOLD - 1).hot, false);
  // 閾値以上：序盤(i<2)は燃えず、i>=2 から燃える
  assert.equal(sparkPlan(0, BIG_FLIP_THRESHOLD).hot, false);
  assert.equal(sparkPlan(1, BIG_FLIP_THRESHOLD).hot, false);
  assert.equal(sparkPlan(2, BIG_FLIP_THRESHOLD).hot, true);
  assert.equal(sparkPlan(10, 18).hot, true);
});

test("sparkPlan: 燃焼レイヤーの強さ(hotGain)は hot のときだけ正で、連鎖が進むほど増す", () => {
  assert.equal(sparkPlan(1, 10).hotGain, 0);
  const a = sparkPlan(2, 10), b = sparkPlan(8, 10);
  assert.ok(a.hotGain > 0);
  assert.ok(b.hotGain > a.hotGain);
});

// ============ harpPlan（階段ハープ） ============

test("harpPlan: ピッチ(rate)はペンタトニックを単調に駆け上がる", () => {
  for (let i = 0; i < 14; i++) {
    assert.ok(harpPlan(i + 1, 10).rate > harpPlan(i, 10).rate, `i=${i}`);
  }
  // 表の終端で頭打ち
  assert.equal(harpPlan(14, 10).rate, harpPlan(30, 10).rate);
});

test("harpPlan: 音階はメジャーペンタトニック（2度→4半音→完全5度…）", () => {
  assert.equal(harpPlan(0, 5).rate, 1);
  assert.equal(harpPlan(1, 5).rate, Math.pow(2, 2 / 12));
  assert.equal(harpPlan(3, 5).rate, Math.pow(2, 7 / 12));
  assert.equal(harpPlan(5, 5).rate, 2); // 1オクターブ上
});

test("harpPlan: 変動則＝gain は i と total の双方に対して単調非減少", () => {
  for (let i = 0; i < 14; i++) assert.ok(harpPlan(i + 1, 10).gain >= harpPlan(i, 10).gain);
  assert.ok(harpPlan(5, 1).gain < harpPlan(5, 10).gain);
});

// ============ テーマ定義 ============

test("テーマ定義: 基音層の既定は現行の flip_land（gain 0.9）", () => {
  assert.equal(FLIP_BASE_THEME.defaultId, "wood");
  const def = FLIP_BASE_THEME.variants.find((v) => v.id === FLIP_BASE_THEME.defaultId);
  assert.equal(def.sfx, "flip_land");
  assert.equal(def.gain, 0.9);
});

test("テーマ定義: 上モノ層の既定は「なし」＝現行挙動", () => {
  assert.equal(FLIP_TOP_THEME.defaultId, "none");
});

test("テーマ定義: 基音層・上モノ層とも3案以上（既定含む）を持つ", () => {
  assert.ok(FLIP_BASE_THEME.variants.length >= 3);
  assert.ok(FLIP_TOP_THEME.variants.length >= 3);
});

test("registerFlipThemes: レジストリに2テーマが登録され、既定解決できる", () => {
  const reg = createRegistry();
  registerFlipThemes(reg);
  assert.deepEqual(reg.list().map((t) => t.id), ["flipBase", "flipTop"]);
  assert.deepEqual(reg.resolve(""), { flipBase: "wood", flipTop: "none" });
  // 2テーマは独立に切替できる（URLで片方だけ・両方の指定）
  assert.deepEqual(reg.resolve("?variant=flipTop:balatro"), { flipBase: "wood", flipTop: "balatro" });
  assert.deepEqual(reg.resolve("?variant=flipBase:glass,flipTop:harp"), { flipBase: "glass", flipTop: "harp" });
});

// ============ createTopPlayer ============

test("createTopPlayer: none・未知IDは null（＝上モノなし）", () => {
  const { playSfx } = sfxRecorder();
  assert.equal(createTopPlayer("none", playSfx), null);
  assert.equal(createTopPlayer("zzz", playSfx), null);
  assert.equal(createTopPlayer(undefined, playSfx), null);
});

test("createTopPlayer(balatro): 1枚ごとにキラリが1発、小さな手では燃えない", () => {
  const { calls, playSfx } = sfxRecorder();
  const play = createTopPlayer("balatro", playSfx);
  play(0, 2);
  play(1, 2);
  assert.deepEqual(calls.map((c) => c.name), ["flip_top_spark", "flip_top_spark"]);
  assert.ok(calls[1].rate > calls[0].rate); // キラリも積み上がりでピッチ上昇
});

test("createTopPlayer(balatro): 大量返しでは燃焼レイヤーが重なる（エスカレーション）", () => {
  const { calls, playSfx } = sfxRecorder();
  const play = createTopPlayer("balatro", playSfx);
  for (let i = 0; i < 8; i++) play(i, 8);
  const sparks = calls.filter((c) => c.name === "flip_top_spark");
  const flames = calls.filter((c) => c.name === "flip_top_flame");
  assert.equal(sparks.length, 8);       // キラリは全数
  assert.equal(flames.length, 6);       // i>=2 から燃える
  assert.ok(flames.at(-1).gain > flames[0].gain); // 燃えは強まる
});

test("createTopPlayer(harp): 1枚ごとに弦が1発、音階を上る", () => {
  const { calls, playSfx } = sfxRecorder();
  const play = createTopPlayer("harp", playSfx);
  for (let i = 0; i < 4; i++) play(i, 4);
  assert.deepEqual(calls.map((c) => c.name), Array(4).fill("flip_top_harp"));
  for (let i = 0; i < 3; i++) assert.ok(calls[i + 1].rate > calls[i].rate);
});

// ============ applyFlipVariants ============

test("applyFlipVariants: 既定選択では現行と同一（flip_land・上モノなし）", () => {
  const audio = fakeAudio();
  applyFlipVariants({ flipBase: "wood", flipTop: "none" }, audio);
  assert.deepEqual(audio.state.base, { name: "flip_land", gain: 0.9 });
  assert.equal(audio.state.top, null);
});

test("applyFlipVariants: 基音層と上モノ層を独立に適用できる", () => {
  const audio = fakeAudio();
  applyFlipVariants({ flipBase: "stone", flipTop: "balatro" }, audio);
  assert.equal(audio.state.base.name, "flip_land_stone");
  assert.equal(typeof audio.state.top, "function");
  // 注入した playSfx 経由で上モノが鳴る
  audio.state.top(0, 6);
  assert.equal(audio.state.sfx[0].name, "flip_top_spark");
});

test("applyFlipVariants: 不正な選択は既定（現行挙動）へフォールバック", () => {
  const audio = fakeAudio();
  applyFlipVariants(null, audio);
  assert.deepEqual(audio.state.base, { name: "flip_land", gain: 0.9 });
  assert.equal(audio.state.top, null);
});
