import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCSV, buildJSON } from "../src/exporter.js";

const game = {
  date: "2026-06-03T10:00:00Z",
  mode: "2p", level: null, hints: true, durationMs: 65000,
  black: { kind: "user", id: "a", name: "あつ" },
  white: { kind: "guest", id: "g", name: "ゲスト" },
  result: { winner: "black", black: 40, white: 24 },
  kifu: "f5d6c3",
};

test("buildCSV はヘッダ＋1行を出す", () => {
  const csv = buildCSV([game]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("date,mode,level,hints"));
  assert.ok(lines[1].includes("あつ"));
  assert.ok(lines[1].includes("65000".replace("65000", "65"))); // duration_sec=65
  assert.ok(lines[1].includes("f5d6c3"));
});

test("buildCSV はカンマ/引用符をエスケープ", () => {
  const g = { ...game, black: { ...game.black, name: 'A,B"C' } };
  const csv = buildCSV([g]);
  assert.ok(csv.includes('"A,B""C"'));
});

test("buildJSON は棋譜を含む構造を保持", () => {
  const parsed = JSON.parse(buildJSON([game]));
  assert.equal(parsed[0].kifu, "f5d6c3");
  assert.equal(parsed[0].black.name, "あつ");
});
