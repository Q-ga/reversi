import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIMING_KEYS, DEFAULT_FLIP_TIMING, FLIP_TIMING_THEME,
  validateFlipTiming, normalizeFlipTiming, leadFlipTotalMs,
} from "../src/theme_timing.js";
import { createRegistry } from "../src/variants.js";

// ============ テーマ定義の形状 ============

test("テーマ: id=flipTiming・バリアント3案以上・defaultIdが現状案", () => {
  assert.equal(FLIP_TIMING_THEME.id, "flipTiming");
  assert.ok(FLIP_TIMING_THEME.variants.length >= 3, "比較ビルドの受け入れ基準＝3案以上");
  assert.equal(FLIP_TIMING_THEME.defaultId, "current");
  assert.ok(FLIP_TIMING_THEME.variants.some((v) => v.id === FLIP_TIMING_THEME.defaultId));
});

test("テーマ: variants.jsのレジストリにそのまま登録できる（ID規約準拠）", () => {
  const reg = createRegistry();
  reg.register(FLIP_TIMING_THEME); // 不正定義なら throw
  assert.equal(reg.get("flipTiming").label, FLIP_TIMING_THEME.label);
});

test("テーマ: 既定案のタイミングは現行実装値と一致（現状案のロック）", () => {
  // render3d.js の現行値：LIFT_MS 150 / HOLD 135 / ROT_MS 360 / stepMs 95 /
  // フォロワー520 / PRE_FLIP_MS 190。既定案＝現状を数値で固定する。
  const current = FLIP_TIMING_THEME.variants.find((v) => v.id === "current");
  assert.deepEqual(current.timing, {
    liftMs: 150, holdMs: 135, rotMs: 360, stepMs: 95, followMs: 520, preFlipMs: 190,
  });
  assert.deepEqual(DEFAULT_FLIP_TIMING, current.timing);
});

test("テーマ: 全バリアントが全キーを正の有限数で持つ", () => {
  for (const v of FLIP_TIMING_THEME.variants) {
    assert.ok(typeof v.label === "string" && v.label.length > 0);
    for (const k of TIMING_KEYS) {
      assert.ok(Number.isFinite(v.timing[k]) && v.timing[k] > 0, `${v.id}.${k} が不正`);
    }
  }
});

test("テーマ: タイミング定義は凍結されており書き換えられない", () => {
  const v = FLIP_TIMING_THEME.variants[0];
  assert.ok(Object.isFrozen(FLIP_TIMING_THEME));
  assert.ok(Object.isFrozen(v.timing));
  assert.throws(() => { "use strict"; v.timing.liftMs = 9999; }, TypeError);
});

// ============ 仮説の向き（重み＞テンポ）と中間案 ============

test("仮説案: heavyは現状より浮き上がりが遅く（liftMs大）・保持が長い（holdMs大）", () => {
  const cur = FLIP_TIMING_THEME.variants.find((v) => v.id === "current").timing;
  const heavy = FLIP_TIMING_THEME.variants.find((v) => v.id === "heavy").timing;
  assert.ok(heavy.liftMs > cur.liftMs, "浮き上がりをもう少しだけ遅く");
  assert.ok(heavy.holdMs > cur.holdMs, "浮き上がり保持をもう少しだけ長く");
});

test("中間案: midの各タイミングは現状と仮説の間に収まる", () => {
  const cur = FLIP_TIMING_THEME.variants.find((v) => v.id === "current").timing;
  const mid = FLIP_TIMING_THEME.variants.find((v) => v.id === "mid").timing;
  const heavy = FLIP_TIMING_THEME.variants.find((v) => v.id === "heavy").timing;
  for (const k of TIMING_KEYS) {
    assert.ok(mid[k] >= cur[k] && mid[k] <= heavy[k], `mid.${k} が current..heavy の範囲外`);
  }
});

test("号砲所要（lift+hold+rot）はプリセット順で単調増加・隣接差100ms以上（実測判別可能）", () => {
  // CDP実測（rAFサンプリング≈±70ms）でプリセット間の違いを判別できるよう、
  // 隣り合う案の号砲所要には100ms以上のギャップを置く。
  const totals = FLIP_TIMING_THEME.variants.map((v) => leadFlipTotalMs(v.timing));
  for (let i = 1; i < totals.length; i++) {
    assert.ok(totals[i] - totals[i - 1] >= 100,
      `${FLIP_TIMING_THEME.variants[i].id} と前案の号砲所要差が100ms未満（${totals[i - 1]}→${totals[i]}）`);
  }
});

test("leadFlipTotalMs: lift+hold+rot の合計を返す", () => {
  assert.equal(leadFlipTotalMs({ liftMs: 100, holdMs: 50, rotMs: 300 }), 450);
});

// ============ validateFlipTiming（fail fast・定義時検証） ============

test("validateFlipTiming: 正常値は通す", () => {
  assert.doesNotThrow(() => validateFlipTiming(DEFAULT_FLIP_TIMING));
});

test("validateFlipTiming: キー欠落・非数・0以下・NaN・Infinity は弾く", () => {
  const ok = { ...DEFAULT_FLIP_TIMING };
  assert.throws(() => validateFlipTiming({ ...ok, liftMs: undefined }));
  assert.throws(() => validateFlipTiming({ ...ok, holdMs: "135" }));
  assert.throws(() => validateFlipTiming({ ...ok, rotMs: 0 }));
  assert.throws(() => validateFlipTiming({ ...ok, stepMs: -5 }));
  assert.throws(() => validateFlipTiming({ ...ok, followMs: NaN }));
  assert.throws(() => validateFlipTiming({ ...ok, preFlipMs: Infinity }));
  assert.throws(() => validateFlipTiming(null));
});

// ============ normalizeFlipTiming（境界の寛容な正規化・render3d入口用） ============

test("normalizeFlipTiming: null/undefined/非オブジェクトは既定値へ", () => {
  assert.deepEqual(normalizeFlipTiming(null), DEFAULT_FLIP_TIMING);
  assert.deepEqual(normalizeFlipTiming(undefined), DEFAULT_FLIP_TIMING);
  assert.deepEqual(normalizeFlipTiming("garbage"), DEFAULT_FLIP_TIMING);
});

test("normalizeFlipTiming: 部分指定は既定値とマージ、不正キーだけ既定値へ", () => {
  const t = normalizeFlipTiming({ liftMs: 230, holdMs: -1, rotMs: NaN, extra: 1 });
  assert.equal(t.liftMs, 230);                              // 有効値は採用
  assert.equal(t.holdMs, DEFAULT_FLIP_TIMING.holdMs);       // 負値→既定
  assert.equal(t.rotMs, DEFAULT_FLIP_TIMING.rotMs);         // NaN→既定
  assert.equal(t.stepMs, DEFAULT_FLIP_TIMING.stepMs);       // 未指定→既定
  assert.equal("extra" in t, false);                        // 余計なキーは持ち込まない
});

test("normalizeFlipTiming: 結果は凍結された新オブジェクトで、入力を変異しない", () => {
  const raw = { liftMs: 200 };
  const t = normalizeFlipTiming(raw);
  assert.ok(Object.isFrozen(t));
  assert.notEqual(t, raw);
  assert.deepEqual(raw, { liftMs: 200 }); // 入力不変
  assert.throws(() => { "use strict"; t.liftMs = 1; }, TypeError);
});
