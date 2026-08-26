"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "client", "app", "client-activity.js"), "utf8");

test("anonymous logo request is deferred until idle and carries only bounded client metadata", () => {
  let idleCallback = null;
  const appended = [];
  const storage = new Map();
  const document = {
    visibilityState:"visible",
    readyState:"complete",
    body:{ appendChild:(node) => appended.push(node) },
    documentElement:{ appendChild:(node) => appended.push(node) },
    createElement(type) {
      assert.equal(type, "img");
      return {
        addEventListener() {},
        remove() {},
        set src(value) { this.source = value; },
        get src() { return this.source; },
      };
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const context = {
    URL,
    URLSearchParams,
    Uint8Array,
    Date,
    Math,
    navigator:{ userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform:"MacIntel" },
    location:{ origin:"http://127.0.0.1:3888" },
    document,
    localStorage:{ getItem:(key) => storage.get(key) || null, setItem:(key, value) => storage.set(key, String(value)) },
    crypto:{ randomUUID:() => "01234567-89ab-4def-8123-456789abcdef" },
    requestIdleCallback:(callback) => { idleCallback = callback; },
    setTimeout:() => 1,
    clearTimeout() {},
    window:{
      PENECHO_CONFIG:{ desktopApp:true, clientPlatform:"darwin", clientVersion:"0.9.5", cloudOrigin:"https://penecho.ai" },
      addEventListener() {},
    },
  };
  vm.runInNewContext(source, context);
  assert.equal(appended.length, 0, "no request is started synchronously");
  assert.equal(typeof idleCallback, "function");
  idleCallback();
  assert.equal(appended.length, 1);
  const target = new URL(appended[0].src);
  assert.equal(target.origin, "https://penecho.ai");
  assert.equal(target.pathname, "/a/p.png");
  assert.deepEqual(Object.fromEntries(target.searchParams), {
    c:"desktop",
    p:"macos",
    v:"0.9.5",
    i:"0123456789ab4def8123456789abcdef",
  });
  assert.equal(appended[0].hidden, true);
  assert.equal(appended[0].fetchPriority, "low");
  assert.equal(appended[0].referrerPolicy, "no-referrer");
});

test("activity scheduling swallows hostile browser storage and visibility failures", () => {
  const context = {
    URL,
    URLSearchParams,
    Uint8Array,
    Date,
    Math,
    navigator:{ userAgent:"", platform:"" },
    location:{ origin:"https://penecho.ai" },
    document:{ get visibilityState() { throw new Error("unavailable"); } },
    localStorage:{ getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } },
    crypto:{ randomUUID() { throw new Error("unavailable"); } },
    setTimeout() { throw new Error("unavailable"); },
    clearTimeout() {},
    window:{ PENECHO_CONFIG:{ runtime:"cloud" }, addEventListener() { throw new Error("unavailable"); } },
  };
  assert.doesNotThrow(() => vm.runInNewContext(source, context));
});
