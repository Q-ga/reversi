// 対局のプレイヤー割り当てと再戦時の入替（純粋）。
// assignment = { black: playerRef, white: playerRef }
//   playerRef = { kind:'user'|'guest'|'cpu', id, name }

// 再戦時に黒白を入れ替える（先攻後攻を公平に回す）。
export function swapColors(assignment) {
  return { black: assignment.white, white: assignment.black };
}

// CPU戦の割り当て：先攻なら人間が黒、後攻ならCPUが黒（CPUが先に着手）。
export function cpuAssignment(human, cpu, playerFirst) {
  return playerFirst ? { black: human, white: cpu } : { black: cpu, white: human };
}

// 記録対象か判定：登録ユーザーが1人でも参加していれば記録する。
// ゲスト対ゲスト・登録ユーザー不在（ゲスト対CPU等）は記録しない。
export function shouldRecord(assignment) {
  return assignment.black.kind === "user" || assignment.white.kind === "user";
}
