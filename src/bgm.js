// BGM状態の判定（純粋）。主役視点に依らず、盤の進行と競り合い度で決める。
// 2段階：通常（前半＋中盤）/ 終盤（接戦 or 一方的）。
import { EMPTY, BLACK, WHITE, count } from "./rules.js";

// 空きマスがこの数以下になったら「終盤」（残り約10手）
export const ENDGAME_EMPTIES = 10;
// 終盤での石差がこの値以上なら「一方的」、未満なら「接戦」
export const ONESIDE_MARGIN = 12;

// "normal" | "endgame_close" | "endgame_oneside"
export function bgmState(board) {
  const empties = count(board, EMPTY);
  if (empties > ENDGAME_EMPTIES) return "normal";
  const margin = Math.abs(count(board, BLACK) - count(board, WHITE));
  return margin >= ONESIDE_MARGIN ? "endgame_oneside" : "endgame_close";
}
