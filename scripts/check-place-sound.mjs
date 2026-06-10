// 着石音バリアント（issue #6）のE2E検証——CDP発音カウント。
//   ①?debug=1 パネルに着石音テーマが出る（4案・select初期値がURL指定どおり）
//   ②各案で2手打つと、選択した案のバッファがちょうど2回鳴る（≒URL/パネル切替が音に効いている）
//   ③全ての手で2層音（出現フッ＋着地コツ）が維持される（flip_lift×4＝出現2＋号砲2、着地2、めくり着地2）
//   ④非選択案の着石音は1回も鳴らない（取り違えなし）
// 発音の同定は AudioBufferSourceNode.start をフックし、バッファ長（ms）で行う。
// 各案の再生長は識別子を兼ねて変えてある：現行420 / B(mass)550 / C(hard)320 / D(hall)950。
// ループ再生（BGM）は loop フラグで除外する。
//
// 教訓ガード（第1波レビュー由来）：
//   ・Chromeプロファイルは mkdtemp の使い捨て＋プロセス終了待ち後に削除（固定/tmpは状態持ち越し）
//   ・配信中のコードが本ブランチか必ず確認（main.js に theme_place マーカーが含まれるか）
//   ・HTTPは devserver.mjs のポート引数で 8776、CDPは 9234（他エージェントと衝突回避）
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HTTP_PORT = 8776;
const CDP_PORT = 9234;
const BASE = `http://localhost:${HTTP_PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- devserver（ポート引数対応済み）をサブプロセスで起動 ----
const server = spawn(process.execPath, [join(ROOT, "scripts", "devserver.mjs"), String(HTTP_PORT)], { stdio: "ignore" });
async function waitServer() {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`${BASE}/index.html`); if (r.ok) return; } catch {} await sleep(200); }
  throw new Error("devserver が起動しない");
}

// ---- Chrome（使い捨てプロファイル・about:blank起動→計測フック注入後にnavigate） ----
const profileDir = mkdtempSync(join(tmpdir(), "cdp-reversi-place-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run", `--user-data-dir=${profileDir}`, "--window-size=900,1500",
  "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const chromeExited = new Promise((r) => chrome.once("exit", r));

async function wsUrl() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://localhost:${CDP_PORT}/json`); const l = await r.json();
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

// 発音フック：start() されたバッファの長さ（ms丸め）とloopを window.__sndLog に記録する。
// 識別はバッファ長で行う（各案の再生長＝識別子。gen-audio.mjs のコメント参照）。
const SOUND_HOOK = `
  window.__sndLog = [];
  window.__err = []; addEventListener('error', (e) => window.__err.push(String(e.message || e.error)));
  const orig = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    window.__sndLog.push({ ms: this.buffer ? Math.round(this.buffer.duration * 1000) : -1, loop: !!this.loop });
    return orig.apply(this, a);
  };
`;

// 2人対戦を開始し、既知の合法手2手（黒(2,3)→白(2,4)）をキャンバスクリックで打つ。
// 座標投影は play-check.mjs と同じ window.__view 経由。
const PLAY_TWO_MOVES = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('[data-mode="2p"]').click(); await sleep(80);
  document.getElementById('start-game').click(); await sleep(800);
  const v = window.__view, T = v.THREE;
  const clickCell = (r, c) => {
    const { x, z } = v.cellToWorld(r, c);
    const p = new T.Vector3(x, v.STONE_H / 2, z).project(v.camera);
    const rect = v.renderer.domElement.getBoundingClientRect();
    const px = rect.left + (p.x * 0.5 + 0.5) * rect.width, py = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
    v.renderer.domElement.dispatchEvent(new MouseEvent('click', { clientX: px, clientY: py, bubbles: true }));
  };
  clickCell(2, 3); await sleep(2600); // 黒：着手アニメ＋めくり完了待ち
  clickCell(2, 4); await sleep(2600); // 白：同上
  const panel = document.querySelector('#variant-panel select[data-theme="placeSound"]');
  return { snd: window.__sndLog, err: window.__err,
           select: panel?.value ?? null, options: panel ? panel.options.length : 0 };
})()`;

// 検証対象：案ID／URL／期待するバッファ長（ms）。
// slow=1 は window.__view（盤クリックの座標投影に必要）を公開させるため。SPEED=1で速度は不変。
const CASES = [
  { id: "current", search: "?debug=1&slow=1", ms: 420 },
  { id: "mass", search: "?debug=1&slow=1&variant=placeSound:mass", ms: 550 },
  { id: "hard", search: "?debug=1&slow=1&variant=placeSound:hard", ms: 320 },
  { id: "hall", search: "?debug=1&slow=1&variant=placeSound:hall", ms: 950 },
];
const PLACE_MS = CASES.map((c) => c.ms); // 着石音ファミリーの全長（取り違え検出用）
const LIFT_MS = 100; // flip_lift.wav（出現フッ／号砲スッ）
const LAND_MS = 130; // flip_land.wav（めくり着地）
const near = (a, b) => Math.abs(a - b) <= 5; // リサンプル誤差の許容（±5ms）

(async () => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); };
  try {
    await waitServer();

    // ガード：配信中のコードが本ブランチのものか（マーカー突合）
    const mainSrc = await (await fetch(`${BASE}/src/main.js`)).text();
    const themeOk = (await fetch(`${BASE}/src/theme_place.js`)).ok;
    check("ガード: 配信コードが本ブランチ（theme_place配線済み・demo撤去済み）",
      themeOk && mainSrc.includes("theme_place.js") && !mainSrc.includes('id: "demo"'), {});

    const w = new WebSocket(await wsUrl());
    await new Promise((r) => w.addEventListener("open", r, { once: true }));
    const send = cdp(w); await send("Runtime.enable"); await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: SOUND_HOOK });

    for (const c of CASES) {
      await send("Page.navigate", { url: `${BASE}/${c.search}` });
      await sleep(1800); // 読み込み＋音源fetch/decode待ち
      const r = await evalIn(send, PLAY_TWO_MOVES);
      if (!r || !Array.isArray(r.snd)) { check(`案${c.id}: 実行失敗（ページ内例外）`, false, r ?? null); continue; }
      const sfx = r.snd.filter((s) => !s.loop); // BGM(loop)除外
      const cnt = (ms) => sfx.filter((s) => near(s.ms, ms)).length;
      const wrongPlace = PLACE_MS.filter((ms) => ms !== c.ms).reduce((n, ms) => n + cnt(ms), 0);
      check(`案${c.id}: パネルに着石音テーマ（4案・select=${c.id}）`,
        r.select === c.id && r.options === 4, { select: r.select, options: r.options });
      check(`案${c.id}: 着地音=選択案(${c.ms}ms)が2手でちょうど2回・他案0回`,
        cnt(c.ms) === 2 && wrongPlace === 0, { sfx });
      check(`案${c.id}: 2層音維持（出現+号砲=flip_lift×4・めくり着地×2）`,
        cnt(LIFT_MS) === 4 && cnt(LAND_MS) === 2, { lift: cnt(LIFT_MS), land: cnt(LAND_MS) });
      check(`案${c.id}: ページエラーなし`, r.err.length === 0, { err: r.err });
    }

    console.log(JSON.stringify(results, null, 2));
    console.log(results.every((r) => r.ok) ? "ALL PASS" : "FAIL あり");
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
    w.close();
  } catch (e) { console.error("ERR", e); process.exitCode = 1; }
  finally {
    chrome.kill();
    await chromeExited; // 終了を待ってからプロファイル削除（使い捨て徹底）
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    server.kill();
  }
})();
