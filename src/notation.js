// オセロ標準の棋譜表記（列 a-h ＝ 左→右、行 1-8 ＝ 上→下）。
const COLS = "abcdefgh";
export const PASS = "ps";

// (r,c) → "f5" のような座標文字列
export function coord(r, c) {
  return COLS[c] + (r + 1);
}

// "f5" → {r,c}（パスは null）
export function parseCoord(token) {
  if (token === PASS) return null;
  const c = COLS.indexOf(token[0]);
  const r = parseInt(token.slice(1), 10) - 1;
  return { r, c };
}

// 着手列 [{r,c} | {pass:true}] → "f5d6ps..." の連結文字列
export function kifuFromMoves(moves) {
  return moves
    .map((m) => (m.pass ? PASS : coord(m.r, m.c)))
    .join("");
}

// "f5d6ps" → [{r,c}|{pass:true}] に分解
export function movesFromKifu(kifu) {
  const out = [];
  for (let i = 0; i < kifu.length; ) {
    if (kifu.slice(i, i + 2) === PASS) {
      out.push({ pass: true });
      i += 2;
    } else {
      const p = parseCoord(kifu.slice(i, i + 2));
      out.push(p);
      i += 2;
    }
  }
  return out;
}
