"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const Knowledge = require("../src/server/project-lines/knowledge.js");
const Memory = require("../src/server/project-lines/memory.js");
const { Service } = require("../src/server/project-lines/service.js");

// Topics are hidden in every project until they are redesigned (PE-1066): keeping them cost agents too many tokens.
const TOPIC = "---\nrecord_type: topic\nid: topic-ab12\ntitle: Accounts\n---\n\n# Accounts\n\n**People sign in safely.**\n\n## Requirements\n\n### R1 · Sign in — 💡 Proposed\n\nPeople sign in with email.\n\n## Lines\n\n| Line | What it is | Requirements |\n| --- | --- | --- |\n";

test("Topics are hidden in every project: no Topic reaches the pages, the agents or the Topic files", async t => {
  assert.equal(Knowledge.TOPICS.hidden, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-topics-hidden-")), script = path.join(dir, "agent.cjs");
  // The agent names a requirement, as one would when Topics were on; what PenEcho tells it is kept.
  fs.writeFileSync(script, `
const fs=require('fs'),readline=require('readline'),out=o=>console.log(JSON.stringify(o));
readline.createInterface({input:process.stdin}).once('line',()=>{
 const text='Passwords now need 12 characters.\\n\\n<!-- penecho: requirement="done | Password rules | Passwords need at least 12 characters." -->';
 out({type:'system',subtype:'init',session_id:'s-'+Date.now(),model:'m'});
 out({type:'assistant',message:{id:'a1',model:'m',usage:{input_tokens:10,output_tokens:10},content:[{type:'text',text}]}});
 out({type:'result',session_id:'s',is_error:false,result:text});
 process.exit(0);
});`);
  const told = [];
  const agents = { available:() => [{ id:"fake", name:"Fake", available:true }], nameOf:() => "Fake", desktop:() => null, terminal:() => "",
    command:(_agent, { workdir, instructions }) => { told.push(instructions || ""); return { command:process.execPath, args:[script], cwd:workdir, stdin:true, input:"stream-json", ownInstructions:true }; } };
  const service = new Service({ directory:path.join(dir, "state"), agents, autoWatch:false, memory:{ home:dir, env:{} }, conversations:{ home:dir, env:{} } });
  const project = service.store.create({ name:"Hidden test", docsPath:path.join(dir, "docs") }); project.defaultAgent = "fake";
  t.after(() => { service.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  const settle = async () => { const start = Date.now(); while (service.runs.size) { if (Date.now() - start > 6000) throw Error("run timeout"); await new Promise(r => setTimeout(r, 20)); } };

  const { slug } = await service.request(project, { text:"Passwords need rules", topic:"new", agent:"fake" });
  await settle();
  const id = F.parseLine(service.readDoc(project, slug)).front.id;
  const topic = TOPIC.replace(/\n$/, `\n| [${id}](../lines/${slug}.md) | Passwords | R1 |\n`);
  service.store.writeText(project, "topics/accounts.md", topic);
  service.store.writeText(project, "understanding.md", "# Hidden test\n\n## Topics\n\n- [Accounts](topics/accounts.md)\n");
  await service.request(project, { text:"Use 12 characters at least.", topic:slug });
  await settle();

  // The agent is told to leave the Topics alone, and is never asked to name a requirement.
  const said = told.join("\n");
  assert.ok(said.includes(Knowledge.TOPICS_OFF), "the run hears that the project keeps no Topics");
  assert.doesNotMatch(said, /requirement=|PenEcho files it in the Line's Topic/);
  // PenEcho files no requirement in the Topic.
  assert.equal(service.store.readText(project, "topics/accounts.md").text, topic);

  // The pages get no Topics, no overview and no switch to turn them on.
  const state = service.stateOf(project);
  assert.equal(state.project.projectTopics, false);
  assert.equal(state.project.topicsHidden, true);
  assert.deepEqual(state.knowledge, []);
  assert.equal(state.understanding, false);

  // Nothing writes or rebuilds the Topics, from the pages or the orchestrator.
  await assert.rejects(service.buildTopics(project, { rebuild:true }), { code:"TOPICS_OFF" });
  await assert.rejects(service.mergeTopics(project, { into:"topics/accounts.md", from:"topics/accounts.md" }), { code:"TOPICS_OFF" });
  assert.throws(() => service.createTopicArea(project, { name:"Plants" }), { code:"TOPICS_OFF" });
  assert.equal(service.fileRequirement(project, slug, F.parseLine(service.readDoc(project, slug)), { id:"work-2", label:"Work 2" }, "done | Password rules | Twelve.", "Done."), false);

  // MEMORY.md does not send agents to topics/ or understanding.md.
  const memory = service.store.readText(project, "MEMORY.md").text;
  assert.match(memory, /search with `rg -n -i "word" lines`/);
  assert.doesNotMatch(memory, /topics\/|understanding\.md/);
});

test("a MEMORY.md written while Topics were shown loses its pointer to them, and keeps everything else", () => {
  const before = Memory.initialMemory("Garden", "GA").replace(Memory.knowledgeIntro("GA"), "Lines (`lines/<name>.md`) keep every Ask word for word; Work details are in `works/<name>/work-N.md`; `understanding.md` and the Topics in `topics/` say what is known about each subject. Read only what your work needs: search with `rg -n -i \"word\" lines topics\` rather than reading whole files. Find a Line by its id: `rg -l \"^id: GA-12$\" lines`. Archived Lines are in `archive/`, outside that search. PenEcho files requirements in the Topics; agents leave them alone unless asked.");
  assert.match(before, /PenEcho files requirements in the Topics/);
  const after = Memory.checkedMemory(before, "Garden", "GA");
  assert.equal(after, Memory.initialMemory("Garden", "GA"));
  assert.match(after, /rg -l "\^id: GA-12\$" lines/);
  assert.equal(Memory.checkedMemory(after, "Garden", "GA"), after, "a current one stays as it is");
});
