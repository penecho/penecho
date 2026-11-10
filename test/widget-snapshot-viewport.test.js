"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/widget-host.js"), "utf8");

function extractFunction(sourceText, name) {
  const start = sourceText.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const body = sourceText.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = body; index < sourceText.length; index++) {
    const current = sourceText[index];
    const next = sourceText[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (["'", '"', "`"].includes(current)) {
      quote = current;
      continue;
    }
    if (current === "{") depth++;
    else if (current === "}" && --depth === 0) return sourceText.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function harness({ maximized = false, innerWidth = 640, innerHeight = 480, presentationScale = 1 } = {}) {
  const timers = new Map();
  const listeners = new Map();
  let nextTimer = 1;
  const context = {
    clearTimeout(id) { timers.delete(id); },
    innerHeight,
    innerWidth,
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    widgetState: { maximized, scaleX: presentationScale, scaleY: presentationScale },
    addEventListener(type, listener) {
      const entries = listeners.get(type) || new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  const waitForSnapshotViewport = vm.runInNewContext(
    `(${extractFunction(source, "waitForSnapshotViewport")})`,
    context,
  );
  return {
    context,
    listeners,
    timers,
    waitForSnapshotViewport,
    dispatchResize() {
      for (const listener of [...(listeners.get("resize") || [])]) listener();
    },
    fireTimeout() {
      const entry = timers.entries().next().value;
      assert.ok(entry, "expected a viewport timeout");
      entry[1].callback();
    },
  };
}

test("maximized presentation accepts a different live viewport without a timeout or resize listener", async () => {
  for (const presentationScale of [0.5, 1]) {
    const h = harness({ maximized: true, innerWidth: 640, innerHeight: 480, presentationScale });
    await h.waitForSnapshotViewport(1200, 900, 5000);
    assert.equal(h.timers.size, 0, `${presentationScale}x should not schedule a timeout`);
    assert.equal(h.listeners.get("resize")?.size || 0, 0, `${presentationScale}x should not wait for resize`);
  }
});

test("ordinary matching viewport resolves immediately and installs no listeners", async () => {
  const h = harness({ maximized: false, innerWidth: 1200, innerHeight: 900 });

  await h.waitForSnapshotViewport(1200, 900, 5000);

  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.get("resize")?.size || 0, 0);
});

test("ordinary mismatched viewport resolves after resize and cleans up timer and listener", async () => {
  const h = harness({ maximized: false, innerWidth: 640, innerHeight: 480 });
  const pending = h.waitForSnapshotViewport(1200, 900, 5000);

  assert.equal(h.timers.size, 1);
  assert.equal(h.timers.values().next().value.delay, 1000);
  assert.equal(h.listeners.get("resize")?.size, 1);

  h.context.innerWidth = 1200;
  h.context.innerHeight = 900;
  h.dispatchResize();
  await pending;

  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.get("resize")?.size, 0);
});

test("ordinary mismatched viewport rejects on timeout and cleans up timer and listener", async () => {
  const h = harness({ maximized: false, innerWidth: 640, innerHeight: 480 });
  const pending = h.waitForSnapshotViewport(1200, 900, 5000);

  h.fireTimeout();
  await assert.rejects(pending, /Preview viewport did not finish resizing before capture/);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.get("resize")?.size, 0);
});

test("after leaving maximized mode, viewport matching is strict again", async () => {
  const h = harness({ maximized: true, innerWidth: 640, innerHeight: 480, presentationScale: 0.5 });

  await h.waitForSnapshotViewport(1200, 900, 5000);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.get("resize")?.size || 0, 0);

  h.context.widgetState.maximized = false;
  const pending = h.waitForSnapshotViewport(1200, 900, 5000);
  assert.equal(h.timers.size, 1);
  assert.equal(h.listeners.get("resize")?.size, 1);

  h.context.innerWidth = 1200;
  h.context.innerHeight = 900;
  h.dispatchResize();
  await pending;
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.get("resize")?.size, 0);
});
