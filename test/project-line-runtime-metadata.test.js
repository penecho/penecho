"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { test } = require("node:test");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgentPresets } = require("../src/server/project-lines/agent-presets.js");
const F = require("../src/server/project-lines/format.js");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  const started = Date.now();
  while (!fn()) { if (Date.now() - started > 7000) throw Error("Timed out waiting for runtime metadata"); await wait(20); }
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-runtime-metadata-")), script = path.join(dir, "codex.cjs"), planFile = path.join(dir, "plan.json"), history = path.join(dir, "history.jsonl"), calls = path.join(dir, "calls.jsonl");
  // A protocol peer writes its own rollout, as Codex does. Tests never prepopulate model/effort in the Work file.
  fs.writeFileSync(script, `
const fs = require('node:fs'), readline = require('node:readline');
const plan = JSON.parse(fs.readFileSync(${JSON.stringify(planFile)}, 'utf8'));
const history = ${JSON.stringify(history)};
const say = value => process.stdout.write(JSON.stringify(value) + '\\n');
const context = (turn_id, model, effort) => JSON.stringify({ type:'turn_context', payload:{ turn_id, model, effort } });
readline.createInterface({ input:process.stdin }).on('line', line => {
  const m = JSON.parse(line); fs.appendFileSync(${JSON.stringify(calls)}, line + '\\n');
  if (m.method === 'initialize') say({ id:m.id, result:{} });
  if (m.method === 'thread/start' || m.method === 'thread/resume') say({ id:m.id, result:{ thread:{ id:'shared-thread', path:history }, model:'selected-alias', reasoningEffort:'xhigh' } });
  if (m.method === 'turn/start') {
    say({ id:m.id, result:{ turn:{ id:plan.turn, status:'inProgress' } } });
    say({ method:'thread/started', params:{ thread:{ id:'helper-thread', model:'helper-model', reasoningEffort:'low' } } });
    if (plan.corrupt) fs.writeFileSync(history + '.zst', 'broken zstd');
    const writeContext = () => {
      fs.appendFileSync(history, '\\nbroken json\\n' + context(plan.turn, plan.model, plan.effort) + '\\n' + context('helper-turn', 'wrong-model', 'low') + '\\n');
    };
    const complete = () => {
      say({ method:'item/completed', params:{ threadId:'shared-thread', item:{ type:'agentMessage', text:'Finished.', id:'answer' } } });
      say({ method:'turn/completed', params:{ threadId:'shared-thread', turn:{ id:plan.turn, status:'completed' } } });
    };
    if (plan.release) {
      // The test must observe the selected alias before this turn reports actual runtime metadata.
      const timer = setInterval(() => {
        if (!fs.existsSync(plan.release)) return;
        clearInterval(timer);
        writeContext();
        complete();
      }, 10);
      timer.unref();
    } else {
      if (!plan.missing && !plan.corrupt) setTimeout(writeContext, plan.delay || 0);
      setTimeout(complete, plan.finish || 80);
    }
  }
});
`);
  const agents = {
    available:() => [{ id:"codex", name:"Codex", available:true }], nameOf:() => "Codex", desktop:() => null, terminal:() => "",
    configuredEffort:() => "xhigh",
    command:(_id, { workdir, model, effort }) => ({ command:process.execPath, args:[script], cwd:workdir, protocol:"app-server", ownInstructions:true, thread:{ cwd:workdir, ...(model ? { model } : {}) }, turn:effort ? { effort } : {} }),
  };
  const service = new Service({ directory:path.join(dir, "state"), agents, autoWatch:false, memory:{ home:dir, env:{} }, conversations:{ home:dir, env:{}, codex:{} } });
  const project = service.store.create({ name:"Runtime", docsPath:path.join(dir, "docs") }); project.defaultAgent = "codex";
  service.presets = createAgentPresets({ file:path.join(dir, "presets.json"), agents });
  t.after(() => { service.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  const plan = value => fs.writeFileSync(planFile, JSON.stringify(value));
  const front = (slug, n = 1) => { try { return F.parseLine(service.store.readText(project, `topics/${slug}/work-${n}.md`).text).front; } catch { return {}; } };
  const finished = slug => !service.runs.size && F.parseLine(service.readDoc(project, slug)).steps.filter(F.AGENT_LIKE).every(s => s.done);
  return { dir, service, project, history, calls, plan, front, finished };
}

test("default Codex records delayed actual settings and a new task keeps its own turn", async t => {
  const { dir, service, project, plan, front, finished, calls } = fixture(t);
  plan({ turn:"turn-a", model:"custom/openai/gpt-6.1-sol", effort:"max", delay:1100, finish:2600 });
  const { slug } = await service.createTopic(project, { text:"First turn.", kinds:["ask", "work"] });
  await until(() => front(slug)["codex turn"] === "turn-a");
  assert.equal(front(slug).model, undefined, "thread defaults and preset values are not runtime model IDs");
  assert.equal(front(slug).effort, "xhigh", "record the configured default until the turn reports its effort");
  await until(() => front(slug).effort === "max");
  assert.equal(service.runs.size, 1, "the bounded retry captures settings while the turn is still running");
  assert.equal(front(slug).model, "gpt-6.1-sol");
  assert.equal(front(slug)["runtime source"], "codex turn_context");
  await until(() => finished(slug));

  const nextPreset = service.presets.add({ agent:"codex", model:"alias-b", effort:"high", default:true });
  service.pickPreset(project, slug, nextPreset.id); // Explicit change; otherwise the last Work's settings are inherited.
  const release = path.join(dir, "release-turn-b");
  plan({ turn:"turn-b", model:"gpt-6.1-terra", effort:"high", release });
  await service.act(project, slug, "feedback", { text:"Second turn." });
  await until(() => front(slug, 2)["codex turn"] === "turn-b");
  assert.equal(front(slug, 2).model, undefined, "the selected alias is not published as a runtime ID");
  fs.writeFileSync(release, "");
  await until(() => finished(slug) && front(slug, 2).effort === "high");
  assert.equal(front(slug, 2)["runtime source"], "codex turn_context", "completion captures a context that arrived after the first read");
  assert.equal(front(slug, 2).model, "gpt-6.1-terra", "actual detailed ID replaces the selected alias");
  assert.equal(front(slug, 2)["codex thread"], "shared-thread");
  assert.equal(front(slug, 2)["codex turn"], "turn-b");
  assert.match(front(slug, 2)["saved agent"], /alias-b/);
  assert.deepEqual([front(slug).model, front(slug).effort, front(slug)["codex turn"]], ["gpt-6.1-sol", "max", "turn-a"]);
  const requests = fs.readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(requests.filter(r => r.method === "thread/start").length, 2, "completed work defaults to a new task and physical thread");
  assert.ok(!requests.some(r => r.method === "thread/resume"));
  assert.deepEqual(requests.filter(r => r.method === "turn/start").map(r => r.params.effort), [undefined, "high"], "recording does not change the agent's execution settings");
  const line = service.stateOf(project).lines.find(l => l.slug === slug);
  assert.deepEqual(line.stations.filter(s => s.kind === "work").map(s => s.picked), [{ model:"gpt-6.1-sol", effort:"max" }, { model:"gpt-6.1-terra", effort:"high" }]);
});

for (const corrupt of [false, true]) test(`Codex preserves the selected effort with ${corrupt ? "corrupt" : "missing"} runtime history`, async t => {
  const { service, project, plan, front, finished } = fixture(t);
  service.presets.add({ agent:"codex", model:"selected-alias", effort:"high", default:true });
  plan({ turn:"turn-missing", missing:!corrupt, corrupt, finish:30 });
  const { slug } = await service.createTopic(project, { text:"Finish even without metadata.", kinds:["ask", "work"] });
  await until(() => finished(slug));
  assert.equal(front(slug).model, undefined);
  assert.equal(front(slug)["selected effort"], "high");
  assert.equal(front(slug).effort, "high", "the selection wins over the configured default");
  assert.match(front(slug)["saved agent"], /selected-alias/);
  assert.doesNotMatch(service.readDoc(project, slug), /status: stopped/);
});

test("a Codex turn that reports only its model keeps the configured effort in Work Details", async t => {
  const { service, project, plan, front, finished, calls } = fixture(t);
  plan({ turn:"turn-model-only", model:"gpt-6.2-sol" });
  const { slug } = await service.createTopic(project, { text:"Use Codex defaults.", kinds:["ask", "work"] });
  await until(() => finished(slug));
  assert.equal(front(slug)["selected effort"], undefined, "the configured default is not an explicit selection");
  assert.equal(front(slug).effort, "xhigh");
  const turn = fs.readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse).find(request => request.method === "turn/start");
  assert.equal(turn.params.effort, undefined, "recording the default does not send an override");
  const line = service.stateOf(project).lines.find(entry => entry.slug === slug);
  assert.deepEqual(line.stations.find(station => station.kind === "work").picked, { model:"gpt-6.2-sol", effort:"xhigh" });
});

test("Codex does not infer an effort when neither the launch nor the matching turn provides one", async t => {
  const { service, project, plan, front, finished } = fixture(t);
  service.agents.configuredEffort = () => "";
  plan({ turn:"turn-unknown-effort", model:"gpt-6.2-sol" });
  const { slug } = await service.createTopic(project, { text:"No known effort.", kinds:["ask", "work"] });
  await until(() => finished(slug));
  assert.equal(front(slug).model, "gpt-6.2-sol");
  assert.equal(front(slug).effort, undefined);
});

test("a stale capture cannot overwrite a replacement run in the same Work file", async t => {
  const { service, project, history, front } = fixture(t), slug = "retry";
  service.writeDoc(project, slug, F.initialLine({ title:"Retry", steps:[F.workStep({ who:"codex" })] }));
  const step = F.parseLine(service.readDoc(project, slug)).steps[0];
  service.startDetail(project, slug, step, "codex", { title:"Retry", steps:[] });
  const detail = F.detailPath(slug, step.id), md = service.store.readText(project, detail).text;
  service.store.writeText(project, detail, F.setFront(md, { "codex thread":"new-thread", "codex turn":"new-turn", model:"new-model", effort:"high" }));
  fs.writeFileSync(history, JSON.stringify({ type:"turn_context", payload:{ turn_id:"old-turn", model:"old-model", effort:"low" } }));
  await service.captureCodexRuntime(project, slug, { codexRuntime:{ thread:"old-thread", turn:"old-turn", file:history, detail } });
  assert.deepEqual([front(slug).model, front(slug).effort], ["new-model", "high"]);
});
