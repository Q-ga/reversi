// めくりタイミング・プリセット（比較ビルドのテーマ定義。issue #10）。
// CONTEXT.md プリンシプル1「テンポ vs 重み → 重みを優先」を受けた検収用の複数案：
// 主戦場の仮説「返る石の浮き上がりをもう少しだけ遅く」を、現状／中間／仮説／較正上限の
// 4案として同梱し、?variant=flipTiming:<案ID> やデバッグパネルで実機切替して審査する。
//
// このモジュールはタイミング数値（純データ）と検証だけを持つ。アニメの構造
// （逐次めくり・イージング・変動則）は render3d.js 側が保持し、プリセットは時間のみ差し替える。
// 着手の溜め（APPEAR/HOLD/DROP）は既存の看板なのでプリセットの対象外（render3d.js の定数のまま）。
//
// 各キーの意味（render3d.js の連鎖めくりに対応）：
//   liftMs    … めくりの溜め（号砲）：先頭石が回転せず水平に浮き上がる時間
//   holdMs    … めくりの溜め（号砲）：浮き上がり後、空中で静止する保持時間
//   rotMs     … 号砲の180°回転〜着地の時間
//   stepMs    … フォロワー（2枚目以降）の波状間隔
//   followMs  … フォロワー1枚の裏返し所要時間
//   preFlipMs … 号砲前遅延：着手の着地から号砲までの一拍（通常手）

export const TIMING_KEYS = Object.freeze([
  "liftMs", "holdMs", "rotMs", "stepMs", "followMs", "preFlipMs",
]);

// プリセットの定義時検証（fail fast・純粋）。全キーが正の有限数でなければ throw。
export function validateFlipTiming(t) {
  if (!t || typeof t !== "object") throw new Error("タイミング定義がオブジェクトではありません");
  for (const k of TIMING_KEYS) {
    if (!Number.isFinite(t[k]) || t[k] <= 0) {
      throw new Error(`タイミング定義 ${k} が不正です（正の有限数が必要）: ${t[k]}`);
    }
  }
  return t;
}

// 号砲（先頭石）の所要時間＝浮き上がり＋保持＋回転（純粋）。
// プリセット間の判別しやすさ（テスト・CDP実測の期待値）に使う。
export function leadFlipTotalMs(t) {
  return t.liftMs + t.holdMs + t.rotMs;
}

// 検証済みプリセットを凍結して返す（定義専用ヘルパー）。
const preset = (t) => Object.freeze(validateFlipTiming({ ...t }));

// 既定案＝現状。render3d.js の現行値（LIFT_MS 150 / HOLD 135 / ROT_MS 360 /
// stepMs 95 / フォロワー520 / PRE_FLIP_MS 190）をそのまま数値で固定する。
export const DEFAULT_FLIP_TIMING = preset({
  liftMs: 150, holdMs: 135, rotMs: 360, stepMs: 95, followMs: 520, preFlipMs: 190,
});

// テーマ定義。号砲所要（lift+hold+rot）は 645 → 765 → 890 → 1080ms と
// 隣接差100ms以上の単調増加にし、実機・CDP実測で案の違いを判別できるようにする。
export const FLIP_TIMING_THEME = Object.freeze({
  id: "flipTiming",
  label: "めくりタイミング",
  defaultId: "current",
  variants: Object.freeze([
    Object.freeze({ id: "current", label: "現状（既定）", timing: DEFAULT_FLIP_TIMING }),
    Object.freeze({
      id: "mid", label: "中間（やや重め）",
      timing: preset({ liftMs: 190, holdMs: 185, rotMs: 390, stepMs: 110, followMs: 540, preFlipMs: 215 }),
    }),
    Object.freeze({
      id: "heavy", label: "重み増し（浮き遅め・保持長め）",
      timing: preset({ liftMs: 230, holdMs: 240, rotMs: 420, stepMs: 125, followMs: 560, preFlipMs: 240 }),
    }),
    Object.freeze({
      id: "max", label: "重み最大（較正用）",
      timing: preset({ liftMs: 280, holdMs: 330, rotMs: 470, stepMs: 145, followMs: 590, preFlipMs: 280 }),
    }),
  ]),
});

// 境界の寛容な正規化（render3d.js の入口用・純粋）。
// 非オブジェクトは既定値へ、キー単位で不正値（非数・0以下）は既定値へフォールバックし、
// 余計なキーは持ち込まない。結果は凍結した新オブジェクトで、入力は変異しない。
export function normalizeFlipTiming(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const k of TIMING_KEYS) {
    out[k] = Number.isFinite(r[k]) && r[k] > 0 ? r[k] : DEFAULT_FLIP_TIMING[k];
  }
  return Object.freeze(out);
}
