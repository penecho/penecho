import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildForm, type Part, type Shape } from './forms';
import { layoutWorld, type Placement } from './layout';
import type { Entity, World } from './types';
import { compileSculpture, deformPoint } from '../shared/sculpture.mjs';
import { buildBlueprint, buildCelestial } from './blueprints';
import { Simulation } from './simulation';

const WIDTH = 24, HEIGHT = 18;
const color = new THREE.Color();
const vec = new THREE.Vector3();
const easing = (dt: number, rate = 6) => 1 - Math.exp(-dt * rate);

function shapedPositions(shape: Shape, deformation?: Part) {
  const g = new THREE.SphereGeometry(1, WIDTH, HEIGHT);
  const p = g.attributes.position as THREE.BufferAttribute;
  const curve = deformation?.path ? new THREE.CatmullRomCurve3(deformation.path.map(v => new THREE.Vector3(...v))) : undefined;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (shape === 'sweep' && curve) {
      const uv = g.attributes.uv, v = uv.getY(i), a = uv.getX(i) * Math.PI * 2;
      const center = curve.getPoint(v), tangent = curve.getTangent(v).normalize();
      const axis = Math.abs(tangent.y) > .95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const normal = new THREE.Vector3().crossVectors(tangent, axis).normalize(), binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
      const radius = THREE.MathUtils.lerp(deformation?.radius || .1, deformation?.endRadius ?? deformation?.radius ?? .1, v) * Math.min(1, Math.sin(Math.PI * v) * 18);
      center.addScaledVector(normal, Math.cos(a) * radius).addScaledVector(binormal, Math.sin(a) * radius);
      x = center.x; y = center.y; z = center.z;
    } else if (shape === 'cone') {
      const angle = Math.atan2(z, x);
      const v = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
      const yy = v < .84 ? 1 - v / .84 * 2 : -1;
      const radius = v < .84 ? (1 - yy) / 2 : (1 - v) / .16;
      x = Math.cos(angle) * radius; z = Math.sin(angle) * radius; y = yy;
    } else if (shape === 'box') {
      const squish = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), .25);
      x = squish(x); y = squish(y); z = squish(z);
    } else if (shape === 'cylinder') {
      const angle = Math.atan2(z, x), radius = Math.pow(Math.max(0, 1 - y * y), .12);
      x = Math.cos(angle) * radius; z = Math.sin(angle) * radius;
    } else if (shape === 'river') {
      const uv = g.attributes.uv, v = uv.getY(i), a = uv.getX(i) * Math.PI * 2;
      z = (v - .5) * 2;
      const radius = Math.pow(Math.max(0, Math.sin(v * Math.PI)), .2);
      x = Math.sin(z * 2.6) * .24 + Math.cos(a) * .18 * radius;
      y = Math.sin(a) * .035 * radius;
    } else if (shape === 'ring') {
      const uv = g.attributes.uv;
      const a = uv.getX(i) * Math.PI * 2, b = uv.getY(i) * Math.PI * 2;
      x = (.7 + .3 * Math.cos(b)) * Math.cos(a); y = (.7 + .3 * Math.cos(b)) * Math.sin(a); z = .3 * Math.sin(b);
    } else if (shape === 'tube') {
      const uv = g.attributes.uv, a = uv.getX(i) * Math.PI * 2, t = uv.getY(i);
      let radius: number;
      if (t < .4) { radius = 1; y = -1 + t / .4 * 2; }
      else if (t < .5) { radius = 1 - (t - .4) / .1 * .25; y = 1; }
      else if (t < .9) { radius = .75; y = 1 - (t - .5) / .4 * 2; }
      else { radius = .75 + (t - .9) / .1 * .25; y = -1; }
      x = Math.cos(a) * radius; z = Math.sin(a) * radius;
    } else if (shape === 'bowl') {
      const uv = g.attributes.uv, a = uv.getX(i) * Math.PI * 2, t = uv.getY(i);
      const inner = t > .5, theta = (inner ? 1 - t : t) * Math.PI;
      const radius = Math.sin(theta) * (inner ? .8 : 1);
      x = Math.cos(a) * radius; z = Math.sin(a) * radius;
      y = -Math.cos(theta) * (inner ? .8 : 1) + .5;
    } else if (shape === 'sheet') {
      const uv = g.attributes.uv; x = uv.getX(i) * 2 - 1; z = uv.getY(i) * 2 - 1; y = .15 * (x * x + z * z);
    } else if (shape === 'coil') {
      const uv = g.attributes.uv, a = uv.getY(i) * Math.PI * 6, b = uv.getX(i) * Math.PI * 2;
      x = (.7 + .13 * Math.cos(b)) * Math.cos(a); z = (.7 + .13 * Math.cos(b)) * Math.sin(a); y = uv.getY(i) * 2 - 1 + .13 * Math.sin(b);
    }
    if (deformation) [x, y, z] = deformPoint(x, y, z, deformation);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}
const geometries = Object.fromEntries(['sphere', 'cone', 'box', 'cylinder', 'ring', 'river', 'tube', 'bowl', 'sheet', 'coil'].map((s) => [s, shapedPositions(s as Shape)]));

class ClayPart {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  definition: Part | undefined;
  targetGeometry: THREE.BufferGeometry = geometries.sphere;
  changing = 0;
  geometryKey = '';
  customGeometry?: THREE.BufferGeometry;
  constructor(group: THREE.Group) {
    const material = new THREE.MeshStandardMaterial({ color: '#bba891', roughness: .83, metalness: 0, side: THREE.DoubleSide });
    // A low-amplitude procedural surface normal keeps the matte clay tactile.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nfloat grain = sin(vViewPosition.x * 190.0) * sin(vViewPosition.y * 173.0) * sin(vViewPosition.z * 167.0);\nnormal = normalize(normal + vec3(grain * 0.009));`);
    };
    this.mesh = new THREE.Mesh(geometries.sphere.clone(), material);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.scale.setScalar(.001); group.add(this.mesh);
  }
  set(def?: Part) {
    this.definition = def;
    // A muzzle sits partly over the head; its own shadow map creates a dark
    // seam above the mouth. It still casts onto the ground with the figure.
    this.mesh.receiveShadow = def?.role !== 'muzzle';
    const key = [def?.shape, def?.bend, def?.taper, def?.twist, JSON.stringify(def?.path), def?.radius, def?.endRadius].join(':');
    if (key === this.geometryKey) return;
    this.geometryKey = key; this.customGeometry?.dispose(); this.customGeometry = undefined;
    if (def && (def.bend || def.taper || def.twist || def.path)) this.customGeometry = shapedPositions(def.shape || 'sphere', def);
    this.targetGeometry = this.customGeometry || geometries[def?.shape || 'sphere']; this.changing = 1;
  }
  update(dt: number, t: number, entity?: Entity, index = 0) {
    const d = this.definition;
    const k = easing(dt, 7);
    vec.set(...(d?.s || [.001, .001, .001]));
    if (!entity?.sculpture && d?.role === 'eye') {
      const blink = entity?.motion === 'sleep' ? .15 : Math.sin(t * 1.15 + .3) > .997 ? .15 : 1;
      vec.y *= blink;
    }
    this.mesh.scale.lerp(vec, k);
    vec.set(...(d?.p || [0, .7, 0]));
    if (!entity?.sculpture && entity?.motion === 'eat' && (d?.role === 'head' || d?.role === 'eye')) { vec.y -= .09 + Math.sin(t * 7) * .04; vec.z += .08; }
    if (d?.role === 'drop') vec.y = (vec.y - t * (entity?.form === 'rain' ? 1.8 : .45)) % 2.6 + 2.6;
    if (d?.role === 'tail') vec.x += Math.sin(t * 2 + index * .5) * .045;
    if (d?.role === 'leg' && ['run', 'dance'].includes(entity?.motion || '')) vec.z += Math.sin(t * 7 + index * 2) * .16;
    if (d?.role === 'ripple') { vec.z += Math.sin(t * 1.5 + index) * .16; vec.x += Math.cos(t * 1.5 + index) * .025; }
    if (entity?.physics?.kind === 'pendulum') this.mesh.position.copy(vec); else this.mesh.position.lerp(vec, k);
    const r = d?.r || [0, 0, 0];
    let rz = r[2];
    if (d?.role === 'wing') rz += Math.sin(t * (entity?.motion === 'fly' ? 8 : 2)) * (entity?.motion === 'fly' ? .65 : .08) * Math.sign(d.p[0] || 1);
    if (d?.role === 'arm' && entity?.motion === 'wave') rz += .9 + Math.sin(t * 5) * .35;
    this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, r[0], k);
    this.mesh.rotation.y = THREE.MathUtils.lerp(this.mesh.rotation.y, r[1], k);
    this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, rz, k);
    if (d) this.mesh.material.color.lerp(color.set(d.c), k);
    this.mesh.visible = this.mesh.scale.length() > .007;
    if (this.changing > .001) {
      const current = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const target = this.targetGeometry.attributes.position as THREE.BufferAttribute;
      const ca = current.array as Float32Array, ta = target.array as Float32Array;
      for (let i = 0; i < ca.length; i++) ca[i] += (ta[i] - ca[i]) * k;
      current.needsUpdate = true; this.mesh.geometry.computeVertexNormals(); this.changing *= 1 - k;
    }
  }
  dispose() { this.mesh.removeFromParent(); this.customGeometry?.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

class ClayObject {
  group = new THREE.Group();
  parts: ClayPart[] = [];
  placement?: Placement;
  dead = false;
  phase = Math.random() * 5;
  animationTick = -1;
  constructor(scene: THREE.Scene) { scene.add(this.group); this.group.scale.setScalar(.001); }
  set(placement?: Placement) {
    this.placement = placement; this.dead = !placement;
    const nodes = placement?.entity.sculpture?.nodes;
    const e = placement?.entity;
    const celestial = e && (['planet', 'satellite'].includes(e.form) || e.form === 'sun' && e.celestial);
    let defs = nodes ? compileSculpture(nodes).parts as Part[] : e?.blueprint ? buildBlueprint(e) : e ? celestial ? buildCelestial(e) : buildForm(e) : [];
    if (e?.form === 'ground' && e.physics) defs = defs.slice(0, 1);
    // Stable part identities let additions grow without remapping old parts.
    if (nodes || e?.blueprint || celestial) {
      const previous = this.parts;
      const used = new Set<ClayPart>();
      this.parts = defs.map((def) => {
        const part = previous.find((p) => p.definition?.id === def.id) || new ClayPart(this.group);
        if (!part.definition) part.mesh.position.set(...def.p);
        used.add(part); return part;
      });
      previous.filter((p) => !used.has(p)).forEach((p) => { p.set(undefined); this.parts.push(p); });
    }
    while (this.parts.length < defs.length) this.parts.push(new ClayPart(this.group));
    this.parts.forEach((part, i) => part.set(defs[i]));
  }
  update(dt: number, t: number, physicalPosition?: number[], localTime = t) {
    const p = this.placement;
    let scale = p?.s ?? .001;
    vec.set(...(p?.p || [0, .5, 0]));
    let rx = 0, ry = 0, rz = 0;
    if (p) {
      if (p.entity.sculpture?.nodes.some((n) => n.motion !== 'still')) {
        const defs = compileSculpture(p.entity.sculpture.nodes, t).parts as Part[];
        this.parts.forEach((part) => { const def = defs.find((d) => d.id === part.definition?.id); if (def) part.definition = def; });
      }
      const motion = p.entity.motion;
      if (p.entity.blueprint && ['pendulum', 'mechanism', 'radial'].includes(p.entity.blueprint.family) && this.animationTick !== Math.floor(localTime * 30)) {
        this.animationTick = Math.floor(localTime * 30);
        const defs = buildBlueprint(p.entity, localTime);
        this.parts.forEach((part, i) => {
          const def = defs[i];
          // Dynamic paths update existing GPU attributes; never allocate geometry
          // in the render loop. Rigid rotations and positions are direct targets.
          if (def?.path && part.definition?.path && JSON.stringify(def.path) !== JSON.stringify(part.definition.path)) {
            const curve = new THREE.CatmullRomCurve3(def.path.map(v => new THREE.Vector3(...v)));
            const current = part.mesh.geometry.attributes.position as THREE.BufferAttribute, uv = part.mesh.geometry.attributes.uv;
            const normal = new THREE.Vector3(), binormal = new THREE.Vector3(), axis = new THREE.Vector3();
            for (let j = 0; j < current.count; j++) {
              const v = uv.getY(j), a = uv.getX(j) * Math.PI * 2, center = curve.getPoint(v), tangent = curve.getTangent(v);
              axis.set(0, Math.abs(tangent.y) > .95 ? 0 : 1, Math.abs(tangent.y) > .95 ? 1 : 0); normal.crossVectors(tangent, axis).normalize(); binormal.crossVectors(tangent, normal).normalize();
              const radius = THREE.MathUtils.lerp(def.radius || .1, def.endRadius ?? def.radius ?? .1, v) * Math.min(1, Math.sin(Math.PI * v) * 18);
              center.addScaledVector(normal, Math.cos(a) * radius).addScaledVector(binormal, Math.sin(a) * radius); current.setXYZ(j, center.x, center.y, center.z);
            }
            current.needsUpdate = true; part.mesh.geometry.computeVertexNormals(); part.changing = 0;
          }
          if (def) part.definition = def;
        });
      }
      const physics = p.entity.physics?.kind;
      if (physicalPosition) vec.set(physicalPosition[0], physicalPosition[1], physicalPosition[2]);
      if (physics && physics !== 'none') {
        if ((physics === 'spin' && p.entity.family !== 'radial') || physics === 'orbit') ry = localTime * .45;
      } else {
      if (motion === 'rise') vec.y += .65 + Math.sin(t * .32 - Math.PI / 2) * .75;
      if (motion === 'fall') vec.y += .5 - Math.sin(t * .38) * .6;
      if (motion === 'jump') vec.y += Math.abs(Math.sin(t * 2.8)) * .65;
      if (motion === 'fly' || motion === 'float') vec.y += Math.sin(t * 1.5 + this.phase) * .14 + (vec.y < 1 ? .9 : 0);
      if (motion === 'swim' || motion === 'run') { vec.x += Math.sin(t * .85) * .33; ry = Math.cos(t * .85) * .14; }
      if (motion === 'orbit') { vec.x += Math.cos(t * .65) * .7; vec.z += Math.sin(t * .65) * .6; }
      if (motion === 'spin') ry = t * .7;
      if (motion === 'sway' || motion === 'dance') rz = Math.sin(t * (motion === 'dance' ? 3.5 : 1.5)) * .14;
      if (motion === 'sleep') { rz = -.95; vec.y += .27; scale *= .9; }
      if (motion === 'eat') rx = .13 + Math.sin(t * 5) * .04;
      if (motion === 'grow') scale *= .87 + Math.sin(t * .75) * .13;
      if (!p.entity.sculpture && (p.entity.form === 'river' || motion === 'flow')) this.parts.forEach((part, i) => { if (part.definition) part.definition.p[1] = (part.definition.role === 'ripple' ? .079 : .04) + Math.sin(t * 2.5 - i * .6) * .005; });
      if (!['river', 'lake', 'mountain', 'grass', 'house', 'castle', 'bridge'].includes(p.entity.form)) scale *= 1 + Math.sin(t * 1.8 + this.phase) * .009;
      }
    }
    const k = easing(dt, 4.5);
    if (physicalPosition) this.group.position.copy(vec); else this.group.position.lerp(vec, k);
    this.group.scale.lerp(vec.setScalar(scale), k);
    this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, rx, k);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, ry, k);
    this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, rz, k);
    this.parts.forEach((part, i) => part.update(dt, t, p?.entity, i));
    this.parts = this.parts.filter((part) => {
      if (!part.definition && part.mesh.scale.length() < .007) { part.dispose(); return false; }
      return true;
    });
  }
  dispose() { this.parts.forEach((p) => p.dispose()); this.group.removeFromParent(); }
}

export class ClayCanvas {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
  controls: OrbitControls;
  objects = new Map<string, ClayObject>();
  blob: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  blobBase: Float32Array;
  world: World = { entities: [], mood: 'day', abstract: false };
  paused = false;
  time = 0;
  frames = 0;
  fps = 60;
  simulation: Simulation;
  playbackRate = 1;
  private previous = performance.now();
  private observer: ResizeObserver;
  private empty = true;
  private bg = new THREE.Color('#f4f1e9');
  private fill: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private frame = 0;
  private active = true;
  private disposed = false;
  private framing = new THREE.Vector3(0, 1.1, 0);
  private frameSignature = '';
  private subjectSignature = '';
  private userView = false;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private media = matchMedia('(prefers-reduced-motion: reduce)');
  private onMotionChange = (event: MediaQueryListEvent) => { this.paused = event.matches; };
  constructor(public container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.3;
    this.renderer.domElement.setAttribute('aria-label', '随输入连续变化的三维橡皮泥场景。拖动旋转，滚轮缩放。');
    this.renderer.domElement.setAttribute('role', 'img');
    container.append(this.renderer.domElement);
    this.simulation = new Simulation(this.scene, container);
    this.scene.background = null;
    this.camera.position.set(4.7, 4.1, 9.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('start', () => { this.userView = true; });
    this.controls.target.set(0, 1.1, 0); this.controls.enableDamping = true; this.controls.enablePan = false;
    this.controls.minDistance = 5; this.controls.maxDistance = 20; this.controls.maxPolarAngle = Math.PI / 2.05;
    this.fill = new THREE.HemisphereLight('#fffaf1', '#a3a18e', 2.6); this.scene.add(this.fill);
    this.key = new THREE.DirectionalLight('#fff1d6', 3.8); this.key.position.set(-3.5, 7, 5); this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.camera.left = -8; this.key.shadow.camera.right = 8; this.key.shadow.camera.top = 8; this.key.shadow.camera.bottom = -8;
    this.key.shadow.normalBias = .035; this.key.shadow.bias = -.0002; this.key.shadow.radius = 5; this.scene.add(this.key);
    const rim = new THREE.DirectionalLight('#d5e1dc', 1.4); rim.position.set(4, 4, -5); this.scene.add(rim);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#777361', opacity: .16 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.16; ground.receiveShadow = true; this.scene.add(ground);
    const blobGeom = new THREE.SphereGeometry(1, 72, 48);
    this.blobBase = new Float32Array(blobGeom.attributes.position.array);
    this.blob = new THREE.Mesh(blobGeom, new THREE.MeshStandardMaterial({ color: '#b8a99e', roughness: .87 }));
    this.blob.position.y = 1.05; this.blob.castShadow = true; this.blob.receiveShadow = true; this.scene.add(this.blob);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
    this.paused = this.reduced;
    this.media.addEventListener('change', this.onMotionChange);
    this.render();
  }
  resize() { const { width, height } = this.container.getBoundingClientRect(); this.renderer.setSize(width, height); this.camera.aspect = width / Math.max(height, 1); this.camera.fov = width < 600 ? 47 : 34; this.camera.updateProjectionMatrix(); if (this.world.engine === 'world' && this.world.entities.length) this.fitScene([...this.objects.values()].flatMap(o => o.placement ? [o.placement] : [])); }
  fitScene(placements: Placement[], restoreOrientation = false) {
    if (!placements.length) return;
    const bounds = new THREE.Box3();
    for (const p of placements) {
      const e = p.entity;
      const defs = e.blueprint ? buildBlueprint(e) : e.celestial ? buildCelestial(e) : buildForm(e);
      const local = new THREE.Box3();
      for (const d of defs) {
        if (d.path) { const radius = Math.max(d.radius || .1, d.endRadius || .1); for (const point of d.path) { local.expandByPoint(new THREE.Vector3(...point).addScalar(radius)); local.expandByPoint(new THREE.Vector3(...point).addScalar(-radius)); } }
        else { const b = new THREE.Box3(new THREE.Vector3(...d.s).negate(), new THREE.Vector3(...d.s)); b.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...d.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(d.r || [0,0,0]))), new THREE.Vector3(1,1,1))); local.union(b); }
      }
      local.min.multiplyScalar(p.s).add(new THREE.Vector3(...p.p)); local.max.multiplyScalar(p.s).add(new THREE.Vector3(...p.p));
      if (['drop', 'bounce'].includes(e.physics?.kind || '')) local.max.y += e.physics!.height;
      if (e.motion === 'rise') local.max.y += 1.2;
      bounds.union(local);
    }
    if (this.simulation.space) { const radius = Math.max(...[...this.simulation.tracks.values()].map(t => t.radius * (1 + (t.e.physics?.eccentricity || 0)))) + .85; bounds.set(new THREE.Vector3(-radius, .9, -radius), new THREE.Vector3(radius, 2.75, radius)); }
    const center = bounds.getCenter(new THREE.Vector3());
    const direction = restoreOrientation ? new THREE.Vector3(.36,.3,1).normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
    const view = new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), new THREE.Vector3(0,1,0));
    const inv = new THREE.Quaternion().setFromRotationMatrix(view).invert(), halfV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    let distance = 6;
    for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
      const v = new THREE.Vector3(x,y,z).sub(center).applyQuaternion(inv);
      distance = Math.max(distance, Math.abs(v.x) / (halfV * this.camera.aspect) + v.z, Math.abs(v.y) / halfV + v.z);
    }
    distance *= 1.23;
    this.framing.copy(center); this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance); this.controls.maxDistance = Math.max(20, distance * 1.6); this.controls.update();
  }
  setWorld(world: World) {
    this.world = world; this.empty = world.entities.length === 0;
    this.framing.y = world.entities.some((e) => ['mountain', 'castle', 'tower'].includes(e.form)) ? 1.65 : 1.1;
    const placements = layoutWorld(world), retained = new Set<string>();
    const orbiters = world.entities.filter(e => e.physics?.kind === 'orbit' && e.target !== 'none');
    if (world.engine === 'world' && orbiters.length) {
      const orbitIds = new Set(orbiters.map(e => e.id));
      for (const p of placements) { p.entity.celestial = true; p.p = [0, 1.8, 0]; p.s = orbitIds.has(p.entity.id) ? (orbitIds.has(p.entity.target) ? .42 : .73) : 1; }
      this.framing.set(0, 1.8, 0);
    } else {
      this.framing.x = 0; this.framing.z = 0;
      for (const p of placements) {
        p.entity.celestial = false;
        if (p.entity.blueprint) p.s = Math.min(p.s, p.entity.family === 'mechanism' ? 1.05 : 1.2);
        if (['drop', 'bounce'].includes(p.entity.physics?.kind || '')) { p.s = .65; p.p[1] = 0; this.framing.y = 1.65; }
      }
    }
    this.simulation.setWorld(world, placements, this.time);
    for (const p of placements) {
      retained.add(p.key);
      let object = this.objects.get(p.key);
      if (!object) {
        // Reuse a disappearing sculpture when replacing a noun: its material
        // really morphs instead of removing one group and popping in another.
        const recyclable = [...this.objects].find(([key]) => !placements.some((next) => next.key === key) && !retained.has(key));
        if (recyclable) { object = recyclable[1]; this.objects.delete(recyclable[0]); }
        else object = new ClayObject(this.scene);
        this.objects.set(p.key, object);
      }
      object.set(p);
    }
    for (const [key, object] of this.objects) if (!retained.has(key)) object.set(undefined);
    const signature = JSON.stringify(world.entities.map(e => [e.label,e.family,e.blueprint,e.physics?.kind,e.physics?.height,e.physics?.eccentricity]));
    const subject = JSON.stringify(world.entities.map(e => [e.label,e.family]));
    if (world.engine === 'world' && signature !== this.frameSignature) this.fitScene(placements, subject !== this.subjectSignature && !this.userView);
    this.frameSignature = signature;
    this.subjectSignature = subject;
    this.renderer.domElement.setAttribute('aria-label', this.empty ? '一团缓慢流动、尚未定形的橡皮泥' : `三维场景：${world.entities.map((e) => e.label).join('、')}`);
  }
  resetView() { this.userView = false; if (this.world.engine === 'world' && this.world.entities.length) this.fitScene([...this.objects.values()].flatMap(o => o.placement ? [o.placement] : []), true); else { this.camera.position.set(4.7, 4.1, 9.2); this.controls.target.set(0, 1.1, 0); this.controls.update(); } }
  restartSimulation() { this.time = 0; this.simulation.restart(0); }
  seekSimulation(time: number) { this.time = time; this.simulation.restart(0); }
  snapshot() {
    this.renderer.render(this.scene, this.camera);
    const image = document.createElement('canvas'); image.width = this.renderer.domElement.width; image.height = this.renderer.domElement.height;
    const context = image.getContext('2d')!; context.fillStyle = this.bg.getStyle(); context.fillRect(0, 0, image.width, image.height); context.drawImage(this.renderer.domElement, 0, 0);
    return image.toDataURL('image/png');
  }
  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) cancelAnimationFrame(this.frame);
    else { this.previous = performance.now(); this.render(); }
  }
  render = () => {
    if (!this.active || this.disposed) return;
    this.frame = requestAnimationFrame(this.render);
    const now = performance.now(), dt = Math.min((now - this.previous) / 1000, .05); this.previous = now;
    if (document.hidden) return;
    this.frames++; this.fps += ((1 / Math.max(dt, .001)) - this.fps) * .03;
    if (!this.paused) this.time += dt * (this.simulation.active ? this.playbackRate : 1);
    const t = this.time;
    this.simulation.update(t);
    this.objects.forEach((object, key) => { const track = this.simulation.tracks.get(object.placement?.entity.id || ''); object.update(dt, t, track ? this.simulation.positions.get(track.e.id) : undefined, track ? Math.max(0, t - track.start) * (track.e.physics?.speed || 1) : t); if (object.dead && object.group.scale.x < .006) { object.dispose(); this.objects.delete(key); } });
    const target = this.empty ? 1.18 : .001;
    this.blob.scale.lerp(vec.setScalar(target), easing(dt, 4));
    this.blob.visible = this.blob.scale.x > .01;
    if (this.blob.visible) {
      const pos = this.blob.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = this.blobBase[i * 3], y = this.blobBase[i * 3 + 1], z = this.blobBase[i * 3 + 2];
        const swell = 1 + .13 * Math.sin(x * 3.8 + t * .65) * Math.cos(y * 3.5 - t * .4) + .12 * Math.sin(z * 4.2 + y * 2.4 + t * .45);
        pos.setXYZ(i, x * swell * 1.05, y * swell * .89, z * swell);
      }
      pos.needsUpdate = true; this.blob.geometry.computeVertexNormals(); this.blob.rotation.y = t * .09;
    }
    this.bg.lerp(color.set(this.world.mood === 'night' ? '#d9dcd8' : this.world.mood === 'sunset' ? '#f1e9d9' : '#f4f1e9'), easing(dt, 2));
    this.container.parentElement!.style.backgroundColor = this.bg.getStyle();
    this.controls.target.lerp(this.framing, easing(dt, 2));
    this.controls.update(); this.renderer.render(this.scene, this.camera);
    this.simulation.project(this.camera, this.container.clientWidth, this.container.clientHeight);
  };
  dispose() { this.disposed = true; cancelAnimationFrame(this.frame); this.observer.disconnect(); this.media.removeEventListener('change', this.onMotionChange); this.simulation.dispose(); this.controls.dispose(); this.objects.forEach((o) => o.dispose()); this.blob.geometry.dispose(); this.blob.material.dispose(); this.renderer.dispose(); }
}
