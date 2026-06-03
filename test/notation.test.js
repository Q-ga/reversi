import { test } from "node:test";
import assert from "node:assert/strict";
import { coord, parseCoord, kifuFromMoves, movesFromKifu, PASS } from "../src/notation.js";

test("coord は標準表記に変換する", () => {
  assert.equal(coord(0, 0), "a1");
  assert.equal(coord(7, 7), "h8");
  assert.equal(coord(4, 5), "f5");
  assert.equal(coord(2, 3), "d3");
});

test("parseCoord は逆変換、パスはnull", () => {
  assert.deepEqual(parseCoord("a1"), { r: 0, c: 0 });
  assert.deepEqual(parseCoord("f5"), { r: 4, c: 5 });
  assert.equal(parseCoord(PASS), null);
});

test("kifuFromMoves / movesFromKifu は往復で一致", () => {
  const moves = [{ r: 4, c: 5 }, { r: 5, c: 3 }, { pass: true }, { r: 0, c: 0 }];
  const kifu = kifuFromMoves(moves);
  assert.equal(kifu, "f5d6psa1");
  assert.deepEqual(movesFromKifu(kifu), moves);
});
