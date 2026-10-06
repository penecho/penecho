"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const navigation = read("src/client/app/canvas-navigation.js"), ui = read("src/client/app/ui-bootstrap.js");
const functionSource = (source, name) => {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, name);
  return match[0];
};

test("Lasso skips object picking without changing the document; temporary placements retain their controls", () => {
  const state = { mode:"select", viewMode:false }, calls = [];
  const api = vm.runInNewContext(`${functionSource(navigation, "canvasLassoToolActive")};
    ${functionSource(navigation, "beginCanvasObjectSelection")};({canvasLassoToolActive,beginCanvasObjectSelection})`, {
    state, valid:() => true,
    pendingHit:() => "move", beginPendingGesture:() => calls.push("draft-move"),
    canvasWidgetAtEvent:() => { throw Error("Lasso must not hit or raise objects"); },
  });
  assert.equal(api.beginCanvasObjectSelection({button:0}, {x:50,y:50}), false);
  assert.deepEqual(state, {mode:"select",viewMode:false});
  for (const field of ["pending", "pendingWidget", "imageEdit", "animationEdit"]) {
    state[field] = {};
    assert.equal(api.canvasLassoToolActive(), false, field);
    delete state[field];
  }
  state.pending = {};
  assert.equal(api.beginCanvasObjectSelection({button:0}, {x:50,y:50}), true);
  assert.deepEqual(calls, ["draft-move"]);
});

test("explicit Lasso ends an existing object edit and removes its toolbar before accepting ink input", () => {
  const state = {mode:"hand",widgetEdit:{id:"widget-1"},imageEdit:{id:"image-1"},animationEdit:{id:"animation-1"}};
  const calls = [];
  const select = vm.runInNewContext(`(${functionSource(ui, "selectCanvasToolMode")})`, {
    state, canvasToolMode:mode => mode,
    acceptWidgetEdit:() => { calls.push("widget");state.widgetEdit=null; },
    acceptImageEdit:options => { assert.equal(options.restoreMode,false);calls.push("image");state.imageEdit=null; },
    acceptAnimationEdit:() => { calls.push("animation");state.animationEdit=null; },
    hideHandObjectToolbar:options => { assert.equal(options.all,true);calls.push("hide"); },
    setCanvasMode:mode => { calls.push(mode);state.mode=mode; },
  });
  assert.equal(select("select"), true);
  assert.deepEqual(calls, ["widget","image","animation","hide","select"]);
  assert.equal(state.previousToolMode,"hand");
});

test("Lasso and Hand reveal Widget controls when no selection gesture is active", () => {
  const state = {mode:"select"};
  const allowed = vm.runInNewContext(`${functionSource(navigation, "canvasLassoToolActive")};
    (${functionSource(read("src/client/app/canvas-runtime.js"), "widgetHeaderHoverAllowed")})`, {state});
  assert.equal(allowed(),true);
  state.selectionGesture={hit:"lasso"};
  assert.equal(allowed(),false);
  state.selectionGesture=null;
  state.mode="hand";
  assert.equal(allowed(),true);
});

test("an unresolved draft retains its return tool when Lasso cannot finalize it", () => {
  const draft={id:"pending-widget"},state={mode:"select",pendingWidget:draft,aiDraftReturnMode:"pen",imageHandReturnMode:"hand"};
  const select=vm.runInNewContext(`(${functionSource(ui,"selectCanvasToolMode")})`,{
    state,canvasToolMode:mode=>mode,acceptPendingWidget:()=>false,
    setCanvasMode:()=>assert.fail("an unresolved draft must not enter Lasso"),
  });
  assert.equal(select("select"),false);
  assert.strictEqual(state.pendingWidget,draft);
  assert.equal(state.aiDraftReturnMode,"pen");
  assert.equal(state.imageHandReturnMode,"hand");
});

test("initial lasso capture stays read-only until content is transformed", () => {
  const persistence=read("src/client/app/persistence.js"), widget={id:"widget",x:100,y:100,w:300,h:200};
  const pendingHistory=new Map([["unrelated",{}]]), state={scale:1,userRevision:7,widgets:[widget],historyBefore:pendingHistory};
  const statuses=[], context={state,SELECT:require("../public/selection.js"),SIZE:20000,
    forTiles:()=>assert.fail("the lasso does not inspect or lift ink"),setStatusKey:key=>statuses.push(key),render(){},resetCanvasCursor(){},
    invalidateSharpOverlays:()=>assert.fail("no ink is lifted"),save:()=>assert.fail("selecting an image region is not a document edit"),
    selectionAIBusy:()=>false,
  };
  const api=vm.runInNewContext(["captureSelection","selectionContentBounds","restoreSelectionSource","cancelSelection","commitSelection","deleteSelection","applySelectionColor"].map(name=>functionSource(persistence,name)).join("\n")+
    "\n({captureSelection,cancelSelection,commitSelection,deleteSelection,applySelectionColor})",context);
  const points=[{x:120,y:130},{x:240,y:130},{x:120,y:240},{x:120,y:130}];
  assert.equal(api.captureSelection(points),true);
  assert.equal(state.selection.phase,"active");
  assert.equal(state.selection.fragments.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(state.selection.contentBox)),{x:120,y:130,w:120,h:110});
  assert.equal(state.userRevision,7);
  assert.strictEqual(state.widgets[0],widget);
  assert.equal(api.applySelectionColor("red"),false);
  state.selection.box.x+=30;
  assert.equal(api.commitSelection(),false);
  assert.equal(state.selection,null);
  assert.equal(pendingHistory.size,1,"unrelated pending history survives closing a region");
  assert.equal(api.captureSelection(points.map(point=>({x:point.x+1000,y:point.y+1000}))),true,"blank regions are valid too");
  assert.equal(api.deleteSelection(),true);
  assert.equal(state.userRevision,7);
  assert.equal(pendingHistory.size,1);
  assert.equal(api.captureSelection([{x:100,y:100},{x:101,y:100},{x:100,y:101}]),false,"accidental clicks still do not create a region");
  assert.equal(statuses.at(-1),"selectionTooSmall");
});

test("the first real transform lifts content once and preserves the selection and pointer gesture", () => {
  const source=read("src/client/app/persistence.js"), SELECT=require("../public/selection.js");
  const points=[{x:100,y:100},{x:200,y:100},{x:200,y:200},{x:100,y:200}];
  const selection={phase:"active",regionOnly:true,originalPath:points,originalBox:{x:100,y:100,w:100,h:100},box:{x:100,y:100,w:100,h:100}};
  const gesture={id:7,hit:"move",startPoint:{x:140,y:140},startBox:{...selection.box}},state={selection,selectionGesture:gesture,scale:2};
  const lifts=[];
  const update=vm.runInNewContext(["sameBox","selectionPathFor","updateSelectionGesture"].map(name=>functionSource(source,name)).join("\n")+"\nupdateSelectionGesture",{
    state,SELECT,SIZE:20000,selectionAIBusy:()=>false,clientPoint:event=>event.point,requestRender(){},updateSelectionObjects(){},
    captureInkSelection:(path,current)=>{lifts.push({path,current});Object.assign(current,{regionOnly:false,fragments:[{}]});},
  });
  assert.equal(update({pointerId:8,point:{x:170,y:160}}),false,"another pointer cannot move the selection");
  update({pointerId:7,point:{x:140,y:140}});
  assert.equal(lifts.length,0,"clicking without moving stays read-only");
  update({pointerId:7,point:{x:170,y:160}});
  update({pointerId:7,point:{x:190,y:170}});
  assert.equal(lifts.length,1);
  assert.strictEqual(lifts[0].current,selection);
  assert.strictEqual(state.selection,selection);
  assert.strictEqual(state.selectionGesture,gesture);
  assert.deepEqual(selection.box,{x:150,y:130,w:100,h:100});
  assert.equal(selection.path[0].x,150);
});

test("lasso object transforms preserve editable records and exclude Widgets and polygon exterior", () => {
  const source=read("src/client/app/persistence.js"),SELECT=require("../public/selection.js");
  const image={id:"image",x:20,y:20,w:20,h:20,image:{}},text={id:"text",x:40,y:30,w:20,h:20,maxWidth:20,fontSize:12,text:"Editable",image:{}};
  const outside={id:"outside",x:80,y:80,w:10,h:10},widget={id:"widget",x:20,y:20,w:20,h:20},animation={id:"animation",x:10,y:10,w:10,h:10,scene:{}};
  const state={images:[image,outside],textBoxes:[text],animations:[animation],widgets:[widget],historyBefore:new Map(),inkBounds:new Map(),imageHistoryBefore:[],textBoxHistoryBefore:[]};
  const api=vm.runInNewContext(["movableSelectionObjects","updateSelectionObjects","restoreSelectionSource"].map(name=>functionSource(source,name)).join("\n")+"\n({movableSelectionObjects,updateSelectionObjects,restoreSelectionSource})",{state,SELECT,requestAnimationLayerRender(){}});
  const objects=api.movableSelectionObjects([{x:0,y:0},{x:100,y:0},{x:0,y:100}]);
  assert.deepEqual(Array.from(objects,object=>object.item.id),["image","text","animation"]);
  const selection={objects,originalBox:{x:0,y:0,w:100,h:100},box:{x:200,y:300,w:200,h:200},beforeTiles:new Map(),objectHistoryFields:["imageHistoryBefore","textBoxHistoryBefore"]};
  api.updateSelectionObjects(selection);
  assert.deepEqual({x:image.x,y:image.y,w:image.w,h:image.h},{x:240,y:340,w:40,h:40});
  assert.equal(text.text,"Editable");assert.equal(text.fontSize,24);assert.equal(text.maxWidth,40);
  assert.equal(animation.x,220);assert.equal(animation.w,20);
  assert.equal(widget.x,20);assert.equal(outside.x,80);
  api.restoreSelectionSource(selection);
  assert.equal(image.x,20);assert.equal(text.fontSize,12);assert.equal(text.maxWidth,20);
  assert.equal(animation.x,10);assert.equal(animation.w,10);
  assert.equal(state.imageHistoryBefore,null);assert.equal(state.textBoxHistoryBefore,null);
});

test("a cancelled pointer transform restores the previous selection geometry", () => {
  const source=read("src/client/app/persistence.js"),SELECT=require("../public/selection.js");
  const before={x:100,y:100,w:100,h:100},state={selection:{phase:"active",originalBox:before,originalPath:[{x:100,y:100}],box:{...before,x:200}},selectionGesture:{id:7,hit:"move",startBox:before}};
  let updates=0;
  const finish=vm.runInNewContext(["sameBox","selectionHasChanges","selectionPathFor","finishSelectionGesture"].map(name=>functionSource(source,name)).join("\n")+"\nfinishSelectionGesture",{state,SELECT,resetCanvasCursor(){},requestRender(){},updateSelectionObjects:()=>updates++});
  assert.equal(finish({pointerId:7,type:"pointercancel"}),true);
  assert.deepEqual(JSON.parse(JSON.stringify(state.selection.box)),before);assert.equal(state.selection.changed,false);assert.equal(updates,1);
});

test("an empty or Widget-only lasso does not pick up new ink while its boundary crosses the canvas", () => {
  const source=read("src/client/app/persistence.js"),SELECT=require("../public/selection.js");
  const state={scale:1,selection:{phase:"active",regionOnly:true,originalBox:{x:100,y:100,w:100,h:100},box:{x:100,y:100,w:100,h:100},originalPath:[{x:100,y:100},{x:200,y:100},{x:200,y:200}]},selectionGesture:{id:7,hit:"move",startPoint:{x:140,y:140},startBox:{x:100,y:100,w:100,h:100}}};
  let attempts=0;
  const update=vm.runInNewContext(["sameBox","selectionPathFor","updateSelectionGesture"].map(name=>functionSource(source,name)).join("\n")+"\nupdateSelectionGesture",{state,SELECT,SIZE:20000,selectionAIBusy:()=>false,clientPoint:event=>event.point,requestRender(){},updateSelectionObjects(){},captureInkSelection:()=>{attempts++;return false;}});
  update({pointerId:7,point:{x:150,y:150}});update({pointerId:7,point:{x:600,y:600}});
  assert.equal(attempts,1);assert.equal(state.selection.regionOnly,true);assert.equal(state.selection.box.x,560);
});

test("committed raster transforms discard stale stroke coordinates while retaining unrelated stroke hints", () => {
  const source=read("src/client/app/persistence.js"),inside={box:{x:20,y:20,w:30,h:10}},outside={box:{x:300,y:300,w:30,h:10}};
  const smartSuggest={strokes:[inside,outside],analysis:{},analysisKey:"old",lastKey:"old",jev:{}};
  const invalidate=vm.runInNewContext(`(${functionSource(source,"invalidateSelectionInkTracking")})`,{
    smartSuggest,intersection:(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y,
  });
  invalidate({fragments:[{}],originalBox:{x:10,y:10,w:100,h:100}});
  assert.equal(smartSuggest.strokes.length,1);assert.strictEqual(smartSuggest.strokes[0],outside);assert.equal(smartSuggest.analysis,null);assert.equal(smartSuggest.lastKey,"");
  smartSuggest.strokes=[inside];invalidate({fragments:[],originalBox:{x:10,y:10,w:100,h:100}});
  assert.strictEqual(smartSuggest.strokes[0],inside,"object-only movement preserves unchanged ink hints");
});
