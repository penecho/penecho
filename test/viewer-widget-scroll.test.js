"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const navigation = fs.readFileSync(require("node:path").join(__dirname, "../src/client/app/canvas-navigation.js"), "utf8");
const host = fs.readFileSync(require("node:path").join(__dirname, "../public/widget-host.js"), "utf8");

function navigationHarness(runtime = "viewer") {
  const messages = [], timers = new Map(), moves = [], zooms = [];
  let nextTimer = 0;
  const rect = { left:100, top:200, right:550, bottom:800, width:450, height:600 };
  const widget = { id:"card", html:"unchanged", hostReady:true, contentW:900, contentH:1200,
    frame:{ inert:true, getBoundingClientRect:() => rect, contentWindow:{ postMessage:(message, origin) => messages.push({ message, origin }) } } };
  const state = { widgets:[widget], touches:new Map() };
  const context = { window:{ PENECHO_CONFIG:{ runtime } }, state, location:{ origin:"https://viewer.test" },
    canvasWidgetAtEvent:() => widget, canvasNavigationSurface:() => true, canvasViewportMetrics:() => ({ height:800 }),
    moveCanvas:(dx, dy) => moves.push([dx, dy]), zoomCanvasAt:(x, y, dy) => zooms.push([x, y, dy]),
    requestCoordinatesUpdate() {}, wheelNavigating() {},
    setTimeout:callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout:id => timers.delete(id) };
  const start = navigation.indexOf("  let viewerWidgetScrollSequence"), end = navigation.indexOf("  function beginCanvasTrackpadGesture", start);
  const api = vm.runInNewContext(`${navigation.slice(start, end)};({requestViewerWidgetScroll,finishViewerWidgetScroll,handleCanvasWheel})`, context);
  const wheel = (values = {}) => api.handleCanvasWheel({ clientX:325, clientY:500, deltaX:0, deltaY:60, deltaMode:0, preventDefault() {}, ...values });
  const reply = handled => api.finishViewerWidgetScroll(widget, { requestId:messages.at(-1).message.requestId, handled });
  return { api, widget, state, rect, messages, moves, zooms, timers, wheel, reply };
}

test("only maximized viewer gestures reach the card at its native point and keep the camera still", () => {
  const h = navigationHarness(); h.widget.maximized = true;
  h.api.requestViewerWidgetScroll({ clientX:325, clientY:500 }, 0, 60, () => h.moves.push("fallback"));
  const { message, origin } = h.messages[0];
  assert.deepEqual([message.x, message.y, message.dx, message.dy], [450, 600, 0, 60]);
  assert.equal(origin, "https://viewer.test"); assert.equal(h.widget.frame.inert, true);
  h.reply(true); assert.deepEqual(h.moves, []); assert.equal(h.timers.size, 0);
});
test("inline viewer wheel and touch never forward reading scrolls into the card", () => {
  const h = navigationHarness(); h.wheel({ deltaX:20 });
  assert.deepEqual(h.moves, [[-20, -60]]); assert.equal(h.messages.length, 0);
  assert.equal(h.api.requestViewerWidgetScroll({ clientX:325, clientY:500, pointerType:"touch" }, 10, 40, () => {}), false);
  assert.equal(h.messages.length, 0); assert.equal(h.timers.size, 0);
});
test("inline viewer preserves line/page panning, Shift and wheel zoom preferences", () => {
  const h = navigationHarness();
  h.wheel({ deltaMode:1, deltaY:2 }); assert.deepEqual(h.moves.at(-1), [-0, -32]);
  h.wheel({ deltaMode:2, deltaY:1 }); assert.deepEqual(h.moves.at(-1), [-0, -800]);
  h.wheel({ shiftKey:true }); assert.deepEqual(h.moves.at(-1), [-60, -0]);
  h.state.wheelZoom = true; h.wheel(); assert.deepEqual(h.zooms, [[325, 500, 60]]); assert.equal(h.messages.length, 0);
});
test("pinch/Cmd zoom, Space pan, blank space and non-viewer editing retain navigation", () => {
  for (const values of [{ ctrlKey:true }, { metaKey:true }]) {
    const h = navigationHarness(); h.wheel(values); assert.equal(h.messages.length, 0); assert.equal(h.zooms.length, 1);
  }
  for (const setup of [h => { h.state.spacePan = true; }, h => { h.rect.left = 400; }, h => { h.widget.hostReady = false; }]) {
    const h = navigationHarness(); setup(h); h.wheel(); assert.equal(h.messages.length, 0); assert.equal(h.moves.length, 1);
  }
  const h = navigationHarness("local"); h.wheel(); assert.equal(h.messages.length, 0); assert.equal(h.moves.length, 1);
});
test("touch scroll deltas follow the displayed card scale, and stale replies cannot move another document", () => {
  const h = navigationHarness(); h.widget.maximized = true; let fallbacks = 0;
  h.api.requestViewerWidgetScroll({ clientX:325, clientY:500, pointerType:"touch" }, 10, 40, () => fallbacks++);
  assert.deepEqual([h.messages[0].message.dx, h.messages[0].message.dy], [20, 80]);
  h.widget.html = "replaced"; h.reply(false); assert.equal(fallbacks, 0); assert.equal(h.timers.size, 0);
});
test("maximized scroll maps the actual iframe viewport and drops stale fallback when presentation changes", () => {
  const h = navigationHarness(); h.widget.maximized = true; h.widget.frame.clientWidth = 1200; h.widget.frame.clientHeight = 1800;
  let fallbacks = 0;
  h.api.requestViewerWidgetScroll({ clientX:325, clientY:500, pointerType:"touch" }, 10, 40, () => fallbacks++);
  const message = h.messages[0].message;
  assert.deepEqual([message.x, message.y, message.dy], [600, 900, 120]);
  assert.ok(Math.abs(message.dx - 10 * 1200 / 450) < 1e-9);
  h.widget.maximized = false; h.reply(false); assert.equal(fallbacks, 0); assert.equal(h.timers.size, 0);
});

function presentationHarness(runtime = "viewer") {
  const h = navigationHarness(runtime), listeners = new Map(), scrolls = [];
  h.widget.maximized = true;
  h.widget.shell = { addEventListener:(type, listener) => listeners.set(type, listener),
    removeEventListener:(type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); }, scrollBy:(dx, dy) => scrolls.push([dx, dy]) };
  h.widget.frame.clientHeight = 1200;
  const start = navigation.indexOf("  function setViewerWidgetPresentationScrolling("), end = navigation.indexOf("  function setWidgetPresentationScrolling(", start);
  const setup = vm.runInNewContext(`(${navigation.slice(start, end).trim()})`, {
    window:{ PENECHO_CONFIG:{ runtime } }, requestViewerWidgetScroll:h.api.requestViewerWidgetScroll,
  });
  const event = values => ({ clientX:325, clientY:500, deltaX:0, deltaY:60, deltaMode:0, target:{ closest:() => null },
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...values });
  setup(h.widget, true);
  return { ...h, setup, listeners, scrolls, event };
}
test("maximized viewer forwards wheel despite interacting navigation, with outer-sheet fallback only", () => {
  const h = presentationHarness(), event = h.event();
  h.listeners.get("wheel")(event); assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  h.reply(true); assert.deepEqual(h.moves, []); assert.deepEqual(h.scrolls, []);
  h.listeners.get("wheel")(h.event({ shiftKey:true })); h.reply(false);
  assert.deepEqual(h.scrolls, [[60, 0]]); assert.deepEqual(h.moves, []);
  h.listeners.get("wheel")(h.event({ deltaMode:2, deltaY:1 })); assert.equal(h.messages.at(-1).message.dy, 1200); h.reply(true);
});
test("maximized viewer times out to its outer sheet once and cannot scroll after closing", () => {
  const h = presentationHarness(); h.listeners.get("wheel")(h.event());
  [...h.timers.values()][0](); h.reply(false); assert.deepEqual(h.scrolls, [[0, 60]]);
  h.listeners.get("wheel")(h.event()); h.widget.maximized = false;
  [...h.timers.values()][0](); h.reply(false); assert.deepEqual(h.scrolls, [[0, 60]]); assert.deepEqual(h.moves, []);
});
test("maximized viewer keeps touch scrolling on its initial content point and excludes multi-touch", () => {
  const h = presentationHarness(), point = (x, y) => ({ clientX:x, clientY:y });
  h.listeners.get("touchstart")(h.event({ touches:[point(325, 500)] }));
  h.listeners.get("touchmove")(h.event({ touches:[point(325, 460)] }));
  assert.deepEqual([h.messages[0].message.x, h.messages[0].message.y, h.messages[0].message.dy], [450, 600, 80]); h.reply(true);
  h.listeners.get("touchmove")(h.event({ touches:[point(325, 420), point(350, 420)] }));
  h.listeners.get("touchmove")(h.event({ touches:[point(325, 400)] })); assert.equal(h.messages.length, 1);
});
test("presentation listeners preserve normal Canvas, modifier zoom and toolbar controls, and clean up on close", () => {
  const local = presentationHarness("local"); assert.equal(local.listeners.size, 0);
  const h = presentationHarness();
  for (const values of [{ ctrlKey:true }, { metaKey:true }, { target:{ closest:() => ({}) } }]) {
    const event = h.event(values); h.listeners.get("wheel")(event); assert.equal(event.prevented, undefined);
  }
  assert.equal(h.messages.length, 0); h.setup(h.widget, false); assert.equal(h.listeners.size, 0);
  h.setup(h.widget, true); assert.equal(h.listeners.size, 5); h.setup(h.widget, true); assert.equal(h.listeners.size, 5);
});

function scroller(style, height = 100, width = 100) {
  return { style, clientHeight:100, scrollHeight:height, clientWidth:100, scrollWidth:width, scrollTop:0, scrollLeft:0,
    scrollBy({ top, left }) { this.scrollTop = Math.max(0, Math.min(height - 100, this.scrollTop + top)); this.scrollLeft = Math.max(0, Math.min(width - 100, this.scrollLeft + left)); } };
}
function scrollHarness() {
  const root = scroller({ overflowY:"hidden", overflowX:"hidden" }, 1200), body = scroller({}), panel = scroller({ overflowY:"auto", overflowX:"auto" }, 500, 600), text = scroller({});
  text.parentElement = panel; panel.parentElement = body; body.parentElement = root;
  const context = { document:{ scrollingElement:root, documentElement:root, elementFromPoint:() => text },
    getComputedStyle:element => element.style, innerWidth:900, innerHeight:1200, widgetState:{ maximized:true }, activeSnapshot:null, activeSnapshotRender:null };
  const start = host.indexOf("    function scrollViewerAtPoint("), end = host.indexOf('    addEventListener("wheel"', start);
  const scroll = vm.runInNewContext(`(${host.slice(start, end).trim()})`, context);
  return { scroll, root, body, panel, text, context };
}
test("the nearest nested panel scrolls on both axes and owns gestures at its boundaries", () => {
  const h = scrollHarness();
  assert.equal(h.scroll({ x:100, y:200, dx:30, dy:70 }), true);
  assert.deepEqual([h.panel.scrollLeft, h.panel.scrollTop, h.root.scrollTop], [30, 70, 0]);
  h.panel.scrollTop = 400; assert.equal(h.scroll({ x:100, y:200, dx:0, dy:70 }), true); assert.equal(h.panel.scrollTop, 400);
  assert.equal(h.scroll({ x:100, y:200, dx:0, dy:-50 }), true); assert.equal(h.panel.scrollTop, 350);
});
test("normal page overflow scrolls, while hidden content, invalid points and snapshots do not", () => {
  const h = scrollHarness(); h.panel.style = {};
  assert.equal(h.scroll({ x:100, y:200, dx:0, dy:50 }), false);
  h.root.style.overflowY = "visible";
  assert.equal(h.scroll({ x:100, y:200, dx:0, dy:50 }), true); assert.equal(h.root.scrollTop, 50);
  for (const values of [{ x:-1 }, { x:900 }, { y:1200 }, { dy:Infinity }, { dy:100001 }]) {
    assert.equal(h.scroll({ x:100, y:200, dx:0, dy:50, ...values }), false);
  }
  h.context.activeSnapshot = {}; assert.equal(h.scroll({ x:100, y:200, dx:0, dy:50 }), false);
});
test("the widget host rejects reading scroll requests when the card is not maximized", () => {
  const h = scrollHarness(); h.context.widgetState.maximized = false;
  assert.equal(h.scroll({ x:100, y:200, dx:0, dy:50 }), false); assert.equal(h.panel.scrollTop, 0);
});
