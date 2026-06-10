import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRegistry, parseVariantParam, readVariantParams,
  normalizeSelection, buildVariantParam, isDebugMode,
} from "../src/variants.js";

// テスト用のテーマ定義（比較ビルドのダミー2テーマ）
const THEME_DEMO = Object.freeze({
  id: "demo", label: "ダミー", defaultId: "a",
  variants: [{ id: "a", label: "案A" }, { id: "b", label: "案B" }],
});
const THEME_SND = Object.freeze({
  id: "snd", label: "着石音", defaultId: "x",
  variants: [{ id: "x", label: "案X" }, { id: "y", label: "案Y" }],
});

// ============ parseVariantParam ============

test("parseVariantParam: 単一指定 theme:id を分解する", () => {
  assert.deepEqual(parseVariantParam("demo:b"), { demo: "b" });
});

test("parseVariantParam: カンマ区切りの複数指定を分解する", () => {
  assert.deepEqual(parseVariantParam("demo:b,snd:y"), { demo: "b", snd: "y" });
});

test("parseVariantParam: 空・null・undefinedは空オブジェクト", () => {
  assert.deepEqual(parseVariantParam(""), {});
  assert.deepEqual(parseVariantParam(null), {});
  assert.deepEqual(parseVariantParam(undefined), {});
});

test("parseVariantParam: 不正な断片（コロン無し・キー空・値空）は読み飛ばす", () => {
  assert.deepEqual(parseVariantParam("nocolon,:b,demo:,demo:b"), { demo: "b" });
});

test("parseVariantParam: 前後の空白はトリムする", () => {
  assert.deepEqual(parseVariantParam(" demo : b , snd : y "), { demo: "b", snd: "y" });
});

test("parseVariantParam: 同じテーマの重複指定は後勝ち", () => {
  assert.deepEqual(parseVariantParam("demo:a,demo:b"), { demo: "b" });
});

// ============ readVariantParams ============

test("readVariantParams: location.search から variant 指定を読む", () => {
  assert.deepEqual(readVariantParams("?variant=demo:b&debug=1"), { demo: "b" });
});

test("readVariantParams: variant パラメータの複数指定はマージ（後勝ち）", () => {
  assert.deepEqual(readVariantParams("?variant=demo:b&variant=snd:y"), { demo: "b", snd: "y" });
  assert.deepEqual(readVariantParams("?variant=demo:a&variant=demo:b"), { demo: "b" });
});

test("readVariantParams: variant 無し・空文字列は空オブジェクト", () => {
  assert.deepEqual(readVariantParams("?debug=1"), {});
  assert.deepEqual(readVariantParams(""), {});
});

// ============ normalizeSelection ============

test("normalizeSelection: 指定なしのテーマは既定値で補い、全テーマぶん返す", () => {
  const sel = normalizeSelection([THEME_DEMO, THEME_SND], { demo: "b" });
  assert.deepEqual(sel, { demo: "b", snd: "x" });
});

test("normalizeSelection: 不正なバリアントIDは既定値へフォールバック", () => {
  const sel = normalizeSelection([THEME_DEMO, THEME_SND], { demo: "zzz", snd: "y" });
  assert.deepEqual(sel, { demo: "a", snd: "y" });
});

test("normalizeSelection: 未登録テーマの指定は無視する", () => {
  const sel = normalizeSelection([THEME_DEMO], { demo: "b", unknown: "v1" });
  assert.deepEqual(sel, { demo: "b" });
});

test("normalizeSelection: rawが非オブジェクトでも全テーマ既定値で返す", () => {
  assert.deepEqual(normalizeSelection([THEME_DEMO, THEME_SND], null), { demo: "a", snd: "x" });
  assert.deepEqual(normalizeSelection([THEME_DEMO, THEME_SND], "garbage"), { demo: "a", snd: "x" });
});

// ============ buildVariantParam ============

test("buildVariantParam: 全テーマ既定値なら空文字列（URLを汚さない）", () => {
  assert.equal(buildVariantParam([THEME_DEMO, THEME_SND], { demo: "a", snd: "x" }), "");
});

test("buildVariantParam: 既定値以外のテーマだけを theme:id で列挙する", () => {
  assert.equal(buildVariantParam([THEME_DEMO, THEME_SND], { demo: "b", snd: "x" }), "demo:b");
  assert.equal(buildVariantParam([THEME_DEMO, THEME_SND], { demo: "b", snd: "y" }), "demo:b,snd:y");
});

test("buildVariantParam: 未登録テーマのキーは捨てる", () => {
  assert.equal(buildVariantParam([THEME_DEMO], { demo: "b", unknown: "v1" }), "demo:b");
});

// ============ isDebugMode ============

test("isDebugMode: ?debug=1 のときだけ true", () => {
  assert.equal(isDebugMode("?debug=1"), true);
  assert.equal(isDebugMode("?variant=demo:b&debug=1"), true);
  assert.equal(isDebugMode(""), false);
  assert.equal(isDebugMode("?debug=0"), false);
  assert.equal(isDebugMode("?debugg=1"), false);
});

// ============ createRegistry ============

test("registry: 登録したテーマを登録順に list/get できる", () => {
  const reg = createRegistry();
  reg.register(THEME_DEMO);
  reg.register(THEME_SND);
  assert.deepEqual(reg.list().map((t) => t.id), ["demo", "snd"]);
  assert.equal(reg.get("demo").label, "ダミー");
  assert.equal(reg.get("nothere"), undefined);
});

test("registry: defaultId がバリアントに無いテーマは登録できない", () => {
  const reg = createRegistry();
  assert.throws(() => reg.register({ ...THEME_DEMO, defaultId: "zzz" }), /defaultId/);
});

test("registry: テーマIDの重複登録はエラー", () => {
  const reg = createRegistry();
  reg.register(THEME_DEMO);
  assert.throws(() => reg.register(THEME_DEMO), /重複/);
});

test("registry: URL区切り文字（: , ）を含むIDは登録できない", () => {
  const reg = createRegistry();
  assert.throws(() => reg.register({ ...THEME_DEMO, id: "de:mo" }));
  assert.throws(() => reg.register({
    ...THEME_DEMO, variants: [{ id: "a,1", label: "案A" }], defaultId: "a,1",
  }));
});

test("registry: バリアント空・ID重複のテーマは登録できない", () => {
  const reg = createRegistry();
  assert.throws(() => reg.register({ ...THEME_DEMO, variants: [] }));
  assert.throws(() => reg.register({
    ...THEME_DEMO,
    variants: [{ id: "a", label: "案A" }, { id: "a", label: "案A'" }],
  }));
});

test("registry: resolve は search から全テーマぶんの正規化済み選択を返す", () => {
  const reg = createRegistry();
  reg.register(THEME_DEMO);
  reg.register(THEME_SND);
  assert.deepEqual(reg.resolve("?variant=demo:b"), { demo: "b", snd: "x" });
  assert.deepEqual(reg.resolve("?variant=demo:zzz"), { demo: "a", snd: "x" }); // 不正ID→既定
  assert.deepEqual(reg.resolve(""), { demo: "a", snd: "x" });
});

test("registry: variantOf は選択中のバリアント定義を返す", () => {
  const reg = createRegistry();
  reg.register(THEME_DEMO);
  const sel = reg.resolve("?variant=demo:b");
  assert.equal(reg.variantOf("demo", sel).label, "案B");
  assert.equal(reg.variantOf("nothere", sel), undefined);
});

test("registry: 登録済みテーマは凍結されており外から書き換えられない", () => {
  const reg = createRegistry();
  reg.register({ ...THEME_DEMO });
  const t = reg.get("demo");
  assert.throws(() => { "use strict"; t.label = "改竄"; }, TypeError);
  assert.throws(() => { "use strict"; t.variants.push({ id: "z", label: "不正" }); }, TypeError);
});
