"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { test } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentCheck, tryOne } = require("../src/server/project-lines/agent-check.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const { modelOf, effortsWith, BASIC_EFFORTS } = require("../src/server/project-lines/agent-model.js");
const { dshPlan, stageDshPatch } = require("../src/server/project-lines/dsh-models.js");
const { createKeeper } = require("../src/server/project-lines/kept-child.js");
const { modelOf:workModel, priceFor } = require("../public/lines/work-pricing.js");

function fixture(t, { shipped = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pe dsh models "));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const env = { PATH:process.env.PATH, USERPROFILE:directory, DSH_HOME:path.join(directory, "dsh home") };
  const put = (file, contents) => {
    const at = path.join(env.DSH_HOME, file);
    fs.mkdirSync(path.dirname(at), { recursive:true });
    fs.writeFileSync(at, typeof contents === "string" ? contents : JSON.stringify(contents));
    return at;
  };
  const profile = (surface, rows, file = "cordis.patch.yml") => put(`profiles/${surface}/${file}`, rows);
  if (shipped) for (const [surface, bundle] of [["headless", "headless"], ["desktop", "web-app"], ["web", "web-app"]]) {
    profile(surface, { dsh:{ profile:{ bundles:["@deepseek-ai/dsh-base", `@deepseek-ai/dsh-${bundle}`] } } }, "package.json");
  }
  return { directory, env, put, profile };
}

const official = "deepseek-official";
const route = (provider, models, other = {}) => ({
  api:"openai-completions", baseURL:"https://fixture.invalid/v1", apiKeyEnv:"FIXTURE_KEY",
  models:models.map(model => typeof model === "string" ? { id:model } : model), ...other,
});
const pi = providers => ({ id:"llm-pi-ai", config:{ providers } });
const selected = (provider, model, reasoningEffort) => ({ id:"agent-default-model", config:{ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) } });

function launcher(f, version, dump = []) {
  const events = path.join(f.directory, "invocations.jsonl");
  const file = f.put("DeepSeek Harness/stand in.js", `
const fs = require("node:fs"), args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(events)}, JSON.stringify(args) + "\\n");
if (args.includes("--version")) { console.log(${JSON.stringify(version)}); process.exit(0); }
const at = args.indexOf("--patch");
if (args.includes("--dump-config")) {
  const rows = ${JSON.stringify(dump)};
  if (at !== -1) for (const patch of JSON.parse(fs.readFileSync(args[at + 1], "utf8"))) {
    const target = rows.find(row => row.id === patch.id);
    if (target) Object.assign(target, patch);
  }
  console.log(JSON.stringify(rows)); process.exit(0);
}
if (at !== -1) {
  if (at > args.indexOf("--json")) process.exit(2);
  const rows = JSON.parse(fs.readFileSync(args[at + 1], "utf8"));
  if (!rows.some(row => row.id === "agent-default-model")) process.exit(2);
}
process.stdin.resume();
process.stdin.on("end", () => console.log(JSON.stringify({ type:"text", text:"OK" })));
`);
  const env = { ...f.env, DSH_CLI_PATH:file };
  return { agents:createAgents({ env }), env, calls:() => fs.readFileSync(events, "utf8").trim().split("\n").map(line => JSON.parse(line)) };
}

test("dsh offers built-in model choices in a missing or empty DSH_HOME and verifies its default at launch", t => {
  const f = fixture(t, { shipped:false });
  for (const exists of [false, true]) {
    if (exists) fs.mkdirSync(f.env.DSH_HOME);
    const about = modelOf("dsh", f.env);
    assert.equal(about.name, "");
    assert.deepEqual(about.choices, [`${official}/deepseek-flash`, `${official}/deepseek-v4-pro`]);
    assert.equal(about.choiceLabels[`${official}/deepseek-flash`], "DeepSeek-V4.1-Flash");
    assert.deepEqual(effortsWith(`${official}/deepseek-flash`, about), ["off", "low", "high", "max"]);
    assert.deepEqual(effortsWith("typed-unlisted", about), BASIC_EFFORTS);
    assert.equal(about.fixed, undefined);
    assert.deepEqual(dshPlan(f.env, "", ""), { selection:null, patch:null, verify:true });
  }
});

test("dsh headless defaults and replacement config, desktop/web choices, and pi-ai catalog-backed providers", t => {
  const f = fixture(t);
  f.profile("headless", [pi({ legacy:route("legacy", ["old"]) })], "cordis.yml");
  f.profile("headless", [pi({
    shared:route("shared", [{ id:"gateway/core", name:"Core", reasoningEfforts:{ off:null, high:"high" } }, { id:"plain", reasoningEfforts:false }]),
    deepseek:{ apiKeyEnv:"DEEPSEEK_API_KEY" },
  }), selected("shared", "gateway/core", "high")]);
  f.profile("desktop", [pi({ shared:route("shared", ["desktop-only"]), desktop:route("desktop", ["desk"]) }), selected("desktop", "desk")]);
  f.profile("web", [pi({ web:route("web", ["browser"]) }), selected("web", "browser")]);
  f.put("storages/workspace.json", { providers:{ storageOnly:route("storageOnly", ["secret-storage-marker"]) } });
  f.put(".credentials.yaml", "refs:\n  FIXTURE_KEY: secret-credential-marker\n");
  const about = modelOf("dsh", f.env);
  assert.equal(about.name, "shared/gateway/core");
  assert.equal(about.effort, "high");
  assert.match(about.from, /headless[/\\]cordis.patch.yml$/);
  for (const name of ["shared/gateway/core", "shared/plain", "desktop/desk", "web/browser", "deepseek/deepseek-flash", `${official}/deepseek-v4-pro`]) {
    assert.ok(about.choices.includes(name), name);
  }
  assert.deepEqual(effortsWith("shared/gateway/core", about), ["off", "high"]);
  assert.deepEqual(effortsWith("shared/plain", about), ["off"]);
  assert.deepEqual(effortsWith("plain", about), ["off"]);
  assert.doesNotMatch(JSON.stringify(about), /secret-|fixture\.invalid|FIXTURE_KEY|desktop-only|legacy\/old/);
  assert.deepEqual(dshPlan(f.env, "shared/gateway/core", "").patch, [selected("shared", "gateway/core", "high")]);
});

test("dsh discovery reuses parsed files, invalidates edits, and leaves expressions inert", t => {
  const f = fixture(t);
  const watched = f.profile("headless", `- id: llm-pi-ai
  config:
    providers:
      team:
        baseURL: !!js "(() => { throw new Error('must stay inert') })()"
        models: [{ id: first }]
`);
  const read = fs.readFileSync, reads = [];
  const mock = t.mock.method(fs, "readFileSync", (file, ...args) => { if (file === watched) reads.push(file); return read(file, ...args); });
  assert.ok(modelOf("dsh", f.env).choices.includes("team/first"));
  for (let i = 0; i < 30; i++) assert.ok(modelOf("dsh", f.env).choices.includes("team/first"));
  assert.equal(reads.length, 1);
  f.profile("headless", [pi({ team:route("team", ["second"]) })]);
  assert.ok(modelOf("dsh", f.env).choices.includes("team/second"));
  assert.equal(reads.length, 2);
  f.profile("headless", "broken: [");
  assert.deepEqual(modelOf("dsh", f.env).choices, [`${official}/deepseek-flash`, `${official}/deepseek-v4-pro`]);
  f.profile("headless", " ".repeat(257 * 1024));
  assert.equal(modelOf("dsh", f.env).choices.length, 2);
  assert.equal(reads.length, 3, "oversized config is rejected before reading it");
  mock.mock.restore();
});

test("dsh fingerprints and composes the home patch after the profile patch", t => {
  const f = fixture(t);
  f.profile("headless", [selected(official, "deepseek-flash", "max")]);
  f.profile("desktop", [pi({ team:route("team", ["one"]) })]);
  const patch = f.put("cordis.patch.yml", [selected(official, "deepseek-v4-pro", "low")]);
  const read = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, "readFileSync", (file, ...args) => { if (file === patch) reads++; return read(file, ...args); });
  const { agents, calls } = launcher(f, "0.2.2-rc.1");
  const about = modelOf("dsh", f.env);
  assert.equal(about.name, `${official}/deepseek-v4-pro`);
  assert.equal(about.effort, "low");
  assert.equal(about.from, `~${patch.slice(f.directory.length)}`);
  const options = { workdir:f.directory, docs:f.directory };
  const defaults = agents.command("dsh", options);
  assert.equal(defaults.dshPatch, undefined);
  assert.deepEqual(defaults.dshSelection, { provider:official, model:"deepseek-v4-pro", effort:"low" });
  assert.deepEqual(agents.command("dsh", { ...options, effort:"high" }).dshPatch, [selected(official, "deepseek-v4-pro", "high")]);
  assert.deepEqual(calls(), [["--version"]]);
  assert.equal(reads, 1, "the same home layer is parsed once across profiles and repeated discovery");
  f.put("cordis.patch.yml", [selected(official, "deepseek-flash", "off")]);
  assert.equal(modelOf("dsh", f.env).effort, "off");
  assert.equal(reads, 2);
  fs.unlinkSync(patch);
  assert.equal(modelOf("dsh", f.env).effort, "max");
  f.put("cordis.patch.yml", "broken: [");
  assert.equal(dshPlan(f.env, `${official}/deepseek-v4-pro`, "high").verify, true);
  assert.throws(() => dshPlan(f.env, "team/one", ""), /Configure the team provider/);
});

test("dsh discovers the bundled OpenRouter catalog within the choice limit", t => {
  const f = fixture(t);
  f.profile("headless", [pi({ openrouter:{ apiKeyEnv:"OPENROUTER_API_KEY" } })]);
  const { choices, effortsFor } = modelOf("dsh", f.env);
  assert.equal(choices.length, 300);
  assert.ok(choices.filter(choice => choice.startsWith("openrouter/")).length > 200);
  assert.ok(choices.some(choice => choice.startsWith("openrouter/") && effortsFor[choice]?.includes("high")));
  assert.ok(choices.some(choice => choice.startsWith("openrouter/") && effortsFor[choice]?.join() === "off"));
});

test("dsh effort discovery uses high with thinking enabled and off for non-reasoning pi-ai models", t => {
  const f = fixture(t);
  assert.equal(modelOf("dsh", f.env).effort, "high");
  const deepseek = config => ({ id:"llm-deepseek", config });
  f.profile("headless", [deepseek({ thinking:"enabled" }), pi({ team:route("team", ["plain-by-default", { id:"plain-explicit", reasoningEfforts:false }]) })]);
  const about = modelOf("dsh", f.env);
  assert.equal(about.effort, "high");
  assert.deepEqual(about.effortsFor["team/plain-by-default"], ["off"]);
  assert.deepEqual(about.effortsFor["team/plain-explicit"], ["off"]);
  f.profile("headless", [deepseek({ thinking:"disabled" })]);
  assert.equal(modelOf("dsh", f.env).effort, "off");
  f.profile("headless", [deepseek({ thinking:"enabled", reasoningEffort:"low" })]);
  assert.equal(modelOf("dsh", f.env).effort, "low");
});

test("dsh resolves bare model names and effort-only picks and imports a portable desktop route", t => {
  const f = fixture(t);
  const local = route("local", ["same"]);
  const desktop = route("desktop", ["same", "unique"]);
  f.profile("headless", [pi({ local }), selected("local", "same", "low")]);
  f.profile("desktop", [pi({ desktop, noEnv:{ models:[{ id:"oauth" }] }, private:route("private", ["auth"], { headers:{ Authorization:"secret-header-marker" } }) })]);
  assert.deepEqual(dshPlan(f.env, "", "high").patch, [selected("local", "same", "high")]);
  assert.deepEqual(dshPlan(f.env, "same", "turbo").patch, [selected("local", "same", "turbo")]);
  assert.deepEqual(dshPlan(f.env, "manually-typed", "").patch, [selected("local", "manually-typed")]);
  assert.deepEqual(dshPlan(f.env, "custom/vendor/model", "").patch, [selected("custom", "vendor/model")]);
  assert.deepEqual(dshPlan(f.env, "unique", "max").patch, [pi({ local, desktop }), selected("desktop", "unique", "max")]);
  assert.throws(() => dshPlan(f.env, "noEnv/oauth", ""), /Configure the noEnv provider/);
  assert.throws(() => dshPlan(f.env, "private/auth", ""), /Configure the private provider/);
  assert.doesNotMatch(JSON.stringify(modelOf("dsh", f.env)), /secret-header-marker/);
  f.profile("headless", [pi({ local, unrelated:route("unrelated", ["x"], { headers:{ Authorization:"secret-headless" } }) })]);
  assert.throws(() => dshPlan(f.env, "same", ""), /Several dsh providers/);
  assert.throws(() => dshPlan(f.env, "desktop/unique", ""), /Configure the desktop provider/);
  assert.deepEqual(dshPlan(f.env, "local/same", "").patch, [selected("local", "same")], "a native headless config stays in dsh");
});

test("dsh runner defaults and presets save typed values, with no discovery subprocess on cached checks", async t => {
  const f = fixture(t);
  f.profile("headless", [pi({ local:route("local", [{ id:"plain", reasoningEfforts:false }]) })]);
  const { agents, env, calls } = launcher(f, "0.2.2-rc.1");
  env.DEEPSEEK_API_KEY = "fixture-value";
  const modelFile = path.join(f.directory, "agent-models.json");
  agents.useModelFile(modelFile);
  const check = createAgentCheck(agents);
  const first = await check.check();
  assert.deepEqual(first.agents.find(row => row.id === "dsh").model.effortsFor["local/plain"], ["off"]);
  for (let i = 0; i < 10; i++) await check.check();
  assert.deepEqual(calls(), [["--version"]]);
  assert.equal((await check.pickModel("dsh", { model:"local/" })).error, "Use a dsh model name or provider/model.");
  assert.match((await check.pickModel("dsh", { effort:"two words" })).error, /one word/);
  await check.pickModel("dsh", { model:"local/plain", effort:"manual-effort" });
  const reopened = createAgents({ env });
  reopened.useModelFile(modelFile);
  assert.equal(reopened.modelFor("dsh"), "local/plain");
  assert.equal(reopened.effortFor("dsh"), "manual-effort");
  assert.deepEqual(reopened.command("dsh", { workdir:f.directory, docs:f.directory }).dshPatch, [selected("local", "plain", "manual-effort")]);
  const file = path.join(f.directory, "agent-presets.json"), presets = createAgentPresets({ file, agents });
  const p = presets.add({ agent:"dsh", model:"deepseek-v4-pro", effort:"max" });
  assert.throws(() => presets.add({ agent:"dsh", model:"/pro" }), { code:"BAD_PRESET" });
  assert.throws(() => presets.update(p.id, { effort:"--high" }), { code:"BAD_PRESET" });
  const stored = createAgentPresets({ file, agents });
  const command = agents.command("dsh", { workdir:f.directory, docs:f.directory, resume:"session-fixture", ...stored.handOver(stored.get(p.id)) });
  assert.deepEqual(command.dshPatch, [selected(official, "deepseek-v4-pro", "max")]);
  assert.equal(command.args[command.args.indexOf("--session-id") + 1], "session-fixture");
  assert.equal(command.env.DSH_HOME, f.env.DSH_HOME);
  assert.ok(command.args.includes("--permission-mode"));
  const use = { agent:"dsh", selected:{ model:`${official}/deepseek-v4-pro` }, resolvedModel:command.dshSelection.model };
  assert.equal(priceFor(workModel(use), [{ model:"deepseek-v4-pro", input:1 }]).input, 1);
  assert.equal(workModel({ ...use, picked:{ model:"observed-id" } }), "observed-id");
});

test("older dsh keeps its permissions and default launch; unverified overrides fail explicitly", async t => {
  const old = fixture(t);
  const { agents, env, calls } = launcher(old, "0.2.1-rc.2");
  const options = { workdir:old.directory, docs:old.directory };
  assert.deepEqual(agents.command("dsh", options).args.slice(1), ["--profile", "headless", "--json"]);
  agents.pickModel("dsh", "deepseek-v4-pro", "low");
  const done = await tryOne(agents, "dsh", { env, runtimeDirectory:old.directory });
  assert.equal(done.ok, true, JSON.stringify(done));
  const argv = calls().at(-1), patch = argv[argv.indexOf("--patch") + 1];
  assert.ok(path.isAbsolute(patch));
  assert.equal(path.dirname(path.dirname(patch)), old.directory);
  assert.ok(!fs.existsSync(patch), "Try removes its overlay after the child exits");
  assert.ok(!argv.includes("--permission-mode"));

  const ancient = fixture(t);
  const unknown = launcher(ancient, "0.0.1");
  const place = { workdir:ancient.directory, docs:ancient.directory };
  assert.equal(unknown.agents.command("dsh", place).dshPatch, undefined);
  for (let i = 0; i < 2; i++) {
    assert.throws(() => unknown.agents.command("dsh", { ...place, model:`${official}/manually-typed` }), /could not apply a headless model selection/);
  }
  const probes = unknown.calls().filter(args => args.includes("--dump-config"));
  assert.equal(probes.length, 5, "every unrecognized launch checks the current configuration");
  for (const args of probes.filter(args => args.includes("--patch"))) assert.ok(!fs.existsSync(args[args.indexOf("--patch") + 1]));
  const probed = fixture(t);
  const actual = { ...selected(official, "deepseek-flash"), name:"@deepseek-ai/dsh-agent-default-model" };
  const supported = launcher(probed, "custom version", [actual]);
  assert.deepEqual(supported.agents.command("dsh", { workdir:probed.directory, docs:probed.directory, model:"typed" }).dshPatch, [selected(official, "typed")]);
});

test("dsh verifies a legacy profile with the actual overlay before claiming a selection", t => {
  const f = fixture(t, { shipped:false });
  const legacy = { ...pi({}), name:"@deepseek-ai/dsh-llm-pi-ai" };
  f.profile("headless", [legacy], "cordis.yml");
  f.put("cordis.patch.yml", [selected(official, "ignored-default", "low")]);
  assert.equal(modelOf("dsh", f.env).name, "");
  const { agents, calls } = launcher(f, "0.2.2-rc.1", [legacy]);
  const options = { workdir:f.directory, docs:f.directory, runtimeDirectory:f.directory };
  assert.equal(agents.command("dsh", options).dshSelection, null);
  const model = `${official}/deepseek-v4-pro`;
  assert.equal(dshPlan(f.env, model, "high").verify, true);
  assert.throws(() => agents.command("dsh", { ...options, model, effort:"high" }), /could not apply a headless model selection/);
  const overlayProbe = calls().at(-1);
  assert.equal(overlayProbe.at(-1), "--dump-config");
  assert.ok(overlayProbe.includes("--patch"));
  assert.ok(!fs.existsSync(overlayProbe[overlayProbe.indexOf("--patch") + 1]));

  const active = { ...selected(official, "deepseek-v4-pro", "low"), name:"@deepseek-ai/dsh-agent-default-model" };
  f.profile("headless", [legacy, active], "cordis.yml");
  const supported = launcher(f, "0.2.2-rc.1", [legacy, active]);
  assert.deepEqual(supported.agents.command("dsh", options).dshSelection, { provider:official, model:"deepseek-v4-pro", effort:"low" });
  assert.deepEqual(supported.agents.command("dsh", { ...options, effort:"high" }).dshPatch, [selected(official, "deepseek-v4-pro", "high")]);
  launcher(f, "0.2.2-rc.1", [legacy]);
  assert.throws(() => supported.agents.command("dsh", { ...options, model, effort:"high" }), /could not apply a headless model selection/);
});

test("a custom dsh default checks its own credential reference without exposing the saved value", async t => {
  const f = fixture(t);
  f.profile("headless", [pi({ local:route("local", ["choice"]) }), selected("local", "choice")]);
  const { agents } = launcher(f, "0.2.2");
  const check = createAgentCheck(agents);
  const missing = (await check.check()).agents.find(row => row.id === "dsh");
  assert.equal(missing.state, "problem");
  assert.match(missing.problems[0].detail, /FIXTURE_KEY/);
  f.put(".credentials.yaml", "refs:\n  FIXTURE_KEY: secret-fixture-value\n");
  const found = (await check.check({ fresh:true })).agents.find(row => row.id === "dsh");
  assert.equal(found.state, "ready");
  assert.doesNotMatch(JSON.stringify(found), /secret-fixture-value/);
});

test("changing the dsh model refreshes credentials and forgets a failed Try", async t => {
  const f = fixture(t);
  f.profile("headless", [pi({ keyed:route("keyed", ["one"]), unkeyed:route("unkeyed", ["two"], { apiKeyEnv:"UNKEYED_TOKEN" }) }), selected("keyed", "one")]);
  f.put(".credentials.yaml", "refs:\n  FIXTURE_KEY: fixture-saved-key\n");
  const { agents, calls } = launcher(f, "0.2.1-rc.2");
  const describe = agents.describe;
  agents.describe = () => describe().map(row => row.id === "dsh" ? { ...row, app:{ name:"Fixture app", version:"1.0", ok:false } } : row);
  const check = createAgentCheck(agents, { runtimeDirectory:f.directory, spawnFn() { throw Error("Test run failed on the old model."); } });
  const row = result => result.agents.find(agent => agent.id === "dsh");
  const initial = row(await check.check());
  assert.equal(initial.state, "ready");
  const tips = initial.problems.map(problem => problem.title).sort();
  assert.equal(tips.length, 2);
  assert.equal(row(await check.tryRun("dsh")).tried.ok, false);
  const unkeyed = row(await check.pickModel("dsh", { model:"unkeyed/two" }));
  assert.equal(unkeyed.state, "problem");
  assert.equal(unkeyed.tried, undefined);
  assert.match(unkeyed.problems.find(problem => problem.kind === "fix").detail, /UNKEYED_TOKEN/);
  assert.deepEqual(unkeyed.problems.filter(problem => problem.kind === "tip").map(problem => problem.title).sort(), tips);
  const keyed = row(await check.pickModel("dsh", { model:"keyed/one" }));
  assert.equal(keyed.state, "ready");
  assert.deepEqual(keyed.problems.map(problem => problem.title).sort(), tips);
  assert.equal(calls().filter(args => args.includes("--version")).length, 2, "only Check and the initial Try ask for a version");
});

test("dsh keeper overlays stay private and distinct through detach and reattach", { timeout:10000 }, async t => {
  const f = fixture(t);
  const root = path.join(f.directory, "keepers");
  const keep = createKeeper({ root });
  const dirs = [keep.allocate("first"), keep.allocate("second")];
  const files = dirs.map((dir, i) => stageDshPatch({ args:[], dshPatch:[selected(official, `model-${i}`)] }, dir).at(-1));
  assert.notEqual(files[0], files[1]);
  if (process.platform !== "win32") assert.equal(fs.statSync(files[0]).mode & 0o777, 0o600);
  const reader = "const fs=require('node:fs');let p='';process.stdin.on('data',c=>p+=c);process.stdin.on('end',()=>{if(!p)process.exit(1);console.log(JSON.parse(fs.readFileSync(process.argv[1],'utf8'))[0].config.model)})";
  const child = keep.spawn(process.execPath, ["-e", reader, files[0]], { dir:dirs[0], cwd:f.directory });
  t.after(() => { if (!child.closed) child.kill(); });
  child.detach();
  keep.sweep();
  assert.ok(fs.existsSync(files[0]), "an active keeper still needs its patch after detach");
  const attached = createKeeper({ root }).attach(dirs[0]);
  let output = "";
  attached.stdout.on("data", text => { output += text; });
  const ended = once(attached, "close");
  attached.stdin.end("Start now");
  assert.deepEqual(await ended, [0, null]);
  assert.equal(output.trim(), "model-0");
  assert.equal(fs.existsSync(files[0]), false, "reattached completion removes the overlay without a sweep");
  assert.ok(fs.existsSync(path.join(dirs[0], "exit.json")), "the durable exit stays available");
  keep.sweep();
  assert.equal(fs.existsSync(dirs[0]), false);
  assert.ok(fs.existsSync(files[1]));
});
