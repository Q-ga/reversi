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
  const partGeo = new THREE.SphereGeometry(STONE_R * 0.14, 8, 8);
  const ringGeo = new THREE.RingGeometry(STONE_R * 0.55, STONE_R * 0.8, 40);
  const flashGeo = new THREE.PlaneGeometry(BOARD, BOARD);
  // 発光素材（toneMapped=falseで閾値を超えさせ、確実にbloomさせる）
  function glowMat(hex, mul = 2.2) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(mul), transparent: true, toneMapped: false });
    return m;
  }

  function spawnParticles(x, z, hex = GOLD, n = 18, spread = 1.6) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(partGeo, glowMat(hex));
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
  function flashBoard(hex = GOLD, peak = 0.4) {
    const m = new THREE.Mesh(flashGeo, glowMat(hex, 1.5));
    m.material.side = THREE.DoubleSide; m.material.depthWrite = false;
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0.06, 0);
    fxGroup.add(m);
    addTween(600, (p) => { m.material.opacity = peak * Math.sin(Math.min(p, 1) * Math.PI); },
      () => { fxGroup.remove(m); m.material.dispose(); });
  }
  let shaking = false;
  function shakeCamera(intensity = 0.13, dur = 280) {
    if (shaking) return;
    shaking = true;
    const bx = camera.position.x, bz = camera.position.z;
    addTween(dur, (p) => {
      const k = intensity * (1 - p);
      camera.position.x = bx + (Math.random() * 2 - 1) * k;
      camera.position.z = bz + (Math.random() * 2 - 1) * k;
    }, () => { camera.position.x = bx; camera.position.z = bz; shaking = false; });
  }
  function celebrate() {
    flashBoard(GOLD, 0.5);
    for (let k = 0; k < 6; k++) {
      const x = (Math.random() - 0.5) * BOARD * 0.85, z = (Math.random() - 0.5) * BOARD * 0.85;
      spawnParticles(x, z, GOLD, 14, 1.5);
    }
  }
  function applyEffects(tags, ctx = {}) {
    const pos = ctx.r != null ? cellToWorld(ctx.r, ctx.c) : { x: 0, z: 0 };
    for (const tag of tags) {
      switch (tag) {
        case "corner": spawnParticles(pos.x, pos.z, GOLD, 24, 1.8); spawnRing(pos.x, pos.z); break;
        case "bigFlip": spawnParticles(pos.x, pos.z, GREEN, 16, 1.4); shakeCamera(0.12, 260); break;
        case "reversal": flashBoard(GOLD, 0.35); shakeCamera(0.1, 240); break;
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

  // 着手石を上から落として着地（ドロップイン）
  const LIFT = STONE_R * 2.2; // 浮上の高さ（実例Marmelab=持ち上げて回転して着地）

  function dropIn(group) {
    const restY = STONE_H / 2;
    const fromY = restY + LIFT * 1.6;
    addTween(380 * SPEED, (p) => {
      const e = easeOutBack(p);
      group.position.y = fromY + (restY - fromY) * e;
      const s = 0.55 + 0.45 * easeOutCubic(p);
      group.scale.setScalar(s);
    }, () => { group.position.y = restY; group.scale.setScalar(1); });
  }

  // 1枚を裏返す：盤から浮き上がりながらX軸180°回転し着地（90°で黒白半々の断面）。
  function flipStone(entry, toColor, dur = 480) {
    const from = entry.group.rotation.z;
    const to = colorToFlip(toColor);
    entry.color = toColor;
    const restY = STONE_H / 2;
    addTween(dur * SPEED, (p) => {
      // 回転は等速感のあるeaseInOutCubic→90°(黒白半々)がちょうど中間に来る。Z軸=左からめくる
      entry.group.rotation.z = from + (to - from) * easeInOutCubic(p);
      // 浮上は中間(=edge-on)で最高、最後に軽くバウンドして着地
      const hop = Math.sin(Math.min(p, 1) * Math.PI) * LIFT;
      const bounce = p > 0.82 ? Math.sin((p - 0.82) / 0.18 * Math.PI) * STONE_H * 0.5 : 0;
      entry.group.position.y = restY + hop + bounce;
    }, () => { entry.group.rotation.z = to; entry.group.position.y = restY; });
  }

  // 重なる波の連鎖めくり。置石から距離順に、前の石が回り切る前に次を開始（実例stagger≒50ms）。
  function animateMove(prevBoard, nextBoard, move, color, onFlip, stepMs = 95) {
    return new Promise((resolve) => {
      const placed = placeStone(move.r, move.c, color, true);
      dropIn(placed.group);

      const flips = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (prevBoard[r][c] !== EMPTY && prevBoard[r][c] !== nextBoard[r][c]) {
          flips.push({ r, c, dist: Math.max(Math.abs(r - move.r), Math.abs(c - move.c)) });
        }
      }
      flips.sort((a, b) => a.dist - b.dist);
      if (flips.length === 0) { setTimeout(resolve, 360); return; }

      flips.forEach((f, i) => {
        setTimeout(() => {
          const entry = stoneMap.get(`${f.r},${f.c}`);
          if (entry) flipStone(entry, nextBoard[f.r][f.c]);
          onFlip(i);
          if (i === flips.length - 1) setTimeout(resolve, 500 * SPEED);
        }, i * stepMs * SPEED);
      });
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
