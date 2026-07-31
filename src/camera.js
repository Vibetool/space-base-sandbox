// 上帝视角摄像机:WASD/中键平移、滚轮缩放、右键拖拽旋转、Q/E 旋转
import * as THREE from 'three';

export class GodCamera {
  constructor(dom) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 800);
    this.target = new THREE.Vector3(0, 0, 0);
    this.dist = 60;
    this.azimuth = Math.PI / 4;
    this.polar = 0.95; // 俯仰(0=正上方)
    this.keys = new Set();
    this.dom = dom;

    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = THREE.MathUtils.clamp(this.dist * (e.deltaY > 0 ? 1.12 : 0.89), 12, 220);
    }, { passive: false });

    // 触屏:单指拖 = 旋转,双指捏合 = 缩放、双指移动 = 平移(与鼠标分支互不干扰)
    this.touches = new Map(); // pointerId → {x,y},只收录从画布按下的手指
    this.pinch = null;
    let drag = null;
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size === 1) drag = { mode: 'rot', x: e.clientX, y: e.clientY, moved: 0 };
        else { drag = null; this.pinch = null; } // 第二指落下 → 交给双指手势
        return;
      }
      if (e.button === 2) drag = { mode: 'rot', x: e.clientX, y: e.clientY, moved: 0 };
      else if (e.button === 1) { e.preventDefault(); drag = { mode: 'pan', x: e.clientX, y: e.clientY, moved: 0 }; }
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (!this.touches.has(e.pointerId)) return; // 手指不是从画布按下的(在 UI 面板上)
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size >= 2) {
          const [a, b] = [...this.touches.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (this.pinch) {
            this.dist = THREE.MathUtils.clamp(this.dist * (this.pinch.dist / Math.max(dist, 1)), 12, 220);
            this.panBy(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
          }
          this.pinch = { dist, mid };
          return;
        }
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.mode === 'rot') {
        this.azimuth -= dx * 0.005;
        this.polar = THREE.MathUtils.clamp(this.polar - dy * 0.004, 0.15, 1.35);
      } else {
        this.panBy(dx, dy);
      }
    });
    // pointercancel 必须与 pointerup 同路清理:浏览器接管手势时只发 cancel,不清会"粘住"
    const endPointer = (e) => {
      if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
        this.touches.delete(e.pointerId);
        this.pinch = null;
        if (this.touches.size >= 1) {
          // 双指抬起一指:剩余手指无缝接管单指旋转
          const [p] = [...this.touches.values()];
          drag = { mode: 'rot', x: p.x, y: p.y, moved: drag ? drag.moved : 99 };
          return;
        }
      }
      if (drag) this.lastDragMoved = drag.moved;
      drag = null;
    };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  panBy(dx, dy) {
    const s = this.dist * 0.0016;
    const fwd = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    this.target.addScaledVector(right, -dx * s).addScaledVector(fwd, -dy * s);
    this.clampTarget();
  }

  clampTarget() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, -100, 100);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -100, 100);
  }

  update(dt) {
    const sp = this.dist * 0.9 * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.target.addScaledVector(fwd, sp);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.target.addScaledVector(fwd, -sp);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.target.addScaledVector(right, -sp);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.target.addScaledVector(right, sp);
    if (this.keys.has('KeyQ')) this.azimuth += dt * 1.6;
    if (this.keys.has('KeyE')) this.azimuth -= dt * 1.6;
    this.clampTarget();

    const y = Math.cos(this.polar) * this.dist;
    const r = Math.sin(this.polar) * this.dist;
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * r,
      this.target.y + y,
      this.target.z + Math.cos(this.azimuth) * r,
    );
    this.camera.lookAt(this.target);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
