"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../src/client/app/persistence.js"), "utf8");
const CANVAS = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "123e4567-e89b-42d3-a456-426614174001";
const REVISION = "123e4567-e89b-42d3-a456-426614174002";

function response(id = CANVAS, overrides = {}, status = 200) {
  return new Response(JSON.stringify({
    canvas:{ id, name:"Saved Cloud document" }, revision:{ id:REVISION },
    bundle:{ bundleVersion:2, mode:"snapshot", formatVersion:1, id, name:"Bundle name",
      manifest:{ format:"penecho-raster-tiles", formatVersion:1, theme:"light", view:{ scale:1, panX:0, panY:0 } },
      assets:[{ kind:"preview", contentType:"image/png", dataBase64:"AAAA", metadata:{} }],
    },
    ...overrides,
  }), { status, headers:{ "content-type":"application/json" } });
}

function harness({ earlyId = CANVAS, earlyResponse = response(), fetchResponse, nativeReads = true, runtime = "cloud", browserDraftId, windowObject } = {}) {
  const requests = [], progress = [];
  let takes = 0, cancels = 0;
  const window = windowObject || { PENECHO_CONFIG:{ runtime, remoteCanvasNativeReads:nativeReads, browserDraftId } };
  const early = { id:earlyId, response:Promise.resolve(earlyResponse), take() {
    takes++;
    window.PenEchoEarlyCloudSnapshot = null;
    return this.response;
  }, cancel() {
    cancels++;
    window.PenEchoEarlyCloudSnapshot = null;
  } };
  early.response.catch(() => {});
  if (!windowObject) window.PenEchoEarlyCloudSnapshot = early;
  const context = vm.createContext({
    window, sessionStorage:{ getItem:() => null }, Blob, atob,
    authenticatedApiHeaders:() => ({ "X-PenEcho-Client":"test-client" }),
    fetch:async (url, options) => {
      requests.push({ url, options });
      if (windowObject) return window.fetch(url, options);
      return fetchResponse ? fetchResponse(url, options) : response(url.split("/").at(-1));
    },
  });
  vm.runInContext(source, context);
  return { window, early, requests, progress, takes:() => takes, cancels:() => cancels,
    read:(id = CANVAS) => context.readCloudSnapshot(id, (...values) => progress.push(values)),
  };
}

test("remote entry and persistence open the saved Canvas with exactly one early download", async () => {
  // Reuse the gate's browser harness without registering its independent tests.
  const filename = path.join(__dirname, "remote-canvas-gate.test.js");
  const gateTests = fs.readFileSync(filename, "utf8");
  const helper = new Module(filename, module);
  helper.filename = filename;
  helper.paths = Module._nodeModulePaths(path.dirname(filename));
  helper._compile(gateTests.slice(0, gateTests.indexOf("\ntest(")) + "\nmodule.exports = { boot, flush };", filename);
  let persistence, stored;
  const gate = helper.exports.boot({ pathname:`/canvas/${CANVAS}`, nativeReads:true, readyState:"loading",
    fetchResponse:() => response(),
    openCanvas:async id => { stored = await persistence.read(id); },
  });
  persistence = harness({ windowObject:gate.window });
  const canvasReads = () => gate.fetchCalls.filter(({ url }) => url === `/api/cloud/canvases/${CANVAS}`);
  assert.equal(canvasReads().length, 1, "the native content request starts before the remaining scripts finish");
  assert.equal(stored, undefined);
  gate.finishScripts();
  await helper.exports.flush();
  assert.equal(stored.item.id, CANVAS);
  assert.equal(stored.item.currentRevisionId, REVISION);
  assert.equal(gate.gate.hidden, true);
  assert.equal(canvasReads().length, 1);
  assert.equal(persistence.requests.length, 0, "persistence reuses the native response");
  assert.equal(gate.window.PenEchoEarlyCloudSnapshot, null);
});

test("a matching early Cloud download is consumed once with normal bundle metadata and progress", async () => {
  const h = harness();
  const stored = await h.read();
  assert.equal(stored.item.id, CANVAS);
  assert.equal(stored.item.name, "Saved Cloud document");
  assert.equal(stored.item.currentRevisionId, REVISION);
  assert.ok(stored.item.preview instanceof Blob);
  assert.ok(h.progress.some(([, bytes]) => bytes > 0));
  assert.equal(h.takes(), 1);
  assert.equal(h.window.PenEchoEarlyCloudSnapshot, null);
  assert.equal(h.requests.length, 0, "opening uses the already-started download");
  await h.read();
  assert.equal(h.requests.length, 1, "a later reload starts a fresh download");
  assert.equal(h.requests[0].options.cache, "no-store");
  assert.equal(h.requests[0].options.credentials, "same-origin");
  assert.equal(h.requests[0].options.headers["X-PenEcho-Client"], "test-client");
});

test("another Canvas never consumes the opening Canvas response", async () => {
  const h = harness();
  const stored = await h.read(OTHER);
  assert.equal(stored.item.id, OTHER);
  assert.equal(h.takes(), 0);
  assert.equal(h.cancels(), 1);
  assert.deepEqual(h.requests.map(({ url }) => url), [`/api/cloud/canvases/${OTHER}`]);
  await h.read(CANVAS);
  assert.equal(h.requests.length, 2, "the discarded original cannot be reused later");
});

test("a rejected early network request falls back once to the authenticated read", async () => {
  const h = harness({ earlyResponse:Promise.reject(TypeError("network unavailable")) });
  const stored = await h.read();
  assert.equal(stored.item.id, CANVAS);
  assert.equal(h.takes(), 1);
  assert.equal(h.requests.length, 1);
});

test("a failed fallback propagates instead of retrying again", async () => {
  const h = harness({ earlyResponse:Promise.reject(TypeError("early network unavailable")),
    fetchResponse:() => { throw TypeError("fallback network unavailable"); },
  });
  await assert.rejects(h.read(), /fallback network unavailable/);
  assert.equal(h.requests.length, 1);
});

test("early HTTP failures preserve status and authorization error without another download", async () => {
  for (const status of [401, 403, 502]) {
    const h = harness({ earlyResponse:response(CANVAS, { error:"access refused", code:"cloud_access_refused" }, status) });
    await assert.rejects(h.read(), error => error.status === status && error.code === "cloud_access_refused" && error.message === "access refused");
    assert.equal(h.requests.length, 0);
  }
});

test("early responses retain Cloud body and bundle validation", async () => {
  for (const [overrides, expected] of [
    [{ revision:null }, /invalid Canvas/],
    [{ bundle:{ bundleVersion:9 } }, /invalid canvas bundle/],
  ]) {
    const h = harness({ earlyResponse:response(CANVAS, overrides) });
    await assert.rejects(h.read(), expected);
    assert.equal(h.requests.length, 0);
  }
});

test("native-off, local, and draft reads do not consume an early Cloud response", async () => {
  for (const options of [{ nativeReads:false }, { runtime:"local" }, { browserDraftId:OTHER }]) {
    const h = harness(options);
    await h.read();
    assert.equal(h.takes(), 0);
    assert.equal(h.cancels(), 0);
    assert.equal(h.window.PenEchoEarlyCloudSnapshot, h.early);
    assert.equal(h.requests.length, 1);
  }
});
