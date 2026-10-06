"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../src/client/app/persistence.js"), "utf8");
const DEFAULT = "123e4567-e89b-42d3-a456-426614174000";
const PROJECT = "123e4567-e89b-42d3-a456-426614174001";
const CANVAS = "123e4567-e89b-42d3-a456-426614174002";
const REVISION = "123e4567-e89b-42d3-a456-426614174003";

function harness({ selected = "all", libraryError = null, saveError = null, projects = [{ id:PROJECT, name:"Work" }, { id:DEFAULT, name:"Uncategorized", systemKey:"uncategorized" }] } = {}) {
  const requests = [];
  const events = [];
  const context = vm.createContext({
    window:{ PENECHO_CONFIG:{ runtime:"cloud", browserCanvasEditing:true }, dispatchEvent(event){ events.push({ type:event.type, id:context.state.currentSnapshotId, location:context.state.currentSnapshotLocation }); } },
    sessionStorage:{ getItem:() => selected, setItem(){} },
    document:{ querySelector:() => ({ value:"" }) },
    state:{ snapshotLocation:"cloud", currentSnapshotId:null, currentSnapshotLocation:null, userRevision:1, images:[], textBoxes:[], preservedSnapshotAnimations:[], animations:[] },
    crypto:{ randomUUID:() => "new-local-id" }, Event,
    tiles:new Map(), authenticatedApiHeaders:() => ({}),
    selectionAIBusy:() => false, pluginEnabled:() => false,
    t:key => key === "snapshotLibraryLoadFailed" ? "Could not load {location}. Select the location to try again." : key,
    serializedAnimations:() => [], serializedWidgets:() => [], storedTextBoxes:() => [], storedImages:() => [],
    snapshotCanvasObjectExtensions:() => ({}), canvasAgentCanvasDidPersist(){}, setStatusKey(){},
    fetch:async (url, options) => {
      requests.push({ url, method:options.method || "GET", body:options.body && JSON.parse(options.body) });
      if (url === "/api/cloud/library") return { ok:!libraryError, status:libraryError ? 401 : 200, json:async () => libraryError
        ? { error:libraryError, code:"cloud_sign_in_required" }
        : { projects, canvases:[], sync:{ bundleVersion:2, conflictPolicy:"base-revision-required" } } };
      return { ok:!saveError, status:saveError ? 500 : 201, json:async () => saveError ? { error:saveError } : { canvas:{ id:CANVAS }, revision:{ id:REVISION } } };
    },
  });
  vm.runInContext(source, context);
  // Keep the real save, project selection, library read, and HTTP response logic.
  // Rendering and binary asset conversion are independent of project routing.
  vm.runInContext(`
    finalizeCanvasForSnapshot = async () => {};
    prepareVisibleWidgetSnapshots = async () => {};
    cloudSnapshotPreviewBlob = async () => null;
    serverSnapshotPayload = async item => ({ name:item.name, projectId:item.projectId });
    refreshSnapshots = async () => {};
  `, context);
  return { context, requests, events, run:code => vm.runInContext(code, context) };
}

test("a first Cloud save resolves Uncategorized without opening Library", async () => {
  const h = harness();
  assert.equal(await h.context.saveSnapshot({ location:"cloud", name:"First Canvas", allowEmpty:true }), CANVAS);
  assert.deepEqual(h.requests.map(({ url }) => url), ["/api/cloud/library", `/api/cloud/projects/${DEFAULT}/save`]);
  assert.equal(h.requests[1].body.bundle.projectId, DEFAULT);
  assert.equal(h.context.state.currentSnapshotProjectId, DEFAULT);
  assert.equal(h.context.state.currentSnapshotRevisionId, REVISION);
  assert.deepEqual(h.events, [{ type:"penecho:live-share-context-changed", id:CANVAS, location:"cloud" }]);
});

test("first save keeps an explicitly selected project and replaces a stale selection with Uncategorized", async () => {
  for (const [selected, expected] of [[PROJECT, PROJECT], [CANVAS, DEFAULT]]) {
    const h = harness({ selected });
    await h.context.saveSnapshot({ location:"cloud", name:"Canvas", allowEmpty:true });
    assert.equal(h.requests[1].url, `/api/cloud/projects/${expected}/save`);
    assert.equal(h.context.state.currentSnapshotProjectId, expected);
  }
});

test("an existing Cloud Canvas saves its revision without depending on a Library read", async () => {
  const h = harness({ libraryError:"Expired session" });
  Object.assign(h.context.state, { currentSnapshotLocation:"cloud", currentSnapshotId:CANVAS, currentSnapshotProjectId:PROJECT, currentSnapshotRevisionId:REVISION });
  await h.context.saveSnapshot({ location:"cloud", overwriteId:CANVAS, name:"Saved Canvas", allowEmpty:true });
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, `/api/cloud/canvases/${CANVAS}/save`);
  assert.equal(h.requests[0].body.baseRevisionId, REVISION);
  assert.equal(h.context.state.currentSnapshotProjectId, PROJECT);
});

test("a failed project read preserves the unsaved Canvas and never sends a save", async () => {
  const h = harness({ libraryError:"Expired session" });
  await assert.rejects(h.context.saveSnapshot({ location:"cloud", name:"Keep this draft", allowEmpty:true }), /Expired session/);
  assert.deepEqual(h.requests.map(({ method }) => method), ["GET"]);
  assert.equal(h.context.state.currentSnapshotId, null);
  assert.equal(h.context.state.snapshotSavedRevision, undefined);
  assert.deepEqual(h.events, []);
});

test("an unavailable default project reports a library failure without creating a project or claiming a save", async () => {
  const h = harness({ projects:[] });
  await assert.rejects(h.context.saveSnapshot({ location:"cloud", name:"Keep this draft", allowEmpty:true }), /Could not load/);
  assert.deepEqual(h.requests.map(({ method }) => method), ["GET"]);
  assert.equal(h.context.state.currentSnapshotId, null);
  assert.deepEqual(h.events, []);
});

test("a failed Cloud write does not publish a saved identity or a URL synchronization event", async () => {
  const h = harness({ saveError:"Storage unavailable" });
  await assert.rejects(h.context.saveSnapshot({ location:"cloud", name:"Keep this draft", allowEmpty:true }), /Storage unavailable/);
  assert.equal(h.requests.at(-1).method, "POST");
  assert.equal(h.context.state.currentSnapshotId, null);
  assert.equal(h.context.state.currentSnapshotLocation, null);
  assert.deepEqual(h.events, []);
});
