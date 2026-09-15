"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const patchText = (file, before, after) => require("diff").createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after);

const ROOT = path.join(__dirname, "..");

function clientFunction(file, name) {
  const source = fs.readFileSync(path.join(ROOT, "src/client/app", file), "utf8");
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated ${name}`);
}

function memoryDb(records, control) {
  return {
    transaction(_name, mode) {
      const tx = { error: null };
      tx.objectStore = () => ({
        getAll: () => ({ value: [...records.values()] }),
        get: id => ({ value: records.get(id) }),
        put: value => {
          queueMicrotask(() => {
            if (control.persistFailures > 0) {
              control.persistFailures -= 1;
              tx.error = Error("simulated persistence failure");
              tx.onerror?.();
              return;
            }
            records.set(value.id, structuredClone(value));
            control.persistWrites += 1;
            tx.oncomplete?.();
          });
        },
        delete: id => {
          records.delete(id);
          queueMicrotask(() => tx.oncomplete?.());
          return { value: undefined };
        },
      });
      if (mode === "readonly") queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
}

function harness(options = {}) {
  const records = options.records || new Map();
  const control = { persistFailures: 0, persistWrites: 0, mounts: 0, frames: 0, renders: 0 };
  const state = {
    language: "en", theme: "light", userRevision: 1, snapshotSavedRevision: 0,
    currentSnapshotId: null, currentSnapshotLocation: null, currentSnapshotName: "Visible",
    currentSnapshotBundleExtensions: {
      penechoDocument: { version: 1, documentId: options.activeId || "visible-document", title: "Visible", bindings: [], locators: [], processor: { kind: "penecho" } },
    },
    currentSnapshotManifestExtensions: {}, currentSnapshotPreservedAssets: [],
    widgets: [], textBoxes: [], images: [], preservedSnapshotAnimations: [], animations: [], history: [], future: [], historyBefore: new Map(),
    nextWidgetId: 1, nextTextBoxId: 1, nextImageId: 1, scale: 1, panX: 0, panY: 0,
    inkColor: "#111", aiFont: "sans-serif", inkBounds: new Map(),
  };
  const listeners = {};
  const context = vm.createContext({
    PenEchoCanvasFilePatch: require("../src/shared/canvas-file-patch"),
    SIZE: 32768, TILE: 512, MAX_HISTORY: 50, state, crypto: options.crypto || crypto.webcrypto,
    TextEncoder, TextDecoder, Blob, URL, structuredClone, queueMicrotask,
    AbortController, AbortSignal, setTimeout, clearTimeout, performance,
    document: { getElementById: () => null, querySelectorAll: () => [], hidden: false, createElement: () => ({}) },
    window: { PENECHO_CONFIG: {} }, location: { origin: "http://127.0.0.1" }, WebSocket: { OPEN: 1 },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    requestResult: async request => request.value,
    indexedDB: { open: () => { throw Error("unexpected IndexedDB open"); } },
    allSnapshots: async () => options.snapshots || [],
    fetch: async url => ({ ok: true, json: async () => ({ canvases: options.remote?.[String(url)] || [] }) }),
    authenticatedApiHeaders: () => ({}),
    readSnapshot: async (location, id) => options.saved?.get(`${location}:${id}`) || null,
    widgetRecord: value => ({ ...value }), widgetUsesHtmlCopySource: () => false,
    renderedTextBoxRecord: async value => ({ id: value.id || `text-box-${state.nextTextBoxId++}`, text: value.text, fontSize:value.fontSize, maxWidth:value.maxWidth, x: value.x || 0, y: value.y || 0, w: value.w || value.maxWidth || 240, h: value.h || 48 }),
    canvasAgentHash: async value => crypto.createHash("sha256").update(String(value)).digest("hex"),
    canvasAgentAssertToolExecution: () => {}, canvasAgentMutationIdle: () => {},
    canvasAgentObject: id => {
      const item = state.widgets.find(entry => entry.id === id) || state.textBoxes.find(entry => entry.id === id) || state.images.find(entry => entry.id === id);
      return item ? { kind: state.widgets.includes(item) ? "widget" : state.textBoxes.includes(item) ? "text" : "image", item } : null;
    },
    canvasAgentCreate: async args => {
      control.mounts += 1;
      const input = args.items[0], item = { id: `widget-${state.nextWidgetId++}`, ...input, x: input.placement?.x || 0, y: input.placement?.y || 0, w: input.width, h: input.height, contentW: input.width, contentH: input.height };
      state.widgets.push(item); state.userRevision += 1;
      return { receipts: [{ objectId: item.id }] };
    },
    canvasAgentReplaceWidget: async () => { throw Error("active replacement was not expected"); },
    canvasAgentEdit: async () => { throw Error("active edit was not expected"); },
    canvasAgentBox: object => ({ x: object.item.x, y: object.item.y, w: object.item.w, h: object.item.h }),
    canvasAgentAllObjects: () => state.widgets.map(item => ({ id: item.id, box: { x: item.x, y: item.y, w: item.w, h: item.h } })),
    canvasAgentContentBounds: () => null, canvasAgentPlacementBox: (w, h) => ({ x: 96, y: 96, w, h, crowded: false }),
    canvasAgentInternalRect: box => box, canvasAgentFramePlan: () => ({ scale: 1 }),
    canvasAgentFrameRegion: () => { control.frames += 1; }, canvasAgentViewFacts: () => ({}),
    canvasAgentSelectionIds: () => [], canvasAgentSyncState: () => {}, canvasAgentSyncAutomaticAIStatus: () => {},
    canvasAgentCanvasDidChange: () => {}, canvasAgentCapture: async () => { throw Error("capture was not expected"); },
    canvasAgentInput: { value: "" }, canvasAgent: { attachments: [], inkPresent: false }, canvasAgentResizeInput: () => {},
    visibleInkBounds: () => null, viewportRect: () => ({ x: 0, y: 0, w: 1200, h: 800 }),
    intersection: (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y,
    unionDirtyBounds: (a, b) => !a ? { ...b } : a, tiles: new Map(),
    save: () => {}, requestRender: () => { control.renders += 1; }, render: () => { control.renders += 1; },
    serializedWidgets: () => state.widgets.map(item => ({ ...item })), storedTextBoxes: () => state.textBoxes.map(item => ({ ...item })), storedImages: () => state.images.map(item => ({ ...item })), serializedAnimations: () => [],
    imageHistoryState: () => [], textBoxHistoryState: () => [], positionWidget: () => {}, unmountWidget: () => { control.mounts += 1; },
    restoreCanvasObjectFrontKinds:(front,placed)=>{state.frontCanvasObjectKind=["image","widget","text-box"].includes(front)?front:"image";state.frontPlacedCanvasObjectKind=["image","text-box"].includes(placed)?placed:"image";},
    snapshotExtensionObject: value => structuredClone(value || {}), snapshotPreservedAssets: value => structuredClone(value || []),
    finalizeCanvasForSnapshot: async () => {}, canvasBlob: async value => value, cloneCanvas: value => value,
    offscreen: () => ({ getContext: () => ({ drawImage: () => {}, clearRect: () => {} }) }),
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }), dataUrlBlob: () => new Blob([], { type: "image/png" }),
    writeClipboardText: async () => true, peButton: () => {}, requestWidgetSnapshot: () => { throw Error("snapshot was not expected"); },
    stopActiveAutomaticAI: () => {}, schedule: () => {}, clearTextEditors: () => {}, invalidateRecognition: () => {}, cancelPendingForRevision: () => {}, cancelSelection: () => {}, clearSharpOverlays: () => {},
    enableSnapshotWidgetPlugins: async () => {}, decodeSnapshotTilesInBatches: async () => new Map(), decodeSnapshotImagesInBatches: async () => [], releaseSnapshotTileCanvases: () => {},
    setCanvasMode: mode => { state.mode = mode; }, pluginEnabled: () => true, visibleWidgets: () => state.widgets,
    restoreAnimations: () => {},
    restoreWidgets: items => state.widgets.splice(0, state.widgets.length, ...items.map(item => ({ ...item }))),
    restoreImages: items => state.images.splice(0, state.images.length, ...items.map(item => ({ ...item }))),
    restoreTextBoxes: async items => state.textBoxes.splice(0, state.textBoxes.length, ...items.map(item => ({ ...item }))),
    applyTheme: () => {}, updateCoordinates: () => {}, setCanvasNavigationLocked: () => {},
    snapshotLoadInProgress: false, plotObjectImage: async () => { throw Error("plot was not expected"); }, mcpPlotView: () => ({}), mcpPrimitiveLayout: () => ({}), mcpPrimitiveRaster: () => ({}),
  });
  const scripts = ["document-identity.js", "mcp-runtime.js", "canvas-documents.js"]
    .map(file => fs.readFileSync(path.join(ROOT, "src/client/app", file), "utf8")).join("\n");
  vm.runInContext(`${clientFunction("core.js", "canvasClientId")}\n${["resetCanvasDefaultMode","snapshotCanvasObjectExtensions","restoreSnapshotCanvasObjectOrder","currentCanvasDisplayName","currentCanvasNeedsAgentName","applyCurrentCanvasGeneratedName"].map(name=>clientFunction("persistence.js",name)).join("\n")}\n${scripts}\nglobalThis.api={canvasDocumentIdentity,canvasDocuments,canvasDocumentsReady,canvasDocumentsCurrent,canvasDocumentsExternal,canvasDocumentsRecord,canvasDocumentsSaveMetadata,canvasDocumentsDidSave,canvasDocumentsExecute,canvasAgentDocumentOperation,canvasDocumentsQueueMessage,canvasDocumentsClose,mcpRuntime};`, context);
  const primitiveSource=fs.readFileSync(path.join(ROOT,"src/client/app/mcp-primitives.js"),"utf8");
  vm.runInContext(primitiveSource.slice(0,primitiveSource.indexOf("  function mcpPrimitiveLayout")),context);
  context.api.canvasDocuments.db = memoryDb(records, control);
  return { ...context.api, context, control, records, state, listeners };
}

async function createHidden(h, requestId, title) {
  return h.canvasDocumentsExecute("mcp_open_canvas", { instanceId: "instance", canvasId: "bridge", create: true, title, requestId, show: false }, {});
}

async function startHidden(h, documentId, sessionId, sessionKey = `${sessionId}-key`, client = "Codex") {
  return h.canvasDocumentsExecute("mcp_start_session", { sessionId, documentId, sessionKey, client, title: sessionId, slotIndex: 0, takeover: false }, {});
}

test("reading Agent availability before workspace initialization does not create a Canvas", () => {
  const h = harness({ crypto: {} });
  h.state.currentSnapshotBundleExtensions = {};
  assert.equal(h.canvasDocumentsExternal(), false);
  assert.equal(h.canvasDocuments.activeId, null);
  assert.equal(h.canvasDocuments.records.size, 0);
  vm.runInContext(`canvasDocuments = undefined;`, h.context);
  assert.equal(h.canvasDocumentsExternal(), false);
});

test("Canvas boot reaches theme paint and creates distinct documents without randomUUID", async () => {
  const h = harness({ crypto: { getRandomValues: crypto.webcrypto.getRandomValues.bind(crypto.webcrypto) } });
  h.state.currentSnapshotBundleExtensions = {};
  h.state.paint = { paper: "#ead9ad" };
  Object.assign(h.context, {
    canvasAgentSend: { setAttribute() {}, removeAttribute() {} },
    canvasAgentExecutionAvailable: () => true,
    getComputedStyle: () => ({ getPropertyValue: name => name === "--paper" ? "#ffffff" : "" }),
  });
  vm.runInContext(`${clientFunction("canvas-agent-runtime.js", "canvasAgentSyncSendAvailability")}
    ${clientFunction("core.js", "updatePaint")}
    canvasAgentSyncSendAvailability(); updatePaint();`, h.context);
  assert.equal(h.state.paint.paper, "#ffffff", "Agent controls must not stop the white theme from initializing");
  await h.canvasDocumentsReady();
  const current = h.canvasDocumentsCurrent();
  assert.match(current.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(h.canvasDocumentsCurrent().id, current.id);
  const other = await createHidden(h, "no-uuid-create", "Another Canvas");
  assert.notEqual(other.documentId, current.id);
  assert.equal(h.canvasDocumentsExternal(), false);
  current.processor = { kind: "external", bindingKey: "test-key", client: "Test AI" };
  assert.equal(h.canvasDocumentsExternal(), true);
});

test("History closes only after an already-open Canvas has successfully activated", async () => {
  for (const location of ["device", "server", "cloud"]) {
    const h = harness();
    const events = [];
    let finish;
    Object.assign(h.context, {
      canvasDocuments: { activeId: "current", records: new Map([["qed", { id: "qed", locator: { id: "saved-qed", location } }]]) },
      canvasDocumentsShow: async id => { events.push(id); await new Promise(resolve => { finish = resolve; }); },
      closeHistoryPanel: () => events.push("closed"),
      setStatusKey: key => events.push(key),
    });
    vm.runInContext(`async ${clientFunction("persistence.js", "loadSnapshot")}`, h.context);
    const loading = h.context.loadSnapshot("saved-qed", location);
    assert.deepEqual(events, ["qed"], "Library stays visible while switching");
    finish();
    assert.equal(await loading, true);
    assert.deepEqual(events, ["qed", "closed", "snapshotLoaded"]);
    events.length = 0;
    h.context.canvasDocumentsShow = async () => { throw Error("Canvas is busy"); };
    await assert.rejects(h.context.loadSnapshot("saved-qed", location), /Canvas is busy/);
    assert.deepEqual(events, [], "failed activation keeps Library open without a success status");
  }
});

test("History loads legacy canvases without Web Crypto and permits retry after a read failure", async () => {
  for (const location of ["device", "server", "cloud"]) {
    const item = {
      id: "旧画布-1", name: "QED 板书视觉分析", version: 2, theme: "studio",
      widgets: [{ id: "widget-1", html: "<p>Preserved lesson</p>", x: 100, y: 200, w: 640, h: 400 }],
      textBoxes: [{ id: "text-box-1", text: "原有笔记", x: 800, y: 200, w: 200, h: 60 }],
      images: [], animations: [], bundleExtensions: {}, manifestExtensions: {}, preservedAssets: [],
    };
    const original = JSON.stringify(item), saved = new Map([[`${location}:${item.id}`, { item, tileEntries: [] }]]);
    const h = harness({ saved, crypto: { getRandomValues: crypto.webcrypto.getRandomValues.bind(crypto.webcrypto) } });
    h.state.snapshotLoadGeneration = 0;
    let closed = false, status = null;
    Object.assign(h.context, {
      snapshotItems: [item], snapshotLoadingId: null, snapshotName: value => value.name,
      t: key => key, updateHistoryReadControls() {}, setHistoryActivity() {},
      refreshVisibleTextBoxQuality() {}, closeHistoryPanel() { closed = true; },
      setStatusKey(key) { status = key; },
    });
    vm.runInContext(`async ${clientFunction("persistence.js", "loadSnapshot")}`, h.context);
    const read = h.context.readSnapshot;
    h.context.readSnapshot = async () => { throw Error("simulated read failure"); };
    await assert.rejects(h.context.loadSnapshot(item.id, location), /simulated read failure/);
    assert.equal(h.context.snapshotLoadInProgress, false, "the failed attempt releases the load lock");
    h.context.readSnapshot = read;
    assert.equal(await h.context.loadSnapshot(item.id, location), true);
    const expected = `legacy-${crypto.createHash("sha256").update(JSON.stringify({ location, scope: "", id: item.id })).digest("hex")}`;
    assert.equal(h.canvasDocumentsCurrent().id, expected);
    assert.equal(h.state.currentSnapshotBundleExtensions.penechoDocument.documentId, expected);
    assert.equal(h.state.widgets[0].html, item.widgets[0].html);
    assert.equal(h.state.textBoxes[0].text, item.textBoxes[0].text);
    assert.equal(h.state.currentSnapshotLocation, location);
    assert.equal(status, "snapshotLoaded");
    assert.equal(closed, true);
    assert.equal(h.context.snapshotLoadInProgress, false);
    assert.equal(JSON.stringify(item), original, "loading does not rewrite the saved bundle");
  }
});

test("MCP finds only open workspace records, excludes closed provider copies, and filters documentId", async () => {
  const records = new Map(), first = harness({records});
  await first.canvasDocumentsReady();
  const open = await createHidden(first, "catalog-open", "Open workspace");
  const closed = await createHidden(first, "catalog-closed", "Closed workspace");
  await startHidden(first, closed.documentId, "catalog-close-session", "catalog-close-key");
  await first.context.canvasDocumentsShow(closed.documentId);
  await first.canvasDocumentsClose(closed.documentId);
  assert.equal(records.get(closed.documentId).closed, true);

  const second = harness({
    records,
    snapshots: [{id:"device-old",name:"Device lesson"}],
    remote: {
      "/api/canvases?metadataOnly=1": [{id:"server-old",name:"Server lesson"}],
      "/api/cloud/library": [{id:"cloud-old",name:"Cloud lesson"}],
    },
  });
  await second.canvasDocumentsReady();
  const found = await second.canvasDocumentsExecute("mcp_find_canvases", {}, {});
  const openIds = found.canvases.filter(item => item.open).map(item => item.documentId);
  assert.equal(openIds.includes("device-old"), false);
  assert.equal(openIds.includes("server-old"), false);
  assert.equal(openIds.includes("cloud-old"), false);
  assert.equal(openIds.includes(closed.documentId), false);
  assert.equal(openIds.includes(open.documentId), true);

  const filtered = await second.canvasDocumentsExecute("mcp_find_canvases", {documentId:open.documentId}, {});
  assert.equal(JSON.stringify(filtered.canvases.map(({documentId,title,active}) => ({documentId,title,active}))), JSON.stringify([
    {documentId:open.documentId,title:"Open workspace",active:false},
  ]));
  const closedFilter = await second.canvasDocumentsExecute("mcp_find_canvases", {documentId:closed.documentId}, {});
  assert.equal(closedFilter.canvases.length, 0);
});

test("MCP document catalog mirrors every open record, keeps document titles, and drops a closed record", async () => {
  const h = harness();
  await h.canvasDocumentsReady();
  const visible = h.canvasDocumentsCurrent();
  h.state.currentSnapshotName = "Visible work";
  visible.title = "Visible work";
  const userNew = await createHidden(h, "catalog-user-new", "New board");
  const userLoaded = await createHidden(h, "catalog-user-load", "Loaded board");
  const loaded = h.canvasDocuments.records.get(userLoaded.documentId);
  loaded.locator = { location:"device", id:"saved-loaded-board" };

  // The records represent a user-created Canvas and a loaded saved Canvas;
  // neither needs an MCP open request to be part of the open-page catalog.
  const catalog = await h.canvasDocumentsExecute("mcp_find_canvases", {}, {});
  assert.equal(JSON.stringify(catalog.canvases.filter(item => item.open).map(({documentId,title,active}) => ({documentId,title,active}))), JSON.stringify([
    {documentId:userLoaded.documentId,title:"Loaded board",active:false},
    {documentId:userNew.documentId,title:"New board",active:false},
    {documentId:visible.id,title:"Visible work",active:true},
  ]));
  assert.equal(catalog.canvases.find(item => item.documentId === userLoaded.documentId).locator.id, "saved-loaded-board");

  await startHidden(h, userNew.documentId, "catalog-session", "catalog-key", "Codex");
  assert.equal(h.canvasDocuments.records.get(userNew.documentId).title, "New board", "a session title must not replace the Canvas title");

  await h.context.canvasDocumentsShow(userLoaded.documentId);
  await h.canvasDocumentsClose(userLoaded.documentId);
  const afterClose = await h.canvasDocumentsExecute("mcp_find_canvases", {}, {});
  assert.equal(afterClose.canvases.some(item => item.documentId === userLoaded.documentId), false, "closing a document removes it from the open catalog");
  assert.equal(afterClose.canvases.find(item => item.documentId === userNew.documentId).title, "New board");
});

test("MCP browser catalog publishes every open document with its stable identity", async () => {
  const h = harness();
  await h.canvasDocumentsReady();
  const visible = h.canvasDocumentsCurrent();
  h.state.currentSnapshotName = "Visible work";
  visible.title = "Visible work";
  const userNew = await createHidden(h, "catalog-wire-new", "New board");
  const userLoaded = await createHidden(h, "catalog-wire-load", "Loaded board");

  class CatalogSocket {
    static OPEN = 1;
    static instances = [];
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.listeners = new Map(); CatalogSocket.instances.push(this); }
    addEventListener(type, listener) { const listeners = this.listeners.get(type) || []; listeners.push(listener); this.listeners.set(type, listeners); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; for (const listener of this.listeners.get("close") || []) listener(); }
    emit(type, value) { for (const listener of this.listeners.get(type) || []) listener(value); }
  }
  Object.assign(h.context, {
    WebSocket: CatalogSocket,
    mcpHeartbeat: () => {}, mcpRenderSettings: () => {}, mcpLanOpened: async () => {}, showCanvasHint: () => {},
  });
  vm.runInContext("mcpConnect()", h.context);
  const socket = CatalogSocket.instances.at(-1);
  socket.readyState = CatalogSocket.OPEN;
  socket.emit("open");
  const hello = socket.sent.find(message => message.type === "hello");
  assert.ok(hello, "opening MCP must identify the browser");
  assert.equal(JSON.stringify(hello.documents.map(({documentId,title,active}) => ({documentId,title,active}))), JSON.stringify([
    {documentId:userLoaded.documentId,title:"Loaded board",active:false},
    {documentId:userNew.documentId,title:"New board",active:false},
    {documentId:visible.id,title:"Visible work",active:true},
  ]));
  socket.emit("message", { data: JSON.stringify({ type:"ready", heartbeat:false, catalog:true }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.mcpRuntime.catalogSupported, true);
  assert.equal(socket.readyState, CatalogSocket.OPEN);
  assert.equal(h.context.WebSocket.OPEN, CatalogSocket.OPEN);
  assert.equal(h.mcpRuntime.socket, socket);
  assert.equal(h.mcpRuntime.catalogSignature, JSON.stringify(hello.documents));
  await h.context.canvasDocumentsShow(userLoaded.documentId);
  await h.canvasDocumentsClose(userLoaded.documentId);
  await new Promise(resolve => setImmediate(resolve));
  const afterClose = socket.sent.filter(message => message.type === "catalog").at(-1);
  assert.ok(afterClose, "closing a document must republish the catalog");
  assert.equal(afterClose.documents.some(document => document.documentId === userLoaded.documentId), false);
});

test("two documents route hidden sessions without changing or mounting the visible Canvas", async () => {
  const h = harness(), initial = h.canvasDocumentsCurrent().id;
  const one = await createHidden(h, "create-one", "One");
  const two = await createHidden(h, "create-two", "Two");
  assert.notEqual(one.documentId, two.documentId);
  const session = await startHidden(h, two.documentId, "hidden-session");
  assert.equal(session.documentId, two.documentId);
  assert.equal(session.active, false);
  assert.equal(session.boardObjectId, null);
  assert.equal(h.canvasDocuments.records.get(two.documentId).stored.item.widgets.length, 0);
  assert.equal(h.canvasDocuments.activeId, initial);
  assert.equal(h.control.mounts, 0);
  assert.equal(h.control.frames, 0);
  await assert.rejects(
    h.canvasDocumentsExecute("mcp_capture_canvas", { sessionId: "hidden-session", target: "viewport", quality: "basic" }, {}),
    error => error.code === "CANVAS_NOT_VISIBLE" && error.details.documentId === two.documentId && error.details.retryable === true,
  );

  const first = await h.canvasDocumentsExecute("mcp_present_widget", { sessionId: "hidden-session", artifactId: "report", title: "Report", html: "<p>first</p>" }, {});
  const second = await h.canvasDocumentsExecute("mcp_present_widget", { sessionId: "hidden-session", artifactId: "report", title: "Report", html: "<p>second</p>" }, {});
  assert.equal(second.objectId, first.objectId);
  const doc = h.canvasDocuments.records.get(two.documentId);
  assert.equal(doc.stored.item.widgets.filter(item => item.id === first.objectId).length, 1);
  assert.equal(doc.stored.item.widgets.find(item => item.id === first.objectId).html, "<p>second</p>");
  assert.equal(h.canvasDocuments.activeId, initial);
  assert.equal(h.control.mounts, 0);
  assert.equal(h.control.frames, 0);
});

test("creating another Canvas stops at the open limit with a localized close-first hint", async () => {
  const h = harness();
  for (let index = 0; index < 64; index++) h.canvasDocuments.records.set(`limit-${index}`, { id: `limit-${index}` });
  await assert.rejects(createHidden(h, "limit-create", "One too many"), error => {
    assert.equal(error.code, "DOCUMENT_LIMIT");
    assert.match(error.message, /64 Canvases are already open/);
    assert.match(error.message, /Close an unused Canvas before opening another/);
    return true;
  });
  h.state.language = "zh";
  await assert.rejects(createHidden(h, "limit-create-zh", "One too many"), error => {
    assert.match(error.message, /已打开 64 个画布/);
    assert.match(error.message, /请先关闭不用的画布/);
    return true;
  });
  h.state.language = "en";
  h.canvasDocuments.records.delete("limit-0");h.canvasDocuments.records.delete("limit-1");
  const before = h.canvasDocuments.records.size, created = await createHidden(h, "limit-create-ok", "Fits");
  assert.equal(created.created, true);
  assert.equal(h.canvasDocuments.records.size, before + 1);
});

test("virtual source edits preserve geometry, reject stale hashes, and recover mutation retries after persistence failure", async () => {
  const h = harness(), opened = await createHidden(h, "create-files", "Files");
  await startHidden(h, opened.documentId, "files-session");
  const shown = await h.canvasDocumentsExecute("mcp_present_widget", { sessionId: "files-session", artifactId: "artifact", title: "Artifact", html: "<p>old</p>" }, {});
  const pathName = `objects/${shown.objectId}/widget.html`;
  const listing = await h.canvasDocumentsExecute("mcp_list_files", { sessionId: "files-session", path: `objects/${shown.objectId}` }, {});
  assert.ok(listing.entries.some(entry => entry.path === pathName));
  const read = await h.canvasDocumentsExecute("mcp_read_file", { sessionId: "files-session", path: pathName }, {});
  assert.equal(read.content, "<p>old</p>");
  const doc = h.canvasDocuments.records.get(opened.documentId), widget = doc.stored.item.widgets.find(item => item.id === shown.objectId);
  const geometry = { x: widget.x, y: widget.y, w: widget.w, h: widget.h };

  await assert.rejects(
    h.canvasDocumentsExecute("mcp_patch_file", { sessionId: "files-session", path: pathName, patch: patchText(pathName,"<p>old</p>","<p>stale</p>"), expectedHash: "stale", requestId: "stale-patch" }, {}),
    error => error.code === "SOURCE_CONFLICT" && error.details.currentHash === read.contentHash,
  );
  assert.equal(widget.html, "<p>old</p>");

  h.control.persistFailures = 1;
  const applyArgs = { sessionId: "files-session", path: pathName, patch: patchText(pathName,"<p>old</p>","<p>new</p>"), expectedHash: read.contentHash, requestId: "source-patch" };
  await assert.rejects(h.canvasDocumentsExecute("mcp_patch_file", applyArgs, {}), /simulated persistence failure/);
  const revisionAfterMutation = doc.revision;
  const retry = await h.canvasDocumentsExecute("mcp_patch_file", applyArgs, {});
  assert.equal(retry.applied, true);
  assert.equal(doc.revision, revisionAfterMutation);
  assert.equal(widget.html, "<p>new</p>");
  assert.deepEqual({ x: widget.x, y: widget.y, w: widget.w, h: widget.h }, geometry);
  await assert.rejects(h.canvasDocumentsExecute("mcp_patch_file", {...applyArgs,patch:patchText(pathName,"<p>old</p>","<p>different</p>")}, {}),{code:"REQUEST_ID_CONFLICT"});
  assert.equal(retry.sourcePath,pathName);

});

test("existing-content edits require the current document revision", async () => {
  const h = harness(), opened = await createHidden(h, "create-edit", "Edit");
  await startHidden(h, opened.documentId, "edit-session");
  const created = await h.canvasDocumentsExecute("mcp_present_widget", { sessionId: "edit-session", artifactId: "move-target", title: "Move target", html: "<p>Move me</p>" }, {});
  const doc = h.canvasDocuments.records.get(opened.documentId);
  await assert.rejects(
    h.canvasDocumentsExecute("mcp_edit_canvas", { sessionId: "edit-session", action: "move", objectId: created.objectId, region: { x: 1200, y: 1200, w: 840, h: 600 }, requestId: "move-no-revision" }, {}),
    error => error.code === "REVISION_CONFLICT",
  );
  const moved = await h.canvasDocumentsExecute("mcp_edit_canvas", { sessionId: "edit-session", action: "move", objectId: created.objectId, region: { x: 1200, y: 1200, w: 840, h: 600 }, baseRevision: doc.revision, requestId: "move-current" }, {});
  assert.equal(moved.applied, true);
  assert.equal(doc.stored.item.widgets.find(item => item.id === created.objectId).x, 1200);
});

test("pull inbox is isolated by client and key, reading does not acknowledge, and cancellation is final", async () => {
  const h = harness(), opened = await createHidden(h, "create-inbox", "Inbox");
  await startHidden(h, opened.documentId, "session-a", "key-a", "Codex");
  await startHidden(h, opened.documentId, "session-b", "key-b", "Claude");
  const doc = h.canvasDocuments.records.get(opened.documentId);
  doc.messageSequence = 3;
  doc.messages.push(
    { id: "a-queued", cursor: 1, bindingKey: "key-a", client: "Codex", text: "A", status: "queued" },
    { id: "b-queued", cursor: 2, bindingKey: "key-b", client: "Claude", text: "B", status: "queued" },
    { id: "a-cancelled", cursor: 3, bindingKey: "key-a", client: "Codex", text: "Stop", status: "cancelled" },
  );
  const read = await h.canvasDocumentsExecute("mcp_inbox", { sessionId: "session-a", after: 0, limit: 20 }, {});
  assert.equal(read.messages.messages.map(entry => entry.id).join(","), "a-queued,a-cancelled");
  assert.equal(doc.messages[0].status, "queued");
  assert.equal(read.feedback.entries.length,0);
  await assert.rejects(
    h.canvasDocumentsExecute("mcp_inbox", { mode:"ack", sessionId: "session-a", ids: ["b-queued"], status: "received", requestId: "wrong-owner" }, {}),
    error => error.code === "MESSAGE_NOT_FOUND",
  );
  await assert.rejects(
    h.canvasDocumentsExecute("mcp_inbox", { mode:"ack", sessionId: "session-a", ids: ["a-cancelled"], status: "working", requestId: "cancelled" }, {}),
    error => error.code === "MESSAGE_CANCELLED",
  );
  assert.equal(doc.messages[2].status, "cancelled");
});

test("persisted conversation bindings reopen the same document and artifact identity", async () => {
  const records = new Map(), first = harness({ records });
  const opened = await createHidden(first, "create-persisted", "Persisted");
  const original = await startHidden(first, opened.documentId, "old-session", "conversation-key", "Codex");
  assert.equal(original.boardObjectId, null);
  const originalArtifact = await first.canvasDocumentsExecute("mcp_present_widget", { sessionId: "old-session", artifactId: "persisted-artifact", title: "Persisted artifact", html: "<p>Retained artifact</p>", presentation: { intent: "compare", role: "supporting", size: "wide", attention: "quiet" } }, {});
  assert.ok(records.has(opened.documentId));

  const second = harness({ records, activeId: "another-visible-document" });
  const reopened = await startHidden(second, opened.documentId, "new-session", "conversation-key", "Codex");
  assert.equal(reopened.documentId, opened.documentId);
  assert.equal(reopened.boardObjectId, null);
  const inspected = await second.canvasDocumentsExecute("mcp_inspect_session", { sessionId: "new-session" }, {});
  const persistedArtifact = inspected.artifacts.find(artifact => artifact.artifactId === "persisted-artifact");
  assert.equal(persistedArtifact.objectId, originalArtifact.objectId);
  assert.equal(JSON.stringify(persistedArtifact.presentation), JSON.stringify(originalArtifact.presentation));
  assert.equal(second.canvasDocuments.activeId, "another-visible-document");
});

test("partial reconnect preserves other bindings and closed sessions do not revive", async () => {
  const records = new Map(), first = harness({records});
  const opened = await createHidden(first, "restore-pair", "Pair");
  for (const key of ["a", "b"]) {
    await startHidden(first, opened.documentId, `old-${key}`, key);
    await first.canvasDocumentsExecute("mcp_present_widget", {sessionId:`old-${key}`,artifactId:`artifact-${key}`,title:key,html:`<p>${key}</p>`}, {});
    await first.canvasDocumentsExecute("mcp_update_session", {sessionId:`old-${key}`,summary:`Saved ${key}`,steps:[{id:key,label:key,status:"done"}],events:[{id:key,text:`Evidence ${key}`,kind:"evidence"}]}, {});
  }
  const savedB = JSON.parse(JSON.stringify(records.get(opened.documentId).workspace.sessions.find(s => s.sessionKey === "b")));
  const second = harness({records,activeId:"second-visible"});
  const resumedA = await startHidden(second, opened.documentId, "new-a", "a");
  assert.equal(resumedA.progress.summary, "Saved a");
  await second.canvasDocumentsExecute("mcp_update_session", {sessionId:"new-a",summary:"Updated a"}, {});
  assert.equal(records.get(opened.documentId).workspace.sessions.length, 2);
  const third = harness({records,activeId:"third-visible"});
  const resumedB = await startHidden(third, opened.documentId, "new-b", "b");
  const inspectedB = await third.canvasDocumentsExecute("mcp_inspect_session", {sessionId:"new-b"}, {});
  assert.equal(resumedB.documentId, opened.documentId);
  for (const field of ["summary", "steps", "events"]) {
    assert.equal(JSON.stringify(resumedB.progress[field]), JSON.stringify(savedB[field]));
    assert.equal(JSON.stringify(inspectedB[field]), JSON.stringify(savedB[field]));
  }
  assert.equal(inspectedB.artifacts[0].objectId, savedB.artifacts[0][1].objectId);
  await third.canvasDocumentsExecute("mcp_close_session", {sessionId:"new-b"}, {});
  const fourth = harness({records,activeId:"fourth-visible"});
  const closedB = await startHidden(fourth, opened.documentId, "after-close-b", "b");
  assert.equal(closedB.progress.summary, "");
  const resumedAgainA = await startHidden(fourth, opened.documentId, "again-a", "a");
  assert.equal(resumedAgainA.progress.summary, "Updated a");
});

test("keyless sessions stay independent and do not restore a saved binding", async () => {
  const records = new Map(), first = harness({records});
  const opened = await createHidden(first, "keyless-document", "Transient");
  await startHidden(first, opened.documentId, "keyless-one", "");
  await first.canvasDocumentsExecute("mcp_update_session", {sessionId:"keyless-one",summary:"Transient progress"}, {});
  const samePage = await startHidden(first, opened.documentId, "keyless-two", "");
  assert.equal(samePage.progress.summary, "");
  const second = harness({records,activeId:"keyless-visible"});
  const reopened = await startHidden(second, opened.documentId, "keyless-three", "");
  assert.equal(reopened.progress.summary, "");
  assert.equal(second.canvasDocuments.records.get(opened.documentId).bindings.length, 0);
});

test("unseen background updates survive automatic display and clear persistently on manual selection", async () => {
  const records = new Map(), first = harness({ records });
  const opened = await createHidden(first, "unseen-persist", "Unread");
  await startHidden(first, opened.documentId, "unseen-session");
  await first.canvasDocumentsExecute("mcp_present_widget", { sessionId: "unseen-session", artifactId: "unseen-artifact", title: "Unread artifact", html: "<p>New content</p>" }, {});
  const firstDoc = first.canvasDocuments.records.get(opened.documentId), unseen = firstDoc.unseen;
  assert.ok(unseen > 0);
  assert.equal(records.get(opened.documentId).unseen, unseen);

  const second = harness({ records, activeId: "reload-visible-document" });
  await second.canvasDocumentsReady();
  const reloaded = second.canvasDocuments.records.get(opened.documentId);
  assert.equal(reloaded.unseen, unseen);

  await second.canvasDocumentsExecute("mcp_open_canvas", { documentId: opened.documentId, requestId: "unseen-show", show: true }, {});
  assert.equal(reloaded.unseen, unseen);
  await second.context.canvasDocumentsShow(opened.documentId);
  assert.equal(reloaded.unseen, 0);
  assert.equal(records.get(opened.documentId).unseen, 0);

  const third = harness({ records, activeId: "clear-visible-document" });
  await third.canvasDocumentsReady();
  assert.equal(third.canvasDocuments.records.get(opened.documentId).unseen, 0);
});

test("failed Canvas decoding before activation preserves background unread state", async () => {
  const records = new Map(), h = harness({ records });
  const opened = await createHidden(h, "unseen-decode-failure", "Unread decode failure");
  await startHidden(h, opened.documentId, "unseen-decode-session");
  await h.canvasDocumentsExecute("mcp_present_widget", {
    sessionId: "unseen-decode-session", artifactId: "unseen-decode-artifact",
    title: "Unread artifact", html: "<p>New content</p>",
  }, {});
  const doc = h.canvasDocuments.records.get(opened.documentId), unseen = doc.unseen;
  assert.ok(unseen > 0);
  assert.equal(records.get(opened.documentId).unseen, unseen);

  h.context.decodeSnapshotTilesInBatches = async () => { throw Error("snapshot decode failed"); };
  await assert.rejects(
    h.canvasDocumentsExecute("mcp_open_canvas", { documentId: opened.documentId, requestId: "unseen-decode-show", show: true }, {}),
    /snapshot decode failed/,
  );
  assert.equal(h.canvasDocuments.activeId, "visible-document");
  assert.equal(doc.unseen, unseen);
  assert.equal(records.get(opened.documentId).unseen, unseen);
});

test("invalid persisted unseen values reset to zero", async () => {
  const records = new Map(), first = harness({ records });
  const opened = await createHidden(first, "unseen-invalid", "Invalid");
  const persisted = records.get(opened.documentId);
  persisted.unseen = -1;
  const negative = harness({ records, activeId: "negative-visible-document" });
  await negative.canvasDocumentsReady();
  assert.equal(negative.canvasDocuments.records.get(opened.documentId).unseen, 0);

  persisted.unseen = Number.MAX_SAFE_INTEGER + 1;
  const oversized = harness({ records, activeId: "oversized-visible-document" });
  await oversized.canvasDocumentsReady();
  assert.equal(oversized.canvasDocuments.records.get(opened.documentId).unseen, 0);
});

test("new unbound sessions create canvases even when the visible Canvas is empty and reconnect to their binding", async () => {
  const h = harness(), visibleId = h.canvasDocumentsCurrent().id;
  const keylessArgs = { sessionId: "keyless", client: "Codex", title: "Keyless", slotIndex: 0, takeover: false };
  const keyless = await h.canvasDocumentsExecute("mcp_start_session", keylessArgs, {});
  assert.notEqual(keyless.documentId, visibleId);
  assert.equal(keyless.active, false);
  assert.equal(h.canvasDocuments.records.size, 2);
  const keylessAgain = await h.canvasDocumentsExecute("mcp_start_session", keylessArgs, {});
  assert.equal(keylessAgain.documentId, keyless.documentId, "repeating a keyless session must retain its live session Canvas");
  assert.equal(h.canvasDocuments.records.size, 2, "repeating a keyless session must not create another Canvas");

  const firstArgs = { sessionId: "first", sessionKey: "key-one", client: "Codex", title: "First", slotIndex: 0, takeover: false };
  const first = await h.canvasDocumentsExecute("mcp_start_session", firstArgs, {});
  assert.notEqual(first.documentId, visibleId);
  assert.equal(first.active, false);
  assert.equal(h.canvasDocuments.activeId, visibleId);
  assert.equal(h.canvasDocuments.records.size, 3);

  const firstAgain = await h.canvasDocumentsExecute("mcp_start_session", firstArgs, {});
  assert.equal(firstAgain.documentId, first.documentId, "repeating a session start must keep its Canvas");
  assert.equal(h.canvasDocuments.records.size, 3, "repeating a session start must not create another Canvas");

  const second = await h.canvasDocumentsExecute("mcp_start_session", { sessionId: "second", sessionKey: "key-two", client: "Codex", title: "Second", slotIndex: 1, takeover: false }, {});
  assert.notEqual(second.documentId, visibleId);
  assert.notEqual(second.documentId, first.documentId);
  assert.equal(second.active, false);
  assert.equal(h.canvasDocuments.records.size, 4);

  const secondReconnect = await h.canvasDocumentsExecute("mcp_start_session", { sessionId: "second-reconnect", sessionKey: "key-two", client: "Codex", title: "Second again", slotIndex: 2, takeover: false }, {});
  const firstReconnect = await h.canvasDocumentsExecute("mcp_start_session", { sessionId: "first-reconnect", sessionKey: "key-one", client: "Codex", title: "First again", slotIndex: 3, takeover: false }, {});
  assert.equal(secondReconnect.documentId, second.documentId);
  assert.equal(firstReconnect.documentId, first.documentId);
  assert.equal(h.canvasDocuments.records.size, 4, "reconnecting bound sessions must not create another Canvas");

  const explicit = await createHidden(h, "explicit-session-document", "Explicit");
  const explicitStart = await h.canvasDocumentsExecute("mcp_start_session", { sessionId: "explicit", documentId: explicit.documentId, client: "Codex", title: "Explicit start", slotIndex: 0, takeover: false }, {});
  assert.equal(explicitStart.documentId, explicit.documentId, "an explicit documentId must reuse the requested Canvas");
  assert.equal(h.canvasDocuments.records.size, 5);
});

test("Save as creates independent identity while retaining source and separating conversation bindings", async () => {
  const h = harness(), original = h.canvasDocumentsCurrent(), originalId = original.id;
  h.state.widgets.push({ id: "widget-5", title: "Source", widgetType: "html_widget", pluginId: "general", html: "<p>retained source</p>", x: 100, y: 100, w: 640, h: 400, contentW: 640, contentH: 400 });
  await h.canvasDocumentsExecute("mcp_start_session", { sessionId: "original-session", documentId: originalId, sessionKey: "original-key", client: "Codex", title: "Original", slotIndex: 0, takeover: false }, {});
  assert.equal(original.bindings[0].key, "original-key");

  const bundleExtensions = h.canvasDocumentsSaveMetadata({ copy: true }), copiedId = bundleExtensions.penechoDocument.documentId;
  assert.notEqual(copiedId, originalId);
  assert.equal(bundleExtensions.penechoDocument.bindings.length, 0);
  const item = {
    version: 2, name: "Independent copy", theme: "light", view: { scale: 1, panX: 0, panY: 0, navigationLocked: false },
    widgets: h.state.widgets.map(widget => ({ ...widget })), textBoxes: [], images: [], animations: [],
    bundleExtensions, manifestExtensions: {}, preservedAssets: [],
  };
  await h.canvasDocumentsDidSave(item, "device", "saved-copy", []);

  const copied = h.canvasDocuments.records.get(copiedId), parkedOriginal = h.canvasDocuments.records.get(originalId);
  assert.equal(h.canvasDocuments.activeId, copiedId);
  assert.equal(copied.locator.location, "device");
  assert.equal(copied.locator.id, "saved-copy");
  assert.equal(h.state.widgets.find(widget => widget.id === "widget-5").html, "<p>retained source</p>");
  assert.equal(parkedOriginal.stored.item.widgets.find(widget => widget.id === "widget-5").html, "<p>retained source</p>");
  assert.equal(parkedOriginal.bindings[0].key, "original-key");
  assert.equal(copied.bindings.length, 0);

  await h.canvasDocumentsExecute("mcp_start_session", { sessionId: "copy-session", documentId: copiedId, sessionKey: "copy-key", client: "Codex", title: "Copy", slotIndex: 1, takeover: false }, {});
  assert.equal(copied.bindings[0].key, "copy-key");
  assert.equal(parkedOriginal.bindings.some(binding => binding.key === "copy-key"), false);
  assert.equal(h.state.currentSnapshotBundleExtensions.penechoDocument.documentId, copiedId);
});

test("open distinguishes an exact locator from ambiguous IDs and unavailable storage", async () => {
  const metadata = documentId => ({ penechoDocument: { version: 1, documentId, title: documentId, bindings: [], locators: [], processor: { kind: "penecho" } } });
  const snapshots = [
    { id: "copy-a", name: "A", bundleExtensions: metadata("shared-document") },
    { id: "copy-b", name: "B", bundleExtensions: metadata("shared-document") },
  ];
  const saved = new Map([["device:copy-a", { item: { name: "A", widgets: [], textBoxes: [], images: [], animations: [], bundleExtensions: metadata("shared-document") }, tileEntries: [] }]]);
  const h = harness({ snapshots, saved });
  await assert.rejects(
    h.canvasDocumentsExecute("mcp_open_canvas", { instanceId: "instance", canvasId: "bridge", documentId: "shared-document", requestId: "ambiguous", show: false }, {}),
    error => error.code === "DOCUMENT_AMBIGUOUS" && error.details.status === "ambiguous" && error.details.candidates.length === 2,
  );
  const exact = await h.canvasDocumentsExecute("mcp_open_canvas", { instanceId: "instance", canvasId: "bridge", documentId: "shared-document", locator: { location: "device", id: "copy-a" }, requestId: "exact", show: false }, {});
  assert.equal(exact.documentId, "shared-document");
  assert.equal(exact.locator.id, "copy-a");

  const unavailable = h.canvasDocumentIdentity.resolveCandidates({ documentId: "missing", candidates: [], providers: [{ location: "cloud", status: "offline", retryable: true }] });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.retryable, true);
});

test("legacy and identified saved copies keep independent content across visible switches", async () => {
  const identifiedId = "identified-document";
  const extension = { penechoDocument: { version: 1, documentId: identifiedId, title: "Identified", bindings: [], locators: [], processor: { kind: "penecho" } } };
  const stored = (name, html, bundleExtensions = {}) => ({
    item: {
      version: 2, name, theme: "light", view: { scale: 1, panX: 0, panY: 0, navigationLocked: false },
      widgets: [{ id: "widget-1", title: name, widgetType: "html_widget", pluginId: "general", html, x: 100, y: 100, w: 640, h: 400, contentW: 640, contentH: 400 }],
      textBoxes: [], images: [], animations: [], bundleExtensions, manifestExtensions: {}, preservedAssets: [],
    },
    tileEntries: [],
  });
  const saved = new Map([
    ["device:legacy-copy", stored("Legacy", "<p>legacy content</p>")],
    ["device:identified-copy", stored("Identified", "<p>identified content</p>", extension)],
  ]);
  const h = harness({ saved });
  const legacy = await h.canvasDocumentsExecute("mcp_open_canvas", { instanceId: "instance", canvasId: "bridge", locator: { location: "device", id: "legacy-copy" }, requestId: "open-legacy", show: false }, {});
  const identified = await h.canvasDocumentsExecute("mcp_open_canvas", { instanceId: "instance", canvasId: "bridge", documentId: identifiedId, locator: { location: "device", id: "identified-copy" }, requestId: "open-identified", show: false }, {});
  assert.match(legacy.documentId, /^legacy-[0-9a-f]{64}$/);
  assert.equal(identified.documentId, identifiedId);

  await h.canvasDocumentsExecute("mcp_open_canvas", { instanceId: "instance", canvasId: "bridge", documentId: legacy.documentId, requestId: "show-legacy", show: true }, {});
  assert.equal(h.state.widgets[0].html, "<p>legacy content</p>");
  h.state.widgets[0].html = "<p>legacy edited</p>";
  h.state.userRevision += 1;

  await h.canvasDocumentsExecute("mcp_open_canvas", { instanceId: "instance", canvasId: "bridge", documentId: identifiedId, requestId: "show-identified", show: true }, {});
  assert.equal(h.state.widgets[0].html, "<p>identified content</p>");
  assert.equal(h.canvasDocuments.records.get(legacy.documentId).stored.item.widgets[0].html, "<p>legacy edited</p>");

  await h.canvasDocumentsExecute("mcp_open_canvas", { instanceId: "instance", canvasId: "bridge", documentId: legacy.documentId, requestId: "show-legacy-again", show: true }, {});
  assert.equal(h.state.widgets[0].html, "<p>legacy edited</p>");
  assert.equal(h.canvasDocuments.records.get(identifiedId).stored.item.widgets[0].html, "<p>identified content</p>");
});

test("showing an updated Canvas acknowledges only that document", async () => {
  const h=harness();
  const one=await createHidden(h,"unread-one","One"),two=await createHidden(h,"unread-two","Two");
  await startHidden(h,one.documentId,"unread-session-one");
  await startHidden(h,two.documentId,"unread-session-two");
  await h.canvasDocumentsExecute("mcp_present_widget",{sessionId:"unread-session-one",artifactId:"unread-artifact-one",title:"Unread one",html:"<p>One update</p>"},{});
  await h.canvasDocumentsExecute("mcp_present_widget",{sessionId:"unread-session-two",artifactId:"unread-artifact-two",title:"Unread two",html:"<p>Two update</p>"},{});
  const first=h.canvasDocuments.records.get(one.documentId),second=h.canvasDocuments.records.get(two.documentId);
  assert.ok(first.unseen>0);assert.ok(second.unseen>0);
  await h.context.canvasDocumentsShow(one.documentId);
  assert.equal(first.unseen,0);assert.ok(second.unseen>0);
});


test("closing a Canvas does not block on inbox and revokes its session", async () => {
  const h = harness();
  await h.canvasDocumentsReady();
  const original = h.canvasDocumentsCurrent();
  original.messages.push({id:"pending",status:"queued"});
  h.mcpRuntime.sessions.set("closed-session",{sessionId:"closed-session",documentId:original.id,artifacts:new Map(),steps:[],events:[]});
  assert.equal(await h.canvasDocumentsClose(original.id),true);
  assert.equal(h.canvasDocuments.records.has(original.id),false);
  assert.equal(h.canvasDocuments.records.size,1,"last Canvas is replaced with a usable blank Canvas");
  assert.equal(h.mcpRuntime.sessions.get("closed-session").closed,true);
  await assert.rejects(h.canvasDocumentsExecute("mcp_update_session",{sessionId:"closed-session",summary:"late"},{}),{code:"SESSION_EXPIRED"});
  assert.equal(h.state.widgets.length,0);
});

test("failed close preserves the original Canvas and its session", async () => {
  const h = harness();await h.canvasDocumentsReady();const original=h.canvasDocumentsCurrent();
  h.mcpRuntime.sessions.set("working-session",{sessionId:"working-session",documentId:original.id,artifacts:new Map(),steps:[],events:[]});
  h.control.persistFailures=1;
  await assert.rejects(h.canvasDocumentsClose(original.id),/simulated persistence failure/);
  assert.equal(h.canvasDocuments.activeId,original.id);
  assert.equal(h.canvasDocuments.records.size,1);
  assert.notEqual(h.mcpRuntime.sessions.get("working-session").closed,true);
});


test("session titles name only untitled unsaved documents and survive reconnect", async () => {
  const h=harness();const doc=h.canvasDocumentsCurrent();doc.title="Untitled Canvas";
  h.state.currentSnapshotName="";h.state.currentSnapshotHasExplicitName=false;
  await h.canvasDocumentsExecute("mcp_start_session",{sessionId:"named",documentId:doc.id,sessionKey:"name-key",client:"Codex",title:"  Research   map  ",slotIndex:0},{});
  assert.equal(doc.title,"Research map");assert.equal(h.state.currentCanvasSuggestedName,"Research map");
  await h.canvasDocumentsExecute("mcp_start_session",{sessionId:"renamed",sessionKey:"name-key",client:"Codex",title:"Other title",slotIndex:0},{});
  assert.equal(doc.title,"Research map");
  const saved=await createHidden(h,"saved-name","Untitled Canvas"),savedDoc=h.canvasDocuments.records.get(saved.documentId);
  savedDoc.locator={location:"device",id:"saved"};
  await startHidden(h,saved.documentId,"Must not rename");assert.equal(savedDoc.title,"Untitled Canvas");
  const explicit=await createHidden(h,"explicit-name","My chosen name");
  await startHidden(h,explicit.documentId,"Different name");assert.equal(h.canvasDocuments.records.get(explicit.documentId).title,"My chosen name");
});


test("closing after Save as removes both workspace handles but preserves unrelated documents", async () => {
  const h=harness();await h.canvasDocumentsReady();const original=h.canvasDocumentsCurrent();
  const copy=await createHidden(h,"close-copy","Copy"),copyDoc=h.canvasDocuments.records.get(copy.documentId);
  // A successful Save as makes its new identity active before the close transition.
  h.canvasDocuments.activeId=copyDoc.id;
  await h.canvasDocumentsClose(copyDoc.id,original.id);
  assert.equal(h.canvasDocuments.records.has(copyDoc.id),false);
  assert.equal(h.canvasDocuments.records.has(original.id),false);
  assert.equal(h.canvasDocuments.records.size,1);
});

test("background Widgets survive real record validation, persistence and restore, including older empty copy fields", async () => {
  const records = new Map();
  function realWidgetHarness(options) {
    const h = harness(options);
    Object.assign(h.context, {
      diagramRuntime: () => null, n: (value, min = 0, max = 32768) => Number.isFinite(value) && value >= min && value <= max,
      MAX_WIDGET_HTML_LENGTH: 800000, MAX_WIDGET_CONTENT_DIMENSION: 32768, MAX_WIDGET_COPY_TEXT_LENGTH: 800000,
      MAX_VISIBLE_WIDGETS: 100, PRIVATE_WIDGET_FAVORITE_ID: /^[0-9a-f-]{36}$/i,
      newPrivateWidgetFavoriteId: () => crypto.randomUUID(), clearHandToolbarTargets: () => {},
      activeWidgetRefinement: () => false, clearWidgetRefineCandidate: () => {}, pluginEnabled: () => true,
      mountWidget: () => { h.control.mounts++; },
    });
    vm.runInContext(["widgetRecord", "restoreWidgets"].map(name => clientFunction("canvas-runtime.js", name)).join("\n"), h.context);
    return h;
  }
  const first = realWidgetHarness({ records });
  const opened = await createHidden(first, "real-widget-create", "Background");
  await startHidden(first, opened.documentId, "real-widget-session");
  const created = await first.canvasDocumentsExecute("mcp_present_widget", {sessionId:"real-widget-session",artifactId:"artifact",title:"Content",html:"<p>First</p>"}, {});
  await first.canvasDocumentsExecute("mcp_present_widget", {sessionId:"real-widget-session",artifactId:"artifact",title:"Content",html:"<p>Retained</p>"}, {});
  assert.equal(first.control.mounts, 0);
  const stored = records.get(opened.documentId).stored.item.widgets;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].html, "<p>Retained</p>");
  assert.equal(Object.hasOwn(stored[0], "copyText"), false);
  assert.equal(Object.hasOwn(stored[0], "copyLabel"), false);
  // Older workspace entries contain runtime defaults rather than optional omissions.
  stored[0].copyText = ""; stored[0].copyLabel = "";
  const reloaded = realWidgetHarness({records, activeId:"other-visible"});
  await reloaded.canvasDocumentsReady();
  await reloaded.canvasDocumentsExecute("mcp_open_canvas", {documentId:opened.documentId,requestId:"real-widget-show",show:true}, {});
  assert.equal(reloaded.state.widgets.length, 1);
  assert.equal(reloaded.state.widgets[0].id, created.objectId);
  assert.equal(reloaded.state.widgets[0].html, "<p>Retained</p>");
  assert.equal(reloaded.control.mounts, 1);
});

test("explicit current attaches populated Canvas, preserves title, and stays pinned", async () => {
  const h=harness();
  await h.canvasDocumentsReady();
  const visible=h.canvasDocumentsCurrent();
  visible.title="Untitled Canvas";
  h.state.currentSnapshotName="Untitled Canvas";
  h.state.textBoxes.push({id:"existing-text",text:"Existing work",x:0,y:0,w:100,h:30});
  const args={sessionId:"attached",target:"current",sessionKey:"attach-key",client:"Codex",title:"New title"};
  const result=await h.canvasDocumentsExecute("mcp_start_session",args,{});
  assert.equal(result.documentId,visible.id);
  assert.equal(h.canvasDocuments.records.size,1);
  assert.equal(visible.title,"Untitled Canvas");
  assert.equal(visible.processor.kind,"penecho");
  const live=h.mcpRuntime.sessions.get("attached");
  live.summary="retain progress";
  await h.canvasDocumentsExecute("mcp_start_session",args,{});
  assert.equal(h.mcpRuntime.sessions.get("attached"),live);
  const other=await createHidden(h,"other","Other");
  await h.canvasDocumentsExecute("mcp_open_canvas",{documentId:other.documentId,show:true,requestId:"show-other"},{});
  assert.equal(h.mcpRuntime.sessions.get("attached").documentId,visible.id);
  const read=await h.canvasDocumentsExecute("mcp_read_file",{sessionId:"attached",path:"canvas.json"},{});
  assert.equal(read.documentId,visible.id);
  const textPath="objects/existing-text/content.txt";
  const textRead=await h.canvasDocumentsExecute("mcp_read_file",{sessionId:"attached",path:textPath},{});
  await h.canvasDocumentsExecute("mcp_patch_file",{sessionId:"attached",path:textPath,expectedHash:textRead.contentHash,patch:patchText(textPath,textRead.content,"Updated original work"),requestId:"pinned-edit"},{});
  assert.equal(visible.stored.item.textBoxes[0].text,"Updated original work");
  assert.equal(h.state.textBoxes.length,0);
  await assert.rejects(()=>h.canvasDocumentsExecute("mcp_start_session",{...args,client:"Other"},{}),e=>e.code==="BINDING_CONFLICT");
  await assert.rejects(()=>h.canvasDocumentsExecute("mcp_start_session",args,{}),e=>e.code==="BINDING_CONFLICT");
  await assert.rejects(()=>h.canvasDocumentsExecute("mcp_start_session",{...args,sessionId:"new-id"},{}),e=>e.code==="BINDING_CONFLICT");
  assert.equal(h.canvasDocuments.records.size,2);
});

 test("current attach rejects an in-progress navigation", async()=>{
  const h=harness();await h.canvasDocumentsReady();h.canvasDocuments.switching=true;
  await assert.rejects(()=>h.canvasDocumentsExecute("mcp_start_session",{sessionId:"busy",target:"current",title:"Attach"},{}),e=>e.code==="CANVAS_BUSY");
  assert.equal(h.mcpRuntime.sessions.size,0);
});

test("draw_ink validates before mutation, preserves brush selection, and seals one undo edit", async () => {
  const calls=[],state={userRevision:4,inkColor:"#ff0000",pen:19},doc={revision:4},active={value:true};
  const context=vm.createContext({state,SIZE:20000,canvasDocumentsIsActive:()=>active.value,canvasAgentMutationIdle:()=>{},canvasDocumentsError:(code,message)=>Object.assign(Error(message),{code}),canvasAgentAssertToolExecution:()=>{},save:()=>calls.push("save-before"),stroke:(...args)=>calls.push(args),dot:(...args)=>calls.push(args),canvasDocumentsEndEdit:(target,kind)=>{calls.push(kind);target.revision=++state.userRevision;}});
  vm.runInContext(`async ${clientFunction("canvas-documents.js","canvasDocumentsEdit")};globalThis.edit=canvasDocumentsEdit;`,context);
  const args={action:"draw_ink",baseRevision:4,strokes:[{color:"#123abc",width:8,points:[{x:10,y:10},{x:30,y:30}]}]};
  await assert.rejects(context.edit(doc,{...args,baseRevision:3},{}),{code:"REVISION_CONFLICT"});
  active.value=false;await assert.rejects(context.edit(doc,args,{}),{code:"ACTIVE_CANVAS_REQUIRED"});active.value=true;
  await assert.rejects(context.edit(doc,{...args,strokes:[...args.strokes,{color:"bad",width:2,points:[{x:5,y:5}]}]},{}),{code:"INVALID_INK"});
  assert.equal(calls.length,0);
  const result=await context.edit(doc,args,{});
  assert.equal(result.revision,5);assert.equal(calls[0],"save-before");assert.equal(calls.at(-1),"draw_ink");
  assert.deepEqual(calls[1],[args.strokes[0].points[0],args.strokes[0].points[1],false,8,false,"#123abc"]);
  assert.equal(state.inkColor,"#ff0000");assert.equal(state.pen,19);
});

test("draw_ink canonical raster tiles round trip through real save undo and redo", async () => {
  const state={userRevision:0,historyBefore:new Map(),history:[],future:[],inkBounds:new Map()},tiles=new Map(),doc={revision:0};
  const canvas=()=>({marks:[],getContext(){const owner=this;return {save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){owner.marks.push({color:this.strokeStyle,width:this.lineWidth});}};}});
  const cloneCanvas=value=>{if(!value)return null;const next=canvas();next.marks=structuredClone(value.marks);return next;};
  const context=vm.createContext({state,tiles,SIZE:20000,TILE:512,MAX_HISTORY:50,window:{},key:(x,y)=>`${x},${y}`,cloneCanvas,tile:(x,y,create=true)=>{const key=`${x},${y}`;if(create&&!tiles.has(key))tiles.set(key,canvas());return tiles.get(key);},valid:p=>p.x>=0&&p.y>=0&&p.x<=20000&&p.y<=20000,invalidateSharpOverlays(){},canvasDocumentsIsActive:()=>true,canvasAgentMutationIdle(){},canvasAgentAssertToolExecution(){},canvasDocumentsError:(code,message)=>Object.assign(Error(message),{code}),invalidateRecognition(){},restorePendingHistoryState(){},clearSharpOverlays(){},requestAnimationLayerRender(){},render(){}});
  for(const name of ["recordBefore","unionLocalBounds","extendInkBounds","lineIntersectsRect","stroke","dot","save","applyHistory","undo","redo"])vm.runInContext(clientFunction("persistence.js",name),context);
  vm.runInContext(`function canvasDocumentsEndEdit(doc){state.userRevision++;save();doc.revision=state.userRevision;} async ${clientFunction("canvas-documents.js","canvasDocumentsEdit")}`,context);
  await context.canvasDocumentsEdit(doc,{action:"draw_ink",baseRevision:0,strokes:[{color:"#42b983",width:5,points:[{x:100,y:100},{x:200,y:200}]},{color:"#abc123",width:9,points:[{x:110,y:100}]}]},{});
  assert.equal(state.history.length,1);assert.equal(tiles.get("0,0").marks.length,2);
  context.undo();assert.equal(tiles.size,0);assert.equal(state.future.length,1);
  context.redo();assert.equal(tiles.get("0,0").marks.length,2);assert.equal(tiles.get("0,0").marks[0].color,"#42b983");
});

test("saved Widget front order survives workspace reload and explicit save metadata", async () => {
  const records = new Map(), first = harness({records});
  await first.canvasDocumentsReady();
  const doc = first.canvasDocumentsCurrent();
  first.state.widgets = [{id:"widget-2"},{id:"widget-1"}];
  first.state.frontCanvasObjectKind = "widget";
  first.state.frontPlacedCanvasObjectKind = "text-box";
  first.state.userRevision++;
  const metadata = first.canvasDocumentsSaveMetadata();
  assert.deepEqual({...metadata.penechoObjectOrder},{version:1,frontKind:"widget",placedKind:"text-box"});
  await first.context.canvasDocumentsPark();
  const second = harness({records,activeId:"different-canvas"});
  await second.canvasDocumentsReady();
  await second.canvasDocumentsExecute("mcp_open_canvas",{documentId:doc.id,requestId:"restore-order",show:true},{});
  assert.deepEqual(second.state.widgets.map(w=>w.id),["widget-2","widget-1"]);
  assert.equal(second.state.frontCanvasObjectKind,"widget");
  assert.equal(second.state.frontPlacedCanvasObjectKind,"text-box");
});

test("internal and external Agents use the same current-document source and presentation executor", async () => {
  const internal=harness(),external=harness(),id=`agent-${"a".repeat(64)}`;
  await external.canvasDocumentsExecute("mcp_start_session",{sessionId:id,sessionKey:id,client:"External AI",title:"Test",target:"current"},{});
  const firstCanvas=internal.canvasDocumentsCurrent().id;
  const invoke=(h,builtin,name,args)=>builtin
    ?h.canvasAgentDocumentOperation({operation:name,arguments:{...args,sessionId:id},bindingKey:id},{})
    :h.canvasDocumentsExecute(name,{...args,sessionId:id},{});
  for(const [h,builtin] of [[internal,true],[external,false]]) {
    const created=await invoke(h,builtin,"mcp_present_widget",{artifactId:"page",title:"Page",html:"<main>Page</main>",width:1200,height:800});
    assert.ok(created.objectId);
    const files=await invoke(h,builtin,"mcp_list_files",{});
    const file=files.entries.find(f=>f.objectId===created.objectId&&f.path.endsWith("widget.html"));
    const read=await invoke(h,builtin,"mcp_read_file",{path:file.path});
    assert.equal(read.content,"<main>Page</main>");
    assert.ok(read.contentHash);
    const context=await invoke(h,builtin,"mcp_read_file",{path:"context.md"});
    const args={path:"context.md",expectedHash:context.contentHash,patch:patchText("context.md",context.content,"Shared context"),requestId:"context-write"};
    await invoke(h,builtin,"mcp_patch_file",args);
    const repeated=await invoke(h,builtin,"mcp_patch_file",args);
    assert.equal(repeated.applied,true);
    assert.equal((await invoke(h,builtin,"mcp_read_file",{path:"context.md"})).content,"Shared context");
    await assert.rejects(invoke(h,builtin,"mcp_patch_file",{...args,requestId:"stale-write",patch:patchText("context.md",context.content,"Lost update")}),e=>e.code==="SOURCE_CONFLICT");
    assert.equal(h.state.widgets.length,1);
  }
  assert.deepEqual(internal.state.widgets.map(w=>[w.w,w.h,w.html]),external.state.widgets.map(w=>[w.w,w.h,w.html]));
  assert.deepEqual(internal.state.widgets.map(w=>[w.x,w.y]),[[0,0]],"internal Agent shares viewport-origin placement");
  assert.deepEqual(external.state.widgets.map(w=>[w.x,w.y]),[[0,0]],"external MCP shares viewport-origin placement");
  assert.equal(internal.canvasDocuments.activeId,firstCanvas);
  assert.equal(internal.canvasDocuments.records.size,1,"binding internal Agent must not create a document");
  assert.equal(internal.canvasDocumentsExternal(),false,"binding internal Agent must not opt into an external processor");
});

test("internal document binding rejects cross-document routing and lifecycle operations", async () => {
  const h=harness(),id=`agent-${"b".repeat(64)}`;
  const input={operation:"mcp_read_file",arguments:{sessionId:id,path:"canvas.json"},bindingKey:id};
  await h.canvasAgentDocumentOperation(input,{});
  const original=h.canvasDocumentsCurrent().id;
  await assert.rejects(h.canvasAgentDocumentOperation({...input,operation:"mcp_open_canvas"},{}),e=>e.code==="UNSUPPORTED_OPERATION");
  await assert.rejects(h.canvasAgentDocumentOperation({...input,arguments:{...input.arguments,sessionId:"other"}},{}),e=>e.code==="BINDING_CONFLICT");
  h.mcpRuntime.sessions.get(id).documentId="different-document";
  await assert.rejects(h.canvasAgentDocumentOperation(input,{}),e=>e.code==="BINDING_CONFLICT");
  assert.equal(h.canvasDocuments.activeId,original);
});

test("shared document tools preserve retired plugin content without allowing source replacement", async () => {
  for (const builtin of [false,true]) for (const widget of [
    {widgetType:"diagram_source",pluginId:"flowchart",source:"graph TD; A-->B"},
    {widgetType:"html_widget",pluginId:"private-plugin",html:"<main>Saved private content</main>"},
  ]) {
    const h=harness(),id=`agent-${"c".repeat(64)}`;
    await h.canvasDocumentsReady();
    h.state.widgets.push({id:"saved",x:10,y:20,w:500,h:400,...widget});
    if(!builtin)await h.canvasDocumentsExecute("mcp_start_session",{sessionId:id,client:"External AI",target:"current",title:"Test"},{});
    const run=(operation,args={})=>builtin?h.canvasAgentDocumentOperation({operation,arguments:{sessionId:id,...args},bindingKey:id},{}):h.canvasDocumentsExecute(operation,{sessionId:id,...args},{});
    const files=await run("mcp_list_files");
    const source=files.entries.find(entry=>entry.objectId==="saved"&&entry.path.endsWith(widget.widgetType==="diagram_source"?"widget.source":"widget.html"));
    assert.equal(source.writable,false);
    const current=await run("mcp_read_file",{path:source.path});
    assert.equal(current.content,widget.source||widget.html);
    await assert.rejects(run("mcp_patch_file",{path:source.path,patch:patchText(source.path,current.content,"Changed"),expectedHash:current.contentHash,requestId:"retired-edit"}),{code:"READ_ONLY_FILE"});
    h.mcpRuntime.sessions.get(id).artifacts.set("saved-artifact",{objectId:"saved"});
    await assert.rejects(run("mcp_present_widget",{artifactId:"saved-artifact",title:"Overwrite",html:"<p>Replacement</p>"}),{code:"READ_ONLY_FILE"});
    assert.equal(h.state.widgets[0].source||h.state.widgets[0].html,widget.source||widget.html);
  }
});

test("internal conversations do not consume external binding slots and retain bounded reconnect identities", async () => {
  const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();
  doc.bindings=Array.from({length:64},(_,i)=>({key:`external-${i}`,client:"External AI",documentId:doc.id}));
  const before=JSON.stringify(doc.bindings);
  let id;
  for(let i=0;i<70;i++){
    id=`agent-${i.toString(16).padStart(64,"0")}`;
    await h.canvasAgentDocumentOperation({operation:"mcp_read_file",arguments:{sessionId:id,path:"canvas.json"},bindingKey:id},{});
  }
  assert.equal(JSON.stringify(doc.bindings),before);
  assert.equal([...h.mcpRuntime.sessions.values()].filter(s=>s.internalAgent).length,64);
  const created=await h.canvasAgentDocumentOperation({operation:"mcp_present_widget",arguments:{sessionId:id,artifactId:"retained",title:"Retained",html:"<p>Same artifact</p>"},bindingKey:id},{});
  const metadata=h.canvasDocumentsSaveMetadata(),workspace=Object.values(metadata).find(v=>v?.internalSessions);
  assert.equal(workspace.internalSessions.length,64);
  const restored=h.canvasDocumentIdentity.normalizeWorkspace(workspace,{version:1,documentId:doc.id,bindings:doc.bindings});
  doc.internalSessions=restored.internalSessions;
  h.mcpRuntime.sessions.clear();
  h.context.widgetEditContext=widget=>({...widget});
  h.context.canvasAgentReplaceWidget=async ({objectId,command})=>{Object.assign(h.state.widgets.find(w=>w.id===objectId),command);return {revision:++h.state.userRevision};};
  const replay=await h.canvasAgentDocumentOperation({operation:"mcp_present_widget",arguments:{sessionId:id,artifactId:"retained",title:"Retained",html:"<p>Updated same artifact</p>"},bindingKey:id},{});
  assert.equal(replay.objectId,created.objectId);assert.equal(h.state.widgets.length,1);
  assert.equal(h.mcpRuntime.sessions.get(id).internalAgent,true);
});

test("the real document executor places Widgets beside and below an anchor, and explicit moves preserve content", async () => {
  const h=harness();
  h.context.mcpReadingWorldRect=()=>({x:1000,y:1000,w:1400,h:900});
  await h.canvasDocumentsReady();
  await h.canvasDocumentsExecute("mcp_start_session",{sessionId:"placement-session",sessionKey:"placement-key",client:"Codex",target:"current",title:"Placement"},{});
  const present=(artifactId,html,presentation,width,height)=>h.canvasDocumentsExecute("mcp_present_widget",{
    sessionId:"placement-session",artifactId,title:artifactId,html,presentation,width,height,
  },{});
  const object=id=>h.state.widgets.find(widget=>widget.id===id);

  const anchorResult=await present("anchor","<p>Anchor</p>",undefined,360,220),anchor=object(anchorResult.objectId);
  assert.deepEqual({x:anchor.x,y:anchor.y,w:anchor.w,h:anchor.h,contentW:anchor.contentW,contentH:anchor.contentH},{
    x:anchor.x,y:anchor.y,w:360,h:220,contentW:360,contentH:220,
  });
  assert.equal(anchorResult.viewport.width,360);
  assert.equal(anchorResult.viewport.height,220);

  const rightResult=await present("right","<p>Right</p>",{intent:"compare",role:"supporting",relativeTo:"anchor",relation:"beside"},300,200),right=object(rightResult.objectId);
  assert.equal(right.x,anchor.x+anchor.w+32,"beside placement uses the clear right side of the anchor");
  assert.equal(right.y,anchor.y);
  assert.equal(rightResult.viewport.width,300);
  assert.equal(rightResult.viewport.height,200);

  const belowResult=await present("below","<p>Below</p>",{intent:"explain",role:"supporting",relativeTo:"anchor",relation:"below"},300,200),below=object(belowResult.objectId);
  assert.equal(below.x,anchor.x,"below placement keeps the anchor's x coordinate");
  assert.equal(below.y,anchor.y+anchor.h+32);
  assert.equal(belowResult.viewport.width,300);
  assert.equal(belowResult.viewport.height,200);

  // presentation has no explicit x/y fields. Use the existing move action to
  // put the already-created right artifact on the anchor's left side.
  const before=await h.canvasDocumentsExecute("mcp_read_file",{sessionId:"placement-session",path:`objects/${right.id}/widget.html`},{});
  const canvas=await h.canvasDocumentsExecute("mcp_read_file",{sessionId:"placement-session",path:"canvas.json"},{});
  const leftRegion={x:anchor.x-right.w-32,y:anchor.y,w:right.w,h:right.h};
  assert.ok(leftRegion.x>=48,"the explicit left placement stays inside the Canvas bounds");
  const moved=await h.canvasDocumentsExecute("mcp_edit_canvas",{
    sessionId:"placement-session",action:"move",objectId:right.id,region:leftRegion,baseRevision:canvas.revision,requestId:"move-right-artifact-left",
  },{});
  assert.equal(moved.applied,true);
  assert.deepEqual({x:right.x,y:right.y,w:right.w,h:right.h},leftRegion);
  assert.equal(right.html,"<p>Right</p>");
  assert.equal((await h.canvasDocumentsExecute("mcp_read_file",{sessionId:"placement-session",path:`objects/${right.id}/widget.html`},{})).content,before.content);
  assert.equal((await h.canvasDocumentsExecute("mcp_read_file",{sessionId:"placement-session",path:`objects/${right.id}/widget.html`},{})).contentHash,before.contentHash);
});

test("an internal document operation rejects an active Canvas epoch replacement without touching the replacement document", async () => {
  const h=harness();
  await h.canvasDocumentsReady();
  const original=h.canvasDocumentsCurrent(),replacement=await createHidden(h,"epoch-replacement","Replacement"),replacementDoc=h.canvasDocuments.records.get(replacement.documentId),originalEpoch=h.canvasDocuments.epoch;
  const id=`agent-${"d".repeat(64)}`;
  const input={operation:"mcp_present_widget",bindingKey:id,arguments:{sessionId:id,artifactId:"race-artifact",title:"Race",html:"<p>Race</p>",width:300,height:200}};
  const pending=h.canvasAgentDocumentOperation(input,{});

  // The executor captures the current document and epoch before its readiness
  // await. A replacement during that window must fail before session/artifact
  // creation can be routed into the new active document.
  h.canvasDocuments.activeId=replacement.documentId;
  h.canvasDocuments.epoch=originalEpoch+1;
  await assert.rejects(pending,error=>error.code==="CANVAS_BUSY");

  assert.equal(h.canvasDocuments.activeId,replacement.documentId);
  assert.equal(h.canvasDocuments.records.get(original.id).revision,original.revision);
  assert.equal(h.canvasDocuments.records.get(replacement.documentId).revision,replacementDoc.revision);
  assert.equal(h.mcpRuntime.sessions.has(id),false,"the rejected operation must not create an internal session");
  assert.equal(h.canvasDocuments.records.get(replacement.documentId).stored.item.widgets.length,0,"the replacement document must remain untouched");
  assert.equal(h.state.widgets.length,0,"the original visible state must remain untouched");
});

test("HTML patches retain canonical copy source above the independent source limit", async () => {
  const h=harness();
  const core=fs.readFileSync(path.join(ROOT,"src/client/app/core.js"),"utf8");
  for(const name of ["MAX_WIDGET_HTML_LENGTH","MAX_WIDGET_COPY_TEXT_LENGTH","MAX_WIDGET_CONTENT_DIMENSION"])
    h.context[name]=Number(core.match(new RegExp(`${name} = (\\d+)`))[1]);
  Object.assign(h.context,{diagramRuntime:()=>null,n:(v,min=0,max=32768)=>Number.isFinite(v)&&v>=min&&v<=max,
    PRIVATE_WIDGET_FAVORITE_ID:/^[0-9a-f-]{36}$/i,newPrivateWidgetFavoriteId:()=>crypto.randomUUID()});
  vm.runInContext(["widgetRecord","normalizedWidgetSource","widgetSourceMirrorsHtml","widgetUsesHtmlCopySource","widgetCopySource"].map(name=>clientFunction("canvas-runtime.js",name)).join("\n"),h.context);
  const opened=await createHidden(h,"large-html","Large HTML");
  await startHidden(h,opened.documentId,"large-html-session");
  const html=`<p>${"a".repeat(17000)}</p>`;
  const shown=await h.canvasDocumentsExecute("mcp_present_widget",{sessionId:"large-html-session",artifactId:"large",title:"Large",html},{});
  const doc=h.canvasDocuments.records.get(opened.documentId),item=doc.stored.item.widgets.find(w=>w.id===shown.objectId);
  const geometry=JSON.stringify([item.x,item.y,item.w,item.h,item.contentW,item.contentH]);
  const file=`objects/${item.id}/widget.html`;
  async function patch(content,id) {
    const read=await h.canvasDocumentsExecute("mcp_read_file",{sessionId:"large-html-session",path:file},{});
    const result=await h.canvasDocumentsExecute("mcp_patch_file",{sessionId:"large-html-session",path:file,expectedHash:read.contentHash,patch:patchText(file,read.content,content),requestId:id},{});
    assert.equal(result.contentHash,await h.context.canvasAgentHash(content));
    assert.equal(JSON.stringify([item.x,item.y,item.w,item.h,item.contentW,item.contentH]),geometry);
    return read.contentHash;
  }
  const next=html.replace("<p>","<p lang=\"en\">");
  const oldHash=await patch(next,"large-first");
  assert.equal(h.context.widgetCopySource(item),next);
  assert.equal(item.copyText,undefined);
  await assert.rejects(h.canvasDocumentsExecute("mcp_patch_file",{sessionId:"large-html-session",path:file,expectedHash:oldHash,patch:patchText(file,next,html),requestId:"large-stale"},{}),{code:"SOURCE_CONFLICT"});
  item.copyText=next; // Legacy HTML mirrors must also be cleared on merge.
  await patch(html,"large-legacy");
  assert.equal(item.copyText,undefined);
  assert.equal(h.context.widgetCopySource(item),html);
  item.copyText="Independent source";item.copyLabel="Copy original";
  await patch(next,"large-distinct");
  assert.equal(h.context.widgetCopySource(item),"Independent source");
  assert.equal(item.copyLabel,"Copy original");
  assert.equal(h.context.widgetRecord({...item,copyText:"x".repeat(16001)}),null);
  assert.ok(h.context.widgetRecord({...item,copyText:"x".repeat(16000)}));
});

test("closed conversation Canvas restores the same document and artifacts after browser restart", async()=>{
  const records=new Map(),first=harness({records});
  const opened=await createHidden(first,"recover-closed","Original");
  await startHidden(first,opened.documentId,"before-close","conversation-recovery");
  const widget=await first.canvasDocumentsExecute("mcp_present_widget",{sessionId:"before-close",artifactId:"retained-widget",title:"Retained",html:"<p>Original content</p>"},{});
  await first.canvasDocumentsExecute("mcp_open_canvas",{documentId:opened.documentId,show:true,requestId:"show-before-close"},{});
  await first.canvasDocumentsClose(opened.documentId);
  assert.equal(records.get(opened.documentId).closed,true);
  assert.equal(first.canvasDocuments.records.has(opened.documentId),false);
  const second=harness({records,activeId:"new-visible"});await second.canvasDocumentsReady();
  assert.equal(second.canvasDocuments.records.has(opened.documentId),false,"closed canvases stay closed at boot");
  const result=await startHidden(second,opened.documentId,"after-close","conversation-recovery");
  assert.equal(result.documentId,opened.documentId);
  assert.equal(result.recovery.restored,true);
  assert.equal(result.reused,true);
  assert.equal(second.mcpRuntime.sessions.get("after-close").artifacts.get("retained-widget").objectId,widget.objectId);
  assert.equal(second.canvasDocuments.records.get(opened.documentId).stored.item.widgets[0].html,"<p>Original content</p>");
  assert.equal(second.canvasDocuments.activeId,"new-visible","background restore preserves the user's current Canvas");
  assert.equal(records.get(opened.documentId).closed,false);
});

test("session restore creates a replacement only for definitive missing documents",async()=>{
  const h=harness();await h.canvasDocumentsReady();
  const result=await startHidden(h,"missing-document","replacement","stable-key");
  assert.notEqual(result.documentId,"missing-document");
  assert.equal(result.recovery.reason,"DOCUMENT_NOT_FOUND");
  const repeated=await startHidden(h,"missing-document","replacement-retry","stable-key");
  assert.equal(repeated.documentId,result.documentId,"lost recovery response does not create duplicates");
  await assert.rejects(h.canvasDocumentsExecute("mcp_start_session",{documentId:"another-missing",sessionId:"strict",sessionKey:"strict",title:"Strict",client:"Codex",restore:false},{}),{code:"DOCUMENT_NOT_FOUND"});
  for(const code of ["STORAGE_UNAVAILABLE","DOCUMENT_AMBIGUOUS","DOCUMENT_CONFLICT"]){
    const blocked=harness();await blocked.canvasDocumentsReady();
    blocked.context.canvasDocumentsOpen=async()=>{throw Object.assign(Error(code),{code});};
    const count=blocked.canvasDocuments.records.size;
    await assert.rejects(startHidden(blocked,"unavailable-document","blocked",code),{code});
    assert.equal(blocked.canvasDocuments.records.size,count);
  }
});

test("server idle disposal releases browser session memory while retaining conversation artifacts",async()=>{
  const h=harness(),opened=await createHidden(h,"idle-document","Idle recovery");
  await startHidden(h,opened.documentId,"idle-before","idle-key");
  const widget=await h.canvasDocumentsExecute("mcp_present_widget",{sessionId:"idle-before",artifactId:"idle-artifact",title:"Keep",html:"<p>Keep through idle</p>"},{});
  h.context.mcpDisposeSession("idle-before");
  assert.equal(h.mcpRuntime.sessions.has("idle-before"),false);
  const resumed=await startHidden(h,opened.documentId,"idle-after","idle-key");
  assert.equal(resumed.reused,true);
  assert.equal(h.mcpRuntime.sessions.get("idle-after").artifacts.get("idle-artifact").objectId,widget.objectId);
  assert.notEqual(resumed.progress.status,"done","garbage collection must not declare the task complete");
});


test("workspace reload restores more than 32 documents and respects the 64-document capacity", async () => {
  const first = harness();
  const ids=[];
  for(let index=0;index<40;index++)ids.push((await createHidden(first, `restore-capacity-${index}`, `Restore ${index}`)).documentId);
  const second=harness({records:first.records});
  await second.canvasDocumentsReady();
  assert.equal(second.canvasDocuments.records.size,41);
  for(const id of ids)assert.ok(second.canvasDocuments.records.has(id));
  const template=first.records.get(ids[0]),records=new Map();
  for(let index=0;index<80;index++){
    const id=`restore-${index}`;
    records.set(id,{...structuredClone(template),id,metadata:{...structuredClone(template.metadata),documentId:id}});
  }
  records.set('closed',{...structuredClone(template),id:'closed',closed:true,metadata:{...structuredClone(template.metadata),documentId:'closed'}});
  records.set('visible-document',{...structuredClone(template),id:'visible-document',metadata:{...structuredClone(template.metadata),documentId:'visible-document'}});
  const bounded=harness({records});
  const visible=bounded.canvasDocumentsCurrent();
  await bounded.canvasDocumentsReady();
  assert.equal(bounded.canvasDocuments.records.size,64);
  assert.equal(bounded.canvasDocuments.records.get('visible-document'),visible);
  assert.equal(bounded.canvasDocuments.records.has('closed'),false);
  assert.equal(bounded.canvasDocuments.records.has('restore-16'),false);
  for(let index=17;index<80;index++)assert.ok(bounded.canvasDocuments.records.has(`restore-${index}`));
  bounded.canvasDocuments.ready=null;
  await bounded.canvasDocumentsReady();
  assert.equal(bounded.canvasDocuments.records.size,64);
});


test("MCP automatic text uses the active viewport and queues reveal; explicit and hidden placement stay scoped", async () => {
  const h = harness();
  await h.canvasDocumentsReady();
  const doc = h.canvasDocumentsCurrent(), session = {sessionId:"text-placement", artifacts:new Map()};
  h.mcpRuntime.sessions.set(session.sessionId,session);
  const queued=[];
  h.context.mcpQueueView=(owner,record)=>queued.push({sessionId:owner.sessionId,id:record.id});
  h.context.canvasAgentFramePlan=()=>({stage:{x:0,y:0,w:1200,h:800}});h.state.scale=1;h.state.panX=24-8200;h.state.panY=48-6400;
  const result=await h.context.canvasDocumentsEdit(doc,{action:"create_text",sessionId:session.sessionId,text:"Visible text"},{});
  assert.equal(h.state.textBoxes[0].x,8200);
  assert.equal(h.state.textBoxes[0].y,6400);
  assert.equal(queued[0].id,result.objectId);
  await h.context.canvasDocumentsEdit(doc,{action:"create_text",sessionId:session.sessionId,text:"Annotation",region:{x:400,y:500,w:400,h:48}},{});
  assert.equal(h.state.textBoxes[1].x,400);
  assert.equal(h.state.textBoxes[1].y,500);
  assert.equal(queued.length,1);
  const hidden=await createHidden(h,"hidden-text-placement","Background");
  await h.context.canvasDocumentsEdit(h.canvasDocuments.records.get(hidden.documentId),{action:"create_text",sessionId:session.sessionId,text:"Background text"},{});
  assert.equal(queued.length,1);
  assert.equal(h.state.textBoxes.length,2);
});

function imageAssetHarness() {
  const h=harness();
  Object.assign(h.context,{n:(v,min=0,max=32768)=>typeof v==="number"&&Number.isFinite(v)&&v>=min&&v<=max,MAX_IMAGE_SOURCE_BYTES:32000000,MAX_IMAGE_DIMENSION:2048,MAX_IMAGE_PIXELS:16*1024*1024,
    dataUrlBlob:source=>{const [prefix,bytes]=source.split(',');return new Blob([Buffer.from(bytes,'base64')],{type:prefix.slice(5).split(';')[0]});},
    canvasAgentReadDataUrl:async blob=>`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`,
    createImageBitmap:async blob=>({width:120,height:60,close(){}}),
    mcpQueueView:()=>{},
  });
  vm.runInContext(clientFunction("canvas-runtime.js","imageRecord"),h.context);
  return h;
}
const assetTestImage='data:image/png;base64,iVBORw0KGgo=';

for (const cryptoMode of ['native','missing-subtle','missing-crypto','rejected-digest']) test(`image attachments deduplicate and persist with ${cryptoMode}`,async()=>{
  const h=imageAssetHarness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();
  if(cryptoMode==='missing-subtle')h.context.crypto={};
  if(cryptoMode==='missing-crypto')h.context.crypto=undefined;
  if(cryptoMode==='rejected-digest')h.context.crypto={subtle:{digest:async()=>{throw Error("unavailable");}}};
  const first=await h.context.canvasDocumentsUploadImage(doc,{name:'sample.png',source:assetTestImage},{});
  assert.equal(first.assetId,require("node:crypto").createHash("sha256").update(Buffer.from(assetTestImage.split(",")[1],"base64")).digest("hex"));
  assert.match(first.source,/^penecho-asset:[a-f0-9]{64}$/);assert.equal(first.width,120);
  assert.equal(h.state.images.length,0);assert.equal(h.state.currentSnapshotPreservedAssets.length,1);
  const revision=h.state.userRevision;
  const second=await h.context.canvasDocumentsUploadImage(doc,{name:'other.png',source:assetTestImage},{});
  assert.equal(second.source,first.source);assert.equal(h.state.userRevision,revision);
  assert.equal(JSON.parse(h.context.canvasDocumentsFile(doc,'assets/index.json')).images[0].source,first.source);
  const hidden=await createHidden(h,'asset-other','Other'),other=h.canvasDocuments.records.get(hidden.documentId);
  assert.throws(()=>h.context.canvasImageAssetsForHtml(`<img src="${first.source}">`,other),/not in this Canvas/);
  await h.context.canvasDocumentsPark();
  const stored=h.records.get(doc.id);assert.equal(stored.stored.item.preservedAssets[0].metadata.resourceId,first.assetId);
  const reopened=h.canvasDocumentsRecord(stored.metadata,structuredClone(stored.stored));
  h.canvasDocuments.activeId=other.id;
  assert.equal(h.context.canvasImageAssetsForHtml(`<img src="${first.source}">`,reopened)[first.source],assetTestImage);
});

test('image placement uses attachment bytes, auto-layout or explicit position and rejects missing sources before mutation',async()=>{
  const h=imageAssetHarness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();
  const asset=await h.context.canvasDocumentsUploadImage(doc,{name:'sample.png',source:assetTestImage},{});
  h.context.canvasAgentFramePlan=()=>({stage:{x:0,y:0,w:1200,h:800}});h.state.scale=1;h.state.panX=24-8200;h.state.panY=48-6400;
  const placed=await h.context.canvasDocumentsPlaceImage(doc,{source:asset.source,width:240},{});
  assert.equal(h.state.images[0].id,placed.objectId);assert.equal(h.state.images[0].x,8200);assert.equal(h.state.images[0].h,120);
  await h.context.canvasDocumentsPlaceImage(doc,{source:asset.source,height:80,region:{x:400,y:500,w:1,h:1}},{});
  assert.equal(h.state.images[1].x,400);assert.equal(h.state.images[1].w,160);
  const revision=h.state.userRevision;
  await assert.rejects(h.context.canvasDocumentsPlaceImage(doc,{source:asset.source,width:80},{}),/at least 80/);
  await assert.rejects(h.context.canvasDocumentsPlaceImage(doc,{source:'penecho-asset:'+'f'.repeat(64)},{}),/not in this Canvas/);
  assert.equal(h.state.images.length,2);assert.equal(h.state.userRevision,revision);
  await assert.rejects(h.context.canvasDocumentsUploadImage(doc,{source:'file:///tmp/image.png'},{}),/Data URL/);
});

test('switching to a background Canvas installs attachments before Widget hydration',async()=>{
  const h=imageAssetHarness();await h.canvasDocumentsReady();
  const hidden=await createHidden(h,'restore-image-widget','Image document'),doc=h.canvasDocuments.records.get(hidden.documentId);
  const asset=await h.context.canvasDocumentsUploadImage(doc,{name:'sample.png',source:assetTestImage},{});
  doc.stored.item.widgets.push({id:'widget-1',html:`<img src="${asset.source}">`});
  let resolved;
  const restore=h.context.restoreWidgets;
  h.context.restoreWidgets=items=>{resolved=h.context.canvasImageAssetsForHtml(items[0].html);restore(items);};
  await h.context.canvasDocumentsShow(doc.id);
  assert.equal(resolved[asset.source],assetTestImage);
});

test('image import rechecks active editing after asynchronous decode before changing the Canvas',async()=>{
  for(const operation of ['canvasDocumentsUploadImage','canvasDocumentsPlaceImage']) {
    const h=imageAssetHarness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();let busy=false,closed=0;
    h.context.canvasAgentMutationIdle=()=>{if(busy)throw Error('CANVAS_BUSY');};
    h.context.createImageBitmap=async()=>{busy=true;return {width:120,height:60,close(){closed++;}};};
    const revision=h.state.userRevision;
    await assert.rejects(h.context[operation](doc,{name:'sample.png',source:assetTestImage},{}),/CANVAS_BUSY/);
    assert.equal(h.state.userRevision,revision);assert.equal(h.state.images.length,0);assert.equal(h.state.currentSnapshotPreservedAssets.length,0);assert.equal(closed,1);
  }
});

test('routed image upload retries reuse the document receipt without retaining Base64 copies',async()=>{
  const h=imageAssetHarness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();
  await startHidden(h,doc.id,'asset-session');
  const args={sessionId:'asset-session',requestId:'asset-request',name:'sample.png',source:assetTestImage};
  const first=await h.canvasDocumentsExecute('mcp_upload_image',args,{}),revision=h.state.userRevision;
  const retry=await h.canvasDocumentsExecute('mcp_upload_image',args,{});
  assert.equal(retry.source,first.source);assert.equal(h.state.userRevision,revision);
  assert.equal(first.documentId,doc.id);assert.ok(!doc.receipts.get(args.requestId).signature.includes('base64'));
  await assert.rejects(h.canvasDocumentsExecute('mcp_upload_image',{...args,name:'different.png'},{}),/different content/);
});

test("legacy routing and external takeover keep the composer on PenEcho while Widget choices remain readable", async () => {
  const h = harness();
  const restored = h.canvasDocumentsRecord({ documentId: "legacy", processor: { kind: "external", bindingKey: "old" } });
  assert.equal(restored.processor.kind, "penecho");
  await h.canvasDocumentsReady();
  const doc = h.canvasDocumentsCurrent();
  await h.canvasDocumentsExecute("mcp_start_session", { sessionId: "choice-owner", sessionKey: "choice-key", client: "Codex", target: "current", takeover: true }, {});
  assert.equal(doc.processor.kind, "penecho");
  assert.equal(h.canvasDocumentsExternal(), false);
  const widget = { id: "choice-widget", x: 10, y: 20, w: 200, h: 100 };
  h.mcpRuntime.sessions.get("choice-owner").artifacts.set("choice-artifact", { objectId: widget.id });
  h.context.choiceWidget = widget;
  vm.runInContext('canvasDocumentsWidgetAction(choiceWidget, {text:"Use option B", action:"choice"})', h.context);
  const inbox = await h.canvasDocumentsExecute("mcp_inbox", { sessionId: "choice-owner", after: 0 }, {});
  assert.equal(inbox.messages.messages.length, 1);
  assert.equal(inbox.messages.messages[0].text, "Use option B");
  assert.equal(inbox.messages.messages[0].source, "widget");
  assert.equal(doc.processor.kind, "penecho");
});

test("compound completion acknowledges only owned messages after the committed mutation and retries exactly once",async()=>{
  const h=harness(),opened=await createHidden(h,"compound-doc","Compound");await startHidden(h,opened.documentId,"compound","compound-key","Test");
  const doc=h.canvasDocuments.records.get(opened.documentId);doc.messageSequence=1;doc.messages.push({id:"owned",cursor:1,bindingKey:"compound-key",client:"Test",text:"Make it",status:"queued"});
  const args={sessionId:"compound",artifactId:"compound-artifact",requestId:"compound-write",title:"Compound",html:"<p>Done</p>",completion:{status:"done",summary:"Finished",handledMessageIds:["owned"]}};
  const result=await h.canvasDocumentsExecute("mcp_present_widget",args,{});assert.equal(result.applied,true);assert.equal(result.completion.status,"done");assert.equal(doc.messages[0].status,"done");const rev=doc.revision;
  assert.equal((await h.canvasDocumentsExecute("mcp_present_widget",args,{})).objectId,result.objectId);assert.equal(doc.revision,rev);assert.equal(doc.stored.item.widgets.length,1);
  await assert.rejects(h.canvasDocumentsExecute("mcp_present_widget",{...args,requestId:"wrong-message",html:"<p>Bad</p>",completion:{status:"done",handledMessageIds:["not-owned"]}},{}),{code:"MESSAGE_NOT_FOUND"});assert.equal(doc.stored.item.widgets[0].html,"<p>Done</p>");
});
test("failed required capture retains one applied artifact without completing or acknowledging",async()=>{
  const h=harness(),opened=await createHidden(h,"capture-doc","Capture");await startHidden(h,opened.documentId,"capture-session");
  const args={sessionId:"capture-session",artifactId:"capture-artifact",requestId:"capture-write",title:"Capture",html:"<p>Retained</p>",capture:true,completion:{status:"done"}};
  const result=await h.canvasDocumentsExecute("mcp_present_widget",args,{}),doc=h.canvasDocuments.records.get(opened.documentId);
  assert.equal(result.applied,true);assert.equal(result.pixelVerified,false);assert.equal(result.captureFailure.code,"CANVAS_NOT_VISIBLE");assert.equal(result.completion,undefined);assert.notEqual(h.mcpRuntime.sessions.get("capture-session").status,"done");
  const retry=await h.canvasDocumentsExecute("mcp_present_widget",args,{});assert.equal(retry.objectId,result.objectId);assert.equal(doc.stored.item.widgets.length,1);
});
test("same stable binding retries an artifact receipt after its transport session changes",async()=>{
 const h=harness(),opened=await createHidden(h,"restore-receipt","Restore");await startHidden(h,opened.documentId,"old-id","stable-key","Test");
 const args={artifactId:"stable",requestId:"stable-request",title:"Stable",html:"<p>Once</p>",completion:{status:"done"}};
 const original=await h.canvasDocumentsExecute("mcp_present_widget",{...args,sessionId:"old-id"},{});
 await startHidden(h,opened.documentId,"new-id","stable-key","Test");
 const result=await h.canvasDocumentsExecute("mcp_present_widget",{...args,sessionId:"new-id"},{});
 assert.equal(result.objectId,original.objectId);assert.equal(h.canvasDocuments.records.get(opened.documentId).stored.item.widgets.length,1);
 await startHidden(h,opened.documentId,"other-id","other-key","Test");
 await assert.rejects(h.canvasDocumentsExecute("mcp_present_widget",{...args,sessionId:"other-id"},{}),{code:"REQUEST_ID_CONFLICT"});
});
test("routed source patch permits a selected Widget after user geometry edits but still rejects changed source",async()=>{
 const h=harness();await h.canvasDocumentsReady();await h.canvasDocumentsExecute("mcp_start_session",{sessionId:"geometry-source",sessionKey:"geometry-key",client:"Test",target:"current",title:"Geometry"},{});
 const created=await h.canvasDocumentsExecute("mcp_present_widget",{sessionId:"geometry-source",artifactId:"geometry",requestId:"geometry-create",title:"Geometry",html:"<p>Before</p>"},{});
 const file=created.sourcePath,read=await h.canvasDocumentsExecute("mcp_read_file",{sessionId:"geometry-source",path:file},{}),widget=h.state.widgets[0];
 Object.assign(widget,{x:600,y:900,w:920,h:620,contentW:460,contentH:310});h.state.widgetEdit={id:widget.id,changed:true};h.state.userRevision+=2;
 h.context.canvasAgentMutationIdle=()=>{throw Error("generic geometry gate must not block source-only commits");};
 h.context.widgetEditContext=w=>({...w});h.context.canvasAgentWidgetSourceState=w=>({html:w.html});
 let usedSourceLock=false;h.context.canvasAgentReplaceWidget=async args=>{assert.ok(args.expectedSourceHash);assert.equal(args.baseRevision,undefined);usedSourceLock=true;widget.html=args.command.html;return {revision:++h.state.userRevision};};
 const args={sessionId:"geometry-source",path:file,expectedHash:read.contentHash,patch:patchText(file,read.content,"<p>After</p>"),requestId:"after-geometry"};
 const result=await h.canvasDocumentsExecute("mcp_patch_file",args,{});assert.equal(result.applied,true);assert.equal(result.objectId,widget.id);assert.equal(usedSourceLock,true);
 assert.deepEqual([widget.x,widget.y,widget.w,widget.h,widget.contentW,widget.contentH],[600,900,920,620,460,310]);assert.equal(widget.html,"<p>After</p>");
 await assert.rejects(h.canvasDocumentsExecute("mcp_patch_file",{...args,requestId:"stale-source"},{}),{code:"SOURCE_CONFLICT"});
});

test("background geometry patches preserve Widget content and image raster mapping at scale 2", async()=>{
 const h=harness();await h.canvasDocumentsReady();
 const opened=await createHidden(h,"geometry-mapping","Geometry mapping");
 const sessionId="geometry-mapping-session";await startHidden(h,opened.documentId,sessionId);
 const doc=h.canvasDocuments.records.get(opened.documentId);h.state.scale=2;
 doc.stored.item.view={scale:2,panX:17,panY:29,readingStage:{x:0,y:0,w:1000,h:1600},region:{x:0,y:0,w:500,h:800}};
 const widget={id:"geometry-widget",title:"Geometry Widget",widgetType:"html_widget",pluginId:"general",sourceFormat:"penecho-mcp+html",html:"<p>Widget</p>",x:100,y:100,w:240,h:110,contentW:480,contentH:220};
 const image={id:"geometry-image",sourceName:"fixture",x:600,y:100,w:40,h:40,naturalW:80,naturalH:80};
 doc.stored.item.widgets.push(widget);doc.stored.item.images.push(image);doc.spatial=null;
 const patchGeometry=async(pathName,next,requestId)=>{
  const read=await h.canvasDocumentsExecute("mcp_read_file",{sessionId,path:pathName},{});
  return h.canvasDocumentsExecute("mcp_patch_file",{sessionId,path:pathName,expectedHash:read.contentHash,patch:patchText(pathName,read.content,JSON.stringify(next)),requestId},{});
 };
 const widgetPath="objects/geometry-widget/geometry.json",imagePath="objects/geometry-image/geometry.json";
 const movedWidget=await patchGeometry(widgetPath,{x:1000,y:1200,w:240,h:110},"move-widget");
 assert.equal(movedWidget.applied,true);assert.equal(movedWidget.objectId,widget.id);
 assert.deepEqual([widget.x,widget.y,widget.w,widget.h],[1000,1200,240,110]);
 assert.deepEqual([widget.w*2,widget.h*2,widget.contentW,widget.contentH],[480,220,480,220]);
 const movedImage=await patchGeometry(imagePath,{x:1600,y:1400,w:40,h:40},"move-image");
 assert.equal(movedImage.applied,true);assert.equal(movedImage.objectId,image.id);
 assert.deepEqual([image.x,image.y,image.w,image.h],[1600,1400,40,40]);
 assert.deepEqual([image.w*2,image.h*2,image.naturalW,image.naturalH],[80,80,80,80]);
 await assert.rejects(patchGeometry(widgetPath,{x:1000,y:1200,w:149,h:110},"shrink-widget"),error=>error.code==="INVALID_GEOMETRY"&&/supported content minimum/.test(error.message));
 assert.deepEqual([widget.x,widget.y,widget.w,widget.h,widget.contentW,widget.contentH],[1000,1200,240,110,480,220]);
});

test("background text content patches preserve the existing world to raster ratio", async()=>{
 const h=harness();await h.canvasDocumentsReady();
 const opened=await createHidden(h,"text-ratio","Text ratio");
 const sessionId="text-ratio-session";await startHidden(h,opened.documentId,sessionId);
 const doc=h.canvasDocuments.records.get(opened.documentId);h.state.scale=2;
 doc.stored.item.view={scale:2,panX:0,panY:0,readingStage:{x:0,y:0,w:1000,h:1600},region:{x:0,y:0,w:500,h:800}};
 const text={id:"text-ratio-object",text:"before",x:100,y:200,w:240,h:48,fontSize:20,maxWidth:240};doc.stored.item.textBoxes.push(text);doc.spatial=null;
 const rasterByText={before:{w:120,h:24},after:{w:180,h:36}};
 h.context.renderedTextBoxRecord=async value=>{const raster=rasterByText[value.text];if(!raster)return null;return {id:value.id||"text-ratio-object",text:value.text,fontSize:value.fontSize,maxWidth:value.maxWidth,x:value.x||0,y:value.y||0,w:raster.w,h:raster.h};};
 const pathName="objects/text-ratio-object/content.txt",read=await h.canvasDocumentsExecute("mcp_read_file",{sessionId,path:pathName},{});
 const originalRaster=await h.context.renderedTextBoxRecord(text),originalRatio={w:text.w/originalRaster.w,h:text.h/originalRaster.h};
 const result=await h.canvasDocumentsExecute("mcp_patch_file",{sessionId,path:pathName,expectedHash:read.contentHash,patch:patchText(pathName,read.content,"after"),requestId:"text-ratio-patch"},{});
 assert.equal(result.applied,true);assert.equal(result.objectId,text.id);
 const nextRaster=rasterByText.after;
 assert.equal(text.text,"after");assert.deepEqual([text.x,text.y,text.w,text.h],[100,200,360,72]);
 assert.equal(text.w/nextRaster.w,originalRatio.w);assert.equal(text.h/nextRaster.h,originalRatio.h);
});


test("background native labels store text foreground without changing the current Canvas",async()=>{
 const h=harness();
 vm.runInContext(clientFunction("mcp-primitives.js","mcpPrimitiveLayout"),h.context);
 h.context.mcpPrimitiveRaster=()=>({width:280,height:120});
 const started=await h.canvasDocumentsExecute("mcp_start_session",{sessionId:"labels",sessionKey:"labels",client:"test",title:"Labels"},{});
 const doc=h.canvasDocuments.records.get(started.documentId);
 h.state.frontCanvasObjectKind=h.state.frontPlacedCanvasObjectKind="image";
 const args={sessionId:"labels",artifactId:"hello",title:"Hello",items:[
  {id:"box",type:"rect",x:200,y:200,width:280,height:120,fill:"#ffffff"},
  {id:"label",type:"text",x:200,y:230,width:100,text:"Hello"}]};
 await h.canvasDocumentsExecute("mcp_draw",args,{});
 assert.equal(h.state.frontPlacedCanvasObjectKind,"image");
 assert.deepEqual({...doc.stored.item.bundleExtensions.penechoObjectOrder},{version:1,frontKind:"text-box",placedKind:"text-box"});
 doc.stored.item.bundleExtensions.penechoObjectOrder={version:1,frontKind:"image",placedKind:"image"};
 await h.canvasDocumentsExecute("mcp_draw",args,{});
 assert.equal(doc.stored.item.bundleExtensions.penechoObjectOrder.placedKind,"image");
});

test('MCP text and background native content retain screen dimensions and camera across zoom and reopen',async()=>{
 for(const zoom of [.1,.5,1,2]){
  const h=harness();await h.canvasDocumentsReady();
  Object.assign(h.state,{scale:zoom,panX:-1000*zoom,panY:-1000*zoom});
  h.context.canvasAgentFramePlan=()=>({stage:{x:0,y:0,w:1000,h:900}});
  const visible=h.canvasDocumentsCurrent(),before=[h.state.scale,h.state.panX,h.state.panY];
  const text=await h.context.canvasDocumentsEdit(visible,{action:'create_text',text:'当前缩放保持清晰'},{});
  const record=h.state.textBoxes.find(t=>t.id===text.objectId);
  assert.equal(record.w*zoom,400);assert.equal(record.h*zoom,48);
  assert.equal((record.x*zoom)+h.state.panX,24);assert.equal((record.y*zoom)+h.state.panY,48);
  const hidden=await createHidden(h,`viewport-native-${zoom}`,'Background native');
  await startHidden(h,hidden.documentId,`native-${zoom}`,`native-key-${zoom}`);
  const primitiveSource=fs.readFileSync(path.join(ROOT,'src/client/app/mcp-primitives.js'),'utf8');
  vm.runInContext(primitiveSource,h.context);
  h.context.mcpPrimitiveRaster=item=>({width:item.box.w,height:item.box.h});
  h.context.canvasBlob=async()=>new Blob(['test-raster']);h.context.decodeStoredImage=async item=>({...item,image:{width:item.naturalW,height:item.naturalH}});
  const args={sessionId:`native-${zoom}`,artifactId:'native',title:'原生图文',items:[{id:'box',type:'rect',width:300,height:100},{id:'label',type:'text',text:'原生中文标签',width:260}]};
  const made=await h.canvasDocumentsExecute('mcp_draw',args,{}),doc=h.canvasDocuments.records.get(hidden.documentId);
  const artifact=h.mcpRuntime.sessions.get(`native-${zoom}`).artifacts.get('native');
  assert.equal(artifact.worldPerPixel,2);
  assert.equal(doc.stored.item.images[0].w*0.5,300);
  assert.equal(doc.stored.item.textBoxes[0].fontSize,20);
  assert.deepEqual([h.state.scale,h.state.panX,h.state.panY],before,'background preparation does not change the active camera');
  const textFrame=JSON.parse(JSON.stringify(doc.stored.item.textBoxes[0]));
  await h.context.canvasDocumentsShow(hidden.documentId);
  assert.deepEqual([h.state.scale,h.state.panX,h.state.panY],[0.5,-1000,-1000],'new MCP Canvas opens at 50% with world origin (2000, 2000)');
  assert.equal(h.state.textBoxes[0].w,textFrame.w);assert.equal(h.state.textBoxes[0].h,textFrame.h);
  const persisted=h.context.canvasDocumentIdentity.normalizeWorkspace(h.context.canvasDocumentsWorkspaceData(doc),h.context.canvasDocumentsMetadata(doc));
  assert.equal(persisted.sessions[0].artifacts[0][1].worldPerPixel,2);
 }
});

test('raw image upload targets the current document without a conversation and preserves legacy uploads',async()=>{
  const h=imageAssetHarness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();
  const args={documentId:doc.id,requestId:'raw-1',name:'sample.png',originalName:'sample.tiff',inputSha256:'a'.repeat(64),source:assetTestImage};
  const first=await h.canvasDocumentsExecute('mcp_upload_image_to_document',args,{}),revision=h.state.userRevision;
  assert.equal(first.documentId,doc.id);assert.match(first.source,/^penecho-asset:/);assert.equal(h.mcpRuntime.sessions.size,0);
  assert.equal((await h.canvasDocumentsExecute('mcp_upload_image_to_document',args,{})).source,first.source);
  assert.equal(h.state.userRevision,revision);
  await assert.rejects(h.canvasDocumentsExecute('mcp_upload_image_to_document',{...args,inputSha256:'b'.repeat(64)},{}),/different content/);
  const hidden=await createHidden(h,'raw-hidden','Hidden');
  await assert.rejects(h.canvasDocumentsExecute('mcp_upload_image_to_document',{...args,documentId:hidden.documentId},{}),/open and current/);
  await assert.rejects(h.canvasDocumentsExecute('mcp_upload_image_to_document',{...args,documentId:'missing'},{}),/open and current/);
  const legacy=await h.context.canvasDocumentsUploadImage(doc,{name:'legacy.png',source:assetTestImage},{});
  assert.equal(legacy.source,first.source);
  assert.equal(JSON.parse(h.context.canvasDocumentsFile(doc,'assets/index.json')).images[0].source,first.source);
});

test('raw upload refuses an active-document switch during decoding before saving bytes',async()=>{
  const h=imageAssetHarness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();
  const hidden=await createHidden(h,'raw-switch','Other');let closed=0;
  h.context.createImageBitmap=async()=>{h.canvasDocuments.activeId=hidden.documentId;return {width:120,height:60,close(){closed++;}};};
  await assert.rejects(h.canvasDocumentsExecute('mcp_upload_image_to_document',{documentId:doc.id,requestId:'raw-switch',name:'a.png',originalName:'a.png',inputSha256:'a'.repeat(64),source:assetTestImage},{}),/no longer/);
  assert.equal(closed,1);assert.equal(doc.receipts.size,0);assert.equal(h.state.currentSnapshotPreservedAssets?.length||0,0);
});

function cancellableMcp(h) {
  const socket={readyState:1};h.mcpRuntime.socket=socket;h.mcpRuntime.generation=1;
  h.context.canvasAgentAssertToolExecution=execution=>{if(execution?.kind==='mcp'&&!h.context.mcpExecutionCurrent(execution))throw Object.assign(Error('cancelled'),{code:'REQUEST_CANCELLED'});};
  return {kind:'mcp',socket,generation:1,controller:new AbortController()};
}
const nextTask=()=>new Promise(resolve=>setImmediate(resolve));
test('cancelled session readiness cannot register a late session or durable binding',async()=>{
  const h=harness();await h.canvasDocumentsReady();const execution=cancellableMcp(h);let resume;
  h.context.canvasDocumentsReady=()=>new Promise(resolve=>{resume=resolve;});
  const pending=h.canvasDocumentsExecute('mcp_start_session',{sessionId:'cancelled',sessionKey:'cancelled-key',target:'current',client:'Codex'},execution);
  const rejected=assert.rejects(pending,{code:'REQUEST_CANCELLED'});await nextTask();execution.controller.abort();await rejected;
  resume();await nextTask();assert.equal(h.mcpRuntime.sessions.size,0);assert.equal(h.canvasDocumentsCurrent().bindings.length,0);
});
test('cancelled document hash cannot add a late canvas or persist its identity',async()=>{
  const h=harness();await h.canvasDocumentsReady();const execution=cancellableMcp(h);let resume;
  h.context.canvasAgentHash=()=>new Promise(resolve=>{resume=resolve;});
  const before=h.canvasDocuments.records.size,writes=h.control.persistWrites;
  const pending=h.canvasDocumentsExecute('mcp_open_canvas',{create:true,requestId:'late',title:'Late'},execution);
  const rejected=assert.rejects(pending,{code:'REQUEST_CANCELLED'});await nextTask();execution.controller.abort();await rejected;
  resume('late');await nextTask();assert.equal(h.canvasDocuments.records.size,before);assert.equal(h.control.persistWrites,writes);
});
test('cancelled MCP text preparation releases switch ownership and never swaps visible state',async()=>{
  const h=harness();await h.canvasDocumentsReady();const opened=await createHidden(h,'target','Target'),execution=cancellableMcp(h);let resume;
  const before={id:h.canvasDocuments.activeId,title:h.state.currentSnapshotName,text:h.state.textBoxes};
  h.context.mcpPrepareTextBoxes=()=>new Promise(resolve=>{resume=resolve;});h.context.releaseTextRaster=()=>{};
  const pending=h.context.canvasDocumentsShow(opened.documentId,execution),rejected=assert.rejects(pending,{code:'REQUEST_CANCELLED'});
  await nextTask();assert.equal(h.canvasDocuments.switching,true);execution.controller.abort();await rejected;
  assert.equal(h.canvasDocuments.switching,false);assert.equal(h.canvasDocuments.activeId,before.id);
  resume([]);await nextTask();assert.equal(h.state.currentSnapshotName,before.title);assert.equal(h.state.textBoxes,before.text);
  const next=cancellableMcp(h);await h.canvasDocumentsExecute('mcp_start_session',{sessionId:'next',sessionKey:'next',target:'current',client:'Codex'},next);
  assert.equal(h.mcpRuntime.sessions.has('next'),true);
});
test('duplicate in-flight mutation receipts execute once and retain a successful result',async()=>{
  const h=harness();let calls=0,resume;const store=new Map();const work=()=>{calls++;return new Promise(resolve=>{resume=resolve;});};
  const first=h.context.canvasDocumentsOnce(store,'same',{value:1},work),second=h.context.canvasDocumentsOnce(store,'same',{value:1},work);
  await nextTask();assert.equal(calls,1);resume({applied:true});assert.deepEqual(await first,await second);
});

const renameArgs=(documentId,title,requestId='rename-test')=>({instanceId:'instance',canvasId:'bridge',documentId,title,requestId});
test('MCP rename updates active metadata and catalog without saving content, moving view or resetting Agent',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();
 h.state.currentCanvasSuggestedName='Suggestion';h.state.drawing=true;h.state.history.push({stroke:1});
 h.context.canvasAgent.running=true;const before=JSON.stringify({revision:h.state.userRevision,history:h.state.history,scale:h.state.scale,panX:h.state.panX,panY:h.state.panY});
 h.context.finalizeCanvasForSnapshot=()=>{throw Error('rename must not finalize drawing');};
 h.context.canvasAgentCanvasDidPersist=()=>{throw Error('rename must not reset Agent');};
 const result=await h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'  Release plan  '),cancellableMcp(h));
 assert.equal(result.title,'Release plan');assert.equal(result.active,true);assert.equal(result.applied,true);assert.equal(result.saved,false);
 assert.equal(h.state.currentSnapshotName,'Release plan');assert.equal(h.state.currentCanvasSuggestedName,'');assert.equal(h.state.currentSnapshotHasExplicitName,true);
 assert.equal(JSON.stringify({revision:h.state.userRevision,history:h.state.history,scale:h.state.scale,panX:h.state.panX,panY:h.state.panY}),before);
 assert.equal(h.mcpRuntime.sessions.size,0);assert.equal(h.records.get(doc.id).metadata.title,'Release plan');
 assert.equal(h.context.canvasDocumentsCatalog().find(d=>d.documentId===doc.id).title,'Release plan');assert.equal(h.control.frames,0);
});
test('MCP rename persists hidden document metadata and retains bindings, objects and active canvas',async()=>{
 const h=harness();const hidden=await createHidden(h,'hidden-rename','Before');await startHidden(h,hidden.documentId,'bound');
 const doc=h.canvasDocuments.records.get(hidden.documentId);doc.stored.item.widgets.push({id:'existing',html:'<b>keep</b>'});
 const active=h.canvasDocuments.activeId,bindings=JSON.stringify(doc.bindings),revision=doc.revision;
 await h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'后台画布'),cancellableMcp(h));
 assert.equal(h.canvasDocuments.activeId,active);assert.equal(h.state.currentSnapshotName,'Visible');assert.equal(doc.title,'后台画布');assert.equal(doc.revision,revision);assert.equal(JSON.stringify(doc.bindings),bindings);
 assert.equal(doc.stored.item.name,'后台画布');assert.equal(doc.stored.item.widgets[0].html,'<b>keep</b>');
 const second=harness({records:h.records});await second.canvasDocumentsReady();assert.equal(second.canvasDocuments.records.get(doc.id).title,'后台画布');
});
test('MCP rename idempotency cannot overwrite a later rename and conflicts on different arguments',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent(),first=renameArgs(doc.id,'First');
 await h.canvasDocumentsExecute('mcp_rename_canvas',first,cancellableMcp(h));
 await h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Second','rename-second'),cancellableMcp(h));const writes=h.control.persistWrites;
 assert.equal((await h.canvasDocumentsExecute('mcp_rename_canvas',first,cancellableMcp(h))).title,'First');assert.equal(doc.title,'Second');assert.equal(h.control.persistWrites,writes);
 await assert.rejects(h.canvasDocumentsExecute('mcp_rename_canvas',{...first,title:'Wrong'},cancellableMcp(h)),{code:'REQUEST_ID_CONFLICT'});
});
test('MCP rename rejects invalid titles and missing documents without creating one',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();
 for(const title of ['', '   ', 'x'.repeat(49), 'bad\nname', 42])await assert.rejects(h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,title,String(title)),cancellableMcp(h)),{code:'INVALID_ARGUMENTS'});
 const size=h.canvasDocuments.records.size;await assert.rejects(h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs('absent','Valid','missing-rename'),cancellableMcp(h)),{code:'DOCUMENT_NOT_FOUND'});
 assert.equal(h.canvasDocuments.records.size,size);assert.equal(doc.title,'Visible');
});
for(const location of ['server','cloud'])test(`MCP rename updates ${location} saved name via metadata PATCH without a full save`,async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();doc.locator={location,id:'saved/id'};let request;
 h.context.fetch=async(url,options)=>{request={url,options};return {ok:true,json:async()=>({ok:true})};};h.context.snapshotApiResponse=response=>response.json();
 const result=await h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Saved name'),cancellableMcp(h));
 assert.equal(result.saved,true);assert.equal(request.url,`${location==='cloud'?'/api/cloud/canvases/':'/api/canvases/'}saved%2Fid`);assert.equal(request.options.method,'PATCH');assert.deepEqual(JSON.parse(request.options.body),{name:'Saved name'});
 assert.equal(request.options.signal.aborted,false);assert.equal(doc.title,'Saved name');
});
test('MCP device rename retains saved bytes and identity',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();doc.locator={location:'device',id:'saved'};
 const saved=new Map([['saved',{id:'saved',name:'Before',widgets:[{id:'w',html:'keep'}],bundleExtensions:{penechoDocument:{documentId:doc.id}},createdAt:4}]]);
 h.context.snapshotDb=async()=>memoryDb(saved,{persistFailures:0,persistWrites:0});h.context.SNAPSHOT_STORE='snapshots';
 const result=await h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'After'),cancellableMcp(h));
 assert.equal(result.saved,true);assert.equal(saved.get('saved').name,'After');assert.equal(saved.get('saved').widgets[0].html,'keep');assert.equal(saved.get('saved').bundleExtensions.penechoDocument.documentId,doc.id);assert.equal(saved.get('saved').createdAt,4);
});
test('MCP rename storage failure leaves the visible name and catalog unchanged',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();h.control.persistFailures=1;
 await assert.rejects(h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Fail'),cancellableMcp(h)),/simulated persistence failure/);
 assert.equal(doc.title,'Visible');assert.equal(h.state.currentSnapshotName,'Visible');
 await h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Retry','retry'),cancellableMcp(h));assert.equal(doc.title,'Retry');
});
test('MCP rename reports partial saved-name success if workspace persistence fails',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();doc.locator={location:'cloud',id:'saved'};
 h.context.fetch=async()=>({ok:true});h.context.snapshotApiResponse=async()=>({});h.control.persistFailures=1;
 await assert.rejects(h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Remote name'),cancellableMcp(h)),e=>e.details.savedNameUpdated===true);
 assert.equal(doc.title,'Visible');
});
test('cancelled rename readiness cannot update the name after the old operation resumes',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent(),execution=cancellableMcp(h);let resume;
 h.context.canvasDocumentsReady=()=>new Promise(resolve=>{resume=resolve;});
 const pending=h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Late'),execution),rejected=assert.rejects(pending,{code:'REQUEST_CANCELLED'});
 await nextTask();execution.controller.abort();await rejected;resume();await nextTask();assert.equal(doc.title,'Visible');assert.equal(h.control.persistWrites,0);
});
test('cancelled MCP rename releases waiting but retains and fences an uncooperative fetch',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();doc.locator={location:'cloud',id:'saved'};const execution=cancellableMcp(h);let resume,signal,bodies=0;
 h.context.fetch=(_url,options)=>{signal=options.signal;return new Promise(resolve=>{resume=resolve;});};h.context.snapshotApiResponse=async()=>{bodies++;};
 const pending=h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Late'),execution),rejected=assert.rejects(pending,{code:'REQUEST_CANCELLED'});
 await nextTask();execution.controller.abort();await rejected;assert.equal(signal.aborted,true);assert.equal(doc.title,'Visible');assert.ok(h.canvasDocuments.pendingPreparations.size>0);
 resume({ok:true});await nextTask();assert.equal(doc.title,'Visible');assert.equal(bodies,0);assert.equal(h.canvasDocuments.pendingPreparations.size,0);
});
test('MCP rename bounds response-body stalls and the next rename remains usable',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();doc.locator={location:'cloud',id:'saved'};let resume;
 h.context.setTimeout=(fn,ms)=>setTimeout(fn,ms===10000?20:ms);h.context.fetch=async()=>({ok:true});h.context.snapshotApiResponse=()=>new Promise(resolve=>{resume=resolve;});
 await assert.rejects(h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Timeout'),cancellableMcp(h)),{code:'STORAGE_TIMEOUT'});
 resume();await nextTask();assert.equal(doc.title,'Visible');h.context.snapshotApiResponse=async()=>({});
 await h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Recovered','recovered'),cancellableMcp(h));assert.equal(doc.title,'Recovered');
});
test('MCP rename does not overwrite a newer manual name after an asynchronous saved-name update',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent();doc.locator={location:'cloud',id:'saved'};let resume;
 h.context.fetch=()=>new Promise(resolve=>{resume=resolve;});h.context.snapshotApiResponse=async()=>({});
 const pending=h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Old request'),cancellableMcp(h));
 await nextTask();doc.title='Manual name';h.state.currentSnapshotName='Manual name';resume({ok:true});
 await assert.rejects(pending,e=>e.code==='CANVAS_CHANGED'&&e.details.savedNameUpdated===true);assert.equal(doc.title,'Manual name');
});


test('MCP saved metadata rename remains authoritative after exact locator reopen',async()=>{
 const h=harness();const opened=await createHidden(h,'rename-reopen','Before'),doc=h.canvasDocuments.records.get(opened.documentId);
 doc.locator={location:'device',id:'saved'};
 const saved=new Map([['saved',{id:'saved',name:'Before',widgets:[],images:[],textBoxes:[],animations:[],bundleExtensions:{penechoDocument:{version:1,documentId:doc.id,title:'Before'}}}]]);
 h.context.snapshotDb=async()=>memoryDb(saved,{persistFailures:0,persistWrites:0});h.context.SNAPSHOT_STORE='snapshots';
 h.context.readSnapshot=async(_location,id)=>({item:saved.get(id),tileEntries:[]});
 await h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'After'),cancellableMcp(h));
 h.canvasDocuments.records.delete(doc.id);
 const reopened=await h.canvasDocumentsExecute('mcp_open_canvas',{documentId:doc.id,locator:doc.locator,requestId:'reopen-renamed',show:false},cancellableMcp(h));
 assert.equal(reopened.documentId,doc.id);assert.equal(reopened.title,'After');assert.equal(saved.get('saved').bundleExtensions.penechoDocument.title,'Before','renaming does not rewrite saved content');
});
test('MCP rename checks durable-write validity after database wait and preserves newer manual metadata',async()=>{
 const h=harness();await h.canvasDocumentsReady();const doc=h.canvasDocumentsCurrent(),db=h.canvasDocuments.db;let calls=0,resume;
 h.context.canvasDocumentsDb=async()=>{if(calls++===0)await new Promise(resolve=>{resume=resolve;});return db;};
 const pending=h.canvasDocumentsExecute('mcp_rename_canvas',renameArgs(doc.id,'Stale MCP'),cancellableMcp(h));
 await nextTask();doc.title='Manual newer';h.state.currentSnapshotName='Manual newer';
 await h.context.canvasDocumentsPersist(doc);resume();await assert.rejects(pending,{code:'CANVAS_CHANGED'});
 assert.equal(doc.title,'Manual newer');assert.equal(h.records.get(doc.id).metadata.title,'Manual newer');
});

test("active external output remains unseen through automatic show and receipt replay", async () => {
  const h=harness(),opened=await createHidden(h,"active-unseen","Active unread");
  await startHidden(h,opened.documentId,"active-unseen-session");
  await h.context.canvasDocumentsShow(opened.documentId,null,{markSeen:false});
  const args={sessionId:"active-unseen-session",artifactId:"active-new-output",title:"New output",html:"<p>Updated</p>",requestId:"active-output-receipt"};
  await h.canvasDocumentsExecute("mcp_present_widget",args,{});
  const doc=h.canvasDocuments.records.get(opened.documentId);
  assert.ok(doc.unseen>0);
  const unseen=doc.unseen;
  await h.context.canvasDocumentsShow(opened.documentId,null,{markSeen:false});
  assert.equal(doc.unseen,unseen);
  await h.context.canvasDocumentsShow(opened.documentId);
  assert.equal(doc.unseen,0);
  await h.canvasDocumentsExecute("mcp_present_widget",args,{});
  assert.equal(doc.unseen,0,"replaying an acknowledged receipt is not new content");
});

test("saved time survives parking and reload and changes only on save", async () => {
  const records=new Map(),h=harness({records});
  await h.canvasDocumentsReady();
  const doc=h.canvasDocumentsCurrent();
  const item={id:"saved-time",name:"Saved time",updatedAt:123456,createdAt:100000,widgets:[],images:[],textBoxes:[],bundleExtensions:h.canvasDocumentsSaveMetadata()};
  await h.canvasDocumentsDidSave(item,"device","saved-time");
  assert.equal(doc.savedAt,123456);
  h.context.canvasDocumentsChanged(doc,"source","changed-object");
  const hidden=await createHidden(h,"time-other","Other");
  await h.context.canvasDocumentsShow(hidden.documentId,null,{markSeen:false});
  assert.equal(doc.savedAt,123456);
  assert.equal(records.get(doc.id).savedAt,123456);
  const reloaded=harness({records,activeId:"time-reload"});
  await reloaded.canvasDocumentsReady();
  assert.equal(reloaded.canvasDocuments.records.get(doc.id).savedAt,123456);
  await h.context.canvasDocumentsShow(doc.id);
  await h.canvasDocumentsDidSave({...item,updatedAt:234567},"device","saved-time");
  assert.equal(doc.savedAt,234567);
  const copy={...item,updatedAt:345678,bundleExtensions:h.canvasDocumentsSaveMetadata({copy:true})};
  await h.canvasDocumentsDidSave(copy,"device","saved-time-copy");
  assert.equal(doc.savedAt,234567,"saving a copy leaves the original save time unchanged");
  assert.equal(h.canvasDocumentsCurrent().savedAt,345678);
});

test("catalog uses creation or save time descending without selection priority", async () => {
  const h=harness();await h.canvasDocumentsReady();
  const initial=h.canvasDocumentsCurrent();
  const one=await createHidden(h,"stable-one","First draft"),two=await createHidden(h,"stable-two","Second draft");
  const ids=()=>Array.from(h.context.canvasDocumentsCatalog(),entry=>entry.documentId);
  const first=h.canvasDocuments.records.get(one.documentId),second=h.canvasDocuments.records.get(two.documentId);
  assert.ok(initial.firstSeenAt<first.firstSeenAt&&first.firstSeenAt<second.firstSeenAt);
  const original=ids();
  assert.deepEqual(original,[second.id,first.id,initial.id]);
  await h.context.canvasDocumentsShow(two.documentId);
  assert.deepEqual(ids(),original);
  assert.equal(h.context.canvasDocumentsCatalog().find(entry=>entry.documentId===two.documentId).active,true);
  const save=(doc,updatedAt)=>h.canvasDocumentsDidSave({name:doc.title,updatedAt,bundleExtensions:h.canvasDocumentsSaveMetadata(),widgets:[],images:[],textBoxes:[]},"device",doc.id);
  await save(second,second.firstSeenAt+1000);
  assert.deepEqual(ids(),[second.id,first.id,initial.id]);
  await h.context.canvasDocumentsShow(first.id);
  assert.deepEqual(ids(),[second.id,first.id,initial.id]);
  await save(first,second.firstSeenAt+2000);
  assert.deepEqual(ids(),[first.id,second.id,initial.id]);
  await h.context.canvasDocumentsShow(second.id);
  assert.deepEqual(ids(),[first.id,second.id,initial.id]);
});

test("draft first appearance survives switching and workspace restoration", async () => {
  const records=new Map(),h=harness({records});await h.canvasDocumentsReady();
  const one=await createHidden(h,"first-seen-one","One"),two=await createHidden(h,"first-seen-two","Two");
  const first=h.canvasDocuments.records.get(one.documentId),second=h.canvasDocuments.records.get(two.documentId),timestamps=[first.firstSeenAt,second.firstSeenAt];
  await h.context.canvasDocumentsShow(second.id);await h.context.canvasDocumentsShow(first.id);
  assert.deepEqual([first.firstSeenAt,second.firstSeenAt],timestamps);
  assert.equal(records.get(first.id).firstSeenAt,timestamps[0]);
  const reloaded=harness({records});await reloaded.canvasDocumentsReady();
  assert.deepEqual([reloaded.canvasDocuments.records.get(first.id).firstSeenAt,reloaded.canvasDocuments.records.get(second.id).firstSeenAt],timestamps);
  const ids=Array.from(reloaded.context.canvasDocumentsCatalog(),entry=>entry.documentId);
  assert.ok(ids.indexOf(second.id)<ids.indexOf(first.id));
});

test("legacy drafts retain observed restore order and saved creation metadata seeds first appearance", async () => {
  const h=harness();
  const meta=id=>({documentId:id,title:id});
  const saved=h.canvasDocumentsRecord(meta("saved"),{item:{createdAt:12345}});
  assert.equal(saved.firstSeenAt,12345);
  for(const id of ["legacy-z","legacy-a"]){const doc=h.canvasDocumentsRecord(meta(id));h.context.canvasDocumentsRestoreFirstSeenAt(doc,{});h.canvasDocuments.records.set(id,doc);}
  assert.deepEqual(Array.from(h.context.canvasDocumentsCatalog(),entry=>entry.documentId),["legacy-a","legacy-z"]);
  h.canvasDocuments.activeId="legacy-a";
  assert.deepEqual(Array.from(h.context.canvasDocumentsCatalog(),entry=>entry.documentId),["legacy-a","legacy-z"]);
});
