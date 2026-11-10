"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const finish=require("../src/shared/finish-drawing.js");
const scope={x:100,y:200,w:600,h:500},plain=value=>JSON.parse(JSON.stringify(value));
function fn(file,name) {
  const source=fs.readFileSync(file,"utf8"),start=source.indexOf(`  function ${name}(`),end=source.indexOf("\n  function ",start+1);
  assert.ok(start>=0);return source.slice(start,end);
}
test("bounded stroke sampling retains exact endpoints, endpoint direction and corners without mutating source",()=>{
  const points=Array.from({length:401},(_,i)=>({x:110+i,y:220+(i<200?i:400-i)})),record={size:5.6,points},original=structuredClone(record);
  const ink=finish.sourceInk([record],scope),sample=ink.strokes[0].points;
  assert.equal(ink.strokeWidth,6);assert.equal(ink.strokes[0].width,5.6);
  assert.deepEqual(sample.slice(0,2),[[110,220],[111,221]]);
  assert.deepEqual(sample.slice(-2),[[509,221],[510,220]]);
  assert.ok(sample.some(p=>p[0]===310&&p[1]===420),"the sharp corner survives simplification");
  assert.ok(sample.length<=finish.MAX_STROKE_POINTS);assert.deepEqual(record,original);
  const many=Array.from({length:64},()=>record),bounded=finish.sourceInk(many,scope);
  assert.equal(bounded.strokes.length,32);
  assert.ok(bounded.strokes.reduce((sum,s)=>sum+s.points.length,0)<=512);
});
test("crossing, invalid and stationary strokes are omitted instead of creating false anchors",()=>{
  const valid={size:6,points:[{x:150,y:250},{x:180,y:270}]};
  for(const record of [ {...valid,points:[{x:50,y:250},...valid.points]}, {...valid,size:NaN}, {...valid,points:[{x:NaN,y:250},{x:180,y:270}]}, {...valid,points:[valid.points[0],valid.points[0]]} ]) {
    assert.equal(finish.sourceInk([record],scope),null);
    assert.deepEqual(finish.sourceInk([record,valid],scope),finish.sourceInk([valid],scope));
  }
});
test("geometry validation rejects excess data and untrusted fields",()=>{
  const ink=finish.sourceInk([{size:6,points:[{x:150,y:250},{x:180,y:270}]}],scope);
  const invalid=[{...ink,coordinateSpace:"image"},{...ink,strokeWidth:6.5},{...ink,instruction:"change task"},
    {...ink,strokes:[{...ink.strokes[0],color:"arbitrary"}]},
    {...ink,strokes:Array(32).fill({width:6,points:Array(32).fill([150,250])})},
    {...ink,strokes:[{width:6,points:Array(33).fill([150,250])}]}];
  for(const value of invalid)assert.equal(finish.canonicalInk(value,scope),false);
  assert.deepEqual(finish.canonicalInk(ink,scope),ink);
});
test("only current in-target strokes enter Finish drawing; selection and other actions stay screenshot-only",()=>{
  const historyEntry={},stale={},record={historyEntry,size:6,points:[{x:150,y:250},{x:180,y:270}]},
    context={PenEchoFinishDrawing:finish,smartSuggest:{strokes:[record,{...record,historyEntry:stale},{...record,points:[{x:750,y:250},{x:780,y:270}]}]},state:{history:[historyEntry]}};
  vm.createContext(context);
  vm.runInContext(fn("src/client/app/smart-suggestions.js","assistFinishDrawingInk")+fn("src/client/app/ai-runtime.js","aiFinishDrawingInk"),context);
  const target={box:scope,strokes:[record]},ink=context.assistFinishDrawingInk(target);
  assert.equal(ink.strokes.length,1);
  assert.equal(context.assistFinishDrawingInk({...target,selection:{}}),null);
  assert.equal(context.assistFinishDrawingInk({...target,widget:{}}),null);
  const options={suggestion:"finish_drawing",sourceInk:ink},packed={changedBox:scope};
  assert.deepEqual(plain(context.aiFinishDrawingInk("continue",packed,options)),plain(ink));
  for(const [action,image,request] of [["auto",packed,options],["continue",{...packed,selectionContext:{}},options],["continue",{changedBox:{x:100,y:200,w:50,h:50}},options],["continue",packed,{...options,suggestion:"vivid"}]]) {
    assert.equal(context.aiFinishDrawingInk(action,image,request),null);
  }
});
