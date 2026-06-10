// 比較ビルドのバリアント切替パネル（審査UI）。?debug=1 のときだけ main.js から呼ばれる。
// フラグ無しではこのモジュールの関数自体が呼ばれず、DOMには一切生成されない。
// 切替はシンプル優先：URLの variant パラメータを書き換えてリロードし、全体を再初期化する
// （状態のホットスワップはしない）。
import { buildVariantParam } from "./variants.js";

// パネルのスタイル。index.html のCSSには触れず、デバッグ専用としてここに閉じ込める。
const PANEL_CSS = `
#variant-panel { position: fixed; left: 8px; bottom: 8px; z-index: 9999;
  background: rgba(10,10,11,.92); border: 1px solid #3a3320; border-radius: 10px;
  padding: 10px 12px; color: #ece3cf; font-size: 12px; max-width: 250px;
  box-shadow: 0 6px 18px rgba(0,0,0,.6); }
#variant-panel h3 { margin: 0 0 6px; font-size: 12px; color: #d9b75d; letter-spacing: 1px; }
#variant-panel .vp-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
#variant-panel .vp-row label { flex: 1; color: #9c9276; }
#variant-panel select { background: #15130d; color: #ece3cf; border: 1px solid #3a3320;
  border-radius: 6px; padding: 4px 6px; font-size: 12px; max-width: 130px; }
`;

// パネルを生成して document.body に取り付ける。
// registry: variants.js のレジストリ／selection: resolve 済みの選択（全テーマぶん）。
export function mountDebugPanel(registry, selection, doc = document) {
  const style = doc.createElement("style");
  style.textContent = PANEL_CSS;
  doc.head.appendChild(style);

  const panel = doc.createElement("div");
  panel.id = "variant-panel";
  const title = doc.createElement("h3");
  title.textContent = "比較ビルド";
  panel.appendChild(title);

  for (const theme of registry.list()) {
    const row = doc.createElement("div");
    row.className = "vp-row";
    const label = doc.createElement("label");
    label.textContent = theme.label;
    const select = doc.createElement("select");
    select.dataset.theme = theme.id; // CDP検証・スタイル付けの取っ掛かり
    for (const v of theme.variants) {
      const opt = doc.createElement("option");
      opt.value = v.id;
      opt.textContent = v.label;
      opt.selected = v.id === selection[theme.id];
      select.appendChild(opt);
    }
    // 変更したら URL を書き換えてリロード（debug=1 等の他パラメータは維持する）
    select.addEventListener("change", () => {
      const next = { ...selection, [theme.id]: select.value };
      applySelectionToUrl(registry, next, doc.defaultView.location);
    });
    row.appendChild(label);
    row.appendChild(select);
    panel.appendChild(row);
  }
  doc.body.appendChild(panel);
  return panel;
}

// 選択を URL の variant パラメータへ反映して遷移する（リロード方式）。
function applySelectionToUrl(registry, selection, location) {
  const url = new URL(location.href);
  const param = buildVariantParam(registry.list(), selection);
  url.searchParams.delete("variant");
  if (param) url.searchParams.set("variant", param);
  location.assign(url.toString());
}
