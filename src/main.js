// 星际基地 · 沙盒建造 —— 主程序
import * as THREE from 'three';
import { GodCamera } from './camera.js';
import { Builder } from './builder.js';
import { Palette } from './palette.js';
import { CELL, CATALOG } from './catalog.js';
import { loadPiece } from './loader.js';
import { generateMap } from './mapgen.js';

const app = document.getElementById('app');
const statusMsg = document.getElementById('statusMsg');
const snapTip = document.getElementById('snapTip');

// ── 渲染器 / 场景 ──────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.classList.add('game');
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x12141c);
scene.fog = new THREE.Fog(0x12141c, 160, 320);

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3450, 0.9));
const sun = new THREE.DirectionalLight(0xffeedd, 1.7);
sun.position.set(50, 80, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
sun.shadow.camera.far = 260;
sun.shadow.bias = -0.0004;
scene.add(sun);

// 地面 + 网格
const GROUND_HALF = 100;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2),
  new THREE.MeshStandardMaterial({ color: 0x23263a, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(GROUND_HALF * 2, (GROUND_HALF * 2) / CELL, 0x4a5080, 0x2e3350);
grid.position.y = 0.01;
grid.material.transparent = true;
grid.material.opacity = 0.55;
scene.add(grid);

const cam = new GodCamera(renderer.domElement);
const builder = new Builder(scene);
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// ── UI 状态 ────────────────────────────
let mode = 'build'; // build | delete
const modeBuildBtn = document.getElementById('modeBuild');
const modeDeleteBtn = document.getElementById('modeDelete');
function setMode(m) {
  mode = m;
  modeBuildBtn.classList.toggle('active', m === 'build');
  modeDeleteBtn.classList.toggle('active', m === 'delete');
  if (m === 'delete') { palette.markSelected(null); builder.select(null); }
  snapTip.style.display = 'none';
}
modeBuildBtn.onclick = () => setMode('build');
modeDeleteBtn.onclick = () => setMode('delete');

let msgTimer = 0;
function say(text, ms = 2200) {
  statusMsg.textContent = text;
  clearTimeout(msgTimer);
  if (ms) msgTimer = setTimeout(() => (statusMsg.textContent = ''), ms);
}

const palette = new Palette((kind) => {
  setMode('build');
  builder.pendingKind = kind;
  builder.select(kind);
  if (kind) {
    const d = CATALOG[kind];
    if (d.type === 'door') say('门会自动磁吸建筑边缘;对准墙可直接替换嵌入', 3600);
    else if (d.type === 'edge') say('墙沿格子边线吸附,鼠标位置决定朝向', 3000);
    else say(`已选择:${d.name}`);
  }
});

document.getElementById('rotBtn').onclick = () => builder.rotate();
document.getElementById('saveBtn').onclick = () => {
  localStorage.setItem('space-sandbox-save', builder.serialize());
  say('✅ 已保存到浏览器');
};
document.getElementById('loadBtn').onclick = async () => {
  const data = localStorage.getItem('space-sandbox-save');
  if (!data) return say('没有找到存档');
  await builder.deserialize(data);
  say('✅ 已载入存档');
};
document.getElementById('clearBtn').onclick = () => {
  builder.clearAll();
  say('已清空场景');
};
let generating = false;
document.getElementById('genBtn').onclick = async () => {
  if (generating) return;
  generating = true;
  say('🗺️ 正在生成地图…', 0);
  try {
    const r = await generateMap(builder);
    say(`🗺️ 地图生成完毕:${r.placed} 块地形 · ${r.trees} 棵树(种子 ${r.seed})`, 4000);
  } catch (err) {
    console.error(err);
    say('⛔ 生成失败,详见控制台');
  }
  generating = false;
};

// ── 鼠标交互 ───────────────────────────
const mouse = new THREE.Vector2();
let mouseClient = { x: 0, y: 0 };
let downInfo = null;

function pickGround(e) {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, cam.camera);
  // 优先命中已放置物体(指着屋顶可以往上堆叠),否则落到地面
  if (builder.selected) {
    const hits = raycaster.intersectObjects(builder.world.children, true);
    if (hits.length) return hits[0].point;
  }
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}
function pickObject(e) {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, cam.camera);
  const hits = raycaster.intersectObjects(builder.world.children, true);
  return hits.length ? builder.uidFromObject(hits[0].object) : null;
}

let overUI = false;
window.addEventListener('pointermove', (e) => {
  overUI = e.target !== renderer.domElement;
  if (!overUI) mouseClient = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  downInfo = { x: e.clientX, y: e.clientY, btn: e.button };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downInfo) return;
  const moved = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
  const btn = downInfo.btn;
  downInfo = null;
  if (moved > 6) return; // 拖拽不算点击

  if (btn === 0) {
    if (mode === 'delete') {
      const uid = pickObject(e);
      if (uid && builder.remove(uid)) say('已拆除');
      return;
    }
    if (builder.selected) {
      // 用点击坐标同步重算吸附(避免使用过期的悬停位置)
      mouseClient = { x: e.clientX, y: e.clientY };
      const p = pickGround(e);
      if (p) builder.updateHover(p);
      if (!builder.plan) return;
      const wasReplace = builder.plan.replace;
      const rec = builder.place();
      if (rec) say(wasReplace ? '🚪 已替换墙体,门严丝合缝嵌入!' : `已放置:${CATALOG[rec.kind].name}`, wasReplace ? 3000 : 1500);
      else say('⛔ 此处无法放置');
    }
  } else if (btn === 2) {
    // 右键点击(未拖拽)= 拆除
    const uid = pickObject(e);
    if (uid && builder.remove(uid)) say('已拆除');
  }
});

renderer.domElement.addEventListener('dblclick', (e) => {
  const uid = pickObject(e);
  if (uid) {
    const rec = builder.records.get(uid);
    if (rec && builder.toggleDoor(uid)) say(rec.doorOpen ? '🚪 门已开启' : '🚪 门已关闭', 1200);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') builder.rotate();
  if (e.code === 'Escape') { palette.markSelected(null); builder.pendingKind = null; builder.select(null); snapTip.style.display = 'none'; }
  if (e.code === 'KeyX') setMode(mode === 'delete' ? 'build' : 'delete');
});

// ── 帧循环 ─────────────────────────────
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  cam.resize(innerWidth, innerHeight);
}
window.addEventListener('resize', resize);
resize();

window.__dbg = { builder, cam, THREE }; // 调试用
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  cam.update(dt);
  builder.update(dt);

  // 幽灵吸附预览(鼠标在 UI 面板上时隐藏)
  if (mode === 'build' && builder.selected && !overUI) {
    const p = pickGround({ clientX: mouseClient.x, clientY: mouseClient.y });
    const plan = p ? builder.updateHover(p) : null;
    if (plan && plan.valid && (plan.replace || plan.snapped)) {
      snapTip.style.display = 'block';
      snapTip.className = plan.replace ? 'replace' : '';
      snapTip.textContent = plan.replace ? '⇄ 替换墙体 · 严丝合缝' : '⌁ 已吸附建筑边缘';
      snapTip.style.left = mouseClient.x + 'px';
      snapTip.style.top = mouseClient.y + 'px';
    } else {
      snapTip.style.display = 'none';
    }
  } else if (builder.ghost) {
    builder.ghost.visible = false;
    snapTip.style.display = 'none';
  }

  renderer.render(scene, cam.camera);
}

// ── 启动:预热常用模型,进度条 ─────────
const WARMUP = [
  'template-floor', 'template-wall', 'gate-door', 'room-small', 'corridor',
  'template-floor-big', 'gate', 'corridor-corner', 'road-001', 'road-002',
];
const loadFill = document.getElementById('loadFill');
const loadText = document.getElementById('loadText');
let done = 0;
await Promise.all(WARMUP.map(async (k) => {
  try { await loadPiece(k); } catch (err) { console.warn('预热失败', k, err); }
  done++;
  loadFill.style.width = `${(done / WARMUP.length) * 100}%`;
  loadText.textContent = `正在加载模块… ${done}/${WARMUP.length}`;
}));
document.getElementById('loading').remove();
say('🛰️ 欢迎!从左侧选择模块开始建造', 4000);
tick();
