// フリーズ再現：2人モードを自動で最後まで打ち切り、「合法手があるのに盤が増えない＝固着」を検出する。
// 併せて error / unhandledrejection を捕捉し、busy固着の実トリガー（doMove内throf等）のスタックを取る。
// 使い捨て診断スクリプト。devserver(:8765)起動が前提。
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9226;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-freeze", "--window-size=900,1500",
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
  window.__err=[]; window.__rej=[];
  addEventListener('error',e=>window.__err.push(String(e.message||e.error)+' @'+(e.filename||'')+':'+(e.lineno||'')));
  addEventListener('unhandledrejection',e=>window.__rej.push(String((e.reason&&e.reason.stack)||e.reason)));
  // ルール（盤再構成用に最小実装）
  function flips(b,r,c,p){ if(b[r][c]!==0) return []; const opp=p===1?2:1;
    const dirs=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]; let res=[];
    for(const[dr,dc]of dirs){let line=[],nr=r+dr,nc=c+dc;
      while(nr>=0&&nr<8&&nc>=0&&nc<8&&b[nr][nc]===opp){line.push([nr,nc]);nr+=dr;nc+=dc;}
      if(line.length&&nr>=0&&nr<8&&nc>=0&&nc<8&&b[nr][nc]===p)res.push(...line);}return res;}
  function legal(b,p){let m=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(flips(b,r,c,p).length)m.push([r,c]);return m;}

  document.querySelector('[data-mode="2p"]').click(); await sleep(80);
  document.getElementById('start-game').click(); await sleep(600);
  const v=window.__view, T=v.THREE;
  const board=()=>{const b=Array.from({length:8},()=>Array(8).fill(0));
    for(const[k,e]of v.stoneMap){const[r,c]=k.split(',').map(Number);b[r][c]=e.color;}return b;};
  const current=()=>document.querySelector('#panel-bottom').classList.contains('turn')?1:
    document.querySelector('#panel-top').classList.contains('turn')?2:0;
  function clickCell(r,c){const{x,z}=v.cellToWorld(r,c);
    const p=new T.Vector3(x,v.STONE_H/2,z).project(v.camera);
    const rect=v.renderer.domElement.getBoundingClientRect();
    const px=rect.left+(p.x*0.5+0.5)*rect.width, py=rect.top+(-p.y*0.5+0.5)*rect.height;
    v.renderer.domElement.dispatchEvent(new MouseEvent('click',{clientX:px,clientY:py,bubbles:true}));}

  const log=[]; let passes=0, bigs=0, corners=0;
  for(let move=0; move<80; move++){
    const msg=document.getElementById('message').textContent;
    if(msg.includes('対局終了')){ log.push({result:'GAMEOVER',move,msg}); break; }
    const b=board(), cur=current();
    if(!cur){ log.push({result:'NO_CURRENT(stuck)',move,msg,err:window.__err.slice(),rej:window.__rej.slice()}); break; }
    const moves=legal(b,cur);
    if(moves.length===0){ log.push({result:'NO_LEGAL_BUT_NOT_OVER(logic-bug)',move,cur,msg}); break; }
    if(msg.includes('パス')) passes++;
    const before=v.stoneMap.size;
    clickCell(moves[0][0],moves[0][1]);
    // 固着の真の定義＝合法手をクリックしても石が一切増えない。石増加(=着手成立)を最大5秒待つ。
    let placed=false;
    for(let t=0;t<33;t++){ await sleep(150); if(v.stoneMap.size>before){ placed=true; break; } }
    if(!placed){
      log.push({result:'FREEZE',move,cur,clicked:moves[0],legalCount:moves.length,
        sizeBefore:before, sizeAfter:v.stoneMap.size,
        msgBefore:msg, msgAfter:document.getElementById('message').textContent,
        err:window.__err.slice(), rej:window.__rej.slice()});
      break;
    }
    await sleep(2600); // アニメ＋busy解除を十分に待ってから次手（次クリックがbusy中に当たらないように）
  }
  return { log, passes, totalErr:window.__err, totalRej:window.__rej, finalStones:v.stoneMap.size };
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
