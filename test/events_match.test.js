import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY, BLACK, WHITE } from "../src/rules.js";
import { detectEvents } from "../src/events.js";
import { swapColors, shouldRecord } from "../src/match.js";

const stateOf = (board, over = false, passed = false) => ({ board, over, passed });
const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(EMPTY));

test("detectEvents: 大量返し(5枚以上)でbigFlip", () => {
  const b = emptyBoard();
  const tags = detectEvents(stateOf(b), stateOf(b), { r: 3, c: 3 }, 5, BLACK);
  assert.ok(tags.includes("bigFlip"));
});

test("detectEvents: 角への着手でcorner", () => {
  const b = emptyBoard();
  const tags = detectEvents(stateOf(b), stateOf(b), { r: 0, c: 0 }, 1, BLACK);
  assert.ok(tags.includes("corner"));
  const tags2 = detectEvents(stateOf(b), stateOf(b), { r: 3, c: 3 }, 1, BLACK);
  assert.ok(!tags2.includes("corner"));
});

test("detectEvents: 終局で勝敗tagと完封", () => {
  const full = Array.from({ length: 8 }, () => Array(8).fill(BLACK));
  const tags = detectEvents(stateOf(full), stateOf(full, true), null, 0, BLACK);
  assert.ok(tags.includes("gameover-win"));
  assert.ok(tags.includes("shutout"), "相手0枚で完封");
});

test("detectEvents: パスでpass", () => {
  const b = emptyBoard();
  const tags = detectEvents(stateOf(b), stateOf(b, false, true), { r: 2, c: 2 }, 1, BLACK);
  assert.ok(tags.includes("pass"));
});

test("detectEvents: 逆転（主役の形勢が劣勢→優勢）でreversal", () => {
  // prev: 白が角を持ち主役(黒)劣勢 / next: 黒が角を持ち優勢
  const prevB = emptyBoard();
  prevB[0][0] = WHITE; prevB[0][7] = WHITE;
  const nextB = emptyBoard();
  nextB[0][0] = BLACK; nextB[0][7] = BLACK; nextB[7][0] = BLACK;
  const tags = detectEvents(stateOf(prevB), stateOf(nextB), { r: 7, c: 0 }, 1, BLACK);
  assert.ok(tags.includes("reversal"));
});

test("swapColors は黒白を入れ替える", () => {
  const a = { kind: "user", id: "a", name: "あつ" };
  const b = { kind: "user", id: "b", name: "とも" };
  const swapped = swapColors({ black: a, white: b });
  assert.deepEqual(swapped, { black: b, white: a });
});

test("shouldRecord: 登録ユーザーが居れば記録、ゲスト対ゲスト/CPUは記録しない", () => {
  const user = { kind: "user", id: "a", name: "あつ" };
  const guest = { kind: "guest", id: "g", name: "ゲスト" };
  const cpu = { kind: "cpu", id: "cpu", name: "CPU" };
  assert.equal(shouldRecord({ black: user, white: guest }), true);
  assert.equal(shouldRecord({ black: user, white: cpu }), true);
  assert.equal(shouldRecord({ black: guest, white: guest }), false);
  assert.equal(shouldRecord({ black: guest, white: cpu }), false);
});
