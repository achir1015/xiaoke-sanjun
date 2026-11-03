// 3D 三軍棋盤（Three.js）：陸地沙盤、海洋（動態水面）、鐵路、鐵橋、行營、大本營、港口燈塔、機場跑道、
// 立體棋子（陸軍方塊、軍艦船身、懸空的飛機）與交戰動畫
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as J from './sanjun.js';

const CX = 1.38;     // 行距（左右）
const RZ = 0.9;      // 列距（前後）
const GAP = 1.5;     // 海峽中心到兩岸第一列的距離
const TOP = 0.22;    // 棋盤表面高度
const PW = 1.08, PD = 0.6, PH = 0.2; // 棋子寬、深、高
const AIR_Y = 0.42;  // 飛機懸空高度
const FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans TC","Heiti TC",sans-serif';
const KAI = '"DFKai-SB","BiauKai","標楷體","Kaiti TC","STKaiti","KaiTi",serif';
export const SIDE_COLOR = ['#c62828', '#1f5fbf'];
const SIDE_DARK = ['#8e1b1b', '#163f80'];

const X = (sq) => (J.colOf(sq) - 4) * CX;
const ZR = (r) => (r < 6 ? (r - 6) * RZ - (GAP - RZ) : r > 6 ? (r - 6) * RZ + (GAP - RZ) : 0);
const Z = (sq) => ZR(J.rowOf(sq));
const BW = 8 * CX + 2.0;                    // 棋盤寬
const BH = ZR(12) * 2 + 1.7;                // 棋盤長
const LAND_X0 = -2 * CX - 0.75, LAND_X1 = 2 * CX + 0.75; // 陸地範圍（C～G 行）
const baseY = (code) => (code && J.isAir(code & 31) ? TOP + AIR_Y : TOP);
const domainOf = (t) => (J.isShip(t) ? 'sea' : J.isAir(t) ? 'air' : 'land');

// ---------------- 棋盤貼圖 ----------------
function makeBoardTexture() {
  const PX = 150; // 每單位像素
  const W = Math.round(BW * PX), H = Math.round(BH * PX);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const px = (x) => (x + BW / 2) * PX, pz = (z) => (z + BH / 2) * PX;
  // 海洋底色
  const sea = g.createLinearGradient(0, 0, W, 0);
  sea.addColorStop(0, '#0b4469'); sea.addColorStop(0.2, '#1a76a6'); sea.addColorStop(0.8, '#1a76a6'); sea.addColorStop(1, '#0b4469');
  g.fillStyle = sea; g.fillRect(0, 0, W, H);
  // 外海航道
  for (const c of [0, 8]) {
    const x = px((c - 4) * CX);
    g.fillStyle = 'rgba(4,34,60,0.35)'; g.fillRect(x - 0.34 * PX, 0, 0.68 * PX, H);
    g.strokeStyle = 'rgba(220,240,255,0.5)'; g.lineWidth = 4; g.setLineDash([26, 22]);
    for (const dx of [-0.32, 0.32]) { g.beginPath(); g.moveTo(x + dx * PX, 0.3 * PX); g.lineTo(x + dx * PX, H - 0.3 * PX); g.stroke(); }
    g.setLineDash([]);
  }
  // 兩塊陸地（沙盤）
  const land = (z0, z1, side) => {
    const x0 = px(LAND_X0), x1 = px(LAND_X1);
    const grd = g.createLinearGradient(0, z0, 0, z1);
    grd.addColorStop(0, '#cdc597'); grd.addColorStop(1, '#d9d1a7');
    g.fillStyle = grd;
    g.beginPath(); g.roundRect(x0, z0, x1 - x0, z1 - z0, 0.35 * PX); g.fill();
    g.strokeStyle = '#efe3b4'; g.lineWidth = 0.12 * PX; g.stroke();
    g.fillStyle = side === 0 ? 'rgba(198,40,40,0.06)' : 'rgba(31,95,191,0.06)';
    g.fillRect(x0, z0, x1 - x0, z1 - z0);
    for (let i = 0; i < 380; i++) {
      g.fillStyle = `rgba(${80 + Math.random() * 40},${100 + Math.random() * 40},${40 + Math.random() * 30},${0.03 + Math.random() * 0.05})`;
      const r = 8 + Math.random() * 46;
      g.beginPath(); g.ellipse(x0 + Math.random() * (x1 - x0), z0 + Math.random() * (z1 - z0), r, r * (0.4 + Math.random() * 0.6), Math.random() * 3, 0, Math.PI * 2); g.fill();
    }
  };
  land(pz(ZR(7) - 0.6), pz(ZR(12) + 0.6), 0);
  land(pz(ZR(0) - 0.6), pz(ZR(5) + 0.6), 1);
  // 海浪紋
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 3;
  for (let i = 0; i < 90; i++) {
    const x0 = Math.random() * W, y0 = Math.random() * H;
    if (x0 > px(LAND_X0) && x0 < px(LAND_X1) && Math.abs(y0 - pz(0)) > 0.8 * PX) continue;
    g.beginPath(); g.moveTo(x0, y0);
    for (let k = 1; k <= 6; k++) g.lineTo(x0 + k * 14, y0 + Math.sin(k * 1.4) * 5);
    g.stroke();
  }
  // 外框
  g.strokeStyle = '#3a2e18'; g.lineWidth = 14;
  g.strokeRect(14, 14, W - 28, H - 28);
  g.lineWidth = 4; g.strokeRect(34, 34, W - 68, H - 68);

  const sqs = [...Array(J.NSQ).keys()];
  g.lineCap = 'round';
  // 公路（細線）
  for (const a of sqs) for (const b of J.ADJ[a]) {
    if (b < a || J.RAILN[a].includes(b) || J.isBridge(a) || J.isBridge(b)) continue;
    g.strokeStyle = '#5c4a2c'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(px(X(a)), pz(Z(a))); g.lineTo(px(X(b)), pz(Z(b))); g.stroke();
  }
  // 海路（虛線）
  g.strokeStyle = 'rgba(230,248,255,0.55)'; g.lineWidth = 4; g.setLineDash([12, 12]);
  for (const a of sqs) for (const b of J.SADJ[a]) {
    if (b < a) continue;
    g.beginPath(); g.moveTo(px(X(a)), pz(Z(a))); g.lineTo(px(X(b)), pz(Z(b))); g.stroke();
  }
  g.setLineDash([]);
  // 鐵路（黑白相間的粗線）
  for (const a of sqs) for (const b of J.RAILN[a]) {
    if (b < a) continue;
    const x1 = px(X(a)), y1 = pz(Z(a)), x2 = px(X(b)), y2 = pz(Z(b));
    g.strokeStyle = '#1d1d1d'; g.lineWidth = 18; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = '#f4f1e6'; g.lineWidth = 9; g.setLineDash([20, 20]);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.setLineDash([]);
  }
  const label = (text, x, y, side, size, color) => {
    g.fillStyle = color; g.font = `bold ${Math.round(size * PX)}px ${KAI}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(x, y); if (side === 1) g.rotate(Math.PI); g.fillText(text, 0, 0); g.restore();
  };
  // 各種兵站
  for (const sq of sqs) {
    const x = px(X(sq)), y = pz(Z(sq));
    const side = J.halfOf(sq);
    const kind = J.KIND[sq];
    if (kind === J.CAMP) {
      g.fillStyle = '#efe6c4'; g.strokeStyle = '#5c4a2c'; g.lineWidth = 7;
      g.beginPath(); g.arc(x, y, 0.4 * PX, 0, Math.PI * 2); g.fill(); g.stroke();
      label('行營', x, y, side, 0.2, 'rgba(92,74,44,0.55)');
    } else if (kind === J.HQ) {
      const w = 0.6 * PX, hh = 0.37 * PX;
      g.fillStyle = side === 0 ? '#f3d3c8' : '#cfdcf3'; g.strokeStyle = SIDE_DARK[side]; g.lineWidth = 8;
      g.beginPath(); g.roundRect(x - w, y - hh, w * 2, hh * 2, 0.2 * PX); g.fill(); g.stroke();
      label('大本營', x, y, side, 0.21, SIDE_DARK[side]);
    } else if (kind === J.HARBOR) {
      const w = 0.55 * PX, hh = 0.32 * PX;
      g.fillStyle = '#d4e8f2'; g.strokeStyle = '#1d4e6e'; g.lineWidth = 6;
      g.beginPath(); g.roundRect(x - w, y - hh, w * 2, hh * 2, 10); g.fill(); g.stroke();
      label('⚓ 港口', x, y, side, 0.17, 'rgba(20,60,90,0.6)');
    } else if (kind === J.POST) {
      const w = 0.53 * PX, hh = 0.31 * PX;
      g.fillStyle = J.isRail(sq) ? '#e8e2cc' : '#f2ecd6'; g.strokeStyle = '#5c4a2c'; g.lineWidth = 5;
      g.beginPath(); g.roundRect(x - w, y - hh, w * 2, hh * 2, 10); g.fill(); g.stroke();
    } else if (kind === J.SEA || kind === J.LANE) {
      g.strokeStyle = kind === J.LANE ? 'rgba(255,255,255,0.8)' : 'rgba(220,245,255,0.6)'; g.lineWidth = 4;
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.beginPath(); g.ellipse(x, y, 0.5 * PX, 0.3 * PX, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    } else if (kind === J.AIRFIELD) {
      const w = 0.6 * PX, hh = 0.36 * PX;
      g.fillStyle = '#596067'; g.strokeStyle = SIDE_DARK[side]; g.lineWidth = 7;
      g.beginPath(); g.roundRect(x - w, y - hh, w * 2, hh * 2, 8); g.fill(); g.stroke();
      g.strokeStyle = '#f5f5f5'; g.lineWidth = 3; g.setLineDash([14, 10]);
      g.beginPath(); g.moveTo(x - w + 10, y); g.lineTo(x + w - 10, y); g.stroke(); g.setLineDash([]);
      label('飛機場', x, y + (side === 1 ? 0.2 : -0.2) * PX, side, 0.15, '#ffffff');
    }
  }
  // 座標
  g.fillStyle = 'rgba(240,250,255,0.85)'; g.font = `bold ${Math.round(0.24 * PX)}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let c = 0; c < 9; c++) g.fillText('ABCDEFGHI'[c], px((c - 4) * CX), H - 0.3 * PX);
  for (let r = 0; r < 13; r++) g.fillText(String(13 - r), 0.3 * PX, pz(ZR(r)));
  label('海峽', px(-1 * CX), pz(0), 0, 0.26, 'rgba(230,248,255,0.6)');
  label('海峽', px(1 * CX), pz(0), 0, 0.26, 'rgba(230,248,255,0.6)');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------- 棋子貼圖 ----------------
const faceCache = new Map();
function roundRectPath(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function pieceFaceTexture(side, t) {
  const key = side * 32 + t;
  if (faceCache.has(key)) return faceCache.get(key);
  const W = 512, H = 284;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const ink = SIDE_COLOR[side];
  if (t === J.UNK) {
    // 暗子：只看得出陣營
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, side === 0 ? '#d4473f' : '#3a78d4'); grd.addColorStop(1, SIDE_DARK[side]);
    g.fillStyle = grd; roundRectPath(g, 0, 0, W, H, 40); g.fill();
    g.strokeStyle = 'rgba(255,236,190,0.85)'; g.lineWidth = 10; roundRectPath(g, 22, 22, W - 44, H - 44, 28); g.stroke();
    g.fillStyle = 'rgba(255,236,190,0.92)';
    const star = (cx, cy, R) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? R * 0.42 : R; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.fill(); };
    star(W / 2 - 120, H / 2, 58);
    g.font = `900 ${Math.round(H * 0.36)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('小柯', W / 2 + 50, H / 2 + 6);
  } else {
    const dom = domainOf(t);
    const grd = g.createLinearGradient(0, 0, 0, H);
    if (dom === 'sea') { grd.addColorStop(0, '#f2fbff'); grd.addColorStop(1, '#cfe6f2'); }
    else if (dom === 'air') { grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#dfe3e8'); }
    else { grd.addColorStop(0, '#fffaf0'); grd.addColorStop(1, '#f1e4c4'); }
    g.fillStyle = grd; roundRectPath(g, 0, 0, W, H, 40); g.fill();
    g.strokeStyle = ink; g.lineWidth = 12; roundRectPath(g, 18, 18, W - 36, H - 36, 28); g.stroke();
    g.lineWidth = 4; roundRectPath(g, 34, 34, W - 68, H - 68, 20); g.stroke();
    const name = J.NAMES[t];
    g.fillStyle = ink;
    g.font = `900 ${Math.round(H * (name.length >= 3 ? 0.42 : 0.5))}px ${KAI}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 6; g.shadowOffsetY = 3;
    g.fillText(name, W / 2, H / 2 + 12);
    g.shadowColor = 'transparent';
    g.lineWidth = 5; g.strokeStyle = ink; g.strokeText(name, W / 2, H / 2 + 12);
    // 軍種小圖示
    g.font = `700 46px ${FONT}`;
    if (dom === 'sea') g.fillText('⚓', 74, 70);
    else if (dom === 'air') g.fillText('✈', 74, 70);
    else if (t >= J.GONG && t <= J.SI) {
      const n = t >= 8 ? 3 : t >= 6 ? 2 : t >= 4 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const cx = 70 + i * 26, cy = 64, R = 12;
        g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5; const r = k % 2 ? R * 0.42 : R; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  faceCache.set(key, tex);
  return tex;
}

function labelTexture(text, color = '#fff8dc') {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(20,16,8,0.78)';
  g.beginPath(); g.roundRect(4, 8, 248, 80, 26); g.fill();
  g.strokeStyle = 'rgba(255,220,120,0.9)'; g.lineWidth = 4; g.stroke();
  g.fillStyle = color; g.font = `900 46px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Board3D {
  constructor(container, { onSquareClick } = {}) {
    this.container = container;
    this.onSquareClick = onSquareClick || (() => {});
    this.orientation = 0;
    this.pieces = new Map(); // sq → Group
    this.allPieces = new Set();
    this.pendingMoves = new Set();
    this.interactive = true;
    this.anims = [];
    this.labels = new Map();
    this.particles = [];

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#141c22');
    scene.fog = new THREE.Fog('#141c22', 36, 74);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 36;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };

    scene.add(new THREE.HemisphereLight('#fff6e4', '#22303a', 0.85));
    const key = new THREE.DirectionalLight('#ffeccc', 2.2);
    key.position.set(-7, 16, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 });
    key.shadow.bias = -0.0005;
    key.shadow.radius = 4;
    scene.add(key);
    const fill = new THREE.DirectionalLight('#cfe0ff', 0.55);
    fill.position.set(8, 7, -8);
    scene.add(fill);

    this.buildTable();
    this.buildBoard();
    this.buildWater();
    this.buildBridges();
    this.buildLandmarks();
    this.buildFlags();
    this.buildPieceGeometry();
    this.buildMarkers();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP);
    r.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    r.domElement.addEventListener('pointermove', (e) => this.onPointerMove(e));
    r.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.viewName = 'tilt';
    this.resize();
    r.setAnimationLoop(() => this.frame());
  }

  buildTable() {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 1024;
    const g = cv.getContext('2d');
    g.fillStyle = '#2b2418'; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 420; i++) {
      g.strokeStyle = `rgba(${15 + Math.random() * 30},${10 + Math.random() * 15},5,${0.15 + Math.random() * 0.2})`;
      g.lineWidth = 1 + Math.random() * 3;
      const y = Math.random() * 1024;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 32) g.lineTo(x, y + Math.sin(x / 90 + i) * 6);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  buildBoard() {
    const tex = makeBoardTexture();
    const side = new THREE.MeshStandardMaterial({ color: '#5a4a2c', roughness: 0.7 });
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(BW, TOP, BH), [side, side, top, side, side, side]);
    box.position.y = TOP / 2;
    box.receiveShadow = true;
    box.castShadow = true;
    this.scene.add(box);
    const frameMat = new THREE.MeshStandardMaterial({ color: '#3f301a', roughness: 0.55 });
    const fw = 0.28;
    for (const [w, d, x, z] of [[BW + fw * 2, fw, 0, BH / 2 + fw / 2], [BW + fw * 2, fw, 0, -BH / 2 - fw / 2], [fw, BH, BW / 2 + fw / 2, 0], [fw, BH, -BW / 2 - fw / 2, 0]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, TOP + 0.12, d), frameMat);
      m.position.set(x, (TOP + 0.12) / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }
    // 陸地微微隆起（立體沙盤）
    const landMat = new THREE.MeshStandardMaterial({ color: '#cbbf8c', roughness: 0.95 });
    for (const sgn of [-1, 1]) {
      const z0 = sgn > 0 ? ZR(7) - 0.6 : ZR(0) - 0.6, z1 = sgn > 0 ? ZR(12) + 0.6 : ZR(5) + 0.6;
      const w = LAND_X1 - LAND_X0;
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.03, z1 - z0 + 0.06), landMat);
      edge.position.set(0, TOP - 0.012, (z0 + z1) / 2);
      edge.receiveShadow = true;
      this.scene.add(edge);
    }
  }

  // 動態海面：半透明、會起伏的水面蓋在海域上
  buildWater() {
    this.waters = [];
    const mat = new THREE.MeshStandardMaterial({ color: '#2d8fc4', transparent: true, opacity: 0.32, roughness: 0.15, metalness: 0.2, depthWrite: false });
    const add = (x0, x1, z0, z1) => {
      const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.max(2, Math.round((x1 - x0) * 3)), Math.max(2, Math.round((z1 - z0) * 3)));
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set((x0 + x1) / 2, TOP + 0.012, (z0 + z1) / 2);
      m.userData.base = geo.attributes.position.array.slice();
      m.userData.ox = (x0 + x1) / 2; m.userData.oz = (z0 + z1) / 2;
      m.renderOrder = 1;
      this.scene.add(m);
      this.waters.push(m);
    };
    add(-BW / 2 + 0.05, LAND_X0, -BH / 2 + 0.05, BH / 2 - 0.05);
    add(LAND_X1, BW / 2 - 0.05, -BH / 2 + 0.05, BH / 2 - 0.05);
    add(LAND_X0, LAND_X1, ZR(5) + 0.6, ZR(7) - 0.6);
  }

  // 海峽上的三座鐵橋
  buildBridges() {
    const steel = new THREE.MeshStandardMaterial({ color: '#8d8f94', metalness: 0.6, roughness: 0.35 });
    const deck = new THREE.MeshStandardMaterial({ color: '#6b5236', roughness: 0.8 });
    const len = ZR(7) - ZR(5) + 0.2;
    for (const c of [2, 4, 6]) {
      const x = (c - 4) * CX;
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, len), deck);
      d.position.set(x, TOP + 0.03, 0);
      d.castShadow = true; d.receiveShadow = true;
      this.scene.add(d);
      for (const sx of [-0.45, 0.45]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), steel);
        rail.position.set(x + sx, TOP + 0.26, 0);
        rail.castShadow = true;
        this.scene.add(rail);
        // 桁架
        for (let i = 0; i <= 6; i++) {
          const z = -len / 2 + (i * len) / 6;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.05), steel);
          post.position.set(x + sx, TOP + 0.14, z);
          post.castShadow = true;
          this.scene.add(post);
        }
      }
    }
  }

  // 港口燈塔、機場塔台、海上浮標
  buildLandmarks() {
    const white = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: '#ffe9a0', emissive: '#ffcc55', emissiveIntensity: 0.8 });
    const gray = new THREE.MeshStandardMaterial({ color: '#7d8590', roughness: 0.6 });
    this.lamps = [];
    for (let sq = 0; sq < J.NSQ; sq++) {
      if (J.isHarbor(sq)) {
        // 燈塔放在港口外側的海邊
        const x = X(sq) + (J.colOf(sq) < 4 ? -0.72 : 0.72), z = Z(sq) + (J.halfOf(sq) === 0 ? 0.42 : -0.42);
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.62, 12), white);
        tower.position.set(x, TOP + 0.31, z); tower.castShadow = true;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.12, 12), red);
        band.position.set(x, TOP + 0.38, z);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), glass);
        lamp.position.set(x, TOP + 0.68, z);
        this.scene.add(tower, band, lamp);
        this.lamps.push(lamp);
      }
      if (J.isAirfield(sq)) {
        const x = X(sq) + (J.colOf(sq) < 4 ? -0.62 : 0.62), z = Z(sq);
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), gray);
        t.position.set(x, TOP + 0.25, z); t.castShadow = true;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.26), glass);
        cab.position.set(x, TOP + 0.56, z);
        this.scene.add(t, cab);
      }
    }
  }

  // 雙方底線後方的軍旗
  buildFlags() {
    const pole = new THREE.MeshStandardMaterial({ color: '#d8c890', metalness: 0.4, roughness: 0.4 });
    this.flagCloths = [];
    for (const side of [0, 1]) {
      for (const sx of [-1, 1]) {
        const z = side === 0 ? BH / 2 + 0.6 : -BH / 2 - 0.6;
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 10), pole);
        p.position.set(sx * (BW / 2 + 0.2), 1.1, z);
        p.castShadow = true;
        this.scene.add(p);
        const geo = new THREE.PlaneGeometry(0.9, 0.55, 12, 4);
        const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: SIDE_COLOR[side], side: THREE.DoubleSide, roughness: 0.7 }));
        cloth.position.set(sx * (BW / 2 + 0.2) + 0.47 * -sx, 1.9, z);
        cloth.castShadow = true;
        cloth.userData.base = geo.attributes.position.array.slice();
        cloth.userData.sx = sx;
        this.scene.add(cloth);
        this.flagCloths.push(cloth);
      }
    }
  }

  buildPieceGeometry() {
    const bevel = 0.035;
    const extrude = (shape, h) => {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, bevel, 0);
      return geo;
    };
    // 陸軍：圓角方塊
    const w = PW / 2, d = PD / 2, rr = 0.1;
    const box = new THREE.Shape();
    box.moveTo(-w + rr, -d);
    box.lineTo(w - rr, -d); box.quadraticCurveTo(w, -d, w, -d + rr);
    box.lineTo(w, d - rr); box.quadraticCurveTo(w, d, w - rr, d);
    box.lineTo(-w + rr, d); box.quadraticCurveTo(-w, d, -w, d - rr);
    box.lineTo(-w, -d + rr); box.quadraticCurveTo(-w, -d, -w + rr, -d);
    this.bodyGeo = { land: extrude(box, PH) };
    // 軍艦：兩頭尖的船身（左右方向）
    const hull = new THREE.Shape();
    const hw = PW / 2 + 0.12;
    hull.moveTo(-hw, 0);
    hull.quadraticCurveTo(-w + 0.05, -d, -w + 0.2, -d);
    hull.lineTo(w - 0.2, -d); hull.quadraticCurveTo(w - 0.05, -d, hw, 0);
    hull.quadraticCurveTo(w - 0.05, d, w - 0.2, d);
    hull.lineTo(-w + 0.2, d); hull.quadraticCurveTo(-w + 0.05, d, -hw, 0);
    this.bodyGeo.sea = extrude(hull, PH * 0.9);
    // 飛機：比較薄的方塊＋機翼
    this.bodyGeo.air = extrude(box, PH * 0.75);
    this.wingGeo = new THREE.BoxGeometry(0.34, 0.04, PD + 0.62);
    this.tailGeo = new THREE.BoxGeometry(0.16, 0.035, 0.42);
    this.shadowGeo = new THREE.CircleGeometry(0.42, 24);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false });
    this.faceGeo = { land: new THREE.PlaneGeometry(PW - 0.06, PD - 0.06), sea: new THREE.PlaneGeometry(PW - 0.2, PD - 0.08), air: new THREE.PlaneGeometry(PW - 0.06, PD - 0.06) };
    this.faceY = { land: PH + 0.002, sea: PH * 0.9 + 0.002, air: PH * 0.75 + 0.002 };
    this.bodyMat = [0, 1].map((s) => new THREE.MeshStandardMaterial({ color: SIDE_COLOR[s], roughness: 0.42 }));
    this.hullMat = [0, 1].map((s) => new THREE.MeshStandardMaterial({ color: s ? '#2a4f86' : '#8a2a2a', roughness: 0.35, metalness: 0.35 }));
    this.wingMat = [0, 1].map((s) => new THREE.MeshStandardMaterial({ color: s ? '#9fb7da' : '#d9a3a0', roughness: 0.4, metalness: 0.4 }));
    this.faceMat = new Map();
  }

  faceMaterial(side, t) {
    const key = side * 32 + t;
    if (!this.faceMat.has(key)) this.faceMat.set(key, new THREE.MeshStandardMaterial({ map: pieceFaceTexture(side, t), roughness: 0.38 }));
    return this.faceMat.get(key);
  }

  // 依棋子種類（陸、海、空）組出外形；暗子一律用陸軍方塊（不洩漏軍種）
  makePiece(code) {
    const side = code >> 5, t = code & 31;
    const grp = new THREE.Group();
    const inner = new THREE.Group();
    grp.add(inner);
    grp.userData = { code, inner };
    this.buildShape(grp, code);
    this.allPieces.add(grp);
    return grp;
  }

  buildShape(grp, code) {
    const side = code >> 5, t = code & 31;
    const inner = grp.userData.inner;
    inner.clear();
    if (grp.userData.shadow) { grp.remove(grp.userData.shadow); grp.userData.shadow = null; }
    const dom = t === J.UNK ? 'land' : domainOf(t);
    const body = new THREE.Mesh(this.bodyGeo[dom], dom === 'sea' ? this.hullMat[side] : this.bodyMat[side]);
    body.castShadow = true; body.receiveShadow = true;
    inner.add(body);
    if (dom === 'air') {
      const wing = new THREE.Mesh(this.wingGeo, this.wingMat[side]);
      wing.position.set(0.05, PH * 0.3, 0); wing.castShadow = true;
      const tail = new THREE.Mesh(this.tailGeo, this.wingMat[side]);
      tail.position.set(-PW / 2 + 0.05, PH * 0.3, 0); tail.castShadow = true;
      inner.add(wing, tail);
      inner.position.y = AIR_Y;
      const sh = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      sh.rotation.x = -Math.PI / 2;
      sh.position.y = 0.006;
      grp.add(sh);
      grp.userData.shadow = sh;
    } else inner.position.y = 0;
    const face = new THREE.Mesh(this.faceGeo[dom], this.faceMaterial(side, t));
    face.rotation.x = -Math.PI / 2;
    face.rotation.z = this.yaw;
    face.position.y = this.faceY[dom];
    face.receiveShadow = true;
    inner.add(face);
    grp.userData.face = face;
    grp.userData.body = body;
    grp.userData.dom = dom;
  }

  setCode(g, code) {
    if (g.userData.code === code) return;
    const oldDom = g.userData.dom;
    g.userData.code = code;
    const t = code & 31;
    const dom = t === J.UNK ? 'land' : domainOf(t);
    if (dom !== oldDom) this.buildShape(g, code);
    else g.userData.face.material = this.faceMaterial(code >> 5, t);
  }

  buildMarkers() {
    const mk = (color, opacity, geo) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 3;
      this.scene.add(m);
      return m;
    };
    const frame = (w, d, t) => {
      const s = new THREE.Shape();
      s.moveTo(-w, -d); s.lineTo(w, -d); s.lineTo(w, d); s.lineTo(-w, d); s.lineTo(-w, -d);
      const hole = new THREE.Path();
      hole.moveTo(-w + t, -d + t); hole.lineTo(-w + t, d - t); hole.lineTo(w - t, d - t); hole.lineTo(w - t, -d + t); hole.lineTo(-w + t, -d + t);
      s.holes.push(hole);
      return new THREE.ShapeGeometry(s);
    };
    this.selMarker = mk('#ffe066', 0.95, frame(PW / 2 + 0.1, PD / 2 + 0.1, 0.07));
    this.lastFrom = mk('#4fc3f7', 0.8, frame(0.3, 0.2, 0.05));
    this.lastTo = mk('#4fc3f7', 0.85, frame(PW / 2 + 0.08, PD / 2 + 0.08, 0.05));
    this.hintFrom = mk('#7CFC00', 0.9, frame(PW / 2 + 0.1, PD / 2 + 0.1, 0.07));
    this.hintTo = mk('#7CFC00', 0.9, frame(PW / 2 + 0.1, PD / 2 + 0.1, 0.07));
    this.swapMarker = mk('#ff9f1a', 0.95, frame(PW / 2 + 0.12, PD / 2 + 0.12, 0.08));
    this.targets = [];
    this.dotGeo = new THREE.CircleGeometry(0.15, 32);
    this.capGeo = frame(PW / 2 + 0.06, PD / 2 + 0.06, 0.08);
    this.dotMat = new THREE.MeshBasicMaterial({ color: '#2ecc71', transparent: true, opacity: 0.9, depthWrite: false });
    this.capMat = new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.95, depthWrite: false });
    this.zoneMat = new THREE.MeshBasicMaterial({ color: '#ffe9a0', transparent: true, opacity: 0.0, depthWrite: false });
    this.zone = new THREE.Mesh(new THREE.PlaneGeometry(BW - 0.4, 5 * RZ + 1.0), this.zoneMat);
    this.zone.rotation.x = -Math.PI / 2;
    this.zone.visible = false;
    this.zone.renderOrder = 2;
    this.scene.add(this.zone);
    this.hintArrow = null;
  }

  placeMarker(m, sq, y = TOP + 0.02) {
    if (sq == null || sq < 0) { m.visible = false; return; }
    m.position.set(X(sq), y, Z(sq));
    m.rotation.z = 0;
    m.visible = true;
  }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitDistance();
  }

  get yaw() { return this.orientation === 0 ? 0 : Math.PI; }

  applyYaw() {
    const y = this.yaw;
    if (y === this.lastYaw) return;
    this.lastYaw = y;
    for (const g of this.allPieces) g.userData.face.rotation.z = y;
  }

  fitDistance() {
    if (!this.viewName) return;
    this.applyYaw();
    const yaw = this.yaw;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    const top = this.viewName === 'top';
    const needW = (BW / 2 + 0.5) / tanH;
    const needH = (top ? BH / 2 + 0.4 : BH / 2 * 0.86 + 0.6) / tanV;
    const dist = Math.max(needW, needH) * (this.viewName === 'low' ? 0.98 : 1);
    const sx = Math.sin(yaw), sz = Math.cos(yaw);
    const off = top ? 0 : 0.7;
    const target = new THREE.Vector3(sx * off, 0, sz * off);
    const [up, out] = top ? [1, 0.0001] : this.viewName === 'low' ? [0.6, 0.8] : [0.82, 0.57];
    const dir = new THREE.Vector3(sx * out, up, sz * out).normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.controls.maxDistance = Math.max(36, dist * 1.4);
    this.camera.lookAt(target);
    this.controls.update();
  }

  setView(name) { this.viewName = name; this.fitDistance(); }

  setOrientation(side) {
    this.orientation = side ? 1 : 0;
    this.lastYaw = null;
    this.fitDistance();
    this.refreshLabels();
  }

  // board：117 格棋子代碼（看不到的敵子用 UNK）
  setPosition(board) {
    for (const g of this.allPieces) this.scene.remove(g);
    this.allPieces.clear();
    this.pieces.clear();
    for (let sq = 0; sq < J.NSQ; sq++) {
      const p = board[sq];
      if (!p) continue;
      const g = this.makePiece(p);
      g.position.set(X(sq), TOP, Z(sq));
      this.scene.add(g);
      this.pieces.set(sq, g);
    }
    this.anims = [];
    for (const done of [...this.pendingMoves]) done();
    this.pendingMoves.clear();
    this.clearParticles();
    this.refreshLabels();
  }

  // 不重建場景，只更新棋子正反面（例如亮出軍旗、偵察翻開、對局結束全部翻開）
  updateCodes(board) {
    for (const [sq, g] of this.pieces) if (board[sq]) this.setCode(g, board[sq]);
  }

  pendingPromise(fn) {
    return new Promise((res) => {
      const resolve = () => { this.pendingMoves.delete(resolve); res(); };
      this.pendingMoves.add(resolve);
      fn(resolve);
    });
  }

  tween(g, end, { duration = 420, lift = 0.6 } = {}) {
    return this.pendingPromise((resolve) => {
      const start = g.position.clone();
      const t0 = performance.now();
      this.anims.push((now) => {
        const k = Math.min(1, (now - t0) / duration);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        g.position.lerpVectors(start, end, e);
        g.position.y = end.y + Math.sin(Math.PI * e) * lift;
        if (k >= 1) { g.position.copy(end); resolve(); return false; }
        return true;
      });
    });
  }

  // 移動／交戰動畫。out：move｜win｜lose｜tie｜flag｜scout；stay：遠距攻擊（砲擊、防空射擊）後留在原地
  async animateMove(from, to, out = 'move', { attackerCode, defenderCode, stay = false } = {}) {
    const g = this.pieces.get(from);
    if (!g) return;
    const victim = this.pieces.get(to);
    if (attackerCode) this.setCode(g, attackerCode);
    if (victim && defenderCode) this.setCode(victim, defenderCode);
    const end = new THREE.Vector3(X(to), TOP, Z(to));
    const home = g.position.clone();
    const dist = g.position.distanceTo(end);
    const ship = g.userData.dom === 'sea', air = g.userData.dom === 'air';
    if (out === 'move' || !victim) {
      this.pieces.delete(from);
      this.pieces.set(to, g);
      if (ship) this.wake(home, end);
      await this.tween(g, end, { duration: 300 + Math.min(600, dist * 50), lift: ship ? 0.05 : air ? 0.5 : 0.35 + Math.min(0.8, dist * 0.07) });
      return;
    }
    if (out === 'scout') {
      // 偵察機飛過去繞一圈再回來
      const over = end.clone().setY(TOP + 0.8);
      await this.tween(g, over, { duration: 380 + Math.min(400, dist * 40), lift: 0.4 });
      this.spark(end, '#7fe3ff', 26, 0.8);
      await this.tween(g, home, { duration: 420, lift: 0.4 });
      return;
    }
    const dir = end.clone().sub(g.position).normalize();
    if (stay) {
      // 遠距攻擊：發射砲彈
      await this.shell(g.position.clone().setY(TOP + 0.4), end.clone().setY(TOP + 0.3));
    } else {
      const hit = end.clone().addScaledVector(dir, -0.55);
      this.pieces.delete(from);
      await this.tween(g, hit, { duration: 260 + Math.min(450, dist * 40), lift: ship ? 0.08 : 0.4 + Math.min(0.8, dist * 0.07) });
    }
    this.spark(end, out === 'tie' ? '#ffb000' : '#ffffff', out === 'tie' ? 46 : 22);
    this.shake(0.12);
    if (out === 'win' || out === 'flag') {
      this.flyAway(victim, dir);
      if (stay) return;
      this.pieces.set(to, g);
      await this.tween(g, end, { duration: 220, lift: 0.15 });
      if (out === 'flag') this.spark(end, '#ffd700', 90, 2.2);
    } else if (out === 'lose') {
      this.pieces.delete(from);
      this.pieces.set(to, victim);
      this.flyAway(g, dir.clone().negate());
      await new Promise((r) => setTimeout(r, 300));
    } else {
      this.pieces.delete(from);
      this.pieces.delete(to);
      this.explode(g); this.explode(victim);
      await new Promise((r) => setTimeout(r, 420));
    }
  }

  // 砲彈飛行
  shell(a, b) {
    return this.pendingPromise((resolve) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffdd66' }));
      this.scene.add(ball);
      const t0 = performance.now(), dur = 420;
      this.anims.push((now) => {
        const k = Math.min(1, (now - t0) / dur);
        ball.position.lerpVectors(a, b, k);
        ball.position.y += Math.sin(Math.PI * k) * 1.2;
        if (k >= 1) { this.scene.remove(ball); ball.geometry.dispose(); resolve(); return false; }
        return true;
      });
    });
  }

  // 軍艦航行的浪花
  wake(a, b) {
    const n = 6;
    for (let i = 0; i < n; i++) setTimeout(() => this.spark(a.clone().lerp(b, i / n).setY(TOP), '#e8f8ff', 6, 0.35), i * 60);
  }

  // 布陣交換
  async animateSwap(a, b) {
    const ga = this.pieces.get(a), gb = this.pieces.get(b);
    if (ga) this.pieces.set(b, ga); else this.pieces.delete(b);
    if (gb) this.pieces.set(a, gb); else this.pieces.delete(a);
    await Promise.all([
      ga ? this.tween(ga, new THREE.Vector3(X(b), TOP, Z(b)), { duration: 380, lift: 0.55 }) : null,
      gb ? this.tween(gb, new THREE.Vector3(X(a), TOP, Z(a)), { duration: 380, lift: 0.3 }) : null,
    ]);
  }

  flyAway(g, dir) {
    const start = g.position.clone();
    const out = start.clone().add(new THREE.Vector3(dir.x * 1.6 + (Math.sign(start.x) || 1) * 1.4, 2.4, dir.z * 1.6));
    const t0 = performance.now();
    const dur = 620;
    this.anims.push((now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      g.position.lerpVectors(start, out, e);
      g.scale.setScalar(Math.max(0.01, 1 - e));
      g.rotation.x = e * Math.PI * 1.5;
      g.rotation.z = e * 1.3;
      if (k >= 1) { this.scene.remove(g); this.allPieces.delete(g); return false; }
      return true;
    });
  }

  explode(g) {
    this.spark(g.position.clone().setY(TOP + 0.2), '#ff6a00', 40, 1.6);
    const t0 = performance.now();
    const v = new THREE.Vector3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2);
    const start = g.position.clone();
    this.anims.push((now) => {
      const k = Math.min(1, (now - t0) / 650);
      g.position.set(start.x + v.x * k, start.y + v.y * k - 4 * k * k, start.z + v.z * k);
      g.rotation.x += 0.25; g.rotation.y += 0.18;
      g.scale.setScalar(Math.max(0.01, 1 - k));
      if (k >= 1) { this.scene.remove(g); this.allPieces.delete(g); return false; }
      return true;
    });
  }

  // 火花粒子
  spark(pos, color = '#ffffff', n = 24, power = 1) {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) {
      arr[i * 3] = pos.x; arr[i * 3 + 1] = pos.y + 0.25; arr[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2, s = (0.8 + Math.random() * 2.2) * power;
      vel.push(new THREE.Vector3(Math.cos(a) * s, (1 + Math.random() * 2.5) * power, Math.sin(a) * s));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.12, transparent: true, opacity: 1, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    const t0 = performance.now();
    const p = { pts };
    this.particles.push(p);
    this.anims.push((now) => {
      const k = Math.min(1, (now - t0) / 700);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = pos.x + vel[i].x * k * 0.7;
        arr[i * 3 + 1] = pos.y + 0.25 + vel[i].y * k * 0.7 - 2.5 * k * k;
        arr[i * 3 + 2] = pos.z + vel[i].z * k * 0.7;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - k;
      if (k >= 1) { this.scene.remove(pts); geo.dispose(); mat.dispose(); this.particles = this.particles.filter((x) => x !== p); return false; }
      return true;
    });
  }
  clearParticles() { for (const p of this.particles) this.scene.remove(p.pts); this.particles = []; }

  shake(amount) {
    const t0 = performance.now();
    this.shakeAnim = (now) => {
      const k = (now - t0) / 260;
      if (k >= 1) { this.shakeAnim = null; return 0; }
      return amount * (1 - k) * Math.sin(k * 40);
    };
  }

  setSelected(sq) {
    this.selected = sq;
    this.placeMarker(this.selMarker, sq, TOP + 0.022);
    for (const [s, g] of this.pieces) if (!this.anims.length || s === sq) g.position.y = s === sq ? TOP + 0.16 : TOP;
  }

  setSwapMark(sq) { this.placeMarker(this.swapMarker, sq, TOP + 0.024); for (const [s, g] of this.pieces) g.position.y = s === sq ? TOP + 0.2 : TOP; }

  setTargets(list, board) {
    for (const m of this.targets) this.scene.remove(m);
    this.targets = [];
    for (const sq of list || []) {
      const cap = board && board[sq];
      const m = new THREE.Mesh(cap ? this.capGeo : this.dotGeo, cap ? this.capMat : this.dotMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(X(sq), TOP + 0.025, Z(sq));
      m.renderOrder = 3;
      this.scene.add(m);
      this.targets.push(m);
    }
  }

  setLastMove(from, to) {
    this.placeMarker(this.lastFrom, from);
    this.placeMarker(this.lastTo, to);
  }

  setHint(from, to) {
    this.placeMarker(this.hintFrom, from, TOP + 0.026);
    this.placeMarker(this.hintTo, to, TOP + 0.026);
    if (this.hintArrow) { this.scene.remove(this.hintArrow); this.hintArrow = null; }
    if (from == null || from < 0 || from === to) return;
    const a = new THREE.Vector3(X(from), TOP + 0.9, Z(from));
    const b = new THREE.Vector3(X(to), TOP + 0.9, Z(to));
    const dir = b.clone().sub(a);
    const len = dir.length();
    this.hintArrow = new THREE.ArrowHelper(dir.normalize(), a, len, 0x39ff14, Math.min(0.6, len * 0.35), 0.35);
    this.scene.add(this.hintArrow);
  }

  // 布陣時標出自己的半邊
  setZone(side) {
    if (side == null) { this.zone.visible = false; return; }
    this.zone.position.set(0, TOP + 0.02, side === 0 ? (ZR(7) + ZR(12)) / 2 : (ZR(0) + ZR(5)) / 2);
    this.zone.visible = true;
  }

  // 敵子推算標籤：Map sq → { text, color }
  setLabels(map) {
    this.labelData = map || new Map();
    this.refreshLabels();
  }
  refreshLabels() {
    for (const s of this.labels.values()) { s.parent && s.parent.remove(s); s.material.map.dispose(); s.material.dispose(); }
    this.labels.clear();
    if (!this.labelData) return;
    for (const [sq, { text, color }] of this.labelData) {
      const g = this.pieces.get(sq);
      if (!g) continue;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(text, color), depthTest: false, transparent: true }));
      sp.scale.set(0.95, 0.36, 1);
      sp.position.set(0, PH + 0.42 + (g.userData.dom === 'air' ? AIR_Y : 0), 0);
      sp.renderOrder = 10;
      g.add(sp);
      this.labels.set(sq, sp);
    }
  }

  setInteractive(on) {
    this.interactive = on;
    this.renderer.domElement.style.cursor = on ? 'default' : 'not-allowed';
  }

  pickSquare(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    for (const [sq, g] of this.pieces) g.traverse((c) => { if (c.isMesh && c !== g.userData.shadow) { c.userData.sq = sq; meshes.push(c); } });
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (hit) return hit.object.userData.sq;
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, p)) return -1;
    let best = -1, bd = 1e9;
    for (let sq = 0; sq < J.NSQ; sq++) {
      if (!J.isNode(sq)) continue;
      const dx = (p.x - X(sq)) / (PW * 0.6), dz = (p.z - Z(sq)) / (PD * 0.8);
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = sq; }
    }
    return bd <= 1.2 ? best : -1;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const sq = this.pickSquare(e);
    if (sq >= 0) this.onSquareClick(sq);
  }

  onPointerMove(e) {
    if (!this.interactive) return;
    const sq = this.pickSquare(e);
    this.renderer.domElement.style.cursor = sq >= 0 && (this.pieces.has(sq) || this.targets.length) ? 'pointer' : 'default';
  }

  frame() {
    const now = performance.now();
    const running = this.anims;
    this.anims = [];
    const keep = running.filter((fn) => fn(now) !== false);
    this.anims = keep.concat(this.anims);
    const t = now / 1000;
    if (this.selMarker.visible) this.selMarker.material.opacity = 0.65 + 0.3 * Math.sin(t * 5);
    if (this.swapMarker.visible) this.swapMarker.material.opacity = 0.6 + 0.35 * Math.sin(t * 6);
    if (this.zone.visible) this.zoneMat.opacity = 0.1 + 0.06 * Math.sin(t * 2.5);
    // 旗子飄動
    for (const c of this.flagCloths) {
      const pos = c.geometry.attributes.position, base = c.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const k = (x * -c.userData.sx + 0.45) / 0.9;
        pos.setZ(i, Math.sin(t * 4 + x * 6) * 0.08 * k);
      }
      pos.needsUpdate = true;
    }
    // 海面起伏
    for (const w of this.waters) {
      const pos = w.geometry.attributes.position, base = w.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3] + w.userData.ox, z = base[i * 3 + 2] + w.userData.oz;
        pos.setY(i, Math.sin(t * 1.6 + x * 2.1 + z * 1.3) * 0.012 + Math.sin(t * 2.3 - z * 2.7) * 0.008);
      }
      pos.needsUpdate = true;
    }
    // 軍艦隨浪搖晃、飛機上下浮動、燈塔閃爍
    for (const g of this.allPieces) {
      const inner = g.userData.inner;
      if (!inner) continue;
      const ph = g.position.x * 1.7 + g.position.z * 1.1;
      if (g.userData.dom === 'sea') { inner.rotation.z = Math.sin(t * 1.8 + ph) * 0.03; inner.rotation.x = Math.sin(t * 1.3 + ph) * 0.025; }
      else if (g.userData.dom === 'air') inner.position.y = AIR_Y + Math.sin(t * 2 + ph) * 0.04;
    }
    for (const l of this.lamps) l.material.emissiveIntensity = 0.5 + 0.5 * Math.max(0, Math.sin(t * 2.4));
    this.controls.update();
    if (this.shakeAnim) {
      const s = this.shakeAnim(now);
      this.camera.position.x += s;
      this.renderer.render(this.scene, this.camera);
      this.camera.position.x -= s;
    } else this.renderer.render(this.scene, this.camera);
  }

  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }
}

export { baseY };
