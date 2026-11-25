"use strict";
require("./helpers/safety.js");
const test = require("node:test"), assert = require("node:assert/strict"), { EventEmitter } = require("node:events");
const { createInitialWindowVisibility, watchInitialWindowLoad, INITIAL_SHOW_MS, INITIAL_LOAD_MS } = require("../desktop/startup-window.js");

const tick = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const window = new EventEmitter(), app = new EventEmitter(), timers = new Map(), events = [];
  let visible = false, minimized = false, destroyed = false, quitting = false, shows = 0, timerId = 0;
  Object.assign(window, {
    webContents:new EventEmitter(), isVisible:() => visible, isMinimized:() => minimized, isDestroyed:() => destroyed,
    show() { shows++; visible = true; minimized = false; this.emit("show"); },
    hide() { visible = false; this.emit("hide"); },
    minimize() { minimized = true; this.emit("minimize"); },
    restore() { minimized = false; this.emit("restore"); },
    close() { destroyed = true; this.emit("closed"); },
  });
  return {
    window, app, events, timers, get shows() { return shows; },
    quit() { quitting = true; app.emit("before-quit"); },
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.callback(); } },
    options:{ window, app, gate:Promise.resolve(), isQuitting:() => quitting, onEvent:(event, detail) => events.push({ event, ...detail }),
      setTimer:(callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; }, clearTimer:id => timers.delete(id) },
  };
}

for (const trigger of ["ready", "load", "timer"]) test(`initial window opens via ${trigger} without the other readiness events`, async () => {
  const f = fixture(); createInitialWindowVisibility(f.options);
  if (trigger === "ready") f.window.emit("ready-to-show");
  if (trigger === "load") f.window.webContents.emit("did-finish-load");
  if (trigger === "timer") f.fire(INITIAL_SHOW_MS);
  await tick();
  assert.equal(f.shows, 1); assert(f.window.isVisible()); assert.equal(f.timers.size, 0);
  f.window.hide(); f.window.emit("ready-to-show"); f.window.webContents.emit("did-finish-load"); f.fire(INITIAL_SHOW_MS);
  await tick(); assert.equal(f.shows, 1); assert.equal(f.window.isVisible(), false);
});

test("overlapping initial triggers await the installer gate and show only once", async () => {
  const f = fixture(), gate = deferred();
  const { whenShown } = createInitialWindowVisibility({ ...f.options, gate:gate.promise });
  let visible = false;
  void whenShown.then(shown => { visible = shown; });
  f.window.emit("ready-to-show"); f.window.webContents.emit("did-finish-load"); f.fire(INITIAL_SHOW_MS);
  await tick(); assert.equal(f.shows, 0); assert.equal(visible, false);
  gate.resolve(); await tick(); assert.equal(f.shows, 1); assert.equal(visible, true);
  assert.equal(f.events.filter(e => e.event === "initial-show-requested").length, 1);
});

for (const action of ["hide", "minimize", "close", "quit"]) test(`a pending initial reveal cannot undo ${action}`, async () => {
  const f = fixture(), gate = deferred();
  const { whenShown } = createInitialWindowVisibility({ ...f.options, gate:gate.promise });
  f.fire(INITIAL_SHOW_MS);
  if (action === "hide" || action === "minimize") { f.window.show(); f.window[action](); }
  else if (action === "quit") f.quit();
  else f.window.close();
  const before = f.shows;
  gate.resolve(); await tick(); assert.equal(f.shows, before); assert.equal(f.timers.size, 0);
  assert.equal(await whenShown, action === "hide" || action === "minimize");
  if (action === "hide") assert.equal(f.window.isVisible(), false);
  if (action === "minimize") assert.equal(f.window.isMinimized(), true);
});

test("explicit reopening remains possible after initial visibility completes", async () => {
  const f = fixture(); createInitialWindowVisibility(f.options);
  f.fire(INITIAL_SHOW_MS); await tick(); f.window.hide(); f.window.show();
  assert.equal(f.shows, 2); assert(f.window.isVisible());
});

test("load failure and loadURL rejection share one dialog; Reload starts a fresh attempt", async () => {
  const f = fixture(), response = deferred(); let loads = 0, dialogs = 0;
  f.window.show();
  const guard = watchInitialWindowLoad({ ...f.options,
    load:() => { loads++; return loads === 1 ? Promise.reject(Object.assign(new Error("private URL must not be logged"), { code:"ERR_FAILED" })) : new Promise(() => {}); },
    showDialog:async kind => { dialogs++; assert.equal(kind, "failed"); return response.promise; },
  });
  guard.start(); f.window.webContents.emit("did-fail-load", {}, -2, "private detail", "private URL", true);
  await tick(); assert.equal(dialogs, 1);
  response.resolve({ response:0 }); await tick();
  // Use a successful notification to settle the retried initial navigation.
  f.window.webContents.emit("did-finish-load"); await tick();
  assert.equal(loads, 2); assert.equal(f.timers.size, 0);
  assert(!JSON.stringify(f.events).includes("private"));
});

test("cancelled navigations and subframe failures do not report startup errors", async () => {
  const f = fixture(); let dialogs = 0;
  f.window.show(); const guard = watchInitialWindowLoad({ ...f.options,
    load:() => Promise.reject(Object.assign(new Error("cancelled"), { code:"ERR_ABORTED" })),
    showDialog:async () => { dialogs++; return { response:0 }; },
  });
  guard.start(); f.window.webContents.emit("did-fail-load", {}, -3, "", "", true);
  f.window.webContents.emit("did-fail-load", {}, -2, "", "", false); await tick();
  assert.equal(dialogs, 0); f.window.webContents.emit("did-finish-load"); assert.equal(f.timers.size, 0);
});

test("slow-load feedback respects the gate and defers until a minimized window is reopened", async () => {
  const f = fixture(), gate = deferred(); let dialogs = 0;
  f.window.show(); f.window.minimize();
  const guard = watchInitialWindowLoad({ ...f.options, gate:gate.promise, load:() => new Promise(() => {}),
    showDialog:async kind => { dialogs++; assert.equal(kind, "slow"); return { response:0 }; },
  });
  guard.start(); f.fire(INITIAL_LOAD_MS); await tick(); assert.equal(dialogs, 0);
  gate.resolve(); await tick(); assert.equal(dialogs, 0);
  f.window.restore(); await tick(); assert.equal(dialogs, 1);
  f.fire(INITIAL_LOAD_MS); await tick(); assert.equal(dialogs, 1, "Keep Waiting does not loop dialogs");
  guard.dispose();
});

test("readiness prevents the initial slow-load warning but a real load failure still reports", async () => {
  const f = fixture(); let dialogs = 0;
  f.window.show(); const guard = watchInitialWindowLoad({ ...f.options, load:() => new Promise(() => {}),
    showDialog:async kind => { dialogs++; assert.equal(kind, "failed"); return { response:1 }; },
  });
  guard.start(); f.window.emit("ready-to-show"); f.fire(INITIAL_LOAD_MS); await tick(); assert.equal(dialogs, 0);
  f.window.webContents.emit("did-fail-load", {}, -2, "", "", true); await tick();
  assert.equal(dialogs, 1); assert(f.window.isDestroyed());
});

test("successful loading invalidates a pending dialog response and clears all startup work", async () => {
  const f = fixture(), response = deferred(); let loads = 0, signal;
  f.window.show(); const guard = watchInitialWindowLoad({ ...f.options, load:() => { loads++; return new Promise(() => {}); },
    showDialog:async (_kind, abortSignal) => { signal = abortSignal; return response.promise; },
  });
  guard.start(); f.fire(INITIAL_LOAD_MS); await tick();
  f.window.webContents.emit("did-finish-load"); assert(signal.aborted);
  response.resolve({ response:1 }); await tick(); assert.equal(loads, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.app.listenerCount("before-quit"), 0);
});

for (const action of ["close", "quit"]) test(`startup feedback is cancelled by ${action} while awaiting the gate`, async () => {
  const f = fixture(), gate = deferred(); let dialogs = 0;
  f.window.show(); const guard = watchInitialWindowLoad({ ...f.options, gate:gate.promise, load:() => new Promise(() => {}),
    showDialog:async () => { dialogs++; return { response:1 }; },
  });
  guard.start(); f.fire(INITIAL_LOAD_MS);
  if (action === "close") f.window.close(); else f.quit();
  gate.resolve(); await tick(); assert.equal(dialogs, 0); assert.equal(f.timers.size, 0);
});
