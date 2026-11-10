import { candidatesFromText, extractionQuestions, extractEntities, worldQuestions, worldFromAnswers } from './planner.mjs';
import { FAMILIES, blueprintQuestions, blueprintFromAnswers } from '../shared/blueprint.mjs';
import { EMPTY_WORLD } from '../shared/scene.mjs';
import { callJev } from './jev.mjs';
import { explicitPhysicsParameters, orbitalParents } from '../shared/dynamics.mjs';

const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
// Cached programs are offered back to JEV for reuse, never applied by a noun
// keyword heuristic. Appearance edits invalidate reuse; motion/color edits do not.
const programs = new Map();
export async function buildWorld(text, signal, emit = () => {}, options = {}) {
  const started = performance.now(), invoke = options.callJev || callJev;
  let calls = 0, questions = 0;
  const ask = async (state, q) => { signal?.throwIfAborted(); calls++; questions += Object.keys(q).length; const r = await invoke(state, q, signal); signal?.throwIfAborted(); return r.answers; };
  const meta = () => ({ model: 'jev-1.13.0', engine: 'world', calls, questions, latencyMs: Math.round(performance.now() - started) });
  if (!text.trim()) return { world: { ...EMPTY_WORLD, engine: 'world' }, meta: meta() };
  const candidates = candidatesFromText(text), eq = extractionQuestions(candidates);
  for (const q of Object.values(eq)) q.criteria.fragment += ' Generic description words such as 结构、模型、装置、物理、动画、自由落体 and motion paths such as 轨道、椭圆轨道、抛物线 are not separate solid entities. 地球 and 月球 are complete compound nouns; 球 inside them is an incomplete fragment.';
  const entities = extractEntities(candidates, await ask(text, eq));
  emit({ type: 'entities', labels: entities.map(e => e.label) });
  if (!entities.length) return { world: { ...EMPTY_WORLD, engine: 'world' }, meta: meta() };
  const q = worldQuestions(entities);
  q.domain = choice('Is this scene a physical demonstration, anatomical illustration, or ordinary artistic scene?', { art: 'Ordinary artistic scene', physics: 'Physics experiment, gravitation, planetary orbit, falling ball, pendulum or mechanical motion', anatomy: 'Medical or anatomical illustration' });
  for (const e of entities) {
    const focus = `For «${e.label}» in this description. `;
    q[`${e.id}_ownership`] = choice(focus + 'Is this a separate scene object, or a structural part of another object? Attached handles, tripod stands, leaves and flowers belonging to a plant are built INSIDE their owner. Independent actors, food, terrain, and celestial bodies remain separate.', {
      independent: 'An independent object or actor, not an intrinsic/attached component of another listed object',
      ...Object.fromEntries(entities.filter(o => o.id !== e.id).map(o => [`part:${o.id}`, `«${e.label}» is an attached structural component of «${o.label}».`])),
    });
    q[`${e.id}_family`] = choice(focus + 'Choose the construction family that preserves its distinctive silhouette. Prefer a specific structural family over an unrelated existing form.', FAMILIES);
    q[`${e.id}_physics`] = choice(focus + 'Which physical motion is requested for THIS object? Use none when no such motion is requested.', { none: 'No physics motion; normal scene animation', drop: 'Released from rest, falls under gravity / 自由落体、落下', bounce: 'Falls and rebounds from the ground / 弹跳、落地反弹', orbit: 'Orbits another named object / 公转、围绕', pendulum: 'Swings on a fixed-length string / 单摆、钟摆', spin: 'Spins about its own axis / 自转' });
    q[`${e.id}_gravity`] = choice(focus + 'What gravity environment is explicitly requested? Default earth.', { earth: 'Earth gravity or unspecified', moon: 'Explicit lunar gravity', low: 'Low gravity', zero: 'Zero gravity' });
    q[`${e.id}_speed`] = choice(focus + 'Requested animation speed? Default normal.', { slow: 'Slow motion', normal: 'Normal or unspecified', fast: 'Fast' });
    q[`${e.id}_orbit_shape`] = choice(focus + 'Requested orbital shape? Default circular.', { circular: 'Circular or unspecified', elliptical: 'Explicitly elliptical / 椭圆' });
    const old = programs.get(e.label);
    if (old) q[`${e.id}_reuse`] = choice(focus + `Previous appearance: ${JSON.stringify(old.blueprint)}. Previous description: ${old.text}. Can this EXACT geometry still represent this object? Ignore changes only to color, position or motion.`, { yes: 'Same appearance and structural features', no: 'Appearance/structure changed, or uncertain' });
  }
  const a = await ask(text, q);
  const world = worldFromAnswers(entities, a);
  world.engine = 'world'; world.domain = a.domain.choice;
  const owned = new Set();
  // Only accept ownership by a retained independent parent. Mutual ownership
  // cannot delete both objects; identity and graph checks belong to code.
  for (const e of world.entities) {
    const owner = a[`${e.id}_ownership`].choice.split(':')[1];
    if (owner && a[`${owner}_ownership`]?.choice === 'independent') owned.add(e.id);
  }
  world.entities = world.entities.filter(e => !owned.has(e.id));
  for (const e of world.entities) {
    if (owned.has(e.target)) { e.target = 'none'; e.relation = 'none'; }
    e.family = a[`${e.id}_family`].choice;
    e.physics = { kind: a[`${e.id}_physics`].choice, gravity: { earth: 9.81, moon: 1.62, low: 3, zero: 0 }[a[`${e.id}_gravity`].choice], speed: { slow: .5, normal: 1, fast: 1.8 }[a[`${e.id}_speed`].choice], eccentricity: a[`${e.id}_orbit_shape`].choice === 'elliptical' ? .45 : 0, height: 3, restitution: a[`${e.id}_physics`].choice === 'bounce' ? .72 : .18, period: 12 };
    if (e.physics.kind === 'orbit' && e.target !== 'none') e.relation = 'orbiting';
    if (e.form === 'moon' && e.physics.kind === 'orbit') e.form = 'satellite';
    if (e.family === 'pendulum') e.physics.kind = e.physics.kind === 'none' && e.motion === 'still' ? 'none' : 'pendulum';
    if (a[`${e.id}_reuse`]?.choice === 'yes' && programs.get(e.label)?.blueprint.family === e.family) e.blueprint = structuredClone(programs.get(e.label).blueprint);
    if (e.family === 'classic') delete e.blueprint;
  }
  const fresh = world.entities.filter(e => e.family !== 'classic' && !e.blueprint);
  if (fresh.length) {
    const details = await ask(text, blueprintQuestions(fresh));
    for (const e of fresh) e.blueprint = blueprintFromAnswers(e, details);
  }
  for (const e of world.entities) if (e.blueprint && !options.callJev) {
    programs.set(e.label, { text, blueprint: structuredClone(e.blueprint) });
    if (programs.size > 96) programs.delete(programs.keys().next().value);
  }
  const explicit = explicitPhysicsParameters(text), parents = orbitalParents(world.entities);
  const falling = world.entities.filter(e => ['drop', 'bounce'].includes(e.physics.kind));
  const orbiting = world.entities.filter(e => e.physics.kind === 'orbit');
  for (const e of world.entities) {
    if (falling.length === 1 && falling[0] === e && explicit.height !== undefined) e.physics.height = explicit.height;
    if (explicit.gravity !== undefined && ['drop', 'bounce', 'pendulum'].includes(e.physics.kind)) e.physics.gravity = explicit.gravity;
    if (e.physics.kind === 'orbit') {
      if (parents.has(e.target)) e.physics.period = 4;
      if (orbiting.length === 1 && explicit.period !== undefined) e.physics.period = explicit.period;
    }
  }
  world.abstract = world.entities.some(e => e.family === 'assembly' || (e.family === 'classic' && ['sphere', 'box', 'cone', 'cylinder', 'ribbon', 'ring', 'creature'].includes(e.form)));
  return { world, meta: meta() };
}
