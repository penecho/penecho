"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),LIVE=require("../public/live-ops.js");
const SIZE=64,blank=()=>new Uint8ClampedArray(SIZE*SIZE*4);
function paint(pixels,x0,y0,x1,y1,rgba){
  const next=Uint8ClampedArray.from(pixels);
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)next.set(rgba,(y*SIZE+x)*4);
  return next;
}
const roundTrip=patch=>LIVE.unpackPatch(LIVE.packPatch(patch),SIZE);
const apply=(pixels,patch)=>{const next=Uint8ClampedArray.from(pixels);LIVE.applyTilePatch(next,roundTrip(patch),SIZE);return next;};
const at=(pixels,x,y)=>[...pixels.subarray((y*SIZE+x)*4,(y*SIZE+x)*4+4)];

test("strokes drawn in the same tile at the same time are both kept, in either order",()=>{
  const base=paint(blank(),0,0,8,8,[0,0,0,255]),
    mine=LIVE.diffTile(base,paint(base,10,10,20,12,[255,0,0,255]),SIZE),
    theirs=LIVE.diffTile(base,paint(base,30,40,50,44,[0,0,255,255]),SIZE);
  const first=apply(apply(base,mine),theirs),second=apply(apply(base,theirs),mine);
  assert.deepEqual(first,second);
  assert.deepEqual(at(first,12,11),[255,0,0,255]);
  assert.deepEqual(at(first,35,41),[0,0,255,255]);
  assert.deepEqual(at(first,2,2),[0,0,0,255],"older ink stays");
  assert.deepEqual([mine.x,mine.y,mine.w,mine.h],[10,10,10,2]);
});

test("copies converge when changes overlap, because everyone applies the server order",()=>{
  const base=blank(),a=LIVE.diffTile(base,paint(base,0,0,20,20,[255,0,0,255]),SIZE),b=LIVE.diffTile(base,paint(base,10,10,30,30,[0,255,0,255]),SIZE);
  const order=[a,b],left=order.reduce(apply,base),right=order.reduce(apply,Uint8ClampedArray.from(base));
  assert.deepEqual(left,right);
  assert.deepEqual(at(left,15,15),[0,255,0,255],"the later change wins only where both drew");
  assert.deepEqual(at(left,5,5),[255,0,0,255]);
});

test("Undo removes only my ink and keeps what someone added on top since",()=>{
  const base=blank(),mine=LIVE.diffTile(base,paint(base,0,0,20,4,[0,0,0,255]),SIZE);
  let shared=apply(base,mine);
  const crossing=LIVE.diffTile(shared,paint(shared,5,0,7,30,[0,0,255,255]),SIZE);
  shared=apply(shared,crossing);
  shared=apply(shared,LIVE.restorePatch(mine,"undo"));
  assert.deepEqual(at(shared,1,1),[0,0,0,0],"my stroke is gone");
  assert.deepEqual(at(shared,6,1),[0,0,255,255],"their crossing stroke stays where it covered mine");
  assert.deepEqual(at(shared,6,20),[0,0,255,255]);
  shared=apply(shared,LIVE.restorePatch(mine,"redo"));
  assert.deepEqual(at(shared,1,1),[0,0,0,255]);
  assert.deepEqual(at(shared,6,1),[0,0,255,255],"Redo does not cover their stroke either");
});

test("erasing is a patch to transparent pixels and transparent colour channels are ignored",()=>{
  const base=paint(blank(),0,0,10,10,[20,30,40,255]),erased=paint(base,0,0,5,10,[0,0,0,0]),patch=LIVE.diffTile(base,erased,SIZE);
  assert.equal(patch.values.length/4,50);
  const target=apply(base,patch);
  assert.deepEqual(at(target,1,1),[0,0,0,0]);
  assert.equal(LIVE.diffTile(paint(blank(),0,0,2,2,[9,9,9,0]),blank(),SIZE),null,"invisible colour differences are not changes");
});

test("restore patches tolerate the premultiplied rounding of faint edge pixels",()=>{
  const expected=new Uint8Array([200,100,50,3]),rounded=new Uint8Array([170,85,85,3]),far=new Uint8Array([200,100,50,40]);
  assert.equal(LIVE.closePixel(rounded,0,expected,0),true);
  assert.equal(LIVE.closePixel(far,0,expected,0),false);
});

test("patches round-trip through the wire form and reject damaged input",()=>{
  const base=blank(),patch=LIVE.diffTile(base,paint(base,3,4,9,6,[1,2,3,255]),SIZE),restore=LIVE.restorePatch(patch,"undo");
  const back=LIVE.unpackPatch(LIVE.packPatch(restore),SIZE);
  assert.deepEqual([back.x,back.y,back.w,back.h],[3,4,6,2]);
  assert.deepEqual([...back.values],[...restore.values]);
  assert.deepEqual([...back.expect],[...restore.expect]);
  const bytes=LIVE.packPatch(patch);
  assert.throws(()=>LIVE.unpackPatch(bytes.subarray(0,bytes.length-1),SIZE),/wrong length/);
  const outside=Uint8Array.from(bytes);new DataView(outside.buffer).setUint16(2,60,true);
  assert.throws(()=>LIVE.unpackPatch(outside,SIZE),/outside/);
  assert.equal(LIVE.diffTile(null,null,SIZE),null);
});

test("object changes merge per field: one person moves a Widget while another edits it",()=>{
  const widget={id:"widget-3",x:10,y:10,w:400,h:300,title:"Plan",html:"<p>v1</p>"};
  const moved=LIVE.diffObjects("widgets",[widget],[{...widget,x:500}]),edited=LIVE.diffObjects("widgets",[widget],[{...widget,html:"<p>v2</p>"}]);
  assert.deepEqual(moved,[{t:"obj",k:"widgets",id:"widget-3",set:{x:500}}]);
  let current=widget;
  for(const op of [...moved,...edited])current=LIVE.applyObjectOp(current,op)??current;
  assert.deepEqual(current,{...widget,x:500,html:"<p>v2</p>"});
});

test("objects are added, removed, restacked and cleared field by field",()=>{
  const a={id:"image-1",x:1},b={id:"image-2",x:2,plotExpression:"x"},c={id:"image-3",x:3};
  const ops=LIVE.diffObjects("images",[a,b],[{...b,plotExpression:undefined},c,]);
  assert.deepEqual(ops,[
    {t:"obj",k:"images",id:"image-2",unset:["plotExpression"]},
    {t:"obj",k:"images",id:"image-3",put:c},
    {t:"obj",k:"images",id:"image-1",del:true},
  ]);
  assert.deepEqual(LIVE.applyObjectOp(b,ops[0]),{id:"image-2",x:2});
  assert.equal(LIVE.applyObjectOp(a,ops[2]),null);
  assert.equal(LIVE.applyObjectOp(null,ops[0]),undefined,"a change to a removed object is ignored");
  assert.deepEqual(LIVE.diffObjects("images",[a,b],[b,a]).at(-1),{t:"order",k:"images",ids:["image-2","image-1"]});
  assert.deepEqual(LIVE.applyOrder(["image-1","image-2","image-9"],["image-2","image-1"]),["image-2","image-1","image-9"],"objects added meanwhile stay in front");
});

test("conditional Undo restores only fields nobody changed since",()=>{
  const before={id:"text-box-1",x:0,text:"draft"},after={id:"text-box-1",x:0,text:"final"};
  const undo=LIVE.diffObjects("textBoxes",[after],[before],{conditional:true});
  assert.deepEqual(LIVE.applyObjectOp(after,undo[0]),before);
  assert.equal(LIVE.applyObjectOp({...after,text:"someone else"},undo[0]),undefined);
  const created=LIVE.diffObjects("textBoxes",[after],[],{conditional:true})[0];
  assert.equal(LIVE.applyObjectOp(after,created),null,"Undo of my new text removes it");
  assert.equal(LIVE.applyObjectOp({...after,x:40},created),undefined,"but not after someone moved it");
  const restored=LIVE.diffObjects("textBoxes",[],[before],{conditional:true})[0];
  assert.equal(LIVE.applyObjectOp(after,restored),undefined,"Redo of a removal never replaces an existing object");
  assert.deepEqual(LIVE.applyObjectOp(null,restored),before);
});

test("change validation accepts the shared format and rejects anything else",()=>{
  assert.doesNotThrow(()=>LIVE.validateChange([
    {t:"ink",tiles:[{k:"39,0",d:"AAEC"}]},{t:"obj",k:"widgets",id:"widget-1000001",set:{x:4}},
    {t:"order",k:"textBoxes",ids:["text-box-2"]},{t:"meta",set:{frontKind:"widget"}}]));
  for(const bad of [{t:"ink",tiles:[{k:"40,0",d:"AA=="}]},{t:"ink",tiles:[{k:"1,1",d:"not base64!"}]},
    {t:"obj",k:"widgets",id:"image-1",del:true},{t:"obj",k:"widgets",id:"widget-1",del:true,set:{x:1}},
    {t:"obj",k:"widgets",id:"widget-1",put:JSON.parse('{"__proto__":{"x":1}}')},{t:"meta",set:{theme:"dark"}},{t:"script"}])
    assert.throws(()=>LIVE.validateOp(bad),/invalid|Unknown|must/i,JSON.stringify(bad));
  assert.throws(()=>LIVE.validateChange([]),/1–256/);
});
