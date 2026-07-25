// Extract material colors + geometry features from Kenney roadTile_*.gltf
// Usage: node tools/analyze-road-tiles.mjs
import fs from 'node:fs';
import path from 'node:path';

const DIR = '/Users/xuanjiang/Downloads/project/betagame-space/public/models/roads';
const OUT = '/private/tmp/claude-501/-Users-xuanjiang-Downloads-project-betagame-space/80609fc9-f526-49eb-8317-4241cbb1b902/scratchpad/tiles.json';
const N = 24; // top-down raster resolution

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(gltf, buf, idx) {
  const a = gltf.accessors[idx];
  const bv = gltf.bufferViews[a.bufferView];
  const TA = CT[a.componentType];
  const n = NUM[a.type];
  const elemBytes = TA.BYTES_PER_ELEMENT * n;
  const stride = bv.byteStride || elemBytes;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    const off = base + i * stride;
    const view = new TA(buf.buffer, buf.byteOffset + off, n);
    for (let c = 0; c < n; c++) out[i * n + c] = view[c];
  }
  return out;
}

function loadTile(file) {
  const gltf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const uri = gltf.buffers[0].uri;
  const buf = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
  const prims = [];
  for (const mesh of gltf.meshes) {
    for (const p of mesh.primitives) {
      prims.push({
        pos: readAccessor(gltf, buf, p.attributes.POSITION),
        idx: readAccessor(gltf, buf, p.indices),
        mat: p.material ?? 0,
      });
    }
  }
  return { gltf, prims };
}

function tri3Area(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(nx, ny, nz);
}

function analyze(file) {
  const { gltf, prims } = loadTile(file);
  const mats = gltf.materials.map((m) => {
    const c = m.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
    return {
      name: m.name,
      rgb: [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)],
      area: 0, areaXZ: 0, minY: Infinity, maxY: -Infinity,
      minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
    };
  });

  // global bbox
  let bb = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const tris = [];
  for (const pr of prims) {
    const M = mats[pr.mat];
    for (let i = 0; i < pr.idx.length; i += 3) {
      const p = [];
      for (let k = 0; k < 3; k++) {
        const v = pr.idx[i + k] * 3;
        p.push([pr.pos[v], pr.pos[v + 1], pr.pos[v + 2]]);
      }
      const a3 = tri3Area(...p[0], ...p[1], ...p[2]);
      // projected (XZ) area
      const axz = Math.abs((p[1][0] - p[0][0]) * (p[2][2] - p[0][2]) - (p[2][0] - p[0][0]) * (p[1][2] - p[0][2])) / 2;
      M.area += a3; M.areaXZ += axz;
      for (const q of p) {
        M.minX = Math.min(M.minX, q[0]); M.maxX = Math.max(M.maxX, q[0]);
        M.minY = Math.min(M.minY, q[1]); M.maxY = Math.max(M.maxY, q[1]);
        M.minZ = Math.min(M.minZ, q[2]); M.maxZ = Math.max(M.maxZ, q[2]);
        bb.minX = Math.min(bb.minX, q[0]); bb.maxX = Math.max(bb.maxX, q[0]);
        bb.minY = Math.min(bb.minY, q[1]); bb.maxY = Math.max(bb.maxY, q[1]);
        bb.minZ = Math.min(bb.minZ, q[2]); bb.maxZ = Math.max(bb.maxZ, q[2]);
      }
      tris.push({ p, m: pr.mat });
    }
  }

  const totalA = mats.reduce((s, m) => s + m.area, 0) || 1;
  mats.forEach((m) => { m.frac = m.area / totalA; });

  // ---- top-down raster: for each cell, the topmost surface's material + y ----
  const X0 = 0, X1 = 3, Z0 = -3, Z1 = 0; // Kenney tiles: x in [0,3], z in [-3,0]
  const topM = new Int16Array(N * N).fill(-1);
  const topY = new Float64Array(N * N).fill(-Infinity);
  const botY = new Float64Array(N * N).fill(Infinity);
  for (const t of tris) {
    const [A, B, C] = t.p;
    const minx = Math.min(A[0], B[0], C[0]), maxx = Math.max(A[0], B[0], C[0]);
    const minz = Math.min(A[2], B[2], C[2]), maxz = Math.max(A[2], B[2], C[2]);
    const i0 = Math.max(0, Math.floor(((minx - X0) / (X1 - X0)) * N - 1));
    const i1 = Math.min(N - 1, Math.ceil(((maxx - X0) / (X1 - X0)) * N));
    const j0 = Math.max(0, Math.floor(((minz - Z0) / (Z1 - Z0)) * N - 1));
    const j1 = Math.min(N - 1, Math.ceil(((maxz - Z0) / (Z1 - Z0)) * N));
    const d = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
    if (Math.abs(d) < 1e-12) continue; // vertical wall -> no footprint
    for (let i = i0; i <= i1; i++) {
      const px = X0 + ((i + 0.5) / N) * (X1 - X0);
      for (let j = j0; j <= j1; j++) {
        const pz = Z0 + ((j + 0.5) / N) * (Z1 - Z0);
        const l1 = ((B[2] - C[2]) * (px - C[0]) + (C[0] - B[0]) * (pz - C[2])) / d;
        const l2 = ((C[2] - A[2]) * (px - C[0]) + (A[0] - C[0]) * (pz - C[2])) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const y = l1 * A[1] + l2 * B[1] + l3 * C[1];
        const k = j * N + i;
        if (y > topY[k]) { topY[k] = y; topM[k] = t.m; }
        if (y < botY[k]) { botY[k] = y; }
      }
    }
  }

  // 3x3 coarse height cells (from raster top surface)
  const g = N / 3 | 0;
  const grid = [];
  for (let cj = 0; cj < 3; cj++) for (let ci = 0; ci < 3; ci++) {
    let mn = Infinity, mx = -Infinity, sum = 0, cnt = 0;
    for (let j = cj * g; j < (cj + 1) * g; j++) for (let i = ci * g; i < (ci + 1) * g; i++) {
      const y = topY[j * N + i];
      if (!isFinite(y)) continue;
      mn = Math.min(mn, y); mx = Math.max(mx, y); sum += y; cnt++;
    }
    grid.push({ min: cnt ? +mn.toFixed(3) : null, max: cnt ? +mx.toFixed(3) : null, avg: cnt ? +(sum / cnt).toFixed(3) : null });
  }

  // top-surface material coverage
  const topCov = new Array(mats.length).fill(0);
  let covered = 0;
  for (let k = 0; k < N * N; k++) if (topM[k] >= 0) { topCov[topM[k]]++; covered++; }
  mats.forEach((m, i) => { m.topFrac = covered ? topCov[i] / covered : 0; });

  // ---- per-edge material spans (which material touches each border, and its lateral extent) ----
  // edges: W(x=0), E(x=3), N(z=-3), S(z=0)
  const edges = {};
  const edgeDefs = [
    ['W', (i, j) => j * N + 0, (i) => i],   // vary j (z), lateral = z index
    ['E', (i, j) => j * N + (N - 1), (i) => i],
    ['N', (i, j) => 0 * N + i, (i) => i],   // j=0 -> z=-3
    ['S', (i, j) => (N - 1) * N + i, (i) => i],
  ];
  for (const [name, pick] of edgeDefs) {
    const runs = [];
    for (let t = 0; t < N; t++) {
      const k = (name === 'W') ? t * N + 0
        : (name === 'E') ? t * N + (N - 1)
          : (name === 'N') ? 0 * N + t
            : (N - 1) * N + t;
      runs.push({ m: topM[k], y: isFinite(topY[k]) ? +topY[k].toFixed(3) : null });
    }
    // per-material count + contiguous span (in tile units, N cells = 3 units)
    const per = {};
    runs.forEach((r, t) => {
      if (r.m < 0) return;
      const nm = mats[r.m].name;
      per[nm] ??= { cells: 0, tmin: 99, tmax: -1, ys: [] };
      per[nm].cells++; per[nm].tmin = Math.min(per[nm].tmin, t); per[nm].tmax = Math.max(per[nm].tmax, t);
      per[nm].ys.push(r.y);
    });
    for (const nm of Object.keys(per)) {
      const p = per[nm];
      p.width = +((p.cells / N) * 3).toFixed(3);          // total lateral coverage in units
      p.span = +(((p.tmax - p.tmin + 1) / N) * 3).toFixed(3); // contiguous extent
      p.center = +((((p.tmin + p.tmax + 1) / 2) / N) * 3).toFixed(3);
      p.yMin = +Math.min(...p.ys).toFixed(3); p.yMax = +Math.max(...p.ys).toFixed(3);
      delete p.ys;
    }
    edges[name] = per;
  }

  // ascii top-down map (row j=0 is z=-3 i.e. NORTH) + height map
  const LET = { Stone: '.', Asphalt: '#', Grass: 'g', Water: '~', Grey_Asphalt: '+', FrontColor: 'F', Alternate_Dirt: 'd', Sand: 's', White: 'W', Light_Asphalt: 'L' };
  const ascii = [];
  const asciiH = [];
  for (let j = 0; j < N; j++) {
    let row = '', rowH = '';
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      row += topM[k] < 0 ? ' ' : (LET[mats[topM[k]].name] ?? '?');
      const y = topY[k];
      rowH += !isFinite(y) ? ' ' : y < 0.001 ? '0' : String.fromCharCode(97 + Math.min(25, Math.round(y * 10)));
    }
    ascii.push(row); asciiH.push(rowH);
  }

  return {
    id: +path.basename(file).match(/(\d+)/)[1],
    file: path.basename(file),
    ascii, asciiH,
    mats: mats.map((m) => ({
      name: m.name, rgb: m.rgb,
      frac: +m.frac.toFixed(4), topFrac: +m.topFrac.toFixed(4),
      minY: +m.minY.toFixed(3), maxY: +m.maxY.toFixed(3),
      minX: +m.minX.toFixed(3), maxX: +m.maxX.toFixed(3),
      minZ: +m.minZ.toFixed(3), maxZ: +m.maxZ.toFixed(3),
    })),
    bbox: Object.fromEntries(Object.entries(bb).map(([k, v]) => [k, +v.toFixed(3)])),
    grid, edges,
    triCount: tris.length,
  };
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.gltf')).sort();
const out = files.map((f) => {
  try { return analyze(path.join(DIR, f)); }
  catch (e) { return { file: f, error: String(e) }; }
});
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('tiles:', out.length, 'errors:', out.filter((o) => o.error).length);

// global material palette
const pal = new Map();
for (const t of out) for (const m of t.mats || []) {
  const k = m.name + '|' + m.rgb.join(',');
  pal.set(k, (pal.get(k) || 0) + 1);
}
console.log('\n=== GLOBAL MATERIAL PALETTE (name | R,G,B | #tiles) ===');
[...pal.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(k.padEnd(40), v));
