"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const {
  closeDialogOptions,
  attachWindowCloseGuard,
  destroyHelperWindows,
} = require("../desktop/window-close.js");

const ROOT = path.resolve(__dirname, "..");

function fakeDesktopFixture({ language = "en", forceUnload = false, dialogResponses = [0], syncResponses = [0] } = {}) {
  const app = new EventEmitter();
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  window.webContents.isDestroyed = () => window.destroyed;

  let quitting = false;
  const calls = [];
  const dialogs = [];
  const syncDialogs = [];

  app.quit = () => {
    calls.push("app.quit");
    quitting = true;
    app.emit("before-quit");
    window.close();
  };

  window.destroy = () => {
    calls.push("window.destroy");
    if (window.destroyed) return;
    window.destroyed = true;
    window.emit("closed");
    calls.push("window.closed");
  };

  window.close = () => {
    calls.push("window.close");
    if (window.destroyed) return;
    window.emit("close", { preventDefault() {} });
    let allowed = false;
    const ev = { preventDefault() { allowed = true; } };
    window.webContents.emit("will-prevent-unload", ev);
    if (allowed) {
      window.destroyed = true;
      window.emit("closed");
      calls.push("window.closed");
    }
  };

  const guard = attachWindowCloseGuard({
    window,
    app,
    getLanguage:() => language,
    isQuitting:() => quitting,
    resetQuitting:() => { quitting = false; calls.push("resetQuitting"); },
    shouldForceUnload:() => forceUnload,
    showDialog:async options => {
      dialogs.push(options);
      const next = dialogResponses.shift() ?? 1;
      return typeof next === "function" ? next(options) : { response:next };
    },
    showDialogSync:options => {
      syncDialogs.push(options);
      return syncResponses.shift() ?? 1;
    },
  });

  return { app, window, guard, calls, dialogs, syncDialogs, isQuitting:() => quitting };
}

test("clicking X when a frame prevents beforeunload prompts once and closes when confirmed", async () => {
  const f = fakeDesktopFixture({ language:"en", dialogResponses:[0] });
  f.window.close();
  // Rapid second X click while the confirmation dialog is open must not stack another prompt.
  f.window.close();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(f.dialogs.length, 1);
  assert.equal(f.dialogs[0].title, "Close PenEcho?");
  assert.deepEqual(f.dialogs[0].buttons, ["Close", "Stay"]);
  assert.equal(f.window.isDestroyed(), true);
  assert.deepEqual(f.calls, ["window.close", "window.close", "window.destroy", "window.closed"]);
  assert.equal(f.window.webContents.listenerCount("will-prevent-unload"), 0, "cleans up listener on close");
});

test("choosing Stay keeps the window open, resets quitting from File->Exit, and allows closing later", async () => {
  const f = fakeDesktopFixture({ language:"zh", dialogResponses:[1, 0] });
  f.app.quit();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(f.dialogs.length, 1);
  assert.equal(f.dialogs[0].title, "关闭 PenEcho？");
  assert.deepEqual(f.dialogs[0].buttons, ["关闭", "留下"]);
  assert.equal(f.window.isDestroyed(), false);
  assert.equal(f.isQuitting(), false, "cancelling a quit dialog must reset quitting state");

  // Clicking X later still prompts and closes when confirmed.
  f.window.close();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.dialogs.length, 2);
  assert.equal(f.window.isDestroyed(), true);
});

test("non-close beforeunload (page reload/navigation) prompts synchronously without closing the window", () => {
  const f = fakeDesktopFixture({ language:"en", syncResponses:[1, 0] });
  let prevented1 = false;
  f.window.webContents.emit("will-prevent-unload", { preventDefault() { prevented1 = true; } });
  assert.equal(prevented1, false);
  assert.equal(f.syncDialogs.length, 1);
  assert.equal(f.syncDialogs[0].title, "Leave this page?");
  assert.equal(f.window.isDestroyed(), false);

  let prevented2 = false;
  f.window.webContents.emit("will-prevent-unload", { preventDefault() { prevented2 = true; } });
  assert.equal(prevented2, true);
  assert.equal(f.window.isDestroyed(), false);
});

test("forced unload (e.g. installing update) bypasses beforeunload immediately without prompting", () => {
  const f = fakeDesktopFixture({ forceUnload:true });
  f.window.close();
  assert.equal(f.dialogs.length, 0);
  assert.equal(f.window.isDestroyed(), true);
});

test("destroyHelperWindows destroys only live helper windows", () => {
  const destroyed = [];
  const makeWin = (name, { isDestroyed = false } = {}) => ({
    name,
    isDestroyed:() => isDestroyed,
    destroy:() => destroyed.push(name),
  });
  const helperA = makeWin("helperA");
  const helperDead = makeWin("helperDead", { isDestroyed:true });
  const main = makeWin("main");
  const helpers = new Set([helperA, helperDead]);
  destroyHelperWindows([main, helperA, helperDead], w => helpers.has(w));
  assert.deepEqual(destroyed, ["helperA"]);

  assert.equal(closeDialogOptions("en").cancelId, 1);
  assert.equal(closeDialogOptions("zh").cancelId, 1);
});

test("desktop main, helper windows, and Canvas shell bridge wire close protection and clean dormant unload", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8");
  const picture = fs.readFileSync(path.join(ROOT, "src", "server", "project-lines", "page-picture.js"), "utf8");
  const browserEngine = fs.readFileSync(path.join(ROOT, "src", "server", "project-lines", "browser-engine.js"), "utf8");
  const bridge = fs.readFileSync(path.join(ROOT, "src", "client", "app", "project-lines-bridge.js"), "utf8");
  const docs = fs.readFileSync(path.join(ROOT, "src", "client", "app", "canvas-documents.js"), "utf8");
  const notes = fs.readFileSync(path.join(ROOT, "src", "client", "app", "note-cards.js"), "utf8");

  assert.match(main, /attachWindowCloseGuard\(/);
  assert.match(main, /function shutdownServices\(\) \{[\s\S]*?serverProcess\?\.stop\(\)/);
  assert.match(main, /app\.on\("will-quit"/);
  assert.match(picture, /will-prevent-unload/);
  assert.match(browserEngine, /will-prevent-unload/);
  assert.match(bridge, /function projectLinesShellDormant\(\)/);
  assert.match(bridge, /canvasDocumentsDraft\.savedKey = projectLinesRun\.savedKey;/);
  assert.match(docs, /projectLinesShellDormant\(\)/);
  assert.match(notes, /projectLinesShellDormant\(\)/);
});
