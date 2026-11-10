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

test("the default Canvas Library project is presented as No Project", () => {
  const app = read("public/app.js"), zh = read("public/locales/zh.js");
  const projectName = vm.runInNewContext(`(${functionSource(app, "serverProjectName")})`, {
    SERVER_DEFAULT_PROJECT_ID:"uncategorized",
    t:(key) => key === "canvasProjectUncategorized" ? "No Project" : key,
  });

  assert.equal(projectName({ id:"uncategorized", name:"Uncategorized", system:true }), "No Project");
  assert.equal(projectName({ id:"project-123", name:"123" }), "123");
  assert.match(app, /canvasProjectUncategorized: "No Project"/);
  assert.match(app, /canvasProjectDeleted: "Project deleted; its canvases moved to No Project"/);
  assert.match(zh, /canvasProjectUncategorized: "无项目"/);
  assert.doesNotMatch(app, /moved to Uncategorized/);
  assert.doesNotMatch(zh, /移到“未分类”/);
});
