"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const read = name => fs.readFileSync(path.join(__dirname, "../src/client/app", name), "utf8");
const ui = read("ui-bootstrap.js"), agent = read("canvas-agent-runtime.js");
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw Error(name);
}
function setup() {
  const listeners = new Map(), calls = [];
  const surface = {addEventListener(type, fn) { const entries = listeners.get(type) || []; entries.push(fn); listeners.set(type, entries); }};
  const context = vm.createContext({
    window:surface, document:{...surface,hidden:false},
    state:{drawing:null,pointers:new Map()}, canvasAgent:{inkStroke:null},
    canvasAgentInkCanvas:{hasPointerCapture:()=>true,releasePointerCapture:id=>calls.push(["release",id])},
    finishDrawing:()=>{calls.push("finish"); context.state.drawing=null;},
    canvasAgentNavigationPointerDidEnd:id=>calls.push(["navigationEnd",id]),
    requestInteractionLayerRender:()=>calls.push("render"),
    canvasAgentSyncSendAvailability:()=>calls.push("sync-send"),
  });
  vm.runInContext(extract(agent,"canvasAgentFinishInkStroke"),context);
  vm.runInContext(ui.slice(ui.indexOf("function canvasPencilWritingActive"),ui.indexOf("function canvasPenEraserActive")),context);
  const dispatch = (type, values={}) => {
    const event={type,pointerType:"pen",pointerId:7,buttons:1,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...values};
    for(const fn of listeners.get(type)||[]){fn(event);if(event.stopped)break;}
    return event;
  };
  const pencil = () => {context.state.drawing={id:7,pointerType:"pen"};context.state.pointers.set(7,{});};
  return {context,dispatch,pencil,calls};
}
test("touch is blocked only during a live Pencil stroke, with no remembered mode",()=>{
  const h=setup();
  assert.ok(!h.dispatch("pointerdown",{pointerType:"touch",pointerId:2}).stopped);
  h.pencil();
  assert.equal(h.dispatch("pointerdown",{pointerType:"touch",pointerId:2}).stopped,true);
  assert.equal(h.dispatch("pointermove",{pointerType:"touch",pointerId:2}).prevented,true);
  h.dispatch("pointerup");
  assert.ok(!h.dispatch("pointerdown",{pointerType:"touch",pointerId:3}).stopped);
  assert.equal(h.context.state.pointers.size,0);
  assert.equal(h.calls.filter(x=>x==="finish").length,1);
});
test("all interruption paths release both Pencil surfaces, idempotently",()=>{
  for(const type of ["pointerup","pointercancel","lostpointercapture","blur","pagehide","visibilitychange"]){
    const h=setup();h.pencil();h.context.document.hidden=true;
    h.context.canvasAgent.inkStroke={pointerId:7,pointerType:"pen"};
    h.dispatch(type);h.dispatch(type);
    assert.equal(h.context.state.drawing,null,type);
    assert.equal(h.context.canvasAgent.inkStroke,null,type);
    assert.ok(!h.dispatch("pointerdown",{pointerType:"touch",pointerId:3}).stopped,type);
    assert.equal(h.calls.filter(x=>x==="finish").length,1,type);
    assert.equal(h.calls.filter(x=>Array.isArray(x)&&x[0]==="release").length,1,type);
  }
});
test("unrelated pointers and visible events do not end writing; released hover repairs a missed up",()=>{
  const h=setup();h.pencil();
  h.dispatch("pointerup",{pointerType:"touch",pointerId:3});
  h.dispatch("visibilitychange");h.dispatch("pointermove");
  assert.ok(h.context.state.drawing);
  h.dispatch("pointermove",{buttons:0});
  assert.equal(h.context.state.drawing,null);
});
test("new pen or mouse input clears stale writing before a different interaction",()=>{
  for(const pointerType of ["pen","mouse"]){
    const h=setup();h.pencil();h.dispatch("pointerdown",{pointerType,pointerId:9});
    assert.equal(h.context.state.drawing,null);
  }
});
test("temporary pan and tool switches finalize drawing before switching",()=>{
  const h=setup();h.pencil();
  Object.assign(h.context,{syncCanvasNavigation(){}});
  vm.runInContext(extract(read("canvas-navigation.js"),"setSpacePan"),h.context);
  h.context.setSpacePan(true);
  assert.equal(h.context.state.drawing,null);
  const source=extract(ui,"setCanvasMode");
  // Execute the actual transition prefix; later UI presentation is unrelated to input ownership.
  Object.assign(h.context,{setWidgetInteraction(){},eraserToolButton:{},finishInterruptedWidgetGesture(){}});
  h.context.document.querySelector=()=>({});
  h.context.state.mode="pen";h.pencil();
  vm.runInContext(source.slice(0,source.indexOf("if (state.widgetGesture)"))+"}",h.context);
  h.context.setCanvasMode("hand");
  assert.equal(h.context.state.drawing,null);
});
test("Agent pen cannot be stolen by a palm; ending or switching preserves ink and releases capture",()=>{
  const h=setup();
  Object.assign(h.context,{canvasAgentInput:{disabled:false},canvasAgentInkPoint:()=>({x:1,y:2}),canvasAgentInkContext:{save(){},restore(){},beginPath(){},arc(){},fill(){}},CANVAS_AGENT_INK_LINE_WIDTH:2,canvasAgentSyncInputHint(){}});
  vm.runInContext(extract(agent,"canvasAgentInkPointerDown")+extract(agent,"canvasAgentInkPointerEnd"),h.context);
  const event=(pointerType,pointerId)=>({pointerType,pointerId,button:0,preventDefault(){}});
  h.context.canvasAgentInkPointerDown(event("pen",7));
  h.context.canvasAgentInkPointerDown(event("touch",8));
  assert.equal(h.context.canvasAgent.inkStroke.pointerId,7);
  h.context.canvasAgentInkPointerEnd(event("touch",8));
  assert.ok(h.context.canvasAgent.inkStroke);
  h.context.canvasAgentInkPointerEnd(event("pen",7));
  assert.equal(h.context.canvasAgent.inkStroke,null);
  assert.equal(h.context.canvasAgent.inkPresent,true);
  h.context.canvasAgentInkPointerDown(event("touch",9));
  assert.equal(h.context.canvasAgent.inkStroke.pointerId,9);
  for(const name of ["canvasAgentSetInputMode","closeCanvasAgent","canvasAgentClearInkDraft"]){
    const source=extract(agent,name), prefix=source.slice(0,source.indexOf("canvasAgentFinishInkStroke();")+"canvasAgentFinishInkStroke();".length)+"}";
    vm.runInContext(prefix,h.context);h.context[name]("text");
    assert.equal(h.context.canvasAgent.inkStroke,null,name);
    h.context.canvasAgent.inkStroke={pointerId:7,pointerType:"pen"};
  }
});
