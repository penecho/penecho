"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PACKAGE_JSON = require("../package.json");
const {
  MINIMUM_NODE_VERSION,
  isSupportedNodeVersion,
  parsedNodeVersion,
  unsupportedNodeMessage,
} = require("../src/cli/node-version.js");

const ROOT = path.resolve(__dirname, "..");

test("Node.js support boundary matches the published engine requirement", () => {
  assert.equal(PACKAGE_JSON.engines.node, `>=${MINIMUM_NODE_VERSION}`);
  assert.deepEqual(parsedNodeVersion("v22.19.0"), [22, 19, 0]);
  assert.equal(isSupportedNodeVersion("20.19.5"), false);
  assert.equal(isSupportedNodeVersion("22.18.0"), false);
  assert.equal(isSupportedNodeVersion("22.19.0"), true);
  assert.equal(isSupportedNodeVersion("24.0.0"), true);
  assert.equal(isSupportedNodeVersion("invalid"), false);
});

test("unsupported Node.js output tells existing users how to recover", () => {
  const message = unsupportedNodeMessage("20.19.5");
  assert.ok(message.startsWith(`PenEcho ${PACKAGE_JSON.version} requires Node.js 22.19.0 or newer`));
  assert.match(message, /current: 20\.19\.5/);
  assert.match(message, /Upgrade Node\.js/);
  assert.match(message, /npm install --global penecho@latest/);
  assert.match(message, /https:\/\/nodejs\.org\//);
});

test("the npm preinstall gate fails clearly under Node.js 20", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-node-version-test-"));
  test.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const preload = path.join(directory, "node20.cjs");
  fs.writeFileSync(preload, 'Object.defineProperty(process.versions, "node", { value:"20.19.5" });\n');
  const result = spawnSync(process.execPath, ["--require", preload, path.join(ROOT, "src/cli/node-version.js")], { encoding:"utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires Node\.js 22\.19\.0 or newer/);
  assert.match(result.stderr, /Upgrade Node\.js/);

  const cliResult = spawnSync(process.execPath, ["--require", preload, path.join(ROOT, "cli.js")], { encoding:"utf8" });
  assert.equal(cliResult.status, 1);
  assert.match(cliResult.stderr, /requires Node\.js 22\.19\.0 or newer/);
  assert.doesNotMatch(cliResult.stderr, /DeepSeek|node:sqlite|ERR_REQUIRE_ESM|Promise\.withResolvers/);
});

test("the public CLI checks Node.js before loading the application", () => {
  const source = fs.readFileSync(path.join(ROOT, "cli.js"), "utf8");
  const gate = source.indexOf('require("./src/cli/node-version.js")');
  const application = source.indexOf('require("./src/cli/main.js")');
  assert.ok(gate >= 0);
  assert.ok(application > gate);
  assert.equal(PACKAGE_JSON.scripts.preinstall, "node src/cli/node-version.js");
});
