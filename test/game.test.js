import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE, EMPTY, count } from "../src/rules.js";
import { newGame, play, undo, gameResult } from "../src/game.js";

test("newGame は黒番・未終局・履歴空で始まる", () => {
  const s = newGame();
  assert.equal(s.current, BLACK);
  assert.equal(s.over, false);
  assert.equal(s.history.length, 0);
  assert.equal(count(s.board, BLACK), 2);
});

test("play は着手して手番を相手に渡す", () => {
  const s0 = newGame();
  const s1 = play(s0, 2, 3); // 黒d3
  assert.equal(s1.current, WHITE, "黒→白に手番が渡る");
  assert.equal(s1.board[2][3], BLACK);
  assert.equal(s1.board[3][3], BLACK, "挟んだ石が返る");
  assert.equal(s0.current, BLACK, "元stateは不変（イミュータブル）");
  assert.equal(s1.history.length, 1);
});

test("非合法手な play は state を変えない", () => {
  const s0 = newGame();
  const s1 = play(s0, 0, 0); // 挟めない
  assert.equal(s1, s0);
});

test("undo は直前の1手を戻す", () => {
  const s0 = newGame();
  const s1 = play(s0, 2, 3);
  const s2 = undo(s1);
  assert.equal(s2.current, BLACK);
  assert.equal(s2.board[2][3], EMPTY);
  assert.equal(count(s2.board, BLACK), 2);
});

test("undo は履歴が無ければそのまま", () => {
  const s0 = newGame();
  assert.equal(undo(s0), s0);
});

test("undo を繰り返すと何手でも戻せる（無制限）", () => {
  let s = newGame();
  s = play(s, 2, 3); // 黒
  s = play(s, 2, 2); // 白(c3) など合法手
  // 2手戻す
  s = undo(s);
  s = undo(s);
  assert.equal(s.current, BLACK);
  assert.equal(s.history.length, 0);
  assert.equal(count(s.board, BLACK), 2);
  assert.equal(count(s.board, WHITE), 2);
});

test("相手が打てない時はパスして手番が戻る（passedフラグ）", () => {
  // 黒に独立した2本の返し筋を用意。白はどこにも打てない局面。
  // 黒が筋Aを打つと、白は依然打てず、黒には筋Bが残る→白パスで黒手番継続。
  const board = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  board[0][0] = BLACK; board[0][1] = WHITE; // 筋A: 黒[0][2]で[0][1]を返す
  board[7][0] = BLACK; board[7][1] = WHITE; // 筋B: 黒[7][2]で[7][1]を返す
  const s = { board, current: BLACK, history: [], passed: false, over: false };
  const s1 = play(s, 0, 2); // 筋Aを着手
  assert.equal(s1.over, false, "まだ黒に筋Bが残るので終局しない");
  assert.equal(s1.passed, true, "白は打てずパス");
  assert.equal(s1.current, BLACK, "手番は黒に戻る");
});

test("gameResult は勝者と石数を返す", () => {
  const full = Array.from({ length: 8 }, () => Array(8).fill(BLACK));
  const s = { board: full, current: BLACK, history: [], passed: false, over: true };
  const r = gameResult(s);
  assert.equal(r.winner, BLACK);
  assert.equal(r.black, 64);
  assert.equal(r.white, 0);
});
