// めくりタイミング・プリセット（issue #10）のE2E実測検証：
//   ① ?debug=1 のパネルに「めくりタイミング」テーマが4案で出る（既定=current）
//   ② 各プリセットで号砲所要（浮き上がり開始〜回転収束）が定義値どおり変わる（単調増加）
//   ③ どの案でも逐次めくり維持：フォロワーは先頭石より followerStart(=lift+hold) 遅れて浮く
//   ④ どの案でもイージング維持：号砲回転の1/4時点の進捗が線形(0.25)より十分小さい
//   ⑤ どの案でも着手の溜め（出現〜着地）は不変
// 固定手順：黒(2,3)→白(2,4)→黒(2,5)→白(1,4)。
//   1手目=単発めくり（先頭石(3,3)を実測）／4手目=一直線2枚（先頭(2,4)＋フォロワー(3,4)）。
// devserver(8765固定)と衝突しないよう、ポート8780の内蔵静的サーバ＋CDPポート9238を使う。
// プロファイルは mkdtemp 使い捨て＝Chrome終了待ち後に削除。
// 接続先ガード：配信 main.js に本ブランチのマーカー（FLIP_TIMING_THEME）があることを最初に確認。
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { FLIP_TIMING_THEME, leadFlipTotalMs } from "../src/theme_timing.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HTTP_PORT = 8780;
const CDP_PORT = 9238;
const BASE = `http://localhost:${HTTP_PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 内蔵静的サーバ（devserver.mjs と同じ no-store 方式）
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
}).listen(HTTP_PORT);
server.on("error", (e) => { console.error("server error:", e.message); process.exit(1); });

// 接続先ガード：配信される main.js が本ブランチの実装（マーカー）であること
async function assertMarker() {
  const text = await (await fetch(`${BASE}/src/main.js`)).text();
  if (!text.includes("FLIP_TIMING_THEME")) {
    throw new Error("配信main.jsに FLIP_TIMING_THEME が無い＝本ブランチのビルドではない");
  }
}

const profileDir = mkdtempSync(join(tmpdir(), "cdp-reversi-fliptiming-"));
let chrome = null;
function launchChrome(url) {
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run", `--user-data-dir=${profileDir}`, "--window-size=900,1500", url], { stdio: "ignore" });
}

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

// ページ内で実行：2P対局を開始し、固定手順を打ちながら石の y/rotation.z をrAFサンプリングする。
// 1手目（先頭石のみ）と4手目（先頭＋フォロワー）の生サンプルを返す。解析はnode側で行う。
const PLAY_AND_SAMPLE = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  window.__err=[]; addEventListener('error',e=>window.__err.push(String(e.message||e.error)));
  document.querySelector('[data-mode="2p"]').click(); await sleep(80);
  document.getElementById('start-game').click(); await sleep(600);
  const v=window.__view; const T=v.THREE; const rest=v.STONE_H/2;
  // 各手の完了を animateMove の解決で検知する（オブジェクトのメソッド差し替え）
  let done=0; const orig=v.animateMove;
  v.animateMove=(...a)=>orig(...a).then((r)=>{done++;return r;});
  const clickCell=(r,c)=>{ const {x,z}=v.cellToWorld(r,c);
    const p=new T.Vector3(x,rest,z).project(v.camera);
    const rect=v.renderer.domElement.getBoundingClientRect();
    const px=rect.left+(p.x*0.5+0.5)*rect.width, py=rect.top+(-p.y*0.5+0.5)*rect.height;
    v.renderer.domElement.dispatchEvent(new MouseEvent('click',{clientX:px,clientY:py,bubbles:true})); };
  // keysの石を毎フレーム記録（石が未出現の間は記録なし）
  const sample=(keys,out)=>{ let on=true;
    const tick=()=>{ const t=performance.now();
      for(const k of keys){ const e=v.stoneMap.get(k);
        if(e) out[k].push({t, y:e.group.position.y, rz:e.group.rotation.z}); }
      if(on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick); return ()=>{on=false;}; };
  const playMeasured=async(cell,keys)=>{ const out={}; for(const k of keys) out[k]=[];
    const stop=sample(keys,out); const want=done+1; clickCell(cell[0],cell[1]);
    for(let i=0;i<200 && done<want;i++) await sleep(50);
    await sleep(150); stop(); if(done<want) window.__err.push('move timeout '+cell);
    return out; };
  const playPlain=async(cell)=>{ const want=done+1; clickCell(cell[0],cell[1]);
    for(let i=0;i<200 && done<want;i++) await sleep(50); await sleep(400); };
  // 固定手順（黒(2,3)→白(2,4)→黒(2,5)→白(1,4)）
  const m1=await playMeasured([2,3],['2,3','3,3']);      // 単発：先頭(3,3)・置石(2,3)
  await sleep(500);
  await playPlain([2,4]); await playPlain([2,5]);
  const m4=await playMeasured([1,4],['1,4','2,4','3,4']); // 一直線2枚：先頭(2,4)＋フォロワー(3,4)
  return { rest, m1, m4, err:window.__err };
})()`;

// ---- node側の解析ヘルパー（サンプル列 → 時刻・所要） ----
const first = (arr, pred) => arr.find(pred);
// 浮き上がり開始＝yが静止位置から離れた最初の時刻
function liftStartT(samples, rest) {
  return first(samples, (s) => s.y > rest + 0.05)?.t ?? null;
}
// 号砲回転の解析：収束時刻＝トゥイーン完了でrzが目標値ぴったりになる最初のサンプル
// （閾値方式は ease の入り・抜けの遅さで大きくラグるため使わない）。
// あわせて回転進捗のクロッシング時刻（線形補間）を返す＝イージング判定の素材。
function rotAnalysis(samples) {
  if (!samples.length) return null;
  const rz0 = samples[0].rz, target = samples[samples.length - 1].rz;
  if (Math.abs(target - rz0) < 1) return null; // 180°回っていない＝対象外
  const end = first(samples, (s) => Math.abs(s.rz - target) < 1e-9)?.t ?? null;
  const prog = (s) => Math.abs(s.rz - rz0) / Math.abs(target - rz0);
  const crossT = (q) => {
    for (let i = 1; i < samples.length; i++) {
      const a = prog(samples[i - 1]), b = prog(samples[i]);
      if (a < q && b >= q) return samples[i - 1].t + (samples[i].t - samples[i - 1].t) * (q - a) / (b - a);
    }
    return null;
  };
  return { end, t05: crossT(0.05), t30: crossT(0.3), t70: crossT(0.7), t95: crossT(0.95) };
}
// イージング確認：進捗30→70%の所要 ÷ 進捗5→95%の所要。
// 線形なら≈0.44、easeInOutCubic（中央が速いS字）なら≈0.29。
function easeMidRatio(rot) {
  if ([rot.t05, rot.t30, rot.t70, rot.t95].some((v) => v == null)) return null;
  return (rot.t70 - rot.t30) / (rot.t95 - rot.t05);
}
// 着手の溜め所要＝石の出現（最初のサンプル）〜最初の着地（yが静止位置近くへ戻る）
function placeDur(samples, rest) {
  const t0 = samples[0]?.t;
  const land = first(samples, (s) => s.y <= rest + 0.03);
  return t0 != null && land ? land.t - t0 : null;
}

(async () => {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  try {
    await assertMarker();
    launchChrome(`${BASE}/?debug=1`);
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    const goto = async (url, wait = 1500) => { await send("Page.navigate", { url }); await sleep(wait); };
    await sleep(1600);

    // ① デバッグパネルに「めくりタイミング」テーマ（4案・既定current）
    const panel = await evalIn(send, `(()=>{ const s=document.querySelector('#variant-panel select[data-theme="flipTiming"]');
      return { exists: !!s, options: s?[...s.options].map(o=>o.value):[], value: s?.value ?? null }; })()`);
    check("① パネルに flipTiming テーマ（4案・既定current）",
      panel.exists && panel.options.length === FLIP_TIMING_THEME.variants.length && panel.value === "current", panel);
    const cap = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync("/tmp/reversi-flip-timing-panel.png", Buffer.from(cap.result.data, "base64"));

    // ②〜⑤ プリセットごとに実測
    const measured = [];
    for (const variant of FLIP_TIMING_THEME.variants) {
      const t = variant.timing;
      // ?slow=1 は window.__view 公開用（SPEED=1なので等速のまま）
      await goto(`${BASE}/?slow=1&variant=flipTiming:${variant.id}`);
      const r = await evalIn(send, PLAY_AND_SAMPLE);
      if (!r || r.err.length) { check(`${variant.id}: ページ内エラー無し`, false, r?.err); continue; }

      const lead1 = rotAnalysis(r.m1["3,3"]);
      const lift1 = liftStartT(r.m1["3,3"], r.rest);
      const leadTotal = lead1?.end != null && lift1 != null ? lead1.end - lift1 : null; // 号砲所要
      const place1 = placeDur(r.m1["2,3"], r.rest);                                 // 着手の溜め
      const q1 = lead1 ? easeMidRatio(lead1) : null;                                // イージング
      const liftLead4 = liftStartT(r.m4["2,4"], r.rest);
      const liftFollow4 = liftStartT(r.m4["3,4"], r.rest);
      const seqGap = liftLead4 != null && liftFollow4 != null ? liftFollow4 - liftLead4 : null; // 逐次
      const expLead = leadFlipTotalMs(t);
      const expGap = t.liftMs + t.holdMs; // followerStart

      measured.push({ id: variant.id, leadTotal, place1, q1, seqGap, expLead, expGap });
      check(`② ${variant.id}: 号砲所要 ≈ 定義値 ${expLead}ms`,
        leadTotal != null && Math.abs(leadTotal - expLead) <= 100,
        { leadTotal: leadTotal?.toFixed(0) });
      check(`③ ${variant.id}: 逐次めくり維持（フォロワー遅延 ≈ ${expGap}ms・同時でない）`,
        seqGap != null && seqGap > 120 && Math.abs(seqGap - expGap) <= 100,
        { seqGap: seqGap?.toFixed(0) });
      check(`④ ${variant.id}: イージング維持（中央比 < 0.37、線形なら≈0.44・ease≈0.29）`,
        q1 != null && q1 < 0.37, { easeMidRatio: q1?.toFixed(3) });
    }

    // ② 号砲所要がプリセット順で単調増加（プリセットが効いている証拠）
    const totals = measured.map((m) => m.leadTotal);
    check("② 号砲所要が current < mid < heavy < max の単調増加",
      totals.every((v) => v != null) && totals.every((v, i) => i === 0 || v > totals[i - 1]),
      { totals: totals.map((v) => v?.toFixed(0)) });

    // ⑤ 着手の溜めは全プリセットで不変（最大差90ms以内）
    const places = measured.map((m) => m.place1).filter((v) => v != null);
    check("⑤ 着手の溜め（出現〜着地）が全プリセットでほぼ一定",
      places.length === measured.length && Math.max(...places) - Math.min(...places) <= 90,
      { places: places.map((v) => v.toFixed(0)) });

    console.log(JSON.stringify(results, null, 2));
    console.log("実測値:", JSON.stringify(measured.map((m) => ({
      id: m.id, leadTotal: m.leadTotal?.toFixed(0), expLead: m.expLead,
      seqGap: m.seqGap?.toFixed(0), expGap: m.expGap,
      place: m.place1?.toFixed(0), quarter: m.q1?.toFixed(3),
    })), null, 1));
    console.log("screenshot: /tmp/reversi-flip-timing-panel.png");
    console.log(results.every((r) => r.ok) ? "ALL PASS" : "FAIL あり");
    w.close();
  } catch (e) { console.error("ERR", e); } finally {
    server.close();
    if (chrome) {
      const exited = new Promise((r) => chrome.once("exit", r));
      chrome.kill();
      await exited; // 終了を待ってから使い捨てプロファイルを削除
    }
    rmSync(profileDir, { recursive: true, force: true });
    process.exit(0);
  }
})();
