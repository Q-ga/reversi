// 実際の3D盤面（ヒント無し）をレンダリングしてホーム画面アイコンを生成する使い捨てスクリプト。
// 前提：devserver.mjs が :8765 で起動中。?slow で露出する window.__view を使い、見栄えする局面を
// ヒント無しで描画 → 盤を画面いっぱいにして各サイズで正方形キャプチャ → icons/ を上書き。
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9226;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-icon", "--window-size=600,600",
  "http://localhost:8765/?slow=1"], { stdio: "ignore" });
async function wsUrl() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://localhost:${PORT}/json`); const l = await r.json();
    const p = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error("no target"); }
function cdp(w) { let id = 0; const p = new Map();
  w.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
  return (method, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); w.send(JSON.stringify({ id: i, method, params })); }); }

// 見栄えする中盤局面（0=空,1=黒,2=白）。ヒント無しで描画する。
const BOARD = [
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,2,1,0,0,0],
  [0,0,0,1,2,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
];
const SETUP = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  document.querySelector('[data-mode="2p"]').click(); await sleep(60);
  document.getElementById('start-game').click(); await sleep(500);
  const v=window.__view; if(!v) return false;
  // 盤以外のUIを隠し、盤を画面いっぱいに（rendererはResizeObserverで追従）
  document.querySelectorAll('#panel-top,#panel-bottom,#message,.controls,.sound-row').forEach(e=>e.style.display='none');
  document.querySelector('.screen.active').style.padding='0';
  document.querySelector('.screen.active').style.gap='0';
  const wrap=document.querySelector('.board-wrap');
  wrap.style.width='100vw'; wrap.style.height='100vh'; wrap.style.maxWidth='none'; wrap.style.borderRadius='0'; wrap.style.boxShadow='none';
  document.body.style.background='#0a0a0b';
  // 見栄えする局面をヒント無しで描画
  v.sync({ board:${JSON.stringify(BOARD)}, current:1, over:false }, false);
  // 中央4石に寄る（文字は石の上に重ねる）
  v.camera.position.set(0, 7.4, 0.5);
  v.camera.lookAt(0, 0, 0);
  v.camera.updateProjectionMatrix();
  // 中央にUIと同系統（明朝・金）の「リバーシ」を大きく重ねる（石にかぶってよい・影で可読性確保）
  const sh = document.createElement('div');
  sh.style.cssText = 'position:fixed;inset:0;z-index:9;pointer-events:none;background:radial-gradient(ellipse 72% 28% at 50% 50%, rgba(0,0,0,.55), transparent 72%);';
  const t = document.createElement('div');
  t.textContent = 'リバーシ';
  t.style.cssText = 'position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;pointer-events:none;'
    + 'font-family:"Hiragino Mincho ProN","Yu Mincho",serif;font-weight:600;font-size:17vw;letter-spacing:0.08em;'
    + 'background:linear-gradient(180deg,#f7e6b0 0%,#d9b75d 48%,#a9802a 100%);-webkit-background-clip:text;background-clip:text;color:transparent;'
    + 'filter:drop-shadow(0 2px 3px rgba(0,0,0,.9)) drop-shadow(0 0 9px rgba(0,0,0,.6));';
  document.body.appendChild(sh); document.body.appendChild(t);
  await sleep(300);
  return true;
})()`;

(async () => {
  try {
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    await sleep(1600);
    await send("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
    const ok = await send("Runtime.evaluate", { expression: SETUP, awaitPromise: true, returnByValue: true });
    if (!ok.result?.result?.value) { console.log("setup失敗", JSON.stringify(ok.result)); }
    for (const size of [512, 192, 180]) {
      await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
      await send("Runtime.evaluate", { expression: `window.dispatchEvent(new Event('resize'))` });
      await sleep(450);
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
      writeFileSync(`icons/icon-${size}.png`, Buffer.from(r.result.data, "base64"));
      console.log("✔ icons/icon-" + size + ".png");
    }
    w.close();
  } catch (e) { console.error("ERR", e); } finally { chrome.kill(); process.exit(0); }
})();
