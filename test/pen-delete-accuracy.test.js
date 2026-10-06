"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const PEN = require("../public/pen-intel.js");
const record = (id, points, at = 0) => ({ id, points, at, size:4, box:PEN.bounds(points) });
const word = record(1, [{x:50,y:30},{x:50,y:90},{x:65,y:30},{x:80,y:90},{x:95,y:30},{x:110,y:90}]);
const line = (y = 60) => [{x:30,y},{x:130,y}];
function classify(points, strokes = [word]) {
  return PEN.classifyGestureStroke(points, { size:4, now:2000, strokes, contentBoxes:strokes.map(s => ({...s.box, at:s.at, stroke:true})) });
}
function fn(name) {
  const source = fs.readFileSync(require.resolve("../src/client/app/pen-intelligence.js"), "utf8"), start = source.search(new RegExp(`  (?:async )?function ${name}\\(`)), next = source.slice(start + 1).search(/\n  (?:async )?function /);
  return source.slice(start, next < 0 ? source.length : start + 1 + next);
}
test("sparse, reversed, slanted and densely sampled strikes identify the same older word", () => {
  const inputs = [line(), line().reverse(), [{x:30,y:45},{x:130,y:75}], Array.from({length:2000},(_,i)=>({x:30+i*100/1999,y:60}))];
  for (const points of inputs) {
    const found = classify(points); assert.equal(found.shape, "strike"); assert.deepEqual(found.strokeIds, [1]);
    assert.equal(PEN.gestureDecision(null,found).gesture, "delete");
  }
  for (const scale of [0.5, 2, 4]) {
    const resize = points => points.map(p=>({x:p.x*scale,y:p.y*scale})), target = record(1,resize(word.points));
    assert.deepEqual(PEN.classifyGestureStroke(resize(line()), {size:4*scale,now:2000,strokes:[target]}).strokeIds,[1]);
  }
});
test("nearby underlines, fractions, fresh crossbars and lone dividers never get a local Delete offer", () => {
  const divider = record(2,[{x:80,y:-300},{x:80,y:500}]);
  for (const [points, strokes] of [[line(92),[word]],[line(),[divider]],[line(),[{...word,at:1800}]], [line(),[record(3,[{x:60,y:30},{x:70,y:40}]),record(4,[{x:60,y:80},{x:70,y:90}])]]]) {
    const found=classify(points,strokes); assert.ok(!["strike","scribble"].includes(found?.shape));
  }
  const crossbar=classify(line(),[record(3,[{x:80,y:30},{x:80,y:90}])]);
  assert.equal(PEN.gestureDecision(null,crossbar).act,"ignore","a paused plus/t crossbar needs semantic confirmation");
  assert.deepEqual(classify(line(),[word,divider,record(3,[{x:50,y:120},{x:100,y:120}])]).strokeIds,[1]);
});
test("confirmed deletion follows the full connected stroke chain beyond the mark's span", () => {
  const first = record(2,[{x:110,y:90},{x:160,y:90}]), second = record(3,[{x:160,y:90},{x:220,y:160}]),
    dot = record(4,[{x:220,y:160}]), neighbor = record(5,[{x:170,y:30},{x:170,y:60}]),
    parallel = record(6,[{x:115,y:96},{x:155,y:96}]);
  for (const strokes of [[word,first,second,dot,neighbor,parallel],[parallel,neighbor,dot,second,first,word]]) {
    const found = PEN.connectedStrokes([word],strokes);
    assert.deepEqual(found.map(item=>item.id).sort(),[1,2,3,4],"all connected strokes, including the remote endpoint, are removed; disconnected ink remains");
  }
});
test("stroke connectivity includes intersecting segments, touching endpoints and touching ink widths", () => {
  const seed = record(1,[{x:20,y:20},{x:80,y:20}]), crossing = record(2,[{x:50,y:0},{x:50,y:40}]),
    endpoint = record(3,[{x:80,y:20},{x:100,y:50}]), wide = {...record(4,[{x:20,y:27},{x:40,y:27}]),size:12},
    separate = record(5,[{x:20,y:37},{x:40,y:37}]);
  assert.deepEqual(PEN.connectedStrokes([seed],[seed,crossing,endpoint,wide,separate]).map(item=>item.id),[1,2,3,4]);
  assert.deepEqual(PEN.connectedStrokes([], [seed,crossing]),[]);
});
function pixels(rects) {
  const data = new Uint8ClampedArray(256*128*4);
  for(const [x,y,w,h] of rects) for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)data[(yy*256+xx)*4+3]=255;
  return data;
}
const raster = (rects, points=line()) => PEN.rasterDeletionTarget(pixels(rects),256,128,{x:0,y:0,w:256,h:128},points,4);
test("pre-mark components separate a crossed word from a fraction, underline, blank area and clipped frame", () => {
  const found=raster([[50,30,5,60],[80,30,5,60]]); assert.equal(found.shape,"strike"); assert.deepEqual(found.target,{x:50,y:30,w:35,h:60});
  assert.equal(raster([[50,20,35,20],[50,80,35,20]]),null);
  assert.equal(raster([[50,30,35,60]],line(92)),null);
  assert.equal(raster([]),null);
  assert.equal(raster([[80,0,5,128]]),null);
  assert.equal(PEN.gestureDecision(null,raster([[80,30,5,60]])).act,"ignore","a lone loaded crossbar also needs semantic confirmation");
  const scribble=Array.from({length:12},(_,i)=>({x:30+(i%2)*100,y:50+i*2}));
  assert.equal(raster([[50,30,5,60],[80,30,5,60]],scribble).shape,"scribble");
  assert.equal(PEN.rasterDeletionTarget(new Uint8ClampedArray(4),1000,1000,{x:0,y:0,w:1000,h:1000},line(),4),null,"pixel budget is enforced before traversal");
});
test("raster deletion masks keep an unrelated component inside the crossed components' combined bounds", () => {
  const found=raster([[50,30,5,60],[80,30,5,60],[65,35,5,5]]);
  assert.equal(found.mask.data[40*256+51],1);
  assert.equal(found.mask.data[40*256+81],1);
  assert.equal(found.mask.data[37*256+67],0,"the gap's independent ink survives");
  assert.equal(found.mask.data[40*256+49],1,"the mask includes the crossed component's edge");
  assert.equal(found.mask.data.length,256*128);
});
test("raster jobs wait for idle, cancel on input, and reject changed documents/history/revisions", () => {
  const timers=[],idle=[],historyEntry={tiles:[]},stroke={historyEntry},calls=[];
  const c={PEN_INTEL:PEN,penIntel:{raster:null},state:{history:[historyEntry],mode:"pen",userRevision:1},smartSuggest:{enabled:true,strokes:[stroke]},documentId:"doc",
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},window:{requestIdleCallback:fn=>{idle.push(fn);return idle.length;},cancelIdleCallback(){}},
    penIntelSetting:()=>true,canvasDocumentsCurrent:()=>({id:c.documentId}),performance:{now:()=>0},debug(){},
    penIntelRasterDeletion:()=>{calls.push("scan");return {shape:"strike",confidence:.82};},clearPenGesture(){},penIntelStrokeFinished:()=>calls.push("offer"),assistRefresh(){},scheduleSmartSuggest(){}};
  vm.createContext(c); vm.runInContext(fn("cancelPenRasterDeletion")+fn("schedulePenRasterDeletion"),c);
  const schedule=()=>{c.schedulePenRasterDeletion(stroke,{x:0,y:0,w:50,h:50});assert.equal(calls.length,0);timers.at(-1)();};
  schedule(); c.cancelPenRasterDeletion(); idle.at(-1)(); assert.deepEqual(calls,[]);
  schedule(); c.documentId="other"; idle.at(-1)(); assert.deepEqual(calls,[]); c.documentId="doc";
  schedule(); c.state.userRevision++; idle.at(-1)(); assert.deepEqual(calls,[]);
  schedule(); c.state.history=[]; idle.at(-1)(); assert.deepEqual(calls,[]); c.state.history=[historyEntry];
  schedule(); idle.at(-1)(); assert.deepEqual(calls,["scan","offer"]);
});
test("strong deletion bypasses remote recognition; ambiguous remote failures release ink", async () => {
  const calls=[],entry={},record={historyEntry:entry},c={PEN_INTEL:PEN,penIntel:{},state:{history:[entry]},AbortController,clearTimeout(){},canvasDocumentsCurrent:()=>({id:"doc"}),
    penIntelRemote:()=>{calls.push("remote");return true;},smartSuggestCropRegion:()=>{throw Error("offline");},debug(){},offerPenGesture:()=>calls.push("offer"),releasePenGestureInk:()=>calls.push("release")};
  vm.createContext(c); vm.runInContext(fn("resolvePenGesture"),c);
  const pending=confidence=>({records:[record],local:{shape:"strike",confidence,target:word.box},box:word.box,documentId:"doc"});
  c.penIntel.gesture=pending(.86);await c.resolvePenGesture();assert.deepEqual(calls,["offer"]);
  calls.length=0;c.penIntel.gesture=pending(.6);await c.resolvePenGesture();assert.deepEqual(calls,["remote","release"]);
});
test("a stale independent Delete cannot execute or consume ink", () => {
  const entry={},record={id:1,historyEntry:entry},calls=[],c={PEN_INTEL:PEN,state:{history:[entry]},canvasDocumentsCurrent:()=>({id:"doc"}),executeAssistDeletion:t=>calls.push(t),clearTimeout(){},cancelPenRasterDeletion(){}};
  vm.createContext(c);vm.runInContext(fn("runPenGesture"),c);
  const pending={local:{target:word.box},box:word.box,records:[record],documentId:"other"};
  c.runPenGesture(pending,"delete");assert.equal(calls.length,0);
  pending.documentId="doc";c.state.history=[];c.runPenGesture(pending,"delete");assert.equal(calls.length,0);
  c.state.history=[entry];c.runPenGesture(pending,"delete");assert.equal(calls.length,1);assert.equal(calls[0].deletion.marks[0],record);
});
