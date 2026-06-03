// スポット演出のビジュアル。メリハリ型：普段は控えめ、山場のみ派手。
import { playEventSound } from "./audio.js";

function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth; // reflowでアニメ再起動
  el.classList.add("shake");
}

function banner(layer, text, cls = "") {
  const b = document.createElement("div");
  b.className = "banner " + cls;
  b.textContent = text;
  layer.appendChild(b);
  setTimeout(() => b.remove(), 1400);
}

function particles(layer, x, y, color = "#ffd54a", n = 14) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const dist = 40 + Math.random() * 50;
    p.style.left = x + "px";
    p.style.top = y + "px";
    p.style.background = color;
    p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
    p.style.setProperty("--dy", Math.sin(ang) * dist + "px");
    layer.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
}

function flash(layer, color = "rgba(255,255,255,0.25)") {
  const f = document.createElement("div");
  f.className = "flash";
  f.style.background = color;
  layer.appendChild(f);
  setTimeout(() => f.remove(), 350);
}

// tags配列に応じて演出を発火。ctx={ boardEl, fxLayer, lastCell:{x,y}, flippedCount }
export function applyEffects(tags, ctx) {
  const { boardEl, fxLayer } = ctx;
  for (const tag of tags) {
    playEventSound(tag);
    switch (tag) {
      case "bigFlip":
        banner(fxLayer, `${ctx.flippedCount}枚返し！`, "combo");
        shake(boardEl);
        if (ctx.lastCell) particles(fxLayer, ctx.lastCell.x, ctx.lastCell.y, "#7CFC98");
        break;
      case "corner":
        banner(fxLayer, "角ゲット！", "corner");
        if (ctx.lastCell) particles(fxLayer, ctx.lastCell.x, ctx.lastCell.y, "#ffd54a", 20);
        break;
      case "reversal":
        banner(fxLayer, "逆転！", "reversal");
        shake(boardEl);
        flash(fxLayer, "rgba(56,189,248,0.25)");
        break;
      case "gameover-win":
        banner(fxLayer, "勝利！", "win");
        flash(fxLayer, "rgba(255,213,74,0.3)");
        break;
      case "gameover-lose":
        banner(fxLayer, "敗北…", "lose");
        break;
      case "gameover-draw":
        banner(fxLayer, "引き分け", "");
        break;
      case "shutout":
        banner(fxLayer, "完封！", "win");
        break;
      case "pass":
        banner(fxLayer, "パス", "small");
        break;
      default:
        break;
    }
  }
}
