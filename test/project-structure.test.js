"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { BANNER, SOURCES, compiledSource } = require("../scripts/build-client.js");

const ROOT = path.resolve(__dirname, "..");

test("root JavaScript is limited to entry points and Electron Forge configuration", () => {
  const rootScripts = fs.readdirSync(ROOT, { withFileTypes:true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".js"))
    .map(entry => entry.name)
    .sort();
  assert.deepEqual(rootScripts, ["cli.js", "forge.config.js", "server.js"]);
});

test("the browser application is maintained as eight ordered source sections", () => {
  assert.deepEqual(SOURCES, [
    "src/client/app/client-activity.js",
    "src/client/app/core.js",
    "src/client/app/canvas-runtime.js",
    "src/client/app/visual-explainer.js",
    "src/client/app/persistence.js",
    "src/client/app/ai-runtime.js",
    "src/client/app/canvas-agent-runtime.js",
    "src/client/app/ui-bootstrap.js",
  ]);
  for (const source of SOURCES) assert.ok(fs.statSync(path.join(ROOT, source)).isFile(), source);
  const generated = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert.ok(generated.startsWith(`${BANNER}\n`));
  assert.equal(generated, compiledSource());
});

test("server, provider, and CLI implementations live under src without unrelated main-only features", () => {
  for (const source of [
    "src/server/main.js", "src/server/cloud-connector.js", "src/server/activity-timeout.js", "src/server/api-config.js", "src/server/api-stream.js", "src/server/widget-patch.js", "src/server/typeset.js",
    "src/server/canvas-agent/http.js", "src/server/canvas-agent/protocol.mjs", "src/server/canvas-agent/cli-adapter.mjs", "src/server/canvas-agent/runtime.mjs",
    "src/providers/reasoning-effort.js", "src/providers/cli-discovery.js", "src/providers/kimi-cli.js", "src/providers/kimi-acp.js", "src/providers/codex-cli.js", "src/providers/claude-cli.js",
    "src/cli/main.js", "src/cli/configure-ui.js", "src/cli/update.js",
    "public/access.html", "public/access.css", "public/access.js", "public/cloud-connect.css", "public/cloud-connect.js",
  ]) assert.ok(fs.statSync(path.join(ROOT, source)).isFile(), source);
  for (const excluded of [
    "src/desktop/launcher.js", "src/desktop/update.js",
    "public/cloud-library.js", "setup/setup.js",
  ]) assert.equal(fs.existsSync(path.join(ROOT, excluded)), false, excluded);
});

test("the isolated Android and iOS packaging toolchain remains available", () => {
  for (const source of [
    "tools/mobile/build-mobile.js", "tools/mobile/capacitor.config.json", "tools/mobile/package.json",
    "tools/mobile/web/index.html", "tools/mobile/web/app.js", "tools/mobile/web/style.css",
  ]) assert.ok(fs.statSync(path.join(ROOT, source)).isFile(), source);
});

test("desktop packaging unpacks the bundled project-search executable", () => {
  const forge = fs.readFileSync(path.join(ROOT, "forge.config.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies["@vscode/ripgrep"], "1.18.0");
  assert.match(forge, /asar:\{ unpack:"\*\*\/node_modules\/\{sharp,@img,@vscode\}\/\*\*\/\*" \}/);
});
