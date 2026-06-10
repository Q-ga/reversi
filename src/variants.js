// 比較ビルド（CONTEXT.md「開発・検収」）のバリアントレジストリ。
// クラフト（音色・質感・タイミング等）の検収のため、テーマ（着石音／めくり音／終局音／
// 石マテリアル／めくりタイミング）ごとに複数案（バリアント）を登録し、
// URLパラメータ ?variant=テーマ:案ID（カンマ区切りで複数可）で実機切替する。
// URLという信頼できない境界からの入力は normalizeSelection で必ず既定値へ正規化してから使う。
//
// 後続のクラフト・パス（テーマ追加）の使い方：
//   registry.register({ id, label, defaultId, variants: [{ id, label, ...任意の実装値 }] });
//   const sel = registry.resolve(location.search);
//   const v = registry.variantOf("placeSound", sel); // → 選択中バリアント定義（実装値ごと）

// ":" と "," はURLパラメータの区切りに使うため、テーマ/バリアントIDには使えない。
const ID_OK = (s) => typeof s === "string" && s.length > 0 && !/[:,\s]/.test(s);

// "テーマ:案ID,テーマ:案ID" 形式の文字列を { テーマ: 案ID } に分解する（純粋）。
// 不正な断片（コロン無し・キー空・値空）は読み飛ばす。同じテーマの重複は後勝ち。
export function parseVariantParam(value) {
  if (typeof value !== "string" || !value) return {};
  const out = {};
  for (const part of value.split(",")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const theme = part.slice(0, i).trim();
    const variant = part.slice(i + 1).trim();
    if (!theme || !variant) continue;
    out[theme] = variant;
  }
  return out;
}

// location.search からすべての variant 指定を読み取りマージする（純粋・後勝ち）。
export function readVariantParams(search) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  let out = {};
  for (const value of params.getAll("variant")) {
    out = { ...out, ...parseVariantParam(value) };
  }
  return out;
}

// 生の指定をテーマ定義一覧に照らして正規化する（純粋）。
// 全テーマぶんの完全な選択を返す：未登録テーマの指定は無視し、
// 不正なバリアントIDや指定なしは既定値（defaultId）へフォールバックする。
export function normalizeSelection(themes, raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const theme of themes) {
    const wanted = r[theme.id];
    out[theme.id] = theme.variants.some((v) => v.id === wanted) ? wanted : theme.defaultId;
  }
  return out;
}

// 選択から URL パラメータ値を組み立てる（純粋）。既定値のテーマは省略してURLを汚さない。
// 全テーマ既定値なら空文字列（＝variantパラメータ自体を付けない）。
export function buildVariantParam(themes, selection) {
  return themes
    .filter((t) => selection[t.id] !== undefined && selection[t.id] !== t.defaultId)
    .map((t) => `${t.id}:${selection[t.id]}`)
    .join(",");
}

// ?debug=1 のときだけデバッグUI（切替パネル）を出す判定（純粋）。
export function isDebugMode(search) {
  return new URLSearchParams(typeof search === "string" ? search : "").get("debug") === "1";
}

// テーマ定義の検証。不正な定義は登録時に即エラーにする（fail fast）。
function validateTheme(theme, existing) {
  if (!theme || typeof theme !== "object") throw new Error("テーマ定義がオブジェクトではありません");
  if (!ID_OK(theme.id)) throw new Error(`テーマID "${theme.id}" が不正です（空・空白・":"・"," は不可）`);
  if (existing.has(theme.id)) throw new Error(`テーマID "${theme.id}" は重複しています`);
  if (!Array.isArray(theme.variants) || theme.variants.length === 0) {
    throw new Error(`テーマ "${theme.id}" にバリアントがありません`);
  }
  const ids = new Set();
  for (const v of theme.variants) {
    if (!ID_OK(v?.id)) throw new Error(`テーマ "${theme.id}" のバリアントID "${v?.id}" が不正です`);
    if (ids.has(v.id)) throw new Error(`テーマ "${theme.id}" のバリアントID "${v.id}" が重複しています`);
    ids.add(v.id);
  }
  if (!ids.has(theme.defaultId)) {
    throw new Error(`テーマ "${theme.id}" の defaultId "${theme.defaultId}" がバリアントに存在しません`);
  }
}

// バリアントレジストリを作る。テーマは登録順を保持し、登録後は凍結（不変）。
// メソッドはすべてクロージャ参照（this不使用）なので、分割代入して渡しても安全。
export function createRegistry() {
  const themes = new Map();

  // テーマを1件登録する。定義: { id, label, defaultId, variants: [{ id, label, ... }] }
  const register = (theme) => {
    validateTheme(theme, themes);
    const frozen = Object.freeze({
      ...theme,
      variants: Object.freeze(theme.variants.map((v) => Object.freeze({ ...v }))),
    });
    themes.set(frozen.id, frozen);
  };
  // 登録順のテーマ一覧（コピーを返すので外から壊せない）
  const list = () => [...themes.values()];
  const get = (id) => themes.get(id);
  // location.search → 全テーマぶんの正規化済み選択 { テーマID: バリアントID }
  const resolve = (search) => normalizeSelection(list(), readVariantParams(search));
  // 選択中のバリアント定義（実装値ごと）を返す。未登録テーマは undefined。
  const variantOf = (themeId, selection) =>
    themes.get(themeId)?.variants.find((v) => v.id === selection[themeId]);

  return { register, list, get, resolve, variantOf };
}

// アプリ全体で共有する既定レジストリ（main.js・各テーマモジュールが使う）
export const registry = createRegistry();
