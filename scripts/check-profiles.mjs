// 登録上限10人＋戦績の「2人選んで直接対決」UIを検証する使い捨てスクリプト。
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9227;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-prof", "--window-size=900,1500",
  "http://localhost:8765/"], { stdio: "ignore" });
async function wsUrl() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://localhost:${PORT}/json`); const l = await r.json();
    const p = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error("no target"); }
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
  const err=[]; addEventListener('error',e=>err.push(String(e.message||e.error)));
  // プロフィール画面で3人登録（2人超を許可できるか）
  document.getElementById('go-profiles').click(); await sleep(300);
  for (const name of ['あつ','とも','けん']) {
    const inp=[...document.querySelectorAll('#profiles-body input')].pop();
    inp.value=name; inp.dispatchEvent(new Event('input'));
    const addBtn=inp.parentElement.querySelector('button');
    addBtn.click(); await sleep(350);
  }
  const profCount=document.querySelectorAll('#profiles-body .prof-row input').length - 1; // 末尾は新規追加行
  // メニュー→戦績へ
  document.querySelector('#screen-profiles [data-back="menu"]').click(); await sleep(150);
  document.getElementById('go-stats').click(); await sleep(400);
  const a=document.getElementById('h2h-a'), b=document.getElementById('h2h-b');
  const before = document.getElementById('h2h-result')?.textContent?.trim();
  // selBを別の人に変えて結果が更新されるか
  let changed=null;
  if (a && b) {
    b.selectedIndex = 2; b.dispatchEvent(new Event('change')); await sleep(100);
    changed = document.getElementById('h2h-result')?.textContent?.trim();
    // 同じ人を選ぶと警告が出るか
    b.selectedIndex = 0; a.selectedIndex = 0; b.dispatchEvent(new Event('change')); await sleep(100);
  }
  const sameWarn = document.getElementById('h2h-result')?.textContent?.includes('違う2人');
  const statBlocks = document.querySelectorAll('#stats-body .stat-block').length;
  return {
    registered: profCount,
    h2hExists: !!(a&&b),
    optionCount: a ? a.options.length : 0,
    resultShown: !!before,
    changeWorks: changed!==null,
    sameWarn,
    statBlocks,
    err,
  };
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
