"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/client/app/canvas-runtime.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = source.indexOf("{", source.indexOf(")", start)); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`Unterminated ${name}`);
}

function harness() {
  const raised = { id:"raised", x:100, y:200, w:400, h:300, shell:{} },
    rear = { id:"rear", x:50, y:50, w:700, h:400, shell:{} },
    header = { isConnected:true, rect:{ left:80, right:600, top:150, bottom:190, width:520, height:40 } },
    record = { kind:"widget", id:raised.id, expanded:true },
    state = { widgets:[raised, rear], scale:1, panX:0, panY:0, handToolbarActiveKey:"widget:raised", handToolbarTargets:new Map([["widget:raised", record]]), widgetHeaderHoverId:raised.id },
    timers = new Map(), shown = [];
  let nextTimer = 1, leaves = 0;
  const context = vm.createContext({ state, Math, Number,
    objectChromeButtons:new Map([["widget:raised:toolbar", header]]),
    valid:point => Number.isFinite(point.x) && Number.isFinite(point.y),
    visibleWidgets:() => state.widgets.filter(widget => !widget.hiddenForReplacement),
    handToolbarObject:() => raised, widgetBox:widget => widget,
    canvasElementLayoutRect:() => header.rect,
    screenObjectBox:box => ({ left:state.panX + box.x * state.scale, top:state.panY + box.y * state.scale, width:box.w * state.scale, height:box.h * state.scale }),
    view:{ clientWidth:1000, clientHeight:800 },
    widgetHeaderHoverAllowed:() => true,
    scheduleWidgetRefineHintRender(){}, scheduleWidgetHeaderLeave(){ leaves++; },
    showWidgetHeader:widget => shown.push(widget.id),
    WIDGET_HEADER_HOVER_DELAY_MS:160, WIDGET_HEADER_HOVER_TOKEN:"widget-header-hover",
    setTimeout:(fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout:id => timers.delete(id),
  });
  for (const name of ["widgetAtRefinePoint", "widgetHeaderBridgeRect", "widgetAtHeaderPoint", "updateWidgetRefinePointer", "objectChromePosition"]) vm.runInContext(functionSource(name), context);
  return { context, state, raised, rear, record, header, timers, shown, leaves:() => leaves };
}

test("header, visual gap and raised body win hover without swallowing adjacent areas", () => {
  const h = harness(), hit = h.context.widgetAtHeaderPoint;
  for (const point of [{x:80,y:160}, {x:600,y:189}, {x:100,y:190}, {x:500,y:199}, {x:300,y:200}, {x:300,y:350}]) {
    assert.equal(hit(point), h.raised, JSON.stringify(point));
  }
  for (const point of [{x:79,y:180}, {x:601,y:180}, {x:550,y:201}, {x:300,y:149}, {x:99,y:195}, {x:501,y:195}]) {
    assert.equal(hit(point), h.rear, JSON.stringify(point));
  }
  assert.equal(hit({x:900,y:700}), null);
  assert.equal(hit(null), null);
  assert.equal(hit({x:NaN,y:200}), null);
  assert.deepEqual(h.state.widgets.map(w => w.id), ["raised", "rear"], "passive hover does not mutate saved stacking order");
  h.state.scale = .5; h.state.panX = 30; h.state.panY = 40;
  h.header.rect = {left:80, right:600, top:90, bottom:130, width:520, height:40};
  assert.equal(hit({x:140,y:250}), h.raised, "body follows Canvas transform");
  assert.equal(hit({x:1000,y:100}), h.raised, "rendered header uses viewport coordinates even when it overhangs the body");
  assert.equal(hit({x:140,y:190}), h.raised, "the visual gap follows Canvas pan and zoom");
  h.header.isConnected = false;
  assert.equal(hit({x:300,y:180}), h.rear, "removed header cannot hold ownership");
  h.header.isConnected = true; h.record.hiding = true;
  assert.equal(hit({x:300,y:350}), h.rear, "fading header releases its elevated hover area");
  h.record.hiding = false; h.raised.hiddenForReplacement = true;
  assert.equal(hit({x:300,y:350}), h.rear, "hidden Widget never retains header ownership");
});

test("returning through the header cancels a pending switch and leaving the union releases hover", () => {
  const h = harness(), move = h.context.updateWidgetRefinePointer;
  move({x:300,y:140});
  assert.equal(h.state.widgetHeaderPendingId, "rear");
  move({x:300,y:180});
  assert.equal(h.state.widgetRefineHoveredWidgetId, "raised");
  for (const [id, timer] of [...h.timers]) { h.timers.delete(id); timer.fn(); }
  assert.deepEqual(h.shown, [], "queued rear hover rechecks the entire current header area");
  for (const point of [{x:300,y:190.1}, {x:300,y:195}, {x:300,y:199.9}, {x:300,y:200}, {x:300,y:350}]) {
    move(point);
    assert.equal(h.state.widgetRefineHoveredWidgetId, "raised");
  }
  move({x:600,y:300});
  for (const [id, timer] of [...h.timers]) { h.timers.delete(id); timer.fn(); }
  assert.deepEqual(h.shown, ["rear"]);
  move(null);
  assert.equal(h.state.widgetRefineHoveredWidgetId, null);
  assert.equal(h.leaves(), 1);
});

test("compact and wrapped headers retain their original 10 px visual gap at different Canvas zoom levels", () => {
  const h = harness(), box = {x:100,y:300,w:400,h:350};
  for (const scale of [.5, 1, 1.75]) for (const baseHeight of [40, 74, 108]) {
    Object.assign(h.state, { scale, panX:15, panY:20 });
    const position = h.context.objectChromePosition(box, "toolbar", "", {objectToolbar:true,floatingWidgetToolbar:true,minimumWidth:390,baseHeight});
    assert.equal(h.state.panY + box.y * scale - position.y - position.baseHeight, 10);
    assert.equal(position.scale, 1);
  }
});

test("viewport clamping that overlaps the Widget body creates no extra bridge", () => {
  const h = harness(), box = {x:100,y:20,w:400,h:350};
  const position = h.context.objectChromePosition(box, "toolbar", "", {objectToolbar:true,floatingWidgetToolbar:true,minimumWidth:390,baseHeight:74});
  assert.equal(position.y, 6);
  assert.equal(h.context.widgetHeaderBridgeRect({left:position.x,top:position.y,width:position.baseWidth,height:position.baseHeight}, h.context.screenObjectBox(box)), null);
});
