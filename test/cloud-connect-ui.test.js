"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const cloudScript = fs.readFileSync(path.join(ROOT, "public", "cloud-connect.js"), "utf8");

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

function boot({ status, cloudOrigin = "https://internaltest.penecho.ai" } = {}) {
  const timers = makeTimers();
  const documentListeners = new Map();
  const document = {
    documentElement:{ lang:"en" },
    activeElement:null,
    visibilityState:"visible",
    cookie:"",
    listeners:documentListeners,
  };
  document.body = new FakeElement("body", document);
  document.createElement = (tag) => new FakeElement(tag, document);
  document.createTextNode = (text) => ({ textContent:String(text) });
  document.querySelector = (selector) => queryAll(document.body, selector)[0] || null;
  document.querySelectorAll = (selector) => queryAll(document.body, selector);
  document.addEventListener = (type, handler) => {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(handler);
  };
  document.dispatch = (type) => { for (const handler of documentListeners.get(type) || []) handler({ type }); };

  const label = new FakeElement("span", document);
  label.className = "cloud-account-label";
  const cloudButton = new FakeElement("button", document);
  cloudButton.append(label);
  const shareButton = new FakeElement("button", document);
  document.getElementById = (id) => ({ cloudAccountBtn:cloudButton, shareCanvasBtn:shareButton })[id] || null;

  let statusPayload = status;
  let stalePayload = null;
  let deferStatus = false;
  let releaseStale = null;
  let deferredAccountError = null;
  let releaseAccountError = null;
  const alerts = [];
  const fetchCalls = [];
  const jsonResponse = (body) => ({ ok:true, status:200, json:async () => body });
  const fetch = (url, options = {}) => {
    const target = String(url);
    fetchCalls.push({ url:target, options });
    if (target === "/api/cloud/status") {
      if (deferStatus) return new Promise((resolve) => { releaseStale = () => resolve(jsonResponse(stalePayload)); });
      return Promise.resolve(jsonResponse(statusPayload));
    }
    if (target === "/api/cloud/account" && deferredAccountError) {
      return new Promise((resolve, reject) => { releaseAccountError = () => reject(deferredAccountError); });
    }
    if (target === "/api/cloud/account") return Promise.resolve(jsonResponse(statusPayload));
    if (target === "/api/cloud/library") return Promise.resolve(jsonResponse({ workspace:{}, projects:[], canvases:[], sync:{ bundleVersion:2, conflictPolicy:"base-revision-required" } }));
    return Promise.resolve({ ok:false, status:404, json:async () => ({ error:"not found" }) });
  };

  const windowObject = {
    PENECHO_CONFIG:{ accessSessionToken:"test-session", cloudOrigin, cloudEnvironment:cloudOrigin.includes("internaltest") ? "uat" : "prod" },
    addEventListener() {},
    open() { return null; },
    confirm() { return true; },
    alert(message) { alerts.push(String(message)); },
  };
  const context = {
    window:windowObject, document, navigator:{}, location:{ origin:"http://127.0.0.1:3888" },
    sessionStorage:{ getItem:() => null, setItem() {}, removeItem() {} },
    fetch, setTimeout:timers.setTimeout, clearTimeout:timers.clearTimeout, queueMicrotask,
    URL, Date, console,
  };
  vm.runInNewContext(cloudScript, context, { filename:"public/cloud-connect.js" });
  const statusCalls = () => fetchCalls.filter((call) => call.url === "/api/cloud/status").length;
  return {
    document, cloudButton, timers, fetchCalls, statusCalls, alerts,
    overlay:() => document.querySelector(".penecho-cloud-overlay"),
    setStatus(next) { statusPayload = next; },
    freezeStale(next) { stalePayload = next; deferStatus = true; },
    releaseStale:() => releaseStale?.(),
    freezeAccountError(error) { deferredAccountError = error; },
    releaseAccountError:() => releaseAccountError?.(),
    async flush(rounds = 10) { for (let index = 0; index < rounds; index++) await new Promise((resolve) => setImmediate(resolve)); },
  };
}

async function openCloudCenter(run) {
  run.cloudButton.click();
  await run.flush();
  const overlay = run.overlay();
  assert.ok(overlay?.isConnected, "expected the Cloud Center overlay to open");
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

test("Cloud Center sections link to Craft Commons on the configured cloud origin", async () => {
  const run = boot({ status:deviceStatus() });
  await run.flush();
  const overlay = await openCloudCenter(run);
  const tab = flatten(overlay).find((node) => node.tagName === "A" && node.className === "cloud-section-tab");
  assert.ok(tab, "expected the community section tab");
  assert.equal(tab.getAttribute("href"), "https://internaltest.penecho.ai/community.html");
  assert.equal(tab.getAttribute("target"), "_blank");
  assert.equal(tab.getAttribute("rel"), "noopener");
  assert.ok(tab.textContent.includes("Craft Commons ↗"));
  assert.ok(!tab.textContent.includes("Explore"));
});

test("Cloud Connect source keeps the reviewed status watch contract", () => {
  assert.match(cloudScript, /function cloudDevicesUrl\(\) \{\s*return new URL\("\/dashboard\.html#devices", `\$\{cloudOrigin\(\)\}\/`\)\.toString\(\);/);
  assert.match(cloudScript, /cloudDevicesLink\("PenEcho Cloud → Devices"\)/);
  assert.match(cloudScript, /startCloudStatusWatch\(shell\.overlay, render\)/);
  assert.match(cloudScript, /CLOUD_STATUS_POLL_MS = 1500/);
  assert.match(cloudScript, /if \(current !== previous\)/);
  assert.match(cloudScript, /visibilitychange/);
  assert.match(cloudScript, /if \(seq !== statusRequestSeq\) return state\.status;/);
});
