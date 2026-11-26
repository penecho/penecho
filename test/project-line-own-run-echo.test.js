"use strict";
require("./helpers/safety.js");
// PE-511: a dsh run PenEcho started wrote PenEcho's own prompt into its conversation a second after naming it, and that came back
// as a second Ask "· dsh" with the whole prompt. Then the run was cut off and the quiet conversation closed its Work as "Done".
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-own-run-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Own run", docsPath:path.join(root, "docs") });
  project.follow = false; service.store.save();
  service.writeDoc(project, "one", F.initialLine({ title:"One", status:"working", steps:[F.askStep({ words:"Make the button better" }), F.workStep({ who:"dsh" })] }));
  service.sync(project);
  const rec = { agent:"dsh", id:"session-1", via:"dsh", slug:"one", projectId:project.id, lastAt:Date.now(), doneTurns:{}, lastSay:"", stepId:"work-1", startedHere:true, active:true };
  const asks = () => F.parseLine(service.readDoc(project, "one")).steps.filter(s => s.kind === "ask");
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, project, rec, asks };
}

test("what PenEcho's own run sent its agent does not come back as another Ask", async t => {
  const { service:s, project:p, rec, asks } = setup(t);
  s.runs.set(s.key(p, "one"), { agent:"dsh", sessionId:"session-1", stepId:"work-1" });
  await s.conversationChanges(p, rec, [{ me:"<request>\nMake the button better\n</request>\n\nCurrent PenEcho Work: Work 1.", at:Date.now() }]);
  assert.equal(asks().length, 1);
  assert.notEqual(rec.resumedElsewhere, true);
  s.runs.delete(s.key(p, "one"));
});

test("words typed into the agent's own app after PenEcho's run still join the line", async t => {
  const { service:s, project:p, rec, asks } = setup(t);
  await s.conversationChanges(p, rec, [{ me:"Also make it blue", at:Date.now() }]);
  assert.equal(asks().length, 2);
  assert.match(asks()[1].body || asks()[1].words || "", /Also make it blue/);
});

test("a run PenEcho started that went quiet with no reply stops with Retry, never Done", async t => {
  const { service:s, project:p, rec } = setup(t);
  rec.turnOpen = false;
  await s.conversationQuiet(p, rec);
  const doc = F.parseLine(s.readDoc(p, "one")), work = doc.steps.find(x => x.id === "work-1");
  assert.equal(doc.status, "stopped");
  assert.match(doc.front.why, /PenEcho closed while this was running/);
  assert.ok(!work.done, "the Work is not ticked");
});

test("a run PenEcho started that replied still finishes with its reply", async t => {
  const { service:s, project:p, rec } = setup(t);
  rec.lastSay = "The button is now in the box.";
  await s.conversationQuiet(p, rec);
  const md = s.readDoc(p, "one"), work = F.parseLine(md).steps.find(x => x.id === "work-1");
  assert.ok(work.done);
  assert.match(md, /The button is now in the box\./);
});

test("PE-539: a run another PenEcho started on the same folder never becomes a line titled <request>", async t => {
  const { service:s, project:p } = setup(t);
  const before = s.store.scan(p).topics.length;
  const rec = { agent:"antigravity", id:"conv-1", via:"Antigravity CLI", lastAt:0, doneTurns:{}, lastSay:"" };
  const prompt = "<request>\ndraw a clock on it\n</request>\n\nCurrent PenEcho Work: Work 1. Task: new independent task.\nAuthoritative Line record: lines/one.md. Project docs: /docs.\nCurrent result destination: works/one/work-1.md.";
  await s.conversationChanges(p, rec, [{ me:prompt, at:Date.now() }, { said:"Done, a clock.", at:Date.now() }]);
  assert.equal(s.store.scan(p).topics.length, before, "no second line");
  assert.equal(rec.penechoRun, true);
  await s.conversationChanges(p, rec, [{ said:"Later words from that run", at:Date.now() }]);
  assert.equal(s.store.scan(p).topics.length, before);
  // A person's own conversation is still read.
  const mine = { agent:"antigravity", id:"conv-2", via:"Antigravity CLI", lastAt:0, doneTurns:{}, lastSay:"" };
  await s.conversationChanges(p, mine, [{ me:"Make the header blue", at:Date.now() }]);
  assert.equal(s.store.scan(p).topics.length, before + 1);
});

test("internal reviewer and Ask-tab prompts never become standalone imported Lines", async t => {
  const { service:s, project:p } = setup(t);
  const before = s.store.scan(p).topics.length;
  const reviewRec = { agent:"opencode", id:"ses_rev_1", via:"OpenCode", lastAt:0, doneTurns:{}, lastSay:"" };
  const reviewPrompt = "You are reviewing another agent's finished work for the person who asked for it.\nYou did not do this work. Judge every Work against what that specific job actually needed.\n\n<ask>\nFix bug\n</ask>";
  await s.conversationChanges(p, reviewRec, [{ me:reviewPrompt, at:Date.now() }, { said:'{"verdict":"ready","outcome":5}', at:Date.now() }]);
  assert.equal(s.store.scan(p).topics.length, before, "reviewer session must not create a Line");
  assert.equal(reviewRec.penechoRun, true);

  const lineReviewRec = { agent:"opencode", id:"ses_rev_line", via:"OpenCode", lastAt:0, doneTurns:{}, lastSay:"" };
  const lineReviewPrompt = "<request>\nPlease review Work 3 on this Line and rate it according to the scoring standard and report format below.\n</request>\n\nCurrent PenEcho Work: Review of Work 3. Task: new independent task.\nAuthoritative Line record: lines/one.md. Project docs: /docs.";
  await s.conversationChanges(p, lineReviewRec, [{ me:lineReviewPrompt, at:Date.now() }, { said:'{"verdict":"ready","outcome":5}', at:Date.now() }]);
  assert.equal(s.store.scan(p).topics.length, before, "Line-context reviewer session must not create a Line");
  assert.equal(lineReviewRec.penechoRun, true);

  const contRec = { agent:"opencode", id:"ses_rev_cont", via:"OpenCode", lastAt:0, doneTurns:{}, lastSay:"" };
  await s.conversationChanges(p, contRec, [{ me:"Your previous review stopped before you returned the final JSON review form. Continue from where you left off without redoing checks you already completed.", at:Date.now() }]);
  assert.equal(s.store.scan(p).topics.length, before, "continued review session must not create a Line");
  assert.equal(contRec.penechoRun, true);

  const askRec = { agent:"opencode", id:"ses_ask_1", via:"OpenCode", lastAt:0, doneTurns:{}, lastSay:"" };
  const askPrompt = 'You are the admin of the project "PenEcho". The person asks how some part of it is going. Answer from the project\'s records below and nothing else:\n\n<question>\nstatus?\n</question>';
  await s.conversationChanges(p, askRec, [{ me:askPrompt, at:Date.now() }, { said:"**Summary**\nAll good.", at:Date.now() }]);
  assert.equal(s.store.scan(p).topics.length, before, "Ask-tab session must not create a Line");
  assert.equal(askRec.penechoRun, true);

  const askRecV2 = { agent:"antigravity", id:"conv_ask_2", via:"Antigravity CLI", lastAt:0, doneTurns:{}, lastSay:"" };
  const askPromptV2 = 'You are answering a question about the project "PenEcho" in PenEcho. Read-only: do not edit files, commit, or change anything in the project.\n\n<question>\nwhat is the rule?\n</question>';
  await s.conversationChanges(p, askRecV2, [{ me:askPromptV2, at:Date.now() }, { said:"Summary answer [PE-1].", at:Date.now() }]);
  assert.equal(s.store.scan(p).topics.length, before, "New Ask-tab session must not create a Line");
  assert.equal(askRecV2.penechoRun, true);

  // A person asking a question mentioning the reviewer still creates a normal Line.
  const humanRec = { agent:"opencode", id:"ses_human_1", via:"OpenCode", lastAt:0, doneTurns:{}, lastSay:"" };
  await s.conversationChanges(p, humanRec, [{ me:"Why did this reviewer show up as a new session?", at:Date.now() }]);
  assert.equal(s.store.scan(p).topics.length, before + 1);
  assert.notEqual(humanRec.penechoRun, true);
});
