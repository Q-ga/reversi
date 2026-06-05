// パスバナー検証：①実パス時に#pass-bannerが正しい文言で発火するか（MutationObserverで全発火を収集）
// ②固着なく終局まで完走するか ③バナーの見た目をスクショ保存。使い捨て。devserver(:8765)前提。
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9227;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-passbanner", "--window-size=900,1500",
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
const PLAY = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  window.__err=[]; window.__rej=[]; window.__pass=[];
  addEventListener('error',e=>window.__err.push(String(e.message||e.error)));
  addEventListener('unhandledrejection',e=>window.__rej.push(String((e.reason&&e.reason.stack)||e.reason)));
  function flips(b,r,c,p){ if(b[r][c]!==0) return []; const opp=p===1?2:1;
    const dirs=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]; let res=[];
    for(const[dr,dc]of dirs){let line=[],nr=r+dr,nc=c+dc;
      while(nr>=0&&nr<8&&nc>=0&&nc<8&&b[nr][nc]===opp){line.push([nr,nc]);nr+=dr;nc+=dc;}
      if(line.length&&nr>=0&&nr<8&&nc>=0&&nc<8&&b[nr][nc]===p)res.push(...line);}return res;}
  function legal(b,p){let m=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(flips(b,r,c,p).length)m.push([r,c]);return m;}
  document.querySelector('[data-mode="2p"]').click(); await sleep(80);
  document.getElementById('start-game').click(); await sleep(600);
  const v=window.__view, T=v.THREE;
  // バナーの show 発火を全件記録（タイミングに依らず捕捉）
  const banner=document.getElementById('pass-banner');
  new MutationObserver(()=>{ if(banner.classList.contains('show'))
    window.__pass.push(document.getElementById('pass-sub').textContent); })
    .observe(banner,{attributes:true,attributeFilter:['class']});
  const board=()=>{const b=Array.from({length:8},()=>Array(8).fill(0));
    for(const[k,e]of v.stoneMap){const[r,c]=k.split(',').map(Number);b[r][c]=e.color;}return b;};
  const current=()=>document.querySelector('#panel-bottom').classList.contains('turn')?1:
    document.querySelector('#panel-top').classList.contains('turn')?2:0;
  function clickCell(r,c){const{x,z}=v.cellToWorld(r,c);
    const p=new T.Vector3(x,v.STONE_H/2,z).project(v.camera);
    const rect=v.renderer.domElement.getBoundingClientRect();
    const px=rect.left+(p.x*0.5+0.5)*rect.width, py=rect.top+(-p.y*0.5+0.5)*rect.height;
    v.renderer.domElement.dispatchEvent(new MouseEvent('click',{clientX:px,clientY:py,bubbles:true}));}
  let result='INCOMPLETE';
  for(let move=0; move<80; move++){
    if(document.getElementById('message').textContent.includes('対局終了')){ result='GAMEOVER'; break; }
    const b=board(), cur=current();
    if(!cur){ result='NO_CURRENT(stuck)@'+move; break; }
    const moves=legal(b,cur);
    if(moves.length===0){ result='NO_LEGAL_BUT_NOT_OVER@'+move; break; }
    const before=v.stoneMap.size;
    clickCell(moves[0][0],moves[0][1]);
    let placed=false;
    for(let t=0;t<33;t++){ await sleep(150); if(v.stoneMap.size>before){ placed=true; break; } }
    if(!placed){ result='FREEZE@'+move; break; }
    await sleep(3600); // アニメ＋パスバナー(最大~1.5s)＋busy解除を待つ
  }
  return { result, passBanners:window.__pass, err:window.__err, rej:window.__rej, finalStones:v.stoneMap.size };
})()`;
const SHOT = `(()=>{ // 見た目確認用：バナーを強制表示して文言サンプルを入れる
  const b=document.getElementById('pass-banner');
  document.getElementById('pass-sub').textContent='ゲスト（白）は打てる場所がありません';
  b.classList.add('show'); return true; })()`;
(async () => {
  try {
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    await sleep(1600);
    const res = await evalIn(send, PLAY);
    console.log(JSON.stringify(res, null, 2));
    // バナーの見た目をスクショ
    await evalIn(send, SHOT); await sleep(400);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    if (shot.result?.data) { writeFileSync("/tmp/pass-banner.png", Buffer.from(shot.result.data, "base64")); console.log("SHOT: /tmp/pass-banner.png"); }
    w.close();
  } catch (e) { console.error("ERR", e); } finally { chrome.kill(); process.exit(0); }
})();
