import type { Entity, Vec } from './types';

export type Shape = 'sphere' | 'cone' | 'box' | 'cylinder' | 'ring' | 'river' | 'tube' | 'bowl' | 'sheet' | 'coil' | 'sweep';
export interface Part { p: Vec; s: Vec; c: string; r?: Vec; shape?: Shape; role?: string; id?: string; bend?: number; taper?: number; twist?: number; path?: Vec[]; radius?: number; endRadius?: number; }
const palette: Record<string, string> = { orange: '#cc8054', yellow: '#e7b64d', red: '#bb5b4d', pink: '#d5999f', blue: '#769eae', green: '#8ba27b', purple: '#a79abd', white: '#ebe5d7', black: '#424846', brown: '#997054', gray: '#9b9f97' };
export const natural: Record<string, string> = { sun: '#ebba55', moon: '#e8e0bd', star: '#e8bc60', cloud: '#e9e6df', mountain: '#90a28e', river: '#84b3bc', lake: '#91b9bd', rain: '#87aab6', snow: '#eeece4', tree: '#819675', grass: '#9aaa79', flower: '#d3908f', mushroom: '#bc7961', rock: '#a5a699', cat: '#c99064', dog: '#a98465', rabbit: '#e3d4c8', bear: '#ab8868', fox: '#ce895e', pig: '#dca8a1', horse: '#a68063', bird: '#b3ad77', duck: '#e3bd65', penguin: '#536267', fish: '#84aeb4', whale: '#779aa8', turtle: '#92a27e', frog: '#a3b37b', butterfly: '#b8a0ba', octopus: '#b691ae', snail: '#b59b7b', person: '#c6a68b', house: '#c7977c', tower: '#d3c4ab', castle: '#b3b2a2', bridge: '#b5a68d', car: '#b9836f', boat: '#b98965', airplane: '#b4bcb4', rocket: '#dfd9c9', robot: '#97b0ad', fruit: '#b86554', carrot: '#ce8c54', bone: '#e7ddc6', ball: '#bf9277', heart: '#c78383' };
const ink = '#3b4240', cream = '#eae1cd';

export function buildForm(e: Entity): Part[] {
  const parts: Part[] = [];
  const c = palette[e.color] || natural[e.form] || '#a99fbb';
  const add = (p: Vec, s: Vec, color = c, shape: Shape = 'sphere', r: Vec = [0, 0, 0], role = '') => parts.push({ p, s, c: color, shape, r, role });
  const eyes = (y = 1.3, z = .48, spread = .2) => {
    for (const side of [-1, 1]) { add([side * spread, y, z], [.045, .066, .04], ink, 'sphere', [0, 0, 0], 'eye'); }
  };
  const limb = (x: number, y: number, z: number, sx = .16, sy = .4, sz = .17, role = 'leg') => add([x, y, z], [sx, sy, sz], c, 'sphere', [0, 0, 0], role);
  const f = e.form;
  if (['cat', 'dog', 'rabbit', 'bear', 'fox', 'pig', 'creature', 'horse'].includes(f)) {
    add([0, .7, 0], [.46, .63, .37]);
    add([0, 1.43, .1], [.52, .46, .43], c, 'sphere', [0, 0, 0], 'head');
    for (const x of [-.29, .29]) { limb(x, .19, .21, .2, .2, .28); limb(x * 1.45, .7, .22, .13, .32, .14, 'arm'); }
    if (f === 'cat' || f === 'fox' || f === 'creature') {
      for (const x of [-.34, .34]) add([x, 1.91, .06], [.22, .34, .18], c, 'cone', [0, 0, -x * .4]);
    } else if (f === 'rabbit') {
      for (const x of [-.25, .25]) { add([x, 2.03, .02], [.16, .57, .17], c, 'sphere', [0, 0, -x * .25]); add([x, 2.07, .16], [.065, .37, .035], '#cb9d96'); }
    } else {
      for (const x of [-.46, .46]) add([x, f === 'dog' ? 1.35 : 1.77, 0], [f === 'dog' ? .19 : .22, f === 'dog' ? .39 : .23, .16]);
    }
    add([0, 1.27, .44], [f === 'pig' ? .25 : .2, .16, .15], f === 'pig' ? '#c28a85' : cream);
    add([0, 1.35, .585], [.067, .046, .035], f === 'pig' ? '#ad7773' : '#785f56');
    eyes(1.5, .488, .215);
    if (['cat', 'fox', 'dog', 'creature'].includes(f)) {
      for (let i = 0; i < 4; i++) add([.46 + Math.sin(i * .55) * .4, .35 + i * .19, -.23 - i * .04], [.15 - i * .018, .22, .16 - i * .02], c, 'sphere', [0, 0, -.5 + i * .3], 'tail');
    }
    if (f === 'horse') { add([0, 1.72, .02], [.26, .55, .24]); add([0, 2.08, .25], [.3, .3, .5]); }
  } else if (['bird', 'duck', 'penguin'].includes(f)) {
    add([0, .7, 0], [.47, .61, .43]);
    add([0, 1.39, .08], [.38, .37, .36]);
    if (f === 'penguin') add([0, .75, .28], [.32, .43, .19], cream);
    eyes(1.46, .39, .15);
    add([0, 1.28, .48], [f === 'duck' ? .23 : .12, .09, .2], '#d4a355', 'cone', [Math.PI / 2, 0, 0]);
    for (const x of [-.45, .45]) add([x, .8, -.01], [.13, .42, .3], c, 'sphere', [0, 0, x * .5], 'wing');
    for (const x of [-.2, .2]) add([x, .1, .18], [.2, .08, .27], '#c9a15a');
  } else if (['fish', 'whale'].includes(f)) {
    add([0, .65, 0], [.83, .4, .35]);
    for (const side of [-1, 1]) add([-.84, .68 + side * .19, 0], [.28, .26, .11], c, 'cone', [0, 0, -Math.PI / 2 - side * .5], 'tail');
    add([.16, .37, .12], [.26, .08, .32], c, 'sphere', [0, 0, .2], 'fin');
    add([.45, .78, .29], [.045, .055, .04], ink, 'sphere', [0, 0, 0], 'eye');
    if (f === 'whale') add([.07, .57, .27], [.59, .24, .14], cream);
  } else if (f === 'frog' || f === 'turtle') {
    add([0, .48, 0], [.67, .43, .59]);
    add([0, .51, .58], [.3, .28, .31]);
    for (const x of [-.55, .55]) for (const z of [-.3, .3]) add([x, .17, z], [.28, .17, .28]);
    if (f === 'frog') for (const x of [-.2, .2]) { add([x, .77, .59], [.15, .19, .14]); add([x, .79, .72], [.045, .05, .03], ink); }
    else { eyes(.59, .83, .13); add([0, .73, -.03], [.49, .2, .47], '#778d68'); }
  } else if (f === 'butterfly') {
    add([0, .75, 0], [.1, .55, .1], '#847565');
    for (const side of [-1, 1]) for (const y of [.5, 1.05]) add([side * .43, y, 0], [y === .5 ? .36 : .5, .35, .06], c, 'sphere', [0, 0, side * .25], 'wing');
    eyes(1.23, .1, .055);
  } else if (f === 'octopus') {
    add([0, .83, 0], [.56, .6, .5]); eyes(.95, .465, .2);
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; add([Math.cos(a) * .48, .22, Math.sin(a) * .48], [.42, .17, .15], c, 'sphere', [0, -a, 0], 'tentacle'); }
  } else if (f === 'snail') {
    add([0, .2, 0], [.9, .2, .3], '#bdac83'); add([-.15, .7, 0], [.52, .55, .4]); add([.67, .52, 0], [.16, .43, .18], '#bdac83'); eyes(.88, .13, .08);
  } else if (f === 'sun' || f === 'star') {
    add([0, 0, 0], [.57, .57, .22]);
    for (let i = 0; i < (f === 'star' ? 5 : 8); i++) { const a = i * Math.PI * 2 / (f === 'star' ? 5 : 8); add([Math.sin(a) * .68, Math.cos(a) * .68, 0], [.1, .24, .12], c, f === 'star' ? 'cone' : 'sphere', [0, 0, -a], 'ray'); }
  } else if (f === 'moon') {
    for (let i = 0; i < 9; i++) { const a = -.65 + i * .43; add([Math.cos(a) * .42, Math.sin(a) * .62, 0], [.25 - Math.abs(i - 4) * .027, .25 - Math.abs(i - 4) * .022, .17]); }
  } else if (f === 'cloud') {
    [[-.65, 0, .1], [-.15, .2, 0], [.45, .05, 0], [.05, -.12, .18]].forEach((p) => add(p as Vec, [.53, .42, .35]));
  } else if (f === 'mountain') {
    add([0, 1.1, 0], [1.6, 1.5, .96], c, 'cone'); add([-1.18, .67, -.16], [1.05, .95, .78], '#a5b299', 'cone'); add([1.05, .48, -.18], [.84, .73, .68], '#afba9f', 'cone');
    add([0, 2.18, 0], [.44, .43, .29], '#e9e5d9', 'cone');
  } else if (f === 'river' || f === 'ribbon') {
    add([0, .04, 0], [2, 1, 2.3], c, 'river');
    for (let i = 0; i < 4; i++) { const z = -.9 + i * .6; add([Math.sin(z / 2.3 * 2.6) * .48, .079, z], [.16, .008, .035], '#bad2d0', 'sphere', [0, .15, 0], 'ripple'); }
  } else if (f === 'lake') {
    add([0, .035, 0], [2.4, .06, 1.4]);
    for (let i = 0; i < 4; i++) add([-.7 + i * .45, .105, Math.sin(i) * .5], [.36, .012, .04], '#c1d6d0', 'sphere', [0, -.3, 0], 'ripple');
  } else if (f === 'rain' || f === 'snow') {
    for (let i = 0; i < 18; i++) add([Math.sin(i * 12.8) * 1.65, (i % 5) * .48, Math.cos(i * 6.7) * .85], f === 'rain' ? [.025, .15, .025] : [.055, .055, .055], c, 'sphere', [0, 0, -.15], 'drop');
  } else if (f === 'tree') {
    add([0, .65, 0], [.15, .7, .15], '#9a7b5f', 'cylinder');
    add([0, 1.56, 0], [.65, .68, .54]); add([-.45, 1.35, .05], [.43, .45, .42]); add([.44, 1.42, 0], [.46, .53, .39]);
  } else if (f === 'flower') {
    add([0, .6, 0], [.055, .6, .055], '#8b9e76'); add([-.2, .55, 0], [.26, .09, .13], '#9cae82', 'sphere', [0, 0, .4]);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; add([Math.sin(a) * .32, 1.26 + Math.cos(a) * .32, 0], [.24, .24, .1]); }
    add([0, 1.26, .08], [.22, .22, .12], '#dfbc65');
  } else if (f === 'grass') {
    add([0, .035, 0], [2.4, .08, 1.65]);
    for (let i = 0; i < 12; i++) add([Math.sin(i * 4.8) * 1.8, .16, Math.cos(i * 7.1) * 1.2], [.045, .18, .035], '#839569', 'cone', [0, 0, Math.sin(i) * .3]);
  } else if (f === 'ground') {
    add([0, -.03, 0], [2, .07, 1.4], e.color === 'natural' ? '#b9ac83' : c, 'box');
    for (let i = 0; i < 7; i++) add([-1.65 + i * .55, .07, 0], [.06, .055, 1.25], '#98a476');
  } else if (f === 'mushroom') {
    add([0, .45, 0], [.22, .46, .2], cream); add([0, .95, 0], [.68, .36, .61]);
    for (let i = 0; i < 5; i++) add([Math.sin(i * 2) * .4, 1.18 - (i % 2) * .1, Math.cos(i * 2) * .3], [.1, .04, .1], cream);
  } else if (f === 'house' || f === 'castle' || f === 'tower') {
    add([0, f === 'tower' ? 1.1 : .6, 0], [f === 'tower' ? .35 : .65, f === 'tower' ? 1.05 : .6, .45], c, f === 'tower' ? 'cylinder' : 'box');
    add([0, f === 'tower' ? 2.2 : 1.46, 0], [f === 'tower' ? .5 : .91, .46, .67], '#b77963', 'cone');
    add([0, .34, .466], [.14, .3, .035], '#7d8273', 'box');
    for (const x of [-.35, .35]) add([x, .79, .46], [.11, .13, .025], '#e6c780', 'box');
    if (f === 'castle') for (const x of [-.75, .75]) { add([x, .85, .03], [.25, .9, .28], c, 'cylinder'); add([x, 1.92, .03], [.35, .4, .35], '#a77e72', 'cone'); }
    if (f === 'tower') add([0, 1.88, .34], [.21, .18, .025], '#e8c983', 'box');
  } else if (f === 'bridge') {
    for (const x of [-1.05, 1.05]) add([x, .45, 0], [.15, .45, .38], c, 'box');
    for (let i = 0; i < 9; i++) add([-1.2 + i * .3, .78 + Math.sin(i / 8 * Math.PI) * .22, 0], [.19, .09, .4], c, 'box');
  } else if (f === 'car') {
    add([0, .5, 0], [.95, .3, .47], c, 'box'); add([.05, .9, 0], [.49, .31, .4], c, 'box'); add([.1, 1, .397], [.33, .15, .015], '#bdc9bc', 'box');
    for (const x of [-.58, .58]) for (const z of [-.43, .43]) add([x, .27, z], [.24, .24, .13], '#535b56');
  } else if (f === 'boat') {
    add([0, .24, 0], [1, .25, .38]); add([0, 1, 0], [.045, .75, .045], '#9e8064'); add([.35, 1.05, 0], [.53, .65, .035], cream, 'cone', [0, 0, .15]);
  } else if (f === 'airplane' || f === 'rocket') {
    const rocket = f === 'rocket';
    add([0, .95, 0], rocket ? [.34, .9, .34] : [1, .25, .24]);
    if (rocket) { add([0, 1.8, 0], [.34, .4, .34], '#b98470', 'cone'); add([0, 1.2, .31], [.16, .16, .05], '#85a4aa'); }
    for (const side of [-1, 1]) add(rocket ? [side * .39, .3, 0] : [0, .95, side * .59], rocket ? [.22, .39, .15] : [.32, .06, .65], '#a9b9af', 'cone', rocket ? [0, 0, side * -.35] : [0, 0, Math.PI / 2]);
  } else if (f === 'person' || f === 'robot') {
    add([0, 1.56, 0], [.3, .33, .27], f === 'person' ? '#caa58a' : c, f === 'robot' ? 'box' : 'sphere'); add([0, .94, 0], [.34, .42, .24], c, f === 'robot' ? 'box' : 'sphere');
    for (const x of [-.18, .18]) limb(x, .32, 0, .11, .33, .12);
    for (const x of [-.46, .46]) limb(x, .94, 0, .1, .35, .1, 'arm'); eyes(1.6, .25, .12);
  } else if (f === 'heart') {
    for (const x of [-.26, .26]) add([x, .9, 0], [.42, .57, .24], c, 'sphere', [0, 0, -x * 1.6]);
  } else if (f === 'carrot') {
    add([0, .4, 0], [.17, .48, .17], c, 'cone', [0, 0, Math.PI]);
    for (const x of [-.1, 0, .1]) add([x, .97, 0], [.055, .2, .05], '#829970', 'sphere', [0, 0, -x * 2]);
  } else if (f === 'bone') {
    add([0, .2, 0], [.5, .1, .1]); for (const x of [-.4, .4]) for (const z of [-.1, .1]) add([x, .2, z], [.16, .13, .13]);
  } else {
    const shape = ['box', 'cone', 'cylinder', 'ring'].includes(f) ? f as Shape : 'sphere';
    add([0, .65, 0], [.65, .65, .55], c, shape);
    if (f === 'fruit') { add([0, 1.34, 0], [.05, .18, .045], '#827059'); add([.14, 1.38, 0], [.2, .06, .09], '#91a17a'); }
    if (f === 'rock') add([.4, .27, .16], [.35, .29, .34]);
  }
  if (e.detail === 'wings' && !['bird', 'duck', 'penguin', 'butterfly', 'airplane'].includes(f)) {
    for (const side of [-1, 1]) add([side * .65, 1.05, -.1], [.55, .28, .1], c, 'cone', [0, 0, side * -.6], 'wing');
  } else if (e.detail === 'arms' && !['robot', 'person'].includes(f)) {
    add([.68, 1.1, 0], [.13, .65, .13], c, 'cylinder', [0, 0, -.6], 'arm'); add([1.12, 1.35, 0], [.13, .5, .13], c, 'cylinder', [0, 0, .6], 'arm'); add([1.4, .97, 0], [.27, .19, .29], c, 'box');
  } else if (e.detail === 'horns' || e.detail === 'spines') {
    for (const side of [-1, 1]) add([side * .25, 2.02, -.02], [.11, .37, .1], '#c9b89a', 'cone', [0, 0, -side * .2]);
  } else if (e.detail === 'long_neck' && f !== 'horse') {
    add([0, 1.75, 0], [.14, .65, .15]); add([0, 2.35, .1], [.26, .24, .3]);
  } else if (e.detail === 'dome' && !['mushroom', 'turtle'].includes(f)) add([0, 1.35, 0], [.63, .3, .56]);
  return parts.slice(0, 28);
}
