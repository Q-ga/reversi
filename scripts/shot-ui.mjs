// 画面のスクリーンショットを撮る使い捨てスクリプト（UIリデザイン確認用）。
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-ui", "--window-size=900,1500",
  "http://localhost:8765/"], { stdio: "ignore" });
async function ws() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/json`); const l = await r.json();
      const p = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {}
    await sleep(200);
  } throw new Error("no target");
}
function cdp(w) { let id = 0; const p = new Map();
  w.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
  return (method, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); w.send(JSON.stringify({ id: i, method, params })); });
}
async function shot(send, file) { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(r.result.data, "base64")); }
(async () => {
  try {
    const w = new WebSocket(await ws());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    await sleep(1800);
    await shot(send, "/tmp/ui_menu.png");
    await send("Runtime.evaluate", { expression: `document.querySelector('[data-mode="2p"]').click()` }); await sleep(500);
    await shot(send, "/tmp/ui_setup.png");
    await send("Runtime.evaluate", { expression: `document.getElementById('start-game').click()` }); await sleep(1200);
    await shot(send, "/tmp/ui_game.png");
    // 結果オーバーレイも確認
    await send("Runtime.evaluate", { expression: `document.getElementById('result-text').textContent='あなたの勝ち！';document.getElementById('result-score').textContent='黒 40 対 白 24';document.getElementById('overlay-result').classList.add('active')` });
    await sleep(300); await shot(send, "/tmp/ui_result.png");
    console.log("shots: /tmp/ui_menu.png /tmp/ui_setup.png /tmp/ui_game.png /tmp/ui_result.png");
    const err = await send("Runtime.evaluate", { expression: `(window.__e||[]).join('|')`, returnByValue: true });
    console.log("errors:", err.result?.result?.value || "(none captured)");
    w.close();
  } catch (e) { console.error("ERR", e); } finally { chrome.kill(); process.exit(0); }
})();
