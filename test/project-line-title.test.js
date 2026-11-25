"use strict";
require("./helpers/safety.js");
// While a line has no name of its own, the agent names it inside its reply; PenEcho takes that comment out of the result and keeps the
// title. Nothing else is asked of the agent or read from its words: Topics say what a line is about.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const F = require("../src/server/project-lines/format.js");
const { Service, buildPrompt, buildInstructions, followUpPrompt } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-title-test-"));
test.after(() => fs.rmSync(temp, { recursive:true, force:true }));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 8000) {
  const start = Date.now();
  for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); }
}
// A stand-in agent that answers like Claude Code and ends its reply with the comment, as the prompt asks. Like an older agent, it adds tags too.
const agentScript = path.join(temp, "agent.js"), promptLog = path.join(temp, "prompt.txt");
fs.writeFileSync(agentScript, `
const fs = require("fs");
const say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  fs.writeFileSync(${JSON.stringify(promptLog)}, prompt);
  const title = /title="/.test(prompt) ? ' title="Kitchen tap fixed with a new washer"' : "";
  const text = "Fixed the tap.\\n\\nIt no longer drips.\\n\\n<!-- penecho:" + title + ' tags="kitchen tap, washer" -->';
  say({ type:"system", subtype:"init", session_id:"s-1" });
  say({ type:"assistant", message:{ content:[{ type:"text", text }] } });
  say({ type:"result", subtype:"success", is_error:false, result:text, session_id:"s-1" });
  process.exit(0);
});
`);
const agents = () => createAgents({ env:{ PATH:"" }, extra:{ fake:{ name:"Fake", mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }) } } });
let counter = 0;
function setup(t) {
  const directory = path.join(temp, `state-${++counter}`);
  fs.mkdirSync(directory, { recursive:true });
  const service = new Service({ directory, agents:agents(), autoWatch:false });
  const project = service.store.create({ name:"Home", docsPath:path.join(temp, `docs-${counter}`) });
  project.defaultAgent = "fake";
  const line = slug => service.stateOf(project).lines.find(l => l.id === slug);
  t.after(() => service.close());
  return { service, project, line };
}
const done = (service, project, slug) => until(() => !service.runs.size && ["done", "ready"].includes(F.parseLine(service.readDoc(project, slug)).status), "the Work to end");

test("a prompt ends with the sentence asking for a title only while the line has none, and never asks for tags", () => {
  const ctx = { project:"Home", docs:"/tmp/docs", slug:"tap", topicPath:"topics/tap.md", detailPath:"topics/tap/work-1.md", words:"Fix the tap", files:[], said:[], code:false };
  const step = { kind:"work" };
  for (const [name, make] of [["buildPrompt", c => buildPrompt(c, step)], ["buildInstructions", c => buildInstructions(c, step)], ["followUpPrompt", c => followUpPrompt({ ...c, said:["And the shower"] }, step)]]) {
    const titled = make({ ...ctx, askTitle:true }), plain = make({ ...ctx, askTitle:false });
    assert.ok(titled.trimEnd().endsWith(F.metaAsk({ title:true })), `${name} ends with the sentence`);
    assert.match(titled, /<!-- penecho: title="…" -->/, name);
    assert.doesNotMatch(plain, /penecho:\s*title|title="…"/, `${name}: nothing asked of a line that has a name`);
    for (const text of [titled, plain]) assert.doesNotMatch(text, /tags=|concepts/, name);
  }
  assert.equal(F.metaAsk({ title:false }), "");
  // An agent that keeps instructions of its own shows the person's words in its app, and only those.
  assert.equal(followUpPrompt({ ...ctx, said:["And the shower"], askTitle:true }, step, { plainWords:true }), "And the shower");
  assert.ok(F.metaAsk({ title:true }).length < 200, "one short sentence");
});

test("a line has no title of its own while it is called by its first words, a picture or a number", () => {
  const doc = title => F.parseLine(`---\nstatus: working\n---\n\n# ${title}\n\n## Ask · 2026-11-12 09:00\n\nThe kitchen tap drips. Please fix it.\n`);
  assert.equal(F.wantsTitle(doc(F.titleFromText("The kitchen tap drips. Please fix it."))), true);
  assert.equal(F.wantsTitle(doc("12")), true);
  assert.equal(F.wantsTitle(doc("Picture · Nov 12")), true);
  assert.equal(F.wantsTitle(doc("Plumbing")), false);
  assert.equal(F.wantsTitle(F.parseLine(`---\nstatus: working\ntitle by: codex\n---\n\n# 12\n`)), false);
});

test("the comment is taken out of the result: the title goes on the line, tags an agent still sends are dropped", async t => {
  const { service, project, line } = setup(t);
  const { slug } = await service.createTopic(project, { text:"The kitchen tap drips. Please fix it.", kinds:["ask", "work"] });
  await done(service, project, slug);
  assert.match(fs.readFileSync(promptLog, "utf8"), /title="…"/, "a new line is asked for a title");
  const md = service.readDoc(project, slug), doc = F.parseLine(md);
  assert.equal(doc.title, "Kitchen tap fixed with a new washer");
  assert.equal(doc.front["title by"], "fake");
  assert.doesNotMatch(md, /penecho:/, "nothing of the comment in the line's file");
  const detail = service.store.readText(project, F.detailPath(slug, "work-1")).text;
  assert.equal(F.splitFront(detail).front.tags, undefined, "no tags in the Work's detail file");
  assert.doesNotMatch(F.sectionText(detail, "Result"), /penecho:/);
  const l = line(slug);
  assert.equal(l.tags, undefined);
  assert.equal(l.concepts, undefined);
  assert.ok(l.stations.every(s => s.tags === undefined && s.tagsBy === undefined));
  assert.doesNotMatch(l.result.text, /penecho:/);
  // The next request: the line has its title now, so the agent is asked nothing about it.
  await service.request(project, { text:"And the shower too.", kinds:["ask", "work"], topic:slug });
  await until(() => fs.readFileSync(promptLog, "utf8").includes("shower"), "the follow-up prompt");
  await done(service, project, slug);
  assert.doesNotMatch(fs.readFileSync(promptLog, "utf8"), /penecho: title|title="…"/);
  assert.equal(F.parseLine(service.readDoc(project, slug)).title, "Kitchen tap fixed with a new washer");
});

test("a name the person gave is never replaced by an agent's title", async t => {
  const { service, project } = setup(t);
  const { slug } = await service.createTopic(project, { text:"The kitchen tap drips. Please fix it.", kinds:["ask"], start:false, unsent:true });
  await service.act(project, slug, "rename", { title:"Plumbing", baseHash:service.store.readText(project, `topics/${slug}.md`).hash });
  assert.equal(F.parseLine(service.readDoc(project, slug)).front["title by"], "you");
  const step = F.parseLine(service.readDoc(project, slug)).steps.find(s => F.isUnsent(s));
  await service.act(project, slug, "run-unsent", { step:step.id, agent:"fake" });
  await done(service, project, slug);
  assert.doesNotMatch(fs.readFileSync(promptLog, "utf8"), /title="…"/, "not asked for a title");
  const doc = F.parseLine(service.readDoc(project, slug));
  assert.equal(doc.title, "Plumbing");
  assert.equal(doc.front["title by"], "you");
  // Even an agent that sends a title anyway does not change it.
  service.takeMeta(project, slug, { said:'Done.\n\n<!-- penecho: title="Something else entirely here" -->', agent:"fake" });
  assert.equal(F.parseLine(service.readDoc(project, slug)).title, "Plumbing");
});

test("takeMeta reads both quotes, leaves text with no comment alone, and hides any older comment that holds tags", () => {
  assert.deepEqual(F.takeMeta("Plain answer."), { text:"Plain answer.", title:"", requirement:"" });
  const got = F.takeMeta("Done.\n\n<!-- penecho: title=“画一个词云” tags=“词云，首页、日程” -->");
  assert.deepEqual(got, { text:"Done.", title:"画一个词云", requirement:"" });
  assert.deepEqual(F.takeMeta('Fixed.\n\n<!-- penecho: tags="a b" -->'), { text:"Fixed.", title:"", requirement:"" });
  assert.equal(F.summaryOf('Fixed.\n\n<!-- penecho: tags="a b" -->'), "Fixed.");
});

test("a title taken from first words skips injected blocks, a JSON object and a preamble, and such a line is still not named", () => {
  assert.equal(F.titleFromText('<artifact-view-context id="a1">{"canvas":"x","widgets":[1,2]}</artifact-view-context>\n\nMake the input box taller.'), "Make the input box taller");
  assert.equal(F.titleFromText('<cross-session-message from="s-2">\nSee the note above\n</cross-session-message>\nFix the merge button'), "Fix the merge button");
  assert.equal(F.titleFromText("Background (from the session that started this one):\n\nDeploy the cloud build tonight."), "Deploy the cloud build tonight");
  assert.equal(F.titleFromText('{"from":"meetcue","id":7}\nWrite the pricing page'), "Write the pricing page");
  assert.equal(F.titleFromText("<b>Bold</b> words are a person's own"), "<b>Bold</b> words are a person's own", "a tag a person typed is kept");
  // A line already called by such a block, or by the preamble, still takes an agent's title.
  const named = title => F.wantsTitle(F.parseLine(`---\nstatus: done\n---\n\n# ${title}\n\n## Ask · 2026-11-12 09:00\n\nSomething else entirely.\n`));
  assert.equal(named("<artifact-view-context id=a1>{…"), true);
  assert.equal(named("Background (from the session that started this one):"), true);
  assert.equal(named("Plumbing"), false);
});

test("PE-821: auto-generated titles use up to 120 chars and existing 56-char legacy titles expand in display while still wanting an agent title", () => {
  const ask = "I need a sub title of PenEcho Lines, pls submit all your sub agents to give one, and then give me the final.";
  const full = "I need a sub title of PenEcho Lines, pls submit all your sub agents to give one, and then give me the final";
  assert.equal(F.titleFromText(ask), full);

  // Titles beyond 120 chars still truncate cleanly at word boundaries, and long unbroken tokens do not collapse.
  const over120 = F.titleFromText("alpha ".repeat(30));
  assert.ok(over120.length > 100 && over120.length <= 120);
  assert.ok(over120.endsWith("…"));
  const unbroken = F.titleFromText(`a ${"x".repeat(150)}`);
  assert.ok(unbroken.length === 119 && unbroken.endsWith("…"));

  // Legacy 56-char auto-title without title by: expands via shownTitle and still wantsTitle.
  const legacyDoc = F.parseLine(`---\nstatus: working\n---\n\n# I need a sub title of PenEcho Lines, pls submit all…\n\n## Ask · 2026-11-20 15:33\n\n${ask}\n`);
  assert.equal(F.shownTitle(legacyDoc), full);
  assert.equal(F.wantsTitle(legacyDoc), true);

  // Explicit title by: is never expanded or replaced even if it ends with an ellipsis.
  const ownedDoc = F.parseLine(`---\nstatus: working\ntitle by: you\n---\n\n# I need a sub title of PenEcho Lines, pls submit all…\n\n## Ask · 2026-11-20 15:33\n\n${ask}\n`);
  assert.equal(F.shownTitle(ownedDoc), "I need a sub title of PenEcho Lines, pls submit all…");
  assert.equal(F.wantsTitle(ownedDoc), false);

  // Client optimistic helpers in state.js and composer.js match the 120-char limit.
  const vm = require("node:vm");
  const stateSrc = fs.readFileSync(path.join(__dirname, "../public/lines/state.js"), "utf8");
  const stateStart = stateSrc.indexOf("const titleFromText =");
  const stateFn = stateSrc.slice(stateStart, stateSrc.indexOf("\n};", stateStart) + 3);
  const clientTitleFromText = vm.runInNewContext(`${stateFn}; titleFromText`);
  assert.equal(clientTitleFromText(ask), full);

  const compSrc = fs.readFileSync(path.join(__dirname, "../public/lines/composer.js"), "utf8");
  const compStart = compSrc.indexOf("function guessTitle(");
  const compFn = compSrc.slice(compStart, compSrc.indexOf("\n}\n", compStart) + 3);
  const clientGuessTitle = vm.runInNewContext(`${compFn}; guessTitle`);
  assert.equal(clientGuessTitle(ask), full);
});
