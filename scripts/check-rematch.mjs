// 再戦UI検証：2人戦を終局まで打ち、結果画面のボタン出し分け（もう一回=非表示／入替・そのまま=表示）と
// 「入れ替えて再戦」で新規対局（盤4石）が始まることを確認。使い捨て。devserver(:8765)前提。
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9230;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-rematch", "--window-size=900,1500",
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
  const vis=id=>{const e=document.getElementById(id);return e&&getComputedStyle(e).display!=='none';};
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
  function click(r,c){const{x,z}=v.cellToWorld(r,c);const p=new T.Vector3(x,v.STONE_H/2,z).project(v.camera);
    const rect=v.renderer.domElement.getBoundingClientRect();
    v.renderer.domElement.dispatchEvent(new MouseEvent('click',{clientX:rect.left+(p.x*0.5+0.5)*rect.width,clientY:rect.top+(-p.y*0.5+0.5)*rect.height,bubbles:true}));}
  for(let move=0; move<80; move++){
    if(document.getElementById('overlay-result').classList.contains('active')) break;
    const cur=current(); if(!cur) break;
    const moves=legal(board(),cur); if(!moves.length) break;
    const before=v.stoneMap.size; click(moves[0][0],moves[0][1]);
    let ok=false; for(let t=0;t<33;t++){await sleep(150); if(v.stoneMap.size>before){ok=true;break;}}
    if(!ok) return { error:'FREEZE@'+move };
    await sleep(3600);
  }
  // 結果画面のボタン出し分け
  const buttons={ rematch:vis('rematch'), swap:vis('rematch-swap'), same:vis('rematch-same'), menu:vis('to-menu') };
  // 「入れ替えて再戦」を押す → 新規対局（overlay閉じ・盤4石）
  document.getElementById('rematch-swap').click(); await sleep(700);
  const afterSwap={ overlayActive:document.getElementById('overlay-result').classList.contains('active'),
    gameActive:document.getElementById('screen-game').classList.contains('active'),
    stones:v.stoneMap.size };
  return { buttons, afterSwap };
})()`;
(async () => {
  try {
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    await sleep(1600);
    console.log(JSON.stringify(await evalIn(send, SCRIPT), null, 2));
    w.close();
  } catch (e) { console.error("ERR", e); } finally { chrome.kill(); process.exit(0); }
})();
