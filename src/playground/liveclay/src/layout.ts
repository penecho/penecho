import type { Entity, Vec, World } from './types';

export interface Placement { entity: Entity; key: string; p: Vec; s: number; }
const terrain = new Set(['mountain', 'river', 'lake', 'grass', 'ground']);
const sky = new Set(['sun', 'moon', 'star', 'cloud', 'rain', 'snow']);
export function layoutWorld(world: World): Placement[] {
  const entities = world.entities;
  const landscape = entities.some((e) => terrain.has(e.form) || ['house', 'tower', 'castle', 'bridge'].includes(e.form));
  const ground = entities.filter((e) => !terrain.has(e.form) && !sky.has(e.form));
  const assigned = new Map<string, Placement>();
  let landscapeIndex = 0, skyIndex = 0;
  for (const e of entities) {
    let p: Vec = [0, 0, 0];
    let s = landscape ? .76 : 1.2;
    if (e.form === 'mountain') { p = [landscapeIndex++ * 2 - .5, .1, -.9]; s = 1; }
    else if (e.form === 'river') { p = [.5, .02, 1]; s = 1.1; }
    else if (e.form === 'lake' || e.form === 'grass' || e.form === 'ground') { p = [0, -.05, .6]; s = 1.3; }
    else if (sky.has(e.form)) { p = [-1.4 + skyIndex++ * 2, e.form === 'cloud' ? 3.3 : 3.1, -1.1]; s = e.form === 'rain' || e.form === 'snow' ? 1.6 : .85; }
    else { const i = ground.indexOf(e); p = [(i - (ground.length - 1) / 2) * (landscape ? 1.7 : 2), 0, landscape ? .6 : 0]; }
    if (!landscape && entities.length === 1) s = sky.has(e.form) ? 1.4 : 1.45;
    if (entities.length === 1 && sky.has(e.form)) p = [0, 1.6, 0];
    if (e.scale === 'tiny') s *= .65;
    if (e.scale === 'large') s *= 1.35;
    assigned.set(e.id, { entity: e, key: e.label, p, s });
  }
  // Solve explicit relationships once per directed edge. Reciprocal descriptions
  // such as sun-rising/mountain-origin must not move both anchors in a cycle.
  const moved = new Set<string>();
  const donePairs = new Set<string>();
  const ordered = [...entities].sort((a, b) => Number(terrain.has(b.form)) - Number(terrain.has(a.form)));
  for (const e of ordered) {
    const item = assigned.get(e.id)!;
    const target = assigned.get(e.target);
    if (!target || e.relation === 'none' || e.relation === 'rise_origin') continue;
    const pair = [e.id, e.target].sort().join('|');
    if (donePairs.has(pair)) continue;
    // Fixed landscape geometry remains the anchor when another entity describes
    // the inverse relation. The other entity's edge expresses the same fact.
    if (terrain.has(e.form) && !terrain.has(target.entity.form) && target.entity.target === e.id) continue;
    if (e.form === 'mountain' && ['river', 'lake', 'grass', 'ground'].includes(target.entity.form)) continue;
    const [x, y, z] = target.p;
    switch (e.relation) {
      case 'rising': item.p = [x + .2, y + 2.1 * target.s, z - .8]; break;
      case 'above': item.p = [x, y + 2.3 * target.s, z]; break;
      case 'below':
        if (e.form === 'river' || e.form === 'lake') item.p = [x + .6, .03, z + 1.8];
        else if (sky.has(target.entity.form) || ['fly', 'rise'].includes(target.entity.motion)) { item.p = [x, 0, z]; }
        else item.p = [x, Math.max(0, y - 1.4), z + 1.4];
        break;
      case 'left': item.p = [x - 1.9 * target.s, y, z]; break;
      case 'right': item.p = [x + 1.9 * target.s, y, z]; break;
      case 'behind': item.p = [x, y, z - 1.8]; break;
      case 'front': item.p = [x, y, z + 1.6]; break;
      case 'on': item.p = [x, y + (target.entity.form === 'bridge' ? 1 : 1.65) * target.s, z]; item.s *= .72; break;
      case 'inside': item.p = [x, target.entity.form === 'lake' ? .08 : y + .3, z]; item.s *= .7; break;
      case 'near': item.p = [x + 1.7 * target.s, y, z + .2]; break;
      case 'eating':
        item.p = [0, 0, 0]; target.p = [.15 * item.s, .82 * item.s, .76 * item.s]; target.s = item.s * .5; moved.add(target.entity.id); break;
      case 'eaten_by': item.p = [x + .15 * target.s, y + .82 * target.s, z + .76 * target.s]; item.s = target.s * .5; break;
      case 'chasing': item.p = [x - 1.6, y, z]; break;
      case 'orbiting': item.p = [x + 1.6, y + 1, z]; break;
      case 'crossing': item.p = [x, y + .22, z]; break;
    }
    moved.add(e.id); donePairs.add(pair);
  }
  const placements = [...assigned.values()];
  const copies: Placement[] = [];
  for (const item of placements) {
    const n = item.entity.count === 'many' ? 3 : item.entity.count === 'two' ? 2 : 1;
    if (n > 1) {
      item.s *= .73;
      for (let i = 1; i < n; i++) copies.push({ ...item, key: `${item.key}#${i}`, p: [item.p[0] + i * item.s * 1.2, item.p[1], item.p[2] - i * .35] });
    }
  }
  return [...placements, ...copies];
}
