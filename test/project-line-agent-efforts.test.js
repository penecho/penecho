"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test, after } = require("node:test");
const { parseHTML } = require("./helpers/dom.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentCheck, tryOne } = require("../src/server/project-lines/agent-check.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");
const { modelOf, effortsWith, defaultEffortWith, parseOpenCodeModels } = require("../src/server/project-lines/agent-model.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pe-agent-efforts-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
const fresh = name => { const dir = path.join(temp, `${name}-${++counter}`); fs.mkdirSync(dir, { recursive:true }); return dir; };
const put = (home, file, text) => { fs.mkdirSync(path.dirname(path.join(home, file)), { recursive:true }); fs.writeFileSync(path.join(home, file), text); };
const at = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

function fakeCliEnv(home, ids, extraEnv = {}) {
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive:true });
  for (const id of ids) fs.writeFileSync(path.join(bin, id), "#!/bin/sh\necho 1.0.0\n", { mode:0o755 });
  const vars = { claude:"CLAUDE_CLI_PATH", codex:"CODEX_CLI_PATH", opencode:"OPENCODE_CLI_PATH", pi:"PI_CLI_PATH", omp:"OMP_CLI_PATH", kimi:"KIMI_CLI_PATH" };
  const cliEnv = Object.fromEntries(ids.filter(id => vars[id]).map(id => [vars[id], path.join(bin, id)]));
  return { HOME:home, PATH:bin, ...cliEnv, ...extraEnv };
}

test("OpenCode 2 takes the level inside --model, and none of the flags it dropped; OpenCode 1 keeps its own", () => {
  const home = fresh("opencode2"), env = fakeCliEnv(home, ["opencode"]), file = path.join(home, "bin", "opencode");
  const agents = createAgents({ env, appFolders:[] });
  const opts = { workdir:home, docs:home, gitDir:"", also:[], model:"magpie/zcode/GLM-5.4", effort:"max", resume:"ses_1" };
  assert.deepEqual(agents.command("opencode", opts).args, ["run", "--format", "json", "--auto", "--dir", home, "--model", "magpie/zcode/GLM-5.4", "--variant", "max", "--session", "ses_1"]);
  // Updated in place while PenEcho runs: the next run sees it.
  fs.writeFileSync(file, "#!/bin/sh\necho opencode v2.4.1\n", { mode:0o755 });
  const run = agents.command("opencode", opts);
  assert.deepEqual(run.args, ["run", "--standalone", "--format", "json", "--auto", "--model", "magpie/zcode/GLM-5.4#max", "--session", "ses_1"]);
  assert.equal(run.cwd, home);
  const answer = agents.answerer("opencode", { model:"a/b", effort:"low" });
  assert.deepEqual(answer.args, ["run", "--standalone", "--format", "json", "--model", "a/b#low"]);
  assert.equal(answer.dirFlag, undefined);
  assert.deepEqual(agents.command("opencode", { ...opts, model:"", effort:"", resume:null }).args, ["run", "--standalone", "--format", "json", "--auto"]);
  assert.throws(() => agents.command("opencode", { ...opts, model:"" }), { code:"BAD_EFFORT" });
  put(home, ".config/opencode/opencode.json", JSON.stringify({ model:"own/default" }));
  assert.ok(agents.command("opencode", { ...opts, model:"" }).args.includes("own/default#max"), "a level alone goes with the configured model");
});

test("Claude Code overrides CLAUDE_CODE_EFFORT_LEVEL via --settings across command, answerer, and reviewer", () => {
  const home = fresh("claude");
  put(home, ".claude/settings.json", JSON.stringify({ effortLevel:"low", env:{ CLAUDE_CODE_EFFORT_LEVEL:"low" } }));
  const env = fakeCliEnv(home, ["claude"], { CLAUDE_CODE_EFFORT_LEVEL:"medium" });
  const agents = createAgents({ env, appFolders:[] });

  assert.equal(modelOf("claude", env).effort, "low", "settings.json env takes precedence over shell env");
  put(home, ".claude/settings.json", JSON.stringify({ effortLevel:"xhigh" }));
  assert.equal(modelOf("claude", { HOME:home }).effort, "", "unattended -p ignores settings.json effortLevel");

  for (const cmd of [
    agents.command("claude", { workdir:home, docs:home, gitDir:"", also:[], model:"sonnet", effort:"high" }),
    agents.answerer("claude", { model:"sonnet", effort:"high" }),
    agents.reviewer("claude", { model:"sonnet", effort:"high", dirs:[home] }),
  ]) {
    assert.equal(at(cmd.args, "--effort"), "high");
    assert.deepEqual(JSON.parse(at(cmd.args, "--settings")), { env:{ CLAUDE_CODE_EFFORT_LEVEL:"high" } });
  }

  for (const cmd of [
    agents.command("claude", { workdir:home, docs:home, gitDir:"", also:[], model:"sonnet", effort:"" }),
    agents.answerer("claude", { model:"sonnet", effort:"" }),
    agents.reviewer("claude", { model:"sonnet", effort:"", dirs:[home] }),
  ]) {
    assert.equal(at(cmd.args, "--effort"), undefined);
    assert.equal(at(cmd.args, "--settings"), undefined);
  }
});

test("OpenCode parses explicit empty/disabled variants and refuses unsupported variants everywhere", async () => {
  const home = fresh("opencode");
  put(home, ".config/opencode/opencode.json", JSON.stringify({
    model:"magpie/empty-var",
    provider:{
      magpie:{
        models:{
          "empty-var":{ variants:{} },
          "has-disabled":{ variants:{ low:{}, high:{ disabled:true }, max:{} } },
          "no-key":{},
        },
      },
    },
  }));
  const env = fakeCliEnv(home, ["opencode"]);
  const fromConfig = modelOf("opencode", env);
  assert.deepEqual(effortsWith("magpie/empty-var", fromConfig), [], "explicit empty variants in opencode.json means none");
  assert.deepEqual(effortsWith("magpie/has-disabled", fromConfig), ["low", "max"], "disabled variants are excluded");
  assert.ok(effortsWith("magpie/no-key", fromConfig).includes("high"), "omitted variants key stays open until opencode models --verbose");

  const verboseOutput = [
    "opencode/big-pickle",
    JSON.stringify({ id:"big-pickle", variants:{} }),
    "magpie/no-key",
    JSON.stringify({ id:"no-key", variants:{ low:{}, high:{}, max:{}, medium:{ disabled:true } } }),
    "magpie/empty-var",
    JSON.stringify({ id:"empty-var", variants:{} }),
  ].join("\n");
  assert.deepEqual(parseOpenCodeModels(verboseOutput), {
    "opencode/big-pickle":[],
    "magpie/no-key":["low", "high", "max"],
    "magpie/empty-var":[],
  });
  assert.equal(parseOpenCodeModels("not model output"), null);

  const run = async (cmd, args) => {
    if (args.includes("--version")) return { status:0, stdout:"2.2.6\n", stderr:"" };
    if (args.includes("models")) return { status:0, stdout:verboseOutput, stderr:"" };
    return { status:1, stdout:"", stderr:"" };
  };
  const agents = createAgents({ env, appFolders:[], run });
  await agents.listLevels("opencode");

  assert.throws(
    () => agents.command("opencode", { workdir:home, docs:home, gitDir:"", also:[], model:"opencode/big-pickle", effort:"high" }),
    { code:"BAD_EFFORT", message:/opencode\/big-pickle does not take the reasoning level high\. It takes none\./ },
  );
  assert.throws(
    () => agents.command("opencode", { workdir:home, docs:home, gitDir:"", also:[], model:"magpie/no-key", effort:"medium" }),
    { code:"BAD_EFFORT", message:/magpie\/no-key does not take the reasoning level medium\. It takes low, high, max\./ },
  );
  assert.throws(
    () => agents.answerer("opencode", { model:"", effort:"high" }),
    { code:"BAD_EFFORT", message:/magpie\/empty-var does not take the reasoning level high\. It takes none\./ },
  );
  assert.equal(at(agents.command("opencode", { workdir:home, docs:home, gitDir:"", also:[], model:"magpie/no-key", effort:"max" }).args, "--variant"), "max");
  assert.equal(at(agents.command("opencode", { workdir:home, docs:home, gitDir:"", also:[], model:"opencode/big-pickle", effort:"" }).args, "--variant"), undefined);

  const tried = await tryOne(agents, "opencode", { env, pick:{ model:"opencode/big-pickle", effort:"high" } });
  assert.equal(tried.ok, false);
  assert.match(tried.error, /does not take the reasoning level high/);

  const check = createAgentCheck(agents, { env, run });
  const checked = await check.check();
  const oc = checked.agents.find(a => a.id === "opencode");
  assert.deepEqual(oc.model.effortsFor["opencode/big-pickle"], []);
  assert.deepEqual(oc.model.effortsFor["magpie/no-key"], ["low", "high", "max"]);
  assert.match((await check.pickModel("opencode", { model:"opencode/big-pickle", effort:"high" })).error, /does not take the reasoning level high/);
});

test("blank-model and blank-effort saved presets are not overwritten by stale agent-models.json in pinSettings", () => {
  const home = fresh("pin"), stateDir = fresh("state"), docsDir = fresh("docs");
  const env = fakeCliEnv(home, ["codex"]);
  const agents = createAgents({ env, appFolders:[] });
  agents.useModelFile(path.join(stateDir, "agent-models.json"));
  agents.pickModel("codex", "gpt-6.2-astra", "max");

  const service = new Service({ directory:stateDir, agents, autoWatch:false, memory:{ home, env:{} }, conversations:{ home, env:{} } });
  try {
    const presets = service.presets = createAgentPresets({ file:path.join(stateDir, "presets.json"), agents });
    const blankCodex = presets.add({ agent:"codex", model:"", effort:"" });
    const project = service.store.create({ name:"BlankPreset", docsPath:docsDir });
    const slug = "codex-blank";
    service.writeDoc(project, slug, F.initialLine({ title:"Codex blank", who:"@codex", status:"working", steps:[
      F.askStep({ words:"Do task" }),
      { ...F.workStep({ who:"codex" }), id:"work-1" },
      { ...F.workStep({ who:"codex" }), id:"work-2" },
      { ...F.workStep({ who:"codex" }), id:"work-3" },
      { ...F.workStep({ who:"codex" }), id:"work-4" },
    ] }));

    // 1. Direct saved preset with blank model & effort keeps runner defaults, never stale agent-models.json.
    service.pinSettings(project, slug, { id:"work-1", who:"codex" }, null, blankCodex);
    const pinned1 = service.presetFor(project, slug, "codex", "work-1");
    assert.deepEqual([pinned1.model, pinned1.effort, pinned1.auto], ["", "", false]);
    const cmd1 = agents.command("codex", { workdir:home, docs:home, gitDir:"", also:[], ...presets.handOver(pinned1) });
    assert.equal(cmd1.thread.model, undefined);
    assert.equal(cmd1.turn.effort, undefined);

    // 2. Retry of a legacy blank preset Work (with recorded selection: preset, even without saved agent id) keeps blank defaults.
    service.startDetail(project, slug, { id:"work-1", label:"Work 1" }, "codex", { title:"Codex blank", steps:[] }, blankCodex);
    const rel1 = F.detailPath(slug, "work-1");
    service.store.writeText(project, rel1, F.setFront(service.store.readText(project, rel1).text, { "saved agent id":null }));
    service.workSettings.delete(service.workSettingsKey(project, slug, "work-1"));
    service.pinSettings(project, slug, { id:"work-2", who:"codex" }, { id:"work-1", who:"codex" });
    const pinned2 = service.presetFor(project, slug, "codex", "work-2");
    assert.deepEqual([pinned2.model, pinned2.effort, pinned2.auto], ["", "", false]);

    // 3. Inherited preset from lastWorkPreset (blank model, runtime effort xhigh) does not pick up stale modelFor.
    service.store.writeText(project, rel1, F.setFront(service.store.readText(project, rel1).text, { model:"gpt-6.2-sol", effort:"xhigh" }));
    const inherited = service.lastWorkPreset(project, slug, "codex", "work-3");
    service.pinSettings(project, slug, { id:"work-3", who:"codex" }, null, inherited);
    const pinned3 = service.presetFor(project, slug, "codex", "work-3");
    assert.deepEqual([pinned3.model, pinned3.effort, pinned3.auto], ["", "xhigh", false]);

    // 4. Automatic runner (auto:codex) still inherits agent-models.json as intended.
    service.pinSettings(project, slug, { id:"work-4", who:"codex" }, null, { id:"auto:codex", agent:"codex", auto:true, model:"", effort:"" });
    const pinned4 = service.presetFor(project, slug, "codex", "work-4");
    assert.deepEqual([pinned4.model, pinned4.effort], ["gpt-6.2-astra", "max"]);
  } finally {
    service.close();
  }
});

test("omp parses thinking.efforts (10/12-space, inline, empty, reasoning:false), avoids silent downgrades, and only claims role default without --model", () => {
  const home = fresh("omp");
  put(home, ".omp/agent/config.yml", "modelRoles:\n  default: mock/flash:max\n");
  put(home, ".omp/agent/models.yml", [
    "providers:",
    "  mock:",
    "    models:",
    "      - id: flash",
    "        reasoning: true",
    "        thinking:",
    "          efforts:",
    "            - low",
    "            - high",
    "            - max",
    "      - id: compact",
    "        reasoning: true",
    "        thinking:",
    "          efforts:",
    "          - low",
    "          - high",
    "      - id: inline",
    "        reasoning: true",
    "        thinking:",
    "          efforts: [low, max]",
    "      - id: none-listed",
    "        reasoning: true",
    "        thinking:",
    "          efforts: []",
    "      - id: plain",
    "        reasoning: false",
  ].join("\n") + "\n");
  const env = fakeCliEnv(home, ["omp"]);
  const omp = modelOf("omp", env);

  assert.deepEqual(omp.effortsFor["mock/flash"], ["low", "high", "max", "auto"]);
  assert.deepEqual(omp.effortsFor["mock/compact"], ["low", "high", "auto"]);
  assert.deepEqual(omp.effortsFor["mock/inline"], ["low", "max", "auto"]);
  assert.deepEqual(omp.effortsFor["mock/none-listed"], []);
  assert.deepEqual(omp.effortsFor["mock/plain"], []);

  assert.equal(defaultEffortWith("", omp), "max", "blank omp with no --model inherits modelRoles.default effort");
  assert.equal(defaultEffortWith("mock/flash", omp), "", "picking a model must not claim modelRoles.default effort");

  const agents = createAgents({ env, appFolders:[] });
  assert.equal(agents.configuredEffort("omp", ""), "max");
  assert.equal(agents.configuredEffort("omp", "mock/flash"), "");
  for (const bad of ["off", "medium", "xhigh"]) {
    assert.throws(
      () => agents.command("omp", { workdir:home, docs:home, gitDir:"", also:[], model:"mock/flash", effort:bad }),
      { code:"BAD_EFFORT" },
    );
  }
  assert.throws(
    () => agents.command("omp", { workdir:home, docs:home, gitDir:"", also:[], model:"mock/plain", effort:"high" }),
    { code:"BAD_EFFORT", message:/takes none/ },
  );
  assert.throws(
    () => agents.command("omp", { workdir:home, docs:home, gitDir:"", also:[], model:"mock/none-listed", effort:"high" }),
    { code:"BAD_EFFORT", message:/takes none/ },
  );
  assert.equal(at(agents.command("omp", { workdir:home, docs:home, gitDir:"", also:[], model:"mock/flash", effort:"auto" }).args, "--thinking"), "auto");
  assert.equal(at(agents.command("omp", { workdir:home, docs:home, gitDir:"", also:[], model:"mock/flash", effort:"high" }).args, "--thinking"), "high");
});

test("Kimi enforces thinking=false, missing capabilities, support_efforts, and non-Kimi providers", () => {
  const home = fresh("kimi"), kimiHome = path.join(home, "custom-kimi");
  put(home, "custom-kimi/config.toml", [
    'default_model = "k/std"',
    "",
    "[thinking]",
    "enabled = false",
    'effort = "high"',
    "",
    '[providers."managed:kimi-code"]',
    'type = "kimi"',
    "",
    "[providers.anth]",
    'type = "anthropic"',
    "",
    "[providers.oai]",
    'type = "openai_responses"',
    "",
    '[models."k/std"]',
    'provider = "managed:kimi-code"',
    'capabilities = ["thinking", "tool_use"]',
    'support_efforts = ["low", "high", "max"]',
    'default_effort = "low"',
    "",
    '[models."k/always"]',
    'provider = "managed:kimi-code"',
    'capabilities = ["thinking", "always_thinking"]',
    'support_efforts = ["low", "high"]',
    'default_effort = "low"',
    "",
    '[models."k/nocaps"]',
    'provider = "managed:kimi-code"',
    "",
    '[models."anth/claude"]',
    'provider = "anth"',
    'capabilities = ["thinking"]',
    'support_efforts = ["low", "high", "max"]',
    "",
    '[models."oai/gpt"]',
    'provider = "oai"',
    'capabilities = ["thinking", "always_thinking"]',
    'support_efforts = ["low", "high", "max"]',
  ].join("\n") + "\n");

  const env = fakeCliEnv(home, ["kimi"], { KIMI_CODE_HOME:kimiHome });
  const kimi = modelOf("kimi", env);
  assert.deepEqual(kimi.effortsFor["k/std"], [], "thinking enabled = false turns off thinking models");
  assert.match(kimi.whyNone["k/std"], /thinking is switched off/);
  assert.deepEqual(kimi.effortsFor["k/always"], ["low", "high"], "always_thinking stays active even when enabled = false");
  assert.equal(defaultEffortWith("k/always", kimi), "high");
  assert.deepEqual(kimi.effortsFor["k/nocaps"], [], "omitted capabilities disables thinking on wire");
  assert.deepEqual(kimi.effortsFor["anth/claude"], [], "non-kimi provider ignores KIMI_MODEL_THINKING_EFFORT");
  assert.match(kimi.whyNone["anth/claude"], /thinking is switched off/);
  assert.deepEqual(kimi.effortsFor["oai/gpt"], [], "non-kimi provider with always_thinking still ignores KIMI_MODEL_THINKING_EFFORT");
  assert.match(kimi.whyNone["oai/gpt"], /ignores KIMI_MODEL_THINKING_EFFORT for openai_responses providers/);

  const agents = createAgents({ env, appFolders:[] });
  assert.throws(
    () => agents.command("kimi", { workdir:home, docs:home, gitDir:"", also:[], model:"k/std", effort:"max" }),
    { code:"BAD_EFFORT", message:/thinking is switched off/ },
  );
  assert.throws(
    () => agents.command("kimi", { workdir:home, docs:home, gitDir:"", also:[], model:"k/always", effort:"max" }),
    { code:"BAD_EFFORT", message:/It takes low, high\./ },
  );
  assert.throws(
    () => agents.command("kimi", { workdir:home, docs:home, gitDir:"", also:[], model:"k/nocaps", effort:"high" }),
    { code:"BAD_EFFORT", message:/It takes none\./ },
  );
  assert.throws(
    () => agents.command("kimi", { workdir:home, docs:home, gitDir:"", also:[], model:"oai/gpt", effort:"max" }),
    { code:"BAD_EFFORT", message:/ignores KIMI_MODEL_THINKING_EFFORT for openai_responses providers/ },
  );
  assert.equal(agents.command("kimi", { workdir:home, docs:home, gitDir:"", also:[], model:"k/always", effort:"high" }).env.KIMI_MODEL_THINKING_EFFORT, "high");

  // With thinking enabled = true, kimi provider models work and non-kimi providers still reject KIMI_MODEL_THINKING_EFFORT.
  put(home, "custom-kimi/config.toml", fs.readFileSync(path.join(kimiHome, "config.toml"), "utf8").replace("enabled = false", "enabled = true"));
  const enabled = modelOf("kimi", env);
  assert.deepEqual(enabled.effortsFor["k/std"], ["low", "high", "max"]);
  assert.deepEqual(enabled.effortsFor["anth/claude"], []);
  assert.match(enabled.whyNone["anth/claude"], /ignores KIMI_MODEL_THINKING_EFFORT for anthropic providers/);
});

test("Codex review() keeps Codex's own default effort while answer() defaults to low", () => {
  const home = fresh("codex");
  const env = fakeCliEnv(home, ["codex"]);
  const agents = createAgents({ env, appFolders:[] });

  const ansBlank = agents.answerer("codex", { model:"", effort:"" });
  assert.ok(ansBlank.args.includes('model_reasoning_effort="low"'), "Ask tab answer defaults to low");
  const ansHigh = agents.answerer("codex", { model:"gpt-6.2-sol", effort:"high" });
  assert.ok(ansHigh.args.includes('model_reasoning_effort="high"'));

  const revBlank = agents.reviewer("codex", { model:"", effort:"" });
  assert.ok(!revBlank.args.some(arg => arg.includes("model_reasoning_effort")), "review with blank effort leaves Codex's own default alone");
  const revMed = agents.reviewer("codex", { model:"gpt-6.2-sol", effort:"medium" });
  assert.ok(revMed.args.includes('model_reasoning_effort="medium"'));
});

test("Pi respects reasoning:false and thinkingLevelMap when listing and validating efforts", () => {
  const home = fresh("pi");
  put(home, ".pi/agent/settings.json", JSON.stringify({ defaultProvider:"p", defaultModel:"no-map", defaultThinkingLevel:"max" }));
  put(home, ".pi/agent/models.json", JSON.stringify({
    providers:{
      p:{
        models:[
          { id:"no-reason", reasoning:false },
          { id:"no-map", reasoning:true },
          { id:"mapped", reasoning:true, thinkingLevelMap:{ off:null, minimal:null, low:"low", medium:null, high:"high", xhigh:null, max:"max" } },
        ],
      },
    },
  }));
  const env = fakeCliEnv(home, ["pi"]);
  const pi = modelOf("pi", env);
  assert.deepEqual(pi.effortsFor["p/no-reason"], []);
  assert.deepEqual(pi.effortsFor["p/no-map"], ["off", "minimal", "low", "medium", "high"]);
  assert.deepEqual(pi.effortsFor["p/mapped"], ["low", "high", "max"]);
  assert.equal(defaultEffortWith("", pi), "", "defaultThinkingLevel max is not claimed for a model without max in thinkingLevelMap");

  const agents = createAgents({ env, appFolders:[] });
  assert.throws(() => agents.command("pi", { workdir:home, docs:home, gitDir:"", also:[], model:"p/no-reason", effort:"low" }), { code:"BAD_EFFORT" });
  assert.throws(() => agents.command("pi", { workdir:home, docs:home, gitDir:"", also:[], model:"p/no-map", effort:"max" }), { code:"BAD_EFFORT" });
  assert.throws(() => agents.command("pi", { workdir:home, docs:home, gitDir:"", also:[], model:"p/mapped", effort:"medium" }), { code:"BAD_EFFORT" });
  assert.equal(at(agents.command("pi", { workdir:home, docs:home, gitDir:"", also:[], model:"p/mapped", effort:"max" }).args, "--thinking"), "max");
});

test("HTTP /agent-presets refuses unsupported efforts on save and still allows renaming legacy presets", async t => {
  const home = fresh("http"), stateDir = fresh("state");
  put(home, ".omp/agent/models.yml", "providers:\n  p:\n    models:\n      - id: m1\n        reasoning: true\n        thinking:\n          efforts: [low, high, max]\n");
  put(home, ".config/opencode/opencode.json", JSON.stringify({ model:"p/empty", provider:{ p:{ models:{ empty:{ variants:{} } } } } }));
  const env = fakeCliEnv(home, ["omp", "opencode"]);
  const agents = createAgents({ env, appFolders:[], run:async () => ({ status:0, stdout:"p/empty\n{\"variants\":{}}\n", stderr:"" }) });
  const lines = createProjectLines({
    directory:stateDir, agents, serviceOptions:{ autoWatch:false },
    authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => s += d).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); },
  });
  t.after(() => lines.close());
  const server = http.createServer(async (req, res) => {
    const handled = await lines.handle(req, res, new URL(req.url, "http://127.0.0.1"));
    if (handled === false && !res.headersSent) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (url, method, body) => {
    const res = await fetch(`${base}${url}`, { method, headers:{ "content-type":"application/json" }, body:JSON.stringify(body) });
    return { status:res.status, body:await res.json() };
  };

  const badOmp = await req("/api/lines/agent-presets", "POST", { agent:"omp", model:"p/m1", effort:"medium" });
  assert.equal(badOmp.status, 400);
  assert.equal(badOmp.body.code, "BAD_PRESET");
  assert.match(badOmp.body.error, /does not take the reasoning level medium/);

  const badOc = await req("/api/lines/agent-presets", "POST", { agent:"opencode", model:"p/empty", effort:"high" });
  assert.equal(badOc.status, 400);
  assert.equal(badOc.body.code, "BAD_PRESET");
  assert.match(badOc.body.error, /takes none/);

  const ok = await req("/api/lines/agent-presets", "POST", { agent:"omp", model:"p/m1", effort:"high" });
  assert.equal(ok.status, 200);

  // A legacy preset already on disk with an unsupported effort can still be renamed without changing agent/model/effort.
  const legacy = lines.service.presets.add({ agent:"omp", model:"p/m1", effort:"medium" });
  const renamed = await req(`/api/lines/agent-presets/${legacy.id}`, "PATCH", { name:"Legacy omp" });
  assert.equal(renamed.status, 200);
  const changedEffort = await req(`/api/lines/agent-presets/${legacy.id}`, "PATCH", { effort:"xhigh" });
  assert.equal(changedEffort.status, 400);
  assert.equal(changedEffort.body.code, "BAD_PRESET");
});

test("Settings UI shows whyNone hints, hides omp role default when a model is picked, and does not nudge zero-level models", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const kimiRunner = {
    id:"kimi", name:"Kimi", available:true,
    model:{ name:"k/off", effort:"", choices:["k/off"], efforts:["low", "high", "max"], effortsFor:{ "k/off":[] }, defaultEffortFor:{ "k/off":"" }, whyNone:{ "k/off":"thinking is switched off in ~/.kimi-code/config.toml" } },
  };
  const ompRunner = {
    id:"omp", name:"omp", available:true,
    model:{ name:"mock/flash", effort:"max", choices:["mock/flash"], efforts:["low", "high", "max", "auto"], effortsFor:{ "mock/flash":["low", "high", "max", "auto"] }, defaultEffortFor:{} },
  };
  const S = { presets:{ presets:[], default:"" }, agentCheck:{ agents:[kimiRunner, ompRunner] } };
  const ctx = vm.createContext({
    document, S, ACT:{}, esc:String, ic:() => "", av:() => "",
    agentInfo:id => S.agentCheck.agents.find(a => a.id === id),
    runnableAgents:() => S.agentCheck.agents,
    $:s => document.querySelector(s), requestAnimationFrame:fn => fn(), toast:assert.fail,
    render:() => {},
  });
  vm.runInContext(fs.readFileSync(require.resolve("../public/lines/settings.js"), "utf8"), ctx);

  // Kimi model with thinking switched off shows None + reason hint and is not marked unrated.
  document.body.innerHTML = ctx.presetEffortHTML(kimiRunner, { model:"k/off", effort:"" }, kimiRunner.model);
  assert.equal(document.querySelector('select[name="effortChoice"] option[value=""]').textContent, "None");
  assert.match(document.body.textContent, /Thinking is switched off in ~\/\.kimi-code\/config\.toml\./);
  assert.equal(ctx.presetNotRated({ agent:"kimi", model:"k/off", effort:"", available:true }), false);

  // omp blank model shows Default (max); picking mock/flash hides the false Default (max).
  assert.equal(ctx.presetDefaultEffort("omp", "", ompRunner.model), "max");
  assert.equal(ctx.presetDefaultEffort("omp", "mock/flash", ompRunner.model), "");
  document.body.innerHTML = ctx.presetEffortHTML(ompRunner, { model:"mock/flash", effort:"" }, ompRunner.model);
  assert.equal(document.querySelector('select[name="effortChoice"] option[value=""]').textContent, "Default");
});
