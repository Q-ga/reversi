import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY, BLACK, WHITE } from "../src/rules.js";
import { bgmState, ENDGAME_EMPTIES, ONESIDE_MARGIN } from "../src/bgm.js";

// 指定した空き数・黒白枚数の盤を作る（順序は問わない）
function boardOf(black, white) {
  const cells = [];
  for (let i = 0; i < black; i++) cells.push(BLACK);
  for (let i = 0; i < white; i++) cells.push(WHITE);
  while (cells.length < 64) cells.push(EMPTY);
  const b = [];
  for (let r = 0; r < 8; r++) b.push(cells.slice(r * 8, r * 8 + 8));
  return b;
}

test("序盤〜中盤は normal（終盤しきい値より空きが多い）", () => {
  // 初期相当：黒2白2 → 空き60
  assert.equal(bgmState(boardOf(2, 2)), "normal");
  // 空きがしきい値+1なら normal
  const filled = 64 - (ENDGAME_EMPTIES + 1);
  assert.equal(bgmState(boardOf(Math.ceil(filled / 2), Math.floor(filled / 2))), "normal");
});

test("終盤かつ接戦は endgame_close", () => {
  // 空き10、石差小（27 vs 27）
  assert.equal(bgmState(boardOf(27, 27)), "endgame_close");
});

test("終盤かつ大差は endgame_oneside", () => {
  // 空き10、石差大（44 vs 10 → 差34 >= ONESIDE_MARGIN）
  const b = boardOf(44, 10);
  assert.ok(Math.abs(44 - 10) >= ONESIDE_MARGIN);
  assert.equal(bgmState(b), "endgame_oneside");
});

test("接戦/大差の境界（ONESIDE_MARGIN）で切り替わる", () => {
  // 終盤(空き<=ENDGAME_EMPTIES)を保ちつつ差を境界前後で確認
  const total = 64 - 8; // 空き8で終盤
  const justBelow = ONESIDE_MARGIN - 1;
  const aBelow = (total + justBelow) / 2, bBelow = (total - justBelow) / 2;
  assert.equal(bgmState(boardOf(aBelow, bBelow)), "endgame_close");
  const aAt = (total + ONESIDE_MARGIN) / 2, bAt = (total - ONESIDE_MARGIN) / 2;
  assert.equal(bgmState(boardOf(aAt, bAt)), "endgame_oneside");
});
