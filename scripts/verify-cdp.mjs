// CDPでアニメ軌跡を数値検証＋実描画スクショ確認する使い捨てスクリプト。
// 前提：devserver.mjs が :8765 で起動中。Chrome headless(WebGL)をCDP接続し、
// window.__view（?slow時に露出）越しに animateMove を直叩きして y/x をサンプリングし、
// 四隅ジッタ中のスクリーンショットを /tmp に保存して実描画でも揺れているか確認する。
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9222;
const URL = "http://localhost:8765/?slow=2";
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
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  return (method, params = {}) => new Promise((res) => {
    const myId = ++id; pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}
const evalIn = async (send, expr, awaitPromise = true) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) console.log("EXC:", JSON.stringify(r.result.exceptionDetails.exception));
  return r.result?.result?.value;
};

const SETUP = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  window.__err=[]; window.addEventListener('error',e=>window.__err.push(String(e.message||e.error)));
  document.querySelector('[data-mode="2p"]').click(); await sleep(60);
  document.getElementById('start-game').click(); await sleep(400);
  const v=window.__view; if(!v) return {ok:false};
  const EMPTY=0,BLACK=1; const clone=b=>b.map(r=>r.slice());
  const init=Array.from({length:8},()=>Array(8).fill(0));
  init[3][3]=2;init[3][4]=1;init[4][3]=1;init[4][4]=2;
  // ① 着手の溜め＋② 号砲：黒(2,3)→(3,3)
  const nextA=clone(init); nextA[2][3]=1; nextA[3][3]=1;
  window.__A={appeared:false,landed:false,lift:0,land:0,arcY:[]};
  const pA=v.animateMove(init,nextA,{r:2,c:3},1,{
    onAppear:()=>window.__A.appeared=true,onLand:()=>window.__A.landed=true,
    onFlipLift:()=>window.__A.lift++,onFlipLand:()=>window.__A.land++});
  for(let i=0;i<22;i++){const e=v.stoneMap.get('2,3');window.__A.arcY.push(e?+e.group.position.y.toFixed(3):null);await sleep(70);}
  await pA;
  return {ok:true,restY:v.STONE_H/2};
})()`;

const CORNER = `(()=>{
  const v=window.__view; const clone=b=>b.map(r=>r.slice());
  const init=Array.from({length:8},()=>Array(8).fill(0));
  init[3][3]=2;init[3][4]=1;init[4][3]=1;init[4][4]=2; init[2][3]=1; init[3][3]=1;
  const prevC=clone(init); prevC[0][2]=1; prevC[0][1]=2;
  const nextC=clone(prevC); nextC[0][0]=1; nextC[0][1]=1;
  window.__C={hit:false,arcX:[],camX:[]}; const baseX=v.cellToWorld(0,0).x; const camX0=v.camera.position.x;
  v.animateMove(prevC,nextC,{r:0,c:0},1,{onImpact:()=>{window.__C.hit=true; v.applyEffects(['corner'],{r:0,c:0});},isBig:false});
  (async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<45;i++){const e=v.stoneMap.get('0,0');window.__C.arcX.push(e?+(e.group.position.x-baseX).toFixed(4):null);
      window.__C.camX.push(+(v.camera.position.x-camX0).toFixed(4));await sleep(40);}
    window.__C.done=true;})();
  return {started:true};
})()`;

const BIG = `(()=>{
  const v=window.__view; const clone=b=>b.map(r=>r.slice());
  const init=Array.from({length:8},()=>Array(8).fill(0));
  init[4][7]=1; for(let c=2;c<7;c++) init[4][c]=2; // (4,2..6)=白、bracket(4,7)=黒
  const next=clone(init); next[4][1]=1; for(let c=2;c<7;c++) next[4][c]=1;
  window.__B={hit:false};
  v.animateMove(init,next,{r:4,c:1},1,{isBig:true,onImpact:()=>{window.__B.hit=true; v.applyEffects(['bigFlip'],{r:4,c:1});}});
  return {started:true};
})()`;

(async () => {
  try {
    const ws = new WebSocket(await getWsUrl());
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    const send = cdp(ws);
    await send("Runtime.enable"); await send("Page.enable");
    await sleep(1500);
    const a = await evalIn(send, SETUP);
    console.log("SETUP:", JSON.stringify(a));
    const A = await evalIn(send, "window.__A");
    console.log("① arcY:", JSON.stringify(A.arcY));
    console.log("① appeared/landed/lift/land:", A.appeared, A.landed, A.lift, A.land);

    // 四隅：アニメ開始→着地(約758ms@slow2)後のジッタ中にスクショ3枚
    await evalIn(send, CORNER, false);
    const shots = [];
    for (const t of [820, 980, 1180]) {
      await sleep(t - (shots.at(-1)?.t ?? 0));
      const r = await send("Page.captureScreenshot", { format: "png" });
      const file = `/tmp/jit_${t}.png`;
      writeFileSync(file, Buffer.from(r.result.data, "base64"));
      shots.push({ t, file });
    }
    await sleep(900);
    const C = await evalIn(send, "window.__C");
    console.log("④ cornerHit:", C.hit, "jitterMaxAbs:", Math.max(...C.arcX.map((x) => Math.abs(x || 0))).toFixed(4),
      "camShakeMaxAbs:", Math.max(...C.camX.map((x) => Math.abs(x || 0))).toFixed(4));
    console.log("shots:", shots.map((s) => s.file).join(" "));

    // 大量返し：効果線が飛び散る瞬間をスクショ
    await evalIn(send, BIG, false);
    await sleep(950); // 着地(約758ms@slow2)→onImpactで効果線発火、その直後を撮る
    const rb = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync("/tmp/big_streaks.png", Buffer.from(rb.result.data, "base64"));
    const B = await evalIn(send, "window.__B");
    console.log("大量返し bigHit:", B.hit, "shot: /tmp/big_streaks.png");

    const err = await evalIn(send, "window.__err");
    console.log("errors:", JSON.stringify(err));
    ws.close();
  } catch (e) { console.error("ERR", e); }
  finally { chrome.kill(); process.exit(0); }
})();
