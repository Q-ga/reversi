// 石マテリアルの比較ビルドテーマ（issue #9）。データ定義のみで three.js には依存しない
// （node:test で直接検証できる）。render3d.js の setStoneMaterialVariants が variants の
// physical 実装値を解釈して MeshPhysicalMaterial を組み立てる。
// physical を持たないバリアント（current）は現状マテリアルのまま＝既定では見た目を一切変えない。
//
// 設計制約（CONTEXT.md プリンシプル2「石・盤は高級感を優先・派手さを捨てる」）：
// 「黒石を黒く沈ませる」既存設計を壊さないため、どの案もベース色・顔テクスチャは現状を維持し、
// 薄い艶層（clearcoat）と絞った映り込み（envMapIntensity）だけを足す。
// 環境マップは同梱済みの RoomEnvironment から PMREM でプログラム生成する（新規バイナリアセット無し）。

// 黒石の制約値（CDP実測に基づく。検証は scripts/check-stone-materials.mjs）。
// これを超えると「艶で黒が浮く」失格ライン側に倒れる（過去に潰した問題の再発防止。
// テストで全黒バリアントがこの上限を守ることを担保する）。
// - envMapIntensity：環境マップ（render3d.js で天頂光を外す向きに傾けて生成）の映り込み強度。
//   傾けた環境でも 0.3 で黒石平均輝度 +2.4/255（傾け無しでは 0.02 ですら +20/255 だった）。
// - clearcoatRoughness：ほぼ真上の方向光のクリアコート鏡面ローブは 0.14 以上で上面全体に
//   かかり黒が浮く（実測 +11.6/255）。0.12 以下なら鏡面方向を外れて沈んだままになる。
export const BLACK_ENV_INTENSITY_MAX = 0.3;
export const BLACK_CLEARCOAT_ROUGHNESS_MAX = 0.12;

// 黒石テーマ：漆黒クリアコート系（ピアノブラック）。
// ベースは現状のマット黒（roughness 0.88・顔テクスチャ維持）のまま、clearcoat の薄い艶層で
// 「漆黒の中の艶」を出す。映り込み強度（envMapIntensity）は黒が浮かないよう絞る。
export const STONE_BLACK_THEME = Object.freeze({
  id: "stoneBlack",
  label: "石（黒）",
  defaultId: "current",
  variants: [
    // 現状：マット黒（テカリ消し）。physical 無し＝render3d.js の既存マテリアルを使う。
    { id: "current", label: "現状（マット）" },
    // ピアノブラック：最強のクリアコート＋鏡面級の艶層粗さ。静止時は沈んだ黒のまま
    // ごく薄い艶（実測：平均輝度 +2.4/255）、めくり90°付近で縁にハイライトが閃く
    // （実測：max +19/255）。
    {
      id: "piano",
      label: "漆黒ピアノ（艶鋭）",
      physical: { clearcoat: 1.0, clearcoatRoughness: 0.07, roughness: 0.88, envMapIntensity: 0.3 },
    },
    // 漆（うるし）：弱めのクリアコート＋粗さ上限ぎりぎりの艶層＝柔らかく曇った艶
    // （実測：黒石平均輝度 +4.5/255）。
    {
      id: "urushi",
      label: "漆黒うるし（艶柔）",
      physical: { clearcoat: 0.6, clearcoatRoughness: 0.12, roughness: 0.88, envMapIntensity: 0.2 },
    },
  ],
});

// 白石テーマ：パール／磁器系。白は「黒く沈ませる」制約の対象外なので、
// 映り込みは黒よりやや強めに許す（それでも上品さ優先で控えめ）。
export const STONE_WHITE_THEME = Object.freeze({
  id: "stoneWhite",
  label: "石（白）",
  defaultId: "current",
  variants: [
    // 現状：半マット白。physical 無し＝render3d.js の既存マテリアルを使う。
    { id: "current", label: "現状（半マット）" },
    // パール：薄い虹彩（iridescence）＝見る角度でわずかに色づく真珠層の表現。
    {
      id: "pearl",
      label: "パール（薄い虹彩）",
      physical: {
        clearcoat: 0.7, clearcoatRoughness: 0.28, roughness: 0.5, envMapIntensity: 0.5,
        iridescence: 0.4, iridescenceIOR: 1.3,
      },
    },
    // 磁器：釉薬の艶＝強めのクリアコートで陶磁器の上がかった光沢。
    {
      id: "porcelain",
      label: "磁器（釉薬の艶）",
      physical: { clearcoat: 0.9, clearcoatRoughness: 0.2, roughness: 0.42, envMapIntensity: 0.55 },
    },
  ],
});

// レジストリへ両テーマを登録する（main.js から1行で呼ぶ）。
export function registerStoneThemes(registry) {
  registry.register(STONE_BLACK_THEME);
  registry.register(STONE_WHITE_THEME);
}

// 正規化済みの選択（registry.resolve の戻り値）から、盤ビューへ渡す
// { black, white } のバリアント定義ペアを引く（main.js から1行で呼ぶ）。
export function resolveStoneVariants(registry, selection) {
  return {
    black: registry.variantOf(STONE_BLACK_THEME.id, selection),
    white: registry.variantOf(STONE_WHITE_THEME.id, selection),
  };
}
