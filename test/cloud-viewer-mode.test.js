"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the read-only viewer mode ships inert locally and activates only on /canvas/view", () => {
  const html = read("public/index.html"), js = read("public/viewer.js"), css = read("public/viewer.css");
  assert.match(html, /<link rel="stylesheet" href="viewer\.css">/);
  assert.match(html, /<script src="viewer\.js" defer><\/script>/);
  assert.match(js, /canvas\\\/view\\\//);
  assert.match(js, /PenEchoCommunityCanvas/);
  assert.match(js, /importWidget|importCanvas/);
  assert.match(js, /\/api\/v1\/auth\/session/);
  assert.match(js, /Read-only — link a device to edit/);
  assert.doesNotMatch(js, /PENECHO_CONFIG\?\.viewer/);
  assert.match(css, /html\.viewer-mode \.topbar[,\s]/);
  assert.match(css, /pointer-events: none !important/);
  assert.match(css, /viewer-topbar/);
});

test("the cloud sync allow-list carries the viewer assets", () => {
  const cloudRoot = path.resolve(root, "..", "penecho_cloud");
  const sync = fs.readFileSync(path.join(cloudRoot, "tools", "sync-public-canvas.mjs"), "utf8");
  assert.match(sync, /"viewer\.js"/);
  assert.match(sync, /"viewer\.css"/);
  assert.ok(fs.existsSync(path.join(cloudRoot, "public", "canvas", "viewer.js")));
  assert.ok(fs.existsSync(path.join(cloudRoot, "public", "canvas", "viewer.css")));
});
