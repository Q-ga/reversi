// アプリ全体の配線：画面遷移／対局進行／CPU／音／演出／記録／戦績。
import { BLACK, WHITE, count } from "./rules.js";
import { newGame, play, undo, gameResult } from "./game.js";
import { chooseCpuMove } from "./evaluate.js";
import { bgmState } from "./bgm.js";
import { createBoardView } from "./render3d.js";
import { detectEvents } from "./events.js";
import { kifuFromMoves } from "./notation.js";
import { swapColors, shouldRecord, cpuAssignment } from "./match.js";
import { statsForUser, headToHead } from "./stats.js";
import { buildCSV, buildJSON } from "./exporter.js";
import * as audio from "./audio.js";
import { loadSettings, saveSettings } from "./settings.js";
import { registry, isDebugMode } from "./variants.js";
import { registerStoneThemes, resolveStoneVariants } from "./theme_stone.js";
import { mountDebugPanel } from "./debugpanel.js";
import { watchReducedMotion } from "./motion.js";
import {
  listProfiles, addProfile, updateProfile, deleteProfile, addGame, listGames, MAX_PROFILES,
} from "./storage.js";

const GUEST = { kind: "guest", id: "guest", name: "ゲスト" };
const cpuRef = (level) => ({ kind: "cpu", id: "cpu", name: `CPU（${["", "かんたん", "ふつう", "つよい"][level]}）` });

// --- アプリ状態 ---
let profiles = [];
let setup = { mode: "2p", black: null, white: null, level: 2, hints: true, playerFirst: true };
let match = null; // { assignment, mode, level, hints, startedAt, moves }
let state = null;
let view = null; // three.jsの盤ビュー（初回startMatchで生成し再利用）
let appSettings = loadSettings(); // 永続化された設定（音量・ミュート・エフェクト演出）。doMove等から参照
// 酔い対策：OSの「視差効果を減らす」(prefers-reduced-motion: reduce)を検知し、シェイク・ジッタ等の
// 動きの強い演出を自動抑制する。変更イベントにも追随（盤ビューがあれば即反映、無ければ次のstartMatchで反映）。
// エフェクト演出トグルとは独立した軸で、appSettings.effectsOn は書き換えない。
let osReducedMotion = watchReducedMotion((m) => {
  osReducedMotion = m;
  if (view) view.setReducedMotion(m);
});
let busy = false;
let cpuTimerId = null;
let hintTimerId = null;       // 合法手ヒントの表示を少し遅らせるためのタイマー
const HINT_DELAY = 420;       // 着手アニメ後、余韻を置いてからヒントを出す（ms）

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
  const isCpu = setup.mode === "cpu";
  $("setup-title").textContent = isCpu ? "CPUと対戦" : "2人で対戦";
  $("field-level").style.display = isCpu ? "" : "none";
  $("field-turn").style.display = isCpu ? "" : "none";
  // CPU戦は黒/白固定でなく「あなた＝人間」＋手番トグルで決めるのでラベルを変える
  $("label-black").innerHTML = isCpu
    ? "あなた"
    : '黒（先攻）<span class="disc-mini black" style="display:inline-block;vertical-align:middle;width:16px;height:16px;margin-left:4px"></span>';

  // 選択候補：登録ユーザー＋ゲスト
  const humanChoices = [...profiles.map((p) => ({ kind: "user", id: p.id, name: p.name })), GUEST];

  // 既定値。CPU戦では setup.black に「人間プレイヤー」を保持し、黒白の割当ては開始時に手番で決める。
  setup.black = humanChoices[0];
  setup.white = isCpu ? cpuRef(setup.level) : (humanChoices[1] || GUEST);
  setup.playerFirst = true;

  renderSeg("seg-black", humanChoices, setup.black.id, (ref) => { setup.black = ref; });
  if (isCpu) {
    $("field-white").style.display = "none";
    syncTurnSeg();
  } else {
    $("field-white").style.display = "";
    renderSeg("seg-white", humanChoices, setup.white.id, (ref) => { setup.white = ref; });
  }
  showScreen("setup");
}

// 手番トグル（先攻/後攻）の選択表示を setup.playerFirst に同期する。
function syncTurnSeg() {
  const seg = $("seg-turn");
  [...seg.children].forEach((b) => b.classList.toggle("sel", (b.dataset.first === "1") === setup.playerFirst));
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

$("seg-level").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  [...$("seg-level").children].forEach((c) => c.classList.remove("sel"));
  b.classList.add("sel");
  setup.level = parseInt(b.dataset.level, 10);
  setup.white = cpuRef(setup.level);
});
$("opt-hints").addEventListener("change", (e) => { setup.hints = e.target.checked; });

// 手番トグル（CPU戦のみ表示）。先攻＝あなたが黒、後攻＝CPUが黒で先に打つ。
$("seg-turn").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  setup.playerFirst = b.dataset.first === "1";
  syncTurnSeg();
});

$("start-game").addEventListener("click", () => {
  const assignment = setup.mode === "cpu"
    ? cpuAssignment(setup.black, cpuRef(setup.level), setup.playerFirst) // setup.black=選んだ人間
    : { black: setup.black, white: setup.white };
  startMatch({ assignment, mode: setup.mode, level: setup.level, hints: setup.hints });
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
    // 石マテリアルの比較ビルド（issue #9）：URLで選択中のバリアントを盤ビューへ適用
    view.setStoneMaterialVariants(resolveStoneVariants(registry, variantSelection));
    if (location.search.includes("slow")) window.__view = view; // デバッグ用
  }
  view.setEffectsEnabled(appSettings.effectsOn); // 設定のエフェクト演出ON/OFFを反映
  view.setReducedMotion(osReducedMotion);        // OSの酔い対策設定を反映（トグルとは独立）
  view.setBoardBrightness(appSettings.boardBrightness); // 設定の盤面の明るさを露出へ反映
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
  // 対面プレイ前提：下＝黒(先攻)、上＝白(後攻・向かいから読めるよう180°反転)
  fillPanel($("panel-bottom"), BLACK, false);
  fillPanel($("panel-top"), WHITE, true);
}

function fillPanel(el, color, flip) {
  const ref = refForColor(color);
  const isTurn = !state.over && state.current === color;
  el.className = "panel-player" + (isTurn ? " turn" : "") + (flip ? " flip" : "");
  el.innerHTML = `
    <div class="pp-left">
      <span class="disc-mini ${color === BLACK ? "black" : "white"}"></span>
      <span class="pp-name">${escapeHtml(ref.name)}</span>
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

// パス告知バナーを中央に表示する。約1.2秒で自動的に消え、タップで即スキップ。
// doMove から await されるため、バナーが消えてから次の手番（人の操作受付 or CPU着手）に進む。
const PASS_HOLD_MS = 800;   // 保持時間（前後のフェード0.22秒ずつを加えて体感約1.2秒）
const PASS_FADE_MS = 240;
function showPassBanner(name, colorLabel) {
  return new Promise((resolve) => {
    const el = $("pass-banner");
    if (!el) { resolve(); return; }
    $("pass-sub").textContent = `${name}（${colorLabel}）は打てる場所がありません`;
    el.classList.add("show");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(holdTimer);
      el.removeEventListener("click", finish);
      el.classList.remove("show");
      setTimeout(resolve, PASS_FADE_MS); // フェードアウトの分だけ待ってから次へ
    };
    el.addEventListener("click", finish); // タップで即スキップ
    const holdTimer = setTimeout(finish, PASS_HOLD_MS);
  });
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
  // 入力ロック(busy)は何が起きても必ず解除する。アニメのreject や音声(Web Audio)の
  // 例外がここを貫通すると busy が true のまま固着し、合法手があっても盤が無反応になる
  // （＝過去のフリーズの真因）。try/finally で確実に解放し、音声はゲーム進行をブロックさせない。
  try {
    clearTimeout(hintTimerId);
    view.clearHints();

    const color = state.current;
    const flippedCount = count(next.board, color) - count(state.board, color) - 1;
    match.moves.push({ r, c });

    // ① 着手の溜め／② めくりの号砲／④ 角ヒットストップは、すべてアニメ側の
    // タイミングに音・光を同期させる（コールバックで発火）。
    const isCorner = (r === 0 || r === 7) && (c === 0 || c === 7);
    const isBig = flippedCount >= 5; // 大量返し（events.jsのbigFlip閾値と一致）
    await view.animateMove(state.board, next.board, { r, c }, color, {
      onAppear: () => audio.playAppear(),              // 出現（フッ・極小）
      onLand: () => audio.playPlace(),                 // 着地（コツ・主役）
      onFlipLift: () => audio.playFlipLift(),          // 号砲の持ち上げ（スッ）
      onFlipLand: (i) => audio.playFlipLand(i),        // 各めくりの着地（コツ・連鎖で上昇）
      isBig,
      // ④ 角／大量返しは着地でフリーズし、光＋音を先に出してからめくる
      onImpact: () => {
        if (isCorner) { audio.playEvent("corner"); view.applyEffects(["corner"], { r, c }); }
        else if (isBig) { audio.playEvent("bigFlip"); view.applyEffects(["bigFlip"], { r, c, flippedCount, color }); }
      },
    });

    const prev = state;
    state = next;

    // パスが起きていたら棋譜にも記録
    if (state.passed) match.moves.push({ pass: true });

    // 局面に応じてBGM切替（2段階：通常/終盤）
    audio.setBgm(bgmState(state.board));
    // スポット演出。角(corner)・大量返し(bigFlip)はエフェクト演出ON時のみアニメ中のonImpactで
    // 音・光が発火済みなので除外する。OFF時はonImpactが呼ばれないため、ここで効果音を鳴らす
    // （光はapplyEffectsがOFF時no-opなので出ない）。効果音はエフェクト演出設定に依らず効果音設定に従う。
    const tags = detectEvents(prev, state, { r, c }, flippedCount);
    const handledInAnim = new Set();
    if (appSettings.effectsOn && isCorner) handledInAnim.add("corner");
    if (appSettings.effectsOn && isBig) handledInAnim.add("bigFlip");
    for (const tag of tags) { if (handledInAnim.has(tag)) continue; audio.playEvent(tag); }
    view.applyEffects(tags.filter((t) => !handledInAnim.has(t)), { r, c, flippedCount, color });

    // 余韻を置いてからヒントを出す（着手直後に光らせない）
    hintTimerId = setTimeout(() => view.renderHints(state, match.hints), HINT_DELAY);
    renderPanels();
    updateMessage();

    // パスが起きたら中央に大きく告知（誰が打てずパスしたか）。バナーが消えるまで次手は待つ。
    if (state.passed) {
      const passedColor = state.current === BLACK ? WHITE : BLACK; // パスしたのは手番が戻った側の相手
      await showPassBanner(refForColor(passedColor).name, passedColor === BLACK ? "黒" : "白");
    }
  } catch (e) {
    // 音声・描画の想定外失敗でゲームを止めない。状態は更新済み（or未更新）でも操作は継続可能。
    console.warn("doMove 中に例外（無視して進行）", e);
  } finally {
    busy = false;
  }

  if (state.over) { try { finishGame(); } catch (e) { console.warn("finishGame 失敗", e); } }
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
  const rt = $("result-text");
  if (res.winner === BLACK || res.winner === WHITE) {
    const winnerRef = refForColor(res.winner);
    rt.textContent = match.mode === "cpu"
      ? (winnerRef.kind !== "cpu" ? "あなたの勝ち！" : "CPUの勝ち")
      : `${winnerRef.name}の勝ち！`;
  } else {
    rt.textContent = "引き分け";
  }
  $("result-score").textContent = `黒 ${res.black} 対 白 ${res.white}`;
  // 再戦ボタンの出し分け：CPU戦は「もう一回」、2人戦は「入れ替えて再戦／そのまま再戦」
  const isCpu = match.mode === "cpu";
  $("rematch").style.display = isCpu ? "" : "none";
  $("rematch-swap").style.display = isCpu ? "none" : "";
  $("rematch-same").style.display = isCpu ? "none" : "";
  $("overlay-result").classList.add("active");
}

// 再戦：設定維持で割り当てだけ差し替える。
// CPU戦＝「もう一回」（手番据え置き）。2人戦＝「入れ替えて再戦」/「そのまま再戦」を選択。
function rematchWith(assignment) {
  $("overlay-result").classList.remove("active");
  startMatch({ ...match, assignment });
}
$("rematch").addEventListener("click", () => rematchWith(match.assignment));               // CPU戦：据え置き
$("rematch-swap").addEventListener("click", () => rematchWith(swapColors(match.assignment))); // 2人戦：先攻後攻入替
$("rematch-same").addEventListener("click", () => rematchWith(match.assignment));            // 2人戦：そのまま
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
  clearTimeout(hintTimerId);
  view.sync(state, match.hints);
  renderPanels();
  updateMessage();
  audio.setBgm(bgmState(state.board));
});
// ============ 設定（音量・ミュート・エフェクト演出）============
// ロード済みの appSettings（先頭で宣言）を音声・盤ビュー・モーダルUIに反映する。状態は不変更新で持つ。
const pct = (v) => `${Math.round(v * 100)}%`;

function syncSettingsUI() {
  $("set-bgm-on").checked = appSettings.bgmOn;
  $("set-sfx-on").checked = appSettings.sfxOn;
  $("set-effects-on").checked = appSettings.effectsOn;
  $("set-bgm-vol").value = Math.round(appSettings.bgmVol * 100);
  $("set-sfx-vol").value = Math.round(appSettings.sfxVol * 100);
  $("set-bgm-val").textContent = pct(appSettings.bgmVol);
  $("set-sfx-val").textContent = pct(appSettings.sfxVol);
  $("set-board-bright").value = Math.round(appSettings.boardBrightness * 100);
  $("set-board-bright-val").textContent = pct(appSettings.boardBrightness);
}
// 音声へ反映（init前でも内部値だけ更新され、init時に初期ゲインへ反映される）
audio.setBgmEnabled(appSettings.bgmOn);
audio.setSfxEnabled(appSettings.sfxOn);
audio.setBgmVolume(appSettings.bgmVol);
audio.setSfxVolume(appSettings.sfxVol);
syncSettingsUI();

const persist = () => saveSettings(appSettings);

// モーダル開閉（歯車で開く・閉じる/外側タップで閉じる）
$("gear-btn").addEventListener("click", () => { syncSettingsUI(); $("overlay-settings").classList.add("active"); });
$("settings-close").addEventListener("click", () => $("overlay-settings").classList.remove("active"));
$("overlay-settings").addEventListener("click", (e) => {
  if (e.target === $("overlay-settings")) $("overlay-settings").classList.remove("active");
});

// BGMミュート：切替時に再生/停止も行う（対局中のみ再開）
$("set-bgm-on").addEventListener("change", (e) => {
  const on = e.target.checked;
  appSettings = { ...appSettings, bgmOn: on };
  audio.setBgmEnabled(on);
  if (on && state && !state.over) audio.startBgm(bgmState(state.board)); else if (!on) audio.stopBgm();
  persist();
});
$("set-sfx-on").addEventListener("change", (e) => {
  appSettings = { ...appSettings, sfxOn: e.target.checked };
  audio.setSfxEnabled(e.target.checked);
  persist();
});
// 音量スライダー：ドラッグ中(input)は即時反映、確定(change)で保存（localStorage連打を避ける）
$("set-bgm-vol").addEventListener("input", (e) => {
  const v = e.target.value / 100;
  appSettings = { ...appSettings, bgmVol: v };
  audio.setBgmVolume(v);
  $("set-bgm-val").textContent = pct(v);
});
$("set-bgm-vol").addEventListener("change", persist);
$("set-sfx-vol").addEventListener("input", (e) => {
  const v = e.target.value / 100;
  appSettings = { ...appSettings, sfxVol: v };
  audio.setSfxVolume(v);
  $("set-sfx-val").textContent = pct(v);
});
$("set-sfx-vol").addEventListener("change", persist);
// 盤面の明るさスライダー：ドラッグ中(input)は露出へ即時反映、確定(change)で保存
$("set-board-bright").addEventListener("input", (e) => {
  const v = e.target.value / 100;
  appSettings = { ...appSettings, boardBrightness: v };
  if (view) view.setBoardBrightness(v); // 盤ビュー未生成なら次のstartMatchで反映
  $("set-board-bright-val").textContent = pct(v);
});
$("set-board-bright").addEventListener("change", persist);
// エフェクト演出：盤ビューがあれば即反映（無ければ次のstartMatchで反映）
$("set-effects-on").addEventListener("change", (e) => {
  appSettings = { ...appSettings, effectsOn: e.target.checked };
  if (view) view.setEffectsEnabled(e.target.checked);
  persist();
});

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
  // 直接対決：登録が2人以上なら、2人を選んでその対戦成績を表示
  if (profiles.length >= 2) {
    const block = document.createElement("div");
    block.className = "stat-block";
    const opts = profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    block.innerHTML = `<h3>直接対決</h3>
      <div class="h2h-pick">
        <select id="h2h-a">${opts}</select>
        <span class="h2h-x">×</span>
        <select id="h2h-b">${opts}</select>
      </div>
      <div id="h2h-result"></div>`;
    body.appendChild(block);
    const selA = block.querySelector("#h2h-a"), selB = block.querySelector("#h2h-b");
    selB.selectedIndex = 1; // 既定で別の2人
    const renderH2H = () => {
      const idA = selA.value, idB = selB.value;
      const out = block.querySelector("#h2h-result");
      if (idA === idB) { out.innerHTML = '<div class="empty-note">違う2人を選んでください</div>'; return; }
      const h = headToHead(games, idA, idB);
      const nameA = profiles.find((p) => p.id === idA).name;
      const nameB = profiles.find((p) => p.id === idB).name;
      out.innerHTML = `<div class="stat-grid">
        <div><div class="k">${escapeHtml(nameA)}</div><div class="v">${h.winsA}</div></div>
        <div><div class="k">引分</div><div class="v">${h.draws}</div></div>
        <div><div class="k">${escapeHtml(nameB)}</div><div class="v">${h.winsB}</div></div>
      </div>
      <div class="empty-note">対戦数 ${h.games}</div>`;
    };
    selA.addEventListener("change", renderH2H);
    selB.addEventListener("change", renderH2H);
    renderH2H();
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

// ============ 比較ビルド（バリアント切替・CONTEXT.md「開発・検収」）============
// クラフトの検収用。後続のクラフト・パス（着石音/めくり音/終局音/石マテリアル/めくりタイミング）は
// ここで registry.register によりテーマを登録し、registry.variantOf(テーマID, variantSelection) で
// 選択中バリアント（実装値ごと）を取り出して適用する。
// ダミーテーマ：登録→URL指定→適用の通し確認用。html要素のdata属性へ書くだけで、
// 通常プレイの見た目・挙動には一切影響しない（CSS等からの参照なし）。
registry.register({
  id: "demo",
  label: "ダミー（検収用）",
  defaultId: "a",
  variants: [
    { id: "a", label: "案A（既定）" },
    { id: "b", label: "案B" },
  ],
});
// 石マテリアル（黒=漆黒クリアコート系／白=パール・磁器系）。定義は theme_stone.js（issue #9）
registerStoneThemes(registry);
const variantSelection = registry.resolve(location.search);
document.documentElement.dataset.variantDemo = variantSelection.demo;
// 切替パネルは ?debug=1 のときだけ生成する（フラグ無しではDOMに存在しない）
if (isDebugMode(location.search)) {
  mountDebugPanel(registry, variantSelection);
}

showScreen("menu");
