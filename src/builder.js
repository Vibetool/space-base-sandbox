// 建造系统:网格吸附、边线吸附、门磁吸/替换墙、堆叠、占用校验、序列化
import * as THREE from 'three';
import { CELL, CATALOG } from './catalog.js';
import { loadPiece, instantiate, makeGhost } from './loader.js';

const COLOR_OK = 0x22c55e;      // 可放置:绿
const COLOR_BAD = 0xef4444;     // 冲突:红
const COLOR_SNAP = 0x0ea5e9;    // 门吸附到建筑边:蓝
const COLOR_REPLACE = 0x10b981; // 门替换墙:翠绿
const MAX_STACK_Y = 26;         // 堆叠高度上限(米)
const EPS = 0.05;

export class Builder {
  constructor(scene) {
    this.scene = scene;
    this.world = new THREE.Group(); // 所有已放置物体
    scene.add(this.world);
    this.occ = new Map();     // 占用键 → 记录数组(支持堆叠)
    this.records = new Map(); // uid → 放置记录
    this.nextUid = 1;

    this.selected = null; // {def, proto, fw, fd, height}
    this.ghost = null;
    this.rot = 0;         // 0..3
    this.plan = null;     // 当前吸附结果(可 place)
  }

  // ── 选择 ──────────────────────────────
  async select(kind) {
    this.clearGhost();
    if (!kind) { this.selected = null; return; }
    const def = CATALOG[kind];
    const { proto, fw, fd, height } = await loadPiece(kind);
    if (this.pendingKind !== undefined && this.pendingKind !== kind) return;
    this.selected = { def, proto, fw, fd, height };
    this.ghost = makeGhost(proto);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  clearGhost() {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    this.plan = null;
  }

  rotate() { this.rot = (this.rot + 1) % 4; }

  // ── 键值/堆栈工具 ─────────────────────
  cellKey(i, j, layer) { return `C:${i},${j}:${layer}`; }
  edgeKey(o, i, j) { return `${o}:${i},${j}`; }

  stack(key) { return this.occ.get(key) || []; }
  stackTop(key) {
    const arr = this.occ.get(key);
    if (!arr || !arr.length) return 0;
    return Math.max(...arr.map((r) => r.topY));
  }
  topRec(key) {
    const arr = this.occ.get(key);
    if (!arr || !arr.length) return null;
    return arr.reduce((a, b) => (a.topY >= b.topY ? a : b));
  }
  hasAt(key, y) { return this.stack(key).some((r) => Math.abs(r.baseY - y) < EPS); }

  footprint() {
    const { fw, fd } = this.selected;
    return this.rot % 2 === 0 ? [fw, fd] : [fd, fw];
  }

  // 某格是否有建筑体(用于门的磁吸判定)
  cellBuilt(i, j) {
    return this.stack(this.cellKey(i, j, 'struct')).length > 0
      || this.stack(this.cellKey(i, j, 'ground')).length > 0;
  }

  // 某格地面件(草地/道路)顶面高度
  groundTop(i, j) { return this.stackTop(this.cellKey(i, j, 'ground')); }

  // 边中点坐标
  edgeMid(o, i, j) {
    return o === 'H'
      ? new THREE.Vector3((i + 0.5) * CELL, 0, j * CELL)
      : new THREE.Vector3(i * CELL, 0, (j + 0.5) * CELL);
  }

  // ── 吸附计算 ──────────────────────────
  updateHover(p) {
    if (!this.selected || !this.ghost) return null;
    const t = this.selected.def.type;
    let plan = null;
    if (t === 'cell') plan = this.planCell(p);
    else if (t === 'edge') plan = this.planEdge(p);
    else if (t === 'door') plan = this.planDoor(p);
    else if (t === 'vertex') plan = this.planVertex(p);
    this.plan = plan;

    if (!plan) { this.ghost.visible = false; return null; }
    this.ghost.visible = true;
    this.ghost.position.copy(plan.pos);
    this.ghost.rotation.y = plan.ry;
    this.ghost.userData.ghostMat.color.setHex(
      !plan.valid ? COLOR_BAD : plan.replace ? COLOR_REPLACE : plan.snapped ? COLOR_SNAP : COLOR_OK,
    );
    return plan;
  }

  planCell(p) {
    const [w, d] = this.footprint();
    const i0 = Math.round(p.x / CELL - w / 2);
    const j0 = Math.round(p.z / CELL - d / 2);
    const layer = this.selected.def.layer;

    // 堆叠:取覆盖范围内(结构层 + 地面件)最高顶面,建筑坐在地表上
    let baseY = 0;
    let groundEmpty = true;
    for (let a = 0; a < w; a++) {
      for (let b = 0; b < d; b++) {
        baseY = Math.max(baseY, this.stackTop(this.cellKey(i0 + a, j0 + b, 'struct')));
        if (layer !== 'ground') baseY = Math.max(baseY, this.groundTop(i0 + a, j0 + b));
        if (this.stack(this.cellKey(i0 + a, j0 + b, 'ground')).length) groundEmpty = false;
      }
    }
    const useLayer = layer === 'ground' && groundEmpty && baseY < EPS ? 'ground' : 'struct';
    if (useLayer === 'struct' && layer === 'ground') {
      // 地板铺在已有地形/建筑之上
      for (let a = 0; a < w; a++) {
        for (let b = 0; b < d; b++) baseY = Math.max(baseY, this.groundTop(i0 + a, j0 + b));
      }
    }
    const keys = [];
    let valid = baseY < MAX_STACK_Y;
    for (let a = 0; a < w; a++) {
      for (let b = 0; b < d; b++) {
        const k = this.cellKey(i0 + a, j0 + b, useLayer);
        keys.push(k);
        if (this.hasAt(k, baseY)) valid = false;
      }
    }
    return {
      type: 'cell', valid, keys, i0, j0, baseY,
      stacked: baseY > EPS,
      pos: new THREE.Vector3((i0 + w / 2) * CELL, baseY, (j0 + d / 2) * CELL),
      ry: this.rot * Math.PI / 2,
    };
  }

  // 找鼠标最近的边(墙用)
  nearestEdge(p) {
    const hi = Math.floor(p.x / CELL), hj = Math.round(p.z / CELL);
    const vi = Math.round(p.x / CELL), vj = Math.floor(p.z / CELL);
    const hMid = this.edgeMid('H', hi, hj), vMid = this.edgeMid('V', vi, vj);
    const dh = Math.abs(p.z - hMid.z), dv = Math.abs(p.x - vMid.x);
    return dh <= dv ? { o: 'H', i: hi, j: hj, dist: dh } : { o: 'V', i: vi, j: vj, dist: dv };
  }

  // 边线基准高度:已有墙堆栈顶 或 相邻地面件顶面
  edgeBaseY(o, i, j) {
    const key = this.edgeKey(o, i, j);
    const adj = o === 'H' ? [[i, j - 1], [i, j]] : [[i - 1, j], [i, j]];
    return Math.max(this.stackTop(key), ...adj.map(([a, b]) => this.groundTop(a, b)));
  }

  planEdge(p) {
    const e = this.nearestEdge(p);
    const key = this.edgeKey(e.o, e.i, e.j);
    const mid = this.edgeMid(e.o, e.i, e.j);
    const baseY = this.edgeBaseY(e.o, e.i, e.j); // 墙可叠墙,也坐在地表上
    // 墙体模型:x 向展开、实体在 z∈[-1,0]。根据鼠标在边哪一侧决定墙体朝向
    let ry;
    if (e.o === 'H') ry = p.z > mid.z ? Math.PI : 0;
    else ry = p.x > mid.x ? -Math.PI / 2 : Math.PI / 2;
    return {
      type: 'edge', valid: baseY < MAX_STACK_Y && !this.hasAt(key, baseY), keys: [key],
      edge: e, baseY, stacked: baseY > EPS,
      pos: new THREE.Vector3(mid.x, baseY, mid.z), ry,
    };
  }

  // 门:磁吸附近的建筑边缘;若边上已有墙 → 替换(取堆栈最上层)
  planDoor(p) {
    const ci = Math.floor(p.x / CELL), cj = Math.floor(p.z / CELL);
    let best = null;
    for (let i = ci - 2; i <= ci + 2; i++) {
      for (let j = cj - 2; j <= cj + 2; j++) {
        for (const o of ['H', 'V']) {
          const mid = this.edgeMid(o, i, j);
          const dist = Math.hypot(p.x - mid.x, p.z - mid.z);
          if (dist > CELL * 2.2) continue;
          const key = this.edgeKey(o, i, j);
          const top = this.topRec(key);
          const isWall = top && CATALOG[top.kind].type === 'edge';
          const isDoor = top && CATALOG[top.kind].type === 'door';
          const adjBuilt = o === 'H'
            ? this.cellBuilt(i, j) || this.cellBuilt(i, j - 1)
            : this.cellBuilt(i, j) || this.cellBuilt(i - 1, j);
          let score = -dist;
          if (isWall) score += 100;        // 优先替换墙
          else if (adjBuilt) score += 50;  // 其次吸附建筑轮廓
          if (isDoor) score = -Infinity;   // 已有门:不可选
          if (!best || score > best.score) best = { o, i, j, dist, key, top, isWall, adjBuilt, score };
        }
      }
    }
    if (!best) return null;
    const mid = this.edgeMid(best.o, best.i, best.j);
    const baseY = best.isWall ? best.top.baseY : this.edgeBaseY(best.o, best.i, best.j);
    return {
      type: 'door', valid: best.score > -Infinity, keys: [best.key],
      replace: best.isWall, snapped: best.adjBuilt, baseY,
      replaceUid: best.isWall ? best.top.uid : null,
      edge: best, pos: new THREE.Vector3(mid.x, baseY, mid.z),
      ry: best.o === 'H' ? 0 : Math.PI / 2,
    };
  }

  planVertex(p) {
    const i = Math.round(p.x / CELL), j = Math.round(p.z / CELL);
    const key = `P:${i},${j}`;
    const baseY = Math.max(this.stackTop(key),
      this.groundTop(i - 1, j - 1), this.groundTop(i, j - 1),
      this.groundTop(i - 1, j), this.groundTop(i, j));
    return {
      type: 'vertex', valid: baseY < MAX_STACK_Y && !this.hasAt(key, baseY), keys: [key], baseY,
      pos: new THREE.Vector3(i * CELL, baseY, j * CELL),
      ry: this.rot * Math.PI / 2,
    };
  }

  // ── 放置 / 拆除 ───────────────────────
  place() {
    const plan = this.plan;
    if (!plan || !plan.valid || !this.selected) return null;
    if (plan.replace && plan.replaceUid) this.remove(plan.replaceUid); // 门替换墙
    const uid = this.nextUid++;
    const obj = instantiate(this.selected.proto);
    obj.position.copy(plan.pos);
    obj.rotation.y = plan.ry;
    obj.userData.uid = uid;
    this.world.add(obj);
    const baseY = plan.baseY || 0;
    const rec = {
      uid, kind: this.selected.def.id, keys: [...plan.keys],
      pos: plan.pos.toArray(), ry: plan.ry, obj,
      baseY, topY: baseY + this.selected.height,
      doorOpen: false, doorNode: null,
    };
    this.attachDoor(rec);
    for (const k of plan.keys) {
      if (!this.occ.has(k)) this.occ.set(k, []);
      this.occ.get(k).push(rec);
    }
    this.records.set(uid, rec);
    return rec;
  }

  // 供地图生成器直接放置(占用即跳过);yOff 为竖直偏移(下沉河道用负值);返回记录或 null
  async placeDirect(kind, i0, j0, rot = 0, layerOverride = null, yOff = 0) {
    const def = CATALOG[kind];
    if (!def) return null;
    const { proto, fw, fd, height } = await loadPiece(kind);
    const [w, d] = rot % 2 === 0 ? [fw, fd] : [fd, fw];
    const layer = layerOverride || def.layer;
    const keys = [];
    for (let a = 0; a < w; a++) {
      for (let b = 0; b < d; b++) {
        const k = this.cellKey(i0 + a, j0 + b, layer);
        if (this.stack(k).length) return null; // 已占用:跳过
        keys.push(k);
      }
    }
    // 结构件(如树木)坐在地面件顶上
    let baseY = yOff;
    if (layer === 'struct') {
      for (let a = 0; a < w; a++) {
        for (let b = 0; b < d; b++) baseY = Math.max(baseY, this.groundTop(i0 + a, j0 + b));
      }
    }
    const uid = this.nextUid++;
    const obj = instantiate(proto);
    obj.position.set((i0 + w / 2) * CELL, baseY, (j0 + d / 2) * CELL);
    obj.rotation.y = rot * Math.PI / 2;
    obj.userData.uid = uid;
    this.world.add(obj);
    const rec = {
      uid, kind, keys, pos: obj.position.toArray(), ry: obj.rotation.y, obj,
      baseY, topY: baseY + height, doorOpen: false, doorNode: null,
    };
    for (const k of keys) {
      if (!this.occ.has(k)) this.occ.set(k, []);
      this.occ.get(k).push(rec);
    }
    this.records.set(uid, rec);
    return rec;
  }

  attachDoor(rec) {
    if (!CATALOG[rec.kind].animDoor) return;
    rec.obj.traverse((o) => { if (o.name === 'door' && !rec.doorNode) rec.doorNode = o; });
    if (rec.doorNode) rec.doorBaseY = rec.doorNode.position.y;
  }

  remove(uid) {
    const rec = this.records.get(uid);
    if (!rec) return false;
    this.world.remove(rec.obj);
    for (const k of rec.keys) {
      const arr = this.occ.get(k);
      if (arr) {
        const idx = arr.indexOf(rec);
        if (idx >= 0) arr.splice(idx, 1);
        if (!arr.length) this.occ.delete(k);
      }
    }
    this.records.delete(uid);
    return true;
  }

  // 从射线命中的对象向上找 uid
  uidFromObject(o) {
    while (o) {
      if (o.userData && o.userData.uid) return o.userData.uid;
      o = o.parent;
    }
    return null;
  }

  clearAll() {
    for (const uid of [...this.records.keys()]) this.remove(uid);
  }

  // ── 门动画 ────────────────────────────
  toggleDoor(uid) {
    const rec = this.records.get(uid);
    if (!rec || !rec.doorNode) return false;
    rec.doorOpen = !rec.doorOpen;
    return true;
  }

  update(dt) {
    // 滑动门开关动画(向上滑入门框);返回"是否有门在动",供渲染层决定要不要重画阴影
    let moving = false;
    for (const rec of this.records.values()) {
      if (!rec.doorNode) continue;
      const target = rec.doorBaseY + (rec.doorOpen ? 3.4 : 0);
      const y = rec.doorNode.position.y;
      if (Math.abs(target - y) > 0.002) {
        rec.doorNode.position.y = THREE.MathUtils.damp(y, target, 8, dt);
        moving = true;
      }
    }
    return moving;
  }

  // ── 序列化 ────────────────────────────
  serialize() {
    return JSON.stringify({
      v: 2,
      items: [...this.records.values()].map((r) => ({
        kind: r.kind, keys: r.keys, pos: r.pos, ry: r.ry,
        baseY: r.baseY, topY: r.topY, doorOpen: r.doorOpen,
      })),
    });
  }

  async deserialize(json) {
    const data = JSON.parse(json);
    this.clearAll();
    for (const it of data.items) {
      if (!CATALOG[it.kind]) continue;
      const { proto, height } = await loadPiece(it.kind);
      const uid = this.nextUid++;
      const obj = instantiate(proto);
      obj.position.fromArray(it.pos);
      obj.rotation.y = it.ry;
      obj.userData.uid = uid;
      this.world.add(obj);
      const rec = {
        uid, kind: it.kind, keys: it.keys, pos: it.pos, ry: it.ry, obj,
        baseY: it.baseY || 0, topY: it.topY ?? ((it.baseY || 0) + height),
        doorOpen: !!it.doorOpen, doorNode: null,
      };
      this.attachDoor(rec);
      if (rec.doorNode && rec.doorOpen) rec.doorNode.position.y += 3.4;
      for (const k of it.keys) {
        if (!this.occ.has(k)) this.occ.set(k, []);
        this.occ.get(k).push(rec);
      }
      this.records.set(uid, rec);
    }
  }
}
