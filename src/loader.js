// 模型加载与缓存:统一把模型包成"原点在占地中心"的 Group,并记录占地格数
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CELL, CATALOG } from './catalog.js';

const gltfLoader = new GLTFLoader();
const cache = new Map(); // id → Promise<{proto, fw, fd, height}>

export function loadPiece(id) {
  if (cache.has(id)) return cache.get(id);
  const def = CATALOG[id];
  const p = gltfLoader.loadAsync(def.url).then((gltf) => {
    const src = gltf.scene;
    const scale = def.scale || 1;
    src.scale.setScalar(scale);
    src.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // 包一层 Group,把模型平移到:水平中心在原点、底面在 y=0
    const proto = new THREE.Group();
    src.position.set(-center.x, -box.min.y, -center.z);
    proto.add(src);
    proto.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    // 占地格数(墙/门为边线件,不按格算)
    const fw = Math.max(1, Math.round(size.x / CELL));
    const fd = Math.max(1, Math.round(size.z / CELL));
    return { proto, fw, fd, height: size.y };
  });
  cache.set(id, p);
  return p;
}

// 实例化一份用于放置(共享几何体与材质)
export function instantiate(proto) {
  return proto.clone(true);
}

// 生成幽灵材质版(半透明单色)用于放置预览
export function makeGhost(proto) {
  const g = proto.clone(true);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x22c55e, transparent: true, opacity: 0.55, depthWrite: false,
  });
  g.traverse((o) => {
    if (o.isMesh) {
      o.material = mat;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  g.userData.ghostMat = mat;
  return g;
}
