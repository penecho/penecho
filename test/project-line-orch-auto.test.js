"use strict";
require("./helpers/safety.js");
// PenEcho Auto (PE-1085, PE-1190): the kind of job is read from its words. The first choice is the agent scored best for that kind,
// however many Works it was given, unless it failed to run lately (usage limit, error) or its app is busy now. One about as good at half
// the cost starts instead; else, one time in three, the same model at a lower effort.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-orch-auto-test-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 10000) {
  const start = Date.now();
  for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); }
}
// Stand-in agent apps like Claude Code. What each does next is in its own mode file: nothing there and it finishes at once.
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const fs = require("fs");
const say = o => console.log(JSON.stringify(o));
const mode = (() => { try { return fs.readFileSync(process.argv[2], "utf8").trim(); } catch { return ""; } })();
// Real words from the agents, as they ended runs.
const WORDS = { limit:"You've hit your 5-hour limit · resets 2:10pm (Europe/London)", "no-time":"stream error: exceeded retry limit, last status: 429 Too Many Requests",
  error:"Error: connect ECONNREFUSED 127.0.0.1:443" };
process.stdin.on("data", () => {}).on("end", () => {
  const session = "s-" + Math.random().toString(36).slice(2);
  say({ type:"system", subtype:"init", session_id:session });
  if (WORDS[mode]) {
    say({ type:"assistant", message:{ content:[{ type:"text", text:WORDS[mode] }] } });
    say({ type:"result", subtype:"success", is_error:true, result:WORDS[mode], session_id:session });
    process.exit(1);
  }
  if (mode === "slow") { say({ type:"assistant", message:{ content:[{ type:"text", text:"Working on it." }] } }); setTimeout(() => {}, 60000); return; }
  say({ type:"assistant", message:{ content:[{ type:"text", text:"Finished the work." }] } });
  say({ type:"result", subtype:"success", is_error:false, result:"Finished the work.", session_id:session });
});
`);
const modeFile = runner => path.join(temp, `mode-${runner}`);
const setMode = (runner, mode) => (mode ? fs.writeFileSync(modeFile(runner), mode) : fs.rmSync(modeFile(runner), { force:true }));
function fakeAgents() {
  const one = (id, name) => ({ name, mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript, modeFile(id)] }),
    command:launch => ({ command:launch.command, args:[...launch.prefixArgs] }) });
  return createAgents({ env:{ PATH:"" }, extra:{ fake:one("fake", "Fake"), other:one("other", "Other") } });
}
let counter = 0;
// Two saved agents, each on an agent app and a model of its own: Ada on "other", Ben on "fake".
function setup(t) {
  const directory = path.join(temp, `state-${++counter}`);
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ directory, agents:fakeAgents(), serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => s += d).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const { service, orchestrator } = lines;
  t.after(() => { setMode("fake", ""); setMode("other", ""); lines.close(); });
  setMode("fake", ""); setMode("other", "");
  const project = service.store.create({ name:"Demo", docsPath:path.join(temp, `docs-${counter}`) });
  project.defaultAgent = "fake";
  orchestrator.setSettings({ review:false });
  const ada = service.presets.add({ agent:"other", name:"Ada", model:"m-ada" }), ben = service.presets.add({ agent:"fake", name:"Ben", model:"m-ben" });
  const doc = slug => F.parseLine(service.readDoc(project, slug));
  const station = slug => {
    const state = service.stateOf(project), line = [...state.lines, ...(state.backlog || []), ...(state.landed || [])].find(l => l.id === slug);
    return line.stations.findLast(s => s.kind === "work");
  };
  const settled = (slug, ...statuses) => until(() => !service.heldWorks(project, slug).length && statuses.includes(doc(slug).status), `${slug} to be ${statuses}`);
  // Finished Works of one kind with the coordinator's score: three make an agent's record for that kind.
  const seed = async (preset, kind, score, n = 3) => {
    for (let i = 0; i < n; i++) {
      const made = await orchestrator.call(project, { do:"create-line", task:`${kind} task ${i + 1}`, agent:preset.id, kind });
      await settled(made.line, "done");
      await orchestrator.call(project, { do:"rate", line:made.line, work:made.work, score, note:`Rated ${score} for ${kind}.` });
    }
  };
  // A Work of its own for a saved agent, ending as its app's mode says.
  const work = async (preset, status) => {
    const { slug } = await service.request(project, { text:"Tidy the notes", topic:"new", preset:preset.id });
    if (status) await settled(slug, status);
    return slug;
  };
  const auto = (text, make) => orchestrator.autoPreset(project, { text, make });
  return { lines, service, orchestrator, project, ada, ben, doc, station, settled, seed, work, auto };
}
const CODE = "Fix the failing login test", DOCS = "Write a README for this project";

test("an ordinary unsent Ask uses the Orchestrator selector and keeps the selected model and effort", async t => {
  const { project, service, ada, ben, auto, doc, settled, station } = setup(t);
  service.presets.update(ben.id, { effort:"high" });
  service.presets.setDefault(ben.id);
  const make = { kind:"slides" };
  const { slug, step } = await service.saveUnsent(project, { topic:"new", text:CODE, make });
  const expected = auto(CODE, make);
  assert.equal(expected.id, ben.id);
  const sent = await service.act(project, slug, "run-unsent", { step, preset:"auto" });
  assert.deepEqual(sent.auto, { agent:expected.name, kind:"docs", from:"Make: slides", why:expected.why });
  await settled(slug, "done");
  const work = station(slug);
  assert.equal(work.savedAgentId, ben.id);
  assert.deepEqual([work.selected.model, work.selected.effort], ["m-ben", "high"]);
  assert.equal(doc(slug).front.orchestrator, undefined);
  assert.equal(doc(slug).front["auto agent"], undefined);

  for (const preset of [ada, ben]) service.presets.update(preset.id, { showInPicker:false });
  const unsent = await service.saveUnsent(project, { topic:slug, text:DOCS });
  await assert.rejects(service.act(project, slug, "run-unsent", { step:unsent.step, preset:"auto" }), /PenEcho Auto has no agent to start/);
  assert.ok(doc(slug).steps.some(s => s.id === unsent.step && F.isUnsent(s)));
});

test("ordinary PenEcho Auto queues behind the active Work even when it picks the same setup", async t => {
  const { project, service, ada, ben, doc, work } = setup(t);
  service.presets.update(ada.id, { showInPicker:false });
  setMode("fake", "slow");
  const slug = await work(ben);
  const active = await until(() => service.runs.get(service.key(project, slug)), "the active Work");
  active.steer = async () => { assert.fail("Auto must queue instead of steering into the Work"); };
  assert.equal(active.setup, "m-ben|");

  const { step } = await service.saveUnsent(project, { topic:slug, text:DOCS });
  // A click from a stale page can reach the server without the queue hint.
  const sent = await service.act(project, slug, "run-unsent", { step, preset:"auto" });
  assert.equal(sent.mode, "queued");
  assert.equal(sent.auto.agent, "Ben");
  assert.equal(service.runs.get(service.key(project, slug)).stepId, active.stepId);
  assert.equal(doc(slug).steps.filter(F.AGENT_LIKE).length, 2);
});

test("the kind of job is read from its words and the agent rated best for that kind starts it", async t => {
  const { orchestrator, project, ada, ben, doc, station, settled, seed, auto } = setup(t);
  // With no record at all nobody is rated: the job still starts, and says so.
  const unrated = auto(CODE);
  assert.equal(unrated.kind, "code");
  assert.match(unrated.why, /^Ada: not rated here yet, so it starts at 4\/5\.$/);
  // Ada is the better coder, Ben the better writer.
  await seed(ada, "code", 4.8, 4); await seed(ben, "code", 3);
  await seed(ada, "docs", 3); await seed(ben, "docs", 4.8);
  const code = auto(CODE);
  assert.deepEqual([code.id, code.name, code.kind], [ada.id, "Ada", "code"]);
  assert.deepEqual(code.from, ["“fix the failing login test”"]);
  assert.equal(code.why, "Ada: rated 4.4/5 on 4 code Works here.");
  const docs = auto(DOCS);
  assert.deepEqual([docs.id, docs.kind], [ben.id, "docs"]);
  assert.equal(docs.why, "Ben: rated 4.3/5 on 3 docs Works here.");
  // The Make choice of the box says the kind before any word.
  assert.deepEqual([auto(CODE, { kind:"slides" }).id, auto(CODE, { kind:"slides" }).from], [ben.id, ["Make: slides"]]);
  // Words that do not say: most of this project's jobs are code, so it is taken as one, and says so.
  const vague = auto("Do the thing we talked about");
  assert.deepEqual([vague.id, vague.kind, vague.from], [ada.id, "code", ["like most jobs in this project"]]);
  // A kind nobody has a record of: each agent's rating over all its Works decides, and the reason says that.
  const research = auto("Research how other note apps price their sync plans");
  assert.equal(research.kind, "research");
  assert.match(research.why, /^(Ada|Ben): rated \d(\.\d)?\/5 on \d+ Works of all kinds here, with too few research ones yet\.$/);

  // Started from the box: the job says what it was taken to be, from which words, whom it started and why.
  const job = await orchestrator.start(project, { goal:CODE, preset:"auto" });
  assert.deepEqual(job.auto, { agent:"Ada", kind:"code", from:code.from.join(", "), why:code.why });
  await settled(job.line, "done");
  assert.equal(station(job.line).savedAgentId, ada.id);
  const front = doc(job.line).front;
  assert.deepEqual([front["auto agent"], front["auto kind"], front["auto from"], front["auto why"]], [ada.id, "code", job.auto.from, job.auto.why]);
  const session = orchestrator.sessions(project).find(s => s.line === job.line);
  assert.deepEqual(session.auto, { kind:"code", from:job.auto.from, why:job.auto.why });
  const deck = await orchestrator.start(project, { goal:"The decisions of this week", preset:"auto", make:{ kind:"slides" } });
  assert.deepEqual([deck.auto.agent, deck.auto.kind, deck.auto.from], ["Ben", "docs", "Make: slides"]);
  await settled(deck.line, "done");
  // An agent the person picked themselves is just started: nothing is guessed and nothing is said.
  const named = await orchestrator.start(project, { goal:DOCS, preset:ada.id });
  assert.equal(named.auto, undefined);
  await settled(named.line, "done");
  assert.equal(station(named.line).savedAgentId, ada.id);
  assert.equal(doc(named.line).front["auto agent"], undefined);
  assert.equal(orchestrator.sessions(project).find(s => s.line === named.line).auto, undefined);
});

test("an agent whose app is working now is held back, and comes first again when it is free", async t => {
  const { service, project, ada, ben, seed, work, settled, auto } = setup(t);
  await seed(ada, "code", 4.8); await seed(ben, "code", 4.3);
  assert.equal(auto(CODE).id, ada.id);
  setMode("other", "slow");
  const slug = await work(ada);
  await until(() => service.localRunEntries().some(([, run]) => run.agent === "other"), "Ada's app to be working");
  const busy = auto(CODE);
  assert.equal(busy.id, ben.id);
  assert.equal(busy.why, "Ben: rated 4.1/5 on 3 code Works here. Passed over: Ada (its app is running 1 Work now).");
  await service.act(project, slug, "stop");
  await settled(slug, "stopped");
  await until(() => !service.localRunEntries().length, "the app to be free");
  // A Work the person stopped says nothing against the agent.
  assert.equal(auto(CODE).id, ada.id);
});

test("an agent at its usage limit is passed over until the limit resets or it finishes a Work again", async t => {
  const { service, project, ada, ben, seed, work, station, auto } = setup(t);
  await seed(ada, "code", 4.8); await seed(ben, "code", 3.5);
  assert.equal(auto(CODE).id, ada.id);
  setMode("other", "limit");
  const slug = await work(ada, "stopped");
  const stopped = station(slug);
  assert.deepEqual([stopped.stopWhy, Date.parse(stopped.resetsAt) > Date.now()], ["limit", true]);
  const limited = auto(CODE);
  assert.equal(limited.id, ben.id);
  assert.equal(limited.why, "Ben: rated 3.8/5 on 3 code Works here. Passed over: Ada (it reached its usage limit).");
  // The moment the agent said its limit resets has passed: it is started again.
  const detail = stopped.detail, text = () => service.store.readText(project, detail).text;
  const future = F.splitFront(text()).front["resets at"];
  service.store.writeText(project, detail, F.setFront(text(), { "resets at":new Date(Date.now() - 60000).toISOString() }));
  assert.equal(auto(CODE).id, ada.id);
  service.store.writeText(project, detail, F.setFront(text(), { "resets at":future }));
  assert.equal(auto(CODE).id, ben.id);
  // It finished a Work since: the limit is over, whatever was said.
  setMode("other", "");
  await work(ada, "done");
  assert.equal(auto(CODE).id, ada.id);
});

test("a limit with no time said counts for three hours", async t => {
  const { service, project, ada, ben, seed, work, station, auto } = setup(t);
  await seed(ada, "code", 4.8); await seed(ben, "code", 3.5);
  setMode("other", "no-time");
  const slug = await work(ada, "stopped");
  const stopped = station(slug);
  assert.deepEqual([stopped.stopWhy, stopped.resetsAt], ["limit", undefined]);
  assert.equal(auto(CODE).id, ben.id);
  const text = () => service.store.readText(project, stopped.detail).text;
  service.store.writeText(project, stopped.detail, F.setFront(text(), { "started at":new Date(Date.now() - 4 * 3600000).toISOString(), started:"2024-01-01 00:00", ended:"2024-01-01 00:00" }));
  assert.equal(auto(CODE).id, ada.id);
});

test("an agent whose Works stopped with an error in the last hours is held back until it finishes one again", async t => {
  const { service, project, ada, ben, seed, work, station, auto } = setup(t);
  await seed(ada, "code", 4.8); await seed(ben, "code", 3.5);
  setMode("other", "error");
  const slug = await work(ada, "stopped");
  assert.equal(station(slug).stopWhy, "error");
  const failing = auto(CODE);
  assert.equal(failing.id, ben.id);
  assert.equal(failing.why, "Ben: rated 3.8/5 on 3 code Works here. Passed over: Ada (1 Work of its app stopped with an error in the last 3 hours).");
  // An error from before these hours is forgotten.
  const detail = station(slug).detail, text = () => service.store.readText(project, detail).text, was = text();
  service.store.writeText(project, detail, F.setFront(was, { "started at":"2024-01-01T00:00:00.000Z", started:"2024-01-01 00:00", ended:"2024-01-01 00:00" }));
  assert.equal(auto(CODE).id, ada.id);
  service.store.writeText(project, detail, was);
  assert.equal(auto(CODE).id, ben.id);
  setMode("other", "");
  await work(ada, "done");
  assert.equal(auto(CODE).id, ada.id);
});

test("the best rated agent is started job after job, however many it was given", async t => {
  const { orchestrator, project, ada, ben, settled, seed } = setup(t);
  await seed(ada, "code", 4.8); await seed(ben, "code", 4.7);
  const started = [];
  for (let i = 0; i < 4; i++) {
    const job = await orchestrator.start(project, { goal:`${CODE} ${i + 1}`, preset:"auto" });
    await settled(job.line, "done");
    started.push(job.auto.agent);
    assert.doesNotMatch(job.auto.why, /Passed over/);
  }
  assert.deepEqual(started, ["Ada", "Ada", "Ada", "Ada"]);
});

test("a Start request sent again keeps the agent its first try chose, while that agent can still run", async t => {
  const { service, orchestrator, project, ada, ben, doc, station, settled, seed, auto } = setup(t);
  await seed(ada, "code", 4.5);
  const requestId = "a".repeat(32), find = id => service.store.scan(project).topics.find(topic => topic.doc.front["orchestrator request"] === id);
  // The first try made the Line and failed before its agent began.
  service.begin = async () => { throw new Error("The disk is full."); };
  await assert.rejects(orchestrator.start(project, { goal:CODE, preset:"auto", requestId }), /The disk is full/);
  delete service.begin;
  const slug = find(requestId).slug;
  assert.deepEqual([doc(slug).status, doc(slug).front["auto agent"]], ["not-started", ada.id]);
  // Meanwhile Ben has become the better choice for a new job.
  await seed(ben, "code", 5, 4);
  assert.equal(auto(CODE).id, ben.id);
  const again = await orchestrator.start(project, { goal:CODE, preset:"auto", requestId });
  assert.deepEqual([again.line, again.auto.agent, again.auto.kind], [slug, "Ada", "code"]);
  await settled(slug, "done");
  assert.equal(station(slug).savedAgentId, ada.id);
  assert.equal(doc(slug).front["auto agent"], ada.id);
  // Once the job runs, the same request only says where it is.
  assert.deepEqual(await orchestrator.start(project, { goal:CODE, preset:"auto", requestId }), { line:slug, status:"done" });

  // The agent the first try chose is gone: Auto chooses again and the job says the new one.
  const second = "b".repeat(32);
  await seed(ada, "docs", 4.8);
  service.begin = async () => { throw new Error("The disk is full."); };
  await assert.rejects(orchestrator.start(project, { goal:DOCS, preset:"auto", requestId:second }), /The disk is full/);
  delete service.begin;
  const other = find(second).slug;
  assert.equal(doc(other).front["auto agent"], ada.id);
  service.presets.remove(ada.id);
  const retried = await orchestrator.start(project, { goal:DOCS, preset:"auto", requestId:second });
  assert.deepEqual([retried.line, retried.auto.agent], [other, "Ben"]);
  await settled(other, "done");
  assert.deepEqual([station(other).agent, station(other).savedAgentId], ["fake", ben.id], "the Work went to the new agent's app");
  assert.equal(doc(other).front["auto agent"], ben.id);
});

test("with no saved agent, the agent apps on this computer are the choice", async t => {
  const { service, orchestrator, project, ada, ben, settled } = setup(t);
  service.presets.remove(ada.id); service.presets.remove(ben.id);
  const job = await orchestrator.start(project, { goal:CODE, preset:"auto" });
  assert.ok(["Fake", "Other"].includes(job.auto.agent), job.auto.agent);
  assert.match(job.auto.why, /^(Fake|Other): not rated here yet, so it starts at 4\/5\.$/);
  await settled(job.line, "done");
});

// The rule in numbers, over a made-up record: three finished code Works each, long before the hours that count. A preset's size is how
// many tokens its Works take beside the others'. The dice say no lower effort unless a test says otherwise.
function world({ ratings, prices = {}, sizes = {}, extra = [], running = [], elsewhere = [], own = "", dice = 0.99, text = CODE }) {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "rule-")), project = { id:"p" }, now = Date.now(), HOUR = 3600000;
  const APPS = { strong:["codex", "astra"], mini:["codex", "pico"], cheap:["kimi", "k2"], other:["pi", "seek"],
    max:["codex", "astra", "max"], xhigh:["codex", "astra", "xhigh"], high:["codex", "astra", "high"], medium:["codex", "astra", "medium"], low:["codex", "astra", "low"], elsewhere:["codex", "pico", "high"] };
  const stations = [], records = [];
  const station = (preset, more = {}) => {
    const id = `work-${stations.length + extra.length + 1}`, [agent, model, effort = ""] = APPS[preset], startedAt = now - 40 * HOUR, size = sizes[preset] ?? 1;
    return { id, label:id, kind:"work", state:"done", took:"5 min", agent, savedAgentId:preset, picked:{ model, ...(effort ? { effort } : {}) }, startedAt, endedAt:startedAt + 300000, tokens:{ inputTokens:200000 * size, outputTokens:20000 * size }, ...more };
  };
  // Three finished code Works each, all rated the same; or as a list says, null for one nobody rated.
  for (const [preset, rated] of Object.entries(ratings)) for (const score of Array.isArray(rated) ? rated : [rated, rated, rated]) {
    const made = station(preset);
    stations.push(made);
    records.push({ id:made.id, project:"p", line:"past", work:made.id, kind:"code", ...(score == null ? {} : { score }), at:new Date(made.endedAt).toISOString() });
  }
  // A Work that ended some hours ago, as the state tells it: hours, and what happened to it.
  const later = ([preset, hours, more]) => station(preset, { id:`later-${Math.random().toString(36).slice(2)}`, startedAt:now - hours * HOUR, endedAt:now - hours * HOUR, ...more });
  stations.push(...extra.map(later));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = Object.keys(ratings).map(id => ({ id, name:id, agent:APPS[id][0], model:APPS[id][1], effort:APPS[id][2] || "", available:true }));
  const service = { stateOf:() => ({ lines:[{ id:"past", stations }] }), readDoc:() => "", presets:{ list:() => ({ presets, default:own }), get:id => presets.find(p => p.id === id) },
    localRunEntries:() => running.map(([agent, model], i) => [`p/run-${i}`, { agent, setup:`${model}|` }]),
    store:{ projects:[project, { id:"q" }, { id:"never-opened" }] }, states:new Map([["q", { state:{ lines:[{ id:"there", stations:elsewhere.map(later) }] } }]]) };
  const orch = createOrchestrator({ service, directory, dice:() => dice });
  for (const [model, [input, output]] of Object.entries(prices)) orch.setPrice({ model, input, output });
  return orch.autoPreset(project, { text });
}
const LIMIT = { state:"error", stopWhy:"limit" }, ERROR = { state:"error", stopWhy:"error" }, soon = () => new Date(Date.now() + 2 * 86400000).toISOString(), past = () => new Date(Date.now() - 60000).toISOString(), inHours = h => new Date(Date.now() + h * 3600000).toISOString();

test("two lucky ratings do not go before a record of three", () => {
  // Two Works rated 5 count as 4.3 beside three rated 4.5 (4.2): too short a record to go first on.
  assert.equal(world({ ratings:{ strong:[5, 5, null], cheap:4.5 } }).why, "cheap: rated 4.2/5 on 3 code Works here.");
  assert.equal(world({ ratings:{ strong:[5, 5, 5], cheap:4.5 } }).id, "strong");
  // Alone, it is started and reports its tiered Bayesian rating rather than raw average.
  assert.equal(world({ ratings:{ strong:[5, 5, null] } }).why, "strong: rated 4.3/5 on 2 code Works here.");
  assert.equal(world({ ratings:{ strong:[null, null, null] } }).why, "strong: not rated here yet, so it starts at 4/5.");
});

test("one about as good at half the cost or less starts instead of the first choice", () => {
  const prices = { astra:[10, 50], pico:[10, 50], k2:[0.1, 0.2] };
  // 86.9 and 82.6 of 100: within five points, whoever stands between them.
  const ratings = { strong:4.8, mini:4.7, cheap:4.3 };
  assert.equal(world({ ratings, prices }).why, "cheap: rated 4.1/5 on 3 code Works here. Cheaper and about as good: 4.3 points of 100 below strong, 99% cheaper.");
  assert.equal(world({ ratings:{ strong:4.5, cheap:4.5 }, prices }).why, "cheap: rated 4.2/5 on 3 code Works here. Cheaper and about as good: scored the same as strong, 99% cheaper.");
  // More than five points below: no price makes up for it.
  assert.equal(world({ ratings:{ strong:4.8, cheap:4.2 }, prices }).id, "strong");
  // The best of several that qualify, not the cheapest.
  assert.equal(world({ ratings:{ strong:4.8, other:4.5, cheap:4.3 }, prices:{ ...prices, seek:[1, 5] } }).id, "other");
  // Half the cost is enough, 60% is not.
  assert.equal(world({ ratings, prices:{ ...prices, k2:[5, 25] } }).id, "cheap");
  assert.equal(world({ ratings, prices:{ ...prices, k2:[6, 30] } }).id, "strong");
  // A model that costs nothing is the cheapest there is, not one whose price is unknown.
  assert.match(world({ ratings, prices:{ ...prices, k2:[0, 0] } }).why, /^cheap: .* 4.3 points of 100 below strong, 100% cheaper\.$/);
  assert.equal(world({ ratings, prices:{ astra:[0, 0], pico:[0, 0], k2:[0, 0] } }).id, "strong");
  // Without both prices nothing is known to be cheaper.
  assert.equal(world({ ratings, prices:{ k2:[0.1, 0.2] } }).id, "strong");
  assert.equal(world({ ratings, prices:{ astra:[10, 50], pico:[10, 50] } }).id, "strong");
  // Two ratings are too short a record, however good.
  assert.equal(world({ ratings:{ strong:4.1, cheap:[5, 5, null] }, prices }).id, "strong");
  // A kind of job with no record yet goes by their ratings of all kinds.
  assert.equal(world({ ratings, prices, text:DOCS }).id, "cheap");
  // One that is busy or at its limit does not start instead of a free first choice.
  assert.equal(world({ ratings, prices, running:[["kimi", "k2"]] }).id, "strong");
  assert.equal(world({ ratings, prices, extra:[["cheap", 1, LIMIT]] }).id, "strong");
  // Cost says nothing about who is first: the dearest is when none is half its cost.
  assert.equal(world({ ratings:{ cheap:4.5, strong:4.6 }, prices:{ astra:[10, 50], k2:[6, 30] } }).id, "strong");
});

test("one time in three the first choice's model is tried at a lower effort", () => {
  const prices = { astra:[10, 50] }, yes = 0.2, no = 0.34, sizes = { max:4, xhigh:3, high:2, medium:1.6, low:1 };
  const tried = world({ ratings:{ xhigh:4.8, high:[null, null, null] }, prices, sizes, dice:yes });
  assert.equal(tried.why, "high: not rated here yet, so it starts at 4/5. Trying a lower effort than xhigh, as one time in three.");
  assert.equal(world({ ratings:{ xhigh:4.8, high:[null, null, null] }, prices, sizes, dice:no }).id, "xhigh");
  // One step down among the saved ones, never below medium, and never from medium.
  assert.equal(world({ ratings:{ medium:[null, null, null], high:[null, null, null], xhigh:[null, null, null], max:4.8 }, prices, sizes, dice:yes }).id, "xhigh");
  assert.equal(world({ ratings:{ xhigh:4.8, medium:[null, null, null] }, prices, sizes, dice:yes }).id, "medium");
  assert.equal(world({ ratings:{ xhigh:4.8, low:[null, null, null] }, prices, sizes, dice:yes }).id, "xhigh");
  assert.equal(world({ ratings:{ medium:4.8, low:[null, null, null] }, prices, sizes, dice:yes }).id, "medium");
  // Another model of the app is no lower effort of this one.
  assert.equal(world({ ratings:{ xhigh:4.8, elsewhere:[null, null, null] }, prices, sizes, dice:yes }).id, "xhigh");
  // Its own three ratings say it is over ten points worse, or it costs no less: not tried, and the next step down is not looked at.
  const long = Array(8).fill(4.8);
  assert.equal(world({ ratings:{ xhigh:long, high:2, medium:[null, null, null] }, prices, sizes, dice:yes }).id, "xhigh");
  assert.equal(world({ ratings:{ xhigh:long, high:4.2 }, prices, sizes:{ xhigh:1.5 }, dice:yes }).id, "high");
  assert.equal(world({ ratings:{ xhigh:4.8, high:[null, null, null] }, prices, sizes:{ ...sizes, high:3 }, dice:yes }).id, "xhigh");
  // No price known: a lower effort is still tried.
  assert.equal(world({ ratings:{ xhigh:4.8, high:[null, null, null] }, dice:yes }).id, "high");
  // A cheaper one about as good starts without any dice.
  assert.match(world({ ratings:{ xhigh:4.8, high:4.7, cheap:4.6 }, prices:{ ...prices, k2:[1, 5] }, sizes, dice:yes }).why, /^cheap: .* Cheaper and about as good/);
});

test("an agent at its usage limit is out until the reset it said, three hours when it said none, and tried at least every five", () => {
  const ratings = { strong:4.8, cheap:3.5 };
  assert.equal(world({ ratings }).id, "strong");
  // The reset it said, when that is later than three hours and sooner than five.
  const waiting = world({ ratings, extra:[["strong", 4, { ...LIMIT, resetsAt:inHours(0.5) }]] });
  assert.equal(waiting.why, "cheap: rated 3.8/5 on 3 code Works here. Passed over: strong (it reached its usage limit).");
  assert.equal(world({ ratings, extra:[["strong", 1, { ...LIMIT, resetsAt:past() }]] }).id, "strong");
  // A reset days away: five hours after the stop it is tried anyway.
  assert.equal(world({ ratings, extra:[["strong", 4.9, { ...LIMIT, resetsAt:soon() }]] }).id, "cheap");
  assert.equal(world({ ratings, extra:[["strong", 5.1, { ...LIMIT, resetsAt:soon() }]] }).id, "strong");
  // It was tried then and stopped again: five more.
  assert.equal(world({ ratings, extra:[["strong", 5.1, { ...LIMIT, resetsAt:soon() }], ["strong", 0.1, { ...LIMIT, resetsAt:soon() }]] }).id, "cheap");
  // No time said: three hours.
  assert.equal(world({ ratings, extra:[["strong", 2.9, LIMIT]] }).id, "cheap");
  assert.equal(world({ ratings, extra:[["strong", 3.1, LIMIT]] }).id, "strong");
  // It finished a Work after the limit: over, whatever was said.
  assert.equal(world({ ratings, extra:[["strong", 2, { ...LIMIT, resetsAt:soon() }], ["strong", 1, {}]] }).id, "strong");
  // A limit reached in another project open on this computer is the same limit, and it is the app's, whichever model met it.
  assert.equal(world({ ratings, elsewhere:[["strong", 1, { ...LIMIT, resetsAt:soon() }]] }).id, "cheap");
  const limited = world({ ratings:{ strong:4.8, mini:4.6, cheap:3.5 }, extra:[["strong", 1, LIMIT]] });
  assert.equal(limited.why, "cheap: rated 3.8/5 on 3 code Works here. Passed over: strong (it reached its usage limit); mini (it reached its usage limit).");
});

test("errors count for three hours, and not what was nobody's fault", () => {
  const ratings = { strong:4.8, cheap:3.5 };
  const one = world({ ratings, extra:[["strong", 1, ERROR]] });
  assert.equal(one.why, "cheap: rated 3.8/5 on 3 code Works here. Passed over: strong (1 Work of its app stopped with an error in the last 3 hours).");
  assert.match(world({ ratings, extra:[1, 1, 1, 1, 1].map(h => ["strong", h, ERROR]) }).why, /Passed over: strong \(5 Works of its app stopped with an error in the last 3 hours\)\.$/);
  assert.equal(world({ ratings, extra:[["strong", 4, ERROR]] }).id, "strong");
  assert.equal(world({ ratings, extra:[["strong", 2, ERROR], ["strong", 1, {}]] }).id, "strong");
  // PenEcho closing under a Work, and a Work the person stopped, say nothing against the agent.
  assert.equal(world({ ratings, extra:[["strong", 1, { state:"error", why:"PenEcho closed while this was running. Start it again." }]] }).id, "strong");
  assert.equal(world({ ratings, extra:[["strong", 1, { state:"off", stopWhy:"stopped" }]] }).id, "strong");
  // An error on one model holds its app's other models back too.
  assert.equal(world({ ratings:{ strong:4.8, mini:4.6, cheap:3.5 }, extra:[["strong", 1, ERROR]] }).id, "cheap");
  // The other agent failing too: both are out alike, and the better one is tried.
  assert.equal(world({ ratings, extra:[["strong", 1, ERROR], ["cheap", 1, ERROR]] }).id, "strong");
});

test("a busy app gives way to a free one scored close to it; Works given before say nothing", () => {
  const ratings = { strong:4.8, mini:4.6, cheap:4.4 }, works = (n, app = "codex") => Array.from({ length:n }, () => [app, "astra"]);
  // Fourteen given in the last three hours: it is still the one started.
  const given = world({ ratings, extra:Array.from({ length:14 }, () => ["strong", 1, {}]) });
  assert.equal(given.id, "strong");
  assert.doesNotMatch(given.why, /Passed over/);
  // The app is busy, whichever of its models runs: 86.9 gives way to 83.1.
  const busy = world({ ratings, running:works(1) });
  assert.equal(busy.why, "cheap: rated 4.2/5 on 3 code Works here. Passed over: strong (its app is running 1 Work now); mini (its app is running 1 Work now).");
  assert.equal(world({ ratings, running:[["codex", "pico"]] }).id, "cheap");
  // More than ten points lower: the busy one starts, however many it runs.
  assert.equal(world({ ratings:{ strong:4.8, cheap:3.5 }, running:works(12) }).id, "strong");
  assert.equal(world({ ratings:{ strong:4.8, cheap:[null, null, null] }, running:works(12) }).id, "strong");
  // All busy: the app running fewest, a tie goes to the better one.
  assert.equal(world({ ratings, running:[...works(2), ...works(1, "kimi")] }).id, "cheap");
  assert.equal(world({ ratings, running:[...works(1), ...works(1, "kimi")] }).id, "strong");
  // However busy, it still comes before one that failed to run.
  assert.equal(world({ ratings:{ strong:4.8, cheap:4.5 }, running:works(12), extra:[["cheap", 1, ERROR]] }).id, "strong");
});

test("a job always starts", () => {
  const ratings = { strong:4.8, cheap:3.5 }, none = " Every agent reached its usage limit or stopped with an error lately, so this one is tried.";
  // All at their limit: the one whose limit ends first, as it said it, however far away.
  assert.equal(world({ ratings, extra:[["strong", 1, { ...LIMIT, resetsAt:inHours(3) }], ["cheap", 1, { ...LIMIT, resetsAt:inHours(1) }]] }).why, `cheap: rated 3.8/5 on 3 code Works here.${none}`);
  assert.equal(world({ ratings, extra:[["strong", 4.9, { ...LIMIT, resetsAt:soon() }], ["cheap", 1, { ...LIMIT, resetsAt:inHours(1) }]] }).id, "cheap");
  assert.equal(world({ ratings, extra:[["strong", 1, { ...LIMIT, resetsAt:inHours(1) }], ["cheap", 1, LIMIT]] }).id, "strong");
  // No end known: the person's default, and with none the better one.
  assert.equal(world({ ratings, own:"cheap", extra:[["strong", 1, LIMIT], ["cheap", 2, LIMIT]] }).id, "cheap");
  assert.equal(world({ ratings, extra:[["strong", 1, LIMIT], ["cheap", 2, LIMIT]] }).id, "strong");
  // An error may be over by now, a limit is not; best on a model of the app that did not meet it.
  assert.equal(world({ ratings, extra:[["strong", 1, { ...LIMIT, resetsAt:inHours(0.2) }], ["cheap", 1, ERROR]] }).id, "cheap");
  assert.equal(world({ ratings:{ strong:4.8, mini:4.6 }, extra:[["strong", 1, ERROR]] }).id, "mini");
  // No lower effort and nothing cheaper is tried then: they share the limit.
  assert.equal(world({ ratings:{ xhigh:4.8, high:4.7 }, prices:{ astra:[10, 50] }, sizes:{ high:0.1 }, dice:0, extra:[["xhigh", 1, LIMIT]] }).id, "xhigh");
  // One agent alone, whatever is wrong with it.
  assert.equal(world({ ratings:{ strong:4.8 }, running:Array.from({ length:9 }, () => ["codex", "astra"]) }).why, "strong: rated 4.3/5 on 3 code Works here.");
  assert.equal(world({ ratings:{ strong:4.8 }, extra:[["strong", 1, LIMIT]] }).why, "strong: rated 4.3/5 on 3 code Works here. It reached its usage limit and is the only agent to start.");
  assert.equal(world({ ratings:{ strong:4.8 }, extra:[["strong", 1, ERROR]] }).why, "strong: rated 4.3/5 on 3 code Works here. It stopped with an error lately and is the only agent to start.");
});

test("agents scored alike: the person's default starts, then the one with more Works, never the cheaper for that alone", () => {
  const unrated = { strong:[null], cheap:[null] };
  assert.equal(world({ ratings:unrated, own:"cheap" }).id, "cheap");
  assert.equal(world({ ratings:unrated, own:"strong", prices:{ astra:[10, 50], k2:[0.1, 0.2] } }).id, "strong");
  assert.equal(world({ ratings:{ strong:[null], cheap:[null, null] } }).id, "cheap");
});

test("default-effort presets match their configured CLI effort, untested efforts do not inherit higher-effort records, and Light-only stays unproven on Standard", () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "effort-tier-")), project = { id:"p" }, now = Date.now(), HOUR = 3600000;
  const stations = [], records = [];
  const addWork = (agent, preset, model, effort, score, { scope = "standard", selected = null, extra = {} } = {}) => {
    const id = `work-${stations.length + 1}`, startedAt = now - 40 * HOUR;
    stations.push({
      id, label:id, kind:"work", state:"done", took:"5 min", agent, savedAgentId:preset,
      selected:selected ?? { model, effort }, picked:{ model, effort }, scope,
      startedAt, endedAt:startedAt + 300000, tokens:{ inputTokens:200000, outputTokens:20000 }, ...extra,
    });
    records.push({ id, project:"p", line:"past", work:id, kind:"code", scope, score, at:new Date(startedAt + 300000).toISOString() });
  };
  // 10 code Works on gpt-6.2-sol at xhigh (4.8/5), originally run under an older explicit preset id:
  for (let i = 0; i < 10; i++) addWork("codex", "old-sol-xhigh", "gpt-6.2-sol", "xhigh", 4.8);
  // 5 code Works on gpt-6.2-astra at medium (4.5/5):
  for (let i = 0; i < 5; i++) addWork("codex", "astra-med", "gpt-6.2-astra", "medium", 4.5);
  // 5 Light-only code Works on flash at 5.0/5:
  for (let i = 0; i < 5; i++) addWork("opencode", "flash", "deepseek-flash", "max", 5.0, { scope:"light" });

  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = [
    { id:"astra-med", name:"Codex · gpt-6.2-astra · medium effort", agent:"codex", model:"gpt-6.2-astra", effort:"medium", available:true },
    { id:"codex-default", name:"Codex", agent:"codex", model:"", effort:"", available:true },
    { id:"sol-low", name:"Codex · gpt-6.2-sol · low effort", agent:"codex", model:"gpt-6.2-sol", effort:"low", available:true },
    { id:"flash", name:"OpenCode · flash", agent:"opencode", model:"deepseek-flash", effort:"max", available:true },
  ];
  const service = {
    stateOf:() => ({ lines:[{ id:"past", stations }] }),
    readDoc:() => "",
    agents:{
      configuredModel:id => (id === "codex" ? "gpt-6.2-sol" : ""),
      configuredEffort:id => (id === "codex" ? "xhigh" : ""),
    },
    presets:{ list:() => ({ presets, default:"codex-default" }), get:id => presets.find(p => p.id === id) },
    localRunEntries:() => [],
    store:{ projects:[project] },
    states:new Map(),
  };
  const orch = createOrchestrator({ service, directory });

  // 1. Default Codex resolves configuredModel=gpt-6.2-sol and configuredEffort=xhigh, matching all 10 code Works and beating astra-med.
  //    Tiered rating: (10*4.8 + 4*4.0) / 14 = 4.57 -> 4.6/5. Auto assignment lists resolved model & effort when available.
  const pick = orch.autoPreset(project, { text:CODE });
  assert.equal(pick.id, "codex-default");
  assert.equal(pick.name, "Codex · gpt-6.2-sol · xhigh effort");
  assert.equal(pick.why, "Codex · gpt-6.2-sol · xhigh effort: rated 4.6/5 on 10 code Works here.");

  // 2. Untested low-effort preset does NOT inherit xhigh's 10 Works (starts unrated at 4/5 instead of stealing 4.6/5).
  const onlyLow = { ...service, presets:{ list:() => ({ presets:[presets[2]], default:"sol-low" }), get:() => presets[2] } };
  const lowPick = createOrchestrator({ service:onlyLow, directory }).autoPreset(project, { text:CODE });
  assert.equal(lowPick.id, "sol-low");
  assert.equal(lowPick.why, "Codex · gpt-6.2-sol · low effort: not rated here yet, so it starts at 4/5.");

  // 3. Light-only 5/5 agent is unproven for Standard jobs (loses to astra-med at 4.3/5 tiered) and shows "(Light only)" + bounded 4.2/5 if chosen alone.
  const stdPresets = [presets[0], presets[3]];
  const stdSvc = { ...service, presets:{ list:() => ({ presets:stdPresets, default:"astra-med" }), get:id => stdPresets.find(p => p.id === id) } };
  assert.equal(createOrchestrator({ service:stdSvc, directory }).autoPreset(project, { text:CODE }).id, "astra-med");
  const lightOnlySvc = { ...service, presets:{ list:() => ({ presets:[presets[3]], default:"flash" }), get:() => presets[3] } };
  const lightAlone = createOrchestrator({ service:lightOnlySvc, directory }).autoPreset(project, { text:CODE });
  assert.equal(lightAlone.why, "OpenCode · flash: rated 4.2/5 on 5 code Works here (Light only).");
  // On a Light UI tweak ask, flash IS proven on Light (4.6/5 tiered) and beats astra-med.
  const lightJob = createOrchestrator({ service:stdSvc, directory }).autoPreset(project, { text:"Rename the save button label" });
  assert.equal(lightJob.id, "flash");
  assert.equal(lightJob.why, "OpenCode · flash: rated 4.6/5 on 5 code Works here.");

  // 4. Duplicate saved presets passed over for the same reason are deduplicated in the explanation.
  const dupPresets = [
    { id:"dup-1", name:"Claude Code · opus", agent:"claude", model:"claude-opus-5-5", effort:"medium", available:true },
    { id:"dup-2", name:"Claude Code · opus", agent:"claude", model:"claude-opus-5-5", effort:"medium", available:true },
    presets[0],
  ];
  const dupStations = [
    ...stations,
    ...[1, 2, 3, 4].map(i => ({ id:`c-${i}`, label:`c-${i}`, kind:"work", state:"done", took:"5 min", agent:"claude", savedAgentId:"dup-1", picked:{ model:"claude-opus-5-5", effort:"medium" }, startedAt:now - 40 * HOUR, endedAt:now - 39 * HOUR })),
    { id:"c-lim", label:"c-lim", kind:"work", state:"error", stopWhy:"limit", resetsAt:soon(), agent:"claude", savedAgentId:"dup-1", picked:{ model:"claude-opus-5-5", effort:"medium" }, startedAt:now - HOUR, endedAt:now - HOUR },
  ];
  const dupRecords = [...records, ...[1, 2, 3, 4].map(i => ({ id:`cr-${i}`, project:"p", line:"past", work:`c-${i}`, kind:"code", score:5, at:new Date(now - 39 * HOUR).toISOString() }))];
  const dupDir = fs.mkdtempSync(path.join(temp, "dup-over-"));
  fs.mkdirSync(path.join(dupDir, "orchestrator"));
  fs.writeFileSync(path.join(dupDir, "orchestrator", "records.json"), JSON.stringify({ records:dupRecords }));
  const dupSvc = { ...service, stateOf:() => ({ lines:[{ id:"past", stations:dupStations }] }), presets:{ list:() => ({ presets:dupPresets, default:"dup-1" }), get:id => dupPresets.find(p => p.id === id) } };
  const dupPick = createOrchestrator({ service:dupSvc, directory:dupDir }).autoPreset(project, { text:CODE });
  assert.equal(dupPick.why, "Codex · gpt-6.2-astra · medium effort: rated 4.3/5 on 5 code Works here. Passed over: Claude Code · opus (it reached its usage limit).");
});
