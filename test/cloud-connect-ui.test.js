"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const cloudScript = fs.readFileSync(path.join(ROOT, "public", "cloud-connect.js"), "utf8");
const cloudCss = fs.readFileSync(path.join(ROOT, "public", "cloud-connect.css"), "utf8");
const serverSource = fs.readFileSync(path.join(ROOT, "src", "server", "main.js"), "utf8");

test("Cloud storage help stays concise in both languages", () => {
  assert.match(cloudScript, /storageHelp:"Saved versions are never overwritten\."/);
  assert.match(cloudScript, /storageHelp:"已保存版本不会被覆盖。"/);
  assert.doesNotMatch(cloudScript, /Every successful save creates an immutable revision|每次成功保存都会创建不可变版本/);
});

class FakeElement {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.classSet = new Set();
    this.className = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.title = "";
    this._text = "";
  }

  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument?.body;
  }

  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get classList() {
    const set = this.classSet;
    return { add:(name) => set.add(name), remove:(name) => set.delete(name), toggle:(name, force) => { (force ?? !set.has(name)) ? set.add(name) : set.delete(name); }, contains:(name) => set.has(name) };
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(...nodes) { for (const node of nodes.flat()) if (node) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes); }
  insertBefore(node, ref) {
    node.parentNode = this;
    const index = ref ? this.children.indexOf(ref) : -1;
    if (index >= 0) this.children.splice(index, 0, node); else this.children.push(node);
    return node;
  }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }
  replaceWith(node) {
    if (!this.parentNode) return;
    const parent = this.parentNode, index = parent.children.indexOf(this);
    if (index < 0) return;
    this.parentNode = null;
    node.parentNode = parent;
    parent.children[index] = node;
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatch(type, event = {}) { for (const handler of this.listeners.get(type) || []) handler({ target:this, preventDefault() {}, ...event }); }
  click() { this.dispatch("click"); }
  focus() {}
  select() {}
  closest(selector) {
    let node = this;
    while (node) { if (matches(node, selector)) return node; node = node.parentNode; }
    return null;
  }
  querySelector(selector) { return queryAll(this, selector)[0] || null; }
  querySelectorAll(selector) { return queryAll(this, selector); }
}

class FakeCanvasElement extends FakeElement {
  constructor(ownerDocument) {
    super("canvas", ownerDocument);
    this.width = 300;
    this.height = 150;
    this.drawnText = [];
    this.drawnImages = [];
    this.context = {
      beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {},
      fillRect() {}, arc() {}, save() {}, restore() {}, clip() {},
      drawImage:(...args) => this.drawnImages.push(args),
      fillText:(value, ...position) => this.drawnText.push({ value:String(value), position }),
      measureText:(value) => ({ width:Array.from(String(value)).length * 10 }),
    };
  }
  getContext(type) { return type === "2d" ? this.context : null; }
  toBlob(callback, type = "image/png") { callback(new Blob(["fake-share-card"], { type })); }
}

class FakeImage {
  constructor() { this.naturalWidth = 800; this.naturalHeight = 500; this.width = 800; this.height = 500; }
  set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
  get src() { return this._src; }
}

class FakeFile extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    Object.defineProperty(this, "name", { value:String(name), enumerable:true });
    Object.defineProperty(this, "lastModified", { value:Date.now(), enumerable:true });
  }
}

function matches(node, selector) {
  if (!node.className || !selector.startsWith(".") || /[\s#[,:]/.test(selector)) return false;
  return node.className.split(/\s+/).includes(selector.slice(1));
}

function queryAll(root, selector) {
  if (!selector.startsWith(".") || /[\s#[,:]/.test(selector)) return [];
  const out = [];
  const walk = (node) => { if (matches(node, selector)) out.push(node); for (const child of node.children || []) if (child instanceof FakeElement) walk(child); };
  walk(root);
  return out;
}

function flatten(root) {
  const out = [];
  const walk = (node) => { out.push(node); for (const child of node.children || []) if (child instanceof FakeElement) walk(child); };
  walk(root);
  return out;
}

function makeTimers() {
  let nextId = 1, now = 0;
  const pending = new Map();
  const dueIds = (ms) => {
    now += ms;
    return [...pending.entries()].filter(([, task]) => task.at <= now).sort((a, b) => a[1].at - b[1].at).map(([id]) => id);
  };
  return {
    setTimeout(fn, ms = 0) { const id = nextId++; pending.set(id, { fn, at:now + ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    count:() => pending.size,
    async advance(ms = 0) { for (const id of dueIds(ms)) { const task = pending.get(id); if (task) { pending.delete(id); await task.fn(); } } },
    fire(ms = 0) { const fired = []; for (const id of dueIds(ms)) { const task = pending.get(id); if (task) { pending.delete(id); fired.push(task.fn()); } } return fired; },
  };
}

const deviceStatus = (device) => ({
  account:{ name:"Test User", credits:10 },
  accountSession:{ signedIn:true },
  device:{ configured:true, enabled:true, connected:false, state:"connecting", id:"dev-1", name:"My PenEcho", ...device },
  browserSignIn:{ pending:false },
});

const signedOutStatus = (device = {}) => ({
  account:null,
  accountSession:{ signedIn:false },
  device:{ configured:false, enabled:false, connected:false, state:"disconnected", id:null, name:null, ...device },
  browserSignIn:{ pending:false },
});

function boot({ status, remoteCloudStatus = null, cloudOrigin = "https://internaltest.penecho.ai", runtime, language = "en", communityItem, communityArtifact, lineage = null, library, communityFavorites = [], widgetFavorites = [], localFavoriteItems = [], cloudFavoriteSaveError = null, serverDesktopApp = false, rendererDesktopBridge = false, publishItem, canvasShareArtifact, widgetShareArtifact, widgetArtifactPromise = null, widgetArtifactError = null, navigatorOverrides = {}, withCrafts = false, sessionStorageEntries = {} } = {}) {
  const timers = makeTimers();
  const documentListeners = new Map();
  const document = {
    documentElement:{ lang:language },
    activeElement:null,
    visibilityState:"visible",
    cookie:"",
    listeners:documentListeners,
  };
  document.body = new FakeElement("body", document);
  document.createdElements = [];
  document.createElement = (tag) => {
    const node = String(tag).toLowerCase() === "canvas" ? new FakeCanvasElement(document) : new FakeElement(tag, document);
    document.createdElements.push(node);
    return node;
  };
  document.createTextNode = (text) => ({ textContent:String(text) });
  document.querySelector = (selector) => queryAll(document.body, selector)[0] || null;
  document.querySelectorAll = (selector) => queryAll(document.body, selector);
  document.addEventListener = (type, handler) => {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(handler);
  };
  document.dispatch = (type, event = {}) => { for (const handler of documentListeners.get(type) || []) handler({ type, ...event }); };

  const label = new FakeElement("span", document);
  label.className = "cloud-account-label";
  const cloudButton = new FakeElement("button", document);
  cloudButton.append(label);
  const shareButton = new FakeElement("button", document);
  const craftsButton = withCrafts ? new FakeElement("button", document) : null,
    craftsPopover = withCrafts ? new FakeElement("section", document) : null,
    craftsClose = withCrafts ? new FakeElement("button", document) : null,
    craftsList = withCrafts ? new FakeElement("div", document) : null,
    craftsRefreshStatus = withCrafts ? new FakeElement("span", document) : null,
    craftsFilters = withCrafts ? new FakeElement("div", document) : null,
    craftsFilterAll = withCrafts ? new FakeElement("button", document) : null,
    craftsFilterWidgets = withCrafts ? new FakeElement("button", document) : null,
    craftsFilterCanvases = withCrafts ? new FakeElement("button", document) : null;
  if (withCrafts) {
    craftsPopover.hidden = true;
    craftsRefreshStatus.hidden = true;
    craftsRefreshStatus.append(new FakeElement("span", document), new FakeElement("span", document));
    craftsFilters.append(craftsFilterAll, craftsFilterWidgets, craftsFilterCanvases);
    craftsPopover.append(craftsFilters, craftsRefreshStatus, craftsClose, craftsList);
    document.body.append(craftsButton, craftsPopover);
  }
  document.getElementById = (id) => ({ cloudAccountBtn:cloudButton, shareCanvasBtn:shareButton, craftsButton, craftsPopover, craftsClose, craftsList, craftsRefreshStatus, craftsFilters, craftsFilterAll, craftsFilterWidgets, craftsFilterCanvases })[id] || null;

  let statusPayload = status;
  let statusError = null;
  let stalePayload = null;
  let deferStatus = false;
  let releaseStale = null;
  let deferredAccountError = null;
  let releaseAccountError = null;
  let communityFavoritesPayload = communityFavorites;
  let holdCommunityFavorites = false;
  let communityFavoriteResolvers = [];
  let libraryPayload = library || { workspace:{}, projects:[], canvases:[], sync:{ bundleVersion:2, conflictPolicy:"base-revision-required" } };
  let holdLibrary = false;
  let libraryResolvers = [];
  const alerts = [];
  const clipboardWrites = [];
  const fetchCalls = [];
  const windowListeners = new Map();
  const jsonResponse = (body, status = 200) => ({ ok:true, status, json:async () => body });
  const fetch = (url, options = {}) => {
    const target = String(url);
    fetchCalls.push({ url:target, options });
    if (target === "/api/cloud/status") {
      if (statusError) return Promise.reject(statusError);
      if (deferStatus) {
        deferStatus = false;
        return new Promise((resolve) => { releaseStale = () => resolve(jsonResponse(stalePayload)); });
      }
      return Promise.resolve(jsonResponse(statusPayload));
    }
    if (target === "/api/cloud/account" && deferredAccountError) {
      return new Promise((resolve, reject) => { releaseAccountError = () => reject(deferredAccountError); });
    }
    if (target === "/api/cloud/account") return Promise.resolve(jsonResponse(statusPayload));
    if (target === "/api/cloud/sign-in/start") return Promise.resolve(jsonResponse({ authorizationUrl:`${cloudOrigin}/auth/local`, expiresAt:Date.now() + 60_000 }));
    if (target === "/api/cloud/pair") return Promise.resolve(jsonResponse(statusPayload));
    if (target === "/api/cloud/device/enable") return Promise.resolve(jsonResponse(statusPayload));
    if (target === "/api/cloud/library" || target.startsWith("/api/v1/library?")) {
      if (holdLibrary) return new Promise((resolve) => libraryResolvers.push(() => resolve(jsonResponse(libraryPayload))));
      return Promise.resolve(jsonResponse(libraryPayload));
    }
    if (target === "/api/favorites" && options.method === "PUT") {
      const existing = localFavoriteItems[0] || null,
        favorite = { ...existing, ...JSON.parse(options.body), id:existing?.id || "local-favorite-1", artifactSha256:existing?.artifactSha256 || "b".repeat(64), cloudId:existing?.cloudId || null, createdAt:existing?.createdAt || Date.now() };
      return Promise.resolve(jsonResponse({ favorite }, existing ? 200 : 201));
    }
    if (target === "/api/favorites" || target === "/api/favorites?view=summary") {
      const favorites=target.endsWith("view=summary")?localFavoriteItems.map(({ artifact, thumbnail, ...entry })=>({ ...entry, ...(thumbnail?{thumbnailUrl:`/api/favorites/${entry.artifactSha256}/thumbnail`}:{}) })):localFavoriteItems;
      return Promise.resolve(jsonResponse({ favorites }));
    }
    if (target.startsWith("/api/favorites/") && !options.method) {
      const sha=target.slice("/api/favorites/".length),favorite=localFavoriteItems.find((entry)=>entry.artifactSha256===sha);
      return Promise.resolve(favorite?jsonResponse({favorite}):{ok:false,status:404,json:async()=>({error:"not found"})});
    }
    if (target.endsWith("/cloud") && target.startsWith("/api/favorites/") && options.method === "PATCH") {
      const sha=target.slice("/api/favorites/".length,-"/cloud".length),favorite=localFavoriteItems.find((entry)=>entry.artifactSha256===sha);
      return Promise.resolve(favorite?jsonResponse({favorite:{...favorite,cloudId:JSON.parse(options.body).cloudId}}):{ok:false,status:404,json:async()=>({error:"not found"})});
    }
    if (target.startsWith("/api/favorites/") && options.method === "DELETE") return Promise.resolve(jsonResponse({ removed:true }));
    if (target === "/api/cloud/favorites" && options.method === "POST") {
      if (cloudFavoriteSaveError) return Promise.resolve({ ok:false, status:cloudFavoriteSaveError.status || 413, json:async () => ({ error:cloudFavoriteSaveError.message || "Not enough Cloud storage for this favorite.", code:cloudFavoriteSaveError.code || "storage_quota_exceeded" }) });
      return Promise.resolve(jsonResponse({ favorite:{ id:"cloud-favorite-1", ...JSON.parse(options.body) } }, 201));
    }
    if (["/api/cloud/favorites", "/api/cloud/favorites?view=summary", "/api/v1/favorites", "/api/v1/favorites?view=summary"].includes(target)) {
      const favorites=target.endsWith("view=summary")?widgetFavorites.map(({ artifact, thumbnail, ...entry })=>({ ...entry, thumbnailUrl:`/api/v1/favorites/${entry.id}/thumbnail` })):widgetFavorites;
      return Promise.resolve(jsonResponse({ favorites }));
    }
    const favoriteDetail=target.match(/^\/api\/(?:cloud\/favorites|v1\/favorites)\/([0-9a-f-]{36})$/i);
    if(favoriteDetail&&!options.method){const favorite=widgetFavorites.find((entry)=>entry.id===favoriteDetail[1]);return Promise.resolve(favorite?jsonResponse({favorite}):{ok:false,status:404,json:async()=>({error:"not found"})});}
    if (target.startsWith("/api/cloud/favorites/feed?") || target.startsWith("/api/v1/favorites/feed?")) {
      const query = new URL(target, "http://canvas.test").searchParams, kind = query.get("kind") || "all",
        limit = Number(query.get("limit")) || 20, offset = Number(query.get("cursor")) || 0,
        entries = [
          ...widgetFavorites.map((favorite) => ({ source:"private", kind:"widget", favoritedAt:favorite.favoritedAt || favorite.createdAt || 0, favorite:{ ...Object.fromEntries(Object.entries(favorite).filter(([key]) => !["artifact", "thumbnail"].includes(key))), hasThumbnail:Boolean(favorite.thumbnail), ...(favorite.thumbnail?{thumbnailUrl:`/api/v1/favorites/${favorite.id}/thumbnail`}:{}) } })),
          ...communityFavoritesPayload.map((item) => ({ source:"community", kind:item.kind, favoritedAt:item.favoritedAt || item.favoriteCreatedAt || item.createdAt || item.publishedAt || 0, item })),
        ].filter((entry) => kind === "all" || entry.kind === kind).sort((left, right) => right.favoritedAt - left.favoritedAt || String(left.item?.id || left.favorite?.id).localeCompare(String(right.item?.id || right.favorite?.id))),
        page = entries.slice(offset, offset + limit), hasMore = offset + limit < entries.length,
        response = jsonResponse({ items:page, pagination:{ limit, hasMore, nextCursor:hasMore ? String(offset + limit) : null } });
      if (holdCommunityFavorites) return new Promise((resolve) => communityFavoriteResolvers.push(() => resolve(response)));
      return Promise.resolve(response);
    }
    if (target.startsWith("/api/cloud/community?scope=favorites") || target.startsWith("/api/v1/community/items?scope=favorites")) {
      if (holdCommunityFavorites) return new Promise((resolve) => communityFavoriteResolvers.push(() => resolve(jsonResponse({ items:communityFavoritesPayload }))));
      return Promise.resolve(jsonResponse({ items:communityFavoritesPayload }));
    }
    if (target === "/api/cloud/community/share" && publishItem) return Promise.resolve(jsonResponse({ item:publishItem }));
    if (communityItem && target === `/api/cloud/community/${communityItem.id}/artifact`) return Promise.resolve(jsonResponse({ item:communityItem, artifact:communityArtifact }));
    if (communityItem && target === `/api/v1/community/items/${communityItem.id}`) return Promise.resolve(jsonResponse({ item:communityItem }));
    if (communityItem && target === `/api/v1/community/items/${communityItem.id}/view`) return Promise.resolve(jsonResponse(communityArtifact));
    return Promise.resolve({ ok:false, status:404, json:async () => ({ error:"not found" }) });
  };

  const imported = [];
  const opened = [];
  const openedLocal = [];
  const favoriteStates = [];
  const windowObject = {
    PENECHO_CONFIG:{ accessSessionToken:"test-session", cloudOrigin, cloudEnvironment:cloudOrigin.includes("internaltest") ? "uat" : "prod", desktopApp:serverDesktopApp, ...(runtime ? { runtime } : {}) },
    PENECHO_REMOTE_CLOUD_STATUS:remoteCloudStatus,
    ...(rendererDesktopBridge ? { penechoDesktop:{} } : {}),
    PenEchoCommunityCanvas:{
      importWidget:async (artifact, item) => { imported.push({ kind:"widget", artifact, item }); },
      importCanvas:async (artifact, item) => { imported.push({ kind:"canvas", artifact, item }); },
      widgetArtifact:async () => {
        if (widgetArtifactError) throw widgetArtifactError;
        if (widgetArtifactPromise) return widgetArtifactPromise;
        return widgetShareArtifact || ({ widget:{ id:"widget-1", title:"Widget" }, communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } });
      },
      setWidgetFavorite:(widgetId, favorite, busy = false) => favoriteStates.push({ widgetId, favorite, busy }),
      canvasArtifact:async () => canvasShareArtifact || ({ name:"", communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } }),
      lineageForArtifact:() => lineage,
    },
    PenEchoCloudProjects:{ openCanvas:async (id) => { openedLocal.push(id); return true; } },
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    async dispatch(type, event = {}) {
      for (const handler of windowListeners.get(type) || []) await handler({ type, ...event });
    },
    open(...args) { opened.push(args); return null; },
    confirm() { return true; },
    alert(message) { alerts.push(String(message)); },
  };
  const context = {
    window:windowObject, document, navigator:{ clipboard:{ writeText:async (value) => clipboardWrites.push(String(value)) }, ...navigatorOverrides }, location:{ origin:"http://127.0.0.1:3888" },
    sessionStorage:{
      getItem:(key) => Object.hasOwn(sessionStorageEntries, key) ? sessionStorageEntries[key] : null,
      setItem:(key, value) => { sessionStorageEntries[key] = String(value); },
      removeItem:(key) => { delete sessionStorageEntries[key]; },
    }, crypto:{},
    fetch, setTimeout:timers.setTimeout, clearTimeout:timers.clearTimeout, queueMicrotask,
    URL, URLSearchParams, Date, console, Blob, File:FakeFile, Image:FakeImage,
  };
  vm.runInNewContext(cloudScript, context, { filename:"public/cloud-connect.js" });
  const statusCalls = () => fetchCalls.filter((call) => call.url === "/api/cloud/status").length;
  return {
    document, cloudButton, shareButton, craftsButton, craftsPopover, craftsClose, craftsList, craftsRefreshStatus, craftsFilters, craftsFilterAll, craftsFilterWidgets, craftsFilterCanvases, timers, fetchCalls, statusCalls, alerts, clipboardWrites, imported, opened, openedLocal, favoriteStates, window:windowObject,
    overlay:() => document.querySelector(".penecho-cloud-overlay"),
    setStatus(next) { statusPayload = next; },
    setStatusError(error) { statusError = error; },
    freezeStale(next) { stalePayload = next; deferStatus = true; },
    releaseStale:() => releaseStale?.(),
    freezeAccountError(error) { deferredAccountError = error; },
    releaseAccountError:() => releaseAccountError?.(),
    setCommunityFavorites(next) { communityFavoritesPayload = next; },
    freezeCommunityFavorites(next) { communityFavoritesPayload = next; holdCommunityFavorites = true; },
    releaseCommunityFavorites() {
      holdCommunityFavorites = false;
      const pendingResolvers = communityFavoriteResolvers;
      communityFavoriteResolvers = [];
      for (const resolve of pendingResolvers) resolve();
    },
    setLibrary(next) { libraryPayload = next; },
    freezeLibrary(next) { libraryPayload = next; holdLibrary = true; },
    releaseLibrary() {
      holdLibrary = false;
      const pendingResolvers = libraryResolvers;
      libraryResolvers = [];
      for (const resolve of pendingResolvers) resolve();
    },
    async flush(rounds = 10) { for (let index = 0; index < rounds; index++) await new Promise((resolve) => setImmediate(resolve)); },
  };
}

test("Remote Canvas imports a public Craft with the browser Cloud session", async () => {
  const item = { id:"123e4567-e89b-42d3-a456-426614174000", kind:"widget", name:"Remote Craft" };
  const artifact = { format:"penecho-widget", formatVersion:1, widget:{ id:"widget-1", title:"Remote Craft" } };
  const run = boot({ runtime:"cloud", status:deviceStatus({}), communityItem:item, communityArtifact:artifact });
  await run.window.PenEchoCommunityUI.takeFurther(item.id);

  assert.deepEqual(run.imported, [{ kind:"widget", artifact, item }]);
  assert.deepEqual(run.fetchCalls.map((call) => call.url), [
    `/api/v1/community/items/${item.id}`,
    `/api/v1/community/items/${item.id}/view`,
  ]);
  assert.equal(run.statusCalls(), 0, "the Cloud shell must not ask the linked host for a second Cloud login");
});

test("Remote Canvas shows the Cloud account and online-device state before the Cloud button is clicked", () => {
  const run = boot({
    runtime:"cloud",
    status:deviceStatus({ connected:true }),
    remoteCloudStatus:{ accountName:"Remote User", deviceOnline:true },
  });

  assert.equal(run.cloudButton.querySelector(".cloud-account-label").textContent, "Remote");
  assert.equal(run.cloudButton.dataset.state, "connected");
  assert.equal(run.statusCalls(), 0, "initial header state must reuse the Remote Canvas gate response");
});

test("Remote Canvas updates the Cloud header when the gate response arrives after UI bootstrap", async () => {
  const run = boot({ runtime:"cloud", status:deviceStatus({ connected:true }) });
  assert.equal(run.cloudButton.querySelector(".cloud-account-label").textContent, "Cloud");

  run.window.PENECHO_REMOTE_CLOUD_STATUS = { accountName:"Late User", deviceOnline:true };
  await run.window.dispatch("penecho:remote-cloud-status");

  assert.equal(run.cloudButton.querySelector(".cloud-account-label").textContent, "Late");
  assert.equal(run.cloudButton.dataset.state, "connected");
  assert.equal(run.statusCalls(), 0);
});

test("Remote Canvas reads Cloud-owned libraries directly instead of relaying them through the linked host", async () => {
  const run = boot({
    runtime:"cloud",
    status:deviceStatus({ connected:true }),
    remoteCloudStatus:{ accountName:"Remote User", deviceOnline:true },
    communityFavorites:[{ id:"123e4567-e89b-42d3-a456-426614174090", kind:"canvas", name:"Roadmap", artifactSha256:"9".repeat(64) }],
    widgetFavorites:[{ id:"123e4567-e89b-42d3-a456-426614174091", name:"Timer", artifactSha256:"8".repeat(64), artifact:{ widget:{ title:"Timer" } } }],
  });
  await run.flush();

  run.cloudButton.click();
  assert.ok(run.overlay()?.isConnected, "the Cloud shell must open before any library response");
  await run.flush();
  assert.ok(run.fetchCalls.some((call) => call.url === "/api/v1/library?previews=0"));
  assert.equal(run.fetchCalls.some((call) => call.url === "/api/cloud/library"), false);
  assert.equal(run.statusCalls(), 0);

  flatten(run.overlay()).find((node) => node.getAttribute("role") === "tab" && node.textContent === "Favorites").click();
  await run.flush();
  assert.ok(run.fetchCalls.some((call) => call.url === "/api/v1/favorites/feed?kind=all&limit=20"));
  assert.equal(run.fetchCalls.some((call) => call.url.startsWith("/api/cloud/community?scope=favorites")), false);
  assert.equal(run.fetchCalls.some((call) => call.url === "/api/favorites?view=summary"), false, "Remote Canvas must not wait for or mirror linked-device favorites");
});

test("Cloud Center shell does not wait for a slow local status refresh", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  run.freezeStale(deviceStatus());

  run.cloudButton.click();
  assert.ok(run.overlay()?.isConnected, "the dialog is created synchronously while status refresh remains pending");
  run.releaseStale();
  await run.flush();
});

test("Cloud header reserves the green dot for an online device", () => {
  const css = fs.readFileSync(path.join(ROOT, "public/cloud-connect.css"), "utf8");
  assert.match(css, /\.cloud-account-button\[data-state="connected"\] \.cloud-account-dot \{ background: #10b981/);
  assert.doesNotMatch(css, /\.cloud-account-button\[data-state="signed-in"\] \.cloud-account-dot/);
});

async function openCloudCenter(run) {
  run.cloudButton.click();
  await run.flush();
  const overlay = run.overlay();
  assert.ok(overlay?.isConnected, "expected the Cloud Center overlay to open");
  return overlay;
}

async function publishCraftFromShareDialog(run, kind, { continuationText="Continue with the next useful detail.", beforePublish = null } = {}) {
  if (kind === "canvas") run.shareButton.click();
  else await run.window.dispatch("penecho:community-widget-action", { detail:{ action:"share", widgetId:"widget-1" } });
  await run.flush();
  const overlay = run.overlay();
  assert.ok(overlay?.isConnected, `expected the ${kind} share dialog to open`);
  beforePublish?.(overlay);
  const controls = flatten(overlay);
  const title = controls.find((node) => node.tagName === "INPUT" && ["Widget name", "Canvas name"].includes(node.getAttribute("placeholder")));
  const description = controls.find((node) => node.tagName === "TEXTAREA" && node.getAttribute("placeholder") === "A short, useful introduction");
  title.value = `${kind === "widget" ? "Widget" : "Canvas"} title`;
  title.dispatch("input");
  description.value = "A concise description of this published Craft.";
  description.dispatch("input");
  const category = controls.find((node) => node.tagName === "SELECT");
  category.value = "productivity";
  category.dispatch("change");
  const continuation = controls.find((node) => node.getAttribute("placeholder")?.includes("next Crafter"));
  continuation.value = continuationText;
  continuation.dispatch("input");
  for (const checkbox of controls.filter((node) => node.getAttribute("type") === "checkbox")) {
    checkbox.checked = true;
    checkbox.dispatch("change");
  }
  const publish = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Publish this stroke");
  assert.equal(publish?.disabled, false, "completed publication fields enable the publish action");
  publish.click();
  await run.flush();
  const resultOverlay = run.overlay();
  assert.equal(overlay.isConnected, false, "the publication form closes after a successful publish");
  assert.ok(resultOverlay?.isConnected, "a separate publication result dialog opens");
  assert.notEqual(resultOverlay, overlay);
  return resultOverlay;
}

test("the next-Crafter Echo prompt is optional in English and Chinese", async () => {
  const run = boot({
    status:deviceStatus(),
    publishItem:{ id:"123e4567-e89b-42d3-a456-426614174099", kind:"canvas", name:"Optional prompt" },
    canvasShareArtifact:{ name:"Optional prompt", communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } },
  });
  await run.flush();
  let publicationForm;
  await publishCraftFromShareDialog(run, "canvas", { continuationText:"", beforePublish:(overlay) => { publicationForm = overlay; } });
  const publicationRequest = run.fetchCalls.find((call) => call.url === "/api/cloud/community/share" && call.options.method === "POST");
  assert.equal(JSON.parse(publicationRequest.options.body).continuationPrompt, "");
  assert.ok(publicationForm.textContent.includes("What should the next Crafter Echo? (optional)"));
  assert.doesNotMatch(publicationForm.textContent, /Tell the next Crafter what to Echo/);

  const zh = boot({ status:deviceStatus(), language:"zh-CN" });
  await zh.flush();
  zh.shareButton.click();
  await zh.flush();
  assert.ok(zh.overlay().textContent.includes("下一位创作者应该 Echo 什么？（可选）"));
});

test("a continuation contribution is optional but its parent lineage is preserved", async () => {
  const parentItemId="123e4567-e89b-42d3-a456-426614174090",run=boot({
    status:deviceStatus(),
    lineage:{ parentItemId, parentName:"Original", parentGeneration:0 },
    publishItem:{ id:"123e4567-e89b-42d3-a456-426614174091", kind:"canvas", name:"Continuation" },
    canvasShareArtifact:{ name:"Continuation", communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } },
  });
  await run.flush();
  let publicationForm;
  await publishCraftFromShareDialog(run,"canvas",{ beforePublish:(overlay)=>{publicationForm=overlay;} });
  const request=run.fetchCalls.find((call)=>call.url==="/api/cloud/community/share"&&call.options.method==="POST"),payload=JSON.parse(request.options.body);
  assert.equal(payload.parentItemId,parentItemId);
  assert.equal(payload.contributionNote,"");
  assert.ok(publicationForm.textContent.includes("Your contribution to this Craft (optional)"));
});

test("the optional next-Crafter Echo prompt always opens empty", async () => {
  const draftKey = "penecho.community.publish.canvas.Draft identity";
  const sessionStorageEntries = {
    [draftKey]:JSON.stringify({
      name:"Recovered title",
      description:"Recovered description",
      category:"productivity",
      tags:"planning",
      continuation:"Old suggestion must not return",
    }),
  };
  const run = boot({
    status:deviceStatus(),
    canvasShareArtifact:{ name:"Draft identity", communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } },
    sessionStorageEntries,
  });
  await run.flush();
  run.shareButton.click();
  await run.flush();

  const controls = flatten(run.overlay());
  const title = controls.find((node) => node.tagName === "INPUT" && node.getAttribute("placeholder") === "Canvas name");
  const continuation = controls.find((node) => node.getAttribute("placeholder")?.includes("next Crafter"));
  assert.equal(title.value, "Recovered title", "ordinary publication draft fields still recover");
  assert.equal(continuation.value, "", "legacy or previous optional suggestions never prefill a new publication form");

  continuation.value = "A suggestion entered during this opening";
  continuation.dispatch("input");
  assert.equal(Object.hasOwn(JSON.parse(sessionStorageEntries[draftKey]), "continuation"), false, "the optional suggestion is not persisted as draft state");
});

test("new publication forms keep title and description empty and block incomplete publishing", async () => {
  const run = boot({
    status:deviceStatus(),
    publishItem:{ id:"123e4567-e89b-42d3-a456-426614174098", kind:"canvas", name:"Should not publish" },
    canvasShareArtifact:{ name:"Artifact title must not prefill", communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } },
  });
  await run.flush();
  run.shareButton.click();
  await run.flush();

  const overlay=run.overlay(),controls=flatten(overlay);
  const title=controls.find((node)=>node.tagName==="INPUT"&&node.getAttribute("placeholder")==="Canvas name");
  const description=controls.find((node)=>node.tagName==="TEXTAREA"&&node.getAttribute("placeholder")==="A short, useful introduction");
  const publish=controls.find((node)=>node.tagName==="BUTTON"&&node.textContent==="Publish this stroke");
  assert.equal(title.value, "");
  assert.equal(description.value, "");
  assert.equal(title.getAttribute("required"), "");
  assert.equal(description.getAttribute("required"), "");
  assert.equal(publish.disabled, false, "the publish action remains available so it can explain missing fields");

  publish.click();
  await run.flush();
  assert.ok(overlay.textContent.includes("Enter a title before publishing."));
  assert.equal(title.getAttribute("aria-invalid"), "true");
  assert.equal(run.fetchCalls.some((call)=>call.url==="/api/cloud/community/share"), false);

  title.value="A clear title";
  title.dispatch("input");
  publish.click();
  await run.flush();
  assert.ok(overlay.textContent.includes("Enter a description before publishing."));
  assert.equal(description.getAttribute("aria-invalid"), "true");
  assert.equal(run.fetchCalls.some((call)=>call.url==="/api/cloud/community/share"), false);
});

test("Cloud Center pairing instructions link PenEcho Cloud → Devices to the configured cloud origin", async () => {
  const uat = boot({ status:deviceStatus({ configured:false, enabled:false, state:"disconnected", id:null, name:null }) });
  await uat.flush();
  const overlay = await openCloudCenter(uat);
  const links = flatten(overlay).filter((node) => node.tagName === "A");
  const devices = links.find((node) => node.textContent === "PenEcho Cloud → Devices");
  assert.ok(devices, "expected the pairing instructions to contain a Devices link");
  assert.equal(devices.getAttribute("href"), "https://internaltest.penecho.ai/dashboard.html#devices");
  assert.equal(devices.getAttribute("target"), "_blank");
  assert.equal(devices.getAttribute("rel"), "noopener");
  assert.ok(overlay.textContent.includes("Generate a pairing key in PenEcho Cloud → Devices, then enter it below."));

  const prod = boot({ status:deviceStatus({ configured:false, enabled:false, state:"disconnected", id:null, name:null }), cloudOrigin:"https://penecho.ai" });
  await prod.flush();
  const prodOverlay = await openCloudCenter(prod);
  const prodLink = flatten(prodOverlay).find((node) => node.tagName === "A" && node.textContent === "PenEcho Cloud → Devices");
  assert.equal(prodLink.getAttribute("href"), "https://penecho.ai/dashboard.html#devices");
  assert.equal(prodLink.getAttribute("target"), "_blank");
  assert.equal(prodLink.getAttribute("rel"), "noopener");
});

test("signed-in account and configured device expose direct compact actions without settings copy", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const controls = flatten(overlay);
  const actionRows = controls.filter((node) => node.className === "cloud-button-row cloud-compact-actions");
  assert.equal(actionRows.length, 2);
  for (const label of ["Refresh account", "Sign out on this host", "Pause link", "Remove this link"]) {
    assert.ok(controls.some((node) => node.tagName === "BUTTON" && node.textContent === label), `expected direct ${label} action`);
  }
  assert.ok(!overlay.textContent.includes("Account settings"));
  assert.ok(!overlay.textContent.includes("Signing out removes"));
  assert.ok(!overlay.textContent.includes("Link settings"));
  assert.ok(!overlay.textContent.includes("Removing the link stops"));
});

test("sharing while signed out explains the requirement and opens Cloud sign-in", async () => {
  const run = boot({ status:signedOutStatus() });
  await run.flush();

  run.shareButton.click();
  await run.flush();

  const overlay = run.overlay();
  assert.ok(overlay?.isConnected, "the Cloud Center opens instead of an unusable publication form");
  assert.ok(overlay.textContent.includes("Please sign in to PenEcho Cloud before sharing."));
  assert.ok(flatten(overlay).some((node) => node.tagName === "BUTTON" && node.textContent === "Sign in with browser"));
  assert.ok(!overlay.textContent.includes("Preserve this moment"));
});

test("publication uses one consolidated PenEcho agreement link in browsers and desktop apps", async () => {
  for (const options of [
    { cloudOrigin:"https://internaltest.penecho.ai" },
    { cloudOrigin:"https://penecho.ai", rendererDesktopBridge:true },
  ]) {
    const run = boot({ status:deviceStatus(), ...options });
    await run.flush();
    run.shareButton.click();
    await run.flush();

    const overlay = run.overlay();
    const checkboxes = flatten(overlay).filter((node) => node.getAttribute("type") === "checkbox");
    const agreement = flatten(overlay).find((node) => node.tagName === "A" && node.textContent === "Publication Agreement");
    assert.equal(checkboxes.length, 1, "one agreement replaces the two overlapping confirmations");
    assert.ok(agreement);
    assert.equal(agreement.getAttribute("href"), `${options.cloudOrigin}/terms.html#public-crafts`);
    assert.equal(agreement.getAttribute("target"), "_blank");
    assert.equal(agreement.getAttribute("rel"), "noopener");
    assert.doesNotMatch(overlay.textContent, /Public Craft ML License|CC BY-SA 4\.0|embedded source under MIT|including its open-license and model-training terms/);
    const preview = flatten(overlay).find((node) => node.className === "cloud-share-preview");
    assert.ok(preview);
    assert.equal(preview.children.length, 1, "the preview contains only the image, without a dark metadata strip");
  }
});

test("a linked device remains visible and controllable when the Cloud account is signed out", async () => {
  const run = boot({ status:signedOutStatus({ configured:true, enabled:true, connected:true, state:"connected", id:"dev-1", name:"My PenEcho" }) });
  await run.flush();
  const overlay = await openCloudCenter(run);

  assert.ok(overlay.textContent.includes("My PenEcho · Connected"));
  assert.ok(flatten(overlay).some((node) => node.tagName === "BUTTON" && node.textContent === "Pause link"));
  assert.ok(flatten(overlay).some((node) => node.tagName === "BUTTON" && node.textContent === "Remove this link"));
  assert.ok(!overlay.textContent.includes("enter a one-time pairing key"));
});

test("Cloud Center re-renders from Connecting to Connected through the retained account refresh", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);
  assert.ok(overlay.textContent.includes("My PenEcho · Connecting"));

  run.setStatus(deviceStatus({ connected:true, state:"connected" }));
  const refresh = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Refresh account");
  refresh.click();
  await run.flush();
  assert.equal(run.overlay(), overlay, "overlay must stay the same instance");
  assert.ok(overlay.textContent.includes("My PenEcho · Connected"));
  assert.ok(!overlay.textContent.includes("· Connecting"));
  assert.equal(run.cloudButton.dataset.state, "connected");
});

test("a newly paired device automatically changes from Connecting to Connected", async () => {
  const run = boot({ status:deviceStatus({ configured:false, enabled:false, connected:false, state:"disconnected", id:null, name:null }) });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const pairingKey = flatten(overlay).find((node) => node.getAttribute("placeholder") === "Pairing key");
  const linkDevice = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Link device");
  assert.ok(pairingKey);
  assert.ok(linkDevice);

  pairingKey.value = "PEN-ABCD-2345";
  run.setStatus(deviceStatus());
  linkDevice.click();
  await run.flush();

  assert.ok(overlay.textContent.includes("My PenEcho · Connecting"));
  assert.equal(run.timers.count(), 1, "only the bounded post-pair connection watcher is active");

  run.setStatus(deviceStatus({ connected:true, state:"connected" }));
  await run.timers.advance(2_000);
  await run.flush();

  assert.equal(run.overlay(), overlay);
  assert.ok(overlay.textContent.includes("My PenEcho · Connected"));
  assert.ok(!overlay.textContent.includes("· Connecting"));
  assert.equal(run.cloudButton.dataset.state, "connected");
  assert.equal(run.timers.count(), 0, "the watcher stops as soon as Relay is connected");
});

test("a re-enabled device automatically changes from Connecting to Connected", async () => {
  const run = boot({ status:deviceStatus({ enabled:false, connected:false, state:"disconnected" }) });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const enableLink = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Enable link");
  assert.ok(enableLink);

  run.setStatus(deviceStatus());
  enableLink.click();
  await run.flush();
  assert.ok(overlay.textContent.includes("My PenEcho · Connecting"));
  assert.equal(run.timers.count(), 1);

  run.setStatus(deviceStatus({ connected:true, state:"connected" }));
  await run.timers.advance(2_000);
  await run.flush();
  assert.ok(overlay.textContent.includes("My PenEcho · Connected"));
  assert.equal(run.timers.count(), 0);
});

test("Cloud Center stays open when it was manually opened for an account that was already signed in", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);

  await run.timers.advance(30_000);
  assert.equal(run.overlay(), overlay, "an existing signed-in session is not a new login completion");
  assert.equal(run.timers.count(), 0, "ordinary Cloud Center use has no status watcher");
});

test("browser sign-in polling closes Cloud Center after the account session becomes signed in", async () => {
  const run = boot({ status:signedOutStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const signIn = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Sign in with browser");
  assert.ok(signIn, "expected the local browser sign-in action");

  signIn.click();
  await run.flush();
  assert.ok(run.fetchCalls.some((call) => call.url === "/api/cloud/sign-in/start"));
  run.setStatus(deviceStatus());
  await run.timers.advance(800);

  assert.equal(run.overlay(), null);
  assert.equal(run.cloudButton.getAttribute("aria-expanded"), "false");
  assert.equal(run.timers.count(), 0, "successful login stops both login and dialog status polling");
});

test("Projects signed-out state keeps one account sign-in action without a duplicate CTA", async () => {
  const run = boot({ status:signedOutStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);
  assert.ok(!overlay.textContent.includes("Choose a project, then open or save a versioned Canvas."), "the active tab label replaces the duplicate Projects heading and hint");

  assert.equal(flatten(overlay).filter((node) => node.tagName === "BUTTON" && node.textContent === "Sign in").length, 0);
  const signIn = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Sign in with browser");
  assert.ok(signIn, "the account panel keeps the single browser sign-in action");
  signIn.click();
  await run.flush();

  assert.ok(run.fetchCalls.some((call) => call.url === "/api/cloud/sign-in/start"));
  assert.deepEqual(run.opened, [["about:blank", "penecho-cloud-sign-in", "popup,width=760,height=760"]]);
});

test("browser sign-in detects Electron from the renderer bridge instead of the host server flag", async () => {
  const remoteClient = boot({ status:signedOutStatus(), serverDesktopApp:true });
  await remoteClient.flush();
  const remoteOverlay = await openCloudCenter(remoteClient);
  const remoteSignIn = flatten(remoteOverlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Sign in with browser");
  assert.ok(remoteSignIn, "a browser or mobile WebView connected to an Electron host stays on the browser flow");
  remoteSignIn.click();
  await remoteClient.flush();
  assert.deepEqual(remoteClient.opened, [["about:blank", "penecho-cloud-sign-in", "popup,width=760,height=760"]]);

  const electronRenderer = boot({ status:signedOutStatus(), rendererDesktopBridge:true });
  await electronRenderer.flush();
  const electronOverlay = await openCloudCenter(electronRenderer);
  const electronSignIn = flatten(electronOverlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Continue in browser");
  assert.ok(electronSignIn, "the Electron preload bridge selects the system-browser flow");
  electronSignIn.click();
  await electronRenderer.flush();
  assert.deepEqual(electronRenderer.opened, [["https://internaltest.penecho.ai/auth/local", "_blank", "noopener"]]);
});

test("browser sign-in callback closes on confirmed login but not on a failed or already-signed-in callback", async () => {
  const failed = boot({ status:signedOutStatus() });
  await failed.flush();
  const failedOverlay = await openCloudCenter(failed);
  await failed.window.dispatch("message", { origin:"http://127.0.0.1:3888", data:{ type:"penecho:cloud-sign-in-result", ok:false } });
  assert.equal(failed.overlay(), failedOverlay, "a failed callback must leave Cloud Center available for retry");

  const completed = boot({ status:signedOutStatus() });
  await completed.flush();
  await openCloudCenter(completed);
  completed.setStatus(deviceStatus());
  await completed.window.dispatch("message", { origin:"http://127.0.0.1:3888", data:{ type:"penecho:cloud-sign-in-result", ok:true } });
  assert.equal(completed.overlay(), null, "a callback closes only after the local status confirms the account session");

  const existing = boot({ status:deviceStatus() });
  await existing.flush();
  const existingOverlay = await openCloudCenter(existing);
  await existing.window.dispatch("message", { origin:"http://127.0.0.1:3888", data:{ type:"penecho:cloud-sign-in-result", ok:true } });
  assert.equal(existing.overlay(), existingOverlay, "a stale callback cannot close a dialog opened by an existing session");
});

test("Cloud Center refreshes data on open or tab switch without an always-visible Refresh button", async () => {
  const widget = { id:"123e4567-e89b-42d3-a456-426614174003", name:"Timer", artifactSha256:"a".repeat(64), artifact:{ widget:{ title:"Timer" } } };
  const run = boot({ status:deviceStatus(), widgetFavorites:[widget] });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const count = (url) => run.fetchCalls.filter((call) => call.url === url).length;
  const initialStatusCalls = run.statusCalls();

  assert.equal(count("/api/cloud/library"), 1, "opening loads Projects once");
  assert.equal(run.timers.count(), 0, "an open Cloud Center has no background data timer");

  await run.timers.advance(30_000);
  run.document.visibilityState = "hidden";
  run.document.dispatch("visibilitychange");
  run.document.visibilityState = "visible";
  run.document.dispatch("visibilitychange");
  await run.flush();
  assert.equal(run.statusCalls(), initialStatusCalls, "time and visibility changes do not refresh status");
  assert.equal(count("/api/cloud/library"), 1, "time and visibility changes do not reload Projects");

  const favorites = flatten(overlay).find((node) => node.getAttribute("role") === "tab" && node.textContent === "Favorites");
  favorites.click();
  await run.flush();
  assert.equal(count("/api/cloud/favorites/feed?kind=all&limit=20"), 1, "one Favorites load makes one lightweight mixed-feed request");

  const projects = flatten(overlay).find((node) => node.getAttribute("role") === "tab" && node.textContent === "Projects");
  projects.click();
  await run.flush();
  assert.equal(count("/api/cloud/library"), 2, "switching back intentionally reloads Projects once");
  assert.equal(run.statusCalls(), initialStatusCalls);
  assert.equal(flatten(overlay).filter((node) => node.getAttribute("aria-label") === "Refresh").length, 0);
});

test("Cloud Center keeps cached Projects and Favorites usable while background refreshes are pending", async () => {
  const projectLibrary = (projectName) => ({
    workspace:{},
    projects:[{ id:"project-1", name:projectName }],
    canvases:[{ id:"canvas-1", projectId:"project-1", name:`${projectName} Canvas`, updatedAt:Date.now(), sizeBytes:10 }],
    sync:{ bundleVersion:2, conflictPolicy:"base-revision-required" },
  });
  const oldFavorite = { id:"favorite-old", kind:"canvas", name:"Cached Favorite", author:{ name:"A" } };
  const newFavorite = { id:"favorite-new", kind:"canvas", name:"Fresh Favorite", author:{ name:"B" } };
  const run = boot({ status:deviceStatus(), library:projectLibrary("Cached Project"), communityFavorites:[oldFavorite] });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const tab = (name) => flatten(overlay).find((node) => node.getAttribute("role") === "tab" && node.textContent === name);
  const indicator = () => flatten(overlay).find((node) => node.className.includes("cloud-section-refresh-indicator"));

  assert.ok(overlay.textContent.includes("Cached Project"));
  tab("Favorites").click();
  await run.flush();
  assert.ok(overlay.textContent.includes("Cached Favorite"));

  run.freezeLibrary(projectLibrary("Fresh Project"));
  tab("Projects").click();
  await run.flush(2);
  assert.ok(overlay.textContent.includes("Cached Project"), "the previous Project remains visible and usable");
  assert.equal(indicator().hidden, false, "refresh indicator appears only while the replacement is loading");
  run.releaseLibrary();
  await run.flush();
  assert.ok(overlay.textContent.includes("Fresh Project"));
  assert.equal(indicator().hidden, true);

  run.freezeCommunityFavorites([newFavorite]);
  tab("Favorites").click();
  await run.flush(2);
  assert.ok(overlay.textContent.includes("Cached Favorite"), "the previous Favorite remains visible and usable");
  assert.equal(indicator().hidden, false);
  run.releaseCommunityFavorites();
  await run.flush();
  assert.ok(overlay.textContent.includes("Fresh Favorite"));
  assert.equal(indicator().hidden, true);
});

test("Cloud Center shows local favorites without waiting for a slow Cloud page", async () => {
  const local = { id:"local-fast", name:"Local fast Widget", artifactSha256:"7".repeat(64), artifact:{ format:"penecho-widget", formatVersion:1, widget:{ title:"Local fast Widget" } }, createdAt:Date.now(), cloudId:"already-uploaded" },
    run = boot({ status:deviceStatus(), localFavoriteItems:[local] });
  await run.flush();
  run.freezeCommunityFavorites([]);
  const overlay = await openCloudCenter(run);
  flatten(overlay).find((node) => node.getAttribute("role") === "tab" && node.textContent === "Favorites").click();
  await run.flush(2);

  assert.ok(overlay.textContent.includes("Local fast Widget"));
  assert.ok(overlay.textContent.includes("Loading favorites…"));
});

test("Cloud Center ignores a stale forced-refresh error after a newer status succeeds", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);

  run.freezeAccountError(new Error("stale account refresh failed"));
  const refresh = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Refresh account");
  refresh.click();
  await run.flush();

  run.setStatus(deviceStatus({ connected:true, state:"connected" }));
  await run.window.dispatch("message", { origin:"http://127.0.0.1:3888", data:{ type:"penecho:cloud-sign-in-result", ok:true } });
  assert.equal(run.cloudButton.dataset.state, "connected");

  run.releaseAccountError();
  await run.flush();
  assert.deepEqual(run.alerts, []);
  assert.equal(run.cloudButton.dataset.state, "connected");
  assert.ok(overlay.textContent.includes("My PenEcho · Connected"));
});

test("Cloud Center preserves a confirmed signed-in account across transient status failures and tab switches", async () => {
  const widget = { id:"123e4567-e89b-42d3-a456-426614174003", name:"Timer", artifactSha256:"a".repeat(64), artifact:{ widget:{ title:"Timer" } } };
  const run = boot({ status:deviceStatus(), widgetFavorites:[widget] });
  await run.flush();
  const overlay = await openCloudCenter(run);

  run.setStatusError(new Error("temporary status outage"));
  flatten(overlay).find((node) => node.className.includes("cloud-dialog-close")).click();
  const reopened = await openCloudCenter(run);
  await run.flush();
  assert.equal(run.cloudButton.dataset.state, "signed-in", "a failed reopen refresh cannot imply sign-out");

  const favorites = flatten(reopened).find((node) => node.getAttribute("role") === "tab" && node.textContent === "Favorites");
  favorites.click();
  await run.flush();
  assert.ok(flatten(reopened).some((node) => node.tagName === "BUTTON" && node.textContent === "Add to this Canvas"));
  assert.ok(!reopened.textContent.includes("Sign in to view favorites"));
});

test("Cloud Center keeps Projects, Favorites, and Echoes in one title-only row", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const tabs = flatten(overlay).filter((node) => node.getAttribute("role") === "tab");
  assert.deepEqual(tabs.map((tab) => tab.textContent), [
    "Projects",
    "Favorites",
  ]);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.ok(tabs.every((tab) => !flatten(tab).some((node) => node.tagName === "SPAN")), "tabs contain titles only");
  const explore = flatten(overlay).find((node) => node.tagName === "A" && node.className.includes("cloud-explore-link"));
  assert.ok(explore, "Echoes remains a Cloud navigation link");
  assert.equal(explore.textContent, "Echoes ↗");
  assert.equal(explore.getAttribute("href"), "https://internaltest.penecho.ai/community.html");
  assert.equal(explore.getAttribute("target"), "_blank");
  assert.equal(explore.getAttribute("rel"), "noopener");
});

test("Cloud Center keeps the concise account and device copy bilingual", async () => {
  const english = boot({ status:signedOutStatus(), language:"en" });
  await english.flush();
  const englishOverlay = await openCloudCenter(english);
  assert.ok(englishOverlay.textContent.includes("Sign in for private projects and favorites; API keys stay on this device."));
  assert.ok(englishOverlay.textContent.includes("After signing in, enter a one-time pairing key to reach this host securely from Cloud."));
  assert.equal(flatten(englishOverlay).filter((node) => node.tagName === "BUTTON" && node.textContent === "Sign in with browser").length, 1, "signed-out state has one sign-in action");

  const production = boot({ status:signedOutStatus(), cloudOrigin:"https://penecho.ai", language:"en" });
  await production.flush();
  const productionOverlay = await openCloudCenter(production);
  assert.ok(!productionOverlay.textContent.includes("Production"), "the normal production environment needs no badge");
  assert.ok(!productionOverlay.textContent.includes("UAT"));

  const run = boot({ status:signedOutStatus(), language:"zh-CN" });
  await run.flush();
  const overlay = await openCloudCenter(run);

  assert.ok(overlay.textContent.includes("登录后即可使用私有项目和收藏；API 密钥仍保存在此设备。"));
  assert.ok(overlay.textContent.includes("登录后输入一次性配对密钥，即可从 Cloud 安全访问此主机。"));
  assert.deepEqual(flatten(overlay).filter((node) => node.getAttribute("role") === "tab").map((node) => node.textContent), ["项目", "收藏"]);
  assert.ok(flatten(overlay).some((node) => node.tagName === "A" && node.textContent === "Echoes ↗"));
  assert.ok(!overlay.textContent.includes("Sign in for private projects"));
});

test("Cloud Center opens project Canvases in the current local Canvas", async () => {
  const projectId = "123e4567-e89b-42d3-a456-426614174001", canvasId = "123e4567-e89b-42d3-a456-426614174002";
  const library = { workspace:{}, projects:[{ id:projectId, name:"Research" }], canvases:[{ id:canvasId, projectId, name:"Notes", updatedAt:Date.now(), sizeBytes:42 }], sync:{ bundleVersion:2, conflictPolicy:"base-revision-required" } };
  const run = boot({ status:deviceStatus(), library });
  await run.flush();
  const overlay = await openCloudCenter(run);
  await run.flush();
  const row = flatten(overlay).find((node) => node.className === "cloud-canvas-row");
  assert.ok(row);
  row.click();
  await run.flush();
  assert.deepEqual(run.openedLocal, [canvasId]);
  assert.deepEqual(run.opened, [], "opening a Canvas must not navigate to PenEcho Cloud");
});

test("Cloud-hosted Canvas thumbnails use the immutable revision as their cache key", async () => {
  const projectId = "123e4567-e89b-42d3-a456-426614174011", canvasId = "123e4567-e89b-42d3-a456-426614174012", revisionId = "123e4567-e89b-42d3-a456-426614174013";
  const library = { workspace:{}, projects:[{ id:projectId, name:"Research" }], canvases:[{ id:canvasId, projectId, currentRevisionId:revisionId, name:"Notes", updatedAt:Date.now(), sizeBytes:42 }], sync:{ bundleVersion:2, conflictPolicy:"base-revision-required" } };
  const run = boot({ runtime:"cloud", status:deviceStatus(), remoteCloudStatus:{ accountName:"Remote User", deviceOnline:true }, library });
  await run.flush();
  const overlay = await openCloudCenter(run);
  await run.flush();
  const thumbnail = run.document.createdElements.find((node) => node.tagName === "IMG" && String(node.getAttribute("src") || "").includes(canvasId));
  assert.equal(thumbnail?.getAttribute("src"), `/api/v1/canvases/${canvasId}/thumbnail?revision=${revisionId}`);
});

test("local mutable image proxies revalidate instead of caching stale Canvas and Favorite previews", () => {
  assert.match(serverSource, /function sendPrivateMutableImage\(req, res, bytes/);
  assert.match(serverSource, /private, no-cache, must-revalidate/);
  assert.match(serverSource, /sendPrivateMutableImage\(req,res,result\.bytes,result\.contentType\)/);
  assert.match(serverSource, /sendPrivateMutableImage\(req,res,bytes\)/);
});

test("Cloud Center opens favorite Canvases in the current local Canvas", async () => {
  const canvas = { id:"123e4567-e89b-42d3-a456-426614174004", kind:"canvas", name:"Plan", author:{ name:"Ada" } };
  const canvasArtifact = { version:2, bundleVersion:2, mode:"snapshot", manifest:{ format:"penecho-raster-tiles" } };
  const run = boot({ status:deviceStatus(), communityItem:canvas, communityArtifact:canvasArtifact, communityFavorites:[canvas] });
  await run.flush();
  let overlay = await openCloudCenter(run);
  flatten(overlay).find((node) => node.getAttribute("role") === "tab" && node.textContent === "Favorites").click();
  await run.flush();
  assert.match(cloudScript, /favoriteCanvasesHint:"Public Canvases in Favorites"/);
  assert.doesNotMatch(cloudScript, /favoriteCanvasesHint:"Saved public Canvases"/);
  assert.equal(flatten(overlay).filter((node) => node.tagName === "H3" && node.textContent === "Favorites").length, 0);
  assert.deepEqual(flatten(overlay).filter((node) => node.className?.split?.(/\s+/).includes("cloud-favorite-filter")).map((node) => node.textContent), ["All", "Canvases", "Widgets"]);
  const activeFilter = () => flatten(overlay).find((node) => node.className?.split?.(/\s+/).includes("active") && node.className?.split?.(/\s+/).includes("cloud-favorite-filter"));
  assert.equal(activeFilter().textContent, "All");
  flatten(overlay).find((node) => node.className?.split?.(/\s+/).includes("cloud-favorite-filter") && node.textContent === "Canvases").click();
  assert.equal(activeFilter().textContent, "Canvases");
  assert.equal(activeFilter().getAttribute("aria-pressed"), "true");
  flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Open Canvas").click();
  await run.flush();
  assert.deepEqual(run.imported, [{ kind:"canvas", artifact:canvasArtifact, item:canvas }]);
  assert.deepEqual(run.opened, []);
});

test("Cloud Center proxies community favorite thumbnails through the local Canvas", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174024",
    canvas = { id, kind:"canvas", name:"Plan", author:{ name:"Ada" }, thumbnailUrl:`/api/v1/community/items/${id}/thumbnail` },
    run = boot({ status:deviceStatus(), communityFavorites:[canvas] });
  await run.flush();
  const overlay = await openCloudCenter(run);
  flatten(overlay).find((node) => node.getAttribute("role") === "tab" && node.textContent === "Favorites").click();
  await run.flush();

  const thumbnail = flatten(overlay).find((node) => node.className === "cloud-library-thumb");
  assert.ok(thumbnail);
  assert.equal(thumbnail.getAttribute("src"), `/api/cloud/community/${id}/thumbnail`);
  assert.notEqual(thumbnail.getAttribute("src"), canvas.thumbnailUrl, "a Cloud API path must never resolve against the local 192.168/localhost origin");
});

test("the toolbar Favorites picker proxies community Widget thumbnails with the community item id", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174025",
    widget = { id, kind:"widget", name:"Timer", artifactSha256:"c".repeat(64), thumbnailUrl:`/api/v1/community/items/${id}/thumbnail` },
    run = boot({ status:deviceStatus(), communityFavorites:[widget], withCrafts:true });
  await run.flush();

  run.craftsButton.click();
  await run.flush();

  const thumbnail = flatten(run.craftsList).find((node) => node.className === "crafts-thumb");
  assert.ok(thumbnail);
  assert.equal(thumbnail.src, `/api/cloud/community/${id}/thumbnail`);
  assert.notEqual(thumbnail.src, widget.thumbnailUrl);
});

test("the toolbar Favorites picker shows local rows while its first Cloud page is pending", async () => {
  const local = { id:"local-picker-fast", name:"Local picker Widget", artifactSha256:"6".repeat(64), artifact:{ format:"penecho-widget", formatVersion:1, widget:{ title:"Local picker Widget" } }, createdAt:Date.now(), cloudId:"already-uploaded" },
    run = boot({ status:deviceStatus(), localFavoriteItems:[local], withCrafts:true });
  await run.flush();
  run.freezeCommunityFavorites([]);
  run.craftsButton.click();
  await run.flush(2);

  assert.ok(run.craftsList.textContent.includes("Local picker Widget"));
  assert.equal(run.craftsRefreshStatus.hidden, false);
});

test("Cloud Center requests the next cursor page only after the first favorites page", async () => {
  const favorites = Array.from({ length:21 }, (_, index) => ({
    id:`123e4567-e89b-42d3-a456-${String(index + 1).padStart(12, "0")}`,
    kind:"canvas",
    name:`Canvas ${index + 1}`,
    favoritedAt:10_000 - index,
  }));
  const run = boot({ status:deviceStatus(), communityFavorites:favorites });
  await run.flush();
  const overlay = await openCloudCenter(run);
  flatten(overlay).find((node) => node.getAttribute("role") === "tab" && node.textContent === "Favorites").click();
  await run.flush();

  assert.equal(flatten(overlay).filter((node) => node.className === "cloud-library-row").length, 20);
  const more = flatten(overlay).find((node) => node.className?.includes?.("cloud-favorites-load-more"));
  assert.equal(more?.textContent, "Load more");
  assert.equal(run.fetchCalls.filter((call) => call.url.startsWith("/api/cloud/favorites/feed?")).length, 1);

  more.click();
  await run.flush();
  assert.equal(flatten(overlay).filter((node) => node.className === "cloud-library-row").length, 21);
  assert.ok(run.fetchCalls.some((call) => call.url === "/api/cloud/favorites/feed?kind=all&limit=20&cursor=20"));
});

test("the toolbar Favorites picker appends its next cursor page", async () => {
  const favorites = Array.from({ length:21 }, (_, index) => ({
    id:`123e4567-e89b-42d3-a456-${String(index + 101).padStart(12, "0")}`,
    kind:"widget",
    name:`Widget ${index + 1}`,
    artifactSha256:String(index + 1).padStart(64, "0"),
    favoritedAt:10_000 - index,
  }));
  const run = boot({ status:deviceStatus(), communityFavorites:favorites, withCrafts:true });
  await run.flush();
  run.craftsButton.click();
  await run.flush();

  assert.equal(flatten(run.craftsList).filter((node) => node.className === "crafts-row").length, 20);
  const more = flatten(run.craftsList).find((node) => node.className?.includes?.("crafts-load-more"));
  assert.equal(more?.textContent, "Load more");
  more.click();
  await run.flush();

  assert.equal(flatten(run.craftsList).filter((node) => node.className === "crafts-row").length, 21);
  assert.ok(run.fetchCalls.some((call) => call.url === "/api/cloud/favorites/feed?kind=all&limit=20&cursor=20"));
});

test("the toolbar Favorites picker shows Widgets and opens favorite Canvases as a new Canvas", async () => {
  const canvas = { id:"123e4567-e89b-42d3-a456-426614174026", kind:"canvas", name:"Roadmap", description:"Release plan", artifactSha256:"d".repeat(64) },
    widget = { id:"123e4567-e89b-42d3-a456-426614174027", kind:"widget", name:"Timer", artifactSha256:"e".repeat(64) },
    canvasArtifact = { format:"penecho-canvas-bundle", version:2 },
    run = boot({ status:deviceStatus(), communityItem:canvas, communityArtifact:canvasArtifact, communityFavorites:[canvas, widget], withCrafts:true });
  await run.flush();

  run.craftsButton.click();
  await run.flush();

  const rows = flatten(run.craftsList).filter((node) => node.className === "crafts-row"),
    actions = flatten(run.craftsList).filter((node) => node.tagName === "BUTTON").map((node) => node.textContent);
  assert.equal(rows.length, 2);
  assert.deepEqual(actions, ["Open", "×", "Add", "×"]);
  flatten(run.craftsList).find((node) => node.tagName === "BUTTON" && node.textContent === "Open").click();
  await run.flush();

  assert.deepEqual(run.imported, [{ kind:"canvas", artifact:canvasArtifact, item:canvas }]);
  assert.equal(run.craftsPopover.hidden, true);
  assert.ok(run.fetchCalls.some((call) => call.url === "/api/cloud/favorites/feed?kind=all&limit=20"));
});

test("the toolbar Favorites tabs filter one time-descending mixed list", async () => {
  const oldCanvas = { id:"123e4567-e89b-42d3-a456-426614174031", kind:"canvas", name:"Old Canvas", artifactSha256:"3".repeat(64), publishedAt:100 },
    middleWidget = { id:"123e4567-e89b-42d3-a456-426614174032", kind:"widget", name:"Middle Widget", artifactSha256:"4".repeat(64), publishedAt:200 },
    newCanvas = { id:"123e4567-e89b-42d3-a456-426614174033", kind:"canvas", name:"New Canvas", artifactSha256:"5".repeat(64), publishedAt:300 },
    run = boot({ status:deviceStatus(), communityFavorites:[oldCanvas, middleWidget, newCanvas], withCrafts:true });
  const rowTitles = () => flatten(run.craftsList)
    .filter((node) => node.className === "crafts-row")
    .map((row) => flatten(row).find((node) => node.tagName === "B")?.textContent);
  await run.flush();

  run.craftsButton.click();
  await run.flush();
  assert.equal(run.craftsFilterAll.getAttribute("aria-selected"), "true");
  assert.deepEqual(rowTitles(), ["New Canvas", "Middle Widget", "Old Canvas"]);

  run.craftsFilterWidgets.click();
  assert.equal(run.craftsFilterWidgets.getAttribute("aria-selected"), "true");
  assert.deepEqual(rowTitles(), ["Middle Widget"]);

  run.craftsFilterCanvases.click();
  assert.equal(run.craftsFilterCanvases.getAttribute("aria-selected"), "true");
  assert.deepEqual(rowTitles(), ["New Canvas", "Old Canvas"]);

  run.craftsClose.click();
  run.craftsButton.click();
  await run.flush();
  assert.equal(run.craftsFilterAll.getAttribute("aria-selected"), "true", "each new open defaults to All");
  assert.deepEqual(rowTitles(), ["New Canvas", "Middle Widget", "Old Canvas"]);
});

test("the toolbar Favorites picker keeps its last successful rows interactive while refreshing", async () => {
  const cachedCanvas = { id:"123e4567-e89b-42d3-a456-426614174028", kind:"canvas", name:"Cached Canvas", artifactSha256:"f".repeat(64) },
    cachedWidget = { id:"123e4567-e89b-42d3-a456-426614174029", kind:"widget", name:"Cached Widget", artifactSha256:"1".repeat(64) },
    refreshedCanvas = { id:"123e4567-e89b-42d3-a456-426614174030", kind:"canvas", name:"Fresh Canvas", artifactSha256:"2".repeat(64) },
    run = boot({ status:deviceStatus(), communityFavorites:[cachedCanvas, cachedWidget], withCrafts:true });
  await run.flush();

  run.craftsButton.click();
  assert.equal(run.craftsRefreshStatus.hidden, false, "the first load exposes refresh progress");
  await run.flush();
  assert.equal(run.craftsRefreshStatus.hidden, true);
  assert.match(run.craftsList.textContent, /Cached Canvas/);
  assert.match(run.craftsList.textContent, /Cached Widget/);

  run.craftsClose.click();
  run.freezeCommunityFavorites([refreshedCanvas]);
  run.craftsButton.click();
  await run.flush();

  assert.equal(run.craftsRefreshStatus.hidden, false, "background refresh remains visible beside cached rows");
  assert.match(run.craftsList.textContent, /Cached Canvas/);
  assert.match(run.craftsList.textContent, /Cached Widget/);
  const cachedActions = flatten(run.craftsList).filter((node) => node.tagName === "BUTTON" && ["Open", "Add"].includes(node.textContent));
  assert.equal(cachedActions.length, 2);
  assert.ok(cachedActions.every((button) => !button.disabled), "cached Canvas and Widget actions stay available during refresh");

  run.releaseCommunityFavorites();
  await run.flush();
  assert.equal(run.craftsRefreshStatus.hidden, true);
  assert.match(run.craftsList.textContent, /Fresh Canvas/);
  assert.doesNotMatch(run.craftsList.textContent, /Cached Canvas|Cached Widget/);
});

test("Cloud Center adds favorite Widgets to the current Canvas", async () => {
  const widget = { id:"123e4567-e89b-42d3-a456-426614174003", name:"Timer", artifactSha256:"a".repeat(64), artifact:{ widget:{ title:"Timer" } } };
  const run = boot({ status:deviceStatus(), widgetFavorites:[widget] });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const tab = flatten(overlay).find((node) => node.getAttribute("role") === "tab" && node.textContent === "Favorites");
  tab.click();
  await run.flush();
  const add = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Add to this Canvas");
  assert.ok(add);
  add.click();
  await run.flush();
  assert.deepEqual(run.imported, [{ kind:"widget", artifact:widget.artifact, item:null }]);
  assert.ok(run.fetchCalls.some((call) => call.url === "/api/cloud/favorites/feed?kind=all&limit=20"), "the list uses the metadata-only feed");
  assert.ok(run.fetchCalls.some((call) => call.url === `/api/cloud/favorites/${widget.id}`), "the complete artifact is fetched only when the Widget is added");
});

test("favoriting a Widget works on LAN HTTP without Web Crypto", async () => {
  const run = boot({
    status:signedOutStatus(),
    widgetShareArtifact:{ widget:{ id:"widget-1", title:"LAN Widget" } },
  });
  await run.flush();

  await run.window.dispatch("penecho:community-widget-action", { detail:{ action:"favorite", widgetId:"widget-1" } });
  await run.flush();

  assert.deepEqual(run.alerts, []);
  assert.deepEqual(run.favoriteStates, [
    { widgetId:"widget-1", favorite:undefined, busy:true },
    { widgetId:"widget-1", favorite:true, busy:false },
  ]);
  const request = run.fetchCalls.find((call) => call.url === "/api/favorites" && call.options.method === "PUT");
  assert.ok(request, "the local PenEcho service hashes and stores the favorite");
  assert.equal(JSON.parse(request.options.body).artifact.widget.title, "LAN Widget");
  assert.doesNotMatch(cloudScript, /crypto\.subtle\.digest/);
});

test("Cloud quota failure leaves the newly saved local favorite intact and explains local-only storage", async () => {
  const run = boot({
    status:deviceStatus(),
    widgetShareArtifact:{ widget:{ id:"widget-1", title:"Keep local" }, communityThumbnail:{ contentType:"image/webp", dataBase64:"A".repeat(200_000) } },
    cloudFavoriteSaveError:{ code:"storage_quota_exceeded" },
  });
  await run.flush();

  await run.window.dispatch("penecho:community-widget-action", { detail:{ action:"favorite", widgetId:"widget-1" } });
  await run.flush();

  assert.deepEqual(run.alerts, ["Cloud storage is full. Saved locally only."], "the user sees one concise local-only result");
  assert.deepEqual(run.favoriteStates, [
    { widgetId:"widget-1", favorite:undefined, busy:true },
    { widgetId:"widget-1", favorite:true, busy:false },
  ]);
  assert.equal(run.fetchCalls.filter((call) => call.url === "/api/favorites" && call.options.method === "PUT").length, 1);
  assert.ok(run.fetchCalls.some((call) => call.url === "/api/cloud/favorites" && call.options.method === "POST"));
  assert.ok(!run.fetchCalls.some((call) => call.url.startsWith("/api/favorites/") && call.options.method === "DELETE"));
});

test("clicking an already-favorite Widget removes the server-identified favorite", async () => {
  const artifact = { widget:{ id:"widget-1", title:"LAN Widget" } },
    existing = { id:"local-favorite-1", name:"LAN Widget", artifact, artifactSha256:"a".repeat(64), cloudId:null, createdAt:1 },
    run = boot({ status:signedOutStatus(), widgetShareArtifact:artifact, localFavoriteItems:[existing] });
  await run.flush();

  await run.window.dispatch("penecho:community-widget-action", { detail:{ action:"favorite", widgetId:"widget-1" } });
  await run.flush();

  assert.deepEqual(run.alerts, []);
  assert.deepEqual(run.favoriteStates, [
    { widgetId:"widget-1", favorite:undefined, busy:true },
    { widgetId:"widget-1", favorite:false, busy:false },
  ]);
  assert.ok(run.fetchCalls.some((call) => call.url === `/api/favorites/${"a".repeat(64)}` && call.options.method === "DELETE"));
});

test("Widget favorite busy state clears after a failed snapshot", async () => {
  const run = boot({ status:signedOutStatus(), widgetArtifactError:new Error("snapshot failed") });
  await run.flush();

  await run.window.dispatch("penecho:community-widget-action", { detail:{ action:"favorite", widgetId:"widget-1" } });
  await run.flush();

  assert.deepEqual(run.alerts, ["snapshot failed"]);
  assert.deepEqual(run.favoriteStates, [
    { widgetId:"widget-1", favorite:undefined, busy:true },
    { widgetId:"widget-1", favorite:undefined, busy:false },
  ]);
});

test("Widget favorite ignores repeat activation while its snapshot is still saving", async () => {
  let releaseArtifact;
  const widgetArtifactPromise = new Promise((resolve) => { releaseArtifact = resolve; });
  const run = boot({ status:signedOutStatus(), widgetArtifactPromise });
  await run.flush();

  const first = run.window.dispatch("penecho:community-widget-action", { detail:{ action:"favorite", widgetId:"widget-1" } });
  await run.flush();
  const second = run.window.dispatch("penecho:community-widget-action", { detail:{ action:"favorite", widgetId:"widget-1" } });
  await run.flush();

  assert.deepEqual(run.favoriteStates, [{ widgetId:"widget-1", favorite:undefined, busy:true }]);
  releaseArtifact({ widget:{ id:"widget-1", title:"One snapshot" } });
  await Promise.all([first, second]);
  await run.flush();
  assert.deepEqual(run.favoriteStates, [
    { widgetId:"widget-1", favorite:undefined, busy:true },
    { widgetId:"widget-1", favorite:true, busy:false },
  ]);
  assert.equal(run.fetchCalls.filter((call) => call.url === "/api/favorites" && call.options.method === "PUT").length, 1);
});

test("share dialog and all category labels use the Chinese Cloud copy", async () => {
  const run = boot({ status:deviceStatus(), language:"zh-CN" });
  await run.flush();
  run.shareButton.click();
  await run.flush();

  const overlay = run.overlay();
  assert.ok(overlay?.isConnected, "expected the share dialog to open");
  assert.ok(overlay.textContent.includes("保存这一刻"));
  assert.ok(overlay.textContent.includes("使用当前 AI 自动填写"));
  assert.ok(overlay.textContent.includes("我有权发布此作品"));
  assert.ok(overlay.textContent.includes("《发布协议》"));
  assert.ok(!overlay.textContent.includes("包括开放许可与模型训练条款"));
  assert.ok(overlay.textContent.includes("发布此笔触"));
  assert.ok(overlay.textContent.includes("预览已就绪"));

  const category = flatten(overlay).find((node) => node.tagName === "SELECT");
  assert.deepEqual(category.children.map((option) => option.textContent), [
    "选择分类…", "教育", "效率", "数据", "设计", "开发", "科学", "商业", "生活方式", "其他", "分享与指导", "协作共创", "学习笔记",
  ]);
  const controls = flatten(overlay);
  assert.ok(controls.some((node) => node.getAttribute("placeholder") === "画布名称"));
  assert.ok(controls.some((node) => node.getAttribute("placeholder") === "写一段简短、实用的介绍"));
  assert.doesNotMatch(overlay.textContent, /Preserve this moment|Select a category|Auto-fill with current AI|I have the right to publish/);
});

test("published Canvas closes the publication form and opens a link-first result dialog", async () => {
  const item = { id:"123e4567-e89b-42d3-a456-426614174021", kind:"canvas", name:"Roadmap", description:"Plan the next release.", shareUrl:"/community/123e4567-e89b-42d3-a456-426614174021" };
  const shareCalls = [];
  const run = boot({
    status:deviceStatus(),
    publishItem:item,
    canvasShareArtifact:{ name:"Roadmap", communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } },
    navigatorOverrides:{ share:async (payload) => { shareCalls.push(payload); } },
  });
  await run.flush();
  const overlay = await publishCraftFromShareDialog(run, "canvas");
  const publicationRequest = run.fetchCalls.find((call) => call.url === "/api/cloud/community/share" && call.options.method === "POST");
  const publication = JSON.parse(publicationRequest.options.body);
  assert.equal(publication.publicationTermsAccepted, true);
  assert.equal(publication.publicationRightsAccepted, true);
  assert.equal(publication.modelTrainingAccepted, true, "the consolidated agreement satisfies the existing server contract");
  assert.ok(overlay.textContent.includes("Published to Echoes"));
  assert.doesNotMatch(overlay.textContent, /Publish this stroke|Auto-fill with current AI/);
  const actions = flatten(overlay).filter((node) => node.tagName === "BUTTON" || node.tagName === "A");
  const linkIndex = actions.findIndex((node) => node.textContent === "Share as link");
  const imageIndex = actions.findIndex((node) => node.textContent === "Share as image");
  assert.ok(linkIndex >= 0 && imageIndex > linkIndex, "link sharing is the first share action");

  actions[linkIndex].click();
  await run.flush();
  assert.equal(shareCalls.length, 1);
  assert.equal(shareCalls[0].title, "Roadmap");
  assert.equal(shareCalls[0].text, "View and Echo this Canvas on PenEcho.");
  assert.equal(shareCalls[0].url, "https://internaltest.penecho.ai/community/123e4567-e89b-42d3-a456-426614174021");
  assert.ok(overlay.textContent.includes("Link shared."));
});

test("published image sharing copies a responsive linked image embed and prevents duplicate actions", async () => {
  const item = { id:"123e4567-e89b-42d3-a456-426614174023", kind:"canvas", name:'Launch "plan" <safe>' };
  let releaseCopy;
  const clipboardWrites = [];
  const run = boot({
    status:deviceStatus(),
    publishItem:item,
    navigatorOverrides:{ clipboard:{ writeText:(value) => new Promise((resolve) => { clipboardWrites.push(String(value)); releaseCopy=resolve; }) } },
  });
  await run.flush();
  const overlay = await publishCraftFromShareDialog(run, "canvas");
  const shareLink = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Share as link");
  const shareImage = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Share as image");
  shareImage.click();
  assert.equal(shareLink.disabled, true);
  assert.equal(shareImage.disabled, true);
  assert.equal(clipboardWrites.length, 1);
  assert.equal(clipboardWrites[0], '<a href="https://internaltest.penecho.ai/community/123e4567-e89b-42d3-a456-426614174023" target="_blank" rel="noopener noreferrer"><img src="https://internaltest.penecho.ai/api/v1/community/items/123e4567-e89b-42d3-a456-426614174023/social-card.png" alt="Launch &quot;plan&quot; &lt;safe&gt; — PenEcho Echoes" width="1200" height="630" loading="lazy" decoding="async" style="max-width:100%;height:auto"></a>');
  releaseCopy();
  await run.flush();
  assert.equal(shareLink.disabled, false);
  assert.equal(shareImage.disabled, false);
  assert.ok(overlay.textContent.includes("Linked image embed code copied."));
});

test("published Widget exposes the same bilingual link and image actions", async () => {
  const item = { id:"123e4567-e89b-42d3-a456-426614174022", kind:"widget", name:"计时器" };
  const run = boot({ status:deviceStatus(), language:"zh-CN", publishItem:item, widgetShareArtifact:{ widget:{ id:"widget-1", title:"计时器" }, communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } } });
  await run.flush();
  await run.window.dispatch("penecho:community-widget-action", { detail:{ action:"share", widgetId:"widget-1" } });
  await run.flush();
  const form = run.overlay(), controls = flatten(form);
  const title = controls.find((node) => node.tagName === "INPUT" && node.getAttribute("placeholder") === "组件名称");
  const description = controls.find((node) => node.tagName === "TEXTAREA" && node.getAttribute("placeholder") === "写一段简短、实用的介绍");
  title.value = "计时器"; title.dispatch("input");
  description.value = "一个清晰、可复用的计时组件。"; description.dispatch("input");
  const category = controls.find((node) => node.tagName === "SELECT");
  category.value = "productivity"; category.dispatch("change");
  for (const checkbox of controls.filter((node) => node.getAttribute("type") === "checkbox")) { checkbox.checked = true; checkbox.dispatch("change"); }
  controls.find((node) => node.tagName === "BUTTON" && node.textContent === "发布此笔触").click();
  await run.flush();

  const result = run.overlay();
  assert.equal(form.isConnected, false);
  assert.ok(result.textContent.includes("已发布到 Echoes"));
  const shareLink = flatten(result).find((node) => node.tagName === "BUTTON" && node.textContent === "分享链接");
  const shareImage = flatten(result).find((node) => node.tagName === "BUTTON" && node.textContent === "分享为图片");
  assert.ok(shareLink && shareImage);
  shareImage.click();
  await run.flush();
  assert.match(run.clipboardWrites.at(-1), /<a href="https:\/\/internaltest\.penecho\.ai\/community\/123e4567-e89b-42d3-a456-426614174022"/);
  assert.match(run.clipboardWrites.at(-1), /<img src="https:\/\/internaltest\.penecho\.ai\/api\/v1\/community\/items\/123e4567-e89b-42d3-a456-426614174022\/social-card\.png"/);
  assert.ok(result.textContent.includes("带链接的图片嵌入代码已复制。"));
});

test("share and widget-favorite flows do not embed user-facing English outside Cloud copy", () => {
  const shareSource = cloudScript.slice(cloudScript.indexOf("function shareDialog"), cloudScript.indexOf("async function takeFurther"));
  const favoriteSource = cloudScript.slice(cloudScript.indexOf("async function toggleWidgetFavorite"), cloudScript.indexOf("async function syncLocalFavorites"));
  assert.doesNotMatch(shareSource, /Preserve this moment|Generating preview|Use no more than 8 tags|Enter a name before publishing|Craft published safely|Copy link|Preview ready\.|Could not generate the preview/);
  assert.doesNotMatch(shareSource, /creativecommons\.org|opensource\.org|public-craft-training|Public Craft ML License/);
  assert.match(shareSource, /new URL\("\/terms\.html#public-crafts",`\$\{cloudOrigin\(\)\}\/`\)/);
  assert.doesNotMatch(favoriteSource, /This PenEcho version does not support widget favorites|"Untitled Widget"/);
  assert.match(shareSource, /CATEGORIES\.map\(value => el\("option", \{ value, text:cloudT\(CATEGORY_LABEL_KEYS\[value\]\) \}\)\)/);
  assert.match(favoriteSource, /throw new Error\(cloudT\("favoriteUnsupported"\)\)/);
});

test("the local favorite API has no 1 MiB artifact or 128 KiB thumbnail cap", () => {
  assert.doesNotMatch(serverSource, /1 MiB favorite limit|artifactText\.length\s*>\s*1048576|thumbnail:[^\n]*slice\(0,\s*131072\)/);
  assert.doesNotMatch(serverSource, /favorites:\s*list\.slice\(0,\s*500\)/, "local storage must not silently discard favorites after 500");
  assert.match(serverSource, /\["artifact","thumbnail"\]\.includes\(key\)/, "local summaries keep both artifacts and thumbnails out of the list payload");
  assert.match(serverSource, /url\.pathname==="\/api\/cloud\/favorites"[\s\S]*?readJson\(req,MAX_SHARED_CANVAS_BYTES\)/);
  assert.match(serverSource, /url\.pathname === "\/api\/favorites"[\s\S]*?readJson\(req, MAX_SHARED_CANVAS_BYTES\)/);
});

test("Cloud Connect refreshes views by interaction and keeps background watchers bounded", () => {
  assert.match(cloudScript, /function cloudDevicesUrl\(\) \{\s*return new URL\("\/dashboard\.html#devices", `\$\{cloudOrigin\(\)\}\/`\)\.toString\(\);/);
  assert.match(cloudScript, /cloudDevicesLink\(cloudT\("penechoDevices"\)\)/);
  assert.doesNotMatch(cloudScript, /Use a one-time code instead|Paste local sign-in code|Authorization code/);
  assert.doesNotMatch(cloudScript, /startCloudStatusWatch|CLOUD_STATUS_POLL_MS|cloudStatusPoll/);
  assert.match(cloudScript, /function render\(\)/);
  assert.match(cloudScript, /cloud-section-refresh-indicator/);
  assert.match(cloudScript, /projectRequestId:\s*0/);
  assert.match(cloudScript, /favoriteRequestId:\s*0/);
  assert.doesNotMatch(cloudScript, /refreshCurrentView|render\(\{ reload:true \}\)/);
  assert.match(cloudScript, /startBrowserSignInWatch/);
  assert.match(cloudScript, /DEVICE_CONNECTION_TIMEOUT_MS = 60_000/);
  assert.match(cloudScript, /DEVICE_CONNECTION_POLL_MS = 2_000/);
  assert.match(cloudScript, /function startDeviceConnectionWatch/);
  assert.match(cloudScript, /device\.connected \|\| !device\.configured \|\| !device\.enabled/);
  assert.match(cloudScript, /visibilitychange/);
  assert.match(cloudScript, /if \(seq !== statusRequestSeq\) return state\.status;/);
});

test("Cloud Center uses compact desktop controls and restores 44px coarse-pointer targets", () => {
  assert.match(cloudCss, /\.penecho-cloud-dialog \.cloud-dialog-close\s*\{[^}]*flex:\s*0 0 2\.25rem[^}]*min-width:\s*2\.25rem/);
  assert.match(cloudCss, /\.penecho-cloud-panel p a\s*\{[^}]*min-height:\s*2\.25rem/);
  assert.match(cloudCss, /\.cloud-project-web-link\s*\{[^}]*min-height:\s*2\.25rem/);
  assert.match(cloudCss, /\.cloud-account-button\s*\{[^}]*min-height:\s*2\.25rem[^}]*min-width:\s*2\.25rem/);
  assert.match(cloudCss, /\.cloud-section-tabs\s*\{[^}]*height:\s*2\.25rem/);
  assert.match(cloudCss, /\.cloud-section-tab\s*\{[^}]*height:\s*1\.875rem[^}]*min-height:\s*1\.875rem/);
  assert.match(cloudCss, /\.cloud-section-tab\.active\s*\{[^}]*background:\s*var\(--ai-accent-soft\)[^}]*border-color:\s*transparent[^}]*box-shadow:\s*none[^}]*color:\s*var\(--ai-accent\)/);
  assert.match(cloudCss, /\.penecho-cloud-dialog \.cloud-section-tab:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 var\(--ai-accent\)[^}]*outline:\s*none/);
  assert.match(cloudCss, /\.cloud-favorite-filters\s*\{[^}]*height:\s*2\.25rem/);
  assert.match(cloudCss, /\.cloud-favorite-filter\s*\{[^}]*height:\s*1\.875rem[^}]*min-height:\s*1\.875rem/);
  assert.match(cloudCss, /\.cloud-favorite-filter\.active\s*\{[^}]*background:\s*var\(--ai-accent-soft\)[^}]*color:\s*var\(--ai-accent\)[^}]*font-weight:\s*700/);
  assert.match(cloudCss, /\.cloud-compact-actions\s*\{[^}]*gap:\s*\.35rem[^}]*margin-top:\s*\.65rem/);
  assert.match(cloudCss, /\.cloud-compact-actions \.cloud-button\s*\{[^}]*font-size:\s*\.66rem[^}]*min-height:\s*2rem[^}]*white-space:\s*nowrap/);
  assert.match(cloudCss, /\.cloud-project-picker select, \.cloud-project-create-form input\s*\{[^}]*height:\s*2\.25rem[^}]*min-height:\s*2\.25rem/);
  assert.match(cloudCss, /\.cloud-project-create > summary\s*\{[^}]*min-height:\s*2\.25rem/);
  assert.match(cloudCss, /\.cloud-field input, \.cloud-field select\s*\{[^}]*height:\s*2\.25rem[^}]*min-height:\s*2\.25rem/);
  assert.match(cloudCss, /@media \(pointer: coarse\)[\s\S]*?\.cloud-account-button,[\s\S]*?\.penecho-cloud-panel p a \{ min-height: 2\.75rem; \}/);
  assert.match(cloudCss, /@media \(pointer: coarse\)[\s\S]*?\.cloud-field input,[\s\S]*?\.cloud-project-create-form input \{ height: 2\.75rem; min-height: 2\.75rem; \}/);
});

test("Cloud Center exposes accessible loading, error, and focus-preservation contracts", () => {
  assert.match(cloudScript, /class:"cloud-project-content", "aria-live":"polite", "aria-busy":"true"/);
  assert.match(cloudScript, /class:"cloud-library-list", "aria-live":"polite", "aria-busy":"true"/);
  assert.equal((cloudScript.match(/class:"cloud-message", role:"status"/g) || []).length, 3);
  assert.equal((cloudScript.match(/class:"cloud-message error", role:"alert"/g) || []).length, 2);
  assert.equal((cloudScript.match(/content\.setAttribute\("aria-busy", "false"\)/g) || []).length, 2);
  assert.match(cloudScript, /queueMicrotask\(\(\) => document\.querySelector\(`#cloud-tab-\$\{value\}`\)\?\.focus\(\)\)/);
  assert.match(cloudScript, /const shell = dialogShell[\s\S]*?render\(\);[\s\S]*?cloudButton\.setAttribute\("aria-busy", "true"\)/, "Cloud Center must render before its background status refresh");
});

test("Cloud Center keeps narrow layouts and theme contrast token-driven", () => {
  assert.match(cloudCss, /\.penecho-cloud-layout > \*, \.penecho-cloud-panel > \*, \.cloud-workspace > \*\s*\{\s*min-width:\s*0/);
  assert.match(cloudCss, /@media \(max-width:\s*760px\)[\s\S]*?\.penecho-cloud-layout\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(cloudCss, /@media \(max-width:\s*760px\)[\s\S]*?\.cloud-project-toolbar\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(cloudCss, /\.cloud-field input, \.cloud-field select, \.cloud-field textarea\s*\{\s*max-width:\s*100%;\s*min-width:\s*0/);
  assert.match(cloudCss, /--cloud-link:\s*var\(--ai-accent\)/);
  assert.match(cloudCss, /\.cloud-canvas-open\s*\{\s*color:\s*var\(--cloud-link\)/);
  assert.match(cloudCss, /\.cloud-project-web-link\s*\{[^}]*color:\s*var\(--cloud-link\)/);
  assert.match(cloudCss, /\.cloud-button\.primary:hover:not\(:disabled\), \.cloud-button\.primary:focus-visible\s*\{[^}]*color:\s*var\(--ai-primary-ink\)/);
  assert.match(cloudCss, /\.penecho-cloud-dialog\s*\{[^}]*color-scheme:\s*light[^}]*--ai-bg:\s*#ffffff/);
  assert.doesNotMatch(cloudCss, /body\[data-theme="(?:studio|research|arcane|scifi)"\] \.penecho-cloud-dialog/);
});

test("Cloud sign-in CTAs keep explicit foreground and background colors for hover and focus", () => {
  assert.match(cloudCss, /\.cloud-button\.primary:hover:not\(:disabled\), \.cloud-button\.primary:focus-visible\s*\{[^}]*background:\s*var\(--ai-primary-hover\)[^}]*color:\s*var\(--ai-primary-ink\)/);
});
