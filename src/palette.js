// 调色板 UI:分类页签 + 模块缩略图(共享离屏渲染器,懒加载)
import * as THREE from 'three';
import { CATEGORIES, CATALOG, ROAD_SUBS } from './catalog.js';
import { loadPiece } from './loader.js';

export class Palette {
  constructor(onSelect) {
    this.onSelect = onSelect;
    this.tabsEl = document.getElementById('tabs');
    this.itemsEl = document.getElementById('items');
    this.selectedKind = null;
    this.thumbQueue = [];
    this.thumbBusy = false;
    this.thumbCache = new Map();

    // 离屏缩略图渲染器
    this.tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.tr.setSize(120, 120);
    this.tScene = new THREE.Scene();
    this.tCam = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    this.tScene.add(new THREE.HemisphereLight(0xffffff, 0x556, 1.15));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6);
    dl.position.set(5, 9, 6);
    this.tScene.add(dl);

    // 缩略图渲染很快(单张 ~3ms),整类一次性全渲染,避免滚动时出现空白卡片
    this.renderToken = 0;

    for (const cat of CATEGORIES) {
      const b = document.createElement('div');
      b.className = 'tab';
      b.textContent = cat.name;
      b.onclick = () => this.showCategory(cat.id);
      b.dataset.cat = cat.id;
      this.tabsEl.appendChild(b);
    }
    // 道路子分类页签
    this.subtabsEl = document.getElementById('subtabs');
    this.roadSub = 'street';
    for (const sub of ROAD_SUBS) {
      const b = document.createElement('div');
      b.className = 'tab sub';
      b.textContent = sub.name;
      b.dataset.sub = sub.id;
      b.onclick = () => { this.roadSub = sub.id; this.showCategory('road'); };
      this.subtabsEl.appendChild(b);
    }
    this.showCategory('floor');
  }

  showCategory(catId) {
    this.currentCat = catId;
    for (const t of this.tabsEl.children) t.classList.toggle('active', t.dataset.cat === catId);
    const isRoad = catId === 'road';
    this.subtabsEl.style.display = isRoad ? 'flex' : 'none';
    for (const t of this.subtabsEl.children) t.classList.toggle('active', t.dataset.sub === this.roadSub);
    this.itemsEl.classList.toggle('wide', isRoad); // 道路:单列横向大卡
    document.getElementById('palette').classList.toggle('road-mode', isRoad); // 道路:面板加宽
    this.itemsEl.innerHTML = '';
    for (const def of Object.values(CATALOG)) {
      if (def.cat !== catId) continue;
      if (def.hidden) continue; // 未精选的道路瓦片不在面板展示
      if (isRoad && def.sub !== this.roadSub) continue;
      const el = document.createElement('div');
      el.className = 'item' + (def.id === this.selectedKind ? ' selected' : '');
      el.dataset.kind = def.id;
      el.title = def.name;
      const cached = this.thumbCache.get(def.id);
      el.innerHTML = cached
        ? `<img src="${cached}" alt=""><div class="name">${def.name}</div>`
        : `<div class="ph">⬡</div><div class="name">${def.name}</div>`;
      el.onclick = () => {
        this.selectedKind = def.id === this.selectedKind ? null : def.id;
        for (const it of this.itemsEl.children) it.classList.toggle('selected', it.dataset.kind === this.selectedKind);
        this.onSelect(this.selectedKind);
      };
      this.itemsEl.appendChild(el);
    }
    this.renderAllThumbs();
  }

  markSelected(kind) {
    this.selectedKind = kind;
    for (const it of this.itemsEl.children) it.classList.toggle('selected', it.dataset.kind === kind);
  }

  // 当前分类的缩略图一次性全部渲染(单张 ~3ms,整类不到 1 秒),不再懒加载
  async renderAllThumbs() {
    const token = ++this.renderToken;
    const pending = [...this.itemsEl.children].filter((el) => !el.querySelector('img'));
    for (const el of pending) {
      if (token !== this.renderToken) return; // 已切换分类,放弃这一批
      const kind = el.dataset.kind;
      try {
        const url = await this.renderThumb(kind);
        if (el.isConnected && token === this.renderToken) {
          el.innerHTML = `<img src="${url}" alt=""><div class="name">${CATALOG[kind].name}</div>`;
        }
      } catch { /* 单个缩略图失败不影响整体 */ }
    }
  }

  async renderThumb(kind) {
    if (this.thumbCache.has(kind)) return this.thumbCache.get(kind);
    const { proto } = await loadPiece(kind);
    const obj = proto.clone(true);
    this.tScene.add(obj);
    obj.updateMatrixWorld(true); // 关键:道路瓦片带 scale,需更新世界矩阵后再算包围盒
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // 3/4 斜视角;道路瓦片(扁平)镜头拉近,填满卡片更清楚
    const r = Math.max(size.x, size.y, size.z) * 0.72 + 0.5;
    const k = kind.startsWith('road-') ? 0.82 : 1.15;
    this.tCam.position.set(center.x + r * k, center.y + r * (k - 0.1), center.z + r * k);
    this.tCam.lookAt(center);
    this.tCam.updateMatrixWorld(true);
    this.tr.render(this.tScene, this.tCam);
    const url = this.tr.domElement.toDataURL();
    this.tScene.remove(obj);
    this.thumbCache.set(kind, url);
    return url;
  }
}
