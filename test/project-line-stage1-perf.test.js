"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const Tokens = require("../src/server/project-lines/token-evidence.js");
const Activity = require("../src/server/project-lines/activity.js");
const { checkpointOf } = require("../src/server/project-lines/pi-checkpoint.js");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function setup(t, http = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "perf-"))), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  let response, notify;
  const options = { directory, agents:{ available:() => [], desktop:() => null }, conversations:{ home:root, saveDebounceMs:20 }, autoWatch:false, recoverOnStart:false,
    folderWatch:{ enabled:true, watch:(_, options, callback) => { notify = callback; return { close() {} }; } } };
  const api = http && createProjectLines({ directory, agents:options.agents, serviceOptions:options, authorizeRead:() => null, send:(_, status, data) => { response = { status, data }; } });
  const service = api ? api.service : new Service(options), project = service.store.create({ name:"Perf", docsPath:path.join(root, "docs") });
  t.after(() => { if (api) api.close(); else service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { service, store:service.store, project, root, notify:name => notify("rename", name), api, response:() => response };
}
const markdown = title => F.initialLine({ title, status:"working", steps:[F.workStep({ who:"codex", done:true, took:"2s" })] });

test("ten Line and Work writes stay visible without another walk or rereading new text", t => {
  const { service, store, project, notify } = setup(t);
  const walks = t.mock.method(store, "walk"), reads = t.mock.method(fs, "readFileSync");
  service.sync(project);
  for (let index = 0; index < 10; index++) {
    const slug = `line-${index}`, rel = `works/${slug}/work-1.md`;
    store.writeText(project, `lines/${slug}.md`, markdown(slug));
    const entry = store.writeText(project, rel, slug);
    assert.equal(reads.mock.calls.some(call => call.arguments[0] === store.full(project, rel)), false);
    const loaded = store.readText(project, rel);
    assert.equal(loaded.text, entry.text);
    assert.equal(store.readText(project, rel), loaded);
    assert.equal(reads.mock.calls.filter(call => call.arguments[0] === store.full(project, rel)).length, 1);
    const scan = service.sync(project);
    assert.ok(scan.topics.some(topic => topic.slug === slug));
    assert.ok(scan.files.some(file => file.path === rel));
  }
  const intermediate = "files/agent-progress.txt";
  fs.writeFileSync(store.full(project, intermediate), "partial"); notify(intermediate);
  assert.ok(service.sync(project).files.some(file => file.path === intermediate));
  assert.equal(walks.mock.callCount(), 1);
});

test("relisting is immutable across add/delete and declines ambiguous changes", t => {
  const { store, project } = setup(t), first = store.walk(project), rel = "files/test.md";
  store.writeText(project, rel, "a");
  const added = store.relisted(project, first, [rel]);
  assert.ok(added.some(file => file.path === rel));
  assert.deepEqual(store.relisted(project, first, [rel]), added);
  fs.unlinkSync(store.full(project, rel));
  assert.deepEqual(store.relisted(project, added, [rel]), first);
  for (const name of ["files", "archive/lines/a.md"]) assert.equal(store.relisted(project, first, [name]), null);
  fs.symlinkSync(project.docsPath, store.full(project, "files/link"));
  assert.equal(store.relisted(project, first, ["files/link"]), null);
  store.maxEntries = first.length;
  assert.equal(store.relisted(project, first, ["MEMORY.md"]), null);
});

test("checkpoint bursts coalesce; caughtUp, reload and close persist the in-memory edge", async t => {
  const { service, project } = setup(t), conversations = service.conversations;
  conversations.bind("pi", "session", project, "one", project.docsPath);
  const writes = t.mock.method(fs, "renameSync"), edge = () => JSON.parse(fs.readFileSync(conversations.file))["pi:session"].piCheckpoint.at;
  for (let at = 1; at <= 50; at++) conversations.checkpointPi("session", { at });
  assert.equal(conversations.records["pi:session"].piCheckpoint.at, 50);
  assert.equal(writes.mock.callCount(), 0);
  await wait(45); assert.equal(edge(), 50);
  conversations.checkpointPi("session", { at:51 }); conversations.caughtUp("pi", "session", { release:false });
  assert.equal(edge(), 51); assert.equal(writes.mock.callCount(), 2);
  conversations.checkpointPi("session", { at:52 }); conversations.reload(); assert.equal(edge(), 52);
  conversations.checkpointPi("session", { at:53 }); conversations.close(); assert.equal(edge(), 53);
});

test("token bursts flush at finish and both state views share one parse and summary", t => {
  const { service, store, project } = setup(t), slug = "one", stepId = "work-1", detail = F.detailPath(slug, stepId);
  store.writeText(project, `lines/${slug}.md`, markdown(slug)); store.writeText(project, detail, "# Work 1\n");
  const tokenEvidence = Tokens.create({ workId:"one/work-1", taskId:"x", taskMode:"new" });
  const run = { stepId, agent:"codex", tokenEvidence, tokenAttempt:Tokens.startAttempt(tokenEvidence, { agent:"codex" }) };
  const writes = t.mock.method(store, "writeText");
  for (let index = 0; index < 12; index++) service.observeTokens(project, slug, run, { type:"system", subtype:"init", session_id:"managed" });
  assert.equal(writes.mock.callCount(), 0); assert.equal(run.tokenTimer.hasRef(), false);
  service.finishTokens(project, slug, run); assert.equal(writes.mock.callCount(), 1); assert.equal(run.tokenTimer, null);
  const exact = JSON.stringify(tokenEvidence), parses = t.mock.method(JSON, "parse"), summaries = t.mock.method(Tokens, "summary");
  const topic = store.scan(project).topics.find(topic => topic.slug === slug);
  for (let index = 0; index < 2; index++) {
    const line = service.lineFrom(project, topic); service.projectTokens(project, [line]);
    assert.equal(line.stations[0].tokens.workId, tokenEvidence.workId); assert.equal(line.stations[0].tokens.events, undefined);
  }
  assert.equal(parses.mock.calls.filter(call => call.arguments[0] === exact).length, 1);
  assert.equal(summaries.mock.callCount(), 1);
});

test("keeper snapshots wait 500ms, skip identical writes and persist transitions immediately", async t => {
  const { service, project, root } = setup(t), run = { keepDir:root, now:"starting" }, file = path.join(root, "run.json");
  const writes = t.mock.method(fs, "renameSync");
  service.keepNote(project, "one", run); await wait(150); assert.equal(fs.existsSync(file), false);
  await wait(420); assert.equal(JSON.parse(fs.readFileSync(file)).fields.now, "starting");
  service.keepNote(project, "one", run, true); assert.equal(writes.mock.callCount(), 1);
  run.now = "waiting"; service.keepNote(project, "one", run); service.keepNote(project, "one", run, true);
  assert.equal(writes.mock.callCount(), 2); assert.equal(run.keepTimer, null); assert.equal(JSON.parse(fs.readFileSync(file)).fields.now, "waiting");
});

test("periodic tokens persist during a long run but never overwrite its successor", async t => {
  const { service, store, project } = setup(t), key = service.key(project, "one"), file = "works/one/work-1.tokens.json";
  const run = { stepId:"work-1", launchId:"original", place:{ project, slug:"one" }, tokenEvidence:{ value:1 }, tokenAttempt:{ complete:true } };
  service.runs.set(key, run);
  service.saveTokens(project, "one", run);
  run.tokenEvidence.value = 2; service.saveTokens(project, "one", run);
  assert.equal(store.exists(project, file), false);
  await wait(1550); assert.equal(store.readText(project, file).text, '{"value":2}');
  run.tokenEvidence.value = 3; service.saveTokens(project, "one", run);
  const replacement = { ...run, launchId:"replacement", tokenEvidence:{ value:4 }, tokenTimer:null };
  service.runs.set(key, replacement); service.saveTokens(project, "one", replacement, { immediate:true });
  await wait(1550); assert.equal(store.readText(project, file).text, '{"value":4}');
  replacement.tokenEvidence.value = 5; service.saveTokens(project, "one", replacement);
  service.close(); assert.equal(store.readText(project, file).text, '{"value":5}'); assert.equal(replacement.tokenTimer, null);
});

test("both stream consumers preserve JSON semantics: zero parses for noise, one per other frame", t => {
  const { service, project } = setup(t), run = { dialect:"pi" };
  t.mock.method(service, "applyChanges", () => {});
  const parses = t.mock.method(JSON, "parse");
  for (const type of ["message_update", "message_start", "turn_start", "turn_end", "tool_execution_update"]) {
    assert.equal(service.outputFrame(project, "one", run, JSON.stringify({ type, payload:[{}, { type:"agent_end", nested:[1, true, null] }] })), null);
    assert.equal(service.outputFrame(project, "one", run, JSON.stringify({ payload:{ type:"agent_end" }, type })), null);
  }
  assert.equal(parses.mock.callCount(), 0);
  for (const raw of ['{"type":"message_update","type":"agent_end"}', '{"type":"message_start","t\\u0079pe":"agent_end"}', '{"nested":{"type":"turn_end"},"type":"agent_end"}', '{"type":"turn_start","x":[,]}', '{"type":"message_end","message":{"role":"assistant","timestamp":1,"content":[]}}']) {
    const before = parses.mock.callCount(), event = service.outputFrame(project, "one", run, raw);
    assert.equal(parses.mock.callCount() - before, 1);
    if (event) for (const read of [Activity.parseLine, Activity.isResult, Activity.backgroundOf, checkpointOf, value => Activity.parseDialect("pi", value, {})]) assert.deepEqual(read(event), read(raw));
  }
});

test("GET state responds without joining the outstanding branch refresh", async t => {
  const { service, api, project, response } = setup(t, true);
  project.trunkCache = { name:"main" };
  const refresh = t.mock.method(service, "refreshBranches", () => new Promise(() => {}));
  const settled = t.mock.method(service, "branchesSettled", () => { throw Error("unexpected wait"); });
  await api.handle({ method:"GET", headers:{} }, {}, new URL(`http://localhost/api/lines/projects/${project.id}/state`));
  assert.equal(response().status, 200, JSON.stringify(response())); assert.ok(response().data.rev);
  assert.ok(refresh.mock.callCount()); assert.equal(settled.mock.callCount(), 0);
});

test("a removed docs folder after sync is reported missing by both stateOf and summaryOf", async t => {
  const { service, project, root } = setup(t);
  await service.createNote(project, { title:"Keep me" });
  const moved = path.join(root, "docs-moved");
  fs.renameSync(project.docsPath, moved);
  assert.throws(() => service.sync(project), error => error.code === "FOLDER_MISSING" && error.status === 410);
  assert.throws(() => service.stateOf(project), error => error.code === "FOLDER_MISSING" && error.status === 410);
  assert.equal(service.summaryOf(project).missing, true);
});

test("strict and immediate snapshots restore missing files; strict never hides a write failure", t => {
  const { service, project, root } = setup(t), run = { keepDir:root }, file = path.join(root, "run.json");
  service.keepNote(project, "one", run, true);
  for (const strict of [false, true]) {
    fs.unlinkSync(file); service.keepNote(project, "one", run, true, { strict });
    assert.equal(JSON.parse(fs.readFileSync(file)).slug, "one");
  }
  t.mock.method(fs, "renameSync", () => { throw Object.assign(Error("denied"), { code:"EACCES" }); });
  assert.throws(() => service.keepNote(project, "one", run, true, { strict:true }), { code:"EACCES" });
});

test("an editor replacing a write or racing a generated status keeps the newer generation", t => {
  const { service, project, store } = setup(t), rel = "lines/one.md", file = store.full(project, rel);
  const editor = F.setFront(markdown("Editor title"), { status:"waiting" }), rename = fs.renameSync;
  const replace = () => { fs.writeFileSync(file + ".editor", editor); rename(file + ".editor", file); };
  const hook = t.mock.method(fs, "renameSync", (from, to) => { rename(from, to); if (to === file) replace(); });
  assert.equal(store.writeText(project, rel, markdown("Old title")).text, editor);
  assert.equal(store.readText(project, rel).text, editor); hook.mock.restore();
  store.writeText(project, rel, markdown("Old title"));
  const write = store.writeText.bind(store); let raced = false;
  t.mock.method(store, "writeText", (p, name, text, options) => {
    if (!raced && name === rel) { replace(); raced = true; }
    return write(p, name, text, options);
  });
  const topic = service.sync(project).topics.find(topic => topic.slug === "one");
  assert.ok(raced); assert.equal(topic.title, "Editor title"); assert.equal(topic.doc.status, "waiting");
  assert.match(fs.readFileSync(file, "utf8"), /\[!status\].*needs you/);
});

test("incremental inventory rejects symlink parents, sibling ghosts and case aliases, ignoring temporary trees", t => {
  const { store, project, root } = setup(t), dir = store.full(project, "files/owned"), rel = "files/owned/a.txt";
  fs.mkdirSync(dir); for (const name of ["a.txt", "b.txt"]) fs.writeFileSync(path.join(dir, name), name);
  const listed = store.walk(project);
  assert.equal(require("../src/server/project-lines/store.js").leftOut("files/build.tmp/a.txt"), true);
  assert.deepEqual(store.relisted(project, listed, ["files/build.tmp/a.txt"]), listed);
  if (["darwin", "win32"].includes(process.platform)) {
    fs.renameSync(path.join(dir, "a.txt"), path.join(dir, "A.txt"));
    assert.equal(store.relisted(project, listed, ["files/owned/A.txt"]), null);
    fs.renameSync(path.join(dir, "A.txt"), path.join(dir, "a.txt"));
  }
  const moved = path.join(root, "moved"); fs.renameSync(dir, moved);
  assert.equal(store.relisted(project, listed, [rel]), null);
  fs.symlinkSync(moved, dir, "dir"); assert.equal(store.relisted(project, listed, [rel]), null);
  assert.ok(!store.walk(project).some(file => file.path.startsWith("files/owned/")));
});

test("partial archive rollback and failed history pruning invalidate the warm inventory", t => {
  const { store, service, project } = setup(t), rel = "lines/partial.md";
  store.writeText(project, rel, markdown("Partial")); store.writeText(project, "works/partial/work-1.md", "before");
  service.sync(project);
  const walks = t.mock.method(store, "walk"), rename = fs.renameSync, archived = store.full(project, `archive/${rel}`);
  const fail = t.mock.method(fs, "renameSync", (from, to) => {
    if (from === archived || to.endsWith("/archive/works/partial")) throw Error("injected move failure");
    return rename(from, to);
  });
  assert.equal(store.placeLine(project, "partial", true), false); assert.ok(fs.existsSync(archived)); fail.mock.restore();
  service.folderList(project); assert.equal(walks.mock.callCount(), 1);
  const list = fs.readdirSync, history = path.join(project.docsPath, ".history");
  const failPrune = t.mock.method(fs, "readdirSync", (dir, ...options) => { if (dir === history) throw Error("injected prune failure"); return list(dir, ...options); });
  assert.throws(() => store.keepHistory(project, rel, "snapshot"), /prune failure/); failPrune.mock.restore();
  assert.ok(service.folderList(project).some(file => file.path.startsWith(".history/") && file.path.endsWith("__lines__partial.md")));
  assert.equal(walks.mock.callCount(), 2);
});

test("closing a Work discovers unwatched outputs and Widget timestamp-only updates are visible", async t => {
  const { service, store, project, notify } = setup(t), slug = "one", source = "files/one/view.penecho.json";
  store.writeText(project, "lines/one.md", markdown(slug));
  const bundle = require("../src/server/project-lines/canvas-file.js").newBundle({ id:"one", name:"Canvas" });
  bundle.assets.push({ kind:"widget", metadata:{ widgetId:"widget-1" }, dataBase64:Buffer.from(JSON.stringify({ html:"<p>Hello</p>" })).toString("base64") });
  store.writeText(project, source, JSON.stringify(bundle));
  const [widget] = service.widgetSources(project, source), widgetRel = path.relative(project.docsPath, widget.file);
  const before = service.sync(project).files.find(file => file.path === widgetRel).mtime;
  const later = new Date(before + 15000); fs.utimesSync(store.full(project, source), later, later);
  const walks = t.mock.method(store, "walk"); service.widgetSources(project, source);
  assert.equal(service.folderList(project).find(file => file.path === widgetRel).mtime, fs.statSync(widget.file).mtimeMs);
  assert.notEqual(fs.statSync(widget.file).mtimeMs, before);
  const name = "files/one/intermediate.txt"; fs.writeFileSync(store.full(project, name), "ready");
  assert.ok(!service.folderList(project).some(file => file.path === name));
  await service.closeDetail(project, slug, "work-1", { result:"done" });
  assert.ok(service.sync(project).files.some(file => file.path === name)); assert.equal(walks.mock.callCount(), 0);
  const laterOutput = "files/one/second.txt"; fs.writeFileSync(store.full(project, laterOutput), "changed");
  fs.appendFileSync(store.full(project, "lines/one.md"), "\nEdited outside PenEcho\n"); notify("lines/one.md");
  assert.ok(service.folderList(project).some(file => file.path === laterOutput)); assert.equal(walks.mock.callCount(), 0);
});

test("process.exit flushes a pending Pi checkpoint and token evidence", t => {
  const { root, project } = setup(t), directory = path.join(root, "state");
  const script = `const {Service}=require('./src/server/project-lines/service');
    const s=new Service({directory:process.argv[1],autoWatch:false,recoverOnStart:false,conversations:{home:process.argv[2]}}), p=s.store.get(process.argv[3]);
    const run={stepId:'work-1',place:{project:p,slug:'one'},tokenEvidence:{value:7}};
    s.runs.set(s.key(p,'one'),run);s.saveTokens(p,'one',run);s.conversations.bind('pi','exit',p,'one',p.docsPath);
    s.conversations.checkpointPi('exit',{at:42,hash:'saved'});process.exit(0);`;
  const result = require("node:child_process").spawnSync(process.execPath, ["-e", script, directory, root, project.id], { encoding:"utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "conversations.json")))["pi:exit"].piCheckpoint, { at:42, hashes:["saved"] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project.docsPath, "works/one/work-1.tokens.json"))), { value:7 });
});

test("reattach replays unsaved Pi usage and a split UTF-8 frame without duplicating tool rows or checkpoints", async t => {
  const { service, store, project, root } = setup(t), directory = path.join(root, "state"), dir = path.join(root, "keeper"), slug = "one", stepId = "work-1";
  const file = path.join(dir, "run.json"), offsets = () => JSON.parse(fs.readFileSync(file)).offsets;
  fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "spec.json"), "{}");
  store.writeText(project, "lines/one.md", markdown(slug));
  service.conversations.bind("pi", "session", project, slug, root);
  const evidence = Tokens.create({ workId:"one/work-1", taskId:"x", taskMode:"new" }), attempt = Tokens.startAttempt(evidence, { agent:"pi" });
  store.writeText(project, "works/one/work-1.tokens.json", JSON.stringify(evidence));
  fs.writeFileSync(file, JSON.stringify({ projectId:project.id, slug, offsets:{ out:0, err:0 }, attempt:attempt.id, fields:{ agent:"pi", dialect:"pi", stepId, sessionId:"session", bound:"session" } }));
  const frame = id => ({ type:"message_end", message:{ role:"assistant", id, timestamp:123, usage:{ input:5, output:3, cacheRead:0, cacheWrite:0 }, stopReason:"toolUse", content:[{ type:"text", text:id }, { type:"toolCall", id, name:"edit", arguments:{ path:"猫" } }] } });
  const events = [frame("one"), frame("two")], [first, second] = events.map(event => Buffer.from(JSON.stringify(event) + "\n"));
  const cut = second.indexOf(Buffer.from("猫")) + 1, prefix = Buffer.from('{"type":"turn_start"}\n');
  fs.writeFileSync(path.join(dir, "out"), Buffer.concat([prefix, first, second]));
  const attach = current => {
    const { EventEmitter } = require("node:events");
    current.conversations.saveDebounceMs = 60000;
    t.mock.method(current, "takeLine", () => {});
    t.mock.method(current.keeper, "attach", (_, offsets) => Object.assign(new EventEmitter(), { offsets, kept:true, dir, stdout:new EventEmitter(), stderr:new EventEmitter(), detach() {} }));
    assert.equal(current.reattach({ keep:dir }), true);
    const run = current.runs.get(current.key(project, slug));
    return { run, feed(bytes) { run.child.stdout.emit("data", bytes); run.child.offsets.out += bytes.length; } };
  };
  const original = attach(service); original.feed(prefix); original.feed(first); original.feed(second.subarray(0, cut));
  await wait(580); assert.equal(offsets().out, prefix.length);
  assert.equal(original.run.tokenDirtyOffset, prefix.length); assert.equal(original.run.piDirtyOffset, prefix.length);
  service.conversations.flush(); await wait(540);
  assert.equal(original.run.piDirtyOffset, null); assert.equal(offsets().out, prefix.length);
  clearTimeout(original.run.tokenTimer); clearTimeout(service.conversations.saveTimer); service.runs.clear();
  const restarted = new Service({ directory, autoWatch:false, recoverOnStart:false, conversations:{ home:root } });
  t.after(() => restarted.close());
  const replay = attach(restarted); assert.equal(replay.run.child.offsets.out, prefix.length);
  replay.feed(first); replay.feed(second.subarray(0, cut));
  restarted.saveTokens(project, slug, replay.run, { immediate:true }); await wait(540);
  assert.equal(replay.run.tokenDirtyOffset, null); assert.equal(offsets().out, prefix.length);
  restarted.keepNote(project, slug, replay.run, true);
  assert.equal(offsets().out, prefix.length + first.length);
  assert.equal(replay.run.tokenDirtyOffset, null); assert.equal(replay.run.piDirtyOffset, null);
  replay.feed(second.subarray(cut)); restarted.keepNote(project, slug, replay.run, true);
  assert.equal(offsets().out, prefix.length + first.length + second.length);
  const saved = restarted.tokensOfDetail(project, F.detailPath(slug, stepId)).attempts[0];
  assert.deepEqual(saved.requests.map(request => request.id), ["one", "two"]);
  assert.equal(saved.totals.inputTokens, 10); assert.equal(saved.totals.outputTokens, 6);
  assert.deepEqual(JSON.parse(fs.readFileSync(restarted.conversations.file))["pi:session"].piCheckpoint, { at:123, hashes:events.map(event => checkpointOf(event).hash) });
  assert.deepEqual(restarted.activity.load(project, slug).rows.filter(row => row.kind === "tool").map(row => row.id), ["one", "two"]);
  assert.deepEqual(restarted.activity.load(project, slug).rows.filter(row => row.kind === "say").map(row => row.text), ["one", "two"]);
});

test("Round 2 fixes: pre-rename editor race, Claude replay dedupe, pi-rpc launch filter, warm stateOf 0-walk, and parent case alias", async t => {
  const { service, store, project, root } = setup(t), directory = path.join(root, "state");

  // P1-7: 10 ordinary Work updates + sync() + stateOf() must not re-walk on stateOf().
  const walks = t.mock.method(store, "walk");
  store.writeText(project, "lines/warm.md", markdown("Warm"));
  service.sync(project);
  service.stateOf(project);
  const baseWalks = walks.mock.callCount();
  for (let i = 1; i <= 10; i++) {
    store.writeText(project, `works/warm/work-${i}.md`, `# Work ${i}\n\nDone ${i}.\n`);
    service.sync(project);
    const st = service.stateOf(project);
    assert.ok(st.files.some(f => f.path === `works/warm/work-${i}.md`));
  }
  assert.equal(walks.mock.callCount(), baseWalks, "warm stateOf reuses folderWatch listed inventory with zero extra walks");

  // P0-1: atomic editor save arriving AFTER baseHash check and BEFORE renameSync is preserved by syncGenerated.
  const raceRel = "lines/race.md", raceFile = store.resolve(project, raceRel, { forWrite:true });
  store.writeText(project, raceRel, markdown("Original title"));
  const editorText = F.setFront(markdown("Editor title"), { status:"waiting" });
  const origWrite = fs.writeFileSync;
  let injected = false;
  const writeHook = t.mock.method(fs, "writeFileSync", (target, data, ...rest) => {
    origWrite.call(fs, target, data, ...rest);
    if (!injected && typeof target === "string" && target.startsWith(`${raceFile}.`) && target.endsWith(".tmp")) {
      injected = true;
      origWrite.call(fs, `${raceFile}.editor`, editorText);
      fs.renameSync(`${raceFile}.editor`, raceFile);
    }
  });
  const synced = service.sync(project);
  writeHook.mock.restore();
  assert.equal(injected, true);
  const raceTopic = synced.topics.find(topic => topic.slug === "race");
  assert.equal(raceTopic.title, "Editor title");
  assert.equal(raceTopic.doc.status, "waiting");
  assert.match(fs.readFileSync(raceFile, "utf8"), /# Editor title/);

  // P2-1: new leaf under a parent directory's case alias falls back cleanly on case-insensitive volumes.
  if (["darwin", "win32"].includes(process.platform)) {
    fs.mkdirSync(path.join(project.docsPath, "files", "report"), { recursive:true });
    const beforeWalk = store.walk(project);
    fs.writeFileSync(path.join(project.docsPath, "files", "report", "new.txt"), "hi");
    assert.equal(store.relisted(project, beforeWalk, ["files/Report/new.txt"]), null, "wrong parent casing falls back to walk");
  }

  // P1-1: Claude reply replayed on reattach before debounced saveTokens flushes is not duplicated in activity.
  const dir = path.join(root, "claude-keep"), slug = "claude-one", stepId = "work-1";
  fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "spec.json"), "{}");
  store.writeText(project, `lines/${slug}.md`, markdown(slug));
  const ev = Tokens.create({ workId:`${slug}/${stepId}`, taskId:"t1", taskMode:"new" });
  const attempt = Tokens.startAttempt(ev, { agent:"claude" });
  store.writeText(project, F.detailPath(slug, stepId).replace(/\.md$/, ".tokens.json"), JSON.stringify(ev));
  const runFile = path.join(dir, "run.json");
  fs.writeFileSync(runFile, JSON.stringify({ projectId:project.id, slug, launchId:"launch-c1", offsets:{ out:0, err:0 }, attempt:attempt.id, fields:{ agent:"claude", dialect:"", stepId } }));
  const claudeFrame = Buffer.from(JSON.stringify({
    type:"assistant",
    message:{ id:"msg_1", role:"assistant", model:"claude-sonnet-4", content:[{ type:"text", text:"Hello once" }], usage:{ input_tokens:12, output_tokens:4 } },
  }) + "\n");
  fs.writeFileSync(path.join(dir, "out"), claudeFrame);
  const { EventEmitter } = require("node:events");
  const mockAttach = svc => {
    t.mock.method(svc, "takeLine", () => {});
    t.mock.method(svc.keeper, "attach", (_, offsets) => Object.assign(new EventEmitter(), { offsets, kept:true, dir, stdout:new EventEmitter(), stderr:new EventEmitter(), detach() {} }));
    assert.equal(svc.reattach({ keep:dir }), true);
    const run = svc.runs.get(svc.key(project, slug));
    return { run, feed(bytes) { run.child.stdout.emit("data", bytes); run.child.offsets.out += bytes.length; } };
  };
  const firstRun = mockAttach(service);
  firstRun.feed(claudeFrame);
  await wait(550);
  assert.equal(JSON.parse(fs.readFileSync(runFile)).offsets.out, 0, "offset stays clamped behind unsaved Claude tokens");
  clearTimeout(firstRun.run.tokenTimer); service.runs.clear();
  const restarted = new Service({ directory, autoWatch:false, recoverOnStart:false, conversations:{ home:root } });
  t.after(() => restarted.close());
  const replay = mockAttach(restarted);
  replay.feed(claudeFrame);
  restarted.saveTokens(project, slug, replay.run, { immediate:true });
  assert.deepEqual(restarted.activity.load(project, slug).rows.filter(r => r.kind === "say").map(r => r.text), ["Hello once"], "Claude reply is not duplicated on replay");
  assert.equal(restarted.tokensOfDetail(project, F.detailPath(slug, stepId)).attempts[0].requests.length, 1);

  // P1-2: plain Pi/omp RPC launch passes streamFilter:"pi-rpc" into agentSpawn.
  const spawnCalls = [];
  const fakeChild = Object.assign(new EventEmitter(), { stdout:new EventEmitter(), stderr:new EventEmitter(), stdin:Object.assign(new EventEmitter(), { write() {}, end() {} }), kept:true, dir:path.join(root, "pi-keep"), offsets:{ out:0, err:0 }, detach() {}, kill() {} });
  fs.mkdirSync(fakeChild.dir, { recursive:true });
  const piSvc = new Service({
    directory:path.join(root, "pi-state"), autoWatch:false, recoverOnStart:false, conversations:{ home:root },
    agents:{
      available:() => [{ id:"pi", available:true }],
      desktop:() => null,
      command:() => ({ command:"pi", args:["--mode", "rpc"], cwd:project.docsPath, input:"pi-rpc", dialect:"pi", env:{} }),
    },
  });
  t.after(() => piSvc.close());
  const piProject = piSvc.store.create({ name:"PiFilter", docsPath:path.join(root, "pi-docs") });
  t.mock.method(piSvc, "agentSpawn", (cmd, args, opts) => { spawnCalls.push({ cmd, args, opts }); return fakeChild; });
  const created = await piSvc.createTopic(piProject, { title:"Pi launch", text:"Run pi", agent:"pi", start:true });
  assert.ok(created.slug);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].opts.streamFilter, "pi-rpc", "Pi/omp RPC launch enables keeper streamFilter");
});

test("Round 3 fixes: post-rename same-inode edit, Pi filtered-grouping replay dedupe, and legacy Codex exit-cap recovery", async t => {
  const { service, store, project, root } = setup(t), directory = path.join(root, "state");

  // P0: post-rename same-inode in-place edit preserving size and mtime (changing ctime) is not masked by writeText cache or overwritten by next syncGenerated.
  const archSlug = "archived-one", archRel = `lines/${archSlug}.md`;
  const origArch = F.initialLine({ title:"Original", status:"landed", steps:[F.workStep({ who:"codex", done:true, took:"2s" })] });
  store.writeText(project, archRel, origArch);
  const archFile = store.resolve(project, archRel);
  assert.ok(archFile.includes(`${path.sep}archive${path.sep}`), "landed Line lives under archive/");
  const stat = fs.statSync, original = stat(archFile);
  let editedInPlace = false;
  const statHook = t.mock.method(fs, "statSync", (file, ...args) => {
    const observed = stat(file, ...args);
    if (!editedInPlace && file === archFile && observed.ino !== original.ino) {
      editedInPlace = true;
      const current = fs.readFileSync(archFile, "utf8");
      const edited = current.replace("# Original", "# Edited!!");
      assert.equal(Buffer.byteLength(edited), Buffer.byteLength(current));
      fs.writeFileSync(archFile, edited);
      fs.utimesSync(archFile, observed.atime, observed.mtime);
      return stat(file, ...args);
    }
    return observed;
  });
  store.syncGenerated(project, "trunk-a");
  statHook.mock.restore();
  assert.equal(editedInPlace, true);
  assert.match(store.readText(project, archRel).text, /# Edited!!/, "readText returns post-rename in-place edit, never stale Original");
  store.syncGenerated(project, "trunk-b");
  assert.match(fs.readFileSync(archFile, "utf8"), /# Edited!!/, "next syncGenerated preserves post-rename in-place edit");

  // P1-2: Pi assistant reply without timestamp does not duplicate after crash when filtering changes read grouping.
  const piDir = path.join(root, "pi-group-keep"), piSlug = "pi-group", piStep = "work-1";
  fs.mkdirSync(piDir);
  fs.writeFileSync(path.join(piDir, "spec.json"), JSON.stringify({ streamFilter:"pi-rpc" }));
  fs.writeFileSync(path.join(piDir, "pid.json"), JSON.stringify({ keeper:process.pid, agent:process.pid }));
  store.writeText(project, `lines/${piSlug}.md`, markdown(piSlug));
  const piEv = Tokens.create({ workId:`${piSlug}/${piStep}`, taskId:"t-pi", taskMode:"new" });
  const piAttempt = Tokens.startAttempt(piEv, { agent:"pi" });
  store.writeText(project, F.detailPath(piSlug, piStep).replace(/\.md$/, ".tokens.json"), JSON.stringify(piEv));
  const piRunFile = path.join(piDir, "run.json");
  fs.writeFileSync(piRunFile, JSON.stringify({ projectId:project.id, slug:piSlug, launchId:"launch-pi-grp", offsets:{ out:0, err:0 }, attempt:piAttempt.id, fields:{ agent:"pi", dialect:"pi", stepId:piStep } }));
  const piFrame1 = Buffer.from(JSON.stringify({ type:"message_end", message:{ role:"assistant", id:"p1", timestamp:100, usage:{ input:4, output:2, cacheRead:0, cacheWrite:0 }, content:[{ type:"text", text:"First reply" }] } }) + "\n");
  const piNoise = Buffer.from(JSON.stringify({ type:"message_update", assistantMessageEvent:{ type:"text_delta", delta:"x".repeat(20) } }) + "\n");
  const piFrame3 = Buffer.from(JSON.stringify({ type:"message_end", message:{ role:"assistant", id:"p2", usage:{ input:3, output:1, cacheRead:0, cacheWrite:0 }, content:[{ type:"text", text:"Reply without timestamp" }] } }) + "\n");
  const piOut = path.join(piDir, "out");
  fs.writeFileSync(piOut, piFrame1);
  t.mock.method(service, "takeLine", () => {});
  assert.equal(service.reattach({ keep:piDir }), true);
  const piRun1 = service.runs.get(service.key(project, piSlug));
  const waitUntil = async (fn, label) => {
    const end = Date.now() + 5000;
    while (!fn()) { assert.ok(Date.now() < end, `timed out waiting for ${label}`); await wait(10); }
  };
  await waitUntil(() => piRun1.child.offsets.out === piFrame1.length, "live frame 1");
  fs.appendFileSync(piOut, piNoise);
  piRun1.child.pump("out");
  await waitUntil(() => piRun1.child.offsets.out === piFrame1.length + piNoise.length, "live dropped noise");
  fs.appendFileSync(piOut, piFrame3);
  piRun1.child.pump("out");
  await waitUntil(() => piRun1.child.offsets.out === piFrame1.length + piNoise.length + piFrame3.length, "live frame 3");
  await wait(550);
  assert.equal(JSON.parse(fs.readFileSync(piRunFile, "utf8")).offsets.out, 0, "durable offset stays pinned at 0 while tokens are debounced");
  const liveSays = service.activity.load(project, piSlug).rows.filter(r => r.kind === "say").map(r => r.text);
  assert.deepEqual(liveSays, ["First reply", "Reply without timestamp"]);
  clearTimeout(piRun1.tokenTimer);
  piRun1.child.detach();
  service.runs.clear();

  const restartedPi = new Service({ directory, autoWatch:false, recoverOnStart:false, conversations:{ home:root } });
  t.after(() => restartedPi.close());
  t.mock.method(restartedPi, "takeLine", () => {});
  assert.equal(restartedPi.reattach({ keep:piDir }), true);
  const piRun2 = restartedPi.runs.get(restartedPi.key(project, piSlug));
  await waitUntil(() => piRun2.child.offsets.out === piFrame1.length + piNoise.length + piFrame3.length, "batched reattach replay");
  restartedPi.saveTokens(project, piSlug, piRun2, { immediate:true });
  piRun2.child.detach();
  const replayedSays = restartedPi.activity.load(project, piSlug).rows.filter(r => r.kind === "say").map(r => r.text);
  assert.deepEqual(replayedSays, ["First reply", "Reply without timestamp"], "Pi reply without timestamp is not duplicated on batched reattach");
  assert.equal(restartedPi.tokensOfDetail(project, F.detailPath(piSlug, piStep)).attempts[0].totals.inputTokens, 7);

  // P1-3: legacy Codex recovery respects exit.json outSize cap and ignores post-exit descendant turn/completed.
  const cxDir = path.join(root, "codex-legacy-keep"), cxSlug = "codex-legacy", cxStep = "work-1";
  fs.mkdirSync(cxDir);
  fs.writeFileSync(path.join(cxDir, "spec.json"), "{}");
  store.writeText(project, `lines/${cxSlug}.md`, markdown(cxSlug));
  const fgFail = `${JSON.stringify({ method:"turn/completed", params:{ threadId:"thr-1", turn:{ id:"turn-1", status:"failed", error:{ message:"foreground failed" } } } })}\n`;
  const bgSuccess = `${JSON.stringify({ method:"turn/completed", params:{ threadId:"thr-1", turn:{ id:"turn-1", status:"completed" } } })}\n`;
  const cxOut = path.join(cxDir, "out");
  fs.writeFileSync(cxOut, fgFail + bgSuccess);
  const fgBytes = Buffer.byteLength(fgFail);
  fs.writeFileSync(path.join(cxDir, "exit.json"), JSON.stringify({ code:7, signal:null, outSize:fgBytes, errSize:0, at:Date.now() }));
  fs.writeFileSync(path.join(cxDir, "run.json"), JSON.stringify({
    projectId:project.id, slug:cxSlug, launchId:"launch-cx-legacy",
    mode:{ protocol:"app-server", phase:"turn" },
    offsets:{ out:fgBytes, err:0 },
    fields:{ agent:"codex", stepId:cxStep, threadId:"thr-1", turnId:"turn-1", runtimeDone:true },
  }));
  const RunWatch = require("../src/server/project-lines/run-watch.js");
  assert.equal(RunWatch.lastRows(cxOut, undefined, { maxSize:fgBytes }).length, 1);
  assert.equal(RunWatch.lastRows(cxOut, undefined, { maxSize:fgBytes })[0].params.turn.status, "failed");
  const endedCodes = [];
  const cxSvc = new Service({ directory, autoWatch:false, recoverOnStart:false, conversations:{ home:root } });
  t.after(() => cxSvc.close());
  t.mock.method(cxSvc, "takeLine", () => {});
  t.mock.method(cxSvc, "captureCodexRuntime", async () => {});
  t.mock.method(cxSvc, "ended", async (_p, _s, _r, code) => { endedCodes.push(code); });
  assert.equal(cxSvc.reattach({ keep:cxDir }), true);
  await waitUntil(() => endedCodes.length === 1, "legacy Codex recovery finalization");
  assert.notEqual(endedCodes[0], 0, "legacy Codex recovery ignores post-exit descendant completion and does not finalize as success");
});
