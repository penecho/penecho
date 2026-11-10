"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const navigationSource = fs.readFileSync(path.join(root, "src/client/app/canvas-navigation.js"), "utf8");
const styleSource = fs.readFileSync(path.join(root, "public/style.css"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected ${name} in source`);
  const open = source.indexOf("{", start);
  assert.ok(open >= 0, `expected ${name} body`);

  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < source.length; index++) {
    const current = source[index];
    const next = source[index + 1];
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
    else if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

class FakeElement {
  constructor(tagName, owner) {
    this.tagName = tagName.toUpperCase();
    this.owner = owner;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.parentNode = null;
    this.removed = false;
    this.open = false;
    this.dataset = {};
    this.disabled = false;
    this.textContent = "";
    this.closeCalls = 0;
    this.showModalCalls = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "disabled") this.disabled = true;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "disabled") this.disabled = false;
  }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, once: options.once === true });
    this.listeners.set(type, entries);
  }

  dispatch(type) {
    const entries = [...(this.listeners.get(type) || [])];
    for (const entry of entries) {
      if (entry.once) {
        const current = this.listeners.get(type) || [];
        const index = current.indexOf(entry);
        if (index >= 0) current.splice(index, 1);
      }
      entry.listener({ currentTarget: this, target: this, type });
    }
  }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }

  remove() {
    if (this.parentNode) {
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    }
    if (this.owner.currentDialog === this) this.owner.currentDialog = null;
    this.removed = true;
  }

  showModal() {
    this.open = true;
    this.showModalCalls++;
    this.owner.currentDialog = this;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.closeCalls++;
    this.dispatch("close");
  }
}

function createHarness({ images = [], mode = "hand" } = {}) {
  const created = [];
  const body = {
    children: [],
    append(node) {
      node.parentNode = body;
      body.children.push(node);
    },
  };
  const document = {
    body,
    currentDialog: null,
    createElement(tagName) {
      const element = new FakeElement(tagName, document);
      created.push(element);
      return element;
    },
    querySelector(selector) {
      return selector === ".canvas-image-presentation" ? document.currentDialog : null;
    },
  };
  const objectUrls = [];
  const revokedUrls = [];
  const URL = {
    createObjectURL(blob) {
      assert.ok(blob instanceof Blob);
      const url = `blob:image-${objectUrls.length + 1}`;
      objectUrls.push({ blob, url });
      return url;
    },
    revokeObjectURL(url) {
      revokedUrls.push(url);
    },
  };
  const state = { images, mode };
  const showImagePresentation = vm.runInNewContext(
    `(${extractFunction(navigationSource, "showImagePresentation")})`,
    { Blob, URL, document, state, t: key => key },
  );
  return { body, created, document, objectUrls, revokedUrls, showImagePresentation, state };
}

function imageFixture(id, sourceName = id) {
  return {
    id,
    sourceName,
    blob: new Blob([id], { type: "image/png" }),
    x: 40,
    y: 60,
    w: 320,
    h: 180,
  };
}

function dialogImage(dialog) {
  return dialog.children.find(child => child.tagName === "IMG");
}

function dialogCloseButton(dialog) {
  const toolbar = dialog.children.find(child => child.className === "widget-presentation-toolbar");
  return toolbar?.children.find(child => child.getAttribute("aria-label") === "widgetReturnToCanvas");
}

function dialogToolbar(dialog) {
  return dialog.children.find(child => child.className === "widget-presentation-toolbar");
}

function dialogButton(dialog, label) {
  return dialogToolbar(dialog)?.children.find(child => child.getAttribute("aria-label") === label);
}

function dialogZoomOutput(dialog) {
  return dialogToolbar(dialog)?.children.find(child => /^\d+%$/.test(String(child.textContent)));
}

test("image presentation rejects missing, foreign, and non-Blob images", () => {
  const current = imageFixture("current");
  const malformed = { id: "malformed", sourceName: "Malformed", blob: {} };
  const foreign = imageFixture("foreign");
  const harness = createHarness({ images: [current, malformed] });

  for (const item of [null, foreign, malformed]) {
    assert.equal(harness.showImagePresentation(item), false);
    assert.equal(harness.objectUrls.length, 0);
    assert.equal(harness.body.children.length, 0);
  }
});

test("valid image presentation opens without changing Canvas geometry or mode", () => {
  const item = imageFixture("open", "Source image");
  const harness = createHarness({ images: [item], mode: "select" });
  const geometry = { x: item.x, y: item.y, w: item.w, h: item.h };

  assert.equal(harness.showImagePresentation(item), true);
  const dialog = harness.document.currentDialog;
  assert.ok(dialog);
  assert.equal(dialog.className, "canvas-image-presentation widget-maximized");
  assert.equal(dialog.attributes.get("aria-label"), "Source image");
  assert.equal(dialog.showModalCalls, 1);
  assert.equal(harness.objectUrls.length, 1);
  assert.equal(dialogImage(dialog).src, "blob:image-1");
  assert.equal(dialogImage(dialog).alt, "Source image");
  assert.equal(dialogImage(dialog).draggable, false);
  assert.equal(harness.state.mode, "select");
  assert.deepEqual({ x: item.x, y: item.y, w: item.w, h: item.h }, geometry);
});

test("image presentation zoom defaults to 100%, steps by ten, and clamps at both endpoints", () => {
  const item = imageFixture("zoom", "Zoomable image");
  const harness = createHarness({ images: [item], mode: "select" });
  const geometry = { x: item.x, y: item.y, w: item.w, h: item.h };

  assert.equal(harness.showImagePresentation(item), true);
  const dialog = harness.document.currentDialog;
  const image = dialogImage(dialog);
  const zoomOut = dialogButton(dialog, "imageZoomOut");
  const zoomIn = dialogButton(dialog, "imageZoomIn");
  const output = dialogZoomOutput(dialog);
  assert.ok(zoomOut);
  assert.ok(zoomIn);
  assert.ok(output);
  assert.equal(image.dataset.zoom, "100");
  assert.equal(output.textContent, "100%");
  assert.equal(zoomOut.disabled, false);
  assert.equal(zoomIn.disabled, true);
  assert.equal(zoomOut.parentNode, dialogToolbar(dialog));
  assert.equal(zoomIn.parentNode, dialogToolbar(dialog));

  // A forced event on a disabled control still has to respect the upper bound.
  zoomIn.dispatch("click");
  assert.equal(image.dataset.zoom, "100");
  assert.equal(output.textContent, "100%");

  for (const expected of [90, 80, 70, 60, 50]) {
    zoomOut.dispatch("click");
    assert.equal(image.dataset.zoom, String(expected));
    assert.equal(output.textContent, `${expected}%`);
  }
  assert.equal(zoomOut.disabled, true);
  assert.equal(zoomIn.disabled, false);

  // A forced event on a disabled control still has to respect the lower bound.
  zoomOut.dispatch("click");
  assert.equal(image.dataset.zoom, "50");
  assert.equal(output.textContent, "50%");

  for (const expected of [60, 70, 80, 90, 100]) {
    zoomIn.dispatch("click");
    assert.equal(image.dataset.zoom, String(expected));
    assert.equal(output.textContent, `${expected}%`);
  }
  assert.equal(zoomOut.disabled, false);
  assert.equal(zoomIn.disabled, true);
  assert.deepEqual({ x: item.x, y: item.y, w: item.w, h: item.h }, geometry);
  assert.equal(harness.state.mode, "select");
});

test("reopening an image presentation resets zoom to 100% without changing Canvas geometry", () => {
  const item = imageFixture("reopen");
  const harness = createHarness({ images: [item] });
  const geometry = { x: item.x, y: item.y, w: item.w, h: item.h };

  assert.equal(harness.showImagePresentation(item), true);
  const previous = harness.document.currentDialog;
  const zoomOut = dialogButton(previous, "imageZoomOut");
  for (let index = 0; index < 5; index++) zoomOut.dispatch("click");
  assert.equal(dialogImage(previous).dataset.zoom, "50");

  assert.equal(harness.showImagePresentation(item), true);
  const current = harness.document.currentDialog;
  assert.notStrictEqual(current, previous);
  assert.equal(previous.closeCalls, 1);
  assert.equal(dialogImage(current).dataset.zoom, "100");
  assert.equal(dialogZoomOutput(current).textContent, "100%");
  assert.equal(dialogButton(current, "imageZoomOut").disabled, false);
  assert.equal(dialogButton(current, "imageZoomIn").disabled, true);
  assert.deepEqual({ x: item.x, y: item.y, w: item.w, h: item.h }, geometry);
});

test("close button closes the dialog, revokes its Blob URL, and removes it", () => {
  const item = imageFixture("button-close");
  const harness = createHarness({ images: [item] });
  assert.equal(harness.showImagePresentation(item), true);
  const dialog = harness.document.currentDialog;

  dialogCloseButton(dialog).dispatch("click");

  assert.equal(dialog.closeCalls, 1);
  assert.deepEqual(harness.revokedUrls, ["blob:image-1"]);
  assert.equal(dialog.removed, true);
  assert.equal(harness.document.currentDialog, null);
  assert.equal(harness.body.children.length, 0);
});

test("double-clicking the image closes and cleans up the presentation", () => {
  const item = imageFixture("double-click");
  const harness = createHarness({ images: [item] });
  assert.equal(harness.showImagePresentation(item), true);
  const dialog = harness.document.currentDialog;

  dialogImage(dialog).dispatch("dblclick");

  assert.equal(dialog.closeCalls, 1);
  assert.deepEqual(harness.revokedUrls, ["blob:image-1"]);
  assert.equal(dialog.removed, true);
  assert.equal(harness.body.children.length, 0);
});

test("opening another image closes and cleans up the previous presentation first", () => {
  const first = imageFixture("first");
  const second = imageFixture("second");
  const harness = createHarness({ images: [first, second] });

  assert.equal(harness.showImagePresentation(first), true);
  const previous = harness.document.currentDialog;
  assert.equal(harness.showImagePresentation(second), true);
  const current = harness.document.currentDialog;

  assert.equal(previous.closeCalls, 1);
  assert.equal(previous.removed, true);
  assert.deepEqual(harness.revokedUrls, ["blob:image-1"]);
  assert.notStrictEqual(current, previous);
  assert.equal(current.showModalCalls, 1);
  assert.deepEqual(harness.objectUrls.map(entry => entry.url), ["blob:image-1", "blob:image-2"]);
  assert.deepEqual(harness.body.children, [current]);
});

test("image presentation CSS contains the full image without cropping", () => {
  const dialogRule = styleSource.match(/\.canvas-image-presentation\s*\{[^}]*\}/)?.[0] || "";
  const imageRule = styleSource.match(/\.canvas-image-presentation\s*>\s*img\s*\{[^}]*\}/)?.[0] || "";

  assert.match(dialogRule, /width:\s*100%/);
  assert.match(dialogRule, /height:\s*100dvh/);
  assert.match(dialogRule, /max-width:\s*none/);
  assert.match(dialogRule, /max-height:\s*none/);
  assert.match(imageRule, /width:\s*100%/);
  assert.match(imageRule, /height:\s*100%/);
  assert.match(imageRule, /object-fit:\s*contain/);
  assert.match(imageRule, /object-position:\s*center/);
});
