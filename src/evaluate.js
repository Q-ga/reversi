// CPUの思考と形勢評価（純粋）。
import {
  EMPTY, BLACK, opponent, legalMoves, applyMove, count,
} from "./rules.js";

// 角を最重視し、角隣（危険）を負に振った定番の評価重み。
const WEIGHTS = [
  [120, -20, 20, 5, 5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20, 5, 5, 20, -20, 120],
];

const MOBILITY_K = 5;

// p視点の位置評価（位置重み＋機動力）。反対称: evaluate(b,p) === -evaluate(b,opp)
export function evaluate(b, p) {
  const opp = opponent(p);
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (b[r][c] === p) score += WEIGHTS[r][c];
      else if (b[r][c] === opp) score -= WEIGHTS[r][c];
    }
  }
  score += (legalMoves(b, p).length - legalMoves(b, opp).length) * MOBILITY_K;
  return score;
}

function minimax(b, turn, me, depth, alpha, beta) {
  if (depth === 0) return evaluate(b, me);
  const moves = legalMoves(b, turn);
  if (moves.length === 0) {
    if (legalMoves(b, opponent(turn)).length === 0) return evaluate(b, me);
    return minimax(b, opponent(turn), me, depth - 1, alpha, beta);
  }
  if (turn === me) {
    let value = -Infinity;
    for (const [r, c] of moves) {
      value = Math.max(value, minimax(applyMove(b, r, c, turn), opponent(turn), me, depth - 1, alpha, beta));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }
  let value = Infinity;
  for (const [r, c] of moves) {
    value = Math.min(value, minimax(applyMove(b, r, c, turn), opponent(turn), me, depth - 1, alpha, beta));
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

// CPUの着手選択。level 1=ランダム, 2=1手評価(貪欲), 3=αβ先読み。
export function chooseCpuMove(b, p, level) {
  const moves = legalMoves(b, p);
  if (moves.length === 0) return null;
  if (level === 1) {
    return moves[Math.floor(Math.random() * moves.length)];
  }
  const depth = level >= 3 ? 4 : 1;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const [r, c] of moves) {
    const nb = applyMove(b, r, c, p);
    const s = depth === 1 ? evaluate(nb, p) : minimax(nb, opponent(p), p, depth - 1, -Infinity, Infinity);
    if (s > bestScore) {
      bestScore = s;
      best = [r, c];
    }
  }
  return best;
}

// 形勢評価（ハイブリッド）。主役視点で band を返す。
// 序中盤は位置評価、終盤は石数差の比重を上げる。
export function assessForm(b, mainColor) {
  const opp = opponent(mainColor);
  const empties = count(b, EMPTY);
  const filled = 64 - empties;

  // 位置評価を概ね [-1,1] に正規化（角4つぶん=480を上限の目安に）
  const posNorm = Math.max(-1, Math.min(1, evaluate(b, mainColor) / 200));
  // 石数差を [-1,1] に正規化
  const discNorm = (count(b, mainColor) - count(b, opp)) / Math.max(1, filled);

  // 終盤ほど石数差を重視（progress^2 で後半に効かせる）
  const progress = filled / 64;
  const wDisc = progress * progress;
  const tide = posNorm * (1 - wDisc) + discNorm * wDisc;

  let band;
  if (tide > 0.12) band = "win";
  else if (tide < -0.12) band = "lose";
  else band = "even";
  return { tide, band };
}
