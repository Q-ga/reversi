// めくり音バリアント（issue #7・基音層/上モノ層）のE2E検証。
//   ① 配信コードのガード：配信中の main.js / audio.js に本ブランチのマーカーがあるか（別ビルド接続の偽合格防止）
//   ② 既定：パネルに flipBase / flipTop の2テーマ（独立切替UI）・実プレイで基音=flip_land、
//      めくり1枚ごとに発音数が一致し、同一手内でピッチが上昇・上モノは無音
//   ③ ?variant=flipBase:stone,flipTop:balatro：基音=stone・キラリが各flipで1発＝両層が独立適用
//   ④ ?variant=flipBase:glass,flipTop:harp：基音=glass・ハープが各flipで1発・音階上昇
//   ⑤ エスカレーション（balatro・__flipPlay直叩き）：i=0..9/total=10 でキラリのrate/gainが積み上がり、
//      i>=2 で燃焼レイヤーが重なる（大量返しで燃える）＋変動則（total=1 と 10 で強度差）
// 発音の観測は ?audiotap=1 のときだけ有効になる window.__flipTap（発音指示の記録）を使う。
//   実行: node scripts/check-flip-sound.mjs（devserver不要・内蔵静的サーバ使用）
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HTTP_PORT = 8777; // このissue専用ポート（他エージェントの devserver 8765等と衝突しない）
const CDP_PORT = 9235;
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

// Chromeプロファイルは使い捨て（mkdtemp）。終了待ちのあと削除する（前回状態の持ち越し防止）。
const PROFILE = mkdtempSync(join(tmpdir(), "cdp-reversi-flip7-"));
let chrome = null;

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

// 対局開始＋3手（B(2,3)→W(2,4)→B(2,5)＝最終手は2枚返し）を実クリックで打ち、発音記録を返す。
// ?slow=1 で window.__view が公開され、?audiotap=1 で window.__flipTap に発音指示が記録される。
const PLAY_AND_TAP = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  window.__err=window.__err||[]; addEventListener('error',e=>window.__err.push(String(e.message||e.error)));
  document.querySelector('[data-mode="2p"]').click(); await sleep(60);
  document.getElementById('start-game').click(); await sleep(900);
  const v=window.__view, T=v.THREE;
  const clickCell=(r,c)=>{
    const {x,z}=v.cellToWorld(r,c);
    const p=new T.Vector3(x, v.STONE_H/2, z).project(v.camera);
    const rect=v.renderer.domElement.getBoundingClientRect();
    const px=rect.left+(p.x*0.5+0.5)*rect.width, py=rect.top+(-p.y*0.5+0.5)*rect.height;
    v.renderer.domElement.dispatchEvent(new MouseEvent('click',{clientX:px,clientY:py,bubbles:true}));
  };
  window.__flipTap=[];
  clickCell(2,3); await sleep(2800); // B: 1枚返し
  clickCell(2,4); await sleep(2800); // W: 1枚返し
  clickCell(2,5); await sleep(3000); // B: 2枚返し
  return { tap: window.__flipTap, err: window.__err,
    themes: Array.from(document.querySelectorAll('#variant-panel select')).map(s=>({
      theme: s.dataset.theme, value: s.value, options: Array.from(s.options).map(o=>o.value) })) };
})()`;

// 実プレイ共通の検査：基音層が「1枚ごとに1発・同一手内でrate上昇・指定の質感バッファ」か
function checkBase(tap, expectName) {
  const base = tap.filter((t) => t.layer === "base");
  const okCount = base.length === 4; // 1+1+2枚＝4発（発音カウント）
  const okName = base.every((t) => t.name === expectName);
  const last = base.slice(-2); // 最終手（2枚返し）の2発：i=0→1 でピッチ上昇
  const okRise = last.length === 2 && last[0].i === 0 && last[1].i === 1 && last[1].rate > last[0].rate;
  const okTotal = last.every((t) => t.total === 2); // 変動則用の総返し枚数が渡っている
  return { okCount, okName, okRise, okTotal, base };
}

(async () => {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  try {
    // ① 配信コードのガード：本ブランチのマーカーが配信されているか（別ビルド接続の偽合格防止）
    const mainSrc = await (await fetch(`${BASE}/src/main.js`)).text();
    const audioSrc = await (await fetch(`${BASE}/src/audio.js`)).text();
    if (!mainSrc.includes("registerFlipThemes") || !audioSrc.includes("playFlipLandLayered")) {
      throw new Error("配信コードに本ブランチのマーカーが無い（接続先ガード失敗）");
    }
    check("① 配信コードに本ブランチのマーカーあり", true, "registerFlipThemes / playFlipLandLayered");

    chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
      "--no-first-run", `--user-data-dir=${PROFILE}`, "--window-size=900,1500",
      "about:blank"], { stdio: "ignore" });
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    const goto = async (qs) => { await send("Page.navigate", { url: `${BASE}/?slow=1&audiotap=1&debug=1${qs}` }); await sleep(1800); };

    // ② 既定（バリアント未指定）
    await goto("");
    const r2 = await evalIn(send, PLAY_AND_TAP);
    const b2 = checkBase(r2.tap, "flip_land");
    const themeIds = r2.themes.map((t) => t.theme);
    check("② パネルに flipBase / flipTop の独立切替（各3案）",
      themeIds.includes("flipBase") && themeIds.includes("flipTop")
      && r2.themes.every((t) => t.theme === "demo" || t.options.length >= 3),
      r2.themes);
    check("② 既定：基音=flip_land・発音4/4・最終手でピッチ上昇",
      b2.okCount && b2.okName && b2.okRise && b2.okTotal, b2.base);
    check("② 既定：上モノ層は無音（現行と同一）",
      r2.tap.filter((t) => t.layer === "top").length === 0 && r2.err.length === 0,
      { top: r2.tap.filter((t) => t.layer === "top").length, err: r2.err });

    // ③ 基音=石 × 上モノ=キラリ（両層の独立適用）
    await goto("&variant=flipBase:stone,flipTop:balatro");
    const r3 = await evalIn(send, PLAY_AND_TAP);
    const b3 = checkBase(r3.tap, "flip_land_stone");
    const sparks3 = r3.tap.filter((t) => t.name === "flip_top_spark");
    check("③ 基音=stone：発音4/4・ピッチ上昇維持", b3.okCount && b3.okName && b3.okRise, b3.base);
    check("③ 上モノ=balatro：キラリが各flipで1発（4/4）・小さな手では燃えない",
      sparks3.length === 4 && r3.tap.filter((t) => t.name === "flip_top_flame").length === 0
      && r3.err.length === 0,
      { sparks: sparks3.length, err: r3.err });

    // ④ 基音=硝子 × 上モノ=ハープ
    await goto("&variant=flipBase:glass,flipTop:harp");
    const r4 = await evalIn(send, PLAY_AND_TAP);
    const b4 = checkBase(r4.tap, "flip_land_glass");
    const harps = r4.tap.filter((t) => t.name === "flip_top_harp");
    const lastHarps = harps.slice(-2);
    check("④ 基音=glass：発音4/4・ピッチ上昇維持", b4.okCount && b4.okName && b4.okRise, b4.base);
    check("④ 上モノ=harp：各flipで1発（4/4）・最終手で音階上昇",
      harps.length === 4 && lastHarps.length === 2 && lastHarps[1].rate > lastHarps[0].rate
      && r4.err.length === 0,
      { harps: harps.length, err: r4.err });

    // ⑤ エスカレーション（balatro・大量返し相当を __flipPlay 直叩きで再現）
    await goto("&variant=flipTop:balatro");
    const r5 = await evalIn(send, `(async()=>{
      window.__flipTap=[];
      for (let i=0;i<10;i++) window.__flipPlay(i,10); // 大量返し（10枚）相当
      const big=window.__flipTap.slice();
      window.__flipTap=[];
      window.__flipPlay(3,1); window.__flipPlay(3,10); // 変動則：同じiでtotal違い
      return { big, vr: window.__flipTap };
    })()`);
    const sparks5 = r5.big.filter((t) => t.name === "flip_top_spark");
    const flames5 = r5.big.filter((t) => t.name === "flip_top_flame");
    const sparkRise = sparks5.every((s, k) => k === 0 || (s.rate > sparks5[k - 1].rate && s.gain >= sparks5[k - 1].gain));
    const flameRise = flames5.length >= 2 && flames5.at(-1).gain > flames5[0].gain;
    check("⑤ 大量返し：キラリ10発がrate/gainともに積み上がる", sparks5.length === 10 && sparkRise,
      { sparks: sparks5.length });
    check("⑤ 大量返し：i>=2 から燃焼レイヤーが重なり強まる（エスカレーション）",
      flames5.length === 8 && flameRise, { flames: flames5.length });
    const vrSparks = r5.vr.filter((t) => t.name === "flip_top_spark");
    check("⑤ 変動則：同じiでも total=1 は total=10 より弱い（全手最大演出禁止）",
      vrSparks.length === 2 && vrSparks[0].gain < vrSparks[1].gain, vrSparks);

    console.log(JSON.stringify(results, null, 2));
    console.log(results.every((r) => r.ok) ? "ALL PASS" : "FAIL あり");
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
    w.close();
  } catch (e) {
    console.error("ERR", e);
    process.exitCode = 1;
  } finally {
    // Chromeの終了を待ってからプロファイルを削除する（使用中削除のレース回避）
    if (chrome) {
      chrome.kill();
      await new Promise((r) => { chrome.once("exit", r); setTimeout(r, 3000); });
    }
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
    server.close();
    process.exit();
  }
})();
