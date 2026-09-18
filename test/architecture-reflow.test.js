const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const fixture = name => JSON.parse(fs.readFileSync(`testcase/archify-local/2026-09-18/${name}`,'utf8'));

test('architecture adapts compound graphs to available width while preserving all semantic content',async () => {
  const ELK = require('elkjs/lib/elk.bundled.js');
  const {layoutArchitecture,MIN_MAP_SCALE} = await import('../src/architecture/layout.mjs');
  for (const name of ['mcp.semantic.json','glm-json-reviewed/response.json','uk-power-regression.json']) {
    const data = fixture(name), original = structuredClone(data), elk = new ELK();
    const wide = await layoutArchitecture(data,elk,undefined,{width:3200});
    for (const width of [1600,1000,800]) {
      const narrow = await layoutArchitecture(data,elk,undefined,{width});
      assert.deepEqual(narrow.issues,[]);
      assert.ok(narrow.width*MIN_MAP_SCALE <= width,`${name} must fit ${width}px at readable scale`);
      assert.deepEqual(narrow.data,original);
      assert.deepEqual(narrow.nodes.map(n=>n.id).sort(),wide.nodes.map(n=>n.id).sort());
      assert.deepEqual(narrow.groups.map(g=>g.id).sort(),wide.groups.map(g=>g.id).sort());
      assert.deepEqual(narrow.edges.map(e=>[e.id,e.from,e.to]).sort(),wide.edges.map(e=>[e.id,e.from,e.to]).sort());
      assert.ok(narrow.attempts<=4);
    }
    assert.deepEqual(data,original,'layout must not write computed direction or geometry into JSON');
  }
});

test('a long call chain wraps into rows, then returns deterministically to wide layout',async () => {
  const ELK = require('elkjs/lib/elk.bundled.js'), {layoutArchitecture,MIN_MAP_SCALE} = await import('../src/architecture/layout.mjs');
  const data = {version:1,title:'Request chain',nodes:Array.from({length:12},(_,i)=>({id:`n${i}`,label:`Service ${i}`})),
    edges:Array.from({length:11},(_,i)=>({from:`n${i}`,to:`n${i+1}`,label:'Call'}))};
  const elk = new ELK(), wide = await layoutArchitecture(data,elk,undefined,{width:3600});
  const narrow = await layoutArchitecture(data,elk,undefined,{width:1000});
  assert.equal(narrow.mode,'wrapped'); assert.deepEqual(narrow.issues,[]);
  assert.ok(narrow.width*MIN_MAP_SCALE<=1000); assert.ok(narrow.height>wide.height*2);
  const restored = await layoutArchitecture(data,elk,undefined,{width:3600});
  assert.deepEqual(restored.nodes,wide.nodes); assert.deepEqual(restored.edges,wide.edges);
  const tiny = await layoutArchitecture(fixture('glm-json-reviewed/response.json'),elk,undefined,{width:240});
  assert.deepEqual(tiny.issues,[]); assert.equal(tiny.nodes.length,fixture('glm-json-reviewed/response.json').nodes.length);
  assert.ok(tiny.width*MIN_MAP_SCALE>240,'impossible fit retains readable geometry for local scrolling');
});

test('reflow coalesces resize bursts, ignores unchanged width/hidden views, and reuses previous widths',async () => {
  const {createReflow} = await import('../src/architecture/reflow.mjs');
  const calls=[],commits=[],errors=[];
  const state=createReflow({compute:async width=>{calls.push(width);return {width};},commit:layout=>commits.push(layout.width),report:error=>errors.push(error),delay:10000});
  state.request(1600);state.request(1000);state.request(800);
  await state.whenSettled(); assert.deepEqual(calls,[800]);
  state.request(807);await state.whenSettled();assert.deepEqual(calls,[800]);
  state.request(1200);await state.whenSettled();
  state.request(0);await state.whenSettled();
  state.request(800);await state.whenSettled();
  assert.deepEqual(calls,[800,1200]);assert.deepEqual(commits,[800,1200,800]);assert.deepEqual(errors,[]);
  state.dispose();state.request(960);await state.whenSettled();assert.equal(calls.length,2);
});

test('stale layout completions cannot overwrite a newer width or a disposed document',async () => {
  const {createReflow} = await import('../src/architecture/reflow.mjs');
  const pending=[],commits=[],errors=[];
  const state=createReflow({compute:(width,signal)=>new Promise(resolve=>pending.push({width,signal,resolve})),commit:l=>commits.push(l.width),report:e=>errors.push(e)});
  state.request(1600,true);state.request(800,true);
  assert.equal(pending[0].signal.aborted,true);
  pending[1].resolve({width:800});await state.whenSettled();
  pending[0].resolve({width:1600});await Promise.resolve();await Promise.resolve();
  assert.deepEqual(commits,[800]);assert.deepEqual(errors,[]);
  state.request(960,true);state.dispose();assert.equal(pending[2].signal.aborted,true);
  pending[2].resolve({width:960});await Promise.resolve();assert.deepEqual(commits,[800]);
});

test('multiple diagrams serialize computation and recovery after one failed job',async () => {
  const {createReflow,serialLayouts} = await import('../src/architecture/reflow.mjs');
  const enqueue=serialLayouts(),waiting=[],errors=[];let active=0,peak=0;
  const compute=width=>new Promise((resolve,reject)=>{peak=Math.max(peak,++active);waiting.push({done:(fail=false)=>{active--;fail?reject(Error('test failure')):resolve({width});}});});
  const one=createReflow({compute,enqueue,commit:()=>{},report:e=>errors.push(e)}),two=createReflow({compute,enqueue,commit:()=>{},report:e=>errors.push(e)});
  one.request(1600,true);two.request(800,true);await Promise.resolve();
  assert.equal(waiting.length,1);waiting[0].done(true);await one.whenSettled();
  await new Promise(setImmediate);assert.equal(waiting.length,2);
  waiting[1].done();await two.whenSettled();assert.equal(peak,1);assert.equal(errors.length,1);
  one.dispose();two.dispose();
});
