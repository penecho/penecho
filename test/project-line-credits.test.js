"use strict";
require("./helpers/safety.js");
// B5, local part: Lines' model calls to Cloud say they are Lines', and out of credits is a state: the Ask goes back to Not sent, saying why.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createPenEchoSource } = require("../src/server/agent-core/penecho-source.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-credits-")));
const closing = [];
after(async () => { for (const close of closing) await close(); fs.rmSync(temp, { recursive:true, force:true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 30000) { const start = Date.now(); for (;;) { const v = await check(); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(40); } }
const NO_CREDITS = { error:"insufficient_credits", message:"Not enough credits.", details:{ balance:3, reserved:0, required:40 } };
// A stand-in for Cloud's hosted model route (and for a model of the person's own): it remembers what it was sent and answers from a list.
function fakeModel(answers) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", d => { body += d; }).on("end", () => {
      seen.push({ url:req.url, headers:req.headers, body:JSON.parse(body || "{}") });
      const answer = answers[Math.min(seen.length - 1, answers.length - 1)];
      if (answer === 402) { res.writeHead(402, { "content-type":"application/json" }); return res.end(JSON.stringify(NO_CREDITS)); }
      const base = { id:"c", object:"chat.completion.chunk", created:1, model:"m" };
      res.writeHead(200, { "content-type":"text/event-stream" });
      res.end(`data: ${JSON.stringify({ ...base, choices:[{ index:0, delta:{ role:"assistant", content:answer }, finish_reason:null }] })}\n\ndata: ${JSON.stringify({ ...base, choices:[{ index:0, delta:{}, finish_reason:"stop" }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => { closing.push(() => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); })); resolve({ seen, url:`http://127.0.0.1:${server.address().port}/v1` }); }));
}
// This computer signed in to a Cloud whose hosted route is the fake model, with `credits` left.
function fakeCloud(url, credits) {
  const catalog = { models:[{ id:"11111111-1111-4111-8111-111111111111", name:"penecho fast", apiFormat:"openai", available:true }] };
  return { credits, hostedCatalog:catalog, status:() => ({ accountSession:{ signedIn:true } }), async refreshHostedCatalog() { return catalog; },
    async hostedModels() { return { models:catalog.models, credits:{ availableCredits:this.credits } }; },
    async prepareHostedConnection(id) { return { id, provider:"api", apiFormat:"openai", apiUrl:url, apiKey:"account-token", apiModel:id.slice(7), hosted:true }; } };
}
async function setup({ cloud = null, own = null } = {}) {
  const n = closing.length, directory = path.join(temp, `state-${n}`), docsBase = path.join(temp, `base-${n}`);
  fs.mkdirSync(directory, { recursive:true });
  const source = createPenEchoSource({ cloud:() => cloud, connections:() => own ? [{ id:"own", provider:"api", apiFormat:"openai", apiUrl:own, apiModel:"own-model", apiKey:"sk-own-0123456789" }] : [] });
  closing.push(() => source.close());
  await source.listening;
  const agents = createAgents({ env:{ ...process.env, PATH:process.env.PATH }, paths:{ penecho:source, stateDir:directory }, appFolders:[] });
  const lines = createProjectLines({ directory, agents, serviceOptions:{ autoWatch:false, docsBase }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closing.push(() => { server.close(); lines.close(); });
  const call = async (method, route, body) => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api/lines${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) }); return { status:res.status, ...await res.json() }; };
  const project = name => { const p = lines.service.store.create({ name, docsPath:path.join(docsBase, name) }); p.defaultAgent = "penecho"; return p; };
  return { source, service:lines.service, call, project };
}
const lineOf = (state, slug) => [...state.lines, ...state.landed, ...state.backlog].find(l => l.slug === slug);

test("built-in runs identify Lines to Cloud, retain its 402 and reject former personal models", async () => {
  const cloudModel = await fakeModel([402]), ownModel = await fakeModel(["fine"]);
  const cloud = fakeCloud(cloudModel.url, 100), { source } = await setup({ cloud, own:ownModel.url });
  const ask = async pick => {
    const run = source.open({ pick });
    const res = await fetch(`${run.url}/model/chat/completions`, { method:"POST", headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json" }, body:JSON.stringify({ model:"x", messages:[], stream:true }) });
    return { run, status:res.status, body:await res.text() };
  };
  const hosted = await ask("penecho fast");
  assert.equal(cloudModel.seen[0].headers["x-penecho-product"], "lines");
  assert.equal(hosted.status, 402);
  assert.deepEqual(JSON.parse(hosted.body), NO_CREDITS, "Cloud's answer comes back as it was");
  assert.deepEqual(source.refused(hosted.run.id), NO_CREDITS);
  const mine = await ask("own-model");
  assert.equal(mine.status, 409);
  assert.equal(ownModel.seen.length, 0);
  assert.equal(source.refused(mine.run.id), null);
});

test("with no credits left the run does not start: 402 with Cloud's body, and the Ask stays Not sent with its words", async () => {
  const cloudModel = await fakeModel(["never"]), { service, call, project } = await setup({ cloud:fakeCloud(cloudModel.url, 0) }), p = project("Broke");
  const asked = await call("POST", `/projects/${p.id}/topics`, { text:"Summarise the notes, please." });
  assert.equal(asked.status, 402);
  assert.deepEqual(asked, { status:402, error:"insufficient_credits", details:{ balance:0, reserved:0, required:1 } });
  assert.equal(cloudModel.seen.length, 0, "no model was called");
  const slug = service.store.scan(p).topics[0].slug, doc = F.parseLine(service.readDoc(p, slug)), ask = doc.steps.find(s => s.kind === "ask");
  assert.equal(F.isUnsent(ask), true);
  assert.equal(ask.text, "Summarise the notes, please.", "its words are intact");
  assert.deepEqual(ask.held, { reason:"credits", balance:0, required:1, agent:"penecho" });
  assert.equal(doc.steps.some(s => s.kind === "work"), false, "no Work was left behind");
  assert.deepEqual([doc.front.status, doc.front.why], ["waiting", "Out of credits"]);
  const station = lineOf(await call("GET", `/projects/${p.id}/state`), slug).stations.find(s => s.kind === "ask");
  assert.deepEqual([station.unsent, station.held], [true, { reason:"credits", balance:0, required:1, agent:"penecho" }]);
  // Credits bought: Run sends it, and the held note goes.
  service.agents.creditsRefusal = async () => null;
  const ran = await call("POST", `/projects/${p.id}/topics/${slug}/run-unsent`, { step:ask.id });
  assert.equal(ran.status, 200, ran.error);
  const sent = F.parseLine(service.readDoc(p, slug)).steps.find(s => s.kind === "ask");
  assert.equal(F.isUnsent(sent), false);
  assert.equal(sent.held, null);
  assert.doesNotMatch(service.readDoc(p, slug), /Held ·/);
  // And it really runs (E2E L1): a Work, an answer, nothing left waiting.
  await until(() => !service.runs.size && F.parseLine(service.readDoc(p, slug)).steps.some(s => s.kind === "work" && s.done), "the run once credits are back");
  assert.equal(cloudModel.seen.length, 1);
  assert.notEqual(F.parseLine(service.readDoc(p, slug)).front.why, "Out of credits");
});

test("Cloud's 402 in the middle of a run stops it and puts the Ask back as Not sent, saying why", async () => {
  const cloudModel = await fakeModel([402]), { service, call, project } = await setup({ cloud:fakeCloud(cloudModel.url, 500) }), p = project("Midway");
  const asked = await call("POST", `/projects/${p.id}/topics`, { text:"Draw the plan." });
  assert.equal(asked.status, 200, "it started: there were credits when it began");
  const slug = asked.slug;
  await until(() => !service.runs.size && F.parseLine(service.readDoc(p, slug)).steps.some(s => s.kind === "ask" && F.isUnsent(s)), "the Ask to be held");
  const doc = F.parseLine(service.readDoc(p, slug)), ask = doc.steps.find(s => s.kind === "ask"), work = doc.steps.find(s => s.kind === "work");
  assert.equal(cloudModel.seen.length, 1);
  assert.equal(ask.text, "Draw the plan.");
  assert.deepEqual(ask.held, { reason:"credits", balance:3, required:40, agent:"penecho" });
  assert.deepEqual([work.done, work.off], [true, "stopped"], "what it did so far stays on its Work");
  assert.equal(doc.front.why, "Out of credits");
});

test("new and edited built-in presets accept only models in the Cloud catalog", async () => {
  const cloud = fakeCloud("http://cloud.test/v1", 100);
  const catalog = cloud.hostedCatalog;
  cloud.hostedCatalog = null;
  cloud.refreshHostedCatalog = async () => (cloud.hostedCatalog = catalog);
  cloud.hostedModels = async () => ({ ...await cloud.refreshHostedCatalog(), credits:100 });
  const { call } = await setup({ cloud });
  const saved = await call("POST", "/agent-presets", { agent:"penecho", model:"penecho fast" });
  assert.equal(saved.status, 200, JSON.stringify(saved));
  const invalid = await call("PATCH", `/agent-presets/${saved.preset.id}`, { model:"personal" });
  assert.equal(invalid.status, 400);
  assert.equal((await call("GET", "/agent-presets")).presets.find(p => p.id === saved.preset.id).model, "penecho fast");
});

test("signed out with a personal key, the built-in agent cannot start", async () => {
  const personal = await fakeModel(["unused"]), { source, service } = await setup({ own:personal.url });
  assert.equal(source.ready(), false);
  assert.deepEqual(source.models().choices, []);
  assert.equal(service.agents.command("penecho", { workdir:temp }), null);
  await assert.rejects(source.connect("own-model"), { code:"PENECHO_NOT_SET_UP" });
  assert.equal(personal.seen.length, 0);
});

test("review finding 10: the model proxy forgets a run's secret as soon as the run ends", async () => {
  const model = await fakeModel(["Hello."]), { source, service, call, project } = await setup({ cloud:fakeCloud(model.url, 100) }), p = project("Ends");
  const opened = [];
  const open = source.open.bind(source);
  source.open = options => { const run = open(options); opened.push(run); return run; };
  // agents.js calls the source it was given; wrap its command so the run it opens is seen.
  const asked = await call("POST", `/projects/${p.id}/topics`, { text:"Say hello." });
  await until(() => !service.runs.size && ["done", "ready"].includes(F.parseLine(service.readDoc(p, asked.slug)).status), "the run");
  const finished = [...opened];
  assert.ok(finished.length >= 1, "the run opened one");
  const before = source.open({});
  const res = await fetch(`${before.url}/profile`, { headers:{ authorization:`Bearer ${before.secret}` } });
  assert.equal(res.status, 200, "an open run is known");
  for (const run of finished) {
    const gone = await fetch(`${run.url}/profile`, { headers:{ authorization:`Bearer ${run.secret}` } });
    assert.equal(gone.status, 401, "the finished run's secret no longer works");
  }
});

test("review finding 11: the proxy sends the model chosen for the run, whatever the request names", async () => {
  const model = await fakeModel(["fine"]), { source } = await setup({ cloud:fakeCloud(model.url, 100) });
  const run = source.open({ pick:"penecho fast" });
  const res = await fetch(`${run.url}/model/chat/completions`, { method:"POST", headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json" }, body:JSON.stringify({ model:"some-expensive-model", messages:[], stream:true }) });
  assert.equal(res.status, 200);
  assert.equal(model.seen[0].body.model, "11111111-1111-4111-8111-111111111111");
  const bad = await fetch(`${run.url}/model/chat/completions`, { method:"POST", headers:{ authorization:`Bearer ${run.secret}` }, body:"not json" });
  assert.equal(bad.status, 400);
});
