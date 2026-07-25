// 地图自动生成:对标 Kenney 样张
//   米黄铺装打底 + 深色路网(过河成桥)+ 抬升绿草丘(大比例·密树)+ 平地绿地 + 运河/池塘
import { CELL } from './catalog.js';
const id = (n) => `road-${String(n).padStart(3, '0')}`;

const T = {
  base: 64,                   // 米黄铺装(打底)
  roadEW: { n: 104, rot: 0 }, // 深色沥青直路 东西
  roadNS: { n: 104, rot: 1 }, // 深色沥青直路 南北
  curve: 112,                 // 整格宽圆角弯道(与 104 同宽;rot0=西南,rot1=南东,rot2=东北,rot3=北西)
  cross: { n: 58, rot: 0 },   // 实心路面(路口)
  grassFlat: 163,             // 平草地(铺在地面)
  plateau: 169,               // 抬升草地块 (0→1.65)
  slope: 152,                 // 草地直坡
  slopeCorner: 151,           // 草地坡角
  water: 176,                 // 开阔水面(各方向无缝相连,做连续下沉河道)
  trees: [19, 20],            // 树
};
// 河道下沉深度:水面顶(-0.24+0.6=0.36)低于米黄顶(0.84),形成 ~0.5 深、带米黄墙的连续河道
const RIVER_Y = -0.24;

const SIDE_ROT = { E: 0, N: 1, W: 2, S: 3 };
const CORNER_ROT = { NE: 0, NW: 1, SW: 2, SE: 3 };

// 蜿蜒路方向工具(+x=东, +z(=+j)=南)
const DIRS = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
const OPP = { E: 'W', W: 'E', S: 'N', N: 'S' };
const LEFT = { E: 'N', N: 'W', W: 'S', S: 'E' };
const RIGHT = { E: 'S', S: 'W', W: 'N', N: 'E' };
// 弯道两连接边 → 旋转(与 110 标定一致)
const CURVE_ROT = { 'W,S': 0, 'S,W': 0, 'S,E': 1, 'E,S': 1, 'E,N': 2, 'N,E': 2, 'N,W': 3, 'W,N': 3 };

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

export async function generateMap(builder, seed = Date.now() % 100000) {
  if (builder._genUids) for (const uid of builder._genUids) builder.remove(uid);
  builder._genUids = [];
  const rng = mulberry32(seed);

  const R = 15;
  const cells = new Map(); // "i,j" → {n, rot, y}
  const put = (i, j, n, rot = 0, y = 0) => cells.set(`${i},${j}`, { n, rot, y });
  const at = (i, j) => cells.get(`${i},${j}`);
  const inb = (i, j) => i >= -R && i < R && j >= -R && j < R;

  const river = new Set(), road = new Set(), grass = new Set();

  // 1) 米黄铺装打底
  for (let i = -R; i < R; i++) for (let j = -R; j < R; j++) put(i, j, T.base);

  // 2) 河道:连续下沉水面(全用 176,各方向无缝相连);2 格宽主河 + 支流 + 水池
  const setWater = (i, j) => { if (!inb(i, j)) return; put(i, j, T.water, 0, RIVER_Y); river.add(`${i},${j}`); };
  const jr = -R + 5 + Math.floor(rng() * 4);      // 东西主河(1 格宽)
  for (let i = -R; i < R; i++) setWater(i, jr);
  const ib = -R + 9 + Math.floor(rng() * (R - 2)); // 南北支流(1 格宽)
  for (let j = jr + 1; j < R; j++) setWater(ib, j);
  // 汇合处扩成 3×3 水池
  const pj = jr + 4 + Math.floor(rng() * 3);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) setWater(ib + a, pj + b);

  // 3) 蜿蜒主干道(1~2 条),随机游走 + 拐弯;过河的格成桥
  let bridges = 0;
  const roadCells = new Map(); // "i,j" → {n, rot}(先收集,最后落到 cells,便于弯道去重)
  const straightTile = (dir) => ({ n: 104, rot: (dir === 'E' || dir === 'W') ? 0 : 1 });
  const curveTile = (entry, exit) => ({ n: T.curve, rot: CURVE_ROT[`${entry},${exit}`] ?? 0 });
  function walkRoad(si, sj, dir) {
    let i = si, j = sj, d = dir, steps = 0;
    const maxSteps = R * 3;
    while (inb(i, j) && steps < maxSteps) {
      const entry = OPP[d];
      // 决定出向:多数直行,约 28% 拐弯
      let exit = d;
      if (steps > 1 && rng() < 0.28) exit = rng() < 0.5 ? LEFT[d] : RIGHT[d];
      const tile = entry === OPP[exit] ? straightTile(exit) : curveTile(entry, exit);
      roadCells.set(`${i},${j}`, tile);
      d = exit;
      i += DIRS[d][0]; j += DIRS[d][1];
      steps++;
    }
  }
  // 起点在边界上,朝内走
  const edges = [
    { si: -R, sj: -R + 4 + Math.floor(rng() * (R)), dir: 'E' },
    { si: -R + 5 + Math.floor(rng() * R), sj: -R, dir: 'S' },
  ];
  const roadCount = 1 + Math.floor(rng() * 2);
  for (let k = 0; k < roadCount; k++) { const e = edges[k % edges.length]; walkRoad(e.si, e.sj, e.dir); }
  // 道路叠在米黄底/运河之上(不替换底,弯道镂空处露出铺装;过河=桥)
  for (const [key] of roadCells) { if (river.has(key)) bridges++; road.add(key); }

  const free = (i, j) => inb(i, j) && !river.has(`${i},${j}`) && !road.has(`${i},${j}`) && !grass.has(`${i},${j}`);
  const freeRect = (ci, cj, w, d) => {
    for (let i = ci; i < ci + w; i++) for (let j = cj; j < cj + d; j++) if (!free(i, j)) return false;
    return true;
  };

  // 4) 抬升绿草丘:多层梯田(对标示范图,每层升高 1.65,内缩成台阶)
  const TIER = 1.65, STEP = 2; // 每层高度;每层向内缩 STEP 格
  // 在矩形 [x0,x0+ww)×[z0,z0+dd) 边界铺朝外的草坡(y 为该层底高)
  const ringSlopes = (x0, z0, ww, dd, y) => {
    for (let i = x0; i < x0 + ww; i++) {
      for (let j = z0; j < z0 + dd; j++) {
        if (i > x0 && i < x0 + ww - 1 && j > z0 && j < z0 + dd - 1) continue; // 只铺边
        const N = j === z0, S = j === z0 + dd - 1, W = i === x0, E = i === x0 + ww - 1;
        grass.add(`${i},${j}`);
        if (N && W) put(i, j, T.slopeCorner, CORNER_ROT.NW, y);
        else if (N && E) put(i, j, T.slopeCorner, CORNER_ROT.NE, y);
        else if (S && W) put(i, j, T.slopeCorner, CORNER_ROT.SW, y);
        else if (S && E) put(i, j, T.slopeCorner, CORNER_ROT.SE, y);
        else if (N) put(i, j, T.slope, SIDE_ROT.N, y);
        else if (S) put(i, j, T.slope, SIDE_ROT.S, y);
        else if (W) put(i, j, T.slope, SIDE_ROT.W, y);
        else if (E) put(i, j, T.slope, SIDE_ROT.E, y);
      }
    }
  };
  const plateaus = [];
  const hillCount = 4 + Math.floor(rng() * 3);
  for (let h = 0; h < hillCount; h++) {
    const w = 6 + Math.floor(rng() * 4), d = 6 + Math.floor(rng() * 4);
    let ci, cj, tries = 0, ok = false;
    while (tries++ < 160 && !ok) {
      ci = Math.floor(rng() * (R * 2 - w)) - R;
      cj = Math.floor(rng() * (R * 2 - d)) - R;
      ok = freeRect(ci, cj, w, d);
    }
    if (!ok) continue;
    const levels = 2 + (Math.min(w, d) >= 9 ? 1 : 0); // 大丘 3 层,否则 2 层
    // 逐层:先把该层矩形内部整体铺成该层顶面的高台,再把边铺成朝外的坡;内层覆盖外层内部
    for (let L = 0; L < levels; L++) {
      const x0 = ci + L * STEP, z0 = cj + L * STEP;
      const ww = w - 2 * L * STEP, dd = d - 2 * L * STEP;
      if (ww < 2 || dd < 2) break;
      const y = L * TIER;
      for (let i = x0; i < x0 + ww; i++) for (let j = z0; j < z0 + dd; j++) { put(i, j, T.plateau, 0, y); grass.add(`${i},${j}`); }
      ringSlopes(x0, z0, ww, dd, y);
    }
    // 记录最内层平台范围(种树用)
    const topL = Math.min(levels, Math.floor((Math.min(w, d) - 2) / (2 * STEP)) + 1) - 1;
    const tw = w - 2 * topL * STEP, td = d - 2 * topL * STEP;
    plateaus.push({ ci: ci + topL * STEP + 1, cj: cj + topL * STEP + 1, w: Math.max(0, tw - 2), d: Math.max(0, td - 2), full: { ci, cj, w, d } });
  }

  // 5) 平地绿地:3~5 片平草地铺在地面(不抬升),也种树
  const flats = [];
  const flatCount = 3 + Math.floor(rng() * 3);
  for (let f = 0; f < flatCount; f++) {
    const w = 3 + Math.floor(rng() * 3), d = 3 + Math.floor(rng() * 3);
    let ci, cj, tries = 0, ok = false;
    while (tries++ < 80 && !ok) {
      ci = Math.floor(rng() * (R * 2 - w)) - R;
      cj = Math.floor(rng() * (R * 2 - d)) - R;
      ok = freeRect(ci, cj, w, d);
    }
    if (!ok) continue;
    flats.push({ ci, cj, w, d });
    for (let i = ci; i < ci + w; i++) for (let j = cj; j < cj + d; j++) { put(i, j, T.grassFlat); grass.add(`${i},${j}`); }
  }

  // 6) 放置:先铺底(米黄/运河/草),再把道路叠在其上(struct 层)
  let placed = 0, skipped = 0;
  for (const [key, { n, rot, y }] of cells) {
    const [i, j] = key.split(',').map(Number);
    const rec = await builder.placeDirect(id(n), i, j, rot, null, y);
    if (rec) { builder._genUids.push(rec.uid); placed++; } else skipped++;
  }
  for (const [key, tile] of roadCells) {
    const [i, j] = key.split(',').map(Number);
    // 独立 'road' 层,路面顶(0.06+0.80=0.86)略高于铺装顶(0.84),可见且近乎齐平
    const rec = await builder.placeDirect(id(tile.n), i, j, tile.rot, 'road', 0.06);
    if (rec) { builder._genUids.push(rec.uid); placed++; }
  }

  // 7) 树:草丘顶密植 + 平草地零散
  let trees = 0;
  const treeAt = async (i, j) => {
    const rec = await builder.placeDirect(id(rand(T.trees, rng)), i, j, Math.floor(rng() * 4), 'struct');
    if (rec) { builder._genUids.push(rec.uid); trees++; }
  };
  // 草丘:只在平台(flat)格上种树(斜坡上不种),各层都种
  for (const p of plateaus) {
    const f = p.full;
    for (let i = f.ci; i < f.ci + f.w; i++)
      for (let j = f.cj; j < f.cj + f.d; j++)
        if (at(i, j)?.n === T.plateau && rng() < 0.6) await treeAt(i, j);
  }
  for (const { ci, cj, w, d } of flats)
    for (let i = ci; i < ci + w; i++)
      for (let j = cj; j < cj + d; j++)
        if (rng() < 0.4) await treeAt(i, j);

  return { placed, skipped, trees, plateaus: plateaus.length, flats: flats.length, bridges, seed };
}
