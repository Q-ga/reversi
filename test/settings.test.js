import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, normalizeSettings, effectiveGain } from "../src/settings.js";

test("normalizeSettings: 入力なしで既定値（音量100%・全ON）", () => {
  assert.deepEqual(normalizeSettings(), {
    bgmVol: 1, sfxVol: 1, bgmOn: true, sfxOn: true, effectsOn: true,
  });
  assert.deepEqual(normalizeSettings(), DEFAULTS);
});

test("normalizeSettings: 部分入力は欠けた項目を既定値で補う", () => {
  const s = normalizeSettings({ bgmVol: 0.5, effectsOn: false });
  assert.equal(s.bgmVol, 0.5);
  assert.equal(s.effectsOn, false);
  assert.equal(s.sfxVol, 1);   // 未指定→既定
  assert.equal(s.bgmOn, true); // 未指定→既定
});

test("normalizeSettings: 範囲外の音量は[0,1]にクランプ", () => {
  assert.equal(normalizeSettings({ bgmVol: 1.7 }).bgmVol, 1);
  assert.equal(normalizeSettings({ sfxVol: -3 }).sfxVol, 0);
});

test("normalizeSettings: 不正な型・破損入力は既定値にフォールバック", () => {
  // 文字列音量・NaN・真偽値でないトグル・null/配列/文字列ごと
  assert.deepEqual(normalizeSettings({ bgmVol: "loud", bgmOn: 1, sfxVol: NaN }), DEFAULTS);
  assert.deepEqual(normalizeSettings(null), DEFAULTS);
  assert.deepEqual(normalizeSettings("garbage"), DEFAULTS);
  assert.deepEqual(normalizeSettings([1, 2, 3]), DEFAULTS);
});

test("effectiveGain: ミュートONなら音量に関わらず0", () => {
  assert.equal(effectiveGain(0.55, false, 1), 0);
  assert.equal(effectiveGain(0.9, false, 0.5), 0);
});

test("effectiveGain: 非ミュートはマスター×音量", () => {
  assert.equal(effectiveGain(0.55, true, 1), 0.55);   // 100%=マスターそのまま
  assert.equal(effectiveGain(0.9, true, 0.5), 0.45);  // 50%
  assert.equal(effectiveGain(0.55, true, 0), 0);      // 音量0=無音
});

import { loadSettings, saveSettings, STORAGE_KEY } from "../src/settings.js";

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

test("saveSettings→loadSettings: 保存した設定が復元される", () => {
  const st = fakeStorage();
  saveSettings({ bgmVol: 0.3, sfxOn: false, effectsOn: false }, st);
  const loaded = loadSettings(st);
  assert.equal(loaded.bgmVol, 0.3);
  assert.equal(loaded.sfxOn, false);
  assert.equal(loaded.effectsOn, false);
  assert.equal(loaded.sfxVol, 1); // 未保存項目は既定
});

test("loadSettings: 値が無ければ既定値", () => {
  assert.deepEqual(loadSettings(fakeStorage()), DEFAULTS);
});

test("loadSettings: 壊れたJSONでも例外を投げず既定値", () => {
  assert.deepEqual(loadSettings(fakeStorage({ [STORAGE_KEY]: "{bad json" })), DEFAULTS);
});
