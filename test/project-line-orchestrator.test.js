"use strict";
require("./helpers/safety.js");
// Orchestrator (PE-613): Works that run at the same time on one Line, PenEcho's functions for the orchestrator, and its agent's pass.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const Knowledge = require("../src/server/project-lines/knowledge.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-orchestrator-test-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 10000) {
  const start = Date.now();
  for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); }
}
// Runs inside the stand-in orchestrator process, through its normal agent HTTP endpoint.
async function coordinateDiscussion() {
  const call = async (op, args = {}) => {
    const response = await fetch(process.env.PENECHO_ORCH_URL, { method:"POST",
      headers:{ "content-type":"application/json", "x-penecho-pass":process.env.PENECHO_ORCH_PASS },
      body:JSON.stringify({ do:op, ...args }) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    return data;
  };
  const { agents } = await call("agents");
  const first = agents.find(a => a.name === "Fake fast"), second = agents.find(a => a.name === "Other careful");
  const one = await call("create-line", { task:"fixture-answer delay=300: choose A", agent:first.id, kind:"research" });
  const line = one.line;
  const two = await call("add-task", { line, task:"fixture-answer delay=100: choose B", agent:second.id, kind:"research", parallel:true });
  if (!two.parallel) throw Error("The participants did not overlap.");
  const wait = async () => {
    const settled = await call("wait", { lines:[line], seconds:10 });
    if (!settled.done || settled.lines[0].status !== "done") throw Error("Discussion did not finish.");
  };
  await wait();
  const opinions = [];
  for (const assignment of [one, two]) {
    const reply = await call("work", { line, work:assignment.work });
    opinions.push(reply.result);
    await call("rate", { line, work:assignment.work, score:4, note:"Independent opinion" });
  }
  const synthesis = await call("add-task", { line, agent:first.id, kind:"chat",
    task:"fixture-answer Compare both saved opinions. " + opinions.join("\n") });
  await wait();
  const report = await call("work", { line, work:synthesis.work });
  await call("rate", { line, work:synthesis.work, score:5, note:"Compared both opinions" });
  return "Discussion complete. " + report.result;
}
// A stand-in agent like Claude Code. It keeps each run's prompt, folder and orchestrator env, and takes its time when told "slow".
const agentScript = path.join(temp, "agent.js"), runsLog = path.join(temp, "runs.jsonl");
fs.writeFileSync(agentScript, `
const fs = require("fs");
const say = o => console.log(JSON.stringify(o));
const coordinate = ${coordinateDiscussion.toString()};
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  const request = prompt.split("<request>\\n")[1]?.split("\\n</request>")[0] || prompt;
  fs.appendFileSync(${JSON.stringify(runsLog)}, JSON.stringify({ prompt, request, line:process.env.PENECHO_LINE, at:Date.now(), url:process.env.PENECHO_ORCH_URL || "", pass:process.env.PENECHO_ORCH_PASS || "", network:process.argv.includes("--network") }) + "\\n");
  say({ type:"system", subtype:"init", session_id:"s-" + Math.random().toString(36).slice(2) });
  const finish = async () => {
    if (request.includes("fixture-fail")) { process.stderr.write("Fixture participant failed"); process.exit(1); }
    const text = process.env.PENECHO_ORCH_PASS && request.includes("fixture-roundtable") ? await coordinate() : request.includes("fixture-answer") ? "Answer: " + request : "Finished the work.";
    say({ type:"assistant", message:{ content:[{ type:"text", text }] } }); say({ type:"result", subtype:"success", is_error:false, result:text }); process.exit(0);
  };
  setTimeout(() => finish().catch(error => { console.error(error.message); process.exit(1); }), Number(/delay=(\\d+)/.exec(request)?.[1]) || (/slow/i.test(request) ? 700 : 30));
});
`);
const runs = () => { try { return fs.readFileSync(runsLog, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch { return []; } };
function fakeAgents() {
  const one = id => ({ name:id, mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { network } = {}) => ({ command:launch.command, args:[...launch.prefixArgs, ...(network ? ["--network"] : [])] }) });
  return createAgents({ env:{ PATH:"" }, extra:{ fake:one("Fake"), other:one("Other") } });
}
let counter = 0;
function setup() {
  const directory = path.join(temp, `state-${++counter}`);
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ directory, agents:fakeAgents(), serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => s += d).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const { service, orchestrator } = lines;
  const project = service.store.create({ name:"Demo", docsPath:path.join(temp, `docs-${counter}`) });
  project.defaultAgent = "fake";
  const fast = service.presets.add({ agent:"fake", name:"Fake fast" }), other = service.presets.add({ agent:"other", name:"Other careful" });
  return { lines, service, orchestrator, project, fast, other };
}
const lineDoc = (service, project, slug) => F.parseLine(service.readDoc(project, slug));

test("a task added with parallel runs beside the Work already running on the Line, and the Line finishes after both", async () => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  const made = await orchestrator.call(project, { do:"create-line", task:"slow: build the page", agent:fast.id, kind:"code" });
  await until(() => service.runs.size === 1, "the first Work running");
  const added = await orchestrator.call(project, { do:"add-task", line:made.line, task:"slow: write its tests", agent:other.id, kind:"code", parallel:true });
  assert.equal(added.parallel, true);
  assert.equal(service.lanes.get(`${project.id}/${made.line}`)?.size, 1, "the second Work runs alongside");
  const state = service.stateOf(project).lines.find(l => l.id === made.line) || service.stateOf(project).backlog.find(l => l.id === made.line);
  assert.deepEqual(state.stations.filter(s => s.kind === "work").map(s => s.state), ["active", "active"]);
  await until(() => !service.runs.size && !service.lanes.size && lineDoc(service, project, made.line).status === "done", "both Works finished");
  const doc = lineDoc(service, project, made.line), works = doc.steps.filter(s => s.kind === "work");
  assert.deepEqual(works.map(s => [s.who, s.done, Boolean(s.off)]), [["fake", true, false], ["other", true, false]]);
  // The two child processes can write their fixture logs in either order.
  const started = runs().filter(r => r.line === made.line);
  assert.equal(started.length, 2);
  const [first, second] = works.map(w => started.find(r => r.prompt.includes(`Current PenEcho Work: ${w.label}.`)));
  assert.ok(first && second && Math.abs(second.at - first.at) < 600, "both assigned Works started together");
  assert.match(first.prompt, /<request>\nslow: build the page\n<\/request>/);
  assert.match(second.prompt, /<request>\nslow: write its tests\n<\/request>/);
  const stats = orchestrator.stats(project);
  assert.deepEqual(stats.rows.map(r => [r.agent, r.kind, r.works]).sort(), [["Fake fast", "code", 1], ["Other careful", "code", 1]]);
  lines.close();
});

test("stopping a Line stops the Works running alongside it too", async () => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  const made = await orchestrator.call(project, { do:"create-line", task:"slow: one", agent:fast.id, kind:"code" });
  await until(() => service.runs.size === 1, "running");
  await orchestrator.call(project, { do:"add-task", line:made.line, task:"slow: two", agent:other.id, kind:"code", parallel:true });
  await orchestrator.call(project, { do:"stop", line:made.line });
  assert.equal(service.runs.size + service.lanes.size, 0);
  const works = lineDoc(service, project, made.line).steps.filter(s => s.kind === "work");
  assert.deepEqual(works.map(s => s.off), ["stopped", "stopped"]);
  lines.close();
});

test("work returns the complete saved answer, including links and text beyond a summary", async t => {
  const { lines, service, orchestrator, project, fast } = setup();
  t.after(() => lines.close());
  const made = await orchestrator.call(project, { do:"create-line", task:"answer the question", agent:fast.id, kind:"research" });
  await until(() => lineDoc(service, project, made.line).status === "done", "answer saved");
  const rel = F.detailPath(made.line, made.work);
  const answer = `The complete answer.\n\n${"Supporting evidence. ".repeat(1200)}\n\n[Evidence](../../files/evidence.md)\n\nFinal recommendation.`;
  service.store.writeText(project, rel, F.setSection(service.store.readText(project, rel).text, "Result", answer));
  const result = await orchestrator.call(project, { do:"work", line:made.line, work:made.work });
  assert.equal(result.result, answer);
});

test("a queued agent task gets its own Work and waits for all parallel participants", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  const made = await orchestrator.call(project, { do:"create-line", task:"fixture-answer first delay=250", agent:fast.id, kind:"research" });
  const second = await orchestrator.call(project, { do:"add-task", line:made.line, task:"fixture-answer second delay=650", agent:other.id, parallel:true, kind:"research" });
  let steered = false;
  service.runs.get(service.key(project, made.line)).steer = async () => { steered = true; };
  const synthesis = await orchestrator.call(project, { do:"add-task", line:made.line, task:"compare the answers", agent:fast.id, kind:"chat" });
  assert.equal(steered, false, "an assigned task must not steer the current participant");
  assert.ok(synthesis.work && synthesis.work !== made.work && synthesis.work !== second.work);
  await until(() => lineDoc(service, project, made.line).status === "done", "participants and synthesis finished");
  const doc = lineDoc(service, project, made.line);
  assert.equal(doc.steps.filter(s => s.kind === "work").length, 3);
  const started = runs().filter(r => r.line === made.line).slice(-3);
  // The two participants start together; which one's agent is up first is not fixed.
  assert.deepEqual(started.slice(0, 2).map(r => r.request).sort(), ["fixture-answer first delay=250", "fixture-answer second delay=650"]);
  assert.equal(started[2].request, "compare the answers");
  const second650 = started.find(r => r.request.includes("delay=650"));
  assert.ok(started[2].at - second650.at >= 600, "synthesis starts after the last participant");
  assert.ok(doc.steps.filter(s => s.kind === "work").every(s => s.done && !s.off));
});

test("a Work is not launched again while its result is being saved", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  let release, saving;
  const held = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { saving = resolve; });
  const closeDetail = service.closeDetail.bind(service), launch = service.launch.bind(service), launches = [];
  let target = "", blocked = false;
  service.launch = (...args) => { launches.push(args[2].id); return launch(...args); };
  service.closeDetail = async (...args) => {
    if (args[2] === target && args[3]?.result && !blocked) { blocked = true; saving(); await held; }
    return closeDetail(...args);
  };
  t.after(async () => { release(); await until(() => !service.finishing.size, "result cleanup"); lines.close(); });
  const made = await orchestrator.call(project, { do:"create-line", task:"fixture-answer first delay=100", agent:fast.id, kind:"research" });
  target = made.work;
  await orchestrator.call(project, { do:"add-task", line:made.line, task:"fixture-answer second delay=300", agent:other.id, kind:"research", parallel:true });
  await entered;
  await service.next(project, made.line);
  assert.equal(launches.filter(id => id === made.work).length, 1, "finalization still owns the Work");
  release();
  await until(() => lineDoc(service, project, made.line).status === "done", "both answers saved");
  assert.equal(launches.length, 2);
});

test("wait sees a surviving participant after the first participant fails", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  const made = await orchestrator.call(project, { do:"create-line", task:"fixture-fail delay=100", agent:fast.id, kind:"code" });
  const second = await orchestrator.call(project, { do:"add-task", line:made.line, task:"fixture-answer survivor delay=500", agent:other.id, kind:"code", parallel:true });
  await until(() => !service.runs.size && service.lanes.size && !service.finishing.size, "first participant failed");
  const controller = new AbortController(); controller.abort();
  const waited = await orchestrator.call(project, { do:"wait", lines:[made.line] }, { signal:controller.signal });
  assert.equal(waited.done, false, "the remaining Work must still be counted");
  assert.equal(waited.lines[0].running, true);
  await until(() => !service.runs.size && !service.lanes.size && !service.finishing.size, "survivor finished");
  const doc = lineDoc(service, project, made.line);
  assert.equal(doc.status, "stopped");
  assert.equal(doc.steps.find(s => s.id === made.work).done, false, "the failed primary remains open for ordinary Retry");
  assert.equal((await orchestrator.call(project, { do:"work", line:made.line, work:made.work })).state, "error");
  assert.match(F.sectionText(service.store.readText(project, F.detailPath(made.line, made.work)).text, "Stopped"), /Fixture participant failed/);
  assert.equal(doc.steps.find(s => s.id === second.work).done, true);
  const result = (await orchestrator.call(project, { do:"work", line:made.line, work:second.work })).result;
  assert.equal(result, F.sectionText(service.store.readText(project, F.detailPath(made.line, second.work)).text, "Result"));
  assert.equal(F.resultOf(result).text, "Answer: fixture-answer survivor delay=500");
});

test("scores, prices and cost per Work feed the statistics; review waits for the person unless they asked", async () => {
  const { lines, service, orchestrator, project, fast } = setup();
  orchestrator.setPrice({ model:"fake-model", input:2, output:10, cached:0.2 });
  assert.deepEqual(orchestrator.prices().map(m => [m.model, m.input, m.output, m.cached]), [["fake-model", 2, 10, 0.2]]);
  assert.throws(() => orchestrator.setPrice({ model:"x", input:-1, output:1 }), /0 or more/);
  const made = await orchestrator.call(project, { do:"create-line", task:"do it", agent:fast.id, kind:"docs" });
  await until(() => lineDoc(service, project, made.line).status === "done", "finished");
  const view = await orchestrator.call(project, { do:"line", line:made.line });
  const work = view.steps.find(s => s.work);
  await orchestrator.call(project, { do:"rate", line:made.line, work:work.work, score:4, note:"clear" });
  await assert.rejects(orchestrator.call(project, { do:"rate", line:made.line, work:work.work, score:9 }), /1 \(unusable\) to 5/);
  for (const bad of [0.9, 5.1, "", null, "four"]) await assert.rejects(orchestrator.call(project, { do:"rate", line:made.line, work:work.work, score:bad }), /to one decimal/);
  // Between two steps: kept to one decimal, on the Line, in the record and in what goes to the Agent index and penecho.ai.
  assert.equal((await orchestrator.call(project, { do:"rate", line:made.line, work:work.work, score:4.26, note:"clear, one link unchecked" })).score, 4.3);
  assert.equal((await orchestrator.call(project, { do:"line", line:made.line })).steps.find(s => s.work).score, 4.3);
  assert.equal(orchestrator.scoresForLine(project, made.line)[0].score, 4.3);
  const row = orchestrator.stats(project).rows.find(r => r.kind === "docs");
  assert.equal(row.score, 4.3); assert.equal(row.scored, 1);
  const sentDay = new Date().toISOString().slice(0, 10), sentRow = orchestrator.agentDays(project, { from:"2020-01-01", to:"2099-12-31" }).find(r => r.scoreCount);
  assert.deepEqual([sentRow.scoreSum, sentRow.scoreCount], [4.3, 1], `the day's sum keeps the decimal (${sentDay})`);
  // The orchestrator Line's own rule: the person reviews.
  const session = await orchestrator.start(project, { goal:"Get the docs done", preset:fast.id });
  await until(() => lineDoc(service, project, session.line).status === "done", "orchestrator finished");
  await assert.rejects(orchestrator.call(project, { do:"review", line:made.line }, { session:session.line }), /reviews these Works themselves/);
  await orchestrator.call(project, { do:"review", line:made.line });
  assert.equal((await orchestrator.call(project, { do:"line", line:made.line })).steps.find(s => s.work).reviewed, true);
  // The Line it made shows under the orchestrator once it names it.
  service.writeDoc(project, made.line, F.setFront(service.readDoc(project, made.line), { "orchestrated by":lineDoc(service, project, session.line).front.id }));
  assert.deepEqual(orchestrator.sessions(project).map(x => [x.line, x.lines.map(l => l.line)]), [[session.line, [made.line]]]);
  // Its last finished Work is its report.
  assert.equal(orchestrator.sessions(project)[0].report, "Finished the work.");
  lines.close();
});

test("an orchestrator's run gets the brief and a pass that opens only its project's functions", async t => {
  const { lines, service, orchestrator, project, fast } = setup();
  const server = http.createServer((req, res) => lines.handle(req, res, new URL(req.url, "http://127.0.0.1")));
  t.after(() => { server.close(); lines.close(); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  orchestrator.setBase(`http://127.0.0.1:${server.address().port}/api/lines/orchestrate`);
  const before = runs().length;
  const session = await orchestrator.start(project, { goal:"Plan the release", preset:fast.id, reviewForYou:true });
  await until(() => runs().length > before, "the orchestrator ran");
  const run = runs().at(-1);
  assert.match(run.prompt, /You are this project's orchestrator/);
  assert.match(run.prompt, /review for them/);
  assert.doesNotMatch(run.prompt, /roundtable/i);
  // PE-1097, PE-1190: short work stays with it, the solo brief stays compact, PenEcho picks who does a part, and wait/rate rules arrive lazily.
  assert.match(run.prompt, /The person named agents or models, or asked for several agents \(views, a comparison, a round table, parts side by side\): do that, naming each part's agent/);
  assert.match(run.prompt, /anything done in about 5 minutes: do it yourself, with no decide call/);
  assert.match(run.prompt, /Longer work: first decide, then do\..*role:"decision".*naming no agent: PenEcho picks one about as good as you at under half your cost, and you keep the parts nobody fits/);
  assert.match(run.prompt, /Keep a change with its tests, parts under 5 minutes, and work that hangs on what you hold/);
  assert.match(run.prompt, /How to do it and how much to test is theirs/);
  // Nothing is priced or rated here, so it is told nobody fits.
  assert.match(run.prompt, /Decision: nobody free is rated above you\. Execution: nobody free fits, so it stays with you\./);
  assert.doesNotMatch(run.prompt, /Wait for Works to settle/, "wait/rating rules stay out of the solo brief");
  assert.match(run.prompt, /Report the job as one result and link what its parts made for the person/);
  assert.doesNotMatch(run.prompt, /your scores, and what is left/);
  assert.match(run.prompt, /Plan the release/);
  assert.ok(run.pass.length >= 32 && run.url.endsWith("/api/lines/orchestrate"));
  // Its functions are calls to this computer: a Codex sandbox with the network shut sent each one to an auto-reviewer, which refused a handoff (PE-658).
  assert.equal(run.network, true, "the orchestrator's run may reach PenEcho's functions");
  assert.ok(runs().slice(0, before).every(r => !r.network), "an ordinary Work keeps its sandbox's network shut");
  assert.equal(lineDoc(service, project, session.line).front.orchestrator, "yes");
  const post = (pass, body) => fetch(run.url, { method:"POST", headers:{ "content-type":"application/json", ...(pass ? { "x-penecho-pass":pass } : {}) }, body:JSON.stringify(body) });
  const help = await (await post(run.pass, { do:"help" })).json();
  assert.ok(help.functions.some(f => f.do === "create-line") && help.functions.some(f => f.do === "wait"));
  assert.ok(!help.kinds.includes("roundtable"));
  const agents = await (await post(run.pass, { do:"agents" })).json();
  assert.ok(agents.agents.some(a => a.id === fast.id && a.canRun));
  assert.equal((await post("nope", { do:"help" })).status, 403);
  assert.equal((await post("", { do:"overview" })).status, 403);
  // A Line it makes says who made it; its own Line is not one to put tasks on.
  const made = await (await post(run.pass, { do:"create-line", task:"write the notes", agent:fast.id, kind:"docs", run:false })).json();
  const child = lineDoc(service, project, made.line);
  assert.equal(child.front["orchestrated by"], lineDoc(service, project, session.line).front.id);
  const home = service.stateFor(project, "home");
  const parent = home.lines.find(l => l.id === session.line), sub = home.lines.find(l => l.id === made.line);
  assert.equal(parent.orchestratorRef, child.front["orchestrated by"]);
  assert.equal(sub.orchestratedBy, parent.orchestratorRef);
  assert.equal(made.started, false);
  assert.equal(made.work, "");
  assert.equal(child.steps.length, 1);
  assert.ok(F.isUnsent(child.steps[0]));
  assert.equal(made.ask, child.steps[0].id);
  const view = await (await post(run.pass, { do:"line", line:made.line })).json();
  assert.deepEqual(view.steps, [{ ask:"write the notes", step:made.ask, unsent:true, savedAgentId:fast.id, kind:"docs" }]);
  const own = await post(run.pass, { do:"add-task", line:session.line, task:"x" });
  assert.equal(own.status, 400);
  assert.deepEqual(await own.json(), { error:"Your own Line holds only your work. Start the first related task on a new Line with create-line, then add the others to that Line with add-task.", code:"OWN_LINE" });
  // The route it chose is kept on its Line and shown with its session.
  assert.equal((await post(run.pass, { do:"decide", route:"split", why:"" })).status, 400);
  assert.equal((await post(run.pass, { do:"decide", route:"split", why:"Notes are separate", parts:[{ task:"notes", agent:"nobody" }] })).status, 400);
  const decided = await (await post(run.pass, { do:"decide", route:"split", why:"The notes are\nseparate: a cheaper agent writes them.", parts:[{ task:"notes", kind:"docs", agent:fast.id }, { task:"plan", kind:"design", agent:"self" }] })).json();
  assert.deepEqual(decided, { route:"split", why:"The notes are separate: a cheaper agent writes them.", parts:2, delegated:1 });
  assert.equal(lineDoc(service, project, session.line).front["route why"], "The notes are separate: a cheaper agent writes them.");
  const planned = await (await post(run.pass, { do:"plan", kind:"docs" })).json();
  assert.equal(planned.kind, "docs");
  assert.deepEqual(planned.agents.filter(a => a.you).map(a => a.agent), [fast.id]);
  const waited = await (await post(run.pass, { do:"wait", lines:[session.line], seconds:5 })).json();
  assert.equal(waited.done, true);
  // The tab's own routes: its orchestrators, the record and prices.
  const tab = (rest, body) => fetch(`http://127.0.0.1:${server.address().port}/api/lines/projects/${project.id}/orchestrator${rest}`, body ? { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {});
  const listed = (await (await tab("")).json()).sessions;
  assert.deepEqual(listed.map(x => [x.line, x.route, x.routeWhy]), [[session.line, "split", "The notes are separate: a cheaper agent writes them."]]);
  assert.deepEqual((await (await tab("/prices", { model:"fake-model", input:1, output:4 })).json()).models.map(m => m.model), ["fake-model"]);
  const record = await (await tab("/stats")).json();
  assert.deepEqual(record.models.map(m => [m.model, m.output]), [["fake-model", 4]]);
  assert.ok(Array.isArray(record.rows));
  assert.deepEqual((await (await tab("/prices", { model:"fake-model", remove:true })).json()).models, []);
  server.close(); lines.close();
});

test("a saved orchestrator drives an ordinary roundtable through HTTP and returns both opinions for human review", async t => {
  const { lines, service, project, fast, orchestrator } = setup();
  const server = http.createServer((req, res) => lines.handle(req, res, new URL(req.url, "http://127.0.0.1")));
  t.after(() => { server.close(); lines.close(); });
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  orchestrator.setBase(base + "/orchestrate");
  const tab = base + `/projects/${project.id}/orchestrator`;
  const response = await fetch(tab, { method:"POST", body:JSON.stringify({ goal:"fixture-roundtable", preset:fast.id }) });
  assert.equal(response.status, 200);
  const { line } = await response.json();
  await until(() => ["done", "stopped"].includes(lineDoc(service, project, line).status), "orchestrator report", 30000);
  const { sessions } = await (await fetch(tab)).json();
  assert.equal(sessions[0].status, "done", sessions[0].why);
  assert.equal(sessions[0].lines.length, 1);
  const child = sessions[0].lines[0];
  assert.deepEqual(child.works.map(w => [w.agent, w.state, w.score, w.reviewed]), [
    ["fake", "done", 4, false], ["other", "done", 4, false], ["fake", "done", 5, false],
  ]);
  const full = await orchestrator.call(project, { do:"work", line, work:sessions[0].reportWork });
  assert.match(full.result, /Discussion complete/);
  assert.match(full.result, /choose A/);
  assert.match(full.result, /choose B/);
  const stats = await (await fetch(tab + "/stats?kind=research")).json();
  assert.deepEqual(stats.ratings.map(r => r.work).sort(), child.works.slice(0, 2).map(w => w.work).sort());
  assert.ok(stats.rows.every(r => r.works === 1 && r.preset));
  const ticket = { session:line }, target = { line:child.line, work:child.works[0].work };
  await assert.rejects(orchestrator.call(project, { do:"review", ...target }, ticket), { code:"PERSON_REVIEWS" });
  for (const view of ["home", "line"]) {
    const page = service.stateFor(project, view, { line:child.line });
    assert.equal(page.lines.find(l => l.id === child.line).stations.find(s => s.id === target.work).orchScore, 4);
  }
  const before = service.stateOf(project).rev;
  await orchestrator.call(project, { do:"rate", ...target, score:3, note:"Needs evidence" }, ticket);
  assert.notEqual(service.stateOf(project).rev, before);
  const [changed] = orchestrator.sessions(project)[0].lines[0].works;
  assert.equal(changed.score, 3); assert.equal(changed.note, "Needs evidence");
  const [latest] = orchestrator.stats(project).ratings;
  assert.equal(latest.work, target.work); assert.equal(latest.by, sessions[0].ref);
});

test("an orchestrator's Start moves an attached file into its Line's folder and links it in the Ask", async () => {
  const { lines, service, project, fast } = setup();
  const server = http.createServer((req, res) => lines.handle(req, res, new URL(req.url, "http://127.0.0.1")));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/lines/projects/${project.id}`;
  const upload = await fetch(`${base}/upload?dir=files/_incoming&name=brief.txt`, { method:"POST", body:"Read this brief." });
  assert.equal(upload.status, 200);
  const file = await upload.json();
  assert.equal(file.path, "files/_incoming/brief.txt");
  const res = await fetch(`${base}/orchestrator`, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ goal:"Use the brief", preset:fast.id, attachments:[file, { name:"no path" }, null, "brief.txt"] }) });
  assert.equal(res.status, 200);
  const { line } = await res.json();
  assert.equal(fs.existsSync(path.join(project.docsPath, "files", line, "brief.txt")), true, "the attachment is in the Line's folder");
  assert.equal(fs.existsSync(path.join(project.docsPath, "files/_incoming/brief.txt")), false, "it left the incoming folder");
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(service.readDoc(project, line), new RegExp(`\\[brief\\.txt\\]\\(\\.\\./files/${escaped}/brief\\.txt\\)`), "the Ask links it");
  server.close(); lines.close();
});

test("the tab's page draws what the server sends, escaped, and lists models with no price", () => {
  const vm = require("node:vm");
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const ctx = { console, ACT:{}, HOSTED:null, S:{ route:{ view:"orchestrator" }, presets:{ presets:[{ id:"p1", name:"Opus", agent:"claude", model:"claude-opus-5-5", available:true }] } },
    document:{ addEventListener() {} }, localStorage:{ getItem:() => "", setItem() {} }, queueMicrotask() {}, esc, ic:() => "", av:id => `<av ${esc(id)}>`,
    agentInfo:id => ({ name:id, mono:"Cl", color:"#123" }), allLines:p => p.lines || [], lineById:() => null, shownState:() => "working", STATE_TEXT:{ working:"Working" }, plainOut:s => s, $:() => null };
  vm.createContext(ctx);
  Object.assign(ctx, { navigator:{ platform:'Mac' } }); ctx.S.comp = {};
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/composer.js"), "utf8"), ctx);
  for (const file of ["orchestrator.js", "prices.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines", file), "utf8"), ctx);
  vm.runInContext(`ORCH.data = { sessions:[{ line:"plan", title:"<b>Plan</b>", status:"done", agent:"claude", report:"Made <i>2</i> Lines", reportWork:"w1", lines:[{ line:"a", ref:"PE-1", title:"Page", status:"working", works:[{ work:"w1", agent:"codex", state:"active" }, { work:"w2", agent:"claude", state:"done", reviewed:true }] }] }], tools:[] };
    ORCH.stats = { rows:[{ agent:"Codex", runner:"codex", model:"gpt-6", kind:"code", works:2, finished:2, failed:0, running:0, successRate:100, medianMinutes:4, tokensPerWork:12000, costPerWork:0.031, score:4.5, good:1, bad:0 }], models:[{ model:"gpt-6", input:1, output:8 }] };`, ctx);
  const sessions = vm.runInContext("orchSessionsHTML({ id:'x' })", ctx);
  assert.match(sessions, /&lt;b&gt;Plan&lt;\/b&gt;/);
  assert.match(sessions, /Made &lt;i&gt;2&lt;\/i&gt; Lines/);
  assert.match(sessions, /orch-work w-active/);
  assert.match(sessions, /orch-work w-done reviewed/);
  const record = vm.runInContext("orchRecordHTML()", ctx);
  assert.match(record, /\$0\.03/); assert.match(record, /4\.5/);
  assert.doesNotMatch(record, /Finished|100%/, "finish rate is not shown, even when an older server sends it");
  vm.runInContext(`PRICES.data = { models:[{ model:"gpt-6", input:1, output:8 }], agents:{}, missing:[{ model:"claude-opus-5-5", agents:[{ id:"p1", name:"Opus", agent:"claude" }] }] };`, ctx);
  assert.deepEqual([...vm.runInContext("orchUnpriced()", ctx)], ["claude-opus-5-5"]);
  assert.match(vm.runInContext("pricesHTML('stats')", ctx), /is-missing[^>]*data-price-model="claude-opus-5-5"/);
});

test("session activity identifies the owner's Work and shows a dependency only during its wait", async t => {
  const { lines, service, orchestrator, project, fast } = setup();
  t.after(() => lines.close());
  const { line } = await orchestrator.start(project, { goal:"fixture-answer coordinate delay=1100", preset:fast.id });
  const child = await orchestrator.call(project, { do:"create-line", task:"fixture-answer child delay=400", agent:fast.id, kind:"research" }, { session:line });
  const run = service.runs.get(service.key(project, line));
  run.now = "Reviewing test results";
  const waiting = orchestrator.call(project, { do:"wait", lines:[child.line] }, { session:line });
  const session = orchestrator.sessions(project).find(s => s.line === line);
  assert.equal(session.progress, run.now);
  assert.ok(session.lastActivityAt >= run.started);
  assert.equal(session.canStop, true);
  assert.deepEqual(session.waitingOn, [{ line:child.line, label:child.ref }]);
  assert.equal(session.lines.find(l => l.line === child.line).canStop, true);
  assert.equal((await waiting).done, true);
  const finished = orchestrator.sessions(project).find(s => s.line === line);
  assert.equal(finished.waitingOn, undefined);
  assert.equal(finished.canStop, false);
});

test("allocation statistics distinguish preset IDs, measured usage, model variants and old ratings", () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "costs-")), project = { id:"p" }, day = 86400000;
  const now = Date.now();
  const station = (n, preset, model, time, tokens) => ({ id:`work-${n}`, label:`Work ${n}`, kind:"work", state:"done", agent:"runner",
    savedAgent:"Writer", savedAgentId:preset, picked:{ model }, startedAt:time, tokens });
  const stations = [
    station(1, "a", "MODEL", now, { inputTokens:1000000, outputTokens:100000, cacheReadInputTokens:400000, cacheWriteInputTokens:100000 }),
    station(2, "a", "model", now - 40 * day, null),
    station(3, "b", "model-mini", now, { inputTokens:1000, outputTokens:0 }),
  ];
  const records = stations.map((s, i) => ({ id:String(i), project:"p", line:"line", work:s.id, kind:"docs", score:3 + i,
    at:new Date(s.startedAt).toISOString(), note:"Note " + i }));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const service = { stateOf:() => ({ lines:[{ id:"line", stations }] }) };
  const orch = createOrchestrator({ service, directory });
  orch.setPrice({ model:"model", input:2, output:10, cached:0.5, cacheWrite:4, source:"provider" });
  for (const price of [{ input:"", output:9 }, { input:null, output:0 }, { input:0, output:0, cached:-1 }]) {
    assert.throws(() => orch.setPrice({ model:"bad", ...price }), { code:"BAD_PRICE" });
  }
  const rows = orch.stats(project).rows;
  assert.deepEqual(rows.map(r => [r.preset, r.works, r.tokensPerWork, r.costPerWork]), [
    ["a", 2, 1100000, 2.6], ["b", 1, 1000, null],
  ]);
  assert.equal(orch.prices()[0].source, "provider");
  assert.deepEqual(orch.stats(project, { days:7, kind:"docs" }).ratings.map(r => r.work).sort(), ["work-1","work-3"]);
  assert.equal(orch.stats(project, { kind:"chat" }).ratings.length, 0);
});

test("plan weighs each preset's record and price against the coordinator's, and the brief carries it (PE-660)", () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "route-")), project = { id:"p" }, now = Date.now();
  const tokens = { inputTokens:1000000, outputTokens:100000 };
  const station = (n, preset, model, state = "done", took = "6 min") => ({ id:`work-${n}`, label:`Work ${n}`, kind:"work", state, took, agent:"runner",
    savedAgentId:preset, picked:{ model }, startedAt:now, tokens });
  const past = [station(1, "big", "big-model"), station(2, "big", "big-model"), station(3, "big", "big-model"),
    station(4, "small", "acme-small-2"), station(5, "small", "acme-small-2"), station(6, "small", "acme-small-2"),
    // Another model under the same preset id is not its record, nor an older version its alias once ran.
    station(7, "big", "big-model-2", "off"), { ...station(8, "small", "acme-small-1", "off"), startedAt:now - 10 * 86400000 }];
  const records = past.slice(0, 6).map((s, i) => ({ id:String(i), project:"p", line:"past", work:s.id, kind:"code", score:4, at:new Date(now).toISOString() }));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = [{ id:"big", name:"Big", agent:"runner", model:"big-model", effort:"high", available:true },
    { id:"small", name:"Small", agent:"runner", model:"small", available:true },
    { id:"new", name:"New", agent:"other", model:"new-model", available:true },
    { id:"off", name:"Off", agent:"runner", model:"small", available:true, allowDelegation:false }];
  let doc = "---\nid: PE-1\norchestrator: yes\n---\n\n# Job\n";
  const service = { stateOf:() => ({ lines:[{ id:"past", stations:past }, { id:"job", stations:[{ id:"work-1", kind:"work", state:"active", agent:"runner", savedAgentId:"big", picked:{ model:"big-model" } }] }] }),
    presets:{ list:() => ({ presets, default:"big" }), get:id => presets.find(p => p.id === id) },
    readDoc:() => doc, writeDoc:(_p, _s, md) => { doc = md; }, changed() {} };
  const orch = createOrchestrator({ service, directory });
  orch.setPrice({ model:"big-model", input:10, output:50 });
  orch.setPrice({ model:"acme-small-2", input:1, output:5 });
  orch.setPrice({ model:"new-model", input:2, output:10 });
  return orch.call(project, { do:"plan", kind:"code" }, { session:"job" }).then(async planned => {
    const by = Object.fromEntries(planned.agents.map(a => [a.agent, a]));
    assert.deepEqual(planned.agents.map(a => a.agent), ["small", "new", "big"]);
    assert.equal(planned.handoffCost, 0.6);
    assert.deepEqual([by.big.you, by.big.works, by.big.costPerWork, by.big.expectedCost, by.big.history], [true, 3, 15, 18.75, "same agent, model and effort"]);
    assert.equal("finishRate" in by.big, false, "finish rate is neither counted nor shown");
    // "small" is the same model as "acme-small-2", which is the price it is charged at.
    assert.deepEqual([by.small.cheaperThanYou, by.small.score, by.small.costPerWork, by.small.costBasis, by.small.expectedCost, by.small.kindBasis], [true, 4, 1.5, "measured", 2.48, "code"]);
    // No record yet: priced from a typical Work, never called cheaper on an unknown record.
    assert.deepEqual([by.new.history, by.new.works, by.new.costBasis, by.new.expectedCost, by.new.cheaperThanYou, by.new.tryIt], ["none", 0, "a typical Work at its price", 4.35, false, true]);
    assert.equal(by.small.tryIt, false, "a proven agent is cheaper, not on trial");
    assert.equal(by.off, undefined, "a preset that does not allow assignments is not offered");
    // The brief says who could take a part, and leaves scores and prices to PenEcho's choice (PE-1190).
    const text = orch.brief(project, "job", { front:{ orchestrator:"yes" } }, { askText:"Fix the failing login test" });
    assert.match(text, /For code work now\. Decision: nobody free is rated above you\. Execution: Small\./);
    assert.doesNotMatch(text, /\$\d|\d\/5/);
    const lookup = orch.brief(project, "job", { front:{ orchestrator:"yes", job:"model-prices" } });
    assert.doesNotMatch(lookup, /role:"decision"|Execution:/);
    await assert.rejects(orch.call(project, { do:"decide", route:"delegate", why:"x" }), { code:"NOT_SESSION" });
    for (const [route, parts] of [["split", [{ task:"a", agent:"self" }]], ["delegate", []], ["split", [{ task:"a", agent:"small" }, { task:"b", agent:"small" }]],
      ["self", [{ task:"a", agent:"small" }]], ["delegate", [{ task:"a", agent:"small" }, { task:"b", agent:"self" }]]]) {
      await assert.rejects(orch.call(project, { do:"decide", route, why:"x", parts }, { session:"job" }), { code:"BAD_ROUTE" }, `${route} ${JSON.stringify(parts)}`);
    }
    await assert.rejects(orch.call(project, { do:"decide", route:"delegate", why:"x", parts:[{ task:"a", agent:"off" }] }, { session:"job" }), { code:"BAD_AGENT" });
    const kept = await orch.call(project, { do:"decide", route:"self", why:"A two-minute fix.", kind:"code" }, { session:"job" });
    assert.deepEqual(kept, { route:"self", why:"A two-minute fix.", parts:0, delegated:0 });
    assert.match(doc, /^route: self$/m);
    assert.match(doc, /^route why: A two-minute fix\.$/m);
    await orch.call(project, { do:"decide", route:"split", why:"Two parts.", parts:[{ task:"the fix", kind:"code", agent:"self" }, { task:"the\nnotes: all", kind:"docs", agent:"small" }] }, { session:"job" });
    assert.match(doc, /^route parts: "the fix → you; the notes: all → Small"$/m);
    assert.equal(F.splitFront(doc).front["route parts"], "the fix → you; the notes: all → Small");
    // Without the coordinator's price a handoff is unknown, so no total and no comparison.
    orch.setPrice({ model:"big-model", remove:true });
    const unpriced = Object.fromEntries((await orch.call(project, { do:"plan", kind:"code" }, { session:"job" })).agents.map(a => [a.agent, a]));
    assert.deepEqual([unpriced.small.costPerWork, unpriced.small.expectedCost, unpriced.small.cheaperThanYou, unpriced.big.costPerWork], [1.5, null, false, null]);
  });
});

test("a recreated or renamed preset keeps its record: Statistics and plan go by agent, model and effort (PE-701)", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "same-setup-")), project = { id:"p" }, now = Date.now();
  const station = (n, extra) => ({ id:`work-${n}`, label:`Work ${n}`, kind:"work", state:"done", took:"5 min", agent:"claude", startedAt:now - (10 - n) * 60000, ...extra });
  const stations = [
    // The old local preset, the one recreated on Desktop under a new id and name, and one with the full model name: one setup.
    station(1, { savedAgent:"Claude Code · opus · high effort", savedAgentId:"old", picked:{ model:"claude-opus-5-5", effort:"high" } }),
    station(2, { savedAgent:"Claude Code · opus · high effort", savedAgentId:"old", picked:{ model:"claude-opus-5-5", effort:"high" }, state:"off" }),
    station(3, { savedAgent:"Opus careful", savedAgentId:"new", picked:{ model:"claude-opus-5-5", effort:"high" } }),
    station(4, { savedAgent:"Claude Code · claude-opus-5-5 · high effort", picked:{ model:"Claude-Opus-5-5", effort:"high" } }),
    // Another effort and another kind of job are other rows; Works with no model recorded stay with their saved agent.
    station(5, { savedAgentId:"new", picked:{ model:"claude-opus-5-5", effort:"medium" } }),
    station(6, { savedAgentId:"new", picked:{ model:"claude-opus-5-5", effort:"high" } }),
    station(7, { savedAgent:"Quick", savedAgentId:"q1" }), station(8, { savedAgent:"Slow", savedAgentId:"q2" }),
  ];
  const records = [{ id:"r", project:"p", line:"past", work:"work-6", kind:"review", score:5, at:new Date(now).toISOString() }];
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = [{ id:"new", name:"Opus careful", agent:"claude", model:"opus", effort:"high", available:true }];
  const service = { stateOf:() => ({ lines:[{ id:"past", stations }] }), readDoc:() => "", presets:{ list:() => ({ presets, default:"new" }), get:id => presets.find(p => p.id === id),
    nameFor:p => ["Claude Code", p.model, p.effort ? `${p.effort} effort` : ""].filter(Boolean).join(" · ") } };
  const orch = createOrchestrator({ service, directory });
  const rows = orch.stats(project).rows.map(r => [r.agent, r.effort, r.kind, r.works, r.preset, r.savedAgents]);
  assert.deepEqual(rows, [
    ["Claude Code · claude-opus-5-5 · high effort", "high", "", 5, "new", ["Claude Code · opus · high effort", "Opus careful"]],
    ["Claude Code · claude-opus-5-5 · medium effort", "medium", "", 1, "new", []],
    ["Quick", "", "", 1, "q1", []],
    ["Slow", "", "", 1, "q2", []],
  ]);
  // The recreated preset is judged on the whole setup's record, its own Works and the old preset's, not on its own two alone;
  // its record is its finished Works, not the one stopped.
  const [row] = (await orch.call(project, { do:"plan" })).agents;
  assert.deepEqual([row.agent, row.history, row.works], ["new", "same agent, model and effort", 4]);
  // A recreated preset on the agent's default model and effort counts the Works that chose neither, and not those that chose a model or effort.
  // Once the default moved on to a new model, the Works of the old default are another model's record.
  const plain = (n, extra) => ({ id:`work-${n}`, label:`Work ${n}`, kind:"work", state:"done", took:"5 min", agent:"codex", startedAt:now, ...extra });
  stations.push(plain(20, { savedAgentId:"gone", selected:{ model:"", effort:"" }, picked:{ model:"gpt-6.2-astra", effort:"medium" } }),
    plain(21, { picked:{ model:"gpt-6-astra" }, startedAt:now - 60000 }), plain(22, { savedAgentId:"gone", selected:{ model:"", effort:"" }, picked:{ model:"gpt-6.2-astra" }, state:"off" }),
    plain(23, { selected:{ model:"gpt-6.2-sol", effort:"" }, picked:{ model:"gpt-6.2-sol" } }), plain(24, { selected:{ model:"", effort:"xhigh" }, picked:{ model:"gpt-6.2-astra", effort:"xhigh" } }));
  presets.push({ id:"codex", name:"Codex", agent:"codex", model:"", effort:"", available:true });
  const codex = (await orch.call(project, { do:"plan" })).agents.find(a => a.agent === "codex");
  assert.deepEqual([codex.history, codex.works, codex.model], ["same agent, default model and effort", 1, "gpt-6.2-astra"]);
});

test("plan smooths short score records and leaves out Works cut off by a limit or a closing PenEcho (PE-660)", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "route-gaps-")), project = { id:"p" }, now = Date.now();
  const tokens = { inputTokens:1000000, outputTokens:100000 };
  // Each preset thinks at its own effort, so each keeps its own record.
  const efforts = { lucky:"low", poor:"medium", cut:"high", halted:"xhigh" };
  const station = (n, preset, extra = {}) => ({ id:`work-${n}`, label:`Work ${n}`, kind:"work", state:"done", took:"5 min", agent:"runner",
    savedAgentId:preset, picked:{ model:"m", effort:efforts[preset] }, startedAt:now, tokens, ...extra });
  const past = [
    station(1, "lucky"), station(2, "poor"),
    // Two usage limits, one PenEcho restart and one stop: none of them is counted, only its finished Work.
    station(3, "cut", { state:"off", stopWhy:"limit" }), station(4, "cut", { state:"error", stopWhy:"limit" }),
    station(5, "cut", { state:"error", why:"PenEcho closed while this was running. Retry to continue from the saved conversation and files." }),
    station(6, "cut", { state:"off", stopWhy:"error" }), station(7, "cut"),
    station(8, "twice", { picked:{ model:"m2", effort:"max" } }), station(9, "twice", { picked:{ model:"m2", effort:"max" } }),
    // Stopped twice by the person, finished once: the stops say nothing about it.
    station(10, "halted"), station(11, "halted", { state:"off", stopWhy:"stopped" }), station(12, "halted", { state:"off" }),
  ];
  const records = [{ id:"1", project:"p", line:"past", work:"work-1", kind:"code", score:5, at:new Date(now).toISOString() },
    { id:"2", project:"p", line:"past", work:"work-2", kind:"code", score:2, at:new Date(now).toISOString() },
    { id:"8", project:"p", line:"past", work:"work-8", kind:"code", score:2, at:new Date(now).toISOString() },
    { id:"9", project:"p", line:"past", work:"work-9", kind:"code", score:1, at:new Date(now).toISOString() },
    // A score given to a Work its provider's limit cut off is left out too.
    { id:"3", project:"p", line:"past", work:"work-3", kind:"code", score:1, at:new Date(now).toISOString() }];
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = ["lucky", "poor", "cut", "halted"].map(id => ({ id, name:id, agent:"runner", model:"m", effort:efforts[id], available:true }));
  presets.push({ id:"twice", name:"twice", agent:"runner", model:"m2", effort:"max", available:true });
  presets.push({ id:"dear", name:"dear", agent:"big", model:"dear-model", available:true, allowDelegation:false });
  const job = { id:"job", stations:[{ id:"work-1", kind:"work", state:"active", agent:"big", savedAgentId:"dear", picked:{ model:"dear-model" } }] };
  let lines = [{ id:"past", stations:past }];
  const service = { stateOf:() => ({ lines }), readDoc:() => "---\nid: PE-1\norchestrator: yes\n---\n\n# Job\n", presets:{ list:() => ({ presets, default:"lucky" }), get:id => presets.find(p => p.id === id) } };
  const orch = createOrchestrator({ service, directory });
  const by = Object.fromEntries((await orch.call(project, { do:"plan" })).agents.map(a => [a.agent, a]));
  // One 5/5 and one 2/5 start from four imagined Works at 4/5: quality 21/25 and 18/25, not 1 and 0.4.
  assert.deepEqual([by.lucky.score, by.poor.score], [5, 2]);
  const plan = createOrchestrator({ service, directory });
  plan.setPrice({ model:"m", input:1, output:5 });
  const priced = Object.fromEntries((await plan.call(project, { do:"plan" })).agents.map(a => [a.agent, a]));
  // cost 1.5 ÷ quality with no coordinator, so no handoff.
  assert.deepEqual([priced.lucky.expectedCost, priced.poor.expectedCost], [1.79, 2.08]);
  assert.deepEqual([priced.cut.works, priced.cut.scored, "finishRate" in priced.cut, "interrupted" in priced.cut], [1, 0, false, false]);
  lines = [...lines, job];
  plan.setPrice({ model:"dear-model", input:20, output:100 });
  plan.setPrice({ model:"m2", input:1, output:5 });
  // A coordinator on a dear model: the new cheap agents are worth a trial, one poor rating or stopped Works included, but not after two poor ratings.
  const dear = Object.fromEntries((await plan.call(project, { do:"plan" }, { session:"job" })).agents.map(a => [a.agent, a]));
  assert.deepEqual([dear.lucky.tryIt, dear.poor.tryIt, dear.cut.tryIt, dear.twice.tryIt], [true, true, true, false]);
  assert.deepEqual([dear.halted.works, dear.halted.tryIt], [1, true]);
});

test("project management functions update the real Line and only delegated review marks it reviewed", async t => {
  const { lines, service, project, fast, orchestrator } = setup();
  t.after(() => lines.close());
  const call = (op, args, session = "") => orchestrator.call(project, { do:op, ...args }, { session });
  const coordinator = await orchestrator.start(project, { goal:"Manage completed work", preset:fast.id, reviewForYou:true });
  await until(() => lineDoc(service, project, coordinator.line).status === "done", "coordinator finished");
  const child = await call("create-line", { task:"Complete this work", agent:fast.id, kind:"code" }, coordinator.line);
  await until(() => lineDoc(service, project, child.line).status === "done", "child finished");
  const target = { line:child.line };
  await call("review", { ...target, work:child.work }, coordinator.line);
  assert.equal((await call("line", target)).steps.find(s => s.work).reviewed, true);
  await call("todo", { ...target, todo:true });
  assert.ok((await call("overview", {})).lines.find(l => l.line === child.line).todo);
  await call("rename", { ...target, title:"Checked work" });
  await call("status", { ...target, to:"pin" });
  assert.equal(lineDoc(service, project, child.line).front.pinned, "yes");
  await call("status", { ...target, to:"archive" });
  assert.equal((await call("line", target)).status, "closed");
  await call("status", { ...target, to:"reopen" });
  assert.equal((await call("line", target)).title, "Checked work");
  // Topics are hidden in every project for now (PE-1066): help leaves rebuild-topics out and the call is refused.
  assert.ok(!(await call("help", {})).functions.some(f => f.do === "rebuild-topics"));
  await assert.rejects(call("rebuild-topics", {}), { code:"TOPICS_OFF" });
  Knowledge.TOPICS.hidden = false;
  t.after(() => { Knowledge.TOPICS.hidden = true; });
  assert.ok((await call("help", {})).functions.some(f => f.do === "rebuild-topics"));
  const rebuilt = await call("rebuild-topics", {});
  assert.equal(lineDoc(service, project, rebuilt.slug).front.job, "build-topics");
});

test("jobs added for later are saved as unsent Asks, survive replay and reopening, and run with full Orchestrator logic when sent", async t => {
  const { lines, service, project, fast, other, orchestrator } = setup();
  t.after(() => lines.close());
  const usageKeys = [];
  const origUsage = service.onUsage;
  service.onUsage = key => { usageKeys.push(key); origUsage?.(key); };
  const server = http.createServer((req, res) => lines.handle(req, res, new URL(req.url, "http://127.0.0.1")));
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/lines/projects/${project.id}/orchestrator/save`;
  const attachment = { path:"files/_incoming/brief.txt", name:"brief.txt", type:"text/plain" };
  service.store.writeBytes(project, attachment.path, Buffer.from("Brief"));
  const request = { goal:"First saved job", preset:fast.id, attachments:[attachment], make:{ kind:"slides" }, requestId:require("node:crypto").randomUUID() };
  const save = async () => {
    const response = await fetch(url, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify(request) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const later = { deferred:true };
  const [one, replay] = await Promise.all([save(), save()]);
  const two = await orchestrator.start(project, { ...request, goal:"Second saved job", attachments:[], requestId:require("node:crypto").randomUUID() }, later);
  const autoSaved = await orchestrator.start(project, { goal:"Fix the failing login test", preset:"auto", requestId:require("node:crypto").randomUUID() }, later);
  assert.equal(one.status, "waiting");
  assert.equal(two.status, "waiting");
  assert.equal(autoSaved.status, "waiting");
  assert.equal(replay.line, one.line);
  assert.notEqual(one.line, two.line);
  await assert.rejects(orchestrator.start(project, request), { code:"CONFLICT" });
  assert.equal(service.runs.size, 0);
  assert.ok(service.store.exists(project, `files/${one.line}/brief.txt`));
  // Saved like a normal Line "Not sent" Ask: no unstarted Work 1 placeholder, with savedAgentId kept on the Ask.
  const oneDoc = lineDoc(service, project, one.line);
  assert.equal(oneDoc.front.why, F.NOT_SENT);
  assert.equal(oneDoc.front.orchestrator, "yes");
  assert.equal(oneDoc.steps.length, 1);
  assert.equal(F.isUnsent(oneDoc.steps[0]), true);
  assert.equal(oneDoc.asks[0].make.kind, "slides");
  assert.equal(oneDoc.front["auto agent"], undefined);
  // PenEcho Auto defers selection until send time rather than stamping stale auto metadata at save time.
  const autoDoc = lineDoc(service, project, autoSaved.line);
  assert.equal(autoDoc.steps.length, 1);
  assert.equal(F.isUnsent(autoDoc.steps[0]), true);
  assert.equal(autoDoc.front["auto agent"], undefined);
  const sessions = orchestrator.sessions(project);
  const oneSession = sessions.find(s => s.line === one.line);
  const autoSession = sessions.find(s => s.line === autoSaved.line);
  assert.deepEqual([oneSession.unsent, oneSession.unsentStep, oneSession.unsentPreset, oneSession.agent], [true, "ask-1", fast.id, "fake"]);
  assert.deepEqual([autoSession.unsent, autoSession.unsentStep, autoSession.unsentPreset, autoSession.agent], [true, "ask-1", "auto", ""]);
  assert.equal(usageKeys.filter(k => k === "orchestrator-job").length, 0, "saving for later does not count as started yet");

  // Reopen PenEcho and verify saved unsent jobs survive intact, then send via run-unsent (same path as pic2 & Orchestrator Start).
  lines.close();
  const reopened = createProjectLines({ directory:service.directory, agents:fakeAgents(), serviceOptions:{ autoWatch:false } });
  t.after(() => reopened.close());
  const p = reopened.service.store.get(project.id);
  const reopenedUsage = [];
  const prevUsage = reopened.service.onUsage;
  reopened.service.onUsage = key => { reopenedUsage.push(key); prevUsage?.(key); };
  p.autoWake = false; reopened.service.store.save();
  assert.deepEqual(await reopened.orchestrator.start(p, request, later), { line:one.line, status:"waiting" });
  const beforeRuns = runs().length;
  // Sending from pic2 / Orchestrator card runs with full Orchestrator brief, env, network, make, attachments, and saved preset even with autoWake=false.
  const sentOne = await reopened.service.act(p, one.line, "run-unsent", { step:"ask-1" });
  assert.equal(sentOne.ok, true);
  assert.equal(sentOne.agent, "fake");
  await until(() => lineDoc(reopened.service, p, one.line).status === "done", "sending saved job finishes");
  const oneRun = runs().slice(beforeRuns).find(r => r.line === one.line);
  assert.ok(oneRun, "started agent run recorded");
  assert.match(oneRun.prompt, /You are this project's orchestrator|You are on an Orchestrator Line/);
  assert.match(oneRun.prompt, /They chose slides/);
  assert.equal(reopened.service.detailOf(p, F.detailPath(one.line, "work-1")).front["saved agent id"], fast.id);
  assert.equal(reopenedUsage.filter(k => k === "orchestrator-job").length, 1);
  assert.equal((await reopened.orchestrator.start(p, request, later)).status, "done");

  // Sending a PenEcho Auto saved job resolves autoPreset at send time, records auto frontmatter, and returns auto rationale.
  const sentAuto = await reopened.service.act(p, autoSaved.line, "run-unsent", { step:"ask-1", preset:"auto" });
  assert.equal(sentAuto.ok, true);
  assert.ok(sentAuto.auto?.agent, "returns PenEcho Auto choice on send");
  assert.equal(sentAuto.auto.kind, "code");
  await until(() => lineDoc(reopened.service, p, autoSaved.line).status === "done", "auto saved job finishes");
  const afterAuto = lineDoc(reopened.service, p, autoSaved.line);
  assert.ok(afterAuto.front["auto agent"], "records auto agent on send");
  assert.equal(afterAuto.front["auto kind"], "code");
  assert.equal(reopenedUsage.filter(k => k === "orchestrator-job").length, 2);

  // Starting the remaining saved job with a different preset picked from pic2 overrides the saved preset cleanly, while leaving others untouched before start.
  assert.equal(lineDoc(reopened.service, p, two.line).status, "waiting");
  await reopened.service.act(p, two.line, "run-unsent", { step:"ask-1", agent:other.agent, preset:other.id });
  await until(() => lineDoc(reopened.service, p, two.line).status === "done", "overridden saved job finishes");
  assert.equal(reopened.service.detailOf(p, F.detailPath(two.line, "work-1")).front["saved agent id"], other.id);
  assert.equal(lineDoc(reopened.service, p, two.line).front["auto agent"], undefined);

  // Direct service.begin() on a single-unsent-Ask Orchestrator Line also runs the same path.
  const three = await reopened.orchestrator.start(p, { goal:"Third saved job", preset:fast.id, requestId:require("node:crypto").randomUUID() }, later);
  await reopened.service.begin(p, three.line);
  await until(() => lineDoc(reopened.service, p, three.line).status === "done", "begin() starts saved Orchestrator job");
  assert.equal(reopened.service.detailOf(p, F.detailPath(three.line, "work-1")).front["saved agent id"], fast.id);

  // On a Git code project, sending a saved Orchestrator job sets area: Code and base just like starting from the Orchestrator inputbox.
  const { execFileSync } = require("node:child_process");
  const codeDir = path.join(temp, `orch-git-${Date.now()}`);
  fs.mkdirSync(codeDir, { recursive:true });
  execFileSync("git", ["init", "-b", "main"], { cwd:codeDir, stdio:"ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd:codeDir, stdio:"ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd:codeDir, stdio:"ignore" });
  fs.writeFileSync(path.join(codeDir, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd:codeDir, stdio:"ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd:codeDir, stdio:"ignore" });
  const gitProject = reopened.service.store.create({ name:"GitDemo", docsPath:path.join(temp, `git-docs-${Date.now()}`), codePath:codeDir });
  gitProject.defaultAgent = "fake";
  const gitSaved = await reopened.orchestrator.start(gitProject, { goal:"Refactor auth helper", preset:fast.id, requestId:require("node:crypto").randomUUID() }, later);
  assert.equal(lineDoc(reopened.service, gitProject, gitSaved.line).status, "waiting");
  await reopened.service.act(gitProject, gitSaved.line, "run-unsent", { step:"ask-1" });
  await until(() => lineDoc(reopened.service, gitProject, gitSaved.line).status === "done", "git saved orchestrator job finishes");
  const gitDoc = lineDoc(reopened.service, gitProject, gitSaved.line);
  assert.equal(gitDoc.front.area, "Code");
  assert.equal(gitDoc.front.base, "main");
});

test("retrying or replaying one Start keeps one Line, attachment and initial Work", async t => {
  const { lines, service, project, orchestrator, fast } = setup();
  t.after(() => lines.close());
  const file = { path:"files/_incoming/sketch (1).png", name:"sketch (1).png", type:"image/png" };
  service.store.writeBytes(project, file.path, Buffer.from("a fixture image"));
  const request = { goal:"Handle one brief", preset:fast.id, make:{ kind:'slides', sub:'investor' }, attachments:[file], requestId:require("node:crypto").randomUUID() };
  const start = orchestrator.start(project, request);
  const replay = orchestrator.start(project, request);
  await assert.rejects(orchestrator.start(project, { ...request, goal:"Changed" }), { code:"CONFLICT" });
  await assert.rejects(orchestrator.start(project, { ...request, make:{ kind:'card' } }), { code:'CONFLICT' });
  const [a,b] = await Promise.all([start,replay]);
  assert.equal(a.line, b.line);
  const [row] = orchestrator.sessions(project);
  assert.equal(row.requestId, request.requestId, "the page knows the job it sent by its request id (PE-830)");
  assert.equal(row.askedAt, F.labelTime(lineDoc(service, project, a.line).asks[0].when));
  await until(() => lineDoc(service, project, a.line).status === "done", "one Work finished");
  assert.equal(orchestrator.sessions(project)[0].askedAt, row.askedAt, "running and finishing never move it");
  const ask = lineDoc(service, project, a.line).asks[0];
  assert.equal(ask.make.sub, 'investor');
  assert.match(runs().find(run => run.line === a.line).prompt, /They chose slides in the investor template/);
  for (const link of [`![sketch](../files/${a.line}/sketch (1).png)`, `![sketch](../files/${a.line}/sketch \\(1\\).png)`]) {
    assert.equal(F.isLinkOnly(link), true);
    assert.equal(F.linksIn(link)[0].href, ask.pictures[0].href);
  }
  assert.equal(ask.pictures[0].href, `../files/${a.line}/sketch (1).png`);
  assert.ok(service.store.exists(project, ask.pictures[0].href.slice(3)));
  lines.close();
  const reopened = createProjectLines({ directory:service.directory, agents:fakeAgents(), serviceOptions:{ autoWatch:false } });
  t.after(() => reopened.close());
  const again = await reopened.orchestrator.start(reopened.service.store.get(project.id), request);
  assert.equal(again.line, a.line);
  assert.equal(again.status, "done");
  assert.equal(reopened.service.store.scan(project).topics.length, 1);
  assert.equal(lineDoc(reopened.service, project, a.line).steps.filter(F.AGENT_LIKE).length, 1);
  const next = await reopened.orchestrator.start(project, { ...request, attachments:[], requestId:require("node:crypto").randomUUID() });
  assert.notEqual(next.line, a.line);
  await until(() => lineDoc(reopened.service, project, next.line).status === "done", "intentional second job finished");
});

test("concurrent AI price lookups share one Work across clients and can be run again after stopping", async t => {
  const { lines, service, project, orchestrator, fast, other } = setup();
  t.after(() => lines.close());
  const lookup = (goal, preset = fast.id) => ({ purpose:"model-prices", goal, preset, requestId:require("node:crypto").randomUUID() });
  const first = lookup("slow: look up prices"), second = lookup("look up a different list", other.id);
  const [a, b] = await Promise.all([orchestrator.start(project, first), orchestrator.start(project, second)]);
  assert.equal(a.line, b.line);
  assert.equal(lineDoc(service, project, a.line).front.job, "model-prices");
  assert.equal(lineDoc(service, project, a.line).steps.filter(F.AGENT_LIKE).length, 1);
  const third = lookup("another tab");
  assert.equal((await orchestrator.start(project, third)).line, a.line);
  assert.deepEqual(orchestrator.stats(project, { kind:"docs" }).activePriceLookup, { line:a.line, status:"working" });
  assert.equal(service.store.scan(project).topics.length, 1);
  const otherProject = service.store.create({ name:"Independent prices", docsPath:path.join(temp, `prices-${project.id}`) });
  assert.equal(orchestrator.stats(otherProject).activePriceLookup, null);
  const separate = await orchestrator.start(otherProject, lookup("fixture-fail: price lookup"));
  await until(() => lineDoc(service, otherProject, separate.line).status === "stopped", "failed lookup stopped");
  assert.equal(orchestrator.stats(otherProject).activePriceLookup, null);
  await assert.rejects(orchestrator.start(project, { ...second, goal:"changed intent" }), { code:"CONFLICT" });
  await orchestrator.call(project, { do:"stop", line:a.line });
  assert.equal(orchestrator.stats(project).activePriceLookup, null);
  lines.close();
  const reopened = createProjectLines({ directory:service.directory, agents:fakeAgents(), serviceOptions:{ autoWatch:false } });
  t.after(() => reopened.close());
  const api = reopened.orchestrator, p = reopened.service.store.get(project.id);
  for (const request of [first, second, third]) assert.equal((await api.start(p, request)).line, a.line);
  const fresh = await api.start(p, lookup("intentional refresh"));
  assert.notEqual(fresh.line, a.line);
  await until(() => lineDoc(reopened.service, p, fresh.line).status === "done", "new lookup finished");
  assert.equal(api.stats(p).activePriceLookup, null);
  assert.equal(reopened.service.store.scan(p).topics.length, 2);
});

test("Statistics recognizes a legacy active price lookup from its original Ask", async t => {
  const { lines, service, project, orchestrator, fast } = setup();
  t.after(() => lines.close());
  const goal = "Look up the current list prices, in US$ per million tokens (input, output, and cached input where the provider has one), for: slow. Use the providers' own pricing pages. Save each with set-price, putting the page you read in source. Do not create Lines for this. Reply with a short table of what you saved.";
  const legacy = await orchestrator.start(project, { goal, preset:fast.id });
  assert.equal(lineDoc(service, project, legacy.line).front.job, undefined);
  const active = orchestrator.stats(project).activePriceLookup;
  assert.equal(active?.line, legacy.line);
  const replay = await orchestrator.start(project, { purpose:"model-prices", preset:fast.id, goal:"refresh prices" });
  assert.equal(replay.line, legacy.line);
  await until(() => lineDoc(service, project, legacy.line).status === "done", "legacy lookup finished");
  assert.equal(orchestrator.stats(project).activePriceLookup, null);
});

test("attachment batch preflight and rollback preserve staged files and Canvas companions", async t => {
  const { lines, service, project, orchestrator, fast } = setup(); t.after(() => lines.close());
  const stage = name => ({ path:`files/_incoming/${name}`, name });
  const first = stage("scan.png"), second = stage("report.txt"), comp = stage("scan.penecho.json");
  const requestId = require("node:crypto").randomUUID();
  const start = () => orchestrator.start(project, { goal:"Read both files", preset:fast.id, requestId, attachments:[first,second] });
  for (const f of [first, comp]) service.store.writeBytes(project, f.path, Buffer.from(f.name));
  await assert.rejects(start(), { code:"MISSING_UPLOAD", current:second.path });
  assert.ok(service.store.exists(project, first.path));
  service.store.writeBytes(project, second.path, Buffer.from(second.name));
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(from).endsWith("_incoming/scan.penecho.json")) throw Error("simulated companion move failure");
    return rename(from, to);
  };
  try { await assert.rejects(start(), /companion move failure/); }
  finally { fs.renameSync = rename; }
  for (const f of [first, comp, second]) assert.ok(service.store.exists(project, f.path));
  const write = service.writeDoc.bind(service);
  service.writeDoc = () => { throw Error("simulated before Line write"); };
  await assert.rejects(start(), /before Line write/);
  for (const f of [first, comp, second]) assert.equal(fs.readFileSync(path.join(project.docsPath, f.path), "utf8"), f.name);
  assert.equal(service.store.scan(project).topics.length, 0);
  service.writeDoc = (...args) => { write(...args); service.writeDoc = write; throw Error("simulated after Line write"); };
  await assert.rejects(start(), /after Line write/);
  const { line } = await start();
  await until(() => lineDoc(service, project, line).status === "done", "committed job");
  for (const f of [first, comp, second]) assert.equal(fs.readFileSync(path.join(project.docsPath, "files", line, f.name), "utf8"), f.name);
});

test("a session names a report from an earlier Work and a newest Work that was stopped before it reported (PE-639)", async t => {
  const { lines, service, orchestrator, project } = setup();
  t.after(() => lines.close());
  const { slug } = await service.createTopic(project, { text:"Which agents will it pick?", agent:"fake", kinds:["ask", "work"], start:false });
  service.writeDoc(project, slug, F.setFront(service.readDoc(project, slug), { orchestrator:"yes" }));
  service.writeDoc(project, slug, F.updateSteps(service.readDoc(project, slug), steps => {
    const work = steps.find(s => s.kind === "work");
    F.closeStep(work, { slug, took:"3 min", summary:"Saved presets first." });
    steps.push(F.askStep({ words:"Let people choose which presets it may use.", when:F.nowLabel() }), { ...F.workStep({ who:"fake" }), done:true, off:"stopped" });
  }));
  service.writeDoc(project, slug, F.setFront(service.readDoc(project, slug), { status:"done", why:null }));
  service.states.delete(project.id);
  const [session] = orchestrator.sessions(project);
  assert.equal(session.reportWork, "work-1");
  assert.equal(session.reportLabel, "Work 1");
  assert.equal(session.stoppedWork, "Work 2");

  const doc = service.parsedDoc(project, slug);
  for (const step of doc.steps.filter(F.AGENT_LIKE)) service.setReviewed(project, slug, doc, step, true);
  service.states.delete(project.id);
  const reviewedLine = service.stateOf(project).lines.find(line => line.id === slug);
  const lastWork = reviewedLine.stations.find(step => step.id === "work-2");
  assert.deepEqual([reviewedLine.status, lastWork.state, lastWork.off, lastWork.reviewed], ["done", "off", "stopped", true]);
  const [reviewed] = orchestrator.sessions(project);
  assert.equal(Object.hasOwn(reviewed, "stoppedWork"), false);
  assert.equal(reviewed.reportWork, "work-1", "reviewing the newest Work does not remove earlier reports");

  service.setReviewed(project, slug, doc, doc.steps.find(step => step.id === "work-2"), false);
  service.writeDoc(project, slug, F.setFront(service.readDoc(project, slug), { status:"closed" }));
  service.states.delete(project.id);
  const [archived] = orchestrator.sessions(project);
  assert.equal(archived.archived, true);
  assert.equal(Object.hasOwn(archived, "stoppedWork"), false);
});

test("the person's own rating combines with the coordinator's in routing, Statistics and the Agents list (PE-706)", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "combined-")), project = { id:"p" }, now = Date.now();
  const station = (n, preset, extra = {}) => ({ id:`work-${n}`, label:`Work ${n}`, kind:"work", state:"done", took:"4 min", agent:"runner",
    savedAgent:preset, savedAgentId:preset, picked:{ model:"m", effort:preset }, startedAt:now - n * 1000, ...extra });
  const stations = [
    // 4/5 and good: (4 + 2 × 4.5) / 3 = 4.3. 4/5 and not good: (4 + 2 × 2) / 3 = 2.7.
    station(1, "liked", { rating:"good", ratingNote:"Exactly right", tokens:{ inputTokens:1000, outputTokens:200 } }),
    station(2, "disliked", { rating:"bad", tokens:{ inputTokens:3000, outputTokens:0 } }),
    // Only the person rated it; only the coordinator; neither; one that failed.
    station(3, "liked", { rating:"good", tokens:{ inputTokens:2000, outputTokens:400 } }),
    station(4, "disliked", { tokens:{ inputTokens:5000, outputTokens:0 } }),
    station(5, "liked", { state:"error" }),
  ];
  const records = [["work-1", 4, "Solid"], ["work-2", 4, ""], ["work-4", 3, ""]].map(([work, score, note], i) =>
    ({ id:String(i), project:"p", line:"line", work, kind:"code", score, note, at:new Date(now).toISOString() }));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = ["liked", "disliked"].map(id => ({ id, name:id, agent:"runner", model:"m", effort:id, available:true }));
  const service = { stateOf:() => ({ lines:[{ id:"line", code:"PE-9", title:"A job", stations }] }), presets:{ list:() => ({ presets, default:"liked" }), get:id => presets.find(p => p.id === id) } };
  const orch = createOrchestrator({ service, directory });
  orch.setPrice({ model:"m", input:10, output:50 });

  const by = Object.fromEntries((await orch.call(project, { do:"plan" })).agents.map(a => [a.agent, a]));
  // liked: 4.33 and 4.5 → 4.4 from 2 ratings; disliked: 2.67 and 3 → 2.8. The person's verdict moves the routing.
  assert.deepEqual([by.liked.score, by.liked.scored, by.disliked.score, by.disliked.scored], [4.4, 2, 2.8, 2]);
  assert.ok(by.liked.expectedCost < by.disliked.expectedCost);

  // Statistics keeps kinds apart: work-3 has no coordinator record, so it stays uncategorized (kind "").
  const row = id => orch.stats(project).rows.find(r => r.preset === id && r.kind === "code");
  assert.deepEqual([row("liked").score, row("liked").rating, row("liked").rated, row("liked").good], [4, 4.3, 1, 1]);
  assert.deepEqual([row("disliked").score, row("disliked").rating, row("disliked").bad], [3.5, 2.8, 1]);

  const record = orch.agentRecord(project), agents = record.agents;
  const liked = agents.find(a => a.agent.startsWith("liked") || a.savedAgents.includes("liked") || a.effort === "liked");
  assert.deepEqual([liked.works, liked.running, "successRate" in liked, liked.rating, liked.rated, liked.score, liked.good],
    [3, 0, false, 4.4, 2, 4, 2]);
  // Average tokens and cost per Work, over the Works that reported usage: (1,200 + 2,400) / 2 and $0.02 + $0.04.
  assert.deepEqual([liked.tokensPerWork, liked.tokensKnown, liked.costPerWork, liked.cost], [1800, 2, 0.03, 0.06]);
  // The detail opens on a rating per kind of job: work-1 was a code record; uncategorized work-3 and work-5 stay in totals without an "other" kind.
  assert.deepEqual(liked.byKind, [
    { kind:"code", works:1, running:0, rating:4.3, rated:1, score:4, scored:1, good:1, bad:0 },
  ]);
  const disliked = agents.find(a => a !== liked);
  // 4/5 and not good (2.7) with 3/5: 2.833, shown as 2.8.
  assert.deepEqual(disliked.byKind, [
    { kind:"code", works:2, running:0, rating:2.8, rated:2, score:3.5, scored:2, good:0, bad:1 },
  ]);
  assert.equal("list" in liked, false, "the detail does not send every Work");
  assert.equal("shown" in record, false);
});

test("the Agents list gives an agent's rating by kind of job (PE-706)", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "kinds-")), project = { id:"p" }, now = Date.now();
  const station = (n, extra = {}) => ({ id:`work-${n}`, label:`Work ${n}`, kind:"work", state:"done", agent:"runner",
    savedAgentId:"one", picked:{ model:"m" }, startedAt:now - n * 1000, ...extra });
  const stations = [
    station(1, { rating:"good" }), station(2, { rating:"good" }), station(3, { state:"error" }),
    station(4, { rating:"bad" }), station(5), station(6, { rating:"good" }),
  ];
  const rows = [["work-1", "review", 4], ["work-2", "review"], ["work-3", "review"], ["work-4", "fix", 2], ["work-5", "research"], ["work-6", "research"]];
  const records = rows.map(([work, kind, score], i) => ({ id:String(i), project:"p", line:"line", work, kind, ...(score ? { score } : {}), at:new Date(now).toISOString() }));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = [{ id:"one", name:"one", agent:"runner", model:"m", available:true }];
  const service = { stateOf:() => ({ lines:[{ id:"line", code:"PE-9", title:"A job", stations }] }), presets:{ list:() => ({ presets, default:"one" }), get:id => presets.find(p => p.id === id) } };
  const [agent] = createOrchestrator({ service, directory }).agentRecord(project).agents;
  // The expanded agent shows one rating per kind, from all its Works, never the Works themselves.
  assert.deepEqual([agent.works, agent.running, agent.rating, agent.rated, agent.score, agent.scored, agent.good, agent.bad],
    [6, 0, 3.3, 2, 2, 1, 1, 1]);
  assert.deepEqual(agent.byKind, [
    { kind:"research", works:2, running:0, rating:4.5, rated:1, score:null, scored:0, good:1, bad:0 },
    { kind:"code", works:1, running:0, rating:2, rated:1, score:2, scored:1, good:0, bad:1 },
  ]);
});

test("one poor Work does not shut out an agent: a short record starts from its family's, and one thumbs-down is 2/5, not 1 (PE-660)", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "occasional-")), project = { id:"p" }, now = Date.now();
  const tokens = { inputTokens:200000, outputTokens:20000 };
  const station = (n, preset, effort, extra = {}) => ({ id:`work-${n}`, label:`Work ${n}`, kind:"work", state:"done", took:"5 min", agent:"codex",
    savedAgentId:preset, picked:{ model:"astra", effort }, startedAt:now - n * 1000, tokens, ...extra });
  // Four Works at high effort, one scored 4/5 by a coordinator and one the person found not good; the same model at xhigh has a long, good record.
  const stations = [station(1, "high", "high"), station(2, "high", "high", { rating:"bad" }), station(3, "high", "high"), station(4, "high", "high"),
    station(5, "xhigh", "xhigh"), station(6, "xhigh", "xhigh"), station(7, "xhigh", "xhigh"), station(8, "xhigh", "xhigh")];
  // The coordinator, on a dear model, has its own record: three Works scored 4/5.
  for (const n of [11, 12, 13]) stations.push({ id:`work-${n}`, label:`Work ${n}`, kind:"work", state:"done", took:"9 min", agent:"big", savedAgentId:"dear", picked:{ model:"dear-model" }, startedAt:now - n * 1000, tokens });
  const records = [["work-1", 4], ["work-5", 5], ["work-6", 4], ["work-7", 5], ["work-8", 5], ["work-11", 4], ["work-12", 4], ["work-13", 4]].map(([work, score], i) =>
    ({ id:String(i), project:"p", line:"past", work, kind:"code", score, at:new Date(now).toISOString() }));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = ["high", "xhigh"].map(id => ({ id, name:id, agent:"codex", model:"astra", effort:id, available:true }));
  presets.push({ id:"dear", name:"dear", agent:"big", model:"dear-model", available:true, allowDelegation:false });
  const job = { id:"job", stations:[{ id:"work-1", kind:"work", state:"active", agent:"big", savedAgentId:"dear", picked:{ model:"dear-model" } }] };
  const lines = [{ id:"past", stations }, job];
  const service = { stateOf:() => ({ lines }), readDoc:() => "", presets:{ list:() => ({ presets, default:"high" }), get:id => presets.find(p => p.id === id) } };
  const orch = createOrchestrator({ service, directory });
  orch.setPrice({ model:"astra", input:1, output:5 });
  orch.setPrice({ model:"dear-model", input:30, output:150 });
  const plan = async () => Object.fromEntries((await orch.call(project, { do:"plan" }, { session:"job" })).agents.map(a => [a.agent, a]));
  let by = await plan();
  // Not good is 2/5: 4 and 2 make 3.0, not 2.5. xhigh's stronger record (4.75) does not start it higher than 4/5:
  // quality (4 + 2 + 4 × 4) / 6 / 5 = 0.73. cost $0.30 ÷ 0.73 = $0.41, plus the dear coordinator's handoff of 40,000 + 4,000 tokens, $1.80.
  // Within 0.1 of the coordinator's quality 0.8, so it stays cheaper than the coordinator.
  assert.deepEqual([by.high.score, by.high.scored, by.high.expectedCost, by.high.cheaperThanYou], [3, 2, 2.21, true]);
  // A Work cut off by a provider's limit counts neither way, its rating included; nor does one the person stopped.
  stations.push(station(9, "high", "high", { state:"off", stopWhy:"limit", rating:"bad" }), station(10, "high", "high", { state:"off", stopWhy:"stopped" }));
  by = await plan();
  assert.deepEqual([by.high.score, by.high.scored, by.high.works, by.high.cheaperThanYou], [3, 2, 4, true]);
  // A second poor Work is a pattern: (4 + 2 + 2 + 16) / 7 / 5 = 0.69, and it is no longer called cheaper.
  stations[2].rating = "bad";
  by = await plan();
  assert.deepEqual([by.high.score, by.high.scored, by.high.cheaperThanYou], [2.7, 3, false]);
});

test("a family is the same model at other efforts only, and a preset on the default follows the model the default ran last (PE-660)", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "family-")), project = { id:"p" }, now = Date.now();
  const tokens = { inputTokens:200000, outputTokens:20000 };
  let n = 0;
  const station = (preset, extra = {}) => ({ id:`work-${++n}`, label:`Work ${n}`, kind:"work", state:"done", took:"5 min", agent:"codex", savedAgentId:preset,
    selected:{ model:"astra", effort:"high" }, picked:{ model:"astra", effort:"high" }, startedAt:now - (100 - n) * 1000, tokens, ...extra });
  const xhigh = { selected:{ model:"astra", effort:"xhigh" }, picked:{ model:"astra", effort:"xhigh" } };
  // p: 3 code Works at 5 and 3 review Works at 1, all at high; 3 Works of the same model at xhigh at 4.
  const stations = [station("p"), station("p"), station("p"), station("p"), station("p"), station("p"), station("x", xhigh), station("x", xhigh), station("x", xhigh)];
  const kinds = ["code", "code", "code", "review", "review", "review", "other", "other", "other"], marks = [5, 5, 5, 1, 1, 1, 4, 4, 4];
  // d is on the agent's default at high: its two older Works chose no model and ran astra; it then had sol saved, and its newest two ran sol.
  stations.push(station("d", { selected:undefined }), station("d", { selected:undefined }),
    station("d", { selected:{ model:"sol", effort:"high" }, picked:{ model:"sol", effort:"high" } }), station("d", { selected:{ model:"sol", effort:"high" }, picked:{ model:"sol", effort:"high" } }));
  const records = marks.map((score, i) => ({ id:String(i), project:"p", line:"past", work:`work-${i + 1}`, kind:kinds[i], score, at:new Date(now).toISOString() }));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = [{ id:"p", name:"p", agent:"codex", model:"astra", effort:"high", available:true }, { id:"d", name:"d", agent:"codex", model:"", effort:"high", available:true }];
  const service = { stateOf:() => ({ lines:[{ id:"past", stations }] }), readDoc:() => "", presets:{ list:() => ({ presets, default:"p" }), get:id => presets.find(p => p.id === id) } };
  const orch = createOrchestrator({ service, directory });
  orch.setPrice({ model:"astra", input:1, output:5 });
  // For code, p starts from xhigh's 4, not from its own review Works at 1: $0.30 ÷ ((15 + 16) / 35) = $0.34.
  const code = (await orch.call(project, { do:"plan", kind:"code" })).agents.find(a => a.agent === "p");
  assert.deepEqual([code.kindBasis, code.works, code.expectedCost], ["code", 3, 0.34]);
  // d's sol Works were its saved model, not the default: its record is the two astra Works.
  const d = (await orch.call(project, { do:"plan" })).agents.find(a => a.agent === "d");
  assert.deepEqual([d.model, d.works], ["astra", 2]);
});

test("a new agent's cost comes from its own app's Works, unknown totals sort by cost, and a preset on the default effort has a family (PE-660)", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "own-cost-")), project = { id:"p" }, now = Date.now();
  let n = 0;
  const station = (agent, preset, extra = {}) => ({ id:`work-${++n}`, label:`Work ${n}`, kind:"work", state:"done", took:"5 min", agent, savedAgentId:preset, startedAt:now - n * 1000, ...extra });
  // Claude Works read ten times the tokens of Codex Works: a new Codex preset is not priced as if it read them.
  const stations = [1, 2, 3, 4, 5].map(() => station("claude", "c", { picked:{ model:"opus" }, tokens:{ inputTokens:10000000, outputTokens:100000 } }));
  stations.push(...[1, 2, 3].map(() => station("codex", "xh", { selected:{ model:"", effort:"low" }, picked:{ model:"astra", effort:"low" }, tokens:{ inputTokens:1000000, outputTokens:100000 } })));
  // A preset on Codex's default model and effort: one Work of its own, scored 5; the same model with an effort chosen was scored 2 three times.
  stations.push(station("codex", "def", { selected:{ model:"", effort:"" }, picked:{ model:"astra", effort:"medium" }, tokens:{ inputTokens:1000000, outputTokens:100000 } }));
  const records = [["work-6", 2], ["work-7", 2], ["work-8", 2], ["work-9", 5]].map(([work, score], i) => ({ id:String(i), project:"p", line:"past", work, kind:"code", score, at:new Date(now).toISOString() }));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const presets = [{ id:"nw", name:"nw", agent:"codex", model:"sol", available:true }, { id:"def", name:"def", agent:"codex", model:"", effort:"", available:true },
    { id:"c", name:"c", agent:"claude", model:"opus", available:true }, { id:"lead", name:"lead", agent:"big", model:"lead-model", available:true, allowDelegation:false }];
  const job = { id:"job", stations:[{ id:"work-1", kind:"work", state:"active", agent:"big", savedAgentId:"lead", picked:{ model:"lead-model" } }] };
  const service = { stateOf:() => ({ lines:[{ id:"past", stations }, job] }), readDoc:() => "", presets:{ list:() => ({ presets, default:"nw" }), get:id => presets.find(p => p.id === id) } };
  const orch = createOrchestrator({ service, directory });
  for (const model of ["sol", "astra", "opus"]) orch.setPrice({ model, input:1, output:5 });
  const plan = async () => (await orch.call(project, { do:"plan" }, { session:"job" })).agents;
  let rows = await plan();
  const by = Object.fromEntries(rows.map(a => [a.agent, a]));
  // Codex's typical Work: 1,000,000 in and 100,000 out at $1/$5 is $1.50, not the project's median of $10.50.
  assert.deepEqual([by.nw.costBasis, by.nw.costPerWork], ["a typical Work at its price", 1.5]);
  // def's family, the same model with an effort chosen, is weaker: it starts from 2, so (5 + 4 × 2) / 5 / 5 = 0.52.
  assert.deepEqual([by.def.works, by.def.score], [1, 5]);
  // The coordinator's price is unknown, so no totals: the cheapest per Work come first (def and nw tie at $1.50), not the most used (c).
  assert.deepEqual(rows.map(a => a.expectedCost), [null, null, null, null]);
  assert.deepEqual(rows.filter(a => !a.you).map(a => a.agent), ["def", "nw", "c"]);
  orch.setPrice({ model:"lead-model", input:1, output:5 });
  rows = await plan();
  const priced = Object.fromEntries(rows.map(a => [a.agent, a]));
  assert.ok(Math.abs(priced.def.expectedCost - (1.5 / 0.52 + 0.06)) < 0.01, `def ${priced.def.expectedCost}`);
  // Its own Works whose Ask chose an effort are its family too, not its default-effort record.
  stations.push(...[1, 2, 3].map(() => station("codex", "def", { selected:{ model:"", effort:"xhigh" }, picked:{ model:"astra", effort:"xhigh" }, tokens:{ inputTokens:1000000, outputTokens:100000 } })));
  records.push(...stations.slice(-3).map((w, i) => ({ id:`x${i}`, project:"p", line:"past", work:w.id, kind:"code", score:2, at:new Date(now).toISOString() })));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const own = (await createOrchestrator({ service, directory }).call(project, { do:"plan" }, { session:"job" })).agents.find(a => a.agent === "def");
  assert.deepEqual([own.works, own.score, own.scored], [1, 5, 1]);
});

test("orchestrator brief, handoff guidance, and help provide objective 1-5 rating rules (PE-721 / PE-1097)", async () => {
  const { createOrchestrator, KIND_RULES, RATING_RULES, handoffGuidance } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "rating-rules-")), project = { id:"p" };
  const service = { stateOf:() => ({ lines:[] }), readDoc:() => "", presets:{ list:() => ({ presets:[], default:"" }), get:() => null } };
  const orch = createOrchestrator({ service, directory });
  assert.equal(RATING_RULES.length, 7);
  const helped = await orch.call(project, { do:"help" });
  assert.deepEqual(helped.ratingRules, RATING_RULES);
  assert.deepEqual(helped.kinds, ["code", "chat", "design", "research", "docs"]);
  assert.deepEqual(helped.kindRules, KIND_RULES);
  assert.match(helped.kindRules.design, /canvas\/prototypes/);
  assert.match(helped.kindRules.design, /3D object\/modeling work such as Blender/);
  assert.match(helped.functions.find(f => f.do === "rate").does, /skip rate for review tasks/);
  // Solo brief stays small (PE-1097); wait/check/rate rules arrive lazily via handoffGuidance on the first delegation reply.
  const text = orch.brief(project, "job", { front:{ orchestrator:"yes" } });
  const guide = handoffGuidance(false);
  assert.doesNotMatch(text, /rate by finishing the job well/, "solo brief omits the rating rubric until delegation");
  assert.match(guide, /by the reviewer's standard: rate by finishing the job well .*no bonus or penalty.*outcome 60%.*verification 20%.*safety & scope 20%.*Simple clean tasks score 5\. Judge/);
  assert.doesNotMatch(guide, /Minus 1|false claims|reportMismatch/);
  assert.doesNotMatch(guide, /RATING_STANDARD/);
  const standard = guide.match(/rate by finishing the job well.*?Simple clean tasks score 5/)[0];
  assert.ok(RATING_RULES[0].includes(standard));
  // Under 100 tokens: words and punctuation count stays under 100 as a strict guard.
  assert.ok(standard.match(/[A-Za-z]+|\d|[^\sA-Za-z\d]/g).length < 100, "the standard in handoff guidance stays under 100 tokens");
  // The example in help follows the unified 60/20/20 formula without report-mismatch deductions.
  assert.match(RATING_RULES.at(-1), /outcome 4, verification 4\.5, safety 5 is 4\.3.*outcome 5 with N\/A verification and safety is 5/);
  assert.doesNotMatch(RATING_RULES.join("\n"), /deduct 1\.0|minus 1\.0/);
  assert.match(guide, /except reviews/);
  assert.match(text, /canvas\/prototypes/);
  assert.match(text, /3D\/Blender/);
  assert.doesNotMatch(text, /"other"/);
  assert.doesNotMatch(guide, /your own included|same bar to your own Work/);
  assert.match(guide, /cut off from outside with no usable output is not rated/);
  assert.match(guide, /Judge the inspected output and diff, not self-claims/);
});

test("sub-agent assignments require and normalize a valid kind across create-line, add-task and start-line (PE-721)", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  service.presets.update(fast.id, { effort:"high" });
  const call = (op, args) => orchestrator.call(project, { do:op, ...args });

  await assert.rejects(call("create-line", { task:"check logs", agent:fast.id }), { code:"BAD_KIND" });
  await assert.rejects(call("create-line", { task:"check logs", agent:fast.id, kind:"bugfix" }), { code:"BAD_KIND" });

  const created = await call("create-line", { task:"fixture-answer explain the logs", agent:fast.id, kind:" Chat " });
  assert.equal(created.kind, "chat");
  await until(() => lineDoc(service, project, created.line).status === "done", "created Line finished");

  await assert.rejects(call("add-task", { line:created.line, task:"patch bug", agent:other.id }), { code:"BAD_KIND" });
  await assert.rejects(call("add-task", { line:created.line, task:"patch bug", agent:other.id, kind:"invalid" }), { code:"BAD_KIND" });

  const added = await call("add-task", { line:created.line, task:"fixture-answer patch bug", agent:other.id, kind:" CODE " });
  assert.equal(added.kind, "code");
  await until(() => lineDoc(service, project, created.line).status === "done", "added task finished");

  // Saved Ask from create-line(run:false) carries its kind and effort into start-line.
  const deferred = await call("create-line", { task:"fixture-answer write guide", agent:fast.id, kind:"Docs", run:false });
  assert.equal(deferred.kind, "docs");
  await assert.rejects(call("start-line", { line:deferred.line, kind:"nope" }), { code:"BAD_KIND" });
  for (const kind of ["review", "fix", "test", "other", ""]) {
    await assert.rejects(call("create-line", { task:"new task", agent:fast.id, kind }), { code:"BAD_KIND" });
    await assert.rejects(call("add-task", { line:created.line, task:"new task", agent:fast.id, kind }), { code:"BAD_KIND" });
    await assert.rejects(call("start-line", { line:deferred.line, kind }), { code:"BAD_KIND" });
  }
  const started = await call("start-line", { line:deferred.line });
  assert.equal(started.kind, "docs");
  await until(() => lineDoc(service, project, deferred.line).status === "done", "deferred Line finished");

  // A user-saved unsent Ask without held.kind requires kind on start-line.
  await service.saveUnsent(project, { topic:deferred.line, text:"fixture-answer verify build", taskMode:"new" });
  await assert.rejects(call("start-line", { line:deferred.line, agent:other.id }), { code:"BAD_KIND" });
  const explicit = await call("start-line", { line:deferred.line, agent:other.id, kind:"Chat" });
  assert.equal(explicit.kind, "chat");
  await until(() => lineDoc(service, project, deferred.line).status === "done", "explicitly typed Ask finished");

  const byKey = new Map(orchestrator.records(project).map(r => [`${r.line}/${r.work}`, r]));
  assert.equal(byKey.get(`${created.line}/${created.work}`).kind, "chat");
  assert.equal(byKey.get(`${created.line}/${added.work}`).kind, "code");
  assert.equal(byKey.get(`${deferred.line}/${started.work}`).kind, "docs");
  assert.equal(byKey.get(`${deferred.line}/${started.work}`).effort, "high");
  assert.equal(byKey.get(`${deferred.line}/${explicit.work}`).kind, "chat");

  // One Line has no kind of its own; each task (Work) on that Line carries its own kind in line/work/sessions views.
  assert.equal(lineDoc(service, project, created.line).front.kind, undefined);
  const view = await call("line", { line:created.line });
  assert.equal(view.kind, undefined);
  const workSteps = view.steps.filter(s => s.work);
  assert.deepEqual(workSteps.map(s => [s.work, s.kind]), [[created.work, "chat"], [added.work, "code"]]);
  assert.equal((await call("work", { line:created.line, work:added.work })).kind, "code");

  // Saved unsent Ask carries its task kind in line view before start-line runs it.
  const queuedLine = await call("create-line", { task:"fixture-answer sketch UI", agent:fast.id, kind:"design", run:false });
  const queuedView = await call("line", { line:queuedLine.line });
  assert.equal(queuedView.kind, undefined);
  assert.equal(queuedView.steps.find(s => s.step === queuedLine.ask)?.kind, "design");

  // Multi-kind feature Line under an Orchestrator session exposes each Work's own kind on sessions().
  const coord = await orchestrator.start(project, { goal:"fixture-answer ship feature", preset:fast.id });
  await until(() => lineDoc(service, project, coord.line).status === "done", "coord finished");
  const feature = await orchestrator.call(project, { do:"create-line", task:"fixture-answer research options", agent:fast.id, kind:"research" }, { session:coord.line });
  await until(() => lineDoc(service, project, feature.line).status === "done", "feature research finished");
  const ui = await orchestrator.call(project, { do:"add-task", line:feature.line, task:"fixture-answer design UI", agent:other.id, kind:"design" }, { session:coord.line });
  await until(() => lineDoc(service, project, feature.line).status === "done", "feature design finished");
  const impl = await orchestrator.call(project, { do:"add-task", line:feature.line, task:"fixture-answer implement feature", agent:fast.id, kind:"code" }, { session:coord.line });
  await until(() => lineDoc(service, project, feature.line).status === "done", "feature code finished");
  const check = await orchestrator.call(project, { do:"add-task", line:feature.line, task:"fixture-answer write tests", agent:other.id, kind:"code" }, { session:coord.line });
  await until(() => lineDoc(service, project, feature.line).status === "done", "feature test finished");
  const chat = await orchestrator.call(project, { do:"add-task", line:feature.line, task:"fixture-answer independent rollout discussion", agent:other.id, kind:"chat" }, { session:coord.line });
  await until(() => lineDoc(service, project, feature.line).status === "done", "feature discussion finished");

  const sessionCard = orchestrator.sessions(project).find(s => s.line === coord.line);
  const childCard = sessionCard.lines.find(l => l.line === feature.line);
  assert.equal(childCard.kind, undefined);
  assert.deepEqual(childCard.works.map(w => [w.work, w.kind]), [
    [feature.work, "research"], [ui.work, "design"], [impl.work, "code"], [check.work, "code"], [chat.work, "chat"],
  ]);

  const helped = await call("help", {});
  const byName = Object.fromEntries(helped.functions.map(f => [f.do, f]));
  assert.match(byName["create-line"].args, /\bkind\b(?!\?)/);
  assert.match(byName["create-line"].does, /A Line itself has no kind/);
  assert.match(byName["add-task"].args, /\bkind\b(?!\?)/);
  assert.match(byName.rate.args, /\bkind\?/);
  const prompt = orchestrator.brief(project, created.line, { front:{ orchestrator:"yes" } });
  assert.match(prompt, /Kinds: code, chat, design \(UI\/UX, visual, canvas\/prototypes, 3D\/Blender\), research, docs/);
  assert.match(orchestrator.handoffGuidance(false), /Lines have no type of their own; give each task a required kind/);
});

test("decide records coordinator Work kind and rate preserves or sets kind on unrecorded Works (PE-721)", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "decide-kind-")), project = { id:"p" };
  let doc = "---\nid: PE-99\norchestrator: yes\n---\n\n# Job\n";
  const presets = [
    { id:"coord", name:"Coord", agent:"codex", model:"astra", effort:"high", available:true },
    { id:"sub", name:"Sub", agent:"claude", model:"sonnet", effort:"medium", available:true },
  ];
  const jobWork = { id:"work-1", label:"Work 1", kind:"work", state:"active", agent:"codex", savedAgent:"Coord", savedAgentId:"coord", picked:{ model:"astra", effort:"high" } };
  const delegateWork = { id:"work-1", label:"Work 1", kind:"work", state:"active", agent:"codex", savedAgent:"Coord", savedAgentId:"coord", picked:{ model:"astra", effort:"high" } };
  const userWork = { id:"work-1", label:"Work 1", kind:"work", state:"done", agent:"claude", savedAgent:"Sub", savedAgentId:"sub", picked:{ model:"sonnet", effort:"medium" } };
  const reviewWork = { id:"work-2", label:"Review 1", kind:"review", state:"done", agent:"claude", savedAgent:"Sub", savedAgentId:"sub", picked:{ model:"sonnet", effort:"medium" } };
  const lines = [
    { id:"job", stations:[jobWork] },
    { id:"delegated-job", stations:[delegateWork] },
    { id:"user-line", stations:[userWork, reviewWork] },
  ];
  const service = {
    stateOf:() => ({ lines }),
    readDoc:() => doc,
    writeDoc:(_p, _s, md) => { doc = md; },
    changed() {},
    onChange() {},
    presets:{ list:() => ({ presets, default:"coord" }), get:id => presets.find(p => p.id === id) },
  };
  const orch = createOrchestrator({ service, directory });

  // Missing or invalid kind on decide is rejected, and parts never inherit a top-level Line kind.
  await assert.rejects(orch.call(project, { do:"decide", route:"self", why:"Quick fix." }, { session:"job" }), { code:"BAD_KIND" });
  await assert.rejects(orch.call(project, { do:"decide", route:"self", why:"Quick fix.", kind:"bugfix" }, { session:"job" }), { code:"BAD_KIND" });
  await assert.rejects(orch.call(project, { do:"decide", route:"split", why:"Two parts.", parts:[{ task:"a", agent:"self" }, { task:"b", kind:"chat", agent:"sub" }] }, { session:"job" }), { code:"BAD_KIND" });
  await assert.rejects(orch.call(project, { do:"decide", route:"split", why:"Two parts.", kind:"code", parts:[{ task:"a", agent:"self" }, { task:"b", kind:"chat", agent:"sub" }] }, { session:"job" }), { code:"BAD_KIND" });
  await assert.rejects(orch.call(project, { do:"decide", route:"delegate", why:"One part.", kind:"research", parts:[{ task:"a", agent:"sub" }] }, { session:"job" }), { code:"BAD_KIND" });
  await assert.rejects(orch.call(project, { do:"decide", route:"self", why:"Two self parts.", kind:"code", parts:[{ task:"a", kind:"research", agent:"self" }, { task:"b", agent:"self" }] }, { session:"job" }), { code:"BAD_KIND" });

  // route:"self" records kind on the coordinator's active Work, and rate preserves it.
  await orch.call(project, { do:"decide", route:"self", why:"Small discussion.", kind:"Chat" }, { session:"job" });
  assert.equal(orch.records(project).find(r => r.line === "job" && r.work === "work-1")?.kind, "chat");

  // route:"split" records the self part's kind on the coordinator's active Work.
  await orch.call(project, { do:"decide", route:"split", why:"Split work.", parts:[{ task:"build", kind:"code", agent:"self" }, { task:"Discuss approach", kind:"chat", agent:"sub" }] }, { session:"job" });
  assert.equal(orch.records(project).find(r => r.line === "job" && r.work === "work-1")?.kind, "code");

  jobWork.state = "done";
  await orch.call(project, { do:"rate", line:"job", work:"work-1", score:4, note:"Verified build." }, { session:"job" });
  assert.equal(orch.records(project).find(r => r.line === "job" && r.work === "work-1")?.kind, "code");

  // route:"delegate" does not falsely tag the coordinator's Work with a sub-agent's kind.
  await orch.call(project, { do:"decide", route:"delegate", why:"Delegate investigation.", parts:[{ task:"investigate", kind:"research", agent:"sub" }] }, { session:"delegated-job" });
  assert.equal(orch.records(project).find(r => r.line === "delegated-job" && r.work === "work-1"), undefined);

  // Explicit kinds are required for unrecorded Works; "other" and retired kinds are rejected. A review station is ineligible even with a valid kind.
  const rate = (work, args = {}) => orch.call(project, { do:"rate", line:"user-line", work, score:4, ...args });
  await assert.rejects(rate("work-1"), { code:"BAD_KIND" });
  for (const kind of ["bad", "review", "FIX", "test", "other", " Other ", ""]) {
    await assert.rejects(rate("work-1", { kind }), { code:"BAD_KIND" });
    await assert.rejects(orch.call(project, { do:"decide", route:"self", why:"One task.", kind }, { session:"job" }), { code:"BAD_KIND" });
    await assert.rejects(orch.call(project, { do:"decide", route:"delegate", why:"One task.", parts:[{ task:"a", kind, agent:"sub" }] }, { session:"delegated-job" }), { code:"BAD_KIND" });
  }
  for (const kind of [" CHAT ", " CODE ", " Design "]) {
    const rated = await rate("work-1", { kind });
    assert.deepEqual([rated.kind, rated.preset, rated.effort], [kind.trim().toLowerCase(), "sub", "medium"]);
  }
  // Once recorded with a valid kind, rate preserves it when kind is omitted.
  assert.equal((await rate("work-1")).kind, "design");
  await assert.rejects(rate("work-2", { kind:"chat" }), { code:"NOT_RATEABLE" });
  assert.equal(orch.records(project).find(r => r.line === "user-line" && r.work === "work-2"), undefined);
});

test("assigning to multiple sub-agents does not exclude the orchestrator's own preset or same model (PE-776)", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  service.presets.update(fast.id, { model:"shared-model", effort:"high" });
  const sameModel = service.presets.add({ agent:"fake", name:"Fake medium", model:"shared-model", effort:"medium" });
  const coord = await orchestrator.start(project, { goal:"fixture-answer coordinate delay=50", preset:fast.id });
  await until(() => lineDoc(service, project, coord.line).status === "done", "coordinator started and finished");

  const offered = await orchestrator.call(project, { do:"agents" }, { session:coord.line });
  assert.ok(offered.agents.some(a => a.id === fast.id), "agents includes the coordinator's own preset");
  assert.ok(offered.agents.some(a => a.id === sameModel.id), "agents includes another preset with the same model");

  const planned = await orchestrator.call(project, { do:"plan", kind:"research" }, { session:coord.line });
  assert.ok(planned.agents.some(a => a.agent === fast.id && a.you), "plan includes coordinator preset marked you");
  assert.ok(planned.agents.some(a => a.agent === sameModel.id && !a.you), "plan includes same-model preset");

  const text = orchestrator.brief(project, coord.line, { front:{ orchestrator:"yes" } });
  assert.doesNotMatch(text, /do not exclude your own preset/i);

  // Multi-agent decide accepts the coordinator's own preset alongside other presets and/or self.
  const decided = await orchestrator.call(project, {
    do:"decide",
    route:"split",
    why:"Compare views from the coordinator's own model and another preset in parallel.",
    parts:[
      { task:"View A", kind:"research", agent:fast.id },
      { task:"View B", kind:"research", agent:sameModel.id },
      { task:"View C", kind:"research", agent:other.id },
    ],
  }, { session:coord.line });
  assert.deepEqual(decided, {
    route:"split",
    why:"Compare views from the coordinator's own model and another preset in parallel.",
    parts:3,
    delegated:3,
  });

  // Parallel child Works can include the coordinator's own preset, same-model preset, and another preset, and all can be rated.
  const first = await orchestrator.call(project, { do:"create-line", task:"fixture-answer self-preset delay=120", agent:fast.id, kind:"research" }, { session:coord.line });
  const second = await orchestrator.call(project, { do:"add-task", line:first.line, task:"fixture-answer same-model delay=120", agent:sameModel.id, kind:"research", parallel:true }, { session:coord.line });
  const third = await orchestrator.call(project, { do:"add-task", line:first.line, task:"fixture-answer other-preset delay=120", agent:other.id, kind:"research", parallel:true }, { session:coord.line });
  assert.equal(second.parallel, true);
  assert.equal(third.parallel, true);
  await until(() => lineDoc(service, project, first.line).status === "done", "all three parallel child Works finished");

  for (const item of [first, second, third]) {
    const rated = await orchestrator.call(project, { do:"rate", line:first.line, work:item.work, score:4, note:"Checked parallel sub-agent output." }, { session:coord.line });
    assert.equal(rated.score, 4);
  }
  const childView = await orchestrator.call(project, { do:"line", line:first.line }, { session:coord.line });
  assert.deepEqual(childView.steps.filter(s => s.work).map(s => [s.work, s.score]), [
    [first.work, 4], [second.work, 4], [third.work, 4],
  ]);
});

test("legacy Code assignments merge and both forms of Review keep activity without rating evidence", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "legacy-kinds-")), project = { id:"p" }, now = Date.now();
  const makeWork = (n, extra = {}) => ({
    id:`work-${n}`, kind:"work", state:"done", agent:"codex", startedAt:now, took:"5 min",
    picked:{ model:"gpt-test", effort:"high" }, tokens:{ inputTokens:800, outputTokens:200 }, ...extra,
  });
  const stations = [
    makeWork(1, { rating:"good" }), makeWork(2), makeWork(3),
    makeWork(4, { rating:"bad", orchScore:1 }),
    makeWork(5, { kind:"review", rating:"bad", orchScore:1 }),
    makeWork(6, { kind:"review", rating:"bad", orchScore:1, picked:{ model:"gpt-test", effort:"xhigh" } }),
    ...[7, 8, 9].map(n => makeWork(n, { picked:{ model:"gpt-test", effort:"xhigh" } })),
    { id:"ask-1", kind:"ask", state:"done" },
  ];
  const records = ["fix", " TeSt ", "code", " REVIEW ", "code", "other", "review", "review", "review"]
    .map((kind, i) => ({ id:String(i), project:"p", line:"child", work:`work-${i + 1}`, kind, score:i < 3 ? 5 : 1, at:new Date(now).toISOString() }));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const preset = { id:"one", name:"One", agent:"codex", model:"gpt-test", effort:"high", available:true };
  const service = {
    stateOf:() => ({ lines:[{ id:"parent", stations:[] }, { id:"child", stations }] }),
    parsedDoc:(_p, slug) => ({ front:slug === "parent" ? { orchestrator:"yes", id:"PE-1" } : { "orchestrated by slug":"parent" } }),
    store:{ projects:[project] }, localRunEntries:() => [], activity:{ load:() => ({ rows:[] }) }, key:(_p, slug) => slug,
    presets:{ list:() => ({ presets:[preset] }), get:() => preset },
  };
  const orch = createOrchestrator({ service, directory });
  const call = (op, args = {}) => orch.call(project, { do:op, ...args });
  orch.setPrice({ model:"gpt-test", input:1000, output:2000 });

  const view = await call("line", { line:"child" });
  const workKinds = ["code", "code", "code", ...Array(6).fill(undefined)];
  const workViews = await Promise.all(stations.slice(0, 9).map(s => call("work", { line:"child", work:s.id })));
  assert.deepEqual(workViews.map(s => s.kind), workKinds);
  assert.deepEqual(view.steps.filter(s => s.work).map(s => s.kind), workKinds);
  const [child] = orch.sessions(project)[0].lines;
  assert.deepEqual(child.works.map(s => s.kind), workKinds);
  assert.ok(child.works.every(s => !s.score));
  for (const work of ["work-4", "work-5"]) {
    await assert.rejects(call("rate", { line:"child", work, score:5, kind:"chat" }), { code:"NOT_RATEABLE" });
  }

  const stats = orch.stats(project);
  assert.deepEqual(stats.daily.map(r => [r.kind, r.works]).sort(), [["code", 3]]);
  assert.deepEqual(stats.ratings.map(r => r.work), ["work-1", "work-2", "work-3"]);
  const uncategorizedRows = stats.rows.filter(r => r.kind === "");
  assert.equal(uncategorizedRows.reduce((sum, r) => sum + r.works, 0), 6);
  assert.deepEqual(uncategorizedRows.map(r => [r.rated, r.scored, r.good, r.bad, r.medianMinutes, r.tokensPerWork, r.costPerWork]),
    [[0, 0, 0, 0, 5, 1000, 1.2], [0, 0, 0, 0, 5, 1000, 1.2]]);
  assert.deepEqual(orch.stats(project, { kind:" FIX " }).rows, orch.stats(project, { kind:"test" }).rows);
  assert.equal(orch.stats(project, { kind:"fix" }).rows[0].works, 3);
  assert.equal(orch.stats(project, { kind:"review" }).rows.length, 0);
  assert.equal(orch.stats(project, { kind:"other" }).rows.length, 0);

  const high = orch.agentRecord(project).agents.find(r => r.effort === "high");
  assert.deepEqual([high.works, high.rated, high.good, high.bad, high.score], [5, 3, 1, 0, 5]);
  const [allPlan] = (await call("plan")).agents, [codePlan] = (await call("plan", { kind:"Test" })).agents;
  assert.deepEqual([allPlan.works, allPlan.good, allPlan.bad, allPlan.scored], [5, 1, 0, 3]);
  assert.deepEqual([codePlan.kindBasis, codePlan.works, codePlan.scored], ["code", 3, 3]);
  assert.equal(codePlan.score, allPlan.score);
  assert.equal(codePlan.expectedCost, 1.37, "review scores from another effort cannot lower the family prior");

  const day = new Date(now).toISOString().slice(0, 10);
  const [code, ...extra] = orch.agentDays(project, { from:day, to:day });
  assert.deepEqual(extra, []);
  assert.deepEqual([code.kind, code.works, code.scoreCount, code.good, code.bad, code.followups], ["code", 3, 3, 1, 0, 0]);
  assert.equal(orch.index().works, 3);
});

test("starting and retrying saved assignments handles retired kinds without exposing them", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "saved-kinds-")), project = { id:"p" };
  const preset = { id:"one", name:"One", agent:"codex", model:"gpt-test", effort:"high", available:true };
  const kinds = ["fix", "test", "review", "other"];
  const makeLine = (mode, kind) => ({
    id:`${mode}-${kind}`, status:mode === "retry" ? "stopped" : "not-started", topicHash:"current",
    stations:mode === "saved"
      ? [{ id:"ask-1", kind:"ask", unsent:true, savedAgentId:preset.id, held:{ kind } }]
      : [{ id:"work-1", kind:"work", state:mode === "retry" ? "error" : "todo", agent:preset.agent }],
  });
  const lines = kinds.flatMap(kind => ["saved", "queued", "retry"].map(mode => makeLine(mode, kind)));
  const find = slug => lines.find(l => l.id === slug);
  const records = kinds.flatMap(kind => ["queued", "retry"].map(mode => ({
    id:`${mode}-${kind}`, project:"p", line:`${mode}-${kind}`, work:"work-1", kind,
  })));
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const service = {
    stateOf:() => ({ lines }), key:(_p, slug) => slug, startsNow:new Map(), stepPresets:new Map(),
    changed() {}, onChange() {},
    parsedDoc:(_p, slug) => ({ asks:find(slug).stations }),
    presets:{ list:() => ({ presets:[preset] }), get:() => preset },
    presetFor:() => preset,
    async runUnsent(_p, slug) {
      find(slug).stations.push({ id:"work-1", kind:"work", state:"active", agent:preset.agent });
      return { step:"work-1" };
    },
    async act(_p, slug, verb) {
      const line = find(slug);
      if (verb === "start") line.stations[0].state = "active";
      else line.stations.push({ id:"work-2", kind:"work", state:"done", agent:preset.agent });
      return { step:"work-2", replaced:"work-1" };
    },
  };
  const orch = createOrchestrator({ service, directory });
  const call = (op, line, args = {}) => orch.call(project, { do:op, line, ...args });

  for (const legacy of ["fix", "test"]) {
    assert.equal((await call("line", `saved-${legacy}`)).steps[0].kind, "code");
    assert.equal((await call("start-line", `saved-${legacy}`)).kind, "code");
    assert.equal((await call("start-line", `queued-${legacy}`)).kind, "code");
    assert.equal((await call("retry", `retry-${legacy}`)).kind, "code");
  }
  assert.equal((await call("line", "saved-review")).steps[0].kind, undefined);
  assert.equal((await call("line", "saved-other")).steps[0].kind, undefined);
  for (const line of ["saved-review", "queued-review", "saved-other", "queued-other"]) {
    await assert.rejects(call("start-line", line), { code:"BAD_KIND" });
    assert.equal((await call("start-line", line, { kind:"chat" })).kind, "chat");
  }
  assert.equal((await call("retry", "retry-review")).kind, undefined);
  await assert.rejects(call("rate", "retry-review", { work:"work-2", score:5 }), { code:"NOT_RATEABLE" });
  assert.equal((await call("retry", "retry-other")).kind, undefined);
  await assert.rejects(call("rate", "retry-other", { work:"work-2", score:5 }), { code:"BAD_KIND" });
  assert.equal((await call("rate", "retry-other", { work:"work-2", score:5, kind:"design" })).kind, "design");
});

test("canvas and prototype Works default to design without misclassifying follow-ups, slides, reviews, or explicit kinds (PE-878)", async () => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "canvas-prototype-design-")), project = { id:"p" }, now = Date.now();
  const baseWork = (id, extra = {}) => ({
    id, kind:"work", state:"done", agent:"codex", startedAt:now, took:"4 min", rating:"good",
    picked:{ model:"gpt-test", effort:"high" }, tokens:{ inputTokens:400, outputTokens:100 }, ...extra,
  });
  const lines = [
    { id:"parent", stations:[] },
    {
      id:"proto-flow",
      stations:[
        { id:"ask-1", kind:"ask", state:"done", make:{ kind:"explorer", sub:"prototype" } },
        baseWork("prototype-1", { kind:"prototype" }),
        // Implementation stage after a dedicated prototype step should stay uncategorized until assigned/rated.
        baseWork("work-1"),
      ],
    },
    {
      id:"canvas-and-makes",
      stations:[
        { id:"ask-1", kind:"ask", state:"done", canvas:"files/home/canvas.penecho.json" },
        baseWork("work-1", { canvas:"files/home/canvas.penecho.json" }),
        { id:"ask-2", kind:"ask", state:"done", make:{ kind:"diagram", sub:"architecture" } },
        baseWork("work-2"),
        { id:"ask-3", kind:"ask", state:"done", make:{ kind:"explorer", sub:"prototype" } },
        baseWork("work-3"),
        baseWork("work-4"), // Explicit orchestrator assignment below should win over implicit design.
        { id:"ask-4", kind:"ask", state:"done", make:{ kind:"slides", sub:"investor" } },
        baseWork("work-5"),
        { id:"ask-5", kind:"ask", state:"done" },
        baseWork("work-6"),
        baseWork("review-1", { kind:"review", canvas:"files/home/canvas.penecho.json" }),
      ],
    },
  ];
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({
    records:[{ id:"explicit-code", project:"p", line:"canvas-and-makes", work:"work-4", kind:"code", at:new Date(now).toISOString() }],
  }));
  const preset = { id:"one", name:"One", agent:"codex", model:"gpt-test", effort:"high", available:true };
  const service = {
    stateOf:() => ({ lines }),
    parsedDoc:(_p, slug) => ({ front:slug === "parent" ? { orchestrator:"yes", id:"PE-1" } : { "orchestrated by slug":"parent" } }),
    store:{ projects:[project] }, localRunEntries:() => [], activity:{ load:() => ({ rows:[] }) }, key:(_p, slug) => slug,
    changed() {}, onChange() {},
    presets:{ list:() => ({ presets:[preset] }), get:() => preset },
  };
  const orch = createOrchestrator({ service, directory });
  const call = (op, args = {}) => orch.call(project, { do:op, ...args });

  const protoView = await call("line", { line:"proto-flow" });
  assert.deepEqual(protoView.steps.filter(s => s.work).map(s => [s.work, s.kind]), [
    ["prototype-1", "design"], ["work-1", undefined],
  ]);
  const canvasView = await call("line", { line:"canvas-and-makes" });
  assert.deepEqual(canvasView.steps.filter(s => s.work).map(s => [s.work, s.kind]), [
    ["work-1", "design"], ["work-2", "design"], ["work-3", "design"], ["work-4", "code"],
    ["work-5", undefined], ["work-6", undefined], ["review-1", undefined],
  ]);
  assert.equal((await call("work", { line:"proto-flow", work:"prototype-1" })).kind, "design");
  assert.equal((await call("work", { line:"canvas-and-makes", work:"work-1" })).kind, "design");
  assert.equal((await call("work", { line:"canvas-and-makes", work:"work-4" })).kind, "code");
  assert.equal((await call("work", { line:"canvas-and-makes", work:"review-1" })).kind, undefined);

  const sessionLines = Object.fromEntries(orch.sessions(project)[0].lines.map(l => [l.line, l.works.map(w => [w.work, w.kind])]));
  assert.deepEqual(sessionLines["proto-flow"], [["prototype-1", "design"], ["work-1", undefined]]);
  assert.deepEqual(sessionLines["canvas-and-makes"], [
    ["work-1", "design"], ["work-2", "design"], ["work-3", "design"], ["work-4", "code"],
    ["work-5", undefined], ["work-6", undefined], ["review-1", undefined],
  ]);

  const stats = orch.stats(project);
  assert.deepEqual(stats.daily.map(r => [r.kind, r.works]).sort(), [["code", 1], ["design", 4]]);
  const byKind = Object.fromEntries(orch.agentRecord(project).agents[0].byKind.map(k => [k.kind, k.works]));
  assert.deepEqual(byKind, { design:4, code:1 });

  const day = new Date(now).toISOString().slice(0, 10);
  const daysByKind = Object.fromEntries(orch.agentDays(project, { from:day, to:day }).map(r => [r.kind, r.works]));
  assert.deepEqual(daysByKind, { design:4, code:1, "":3 });
  assert.equal(orch.index().tables.design.ranked[0]?.works, 4);

  // Rating a Canvas or Prototype Work without passing kind defaults to design; review stays blocked.
  assert.equal((await call("rate", { line:"proto-flow", work:"prototype-1", score:5, note:"clean mockup" })).kind, "design");
  assert.equal((await call("rate", { line:"canvas-and-makes", work:"work-1", score:4, note:"clear canvas" })).kind, "design");
  await assert.rejects(call("rate", { line:"proto-flow", work:"work-1", score:4 }), { code:"BAD_KIND" });
  await assert.rejects(call("rate", { line:"canvas-and-makes", work:"review-1", score:4 }), { code:"NOT_RATEABLE" });
});

// PE-927: one delegation took a coordinator about seven turns (decide, create-line, wait, work, rate, report). wait now gives the
// finished Work's result, create-line and add-task can wait in the same call, and why on create-line records the route.
test("wait gives a settled Line's newest Work with its result, cut when long, and says what a Line still going is doing", async t => {
  const { lines, service, orchestrator, project, fast } = setup();
  t.after(() => lines.close());
  const made = await orchestrator.call(project, { do:"create-line", task:"fixture-answer short", agent:fast.id, kind:"research" });
  const waited = await orchestrator.call(project, { do:"wait", lines:[made.line], seconds:10 });
  assert.equal(waited.done, true);
  const got = waited.lines[0], whole = await orchestrator.call(project, { do:"work", line:made.line, work:made.work });
  assert.deepEqual({ work:got.work, state:got.state, agent:got.agent, result:got.result }, { work:made.work, state:"done", agent:whole.agent, result:whole.result });
  assert.match(got.result, /Answer: fixture-answer short/);
  assert.equal(got.resultCut, undefined);
  assert.equal(got.works, undefined, "a Line with one Work names no others");

  // A long answer keeps its start and its end; work still has all of it.
  const rel = F.detailPath(made.line, made.work), long = `Start of the answer.\n\n${"Supporting evidence. ".repeat(1200)}\n\nFinal recommendation.`;
  service.store.writeText(project, rel, F.setSection(service.store.readText(project, rel).text, "Result", long));
  const cut = (await orchestrator.call(project, { do:"wait", lines:[made.line], seconds:1 })).lines[0];
  assert.equal(cut.resultCut, true);
  assert.ok(cut.result.length < 8200 && cut.result.length < long.length, `${cut.result.length} characters`);
  assert.ok(cut.result.startsWith("Start of the answer.") && cut.result.endsWith("Final recommendation."));
  assert.match(cut.result, /characters left out here: call work for all of it/);
  assert.equal((await orchestrator.call(project, { do:"work", line:made.line, work:made.work })).result, long);

  // A second Work on the Line: the newest one's result, and the Line's Works by id.
  const second = await orchestrator.call(project, { do:"add-task", line:made.line, task:"fixture-answer second", agent:fast.id, kind:"research" });
  const both = (await orchestrator.call(project, { do:"wait", lines:[made.line], seconds:10 })).lines[0];
  assert.equal(both.work, second.work);
  assert.deepEqual(both.works.map(w => w.work), [made.work, second.work]);

  // Still going: no result yet, and how long it has been quiet.
  const slow = await orchestrator.call(project, { do:"create-line", task:"fixture-answer delay=900", agent:fast.id, kind:"code" });
  const stop = new AbortController(); stop.abort();
  const going = await orchestrator.call(project, { do:"wait", lines:[slow.line] }, { signal:stop.signal });
  assert.equal(going.done, false);
  assert.ok(!("result" in going.lines[0]) && !("work" in going.lines[0]));
  assert.equal(typeof going.lines[0].quietSeconds, "number");
  await until(() => lineDoc(service, project, slow.line).status === "done", "the slow Work finished");
});

test("an agent's create-line waits in the same call and records a whole handoff's route once; the kept operation is the task alone", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  const parent = await orchestrator.start(project, { goal:"fixture-answer coordinate delay=4000", preset:fast.id });
  orchestrator.setBase("http://127.0.0.1:3888/api/lines/orchestrate");
  const pass = orchestrator.env(project, parent.line, lineDoc(service, project, parent.line)).PENECHO_ORCH_PASS;
  const args = { do:"create-line", task:"fixture-answer the part", agent:other.id, kind:"research", title:"The part", why:"Other careful finishes research like this well for far less.", wait:10 };
  const made = await orchestrator.agentCall(pass, args, null, { opId:"op-create-and-wait-1" });
  assert.equal(made.started, true);
  assert.equal(made.waited.done, true, "the same call waited for the Work");
  assert.equal(made.waited.lines[0].work, made.work);
  assert.match(made.waited.lines[0].result, /Answer: fixture-answer the part/);
  // The route is recorded as decide would have, for the session card.
  const front = lineDoc(service, project, parent.line).front;
  assert.equal(front.route, "delegate");
  assert.equal(front["route why"], "Other careful finishes research like this well for far less.");
  assert.match(front["route parts"], /The part → Other careful/);
  // Sent again (as the helper does after PenEcho restarted): the same task, not a second one, and it waits on.
  const again = await orchestrator.agentCall(pass, args, null, { opId:"op-create-and-wait-1" });
  assert.equal(again.line, made.line);
  assert.equal(again.waited.done, true);
  assert.equal(service.store.scan(project).topics.filter(t => t.doc.front["orchestrated by slug"] === parent.line).length, 1);
  // A route the coordinator decided itself is never replaced by a later why.
  await orchestrator.agentCall(pass, { do:"decide", route:"split", why:"I keep the summary; the check goes to another agent.", parts:[{ task:"summary", kind:"docs", agent:"self" }, { task:"check", kind:"research", agent:other.id }] });
  const added = await orchestrator.agentCall(pass, { do:"add-task", line:made.line, task:"fixture-answer the check", agent:other.id, kind:"research", wait:10 });
  assert.equal(added.waited.done, true);
  assert.equal(added.waited.lines[0].work, added.work);
  await orchestrator.agentCall(pass, { do:"create-line", task:"fixture-answer another", agent:other.id, kind:"research", why:"A different reason.", wait:10 });
  assert.equal(lineDoc(service, project, parent.line).front.route, "split");
  assert.equal(lineDoc(service, project, parent.line).front["route why"], "I keep the summary; the check goes to another agent.");
  await service.act(project, parent.line, "stop").catch(() => {});
});

// PE-927, from 254 coordinator Works: parts handed off ran one after another (side by side for 6% of their time), half of them
// ran under five minutes, and each finished Work took a turn to rate. decide now starts every briefed part at once.
test("decide starts every briefed part side by side and waits for them in the same call; rate takes several at once", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  const parent = await orchestrator.start(project, { goal:"fixture-answer coordinate delay=9000", preset:fast.id });
  orchestrator.setBase("http://127.0.0.1:3888/api/lines/orchestrate");
  const pass = orchestrator.env(project, parent.line, lineDoc(service, project, parent.line)).PENECHO_ORCH_PASS;
  await until(() => runs().some(r => r.line === parent.line), "the coordinator started");
  const told = runs().find(r => r.line === parent.line).prompt;
  // PE-1065, PE-1097 & PE-1190: the lean brief keeps the handoff bar and moves wait/check/rate rules onto the first delegation reply.
  assert.match(told, /hand over the parts that stand on their own with decide .*Send independent parts together and do yours meanwhile; send ordered ones one after another/);
  assert.match(told, /Keep a change with its tests, parts under 5 minutes, and work that hangs on what you hold/);
  assert.doesNotMatch(told, /ten minutes|under ten|does not decide it|third to a half|Wait for Works to settle/);
  const args = { do:"decide", route:"split", why:"Two independent checks run side by side while I write the summary.", wait:20, parts:[
    { task:"summary", kind:"docs", agent:"self" },
    { task:"check A", kind:"research", agent:other.id, brief:"fixture-answer part-A delay=1500" },
    { task:"check B", kind:"research", agent:fast.id, brief:"fixture-answer part-B delay=1500" }] };
  const decided = await orchestrator.agentCall(pass, args, null, { opId:"op-decide-start-1" });
  assert.equal(decided.route, "split");
  assert.match(decided.next, /Wait for Works to settle in one wait call.*several at once with rates/, "lazy handoff guidance arrives on first delegation");
  assert.match(decided.next, /Your own Line holds only your work: assignments go on other Lines/);
  assert.deepEqual(decided.started.map(part => part.task), ["check A", "check B"]);
  assert.ok(decided.started.every(part => part.line && part.work && !part.error));
  assert.equal(decided.waited.done, true, "the same call waited for both");
  assert.deepEqual(decided.waited.lines.map(l => /part-[AB]/.exec(l.result)?.[0]).sort(), ["part-A", "part-B"]);
  // Side by side: each took a second and a half, and the second began before the first ended.
  const began = ["part-A", "part-B"].map(name => runs().find(r => r.request.includes(name)).at);
  assert.ok(Math.abs(began[0] - began[1]) < 1200, `started ${Math.abs(began[0] - began[1])} ms apart`);
  const front = lineDoc(service, project, parent.line).front;
  assert.equal(front.route, "split");
  assert.match(front["route parts"], /summary → you; check A → Other careful; check B → Fake fast/);
  const children = () => service.store.scan(project).topics.filter(topic => topic.doc.front["orchestrated by slug"] === parent.line);
  assert.equal(children().length, 2);
  // Sent again, as the helper does after PenEcho restarted: the same two Lines, none made twice.
  const again = await orchestrator.agentCall(pass, args, null, { opId:"op-decide-start-1" });
  assert.deepEqual(again.started.map(part => part.line), decided.started.map(part => part.line));
  assert.equal(again.waited.done, true);
  assert.equal(children().length, 2);
  // Both rated in one call; one that cannot be rated says why and stops nothing.
  const [a, b] = decided.started;
  const rated = await orchestrator.agentCall(pass, { do:"rate", rates:[{ line:a.line, work:a.work, score:4, note:"Answered; one gap." }, { line:b.line, work:b.work, score:5, note:"Checked against the fixture." }, { line:a.line, work:"work-99", score:3 }] });
  assert.equal(rated.rated.length, 2);
  assert.equal(rated.errors.length, 1);
  assert.deepEqual(orchestrator.scoresForLine(project, a.line).map(score => score.score), [4]);
  assert.deepEqual(orchestrator.scoresForLine(project, b.line).map(score => score.score), [5]);
  // A part with no brief is only recorded, as before.
  const plain = await orchestrator.agentCall(pass, { do:"decide", route:"delegate", why:"The whole check goes to another agent.", parts:[{ task:"the check", kind:"research", agent:other.id }] });
  assert.equal(plain.started, undefined);
  assert.equal(children().length, 2);
  const alone = await orchestrator.agentCall(pass, { do:"decide", route:"self", why:"A small change I have the context for.", kind:"code" });
  assert.equal(alone.route, "self");
  await service.act(project, parent.line, "stop").catch(() => {});
});

test("rate supports unified outcome/verification/safety dimensions, unverified exclusion, source tracking, and findings rollup", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  orchestrator.setBase("http://127.0.0.1:3888/api/lines/orchestrate");
  const parent = await orchestrator.start(project, { goal:"fixture-answer coordinate delay=5000", preset:fast.id });
  const pass = orchestrator.env(project, parent.line, lineDoc(service, project, parent.line)).PENECHO_ORCH_PASS;
  const chatLine = await orchestrator.call(project, { do:"create-line", task:"hi", agent:other.id, kind:"chat" }, { session:parent.line });
  const codeLine = await orchestrator.call(project, { do:"create-line", task:"fix logic", agent:other.id, kind:"code" }, { session:parent.line });
  const unvLine = await orchestrator.call(project, { do:"create-line", task:"check deploy", agent:other.id, kind:"research" }, { session:parent.line });
  await until(() => [chatLine, codeLine, unvLine].every(x => lineDoc(service, project, x.line).status === "done"), "all child lines done");

  // Simple chat ("hi" -> "hi"): verification and safety N/A (null) -> server computes 5.0 and verdict ready.
  const chatRated = await orchestrator.agentCall(pass, {
    do:"rate", line:chatLine.line, work:chatLine.work,
    outcome:5, verification:null, safety:null, note:"Clean greeting reply.",
  });
  assert.equal(chatRated.score, 5);
  assert.equal(chatRated.verdict, "ready");
  assert.equal(chatRated.source, "coordinator");

  // Code Work with dimensions overrides any conflicting raw score using shared server scoreOf(), ignoring any reportMismatch or bonus.
  const codeRated = await orchestrator.agentCall(pass, {
    do:"rate", line:codeLine.line, work:codeLine.work,
    score:5, outcome:4, verification:4.5, safety:5, reportMismatch:"ignored claim",
    findings:[{ kind:"gap", where:"src/a.js:12", detail:"Missing edge-case branch" }],
    note:"Works well, one edge case left.",
  });
  assert.equal(codeRated.score, 4.3, "60/20/20 server formula produces 4.3 with no reportMismatch deduction");
  assert.equal(codeRated.reportMismatch, undefined);
  assert.equal(codeRated.verdict, "caveats");
  assert.equal(codeRated.source, "coordinator");

  // Unverified rating stores score:null and is excluded from stats, agentRecord, agentDays, and plan.
  const unvRated = await orchestrator.agentCall(pass, {
    do:"rate", line:unvLine.line, work:unvLine.work,
    verdict:"unverified", outcome:null,
    findings:[{ kind:"unverified", detail:"Deploy log was unavailable" }],
    note:"Could not inspect deploy log.",
  });
  assert.equal(unvRated.score, null);
  assert.equal(unvRated.verdict, "unverified");

  const st = orchestrator.stats(project);
  assert.equal(st.ratings.length, 2, "unverified rating excluded from scored ratings list");
  assert.ok(st.ratings.every(r => r.source === "coordinator"));
  const codeRow = st.rows.find(r => r.runner === "other" && r.kind === "code");
  assert.equal(codeRow.score, 4.3);
  assert.equal(codeRow.scored, 1);
  assert.deepEqual(codeRow.bySource, { coordinator:{ score:4.3, count:1 } });
  assert.deepEqual(codeRow.findings, { gap:1 });
  const unvRow = st.rows.find(r => r.runner === "other" && r.kind === "research");
  assert.equal(unvRow.scored, 0);
  assert.equal(unvRow.score, null);
  assert.deepEqual(unvRow.findings, { unverified:1 });

  const ag = orchestrator.agentRecord(project).agents.find(a => a.runner === "other");
  assert.equal(ag.scored, 2, "only the 2 scored Works count toward agentRecord");
  assert.deepEqual(ag.bySource, { coordinator:{ score:4.7, count:2 } });
  assert.deepEqual(ag.findings, { gap:1, unverified:1 });

  const today = new Date().toISOString().slice(0, 10);
  const days = orchestrator.agentDays(project, { from:today, to:today }).filter(d => d.runner === "other");
  assert.equal(days.reduce((n, d) => n + d.scoreCount, 0), 2, "unverified excluded from agentDays");
  await service.act(project, parent.line, "stop").catch(() => {});
});

test("silent route: self default records route and inferred kind, clears stale route on follow-ups, and keeps rate/stats working (PE-1097)", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  // Work 1 finishes solo without ever calling decide -> PenEcho records route: self and infers kind ("code").
  const job = await orchestrator.start(project, { goal:"Fix the failing login test", preset:fast.id });
  await until(() => lineDoc(service, project, job.line).status === "done", "solo Work 1 finished");
  assert.equal(lineDoc(service, project, job.line).front.route, "self");
  assert.equal(lineDoc(service, project, job.line).front["route why"], undefined);
  const rec1 = orchestrator.records(project).find(r => r.line === job.line && r.work === "work-1");
  assert.equal(rec1?.kind, "code");
  assert.equal(rec1?.kindSource, "inferred");
  // Rating Work 1 without passing kind succeeds instead of failing with BAD_KIND, and stats include it under "code".
  const rated1 = await orchestrator.call(project, { do:"rate", line:job.line, work:"work-1", score:4.5, note:"Clean solo fix." });
  assert.equal(rated1.kind, "code");
  assert.ok(orchestrator.stats(project, { kind:"code" }).rows.some(r => r.works >= 1));

  // Simulate Work 1 having recorded route: split, then send a follow-up Ask (Work 2) that works solo without decide.
  service.writeDoc(project, job.line, F.setFront(service.readDoc(project, job.line), {
    route:"split", "route why":"Work 1 split across agents.", "route parts":"part A → you; part B → Other",
  }));
  await service.request(project, { topic:job.line, text:"Write a README for this feature", preset:fast.id });
  await until(() => lineDoc(service, project, job.line).status === "done" && lineDoc(service, project, job.line).steps.some(s => s.id === "work-2" && s.done), "follow-up Work 2 finished");
  const front2 = lineDoc(service, project, job.line).front;
  assert.equal(front2.route, "self", "stale split route from Work 1 was cleared and replaced by silent self default");
  assert.equal(front2["route why"], undefined);
  assert.equal(front2["route parts"], undefined);
  const rec2 = orchestrator.records(project).find(r => r.line === job.line && r.work === "work-2");
  assert.equal(rec2?.kind, "docs");
  assert.equal(rec2?.kindSource, "inferred");

  // Follow-up Work 3 that delegates via create-line { why } without calling decide is not blocked by Work 2's route: self.
  await service.request(project, { topic:job.line, text:"fixture-answer coordinate delay=3000", preset:fast.id });
  await until(() => service.heldWorks(project, job.line).some(r => r.stepId === "work-3"), "Work 3 active");
  assert.equal(lineDoc(service, project, job.line).front.route, undefined, "stale route cleared when follow-up Work 3 launched");
  const delegated = await orchestrator.call(project, {
    do:"create-line", task:"fixture-answer delegated part", agent:other.id, kind:"research", why:"Cheaper agent handles the research.",
  }, { session:job.line });
  assert.match(delegated.next, /Delegation rules:.*Wait for Works to settle/, "first delegation call delivers lazy handoff guidance");
  const secondDelegation = await orchestrator.call(project, {
    do:"add-task", line:delegated.line, task:"fixture-answer second part", agent:other.id, kind:"research",
  }, { session:job.line });
  assert.equal(secondDelegation.next, undefined, "handoff guidance is delivered only once per Work");
  assert.equal(lineDoc(service, project, job.line).front.route, "delegate");
  await service.act(project, job.line, "stop").catch(() => {});
});

test("brief stays under 2.5 KB and names who could take a part, Light/chat uses 2-line brief, plan defaults compact, and resumed sessions skip duplicate brief (PE-1097)", async t => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const directory = fs.mkdtempSync(path.join(temp, "brief-budget-")), project = { id:"p" }, now = Date.now();
  const presets = Array.from({ length:24 }, (_, i) => ({
    id:`p${String(i).padStart(11, "0")}`, name:`Agent ${i} · high effort`, agent:"runner", model:`m${i}`, effort:"high", available:true,
  }));
  const stations = presets.flatMap((p, i) => [1, 2, 3, 4].map(j => ({
    id:`w-${i}-${j}`, kind:"work", state:"done", took:"5 min", agent:"runner", savedAgentId:p.id,
    picked:{ model:p.model, effort:"high" }, startedAt:now, tokens:{ inputTokens:200000, outputTokens:20000 },
  })));
  const records = stations.map((s, idx) => ({ id:String(idx), project:"p", line:"past", work:s.id, kind:"code", score:idx < 4 ? 3.2 : 4.6, at:new Date(now).toISOString() }));
  // Give preset 1 zero history so it becomes a trial candidate alongside proven cheaper agents.
  const trimmedStations = stations.filter(s => s.savedAgentId !== presets[1].id);
  fs.mkdirSync(path.join(directory, "orchestrator"));
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({ records }));
  const serviceMock = {
    stateOf:() => ({ lines:[{ id:"past", stations:trimmedStations }, { id:"job", stations:[{ id:"work-1", kind:"work", state:"active", agent:"runner", savedAgentId:presets[23].id, picked:{ model:presets[23].model, effort:"high" } }] }] }),
    readDoc:() => "---\nid: PE-1\norchestrator: yes\n---\n\n# Job\n",
    presets:{ list:() => ({ presets, default:presets[23].id }), get:id => presets.find(p => p.id === id) },
  };
  const orch = createOrchestrator({ service:serviceMock, directory });
  presets.forEach((p, i) => orch.setPrice({ model:p.model, input:i === 23 ? 15 : 0.4 + i * 0.25, output:i === 23 ? 75 : 2 + i }));
  const doc = { front:{ orchestrator:"yes" } };

  // Full brief with 24 presets stays under 2.5 KB and names the two cheapest that fit, not all of them.
  const full = orch.brief(project, "job", doc, { askText:"Refactor the auth middleware and add tests" });
  assert.ok(Buffer.byteLength(full) < 2500, `full brief should be < 2500 bytes, got ${Buffer.byteLength(full)}`);
  assert.match(full, /For code work now\. Decision: nobody free is rated above you\. Execution: Agent 2 · high effort, Agent 3 · high effort and 19 more\./);

  // Default plan is capped to 6 + you and compact; all:true returns all 24.
  const compactPlan = await orch.call(project, { do:"plan" }, { session:"job" });
  assert.equal(compactPlan.agents.length, 7);
  assert.equal(compactPlan.more, 17);
  assert.ok(Buffer.byteLength(JSON.stringify(compactPlan)) < 2800, `default plan should stay compact, got ${Buffer.byteLength(JSON.stringify(compactPlan))}`);
  const allPlan = await orch.call(project, { do:"plan", all:true }, { session:"job" });
  assert.equal(allPlan.agents.length, 24);
  assert.equal(allPlan.more, undefined);

  // Light / chat asks get the 2-line brief (< 350 bytes); short follow-ups & explicit delegation requests keep the full brief.
  for (const lightAsk of ["hello", "hi", "ping", "what do you think about this?", "remove this send fix button"]) {
    assert.equal(orch.briefMode(doc, { askText:lightAsk }), "light", lightAsk);
    const shortBrief = orch.brief(project, "job", doc, { askText:lightAsk });
    assert.ok(Buffer.byteLength(shortBrief) < 350, `${lightAsk}: ${Buffer.byteLength(shortBrief)} bytes`);
    assert.match(shortBrief, /no decide call needed/);
  }
  for (const fullAsk of ["build it", "fix that", "what do you think? ask two agents to compare", "refactor auth middleware"]) {
    assert.equal(orch.briefMode(doc, { askText:fullAsk }), "full", fullAsk);
  }

  // Resumed sessions skip duplicate brief unless upgrading from Light -> Full.
  assert.equal(orch.brief(project, "job", doc, { askText:"build it", resumedBrief:"full" }), "");
  assert.equal(orch.brief(project, "job", doc, { askText:"hello", resumedBrief:"light" }), "");
  assert.match(orch.brief(project, "job", doc, { askText:"Refactor the auth middleware", resumedBrief:"light" }), /Longer work: first decide, then do/);

  // End-to-end resumed conversation test via real Service:
  // 1) Full Work 1 -> resumed Work 2 skips orchestrator brief.
  // 2) Light Work 1 ("hello") -> resumed Work 2 ("Refactor the auth middleware") upgrades and sends full brief.
  const env = setup();
  t.after(() => env.lines.close());
  const fullLine = await env.orchestrator.start(env.project, { goal:"Refactor the auth middleware", preset:env.fast.id });
  await until(() => lineDoc(env.service, env.project, fullLine.line).status === "done", "fullLine Work 1 done");
  const w1Run = runs().find(r => r.line === fullLine.line);
  assert.match(w1Run.prompt, /Longer work: first decide, then do/);
  const beforeW2 = runs().length;
  await env.service.request(env.project, { topic:fullLine.line, text:"build it", preset:env.fast.id, taskMode:"continue" });
  await until(() => runs().length > beforeW2 && lineDoc(env.service, env.project, fullLine.line).status === "done", "fullLine Work 2 done");
  const w2Run = runs().at(-1);
  assert.doesNotMatch(w2Run.prompt, /You are this project's orchestrator|Longer work: first decide, then do/, "resumed session does not resend full brief");

  const lightLine = await env.orchestrator.start(env.project, { goal:"hello", preset:env.fast.id });
  await until(() => lineDoc(env.service, env.project, lightLine.line).status === "done", "lightLine Work 1 done");
  const lw1 = runs().find(r => r.line === lightLine.line);
  assert.match(lw1.prompt, /no decide call needed/);
  assert.doesNotMatch(lw1.prompt, /Longer work: first decide, then do/);
  const beforeLw2 = runs().length;
  await env.service.request(env.project, { topic:lightLine.line, text:"Refactor the auth middleware", preset:env.fast.id, taskMode:"continue" });
  await until(() => runs().length > beforeLw2 && lineDoc(env.service, env.project, lightLine.line).status === "done", "lightLine Work 2 done");
  const lw2 = runs().at(-1);
  assert.match(lw2.prompt, /Longer work: first decide, then do/, "resumed Light session upgrades to full brief on non-Light follow-up");
});

test("Windows orchestrator brief uses PowerShell stdin piping and orch-call strips a UTF-8 BOM from stdin", async t => {
  const env = setup();
  t.after(() => env.lines.close());
  const doc = { front:{ orchestrator:"yes", who:"@fake" } };
  const winFull = env.orchestrator.brief(env.project, "job", doc, { askText:"Refactor auth middleware", platform:"win32" });
  assert.match(winFull, /'\{"do":"<call>", \.\.\.\}' \| node "\$env:PENECHO_ORCH_HELPER"/);
  const winLight = env.orchestrator.brief(env.project, "job", doc, { askText:"hello", platform:"win32" });
  assert.match(winLight, /'\{"do":"plan"\}' \| node "\$env:PENECHO_ORCH_HELPER"/);
  const macFull = env.orchestrator.brief(env.project, "job", doc, { askText:"Refactor auth middleware", platform:"darwin" });
  assert.match(macFull, /node "\$PENECHO_ORCH_HELPER" '\{"do":"<call>", \.\.\.\}'/);

  // Verify orch-call.js strips a leading UTF-8 BOM on piped stdin (PowerShell 5.1 piping).
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${srv.address().port}`);
    if (await env.lines.handle(req, res, url)) return;
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => srv.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => srv.close(resolve)));
  const { port } = srv.address();
  const baseUrl = `http://127.0.0.1:${port}/api/lines/orchestrate`;
  env.orchestrator.setBase(baseUrl);
  const started = await env.orchestrator.start(env.project, { goal:"hello", preset:env.fast.id });
  await until(() => lineDoc(env.service, env.project, started.line).status === "done", "started orch line done");
  const orchEnv = env.orchestrator.env(env.project, started.line, lineDoc(env.service, env.project, started.line));
  const out = await new Promise((resolve, reject) => {
    const child = require("node:child_process").spawn(process.execPath, [orchEnv.PENECHO_ORCH_HELPER], {
      env:{ ...process.env, ...orchEnv, PENECHO_ORCH_URL:baseUrl, PENECHO_ORCH_ENDPOINT:"" },
      stdio:["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end("\uFEFF" + JSON.stringify({ do:"help" }));
  });
  assert.equal(out.code, 0, out.stderr || out.stdout);
  assert.ok(Array.isArray(JSON.parse(out.stdout).functions), out.stdout);
});
