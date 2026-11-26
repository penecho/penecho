"use strict";
require("./helpers/safety.js");
require("./helpers/show-topics.js");
// PE-916: PenEcho's own part of a Work stays a small share of its tokens. Owner: "fix them to at most account more for less than 2%.
// This is a must. We should not add more while claiming that we saved tokens for users." and "for those small bug fixes we do not
// even to update memory or topics." So a run is told nothing it must read first or write at the end, and a requirement the agent
// names in its last message is filed in the Line's Topic by PenEcho, with no tokens.
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const F = require("../src/server/project-lines/format.js"), C = require("../src/server/project-lines/task-context.js"), K = require("../src/server/project-lines/knowledge.js");
const { Service, buildInstructions } = require("../src/server/project-lines/service.js");
const Memory = require("../src/server/project-lines/memory.js");
const AgentHelp = require("../src/server/project-lines/agent-help.js");

const TOPIC = `---
record_type: topic
id: topic-ab12
title: Accounts
area: Product
parent_id: null
updated: 2026-11-01
updated_by: PE-1 Work 1
---

# Accounts

**Signing in and out.**

Status on 2026-11-01: sign-in works.

## What is left, in order

1. Decide the password rules — owner (R2)
2. Something else — owner (R1)

## Requirements

### R1 · Sign in — ✅ Done

People sign in with email.

- **Asked:** "let people sign in" ([PE-1](../lines/sign-in.md))
- **Done:** Email sign-in works ([PE-1 W1](../works/sign-in/work-1.md))

### R2 · Password rules — 📐 Agreed

Passwords need rules.

- **Asked:** "passwords need rules" ([PE-2](../lines/passwords.md))
- **Left:** Choose the rules · waits on owner

## Lines

| Line | What it is | Requirements |
| --- | --- | --- |
| [PE-1](../lines/sign-in.md) | Sign in | R1 |
| [PE-2](../lines/passwords.md) | Passwords | R2 |
`;

test("a run's own instructions stay small, and name nothing to read first or write at the end", () => {
  const docs = "/Users/someone/Documents/PenEcho/A project with a long name";
  const ctx = { compact:true, project:"A project with a long name", docs, code:true, slug:"a-line-with-a-long-name", base:"main", topicPath:"lines/a-line-with-a-long-name.md",
    detailPath:"works/a-line-with-a-long-name/work-12.md", linesFolder:path.join(docs, "lines"), memory:true, knowledge:K.knowledgeNote(), words:"Fix it", files:[], said:[], note:"", moved:false, continuing:true, agent:"claude" };
  const step = { kind:"work", label:"Work 12", id:"work-12" };
  const told = buildInstructions(ctx, step), envelope = C.runEnvelope(ctx, step, { mode:"new" }, "");
  // Before PE-916 these were about 9.3 KB, with MEMORY.md, understanding.md, the Topic and topics-guide.md to read first (about 105 KB).
  // How the last message should read is about 250 tokens of it (owner, PE-1190: "this new prompt should not exceed 300 tokens").
  assert.ok(Buffer.byteLength(told) + Buffer.byteLength(envelope) < 4200, `${Buffer.byteLength(told) + Buffer.byteLength(envelope)} bytes`);
  const reply = told.slice(told.indexOf("PenEcho saves your last message as this Work's result"));
  assert.ok(reply.match(/[A-Za-z]+|\d+|[^\sA-Za-z\d]/g).length < 300, "the reply format stays under 300 tokens");
  assert.match(told, /never set user or system environment variables, startup items or trusted certificates/, "a variable set for the whole computer stopped the Codex app (PE-1131)");
  assert.match(told, /Keep searches inside the project's folders/, "a disk-wide search would make macOS ask the person for Downloads, Desktop and more");
  assert.doesNotMatch(told, /Read MEMORY\.md there first|Read .*understanding\.md first|topics-guide\.md|update that Topic/);
  assert.match(told, /read it only when your work changes how the whole product behaves or a tool misbehaves/);
  assert.match(told, /Leave understanding\.md and topics\/ alone unless the request is about them/);
  assert.match(told, /do not write the Work file yourself/);
  assert.doesNotMatch(told, /Do it the way you normally would/, "what to do is said once, in the run's own message");
  assert.match(envelope, /PenEcho saves your last message there as this Work's result/);
  assert.doesNotMatch(envelope, /Canvas shows/);
  assert.match(C.runEnvelope({ ...ctx, shown:["files/a/a.explorer.html"] }, step, { mode:"new" }, ""), /Canvas shows files\/a\/a\.explorer\.html\. If the request changes what that shows, update that file too/);
  assert.match(told, new RegExp(AgentHelp.NAME.replace(".", "\\.")), "pictures and browser checks are read only when needed");
  assert.ok(AgentHelp.text().includes("name.diagram.json"), "the help file has what the picture rules said");
});

test("MEMORY.md is not read before every Work, and earlier files get the new wording with their lines kept", () => {
  const old = `---\nproject: Demo\n---\n\n# Project memory\n\nWhat every agent working on Demo should know before starting, and can't quickly find in the code, git or a Topic. Read it first.\n\nThen read \`understanding.md\` next to this file: what the project is. After each Work, update your Line's Topic and \`understanding.md\` as \`.penecho/topics-guide.md\` says.\n\n## ${Memory.RULES_HEADING}\n\nold rules\n\n## Decisions\n\n- Owner: never do X (PE-1, 2026-11-01)\n\n## Facts\n`;
  const now = Memory.checkedMemory(old, "Demo", "DE", { layout:2 });
  assert.doesNotMatch(now, /Read it first|Then read `understanding\.md`|After each Work, update/);
  assert.match(now, /Read it when your work changes how the whole product behaves or a tool misbehaves/);
  assert.match(now, /- Owner: never do X \(PE-1, 2026-11-01\)/);
  assert.equal(Memory.checkedMemory(now, "Demo", "DE", { layout:2 }), now, "stable once changed");
  assert.match(Memory.RULES, /every small fix, add nothing/);
  assert.ok(Buffer.byteLength(Memory.RULES) < 2600);
});

test("a requirement named in the last message is taken out of the result and filed in the Line's Topic", () => {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-note-"));
  fs.mkdirSync(path.join(docs, "topics")); fs.writeFileSync(path.join(docs, "topics/accounts.md"), TOPIC);
  assert.match(K.knowledgeNote(docs, "passwords"), /This Line's requirements there: "Password rules"; to change one, use its name\./, "the run hears the names its Line holds");
  assert.doesNotMatch(K.knowledgeNote(docs, "elsewhere"), /This Line's requirements/);
  fs.rmSync(docs, { recursive:true, force:true });
  const meta = F.takeMeta('Done: rules are in.\n\n<!-- penecho: requirement="done | Password rules | Passwords need at least 12 characters." -->');
  assert.equal(meta.text, "Done: rules are in.");
  assert.equal(meta.requirement, "done | Password rules | Passwords need at least 12 characters.");
  assert.deepEqual(K.parseRequirement(meta.requirement), { status:"done", name:"Password rules", need:"Passwords need at least 12 characters." });
  assert.equal(K.parseRequirement("finished | x | y"), null, "an unknown status is not one");
  assert.equal(K.parseRequirement("done | only a name"), null);

  // The Line already holds R2: the newest word rewrites it in place.
  const line = { id:"PE-2", slug:"passwords", title:"Passwords" }, work = { id:"work-3", label:"Work 3" };
  const out = K.applyRequirement(TOPIC, { said:meta.requirement, line, work, ask:"Use 12 characters at least. Nothing else.", summary:"Passwords now need 12 characters.", date:"2026-11-22" });
  assert.match(out, /### R2 · Password rules — ✅ Done\n\nPasswords need at least 12 characters\.\n\n- \*\*Asked:\*\* "passwords need rules" \(\[PE-2\]\(\.\.\/lines\/passwords\.md\)\)\n- \*\*Asked:\*\* "Use 12 characters at least\." \(\[PE-2\]\(\.\.\/lines\/passwords\.md\)\)\n- \*\*Done:\*\* Passwords now need 12 characters\. \(\[PE-2 W3\]\(\.\.\/works\/passwords\/work-3\.md\)\)/);
  assert.doesNotMatch(out, /Choose the rules/, "done: nothing is left of it");
  assert.match(out, /## What is left, in order\n\n1\. Something else — owner \(R1\)/, "its item leaves What is left, and the rest is numbered again");
  assert.match(out, /### R1 · Sign in — ✅ Done\n\nPeople sign in with email\./, "other requirements stay as they were");
  assert.match(out, /^updated: 2026-11-22$/m);
  assert.match(out, /^updated_by: PE-2 Work 3$/m);
  assert.equal((out.match(/\(\.\.\/lines\/passwords\.md\) \| Passwords \| R2 \|/g) || []).length, 1, "its Lines row stays one row");

  // A new requirement on a new Line: added after the others, and the Line joins the Lines table.
  const added = K.applyRequirement(TOPIC, { said:"in progress | Sign out everywhere | People can sign out of every device at once.", line:{ id:"PE-3", slug:"sign-out", title:"Sign out" }, work:{ id:"work-1", label:"Work 1" }, ask:"add sign out everywhere", summary:"The button is there; devices are next.", date:"2026-11-22" });
  assert.match(added, /### R3 · Sign out everywhere — 🔨 In progress\n\nPeople can sign out of every device at once\.\n\n- \*\*Asked:\*\* "add sign out everywhere" \(\[PE-3\]\(\.\.\/lines\/sign-out\.md\)\)\n- \*\*Done:\*\* The button is there; devices are next\. \(\[PE-3 W1\]\(\.\.\/works\/sign-out\/work-1\.md\)\)\n\n## Lines/);
  assert.match(added, /\| \[PE-3\]\(\.\.\/lines\/sign-out\.md\) \| Sign out \| R3 \|\n?$/);
  assert.match(added, /2\. Something else — owner \(R1\)/, "in progress leaves What is left alone");

  // A second requirement on a Line that holds one: matched only by name, so the first is never overwritten.
  const again = K.applyRequirement(added, { said:"agreed | Session length | Sessions last 30 days.", line:{ id:"PE-3", slug:"sign-out", title:"Sign out" }, work:{ id:"work-2", label:"Work 2" }, ask:"sessions should last 30 days", summary:"Noted.", date:"2026-11-22" });
  assert.match(again, /### R3 · Sign out everywhere — 🔨 In progress\n\nPeople can sign out of every device at once\./);
  assert.match(again, /### R4 · Session length — 📐 Agreed\n\nSessions last 30 days\.\n\n- \*\*Asked:\*\* "sessions should last 30 days"/);
  assert.doesNotMatch(again, /Noted\./, "agreed: nothing done yet");
  assert.match(again, /\| \[PE-3\]\(\.\.\/lines\/sign-out\.md\) \| Sign out \| R3, R4 \|/);
  // Its R number works as its name too.
  assert.match(K.applyRequirement(TOPIC, { said:"problem | R1 | Email sign-in fails for plus addresses.", line, work, ask:"plus addresses fail", summary:"Found the cause.", date:"2026-11-22" }), /### R1 · Sign in — 🐞 Problem\n\nEmail sign-in fails for plus addresses\./);
  assert.equal(K.applyRequirement(TOPIC, { said:"not one", line, work }), TOPIC, "nothing named: nothing changes");
});

test("PenEcho files the requirement after the run, and the person never sees the marker", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-system-share-")), script = path.join(dir, "agent.cjs"), sayFile = path.join(dir, "say.txt");
  fs.writeFileSync(script, `
const fs=require('fs'),readline=require('readline'),out=o=>console.log(JSON.stringify(o));
readline.createInterface({input:process.stdin}).once('line',()=>{
 const text=fs.readFileSync(process.argv[2],'utf8');
 out({type:'system',subtype:'init',session_id:'s-'+Date.now(),model:'m'});
 out({type:'assistant',message:{id:'a1',model:'m',usage:{input_tokens:10,output_tokens:10},content:[{type:'text',text}]}});
 out({type:'result',session_id:'s',is_error:false,result:text});
 process.exit(0);
});`);
  const agents = { available:() => [{ id:"fake", name:"Fake", available:true }], nameOf:() => "Fake", desktop:() => null, terminal:() => "",
    command:(_agent, { workdir }) => ({ command:process.execPath, args:[script, sayFile], cwd:workdir, stdin:true, input:"stream-json", ownInstructions:true }) };
  const service = new Service({ directory:path.join(dir, "state"), agents, autoWatch:false, memory:{ home:dir, env:{} }, conversations:{ home:dir, env:{} } });
  const project = service.store.create({ name:"Share test", docsPath:path.join(dir, "docs") }); project.defaultAgent = "fake";
  t.after(() => { service.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  const settle = async () => { const start = Date.now(); while (service.runs.size || service.finishing.size) { if (Date.now() - start > 6000) throw Error("run timeout"); await new Promise(r => setTimeout(r, 20)); } };
  fs.writeFileSync(sayFile, "Looked at it.");
  const { slug } = await service.request(project, { text:"Passwords need rules", topic:"new", agent:"fake" });
  await settle();
  const id = F.parseLine(service.readDoc(project, slug)).front.id;
  service.store.writeText(project, "topics/accounts.md", TOPIC.replace("[PE-2](../lines/passwords.md) | Passwords | R2 |", `[${id}](../lines/${slug}.md) | Passwords | R2 |`).replace("([PE-2](../lines/passwords.md))", `([${id}](../lines/${slug}.md))`));
  fs.writeFileSync(sayFile, 'Passwords now need 12 characters.\n\n<!-- penecho: requirement="done | Password rules | Passwords need at least 12 characters." -->');
  await service.request(project, { text:"Use 12 characters at least.", topic:slug });
  await settle();
  const topic = service.store.readText(project, "topics/accounts.md").text;
  assert.match(topic, /### R2 · Password rules — ✅ Done\n\nPasswords need at least 12 characters\./);
  assert.match(topic, new RegExp(`- \\*\\*Done:\\*\\* Passwords now need 12 characters\\. \\(\\[${id} W2\\]\\(\\.\\./works/${slug}/work-2\\.md\\)\\)`));
  const detail = service.store.readText(project, `works/${slug}/work-2.md`).text;
  assert.doesNotMatch(F.sectionText(detail, "Result"), /requirement=/, "the result the person reads has no marker");
  assert.equal(F.splitFront(detail).front.requirement, "done | Password rules | Passwords need at least 12 characters.", "the Work keeps it, for a Topics rebuild");

  // A Work that names no requirement (a fix, a question) leaves the Topic exactly as it was.
  fs.writeFileSync(sayFile, "Fixed the typo.");
  await service.request(project, { text:"There is a typo on the sign-in page.", topic:slug });
  await settle();
  assert.equal(service.store.readText(project, "topics/accounts.md").text, topic);
});

test("blocking question reply markers set status: waiting and write ## Questions for you without editing files (PE-1097)", async t => {
  // Unit parsing checks: multi-question with options, open-ended ask, and waiting reason; markers stripped from text.
  const parsed = F.takeMeta('Need two choices before continuing.\n\n<!-- penecho: ask="Which DB? | Postgres | SQLite" -->\n<!-- penecho: ask="Deploy target? | Staging | Prod" -->');
  assert.equal(parsed.text, "Need two choices before continuing.");
  assert.deepEqual(parsed.questions, [
    { text:"Which DB?", options:["Postgres", "SQLite"] },
    { text:"Deploy target?", options:["Staging", "Prod"] },
  ]);
  const openWait = F.takeMeta('Cannot continue yet.\n\n<!-- penecho: waiting="Need staging API key" -->');
  assert.equal(openWait.text, "Cannot continue yet.");
  assert.equal(openWait.waiting, "Need staging API key");
  assert.equal(openWait.questions, undefined);

  // End-to-end Service test: agent emits ask marker -> detail gets ## Questions for you, Line is waiting, marker hidden.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-q-marker-")), script = path.join(dir, "agent.cjs"), sayFile = path.join(dir, "say.txt");
  fs.writeFileSync(script, `
const fs=require('fs'),readline=require('readline'),out=o=>console.log(JSON.stringify(o));
readline.createInterface({input:process.stdin}).once('line',()=>{
 const text=fs.readFileSync(process.argv[2],'utf8');
 out({type:'system',subtype:'init',session_id:'s-'+Date.now(),model:'m'});
 out({type:'assistant',message:{id:'a1',model:'m',usage:{input_tokens:10,output_tokens:10},content:[{type:'text',text}]}});
 out({type:'result',session_id:'s',is_error:false,result:text});
 process.exit(0);
});`);
  const agents = { available:() => [{ id:"fake", name:"Fake", available:true }], nameOf:() => "Fake", desktop:() => null, terminal:() => "",
    command:(_agent, { workdir }) => ({ command:process.execPath, args:[script, sayFile], cwd:workdir, stdin:true, input:"stream-json", ownInstructions:true }) };
  const service = new Service({ directory:path.join(dir, "state"), agents, autoWatch:false, memory:{ home:dir, env:{} }, conversations:{ home:dir, env:{} } });
  const project = service.store.create({ name:"Question marker test", docsPath:path.join(dir, "docs") }); project.defaultAgent = "fake";
  t.after(() => { service.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  const settle = async () => { const start = Date.now(); while (service.runs.size || service.finishing.size) { if (Date.now() - start > 6000) throw Error("run timeout"); await new Promise(r => setTimeout(r, 20)); } };

  fs.writeFileSync(sayFile, 'Please choose the database first.\n\n<!-- penecho: ask="Which DB? | Postgres | SQLite" -->');
  const { slug } = await service.request(project, { text:"Set up persistence", topic:"new", agent:"fake" });
  await settle();
  const doc = F.parseLine(service.readDoc(project, slug));
  assert.equal(doc.status, "waiting");
  assert.equal(doc.front.why, "Which DB?");
  assert.equal(doc.steps.find(s => s.id === "work-1")?.done, false, "Work stays open until answered");
  const detail = service.store.readText(project, "works/" + slug + "/work-1.md").text;
  assert.doesNotMatch(F.sectionText(detail, "Result"), /penecho:/, "marker is hidden from displayed result");
  const qs = F.parseDetailQuestions(detail, { workId:"work-1" });
  assert.equal(qs.length, 1);
  assert.deepEqual([qs[0].text, qs[0].options], ["Which DB?", ["Postgres", "SQLite"]]);
  const stateLine = service.stateOf(project).lines.find(l => l.id === slug);
  assert.equal(stateLine.status, "waiting");
  assert.equal(stateLine.questions.length, 1);

  // Open-ended waiting marker (no options) also sets status: waiting and waitingForReply cleanly.
  fs.writeFileSync(sayFile, 'I need the staging API key to run this.\n\n<!-- penecho: waiting="Need staging API key" -->');
  const openLine = await service.request(project, { text:"Verify staging webhook", topic:"new", agent:"fake" });
  await settle();
  const openDoc = F.parseLine(service.readDoc(project, openLine.slug));
  assert.equal(openDoc.status, "waiting");
  assert.equal(openDoc.front.why, "Need staging API key");
  assert.equal(openDoc.steps.find(s => s.id === "work-1")?.done, false);
  assert.equal(service.stateOf(project).lines.find(l => l.id === openLine.slug).waitingForReply, true);
});

test("a follow-up Work on a Line with a Canvas prototype is told its file and editing it updates the Canvas picture", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-shown-canvas-")), script = path.join(dir, "agent.cjs"), promptFile = path.join(dir, "prompt.txt");
  const pngA = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const pngB = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  fs.writeFileSync(script, `
const fs=require('fs'),path=require('path'),readline=require('readline'),out=o=>console.log(JSON.stringify(o));
readline.createInterface({input:process.stdin}).once('line',line=>{
  let text=line;
  try{const msg=JSON.parse(line);text=msg?.message?.content?.map?.(c=>c.text||'').join('')||line;}catch{}
  fs.writeFileSync(process.argv[2],text);
  const m=text.match(/Project docs: ([^\\n]+?)\\.?$/m);
  const s=text.match(/Canvas shows ([^\\s,]+\\.explorer\\.html)/);
  if(m&&s){
    const target=path.join(m[1].trim(),s[1].trim());
    fs.writeFileSync(target,'<!doctype html><html data-penecho-prototype><body style="background:blue">updated</body></html>');
  }
  out({type:'system',subtype:'init',session_id:'s-'+Date.now(),model:'m'});
  out({type:'assistant',message:{id:'a1',model:'m',usage:{input_tokens:10,output_tokens:10},content:[{type:'text',text:'Updated background and prototype.'}]}});
  out({type:'result',session_id:'s',is_error:false,result:'Updated background and prototype.'});
  process.exit(0);
});`);
  const agents = { available:() => [{ id:"fake", name:"Fake", available:true }], nameOf:() => "Fake", desktop:() => null, terminal:() => "",
    command:(_agent, { workdir }) => ({ command:process.execPath, args:[script, promptFile], cwd:workdir, stdin:true, input:"stream-json", ownInstructions:true }) };
  let renderCalls = 0;
  const service = new Service({ directory:path.join(dir, "state"), agents, autoWatch:false, memory:{ home:dir, env:{} }, conversations:{ home:dir, env:{} },
    renderPage:async html => { renderCalls++; return html.includes("background:blue") ? pngB : pngA; } });
  const project = service.store.create({ name:"Canvas update test", docsPath:path.join(dir, "docs") }); project.defaultAgent = "fake";
  t.after(() => { service.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  const settle = async () => { const start = Date.now(); while (service.runs.size || service.finishing.size) { if (Date.now() - start > 6000) throw Error("run timeout"); await new Promise(r => setTimeout(r, 20)); } };

  const { slug } = await service.request(project, { text:"Build dark mode", topic:"new", agent:"fake" });
  await settle();
  const relHtml = `files/${slug}/dark-mode.explorer.html`;
  service.store.writeBytes(project, relHtml, Buffer.from('<!doctype html><html data-penecho-prototype><body style="background:black">initial</body></html>'));
  await service.makePictures(project);
  const pngPath = service.store.resolve(project, `files/${slug}/dark-mode.png`);
  assert.deepEqual(fs.readFileSync(pngPath), pngA, "initial prototype picture rendered");
  assert.equal(renderCalls, 1);

  await service.request(project, { text:"Change the background to blue", topic:slug, agent:"fake" });
  await settle();
  const seenPrompt = fs.readFileSync(promptFile, "utf8");
  assert.match(seenPrompt, new RegExp(`This Line's Canvas shows files/${slug}/dark-mode\\.explorer\\.html\\. If the request changes what that shows, update that file too \\(in Project docs\\)`));
  await service.makePictures(project);
  assert.equal(renderCalls, 2, "edited prototype triggered a fresh Canvas render");
  assert.deepEqual(fs.readFileSync(pngPath), pngB, "Canvas picture updated to the blue version");
});
