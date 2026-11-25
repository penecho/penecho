"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { Service } = require("../src/server/project-lines/service.js");

// The watcher reads what people say to their agents in other apps. One look that fails or never ends must not stop every later one:
// on 2026-11-16 a full disk made one save of conversations.json throw, and the watcher read nothing more until PenEcho was restarted.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-conversation-watch-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let counter = 0;
const fakeAgents = { available:() => [], list:() => [], get:() => null, has:() => false, defaultId:() => "" };
function setup() {
  const root = path.join(temp, `case-${++counter}`), directory = path.join(root, "state"), home = path.join(root, "home"), docs = path.join(root, "docs");
  for (const d of [directory, home, docs]) fs.mkdirSync(d, { recursive:true });
  const service = new Service({ directory, agents:fakeAgents, autoWatch:false, conversations:{ home, idleMs:45000 } });
  const project = service.store.create({ name:"Watch", docsPath:fs.realpathSync(docs), codePath:null });
  project.followSince = 1;
  // A new conversation in the project's folder, as Claude desktop writes it.
  const say = (id, text) => {
    const cwd = fs.realpathSync(docs), folder = path.join(home, ".claude/projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
    fs.mkdirSync(folder, { recursive:true });
    fs.writeFileSync(path.join(folder, `${id}.jsonl`), `${JSON.stringify({ type:"user", timestamp:new Date().toISOString(), cwd, entrypoint:"claude-desktop", message:{ role:"user", content:text } })}\n`);
  };
  const lines = () => service.store.scan(project).topics.length;
  return { service, project, conv:service.conversations, say, lines };
}
const quiet = fn => async () => { const warn = console.warn; console.warn = () => {}; try { await fn(); } finally { console.warn = warn; } };

test("a save that fails, as on a full disk, neither throws nor stops later looks, and is tried again", quiet(async () => {
  const { service, conv, say, lines } = setup();
  const file = conv.file;
  // A file where its folder should be: writing there fails with ENOTDIR, as a full disk fails with ENOSPC.
  const blocker = path.join(path.dirname(file), "blocker");
  fs.writeFileSync(blocker, "");
  conv.file = path.join(blocker, "conversations.json");
  say("chat-1", "Make a film");
  await conv.tick();
  assert.equal(conv.busy, false);
  assert.equal(lines(), 1);
  assert.equal(conv.dirty, true, "what could not be saved waits for the next look");
  conv.file = file;
  say("chat-2", "Then the README");
  await conv.tick();
  assert.equal(lines(), 2, "a later look still reads new conversations");
  assert.equal(conv.dirty, false);
  assert.ok(JSON.parse(fs.readFileSync(file, "utf8"))["claude:chat-1"], "the save that failed is written by the next look");
  service.close();
}));

test("an unchanged conversation index is not written again", t => {
  const { service, conv } = setup();
  t.after(() => service.close());
  const write = fs.writeFileSync;
  let writes = 0;
  t.mock.method(fs, "writeFileSync", function(file, ...args) {
    if (String(file).startsWith(`${conv.file}.`) && String(file).endsWith(".tmp")) writes++;
    return write.call(fs, file, ...args);
  });
  conv.recordOf("claude", "chat-1");
  conv.save();
  assert.equal(writes, 1);
  conv.dirty = true;
  conv.save();
  assert.equal(writes, 1, "a dirty flag with the same records does not rewrite the index");
});

test("ENOSPC preserves the saved index, removes the partial temp file and waits before retrying", t => {
  const { service, conv } = setup();
  t.after(() => service.close());
  const rec = conv.recordOf("claude", "chat-1");
  conv.save();
  const before = fs.readFileSync(conv.file, "utf8"), write = fs.writeFileSync;
  let fail = true, attempts = 0;
  const warnings = [];
  t.mock.method(console, "warn", message => warnings.push(message));
  t.mock.method(fs, "writeFileSync", function(file, ...args) {
    if (String(file).startsWith(`${conv.file}.`) && String(file).endsWith(".tmp")) {
      attempts++;
      if (fail) {
        write.call(fs, file, "partial");
        throw Object.assign(new Error("no space left on device"), { code:"ENOSPC" });
      }
    }
    return write.call(fs, file, ...args);
  });
  rec.lastSay = "not yet durable";
  conv.dirty = true;
  conv.save();
  assert.equal(attempts, 1);
  assert.equal(conv.dirty, true);
  assert.equal(fs.readFileSync(conv.file, "utf8"), before, "the last complete index survives");
  assert.deepEqual(fs.readdirSync(path.dirname(conv.file)).filter(name => name.startsWith(`${path.basename(conv.file)}.`) && name.endsWith(".tmp")), []);
  assert.equal(warnings.filter(message => /Could not save/.test(message)).length, 1);
  fail = false;
  conv.save();
  assert.equal(attempts, 1, "an immediate look does not retry or report a misleading recovery");
  assert.equal(warnings.length, 1);
  conv.close();
  assert.equal(attempts, 2, "closing makes one final attempt even during the retry wait");
  assert.equal(conv.dirty, false);
  assert.equal(JSON.parse(fs.readFileSync(conv.file, "utf8"))["claude:chat-1"].lastSay, "not yet durable");
  assert.equal(warnings.filter(message => /works again/.test(message)).length, 1);
});

test("a look that waits forever is given up, so the next look still reads new conversations", quiet(async () => {
  const { service, conv, say, lines } = setup();
  let hung = 0;
  conv.scanCodex = () => { hung++; return new Promise(() => {}); };
  conv.tick();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(hung, 1);
  assert.equal(conv.busy, true);
  say("chat-1", "Make a film");
  await conv.tick();
  assert.equal(lines(), 0, "a look that is still getting somewhere is waited for");
  conv.lookAt = Date.now() - 10 * 60000;
  await conv.tick();
  assert.equal(lines(), 1, "a look gone minutes without progress is given up");
  assert.equal(conv.busy, false);
  // A sync someone asks for does not wait on a look that hangs either.
  conv.codexAt = 0;
  conv.tick();
  await new Promise(resolve => setTimeout(resolve, 50));
  conv.lookAt = Date.now() - 10 * 60000;
  const synced = await conv.syncRecent(service.store.projects[0]);
  assert.equal(typeof synced.added, "number");
  assert.equal(conv.busy, false);
  service.close();
}));
