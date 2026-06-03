// 対局記録の書き出し整形（純粋）。CSV=Sheets貼り付け用 / JSON=棋譜構造保持。

const CSV_HEADER = [
  "date", "mode", "level", "hints",
  "black_name", "black_kind", "white_name", "white_kind",
  "winner", "black_count", "white_count", "duration_sec", "kifu",
];

function esc(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCSV(games) {
  const lines = [CSV_HEADER.join(",")];
  for (const g of games) {
    lines.push([
      g.date, g.mode, g.level ?? "", g.hints ? 1 : 0,
      g.black.name, g.black.kind, g.white.name, g.white.kind,
      g.result.winner, g.result.black, g.result.white,
      Math.round((g.durationMs ?? 0) / 1000), g.kifu ?? "",
    ].map(esc).join(","));
  }
  return lines.join("\n");
}

export function buildJSON(games) {
  return JSON.stringify(games, null, 2);
}
