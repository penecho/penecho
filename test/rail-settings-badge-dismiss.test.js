"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function makeHarness({ storage = new Map(), problems = 4, embed = null, api = async () => ({ problems, agents: [] }) } = {}) {
  const { document, window } = parseHTML("<!doctype html><html><head></head><body><div id='railAccount'></div><main id='app'></main></body></html>");
  const listeners = new Map();
  const origAdd = window.addEventListener.bind(window);
  window.addEventListener = (type, fn, opts) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
    return origAdd(type, fn, opts);
  };
  const told = [];
  const location = { hash: "#proj", origin: "http://127.0.0.1:3888", pathname: "/projects.html", search: "", assign() {} };
  const S = {
    thisComputer: true,
    shelfPage: false,
    cur: "proj",
    route: { view: "home" },
    agentCheck: problems === null ? null : {
      problems,
      agents: [{
        id: "codex",
        state: problems > 0 ? "problem" : "ready",
        name: "Codex",
        mono: "Cx",
        color: "#333",
        problems: Array.from({ length: problems }, (_, i) => ({ kind: "fix", title: `Issue ${i + 1}`, fix: "Fix it" })),
      }],
    },
    presets: { presets: [] },
    projects: [],
  };
  const ACT = {};
  let railRenders = 0;
  const renderRail = () => {
    railRenders++;
    const host = document.getElementById("railAccount");
    host.innerHTML = ctx.railSettingsHTML();
  };
  const ctx = vm.createContext({
    window, document, location, S, ACT, VIEWS: {}, COMMANDS: [], HOSTED: null, EMBED: embed,
    embedTell: (msg) => told.push(msg),
    history: { replaceState(_s, _t, h) { location.hash = h; }, back() {} },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    queueMicrotask: (fn) => queueMicrotask(fn),
    requestAnimationFrame: () => 0,
    Element: window.Element, HTMLElement: window.HTMLElement, Event: window.Event, CustomEvent: window.CustomEvent,
    $: (sel, root = document) => root.querySelector(sel),
    esc: (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    ic: (n) => `<svg data-ic="${n}"></svg>`,
    toast() {}, themeRow: () => "", agentInfo: (id) => ({ name: id }),
    archivedProjectsHTML: () => "", closeSwitcher() {}, copyText() {},
    homeShort: (v) => String(v || ""),
    routeToHash: () => "proj",
    api,
    loadAgents: async () => {},
    refreshEmptyAgents() {},
    refreshRunLabels() {},
    renderRail,
    render() {
      if (vm.runInContext("settingsUp()", ctx)) { ctx.renderSettingsModal(); renderRail(); }
      else { ctx.dropSettingsModal(); renderRail(); }
    },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  });
  vm.runInContext(read("public/lines/setup.js"), ctx, { filename: "public/lines/setup.js" });
  vm.runInContext(read("public/lines/settings.js"), ctx, { filename: "public/lines/settings.js" });
  renderRail();
  return { ctx, document, storage, S, told, listeners, get railRenders() { return railRenders; } };
}

test("clicking the rail Settings gear dismisses its badge immediately and persistently across reloads", () => {
  const storage = new Map();
  const first = makeHarness({ storage, problems: 4 });
  assert.equal(first.document.querySelector(".rail-gear .setup-count")?.textContent, "4");
  assert.equal(first.document.querySelector(".rail-gear")?.getAttribute("aria-label"), "Settings: 4 to fix");

  first.ctx.ACT["open-settings"]();
  assert.equal(first.document.querySelector(".rail-gear .setup-count"), null, "clicking the gear dismisses its badge immediately");
  assert.equal(first.document.querySelector(".rail-gear")?.getAttribute("aria-label"), "Settings");
  assert.equal(storage.get("penecho-rail-settings-badge"), "dismissed");
  assert.equal(first.document.querySelector("#sysTab-agents .setup-count")?.textContent, "4", "Agents tab inside Settings still shows the count");

  first.ctx.ACT["settings-close"]();
  assert.equal(first.document.querySelector(".rail-gear .setup-count"), null, "badge stays dismissed after closing Settings");

  // Reloading with the same localStorage and the same 4 problems never brings the rail reminder back.
  const reloaded = makeHarness({ storage, problems: 4 });
  assert.equal(reloaded.document.querySelector(".rail-gear .setup-count"), null, "badge stays dismissed across reloads");
  assert.equal(reloaded.document.querySelector(".rail-gear")?.getAttribute("aria-label"), "Settings");
});

test("opening Settings with zero problems does not prematurely suppress the first future reminder", () => {
  const storage = new Map();
  const h = makeHarness({ storage, problems: 0 });
  assert.equal(h.document.querySelector(".rail-gear .setup-count"), null);

  h.ctx.ACT["open-settings"]();
  h.ctx.ACT["settings-close"]();
  assert.equal(storage.get("penecho-rail-settings-badge"), undefined);

  h.S.agentCheck = { problems: 2, agents: [] };
  h.ctx.renderRail();
  assert.equal(h.document.querySelector(".rail-gear .setup-count")?.textContent, "2");

  h.ctx.ACT["open-settings"]();
  assert.equal(h.document.querySelector(".rail-gear .setup-count"), null);
  assert.equal(storage.get("penecho-rail-settings-badge"), "dismissed");
});

test("late checkAgents or setup-try resolution while Agents tab is open dismisses the rail badge before drawing the rail", async () => {
  const storage = new Map();
  const h = makeHarness({ storage, problems: null, api: async () => ({ problems: 3, agents: [] }) });
  h.ctx.ACT["open-settings"]();
  await h.ctx.checkAgents();
  assert.equal(h.document.querySelector(".rail-gear .setup-count"), null);
  assert.equal(storage.get("penecho-rail-settings-badge"), "dismissed");

  const tryStorage = new Map();
  const t = makeHarness({ storage: tryStorage, problems: 0, api: async () => ({ problems: 1, agents: [] }) });
  t.ctx.ACT["open-settings"]();
  await t.ctx.ACT["setup-try"]({ dataset: { agent: "codex" } });
  assert.equal(t.document.querySelector(".rail-gear .setup-count"), null);
  assert.equal(tryStorage.get("penecho-rail-settings-badge"), "dismissed");
});

test("embedded rail and other browser tabs dismiss the rail badge via localStorage", () => {
  const embedStorage = new Map();
  const embedded = makeHarness({ storage: embedStorage, problems: 4, embed: { rail: true, canvas: "", project: "proj", line: "" } });
  assert.equal(embedded.document.querySelector(".rail-gear .setup-count")?.textContent, "4");
  embedded.ctx.ACT["open-settings"]();
  assert.equal(embedStorage.get("penecho-rail-settings-badge"), "dismissed");
  assert.equal(embedded.document.querySelector(".rail-gear .setup-count"), null);
  assert.deepEqual(embedded.told.map((m) => ({ ...m })), [{ leave: "/projects.html#agents" }]);

  const otherStorage = new Map();
  const otherTab = makeHarness({ storage: otherStorage, problems: 4 });
  assert.equal(otherTab.document.querySelector(".rail-gear .setup-count")?.textContent, "4");
  otherStorage.set("penecho-rail-settings-badge", "dismissed");
  for (const fn of otherTab.listeners.get("storage") || []) fn({ key: "penecho-rail-settings-badge", newValue: "dismissed" });
  assert.equal(otherTab.document.querySelector(".rail-gear .setup-count"), null);

  // Direct hash navigation to #agents / #setup renders the modal and clears the rail badge before drawing the rail.
  const hashStorage = new Map();
  const direct = makeHarness({ storage: hashStorage, problems: 4 });
  assert.equal(direct.document.querySelector(".rail-gear .setup-count")?.textContent, "4");
  direct.S.shelfPage = "agents";
  direct.ctx.render();
  assert.equal(direct.document.querySelector(".rail-gear .setup-count"), null);
  assert.equal(hashStorage.get("penecho-rail-settings-badge"), "dismissed");
});
