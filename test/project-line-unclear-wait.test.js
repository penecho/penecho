"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const F = require("../src/server/project-lines/format.js");

function fakeAgents(root) {
  const script = path.join(root, "fake-agent.js");
  fs.writeFileSync(script, `let input = ""; process.stdin.on("data", d => { input += d; }); process.stdin.on("end", () => { console.log(JSON.stringify({ type:"result", is_error:false, result:"Done." })); process.exit(0); });`);
  const adapter = name => ({
    name, mono:name.slice(0, 2), color:"#2563eb", role:"Build",
    resolve:() => ({ command:process.execPath, prefixArgs:[script] }),
    command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }),
  });
  return createAgents({ env:{ PATH:"" }, extra:{ fake:adapter("Fake"), other:adapter("Other") } });
}

async function until(fn, label, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 25)); }
  throw new Error(`Timed out waiting for ${label}`);
}

// PE-922: finished Works each still ask a question and the new Ask names none of them. Send must not block with
// "Choose the waiting Work to reply to."; it starts a new Work. With one agent on the Line that agent may carry on its own
// session as usual; with several agents it starts fresh with the Line's context, so no agent's work is missed.
async function sendWithTwoWaiting(t, agents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-unclear-wait-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:50 }));
  const directory = path.join(root, "state"), docs = path.join(root, "docs"), code = path.join(root, "code");
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(code, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents(root), autoWatch:false });
  t.after(() => service.close());
  const project = service.store.create({ name:"Unclear", docsPath:docs, codePath:code });
  project.follow = false; service.store.save();

  const slug = "icons";
  service.writeDoc(project, slug, F.setFront(F.initialLine({
    title:"Icons", status:"waiting",
    steps:[
      ...agents.flatMap((who, i) => [F.askStep({ words:`Design ${i + 1}` }), { ...F.workStep({ who }), done:true, took:"1 min" }]),
      F.askStep({ words:"Use pic1 for home, pic2 for topics", via:F.NOT_SENT }),
    ],
  }), { who:"@fake", why:"Which set should go in?" }));
  const before = F.parseLine(service.readDoc(project, slug));
  const works = before.steps.filter(s => s.kind === "work");
  for (const w of works.slice(-2)) {
    service.store.writeText(project, F.detailPath(slug, w.id), `---\nwho: "@${w.who}"\n---\n\n# ${w.label}\n\n## Questions for you\n\n**Which set should go in?** (@${w.who})\n\n- [ ] A\n- [ ] B\n`);
  }
  assert.equal([...service.lineQuestionsState(project, slug, before).byStep.values()].filter(qs => qs.length).length, 2, "two Works hold an open question");

  await service.act(project, slug, "run-unsent", { step:before.steps.find(s => F.isUnsent(s)).id, agent:"fake" });

  const after = F.parseLine(service.readDoc(project, slug));
  assert.equal(after.steps.some(s => F.isUnsent(s)), false, "the Ask was sent");
  const all = after.steps.filter(s => s.kind === "work");
  assert.equal(all.length, agents.length + 1, "a new Work follows the Ask");
  assert.ok(all.slice(0, -1).every(s => s.done), "earlier Works are untouched");
  await until(() => F.parseLine(service.readDoc(project, slug)).steps.filter(s => s.kind === "work").every(s => s.done), "the new Work to finish");
  const ask = after.steps.find(s => s.kind === "ask" && /pic1 for home/.test(s.body));
  const front = F.splitFront(service.store.readText(project, F.detailPath(slug, all.at(-1).id)).text).front;
  return { ask, front };
}

test("Send with several Works of one agent waiting on questions starts a new Work, and the agent may keep its session", async t => {
  const { ask, front } = await sendWithTwoWaiting(t, ["fake", "fake"]);
  assert.equal(ask.taskMode, "", "nothing forces a fresh session");
  assert.notEqual(front["task why"], "Set on the Ask");
});

test("Send with Works of several agents waiting on questions starts a new Work in a fresh session with the Line's context", async t => {
  const { ask, front } = await sendWithTwoWaiting(t, ["fake", "other", "other"]);
  assert.equal(ask.taskMode, "new");
  assert.equal(front["task mode"], "new");
});
