import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../src/variants.js";
import { PLACE_SOUND_THEME, placeSfxKeyOf } from "../src/theme_place.js";

// ============ テーマ定義の検証（issue #6 受け入れ基準①の純ロジック部）============

test("placeSound: レジストリに登録できる（ID規約・defaultId検証に適合）", () => {
  const reg = createRegistry();
  reg.register(PLACE_SOUND_THEME); // 不正定義なら validateTheme が throw する
  assert.equal(reg.get("placeSound").label, "着石音");
  assert.deepEqual(reg.list().map((t) => t.id), ["placeSound"]);
});

test("placeSound: バリアントが3案以上あり、現行音（place.wav）の案を含む", () => {
  assert.ok(PLACE_SOUND_THEME.variants.length >= 3, "3案以上が受け入れ基準");
  assert.ok(
    PLACE_SOUND_THEME.variants.some((v) => v.sfxKey === "place"),
    "現状の place.wav も案の一つとして残す"
  );
});

test("placeSound: 既定は現行音＝選定までは本番の音を一切変えない", () => {
  const def = PLACE_SOUND_THEME.variants.find((v) => v.id === PLACE_SOUND_THEME.defaultId);
  assert.ok(def, "defaultId のバリアントが存在する");
  assert.equal(def.sfxKey, "place");
});

test("placeSound: 各バリアントは id/label/sfxKey を持ち、sfxKey は重複しない", () => {
  const keys = new Set();
  for (const v of PLACE_SOUND_THEME.variants) {
    assert.ok(typeof v.id === "string" && v.id.length > 0);
    assert.ok(typeof v.label === "string" && v.label.length > 0, `${v.id} にパネル表示用ラベルが必要`);
    assert.ok(typeof v.sfxKey === "string" && v.sfxKey.length > 0);
    assert.ok(!keys.has(v.sfxKey), `sfxKey "${v.sfxKey}" が重複`);
    keys.add(v.sfxKey);
  }
});

test("placeSound: 現行案以外の sfxKey は place_ 始まり（audio.js の追加WAV表と対応）", () => {
  for (const v of PLACE_SOUND_THEME.variants) {
    if (v.sfxKey === "place") continue;
    assert.match(v.sfxKey, /^place_/, `${v.id} の sfxKey "${v.sfxKey}"`);
  }
});

test("placeSound: テーマ定義は凍結されており外から書き換えられない", () => {
  assert.throws(() => { "use strict"; PLACE_SOUND_THEME.defaultId = "改竄"; }, TypeError);
  assert.throws(() => { "use strict"; PLACE_SOUND_THEME.variants.push({ id: "z" }); }, TypeError);
  assert.throws(() => { "use strict"; PLACE_SOUND_THEME.variants[0].sfxKey = "改竄"; }, TypeError);
});

// ============ placeSfxKeyOf（選択 → 再生キーの純関数）============

test("placeSfxKeyOf: 正規化済み選択からそのバリアントの sfxKey を返す", () => {
  const reg = createRegistry();
  reg.register(PLACE_SOUND_THEME);
  for (const v of PLACE_SOUND_THEME.variants) {
    const sel = reg.resolve(`?variant=placeSound:${v.id}`);
    assert.equal(placeSfxKeyOf(sel), v.sfxKey);
  }
});

test("placeSfxKeyOf: 未指定・null・不正IDは既定の現行音 place にフォールバック", () => {
  assert.equal(placeSfxKeyOf({}), "place");
  assert.equal(placeSfxKeyOf(null), "place");
  assert.equal(placeSfxKeyOf(undefined), "place");
  assert.equal(placeSfxKeyOf({ placeSound: "zzz" }), "place");
  assert.equal(placeSfxKeyOf({ other: "b" }), "place");
});
