"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve)); };

function extractCoreBlockFn(source, name) {
  const re = new RegExp(`(?:async )?function ${name}\\([^\\n]*\\n[\\s\\S]*?\\n  \\}`);
  const m = source.match(re);
  assert.ok(m, `missing function ${name}`);
  return m[0];
}

function bootStudioShell({ narrow = false, guest = false, overflowSubmenu = false } = {}) {
  const html = read("public/index.html");
  const script = read("public/studio-shell.js");
  const { document, window } = parseHTML(html);
  document.body.dataset.theme = "studio";
  if (guest) document.documentElement.dataset.penechoGuestAi = "true";

  class KeyboardEvent extends window.Event {
    constructor(type, init = {}) { super(type, init); this.key = init.key || ""; }
  }
  let focused = document.body;
  Object.defineProperty(document, "activeElement", { get: () => focused?.isConnected ? focused : document.body });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  window.innerWidth = narrow ? 390 : 1280;
  window.innerHeight = narrow ? 844 : 900;

  const events = [];
  window.addEventListener("penecho:more-opening", () => events.push("more-opening"));
  window.addEventListener("penecho:share-opening", () => events.push("share-opening"));

  for (const panel of document.querySelectorAll('[data-more-submenu]')) {
    panel.getBoundingClientRect = () => ({ width:210, height:80 });
  }
  const moreMenuEl = document.querySelector("#canvasMoreMenu");
  if (moreMenuEl && overflowSubmenu) {
    moreMenuEl.getBoundingClientRect = () => ({ left: 1020, right: 1200, top: 60, bottom: 260, width: 180, height: 200 });
  }

  class ResizeObserverStub { observe() {} disconnect() {} }
  class MutationObserverStub {
    constructor(cb) { this.cb = cb; observerInstances.push({ cb, targets: [] }); }
    observe(target) { observerInstances[observerInstances.length - 1].targets.push(target); }
    disconnect() {}
  }
  const observerInstances = [];
  const context = vm.createContext({
    window,
    document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    KeyboardEvent,
    CSS: { escape: (s) => String(s).replace(/[^\w-]/g, "\\$&") },
    ResizeObserver: ResizeObserverStub,
    MutationObserver: MutationObserverStub,
    matchMedia: (q) => ({
      matches: q.includes("max-width: 740px") || q.includes("max-width: 700px") ? narrow : false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (fn) => { const t = setTimeout(() => fn(Date.now()), 0); t.unref?.(); return t; },
    queueMicrotask,
    cancelAnimationFrame: (t) => clearTimeout(t),
    setTimeout: (fn) => { const t = setTimeout(fn, 0); t.unref?.(); return t; },
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    navigator: { platform: "MacIntel" },
    console,
    Math,
  });
  Object.assign(window, { KeyboardEvent, matchMedia: context.matchMedia, requestAnimationFrame: context.requestAnimationFrame, cancelAnimationFrame: () => {}, ResizeObserver: ResizeObserverStub, MutationObserver: MutationObserverStub });
  vm.runInContext(script, context, { filename: "public/studio-shell.js" });
  return { document, window, events, observerInstances };
}

test("studio-shell #canvasMoreMenu handles cascading submenus, narrow back navigation, left-flip, proxies, and coordination", async () => {
  const desktop = bootStudioShell({ narrow: false, overflowSubmenu: true });
  const moreBtn = desktop.document.getElementById("canvasMoreBtn");
  const moreMenu = desktop.document.getElementById("canvasMoreMenu");
  const dlTrigger = desktop.document.getElementById("moreDownloadTrigger");
  const dlSub = moreMenu.querySelector('[data-more-submenu="download"]');

  assert.equal(moreMenu.hidden, true);
  moreBtn.click();
  assert.equal(moreMenu.hidden, false);
  assert.equal(moreBtn.getAttribute("aria-expanded"), "true");
  assert.deepEqual(desktop.events, ["more-opening"]);

  // ArrowRight opens Download submenu and flips left when near right edge
  dlTrigger.focus();
  dlTrigger.dispatchEvent(new desktop.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  assert.equal(dlSub.hidden, false);
  assert.equal(dlSub.dataset.align, "left", "overflowing submenu flips left");

  // ArrowLeft closes submenu and restores focus to trigger
  desktop.document.activeElement.dispatchEvent(new desktop.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
  assert.equal(dlSub.hidden, true);
  assert.equal(desktop.document.activeElement?.id, "moreDownloadTrigger");

  // Escape closes the open menu and restores focus to #canvasMoreBtn
  dlTrigger.dispatchEvent(new desktop.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(moreMenu.hidden, true);
  assert.equal(desktop.document.activeElement?.id, "canvasMoreBtn");

  // penecho:share-opening closes More menu
  moreBtn.click();
  desktop.window.dispatchEvent(new desktop.window.CustomEvent("penecho:share-opening"));
  assert.equal(moreMenu.hidden, true);

  // Forwarding to hidden command inside #canvasCommandProxies
  moreBtn.click();
  const proxyPngBtn = desktop.document.getElementById("exportPngBtn");
  assert.ok(proxyPngBtn.closest("#canvasCommandProxies"), "#exportPngBtn lives in hidden #canvasCommandProxies");
  let proxyClicked = 0;
  proxyPngBtn.addEventListener("click", () => { proxyClicked++; });
  desktop.document.querySelector('#canvasMoreMenu [data-shell-forward="#exportPngBtn"]').click();
  assert.equal(proxyClicked, 1);
  assert.equal(moreMenu.hidden, true);

  // Narrow viewport (<740px) uses in-panel back button instead of cascading drawer
  const mobile = bootStudioShell({ narrow: true });
  const mMoreBtn = mobile.document.getElementById("canvasMoreBtn");
  const mMoreMenu = mobile.document.getElementById("canvasMoreMenu");
  const helpTrigger = mobile.document.getElementById("moreHelpTrigger");
  const helpSub = mMoreMenu.querySelector('[data-more-submenu="help"]');
  const helpBack = helpSub.querySelector("[data-more-back]");

  mMoreBtn.click();
  assert.equal(mMoreMenu.hidden, false);
  helpTrigger.click();
  assert.equal(helpSub.hidden, false);
  assert.equal(helpBack.hidden, false);
  assert.equal(mMoreMenu.dataset.submenuOpen, "help");
  assert.ok(helpSub.contains(mobile.document.activeElement), "submenu receives focus on narrow viewport");
  helpBack.click();
  assert.equal(helpSub.hidden, true);
  assert.equal(mMoreMenu.dataset.submenuOpen, undefined);
  assert.equal(mobile.document.activeElement?.id, "moreHelpTrigger");

  // Guest hides local-only entries via data-penecho-guest-hide
  assert.ok(mobile.document.getElementById("moreDeleteCanvasBtn").hasAttribute("data-penecho-guest-hide"));
});

test("mcp-runtime shows #headerMcpPill conditionally, syncs #canvasMoreMcpSwitch, and delegates Settings", async () => {
  const html = read("public/index.html");
  const { document, window } = parseHTML(html);
  const pop = document.getElementById("mcpStatusPopover");
  pop.showPopover = () => { pop.dataset.popoverOpen = "true"; };
  pop.hidePopover = () => { delete pop.dataset.popoverOpen; };

  let openedSettingsPage = "";
  window.PENECHO_CONFIG = {};
  window.PenEchoOpenAppSettings = () => { openedSettingsPage = "apps-delegated"; };
  window.WebSocket = class FakeSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor(url) { this.url = url; this.readyState = 0; this.availability = { local: true, cloud: false }; }
    addEventListener(type, fn) { (this._l ||= {})[type] = fn; }
    send() {}
    close() { this.readyState = 3; }
  };

  const storage = new Map();
  const context = vm.createContext({
    document,
    window,
    state: { language: "en" },
    WebSocket: window.WebSocket,
    URL,
    AbortSignal,
    AbortController,
    setTimeout: (fn) => { const t = setTimeout(fn, 0); t.unref(); return t; },
    clearTimeout,
    performance,
    addEventListener: () => {},
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    setStatus() {},
    showCanvasHint() {},
    openSettings() {},
    selectSettingsPage(p) { openedSettingsPage = `fallback:${p}`; },
    location: { protocol: "http:", host: "localhost:3888", origin: "http://localhost:3888" },
    canvasClientId: () => "canvas-test",
    canvasCompanionMinimal: () => false,
    authenticatedApiHeaders: (h = {}) => h,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ enabled: true, http: { localUrl: "http://127.0.0.1:3888/mcp" }, config: { command: "node", args: [] } }) }),
    writeClipboardText: async () => true,
    t: (k) => k,
    console,
  });

  vm.runInContext(
    read("src/client/app/mcp-troubleshoot.js") +
    read("src/client/app/mcp-runtime.js") +
    "\nglobalThis.api = { mcpRuntime, mcpRenderToolbar, mcpToolbarClick };",
    context
  );

  const pill = document.getElementById("headerMcpPill");
  const sw = document.getElementById("canvasMoreMcpSwitch");
  context.api.mcpRenderToolbar();
  assert.equal(pill.hidden, true, "pill stays hidden when MCP is off");
  assert.equal(sw.getAttribute("aria-checked"), "false");

  // Simulate active connected MCP
  const sock = new window.WebSocket("ws://localhost:3888/mcp");
  sock.readyState = 1;
  context.api.mcpRuntime.socket = sock;
  context.api.mcpRuntime.ready = true;
  context.api.mcpRuntime.wanted = true;
  context.api.mcpRenderToolbar();
  assert.equal(pill.hidden, false, "pill appears when MCP is connected");
  assert.equal(pill.dataset.state, "connected");
  assert.equal(sw.getAttribute("aria-checked"), "true");

  // Clicking Settings inside MCP status delegates to PenEchoOpenAppSettings
  document.getElementById("mcpStatusSettings").click();
  assert.equal(openedSettingsPage, "apps-delegated");
});

test("cloud-connect unifies #canvasShareMenu popover with Draw together and View link + coordination", async () => {
  const html = read("public/index.html");
  const { document, window } = parseHTML(html);
  const CANVAS_ID = "123e4567-e89b-42d3-a456-426614174001";
  let focused = document.body;
  Object.defineProperty(document, "activeElement", { get: () => focused?.isConnected ? focused : document.body });
  window.HTMLElement.prototype.focus = function () { focused = this; };

  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const events = [];
  window.addEventListener("penecho:share-opening", () => events.push("share-opening"));
  window.PENECHO_CONFIG = { accessSessionToken: "test", cloudOrigin: "https://internaltest.penecho.ai" };
  window.PenEchoCloudProjects = {
    currentCanvasId: () => CANVAS_ID,
    hasShareableContent: () => true,
    shareWidgetId: () => null,
    saveForShare: async () => CANVAS_ID,
  };
  window.PenEchoCommunityCanvas = {};
  const fetch = async (url) => {
    const target = String(url);
    if (target === "/api/cloud/status" || target === "/api/cloud/account") {
      return json({ account: { id: "acc-1", name: "Owner" }, accountSession: { signedIn: true }, device: { configured: false }, browserSignIn: { pending: false } });
    }
    if (target.endsWith("/collaboration")) {
      return json({ collaboration: { token: "live-tok", url: "/canvas/collaborate/live-tok" } });
    }
    if (target.includes("/share")) {
      return json({ share: { public: true, url: "/canvas/share/view-tok", moderation: { state: "approved" } } });
    }
    return json({});
  };

  const context = vm.createContext({
    window, document, location: { origin: "http://127.0.0.1:3888" },
    MutationObserver: class { observe() {} disconnect() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval: () => 0,
    queueMicrotask, URL, URLSearchParams, console, Date, JSON, Promise,
    Event: window.Event, CustomEvent: window.CustomEvent, TextEncoder, crypto: globalThis.crypto,
  });
  vm.runInContext(read("public/cloud-connect.js"), context, { filename: "public/cloud-connect.js" });
  await settle();

  const shareBtn = document.getElementById("shareCanvasBtn");
  const shareMenu = document.getElementById("canvasShareMenu");
  const drawState = document.getElementById("shareDrawTogetherState");
  const viewState = document.getElementById("shareViewLinkState");

  assert.equal(shareMenu.hidden, true);
  shareBtn.click();
  await settle();
  assert.equal(shareMenu.hidden, false);
  assert.ok(events.includes("share-opening"));
  assert.equal(drawState.hidden, false, "live collaboration state pill shows");
  assert.equal(viewState.hidden, false, "view link state pill shows");
  assert.equal(shareBtn.dataset.collaborating, "true");

  // Opening More closes Share menu
  window.dispatchEvent(new window.CustomEvent("penecho:more-opening"));
  assert.equal(shareMenu.hidden, true);

  // Clicking View link opens the share dialog
  shareBtn.click();
  await settle();
  document.getElementById("shareViewLinkBtn").click();
  await settle();
  assert.ok(document.querySelector(".penecho-live-share-dialog"), "View link opens live share dialog");
});

test("core.js Canvas AI lets Guests switch across multiple free models while preserving daily quota", async () => {
  const html = read("public/index.html");
  const { document, window } = parseHTML(html);
  const core = read("src/client/app/core.js");
  assert.ok(document.getElementById("settingsCanvasWhichAi"), "settingsCanvasWhichAi explainer exists");
  assert.ok(document.getElementById("settingsCanvasAiBox"), "settingsCanvasAiBox exists");

  const storage = new Map();
  const fnCode = [
    extractCoreBlockFn(core, "canvasGuest"),
    extractCoreBlockFn(core, "canvasGuestAiRestricted"),
    extractCoreBlockFn(core, "setCanvasGuestAi"),
    extractCoreBlockFn(core, "aiConnectionScope"),
    extractCoreBlockFn(core, "aiConnectionStorageKey"),
    extractCoreBlockFn(core, "allAiConnections"),
    extractCoreBlockFn(core, "selectedAiConnectionId"),
    extractCoreBlockFn(core, "storeAiConnectionSelection"),
    extractCoreBlockFn(core, "renderCanvasAiSelector"),
    extractCoreBlockFn(core, "loadHostedModelsOnce"),
  ].join("\n\n");

  const M1 = "11111111-1111-4111-8111-111111111111";
  const M2 = "22222222-2222-4222-8222-222222222222";
  const state = { language: "en", aiConnections: [] };
  const settings = { connections: [] };
  const hostedSettings = { loading: false, error: false, signedIn: false, models: [], credits: null, generation: 0, controller: null, loadPromise: null };
  const canvasGuestAi = { checked: false, usedUp: false, defaultModelId: "", remaining: null, limit: null };
  window.PENECHO_CONFIG = { runtime: "cloud", guestCanvas: true, guestAiModelId: "" };

  const context = vm.createContext({
    window,
    document,
    state,
    settings,
    hostedSettings,
    canvasGuestAi,
    AI_CONNECTION_STORAGE_KEY: "penecho-ai-connection-id",
    location: { origin: "https://penecho.ai" },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    t: (k) => ({
      settingsHostedLoading: "Loading…",
      settingsCanvasAiEmptyHint: "None configured",
      settingsCanvasAiGuestHint: "Free model{quota}.",
      settingsCanvasAiUsing: "Using {name}",
    }[k] || k),
    authenticatedApiHeaders: (h = {}) => h,
    renderHostedModels() {},
    renderAiConnectionSelect() {},
    AbortController,
    AbortSignal: { any: () => new AbortController().signal, timeout: () => new AbortController().signal },
    fetch: async (url) => {
      if (url === "/api/v1/guest/ai") {
        return { ok: true, status: 200, json: async () => ({ available: true, remaining: 8, limit: 10, model: { id: M1, name: "PenEcho Flash Free" } }) };
      }
      if (url === "/api/v1/models") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            guest: true,
            models: [
              { id: M1, displayName: "PenEcho Flash Free", available: true, enabled: true, freeForGuest: true, multiplier: 0, sortOrder: 1 },
              { id: M2, displayName: "PenEcho Reasoner Free", available: true, enabled: true, freeForGuest: true, multiplier: 0, sortOrder: 2 },
            ],
          }),
        };
      }
      throw new Error(`unexpected URL ${url}`);
    },
    console,
  });

  vm.runInContext(
    fnCode + "\nglobalThis.api = { loadHostedModelsOnce, storeAiConnectionSelection, renderCanvasAiSelector, selectedAiConnectionId };",
    context
  );

  await context.api.loadHostedModelsOnce();
  context.api.renderCanvasAiSelector();
  const select = document.getElementById("settingsCanvasAiSelect");
  const options = [...select.querySelectorAll("option")].map((o) => o.value);
  assert.deepEqual(options, [`hosted:${M1}`, `hosted:${M2}`]);
  assert.equal(window.PENECHO_CONFIG.guestAiModelId, M1);
  assert.match(document.getElementById("settingsCanvasAiStatus").textContent, /8 \/ 10 left today/);

  // Switch guest model to M2 while preserving daily quota
  context.api.storeAiConnectionSelection(`hosted:${M2}`);
  context.api.renderCanvasAiSelector();
  assert.equal(window.PENECHO_CONFIG.guestAiModelId, M2);
  assert.equal(document.getElementById("settingsCanvasAiModelTag").textContent, "PenEcho Reasoner Free");
  assert.match(document.getElementById("settingsCanvasAiStatus").textContent, /8 \/ 10 left today/);
});

test("Settings is one window: Project agents, Canvas, Integrations and App groups hold its tabs", async () => {
  const { document, window } = parseHTML("<!doctype html><html><head></head><body><main id='app'></main><div id='view'></div></body></html>");
  const app = document.getElementById("app");
  const storage = new Map();
  const sStorage = new Map([[
    "penecho-settings-return",
    JSON.stringify({ url: "/?linesProject=proj-1&linesCanvas=files%2Fa%2Fcanvas.penecho.json", label: "Forecast layout" }),
  ]]);
  let assignedUrl = "";
  const location = {
    hash: "#settings/agents",
    origin: "http://127.0.0.1:3888",
    assign(u) { assignedUrl = u; },
  };
  const S = {
    thisComputer: true,
    shelfPage: "settings",
    agentCheck: { problems: 0, agents: [{ id: "penecho", ready: true, state: "ready", name: "PenEcho", model: { signedIn: true, credits: 4200 } }] },
    cloudAccount: { signedIn: true, name: "Owner", credits: { available: 4200 } },
    presets: [],
    projects: [{ id: "old", name: "Old", archived: true }],
  };
  const ACT = {};
  const signedInAccount = S.cloudAccount;
  let account = signedInAccount;
  let readModels;
  const catalog = { ok:true, json:async () => ({ accountId:"acc-1", origin:"https://penecho.ai", models:[{ id:"m-cloud", displayName:"Cloud Pro", available:true, enabled:true, multiplier:1 }] }) };
  const timers = [];
  const context = vm.createContext({
    window,
    document,
    location,
    history: { replaceState(_s, _t, h) { location.hash = h; } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    sessionStorage: { getItem: (k) => sStorage.get(k) ?? null, setItem: (k, v) => sStorage.set(k, String(v)), removeItem: (k) => sStorage.delete(k) },
    requestAnimationFrame: (fn) => { const t = setTimeout(() => fn(Date.now()), 0); t.unref?.(); return t; },
    queueMicrotask,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    CSSStyleSheet: class {},
    S,
    ACT,
    VIEWS: {},
    COMMANDS: [],
    HOSTED: null,
    ICONS: {},
    addEventListener() {},
    setInterval(fn) { return timers.push(fn); },
    clearInterval() {},
    project: () => null,
    api: async (url) => {
      if (url === "/cloud/account") return account;
      if (url === "/cloud/sign-in") return { authorizationUrl:"https://penecho.ai/dashboard.html" };
      return {};
    },
    SETUP_ORDER: { ready: 0, setup: 1, none: 2 },
    setupRowHTML: (a) => `<div class="setup-row">${a.name}</div>`,
    $: (sel, root = document) => root.querySelector(sel),
    esc: (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    ic: (n) => `<svg data-ic="${n}"></svg>`,
    toast() {},
    themeRow: () => '<div class="set-theme"></div>',
    agentInfo: (id) => ({ name: id }),
    av: (id) => `<span class="av">${id}</span>`,
    installedAgentHTML: () => '<div id="installed"></div>',
    archivedProjectsHTML: () => '<div id="archivedList">Old</div>',
    checkAgents() {},
    closeSwitcher() {},
    copyText() {},
    render() { context.renderSettingsModal(); },
    fetch: async (url) => {
      if (url === "/api/cloud/models") {
        return readModels();
      }
      if (url === "/api/settings/connections") {
        return { ok: true, json: async () => ({ connections:[] }) };
      }
      if (url === "/api/mcp/status?inspectClients=1") {
        return { ok: true, json: async () => ({ http: { initialUrl: "http://127.0.0.1:3888/mcp" }, config: { command: "node", args: [] }, canConfigureLocalClients: true, configuredClients: {} }) };
      }
      if (url === "/api/suggest/status") {
        return { ok: true, json: async () => ({ access: { signedIn:account.signedIn, subscribed:false, paidEnabled:false, dailyCreditLimit:50, spentToday:0 } }) };
      }
      return { ok: true, json: async () => ({}) };
    },
    console,
  });

  vm.runInContext(read("public/lines/settings.js"), context, { filename: "public/lines/settings.js" });

  // With no preset saved yet the gear opens Local providers, step 1 of Project agents; once one is saved, Preset agents.
  const selected = () => document.querySelector('.sysm-tabs [aria-selected="true"]').dataset.tab;
  const title = () => document.querySelector(".sysm-head h3").textContent;
  const domain = () => document.querySelector(".sysm-head .sys-domain-tag").textContent;
  context.ACT["open-settings"]();
  await settle();
  assert.equal(selected(), "setup", "no saved preset yet: open-settings starts at Local providers");
  assert.equal(title(), "Local providers");
  assert.equal(domain(), "Project agents · Step 1");
  assert.equal(location.hash, "#setup", "#setup is a tab of its own");
  assert.ok(document.getElementById("sysInstalled"));
  assert.equal(document.getElementById("sysAgents"), null);
  assert.equal(document.querySelector('#sysPanel .sys-flow-step.is-active').dataset.tab, "setup");
  assert.deepEqual([...document.querySelectorAll('#sysPanel .sys-flow-step')].map((el) => el.dataset.tab), ["setup", "agents"]);
  S.presets = { default: "", presets: [{ id: "p-cloud", agent: "penecho", name: "PenEcho · worker", model: "worker", effort: "", available: true, auto: false }] };
  S.computer = { id: "mac-1", runsAsks: false };
  context.openSettingsTab("general");
  await settle();
  assert.equal(selected(), "general");
  assert.equal(domain(), "App");
  // General: Preferences, PenEcho Cloud sync, About, and Help us improve PenEcho at the very bottom.
  // (An earlier test leaves the shared window on the cloud runtime, where Help us improve PenEcho is not offered.)
  const generalHeads = [...document.querySelectorAll("#sysPanel > section")].map((el) => el.querySelector("h2")?.textContent);
  assert.deepEqual(generalHeads.slice(0, 3), ["Preferences", "PenEcho Cloud sync", "About"]);
  assert.ok(generalHeads.length === 3 || generalHeads[3] === "Help us improve PenEcho", generalHeads.join(", "));
  assert.ok(document.querySelector('#sysCloudAsks [data-act="computer-asks-toggle"]'));
  context.ACT["open-settings"]();
  await settle();
  assert.equal(selected(), "agents", "with a saved preset, open-settings opens Preset agents");
  assert.equal(title(), "Preset agents");
  assert.equal(domain(), "Project agents · Step 2");
  assert.equal(location.hash, "#agents");
  assert.ok(document.getElementById("sysAgents"));
  assert.equal(document.getElementById("sysCloudAsks"), null, "PenEcho Cloud sync moved to General");
  assert.equal(document.getElementById("sysInstalled"), null, "the installed CLIs are on Local providers");
  assert.match(document.querySelector('#sysPanel .sys-flow-step[data-tab="agents"]').textContent, /1 saved preset active/);
  context.openSettingsTab();
  await settle();
  assert.equal(selected(), "agents", "openSettingsTab() with no argument uses the same default");
  S.agentCheck.problems = 1;
  context.ACT["open-settings"]();
  await settle();
  assert.equal(selected(), "setup", "a CLI that needs a fix opens Local providers");
  assert.equal(document.querySelector("#sysTab-setup .setup-count")?.textContent, "1");
  S.agentCheck.problems = 0;
  // Step 2 of the flow strip goes to Preset agents, and arrows move across the groups.
  context.ACT["settings-tab"](document.querySelector('#sysPanel .sys-flow-step[data-tab="agents"]'));
  await settle();
  assert.equal(selected(), "agents");
  const arrow = new window.Event("keydown", { bubbles: true });
  Object.defineProperty(arrow, "key", { value: "ArrowDown" });
  document.getElementById("sysTab-agents").dispatchEvent(arrow);
  await settle();
  assert.equal(selected(), "providers", "ArrowDown from the last Project agents tab reaches the first Canvas tab");

  context.openSettingsTab("canvas");
  await settle();

  // One window over the page, its tabs down the left in four groups: two workflows, the MCP integration, then the app.
  const tabs = [...document.querySelectorAll('.sysm-tabs [role="tab"]')].map((el) => el.textContent.trim());
  assert.deepEqual(tabs, ["Local providers", "Preset agents1", "API providers", "Canvas AI", "View", "MCP", "General", "Archived1"]);
  assert.deepEqual([...document.querySelectorAll(".sysm-tabs .sysm-group-label")].map((el) => el.textContent), ["Project agents", "Canvas", "Integrations", "App"]);
  assert.deepEqual([...document.querySelectorAll(".sysm-tabs .sysm-group")].map((g) => [...g.querySelectorAll('[role="tab"]')].map((el) => el.dataset.tab)), [["setup", "agents"], ["providers", "canvas-ai", "canvas"], ["apps"], ["general", "archived"]]);
  assert.equal(document.querySelectorAll(".sysm-tabs hr").length, 0);
  assert.equal(selected(), "canvas");
  assert.equal(title(), "Canvas view");
  assert.equal(domain(), "Canvas");
  assert.equal(location.hash, "#settings/canvas");
  assert.equal(app.innerHTML, "", "the page beneath is left as it was");
  assert.equal(document.querySelector("[data-canvas-ai]"), null);
  assert.ok(document.getElementById("sysCanvasView"));
  assert.match(document.querySelector(".sys-back").textContent, /Back to Forecast layout/);
  assert.equal(document.getElementById("sysKeys"), null, "API keys are on Providers");

  // The sidebar has one way in: the gear.
  const rail = parseHTML(`<div>${context.railSettingsHTML()}</div>`).document;
  assert.deepEqual([...rail.querySelectorAll("button")].map((el) => el.dataset.act), ["open-settings"]);
  context.openSettingsTab("agents");
  await settle();
  assert.equal(location.hash, "#agents", "an old Agents tab link opens Preset agents");
  assert.equal(selected(), "agents");
  assert.equal(title(), "Preset agents");
  assert.equal(document.querySelectorAll(".sysm").length, 1, "tabs change inside the one window");
  assert.ok(document.getElementById("sysAgents"), "saved agents are on Agents");
  assert.doesNotMatch(document.getElementById("sysPanel").textContent, /runs on dsh/i);
  assert.equal(document.querySelector('select[data-job-agent="topics"]'), null, "Jobs Build Topics section is removed from Agents");
  assert.doesNotMatch(document.getElementById("sysPanel").textContent, /Build Topics/);
  assert.equal(document.getElementById("sysKeys"), null, "API keys are on Providers");
  context.ACT["open-providers"]();
  await settle();
  assert.equal(location.hash, "#providers");
  assert.equal(title(), "API providers");
  assert.equal(domain(), "Canvas AI · Step 1");
  assert.deepEqual([...document.querySelectorAll('#sysPanel .sys-flow-step')].map((el) => el.dataset.tab), ["providers", "canvas-ai"]);
  assert.equal(document.querySelector('#sysPanel .sys-flow-step.is-active').dataset.tab, "providers");
  assert.match(document.querySelector('#sysPanel .sys-flow-step[data-tab="providers"]').textContent, /PenEcho Cloud/);
  const subsecs = [...document.querySelectorAll("#sysPanel .sys-subsec")];
  assert.equal(subsecs.length, 2);
  assert.match(subsecs[0].textContent, /PenEcho Cloud/);
  assert.match(subsecs[0].textContent, /Zero-key managed models for Canvas AI/);
  assert.match(subsecs[0].textContent, /Connected/);
  assert.equal(subsecs[0].querySelector('[data-act="settings-tab"]').dataset.tab, "canvas-ai", "Pick Cloud model goes to Canvas AI");
  assert.doesNotMatch(subsecs[0].textContent, /Add API provider/, "PenEcho Cloud section has no Add API provider");
  assert.match(document.getElementById("sysKeys").textContent, /Your API keys & local model servers/);
  assert.match(document.getElementById("sysKeys").textContent, /Add API provider/);
  assert.ok(document.querySelector('#sysKeys .sys-inline-link[data-act="open-setup"]'), "project agents are pointed to Local providers");
  // OpenCode is a relay with Zen and Go; its saved key keeps the preset that makes the server send OpenCode's session header.
  context.FormData = class { constructor(form) { this.form = form; } get(name) { return this.form.querySelector(`[name="${name}"]`)?.value ?? null; } };
  context.ACT["key-new"]();
  await settle();
  const openCodeTile = document.querySelector('#sysKeys .pk-tile[data-service="opencode"]');
  assert.ok(openCodeTile, "the picker has an OpenCode tile");
  assert.match(openCodeTile.closest(".pk-kind").querySelector("h4").textContent, /Relays/);
  context.ACT["key-pick"](openCodeTile);
  await settle();
  assert.equal(document.querySelector('.sys-form[data-form="key"] [name="url"]').value, "https://opencode.ai/zen/v1");
  assert.deepEqual([...document.querySelectorAll('.sys-form[data-form="key"] [data-act="key-region"]')].map((b) => b.textContent), ["Zen", "Go"]);
  assert.equal(vm.runInContext("keyFormRead().apiPreset", context), "opencode-zen-global-api");
  context.ACT["key-region"]({ dataset: { value: "1" } });
  assert.equal(vm.runInContext("keyFormRead().apiPreset", context), "opencode-go-global-api");
  assert.equal(vm.runInContext("SET.key.url", context), "https://opencode.ai/zen/go/v1");
  context.ACT["key-cancel"]();
  const savedOpenCode = { provider: "api", apiFormat: "anthropic", apiPreset: "opencode-zen-global-api", apiUrl: "https://opencode.ai/zen/v1/messages", apiModel: "claude-sonnet-4-5", hasApiKey: true };
  context.savedOpenCode = savedOpenCode;
  assert.equal(vm.runInContext("keyPlaceLabel(savedOpenCode)", context), "OpenCode · Zen");
  assert.equal(vm.runInContext("keyFormFor(savedOpenCode).url", context), "https://opencode.ai/zen/v1", "the form shows the base address, not the Messages path");
  assert.equal(vm.runInContext("keyFormFor(savedOpenCode).saved.preset", context), "opencode-zen-global-api");
  // A new key is used by Canvas AI right away unless that box is cleared; another saved key is one click away.
  const localKey = `penecho-ai-connection-id:local:${location.origin}`;
  context.ACT["key-new"]();
  await settle();
  context.ACT["key-pick"](document.querySelector('#sysKeys .pk-tile[data-service="openai"]'));
  await settle();
  assert.ok(document.querySelector('.sys-form[data-form="key"] input[name="useNow"]').hasAttribute("checked"));
  const savedKey = { id: "k-new", provider: "api", apiFormat: "openai", apiUrl: "https://api.openai.com/v1", apiModel: "gpt-5.6-sol", hasApiKey: true, removable: true };
  const otherKey = { id: "k-old", provider: "api", apiFormat: "openai", apiUrl: "https://api.deepseek.com/v1", apiModel: "deepseek-chat", hasApiKey: true, removable: true };
  const baseFetch = context.fetch;
  context.fetch = async (url, init) => (url === "/api/settings/connections" && init?.method === "POST"
    ? { ok: true, json: async () => ({ connections: [savedKey, otherKey], savedId: "k-new" }) }
    : baseFetch(url, init));
  context.keySave();
  await settle();
  context.fetch = baseFetch;
  assert.equal(storage.get(localKey), "k-new");
  assert.equal(storage.get("penecho-ai-connection-id"), "k-new");
  const keyRow = (id) => document.querySelector(`#sysKeys [data-key="${id}"]`);
  assert.match(keyRow("k-new").textContent, /Active in Canvas AI/);
  assert.equal(keyRow("k-new").querySelector('[data-act="settings-tab"]').textContent, "Open Canvas AI →");
  const useOther = keyRow("k-old").querySelector('[data-act="key-use"]');
  assert.equal(useOther.textContent, "Use in Canvas AI");
  context.ACT["key-use"](useOther);
  assert.equal(storage.get(localKey), "k-old");
  assert.equal(storage.get("penecho-ai-connection-id"), "k-old");
  assert.match(keyRow("k-old").textContent, /Active in Canvas AI/);
  assert.doesNotMatch(keyRow("k-new").textContent, /Active in Canvas AI/);
  assert.match(document.querySelector('#sysPanel .sys-flow-step[data-tab="providers"]').textContent, /PenEcho Cloud · 2 API keys/);
  vm.runInContext("SET.keys = []", context);
  storage.delete(localKey);
  storage.delete("penecho-ai-connection-id");
  assert.match(document.querySelector(".sys-back").textContent, /Back to Forecast layout/);
  context.openSettingsTab("apps");
  await settle();
  assert.equal(location.hash, '#agents/apps', 'an old Settings apps link opens MCP');
  assert.ok(document.getElementById('sysApps'));
  assert.equal(selected(), 'apps');
  assert.equal(domain(), 'External integration');
  assert.match(document.querySelector('#sysPanel > .sys-notice').textContent, /Separate external integration: MCP lets outside AI apps connect into PenEcho/);
  assert.equal(document.getElementById('sysApps').textContent, 'Local MCP bridge');
  assert.match(document.getElementById('sysPanel').textContent, /Listening/);
  assert.deepEqual([...document.querySelectorAll('#sysPanel [data-act="mcp-configure"]')].map((el) => [el.dataset.client, el.textContent]), [['claude', 'Configure Claude'], ['codex', 'Configure Codex']]);
  assert.ok(document.getElementById('sysMcpClients'));
  assert.ok(document.querySelector('[aria-labelledby="sysMcpSession"] #prefKeepAwake'));
  vm.runInContext('SET.mcp.connectedCanvases = 2; SET.mcp.configuredClients = { codex:{ configured:true } }; render();', context);
  assert.equal(document.querySelector('#sysTab-apps .sys-nav-ok').textContent, '2 live');
  assert.equal(document.querySelector('#sysPanel [data-client="codex"]').textContent, 'Reconfigure');
  assert.match(document.querySelector('#sysPanel [data-client="codex"]').closest('.sys-row').textContent, /Configured/);
  context.ACT["settings-tab"]({ dataset: { tab: "archived" } });
  assert.equal(location.hash, "#archived");
  assert.equal(title(), "Archived");
  assert.ok(document.getElementById("archivedList"), "archived projects are a Settings tab");

  account = { signedIn:false };
  window.open = () => {};
  vm.runInContext(read("public/lines/cloud.js"), context, { filename:"public/lines/cloud.js" });
  await settle();
  context.openAgents('canvas');
  await settle();
  assert.equal(location.hash, "#agents/canvas");
  assert.equal(selected(), 'canvas-ai');
  assert.equal(document.getElementById('sysCanvasView'), null, 'view preferences stay on Canvas');
  assert.ok(document.getElementById('sysCanvasDraw'));
  assert.ok(document.getElementById('sysSuggestSpend'));

  const canvasCard = () => document.querySelector(".sys-canvas-ai");
  const modelPicker = () => canvasCard().querySelector("[data-canvas-ai]");
  const signInButton = () => canvasCard().querySelector('[data-act="cloud-sign-in"]');
  assert.ok(signInButton());
  assert.ok(canvasCard().querySelector('[data-act="settings-go-keys"]'));

  // Complete desktop sign-in while Canvas AI is still open. A slow or failed
  // model request must not turn the already signed-in account back into Sign in.
  let finishModels;
  readModels = () => new Promise(resolve => { finishModels = resolve; });
  await context.ACT["cloud-sign-in"](signInButton());
  account = signedInAccount;
  await timers.at(-1)();
  assert.equal(document.querySelector('#sysPanel [data-act="cloud-sign-in"]'), null);
  assert.match(canvasCard().textContent, /Signed in to PenEcho Cloud\. Loading Cloud models/);
  finishModels({ ok:false, status:503 });
  await settle();
  assert.match(canvasCard().textContent, /Couldn’t load Cloud models/);
  assert.equal(signInButton(), null);
  const retry = canvasCard().querySelector('[data-act="canvas-ai-retry"]');
  assert.ok(retry);
  context.ACT[retry.dataset.act](retry);
  assert.match(canvasCard().textContent, /Loading Cloud models/);
  finishModels(catalog);
  await settle();
  assert.ok(modelPicker().querySelector('option[value="hosted:m-cloud"]'));
  assert.equal(signInButton(), null);

  // Canvas AI card links directly to the API providers settings page, under the same two steps.
  assert.equal(document.querySelector('#sysPanel .sys-flow-step.is-active').dataset.tab, "canvas-ai");
  assert.equal(domain(), "Canvas AI · Step 2");
  const providersLink = document.querySelector('.sys-canvas-ai button[data-act="open-providers"]');
  assert.ok(providersLink, "Canvas AI card has a link to API providers");
  assert.equal(providersLink.textContent.trim(), "Manage API providers");
  assert.equal(providersLink.dataset.focusId, "sysTab-providers");
  context.ACT[providersLink.dataset.act](providersLink);
  await settle();
  assert.equal(location.hash, "#providers");
  assert.equal(selected(), "providers");
  assert.equal(title(), "API providers");
  assert.ok(document.getElementById("sysKeys"));
  context.openAgents('canvas');
  await settle();

  // Select Canvas AI model & toggle Canvas preference (shim linkedom read-only select.value)
  const pick = document.querySelector('select[data-canvas-ai]');
  const opt = pick.querySelector('option[value="hosted:m-cloud"]');
  Object.defineProperty(pick, "value", { value: "hosted:m-cloud", configurable: true });
  Object.defineProperty(pick, "selectedOptions", { value: [opt], configurable: true });
  pick.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(storage.get("penecho-ai-connection-id"), "hosted:m-cloud");
  const providersLinkSelected = document.querySelector('.sys-canvas-ai button[data-act="open-providers"]');
  assert.ok(providersLinkSelected, "Canvas AI card keeps the Providers link after picking a model");
  assert.match(document.querySelector(".sys-canvas-ai small").textContent, /Currently using Cloud Pro · Manage API providers/);
  assert.match(document.querySelector('#sysPanel .sys-flow-step[data-tab="canvas-ai"]').textContent, /Using Cloud Pro/);

  // Thinking effort for Canvas AI, beside the model: the same entry the Canvas AI bar uses.
  const effort = document.querySelector('select[data-canvas-effort]');
  assert.ok(effort, "Canvas AI has a thinking effort choice");
  assert.deepEqual([...effort.querySelectorAll("option")].map((o) => o.value), ["config", "none", "low", "medium", "high", "max"]);
  assert.equal(effort.querySelector("option[selected]").value, "config");
  Object.defineProperty(effort, "value", { value: "high", configurable: true });
  Object.defineProperty(effort, "selectedOptions", { value: [effort.querySelector('option[value="high"]')], configurable: true });
  effort.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(storage.get("penecho-ai-effort"), "high");

  document.getElementById('prefAutoAi').click();
  assert.equal(storage.get('penecho-auto-ai'), 'true');
  context.openSettingsTab('canvas');
  await settle();
  const wheelSwitch = document.getElementById("prefWheelZoom");
  wheelSwitch.click();
  assert.equal(storage.get("penecho-wheel-zoom"), "true");

  // Signed in as someone else between two account checks: the first account's models are not kept.
  context.openAgents('canvas');
  await settle();
  account = { ...signedInAccount, id:"acct-other", name:"Other" };
  readModels = () => new Promise(resolve => { finishModels = resolve; });
  await context.loadCloudAccount();
  assert.equal(modelPicker(), null);
  assert.match(canvasCard().textContent, /Loading Cloud models/);
  finishModels(catalog);
  await settle();
  assert.ok(modelPicker().querySelector('option[value="hosted:m-cloud"]'));

  // A response from before sign-out must not repopulate the model picker.
  context.openAgents('canvas');
  const pending = context.loadCloudModels();
  account = { signedIn:false };
  await context.loadCloudAccount();
  finishModels(catalog);
  await pending;
  assert.equal(modelPicker(), null);
  assert.ok(signInButton());

  // Back button navigates to stored return route
  context.ACT["settings-return"]();
  assert.equal(assignedUrl, "/?linesProject=proj-1&linesCanvas=files%2Fa%2Fcanvas.penecho.json");

  // hosted.js maps legacy #setup cleanly outside project hash
  const hostedRaw = read("public/lines/hosted.js");
  const hStart = hostedRaw.indexOf("function hostedHash(");
  const hEnd = hostedRaw.indexOf("\nfunction ", hStart + 1);
  const hostedHashFn = hostedRaw.slice(hStart, hEnd);
  const hCtx = vm.createContext({ HOSTED: { key: "proj-key" }, HOSTED_PLACES: ["line", "step"], HOSTED_OUTSIDE: ["settings", "setup", "archived", "agents", "providers"] });
  vm.runInContext(hostedHashFn, hCtx);
  assert.equal(hCtx.hostedHash("#setup"), "setup");
  assert.equal(hCtx.hostedHash("#settings/canvas"), "settings/canvas");
  assert.equal(hCtx.hostedHash("#agents/canvas"), "agents/canvas");
  assert.equal(hCtx.hostedHash("#agents/apps"), "agents/apps");

  const routing = read('public/lines/main.js');
  vm.runInContext(routing.slice(routing.indexOf('const OUTSIDE_PAGES'), routing.indexOf('// Text you are editing')), context);
  for (const [hash, section] of [['#agents', 'agents'], ['#agents/canvas', 'canvas'], ['#agents/apps', 'apps'], ['#settings', 'agents'], ['#settings/agents', 'agents'], ['#settings/apps', 'apps']]) {
    assert.equal(vm.runInContext(`parseShelfPage(${JSON.stringify(hash)})`, context), 'agents', hash);
    assert.equal(vm.runInContext('SET.agentsTab', context), section, hash);
  }
  assert.equal(vm.runInContext("parseShelfPage('#setup')", context), 'setup');
  assert.equal(vm.runInContext('SET.agentsTab', context), 'apps', '#setup is a tab of its own and leaves the Agents section as it was');
  for (const hash of ['#agents/unknown', '#agents/apps/extra', '#agents-extra']) assert.equal(vm.runInContext(`parseShelfPage(${JSON.stringify(hash)})`, context), false, hash);
  assert.equal(vm.runInContext("parseShelfPage('#settings/canvas')", context), 'settings');
  assert.equal(vm.runInContext('SET.tab', context), 'canvas');
  assert.equal(vm.runInContext("parseShelfPage('#settings/general')", context), 'settings');
  assert.equal(vm.runInContext('SET.tab', context), 'general');

  // Hosted Projects render the same destinations, with computer-only setup omitted.
  context.HOSTED = { computers:[] };
  context.hostedFetch = async () => catalog;
  account = signedInAccount;
  await context.loadCloudAccount();
  S.thisComputer = false;
  context.openAgents('apps');
  await settle();
  assert.equal(location.hash, '#agents/apps');
  assert.ok(document.getElementById('sysApps'));
  assert.equal(document.querySelector('[data-act="mcp-configure"]'), null);
  assert.equal(document.getElementById('sysTab-archived'), null, 'penecho.ai lists no archived projects');
  assert.equal(document.querySelectorAll('.sysm-tabs .sysm-group').length, 4);
  assert.match(document.querySelector('#sysPanel > .sys-notice').textContent, /Separate external integration/);
  assert.ok(document.querySelector('#sysPanel #prefKeepAwake'));
  context.openAgents('canvas');
  await settle();
  assert.ok(document.querySelector('[data-canvas-effort]'));
  assert.equal(document.querySelector('.sys-canvas-ai button[data-act="open-providers"]')?.textContent.trim(), 'Manage API providers');
  vm.runInContext('SET.cloud = { models: [] }; SET.keys = []; render();', context);
  assert.equal(document.querySelector('.sys-canvas-ai button[data-act="open-providers"]')?.textContent.trim(), 'API providers');
  assert.match(canvasCard().textContent, /Signed in to PenEcho Cloud\. No Cloud models are available/);
  assert.equal(signInButton(), null);
  S.thisComputer = true;
  vm.runInContext('render();', context);
  assert.equal(document.querySelector('.sys-canvas-ai button[data-act="open-providers"]')?.textContent.trim(), 'API providers');
  assert.equal(document.querySelector('.sys-canvas-ai [data-act="settings-go-keys"]')?.textContent.trim(), 'Add API provider');
  S.thisComputer = false;
  context.ACT["open-settings"]();
  assert.equal(selected(), 'agents', 'penecho.ai opens Preset agents');
  context.openSettingsTab('setup');
  assert.match(document.getElementById('sysPanel').textContent, /On your computers/);
  assert.match(document.querySelector('#sysPanel .sys-flow-step[data-tab="setup"]').textContent, /Connected computers/);
  context.openAgents();

  // Delayed responses refresh their active destination, never another AI panel.
  context.HOSTED = null;
  S.thisComputer = true;
  const redraws = [];
  context.render = () => redraws.push(vm.runInContext('SET.agentsTab', context));
  for (const [loader, tab, body] of [
    ['loadKeys', 'canvas', { connections:[] }],
    ['loadCloudModels', 'canvas', { models:[] }],
    ['loadSuggestStatus', 'canvas', { access:{ signedIn:true } }],
    ['loadMcpStatus', 'apps', { connectedCanvases:2 }],
  ]) {
    for (const switchAway of [false, true]) {
      redraws.length = 0;
      vm.runInContext(`SET.agentsTab = ${JSON.stringify(tab)}`, context);
      let release;
      context.fetch = () => new Promise(resolve => { release = resolve; });
      const pending = context[loader]();
      if (switchAway) vm.runInContext(`SET.agentsTab = ${JSON.stringify(tab === 'canvas' ? 'apps' : 'canvas')}`, context);
      release({ ok:true, json:async () => body });
      await pending;
      assert.deepEqual(redraws, switchAway ? [] : [tab], `${loader}: active destination only`);
    }
  }
});

test("Canvas side panel hands Settings and Manage agents to the whole-window Settings popup with return URL", async () => {
  // 1) openSettings / openAgents / open-setup in embed=panel leave to the top-level Settings page instead of rendering #sysModal inside the side panel.
  const { document, window } = parseHTML("<!doctype html><html><head></head><body><main id='app'></main></body></html>");
  const told = [];
  let renderCalls = 0;
  const location = { hash: "#proj/line/one", origin: "http://127.0.0.1:3888", pathname: "/projects.html", search: "?embed=panel&canvas=files%2Fa%2Fcanvas.penecho.json" };
  const S = { thisComputer: true, shelfPage: false, cur: "proj", route: { view: "line", line: "one" }, projects: [{ id: "proj", name: "Proj" }] };
  const ACT = {};
  const ctx = vm.createContext({
    window, document, location, S, ACT, VIEWS: {}, COMMANDS: [], HOSTED: null,
    EMBED: { rail: false, canvas: "files/a/canvas.penecho.json", project: "proj", line: "one", told: "" },
    embedTell: (msg) => told.push(msg),
    closeSwitcher() {},
    history: { replaceState() {}, back() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: () => 0,
    Element: window.Element, HTMLElement: window.HTMLElement, Event: window.Event, CustomEvent: window.CustomEvent,
    $: (sel, root = document) => root.querySelector(sel),
    esc: (v) => String(v ?? ""),
    ic: (n) => `<svg data-ic="${n}"></svg>`,
    toast() {}, themeRow: () => "", agentInfo: (id) => ({ name: id }),
    archivedProjectsHTML: () => "", checkAgents() {}, copyText() {},
    SETUP_ORDER: { ready: 0, setup: 1, none: 2 }, setupRowHTML: () => "",
    render() { renderCalls++; },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  });
  vm.runInContext(read("public/lines/settings.js"), ctx, { filename: "public/lines/settings.js" });
  vm.runInContext(read("public/lines/setup.js"), ctx, { filename: "public/lines/setup.js" });

  ctx.ACT["open-agents"]();
  ctx.ACT["open-settings"]();
  ctx.ACT["open-providers"]();
  ctx.ACT["open-canvas-settings"]();
  ctx.ACT["open-setup"]();
  assert.deepEqual(told.map((m) => ({ ...m })), [
    { leave: "/projects.html#agents" },
    { leave: "/projects.html#agents" },
    { leave: "/projects.html#providers" },
    { leave: "/projects.html#settings/canvas" },
    { leave: "/projects.html#setup" },
  ]);
  assert.equal(S.shelfPage, false, "Settings state is not activated inside the side panel");
  assert.equal(location.hash, "#proj/line/one", "panel hash stays on its line");
  assert.equal(renderCalls, 0, "Settings modal does not render inside the side panel");
  assert.equal(document.getElementById("sysModal"), null);

  // 2) line.js Run with and Carry on with menus route Manage agents… through openAgents().
  const lineSrc = read("public/lines/line.js");
  assert.match(lineSrc, /label:'Manage agents…', icon:'gear', fn:\(\) => \{ if \(typeof openAgents === 'function'\) openAgents\(\); else location\.hash = 'agents'; \}/);
  assert.equal((lineSrc.match(/label:'Manage agents…', icon:'gear', fn:\(\) => \{ if \(typeof openAgents === 'function'\) openAgents\(\); else location\.hash = 'agents'; \}/g) || []).length, 2);

  // 3) embed.js in embed=panel mode intercepts direct hashchange to Settings/outside pages without blocking in-line hashes.
  const posted = [];
  const listeners = new Map();
  let backCalls = 0;
  const embedLocation = { origin: "http://127.0.0.1:3888", search: "?embed=panel&canvas=files%2Fa%2Fcanvas.penecho.json", hash: "#proj/line/one" };
  const embedCtx = vm.createContext({
    URLSearchParams, setTimeout, clearTimeout,
    window: { parent: { postMessage: (msg, origin) => posted.push({ msg, origin }) } },
    location: embedLocation,
    document: { documentElement: { classList: { add() {} } }, addEventListener() {} },
    history: {
      back() {
        backCalls++;
        embedLocation.hash = "#proj/line/one";
        const fn = listeners.get("hashchange");
        if (fn) fn({ stopImmediatePropagation() {} });
      },
    },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    outsidePage: (h) => h === "#agents" || h === "#setup" || h.startsWith("#settings"),
    hashToRoute: (h) => h === "#proj/line/one/ask-1" ? { cur: "proj", route: { view: "line", line: "one", step: "ask-1" } } : h === "#proj/orchestrator" ? { cur: "proj", route: { view: "orchestrator" } } : null,
  });
  vm.runInContext(read("public/lines/embed.js"), embedCtx, { filename: "public/lines/embed.js" });
  const onHashChange = listeners.get("hashchange");
  assert.ok(onHashChange, "embed=panel installs hashchange guard");

  // In-line step hash stays inside the panel.
  let stopped = false;
  embedLocation.hash = "#proj/line/one/ask-1";
  onHashChange({ stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, false);
  assert.equal(posted.length, 0);

  // Outside page hash (#agents) restores history and leaves to the whole-window Settings popup.
  embedLocation.hash = "#agents";
  onHashChange({ stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(backCalls, 1);
  assert.deepEqual({ msg: { ...posted.at(-1).msg }, origin: posted.at(-1).origin }, {
    msg: { source: "penecho-lines-panel", leave: "/projects.html#agents" },
    origin: "http://127.0.0.1:3888",
  });

  // 4) project-lines-bridge.js recognizes Settings leaves and records penecho-settings-return before leaving.
  const bridgeSrc = read("src/client/app/project-lines-bridge.js");
  const isSettingsFn = extractCoreBlockFn(bridgeSrc, "projectLinesIsSettingsLeave");
  const bridgeCtx = vm.createContext({});
  vm.runInContext(isSettingsFn, bridgeCtx);
  for (const okUrl of ["/projects.html#agents", "/projects.html#agents/canvas", "/projects.html#agents/apps", "/projects.html#settings", "/projects.html#settings/canvas", "/projects.html#settings/general", "/projects.html#providers", "/projects.html#archived", "/projects.html#setup"]) {
    assert.equal(bridgeCtx.projectLinesIsSettingsLeave(okUrl), true, okUrl);
  }
  for (const noUrl of ["/projects.html#proj/line/one", "/projects.html#proj/orchestrator", "/projects.html#new", "/projects.html#meetcue"]) {
    assert.equal(bridgeCtx.projectLinesIsSettingsLeave(noUrl), false, noUrl);
  }
  assert.match(bridgeSrc, /if \(projectLinesIsSettingsLeave\(said\.leave\)\) projectLinesSettingsReturnUrl\(\);/);
});
