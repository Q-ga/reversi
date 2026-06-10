// 終局音バリアントのE2E検証（issue #8）：?debug=1 の実機通しで「終局まで打って音が切り替わる」を確認する。
//   ①?debug=1 でパネルに「終局音」テーマ（3案）が出る・既定は classic
//   ②既定のまま終局（最短完封9手・黒13-0）→ 現状音 fanfare_win が gameover＋shutout で2回鳴る
//   ③パネルで案B(royal)へ切替 → URL更新＆リロード → 終局で royal の勝利音＋完封レイヤーが鳴り、現状音は鳴らない
//   ④URL直接指定で案C(orchestra) → 終局で orchestra の勝利音＋完封レイヤーが鳴る
// 再生音の識別は AudioBufferSourceNode.start をフックし AudioBuffer の長さ（秒）で行う
// （gen-audio.mjs 側で案ごとにバッファ長を変えてある）。
// 教訓の反映：使い捨てプロファイル(mkdtemp)＋終了待ち後に削除／接続先ガード／
// ポートは本エージェント専用（devserver相当=8778・CDP=9236）で他エージェントと衝突させない。
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HTTP_PORT = 8778;
const CDP_PORT = 9236;
const BASE = `http://localhost:${HTTP_PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 再生音の識別表：AudioBuffer長（秒・小数2桁丸め）→ 期待音源。gen-audio.mjs のバッファ長と一致させる。
const DUR = {
  fanfare_win: 1.4,
  fanfare_win_royal: 3.2, fanfare_shutout_royal: 3.0,
  fanfare_win_orch: 3.4, fanfare_shutout_orch: 3.1,
};

// 内蔵静的サーバ（check-variants.mjs と同じ no-store 方式・本worktreeのROOTを配信）
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".wav": "audio/wav", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml",
};
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const fp = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ""));
  try {
    const data = await readFile(fp);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Content-Type", TYPES[extname(fp)] || "application/octet-stream");
    res.end(data);
  } catch { res.statusCode = 404; res.end("not found"); }
});
server.on("error", (e) => { console.error(`ポート${HTTP_PORT}でサーバ起動失敗（占有中？）:`, e.message); process.exit(1); });
server.listen(HTTP_PORT);

// プロファイルは実行ごとに使い捨て（前回実行のlocalStorage持ち越しによる偽陽性/偽陰性を防ぐ）
const PROFILE = mkdtempSync(join(tmpdir(), "cdp-reversi-gameover-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run", "--autoplay-policy=no-user-gesture-required",
  `--user-data-dir=${PROFILE}`, "--window-size=900,1500",
  "about:blank"], { stdio: "ignore" });

async function wsUrl() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://localhost:${CDP_PORT}/json`); const l = await r.json();
    const p = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error("no target");
}
function cdp(w) { let id = 0; const p = new Map();
  w.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
  return (method, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); w.send(JSON.stringify({ id: i, method, params })); }); }
const evalIn = async (send, expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log("EXC:", JSON.stringify(r.result.exceptionDetails.exception));
  return r.result?.result?.value;
};

// AudioBufferSourceNode.start をフックして、再生されたバッファの長さ（秒・2桁丸め）を記録する。
// 新規ドキュメントごとに再注入される（Page.addScriptToEvaluateOnNewDocument）。
const HOOK = `(()=>{ window.__played = [];
  const orig = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...a){
    if (this.buffer) window.__played.push(Math.round(this.buffer.duration * 100) / 100);
    return orig.apply(this, a); };
})();`;

// パネルと終局音テーマselectの観測
const OBSERVE = `({
  url: location.href,
  panel: !!document.getElementById('variant-panel'),
  go: (()=>{ const s = document.querySelector('#variant-panel select[data-theme="gameoverSound"]');
       return s ? { value: s.value, options: [...s.options].map(o=>o.value) } : null; })(),
})`;

// 2人対戦を開始し、最短完封の既知手順（黒13-0・9手：e6 f4 e3 f6 g5 d6 e7 f5 c5）で終局まで打つ。
// 戻り値: { over, played } — over=結果オーバーレイ表示、played=フックが記録した再生音の長さ一覧。
const PLAY_SHUTOUT = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  document.querySelector('[data-mode="2p"]').click(); await sleep(150);
  document.getElementById('start-game').click(); await sleep(1000);
  const v=window.__view; if(!v) return { error: 'no __view（?slow=1 が必要）' };
  const T=v.THREE;
  const click=(r,c)=>{ const {x,z}=v.cellToWorld(r,c);
    const p=new T.Vector3(x,v.STONE_H/2,z).project(v.camera);
    const rect=v.renderer.domElement.getBoundingClientRect();
    v.renderer.domElement.dispatchEvent(new MouseEvent('click',{
      clientX:rect.left+(p.x*0.5+0.5)*rect.width, clientY:rect.top+(-p.y*0.5+0.5)*rect.height, bubbles:true})); };
  const seq=['e6','f4','e3','f6','g5','d6','e7','f5','c5'];
  for(const mv of seq){
    const c=mv.charCodeAt(0)-97, r=Number(mv[1])-1;
    const before=v.stoneMap.size;
    let ok=false;
    for(let t=0;t<40 && !ok;t++){ click(r,c); await sleep(400); if(v.stoneMap.size>before) ok=true; }
    if(!ok) return { error:'打てない: '+mv, played: window.__played };
    await sleep(2400); // めくり連鎖＋演出の完了待ち
  }
  let over=false;
  for(let t=0;t<40;t++){ await sleep(300);
    if(document.getElementById('overlay-result').classList.contains('active')){ over=true; break; } }
  await sleep(600); // 終局音の再生記録を待つ
  return { over, played: window.__played || [] };
})()`;

const count = (arr, v) => arr.filter((x) => x === v).length;

(async () => {
  const results = [];
  let failed = false;
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) failed = true; };
  try {
    // 接続先ガード：配信中のコードが本ブランチ（終局音テーマ入り）であることを確認してから測る
    const mainSrc = await fetch(`${BASE}/src/main.js`).then((r) => r.text()).catch(() => "");
    if (!mainSrc.includes("registerGameoverTheme")) {
      throw new Error(`接続先 ${BASE} が本ブランチのコードを配信していません（ポート${HTTP_PORT}を他プロセスが占有？）`);
    }

    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w);
    await send("Runtime.enable"); await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
    const goto = async (url, wait = 1800) => { await send("Page.navigate", { url }); await sleep(wait); };

    // ① ?debug=1：パネルに終局音テーマ（classic/royal/orchestra）・既定はclassic
    await goto(`${BASE}/?slow=1&debug=1`);
    const r1 = await evalIn(send, OBSERVE);
    check("① パネルに終局音テーマ3案・既定classic",
      r1?.panel === true && r1?.go?.value === "classic"
      && JSON.stringify(r1?.go?.options) === JSON.stringify(["classic", "royal", "orchestra"]), r1);

    // ② 既定（現状）：終局＝完封で fanfare_win(1.4s) が gameover＋shutout の2回鳴る
    const r2 = await evalIn(send, PLAY_SHUTOUT);
    check("② 既定案：現状の fanfare_win が2回（gameover＋shutout）",
      r2?.over === true && count(r2?.played ?? [], DUR.fanfare_win) === 2, r2);

    // ③ パネルで royal へ切替 → リロード後に適用され、royal の勝利音＋完封レイヤーが鳴る
    await evalIn(send, `(()=>{ const s=document.querySelector('#variant-panel select[data-theme="gameoverSound"]');
      s.value='royal'; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    await sleep(2200); // location.assign のリロード待ち
    const r3a = await evalIn(send, OBSERVE);
    check("③a パネル切替→URL更新＆select=royal",
      r3a?.go?.value === "royal" && r3a?.url?.includes("variant=gameoverSound%3Aroyal")
      && r3a?.url?.includes("debug=1"), r3a);
    const r3b = await evalIn(send, PLAY_SHUTOUT);
    check("③b royal：勝利3.2s＋完封レイヤー3.0sが鳴り、現状音1.4sは鳴らない",
      r3b?.over === true
      && count(r3b?.played ?? [], DUR.fanfare_win_royal) === 1
      && count(r3b?.played ?? [], DUR.fanfare_shutout_royal) === 1
      && count(r3b?.played ?? [], DUR.fanfare_win) === 0, r3b);

    // ④ URL直接指定で orchestra → 勝利音＋完封レイヤーが鳴る
    await goto(`${BASE}/?slow=1&debug=1&variant=gameoverSound:orchestra`);
    const r4a = await evalIn(send, OBSERVE);
    const r4b = await evalIn(send, PLAY_SHUTOUT);
    check("④ orchestra（URL直接指定）：勝利3.4s＋完封レイヤー3.1s",
      r4a?.go?.value === "orchestra" && r4b?.over === true
      && count(r4b?.played ?? [], DUR.fanfare_win_orch) === 1
      && count(r4b?.played ?? [], DUR.fanfare_shutout_orch) === 1
      && count(r4b?.played ?? [], DUR.fanfare_win) === 0, r4b);

    console.log(JSON.stringify(results, null, 2));
    console.log(failed ? "RESULT: FAIL" : "RESULT: ALL PASS");
    w.close();
  } catch (e) { console.error("ERR", e); failed = true; } finally {
    chrome.kill();
    // kill は非同期（SIGTERM）。Chrome がプロファイルへ書き終えるのを待ってから削除する
    await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once("exit", r)));
    rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    server.close();
    process.exit(failed ? 1 : 0);
  }
})();
