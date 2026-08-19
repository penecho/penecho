"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const cloudScript = fs.readFileSync(path.join(ROOT, "public", "cloud-connect.js"), "utf8");
const cloudCss = fs.readFileSync(path.join(ROOT, "public", "cloud-connect.css"), "utf8");

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

function boot({ status, cloudOrigin = "https://internaltest.penecho.ai", runtime, language = "en", communityItem, communityArtifact, library, communityFavorites = [], widgetFavorites = [], localFavoriteItems = [], serverDesktopApp = false, rendererDesktopBridge = false, publishItem, canvasShareArtifact, widgetShareArtifact, navigatorOverrides = {} } = {}) {
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
  document.getElementById = (id) => ({ cloudAccountBtn:cloudButton, shareCanvasBtn:shareButton })[id] || null;

  let statusPayload = status;
  let statusError = null;
  let stalePayload = null;
  let deferStatus = false;
  let releaseStale = null;
  let deferredAccountError = null;
  let releaseAccountError = null;
  const alerts = [];
  const fetchCalls = [];
  const windowListeners = new Map();
  const jsonResponse = (body) => ({ ok:true, status:200, json:async () => body });
  const fetch = (url, options = {}) => {
    const target = String(url);
    fetchCalls.push({ url:target, options });
    if (target === "/api/cloud/status") {
      if (statusError) return Promise.reject(statusError);
      if (deferStatus) return new Promise((resolve) => { releaseStale = () => resolve(jsonResponse(stalePayload)); });
      return Promise.resolve(jsonResponse(statusPayload));
    }
    if (target === "/api/cloud/account" && deferredAccountError) {
      return new Promise((resolve, reject) => { releaseAccountError = () => reject(deferredAccountError); });
    }
    if (target === "/api/cloud/account") return Promise.resolve(jsonResponse(statusPayload));
    if (target === "/api/cloud/sign-in/start") return Promise.resolve(jsonResponse({ authorizationUrl:`${cloudOrigin}/auth/local`, expiresAt:Date.now() + 60_000 }));
    if (target === "/api/cloud/library") return Promise.resolve(jsonResponse(library || { workspace:{}, projects:[], canvases:[], sync:{ bundleVersion:2, conflictPolicy:"base-revision-required" } }));
    if (target === "/api/favorites") return Promise.resolve(jsonResponse({ favorites:localFavoriteItems }));
    if (target === "/api/cloud/favorites") return Promise.resolve(jsonResponse({ favorites:widgetFavorites }));
    if (target.startsWith("/api/cloud/community?scope=favorites")) return Promise.resolve(jsonResponse({ items:communityFavorites }));
    if (target === "/api/cloud/community/share" && publishItem) return Promise.resolve(jsonResponse({ item:publishItem }));
    if (communityItem && target === `/api/cloud/community/${communityItem.id}/artifact`) return Promise.resolve(jsonResponse({ item:communityItem, artifact:communityArtifact }));
    if (communityItem && target === `/api/v1/community/items/${communityItem.id}`) return Promise.resolve(jsonResponse({ item:communityItem }));
    if (communityItem && target === `/api/v1/community/items/${communityItem.id}/view`) return Promise.resolve(jsonResponse(communityArtifact));
    return Promise.resolve({ ok:false, status:404, json:async () => ({ error:"not found" }) });
  };

  const imported = [];
  const opened = [];
  const openedLocal = [];
  const windowObject = {
    PENECHO_CONFIG:{ accessSessionToken:"test-session", cloudOrigin, cloudEnvironment:cloudOrigin.includes("internaltest") ? "uat" : "prod", desktopApp:serverDesktopApp, ...(runtime ? { runtime } : {}) },
    ...(rendererDesktopBridge ? { penechoDesktop:{} } : {}),
    PenEchoCommunityCanvas:{
      importWidget:async (artifact, item) => { imported.push({ kind:"widget", artifact, item }); },
      importCanvas:async (artifact, item) => { imported.push({ kind:"canvas", artifact, item }); },
      widgetArtifact:async () => widgetShareArtifact || ({ widget:{ id:"widget-1", title:"Widget" }, communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } }),
      canvasArtifact:async () => canvasShareArtifact || ({ name:"", communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } }),
      lineageForArtifact:() => null,
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
    window:windowObject, document, navigator:{ ...navigatorOverrides }, location:{ origin:"http://127.0.0.1:3888" },
    sessionStorage:{ getItem:() => null, setItem() {}, removeItem() {} },
    fetch, setTimeout:timers.setTimeout, clearTimeout:timers.clearTimeout, queueMicrotask,
    URL, Date, console, Blob, File:FakeFile, Image:FakeImage,
  };
  vm.runInNewContext(cloudScript, context, { filename:"public/cloud-connect.js" });
  const statusCalls = () => fetchCalls.filter((call) => call.url === "/api/cloud/status").length;
  return {
    document, cloudButton, shareButton, timers, fetchCalls, statusCalls, alerts, imported, opened, openedLocal, window:windowObject,
    overlay:() => document.querySelector(".penecho-cloud-overlay"),
    setStatus(next) { statusPayload = next; },
    setStatusError(error) { statusError = error; },
    freezeStale(next) { stalePayload = next; deferStatus = true; },
    releaseStale:() => releaseStale?.(),
    freezeAccountError(error) { deferredAccountError = error; },
    releaseAccountError:() => releaseAccountError?.(),
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

async function openCloudCenter(run) {
  run.cloudButton.click();
  await run.flush();
  const overlay = run.overlay();
  assert.ok(overlay?.isConnected, "expected the Cloud Center overlay to open");
  return overlay;
}

async function publishCraftFromShareDialog(run, kind) {
  if (kind === "canvas") run.shareButton.click();
  else await run.window.dispatch("penecho:community-widget-action", { detail:{ action:"share", widgetId:"widget-1" } });
  await run.flush();
  const overlay = run.overlay();
  assert.ok(overlay?.isConnected, `expected the ${kind} share dialog to open`);
  const controls = flatten(overlay);
  const category = controls.find((node) => node.tagName === "SELECT");
  category.value = "productivity";
  category.dispatch("change");
  const continuation = controls.find((node) => node.getAttribute("placeholder")?.includes("next Crafter"));
  continuation.value = "Continue with the next useful detail.";
  continuation.dispatch("input");
  for (const checkbox of controls.filter((node) => node.getAttribute("type") === "checkbox")) {
    checkbox.checked = true;
    checkbox.dispatch("change");
  }
  const publish = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Publish this stroke");
  assert.equal(publish?.disabled, false, "completed publication fields enable the publish action");
  publish.click();
  await run.flush();
  return overlay;
}

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

test("Cloud Center Link settings reuse the same Devices link once a device is configured", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const link = flatten(overlay).find((node) => node.tagName === "A" && node.textContent === "Cloud → Devices");
  assert.ok(link, "expected Link settings to reuse the Devices link");
  assert.equal(link.getAttribute("href"), "https://internaltest.penecho.ai/dashboard.html#devices");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener");
  assert.ok(overlay.textContent.includes("new pairing key from Cloud → Devices."));
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

test("Cloud Center re-renders from Connecting to Connected through the status watcher without reopening", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);
  assert.ok(overlay.textContent.includes("My PenEcho · Connecting"));

  run.setStatus(deviceStatus({ connected:true, state:"connected" }));
  await run.timers.advance(1500); // one watcher interval, no reload, no reopen
  assert.equal(run.overlay(), overlay, "overlay must stay the same instance");
  assert.ok(overlay.textContent.includes("My PenEcho · Connected"));
  assert.ok(!overlay.textContent.includes("· Connecting"));
  assert.equal(run.cloudButton.dataset.state, "connected");
});

test("Cloud Center closes only when the status watcher observes a signed-out to signed-in transition", async () => {
  const run = boot({ status:signedOutStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);

  run.setStatus(signedOutStatus({ configured:true, enabled:true, connected:true, state:"connected", id:"dev-1", name:"My PenEcho" }));
  await run.timers.advance(1500);
  assert.equal(run.overlay(), overlay, "linking a device without an account session must not close Cloud Center");

  run.setStatus(deviceStatus({ connected:true, state:"connected" }));
  await run.timers.advance(1500);
  assert.equal(run.overlay(), null, "the first confirmed signed-in status closes Cloud Center");
  assert.equal(run.cloudButton.getAttribute("aria-expanded"), "false");
});

test("Cloud Center stays open when it was manually opened for an account that was already signed in", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);

  await run.timers.advance(1500);
  assert.equal(run.overlay(), overlay, "an existing signed-in session is not a new login completion");
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

test("Cloud Center refreshes immediately when the page becomes visible again", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const callsAfterOpen = run.statusCalls();

  run.document.visibilityState = "hidden";
  run.setStatus({ ...deviceStatus({ connected:true, state:"connected" }), account:{ name:"Test User", credits:42 } });
  run.document.dispatch("visibilitychange"); // ignored while hidden
  await run.timers.advance(200); // not enough for the hidden-tab interval
  assert.equal(run.statusCalls(), callsAfterOpen);
  assert.ok(!overlay.textContent.includes("42 credits"));

  run.document.visibilityState = "visible";
  run.document.dispatch("visibilitychange");
  assert.equal(run.statusCalls(), callsAfterOpen + 1, "returning to visible must poll immediately");
  await run.flush();
  assert.ok(overlay.textContent.includes("42 credits"));
  assert.ok(overlay.textContent.includes("My PenEcho · Connected"));
  assert.equal(run.timers.count(), 1, "the watcher keeps a single pending timer");
});

test("Cloud Center stops the status watcher when the overlay closes", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  await openCloudCenter(run);
  assert.equal(run.timers.count(), 1, "expected one pending watcher timer while open");

  const close = flatten(run.overlay()).find((node) => node.getAttribute("aria-label") === "Close");
  close.click();
  assert.equal(run.overlay(), null);
  assert.equal(run.timers.count(), 0, "closing must clear the watcher timer");

  const callsAtClose = run.statusCalls();
  await run.timers.advance(30_000);
  run.document.visibilityState = "visible";
  run.document.dispatch("visibilitychange");
  await run.flush();
  assert.equal(run.statusCalls(), callsAtClose, "no polling happens after the overlay closes");
});

test("Cloud Center never runs concurrent polls and a stale response cannot overwrite newer status", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const callsAfterOpen = run.statusCalls();

  run.freezeStale(deviceStatus()); // the next /api/cloud/status response stays pending until released
  run.timers.fire(1500); // start a watcher poll that hangs on the deferred response
  assert.equal(run.statusCalls(), callsAfterOpen + 1);

  run.document.dispatch("visibilitychange"); // must not start a second concurrent poll
  assert.equal(run.statusCalls(), callsAfterOpen + 1, "the in-flight poll blocks a concurrent one");

  run.setStatus(deviceStatus({ connected:true, state:"connected" }));
  const refresh = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Refresh account");
  refresh.click(); // a newer, faster request completes while the poll is still pending
  await run.flush();
  assert.ok(overlay.textContent.includes("My PenEcho · Connected"));
  assert.equal(run.cloudButton.dataset.state, "connected");

  run.releaseStale(); // the stale "connecting" response arrives last and must be dropped
  await run.flush();
  assert.equal(run.cloudButton.dataset.state, "connected");
  assert.equal(run.cloudButton.title, "PenEcho Cloud · Device linked");
  assert.ok(overlay.textContent.includes("My PenEcho · Connected"));
  assert.ok(!overlay.textContent.includes("· Connecting"));
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
  await run.timers.advance(1500);
  assert.ok(overlay.textContent.includes("My PenEcho · Connected"));
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
  await run.timers.advance(1500);
  assert.equal(run.cloudButton.dataset.state, "signed-in", "a failed poll cannot imply sign-out");

  const favorites = flatten(overlay).find((node) => node.getAttribute("role") === "tab" && node.textContent === "Favorites");
  favorites.click();
  await run.flush();
  assert.ok(flatten(overlay).some((node) => node.tagName === "BUTTON" && node.textContent === "Add to this Canvas"));
  assert.ok(!overlay.textContent.includes("Sign in to view favorites"));
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
  assert.deepEqual(flatten(overlay).filter((node) => node.className?.split?.(/\s+/).includes("cloud-favorite-filter")).map((node) => node.textContent), ["All", "Canvases", "Widgets"]);
  flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Open Canvas").click();
  await run.flush();
  assert.deepEqual(run.imported, [{ kind:"canvas", artifact:canvasArtifact, item:canvas }]);
  assert.deepEqual(run.opened, []);
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

test("published Canvas shares a generated image and exact public Craft URL through the browser share sheet", async () => {
  const item = { id:"123e4567-e89b-42d3-a456-426614174021", kind:"canvas", name:"Roadmap", shareUrl:"/community/123e4567-e89b-42d3-a456-426614174021" };
  const shareCalls = [];
  const run = boot({
    status:deviceStatus(),
    publishItem:item,
    canvasShareArtifact:{ name:"Roadmap", communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } },
    navigatorOverrides:{ canShare:({ files }) => files?.[0]?.type === "image/png", share:async (payload) => { shareCalls.push(payload); } },
  });
  await run.flush();
  const overlay = await publishCraftFromShareDialog(run, "canvas");
  const imageShare = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Share as image");
  assert.ok(imageShare, "image sharing is an explicit post-publish action");

  imageShare.click();
  await run.flush();

  const publicUrl = "https://internaltest.penecho.ai/community/123e4567-e89b-42d3-a456-426614174021";
  assert.equal(shareCalls.length, 1);
  assert.equal(shareCalls[0].url, publicUrl);
  assert.equal(shareCalls[0].files[0].type, "image/png");
  assert.equal(shareCalls[0].files[0].name, "penecho-canvas-Roadmap.png");
  const card = run.document.createdElements.find((node) => node instanceof FakeCanvasElement);
  assert.ok(card.drawnImages.length, "the validated WebP preview is drawn into the share card");
  assert.ok(card.drawnImages.some(([image]) => image.src === "/penecho-mark.png"), "the official PenEcho mark is drawn into the Canvas card");
  for (const label of ["PenEcho", "ECHOES", "Echo", "CC BY-SA 4.0 · Source and attribution:"]) {
    assert.ok(card.drawnText.some(({ value }) => value === label), `the Canvas card includes ${label}`);
  }
  assert.ok(card.drawnText.some(({ value }) => value === publicUrl), "the image itself includes the exact resolvable public link");
  assert.ok(overlay.textContent.includes("Image shared."));
});

test("published image sharing exposes busy state, prevents duplicate actions, and recovers from share-sheet errors", async () => {
  const item = { id:"123e4567-e89b-42d3-a456-426614174023", kind:"canvas", name:"Launch plan" };
  let rejectShare;
  const run = boot({
    status:deviceStatus(),
    publishItem:item,
    navigatorOverrides:{
      canShare:() => true,
      share:() => new Promise((resolve, reject) => { rejectShare = reject; }),
    },
  });
  await run.flush();
  const overlay = await publishCraftFromShareDialog(run, "canvas");
  const imageShare = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Share as image");
  const download = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "Download image");
  const tools = flatten(overlay).find((node) => node.className === "cloud-published-share-tools");

  imageShare.click();
  assert.equal(tools.getAttribute("aria-busy"), "true");
  assert.equal(imageShare.disabled, true);
  assert.equal(download.disabled, true);
  assert.ok(overlay.textContent.includes("Preparing share image…"));
  await run.flush();
  rejectShare(new Error("platform-specific, unlocalized failure"));
  await run.flush();

  assert.equal(tools.getAttribute("aria-busy"), "false");
  assert.equal(imageShare.disabled, false);
  assert.equal(download.disabled, false);
  assert.ok(overlay.textContent.includes("Could not prepare the share image."));
  assert.doesNotMatch(overlay.textContent, /platform-specific, unlocalized failure/);
});

test("published Widget offers bilingual image sharing and downloads when native file sharing is unavailable", async () => {
  const item = { id:"123e4567-e89b-42d3-a456-426614174022", kind:"widget", name:"计时器" };
  const run = boot({
    status:deviceStatus(),
    language:"zh-CN",
    publishItem:item,
    widgetShareArtifact:{ widget:{ id:"widget-1", title:"计时器" }, communityPreview:{ contentType:"image/webp", dataBase64:"AA==", width:800, height:500 } },
  });
  await run.flush();
  await run.window.dispatch("penecho:community-widget-action", { detail:{ action:"share", widgetId:"widget-1" } });
  await run.flush();
  const overlay = run.overlay(), controls = flatten(overlay);
  const category = controls.find((node) => node.tagName === "SELECT");
  category.value = "productivity";
  category.dispatch("change");
  const continuation = controls.find((node) => node.getAttribute("placeholder")?.includes("下一位创作者"));
  continuation.value = "继续完善提醒。";
  continuation.dispatch("input");
  for (const checkbox of controls.filter((node) => node.getAttribute("type") === "checkbox")) {
    checkbox.checked = true;
    checkbox.dispatch("change");
  }
  flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "发布此笔触").click();
  await run.flush();

  const imageShare = flatten(overlay).find((node) => node.tagName === "BUTTON" && node.textContent === "分享为图片");
  assert.ok(imageShare);
  assert.ok(overlay.textContent.includes("下载图片"), "the explicit download fallback stays available");
  imageShare.click();
  await run.flush();

  const download = run.document.createdElements.find((node) => node.tagName === "A" && node.download === "penecho-widget-计时器.png");
  assert.ok(download, "unsupported native file sharing falls back to a PNG download");
  assert.match(download.href, /^blob:/);
  assert.ok(overlay.textContent.includes("图片已下载"));
  const card = run.document.createdElements.find((node) => node instanceof FakeCanvasElement);
  assert.ok(card.drawnImages.some(([image]) => image.src === "/penecho-mark.png"), "the official PenEcho mark is drawn into the Widget card");
  for (const label of ["PenEcho", "ECHOES", "Echo", "CC BY-SA 4.0 · 来源与署名："]) {
    assert.ok(card.drawnText.some(({ value }) => value === label), `the Widget card includes ${label}`);
  }
  assert.ok(card.drawnText.some(({ value }) => value === "组件"), "the Widget card uses the localized kind label");
  assert.ok(card.drawnText.some(({ value }) => value === "https://internaltest.penecho.ai/community/123e4567-e89b-42d3-a456-426614174022"));
});

test("share and widget-favorite flows do not embed user-facing English outside Cloud copy", () => {
  const shareSource = cloudScript.slice(cloudScript.indexOf("function shareDialog"), cloudScript.indexOf("async function takeFurther"));
  const favoriteSource = cloudScript.slice(cloudScript.indexOf("async function toggleWidgetFavorite"), cloudScript.indexOf("async function syncFavorites"));
  assert.doesNotMatch(shareSource, /Preserve this moment|Generating preview|Use no more than 8 tags|Enter a name before publishing|Craft published safely|Copy link|Preview ready\.|Could not generate the preview/);
  assert.doesNotMatch(favoriteSource, /This PenEcho version does not support widget favorites|"Untitled Widget"/);
  assert.match(shareSource, /CATEGORIES\.map\(value => el\("option", \{ value, text:cloudT\(CATEGORY_LABEL_KEYS\[value\]\) \}\)\)/);
  assert.match(favoriteSource, /throw new Error\(cloudT\("favoriteUnsupported"\)\)/);
});

test("Cloud Connect source keeps the reviewed status watch contract", () => {
  assert.match(cloudScript, /function cloudDevicesUrl\(\) \{\s*return new URL\("\/dashboard\.html#devices", `\$\{cloudOrigin\(\)\}\/`\)\.toString\(\);/);
  assert.match(cloudScript, /cloudDevicesLink\(cloudT\("penechoDevices"\)\)/);
  assert.doesNotMatch(cloudScript, /Use a one-time code instead|Paste local sign-in code|Authorization code/);
  assert.match(cloudScript, /startCloudStatusWatch\(shell\.overlay, render\)/);
  assert.match(cloudScript, /CLOUD_STATUS_POLL_MS = 1500/);
  assert.match(cloudScript, /if \(current !== previous\)/);
  assert.match(cloudScript, /visibilitychange/);
  assert.match(cloudScript, /if \(seq !== statusRequestSeq\) return state\.status;/);
});

test("Cloud Center keeps navigation, forms, filters, and inline links at least 44px", () => {
  assert.match(cloudCss, /\.penecho-cloud-dialog \.cloud-dialog-close\s*\{[^}]*flex:\s*0 0 2\.75rem[^}]*min-width:\s*2\.75rem/);
  assert.match(cloudCss, /\.penecho-cloud-panel p a\s*\{[^}]*min-height:\s*2\.75rem/);
  assert.match(cloudCss, /\.cloud-project-web-link\s*\{[^}]*min-height:\s*2\.75rem/);
  assert.match(cloudCss, /\.cloud-account-button\s*\{[^}]*min-height:\s*2\.75rem[^}]*min-width:\s*2\.75rem/);
  assert.match(cloudCss, /\.cloud-favorite-filter\s*\{[^}]*min-height:\s*2\.75rem/);
  assert.match(cloudCss, /\.cloud-secondary-settings summary\s*\{[^}]*min-height:\s*2\.75rem/);
  assert.match(cloudCss, /\.cloud-project-picker select, \.cloud-project-create-form input\s*\{[^}]*min-height:\s*2\.75rem/);
  assert.match(cloudCss, /\.cloud-project-create > summary\s*\{[^}]*min-height:\s*2\.75rem/);
  assert.match(cloudCss, /\.cloud-field input, \.cloud-field select\s*\{\s*min-height:\s*2\.75rem/);
});

test("Cloud Center exposes accessible loading, error, and focus-preservation contracts", () => {
  assert.match(cloudScript, /class:"cloud-project-content", "aria-live":"polite", "aria-busy":"true"/);
  assert.match(cloudScript, /class:"cloud-library-list", "aria-live":"polite", "aria-busy":"true"/);
  assert.equal((cloudScript.match(/class:"cloud-message", role:"status"/g) || []).length, 2);
  assert.equal((cloudScript.match(/class:"cloud-message error", role:"alert"/g) || []).length, 2);
  assert.equal((cloudScript.match(/content\.setAttribute\("aria-busy", "false"\)/g) || []).length, 2);
  assert.match(cloudScript, /queueMicrotask\(\(\) => document\.querySelector\(`#cloud-tab-\$\{value\}`\)\?\.focus\(\)\)/);
  assert.match(cloudScript, /cloudButton\.setAttribute\("aria-busy", "true"\)[\s\S]*?cloudButton\.disabled = true[\s\S]*?cloudButton\.setAttribute\("aria-busy", "false"\)/);
});

test("Cloud Center keeps narrow layouts and theme contrast token-driven", () => {
  assert.match(cloudCss, /\.penecho-cloud-layout > \*, \.penecho-cloud-panel > \*, \.cloud-workspace > \*\s*\{\s*min-width:\s*0/);
  assert.match(cloudCss, /@media \(max-width:\s*760px\)[\s\S]*?\.penecho-cloud-layout\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(cloudCss, /@media \(max-width:\s*760px\)[\s\S]*?\.cloud-project-toolbar\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(cloudCss, /\.cloud-field input, \.cloud-field select, \.cloud-field textarea\s*\{\s*max-width:\s*100%;\s*min-width:\s*0/);
  assert.match(cloudCss, /--cloud-link:\s*color-mix\(in srgb, var\(--ink/);
  assert.match(cloudCss, /\.cloud-canvas-open\s*\{\s*color:\s*var\(--cloud-link\)/);
  assert.match(cloudCss, /\.cloud-project-web-link\s*\{[^}]*color:\s*var\(--cloud-link\)/);
  assert.match(cloudCss, /\.cloud-button\.primary:hover:not\(:disabled\), \.cloud-button\.primary:focus-visible\s*\{[^}]*color:\s*#fff/);
});

test("Cloud sign-in CTAs keep explicit foreground and background colors for hover and focus", () => {
  assert.match(cloudCss, /\.cloud-button\.primary:hover:not\(:disabled\), \.cloud-button\.primary:focus-visible\s*\{[^}]*background:\s*#285a9d[^}]*color:\s*#fff/);
});
