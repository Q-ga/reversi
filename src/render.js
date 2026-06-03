// 盤面のDOM描画と連鎖めくりアニメ。
// 石は2面(表=黒/裏=白)を持つ立体構造で、色の変更はCSSの rotateY 遷移で
// 「本物のめくり」として見せる。
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
  // 星（打点）：内側のプレイ領域(padding分インセット)の25%/75%の交点に4つ
  const stars = document.createElement("div");
  stars.style.cssText = "position:absolute;inset:12px;pointer-events:none;z-index:2;";
  for (const [x, y] of [[25, 25], [25, 75], [75, 25], [75, 75]]) {
    const s = document.createElement("div");
    s.className = "star";
    s.style.left = x + "%";
    s.style.top = y + "%";
    stars.appendChild(s);
  }
  boardEl.appendChild(stars);
  return cells;
}

function ensureDisc(cell) {
  let disc = cell.querySelector(".disc");
  if (!disc) {
    disc = document.createElement("div");
    disc.className = "disc";
    disc.innerHTML =
      '<div class="d3"><div class="face front"></div><div class="face back"></div></div>';
    cell.appendChild(disc);
  }
  return disc;
}

// セルの石の色を設定。EMPTYなら除去。
function setDisc(cell, v) {
  let disc = cell.querySelector(".disc");
  if (v === EMPTY) {
    if (disc) disc.remove();
    return;
  }
  disc = ensureDisc(cell);
  const d3 = disc.querySelector(".d3");
  d3.classList.toggle("b", v === BLACK);
  d3.classList.toggle("w", v !== BLACK && v !== EMPTY);
}

// 全面同期（初期化/リセット/待った用）。遷移アニメは一時的に止める。
export function renderBoard(cells, state, showHints) {
  const board = cells[0][0].parentElement;
  board.classList.add("instant"); // transition無効化（待った/リセットで石が回らないように）
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
  // 次フレームで遷移を戻す
  requestAnimationFrame(() => requestAnimationFrame(() => board.classList.remove("instant")));
}

export function clearHints(cells) {
  for (const row of cells) for (const cell of row) cell.classList.remove("hint");
}

// 着手の連鎖めくりアニメ。置いた石から波紋状（距離順）に1枚ずつ返す。
// 色変更＝CSSの rotateY 遷移が「めくり」を描く。onFlip(index) を各めくりで呼ぶ。
export function animateMove(cells, prevBoard, nextBoard, move, color, onFlip, stepMs = 55) {
  return new Promise((resolve) => {
    // 着手石をすぐ置く（ポップ）
    const placed = cells[move.r][move.c];
    setDisc(placed, color);
    const pd = placed.querySelector(".disc");
    if (pd) { pd.classList.add("pop"); setTimeout(() => pd && pd.classList.remove("pop"), 240); }

    // 返る石を距離順に並べる
    const flipped = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (r === move.r && c === move.c) continue;
        if (prevBoard[r][c] !== EMPTY && prevBoard[r][c] !== nextBoard[r][c]) {
          flipped.push({ r, c, dist: Math.max(Math.abs(r - move.r), Math.abs(c - move.c)) });
        }
      }
    }
    flipped.sort((a, b) => a.dist - b.dist);

    if (flipped.length === 0) { resolve(); return; }

    flipped.forEach((f, i) => {
      setTimeout(() => {
        setDisc(cells[f.r][f.c], nextBoard[f.r][f.c]); // class切替→CSS遷移でめくれる
        onFlip(i);
        if (i === flipped.length - 1) setTimeout(resolve, stepMs + 380); // 遷移完了を待つ
      }, i * stepMs);
    });
  });
}
