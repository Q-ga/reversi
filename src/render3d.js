// three.js による3D盤・石の描画。
// 盤=提供画像をフラット面に貼る／石=厚みのある面取りオセロ石(黒上/白下の2段円柱)。
// 真上見下ろしカメラ、ソフトシャドウ。クリックはレイキャストでマスに変換。
// R1: 静的配置＋クリック。めくりアニメ(R2)/演出(R4)は後続で差し込む。
import * as THREE from "three";
import { EffectComposer } from "../vendor/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "../vendor/jsm/environments/RoomEnvironment.js";
import { SIZE, EMPTY, BLACK, legalMoves } from "./rules.js";
import { motionPolicy } from "./motion.js";
import { normalizeFlipTiming } from "./theme_timing.js";

const BOARD = 10; // 盤プレーンのワールドサイズ
// 提供画像(1254px)の金グリッド線位置 → マス中心の正規化座標(0..1)
// ※2026-06-06 緑盤に差し替え。新画像はほぼ等間隔(ピッチ≈150px)。縦横線位置の平均値。
const LINES = [25, 177, 327, 477, 628, 779, 928, 1078, 1227].map((p) => p / 1254);
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

// flipTiming: めくりタイミング・プリセット（theme_timing.js。比較ビルドで切替）。
// 未指定・不正値はキー単位で既定値（現状）へフォールバックする。
export function createBoardView(container, onCell, textureUrl = "./textures/board.png", flipTiming = null) {
  // めくり（連鎖めくり）の時間だけをプリセットで差し替える。
  // アニメの構造（逐次・イージング・変動則）と着手の溜めはプリセットに依らず不変。
  const FT = normalizeFlipTiming(flipTiming);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const BASE_EXPOSURE = 0.92; // 黒石を黒く沈ませるための基準露出（旧1.05）。明るさ設定の中点に対応
  renderer.toneMappingExposure = BASE_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";

  const scene = new THREE.Scene();
  // デバッグ用：?slow=6 でアニメをN倍遅くして途中コマを確認できる
  const SPEED = Math.max(1, Number(new URLSearchParams(location.search).get("slow")) || 1);

  // エフェクト演出（スポット演出＝特別な瞬間の光・決め演出）の表示可否。設定でOFFにできる。
  // OFF時は applyEffects を無効化し、角/大量返しのヒットストップ（フリーズ・揺れ）も止める。
  // 石を置く・めくる基本アニメと、文字での告知は残る。
  let effectsEnabled = true;
  // 酔い対策：OSの「視差効果を減らす」(prefers-reduced-motion)由来の抑制。本人のトグルとは独立。
  // 有効時はスクリーンシェイク・置石ジッタ等の動きの強い演出だけを止め、光・基本アニメ・文字告知は残す。
  let reducedMotion = false;
  const policy = () => motionPolicy({ effectsOn: effectsEnabled, reducedMotion });

  // カメラ：真上から見下ろし（ごく僅かに寄せて浮上した石が分かる程度）
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 18, 0.6); // ほぼ真上（約2°）。余計なチルトを抑えつつ石の厚みは僅かに見せる
  camera.lookAt(0, 0, 0);

  // bloom後処理（明るい演出だけが発光してにじむ。盤/石は閾値以下で発光しない）
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass()); // トーンマッピング＋sRGB変換（盤が黒くならないように最終変換）

  // ライト：レフ板のように面で全体を均一に照らす。方向光は弱く・ほぼ真上にして、
  // 盤面の明暗ムラを作らず「石の接地影」だけを担わせる。石の厚みの陰影は面テクスチャで出す。
  scene.add(new THREE.HemisphereLight(0xffffff, 0x39414c, 0.92)); // 黒石を黒く（旧1.15）
  scene.add(new THREE.AmbientLight(0xffffff, 0.48));               // 黒石を黒く（旧0.6）
  const key = new THREE.DirectionalLight(0xffffff, 0.3); // 弱め＝盤の方向ムラを出さず接地影だけ
  key.position.set(1.5, 18, 1.5);                        // ほぼ真上。影が石の真下に短く落ちる
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  const sc = key.shadow.camera;
  sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7;
  key.shadow.bias = -0.0006;
  key.shadow.radius = 7; // よりソフトな接地影
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
  // roughnessを上げてマット化＝鏡面ハイライト(灰色のテカリ)を消し、より黒く見せる
  const blackFaceMat = new THREE.MeshStandardMaterial({ map: blackFaceTex, roughness: 0.88, metalness: 0.0 });
  const blackEdgeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0.0 });
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

  // 合法手ヒント＝つやガラスのドーム（半透明・クリアコート・内外で微色相差）。
  // 石は球っぽさを避ける設計なので、映り込み用envMapはシーン全体でなくヒント専用に持たせる。
  const hintPmrem = new THREE.PMREMGenerator(renderer);
  const hintEnv = hintPmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // ドーム形状：上半球を薄く潰した凸レンズ。裾は今より広げる（0.32→0.46）。
  const HINT_BASE_R = STONE_R * 0.54;   // 裾の半径
  const HINT_FLAT = 0.34;               // 高さ＝裾半径×この比（薄いドーム）
  function makeDomeGeo() {
    const g = new THREE.SphereGeometry(HINT_BASE_R, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, HINT_FLAT, 1);
    // 頂点カラーで内外の色差＋濁り（不均一）を作る：裾=深い琥珀 → 頂=シャンパン金
    const pos = g.attributes.position;
    const maxY = HINT_BASE_R * HINT_FLAT;
    const top = new THREE.Color(0xf0c060), bot = new THREE.Color(0x331f05);
    const tmp = new THREE.Color();
    const colors = [];
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getY(i) / maxY)); // 0=裾 → 1=頂
      tmp.copy(bot).lerp(top, t);
      // わずかな揺らぎでガラスの濁り・不均一を出す（色相と明度を微オフセット）
      const n = (Math.random() - 0.5);
      tmp.offsetHSL(n * 0.012, n * 0.05, n * 0.05);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }
  const hintGeo = makeDomeGeo();
  // 【外ドーム】暗めの透明ガラス。濃淡（頂点カラー）と透明感を担い、発光はごく控えめ。
  // 反射(clearcoat/envMap)は「不透明な光沢」になり盤を隠すため使わない。
  // 素の半透明＋頂点カラーの濃淡（中心=明るい金／縁=暗い琥珀）で、盤を透かしつつ立体に見せる。
  const hintMatBase = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.34, // 盤がしっかり透ける薄さ
    depthWrite: false, side: THREE.FrontSide,
  });
  const HINT_BASE_OPACITY = 0.34;
  // 【中心コア】明るい金の小円。ライト非依存(MeshBasic)で確実に灯り、視認の核になる。
  // 外ドーム(濃淡金)と色を変えることで内外の色差＝立体感も出す。
  const hintCoreGeo = new THREE.CircleGeometry(STONE_R * 0.11, 24);
  const hintCoreMatBase = new THREE.MeshBasicMaterial({
    color: 0xf5bf55, transparent: true, opacity: 0.4, depthWrite: false, // 中心の薄い灯り（盤も少し透ける）
  });
  const HINT_CORE_OPACITY = 0.4;
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
    clearHints();
    if (state.over || !showHints) return;
    let i = 0;
    for (const [r, c] of legalMoves(state.board, state.current)) {
      const grp = new THREE.Group();           // 外ドーム＋中心コアの2層
      const dome = new THREE.Mesh(hintGeo, hintMatBase.clone());       // ジオメトリは共有・マテリアルは個別
      const core = new THREE.Mesh(hintCoreGeo, hintCoreMatBase.clone());
      core.rotation.x = -Math.PI / 2;          // 水平に寝かせる
      core.position.y = HINT_BASE_R * HINT_FLAT * 0.92; // ドーム頂点付近に浮かせる
      grp.add(dome, core);
      const { x, z } = cellToWorld(r, c);
      grp.position.set(x, 0.01, z);            // 盤面に接地（ドームはy+方向に立ち上がる）
      grp.userData.phase = i * 0.7;            // 位相をずらして一斉に揃わない＝不均一に
      hints.add(grp);
      i++;
    }
  }
  // 個別cloneしたマテリアルを破棄してから消す（ジオメトリは共有なので残す）。
  function clearHints() {
    for (const grp of hints.children) for (const m of grp.children) m.material.dispose();
    hints.clear();
  }

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
  function makeWavyRing(inner, outer, seg = 160) {
    const g = new THREE.RingGeometry(inner, outer, seg, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const r = Math.hypot(x, y), th = Math.atan2(y, x);
      // 強い抑揚＋高周波のトゲでジャギジャギに（真円感を消す）
      const f = 1
        + 0.34 * Math.sin(7 * th + 0.6)
        + 0.22 * Math.sin(11 * th + 1.9)
        + 0.16 * Math.sin(17 * th)
        + 0.12 * Math.sin(29 * th + 0.4);
      pos.setXY(i, Math.cos(th) * r * f, Math.sin(th) * r * f);
    }
    pos.needsUpdate = true; g.computeVertexNormals();
    return g;
  }
  const ringGeo = makeWavyRing(STONE_R * 0.45, STONE_R * 0.78);
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
      const ink = col === INK;
      const ang = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.22;
      // 黒線は太く長く・遠くまで＝漫画の効果線として主役級にはっきり見せる
      const len = STONE_R * (ink ? 2.8 + Math.random() * 2.2 : 1.0 + Math.random() * 1.0);
      const w = STONE_R * (ink ? 0.18 : 0.05);
      const g = new THREE.Group();
      g.position.set(x, ink ? 0.08 : 0.06, z); g.rotation.y = ang; // 放射方向＝groupローカルx（黒は手前に）
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), streakMat(col));
      m.rotation.x = -Math.PI / 2; // 盤に寝かせる
      g.add(m); fxGroup.add(g);
      const d0 = STONE_R * (ink ? 1.0 : 0.6), d1 = STONE_R * (ink ? 3.6 + Math.random() * 2.0 : 2.8 + Math.random() * 1.6);
      addTween((ink ? 560 : 360) + Math.random() * 200, (p) => {
        const e = easeOutCubic(p);
        m.position.x = d0 + (d1 - d0) * e;       // 外へシュッと飛ぶ
        m.scale.set(1 - 0.45 * p, 1, 1);         // 飛びながら短くなる
        m.material.opacity = Math.min(1, (ink ? 1.4 : 2) * (1 - p)); // 黒はゆっくり消す
      }, () => { fxGroup.remove(g); m.geometry.dispose(); m.material.dispose(); });
    }
  }
  let shaking = false;
  // 方向性のある減衰振動＝「ガクッ」と大きく揺れて収まる（毎フレーム乱数より視認しやすい）。
  function shakeCamera(intensity = 0.13, dur = 280) {
    if (!policy().strongMotion) return; // 酔い対策：reduced-motion時はスクリーンシェイクを出さない
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
    if (!policy().spotEffects) return; // スポット演出OFF：光・決め演出を出さない
    const pos = ctx.r != null ? cellToWorld(ctx.r, ctx.c) : { x: 0, z: 0 };
    for (const tag of tags) {
      switch (tag) {
        case "corner": // 黒の効果線を主役に。金粒子は控えめにして黒を埋もれさせない
          spawnStreaks(pos.x, pos.z, [INK, INK, INK, GOLD, INK, DEEP], 28); // 黒が主体
          spawnParticles(pos.x, pos.z, [GOLD, DEEP], 14, 1.6);
          spawnRing(pos.x, pos.z);
          break;
        case "bigFlip": // 粒子＋漫画の効果線が飛び散る（衝撃のシェイクはアニメ側で実施）
          spawnStreaks(pos.x, pos.z, [INK, INK, GOLD, INK, DEEP], 26);
          spawnParticles(pos.x, pos.z, [GREEN, GOLD], 16, 1.6);
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
    breatheHints(now);
    composer.render();
  }
  loop();

  // ヒントのドームをごく控えめに呼吸させる（透明度＋スケール）。位相をずらして不均一に。
  function breatheHints(now) {
    if (hints.children.length === 0) return;
    const ts = now * 0.001;
    for (const grp of hints.children) {
      const b = Math.sin(ts * 2.4 + grp.userData.phase); // -1..1
      const s = 1 + 0.05 * b;
      grp.scale.set(s, s, s);
      const [, core] = grp.children;
      // ドームは屈折ガラス（opacityは透過に使わない）のでスケールのみ呼吸。中心コアは灯りを呼吸。
      core.material.opacity = HINT_CORE_OPACITY + 0.06 * b;
    }
  }

  // 浮上量・溜めの定数
  const LIFT = STONE_R * 2.2;        // 着手ドロップインの基準高さ
  const FLIP_LIFT = STONE_R * 3.8;   // ② めくりの浮上は全体的に高く
  const HOVER = STONE_R * 2.4;       // ① 出現時の空中静止高さ
  const HOLD_MS = 135;               // 着手の溜めの保持時間（既存の看板。プリセット対象外）
  const FREEZE_MS = 760;             // ④ 角/大量返し：着地後フリーズ（演出が終わる頃）→めくり
  // めくり側の溜め・号砲前遅延などの時間は FT（めくりタイミング・プリセット）から取る。

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
  function flipStone(entry, toColor, dur = FT.followMs) {
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
    const LIFT_MS = FT.liftMs * SPEED, HOLD = FT.holdMs * SPEED, ROT_MS = FT.rotMs * SPEED;
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
    if (!policy().strongMotion) return; // 酔い対策：reduced-motion時は置石ジッタを出さない
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
      // ④ 角／大量返しはフリーズ→演出後にめくり。エフェクト演出OFF時は決め演出をやめ通常手と同じ流れに。
      // reduced-motion時はフリーズ・光・音は残し、シェイク・ジッタだけが各関数内で抑制される。
      const special = policy().spotEffects && (isCorner || isBig);

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
            setTimeout(runFlips, FT.preFlipMs * SPEED); // 通常手：一拍おいてから号砲（溜め）
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
        const followerStart = (FT.liftMs + FT.holdMs) * SPEED;
        const stepMs = FT.stepMs * SPEED;
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
        const leadEnd = (FT.liftMs + FT.holdMs + FT.rotMs) * SPEED;
        const followerEnd = maxFollowers >= 1 ? followerStart + (maxFollowers - 1) * stepMs + FT.followMs * SPEED : 0;
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
    setEffectsEnabled(on) { effectsEnabled = !!on; },
    setReducedMotion(on) { reducedMotion = on === true; }, // OS設定由来の抑制（トグルとは独立）
    // 盤面の明るさ(0..1)を露出に反映する。0.5で基準露出（現状の見た目）、
    // 0で-1段(×0.5)・1で+1段(×2)の指数マッピング（露出は乗算的な量のため知覚的に等間隔になる）。
    setBoardBrightness(v) {
      const b = typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
      renderer.toneMappingExposure = BASE_EXPOSURE * Math.pow(2, (b - 0.5) * 2);
    },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.removeChild(renderer.domElement); },
    THREE, scene, camera, renderer, stoneMap, cellToWorld, STONE_R, STONE_H,
  };
}
