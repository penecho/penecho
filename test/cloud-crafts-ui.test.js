"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("toolbar ships a Saved Crafts picker wired to community favorites", () => {
  const page = read("public/index.html"), script = read("public/cloud-connect.js"), locale = read("public/locales/zh.js"), css = read("public/style.css");

  assert.match(page, /id="craftsButton"[^>]*aria-controls="craftsPopover"/);
  assert.match(page, /id="craftsButton"[^>]*data-i18n-aria="savedCrafts"/);
  assert.match(page, /id="craftsPopover"[^>]*hidden/);
  assert.match(page, /id="craftsList"/);
  assert.match(page, /id="craftsClose"/);

  assert.match(script, /scope=favorites&sort=newest&limit=60/);
  assert.match(script, /\/api\/cloud\/community\/\$\{encodeURIComponent\(item\.id\)\}\/thumbnail/);
  assert.match(script, /await takeFurther\(item\.id\)/);
  assert.match(script, /Sign in to PenEcho Cloud to see the Crafts you saved/);
  assert.match(script, /No saved Widgets yet/);
  assert.match(script, /setCraftsOpen\(false\)/);

  assert.match(locale, /savedCrafts: "收藏"/);
  assert.match(locale, /savedCraftsTitle: "收藏的 Craft"/);
  assert.match(css, /\.crafts-row/);
  assert.match(css, /\.crafts-modal/);
});
