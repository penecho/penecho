"use strict";
require("./helpers/safety.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { Service } = require("../src/server/project-lines/service.js");
const { CHECK_MS, STUCK_MS } = require("../src/server/project-lines/run-watch.js");

const progress = [
  JSON.stringify({ type:"message_update", assistantMessageEvent:{ type:"text_delta", delta:"Thinking…" } }),
  JSON.stringify({ type:"tool_execution_update", toolCallId:"fixture", partialResult:{ content:[] } }),
].join("\n") + "\n";
const burst = progress.repeat(64);
const tick = '{"type":"fixture_tick"}\n';

async function until(check, label) {
  const deadline = performance.now() + 10000;
  while (!check()) {
    assert.ok(performance.now() < deadline, "Timed out waiting for " + label);
    await delay(5);
  }
}

async function fixture(t, agent, recover) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-watchdog-"));
  const directory = path.join(root, "state"), home = path.join(root, "home"), program = path.join(root, "runner.js");
  let service, dir;
  t.after(async () => {
    service?.close();
    if (dir) {
      fs.appendFileSync(path.join(dir, "input"), '{"type":"fixture_exit"}\n');
      await until(() => fs.existsSync(path.join(dir, "exit.json")), "fixture runner to exit");
    }
    fs.rmSync(root, { recursive:true, force:true });
  });
  fs.writeFileSync(program, `
    const readline = require("node:readline");
    readline.createInterface({ input:process.stdin }).on("line", line => {
      const { type } = JSON.parse(line);
      if (type === "fixture_tick") process.stdout.write(${JSON.stringify(burst)});
      if (type === "fixture_exit") process.exit(0);
    });
  `);
  const env = { HOME:home, PATH:"", NODE_ENV:"test", PI_CLI_PATH:program, OMP_CLI_PATH:program };
  const agents = createAgents({ env, paths:{ fromApps:false } });
  const open = recoverOnStart => new Service({ directory, agents, recoverOnStart, conversations:{ home, env } });
  service = open(false);
  const project = service.store.create({ name:"Watchdog", docsPath:path.join(root, "docs") });
  const { slug } = await service.createTopic(project, { text:"Keep working.", agent, kinds:["ask", "work"], start:false });
  await service.begin(project, slug);
  const key = service.key(project, slug);
  let run = service.runs.get(key);
  assert.equal(run.agent, agent);
  dir = run.child.dir;
  await until(() => run.child.pid, "fixture runner PID");
  const pid = run.child.pid;
  assert.equal(run.child.streamFilter, "pi-rpc");

  if (recover) {
    const savedOffset = Buffer.byteLength(burst);
    run.child.stdin.write(tick);
    await until(() => run.child.offsets.out === savedOffset, "keeper to consume progress before detach");
    service.close();
    fs.appendFileSync(path.join(dir, "input"), tick);
    const backlogEnd = savedOffset * 2;
    await until(() => fs.statSync(path.join(dir, "out")).size === backlogEnd,
      "filtered progress written while detached");
    service = open(true);
    run = service.runs.get(key);
    assert.equal(run.reattached, true);
    assert.equal(run.child.pid, pid);
    assert.equal(run.child.offsets.out, savedOffset);
    await until(() => run.child.offsets.out === backlogEnd, "reattachment to drain filtered progress");
  }
  return { service, run, dir, pid };
}

for (const agent of ["pi", "omp"]) {
  for (const recover of [false, true]) {
    test(`${agent} ${recover ? "reattachment" : "fresh launch"} counts filtered progress and times out after silence`, async t => {
      const { service, run, dir, pid } = await fixture(t, agent, recover);
      const start = Date.now();
      let now = start, offset = run.child.offsets.out, forwarded = 0;
      t.mock.method(Date, "now", () => now);
      run.child.stdout.on("data", () => forwarded++);
      const checkpoints = t.mock.method(service, "keepNote"), stops = [];
      service.processTable = async () => [{ pid, ppid:1, cpu:100 }];
      service.stopTree = async child => { stops.push(child.pid); };
      const marker = path.join(dir, "watchdog-kill");

      // Emit filtered batches for longer than the half-hour timeout with constant, low CPU.
      for (const elapsed of [0, STUCK_MS / 3, 2 * STUCK_MS / 3, STUCK_MS, STUCK_MS + CHECK_MS]) {
        now = start + elapsed;
        offset += Buffer.byteLength(burst);
        run.child.stdin.write(tick);
        await until(() => run.child.offsets.out === offset, "keeper to consume a progress burst");
        await service.watchRuns();
        assert.deepEqual(stops, [], `runner stopped after ${elapsed / CHECK_MS} active minutes`);
      }
      assert.equal(forwarded, 0);
      assert.equal(checkpoints.mock.callCount(), 0);
      assert.equal(fs.existsSync(marker), false);

      // Keeper polling of unchanged output must not keep a quiet runner alive.
      for (let elapsed = CHECK_MS; elapsed <= STUCK_MS; elapsed += CHECK_MS) {
        now += CHECK_MS;
        run.child.pump();
        await service.watchRuns();
        assert.equal(run.child.offsets.out, offset);
        assert.deepEqual(stops, elapsed < STUCK_MS ? [] : [pid]);
      }
      assert.equal(fs.readFileSync(marker, "utf8"), "stuck");
    });
  }
}
