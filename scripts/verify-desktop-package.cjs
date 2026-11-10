"use strict";

// Run with the packaged Electron binary and ELECTRON_RUN_AS_NODE=1. This checks
// archived source against the build manifest and exercises target native code.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { createRequire } = require("node:module"), { execFileSync } = require("node:child_process");
const [archive, manifestFile, reportFile, latestFile] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const load = createRequire(path.join(archive, "package.json"));
const pkg = load("./package.json");
assert.equal(pkg.version, manifest.desktopVersion);
assert.equal(pkg.config.desktopVersion, manifest.desktopVersion);
const report = { version:pkg.version, platform:process.platform, arch:process.arch, electron:process.versions.electron, matchedSourceFiles:0 };
const required = new Set(["desktop/menu.js", "src/client/app/desktop-menu.js", "desktop/main.js", "desktop/canvas-preload.js", "desktop/update-window-preload.js", "desktop/update-window.html", "desktop/update-window.js", "desktop/update-window.css", "desktop/update-manager.js", "public/desktop-update.css", "public/penecho-mark.png", "public/app.js"]);
for (const file of manifest.files) {
  if (file.path === "package.json") continue; // Forge sets the desktop version.
  const packaged = path.join(archive, file.path);
  if (!fs.existsSync(packaged)) continue;
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(packaged)).digest("hex"), file.sha256, `Packaged source differs: ${file.path}`);
  required.delete(file.path);
  report.matchedSourceFiles++;
}
assert.equal(required.size, 0, `Required source missing: ${[...required].join(", ")}`);
async function verify() {
  const sharp = load("sharp");
  const image = await sharp({ create:{ width:2, height:2, channels:4, background:"#397bea" } }).png().toBuffer();
  assert(image.length > 0);
  report.sharp = sharp.versions.sharp;
  const rg = load("@vscode/ripgrep").rgPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  report.ripgrep = execFileSync(rg, ["--version"], { encoding:"utf8" }).split(/\r?\n/)[0];
  if (latestFile) {
    const metadata = JSON.parse(fs.readFileSync(latestFile, "utf8"));
    const manager = load("./desktop/update-manager.js").createUpdateManager({
      app:{ getVersion:() => pkg.version },
      fetchImpl:async () => ({ ok:true, json:async () => metadata }),
    });
    assert.equal(manager.getState().updateAvailable, false);
    assert.equal(await manager.check(true), true);
    const state = manager.getState();
    // Captured release metadata may be older than the packaged application.
    assert(["available", "up-to-date"].includes(state.status));
    assert.equal(state.currentVersion, pkg.version);
    assert.equal(state.updateAvailable, state.status === "available");
    assert(state.notes.length > 0);
    const current = load("./desktop/update-manager.js").createUpdateManager({
      app:{ getVersion:() => state.version },
      fetchImpl:async () => ({ ok:true, json:async () => metadata }),
    });
    assert.equal(await current.check(true), true);
    assert.equal(current.getState().updateAvailable, false);
    assert.equal(current.getState().status, "up-to-date");
    report.update = { current:state.currentVersion, latest:state.version, status:state.status, notesLength:state.notes.length, updateAvailable:state.updateAvailable, hiddenWhenCurrent:true };
  }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
