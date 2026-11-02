"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

function clientFunction(file, name) {
  const source = read(file), found = source.indexOf(`function ${name}(`);
  assert.notEqual(found, -1, `missing ${name}`);
  const start = source.slice(found - 6, found) === "async " ? found - 6 : found;
  // The body starts after the parameter list, which may hold { defaults }.
  let index = source.indexOf("(", found), depth = 0;
  for (; index < source.length; index++) {
    if (source[index] === "(") depth++;
    else if (source[index] === ")" && --depth === 0) break;
  }
  for (index = source.indexOf("{", index); index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated ${name}`);
}

// A folder page with stand-ins for its open Canvases and the project's server.
function folderPage({ views, docs = [], activeId = "blank", content = false, extra = {}, folder = { name: "app", cloudProjectId: "project-1" } }) {
  const records = new Map(docs.map(doc => [doc.id, { ...doc }])), listeners = {}, requests = [], calls = [], timers = [];
  const saves = [], merges = [], replaced = [], cloud = [], notices = [];
  let started = null;
  const sandbox = {
    window: {
      PENECHO_CONFIG: { browserDraftId: "draft", folderProject: folder },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      dispatchEvent: event => { listeners[event.type]?.(event); return true; },
      PenEchoBrowserDraft: { open: async () => {} },
    },
    document: { hidden: false, addEventListener: () => {} },
    setInterval: () => 1, setTimeout: (fn, delay) => { if (started) timers.push([fn, delay]); else started = fn; return timers.length + 1; }, clearTimeout: () => {},
    state: { currentSnapshotRevisionId: null },
    mcpRuntime: { sessions: new Map() },
    canvasDocuments: { records, activeId },
    canvasDocumentsIsActive: doc => doc.id === context.canvasDocuments.activeId,
    canvasDocumentsCurrent: () => records.get(context.canvasDocuments.activeId),
    canvasDocumentsDraftHasContent: () => content,
    canvasDocumentsDraftBusy: () => false,
    canvasDocumentsOpenSaved: async (locator, { show = false } = {}) => {
      let doc = [...records.values()].find(item => item.locator?.id === locator.id);
      if (!doc) { doc = { id: `doc-${locator.id}`, locator, stored: { item: { currentRevisionId: "rev-1" } } }; records.set(doc.id, doc); calls.push(["open", locator.id]); }
      if (show) { context.canvasDocuments.activeId = doc.id; calls.push(["show", locator.id]); }
      return doc;
    },
    canvasDocumentsForget: async id => {
      if (id === context.canvasDocuments.activeId) return false;
      calls.push(["forget", id]); return records.delete(id);
    },
    canvasDocumentsRefreshSaved: async id => { calls.push(["refresh", id]); return true; },
    companionCanvasesEnabled: () => true,
    companionCanvasesChoose: async id => { context.canvasDocuments.activeId = id; calls.push(["choose", id]); },
    companionCanvasesRequest: async (route, body) => {
      requests.push(body ? [route, body] : [route]);
      const view = views.shift();
      if (view instanceof Error) throw view;
      return view;
    },
    // Saving: the shown Canvas, its merges, and stored copies of tabs behind.
    dirty: false, saveResults: [], remote: null, mergeChanged: false, tiles: new Map(),
    snapshotSaveInProgress: false, snapshotLoadInProgress: false,
    canvasHasUnsavedChanges: () => sandbox.dirty,
    canvasHasShareableContent: () => true,
    canvasDocumentsDraftKey: () => `${sandbox.canvasDocuments.activeId}:${sandbox.state.userRevision}`,
    selectionAIBusy: () => false,
    setHistorySaveBusy: busy => { sandbox.snapshotSaveInProgress = busy; },
    currentCanvasDisplayName: () => "Plan",
    saveSnapshot: async (options, autosave) => {
      saves.push([options, autosave]);
      const result = sandbox.saveResults.shift();
      if (result instanceof Error) throw result;
      sandbox.dirty = false;
      sandbox.state.currentSnapshotRevisionId = result || `rev-saved-${saves.length}`;
      return "saved";
    },
    finalizeCanvasForSnapshot: async () => {},
    readSnapshot: async () => sandbox.remote,
    canvasDocumentsActiveSnapshot: () => ({ name: "Plan", widgets: [] }),
    canvasMergeTileMap: entries => new Map((entries || []).map(entry => [entry.k, entry])),
    canvasMergePixels: async () => null,
    canvasMergeSaves: async args => { merges.push(args); return { item: { ...args.remote.item }, tiles: args.remote.tiles, changed: sandbox.mergeChanged }; },
    canvasMergeStored: async result => ({ item: result.item, tileEntries: [] }),
    canvasDocumentsCopyStored: stored => stored && { item: { ...stored.item }, tileEntries: [...(stored.tileEntries || [])] },
    canvasDocumentsShow: async (id, execution, options = {}) => {
      if (!options.replace) { sandbox.canvasDocuments.activeId = id; return; }
      replaced.push(options);
      sandbox.state.currentSnapshotRevisionId = options.replace.item.currentRevisionId;
      sandbox.state.userRevision++;
      sandbox.dirty = !options.clean;
    },
    cloudResults: [],
    saveCloudSnapshot: async (item, tileEntries, overwriteId, options) => {
      cloud.push([item, overwriteId, options]);
      const result = sandbox.cloudResults.shift();
      if (result instanceof Error) throw result;
      return { id: overwriteId || "new-canvas", revisionId: result || "rev-behind" };
    },
    canvasDocumentsMetadata: doc => ({ documentId: doc.id }), canvasDocumentsWorkspaceData: () => ({}),
    CANVAS_DOCUMENT_EXTENSION: "penechoDocument", CANVAS_WORKSPACE_EXTENSION: "penechoWorkspace",
    canvasDocumentsPersist: async () => {}, canvasDocumentsRender: () => {},
    offscreen: () => ({ getContext: () => ({ fillRect: () => {} }) }), canvasBlob: async () => new Blob(["png"]),
    showHistoryNoticeKey: key => notices.push(key), showHistoryNotice: text => notices.push(text), t: key => key, setStatus: () => {},
    crypto: require("node:crypto").webcrypto, CustomEvent, Blob,
  };
  Object.assign(sandbox, extra, { state: { currentSnapshotRevisionId: null, userRevision: 1, ...extra.state } });
  const context = vm.createContext(sandbox);
  vm.runInContext(read("src/client/app/folder-project.js"), context);
  return { context, records, listeners, requests, calls, timers, saves, merges, replaced, cloud, notices, begin: () => started(), start: async () => { started(); await context.window.PenEchoFolderProject.sync(); } };
}
const tab = (canvasId, revisionId = "rev-1") => ({ canvasId, title: canvasId, updatedAt: 1, revisionId });
const flush = () => new Promise(resolve => setImmediate(resolve));

test("a folder page opens its project's tabs, leaves a blank first Canvas for them and drops tabs closed elsewhere", async () => {
  const page = folderPage({
    views: [{ name: "app", revision: 3, tabs: [tab("plan"), tab("notes")], closed: [tab("old")] }],
    docs: [{ id: "blank", locator: null, stored: { item: {} } }, { id: "doc-old", locator: { location: "cloud", id: "old" }, stored: { item: {} } }],
  });
  await page.start();
  assert.deepEqual(plain(page.requests), [["project"]]);
  assert.deepEqual(plain(page.calls), [["open", "plan"], ["open", "notes"], ["forget", "doc-old"], ["show", "plan"], ["forget", "blank"]]);
  assert.deepEqual([...page.records.keys()], ["doc-plan", "doc-notes"]);
  assert.deepEqual(plain(page.context.window.PenEchoFolderProject.closed()), [tab("old")]);
});

test("a page in use keeps what it shows; a newer save elsewhere refreshes the copy here", async () => {
  const page = folderPage({
    views: [
      { name: "app", revision: 2, tabs: [tab("plan", "rev-2")], closed: [] },
      { name: "app", revision: 1, tabs: [], closed: [tab("plan")] },
    ],
    docs: [{ id: "drawing", locator: null, stored: { item: {} } }, { id: "doc-plan", locator: { location: "cloud", id: "plan" }, stored: { item: { currentRevisionId: "rev-1" } } }],
    activeId: "drawing", content: true,
  });
  await page.start();
  assert.deepEqual(plain(page.calls), [["refresh", "doc-plan"]], "the Canvas being drawn on stays in front");
  await page.context.window.PenEchoFolderProject.sync();
  assert.ok(page.records.has("doc-plan"), "an older answer never closes a tab");
});

test("saving into the project opens the Canvas for the folder, and closing a tab closes it there", async () => {
  const page = folderPage({
    views: [
      { name: "app", revision: 1, tabs: [tab("plan")], closed: [] },
      { name: "app", revision: 2, tabs: [tab("plan"), tab("fresh")], closed: [] },
      { name: "app", revision: 3, tabs: [tab("fresh")], closed: [tab("plan")] },
    ],
    docs: [{ id: "doc-plan", locator: { location: "cloud", id: "plan" }, stored: { item: { currentRevisionId: "rev-1" } } }], activeId: "doc-plan",
  });
  await page.start();
  page.listeners["penecho:canvas-saved"]({ detail: { location: "cloud", id: "plan", projectId: "project-1" } });
  page.listeners["penecho:canvas-saved"]({ detail: { location: "cloud", id: "elsewhere", projectId: "project-2" } });
  page.listeners["penecho:canvas-saved"]({ detail: { location: "cloud", id: "fresh", projectId: "project-1" } });
  await flush();
  page.listeners["penecho:canvas-documents-closed"]({ detail: { locators: [{ location: "cloud", id: "plan" }, { location: "device", id: "plan" }] } });
  await flush();
  assert.deepEqual(plain(page.requests), [["project"], ["project/tabs", { open: "fresh" }], ["project/tabs", { close: "plan" }]],
    "only a new Canvas of this project opens, and only a project tab closes");
});

test("reopening a closed Canvas brings it back as a tab and in front", async () => {
  const page = folderPage({
    views: [
      { name: "app", revision: 1, tabs: [tab("plan")], closed: [tab("old")] },
      { name: "app", revision: 2, tabs: [tab("plan"), tab("old")], closed: [] },
    ],
    docs: [{ id: "doc-plan", locator: { location: "cloud", id: "plan" }, stored: { item: { currentRevisionId: "rev-1" } } }], activeId: "doc-plan",
  });
  await page.start();
  await page.context.window.PenEchoFolderProject.reopen("old");
  assert.deepEqual(plain(page.requests.at(-1)), ["project/tabs", { open: "old" }]);
  assert.deepEqual(plain(page.calls.slice(-2)), [["open", "old"], ["choose", "doc-old"]]);
  assert.equal(page.context.canvasDocuments.activeId, "doc-old");
});

// Enough of the DOM for the tab strip, keyed by class names.
function element(tag) {
  const node = {
    tag, children: [], parent: null, attributes: {}, dataset: {}, listeners: {}, style: {}, className: "", textContent: "", title: "", hidden: false, disabled: false,
    setAttribute(name, value) { this.attributes[name] = String(value); }, removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    insertBefore(child, before) { child.remove(); const at = before ? this.children.indexOf(before) : -1; this.children.splice(at < 0 ? this.children.length : at, 0, child); child.parent = this; return child; },
    prepend(child) { return this.insertBefore(child, this.children[0] || null); },
    append(...children) { for (const child of children) this.insertBefore(child, null); },
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
    querySelectorAll(selector) {
      // .class, .class[data-attribute] or a tag name.
      const [, name, attribute] = selector.match(/^\.([\w-]+)(?:\[data-([\w-]+)\])?$/) || [];
      const matches = child => name ? child.className.split(" ").includes(name) && (!attribute || child.dataset.documentId !== undefined) : child.tag === selector;
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    getBoundingClientRect() { return { left: 300, bottom: 40 }; },
    focus() {},
  };
  return node;
}

function tabStrip({ closed = [] } = {}) {
  const nav = element("nav"), menu = Object.assign(element("div"), { offsetWidth: 200, showPopover() { this.open = true; }, hidePopover() { this.open = false; } }), position = {};
  const actions = [];
  const context = vm.createContext({
    document: { getElementById: id => ({ companionTabs: nav, companionTabMenu: menu })[id] || null, createElement: element },
    window: { PENECHO_CONFIG: { folderProject: { name: "app" } }, PenEchoFolderProject: { closed: () => closed, reopen: async canvasId => { actions.push(["reopen", canvasId]); }, flush: async () => { actions.push(["flush"]); } } },
    canvasDocuments: { records: new Map([["a", { firstSeenAt: 1 }], ["b", { firstSeenAt: 2 }], ["c", { firstSeenAt: 3 }]]), activeId: "b" },
    canvasCompanionMinimal: () => true,
    companionCanvasesCopy: en => en,
    companionCanvasesChoose: async (id, options) => { actions.push(["choose", id, options?.create === true]); },
    canvasDocumentsUiAction: work => { actions.push(["ui"]); return work(); },
    requestCanvasTransition: transition => { actions.push(["transition", transition.type, transition.documentId]); return Promise.resolve(true); },
    setStatus: () => {}, innerWidth: 400,
    runtimeElementStyle: (node, key) => node === menu && key === "companion-tab-menu" ? { setProperty: (name, value) => { position[name] = value; } } : null,
  });
  vm.runInContext(`${clientFunction("src/client/app/companion-canvases.js", "companionTabMenu")}\n${clientFunction("src/client/app/companion-canvases.js", "renderCompanionTabs")}\nglobalThis.render=renderCompanionTabs;`, context);
  const docs = ids => ids.map(id => ({ documentId: id, title: id.toUpperCase() }));
  const names = () => nav.children.map(child => child.className.includes("companion-project") ? "project" : child.className.includes("tab-close") ? "×" : child.className.includes("tab-new") ? "+" : child.textContent);
  return { nav, menu, position, actions, context, docs, names, render: (ids, current) => { context.canvasDocuments.activeId = current; context.render(docs(ids), current, false); } };
}

test("the tab strip keeps opening order, puts the close button on the open tab and reuses its buttons", async () => {
  const strip = tabStrip();
  strip.render(["c", "a", "b"], "b");
  assert.deepEqual(strip.names(), ["project", "A", "B", "×", "C", "+"]);
  const [, a, b, close] = strip.nav.children;
  strip.render(["c", "a", "b"], "a");
  assert.deepEqual(strip.names(), ["project", "A", "×", "B", "C", "+"]);
  assert.equal(strip.nav.children[1], a, "tabs are moved, not rebuilt");
  assert.equal(strip.nav.children[2], close);
  assert.equal(strip.nav.children[3], b);
  strip.nav.children[2].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(plain(strip.actions), [["ui"], ["flush"], ["transition", "close", "a"]], "a pending autosave goes before closing");
  strip.render(["b", "c"], "b");
  assert.deepEqual(strip.names(), ["project", "B", "×", "C", "+"]);
});

test("every page of a folder shows its project's tabs in the project's order, then its other Canvases", () => {
  const strip = tabStrip();
  strip.context.window.PenEchoFolderProject.tabOrder = () => ["canvas-c", "canvas-a"];
  strip.context.canvasDocuments.records = new Map([["a", { firstSeenAt: 1, locator: { location: "cloud", id: "canvas-a" } }], ["b", { firstSeenAt: 2 }], ["c", { firstSeenAt: 3, locator: { location: "cloud", id: "canvas-c" } }]]);
  strip.render(["a", "b", "c"], "a");
  assert.deepEqual(strip.names(), ["project", "C", "A", "×", "B", "+"], "this page opened A first, the project opened C first");
});

test("+ opens a new Canvas, or lists the project's closed Canvases to reopen", () => {
  const empty = tabStrip();
  empty.render(["a"], "a");
  empty.nav.children.at(-1).listeners.click();
  assert.deepEqual(plain(empty.actions), [["choose", null, true]]);

  const strip = tabStrip({ closed: [{ canvasId: "old", title: "Old plan" }] });
  strip.render(["a"], "a");
  strip.nav.children.at(-1).listeners.click();
  assert.equal(strip.menu.open, true);
  assert.deepEqual(plain(strip.position), { top: "44px", left: "192px" }, "the menu stays inside a narrow side panel");
  assert.deepEqual(strip.menu.children.map(child => child.tag === "hr" ? "—" : child.children[0].textContent), ["New canvas", "—", "Old plan"]);
  strip.menu.children[2].listeners.click();
  assert.equal(strip.menu.open, false);
  assert.deepEqual(plain(strip.actions), [["reopen", "old"]]);
});

test("a window whose agent connection moved to another window still switches its tabs", async () => {
  const choose = async notice => {
    const calls = [];
    const context = vm.createContext({
      CANVAS_COMPANION_REQUESTED: true, window: { PENECHO_CONFIG: { browserDraftId: "draft" }, PenEchoBrowserDraft: { flush: async () => {} } },
      companionCanvases: { busy: false, error: "" }, mcpRuntime: { connectionNotice: notice },
      document: { getElementById: () => null },
      companionCanvasesCopy: en => en, renderCompanionCanvases: () => {}, selectCanvasToolMode: () => {}, setStatus: () => {},
      companionCanvasesRefresh: async () => { calls.push("refresh"); return { canvases: [{ documentId: "a" }] }; },
      companionCanvasesSelect: async id => { calls.push(`select ${id}`); },
      canvasDocumentsShow: async id => { calls.push(`show ${id}`); },
    });
    vm.runInContext(`${clientFunction("src/client/app/companion-canvases.js", "companionCanvasesEnabled")}\n${clientFunction("src/client/app/companion-canvases.js", "companionCanvasesChoose")}\nglobalThis.choose=companionCanvasesChoose;`, context);
    await context.choose("b");
    return { calls, error: context.companionCanvases.error };
  };
  assert.deepEqual(plain(await choose(null)), { calls: ["refresh", "show b", "select b"], error: "" }, "the connected window also makes it the agents' target");
  assert.deepEqual(plain(await choose("workspaceReplaced")), { calls: ["show b"], error: "" });
});

test("a first sync that fails retries in seconds, backing off toward the minute", async () => {
  const slow = () => Object.assign(Error("slow"), { code: "timeout" });
  const page = folderPage({ views: [slow(), slow(), { name: "app", revision: 1, tabs: [tab("plan")], closed: [] }], docs: [{ id: "blank", locator: null, stored: { item: {} } }] });
  const settle = async () => { for (let index = 0; index < 6; index++) await flush(); };
  page.begin();
  await settle();
  assert.deepEqual(page.timers.map(([, delay]) => delay), [2000]);
  page.timers[0][0]();
  await settle();
  assert.deepEqual(page.timers.map(([, delay]) => delay), [2000, 4000]);
  page.timers[1][0]();
  await settle();
  assert.deepEqual(plain(page.calls), [["open", "plan"], ["show", "plan"], ["forget", "blank"]], "the third try opens the project's tabs");
  assert.equal(page.timers.length, 2, "no retry after it works");
});

// The page's Canvas in front, saved in Cloud as "plan" at rev-1.
const saved = (fields = {}) => ({ docs: [{ id: "doc-plan", locator: { location: "cloud", id: "plan" }, revision: 1, savedRevision: 1, title: "Plan", stored: { item: { currentRevisionId: "rev-1" }, tileEntries: [] }, base: { revisionId: "rev-1", stored: { item: { name: "Plan", widgets: [] }, tileEntries: [] } } }, ...(fields.docs || [])],
  activeId: "doc-plan", views: fields.views || [], extra: { ...fields.extra, state: { currentSnapshotId: "plan", currentSnapshotLocation: "cloud", currentSnapshotRevisionId: "rev-1", ...fields.extra?.state } } });
const settle = async () => { for (let index = 0; index < 12; index++) await flush(); };
const autosave = async page => { page.context.window.PenEchoFolderProject.changed(); const [run, delay] = page.timers.at(-1); assert.equal(delay, 3000, "a few seconds after the change"); run(); await settle(); };

test("a change saves itself a few seconds later, quietly, replacing the save it started from", async () => {
  const page = folderPage(saved({ extra: { dirty: true } }));
  await autosave(page);
  assert.deepEqual(plain(page.saves), [[{ location: "cloud", overwriteId: "plan", name: "Plan", allowEmpty: true }, { quiet: true, baseRevisionId: "rev-1", replace: true }]]);
  await autosave(page);
  assert.equal(page.saves.length, 1, "nothing new, nothing saved");
});

test("a newer save from another page is merged in first, then this page saves on top of it", async () => {
  const page = folderPage(saved({ extra: { dirty: true, mergeChanged: true, saveResults: [Object.assign(Error("conflict"), { code: "revision_conflict" }), "rev-3"], remote: { item: { currentRevisionId: "rev-2" }, tileEntries: [] } } }));
  await autosave(page);
  assert.equal(page.merges.length, 1);
  assert.deepEqual(plain(page.merges[0].base.item), { name: "Plan", widgets: [] }, "this page's changes are measured from the save it started from");
  assert.deepEqual(plain(page.replaced.map(options => [options.replace.item.currentRevisionId, options.clean])), [["rev-2", false]]);
  assert.deepEqual(plain(page.saves.map(([, options]) => options.baseRevisionId)), ["rev-1", "rev-2"], "then it saves on top of the newer save");
  assert.equal(page.records.get("doc-plan").base.revisionId, "rev-2");
});

test("a reopened page that lost its Canvas's revision takes in the current save, then saves on top of it", async () => {
  const page = folderPage(saved({ extra: { dirty: true, mergeChanged: true, remote: { item: { currentRevisionId: "rev-5" }, tileEntries: [] }, state: { currentSnapshotRevisionId: null } } }));
  await autosave(page);
  assert.equal(page.merges.length, 1);
  assert.deepEqual(plain(page.saves.map(([, options]) => options.baseRevisionId)), ["rev-5"]);
});

test("a blank new Canvas waits for content, and a busy Canvas waits until it is free", async () => {
  const blank = folderPage({ docs: [{ id: "doc-new", locator: null, stored: { item: {} } }], activeId: "doc-new", views: [], extra: { dirty: true, canvasHasShareableContent: () => false } });
  await autosave(blank);
  assert.equal(blank.saves.length, 0);
  let busy = true;
  const page = folderPage(saved({ extra: { dirty: true, canvasDocumentsDraftBusy: () => busy } }));
  await autosave(page);
  assert.equal(page.saves.length, 0, "not while drawing");
  busy = false;
  page.timers.at(-1)[0]();
  await settle();
  assert.equal(page.saves.length, 1, "right after");
});

test("an agent's change to a tab behind saves its stored copy and opens it for the folder", async () => {
  const notes = { id: "doc-notes", locator: null, revision: 2, savedRevision: 0, title: "Notes", stored: { item: { widgets: [{ id: "widget-1" }], images: [], textBoxes: [] }, tileEntries: [] } };
  const page = folderPage(saved({ docs: [notes], views: [{ name: "app", revision: 1, tabs: [tab("plan"), tab("new-canvas")], closed: [] }] }));
  page.context.window.PenEchoFolderProject.changed("doc-notes");
  page.timers.at(-1)[0]();
  await settle();
  const [[item, overwriteId]] = page.cloud;
  assert.deepEqual([overwriteId, item.name, item.projectId, item.preview instanceof Blob], [null, "Notes", "project-1", true]);
  const doc = page.records.get("doc-notes");
  assert.deepEqual(plain([doc.locator, doc.savedRevision, doc.base.revisionId]), [{ location: "cloud", id: "new-canvas" }, 2, "rev-behind"]);
  assert.deepEqual(plain(page.requests), [["project/tabs", { open: "new-canvas" }]], "it becomes a tab on the folder's other pages");
});

test("an unnamed Canvas saves under its first titled content, otherwise as the project's next Canvas N", async () => {
  const name = async (item, title = "Untitled Canvas") => {
    const doc = { id: "doc-new", locator: null, revision: 1, savedRevision: 0, title, stored: { item: { widgets: [], images: [], textBoxes: [], ...item }, tileEntries: [] } };
    const page = folderPage({ docs: [{ id: "blank", locator: null, stored: { item: {} } }, doc], content: true, views: [{ name: "app", revision: 1, tabs: [tab("plan")], closed: [] }],
      extra: { canvasDocumentsCopy: en => en } });
    await page.start();
    page.context.window.PenEchoFolderProject.changed("doc-new");
    page.timers.at(-1)[0]();
    await settle();
    return [page.cloud[0][0].name, page.records.get("doc-new").title];
  };
  assert.deepEqual(await name({ widgets: [{ title: "Release plan" }] }), ["Release plan", "Release plan"], "a Widget's title");
  assert.deepEqual(await name({ images: [{ sourceName: "Architecture" }] }, "MCP Canvas"), ["Architecture", "Architecture"], "an agent drawing's title, over a generic name");
  assert.deepEqual(await name({ textBoxes: [{ text: "\n  Open questions\nfirst one" }] }), ["Open questions", "Open questions"], "the first line of text");
  assert.deepEqual(await name({ widgets: [{ id: "untitled" }] }), ["Canvas 1", "Canvas 1"]);
  assert.deepEqual(await name({ widgets: [{ id: "named" }] }, "Ideas"), ["Ideas", "Ideas"], "a name is kept");
  const taken = folderPage(saved({ extra: { dirty: true, canvasDocumentsCopy: en => en, currentCanvasDisplayName: () => "Untitled Canvas" },
    views: [{ name: "app", revision: 1, tabs: [{ ...tab("plan"), title: "Canvas 1" }], closed: [{ ...tab("old"), title: "Canvas 2" }] }] }));
  Object.assign(taken.context.state, { widgets: [], images: [], textBoxes: [] });
  await taken.start();
  await autosave(taken);
  assert.equal(taken.saves[0][0].name, "Canvas 3", "the next number the project has not used");
  assert.equal(taken.context.state.currentCanvasSuggestedName, "Canvas 3", "the Canvas in front shows its new name");
});

test("the tab in front takes another page's newer save when the folder syncs, merging only when it has unsaved changes", async () => {
  const remote = { item: { currentRevisionId: "rev-2" }, tileEntries: [] };
  const page = folderPage(saved({ views: [{ name: "app", revision: 1, tabs: [tab("plan", "rev-2")], closed: [] }], extra: { remote } }));
  page.listeners["penecho:live-share-context-changed"]();
  await page.start();
  assert.equal(page.merges.length, 0, "a page with nothing unsaved takes the newer save as it is");
  assert.equal(page.replaced[0].replace, remote);
  assert.equal(page.replaced[0].clean, true, "and is saved already, so it does not save it back");
  assert.equal(page.saves.length, 0);

  const edited = folderPage(saved({ views: [{ name: "app", revision: 1, tabs: [tab("plan", "rev-2")], closed: [] }], extra: { remote, dirty: true, mergeChanged: true } }));
  await edited.start();
  assert.equal(edited.merges.length, 1, "unsaved changes are merged over it");
  assert.equal(edited.replaced[0].clean, false);
});

test("Save saves even an unchanged Canvas, through the same merge-aware path", async () => {
  const page = folderPage(saved());
  await page.context.window.PenEchoFolderProject.saveNow();
  assert.equal(page.saves.length, 1);
  assert.deepEqual(plain(page.notices), ["snapshotSaving", "snapshotSaved"]);
});

test("a newer save waits while an AI preview, an edit or a selection is open, and never accepts it", async () => {
  let busy = true, finalized = 0;
  const view = () => ({ name: "app", revision: 1, tabs: [tab("plan", "rev-2")], closed: [] });
  const page = folderPage(saved({ views: [view(), view()], extra: { remote: { item: { currentRevisionId: "rev-2" }, tileEntries: [] },
    canvasDocumentsDraftBusy: () => busy, finalizeCanvasForSnapshot: async () => { finalized++; } } }));
  await page.start();
  assert.deepEqual([page.replaced.length, finalized], [0, 0], "nothing is merged or accepted while the Canvas is in use");
  busy = false;
  await page.context.window.PenEchoFolderProject.sync();
  assert.equal(page.replaced.length, 1, "it is merged in once the Canvas is free");
  assert.equal(finalized, 0);
});

test("a tab behind that another page saved meanwhile merges that save in, then saves on top of it", async () => {
  const notes = { id: "doc-notes", locator: { location: "cloud", id: "notes" }, revision: 3, savedRevision: 2, title: "Notes",
    stored: { item: { currentRevisionId: "rev-n1", widgets: [{ id: "widget-1" }], images: [], textBoxes: [] }, tileEntries: [] }, base: { revisionId: "rev-n1", stored: { item: { widgets: [] }, tileEntries: [] } } };
  const page = folderPage(saved({ docs: [notes], extra: { cloudResults: [Object.assign(Error("conflict"), { code: "revision_conflict" }), "rev-n3"], remote: { item: { currentRevisionId: "rev-n2", widgets: [] }, tileEntries: [] } } }));
  page.context.window.PenEchoFolderProject.changed("doc-notes");
  page.timers.at(-1)[0]();
  await settle();
  assert.equal(page.merges.length, 1);
  assert.deepEqual(plain(page.merges[0].base.item), { widgets: [] }, "its changes are measured from its own base");
  assert.deepEqual(plain(page.cloud.map(([, overwriteId, options]) => [overwriteId, options.baseRevisionId, options.replace])), [["notes", "rev-n1", true], ["notes", "rev-n2", true]]);
  const doc = page.records.get("doc-notes");
  assert.deepEqual([doc.base.revisionId, doc.savedRevision === doc.revision], ["rev-n3", true]);
});

test("a page that just opened does not save the Canvas it opened with", async () => {
  const page = folderPage(saved({ views: [{ name: "app", revision: 1, tabs: [tab("plan")], closed: [] }] }));
  await page.start();
  await autosave(page);
  assert.equal(page.saves.length, 0);
});

test("a folder project's Canvas goes live only while it is collaborated on or shared; other Cloud Canvases still go live", () => {
  const run = ({ folder, audience = null }) => {
    const calls = [], canvasId = "123e4567-e89b-42d3-a456-426614174000";
    const context = vm.createContext({
      window: { PENECHO_CONFIG: { runtime: "cloud" }, PenEchoFolderProject: { enabled: () => folder } },
      state: { currentSnapshotLocation: "cloud", currentSnapshotId: canvasId, currentSnapshotBundleExtensions: {} },
      LIVE_UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      liveCanvas: { audience: new Map(audience ? [[canvasId, new Set([audience])]] : []), target: null },
      liveCanvasLink: () => null, liveCanvasAdopt: () => calls.push("adopt"), liveCanvasSequence: () => 0, liveCanvasRenderExpiry: () => {},
      liveCanvasStart: target => calls.push(`start ${Object.keys(target)[0]}`), liveCanvasStop: () => calls.push("stop"),
    });
    vm.runInContext(`${clientFunction("src/client/app/live-canvas.js", "liveCanvasSyncTarget")}\nliveCanvasSyncTarget();`, context);
    return calls;
  };
  assert.deepEqual(run({ folder: false }), ["start canvas"]);
  assert.deepEqual(run({ folder: true }), ["stop"], "a folder project's pages sync by saving");
  assert.deepEqual(run({ folder: true, audience: "collaboration" }), ["start canvas"], "Collaborate still makes it live");
  assert.deepEqual(run({ folder: true, audience: "share" }), ["start canvas"], "and people watching its share link see it live");
  const connect = fs.readFileSync(path.join(ROOT, "public/cloud-connect.js"), "utf8");
  assert.match(connect, /function rememberCollaboration\(canvasId, link\) \{[\s\S]*?PenEchoLiveCanvas\?\.audience\?\.\(canvasId, "collaboration", Boolean\(link\)\)/);
  assert.match(connect, /entry\.on = Boolean\(collaboration\);\s*window\.PenEchoLiveCanvas\?\.audience\?\.\(canvasId, "collaboration", entry\.on\)/);
  assert.match(connect, /function rememberLiveShare\(canvasId, widgetId, share\) \{[\s\S]*?if \(!widgetId\) window\.PenEchoLiveCanvas\?\.audience\?\.\(canvasId, "share", Boolean\(share\)\)/);
});

test("a guest's folder page saves into its own project, shows when it is cleared, and saves a cleared Canvas again", async () => {
  let renders = 0;
  const until = Date.now() + 5 * 86400000, guest = { name: "site", guest: true, guestProjectId: "guest-project", expiresAt: until };
  const page = folderPage({ ...saved({ extra: { dirty: true, liveCanvasRenderExpiry: () => { renders++; },
    saveResults: [Object.assign(Error("gone"), { status: 404 }), "rev-new"] } }), folder: guest });
  const api = page.context.window.PenEchoFolderProject;
  assert.deepEqual([api.enabled(), api.guest(), api.expiresAt()], [true, true, until]);
  await autosave(page);
  assert.deepEqual(plain(page.saves.map(([options]) => options.overwriteId)), ["plan", null], "a Canvas cleared after 7 idle days is saved again as a new one");
  assert.ok(api.expiresAt() > Date.now() + 6.9 * 86400000, "and is kept 7 days from now");
  assert.ok(renders > 0, "the date on the page follows");
  page.listeners["penecho:canvas-saved"]({ detail: { location: "cloud", id: "fresh", projectId: "guest-project" } });
  await flush();
  assert.deepEqual(plain(page.requests.at(-1)), ["project/tabs", { open: "fresh" }]);
});

test("a free account's project beyond its 3 kept shows when it goes, 7 days after each save, until it is kept", async () => {
  let renders = 0;
  const until = Date.now() + 2 * 86400000, over = { name: "app", cloudProjectId: "project-1", expiresAt: until, overFreeLimit: true };
  const page = folderPage({ ...saved({ views: [{ name: "app", cloudProjectId: "project-1", revision: 1, tabs: [], closed: [], expiresAt: null, overFreeLimit: false }],
    extra: { dirty: true, liveCanvasRenderExpiry: () => { renders++; } } }), folder: over });
  const api = page.context.window.PenEchoFolderProject;
  assert.deepEqual([api.guest(), api.overFreeLimit(), api.expiresAt()], [false, true, until]);
  await autosave(page);
  assert.ok(api.expiresAt() > Date.now() + 6.9 * 86400000, "a save keeps it 7 days from now");
  assert.ok(renders > 0, "the date on the page follows");
  // Kept with Plus, or a slot freed: the next sync clears the date.
  const shown = renders;
  await api.sync();
  assert.deepEqual([api.overFreeLimit(), api.expiresAt(), renders > shown], [false, null, true]);
  page.context.dirty = true;
  await autosave(page);
  assert.equal(page.saves.length, 2);
  assert.equal(api.expiresAt(), null, "and later saves leave it kept");

  const kept = folderPage(saved({ extra: { dirty: true, liveCanvasRenderExpiry: () => { renders++; } } })), before = renders;
  await autosave(kept);
  assert.deepEqual([kept.context.window.PenEchoFolderProject.overFreeLimit(), kept.context.window.PenEchoFolderProject.expiresAt(), renders], [false, null, before], "a kept project has no date");
});

test("an account's folder page whose project went to Trash saves its open Canvases as new ones in the folder's new project", async () => {
  const gone = () => Object.assign(Error("This Canvas is no longer in Cloud."), { status: 404 });
  const notes = { id: "doc-notes", locator: { location: "cloud", id: "notes" }, revision: 1, savedRevision: 1, title: "Notes",
    stored: { item: { projectId: "project-1", currentRevisionId: "rev-n1", widgets: [{ id: "widget-1" }], images: [], textBoxes: [] }, tileEntries: [] } };
  const page = folderPage(saved({ docs: [notes], extra: { dirty: true, saveResults: [gone(), "rev-new"], state: { currentSnapshotProjectId: "project-1" } }, views: [
    { name: "app", cloudProjectId: "project-1", revision: 9, tabs: [tab("plan"), tab("notes", "rev-n1")], closed: [] },
    { name: "app", cloudProjectId: "project-2", revision: 1, tabs: [], closed: [] },
    { name: "app", cloudProjectId: "project-2", revision: 2, tabs: [tab("new-canvas", "rev-behind")], closed: [] },
  ] }));
  await page.start();
  await autosave(page);
  await settle();
  const config = page.context.window.PENECHO_CONFIG.folderProject, api = page.context.window.PenEchoFolderProject;
  assert.equal(config.cloudProjectId, "project-2", "the page saves into the folder's new project from now on");
  assert.deepEqual(plain(page.saves.map(([options]) => options.overwriteId)), ["plan", null], "the Canvas in front is saved there as a new one");
  assert.equal(page.context.state.currentSnapshotProjectId, null);
  assert.deepEqual(plain(page.cloud.map(([item, overwriteId]) => [item.name, item.projectId, overwriteId])), [["Notes", "project-2", null]], "so is the tab behind");
  assert.deepEqual(plain(page.records.get("doc-notes").locator), { location: "cloud", id: "new-canvas" });
  assert.deepEqual(plain(page.requests), [["project"], ["project"], ["project/tabs", { open: "new-canvas" }]]);
  assert.deepEqual(plain(api.tabOrder()), ["new-canvas"], "the new project's tabs count from its own first revision");

  // A page that already reads the new project still knows its Canvas was in the old one.
  const moved = folderPage(saved({ extra: { dirty: true, saveResults: [gone(), "rev-new"], state: { currentSnapshotProjectId: "project-1" } }, views: [
    { name: "app", cloudProjectId: "project-2", revision: 1, tabs: [], closed: [] },
    { name: "app", cloudProjectId: "project-2", revision: 1, tabs: [], closed: [] },
  ] }));
  await moved.start();
  assert.equal(moved.context.window.PENECHO_CONFIG.folderProject.cloudProjectId, "project-2");
  await autosave(moved);
  assert.deepEqual(plain(moved.saves.map(([options]) => options.overwriteId)), ["plan", null]);

  // The folder's project is the same one: the Canvas itself is gone, and the save fails as before.
  const same = folderPage(saved({ extra: { dirty: true, saveResults: [gone()], state: { currentSnapshotProjectId: "project-1" } }, views: [{ name: "app", cloudProjectId: "project-1", revision: 1, tabs: [], closed: [] }] }));
  await autosave(same);
  assert.deepEqual(plain(same.saves.map(([options]) => options.overwriteId)), ["plan"]);
  assert.deepEqual(plain(same.requests), [["project"]]);
  assert.equal(same.context.window.PENECHO_CONFIG.folderProject.cloudProjectId, "project-1");
  assert.equal(same.timers.at(-1)[1], 6000, "it is tried again later");
});

test("signing in from a guest's folder page keeps its Canvases and reopens the page", async () => {
  let reloaded = 0;
  const page = folderPage({ ...saved({ views: [{ kept: 2, cloudProjectId: "account-project" }], extra: { location: { reload: () => { reloaded++; } }, setStatus: message => { page.status = message; },
    companionCanvasesCopy: en => en } }), folder: { name: "site", guest: true, guestProjectId: "guest-project" } });
  assert.equal(await page.context.window.PenEchoFolderProject.keep(), true);
  assert.deepEqual(plain(page.requests), [["project/keep", {}]]);
  assert.equal(reloaded, 1);
  assert.match(page.status, /Kept 2 Canvases/);
  const account = folderPage(saved());
  assert.equal(await account.context.window.PenEchoFolderProject.keep(), false, "an account's page has nothing to keep");
});

test("signing in the local app keeps a signed-out folder page's Canvases in Cloud, and the reopened page follows them to their Cloud ids", async () => {
  let reloaded = 0, identity = "";
  const local = { name: "app", localProjectId: "project-local" };
  const page = folderPage({ ...saved({ views: [{ kept: 1, cloudProjectId: "cloud-project" }], extra: { location: { reload: () => { reloaded++; } }, setStatus: message => { page.status = message; }, companionCanvasesCopy: en => en } }), folder: local });
  page.context.window.PenEchoCloudSettings = { cacheIdentity: () => identity };
  page.listeners["penecho:cloud-account-changed"]({ detail: { initial: true } });
  await settle();
  assert.deepEqual([page.requests.length, reloaded], [0, 0], "signed out, nothing moves");
  identity = "https://penecho.ai:account-1";
  page.listeners["penecho:cloud-account-changed"]({ detail: { changed: true } });
  await settle();
  assert.deepEqual(plain(page.requests), [["project/keep", {}]]);
  assert.deepEqual([reloaded, page.status], [1, "Kept 1 Canvas in your Cloud library."]);

  // Opened while already signed in, the page moves them right after it starts.
  const opened = folderPage({ ...saved({ views: [{ name: "app", revision: 1, tabs: [], closed: [] }, { kept: 1, cloudProjectId: "cloud-project" }], extra: { location: { reload: () => { reloaded++; } }, setStatus: () => {}, companionCanvasesCopy: en => en } }), folder: { ...local, keep: true } });
  await opened.start();
  await settle();
  assert.deepEqual(plain(opened.requests), [["project"], ["project/keep", {}]]);
  assert.equal(reloaded, 2);

  const from = "1700000000000-local-plan-0001";
  const reopened = folderPage({ docs: [{ id: "doc-plan", locator: { location: "cloud", id: from }, locators: [{ location: "cloud", id: from }], title: "Plan", stored: { item: { id: from, currentRevisionId: "r-local" }, tileEntries: [] }, base: { revisionId: "r-local", stored: { item: { id: from }, tileEntries: [] } } }],
    activeId: "doc-plan", folder: { name: "app", cloudProjectId: "cloud-project" }, extra: { state: { currentSnapshotId: from, currentSnapshotLocation: "cloud", currentSnapshotRevisionId: "r-local" } },
    views: [{ name: "app", revision: 3, tabs: [tab("cloud-plan", "rev-c1")], closed: [], moved: [{ from, to: "cloud-plan", revisionId: "rev-c1" }] }] });
  await reopened.start();
  const doc = reopened.records.get("doc-plan");
  assert.deepEqual(plain([doc.locator, doc.locators, doc.stored.item.id, doc.stored.item.currentRevisionId, doc.base.revisionId]), [{ location: "cloud", id: "cloud-plan" }, [{ location: "cloud", id: "cloud-plan" }], "cloud-plan", "rev-c1", "rev-c1"]);
  assert.deepEqual([reopened.context.state.currentSnapshotId, reopened.context.state.currentSnapshotRevisionId, reopened.context.state.currentSnapshotProjectId], ["cloud-plan", "rev-c1", "cloud-project"]);
  assert.deepEqual(plain(reopened.calls), [], "the open tab is the same Canvas: nothing opens again or reloads");
});

test("signed in to a free account with no room in Cloud, the local app's folder page says its project stays on this computer and stays open", async () => {
  let reloaded = 0;
  const local = { name: "app", localProjectId: "project-local" }, extra = () => ({ location: { reload: () => { reloaded++; } }, companionCanvasesCopy: en => en });
  const page = folderPage({ ...saved({ views: [{ kept: 0, stayed: true }], extra: { ...extra(), setStatus: message => { page.status = message; } } }), folder: local });
  assert.equal(await page.context.window.PenEchoFolderProject.keep(), false);
  assert.deepEqual(plain(page.requests), [["project/keep", {}]]);
  assert.deepEqual([reloaded, page.status], [0, "This project stays on this computer. Plus moves every project to Cloud."]);
  assert.equal(page.context.window.PenEchoFolderProject.expiresAt(), null, "nothing on this computer expires");

  // Opened with keep, the page asks once; reopening it would only ask again.
  const opened = folderPage({ ...saved({ views: [{ name: "app", revision: 1, tabs: [], closed: [] }, { kept: 0, stayed: true }, { name: "app", revision: 1, tabs: [], closed: [] }],
    extra: { ...extra(), setStatus: () => {} } }), folder: { ...local, keep: true } });
  await opened.start();
  await settle();
  await opened.context.window.PenEchoFolderProject.sync();
  assert.deepEqual(plain(opened.requests), [["project"], ["project/keep", {}], ["project"]]);
  assert.equal(reloaded, 0);
});

test("a guest's folder page shows when Cloud clears it, with Download PDF and Sign in to keep", () => {
  const host = element("span"), body = element("body"), signIns = [];
  host.parentNode = body; host.after = node => body.insertBefore(node, null);
  const byId = id => body.querySelectorAll(`.${id === "liveExpiry" ? "live-expiry" : id === "liveExpiryMenu" ? "live-expiry-menu" : "-"}`)[0] || (id === "liveParticipants" ? host : null);
  const until = new Date(2026, 10, 9, 12).getTime();
  const context = vm.createContext({
    document: { getElementById: byId, createElement: element, body, addEventListener: () => {}, removeEventListener: () => {} },
    window: { PenEchoFolderProject: { expiresAt: () => until, guest: () => true }, PenEchoBrowserDraft: { signIn: options => signIns.push(options.intent) }, PENECHO_CONFIG: {} },
    liveCanvas: { target: null, expiresAt: null }, state: { language: "en" }, liveCopy: en => en, setStatus: () => {},
  });
  vm.runInContext(`${clientFunction("src/client/app/live-canvas.js", "liveCanvasRenderExpiry")}\n${clientFunction("src/client/app/live-canvas.js", "liveCanvasExpiryMenu")}\nglobalThis.render=liveCanvasRenderExpiry;globalThis.menu=liveCanvasExpiryMenu;`, context);
  context.render();
  const chip = byId("liveExpiry");
  assert.equal(chip.textContent, "Until Nov 9");
  assert.match(chip.title, /folder's Canvases 7 days after their last change unless you sign in and keep them/);
  chip.focus = () => {};
  context.menu({ currentTarget: chip });
  const items = byId("liveExpiryMenu").children;
  assert.deepEqual(items.map(item => item.textContent), ["Download PDF", "Sign in to keep"]);
  items[1].focus = () => {};
  items[1].listeners.click();
  assert.deepEqual(signIns, ["keep"]);
});

test("a free account's project beyond its 3 kept shows when it moves to Trash, with Download PDF and Keep with Plus", () => {
  const host = element("span"), body = element("body"), opened = [];
  host.parentNode = body; host.after = node => body.insertBefore(node, null);
  const byId = id => body.querySelectorAll(`.${id === "liveExpiry" ? "live-expiry" : id === "liveExpiryMenu" ? "live-expiry-menu" : "-"}`)[0] || (id === "liveParticipants" ? host : null);
  const until = new Date(2026, 10, 9, 12).getTime();
  const context = vm.createContext({
    document: { getElementById: byId, createElement: element, body, addEventListener: () => {}, removeEventListener: () => {} },
    window: { PenEchoFolderProject: { expiresAt: () => until, guest: () => false, overFreeLimit: () => true }, PenEchoCloudSettings: { origin: () => "https://penecho.ai" },
      PENECHO_CONFIG: {}, open: (...args) => { opened.push(args); } },
    location: { origin: "http://127.0.0.1:4000" }, URL,
    liveCanvas: { target: null, expiresAt: null }, state: { language: "en" }, liveCopy: en => en, setStatus: () => {},
  });
  vm.runInContext(`${clientFunction("src/client/app/live-canvas.js", "liveCanvasRenderExpiry")}\n${clientFunction("src/client/app/live-canvas.js", "liveCanvasExpiryMenu")}\nglobalThis.render=liveCanvasRenderExpiry;globalThis.menu=liveCanvasExpiryMenu;`, context);
  context.render();
  const chip = byId("liveExpiry");
  assert.deepEqual([chip.textContent, chip.dataset.expiry], ["Until Nov 9", "folder"], "a narrow side panel keeps a folder project's date");
  assert.equal(chip.title, "Free keeps 3 projects. This one moves to Trash 7 days after its last change unless you keep it with Plus.");
  chip.focus = () => {};
  context.menu({ currentTarget: chip });
  const items = byId("liveExpiryMenu").children;
  assert.deepEqual(items.map(item => item.textContent), ["Download PDF", "Keep with Plus"]);
  items[1].focus = () => {};
  items[1].listeners.click();
  assert.deepEqual(opened, [["https://penecho.ai/dashboard.html#billing", "_blank", "noopener"]], "Cloud's billing page, in a new tab");

  // A Canvas of that project collaborated on by a link saves its own way.
  context.liveCanvas.target = { share: "link-token" };
  context.menu({ currentTarget: chip });
  assert.deepEqual(byId("liveExpiryMenu").children.map(item => item.textContent), ["Download PDF", "Sign in to save"]);
});

test("a Canvas kept with its folder page is in no Cloud library, so Collaborate starts it by a link that needs no account", () => {
  const source = read("src/client/app/ui-bootstrap.js"), match = source.match(/currentCanvasId:(\(\) => .*? : null),/);
  assert.ok(match, "currentCanvasId");
  let kept = "";
  const context = vm.createContext({ state: { currentSnapshotLocation: "cloud", currentSnapshotId: "11111111-2222-4333-8444-555555555555" }, folderPageCanvasPath: () => kept });
  const currentCanvasId = vm.runInContext(`(${match[1]})`, context);
  assert.equal(currentCanvasId(), "11111111-2222-4333-8444-555555555555", "an account's Cloud Canvas");
  kept = "/api/v1/mcp/workspaces/draft/project/canvases";
  assert.equal(currentCanvasId(), null, "a guest's, or a signed-out app's, folder Canvas");
});
