// 開発用の静的サーバー（キャッシュ無効）。
//   実行: node scripts/devserver.mjs [port]   → http://localhost:8765（既定）
//   ポートは第1引数または環境変数 PORT で変更可（複数エージェント並行作業時の衝突回避）。
// no-store ヘッダでブラウザが古いJS/音を保持しないようにする（開発中のキャッシュ事故防止）。
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8765);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`不正なポート指定です: ${process.argv[2] ?? process.env.PORT}`);
  process.exit(1);
}
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".wav": "audio/wav", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml",
};

http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const fp = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ""));
  try {
    const data = await readFile(fp);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Content-Type", TYPES[extname(fp)] || "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(PORT, () => console.log(`dev server (no-cache) → http://localhost:${PORT}`));
