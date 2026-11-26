"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const F = require("../src/server/project-lines/format.js");
const { Store } = require("../src/server/project-lines/store.js");

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "status-save-")));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const store = new Store({ directory:root });
  const project = store.create({ name:"Status fixture", docsPath:path.join(root, "docs") });
  const rel = "lines/race.md";
  const line = F.initialLine({ title:"Editor race", status:"working", steps:[] }) + "\r\nOriginal sentence\r\n";
  store.writeText(project, rel, line);
  return { store, project, file:store.full(project, rel), line };
}

for (const mode of ["in-place", "atomic-save"]) {
  test(`generated status retains the exact ${mode} editor save after its final stat`, t => {
    const { store, project, file, line } = fixture(t);
    const saved = Buffer.from(line.replace("status: working", "status: waiting").replace("Original sentence", "Modified sentence"));
    assert.equal(saved.length, Buffer.byteLength(line));
    assert.match(saved.toString(), /status: waiting/);
    saved[saved.indexOf("Modified")] = 0xff; // Cannot round-trip through a UTF-8 string.
    // Warm readText so its cache-fill stat cannot trigger the injection.
    store.readText(project, "lines/race.md");
    let injected = false;
    const stat = fs.statSync;
    t.mock.method(fs, "statSync", (name, options) => {
      const observed = stat(name, options);
      // writeAtomic's final generation check has captured its answer. Finish a real editor
      // save before returning that unchanged answer to the writer.
      if (name === file && options?.throwIfNoEntry === false && !injected) {
        injected = true;
        execFileSync(process.execPath, ["-e", `
          const fs = require("node:fs");
          const [file, mode] = process.argv.slice(1);
          const target = mode === "atomic-save" ? file + ".editor" : file;
          fs.writeFileSync(target, fs.readFileSync(0));
          if (target !== file) fs.renameSync(target, file);
        `, file, mode], { input:saved });
        assert.deepEqual(fs.readFileSync(file), saved);
      }
      return observed;
    });
    let conflict;
    try { store.syncGenerated(project, "main"); } catch (error) { conflict = error; }
    assert.equal(injected, true);
    assert.equal(conflict?.code, "CONFLICT", "a displaced editor save must reach the caller");
    assert.equal(conflict.status, 409);
    const recovery = conflict.conflict.recoveryPath;
    assert.ok(conflict.message.includes(recovery));
    assert.deepEqual(fs.readFileSync(recovery), saved);
    store.syncGenerated(project, "main");
    assert.deepEqual(fs.readFileSync(recovery), saved);
  });
}

test("a warm generated status keeps its cached Line and performs no file writes", t => {
  const { store, project, file } = fixture(t);
  const scan = store.syncGenerated(project, "main");
  assert.equal(scan.topics[0].doc.status, "working");
  assert.match(fs.readFileSync(file, "utf8"), /\[!status\] Working/);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["race.md"]);
  const cached = store.readText(project, "lines/race.md");
  const reads = t.mock.method(fs, "readFileSync"), writes = t.mock.method(fs, "writeFileSync");
  const files = store.walk(project);
  store.syncGenerated(project, "main", files);
  assert.equal(store.readText(project, "lines/race.md"), cached);
  assert.equal(reads.mock.calls.filter(call => call.arguments[0] === file).length, 0);
  assert.equal(writes.mock.calls.filter(call => String(call.arguments[0]).startsWith(path.dirname(file) + path.sep)).length, 0);
});

test("a failed status replacement leaves an editor's final-window move intact", t => {
  const { store, project, file, line } = fixture(t);
  store.readText(project, "lines/race.md");
  const stat = fs.statSync, moved = file + ".moved";
  let injected = false;
  t.mock.method(fs, "statSync", (name, options) => {
    const observed = stat(name, options);
    if (!injected && name === file && options?.throwIfNoEntry === false) {
      injected = true;
      fs.renameSync(file, moved);
    }
    return observed;
  });
  assert.throws(() => store.syncGenerated(project, "main"), /Could not (exchange|replace)/);
  assert.ok(injected);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [path.basename(moved)]);
  assert.equal(fs.readFileSync(moved, "utf8"), line);
});
