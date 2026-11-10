// A constructive vocabulary, deliberately without complete-object recipes.
// The server chooses these symbols through JEV; this module only does geometry.
import { Euler, Quaternion, Vector3 } from 'three';

export const SCULPT_LIMITS = { entities: 4, rounds: 9, parts: 12, deadlineMs: 55000 };
export const PRIMITIVES = {
  sphere: 'Rounded solid, ellipsoid / 圆团、椭球', box: 'Rounded rectangular block / 圆角方块',
  cylinder: 'Straight solid cylindrical rod or disk, axis Y / 实心圆柱，轴向Y',
  cone: 'Tapered pointed solid, tip toward +Y / 尖锥，上端尖',
  ring: 'Closed loop with a visible hole, in XY plane / 闭合圆环，有孔',
  tube: 'Open hollow tube, axis Y, visible wall and open ends / 空心管，两端开口',
  bowl: 'Open cup or concave shell, opening upward +Y / 碗形凹壳，开口向上',
  sheet: 'Thin curved surface / 薄片曲面', coil: 'Helical spring, axis Y / 螺旋弹簧，轴向Y',
};
export const ROLES = {
  head: ['头部', 'head, a distinct head of a living figure'],
  neck: ['颈部', 'neck joining head to body'], eye: ['眼睛', 'visible eyes'],
  ear: ['耳朵', 'ears'], nose: ['鼻端', 'nose, muzzle or beak'], mouth: ['嘴部', 'mouth opening or lips'],
  leg: ['支腿', 'legs or load-bearing feet'], arm: ['手臂', 'arms or grasping limbs'],
  tail: ['尾部', 'tail'], wing: ['翼片', 'wings or fins'], horn: ['尖角', 'horns or pointed projections'],
  lobe: ['分叶', 'rounded lobe, a subdivided mass'], branch: ['分枝', 'branch or branching projection'],
  leaf: ['叶片', 'leaves or thin organic blades'], petal: ['花瓣', 'petals around a center'],
  stem: ['茎杆', 'stem, stalk or trunk'], shell: ['外壳', 'protective outer shell or cover'],
  rim: ['边缘', 'lip, rim or boundary ring'], handle: ['把手', 'handle for holding, often a loop'],
  spout: ['出流管', 'spout or pouring nozzle'], lid: ['盖子', 'lid or cap'],
  wheel: ['滚轮', 'wheels or rolling disks'], track: ['履带', 'continuous caterpillar tracks'],
  cabin: ['舱体', 'cabin, cockpit or enclosed operator space'], window: ['窗口', 'visible window or glass panel'],
  link: ['连杆', 'first long rigid articulated link or boom'], link2: ['末端连杆', 'second articulated link continuing from a first link'],
  joint: ['关节', 'pivot or joint between links'], scoop: ['凹形端部', 'scoop, shovel or concave working end'],
  support: ['支架', 'supporting column, frame or stand'], platform: ['底座', 'flat base or platform'],
  beam: ['横梁', 'horizontal cross beam or rail'], rod: ['细杆', 'thin straight rod'],
  cable: ['细索', 'flexible cord, string, cable or hanging connector'], weight: ['重块', 'hanging bob, mass or counterweight'],
  spring: ['弹性线圈', 'helical spring'], blade: ['叶轮', 'rotor blades or long flat vanes'],
  pipe: ['导管', 'hollow conduit or tube'], chamber: ['腔室', 'internal chamber or cavity'],
  valve: ['瓣片', 'valve or flap'], ridge: ['凸脊', 'raised ridge or rib'],
  roof: ['顶面', 'roof, canopy or upper covering'], panel: ['面板', 'flat side panel'],
  opening: ['开口边框', 'visible rim of an opening'], knob: ['旋钮', 'small knob or button'],
  path: ['延展曲线', 'flowing path, channel or trail'], ray: ['放射条', 'radial rays or spokes'],
};
export const EXTENTS = { hair: .045, thin: .10, narrow: .20, medium: .38, broad: .65, long: 1.05 };
export const EXTENT_CHOICES = {
  hair: 'Hair-thin, thread-like thickness / 极细', thin: 'Thin, small detail / 薄、小细节',
  narrow: 'Narrow, about a small fraction of main mass / 窄', medium: 'Medium, secondary mass / 中等',
  broad: 'Broad, comparable to main mass / 宽大', long: 'Long, extending beyond main mass / 很长',
};
// Joint aspect-ratio choices keep the meaning visible to JEV and prevent three
// independent axis decisions from making a rod as wide as it is long.
export const PROFILES = {
  balanced: { label: 'Similar width, height and depth / 三向接近的团块', ratio: [1, 1, 1] },
  upright: { label: 'Tall and stout, longer vertically / 粗壮的竖向长体', ratio: [.4, 1, .4] },
  slender: { label: 'Long thin rod, length on local Y / 细长杆，Y为长度', ratio: [.12, 1, .12] },
  squat: { label: 'Low broad solid base / 低矮宽阔的实体', ratio: [1, .35, .7] },
  flat: { label: 'Wide horizontal disk or plate, thin on Y / 水平薄盘或板', ratio: [1, .12, 1] },
  face: { label: 'Flat upright face, thin on Z / 竖立薄面', ratio: [1, .8, .12] },
  blade: { label: 'Elongated flat blade, long Y, thin Z / 长薄叶片', ratio: [.3, 1, .06] },
  oval: { label: 'Upright oval loop or oval mass / 竖立椭圆', ratio: [.65, 1, .3] },
  horizontal: { label: 'Long sideways block, long X / 横向长块', ratio: [1, .3, .35] },
};
const compatibleProfiles = {
  sphere: ['balanced', 'upright', 'squat', 'flat', 'oval'], box: ['balanced', 'upright', 'slender', 'squat', 'flat', 'face', 'horizontal'],
  cylinder: ['balanced', 'upright', 'slender', 'flat'], cone: ['balanced', 'upright', 'slender'],
  ring: ['face', 'oval', 'horizontal'], tube: ['upright', 'slender'], bowl: ['balanced', 'squat'],
  sheet: ['face', 'flat', 'blade'], coil: ['upright', 'slender'],
};
export const GEOMETRY_OPTIONS = Object.fromEntries(Object.entries(compatibleProfiles).flatMap(([shape, profiles]) => profiles.map((profile) => [`${shape}_${profile}`, { shape, profile, label: `${PRIMITIVES[shape]}; ${PROFILES[profile].label}` }])));
export const SITES = {
  center: [0, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0],
  left: [-1, 0, 0], right: [1, 0, 0], front: [0, 0, 1], back: [0, 0, -1],
  top_front: [0, 1, .7], top_back: [0, 1, -.7], top_left: [-.7, 1, 0], top_right: [.7, 1, 0],
  bottom_front: [0, -1, .7], bottom_back: [0, -1, -.7], front_left: [-.7, 0, 1], front_right: [.7, 0, 1],
};
export const SITE_LABELS = { center: '中心重叠', top: '顶部', bottom: '底部', left: '左侧', right: '右侧', front: '前侧', back: '后侧', top_front: '顶部前侧', top_back: '顶部后侧', top_left: '顶部左侧', top_right: '顶部右侧', bottom_front: '底部前侧', bottom_back: '底部后侧', front_left: '前侧左部', front_right: '前侧右部' };
export const ORIENTATIONS = {
  upright: [0, 0, 0], horizontal_x: [0, 0, -Math.PI / 2], horizontal_z: [Math.PI / 2, 0, 0],
  lean_left: [0, 0, Math.PI / 4], lean_right: [0, 0, -Math.PI / 4],
  lean_front: [Math.PI / 4, 0, 0], lean_back: [-Math.PI / 4, 0, 0], inverted: [Math.PI, 0, 0],
};
export const ORIENTATION_CHOICES = {
  upright: 'Local long Y axis points up; opening faces up / 竖直',
  horizontal_x: 'Rotate Y axis to point right, along X / 横向左右',
  horizontal_z: 'Rotate Y axis to point forward, along Z / 横向前后',
  lean_left: 'Tilt 45 degrees to left / 向左倾斜', lean_right: 'Tilt 45 degrees to right / 向右倾斜',
  lean_front: 'Tilt 45 degrees forward / 向前倾斜', lean_back: 'Tilt 45 degrees backward / 向后倾斜',
  inverted: 'Flip upside down, opening or tip faces down / 倒置',
};
export const SYMMETRIES = { single: 'One / 单个', pair_x: 'Mirrored left and right / 左右一对', pair_z: 'Mirrored front and back / 前后一对', four: 'Four at left/right and front/back / 四角', radial: 'Six arranged radially / 放射六个' };
export const BENDS = { straight: 0, slight_left: -.3, slight_right: .3, hooked_left: -.75, hooked_right: .75 };
export const COLORS = { clay: '#b7a693', orange: '#cb8d5e', yellow: '#d5b458', red: '#bd7165', pink: '#cf9d9c', blue: '#809daf', green: '#93a383', purple: '#a698b4', white: '#ece5d6', black: '#55584e', brown: '#9c8068', gray: '#a4aaa3' };
export const REFINEMENTS = {
  stretch_x: 'Make wider / 横向拉长', stretch_y: 'Make taller / 纵向拉长', stretch_z: 'Make deeper / 前后拉长',
  flatten: 'Flatten vertically / 向下压扁', slim: 'Make slimmer / 捏细', inflate: 'Make fuller / 鼓起',
  bend_left: 'Bend left / 向左弯曲', bend_right: 'Bend right / 向右弯曲', straighten: 'Straighten / 拉直',
  taper: 'Taper the upper end / 捏尖上端', round: 'Round the form / 揉圆', square: 'Make a rounded block / 捏成方块',
};

export function deformPoint(x, y, z, node) {
  const taper = 1 - (node.taper || 0) * (y + 1) / 2;
  x *= taper; z *= taper;
  const twist = (node.twist || 0) * y;
  const xx = x * Math.cos(twist) - z * Math.sin(twist);
  z = x * Math.sin(twist) + z * Math.cos(twist); x = xx;
  x += (node.bend || 0) * y * y;
  return [x, y, z];
}

export function refineNode(node, edit) {
  const n = structuredClone(node); n.edits = (n.edits || 0) + 1;
  if (edit.startsWith('stretch_')) n.size['xyz'.indexOf(edit.at(-1))] *= 1.3;
  if (edit === 'flatten') n.size[1] *= .65;
  if (edit === 'slim') { n.size[0] *= .75; n.size[2] *= .75; }
  if (edit === 'inflate') n.size = n.size.map((v) => v * 1.2);
  if (edit === 'bend_left') n.bend = Math.max(-.9, n.bend - .3);
  if (edit === 'bend_right') n.bend = Math.min(.9, n.bend + .3);
  if (edit === 'straighten') n.bend = 0;
  if (edit === 'taper') n.taper = Math.min(.7, n.taper + .25);
  if (edit === 'round') n.shape = 'sphere';
  if (edit === 'square') n.shape = 'box';
  n.size = n.size.map((v) => Math.max(.025, Math.min(1.8, v)));
  return n;
}

export function validateSculpture(nodes) {
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > SCULPT_LIMITS.parts) throw new Error('Invalid sculpt node count');
  const seen = new Set();
  for (const n of nodes) {
    if (!n.id || seen.has(n.id)) throw new Error('Duplicate sculpt id');
    if (!Object.hasOwn(PRIMITIVES, n.shape) || !Object.hasOwn(SITES, n.site) || !Object.hasOwn(ORIENTATIONS, n.orientation) || !Object.hasOwn(SYMMETRIES, n.symmetry)) throw new Error('Invalid sculpt symbol');
    if (!Array.isArray(n.size) || n.size.length !== 3 || n.size.some((v) => !Number.isFinite(v) || v < .025 || v > 1.8)) throw new Error('Invalid sculpt dimensions');
    if (!Number.isFinite(n.bend) || Math.abs(n.bend) > 1 || !Number.isFinite(n.taper) || n.taper < 0 || n.taper > .8) throw new Error('Invalid deformation');
    if (n.parent !== null && !seen.has(n.parent)) throw new Error('Sculpt parent must precede child');
    if (seen.size === 0 && n.parent !== null) throw new Error('Missing root');
    if (seen.size > 0 && n.parent === null) throw new Error('Disconnected root');
    seen.add(n.id);
  }
  return nodes;
}

const v = (a) => new Vector3(...a);
function boundsOf(size, q, bend = 0) {
  const extent = [size[0] * (1 + Math.abs(bend)), size[1], size[2]];
  const b = [0, 0, 0];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const p = v([x * extent[0], y * extent[1], z * extent[2]]).applyQuaternion(q).toArray();
    p.forEach((c, i) => { b[i] = Math.max(b[i], Math.abs(c)); });
  }
  return b;
}

// Connections are computed from extents. A parent is always an earlier node,
// so cycles and dangling links are impossible; arithmetic never goes to JEV.
export function compileSculpture(nodes, time = 0) {
  validateSculpture(nodes);
  const parts = [], first = new Map();
  for (const n of nodes) {
    const parent = first.get(n.parent);
    const baseDirection = [...SITES[n.site]];
    let dirs = [baseDirection];
    if (n.symmetry === 'pair_x' || n.symmetry === 'four') dirs = [-1, 1].map((s) => [s * Math.max(.65, Math.abs(baseDirection[0])), baseDirection[1], baseDirection[2]]);
    if (n.symmetry === 'pair_z' || n.symmetry === 'four') dirs = dirs.flatMap((d) => [-1, 1].map((s) => [d[0], d[1], s * Math.max(.65, Math.abs(d[2]))]));
    if (n.symmetry === 'radial') dirs = Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3), baseDirection[2]]);
    dirs.forEach((dir, i) => {
      const r = [...ORIENTATIONS[n.orientation]];
      if (n.symmetry === 'radial') r[2] += i * Math.PI / 3 - Math.PI / 2;
      if (n.symmetry === 'pair_x' && i === 0) r[2] *= -1;
      if (n.motion === 'hinge') r[0] += Math.sin(time * 1.5) * .32;
      if (n.motion === 'spin') r[1] += time * .8;
      const localQ = new Quaternion().setFromEuler(new Euler(...r));
      const q = parent ? parent.q.clone().multiply(localQ) : localQ;
      const localExtent = boundsOf(n.size, localQ, n.bend);
      const pos = new Vector3();
      if (parent) {
        const ext = parent.node.size;
        const offset = dir.map((d, axis) => d * (ext[axis] + localExtent[axis] * .62));
        // Account for the bent endpoint, otherwise a new segment floats away.
        offset[0] += parent.node.bend * dir[1] * dir[1] * ext[0];
        pos.copy(v(offset).applyQuaternion(parent.q).add(parent.pos));
      }
      const euler = new Euler().setFromQuaternion(q);
      const item = { id: `${n.id}:${i}`, role: n.role, node: n, pos, q, p: pos.toArray(), s: n.size, r: [euler.x, euler.y, euler.z], c: COLORS[n.color] || COLORS.clay, shape: n.shape, bend: n.bend, taper: n.taper, twist: n.twist || 0 };
      parts.push(item); if (i === 0) first.set(n.id, item);
    });
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const b = boundsOf(p.s, p.q, p.bend);
    p.p.forEach((n, i) => { min[i] = Math.min(min[i], n - b[i]); max[i] = Math.max(max[i], n + b[i]); });
  }
  const size = max.map((n, i) => n - min[i]);
  const fit = Math.min(1, 3.3 / Math.max(size[0], size[1], size[2]));
  const centerX = (max[0] + min[0]) / 2, centerZ = (max[2] + min[2]) / 2;
  return {
    parts: parts.map(({ pos, q, node, ...p }) => ({ ...p, p: [(p.p[0] - centerX) * fit, (p.p[1] - min[1]) * fit, (p.p[2] - centerZ) * fit], s: p.s.map((x) => x * fit) })),
    bounds: { width: size[0], height: size[1], depth: size[2], fit },
    checks: { connectedGraph: true, finiteGeometry: true, meshParts: parts.length, autoFit: fit < 1 },
  };
}

export function summarizeSculpture(nodes) {
  const { bounds, checks } = compileSculpture(nodes);
  return { parts: nodes.map((n) => ({ id: n.id, role: n.role, primitive: n.shape, parent: n.parent, attachment: SITE_LABELS[n.site], proportions: n.size, orientation: n.orientation, copies: n.symmetry, bend: n.bend, taper: n.taper, color: n.color, edits: n.edits || 0 })), bounds, checks };
}
