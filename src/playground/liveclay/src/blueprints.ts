import type { Entity, Vec } from './types';
import type { Part, Shape } from './forms';
import { pendulumState } from '../shared/dynamics.mjs';

const colors: Record<string, string> = { orange: '#d38a55', yellow: '#e5b34f', red: '#bd6656', pink: '#dbacac', blue: '#709fae', green: '#88a47b', purple: '#a398bb', white: '#e8e2d5', black: '#48504c', brown: '#a47e5c', gray: '#9ca5a0' };
const ink = '#47534f', cream = '#e9dfc9', metal = '#9eaaa3', wood = '#aa8762', glass = '#7296a0';

// Whole-object construction rules. A dimension is defined once and its children
// attach to computed endpoints, rather than independently guessing coordinates.
export function buildBlueprint(e: Entity, t = 0): Part[] {
  const b = e.blueprint!, p = b.params, out: Part[] = [];
  const c = colors[e.color] || ({ plant: '#88a276', animal: '#b79d80', mechanism: '#d9ae56', vessel: '#83a5ab', furniture: '#b99677', instrument: '#b2b7a3', radial: '#adbaa9', pendulum: '#ba8871' }[b.family] || '#a4a798');
  let serial = 0;
  const add = (name: string, pos: Vec, size: Vec, color = c, shape: Shape = 'sphere', r: Vec = [0, 0, 0], role = '') => out.push({ id: `${name}:${serial++}`, p: pos, s: size, c: color, shape, r, role });
  const sweep = (name: string, path: Vec[], radius: number, color = c, endRadius = radius, role = '') => out.push({ id: `${name}:${serial++}`, p: [0, 0, 0], s: [1, 1, 1], c: color, shape: 'sweep', path, radius, endRadius, role });
  const bar = (name: string, a: Vec, z: Vec, radius: number, color = c) => sweep(name, [a, z], radius, color);
  const circle = (name: string, center: Vec, sx: number, sy: number, radius: number, color = c, start = 0, end = Math.PI * 2) => {
    const path: Vec[] = Array.from({ length: 25 }, (_, i) => { const a = start + (end - start) * i / 24; return [center[0] + Math.cos(a) * sx, center[1] + Math.sin(a) * sy, center[2]]; });
    sweep(name, path, radius, color);
  };
  const box = (name: string, pos: Vec, s: Vec, color = c) => add(name, pos, s, color, 'box');
  const foot = () => add('foot', [0, .08, 0], [.65, .09, .5], wood, 'cylinder');
  const eyes = (y: number, z: number, spread = .21) => { for (const side of [-1, 1]) add('eye', [side * spread, y, z], [.047, .06, .036], ink, 'sphere', [0, 0, 0], 'eye'); };

  if (b.family === 'vessel') {
    const h = p.body === 'tall' ? 1.1 : p.body === 'wide' ? .34 : .68, w = p.body === 'wide' ? .85 : p.body === 'tall' ? .45 : .66;
    const cy = h + .08;
    if (p.body === 'straight') add('body', [0, cy, 0], [w, h, w], c, 'tube');
    else if (p.body === 'wide') add('body', [0, cy, 0], [w, h * 1.6, w], c, 'bowl');
    else add('body', [0, cy, 0], [w, h, w * .87]);
    add('foot', [0, .1, 0], [w * .65, .1, w * .65], c, 'cylinder');
    let top = cy + h * .85;
    if (p.neck !== 'none' && p.body !== 'wide') {
      const nh = p.neck === 'long' ? .4 : .15;
      add('neck', [0, top + nh * .45, 0], [w * .44, nh, w * .44], c, 'tube'); top += nh * 1.35;
    }
    const rim = p.body === 'straight' || p.body === 'wide' ? w : w * .48;
    add('rim', [0, top, 0], [rim, .065, rim], c, 'ring', [Math.PI / 2, 0, 0]);
    if (p.lid === 'yes') { add('lid', [0, top + .045, 0], [rim * 1.08, .11, rim * 1.08]); add('lid-knob', [0, top + .2, 0], [.115, .12, .115]); }
    if (p.handle === 'one' || p.handle === 'two') for (const side of p.handle === 'two' ? [-1, 1] : [-1]) {
      sweep('handle', [[side * w * .79, cy + h * .55, 0], [side * (w + .48), cy + h * .55, 0], [side * (w + .55), cy - h * .22, 0], [side * w * .83, cy - h * .5, 0]], .095);
    }
    if (p.handle === 'arch') circle('arch', [0, top, 0], w * .93, .75, .072, wood, 0, Math.PI);
    if (p.spout !== 'none') {
      const short = p.spout === 'short';
      sweep('spout', [[w * .7, cy - h * .23, 0], [w + .22, cy + h * .04, 0], [w + (short ? .32 : .52), cy + h * .63, 0], [w + (short ? .4 : .72), cy + h * .85, 0]], .21, c, .12);
      add('spout-opening', [w + (short ? .4 : .72), cy + h * .85, .015], [.09, .024, .09], ink, 'cylinder');
    }
    if (p.decoration === 'band') add('band', [0, cy, 0], [w * 1.008, .055, w * .88], cream, 'cylinder');
    if (p.decoration === 'spots') for (let i = 0; i < 8; i++) { const a = i * .8; add('spot', [Math.sin(a) * w * .91, cy + Math.sin(i * 3) * h * .36, Math.cos(a) * w * .81], [.07, .07, .04], cream); }
    if (p.decoration === 'fluted') for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; add('rib', [Math.sin(a) * w * .83, cy, Math.cos(a) * w * .72], [.05, h * .72, .05]); }
  } else if (b.family === 'mechanism') {
    const bike = p.base === 'frame', flying = p.base === 'hull';
    const by = bike ? .6 : .57;
    if (!bike) add('chassis', [0, by, 0], [.92, flying ? .4 : .23, .43], c, flying ? 'sphere' : 'box');
    if (p.locomotion === 'tracks') for (const z of [-.47, .47]) {
      box('track', [0, .28, z], [1.04, .26, .19], ink);
      for (let i = 0; i < 5; i++) { add('road-wheel', [-.77 + i * .38, .29, z + Math.sign(z) * .15], [.16, .16, .06], metal, 'cylinder', [Math.PI / 2, 0, 0]); }
      for (let i = 0; i < 11; i++) for (const y of [.055, .505]) box('tread', [-.9 + i * .18, y, z], [.04, .027, .21], '#626c61');
    }
    if (p.locomotion === 'four_wheels' || p.locomotion === 'two_wheels') {
      const two = p.locomotion === 'two_wheels';
      for (const x of [-.8, .8]) for (const z of two ? [0] : [-.45, .45]) {
        circle('tire', [x, .4, z], .36, .36, .075, ink);
        add('hub', [x, .4, z], [.08, .08, .1], metal);
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; bar('spoke', [x, .4, z], [x + Math.cos(a) * .31, .4 + Math.sin(a) * .31, z], .014, metal); }
      }
    }
    if (bike) {
      const a: Vec = [-.8, .4, 0], d: Vec = [.75, .4, 0], mid: Vec = [0, .4, 0], top: Vec = [-.27, 1.1, 0], front: Vec = [.48, 1.07, 0];
      for (const [u, v] of [[a, top], [a, mid], [mid, top], [top, front], [front, mid], [front, d]]) bar('frame', u, v, .043);
      box('saddle', [-.3, 1.2, 0], [.2, .055, .13], wood); bar('handlebars', [.51, 1.15, -.23], [.51, 1.15, .23], .035, ink);
    }
    if (p.cabin === 'enclosed') {
      add('cab', [-.33, 1.04, 0], [.43, .45, .37], c, 'box');
      for (const z of [-.373, .373]) box('side-window', [-.28, 1.17, z], [.3, .23, .023], glass);
      box('windshield', [.102, 1.18, 0], [.02, .23, .29], glass); box('roof', [-.33, 1.52, 0], [.47, .06, .4]);
    } else if (p.cabin === 'seat' && !bike) { box('seat', [-.23, .91, 0], [.27, .06, .25], ink); box('backrest', [-.48, 1.13, 0], [.06, .25, .25], ink); }
    if (p.boom !== 'none') {
      const animate = ['wave', 'run', 'grow'].includes(e.motion) ? Math.sin(t * .8) * .13 : 0;
      const root: Vec = [.35, .86, 0], joint: Vec = [.98, 2.05 + animate, 0], end: Vec = [1.85, p.boom === 'crane' ? 2.7 : 1.23 + animate, 0];
      bar('boom', root, joint, .145); bar('stick', joint, end, .105);
      for (const pt of [root, joint, end]) add('pivot', [pt[0], pt[1], .135], [.115, .115, .06], ink);
      bar('hydraulic-body', [.55, 1, .15], [.7, 1.68, .15], .057, ink); bar('hydraulic-piston', [.7, 1.68, .15], [.92, 1.97 + animate, .15], .027, metal);
      let tip = end;
      if (p.boom === 'crane') { tip = [end[0], .85, 0]; bar('cable', end, tip, .019, ink); }
      if (p.tool === 'bucket') { add('bucket', [tip[0] + .13, tip[1] - .29, 0], [.36, .32, .36], '#737e70', 'bowl', [0, 0, -.7]); for (const z of [-.25, 0, .25]) box('tooth', [tip[0] + .43, tip[1] - .28, z], [.12, .05, .045], '#bec1a8'); }
      if (p.tool === 'hook') circle('hook', [tip[0], tip[1] - .14, 0], .14, .19, .045, ink, -.3, Math.PI * 1.5);
      if (p.tool === 'gripper' || p.tool === 'fork') for (const side of [-1, 1]) sweep('finger', [tip, [tip[0] + .17, tip[1] - .15, side * .25], [tip[0] + .28, tip[1] - .42, side * .2]], .055, ink);
    }
    if (p.rotor === 'top') {
      bar('mast', [0, .8, 0], [0, 1.6, 0], .07, ink);
      for (let i = 0; i < 2; i++) add('rotor', [0, 1.61, 0], [1.65, .035, .1], ink, 'box', [0, t * 10 + i * Math.PI / 2, 0]);
      sweep('tail-boom', [[-.6, .65, 0], [-1.3, .69, 0], [-1.9, .94, 0]], .16, c, .065);
      add('tail-fin', [-1.8, 1.13, 0], [.2, .3, .055], c, 'cone');
      add('tail-rotor', [-1.8, 1.08, .12], [.04, .38, .04], ink, 'box', [0, 0, t * 13]);
      for (const z of [-.45, .45]) { bar('skid', [-.8, .08, z], [.8, .08, z], .045, ink); bar('strut', [-.4, .08, z], [-.4, .48, 0], .04, ink); }
    }
    if (p.rotor === 'front') for (let i = 0; i < 2; i++) add('propeller', [1, by, 0], [.035, .73, .08], ink, 'box', [t * 10 + i * Math.PI / 2, 0, 0]);
    if (p.cargo === 'bed') { box('cargo-floor', [.45, .86, 0], [.45, .06, .4]); for (const z of [-.4, .4]) box('cargo-side', [.45, 1, z], [.45, .18, .035]); }
    if (p.cargo === 'tank') add('tank', [.43, .95, 0], [.58, .36, .36], metal);
  } else if (b.family === 'furniture') {
    const w = p.platform === 'long' ? 1.08 : .63, d = .5, y = p.shelves === 'four' ? 1.9 : .92;
    const levels = p.shelves === 'four' ? 4 : p.shelves === 'two' ? 2 : 1;
    for (let i = 0; i < levels; i++) add('surface', [0, y * (i + 1) / levels, 0], [w, .08, d], p.soft === 'yes' ? c : wood, p.platform === 'round' ? 'cylinder' : 'box');
    if (p.legs === 'pedestal') { foot(); bar('pedestal', [0, .1, 0], [0, y, 0], .14, wood); }
    if (p.legs === 'four' || p.legs === 'two') for (const x of [-w * .78, w * .78]) for (const z of p.legs === 'two' ? [0] : [-d * .75, d * .75]) box('leg', [x, y / 2, z], [.065, y / 2, p.legs === 'two' ? d * .75 : .065], wood);
    if (p.back !== 'none') { const h = p.back === 'tall' ? .6 : .33; box('back', [0, y + h, -.44], [w, h, .07]); }
    if (p.arms === 'yes') for (const x of [-w, w]) { box('arm', [x, y + .35, 0], [.065, .06, .5], wood); bar('arm-post', [x, y, .35], [x, y + .35, .35], .045, wood); }
    if (p.soft === 'yes') add('cushion', [0, y + .11, .02], [w * .95, .14, d * .95]);
  } else if (b.family === 'plant') {
    const thick = p.stem === 'thick', r = thick ? .22 : p.stem === 'thin' ? .05 : .11;
    const trunk = p.stem === 'woody' ? wood : c;
    const base = p.pot === 'yes' ? .5 : 0;
    if (p.pot === 'yes') { add('pot', [0, .3, 0], [.46, .34, .46], '#bc8e74', 'cylinder'); add('soil', [0, .63, 0], [.4, .025, .4], '#80705a', 'cylinder'); }
    bar('stem', [0, base + .05, 0], [0, base + 2.05, 0], r, trunk);
    const tips: Vec[] = [[0, base + 2.02, 0]];
    const count = p.branches === 'none' ? 0 : p.branches === 'two' ? 2 : p.branches === 'crown' ? 7 : 5;
    for (let i = 0; i < count; i++) {
      const a = p.branches === 'two' ? i * Math.PI : i * 2.4, sy = base + (p.branches === 'crown' ? 1.9 : .7 + i * .2);
      const tip: Vec = [Math.cos(a) * .67, sy + .65, Math.sin(a) * .55]; tips.push(tip);
      sweep('branch', [[0, sy, 0], [tip[0] * .8, sy + .12, tip[2]], tip], r * .7, trunk, r * .65);
    }
    for (const tip of tips) {
      if (p.foliage === 'lobes') add('foliage', tip, [.48, .5, .44]);
      if (p.foliage === 'broad' || p.foliage === 'needle') for (const side of [-1, 1]) add('leaf', [tip[0] + side * .23, tip[1] - .1, tip[2]], [p.foliage === 'needle' ? .055 : .17, .43, .055], c, 'sphere', [0, 0, side * -.65]);
      if (p.foliage === 'frond') for (let j = 0; j < 5; j++) { const a = j * Math.PI * .4; sweep('frond', [tip, [tip[0] + Math.cos(a) * .55, tip[1] + .23, tip[2] + Math.sin(a) * .55], [tip[0] + Math.cos(a), tip[1] - .3, tip[2] + Math.sin(a)]], .065, c, .008); }
      if (p.flowers === 'yes') { for (let i = 0; i < 5; i++) { const a = i * Math.PI * .4; add('petal', [tip[0] + Math.cos(a) * .13, tip[1] + .13, tip[2] + Math.sin(a) * .13], [.12, .09, .12], '#d4a2a0'); } add('pollen', [tip[0], tip[1] + .2, tip[2]], [.075, .06, .075], '#dec378'); }
    }
    if (p.spines === 'yes') for (let i = 0; i < 28; i++) { const a = i * 2.4, y = base + .25 + i / 28 * 1.65; bar('spine', [Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(a) * (r + .09), y + .03, Math.sin(a) * (r + .09)], .009, cream); }
    if (p.stem === 'segmented') for (let y = .35; y < 2; y += .34) add('node', [0, base + y, 0], [r * 1.2, .04, r * 1.2], cream, 'cylinder');
  } else if (b.family === 'animal') {
    const upright = p.posture === 'upright', leg = p.legs === 'long' ? .75 : p.legs === 'none' ? .05 : .32;
    const bodyY = leg * 1.4 + .42, long = p.posture === 'elongated';
    add('body', [0, bodyY, 0], [long ? .47 : .54, upright ? .62 : .46, upright ? .4 : long ? .95 : .77]);
    if (p.legs !== 'none') for (const x of [-.36, .36]) for (const z of upright ? [.24] : p.posture === 'insect' ? [-.55, 0, .55] : [-.48, .48]) { add('leg', [x, leg, z], [.135, leg, .14], c, 'sphere', [0, 0, 0], 'leg'); add('toe', [x, .105, z + .06], [.17, .11, .2]); }
    const neck = p.neck === 'long' ? 1.05 : .22, hy = bodyY + neck + (upright ? .45 : .2), hz = upright ? .18 : .57;
    bar('neck', [0, bodyY, hz * .6], [0, hy, hz], p.neck === 'long' ? .19 : .3);
    add('head', [0, hy, hz], [.38, .37, p.snout === 'long' ? .48 : .35], c, 'sphere', [0, 0, 0], 'head');
    if (p.snout === 'trunk') sweep('trunk', [[0, hy - .05, hz + .3], [0, hy - .45, hz + .53], [.12, hy - .85, hz + .62], [.27, hy - .76, hz + .7]], .15, c, .075);
    else add('snout', [0, hy - .12, hz + .3], [p.snout === 'beak' ? .14 : .23, .14, p.snout === 'long' ? .37 : .19], p.snout === 'beak' ? '#cdac68' : c, p.snout === 'beak' ? 'cone' : 'sphere', [Math.PI / 2, 0, 0]);
    eyes(hy + .075, hz + .3);
    if (p.ears !== 'none') for (const side of [-1, 1]) { const big = p.ears === 'large'; add('ear', [side * (big ? .48 : .3), hy + (big ? .02 : .33), hz - .04], [big ? .34 : .14, p.ears === 'long' ? .48 : big ? .46 : .19, .095], c, p.ears === 'pointed' ? 'cone' : 'sphere'); }
    if (p.tail !== 'none') sweep('tail', [[0, bodyY, -.65], [.08, bodyY - .13, -.94], [.35, bodyY + .03, p.tail === 'short' ? -1.05 : -1.45]], p.tail === 'thick' ? .24 : .075, c, .022);
    if (p.wings === 'yes') for (const side of [-1, 1]) add('wing', [side * .8, bodyY + .17, -.05], [.64, .15, .48], c, 'sphere', [0, 0, side * .4], 'wing');
    if (p.horns === 'yes') for (const side of [-1, 1]) add('horn', [side * .2, hy + .44, hz], [.065, .23, .065], cream, 'cone');
    if (p.pattern === 'spots' || p.pattern === 'stripes') for (let i = 0; i < 12; i++) { const a = i * 2.4, z = -.47 + (i % 4) * .29; add('mark', [Math.cos(a) * .5, bodyY + Math.sin(a) * .42, z], [p.pattern === 'stripes' ? .045 : .1, .06, .12], wood); }
    if (p.pattern === 'plates') for (let i = 0; i < 5; i++) add('plate', [0, bodyY + .47, -.6 + i * .27], [.07, .23, .16], wood, 'cone');
  } else if (b.family === 'instrument') {
    const cy = p.stand === 'none' ? .95 : 1.55, a = p.direction === 'upward' ? .4 : p.direction === 'downward' ? -.45 : p.direction === 'vertical' ? Math.PI / 2 : 0;
    const axis: Vec = [Math.cos(a), Math.sin(a), 0], at = (d: number): Vec => [axis[0] * d, cy + axis[1] * d, 0];
    if (p.stand === 'tripod') for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; bar('tripod', [0, cy - .1, 0], [Math.cos(a) * .7, .03, Math.sin(a) * .7], .055, wood); }
    else if (p.stand !== 'none') { foot(); sweep('support', [[0, .1, 0], [p.stand === 'bent' ? -.45 : 0, cy * .65, 0], [0, cy, 0]], .075, metal); }
    if (p.body === 'box') box('body', [0, cy, 0], [.45, .33, .34]);
    else if (p.body === 'dome') add('shade', at(.25), [.55, .42, .55], c, 'bowl', [0, 0, -Math.PI / 2 + a]);
    else sweep('body', [at(-.6), at(.6)], p.body === 'bell' ? .12 : .21, c, p.body === 'bell' ? .43 : .29);
    if (p.lens === 'yes') add('lens', at(.625), [.025, .265, .265], glass, 'sphere', [0, 0, a]);
    if (p.eyepiece === 'yes') { bar('eyepiece', at(-.6), at(-.91), .085, ink); add('ocular', at(-.92), [.03, .1, .1], metal); }
    if (p.knobs === 'yes') for (const z of [-.34, .34]) add('knob', [0, cy - .15, z], [.09, .09, .07], wood, 'cylinder', [Math.PI / 2, 0, 0]);
  } else if (b.family === 'radial') {
    const cy = p.stand === 'tower' ? 1.9 : p.stand === 'short' ? 1.25 : 1, count = { three: 3, four: 4, six: 6, eight: 8 }[p.count] || 6;
    if (p.stand !== 'none') { foot(); bar('post', [0, .1, 0], [0, cy, 0], .085, wood); }
    const rotation = e.motion === 'spin' || e.physics?.kind === 'spin' ? t : 0;
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 / count + rotation, radius = p.elements === 'teeth' ? .58 : .5;
      const pos: Vec = p.axis === 'up' ? [Math.sin(a) * radius, cy, Math.cos(a) * radius] : [Math.sin(a) * radius, cy + Math.cos(a) * radius, 0];
      const size: Vec = p.elements === 'teeth' ? [.14, .15, .13] : [.18, .55, .055];
      add('radial-element', pos, size, i % 2 ? cream : c, p.elements === 'teeth' ? 'box' : 'sphere', p.axis === 'up' ? [Math.PI / 2, a, 0] : [0, 0, -a]);
    }
    add('hub', [0, cy, .07], [p.elements === 'teeth' ? .56 : .2, p.elements === 'teeth' ? .56 : .2, .12], wood);
    if (p.elements === 'canopy') add('canopy', [0, cy + .03, 0], [1.05, .32, 1.05], c, 'bowl', [Math.PI, 0, 0]);
  } else if (b.family === 'pendulum') {
    box('base', [0, .05, 0], [1.1, .065, .53], wood);
    for (const x of p.support === 'single' ? [-.96] : [-.96, .96]) bar('post', [x, .09, 0], [x, 2.65, 0], .06, metal);
    bar('beam', [-.96, 2.65, 0], [.96, 2.65, 0], .075, metal);
    // The physical renderer supplies time in seconds. Analytic small-angle
    // pendulum with a conservative initial amplitude; a rigid length is enforced.
    const theta = e.physics?.kind === 'pendulum' ? pendulumState(t, e.physics.gravity).angle : .35;
    const bob: Vec = [Math.sin(theta) * 1.7, 2.57 - Math.cos(theta) * 1.7, 0];
    bar('suspension', [0, 2.57, 0], bob, p.string === 'rod' ? .035 : .012, ink);
    add('bob', bob, [.23, .23, .23], c, p.bob === 'box' ? 'box' : 'sphere');
    add('pivot', [0, 2.57, 0], [.085, .085, .07], wood);
  } else {
    const tall = p.core === 'tall', flat = p.core === 'flat', cy = tall ? 1 : flat ? .3 : .75;
    add('core', [0, cy, 0], [flat ? .9 : .55, tall ? .9 : flat ? .13 : .6, .46], c, p.core === 'block' || flat ? 'box' : p.core === 'ring' ? 'ring' : tall ? 'cylinder' : 'sphere');
    if (p.upper === 'sphere' || p.upper === 'cone') add('top', [0, cy + .75, 0], [.35, .4, .33], c, p.upper);
    if (p.upper === 'neck') { bar('neck', [0, cy + .4, 0], [0, cy + 1.1, 0], .12); add('top', [0, cy + 1.1, 0], [.23, .2, .24]); }
    if (p.upper === 'branches') for (const x of [-.6, .6]) sweep('branch', [[0, cy + .3, 0], [x, cy + .75, 0], [x, cy + 1.05, 0]], .08);
    if (p.sides !== 'none') for (const s of [-1, 1]) {
      if (p.sides === 'handles') circle('handle', [s * .65, cy, 0], .32, .4, .065);
      else if (p.sides === 'arms') sweep('arm', [[s * .4, cy + .2, 0], [s * .85, cy + .45, 0], [s, cy - .15, .2]], .09);
      else add('side', [s * .65, cy, 0], p.sides === 'wings' ? [.55, .12, .4] : [.27, .37, .25]);
    }
    if (p.lower === 'legs' || p.lower === 'feet' || p.lower === 'wheels') for (const x of [-.4, .4]) for (const z of p.lower === 'feet' ? [.15] : [-.3, .3]) add('lower', [x, .2, z], [.16, p.lower === 'legs' ? .32 : .16, .17], p.lower === 'wheels' ? ink : c);
    if (p.lower === 'base') foot();
    if (p.front === 'eyes') eyes(cy + .18, .44);
    if (p.front === 'opening') add('opening', [0, cy, .45], [.25, .25, .04], ink, 'ring');
    if (p.front === 'panel') box('panel', [0, cy, .47], [.3, .27, .035], glass);
    if (p.front === 'tube') sweep('tube', [[0, cy, .4], [0, cy + .08, .95]], .13);
  }
  return out;
}

// Celestial surfaces use deterministic spherical patches, never generated images.
export function buildCelestial(e: Entity): Part[] {
  const radius = e.form === 'sun' ? .78 : .53, earth = e.form === 'planet';
  const c = colors[e.color] || (e.form === 'sun' ? '#edbc57' : earth ? '#689fae' : '#c4c4af');
  const out: Part[] = [{ id: 'globe', p: [0, 0, 0], s: [radius, radius, radius], c }];
  if (earth && e.color === 'natural') {
    // A stylized, explicitly non-cartographic land distribution on a sphere.
    for (let cluster = 0; cluster < 5; cluster++) for (let i = 0; i < 8; i++) {
      const lon = cluster * 1.27 + Math.sin(i * 1.8) * .22, lat = Math.sin(cluster * 3.1 + .4) * .5 + (i - 3.5) * .07;
      const n: Vec = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      out.push({ id: `land-${cluster}-${i}`, p: n.map(v => v * radius) as Vec, s: [.082, .105, .012], r: [-Math.atan2(n[1], n[2]), Math.asin(n[0]), 0], c: cluster % 2 ? '#91a777' : '#bec192' });
    }
    for (const side of [-1, 1]) out.push({ id: `pole-${side}`, p: [0, side * radius * .94, 0], s: [.16, .045, .16], c: cream });
  }
  if (e.form === 'satellite') for (let i = 0; i < 9; i++) { const a = i * 2.4, y = -.7 + i * .175, r = Math.sqrt(1 - y * y); out.push({ id: `crater-${i}`, p: [Math.cos(a) * r * radius * .96, y * radius, Math.sin(a) * r * radius * .96], s: [.09, .09, .09], c: '#aeb4a1' }); }
  return out;
}
