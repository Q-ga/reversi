import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY, BLACK, WHITE,
  createBoard, opponent, flips, legalMoves,
  applyMove, count, hasAnyMove, isGameOver, winner,
} from "../src/rules.js";

test("初期盤は中央4石（黒2白2）", () => {
  const b = createBoard();
  assert.equal(count(b, BLACK), 2);
  assert.equal(count(b, WHITE), 2);
  assert.equal(count(b, EMPTY), 60);
  // 標準配置: d4=白, e4=黒, d5=黒, e5=白 （row,col 0始まり: [3][3]白[3][4]黒[4][3]黒[4][4]白）
  assert.equal(b[3][3], WHITE);
  assert.equal(b[3][4], BLACK);
  assert.equal(b[4][3], BLACK);
  assert.equal(b[4][4], WHITE);
});

test("opponent は色を反転する", () => {
  assert.equal(opponent(BLACK), WHITE);
  assert.equal(opponent(WHITE), BLACK);
});

test("黒の初手合法手は4つ（d3,c4,f5,e6）", () => {
  const b = createBoard();
  const moves = legalMoves(b, BLACK);
  assert.equal(moves.length, 4);
  const set = new Set(moves.map(([r, c]) => `${r},${c}`));
  assert.ok(set.has("2,3")); // d3
  assert.ok(set.has("3,2")); // c4
  assert.ok(set.has("4,5")); // f5
  assert.ok(set.has("5,4")); // e6
});

test("flips は挟んだ石の座標を返す（合法手）", () => {
  const b = createBoard();
  // 黒が[2][3](d3)に置くと[3][3](白)が返る
  const f = flips(b, 2, 3, BLACK);
  assert.equal(f.length, 1);
  assert.deepEqual(f[0], [3, 3]);
});

test("flips は非合法手では空配列（既に石がある/挟めない）", () => {
  const b = createBoard();
  assert.equal(flips(b, 3, 3, BLACK).length, 0); // 既に石
  assert.equal(flips(b, 0, 0, BLACK).length, 0); // 何も挟めない
});

test("applyMove は新しい盤を返し元を変更しない（イミュータブル）", () => {
  const b = createBoard();
  const nb = applyMove(b, 2, 3, BLACK);
  assert.notEqual(nb, b);
  assert.equal(b[2][3], EMPTY, "元の盤は変わらない");
  assert.equal(nb[2][3], BLACK, "新盤に着手が反映");
  assert.equal(nb[3][3], BLACK, "挟んだ石が返っている");
  assert.equal(count(nb, BLACK), 4); // 2 + 置1 + 返1
  assert.equal(count(nb, WHITE), 1);
});

test("hasAnyMove / isGameOver", () => {
  const b = createBoard();
  assert.equal(hasAnyMove(b, BLACK), true);
  assert.equal(isGameOver(b), false);
});

test("両者打てないと終局、winnerは石数で決まる", () => {
  // 黒だけで埋めた盤（白0）→両者打てない＝終局、黒勝ち
  const full = Array.from({ length: 8 }, () => Array(8).fill(BLACK));
  assert.equal(hasAnyMove(full, BLACK), false);
  assert.equal(hasAnyMove(full, WHITE), false);
  assert.equal(isGameOver(full), true);
  assert.equal(winner(full), BLACK);
});

test("winner は引き分けで EMPTY(0) を返す", () => {
  const b = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => ((r * 8 + c) % 2 === 0 ? BLACK : WHITE))
  );
  assert.equal(count(b, BLACK), 32);
  assert.equal(count(b, WHITE), 32);
  assert.equal(winner(b), EMPTY);
});

test("全方向（8方向）で正しく挟める", () => {
  // 中央に白の十字＋斜めを置き、黒で囲んで全方向返しを確認
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  const C = 4;
  b[C][C] = EMPTY; // 置く場所
  // 8方向、距離1に白、距離2に黒
  const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for (const [dr, dc] of DIRS) {
    b[C + dr][C + dc] = WHITE;
    b[C + dr * 2][C + dc * 2] = BLACK;
  }
  const f = flips(b, C, C, BLACK);
  assert.equal(f.length, 8, "8方向すべて1枚ずつ返る");
});
