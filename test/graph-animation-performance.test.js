"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const SMART=require("../public/smart-suggest.js"),html=SMART.graphWidgetHtml({expressions:["z=a*sin(x)*cos(y)"],mode:"3d"}),
  scheduler=html.slice(html.indexOf("    let animationFrame="),html.indexOf("    function nice("));
function playback() {
  const queue=new Map(),state={params:{a:1},anim:{name:"a",min:-4,max:6,dir:1,last:0,r:{},out:{}}};
  let sequence=0,updates=0;
  const context=vm.createContext({state,requestAnimationFrame(callback){queue.set(++sequence,callback);return sequence;},
    setParameter(name,value){state.params[name]=value;updates++;},fmt:String});
  vm.runInContext(scheduler,context);
  const frame=now=>{const callbacks=[...queue.values()];queue.clear();callbacks.forEach(callback=>callback(now));};
  return {context,state,queue,frame,updates:()=>updates};
}
test("parameter playback keeps one callback through pause/restart and parameter switching",()=>{
  const p=playback();
  for(let i=0;i<20;i++)p.context.scheduleTick();assert.equal(p.queue.size,1);
  p.frame(100);p.frame(134);assert.equal(p.updates(),1);assert.equal(p.queue.size,1);
  p.state.anim=null;p.context.scheduleTick();
  p.state.anim={name:"a",min:-4,max:6,dir:1,last:0,r:{},out:{}};p.context.scheduleTick();
  assert.equal(p.queue.size,1);p.frame(168);assert.equal(p.queue.size,1);
  p.state.anim=null;p.frame(200);assert.equal(p.queue.size,0);assert.equal(p.updates(),1);
});
test("playback speed is independent of display refresh and expensive frames",()=>{
  for(const hz of [20,30,60,120]) {
    const p=playback();p.context.scheduleTick();
    for(let i=0;i<=hz;i++)p.frame(100+i*1000/hz);
    assert.ok(Math.abs(p.state.params.a-3.5)<1e-10,`${hz} Hz: ${p.state.params.a}`);
    assert.ok(p.updates()<=30,`${hz} Hz must not render more than 30 frames`);
  }
});
test("animation reflects at slider limits and bounds jumps after a background pause",()=>{
  const p=playback();p.state.params.a=5.99;p.context.scheduleTick();p.frame(100);p.frame(200);
  assert.ok(Math.abs(p.state.params.a-5.76)<1e-10);assert.equal(p.state.anim.dir,-1);
  p.frame(10200);assert.ok(Math.abs(p.state.params.a-5.51)<1e-10);
});
test("previous saved native graphs receive the complete scheduler/cache/snapshot repair",()=>{
  const fixture=fs.readFileSync(path.join(__dirname,"fixtures/graph-v2-before-interactions.html"),"utf8"),
    original=fixture.replace("</style>","/* custom appearance */.badge{color:tomato}</style>"),upgraded=SMART.upgradeGraphWidgetHtml(original);
  assert.ok(upgraded.includes(scheduler));
  assert.ok(upgraded.includes("JSON.stringify([R,...r.names.map(name=>state.params[name])])"));
  assert.ok(upgraded.includes("surfaceSnapshot=true;draw()"));
  assert.ok(upgraded.includes("restoreSurface?.()"));
  assert.ok(upgraded.includes("/* custom appearance */.badge{color:tomato}"));
  assert.deepEqual(SMART.graphDocumentData(upgraded),SMART.graphDocumentData(original));
  assert.equal(SMART.upgradeGraphWidgetHtml(upgraded),upgraded);
  new Function(upgraded.slice(upgraded.indexOf("<script>")+8,upgraded.lastIndexOf("</script>")));
});
