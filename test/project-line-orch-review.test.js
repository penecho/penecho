"use strict";
require("./helpers/safety.js");
// The Orchestrator's reviewer, its settings, the sync with penecho.ai and PenEcho Auto (orch-review.js).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { parseReview, scoreOf, reviewAsk, reviewPrompt, runReviewCommand } = require("../src/server/project-lines/orch-review.js");
const LINE_STATUS = require("../public/lines/line-status.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-orch-review-test-")));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 10000) {
  const start = Date.now();
  for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); }
}
// A stand-in agent like Claude Code: it finishes at once.
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const say = o => console.log(JSON.stringify(o));
process.stdin.on("data", () => {}).on("end", () => {
  say({ type:"system", subtype:"init", session_id:"s-" + Math.random().toString(36).slice(2) });
  say({ type:"assistant", message:{ content:[{ type:"text", text:"Finished the work." }] } });
  say({ type:"result", subtype:"success", is_error:false, result:"Finished the work." });
});
`);
function fakeAgents() {
  const one = id => ({ name:id, mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }),
    command:launch => ({ command:launch.command, args:[...launch.prefixArgs] }),
    // The reviewer's one-off call; tests replace the run itself.
    answer:(launch, { model, effort }) => ({ command:launch.command, args:[...launch.prefixArgs], model, effort }) });
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
  return { lines, service, orchestrator, project, fast, other, directory };
}
const lineDoc = (service, project, slug) => F.parseLine(service.readDoc(project, slug));
const stationOf = (service, project, slug) => {
  const state = service.stateOf(project), line = [...state.lines, ...(state.backlog || []), ...(state.landed || [])].find(l => l.id === slug);
  return line.stations.findLast(s => s.kind === "work");
};
const FORM = { score:5, asked:4, proven:3, safe:5, report:5,
  requirements:[{ text:"Hide Topics when off", state:"done" }, { text:"Add a test", state:"partly" }, { text:"nonsense", state:"unknown" }],
  note:"Hid Topics and added a sidebar test, run green. Proven is 3: the Home page has no test." };

test("the score follows from the four ratings of 0 to 5 by rule, whatever the reviewer wrote", () => {
  assert.equal(scoreOf({ asked:5, proven:5, safe:5, report:5 }), 5);
  // To one decimal: a 4 and a 5 no longer read the same.
  assert.equal(scoreOf({ asked:4, proven:5, safe:5, report:5 }), 4.8);
  assert.equal(scoreOf({ asked:4, proven:4, safe:5, report:5 }), 4.5);
  assert.equal(scoreOf({ asked:4.5, proven:4.5, safe:5, report:4.2 }), 4.6);
  assert.equal(scoreOf({ asked:3.0, proven:3.1, safe:3.3, report:3.6 }), 3.3, "exact half-tenth averages round up without float drift");
  assert.equal(scoreOf({ asked:4, proven:3, safe:5, report:5 }), 4);
  assert.equal(scoreOf({ asked:3, proven:3, safe:3, report:3 }), 3);
  // One bad side holds the whole Work down: never more than one above the lowest.
  assert.equal(scoreOf({ asked:5, proven:2, safe:5, report:5 }), 3);
  assert.equal(scoreOf({ asked:5, proven:5, safe:0, report:5 }), 1);
  // The record's scale starts at 1.
  assert.equal(scoreOf({ asked:0, proven:0, safe:0, report:0 }), 1);
  const read = parseReview("I ran {git diff} and read the files. Here is my review:\n```json\n" + JSON.stringify(FORM) + "\n```");
  assert.equal(read.score, 4, "the reviewer said 5, its ratings say 4");
  assert.equal(read.scale, 5);
  assert.deepEqual(read.requirements.map(r => r.state), ["done", "partly"]);
  assert.equal(read.note, FORM.note);
  assert.equal(read.look, undefined, "no places to look or next Ask any more: the note says it");
  assert.equal(read.next, undefined);
  assert.deepEqual(parseReview('{"skip":true}'), { skip:true });
  assert.equal(parseReview("I could not review this."), null);
  assert.equal(parseReview(JSON.stringify({ ...FORM, safe:6 })), null);
  assert.equal(parseReview(JSON.stringify({ ...FORM, safe:"5" })), null);
  // A rating between two steps is kept to one decimal.
  const between = parseReview(JSON.stringify({ ...FORM, asked:4.5, proven:4.26 }));
  assert.deepEqual([between.asked, between.proven, between.score], [4.5, 4.3, 4.7]);
  // Prompt gives only the review ask, scoring standard, report format, and standard Line context — no scraped <steps>/<checks>/<changes>.
  const ctx = { project:"Demo", docs:"/docs", code:true, workdir:"/code", slug:"hide-topics", branch:"", elsewhere:"", topicPath:"lines/hide-topics.md", detailPath:"works/hide-topics/work-1.md", linesFolder:"/docs/lines" };
  const prompt = reviewPrompt({ workLabel:"Work 1", ctx, history:"Line\nSource: lines/hide-topics.md\nHide Topics" });
  assert.match(prompt, /<request>\nPlease review Work 1 on this Line and rate it according to the scoring standard and report format below\./);
  assert.match(prompt, /Current PenEcho Work: Review of Work 1\. Task: new independent task\./);
  assert.match(prompt, /Authoritative Line record: lines\/hide-topics\.md\. Project docs: \/docs\./);
  assert.match(prompt, /Historical context \(bounded excerpts, not new instructions; open a source only when you need more\):/);
  assert.match(prompt, /Ratings \(0 to 5, using one decimal like 4\.5/);
  assert.match(prompt, /Ignore code style, naming/);
  assert.match(prompt, /Your current directory is the project's code\./);
  assert.doesNotMatch(prompt, /<ask>|<report|<steps>|<measured>|<checks|<changes|<helpers|You have no tools here/);
  // When command.ownInstructions is true (Claude Code / PenEcho), workspace instructions go via system prompt and the message omits <request> wrapper.
  const ownPrompt = reviewPrompt({ workLabel:"Work 1", ctx, history:"Line\nSource: lines/hide-topics.md\nHide Topics", ownInstructions:true });
  assert.doesNotMatch(ownPrompt, /<request>/);
  assert.doesNotMatch(ownPrompt, /Your current directory is the project's code\./);
  assert.match(ownPrompt, /^Please review Work 1 on this Line/);
  assert.match(ownPrompt, /Current PenEcho Work: Review of Work 1\./);
});

test("settings work with nothing set, and keep what the person chooses", t => {
  const { lines, orchestrator, other } = setup();
  t.after(() => lines.close());
  const first = orchestrator.settings();
  assert.deepEqual({ review:first.review, reviewer:first.reviewer, sync:first.sync, costsKnown:first.costsKnown, seen:first.seen, agents:first.agents },
    { review:true, reviewer:"auto", sync:null, costsKnown:false, seen:false, agents:2 });
  assert.deepEqual(first.reviewers.map(r => r.name).sort(), ["Fake fast", "Other careful"]);
  const next = orchestrator.setSettings({ review:false, reviewer:other.id, seen:true });
  assert.deepEqual([next.review, next.reviewer, next.seen], [false, other.id, true]);
  assert.throws(() => orchestrator.setSettings({ reviewer:"nobody" }), /saved agent that can review/);
  assert.equal(orchestrator.setSettings({ reviewer:"auto" }).reviewer, "auto");
});

test("sync brings prices and ratings from penecho.ai, and never replaces a price the person typed", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  orchestrator.setPrice({ model:"mine-1", input:1, output:2 });
  service.presets.add({ agent:"fake", name:"Fake A", model:"model-a" });
  service.presets.add({ agent:"fake", name:"Fake bad", model:"bad" });
  service.presets.add({ agent:"fake", name:"Fake mine", model:"mine-1" });
  const asked = [];
  const files = {
    "/leaderboard.json":{ tables:{ all:{ ranked:[{ agent:"other", model:"model-b", effort:"", rating:4.5, rated:8 }, { agent:"fake", model:"model-a", effort:"", rating:2.4, rated:5 }], collecting:[] },
      code:{ ranked:[{ agent:"fake", model:"model-a", effort:"", rating:3, rated:1 }] } } },
    // penecho.ai lists every model, spelled its own way: only the models used here are taken, under their name here.
    "/model-prices.json":{ models:[{ model:"mine-1", input:9, output:9 }, { model:"vendor/Model.A", input:3, output:15, cached:0.3 }, { model:"bad", input:-1, output:2 }, { model:"never-used-here", input:1, output:1 }] },
  };
  orchestrator.reviews.use({ fetch:async url => { asked.push(new URL(url).pathname); const body = files[new URL(url).pathname]; return { ok:Boolean(body), status:body ? 200 : 404, json:async () => body }; } });
  const done = await orchestrator.sync();
  assert.deepEqual(asked.sort(), ["/leaderboard.json", "/model-prices.json"]);
  assert.deepEqual([done.sync.prices, done.sync.ratings, done.addedPrices], [1, 2, 1]);
  assert.equal(done.settings.costsKnown, true);
  const prices = Object.fromEntries(orchestrator.prices().map(p => [p.model, p]));
  assert.equal(prices["mine-1"].input, 1, "a typed price stays");
  assert.deepEqual([prices["model-a"].input, prices["model-a"].cached, prices["model-a"].source], [3, 0.3, "penecho.ai"]);
  assert.equal(prices.bad, undefined);
  assert.equal(prices["never-used-here"], undefined);
  // A later sync refreshes the prices an earlier one brought.
  files["/model-prices.json"].models[1].input = 4;
  delete files["/model-prices.json"].models[1].cached;
  assert.equal((await orchestrator.sync()).addedPrices, 0);
  assert.equal(orchestrator.prices().find(p => p.model === "model-a").input, 4);
  // An agent with no record of its own starts at its penecho.ai rating (2-4.5), not at an imagined 4.
  assert.equal(orchestrator.reviews.cloudStart("other", "model-b", "", "code"), 4.5);
  assert.equal(orchestrator.reviews.cloudStart("fake", "model-a", "", "code"), 2.4, "one rating of a kind is too few: all kinds count");
  assert.equal(orchestrator.reviews.cloudStart("fake", "unknown", "", ""), null);
  // The prices file missing on penecho.ai still syncs the ratings; penecho.ai down says so.
  delete files["/model-prices.json"];
  assert.equal((await orchestrator.sync()).sync.prices, 0);
  // An unavailable Leaderboard (available:false) with working prices preserves previously synced starting ratings.
  files["/leaderboard.json"] = { available:false, tables:{ all:{ ranked:[], collecting:[] } } };
  files["/model-prices.json"] = { models:[{ model:"vendor/Model.A", input:5, output:15 }] };
  await orchestrator.sync();
  assert.equal(orchestrator.reviews.cloudStart("other", "model-b", "", "code"), 4.5, "unavailable Leaderboard keeps last good starting ratings");
  assert.equal(orchestrator.prices().find(p => p.model === "model-a").input, 5, "prices still update");
  delete files["/leaderboard.json"];
  await assert.rejects(orchestrator.sync(), /Could not reach penecho\.ai/);
  void project; void fast; void other;
});

test("a finished orchestrator job is reviewed by another agent, and the review rates the orchestrator's own Work", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  const prompts = [];
  let answers = ["not the form", `Checked the diff and tests.\n${JSON.stringify(FORM)}`];
  orchestrator.reviews.use({ shortMinutes:0, run:async (command, prompt) => { prompts.push({ command, prompt }); await wait(60); return answers.shift(); } });
  const job = await orchestrator.start(project, { goal:"Hide Topics when turned off, and add a test", preset:fast.id });
  await until(() => lineDoc(service, project, job.line).status === "done", "the job finished");
  const pendingStation = await until(() => {
    const st = stationOf(service, project, job.line);
    return st?.reviewing ? st : null;
  }, "the Work says it is being reviewed");
  assert.equal(pendingStation.reviewPending.by, "Other careful");
  assert.equal(pendingStation.reviewPending.agent, "other");
  assert.equal(pendingStation.reviewPending.mode, "auto");
  assert.match(pendingStation.reviewPending.why, /Auto-picked:/);

  // While the review job is running, every server state view reports working rather than To review.
  const fullPending = service.stateOf(project).lines.find(l => l.id === job.line);
  const railPending = service.stateFor(project, "rail").lines.find(l => l.id === job.line);
  const homePending = service.stateFor(project, "home").lines.find(l => l.id === job.line);
  const otherLinePending = service.stateFor(project, "line", { line:"other" }).lines.find(l => l.id === job.line);
  const summaryPending = service.summaryOf(project).lines.find(l => l.id === job.line);
  for (const viewLine of [fullPending, railPending, homePending, otherLinePending]) {
    assert.equal(LINE_STATUS.lineReviewing(viewLine), true);
    assert.equal(LINE_STATUS.toReview(viewLine), false);
    assert.equal(LINE_STATUS.shownState(viewLine), "working");
  }
  assert.equal(summaryPending.shown, "working");
  assert.equal(summaryPending.stations.find(s => s.reviewing)?.reviewing, true);

  const reviewed = await until(() => stationOf(service, project, job.line).review, "the review card");
  const settledLine = service.stateOf(project).lines.find(l => l.id === job.line);
  const railSettled = service.stateFor(project, "rail").lines.find(l => l.id === job.line);
  assert.equal(LINE_STATUS.lineReviewing(settledLine), false);
  assert.equal(LINE_STATUS.toReview(settledLine), true);
  assert.equal(LINE_STATUS.shownState(settledLine), "review");
  assert.equal(LINE_STATUS.toReview(railSettled), true);
  assert.equal(LINE_STATUS.shownState(railSettled), "review");
  assert.equal(service.summaryOf(project).lines.find(l => l.id === job.line).shown, "review");
  assert.equal(prompts.length, 2, "a broken answer is asked for once more");
  assert.match(prompts[0].prompt, /Please review Work 1 on this Line and rate it according to the scoring standard and report format below\./);
  assert.match(prompts[0].prompt, /Current PenEcho Work: Review of Work 1\. Task: new independent task\./);
  assert.match(prompts[0].prompt, /Hide Topics when turned off, and add a test/);
  assert.match(prompts[0].prompt, /Finished the work\./);
  assert.doesNotMatch(prompts[0].prompt, /<steps>|<measured>|<checks|<changes/);
  assert.equal(reviewed.score, 4);
  assert.deepEqual([reviewed.asked, reviewed.proven, reviewed.safe, reviewed.report, reviewed.scale], [4, 3, 5, 5, 5]);
  assert.equal(reviewed.by, "Other careful", "never the agent that did the work");
  assert.equal(reviewed.agent, "other");
  assert.equal(reviewed.mode, "auto");
  assert.equal(reviewed.contextMode, "line");
  assert.match(reviewed.why, /Auto-picked:/);
  assert.equal(reviewed.notes, "Checked the diff and tests.");
  assert.ok(reviewed.took);
  assert.equal(reviewed.note, FORM.note);
  const station = stationOf(service, project, job.line);
  assert.deepEqual([station.orchScore, station.orchBy, station.reviewing], [4, "Other careful", undefined]);
  assert.equal(orchestrator.sessions(project).find(s => s.line === job.line).reviewScore, 4);
  // The review is the rating of that Work in the agent's record.
  assert.equal(orchestrator.records(project).find(r => r.line === job.line).score, 4);
  // Once reviewed, finishing again does not review again.
  assert.equal(orchestrator.lineFinished(project, job.line), null);
  assert.equal(prompts.length, 2);
  void other;
});

test("what the reviewer does is kept as steps of the review, the way a Work's steps are, and shows live while it reads", async t => {
  const { lines, service, orchestrator, project, fast } = setup();
  t.after(() => lines.close());
  // The reviewer prints JSON lines, as Claude Code does.
  const real = service.agents.command;
  service.agents.command = (id, o) => ({ ...real(id, o), ...(id === "other" ? { json:true } : {}) });
  let release, heard = null;
  const held = new Promise(r => { release = r; });
  const say = o => JSON.stringify(o);
  orchestrator.reviews.use({ shortMinutes:0, run:async (command, prompt, opts) => {
    opts.onLine(say({ type:"assistant", message:{ content:[{ type:"tool_use", id:"t1", name:"Read", input:{ file_path:"a.js" } }] } }));
    opts.onLine(say({ type:"user", message:{ content:[{ type:"tool_result", tool_use_id:"t1", content:"const a = 1;" }] } }));
    opts.onLine(say({ type:"assistant", message:{ content:[{ type:"tool_use", id:"t2", name:"Bash", input:{ command:"git diff" } }] } }));
    heard = true;
    await held;
    opts.onLine(say({ type:"user", message:{ content:[{ type:"tool_result", tool_use_id:"t2", content:"+x" }] } }));
    opts.onLine(say({ type:"assistant", message:{ content:[{ type:"text", text:JSON.stringify(FORM) }] } }));
    return JSON.stringify(FORM);
  } });
  const job = await orchestrator.start(project, { goal:"Hide Topics", preset:fast.id });
  await until(() => heard, "the reviewer started reading");
  const work = stationOf(service, project, job.line), step = `${work.id}--review`;
  const live = service.activityOf(project, job.line, 0);
  assert.equal(live.reviews[step], "Checking git diff", "what the reviewer does now");
  const liveRows = live.rows.filter(r => r.step === step);
  assert.deepEqual(liveRows.map(r => r.kind), ["start", "tool", "tool"]);
  assert.equal(liveRows[0].agent, "other");
  assert.deepEqual(liveRows.slice(1).map(r => [r.verb, r.target, r.state]), [["Read", "a.js", "done"], ["Ran", "git diff", "running"]]);
  assert.equal(liveRows[1].output, "const a = 1;");
  assert.ok(liveRows.every(r => !r.id || r.id.startsWith(`${step}/`)), "its tools' ids are kept apart from the Line's Works");
  release();
  await until(() => stationOf(service, project, job.line).review, "the review card");
  const done = service.activityOf(project, job.line, 0), rows = done.rows.filter(r => r.step === step);
  assert.deepEqual(rows.map(r => r.kind), ["start", "tool", "tool", "say"]);
  assert.equal(rows[2].state, "done");
  assert.equal(done.reviews[step], undefined, "nothing is said to be happening once it ends");
  assert.ok(done.rows.filter(r => r.step === work.id).length, "the Work keeps its own steps");
  assert.ok(!done.rows.some(r => r.step === work.id && r.id?.startsWith(step)));
});

test("a reviewer that prints plain words shows them as one reply, and a second try says why", async t => {
  const { lines, service, orchestrator, project, fast } = setup();
  t.after(() => lines.close());
  let tries = 0;
  orchestrator.reviews.use({ shortMinutes:0, run:async (command, prompt, opts) => {
    tries += 1;
    if (tries === 1) { opts.onLine("I read a.js."); opts.onLine("Not the form."); return "Not the form."; }
    opts.onLine("Checked the diff."); opts.onLine(JSON.stringify(FORM));
    return `Checked the diff.\n${JSON.stringify(FORM)}`;
  } });
  const job = await orchestrator.start(project, { goal:"Hide Topics", preset:fast.id });
  await until(() => stationOf(service, project, job.line).review, "the review card");
  const step = `${stationOf(service, project, job.line).id}--review`;
  const rows = service.activityOf(project, job.line, 0).rows.filter(r => r.step === step);
  assert.deepEqual(rows.map(r => r.kind), ["start", "say", "note", "say"]);
  assert.equal(rows[1].text, "I read a.js.\nNot the form.");
  assert.match(rows[2].text, /asked once more/);
  assert.equal(rows[3].text, `Checked the diff.\n${JSON.stringify(FORM)}`);
});

test("with reviews off, or no other agent that can review, the orchestrator's Work stays unrated", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  let ran = 0;
  orchestrator.reviews.use({ shortMinutes:0, run:async () => { ran += 1; return JSON.stringify(FORM); } });
  orchestrator.setSettings({ review:false });
  const off = await orchestrator.start(project, { goal:"First job", preset:fast.id });
  await until(() => lineDoc(service, project, off.line).status === "done", "the first job finished");
  await wait(150);
  assert.equal(ran, 0);
  assert.equal(stationOf(service, project, off.line).orchScore, undefined);
  // A user-selected reviewer that did not do the work records user mode and why.
  orchestrator.setSettings({ review:true, reviewer:other.id });
  const userPicked = orchestrator.reviews.pickReviewer(project, stationOf(service, project, off.line));
  assert.equal(userPicked.reviewer.id, other.id);
  assert.equal(userPicked.mode, "user");
  assert.match(userPicked.why, /Assigned by you in Orchestrator settings/);
  // The chosen reviewer did the work itself: Auto takes over, with the best of the others and explains why.
  orchestrator.setSettings({ review:true, reviewer:fast.id });
  const fallback = orchestrator.reviews.pickReviewer(project, stationOf(service, project, off.line));
  assert.equal(fallback.reviewer.id, other.id);
  assert.equal(fallback.mode, "auto");
  assert.match(fallback.why, /Your assigned reviewer \(Fake fast\) did this work, so Auto picked/);
  assert.equal(orchestrator.reviews.reviewerFor(project, stationOf(service, project, off.line)).id, other.id);
  // Nobody else can review: no review, and no rating.
  service.presets.remove(other.id);
  const others = orchestrator.reviews.reviewerFor;
  orchestrator.reviews.use({ run:async () => { ran += 1; return JSON.stringify(FORM); } });
  assert.equal(others(project, { ...stationOf(service, project, off.line), agent:"other", savedAgentId:"auto:other" })?.agent, "fake");
  const origAvail = service.agents.available;
  service.agents.available = () => origAvail().filter(a => a.id === "fake");
  const alone = await orchestrator.start(project, { goal:"Second job", preset:fast.id });
  await until(() => lineDoc(service, project, alone.line).status === "done", "the second job finished");
  await wait(150);
  assert.equal(ran, 0);
});

test("a short answer that changed nothing is not reviewed", async t => {
  const { lines, service, orchestrator, project, fast } = setup();
  t.after(() => lines.close());
  let ran = 0;
  orchestrator.reviews.use({ run:async () => { ran += 1; return JSON.stringify(FORM); } });
  const job = await orchestrator.start(project, { goal:"What time is it?", preset:fast.id });
  await until(() => lineDoc(service, project, job.line).status === "done", "the job finished");
  await wait(200);
  assert.equal(ran, 0);
  assert.equal(stationOf(service, project, job.line).review, undefined);
});

test("PenEcho Auto starts an agent only when picked, and the job says which", async t => {
  const { lines, service, orchestrator, project } = setup();
  t.after(() => lines.close());
  orchestrator.setSettings({ review:false });
  // With no price and no record, the better rated on penecho.ai is started.
  orchestrator.reviews.use({ fetch:async url => {
    const body = new URL(url).pathname === "/leaderboard.json" ? { tables:{ all:{ ranked:[{ agent:"other", model:"m-other", effort:"", rating:4.5, rated:9 }, { agent:"fake", model:"m-fake", effort:"", rating:3, rated:9 }] } } } : null;
    return { ok:Boolean(body), status:body ? 200 : 404, json:async () => body };
  } });
  await orchestrator.sync();
  service.presets.add({ agent:"fake", name:"Fake m", model:"m-fake" });
  const good = service.presets.add({ agent:"other", name:"Other m", model:"m-other" });
  const job = await orchestrator.start(project, { goal:"Any job", preset:"auto" });
  await until(() => lineDoc(service, project, job.line).status === "done", "the job finished");
  assert.equal(stationOf(service, project, job.line).savedAgentId, good.id);
  // A hundred times the price does not turn it round: cost only decides between agents rated alike (project-line-orch-auto.test.js).
  orchestrator.setPrice({ model:"m-fake", input:0.1, output:0.2 });
  orchestrator.setPrice({ model:"m-other", input:10, output:50 });
  const priced = await orchestrator.start(project, { goal:"Another job", preset:"auto" });
  await until(() => lineDoc(service, project, priced.line).status === "done", "the second job finished");
  assert.equal(stationOf(service, project, priced.line).savedAgentId, good.id);
  await assert.rejects(orchestrator.start(project, { goal:"x", preset:"missing" }), /Choose a runnable agent/);
});

test("only the first job on an Orchestrator-started Line is auto-reviewed; clicking Review starts the same reviewer flow on demand", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  const third = service.presets.add({ agent:"other", name:"Other deep", model:"other-deep", effort:"high" });
  const ran = [];
  let holdNext = null, releaseNext = null;
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (command, prompt, opts) => {
      ran.push({ command, prompt });
      opts?.onLine?.("Checked diff and tests.");
      if (holdNext) {
        const p = holdNext;
        holdNext = null;
        await p;
      }
      return `Checked diff and tests.\n${JSON.stringify(FORM)}`;
    },
  });

  // Settings includes agent/model/effort metadata for the Work panel reviewer picker.
  const cfg = orchestrator.settings();
  const deepRow = cfg.reviewers.find(r => r.id === third.id);
  assert.deepEqual(deepRow, { id:third.id, name:"Other deep", agent:"other", model:"other-deep", effort:"high" });

  // 1. A user's manually created Line is never auto-reviewed, even on its first job.
  const manual = await service.request(project, { text:"Manual line first job", preset:fast.id });
  await until(() => lineDoc(service, project, manual.slug).status === "done", "manual line finished");
  await wait(150);
  assert.equal(ran.length, 0, "manual Line is not auto-reviewed");
  assert.equal(stationOf(service, project, manual.slug).review, undefined);
  assert.equal(orchestrator.lineFinished(project, manual.slug), null);

  // 2. A job sent through Orchestrator starts a new Line; its first job is auto-reviewed.
  const job = await orchestrator.start(project, { goal:"First job", preset:fast.id });
  const firstWork = stationOf(service, project, job.line);
  const first = await until(() => stationOf(service, project, job.line).review, "the first job's review");
  assert.equal(first.mode, "auto");
  assert.equal(first.manual, undefined);
  assert.equal(ran.length, 1);

  // 3. A second job (new Ask) on the same Orchestrator Line is NOT auto-reviewed.
  await service.addFeedback(project, job.line, { text:"Now a second job" });
  await until(() => { const s = stationOf(service, project, job.line); return s.state === "done" && s.id !== firstWork.id && lineDoc(service, project, job.line).status === "done"; }, "the second job finished");
  await wait(150);
  const second = stationOf(service, project, job.line);
  assert.equal(ran.length, 1, "no auto-review started for later job");
  assert.equal(second.review, undefined);
  assert.equal(second.reviewing, undefined);
  assert.equal(orchestrator.reviews.lineFinished(project, job.line), null);

  // 4. Clicking Review on the later job via POST .../orchestrator/review runs the exact same reviewer task & report flow.
  const http = require("node:http");
  const server = http.createServer((req, res) => lines.handle(req, res, new URL(req.url, "http://127.0.0.1")));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/lines/projects/${project.id}/orchestrator/review`;

  holdNext = new Promise(r => { releaseNext = r; });
  const startRes = await fetch(url, { method:"POST", body:JSON.stringify({ line:job.line, work:second.id, reviewer:third.id }) });
  assert.equal(startRes.status, 200);
  const started = await startRes.json();
  assert.equal(started.ok, true);
  assert.equal(started.line, job.line);
  assert.equal(started.work, second.id);
  assert.equal(started.step, `${second.id}--review`);
  assert.equal(started.reviewPending.by, "Other deep");
  assert.equal(started.reviewPending.agent, "other");
  assert.equal(started.reviewPending.mode, "user");
  assert.equal(started.reviewPending.manual, true);
  assert.match(started.reviewPending.why, /Selected by you to review this Work/);

  // While running, the Line reports reviewing/working and refuses a duplicate concurrent request.
  const pendingSecond = stationOf(service, project, job.line);
  assert.equal(pendingSecond.reviewing, true);
  assert.equal(LINE_STATUS.lineReviewing(service.stateOf(project).lines.find(l => l.id === job.line)), true);
  const dupRes = await fetch(url, { method:"POST", body:JSON.stringify({ line:job.line, work:second.id, reviewer:"auto" }) });
  assert.equal(dupRes.status, 409);

  releaseNext();
  const secondReview = await until(() => stationOf(service, project, job.line).review, "second job manual review");
  assert.equal(secondReview.score, 4);
  assert.equal(secondReview.by, "Other deep");
  assert.equal(secondReview.agent, "other");
  assert.equal(secondReview.mode, "user");
  assert.equal(secondReview.manual, true);
  assert.equal(secondReview.note, FORM.note);
  assert.deepEqual([secondReview.asked, secondReview.proven, secondReview.safe, secondReview.report], [4, 3, 5, 5]);
  const secondAct = service.activityOf(project, job.line, 0).rows.filter(r => r.step === `${second.id}--review`);
  assert.ok(secondAct.some(r => r.kind === "start" && r.agent === "other"));

  // 5. Review again with PenEcho Auto replaces the review record cleanly.
  const againRes = await fetch(url, { method:"POST", body:JSON.stringify({ line:job.line, work:second.id, reviewer:"auto" }) });
  assert.equal(againRes.status, 200);
  const again = await againRes.json();
  assert.equal(again.reviewPending.mode, "auto");
  const updatedReview = await until(() => {
    const st = stationOf(service, project, job.line);
    return !st.reviewing && st.review?.mode === "auto" ? st.review : null;
  }, "re-review with auto");
  assert.equal(updatedReview.manual, true);
  assert.match(updatedReview.why, /Auto-picked:/);

  // 6. Manual review also works on a manually created Line even when auto-review is turned off and answer is short.
  orchestrator.setSettings({ review:false, reviewer:other.id });
  orchestrator.reviews.use({ shortMinutes:99 });
  const manualWork = stationOf(service, project, manual.slug);
  const manualRes = await fetch(url, { method:"POST", body:JSON.stringify({ line:manual.slug, work:manualWork.id }) });
  assert.equal(manualRes.status, 200);
  const manualReview = await until(() => stationOf(service, project, manual.slug).review, "manual line explicit review");
  assert.equal(manualReview.by, "Other careful");
  assert.equal(manualReview.mode, "user");
  assert.match(manualReview.why, /Assigned by you in Orchestrator settings/);
  assert.equal(manualReview.manual, true);

  // 7. Validation errors: same agent, unknown preset, unknown Work.
  const sameRes = await fetch(url, { method:"POST", body:JSON.stringify({ line:job.line, work:second.id, reviewer:fast.id }) });
  assert.equal(sameRes.status, 400);
  const badRes = await fetch(url, { method:"POST", body:JSON.stringify({ line:job.line, work:second.id, reviewer:"nope" }) });
  assert.equal(badRes.status, 400);
  const missingWorkRes = await fetch(url, { method:"POST", body:JSON.stringify({ line:job.line, work:"work-999", reviewer:"auto" }) });
  assert.equal(missingWorkRes.status, 404);
});

test("reviewer excludes same-runner alias/unresolved model and refuses symlinks outside project docs", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  const pinnedOpus = service.presets.add({ agent:"fake", name:"Fake Opus", model:"fake-opus-5-5" });
  // A Work on "fake" with alias "opus" or unresolved model must not pick pinned "fake-opus-5-5" as reviewer.
  assert.equal(orchestrator.reviews.reviewerFor(project, { agent:"fake", model:"opus", savedAgentId:"different" }).id, other.id);
  assert.equal(orchestrator.reviews.reviewerFor(project, { agent:"fake", model:"", savedAgentId:"different" }).id, other.id);
  assert.notEqual(orchestrator.reviews.reviewerFor(project, { agent:"fake", model:"opus", savedAgentId:"different" }).id, pinnedOpus.id);
  // A symlink inside project docs/files pointing outside must never be read into the reviewer prompt.
  const secretFile = path.join(temp, `outside-secret-${counter}.md`);
  fs.writeFileSync(secretFile, "TOP_SECRET_OUTSIDE_PROJECT");
  const filesDir = path.join(project.docsPath, "files");
  fs.mkdirSync(filesDir, { recursive:true });
  const linkPath = path.join(filesDir, "escape.md");
  fs.symlinkSync(secretFile, linkPath);
  const prompts = [];
  orchestrator.reviews.use({ shortMinutes:0, run:async (command, prompt) => { prompts.push(prompt); return JSON.stringify(FORM); } });
  // Start with reviews off so we can inject the symlink step before the first job's auto-review runs.
  orchestrator.setSettings({ review:false });
  const job2 = await orchestrator.start(project, { goal:"Write another note", preset:fast.id });
  await until(() => lineDoc(service, project, job2.line).status === "done", "job2 finished");
  const work2 = stationOf(service, project, job2.line);
  const md = service.store.readText(project, work2.detail).text;
  service.store.writeText(project, work2.detail, `${md}\n\n## How it was done\n\n- Wrote \`${linkPath}\`\n`);
  prompts.length = 0;
  orchestrator.setSettings({ review:true, reviewer:other.id });
  orchestrator.lineFinished(project, job2.line);
  await until(() => stationOf(service, project, job2.line).review, "job2 reviewed");
  assert.equal(prompts.length, 1);
  assert.doesNotMatch(prompts[0], /TOP_SECRET_OUTSIDE_PROJECT/);
});

test("active review can be stopped via review/stop or Line Stop, and unexpected stops support Continue and Send again", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  const third = service.presets.add({ agent:"other", name:"Other backup", model:"other-b", effort:"high" });
  const realCommand = service.agents.command;
  service.agents.command = (id, o = {}) => ({ ...realCommand(id, o), ...(id === "other" ? { json:true, resumes:true, ...(o.resume ? { resume:o.resume } : {}) } : {}) });

  const http = require("node:http");
  const server = http.createServer((req, res) => lines.handle(req, res, new URL(req.url, "http://127.0.0.1")));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/lines/projects/${project.id}/orchestrator/review`;

  // Start an orchestrator job with auto-review off so we control each review run deterministically.
  orchestrator.setSettings({ review:false });
  const job = await orchestrator.start(project, { goal:"Implement review stop and retry controls", preset:fast.id });
  await until(() => lineDoc(service, project, job.line).status === "done", "job finished");
  const work = stationOf(service, project, job.line);

  // 1. Active review can be stopped via POST /orchestrator/review/stop; AbortSignal fires immediately and records reviewStopped.
  const runs = [];
  let aborted = false, startedFirst = null;
  const firstStarted = new Promise(r => { startedFirst = r; });
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (command, prompt, opts) => {
      runs.push({ command, prompt });
      opts.onLine(JSON.stringify({ type:"system", subtype:"init", session_id:"rev-sess-1" }));
      opts.onLine(JSON.stringify({ type:"assistant", message:{ content:[{ type:"tool_use", id:"t1", name:"Read", input:{ file_path:"a.js" } }] } }));
      startedFirst?.();
      return await new Promise((resolve, reject) => {
        if (opts.signal?.aborted) { aborted = true; return reject(Object.assign(new Error("Stopped."), { code:"STOPPED" })); }
        opts.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("Stopped."), { code:"STOPPED" }));
        });
      });
    },
  });

  const startRes = await fetch(base, { method:"POST", body:JSON.stringify({ line:job.line, work:work.id, reviewer:other.id }) });
  assert.equal(startRes.status, 200);
  await firstStarted;
  // Orchestrator sessions payload marks reviewing & canStop while the review runs.
  const sessWhile = orchestrator.sessions(project).find(s => s.line === job.line);
  assert.equal(sessWhile.reviewing, true);
  assert.equal(sessWhile.canStop, true);

  const stopRes = await fetch(`${base}/stop`, { method:"POST", body:JSON.stringify({ line:job.line, work:work.id }) });
  assert.equal(stopRes.status, 200);
  const stopData = await stopRes.json();
  assert.equal(aborted, true, "AbortSignal aborts the running reviewer process");
  assert.equal(stopData.ok, true);
  assert.equal(stopData.reviewStopped.stopWhy, "stopped");
  assert.equal(stopData.reviewStopped.sessionId, "rev-sess-1");
  assert.equal(stopData.reviewStopped.canContinue, true);
  const afterUserStop = stationOf(service, project, job.line);
  assert.equal(afterUserStop.reviewing, undefined);
  assert.equal(afterUserStop.reviewStopped.stopWhy, "stopped");
  assert.equal(lineDoc(service, project, job.line).status, "done", "stopping a review never turns a finished Line into stopped");

  // 2. Stopping via service.stopWork (the Line header Stop button) also stops an active review on a finished Line without throwing.
  let abortedByLineStop = false, startedSecond = null;
  const secondStarted = new Promise(r => { startedSecond = r; });
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (command, prompt, opts) => {
      runs.push({ command, prompt });
      startedSecond?.();
      return await new Promise((resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          abortedByLineStop = true;
          reject(Object.assign(new Error("Stopped."), { code:"STOPPED" }));
        });
      });
    },
  });
  const resendRes1 = await fetch(`${base}/resend`, { method:"POST", body:JSON.stringify({ line:job.line, work:work.id, reviewer:other.id }) });
  assert.equal(resendRes1.status, 200);
  await secondStarted;
  await service.stopWork(project, job.line);
  assert.equal(abortedByLineStop, true, "Line Stop aborts the active background review");
  assert.equal(stationOf(service, project, job.line).reviewing, undefined);
  assert.equal(stationOf(service, project, job.line).reviewStopped.stopWhy, "stopped");
  assert.equal(lineDoc(service, project, job.line).status, "done", "finished Line stays done after stopping its review");

  // 3. Unexpected stop (rate limit) records stopWhy="limit", does not retry blindly, and stays visible for Continue / Resend.
  let limitCalls = 0;
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (command, prompt, opts) => {
      limitCalls += 1;
      opts.onLine(JSON.stringify({ type:"system", subtype:"init", session_id:"rev-sess-limit" }));
      throw Object.assign(new Error("You've hit your 5-hour limit · resets 2:10pm"), { code:"AGENT_FAILED" });
    },
  });
  const limitStart = await fetch(`${base}/resend`, { method:"POST", body:JSON.stringify({ line:job.line, work:work.id, reviewer:other.id }) });
  assert.equal(limitStart.status, 200);
  const limitStopped = await until(() => {
    const st = stationOf(service, project, job.line);
    return !st.reviewing && st.reviewStopped?.stopWhy === "limit" ? st.reviewStopped : null;
  }, "rate limit review stop");
  assert.equal(limitCalls, 1, "rate limit stops immediately without a wasteful second attempt");
  assert.equal(limitStopped.sessionId, "rev-sess-limit");
  assert.equal(limitStopped.canContinue, true);
  assert.ok(limitStopped.resetsAt > 0);

  // 4. Continue resumes the captured reviewer session (passing resume: sessionId) and clears reviewStopped once done.
  const continuedRuns = [];
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (command, prompt, opts) => {
      continuedRuns.push({ command, prompt });
      opts.onLine(JSON.stringify({ type:"assistant", message:{ content:[{ type:"text", text:JSON.stringify(FORM) }] } }));
      return JSON.stringify(FORM);
    },
  });
  const contRes = await fetch(`${base}/continue`, { method:"POST", body:JSON.stringify({ line:job.line, work:work.id }) });
  assert.equal(contRes.status, 200);
  const finishedReview = await until(() => {
    const st = stationOf(service, project, job.line);
    return !st.reviewing && st.review ? st : null;
  }, "continued review finished");
  assert.equal(continuedRuns.length, 1);
  assert.equal(continuedRuns[0].command.resume, "rev-sess-limit", "Continue passes saved session id to resume");
  assert.match(continuedRuns[0].prompt, /Continue from where you left off/);
  assert.equal(finishedReview.reviewStopped, undefined, "reviewStopped clears once review succeeds");
  assert.equal(finishedReview.review.score, 4);
  const actRows = service.activityOf(project, job.line, 0).rows.filter(r => r.step === `${work.id}--review`);
  assert.ok(actRows.some(r => r.kind === "start" && r.resumed === true), "activity logs resumed start row");

  // 5. Unexpected error without a native resumable session still supports Continue (with <previous-attempt> context) AND Resend with a different reviewer.
  service.agents.command = (id, o = {}) => ({ ...realCommand(id, o), ...(id === "other" ? { json:true, resumes:false } : {}) });
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async () => { throw Object.assign(new Error("Network connection reset"), { code:"AGENT_FAILED" }); },
  });
  const errStart = await fetch(base, { method:"POST", body:JSON.stringify({ line:job.line, work:work.id, reviewer:other.id }) });
  assert.equal(errStart.status, 200);
  const errStopped = await until(() => {
    const st = stationOf(service, project, job.line);
    return !st.reviewing && st.reviewStopped?.stopWhy === "error" ? st.reviewStopped : null;
  }, "error review stop");
  assert.match(errStopped.reason, /Network connection reset/);
  assert.equal(errStopped.canContinue, true);

  // Resend with a different reviewer (third) runs fresh (no resume, no previous-attempt block) and records the new reviewer.
  const freshRuns = [];
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (command, prompt) => { freshRuns.push({ command, prompt }); return JSON.stringify(FORM); },
  });
  const resendOther = await fetch(`${base}/resend`, { method:"POST", body:JSON.stringify({ line:job.line, work:work.id, reviewer:third.id }) });
  assert.equal(resendOther.status, 200);
  const resent = await until(() => {
    const st = stationOf(service, project, job.line);
    return !st.reviewing && st.review?.by === "Other backup" ? st.review : null;
  }, "resent review with another reviewer");
  assert.equal(resent.by, "Other backup");
  assert.equal(freshRuns.length, 1);
  assert.doesNotMatch(freshRuns[0].prompt, /<previous-attempt/);
});

test("unified 3-dimension scoreOf, parseReview, and lean simple-task prompts match all calibration cases with no bonus/penalty modifiers", () => {
  // Simple chat ("hi" -> "hi"): N/A verification and safety never penalize.
  assert.equal(scoreOf({ outcome:5, verification:null, safety:null }), 5);
  // Quick code Q&A backed by reading the file.
  assert.equal(scoreOf({ outcome:5, verification:5, safety:null }), 5);
  // Feature built & tests pass, 1 minor UI edge case: 0.6*4 + 0.2*4.5 + 0.2*5 = 4.3.
  assert.equal(scoreOf({ outcome:4, verification:4.5, safety:5 }), 4.3);
  // Real bug in core logic: 0.6*2.5 + 0.2*3 + 0.2*4 = 2.9.
  assert.equal(scoreOf({ outcome:2.5, verification:3, safety:4 }), 2.9);
  // Investigated bug well, crashed live server: (0.6*4.5+0.2*3+0.2*1)=3.5, capped at safety+1 = 2.0 (strictly from safety, no reportMismatch penalty).
  assert.equal(scoreOf({ outcome:4.5, verification:3, safety:1 }), 2);
  // Reviewer has NO authority to subtract (reportMismatch/penalty) or add (bonus) points outside outcome/verification/safety.
  assert.equal(scoreOf({ outcome:4, verification:4.5, safety:5, reportMismatch:"claimed tests passed" }), 4.3);
  assert.equal(scoreOf({ outcome:4, verification:4.5, safety:5, bonus:1, penalty:-1 }), 4.3);
  // Low verification alone does NOT trigger min+1 cap when outcome and safety are healthy.
  assert.equal(scoreOf({ outcome:4.5, verification:1, safety:5 }), 3.9);
  // Unverified verdict or null outcome returns null (excluded from stats).
  assert.equal(scoreOf({ verdict:"unverified", outcome:4, verification:4, safety:5 }), null);
  assert.equal(scoreOf({ outcome:null, verification:null, safety:null }), null);

  const parsedReady = parseReview(JSON.stringify({
    verdict:"ready", outcome:5, verification:null, safety:null,
    requirements:[{ text:"Greet the user", state:"done" }],
    findings:[], note:"Replied warmly to the greeting.",
  }));
  assert.equal(parsedReady.schema, 2);
  assert.equal(parsedReady.verdict, "ready");
  assert.equal(parsedReady.score, 5);
  assert.deepEqual([parsedReady.outcome, parsedReady.verification, parsedReady.safety], [5, null, null]);

  // Even if a model sends reportMismatch or bonus in JSON, parseReview ignores them and scores strictly from the 3 dimensions.
  const parsedNoPenalty = parseReview(JSON.stringify({
    outcome:4.5, verification:4.5, safety:5, reportMismatch:"some claim", bonus:1,
    requirements:[{ text:"Deliver feature", state:"done" }],
    findings:[], note:"Delivered cleanly.",
  }));
  assert.equal(parsedNoPenalty.score, 4.6);
  assert.equal(parsedNoPenalty.verdict, "ready");
  assert.equal(parsedNoPenalty.reportMismatch, undefined);

  const parsedFix = parseReview(JSON.stringify({
    verdict:"fix", outcome:2.5, verification:3, safety:4,
    requirements:[{ text:"Sum raw values before rounding", state:"missed" }],
    findings:[{ kind:"bug", where:"src/server/usage-stats.js:84", detail:"Rounded before summing (8.6 instead of 8.5)." }],
    note:"Daily total rounded prematurely.",
  }));
  assert.equal(parsedFix.verdict, "fix");
  assert.equal(parsedFix.score, 2.9);
  assert.deepEqual(parsedFix.findings, [{ kind:"bug", where:"src/server/usage-stats.js:84", detail:"Rounded before summing (8.6 instead of 8.5)." }]);

  const parsedUnv = parseReview(JSON.stringify({
    verdict:"unverified", outcome:3, verification:3, safety:5,
    requirements:[{ text:"Fix cache miss cost", state:"done" }],
    findings:[{ kind:"unverified", where:"test/token.test.js", detail:"Diff and test results were omitted." }],
    note:"Cannot verify outcome without the changed file and test output.",
  }));
  assert.equal(parsedUnv.verdict, "unverified");
  assert.equal(parsedUnv.score, null, "unverified review never produces a numeric score");
  assert.equal(parsedUnv.outcome, null);

  // Prompt only states what to review, the scoring standard, and the report format — no pre-scraped evidence XML blocks.
  const askText = reviewAsk("Work 2");
  assert.match(askText, /^Please review Work 2 on this Line and rate it according to the scoring standard and report format below\./);
  assert.match(askText, /Never guess a midpoint 3 when key evidence is missing/);
  assert.match(askText, /Never penalize a simple task/);
  assert.match(askText, /Do not add bonus points or deduct penalty points/);
  assert.doesNotMatch(askText, /"reportMismatch"|<ask>|<report|<steps>|<measured>|<checks|<changes|<helpers/);
});

test("reviewer runs like another job on the same Line via agents.command with TaskContext and no scraped evidence packet", async t => {
  const { execFileSync } = require("node:child_process");
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());

  // 1. Every runnable agent is eligible for Auto-pick (including xhigh/max effort presets and agents without answer()).
  const xhighOther = service.presets.add({ agent:"other", name:"Other xhigh", model:"m-xh", effort:"xhigh" });
  const medOther = service.presets.add({ agent:"other", name:"Other medium", model:"m-med", effort:"medium" });
  const pickedCode = orchestrator.reviews.pickReviewer(project, { agent:"fake", savedAgentId:fast.id, model:"m-fast", diff:{ files:2, add:10, del:2 } }, "auto");
  assert.ok([other.id, medOther.id, xhighOther.id].includes(pickedCode.reviewer.id));

  // 2. Git repo attached to project: reviewer launches via agents.command in the Line's real code folder with docs, gitDir, and TaskContext.
  const repoDir = path.join(temp, `git-repo-${counter}`);
  fs.mkdirSync(repoDir, { recursive:true });
  const runGit = args => execFileSync("git", args, { cwd:repoDir, encoding:"utf8", env:{ ...process.env, GIT_AUTHOR_NAME:"Test", GIT_AUTHOR_EMAIL:"t@t", GIT_COMMITTER_NAME:"Test", GIT_COMMITTER_EMAIL:"t@t" } });
  runGit(["init", "-q"]);
  fs.writeFileSync(path.join(repoDir, "app.js"), "exports.sum = (a, b) => a + b;\n");
  runGit(["add", "app.js"]);
  runGit(["commit", "-q", "-m", "init"]);
  project.codePaths = [repoDir];

  orchestrator.setSettings({ review:false });
  const job = await orchestrator.start(project, { goal:"Fix sum rounding", preset:fast.id });
  await until(() => lineDoc(service, project, job.line).status === "done", "job finished");
  const work = stationOf(service, project, job.line);

  // Modify a tracked file and add a test run in activity log: PenEcho MUST NOT scrape/embed them into the prompt; the reviewer reads the workspace itself.
  fs.writeFileSync(path.join(repoDir, "app.js"), "exports.sum = (a, b) => Math.round((a + b) * 10) / 10;\n");
  service.activity.add(project, job.line, { kind:"tool", step:work.id, verb:"Ran", target:"node --test test/sum.test.js", state:"done", output:"SHOULD_NOT_BE_SCRAPED_INTO_PROMPT" });

  const commandCalls = [];
  const realCommand = service.agents.command;
  service.agents.command = (id, opts) => {
    commandCalls.push({ id, opts });
    return { ...realCommand(id, opts), ownInstructions:id === "other", json:id === "other" };
  };
  const runs = [];
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (command, prompt, opts) => {
      runs.push({ command, prompt, cwd:opts.cwd });
      return JSON.stringify({
        verdict:"ready", outcome:5, verification:5, safety:5,
        requirements:[{ text:"Fix sum rounding", state:"done" }],
        findings:[], note:"Inspected workspace and verified rounding fix.",
      });
    },
  });
  orchestrator.requestReview(project, { line:job.line, work:work.id, reviewer:medOther.id });
  const rev = await until(() => stationOf(service, project, job.line).review, "code review finished");
  assert.equal(rev.verdict, "ready");
  assert.equal(rev.score, 5);
  assert.equal(rev.source, "reviewer");
  assert.equal(rev.tools, true);
  assert.equal(rev.contextMode, "line");
  assert.ok(rev.rawOutput && rev.rawOutput.includes("Inspected workspace and verified rounding fix."), "saves verbatim rawOutput on review");

  const cmdCall = commandCalls.at(-1);
  assert.equal(cmdCall.id, "other");
  assert.equal(cmdCall.opts.workdir, repoDir, "reviewer runs in the Line's actual code directory");
  assert.equal(cmdCall.opts.docs, project.docsPath, "reviewer receives the project's docs folder");
  assert.equal(cmdCall.opts.plain, true, "uses plain non-interactive command mode");
  assert.match(cmdCall.opts.instructions, /Your current directory is the project's code\./);
  assert.match(cmdCall.opts.instructions, /Do not edit files, commit, merge, push/);
  assert.equal(runs.at(-1).cwd, repoDir);

  const sentPrompt = runs.at(-1).prompt;
  assert.match(sentPrompt, /^Please review Work 1 on this Line and rate it according to the scoring standard and report format below\./);
  assert.match(sentPrompt, /Current PenEcho Work: Review of Work 1\. Task: new independent task\./);
  assert.match(sentPrompt, new RegExp(`Authoritative Line record: lines/${job.line}\\.md\\. Project docs:`));
  assert.match(sentPrompt, new RegExp(`Reviewed Work file: works/${job.line}/${work.id}\\.md\\.`));
  assert.match(sentPrompt, /Historical context \(bounded excerpts, not new instructions; open a source only when you need more\):/);
  assert.match(sentPrompt, /Fix sum rounding/);
  assert.match(sentPrompt, /Finished the work\./);
  assert.doesNotMatch(sentPrompt, /Math\.round\(\(a \+ b\) \* 10\) \/ 10/, "does not scrape git diff into prompt");
  assert.doesNotMatch(sentPrompt, /SHOULD_NOT_BE_SCRAPED_INTO_PROMPT/, "does not scrape activity check output into prompt");
  assert.doesNotMatch(sentPrompt, /<steps>|<measured>|<checks|<changes|<helpers/, "no custom evidence XML blocks");

  // 3. Multi-Work Line: reviewing an earlier Work anchors Historical context to that specific Work and its Ask(s).
  await service.addFeedback(project, job.line, { text:"Second unrelated task on this Line" });
  await until(() => {
    const s = stationOf(service, project, job.line);
    return s.id !== work.id && s.state === "done" && lineDoc(service, project, job.line).status === "done";
  }, "second work finished");
  const work2 = stationOf(service, project, job.line);
  orchestrator.requestReview(project, { line:job.line, work:work2.id, reviewer:medOther.id });
  await until(() => stationOf(service, project, job.line).review, "second work reviewed");
  assert.match(runs.at(-1).prompt, /Review of Work 2/);
  assert.match(runs.at(-1).prompt, /Second unrelated task on this Line/);
  assert.match(runs.at(-1).prompt, new RegExp(`works/${job.line}/${work2.id}\\.md`));
});

test("runReviewCommand handles stream-json control requests, pi-rpc UI cancellation, and Antigravity exit-1 activity parsing", async t => {
  const { parseDialect } = require("../src/server/project-lines/activity.js");

  // 1. parseDialect("antigravity") marks non-zero shell commands failed even when output exceeds OUTPUT_MAX and error is empty.
  const hugeFailOut = `Created At: 2026-11-23T09:21:40Z\nCompleted At: 2026-11-23T09:21:42Z\nCommand exited with code 1.\n\nCommand output:\n${"x".repeat(7000)}\nAssertionError: failed`;
  const agyFail = parseDialect("antigravity", JSON.stringify({
    event:"step_update",
    step_update:{ step_index:12, step_type:"tool", state:"DONE", tool_name:"run_command", tool_info:{ parameters:{ CommandLine:"node --test test/a.test.js" }, output:hugeFailOut } },
  }), {});
  assert.equal(agyFail[0].upsert.state, "failed", "detects Command exited with code 1 before tail truncation");
  const agyPass = parseDialect("antigravity", JSON.stringify({
    event:"step_update",
    step_update:{ step_index:13, step_type:"tool", state:"DONE", tool_name:"run_command", tool_info:{ parameters:{ CommandLine:"node --test test/a.test.js" }, output:"Created At: x\nCompleted At: y\nCommand exited with code 0.\n\nCommand output:\nℹ pass 5\nℹ fail 0" } },
  }), {});
  assert.equal(agyPass[0].upsert.state, "done");

  // 2. stream-json protocol (Claude / PenEcho): sends userLine, allows Read control_request, denies Edit control_request, closes stdin on result.
  const streamScript = path.join(temp, `stream-reviewer-${counter}.cjs`);
  fs.writeFileSync(streamScript, `
const readline = require("node:readline");
const say = o => console.log(JSON.stringify(o));
const seen = [];
const rl = readline.createInterface({ input:process.stdin });
rl.on("line", line => {
  const msg = JSON.parse(line);
  seen.push(msg);
  if (msg.type === "user") {
    say({ type:"system", subtype:"init", session_id:"stream-rev-1" });
    say({ type:"control_request", request_id:"req-read", request:{ subtype:"can_use_tool", tool_name:"Read", input:{ file_path:"a.js" } } });
    say({ type:"control_request", request_id:"req-edit", request:{ subtype:"can_use_tool", tool_name:"Edit", input:{ file_path:"a.js" } } });
  }
  if (seen.filter(m => m.type === "control_response").length === 2) {
    const resps = seen.filter(m => m.type === "control_response").map(m => [m.response.request_id, m.response.response.behavior]);
    const final = JSON.stringify({ verdict:"ready", outcome:5, verification:5, safety:5, requirements:[{ text:"Check", state:"done" }], findings:[], note:JSON.stringify(resps) });
    say({ type:"assistant", message:{ content:[{ type:"text", text:final }] } });
    say({ type:"result", subtype:"success", is_error:false, result:final });
  }
});
`);
  const streamOut = await runReviewCommand(
    { command:process.execPath, args:[streamScript], input:"stream-json" },
    "Review prompt",
    { cwd:temp, waitMs:10000 }
  );
  const parsedStream = parseReview(streamOut);
  assert.equal(parsedStream.verdict, "ready");
  assert.deepEqual(JSON.parse(parsedStream.note), [["req-read", "allow"], ["req-edit", "deny"]]);

  // 3. pi-rpc protocol (Pi / omp): sends piRpcInit, cancels extension_ui_request, closes stdin on agent_end, and respects keepFailed on error.
  const piScript = path.join(temp, `pi-reviewer-${counter}.cjs`);
  fs.writeFileSync(piScript, `
const readline = require("node:readline");
const say = o => console.log(JSON.stringify(o));
const rl = readline.createInterface({ input:process.stdin });
rl.on("line", line => {
  const msg = JSON.parse(line);
  if (msg.type === "get_state") say({ type:"response", id:msg.id, command:"get_state", success:true, data:{ sessionId:"pi-rev-1" } });
  if (msg.type === "prompt") say({ type:"extension_ui_request", id:"ui-1", method:"confirm", title:"Proceed?" });
  if (msg.type === "extension_ui_response" && msg.cancelled) {
    const final = JSON.stringify({ verdict:"ready", outcome:5, verification:null, safety:null, requirements:[{ text:"Reply", state:"done" }], findings:[], note:"Pi RPC worked." });
    say({ type:"message_end", message:{ role:"assistant", stopReason:"end_turn", content:[{ type:"text", text:final }] } });
    say({ type:"agent_end" });
  }
});
`);
  const piOut = await runReviewCommand(
    { command:process.execPath, args:[piScript], input:"pi-rpc", dialect:"pi" },
    "Review prompt",
    { cwd:temp, waitMs:10000 }
  );
  const parsedPi = parseReview(piOut);
  assert.equal(parsedPi.verdict, "ready");
  assert.equal(parsedPi.note, "Pi RPC worked.");
  void t;
});

test("unverified reviews and ignoreReview exclude scores from stats, ranking, and agentDays while staying visible on the Line", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  const http = require("node:http");
  const server = http.createServer((req, res) => lines.handle(req, res, new URL(req.url, "http://127.0.0.1")));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/lines/projects/${project.id}/orchestrator/review`;

  orchestrator.setSettings({ review:false });
  const job1 = await orchestrator.start(project, { goal:"Unverifiable task", preset:fast.id });
  const job2 = await orchestrator.start(project, { goal:"Task with bug", preset:fast.id });
  await until(() => lineDoc(service, project, job1.line).status === "done" && lineDoc(service, project, job2.line).status === "done", "jobs done");
  const w1 = stationOf(service, project, job1.line), w2 = stationOf(service, project, job2.line);

  // 1. Unverified review: visible on station.review, NO orchScore, excluded from stats/agentDays/sessions reviewScore.
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async () => JSON.stringify({
      verdict:"unverified", outcome:null, verification:null, safety:null,
      requirements:[{ text:"Check missing evidence", state:"partly" }],
      findings:[{ kind:"unverified", where:"bench.log", detail:"Benchmark output was not attached." }],
      note:"Need benchmark output to judge this Work.",
    }),
  });
  orchestrator.requestReview(project, { line:job1.line, work:w1.id, reviewer:other.id });
  const st1 = await until(() => {
    const st = stationOf(service, project, job1.line);
    return !st.reviewing && st.review ? st : null;
  }, "unverified review stored");
  assert.equal(st1.review.verdict, "unverified");
  assert.equal(st1.review.score, undefined);
  assert.equal(st1.orchScore, undefined, "unverified review has no numeric orchScore");
  const s1 = orchestrator.sessions(project).find(s => s.line === job1.line);
  assert.equal(s1.reviewScore, undefined);
  assert.equal(s1.reviewVerdict, "unverified");
  assert.equal(orchestrator.stats(project).ratings.length, 0);

  // 2. Fix-needed review counts in stats/findings, then Ignore in stats excludes it and Restore brings it back.
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async () => JSON.stringify({
      verdict:"fix", outcome:2.5, verification:3, safety:4, reportMismatch:"",
      requirements:[{ text:"Fix daily sum", state:"missed" }],
      findings:[{ kind:"bug", where:"usage-stats.js:84", detail:"Rounded before summing." }],
      note:"Two 4.21 rows summed to 8.6 instead of 8.5.",
    }),
  });
  orchestrator.requestReview(project, { line:job2.line, work:w2.id, reviewer:other.id });
  const st2 = await until(() => {
    const st = stationOf(service, project, job2.line);
    return !st.reviewing && st.review ? st : null;
  }, "fix review stored");
  assert.equal(st2.orchScore, 2.9);
  assert.equal(st2.review.verdict, "fix");
  assert.equal(orchestrator.stats(project).ratings.length, 1);
  assert.equal(orchestrator.stats(project).rows.find(r => r.runner === "fake").findings.bug, 1);
  assert.equal(orchestrator.sessions(project).find(s => s.line === job2.line).reviewScore, 2.9);
  assert.equal(orchestrator.sessions(project).find(s => s.line === job2.line).reviewVerdict, "fix");

  const ignRes = await fetch(`${base}/ignore`, { method:"POST", body:JSON.stringify({ line:job2.line, work:w2.id, ignored:true }) });
  assert.equal(ignRes.status, 200);
  assert.equal((await ignRes.json()).ignored, true);
  const st2Ignored = stationOf(service, project, job2.line);
  assert.equal(st2Ignored.orchScore, undefined, "ignored review removed from orchScore");
  assert.equal(st2Ignored.orchIgnored, true);
  assert.equal(st2Ignored.review.ignored, true, "review card stays visible with ignored flag");
  assert.equal(orchestrator.stats(project).ratings.length, 0, "ignored review excluded from stats");
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(orchestrator.agentDays(project, { from:today, to:today }).reduce((n, d) => n + d.scoreCount, 0), 0, "ignored & unverified excluded from agentDays");
  assert.equal(orchestrator.sessions(project).find(s => s.line === job2.line).reviewScore, undefined);

  const restRes = await fetch(`${base}/ignore`, { method:"POST", body:JSON.stringify({ line:job2.line, work:w2.id, ignored:false }) });
  assert.equal(restRes.status, 200);
  assert.equal((await restRes.json()).ignored, false);
  assert.equal(stationOf(service, project, job2.line).orchScore, 2.9);
  assert.equal(orchestrator.stats(project).ratings.length, 1);
});

test("a Work reviewer's session is tracked as internal and never imported as a separate Line by Conversations or syncRecent", async t => {
  const { execFileSync } = require("node:child_process");
  const { lines, service, orchestrator, project, fast } = setup();
  t.after(() => lines.close());
  const codeDir = path.join(temp, `code-rev-session-${counter}`);
  fs.mkdirSync(codeDir, { recursive:true });
  execFileSync("git", ["init", "-q"], { cwd:codeDir });
  project.codePaths = [codeDir];
  project.follow = true;
  project.followSince = Date.now() - 60000;
  service.store.save();

  const realCommand = service.agents.command;
  service.agents.command = (id, o = {}) => (id === "opencode"
    ? { command:"fake-opencode", args:["run", "--format", "json", "--auto", "--dir", o.workdir], cwd:o.workdir, dialect:"opencode" }
    : realCommand(id, o));
  const origAvailable = service.agents.available;
  service.agents.available = () => origAvailable().map(a => (a.id === "opencode" ? { ...a, available:true, runs:true } : a));
  const ocPreset = service.presets.add({ agent:"opencode", name:"OpenCode Reviewer" });

  orchestrator.setSettings({ review:false });
  const job = await orchestrator.start(project, { goal:"Check review session isolation", preset:fast.id });
  await until(() => lineDoc(service, project, job.line).status === "done", "job finished");
  const work = stationOf(service, project, job.line);
  const linesBefore = service.store.scan(project).topics.length;

  let releaseReview, reviewStarted;
  const startedPromise = new Promise(r => { reviewStarted = r; });
  const holdReview = new Promise(r => { releaseReview = r; });
  const captured = {};
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (command, prompt, opts) => {
      captured.cwd = opts.cwd;
      captured.prompt = prompt;
      opts.onLine(JSON.stringify({ type:"step_start", sessionID:"ses_oc_review_99", part:{ sessionID:"ses_oc_review_99" } }));
      opts.onLine(JSON.stringify({ type:"text", sessionID:"ses_oc_review_99", part:{ type:"text", text:"Checking..." } }));
      reviewStarted();
      await holdReview;
      const out = JSON.stringify({ verdict:"ready", outcome:5, verification:null, safety:null, reportMismatch:"", requirements:[{ text:"Check review session isolation", state:"done" }], findings:[], note:"Looks clean." });
      opts.onLine(JSON.stringify({ type:"text", sessionID:"ses_oc_review_99", part:{ type:"text", text:out } }));
      return out;
    },
  });

  // Wire a fake OpenCode DB returning the review session as if OpenCode had recorded it in codeDir.
  const now = Date.now();
  let ocReads = 0;
  service.conversations.opencodeOverride = {
    list:async () => [{ id:"ses_oc_review_99", directory:codeDir, updated:now }],
    read:async () => {
      ocReads += 1;
      return {
        info:{},
        messages:[
          { info:{ id:"m1", role:"user", time:{ created:now } }, parts:[{ id:"p1", type:"text", text:captured.prompt || "You are reviewing another agent's finished work for the person who asked for it.\nYou did not do this work." }] },
          { info:{ id:"m2", role:"assistant", time:{ created:now + 10, completed:now + 20 } }, parts:[{ id:"p2", type:"text", text:'{"verdict":"ready","outcome":5}' }] },
        ],
      };
    },
  };

  orchestrator.requestReview(project, { line:job.line, work:work.id, reviewer:ocPreset.id });
  await startedPromise;
  assert.equal(captured.cwd, codeDir, "review runs in the Line's actual project code folder like a normal job");
  assert.equal(service.isSessionRunning("opencode", "ses_oc_review_99"), true, "active reviewer session counts as running");
  assert.equal(service.conversations.records["opencode:ses_oc_review_99"]?.penechoRun, true, "reviewer session is persisted as internal");

  // Scanning while running must not import or even read the review session.
  await service.conversations.scanOpencode([{ project, roots:[project.docsPath, codeDir] }]);
  assert.equal(ocReads, 0, "ignored review session is skipped before reading while active");
  assert.equal(service.store.scan(project).topics.length, linesBefore);

  releaseReview();
  await until(() => {
    const st = stationOf(service, project, job.line);
    return !st.reviewing && st.review?.verdict === "ready";
  }, "review completed");
  assert.equal(service.isSessionRunning("opencode", "ses_oc_review_99"), false, "no longer active after completion");

  // Scanning and explicit syncRecent after completion must still skip the review session.
  await service.conversations.scanOpencode([{ project, roots:[project.docsPath, codeDir] }]);
  const synced = await service.conversations.syncRecent(project);
  assert.equal(ocReads, 0, "ignored review session is skipped on scan and syncRecent after completion");
  assert.equal(synced.added, 0);
  assert.equal(service.store.scan(project).topics.length, linesBefore, "no duplicate Line created for the reviewer");
});

test("re-review starts completely fresh with no previous review in prompt, session, activity, or Continue fallback", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());

  const third = service.presets.add({ agent:"other", name:"Third reviewer", model:"m-3", effort:"medium" });
  const realCommand = service.agents.command;
  const cmdCalls = [];
  service.agents.command = (id, opts = {}) => {
    cmdCalls.push({ id, opts });
    return { ...realCommand(id, opts), json:true, resumes:false };
  };

  orchestrator.setSettings({ review:false });
  const job = await orchestrator.start(project, { goal:"Implement widget sorting", preset:fast.id });
  await until(() => lineDoc(service, project, job.line).status === "done", "work 1 finished");
  const work1 = stationOf(service, project, job.line);

  // 1. Run an initial review of Work 1 that produces distinctive findings/notes/activity.
  const firstForm = {
    verdict:"fix", outcome:2, verification:2, safety:3,
    requirements:[{ text:"Implement widget sorting", state:"missed" }],
    findings:[{ kind:"bug", where:"sort.js:42", detail:"PREV_REVIEW_SENTINEL_FINDING" }],
    note:"PREV_REVIEW_SENTINEL_NOTE harsh first verdict.",
  };
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (_cmd, _prompt, opts) => {
      opts.onLine(JSON.stringify({ type:"system", subtype:"init", session_id:"old-review-sess-1" }));
      opts.onLine(JSON.stringify({ type:"assistant", message:{ content:[{ type:"text", text:`PREV_REVIEW_SENTINEL_ACTIVITY\n${JSON.stringify(firstForm)}` }] } }));
      return JSON.stringify(firstForm);
    },
  });
  orchestrator.requestReview(project, { line:job.line, work:work1.id, reviewer:other.id });
  const rev1 = await until(() => stationOf(service, project, job.line).review, "first review done");
  assert.equal(rev1.verdict, "fix");
  const seqAfterFirst = service.activityOf(project, job.line, 0).seq;

  // 2. Add a later follow-up Ask (e.g. from Send fixes / complaining about the first review) + a Decided section on the Line.
  await service.saveUnsent(project, { topic:job.line, text:"LATER_FOLLOWUP_SENTINEL: pls check the last review, PREV_REVIEW_SENTINEL_ASK was unfair" });
  const mdWithDecided = `${service.readDoc(project, job.line)}\n\n## Decided\n\n- Keep sorting stable? **Yes**\n`;
  service.writeDoc(project, job.line, mdWithDecided);

  // 3. Re-review Work 1: must NOT include the previous review or later Asks in prompt/instructions/resume, and must retag old review activity rows.
  const rereviewRuns = [];
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (command, prompt, opts) => {
      rereviewRuns.push({ command, prompt });
      opts.onLine(JSON.stringify({ type:"assistant", message:{ content:[{ type:"text", text:"FRESH_REREVIEW_STEP_NOTE" }] } }));
      throw Object.assign(new Error("Temporary disconnect during re-review"), { code:"AGENT_FAILED" });
    },
  });
  orchestrator.requestReview(project, { line:job.line, work:work1.id, reviewer:third.id });
  const stoppedRereview = await until(() => {
    const st = stationOf(service, project, job.line).reviewStopped;
    return st && st.stopWhy === "error" ? st : null;
  }, "re-review stopped");
  assert.match(stoppedRereview.reason, /Temporary disconnect/);

  const freshCmd = cmdCalls.at(-1);
  assert.equal(freshCmd.opts.resume, null, "re-review starts a brand-new session (never resumes previous review session)");
  assert.doesNotMatch(freshCmd.opts.instructions || "", /PREV_REVIEW_SENTINEL|LATER_FOLLOWUP_SENTINEL/);
  const rereviewPrompt = rereviewRuns[0].prompt;
  assert.match(rereviewPrompt, /fresh, independent review of Work 1/);
  assert.match(rereviewPrompt, /ignore any previous review, prior rating\/score, prior review logs, or later Asks\/Works/i);
  assert.doesNotMatch(rereviewPrompt, /PREV_REVIEW_SENTINEL/, "previous review note/findings/activity never appear in re-review prompt");
  assert.doesNotMatch(rereviewPrompt, /LATER_FOLLOWUP_SENTINEL/, "later follow-up Asks after the reviewed Work never appear in re-review prompt");
  assert.doesNotMatch(rereviewPrompt, /<previous-attempt/, "fresh re-review has no previous-attempt block");

  // Previous review activity rows were retagged out of work-1--review with bumped seq so live UI polling drops them.
  const delta = service.activityOf(project, job.line, seqAfterFirst);
  assert.ok(delta.rows.some(r => String(r.step || "").startsWith(`${work1.id}--review-prev-`)), "retagged old review rows carry bumped seq in incremental poll");
  const currentStepRows = service.activityOf(project, job.line, 0).rows.filter(r => r.step === `${work1.id}--review`);
  assert.ok(!currentStepRows.some(r => String(r.text || "").includes("PREV_REVIEW_SENTINEL_ACTIVITY")), "current review step activity excludes prior review output");

  // 4. Continuing the stopped re-review (via <previous-attempt>) includes ONLY the stopped re-review's own notes, NEVER the earlier completed review.
  const contPrompts = [];
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (_cmd, prompt) => {
      contPrompts.push(prompt);
      return JSON.stringify({
        verdict:"ready", outcome:5, verification:5, safety:5,
        requirements:[{ text:"Implement widget sorting", state:"done" }],
        findings:[], note:"Fresh independent review passed.",
      });
    },
  });
  orchestrator.continueReview(project, { line:job.line, work:work1.id });
  const finalRev = await until(() => {
    const st = stationOf(service, project, job.line);
    return !st.reviewing && st.review?.verdict === "ready" ? st.review : null;
  }, "continued re-review finished");
  assert.equal(finalRev.score, 5);
  assert.equal(contPrompts.length, 1);
  assert.match(contPrompts[0], /FRESH_REREVIEW_STEP_NOTE/, "Continue preserves the stopped re-review's own progress");
  assert.doesNotMatch(contPrompts[0], /PREV_REVIEW_SENTINEL/, "Continue never leaks the earlier completed review");
});

test("auto reviewer chooses the best agent in coding (including xhigh/max, across projects, and from synced coding ratings)", async t => {
  const { lines, service, orchestrator, project, fast } = setup();
  t.after(() => lines.close());
  orchestrator.setSettings({ review:false });

  // Presets on "other" (eligible when "fake" did the work):
  // - xhighCoder: best in coding (4.8/5 across 4 code works), expensive, xhigh effort
  // - medCoder: second best in coding (4.3/5 across 4 code works), cheaper, medium effort
  // - lowSameModel: same model as xhighCoder at low effort with 0 works (must NOT inherit xhighCoder's coding ratings)
  // - chatStar: 5/5 across 4 chat works, 0 code works, super cheap (must NOT beat proven coding agents)
  const xhighCoder = service.presets.add({ agent:"other", name:"Other XHigh Coder", model:"coder-pro", effort:"xhigh" });
  const medCoder = service.presets.add({ agent:"other", name:"Other Med Coder", model:"coder-mid", effort:"medium" });
  const lowSameModel = service.presets.add({ agent:"other", name:"Other Low Coder", model:"coder-pro", effort:"low" });
  const chatStar = service.presets.add({ agent:"other", name:"Other Chat Star", model:"chat-mini", effort:"medium" });
  const opusAlias = service.presets.add({ agent:"other", name:"Other Opus Alias", model:"opus", effort:"high" });

  orchestrator.setPrice({ model:"coder-pro", input:8, output:40 });
  orchestrator.setPrice({ model:"coder-mid", input:2, output:10 });
  orchestrator.setPrice({ model:"chat-mini", input:0.1, output:0.2 });

  // Seed coding and chat history cleanly via orchestrator create-line + rate.
  const seed = async (preset, kind, score) => {
    const made = await orchestrator.call(project, { do:"create-line", task:`${kind} task`, agent:preset.id, kind });
    await until(() => lineDoc(service, project, made.line).status === "done", `${kind} work done`);
    await orchestrator.call(project, { do:"rate", line:made.line, work:made.work, score, note:`Rated ${score} for ${kind}.` });
  };

  for (let i = 0; i < 4; i++) await seed(xhighCoder, "code", 4.8);
  for (let i = 0; i < 4; i++) await seed(medCoder, "code", 4.3);
  for (let i = 0; i < 4; i++) await seed(chatStar, "chat", 5);

  const fakeStation = { agent:"fake", savedAgentId:fast.id, model:"m-fast" };

  // 1. Best coding agent (xhighCoder) wins despite xhigh effort and higher cost, beating both medCoder and 5/5 chatStar.
  const pick1 = orchestrator.reviews.pickReviewer(project, fakeStation, "auto");
  assert.equal(pick1.reviewer.id, xhighCoder.id);
  assert.equal(pick1.mode, "auto");
  assert.match(pick1.why, /highest-rated coding agent/);

  // 2. When the #1 coding agent did the work, Auto picks the #2 coding agent (medCoder) — NOT 5/5 chatStar and NOT lowSameModel.
  const pick2 = orchestrator.reviews.pickReviewer(project, { agent:"other", savedAgentId:xhighCoder.id, selected:{ model:"coder-pro", effort:"xhigh" } }, "auto");
  assert.equal(pick2.reviewer.id, medCoder.id);
  assert.notEqual(pick2.reviewer.id, lowSameModel.id, "untested low effort must not inherit xhigh coding ratings");
  assert.notEqual(pick2.reviewer.id, chatStar.id, "chat-only 5/5 must not outrank proven coding agent");

  // 3. Cross-project: a brand-new project with 0 Works of its own still picks the best coding agent across this computer.
  const sibling = service.store.create({ name:"Fresh Repo", docsPath:path.join(temp, `docs-sibling-${counter}`) });
  const pickSibling = orchestrator.reviews.pickReviewer(sibling, fakeStation, "auto");
  assert.equal(pickSibling.reviewer.id, xhighCoder.id, "fresh project uses computer-wide local coding history");

  // 4. Synced penecho.ai coding ratings: on a clean state with no local coding works, picks highest synced `code` rating
  //    (preserving >4.5 separation like 4.69 vs 4.51, matching short alias "opus" -> "claude-opus-5-5", and ignoring chat/all).
  const fresh = setup();
  t.after(() => fresh.lines.close());
  fresh.orchestrator.setSettings({ review:false });
  const cTop = fresh.service.presets.add({ agent:"other", name:"Top Synced XHigh", model:"gpt-6.2-sol", effort:"xhigh" });
  const cSecond = fresh.service.presets.add({ agent:"other", name:"Second Synced Med", model:"gpt-6.2-astra", effort:"medium" });
  const cAlias = fresh.service.presets.add({ agent:"other", name:"Opus Alias High", model:"opus", effort:"high" });
  const cChatOnly = fresh.service.presets.add({ agent:"other", name:"Chat Synced", model:"chat-fast", effort:"medium" });
  const cLowSame = fresh.service.presets.add({ agent:"other", name:"Low Untested", model:"gpt-6.2-sol", effort:"low" });
  const board = {
    tables:{
      all:{ ranked:[
        { agent:"other", model:"chat-fast", effort:"medium", rating:4.95, rated:20 },
        { agent:"other", model:"gpt-6.2-sol", effort:"xhigh", rating:4.67, rated:30 },
        { agent:"other", model:"gpt-6.2-astra", effort:"medium", rating:4.45, rated:10 },
      ] },
      code:{ ranked:[
        { agent:"other", model:"gpt-6.2-sol", effort:"xhigh", rating:4.69, rated:27 },
        { agent:"other", model:"gpt-6.2-astra", effort:"medium", rating:4.51, rated:6 },
        { agent:"other", model:"claude-opus-5-5", effort:"high", rating:4.37, rated:4 },
      ] },
      chat:{ ranked:[
        { agent:"other", model:"chat-fast", effort:"medium", rating:4.99, rated:15 },
      ] },
    },
  };
  fresh.orchestrator.reviews.use({
    fetch:async url => {
      const body = new URL(url).pathname === "/leaderboard.json" ? board : null;
      return { ok:Boolean(body), status:body ? 200 : 404, json:async () => body };
    },
  });
  await fresh.orchestrator.sync();
  const freshFake = { agent:"fake", savedAgentId:fresh.fast.id, model:"m-fake" };
  assert.equal(fresh.orchestrator.reviews.pickReviewer(fresh.project, freshFake, "auto").reviewer.id, cTop.id, "4.69 beats 4.51 in synced coding ratings without 4.5 cap");
  // Exclude gpt-6.2-sol -> picks 4.51 gpt-6.2-astra (not 4.95 all-kinds chat-fast, not low effort).
  assert.equal(fresh.orchestrator.reviews.pickReviewer(fresh.project, { agent:"other", savedAgentId:cTop.id, selected:{ model:"gpt-6.2-sol", effort:"xhigh" } }, "auto").reviewer.id, cSecond.id);
  // Remove top two -> short alias "opus" matches "claude-opus-5-5" (4.37 in code) and beats chat-fast (0 in code, 4.95 in all) and lowSame.
  fresh.service.presets.remove(cTop.id);
  fresh.service.presets.remove(cSecond.id);
  assert.equal(fresh.orchestrator.reviews.pickReviewer(fresh.project, freshFake, "auto").reviewer.id, cAlias.id, "alias model matches synced coding rating");
  // cloudStart also matches short aliases and never lifts an untested lower effort above 4/5 from a stronger effort's all-kinds rating.
  assert.equal(fresh.orchestrator.reviews.cloudStart("other", "opus", "high", "code"), 4.37);
  assert.equal(fresh.orchestrator.reviews.cloudStart("other", "gpt-6.2-sol", "low", "code"), 4, "cross-effort fallback caps at 4/5");
  // Default-effort preset (fresh.other) resolves configuredModel + configuredEffort and wins auto-reviewer selection on synced xhigh coding ratings.
  fresh.service.agents.configuredModel = id => (id === "other" ? "gpt-6.2-sol" : "");
  fresh.service.agents.configuredEffort = id => (id === "other" ? "xhigh" : "");
  assert.equal(fresh.orchestrator.reviews.pickReviewer(fresh.project, freshFake, "auto").reviewer.id, fresh.other.id, "default-effort preset matches configured effort coding rating");
  void cChatOnly; void cLowSame; void opusAlias;

  // 5. Proven bad coding agent (< 4/5) does not outrank an untested candidate at 4/5 baseline,
  //    while a proven 4.0/5 coding agent beats an untested candidate.
  const edge = setup();
  t.after(() => edge.lines.close());
  edge.orchestrator.setSettings({ review:false });
  const badCoder = edge.service.presets.add({ agent:"other", name:"AAA Bad Coder", model:"bad-code", effort:"medium" });
  const untested = edge.service.presets.add({ agent:"other", name:"ZZZ Untested", model:"fresh-code", effort:"medium" });
  for (let i = 0; i < 3; i++) {
    const m = await edge.orchestrator.call(edge.project, { do:"create-line", task:"bad code", agent:badCoder.id, kind:"code" });
    await until(() => lineDoc(edge.service, edge.project, m.line).status === "done", "bad code done");
    await edge.orchestrator.call(edge.project, { do:"rate", line:m.line, work:m.work, score:2.5, note:"Failed tests." });
  }
  const pickEdge1 = edge.orchestrator.reviews.pickReviewer(edge.project, { agent:"fake", savedAgentId:edge.fast.id }, "auto");
  assert.notEqual(pickEdge1.reviewer.id, badCoder.id, "proven bad coding agent loses to untested baseline");
  // Add a proven 4.0/5 coding agent: ties 4.0 baseline and wins because it has coding evidence.
  const solidCoder = edge.service.presets.add({ agent:"other", name:"ZZZ Solid 4.0 Coder", model:"solid-code", effort:"medium" });
  const mSolid = await edge.orchestrator.call(edge.project, { do:"create-line", task:"solid code", agent:solidCoder.id, kind:"code" });
  await until(() => lineDoc(edge.service, edge.project, mSolid.line).status === "done", "solid code done");
  await edge.orchestrator.call(edge.project, { do:"rate", line:mSolid.line, work:mSolid.work, score:4, note:"Solid." });
  const pickEdge2 = edge.orchestrator.reviews.pickReviewer(edge.project, { agent:"fake", savedAgentId:edge.fast.id }, "auto");
  assert.equal(pickEdge2.reviewer.id, solidCoder.id, "proven 4.0 coding agent beats untested baseline");
  void untested;

  // 6. When no coding ratings exist anywhere (neither local nor synced), falls back to overall ratings.
  const fallback = setup();
  t.after(() => fallback.lines.close());
  fallback.orchestrator.setSettings({ review:false });
  const strongAll = fallback.service.presets.add({ agent:"other", name:"ZZZ Strong All", model:"all-strong", effort:"medium" });
  const weakAll = fallback.service.presets.add({ agent:"other", name:"AAA Weak All", model:"all-weak", effort:"medium" });
  fallback.orchestrator.reviews.use({
    fetch:async url => {
      const body = new URL(url).pathname === "/leaderboard.json"
        ? { tables:{ all:{ ranked:[{ agent:"other", model:"all-strong", effort:"medium", rating:4.6, rated:8 }, { agent:"other", model:"all-weak", effort:"medium", rating:3.1, rated:8 }] } } }
        : null;
      return { ok:Boolean(body), status:body ? 200 : 404, json:async () => body };
    },
  });
  await fallback.orchestrator.sync();
  const pickFallback = fallback.orchestrator.reviews.pickReviewer(fallback.project, { agent:"fake", savedAgentId:fallback.fast.id }, "auto");
  assert.equal(pickFallback.reviewer.id, strongAll.id, "falls back to overall rating when no coding ratings exist");
  void weakAll;
});

test("Orchestrator review is stored as a real node in lines/<slug>.md and works/<slug>/<work>--review.md and visible from another PenEcho install (CLI) with an empty state dir", async t => {
  const { syncScope } = require("../src/server/project-lines/sync-scope.js");
  // Install A (e.g. PenEcho Desktop) runs the job and its Orchestrator review.
  const desktop = setup();
  t.after(() => desktop.lines.close());
  const { service, orchestrator, project, fast, other } = desktop;

  const v2Form = {
    verdict:"fix", outcome:3.5, verification:4, safety:4.5,
    requirements:[
      { text:"Keep healthy files syncing", state:"done" },
      { text:"Handle unknown batch failures", state:"partly" },
    ],
    findings:[
      { kind:"gap", where:"src/server/project-lines/cloud-share.js:404", detail:"Unknown batch failure still stops sync." },
    ],
    note:"Healthy files sync, but unknown batch failures still stop the whole sync.",
  };
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (_cmd, _prompt, opts) => {
      opts.onLine("Inspected cloud-share.js.");
      return `Checked the diff.\n${JSON.stringify(v2Form)}`;
    },
  });

  const job = await orchestrator.start(project, { goal:"Fix Cloud sync blocking", preset:fast.id });
  await until(() => lineDoc(service, project, job.line).status === "done", "job finished");
  await until(() => {
    const st = stationOf(service, project, job.line);
    return st && !st.reviewing && st.review?.verdict === "fix";
  }, "desktop review completed");

  // 1. Stored together with other nodes in lines/<slug>.md and works/<slug>/work-1--review.md.
  const md = service.readDoc(project, job.line);
  const parsed = F.parseLine(md);
  const reviewStep = parsed.steps.find(s => s.kind === "orch-review");
  assert.ok(reviewStep, "lines/<slug>.md contains an orch-review step");
  assert.equal(reviewStep.id, "work-1--review");
  assert.equal(reviewStep.reviewOf, "work-1");
  assert.equal(reviewStep.who, "other");
  assert.equal(reviewStep.done, true);
  assert.match(md, /## \[x\] Orchestrator review · @other/);
  assert.match(md, /\[Details\]\(\.\.\/works\/[^/]+\/work-1--review\.md\)/);
  assert.match(md, /<!-- penecho-review-of: work-1 -->/);

  const reviewDetailRel = F.detailPath(job.line, "work-1--review");
  assert.equal(service.store.exists(project, reviewDetailRel), true, "works/<slug>/work-1--review.md exists beside work-1.md");
  const reviewDetailMd = service.store.readText(project, reviewDetailRel).text;
  const parsedDetail = F.parseOrchReviewDetail(reviewDetailMd);
  assert.equal(parsedDetail.state, "done");
  assert.equal(parsedDetail.work, "work-1");
  assert.equal(parsedDetail.review.verdict, "fix");
  assert.equal(parsedDetail.review.score, 3.8);
  assert.equal(parsedDetail.review.by, "Other careful");
  assert.match(reviewDetailMd, /## What you asked/);
  assert.match(reviewDetailMd, /## Findings/);
  assert.match(reviewDetailMd, /## Review note/);

  // Included in Cloud sync scope automatically.
  const scoped = syncScope(service, project);
  assert.ok(scoped.has(reviewDetailRel), "review node detail file is included in Cloud sync scope");

  // Server state includes the real orch-review station right after work-1.
  const desktopLine = service.stateOf(project).lines.find(l => l.id === job.line);
  const desktopRvStation = desktopLine.stations.find(s => s.id === "work-1--review");
  assert.ok(desktopRvStation, "server state includes real orch-review station");
  assert.equal(desktopRvStation.kind, "orch-review");
  assert.equal(desktopRvStation.workId, "work-1");
  assert.equal(desktopRvStation.detail, reviewDetailRel);
  assert.equal(desktopRvStation.review.score, 3.8);

  // 2. Install B (simulating PenEcho CLI with its own completely separate empty state dir) opens the SAME docsPath.
  const cliDir = path.join(temp, `cli-state-${++counter}`);
  fs.mkdirSync(cliDir, { recursive:true });
  const cliLines = createProjectLines({
    directory:cliDir,
    agents:fakeAgents(),
    serviceOptions:{ autoWatch:false },
    authorizeRead:() => null,
    authorizeWrite:() => null,
    isThisComputer:() => true,
  });
  t.after(() => cliLines.close());
  const cliProject = cliLines.service.store.importFolder({ docsPath:project.docsPath });
  assert.equal(cliLines.orchestrator.records(cliProject).length, 0, "CLI starts with an empty records.json");

  const cliState = cliLines.service.stateOf(cliProject);
  const cliLine = cliState.lines.find(l => l.id === job.line);
  assert.ok(cliLine, "CLI sees the Line");
  const cliRvStation = cliLine.stations.find(s => s.kind === "orch-review" && s.workId === "work-1");
  assert.ok(cliRvStation, "CLI sees the stored orch-review node directly in stations");
  assert.equal(cliRvStation.id, "work-1--review");
  assert.equal(cliRvStation.state, "done");
  assert.equal(cliRvStation.agent, "other");
  assert.equal(cliRvStation.detail, reviewDetailRel);
  assert.equal(cliRvStation.review.verdict, "fix");
  assert.equal(cliRvStation.review.score, 3.8);
  assert.equal(cliRvStation.review.note, v2Form.note);
  assert.equal(cliRvStation.review.findings.length, 1);

  const cliWorkStation = cliLine.stations.find(s => s.id === "work-1");
  assert.equal(cliWorkStation.orchScore, 3.8, "CLI sees Work score from stored review node");
  assert.equal(cliWorkStation.review.verdict, "fix");
  assert.equal(cliLines.orchestrator.sessions(cliProject).find(s => s.line === job.line).reviewScore, 3.8);
  assert.equal(cliLines.orchestrator.sessions(cliProject).find(s => s.line === job.line).reviewVerdict, "fix");
  assert.equal(cliLines.orchestrator.stats(cliProject).ratings.length, 1, "CLI stats read rating from stored review node");
  assert.equal(cliLines.orchestrator.stats(cliProject).rows.find(r => r.runner === "fake").findings.gap, 1);
  assert.equal(cliLines.orchestrator.call(cliProject, { do:"line", line:job.line }).then ? (await cliLines.orchestrator.call(cliProject, { do:"line", line:job.line })).steps.find(s => s.work === "work-1").score : null, 3.8);

  // CLI does not re-auto-review a Line that Desktop already reviewed.
  let cliRan = 0;
  cliLines.orchestrator.reviews.use({ shortMinutes:0, run:async () => { cliRan += 1; return JSON.stringify(v2Form); } });
  assert.equal(cliLines.orchestrator.lineFinished(cliProject, job.line), null);
  assert.equal(cliRan, 0);

  // Ignoring from CLI updates the shared stored review node so Desktop sees it too.
  cliLines.orchestrator.ignoreReview(cliProject, { line:job.line, work:"work-1", ignored:true });
  service.changed(project);
  assert.equal(stationOf(service, project, job.line).orchIgnored, true, "Desktop sees ignored flag updated by CLI");
  assert.equal(stationOf(service, project, job.line).orchScore, undefined);

  // 3. Legacy reviews stored only in records.json (pre-change Desktop data) are materialized into nodes on upgradeAll/makeState so CLI sees them too.
  const legacy = setup();
  t.after(() => legacy.lines.close());
  legacy.orchestrator.setSettings({ review:false });
  const legacyJob = await legacy.orchestrator.start(legacy.project, { goal:"Legacy reviewed task", preset:legacy.fast.id });
  await until(() => lineDoc(legacy.service, legacy.project, legacyJob.line).status === "done", "legacy job done");
  // Simulate a pre-upgrade review written directly into records.json without any node in lines/<slug>.md.
  const recordsFile = path.join(legacy.directory, "orchestrator", "records.json");
  const rawRecs = fs.existsSync(recordsFile) ? JSON.parse(fs.readFileSync(recordsFile, "utf8")) : { records:[] };
  rawRecs.records.push({
    id:"leg12345", project:legacy.project.id, line:legacyJob.line, work:"work-1",
    score:4.5, scoredBy:"Other careful", scoredAt:"2026-11-23T12:00:00.000Z", source:"reviewer", ignored:false,
    verdict:"ready", note:"Legacy review stored only in records.json.",
    review:{ schema:2, verdict:"ready", score:4.5, scale:5, outcome:4.5, verification:4.5, safety:5, requirements:[{ text:"Legacy reviewed task", state:"done" }], note:"Legacy review stored only in records.json.", by:"Other careful", agent:"other", mode:"auto", at:"2026-11-23T12:00:00.000Z", took:"12s" },
  });
  fs.mkdirSync(path.dirname(recordsFile), { recursive:true });
  fs.writeFileSync(recordsFile, JSON.stringify(rawRecs));
  legacy.lines.close();
  // Create a fresh Desktop service sharing legacy.directory to simulate restarting Desktop after upgrade.
  const legacyRestarted = createProjectLines({ directory:legacy.directory, agents:fakeAgents(), serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true });
  t.after(() => legacyRestarted.close());
  const restartedProj = legacyRestarted.service.store.projects.find(p => p.docsPath === legacy.project.docsPath);
  legacyRestarted.service.stateOf(restartedProj);
  assert.equal(legacyRestarted.service.store.exists(restartedProj, F.detailPath(legacyJob.line, "work-1--review")), true, "legacy review materialized into works/<slug>/work-1--review.md");
  assert.ok(F.parseLine(legacyRestarted.service.readDoc(restartedProj, legacyJob.line)).steps.some(s => s.kind === "orch-review" && s.reviewOf === "work-1"), "legacy review materialized into lines/<slug>.md");
  // Independent CLI instance now sees the materialized legacy review!
  const cliLegacyDir = path.join(temp, `cli-legacy-${++counter}`);
  fs.mkdirSync(cliLegacyDir, { recursive:true });
  const cliLegacy = createProjectLines({ directory:cliLegacyDir, agents:fakeAgents(), serviceOptions:{ autoWatch:false }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true });
  t.after(() => cliLegacy.close());
  const cliLegacyProj = cliLegacy.service.store.importFolder({ docsPath:legacy.project.docsPath });
  const cliLegacyLine = cliLegacy.service.stateOf(cliLegacyProj).lines.find(l => l.id === legacyJob.line);
  assert.equal(cliLegacyLine.stations.find(s => s.kind === "orch-review")?.review?.score, 4.5, "CLI sees materialized legacy review node");

  // 4. Stopped review written by Desktop is also visible in CLI and can be continued from CLI.
  const cliOther = cliLines.service.presets.add({ agent:"other", name:"Other careful" });
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async () => { throw Object.assign(new Error("Temporary network timeout"), { code:"AGENT_FAILED" }); },
  });
  orchestrator.requestReview(project, { line:job.line, work:"work-1", reviewer:other.id });
  await until(() => {
    const st = stationOf(service, project, job.line);
    return !st.reviewing && st.reviewStopped?.stopWhy === "error";
  }, "desktop review stopped with error");
  cliLines.service.changed(cliProject);
  const cliStoppedLine = cliLines.service.stateOf(cliProject).lines.find(l => l.id === job.line);
  const cliStoppedRv = cliStoppedLine.stations.find(s => s.kind === "orch-review" && s.workId === "work-1");
  assert.ok(cliStoppedRv, "CLI sees stopped orch-review node");
  assert.equal(cliStoppedRv.state, "error");
  assert.equal(cliStoppedRv.reviewStopped.stopWhy, "error");
  assert.equal(cliStoppedRv.canContinue, true, "CLI knows stopped review can be continued");

  cliLines.orchestrator.reviews.use({
    shortMinutes:0,
    run:async () => JSON.stringify({ ...v2Form, verdict:"ready", outcome:5, verification:5, safety:5, findings:[], note:"Continued cleanly from CLI." }),
  });
  cliLines.orchestrator.continueReview(cliProject, { line:job.line, work:"work-1" });
  const cliContinued = await until(() => {
    const st = stationOf(cliLines.service, cliProject, job.line);
    return !st.reviewing && st.review?.verdict === "ready" ? st.review : null;
  }, "CLI continued stopped review");
  assert.equal(cliContinued.score, 5);
  service.changed(project);
  assert.equal(stationOf(service, project, job.line).review?.score, 5, "Desktop sees review finished by CLI");
  void other; void cliOther;
});

test("reviewer refines inferred Work kind without overwriting explicit decide or user kind (PE-1097)", async t => {
  const withKind = parseReview(JSON.stringify({
    verdict:"ready", outcome:5, verification:5, safety:5, kind:"research",
    requirements:[{ text:"Investigate logs", state:"done" }], findings:[], note:"Thorough investigation.",
  }));
  assert.equal(withKind.kind, "research");
  const withoutKind = parseReview(JSON.stringify({
    verdict:"ready", outcome:5, verification:5, safety:5,
    requirements:[{ text:"Fix bug", state:"done" }], findings:[], note:"Fixed.",
  }));
  assert.equal("kind" in withoutKind, false);

  const { lines, service, orchestrator, project, fast } = setup(t);
  void lines;
  // Auto-review corrects an inferred kind ("chat" -> "research").
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async () => JSON.stringify({
      verdict:"ready", outcome:4.8, verification:null, safety:null, kind:"research",
      requirements:[{ text:"Check root cause", state:"done" }], findings:[], note:"Good analysis.",
    }),
  });
  const inferredJob = await orchestrator.start(project, { goal:"hello", preset:fast.id });
  await until(() => {
    const st = stationOf(service, project, inferredJob.line);
    return st && !st.reviewing && st.review?.verdict === "ready";
  }, "inferred job reviewed");
  const recInferred = orchestrator.records(project).find(r => r.line === inferredJob.line && r.work === "work-1");
  assert.equal(recInferred.kind, "research", "reviewer refined inferred kind");
  assert.equal(recInferred.kindSource, "reviewer");
  assert.equal("kind" in stationOf(service, project, inferredJob.line).review, false, "review object keeps existing schema");

  // Explicit kind from decide is NEVER overwritten by reviewer.
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async () => JSON.stringify({
      verdict:"ready", outcome:5, verification:5, safety:5, kind:"docs",
      requirements:[{ text:"Write code", state:"done" }], findings:[], note:"Solid code.",
    }),
  });
  const explicitJob = await orchestrator.start(project, { goal:"Fix login timeout", preset:fast.id });
  await until(() => lineDoc(service, project, explicitJob.line).status === "done", "explicit job done");
  await orchestrator.call(project, { do:"decide", route:"self", why:"Single fix.", kind:"code" }, { session:explicitJob.line });
  orchestrator.requestReview(project, { line:explicitJob.line, work:"work-1" });
  await until(() => {
    const st = stationOf(service, project, explicitJob.line);
    return st && !st.reviewing && st.review?.note === "Solid code.";
  }, "explicit job reviewed");
  const recExplicit = orchestrator.records(project).find(r => r.line === explicitJob.line && r.work === "work-1");
  assert.equal(recExplicit.kind, "code", "explicit decide kind is preserved");
  assert.equal(recExplicit.kindSource, "decide");
});

test("auto-assigned reviewer records configured model & effort when preset uses defaults, and captures runtime model from stream output", async t => {
  const { lines, service, orchestrator, project, fast, other } = setup();
  t.after(() => lines.close());
  // Replace `other` with a default-model, default-effort preset (like bare "Codex").
  service.presets.remove(other.id);
  const defOther = service.presets.add({ agent:"other", name:"Other", model:"", effort:"" });

  // 1. Configured model & effort from agent settings are resolved and saved on reviewPending, review, and work-1--review.md.
  const origModel = service.agents.configuredModel;
  const origEffort = service.agents.configuredEffort;
  service.agents.configuredModel = id => (id === "other" ? "gpt-6.2-sol" : origModel(id));
  service.agents.configuredEffort = (id, model) => (id === "other" ? "xhigh" : origEffort(id, model));

  let releasePending;
  const holdPending = new Promise(r => { releasePending = r; });
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async () => {
      await holdPending;
      return JSON.stringify({
        verdict:"ready", outcome:5, verification:5, safety:5,
        requirements:[{ text:"Check default specs", state:"done" }], findings:[], note:"Looks great.",
      });
    },
  });
  const job = await orchestrator.start(project, { goal:"Check default specs", preset:fast.id });
  const pendingSt = await until(() => {
    const st = stationOf(service, project, job.line);
    return st?.reviewing && st.reviewPending ? st : null;
  }, "review pending with resolved specs");
  assert.equal(pendingSt.reviewPending.by, "Other");
  assert.equal(pendingSt.reviewPending.presetId, defOther.id);
  assert.equal(pendingSt.reviewPending.model, "gpt-6.2-sol");
  assert.equal(pendingSt.reviewPending.effort, "xhigh");
  assert.equal(pendingSt.reviewPending.mode, "auto");

  releasePending();
  const doneReview = await until(() => stationOf(service, project, job.line)?.review, "review finished");
  assert.equal(doneReview.model, "gpt-6.2-sol");
  assert.equal(doneReview.effort, "xhigh");
  const detailMd = service.store.readText(project, F.detailPath(job.line, "work-1--review")).text;
  assert.match(detailMd, /^model: gpt-6\.2-sol$/m);
  assert.match(detailMd, /^effort: xhigh$/m);
  assert.match(detailMd, /\*\*Reviewer:\*\* Other · gpt-6\.2-sol · xhigh effort \(Auto reviewer\)/);

  // 2. When no configured model exists, runtime model from stream-json init is captured onto the review.
  service.agents.configuredModel = () => "";
  service.agents.configuredEffort = () => "";
  const origCmd = service.agents.command;
  service.agents.command = (id, o) => ({ ...origCmd(id, o), ...(id === "other" ? { json:true } : {}) });
  orchestrator.reviews.use({
    shortMinutes:0,
    run:async (_command, _prompt, opts) => {
      opts.onLine(JSON.stringify({ type:"system", subtype:"init", session_id:"s-rev-1", model:"claude-opus-5-5" }));
      return JSON.stringify({
        verdict:"ready", outcome:5, verification:null, safety:null,
        requirements:[{ text:"Runtime model capture", state:"done" }], findings:[], note:"Done.",
      });
    },
  });
  const job2 = await orchestrator.start(project, { goal:"Runtime model capture", preset:fast.id });
  const done2 = await until(() => stationOf(service, project, job2.line)?.review, "runtime model review finished");
  assert.equal(done2.model, "claude-opus-5-5");
  assert.equal(done2.effort, "");
  const detailMd2 = service.store.readText(project, F.detailPath(job2.line, "work-1--review")).text;
  assert.match(detailMd2, /^model: claude-opus-5-5$/m);
  assert.match(detailMd2, /\*\*Reviewer:\*\* Other · claude-opus-5-5 \(Auto reviewer\)/);
});
