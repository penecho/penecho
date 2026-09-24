import * as THREE from 'three';
import type { World, Vec, Entity } from './types';
import type { Placement } from './layout';
import { fallingState, orbitalParents, orbitState, pendulumState } from '../shared/dynamics.mjs';

interface Track { e: Entity; placement: Placement; parent?: string; radius: number; start: number; floor: number; }
export class Simulation {
  group = new THREE.Group();
  tracks = new Map<string, Track>();
  lines = new Map<string, THREE.Line>();
  positions = new Map<string, Vec>();
  active = false;
  space = false;
  notes = '';
  duration = 12;
  labels: { entity: Entity; element: HTMLSpanElement; guide: SVGLineElement; offset: number }[] = [];
  private overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  constructor(private scene: THREE.Scene, private container: HTMLElement) {
    scene.add(this.group);
    this.overlay.classList.add('object-leaders');
    this.overlay.setAttribute('aria-hidden','true');
    Object.assign(this.overlay.style, { position:'absolute', inset:'0', width:'100%', height:'100%', pointerEvents:'none' });
    container.append(this.overlay);
  }
  setWorld(world: World, placements: Placement[], now: number) {
    const old = this.tracks;
    this.clearGuides(); this.tracks = new Map();
    const parents = orbitalParents(world.entities);
    this.active = world.engine === 'world' && world.entities.some(e => e.physics && e.physics.kind !== 'none');
    this.space = this.active && parents.size > 0;
    const hasDrop = world.entities.some(e => ['drop', 'bounce'].includes(e.physics?.kind || ''));
    const floor = placements.find(p => p.entity.form === 'ground');
    const floorHeight = floor ? floor.p[1] + .04 * floor.s : -.15;
    this.duration = this.space ? Math.max(12, ...world.entities.filter(e => e.physics?.kind === 'orbit').map(e => e.physics!.period)) : hasDrop ? 6 : 12;
    const pendulum = world.entities.some(e => e.physics?.kind === 'pendulum');
    this.notes = this.space ? '开普勒轨道 · 距离与周期为示意比例' : hasDrop ? '重力与地面碰撞 · 1 场景单位 = 1 m' : pendulum ? '小角度单摆 · 绳长 1.7 m' : this.active ? '绕轴旋转 · 转速为演示比例' : '';
    const kinds = [this.space && '轨道', hasDrop && '重力与碰撞', pendulum && '单摆', world.entities.some(e => e.physics?.kind === 'spin') && '自转'].filter(Boolean);
    if (kinds.length > 1) this.notes = `${kinds.join('、')} · 各对象按对应方程演示`;
    for (const placement of placements) {
      const e = placement.entity, parent = parents.get(e.id);
      if (!this.active) continue;
      const radius = parent && parents.has(parent) ? .84 : 2.55;
      const previous = [...old.values()].find(t => t.e.label === e.label);
      const stable = previous && JSON.stringify(previous.e.physics) === JSON.stringify(e.physics) && previous.e.target === e.target;
      this.tracks.set(e.id, { e, placement, parent, radius, start: stable ? previous.start : now, floor: floorHeight });
      const label = document.createElement('span'); label.className = 'object-label'; label.textContent = e.label;
      Object.assign(label.style, { position:'absolute', left:'0', top:'0', pointerEvents:'none' });
      const guide = document.createElementNS('http://www.w3.org/2000/svg','line'); guide.setAttribute('stroke','#a1aa97'); guide.setAttribute('stroke-width','1'); this.overlay.append(guide);
      this.container.append(label); this.labels.push({ entity: e, element: label, guide, offset: 0 });
      if (parent) {
        const pts = Array.from({ length: 161 }, (_, i) => { const v = orbitState(i / 160 * (e.physics?.period || 12), { radius, eccentricity: e.physics?.eccentricity, period: e.physics?.period }); return new THREE.Vector3(v.x, 0, v.z); });
        this.addLine(e.id, pts, '#abb39b');
      }
      if (['drop', 'bounce'].includes(e.physics?.kind || '')) {
        const [x, , z] = placement.p;
        this.addLine(`drop-${e.id}`, [new THREE.Vector3(x, 0, z - .12), new THREE.Vector3(x, e.physics!.height + .4, z - .12)], '#bac1ad');
        for (let i = 0; i <= e.physics!.height; i++) this.addLine(`tick-${e.id}-${i}`, [new THREE.Vector3(x - .14, i, z - .12), new THREE.Vector3(x + .14, i, z - .12)], '#b1b9a5');
        const pts = Array.from({ length: 65 }, (_, i) => new THREE.Vector3(x + Math.cos(i / 64 * Math.PI * 2) * .65, -.12, z + Math.sin(i / 64 * Math.PI * 2) * .65));
        this.addLine(`floor-${e.id}`, pts, '#aeb79f');
      }
    }
  }
  addLine(id: string, points: THREE.Vector3[], c: string) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: .7 }));
    this.group.add(line); this.lines.set(id, line);
  }
  clearGuides() {
    this.lines.forEach(line => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); line.removeFromParent(); }); this.lines.clear();
    this.labels.forEach(l => { l.element.remove(); l.guide.remove(); }); this.labels = [];
  }
  restart(now: number) { this.tracks.forEach(t => t.start = now); }
  update(time: number) {
    this.positions.clear();
    const solve = (id: string): Vec => {
      if (this.positions.has(id)) return this.positions.get(id)!;
      const track = this.tracks.get(id)!;
      const p: Vec = [...track.placement.p], ph = track.e.physics;
      const t = Math.max(0, time - track.start) * (ph?.speed || 1);
      if (track.parent) {
        const parent = solve(track.parent), state = orbitState(t, { radius: track.radius, eccentricity: ph?.eccentricity, period: ph?.period });
        p[0] = parent[0] + state.x; p[1] = parent[1]; p[2] = parent[2] + state.z;
        this.lines.get(id)?.position.set(...parent);
      } else if (ph && ['drop', 'bounce'].includes(ph.kind)) p[1] = fallingState(t, ph).height + track.floor;
      this.positions.set(id, p); return p;
    };
    for (const id of this.tracks.keys()) solve(id);
  }
  readout(time: number) {
    const drop = [...this.tracks.values()].find(t => ['drop', 'bounce'].includes(t.e.physics?.kind || ''));
    if (drop) { const ph = drop.e.physics!, s = fallingState(Math.max(0, time - drop.start) * ph.speed, ph); return `h ${s.height.toFixed(2)} m  ·  v ${s.velocity.toFixed(2)} m/s  ·  g ${ph.gravity.toFixed(2)} m/s²`; }
    const pend = [...this.tracks.values()].find(t => t.e.physics?.kind === 'pendulum');
    if (pend) { const s = pendulumState(Math.max(0, time - pend.start) * pend.e.physics!.speed, pend.e.physics!.gravity); return `θ ${(s.angle * 180 / Math.PI).toFixed(1)}°  ·  L 1.7 m  ·  T ${Number.isFinite(s.period) ? s.period.toFixed(2) + ' s' : '∞'}`; }
    if (this.space) { const orbit = [...this.tracks.values()].find(t => t.parent); const center = this.tracks.get(orbit?.parent || '')?.e.label; return `${center || '目标天体'}为参考中心 · 可拖动视角观察轨道`; }
    const spin = [...this.tracks.values()].find(t => t.e.physics?.kind === 'spin');
    return spin ? `${spin.e.label} · 匀速转动示意` : '';
  }
  project(camera: THREE.Camera, width: number, height: number) {
    this.overlay.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
    for (const label of this.labels) {
      const { entity, element, guide } = label;
      const position = this.positions.get(entity.id);
      if (!position) { element.hidden = true; continue; }
      const track = this.tracks.get(entity.id)!;
      const point = new THREE.Vector3(...position);
      point.y += this.space ? entity.form === 'sun' ? .95 : entity.form === 'satellite' ? .34 : .57 : entity.physics?.kind === 'pendulum' ? 2.85 * track.placement.s : ['drop', 'bounce'].includes(entity.physics?.kind || '') ? 1.4 * track.placement.s : .15;
      point.project(camera); element.hidden = point.z > 1 || Math.abs(point.x) > .98 || Math.abs(point.y) > .98;
      if (element.hidden) { guide.setAttribute('visibility','hidden'); continue; }
      const labelWidth = entity.label.length * (width < 700 ? 10 : 12) + 18, labelHeight = width < 700 ? 20 : 26;
      const x = Math.max(labelWidth / 2 + 8, Math.min(width - labelWidth / 2 - 8, (point.x * .5 + .5) * width));
      const baseY = Math.max(80, Math.min(height - 10, (-point.y * .5 + .5) * height));
      let y = Math.max(80,Math.min(height-10,baseY + label.offset)), rect = { left: x - labelWidth / 2, right: x + labelWidth / 2, top: y - labelHeight, bottom: y };
      for (let attempt = 1; attempt < 12 && occupied.some(r => rect.left < r.right + 6 && rect.right > r.left - 6 && rect.top < r.bottom + 6 && rect.bottom > r.top - 6); attempt++) {
        y = Math.max(80, Math.min(height - 10, baseY + (attempt % 2 ? -1 : 1) * Math.ceil(attempt / 2) * (labelHeight + 7)));
        rect = { left: x - labelWidth / 2, right: x + labelWidth / 2, top: y - labelHeight, bottom: y };
      }
      occupied.push(rect);
      label.offset = y - baseY;
      guide.setAttribute('visibility', Math.abs(label.offset) > 5 ? 'visible' : 'hidden');
      guide.setAttribute('x1',String((point.x*.5+.5)*width)); guide.setAttribute('y1',String(baseY)); guide.setAttribute('x2',String(x)); guide.setAttribute('y2',String(y - (label.offset > 0 ? labelHeight : 0)));
      element.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    }
  }
  dispose() { this.clearGuides(); this.overlay.remove(); this.group.removeFromParent(); }
}
