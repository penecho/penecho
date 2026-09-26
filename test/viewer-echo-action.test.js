"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const viewerSource = fs.readFileSync(path.join(root, "public/viewer.js"), "utf8");
const itemId = "123e4567-e89b-12d3-a456-426614174000";
const authHref = `/auth.html?returnTo=${encodeURIComponent(`/canvas/community/${itemId}`)}`;
const canvasHref = `/canvas/community/${itemId}`;

class MockElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.dataset = Object.create(null);
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.id = "";
    this.type = "";
    this.href = "";
    this.title = "";
    this.textContent = "";
    this.innerHTML = "";
    this._classNames = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this._classNames.add(name)),
      remove: (...names) => names.forEach((name) => this._classNames.delete(name)),
      contains: (name) => this._classNames.has(name),
      toggle: (name, force) => {
        const shouldAdd = force === undefined ? !this._classNames.has(name) : Boolean(force);
        if (shouldAdd) this._classNames.add(name);
        else this._classNames.delete(name);
        return shouldAdd;
      },
    };
  }

  get className() {
    return [...this._classNames].join(" ");
  }

  set className(value) {
    this._classNames = new Set(String(value || "").split(/\s+/).filter(Boolean));
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      if (typeof node === "string") {
        this.textContent += node;
        continue;
      }
      node.parentElement = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "id") this.id = stringValue;
    if (name === "class") this.className = stringValue;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }

  click() {
    this.dispatchEvent({ type: "click", target: this, currentTarget: this });
  }

  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (typeof child === "string") continue;
      if (child.matches(selector)) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
}

class MockDocument {
  constructor() {
    this.documentElement = new MockElement("html", this);
    this.body = new MockElement("body", this);
    this.main = new MockElement("main", this);
    this.handTool = new MockElement("button", this);
    this.handTool.id = "handToolBtn";
    this.main.append(this.handTool);
    this.body.append(this.main);
    this.documentElement.append(this.body);
  }

  createElement(tagName) {
    return new MockElement(tagName, this);
  }

  createElementNS(_namespace, tagName) {
    return this.createElement(tagName);
  }

  querySelector(selector) {
    if (this.documentElement.matches(selector)) return this.documentElement;
    return this.documentElement.querySelector(selector);
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
}

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  };
}

function createHarness({ session = "anonymous", artifact = "ok", language = "en", live = false, payload = null, copyStatus = 200 } = {}) {
  const document = new MockDocument();
  document.cookie = "penecho_csrf=test-csrf";
  const requests = [], viewed = [];
  const eventListeners = new Map();
  let currentLanguage = language;
  let resolveSession;
  let resolveArtifact;

  const sessionResponse = session === "signed-in"
    ? response(200, { account: { id: "account-1", name: "Astra" } })
    : response(200, { account: null });
  const artifactResponse = artifact === "forbidden"
    ? response(403)
    : artifact === "failure" ? response(503)
    : artifact === "unavailable" ? response(404)
    : response(200, payload || { format: "penecho-canvas", items: [] });

  function fetch(url, options) {
    requests.push({ url, options });
    if (url.endsWith("/copy")) return Promise.resolve(response(copyStatus, {url:"/canvas/copied",message:"The service could not complete the request."}));
    if (url === "/api/v1/auth/session") {
      if (session === "failure") return Promise.reject(new Error("session unavailable"));
      if (session === "pending") return new Promise((resolve) => { resolveSession = resolve; });
      return Promise.resolve(sessionResponse);
    }
    if (artifact === "pending") return new Promise((resolve) => { resolveArtifact = resolve; });
    return Promise.resolve(artifactResponse);
  }

  const window = {
    PenEchoI18n: { currentLanguage: () => "zh" },
    PenEchoCommunityCanvas: {
      viewCanvas: async artifact => {viewed.push(artifact);},
      importWidget: async () => {},
    },
    addEventListener(type, listener) {
      const listeners = eventListeners.get(type) || [];
      listeners.push(listener);
      eventListeners.set(type, listeners);
    },
    dispatchEvent(event) {
      for (const listener of eventListeners.get(event.type) || []) listener.call(window, event);
    },
  };
  window.window = window;

  const context = {
    document,
    window,
    location: { pathname: `/canvas/${live ? "share" : "view"}/${itemId}`, search:"" },
    URLSearchParams,
    navigator: { language: "en-US" },
    localStorage: { getItem: key => key === "penecho-site-language" ? currentLanguage : "zh" },
    fetch,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(viewerSource, context, { filename: "public/viewer.js" });

  return {
    document,
    requests, viewed,
    resolveSession: (value = sessionResponse) => resolveSession?.(value),
    resolveArtifact: (value = artifactResponse) => resolveArtifact?.(value),
    setLanguage(value) { currentLanguage = value; },
    dispatchLanguageChange() { window.dispatchEvent({ type: "penecho:languagechange" }); },
    async settle() {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function viewerActions(harness) {
  return harness.document.querySelector(".viewer-actions").children;
}

function primaryAction(harness) {
  const primary = [...viewerActions(harness)].find((child) => child.classList.contains("viewer-primary"));
  assert.ok(primary, "the Echo action should be rendered");
  return primary;
}

function accountAction(harness) {
  const account = [...viewerActions(harness)].find((child) => child.classList.contains("viewer-account-action"));
  assert.ok(account, "the account action should be rendered");
  return account;
}

test("Echo is visible with the sign-in return route during initialization, anonymous sessions, and session failures", async () => {
  const cases = [
    { name: "initialization", session: "pending", artifact: "pending" },
    { name: "anonymous", session: "anonymous", artifact: "pending" },
    { name: "session failure", session: "failure", artifact: "pending" },
  ];

  for (const scenario of cases) {
    const harness = createHarness(scenario);
    assert.equal(primaryAction(harness).href, authHref, `${scenario.name}: Echo should use the sign-in return route`);

    if (scenario.session === "pending") harness.resolveSession(response(200, { account: null }));
    if (scenario.artifact === "pending") harness.resolveArtifact(response(200, { format: "penecho-canvas", items: [] }));
    await harness.settle();

    assert.equal(primaryAction(harness).href, authHref, `${scenario.name}: Echo should remain on the sign-in return route`);
  }
});

test("a signed-in Echo goes directly to the community Canvas and keeps the account entry without a device query", async () => {
  const harness = createHarness({ session: "signed-in" });
  await harness.settle();

  assert.equal(primaryAction(harness).href, canvasHref);
  assert.equal(accountAction(harness).href, "/dashboard.html#community");
  assert.equal(accountAction(harness).children[0].textContent, "Astra");
  assert.equal(harness.requests.some(({ url }) => url === "/api/v1/devices"), false);
});

test("the signed-in Echo entry remains available while a 403 response shows the preview", async () => {
  const harness = createHarness({ session: "signed-in", artifact: "forbidden" });
  await harness.settle();

  assert.equal(primaryAction(harness).href, canvasHref);
  assert.ok(accountAction(harness));
  const status = harness.document.querySelector(".viewer-status");
  assert.equal(status.hidden, false);
  assert.equal(status.dataset.copyKey, "previewOnly");
});

test("language changes preserve the Echo route", async () => {
  const harness = createHarness({ session: "anonymous" });
  await harness.settle();
  assert.equal(primaryAction(harness).href, authHref);

  harness.setLanguage("zh");
  harness.dispatchLanguageChange();

  assert.equal(primaryAction(harness).href, authHref);
  assert.equal(primaryAction(harness).children[0].textContent, "Echo");
});

test("live Canvas viewer unwraps bundle payloads and retains login return route", async () => {
  const bundle={bundleVersion:2,formatVersion:1,mode:"snapshot",manifest:{},assets:[]};
  const run=createHarness({live:true,payload:{artifact:bundle}});
  await run.settle();
  const brand = run.document.querySelector(".viewer-brand");
  assert.ok(run.document.documentElement.classList.contains("viewer-live-share"));
  assert.equal(brand.href, "/?public=1");
  assert.equal(brand.getAttribute("aria-label"), "PenEcho home");
  assert.equal(run.viewed[0],bundle);
  assert.equal(primaryAction(run).children[0].textContent,"Edit in my space");
  assert.match(primaryAction(run).href,/returnTo=.*share.*edit/);
  assert.ok(run.requests.some(r=>r.url===`/api/v1/shares/${itemId}`&&r.options.cache==="no-store"));
});


test("live copy sends explicit JSON and preserves the view after a failed request", async () => {
  const run = createHarness({live:true,session:"signed-in",copyStatus:415,language:"zh"});
  await run.settle();
  primaryAction(run).dispatchEvent({type:"click",preventDefault(){}});
  await run.settle();
  const request = run.requests.find(r => r.url.endsWith("/copy"));
  assert.equal(request.options.headers["content-type"], "application/json");
  assert.equal(request.options.headers["x-penecho-csrf"], "test-csrf");
  assert.deepEqual(JSON.parse(request.options.body), {});
  assert.equal(run.document.querySelector(".viewer-status").hidden, true);
  assert.equal(run.document.querySelector(".viewer-copy-error").textContent, "暂时无法保存到你的空间，请重试。");
  assert.ok(primaryAction(run));
});


test("anonymous viewers default to English despite Chinese Canvas and site preferences", async () => {
  const run = createHarness({live:true,language:"zh"});
  await run.settle();
  assert.equal(primaryAction(run).children[0].textContent,"Edit in my space");
  assert.equal(run.document.documentElement.lang,"en");
});

test("signed-in viewers follow the Dashboard preference instead of the Canvas preference", async () => {
  const run = createHarness({live:true,session:"signed-in",language:"en"});
  await run.settle();
  assert.equal(primaryAction(run).children[0].textContent,"Edit in my space");
  run.setLanguage("zh");
  run.dispatchLanguageChange();
  assert.equal(primaryAction(run).children[0].textContent,"在我的空间编辑");
  assert.equal(run.document.documentElement.lang,"zh");
});

test("a live-share account stays identifiable and links to the user's space", async () => {
  const run = createHarness({live:true, session:"signed-in"});
  await run.settle();
  assert.equal(viewerActions(run)[0], accountAction(run));
  assert.equal(accountAction(run).children[0].textContent, "A");
  assert.equal(accountAction(run).getAttribute("aria-label"), "Astra · Open console");
  assert.equal(accountAction(run).href, "/dashboard.html#projects");
  assert.equal(primaryAction(run).title, "Save a copy to your space and edit it");
});

test("transient share failures offer retry while revoked shares remain unavailable", async () => {
  const failed = createHarness({live:true, artifact:"failure"});
  await failed.settle();
  assert.equal(failed.document.querySelector(".viewer-status").dataset.copyKey, "failed");
  assert.equal(failed.document.querySelector(".viewer-retry").textContent, "Try again");
  assert.equal(viewerActions(failed).length, 0);
  const unavailable = createHarness({live:true, artifact:"unavailable"});
  await unavailable.settle();
  assert.equal(unavailable.document.querySelector(".viewer-status").dataset.copyKey, "unavailable");
  assert.equal(unavailable.document.querySelector(".viewer-retry"), null);
  assert.equal(viewerActions(unavailable).length, 0);
});
