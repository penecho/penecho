"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/widget-host.js"), "utf8");
function chunk(start, end) {
  const index = source.indexOf(start);
  assert.ok(index >= 0);
  return source.slice(index, source.indexOf(end, index));
}
const scheduler = chunk("    function scheduleAnimationFrame(", "    function clearHoldTimer("),
  settling = chunk("    function flushSnapshotAnimationFrame(", "    function waitForSnapshotViewport(");
function harness(active = true) {
  const native = new Map(), timers = new Map(), errors = [], logs = [];
  let nextId = 1;
  const context = vm.createContext({
    runtimeActive:active, nextAnimationFrameId:1, pendingAnimationFrames:new Map(), nativeAnimationFrames:new Map(),
    nativeRequestAnimationFrame:callback => { const id = nextId++; native.set(id, callback); return id; },
    nativeCancelAnimationFrame:id => native.delete(id),
    setTimeout:(callback, delay) => { const id = nextId++; timers.set(id, { callback, delay }); return id; },
    clearTimeout:id => timers.delete(id), clock:() => 100,
    recordRuntimeError:error => errors.push(error), snapshotDebugLog:(stage, details) => logs.push({ stage, details }),
  });
  vm.runInContext(scheduler + settling, context);
  return { context, native, timers, errors, logs,
    timeout() { const entries = [...timers]; for (const [id, timer] of entries) if (timers.delete(id)) timer.callback(); },
    frame() { const entries = [...native]; for (const [id, callback] of entries) if (native.delete(id)) callback(80); },
  };
}
test("offscreen capture flushes the first queued draw, without claiming browser presentation", async () => {
  const h = harness(); let painted = false, timestamp;
  h.context.requestAnimationFrame(time => { painted = true; timestamp = time; });
  const capture = h.context.settleSnapshotFrame();
  assert.equal(painted, false);
  h.timeout();
  assert.equal(await capture, false); assert.equal(painted, true); assert.equal(timestamp, 100);
  assert.equal(h.native.size, 0); assert.equal(h.timers.size, 0);
});
test("flush honors prior cancellation and cancellation from another callback", async () => {
  const h = harness(), calls = [];
  const canceled = h.context.requestAnimationFrame(() => calls.push("canceled"));
  h.context.cancelAnimationFrame(canceled);
  let later;
  h.context.requestAnimationFrame(() => { calls.push("first"); h.context.cancelAnimationFrame(later); });
  later = h.context.requestAnimationFrame(() => calls.push("later"));
  const capture = h.context.settleSnapshotFrame(); h.timeout(); await capture;
  assert.deepEqual(calls, ["first"]); assert.equal(h.native.size, 0);
});
test("self-requeued callbacks execute only once per capture and remain cancelable", async () => {
  const h = harness(); let count = 0, next;
  const animate = () => { count++; next = h.context.requestAnimationFrame(animate); };
  h.context.requestAnimationFrame(animate);
  const capture = h.context.settleSnapshotFrame(); h.timeout(); await capture; h.timeout();
  assert.equal(count, 1); assert.equal(h.native.size, 1); assert.equal(h.timers.size, 0);
  h.context.cancelAnimationFrame(next); h.frame(); assert.equal(count, 1);
});
test("native visible frame draws once, clears fallback, and cannot later flush twice", async () => {
  const h = harness(); let count = 0;
  h.context.requestAnimationFrame(() => count++);
  const capture = h.context.settleSnapshotFrame(); h.frame();
  assert.equal(await capture, true); h.timeout(); h.frame();
  assert.equal(count, 1); assert.equal(h.logs.length, 0); assert.equal(h.timers.size, 0);
});
test("a paused runtime gets one explicit draw without starting a hidden animation loop", async () => {
  const h = harness(false); let count = 0;
  const animate = () => { count++; h.context.requestAnimationFrame(animate); };
  h.context.requestAnimationFrame(animate);
  const capture = h.context.settleSnapshotFrame(); h.timeout(); await capture;
  assert.equal(count, 1); assert.equal(h.native.size, 0); assert.equal(h.context.runtimeActive, false);
  assert.equal(h.context.pendingAnimationFrames.size, 1);
});
test("callback errors remain diagnostic and do not prevent other callbacks or snapshot settlement", async () => {
  const h = harness(); let painted = false;
  h.context.requestAnimationFrame(() => { throw Error("draw failed"); });
  h.context.requestAnimationFrame(() => { painted = true; });
  const capture = h.context.settleSnapshotFrame(); h.timeout();
  assert.equal(await capture, false); assert.equal(painted, true); assert.equal(h.errors[0].message, "draw failed");
});
