"use strict";
require("./helpers/safety.js");
// R1: "Run with PenEcho" stays up when Cloud or the network misbehaves. A model call is tried again (at most 8 tries, with the
// same idempotency key), a cut answer is never taken as a finished one, and a run that cannot go on ends with the line free,
// the Work saying why in one sentence, and Retry carrying on from the conversation so far. Faults come from a fake Cloud
// (test/helpers/fake-model-cloud.js).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const R = require("../src/server/agent-core/model-retry.js");
const { parseLine } = require("../src/server/project-lines/activity.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { createPenEchoSource } = require("../src/server/agent-core/penecho-source.js");
const { createModelProxy } = require("../src/server/agent-core/model-proxy.js");
const { startFakeModelCloud } = require("./helpers/fake-model-cloud.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-retry-")));
const closing = [];
after(async () => { for (const close of closing.reverse()) await close(); fs.rmSync(temp, { recursive:true, force:true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 30000) { const start = Date.now(); for (;;) { const v = await check(); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(40); } }
const MODEL = "11111111-2222-4333-8444-555555555555";

// This computer, signed in to the fake Cloud.
async function signedIn({ script = [], answer = "All done.", format = "openai", silenceMs = 1500, backoff = () => 60, keepaliveMs = 120_000, cloud: own = null } = {}) {
  const cloud = own || await startFakeModelCloud({ script, answer });
  closing.push(() => cloud.close());
  const models = [{ id:MODEL, apiFormat:format, displayName:"Fake" }];
  const connector = { status:() => ({ accountSession:{ signedIn:true } }), hostedCatalog:{ models }, refreshHostedCatalog:async () => ({ models }), hostedModels:async () => ({ credits:100 }),
    prepareHostedConnection:async id => ({ id, provider:"api", apiFormat:format, apiUrl:`${cloud.origin}/api/v1/hosted`, apiKey:"account-token", apiModel:MODEL, effort:"medium", hosted:true }) };
  const retries = [];
  const source = createPenEchoSource({ cloud:() => connector, hostedSilenceMs:silenceMs, backoff, keepaliveMs, onRetry:(id, info) => retries.push({ id, ...info }) });
  closing.push(() => source.close());
  await source.listening;
  return { cloud, source, retries };
}
// One model call the way the runner makes it, straight to the proxy.
async function call(source, { format = "openai", signal } = {}) {
  const run = source.open({});
  const res = await fetch(`${run.url}/model/${format === "anthropic" ? "v1/messages" : "chat/completions"}`, { method:"POST", signal, headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json" }, body:JSON.stringify({ model:"x", messages:[{ role:"user", content:"hi" }], stream:true }) });
  return { run, status:res.status, body:await res.text() };
}
const kinds = calls => calls.map(c => (c.step && typeof c.step === "object" ? c.step.status || "tool" : c.step));

test("the retry rules: which answers are tried again, the backoff, retry-after, and the words", () => {
  assert.equal(R.TRIES, 8);
  for (const status of [408, 429, 500, 502, 503, 504, 520, 524, 529]) assert.equal(R.retryableStatus(status), true, String(status));
  for (const status of [400, 401, 402, 403, 404, 413, 422]) assert.equal(R.retryableStatus(status), false, String(status));
  assert.equal(R.retryableStatus(409, "request_in_progress"), true, "Cloud still finishing the last try of the same call");
  assert.equal(R.retryableStatus(409, "request_already_completed"), false);
  for (const tried of [1, 2, 3]) {
    const low = R.backoffMs(tried, () => 0), high = R.backoffMs(tried, () => 0.999999);
    assert.equal(low, R.BACKOFF_MS[tried - 1] * 0.75);
    assert.ok(high <= R.BACKOFF_MS[tried - 1] * 1.25 && high > R.BACKOFF_MS[tried - 1], "jitter both ways");
  }
  assert.equal(R.retryAfterMs("3"), 3000);
  assert.equal(R.retryAfterMs(new Date(Date.now() + 5000).toUTCString(), Date.now()) > 3000, true);
  assert.equal(R.retryAfterMs(""), null);
  assert.equal(R.retryableEvent({ code:"provider_timeout" }), true);
  assert.equal(R.retryableEvent({ code:"insufficient_credits" }), false);
  assert.equal(R.retryableEvent({ code:"anything", retryable:true }), true, "Cloud's own mark wins");
  assert.equal(R.retryableEvent({ type:"overloaded_error" }), true);
  assert.equal(R.plainFailure(new Error('503: {"error":{"message":"The answer stopped halfway. PenEcho tried 8 times."}}')), "The answer stopped halfway. PenEcho tried 8 times.");
  assert.equal(R.plainFailure(new Error("pi-ai stream idle timeout after 180000ms")), "No answer came from the model for 3 minutes.");
});

test("every fault worth another try is tried again, with the same idempotency key, and each retry is told", async () => {
  const { cloud, source, retries } = await signedIn();
  for (const fault of ["refuse", { status:408 }, { status:429 }, { status:500 }, { status:502 }, { status:503 }, { status:504 }, "stall", "stall-headers", "cut", "reset", "error-event", "keepalive-error"]) {
    cloud.script([fault]); retries.length = 0;
    const { run, status, body } = await call(source);
    assert.equal(status, 200, JSON.stringify(fault));
    assert.match(body, /All done\./, JSON.stringify(fault));
    assert.match(body, /\[DONE\]/, "a whole answer");
    assert.equal(cloud.calls.length, 2, JSON.stringify(fault));
    const keys = new Set(cloud.calls.map(c => c.key));
    assert.equal(keys.size, 1, "one key for both tries, so Cloud charges once");
    assert.match([...keys][0], /^pe-[0-9a-f-]{36}-1$/);
    assert.ok(cloud.calls.every(c => c.product === "lines"));
    assert.equal(retries.length, 1);
    assert.deepEqual([retries[0].id, retries[0].attempt, retries[0].of], [run.id, 2, R.TRIES]);
    assert.ok(retries[0].why && !/\d{3}|[{}]/.test(retries[0].why), `plain words: ${retries[0].why}`);
  }
  // The next call of the same run has a key of its own.
  cloud.script([]);
  const run = source.open({}), ask = () => fetch(`${run.url}/model/chat/completions`, { method:"POST", headers:{ authorization:`Bearer ${run.secret}` }, body:JSON.stringify({ messages:[], stream:true }) }).then(r => r.text());
  await ask(); await ask();
  assert.deepEqual(cloud.calls.map(c => c.key.split("-").pop()), ["1", "2"]);
});

test("the same holds for Anthropic-format models", async () => {
  const { cloud, source } = await signedIn({ format:"anthropic" });
  for (const fault of ["cut", "reset", "error-event", { status:529 }, "stall"]) {
    cloud.script([fault]);
    const { status, body } = await call(source, { format:"anthropic" });
    assert.equal(status, 200, JSON.stringify(fault));
    assert.match(body, /message_stop/);
    assert.equal(cloud.calls.length, 2, JSON.stringify(fault));
  }
});

test("never tried again: 400, 401, 402, 403, 413, and an error Cloud says another try cannot fix", async () => {
  const { cloud, source, retries } = await signedIn();
  for (const status of [400, 401, 402, 403, 413]) {
    cloud.script([{ status }]);
    const answer = await call(source);
    assert.equal(answer.status, status);
    assert.equal(cloud.calls.length, 1, String(status));
    assert.match(answer.body, new RegExp(`fake_${status}`), "the answer is passed on as it was");
  }
  cloud.script([{ status:503, body:{ error:"provider_request_failed", message:"No.", details:{ retryable:false } } }]);
  assert.equal((await call(source)).status, 503);
  assert.equal(cloud.calls.length, 1, "Cloud marked it not worth another try");
  assert.equal(retries.length, 0);
});

test("R1b: Cloud before and after its statuses changed; a failure worth another try is tried again either way", async () => {
  const { cloud, source, retries } = await signedIn();
  // Before: Cloud's own JSON 502 or 504 reached this computer as Cloudflare's HTML page. The same page still comes when the tunnel is down.
  for (const status of [502, 504]) {
    cloud.script([{ status, cloudflare:true }]); retries.length = 0;
    const { status:answered, body } = await call(source);
    assert.equal(answered, 200, String(status));
    assert.match(body, /All done\./);
    assert.equal(cloud.calls.length, 2, `Cloudflare's ${status} page is tried again`);
    assert.equal(retries[0].why, status === 504 ? R.WHY.timeout : R.WHY.server);
  }
  // After: Cloud's own failure worth another try comes as 503 with its JSON, marked retryable.
  cloud.script([{ status:503, body:{ error:"invalid_provider_response", message:"The provider returned invalid JSON.", details:{ retryable:true } } }]);
  assert.equal((await call(source)).status, 200);
  assert.equal(cloud.calls.length, 2, "Cloud's 503 is tried again");
  // A Cloud error with no mark, as 500 (its 502 page was tried again before; so is this).
  cloud.script([{ status:500, body:{ error:"provider_usage_invalid", message:"The provider returned invalid cached input token usage." } }]);
  assert.equal((await call(source)).status, 200);
  assert.equal(cloud.calls.length, 2);
  // One another try cannot fix comes as 500 marked retryable false: passed on as it was, once, with Cloud's own words.
  cloud.script([{ status:500, body:{ error:"provider_authentication_failed", message:"The selected provider rejected its configured credential.", details:{ retryable:false } } }]); retries.length = 0;
  const refused = await call(source);
  assert.equal(refused.status, 500);
  assert.equal(cloud.calls.length, 1);
  assert.equal(retries.length, 0);
  assert.equal(JSON.parse(refused.body).message, "The selected provider rejected its configured credential.");
  // A Cloudflare page every time: the run ends with the plain sentence after every try, never the HTML.
  cloud.script(Array(R.TRIES).fill({ status:502, cloudflare:true }));
  const down = await call(source);
  assert.equal(cloud.calls.length, R.TRIES);
  assert.doesNotMatch(down.body, /<html|DOCTYPE/i);
  assert.match(down.body, /PenEcho tried 8 times\./);
});

test("a cut answer is never passed on as a finished one: after every try the runner gets an error, in plain words", async () => {
  const { cloud, source, retries } = await signedIn();
  for (const fault of ["cut", "reset", { status:503 }, "stall"]) {
    cloud.script([...Array(R.TRIES).fill(fault), "ok"]); retries.length = 0;
    const answer = await call(source);
    assert.notEqual(answer.status, 200, JSON.stringify(fault));
    assert.equal(cloud.calls.length, R.TRIES, `at most ${R.TRIES} tries`);
    assert.deepEqual(retries.map(r => r.attempt), Array.from({ length:R.TRIES - 1 }, (_, n) => n + 2));
    const said = JSON.parse(answer.body).error.message;
    assert.match(said, /PenEcho tried 8 times\.$/);
    assert.doesNotMatch(said, /Half an ans/);
  }
  // An answer whose end said how it finished, with only the closing marker lost, is whole: it is passed on with the marker added.
  cloud.script(["finish-no-done"]);
  const whole = await call(source);
  assert.equal(whole.status, 200);
  assert.equal(cloud.calls.length, 1);
  assert.match(whole.body, /"finish_reason":"stop"[\s\S]*data: \[DONE\]\n\n$/);
});

test("a replay that hits request_already_completed never creates a second billing key and returns explicit result_unavailable", async () => {
  const { cloud, source } = await signedIn();
  const inProgress = { status:409, body:{ error:"request_in_progress", message:"A request with this idempotency key is still running." } };
  const done = { status:409, body:{ error:"request_already_completed", message:"A request with this idempotency key has already completed; response bodies are not retained." } };
  // request_in_progress retries under the exact same key; once Cloud reports request_already_completed,
  // proxy stops without minting a second billing key (K-2) and returns explicit 409 result_unavailable.
  cloud.script([inProgress, done, "ok"]);
  const answer = await call(source);
  assert.equal(answer.status, 409);
  const parsed = JSON.parse(answer.body);
  assert.equal(parsed.error.code, "result_unavailable");
  assert.deepEqual(kinds(cloud.calls), [409, 409]);
  assert.equal(cloud.calls[1].key, cloud.calls[0].key, "must keep the original billing key across retries");
  assert.equal(new Set(cloud.calls.map(c => c.key)).size, 1, "must never mint a second billing key");
  // On a first try the same refusal also returns 409 result_unavailable with a single attempt.
  cloud.script([done]);
  const first = await call(source);
  assert.equal(first.status, 409);
  assert.equal(JSON.parse(first.body).error.code, "result_unavailable");
  assert.equal(cloud.calls.length, 1);
});

test("a streamed call held for long gets its headers and keepalives at once, then only a whole answer or one plain error event", async () => {
  const { cloud, source } = await signedIn({ keepaliveMs:100, silenceMs:400 });
  cloud.script([{ slow:450 }]);
  const run = source.open({}), started = Date.now();
  const res = await fetch(`${run.url}/model/chat/completions`, { method:"POST", headers:{ authorization:`Bearer ${run.secret}` }, body:JSON.stringify({ messages:[], stream:true }) });
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started < 400, "headers come before the answer is ready, so the runner's HTTP client keeps waiting");
  const body = await res.text();
  assert.match(body, /^: keepalive\n\n/);
  assert.match(body, /All done\.[\s\S]*data: \[DONE\]\n\n$/);
  // Every try failed after the headers went out: one error event, in words, and never the half answer.
  for (const format of ["openai", "anthropic"]) {
    const held = await signedIn({ keepaliveMs:100, format });
    held.cloud.script(Array(R.TRIES).fill("reset"));
    const failed = await call(held.source, { format });
    assert.equal(failed.status, 200);
    assert.doesNotMatch(failed.body, /Half an ans/);
    const event = JSON.parse(failed.body.trim().split("\n").filter(line => line.startsWith("data: ")).at(-1).slice(6));
    assert.equal(event.error.message, "The answer stopped halfway. PenEcho tried 8 times.");
    if (format === "anthropic") assert.match(failed.body, /event: error\n/);
  }
  // A refusal after the headers went out (402) is one error event too, and still counted as out of credits.
  const broke = await signedIn({ keepaliveMs:100 });
  broke.cloud.script(["reset", { status:402, body:{ error:"insufficient_credits", message:"Add credits to run this Ask." } }]);
  const refused = await call(broke.source);
  assert.match(refused.body, /Add credits to run this Ask\./);
  assert.equal(broke.source.refused(refused.run.id).error, "insufficient_credits");
});

test("the runner, held past its keepalive, ends with the plain sentence, not raw JSON", async () => {
  const { cloud, source } = await signedIn({ keepaliveMs:100 });
  const state = path.join(temp, "runner-held"), workdir = path.join(temp, "runner-held-work");
  fs.mkdirSync(state, { recursive:true }); fs.mkdirSync(workdir, { recursive:true });
  const agents = createAgents({ env:{ ...process.env }, paths:{ penecho:source, stateDir:state }, appFolders:[] });
  cloud.script([{ slow:300 }]);
  const ok = await runOnce(agents.command("penecho", { workdir }), "Say hello.");
  assert.equal(ok.lines.find(l => l.type === "result").result, "All done.");
  cloud.script(Array(R.TRIES).fill("reset"));
  const failed = await runOnce(agents.command("penecho", { workdir }), "Say hello.");
  const end = failed.lines.find(l => l.type === "result");
  assert.deepEqual([failed.code, end.is_error, end.result], [1, true, "The answer stopped halfway. PenEcho tried 8 times."]);
});

test("retry-after is obeyed, and one longer than a minute is not waited for", async () => {
  const { cloud, source, retries } = await signedIn();
  cloud.script([{ status:429, retryAfter:2 }]);
  const started = Date.now(), answer = await call(source);
  assert.equal(answer.status, 200);
  assert.ok(Date.now() - started >= 1900, "waited as Cloud asked");
  assert.equal(retries[0].waitMs, 2000);
  cloud.script([{ status:429, retryAfter:120 }]); retries.length = 0;
  const long = await call(source);
  assert.equal(long.status, 429);
  assert.equal(cloud.calls.length, 1);
  assert.equal(retries.length, 0);
  assert.match(JSON.parse(long.body).error.message, /asked to wait 120 seconds/);
});

test("a call the person stopped is not tried again", async () => {
  const { cloud, source } = await signedIn({ backoff:() => 1500 });
  cloud.script([{ status:503 }, { status:503 }, { status:503 }]);
  const controller = new AbortController();
  const pending = call(source, { signal:controller.signal }).catch(error => error);
  await until(() => cloud.calls.length === 1, "the first try");
  controller.abort();
  await pending;
  await wait(4500);
  assert.equal(cloud.calls.length, 1, "nothing more after Stop");
});

// The real runner, started the way PenEcho starts it.
const userLine = text => `${JSON.stringify({ type:"user", message:{ role:"user", content:[{ type:"text", text }] } })}\n`;
function runOnce(command, words, { started = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, { cwd:command.cwd, env:{ ...process.env, ...command.env }, stdio:["pipe", "pipe", "pipe"] });
    let stdout = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`The run did not end.\n${stdout}`)); }, 60000);
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (/"type":"result"/.test(stdout) && !child.stdin.writableEnded) child.stdin.end();
    });
    child.on("close", code => { clearTimeout(timer); resolve({ code, lines:stdout.split("\n").filter(Boolean).map(line => JSON.parse(line)) }); });
    child.stdin.write(userLine(words));
    started?.(child);
  });
}

test("the runner: a cut answer is tried again and the turn finishes; one that keeps failing ends with one plain sentence", async () => {
  const { cloud, source } = await signedIn();
  const state = path.join(temp, "runner-state"), workdir = path.join(temp, "runner-work");
  fs.mkdirSync(state, { recursive:true }); fs.mkdirSync(workdir, { recursive:true });
  const agents = createAgents({ env:{ ...process.env }, paths:{ penecho:source, stateDir:state }, appFolders:[] });
  cloud.script(["cut", "error-event"]);
  const ok = await runOnce(agents.command("penecho", { workdir }), "Say hello.");
  const result = ok.lines.find(l => l.type === "result");
  assert.deepEqual([ok.code, result.is_error, result.result], [0, false, "All done."]);
  assert.equal(cloud.calls.length, 3);
  cloud.script(Array(R.TRIES).fill("reset"));
  const failed = await runOnce(agents.command("penecho", { workdir }), "Say hello.");
  const end = failed.lines.find(l => l.type === "result");
  assert.deepEqual([failed.code, end.is_error], [1, true]);
  assert.equal(end.result, "The answer stopped halfway. PenEcho tried 8 times.");
  assert.equal(cloud.calls.length, R.TRIES, "the loop inside the runner did not try again on top of the proxy");
});

test("the runner keeps the conversation after every step, so a run killed mid-turn can be carried on", async () => {
  const { cloud, source } = await signedIn({ silenceMs:60000 });
  const state = path.join(temp, "runner-kill"), workdir = path.join(temp, "runner-kill-work"), sessions = path.join(state, "project-lines", "penecho-sessions");
  fs.mkdirSync(workdir, { recursive:true });
  const agents = createAgents({ env:{ ...process.env }, paths:{ penecho:source, stateDir:state }, appFolders:[] });
  cloud.script([{ tool:"write", args:{ file_path:"note.txt", content:"kept\n" } }, "stall-headers"]);
  const command = agents.command("penecho", { workdir });
  const killed = await runOnce(command, "Write a note, then think for a long time.", { started:child => until(() => cloud.calls.length >= 2, "the second call").then(() => child.kill("SIGKILL")) });
  assert.notEqual(killed.code, 0);
  const id = killed.lines.find(l => l.type === "system" && l.subtype === "init").session_id;
  const kept = JSON.parse(fs.readFileSync(path.join(sessions, `${id}.json`), "utf8"));
  assert.deepEqual(kept.turns.map(t => t.role), ["user", "tool"], "the Ask and the step it took are kept");
  // Retry starts the runner again on the same conversation: it hears what was said and done.
  cloud.script([]);
  const again = await runOnce(agents.command("penecho", { workdir, resume:id }), "Carry on.");
  assert.equal(again.lines.find(l => l.type === "result").is_error, false);
  assert.match(JSON.stringify(cloud.calls.at(-1).body.messages), /earlier_in_this_conversation[\s\S]*Write a note[\s\S]*used write: note\.txt/);
});

// A whole line, through PenEcho's own routes.
async function linesWith(source) {
  const n = closing.length, directory = path.join(temp, `state-${n}`), docsBase = path.join(temp, `base-${n}`);
  fs.mkdirSync(directory, { recursive:true });
  const agents = createAgents({ env:{ ...process.env, PATH:process.env.PATH }, paths:{ penecho:source, stateDir:directory }, appFolders:[] });
  const lines = createProjectLines({ directory, agents, serviceOptions:{ autoWatch:false, docsBase }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closing.push(() => { server.close(); lines.close(); });
  const api = async (method, route, body) => { const res = await fetch(`http://127.0.0.1:${server.address().port}/api/lines${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) }); return { status:res.status, ...await res.json() }; };
  const project = name => { const p = lines.service.store.create({ name, docsPath:path.join(docsBase, name) }); p.defaultAgent = "penecho"; return p; };
  return { service:lines.service, api, project };
}

test("a Work whose model keeps failing ends with the line free and one plain sentence; its activity shows each try; Retry carries on", async () => {
  const { cloud, source } = await signedIn();
  const { service, api, project } = await linesWith(source), p = project("Flaky");
  cloud.script([{ status:503 }, "reset", { status:502 }, "cut", "error-event", { status:429 }, "reset", "cut"]);
  const asked = await api("POST", `/projects/${p.id}/topics`, { text:"Summarise the notes." });
  assert.equal(asked.status, 200, asked.error);
  const slug = asked.slug;
  await until(() => !service.runs.size && F.parseLine(service.readDoc(p, slug)).status === "stopped", "the Work to stop");
  const doc = F.parseLine(service.readDoc(p, slug)), work = doc.steps.find(s => s.kind === "work");
  assert.equal(doc.front.why, "The answer stopped halfway. PenEcho tried 8 times.");
  assert.match(service.store.readText(p, F.detailPath(slug, work.id)).text, /The answer stopped halfway\. PenEcho tried 8 times\./, "its Work says why");
  assert.equal(service.proxyRuns.size, 0, "the run is forgotten");
  const rows = (await api("GET", `/projects/${p.id}/topics/${slug}/activity`)).rows;
  const tries = rows.filter(r => r.kind === "retry");
  assert.deepEqual(tries.map(r => [r.attempt, r.of]), Array.from({ length:R.TRIES - 1 }, (_, n) => [n + 2, R.TRIES]));
  assert.ok(tries.every(r => r.why && r.text && r.step === work.id));
  // Retry: the same conversation goes on, and this time Cloud answers.
  cloud.script([]);
  const retried = await api("POST", `/projects/${p.id}/topics/${slug}/retry`, {});
  assert.equal(retried.status, 200, retried.error);
  await until(() => !service.runs.size && F.parseLine(service.readDoc(p, slug)).status !== "working", "the retried Work");
  assert.notEqual(F.parseLine(service.readDoc(p, slug)).status, "stopped");
  assert.match(JSON.stringify(cloud.calls.at(-1).body.messages), /earlier_in_this_conversation[\s\S]*Summarise the notes/, "carried on from the conversation so far");
});

test("a PenEcho run whose process dies without a word stops in a plain sentence, never a stack trace", async () => {
  const { cloud, source } = await signedIn({ silenceMs:60000 });
  const { service, api, project } = await linesWith(source), p = project("Killed");
  cloud.script(["stall-headers"]);
  const asked = await api("POST", `/projects/${p.id}/topics`, { text:"Think hard." });
  await until(() => cloud.calls.length === 1 && service.runs.size === 1, "the call to start");
  for (const run of service.runs.values()) run.child.kill("SIGKILL");
  await until(() => !service.runs.size && F.parseLine(service.readDoc(p, asked.slug)).status === "stopped", "the Work to stop");
  assert.equal(F.parseLine(service.readDoc(p, asked.slug)).front.why, "PenEcho's agent stopped before it finished. Retry carries on from where it got to.");
});

test("Cloud's stream-json retry line becomes the same activity row", () => {
  const [change] = parseLine(JSON.stringify({ type:"system", subtype:"retry", attempt:3, of:4, why:"The model took too long to answer" }));
  assert.deepEqual(change.add, { kind:"retry", attempt:3, of:4, why:"The model took too long to answer", text:"The model took too long to answer. Trying again (3 of 4)." });
});

// The proxy on its own, so the limits of the request_in_progress wait can be set small.
async function directProxy({ script = [], ...options } = {}) {
  const cloud = await startFakeModelCloud({ script });
  closing.push(() => cloud.close());
  const proxy = createModelProxy({
    connect:async () => ({ apiFormat:"openai", apiUrl:`${cloud.origin}/api/v1/hosted`, apiKey:"account-token", apiModel:MODEL, hosted:true }),
    describe:async (connection, { baseURL }) => ({ provider:"api", model:connection.apiModel, apiKeyEnv:"K", config:{ baseURL } }),
    target:async connection => connection.apiUrl,
    backoff:() => 20, ...options,
  });
  closing.push(() => proxy.close());
  await proxy.listening;
  return { cloud, source:proxy };
}

const IN_PROGRESS = { status:409, body:{ error:"request_in_progress", message:"A request with this idempotency key is still running." } };

test("request_in_progress is its own wait: the words, and the limits", () => {
  assert.equal(R.WHY.inProgress, "Waiting for the earlier model call to finish");
  assert.equal(R.IN_PROGRESS_WAIT_MOST_MS, 180_000);
  assert.equal(R.IN_PROGRESS_POLLS_MOST, 40);
  assert.equal(R.whyOfStatus(409, "request_in_progress"), R.WHY.inProgress);
  assert.equal(R.whyOfStatus(409), R.WHY.server, "any other 409 keeps its words");
  assert.equal(R.whyOfStatus(429), R.WHY.busy);
  assert.equal(R.whyOfEvent({ code:"request_in_progress" }), R.WHY.inProgress);
  assert.equal(R.whyOfEvent({ type:"request_in_progress" }), R.WHY.inProgress);
  assert.equal(R.whyOfEvent({ code:"rate_limit_error" }), R.WHY.busy);
});

test("more than TRIES request_in_progress answers do not use up the tries: the same key is asked again until Cloud has the answer", async () => {
  const { cloud, source, retries } = await signedIn();
  cloud.script([...Array(R.TRIES + 4).fill(IN_PROGRESS), "ok"]);
  const answer = await call(source);
  assert.equal(answer.status, 200);
  assert.match(answer.body, /All done\./);
  assert.equal(cloud.calls.length, R.TRIES + 5);
  assert.equal(new Set(cloud.calls.map(c => c.key)).size, 1, "one immutable idempotency key");
  assert.equal(retries.length, R.TRIES + 4);
  assert.ok(retries.every(r => r.why === R.WHY.inProgress), "said as a wait, not as a model problem");
  assert.deepEqual(retries.map(r => r.attempt), Array.from({ length:R.TRIES + 4 }, (_, n) => n + 1));
  assert.ok(retries.every(r => r.of === R.IN_PROGRESS_POLLS_MOST && r.waitMs > 0));
  // The failure tries are whole afterwards: waits do not count against them, and TRIES real failures still stop the call.
  cloud.script([...Array(5).fill(IN_PROGRESS), ...Array(R.TRIES - 1).fill({ status:503 }), "ok"]);
  assert.equal((await call(source)).status, 200);
  assert.equal(cloud.calls.length, 5 + R.TRIES);
  cloud.script([...Array(3).fill(IN_PROGRESS), ...Array(R.TRIES).fill({ status:503 }), "ok"]);
  const failed = await call(source);
  assert.notEqual(failed.status, 200);
  assert.equal(cloud.calls.length, 3 + R.TRIES);
  assert.match(JSON.parse(failed.body).error.message, /PenEcho tried 8 times\.$/);
});

test("request_in_progress obeys retry-after (never below a gentle floor), and a long one is not waited for", async () => {
  const { cloud, source, retries } = await signedIn({ backoff:undefined });
  cloud.script([{ ...IN_PROGRESS, retryAfter:2 }]);
  const started = Date.now(), answer = await call(source);
  assert.equal(answer.status, 200);
  assert.ok(Date.now() - started >= 1900, "waited as Cloud asked");
  assert.equal(retries[0].waitMs, 2000);
  cloud.script([{ ...IN_PROGRESS, retryAfter:120 }]); retries.length = 0;
  const long = await call(source);
  assert.equal(long.status, 409);
  assert.equal(cloud.calls.length, 1);
  assert.equal(retries.length, 0);
  assert.match(JSON.parse(long.body).error.message, /asked to wait 120 seconds/);
});

test("a call that never finishes on Cloud stops cleanly: bounded by polls and by time, with request_in_progress", async () => {
  const words = "The earlier model call on PenEcho Cloud did not finish in time.";
  const polled = await directProxy({ inProgressPollsMost:3 });
  polled.cloud.script(Array(100).fill(IN_PROGRESS));
  const byPolls = await call(polled.source);
  assert.equal(byPolls.status, 504);
  const error = JSON.parse(byPolls.body).error;
  assert.deepEqual([error.code, error.message], ["request_in_progress", words]);
  assert.equal(polled.cloud.calls.length, 4, "the first call and three polls");
  assert.equal(new Set(polled.cloud.calls.map(c => c.key)).size, 1);

  const timed = await directProxy({ inProgressWaitMostMs:200, inProgressPollsMost:100, backoff:() => 60 });
  timed.cloud.script(Array(100).fill(IN_PROGRESS));
  const started = Date.now(), byTime = await call(timed.source), took = Date.now() - started;
  assert.equal(byTime.status, 504);
  assert.equal(JSON.parse(byTime.body).error.code, "request_in_progress");
  assert.ok(took >= 190 && took < 3000, `stopped at the time limit, took ${took} ms`);
  assert.ok(timed.cloud.calls.length >= 3 && timed.cloud.calls.length < 10);
  assert.equal(new Set(timed.cloud.calls.map(c => c.key)).size, 1);
  assert.doesNotMatch(byTime.body, /tried 8 times/);
});

// A Cloud that sends a keepalive and, after delayMs, an error inside the stream saying the call's answer is no longer there.
async function startReplayExpiredCloud(delayMs) {
  const calls = [], sockets = new Set();
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    calls.push({ key:String(req.headers["idempotency-key"] || "") });
    const anthropic = req.url.endsWith("/v1/messages");
    res.writeHead(200, { "content-type":"text/event-stream" });
    res.write(": keepalive\n\n");
    setTimeout(() => {
      const error = { code:"request_already_completed", message:"A request with this idempotency key has already completed; response bodies are not retained." };
      res.end(anthropic ? `event: error\ndata: ${JSON.stringify({ type:"error", error:{ type:error.code, message:error.message } })}\n\n` : `data: ${JSON.stringify({ error })}\n\n`);
    }, delayMs);
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin:`http://127.0.0.1:${server.address().port}`, calls, close() { for (const socket of sockets) socket.destroy(); return new Promise(done => server.close(() => done())); } };
}

test("an error event request_already_completed inside the stream is result_unavailable too, with or without headers already sent, and never a second key", async () => {
  for (const format of ["openai", "anthropic"]) {
    // Before the runner has its headers: a plain 409.
    const early = await signedIn({ format, cloud:await startReplayExpiredCloud(30), keepaliveMs:120_000 });
    const plain = await call(early.source, { format });
    assert.equal(plain.status, 409, format);
    assert.equal(JSON.parse(plain.body).error.code, "result_unavailable", format);
    assert.equal(early.cloud.calls.length, 1, "not tried again");
    assert.equal(early.retries.length, 0);
    // After: the proxy has sent 200 and its own keepalives, so the failure is one error event in the model's format.
    const late = await signedIn({ format, cloud:await startReplayExpiredCloud(300), keepaliveMs:50 });
    const streamed = await call(late.source, { format });
    assert.equal(streamed.status, 200, format);
    const data = streamed.body.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6))).at(-1);
    assert.equal((data.error || data).code || data.error?.code, "result_unavailable", format);
    assert.equal(late.cloud.calls.length, 1, "not tried again");
    assert.equal(new Set(late.cloud.calls.map(c => c.key)).size, 1, "never a second billing key");
    assert.doesNotMatch(streamed.body, /not retained/, "Cloud's own words are not passed on");
  }
});

// ---- The recovery wait is one budget, from the first try that heard request_in_progress; Retry-After is never clipped. ----
const TIMED_OUT = "The earlier model call on PenEcho Cloud did not finish in time.";
const inProgressError = (anthropic, extra = {}) => {
  const error = { code:"request_in_progress", message:"A request with this idempotency key is still running.", ...extra };
  return anthropic ? `event: error\ndata: ${JSON.stringify({ type:"error", error:{ type:error.code, ...error } })}\n\n` : `data: ${JSON.stringify({ error })}\n\n`;
};
// A Cloud whose every call is `handler(res, n, anthropic)`: it answers each POST itself and records the idempotency key.
async function startScriptedCloud(handler) {
  const calls = [], sockets = new Set();
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    calls.push({ key:String(req.headers["idempotency-key"] || ""), at:Date.now() });
    handler(res, calls.length, req.url.endsWith("/v1/messages"));
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const cloud = { origin:`http://127.0.0.1:${server.address().port}`, calls, close() { for (const socket of sockets) socket.destroy(); return new Promise(done => server.close(() => done())); } };
  closing.push(() => cloud.close());
  return cloud;
}
async function proxyFor(cloud, { format = "openai", ...options } = {}) {
  const proxy = createModelProxy({
    connect:async () => ({ apiFormat:format, apiUrl:`${cloud.origin}/api/v1/hosted`, apiKey:"account-token", apiModel:MODEL, hosted:true }),
    describe:async (connection, { baseURL }) => ({ provider:"api", model:connection.apiModel, apiKeyEnv:"K", config:{ baseURL } }),
    target:async connection => connection.apiUrl,
    backoff:() => 20, ...options,
  });
  closing.push(() => proxy.close());
  await proxy.listening;
  return proxy;
}

test("a valid Retry-After (11, 30 and 60 s) is waited in full, never clipped to the 10 s ramp", async () => {
  const { cloud, source, retries } = await signedIn({ backoff:undefined });
  for (const seconds of [11, 30, 60]) {
    cloud.script([{ ...IN_PROGRESS, retryAfter:seconds }]); retries.length = 0;
    const stop = new AbortController();
    const pending = call(source, { signal:stop.signal }).catch(() => null);
    await until(() => retries.length === 1, `the wait for Retry-After ${seconds}`);
    assert.equal(retries[0].waitMs, seconds * 1000, `Retry-After ${seconds} is waited as asked`);
    assert.equal(cloud.calls.length, 1, "no poll before Retry-After");
    stop.abort();
    await pending;
    await wait(100);
    assert.equal(cloud.calls.length, 1, "the person gave up: nothing more is asked");
  }
  // Without a Retry-After the ramp alone is gentle and capped at 10 s; a short Retry-After never goes below it.
  cloud.script([{ ...IN_PROGRESS, retryAfter:0 }, ...Array(6).fill({ ...IN_PROGRESS, retryAfter:0 })]); retries.length = 0;
  const stop = new AbortController();
  const ramped = call(source, { signal:stop.signal }).catch(() => null);
  await until(() => retries.length === 1, "the first ramp step");
  assert.equal(retries[0].waitMs, 2000);
  stop.abort(); await ramped;
});

test("a Retry-After longer than the time left in the recovery budget ends the call cleanly, without an early poll", async () => {
  const cloud = await startFakeModelCloud({ script:[{ ...IN_PROGRESS, retryAfter:3 }] });
  closing.push(() => cloud.close());
  const proxy = await proxyFor(cloud, { inProgressWaitMostMs:1500 });
  const started = Date.now(), answer = await call({ open:o => proxy.open(o) });
  assert.equal(answer.status, 504);
  assert.deepEqual([JSON.parse(answer.body).error.code, JSON.parse(answer.body).error.message], ["request_in_progress", TIMED_OUT]);
  assert.equal(cloud.calls.length, 1, "not polled before the 3 seconds Cloud asked for");
  assert.ok(Date.now() - started < 1000, "ended at once, did not sit out the budget");
  // After a first wait, a later Retry-After that no longer fits ends the same way.
  cloud.script([{ ...IN_PROGRESS, retryAfter:1 }, { ...IN_PROGRESS, retryAfter:5 }, "ok"]);
  const tight = await proxyFor(cloud, { inProgressWaitMostMs:2600 });
  const second = await call({ open:o => tight.open(o) });
  assert.equal(second.status, 504);
  assert.equal(JSON.parse(second.body).error.code, "request_in_progress");
  assert.equal(cloud.calls.length, 2, "the second poll heard Retry-After 5 with under a second left, and did not poll again");
  assert.equal(new Set(cloud.calls.map(c => c.key)).size, 1);
});

test("Cloud's keepalive wait before request_in_progress counts against the recovery budget, and a retry stream cannot run past it", async () => {
  for (const format of ["openai", "anthropic"]) {
    // One Cloud held for 250 ms with keepalives and then said retry_after_seconds: the 250 ms are already spent.
    const held = await startScriptedCloud((res, n, isAnthropic) => {
      res.writeHead(200, { "content-type":"text/event-stream" }); res.write(": keepalive\n\n");
      const beat = setInterval(() => res.write(": keepalive\n\n"), 50);
      setTimeout(() => { clearInterval(beat); res.end(inProgressError(isAnthropic, { retry_after_seconds:0.1 })); }, 250);
    });
    const proxy = await proxyFor(held, { format, inProgressWaitMostMs:600 });
    const started = Date.now(), first = await call({ open:o => proxy.open(o) }, { format });
    const took = Date.now() - started;
    assert.equal(first.status, 504, format);
    assert.equal(JSON.parse(first.body).error.code, "request_in_progress", format);
    assert.equal(held.calls.length, 1, `${format}: no second keepalive stream after the budget is spent`);
    assert.ok(took >= 550 && took < 1400, `${format}: ended at the 600 ms budget from the first try, took ${took} ms`);

    // A hint that does not fit the time left is not polled early at all.
    const hinted = await startScriptedCloud((res, n, isAnthropic) => {
      res.writeHead(200, { "content-type":"text/event-stream" }); res.write(": keepalive\n\n");
      setTimeout(() => res.end(inProgressError(isAnthropic, { details:{ retryAfterSeconds:30 } })), 100);
    });
    const hintedProxy = await proxyFor(hinted, { format, inProgressWaitMostMs:1000 });
    const gaveUp = Date.now(), second = await call({ open:o => hintedProxy.open(o) }, { format });
    assert.equal(second.status, 504, format);
    assert.equal(hinted.calls.length, 1, `${format}: details.retryAfterSeconds 30 is longer than the budget`);
    assert.ok(Date.now() - gaveUp < 900, "ended at once");

    // No hint: the next stream is the retry after a short backoff, and it is cut at the deadline, keepalives or not.
    const endless = await startScriptedCloud((res, n, isAnthropic) => {
      res.writeHead(200, { "content-type":"text/event-stream" }); res.write(": keepalive\n\n");
      if (n === 1) return setTimeout(() => res.end(inProgressError(isAnthropic)), 50);
      const beat = setInterval(() => res.write(": keepalive\n\n"), 30);
      res.on("close", () => clearInterval(beat));
    });
    const endlessProxy = await proxyFor(endless, { format, inProgressWaitMostMs:700 });
    const begun = Date.now(), cutOff = await call({ open:o => endlessProxy.open(o) }, { format });
    const spent = Date.now() - begun;
    assert.equal(endless.calls.length, 2, format);
    assert.equal(new Set(endless.calls.map(c => c.key)).size, 1, `${format}: one key`);
    assert.ok(spent >= 650 && spent < 1600, `${format}: the retry stream was cut at the deadline, took ${spent} ms`);
    assert.equal(cutOff.status === 504 || cutOff.body.includes("request_in_progress"), true, format);
    assert.match(cutOff.body, /did not finish in time/);
  }
});

test("alternating request_in_progress, 503 and cut answers keep one key, use at most TRIES failures, and end inside the recovery budget", async () => {
  const pattern = [IN_PROGRESS, { status:503 }, IN_PROGRESS, "cut"];
  // Failures alone end it: 8 of them, however the in-progress waits are woven between.
  const failing = await directProxy({ script:[...Array(4).fill(pattern).flat(), ...Array(20).fill("ok")], backoff:() => 15 });
  const failed = await call(failing.source);
  assert.notEqual(failed.status, 200);
  assert.equal(failing.cloud.calls.length, 16, "8 failures and the 8 in-progress waits between them");
  assert.equal(new Set(failing.cloud.calls.map(c => c.key)).size, 1, "one immutable idempotency key");
  assert.equal(failing.cloud.calls.filter(c => c.step && c.step.status === 409).length, 8);
  assert.match(JSON.parse(failed.body).error.message, /PenEcho tried 8 times\.$/);
  // The recovery budget ends it first when the waits are long enough.
  const budget = await directProxy({ script:Array(100).fill([IN_PROGRESS, { status:503 }]).flat(), inProgressWaitMostMs:400, backoff:() => 60 });
  const started = Date.now(), ended = await call(budget.source), took = Date.now() - started;
  assert.equal(ended.status, 504);
  assert.equal(JSON.parse(ended.body).error.code, "request_in_progress");
  assert.ok(took >= 380 && took < 1500, `ended at the budget, took ${took} ms`);
  const asked = budget.cloud.calls.length;
  assert.ok(asked >= 4 && asked < 16, `${asked} calls`);
  assert.equal(new Set(budget.cloud.calls.map(c => c.key)).size, 1);
  await wait(200);
  assert.equal(budget.cloud.calls.length, asked, "no poll after the budget ended");
  // A socket cut in the middle of the weave counts as a failure and keeps the key too.
  const weave = await directProxy({ script:[IN_PROGRESS, "reset", IN_PROGRESS, "refuse", IN_PROGRESS, "ok"], backoff:() => 15 });
  const done = await call(weave.source);
  assert.equal(done.status, 200);
  assert.equal(weave.cloud.calls.length, 6);
  assert.equal(new Set(weave.cloud.calls.map(c => c.key)).size, 1);
});

test("closing the runner's socket, or the proxy, while the model catalog or the address is still being looked up sends nothing to Cloud", async () => {
  for (const gate of ["connect", "target", "proxy-closes"]) {
    const cloud = await startFakeModelCloud({});
    closing.push(() => cloud.close());
    let release = () => {}, reached = false;
    const gated = new Promise(resolve => { release = resolve; });
    const proxy = createModelProxy({
      connect:async () => { if (gate === "connect" || gate === "proxy-closes") { reached = true; await gated; } return { apiFormat:"openai", apiUrl:`${cloud.origin}/api/v1/hosted`, apiKey:"account-token", apiModel:MODEL, hosted:true }; },
      describe:async (connection, { baseURL }) => ({ provider:"api", model:connection.apiModel, apiKeyEnv:"K", config:{ baseURL } }),
      target:async connection => { if (gate === "target") { reached = true; await gated; } return connection.apiUrl; },
      backoff:() => 20,
    });
    closing.push(() => proxy.close());
    await proxy.listening;
    const run = proxy.open({}), stop = new AbortController();
    const pending = fetch(`${run.url}/model/chat/completions`, { method:"POST", signal:stop.signal, headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json" }, body:JSON.stringify({ model:"x", messages:[{ role:"user", content:"hi" }], stream:true }) }).then(r => r.text(), () => "");
    await until(() => reached, `${gate} to be asked`);
    if (gate === "proxy-closes") { void proxy.close(); await wait(100); } else { stop.abort(); await wait(150); }
    release();
    await pending;
    await wait(250);
    assert.equal(cloud.calls.length, 0, `${gate}: nothing was sent to Cloud for a call nobody is waiting for`);
  }
});

test("Round 2 P1/P2: recovery deadline bounds connect()/target() preparation and PASS_BACK preserves replay headers", async () => {
  for (const slow of ["connect", "target"]) {
    const cloud = await startFakeModelCloud({ script:[IN_PROGRESS, "ok"] });
    closing.push(() => cloud.close());
    let calls = 0, release = () => {};
    const proxy = createModelProxy({
      connect:async () => {
        calls++;
        if (slow === "connect" && calls === 2) await new Promise(resolve => { release = resolve; });
        return { apiFormat:"openai", apiUrl:`${cloud.origin}/api/v1/hosted`, apiKey:"account-token", apiModel:MODEL, hosted:true };
      },
      describe:async (connection, { baseURL }) => ({ provider:"api", model:connection.apiModel, apiKeyEnv:"K", config:{ baseURL } }),
      target:async connection => {
        if (slow === "target" && calls === 2) await new Promise(resolve => { release = resolve; });
        return connection.apiUrl;
      },
      backoff:() => 15,
      inProgressWaitMostMs:150,
    });
    closing.push(() => proxy.close());
    await proxy.listening;
    const run = proxy.open({}), started = Date.now();
    const res = await fetch(`${run.url}/model/chat/completions`, { method:"POST", headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json" }, body:JSON.stringify({ model:"x", messages:[{ role:"user", content:"hi" }], stream:true }) });
    const body = await res.text(), took = Date.now() - started;
    release();
    assert.equal(res.status, 504, slow);
    assert.equal(JSON.parse(body).error.code, "request_in_progress", slow);
    assert.ok(took < 1000, `${slow}: deadline aborted stalled preparation in ${took}ms`);
    await wait(120);
    assert.equal(cloud.calls.length, 1, `${slow}: zero late Cloud POSTs after deadline expired during preparation`);
  }
  // Unopened response preserves Cloud's replay attribution headers.
  const stub = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type":"application/json", "x-penecho-request-id":"req-replay-1", "x-penecho-charged-credits":"1.5", "x-penecho-idempotent-replay":"1" });
    res.end(JSON.stringify({ id:"ok", choices:[{ message:{ role:"assistant", content:"replayed" }, finish_reason:"stop" }] }));
  });
  await new Promise(resolve => stub.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise(resolve => stub.close(resolve)));
  const proxy = createModelProxy({
    connect:async () => ({ apiFormat:"openai", apiUrl:`http://127.0.0.1:${stub.address().port}`, apiKey:"tok", apiModel:MODEL, hosted:true }),
    describe:async (c, { baseURL }) => ({ provider:"api", model:c.apiModel, apiKeyEnv:"K", config:{ baseURL } }),
    target:async c => c.apiUrl,
  });
  closing.push(() => proxy.close());
  await proxy.listening;
  const run = proxy.open({});
  const res = await fetch(`${run.url}/model/chat/completions`, { method:"POST", headers:{ authorization:`Bearer ${run.secret}`, "content-type":"application/json" }, body:JSON.stringify({ model:"x", messages:[{ role:"user", content:"hi" }], stream:false }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-penecho-request-id"), "req-replay-1");
  assert.equal(res.headers.get("x-penecho-charged-credits"), "1.5");
  assert.equal(res.headers.get("x-penecho-idempotent-replay"), "1");
});
