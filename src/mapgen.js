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
const TIER_STEP = 1.10 * S;  // 1.4667    梯田层高 = 坡道跨越的高差(0.55→1.65),不是块高

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
  const R = 15;                                   // 30×30 格 = 120m
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
  const pickSpaced = (lo, hi, n, gap, blocked) => {
    const out = [];
    for (let t = 0; t < 80 && out.length < n; t++) {
      const v = ri(rng, lo, hi);
      if (blocked.has(v) || blocked.has(v - 1) || blocked.has(v + 1)) continue;
      if (out.every((x) => Math.abs(x - v) >= gap)) out.push(v);
    }
    return out;
  };
  const rows = pickSpaced(-R + 3, R - 4, ri(rng, 2, 3), 8, canalRows);
  const cols = pickSpaced(-R + 3, R - 4, ri(rng, 2, 3), 8, canalCols);
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
  const dilate = (set, within) => {
    const out = new Set(set);
    for (const k of set) {
      const [i, j] = k.split(',').map(Number);
      for (const [di, dj] of Object.values(DIRS)) {
        const nk = `${i + di},${j + dj}`;
        if (within.has(nk)) out.add(nk);
      }
    }
    return out;
  };

  const plateaus = [], lawns = [];
  // 4a) 大草丘(多层梯田):最大的 1~2 个街区
  for (const comp of blocks.filter((c) => c.length >= 40).slice(0, 2)) {
    const full = new Set(comp.map(([i, j]) => `${i},${j}`));
    const inner = erode(full);                      // 内缩 1 格,留出米黄人行带
    if (inner.size < 12) continue;
    const S1 = dilate(erode(inner), inner);         // 开运算:消除 1 格尖刺/细颈,否则坡道对不上
    if (S1.size < 12) continue;
    const apron = new Set([...S1].filter((k) => {   // 最外一圈铺平草地当围裙,让坡脚落在草面
      const [i, j] = k.split(',').map(Number);
      return !Object.values(DIRS).every(([di, dj]) => S1.has(`${i + di},${j + dj}`));
    }));
    for (const k of apron) { const [i, j] = k.split(',').map(Number); put(i, j, T.grass, 0, 0); green.add(k); }
    const core = new Set([...S1].filter((k) => !apron.has(k)));
    if (!core.size) continue;

    // 逐层腐蚀求 tier(每 3 圈升一层:2 格平台 + 1 格坡)
    const tier = new Map();
    let cur = core, level = 1;
    while (cur.size && level <= 3) {
      for (const k of cur) tier.set(k, level);
      cur = erode(erode(erode(cur)));
      level++;
    }
    for (const k of core) {
      const [i, j] = k.split(',').map(Number);
      const t = tier.get(k) || 1;
      const y = (t - 1) * TIER_STEP;
      const low = Object.entries(DIRS)
        .filter(([, [di, dj]]) => (tier.get(`${i + di},${j + dj}`) || 0) < t)
        .map(([d]) => d);
      let tile;
      if (low.length === 0) {
        // 检查对角是否更低 → 内凹角
        const diag = [['N', 'E', 'NE'], ['N', 'W', 'NW'], ['S', 'E', 'SE'], ['S', 'W', 'SW']]
          .find(([a, b, name]) => {
            const [ai, aj] = DIRS[a], [bi, bj] = DIRS[b];
            return (tier.get(`${i + ai + bi},${j + aj + bj}`) || 0) < t;
          });
        tile = diag ? { n: T.slopeInner, rot: CURVE_ROT[diag[2]] } : { n: T.plateau, rot: 0 };
      } else if (low.length === 1) {
        tile = { n: T.slope, rot: SLOPE_ROT[low[0]] };
      } else if (low.length === 2 && !((low.includes('N') && low.includes('S')) || (low.includes('E') && low.includes('W')))) {
        const corner = (low.includes('N') ? 'N' : 'S') + (low.includes('E') ? 'E' : 'W');
        tile = { n: T.slopeOuter, rot: CURVE_ROT[corner] };
      } else {
        tile = { n: T.grass, rot: 0 }; // 对向/尖角无对应瓦片 → 退回平草地
      }
      put(i, j, tile.n, tile.rot, tile.n === T.grass ? 0 : y);
      green.add(k);
    }
    plateaus.push({ cells: [...core], tier });
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
  for (const k of green) {
    const [i, j] = k.split(',').map(Number);
    const cell = at(i, j);
    // 只在平面上种树(平台/平草地),斜坡上不种
    if (!cell || ![T.plateau, T.grass, T.grassCorner].includes(cell.n)) continue;
    const p = inCluster(i, j) ? 0.55 : adjRoad(i, j) ? 0.32 : 0.07;
    if (rng() >= p) continue;
    const rec = await builder.placeDirect(id(rand(T.trees, rng)), i, j, ri(rng, 0, 3), 'struct');
    if (rec) {
      rec.obj.scale.setScalar(0.85 + rng() * 0.35);
      builder._genUids.push(rec.uid);
      trees++;
    }
  }

  return { placed, skipped, trees, bridges, plateaus: plateaus.length, lawns: lawns.length, water: water.size, seed };
}
