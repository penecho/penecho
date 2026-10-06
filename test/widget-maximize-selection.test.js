"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const runtime = fs.readFileSync(path.join(__dirname, "../src/client/app/canvas-runtime.js"), "utf8");
const navigation = fs.readFileSync(path.join(__dirname, "../src/client/app/canvas-navigation.js"), "utf8");
function helper(source, name) {
  const start = source.indexOf(`  function ${name}(`), end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end);
}
function harness(viewer = false, coarse = false) {
  const first = { id:"first", x:100, y:80, w:320, h:220 }, second = { id:"second", x:460, y:80, w:320, h:220 };
  const state = { widgets:[first, second], handToolbarTargets:new Map(), selectedWidgetId:null, widgetEdit:null, viewerSelectedWidgetId:null };
  const activations = [], presentations = [];
  let refreshes = 0;
  const context = { state, window:{ PENECHO_CONFIG:{ runtime:viewer ? "viewer" : "local" }, matchMedia:() => ({matches:coarse}) },
    view:{clientWidth:900,clientHeight:600}, t:key=>key, handToolbarKey:(kind,id)=>`${kind}:${id}`,
    widgetBox:widget=>widget, screenObjectBox:box=>({left:box.x,top:box.y,width:box.w,height:box.h}),
    enterWidgetInteraction:widget=>{activations.push(widget.id);return true;},
    switchWidgetPresentation:(widget,maximized)=>presentations.push([widget.id,maximized]),
    requestInteractionLayerRender:()=>refreshes++,
  };
  const api = vm.runInNewContext(`${helper(runtime,"selectedWidgetMaximizeSpec")}\n${helper(runtime,"objectChromePosition")}\n${helper(navigation,"selectViewerWidget")}\n({selectedWidgetMaximizeSpec,objectChromePosition,selectViewerWidget})`, context);
  return {api,state,first,second,context,activations,presentations,refreshes:()=>refreshes};
}
test("local and Cloud editing canvases never expose the share-only corner action", () => {
  for (const runtime of ["local", "cloud"]) {
    const h = harness();
    h.context.window.PENECHO_CONFIG.runtime = runtime;
    h.state.handToolbarTargets.set("widget:first", {expanded:true,holds:new Set(["widget-header-hover"])});
    assert.equal(h.api.selectedWidgetMaximizeSpec(), null, "passive hover has no maximize control");
    h.state.selectedWidgetId = "first";
    h.state.widgetEdit = {id:"first"};
    assert.equal(h.api.selectedWidgetMaximizeSpec(), null, "editing selection has no corner control");
    h.state.viewerSelectedWidgetId = "first";
    assert.equal(h.api.selectedWidgetMaximizeSpec(), null, "stale viewer selection cannot bypass the runtime boundary");
    assert.deepEqual(h.activations, []);
  }
});
test("viewer selection switches one viewing action without creating an edit or history transaction", () => {
  const h = harness(true);
  assert.equal(h.api.selectedWidgetMaximizeSpec(), null);
  assert.equal(h.api.selectViewerWidget(h.first), true);
  assert.equal(h.api.selectedWidgetMaximizeSpec().widget, h.first);
  h.api.selectViewerWidget(h.second);
  const spec = h.api.selectedWidgetMaximizeSpec();
  assert.equal(spec.widget, h.second); assert.equal(spec.handToolbar, false);
  assert.equal(spec.label, "widgetMaximize");
  assert.equal(h.state.widgetEdit, null); assert.equal(h.state.selectedWidgetId, null);
  spec.activate(); assert.deepEqual(h.presentations, [["second",true]]);
  h.state.interactingWidgetId = "second";
  assert.equal(h.api.selectedWidgetMaximizeSpec(), null);
  h.state.interactingWidgetId = null;
  h.api.selectViewerWidget(null); assert.equal(h.api.selectedWidgetMaximizeSpec(), null);
  h.api.selectViewerWidget({id:"foreign"}); assert.equal(h.state.viewerSelectedWidgetId, null);
  assert.equal(h.refreshes(), 4);
  const editor = harness();
  assert.equal(editor.api.selectViewerWidget(editor.first), false); assert.equal(editor.refreshes(), 0);
});
test("corner alignment retains 8px insets, fixed screen size, and stays reachable at clipped edges", () => {
  for (const coarse of [false,true]) {
    const h = harness(true,coarse), size = coarse ? 44 : 28;
    h.api.selectViewerWidget(h.first);
    const spec = h.api.selectedWidgetMaximizeSpec();
    assert.equal(spec.baseWidth,size); assert.equal(spec.baseHeight,size);
    const at = box => h.api.objectChromePosition(box,"maximize",spec.key,spec);
    const normal = at(h.first);
    assert.equal(normal.x + size, 412); assert.equal(normal.y,88); assert.equal(normal.scale,1);
    const zoomed = at({x:50,y:40,w:160,h:110});
    assert.equal(zoomed.x + size,202); assert.equal(zoomed.y,48); assert.equal(zoomed.baseWidth,size);
    const clipped = at({x:800,y:-50,w:200,h:220});
    assert.equal(clipped.x + size,894); assert.equal(clipped.y,6);
    assert.equal(at({x:1000,y:80,w:200,h:220}),null);
  }
});
