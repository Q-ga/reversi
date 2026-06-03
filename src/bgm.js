// BGM状態の判定（純粋）。主役視点に依らず盤の進行で決める。
// 2状態：通常（前半＋中盤）/ 終盤（緊迫感のみ。一方的分岐は廃止）。
import { EMPTY, count } from "./rules.js";

// 空きマスがこの数以下になったら「終盤」（残り約10手）
export const ENDGAME_EMPTIES = 10;

// "normal" | "endgame"
export function bgmState(board) {
  return count(board, EMPTY) > ENDGAME_EMPTIES ? "normal" : "endgame";
}
