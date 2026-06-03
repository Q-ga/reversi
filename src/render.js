// 盤面のDOM描画と連鎖めくりアニメ。
import { SIZE, EMPTY, BLACK, legalMoves } from "./rules.js";

export function buildBoard(boardEl, onCell) {
  boardEl.innerHTML = "";
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    const row = [];
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.addEventListener("click", () => onCell(r, c));
      boardEl.appendChild(cell);
      row.push(cell);
    }
    cells.push(row);
  }
  return cells;
}

function setDisc(cell, v) {
  let disc = cell.querySelector(".disc");
  if (v === EMPTY) {
    if (disc) disc.remove();
    return;
  }
  if (!disc) {
    disc = document.createElement("div");
    disc.className = "disc";
    cell.appendChild(disc);
  }
  disc.classList.toggle("black", v === BLACK);
  disc.classList.toggle("white", v !== BLACK && v !== EMPTY);
}

// 全面同期（初期化/リセット/待った用）。アニメ無し。
export function renderBoard(cells, state, showHints) {
  const hints = !state.over && showHints
    ? new Set(legalMoves(state.board, state.current).map(([r, c]) => r * SIZE + c))
    : new Set();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = cells[r][c];
      cell.classList.toggle("hint", hints.has(r * SIZE + c));
      setDisc(cell, state.board[r][c]);
    }
  }
}

export function clearHints(cells) {
  for (const row of cells) for (const cell of row) cell.classList.remove("hint");
}

// 着手の連鎖めくりアニメ。置いた石から波紋状（距離順）に1枚ずつ返す。
// onFlip(index) を各めくりで呼ぶ（音の連鎖用）。Promiseは全めくり完了で解決。
export function animateMove(cells, prevBoard, nextBoard, move, color, onFlip, stepMs = 55) {
  return new Promise((resolve) => {
    // 着手石をすぐ置く（ポップ）
    const placed = cells[move.r][move.c];
    setDisc(placed, color);
    const pd = placed.querySelector(".disc");
    if (pd) { pd.classList.add("pop"); setTimeout(() => pd && pd.classList.remove("pop"), 220); }

    // 返る石を距離順に並べる
    const flipped = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (r === move.r && c === move.c) continue;
        if (prevBoard[r][c] !== EMPTY && prevBoard[r][c] !== nextBoard[r][c]) {
          const dist = Math.max(Math.abs(r - move.r), Math.abs(c - move.c));
          flipped.push({ r, c, dist });
        }
      }
    }
    flipped.sort((a, b) => a.dist - b.dist);

    if (flipped.length === 0) { resolve(); return; }

    flipped.forEach((f, i) => {
      setTimeout(() => {
        const cell = cells[f.r][f.c];
        const disc = cell.querySelector(".disc");
        if (disc) {
          disc.classList.add("flipping");
          setTimeout(() => {
            setDisc(cell, nextBoard[f.r][f.c]);
            const nd = cell.querySelector(".disc");
            if (nd) nd.classList.remove("flipping");
          }, stepMs * 0.5);
        } else {
          setDisc(cell, nextBoard[f.r][f.c]);
        }
        onFlip(i);
        if (i === flipped.length - 1) setTimeout(resolve, stepMs);
      }, i * stepMs);
    });
  });
}
