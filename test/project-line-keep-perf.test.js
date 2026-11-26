"use strict";
require("./helpers/safety.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { KeptChild, createKeeper } = require("../src/server/project-lines/kept-child.js");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-perf-"));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  return dir;
}

test("only data, identity, exit and unnamed notifications pump the kept child", t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
  let notify;
  t.mock.method(fs, "watch", (_dir, cb) => { notify = cb; return { on() {}, close() {} }; });
  const child = new KeptChild(dir);
  t.after(() => child.detach());
  const pump = t.mock.method(child, "pump");
  for (const name of ["run.json", "run.json.23.tmp", "input", "input-end", "kill", "read"]) {
    fs.writeFileSync(path.join(dir, name), "x");
    notify("rename", name);
  }
  assert.equal(pump.mock.callCount(), 0);
  const reads = t.mock.method(fs, "readFileSync");
  const exists = t.mock.method(fs, "existsSync");
  fs.writeFileSync(path.join(dir, "out"), "burst\n");
  notify("change", Buffer.from(path.join(dir, "out")));
  assert.equal(reads.mock.callCount(), 0);
  for (const name of ["err", "exit.json", "pid.json", "claim.json", null]) notify("change", name);
  child.pump(); // fallback tick
  assert.equal(pump.mock.callCount(), 7);
  assert.deepEqual(reads.mock.calls.map(call => path.basename(call.arguments[0])), Array(6).fill("exit.json"));
  assert.equal(exists.mock.callCount(), 0);
  assert.equal(child.keeperPid, process.pid);
});

async function until(check, label) {
  const deadline = Date.now() + 10000;
  let value;
  while (!(value = check())) {
    assert.ok(Date.now() < deadline, "timed out waiting for " + label);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return value;
}
async function untilExit(dir) {
  const file = path.join(dir, "exit.json");
  await until(() => fs.existsSync(file), "exit.json");
  return JSON.parse(fs.readFileSync(file));
}
function launch(dir, command, args, options) {
  const child = createKeeper({ root:dir }).spawn(command, args, { dir, ...options });
  child.detach(); // Inspect durable output as a server returning after a restart would.
}
function capture(t, child) {
  const output = { frames:[], exit:null };
  child.stdout.on("data", frame => output.frames.push(frame));
  child.on("close", (code, signal) => { output.exit = { code, signal }; });
  t.after(() => child.detach());
  return output;
}

test("keeper ignores its own output and metadata notifications but looks for each control", async t => {
  const dir = fixture(t);
  // Deliver deterministic watch notifications inside the real keeper. Its first directory
  // existence check identifies look() without relying on OS coalescing or timer timing.
  const preload = path.join(dir, "trace.cjs");
  fs.writeFileSync(preload, `
    if (process.argv[1]?.endsWith("agent-keeper.js")) {
      const fs = require("node:fs"), path = require("node:path");
      const watch = fs.watch, exists = fs.existsSync;
      fs.watch = (dir, cb) => {
        const seen = [];
        let current;
        fs.existsSync = file => {
          if (file === dir) seen.push(current);
          return exists(file);
        };
        for (current of ["run.json", "run.json.23.tmp", "out", "err", "pid.json"]) {
          cb("change", current);
        }
        for (current of ["input", "input-end", "kill", "stopped-by-user", "launch-aborted", null]) {
          cb("change", current && Buffer.from(path.join(dir, current)));
        }
        fs.existsSync = exists;
        fs.writeFileSync(path.join(dir, "seen.json"), JSON.stringify(seen));
        return watch(dir, cb);
      };
    }
  `);
  launch(dir, process.execPath, ["-e", ""], { env:{ ...process.env, NODE_OPTIONS:"--require " + JSON.stringify(preload) } });
  assert.equal((await untilExit(dir)).code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "seen.json"))),
    ["input", "input-end", "kill", "stopped-by-user", "launch-aborted", null]);
});

test("Pi RPC stdout survives killing only the keeper", async t => {
  const dir = fixture(t);
  const noise = '{"type":"message_update"}\n';
  const frame = '{"type":"message_end","text":"survived"}\n';
  const child = createKeeper({ root:dir }).spawn(process.execPath, ["-e", `
    const fs = require("node:fs");
    fs.writeSync(1, ${JSON.stringify(noise)});
    fs.writeFileSync("ready", String(process.pid));
    const deadline = Date.now() + 15000;
    const timer = setInterval(() => {
      if (!fs.existsSync("release")) {
        if (!fs.existsSync(process.cwd()) || Date.now() > deadline) process.exit(1);
        return;
      }
      clearInterval(timer);
      try { fs.writeSync(1, ${JSON.stringify(frame)}); }
      catch (error) { fs.writeFileSync("write-error", error.code); process.exit(1); }
    }, 10);
  `], { dir, cwd:dir, streamFilter:"pi-rpc" });
  const output = capture(t, child);
  const ready = path.join(dir, "ready");
  const readyPid = await until(() => child.pid && fs.existsSync(ready) && Number(fs.readFileSync(ready, "utf8")), "agent ready");
  assert.equal(child.pid, readyPid);
  assert.ok(child.keeperPid > 0 && child.keeperPid !== child.pid && child.keeperPid !== process.pid);
  process.kill(child.keeperPid, "SIGKILL");
  await until(() => {
    try { process.kill(child.keeperPid, 0); return false; }
    catch (error) { if (error.code === "ESRCH") return true; throw error; }
  }, "keeper to die");
  fs.writeFileSync(path.join(dir, "release"), "");
  const writeError = path.join(dir, "write-error");
  await until(() => output.frames.length || fs.existsSync(writeError), "agent to write after keeper death");
  assert.equal(fs.existsSync(writeError) ? fs.readFileSync(writeError, "utf8") : null, null);
  assert.deepEqual(output.frames, [Buffer.from(frame)]);
  assert.equal(fs.readFileSync(path.join(dir, "out"), "utf8"), noise + frame);
});

test("a descendant holding stdout cannot delay the foreground exit or kept child close", async t => {
  const dir = fixture(t);
  const first = '{"type":"message_end","text":"foreground"}';
  const late = "\nstdout from descendant\n";
  const descendant = `
    const fs = require("node:fs");
    fs.writeFileSync("descendant-ready", String(process.pid));
    const deadline = Date.now() + 15000;
    const timer = setInterval(() => {
      if (!fs.existsSync("release")) {
        if (!fs.existsSync(process.cwd()) || Date.now() > deadline) process.exit(1);
        return;
      }
      clearInterval(timer);
      fs.writeSync(1, ${JSON.stringify(late)});
      fs.writeFileSync("late-written", "");
    }, 10);
  `;
  const child = createKeeper({ root:dir }).spawn(process.execPath, ["-e", `
    require("node:fs").writeSync(1, ${JSON.stringify(first)});
    require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}],
      { stdio:["ignore", 1, "ignore"] }).unref();
  `], { dir, cwd:dir, streamFilter:"pi-rpc" });
  const output = capture(t, child);
  const ready = path.join(dir, "descendant-ready");
  const descendantPid = await until(() => fs.existsSync(ready) && Number(fs.readFileSync(ready, "utf8")), "descendant holding stdout");
  assert.equal((await untilExit(dir)).code, 0);
  assert.deepEqual(await until(() => output.exit, "kept child close"), { code:0, signal:null });
  assert.deepEqual(output.frames, [Buffer.from(first)]);
  assert.equal(process.kill(descendantPid, 0), true);
  fs.writeFileSync(path.join(dir, "release"), "");
  await until(() => fs.existsSync(path.join(dir, "late-written")), "late descendant output");
  assert.equal(fs.readFileSync(path.join(dir, "out"), "utf8"), first + late);
});

test("Pi RPC reattaches at raw offsets, filters bursts and compacts agent_end before delivery", async t => {
  const dir = fixture(t);
  const out = path.join(dir, "out");
  fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify({ streamFilter:"pi-rpc" }));
  fs.writeFileSync(path.join(dir, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
  const keeper = createKeeper({ root:dir });
  const retained = ["session", "response", "agent_start", "extension_ui_request", "extension_ui_response",
    "tool_execution_start", "tool_execution_end", "message", "message_end", "future_type"]
    .map(type => ' { "nested": {"type":"message_update"}, "type":' + JSON.stringify(type) + ' }\r\n')
    .concat(' {"type":"message_update",broken\n', '{"type":"message_\\uZZZZpdate"}\n',
      '\uFEFF{"type":"message_update"}\n', "non-JSON 😃\r\n", "\n").map(text => Buffer.from(text));
  const dropped = ["message_update", "message_start", "turn_start", "turn_end", "tool_execution_update"]
    .map(type => JSON.stringify({ other:"field", type }) + "\n").join("") + '{"type":"message_\\u0075pdate"}\n';
  const burst = '{"type":"message_update","delta":"thinking_delta"}\n'.repeat(50000);
  const smallEnd = Buffer.from('{"type":"agent_end", "messages":[]}'.padEnd(1024) + "\r\n");
  const largeEnd = Buffer.from(JSON.stringify({ type:"agent_end", messages:["x".repeat(2 ** 21)], status:"failed", error:"timeout" }) + "\r\n");
  const compactedEnd = Buffer.from('{"type":"agent_end","status":"failed","error":"timeout"}\r\n');
  const invalid = Buffer.concat([Buffer.from('{"type":"message_update","text":"'), Buffer.from([0xff]), Buffer.from('"}\n')]);
  const onlyNoise = Buffer.from(dropped + burst);
  fs.writeFileSync(out, onlyNoise);
  const original = keeper.attach(dir);
  capture(t, original);
  original.pump("out");
  assert.equal(original.lines.length, 0);
  assert.equal(original.giving, false);
  assert.equal(original.offsets.out, onlyNoise.length);
  const saved = { ...original.offsets };
  original.detach();

  const child = keeper.attach(dir, saved);
  const output = capture(t, child);
  const raw = Buffer.concat([Buffer.from(burst), ...retained, smallEnd, largeEnd, invalid, Buffer.from(dropped)]);
  const expected = [...retained, smallEnd, compactedEnd, invalid];
  fs.appendFileSync(out, raw);
  child.pump("out");
  assert.deepEqual(child.lines.map(line => line.bytes), expected);
  assert.equal(child.offsets.out, saved.out);
  const boundary = onlyNoise.length + raw.length;
  await until(() => child.offsets.out === boundary, "filtered frames and their original file offsets");
  assert.deepEqual(output.frames, expected);

  const tail = Buffer.from('{"type":"message_end","text":"last 😃"}');
  const split = tail.indexOf(0xf0) + 2;
  fs.appendFileSync(out, tail.subarray(0, split));
  child.pump("out");
  assert.equal(child.readTo.out, boundary);
  fs.appendFileSync(out, tail.subarray(split));
  child.pump("out");
  assert.equal(child.readTo.out, boundary);
  assert.deepEqual(output.frames, expected);
  fs.writeFileSync(path.join(dir, "exit.json"), JSON.stringify({ code:0 }));
  const readSync = fs.readSync;
  const late = Buffer.from("\nlate descendant output\n");
  let tailReads = 0;
  t.mock.method(fs, "readSync", (fd, bytes, start, length, from) => {
    const got = readSync(fd, bytes, start, length, from);
    if (from === boundary && got === tail.length && ++tailReads === 1) fs.appendFileSync(out, late);
    return got;
  });
  child.pump("exit.json");
  assert.deepEqual(await until(() => output.exit, "final drain and close"), { code:0, signal:null });
  assert.deepEqual(output.frames, [...expected, tail]);
  assert.equal(child.offsets.out, boundary + tail.length);
  assert.deepEqual(fs.readFileSync(out), Buffer.concat([onlyNoise, raw, tail, late]));
});

test("Pi RPC distinguishes capped diagnostic fragments from new frames across reattach", async t => {
  const dir = fixture(t);
  const out = path.join(dir, "out");
  fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify({ streamFilter:"pi-rpc" }));
  fs.writeFileSync(path.join(dir, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
  const keeper = createKeeper({ root:dir });
  const child = keeper.attach(dir);
  const output = capture(t, child);
  const cap = 4 * 1024 * 1024;
  const prefix = Buffer.alloc(cap, 120);
  fs.writeFileSync(out, prefix.subarray(0, cap - 1));
  child.pump("out");
  assert.equal(child.readTo.out, 0);
  fs.appendFileSync(out, prefix.subarray(cap - 1));
  child.pump("out");
  assert.equal(child.readTo.out, 0);
  const noise = '{"type":"message_update"}\n';
  fs.appendFileSync(out, noise.slice(0, 1));
  child.pump("out");
  assert.equal(child.readTo.out, cap);
  await until(() => child.offsets.out === cap, "capped diagnostic prefix");
  assert.deepEqual(output.frames, [prefix]);
  child.detach();

  const reattached = keeper.attach(dir, child.offsets);
  const replay = capture(t, reattached);
  fs.appendFileSync(out, noise.slice(1) + noise);
  reattached.pump("out");
  await until(() => reattached.offsets.out === cap + 2 * noise.length, "diagnostic continuation and dropped noise");
  assert.deepEqual(replay.frames, [Buffer.from(noise)]);
});

test("dropped Pi RPC bytes never commit ahead of an active stdout callback or use a stderr offset", async t => {
  const dir = fixture(t);
  const out = path.join(dir, "out");
  fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify({ streamFilter:"pi-rpc" }));
  fs.writeFileSync(path.join(dir, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
  const child = createKeeper({ root:dir }).attach(dir);
  const output = capture(t, child);
  const frame = '{"type":"message_end"}\n', noise = '{"type":"message_update"}\n', diagnostic = "diagnostic\n";
  let duringStdout, duringStderr;
  child.stdout.on("data", () => {
    fs.appendFileSync(out, noise);
    child.pump("out");
    duringStdout = { ...child.offsets };
  });
  child.stderr.on("data", () => { duringStderr = { ...child.offsets }; });
  fs.writeFileSync(out, frame);
  fs.writeFileSync(path.join(dir, "err"), diagnostic);
  child.pump("out");
  fs.appendFileSync(out, noise);
  child.pump("out");
  assert.deepEqual(child.offsets, { out:0, err:0 });
  await until(() => child.offsets.out === frame.length + 2 * noise.length, "offsets after both callbacks");
  assert.deepEqual(duringStdout, { out:0, err:0 });
  assert.deepEqual(duringStderr, { out:frame.length + noise.length, err:0 });
  assert.deepEqual(child.offsets, { out:frame.length + 2 * noise.length, err:diagnostic.length });
  assert.deepEqual(output.frames, [Buffer.from(frame)]);
});

test("other spawns keep direct file descriptors and verbatim stdout", async t => {
  const dir = fixture(t);
  const frame = '{"type":"message_update"}';
  launch(dir, process.execPath, ["-e", `
    const fs = require("node:fs");
    if (!fs.fstatSync(1).isFile() || !fs.fstatSync(2).isFile()) process.exit(1);
    process.stdout.write(${JSON.stringify(frame)});
  `], { streamFilter:"future" });
  assert.equal((await untilExit(dir)).code, 0);
  assert.equal(fs.readFileSync(path.join(dir, "out"), "utf8"), frame);
});

test("P1-3: late attach stops at exit.json outSize/errSize and ignores post-exit descendant output", async t => {
  const dir = fixture(t);
  launch(dir, process.execPath, ["-e", `
    const { spawn } = require("node:child_process");
    process.stdout.write('{"type":"message_end","ok":1}\\n');
    process.stderr.write("fg-err\\n");
    const bg = spawn(process.execPath, ["-e", "setTimeout(() => { process.stdout.write('{\\"type\\":\\"message_end\\",\\"descendant\\":true}\\\\n'); process.stderr.write('bg-err\\\\n'); }, 120);"], {
      stdio: ["ignore", 1, 2],
      detached: true,
    });
    bg.unref();
  `], { streamFilter:"pi-rpc" });
  // launch() runs detached with no KeptChild attached, simulating a server restart attaching AFTER foreground exit and descendant writes.
  const exit = await untilExit(dir);
  assert.equal(exit.code, 0);
  assert.equal(Number.isInteger(exit.outSize), true);
  assert.equal(Number.isInteger(exit.errSize), true);
  await until(() => fs.readFileSync(path.join(dir, "out"), "utf8").includes('"descendant":true'), "descendant late stdout");
  await until(() => fs.readFileSync(path.join(dir, "err"), "utf8").includes("bg-err"), "descendant late stderr");

  const late = createKeeper({ root:path.dirname(dir) }).attach(dir);
  const out = [], err = [];
  let closed = null;
  late.stdout.on("data", chunk => out.push(chunk.toString("utf8")));
  late.stderr.on("data", chunk => err.push(chunk.toString("utf8")));
  late.on("close", (code, signal) => { closed = { code, signal }; });
  await until(() => closed, "late attach closes cleanly");
  assert.deepEqual(closed, { code:0, signal:null });
  assert.equal(out.join(""), '{"type":"message_end","ok":1}\n', "late attach excludes descendant stdout after foreground exit");
  assert.equal(err.join(""), "fg-err\n", "late attach excludes descendant stderr after foreground exit");
});

test("Pi RPC publishes a failed spawn even with no stdout", async t => {
  const dir = fixture(t);
  launch(dir, path.join(dir, "absent"), [], { streamFilter:"pi-rpc" });
  assert.match((await untilExit(dir)).error, /ENOENT/);
});
