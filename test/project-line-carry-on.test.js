"use strict";
require("./helpers/safety.js");
// N5 and N7: why a Work stopped, Carry on with another agent, and how much context each Work started from.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { Conversations } = require("../src/server/project-lines/conversations.js");
const StopWhy = require("../src/server/project-lines/stop-why.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-carry-on-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label = "condition", ms = 8000) {
  const start = Date.now();
  for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); }
}

// Real words from the agents, as they ended runs.
const LIMITS = [
  ["You've hit your 5-hour limit · resets 2:10pm (Europe/London)", "2026-11-12T14:10:00.000Z"],
  ["5-hour limit reached ∙ resets 3pm (Europe/London)", "2026-11-12T15:00:00.000Z"],
  ["Claude AI usage limit reached|1731427200", "2024-11-12T16:00:00.000Z"],
  ['API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit for your organization of 50,000 input tokens per minute."}}', ""],
  ["You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again in 4 days 3 hours 2 minutes.", "2026-11-16T13:02:00.000Z"],
  ["stream error: exceeded retry limit, last status: 429 Too Many Requests", ""],
];
const NOT_LIMITS = ["tests are red", "Error: ENOENT: no such file or directory, open 'package.json'", "Claude Code stopped with code 1.", "Command failed: npm test"];
const NOW = Date.UTC(2026, 10, 12, 10, 0);

test("a usage limit is told from the agents' own words, with when it resets", () => {
  for (const [text, resets] of LIMITS) {
    const found = StopWhy.stopWhyOf(text, NOW);
    assert.equal(found.why, "limit", text);
    assert.equal(found.resetsAt ? new Date(found.resetsAt).toISOString() : "", resets, text);
  }
  for (const text of NOT_LIMITS) assert.equal(StopWhy.stopWhyOf(text, NOW).why, "error", text);
  // A calm end is a stop only when the whole answer is the notice: an answer about rate limits is still an answer.
  assert.equal(StopWhy.isLimitNotice("You've hit your 5-hour limit · resets 2:10pm (Europe/London)"), true);
  assert.equal(StopWhy.isLimitNotice("5-hour limit reached ∙ resets 3pm"), true);
  assert.equal(StopWhy.isLimitNotice("The REST API rate limit is 5,000 requests per hour for signed-in users."), false);
});
test("a reset time is the next one, in the zone the agent named", () => {
  // Past 2:10pm in London, it is tomorrow's.
  assert.equal(new Date(StopWhy.resetsAtOf("resets 2:10pm (Europe/London)", Date.UTC(2026, 10, 12, 15, 0))).toISOString(), "2026-11-13T14:10:00.000Z");
  // In summer London is an hour ahead of UTC.
  assert.equal(new Date(StopWhy.resetsAtOf("You've hit your 5-hour limit · resets 2:10pm (Europe/London)", Date.UTC(2026, 6, 1, 10, 0))).toISOString(), "2026-07-01T13:10:00.000Z");
  // Codex says a time on this computer's clock: "try again at 3:05 PM", or a date when it is not today.
  const local = new Date(StopWhy.resetsAtOf("You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:05 PM.", new Date(2026, 10, 12, 9, 0).getTime()));
  assert.deepEqual([local.getDate(), local.getHours(), local.getMinutes()], [12, 15, 5]);
  const dated = new Date(StopWhy.resetsAtOf("You've hit your usage limit. Upgrade to Plus to continue using Codex (https://openai.com/chatgpt/pricing), or try again at Nov 14th, 2026 9:00 AM.", NOW));
  assert.deepEqual([dated.getFullYear(), dated.getMonth(), dated.getDate(), dated.getHours()], [2026, 10, 14, 9]);
  assert.equal(StopWhy.resetsAtOf("You've hit your usage limit.", NOW), 0);
});

// Two stand-in agents. "fake" takes everything as one message; "other" keeps instructions of its own, as Claude Code and Codex do.
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const fs = require("fs");
const say = o => console.log(JSON.stringify(o));
const me = process.argv[2], sys = (process.argv.find(a => a.startsWith("--sys=")) || "").slice(6), resume = (process.argv.find(a => a.startsWith("--resume=")) || "").slice(9);
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  fs.appendFileSync(process.env.RUN_LOG, JSON.stringify({ me, resume, prompt, sys }) + "\\n");
  const mode = fs.existsSync(process.env.MODE_FILE) ? fs.readFileSync(process.env.MODE_FILE, "utf8").trim() : "";
  const session = me + "-session-" + Date.now();
  say({ type:"system", subtype:"init", session_id:session });
  if (mode === "limit") {
    say({ type:"assistant", message:{ content:[{ type:"text", text:"You've hit your 5-hour limit · resets 2:10pm (Europe/London)" }] } });
    say({ type:"result", subtype:"success", is_error:true, result:"You've hit your 5-hour limit · resets 2:10pm (Europe/London)", session_id:session });
    process.exit(1);
  }
  if (mode === "slow") { say({ type:"assistant", message:{ content:[{ type:"text", text:"Working on it." }] } }); setTimeout(() => {}, 60000); return; }
  say({ type:"assistant", message:{ content:[{ type:"text", text:"Carried it through." }] } });
  say({ type:"result", subtype:"success", is_error:false, result:"Carried it through.", session_id:session });
  process.exit(0);
});
`);
const modeFile = path.join(temp, "mode"), runLog = path.join(temp, "runs.jsonl");
process.env.MODE_FILE = modeFile; process.env.RUN_LOG = runLog;
const setMode = mode => (mode ? fs.writeFileSync(modeFile, mode) : fs.rmSync(modeFile, { force:true }));
const runs = () => (fs.existsSync(runLog) ? fs.readFileSync(runLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : []);
const stub = (id, name, own) => ({ name, mono:name.slice(0, 2), color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript, id] }),
  command:(launch, { workdir, resume, instructions }) => ({ command:launch.command, args:[...launch.prefixArgs, ...(resume ? [`--resume=${resume}`] : []), ...(own && instructions ? [`--sys=${instructions}`] : [])], cwd:workdir, stdin:true, ...(own ? { ownInstructions:true } : {}) }) });
let counter = 0;
function setup() {
  const directory = path.join(temp, `state-${++counter}`);
  fs.mkdirSync(directory, { recursive:true });
  const agents = createAgents({ env:{ PATH:"" }, extra:{ fake:stub("fake", "Fake", false), other:stub("other", "Other", true) } });
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Demo", docsPath:path.join(temp, `docs-${counter}`), codePath:null });
  project.defaultAgent = "fake";
  return { service, project };
}
const docOf = (s, p, slug) => F.parseLine(s.readDoc(p, slug));
const settled = (s, p, slug, ...states) => until(() => !s.runs.size && states.includes(docOf(s, p, slug).status) && docOf(s, p, slug), `status ${states}`);
const works = (s, p, slug) => s.lineFrom(p, s.store.scan(p).topics.find(t => t.slug === slug)).stations.filter(x => F.AGENT_LIKE(x));

test("a run that hits its limit says so on its Work, in its detail file and in the state", async () => {
  fs.rmSync(runLog, { force:true }); setMode("limit");
  const { service, project } = setup();
  const { slug } = await service.request(project, { text:"List the files", topic:"new", agent:"fake" });
  await settled(service, project, slug, "stopped");
  const [work] = works(service, project, slug);
  assert.equal(work.state, "error");
  assert.equal(work.stopWhy, "limit");
  assert.ok(Date.parse(work.resetsAt) > Date.now() - 60000, work.resetsAt);
  const detail = F.splitFront(service.store.readText(project, work.detail).text).front;
  assert.equal(detail["stop why"], "limit");
  // What PenEcho sent and how large the line was, counted when it began.
  assert.ok(work.context.sent > 200 && work.context.line > 20, JSON.stringify(work.context));
  assert.equal(work.context.conversation, undefined);
});

test("Carry on with another agent starts a new conversation from the line, told who stopped and why", async () => {
  fs.rmSync(runLog, { force:true }); setMode("limit");
  const { service, project } = setup();
  const { slug } = await service.request(project, { text:"List the files in this folder and say done", topic:"new", agent:"fake" });
  await settled(service, project, slug, "stopped");
  // The stopped agent's conversation is large: the new one does not carry it.
  const [first] = runs(), was = service.sessions[service.key(project, slug)].fake.id;
  const transcript = path.join(temp, "fake-transcript.jsonl");
  fs.writeFileSync(transcript, "x".repeat(400000));
  service.conversations.recordOf("fake", was, { file:transcript });
  assert.equal(first.me, "fake");
  setMode("");
  const result = await service.act(project, slug, "carry-on", { agent:"other" });
  assert.equal(result.ok, true);
  await settled(service, project, slug, "done");
  const second = runs()[1];
  assert.equal(second.me, "other");
  assert.equal(second.resume, "", "a new conversation, never the stopped one's");
  // Current Work instructions travel in the message because resumed system instructions can be frozen.
  assert.match(second.prompt, /List the files in this folder and say done/);
  assert.match(second.prompt, /Fake was working on this and stopped \(it hit its usage limit\)\. The line file has what was asked and done; carry on from there\./);
  assert.match(second.prompt, /work-2\.md/);
  assert.match(second.prompt, /<!-- penecho:/, "the sentence asking for title and tags still rides along");
  const [stopped, carried] = works(service, project, slug);
  assert.equal(stopped.off, "ended");
  assert.equal(stopped.stopWhy, "limit", "the stopped Work keeps why it stopped");
  assert.equal(carried.agent, "other");
  assert.deepEqual(carried.carriedFrom, { agent:"fake", why:"limit" });
  assert.equal(carried.context.conversation, 400000);
  assert.ok(carried.context.sent < 400000 / 3);
  assert.equal(F.splitFront(service.store.readText(project, carried.detail).text).front["carried from"], "@fake");
  // Nothing is stopped now, so there is nothing to carry on.
  await assert.rejects(service.act(project, slug, "carry-on", { agent:"fake" }), /Only a Work that stopped/);
  // A Work that carries its own conversation on says so: it did not start from the line file, and that conversation is counted.
  const own = service.sessions[service.key(project, slug)].other.id, ownFile = path.join(temp, "other-transcript.jsonl");
  fs.writeFileSync(ownFile, "y".repeat(5000));
  service.conversations.recordOf("other", own, { file:ownFile });
  await service.request(project, { text:"And sort them", topic:slug, agent:"other", taskMode:"continue" });
  await settled(service, project, slug, "done");
  assert.equal(runs()[2].resume, own);
  const latest = works(service, project, slug).pop();
  assert.equal(latest.context.resumed, true);
  assert.equal(latest.context.conversation, 5000);
  assert.equal(latest.carriedFrom, undefined);
});

test("Carry on is refused while the line runs, and after you stop it the agent hears you stopped it", async () => {
  fs.rmSync(runLog, { force:true }); setMode("slow");
  const { service, project } = setup();
  const { slug } = await service.request(project, { text:"Tidy up", topic:"new", agent:"other" });
  await until(() => service.runs.size, "a run");
  await until(() => runs().length, "the agent to start");
  await assert.rejects(service.act(project, slug, "carry-on", { agent:"fake" }), error => error.status === 409 && /still running/.test(error.message));
  await service.act(project, slug, "stop");
  await settled(service, project, slug, "stopped");
  assert.equal(works(service, project, slug)[0].stopWhy, "stopped");
  setMode("");
  await assert.rejects(service.act(project, slug, "carry-on", { agent:"nobody" }), /not installed/);
  // The same agent again is fine too: it still gets a new conversation.
  await service.act(project, slug, "carry-on", { agent:"other" });
  await settled(service, project, slug, "done");
  const again = runs()[1];
  assert.equal(again.resume, "");
  assert.match(again.prompt, /Other was working on this and stopped \(the person stopped it\)/);
  // "fake" takes everything as one message, so the note is in it.
  setMode("limit");
  const { slug:two } = await service.request(project, { text:"Another thing", topic:"new", agent:"other" });
  await settled(service, project, two, "stopped");
  setMode("");
  await service.act(project, two, "carry-on", { agent:"fake" });
  await settled(service, project, two, "done");
  const last = runs().pop();
  assert.equal(last.me, "fake");
  assert.match(last.prompt, /Other was working on this and stopped \(it hit its usage limit\)/);
  assert.match(last.prompt, /<request>\nAnother thing\n<\/request>/);
});

test("a conversation's size is read from Claude Code's and Codex's own transcripts", () => {
  const home = path.join(temp, "home"), claude = path.join(home, ".claude", "projects", "-x-y"), codex = path.join(home, ".codex", "sessions", "2026", "11", "12");
  fs.mkdirSync(claude, { recursive:true }); fs.mkdirSync(codex, { recursive:true });
  fs.writeFileSync(path.join(claude, "abc.jsonl"), "c".repeat(1234));
  fs.writeFileSync(path.join(codex, "rollout-2026-11-12T10-00-00-0199-def.jsonl"), "d".repeat(4321));
  const conversations = new Conversations({ directory:path.join(temp, "conv"), service:{ store:{ deleted:{}, projects:[] } }, env:{}, home });
  assert.equal(conversations.transcriptBytes("claude", "abc"), 1234);
  assert.equal(conversations.transcriptBytes("codex", "0199-def"), 4321);
  assert.equal(conversations.transcriptBytes("claude", "missing"), 0);
  assert.equal(conversations.transcriptBytes("dsh", "abc"), 0);
});
