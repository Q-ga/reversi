import { test } from "node:test";
import assert from "node:assert/strict";
import { statsForUser, headToHead } from "../src/stats.js";

const U = (id, name) => ({ kind: "user", id, name });
const GUEST = { kind: "guest", id: "guest", name: "ゲスト" };

function rec(black, white, winner) {
  return {
    date: "2026-06-03T00:00:00Z",
    mode: "2p", level: null, hints: true, durationMs: 1000,
    black, white,
    result: { winner, black: 33, white: 31 },
    kifu: "",
  };
}

test("statsForUser は通算と先攻/後攻別を集計", () => {
  const a = U("a", "あつ");
  const b = U("b", "ともだち");
  const records = [
    rec(a, b, "black"), // aが黒で勝ち
    rec(b, a, "black"), // aが白で負け
    rec(a, GUEST, "white"), // aが黒で負け（相手ゲスト）
    rec(a, b, "draw"), // aが黒で引分
  ];
  const s = statsForUser(records, "a");
  assert.equal(s.total.games, 4);
  assert.equal(s.total.wins, 1);
  assert.equal(s.total.losses, 2);
  assert.equal(s.total.draws, 1);
  assert.equal(s.total.winRate, 25);

  assert.equal(s.asBlack.games, 3); // 黒で3局
  assert.equal(s.asBlack.wins, 1);
  assert.equal(s.asWhite.games, 1); // 白で1局
  assert.equal(s.asWhite.wins, 0);
});

test("statsForUser は当該ユーザーが居ない局を無視", () => {
  const a = U("a", "あつ");
  const s = statsForUser([rec(GUEST, GUEST, "black")], "a");
  assert.equal(s.total.games, 0);
});

test("headToHead はAから見た直接対決成績", () => {
  const a = U("a", "あつ");
  const b = U("b", "ともだち");
  const records = [
    rec(a, b, "black"), // a勝ち
    rec(b, a, "black"), // b勝ち
    rec(a, b, "draw"),
    rec(a, GUEST, "black"), // 直接対決でない
  ];
  const h = headToHead(records, "a", "b");
  assert.equal(h.games, 3);
  assert.equal(h.winsA, 1);
  assert.equal(h.winsB, 1);
  assert.equal(h.draws, 1);
});
