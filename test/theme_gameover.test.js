import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry } from "../src/variants.js";
import {
  GAMEOVER_THEME, GAMEOVER_THEME_ID, registerGameoverTheme, gameoverSoundsFor,
} from "../src/theme_gameover.js";

// 終局系のイベントタグ（events.js が発火し audio.js の EVENT_SOUND が受ける3種）。
// 「勝ち／負け（引き分け）／完封の出し分け構造は全案で維持」の検証基準。
const GAMEOVER_TAGS = ["gameover", "gameover-draw", "shutout"];

const AUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "audio");

// ============ テーマ定義の構造 ============

test("テーマ定義: レジストリに登録できる（ID・defaultId・バリアントが妥当）", () => {
  const reg = createRegistry();
  registerGameoverTheme(reg); // 不正定義なら register が fail fast で投げる
  assert.equal(reg.get(GAMEOVER_THEME_ID).id, GAMEOVER_THEME.id);
});

test("テーマ定義: 現状案を含む2案以上あり、既定は現状案", () => {
  assert.ok(GAMEOVER_THEME.variants.length >= 2, "バリアントは2案以上（受け入れ基準）");
  assert.equal(GAMEOVER_THEME.defaultId, "classic", "既定案＝現状の終局音");
  assert.ok(GAMEOVER_THEME.variants.some((v) => v.id === "classic"));
});

test("出し分け構造: 全バリアントが終局3タグすべてを [バッファ名, ゲイン] で定義する", () => {
  for (const v of GAMEOVER_THEME.variants) {
    for (const tag of GAMEOVER_TAGS) {
      const e = v.sounds[tag];
      assert.ok(Array.isArray(e), `案 "${v.id}" にタグ "${tag}" の定義がない`);
      assert.equal(typeof e[0], "string", `案 "${v.id}" タグ "${tag}" のバッファ名が文字列でない`);
      assert.equal(typeof e[1], "number", `案 "${v.id}" タグ "${tag}" のゲインが数値でない`);
    }
    // 出し分け構造を増減させない（終局3タグ以外の鍵を持たない）
    assert.deepEqual(Object.keys(v.sounds).sort(), [...GAMEOVER_TAGS].sort());
  }
});

test("既定案: 現状の割り当て（fanfare_win/lose・ゲイン）そのまま", () => {
  const classic = GAMEOVER_THEME.variants.find((v) => v.id === "classic");
  // audio.js の EVENT_SOUND の現行値と一致させる（既定＝挙動不変の保証）
  assert.deepEqual(classic.sounds, {
    gameover: ["fanfare_win", 1.0],
    "gameover-draw": ["fanfare_lose", 0.7],
    shutout: ["fanfare_win", 1.0],
  });
});

// ============ 選択の解決（URL → 音割り当て） ============

test("gameoverSoundsFor: URL指定から該当バリアントの音割り当てを返す", () => {
  const reg = createRegistry();
  registerGameoverTheme(reg);
  for (const v of GAMEOVER_THEME.variants) {
    const sel = reg.resolve(`?variant=${GAMEOVER_THEME_ID}:${v.id}`);
    assert.deepEqual(gameoverSoundsFor(reg, sel), v.sounds, `案 "${v.id}" が解決されない`);
  }
});

test("gameoverSoundsFor: 指定なし・不正IDは既定（現状案）へフォールバック", () => {
  const reg = createRegistry();
  registerGameoverTheme(reg);
  const classic = GAMEOVER_THEME.variants.find((v) => v.id === "classic");
  assert.deepEqual(gameoverSoundsFor(reg, reg.resolve("")), classic.sounds);
  assert.deepEqual(gameoverSoundsFor(reg, reg.resolve(`?variant=${GAMEOVER_THEME_ID}:zzz`)), classic.sounds);
});

test("gameoverSoundsFor: テーマ未登録のレジストリでは null（適用側でno-op）", () => {
  const reg = createRegistry();
  assert.equal(gameoverSoundsFor(reg, reg.resolve("")), null);
});

// ============ DSP再現性（受け入れ基準：各案がDSP定義から再現生成できる） ============

test("全バリアントが参照するWAVが audio/ に生成済み（gen-audio.mjs の出力）", () => {
  for (const v of GAMEOVER_THEME.variants) {
    for (const tag of GAMEOVER_TAGS) {
      const name = v.sounds[tag][0];
      const file = join(AUDIO_DIR, `${name}.wav`);
      assert.ok(existsSync(file), `案 "${v.id}" タグ "${tag}" の音源 ${name}.wav が未生成`);
    }
  }
});
