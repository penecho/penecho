"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

function makeEmptyPageHarness({ hosted = false, presets = null, agents = null, agentCheck = null, thisComputer = true } = {}) {
  const { document } = parseHTML('<html><body><div id="view"></div></body></html>');
  const menus = [];
  const p = {
    id: "asdf",
    name: "asdf",
    vault: { path: "/Users/test/tmp/asdf", code: [] },
    code: "",
    lines: [],
    landed: [],
    backlog: [],
    notes: [],
    pictures: [],
    files: [],
    offerSkill: true,
    canvasSkill: false,
    memorySkill: true,
    projectMemory: true,
    defaultAgent: "codex",
  };
  const S = {
    cur: p.id,
    route: { view: "home" },
    comp: {},
    projects: [],
    agents: agents || [
      { id: "claude", name: "Claude Code", mono: "Cl", color: "#a84b26", available: true, runs: true },
      { id: "codex", name: "Codex", mono: "Cx", color: "#1e293b", available: true, runs: true },
      { id: "opencode", name: "OpenCode", mono: "Oc", color: "#334155", available: true, runs: true },
      { id: "pi", name: "Pi", mono: "Pi", color: "#0f766e", available: true, runs: true },
      { id: "kimi", name: "Kimi", mono: "Ki", color: "#4f46e5", available: true, runs: true },
      { id: "cursor", name: "Cursor", mono: "Cu", color: "#64748b", available: true, runs: false },
    ],
    agentCheck,
    agentChecking: false,
    agentCheckError: "",
    thisComputer,
    openFolderLabel: thisComputer ? "Show in Finder" : "",
    presets: presets === undefined ? {
      default: "p-codex",
      presets: [
        { id: "p-codex", name: "Codex · gpt-6.2-astra", agent: "codex", available: true, showInPicker: true },
        { id: "p-claude", name: "Claude Code · opus", agent: "claude", available: true, showInPicker: true },
      ],
    } : presets,
    syncing: false,
    noteOnly: false,
  };
  const agentInfo = id => S.agents.find(a => a.id === id) || { id, name: id, mono: id.slice(0, 2), color: "#334155" };
  const runnableAgents = () => S.agents.filter(a => a.available && a.runs !== false);
  const runnablePresets = () => (S.presets?.presets || []).filter(x => x.available && runnableAgents().some(a => a.id === x.agent));
  const presetById = id => runnablePresets().find(x => x.id === id) || null;
  const defaultPreset = () => presetById(S.presets?.default);

  const context = vm.createContext({
    document,
    localStorage: { getItem: () => null },
    navigator: { platform: "MacIntel", userAgent: "Mac" },
    getComputedStyle: () => ({ lineHeight: "22px", paddingTop: "4px", paddingBottom: "4px" }),
    HOSTED: hosted ? { key: "k", read: false, shared: false } : null,
    ACT: {},
    SEND: {},
    VIEWS: {},
    S,
    $: (s, r = document) => r.querySelector(s),
    $$: (s, r = document) => [...r.querySelectorAll(s)],
    esc: v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c])),
    ic: name => `<svg data-ic="${name}"></svg>`,
    av: (id, size = 24) => `<span class="av" data-av="${id}" data-size="${size}">${agentInfo(id).mono}</span>`,
    agentInfo,
    runnableAgents,
    runnablePresets,
    presetById,
    defaultPreset,
    can: what => !(hosted && ["agents", "paste", "favorites"].includes(what)),
    canCheckAgents: () => S.thisComputer,
    project: () => p,
    allLines: () => [],
    detectPath: () => ({ kind: "line" }),
    boxTarget: () => null,
    branchPicker: () => "",
    openMenu: (el, items, opts) => menus.push({ el, items, opts }),
    closeMenu() {},
    toast() {},
    render() {},
    checkAgents: async () => {},
    homeShape: () => "empty",
    fvBackTo() {},
    fvPendingTry() {},
    requestAnimationFrame() {},
    addEventListener() {},
    setTimeout,
    clearTimeout,
  });

  const state = fs.readFileSync(require.resolve("../public/lines/state.js"), "utf8");
  const start = state.indexOf("const readLists =");
  assert.ok(start >= 0);
  vm.runInContext(state.slice(start, state.indexOf("\n", start)), context);
  vm.runInContext(fs.readFileSync(require.resolve("../public/lines/composer.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(require.resolve("../public/lines/pages.js"), "utf8"), context);
  return { document, context, p, S, menus };
}

test("empty project page renders work-first layout, compact Your agents bar, and no agent pill in composer", () => {
  const { document, context, p, S, menus } = makeEmptyPageHarness({
    presets: {
      default: "p-codex",
      presets: [
        { id: "p-codex", name: "Codex · gpt-6.2-astra", agent: "codex", available: true, showInPicker: true },
      ],
    },
  });

  const view = document.querySelector("#view");
  view.innerHTML = context.emptyHTML(p);
  const form = view.querySelector(".composer");
  context.syncComposer(form);

  // Initial checking state before agentCheck resolves still keeps Your agents link accessible
  assert.ok(view.querySelector("#emptyAgents .empty-agent-state").textContent.includes("Checking"));
  assert.ok(view.querySelector('#emptyAgents [data-act="open-agents"]'));

  // Once agent check completes, stacked avatars (max 4) and ready count appear
  S.agentCheck = { agents: S.agents.map(a => ({ id: a.id, state: "ready" })) };
  context.refreshEmptyAgents();

  // 1. Header & inline folder metadata (no duplicate code prompt or bottom docs path)
  assert.equal(view.querySelector(".empty-head h1").textContent, "asdf");
  const meta = view.querySelector(".where.empty-meta");
  assert.ok(meta, "inline folder metadata rendered");
  assert.ok(meta.textContent.includes("/Users/test/tmp/asdf"));
  assert.equal(meta.querySelector('[data-act="edit-code"]').textContent, "+ Link code folder");
  assert.equal(view.querySelector(".empty-foot").textContent.includes("/Users/test/tmp/asdf"), false, "docs path is not repeated in footer");

  // 2. Compact Your agents bar with direct link to open-agents + overflow menu
  const bar = view.querySelector("#emptyAgents .empty-agents-bar");
  assert.ok(bar);
  assert.equal(bar.querySelectorAll(".avs .av").length, 4, "stacked avatars capped at 4");
  assert.equal(bar.querySelector(".empty-agents-count").textContent, "6 agents ready");
  assert.equal(bar.querySelector(".empty-agents-warn"), null, "no warning badge when no agent needs a fix");
  const manageBtn = bar.querySelector('[data-act="open-agents"]');
  assert.ok(manageBtn);
  assert.ok(manageBtn.textContent.includes("Your agents"));

  const moreBtn = bar.querySelector('[data-act="empty-agents-menu"]');
  assert.ok(moreBtn);
  context.ACT["empty-agents-menu"](moreBtn);
  assert.equal(menus.length, 1);
  assert.deepEqual(Array.from(menus[0].items, i => i.label), ["Your agents", "Set up agents", "Check again"]);

  // 3. The agent setup hint has a place before the work-first layout.
  const children = [...view.querySelector(".empty-inner").children].map(el => el.id ? `#${el.id}` : el.className);
  assert.deepEqual(children, [
    "#agentsHint",
    "empty-head",
    "empty-hero",
    "start-two",
    "skill-pair is-slim",
    "examples",
    "empty-foot",
  ]);

  // 4. Composer omits any agent pill beside Send to AI (user chooses "Run with" on the Line later)
  assert.equal(form.dataset.agentPill, undefined, "no data-agent-pill attribute on composer");
  assert.equal(form.querySelector(".cmp-agent"), null, "no .cmp-agent slot in composer");
  assert.equal(form.querySelector(".cmp-agent-pill"), null, "no default-agent pill beside Send to AI");
  assert.ok(form.querySelector(".send-btn"), "Send to AI button still rendered");

  // 5. Two compact action cards & slim skill strip & 3 examples
  assert.equal(view.querySelector(".start-canvas-btn strong").textContent, "Open the Canvas");
  assert.equal(view.querySelector(".start-code-btn strong").textContent, "Sync from a code folder");
  assert.ok(view.querySelector('.skill-offer.is-slim [data-act="skill-add"]'));
  assert.ok(view.querySelector('.skill-offer.is-slim [data-act="skill-later"]'));
  assert.equal(view.querySelectorAll('.examples [data-act="open-example"]').length, 3);
  assert.ok(view.querySelector('.empty-foot [data-act="starter-prompt"]'));
});

test("empty project page updates cleanly for linked code folder and agent fix warning", () => {
  const { document, context, p, S } = makeEmptyPageHarness({
    presets: null,
    agentCheck: {
      agents: [
        { id: "claude", state: "ready" },
        { id: "codex", state: "problem" },
      ],
    },
  });
  p.code = "/Users/test/code/asdf";
  p.vault.code = [{ path: "/Users/test/code/asdf" }];
  p.offerSkill = false;

  const view = document.querySelector("#view");
  view.innerHTML = context.emptyHTML(p);

  const meta = view.querySelector(".where.empty-meta");
  assert.ok(meta.textContent.includes("/Users/test/code/asdf"));
  assert.equal(meta.querySelector('[data-act="edit-code"]').textContent, "Change");
  assert.equal(view.querySelector(".start-code-btn strong").textContent, "Sync recent conversations");
  assert.equal(view.querySelector(".skill-pair"), null, "skill strip absent when already dismissed/installed");

  const warn = view.querySelector('#emptyAgents .empty-agents-warn[data-act="open-setup"]');
  assert.ok(warn, "amber warning badge links to CLI setup");
  assert.equal(warn.textContent, "1 needs a fix");

  // Updating agent check refreshes the bar in place
  S.agentCheck = { agents: [{ id: "claude", state: "ready" }, { id: "codex", state: "ready" }] };
  context.refreshEmptyAgents();
  assert.equal(view.querySelector("#emptyAgents .empty-agents-warn"), null);
});

test("hosted mode hides computer-only empty page controls", () => {
  const { document, context, p } = makeEmptyPageHarness({ hosted: true });
  const view = document.querySelector("#view");
  view.innerHTML = context.emptyHTML(p);
  const form = view.querySelector(".composer");
  context.syncComposer(form);
  assert.equal(form.querySelector(".cmp-agent-pill"), null, "no agent pill in hosted mode");

  const hostedSrc = fs.readFileSync(require.resolve("../public/lines/hosted.js"), "utf8");
  assert.ok(hostedSrc.includes("'.empty-agents'"), "hosted.js hides .empty-agents");
  assert.ok(hostedSrc.includes("'.where'"), "hosted.js hides .where");
});
