// 比較ビルド基盤のE2E検証（issue #2）：
//   ①フラグ無しでは切替パネルがDOMに存在しない（ダミーテーマは既定値a）
//   ②URLパラメータ ?variant=demo:b でバリアント直接指定できる
//   ③不正ID（?variant=demo:zzz）は既定値へフォールバック
//   ④?debug=1 でのみパネルが表示される
//   ⑤パネルで切替→URL更新＆リロード→選択が適用される
// devserver(8765固定)とは別に、ポート8772の内蔵静的サーバを使う（他エージェントと衝突回避）。
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HTTP_PORT = 8772;
const CDP_PORT = 9231;
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

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run", `--user-data-dir=/tmp/cdp-reversi-variants-${Date.now()}`, "--window-size=900,1500",
  `${BASE}/`], { stdio: "ignore" });

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

// 現在ページのパネル有無・ダミーテーマ適用値・select値・URLを観測する共通式
const OBSERVE = `({
  url: location.href,
  panel: !!document.getElementById('variant-panel'),
  demo: document.documentElement.dataset.variantDemo,
  select: document.querySelector('#variant-panel select[data-theme="demo"]')?.value ?? null,
})`;

(async () => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); };
  try {
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    const goto = async (url, wait = 1400) => { await send("Page.navigate", { url }); await sleep(wait); };

    // ① フラグ無し：パネル不在・ダミーテーマは既定値a
    await sleep(1600);
    const r1 = await evalIn(send, OBSERVE);
    check("① フラグ無しでパネル不在＆既定値a", r1.panel === false && r1.demo === "a", r1);

    // ② URL直接指定：?variant=demo:b（debug無し→パネルは出ないが適用される）
    await goto(`${BASE}/?variant=demo:b`);
    const r2 = await evalIn(send, OBSERVE);
    check("② ?variant=demo:b で案Bが適用", r2.panel === false && r2.demo === "b", r2);

    // ③ 不正ID：既定値へフォールバック
    await goto(`${BASE}/?variant=demo:zzz`);
    const r3 = await evalIn(send, OBSERVE);
    check("③ 不正IDは既定値aへフォールバック", r3.demo === "a", r3);

    // ④ ?debug=1：パネル表示・selectは既定値a
    await goto(`${BASE}/?debug=1`);
    const r4 = await evalIn(send, OBSERVE);
    check("④ ?debug=1 でパネル表示＆select=a", r4.panel === true && r4.select === "a", r4);

    // ⑤ パネルで案Bへ切替→URL更新＆リロード→適用される（debug=1は維持）
    await evalIn(send, `(()=>{ const s=document.querySelector('#variant-panel select[data-theme="demo"]');
      s.value='b'; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    await sleep(1800); // location.assign によるリロード待ち
    const r5 = await evalIn(send, OBSERVE);
    check("⑤ パネル切替→リロード後に案B適用＆URL更新",
      r5.panel === true && r5.demo === "b" && r5.select === "b"
      && r5.url.includes("variant=demo%3Ab") && r5.url.includes("debug=1"), r5);

    const cap = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync("/tmp/reversi-variants.png", Buffer.from(cap.result.data, "base64"));
    console.log(JSON.stringify(results, null, 2));
    console.log("screenshot: /tmp/reversi-variants.png");
    console.log(results.every((r) => r.ok) ? "ALL PASS" : "FAIL あり");
    w.close();
  } catch (e) { console.error("ERR", e); } finally { chrome.kill(); server.close(); process.exit(0); }
})();
