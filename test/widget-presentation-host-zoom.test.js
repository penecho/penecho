"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/client/app/canvas-runtime.js"), "utf8");

function extractFunction(sourceText, name) {
  const start = sourceText.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const body = sourceText.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = body; index < sourceText.length; index++) {
    const current = sourceText[index];
    const next = sourceText[index + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(current)) {
      quote = current;
      continue;
    }
    if (current === "{") depth++;
    else if (current === "}" && --depth === 0) return sourceText.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

function harness({ maximized, presentationZoom = 100, presentationWidth = 640 } = {}) {
  const messages = [];
  const classChanges = [];
  const shell = {
    clientWidth: 1000,
    classList: {
      toggle(name, enabled) { classChanges.push([name, enabled]); },
    },
    tabIndex: -1,
  };
  const frame = {
    inert: false,
    contentWindow: {
      postMessage(message, origin) { messages.push({ message, origin }); },
    },
  };
  const widget = {
    id: "widget-zoom",
    maximized,
    presentationZoom,
    presentationWidth,
    contentW: 320,
    contentH: 200,
    w: 160,
    h: 100,
    shell,
    frame,
    hostReady: true,
    renderActive: true,
    fitContent: false,
    fitContentAxes: null,
    hostStateKey: null,
    pending: false,
  };
  const state = {
    scale: 2,
    viewMode: false,
    mode: "select",
    navigationLocked: false,
    widgetEdit: null,
    selectedWidgetId: null,
  };
  const context = {
    canvasWidgetInteractive: () => false,
    canvasWidgetSelectionEnabled: () => true,
    getComputedStyle: () => ({ paddingLeft: "20px", paddingRight: "20px" }),
    location: { origin: "https://canvas.test" },
    state,
    syncMcpWidgetProgress() {},
  };
  const sendWidgetHostState = vm.runInNewContext(
    `(${extractFunction(source, "sendWidgetHostState")})`,
    context,
  );
  return { classChanges, frame, messages, sendWidgetHostState, shell, state, widget };
}

test("maximized Widget host scale applies available width, presentation width, and zoom percent", () => {
  const h = harness({ maximized: true, presentationZoom: 50, presentationWidth: 640 });
  const geometry = { w: h.widget.w, h: h.widget.h, contentW: h.widget.contentW, contentH: h.widget.contentH };

  h.sendWidgetHostState(h.widget, undefined, undefined, true);

  assert.equal(h.messages.length, 1);
  const message = h.messages[0].message;
  assert.equal(message.type, "penecho-widget-state");
  assert.equal(message.maximized, true);
  assert.equal(message.viewportWidth, 640);
  assert.equal(message.fitContent, false);
  assert.equal(message.fitContentAxes, null);
  assert.equal(message.selected, false);
  assert.equal(message.interactive, false);
  assert.equal(message.active, true);
  assert.equal(message.navigationLocked, false);
  assert.equal(message.scaleX, 0.75);
  assert.equal(message.scaleY, 0.75);
  assert.equal(h.messages[0].origin, "https://canvas.test");
  assert.deepEqual({ w: h.widget.w, h: h.widget.h, contentW: h.widget.contentW, contentH: h.widget.contentH }, geometry);
});

test("leaving maximized mode restores the normal Canvas zoom scale", () => {
  const h = harness({ maximized: true, presentationZoom: 50, presentationWidth: 640 });

  h.sendWidgetHostState(h.widget, undefined, undefined, true);
  h.widget.maximized = false;
  h.widget.presentationWidth = null;
  h.widget.presentationZoom = 100;
  h.sendWidgetHostState(h.widget, undefined, undefined, true);

  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[0].message.scaleX, 0.75);
  assert.equal(h.messages[0].message.scaleY, 0.75);
  assert.equal(h.messages[1].message.maximized, false);
  assert.equal(h.messages[1].message.viewportWidth, undefined);
  assert.equal(h.messages[1].message.scaleX, 1);
  assert.equal(h.messages[1].message.scaleY, 1);
});

test("a logical viewport width change is sent even when the display scale stays the same", () => {
  const h = harness({ maximized:true, presentationWidth:640 });
  h.sendWidgetHostState(h.widget);
  h.widget.presentationWidth = 1280;
  h.shell.clientWidth = 1960;
  h.sendWidgetHostState(h.widget);
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[0].message.scaleX, h.messages[1].message.scaleX);
  assert.equal(h.messages[1].message.viewportWidth, 1280);
});
