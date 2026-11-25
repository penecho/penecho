"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { once } = require("node:events");
const { setTimeout:delay } = require("node:timers/promises");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
const { Service } = require("../src/server/project-lines/service.js");
const { createUsageStats } = require("../src/server/usage-stats.js");
const F = require("../src/server/project-lines/format.js");
const { concreteModel, modelOf, priceModelOf, priceFor } = require("../public/lines/work-pricing.js");
const { computeProjectStats } = require("../public/lines/stats.js");

const configured = "magpie/opencode-go/deepseek-v4.1-flash";
const defaultModel = "deepseek-v4.1-flash";
const legacyModel = "runtime-v1";
const currentModel = "runtime-v2";
const streamedModel = "streamed";

async function until(check) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await delay(20);
  }
  assert.fail("The test Work did not finish.");
}

test("OpenCode Default records the Work's actual model or launch default, using it throughout the record", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pe-oc-"));
  const directory = path.join(root, "state"), data = path.join(root, "data", "opencode");
  const script = path.join(root, "opencode.js"), calls = path.join(root, "calls"), database = path.join(data, "opencode.db");
  const config = path.join(root, "opencode.jsonc");
  fs.mkdirSync(data, { recursive:true });
  fs.writeFileSync(config, `// Local default\n{"model": "${configured}",}\n`);
  const db = new DatabaseSync(database);
  db.exec(`create table session (id text, parent_id text);
    create table message (id text, session_id text, time_created integer, data text);
    create table part (id text, message_id text, session_id text, data text);
    create table session_v2 (id text, parent_id text);
    create table session_message (id text, session_id text, type text, seq integer, time_created integer, data text);`);
  const oldTime = Date.now() - 100000;
  db.prepare("insert into message values (?, ?, ?, ?)").run("m-old", "ses-fallback", oldTime, JSON.stringify({ role:"assistant", modelID:"previous-run", providerID:"other" }));
  db.close();
  fs.writeFileSync(script, `
    const fs = require("node:fs");
    const { DatabaseSync } = require("node:sqlite");
    const args = process.argv.slice(2);
    if (args[0] !== "run") process.exit(1);
    fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
    process.stdin.resume();
    process.stdin.on("end", () => {
      const dir = args[args.indexOf("--dir") + 1];
      const mode = fs.readFileSync(dir + "/mode", "utf8");
      const sessionID = "ses-" + mode;
      const send = (type, part) => console.log(JSON.stringify({ type, sessionID, part }));
      const legacy = (id, model) => db.prepare("insert into message values (?, ?, ?, ?)").run(id, sessionID, Date.now(), JSON.stringify({ role:"assistant", modelID:model, providerID:"magpie" }));
      const db = new DatabaseSync(${JSON.stringify(database)});
      if (mode === "legacy") {
        legacy("m-first", "route/first");
        send("step_finish", { messageID:"m-first", tokens:{ input:100, output:10, cache:{ read:0, write:0 } } });
        legacy("m-last", "route/runtime-v1");
        legacy("m-neighbor", "route/unrelated");
      }
      if (mode === "current") db.prepare("insert into session_message values (?, ?, ?, ?, ?, ?)").run(
        "m-last", sessionID, "assistant", 1, Date.now(), JSON.stringify({ model:{ id:"magpie/route/runtime-v2", providerID:"magpie" } }));
      if (mode === "stop") {
        legacy("m-stop", "route/runtime-v1");
        db.close();
        send("step_start", { messageID:"m-stop" });
        setTimeout(() => {}, 15000);
        return;
      }
      db.close();
      const stream = mode === "current" || mode === "stream" ? { modelID:"route/streamed", providerID:"magpie" } : {};
      const messageID = mode === "fallback" ? "m-old" : "m-last";
      send("step_start", { messageID, ...stream });
      send("text", { messageID, text:"Done." });
      send("step_finish", { messageID, tokens:{ input:10000, output:2000, cache:{ read:0, write:0 } }, ...stream });
    });
  `);
  const env = { HOME:root, PATH:"", OPENCODE_CLI_PATH:script, OPENCODE_CONFIG:config, XDG_DATA_HOME:path.dirname(data) };
  const agents = createAgents({ env });
  agents.pickModel("opencode", "stale/penecho-pick", "low");
  const service = new Service({ directory, agents, keepAgents:false, memory:{ home:root, env }, conversations:{ home:root, env } });
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  service.presets = createAgentPresets({ file:path.join(directory, "presets.json"), agents });
  const preset = service.presets.add({ agent:"opencode", model:"", effort:"max" });
  const orchestrator = service.orchestrator = createOrchestrator({ service, directory });
  const project = service.store.create({ name:"OpenCode models", docsPath:path.join(root, "docs") });
  project.follow = false;
  service.store.save();
  const plan = async () => (await orchestrator.call(project, { do:"plan" })).agents.find(a => a.agent === preset.id);
  const front = ({ line, work }) => F.splitFront(service.store.readText(project, F.detailPath(line, work)).text).front;
  const station = ({ line, work }) => service.stateOf(project).lines.find(l => l.id === line)?.stations.find(s => s.id === work);
  const start = async (mode, id = preset.id) => {
    fs.writeFileSync(path.join(project.docsPath, "mode"), mode);
    return orchestrator.call(project, { do:"create-line", task:`Check ${mode} model`, agent:id, kind:"code", title:`Run ${mode}` });
  };
  const run = async (mode, id) => {
    const made = await start(mode, id);
    await until(() => station(made)?.state === "done" && Boolean(front(made).ended));
    return made;
  };

  orchestrator.setPrice({ model:configured, input:2, output:5 });
  orchestrator.setPrice({ model:`magpie/route/${legacyModel}`, input:5, output:10 });
  assert.equal((await orchestrator.call(project, { do:"agents" })).agents.find(a => a.id === preset.id).model, "", "agent listing exposes preset intent");
  assert.deepEqual(await plan().then(p => [p.model, p.works, p.history, p.price]), [defaultModel, 0, "none", { input:2, output:5 }]);
  const legacy = await run("legacy");
  const current = await run("current");
  const fallback = await run("fallback");
  const noEffort = service.presets.add({ agent:"opencode", model:"", effort:"" });
  const stream = await run("stream", noEffort.id);
  for (const [work, expected, source] of [
    [legacy, legacyModel, "OpenCode assistant message"],
    [current, currentModel, "OpenCode assistant message"],
    [fallback, defaultModel, undefined],
    [stream, streamedModel, "OpenCode output"],
  ]) {
    assert.equal(front(work)["resolved model"], defaultModel);
    assert.equal(front(work)["selected model"], undefined);
    assert.equal(front(work).model, source ? expected : undefined);
    assert.equal(front(work)["runtime source"], source);
    assert.deepEqual(station(work).selected, { model:"", effort:work === stream ? "" : "max" });
    assert.equal(modelOf(station(work)), expected);
    assert.equal(service.lastWorkPreset(project, work.line, "opencode").model, "", "continuing a Default Work still follows the runner");
    await orchestrator.call(project, { do:"rate", line:work.line, work:work.work, score:5 });
    assert.equal(orchestrator.records(project).find(r => r.line === work.line).model, expected);
  }
  const launched = fs.readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(launched.length, 4);
  assert.ok(launched.every(args => !args.includes("--model")));
  assert.ok(launched.slice(0, 3).every(args => args[args.indexOf("--variant") + 1] === "max"));
  assert.ok(!launched[3].includes("--variant"));
  const evidence = service.tokensOfDetail(project, F.detailPath(legacy.line, legacy.work));
  assert.deepEqual(evidence.attempts.at(-1).requests.map(request => request.model), ["first", legacyModel]);
  assert.equal(station(legacy).tokens.lastRequest.model, legacyModel);
  assert.equal(station(legacy).tokens.requests, 2);
  assert.equal(station(legacy).tokens.inputTokens, 10100);
  assert.equal(station(fallback).tokens.lastRequest.model, "", "configured fallback is never attached to measured requests");
  assert.deepEqual(orchestrator.stats(project).rows.map(r => r.model).sort(), [defaultModel, legacyModel, currentModel, streamedModel].sort());
  assert.equal(orchestrator.agentRecord(project).agents.find(r => r.model === defaultModel).score, 5);
  assert.equal(orchestrator.agentRecord(project).agents.find(r => r.model === defaultModel).costPerWork, 0.03);
  assert.equal(computeProjectStats(service.stateOf(project), { prices:orchestrator.prices() }).works.find(r => r.lineId === fallback.line).model, defaultModel);
  assert.ok(orchestrator.index().tables.all.collecting.some(r => r.model === defaultModel));
  assert.deepEqual(await plan().then(p => [p.model, p.works, p.history]), [defaultModel, 1, "same agent, model and effort"]);
  fs.writeFileSync(config, '{"model":"other/opencode-go/deepseek-v4.1-flash"}');
  assert.deepEqual(await plan().then(p => [p.model, p.works, p.history]), [defaultModel, 1, "same agent, model and effort"]);
  fs.writeFileSync(config, '{"model":"other/opencode-go/deepseek-v5"}');
  assert.deepEqual(await plan().then(p => [p.model, p.works, p.history]), ["deepseek-v5", 0, "none"]);
  assert.equal(modelOf(station(fallback)), defaultModel, "configuration changes never rewrite past Works");

  const reports = [];
  let clock = Date.now();
  const usage = createUsageStats({
    stateDirectory:path.join(root, "usage"), now:() => clock,
    agentRows:window => orchestrator.agentDays(project, window),
    fetchImpl:async (_url, init) => { reports.push(JSON.parse(init.body)); return { status:204, ok:true }; },
  });
  t.after(() => usage.close());
  usage.setPreferences({ enabled:false });
  clock += 5 * 86400000;
  const models = rows => rows.map(r => [r.model, r.effort, r.scoreSum]).sort();
  const expected = [defaultModel, legacyModel, currentModel].map(id => [id, "max", 5]).sort();
  assert.deepEqual(models(usage.report().agents), expected);
  assert.equal(await usage.send(), true);
  assert.deepEqual(models(reports[0].agents), expected);

  fs.writeFileSync(config, JSON.stringify({ model:configured }));
  const historical = await run("fallback");
  const historyDetail = F.detailPath(historical.line, historical.work);
  service.store.writeText(project, historyDetail, F.setFront(service.store.readText(project, historyDetail).text, { "resolved model":configured }));
  service.sync(project);
  orchestrator.setPrice({ model:defaultModel, input:1, output:2 });
  const stats = computeProjectStats(service.stateOf(project), { prices:orchestrator.prices() });
  assert.equal(stats.agentModels.find(r => r.model === defaultModel).works, 2);
  assert.equal(stats.works.find(r => r.lineId === historical.line).estimatedCost, 0.03, "historical full ID keeps its exact price");
  assert.equal(stats.works.find(r => r.lineId === fallback.line).estimatedCost, 0.014, "new bare ID uses its exact price");
  assert.equal(orchestrator.stats(project).rows.find(r => r.model === defaultModel).works, 2);
  assert.equal(orchestrator.agentRecord(project).agents.find(r => r.model === defaultModel).costPerWork, 0.022);
  assert.equal(orchestrator.agentDays(project, { from:"2020-01-01", to:"2099-12-31" }).find(r => r.model === defaultModel).works, 2);

  const stopped = await start("stop");
  const running = () => service.runs.get(service.key(project, stopped.line));
  await until(() => running()?.openCodeMessageId === "m-stop");
  const closed = once(running().child, "close");
  await orchestrator.call(project, { do:"stop", line:stopped.line });
  await closed;
  assert.equal(station(stopped).state, "off");
  assert.equal(modelOf(station(stopped)), legacyModel, "Stop keeps the model reported by the current assistant message");

  const explicit = service.presets.add({ agent:"opencode", model:configured, effort:"max" });
  const explicitRun = await run("current", explicit.id);
  assert.equal(front(explicitRun)["selected model"], configured);
  assert.equal(front(explicitRun).model, currentModel);
  assert.equal(service.presets.get(explicit.id).model, configured);
  assert.equal(orchestrator.records(project).find(r => r.line === explicitRun.line).selectedModel, configured);
  const inherited = service.lastWorkPreset(project, explicitRun.line, "opencode");
  const cliModel = args => args[args.indexOf("--model") + 1];
  const lastCall = () => fs.readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse).at(-1);
  assert.equal(cliModel(lastCall()), configured);
  assert.equal(cliModel(agents.command("opencode", { workdir:root, ...service.presets.handOver(inherited) }).args), configured);

  const stoppedExplicit = await start("stop", explicit.id);
  const explicitRunning = () => service.runs.get(service.key(project, stoppedExplicit.line));
  await until(() => explicitRunning()?.openCodeMessageId === "m-stop");
  const explicitClosed = once(explicitRunning().child, "close");
  await orchestrator.call(project, { do:"stop", line:stoppedExplicit.line });
  await explicitClosed;
  service.presets.remove(explicit.id);
  fs.writeFileSync(path.join(project.docsPath, "mode"), "current");
  const retried = await orchestrator.call(project, { do:"retry", line:stoppedExplicit.line });
  await until(() => station(retried)?.state === "done");
  assert.equal(cliModel(lastCall()), configured, "retry takes the qualified selection from the stopped Work");
  assert.equal(front(retried)["selected model"], configured);
});

test("model identity and prices accept historical routes without changing custom model IDs", () => {
  const uuid = "3ea3e82e-095e-4aa1-9c93-9eed1b963810";
  for (const invalid of [null, [], "", "   ", "default", "gateway/ DeFaUlT ", "gateway/", "one\ntwo"]) {
    assert.equal(concreteModel(invalid), "");
    assert.equal(priceFor(invalid, [{ model:invalid }]), undefined);
  }
  assert.equal(concreteModel(uuid), uuid);
  assert.equal(concreteModel(`external/${uuid}`), uuid);
  assert.equal(concreteModel("us.anthropic.Custom.V1:0"), "us.anthropic.Custom.V1:0");
  assert.equal(modelOf({ picked:{ model:"router/default" }, tokens:{ requestModel:"", lastRequest:{ model:"router/Actual" } } }), "Actual");
  const gateway = { model:"magpie/moonshot-cn/kimi-k3.1-pro", input:1 };
  const bare = { model:"kimi-k3.1-pro", input:2 };
  assert.equal(priceFor("KIMI-K3.1-PRO", [gateway, bare]), bare);
  assert.equal(priceFor(gateway.model, [bare, gateway]), gateway);
  assert.equal(priceFor("other/moonshot-cn/kimi-k3.1-pro", [gateway]), gateway);
  assert.equal(priceModelOf({ picked:{ model:"kimi-k3.1-pro" }, selected:{ model:gateway.model } }), gateway.model);
  assert.equal(priceModelOf({ picked:{ model:"different-model" }, selected:{ model:gateway.model } }), "different-model");
});

test("Pi, omp and Kimi launch with qualified presets and record bare usage models", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pe-shared-model-"));
  const script = path.join(root, "runner.js"), calls = path.join(root, "calls");
  fs.writeFileSync(script, `
    const fs = require("node:fs");
    const args = process.argv.slice(2);
    if (args.includes("--version")) { console.log("1.0.0"); process.exit(0); }
    const model = args[args.indexOf("--model") + 1];
    fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
    const send = row => console.log(JSON.stringify(row));
    if (args.includes("--prompt")) {
      send({ role:"assistant", content:"Done." });
      send({ type:"usage.record", model, usage:{ inputOther:40, output:10, inputCacheRead:0 } });
    } else {
      // Pi and omp run in RPC mode: the prompt comes as one line, and stdin stays open until the agent says it ended.
      require("node:readline").createInterface({ input:process.stdin }).on("line", line => {
        if (JSON.parse(line).type !== "prompt") return;
        send({ type:"agent_start" });
        send({ type:"message_end", message:{ id:"a", role:"assistant",
          provider:"magpie", model:model.slice("magpie/".length), content:[{ type:"text", text:"Done." }],
          usage:{ input:40, output:10, cacheRead:0, cacheWrite:0 } } });
        send({ type:"agent_end", messages:[] });
      });
    }
  `);
  const env = { HOME:root, PATH:"", PI_CLI_PATH:script, OMP_CLI_PATH:script, KIMI_CLI_PATH:script };
  const agents = createAgents({ env, appFolders:[] });
  const directory = path.join(root, "state");
  const service = new Service({ directory, agents, keepAgents:false, memory:{ home:root, env }, conversations:{ home:root, env } });
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  const presetFile = path.join(directory, "presets.json");
  service.presets = createAgentPresets({ file:presetFile, agents });
  const orchestrator = service.orchestrator = createOrchestrator({ service, directory });
  const project = service.store.create({ name:"Shared models", docsPath:path.join(root, "docs") });
  project.follow = false;
  service.store.save();
  for (const [agent, selected, expected] of [
    ["pi", configured, defaultModel],
    ["omp", configured, defaultModel],
    ["kimi", "magpie/moonshot-cn/kimi-k3.1-pro", "kimi-k3.1-pro"],
  ]) {
    const preset = service.presets.add({ agent, model:selected, effort:"high" });
    const made = await orchestrator.call(project, { do:"create-line", task:"Check the model", agent:preset.id, kind:"code", title:`Run ${agent}` });
    const detail = F.detailPath(made.line, made.work);
    const front = () => F.splitFront(service.store.readText(project, detail).text).front;
    await until(() => Boolean(front().ended));
    const args = fs.readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse).at(-1);
    assert.equal(args[args.indexOf("--model") + 1], selected);
    assert.equal(JSON.parse(fs.readFileSync(presetFile, "utf8")).presets.find(p => p.id === preset.id).model, selected);
    assert.equal(front()["selected model"], selected);
    assert.equal(front().model, expected);
    assert.equal(service.tokensOfDetail(project, detail).attempts[0].requests[0].model, expected);
    assert.equal(service.lastWorkPreset(project, made.line, agent).model, selected);
    assert.deepEqual(orchestrator.records(project).filter(r => r.line === made.line).map(r => [r.model, r.selectedModel]), [[expected, selected]]);
  }
});
