// Analytic trajectories are independent of frame rate and support exact seeking.
// Distance unit = metre for falling bodies. Orbit scale is deliberately illustrative.
export function fallingState(time, { height = 3, gravity = 9.81, restitution = .72 } = {}) {
  let t = Math.max(0, time), h = Math.max(0, height), g = Math.max(0, gravity), e = Math.max(0, Math.min(.98, restitution));
  if (!g) return { height: h, velocity: 0, impacts: 0, settled: false };
  const first = Math.sqrt(2 * h / g);
  if (t < first) return { height: h - .5 * g * t * t, velocity: -g * t, impacts: 0, settled: false };
  t -= first;
  let v = Math.sqrt(2 * g * h) * e, impacts = 1;
  while (v > .04 && impacts < 300) {
    const duration = 2 * v / g;
    if (t < duration) return { height: Math.max(0, v * t - .5 * g * t * t), velocity: v - g * t, impacts, settled: false };
    t -= duration; v *= e; impacts++;
  }
  return { height: 0, velocity: 0, impacts, settled: true };
}
export function orbitState(time, { radius = 2.4, eccentricity = 0, period = 12, phase = 0 } = {}) {
  const e = Math.max(0, Math.min(.75, eccentricity));
  const M = ((time / Math.max(.1, period) * Math.PI * 2 + phase) % (2 * Math.PI) + Math.PI * 2) % (2 * Math.PI);
  let E = M;
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return { x: radius * (Math.cos(E) - e), z: radius * Math.sqrt(1 - e * e) * Math.sin(E), angle: E, radius: radius * (1 - e * Math.cos(E)) };
}
export function pendulumState(time, gravity = 9.81, length = 1.7, amplitude = .35) {
  const omega = Math.sqrt(Math.max(0, gravity) / length), angle = amplitude * Math.cos(omega * time);
  return { angle, x: Math.sin(angle) * length, y: -Math.cos(angle) * length, period: gravity > 0 ? Math.PI * 2 / omega : Infinity };
}
export function explicitPhysicsParameters(text) {
  const result = {};
  const height = text.match(/(?:从|高度(?:为|是)?|高为?)\s*(\d+(?:\.\d+)?)\s*(米|m|厘米|cm)(?:高|处|落|释放|下|\b|$)/iu);
  const gravity = text.match(/(?:重力加速度(?:为|是)?|g\s*=)\s*(\d+(?:\.\d+)?)/iu);
  const period = text.match(/(?:公转)?周期(?:为|是)?\s*(\d+(?:\.\d+)?)\s*(?:秒|s)/iu);
  if (height) result.height = Math.max(.1, Math.min(10, Number(height[1]) * (['cm', '厘米'].includes(height[2].toLowerCase()) ? .01 : 1)));
  if (gravity) result.gravity = Math.max(0, Math.min(30, Number(gravity[1])));
  if (period) result.period = Math.max(1, Math.min(60, Number(period[1])));
  return result;
}

// Break self/cyclic orbit dependencies once. A nested satellite follows the
// instantaneous world position of its parent, not the original layout anchor.
export function orbitalParents(entities) {
  const ids = new Set(entities.map(e => e.id)), parents = new Map();
  for (const e of entities) if (e.physics?.kind === 'orbit' && e.target !== e.id && ids.has(e.target)) {
    let next = e.target, cyclic = false;
    const seen = new Set([e.id]);
    while (next) { if (seen.has(next)) { cyclic = true; break; } seen.add(next); next = parents.get(next); }
    if (!cyclic) parents.set(e.id, e.target);
  }
  return parents;
}
