"use strict";
require("./helpers/safety.js");
// Sub-agents (PE-1190): PenEcho picks who does a part the orchestrator hands over. A decision goes to a model rated above it; doing goes
// to models within five points of it at under half its cost, cheapest first, two parts each. A model at one effort is one choice whichever
// app runs it, one with few jobs now and then gets a part, and what nobody fits stays with the orchestrator. A part cannot be handed on.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-sub-agents-test-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
const HOUR = 3600000;

// ---------- Who is picked, over a made-up record ----------
// Each agent: its app, model and effort, what its rated code Works scored, and its price. "boss" is the orchestrator.
// Each Work takes 200k tokens in and 20k out, so a price of [1, 5] makes it cost $0.30.
function world(agents, { dice = 0.99, running = [], late = [], self = "boss" } = {}) {
  const directory = fs.mkdtempSync(path.join(temp, "rule-")), project = { id:"p" }, now = Date.now(), stations = [], records = [];
  const station = (id, at, more = {}) => {
    const a = agents[id], n = `work-${stations.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
    return { id:n, label:n, kind:"work", state:"done", took:"5 min", agent:a.app, savedAgentId:id, picked:{ model:a.model, ...(a.effort ? { effort:a.effort } : {}) }, startedAt:at, endedAt:at + 300000, tokens:{ inputTokens:200000, outputTokens:20000 }, ...more };
  };
  for (const [id, a] of Object.entries(agents)) for (const score of a.ratings || []) {
    const made = station(id, now - 40 * HOUR);
    stations.push(made);
    records.push({ id:made.id, project:"p", line:"past", work:made.id, kind:"code", ...(score == null ? {} : { score }), at:new Date(made.endedAt).toISOString() });
  }
  for (const [id, hours, more] of late) stations.push(station(id, now - hours * HOUR, more));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = Object.entries(agents).map(([id, a]) => ({ id, name:id, agent:a.app, model:a.model, effort:a.effort || "", available:true, allowDelegation:a.allow !== false }));
  const docs = new Map([["job", F.setFront(F.initialLine({ title:"Job", status:"working", steps:[F.askStep({ words:"Do it" }), F.workStep({ who:"boss" })] }), { id:"PE-1", orchestrator:"yes" })]]);
  const lines = [{ id:"past", stations }, { id:"job", status:"working", running:true, stations:[{ ...station(self, now), state:"active" }] },
    ...running.map((id, i) => ({ id:`part-${i}`, status:"working", running:true, orchestratedBySlug:"job", stations:[{ ...station(id, now), state:"active" }] }))];
  const made = [];
  const service = { stateOf:() => ({ lines }), readDoc:(_p, slug) => docs.get(slug) || "", parsedDoc:(_p, slug) => F.parseLine(docs.get(slug) || ""), writeDoc:(_p, slug, md) => docs.set(slug, md), changed() {}, onChange() {}, isLine:(_p, slug) => docs.has(slug),
    sync() {}, key:(_p, slug) => slug, stepPresets:new Map(), begin:async () => {},
    createTopic:async (_p, { text, preset }, fields) => { const slug = `part-${made.length}`; made.push({ slug, text, preset }); docs.set(slug, F.setFront(F.initialLine({ title:slug, status:"working", steps:[F.askStep({ words:text }), F.workStep({ who:agents[preset].app })] }), fields)); return { slug }; },
    presets:{ list:() => ({ presets, default:"" }), get:id => presets.find(p => p.id === id) }, localRunEntries:() => [], store:{ projects:[project] }, states:new Map() };
  const rolls = Array.isArray(dice) ? [...dice] : null;
  const orch = createOrchestrator({ service, directory, dice:() => rolls ? rolls.shift() ?? 0.99 : dice });
  for (const a of Object.values(agents)) if (a.price) orch.setPrice({ model:a.model, input:a.price[0], output:a.price[1] });
  const decide = (parts, more = {}) => orch.call(project, { do:"decide", route:"delegate", why:"They stand on their own.", parts:parts.map((p, i) => ({ task:`part ${i + 1}`, kind:"code", brief:`do part ${i + 1}`, ...p })), ...more }, { session:"job" });
  return { orch, project, made, decide, front:slug => F.parseLine(docs.get(slug)).front, docs };
}
const three = n => [n, n, n];
const BOSS = { app:"claude", model:"grand", effort:"high", ratings:three(4.5), price:[10, 50] };
const picked = answer => (answer.started || []).map(s => s.agent);
const parts = n => Array.from({ length:n }, () => ({}));

test("doing goes to models within five points at under half the cost, cheapest first, two parts each; the rest is kept", async () => {
  const agents = { boss:BOSS,
    near:{ app:"pi", model:"seek", ratings:three(4.2), price:[1, 5] },          // close enough, the cheapest that is
    better:{ app:"codex", model:"star", ratings:three(5), price:[2, 10] },      // above the orchestrator: no limit upwards
    half:{ app:"kimi", model:"k", ratings:three(4.5), price:[5, 25] },          // exactly half: not under it
    poor:{ app:"omp", model:"tiny", ratings:three(3), price:[0.1, 0.5] },       // too far below
    unpriced:{ app:"dsh", model:"free", ratings:three(4.8) },                   // nobody knows what it costs
    off:{ app:"opencode", model:"hidden", ratings:three(5), price:[0.1, 0.5], allow:false } };
  const w = world(agents), done = await w.decide(parts(6));
  assert.deepEqual(picked(done), ["near", "near", "better", "better"]);
  assert.deepEqual(done.started.map(s => s.name), ["near", "near", "better", "better"]);
  assert.equal(done.route, "split", "two parts stay, so it is a split whatever the call said");
  assert.deepEqual(done.kept.map(k => k.task), ["part 5", "part 6"]);
  assert.match(done.kept[0].why, /has 2 of your parts\. Do it yourself, or send it again when they are done/);
  assert.equal(w.front("job").route, "split");
  assert.match(w.front("job")["route parts"], /part 1 → near; .*part 6 → you/);
  assert.equal(w.made.length, 4, "kept parts start nothing");
  // Ones still running from an earlier call count.
  assert.deepEqual(picked(await world(agents, { running:["near", "near", "better"] }).decide(parts(2))), ["better"]);
  // Two parts to one model are a delegation, not a split of different owners.
  assert.equal((await world(agents).decide(parts(2), { route:"split" })).route, "delegate");
});

test("a decision goes to the best-rated above the orchestrator, whatever it costs, and changes no files", async () => {
  const agents = { boss:BOSS, dear:{ app:"codex", model:"star", ratings:three(5), price:[90, 400] }, good:{ app:"kimi", model:"k", ratings:three(4.8), price:[1, 5] },
    few:{ app:"pi", model:"seek", ratings:[5, 5], price:[1, 5] } };
  const w = world(agents), done = await w.decide([{ role:"decision" }]);
  assert.deepEqual(picked(done), ["dear"]);
  assert.match(w.made[0].text, /^do part 1\n\nChange no files\. Answer with the decision and the plan\.$/);
  // Nobody above it: it decides itself.
  const top = await world({ boss:{ ...BOSS, ratings:three(5) }, good:agents.good }).decide([{ role:"decision" }]);
  assert.deepEqual([top.route, top.started, top.kept[0].why], ["self", undefined, "No free agent is rated above you for this kind of work. Do it yourself, or name an agent if the person asked for others."]);
  await assert.rejects(w.decide([{ role:"boss" }]), { code:"BAD_ROLE" });
});

test("there is always somebody: with nobody fit, no price or no record, the part is the orchestrator's", async () => {
  const near = { app:"pi", model:"seek", ratings:three(4.5), price:[1, 5] };
  const none = await world({ boss:BOSS }).decide(parts(2));
  assert.deepEqual([none.route, none.delegated, none.started, none.kept.length], ["self", 0, undefined, 2]);
  assert.match(none.kept[0].why, /under half your cost\. Do it yourself, or name an agent/);
  assert.match((await world({ boss:{ ...BOSS, price:null }, near }).decide(parts(1))).kept[0].why, /Your own model has no price/);
  // An app at its limit is out; another app with the same model at the same effort takes the part.
  const limit = { state:"error", stopWhy:"limit" };
  assert.equal((await world({ boss:BOSS, near }, { late:[["near", 1, limit]] }).decide(parts(1))).started, undefined);
  assert.deepEqual(picked(await world({ boss:BOSS, near, twin:{ app:"opencode", model:"seek" } }, { late:[["near", 1, limit]] }).decide(parts(1))), ["twin"]);
  // create-line and add-task answer the same way, and the person's own choice is never second-guessed.
  const w = world({ boss:BOSS, poor:{ app:"omp", model:"tiny", ratings:three(2), price:[20, 90] } });
  const kept = await w.orch.call(w.project, { do:"create-line", task:"x", kind:"code" }, { session:"job" });
  assert.equal(kept.started, false);
  assert.match(kept.kept, /Do it yourself/);
  assert.deepEqual(picked(await w.decide([{ agent:"poor" }])), ["poor"]);
  assert.match((await w.decide([{ agent:"auto" }])).kept[0].why, /Do it yourself/);
  // A part with no brief is only planned: nobody is picked for it.
  assert.equal((await w.decide([{ agent:"self" }, { brief:"" }], { route:"self" })).route, "self");
});

test("the same model at the same effort in several apps is one choice, and its jobs count together", async () => {
  const seek = { model:"vendor/seek", effort:"high", price:[1, 5] };
  // Two Works in one app and two in the other are a record of four; neither app alone would have three.
  const agents = { boss:BOSS, one:{ ...seek, app:"pi", ratings:[4.5, 4.5] }, two:{ ...seek, app:"opencode", model:"seek", ratings:[4.5, 4.5] }, copy:{ ...seek, app:"pi" },
    star:{ app:"codex", model:"star", ratings:three(4.5), price:[2, 10] } };
  assert.deepEqual(picked(await world(agents).decide(parts(4))), ["one", "one", "star", "star"], "two parts for the model, not two for each way to run it");
  // Another effort of it is another choice.
  assert.equal(picked(await world({ boss:BOSS, one:agents.one, two:{ ...agents.two, effort:"low" } }).decide(parts(1))).length, 0);
  // Its ratings are shared, what it costs is each app's own: the cheaper one takes it, and the dear one does not borrow that cost.
  const dear = { app:"opencode", model:"dear/seek", effort:"high", price:[6, 30] }, cheap = { ...agents.one, ratings:three(4.5) };
  assert.deepEqual(picked(await world({ boss:BOSS, dear, cheap }).decide(parts(1))), ["cheap"]);
  assert.deepEqual(picked(await world({ boss:BOSS, dear, cheap }, { late:[["cheap", 1, { state:"error", stopWhy:"limit" }]] }).decide(parts(1))), []);
});

test("now and then one part goes to a model with five jobs or fewer, not every time and never a heavy one", async () => {
  const near = { app:"pi", model:"seek", ratings:three(4.5), price:[1, 5] }, fresh = { app:"kimi", model:"k", price:[2, 10] };
  const yes = [0.2, 0.6, 0], agents = { boss:BOSS, near, fresh };
  const tried = await world(agents, { dice:yes }).decide(parts(2));
  assert.deepEqual(tried.started.map(s => [s.agent, Boolean(s.trial)]), [["near", false], ["fresh", true]], "one part, the one the dice say");
  assert.deepEqual(picked(await world(agents, { dice:0.25 }).decide(parts(2))), ["near", "near"], "not every time");
  assert.deepEqual(picked(await world(agents, { dice:yes }).decide([{ scope:"heavy" }, { scope:"heavy" }])), ["near", "near"]);
  assert.deepEqual(picked(await world({ boss:BOSS, fresh }, { dice:0.99 }).decide(parts(1))), [], "only the dice give it one");
  // Six jobs, counted over the apps that ran it, are a record of their own; five are not.
  const six = n => ({ boss:BOSS, near, fresh:{ ...fresh, ratings:Array(n - 3).fill(null) }, twin:{ ...fresh, app:"opencode", ratings:Array(3).fill(null) } });
  assert.equal((await world(six(5), { dice:yes }).decide(parts(2))).started.some(s => s.trial), true);
  assert.equal((await world(six(6), { dice:yes }).decide(parts(2))).started.some(s => s.trial), false);
  // It has its two parts at most, as any other.
  assert.deepEqual(picked(await world(agents, { dice:yes, running:["fresh", "fresh"] }).decide(parts(2))), ["near", "near"]);
  // Two poor ratings end it, and one that costs half as much or more, or has no price, is not tried.
  for (const bad of [{ ...fresh, ratings:[2, 2.5] }, { ...fresh, price:[5, 25] }, { ...fresh, price:null }]) {
    assert.deepEqual(picked(await world({ boss:BOSS, near, fresh:bad }, { dice:yes }).decide(parts(2))), ["near", "near"]);
  }
});

// ---------- One level, the fallback and the prompt, with real runs ----------
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const fs = require("fs"), say = o => console.log(JSON.stringify(o));
const [mode, app] = [(() => { try { return fs.readFileSync(process.argv[2], "utf8").trim(); } catch { return ""; } })(), process.argv[3]];
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  fs.appendFileSync(${JSON.stringify(path.join(temp, "runs.jsonl"))}, JSON.stringify({ app, line:process.env.PENECHO_LINE, pass:process.env.PENECHO_ORCH_PASS || "", key:process.env.PENECHO_ORCH_PROOF_KEY || "", prompt }) + "\\n");
  const session = "s-" + Math.random().toString(36).slice(2);
  say({ type:"system", subtype:"init", session_id:session });
  if (mode === "limit") {
    const words = "You've hit your 5-hour limit · resets 2:10pm (Europe/London)";
    say({ type:"assistant", message:{ content:[{ type:"text", text:words }] } });
    say({ type:"result", subtype:"success", is_error:true, result:words, session_id:session });
    process.exit(1);
  }
  if (/slow/.test(prompt.split("\\n").slice(0, 4).join(" "))) { setTimeout(() => {}, 60000); return; }
  say({ type:"assistant", message:{ id:"req-" + process.pid, usage:{ input_tokens:200000, output_tokens:20000, cache_read_input_tokens:0, cache_creation_input_tokens:0 }, content:[{ type:"text", text:"Finished the work." }] } });
  say({ type:"result", subtype:"success", is_error:false, result:"Finished the work.", session_id:session });
});
`);
const runs = () => { try { return fs.readFileSync(path.join(temp, "runs.jsonl"), "utf8").trim().split("\n").map(JSON.parse); } catch { return []; } };
async function until(check, label, ms = 15000) {
  const start = Date.now();
  for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await new Promise(r => setTimeout(r, 25)); }
}
const modeFile = app => path.join(temp, `mode-${app}`);
const setMode = (app, mode) => (mode ? fs.writeFileSync(modeFile(app), mode) : fs.rmSync(modeFile(app), { force:true }));
let counter = 0;
async function setup(t) {
  const one = (id, name) => ({ name, mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript, modeFile(id), id] }), command:launch => ({ command:launch.command, args:[...launch.prefixArgs] }) });
  const agents = createAgents({ env:{ PATH:"" }, extra:{ boss:one("boss", "Boss"), cheap:one("cheap", "Cheap"), spare:one("spare", "Spare") } });
  const directory = path.join(temp, `state-${++counter}`);
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ directory, agents, serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:async () => ({}), send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const { service, orchestrator } = lines;
  for (const app of ["boss", "cheap", "spare"]) setMode(app, "");
  t.after(() => { for (const app of ["boss", "cheap", "spare"]) setMode(app, ""); lines.close(); });
  const project = service.store.create({ name:"Demo", docsPath:path.join(temp, `docs-${counter}`) });
  project.defaultAgent = "boss";
  orchestrator.setSettings({ review:false });
  const boss = service.presets.add({ agent:"boss", name:"Boss", model:"m-boss" }), cheap = service.presets.add({ agent:"cheap", name:"Cheap", model:"m-cheap" }), spare = service.presets.add({ agent:"spare", name:"Spare", model:"m-spare" });
  const doc = slug => F.parseLine(service.readDoc(project, slug));
  const settled = (slug, ...statuses) => until(() => !service.heldWorks(project, slug).length && statuses.includes(doc(slug).status), `${slug} to be ${statuses}`);
  orchestrator.setPrice({ model:"m-boss", input:10, output:50 });
  orchestrator.setPrice({ model:"m-cheap", input:1, output:5 });
  orchestrator.setPrice({ model:"m-spare", input:2, output:10 });
  for (const preset of [boss, cheap, spare]) for (let i = 0; i < 3; i++) {
    const made = await orchestrator.call(project, { do:"create-line", task:`old task ${i}`, agent:preset.id, kind:"code" });
    await settled(made.line, "done");
    await orchestrator.call(project, { do:"rate", line:made.line, work:made.work, score:4.5, note:"Fine." });
  }
  orchestrator.setBase("http://127.0.0.1:3888/api/lines/orchestrate");
  const job = await orchestrator.start(project, { goal:"slow job: rework the importer", preset:boss.id });
  await until(() => service.heldWorks(project, job.line).length, "the job is running");
  const pass = orchestrator.env(project, job.line, doc(job.line)).PENECHO_ORCH_PASS;
  const call = args => orchestrator.agentCall(pass, args, null);
  return { service, orchestrator, project, boss, cheap, spare, doc, settled, job, call };
}

test("a part stopped by its app's limit goes on once with the next that fits, and then is the orchestrator's", async t => {
  const { project, orchestrator, call, doc, settled, cheap, spare } = await setup(t);
  setMode("cheap", "limit");
  const done = await call({ do:"decide", route:"delegate", why:"It stands on its own.", wait:20, parts:[{ task:"the parser", kind:"code", brief:"Write the parser." }] });
  const [part] = done.started;
  assert.equal(part.agent, cheap.id, "the cheapest that fits");
  assert.equal(done.waited.done, true);
  assert.equal(doc(part.line).status, "done", "the next one finished it inside the same wait");
  const works = doc(part.line).steps.filter(F.AGENT_LIKE);
  assert.deepEqual(works.map(s => s.who), ["cheap", "spare"]);
  const records = orchestrator.records(project).filter(r => r.line === part.line);
  assert.deepEqual(records.map(r => [r.preset, r.picked, Boolean(r.handedOn), r.kind]), [[cheap.id, "execution", true, "code"], [spare.id, "execution", true, "code"]]);

  // Both out: started on nothing, it stays with the orchestrator.
  const kept = await call({ do:"decide", route:"delegate", why:"It stands on its own.", parts:[{ task:"the writer", kind:"code", brief:"Write the writer." }] });
  assert.equal(kept.started[0].agent, spare.id, "the app at its limit is passed over");
  await settled(kept.started[0].line, "done");
  setMode("spare", "limit");
  const last = await call({ do:"create-line", task:"Write the checker.", kind:"code", wait:20 });
  assert.equal(last.agent, spare.id);
  assert.equal(last.waited.lines[0].status, "stopped", "nobody is left, so the wait says so");
  assert.equal(doc(last.line).steps.filter(F.AGENT_LIKE).length, 1, "and it is not started again and again");
  const mine = await call({ do:"create-line", task:"Write the docs.", kind:"code" });
  assert.deepEqual([mine.started, /Do it yourself/.test(mine.kept)], [false, true]);
});

test("a part named for an agent by the person stays as that choice left it", async t => {
  const { call, doc, cheap } = await setup(t);
  setMode("cheap", "limit");
  const done = await call({ do:"decide", route:"delegate", why:"The person asked for Cheap.", wait:20, parts:[{ task:"the parser", kind:"code", agent:cheap.id, brief:"Write the parser." }] });
  assert.equal(done.waited.lines[0].status, "stopped");
  assert.deepEqual(doc(done.started[0].line).steps.filter(F.AGENT_LIKE).map(s => s.who), ["cheap"]);
});

test("add-task with no agent keeps the Line's agent, or takes the next when its app stopped it", async t => {
  const { call, doc, settled, cheap } = await setup(t);
  const { started:[part] } = await call({ do:"decide", route:"delegate", why:"It stands on its own.", wait:20, parts:[{ task:"the parser", kind:"code", brief:"Write the parser." }] });
  const fix = await call({ do:"add-task", line:part.line, task:"Fix the empty case.", kind:"code", wait:20 });
  assert.deepEqual([fix.agent, fix.name], [cheap.id, "Cheap · m-cheap"], "a fix goes back to who made it");
  await settled(part.line, "done");
  setMode("cheap", "limit"); setMode("spare", "limit");
  const stuck = await call({ do:"add-task", line:part.line, task:"Fix the long case.", kind:"code", wait:20 });
  assert.equal(doc(part.line).steps.filter(F.AGENT_LIKE).at(-1).who, "spare", "its app's limit handed it on once");
  assert.equal(stuck.waited.lines[0].status, "stopped");
  const none = await call({ do:"add-task", line:part.line, task:"Fix the long case.", kind:"code" });
  assert.deepEqual([none.started, none.kept], [false, "Two agents were stopped on this Line already. Do it yourself."]);
});

test("a part that ran beside others goes on too, unless a new task on the Line says what happens next", async t => {
  const { call, doc, settled, spare } = await setup(t);
  const { started:[part] } = await call({ do:"decide", route:"delegate", why:"It stands on its own.", wait:20, parts:[{ task:"the parser", kind:"code", brief:"Write the parser." }] });
  setMode("cheap", "limit");
  const beside = await call({ do:"add-task", line:part.line, task:"Write the lexer.", kind:"code", parallel:true });
  await until(() => doc(part.line).steps.filter(F.AGENT_LIKE).some(s => s.off === "stopped") || doc(part.line).status === "stopped", "its app's limit");
  const waited = await call({ do:"wait", lines:[part.line], seconds:20 });
  assert.equal(waited.done, true);
  assert.deepEqual(doc(part.line).steps.filter(F.AGENT_LIKE).map(s => s.who), ["cheap", "cheap", "spare"]);
  await settled(part.line, "done");
  // Waited for again, it is not handed on a second time.
  await call({ do:"wait", lines:[part.line], seconds:5 });
  assert.equal(doc(part.line).steps.filter(F.AGENT_LIKE).length, 3);
  assert.ok(beside.work);
  // A saved part gets its agent as a started one does: the app at its limit is passed over.
  const saved = await call({ do:"create-line", task:"Write the notes.", kind:"code", run:false });
  assert.deepEqual([saved.started, saved.agent], [false, spare.id]);
});

test("one level and no further: a part has no pass, and an orchestrator's Line takes no work from another", async t => {
  const { service, orchestrator, project, call, doc, boss, cheap } = await setup(t);
  process.env.PENECHO_ORCH_PASS = "leaked"; process.env.PENECHO_ORCH_PROOF_KEY = "leaked";
  t.after(() => { delete process.env.PENECHO_ORCH_PASS; delete process.env.PENECHO_ORCH_PROOF_KEY; });
  const { started:[part] } = await call({ do:"decide", route:"delegate", why:"It stands on its own.", wait:20, parts:[{ task:"the parser", kind:"code", brief:"Write the parser." }] });
  const run = runs().findLast(r => r.line === part.line);
  assert.deepEqual([run.pass, run.key], ["", ""], "its run cannot call PenEcho, whatever PenEcho itself was started with");
  assert.equal(orchestrator.env(project, part.line, doc(part.line)), null);
  // Another orchestrator's Line, sent back work, could send it on again without end.
  const other = await orchestrator.start(project, { goal:"slow second job", preset:boss.id });
  for (const args of [{ do:"add-task", line:other.line, task:"x", kind:"code", agent:cheap.id }, { do:"start-line", line:other.line, kind:"code" }, { do:"retry", line:other.line }]) {
    await assert.rejects(call(args), { code:"ORCHESTRATOR_LINE" }, args.do);
  }
  // A Line that is a part stays one, even marked as an orchestrator by hand.
  service.writeDoc(project, part.line, F.setFront(service.readDoc(project, part.line), { orchestrator:"yes" }));
  assert.equal(orchestrator.env(project, part.line, doc(part.line)), null);
  assert.equal(orchestrator.brief(project, part.line, doc(part.line), { askText:"Refactor the importer" }), "");
  for (const args of [{ do:"create-line", task:"x", kind:"code", agent:cheap.id }, { do:"decide", route:"delegate", why:"x", parts:[{ task:"x", kind:"code", agent:cheap.id, brief:"x" }] }]) {
    await assert.rejects(orchestrator.call(project, args, { session:part.line }), { code:"SUB_AGENT" }, args.do);
  }
});

test("a part's agent is told it does one part, in few words; the person's own Ask on that Line is asked as any other", async t => {
  const { service, project, call, settled, job } = await setup(t);
  const { started:[part] } = await call({ do:"decide", route:"delegate", why:"It stands on its own.", wait:20, parts:[{ task:"the parser", kind:"code", brief:"Write the parser. Reply with its grammar." }] });
  const told = runs().findLast(r => r.line === part.line).prompt, said = /You do one part of a larger job\.[^\n]*/.exec(told)?.[0] || "";
  assert.match(told, /Write the parser\. Reply with its grammar\./);
  assert.match(said, new RegExp(`the whole job, only if your part is unclear: [^)]*lines/${job.line}\\.md`));
  assert.match(said, /Do this part yourself, your own way: start no other agents or sub-agents/);
  assert.match(said, /Check your part as the brief asks and no wider/);
  assert.match(said, /Answer with the result first/);
  assert.ok(said.replace(/\(the whole job[^)]*\)/, "").length < 640, "it costs a part little");
  assert.doesNotMatch(told, /Do it the way you normally would|stress-test|You are this project's orchestrator/);
  const fix = await call({ do:"add-task", line:part.line, task:"Fix the empty case.", kind:"code", wait:20 });
  assert.match(runs().findLast(r => r.line === part.line).prompt, /You do one part of a larger job/, "an added task too");
  assert.equal(fix.waited.done, true);
  await service.request(project, { topic:part.line, text:"Rename the parser", taskMode:"new" });
  await until(() => /Rename the parser/.test(runs().findLast(r => r.line === part.line)?.prompt || ""), "the person's Ask ran");
  await settled(part.line, "done");
  const own = runs().findLast(r => r.line === part.line).prompt;
  assert.match(own, /Do it the way you normally would/);
  assert.doesNotMatch(own, /You do one part of a larger job/);
});
