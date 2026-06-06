// アプリ全体の設定（音量・ミュート・エフェクト演出の表示可否）。
// localStorage という信頼できない境界からの入力を normalizeSettings で必ず検証してから使う。

export const DEFAULTS = Object.freeze({
  bgmVol: 1, sfxVol: 1, bgmOn: true, sfxOn: true, effectsOn: true,
});

// マスター音量・ミュート・音量(0..1)から実効ゲインを求める（純粋）。
// ミュート時は音量に関わらず0。非ミュート時はマスター×音量。
export function effectiveGain(master, on, vol) {
  return on ? master * vol : 0;
}

export const STORAGE_KEY = "reversi.settings";

// localStorage（既定）から設定を読み込み、必ず正規化して返す。
// 値なし・壊れたJSON・storage不在のいずれでも例外を投げず既定値を返す。
export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

// 設定を正規化して localStorage（既定）へ保存する。storage不在でも黙って何もしない。
export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch {
    /* 容量超過・プライベートモード等は無視（音設定は失っても致命的でない） */
  }
}

const clamp01 = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
const asBool = (v, fallback) => (typeof v === "boolean" ? v : fallback);

// 任意の入力を安全な設定オブジェクトに正規化する（純粋）。
// 音量は[0,1]にクランプ、真偽値は型チェック、欠落・不正は既定値で補う。
export function normalizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    bgmVol: clamp01(r.bgmVol, DEFAULTS.bgmVol),
    sfxVol: clamp01(r.sfxVol, DEFAULTS.sfxVol),
    bgmOn: asBool(r.bgmOn, DEFAULTS.bgmOn),
    sfxOn: asBool(r.sfxOn, DEFAULTS.sfxOn),
    effectsOn: asBool(r.effectsOn, DEFAULTS.effectsOn),
  };
}
