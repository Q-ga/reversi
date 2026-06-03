import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE, EMPTY, createBoard, flips } from "../src/rules.js";
import { evaluate, chooseCpuMove } from "../src/evaluate.js";

test("evaluate は反対称（両者の評価の和は0）", () => {
  const b = createBoard();
  b[0][0] = BLACK; // 非対称にして0以外の値で確認
  assert.equal(evaluate(b, BLACK) + evaluate(b, WHITE), 0);
});

test("evaluate は角を持つ側を高く評価する", () => {
  const b = createBoard();
  b[0][0] = BLACK; // 黒が角を確保
  assert.ok(evaluate(b, BLACK) > 0, "角を持つ黒が有利");
  assert.ok(evaluate(b, WHITE) < 0);
});

test("chooseCpuMove はどのレベルでも合法手を返す", () => {
  const b = createBoard();
  for (const level of [1, 2, 3]) {
    const [r, c] = chooseCpuMove(b, BLACK, level);
    assert.ok(flips(b, r, c, BLACK).length > 0, `level${level}は合法手`);
  }
});

test("つよい(level3)は取れる角を選ぶ", () => {
  // 角[0][0]を黒が取れる局面を作る: [0][1]白, [0][2]黒 → 黒[0][0]は不可。
  // 角を取る = [0][0]に置いて[0][1]を返す筋を用意: [0][1]白,[0][2]黒で黒は[0][0]に置けない。
  // 正しくは [0][1]=白, [0][2]=黒 のとき黒[0][0]は「外側」なので置けない。
  // 角を取れる形: [0][1]=白(相手), [0][2]=黒(自分) で 黒が[0][0]?→[0][0]から見て[0][1]白[0][2]黒 で返せる。
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  b[0][1] = WHITE;
  b[0][2] = BLACK;
  // 中央付近にも黒の平凡な手を1つ用意して選択肢を作る
  b[3][3] = WHITE; b[3][4] = BLACK; b[4][3] = BLACK; b[4][4] = WHITE;
  // 黒[0][0]が合法（[0][1]白を挟んで[0][2]黒）であることを前提確認
  assert.ok(flips(b, 0, 0, BLACK).length > 0, "前提: 角が取れる");
  const [r, c] = chooseCpuMove(b, BLACK, 3);
  assert.deepEqual([r, c], [0, 0], "つよいは角を選ぶ");
});
