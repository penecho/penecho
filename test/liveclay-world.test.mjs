import test from 'node:test';
import assert from 'node:assert/strict';
import { fallingState, orbitState, orbitalParents, pendulumState, explicitPhysicsParameters } from '../src/playground/liveclay/shared/dynamics.mjs';
import { SPECS } from '../src/playground/liveclay/shared/blueprint.mjs';
import { buildBlueprint, buildCelestial } from '../src/playground/liveclay/src/blueprints.ts';
import { buildWorld } from '../src/playground/liveclay/server/world.mjs';
import { PlaybackState } from '../src/playground/liveclay/shared/playback.mjs';

test('free fall obeys h=h0−gt²/2; impact loses energy and never tunnels through floor', () => {
  const p = { height: 3, gravity: 9.81, restitution: .7 };
  const s = fallingState(.4, p);
  assert.ok(Math.abs(s.height - (3 - .5 * 9.81 * .16)) < 1e-10);
  assert.ok(Math.abs(s.velocity + 9.81 * .4) < 1e-10);
  const impact = Math.sqrt(6 / 9.81);
  assert.ok(Math.abs(fallingState(impact, p).velocity - Math.sqrt(6 * 9.81) * .7) < 1e-10);
  for (let t = 0; t < 20; t += .017) assert.ok(fallingState(t, p).height >= 0);
  assert.equal(fallingState(20, p).settled, true);
  assert.equal(fallingState(20, { ...p, gravity: 0 }).height, 3);
  assert.ok(fallingState(.5, { ...p, gravity: 1.62 }).height > fallingState(.5, p).height);
});
test('elliptical orbit satisfies Kepler equation and focus-centered ellipse, repeats exactly', () => {
  const p = { radius: 3, eccentricity: .45, period: 12 };
  for (let t = 0; t < 12; t += .2) {
    const s = orbitState(t, p), again = orbitState(t + 12, p);
    assert.ok(Math.abs(s.angle - .45 * Math.sin(s.angle) - t / 12 * 2 * Math.PI) < 1e-9);
    assert.ok(Math.abs(((s.x + 1.35) / 3) ** 2 + (s.z / (3 * Math.sqrt(1 - .45 ** 2))) ** 2 - 1) < 1e-9);
    assert.ok(Math.hypot(s.x - again.x, s.z - again.z) < 1e-9);
  }
});
test('orbital dependencies retain nested satellites and reject cycles or missing parents', () => {
  const e = (id, target) => ({ id, target, physics: { kind: 'orbit' } });
  assert.deepEqual([...orbitalParents([e('earth', 'sun'), {id:'sun'}, e('moon','earth')])], [['earth','sun'],['moon','earth']]);
  assert.equal(orbitalParents([e('a','b'),e('b','a'),e('x','x'),e('z','missing')]).size, 1);
});
test('pendulum length is invariant and zero gravity freezes its angle', () => {
  for (let t = 0; t < 10; t += .05) { const s = pendulumState(t); assert.ok(Math.abs(Math.hypot(s.x,s.y)-1.7)<1e-10); }
  assert.equal(pendulumState(3,0).angle,.35);
});
test('explicit physical units are parsed in code and bounded', () => {
  assert.deepEqual(explicitPhysicsParameters('小球从5米高处落下，重力加速度为3.7'), {height:5,gravity:3.7});
  assert.equal(explicitPhysicsParameters('从150厘米高处释放').height,1.5);
  assert.equal(explicitPhysicsParameters('高度100000米高').height,10);
  assert.equal(explicitPhysicsParameters('周期为6秒').period,6);
});
test('all structural families and every single-option variation compile finite, bounded, identified geometry', () => {
  for (const [family, spec] of Object.entries(SPECS)) {
    const defaults = Object.fromEntries(Object.entries(spec).map(([k,v])=>[k,Object.keys(v)[0]]));
    for (const [key, choices] of Object.entries(spec)) for (const val of Object.keys(choices)) {
      const parts = buildBlueprint({color:'natural',motion:'still',blueprint:{family,params:{...defaults,[key]:val}}});
      assert.ok(parts.length > 0 && parts.length < 140, family);
      assert.equal(new Set(parts.map(p=>p.id)).size,parts.length);
      for (const p of parts) {
        assert.ok([...p.p,...p.s,...(p.r || []),...(p.path || []).flat()].every(Number.isFinite),family);
        assert.ok(p.s.every(v=>v>0 && v<5),family);
      }
    }
  }
});
test('mechanical link chain shares endpoints, vessel spout remains substantial, globe surface is bounded', () => {
  const params={base:'block',locomotion:'tracks',cabin:'enclosed',boom:'articulated',tool:'bucket',rotor:'none',cargo:'none'};
  const machine=buildBlueprint({color:'yellow',motion:'still',blueprint:{family:'mechanism',params}});
  const boom=machine.find(p=>p.id.startsWith('boom:')), stick=machine.find(p=>p.id.startsWith('stick:'));
  assert.deepEqual(boom.path.at(-1),stick.path[0]);
  const pot=buildBlueprint({color:'blue',blueprint:{family:'vessel',params:{body:'round',handle:'one',spout:'curved',lid:'yes',neck:'short'}}});
  assert.ok(pot.find(p=>p.id.startsWith('spout:')).radius >= .2);
  const globe=buildCelestial({form:'planet',color:'natural'});
  assert.ok(globe.length>20); assert.ok(globe.every(p=>p.p.every(Number.isFinite)));
});
const mockAnswers = q => Object.fromEntries(Object.entries(q).map(([k,v]) => {const choice=Object.keys(v.criteria)[0];return[k,{choice,confidence:1,probabilities:{[choice]:1}}];}));
test('empty world uses no model; complete structural plan uses exactly three batches and absorbs components', async () => {
  assert.equal((await buildWorld(' ')).meta.calls,0);
  let call=0;
  const callJev=async (text,q) => {
    call++; const a=mockAnswers(q);
    if(call===1) for(const [key,v] of Object.entries(q)) { const span=v.instructions.match(/«(.*?)»/)[1];const choice=['椅子','扶手'].includes(span)?'entity':'fragment';a[key]={choice,probabilities:{entity:choice==='entity'?1:0}}; }
    if(call===2) {
      for(const key of Object.keys(a)) {
        if(key.endsWith('_family')) a[key].choice='furniture';
        if(key.endsWith('_ownership')) a[key].choice=q[key].instructions.includes('«扶手»')?'part:e1':'independent';
        if(key.endsWith('_form')) a[key].choice='box';
      }
    }
    return {answers:a};
  };
  const result=await buildWorld('带扶手的椅子',undefined,()=>{},{callJev});
  assert.equal(result.meta.calls,3);assert.equal(result.world.entities.length,1);assert.equal(result.world.entities[0].label,'椅子');
  assert.equal(result.world.entities[0].blueprint.family,'furniture');
});
test('cancelled decisions cannot publish a stale scene or proceed to another batch', async () => {
  const controller=new AbortController();let calls=0;
  await assert.rejects(buildWorld('小猫',controller.signal,()=>{throw new Error('stale event');},{callJev:async(text,q)=>{calls++;controller.abort();return{answers:mockAnswers(q)};}}),{name:'AbortError'});
  assert.equal(calls,1);
});
const physicalWorld = (kind, color = 'red') => ({engine:'world',entities:[{label:kind,color,physics:{kind}}]});
test('timeline pause survives same-scene edits but not a new experiment or empty clay', () => {
  const state=new PlaybackState();
  state.setWorld(physicalWorld('orbit'));state.setPaused(true);
  assert.equal(state.setWorld(physicalWorld('orbit','blue')).paused,true);
  assert.equal(state.setWorld(physicalWorld('drop')).paused,false);
  state.setPaused(true);assert.equal(state.setWorld({entities:[]}).paused,false);
});
test('explicit global pause and reduced-motion preference survive scene transitions', () => {
  const state=new PlaybackState();state.setWorld(physicalWorld('orbit'));state.toggleGlobal();
  assert.equal(state.setWorld(physicalWorld('drop')).paused,true);
  assert.equal(state.setWorld({entities:[]}).paused,true);
  state.toggleGlobal();assert.equal(state.setWorld(physicalWorld('drop')).paused,false);
  state.setReduced(true);assert.equal(state.setWorld(physicalWorld('orbit'),true).paused,true);
  assert.equal(state.setWorld({entities:[]},true).paused,true);
  state.setReduced(false);assert.equal(state.paused,false);
});
