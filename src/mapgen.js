// 地图自动生成:对标 Kenney 样张
//   米黄铺装打底 + 深色路网(过河成桥)+ 抬升绿草丘(大比例·密树)+ 平地绿地 + 运河/池塘
import { CELL } from './catalog.js';
const id = (n) => `road-${String(n).padStart(3, '0')}`;

const T = {
  base: 64,                   // 米黄铺装(打底)
  roadEW: { n: 104, rot: 0 }, // 整格宽直路 东西(路口干净)
  roadNS: { n: 104, rot: 1 }, // 整格宽直路 南北
  curve: 112,                 // 整格宽圆角弯道(与 104 同宽;rot0=西南,rot1=南东,rot2=东北,rot3=北西)
  cross: { n: 58, rot: 0 },   // 实心路面(路口)
  grassFlat: 163,             // 平草地(铺在地面)
  plateau: 169,               // 抬升草地块 (0→1.65)
  slope: 152,                 // 草地直坡
  slopeCorner: 151,           // 草地坡角
  channelEW: { n: 216, rot: 0 }, // 东西下沉渠(米黄墙+白色路缘+蓝水)
  channelNS: { n: 216, rot: 1 }, // 南北下沉渠
  pool: 207,                     // 下沉水池(四面墙,汇合/湖泊用)
  lakeCorner: 272,               // 湖泊白框角
  trees: [19, 20],               // 树
};
// 下沉深度:渠墙顶(2.2)沉到与米黄面齐平(0.84)→ y = 0.84 - 2.2
const SINK = 0.84 - 2.2;

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
  // 清理上次生成的河道水面 mesh
  if (builder._genMeshes) for (const m of builder._genMeshes) { builder.world.remove(m); m.geometry.dispose(); }
  builder._genMeshes = [];
  const rng = mulberry32(seed);

  const R = 15;
  const cells = new Map(); // "i,j" → {n, rot, y}
  const put = (i, j, n, rot = 0, y = 0) => cells.set(`${i},${j}`, { n, rot, y });
  const at = (i, j) => cells.get(`${i},${j}`);
  const inb = (i, j) => i >= -R && i < R && j >= -R && j < R;

  const river = new Set(), road = new Set(), grass = new Set();

  // 1) 米黄铺装打底
  for (let i = -R; i < R; i++) for (let j = -R; j < R; j++) put(i, j, T.base);

  // 2) 河道:自带米黄墙+白色路缘+蓝水的下沉渠瓦片,放到负 y 直接陷进地里
  const setWater = (i, j, tile) => { if (!inb(i, j)) return; put(i, j, tile.n, tile.rot, SINK); river.add(`${i},${j}`); };
  const jr = -R + 5 + Math.floor(rng() * 4);      // 东西主河
  for (let i = -R; i < R; i++) setWater(i, jr, T.channelEW);
  const ib = -R + 9 + Math.floor(rng() * (R - 2)); // 南北支流
  for (let j = jr + 1; j < R; j++) setWater(ib, j, T.channelNS);
  // 汇合处 + 湖泊:3×3 下沉水池(207 basin)
  const pj = jr + 4 + Math.floor(rng() * 3);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) setWater(ib + a, pj + b, { n: T.pool, rot: 0 });

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
  // 多条主干道,起点分布在四条边、朝内走(道路更密)
  const roadCount = 4 + Math.floor(rng() * 3); // 4~6 条
  for (let k = 0; k < roadCount; k++) {
    const side = k % 4;
    let si, sj, dir;
    if (side === 0) { si = -R; sj = -R + 3 + Math.floor(rng() * (R * 2 - 6)); dir = 'E'; }
    else if (side === 1) { si = R - 1; sj = -R + 3 + Math.floor(rng() * (R * 2 - 6)); dir = 'W'; }
    else if (side === 2) { si = -R + 3 + Math.floor(rng() * (R * 2 - 6)); sj = -R; dir = 'S'; }
    else { si = -R + 3 + Math.floor(rng() * (R * 2 - 6)); sj = R - 1; dir = 'N'; }
    walkRoad(si, sj, dir);
  }
  // 道路叠在米黄底/运河之上(不替换底,弯道镂空处露出铺装;过河=桥)
  for (const [key] of roadCells) { if (river.has(key)) bridges++; road.add(key); }

  const free = (i, j) => inb(i, j) && !river.has(`${i},${j}`) && !road.has(`${i},${j}`) && !grass.has(`${i},${j}`);
  const freeRect = (ci, cj, w, d) => {
    for (let i = ci; i < ci + w; i++) for (let j = cj; j < cj + d; j++) if (!free(i, j)) return false;
    return true;
  };

  // 4) 抬升绿草丘:不规则轮廓 + 多层梯田(基于腐蚀层级,每层升高 1.65)
  const TIER = 1.65, STEP = 2, MAXTIER = 3;
  const plateaus = [];
  const hillCount = 4 + Math.floor(rng() * 3);
  for (let h = 0; h < hillCount; h++) {
    const big = h < 2; // 前 2 座做大山(可达 3 层)
    const bw = (big ? 10 : 5) + Math.floor(rng() * (big ? 3 : 4));
    const bd = (big ? 10 : 5) + Math.floor(rng() * (big ? 3 : 4));
    let bi, bj, tries = 0, ok = false;
    while (tries++ < 160 && !ok) {
      bi = Math.floor(rng() * (R * 2 - bw)) - R;
      bj = Math.floor(rng() * (R * 2 - bd)) - R;
      ok = freeRect(bi - 1, bj - 1, bw + 2, bd + 2); // 主矩形四周留 1 格空
    }
    if (!ok) continue;
    // 不规则轮廓:主矩形 + 1~2 个交叠附加块(制造 L/凸起),只取 free 且相连的格
    const cellsSet = new Set();
    const addRect = (x0, z0, w, d) => {
      for (let i = x0; i < x0 + w; i++) for (let j = z0; j < z0 + d; j++) if (free(i, j)) cellsSet.add(`${i},${j}`);
    };
    addRect(bi, bj, bw, bd);
    for (let p = 0, pn = 1 + Math.floor(rng() * 2); p < pn; p++) {
      const pw = 3 + Math.floor(rng() * 3), pd = 3 + Math.floor(rng() * 3);
      addRect(bi + Math.floor(rng() * bw) - 1, bj + Math.floor(rng() * bd) - 1, pw, pd);
    }
    const hillCells = [...cellsSet];
    if (hillCells.length < 8) continue;
    const inHill = (k) => cellsSet.has(k);
    for (const k of hillCells) grass.add(k);
    // 腐蚀求 rawLevel(到边界的层数)
    const raw = new Map();
    let cur = new Set(hillCells), L = 1;
    while (cur.size) {
      for (const k of cur) raw.set(k, L);
      const next = new Set();
      for (const k of cur) {
        const [i, j] = k.split(',').map(Number);
        if (cur.has(`${i + 1},${j}`) && cur.has(`${i - 1},${j}`) && cur.has(`${i},${j + 1}`) && cur.has(`${i},${j - 1}`)) next.add(k);
      }
      cur = next; L++;
    }
    const tierOf = (k) => (inHill(k) ? Math.min(MAXTIER, Math.floor((raw.get(k) - 1) / STEP) + 1) : 0);
    for (const k of hillCells) {
      const [i, j] = k.split(',').map(Number);
      const Tc = tierOf(k), y = (Tc - 1) * TIER;
      const lo = { E: tierOf(`${i + 1},${j}`) < Tc, W: tierOf(`${i - 1},${j}`) < Tc, S: tierOf(`${i},${j + 1}`) < Tc, N: tierOf(`${i},${j - 1}`) < Tc };
      const dirs = ['E', 'W', 'S', 'N'].filter((d) => lo[d]);
      if (dirs.length === 0) put(i, j, T.plateau, 0, y);
      else if (dirs.length === 1) put(i, j, T.slope, SIDE_ROT[dirs[0]], y);
      else if (dirs.length === 2 && lo.N && lo.E) put(i, j, T.slopeCorner, CORNER_ROT.NE, y);
      else if (dirs.length === 2 && lo.N && lo.W) put(i, j, T.slopeCorner, CORNER_ROT.NW, y);
      else if (dirs.length === 2 && lo.S && lo.W) put(i, j, T.slopeCorner, CORNER_ROT.SW, y);
      else if (dirs.length === 2 && lo.S && lo.E) put(i, j, T.slopeCorner, CORNER_ROT.SE, y);
      else put(i, j, T.slope, SIDE_ROT[dirs[0]], y); // 相对两向/尖角:用坡
    }
    plateaus.push({ cells: hillCells });
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
  for (const p of plateaus)
    for (const k of p.cells) {
      const [i, j] = k.split(',').map(Number);
      if (at(i, j)?.n === T.plateau && rng() < 0.6) await treeAt(i, j);
    }
  for (const { ci, cj, w, d } of flats)
    for (let i = ci; i < ci + w; i++)
      for (let j = cj; j < cj + d; j++)
        if (rng() < 0.4) await treeAt(i, j);

  return { placed, skipped, trees, plateaus: plateaus.length, flats: flats.length, bridges, seed };
}
