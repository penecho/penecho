"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function json(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

test("Android dependencies stay isolated from the root install", () => {
  const rootPackage = json("package.json");
  const rootLock = json("package-lock.json");
  const mobilePackage = json("tools/mobile/package.json");
  const mobileLock = json("tools/mobile/package-lock.json");
  for (const dependency of ["@capacitor/android", "@capacitor/cli", "@capacitor/core"]) {
    assert.equal(rootPackage.dependencies[dependency], undefined, dependency);
    assert.equal(rootPackage.devDependencies[dependency], undefined, dependency);
    assert.equal(rootLock.packages[`node_modules/${dependency}`], undefined, dependency);
    assert.equal(mobilePackage.dependencies[dependency], "7.4.3", dependency);
    assert.ok(mobileLock.packages[`node_modules/${dependency}`], dependency);
  }
  assert.equal(rootPackage.scripts["mobile:deps"], "npm ci --prefix tools/mobile");
  assert.equal(rootPackage.scripts["mobile:apk"], "node tools/mobile/build-mobile.js android");
});

test("mobile connection shell preserves the server-side security boundary", () => {
  const config = json("tools/mobile/capacitor.config.json");
  const html = fs.readFileSync(path.join(ROOT, "tools/mobile/web/index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "tools/mobile/web/app.js"), "utf8");
  assert.equal(config.appId, "ai.penecho.mobile");
  assert.deepEqual(config.server.allowNavigation, ["*"]);
  assert.equal(config.server.cleartext, true);
  assert.match(html, /id="serverUrl"/);
  assert.match(html, /penecho-mark\.png/);
  assert.match(app, /\["http:", "https:"\]/);
  assert.match(app, /target\.username \|\| target\.password \|\| target\.search \|\| target\.hash/);
  assert.match(app, /localStorage\.setItem/);
  assert.match(app, /window\.location\.href = target\.href/);
  assert.doesNotMatch(`${html}\n${app}`, /API[_ -]?key/i);
});

test("mobile builder creates branded, optionally signed APK targets", () => {
  const builder = fs.readFileSync(path.join(ROOT, "tools/mobile/build-mobile.js"), "utf8");
  const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(builder, /"assembleRelease" : "assembleDebug"/);
  assert.match(builder, /android\.injected\.version\.name/);
  assert.match(builder, /android:usesCleartextTraffic/);
  assert.match(builder, /ANDROID_SIGNING_STORE_FILE/);
  assert.match(builder, /penecho-1024\.png/);
  assert.match(builder, /android-debug/);
  assert.match(ignore, /tools\/mobile\/android\//);
  assert.match(ignore, /tools\/mobile\/web\/penecho-mark\.png/);
});

test("release workflow builds and publishes the Android APK", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/desktop-release.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:[\s\S]*?tags:/);
  assert.match(workflow, /^  android:$/m);
  assert.doesNotMatch(workflow, /android-actions\/setup-android/);
  assert.doesNotMatch(workflow, /\bsdkmanager\b/);
  assert.match(workflow, /npm ci --prefix tools\/mobile/);
  assert.match(workflow, /npm run mobile:apk/);
  assert.match(workflow, /release\/mobile\/\*\.apk/);
  assert.match(workflow, /needs: \[mac, windows, android\]/);
});
