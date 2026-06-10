// 酔い対策：OSの「視差効果を減らす」設定（prefers-reduced-motion: reduce）による演出抑制。
// 本人のエフェクト演出トグル（effectsOn）とは独立した軸として扱い、設定値そのものは書き換えない。

// 検知に使うメディアクエリ（検証スクリプトとも共有する定数）
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// エフェクト演出トグルとOSのreduced-motionから、演出系統ごとの可否を判定する（純粋）。
// - spotEffects : スポット演出（光・決め演出）。本人のトグルのみに従い、OS設定では消さない。
// - strongMotion: 動きの強い演出（スクリーンシェイク・置石ジッタ）。トグルOFFまたはreduce指定で抑制。
// 入力は信頼しない：effectsOn非boolean→演出なし（安全側）、reducedMotion非boolean→抑制しない（従来どおり）。
export function motionPolicy({ effectsOn, reducedMotion } = {}) {
  const spot = effectsOn === true;
  return Object.freeze({
    spotEffects: spot,
    strongMotion: spot && reducedMotion !== true,
  });
}

// matchMedia 境界アダプタ：reduced-motion の現在値を返し、以後の変更を onChange へ通知する。
// matchMedia 非対応・例外環境では false（抑制しない＝従来どおり）でアプリを止めない。
export function watchReducedMotion(onChange, win = globalThis) {
  try {
    const mql = win.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!mql) return false;
    mql.addEventListener?.("change", (e) => onChange(e.matches === true));
    return mql.matches === true;
  } catch {
    return false;
  }
}
