// 対局演出中（着手→めくり連鎖→収束）の fps を CDP で計測し、閾値判定する検証スクリプト。
// 品質ライン「Piccolo水準の滑らかさ」を主観でなく数値で検収するためのもの（issue #5）。
//
// 使い方:
//   node scripts/check-fps.mjs [--port=8775] [--cdp-port=9231] [--threshold=55]
//   環境変数でも上書き可: REVERSI_PORT / CDP_PORT / FPS_THRESHOLD
//   devserver が対象ポートで未起動なら自動で起動し、終了時に片付ける。
//
// 仕組み:
//   ページ側に rAF のフレーム間デルタを記録する計測フックを注入する（本体コードは無変更）。
//   3シナリオ（通常手の実クリック／角＝ヒットストップ／大量返し＝5枚連鎖）で
//   着手開始→演出収束の区間だけ記録し、平均fps・最低fps・フレーム間隔の分布要点を出力する。
//   判定は全シナリオ合算の平均 fps >= 閾値（既定55）。NG なら exit 1。
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// --- 引数・環境変数 ---
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const PAGE_PORT = Number(arg("port") ?? process.env.REVERSI_PORT ?? 8775);
const CDP_PORT = Number(arg("cdp-port") ?? process.env.CDP_PORT ?? 9231);
const THRESHOLD = Number(arg("threshold") ?? process.env.FPS_THRESHOLD ?? 55);
if (![PAGE_PORT, CDP_PORT, THRESHOLD].every((n) => Number.isFinite(n) && n > 0)) {
  console.error("不正な引数です（--port / --cdp-port / --threshold は正の数値）");
  process.exit(1);
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = `http://localhost:${PAGE_PORT}/?slow=1`; // slow=1 で __view を露出しつつ実速度のまま
const JANK_MS = 33.4; // 60fps の2フレーム分超＝コマ落ちとみなす間隔
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scriptsDir = dirname(fileURLToPath(import.meta.url));

// --- devserver（未起動なら自分で立てる） ---
async function pageAlive() {
  try { return (await fetch(`http://localhost:${PAGE_PORT}/index.html`)).ok; } catch { return false; }
}
let devserver = null;
async function ensureDevserver() {
  if (await pageAlive()) return; // 既に誰かが立てている → 相乗り
  devserver = spawn(process.execPath, [join(scriptsDir, "devserver.mjs"), String(PAGE_PORT)], { stdio: "ignore" });
  for (let i = 0; i < 25; i++) { if (await pageAlive()) return; await sleep(200); }
  throw new Error(`devserver が :${PAGE_PORT} で起動しません`);
}

// --- CDP 接続（verify-cdp.mjs と同型の自作最小クライアント） ---
async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${CDP_PORT}/json`);
      const page = (await r.json()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("CDP target not found");
}
function cdp(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  return (method, params = {}) => new Promise((res) => {
    const myId = ++id; pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}
const evalIn = async (send, expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log("EXC:", JSON.stringify(r.result.exceptionDetails.exception));
  return r.result?.result?.value;
};

// --- ページ側に注入する計測フック（rAF デルタ記録。計測時のみ存在し本体コードは触らない） ---
const HOOK = `(()=>{
  let rec=null;
  const tick=(ts)=>{ if(!rec||!rec.active) return;
    if(rec.last>0) rec.deltas.push(ts-rec.last); rec.last=ts; requestAnimationFrame(tick); };
  window.__fpsHook={
    start(){ rec={deltas:[],last:0,active:true}; requestAnimationFrame(tick); },
    stop(){ if(!rec) return null; rec.active=false; const d=rec.deltas; rec=null; return d; },
  };
  return true;
})()`;

// 2人対戦を開始して __view を得る（CPUの自動着手が計測に混ざらないように 2p を使う）
const SETUP = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  window.__err=[]; addEventListener('error',e=>window.__err.push(String(e.message||e.error)));
  document.querySelector('[data-mode="2p"]').click(); await sleep(60);
  document.getElementById('start-game').click(); await sleep(400);
  return {ok: !!window.__view};
})()`;

// シナリオ1: 通常手（実クリック）。animateMove を一時ラップして着手→収束の区間だけ記録。
const SCENARIO_CLICK = `(async()=>{
  const v=window.__view; const T=v.THREE;
  const orig=v.animateMove;
  let done; const fin=new Promise(r=>done=r);
  v.animateMove=function(...a){ window.__fpsHook.start();
    const p=orig.apply(this,a);
    p.then(()=>{ window.__fpsDeltas=window.__fpsHook.stop(); v.animateMove=orig; done(); });
    return p; };
  // 合法手 (2,3) をクリック座標に投影して canvas をクリック（実際の入力経路＝音・演出込み）
  const {x,z}=v.cellToWorld(2,3);
  const p=new T.Vector3(x, v.STONE_H/2, z).project(v.camera);
  const rect=v.renderer.domElement.getBoundingClientRect();
  const px=rect.left+(p.x*0.5+0.5)*rect.width, py=rect.top+(-p.y*0.5+0.5)*rect.height;
  v.renderer.domElement.dispatchEvent(new MouseEvent('click',{clientX:px,clientY:py,bubbles:true}));
  await fin;
  return window.__fpsDeltas;
})()`;

// シナリオ2: 角着手（ヒットストップ＋ジッタ＋カメラシェイク＋角演出）。盤を合成して直接駆動。
const SCENARIO_CORNER = `(async()=>{
  const v=window.__view; const clone=b=>b.map(r=>r.slice());
  const prev=Array.from({length:8},()=>Array(8).fill(0));
  prev[3][3]=2;prev[3][4]=1;prev[4][3]=1;prev[4][4]=2; prev[0][1]=2; prev[0][2]=1;
  v.sync({board:prev,over:false,current:1},false); // めくられる石を実体化しておく
  const next=clone(prev); next[0][0]=1; next[0][1]=1;
  window.__fpsHook.start();
  await v.animateMove(prev,next,{r:0,c:0},1,{onImpact:()=>v.applyEffects(['corner'],{r:0,c:0})});
  return window.__fpsHook.stop();
})()`;

// シナリオ3: 大量返し（5枚の連鎖めくり＋効果線・パーティクル）。演出負荷が最も重いケース。
const SCENARIO_BIG = `(async()=>{
  const v=window.__view; const clone=b=>b.map(r=>r.slice());
  const prev=Array.from({length:8},()=>Array(8).fill(0));
  prev[4][7]=1; for(let c=2;c<7;c++) prev[4][c]=2;
  v.sync({board:prev,over:false,current:1},false);
  const next=clone(prev); next[4][1]=1; for(let c=2;c<7;c++) next[4][c]=1;
  window.__fpsHook.start();
  await v.animateMove(prev,next,{r:4,c:1},1,{isBig:true,onImpact:()=>v.applyEffects(['bigFlip'],{r:4,c:1})});
  return window.__fpsHook.stop();
})()`;

// --- フレーム間デルタ(ms)から統計を出す ---
function stats(deltas) {
  const n = deltas.length;
  if (n === 0) return null;
  const total = deltas.reduce((a, b) => a + b, 0);
  const sorted = [...deltas].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(n - 1, Math.floor(n * p))];
  return {
    frames: n,
    spanMs: total,
    avgFps: 1000 / (total / n),
    minFps: 1000 / sorted[n - 1],
    p50Ms: pct(0.5),
    p95Ms: pct(0.95),
    maxMs: sorted[n - 1],
    jank: deltas.filter((d) => d > JANK_MS).length,
  };
}
const f1 = (x) => x.toFixed(1);
function printStats(label, s) {
  console.log(`【${label}】`);
  console.log(`  フレーム数 ${s.frames} / 区間 ${Math.round(s.spanMs)}ms`);
  console.log(`  平均fps ${f1(s.avgFps)} / 最低fps ${f1(s.minFps)}`);
  console.log(`  フレーム間隔: p50 ${f1(s.p50Ms)}ms / p95 ${f1(s.p95Ms)}ms / 最大 ${f1(s.maxMs)}ms`
    + ` / ${JANK_MS}ms超 ${s.jank}回(${f1((s.jank / s.frames) * 100)}%)`);
}

// --- 本体 ---
let chrome = null;
let exitCode = 0;
try {
  await ensureDevserver();
  chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=/tmp/cdp-reversi-fps-${PAGE_PORT}`, "--window-size=900,1400",
    URL,
  ], { stdio: "ignore" });

  const ws = new WebSocket(await getWsUrl());
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const send = cdp(ws);
  await send("Runtime.enable"); await send("Page.enable");
  await sleep(1500); // ロード＋テクスチャ生成待ち

  const setup = await evalIn(send, SETUP);
  if (!setup?.ok) throw new Error("対局開始に失敗（__view が取れない）");
  await evalIn(send, HOOK);
  await sleep(800); // 開始直後のロードジッタが計測に混ざらないようウォームアップ

  const scenarios = [
    ["通常手（実クリック・1枚めくり）", SCENARIO_CLICK],
    ["角（ヒットストップ＋ジッタ＋カメラシェイク）", SCENARIO_CORNER],
    ["大量返し（5枚連鎖めくり＋効果線）", SCENARIO_BIG],
  ];
  console.log(`=== fps計測（対局演出中・閾値 ${THRESHOLD}fps）===`);
  const all = [];
  const perScenario = [];
  for (const [label, code] of scenarios) {
    const deltas = await evalIn(send, code);
    if (!Array.isArray(deltas) || deltas.length === 0) throw new Error(`計測失敗: ${label}`);
    const s = stats(deltas);
    printStats(label, s);
    perScenario.push({ label, avgFps: s.avgFps });
    all.push(...deltas);
    await sleep(400); // シナリオ間の小休止（残トゥイーンの収束）
  }

  const total = stats(all);
  const worst = perScenario.reduce((a, b) => (a.avgFps <= b.avgFps ? a : b));
  console.log("--- 総合 ---");
  printStats("全シナリオ合算", total);
  console.log(`最低シナリオ平均: ${f1(worst.avgFps)}fps（${worst.label}）`);

  const pass = total.avgFps >= THRESHOLD;
  console.log(`判定: ${pass ? "OK" : "NG"}（合算平均 ${f1(total.avgFps)}fps ${pass ? ">=" : "<"} 閾値 ${THRESHOLD}fps）`);
  if (!pass) exitCode = 1;

  const err = await evalIn(send, "window.__err");
  console.log("ページエラー:", err?.length ? JSON.stringify(err) : "なし");
  if (err?.length) exitCode = 1;
  ws.close();
} catch (e) {
  console.error("ERR", e);
  exitCode = 1;
} finally {
  chrome?.kill();
  devserver?.kill();
  process.exit(exitCode);
}
