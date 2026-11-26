"use strict";
require("./helpers/safety.js");
// R4, the computer's part: an Ask written on penecho.ai for a project that lives on this computer waits in the line's file, held for a
// computer; this computer fetches it with its sync round and runs it here (switch on, agent ready), and its result syncs back.
// A stand-in Cloud (fake-cloud-lines.js) plays penecho.ai: it holds the Ask, as Cloud's Run does, and drops holds, as its Stop does.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const CA = require("../src/server/project-lines/computer-asks.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { summaryOf } = require("../src/server/project-lines/summary.js");
const { fakeCloud, fakeConnector } = require("./fake-cloud-lines.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-computer-")));
const closing = [];
after(async () => { for (const close of closing.reverse()) await close(); fs.rmSync(temp, { recursive:true, force:true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 20000) { const start = Date.now(); for (;;) { const v = await check(); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(40); } }
// The agent: answers at once, or after 30 s when the Ask says "slow" (long enough to be stopped).
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  say({ type:"system", subtype:"init", session_id:"s-" + Date.now() });
  setTimeout(() => say({ type:"result", subtype:"success", is_error:false, result:"Done: " + (prompt.match(/rain chart|slow|tide table/) || ["it"])[0], session_id:"s" }), /slow/.test(prompt) ? 30000 : 10);
});
`);
const fakeAgent = name => ({ name, mono:name.slice(0, 2), color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }) });
// "app": an agent whose desktop app alone is here, so it is set up but cannot run an Ask in the background.
const appOnly = { name:"App only", mono:"Ap", color:"#000", role:"Build", resolve:() => ({ app:true }), command:() => null };
const agents = extra => createAgents({ env:{ PATH:"" }, extra:{ fake:fakeAgent("Fake"), app:appOnly, ...extra } });

let count = 0;
async function computer(cloud, { directory = null, local = true, name = "", extra = {} } = {}) {
  const n = ++count, dir = directory || path.join(temp, `state-${n}`), docsBase = path.join(temp, `computer-${n}`), connector = fakeConnector(cloud);
  fs.mkdirSync(dir, { recursive:true });
  if (name) fs.writeFileSync(path.join(dir, "computer.json"), JSON.stringify({ name }));
  const lines = createProjectLines({ cloud:() => connector, directory:dir, agents:agents(extra), serviceOptions:{ autoWatch:false, docsBase }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => local, computerRounds:0,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const close = async () => {
    if (!server.listening) return;
    lines.close();
    await new Promise(resolve => server.close(resolve));
  };
  closing.push(close);
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  const call = async (method, route, body) => { const res = await fetch(`${base}${route}`, { method, headers:body !== undefined ? { "content-type":"application/json" } : {}, ...(body !== undefined ? { body:JSON.stringify(body) } : {}) }); const json = await res.json().catch(() => ({})); return { status:res.status, ...json }; };
  const write = (p, rel, text) => { fs.mkdirSync(path.dirname(path.join(p.docsPath, rel)), { recursive:true }); fs.writeFileSync(path.join(p.docsPath, rel), text); };
  const read = (p, rel) => fs.readFileSync(path.join(p.docsPath, rel), "utf8");
  return { lines, close, service:lines.service, share:lines.cloudShare, me:lines.computer, call, write, read, dir, docsBase, connector };
}
const unsentLine = (title, words) => `---\nid: T-1\nstatus: waiting\nwhy: Not sent\n---\n\n# ${title}\n\n## Ask · 2026-11-13 10:20 · Not sent\n\n${words}\n`;
// A project made on computer `a`, kept in Cloud, with one line holding one Ask Not sent.
async function syncedProject(a, cloud, { slug = "rain", words = "Add a rain chart." } = {}) {
  const p = a.service.store.create({ name:`Garden ${++count}`, docsPath:path.join(a.docsBase, `garden-${count}`) });
  p.defaultAgent = "fake";
  a.write(p, `lines/${slug}.md`, unsentLine("Rain", words));
  const on = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  assert.equal(on.status, 200, on.error);
  assert.ok(cloud.text(p.id, `topics/${slug}.md`), "the line is in Cloud");
  return p;
}
const cloudLine = (cloud, p, slug = "rain") => F.parseLine(cloud.text(p.id, `topics/${slug}.md`));
const works = doc => doc.steps.filter(s => s.kind === "work");

test("the computer says who it is: an id made once and kept, its name, its agents, and the switch, off until turned on here", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { name:"Studio Mac" });
  const first = await a.call("GET", "/computer");
  assert.equal(first.status, 200);
  assert.match(first.id, CA.COMPUTER_ID);
  assert.equal(first.name, "Studio Mac");
  assert.equal(first.runsAsks, false, "off by default");
  assert.deepEqual(first.agents.find(x => x.id === "fake"), { id:"fake", name:"Fake", ready:true });
  assert.deepEqual(first.agents.find(x => x.id === "app"), { id:"app", name:"App only", ready:false }, "set up, but cannot run in the background");
  assert.equal(first.agents.some(x => x.id === "claude"), false, "an agent not set up is not listed");
  // Kept in PenEcho's own state, never in a project folder; the same id after a restart.
  const saved = JSON.parse(fs.readFileSync(path.join(a.dir, "computer.json"), "utf8"));
  assert.equal(saved.id, first.id);
  await a.close();
  // The switch and the name change only from this computer.
  const away = await computer(cloud, { directory:a.dir, local:false });
  const refused = await away.call("POST", "/computer", { runsAsks:true });
  assert.equal(refused.status, 403);
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.dir, "computer.json"), "utf8")).runsAsks, false);
  await away.close();
  const again = await computer(cloud, { directory:a.dir });
  assert.equal((await again.call("GET", "/computer")).id, first.id);
  const on = await again.call("POST", "/computer", { runsAsks:true, name:"  Kitchen   laptop " });
  assert.equal(on.status, 200);
  assert.deepEqual([on.runsAsks, on.name], [true, "Kitchen   laptop"]);
  assert.equal((await again.call("POST", "/computer", { runsAsks:"yes" })).status, 400);
  assert.equal((await again.call("POST", "/computer", { name:"  " })).status, 400);
});

test("an Ask held on penecho.ai for this computer runs here with the agent named, and its Work is back in Cloud", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = await syncedProject(a, cloud);
  a.me.set({ runsAsks:true });
  const held = cloud.holdAsk(p.id, "rain", { agent:"fake", computer:a.me.id() });
  assert.equal(cloudLine(cloud, p).front.why, CA.WAITING);
  const answer = await a.me.round();
  assert.deepEqual(answer.projects.map(x => [x.key, x.changed]), [[p.id, true]], "Cloud says the project changed");
  const done = await until(() => { const doc = cloudLine(cloud, p); return works(doc).some(w => w.done) && doc; }, "the Work in Cloud");
  assert.equal(works(done)[0].who, "fake");
  // The Work's detail file went up too, the same as here.
  await until(() => cloud.text(p.id, "topics/rain/work-1.md") === a.read(p, "works/rain/work-1.md"), "the Work's detail in Cloud");
  assert.match(cloud.text(p.id, "topics/rain/work-1.md"), /^who: "@fake"$/m);
  const ask = done.steps.find(s => s.kind === "ask");
  assert.equal(F.isUnsent(ask), false, "sent");
  assert.equal(ask.held, null, "no longer held");
  assert.equal(held.held.agent, "fake");
  // The computer told Cloud who it is.
  const seen = cloud.computers.get(a.me.id());
  assert.equal(seen.runsAsks, true);
  assert.ok(seen.agents.some(x => x.id === "fake" && x.ready));
  // Its saved agents go too (penecho.ai shows them read-only), and nothing like a key.
  assert.ok(Array.isArray(seen.presets) && seen.presets.some(x => x.agent === "fake" && x.name), "saved agents in the round");
  assert.ok(seen.presets.every(x => Object.keys(x).every(k => ["id", "name", "agent", "model", "effort", "default"].includes(k))), "only names, runners, models and efforts");
  // The summary it uploads carries the new fields, and the line's hold in Cloud was given back.
  const line = cloud.projects.get(p.id).summary.lines.find(l => l.path === "lines/rain.md");
  assert.equal(line.agent, "fake");
  assert.ok(line.updatedAt > 0);
  assert.equal(line.lastWork.agent, "fake");
  assert.ok(line.lastWork.endedAt >= line.lastWork.startedAt && line.lastWork.startedAt > 0);
  assert.deepEqual([line.lastWork.canvases, line.lastWork.files, line.lastWork.picture], [0, 0, null]);
  assert.equal(line.held, undefined);
  await until(() => cloud.runs.size === 0, "the hold given back");
});

test("PE-582: Cloud reviews and requested tasks merge with local edits, and each task runs once", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = await syncedProject(a, cloud);
  a.me.set({ runsAsks:true });
  cloud.holdAsk(p.id, "rain", { agent:"fake", computer:a.me.id() });
  await a.me.round();
  await until(() => works(cloudLine(cloud, p)).some(w => w.done) && cloud.text(p.id, "topics/rain/work-1.md"), "first result in Cloud");
  await until(() => !a.service.runs.size, "first run closed");
  await a.share.syncNow(p);

  const rel = "topics/rain/work-1.md", reviewed = "2026-11-18 07:42";
  cloud.edit(p.id, rel, F.setFront(cloud.text(p.id, rel), { reviewed }));
  a.write(p, "works/rain/work-1.md", F.setSection(a.read(p, "works/rain/work-1.md"), "Changes", "Local result evidence."));
  const nextAsk = "\n\n## Ask · 2026-11-18 07:43 · Not sent\n\nAdd a tide table.\n";
  cloud.edit(p.id, "topics/rain.md", F.setFront(cloud.text(p.id, "topics/rain.md") + nextAsk, { status:"waiting", why:"Not sent" }));
  a.write(p, "lines/rain.md", a.read(p, "lines/rain.md") + "\n\n## Note · 2026-11-18 07:44\n\nKeep the local note.\n");
  await a.me.round();
  assert.equal(works(F.parseLine(a.read(p, "lines/rain.md"))).length, 1, "syncing a new Ask alone never starts it");
  for (const text of [a.read(p, "works/rain/work-1.md"), cloud.text(p.id, rel)]) {
    assert.equal(F.splitFront(text).front.reviewed, reviewed);
    assert.match(text, /Local result evidence\./);
  }
  assert.match(a.read(p, "lines/rain.md"), /Add a tide table\./);
  assert.match(cloud.text(p.id, "topics/rain.md"), /Keep the local note\./);

  // Only the explicit Run from Cloud authorizes this second Work.
  cloud.holdAsk(p.id, "rain", { agent:"fake", computer:a.me.id() });
  await a.me.round();
  await until(() => works(cloudLine(cloud, p)).filter(w => w.done).length === 2 && cloud.text(p.id, "topics/rain/work-2.md"), "second result in Cloud");
  await until(() => !a.service.runs.size, "second run closed");
  for (let i = 0; i < 2; i++) await a.me.round();
  for (const text of [a.read(p, "lines/rain.md"), cloud.text(p.id, "topics/rain.md")]) {
    assert.equal(works(F.parseLine(text)).length, 2, "repeated rounds do not run the task twice");
    assert.match(text, /Keep the local note\./);
  }
  assert.equal(F.splitFront(cloud.text(p.id, rel)).front.reviewed, reviewed, "earlier review survives the new task");
  assert.equal(F.splitFront(cloud.text(p.id, "topics/rain/work-2.md")).front.reviewed, undefined, "new work still needs review");
});

test("switch off, agent not ready, another computer named: the Ask waits, and Cloud has what it needs to say why", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = await syncedProject(a, cloud);
  // Switch off (as it starts).
  cloud.holdAsk(p.id, "rain", { agent:"fake", computer:a.me.id() });
  await a.me.round();
  await wait(300);
  assert.equal(works(cloudLine(cloud, p)).length, 0);
  assert.equal(cloudLine(cloud, p).steps[0].held.reason, "computer", "still held in Cloud");
  assert.equal(F.parseLine(a.read(p, "lines/rain.md")).steps[0].held.computer, a.me.id(), "and here");
  assert.equal(cloud.computers.get(a.me.id()).runsAsks, false, "Cloud knows the switch is off");
  // The summary says the line holds an Ask for a computer.
  await a.share.syncNow(p);
  // Agent not ready here: set up as an app only, or not set up at all.
  a.me.set({ runsAsks:true });
  for (const agent of ["app", "claude"]) {
    cloud.stop(p.id, "rain");
    cloud.holdAsk(p.id, "rain", { agent, computer:a.me.id() });
    await a.me.round();
    await wait(300);
    assert.equal(works(cloudLine(cloud, p)).length, 0, `${agent} does not run here`);
    const report = cloud.computers.get(a.me.id()).agents;
    assert.equal(report.some(x => x.id === agent && x.ready), false);
  }
  // Another computer named.
  cloud.stop(p.id, "rain");
  cloud.holdAsk(p.id, "rain", { agent:"fake", computer:"0b6f3c1e-1111-2222-3333-444455556666" });
  await a.me.round();
  await wait(300);
  assert.equal(works(cloudLine(cloud, p)).length, 0, "only the named computer runs it");
  assert.equal(cloud.runs.size, 0, "this computer never took the line");
  // What this computer uploads with its next commit says the line holds an Ask for a computer.
  const summary = summaryOf(a.service, p).lines.find(l => l.path === "lines/rain.md");
  assert.deepEqual(summary.held, { reason:"computer", agent:"fake", computer:"0b6f3c1e-1111-2222-3333-444455556666" });
  assert.equal(summary.status, "waiting");
});

test("a claimed Ask waits when its final sync fails or is stale, then honors completion elsewhere", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = await syncedProject(a, cloud);
  cloud.holdAsk(p.id, "rain", { agent:"fake", computer:a.me.id() });
  await a.me.round(); // Bring it here before turning on pickup.
  const sync = a.share.syncNow;
  a.share.syncNow = async () => { throw new Error("Gateway unavailable"); };
  a.me.set({ runsAsks:true });
  await a.me.round();
  assert.equal(a.service.runs.size, 0);
  assert.equal(cloud.runs.size, 0, "the failed check gives the line back");
  a.share.syncNow = async () => ({ stale:true });
  assert.equal(await a.me.runHeld(p), 0);
  assert.equal(cloud.runs.size, 0);
  const md = cloud.text(p.id, "topics/rain.md");
  cloud.edit(p.id, "topics/rain.md", F.setFront(F.finishUnsentAsk(md, "ask-1"), { status:"done", why:null }));
  a.share.syncNow = sync;
  assert.equal(await a.me.runHeld(p), 0);
  const doc = F.parseLine(a.read(p, "lines/rain.md"));
  assert.ok(F.isFinishedAsk(doc.steps[0]));
  assert.equal(works(doc).length, 0);
  assert.equal(cloud.runs.size, 0);
});

test("turning the switch on runs an Ask that was already waiting, without another change in Cloud", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = await syncedProject(a, cloud);
  cloud.holdAsk(p.id, "rain", { agent:"fake" });
  await a.me.round();
  assert.equal(works(cloudLine(cloud, p)).length, 0);
  a.me.set({ runsAsks:true });
  await until(() => works(cloudLine(cloud, p)).some(w => w.done), "the Work in Cloud");
});

test("two computers: one named runs it and the other does not; none named, exactly one runs it, once", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), b = await computer(cloud), p = await syncedProject(a, cloud);
  const copied = await b.call("POST", `/cloud/projects/${encodeURIComponent(p.id)}/copy`, {});
  assert.equal(copied.status, 200, copied.error);
  a.me.set({ runsAsks:true }); b.me.set({ runsAsks:true });
  await Promise.all([a.me.round(), b.me.round()]);
  // Named: b.
  cloud.holdAsk(p.id, "rain", { agent:"fake", computer:b.me.id() });
  await a.me.round();
  await wait(200);
  assert.equal(works(cloudLine(cloud, p)).length, 0, "a leaves it");
  await b.me.round();
  await until(() => works(cloudLine(cloud, p)).some(w => w.done), "b's Work in Cloud");
  // None named, both at once: the line's hold decides, and the Ask runs once.
  a.write(a.service.store.projects.find(x => x.id === p.id), "lines/tide.md", unsentLine("Tide", "Make a tide table."));
  await a.share.syncNow(a.service.store.projects.find(x => x.id === p.id));
  cloud.holdAsk(p.id, "tide", { agent:"fake" });
  await Promise.all([a.me.round(), b.me.round()]);
  const done = await until(() => { const doc = cloudLine(cloud, p, "tide"); return works(doc).some(w => w.done) && doc; }, "the tide Work");
  await wait(800);
  await Promise.all([a.me.round(), b.me.round()]);
  await wait(800);
  const final = cloudLine(cloud, p, "tide");
  assert.equal(works(final).length, 1, `one Work, not two: ${cloud.text(p.id, "topics/tide.md")}`);
  assert.equal(final.steps.filter(s => s.kind === "ask").length, 1);
  assert.ok(done);
});

test("Stop on penecho.ai drops the hold: the run here stops at the next round and the stopped Work goes back", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = await syncedProject(a, cloud, { words:"Take it slow." });
  a.me.set({ runsAsks:true });
  cloud.holdAsk(p.id, "rain", { agent:"fake", computer:a.me.id() });
  await a.me.round();
  await until(() => a.service.runs.has(a.service.key(p, "rain")) && cloud.runs.size === 1, "the run here, holding the line");
  await until(() => /status: working/.test(cloud.text(p.id, "topics/rain.md")), "Cloud shows it working");
  // Stop on penecho.ai: no Ask is waiting any more, and the line's hold is gone.
  assert.equal(cloud.stop(p.id, "rain"), 0);
  await a.me.round();
  await until(() => !a.service.runs.has(a.service.key(p, "rain")), "the run stopped");
  const doc = await until(() => { const d = cloudLine(cloud, p); return works(d).some(w => w.off === "stopped") && d; }, "the stopped Work in Cloud");
  assert.equal(works(doc)[0].off, "stopped");
  // A held Ask that has not started yet: Stop takes the hold off, and it never starts.
  cloud.edit(p.id, "topics/rain.md", `${cloud.text(p.id, "topics/rain.md").trimEnd()}\n\n## Ask · 2026-11-13 11:00 · Not sent\n\nAnother rain chart.\n`);
  await a.me.round();
  a.me.set({ runsAsks:false });
  cloud.holdAsk(p.id, "rain", { agent:"fake", computer:a.me.id() });
  await a.me.round();
  assert.equal(cloud.stop(p.id, "rain"), 1);
  a.me.set({ runsAsks:true });
  await a.me.round();
  await wait(400);
  const after = cloudLine(cloud, p);
  assert.equal(works(after).length, 1, "nothing new ran");
  assert.equal(after.front.why, F.NOT_SENT);
  assert.equal(after.steps.filter(F.isUnsent).length, 1);
});

test("a round with nothing changed is one request; an older Cloud without the round is asked again only later", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = await syncedProject(a, cloud);
  await a.me.round();
  await a.me.round();
  const before = cloud.requests.length;
  const answer = await a.me.round();
  assert.deepEqual(cloud.requests.slice(before).map(r => `${r.method} ${r.path}`), ["POST /api/v1/device-sync/computer"]);
  assert.deepEqual(answer.projects, [{ key:p.id, rev:cloud.projects.get(p.id).rev, changed:false }]);
  // Signed out, or no project kept in Cloud: no request at all.
  a.connector.signedIn = false;
  const quiet = cloud.requests.length;
  assert.equal(await a.me.round(), null);
  assert.equal(cloud.requests.length, quiet);
  a.connector.signedIn = true;
  // A Cloud from before R4.
  cloud.noComputerRoute = true;
  await a.me.round();
  const later = cloud.requests.length;
  await a.me.round();
  assert.equal(cloud.requests.length, later, "not asked again at once");
  assert.equal(a.me.view().round.ok, false);
});

test("the shared hold text: Run holds the Ask, Retry holds a stopped Work's Asks, Stop takes the hold off; bad agents are refused", () => {
  const md = unsentLine("Rain", "Add a rain chart.");
  const held = CA.holdUnsentText(md, { agent:"claude", computer:"0b6f3c1e-1111-2222-3333-444455556666" });
  const doc = F.parseLine(held.md);
  assert.deepEqual(doc.steps[0].held, { reason:"computer", agent:"claude", computer:"0b6f3c1e-1111-2222-3333-444455556666" });
  assert.equal(doc.front.status, "waiting");
  assert.equal(doc.front.why, "Waiting for your computer");
  assert.match(held.md, /^> Held · computer · agent claude · computer 0b6f3c1e-1111-2222-3333-444455556666$/m);
  assert.equal(CA.holdUnsentText(md, {}).held.agent, "penecho", "PenEcho when the page names none and the line has no agent");
  assert.throws(() => CA.holdUnsentText(md, { agent:"rm -rf /" }), /Choose an agent/);
  assert.throws(() => CA.holdUnsentText(md, { agent:"kimi", agents:["claude"], where:"Studio Mac" }), /not set up on Studio Mac/);
  assert.throws(() => CA.holdUnsentText(md, { agent:"claude", computer:"../../x" }), /not one of your computers/);
  // A saved agent chosen on penecho.ai goes with the hold, by its id; anything else is refused.
  const saved = CA.holdUnsentText(md, { agent:"claude", preset:"claude-opus-high" });
  assert.match(saved.md, /^> Held · computer · agent claude · preset claude-opus-high$/m);
  assert.deepEqual(CA.heldAsks(F.parseLine(saved.md)), [{ step:saved.step, agent:"claude", computer:"", preset:"claude-opus-high" }]);
  assert.throws(() => CA.holdUnsentText(md, { agent:"claude", preset:"a b/c" }), /saved agent/);
  const off = CA.unholdText(held.md);
  assert.equal(off.count, 1);
  assert.equal(F.parseLine(off.md).steps[0].held, null);
  assert.equal(F.parseLine(off.md).front.why, "Not sent");
  const stopped = "---\nid: T-2\nstatus: stopped\nwhy: It stopped.\n---\n\n# Tide\n\n## Ask · 2026-11-13 10:00\n\nMake a tide table.\n\n## [ ] Work 1 · @codex\n";
  const again = CA.holdRetryText(stopped, { started:() => true });
  const retried = F.parseLine(again.md);
  assert.equal(retried.steps.find(s => s.kind === "work").off, "stopped");
  assert.deepEqual(CA.heldAsks(retried), [{ step:again.step, agent:"codex", computer:"", preset:"" }], "the Work's own agent");
  assert.throws(() => CA.holdRetryText(md, {}), /nothing to try again/);
});

test("an Ask held with one of this computer's saved agents runs with that saved agent", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = await syncedProject(a, cloud);
  a.me.set({ runsAsks:true });
  await a.me.round();
  const preset = cloud.computers.get(a.me.id()).presets.find(x => x.agent === "fake");
  assert.ok(preset, "the computer sent its saved agents");
  const picked = [];
  const run = a.service.runUnsent.bind(a.service);
  a.service.runUnsent = (project, slug, options) => { picked.push(options.preset); return run(project, slug, options); };
  cloud.holdAsk(p.id, "rain", { agent:"fake", computer:a.me.id(), preset:preset.id });
  await a.me.round();
  await until(() => works(cloudLine(cloud, p)).some(w => w.done), "the Work in Cloud");
  assert.deepEqual(picked, [preset.id]);
});

test("PE-911: a Cloud-held Ask runs with the nondefault runner and its selected model and effort", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const launches = [], alternate = fakeAgent("Alternate");
  const a = await computer(cloud, { extra:{ alternate:{ ...alternate, command(launch, options) {
    launches.push({ model:options.model, effort:options.effort });
    return alternate.command(launch, options);
  } } } });
  a.service.presets.add({ agent:"fake", model:"default-model", effort:"low", default:true });
  const preset = a.service.presets.add({ agent:"alternate", model:"gemini-4-neon", effort:"high" });
  const p = await syncedProject(a, cloud);
  a.me.set({ runsAsks:true });
  await a.me.round();
  assert.ok(cloud.computers.get(a.me.id()).presets.some(item => item.id === preset.id && item.agent === "alternate"));
  cloud.holdAsk(p.id, "rain", { agent:"alternate", computer:a.me.id(), preset:preset.id });
  await a.me.round();
  const work = await until(() => works(cloudLine(cloud, p)).find(item => item.done), "the nondefault Work in Cloud");
  assert.equal(work.who, "alternate");
  assert.deepEqual(launches, [{ model:"gemini-4-neon", effort:"high" }]);
});

// PE-1134: the answer is recorded in Cloud (penecho_cloud planAnswer): what was decided, the question closed, and its Ask held for the
// agent that asked, with the Work it carries on.
function answerOnCloud(cloud, p, slug, { text, answer, held }) {
  const rel = `topics/${slug}.md`, work = `topics/${slug}/work-1.md`, doc = F.parseLine(cloud.text(p.id, rel));
  cloud.edit(p.id, work, F.setDetailQuestions(cloud.text(p.id, work), []));
  let md = F.setAbove(cloud.text(p.id, rel), F.DECIDED, [...doc.decided, { text, answer }].map(d => `- ${d.text} **${d.answer}**`).join("\n"));
  md = F.updateSteps(md, steps => { steps.find(s => s.id === "work-1").done = true; steps.push(F.askStep({ words:`${text}: ${answer}`, via:F.NOT_SENT })); });
  md = CA.holdUnsentText(md, held).md;
  md = F.updateSteps(md, steps => { const ask = steps.find(F.isUnsent); ask.body = [F.withoutHeld(ask.body), F.heldLine({ ...F.parseLine(md).steps.find(F.isUnsent).held, reply:"work-1" })].join("\n\n"); });
  cloud.edit(p.id, rel, md);
}
test("PE-1134: an answer given on penecho.ai carries on the Work that asked, here, as answering it here does", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const launches = [], asking = path.join(temp, "asking.js");
  fs.writeFileSync(asking, `
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  const result = /Make it live\\?: Yes, merge it/.test(prompt) ? "It is live." : 'Built.\\n\\n<!-- penecho: ask="Make it live? | Yes, merge it | No" -->';
  console.log(JSON.stringify({ type:"system", subtype:"init", session_id:"s-asking" }));
  console.log(JSON.stringify({ type:"assistant", message:{ content:[{ type:"text", text:result }] } }));
  console.log(JSON.stringify({ type:"result", subtype:"success", is_error:false, result, session_id:"s-asking" }));
});`);
  const a = await computer(cloud, { extra:{ asker:{ ...fakeAgent("Asker"), resolve:() => ({ command:process.execPath, prefixArgs:[asking] }), command(launch, options) {
    launches.push({ model:options.model, effort:options.effort });
    return { command:launch.command, args:launch.prefixArgs, cwd:options.workdir, stdin:true };
  } } } });
  a.service.presets.add({ agent:"fake", model:"default-model", effort:"low", default:true });
  const preset = a.service.presets.add({ agent:"asker", model:"opus", effort:"xhigh" });
  const p = await syncedProject(a, cloud);
  a.me.set({ runsAsks:true });
  await a.me.round();
  cloud.holdAsk(p.id, "rain", { agent:"asker", computer:a.me.id(), preset:preset.id });
  await a.me.round();
  const open = await until(() => { const l = a.service.stateOf(p).lines.find(x => x.slug === "rain"); return l?.questions?.length && !l.running && l; }, "the question");
  assert.deepEqual([open.status, open.questions[0].text, open.questions[0].workId], ["waiting", "Make it live?", "work-1"]);
  await until(() => /Make it live/.test(cloud.text(p.id, "topics/rain/work-1.md") || "") && !cloud.runs.size, "the question in Cloud");
  answerOnCloud(cloud, p, "rain", { text:"Make it live?", answer:"Yes, merge it", held:{ agent:"asker", computer:a.me.id(), preset:preset.id } });
  await a.me.round();
  const done = await until(() => { const doc = cloudLine(cloud, p); return works(doc).length === 2 && works(doc)[1].done && doc.status === "done" && doc; }, "the Work that carried on, in Cloud");
  assert.deepEqual(works(done).map(w => [w.who, w.done, w.off || "", w.replaces]), [["asker", true, "", ""], ["asker", true, "", "work-1"]], "nothing failed, and the second carries the first on");
  assert.deepEqual(done.decided, [{ text:"Make it live?", answer:"Yes, merge it" }]);
  assert.deepEqual(done.steps.filter(s => s.kind === "ask").map(s => [s.text, F.isUnsent(s), s.held]), [["Add a rain chart.", false, null], ["Make it live?: Yes, merge it", false, null]]);
  assert.deepEqual(launches, [{ model:"opus", effort:"xhigh" }, { model:"opus", effort:"xhigh" }], "the same model and effort");
  assert.match(cloud.text(p.id, "topics/rain/work-2.md"), /It is live\./);
  assert.match(a.read(p, "works/rain/work-2.md"), /> Add a rain chart\.[\s\S]*> Make it live\?: Yes, merge it/, "with what was asked first");
  assert.equal(a.service.stateOf(p).lines.concat(a.service.stateOf(p).landed).find(l => l.slug === "rain").questions.length, 0);
});
test("PE-1134: a reply given on penecho.ai to a question with no options carries on the Work that waits", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const asking = path.join(temp, "asking-words.js");
  fs.writeFileSync(asking, `
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  const result = /Call it Cloudburst\\./.test(prompt) ? "It is called Cloudburst." : 'Built.\\n\\n<!-- penecho: waiting="What should it be called?" -->';
  console.log(JSON.stringify({ type:"system", subtype:"init", session_id:"s-words" }));
  console.log(JSON.stringify({ type:"assistant", message:{ content:[{ type:"text", text:result }] } }));
  console.log(JSON.stringify({ type:"result", subtype:"success", is_error:false, result, session_id:"s-words" }));
});`);
  const a = await computer(cloud, { extra:{ asker:{ ...fakeAgent("Asker"), resolve:() => ({ command:process.execPath, prefixArgs:[asking] }), command:(launch, options) => ({ command:launch.command, args:launch.prefixArgs, cwd:options.workdir, stdin:true }) } } });
  a.service.presets.add({ agent:"fake", model:"default-model", effort:"low", default:true });
  const preset = a.service.presets.add({ agent:"asker", model:"opus", effort:"xhigh" });
  const p = await syncedProject(a, cloud);
  a.me.set({ runsAsks:true });
  await a.me.round();
  cloud.holdAsk(p.id, "rain", { agent:"asker", computer:a.me.id(), preset:preset.id });
  await a.me.round();
  const open = await until(() => { const l = a.service.stateOf(p).lines.find(x => x.slug === "rain"); return l?.waitingForReply && !l.running && l; }, "the Work that waits");
  assert.equal(open.why, "What should it be called?");
  assert.deepEqual([open.questions.length, open.stations.filter(s => s.waitingReply).map(s => s.id)], [0, ["work-1"]], "what the pages draw the reply box from");
  await until(() => /What should it be called/.test(cloud.text(p.id, "topics/rain.md") || "") && !cloud.runs.size, "the question in Cloud");
  // What Cloud's planAnswer writes for a reply in words: the Work is done, and the words are the Ask held for this computer.
  let md = F.updateSteps(cloud.text(p.id, "topics/rain.md"), steps => { steps.find(s => s.id === "work-1").done = true; steps.push(F.askStep({ words:"Call it Cloudburst.", via:F.NOT_SENT })); });
  md = CA.holdUnsentText(F.setFront(md, { status:"waiting", why:F.NOT_SENT }), { agent:"asker", computer:a.me.id(), preset:preset.id }).md;
  md = F.updateSteps(md, steps => { const ask = steps.find(F.isUnsent); ask.body = [F.withoutHeld(ask.body), F.heldLine({ ...F.parseLine(md).steps.find(F.isUnsent).held, reply:"work-1" })].join("\n\n"); });
  cloud.edit(p.id, "topics/rain.md", md);
  await a.me.round();
  const done = await until(() => { const doc = cloudLine(cloud, p); return works(doc).length === 2 && works(doc)[1].done && doc.status === "done" && doc; }, "the Work that carried on, in Cloud");
  assert.deepEqual(works(done).map(w => [w.who, w.done, w.off || "", w.replaces]), [["asker", true, "", ""], ["asker", true, "", "work-1"]]);
  assert.match(cloud.text(p.id, "topics/rain/work-2.md"), /It is called Cloudburst\./);
  assert.equal(a.service.stateOf(p).lines.concat(a.service.stateOf(p).landed).find(l => l.slug === "rain").waitingForReply, false);
});
