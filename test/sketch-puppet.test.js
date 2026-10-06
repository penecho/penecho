"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const puppet=require("../src/shared/sketch-puppet.js"),SCENE=require("../public/scene-spec.js");
const scope={x:100,y:100,w:400,h:400},plain=value=>JSON.parse(JSON.stringify(value));
function fn(file,name,next="\n  function ") {
  const source=fs.readFileSync(file,"utf8"),start=source.indexOf(`function ${name}(`),end=source.indexOf(next,start+1);
  assert.ok(start>=0,name);return source.slice(start,end);
}
const line=(x0,y0,x1,y1,n=12)=>Array.from({length:n},(_,i)=>({x:x0+(x1-x0)*i/(n-1),y:y0+(y1-y0)*i/(n-1)}));
// A stick figure: head, body, arms, and both legs drawn as one "Λ" stroke.
const head={size:4,color:"#1f2937",points:Array.from({length:24},(_,i)=>({x:300+20*Math.cos(i/23*Math.PI*2),y:160+20*Math.sin(i/23*Math.PI*2)}))};
const body={size:4,points:line(300,180,300,280)},arms={size:4,color:"#2563EB",points:line(260,210,340,210)},
  legs={size:4,points:[...line(270,360,300,280,10),...line(300,280,330,360,10).slice(1)]};
const records=[head,body,arms,legs];

test("sketch ink keeps drawing order, colour and width, and omits strokes outside the target",()=>{
  const ink=puppet.sketchInk([...records,{size:4,points:line(50,50,90,90)}],scope);
  assert.equal(ink.strokes.length,4);
  assert.equal(ink.strokes[0].color,"#1f2937");assert.equal(ink.strokes[2].color,"#2563eb");
  assert.equal(ink.strokes[1].color,undefined);assert.equal(ink.strokes[3].width,4);
  assert.deepEqual(ink.strokes[3].points[0],[270,360]);assert.deepEqual(ink.strokes[3].points.at(-1),[330,360]);
  assert.ok(ink.strokes[3].points.some(([x,y])=>x===300&&y===280),"the joint between both legs survives sampling");
  assert.equal(puppet.sketchInk([{size:4,points:line(50,50,90,90)}],scope),null);
});
test("ink validation rejects untrusted fields and excess geometry",()=>{
  const ink=puppet.sketchInk(records,scope);
  for(const value of [{...ink,coordinateSpace:"image"},{...ink,instruction:"x"},{...ink,strokes:[{...ink.strokes[0],color:"red;"}]},
    {...ink,strokes:[{width:4,points:[[10,10],[20,20]]}]},{...ink,strokes:Array(65).fill(ink.strokes[1])}])
    assert.equal(puppet.canonicalInk(value,scope),false);
  assert.deepEqual(puppet.canonicalInk(ink,scope),ink);
});
test("the model view exposes a few anchors per stroke and ranges map back to real samples",()=>{
  const ink=puppet.sketchInk(records,scope),view=puppet.modelView(ink);
  assert.equal(view.strokes.length,4);
  for(const stroke of view.strokes)assert.ok(stroke.pts.length<=puppet.VIEW_POINTS&&stroke.pts.length>=2);
  assert.deepEqual(view.strokes[3].box.map(Math.round),[268,278,64,84]);
});
test("a rig splits one stroke into two legs, nests limbs and validates as a scene",()=>{
  const ink=puppet.sketchInk(records,scope),view=puppet.modelView(ink).strokes[3].pts,
    joint=view.findIndex(([x,y])=>x===300&&y===280);
  assert.ok(joint>0);
  const rig={engine:"puppet",subject:"walker",effects:{shadow:true},parts:[
    {id:"body",ink:[0,1],pivot:[300,360],motion:[{type:"bob",amp:4,period:0.6},{type:"travel",amp:200,period:5}]},
    {id:"arms",ink:[2],parent:"body",pivot:[300,210],motion:[{type:"swing",amp:20,period:1.2}]},
    {id:"left leg",ink:[`3:0-${joint}`],parent:"body",pivot:[300,280],motion:[{type:"swing",amp:25,period:1.2}]},
    {id:"right_leg",ink:[`3:${joint}-${view.length-1}`],parent:"body",motion:[{type:"swing",amp:25,period:1.2,phase:0.5}]},
    {id:"loop",ink:[],parent:"loop2"},{id:"loop2",ink:[],parent:"loop"},
  ]};
  const command=puppet.widgetCommand(rig,ink),scene=command.scene,checked=SCENE.validate(scene);
  assert.equal(checked.ok,true,checked.error);
  assert.equal(scene.engine,"puppet");assert.equal(scene.subject,"walker");assert.equal(scene.effects.shadow,true);
  assert.equal(scene.parts[2].id,"left_leg");
  const legs=scene.parts.filter(part=>/leg/.test(part.id));
  assert.equal(legs.length,2);for(const leg of legs)assert.equal(leg.ink.length,1);
  assert.notEqual(scene.ink[legs[0].ink[0]].d,scene.ink[legs[1].ink[0]].d);
  // The unspecified right-leg pivot is the leg's point nearest the body.
  const offset=[scene.parts[0].pivot[0]-300,scene.parts[0].pivot[1]-360];
  assert.deepEqual(legs[1].pivot.map((v,i)=>Math.round(v-offset[i])),[300,280]);
  // Cyclic parents are broken instead of rejecting the whole rig.
  assert.ok(scene.parts.filter(part=>part.id.startsWith("loop")).some(part=>!part.parent));
  // Travel and bob make room so motion is not clipped; the widget sits beside the sketch.
  assert.ok(scene.size[0]>=64+200);assert.ok(command.x>=332);
  assert.ok(JSON.stringify(scene).length<SCENE.MAX_SOURCE_BYTES);
  const every=new Set(scene.parts.flatMap(part=>part.ink));
  assert.equal(every.size,scene.ink.length,"every ink run belongs to exactly one part");
});
test("motions are clamped, unknown entries ignored, and the fallback still animates the user's ink",()=>{
  const ink=puppet.sketchInk(records,scope);
  const scene=puppet.rigToScene({parts:[{id:"all",ink:[0,1,2,3,99,"x"],motion:[{type:"spin",amp:-9},{type:"teleport"},{type:"swing",amp:900,period:-1}]}]},ink).scene;
  assert.deepEqual(scene.parts[0].motion,[{type:"spin",amp:-1,period:1.6},{type:"swing",amp:120,period:1.1}]);
  assert.throws(()=>puppet.rigToScene({parts:[{id:"a",ink:[42]}]},ink),/sketchInk stroke indices/);
  const fallback=puppet.widgetCommand(puppet.fallbackRig(ink),ink);
  assert.equal(SCENE.validate(fallback.scene).ok,true);
  assert.equal(fallback.scene.parts[0].motion[0].type,"hop");
});
test("stored puppet scenes reject shared ink, unknown motion and parent cycles",()=>{
  const ink=puppet.sketchInk(records,scope),{scene}=puppet.rigToScene({parts:[{id:"a",ink:[0,1,2,3]}]},ink);
  assert.equal(SCENE.validate(scene).ok,true);
  assert.match(SCENE.validate({...scene,parts:[...scene.parts,{id:"b",ink:[0]}]}).error,/more than one part/);
  assert.match(SCENE.validate({...scene,parts:[{...scene.parts[0],motion:[{type:"teleport"}]}]}).error,/unknown motion/);
  assert.match(SCENE.validate({...scene,parts:[{...scene.parts[0],parent:"b"},{id:"b",ink:[],parent:"a"}]}).error,/cycle/);
  assert.match(SCENE.validate({engine:"puppet",parts:[{id:"a"}]}).error,/puppet ink/);
  assert.match(SCENE.documentFor(scene),/data-penecho-scene-engine="puppet"/);
});
test("only current, in-target and unmoved lasso ink is rigged",()=>{
  const historyEntry={},inside={...body,historyEntry},stale={...arms,historyEntry:{}},
    context={PenEchoSketchPuppet:puppet,smartSuggest:{strokes:[inside,stale]},state:{history:[historyEntry]},
      SELECT:{pointInPolygon:(p,path)=>p.x>=path[0].x&&p.x<=path[2].x&&p.y>=path[0].y&&p.y<=path[2].y},selectionPathFor:()=>null};
  vm.createContext(context);
  vm.runInContext(fn("src/client/app/smart-suggestions.js","assistSketchInk")+fn("src/client/app/ai-runtime.js","aiSketchInk"),context);
  const target={box:scope,strokes:[inside]};
  assert.equal(context.assistSketchInk(target).strokes.length,1);
  for(const other of [{...target,widget:{}},{...target,followUp:true}])assert.equal(context.assistSketchInk(other),null);
  const path=[{x:100,y:100},{x:500,y:100},{x:500,y:500},{x:100,y:500}],selection={box:scope,originalBox:scope,originalPath:path};
  assert.equal(context.assistSketchInk({...target,selection}).strokes.length,1);
  assert.equal(context.assistSketchInk({...target,selection:{...selection,box:{...scope,x:140}}}),null);
  assert.equal(context.assistSketchInk({...target,selection:{...selection,regionOnly:true}}),null);
  const ink=context.assistSketchInk(target),packed={changedBox:scope};
  assert.deepEqual(plain(context.aiSketchInk("plot",packed,{suggestion:"animate_sketch",sketchInk:ink})),plain(ink));
  for(const [action,request,options] of [["answer",packed,{suggestion:"animate_sketch",sketchInk:ink}],["plot",packed,{suggestion:"vivid",sketchInk:ink}],["plot",{changedBox:{x:100,y:100,w:20,h:20}},{suggestion:"animate_sketch",sketchInk:ink}]])
    assert.equal(context.aiSketchInk(action,request,options),null);
});
test("the server converts a model rig into the user's ink and rejects redrawn scenes",()=>{
  const ink=puppet.sketchInk(records,scope),context={SCENE,SKETCH_PUPPET:puppet,optionalWidgetText:(v,n)=>typeof v==="string"&&v.trim()?v.trim().slice(0,n):""};
  vm.createContext(context);
  vm.runInContext(fn("src/server/main.js","normalizedSceneCommand","\nfunction "),context);
  const rig={engine:"puppet",parts:[{id:"body",ink:[0,1,2,3],motion:[{type:"hop",amp:20}]}]},sceneContext={sketchInk:ink};
  const command=context.normalizedSceneCommand({tool:"html_widget",pluginId:"general",title:"Walker",sourceFormat:"penecho-scene+json",scene:rig},sceneContext);
  assert.equal(command.sourceFormat,"penecho-scene+json");assert.match(command.html,/puppet/);
  const stored=JSON.parse(command.copyText);assert.equal(stored.ink.length,4);assert.ok(command.x>=332);
  // A second normalization pass keeps the already built puppet.
  assert.deepEqual(JSON.parse(context.normalizedSceneCommand(command,sceneContext).copyText),stored);
  const redraw={tool:"html_widget",scene:{engine:"motion",actors:[{id:"a",type:"circle",x:1,y:1,r:2}]}},failed={sketchInk:ink};
  assert.equal(context.normalizedSceneCommand(redraw,failed),null);assert.match(failed.sceneError,/puppet/);
  const bad={sketchInk:ink};
  assert.equal(context.normalizedSceneCommand({tool:"html_widget",scene:{engine:"puppet",parts:[{id:"a",ink:[9]}]}},bad),null);
  assert.match(bad.sceneError,/sketchInk/);
  const html={sketchInk:ink};
  assert.equal(context.normalizedSceneCommand({tool:"html_widget",html:"<svg></svg>"},html),null);assert.match(html.sceneError,/puppet/);
  assert.equal(context.normalizedSceneCommand({tool:"draw"},{sketchInk:ink}).tool,"draw");
  // Without sketch ink the ordinary scene path is unchanged.
  assert.ok(context.normalizedSceneCommand(redraw,{}));
});
