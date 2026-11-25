"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("remaining Help and Canvas hint translations resolve in English and Chinese", () => {
  const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const app = read("public/app.js"), context = { window:{} };
  vm.runInNewContext(read("public/locales/zh.js"), context);
  const en = Object.fromEntries([...app.matchAll(/^\s+(helpMenu|helpShortcuts|helpFeedback|aiHint|aiHintDone): (".*"),?$/gm)].map(match => [match[1], JSON.parse(match[2])]));
  for (const strings of [en, context.window.PENECHO_LOCALES.zh]) {
    for (const key of ["helpMenu", "helpShortcuts", "helpFeedback", "aiHint", "aiHintDone"]) assert.ok(strings[key], key);
  }
});
