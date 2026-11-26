"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { test, after } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createAgentCheck } = require("../src/server/project-lines/agent-check.js");
const { modelOf } = require("../src/server/project-lines/agent-model.js");
const { parseLine } = require("../src/server/project-lines/activity.js");
const { createPenEchoSource } = require("../src/server/agent-core/penecho-source.js");
const { checkCommand, RUN_COMMANDS } = require("../src/server/agent-core/run-commands.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pe-runner-")));
const loadRunner = () => import("../src/server/project-lines/penecho-runner.mjs");
const closing = [];
after(async () => { for (const close of closing) await close(); fs.rmSync(temp, { recursive:true, force:true }); });
const REAL_KEY = "sk-real-own-key-0123456789", ACCOUNT_TOKEN = "account-token-abcdef";

// A model that answers from a script: each request gets the next step, as tool calls or as words.
function stubModel(steps, format = "openai") {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const request = { url:req.url, method:req.method, headers:req.headers, body:JSON.parse(body || "{}") };
      requests.push(request);
      const step = steps[Math.min(requests.length - 1, steps.length - 1)], model = request.body.model, base = { id:`chatcmpl-${requests.length}`, object:"chat.completion.chunk", created:1, model };
      if (step.hold) return step.hold();
      if (step.status) { res.writeHead(step.status, { "content-type":"application/json" }); return res.end(JSON.stringify({ error:{ message:step.message } })); }
      if (format === "anthropic") {
        const block = step.tool ? { type:"tool_use", id:`toolu_${requests.length}`, name:step.tool, input:{} } : { type:"text", text:"" };
        const delta = step.tool ? { type:"input_json_delta", partial_json:JSON.stringify(step.args) } : { type:"text_delta", text:step.text };
        const events = [
          { type:"message_start", message:{ id:`msg_${requests.length}`, type:"message", role:"assistant", model, content:[], stop_reason:null, stop_sequence:null, usage:{ input_tokens:30, output_tokens:1 } } },
          { type:"content_block_start", index:0, content_block:block },
          { type:"content_block_delta", index:0, delta },
          { type:"content_block_stop", index:0 },
          { type:"message_delta", delta:{ stop_reason:step.length ? "max_tokens" : step.tool ? "tool_use" : "end_turn", stop_sequence:null }, usage:{ output_tokens:25 } },
          { type:"message_stop" },
        ];
        res.writeHead(200, { "content-type":"text/event-stream" });
        return res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
      }
      const chunks = step.tool
        ? [{ ...base, choices:[{ index:0, delta:{ role:"assistant", tool_calls:[{ index:0, id:`call_${requests.length}`, type:"function", function:{ name:step.tool, arguments:JSON.stringify(step.args) } }] }, finish_reason:null }] }, { ...base, choices:[{ index:0, delta:{}, finish_reason:"tool_calls" }] }]
        : [{ ...base, choices:[{ index:0, delta:{ role:"assistant", content:step.text }, finish_reason:null }] }, { ...base, choices:[{ index:0, delta:{}, finish_reason:"stop" }] }];
      if (step.usage) chunks.push({ ...base, choices:[], usage:step.usage });
      res.writeHead(200, { "content-type":"text/event-stream" });
      res.end(`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`);
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
    closing.push(() => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); }));
    resolve({ requests, url:`http://127.0.0.1:${server.address().port}/v1` });
  }));
}
function cloudSourceFor(url, apiFormat = "openai") {
  const hostedCatalog = { models:[{ id:"stub-model", apiFormat, worker:true }] };
  const connector = {
    hostedCatalog,
    status:() => ({ accountSession:{ signedIn:true } }),
    refreshHostedCatalog:async () => hostedCatalog,
    hostedModels:async () => ({ ...hostedCatalog, credits:100 }),
    prepareHostedConnection:async id => ({ id, provider:"api", apiFormat, apiUrl:url, apiModel:id.slice(7), apiKey:ACCOUNT_TOKEN, hosted:true }),
  };
  return createPenEchoSource({ cloud:() => connector });
}
const userLine = text => `${JSON.stringify({ type:"user", message:{ role:"user", content:[{ type:"text", text }] } })}\n`;
// One run the way PenEcho starts it: words in as a JSON line, its input closed once it gives its result.
function runOnce(command, env, words, onSpawn) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, { cwd:command.cwd, env:{ ...env, ...command.env }, windowsHide:true, stdio:["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`The run did not end.\n${stdout}\n${stderr}`)); }, 60000);
    child.stdout.on("data", chunk => { stdout += chunk; if (/"type":"result"/.test(stdout) && !child.stdin.writableEnded) child.stdin.end(); });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => { clearTimeout(timer); resolve({ code, stderr, lines:stdout.split("\n").filter(Boolean).map(line => JSON.parse(line)), raw:stdout.split("\n").filter(Boolean) }); });
    onSpawn?.(child);
    child.stdin.write(userLine(words));
  });
}
const toolResults = lines => lines.filter(line => line.type === "user").flatMap(line => line.message.content);

test("PenEcho emits per-request measured usage with stable IDs for the local token evidence", async () => {
  const workdir=path.join(temp,"usage-work"),docs=path.join(temp,"usage-docs"),state=path.join(temp,"usage-state");
  fs.mkdirSync(workdir,{recursive:true});fs.mkdirSync(docs,{recursive:true});
  const model=await stubModel([{text:"OK.",usage:{prompt_tokens:320,completion_tokens:40,total_tokens:360,prompt_tokens_details:{cached_tokens:120}}}]);
  const source=cloudSourceFor(model.url);
  closing.push(()=>source.close());await source.listening;
  const agents=createAgents({env:process.env,paths:{penecho:source,stateDir:state},appFolders:[]});
  const command=agents.command("penecho",{workdir,docs,resume:null,instructions:"Reply OK."});
  const run=await runOnce(command,process.env,"Say OK.");assert.equal(run.code,0,run.stderr);
  const messages=run.lines.filter(r=>r.type === "assistant" && r.message.usage);
  assert.equal(messages.length,1);assert.equal(messages[0].usage_format,"harness");assert.ok(messages[0].message.id);
  const { normalize }=require("../src/server/project-lines/token-evidence.js");
  const usage=normalize(messages[0].message.usage,"harness");
  assert.equal(usage.inputTokens,320,JSON.stringify(messages[0].message.usage));assert.equal(usage.outputTokens,40);assert.equal(usage.cacheReadInputTokens,120);
});

test("a run with the PenEcho agent writes inside its folders only, speaks Claude's JSON lines and holds no key", async t => {
  const { findBash } = await loadRunner();
  if (!findBash()) return t.skip("requires Bash");
  const workdir = path.join(temp, "work"), docs = path.join(temp, "docs"), outside = path.join(temp, "outside"), state = path.join(temp, "state");
  for (const dir of [workdir, docs, outside, state]) fs.mkdirSync(dir, { recursive:true });
  const model = await stubModel([
    { tool:"write", args:{ file_path:"notes/inside.txt", content:"made by PenEcho\n" } },
    { tool:"write", args:{ file_path:path.join(outside, "escape.txt"), content:"no\n" } },
    { tool:"write", args:{ file_path:path.join(docs, "topics.md"), content:"docs are allowed\n" } },
    { tool:"bash", args:{ command:"env" } },
    { tool:"bash", args:{ command:`echo no > '${path.join(outside, "shell.txt")}'` } },
    { tool:"bash", args:{ command:"node -e \"for (const [k, v] of Object.entries(process.env)) console.log(k + '=' + v)\" && cat notes/inside.txt" } },
    { text:"OK. Wrote notes/inside.txt." },
  ]);
  const source = cloudSourceFor(model.url);
  closing.push(() => source.close());
  await source.listening;
  // PenEcho's own environment holds the first connection's key, as the real server's does.
  const env = { ...process.env, AI_API_KEY:REAL_KEY, OPENAI_API_KEY:REAL_KEY, PENECHO_ACCOUNT_TOKEN:ACCOUNT_TOKEN, PATH:process.env.PATH, HOME:process.env.HOME };
  const agents = createAgents({ env, paths:{ penecho:source, stateDir:state }, appFolders:[] });
  const listed = agents.available().find(agent => agent.id === "penecho");
  assert.deepEqual([listed.available, listed.runs, listed.name], [true, true, "PenEcho"], "here with no command line installed");
  assert.equal(agents.available().at(-1).id, "penecho", "last, so an agent you installed stays the first choice");

  const command = agents.command("penecho", { workdir, docs, gitDir:"", also:[], resume:null, instructions:"Project instructions: say OK when done.", name:"A line" });
  assert.deepEqual([command.input, command.ownInstructions, command.dialect], ["stream-json", true, undefined], "Claude's JSON lines both ways");
  const secret = command.env.PENECHO_MODEL_PROXY_SECRET;
  assert.ok(secret.length >= 40 && command.env.PENECHO_MODEL_PROXY_URL.startsWith("http://127.0.0.1:"));
  assert.doesNotMatch(JSON.stringify([command.args, command.env]), new RegExp(`${REAL_KEY}|${ACCOUNT_TOKEN}`), "no key in its command or its environment");
  assert.deepEqual([command.env.AI_API_KEY, command.env.OPENAI_API_KEY, command.env.PENECHO_ACCOUNT_TOKEN], ["", "", ""], "PenEcho's own keys are blanked for it");

  const run = await runOnce(command, env, "Write the note, then say OK.");
  assert.equal(run.code, 0, run.stderr);
  // The thread's own parser reads every line.
  const changes = run.raw.flatMap(line => parseLine(line));
  assert.ok(!changes.some(change => change.add?.kind === "note"), "no line it could not read");
  const init = run.lines[0];
  assert.deepEqual([init.type, init.subtype], ["system", "init"]);
  assert.match(init.session_id, /^[0-9a-f-]{36}$/);
  assert.equal(changes.find(change => change.session).session, init.session_id);
  const tools = changes.filter(change => change.add?.kind === "tool").map(change => `${change.add.verb} ${change.add.target}`);
  assert.deepEqual(tools.slice(0, 2), ["Wrote notes/inside.txt", `Wrote ${path.join(outside, "escape.txt")}`]);
  assert.ok(tools.includes("Ran env"));
  const end = changes.at(-1);
  assert.deepEqual([end.turnEnd, end.session, "failed" in end], [true, init.session_id, false]);
  assert.equal(run.lines.at(-1).result, "OK. Wrote notes/inside.txt.");

  // Files: inside the working folder and the docs folder, nowhere else.
  assert.equal(fs.readFileSync(path.join(workdir, "notes", "inside.txt"), "utf8"), "made by PenEcho\n");
  assert.equal(fs.readFileSync(path.join(docs, "topics.md"), "utf8"), "docs are allowed\n");
  assert.deepEqual(fs.readdirSync(outside), [], "nothing was written outside");
  const results = toolResults(run.lines);
  assert.deepEqual(results.map(result => Boolean(result.is_error)), [false, true, false, true, true, false]);
  assert.match(results[3].content, /env is not a command unattended runs may use/, "the same list unattended Claude runs get");
  assert.match(results[1].content, /outside the folders this run may use/);
  assert.match(results[4].content, /outside this run's folders/);

  // What a command sees: no key, no token, not even the run's own secret.
  const shown = results[5].content;
  assert.match(shown, /^PATH=/im);
  assert.doesNotMatch(shown, new RegExp(`${REAL_KEY}|${ACCOUNT_TOKEN}|${secret}`));
  assert.doesNotMatch(shown, /KEY|TOKEN|SECRET|PENECHO_MODEL_PROXY/);
  assert.match(results[5].content, /made by PenEcho/);

  // The model got the Cloud credential from the proxy, and PenEcho's instructions with the person's words.
  assert.equal(model.requests.length, 7);
  for (const request of model.requests) {
    assert.equal(request.headers.authorization, `Bearer ${ACCOUNT_TOKEN}`);
    assert.deepEqual([request.method, request.url, request.body.model], ["POST", "/v1/chat/completions", "stub-model"]);
  }
  const first = JSON.stringify(model.requests[0].body.messages);
  assert.match(first, /Project instructions: say OK when done\./);
  assert.match(first, /Write the note, then say OK\./);
  assert.deepEqual(model.requests[0].body.tools.map(tool => tool.function.name).sort(), ["bash", "edit", "list", "read", "write"]);

  // Carried on later by a new process: the same conversation, with what was said before and the instructions it began with.
  const again = agents.command("penecho", { workdir, docs, gitDir:"", also:[], resume:init.session_id, instructions:"" });
  assert.equal(again.args[again.args.indexOf("--resume") + 1], init.session_id);
  assert.notEqual(again.env.PENECHO_MODEL_PROXY_SECRET, secret, "a secret of its own for every run");
  const second = await runOnce(again, env, "And one more thing.");
  assert.equal(second.code, 0, second.stderr);
  assert.equal(second.lines[0].session_id, init.session_id);
  const carried = JSON.stringify(model.requests.at(-1).body.messages);
  assert.match(carried, /Write the note, then say OK\./);
  assert.match(carried, /And one more thing\./);
  assert.match(carried, /Project instructions: say OK when done\./);

  // The proxy answers a run's own secret and nothing else, and passes on only model requests.
  const base = again.env.PENECHO_MODEL_PROXY_URL;
  const ended = await fetch(`${base}/profile`, { headers:{ authorization:`Bearer ${again.env.PENECHO_MODEL_PROXY_SECRET}` } });
  assert.equal(ended.status, 401, "a finished run's secret is forgotten");
  const live = agents.command("penecho", { workdir, docs, gitDir:"", also:[] }), key = { authorization:`Bearer ${live.env.PENECHO_MODEL_PROXY_SECRET}` };
  assert.equal((await fetch(`${live.env.PENECHO_MODEL_PROXY_URL}/profile`, { headers:{ authorization:"Bearer wrong" } })).status, 401);
  const profile = await (await fetch(`${live.env.PENECHO_MODEL_PROXY_URL}/profile`, { headers:key })).json();
  assert.equal(profile.model, "stub-model");
  assert.ok(profile.config.baseURL.startsWith(live.env.PENECHO_MODEL_PROXY_URL), "the only address it is given is the proxy's");
  assert.doesNotMatch(JSON.stringify(profile), new RegExp(`${REAL_KEY}|${ACCOUNT_TOKEN}|${model.url}`));
  for (const rest of ["/model/models", "/model/v1/messages", "/model/../../api/v1/credits"]) assert.notEqual((await fetch(`${live.env.PENECHO_MODEL_PROXY_URL}${rest}`, { method:"POST", headers:{ ...key, "content-type":"application/json" }, body:"{}" })).status, 200, rest);
  assert.equal(model.requests.length, 8, "none of those reached the model");
});

test("words said while it works join its turn, and Stop ends it with the command it was running", async t => {
  const { findBash } = await loadRunner();
  if (!findBash()) return t.skip("requires Bash");
  const workdir = path.join(temp, "steer"); fs.mkdirSync(workdir, { recursive:true });
  const wait = "node -e \"require('fs').writeFileSync('pid.txt', String(process.pid)); setTimeout(() => {}, 60000)\"";
  const model = await stubModel([{ tool:"bash", args:{ command:"node -e \"setTimeout(() => {}, 1200)\"" } }, { tool:"bash", args:{ command:wait } }, { text:"never reached" }]);
  const source = cloudSourceFor(model.url);
  closing.push(() => source.close());
  await source.listening;
  const env = { PATH:process.env.PATH, HOME:process.env.HOME, SystemRoot:process.env.SystemRoot, USERPROFILE:process.env.USERPROFILE }, agents = createAgents({ env, paths:{ penecho:source, stateDir:path.join(temp, "state") }, appFolders:[] });
  const command = agents.command("penecho", { workdir, docs:workdir, also:[] });
  const child = spawn(command.command, command.args, { cwd:command.cwd, env:{ ...env, ...command.env }, windowsHide:true, stdio:["pipe", "pipe", "pipe"] });
  let stdout = "", steered = false;
  const closed = new Promise(resolve => child.on("close", (code, signal) => resolve({ code, signal })));
  const pidFile = path.join(workdir, "pid.txt");
  child.stdout.on("data", chunk => {
    stdout += chunk;
    // Said while its first command runs.
    if (!steered && /"tool_use"/.test(stdout)) { steered = true; child.stdin.write(userLine("Also keep it short.")); }
  });
  child.stdin.write(userLine("Start."));
  const until = async (what, ms = 20000) => { const start = Date.now(); while (!what()) { if (Date.now() - start > ms) throw new Error(`Timed out.\n${stdout}`); await new Promise(r => setTimeout(r, 25)); } };
  await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8"));
  const pid = Number(fs.readFileSync(pidFile, "utf8")), alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(), true);
  assert.match(JSON.stringify(model.requests[1].body.messages), /Also keep it short\./, "the words joined the turn it was on");
  // Stop, as PenEcho's thread does it.
  if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio:"ignore", windowsHide:true });
  else child.kill();
  const exit = await closed;
  assert.notEqual(exit.code, 0);
  await until(() => !alive(), 5000);
  assert.equal(model.requests.length, 2, "nothing more was asked of the model");
  assert.equal(source.models().name, "stub-model");
});

test("the local runner lists scoped directories and continues a hosted answer once after truncation", async () => {
  const { findBash } = await loadRunner();
  const hasBash = Boolean(findBash());
  const workdir = path.join(temp, "local discovery"), docs = path.join(temp, "project docs"), outside = path.join(temp, "unlisted");
  for (const dir of [workdir, docs, outside]) fs.mkdirSync(dir);
  fs.symlinkSync(outside, path.join(workdir, "linked"), "junction");
  fs.writeFileSync(path.join(outside, "private.txt"), "private");
  fs.writeFileSync(path.join(workdir, "source.txt"), "benchmark evidence");
  for (let i = 0; i < 201; i++) fs.writeFileSync(path.join(docs, `entry-${String(i).padStart(3, "0")}.txt`), "");
  const output = path.join(docs, "result.txt");
  const model = await stubModel([
    { tool:"list", args:{} },
    { tool:"list", args:{ file_path:outside } },
    { tool:"list", args:{ file_path:"../unlisted" } },
    { tool:"list", args:{ file_path:"linked" } },
    { tool:"list", args:{ file_path:docs } },
    { tool:"list", args:{ file_path:docs, offset:200 } },
    { tool:"read", args:{ file_path:"source.txt", limit:1 } },
    { tool:"write", args:{ file_path:output, content:"Created from benchmark evidence." } },
    { text:"I will finish the report", length:true },
    { text:"The report is ready." },
  ], "anthropic");
  const source = cloudSourceFor(model.url, "anthropic");
  closing.push(() => source.close());
  await source.listening;
  const env = { PATH:process.env.PATH, SystemRoot:process.env.SystemRoot, AI_API_KEY:REAL_KEY, PENECHO_ACCOUNT_TOKEN:ACCOUNT_TOKEN };
  const agents = createAgents({ env, paths:{ penecho:source, stateDir:path.join(temp, "discovery-state") }, appFolders:[] });
  const run = await runOnce(agents.command("penecho", { workdir, docs }), env, "Find the benchmark and produce a report.");
  assert.equal(run.code, 0, run.stderr || run.lines.at(-1)?.result);
  const [first] = model.requests;
  assert.match(first.url, /\/messages$/);
  assert.deepEqual(first.body.tools.map(tool => tool.name).sort(), [...(hasBash ? ["bash"] : []), "edit", "list", "read", "write"]);
  assert.equal(run.lines[0].tools.includes("Bash"), hasBash);
  assert.equal(run.lines[0].tools.includes("List"), true);
  assert.equal(JSON.stringify(first.body.system).includes("bash runs foreground"), hasBash);
  assert.match(JSON.stringify(first.body.system), /Use list to discover files/);
  assert.doesNotMatch(JSON.stringify(first.body), new RegExp(`${REAL_KEY}|${ACCOUNT_TOKEN}`));
  const results = toolResults(run.lines);
  assert.deepEqual(results.map(r => Boolean(r.is_error)), [false, true, true, true, false, false, false, false]);
  assert.match(results[0].content, /link\s+"linked"/);
  assert.match(results[0].content, /file\s+"source.txt"/);
  for (const denied of results.slice(1, 4)) assert.match(denied.content, /outside the folders this run may use/);
  assert.doesNotMatch(JSON.stringify(results), /private\.txt/);
  assert.match(results[4].content, /offset 200/);
  assert.doesNotMatch(results[4].content, /entry-200/);
  assert.match(results[5].content, /entry-200/);
  assert.match(results[6].content, /benchmark evidence/);
  assert.equal(fs.readFileSync(output, "utf8"), "Created from benchmark evidence.");
  assert.ok(run.raw.flatMap(line => parseLine(line)).some(change => change.add?.verb === "Listed" && change.add.target === "."));
  assert.equal(model.requests.length, 10);
  assert.match(JSON.stringify(model.requests.at(-1).body.messages), /The previous response reached its output limit/);
  assert.match(JSON.stringify(model.requests.at(-1).body.messages), /Created from benchmark evidence/);
  assert.equal(run.lines.filter(line => line.subtype === "retry").length, 1);
  assert.deepEqual(run.lines.filter(line => line.type === "result").map(line => [line.is_error, line.result]), [[false, "The report is ready."]]);
});

test("the runner stops after a second truncated answer or a truncated tool call", async () => {
  const workdir = path.join(temp, "output limits");
  fs.mkdirSync(workdir);
  const output = path.join(workdir, "unfinished.txt");
  for (const scenario of [
    { steps:[{ text:"Still working", length:true }], requests:2, retries:1 },
    { steps:[{ tool:"write", args:{ file_path:output, content:"must not run" }, length:true }], requests:1, retries:0 },
  ]) {
    const model = await stubModel(scenario.steps, "anthropic");
    const source = cloudSourceFor(model.url, "anthropic");
    closing.push(() => source.close());
    await source.listening;
    const env = { ...process.env };
    const agents = createAgents({ env, paths:{ penecho:source, stateDir:path.join(temp, "output-state") }, appFolders:[] });
    const run = await runOnce(agents.command("penecho", { workdir, docs:workdir }), env, "Finish the report.");
    assert.equal(run.code, 1, run.stderr);
    assert.equal(model.requests.length, scenario.requests, run.stderr || run.lines.at(-1)?.result);
    assert.equal(run.lines.filter(line => line.subtype === "retry").length, scenario.retries);
    assert.equal(run.lines.filter(line => line.type === "result").length, 1);
    assert.equal(run.lines.at(-1).is_error, true);
    assert.match(run.lines.at(-1).result, /ran out of room/);
    assert.equal(run.lines.at(-1).result.includes("unfinished tool calls did not run"), scenario.retries === 0);
    assert.equal(fs.existsSync(output), false);
  }
});

test("Stop ends the runner while it is waiting for the output-limit continuation", async () => {
  const workdir = path.join(temp, "stop-recovery");
  fs.mkdirSync(workdir);
  let child;
  const model = await stubModel([{ text:"Incomplete answer", length:true }, { hold:() => child.kill() }], "anthropic");
  const source = cloudSourceFor(model.url, "anthropic");
  closing.push(() => source.close());
  await source.listening;
  const env = { PATH:process.env.PATH, SystemRoot:process.env.SystemRoot };
  const agents = createAgents({ env, paths:{ penecho:source, stateDir:path.join(temp, "stop-recovery-state") }, appFolders:[] });
  const run = await runOnce(agents.command("penecho", { workdir, docs:workdir }), env, "Produce a report.", started => { child = started; });
  assert.notEqual(run.code, 0);
  assert.equal(model.requests.length, 2);
  assert.equal(run.lines.filter(line => line.subtype === "retry").length, 1);
  assert.ok(!run.lines.some(line => line.type === "result" && !line.is_error));
});

test("a run that the model refuses ends as a failed result the thread can show", async () => {
  const workdir = path.join(temp, "refused"); fs.mkdirSync(workdir, { recursive:true });
  const model = await stubModel([{ status:402, message:"Not enough credits." }]);
  const source = cloudSourceFor(model.url);
  closing.push(() => source.close());
  await source.listening;
  const env = { PATH:process.env.PATH, HOME:process.env.HOME }, agents = createAgents({ env, paths:{ penecho:source, stateDir:path.join(temp, "state") }, appFolders:[] });
  const run = await runOnce(agents.command("penecho", { workdir, docs:workdir, also:[] }), env, "Hello");
  const end = parseLine(run.raw.at(-1))[0];
  assert.equal(end.turnEnd, true);
  assert.match(end.failed, /Not enough credits/);
  assert.notEqual(run.code, 0);
});

test("the built-in agent needs a Cloud account and accepts only its listed models", async () => {
  const state = path.join(temp, "state-models"); fs.mkdirSync(state, { recursive:true });
  const none = createPenEchoSource({});
  closing.push(() => none.close());
  await none.listening;
  const env = { PATH:"/usr/bin:/bin", HOME:temp };
  const without = createAgents({ env, paths:{ penecho:none, stateDir:state }, appFolders:[] });
  assert.equal(without.available().find(agent => agent.id === "penecho").available, false, "no account and no key");
  assert.equal(createAgents({ env, appFolders:[] }).available().find(agent => agent.id === "penecho").available, false, "and never without PenEcho's own source");
  const row = (await createAgentCheck(without, { env }).check()).agents.find(agent => agent.id === "penecho");
  assert.deepEqual([row.state, row.builtIn, row.problems[0].title], ["missing", true, "Not set up"]);

  // Signed in: only Cloud's models, in catalog order, even with a saved personal key.
  const catalog = { models:[{ id:"22222222-2222-4222-8222-222222222222", displayName:"PenEcho Deep", apiFormat:"anthropic", available:true, sortOrder:2 }, { id:"11111111-1111-4111-8111-111111111111", displayName:"PenEcho Fast", apiFormat:"openai", available:true, sortOrder:1 }, { id:"33333333-3333-4333-8333-333333333333", displayName:"Old", apiFormat:"openai", available:true, retiredAt:1 }] };
  const cloud = {
    hostedCatalog:null,
    status:() => ({ accountSession:{ signedIn:true } }),
    async refreshHostedCatalog() { this.hostedCatalog = catalog; return catalog; },
    async hostedModels() { await this.refreshHostedCatalog(); return { models:catalog.models, credits:{ availableCredits:1240 } }; },
    async prepareHostedConnection(id) { return { id, provider:"api", apiFormat:catalog.models.find(m => `hosted:${m.id}` === id).apiFormat, apiUrl:"https://cloud.test/api/v1/hosted", apiKey:ACCOUNT_TOKEN, apiModel:id.slice(7), effort:"medium", hosted:true }; },
  };
  const own = { id:"own", provider:"api", apiFormat:"openai", apiUrl:"https://api.example.test/v1", apiModel:"my-model", apiKey:REAL_KEY };
  catalog.models[0].supportsThinking = false;
  const source = createPenEchoSource({ cloud:() => cloud, connections:() => [own, { id:"cli", provider:"claude-cli" }] });
  closing.push(() => source.close());
  await source.listening;
  const agents = createAgents({ env, paths:{ penecho:source, stateDir:state }, appFolders:[] });
  agents.useModelFile(path.join(state, "agent-models.json"));
  const check = createAgentCheck(agents, { env, run:async () => ({ status:0, stdout:"1.5.0\n", stderr:"" }) });
  const ready = (await check.check()).agents.find(agent => agent.id === "penecho");
  assert.deepEqual([ready.state, ready.where, ready.model.name, ready.model.from], ["ready", "built in", "PenEcho Fast", "PenEcho Cloud"]);
  assert.deepEqual(ready.model.choices, ["PenEcho Fast", "PenEcho Deep"]);
  assert.deepEqual(ready.model.effortsFor["PenEcho Deep"], []);
  assert.match((await check.pickModel("penecho", { model:"PenEcho Deep", effort:"high" })).error, /does not take/);
  assert.deepEqual([ready.model.signedIn, ready.model.credits], [true, 1240]);
  assert.doesNotMatch(JSON.stringify(ready), new RegExp(`${REAL_KEY}|${ACCOUNT_TOKEN}|example\\.test`));
  assert.deepEqual(modelOf("penecho", env, source).choices, ready.model.choices);

  // What each pick runs on. The default runs on Cloud; a stale personal choice is rejected.
  const used = async pick => { const c = await source.connect(pick); return [c.hosted === true, c.apiModel, c.apiUrl]; };
  assert.deepEqual(await used(""), [true, "11111111-1111-4111-8111-111111111111", "https://cloud.test/api/v1/hosted"]);
  assert.deepEqual(await used("penecho deep"), [true, "22222222-2222-4222-8222-222222222222", "https://cloud.test/api/v1/hosted"]);
  await assert.rejects(used("my-model"), { code:"PENECHO_MODEL_UNKNOWN" });
  await assert.rejects(used("typed-by-hand"), { code:"PENECHO_MODEL_UNKNOWN" });
  assert.match((await check.pickModel("penecho", { model:"typed-by-hand" })).error, /Choose a model from PenEcho Cloud/);
  assert.equal(agents.modelFor("penecho"), "");
  await check.pickModel("penecho", { model:"PenEcho Deep" });
  assert.equal(agents.modelFor("penecho"), "PenEcho Deep");
  // The runner is told how to reach the proxy and nothing about the account: a Cloud model's own headers lose the token on the way.
  const told = await source.describe(await source.connect("PenEcho Deep"), { baseURL:"http://127.0.0.1:1/run/x/model" });
  assert.deepEqual([told.config.api, told.config.baseURL, told.config.headers], ["anthropic-messages", "http://127.0.0.1:1/run/x/model", { "x-penecho-request-kind":"agent" }]);
  assert.doesNotMatch(JSON.stringify(told), new RegExp(ACCOUNT_TOKEN));
  // Cloud alone, and a name it does not have.
  const cloudOnly = createPenEchoSource({ cloud:() => cloud });
  closing.push(() => cloudOnly.close());
  await assert.rejects(cloudOnly.connect("nothing-like-it"), /PenEcho Cloud has no model named nothing-like-it/);
});

test("R1b: when Cloud marks its worker model, only that worker is available to the built-in agent", async () => {
  // Cloud's catalog (GET /api/v1/models) marks the one model PenEcho's agent works with: `worker: true` (owner, 2026-11-13: DeepSeek flash only).
  const FLASH = "44444444-4444-4444-8444-444444444444", SOL = "55555555-5555-4555-8555-555555555555";
  let catalog = { models:[{ id:SOL, displayName:"GPT-6 Sol", apiFormat:"openai", available:true, sortOrder:1 }, { id:FLASH, displayName:"DeepSeek 4.1 Flash", apiFormat:"anthropic", available:true, sortOrder:5, worker:true }] };
  const cloud = {
    hostedCatalog:null,
    status:() => ({ accountSession:{ signedIn:true } }),
    async refreshHostedCatalog() { this.hostedCatalog = catalog; return catalog; },
    async hostedModels() { await this.refreshHostedCatalog(); return { models:catalog.models, credits:{ availableCredits:500 } }; },
    async prepareHostedConnection(id) { return { id, provider:"api", apiFormat:catalog.models.find(m => `hosted:${m.id}` === id).apiFormat, apiUrl:"https://cloud.test/api/v1/hosted", apiKey:ACCOUNT_TOKEN, apiModel:id.slice(7), effort:"medium", hosted:true }; },
  };
  const own = { id:"own", provider:"api", apiFormat:"openai", apiUrl:"https://api.example.test/v1", apiModel:"my-model", apiKey:REAL_KEY };
  const source = createPenEchoSource({ cloud:() => cloud, connections:() => [own] });
  closing.push(() => source.close());
  await source.listening;
  await source.refresh();
  const offered = source.models();
  assert.deepEqual([offered.name, offered.from, offered.choices], ["DeepSeek 4.1 Flash", "PenEcho Cloud", ["DeepSeek 4.1 Flash"]], "only the worker");
  const used = async pick => { const c = await source.connect(pick); return [c.hosted === true, c.apiModel, c.apiFormat]; };
  assert.deepEqual(await used(""), [true, FLASH, "anthropic"], "nothing picked: the worker, though another Cloud model comes first in Cloud's order");
  assert.deepEqual(await used("DeepSeek 4.1 Flash"), [true, FLASH, "anthropic"]);
  assert.deepEqual(await used("GPT-6 Sol"), [true, FLASH, "anthropic"], "a pick saved for another Cloud model runs on the worker, never on that model");
  assert.deepEqual(await used(SOL), [true, FLASH, "anthropic"]);
  await assert.rejects(used("my-model"), { code:"PENECHO_MODEL_UNKNOWN" });
  // The worker briefly down: Cloud lists only models that can answer, so it is missing with its mark. No other Cloud model stands in.
  catalog = { models:[{ id:SOL, displayName:"GPT-6 Sol", apiFormat:"openai", available:true, sortOrder:1 }] };
  await source.refresh();
  assert.deepEqual(source.models().choices, []);
  await assert.rejects(source.connect("GPT-6 Sol"), error => error.status === 503 && error.code === "PENECHO_MODEL_UNAVAILABLE" && /not available right now/.test(error.message));
  const cloudOnly = createPenEchoSource({ cloud:() => cloud });
  closing.push(() => cloudOnly.close());
  catalog = { models:[{ id:SOL, displayName:"GPT-6 Sol", apiFormat:"openai", available:true, sortOrder:1 }, { id:FLASH, displayName:"DeepSeek 4.1 Flash", apiFormat:"anthropic", available:true, sortOrder:5, worker:true }] };
  assert.deepEqual(await cloudOnly.connect("").then(c => c.apiModel), FLASH);
  catalog = { models:[{ id:SOL, displayName:"GPT-6 Sol", apiFormat:"openai", available:true, sortOrder:1 }] };
  await assert.rejects(cloudOnly.connect(""), error => error.status === 503, "nothing picked and the worker away: said plainly, and the proxy tries the call again");
});

test("the commands an unattended run may use are one list, checked the same for every run", () => {
  const memory = path.join(temp, "docs", ".penecho", "memory").replaceAll("\\", "/");
  const roots = { cwd:temp, folders:[path.join(temp, "docs")], extra:[`sh '${memory}'`] };
  const ok = command => checkCommand(command, roots).ok;
  assert.ok(RUN_COMMANDS.includes("git") && !RUN_COMMANDS.includes("rm") && !RUN_COMMANDS.includes("env"));
  for (const command of ["git status", "npm test && git diff | head -20", "echo hi > notes.txt", "echo hi 2>&1 >/dev/null", `sh "${memory}" show`, "cd docs && touch a.md", "find . -name '*.js'", "awk '$3 > 5' a.txt", "git config --get user.name", "sort -o sorted.txt a.txt", "sed -n 1,5p a.txt", "ls a#b"]) assert.equal(ok(command), true, command);
  // Review finding 2: what hid a second command, or wrote or ran outside the rules.
  for (const command of ["ls $'a\\x3b rm -rf .'", 'ls $"x"', "ls #; rm x", "find . -name '*.js' -exec wc -l {} \\;", "find . -delete", "find . -fprint /tmp/x", "awk 'BEGIN{system(\"id\")}'", "awk '{print > \"/tmp/x\"}' a", "awk -f prog.awk a", "git -c alias.x='!sh' x", "git config alias.x '!sh'", "git rebase -x id main", "git submodule foreach id", "sort -o /tmp/x a.txt", "curl -o /tmp/x http://example.com", "curl --output=/tmp/x http://example.com", "curl -K cfg", "sed 's/a/b/w /tmp/x' a", "sed -e '1e id' a", "cp -t /tmp a.txt", "mv --target-directory=/tmp a.txt", "gh alias set x '!id'"]) assert.equal(ok(command), false, command);
  // Where there is no OS sandbox, reading outside the run's folders is refused by the check too.
  assert.equal(checkCommand("cat /etc/passwd", { ...roots, strictReads:true }).ok, false);
  assert.equal(checkCommand("cat < /etc/passwd", { ...roots, strictReads:true }).ok, false);
  assert.equal(checkCommand("cat ../../x", { ...roots, strictReads:true }).ok, false);
  assert.equal(checkCommand(`cat '${path.join(temp, "docs", "a.md")}'`, { ...roots, strictReads:true }).ok, true);
  for (const command of ["rm -rf .", "FOO=1 node x.js", "cat $(ls)", "echo `id`", "echo hi > /etc/hosts", "echo hi > $HOME/x", "mkdir /tmp/elsewhere", "cp a /tmp/b", "cd / && touch x", "node a.js &", "cat <<EOF\nx\nEOF", "sudo ls", "bash -c ls", "(ls)"]) assert.equal(ok(command), false, command);

  // Windows path confinement under Git Bash (no OS sandbox -> strictReads:true).
  const winRoots = { cwd:"C:\\Users\\msi\\work", folders:["C:\\Users\\msi\\docs"], strictReads:true, platform:"win32" };
  for (const allowed of [
    'ls -la "C:/Users/msi/docs/sub"',
    "cat 'C:\\Users\\msi\\work\\a.txt'",
    'cat "C:\\Users\\msi\\work\\a.txt"',
    "cat /c/Users/msi/docs/a.md",
    "cd /c/Users/msi/docs && cat a.md",
    "echo hi > /dev/null",
    "git status && node -v",
  ]) assert.equal(checkCommand(allowed, winRoots).ok, true, allowed);
  for (const denied of [
    "cat C:/Windows/win.ini",
    "cat 'C:\\Windows\\win.ini'",
    'cat "C:\\Users\\msi\\.penecho\\connections.json"',
    "cat /c/Windows/win.ini",
    "cat /etc/passwd",
    "cat /work/a.txt",
    "cat '..\\outside\\secret.txt'",
    "cat '\\\\server\\share\\secret.txt'",
    "cat < C:/Windows/win.ini",
    "cat C:secret.txt",
    "echo hi > 'C:\\Users\\msi\\outside\\x.txt'",
  ]) assert.equal(checkCommand(denied, winRoots).ok, false, denied);
});

test("findBash discovers Git Bash on Windows while rejecting WSL and WindowsApps shims", async () => {
  const { findBash } = await loadRunner();
  const makeIsFile = files => {
    const set = new Set(files.map(f => f.toLowerCase()));
    return file => set.has(String(file).toLowerCase());
  };
  // Ignores WSL System32\bash.exe and WindowsApps alias even when set as override or on PATH.
  assert.equal(findBash({
    platform:"win32",
    env:{ PENECHO_GIT_BASH_PATH:"C:\\Windows\\System32\\bash.exe", CLAUDE_CODE_GIT_BASH_PATH:"C:\\Users\\msi\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe", PATH:"C:\\Windows\\System32;C:\\Users\\msi\\AppData\\Local\\Microsoft\\WindowsApps" },
    isFile:makeIsFile(["C:\\Windows\\System32\\bash.exe", "C:\\Users\\msi\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe"]),
  }), "");
  // Discovers Git Bash relative to git.exe on PATH and prefers bin\bash.exe over usr\bin\bash.exe.
  assert.equal(findBash({
    platform:"win32",
    env:{ PATH:"C:\\Custom\\Git\\cmd;C:\\Windows\\System32" },
    isFile:makeIsFile(["C:\\Custom\\Git\\cmd\\git.exe", "C:\\Custom\\Git\\bin\\bash.exe", "C:\\Custom\\Git\\usr\\bin\\bash.exe"]),
  }), "C:\\Custom\\Git\\bin\\bash.exe");
  // Falls back to standard Program Files Git install.
  assert.equal(findBash({
    platform:"win32",
    env:{ ProgramFiles:"C:\\Program Files", PATH:"C:\\Windows\\System32" },
    isFile:makeIsFile(["C:\\Program Files\\Git\\usr\\bin\\bash.exe"]),
  }), "C:\\Program Files\\Git\\usr\\bin\\bash.exe");
  // Honors explicit safe PENECHO_GIT_BASH_PATH override.
  assert.equal(findBash({
    platform:"win32",
    env:{ PENECHO_GIT_BASH_PATH:"D:\\Tools\\Git\\bin\\bash.exe", ProgramFiles:"C:\\Program Files" },
    isFile:makeIsFile(["D:\\Tools\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\bin\\bash.exe"]),
  }), "D:\\Tools\\Git\\bin\\bash.exe");
});

test("review finding 1: a command the PenEcho agent runs cannot read the stored keys or anything outside its folders", { skip:!["darwin", "linux"].includes(process.platform) && "no OS sandbox here" }, async () => {
  const { projectShellSupport } = await import("../src/server/agent-core/shell.mjs");
  if (!projectShellSupport()) return;
  const workdir = path.join(temp, "f1-work"), docs = path.join(temp, "f1-docs"), keys = path.join(temp, "f1-keys"), state = path.join(temp, "f1-state");
  for (const dir of [workdir, docs, keys, state]) fs.mkdirSync(dir, { recursive:true });
  fs.writeFileSync(path.join(keys, "connections.json"), JSON.stringify({ apiKey:"sk-stored-key-XYZ" }));
  fs.writeFileSync(path.join(docs, "MEMORY.md"), "inside the docs\n");
  const model = await stubModel([
    { tool:"bash", args:{ command:`cat ${path.join(keys, "connections.json")}` } },
    { tool:"bash", args:{ command:`node -e "console.log(require('fs').readFileSync('${path.join(keys, "connections.json")}','utf8'))"` } },
    { tool:"bash", args:{ command:`cat ${path.join(docs, "MEMORY.md")} && echo made > made.txt && cat made.txt && echo "home=$HOME"` } },
    { text:"Done." },
  ]);
  const source = cloudSourceFor(model.url);
  closing.push(() => source.close());
  await source.listening;
  const env = { ...process.env, PATH:process.env.PATH, HOME:process.env.HOME };
  const agents = createAgents({ env, paths:{ penecho:source, stateDir:state }, appFolders:[] });
  const run = await runOnce(agents.command("penecho", { workdir, docs }), env, "Look around.");
  const results = toolResults(run.lines).map(r => String(r.content));
  assert.ok(!results.join("\n").includes("sk-stored-key-XYZ"), results.join("\n"));
  assert.match(results[0], /Operation not permitted|denied/i);
  assert.match(results[2], /inside the docs/);
  assert.match(results[2], /made/);
  assert.ok(!results[2].includes(`home=${process.env.HOME}\n`), "HOME is the run's own folder");
  assert.equal(fs.readFileSync(path.join(workdir, "made.txt"), "utf8"), "made\n");
});
