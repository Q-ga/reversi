// 本番URL(HTTPS・SW有効)をheadlessで開き、コンソール/ページエラーとSW登録・盤生成を確認する使い捨てスクリプト。
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9225;
const URL = "https://q-ga.github.io/reversi/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-prod", "--window-size=900,1500", "about:blank"], { stdio: "ignore" });
async function wsUrl() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://localhost:${PORT}/json`); const l = await r.json();
    const p = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error("no target"); }
function cdp(w) { let id = 0; const p = new Map(); const errs = [];
  w.addEventListener("message", (e) => { const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errs.push(m.params.entry.text);
    if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || "exception");
  });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); w.send(JSON.stringify({ id: i, method, params })); });
  return { send, errs }; }
(async () => {
  try {
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const { send, errs } = cdp(w);
    await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
    await send("Page.navigate", { url: URL });
    await sleep(5000); // ロード＋SW登録＋decode待ち
    const info = await send("Runtime.evaluate", { expression: `(async()=>{
      const reg = await navigator.serviceWorker.getRegistration();
      const canvas = document.querySelector('#board3d canvas');
      return { title: document.title,
               swRegistered: !!reg,
               swActive: !!(reg && reg.active),
               menuVisible: document.getElementById('screen-menu').classList.contains('active'),
               logoText: document.querySelector('h1.logo')?.textContent };
    })()`, awaitPromise: true, returnByValue: true });
    console.log("結果:", JSON.stringify(info.result?.result?.value, null, 2));
    console.log("エラー:", errs.length ? errs : "なし");
    w.close();
  } catch (e) { console.error("ERR", e); } finally { chrome.kill(); process.exit(0); }
})();
