// prefers-reduced-motion 自動抑制のE2E検証（issue #4・酔い対策）。
// CDPの Emulation.setEmulatedMedia で reduced-motion をエミュレートし、角の着手で
// スクリーンシェイク（カメラ座標）・置石ジッタ（石のXZ座標）が発火するか/しないかを実測する。
//   A) reduce無し・エフェクトON   → シェイク・ジッタが発火（従来どおり）
//   B) reduceをライブ有効化       → 抑制される＋基本アニメ（着手の落下）は残る（変更イベント追随の証明）
//   C) reduce有効のままリロード   → 抑制される（初期読み取り経路の証明）
//   D) reduceをライブ解除         → 再び発火（無効時は従来どおり）
//   E) reduce無し・エフェクトOFF  → 発火しない（既存トグルの動作が変わらないことの証明）
// 実行: node scripts/devserver.mjs を起動した上で node scripts/check-reduced-motion.mjs
//       （worktree並行時は PORT=8774 node scripts/devserver.mjs ＋ APP_ORIGIN=http://localhost:8774）
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9233;
const APP = process.env.APP_ORIGIN || "http://localhost:8765";
const URL_APP = `${APP}/?slow=1`; // ?slow= で window.__view が公開される
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/cdp-reversi-reduced-motion", "--window-size=900,1500",
  URL_APP], { stdio: "ignore" });
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
// reduced-motion のメディアエミュレーション（on=true で reduce、false で解除）
const setReduce = (send, on) => send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: on ? "reduce" : "" }],
});

// 対局を開始して window.__view を生成する（2人対戦・ゲスト同士）
const START_MATCH = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  window.__err=window.__err||[]; addEventListener('error',e=>window.__err.push(String(e.message||e.error)));
  document.querySelector('[data-mode="2p"]').click(); await sleep(60);
  document.getElementById('start-game').click(); await sleep(900);
  return { hasView: !!window.__view, matchMedia: matchMedia('(prefers-reduced-motion: reduce)').matches };
})()`;

// 角(r,c)へ animateMove を直接実行し、アニメ中のカメラ偏差（シェイク）・石のXZ偏差（ジッタ）・
// 石のY最大値（基本アニメ＝落下が動いている証拠）をサンプリングして返す。
const probeCorner = (r, c) => `(async()=>{
  const v = window.__view;
  const empty = Array.from({length:8},()=>Array(8).fill(0));
  const baseCam = { x: v.camera.position.x, z: v.camera.position.z };
  const rest = v.cellToWorld(${r}, ${c});
  let camDev = 0, stoneDev = 0, stoneMaxY = 0;
  const timer = setInterval(() => {
    camDev = Math.max(camDev, Math.abs(v.camera.position.x - baseCam.x), Math.abs(v.camera.position.z - baseCam.z));
    const st = v.stoneMap.get('${r},${c}');
    if (st) {
      stoneDev = Math.max(stoneDev, Math.abs(st.group.position.x - rest.x), Math.abs(st.group.position.z - rest.z));
      stoneMaxY = Math.max(stoneMaxY, st.group.position.y);
    }
  }, 16);
  await v.animateMove(empty, empty, { r: ${r}, c: ${c} }, 1, { isBig: false }); // 角＝ヒットストップ対象
  clearInterval(timer);
  return { camDev: +camDev.toFixed(4), stoneDev: +stoneDev.toFixed(4), stoneMaxY: +stoneMaxY.toFixed(4),
           reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, err: window.__err };
})()`;

// エフェクト演出トグルを設定モーダルから切り替える（実UI経由）
const setEffectsToggle = (on) => `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('gear-btn').click(); await sleep(150);
  const eff=document.getElementById('set-effects-on');
  if (eff.checked !== ${on}) { eff.checked=${on}; eff.dispatchEvent(new Event('change',{bubbles:true})); }
  document.getElementById('settings-close').click(); await sleep(120);
  return { effectsOn: ${on} };
})()`;

const FIRED = 0.05, QUIET = 0.01; // 発火判定/静止判定のしきい値（シェイク振幅1.25・ジッタ振幅約0.25に対し十分小さい）
(async () => {
  let failed = false;
  const judge = (name, probe, expectFire) => {
    const shakeOk = expectFire ? probe.camDev > FIRED : probe.camDev < QUIET;
    const jitterOk = expectFire ? probe.stoneDev > FIRED : probe.stoneDev < QUIET;
    const baseOk = probe.stoneMaxY > 0.2; // 着手の落下（基本アニメ）は常に動く
    const ok = shakeOk && jitterOk && baseOk && probe.err.length === 0;
    if (!ok) failed = true;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: camDev=${probe.camDev} stoneDev=${probe.stoneDev} ` +
      `stoneMaxY=${probe.stoneMaxY} reduce=${probe.reduce} err=${JSON.stringify(probe.err)}`);
  };
  try {
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    await sleep(1600);

    // A) reduce無し・エフェクトON → 発火する（従来どおり）
    const s0 = await evalIn(send, START_MATCH);
    if (!s0?.hasView) throw new Error("view が生成されていない: " + JSON.stringify(s0));
    judge("A reduce無し→発火", await evalIn(send, probeCorner(0, 0)), true);

    // B) reduce をライブ有効化（リロード無し）→ 変更イベント追随で抑制される
    await setReduce(send, true); await sleep(300);
    judge("B reduceライブ有効化→抑制（変更イベント追随）", await evalIn(send, probeCorner(0, 7)), false);

    // C) reduce 有効のままリロード → 初期読み取り経路でも抑制される
    await send("Page.navigate", { url: URL_APP }); await sleep(1800);
    const s1 = await evalIn(send, START_MATCH);
    if (!s1?.matchMedia) throw new Error("リロード後に reduce が効いていない: " + JSON.stringify(s1));
    judge("C reduce有効でリロード→抑制（初期読み取り）", await evalIn(send, probeCorner(0, 0)), false);

    // D) reduce をライブ解除 → 再び発火（無効時は従来どおり）
    await setReduce(send, false); await sleep(300);
    judge("D reduceライブ解除→再び発火", await evalIn(send, probeCorner(0, 7)), true);

    // E) reduce無し・エフェクト演出OFF → 発火しない（既存トグルの動作は不変）
    await evalIn(send, setEffectsToggle(false));
    judge("E reduce無し・トグルOFF→発火しない（既存粒度）", await evalIn(send, probeCorner(7, 0)), false);

    console.log(failed ? "RESULT: FAIL" : "RESULT: ALL PASS");
    w.close();
  } catch (e) { console.error("ERR", e); failed = true; } finally { chrome.kill(); process.exit(failed ? 1 : 0); }
})();
