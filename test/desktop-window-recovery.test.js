"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createWindowRecovery, keepsRunning } = require("../desktop/window-recovery.js");

const fakeWindow = ({ crashed = false, minimized = false, visible = true } = {}) => {
  const calls = [];
  return { calls, destroyed:false, isDestroyed() { return this.destroyed; }, isMinimized:() => minimized, isVisible:() => visible, restore:() => calls.push("restore"),
    webContents:{ isCrashed:() => crashed, reload:() => calls.push("reload") } };
};

test("opening PenEcho again brings its window back, made again when it is gone and loaded again when its page died (PE-571)", () => {
  let current = null, opened = 0;
  const revealed = [], recovery = createWindowRecovery({ getWindow:() => current, openWindow:() => { opened++; current = fakeWindow(); return current; }, reveal:w => revealed.push(w) });
  recovery.reopen();
  assert.equal(opened, 1, "no window: a new one is made");
  current.destroyed = true;
  recovery.reopen();
  assert.equal(opened, 2, "a destroyed window is made again");
  current = fakeWindow({ crashed:true, minimized:true });
  recovery.reopen();
  assert.deepEqual(current.calls, ["reload", "restore"]);
  assert.equal(revealed.at(-1), current);
  assert.equal(opened, 2);
});

test("a page whose process died is loaded again, but not when PenEcho closed it and not in a loop", () => {
  let t = 0;
  const window = fakeWindow(), recovery = createWindowRecovery({ getWindow:() => window, openWindow:() => null, reveal() {}, now:() => t });
  assert.equal(recovery.pageGone(window, { reason:"clean-exit" }), false);
  assert.deepEqual([1, 2, 3, 4].map(() => recovery.pageGone(window, { reason:"crashed" })), [true, true, true, false]);
  t = 61_000;
  assert.equal(recovery.pageGone(window, { reason:"oom" }), true, "a minute later it may try again");
  assert.equal(window.calls.filter(c => c === "reload").length, 4);
});

test("on Windows hidden helper windows do not keep PenEcho running without its window", () => {
  const picture = fakeWindow({ visible:false }), update = fakeWindow({ visible:true }), helpers = new Set([picture]);
  assert.equal(keepsRunning([picture], w => helpers.has(w)), false);
  assert.equal(keepsRunning([fakeWindow({ visible:false })], w => helpers.has(w)), false);
  assert.equal(keepsRunning([picture, update], w => helpers.has(w)), true);
  const main = fs.readFileSync(require.resolve("../desktop/main.js"), "utf8");
  assert.match(main, /app\.on\("second-instance", \(\) => \{ windowRecovery\.reopen\(\); \}\)/);
  assert.match(main, /render-process-gone",\(_event,details\)=>\{mcpPowerLease\.release\(\);windowRecovery\.pageGone\(mainWindow,details\);\}/);
});
