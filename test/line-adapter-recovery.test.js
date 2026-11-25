"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const { setTimeout:delay } = require("node:timers/promises");
const { CodexServer, runTurn, followTurn } = require("../src/server/project-lines/codex-server.js");
const { KeptChild } = require("../src/server/project-lines/kept-child.js");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");

const frame = message => JSON.stringify(message) + "\n";
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adapter-recovery-"));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  return dir;
}

async function until(check, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await delay(10);
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test("Codex decodes a tool request split inside a UTF-8 character", () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  const requests = [];
  const server = new CodexServer({ child, onServerRequest:request => requests.push(request) });
  const question = "Continue 🧪?";
  const message = { id:"question", method:"item/tool/requestUserInput", params:{ questions:[{ id:"q", question }] } };
  const bytes = Buffer.from(frame(message));
  const boundary = bytes.indexOf(Buffer.from("🧪")) + 2;
  child.stdout.write(bytes.subarray(0, boundary));
  assert.equal(requests.length, 0);
  child.stdout.write(bytes.subarray(boundary));
  assert.deepEqual(requests, [message]);
  assert.equal(server.replyServer("question", {}), true);
  assert.deepEqual(JSON.parse(child.stdin.read()), { id:"question", result:{} });
});

async function lineWithAgent(t, source, protocol = "") {
  const root = temp(t), directory = path.join(root, "state"), home = path.join(root, "home");
  fs.mkdirSync(home);
  const script = path.join(root, "agent.cjs");
  fs.writeFileSync(script, source);
  const agents = {
    available:() => [{ id:"fake", name:"Fake", available:true }],
    classifier:() => null,
    command:(_, options) => ({ command:process.execPath, args:[script], cwd:options.workdir, protocol, thread:{}, turn:{} }),
  };
  const open = recoverOnStart => new Service({ directory, agents, conversations:{ home, env:{} }, recoverOnStart, carryOn:true });
  let service = open(false);
  t.after(() => service.close());
  let project = service.store.create({ name:"Adapter recovery", docsPath:path.join(root, "docs") });
  project.follow = false;
  service.store.save();
  const { slug } = await service.createTopic(project, { title:"Adapter recovery", text:"Answer once", agent:"fake", kinds:["ask", "work"], start:false });
  const run = () => service.runs.get(service.key(project, slug));
  return {
    root, service, project, slug, run,
    begin:() => service.begin(project, slug),
    doc:() => F.parseLine(service.readDoc(project, slug)),
    detail:stepId => service.store.readText(project, F.detailPath(slug, stepId)).text,
    restart() {
      service.close();
      service = open(true);
      project = service.store.get(project.id);
    },
  };
}

test("keeper restart replays incomplete CLI output without relaunching the Work", async t => {
  const record = Buffer.from(frame({ type:"assistant", message:{ content:[{ type:"text", text:"Full answer 🧪 survived." }] } }));
  const boundary = record.indexOf(Buffer.from("🧪")) + 2;
  const fixture = await lineWithAgent(t, `
    const fs = require("node:fs");
    const path = require("node:path");
    const bytes = Buffer.from(${JSON.stringify(record.toString("base64"))}, "base64");
    const release = path.join(__dirname, "release");
    process.stdin.resume();
    process.stdin.once("end", () => {
      fs.writeSync(1, bytes.subarray(0, ${boundary}));
      const timer = setInterval(() => {
        if (!fs.existsSync(__dirname)) process.exit(1);
        if (!fs.existsSync(release)) return;
        clearInterval(timer);
        fs.writeSync(1, bytes.subarray(${boundary}));
      }, 10);
    });
  `);
  const { root, service, project, slug, run } = fixture;
  await fixture.begin();
  const first = await until(() => run()?.buffer && run(), "partial stdout to reach the parser");
  const pid = first.child.pid;
  service.keepNote(project, slug, first, true);
  const saved = readJson(path.join(first.keepDir, "run.json"));
  assert.equal(saved.offsets.out, 0);
  assert.equal(first.child.offsets.out, boundary);

  fixture.restart();
  assert.equal(run().child.pid, pid);
  fs.writeFileSync(path.join(root, "release"), "");
  await until(() => fixture.doc().status === "done", "the original Work to finish");
  const detail = fixture.detail(first.stepId);
  assert.match(F.sectionText(detail, "Result"), /Full answer 🧪 survived\./);
  await until(() => fs.existsSync(path.join(first.keepDir, "exit.json")), "the isolated keeper to finish");
});

function keptCodex(t) {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
  const readInput = () => {
    try { return fs.readFileSync(path.join(dir, "input"), "utf8"); }
    catch (error) { if (error.code === "ENOENT") return ""; throw error; }
  };
  const requests = method => readInput().trim().split("\n").filter(Boolean).map(JSON.parse).filter(message => message.method === method);
  const output = path.join(dir, "out");
  const send = message => fs.appendFileSync(output, frame(message));
  const attach = (offsets, callbacks) => {
    const child = new KeptChild(dir, { offsets });
    t.after(() => child.detach());
    return new CodexServer({ child, ...callbacks });
  };
  return { dir, requests, send, attach, output };
}

async function settled(promise) {
  let result;
  promise.then(value => { result = value; });
  return until(() => result, "Codex terminal result");
}

const completion = (threadId, turnId, status, error) => ({ method:"turn/completed", params:{ threadId, turn:{ id:turnId, status, error } } });

for (const status of ["completed", "failed"]) {
  test(`Line recovers Codex ${status} with its saved output while finalization is interrupted`, async t => {
    const reason = "Model failed after output.";
    const error = status === "failed" ? { message:reason } : undefined;
    const note = completion("main", "turn", status, error);
    const answer = "The saved terminal reply.";
    const fixture = await lineWithAgent(t, `
      const fs = require("node:fs");
      const path = require("node:path");
      const readline = require("node:readline");
      const write = reply => process.stdout.write(JSON.stringify(reply) + "\\n");
      readline.createInterface({ input:process.stdin }).on("line", line => {
        const request = JSON.parse(line);
        if (request.method === "initialize") write({ id:request.id, result:{} });
        if (request.method === "thread/start") write({ id:request.id, result:{ thread:{ id:"main" } } });
        if (request.method !== "turn/start") return;
        fs.appendFileSync(path.join(__dirname, "turns"), "start\\n");
        write({ id:request.id, result:{ turn:{ id:"turn" } } });
        write({ method:"item/completed", params:{ threadId:"main", item:{ type:"agentMessage", id:"reply", text:${JSON.stringify(answer)} } } });
        write(${JSON.stringify(note)});
      });
    `, "app-server");
    let finalizing = false;
    t.mock.method(fixture.service, "captureCodexRuntime", async (_project, _slug, _run, { final } = {}) => {
      if (!final) return;
      finalizing = true;
      await new Promise(() => {});
    });
    await fixture.begin();
    await until(() => finalizing, "save after Codex's terminal frame");
    const first = fixture.run(), pid = first.child.pid;
    const saved = readJson(path.join(first.keepDir, "run.json"));
    assert.equal(saved.offsets.out, fs.statSync(path.join(first.keepDir, "out")).size);
    assert.equal(saved.fields.turnOutcome.result.code, error ? 1 : 0);
    assert.equal(fixture.doc().status, "working");

    fixture.restart();
    assert.equal(fixture.run().child.pid, pid);
    const doc = await until(() => {
      const current = fixture.doc();
      return current.status !== "working" && current;
    }, "Line to settle");
    assert.equal(doc.status, error ? "stopped" : "done");
    if (error) assert.equal(doc.front.why, reason);
    assert.match(F.sectionText(fixture.detail(first.stepId), "Result"), new RegExp(answer));
    assert.equal(fs.readFileSync(path.join(fixture.root, "turns"), "utf8"), "start\n");
    await until(() => fs.existsSync(path.join(first.keepDir, "exit.json")), "the isolated keeper to finish");
  });

  test(`kept Codex ${status} turn survives a consumed checkpoint and a replay checkpoint`, async t => {
    const { dir, requests, send, attach, output } = keptCodex(t);
    const first = attach();
    let started;
    const original = runTurn(first, { input:"Do the Work", onStarted:id => { started = id; } });
    const [open] = await until(() => requests("thread/start").length && requests("thread/start"), "thread/start");
    send({ id:open.id, result:{ thread:{ id:"main" } } });
    const [start] = await until(() => requests("turn/start").length && requests("turn/start"), "turn/start");
    send({ id:start.id, result:{ turn:{ id:"turn" } } });
    await until(() => started === "turn", "turn/start response");
    send(completion("helper", "turn", "completed"));
    send(completion("main", "other", "completed"));
    const replayOffset = fs.statSync(output).size;
    await until(() => first.child.offsets.out === replayOffset, "foreign terminal frames");
    assert.equal(first.turnOutcome, undefined);
    const item = { method:"item/completed", params:{ threadId:"main", item:{ type:"agentMessage", id:"reply", text:"The answer already written." } } };
    send(item);
    const error = status === "failed" ? { message:"Model failed after output." } : undefined;
    send(completion("main", "turn", status, error));
    const expected = { code:error ? 1 : 0, reason:error?.message || "" };
    assert.deepEqual(await settled(original), expected);
    const saved = JSON.parse(JSON.stringify({ offsets:first.child.offsets, outcome:first.turnOutcome }));
    assert.equal(saved.outcome.out, fs.statSync(output).size);
    assert.equal(saved.offsets.out, saved.outcome.out);
    first.child.detach();

    const options = { threadId:"main", turnId:"turn", savedOutcome:saved.outcome };
    const recovered = attach(saved.offsets, { onNote() { assert.fail("The consumed terminal frame should not replay"); } });
    assert.deepEqual(await settled(followTurn(recovered, options)), expected);
    assert.deepEqual(recovered.turnOutcome, saved.outcome, "a subsequent handoff retains the same terminal boundary");
    recovered.child.detach();

    const notes = [];
    const replayed = attach({ out:replayOffset }, { onNote:note => notes.push(note) });
    assert.deepEqual(await settled(followTurn(replayed, options)), expected);
    assert.deepEqual(notes, [item, completion("main", "turn", status, error)].map(note => JSON.parse(frame(note))));
    assert.equal(replayed.turnOutcome.out, saved.outcome.out);
    assert.equal(requests("turn/start").length, 1);

    replayed.child.detach();
    const stale = attach(saved.offsets);
    const result = followTurn(stale, { ...options, turnId:"replacement" });
    fs.writeFileSync(path.join(dir, "exit.json"), JSON.stringify({ code:0 }));
    assert.equal((await settled(result)).closed, true, "a terminal result cannot settle another turn");
  });
}

test("a recovered turn/start rejection settles the submitted request once while Codex is alive", async t => {
  const { dir, requests, send, attach, output } = keptCodex(t);
  const start = { id:3, method:"turn/start", params:{ threadId:"main" } };
  fs.writeFileSync(path.join(dir, "input"), frame(start));
  const observed = [];
  const server = attach(undefined, { onResponse:message => observed.push(message.id) });
  const result = followTurn(server, { phase:"starting-turn", input:"Do the Work" });
  send({ id:42, error:{ message:"A different request failed." } });
  await until(() => server.child.offsets.out === fs.statSync(output).size, "unrelated response");
  assert.equal(server.turnOutcome, undefined);
  send({ id:3, error:{ message:"Turn refused by Codex." } });
  const expected = { code:1, reason:"Turn refused by Codex." };
  assert.deepEqual(await settled(result), expected);
  assert.deepEqual(observed, [42, 3]);
  assert.equal(server.alive, true);
  const { turnOutcome:savedOutcome, child:{ offsets } } = server;
  server.child.detach();

  const recovered = attach(offsets);
  assert.deepEqual(await settled(followTurn(recovered, { phase:"starting-turn", savedOutcome })), expected);
  assert.deepEqual(requests("turn/start"), [start]);
});
