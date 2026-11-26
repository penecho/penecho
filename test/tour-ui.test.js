"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}(`), body = source.indexOf("{", start);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
};

test("custom dialog layers release focus before hiding from accessibility APIs", () => {
  const app = read("public/app.js"), calls = [], document = { body:{} };
  let active = {
    blur() {
      calls.push("blur");
      document.activeElement = document.body;
    },
  };
  const hiddenTarget = {
      isConnected:true,
      closest() { return { hidden:true }; },
      focus() { calls.push("hidden-focus"); },
    },
    visibleTarget = {
      isConnected:true,
      closest() { return null; },
      focus() {
        calls.push("focus");
        document.activeElement = visibleTarget;
      },
    },
    layer = {
      contains(value) { return value === active; },
      set hidden(value) { calls.push(`hidden:${value}`); },
      setAttribute(name, value) { calls.push(`${name}:${value}`); },
    },
    hideLayer = vm.runInNewContext(`(()=>{${functionSource(app, "focusTargetAvailableOutsideLayer")}\n${functionSource(app, "hideLayerWithoutRetainedFocus")}\nreturn hideLayerWithoutRetainedFocus;})()`, { document });

  document.activeElement = active;
  hideLayer(layer, hiddenTarget, visibleTarget);
  assert.deepEqual(calls, ["focus", "hidden:true", "aria-hidden:true"]);

  calls.length = 0;
  active = {
    blur() {
      calls.push("blur");
      document.activeElement = document.body;
    },
  };
  document.activeElement = active;
  hideLayer(layer);
  assert.deepEqual(calls, ["blur", "hidden:true", "aria-hidden:true"]);

  for (const [name, layerName] of [
    ["closeConfiguration", "configurationLayer"],
    ["hidePluginControl", "pluginPopover"],
  ]) {
    const start = app.indexOf(`function ${name}(`),
      end = app.indexOf("\n  function ", start + 1),
      close = app.slice(start, end < 0 ? app.length : end);
    assert.notEqual(start, -1, `missing function ${name}`);
    assert.match(close, new RegExp(`hideLayerWithoutRetainedFocus\\(${layerName}`));
    assert.doesNotMatch(close, new RegExp(`${layerName}\\.hidden\\s*=\\s*true`));
    assert.doesNotMatch(close, new RegExp(`${layerName}\\.setAttribute\\(\\"aria-hidden\\",\\s*\\"true\\"\\)`));
  }
});

test("README version badges match the package version in every language", () => {
  const version = JSON.parse(read("package.json")).version.replaceAll("-", "--"); // shields.io writes a dash as two
  const readmePaths = [
    "README.md",
    ...fs.readdirSync(path.join(root, "docs/readme"))
      .filter((name) => /^README\.[^.]+(?:-[^.]+)?\.md$/.test(name))
      .map((name) => path.join("docs/readme", name)),
  ];
  for (const readmePath of readmePaths) {
    assert.ok(
      read(readmePath).includes(`/badge/release-v${version}-`),
      `${readmePath} version badge must match package.json`,
    );
  }
});

test("app entry has no release notes, upgrade survey or tour entry points", () => {
  const html = read("public/index.html"), core = read("src/client/app/core.js"), boot = read("src/client/app/ui-bootstrap.js");
  assert.doesNotMatch(html, /id="(?:tourLayer|changelogLayer|researchForm|settingsTourBtn|settingsChangelogBtn)"|data-(?:more-)?help="(?:tour|whats-new)"/);
  assert.doesNotMatch(core + boot, /function (?:replayFeatureTour|maybeShowChangelog|researchDue)|const (?:featureTour|changelog) =|handleFeatureTourKeydown/);
});

test("startup only offers the small Canvas hint and respects viewer and Settings guards", () => {
  const source = functionSource(read("src/client/app/core.js"), "maybeStartOnboarding"),
    calls = [], settings = { open:false }, window = { PENECHO_CONFIG:{ runtime:"device" } };
  const start = vm.runInNewContext(`(${source})`, { window, settings, maybeShowCanvasHint() { calls.push("hint"); } });
  start();
  assert.deepEqual(calls, ["hint"]);
  calls.length = 0;
  settings.open = true;
  assert.equal(start(), false);
  settings.open = false;
  window.PENECHO_CONFIG.runtime = "viewer";
  assert.equal(start(), false);
  assert.deepEqual(calls, []);
});

test("legacy tour and release-note preferences only suppress the first-install hint", () => {
  const source = functionSource(read("src/client/app/core.js"), "usedEarlierVersion");
  for (const stored of [{}, { "penecho-changelog-seen":"1.4.1" }, { "penecho-tour-progress":"{}" }, { "penecho-examples-v1":"{}" }]) {
    const earlier = vm.runInNewContext(`(${source})`, { localStorage:{ getItem:key => stored[key] ?? null } });
    assert.equal(earlier(), Object.keys(stored).length > 0);
  }
});
