"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const body = source.indexOf("{", start);
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
};

function fakeImage(complete) {
  const listeners = new Map();
  return {
    complete,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of [...(listeners.get(type) || [])]) listener();
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

function verifyDeferredLifecycle(source, helperName, releaseName, mapName) {
  const revoked = [], pending = fakeImage(false), complete = fakeImage(true),
    urls = new Map([["blob:pending", pending], ["blob:complete", complete]]),
    URL = { revokeObjectURL:(url) => revoked.push(url) },
    controller = new AbortController(),
    loader = { observer:{ disconnect(){ this.disconnected = true; } }, queue:["pending"], controllers:new Set([controller]) },
    context = vm.createContext({ URL, [mapName]:urls, historyPreviewLoader:loader, queueMicrotask:callback=>callback() });
  vm.runInContext(`${functionSource(source, helperName)}\n${functionSource(source, releaseName)}`, context);
  const release = context[releaseName];

  release(urls);
  assert.equal(urls.size, 0);
  if (releaseName === "releaseHistoryPreviewUrls") {
    assert.equal(context.historyPreviewLoader, null);
    assert.equal(loader.observer.disconnected, true);
    assert.equal(loader.queue.length, 0);
    assert.equal(controller.signal.aborted, true);
  }
  assert.deepEqual(revoked, ["blob:complete"]);
  assert.equal(pending.listenerCount("load"), 1);
  assert.equal(pending.listenerCount("error"), 1);

  pending.dispatch("load");
  assert.deepEqual(revoked, ["blob:complete", "blob:pending"]);
  assert.equal(pending.listenerCount("load"), 0);
  assert.equal(pending.listenerCount("error"), 0);
}

test("Canvas preview URLs survive rerenders until pending image requests settle", () => {
  const persistence = read("src/client/app/persistence.js"),
    navigator = read("src/client/app/studio-navigator.js");

  assert.match(persistence, /historyPreviewUrls = new Map\(\)/);
  assert.match(persistence, /historyPreviewUrls\.set\(url, image\)/);
  verifyDeferredLifecycle(persistence, "revokeHistoryPreviewUrlWhenSettled", "releaseHistoryPreviewUrls", "historyPreviewUrls");

  assert.match(navigator, /studioNavigatorWorkPreviewUrls = new Map\(\)/);
  assert.match(navigator, /urls\.set\(url, image\)/);
  verifyDeferredLifecycle(navigator, "revokeStudioNavigatorPreviewUrlWhenSettled", "releaseStudioNavigatorPreviewUrls", "urls");
});

test("Studio navigator refreshes only the visible history tab", () => {
  const persistence = read("src/client/app/persistence.js"),
    navigator = read("src/client/app/studio-navigator.js"),
    renderSnapshotLists = functionSource(persistence, "renderStudioSnapshotLists"),
    refreshSource = navigator.slice(navigator.indexOf("async function refreshStudioNavigatorSource("), navigator.indexOf("function refreshStudioNavigatorSources(")),
    renderActive = functionSource(navigator, "renderActiveStudioNavigatorHistory");

  assert.match(renderSnapshotLists, /PenEchoStudioNavigator\?\.render\?\.\(\)/);
  assert.doesNotMatch(renderSnapshotLists, /renderWork|renderCanvases|renderAgent/);
  assert.match(refreshSource, /renderActiveStudioNavigatorHistory\(\)/);
  assert.doesNotMatch(refreshSource, /renderStudioWorkHistory\(\)|renderStudioCanvasHistory\(\)|renderStudioAgentHistory\(\)/);
  assert.match(renderActive, /studioNavigatorActiveTab==="canvas"[\s\S]*?renderStudioCanvasHistory\(\)[\s\S]*?studioNavigatorActiveTab==="agent"[\s\S]*?renderStudioAgentHistory\(\)[\s\S]*?renderStudioWorkHistory\(\)/);
});

test("Canvas Library creates preview images only while its manager is open", () => {
  const persistence = read("src/client/app/persistence.js"),
    renderSnapshotList = functionSource(persistence, "renderSnapshotList"),
    openHistoryPanel = functionSource(persistence, "openHistoryPanel"),
    closeHistoryPanel = functionSource(persistence, "closeHistoryPanel");

  assert.match(renderSnapshotList, /#historyPanel[\s\S]*?classList\.contains\("open"\)[\s\S]*?releaseHistoryPreviewUrls\(\)[\s\S]*?list\.replaceChildren\(\)[\s\S]*?renderStudioSnapshotLists\(\)[\s\S]*?return/);
  assert.match(openHistoryPanel, /classList\.add\("open"\)[\s\S]*?renderSnapshotList\(\)[\s\S]*?if \(refresh\) refreshSnapshots/);
  assert.match(closeHistoryPanel, /setTimeout[\s\S]*?historyList[\s\S]*?replaceChildren\(\)[\s\S]*?releaseHistoryPreviewUrls\(\)/);
});
