"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const { createUpdateManager } = require("../desktop/update-manager.js");

function canvasHarness(platform = "darwin") {
  const { window, document } = parseHTML('<html lang="en"><head></head><body><section class="topbar"><header class="top-row"><div class="brand">PenEcho</div><div class="canvas-document-meta">Title</div></header></section><main><footer></footer></main></body></html>');
  const calls = [], listeners = new Map();
  const ipcRenderer = {
    invoke(channel) { calls.push(channel); return Promise.resolve({ status:"idle", visible:false }); },
    on(channel, callback) { listeners.set(channel, callback); },
    send() {}, removeListener() {},
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../desktop/canvas-preload.js"), "utf8"), {
    require:() => ({ contextBridge:{ exposeInMainWorld() {} }, ipcRenderer }),
    process:{ platform }, window, document, localStorage:{ getItem:() => "en" },
  });
  window.dispatchEvent(new window.Event("DOMContentLoaded"));
  return { window, document, calls, render:state => listeners.get("penecho:update-state")?.({}, state) };
}

test("desktop update indicator stays beside the brand and always opens the existing update window", async () => {
  for (const platform of ["darwin", "win32"]) {
    const h = canvasHarness(platform);
    await Promise.resolve();
    const prompt = h.document.querySelector("#desktopUpdatePrompt"), button = prompt.querySelector("button");
    assert.equal(h.document.querySelector(".brand").nextElementSibling, prompt);
    assert.equal(h.document.querySelector("main > footer").children.length, 0);
    assert.equal(prompt.hidden, true);
    for (const status of ["available", "downloading", "ready"]) {
      h.render({ status, updateAvailable:true, visible:true, progress:62, ready:status === "ready", windowOpen:true });
      assert.equal(prompt.hidden, false);
      assert.equal(button.getAttribute("aria-expanded"), "true");
      button.click();
      assert.equal(h.calls.at(-1), "penecho:update-show-window");
    }
    assert(!h.calls.includes("penecho:update-install"));
    assert(!h.calls.includes("penecho:update-download"));
    h.render({ status:"ready", updateAvailable:true, ready:true, visible:false });
    assert.equal(prompt.hidden, false);
    assert.equal(button.getAttribute("aria-label"), "Install update");
    const event = new h.window.CustomEvent("penecho:languagechange", { detail:{ language:"zh" } });
    h.window.dispatchEvent(event);
    assert.equal(button.getAttribute("aria-label"), "安装更新");
    h.render({ status:"up-to-date", visible:true });
    assert.equal(prompt.hidden, true);
  }
});

test("desktop update entry requires a confirmed update, including manual checks and failures", async () => {
  const h = canvasHarness();
  await Promise.resolve();
  const prompt = h.document.querySelector("#desktopUpdatePrompt");
  for (const status of ["idle", "checking", "error", "up-to-date", "available"]) {
    h.render({ status, visible:true, updateAvailable:false, windowOpen:true, version:"1.3.3" });
    assert.equal(prompt.hidden, true, `${status} without a confirmed update must be hidden`);
  }
  for (const status of ["available", "checking", "downloading", "ready", "installing", "error"]) {
    h.render({ status, updateAvailable:true, visible:false });
    assert.equal(prompt.hidden, false, `${status} must retain an already-confirmed update`);
  }
  h.render({ status:"up-to-date", updateAvailable:false, visible:true });
  assert.equal(prompt.hidden, true);
});

test("unsupported platforms do not receive a desktop update indicator", () => {
  const h = canvasHarness("linux");
  assert.equal(h.document.querySelector("#desktopUpdatePrompt"), null);
});

test("real updater keeps the entry hidden until a newer compatible release is confirmed", async () => {
  const h = canvasHarness("win32");
  await Promise.resolve();
  const prompt = h.document.querySelector("#desktopUpdatePrompt"), snapshots = [];
  let version = "1.3.3", networkError = true, compatible = true;
  const manager = createUpdateManager({
    app:{ getVersion:() => "1.3.3" }, platform:"win32", arch:"x64", logger:{ warn() {} },
    onStateChange(state) { h.render(state); snapshots.push({ ...state, hidden:prompt.hidden }); },
    fetchImpl:async () => {
      if (networkError) throw new Error("Offline");
      return { ok:true, json:async () => ({ tag_name:`v${version}`, assets:compatible ? [{
        name:`PenEcho-Setup-${version}-win-x64.exe`,
        browser_download_url:`https://github.com/penecho/penecho/releases/download/v${version}/PenEcho-Setup-${version}-win-x64.exe`,
      }] : [] }) };
    },
    downloadImpl:async () => { throw new Error("Connection interrupted"); },
  });
  assert.equal(manager.getState().updateAvailable, false);
  await manager.check(true);
  assert(snapshots.every(state => state.hidden), "manual checking and its error must remain invisible");
  networkError = false;
  for (version of ["1.3.3", "1.1.0"]) {
    await manager.check(false);
    assert.equal(manager.getState().updateAvailable, false);
    assert.equal(prompt.hidden, true);
  }
  version = "1.4.0";
  compatible = false;
  await manager.check(true);
  assert.equal(prompt.hidden, true, "a newer release without a compatible installer is not an update");
  compatible = true;
  await manager.check(false);
  assert.equal(prompt.hidden, false);
  assert.equal(manager.getState().updateAvailable, true);
  await manager.download();
  assert.equal(manager.getState().status, "error");
  assert.equal(prompt.hidden, false, "an interrupted download keeps the retry entry");
  networkError = true;
  await manager.check(true);
  assert.equal(prompt.hidden, false, "a failed recheck retains the known available update");
  networkError = false;
  compatible = false;
  await manager.check(true);
  assert.equal(prompt.hidden, true, "withdrawn compatible installers clear the indicator");
  compatible = true;
  await manager.check(false);
  version = "1.3.3";
  await manager.check(true);
  assert.equal(manager.getState().updateAvailable, false);
  assert.equal(prompt.hidden, true, "a release that is no longer newer clears the indicator");
});

function notesHarness() {
  const { window, document } = parseHTML(fs.readFileSync(require.resolve("../desktop/update-window.html"), "utf8"));
  let render;
  const calls = [];
  window.penechoDesktopUpdateWindow = {
    onStateChange(fn) { render = fn; },
    getState:async () => null,
    download:async () => calls.push("download"),
    install:async () => calls.push("install"),
    close:async () => calls.push("close"),
    openReleasePage:async () => calls.push("release"),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../desktop/update-window.js"), "utf8"), { window, document });
  return { document, render, calls };
}

test("release notes render readable structure without executing HTML or release links", () => {
  const h = notesHarness();
  h.render({ status:"available", language:"zh", version:"1.3.5", currentVersion:"1.1.0", notes:'# Improvements\n\n- **Canvas:** Keep names.\n- `small images` restore correctly.\n\n<img src=x onerror=alert(1)>\n[click](javascript:alert(1))\n\n```html\n<script>alert(1)</script>\n```' });
  const notes = h.document.querySelector("#release-notes");
  assert.equal(notes.querySelector("h3").textContent, "Improvements");
  assert.equal(notes.querySelectorAll("li").length, 2);
  assert.equal(notes.querySelector("strong").textContent, "Canvas:");
  assert.equal(notes.querySelectorAll("img,script,a,iframe").length, 0);
  assert.match(notes.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(notes.querySelector("pre").textContent, /<script>/);
  assert.equal(h.document.querySelector("#release-notes-title").textContent, "更新内容 · v1.3.5");
  assert.equal(h.document.querySelector("#update-version").textContent, "当前版本：v1.1.0");
});

test("download progress preserves changelog reading position and close never installs", async () => {
  const h = notesHarness(), state = { status:"available", language:"en", version:"1.3.5", notes:"- A fix\n- Another fix" };
  h.render(state);
  const notes = h.document.querySelector("#release-notes"), first = notes.firstChild;
  notes.scrollTop = 180;
  h.render({ ...state, status:"downloading", progress:46 });
  assert.equal(notes.firstChild, first);
  assert.equal(notes.scrollTop, 180);
  h.document.querySelector("#close-button").click();
  await Promise.resolve();
  assert.deepEqual(h.calls, ["close"]);
  h.render({ ...state, status:"ready", ready:true });
  assert.equal(h.document.querySelector("#primary-button").textContent, "Install");
  h.document.querySelector("#primary-button").click();
  await Promise.resolve();
  assert.deepEqual(h.calls, ["close", "install"]);
  h.render({ ...state, notes:"", language:"zh" });
  assert.match(notes.textContent, /暂未提供更新说明/);
  assert.equal(h.document.querySelector("#release-notes-region").hidden, false);
});
