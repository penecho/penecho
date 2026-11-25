"use strict";

// Use an Electron binary with ELECTRON_RUN_AS_NODE=1. This exercises the shipped
// updater through availability only; it never downloads, installs, or relaunches.
// Arguments: <app.asar> <report.json> <expected-current-version>
//            <release.json|--live> [target-platform] [target-arch]
// A host-side architecture override checks asset selection, not target execution.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");

const [archive, reportFile, expectedCurrentVersion, releaseSource, platform = process.platform, arch = process.arch] = process.argv.slice(2);
assert(archive && reportFile && expectedCurrentVersion && releaseSource, "Provide the archive, report, expected version, and release source.");
assert.notEqual(process.env.PENECHO_DISABLE_AUTO_UPDATE, "1", "Update verification requires updates to be enabled.");
const load = createRequire(path.join(path.resolve(archive), "package.json"));
const pkg = load("./package.json");
const { RELEASE_API_URL, RELEASES_API_URL, createUpdateManager, expectedAssetName, releaseAsset } = load("./desktop/update-manager.js");
assert.equal(pkg.version, expectedCurrentVersion);
assert.equal(pkg.config.desktopVersion, expectedCurrentVersion);

async function verify() {
  const live = releaseSource === "--live";
  const endpoint = expectedCurrentVersion.includes("-") ? RELEASES_API_URL : RELEASE_API_URL;
  let release = live ? null : JSON.parse(fs.readFileSync(releaseSource, "utf8"));
  const fetchImpl = async (url, options) => {
    assert.equal(url, endpoint, "Use the production update endpoint.");
    if (!live) return { ok:true, json:async () => endpoint === RELEASES_API_URL ? [release] : release };
    const response = await fetch(url, options);
    if (response.ok) release = await response.clone().json();
    return response;
  };
  const manager = createUpdateManager({
    app:{ getVersion:() => pkg.version }, currentVersion:pkg.config.desktopVersion,
    platform, arch, fetchImpl,
  });
  assert.equal(await manager.check(true), true, "The update check succeeds.");
  const state = manager.getState();
  assert.equal(state.currentVersion, expectedCurrentVersion);
  assert.equal(state.status, "available", state.error || "A newer compatible release must be available.");
  assert.equal(state.updateAvailable, true);
  if (Array.isArray(release)) release = release.find(value => value.tag_name === `v${state.version}`);
  const name = expectedAssetName(platform, arch, state.version);
  const asset = releaseAsset({ version:state.version, assets:release.assets.map(value => ({
    name:value.name, url:value.browser_download_url, size:value.size, digest:value.digest,
  })) }, platform, arch);
  assert(asset, "The real release contains a compatible production asset.");
  assert.equal(asset.name, name);
  const report = {
    mode:live ? "live-production-endpoint" : "captured-production-release",
    checkedAt:new Date().toISOString(), hostPlatform:process.platform, hostArch:process.arch,
    targetPlatform:platform, targetArch:arch,
    currentVersion:state.currentVersion, latestVersion:state.version,
    status:state.status, updateAvailable:state.updateAvailable,
    endpoint, releaseUrl:release.html_url, selectedAsset:asset,
    downloaded:false, installed:false,
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}

verify().catch(error => { console.error(error.stack); process.exitCode = 1; });
