// 测量所有模型的包围盒,生成 manifest 供游戏做网格吸附用
import { NodeIO, getBounds } from '@gltf-transform/core';
import { readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const io = new NodeIO();
const out = { spaceKit: {}, roads: {} };

const glbDir = 'public/models';
for (const f of readdirSync(glbDir).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(join(glbDir, f));
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  out.spaceKit[f.replace('.glb', '')] = {
    min: min.map((v) => +v.toFixed(4)),
    max: max.map((v) => +v.toFixed(4)),
    size: min.map((v, i) => +(max[i] - v).toFixed(4)),
  };
}

const roadDir = 'public/models/roads';
const roadFiles = readdirSync(roadDir).filter((f) => f.endsWith('.gltf'));
for (const f of roadFiles.slice(0, 8)) {
  const doc = await io.read(join(roadDir, f));
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  out.roads[f.replace('.gltf', '')] = {
    min: min.map((v) => +v.toFixed(4)),
    max: max.map((v) => +v.toFixed(4)),
    size: min.map((v, i) => +(max[i] - v).toFixed(4)),
  };
}

writeFileSync('tools/bounds.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.spaceKit, null, 1));
