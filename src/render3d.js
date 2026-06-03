// three.js による3D盤・石の描画。
// 盤=提供画像をフラット面に貼る／石=厚みのある面取りオセロ石(黒上/白下の2段円柱)。
// 真上見下ろしカメラ、ソフトシャドウ。クリックはレイキャストでマスに変換。
// R1: 静的配置＋クリック。めくりアニメ(R2)/演出(R4)は後続で差し込む。
import * as THREE from "three";
import { SIZE, EMPTY, BLACK, legalMoves } from "./rules.js";

const BOARD = 10; // 盤プレーンのワールドサイズ
// 提供画像(1254px)の金グリッド線位置 → マス中心の正規化座標(0..1)
const LINES = [46, 190, 336, 482, 627, 772, 916, 1062, 1205].map((p) => p / 1254);
const CENTERS = LINES.slice(0, 8).map((_, i) => (LINES[i] + LINES[i + 1]) / 2);
const PITCH = (LINES[8] - LINES[0]) / 8; // 1マスの正規化幅
const STONE_R = PITCH * BOARD * 0.42;
const STONE_H = STONE_R * 0.6;

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

  // カメラ：ほぼ真上、ごく僅かに手前へ寄せて石の厚みが分かる程度
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 17, 2.4);
  camera.lookAt(0, 0, 0);

  // ライト：環境光＋上方キーライト(影)＋フィル＋リム
  scene.add(new THREE.HemisphereLight(0xffffff, 0x202830, 0.55));
  const key = new THREE.DirectionalLight(0xfff2d8, 1.25);
  key.position.set(-6, 14, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  const sc = key.shadow.camera;
  sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7;
  key.shadow.bias = -0.0005;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd0ff, 0.35);
  fill.position.set(7, 8, -5);
  scene.add(fill);
  const rim = new THREE.PointLight(0xffe9b0, 0.5, 40);
  rim.position.set(0, 6, -8);
  scene.add(rim);

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

  // 石マテリアル（黒=光沢/白=半マット/側面は黒白2段）
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.16, metalness: 0.0 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.5, metalness: 0.0 });

  // 石ジオメトリ：上半分(黒)＋下半分(白)の2段円柱でequatorの境目を出す
  function makeStone() {
    const g = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(STONE_R, STONE_R, STONE_H / 2, 48), blackMat);
    upper.position.y = STONE_H / 4;
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(STONE_R, STONE_R, STONE_H / 2, 48), whiteMat);
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

  function colorToRotX(color) { return color === BLACK ? 0 : Math.PI; }

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
      entry.group.rotation.x = colorToRotX(color);
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

  // 描画ループ
  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    for (const t of tweens) if (t.update(now)) tweens.delete(t);
    renderer.render(scene, camera);
  }
  loop();

  // 着手石を上から落として着地（ドロップイン）
  function dropIn(group) {
    const restY = STONE_H / 2;
    const fromY = restY + 2.2;
    addTween(360, (p) => {
      const e = easeOutBack(p);
      group.position.y = fromY + (restY - fromY) * e;
      const s = 0.5 + 0.5 * easeOutCubic(p);
      group.scale.setScalar(s);
    }, () => { group.position.y = restY; group.scale.setScalar(1); });
  }

  // 1枚を立体的に裏返す（軸回転＋小ホップ＋着地オーバーシュート）
  function flipStone(entry, toColor, dur = 460) {
    const from = entry.group.rotation.x;
    const to = colorToRotX(toColor);
    entry.color = toColor;
    const restY = STONE_H / 2;
    addTween(dur, (p) => {
      const e = easeOutBack(p);            // 着地で軽くオーバーシュート＝バウンド
      entry.group.rotation.x = from + (to - from) * e;
      entry.group.position.y = restY + Math.sin(Math.min(p, 1) * Math.PI) * (STONE_R * 0.5); // 浮き上がり
    }, () => { entry.group.rotation.x = to; entry.group.position.y = restY; });
  }

  // 重なる波の連鎖めくり。置石から距離順に、前の石が回り切る前に次を開始。
  function animateMove(prevBoard, nextBoard, move, color, onFlip, stepMs = 70) {
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
          if (i === flips.length - 1) setTimeout(resolve, 460);
        }, i * stepMs);
      });
    });
  }

  return {
    sync,
    renderHints,
    clearHints,
    animateMove,
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.removeChild(renderer.domElement); },
    THREE, scene, camera, renderer, stoneMap, cellToWorld, STONE_R, STONE_H,
  };
}
