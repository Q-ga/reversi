// アプリ全体の配線：画面遷移／対局進行／CPU／音／演出／記録／戦績。
import { BLACK, WHITE, count } from "./rules.js";
import { newGame, play, undo, gameResult } from "./game.js";
import { chooseCpuMove } from "./evaluate.js";
import { bgmState } from "./bgm.js";
import { createBoardView } from "./render3d.js";
import { detectEvents } from "./events.js";
import { kifuFromMoves } from "./notation.js";
import { swapColors, shouldRecord } from "./match.js";
import { statsForUser, headToHead } from "./stats.js";
import { buildCSV, buildJSON } from "./exporter.js";
import * as audio from "./audio.js";
import {
  listProfiles, addProfile, updateProfile, deleteProfile, addGame, listGames, MAX_PROFILES,
} from "./storage.js";

const GUEST = { kind: "guest", id: "guest", name: "ゲスト" };
const cpuRef = (level) => ({ kind: "cpu", id: "cpu", name: `CPU（${["", "かんたん", "ふつう", "つよい"][level]}）` });

// --- アプリ状態 ---
let profiles = [];
let setup = { mode: "2p", black: null, white: null, mainId: null, level: 2, hints: true };
let match = null; // { assignment, mainColor, mode, level, hints, startedAt, moves }
let state = null;
let view = null; // three.jsの盤ビュー（初回startMatchで生成し再利用）
let busy = false;
let cpuTimerId = null;

const $ = (id) => document.getElementById(id);

function showScreen(name) {
  for (const s of document.querySelectorAll(".screen")) s.classList.remove("active");
  $(`screen-${name}`).classList.add("active");
}

// ============ メニュー ============
document.querySelectorAll("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    audio.init();
    setup.mode = b.dataset.mode;
    openSetup();
  })
);
$("go-stats").addEventListener("click", openStats);
$("go-profiles").addEventListener("click", openProfiles);
document.querySelectorAll("[data-back]").forEach((b) =>
  b.addEventListener("click", () => showScreen(b.dataset.back))
);

// ============ セットアップ ============
async function openSetup() {
  profiles = await listProfiles();
  $("setup-title").textContent = setup.mode === "cpu" ? "CPUと対戦" : "2人で対戦";
  $("field-level").style.display = setup.mode === "cpu" ? "" : "none";

  // 選択候補：登録ユーザー＋ゲスト（CPU戦の白はCPU固定）
  const humanChoices = [...profiles.map((p) => ({ kind: "user", id: p.id, name: p.name })), GUEST];

  // 既定値
  setup.black = humanChoices[0];
  setup.white = setup.mode === "cpu" ? cpuRef(setup.level) : (humanChoices[1] || GUEST);
  setup.mainId = setup.black.id;

  renderSeg("seg-black", humanChoices, setup.black.id, (ref) => { setup.black = ref; syncMainChoices(); });
  if (setup.mode === "cpu") {
    $("field-white").style.display = "none";
  } else {
    $("field-white").style.display = "";
    renderSeg("seg-white", humanChoices, setup.white.id, (ref) => { setup.white = ref; syncMainChoices(); });
  }
  syncMainChoices();
  showScreen("setup");
}

function renderSeg(containerId, choices, selId, onPick) {
  const el = $(containerId);
  el.innerHTML = "";
  for (const ref of choices) {
    const b = document.createElement("button");
    b.textContent = ref.name;
    if (ref.id === selId) b.classList.add("sel");
    b.addEventListener("click", () => {
      [...el.children].forEach((c) => c.classList.remove("sel"));
      b.classList.add("sel");
      onPick(ref);
    });
    el.appendChild(b);
  }
}

// 主役候補は「対局に出る人間側」。CPU戦は人間が主役固定。
function syncMainChoices() {
  const players = setup.mode === "cpu"
    ? [setup.black]
    : [setup.black, setup.white];
  const humans = players.filter((p) => p.kind !== "cpu");
  if (!humans.find((h) => h.id === setup.mainId)) setup.mainId = humans[0]?.id ?? setup.black.id;
  renderSeg("seg-main", humans, setup.mainId, (ref) => { setup.mainId = ref.id; });
  $("field-main").style.display = setup.mode === "cpu" ? "none" : "";
}

$("seg-level").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  [...$("seg-level").children].forEach((c) => c.classList.remove("sel"));
  b.classList.add("sel");
  setup.level = parseInt(b.dataset.level, 10);
  setup.white = cpuRef(setup.level);
});
$("opt-hints").addEventListener("change", (e) => { setup.hints = e.target.checked; });

$("start-game").addEventListener("click", () => {
  const assignment = { black: setup.black, white: setup.white };
  // CPU戦は人間が主役。2人戦は選んだmainId。
  const mainRef = setup.mode === "cpu" ? setup.black
    : (assignment.black.id === setup.mainId ? assignment.black : assignment.white);
  const mainColor = assignment.black.id === mainRef.id ? BLACK : WHITE;
  startMatch({ assignment, mainColor, mode: setup.mode, level: setup.level, hints: setup.hints });
});

// ============ 対局 ============
function startMatch(cfg) {
  clearTimeout(cpuTimerId); // 古いCPUタイマーを破棄（連打・再戦時の二重着手防止）
  cpuTimerId = null;
  busy = false;
  match = { ...cfg, startedAt: Date.now(), moves: [] };
  state = newGame(BLACK);
  if (!view) {
    view = createBoardView($("board3d"), onCell);
    if (location.search.includes("slow")) window.__view = view; // デバッグ用
  }
  $("snd-bgm").checked = audio.isBgmEnabled();
  $("snd-sfx").checked = audio.isSfxEnabled();
  showScreen("game");
  view.sync(state, match.hints);
  renderPanels();
  audio.startBgm(bgmState(state.board));
  updateMessage();
  maybeCpuTurn();
}

function refForColor(color) {
  return color === BLACK ? match.assignment.black : match.assignment.white;
}

function renderPanels() {
  const mainColor = match.mainColor;
  // bottom = 主役、top = 相手（相手側は180°反転して向かいから読める）
  fillPanel($("panel-bottom"), mainColor, true);
  fillPanel($("panel-top"), mainColor === BLACK ? WHITE : BLACK, false);
}

function fillPanel(el, color, isMain) {
  const ref = refForColor(color);
  const isTurn = !state.over && state.current === color;
  el.className = "panel-player"
    + (isMain ? " main" : " dim")
    + (isTurn ? " turn" : "")
    + (isMain ? "" : " flip");
  el.innerHTML = `
    <div class="pp-left">
      <span class="disc-mini ${color === BLACK ? "black" : "white"}"></span>
      <span class="pp-name">${escapeHtml(ref.name)}${isMain ? '<span class="badge-main">★主役</span>' : ""}</span>
    </div>
    <span class="pp-count">${count(state.board, color)}</span>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function updateMessage() {
  const msg = $("message");
  if (state.over) { msg.textContent = "対局終了"; return; }
  if (state.passed) {
    msg.textContent = `${refForColor(state.current === BLACK ? WHITE : BLACK).name}は打てずパス`;
    return;
  }
  msg.textContent = `${refForColor(state.current).name}（${state.current === BLACK ? "黒" : "白"}）の番`;
}

function isCpuTurn() {
  return !state.over && refForColor(state.current).kind === "cpu";
}

async function onCell(r, c) {
  if (busy || state.over || isCpuTurn()) return;
  await doMove(r, c);
  maybeCpuTurn();
}

async function doMove(r, c) {
  const before = state;
  const next = play(state, r, c);
  if (next === before) return; // 非合法
  busy = true;
  view.clearHints();

  const color = state.current;
  const flippedCount = count(next.board, color) - count(state.board, color) - 1;
  match.moves.push({ r, c });
  audio.playPlace();

  await view.animateMove(state.board, next.board, { r, c }, color, (i) => audio.playFlip(i));

  const prev = state;
  state = next;

  // パスが起きていたら棋譜にも記録
  if (state.passed) match.moves.push({ pass: true });

  // 局面に応じてBGM切替（2段階：通常/終盤接戦/終盤一方的）
  audio.setBgm(bgmState(state.board));
  // スポット演出はR4でシーン内に実装。判定だけ算出しておく。
  const tags = detectEvents(prev, state, { r, c }, flippedCount, match.mainColor);
  for (const tag of tags) audio.playEvent(tag); // 演出音（ビジュアルはR4でview側に）
  if (view.applyEffects) view.applyEffects(tags, { r, c, flippedCount, color });

  view.renderHints(state, match.hints);
  renderPanels();
  updateMessage();
  busy = false;

  if (state.over) finishGame();
}

function maybeCpuTurn() {
  if (!isCpuTurn() || state.over) return;
  busy = true;
  cpuTimerId = setTimeout(async () => {
    cpuTimerId = null;
    const mv = chooseCpuMove(state.board, state.current, match.level);
    busy = false;
    if (mv) {
      await doMove(mv[0], mv[1]);
      maybeCpuTurn();
    }
  }, 500);
}

async function finishGame() {
  audio.stopBgm();
  const res = gameResult(state);
  if (shouldRecord(match.assignment)) {
    const record = {
      date: new Date(match.startedAt).toISOString(),
      mode: match.mode,
      level: match.mode === "cpu" ? match.level : null,
      hints: match.hints,
      durationMs: Date.now() - match.startedAt,
      black: match.assignment.black,
      white: match.assignment.white,
      result: {
        winner: res.winner === BLACK ? "black" : res.winner === WHITE ? "white" : "draw",
        black: res.black, white: res.white,
      },
      kifu: kifuFromMoves(match.moves),
    };
    try { await addGame(record); } catch (e) { console.warn("記録失敗", e); }
  }
  setTimeout(() => showResult(res), 900);
}

function showResult(res) {
  const mainColor = match.mainColor;
  const mainCount = mainColor === BLACK ? res.black : res.white;
  const oppCount = mainColor === BLACK ? res.white : res.black;
  const rt = $("result-text");
  if (res.winner === BLACK || res.winner === WHITE) {
    const mainWon = (res.winner === mainColor);
    const winnerRef = refForColor(res.winner);
    rt.textContent = match.mode === "cpu"
      ? (mainWon ? "あなたの勝ち！" : "CPUの勝ち")
      : `${winnerRef.name}の勝ち！`;
  } else {
    rt.textContent = "引き分け";
  }
  $("result-score").textContent = `黒 ${res.black} 対 白 ${res.white}`;
  $("overlay-result").classList.add("active");
}

// もう一回：設定維持・先攻後攻を入替（主役の色も追従）
$("rematch").addEventListener("click", () => {
  $("overlay-result").classList.remove("active");
  // 同じ主役を維持したまま黒白を入れ替える（先攻後攻を公平に回す）
  const mainRef = refForColor(match.mainColor);
  const assignment = swapColors(match.assignment);
  const mainColor = assignment.black.id === mainRef.id ? BLACK : WHITE;
  startMatch({ ...match, assignment, mainColor });
});
$("to-menu").addEventListener("click", () => {
  $("overlay-result").classList.remove("active");
  showScreen("menu");
});
$("btn-quit").addEventListener("click", () => {
  clearTimeout(cpuTimerId); cpuTimerId = null; busy = false;
  audio.stopBgm(); showScreen("menu");
});
$("btn-restart").addEventListener("click", () => startMatch(match));
$("btn-undo").addEventListener("click", async () => {
  if (busy || !state) return;
  // CPU戦は自分が打つ直前まで戻す（CPUの手も巻き戻す）
  do { state = undo(state); } while (
    match.mode === "cpu" && !state.over && refForColor(state.current).kind === "cpu" && state.history.length
  );
  // 棋譜も巻き戻し（簡易：末尾を落とす）
  match.moves = match.moves.slice(0, state.history.length);
  view.sync(state, match.hints);
  renderPanels();
  updateMessage();
  audio.setBgm(bgmState(state.board));
});
$("snd-bgm").addEventListener("change", (e) => {
  audio.setBgmEnabled(e.target.checked);
  if (e.target.checked && state && !state.over) audio.startBgm(bgmState(state.board)); else audio.stopBgm();
});
$("snd-sfx").addEventListener("change", (e) => audio.setSfxEnabled(e.target.checked));

// ============ 戦績 ============
async function openStats() {
  const games = await listGames();
  profiles = await listProfiles();
  const body = $("stats-body");
  body.innerHTML = "";
  if (profiles.length === 0) {
    body.innerHTML = '<div class="empty-note">登録プロフィールがありません。プロフィールを登録すると戦績が貯まります。</div>';
  }
  for (const p of profiles) {
    const s = statsForUser(games, p.id);
    const block = document.createElement("div");
    block.className = "stat-block";
    block.innerHTML = `
      <h3>${escapeHtml(p.name)}</h3>
      <div class="stat-grid">
        <div><div class="k">対局</div><div class="v">${s.total.games}</div></div>
        <div><div class="k">勝率</div><div class="v">${s.total.winRate}%</div></div>
        <div><div class="k">勝-負-分</div><div class="v">${s.total.wins}-${s.total.losses}-${s.total.draws}</div></div>
        <div><div class="k">先攻(黒)勝率</div><div class="v">${s.asBlack.winRate}%</div></div>
        <div><div class="k">後攻(白)勝率</div><div class="v">${s.asWhite.winRate}%</div></div>
        <div><div class="k">先/後 局数</div><div class="v">${s.asBlack.games}/${s.asWhite.games}</div></div>
      </div>`;
    body.appendChild(block);
  }
  if (profiles.length === 2) {
    const h = headToHead(games, profiles[0].id, profiles[1].id);
    const block = document.createElement("div");
    block.className = "stat-block";
    block.innerHTML = `<h3>直接対決</h3>
      <div class="stat-grid">
        <div><div class="k">${escapeHtml(profiles[0].name)}</div><div class="v">${h.winsA}</div></div>
        <div><div class="k">引分</div><div class="v">${h.draws}</div></div>
        <div><div class="k">${escapeHtml(profiles[1].name)}</div><div class="v">${h.winsB}</div></div>
      </div>`;
    body.appendChild(block);
  }
  showScreen("stats");
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export-csv").addEventListener("click", async () => {
  const games = await listGames();
  download("reversi_games.csv", buildCSV(games), "text/csv");
});
$("export-json").addEventListener("click", async () => {
  const games = await listGames();
  download("reversi_games.json", buildJSON(games), "application/json");
});

// ============ プロフィール ============
async function openProfiles() {
  profiles = await listProfiles();
  const body = $("profiles-body");
  body.innerHTML = "";
  profiles.forEach((p) => {
    const row = document.createElement("div");
    row.className = "prof-row";
    row.innerHTML = `<input type="text" maxlength="20" value="${escapeHtml(p.name)}"><button class="btn-sub" style="width:auto">保存</button><button class="btn-sub" style="width:auto">削除</button>`;
    const [input, saveBtn, delBtn] = [row.querySelector("input"), ...row.querySelectorAll("button")];
    saveBtn.addEventListener("click", async () => { await updateProfile(p.id, input.value.trim() || p.name); openProfiles(); });
    delBtn.addEventListener("click", async () => { await deleteProfile(p.id); openProfiles(); });
    body.appendChild(row);
  });
  if (profiles.length < MAX_PROFILES) {
    const row = document.createElement("div");
    row.className = "prof-row";
    row.innerHTML = `<input type="text" maxlength="20" placeholder="新しい名前"><button class="btn-primary" style="width:auto">追加</button>`;
    const input = row.querySelector("input");
    row.querySelector("button").addEventListener("click", async () => {
      const name = input.value.trim();
      if (!name) return;
      try { await addProfile(name); openProfiles(); } catch (e) { alert(e.message); }
    });
    body.appendChild(row);
  } else {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = `登録は最大${MAX_PROFILES}人です。`;
    body.appendChild(note);
  }
  showScreen("profiles");
}

showScreen("menu");
