"use strict";
// Test runs must never be able to freeze the Mac again (PE-927): see test/helpers/safety.js and test/helpers/dom.js.
const safety = require("./helpers/safety.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = __dirname;
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes:true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : files(full);
    return /\.(c|m)?js$/.test(entry.name) ? [full] : [];
  });
}

test("tests take linkedom from test/helpers/dom.js, never from linkedom itself", () => {
  const direct = /require\(\s*['"`]linkedom['"`]\s*\)|from\s+['"`]linkedom['"`]|import\(\s*['"`]linkedom['"`]\s*\)/;
  const found = [];
  for (const file of files(root)) {
    if (file === path.join(root, "helpers", "dom.js")) continue;
    fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => { if (direct.test(line)) found.push(`${path.relative(path.dirname(root), file)}:${index + 1}`); });
  }
  assert.deepEqual(found, [], `use require("./helpers/dom.js") instead of linkedom:\n${found.join("\n")}`);
});

test("a failing assert on a DOM node fails at once with a short message", () => {
  // In a child process killed after 3 s, so a broken guard cannot eat the machine's memory.
  const script = `
    const assert = require("node:assert/strict"), legacy = require("node:assert");
    const { parseHTML } = require(${JSON.stringify(path.join(root, "helpers", "dom.js"))});
    const { document } = parseHTML("<html><body>" + '<div class="x"><span>row</span></div>'.repeat(50) + '<div id="lpReviewPop" class="lp-review-pop"></div></body></html>');
    const el = document.querySelector("#lpReviewPop"), out = [];
    for (const check of [() => assert.equal(el, null), () => assert.deepEqual({ el }, {}), () => legacy.notEqual(el, el), () => legacy.deepEqual([document.body], [])]) {
      const start = Date.now();
      try { check(); out.push({ passed:true }); } catch (error) { out.push({ ms:Date.now() - start, length:error.message.length, message:error.message }); }
    }
    console.log(JSON.stringify(out));`;
  const run = spawnSync(process.execPath, ["-e", script], { encoding:"utf8", timeout:3000, killSignal:"SIGKILL" });
  assert.equal(run.signal, null, "the asserts did not finish within 3 s");
  const results = JSON.parse(run.stdout);
  assert.equal(results.length, 4);
  for (const result of results) {
    assert.equal(result.passed, undefined);
    assert.ok(result.ms < 1000, `took ${result.ms} ms`);
    assert.ok(result.length < 4096, `message of ${result.length} characters`);
  }
  assert.match(results[0].message, /<div#lpReviewPop\.lp-review-pop>/);
  assert.match(results[1].message, /\{ el: <div#lpReviewPop\.lp-review-pop> \}/);
});

test("small values keep Node's own diff", () => {
  assert.throws(() => assert.deepEqual({ a:[1, 2] }, { a:[1, 3] }), error => /\+ {5}2\n- {5}3/.test(error.message));
  assert.throws(() => assert.equal(1, 2, "said"), { message:/said/ });
  assert.doesNotThrow(() => assert.deepEqual({ a:[1] }, { a:[1] }));
});

test("every test file loads the safety helper, so a file run on its own is covered too", () => {
  const loads = /(?:require\(|import\s+|from\s+)\s*['"`]\.\/helpers\/(?:safety|dom)\.js['"`]/;
  const missing = fs.readdirSync(root).filter(name => /\.test\.[cm]?js$/.test(name) && !loads.test(fs.readFileSync(path.join(root, name), "utf8")));
  assert.deepEqual(missing, [], `start these with require("./helpers/safety.js") (import "./helpers/safety.js" in .mjs):\n${missing.join("\n")}`);
});

test("PenEcho itself never loads test code", () => {
  const top = path.dirname(root), found = [];
  for (const file of [...files(path.join(top, "src")), ...files(path.join(top, "desktop")), path.join(top, "cli.js"), path.join(top, "server.js")]) {
    if (/test\/helpers\//.test(fs.readFileSync(file, "utf8"))) found.push(path.relative(top, file));
  }
  assert.deepEqual(found, []);
});

test("only a keep folder the test made is its own: never a person's real PenEcho", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-safety-")), keep = path.join(dir, "state", "keep");
  try {
    fs.mkdirSync(keep, { recursive:true });
    assert.equal(safety.ownsKeepRoot(keep), true, "made while this test ran");
    assert.equal(safety.ownsKeepRoot(keep, Date.now() + 60000), false, "a state folder older than the test process");
    assert.equal(safety.ownsKeepRoot(path.join(dir, "missing", "keep")), false);
    assert.equal(safety.ownsKeepRoot(path.join(os.userInfo().homedir, ".penecho", "project-lines", "keep"), 0), false, "the person's own PenEcho, whatever its age");
    // kept-child.js notes the keep folder a process uses, which is how this helper comes to know it.
    require("../src/server/project-lines/kept-child.js").createKeeper({ root:keep });
    assert.ok(globalThis[Symbol.for("penecho.keeper-roots")].has(keep));
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

test("killing the test runner leaves no test worker or process it started", { skip:process.platform === "win32" }, async () => {
  const pidsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-safety-")), "pids");
  // A runner of its own, not a child of this test's runner.
  const env = { ...process.env, PENECHO_SAFETY_PIDS:pidsFile };
  delete env.NODE_TEST_CONTEXT;
  const runner = spawn(process.execPath, ["--test", path.join(root, "fixtures", "safety-orphan.cjs")], { env, stdio:"ignore" });
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let pids = [];
  const until = async (check, ms) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) return false; await new Promise(resolve => setTimeout(resolve, 50)); } return true; };
  try {
    assert.ok(await until(() => fs.existsSync(pidsFile) && fs.readFileSync(pidsFile, "utf8").split(" ").length === 3, 10000), "the worker did not start");
    pids = fs.readFileSync(pidsFile, "utf8").split(" ").map(Number);
    assert.equal(pids.length, 3);
    assert.ok(pids.every(alive));
    runner.kill("SIGKILL");
    assert.ok(await until(() => !pids.some(alive), 5000), `still running: ${pids.filter(alive).join(", ")}`);
  } finally {
    runner.kill("SIGKILL");
    for (const pid of pids) try { process.kill(pid, "SIGKILL"); } catch { /* Ended, as it should have. */ }
    fs.rmSync(path.dirname(pidsFile), { recursive:true, force:true });
  }
});
