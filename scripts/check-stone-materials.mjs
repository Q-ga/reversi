// 石マテリアルバリアントのE2E検証（issue #9）：
//   ①既定（指定なし）は現状マテリアル（MeshStandardMaterial）のまま＝見た目を変えない
//   ②黒バリアント（piano/urushi）が MeshPhysicalMaterial＋clearcoat＋envMap で適用される
//   ③黒バリアントの黒石輝度が現状から大きく浮かない（数値判定：平均輝度差 ≤ +6/255）
//   ④白バリアント（pearl/porcelain）が適用され、白石の明るさが保たれる
//   ⑤?debug=1 のパネルに「石（黒）」「石（白）」テーマが3案ずつ並ぶ
// 輝度計測：?slow=1 で公開される window.__view を使い、直接レンダ直後に gl.readPixels で
// 初期配置の黒石(3,4)(4,3)・白石(3,3)(4,4)の上面ディスクをサンプリングする
// （bloom無しの直接レンダ＝マテリアル差だけを比較。スクリーンショットは通常のbloom込み）。
// ポートは他エージェントとの衝突回避のため devserver=8779 / CDP=9237 を使う。
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HTTP_PORT = 8779;
const CDP_PORT = 9237;
const BASE = `http://localhost:${HTTP_PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LUM_TOLERANCE = 6; // 黒石平均輝度の許容上昇（0-255スケール、≈2.4%）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 内蔵静的サーバ（devserver.mjs と同じ no-store 方式・ポートだけ専用）
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".wav": "audio/wav", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml",
};
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const fp = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ""));
  try {
    const data = await readFile(fp);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Content-Type", TYPES[extname(fp)] || "application/octet-stream");
    res.end(data);
  } catch { res.statusCode = 404; res.end("not found"); }
}).listen(HTTP_PORT);

// プロファイルは実行ごとに使い捨て（前回実行のlocalStorage持ち越しによる偽陽性/偽陰性を防ぐ）。
// 終了待ち後に削除する。
const PROFILE = mkdtempSync(join(tmpdir(), "cdp-reversi-stone-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run", `--user-data-dir=${PROFILE}`, "--window-size=900,1500",
  `${BASE}/`], { stdio: "ignore" });

async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${CDP_PORT}/json`);
      const l = await r.json();
      // 接続先ガード：このスクリプトが立てたサーバ(BASE)のページ以外には接続しない
      const p = l.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.startsWith(BASE));
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error(`no target on ${BASE}`);
}
function cdp(w) { let id = 0; const p = new Map();
  w.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
  return (method, params = {}) => new Promise((res) => { const i = ++id; p.set(i, res); w.send(JSON.stringify({ id: i, method, params })); }); }
const evalIn = async (send, expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log("EXC:", JSON.stringify(r.result.exceptionDetails.exception));
  return r.result?.result?.value;
};

// 対局を開始して window.__view を生成する（2人対戦・ゲスト同士＝CPUが動かず盤面が安定）
const START_MATCH = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  document.querySelector('[data-mode="2p"]').click(); await sleep(60);
  document.getElementById('start-game').click(); await sleep(900);
  return { hasView: !!window.__view };
})()`;

// 初期配置の石の上面ディスクをピクセルサンプリングして輝度統計を返す。
// 直接レンダ（composer/bloom無し）と readPixels を同一タスク内で行う
// （preserveDrawingBuffer無しでもバッファが有効なうちに読める）。
const PROBE = `(()=>{
  const v = window.__view;
  if (!v) return { err: "no view" };
  v.renderer.render(v.scene, v.camera);
  const gl = v.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const lum = (x, y) => { // x,y=上原点 → readPixelsの行は下原点
    const i = ((H - 1 - y) * W + x) * 4;
    return 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
  };
  const proj = (wx, wy, wz) => {
    const p = new v.THREE.Vector3(wx, wy, wz).project(v.camera);
    return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H };
  };
  const discStats = (r, c) => { // マス(r,c)の石上面を半径85%までサンプル（縁のAAを避ける）
    const { x: wx, z: wz } = v.cellToWorld(r, c);
    const ctr = proj(wx, v.STONE_H, wz);
    const edge = proj(wx + v.STONE_R, v.STONE_H, wz);
    const pr = Math.hypot(edge.x - ctr.x, edge.y - ctr.y) * 0.85;
    const vals = [];
    for (let dy = -pr; dy <= pr; dy++) for (let dx = -pr; dx <= pr; dx++) {
      if (dx * dx + dy * dy > pr * pr) continue;
      const px = Math.round(ctr.x + dx), py = Math.round(ctr.y + dy);
      if (px >= 0 && py >= 0 && px < W && py < H) vals.push(lum(px, py));
    }
    vals.sort((a, b) => a - b);
    const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
    return { mean, max: vals[vals.length - 1], p95: vals[Math.floor(vals.length * 0.95)], n: vals.length };
  };
  const pair = (a, b) => ({
    mean: +((a.mean + b.mean) / 2).toFixed(2),
    max: +Math.max(a.max, b.max).toFixed(2),
    p95: +Math.max(a.p95, b.p95).toFixed(2),
  });
  // 初期配置: 黒=(3,4),(4,3) 白=(3,3),(4,4)
  const black = pair(discStats(3, 4), discStats(4, 3));
  const white = pair(discStats(3, 3), discStats(4, 4));
  const matInfo = (key, faceIdx) => {
    const m = v.stoneMap.get(key).group.children[faceIdx === 1 ? 0 : 1].material[faceIdx];
    return { type: m.type, clearcoat: m.clearcoat ?? null, env: !!m.envMap, iridescence: m.iridescence ?? null };
  };
  return { black, white, blackMat: matInfo("3,4", 1), whiteMat: matInfo("3,3", 2) };
})()`;

(async () => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); };
  const shot = async (send, file) => {
    const cap = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(cap.result.data, "base64"));
    console.log("screenshot:", file);
  };
  try {
    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    const goto = async (url) => { await send("Page.navigate", { url }); await sleep(1500); };
    const measure = async (query) => {
      await goto(`${BASE}/?slow=1${query}`);
      const started = await evalIn(send, START_MATCH);
      if (!started?.hasView) throw new Error(`viewが生成されない: ${query}`);
      return evalIn(send, PROBE);
    };

    // ① 既定＝現状マテリアル（基準値の取得を兼ねる）
    const base = await measure("");
    check("① 既定は現状マテリアル（MeshStandard・envMap無し）",
      base.blackMat.type === "MeshStandardMaterial" && base.blackMat.env === false
      && base.whiteMat.type === "MeshStandardMaterial", base);
    await shot(send, "/tmp/reversi-stone-current.png");

    // ②③ 黒バリアント：物理マテリアル適用＋輝度が浮かない
    for (const id of ["piano", "urushi"]) {
      const r = await measure(`&variant=stoneBlack:${id}`);
      check(`② 黒[${id}] MeshPhysical＋clearcoat＋envMap が適用`,
        r.blackMat.type === "MeshPhysicalMaterial" && r.blackMat.clearcoat >= 0.6 && r.blackMat.env === true,
        r.blackMat);
      const diff = +(r.black.mean - base.black.mean).toFixed(2);
      check(`③ 黒[${id}] 平均輝度差 ${diff} ≤ +${LUM_TOLERANCE}（基準 ${base.black.mean} → ${r.black.mean}）`,
        diff <= LUM_TOLERANCE, { base: base.black, variant: r.black });
      await shot(send, `/tmp/reversi-stone-black-${id}.png`);
    }

    // ④ 白バリアント：物理マテリアル適用＋白石の明るさが保たれる（基準の9割以上）
    for (const id of ["pearl", "porcelain"]) {
      const r = await measure(`&variant=stoneWhite:${id}`);
      check(`④ 白[${id}] MeshPhysical 適用＆白の明るさ維持（${base.white.mean} → ${r.white.mean}）`,
        r.whiteMat.type === "MeshPhysicalMaterial" && r.whiteMat.clearcoat >= 0.6
        && r.white.mean >= base.white.mean * 0.9, { whiteMat: r.whiteMat, white: r.white });
      await shot(send, `/tmp/reversi-stone-white-${id}.png`);
    }

    // ⑤ ?debug=1：パネルに両テーマが3案ずつ＋黒白同時指定が反映される
    await goto(`${BASE}/?slow=1&debug=1&variant=stoneBlack:piano,stoneWhite:pearl`);
    const panel = await evalIn(send, `(()=>{
      const sel = (t) => document.querySelector('#variant-panel select[data-theme="'+t+'"]');
      const b = sel("stoneBlack"), w = sel("stoneWhite");
      return { black: b && { value: b.value, options: b.options.length },
               white: w && { value: w.value, options: w.options.length } };
    })()`);
    check("⑤ ?debug=1 パネルに石（黒）/石（白）が3案ずつ＆選択反映",
      panel.black?.options === 3 && panel.white?.options === 3
      && panel.black?.value === "piano" && panel.white?.value === "pearl", panel);
    await evalIn(send, START_MATCH);
    await shot(send, "/tmp/reversi-stone-debug-panel.png");

    console.log(JSON.stringify(results, null, 2));
    console.log(results.every((r) => r.ok) ? "ALL PASS" : "FAIL あり");
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
    w.close();
  } catch (e) { console.error("ERR", e); process.exitCode = 1; } finally {
    chrome.kill();
    await new Promise((r) => chrome.once("exit", r)); // 終了待ち後にプロファイル削除
    rmSync(PROFILE, { recursive: true, force: true });
    server.close();
    process.exit();
  }
})();
