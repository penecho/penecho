"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = name => fs.readFileSync(path.join(__dirname, "../src/client/app", name), "utf8");
const ai = read("ai-runtime.js"), pen = read("pen-intelligence.js");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  let depth = 0, index = source.indexOf("{", source.indexOf(")", start));
  for (; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) break;
  }
  return `${source.slice(Math.max(0, start - 6), start) === "async " ? "async " : ""}${source.slice(start, index + 1)}`;
}

function fixture(delay = 1000) {
  let now = 0, next = 0;
  const timers = new Map(), launches = [];
  const ctx = vm.createContext({
    state:{ mode:"pen", auto:true, dirty:{ x:0, y:0, w:10, h:10 }, autoEligible:true, autoDelayMs:delay, timer:0, history:["ink"] },
    penIntel:{ gesture:null, offer:null }, aiPreparation:null,
    setTimeout:(fn, ms) => { const id = ++next; timers.set(id, { fn, at:now + ms }); return id; },
    clearTimeout:id => timers.delete(id),
    canvasAgentSuppressesAutomaticAI:() => false, currentWidgetRefineCandidate:() => null,
    activeWidgetRefinement:() => null, hasUnsettledToolbox:() => false,
    clearWidgetRefineCandidate() {}, supersedeActiveAI() {}, debug() {}, scheduleAssist() {},
    requestAI:action => launches.push({ action, at:now }),
    canvasDocumentsCurrent:() => ({ id:"doc" }), penIntelRemote:() => true,
    smartSuggestCropRegion:() => ({}), smartSuggestRequiredWidgets:() => [], WIDGET_CLASSIFY_SNAPSHOT_TIMEOUT_MS:8000, smartSuggestCrop:() => "image",
    PEN_INTEL:{ union:() => ({}), gestureDecision:() => ({ act:"run", gesture:"solve" }) },
    runPenGesture:() => assert.fail("An inferred gesture cannot replace Auto AI"),
    offerPenGesture:() => {}, AbortController,
  });
  vm.runInContext(["schedule", "launchAutomaticAI"].map(name => functionSource(ai, name)).join("\n") + "\n" +
    ["clearPenGesture", "dismissPenGestureOffer", "releasePenGestureInk", "resolvePenGesture"].map(name => functionSource(pen, name)).join("\n"), ctx);
  const tick = ms => {
    const end = now + ms;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].fn();
    }
    now = end;
  };
  return { ctx, launches, tick, timers };
}

test("Auto AI fires at the configured deadline regardless of optional analysis", () => {
  for (const delay of [0, 1000, 3500, 10000]) {
    for (const analysis of ["unavailable", "pending", "none", "unfinished", "check_step"]) {
      const { ctx, launches, tick } = fixture(delay);
      ctx.smartSuggest = { available:analysis !== "unavailable", controller:analysis === "pending" ? {} : null, jev:{ answers:{ action:{ choice:analysis } } } };
      ctx.penIntel.gesture = { controller:new AbortController(), timer:0 };
      const controller = ctx.penIntel.gesture.controller;
      ctx.schedule();
      if (delay > 0) { tick(delay - 1); assert.equal(launches.length, 0); tick(1); } else tick(0);
      assert.deepEqual(launches, [{ action:"auto", at:delay }]);
      assert.equal(controller.signal.aborted, true);
      assert.equal(ctx.penIntel.gesture, null);
      tick(30000);
      assert.equal(launches.length, 1);
    }
  }
});

test("new ink resets the deadline without losing its automatic request", () => {
  const { ctx, launches, tick } = fixture(1000);
  ctx.schedule(); tick(700);
  ctx.state.userRevision = 2;
  ctx.schedule(); tick(999);
  assert.equal(launches.length, 0);
  tick(1);
  assert.deepEqual(launches, [{ action:"auto", at:1700 }]);
});

test("releasing or dismissing a gesture never restarts the Auto AI countdown", () => {
  const { ctx, launches, tick } = fixture(1000);
  ctx.schedule(); tick(800);
  ctx.releasePenGestureInk();
  ctx.penIntel.offer = { element:{ remove() {} } };
  ctx.dismissPenGestureOffer("kept");
  tick(200);
  assert.deepEqual(launches, [{ action:"auto", at:1000 }]);
});

test("a gesture response after the Auto AI deadline cannot execute or rearm Auto AI", async () => {
  const { ctx, launches, tick, timers } = fixture(1000);
  let respond, started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  ctx.penechoLLMRequest = () => new Promise(resolve => { respond = resolve; started(); });
  ctx.penIntel.gesture = { local:{ shape:"underline" }, box:{}, records:[{ id:1, historyEntry:"ink" }], documentId:"doc" };
  ctx.PEN_INTEL.GESTURE_SHAPES = ["underline"];
  const pending = ctx.resolvePenGesture();
  await requestStarted;
  assert.equal(typeof respond, "function");
  ctx.schedule(); tick(1000);
  respond({}); await pending;
  assert.deepEqual(launches, [{ action:"auto", at:1000 }]);
  assert.equal(timers.size, 0);
});

test("erasing clears a candidate whose gesture timer was pending", () => {
  const { ctx } = fixture();
  ctx.smartSuggest = { controller:null, request:null, sequence:0 };
  ctx.smartSuggestSyncDocument = () => {};
  ctx.penIntel.gesture = { controller:null, timer:ctx.setTimeout(() => assert.fail("stale gesture"), 500) };
  vm.runInContext(functionSource(read("smart-suggestions.js"), "smartSuggestDrawingStarted"), ctx);
  ctx.smartSuggestDrawingStarted({ erase:true });
  assert.equal(ctx.penIntel.gesture, null);
});

test("turning off Auto AI or continuing to draw prevents a pending launch", () => {
  for (const change of [{ auto:false }, { drawing:{} }, { dirty:null }, { autoEligible:false }]) {
    const { ctx, launches, tick } = fixture();
    ctx.schedule(); Object.assign(ctx.state, change); tick(1000);
    assert.equal(launches.length, 0);
  }
});
