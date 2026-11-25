"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { piLine } = require("../src/server/project-lines/agent-sessions.js");
const { ompFolders } = require("../src/server/project-lines/conversations.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-omp-test-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
const fresh = name => { const dir = path.join(temp, `${name}-${++counter}`); fs.mkdirSync(dir, { recursive:true }); return fs.realpathSync(dir); };
const program = (file, text = "#!/bin/sh\n") => { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, text, { mode:0o755 }); return file; };

test("omp is found where its installer puts it, and runs headless the way Pi does", () => {
  const home = fresh("home"), omp = program(path.join(home, ".local", "bin", "omp"));
  const agents = createAgents({ env:{ HOME:home, PATH:"" } });
  assert.deepEqual(agents.available().filter(a => a.available).map(a => a.id), ["omp"]);
  const run = agents.command("omp", { workdir:home, docs:home, gitDir:"" });
  assert.equal(run.command, omp);
  assert.deepEqual(run.args, ["--mode", "rpc-ui", "--auto-approve"]);
  assert.equal(run.stdin, true, "the words go on stdin");
  assert.equal(run.input, "pi-rpc", "omp uses Pi RPC mode for live steering and UI requests");
  assert.equal(run.dialect, "pi", "omp prints Pi's events");
  const resumed = agents.command("omp", { workdir:home, docs:home, resume:"01a0c955" }).args;
  assert.equal(resumed[resumed.indexOf("--resume") + 1], "01a0c955");
  assert.equal(agents.terminal("omp", "01a0c955"), "omp --resume 01a0c955");
  assert.ok(agents.classifier().args.includes("--no-session"), "with only omp here, it answers which Topic a message belongs to");
  assert.equal(createAgents({ env:{ HOME:fresh("nowhere"), PATH:"", OMP_CLI_PATH:omp } }).available().find(a => a.id === "omp").available, true);
});

test("omp's own transcripts are Pi's, filed under the folder's path from home", () => {
  const home = "/Users/me";
  const names = ["-workspace-penecho_071_version", "-workspace-penecho_071_version-.claude-worktrees-lines", "-workspace-penecho_cloud", "-Documents-PenEcho-PenEcho", "--tmp-outside--"];
  assert.deepEqual(ompFolders(home, ["/Users/me/workspace/penecho_071_version"], names).map(f => f.name), names.slice(0, 2));
  assert.deepEqual(ompFolders(home, ["/Users/me/Documents/PenEcho/PenEcho"], names).map(f => f.name), ["-Documents-PenEcho-PenEcho"]);
  assert.deepEqual(ompFolders(home, ["/tmp/outside"], names).map(f => f.name), ["--tmp-outside--"], "outside home, the whole path");
  // The first lines of a real omp 18 transcript.
  assert.equal(piLine(JSON.stringify({ type:"title", v:1, title:"Change Directory Up One Level", source:"auto" })), null);
  assert.deepEqual(piLine(JSON.stringify({ type:"session", version:3, id:"01a0c955-ce11-75f6-a26b-452ddd5adcce", timestamp:"2026-09-22T13:37:18.865Z", cwd:"/Users/me/workspace/penecho_071_version" })), { header:true, cwd:"/Users/me/workspace/penecho_071_version" });
  const typed = piLine(JSON.stringify({ type:"message", id:"b8ee6f21", parentId:"fe2169c6", timestamp:"2026-09-22T13:45:15.827Z", message:{ role:"user", content:[{ type:"text", text:"hi" }], attribution:"user", timestamp:1790084715792 } }));
  assert.deepEqual(typed.changes, [{ me:"hi" }]);
});

test("omp transcript contextSnapshot matches live message_end checkpoint without reopening finished Works", () => {
  const { checkpointOf, alreadyHandled } = require("../src/server/project-lines/pi-checkpoint.js");
  const baseMessage = {
    role:"assistant",
    content:[{ type:"text", text:"Format test question?" }],
    api:"openai-completions",
    provider:"magpie",
    model:"opencode-go/deepseek-v4.1-flash",
    stopReason:"stop",
    timestamp:1795289931700,
    usage:{ input:250, output:19, cacheRead:51072, cacheWrite:0, totalTokens:51341 },
  };
  const liveEvent = { type:"message_end", message:baseMessage };
  const transcriptRow = {
    type:"message",
    id:"f2843b40",
    timestamp:"2026-11-21T19:39:00.000Z",
    message:{ ...baseMessage, contextSnapshot:{ promptTokens:63470, nonMessageTokens:8739, toolSchemaTokens:5450, compactionEpoch:0 } },
  };
  const liveCp = checkpointOf(liveEvent);
  const fileCp = checkpointOf(transcriptRow);
  assert.ok(liveCp && fileCp);
  assert.equal(liveCp.at, 1795289931700);
  assert.equal(fileCp.at, 1795289931700);
  assert.equal(fileCp.hash, liveCp.hash, "transcript-only contextSnapshot must not change checkpoint hash");
  assert.equal(alreadyHandled({ at:liveCp.at, hashes:[liveCp.hash] }, fileCp), true);
  assert.ok("contextSnapshot" in transcriptRow.message, "checkpointOf must not mutate the parsed message");
});
