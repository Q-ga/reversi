// スポット演出の発火判定（純粋）。状態遷移から発火すべきイベントtagの配列を返す。
// tag: 'bigFlip' | 'corner' | 'reversal' | 'pass' |
//      'lastCell' | 'gameover-win' | 'gameover-lose' | 'gameover-draw' | 'shutout'
import { EMPTY, BLACK, opponent, count } from "./rules.js";
import { assessForm } from "./evaluate.js";

export const BIG_FLIP_THRESHOLD = 5;
const CORNERS = new Set(["0,0", "0,7", "7,0", "7,7"]);

// prev/next: GameState, move:{r,c}|null(パス時), flippedCount:number, mainColor
export function detectEvents(prev, next, move, flippedCount, mainColor) {
  const tags = [];

  // 大量返し
  if (flippedCount >= BIG_FLIP_THRESHOLD) tags.push("bigFlip");

  // 角取り
  if (move && CORNERS.has(`${move.r},${move.c}`)) tags.push("corner");

  // 逆転（主役視点でtideの優劣が反転）
  const prevTide = assessForm(prev.board, mainColor).tide;
  const nextTide = assessForm(next.board, mainColor).tide;
  if ((prevTide <= -0.12 && nextTide >= 0.12) || (prevTide >= 0.12 && nextTide <= -0.12)) {
    tags.push("reversal");
  }

  // パス
  if (next.passed) tags.push("pass");

  // ラス1マス（次状態で空きが1）
  if (count(next.board, EMPTY) === 1) tags.push("lastCell");

  // 終局
  if (next.over) {
    const black = count(next.board, BLACK);
    const white = count(next.board, opponent(BLACK));
    const mainCount = mainColor === BLACK ? black : white;
    const oppCount = mainColor === BLACK ? white : black;
    if (mainCount > oppCount) tags.push("gameover-win");
    else if (mainCount < oppCount) tags.push("gameover-lose");
    else tags.push("gameover-draw");
    // 完封（相手0枚）
    if (oppCount === 0 || mainCount === 0) tags.push("shutout");
  }

  return tags;
}
