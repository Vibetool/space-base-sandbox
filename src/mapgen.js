// 地图自动生成:复刻 Kenney 官方样张
//   米黄铺装广场 + 稀疏规整路网(大半径弯道·桥) + 折线水渠与开阔水池 + 多层梯田草丘 + 成簇树木
//
// 瓦片编号与高度均来自 glTF 顶点实测(tools/analyze-road-tiles.mjs):
// 所有地表件 native 高度一致 = 0.63(世界 0.84),故全部 y=0 平放,无需下沉。
import { CELL } from './catalog.js';
const id = (n) => `road-${String(n).padStart(3, '0')}`;

const S = CELL / 3;          // 道路瓦片缩放 4/3
export const Y_PAVE = 0.63 * S;  // 0.84      米黄地表基准(全图地面高度)
const Y_GRASS = 0.55 * S;    // 0.7333    草地面(比米黄低 0.107,天然路缘)
const TIER_STEP = 1.10 * S;  // 1.4667    坡道瓦片跨越的高差(0.55→1.65),坡度锁死约 20°
const MAXTIER = 5;           // 山体最高层数
// 山体用竖直崖壁堆叠:坡道瓦片只能做 20° 缓坡,靠堆草块才能做出又高又尖的山
const BLOCK_H = 1.65 * S;    // 2.20   草块(36)的世界高度
const RISE = 2;              // 每内缩 1 格升 2 块 → 约 48°,远陡于坡道的 20°
const MOUNT_COUNT = 3;       // 山的座数
const MOUNT_MIN = 8, MOUNT_MAX = 11; // 基座尺寸(小一些,和地图比例协调)

const T = {
  pave: 2,        // 纯米黄铺装(64 含白线会 z-fighting,勿用)
  roadStraight: 269, // 深灰路面 + 米白路肩,路宽 1.5 居中
  roadCurve: 290,    // 大半径 1/4 圆弯道(同族同宽)
  roadTee: 291,      // 丁字
  roadCross: 278,    // 十字(slab 完整)
  bridge: 233,       // 桥(路跨渠,与 215 断面逐格一致)
  canal: 215,        // 水渠直段:草-渠墙-水-渠墙-草
  canalCurve: 235,   // 水渠 90° 拐角
  canalEnd: 273,     // 水渠尽头(露水圆头)
  canalCross: 251,   // 水渠十字
  canalTee: 244,     // 水渠丁字
  shore: 252,        // 水池直岸
  shoreCorner: 272,  // 水池外角
  shoreMouth: 265,   // 水池接渠口
  openWater: 1,      // 水池内部(纯水)
  grass: 163,        // 平草地
  grassCorner: 39,   // 草坪圆角
  plateau: 36,       // 草台平顶(169 带杂散水面三角,勿用)
  slope: 152,        // 草地直坡
  slopeOuter: 12,    // 草地外凸角
  slopeInner: 37,    // 草地内凹角
  trees: [19, 20],
};

// 旋转标定:three.js rotation.y=rot·π/2 把局部 +x 转到世界 -z,方向按 E→N→W→S 循环
const STRAIGHT = { EW: 0, NS: 1 };
const CURVE_ROT = { NE: 0, NW: 1, SW: 2, SE: 3 }; // 弯道/渠角/外凸角/内凹角,键=拐角朝向
const TEE_ROT = { W: 0, S: 1, E: 2, N: 3 };       // 丁字,键=缺失的那一边
const END_ROT = { E: 0, N: 1, W: 2, S: 3 };       // 尽头,键=开口方向
const SLOPE_ROT = { E: 0, N: 1, W: 2, S: 3 };     // 直坡,键=低的那一边
const SHORE_ROT = { W: 0, S: 1, E: 2, N: 3 };     // 池岸,键=陆地/开口方向
const SHORE_CNR = { SW: 0, SE: 1, NE: 2, NW: 3 }; // 池角,键=陆地所在角
const BRIDGE_ROT = { NS: 0, EW: 1 };              // 桥,键=道路走向

const DIRS = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const ri = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)); // 闭区间

// 平滑值噪声:山体起伏必须空间连贯,逐格独立随机会把山削成迷宫
const makeNoise = (seed) => {
  const h2 = (i, j) => {
    let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  return (i, j, scale) => {
    const x = i / scale, z = j / scale;
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = fade(x - x0), fz = fade(z - z0);
    const a = h2(x0, z0), b = h2(x0 + 1, z0), c = h2(x0, z0 + 1), d = h2(x0 + 1, z0 + 1);
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  };
};

// 四邻连通掩码 → 瓦片与旋转(道路和水渠共用这套拓扑逻辑)
function tileFromMask(dirs, kit) {
  const has = (d) => dirs.includes(d);
  if (dirs.length >= 4) return { n: kit.cross, rot: 0 };
  if (dirs.length === 3) {
    const missing = ['N', 'S', 'E', 'W'].find((d) => !has(d));
    return { n: kit.tee, rot: TEE_ROT[missing] };
  }
  if (dirs.length === 2) {
    if (has('E') && has('W')) return { n: kit.straight, rot: STRAIGHT.EW };
    if (has('N') && has('S')) return { n: kit.straight, rot: STRAIGHT.NS };
    const corner = (has('N') ? 'N' : 'S') + (has('E') ? 'E' : 'W');
    return { n: kit.curve, rot: CURVE_ROT[corner] };
  }
  if (dirs.length === 1) {
    const d = dirs[0];
    if (kit.end) return { n: kit.end, rot: END_ROT[d] };
    return { n: kit.straight, rot: (d === 'E' || d === 'W') ? STRAIGHT.EW : STRAIGHT.NS };
  }
  return { n: kit.straight, rot: STRAIGHT.EW };
}

const ROAD_KIT = { straight: T.roadStraight, curve: T.roadCurve, tee: T.roadTee, cross: T.roadCross };
const CANAL_KIT = { straight: T.canal, curve: T.canalCurve, tee: T.canalTee, cross: T.canalCross, end: T.canalEnd };

export async function generateMap(builder, seed = Date.now() % 100000) {
  if (builder._genUids) for (const uid of builder._genUids) builder.remove(uid);
  builder._genUids = [];
  if (builder._genMeshes) for (const m of builder._genMeshes) { builder.world.remove(m); m.geometry.dispose(); }
  builder._genMeshes = [];

  const rng = mulberry32(seed);
  const noise = makeNoise(seed);
  const R = 18;                                 // 36×36 格 = 144m(留出大山基座的空间)
  const cells = new Map();                        // "i,j" → {n, rot, y};一格一件
  const put = (i, j, n, rot = 0, y = 0) => cells.set(`${i},${j}`, { n, rot, y });
  const at = (i, j) => cells.get(`${i},${j}`);
  const inb = (i, j) => i >= -R && i < R && j >= -R && j < R;
  const water = new Set(), road = new Set(), green = new Set();

  // ── 0) 米黄铺装打底 ─────────────────────────
  for (let i = -R; i < R; i++) for (let j = -R; j < R; j++) put(i, j, T.pave);

  // ── 1) 水渠:正交折线(两个直角弯),构图脊梁 ──
  const canalPath = [];
  const pushSeg = (fromI, fromJ, toI, toJ) => {
    const di = Math.sign(toI - fromI), dj = Math.sign(toJ - fromJ);
    let i = fromI, j = fromJ;
    while (true) {
      if (inb(i, j) && !canalPath.some((c) => c.i === i && c.j === j)) canalPath.push({ i, j });
      if (i === toI && j === toJ) break;
      i += di; j += dj;
    }
  };
  const jA = ri(rng, -R + 5, R - 7);                        // 第一段横渠所在行
  const i1 = ri(rng, -R + 7, -2);                            // 第一个弯
  const jB = Math.max(-R + 3, Math.min(R - 4, jA + (rng() < 0.5 ? -1 : 1) * ri(rng, 5, 9)));
  const i2 = ri(rng, 3, R - 6);                              // 第二个弯
  pushSeg(-R, jA, i1, jA);
  pushSeg(i1, jA, i1, jB);
  pushSeg(i1, jB, i2, jB);
  pushSeg(i2, jB, R - 1, jB);
  const canalSet = new Set(canalPath.map((c) => `${c.i},${c.j}`));

  // ── 2) 水池:挂在水渠中段,向一侧展开 ─────────
  const pondCells = new Set();
  {
    const mid = canalPath[Math.floor(canalPath.length * (0.35 + rng() * 0.3))];
    const pw = ri(rng, 3, 5), ph = ri(rng, 3, 5);
    const dirSign = rng() < 0.5 ? -1 : 1;
    const p0i = mid.i - Math.floor(pw / 2);
    const p0j = mid.j + dirSign * 2;
    const ok = (() => {
      for (let a = 0; a < pw; a++) for (let b = 0; b < ph; b++) {
        const i = p0i + a, j = (dirSign > 0 ? p0j : p0j - ph + 1) + b;
        if (!inb(i, j)) return false;
      }
      return true;
    })();
    if (ok) {
      const base = dirSign > 0 ? p0j : p0j - ph + 1;
      for (let a = 0; a < pw; a++) for (let b = 0; b < ph; b++) pondCells.add(`${p0i + a},${base + b}`);
      // 用一小段渠把池子接到主渠上
      const linkJ0 = Math.min(mid.j, base), linkJ1 = Math.max(mid.j, base);
      for (let j = linkJ0; j <= linkJ1; j++) {
        const k = `${mid.i},${j}`;
        if (!pondCells.has(k) && !canalSet.has(k) && inb(mid.i, j)) { canalPath.push({ i: mid.i, j }); canalSet.add(k); }
      }
    }
  }

  // 落地水渠(排除被池子覆盖的格)
  for (const c of canalPath) {
    const k = `${c.i},${c.j}`;
    if (pondCells.has(k)) continue;
    const dirs = Object.entries(DIRS)
      .filter(([, [di, dj]]) => {
        const nk = `${c.i + di},${c.j + dj}`;
        return canalSet.has(nk) || pondCells.has(nk);
      })
      .map(([d]) => d);
    const t = tileFromMask(dirs, CANAL_KIT);
    put(c.i, c.j, t.n, t.rot);
    water.add(k);
  }

  // 落地水池:四角 272 / 四边 252 / 内部纯水 1 / 接渠口 265
  {
    const list = [...pondCells].map((k) => k.split(',').map(Number));
    const is = list.map(([i]) => i), js = list.map(([, j]) => j);
    const i0 = Math.min(...is), i1p = Math.max(...is), j0 = Math.min(...js), j1p = Math.max(...js);
    for (const [i, j] of list) {
      const N = j === j0, Sd = j === j1p, W = i === i0, E = i === i1p;
      // 与主渠相接的边格 → 开口
      const touchCanal = Object.entries(DIRS).find(([, [di, dj]]) => canalSet.has(`${i + di},${j + dj}`) && !pondCells.has(`${i + di},${j + dj}`));
      if (touchCanal && (N || Sd || W || E)) {
        put(i, j, T.shoreMouth, SHORE_ROT[touchCanal[0]]);
      } else if (N && W) put(i, j, T.shoreCorner, SHORE_CNR.NW);
      else if (N && E) put(i, j, T.shoreCorner, SHORE_CNR.NE);
      else if (Sd && W) put(i, j, T.shoreCorner, SHORE_CNR.SW);
      else if (Sd && E) put(i, j, T.shoreCorner, SHORE_CNR.SE);
      else if (N) put(i, j, T.shore, SHORE_ROT.N);
      else if (Sd) put(i, j, T.shore, SHORE_ROT.S);
      else if (W) put(i, j, T.shore, SHORE_ROT.W);
      else if (E) put(i, j, T.shore, SHORE_ROT.E);
      else put(i, j, T.openWater, 0);
      water.add(`${i},${j}`);
    }
  }

  // ── 3) 路网:少数几条长直路,留白充足;与水渠垂直相交 ──
  // 只屏蔽水渠"长距离并行"的行/列(≥4 格连续),否则横渠会占满所有列、纵向路无处可放
  const countBy = (keyFn) => {
    const m = new Map();
    for (const c of canalPath) { const k = keyFn(c); m.set(k, (m.get(k) || 0) + 1); }
    return new Set([...m].filter(([, v]) => v >= 4).map(([k]) => k));
  };
  const canalRows = countBy((c) => c.j);
  const canalCols = countBy((c) => c.i);

  // 2.5) 预留山体基座:必须在选路之前定,否则路会把街区切碎、山堆不高
  const mounts = [];
  {
    for (let m = 0; m < MOUNT_COUNT; m++) {
      const mw = ri(rng, MOUNT_MIN, MOUNT_MAX), mh = ri(rng, MOUNT_MIN, MOUNT_MAX);
      for (let t = 0; t < 200; t++) {
        const mi = ri(rng, -R + 2, R - 2 - mw), mj = ri(rng, -R + 2, R - 2 - mh);
        let ok = true;
        for (let i = mi - 1; i <= mi + mw && ok; i++)
          for (let j = mj - 1; j <= mj + mh && ok; j++) if (water.has(`${i},${j}`)) ok = false;
        for (const o of mounts) {
          if (!ok) break;
          if (!(mi + mw < o.i - 2 || mi > o.i + o.w + 1 || mj + mh < o.j - 2 || mj > o.j + o.h + 1)) ok = false;
        }
        if (ok) { mounts.push({ i: mi, j: mj, w: mw, h: mh }); break; }
      }
    }
  }
  // 路不得穿过山体基座
  const mountRows = new Set(), mountCols = new Set();
  for (const m of mounts) {
    for (let j = m.j - 1; j <= m.j + m.h; j++) mountRows.add(j);
    for (let i = m.i - 1; i <= m.i + m.w; i++) mountCols.add(i);
  }
  const union = (a, b) => new Set([...a, ...b]);

  const pickSpaced = (lo, hi, n, gap, blocked) => {
    const out = [];
    for (let t = 0; t < 80 && out.length < n; t++) {
      const v = ri(rng, lo, hi);
      if (blocked.has(v) || blocked.has(v - 1) || blocked.has(v + 1)) continue;
      if (out.every((x) => Math.abs(x - v) >= gap)) out.push(v);
    }
    return out;
  };
  const rows = pickSpaced(-R + 3, R - 4, ri(rng, 2, 3), 8, union(canalRows, mountRows));
  const cols = pickSpaced(-R + 3, R - 4, ri(rng, 2, 3), 8, union(canalCols, mountCols));
  const roadSet = new Set();
  for (const j of rows) for (let i = -R; i < R; i++) roadSet.add(`${i},${j}`);
  for (const i of cols) for (let j = -R; j < R; j++) roadSet.add(`${i},${j}`);

  // 大半径扫弯支路:从主路"中段"垂直引出 → 直行 → 90° 转弯 → 直行,末端悬空
  // (必须从中段而非路口引出,否则拐点会有 3 个连接变成丁字,出不来弯道)
  if (rows.length) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const j0 = rows[ri(rng, 0, rows.length - 1)];
      const ci = ri(rng, -R + 4, R - 5);
      if (cols.some((c) => Math.abs(c - ci) <= 2)) continue; // 远离纵向主路,免得并成丁字
      const sgnJ = rng() < 0.5 ? -1 : 1, sgnI = rng() < 0.5 ? -1 : 1;
      const legA = ri(rng, 4, 7), legB = ri(rng, 4, 7);
      const turnJ = j0 + sgnJ * legA;
      const branch = [];
      for (let s = 1; s <= legA; s++) branch.push([ci, j0 + sgnJ * s]);          // 垂直段
      for (let s = 1; s <= legB; s++) branch.push([ci + sgnI * s, turnJ]);       // 转弯后水平段
      const clean = branch.every(([i, j]) =>
        inb(i, j) && !water.has(`${i},${j}`) && !roadSet.has(`${i},${j}`)
        && !rows.includes(j) && !cols.includes(i));
      if (!clean) continue;
      for (const [i, j] of branch) roadSet.add(`${i},${j}`);
      break;
    }
  }

  let bridges = 0;
  for (const k of roadSet) {
    const [i, j] = k.split(',').map(Number);
    if (water.has(k)) {
      // 跨渠:换成桥;跨水池则跳过(不在池上架桥)
      if (pondCells.has(k)) continue;
      const along = rows.includes(j) ? 'EW' : 'NS';
      put(i, j, T.bridge, BRIDGE_ROT[along]);
      bridges++;
      road.add(k);
      continue;
    }
    const dirs = Object.entries(DIRS)
      .filter(([, [di, dj]]) => roadSet.has(`${i + di},${j + dj}`))
      .map(([d]) => d);
    const t = tileFromMask(dirs, ROAD_KIT);
    put(i, j, t.n, t.rot);
    road.add(k);
  }

  // ── 4) 绿地:在路网切出的街区里选大块,少数几团 ──
  const blocked = (i, j) => !inb(i, j) || water.has(`${i},${j}`) || road.has(`${i},${j}`);
  // 连通分量
  const seen = new Set(), blocks = [];
  for (let i = -R; i < R; i++) for (let j = -R; j < R; j++) {
    const k0 = `${i},${j}`;
    if (seen.has(k0) || blocked(i, j)) continue;
    const comp = [], stack = [[i, j]];
    seen.add(k0);
    while (stack.length) {
      const [ci, cj] = stack.pop();
      comp.push([ci, cj]);
      for (const [di, dj] of Object.values(DIRS)) {
        const ni = ci + di, nj = cj + dj, nk = `${ni},${nj}`;
        if (!seen.has(nk) && !blocked(ni, nj)) { seen.add(nk); stack.push([ni, nj]); }
      }
    }
    blocks.push(comp);
  }
  blocks.sort((a, b) => b.length - a.length);

  // 形态学:腐蚀(用于梯田分层与消除 1 格尖刺)
  const erode = (set) => {
    const out = new Set();
    for (const k of set) {
      const [i, j] = k.split(',').map(Number);
      if (Object.values(DIRS).every(([di, dj]) => set.has(`${i + di},${j + dj}`))) out.add(k);
    }
    return out;
  };

  // 在给定格集合里找最大内接轴对齐矩形(直方图法)
  const maxRect = (set) => {
    const list = [...set].map((k) => k.split(',').map(Number));
    if (!list.length) return null;
    const i0 = Math.min(...list.map((p) => p[0])), i1 = Math.max(...list.map((p) => p[0]));
    const j0 = Math.min(...list.map((p) => p[1])), j1 = Math.max(...list.map((p) => p[1]));
    const W = i1 - i0 + 1, H = j1 - j0 + 1;
    const heights = new Array(W).fill(0);
    let best = null;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) heights[c] = set.has(`${i0 + c},${j0 + r}`) ? heights[c] + 1 : 0;
      const st = [];
      for (let c = 0; c <= W; c++) {
        const h = c === W ? 0 : heights[c];
        while (st.length && heights[st[st.length - 1]] >= h) {
          const top = st.pop();
          const left = st.length ? st[st.length - 1] + 1 : 0;
          const w = c - left, hh = heights[top];
          if (!best || w * hh > best.w * best.h) best = { i: i0 + left, j: j0 + r - hh + 1, w, h: hh };
        }
        st.push(c);
      }
    }
    return best;
  };

  const plateaus = [], lawns = [], mountStacks = [];
  // 4a) 山丘:不规则轮廓 + 腐蚀分层 + 竖直崖壁堆叠
  //     草块是纯立方体,任何形状都能堆(不像坡道瓦片有"无解格"限制),所以轮廓可以自由不规则
  for (const m of mounts) {
    // 不规则轮廓:基座内取 3~4 个互相交叠的子矩形取并集,得到有机形状
    const blob = new Set();
    const nSub = ri(rng, 3, 4);
    for (let s = 0; s < nSub; s++) {
      const sw = ri(rng, Math.ceil(m.w * 0.55), m.w), sh = ri(rng, Math.ceil(m.h * 0.55), m.h);
      const si = m.i + ri(rng, 0, m.w - sw), sj = m.j + ri(rng, 0, m.h - sh);
      for (let i = si; i < si + sw; i++) for (let j = sj; j < sj + sh; j++) {
        const k = `${i},${j}`;
        if (inb(i, j) && !water.has(k) && !road.has(k)) blob.add(k);
      }
    }
    if (blob.size < 16) continue;

    // 山脚外一圈铺平草地,让崖壁落在草面而不是直接怼在铺装上
    for (const k of blob) {
      const [i, j] = k.split(',').map(Number);
      for (const [di, dj] of Object.values(DIRS)) {
        const nk = `${i + di},${j + dj}`;
        if (blob.has(nk) || !inb(i + di, j + dj)) continue;
        if (water.has(nk) || road.has(nk) || green.has(nk)) continue;
        put(i + di, j + dj, T.grass, 0, 0); green.add(nk);
      }
    }

    // 腐蚀分层:tier = 该格能撑过几轮腐蚀 → 轮廓天然跟随不规则外形
    const tier = new Map();
    let cur = blob, level = 1;
    while (cur.size && level <= MAXTIER) {
      for (const k of cur) tier.set(k, level);
      cur = erode(cur);
      level++;
    }
    // 用平滑噪声成片削低 → 打破规整同心环,做出山脊与凹谷(逐格独立随机会变成迷宫)
    for (const k of blob) {
      const [i, j] = k.split(',').map(Number);
      const t = tier.get(k) || 1;
      if (t <= 1) continue;
      const n = noise(i, j, 4);
      if (n < 0.34) tier.set(k, Math.max(1, t - 2));
      else if (n < 0.48) tier.set(k, t - 1);
    }
    const tierAt = (i, j) => tier.get(`${i},${j}`) || 0;
    const topOf = (i, j) => (tierAt(i, j) - 1) * RISE * BLOCK_H + BLOCK_H;

    // 每格填一列草块:从"最低邻格的顶"填到自己的顶(下方被邻格挡住,不必填到地面)
    const cells = [], stacks = [];
    for (const k of blob) {
      const [i, j] = k.split(',').map(Number);
      const t = tierAt(i, j);
      const minNbr = Math.min(...Object.values(DIRS).map(([di, dj]) => tierAt(i + di, j + dj)));
      const topY = (t - 1) * RISE * BLOCK_H;                  // 最上面一块的底面
      const fromY = Math.max(0, (minNbr - 1) * RISE * BLOCK_H); // 按最低邻格算,任意层差都不会露空
      for (let y = fromY; y <= topY + 1e-6; y += BLOCK_H) stacks.push({ i, j, y });
      green.add(k); cells.push(k);
    }
    plateaus.push({ cells, topOf });
    mountStacks.push(...stacks);
  }

  // 4b) 平草坪:中等街区 1~2 个
  for (const comp of blocks.filter((c) => c.length >= 9 && c.length <= 34).slice(0, 2)) {
    const set = new Set(comp.map(([i, j]) => `${i},${j}`));
    const inner = erode(set);
    if (inner.size < 4) continue;
    const list = [...inner].map((k) => k.split(',').map(Number));
    const is = list.map(([i]) => i), js = list.map(([, j]) => j);
    const i0 = Math.min(...is), i1p = Math.max(...is), j0 = Math.min(...js), j1p = Math.max(...js);
    for (const [i, j] of list) {
      const isCorner = (i === i0 || i === i1p) && (j === j0 || j === j1p);
      put(i, j, isCorner ? T.grassCorner : T.grass, 0, 0);
      green.add(`${i},${j}`);
    }
    lawns.push(list);
  }

  // ── 5) 落地:一格一件,全部 ground 层、y 由 cells 决定 ──
  let placed = 0, skipped = 0, n = 0;
  for (const [key, { n: tn, rot, y }] of cells) {
    const [i, j] = key.split(',').map(Number);
    const rec = await builder.placeDirect(id(tn), i, j, rot, null, y);
    if (rec) { builder._genUids.push(rec.uid); placed++; } else skipped++;
    if (++n % 150 === 0) await new Promise((r) => setTimeout(r, 0)); // 让出主线程(rAF 在标签页隐藏时不触发)
  }

  // 5.5) 山体草块堆叠(每块用独立图层名,绕开"每格每层只能一件"的限制)
  for (const s of mountStacks) {
    const layer = `hill${Math.round(s.y / BLOCK_H)}`;
    const rec = await builder.placeDirect(id(T.plateau), s.i, s.j, 0, layer, s.y);
    if (rec) { builder._genUids.push(rec.uid); placed++; } else skipped++;
    if (++n % 150 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  // ── 6) 树:成簇 + 行道树 ──────────────────────
  let trees = 0;
  const adjRoad = (i, j) => Object.values(DIRS).some(([di, dj]) => road.has(`${i + di},${j + dj}`));
  const clusters = [];
  const greenList = [...green];
  for (let c = 0; c < 5 && greenList.length; c++) {
    const k = greenList[Math.floor(rng() * greenList.length)];
    const [i, j] = k.split(',').map(Number);
    clusters.push({ i, j, r: ri(rng, 2, 3) });
  }
  const inCluster = (i, j) => clusters.some((c) => Math.abs(c.i - i) + Math.abs(c.j - j) <= c.r);
  // 山体各层平台的顶面高度(山块走自定义图层,builder.groundTop 看不见,必须显式传 y)
  const mountTop = new Map();
  for (const p of plateaus) for (const k of p.cells) {
    const [i, j] = k.split(',').map(Number);
    mountTop.set(k, p.topOf(i, j));
  }
  const treeCells = new Set([...green, ...mountTop.keys()]);
  for (const k of treeCells) {
    const [i, j] = k.split(',').map(Number);
    const onMount = mountTop.has(k);
    if (!onMount) {
      const cell = at(i, j);
      if (!cell || ![T.plateau, T.grass, T.grassCorner].includes(cell.n)) continue;
    } else {
      // 山上只种在"台面"格(四邻同高),崖边不种
      const y = mountTop.get(k);
      const flat = Object.values(DIRS).every(([di, dj]) => {
        const nk = `${i + di},${j + dj}`;
        return !mountTop.has(nk) || Math.abs(mountTop.get(nk) - y) < 1e-6;
      });
      if (!flat) continue;
    }
    const p = inCluster(i, j) ? 0.55 : adjRoad(i, j) ? 0.32 : 0.12;
    if (rng() >= p) continue;
    const yOff = onMount ? mountTop.get(k) : 0;
    const rec = await builder.placeDirect(id(rand(T.trees, rng)), i, j, ri(rng, 0, 3), 'struct', yOff);
    if (rec) {
      rec.obj.scale.setScalar(0.85 + rng() * 0.35);
      builder._genUids.push(rec.uid);
      trees++;
    }
  }

  return { placed, skipped, trees, bridges, plateaus: plateaus.length, lawns: lawns.length, water: water.size, seed };
}
