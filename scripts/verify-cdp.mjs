// CDPでアニメ軌跡を数値検証する使い捨てスクリプト。
// 前提：devserver.mjs が :8765 で起動中。Chromeをheadlessで上げてCDP接続し、
// window.__view（?slow時に露出）越しに animateMove を直接叩いて y/x をサンプリングする。
import { spawn } from "node:child_process";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9222;
const URL = "http://localhost:8765/?slow=4";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--no-default-browser-check",
  "--user-data-dir=/tmp/cdp-reversi", "--window-size=900,1400",
  URL,
], { stdio: "ignore" });

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("CDP target not found");
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  return (method, params = {}) => new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}

const IN_PAGE = `
async function run() {
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const errors = [];
  window.addEventListener('error', e => errors.push(String(e.message||e.error)));
  document.querySelector('[data-mode="2p"]').click();
  await sleep(60);
  document.getElementById('start-game').click();
  await sleep(400);
  const v = window.__view;
  if (!v) return { ok:false, why:'no __view', errors };
  const EMPTY=0, BLACK=1, WHITE=2;
  const clone = b => b.map(r=>r.slice());
  const init = Array.from({length:8},()=>Array(8).fill(EMPTY));
  init[3][3]=WHITE; init[3][4]=BLACK; init[4][3]=BLACK; init[4][4]=WHITE;
  // ① 着手の溜め ＋ ② 号砲: 黒(2,3)→(3,3)が返る
  const nextA = clone(init); nextA[2][3]=BLACK; nextA[3][3]=BLACK;
  let appeared=false, landed=false, liftCount=0, landCount=0;
  const arcY=[];
  const pA = v.animateMove(init, nextA, {r:2,c:3}, BLACK, {
    onAppear:()=>appeared=true, onLand:()=>landed=true,
    onFlipLift:()=>liftCount++, onFlipLand:()=>landCount++, onCornerHit:null
  });
  for (let i=0;i<26;i++){ const e=v.stoneMap.get('2,3'); arcY.push(e?+e.group.position.y.toFixed(3):null); await sleep(80); }
  await pA;
  // ④ 四隅ヒットストップ: 黒(0,0)、(0,1)が返る想定(bracket (0,2))
  const prevC = clone(nextA); prevC[0][2]=BLACK; prevC[0][1]=WHITE;
  const nextC = clone(prevC); nextC[0][0]=BLACK; nextC[0][1]=BLACK;
  let cornerHit=false;
  const baseX = v.cellToWorld(0,0).x;
  const pC = v.animateMove(prevC, nextC, {r:0,c:0}, BLACK, {
    onAppear:()=>{}, onLand:()=>{}, onFlipLift:()=>{}, onFlipLand:()=>{},
    onCornerHit:()=>cornerHit=true
  });
  const arcX=[];
  await sleep(1850);            // 出現+溜め+落下を飛ばし、着地後のジッタ区間へ
  for (let i=0;i<16;i++){ const e=v.stoneMap.get('0,0'); arcX.push(e?+(e.group.position.x-baseX).toFixed(4):null); await sleep(30); }
  await pC;
  const ys = arcY.filter(x=>x!=null);
  return { ok:true, appeared, landed, liftCount, landCount, cornerHit,
    restY: v.STONE_H/2, hoverMax: Math.max(...ys), endY: ys[ys.length-1],
    arcY, jitterMaxAbs: Math.max(...arcX.map(x=>Math.abs(x||0))), arcX, errors };
}
run()`;

(async () => {
  try {
    const wsUrl = await getWsUrl();
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    const send = cdp(ws);
    await send("Runtime.enable");
    await send("Page.enable");
    // ロード完了待ち
    await sleep(1500);
    const res = await send("Runtime.evaluate", {
      expression: IN_PAGE, awaitPromise: true, returnByValue: true,
    });
    if (res.result?.exceptionDetails) {
      console.log("PAGE EXCEPTION:", JSON.stringify(res.result.exceptionDetails, null, 2));
    }
    const v = res.result?.result?.value;
    console.log(JSON.stringify(v, null, 2));
    ws.close();
  } catch (e) {
    console.error("ERR", e);
  } finally {
    chrome.kill();
    process.exit(0);
  }
})();
