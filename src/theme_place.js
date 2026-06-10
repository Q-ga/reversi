// 着石音（基音層）の比較ビルド用テーマ定義（issue #6）。
// 基音層＝石と盤の物体の音（質量・余韻。高級感を担う）——CONTEXT.md「基音層／上モノ層」。
// 「重い石が響く盤に落ちる」質量感を複数案生成し、?debug=1 パネルで実機切替して審査する。
// 選定までは既定（current＝現行 place.wav）で本番の音を一切変えない。選定後は #12 で焼き込む。
//
// このモジュールは純粋（DOM・Web Audio に依存しない）。配線は main.js が行う：
//   registry.register(PLACE_SOUND_THEME);
//   audio.setPlaceVariant(placeSfxKeyOf(variantSelection));
// sfxKey は audio.js の再生バッファ名（"place"＝現行、"place_*"＝追加WAV。生成は scripts/gen-audio.mjs）。

const freezeDeep = (theme) =>
  Object.freeze({ ...theme, variants: Object.freeze(theme.variants.map((v) => Object.freeze({ ...v }))) });

export const PLACE_SOUND_THEME = freezeDeep({
  id: "placeSound",
  label: "着石音",
  defaultId: "current",
  variants: [
    // 現行：高く澄んだアタック＋控えめ低音アクセント（コツ）
    { id: "current", label: "現行（コツ）", sfxKey: "place" },
    // 案B：質量極振り。柔らかいアタック＋沈む低音の「ドスッ」（重い石そのもの）
    { id: "mass", label: "案B 重打（ドスッ）", sfxKey: "place_b" },
    // 案C：硬質。石と漆盤の硬い打撃「カッ」（ドライ・残響最小）
    { id: "hard", label: "案C 硬質（カッ）", sfxKey: "place_c" },
    // 案D：響盤。盤の共鳴モード＋ホール残響の「コォン」（余韻で高級感）
    { id: "hall", label: "案D 響盤（コォン）", sfxKey: "place_d" },
  ],
});

// 正規化済み選択 { placeSound: バリアントID } から再生キーを取り出す（純粋）。
// 不正・未指定は既定案へフォールバック（registry.resolve 済みなら通らないが境界の二重ガード）。
export function placeSfxKeyOf(selection) {
  const id = selection && typeof selection === "object" ? selection[PLACE_SOUND_THEME.id] : undefined;
  const hit = PLACE_SOUND_THEME.variants.find((v) => v.id === id);
  if (hit) return hit.sfxKey;
  return PLACE_SOUND_THEME.variants.find((v) => v.id === PLACE_SOUND_THEME.defaultId).sfxKey;
}
