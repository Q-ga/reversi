// ゲーム状態の遷移（純粋）。UI/音から独立してテスト可能に保つ。
// GameState = { board, current, history, passed, over }
//   history: { board, current } のスナップショット配列（undo用）

import {
  BLACK, createBoard, opponent, flips, applyMove, hasAnyMove, count, winner,
} from "./rules.js";

export function newGame(first = BLACK) {
  return {
    board: createBoard(),
    current: first,
    history: [],
    passed: false,
    over: false,
  };
}

// 着手。非合法なら同じ state を返す（イミュータブル）。
// 着手後、相手→自分の順で打てるか判定し、パス/終局を解決する。
export function play(state, r, c) {
  if (state.over) return state;
  if (flips(state.board, r, c, state.current).length === 0) return state;

  const board = applyMove(state.board, r, c, state.current);
  const history = [...state.history, { board: state.board, current: state.current }];

  const next = opponent(state.current);
  if (hasAnyMove(board, next)) {
    return { board, current: next, history, passed: false, over: false };
  }
  // 相手が打てない
  if (hasAnyMove(board, state.current)) {
    return { board, current: state.current, history, passed: true, over: false };
  }
  // 双方打てない＝終局
  return { board, current: state.current, history, passed: false, over: true };
}

// 直前の1手を取り消す。履歴が無ければそのまま。
export function undo(state) {
  if (state.history.length === 0) return state;
  const history = state.history.slice();
  const prev = history.pop();
  return {
    board: prev.board,
    current: prev.current,
    history,
    passed: false,
    over: false,
  };
}

export function gameResult(state) {
  return {
    winner: winner(state.board),
    black: count(state.board, BLACK),
    white: count(state.board, opponent(BLACK)),
  };
}
