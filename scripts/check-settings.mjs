// 設定モーダルのE2E検証：歯車で開く／スライダー反映／永続化（リロードで復元）／エラー無し。
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9226;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-settings", "--window-size=900,1500",
  "http://localhost:8765/?slow=1"], { stdio: "ignore" });
async function wsUrl() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://localhost:${PORT}/json`); const l = await r.json();
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
const STEP1 = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  window.__err=[]; addEventListener('error',e=>window.__err.push(String(e.message||e.error)));
  // 対局を開始して view を生成（エフェクト反映先）
  document.querySelector('[data-mode="2p"]').click(); await sleep(60);
  document.getElementById('start-game').click(); await sleep(900);
  // 歯車で設定を開く
  document.getElementById('gear-btn').click(); await sleep(250);
  const open = document.getElementById('overlay-settings').classList.contains('active');
  const defaults = {
    bgmOn: document.getElementById('set-bgm-on').checked,
    sfxOn: document.getElementById('set-sfx-on').checked,
    effectsOn: document.getElementById('set-effects-on').checked,
    bgmVal: document.getElementById('set-bgm-val').textContent,
  };
  // BGM音量を30%へ、エフェクト演出をOFFへ
  const bgm=document.getElementById('set-bgm-vol'); bgm.value=30; bgm.dispatchEvent(new Event('input',{bubbles:true})); bgm.dispatchEvent(new Event('change',{bubbles:true}));
  const eff=document.getElementById('set-effects-on'); eff.checked=false; eff.dispatchEvent(new Event('change',{bubbles:true}));
  await sleep(120);
  const stored = JSON.parse(localStorage.getItem('reversi.settings')||'{}');
  return { open, defaults, bgmLabel: document.getElementById('set-bgm-val').textContent, stored, err: window.__err };
})()`;
const STEP2 = `(async()=>{
  // リロード後：永続化された値がUIに復元されるか
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  window.__err2=[]; addEventListener('error',e=>window.__err2.push(String(e.message||e.error)));
  document.getElementById('gear-btn').click(); await sleep(200);
  return {
    bgmVol: document.getElementById('set-bgm-vol').value,
    bgmLabel: document.getElementById('set-bgm-val').textContent,
    effectsOn: document.getElementById('set-effects-on').checked,
    err: window.__err2,
  };
})()`;
(async () => {
  try {
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    await sleep(1600);
    const r1 = await evalIn(send, STEP1);
    const cap = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync("/tmp/reversi-settings.png", Buffer.from(cap.result.data, "base64"));
    // リロード（同一user-data-dir＝localStorage保持）
    await send("Page.navigate", { url: "http://localhost:8765/?slow=1" });
    await sleep(1800);
    const r2 = await evalIn(send, STEP2);
    console.log(JSON.stringify({ step1_open_and_change: r1, step2_after_reload: r2 }, null, 2));
    console.log("screenshot: /tmp/reversi-settings.png");
    w.close();
  } catch (e) { console.error("ERR", e); } finally { chrome.kill(); process.exit(0); }
})();
