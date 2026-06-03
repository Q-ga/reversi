import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY, BLACK, WHITE } from "../src/rules.js";
import { bgmState, ENDGAME_EMPTIES } from "../src/bgm.js";

// 指定した黒白枚数の盤を作る（残りは空き）
function boardOf(black, white) {
  const cells = [];
  for (let i = 0; i < black; i++) cells.push(BLACK);
  for (let i = 0; i < white; i++) cells.push(WHITE);
  while (cells.length < 64) cells.push(EMPTY);
  const b = [];
  for (let r = 0; r < 8; r++) b.push(cells.slice(r * 8, r * 8 + 8));
  return b;
}

test("序盤〜中盤は normal（空きが終盤しきい値より多い）", () => {
  assert.equal(bgmState(boardOf(2, 2)), "normal"); // 初期相当（空き60）
  const filled = 64 - (ENDGAME_EMPTIES + 1);        // 空き=しきい値+1
  assert.equal(bgmState(boardOf(Math.ceil(filled / 2), Math.floor(filled / 2))), "normal");
});

test("終盤は endgame（空きがしきい値以下）", () => {
  const filled = 64 - ENDGAME_EMPTIES;              // 空き=しきい値ちょうど
  assert.equal(bgmState(boardOf(filled / 2, filled / 2)), "endgame");
  assert.equal(bgmState(boardOf(50, 8)), "endgame"); // 空き6でも終盤（点差は無関係）
});
