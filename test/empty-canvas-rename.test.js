"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const persistence = fs.readFileSync(path.join(ROOT, "src/client/app/persistence.js"), "utf8");

function functionSource(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(persistence);
  assert.ok(match, `missing ${name}`);
  const signatureEnd = /\)\s*\{/.exec(persistence.slice(match.index));
  assert.ok(signatureEnd, `missing body for ${name}`);
  const body = match.index + signatureEnd.index + signatureEnd[0].lastIndexOf("{");
  let depth = 0;
  for (let index = body; index < persistence.length; index++) {
    if (persistence[index] === "{") depth++;
    else if (persistence[index] === "}" && --depth === 0) return persistence.slice(match.index, index + 1);
  }
  assert.fail(`unterminated ${name}`);
}

function memoryDb({ failWrites = false } = {}) {
  const items = new Map(), tiles = new Map();
  const request = result => {
    const value = { result, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => value.onsuccess?.());
    return value;
  };
  const transaction = (_stores, mode) => {
    let pending = 0, failed = false;
    const tx = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore(name) {
        const values = name === "snapshots" ? items : tiles;
        return {
          put(value) {
            pending++;
            queueMicrotask(() => {
              if (mode === "readwrite" && failWrites) {
                if (!failed) {
                  failed = true;
                  tx.error = Error("simulated persistence failure");
                  tx.onerror?.();
                }
                return;
              }
              values.set(value.id, structuredClone(value));
              pending--;
              if (!pending && !failed) tx.oncomplete?.();
            });
          },
          delete(id) {
            pending++;
            queueMicrotask(() => {
              if (mode === "readwrite" && failWrites) {
                if (!failed) {
                  failed = true;
                  tx.error = Error("simulated persistence failure");
                  tx.onerror?.();
                }
                return;
              }
              values.delete(id);
              pending--;
              if (!pending && !failed) tx.oncomplete?.();
            });
          },
          index() {
            return {
              getAllKeys(snapshotId) {
                return request([...tiles.values()]
                  .filter(tile => tile.snapshotId === snapshotId)
                  .map(tile => tile.id));
              },
            };
          },
        };
      },
    };
    return tx;
  };
  return {
    items,
    tiles,
    db: { transaction },
  };
}

function harness(options = {}) {
  const storage = memoryDb(options);
  const state = {
    language: "en",
    theme: "light",
    snapshotLocation: "device",
    currentSnapshotId: null,
    currentSnapshotLocation: null,
    currentSnapshotName: "",
    currentSnapshotHasExplicitName: false,
    currentCanvasSuggestedName: "",
    currentSnapshotProjectId: null,
    currentSnapshotRevisionId: null,
    currentSnapshotBundleExtensions: {
      penechoDocument: { version: 1, documentId: "blank-document" },
    },
    currentSnapshotManifestExtensions: {},
    currentSnapshotPreservedAssets: [],
    snapshotSavedRevision: 0,
    userRevision: 7,
    navigationLocked: false,
    scale: 1,
    panX: 0,
    panY: 0,
    widgets: [],
    images: [],
    textBoxes: [],
    animations: [],
    preservedSnapshotAnimations: [],
    plugins: {},
  };
  const historyName = { value: "" };
  const busy = [], notices = [], statusKeys = [], statuses = [], navigatorUpdates = [], saveRequests = [];
  const context = vm.createContext({
    state,
    tiles: new Map(),
    snapshotItems: [],
    snapshotSaveInProgress: false,
    SNAPSHOT_LOCATIONS: new Set(["device", "server", "cloud"]),
    SNAPSHOT_STORE: "snapshots",
    SNAPSHOT_TILE_STORE: "snapshot-tiles",
    SERVER_DEFAULT_PROJECT_ID: "uncategorized",
    SIZE: 20000,
    TILE: 512,
    Blob,
    Event,
    TextEncoder,
    structuredClone,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    crypto: crypto.webcrypto,
    document: {
      querySelector(selector) {
        return selector === "#historyName" ? historyName : null;
      },
    },
    window: {
      dispatchEvent: () => true,
      PenEchoStudioNavigator: {
        updateDocument: () => navigatorUpdates.push("document"),
        refreshSource: () => navigatorUpdates.push("source"),
      },
    },
    selectionAIBusy: () => false,
    selectionAIStatusKey: () => "observing",
    setStatusKey: key => statusKeys.push(key),
    setStatus: message => statuses.push(message),
    showHistoryNoticeKey: (key, tone) => notices.push({ key, tone }),
    showHistoryNotice: (text, tone) => notices.push({ text, tone }),
    t: key => key,
    finalizeCanvasForSnapshot: async () => {},
    prepareVisibleWidgetSnapshots: async () => {},
    pluginEnabled: () => false,
    visibleWidgets: () => [],
    serializedAnimations: () => [],
    serializedWidgets: () => [],
    storedTextBoxes: () => [],
    storedImages: () => [],
    canvasBlob: async () => new Blob([], { type: "image/png" }),
    snapshotPreviewBlob: async () => new Blob([], { type: "image/webp" }),
    cloudSnapshotPreviewBlob: async () => new Blob([], { type: "image/webp" }),
    snapshotExtensionObject: value => structuredClone(value || {}),
    snapshotPreservedAssets: value => Array.isArray(value) ? structuredClone(value) : [],
    canvasDocumentsSaveMetadata: () => structuredClone(state.currentSnapshotBundleExtensions),
    canvasDocumentsDidSave: async () => {},
    canvasAgentCanvasDidPersist: () => {},
    refreshSnapshots: async () => true,
    snapshotDb: async () => storage.db,
    snapshotName: item => item.name || "fallback",
    selectedServerSaveProjectId: () => "server-project",
    selectedCloudSaveProjectId: () => "cloud-project",
    authenticatedApiHeaders: headers => headers,
    snapshotBundleAsset: async (kind, _blob, metadata) => ({ kind, metadata }),
    snapshotApiResponse: async response => response,
    fetch: async (url, options) => {
      saveRequests.push({ url, method: options.method, body: JSON.parse(options.body) });
      return { canvas: { id: "cloud-copy" }, revision: { id: "cloud-revision" } };
    },
  });
  context.setHistorySaveBusy = value => {
    busy.push(value);
    context.snapshotSaveInProgress = value;
  };
  vm.runInContext([
    functionSource("requestResult"),
    functionSource("transactionDone"),
    functionSource("saveDeviceSnapshot"),
    functionSource("serverSnapshotPayload"),
    functionSource("saveServerSnapshot"),
    functionSource("saveCloudSnapshot"),
    functionSource("saveSnapshot"),
    functionSource("saveSnapshotFromHistory"),
    functionSource("renameCurrentCanvasFromTitle"),
  ].join("\n"), context, { filename: "src/client/app/persistence.js" });
  return { context, storage, state, historyName, busy, notices, statusKeys, statuses, navigatorUpdates, saveRequests };
}

function namedCanvasCopyHarness(location) {
  const h = harness();
  const original = { id: "device-original", name: "课程设计", createdAt: 123, widgets: [] };
  h.storage.items.set(original.id, structuredClone(original));
  Object.assign(h.state, {
    snapshotLocation: location,
    currentSnapshotId: original.id,
    currentSnapshotLocation: "device",
    currentSnapshotName: original.name,
    currentSnapshotHasExplicitName: true,
  });
  const widget = { id: "lesson", html: "<p>Lesson content</p>", x: 100, y: 100, w: 400, h: 400 };
  h.context.visibleWidgets = () => [widget];
  h.context.serializedWidgets = () => [widget];
  return { ...h, original, widget };
}

function savedCopy(h, location) {
  if (location === "device") return h.storage.items.get(h.state.currentSnapshotId);
  const [request] = h.saveRequests;
  assert.ok(request, "the save must reach the storage request");
  assert.equal(request.method, "POST");
  assert.equal(request.url, location === "cloud" ? "/api/cloud/projects/cloud-project/save" : "/api/canvases");
  if (location === "cloud") assert.equal(request.body.name, request.body.bundle.name);
  return location === "cloud" ? request.body.bundle : request.body;
}

for (const location of ["server", "cloud", "device"]) {
  test(`saving a named device Canvas copy to ${location} retains its name and original`, async () => {
    const h = namedCanvasCopyHarness(location);
    const metadataRequests = [];
    h.context.canvasDocumentsSaveMetadata = options => {
      metadataRequests.push(options.copy);
      return structuredClone(h.state.currentSnapshotBundleExtensions);
    };

    await h.context.saveSnapshotFromHistory();

    const item = savedCopy(h, location);
    assert.equal(item.name, h.original.name);
    assert.equal(h.state.currentSnapshotName, h.original.name);
    assert.equal(h.state.currentSnapshotHasExplicitName, true);
    assert.equal(h.state.currentSnapshotLocation, location);
    assert.notEqual(h.state.currentSnapshotId, h.original.id);
    assert.notEqual(item.id, h.original.id);
    assert.deepEqual(metadataRequests, [true]);
    assert.deepEqual(h.storage.items.get(h.original.id), h.original);
    const widgets = location === "device" ? item.widgets : item.assets.filter(asset => asset.kind === "widget");
    assert.equal(widgets.length, 1);
    assert.deepEqual(h.busy, [true, false]);
    assert.equal(h.notices.at(-1).key, "snapshotSaved");
  });

  test(`saving an unnamed Canvas to ${location} keeps the original naming fallback`, async () => {
    const h = namedCanvasCopyHarness(location);
    h.state.currentSnapshotName = "Sep 27, 2026, 9:30 AM";
    h.state.currentSnapshotHasExplicitName = false;
    await h.context.saveSnapshotFromHistory();
    assert.equal(savedCopy(h, location).name, location === "cloud" ? "Untitled Canvas" : "");
  });
}

test("an entered copy name takes priority over the existing Canvas name", async () => {
  const h = namedCanvasCopyHarness("cloud");
  h.historyName.value = "  课程设计（副本）  ";
  await h.context.saveSnapshotFromHistory();
  assert.equal(savedCopy(h, "cloud").name, "课程设计（副本）");
  assert.equal(h.state.currentSnapshotName, "课程设计（副本）");
  assert.equal(h.historyName.value, "");
  assert.deepEqual(h.storage.items.get(h.original.id), h.original);
});

test("a generated name is retained when saving an unnamed Canvas to Server", async () => {
  const h = namedCanvasCopyHarness("server");
  h.state.currentSnapshotHasExplicitName = false;
  h.state.currentCanvasSuggestedName = "Suggested lesson";
  await h.context.saveSnapshotFromHistory();
  assert.equal(savedCopy(h, "server").name, "Suggested lesson");
  assert.equal(h.state.currentCanvasSuggestedName, "");
});

test("a blank copy name retains an existing long imported Canvas name without truncation", async () => {
  const h = namedCanvasCopyHarness("cloud");
  const name = "Imported lesson ".repeat(5);
  h.state.currentSnapshotName = name;
  h.historyName.value = "  ";
  await h.context.saveSnapshotFromHistory();
  assert.equal(savedCopy(h, "cloud").name, name);
});

test("an explicit rename persists an otherwise blank Canvas with its name and identity", async () => {
  const h = harness();
  const result = await h.context.renameCurrentCanvasFromTitle("  Empty lesson  ");

  assert.equal(result, true);
  assert.equal(h.storage.items.size, 1);
  const [id, item] = [...h.storage.items.entries()][0];
  assert.equal(item.id, id);
  assert.equal(item.name, "Empty lesson");
  assert.equal(item.bundleExtensions.penechoDocument.documentId, "blank-document");
  assert.equal(h.state.currentSnapshotId, id);
  assert.equal(h.state.currentSnapshotLocation, "device");
  assert.equal(h.state.currentSnapshotName, "Empty lesson");
  assert.deepEqual(h.busy, [true, false]);
  assert.equal(h.notices.some(notice => notice.key === "canvasRenamed" && notice.tone === "success"), true);
});

test("an ordinary save still rejects an unnamed blank Canvas", async () => {
  const h = harness();
  const result = await h.context.saveSnapshot();

  assert.equal(result, null);
  assert.equal(h.storage.items.size, 0);
  assert.equal(h.state.currentSnapshotId, null);
  assert.deepEqual(h.statusKeys, ["emptyCanvas"]);
});

test("a failed rename never reports success and releases the busy state", async () => {
  const h = harness({ failWrites: true });
  const result = await h.context.renameCurrentCanvasFromTitle("Will not save");

  assert.equal(result, false);
  assert.equal(h.storage.items.size, 0);
  assert.equal(h.state.currentSnapshotId, null);
  assert.deepEqual(h.busy, [true, false]);
  assert.equal(h.notices.some(notice => notice.key === "canvasRenamed"), false);
  assert.equal(h.statuses.some(message => message.includes("simulated persistence failure")), true);
});

test("renaming an existing Canvas overwrites its stored identity", async () => {
  const h = harness();
  const existing = {
    version: 2,
    id: "saved-canvas",
    createdAt: 123,
    updatedAt: 456,
    name: "Before",
    projectId: null,
    bundleExtensions: { penechoDocument: { version: 1, documentId: "saved-document" } },
  };
  h.storage.items.set(existing.id, existing);
  h.storage.tiles.set("saved-canvas:tile-1", { id: "saved-canvas:tile-1", snapshotId: existing.id });
  h.context.snapshotItems = [existing];
  Object.assign(h.state, {
    currentSnapshotId: existing.id,
    currentSnapshotLocation: "device",
    currentSnapshotName: existing.name,
    currentSnapshotHasExplicitName: true,
    currentSnapshotBundleExtensions: existing.bundleExtensions,
  });

  const result = await h.context.renameCurrentCanvasFromTitle("After");

  assert.equal(result, true);
  assert.equal(h.storage.items.size, 1);
  const saved = h.storage.items.get(existing.id);
  assert.equal(saved.id, existing.id);
  assert.equal(saved.createdAt, existing.createdAt);
  assert.equal(saved.name, "After");
  assert.equal(saved.bundleExtensions.penechoDocument.documentId, "saved-document");
  assert.equal(h.storage.tiles.size, 0);
  assert.equal(h.state.currentSnapshotId, existing.id);
});

test('saving retains Widget source when preview capture is unavailable',async()=>{
 const h=harness(),widget={id:'animated-widget',html:'<canvas></canvas>',x:100,y:100,w:400,h:400};
 h.context.visibleWidgets=()=>[widget];h.context.serializedWidgets=()=>[widget];
 h.context.prepareVisibleWidgetSnapshots=async(region,bestEffort)=>{
  if(!bestEffort)throw Error('snapshot timed out');
  return {total:1,captured:0,missing:1};
 };
 const result=await h.context.saveSnapshot({name:'Animation'});
 assert.ok(result);assert.equal(h.storage.items.size,1);
 const item=[...h.storage.items.values()][0];assert.equal(item.widgets[0].html,widget.html);
});
