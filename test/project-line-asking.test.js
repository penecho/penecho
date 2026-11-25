"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { Conversations, claudeLine, openQuestion } = require("../src/server/project-lines/conversations.js");
const { dshLine } = require("../src/server/project-lines/agent-sessions.js");
const { questionsOf } = require("../src/server/project-lines/activity.js");
const F = require("../src/server/project-lines/format.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
const ASKED = { questions:[
  { id:"weak", header:"What to fix", question:"In the Work 2 prototype, what felt weak?", multi_select:true, options:[{ label:"No sense of progress", description:"Nothing tells you how many." }, { label:"The mark is too hidden" }] },
  { id:"format", header:"Two prototypes", question:"How should the two prototypes be presented?", options:[{ label:"One page, two looks on a switch" }] },
] };
function setup(t, steps = [F.askStep({ words:"Please help" }), F.workStep({ who:"dsh" })], status = "working") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-asking-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"Asking", docsPath:path.join(root, "docs") });
  project.follow = false; service.store.save();
  service.writeDoc(project, "one", F.initialLine({ title:"One", status, steps }));
  service.sync(project);
  const line = () => service.stateOf(project).lines.find(l => l.id === "one");
  const rec = { agent:"dsh", id:"s1", via:"dsh", slug:"one", projectId:project.id, lastAt:Date.now(), doneTurns:{}, lastSay:"", stepId:"work-1", active:true };
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, project, line, rec };
}
const askedRow = (id = "q1") => ({ add:{ kind:"tool", id, state:"running", verb:"Asked you", target:"", questions:questionsOf(ASKED) }, at:Date.now() });

test("the words of a question are read from each agent's own shape", () => {
  assert.deepEqual(questionsOf(ASKED), [
    { text:"In the Work 2 prototype, what felt weak?", options:["No sense of progress", "The mark is too hidden"] },
    { text:"How should the two prototypes be presented?", options:["One page, two looks on a switch"] },
  ]);
  assert.deepEqual(questionsOf({ question:"Only one?", options:["Yes", "No"] }), [{ text:"Only one?", options:["Yes", "No"] }]);
  assert.deepEqual(questionsOf({}), []);
  assert.deepEqual(questionsOf({ questions:[{ question:"" }] }), []);

  const claude = claudeLine(JSON.stringify({ type:"assistant", timestamp:new Date().toISOString(), message:{ content:[{ type:"tool_use", id:"t1", name:"AskUserQuestion", input:{ questions:[{ question:"Which one?", options:[{ label:"A" }] }] } }] } }));
  assert.equal(claude.changes[0].add.verb, "Asked you");
  assert.deepEqual(claude.changes[0].add.questions, [{ text:"Which one?", options:["A"] }]);
  assert.equal(claude.changes[0].add.state, "running");

  // The shape dsh really wrote, at 03:51 on 2026-11-07.
  const dsh = dshLine(JSON.stringify({ type:"tool/call", seq:165, time:1794023483760, data:{ turn:1, step:16, callId:"call_1", name:"ask_user_question", arguments:JSON.stringify(ASKED) } }));
  assert.equal(dsh.changes[0].add.verb, "Asked you");
  assert.equal(dsh.changes[0].add.questions[1].text, "How should the two prototypes be presented?");
  const answer = dshLine(JSON.stringify({ type:"tool/result", seq:166, time:1794023722722, data:{ turn:1, step:16, message:{ role:"tool", source:{ kind:"tool", callId:"call_1" }, toolCallId:"call_1", content:[{ type:"text", text:"{\"answers\":[]}" }], isError:false } } }));
  assert.equal(answer.changes[0].patch.id, "call_1");
  assert.equal(answer.changes[0].patch.state, "done");
});

test("an open question makes the line wait for you, and the answer sets it going again", async t => {
  const { service:s, project:p, line, rec } = setup(t);
  const before = line().readRevision;
  await s.conversationChanges(p, rec, [askedRow()]);
  const l = line(), work = l.stations.find(x => x.id === "work-1");
  assert.equal(l.asking.kind, "tool");
  assert.equal(l.asking.agent, "dsh");
  assert.equal(l.asking.step, "work-1");
  assert.equal(l.asking.questions.length, 2);
  assert.equal(l.status, "waiting", "the page says it needs you");
  assert.equal(work.state, "wait", "no longer turning");
  assert.equal(work.asked, true);
  assert.equal(work.why, "In the Work 2 prototype, what felt weak?", "the question, not the tool's name");
  assert.equal(work.now, "");
  assert.equal(F.parseLine(s.readDoc(p, "one")).status, "working", "the file is not rewritten for this");
  assert.equal(l.readRevision, before, "being asked is not a change to read, so Unread does not turn on for it");

  await s.conversationChanges(p, rec, [{ patch:{ id:"q1", state:"done", output:"{}" } }]);
  const after = line();
  assert.equal(after.asking, null);
  assert.equal(after.status, "working");
  assert.equal(after.stations.find(x => x.id === "work-1").state, "active");
  assert.equal(after.stations.find(x => x.id === "work-1").now, "Working");
});

test("waiting longer than a turn is allowed does not finish the Work", async t => {
  const { service:s, project:p, line, rec } = setup(t);
  await s.conversationChanges(p, rec, [askedRow()]);
  const conversations = new Conversations({ service:s, directory:s.directory, autoWatch:false });
  rec.lastAt = rec.mtime = Date.now() - 18 * 60000; rec.turnOpen = true;
  assert.equal(conversations.isActive(rec), true, "the 18 minutes one question really waited");
  assert.equal(line().asking.kind, "tool");

  rec.asking = { ...rec.asking, at:Date.now() - 25 * 3600000 };
  assert.equal(openQuestion(rec), null, "a conversation closed without answering says nothing, so it stops counting");
  assert.equal(conversations.isActive(rec), false);
  s.conversationStillGoing(p, rec);
  assert.equal(line().asking, null);
});

test("anything you say in that conversation ends the question", async t => {
  const { service:s, project:p, line, rec } = setup(t);
  await s.conversationChanges(p, rec, [askedRow()]);
  await s.conversationChanges(p, rec, [{ me:"Never mind that", at:Date.now() }]);
  assert.equal(line().asking, null);
});

test("another tool finishing does not end the question", async t => {
  const { service:s, project:p, line, rec } = setup(t);
  await s.conversationChanges(p, rec, [{ add:{ kind:"tool", id:"r1", state:"running", verb:"Read", target:"a.js" }, at:Date.now() }, askedRow(), { patch:{ id:"r1", state:"done" } }]);
  assert.equal(line().asking.kind, "tool");
});

test("a second agent's running Work stays running beside the question", async t => {
  const { service:s, project:p, line, rec } = setup(t, [F.askStep({ words:"Two" }), F.workStep({ who:"dsh" }), F.askStep({ words:"Other" }), F.workStep({ who:"claude" })]);
  const other = { ...rec, agent:"claude", id:"c1", stepId:"work-2" };
  await s.conversationChanges(p, other, [{ add:{ kind:"tool", id:"r1", state:"running", verb:"Read", target:"a.js" }, at:Date.now() }]);
  await s.conversationChanges(p, rec, [askedRow()]);
  const stations = line().stations, mine = stations.find(x => x.id === "work-1"), theirs = stations.find(x => x.id === "work-2");
  assert.equal(mine.state, "wait");
  assert.equal(theirs.state, "active");
  assert.equal(line().status, "waiting");
});

test("an archived line never asks", async t => {
  const { service:s, project:p, rec } = setup(t);
  await s.conversationChanges(p, rec, [askedRow()]);
  s.writeDoc(p, "one", F.setFront(s.readDoc(p, "one"), { status:"closed" }));
  assert.equal(s.stateOf(p).landed.find(l => l.id === "one").asking, null);
});

test("a /grill-me stop asks, in the words of the question it ended on", async t => {
  const { line } = setup(t, [F.askStep({ words:"/grill-me the plan" }), { ...F.workStep({ who:"claude" }), kind:"grill", label:"Grill", body:"Should it stop at the first failure?" }], "waiting");
  const l = line();
  assert.equal(l.asking.kind, "grill");
  assert.ok(l.asking.questions[0].text.includes("Should it stop at the first failure?"));
});

test("a reply ending in a question only asks when you said grill me", async t => {
  const done = F.workStep({ who:"claude", done:true, took:"5 min", body:"All built. Want me to commit it?" });
  const quiet = setup(t, [F.askStep({ words:"Build it" }), done], "done");
  assert.equal(quiet.line().asking, null, "\"Want me to…?\" has stopped nothing");
  const grilled = setup(t, [F.askStep({ words:"Grill me on this design" }), done], "done");
  assert.equal(grilled.line().asking.kind, "reply");
  assert.equal(grilled.line().asking.questions[0].text, "Want me to commit it?");
  const answered = setup(t, [F.askStep({ words:"Grill me on this design" }), done, F.askStep({ words:"Yes" })], "done");
  assert.equal(answered.line().asking, null, "the next Ask is the answer");
});

test("a question in the Topic file asks too, until it is ticked", async t => {
  const { service:s, project:p, line } = setup(t, [F.askStep({ words:"Which?" }), F.workStep({ who:"claude", done:true, took:"1 min", body:"Done" })], "done");
  const asking = (ticked = " ") => s.writeDoc(p, "one", s.readDoc(p, "one").replace(/\n## Ask/, `\n## ${F.QUESTIONS}\n\n**Which colour?** (@claude)\n- [${ticked}] Amber\n- [ ] Violet\n\n## Ask`));
  asking();
  assert.equal(line().asking.kind, "topic");
  assert.deepEqual(line().asking.questions, [{ text:"Which colour?", options:["Amber", "Violet"] }]);
});

test("the question at the end of a reply is found the same way as on the page", () => {
  assert.equal(F.questionIn("All built.\n\nWant me to **commit** it?"), "Want me to commit it?");
  assert.equal(F.questionIn("Is it right? I think so."), "");
  assert.equal(F.questionIn("这样可以吗？"), "这样可以吗？");
  assert.equal(F.questionIn(""), "");
});

test("prototypes to choose from and grill questions stay in Needs you until you answer, before To review", async t => {
  const STATUS = require("../public/lines/line-status.js");
  const doneChoiceQ = F.workStep({ who:"claude", done:true, took:"2 min", body:"Made 2 options. Which prototype works better?" });
  const protoQ = setup(t, [F.askStep({ words:"Make 2 prototypes for me to choose from" }), doneChoiceQ], "done");
  assert.equal(protoQ.line().asking.kind, "reply");
  assert.equal(STATUS.lineNeedsYou(protoQ.line()), true);
  assert.equal(STATUS.toReview(protoQ.line()), false);
  assert.equal(STATUS.shownState(protoQ.line()), "wait");

  const doneChoiceText = F.workStep({ who:"claude", done:true, took:"2 min", body:"Created Option A and Option B prototype pages." });
  const protoPick = setup(t, [F.askStep({ words:"Design prototypes for me to choose from" }), doneChoiceText], "done");
  assert.equal(protoPick.line().asking.kind, "reply");
  assert.equal(STATUS.lineNeedsYou(protoPick.line()), true);

  const chosen = setup(t, [F.askStep({ words:"Make 2 prototypes for me to choose from" }), doneChoiceQ, F.askStep({ words:"Build option 2" }), F.workStep({ who:"claude", done:true, took:"3 min", body:"Built option 2." })], "done");
  assert.equal(chosen.line().asking, null);
  assert.equal(STATUS.lineNeedsYou(chosen.line()), false);
  assert.equal(STATUS.toReview(chosen.line()), true);

  const zhGrill = setup(t, [F.askStep({ words:"先问我几个问题再开始" }), F.workStep({ who:"claude", done:true, took:"1 min", body:"你需要哪种布局？" })], "done");
  assert.equal(zhGrill.line().asking.kind, "reply");
  assert.equal(zhGrill.line().asking.questions[0].text, "你需要哪种布局？");
});

test("detectPath catches multi-prototype and grill requests and puts Needs you before To review", () => {
  const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
  const STATUS = require("../public/lines/line-status.js");
  const stateSrc = fs.readFileSync(path.join(__dirname, "../public/lines/state.js"), "utf8");
  const slice = stateSrc.slice(stateSrc.indexOf("const DECK_WORDS ="), stateSrc.indexOf("const titleFromText ="));
  const ctx = vm.createContext({ homeShape:() => "map" });
  vm.runInContext(slice + "\nglobalThis.planOf = (t, c, p) => JSON.stringify(detectPath(t, c, p));", ctx);
  const planOf = (t, c, p) => JSON.parse(ctx.planOf(t, c, p));

  assert.deepEqual(planOf("make 3 prototypes for me to choose from", { flags:{} }, {}), { kind:"line", path:"work", kinds:["ask", "prototype", "work"] });
  assert.deepEqual(planOf("做几个原型让我选", { flags:{} }, {}), { kind:"line", path:"work", kinds:["ask", "prototype", "work"] });
  assert.deepEqual(planOf("ask me questions before coding", { flags:{} }, {}), { kind:"line", path:"work", kinds:["ask", "grill", "work"] });
  const keys = Object.keys(STATUS.filters);
  assert.ok(keys.indexOf("you") !== -1 && keys.indexOf("you") < keys.indexOf("review"));
});
