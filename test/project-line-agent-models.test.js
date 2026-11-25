"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgentCheck } = require("../src/server/project-lines/agent-check.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { modelOf, effortsWith } = require("../src/server/project-lines/agent-model.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pe-agent-models-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
const fresh = name => { const dir = path.join(temp, `${name}-${++counter}`); fs.mkdirSync(dir, { recursive:true }); return dir; };
const put = (home, file, text) => { fs.mkdirSync(path.dirname(path.join(home, file)), { recursive:true }); fs.writeFileSync(path.join(home, file), text); };
// A command for each agent that only says its version, so Agent setup counts it as ready.
function fakeAgents(home, ids) {
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive:true });
  for (const id of ids) fs.writeFileSync(path.join(bin, id), "#!/bin/sh\necho 1.0.0\n", { mode:0o755 });
  return { bin, env:{ HOME:home, PATH:bin, OPENCODE_CLI_PATH:path.join(bin, "opencode"), PI_CLI_PATH:path.join(bin, "pi"), KIMI_CLI_PATH:path.join(bin, "kimi") } };
}

test("each agent lists the models its own settings name, and never anything else from them", () => {
  const home = fresh("home");
  put(home, ".codex/config.toml", 'model = "gpt-6.1-sol"\nmodel_provider = "custom"\n\n[model_providers.custom]\nbase_url = "https://example.com"\nmodel = "not-a-pick"\n\n[profiles.fast]\nmodel = "gpt-mini"\n');
  put(home, ".codex/models_cache.json", JSON.stringify({ models:[{ slug:"gpt-6-astra", visibility:"list" }, { slug:"secret-tool", visibility:"hide" }, { slug:"gpt-6.1-sol", visibility:"list" }] }));
  put(home, ".config/opencode/opencode.json", '{\n  // mine\n  "model": "magpie/deepseek/deepseek-flash",\n  "provider": { "magpie": { "options": { "apiKey": "sk-hidden" }, "models": { "deepseek/deepseek-flash": {}, "auto/glm-5.3": {} } }, "moonshot": { "models": { "kimi-k3": {} } } },\n}\n');
  put(home, ".pi/agent/settings.json", '{"defaultProvider":"magpie","defaultModel":"auto/kimi-k3.1-pro"}');
  put(home, ".pi/agent/models.json", JSON.stringify({ providers:{ magpie:{ apiKey:"sk-hidden", models:[{ id:"auto/kimi-k3.1-pro" }, { id:"glm-5.3" }] }, ollama:{ models:[{ id:"qwen3.8:latest" }] } } }));
  put(home, ".kimi-code/config.toml", 'default_model = "magpie/auto/kimi-k3.1-pro"\n\n[providers.magpie]\napi_key = "sk-hidden"\n\n[models."magpie/auto/kimi-k3.1-pro"]\nprovider = "magpie"\n\n[models."kimi-code/k3"]\nprovider = "managed:kimi-code"\n');
  const env = { HOME:home };
  assert.deepEqual(modelOf("codex", env).choices, ["gpt-6.1-sol", "gpt-mini", "gpt-6-astra"], "its own model, each profile's, and those its picker shows");
  assert.deepEqual(modelOf("opencode", env).choices, ["magpie/deepseek/deepseek-flash", "magpie/auto/glm-5.3", "moonshot/kimi-k3"]);
  const pi = modelOf("pi", env);
  assert.equal(pi.name, "magpie/auto/kimi-k3.1-pro", "a model id with a slash still gets its provider");
  assert.deepEqual(pi.choices, ["magpie/auto/kimi-k3.1-pro", "magpie/glm-5.3", "ollama/qwen3.8:latest"]);
  assert.deepEqual(modelOf("kimi", env).choices, ["magpie/auto/kimi-k3.1-pro", "kimi-code/k3"]);
  assert.deepEqual(modelOf("claude", env).choices, ["fable", "opus", "sonnet", "haiku"], "Claude Code's own short names");
  assert.deepEqual(modelOf("claude", { HOME:home, ANTHROPIC_DEFAULT_SONNET_MODEL:"glm-5.3", ANTHROPIC_DEFAULT_FABLE_MODEL:"kimi-k3" }).choices, ["fable", "opus", "sonnet", "haiku", "kimi-k3", "glm-5.3"]);
  // The full names Claude Code keeps for its /model menu and its prices, newest first in each family. Nothing else in that file.
  put(home, ".claude.json", JSON.stringify({ oauthAccount:{ emailAddress:"me@example.com" }, primaryApiKey:"sk-hidden",
    additionalModelOptionsCache:[{ value:"claude-fable-5-1[1m]", label:"Fable" }, { value:"not a model" }],
    additionalModelCostsCache:{ "claude-fable-5":{}, "claude-fable-5-1":{}, "claude-fable-5-2":{}, "claude-haiku-4-5-20251001":{}, "claude-haiku-5-5":{}, "claude-opus-4-8":{}, "claude-opus-5":{}, "claude-opus-5-5":{}, "claude-sonnet-5-5":{}, "claude-mythos-5-1":{} } }));
  assert.deepEqual(modelOf("claude", env).choices, ["fable", "opus", "sonnet", "haiku", "claude-fable-5-2", "claude-fable-5-1", "claude-fable-5-1[1m]", "claude-fable-5",
    "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-haiku-4-5-20251001", "claude-mythos-5-1"]);
  assert.ok(modelOf("claude", { HOME:fresh("home"), CLAUDE_CONFIG_DIR:home }).choices.includes("claude-opus-5-5"), "CLAUDE_CONFIG_DIR keeps its own .claude.json");
  assert.doesNotMatch(JSON.stringify(modelOf("claude", env)), /sk-hidden|example\.com|not a model/);
  const dsh = modelOf("dsh", env);
  assert.equal(dsh.name, "", "its settings name none, so it runs its own default");
  assert.deepEqual(dsh.choices, ["deepseek-official/deepseek-flash", "deepseek-official/deepseek-v4-pro"], "dsh's own provider, with nothing in its settings");
  assert.equal(dsh.fixed, undefined, "its headless mode takes a model, so one can be picked");
  put(home, ".omp/agent/config.yml", 'modelRoles:\n  default: magpie/deepseek/deepseek-flash:max\n  smol: zhipu/glm-flash:high\ntools:\n  approvalMode: yolo\n');
  put(home, ".omp/agent/models.yml", 'providers:\n  magpie:\n    api: openai-completions\n    apiKey: sk-hidden\n    baseUrl: https://example.com/v1\n    models:\n      - contextWindow: 262144\n        cost:\n          input: 0.95\n        id: auto/kimi-k2.6\n        name: Kimi\n      - id: deepseek/deepseek-flash\n        name: Flash\n    headers:\n      id: not-a-pick\n  ollama:\n    models:\n      - id: "qwen3.8:latest"\n');
  const omp = modelOf("omp", env);
  assert.deepEqual([omp.name, omp.effort], ["magpie/deepseek/deepseek-flash", "max"], "omp's default role, with its level cut off");
  assert.deepEqual(omp.choices, ["magpie/deepseek/deepseek-flash", "magpie/auto/kimi-k2.6", "ollama/qwen3.8:latest"]);
  assert.doesNotMatch(JSON.stringify(omp), /sk-hidden|example\.com|not-a-pick/);
  for (const id of ["codex", "opencode", "pi", "kimi"]) assert.doesNotMatch(JSON.stringify(modelOf(id, env)), /sk-hidden|example\.com|not-a-pick/);
});

test("each agent lists the reasoning levels it takes, per model where it says so, with its own setting", () => {
  const home = fresh("home");
  put(home, ".codex/config.toml", 'model = "gpt-6-luna"\nmodel_reasoning_effort = "high"\n');
  put(home, ".codex/models_cache.json", JSON.stringify({ models:[{ slug:"gpt-6-luna", visibility:"list", supported_reasoning_levels:[{ effort:"low" }, { effort:"medium" }, { effort:"high" }] }, { slug:"gpt-6-sol", visibility:"list", supported_reasoning_levels:[{ effort:"low" }, { effort:"ultra" }] }] }));
  put(home, ".config/opencode/opencode.json", JSON.stringify({ model:"m/a", provider:{ m:{ models:{ a:{ variants:{ low:{}, max:{} } }, b:{} } } } }));
  put(home, ".pi/agent/settings.json", '{"defaultModel":"x","defaultThinkingLevel":"medium"}');
  put(home, ".kimi-code/config.toml", 'default_model = "k"\n\n[thinking]\nenabled = true\neffort = "high"\n\n[models.k]\ncapabilities = ["thinking"]\nsupport_efforts = ["low", "high"]\ndefault_effort = "low"\n');
  put(home, ".claude/settings.json", '{"effortLevel":"xhigh"}');
  const env = { HOME:home };
  const codex = modelOf("codex", env);
  assert.equal(codex.effort, "high");
  assert.deepEqual([effortsWith("gpt-6-luna", codex), effortsWith("gpt-6-sol", codex)], [["low", "medium", "high"], ["low", "ultra"]]);
  assert.deepEqual(effortsWith("unknown", codex), ["low", "medium", "high", "xhigh", "ultra"]);
  const opencode = modelOf("opencode", env);
  assert.deepEqual([effortsWith("m/a", opencode), effortsWith("m/b", opencode)], [["low", "max"], ["none", "minimal", "low", "medium", "high", "xhigh", "max"]], "a model's variants, or the basic levels for one that lists none");
  assert.deepEqual([modelOf("pi", env).effort, effortsWith("x", modelOf("pi", env))], ["medium", ["off", "minimal", "low", "medium", "high", "xhigh", "max"]]);
  assert.deepEqual([modelOf("kimi", env).effort, modelOf("kimi", env).efforts], ["high", ["low", "high", "max"]]);
  assert.deepEqual([modelOf("claude", env).effort, modelOf("claude", env).efforts], ["", ["low", "medium", "high", "xhigh", "max"]], 'its settings\' "effortLevel" is not claimed: an unattended run does not take it');
  assert.equal(modelOf("claude", { HOME:home, CLAUDE_CODE_EFFORT_LEVEL:"low" }).effort, "low");
  put(home, ".claude/settings.json", '{"env":{"CLAUDE_CODE_EFFORT_LEVEL":"max"}}');
  assert.equal(modelOf("claude", { HOME:home, CLAUDE_CODE_EFFORT_LEVEL:"low" }).effort, "max", "the env of its own settings comes before the shell's");
});

test("a model picked on Agent setup is kept by PenEcho and goes to every run of that agent", async () => {
  const home = fresh("home"), state = fresh("state"), ids = ["claude", "codex", "opencode", "pi", "kimi"], { env } = fakeAgents(home, ids);
  put(home, ".codex/config.toml", 'model = "gpt-6.1-sol"\n\n[profiles.fast]\nmodel = "gpt-mini"\n');
  put(home, ".config/opencode/opencode.json", '{"model":"a/b","provider":{"a":{"models":{"b":{},"c":{}}}}}');
  put(home, ".pi/agent/models.json", JSON.stringify({ providers:{ p:{ models:[{ id:"x" }] } } }));
  put(home, ".kimi-code/config.toml", '[models."kimi-code/k3"]\nprovider = "k"\n');
  const file = path.join(state, "agent-models.json"), agents = createAgents({ env, appFolders:[] });
  agents.useModelFile(file);
  const check = createAgentCheck(agents, { env });
  const first = await check.check();
  const byId = Object.fromEntries(first.agents.map(a => [a.id, a]));
  assert.equal(byId.codex.model.picked, "");
  assert.deepEqual(byId.codex.model.choices, ["gpt-6.1-sol", "gpt-mini"]);
  const run = id => agents.command(id, { workdir:home, docs:home, gitDir:"", also:[], resume:"r1" });
  assert.ok(!run("claude").args.includes("--model"), "nothing picked: the agent's own default");
  // A name its settings do not list is kept as typed: the agent knows its models better than its settings file says.
  assert.equal((await check.pickModel("codex", { model:"  typed-by-hand  " })).agents.find(a => a.id === "codex").model.picked, "typed-by-hand");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).codex.model, "typed-by-hand");
  assert.equal(run("codex").thread.model, "typed-by-hand");
  assert.match((await check.pickModel("codex", { model:"--yolo" })).error, /does not start with a dash/, "it becomes one word on a command line");
  assert.match((await check.pickModel("codex", { model:"a\nb" })).error, /one line/);
  assert.equal(agents.modelFor("codex"), "typed-by-hand", "a refused name changes nothing");
  for (const [id, model] of [["claude", "opus"], ["codex", "gpt-mini"], ["opencode", "a/c"], ["pi", "p/x"], ["kimi", "kimi-code/k3"]]) {
    const result = await check.pickModel(id, { model });
    assert.equal(result.agents.find(a => a.id === id).model.picked, model);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { claude:{ model:"opus" }, codex:{ model:"gpt-mini" }, opencode:{ model:"a/c" }, pi:{ model:"p/x" }, kimi:{ model:"kimi-code/k3" } });
  const at = (args, flag) => args[args.indexOf(flag) + 1];
  assert.equal(at(run("claude").args, "--model"), "opus");
  assert.equal(run("codex").thread.model, "gpt-mini", "Codex's app-server thread");
  assert.ok(agents.command("codex", { workdir:home, docs:home, gitDir:"", plain:true }).args.includes('model="gpt-mini"'), "and `codex exec`");
  assert.ok(agents.command("codex", { workdir:home, docs:home, gitDir:"", plain:true, resume:"t1" }).args.includes('model="gpt-mini"'), "and `codex exec resume`");
  assert.equal(at(run("opencode").args, "--model"), "a/c");
  assert.equal(at(run("pi").args, "--model"), "p/x");
  assert.equal(at(run("kimi").args, "--model"), "kimi-code/k3");
  // A PenEcho started again reads the same picks, and an older file that kept only the model.
  const again = createAgents({ env, appFolders:[] });
  again.useModelFile(file);
  assert.equal(again.modelFor("pi"), "p/x");
  const old = path.join(state, "old.json"); fs.writeFileSync(old, JSON.stringify({ pi:"p/x" }));
  again.useModelFile(old);
  assert.deepEqual([again.modelFor("pi"), again.effortFor("pi")], ["p/x", ""]);
  // Back to the agent's own default.
  await check.pickModel("claude", { model:"" });
  assert.ok(!run("claude").args.includes("--model"));
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).claude, undefined);
});

test("a reasoning level picked on Agent setup goes to every run, in each agent's own way", async () => {
  const home = fresh("home"), state = fresh("state"), ids = ["claude", "codex", "opencode", "pi", "kimi"], { env } = fakeAgents(home, ids);
  put(home, ".codex/config.toml", 'model = "luna"\n');
  put(home, ".codex/models_cache.json", JSON.stringify({ models:[{ slug:"luna", supported_reasoning_levels:[{ effort:"low" }, { effort:"high" }] }, { slug:"sol", supported_reasoning_levels:[{ effort:"ultra" }] }] }));
  put(home, ".config/opencode/opencode.json", JSON.stringify({ model:"a/b", provider:{ a:{ models:{ b:{ variants:{ max:{} } }, c:{} } } } }));
  const file = path.join(state, "agent-models.json"), agents = createAgents({ env, appFolders:[] });
  agents.useModelFile(file);
  const check = createAgentCheck(agents, { env });
  await check.check();
  const run = (id, more = {}) => agents.command(id, { workdir:home, docs:home, gitDir:"", also:[], ...more });
  const at = (args, flag) => args[args.indexOf(flag) + 1];
  assert.equal((await check.pickModel("codex", { effort:"ultra" })).error, "luna does not take the reasoning level ultra.", "only a level the model in use takes");
  for (const [id, effort] of [["claude", "max"], ["codex", "high"], ["opencode", "max"], ["pi", "minimal"], ["kimi", "low"]]) {
    const result = await check.pickModel(id, { effort });
    assert.equal(result.agents.find(a => a.id === id).model.pickedEffort, effort);
  }
  assert.equal(at(run("claude").args, "--effort"), "max");
  assert.equal(run("codex").turn.effort, "high", "Codex's app-server turn");
  assert.ok(run("codex", { plain:true }).args.includes('model_reasoning_effort="high"'), "and `codex exec`");
  assert.equal(at(run("opencode").args, "--variant"), "max");
  assert.equal(at(run("pi").args, "--thinking"), "minimal");
  assert.equal(run("kimi").env.KIMI_MODEL_THINKING_EFFORT, "low");
  // Picking a model keeps the level when that model takes it too, and drops it when it does not.
  assert.equal((await check.pickModel("codex", { model:"sol" })).agents.find(a => a.id === "codex").model.pickedEffort, "", "sol does not take high");
  assert.equal(run("codex").turn.effort, undefined);
  await check.pickModel("codex", { effort:"ultra" });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).codex, { model:"sol", effort:"ultra" });
  await check.pickModel("codex", { effort:"" });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).codex, { model:"sol" }, "back to its own level, the model stays");
});
