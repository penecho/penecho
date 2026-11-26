"use strict";
// test-safety.test.js runs this under `node --test`, then kills the runner: this worker, the detached process it started and
// a process known only from a keep folder (its parent is gone, as an agent's is once its keeper has died) must not outlive
// it. Writes "<worker pid> <child pid> <kept pid>" to the file named in PENECHO_SAFETY_PIDS once all run.
require("../helpers/safety.js");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { test } = require("node:test");
test("hangs with a detached child and an open server", () => new Promise(() => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached:true, stdio:"ignore" });
  child.unref();
  const root = path.join(path.dirname(process.env.PENECHO_SAFETY_PIDS), "state", "keep"), sleeper = 'const c = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached:true, stdio:"ignore" }); c.unref(); console.log(c.pid);';
  const kept = Number(execFileSync(process.execPath, ["-e", sleeper], { encoding:"utf8" }));
  fs.mkdirSync(path.join(root, "run-1"), { recursive:true });
  fs.writeFileSync(path.join(root, "run-1", "pid.json"), JSON.stringify({ keeper:0, agent:kept }));
  (globalThis[Symbol.for("penecho.keeper-roots")] ||= new Set()).add(root);
  require("node:http").createServer().listen(0, "127.0.0.1", () => fs.writeFileSync(process.env.PENECHO_SAFETY_PIDS, `${process.pid} ${child.pid} ${kept}`));
}));
