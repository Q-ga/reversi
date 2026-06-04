// 実際にキャンバスをクリックして1手打ち、doMove→パネル更新まで通ることを確認する使い捨てスクリプト。
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9224;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-play", "--window-size=900,1500",
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
const SCRIPT = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  window.__err=[]; addEventListener('error',e=>window.__err.push(String(e.message||e.error)));
  document.querySelector('[data-mode="2p"]').click(); await sleep(60);
  document.getElementById('start-game').click(); await sleep(500);
  const v=window.__view; const T=v.THREE;
  const before={ bottom:document.querySelector('#panel-bottom .pp-count')?.textContent,
                 top:document.querySelector('#panel-top .pp-count')?.textContent,
                 msg:document.getElementById('message').textContent };
  // 合法手(2,3)をクリック座標に投影してcanvasをクリック
  const {x,z}=v.cellToWorld(2,3);
  const p=new T.Vector3(x, v.STONE_H/2, z).project(v.camera);
  const rect=v.renderer.domElement.getBoundingClientRect();
  const px=rect.left+(p.x*0.5+0.5)*rect.width, py=rect.top+(-p.y*0.5+0.5)*rect.height;
  v.renderer.domElement.dispatchEvent(new MouseEvent('click',{clientX:px,clientY:py,bubbles:true}));
  await sleep(2600); // 着手アニメ＋ヒント遅延を待つ
  const after={ bottom:document.querySelector('#panel-bottom .pp-count')?.textContent,
                top:document.querySelector('#panel-top .pp-count')?.textContent,
                msg:document.getElementById('message').textContent,
                placed: !!v.stoneMap.get('2,3'), flipped: v.stoneMap.get('3,3')?.color };
  return { before, after, err:window.__err };
})()`;
(async () => {
  try {
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    await sleep(1600);
    const res = await evalIn(send, SCRIPT);
    console.log(JSON.stringify(res, null, 2));
    w.close();
  } catch (e) { console.error("ERR", e); } finally { chrome.kill(); process.exit(0); }
})();
