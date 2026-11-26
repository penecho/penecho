"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
const { createUsageStats } = require("../src/server/usage-stats.js");
const F = require("../src/server/project-lines/format.js");

test("agentDays sums Works per day, agent, model, effort and kind, with scores, good/bad and follow-ups, and no Line text", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-agent-days-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const started = Date.UTC(2026, 10, 10, 9);
  const station = (id, extra) => ({ id, label:id, kind:"work", agent:"claude", picked:{ model:"claude-opus-5-5", effort:"medium" }, startedAt:started, took:"6 min", ...extra });
  const lines = [{ id:"private-line-title", title:"Private line title", stations:[
    { id:"ask-1", kind:"ask" }, station("work-1", { state:"done", rating:"good", tokens:{ inputTokens:100, outputTokens:50 } }),
    { id:"ask-2", kind:"ask" }, station("work-2", { state:"off" }), station("work-3", { state:"error", agent:"Bad Runner!" }),
    station("work-4", { state:"done", startedAt:Date.UTC(2026, 9, 1) }),
  ] }];
  const service = { stateOf:() => ({ lines }), store:{ projects:[] }, presets:null };
  const orchestrator = createOrchestrator({ service, directory });
  const rows = orchestrator.agentDays({ id:"p", docsPath:directory }, { from:"2026-11-01", to:"2026-11-15" });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.deepEqual({ ...row, costUsd:0 }, { day:"2026-11-10", runner:"claude", model:"claude-opus-5-5", effort:"medium", kind:"", scope:"standard", works:2, finished:1, failed:0, stopped:1, followups:1, scoreSum:0, scoreCount:0, passCount:0, passSum:0, negWeight:0, negWeightedSum:0, good:1, bad:0, minutes:6, tokens:150, costUsd:0, tokensIn:100, tokensOut:50, tokensCached:0 });
  assert.doesNotMatch(JSON.stringify(rows), /private|Private/);
});

test("local Statistics keeps default-effort Works and third-party UUID models", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-agent-days-cloud-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const started = Date.now();
  const day = new Date(started).toISOString().slice(0, 10);
  const bareUuid = "3ea3e82e-095e-4aa1-9c93-9eed1b963810";
  const routedUuid = "d460c354-bffd-44e3-82bf-ca5c1d7e4691";
  const station = (id, extra) => ({ id, label:id, kind:"work", agent:"codex", picked:{ model:"gpt-6.2-astra", effort:"medium" }, startedAt:started, took:"4 min", state:"done", ...extra });
  const lines = [{ id:"mix", title:"Mixed", stations:[
    { id:"ask-1", kind:"ask" },
    station("work-1", { rating:"good" }),
    station("work-2", { agent:"penecho", picked:{ model:bareUuid, effort:"max" }, rating:"good" }),
    station("work-3", { agent:"penecho", picked:{ model:"deepseek-4.1-flash", effort:"max" }, rating:"bad" }),
    station("work-4", { agent:"codex", picked:{ model:bareUuid, effort:"high" }, rating:"good" }),
    station("work-5", { agent:"claude", picked:{ model:`external/${routedUuid}`, effort:"medium" }, rating:"bad" }),
    station("work-6", { picked:{ model:"gpt-6.2-astra" }, rating:"good" }),
  ] }];
  const project = { id:"p", docsPath:directory };
  const service = { stateOf:() => ({ lines }), store:{ projects:[project] }, presets:null };
  const orchestrator = createOrchestrator({ service, directory });
  const rows = orchestrator.agentDays(project, { from:day, to:day });
  assert.equal(rows.length, 4);
  assert.equal(rows.some(r => r.runner === "penecho"), false, "penecho runner rows never enter agentDays");
  const byKey = new Map(rows.map(r => [`${r.runner}:${r.model}:${r.effort}`, r]));
  assert.equal(byKey.get("codex:gpt-6.2-astra:medium")?.works, 1);
  assert.equal(byKey.get("codex:gpt-6.2-astra:")?.good, 1);
  assert.equal(byKey.get(`codex:${bareUuid}:high`)?.good, 1);
  assert.equal(byKey.get(`claude:${routedUuid}:medium`)?.bad, 1);

  const defaultWork = r => r.model === "gpt-6.2-astra" && r.effort === "";
  const localIndex = orchestrator.index();
  assert.equal(localIndex.works, 4);
  assert.equal(localIndex.tables.all.collecting.find(defaultWork)?.works, 1);
  const projectStats = orchestrator.stats(project);
  assert.ok(projectStats.rows.some(r => r.runner === "penecho"), "project-level stats still keep local PenEcho Agent Works");
  assert.equal(projectStats.rows.find(defaultWork)?.good, 1);
  assert.equal(orchestrator.agentRecord(project).agents.find(defaultWork)?.good, 1);
});

async function until(check, label, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("retrying a stopped high-effort Work after clearing the preset effort reports only the stopped first Work under high with an empty score", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-retry-default-effort-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const script = path.join(root, "fake-agent.js");
  fs.writeFileSync(script, `
    let input = "";
    process.stdin.on("data", d => { input += d; });
    process.stdin.on("end", () => {
      if (input.includes("mode:slow-stop")) { setTimeout(() => process.exit(0), 30000); return; }
      console.log(JSON.stringify({ type:"result", is_error:false, result:"Retry done." }));
      process.exit(0);
    });
  `);
  const launched = [];
  const agents = createAgents({
    env:{ PATH:"" },
    extra:{
      fake:{
        name:"Fake", mono:"Fa", color:"#2563eb", role:"Build",
        resolve:() => ({ command:process.execPath, prefixArgs:[script] }),
        command:(launch, opts) => {
          launched.push({ model:opts.model || "", effort:opts.effort || "" });
          return { command:launch.command, args:launch.prefixArgs, cwd:opts.workdir, stdin:true };
        },
      },
    },
  });
  const directory = path.join(root, "state"), docs = path.join(root, "docs");
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents, autoWatch:false });
  service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents });
  const preset = service.presets.add({ name:"Fake high", agent:"fake", model:"gpt-6.2-sol", effort:"high" });
  const orchestrator = createOrchestrator({ service, directory });
  t.after(() => service.close());
  const project = service.store.create({ name:"Retry effort", docsPath:docs });
  project.follow = false; service.store.save();

  const created = await orchestrator.call(project, { do:"create-line", task:"mode:slow-stop Build feature", agent:preset.id, kind:"code", title:"Retry Default Effort" });
  await until(() => service.runs.has(service.key(project, created.line)), "work-1 started");
  await orchestrator.call(project, { do:"stop", line:created.line });

  // Clear effort to Default, remove slow marker, retry through Orchestrator, and rate the replacement 5/5.
  service.presets.update(preset.id, { effort:"" });
  service.writeDoc(project, created.line, service.readDoc(project, created.line).replace("mode:slow-stop ", ""));
  const retried = await orchestrator.call(project, { do:"retry", line:created.line });
  assert.equal(retried.work, "work-2");
  await until(() => F.parseLine(service.readDoc(project, created.line)).status === "done", "work-2 finished");
  await orchestrator.call(project, { do:"rate", line:created.line, work:retried.work, score:5, note:"Complete" });

  assert.deepEqual(launched, [
    { model:"gpt-6.2-sol", effort:"high" },
    { model:"gpt-6.2-sol", effort:"" },
  ], "replacement Work launches with empty Default effort");
  const work2Station = service.stateOf(project).lines.find(l => l.id === created.line).stations.find(s => s.id === "work-2");
  assert.deepEqual(work2Station.selected, { model:"gpt-6.2-sol", effort:"" });
  const work2Record = orchestrator.records(project).find(r => r.line === created.line && r.work === "work-2");
  assert.equal(work2Record.effort, "", "retry assignment record does not inherit high effort");

  const day = new Date().toISOString().slice(0, 10);
  const daysRows = orchestrator.agentDays(project, { from:day, to:day });
  const highRow = daysRows.find(r => r.effort === "high");
  const defaultRow = daysRows.find(r => r.effort === "");
  assert.equal(highRow?.works, 1);
  assert.equal(highRow?.stopped, 1);
  assert.equal(highRow?.finished, 0);
  assert.equal(highRow?.scoreCount, 0);
  assert.equal(highRow?.scoreSum, 0);
  assert.equal(defaultRow?.works, 1);
  assert.equal(defaultRow?.finished, 1);
  assert.equal(defaultRow?.scoreCount, 1);
  assert.equal(defaultRow?.scoreSum, 5);

  // Wire into UsageStats 5 days later so the day is due in preview, scheduled send() and 7-day sendRecent().
  const DAY = 86_400_000, usageDir = path.join(root, "usage");
  let clock = Date.parse(`${day}T09:00:00.000Z`);
  const sent = [];
  const usageStats = createUsageStats({
    stateDirectory:usageDir, now:() => clock, origin:() => "https://penecho.example",
    agentRows:window => orchestrator.agentDays(project, window),
    fetchImpl:async (_url, init) => { sent.push(JSON.parse(init.body)); return { status:204, ok:true }; },
  });
  t.after(() => usageStats.close());
  usageStats.setPreferences({ enabled:false });
  clock += 5 * DAY;

  const checkOnlyStoppedHigh = rows => {
    assert.equal(rows.length, 1);
    assert.equal(rows[0].effort, "high");
    assert.equal(rows[0].works, 1);
    assert.equal(rows[0].stopped, 1);
    assert.equal(rows[0].finished, 0);
    assert.equal(rows[0].scoreCount, 0);
    assert.equal(rows[0].scoreSum, 0);
  };
  checkOnlyStoppedHigh(usageStats.report().agents);
  assert.equal(await usageStats.send(), true);
  checkOnlyStoppedHigh(sent[0].agents);
  const recent = await usageStats.sendRecent(7);
  assert.equal(recent.sent, true);
  checkOnlyStoppedHigh(sent[1].agents);

  // Also verify clearing BOTH model and effort on retry does not inherit the previous effort.
  const bothPreset = service.presets.add({ name:"Fake high 2", agent:"fake", model:"gpt-6.2-sol", effort:"high" });
  const bothLine = await orchestrator.call(project, { do:"create-line", task:"mode:slow-stop Clear both", agent:bothPreset.id, kind:"code", title:"Clear Both" });
  await until(() => service.runs.has(service.key(project, bothLine.line)), "clear-both work-1 started");
  await orchestrator.call(project, { do:"stop", line:bothLine.line });
  service.presets.update(bothPreset.id, { model:"", effort:"" });
  service.writeDoc(project, bothLine.line, service.readDoc(project, bothLine.line).replace("mode:slow-stop ", ""));
  const bothRetried = await orchestrator.call(project, { do:"retry", line:bothLine.line });
  await until(() => F.parseLine(service.readDoc(project, bothLine.line)).status === "done", "clear-both work-2 finished");
  const bothRecord = orchestrator.records(project).find(r => r.line === bothLine.line && r.work === bothRetried.work);
  assert.equal(bothRecord.effort, "", "clearing both model and effort keeps replacement assignment on Default");
  assert.equal(bothRecord.model, "", "clearing both model and effort does not copy previous model");
});

test("historical assignments respect a station's recorded Default selection instead of inheriting stale effort", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-historical-selected-default-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const started = Date.UTC(2026, 10, 10, 9), day = "2026-11-10";
  const lines = [{
    id:"legacy-retry", title:"Legacy retry",
    stations:[
      { id:"work-1", label:"Work 1", kind:"work", agent:"codex", state:"off", startedAt:started, selected:{ model:"gpt-6.2-sol", effort:"high" }, picked:{ model:"gpt-6.2-sol", effort:"high" } },
      { id:"work-2", label:"Work 2", kind:"work", agent:"codex", state:"done", startedAt:started + 60000, took:"3 min", selected:{ model:"gpt-6.2-sol", effort:"" }, picked:{ model:"gpt-6.2-sol" } },
    ],
  }];
  const project = { id:"p", docsPath:directory };
  // Seed a historical poisoned records.json where work-2 wrongly inherited effort: "high" and received 5/5.
  fs.mkdirSync(path.join(directory, "orchestrator"), { recursive:true });
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({
    records:[
      { id:"r1", project:"p", line:"legacy-retry", work:"work-1", kind:"code", agent:"codex", model:"gpt-6.2-sol", effort:"high" },
      { id:"r2", project:"p", line:"legacy-retry", work:"work-2", kind:"code", agent:"codex", model:"gpt-6.2-sol", effort:"high", score:5, scoredAt:"2026-11-10T09:05:00.000Z" },
    ],
  }));
  const service = { stateOf:() => ({ lines }), store:{ projects:[project] }, presets:null };
  const orchestrator = createOrchestrator({ service, directory });
  const rows = orchestrator.agentDays(project, { from:day, to:day });
  const high = rows.find(r => r.effort === "high");
  const def = rows.find(r => r.effort === "");
  assert.equal(high?.works, 1);
  assert.equal(high?.stopped, 1);
  assert.equal(high?.scoreCount, 0);
  assert.equal(high?.scoreSum, 0);
  assert.equal(def?.works, 1);
  assert.equal(def?.finished, 1);
  assert.equal(def?.scoreCount, 1);
  assert.equal(def?.scoreSum, 5);
});

test("explicit OpenCode variants such as high-v2 stay distinct from Default and survive preview, scheduled POST and 7-day resend", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-opencode-variant-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const binDir = path.join(root, "bin"), fakeOpencode = path.join(binDir, "opencode");
  fs.mkdirSync(binDir, { recursive:true });
  fs.writeFileSync(fakeOpencode, "#!/bin/sh\nexit 0\n", { mode:0o755 });
  const agents = createAgents({ env:{ PATH:binDir, OPENCODE_CLI_PATH:fakeOpencode } });
  const presets = createAgentPresets({ file:path.join(root, "presets.json"), agents });
  const variantPreset = presets.add({ agent:"opencode", model:"openai/gpt-6.2-sol", effort:"high-v2" });
  const cmd = agents.command("opencode", { workdir:root, ...presets.handOver(presets.get(variantPreset.id)) });
  const variantFlagIndex = cmd.args.indexOf("--variant");
  assert.notEqual(variantFlagIndex, -1);
  assert.equal(cmd.args[variantFlagIndex + 1], "high-v2");

  const day = "2026-11-10", started = Date.parse(`${day}T09:00:00.000Z`);
  const station = (id, effort, extra = {}) => ({
    id, label:id, kind:"work", agent:"opencode", state:"done", startedAt:started, took:"4 min",
    selected:{ model:"openai/gpt-6.2-sol", effort }, picked:{ model:"openai/gpt-6.2-sol", ...(effort ? { effort } : {}) },
    ...extra,
  });
  const lines = [{
    id:"opencode-variants", title:"OpenCode variants",
    stations:[
      station("work-1", "high-v2", { rating:"good" }),
      station("work-2", "", { rating:"bad" }),
      station("work-3", "high", { rating:"good" }),
    ],
  }];
  const project = { id:"p", docsPath:root };
  const service = { stateOf:() => ({ lines }), store:{ projects:[project] }, presets };
  const orchestrator = createOrchestrator({ service, directory:root });
  const rows = orchestrator.agentDays(project, { from:day, to:day });
  assert.equal(rows.length, 3, "high-v2, Default and high remain three separate daily rows");
  assert.deepEqual(rows.map(r => r.effort).sort(), ["", "high", "high-v2"]);
  assert.equal(rows.find(r => r.effort === "high-v2").good, 1);
  assert.equal(rows.find(r => r.effort === "").bad, 1);
  assert.equal(rows.find(r => r.effort === "high").good, 1);

  const localIndex = orchestrator.index();
  assert.deepEqual(localIndex.tables.all.collecting.map(r => r.effort).sort(), ["", "high", "high-v2"]);

  const DAY = 86_400_000, sent = [];
  let clock = Date.parse(`${day}T09:00:00.000Z`);
  const usageStats = createUsageStats({
    stateDirectory:path.join(root, "usage"), now:() => clock, origin:() => "https://penecho.example",
    agentRows:window => orchestrator.agentDays(project, window),
    fetchImpl:async (_url, init) => { sent.push(JSON.parse(init.body)); return { status:204, ok:true }; },
  });
  t.after(() => usageStats.close());
  usageStats.setPreferences({ enabled:false });
  clock += 5 * DAY;

  const checkExplicitVariants = uploaded => {
    assert.deepEqual(uploaded.map(r => r.effort).sort(), ["high", "high-v2"]);
    assert.equal(uploaded.every(r => r.works === 1 && r.good === 1), true);
  };
  checkExplicitVariants(usageStats.report().agents);
  checkExplicitVariants(usageStats.status().report.agents);
  assert.equal(await usageStats.send(), true);
  checkExplicitVariants(sent[0].agents);
  const recent = await usageStats.sendRecent(7);
  assert.equal(recent.sent, true);
  assert.equal(recent.rows, 2);
  checkExplicitVariants(sent[1].agents);
});
