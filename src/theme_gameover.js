// 終局音バリアント（#8・比較ビルド）のテーマ定義。
// CONTEXT.md「スポット演出」終局/完封：v1落第リスト5「終局音がしょぼい」への豪華化案を
// 比較ビルド（?debug=1 パネル／?variant=gameoverSound:案ID）で切替・検収する。
// テーマ定義はこのモジュールに閉じ、main.js には import＋登録＋適用の最小配線だけを置く。
//
// sounds の形式は audio.js の EVENT_SOUND と同じ { タグ: [バッファ名, ゲイン] }。
// 勝ち（gameover）／引き分け（gameover-draw）／完封（shutout）の出し分け構造は全案で共通。
//
// 完封の設計メモ：events.js は完封時に gameover と shutout を同時に発火し、両方の音が
// 重なって鳴る（既定案は fanfare_win の重ね掛け＝音量増）。新案では完封専用の
// きらめき/クラッシュ音を別ファイルにし、勝利ファンファーレへの「加算」で豪華になるようにした。

export const GAMEOVER_THEME_ID = "gameoverSound";

export const GAMEOVER_THEME = Object.freeze({
  id: GAMEOVER_THEME_ID,
  label: "終局音",
  defaultId: "classic",
  variants: [
    {
      id: "classic",
      label: "既定（現状）",
      // audio.js の現行 EVENT_SOUND と同値＝既定では挙動不変
      sounds: {
        gameover: ["fanfare_win", 1.0],
        "gameover-draw": ["fanfare_lose", 0.7],
        shutout: ["fanfare_win", 1.0],
      },
    },
    {
      id: "royal",
      label: "案B ロイヤル（ブラス＋ベル）",
      // デチューン重ねのブラス和音＋ベル対旋律＋深いリバーブ（gen-audio.mjs 終局音バリアント節）
      sounds: {
        gameover: ["fanfare_win_royal", 1.0],
        "gameover-draw": ["fanfare_lose_royal", 0.7],
        shutout: ["fanfare_shutout_royal", 0.9],
      },
    },
    {
      id: "orchestra",
      label: "案C オーケストラ（ティンパニ＋ヒット）",
      // ティンパニロール＋ブラスヒット連打＋シンバル様クラッシュ＋深いリバーブ
      sounds: {
        gameover: ["fanfare_win_orch", 1.0],
        "gameover-draw": ["fanfare_lose_orch", 0.7],
        shutout: ["fanfare_shutout_orch", 0.9],
      },
    },
  ],
});

// レジストリへテーマを登録する（main.js の起動配線から resolve より前に呼ぶ）
export function registerGameoverTheme(reg) {
  reg.register(GAMEOVER_THEME);
}

// 正規化済み選択から、適用すべき音割り当て（sounds）を返す（純粋）。
// テーマ未登録なら null（適用側 audio.applyGameoverVariant は null を無視する）。
export function gameoverSoundsFor(reg, selection) {
  return reg.variantOf(GAMEOVER_THEME_ID, selection)?.sounds ?? null;
}
