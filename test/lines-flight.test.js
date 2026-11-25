"use strict";
require("./helpers/safety.js");
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../public/lines/line.js"), "utf8");
function harness() {
  let now = 0, next = 0, refreshed = 0;
  const frames = new Map(), roots = [];
  const node = tag => ({ tag, attrs:{}, children:[], style:{}, setAttribute(k,v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, append(el) { this.children.push(el); }, remove() { this.removed = true; } });
  const c = vm.createContext({ S:{}, performance:{ now:() => now }, requestAnimationFrame:fn => { frames.set(++next,fn); return next; }, cancelAnimationFrame:id => frames.delete(id),
    document:{ createElementNS:(_,tag) => node(tag), body:{ append:el => roots.push(el) }, querySelectorAll:() => [] },
    clamp:(v,a,b) => Math.max(a,Math.min(b,v)), currentStation:l => l.stations[1], isEnd:s => s.kind === "end",
    refreshAfterChange:() => refreshed++, getComputedStyle:el => ({ fontSize:el.fontSize || "18px" }), setTimeout, clearTimeout,
  });
  vm.runInContext(source.slice(source.indexOf("const centerOf ="), source.indexOf("// ---------- Draw on any Markdown")), c);
  return { c, roots, frames, node, run:s => vm.runInContext(s,c), tick(t) { now=t; const jobs=[...frames.values()]; frames.clear(); jobs.forEach(fn=>fn(t)); }, get refreshed() { return refreshed; } };
}
const plain = x => JSON.parse(JSON.stringify(x));
const close = (a,b,epsilon=1e-8) => assert.ok(Math.abs(a-b)<epsilon, `${a} != ${b}`);
const stations = Array.from({length:7}, (_,i)=>({ id:String(i), kind:i%2 ? "work" : "ask", state:i<3 ? "done" : "todo" }));
const line = { id:"line", stations };
const home = { stops:{ 2:{x:100,y:300,r:5}, 3:{x:250,y:300,r:8}, 5:{x:500,y:300,r:5} }, first:{x:100,y:300,r:5}, fork:{x:50,y:300}, weight:2 };
const page = { stops:Object.fromEntries(stations.map((s,i)=>[s.id,{x:30,y:70+i*60,r:i<6?7:0}])), first:{x:30,y:70,r:7}, fork:{x:30,y:50}, weight:3 };

test("hidden prefix, interior and todo suffix retain their order on the Home track", () => {
  const h=harness(); h.c.line=line; h.c.home=home;
  const points=plain(h.run("flightStops(line,home)"));
  assert.deepEqual(points.map(p=>p.x), [100,100,100,250,375,500,500]);
  assert.ok(points.every(p=>p.y===300));
  assert.deepEqual(points.map(p=>p.r), [0,0,5,8,0,5,0]);
});

test("curve joins have matching derivatives and stay inside each segment, including repeated stops", () => {
  const h=harness();
  for(const k of [0,.1,.25,.5,.75,.9,1]) {
    const p=[home.fork,...stations.map(s=>home.stops[s.id]||home.first)].map((a,i)=>({x:a.x*(1-k)+(i?30:page.fork.x)*k,y:a.y*(1-k)+(i?70+(i-1)*60:page.fork.y)*k}));
    // Include collapsed/repeated points without leaving a special case to the SVG renderer.
    p.splice(2,0,{...p[1]}); h.c.points=p;
    const curves=plain(h.run("flightCurve(points)")).map(s=>s.slice(1).trim().split(/[ ,]+/).map(Number));
    curves.forEach((v,i)=>{
      assert.ok(v.every(Number.isFinite)); assert.deepEqual(v.slice(4),[p[i+1].x,p[i+1].y]);
      for(const [axis,j] of [["x",0],["y",1]]) {
        const min=Math.min(p[i][axis],p[i+1][axis])-1e-8,max=Math.max(p[i][axis],p[i+1][axis])+1e-8;
        assert.ok(v[j]>=min && v[j]<=max && v[j+2]>=min && v[j+2]<=max);
        if(i) close(p[i][axis]-curves[i-1][j+2],v[j]-p[i][axis]);
      }
    });
  }
});

function start(h, from=home, to=page, title) { Object.assign(h.c,{line,from,to,title}); h.run("flyLine(line,from,to,{title})"); return h.roots.at(-1); }
test("the first frame matches Home, nodes share one easing, and SVG elements are reused", () => {
  const h=harness(), svg=start(h), children=[...svg.children];
  const initial=plain(h.c.S.flightSnapshot());
  close(initial.fork.y,300); close(initial.stops["2"].x,100);
  assert.ok(svg.children[0].attrs.d.startsWith("M50,300C"));
  for(const ms of [16,50,100,240,440]) {
    h.tick(ms); const snapshot=h.c.S.flightSnapshot(),k=ms/520*(ms/520)*(3-2*ms/520);
    stations.filter(s=>snapshot.stops[s.id]).forEach(s=>{const a=initial.stops[s.id],b=page.stops[s.id],q=snapshot.stops[s.id];close(q.x,a.x+(b.x-a.x)*k);close(q.y,a.y+(b.y-a.y)*k);});
    assert.deepEqual(svg.children,children);
  }
  assert.ok(h.run("easeBoth(100/520)")>.09);
  h.tick(520); assert.equal(svg.removed,true); assert.equal(h.c.S.flying,false); assert.equal(h.c.S.flightSnapshot,null); assert.equal(h.frames.size,0);
});

test("same-line reversal starts from the displayed geometry without a snap", () => {
  for(const ms of [80,240,440]) {
    const h=harness(); start(h); h.tick(ms); const previous=plain(h.c.S.flightSnapshot());
    h.run("endFlight()"); const svg=start(h,previous,home),next=plain(h.c.S.flightSnapshot());
    assert.deepEqual(next.stops,previous.stops); assert.deepEqual(next.fork,previous.fork); close(next.weight,previous.weight);
    h.tick(ms+520); assert.equal(svg.removed,true); assert.equal(h.frames.size,0);
  }
});

test("title follows the line clock and interruption restores visibility and cancels work", () => {
  const h=harness(), target={style:{},getBoundingClientRect:()=>({toJSON:()=>({left:40,top:40,width:120,height:24})})};
  const title={effect:{target},currentTime:0}; h.c.target=target; h.run("hideForFlight(target)");
  const svg=start(h,home,page,title); h.tick(260); close(title.currentTime,260); assert.equal(target.style.visibility,"hidden");
  h.c.S.flyMissed=true; h.run("endFlight(); endFlight();");
  assert.equal(svg.removed,true); assert.equal(target.style.visibility,undefined); assert.equal(h.frames.size,0); assert.equal(h.refreshed,1);
});

test("reduced motion bypasses both entry points before measuring or cloning", () => {
  const h=harness(); h.c.reducedMotion=()=>true;
  assert.equal(h.run("flightToLine('line')"),null); assert.equal(h.run("flightToHome('line')"),null); assert.equal(h.roots.length,0);
});
