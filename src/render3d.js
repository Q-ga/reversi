// three.js による3D盤・石の描画。
// 盤=提供画像をフラット面に貼る／石=厚みのある面取りオセロ石(黒上/白下の2段円柱)。
// 真上見下ろしカメラ、ソフトシャドウ。クリックはレイキャストでマスに変換。
// R1: 静的配置＋クリック。めくりアニメ(R2)/演出(R4)は後続で差し込む。
import * as THREE from "three";
import { EffectComposer } from "../vendor/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/jsm/postprocessing/OutputPass.js";
import { SIZE, EMPTY, BLACK, legalMoves } from "./rules.js";

const BOARD = 10; // 盤プレーンのワールドサイズ
// 提供画像(1254px)の金グリッド線位置 → マス中心の正規化座標(0..1)
const LINES = [46, 190, 336, 482, 627, 772, 916, 1062, 1205].map((p) => p / 1254);
const CENTERS = LINES.slice(0, 8).map((_, i) => (LINES[i] + LINES[i + 1]) / 2);
const PITCH = (LINES[8] - LINES[0]) / 8; // 1マスの正規化幅
const STONE_R = PITCH * BOARD * 0.42; // 直径≈マスの0.84（実物比）
const STONE_H = STONE_R * 0.42;       // 厚み≈直径の0.21（薄いコイン）

// マス(r,c)→ワールド座標。c=列(x), r=行(z)。行0を画面奥(-z)に。
function cellToWorld(r, c) {
  const x = (CENTERS[c] - 0.5) * BOARD;
  const z = (CENTERS[r] - 0.5) * BOARD;
  return { x, z };
}

export function createBoardView(container, onCell, textureUrl = "./textures/board.png") {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";

  const scene = new THREE.Scene();
  // デバッグ用：?slow=6 でアニメをN倍遅くして途中コマを確認できる
  const SPEED = Math.max(1, Number(new URLSearchParams(location.search).get("slow")) || 1);

  // カメラ：真上から見下ろし（ごく僅かに寄せて浮上した石が分かる程度）
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 18, 1.6);
  camera.lookAt(0, 0, 0);

  // bloom後処理（明るい演出だけが発光してにじむ。盤/石は閾値以下で発光しない）
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass()); // トーンマッピング＋sRGB変換（盤が黒くならないように最終変換）

  // ライト：均一に当てて中央ハイライト(=球っぽさ)を作らない。
  // 石の陰影は面テクスチャ(中央暗→縁明)で出し、影は接地用にだけ落とす。
  scene.add(new THREE.HemisphereLight(0xffffff, 0x39414c, 1.0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 0.5);
  key.position.set(-3, 13, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  const sc = key.shadow.camera;
  sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7;
  key.shadow.bias = -0.0006;
  key.shadow.radius = 5;
  scene.add(key);

  // 盤（画像を貼った薄い箱）
  const tex = new THREE.TextureLoader().load(textureUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.0 });
  const boardEdgeMat = new THREE.MeshStandardMaterial({ color: 0x1c130a, roughness: 0.8 });
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD, 0.5, BOARD),
    [boardEdgeMat, boardEdgeMat, boardMat, boardEdgeMat, boardEdgeMat, boardEdgeMat]
  );
  board.position.y = -0.25;
  board.receiveShadow = true;
  scene.add(board);

  // 石の面テクスチャ：中央暗→縁明（フラットな円盤に見せ、碁石=中央ハイライトの球を避ける）
  function makeDiscTexture(stops) {
    const s = 256;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.5);
    for (const [pos, col] of stops) g.addColorStop(pos, col);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.5, 0, Math.PI * 2); ctx.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  const blackFaceTex = makeDiscTexture([[0, "#000000"], [0.75, "#020202"], [0.93, "#070707"], [0.99, "#0d0d0d"], [1, "#050505"]]);
  const whiteFaceTex = makeDiscTexture([[0, "#d4d2c9"], [0.5, "#e6e4dc"], [0.88, "#ffffff"], [1, "#efeee7"]]);

  // 黒=上半分（上面＝顔テクスチャ／側面＝黒）、白=下半分（下面＝顔テクスチャ／側面＝白）
  const blackFaceMat = new THREE.MeshStandardMaterial({ map: blackFaceTex, roughness: 0.4, metalness: 0.0 });
  const blackEdgeMat = new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.55, metalness: 0.0 });
  const whiteFaceMat = new THREE.MeshStandardMaterial({ map: whiteFaceTex, roughness: 0.55, metalness: 0.0 });
  const whiteEdgeMat = new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.6, metalness: 0.0 });

  // 石ジオメトリ：上半分(黒)＋下半分(白)の2段円柱。赤道で黒白が分かれ、90°で半々の断面が出る。
  // CylinderGeometryのマテリアル配列順 = [側面, 上面cap, 下面cap]
  function makeStone() {
    const g = new THREE.Group();
    const upper = new THREE.Mesh(
      new THREE.CylinderGeometry(STONE_R, STONE_R, STONE_H / 2, 56),
      [blackEdgeMat, blackFaceMat, blackEdgeMat] // 上面=黒テクスチャ、下面(赤道側)は隠れる
    );
    upper.position.y = STONE_H / 4;
    const lower = new THREE.Mesh(
      new THREE.CylinderGeometry(STONE_R, STONE_R, STONE_H / 2, 56),
      [whiteEdgeMat, whiteEdgeMat, whiteFaceMat] // 下面=白テクスチャ、上面(赤道側)は隠れる
    );
    lower.position.y = -STONE_H / 4;
    for (const m of [upper, lower]) { m.castShadow = true; m.receiveShadow = false; }
    g.add(upper, lower);
    return g;
  }

  // 合法手ヒント（淡い金の薄板）
  const hintMat = new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.32 });
  const hintGeo = new THREE.CircleGeometry(STONE_R * 0.32, 24);
  const hints = new THREE.Group();
  scene.add(hints);

  const stoneGroup = new THREE.Group();
  scene.add(stoneGroup);
  const stoneMap = new Map(); // "r,c" -> {group, color}

  function colorToFlip(color) { return color === BLACK ? 0 : Math.PI; }

  function placeStone(r, c, color, instant = true) {
    const key = `${r},${c}`;
    let entry = stoneMap.get(key);
    if (!entry) {
      const group = makeStone();
      const { x, z } = cellToWorld(r, c);
      group.position.set(x, STONE_H / 2, z);
      stoneGroup.add(group);
      entry = { group, color };
      stoneMap.set(key, entry);
    }
    entry.color = color;
    if (instant) {
      entry.group.rotation.z = colorToFlip(color); // Z軸=左右(左から)めくり
      entry.group.position.y = STONE_H / 2;
      entry.group.scale.setScalar(1);
    }
    return entry;
  }

  function removeStone(r, c) {
    const key = `${r},${c}`;
    const e = stoneMap.get(key);
    if (e) { stoneGroup.remove(e.group); stoneMap.delete(key); }
  }

  // 全面同期（初期化/リセット/待った）。アニメ無し。進行中トゥイーンは破棄。
  function sync(state, showHints) {
    tweens.clear();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = state.board[r][c];
        if (v === EMPTY) removeStone(r, c);
        else placeStone(r, c, v, true);
      }
    }
    renderHints(state, showHints);
  }

  function renderHints(state, showHints) {
    hints.clear();
    if (state.over || !showHints) return;
    for (const [r, c] of legalMoves(state.board, state.current)) {
      const m = new THREE.Mesh(hintGeo, hintMat);
      const { x, z } = cellToWorld(r, c);
      m.position.set(x, 0.02, z);
      m.rotation.x = -Math.PI / 2;
      hints.add(m);
    }
  }
  function clearHints() { hints.clear(); }

  // レイキャストでクリック→マス
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const px = (ev.clientX ?? ev.touches?.[0]?.clientX) - rect.left;
    const py = (ev.clientY ?? ev.touches?.[0]?.clientY) - rect.top;
    ndc.x = (px / rect.width) * 2 - 1;
    ndc.y = -(py / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(board, false)[0];
    if (!hit) return;
    // ワールド→正規化→最寄りマス
    const fx = hit.point.x / BOARD + 0.5;
    const fz = hit.point.z / BOARD + 0.5;
    const c = nearestIndex(fx), r = nearestIndex(fz);
    if (r >= 0 && c >= 0) onCell(r, c);
  }
  function nearestIndex(frac) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < 8; i++) { const d = Math.abs(frac - CENTERS[i]); if (d < bd) { bd = d; best = i; } }
    return bd < PITCH * 0.6 ? best : -1;
  }
  renderer.domElement.addEventListener("click", pick);

  // リサイズ（正方形に保つ）
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight || w;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // --- トゥイーン基盤（描画ループで毎フレーム更新） ---
  const tweens = new Set();
  const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const easeOutBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
  function addTween(dur, onUpdate, onComplete) {
    const start = performance.now();
    const t = {
      update(now) {
        let p = (now - start) / dur;
        if (p > 1) p = 1;
        onUpdate(p);
        if (p >= 1) { onComplete && onComplete(); return true; }
        return false;
      },
    };
    tweens.add(t);
    return t;
  }

  // --- スポット演出（シーン内・bloomで発光。テキストは出さない） ---
  const fxGroup = new THREE.Group();
  scene.add(fxGroup);
  const GOLD = 0xffd06a, GREEN = 0x9ff0a8;
  const DEEP = 0xcf8f10, INK = 0x050505; // 濃いめの黄／ほぼ黒（効果線のメリハリ用）
  const pickColor = (c) => (Array.isArray(c) ? c[(Math.random() * c.length) | 0] : c);
  // 効果線の素材：黄系は発光、黒は発光させず暗い線として見せる
  function streakMat(hex) {
    if (hex === INK) return new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, toneMapped: true });
    return glowMat(hex, 2.4);
  }
  const partGeo = new THREE.SphereGeometry(STONE_R * 0.14, 8, 8);
  // 波紋リング：真円でなく半径をうねらせた不規則な波形（毎回同じ形でOK）。迫力を出す。
  function makeWavyRing(inner, outer, seg = 96) {
    const g = new THREE.RingGeometry(inner, outer, seg, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const r = Math.hypot(x, y), th = Math.atan2(y, x);
      const f = 1 + 0.18 * Math.sin(5 * th + 0.6) + 0.10 * Math.sin(8 * th + 1.9) + 0.06 * Math.sin(13 * th);
      pos.setXY(i, Math.cos(th) * r * f, Math.sin(th) * r * f);
    }
    pos.needsUpdate = true; g.computeVertexNormals();
    return g;
  }
  const ringGeo = makeWavyRing(STONE_R * 0.5, STONE_R * 0.82);
  // 発光素材（toneMapped=falseで閾値を超えさせ、確実にbloomさせる）
  function glowMat(hex, mul = 2.2) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(mul), transparent: true, toneMapped: false });
    return m;
  }

  function spawnParticles(x, z, hex = GOLD, n = 18, spread = 1.6) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(partGeo, glowMat(pickColor(hex)));
      m.position.set(x, STONE_H, z);
      fxGroup.add(m);
      const ang = Math.random() * Math.PI * 2, sp = spread * (0.4 + Math.random());
      const vx = Math.cos(ang) * sp, vz = Math.sin(ang) * sp, vy = 1.3 + Math.random() * 1.6;
      addTween(700 + Math.random() * 250, (p) => {
        m.position.set(x + vx * p, STONE_H + vy * p - 2.2 * p * p, z + vz * p);
        m.scale.setScalar(Math.max(0.02, 1 - p));
        m.material.opacity = 1 - p;
      }, () => { fxGroup.remove(m); m.material.dispose(); });
    }
  }
  function spawnRing(x, z, hex = GOLD) {
    const m = new THREE.Mesh(ringGeo, glowMat(hex, 1.8));
    m.material.side = THREE.DoubleSide;
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, z);
    fxGroup.add(m);
    addTween(620, (p) => { const s = 1 + p * 5.5; m.scale.set(s, s, s); m.material.opacity = 0.85 * (1 - p); },
      () => { fxGroup.remove(m); m.material.dispose(); });
  }
  // 漫画の効果線：着手点から放射状に細い線が外へ飛び散る。色は配列可（黄系は発光・黒は暗線）。
  function spawnStreaks(x, z, hex = GOLD, n = 18) {
    for (let i = 0; i < n; i++) {
      const col = pickColor(hex);
      const ang = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.28;
      // 黒線は太く長く＝漫画の効果線としてはっきり見せる
      const len = STONE_R * (col === INK ? 2.0 + Math.random() * 1.4 : 1.0 + Math.random() * 1.1);
      const w = STONE_R * (col === INK ? 0.12 : 0.05);
      const g = new THREE.Group();
      g.position.set(x, col === INK ? 0.05 : 0.06, z); g.rotation.y = ang; // 放射方向＝groupローカルx
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), streakMat(col));
      m.rotation.x = -Math.PI / 2; // 盤に寝かせる
      g.add(m); fxGroup.add(g);
      const d0 = STONE_R * 0.6, d1 = STONE_R * (2.8 + Math.random() * 1.6);
      addTween(380 + Math.random() * 200, (p) => {
        const e = easeOutCubic(p);
        m.position.x = d0 + (d1 - d0) * e;       // 外へシュッと飛ぶ
        m.scale.set(1 - 0.5 * p, 1, 1);          // 飛びながら短くなる
        m.material.opacity = Math.min(1, 2 * (1 - p));
      }, () => { fxGroup.remove(g); m.geometry.dispose(); m.material.dispose(); });
    }
  }
  let shaking = false;
  // 方向性のある減衰振動＝「ガクッ」と大きく揺れて収まる（毎フレーム乱数より視認しやすい）。
  function shakeCamera(intensity = 0.13, dur = 280) {
    if (shaking) return;
    shaking = true;
    const bx = camera.position.x, bz = camera.position.z;
    const ang = Math.random() * Math.PI * 2; // 揺れの主軸（毎回ランダム）
    addTween(dur, (p) => {
      const amp = intensity * Math.pow(1 - p, 1.4);     // 減衰
      const osc = Math.sin(p * Math.PI * 2 * 5.5);       // 主軸方向の往復
      const jit = (Math.random() * 2 - 1) * intensity * 0.25 * (1 - p); // 微細な乱れ
      camera.position.x = bx + Math.cos(ang) * amp * osc + jit;
      camera.position.z = bz + Math.sin(ang) * amp * osc + jit;
    }, () => { camera.position.x = bx; camera.position.z = bz; shaking = false; });
  }
  function celebrate() {
    // 全体フラッシュは使わず、盤上のあちこちに粒子と効果線を散らす
    for (let k = 0; k < 8; k++) {
      const x = (Math.random() - 0.5) * BOARD * 0.85, z = (Math.random() - 0.5) * BOARD * 0.85;
      spawnParticles(x, z, [GOLD, DEEP], 14, 1.5);
      if (k % 2 === 0) spawnStreaks(x, z, [GOLD, DEEP, INK], 12);
    }
  }
  function applyEffects(tags, ctx = {}) {
    const pos = ctx.r != null ? cellToWorld(ctx.r, ctx.c) : { x: 0, z: 0 };
    for (const tag of tags) {
      switch (tag) {
        case "corner": // 多色の粒子＋黒を多めに混ぜた効果線でメリハリ
          spawnParticles(pos.x, pos.z, [GOLD, DEEP], 26, 1.8);
          spawnStreaks(pos.x, pos.z, [INK, GOLD, INK, DEEP, INK, GOLD], 26); // 黒を半分混ぜる
          spawnRing(pos.x, pos.z);
          break;
        case "bigFlip": // 粒子＋漫画の効果線が飛び散る（衝撃のシェイクはアニメ側で実施）
          spawnParticles(pos.x, pos.z, [GREEN, GOLD], 22, 1.6);
          spawnStreaks(pos.x, pos.z, [INK, GOLD, INK, DEEP], 24);
          break;
        case "reversal": // 全体フラッシュは廃止。着手点に粒子＋効果線＋揺れ
          spawnParticles(pos.x, pos.z, [GOLD, DEEP], 18, 1.6);
          spawnStreaks(pos.x, pos.z, [INK, GOLD, DEEP], 16);
          spawnRing(pos.x, pos.z);
          shakeCamera(0.18, 280);
          break;
        case "gameover":
        case "shutout": celebrate(); break;
        default: break; // pass / lastCell / gameover-draw は音のみ（控えめ）
      }
    }
  }

  // 描画ループ
  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    for (const t of tweens) if (t.update(now)) tweens.delete(t);
    composer.render();
  }
  loop();

  // 浮上量・溜めの定数
  const LIFT = STONE_R * 2.2;        // 着手ドロップインの基準高さ
  const FLIP_LIFT = STONE_R * 3.8;   // ② めくりの浮上は全体的に高く
  const HOVER = STONE_R * 2.4;       // ① 出現時の空中静止高さ
  const HOLD_MS = 135;               // 溜め時間（着手・めくり号砲の目安）
  const FREEZE_MS = 760;             // ④ 角/大量返し：着地後フリーズ（演出が終わる頃）→めくり
  const PRE_FLIP_MS = 190;           // 通常手：着地後に一拍おいてから号砲（隅以外でも溜め）

  // ① 着手の溜め：盤の真上に出現(フッ)→空中で静止(溜め)→落下＋着地(コツ)。
  function placeWithAnticipation(group, color, { onAppear, onLand } = {}) {
    const restY = STONE_H / 2;
    const hoverY = restY + HOVER;
    group.rotation.z = colorToFlip(color); // 置く色の面を上に
    group.position.y = hoverY;
    group.scale.setScalar(0.6);
    const APPEAR = 90 * SPEED, HOLD = HOLD_MS * SPEED, DROP = 220 * SPEED;
    const total = APPEAR + HOLD + DROP;
    let landed = false;
    if (onAppear) onAppear();
    addTween(total, (p) => {
      const t = p * total;
      if (t <= APPEAR) {                         // 出現（フッと現れる）
        group.scale.setScalar(0.6 + 0.4 * easeOutCubic(t / APPEAR));
        group.position.y = hoverY;
      } else if (t <= APPEAR + HOLD) {            // 溜め（空中静止）
        group.scale.setScalar(1);
        group.position.y = hoverY;
      } else {                                    // 落下＋着地
        const dp = (t - APPEAR - HOLD) / DROP;
        if (dp < 0.7) {
          group.position.y = hoverY + (restY - hoverY) * easeOutCubic(dp / 0.7);
        } else {
          const bp = (dp - 0.7) / 0.3;            // 着地の小バウンド
          group.position.y = restY + Math.sin(bp * Math.PI) * STONE_H * 0.6;
          if (!landed) { landed = true; if (onLand) onLand(); }
        }
      }
    }, () => { group.position.y = restY; group.scale.setScalar(1); if (!landed && onLand) onLand(); });
  }

  // フォロワー（2枚目以降）の裏返し：浮上しながらZ軸180°回転して着地。浮上は高め。
  function flipStone(entry, toColor, dur = 520) {
    const from = entry.group.rotation.z;
    const to = colorToFlip(toColor);
    entry.color = toColor;
    const restY = STONE_H / 2;
    addTween(dur * SPEED, (p) => {
      entry.group.rotation.z = from + (to - from) * easeInOutCubic(p); // 90°で黒白半々
      const hop = Math.sin(Math.min(p, 1) * Math.PI) * FLIP_LIFT;      // 中間で最高
      const bounce = p > 0.82 ? Math.sin((p - 0.82) / 0.18 * Math.PI) * STONE_H * 0.5 : 0;
      entry.group.position.y = restY + hop + bounce;
    }, () => { entry.group.rotation.z = to; entry.group.position.y = restY; });
  }

  // ② 先頭石（号砲）：回転せず水平に浮く→溜め→180°回転して着地。
  function flipLead(entry, toColor, onLanded) {
    const from = entry.group.rotation.z;
    const to = colorToFlip(toColor);
    entry.color = toColor;
    const restY = STONE_H / 2;
    const LIFT_MS = 150 * SPEED, HOLD = HOLD_MS * SPEED, ROT_MS = 360 * SPEED;
    const total = LIFT_MS + HOLD + ROT_MS;
    addTween(total, (p) => {
      const t = p * total;
      if (t <= LIFT_MS) {                          // 水平に浮く（回転しない）
        entry.group.position.y = restY + FLIP_LIFT * easeOutCubic(t / LIFT_MS);
        entry.group.rotation.z = from;
      } else if (t <= LIFT_MS + HOLD) {            // 溜め
        entry.group.position.y = restY + FLIP_LIFT;
        entry.group.rotation.z = from;
      } else {                                     // 回転しながら降下＋バウンド
        const rp = (t - LIFT_MS - HOLD) / ROT_MS;
        entry.group.rotation.z = from + (to - from) * easeInOutCubic(rp);
        const drop = restY + FLIP_LIFT * (1 - easeInOutCubic(rp));
        const bounce = rp > 0.82 ? Math.sin((rp - 0.82) / 0.18 * Math.PI) * STONE_H * 0.5 : 0;
        entry.group.position.y = drop + bounce;
      }
    }, () => { entry.group.rotation.z = to; entry.group.position.y = restY; if (onLanded) onLanded(); });
  }

  // ④ ヒットストップの揺れ：置石を盤面内で小刻みに振動（二重指数の減衰でメリハリ）。
  // 第1相の減衰を緩め、複数フレームにわたって大きく揺れる＝はっきり視認できる速さに。
  function jitterStone(group) {
    const restX = group.position.x, restZ = group.position.z;
    const DUR = 650 * SPEED;
    const A1 = STONE_R * 0.5, A2 = STONE_R * 0.16; // 第1相(大・速)＋第2相(小・遅)
    addTween(DUR, (p) => {
      const amp = A1 * Math.exp(-4.5 * p) + A2 * Math.exp(-1.6 * p);
      const ph = p * Math.PI * 2 * 4.5; // 約7Hz＝1揺れ8〜9フレームで目に見える
      group.position.x = restX + Math.sin(ph) * amp;
      group.position.z = restZ + Math.cos(ph * 1.13) * amp;
    }, () => { group.position.x = restX; group.position.z = restZ; });
  }

  // 連鎖めくり（① 着手の溜め → ④ 角ならヒットストップ → ② 号砲＋波状フォロワー）。
  function animateMove(prevBoard, nextBoard, move, color, cbs = {}) {
    const { onAppear, onLand, onFlipLift, onFlipLand, onImpact, isBig } = cbs;
    return new Promise((resolve) => {
      const placed = placeStone(move.r, move.c, color, false);

      // ② 返る石を8方向ごとにグルーピング（各方向 距離順）
      const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
      const groups = [];
      for (const [dr, dc] of dirs) {
        const line = [];
        for (let k = 1; ; k++) {
          const rr = move.r + dr * k, cc = move.c + dc * k;
          if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) break;
          if (prevBoard[rr][cc] !== EMPTY && prevBoard[rr][cc] !== nextBoard[rr][cc]) line.push({ r: rr, c: cc });
          else break;
        }
        if (line.length) groups.push(line);
      }
      const isCorner = (move.r === 0 || move.r === SIZE - 1) && (move.c === 0 || move.c === SIZE - 1);
      const special = isCorner || isBig; // ④ 角／大量返しはフリーズ→演出後にめくり

      placeWithAnticipation(placed.group, color, {
        onAppear,
        onLand: () => {
          if (onLand) onLand();
          if (special) {
            if (onImpact) onImpact();                 // 光＋音を着地の一点に同期
            if (isCorner) jitterStone(placed.group);  // 揺れは四隅のみ
            shakeCamera(isCorner ? 1.25 : 0.9, isCorner ? 560 : 480); // 画面揺れを強く
            setTimeout(runFlips, FREEZE_MS * SPEED);   // フリーズ：演出が終わってからめくり
          } else {
            setTimeout(runFlips, PRE_FLIP_MS * SPEED);  // 通常手：一拍おいてから号砲（溜め）
          }
        },
      });

      function runFlips() {
        if (groups.length === 0) { setTimeout(resolve, 320 * SPEED); return; }
        let flipIdx = 0;
        // ② 各方向の先頭石を一斉に号砲（スッは1回）
        if (onFlipLift) onFlipLift();
        for (const g of groups) {
          const cell = g[0];
          const entry = stoneMap.get(`${cell.r},${cell.c}`);
          const idx = flipIdx++;
          if (entry) flipLead(entry, nextBoard[cell.r][cell.c], () => onFlipLand && onFlipLand(idx));
          else if (onFlipLand) onFlipLand(idx);
        }
        // フォロワー（2枚目以降）は号砲が回り始める頃から距離順に波状
        const followerStart = (150 + HOLD_MS) * SPEED;
        const stepMs = 95 * SPEED;
        let maxFollowers = 0;
        for (let j = 1; ; j++) {
          const wave = groups.map((g) => g[j]).filter(Boolean);
          if (wave.length === 0) break;
          maxFollowers = j;
          const delay = followerStart + (j - 1) * stepMs;
          for (const cell of wave) {
            const idx = flipIdx++;
            setTimeout(() => {
              const entry = stoneMap.get(`${cell.r},${cell.c}`);
              if (entry) flipStone(entry, nextBoard[cell.r][cell.c]);
              if (onFlipLand) onFlipLand(idx);
            }, delay);
          }
        }
        // 完了予約：号砲終端とフォロワー終端の遅い方＋余韻
        const leadEnd = (150 + HOLD_MS + 360) * SPEED;
        const followerEnd = maxFollowers >= 1 ? followerStart + (maxFollowers - 1) * stepMs + 520 * SPEED : 0;
        setTimeout(resolve, Math.max(leadEnd, followerEnd) + 320 * SPEED);
      }
    });
  }

  return {
    sync,
    renderHints,
    clearHints,
    animateMove,
    applyEffects,
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.removeChild(renderer.domElement); },
    THREE, scene, camera, renderer, stoneMap, cellToWorld, STONE_R, STONE_H,
  };
}
