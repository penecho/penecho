"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const { Service } = require("../src/server/project-lines/service.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pe-agent-presets-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
const fresh = name => { const dir = path.join(temp, `${name}-${++counter}`); fs.mkdirSync(dir, { recursive:true }); return dir; };
// A command for each agent that only says its version, so it counts as here.
function fakeAgents(home, ids) {
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive:true });
  for (const id of ids) fs.writeFileSync(path.join(bin, id), "#!/bin/sh\necho 1.0.0\n", { mode:0o755 });
  return createAgents({ env:{ HOME:home, PATH:bin }, appFolders:[] });
}
const at = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

function presetEditor(runner = { id:"codex", name:"Codex", available:true }) {
  const { document, window } = require("./helpers/dom.js").parseHTML("<html><body></body></html>");
  const vm = require("node:vm");
  const agents = fakeAgents(fresh("home"), [runner.id]), file = path.join(fresh("state"), "presets.json");
  const store = createAgentPresets({ file, agents });
  const S = { presets:store.list(), agentCheck:{ agents:[runner] } };
  const ctx = vm.createContext({ document, S, ACT:{}, esc:String, ic:() => "", av:() => "", agentInfo:() => runner, runnableAgents:() => [runner],
    $:s => document.querySelector(s), requestAnimationFrame:fn => fn(), toast:assert.fail,
    render:() => { document.body.innerHTML = ctx.agentsSectionHTML(); },
    // linkedom supplies the elements; serialize the enabled controls as a browser would.
    FormData:class extends Map {
      constructor(form) {
        super();
        for (const el of form.querySelectorAll("[name]:not([disabled])")) {
          if (el.type !== "checkbox") this.set(el.name, el.value);
          else if (el.hasAttribute("checked")) this.set(el.name, "on");
        }
      }
    },
    api:async (url, { method, body }) => {
      if (method === "POST" && url === "/agent-presets") store.add(body);
      else { assert.equal(method, "PATCH"); store.update(url.split("/").at(-1), body); }
      return store.list();
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve("../public/lines/settings.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(require.resolve("../public/lines/setup.js"), "utf8"), ctx);
  return { document, window, ctx, store, file, agents };
}

test("Your agents sorts displayed names without changing preset order or the default", () => {
  const { document, ctx } = presetEditor();
  const presets = [
    { id:"open", name:"OpenCode", agent:"opencode", available:true },
    { id:"ten", name:"Codex 10", agent:"codex", available:true },
    { id:"omp", name:"omp", agent:"omp", available:false },
    { id:"two", name:"Codex 2", agent:"codex", available:true, showInPicker:false },
  ];
  ctx.S.presets = { default:"ten", presets };
  const names = () => Array.from(document.querySelectorAll(".sys-text strong > span:first-child"), el => el.textContent);

  ctx.render();
  assert.deepEqual(names(), ["Codex 2", "Codex 10", "omp", "OpenCode"]);
  assert.deepEqual(presets.map(x => x.id), ["open", "ten", "omp", "two"]);
  assert.equal(document.querySelector(".sys-default").closest("[data-preset]").dataset.preset, "ten");
  assert.ok(document.querySelector('[data-preset="omp"].is-off'));
  const edit = document.querySelector('[data-preset="two"] [data-act="preset-edit"]');
  ctx.ACT["preset-edit"](edit);
  assert.equal(document.querySelector('input[name="name"]').value, "Codex 2");
  ctx.ACT["preset-cancel"]();
  assert.deepEqual(names(), ["Codex 2", "Codex 10", "omp", "OpenCode"]);

  ctx.HOSTED = true;
  ctx.S.agents = presets.filter(x => x.available);
  ctx.render();
  assert.deepEqual(names(), ["Codex 2", "Codex 10", "OpenCode"]);
  assert.deepEqual(ctx.S.agents.map(x => x.id), ["open", "ten", "two"]);
});

test("a saved agent left on Default is listed with the model and effort its own settings give it, or default", () => {
  const runner = { id:"codex", name:"Codex", available:true, model:{ name:"gpt-6.2-sol", effort:"xhigh" } };
  const { document, ctx } = presetEditor(runner);
  const title = x => { document.body.innerHTML = ctx.presetRowHTML({ id:"x", agent:"codex", available:true, model:"", effort:"", ...x }, ""); return document.querySelector(".sys-text strong > span").textContent; };
  assert.equal(title({ name:"Codex" }), "Codex · gpt-6.2-sol · xhigh effort");
  assert.equal(title({ name:"Codex · gpt-6.2-astra", model:"gpt-6.2-astra" }), "Codex · gpt-6.2-astra · xhigh effort");
  assert.equal(title({ name:"Codex · medium effort", effort:"medium" }), "Codex · gpt-6.2-sol · medium effort");
  assert.equal(title({ name:"My Codex" }), "My Codex");
  assert.match(document.querySelector(".sys-text small").textContent, /^gpt-6\.2-sol · xhigh effort/);
  runner.model = {};
  assert.equal(title({ name:"Codex" }), "Codex · default model · default effort");
});

test("copying an automatic agent prefills its displayed model and effort, including custom values", () => {
  const runner = { id:"claude", name:"Claude Code", available:true,
    model:{ picked:"", pickedEffort:"", name:"claude-opus-4-8", effort:"max", choices:["claude-opus-4-8"], efforts:["high","max"] } };
  const { document, ctx } = presetEditor(runner);
  const copy = () => ctx.ACT["preset-copy"]({ dataset:{ id:"auto:claude" } });
  const selected = name => document.querySelector(`select[name="${name}"] option[selected]`);
  copy();
  assert.equal(selected("modelChoice").value, "claude-opus-4-8");
  assert.equal(selected("effortChoice").value, "max");
  Object.assign(runner.model, { name:"custom-model", effort:"turbo" });
  copy();
  assert.ok(selected("modelChoice").hasAttribute("data-custom"));
  assert.ok(selected("effortChoice").hasAttribute("data-custom"));
  assert.equal(document.querySelector('input[name="model"]').value, "custom-model");
  assert.equal(document.querySelector('input[name="effort"]').value, "turbo");
});

test("only available adjustable agents without launch or runtime effort receive a ratings nudge", () => {
  const { document, ctx } = presetEditor();
  const claude = { id:"auto:claude", name:"Claude Code", agent:"claude", auto:true, available:true };
  const rows = [claude,
    { ...claude, id:"saved", auto:false },
    { ...claude, id:"explicit", auto:false, effort:"max" },
    { ...claude, id:"unavailable", available:false },
    ...["codex", "penecho", "fixed", "unknown", "picked", "kimi"].map(agent => ({ ...claude, id:`auto:${agent}`, agent })),
    { ...claude, id:"kimi-saved", agent:"kimi", auto:false, model:"other-model" }];
  ctx.S.agentCheck.agents.push(
    { id:"claude", model:{} },
    { id:"kimi", model:{ name:"k3", effort:"high" } },
    { id:"penecho", model:{} },
    { id:"fixed", model:{ fixed:true } },
    { id:"picked", model:{ pickedEffort:"high" } },
  );
  ctx.S.agentCheck.agents[0].model = {};
  for (const row of rows) {
    assert.equal(ctx.presetNotRated(row), [claude.id, "saved"].includes(row.id), row.id);
    document.body.innerHTML = ctx.presetRowHTML(row, "");
    // A CLI with no preset yet is on the Ready to add shelf: one Add preset, no rating chips; a saved one says Not rated.
    assert.equal(!!document.querySelector(".kind-tag.is-amber"), row.id === "saved", row.id);
    const copy = document.querySelector('[data-act="preset-copy"]');
    if (row.auto) {
      assert.equal(copy.textContent, "Add preset", row.id);
      assert.equal(document.querySelector(".sys-acts .kind-tag"), null, row.id);
      assert.equal(document.querySelector('[data-act="preset-edit"]'), null, row.id);
    } else assert.ok(document.querySelector('[data-act="preset-edit"]'));
  }
  ctx.S.agentCheck = null;
  assert.doesNotMatch(ctx.presetRowHTML(claude, ""), /Not rated/);
});

test("the amber bar counts unrated saved presets, pins all of them with a suggested effort and remembers dismissal", async () => {
  const runner = { id:"claude", name:"Claude Code", available:true, model:{ name:"opus", efforts:["high", "max"] } };
  const { ctx, document, store } = presetEditor(runner);
  const stored = new Map();
  ctx.localStorage = { getItem:key => stored.get(key), setItem:(key, value) => stored.set(key, value) };
  ctx.toast = () => {};
  ctx.S.thisComputer = true;
  const first = store.add({ agent:"claude", model:"opus", effort:"", default:true });
  const second = store.add({ agent:"claude", model:"sonnet", effort:"", name:"Claude Code 2" });
  ctx.S.presets = store.list();
  ctx.render();
  const strip = () => document.querySelector(".agent-notice");
  assert.match(strip().textContent, /2 agents aren't being rated\./);
  ctx.ACT["preset-pin-all"]();
  const form = document.querySelector('.sys-form[data-form="pin-all"]');
  assert.equal(form.querySelectorAll(".pin-all-row").length, 2);
  assert.match(form.querySelector('button[type="submit"]').textContent, /Pin 2 agents/);
  for (const select of form.querySelectorAll("select")) assert.equal(select.querySelector("option[selected]").value, "high");
  await ctx.pinAllSave({ querySelectorAll:sel => sel === 'input[name="pin"]'
    ? Array.from(form.querySelectorAll('input[name="pin"]'), el => ({ checked:true, value:el.value }))
    : Array.from(form.querySelectorAll('[name^="effort:"]'), el => ({ name:el.name, value:el.querySelector("option[selected]").value })) });
  const { presets, default:chosen } = store.list();
  assert.ok(presets.every(x => !x.auto && x.agent === "claude" && x.effort === "high"));
  assert.equal(chosen, first.id, "pinning keeps the default preset");
  ctx.S.presets = store.list();
  ctx.render();
  assert.equal(strip(), null);
  ctx.S.presets = { default:"", presets:[{ ...first, effort:"" }, { ...second, effort:"" }] };
  ctx.render();
  ctx.ACT["dismiss-agents-rating-strip"]();
  assert.equal(stored.get("penecho-agents-rating-strip"), "dismissed");
  assert.equal(strip(), null);
  const reopened = presetEditor(runner).ctx;
  Object.assign(reopened.S, { thisComputer:true, presets:ctx.S.presets });
  reopened.localStorage = ctx.localStorage;
  assert.doesNotMatch(reopened.agentsSectionHTML(), /Pin all/);
});

test("pinning a found agent opens under its row with an effort chosen and keeps Default behind a typed effort", async () => {
  const runner = { id:"claude", name:"Claude Code", available:true, model:{ name:"opus", efforts:["low", "medium", "high"] } };
  const { ctx, document, store } = presetEditor(runner);
  ctx.toast = () => {};
  ctx.S.thisComputer = true;
  const [auto] = ctx.S.presets.presets;
  ctx.ACT["preset-pin-default"]({ dataset:{ id:auto.id } });
  const panel = document.querySelector(".sys-row.is-pinning");
  assert.ok(panel.previousElementSibling.matches(`[data-preset="${auto.id}"]`));
  assert.equal(document.querySelector('select[name="effortChoice"] option[selected]').value, "medium");
  assert.equal(document.querySelector('select[name="effortChoice"] option[value=""]'), null);
  assert.match(document.querySelector('button[type="submit"]').textContent, /Add &(amp;)? make default/);
  assert.equal(document.querySelector('[data-act="preset-copy"]'), null);
  await ctx.presetSave(document.querySelector(".sys-form"));
  const made = store.list().presets.find(x => !x.auto);
  assert.equal(made.effort, "medium");
  assert.equal(store.list().default, made.id);
  ctx.render();
  assert.match(document.querySelector(`[data-preset="${made.id}"]`).textContent, /Rated from next Work/);
});

test("Test run in the pin panel tries the picked model and effort, and its answer goes when they change", async () => {
  const runner = { id:"claude", name:"Claude Code", available:true, model:{ name:"opus", efforts:["low", "medium", "high"] } };
  const { ctx, document } = presetEditor(runner);
  ctx.S.thisComputer = true;
  const calls = [];
  ctx.api = async (url, { method, body }) => { calls.push(JSON.stringify([method, url, body])); return { tried:{ ok:true, error:"" } }; };
  ctx.ACT["preset-copy"]({ dataset:{ id:ctx.S.presets.presets[0].id } });
  assert.equal(document.querySelector('[data-act="preset-try"]').textContent, "Test run");
  await ctx.ACT["preset-try"]();
  assert.deepEqual(calls, [JSON.stringify(["POST", "/agents/try/claude", { model:"opus", effort:"medium" }])]);
  assert.match(document.querySelector(".sys-form footer").textContent, /Answered/);
  assert.equal(document.querySelector('[data-act="preset-try"]').textContent, "Test again");
  require("node:vm").runInContext("SET.form.effort = \"high\"", ctx); ctx.render();
  assert.doesNotMatch(document.querySelector(".sys-form footer").textContent, /Answered/);
  ctx.api = async () => ({ tried:{ ok:false, error:"No answer in 120 seconds." } });
  await ctx.ACT["preset-try"]();
  assert.match(document.querySelector(".preset-try-said.is-failed").textContent, /No answer in 120 seconds/);
});

test("the local Home setup hint updates in place and stays dismissed", () => {
  const { document, ctx } = presetEditor();
  ctx.S.thisComputer = true;
  const [auto] = ctx.S.presets.presets;
  const saved = { ...auto, id:"saved", auto:false, allowDelegation:true };
  const stored = new Map();
  ctx.localStorage = { getItem:key => stored.get(key), setItem:(key, value) => stored.set(key, value) };
  document.body.innerHTML = '<div id="agentsHint"></div>';
  const host = document.querySelector("#agentsHint");
  const update = (...presets) => ctx.updateAgentPresets({ presets });
  update({ ...auto, agent:"penecho" });
  assert.equal(host.innerHTML, "");
  update(auto, { ...saved, agent:"claude", effort:"" }, { ...saved, effort:"high", allowDelegation:false }, { ...saved, available:false });
  const action = host.querySelector('[data-act="open-agents"]');
  assert.ok(action);
  ctx.refreshAgentsSetupHint();
  assert.equal(host.querySelector('[data-act="open-agents"]'), action, "an unchanged hint keeps its controls");
  update(auto, { ...saved, agent:"claude", effort:"max" });
  assert.equal(host.innerHTML, "");
  update(auto, saved);
  assert.equal(host.innerHTML, "", "saved Codex is eligible with its default effort");
  ctx.HOSTED = true;
  update(auto);
  assert.equal(host.innerHTML, "");
  ctx.HOSTED = false;
  ctx.S.thisComputer = false;
  assert.equal(ctx.agentsSetupHintHTML(), "");
  ctx.S.thisComputer = true;
  ctx.refreshAgentsSetupHint();
  assert.ok(host.querySelector('[aria-label="Dismiss"]'));
  ctx.ACT["dismiss-agents-setup-hint"]();
  assert.equal(stored.get("penecho-agents-setup-hint"), "dismissed");
  assert.equal(host.innerHTML, "");
  const reopened = presetEditor().ctx;
  reopened.S.thisComputer = true;
  reopened.localStorage = ctx.localStorage;
  assert.equal(reopened.agentsSetupHintHTML(), "");
});

test("dsh has no runner model or effort in Local providers, and its presets save custom models and efforts", async () => {
  const { modelOf } = require("../src/server/project-lines/agent-model.js");
  const dshHome = fresh("dsh"), profile = path.join(dshHome, "profiles", "headless");
  fs.mkdirSync(profile, { recursive:true });
  fs.writeFileSync(path.join(profile, "package.json"), JSON.stringify({ dsh:{ profile:{ bundles:["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }));
  fs.writeFileSync(path.join(profile, "cordis.patch.yml"), JSON.stringify([{ id:"llm-pi-ai", config:{ providers:{ local:{ models:[{ id:"plain", reasoningEfforts:false }] } } } }]));
  const model = modelOf("dsh", { DSH_HOME:dshHome });
  const runner = { id:"dsh", name:"dsh", state:"ready", available:true, model };
  const { document, window, ctx, store } = presetEditor(runner);
  const selected = (value, field) => {
    const select = document.querySelector(`[name="${field}"]`);
    select.querySelector(value ? `option[value="${value}"]` : "option[data-custom]").selected = true;
    select.dispatchEvent(new window.Event("change", { bubbles:true }));
  };
  // Local providers owns the CLI's health only: models and efforts are chosen in Preset agents.
  ctx.homeShort = value => value;
  Object.assign(runner, { where:"/bin/dsh", problems:[] });
  document.body.innerHTML = ctx.setupRowHTML(runner);
  for (const gone of ["[data-model-agent]", "[data-effort-agent]", ".setup-model", '[data-act="setup-model"]']) assert.equal(document.querySelector(gone), null, gone);
  assert.equal(document.querySelector('[data-act="setup-create-preset"]').dataset.agent, "dsh");
  assert.equal(ctx.setupModelHTML, undefined);
  assert.equal(ctx.pickAgentModel, undefined);

  ctx.render = () => { document.body.innerHTML = ctx.agentsSectionHTML(); };
  ctx.ACT["preset-new"]();
  assert.equal(document.querySelector('[name="effortChoice"] option[value=""]').textContent, "Default (high)");
  selected("local/plain", "modelChoice");
  assert.deepEqual([...document.querySelectorAll('[name="effortChoice"] option:not([data-custom])')].map(el => el.value), ["", "off"]);
  selected("deepseek-official/deepseek-v4-pro", "modelChoice");
  selected("max", "effortChoice");
  await ctx.presetSave(document.querySelector("form"));
  const saved = store.list().presets[0];
  assert.deepEqual([saved.agent, saved.model, saved.effort], ["dsh", "deepseek-official/deepseek-v4-pro", "max"]);
  ctx.ACT["preset-edit"]({ dataset:{ id:saved.id } });
  selected("", "modelChoice");
  document.querySelector('[name="model"]').value = "gateway/vendor/my-model";
  document.querySelector('[name="model"]').dispatchEvent(new window.Event("change", { bubbles:true }));
  assert.ok(document.querySelector('[name="effortChoice"] option[value="medium"]'), "typed models retain basic suggestions");
  selected("", "effortChoice");
  document.querySelector('[name="effort"]').value = "custom";
  await ctx.presetSave(document.querySelector("form"));
  assert.deepEqual([store.get(saved.id).model, store.get(saved.id).effort], ["gateway/vendor/my-model", "custom"]);
});

test("the preset editor saves picker visibility and assignment eligibility independently", async () => {
  const { document, window, ctx, agents, file } = presetEditor();
  const input = name => document.querySelector(`input[name="${name}"]`);
  ctx.toast = message => assert.match(message, /^Pinned Codex .*rated from the next Work\.$/);
  ctx.ACT["preset-copy"]({ dataset:{ id:"auto:codex" } });
  assert.ok(input("showInPicker").hasAttribute("checked") && input("allowDelegation").hasAttribute("checked"), "a new saved preset starts with both choices on");
  for (const [listed, assignable] of [[true, true], [false, true], [true, false], [false, false]]) {
    for (const [name, value] of [["showInPicker", listed], ["allowDelegation", assignable]]) {
      const checkbox = input(name);
      assert.equal(checkbox.type, "checkbox");
      assert.ok(document.getElementById(checkbox.getAttribute("aria-labelledby")).textContent);
      assert.ok(document.getElementById(checkbox.getAttribute("aria-describedby")).textContent);
      checkbox.toggleAttribute("checked", value);
      checkbox.dispatchEvent(new window.Event("change", { bubbles:true }));
    }
    document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles:true, cancelable:true }));
    await new Promise(resolve => setImmediate(resolve));
    const [saved] = createAgentPresets({ file, agents }).list().presets;
    assert.deepEqual([saved.showInPicker, saved.allowDelegation], [listed, assignable]);
    const edit = document.querySelector(`[data-preset="${saved.id}"] [data-act="preset-edit"]`);
    assert.ok(edit, "the preset stays editable with either choice off");
    ctx.ACT["preset-edit"](edit);
    assert.equal(input("showInPicker").hasAttribute("checked"), listed);
    assert.equal(input("allowDelegation").hasAttribute("checked"), assignable);
  }
});

test("presets update effort by model, accept a custom model, and reopen the saved settings", async () => {
  const model = { name:"new-model", effort:"high", efforts:["low", "high"], choices:["tiered", "fixed"], effortsFor:{ tiered:["medium"], fixed:[] } };
  const { document, window, ctx, store, agents } = presetEditor({ id:"codex", name:"Codex", available:true, model });
  const field = name => document.querySelector(`[name="${name}"]`);
  const change = element => element.dispatchEvent(new window.Event("change", { bubbles:true }));
  const pick = (name, value) => { const select = field(name); select.querySelector(value === null ? 'option[data-custom]' : `option[value="${value}"]`).selected = true; change(select); };
  const levels = () => Array.from(field("effortChoice").querySelectorAll('option:not([data-custom])'), option => option.value);
  ctx.ACT['preset-new']();
  assert.deepEqual(levels(), ["", "low", "high"], "uncatalogued configured model remains adjustable");
  pick("effortChoice", "high"); pick("modelChoice", "tiered");
  assert.deepEqual(levels(), ["", "medium"], "previous model's high level is not carried forward");
  pick("effortChoice", "medium"); pick("modelChoice", "fixed");
  assert.deepEqual(levels(), [""], "a model its agent lists with no levels offers none of its own");
  assert.ok(field("effortChoice").querySelector('option[data-custom]'), "but an effort can still be typed");
  assert.doesNotMatch(document.body.textContent, /not listed|No adjustable effort/);
  pick("modelChoice", null);
  field("model").value = "custom-id"; change(field("model")); pick("effortChoice", "high");
  await ctx.presetSave(document.querySelector('form'));
  const [saved] = store.list().presets;
  assert.deepEqual([saved.model, saved.effort], ["custom-id", "high"]);
  const command = agents.command("codex", { workdir:temp, docs:temp, ...store.handOver(saved) });
  assert.deepEqual([command.thread.model, command.turn.effort], ["custom-id", "high"]);
  ctx.ACT['preset-edit']({ dataset:{ id:saved.id } });
  assert.equal(field("model").value, "custom-id");
  assert.equal(field("effortChoice").value, "high");
  // Any effort can be typed, and it reopens as typed.
  pick("effortChoice", null);
  assert.ok(field("effort"), "Type another effort opens a box");
  field("effort").value = "turbo"; change(field("effort"));
  await ctx.presetSave(document.querySelector('form'));
  assert.equal(store.get(saved.id).effort, "turbo");
  ctx.ACT['preset-edit']({ dataset:{ id:saved.id } });
  assert.equal(field("effort").value, "turbo");
  assert.ok(field("effortChoice").querySelector('option[data-custom]').hasAttribute("selected"));
  assert.throws(() => store.update(saved.id, { effort:"--yolo" }), { code:"BAD_PRESET" });
  // Nothing known about the runner's models yet: the basic levels are still there.
  const { document:bare, ctx:bareCtx } = presetEditor({ id:"codex", name:"Codex", available:true });
  bareCtx.ACT['preset-new']();
  assert.deepEqual(Array.from(bare.querySelectorAll('[name="effortChoice"] option:not([data-custom])'), o => o.value), ["", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  const { parseHTML } = require('./helpers/dom.js');
  const agyRunner = { id:'antigravity', name:'Antigravity', model:{ choices:['tiered'], effortsFor:{ tiered:['medium'] } } };
  const agy = parseHTML(`<form>${ctx.presetModelHTML(agyRunner, { model:'' }, agyRunner.model)}${ctx.presetEffortHTML(agyRunner, { model:'' }, agyRunner.model)}</form>`).document;
  assert.deepEqual(Array.from(agy.querySelectorAll('select[name="effortChoice"] option:not([data-custom])'), o => o.value), ["", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  assert.ok(agy.querySelector('select[name="modelChoice"] option[value="tiered"]'));
});

test("built-in setup and presets only offer Cloud models, even with an older personal pick", () => {
  const { document, ctx } = presetEditor();
  const runner = { id:"penecho", name:"PenEcho", model:{ name:"worker", choices:["worker"], picked:"personal" } };
  for (const html of [ctx.presetModelHTML(runner, { model:"personal" }, runner.model)]) {
    document.body.innerHTML = html;
    const picker = document.querySelector('select[name=modelChoice]');
    assert.deepEqual(Array.from(picker.querySelectorAll('option:not([disabled])'), o => o.value), ["", "worker"]);
    assert.equal(document.querySelector('input'), null);
    assert.doesNotMatch(document.body.textContent, /personal|Type another/);
    assert.match(document.body.textContent, /Choose a Cloud model/);
  }
  ctx.homeShort = value => value;
  Object.assign(runner, { builtIn:true, state:"ready", where:"built in", problems:[] });
  document.body.innerHTML = ctx.setupRowHTML(runner);
  assert.match(document.body.textContent, /Configure personal API keys in your own agent/);
  assert.ok(document.querySelector('[data-act="setup-try"]'));
  document.body.innerHTML = ctx.setupRowHTML({ ...runner, state:"missing" });
  assert.ok(document.querySelector('[data-act="setup-sign-in"]'));
  assert.equal(document.querySelector('[data-model-agent]'), null);
  runner.model = { choices:[] };
  document.body.innerHTML = ctx.presetModelHTML(runner, { model:"" }, runner.model);
  assert.ok(document.querySelector('select[name=modelChoice][disabled]'));
  assert.match(document.body.textContent, /No Cloud models available/);
});

test("legacy presets retain their choices on unrelated edits and automatic entries stay manual", () => {
  const agents = fakeAgents(fresh("home"), ["claude", "codex"]), file = path.join(fresh("state"), "presets.json");
  fs.writeFileSync(file, JSON.stringify({ presets:[{ id:"old", agent:"codex", model:"custom" }], default:"old" }));
  const store = createAgentPresets({ file, agents });
  const [old, auto] = store.list().presets;
  assert.deepEqual([old.showInPicker, old.allowDelegation, auto.showInPicker, auto.allowDelegation], [true, true, true, false]);
  store.update(old.id, { allowDelegation:false });
  store.update(old.id, { name:"Personal agent" });
  assert.throws(() => store.update(old.id, { allowDelegation:"false" }), { code:"BAD_PRESET" });
  const [updated] = createAgentPresets({ file, agents }).list().presets;
  assert.deepEqual([updated.showInPicker, updated.allowDelegation, updated.model], [true, false, "custom"]);
});

test("picker details show the Codex configuration without turning defaults into launch overrides", () => {
  const home = fresh("home"), agents = fakeAgents(home, ["codex"]);
  fs.mkdirSync(path.join(home, ".codex"));
  const config = path.join(home, ".codex", "config.toml");
  fs.writeFileSync(config, 'model = "configured-codex"\nmodel_reasoning_effort = "xhigh"\n');
  const store = createAgentPresets({ file:path.join(fresh("state"), "presets.json"), agents });
  const rows = () => store.list({ pickerDetails:true }).presets;
  const displayed = row => [row.pickerName, row.effectiveModel, row.effectiveEffort, row.model, row.effort];
  assert.deepEqual(displayed(rows()[0]), ["Codex", "configured-codex", "xhigh", "", ""]);
  agents.pickModel("codex", "legacy-model", "high");
  assert.deepEqual(displayed(rows()[0]), ["Codex", "legacy-model", "high", "", ""]);
  assert.equal(store.handOver(store.get("auto:codex")), null);

  const saved = store.add({ agent:"codex", name:"My Codex" });
  store.add({ agent:"codex", model:"pinned-codex", effort:"low" });
  assert.deepEqual(rows().map(displayed), [
    ["My Codex", "configured-codex", "xhigh", "", ""],
    ["Codex", "pinned-codex", "low", "pinned-codex", "low"],
  ]);
  assert.deepEqual(store.handOver(store.get(saved.id)), { model:"", effort:"" });
  assert.equal(store.list().presets[0].effectiveModel, undefined);
  fs.writeFileSync(config, 'model = "updated-codex"\nmodel_reasoning_effort = "medium"\n');
  assert.deepEqual(displayed(rows()[0]), ["My Codex", "updated-codex", "medium", "", ""]);
});

test("saved agents: one runner twice with other models and efforts, named so the effort never reads as a model", () => {
  const home = fresh("home"), file = path.join(fresh("state"), "agent-presets.json"), agents = fakeAgents(home, ["claude", "codex"]);
  const presets = createAgentPresets({ file, agents });
  // Nothing saved: each runner here is offered as itself, and there is no default.
  const first = presets.list();
  assert.deepEqual(first.presets.map(p => [p.id, p.name, p.auto]), [["auto:claude", "Claude Code", true], ["auto:codex", "Codex", true]]);
  assert.equal(first.default, "");
  const haiku = presets.add({ agent:"claude", model:"haiku", effort:"max" }), opus = presets.add({ agent:"claude", model:"opus", effort:"high", default:true });
  assert.equal(haiku.name, "Claude Code · haiku · max effort");
  assert.equal(opus.name, "Claude Code · opus · high effort");
  const listed = presets.list();
  assert.deepEqual(listed.presets.map(p => p.id), [haiku.id, opus.id, "auto:codex"], "a runner with saved agents is no longer offered as itself");
  assert.equal(listed.default, opus.id);
  // A name the person types stays; cleared, it follows the model and effort again.
  presets.update(haiku.id, { name:"Quick fixes" });
  assert.equal(presets.get(haiku.id).name, "Quick fixes");
  presets.update(haiku.id, { name:"", effort:"low" });
  assert.equal(presets.get(haiku.id).name, "Claude Code · haiku · low effort");
  assert.throws(() => presets.add({ agent:"nobody" }), /not on this computer/);
  assert.throws(() => presets.add({ agent:"claude", model:"a\nb" }), /one line/);
  presets.order([opus.id, haiku.id]);
  assert.deepEqual(presets.list().presets.slice(0, 2).map(p => p.id), [opus.id, haiku.id]);
  // Kept in PenEcho's own state, read again by a PenEcho started anew.
  const again = createAgentPresets({ file, agents });
  assert.equal(again.list().default, opus.id);
  assert.equal(again.get(haiku.id).model, "haiku");
  // A runner as itself can be the default too; removing the default leaves none.
  again.setDefault("auto:codex");
  assert.equal(again.defaultPreset().agent, "codex");
  assert.equal(again.handOver(again.defaultPreset()), null, "a runner as itself hands over no model or effort");
  again.setDefault(opus.id);
  again.remove(opus.id);
  assert.equal(again.list().default, "");
  assert.throws(() => again.setDefault("gone"), /gone/);
});

test("a run with a saved agent passes its model and effort to the runner; without one the line's pick, then the default, then the runner's own", () => {
  const home = fresh("home"), agents = fakeAgents(home, ["claude", "codex"]);
  const presets = createAgentPresets({ file:path.join(fresh("state"), "agent-presets.json"), agents });
  const haiku = presets.add({ agent:"claude", model:"haiku", effort:"max" }), opus = presets.add({ agent:"claude", model:"opus", effort:"high" });
  const service = Object.assign(Object.create(Service.prototype), { presets, presetPicks:new Map(), agents });
  const project = { id:"p1" }, run = (slug, agent) => agents.command(agent, { workdir:home, docs:home, gitDir:"", also:[], ...presets.handOver(service.presetFor(project, slug, agent)) });
  assert.equal(at(run("a", "claude").args, "--model"), undefined, "no pick and no default: Claude Code's own model");
  presets.setDefault(opus.id);
  assert.equal(at(run("a", "claude").args, "--model"), "opus", "PenEcho's default");
  assert.equal(at(run("a", "claude").args, "--effort"), "high");
  assert.equal(service.pickPreset(project, "a", haiku.id), "claude", "a saved agent stands for its runner");
  assert.deepEqual([at(run("a", "claude").args, "--model"), at(run("a", "claude").args, "--effort")], ["haiku", "max"], "the line's pick");
  assert.equal(at(run("b", "claude").args, "--model"), "opus", "another line keeps the default");
  assert.equal(service.presetFor(project, "a", "codex"), null, "a pick for another runner does not reach Codex");
  // Picking the runner itself goes back to the default for that line.
  service.pickPreset(project, "a", "", "claude");
  assert.equal(at(run("a", "claude").args, "--model"), "opus");
  assert.throws(() => service.pickPreset(project, "a", "gone"), /gone/);
  assert.equal(service.chooseAgent({ roles:{} }, "work"), "claude", "with no project agent, the default's runner does the work");
});

test("a Work's detail file keeps the model id the runner started with and the effort handed over", () => {
  const { parseLine } = require("../src/server/project-lines/activity.js");
  const F = require("../src/server/project-lines/format.js");
  assert.deepEqual(parseLine(JSON.stringify({ type:"system", subtype:"init", session_id:"s1", model:"claude-opus-5-5" })), [{ session:"s1", model:"claude-opus-5-5" }]);
  assert.deepEqual(parseLine(JSON.stringify({ type:"system", subtype:"init", session_id:"s1" })), [{ session:"s1" }], "no model said, none kept");
  const written = { md:"" }, store = { exists:() => false, readText:() => ({ text:written.md }), writeText:(project, rel, md) => { written.md = md; } };
  const service = Object.assign(Object.create(Service.prototype), { store }), project = { id:"p1" }, step = { id:"s", label:"Work 1" };
  service.startDetail(project, "a", step, "claude", { title:"A", steps:[] }, { name:"Claude Code · opus · xhigh effort", model:"opus", effort:"xhigh" });
  assert.match(written.md, /^effort: xhigh$/m);
  assert.match(written.md, /^selected model: opus$/m);
  assert.doesNotMatch(written.md, /^model:/m, "a selection is not a runtime observation");
  written.md = F.setFront(written.md, { model:"claude-opus-5-5" });
  assert.match(written.md, /^model: claude-opus-5-5$/m, "the id the runner reports replaces the name asked for");
  service.startDetail(project, "a", step, "claude", { title:"A", steps:[] }, { auto:true });
  assert.doesNotMatch(written.md, /^(model|effort):/m, "a run on the runner's own settings keeps no stale pick");
  // Left on Default, a run takes the effort the agent's own settings name, and is rated with it.
  service.agents = { configuredEffort:(agent, model) => agent === "kimi" && model !== "other" ? "high" : "" };
  service.startDetail(project, "a", step, "kimi", { title:"A", steps:[] }, { name:"Kimi", model:"", effort:"" });
  assert.match(written.md, /^effort: high$/m);
  assert.doesNotMatch(written.md, /^selected effort:/m, "the agent's default is not recorded as a choice");
  service.startDetail(project, "a", step, "kimi", { title:"A", steps:[] }, { name:"Kimi", model:"other", effort:"" });
  assert.doesNotMatch(written.md, /^effort:/m, "no effort known for that model, none recorded");
});

test("Settings default overrides legacy project defaultAgent, and unpicked runners do not fall back to the first saved preset", async () => {
  const vm = require("node:vm");
  const F = require("../src/server/project-lines/format.js");
  const home = fresh("home"), stateDir = fresh("state"), agents = fakeAgents(home, ["claude", "codex"]);
  agents.useModelFile(path.join(stateDir, "agent-models.json"));
  agents.pickModel("claude", "opus", "high");
  const presets = createAgentPresets({ file:path.join(stateDir, "agent-presets.json"), agents });
  const sonnet = presets.add({ agent:"claude", model:"sonnet", effort:"xhigh" });
  const opus = presets.add({ agent:"claude", model:"opus", effort:"high" });
  const codexDefault = presets.add({ agent:"codex", model:"gpt-6.1-sol", effort:"max", default:true });

  const docsDir = fresh("docs");
  const service = new Service({ directory:stateDir, agents, autoWatch:false, memory:{ home, env:{} }, conversations:{ home, env:{} } });
  service.presets = presets;
  const project = service.store.create({ name:"Legacy", docsPath:docsDir });
  project.defaultAgent = "claude";

  assert.equal(service.chooseAgent(project, "work"), "codex", "Settings default takes precedence over legacy project.defaultAgent");
  const { slug } = await service.saveUnsent(project, { text:"Start fresh task", topic:"new" });
  const ask = F.parseLine(service.readDoc(project, slug)).steps[0];
  const pasted = await service.pasteUnsent(project, slug, { step:ask.id }, { local:false });
  assert.equal(pasted.agent, "codex", "paste fallback on a fresh line follows Settings default over project.defaultAgent");

  const runCodex = agents.command("codex", { workdir:home, docs:home, gitDir:"", also:[], ...presets.handOver(service.presetFor(project, slug, "codex")) });
  assert.equal(runCodex.thread.model, "gpt-6.1-sol", "codex uses default preset model");
  assert.equal(runCodex.turn.effort, "max", "codex uses default preset effort");
  const runClaude = agents.command("claude", { workdir:home, docs:home, gitDir:"", also:[], ...presets.handOver(service.presetFor(project, "other-claude-line", "claude")) });
  assert.equal(at(runClaude.args, "--model"), "opus", "unpicked Claude uses Claude's own model setting, not the first saved preset (sonnet)");
  assert.equal(at(runClaude.args, "--effort"), "high");

  presets.setDefault("");
  assert.equal(service.chooseAgent(project, "work"), "claude", "with no Settings default, legacy project.defaultAgent still applies");
  presets.setDefault(codexDefault.id);
  service.close();

  // Client UI behavior across Line, Home, All lines, and Composer.
  const posts = [], acts = [];
  const otherLine = { id:"old-claude", slug:"old-claude", title:"Old", status:"done", statusAt:Date.now(), stations:[{ id:"ask-0", kind:"ask", text:"Prev", when:"2026-11-14 10:00" }, { id:"work-1", kind:"work", agent:"claude", state:"done" }] };
  const newAsk = { id:"ask-1", kind:"ask", unsent:true, text:"Fix defaults", when:"2026-11-15 10:00", files:[], refers:[] };
  const newLine = { id:"new-line", slug:"new-line", title:"New", status:"waiting", why:"Not sent", statusAt:1, stations:[newAsk], ask:{ text:"Fix defaults", files:[] }, result:{ text:"", files:[] }, questions:[], pictures:[], labels:[] };
  const claudeAsk = { id:"ask-2", kind:"ask", unsent:true, text:"Continue Claude line", when:"2026-11-15 10:05", files:[], refers:[] };
  const claudeLine = { id:"claude-line", slug:"claude-line", title:"Claude Line", status:"waiting", why:"Not sent", statusAt:2, agent:"claude", conversation:{ agent:"claude" }, stations:[{ id:"work-1", kind:"work", agent:"claude", state:"done" }, claudeAsk], ask:{ text:"Continue Claude line", files:[] }, result:{ text:"", files:[] }, questions:[], pictures:[], labels:[] };
  const proj = { id:"p1", name:"PenEcho", code:true, trunk:"main", defaultAgent:"claude", lines:[otherLine, newLine, claudeLine], landed:[], backlog:[], notes:[], pictures:[], files:[] };

  const view = { isConnected:true, querySelector:() => null, querySelectorAll:() => [] };   // unsentTarget follows the Ask only while its page is shown
  const ctx = vm.createContext({
    LINE_STATUS:require("../public/lines/line-status.js"),
    HOSTED:null, EMBED:null, navigationTransition:0,
    navigator:{ platform:"MacIntel" }, location:{ hash:"" }, localStorage:{ getItem:() => null, setItem() {}, removeItem() {} }, window:{},
    document:{ getElementById:() => null, addEventListener() {}, documentElement:{ addEventListener() {} }, body:{ append() {} }, querySelector:sel => sel === "#view" ? view : null, querySelectorAll:() => [] },
    matchMedia:() => ({ matches:false }),
    addEventListener() {}, requestAnimationFrame:fn => fn(),
    fetch:async (url, init) => { posts.push({ url, body:init?.body && JSON.parse(init.body) }); return { ok:true, status:200, json:async () => ({ slug:"created", step:"ask-1" }) }; },
    can:() => true, homeShape:() => "code", embedCanvas:() => ({}), embedShown() {},
    isWork:s => s.kind === "work", isEnd:s => ["merge", "deliver"].includes(s.kind), canReview:() => false,
    toast:m => { throw new Error(`unexpected toast: ${m}`); }, syncComposer() {}, renderPathPreview() {}, railSettingsHTML:() => "",
  });
  for (const name of ["core", "state", "panorama", "composer", "pages", "desk", "line", "settings"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../public/lines/${name}.js`), "utf8"), ctx, { filename:name });
  }
  ctx.__posts = posts; ctx.__acts = acts; ctx.__proj = proj; ctx.__presetsList = presets.list();
  vm.runInContext(`
    act = async (l, verb, body) => { __acts.push({ line:l.id, verb, body }); return {}; };
    actAtOnce = async (l, verb, body, apply) => { __acts.push({ line:l.id, verb, body }); __lastApply = apply; return {}; };
    refreshAfterChange = refreshChrome = renderRail = renderSwitcher = scrollToItem = scrollToLatest = syncHash = go = () => {};
    pollActivity = async () => {};
    loadState = async () => false; loadProjects = async () => [];
    S.cur = "p1"; S.data.p1 = __proj;
    S.agents = [{ id:"claude", name:"Claude Code", available:true, runs:true, opens:true }, { id:"codex", name:"Codex", available:true, runs:true, opens:true }];
    applyRoles(project());
    S.presets = __presetsList;
    S.agentCheck = { agents:[{ id:'claude', model:{ name:'sonnet', effort:'low', picked:'opus', pickedEffort:'high' } }] };
    S.route = { view:"home" };
  `, ctx);
  const run = code => vm.runInContext(code, ctx), turn = () => new Promise(resolve => setImmediate(resolve));

  assert.equal(run("runAgent(project(), lineById(project(), 'new-line')).id"), "codex", "new line ignores other lines' workers and legacy project defaultAgent");
  assert.equal(run("runPreset(project(), lineById(project(), 'new-line')).id"), codexDefault.id);
  const splitNew = run("runSplit(project(), lineById(project(), 'new-line'), lineById(project(), 'new-line').stations[0])");
  assert.match(splitNew, /Run with Codex · gpt-6\.1-sol · max effort/);
  assert.match(splitNew, new RegExp(`data-agent="codex" data-preset="${codexDefault.id}"`));
  assert.match(run("unsentRowHTML(project(), { l:lineById(project(), 'new-line'), s:lineById(project(), 'new-line').stations[0], at:1 })"), new RegExp(`data-agent="codex" data-preset="${codexDefault.id}"[^>]*title="Run with Codex · gpt-6\\.1-sol · max effort"`));
  assert.match(run("laneSendHTML(project(), lineById(project(), 'new-line'), lineById(project(), 'new-line').stations[0])"), new RegExp(`data-agent="codex" data-preset="${codexDefault.id}"[^>]*title="Run with Codex · gpt-6\\.1-sol · max effort"`));
  assert.equal(run("openingAgent(project(), lineById(project(), 'new-line'), lineById(project(), 'new-line').stations[0])?.id"), "claude", "Paste with context still finds the project's last worker");

  assert.equal(run("runAgent(project(), lineById(project(), 'claude-line')).id"), "claude", "an existing Claude line keeps Claude Code");
  assert.notEqual(run("runPreset(project(), lineById(project(), 'claude-line'))?.id"), sonnet.id);
  assert.equal(run("runPreset(project(), lineById(project(), 'claude-line')).auto"), true, "an existing Claude line without an explicit preset runs Claude as itself, not Sonnet");
  const splitClaude = run("runSplit(project(), lineById(project(), 'claude-line'), lineById(project(), 'claude-line').stations[1])");
  assert.match(splitClaude, />Run with Claude Code · opus · high effort</, "unpicked Claude shows its own configured model and effort");
  assert.match(splitClaude, /data-agent="claude" data-preset=""/);
  assert.match(run("unsentSendHTML(project(), lineById(project(), 'claude-line'), lineById(project(), 'claude-line').stations[1])"), /title="Run with Claude Code · opus · high effort"/);

  run("openMenu = (el, rows) => { globalThis.__menu = rows; }");
  run("ACT['unsent-run-pick']({ dataset:{ line:'claude-line', step:'ask-2' } })");
  assert.equal(run("__menu[1].label"), "PenEcho Auto");
  assert.equal(run("__menu[2].label"), "Claude Code · opus · high effort");
  assert.equal(run("__menu[3].label"), "Claude Code · sonnet · xhigh effort");
  assert.equal(run("__menu[2].on || __menu[3].on"), false, "an implicit runner is not misrepresented as an explicit saved preset");
  await run("__menu[3].fn()");
  assert.equal(acts.at(-1).body.preset, sonnet.id, "picking Sonnet sends that exact preset");
  assert.equal(run("runChoice(project(), lineById(project(), 'claude-line')).name"), "Claude Code · sonnet · xhigh effort");
  run("ACT['unsent-run-pick']({ dataset:{ line:'claude-line', step:'ask-2' } })");
  assert.equal(run("__menu[3].on"), true);
  await run("__menu[2].fn()");
  assert.equal(acts.at(-1).body.preset, opus.id, "picking Opus sends that exact preset");
  assert.equal(run("runChoice(project(), lineById(project(), 'claude-line')).name"), "Claude Code · opus · high effort");

  await run(`runUnsent(project(), lineById(project(), 'claude-line'), '${claudeAsk.id}', 'claude', '${opus.id}')`);
  assert.equal(run("S.runPresetOn['claude-line']"), opus.id);
  await run(`runUnsent(project(), lineById(project(), 'claude-line'), '${claudeAsk.id}', 'claude', '')`);
  assert.equal(run("S.runPresetOn['claude-line']"), undefined, "running the runner without a preset clears stale line preset picks");

  await run("SEND.home({ text:'Fresh task from home', files:[], refers:[], quotes:[], flags:{} })");
  await turn(); await turn();
  assert.equal(posts.filter(p => p.url.endsWith("/topics")).at(-1).body.agent, "codex", "home send uses Settings default agent over legacy project defaultAgent");
  assert.equal(run("pasteAgent(null, { flags:{} }, project()).id"), "codex", "composer paste fallback uses Settings default agent");
  await run("SEND.home({ text:'Explicit claude task', files:[], refers:[], quotes:[], flags:{ agent:'claude' } })");
  await turn(); await turn();
  assert.equal(posts.filter(p => p.url.endsWith("/topics")).at(-1).body.agent, "claude", "explicit @agent override is preserved");

  // One runnable agent with two saved presets still offers the picker arrow on Home and All lines.
  run("S.agents = [{ id:'claude', name:'Claude Code', available:true, runs:true, opens:true }]");
  assert.match(run("unsentRowHTML(project(), { l:lineById(project(), 'claude-line'), s:lineById(project(), 'claude-line').stations[1], at:1 })"), /send-two-pick/);
  assert.match(run("laneSendHTML(project(), lineById(project(), 'claude-line'), lineById(project(), 'claude-line').stations[1])"), /send-two-pick/);

  // Runner-only and older servers still show their settings without manufacturing a preset selection.
  run("S.presets = null; ACT['unsent-run-pick']({ dataset:{ line:'claude-line', step:'ask-2' } })");
  assert.equal(run("__menu[1].label"), "Claude Code · opus · high effort");
  await run("__menu[1].fn()");
  assert.equal(acts.at(-1).body.preset, undefined);
  run("S.presets = { presets:[{ id:'auto:claude', agent:'claude', name:'Claude Code', auto:true, available:true }] }; ACT['unsent-run-pick']({ dataset:{ line:'claude-line', step:'ask-2' } })");
  assert.equal(run("__menu[2].label"), "Claude Code · opus · high effort");
  run("S.presets = { presets:[{ id:'custom', agent:'claude', name:'Quick fixes', model:'haiku', effort:'max', available:true }], default:'custom' }; ACT['unsent-run-pick']({ dataset:{ line:'claude-line', step:'ask-2' } })");
  assert.equal(run("__menu[2].label"), "Quick fixes", "a custom name is preserved");
  assert.equal(run("__menu[2].note"), "haiku · max effort", "custom names keep visible model and effort details");
  assert.equal(run("runChoice(project(), lineById(project(), 'claude-line')).name"), "Claude Code · opus · high effort", "the latest worker's automatic settings win over a new same-runner default");
  await run("__menu[2].fn()");
  assert.equal(run("runChoice(project(), lineById(project(), 'claude-line')).name"), "Quick fixes · haiku · max effort", "an explicit choice still wins");

  // PE-558: with a Work running here, Run with says whether it steers into that Work or runs after it.
  run("Object.assign(lineById(project(), 'claude-line'), { running:true, runAgent:'claude', runSteers:true, runSetup:'haiku|max' })");
  const busy = "runSplit(project(), lineById(project(), 'claude-line'), lineById(project(), 'claude-line').stations[1])";
  assert.match(run(busy), /title="Goes into the Work Claude Code is doing now">.*>Steer into Quick fixes · haiku · max effort</, "the same agent and model steers in");
  assert.match(run("unsentSendHTML(project(), lineById(project(), 'claude-line'), lineById(project(), 'claude-line').stations[1])"), />Steer</);
  run("lineById(project(), 'claude-line').runSetup = 'opus|high'");
  assert.match(run(busy), /title="Starts when Claude Code finishes">.*>Run with Quick fixes · haiku · max effort next</, "another model of the same agent runs next");
  run("lineById(project(), 'claude-line').runSetup = 'haiku|max'; lineById(project(), 'claude-line').runSteers = false");
  assert.match(run(busy), />Run with Quick fixes · haiku · max effort next</, "an agent that cannot take words mid-turn runs next");
  run("lineById(project(), 'claude-line').runSteers = true; S.agents = [{ id:'claude', name:'Claude Code', available:true, runs:true, opens:true }, { id:'codex', name:'Codex', available:true, runs:true, opens:true }]; S.presets = null");
  run("ACT['unsent-run-pick']({ dataset:{ line:'claude-line', step:'ask-2' } })");
  assert.equal(run("__menu.slice(1).map(r => r.av + ':' + r.note).join()"), "claude:Runs next,codex:Runs next", "the menu says what each choice does");
  run("lineById(project(), 'claude-line').runSetup = '|'; ACT['unsent-run-pick']({ dataset:{ line:'claude-line', step:'ask-2' } })");
  assert.equal(run("__menu.slice(1).map(r => r.av + ':' + r.note).join()"), "claude:Steers in,codex:Runs next");
  // PE-618: a run started on default settings whose agent then reports its model still steers; the label and the click agree.
  run("delete S.runPresetOn['claude-line']; Object.assign(lineById(project(), 'claude-line').stations[0], { state:'active', picked:{ model:'claude-opus-5-5' } })");
  assert.match(run(busy), />Steer into Claude Code · claude-opus-5-5</, "the running Work's reported model is that Work's own setup");
  assert.match(run(busy), /data-preset=""/);
  run("lineById(project(), 'claude-line').stations[0].selected = { model:'opus', effort:'' }; lineById(project(), 'claude-line').runSetup = 'opus|'");
  assert.match(run(busy), />Steer into /, "a chosen alias the agent reports by its full name still steers");
  run("lineById(project(), 'claude-line').runSteers = false");
  assert.match(run(busy), />Run with Claude Code · claude-opus-5-5 next</, "an agent that cannot take words mid-turn still runs next");
  run("lineById(project(), 'claude-line').runSteers = true; S.presets = { presets:[{ id:'quick', agent:'claude', name:'Quick fixes', model:'haiku', effort:'max', available:true }] }; ACT['unsent-run-pick']({ dataset:{ line:'claude-line', step:'ask-2' } })");
  assert.equal(run("__menu[2].note"), "haiku · max effort · Runs next", "a different model picked on purpose runs next");
  run("S.presets = null");
  await run(`runUnsent(project(), lineById(project(), 'claude-line'), '${claudeAsk.id}', 'claude', '')`);
  assert.equal(acts.at(-1).body.preset, undefined, "the click sends no preset, so the server steers too");
  run("globalThis.__copy = JSON.parse(JSON.stringify(lineById(project(), 'claude-line'))); __lastApply(__copy)");
  assert.equal(run("__copy.stations.some(x => String(x.id).startsWith('starting-'))"), false, "the page shows the words going into the running Work, not a Work queued after it");
  run("Object.assign(lineById(project(), 'claude-line'), { running:false }); lineById(project(), 'claude-line').stations[0].state = 'done'");
  assert.doesNotMatch(run(busy), /Steer|next</, "nothing running, nothing changes");

  // PE-558: a Work waiting for the running one has Remove from queue, on its card and in its panel; it sends unqueue, not stop.
  run(`globalThis.__q = { id:'claude-line', title:'Q', stations:[{ id:'work-1', kind:'work', label:'Work 1', state:'active', agent:'claude', pictures:[] }, { id:'ask-2', kind:'ask', label:'Ask', state:'done', agent:'you', pictures:[] }, { id:'work-2', kind:'work', label:'Work 2', state:'todo', agent:'codex', pictures:[] }], running:true, runAgent:'claude' }`);
  assert.match(run("workItem(project(), __q, __q.stations[2])"), /data-act="unqueue-work" data-line="claude-line" data-step="work-2" title="Waits for Claude Code to finish\. Its Ask goes back to Not sent\.">.*Remove from queue/);
  assert.match(run("panelHead(__q, __q.stations[2])"), /data-act="unqueue-work"/);
  assert.doesNotMatch(run("workItem(project(), __q, __q.stations[0])"), /unqueue-work/, "the running Work has Stop, not Remove from queue");
  await run("ACT['unqueue-work']({ dataset:{ line:'claude-line', step:'work-2' }, disabled:false })");
  assert.equal(JSON.stringify(acts.at(-1)), JSON.stringify({ line:'claude-line', verb:'unqueue', body:{ step:'work-2' } }));
  run("__q.stations[0].state = 'off'");
  assert.doesNotMatch(run("workItem(project(), __q, __q.stations[2])"), /unqueue-work/, "nothing running, no queue");

  // Carry on with lists your saved agents alphabetically, as Run with does, and sends the one you pick; without saved agents it lists the runners.
  run("S.presets = { presets:[{ id:'custom', agent:'claude', name:'Quick fixes', model:'haiku', effort:'max', available:true }, { id:'auto:codex', agent:'codex', name:'Codex', auto:true, available:true }] }; S.thisComputer = true");
  run("ACT['carry-on']({ dataset:{ line:'claude-line', step:'work-1' } })");
  assert.equal(run("__menu[0].head"), "Carry on with");
  assert.equal(run("__menu.filter(r => r.av).map(r => r.label).join()"), "Codex,Quick fixes");
  assert.equal(run("__menu[2].note"), "haiku · max effort");
  assert.ok(run("__menu.some(r => r.label === 'Manage agents…')"));
  run("toast = () => {}");
  await run("__menu[2].fn()");
  assert.equal(JSON.stringify(acts.at(-1)), JSON.stringify({ line:'claude-line', verb:'carry-on', body:{ agent:'claude', preset:'custom', step:'work-1' } }));

  // Run with and Carry on with sort saved agents alphabetically (case-insensitive) and keep runMenuCredits aligned.
  run(`
    S.agents = [
      { id:'claude', name:'Claude Code', available:true, runs:true, opens:true },
      { id:'codex', name:'Codex', available:true, runs:true, opens:true },
      { id:'opencode', name:'OpenCode', available:true, runs:true, opens:true },
      { id:'pi', name:'Pi', available:true, runs:true, opens:true },
      { id:'kimi', name:'Kimi', available:true, runs:true, opens:true },
      { id:'omp', name:'omp', available:true, runs:true, opens:true },
      { id:'antigravity', name:'Antigravity', available:true, runs:true, opens:true },
      { id:'penecho', name:'PenEcho', available:true, runs:true, opens:true },
    ];
    S.presets = { presets:[
      { id:'p1', agent:'claude', name:'Claude Code · opus · high effort', available:true },
      { id:'p2', agent:'codex', name:'Codex · gpt-6.2-sol · max effort', available:true },
      { id:'p3', agent:'opencode', name:'OpenCode · max effort', available:true },
      { id:'p4', agent:'pi', name:'Pi · magpie/moonshot-cn/kimi-k3.1-pro', available:true },
      { id:'p5', agent:'kimi', name:'Kimi · magpie/moonshot-cn/kimi-k3.1-pro · max effort', available:true },
      { id:'p6', agent:'omp', name:'omp', available:true },
      { id:'p7', agent:'antigravity', name:'Antigravity · gemini-4-hydrogen · xhigh effort', available:true },
      { id:'auto:penecho', agent:'penecho', name:'PenEcho', auto:true, available:true },
    ] };
    globalThis.__creditAgents = null;
    globalThis.runMenuCredits = (_menu, list) => { globalThis.__creditAgents = list; };
    ACT['unsent-run-pick']({ dataset:{ line:'claude-line', step:'ask-2' } });
  `);
  assert.deepEqual([...run("__menu.filter(r => r.av).map(r => r.label)")], [
    "Antigravity · gemini-4-hydrogen · xhigh effort",
    "Claude Code · opus · high effort",
    "Codex · gpt-6.2-sol · max effort",
    "Kimi · magpie/moonshot-cn/kimi-k3.1-pro · max effort",
    "omp",
    "OpenCode · max effort",
    "PenEcho",
    "Pi · magpie/moonshot-cn/kimi-k3.1-pro",
  ], "Run with lists saved agents in case-insensitive alphabetical order");
  assert.equal(run("__creditAgents.findIndex(a => a.id === 'penecho')"), 7, "runMenuCredits includes PenEcho Auto before the sorted agent rows");
  run("delete globalThis.runMenuCredits; S.agents = [{ id:'claude', name:'Claude Code', available:true, runs:true, opens:true }, { id:'codex', name:'Codex', available:true, runs:true, opens:true }]");
  run("S.presets = null; ACT['carry-on']({ dataset:{ line:'claude-line', step:'work-1' } })");
  assert.equal(run("__menu.filter(r => r.av).map(r => r.av).join()"), "codex", "a server without saved agents lists the other runners");
  run("S.presets = { presets:[{ id:'custom', agent:'claude', name:'Quick fixes', available:true, showInPicker:false }], jobs:{ topics:'custom' } }");
  for (const [action, step] of [["unsent-run-pick", "ask-2"], ["carry-on", "work-1"]]) {
    run(`ACT['${action}']({ dataset:{ line:'claude-line', step:'${step}' } })`);
    assert.equal(run("__menu.filter(r => r.av).length"), 0, "hiding every preset keeps the picker empty");
  }
  assert.match(run("topicsAgentOptionsHTML()"), /value="custom" selected hidden/, "opening Rebuild preserves the current hidden Topics assignment");
});

test("new asks use the Settings default agent, while existing lines restore the last worker's saved agent across restarts and reloads", async () => {
  const vm = require("node:vm");
  const F = require("../src/server/project-lines/format.js");
  const home = fresh("home"), stateDir = fresh("state"), docsDir = fresh("docs"), agents = fakeAgents(home, ["claude", "codex"]);
  agents.useModelFile(path.join(stateDir, "agent-models.json"));
  agents.pickModel("codex", "gpt-6.1-sol", "max");
  const presetsFile = path.join(stateDir, "agent-presets.json");
  const presets = createAgentPresets({ file:presetsFile, agents });
  const claudeDefault = presets.add({ agent:"claude", model:"opus", effort:"high", default:true });
  const codexAstra = presets.add({ agent:"codex", model:"gpt-6-astra", effort:"xhigh" });
  const codexSolXhigh = presets.add({ agent:"codex", model:"gpt-6.1-sol", effort:"xhigh" });

  // Server side: Work 1 ran with Codex sol xhigh; after a server restart (empty presetPicks), presetFor and stateOf restore it.
  let service = new Service({ directory:stateDir, agents, autoWatch:false, memory:{ home, env:{} }, conversations:{ home, env:{} } });
  service.presets = presets;
  let project = service.store.create({ name:"PenEcho", docsPath:docsDir });
  const slug = "existing-codex-line";
  service.writeDoc(project, slug, F.initialLine({ title:"Existing Codex line", who:"@codex", status:"done", steps:[
    F.askStep({ words:"First ask" }),
    { ...F.workStep({ who:"codex" }), done:true, took:"2 min" },
  ] }));
  const work1 = F.parseLine(service.readDoc(project, slug)).steps[1];
  service.startDetail(project, slug, work1, "codex", { title:"Existing Codex line", steps:[] }, codexSolXhigh);
  await service.saveUnsent(project, { topic:slug, text:"Follow-up ask" });
  service.close();

  const presetsReloaded = createAgentPresets({ file:presetsFile, agents });
  service = new Service({ directory:stateDir, agents, autoWatch:false, memory:{ home, env:{} }, conversations:{ home, env:{} } });
  service.presets = presetsReloaded;
  project = service.store.projects[0];

  assert.equal(service.chooseAgent(project, "work"), "claude", "a brand-new task with no prior worker uses the system default agent");
  assert.equal(service.presetFor(project, "brand-new-line", "claude")?.id, claudeDefault.id);
  assert.equal(service.presetFor(project, slug, "codex")?.effort, "xhigh", "after restart, presetFor restores the last worker's settings");
  assert.equal(service.presetFor(project, slug, "claude")?.id, claudeDefault.id, "switching to another runner does not reuse Codex's saved agent");
  const cmd = agents.command("codex", { workdir:home, docs:home, gitDir:"", also:[], ...presetsReloaded.handOver(service.presetFor(project, slug, "codex")) });
  assert.equal(cmd.thread.model, "gpt-6.1-sol");
  assert.equal(cmd.turn.effort, "xhigh", "server launch uses xhigh from the last worker's saved agent, not max from agent-models.json");

  const state = service.stateOf(project);
  const existingLine = state.lines.find(l => l.slug === slug);
  assert.equal(existingLine.stations[1].savedAgent, "Codex · gpt-6.1-sol · xhigh effort");
  assert.equal(existingLine.stations[1].savedAgentId, codexSolXhigh.id);

  // If the preset is renamed, savedAgentId still resolves it; if the last worker ran as auto (no saved agent), an older preset is not reused.
  presetsReloaded.update(codexSolXhigh.id, { name:"Sol XHigh" });
  assert.equal(service.presetFor(project, slug, "codex")?.effort, "xhigh");
  presetsReloaded.update(codexSolXhigh.id, { name:"" });
  service.writeDoc(project, slug, F.updateSteps(service.readDoc(project, slug), steps => {
    steps.push(F.askStep({ words:"Second ask" }), { ...F.workStep({ who:"codex" }), done:true, took:"1 min" });
  }));
  const work2 = F.parseLine(service.readDoc(project, slug)).steps.at(-1);
  service.startDetail(project, slug, work2, "codex", { title:"Existing Codex line", steps:[] }, { auto:true });
  assert.equal(service.presetFor(project, slug, "codex").auto, true, "a later auto Work clears the older Work's saved agent");

  // An existing work-free line (note only) also defaults to the system default agent.
  await service.saveYours(project, { kind:"note", text:"Just a note", topic:"new" });
  const noteSlug = service.stateOf(project).lines.find(l => l.slug !== slug).slug;
  assert.equal(service.chooseAgent(project, "work"), "claude");
  assert.equal(service.presetFor(project, noteSlug, "claude")?.id, claudeDefault.id);
  service.close();

  // Client UI side: after a reload (S.runPresetOn empty), existingLine shows Work 1's saved agent, while a new line shows the system default.
  const newAsk = { id:"ask-new", kind:"ask", unsent:true, text:"New ask", when:"2026-11-16 04:20", files:[], refers:[] };
  const freshLine = { id:"fresh-line", slug:"fresh-line", title:"Fresh", status:"waiting", why:"Not sent", statusAt:1, stations:[newAsk], ask:{ text:"New ask", files:[] }, result:{ text:"", files:[] }, questions:[], pictures:[], labels:[] };
  const noteOnlyLine = { id:"note-line", slug:"note-line", title:"Note", status:"waiting", why:"Not sent", statusAt:1, stations:[{ id:"note-1", kind:"note", agent:"you", text:"Memo", state:"done" }, newAsk], ask:{ text:"New ask", files:[] }, result:{ text:"", files:[] }, questions:[], pictures:[], labels:[] };
  const multiWorkerLine = {
    id:"multi-line", slug:"multi-line", title:"Multi", status:"waiting", why:"Not sent", statusAt:3, agent:"codex",
    conversation:{ agent:"claude" },
    stations:[
      { id:"work-1", kind:"work", agent:"claude", state:"done", savedAgent:"Claude Code · opus · high effort", savedAgentId:claudeDefault.id },
      { id:"work-2", kind:"work", agent:"codex", state:"done", savedAgent:"Codex · gpt-6.1-sol · xhigh effort" },
      { id:"ask-3", kind:"ask", unsent:true, text:"Next", when:"2026-11-16 04:25", files:[], refers:[] },
    ],
    ask:{ text:"Next", files:[] }, result:{ text:"", files:[] }, questions:[], pictures:[], labels:[],
  };
  const proj = { id:"p1", name:"PenEcho", code:true, trunk:"main", defaultAgent:"claude", lines:[freshLine, noteOnlyLine, existingLine, multiWorkerLine], landed:[], backlog:[], notes:[], pictures:[], files:[] };
  const ctx = vm.createContext({
    LINE_STATUS:require("../public/lines/line-status.js"),
    HOSTED:null, EMBED:null, navigationTransition:0,
    navigator:{ platform:"MacIntel" }, location:{ hash:"" }, localStorage:{ getItem:() => null, setItem() {}, removeItem() {} }, window:{},
    document:{ getElementById:() => null, addEventListener() {}, documentElement:{ addEventListener() {} }, body:{ append() {} }, querySelector:() => null, querySelectorAll:() => [] },
    matchMedia:() => ({ matches:false }),
    addEventListener() {}, requestAnimationFrame:fn => fn(),
    fetch:async () => ({ ok:true, status:200, json:async () => ({}) }),
    can:() => true, homeShape:() => "code", embedCanvas:() => ({}), embedShown() {},
    isWork:s => s.kind === "work", isEnd:s => ["merge", "deliver"].includes(s.kind), canReview:() => false,
    toast:m => { throw new Error(`unexpected toast: ${m}`); }, syncComposer() {}, renderPathPreview() {}, railSettingsHTML:() => "",
  });
  for (const name of ["core", "state", "panorama", "composer", "pages", "desk", "line", "settings"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../public/lines/${name}.js`), "utf8"), ctx, { filename:name });
  }
  ctx.__proj = proj; ctx.__presetsList = presets.list();
  vm.runInContext(`
    S.cur = "p1"; S.data.p1 = __proj;
    S.agents = [{ id:"claude", name:"Claude Code", available:true, runs:true, opens:true }, { id:"codex", name:"Codex", available:true, runs:true, opens:true }];
    applyRoles(project());
    S.presets = __presetsList;
    S.agentCheck = { agents:[{ id:'codex', model:{ name:'gpt-6.1-sol', effort:'max', picked:'gpt-6.1-sol', pickedEffort:'max' } }] };
    S.route = { view:"home" };
  `, ctx);
  const run = code => vm.runInContext(code, ctx);

  assert.equal(run("runAgent(project(), lineById(project(), 'fresh-line')).id"), "claude", "new line defaults to system default agent");
  assert.equal(run("runPreset(project(), lineById(project(), 'fresh-line')).id"), claudeDefault.id);
  assert.equal(run("runAgent(project(), lineById(project(), 'note-line')).id"), "claude", "note-only line with no prior worker defaults to system default agent");
  assert.equal(run("runPreset(project(), lineById(project(), 'note-line')).id"), claudeDefault.id);

  assert.equal(run("runAgent(project(), lineById(project(), 'existing-codex-line')).id"), "codex");
  assert.equal(run("runPreset(project(), lineById(project(), 'existing-codex-line')).effort"), "xhigh", "restores last worker settings instead of falling back to sol max");
  assert.notEqual(run("runPreset(project(), lineById(project(), 'existing-codex-line')).id"), codexAstra.id);
  const splitExisting = run(`runSplit(project(), lineById(project(), '${slug}'), lineById(project(), '${slug}').stations.at(-1))`);
  assert.match(splitExisting, />Run with Codex · gpt-6\.1-sol · xhigh effort</);
  assert.match(splitExisting, /data-agent="codex" data-preset=""/);
  assert.match(run(`unsentRowHTML(project(), { l:lineById(project(), '${slug}'), s:lineById(project(), '${slug}').stations.at(-1), at:1 })`), new RegExp(`data-agent="codex" data-preset=""[^>]*title="Run with Codex · gpt-6\\.1-sol · xhigh effort"`));
  assert.match(run(`laneSendHTML(project(), lineById(project(), '${slug}'), lineById(project(), '${slug}').stations.at(-1))`), new RegExp(`data-agent="codex" data-preset=""[^>]*title="Run with Codex · gpt-6\\.1-sol · xhigh effort"`));

  assert.equal(run("runAgent(project(), lineById(project(), 'multi-line')).id"), "codex", "latest worked station takes precedence over stale conversation agent");
  assert.equal(run("runPreset(project(), lineById(project(), 'multi-line')).id"), codexSolXhigh.id, "matches savedAgent by name even without savedAgentId (legacy work-N.md)");
  // An Orchestrator review on the Line, finished or still going, never makes its reviewer the next Ask's agent.
  for (const state of ["done", "active", "error", "off"]) {
    ctx.reviewState = state;
    run(`lineById(project(), 'multi-line').stations.splice(-1, 0, { id:'work-2--review', index:9, kind:'orch-review', isOrchReview:true, workId:'work-2', agent:'claude', state:reviewState, files:[], refers:[] })`);
    assert.equal(run("runAgent(project(), lineById(project(), 'multi-line')).id"), "codex", `a reviewer (${state}) is not the last worker`);
    assert.equal(run("runPreset(project(), lineById(project(), 'multi-line')).id"), codexSolXhigh.id);
    assert.equal(run("openingAgent(project(), lineById(project(), 'multi-line'), lineById(project(), 'multi-line').stations.at(-1)).id"), "codex");
    run("lineById(project(), 'multi-line').stations.splice(-2, 1)");
  }
  ctx.hiddenId = codexSolXhigh.id;
  run("S.presets.presets.find(p => p.id === hiddenId).showInPicker = false");
  assert.equal(run("runPresets().some(p => p.id === hiddenId)"), false);
  assert.equal(run("runPreset(project(), lineById(project(), 'multi-line')).id"), codexSolXhigh.id, "hiding a preset preserves an existing Line assignment");

  run("S.runWith = { 'multi-line':'claude' };");
  assert.equal(run("runPreset(project(), lineById(project(), 'multi-line')).id"), claudeDefault.id, "explicitly choosing another runner uses that runner's preset, not Codex's");
});

test("last Work settings survive edited/deleted presets and launch with the recorded configuration", async () => {
  const F = require("../src/server/project-lines/format.js");
  const home = fresh("home"), agents = fakeAgents(home, ["claude", "codex"]), directory = fresh("state");
  const service = new Service({ directory, agents, autoWatch:false, memory:{ home, env:{} }, conversations:{ home, env:{} } });
  try {
    const presets = service.presets = createAgentPresets({ file:path.join(directory, "presets.json"), agents });
    const astra = presets.add({ agent:"codex", model:"gpt-6-astra", effort:"high" });
    const defaultPick = presets.add({ agent:"claude", model:"opus", effort:"high", default:true });
    const project = service.store.create({ name:"Historical settings", docsPath:fresh("docs") }), slug = "historical";
    service.writeDoc(project, slug, F.initialLine({ title:"Historical", who:"@codex", status:"done", steps:[
      F.askStep({ words:"Previous ask" }), { ...F.workStep({ who:"codex" }), done:true },
    ] }));
    const work = F.parseLine(service.readDoc(project, slug)).steps[1];
    service.startDetail(project, slug, work, "codex", { title:"Historical", steps:[] }, astra);
    const rel = F.detailPath(slug, work.id);
    // The screenshot's legacy Work has a name and runtime facts, but no saved preset id.
    service.store.writeText(project, rel, F.setFront(service.store.readText(project, rel).text, {
      "saved agent id":null, "selected model":null, "selected effort":null, model:"gpt-6-astra", effort:"high",
    }));
    presets.update(astra.id, { effort:"medium" });
    const settings = () => presets.handOver(service.presetFor(project, slug, "codex"));
    assert.deepEqual(settings(), { model:"gpt-6-astra", effort:"high" }, "legacy snapshot wins over the edited preset");
    service.store.writeText(project, rel, F.setFront(service.store.readText(project, rel).text, { "saved agent id":astra.id }));
    assert.deepEqual(settings(), { model:"gpt-6-astra", effort:"high" }, "stable id must not substitute today's medium for yesterday's high");
    service.pickPreset(project, slug, astra.id);
    assert.equal(settings().effort, "medium", "explicit selection uses current Settings");
    service.pickPreset(project, slug, "", "codex");
    presets.remove(astra.id);
    assert.deepEqual(settings(), { model:"gpt-6-astra", effort:"high" }, "deletion does not lose recorded settings");
    assert.equal(service.presetFor(project, "fresh", "claude").id, defaultPick.id);
    const count = presets.list().presets.length;
    await service.saveUnsent(project, { topic:slug, text:"test" });
    let launch;
    service.launch = async (p, line, next, doc) => {
      const inherited = service.presetFor(p, line, "codex");
      const cmd = agents.command("codex", { workdir:home, docs:home, gitDir:"", also:[], ...presets.handOver(inherited) });
      launch = { model:cmd.thread.model, effort:cmd.turn.effort };
      service.startDetail(p, line, next, "codex", doc, inherited);
    };
    const ask = F.parseLine(service.readDoc(project, slug)).steps.find(s => F.isUnsent(s));
    await service.runUnsent(project, slug, { step:ask.id, agent:"codex" });
    assert.deepEqual(launch, { model:"gpt-6-astra", effort:"high" }, "Run reaches launch with the exact recorded snapshot");
    assert.equal(presets.list().presets.length, count, "inheritance does not create Settings presets");
    const next = F.parseLine(service.readDoc(project, slug)).steps.at(-1);
    const info = F.splitFront(service.store.readText(project, F.detailPath(slug, next.id)).text).front;
    assert.equal(info["saved agent id"], undefined, "a snapshot is not a saved preset id");
    assert.equal(info["selected model"], "gpt-6-astra");
    assert.equal(info["selected effort"], "high");
    assert.equal(info.model, undefined, "selected settings do not pretend to be runtime observations");
    service.presetPicks.clear();
    assert.deepEqual(settings(), launch, "the next run inherits even before runtime facts arrive");
    // PE-558: Claude reports claude-opus-5-5 for a saved "opus"; Run with that saved agent must still match the running Work and steer in.
    service.store.writeText(project, rel, F.setFront(service.store.readText(project, rel).text, { "selected model":"astra-alias", "selected effort":"high" }));
    assert.deepEqual(service.lastWorkPreset(project, slug, "codex", next.id).chosen, { model:"astra-alias", effort:"high" }, "the run's setup is what was chosen, not the name the agent reported");
  } finally { service.close(); }
});

test("Local providers and Preset agents split runtime health from presets, and prompts never name a specific agent", async () => {
  const { document, ctx } = presetEditor({ id:"claude", name:"Claude Code", state:"ready", available:true, problems:[] });
  const copied = [];
  ctx.copyText = (text, note) => copied.push({ text, note });
  ctx.homeShort = value => value;
  ctx.S.thisComputer = true;
  ctx.S.agentCheck = {
    agents:[
      { id:"claude", name:"Claude Code", mono:"Cl", color:"#d97757", state:"ready", where:"/usr/bin/claude", problems:[] },
      { id:"codex", name:"Codex", mono:"Cx", color:"#10a37f", state:"missing", problems:[{ kind:"tip", title:"Not installed", fix:"Install codex", prompt:"install codex prompt" }] },
      { id:"kimi", name:"Kimi", mono:"Ki", color:"#6366f1", state:"problem", where:"/usr/bin/kimi", problems:[{ kind:"fix", title:"Not signed in", fix:"Run kimi login", prompt:"fix kimi prompt" }] },
    ],
  };

  // Preset agents: saved provider + model + effort profiles; several efforts of one model let Auto find the best fit (PE-1190).
  document.body.innerHTML = ctx.agentsSectionHTML();
  const topSub = document.querySelector("#sysAgents").parentElement.querySelector(".sys-sub").textContent;
  assert.equal(document.querySelector("#sysAgents").textContent, "Your preset agents");
  assert.match(topSub, /provider \+ model \+ effort/);
  assert.match(topSub, /used by Lines, PenEcho Auto, and Orchestrator/);
  assert.match(topSub, /Save the same model at several efforts \(e\.g\. high and medium\)/);
  assert.equal(document.querySelector("#sysInstalled"), null, "the installed CLIs are on Local providers");
  // Local providers: install, sign in, update and verify; models and efforts are in Preset agents.
  document.body.innerHTML = ctx.installedSectionHTML();
  const bottomSub = document.querySelector("#sysInstalled").parentElement.querySelector(".sys-sub").textContent;
  assert.equal(document.querySelector("#sysInstalled").textContent, "Installed CLIs & built-in runner");
  assert.match(bottomSub, /Install, sign in, update, and verify local agent runtimes here/);
  assert.match(bottomSub, /Configure models, efforts, and permissions in Preset agents/);
  assert.equal(document.querySelector(".sys-flow-step.is-active").dataset.tab, "setup");
  assert.match(document.querySelector('.sys-flow-step[data-tab="setup"] small').textContent, /1 needs a fix · 1 ready/);

  // Remote viewer on the local network still sees the host qualifier and top-section pointer.
  ctx.S.thisComputer = false;
  document.body.innerHTML = ctx.installedSectionHTML();
  assert.equal(document.querySelector("#sysInstalled").textContent, "Installed CLIs on the host computer");

  // Install/fix prompt copy toast never singles out Claude Code even when Claude Code is ready.
  ctx.ACT["setup-prompt"]({ dataset:{ agent:"codex", i:"0" } });
  ctx.ACT["setup-prompt"]({ dataset:{ agent:"kimi", i:"0" } });
  assert.deepEqual(copied, [
    { text:"install codex prompt", note:"Install prompt copied. Paste it into any agent." },
    { text:"fix kimi prompt", note:"Fix prompt copied. Paste it into any agent." },
  ]);
  for (const entry of copied) assert.doesNotMatch(entry.note, /Claude/i);

  // Desktop app offers 1-click Install for missing Codex/Claude/Kimi (checks existing first, installs official latest if absent) and rechecks agents on completion.
  ctx.S.thisComputer = true;
  const missingCodex = { id:"codex", name:"Codex", mono:"Cx", color:"#2b303a", state:"missing", problems:[{ kind:"tip", title:"Not installed", fix:"Install Codex", prompt:"install codex prompt" }] };
  document.body.innerHTML = ctx.setupRowHTML(missingCodex);
  assert.equal(document.querySelector('[data-act="setup-install"]'), null, "no desktop Install button outside Electron");

  const installCalls = [], toasts = [];
  let freshChecks = 0;
  ctx.toast = msg => toasts.push(msg);
  ctx.checkAgents = async opts => { if (opts?.fresh) freshChecks += 1; };
  ctx.window = {
    penechoDesktop:{
      installCli:async provider => {
        installCalls.push(provider);
        return { ok:true, provider, executable:"/Users/test/.local/bin/codex", version:"codex-cli 0.181.0", alreadyInstalled:false, status:{ state:"auth_required", loginCommand:"codex login" } };
      },
    },
  };
  document.body.innerHTML = ctx.setupRowHTML(missingCodex);
  const installBtn = document.querySelector('[data-act="setup-install"]');
  assert.ok(installBtn, "desktop shows Install button for missing Codex");
  assert.equal(installBtn.dataset.agent, "codex");
  assert.ok(document.querySelector('[data-act="setup-prompt"]'), "Copy install prompt stays available beside Install");
  await ctx.ACT["setup-install"](installBtn);
  assert.deepEqual(installCalls, ["codex-cli"]);
  assert.equal(freshChecks, 1, "refreshes agent checks immediately after install");
  assert.match(toasts.at(-1), /Installed Codex \(codex-cli 0\.181\.0\).*codex login/);

  // Desktop offers Install + Copy install prompt for every CLI agent (Pi, omp, dsh, Kimi, Antigravity, OpenCode, Claude, Codex).
  for (const [id, provider] of [["pi", "pi-cli"], ["omp", "omp-cli"], ["dsh", "dsh-cli"], ["kimi", "kimi-cli"], ["antigravity", "antigravity-cli"], ["opencode", "opencode-cli"], ["claude", "claude-cli"]]) {
    const missing = { id, name:id, mono:id.slice(0, 2), color:"#333", state:"missing", problems:[{ kind:"tip", title:"Not installed", fix:`Install ${id}`, prompt:`install ${id} prompt` }] };
    document.body.innerHTML = ctx.setupRowHTML(missing);
    const btn = document.querySelector('[data-act="setup-install"]');
    assert.ok(btn, `desktop shows Install button for missing ${id}`);
    assert.equal(btn.dataset.agent, id);
    assert.ok(document.querySelector('[data-act="setup-prompt"]'), `Copy install prompt stays available beside Install for ${id}`);
    installCalls.length = 0;
    await ctx.ACT["setup-install"](btn);
    assert.deepEqual(installCalls, [provider]);
  }

  // Failed install surfaces an inline error with fallback guidance.
  ctx.window.penechoDesktop.installCli = async () => ({ ok:false, error:"Network timed out." });
  const missingKimi = { id:"kimi", name:"Kimi", mono:"Ki", color:"#16181d", state:"missing", problems:[{ kind:"tip", title:"Not installed", fix:"Install Kimi", prompt:"install kimi prompt" }] };
  document.body.innerHTML = ctx.setupRowHTML(missingKimi);
  await ctx.ACT["setup-install"](document.querySelector('[data-act="setup-install"]'));
  document.body.innerHTML = ctx.setupRowHTML(missingKimi);
  assert.match(document.body.textContent, /Install failed.*Network timed out\./);

  // Outdated dsh (< 0.2.2) shows an amber update notice, copyable command, Copy update prompt, and desktop Update button.
  const oldDsh = {
    id:"dsh", name:"dsh", mono:"Ds", color:"#3457c9", state:"ready", version:"0.2.1-rc.2", where:"/usr/local/bin/dsh",
    problems:[{
      kind:"tip", action:"update", title:"Update dsh to 0.2.2 or later",
      detail:"dsh 0.2.1-rc.2 is older than 0.2.2.",
      fix:"Update dsh to 0.2.2 or later with `npm install -g @deepseek-ai/dsh@latest`.",
      command:"npm install -g @deepseek-ai/dsh@latest",
      prompt:"update dsh prompt",
    }],
  };
  ctx.S.agentCheck = { agents:[oldDsh] };
  copied.length = 0;
  installCalls.length = 0;
  ctx.window.penechoDesktop.installCli = async provider => {
    installCalls.push(provider);
    return { ok:true, provider, executable:"/Users/test/.local/bin/dsh", version:"0.2.2-rc.5" };
  };
  ctx.checkAgents = async opts => {
    if (opts?.fresh) {
      freshChecks += 1;
      ctx.S.agentCheck = { agents:[{ ...oldDsh, version:"0.2.2-rc.5", where:"/Users/test/.local/bin/dsh", problems:[] }] };
    }
  };
  document.body.innerHTML = ctx.setupRowHTML(oldDsh);
  assert.ok(document.querySelector(".setup-fix.is-fix"), "outdated dsh update notice is highlighted");
  const updateBtn = document.querySelector('[data-act="setup-update"]');
  assert.ok(updateBtn, "desktop shows Update button for outdated dsh");
  assert.equal(updateBtn.textContent, "Update");
  const cmdBtn = document.querySelector('[data-act="setup-command"]');
  assert.equal(cmdBtn.textContent.trim(), "npm install -g @deepseek-ai/dsh@latest");
  const updatePromptBtn = document.querySelector('[data-act="setup-prompt"]');
  assert.equal(updatePromptBtn.textContent, "Copy update prompt");
  ctx.ACT["setup-prompt"](updatePromptBtn);
  assert.deepEqual(copied, [{ text:"update dsh prompt", note:"Update prompt copied. Paste it into any agent." }]);
  await ctx.ACT["setup-update"](updateBtn);
  assert.deepEqual(installCalls, ["dsh-cli"]);
  assert.match(toasts.at(-1), /Updated dsh \(0\.2\.2-rc\.5\)/);

  // If Update finishes but PenEcho still detects an older shadowed dsh, surface an inline Update failed message.
  ctx.S.agentCheck = { agents:[oldDsh] };
  ctx.checkAgents = async opts => { if (opts?.fresh) ctx.S.agentCheck = { agents:[oldDsh] }; };
  await ctx.ACT["setup-update"](updateBtn);
  document.body.innerHTML = ctx.setupRowHTML(oldDsh);
  assert.match(document.body.textContent, /Update failed.*0\.2\.1-rc\.2/);
});

test("dsh preset editor defaults Access to Full access and lets users opt into Project folders", () => {
  const runner = { id:"dsh", name:"dsh", state:"ready", available:true, model:{ name:"deepseek-official/deepseek-flash" }, access:{ normal:"full", full:true, folders:true } };
  const { document, window, ctx } = presetEditor(runner);
  ctx.ACT["preset-new"]();
  const select = document.querySelector('select[name="access"]');
  assert.ok(select && !select.disabled);
  assert.deepEqual(Array.from(select.querySelectorAll("option"), o => [o.value, o.textContent]), [
    ["", "Full access"],
    ["folders", "Project folders"],
  ]);
  assert.equal(select.querySelector("option[selected]").value, "");
  assert.match(document.querySelector(".sys-warn").textContent, /Runs every command without asking, anywhere on this computer/);
  select.querySelector('option[value="folders"]').selected = true;
  select.dispatchEvent(new window.Event("change", { bubbles:true }));
  assert.equal(document.querySelector('select[name="access"] option[selected]').value, "folders");
  assert.match(document.querySelector(".sys-warn").textContent, /Changes files only in this project's folders/);
  assert.match(document.querySelector('input[name="name"]').placeholder, /project folders/);
});

test("Codex preset editor defaults Access to Full access and lets users opt into Reviewed", () => {
  const runner = { id:"codex", name:"Codex", state:"ready", available:true, model:{ name:"gpt-6.1-sol" }, access:{ normal:"full", full:true, reviewed:true } };
  const { document, window, ctx } = presetEditor(runner);
  ctx.ACT["preset-new"]();
  const select = document.querySelector('select[name="access"]');
  assert.ok(select && !select.disabled);
  assert.deepEqual(Array.from(select.querySelectorAll("option"), o => [o.value, o.textContent]), [
    ["", "Full access"],
    ["reviewed", "Reviewed"],
  ]);
  assert.equal(select.querySelector("option[selected]").value, "");
  assert.match(document.querySelector(".sys-warn").textContent, /Runs every command without asking, anywhere on this computer/);
  select.querySelector('option[value="reviewed"]').selected = true;
  select.dispatchEvent(new window.Event("change", { bubbles:true }));
  assert.equal(document.querySelector('select[name="access"] option[selected]').value, "reviewed");
  assert.match(document.querySelector(".sys-warn").textContent, /agent's own safety check approves each command/);
  assert.match(document.querySelector('input[name="name"]').placeholder, /reviewed/);
});

test("a sole saved Codex Reviewed preset is used on new Lines without Make default, and access is recorded, inherited, and displayed", async () => {
  const vm = require("node:vm");
  const F = require("../src/server/project-lines/format.js");
  const home = fresh("home"), stateDir = fresh("state"), docsDir = fresh("docs"), agents = fakeAgents(home, ["codex", "claude"]);
  const presets = createAgentPresets({ file:path.join(stateDir, "agent-presets.json"), agents });
  const reviewedCodex = presets.add({ agent:"codex", model:"gpt-6.1-sol", effort:"high", access:"reviewed" });
  assert.equal(presets.list().default, "", "no global default set");

  const service = new Service({ directory:stateDir, agents, autoWatch:false, memory:{ home, env:{} }, conversations:{ home, env:{} } });
  service.presets = presets;
  const project = service.store.create({ name:"ReviewedSole", docsPath:docsDir });
  try {
    // 1) Server presetFor resolves the sole saved Reviewed Codex preset for a brand-new Line.
    const picked = service.presetFor(project, "brand-new", "codex");
    assert.equal(picked?.id, reviewedCodex.id);
    assert.equal(picked?.access, "reviewed");

    // 2) startDetail records access & selected access, workFacts exposes them, and follow-up Works inherit reviewed access.
    const slug = "reviewed-line";
    service.writeDoc(project, slug, F.initialLine({ title:"Reviewed line", who:"@codex", status:"done", steps:[
      F.askStep({ words:"First ask" }),
      { ...F.workStep({ who:"codex" }), done:true, took:"2 min" },
    ] }));
    const work1 = F.parseLine(service.readDoc(project, slug)).steps[1];
    service.startDetail(project, slug, work1, "codex", { title:"Reviewed line", steps:[] }, reviewedCodex);
    const detailText = service.store.readText(project, F.detailPath(slug, work1.id)).text;
    assert.match(detailText, /^selected access: reviewed$/m);
    assert.match(detailText, /^access: reviewed$/m);
    const state = service.stateOf(project);
    const lineState = state.lines.find(l => l.slug === slug);
    assert.equal(lineState.stations[1].access, "reviewed");
    assert.equal(lineState.stations[1].selectedAccess, "reviewed");
    const inherited = service.lastWorkPreset(project, slug, "codex");
    assert.equal(inherited?.access, "reviewed", "follow-up Work inherits reviewed access");

    // Adding a second Codex preset makes the choice ambiguous, so unpicked brand-new Lines stop guessing.
    const secondCodex = presets.add({ agent:"codex", model:"gpt-6.1-sol", effort:"medium" });
    assert.equal(service.presetFor(project, "brand-new-2", "codex"), null);
    presets.remove(secondCodex.id);
    assert.equal(service.presetFor(project, "brand-new-2", "codex")?.id, reviewedCodex.id);
  } finally { service.close(); }

  // 3) Client UI runPreset picks the sole saved Reviewed Codex preset on a new Line, and whereParts displays Reviewed.
  const freshLine = { id:"fresh", slug:"fresh", title:"Fresh", status:"waiting", why:"Not sent", stations:[{ id:"ask-1", kind:"ask", unsent:true, text:"Test", when:"2026-11-26 09:00", files:[], refers:[] }], questions:[], pictures:[], labels:[] };
  const proj = { id:"p1", name:"ReviewedSole", code:true, trunk:"main", defaultAgent:"", lines:[freshLine], landed:[], backlog:[], notes:[], pictures:[], files:[] };
  const ctx = vm.createContext({
    LINE_STATUS:require("../public/lines/line-status.js"),
    HOSTED:null, EMBED:null, navigationTransition:0,
    navigator:{ platform:"MacIntel" }, location:{ hash:"" }, localStorage:{ getItem:() => null, setItem() {}, removeItem() {} }, window:{},
    document:{ getElementById:() => null, addEventListener() {}, documentElement:{ addEventListener() {} }, body:{ append() {} }, querySelector:() => null, querySelectorAll:() => [] },
    matchMedia:() => ({ matches:false }), addEventListener() {}, requestAnimationFrame:fn => fn(),
    fetch:async () => ({ ok:true, status:200, json:async () => ({}) }),
    can:() => true, homeShape:() => "code", embedCanvas:() => ({}), embedShown() {},
    isWork:s => s.kind === "work", isEnd:s => ["merge", "deliver"].includes(s.kind), canReview:() => false,
    toast:() => {}, syncComposer() {}, renderPathPreview() {}, railSettingsHTML:() => "",
  });
  for (const name of ["core", "state", "panorama", "composer", "pages", "desk", "line", "settings"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../public/lines/${name}.js`), "utf8"), ctx, { filename:name });
  }
  ctx.__proj = proj; ctx.__presets = presets.list();
  vm.runInContext(`
    S.cur = "p1"; S.data.p1 = __proj;
    S.agents = [{ id:"codex", name:"Codex", available:true, runs:true, opens:true }, { id:"claude", name:"Claude Code", available:true, runs:true, opens:true }];
    S.presets = __presets;
    S.agentCheck = { agents:[{ id:"codex", model:{ name:"gpt-6.1-sol", effort:"high" }, access:{ normal:"full", full:true, reviewed:true } }] };
    S.route = { view:"home" };
  `, ctx);
  const run = code => vm.runInContext(code, ctx);
  assert.equal(run("runPreset(project(), lineById(project(), 'fresh'))?.id"), reviewedCodex.id);
  const split = run("runSplit(project(), lineById(project(), 'fresh'), lineById(project(), 'fresh').stations[0])");
  assert.match(split, /Run with Codex · gpt-6\.1-sol · high effort · reviewed/);
  assert.match(split, new RegExp(`data-agent="codex" data-preset="${reviewedCodex.id}"`));
  const whereHtml = run("whereParts({ id:'fresh', workdir:'/code', branch:'main' }, { id:'work-1', kind:'work', agent:'codex', picked:{ model:'gpt-6.1-sol', effort:'high' }, access:'reviewed', selectedAccess:'reviewed' }).meta");
  assert.match(whereHtml, /Reviewed/);
});

test("Preset agents splits saved presets from CLIs ready to add, quick-adds them all, and flags a provider that needs a fix", async () => {
  const claude = { id:"claude", name:"Claude Code", state:"ready", available:true, problems:[], model:{ name:"opus", efforts:["low", "medium", "high"] } };
  const codex = { id:"codex", name:"Codex", state:"ready", available:true, problems:[], model:{ name:"gpt-6.2-sol", effort:"xhigh", efforts:["medium", "high", "xhigh"] } };
  const kimi = { id:"kimi", name:"Kimi", state:"problem", available:true, problems:[{ kind:"fix", title:"Not signed in", fix:"Run kimi login" }], model:{ name:"k3" } };
  const { document, ctx, store } = presetEditor(claude);
  const toasts = [];
  ctx.toast = message => toasts.push(message);
  ctx.S.thisComputer = true;
  ctx.S.agentCheck = { problems:1, agents:[claude, codex, kimi] };
  ctx.runnableAgents = () => [claude, codex, kimi];
  const auto = id => ({ id:`auto:${id}`, name:{ claude:"Claude Code", codex:"Codex", kimi:"Kimi" }[id], agent:id, auto:true, available:true });
  ctx.S.presets = { default:"", presets:[auto("codex"), auto("claude"), auto("kimi")] };

  // No saved preset yet: an empty card offers New preset, and the ready CLIs (not the one needing a fix) wait on the shelf.
  ctx.render();
  assert.match(document.querySelector(".sys-empty").textContent, /No preset agents yet/);
  assert.ok(document.querySelector('.sys-empty [data-act="preset-new"]'));
  const shelf = () => Array.from(document.querySelectorAll('.sys-ready [data-preset]'), el => el.dataset.preset);
  assert.equal(document.querySelector("#sysReadyProviders").textContent, "Ready to add from Local providers");
  assert.deepEqual(shelf(), ["auto:claude", "auto:codex"], "alphabetical, without Kimi, whose CLI needs a fix");
  assert.match(document.querySelector('[data-preset="auto:codex"]').textContent, /Default model gpt-6\.2-sol/);
  assert.match(document.querySelector('[data-act="preset-quick-add-all"]').textContent, /Quick-add all \(2\)/);

  // Quick-add all saves one preset per ready CLI with its default model and a suggested effort.
  await ctx.ACT["preset-quick-add-all"]();
  const saved = store.list().presets.filter(x => !x.auto);
  assert.deepEqual(saved.map(x => [x.agent, x.model, x.effort, x.showInPicker, x.allowDelegation]).sort(), [["claude", "opus", "medium", true, true], ["codex", "gpt-6.2-sol", "xhigh", true, true]]);
  assert.deepEqual(toasts, ["Added 2 presets for Auto and Orchestrator."]);

  // Saved presets are listed under Your preset agents; one whose CLI needs a sign-in takes you to Local providers.
  ctx.S.presets = { default:"", presets:[...saved, { id:"k1", name:"Kimi · k3", agent:"kimi", model:"k3", effort:"", available:true, auto:false }] };
  ctx.render();
  assert.equal(document.querySelector(".sys-empty"), null);
  assert.equal(document.querySelector("#sysReadyProviders"), null, "nothing left to add");
  const fix = document.querySelector('[data-preset="k1"] [data-act="open-setup"]');
  assert.equal(fix.textContent, "Provider needs sign-in → Fix");
  kimi.problems = [{ kind:"fix", title:"Crashes at start", fix:"Reinstall kimi" }];
  ctx.render();
  assert.equal(document.querySelector('[data-preset="k1"] [data-act="open-setup"]').textContent, "Provider needs fix → Fix");
  assert.equal(document.querySelector('[data-preset="k1"] [data-act="preset-edit"]').textContent, "Edit");
  // The form names its first field Local provider and marks a provider that needs a fix.
  ctx.ACT["preset-new"]();
  assert.equal(document.querySelector('.sys-form[data-form="preset"] label span').textContent, "Local provider");
  assert.deepEqual(Array.from(document.querySelectorAll('select[name="agent"] option'), o => o.textContent), ["Claude Code", "Codex", "Kimi (needs fix)"]);
  assert.equal(document.querySelector('button[type="submit"]').textContent, "Add preset");
});

test("Preset agents with nothing to run says so: a check in progress, or the way to Local providers", () => {
  const { document, ctx } = presetEditor();
  ctx.S.thisComputer = true;
  ctx.S.presets = { default:"", presets:[] };
  ctx.S.agentCheck = null;
  ctx.render();
  assert.match(document.querySelector('.sys-empty[role="status"]').textContent, /Checking local providers/);
  ctx.S.agentCheck = { problems:0, agents:[{ id:"codex", name:"Codex", state:"missing", problems:[] }] };
  ctx.runnableAgents = () => [];
  ctx.render();
  assert.match(document.querySelector(".sys-empty").textContent, /Install or sign in to a CLI tool in Local providers first/);
  assert.equal(document.querySelector('.sys-empty [data-act="open-setup"]').textContent, "Go to Local providers →");
  assert.equal(document.querySelector('[data-act="preset-new"]'), null, "no New preset without a provider to run it");
});

test("a Local providers row says which presets use it and creates a prefilled preset in Preset agents", () => {
  const codex = { id:"codex", name:"Codex", mono:"Cx", color:"#10a37f", state:"ready", available:true, where:"/bin/codex", problems:[], model:{ name:"gpt-6.2-sol", effort:"high", efforts:["low", "medium", "high"] } };
  const { document, ctx } = presetEditor(codex);
  ctx.homeShort = value => value;
  ctx.S.thisComputer = true;
  ctx.S.agentCheck = { problems:0, agents:[codex, { id:"workbuddy", name:"WorkBuddy", mono:"Wb", color:"#333", state:"ready", where:"/Applications/WorkBuddy.app", problems:[] }] };
  ctx.S.presets = { default:"", presets:[{ id:"auto:codex", agent:"codex", name:"Codex", auto:true, available:true }] };
  document.body.innerHTML = ctx.setupRowHTML(codex);
  assert.equal(document.querySelector(".setup-linked.is-none").textContent, "No preset yet · default model gpt-6.2-sol");
  assert.ok(document.querySelector('[data-act="setup-create-preset"][data-agent="codex"]'));
  assert.equal(document.querySelector(".setup-model"), null);
  // WorkBuddy runs no Asks: no preset to make from it.
  document.body.innerHTML = ctx.setupRowHTML(ctx.S.agentCheck.agents[1]);
  assert.equal(document.querySelector('[data-act="setup-create-preset"]'), null);
  assert.equal(document.querySelector(".setup-linked"), null);

  ctx.S.presets.presets.push({ id:"p1", agent:"codex", name:"Codex · high", model:"gpt-6.2-sol", effort:"high", available:true }, { id:"p2", agent:"codex", name:"Codex · medium", model:"", effort:"medium", available:true });
  document.body.innerHTML = ctx.setupRowHTML(codex);
  assert.match(document.querySelector(".setup-linked").textContent, /2 presets: gpt-6\.2-sol · high effort, gpt-6\.2-sol · medium effort/);
  assert.ok(document.querySelector('.setup-linked [data-act="open-agents"]'));

  // + Create preset opens Preset agents with a new preset's form filled in for that provider.
  const opened = [];
  ctx.openSettings = id => { opened.push(id); ctx.S.shelfPage = "agents"; };
  ctx.render = () => { document.body.innerHTML = ctx.agentsSectionHTML(); };
  ctx.ACT["setup-create-preset"]({ dataset:{ agent:"codex" } });
  assert.deepEqual(opened, ["agents"]);
  const form = document.querySelector('.sys-form[data-form="preset"]');
  assert.ok(form && !form.closest(".is-editing"), "the new preset's form is in the main editor slot");
  assert.equal(form.querySelector('select[name="agent"] option[selected]').value, "codex");
  assert.equal(form.querySelector('select[name="modelChoice"] option[selected]')?.value ?? form.querySelector('input[name="model"]').value, "gpt-6.2-sol");
  assert.equal(form.querySelector('select[name="effortChoice"] option[selected]').value, "high");
});
