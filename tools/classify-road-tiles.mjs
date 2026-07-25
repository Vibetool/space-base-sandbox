import fs from 'node:fs';
const OUT = '/private/tmp/claude-501/-Users-xuanjiang-Downloads-project-betagame-space/80609fc9-f526-49eb-8317-4241cbb1b902/scratchpad/tiles.json';
const T = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const m = (t, n) => t.mats.find((x) => x.name === n);
const has = (t, n) => !!m(t, n);
const frac = (t, n) => m(t, n)?.frac ?? 0;
const topFrac = (t, n) => m(t, n)?.topFrac ?? 0;
const sig = (t) => t.mats.map((x) => x.name).sort().join('+');

const mode = process.argv[2] || 'groups';

if (mode === 'groups') {
  const g = new Map();
  for (const t of T) { const s = sig(t); (g.get(s) ?? g.set(s, []).get(s)).push(t.id); }
  [...g.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([s, ids]) => {
    console.log(`\n[${ids.length}] ${s}`);
    console.log('  ' + ids.join(','));
  });
}

if (mode === 'dump') {
  const ids = process.argv.slice(3).map(Number);
  for (const t of T.filter((x) => ids.includes(x.id))) {
    console.log(`\n=== ${t.id} bbox y[${t.bbox.minY},${t.bbox.maxY}] x[${t.bbox.minX},${t.bbox.maxX}] z[${t.bbox.minZ},${t.bbox.maxZ}] tris=${t.triCount}`);
    t.mats.forEach((x) => console.log(`   ${x.name.padEnd(16)} rgb(${x.rgb}) frac=${x.frac} top=${x.topFrac} y[${x.minY},${x.maxY}]`));
    console.log('   grid avg: ' + [0, 1, 2].map((r) => t.grid.slice(r * 3, r * 3 + 3).map((c) => String(c.avg).padStart(6)).join(' ')).join(' | '));
    for (const [e, per] of Object.entries(t.edges)) {
      const s = Object.entries(per).map(([n, p]) => `${n}:w${p.width}/span${p.span}@c${p.center} y[${p.yMin},${p.yMax}]`).join('  ');
      if (s) console.log(`   ${e}: ${s}`);
    }
  }
}

if (mode === 'map') {
  // side-by-side ascii maps, 4 per row
  const ids = process.argv.slice(3).map(Number);
  const sel = T.filter((x) => ids.includes(x.id));
  const showH = process.env.H === '1';
  for (let i = 0; i < sel.length; i += 4) {
    const chunk = sel.slice(i, i + 4);
    console.log('\n' + chunk.map((t) => `#${t.id} h${(t.bbox.maxY - t.bbox.minY).toFixed(2)} y${t.bbox.maxY}`.padEnd(27)).join(' '));
    console.log(chunk.map((t) => t.mats.map((x) => (x.name[0] === 'G' && x.name[1] === 'r' && x.name[2] === 'e' ? '+' : { Stone: '.', Asphalt: '#', Grass: 'g', Water: '~', FrontColor: 'F', Alternate_Dirt: 'd', Sand: 's', White: 'W', Light_Asphalt: 'L' }[x.name] ?? '?') + x.name.slice(0, 5)).join(' ').padEnd(27)).join(' '));
    for (let r = 0; r < 24; r++) console.log(chunk.map((t) => (showH ? t.asciiH : t.ascii)[r].padEnd(27)).join(' '));
  }
}

if (mode === 'conn') {
  // connectivity signature for a given material letter, restricted to flat tiles
  const want = process.argv[3] || 'Asphalt';
  const flatOnly = process.env.FLAT !== '0';
  for (const t of T) {
    if (!has(t, want)) continue;
    const h = t.bbox.maxY - t.bbox.minY;
    if (flatOnly && Math.abs(h - 0.63) > 0.02) continue;
    const e = ['N', 'E', 'S', 'W'].map((k) => {
      const p = t.edges[k]?.[want];
      return p ? `${k}${p.span}@${p.center}` : '';
    }).filter(Boolean);
    console.log(`${String(t.id).padStart(3)} tris=${String(t.triCount).padStart(4)} top=${topFrac(t, want).toFixed(2)} mats=${t.mats.map((x) => x.name).join('/')} :: ${e.join(' ') || 'NONE'}`);
  }
}

if (mode === 'edge') {
  // exact per-cell edge profile (material letter + height) for given tiles
  const ids = process.argv.slice(3).map(Number);
  const LET = { Stone: '.', Asphalt: '#', Grass: 'g', Water: '~', Grey_Asphalt: '+', FrontColor: 'F', Alternate_Dirt: 'd', Sand: 's', White: 'W', Light_Asphalt: 'L' };
  for (const t of T.filter((x) => ids.includes(x.id))) {
    const col = (c) => t.ascii.map((r) => r[c]).join('');
    const colH = (c) => t.asciiH.map((r) => r[c]).join('');
    console.log(`#${t.id}`);
    console.log('  N mat ' + t.ascii[0] + '\n  N hgt ' + t.asciiH[0]);
    console.log('  S mat ' + t.ascii[23] + '\n  S hgt ' + t.asciiH[23]);
    console.log('  W mat ' + col(0) + '\n  W hgt ' + colH(0));
    console.log('  E mat ' + col(23) + '\n  E hgt ' + colH(23));
  }
}

if (mode === 'props') {
  // tiles whose footprint is much smaller than the full 3x3 tile => props (trees etc)
  for (const t of T) {
    const w = t.bbox.maxX - t.bbox.minX, d = t.bbox.maxZ - t.bbox.minZ, h = t.bbox.maxY - t.bbox.minY;
    if (w > 2.5 && d > 2.5) continue;
    console.log(`${String(t.id).padStart(3)} w=${w.toFixed(2)} d=${d.toFixed(2)} h=${h.toFixed(2)} ratio=${(h / Math.max(w, d)).toFixed(2)} mats=${t.mats.map((x) => `${x.name}(${x.rgb})f${x.frac.toFixed(2)}y${x.minY}..${x.maxY}`).join(' ')}`);
  }
}

if (mode === 'flat') {
  // pure-Stone flat pavement
  const r = T.filter((t) => t.mats.length === 1 && t.mats[0].name === 'Stone' && t.bbox.maxY - t.bbox.minY < 0.05);
  console.log('pure stone flat:', r.map((t) => `${t.id}(y${t.bbox.maxY})`).join(' '));
  const r2 = T.filter((t) => t.mats.length === 1 && t.mats[0].name === 'Stone');
  console.log('\npure stone all:', r2.map((t) => `${t.id}(h${(t.bbox.maxY - t.bbox.minY).toFixed(2)})`).join(' '));
  const g = T.filter((t) => t.mats.length === 1 && t.mats[0].name === 'Grass');
  console.log('\npure grass:', g.map((t) => `${t.id}(h${(t.bbox.maxY - t.bbox.minY).toFixed(2)},y${t.bbox.maxY})`).join(' '));
}

if (mode === 'road') {
  // Stone+Asphalt only, flat
  const r = T.filter((t) => has(t, 'Asphalt') && has(t, 'Stone') && t.mats.length === 2);
  console.log('Stone+Asphalt tiles:', r.length);
  for (const t of r) {
    const eSummary = ['W', 'E', 'N', 'S'].map((e) => {
      const p = t.edges[e]?.Asphalt;
      return p ? `${e}:${p.span}@${p.center}` : `${e}:-`;
    }).join(' ');
    console.log(`${String(t.id).padStart(3)} h=${(t.bbox.maxY - t.bbox.minY).toFixed(2)} aFrac=${frac(t, 'Asphalt').toFixed(2)} topA=${topFrac(t, 'Asphalt').toFixed(2)} | ${eSummary}`);
  }
}

if (mode === 'water') {
  const r = T.filter((t) => has(t, 'Water'));
  console.log('Water tiles:', r.length);
  for (const t of r) {
    const w = m(t, 'Water');
    const others = t.mats.filter((x) => x.name !== 'Water').map((x) => `${x.name}(f${x.frac.toFixed(2)},y${x.minY}..${x.maxY})`).join(' ');
    console.log(`${String(t.id).padStart(3)} bboxY[${t.bbox.minY},${t.bbox.maxY}] waterY=${w.maxY} wFrac=${w.frac.toFixed(2)} topW=${w.topFrac.toFixed(2)} | ${others}`);
    const es = ['W', 'E', 'N', 'S'].map((e) => {
      const p = t.edges[e];
      return `${e}[` + Object.entries(p).map(([n, v]) => `${n[0]}${v.span}@${v.center}y${v.yMax}`).join(',') + ']';
    }).join(' ');
    console.log('     ' + es);
  }
}

if (mode === 'grass') {
  const r = T.filter((t) => has(t, 'Grass') && frac(t, 'Grass') > 0.5);
  console.log('Grass-dominant:', r.length);
  for (const t of r) {
    const gr = t.grid.map((c) => c.avg);
    console.log(`${String(t.id).padStart(3)} h=${(t.bbox.maxY - t.bbox.minY).toFixed(2)} gFrac=${frac(t, 'Grass').toFixed(2)} mats=${t.mats.map((x) => x.name).join('/')} grid=${gr.join(',')}`);
  }
}

if (mode === 'tall') {
  const r = T.filter((t) => (t.bbox.maxY - t.bbox.minY) > 1.5).sort((a, b) => (b.bbox.maxY - b.bbox.minY) - (a.bbox.maxY - a.bbox.minY));
  for (const t of r) console.log(`${String(t.id).padStart(3)} h=${(t.bbox.maxY - t.bbox.minY).toFixed(2)} mats=${t.mats.map((x) => x.name + ':' + x.frac.toFixed(2)).join('/')}`);
}
