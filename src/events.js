// スポット演出の発火判定（純粋）。状態遷移から発火すべきイベントtagの配列を返す。
// すべて盤全体のグローバル判定（特定プレイヤー視点に依らない）。
// tag: 'bigFlip' | 'corner' | 'reversal' | 'pass' |
//      'lastCell' | 'gameover' | 'gameover-draw' | 'shutout'
import { EMPTY, BLACK, WHITE, opponent, count } from "./rules.js";
import { assessForm } from "./evaluate.js";

export const BIG_FLIP_THRESHOLD = 5;
const CORNERS = new Set(["0,0", "0,7", "7,0", "7,7"]);

// 盤のリード色（黒優勢=BLACK / 白優勢=WHITE / 拮抗=null）
function leadColor(board) {
  const tide = assessForm(board, BLACK).tide;
  if (tide > 0.12) return BLACK;
  if (tide < -0.12) return WHITE;
  return null;
}

// prev/next: GameState, move:{r,c}|null(パス時), flippedCount:number
export function detectEvents(prev, next, move, flippedCount) {
  const tags = [];

  if (flippedCount >= BIG_FLIP_THRESHOLD) tags.push("bigFlip");
  if (move && CORNERS.has(`${move.r},${move.c}`)) tags.push("corner");

  // 逆転：リードしている色が入れ替わった
  const lp = leadColor(prev.board), ln = leadColor(next.board);
  if (lp && ln && lp !== ln) tags.push("reversal");

  if (next.passed) tags.push("pass");
  if (count(next.board, EMPTY) === 1) tags.push("lastCell");

  if (next.over) {
    const b = count(next.board, BLACK);
    const w = count(next.board, opponent(BLACK));
    if (b === w) tags.push("gameover-draw");
    else tags.push("gameover"); // 勝者へのファンファーレ（中立）
    if (b === 0 || w === 0) tags.push("shutout");
  }
  return tags;
}
