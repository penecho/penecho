"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAgents } = require("../src/server/project-lines/agents.js");

// A connection saved long ago names the Codex PenEcho once installed. Lines must not run that old copy while a current Codex is here (PE-1129).
test("Lines run the current Codex, not the old copy a saved connection names", { skip:process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retired-codex-"));
  try {
    const make = (...parts) => { const file = path.join(root, ...parts); fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, "#!/bin/sh\n", { mode:0o755 }); return file; };
    const old = make("PenEcho", "tools", "codex", "bin", "codex"), apps = path.join(root, "Applications");
    const launch = (file, PATH = "") => createAgents({ env:{ HOME:root, PATH, CODEX_CLI_PATH:file }, paths:{ systemDirs:[] }, platform:"darwin", fromApps:true, appFolders:[apps] }).launch("codex")?.command;
    assert.equal(launch(old), old, "with no other Codex, the old copy still runs");
    const inApp = make("Applications", "ChatGPT.app", "Contents", "Resources", "codex-cli", "bin", "codex");
    assert.equal(launch(old), inApp, "the Codex inside the app wins");
    assert.equal(launch("codex"), inApp, "a connection with no path of its own finds the app too");
    const own = make("bin", "codex");
    assert.equal(launch(old, path.dirname(own)), own, "the Codex on the PATH wins");
    const chosen = make("elsewhere", "codex");
    assert.equal(launch(chosen, path.dirname(own)), chosen, "a path the person picked is still used");
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});
