// めくり音テーマ（issue #7）：比較ビルド（variants.js）へ登録する2テーマの定義と純ロジック。
//   ・基音層（flipBase）＝めくり1枚ごとの「コツ」音の質感バリアント（木/石/硝子）。
//   ・上モノ層（flipTop）＝連鎖エスカレーションの演出音レイヤー（なし/キラリ積み上げ/階段ハープ）。
// CONTEXT.md「基音層/上モノ層」：基音層＝石と盤の物体の音（高級感）、上モノ層＝演出の音（派手さ）。
//
// 不変条件（issue #7 受け入れ基準）：
//   ・めくり1枚ごとの発音とピッチ上昇は全案で維持する（flipBaseRate＝既存 playFlipLand と同一の式）。
//   ・変動則：上モノの演出強度は手の価値（総返し枚数 total）に比例。小さな手は強度の天井が低く、
//     最大演出には届かない（「全手最大演出」の禁止）。大量返し（BIG_FLIP_THRESHOLD以上）でだけ燃える。
//
// このモジュールは純ロジック（プラン計算・テーマ定義）のみを持ち、Web Audio には触れない。
// 実再生は audio.js（依存注入で playSfx 等を受け取る）。main.js は registerFlipThemes と
// applyFlipVariants を呼ぶだけでよい。

import { BIG_FLIP_THRESHOLD } from "./events.js";

// ============ 基音層 ============

// ピッチ上昇則。audio.js の既存 playFlipLand（rate = 1 + min(i,14)*0.045）と同一でなければならない。
// この式を変えると「現行案＝既定」が現行と一致しなくなるので、変更時は両者を同時に直すこと。
export function flipBaseRate(i = 0) {
  return 1 + Math.min(i, 14) * 0.045;
}

// 基音層テーマ：sfx＝audio.js のバッファ名（scripts/gen-audio.mjs で生成）、gain＝再生音量。
// 既定 wood は現行の flip_land.wav / gain 0.9 と完全に同じ＝バリアント未指定時の挙動を変えない。
export const FLIP_BASE_THEME = Object.freeze({
  id: "flipBase",
  label: "めくり基音",
  defaultId: "wood",
  variants: [
    { id: "wood",  label: "木（現行）",   sfx: "flip_land",       gain: 0.9 },
    { id: "stone", label: "石（硬質）",   sfx: "flip_land_stone", gain: 0.85 },
    { id: "glass", label: "硝子（澄音）", sfx: "flip_land_glass", gain: 0.7 },
  ],
});

// ============ 上モノ層 ============

// 変動則：上モノ層の強度の天井。総返し枚数 total が大きいほど高い天井（＝大量返しほど派手）。
// 小さな手（total=1〜2）は天井が低く、どれだけ連鎖しても最大演出には届かない。
export function topCap(total = 0) {
  const t = Math.min(Math.max(0, total), 10);
  return 0.4 + 0.06 * t; // total=1→0.46 … total>=10→1.0（満額）
}

// Balatro式「キラリ積み上げ」：1枚ごとにキラリ（spark）が鳴り、全音ずつピッチが駆け上がり
// 明るさ（gain）も積み上がる。大量返し（bigFlip閾値）では i>=2 から燃焼レイヤー（flame）が
// 重なって「燃える」。閾値は events.js の bigFlip 演出と同一＝演出群の一貫性を保つ。
export function sparkPlan(i = 0, total = 0) {
  const idx = Math.min(Math.max(0, i), 14);          // 基音層と同じ14枚で頭打ち
  const rate = Math.pow(2, (idx * 2) / 12);          // 1枚ごとに全音（2半音）上昇
  const grow = 0.45 + 0.55 * (idx / 14);             // 積み上がるほど明るく・強く
  const gain = 0.5 * grow * topCap(total);
  const hot = total >= BIG_FLIP_THRESHOLD && i >= 2; // 大量返しの3枚目から燃える
  return {
    rate,
    gain,
    hot,
    hotRate: 0.9 + idx * 0.05,                       // 燃えも連鎖でわずかに上ずる
    hotGain: hot ? 0.3 * (0.5 + 0.5 * (idx / 14)) * topCap(total) : 0,
  };
}

// 階段ハープ：1枚ごとに弦の爪弾きがメジャーペンタトニックを1段ずつ駆け上がる。
// 半音オフセット表（C基準：C D E G A を約3オクターブ）。表の終端で頭打ち。
const PENTA = Object.freeze([0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33]);
export function harpPlan(i = 0, total = 0) {
  const idx = Math.min(Math.max(0, i), PENTA.length - 1);
  const rate = Math.pow(2, PENTA[idx] / 12);
  const gain = 0.42 * (0.55 + 0.45 * (idx / (PENTA.length - 1))) * topCap(total);
  return { rate, gain };
}

// 上モノ層テーマ：既定 none は「鳴らさない」＝現行挙動そのもの。
export const FLIP_TOP_THEME = Object.freeze({
  id: "flipTop",
  label: "めくり上モノ",
  defaultId: "none",
  variants: [
    { id: "none",    label: "なし（現行）" },
    { id: "balatro", label: "キラリ積み上げ" },
    { id: "harp",    label: "階段ハープ" },
  ],
});

// バリアントIDから上モノ層プレイヤー（(i, total) => void）を作る。none・未知IDは null（＝鳴らさない）。
// playSfx は audio.js の汎用再生口（依存注入なのでテストではレコーダーに差し替えられる）。
export function createTopPlayer(variantId, playSfx) {
  if (variantId === "balatro") {
    return (i, total) => {
      const p = sparkPlan(i, total);
      playSfx("flip_top_spark", { rate: p.rate, gain: p.gain });
      if (p.hot) playSfx("flip_top_flame", { rate: p.hotRate, gain: p.hotGain });
    };
  }
  if (variantId === "harp") {
    return (i, total) => {
      const p = harpPlan(i, total);
      playSfx("flip_top_harp", { rate: p.rate, gain: p.gain });
    };
  }
  return null;
}

// ============ 登録・適用（main.js から呼ぶ2口） ============

// 比較ビルドのレジストリへ2テーマを登録する（基音層・上モノ層は独立に切替できる）。
export function registerFlipThemes(registry) {
  registry.register(FLIP_BASE_THEME);
  registry.register(FLIP_TOP_THEME);
}

// 解決済みの選択（registry.resolve の結果）を audio へ適用する。
// audioLike: { setFlipBase, setFlipTop, playSfx }＝main.js からは audio モジュール名前空間をそのまま渡す。
// 選択が不正でも既定（＝現行挙動）へフォールバックし、例外で対局を止めない。
export function applyFlipVariants(selection, audioLike) {
  const sel = selection && typeof selection === "object" ? selection : {};
  const base =
    FLIP_BASE_THEME.variants.find((v) => v.id === sel[FLIP_BASE_THEME.id]) ??
    FLIP_BASE_THEME.variants.find((v) => v.id === FLIP_BASE_THEME.defaultId);
  audioLike.setFlipBase(base.sfx, base.gain);
  audioLike.setFlipTop(createTopPlayer(sel[FLIP_TOP_THEME.id], audioLike.playSfx));
}
