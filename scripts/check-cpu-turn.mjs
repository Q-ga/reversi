// CPU戦の手番選択を検証：①setup画面の出し分け（CPU=手番トグル表示/あなた、2人=従来）
// ②後攻を選ぶとCPUが黒で先に着手し、手番が人間(白)に来る ③その後人間が白で着手できる。使い捨て。
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9229;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-cputurn", "--window-size=900,1500",
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
  const vis=id=>{const e=document.getElementById(id);return e&&getComputedStyle(e).display!=='none';};
  const out={};

  // --- CPU戦のsetup画面 ---
  document.querySelector('[data-mode="cpu"]').click(); await sleep(150);
  out.cpuSetup={ turnShown:vis('field-turn'), whiteHidden:!vis('field-white'),
    levelShown:vis('field-level'), labelBlack:document.getElementById('label-black').textContent };

  // 後攻（後攻=黒はCPU）を選択して開始
  document.querySelector('#seg-turn button[data-first="0"]').click(); await sleep(80);
  document.getElementById('start-game').click();
  // CPU(黒)が先に打つのを待つ（500ms+アニメ）
  await sleep(2600);
  const v=window.__view;
  out.afterStart={ stones:v.stoneMap.size,
    bottomTurn:document.querySelector('#panel-bottom').classList.contains('turn'), // 黒=CPU
    topTurn:document.querySelector('#panel-top').classList.contains('turn'),       // 白=人間
    msg:document.getElementById('message').textContent };

  // 人間(白)が合法手を1つ打てるか
  function flips(b,r,c,p){ if(b[r][c]!==0) return []; const opp=p===1?2:1;
    const dirs=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]; let res=[];
    for(const[dr,dc]of dirs){let line=[],nr=r+dr,nc=c+dc;
      while(nr>=0&&nr<8&&nc>=0&&nc<8&&b[nr][nc]===opp){line.push([nr,nc]);nr+=dr;nc+=dc;}
      if(line.length&&nr>=0&&nr<8&&nc>=0&&nc<8&&b[nr][nc]===p)res.push(...line);}return res;}
  const board=()=>{const b=Array.from({length:8},()=>Array(8).fill(0));
    for(const[k,e]of v.stoneMap){const[r,c]=k.split(',').map(Number);b[r][c]=e.color;}return b;};
  const T=v.THREE; const moves=[]; const b=board();
  for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(flips(b,r,c,2).length)moves.push([r,c]); // 白(2)の合法手
  let humanPlayed=false;
  if(moves.length){ const[r,c]=moves[0]; const{x,z}=v.cellToWorld(r,c);
    const p=new T.Vector3(x,v.STONE_H/2,z).project(v.camera);
    const rect=v.renderer.domElement.getBoundingClientRect();
    v.renderer.domElement.dispatchEvent(new MouseEvent('click',{clientX:rect.left+(p.x*0.5+0.5)*rect.width,clientY:rect.top+(-p.y*0.5+0.5)*rect.height,bubbles:true}));
    const before=v.stoneMap.size; for(let t=0;t<30;t++){await sleep(150); if(v.stoneMap.size>before){humanPlayed=true;break;}} }
  out.humanCanPlay={ whiteLegalMoves:moves.length, humanPlayed };

  // --- 2人戦のsetup画面（出し分けが戻るか） ---
  document.querySelector('#btn-quit')?.click(); await sleep(100);
  // メニューへ戻して2人戦を開く
  if(document.getElementById('screen-game').classList.contains('active')){ document.getElementById('btn-quit').click(); await sleep(100); }
  document.querySelector('[data-mode="2p"]').click(); await sleep(150);
  out.p2Setup={ turnHidden:!vis('field-turn'), whiteShown:vis('field-white'),
    levelHidden:!vis('field-level'), labelBlack:document.getElementById('label-black').textContent };

  out.err=window.__err;
  return out;
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
