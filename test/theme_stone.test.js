import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../src/variants.js";
import {
  STONE_BLACK_THEME, STONE_WHITE_THEME,
  BLACK_ENV_INTENSITY_MAX, BLACK_CLEARCOAT_ROUGHNESS_MAX,
  registerStoneThemes, resolveStoneVariants,
} from "../src/theme_stone.js";

// テスト用：両テーマを登録済みのレジストリを作る
function makeRegistry() {
  const reg = createRegistry();
  registerStoneThemes(reg);
  return reg;
}

// ============ 登録と既定値 ============

test("registerStoneThemes: 黒・白の2テーマがレジストリに登録される", () => {
  const reg = makeRegistry();
  assert.equal(reg.get("stoneBlack")?.label, "石（黒）");
  assert.equal(reg.get("stoneWhite")?.label, "石（白）");
});

test("受け入れ基準: 黒・白とも各2案以上＋現状（=3案以上）を持つ", () => {
  assert.ok(STONE_BLACK_THEME.variants.length >= 3, "黒は現状＋2案以上");
  assert.ok(STONE_WHITE_THEME.variants.length >= 3, "白は現状＋2案以上");
});

test("既定は current（現状案）＝指定なしでは見た目を変えない", () => {
  const reg = makeRegistry();
  const sel = reg.resolve("");
  assert.equal(sel.stoneBlack, "current");
  assert.equal(sel.stoneWhite, "current");
  // current バリアントは physical を持たない＝render3d.js の既存マテリアルがそのまま使われる
  const { black, white } = resolveStoneVariants(reg, sel);
  assert.equal(black.physical, undefined);
  assert.equal(white.physical, undefined);
});

// ============ URL指定の解決 ============

test("URL指定: ?variant=stoneBlack:piano,stoneWhite:pearl が解決される", () => {
  const reg = makeRegistry();
  const sel = reg.resolve("?variant=stoneBlack:piano,stoneWhite:pearl");
  const { black, white } = resolveStoneVariants(reg, sel);
  assert.equal(black.id, "piano");
  assert.equal(white.id, "pearl");
  assert.ok(black.physical.clearcoat > 0);
  assert.ok(white.physical.iridescence > 0, "パール案は薄い虹彩を持つ");
});

test("URL指定: 不正なバリアントIDは current へフォールバック", () => {
  const reg = makeRegistry();
  const sel = reg.resolve("?variant=stoneBlack:zzz,stoneWhite:");
  assert.equal(sel.stoneBlack, "current");
  assert.equal(sel.stoneWhite, "current");
});

// ============ 制約：黒石を黒く沈ませる設計を壊さない ============

test("制約: 黒の全バリアントは映り込み強度が上限以下（艶で黒を浮かせない）", () => {
  for (const v of STONE_BLACK_THEME.variants) {
    if (!v.physical) continue;
    assert.ok(
      v.physical.envMapIntensity <= BLACK_ENV_INTENSITY_MAX,
      `${v.id} の envMapIntensity ${v.physical.envMapIntensity} が上限 ${BLACK_ENV_INTENSITY_MAX} を超えている`
    );
  }
});

test("制約: 黒の艶層粗さは上限以下（真上方向光の鏡面ローブを上面に乗せない）", () => {
  for (const v of STONE_BLACK_THEME.variants) {
    if (!v.physical) continue;
    assert.ok(
      v.physical.clearcoatRoughness <= BLACK_CLEARCOAT_ROUGHNESS_MAX,
      `${v.id} の clearcoatRoughness ${v.physical.clearcoatRoughness} が上限 ${BLACK_CLEARCOAT_ROUGHNESS_MAX} を超えている`
    );
  }
});

test("制約: 黒の全バリアントはベース色・テクスチャ・発光を上書きしない", () => {
  for (const v of STONE_BLACK_THEME.variants) {
    if (!v.physical) continue;
    for (const banned of ["color", "map", "emissive", "emissiveIntensity"]) {
      assert.equal(v.physical[banned], undefined, `${v.id} が ${banned} を上書きしている`);
    }
    // ベースのマット感も維持（艶は clearcoat 層だけで出す）
    assert.ok(v.physical.roughness >= 0.85, `${v.id} のベース roughness が下がっている`);
  }
});

test("クリアコート案: clearcoat は 0.6〜1.0 の薄い艶層", () => {
  for (const theme of [STONE_BLACK_THEME, STONE_WHITE_THEME]) {
    for (const v of theme.variants) {
      if (!v.physical) continue;
      assert.ok(
        v.physical.clearcoat >= 0.6 && v.physical.clearcoat <= 1.0,
        `${theme.id}:${v.id} の clearcoat ${v.physical.clearcoat} が範囲外`
      );
    }
  }
});

// ============ レジストリとの整合（ID形式・既定ID実在は register が検証する） ============

test("テーマ定義は registry.register のバリデーションを通る（fail fastの担保）", () => {
  // makeRegistry が throw しないこと自体が検証。さらに二重登録は弾かれる。
  const reg = makeRegistry();
  assert.throws(() => registerStoneThemes(reg), /重複/);
});
