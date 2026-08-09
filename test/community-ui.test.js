"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Cloud Center is separate from local Settings and exposes the complete community workflow", () => {
  const html = read("public/index.html"), cloud = read("public/cloud-connect.js"), css = read("public/cloud-connect.css");
  assert.match(html, /id="settingsBtn"/);
  assert.match(html, /id="cloudAccountBtn"/);
  assert.match(html, /id="shareCanvasBtn"/);
  assert.match(cloud, /\["widget", "Widgets"/);
  assert.match(cloud, /\["canvas", "Canvases"/);
  for (const sort of ["recommended", "newest", "downloads", "favorites", "price_low", "price_high"]) assert.match(cloud, new RegExp(`value:\"${sort}\"`));
  for (const pricing of ["all", "free", "paid"]) assert.match(cloud, new RegExp(`value:\"${pricing}\"`));
  assert.match(cloud, /\/api\/cloud\/community\/\$\{encodeURIComponent\(item\.id\)\}\/preview/);
  assert.match(cloud, /priceCredits:Number\(price\.value \|\| 0\)/);
  assert.match(cloud, /Your public link is ready/);
  assert.match(cloud, /Cloud Projects/);
  assert.match(cloud, /Private cross-device work/);
  assert.match(cloud, /\/api\/cloud\/library/);
  assert.match(cloud, /Save current Canvas/);
  assert.match(cloud, /window\.PenEchoCloudProjects/);
  assert.match(cloud, /base-revision-required/);
  assert.match(css, /\.cloud-item-preview/);
  assert.match(css, /\.cloud-project-card/);
});

test("community artifacts have bounded WebP previews and import both Widgets and Canvases locally", () => {
  const app = read("public/app.js"), main = read("src/server/main.js");
  assert.match(app, /maximumBytes=4\*1024\*1024/);
  assert.match(app, /snapshotPreview\(2048,1365\)/);
  assert.match(app, /communityPreviewForCanvas\(canvas, \.82\)/);
  assert.match(app, /async function importCommunityCanvasArtifact/);
  assert.match(app, /importCanvas:importCommunityCanvasArtifact/);
  assert.match(main, /PENECHO_CLOUD_ENV/);
  assert.match(main, /PENECHO_CLOUD_ORIGIN/);
  assert.match(main, /http:\/\/127\.0\.0\.1:18082/);
  assert.match(main, /https:\/\/penecho\.ai/);
});
