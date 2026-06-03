// 対局記録からの戦績集計（純粋）。登録ユーザーのみ個人集計対象。
//
// record 形:
// {
//   date, mode:'2p'|'cpu', level, hints, durationMs,
//   black: { kind:'user'|'guest'|'cpu', id, name },
//   white: { kind, id, name },
//   result: { winner:'black'|'white'|'draw', black:n, white:n },
//   kifu
// }

function emptysplit() {
  return { games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 };
}

function rate(wins, games) {
  return games === 0 ? 0 : Math.round((wins / games) * 1000) / 10; // %（小数1桁）
}

// 指定ユーザーIDの通算＋先攻(黒)/後攻(白)別の成績。
export function statsForUser(records, userId) {
  const total = emptysplit();
  const asBlack = emptysplit();
  const asWhite = emptysplit();

  for (const rec of records) {
    let side = null;
    if (rec.black.kind === "user" && rec.black.id === userId) side = "black";
    else if (rec.white.kind === "user" && rec.white.id === userId) side = "white";
    if (!side) continue;

    const bucket = side === "black" ? asBlack : asWhite;
    total.games++;
    bucket.games++;

    const w = rec.result.winner;
    if (w === "draw") {
      total.draws++;
      bucket.draws++;
    } else if (w === side) {
      total.wins++;
      bucket.wins++;
    } else {
      total.losses++;
      bucket.losses++;
    }
  }

  total.winRate = rate(total.wins, total.games);
  asBlack.winRate = rate(asBlack.wins, asBlack.games);
  asWhite.winRate = rate(asWhite.wins, asWhite.games);
  return { total, asBlack, asWhite };
}

// 2人の登録ユーザー間の直接対決成績（aから見た勝敗）。
export function headToHead(records, idA, idB) {
  const res = { games: 0, winsA: 0, winsB: 0, draws: 0 };
  for (const rec of records) {
    const aSide = rec.black.kind === "user" && rec.black.id === idA ? "black"
      : rec.white.kind === "user" && rec.white.id === idA ? "white" : null;
    const bSide = rec.black.kind === "user" && rec.black.id === idB ? "black"
      : rec.white.kind === "user" && rec.white.id === idB ? "white" : null;
    if (!aSide || !bSide) continue;

    res.games++;
    const w = rec.result.winner;
    if (w === "draw") res.draws++;
    else if (w === aSide) res.winsA++;
    else res.winsB++;
  }
  return res;
}
