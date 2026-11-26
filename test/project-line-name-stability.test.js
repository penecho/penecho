"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const F = require("../src/server/project-lines/format.js");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-name-stability-"));
test.after(() => fs.rmSync(temp, { recursive:true, force:true }));
const script = path.join(temp, "agent.cjs");
// Exercise the real adapters' instructions and resume transports without calling an LLM.
fs.writeFileSync(script, `
const fs = require('node:fs');
const [log, agent, ...args] = process.argv.slice(2);
const record = row => fs.appendFileSync(log, JSON.stringify({ agent, ...row }) + '\\n');
const say = row => process.stdout.write(JSON.stringify(row) + '\\n');
record({ kind:'launch', args });
let buffer = '', resumed = args.includes('--resume');
const answer = () => 'Fixed.\\n\\n<!-- penecho: title="' + (resumed ? 'Later conflicting title' : agent + ' tap repair') + '" tags="tap, washer" -->';
process.stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split('\\n'); buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (agent === 'codex') {
      record({ kind:'rpc', ...m });
      if (m.method === 'initialize') say({ id:m.id, result:{} });
      if (m.method === 'thread/start' || m.method === 'thread/resume') {
        resumed = m.method === 'thread/resume';
        say({ id:m.id, result:{ thread:{ id:'thread-1' } } });
      }
      if (m.method === 'turn/start') {
        say({ id:m.id, result:{ turn:{ id:'turn-1' } } });
        say({ method:'item/completed', params:{ threadId:'thread-1', item:{ id:'reply', type:'agentMessage', text:answer() } } });
        say({ method:'turn/completed', params:{ threadId:'thread-1', turn:{ id:'turn-1', status:'completed' } } });
      }
    } else if (m.type === 'user') {
      record({ kind:'input', text:m.message.content });
      say({ type:'system', subtype:'init', session_id:'session-' + agent });
      say({ type:'assistant', message:{ content:[{ type:'text', text:answer() }] } });
      say({ type:'result', subtype:'success', is_error:false, result:answer() });
    }
  }
}).on('end', () => process.exit(0));
`);

let counter = 0;
function setup(t, agent = "claude") {
  const dir = path.join(temp, String(++counter)), log = path.join(dir, "calls.jsonl");
  fs.mkdirSync(dir, { recursive:true });
  const directory = path.join(dir, "state"), source = { ready:() => true, open:() => ({ id:"test-proxy", url:"http://model.invalid", secret:"test-only" }) };
  const agents = createAgents({ env:{ PATH:"", HOME:dir, CLAUDE_CLI_PATH:process.execPath, CODEX_CLI_PATH:process.execPath }, paths:{ stateDir:directory, penecho:source }, appFolders:[] });
  const open = () => new Service({ directory, agents, autoWatch:false, spawnFn:(command, args, options) => {
    const id = args.includes("app-server") ? "codex" : args.some(a => /penecho-runner\.mjs$/.test(a)) ? "penecho" : "claude";
    return spawn(process.execPath, [script, log, id, ...args], options);
  } });
  let service = open(), project = service.store.create({ name:"Home", docsPath:path.join(dir, "docs") });
  project.defaultAgent = agent;
  t.after(() => service.close());
  return {
    get service() { return service; }, get project() { return project; },
    rows:() => fs.readFileSync(log, "utf8").trim().split("\n").map(row => JSON.parse(row)),
    restart() { const id = project.id; service.close(); service = open(); project = service.store.projects.find(p => p.id === id); },
  };
}
const docOf = (h, slug) => F.parseLine(h.service.readDoc(h.project, slug));
async function done(h, slug) {
  const start = Date.now();
  while (h.service.runs.size || docOf(h, slug).status !== "done") {
    if (Date.now() - start > 8000) throw Error("Timed out waiting for the Work to end");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function instructions(rows, agent, resumed) {
  if (agent === "codex") {
    const opened = rows.findLast(row => ["thread/start", "thread/resume"].includes(row.method));
    assert.equal(opened.method, resumed ? "thread/resume" : "thread/start");
    if (resumed) assert.equal(opened.params.threadId, "thread-1");
    return opened.params.developerInstructions;
  }
  const args = rows.findLast(row => row.kind === "launch").args;
  assert.equal(args.includes("--resume"), resumed);
  if (resumed) assert.equal(args[args.indexOf("--resume") + 1], `session-${agent}`);
  return args[args.indexOf(agent === "claude" ? "--append-system-prompt" : "--instructions") + 1];
}
// The instructions are the same from run to run; the run's own message names the Line and its Work (PE-916).
function namedInstructions(text, input, slug) {
  assert.match(text, /Docs folder:/, "full project guidance survives resume");
  assert.doesNotMatch(text, new RegExp(`lines/${slug}\\.md`));
  assert.match(input, new RegExp(`^Authoritative Line record: lines/${slug}\\.md\\.`, "m"));
  assert.match(input, /^Keep this Line's existing name\.$/m);
  assert.match(text, /PenEcho saves your last message as this Work's result/);
  for (const part of [text, input]) assert.doesNotMatch(part, /penecho: title|title="…"|tags=|Choose this line's name/, "a named line is asked nothing about its name or tags");
}
function visibleInput(rows, agent) {
  if (agent === "codex") return rows.findLast(row => row.method === "turn/start").params.input[0].text;
  const content = rows.findLast(row => row.kind === "input").text;
  return Array.isArray(content) ? content.map(part => part.text).join("\n") : content;
}

for (const agent of ["claude", "codex", "penecho"]) test(`${agent} resumes and reloads a named Line without asking for another name`, async t => {
  const h = setup(t, agent), { slug } = await h.service.createTopic(h.project, { text:"The kitchen tap drips. Please fix it." });
  await done(h, slug);
  // The name is asked for in the run's own message; the instructions stay the same from run to run (PE-916).
  assert.match(visibleInput(h.rows(), agent), /Choose this line's name yourself; do not ask the person/);
  assert.match(visibleInput(h.rows(), agent), /title="…"/);
  assert.doesNotMatch(instructions(h.rows(), agent, false), /title="…"/);
  assert.equal(docOf(h, slug).title, `${agent} tap repair`);
  assert.equal(docOf(h, slug).front["title by"], agent);
  for (const text of ["And the shower too.", "Check it once more after reload."]) {
    if (text.includes("reload")) h.restart();
    await h.service.request(h.project, { topic:slug, text, agent });
    await done(h, slug);
    namedInstructions(instructions(h.rows(), agent, true), visibleInput(h.rows(), agent), slug);
    // An agent in Reviewed access (Claude by default) is also told what the person allows, as the last part.
    const [said, context, ...rest] = visibleInput(h.rows(), agent).split("\n\n").filter(part => !/^Reviewed mode permissions: /.test(part));
    assert.equal(said, text, "the app shows the person's message first");
    assert.match(context, /^Current PenEcho Work: Work \d+\. Task: continue the selected task\.\nAuthoritative Line record: /);
    assert.equal(rest.length, 1, "and only which Work this is and how to do it after it");
    assert.match(rest[0], /^Do it the way you normally would/);
    assert.equal(docOf(h, slug).title, `${agent} tap repair`, "a conflicting later title is ignored");
  }
});

test("switching agents keeps the first title, and the person can still rename it", async t => {
  const h = setup(t), { slug } = await h.service.createTopic(h.project, { text:"Fix the tap." });
  await done(h, slug);
  for (const agent of ["codex", "penecho"]) {
    await h.service.request(h.project, { topic:slug, text:"Check the washer.", agent });
    await done(h, slug);
    namedInstructions(instructions(h.rows(), agent, false), visibleInput(h.rows(), agent), slug);
    assert.equal(docOf(h, slug).title, "claude tap repair");
    assert.equal(docOf(h, slug).front["title by"], "claude");
  }
  await h.service.act(h.project, slug, "rename", { title:"Home plumbing", baseHash:F.hashText(h.service.readDoc(h.project, slug)) });
  await h.service.request(h.project, { topic:slug, text:"Check the sink too.", agent:"codex" });
  await done(h, slug);
  // After another agent's Work, Codex starts fresh, even if it was here before (PE-564).
  namedInstructions(instructions(h.rows(), "codex", false), visibleInput(h.rows(), "codex"), slug);
  assert.equal(docOf(h, slug).title, "Home plumbing");
  assert.equal(docOf(h, slug).front["title by"], "you");
});

function externalLine(h) {
  const words = "The kitchen tap drips. Please fix it.", slug = "external";
  h.service.writeDoc(h.project, slug, F.initialLine({ id:"T-1", title:F.titleFromText(words), status:"working", steps:[F.askStep({ words }), F.workStep({ who:"codex" })] }));
  return { slug, rec:{ id:"external-session", slug, agent:"codex", projectId:h.project.id, stepId:"work-1", cwd:h.project.docsPath, workStarted:Date.now() } };
}
const reply = title => `Fixed.\n\n<!-- penecho: title="${title}" tags="tap, washer" -->`;

test("an external reply saves its name immediately, before another reply or the app's title arrives", async t => {
  const h = setup(t), { slug, rec } = externalLine(h), text = reply("Kitchen tap repair");
  await h.service.conversationChanges(h.project, rec, [{ said:text }]);
  assert.equal(rec.lastSay, text, "the complete result remains available for tags and details");
  assert.equal(docOf(h, slug).title, "Kitchen tap repair");
  assert.equal(docOf(h, slug).front["title by"], "codex");
  h.service.conversations.named({ ...rec, title:"A later app title" });
  await h.service.conversationChanges(h.project, rec, [{ said:"Another message without metadata." }]);
  await h.service.closeDetail(h.project, slug, "work-1", { result:reply("A later result title") });
  assert.equal(docOf(h, slug).title, "Kitchen tap repair");
  assert.equal(F.wantsTitle(docOf(h, slug)), false);
});

test("a saved external result names its Line once, keeps no tags, and obeys a user rename", async t => {
  const h = setup(t), { slug, rec } = externalLine(h);
  await h.service.closeDetail(h.project, slug, "work-1", { result:reply("Kitchen tap repair") });
  assert.equal(docOf(h, slug).title, "Kitchen tap repair");
  assert.equal(docOf(h, slug).front["title by"], "codex");
  const detail = h.service.store.readText(h.project, F.detailPath(slug, "work-1")).text;
  assert.match(detail, /# Work 1: Kitchen tap repair/);
  assert.equal(F.splitFront(detail).front.tags, undefined, "tags an agent still sends are not kept");
  assert.match(F.sectionText(detail, "Result"), /^<!-- result:.*-->\nFixed\.\n<!-- \/result -->$/);
  assert.doesNotMatch(detail, /penecho:/, "title and tags metadata stay hidden");
  await h.service.closeDetail(h.project, slug, "work-1", { result:reply("Later conflicting title") });
  assert.equal(docOf(h, slug).title, "Kitchen tap repair");
  await h.service.act(h.project, slug, "rename", { title:"Home plumbing", baseHash:F.hashText(h.service.readDoc(h.project, slug)) });
  await h.service.conversationChanges(h.project, rec, [{ said:reply("Another agent title") }]);
  await h.service.closeDetail(h.project, slug, "work-1", { result:reply("A recovery title") });
  h.service.conversations.named({ ...rec, title:"An app title" });
  assert.equal(docOf(h, slug).title, "Home plumbing");
  assert.equal(docOf(h, slug).front["title by"], "you");
});
