// オセロ（リバーシ）の純粋ルールロジック。
// 盤は 8x8 の二次元配列。値は EMPTY/BLACK/WHITE。
// すべての関数は副作用なし・イミュータブル（applyMove は新しい盤を返す）。

export const SIZE = 8;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

// 8方向（縦横斜め）
const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

const inBoard = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export function createBoard() {
  const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  b[3][3] = WHITE;
  b[3][4] = BLACK;
  b[4][3] = BLACK;
  b[4][4] = WHITE;
  return b;
}

export function opponent(p) {
  return p === BLACK ? WHITE : BLACK;
}

// (r,c) に p を置いたとき裏返る石の座標一覧。置けないなら空配列。
export function flips(b, r, c, p) {
  if (!inBoard(r, c) || b[r][c] !== EMPTY) return [];
  const result = [];
  const opp = opponent(p);
  for (const [dr, dc] of DIRS) {
    const line = [];
    let nr = r + dr;
    let nc = c + dc;
    while (inBoard(nr, nc) && b[nr][nc] === opp) {
      line.push([nr, nc]);
      nr += dr;
      nc += dc;
    }
    // 反対色の連なりの先が自色なら、その連なりは返せる
    if (line.length && inBoard(nr, nc) && b[nr][nc] === p) {
      result.push(...line);
    }
  }
  return result;
}

export function legalMoves(b, p) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (flips(b, r, c, p).length) moves.push([r, c]);
    }
  }
  return moves;
}

// p を (r,c) に着手した新しい盤を返す。返る石の情報も併せて返す。
export function applyMove(b, r, c, p) {
  const flipped = flips(b, r, c, p);
  const nb = b.map((row) => row.slice());
  nb[r][c] = p;
  for (const [fr, fc] of flipped) nb[fr][fc] = p;
  return nb;
}

export function count(b, p) {
  let n = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (b[r][c] === p) n++;
    }
  }
  return n;
}

export function hasAnyMove(b, p) {
  return legalMoves(b, p).length > 0;
}

export function isGameOver(b) {
  return !hasAnyMove(b, BLACK) && !hasAnyMove(b, WHITE);
}

// 勝者を返す。引き分けは EMPTY(0)。
export function winner(b) {
  const black = count(b, BLACK);
  const white = count(b, WHITE);
  if (black > white) return BLACK;
  if (white > black) return WHITE;
  return EMPTY;
}
