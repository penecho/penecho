"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..", "src", "server", "project-lines");
const run = (code, ...args) => {
  const env = { ...process.env };
  delete env.NODE_OPTIONS; delete env.NODE_NO_WARNINGS;
  return spawnSync(process.execPath, ["-e", code, ...args], { encoding:"utf8", env, timeout:20000 });
};

test("reading SQLite, here or in a worker thread, prints no warning, and other warnings are still shown", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-sqlite-warning-"));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const child = run(`
    const [root, dir] = process.argv.slice(1), emit = process.emitWarning;
    const { requireSqlite, loadSqlite } = require(root + "/sqlite.js");
    const db = new (requireSqlite().DatabaseSync)(dir + "/opencode.db");
    db.exec("create table session (id text, directory text, parent_id text, title text, time_updated integer); create table message (id text, session_id text, time_created integer, time_updated integer, data text); create table part (id text, message_id text, session_id text, data text); insert into session values ('ses_1', '/a', null, 'One', 5)");
    db.close();
    if (process.emitWarning !== emit || !loadSqlite()) throw Error("not restored");
    require(root + "/opencode-db.js").openCodeDatabase(dir).list().then(rows => {
      console.log(rows.length);
      process.emitWarning("another one", "ExperimentalWarning");
    });
    setTimeout(() => {}, 1000);
  `, root, dir);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), "1");
  assert.doesNotMatch(child.stderr, /SQLite/);
  assert.match(child.stderr, /ExperimentalWarning: another one/);
});

test("the server loads SQLite only where its warning is left out", () => {
  for (const name of fs.readdirSync(root).filter(name => name.endsWith(".js") && name !== "sqlite.js")) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, name), "utf8"), /require\("node:sqlite"\)/, name);
  }
});
