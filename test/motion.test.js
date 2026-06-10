import { test } from "node:test";
import assert from "node:assert/strict";
import { motionPolicy, watchReducedMotion, REDUCED_MOTION_QUERY } from "../src/motion.js";

// ---- motionPolicy：エフェクト演出トグル × OSのreduced-motion の判定表（純関数） ----

test("motionPolicy: トグルON・reduce無し → スポット演出も動きの強い演出も出す", () => {
  assert.deepEqual(motionPolicy({ effectsOn: true, reducedMotion: false }), {
    spotEffects: true, strongMotion: true,
  });
});

test("motionPolicy: トグルON・reduce有効 → スポット演出は残しシェイク・ジッタ等のみ抑制", () => {
  assert.deepEqual(motionPolicy({ effectsOn: true, reducedMotion: true }), {
    spotEffects: true, strongMotion: false,
  });
});

test("motionPolicy: トグルOFF → reduced-motionの値に依らず両方出さない（既存トグルの粒度を維持）", () => {
  assert.deepEqual(motionPolicy({ effectsOn: false, reducedMotion: false }), {
    spotEffects: false, strongMotion: false,
  });
  assert.deepEqual(motionPolicy({ effectsOn: false, reducedMotion: true }), {
    spotEffects: false, strongMotion: false,
  });
});

test("motionPolicy: 不正な入力は安全側に倒す（effectsOn非boolean→演出なし／reducedMotion非boolean→抑制しない）", () => {
  // effectsOn が boolean でない＝信頼できない入力 → 演出を出さない側へ
  assert.deepEqual(motionPolicy({ effectsOn: 1, reducedMotion: false }), {
    spotEffects: false, strongMotion: false,
  });
  // reducedMotion が boolean でない＝OS設定を読めていない → 従来どおり（抑制しない）
  assert.deepEqual(motionPolicy({ effectsOn: true, reducedMotion: undefined }), {
    spotEffects: true, strongMotion: true,
  });
  // 引数なしでも例外を投げない
  assert.deepEqual(motionPolicy(), { spotEffects: false, strongMotion: false });
});

test("motionPolicy: 返り値は凍結されている（呼び出し側で書き換えられない）", () => {
  assert.equal(Object.isFrozen(motionPolicy({ effectsOn: true, reducedMotion: false })), true);
});

// ---- watchReducedMotion：matchMedia 境界アダプタ（偽windowで検証） ----

// matchMedia を持つ偽 window。change リスナーを保持し、emit で発火できる。
function fakeWindow(matches) {
  const listeners = [];
  const mql = {
    matches,
    addEventListener: (type, fn) => { if (type === "change") listeners.push(fn); },
  };
  return {
    matchMedia: (q) => (q === REDUCED_MOTION_QUERY ? mql : { matches: false, addEventListener: () => {} }),
    _emit: (m) => { mql.matches = m; for (const fn of listeners) fn({ matches: m }); },
  };
}

test("watchReducedMotion: 現在のreduced-motion状態を返す", () => {
  assert.equal(watchReducedMotion(() => {}, fakeWindow(true)), true);
  assert.equal(watchReducedMotion(() => {}, fakeWindow(false)), false);
});

test("watchReducedMotion: メディアクエリの変更イベントに追随してonChangeへ通知する", () => {
  const win = fakeWindow(false);
  const seen = [];
  watchReducedMotion((m) => seen.push(m), win);
  win._emit(true);
  win._emit(false);
  assert.deepEqual(seen, [true, false]);
});

test("watchReducedMotion: matchMedia非対応・例外環境ではfalse（抑制しない）で動き続ける", () => {
  assert.equal(watchReducedMotion(() => {}, {}), false); // matchMedia なし
  assert.equal(watchReducedMotion(() => {}, { matchMedia: () => { throw new Error("boom"); } }), false);
  // 古いブラウザ：mql に addEventListener が無くても例外を投げず現在値は返す
  assert.equal(watchReducedMotion(() => {}, { matchMedia: () => ({ matches: true }) }), true);
});
