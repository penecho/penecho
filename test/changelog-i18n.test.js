"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("release note translation keys resolve to prose in English and Chinese", () => {
  const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const html = read("public/index.html");
  const app = read("public/app.js");
  const section = html.slice(html.indexOf('id="changelogLayer"'), html.indexOf('<script src="remote-canvas.js"'));
  const keys = [...section.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]);
  assert.ok(keys.includes("changelogNotesCards"));
  const en = Object.fromEntries([...app.matchAll(/^\s+(changelog\w+): (".*"),?$/gm)].map(match => [match[1], JSON.parse(match[2])]));
  const context = { window: {} };
  vm.runInNewContext(read("public/locales/zh.js"), context);
  const I18N = { en, zh: context.window.PENECHO_LOCALES.zh };
  const lookup = app.match(/const t = (\(key\) => [^;]+);/);
  assert.ok(lookup, "production translation lookup exists");
  for (const language of ["en", "zh"]) {
    const t = vm.runInNewContext(`(${lookup[1]})`, { I18N, state: { language } });
    for (const key of keys) {
      assert.ok(I18N[language][key], `${language} translation missing for ${key}`);
      assert.notEqual(t(key), key, `${language} must not show a translation key`);
    }
    assert.match(t("changelogNotesCards"), /notes|笔记/);
  }
});
