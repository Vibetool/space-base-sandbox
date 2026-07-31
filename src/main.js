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

// 触屏设备:交互方式与渲染开销都按此分流
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

// ── 渲染器 / 场景 ──────────────────────
// 创建可能失败(WebGL2 不可用 / GPU 进内核黑名单),失败必须给人话提示,不能卡在加载页
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH }); // 移动端关 MSAA:省约 40MB 显存
} catch (err) {
  window.__fatal?.('此设备或浏览器不支持 WebGL2,无法运行 3D 场景。请升级微信,或用系统浏览器打开');
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = IS_TOUCH ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; // 16 tap 软阴影移动端扛不住
// 场景是静态的,阴影只在变更时重画(阴影 pass 占全部 draw call 的 84%,每帧重画纯浪费)
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
const dirtyShadow = () => { renderer.shadowMap.needsUpdate = true; };
// 微信切后台 / 显存吃紧会回收 GL 上下文,不处理就是永久黑屏且无任何提示
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  window.__fatal?.('渲染中断:切后台或显存不足导致上下文丢失');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  window.__fatalClear?.();
  dirtyShadow();
});
renderer.domElement.classList.add('game');
app.appendChild(renderer.domElement);

// 明亮暖灰棚拍氛围(对标 Kenney 样张;深色夜景会让所有瓦片发暗发紫)
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9e6dd);
scene.fog = null;

// 光比:半球光只管"不让竖直面暗成深蓝",主导权交给方向光 —— 草坡瓦片被锁死在 20°,
// 半球光按 normal.y 着色,20° 坡与平面只差 3%,半球光一强就把整座山冲成一块平绿板
scene.add(new THREE.HemisphereLight(0xffffff, 0xdedad0, 1.05));
const sun = new THREE.DirectionalLight(0xfff6e8, 1.45);
sun.position.set(58, 58, 74); // 太阳压低到约 33°:坡面向阳/背阳的明暗差拉开到 2 倍以上
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
sun.shadow.camera.far = 260;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
// 补光改中性白(原先偏蓝会把阴影染成 navy),并加强以提亮渠壁背光面
const fill = new THREE.DirectionalLight(0xffffff, 0.42);
fill.position.set(-60, 45, -55);
scene.add(fill);

// 地面(Kenney Stone 精确色 216,211,191)
const GROUND_HALF = 100;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2),
  new THREE.MeshStandardMaterial({ color: 0xd8d3bf, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);
// 网格线抬到铺装面之上,才有样张那种"带细网格的铺装广场";否则被瓦片整块埋住
const grid = new THREE.GridHelper(GROUND_HALF * 2, (GROUND_HALF * 2) / CELL, 0xb9b2a0, 0xcbc4b2);
grid.position.y = 0.845;
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.material.depthWrite = false;
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
  // 窄屏上调色板是底部抽屉:选完模块自动收起,露出画布好放置
  if (kind && matchMedia('(max-width: 700px)').matches) {
    document.getElementById('palette').classList.add('collapsed');
  }
  if (kind) {
    const d = CATALOG[kind];
    if (d.type === 'door') say('门会自动磁吸建筑边缘;对准墙可直接替换嵌入', 3600);
    else if (d.type === 'edge') say('墙沿格子边线吸附,鼠标位置决定朝向', 3000);
    else say(`已选择:${d.name}`);
  }
});

document.getElementById('rotBtn').onclick = () => builder.rotate();
document.getElementById('palToggle').onclick = () => {
  document.getElementById('palette').classList.toggle('collapsed');
};
document.getElementById('saveBtn').onclick = () => {
  // 微信 WebView 里 localStorage 可能被禁/已满,裸调用会静默炸掉
  try {
    localStorage.setItem('space-sandbox-save', builder.serialize());
    say('✅ 已保存到本机浏览器(清理微信缓存会丢失)', 3000);
  } catch {
    say('⛔ 保存失败:浏览器存储不可用或已满');
  }
};
document.getElementById('loadBtn').onclick = async () => {
  const data = localStorage.getItem('space-sandbox-save');
  if (!data) return say('没有找到存档');
  await builder.deserialize(data);
  dirtyShadow();
  say('✅ 已载入存档');
};
document.getElementById('clearBtn').onclick = () => {
  builder.clearAll();
  dirtyShadow();
  say('已清空场景');
};
let generating = false;
document.getElementById('genBtn').onclick = async () => {
  if (generating) return;
  generating = true;
  say('🗺️ 正在生成地图…', 0);
  renderer.shadowMap.autoUpdate = true; // 生成期间瓦片持续入场,恢复逐帧阴影
  try {
    const r = await generateMap(builder);
    say(`🗺️ 地图生成完毕:${r.placed} 块地形 · ${r.trees} 棵树(种子 ${r.seed})`, 4000);
  } catch (err) {
    console.error(err);
    say('⛔ 生成失败,详见控制台');
  }
  renderer.shadowMap.autoUpdate = false;
  dirtyShadow();
  generating = false;
};

// ── 鼠标 / 触屏交互 ────────────────────
const mouse = new THREE.Vector2();
// 初值取屏幕中心:触屏没有 hover,(0,0) 会让首次预览算在被工具栏压住的左上角
let mouseClient = { x: innerWidth / 2, y: innerHeight / 2 };
let downInfo = null;
let canvasTouch = false; // 画布上有手指按着(触屏预览只在此期间计算)
let lpTimer = 0, lpFired = false; // 长按开关门(触屏没有可靠的 dblclick)

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
  // 手指一旦拖开就不再是"长按",取消开门计时
  if (downInfo && Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y) > 10) clearTimeout(lpTimer);
});
// 触屏上 pointermove 只在按下时触发,overUI/坐标必须在按下时同步,否则一直用上一次的值
window.addEventListener('pointerdown', (e) => {
  overUI = e.target !== renderer.domElement;
  if (!overUI) mouseClient = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) { downInfo = null; clearTimeout(lpTimer); return; } // 第二指落下:这是缩放手势,取消点击/长按
  downInfo = { x: e.clientX, y: e.clientY, btn: e.button, touch: e.pointerType === 'touch' };
  lpFired = false;
  if (e.pointerType === 'touch') {
    canvasTouch = true;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      // 长按 550ms 且未拖动 = 开/关门(触屏的 dblclick 会被浏览器双击缩放吃掉)
      const uid = pickObject(e);
      const rec = uid && builder.records.get(uid);
      if (rec && builder.toggleDoor(uid)) {
        lpFired = true;
        say(rec.doorOpen ? '🚪 门已开启' : '🚪 门已关闭', 1200);
        if (navigator.vibrate) navigator.vibrate(20);
      }
    }, 550);
  }
});
// 手指在画布外抬起 / 手势被浏览器取消:清掉遗留状态,避免下一次点击误判
for (const t of ['pointerup', 'pointercancel']) {
  window.addEventListener(t, () => { canvasTouch = false; clearTimeout(lpTimer); downInfo = null; });
}

renderer.domElement.addEventListener('pointerup', (e) => {
  clearTimeout(lpTimer);
  canvasTouch = false;
  if (!downInfo) return;
  if (lpFired) { downInfo = null; return; } // 长按已消费这次触摸,别再放置
  const moved = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
  const btn = downInfo.btn;
  const slop = downInfo.touch ? 14 : 6; // 手指点击天然抖动 8~15px,6px 会大量误判成拖拽
  downInfo = null;
  if (moved > slop) return; // 拖拽不算点击

  if (btn === 0) {
    if (mode === 'delete') {
      const uid = pickObject(e);
      if (uid && builder.remove(uid)) { dirtyShadow(); say('已拆除'); }
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
      if (rec) { dirtyShadow(); say(wasReplace ? '🚪 已替换墙体,门严丝合缝嵌入!' : `已放置:${CATALOG[rec.kind].name}`, wasReplace ? 3000 : 1500); }
      else say('⛔ 此处无法放置');
    }
  } else if (btn === 2) {
    // 右键点击(未拖拽)= 拆除
    const uid = pickObject(e);
    if (uid && builder.remove(uid)) { dirtyShadow(); say('已拆除'); }
  }
});

renderer.domElement.addEventListener('dblclick', (e) => {
  const uid = pickObject(e);
  if (uid) {
    const rec = builder.records.get(uid);
    if (rec && builder.toggleDoor(uid)) say(rec.doorOpen ? '🚪 门已开启' : '🚪 门已关闭', 1200);
  }
});

// 面板/文字上的长按也别弹"保存图片/复制"系统菜单(画布上的已由 camera.js 拦截)
document.addEventListener('contextmenu', (e) => e.preventDefault());

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
  if (builder.update(dt)) dirtyShadow(); // 门在动的期间逐帧重画阴影

  // 幽灵吸附预览(鼠标在 UI 面板上时隐藏)。
  // 触屏没有 hover,只在手指按住画布时计算 —— 空闲帧省掉全场景 raycast
  if (mode === 'build' && builder.selected && !overUI && (!IS_TOUCH || canvasTouch)) {
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
// 注意:不能用顶层 await —— 老安卓微信内核(Chrome<89)解析期就报错,整包白屏
const WARMUP = [
  'template-floor', 'template-wall', 'gate-door', 'room-small', 'corridor',
  'template-floor-big', 'gate', 'corridor-corner', 'road-001', 'road-002',
];
async function boot() {
  const loadFill = document.getElementById('loadFill');
  const loadText = document.getElementById('loadText');
  let done = 0;
  const warm = Promise.all(WARMUP.map(async (k) => {
    try { await loadPiece(k); } catch (err) { console.warn('预热失败', k, err); }
    done++;
    loadFill.style.width = `${(done / WARMUP.length) * 100}%`;
    loadText.textContent = `正在加载模块… ${done}/${WARMUP.length}`;
  }));
  // 弱网兜底:预热 15 秒没完也进游戏,缺的模型用到时再加载
  await Promise.race([warm, new Promise((r) => setTimeout(r, 15000))]);
  document.getElementById('loading').remove();
  window.__booted = true; // 通知 index.html 的看门狗:启动成功
  say(IS_TOUCH
    ? '👆 单指拖动转视角 · 双指缩放/平移 · 点击放置 · 长按门开/关'
    : '🛰️ 欢迎!从左侧选择模块开始建造', IS_TOUCH ? 6500 : 4000);
  tick();
}
boot().catch((err) => {
  console.error(err);
  window.__fatal?.(`初始化失败:${(err && err.message) || err}`);
});
