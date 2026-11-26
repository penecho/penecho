"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// The module with its programs replaced, so what it starts and how often can be counted on any system.
function load(childProcess) {
  const module = { exports:{} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/server/project-lines/windows-processes.js"), "utf8"), {
    module, require:name => name === "node:child_process" ? childProcess : require(name), process, Date, Map, Set, Promise, setTimeout, clearTimeout,
  });
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const ROWS = "4|0|1500|0|System \r\n100|4|20|1795507218624|codex.exe \"C:\\a b\\codex.exe\" app-server|x\nnot a row\n";

test("a process list is read with its command lines, and one list answers for each process in it", async () => {
  let listed = 0, askedOne = 0, script = "";
  const W = load({
    execFile(file, args, options, done) {
      listed++;
      assert.equal(options.windowsHide, true);
      setImmediate(() => done(null, ROWS));
      return { stdin:{ on() {}, end(text) { script = text; } } };
    },
    execFileSync(file, args, options) { askedOne++; assert.match(options.input, /List\(200\)/); return "200|4|5|1795507218000|node.exe node a.js\n"; },
  });
  assert.deepEqual(plain(await W.list()), [{ pid:4, ppid:0, cpu:1500, startedAt:0 }, { pid:100, ppid:4, cpu:20, startedAt:1795507218624 }]);
  assert.match(script, /List\(0\)/);
  assert.deepEqual(plain(W.meta(100)), { pid:100, ppid:4, pgid:0, startedAt:1795507218624, command:'codex.exe "C:\\a b\\codex.exe" app-server|x' });
  assert.deepEqual([listed, askedOne], [1, 0]);
  assert.equal(W.meta(200).command, "node.exe node a.js");
  assert.equal(W.meta(200).command, "node.exe node a.js");
  assert.equal(askedOne, 1, "the same process is not asked about again at once");
});

test("a list that cannot be read is no list", async () => {
  const W = load({ execFile(file, args, options, done) { setImmediate(() => done(Error("timed out"), "")); return { stdin:{ on() {}, end() {} } }; } });
  assert.equal(await W.list(), null);
});

test("ending processes starts one taskkill and does not wait for it", async () => {
  const started = [], child = Object.assign(new EventEmitter(), { unref() {} });
  const W = load({ spawn(file, args, options) { started.push([file, plain(args), plain(options)]); return child; }, spawnSync() { throw Error("never waited for"); } });
  let ended = false;
  const ending = W.killWindowsTrees([100, 200, 100, 0]).then(() => { ended = true; });
  await new Promise(setImmediate);
  assert.equal(ended, false);
  assert.deepEqual(started, [["taskkill.exe", ["/T", "/F", "/PID", "100", "/PID", "200"], { stdio:"ignore", windowsHide:true }]]);
  child.emit("exit", 0);
  await ending;
  await W.killWindowsTrees([]);
  assert.equal(started.length, 1);
});

test("no Windows process ending waits inside PenEcho's server", () => {
  for (const file of ["kept-child.js", "service.js", "run-watch.js"]) {
    const text = fs.readFileSync(path.join(__dirname, "../src/server/project-lines", file), "utf8");
    assert.doesNotMatch(text, /Sync\([^)]*taskkill/, file);
  }
});
