const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const fixture = name => JSON.parse(fs.readFileSync(`test/fixtures/diagrams/architecture/${name}`,'utf8'));

test('architecture adapts compound graphs to available width while preserving all semantic content',async () => {
  const ELK = require('elkjs/lib/elk.bundled.js');
  const {layoutArchitecture,MIN_MAP_SCALE} = await import('../src/architecture/layout.mjs');
  for (const name of ['mcp.json','reviewed-mcp.json','uk-power.json']) {
    const data = fixture(name), original = structuredClone(data), elk = new ELK();
    const wide = await layoutArchitecture(data,elk,undefined,{width:3200});
    for (const width of [1600,1000,800]) {
      const narrow = await layoutArchitecture(data,elk,undefined,{width});
      assert.deepEqual(narrow.issues,[]);
      if(data.direction)assert.equal(narrow.mode,data.direction.toLowerCase(),'explicit direction remains authoritative at every width');
      else if(data.nodes.length>=10) {
        // Large diagrams retain useful geometry; the tested SVG camera fits
        // their complete overview and exposes 100% zoom instead of clipping.
        assert.ok(Number.isFinite(narrow.width)&&Number.isFinite(narrow.height));
      } else if (name==='uk-power.json' && width===800) {
        // The natural DOWN layout avoids the compact variant's 13k route length
        // at the cost of <20% overflow. That is an intentional quality tradeoff.
        assert.equal(narrow.mode,'down');
        assert.ok(narrow.width*MIN_MAP_SCALE <= width*1.2);
        const distance=narrow.edges.reduce((sum,e)=>sum+e.sections.reduce((n,ps)=>n+ps.slice(1).reduce((d,p,i)=>d+Math.abs(p[0]-ps[i][0])+Math.abs(p[1]-ps[i][1]),0),0),0);
        assert.ok(distance<10000,'retain the shorter routes instead of forcing compact stacking');
      } else assert.ok(narrow.width*MIN_MAP_SCALE <= width,`${name} must fit ${width}px at readable scale`);
      assert.deepEqual(narrow.data,original);
      assert.deepEqual(narrow.nodes.map(n=>n.id).sort(),wide.nodes.map(n=>n.id).sort());
      assert.deepEqual(narrow.groups.map(g=>g.id).sort(),wide.groups.map(g=>g.id).sort());
      assert.deepEqual(narrow.edges.map(e=>[e.id,e.from,e.to]).sort(),wide.edges.map(e=>[e.id,e.from,e.to]).sort());
      assert.ok(narrow.attempts<=5);
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
  assert.ok(['wrapped','down'].includes(narrow.mode)); assert.deepEqual(narrow.issues,[]);
  assert.ok(narrow.width*MIN_MAP_SCALE<=1000); assert.ok(narrow.height>wide.height*2);
  const restored = await layoutArchitecture(data,elk,undefined,{width:3600});
  assert.deepEqual(restored.nodes,wide.nodes); assert.deepEqual(restored.edges,wide.edges);
  const tiny = await layoutArchitecture(fixture('reviewed-mcp.json'),elk,undefined,{width:240});
  assert.deepEqual(tiny.issues,[]); assert.equal(tiny.nodes.length,fixture('reviewed-mcp.json').nodes.length);
  assert.ok(tiny.width*MIN_MAP_SCALE>240,'impossible fit retains readable geometry for local scrolling');
});

test('compound project architecture chooses short downward routes over wrapped detours',async () => {
  const ELK = require('elkjs/lib/elk.bundled.js');
  const {layoutArchitecture} = await import('../src/architecture/layout.mjs');
  const dir = 'test/fixtures/diagrams/architecture/';
  const data = JSON.parse(fs.readFileSync(`${dir}routing-input.json`,'utf8'));delete data.direction;
  const original = structuredClone(data);
  const baseline = JSON.parse(fs.readFileSync(`${dir}routing-baseline.json`,'utf8'));
  const lengths = l => l.edges.reduce((sum,e) => sum + e.sections.reduce((n,ps) => n + ps.slice(1).reduce((d,p,i) => d + Math.abs(p[0]-ps[i][0]) + Math.abs(p[1]-ps[i][1]),0),0),0);
  const bends = l => l.edges.reduce((sum,e) => sum + e.sections.reduce((n,ps) => n + Math.max(0,ps.length-2),0),0);
  const elk = new ELK();
  for (const width of [1600,1450,1248]) {
    const layout = await layoutArchitecture(data,elk,undefined,{width});
    assert.deepEqual(layout.issues,[],'frame-title entry paths must remain clear');
    assert.ok(lengths(layout) < baseline.totalLength*.5,'remove more than half of wrapped routing');
    assert.ok(bends(layout) < baseline.bends*.4,'remove most wrapped corners');
    assert.ok(layout.height < baseline.height,'do not trade the detours for a taller stacked graph');
    assert.deepEqual(layout.data,original);
    assert.equal(layout.nodes.length,data.nodes.length);
    assert.equal(layout.edges.length,data.edges.length);
  }
  const narrow = await layoutArchitecture(data,elk,undefined,{width:800});
  assert.deepEqual(narrow.issues,[]);
  const wide = await layoutArchitecture(data,elk,undefined,{width:3200});
  assert.equal(wide.mode,'right'); assert.equal(wide.attempts,1);
  assert.deepEqual(data,original,'direction and source stay semantic and unchanged');
});

test('downward frame titles reserve room for localized wrapping beside entry routes',async () => {
  const ELK = require('elkjs/lib/elk.bundled.js');
  const {layoutArchitecture} = await import('../src/architecture/layout.mjs');
  const data = JSON.parse(fs.readFileSync('test/fixtures/diagrams/architecture/routing-input.json','utf8'));
  const layout = await layoutArchitecture({...data,direction:'DOWN'},new ELK());
  assert.deepEqual(layout.issues,[]);
  const group = layout.groups.find(g=>g.id==='agentrt');
  assert.ok(group.titleLines.length>1,'mixed Chinese/English title wraps into its clear slot');
  assert.ok(group.titleRect.y+group.titleRect.height <= group.y+group.headerHeight-6);
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
