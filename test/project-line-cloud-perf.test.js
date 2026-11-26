"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const { Store } = require("../src/server/project-lines/store.js");
const { Service } = require("../src/server/project-lines/service.js");
const { createCloudShare } = require("../src/server/project-lines/cloud-share.js");
const { createCloudSync } = require("../src/server/project-lines/cloud-sync.js");
const { syncScope } = require("../src/server/project-lines/sync-scope.js");
const { viewFor } = require("../src/server/project-lines/cloud-view.js");
const F = require("../src/server/project-lines/format.js");
const Tokens = require("../src/server/project-lines/token-evidence.js");

const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, ms = 3000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`);
    await wait(5);
  }
}
function temporary(t, prefix) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(folder, { recursive:true, force:true }));
  return folder;
}

// A real folder and sync state, with only Cloud replaced in memory. The first publication goes through manifest(), then the
// scheduled Cloud view goes through syncScope()/viewFor() exactly as http.js wires them.
test("one inventory serves manifest, sync scope and the view; pulled files invalidate that scope", async t => {
  const temp = temporary(t, "penecho-cloud-perf-share-");
  const store = new Store({ directory:path.join(temp, "registry"), reconcile:false });
  const project = store.create({ name:"Perf", docsPath:path.join(temp, "docs") });
  project.cloud = { sync:true, owner:JSON.stringify(["", "Owner"]) };
  let state = {
    format:2, rev:"r1", project:{ id:project.id, name:project.name }, lines:[], landed:[], backlog:[],
    files:[{ path:"MEMORY.md" }], notes:[], pictures:[], artifacts:[], latestFiles:[], knowledge:[], tokens:{ records:[], starts:[] },
  };
  const service = Object.create(Service.prototype);
  service.store = store;
  service.stateOf = () => state;
  service.projectTokens = () => ({ records:[], starts:[] });
  let walks = 0, touches = 0, scopeCalls = 0;
  const walkInventories = [];
  const walk = store.walk.bind(store);
  store.walk = (...args) => { walks++; const files = walk(...args); walkInventories.push(files.map(file => file.path)); return files; };
  service.folderWatch = { touch:() => { touches++; } };

  let remote = null;
  const blobs = new Map(), views = [], viewOptions = [], scopeInventories = [];
  const connector = {
    status:() => ({ accountSession:{ signedIn:true }, account:{ name:"Owner" } }),
    async cloudRequest(pathname, options = {}) {
      const method = options.method || "GET";
      if (method === "PUT" && pathname.endsWith("/view")) {
        views.push(JSON.parse(zlib.gunzipSync(options.bytes).toString("utf8")));
        return { ok:true };
      }
      if (method === "POST" && pathname.endsWith("/commit")) {
        assert.equal(options.body.rev, 0);
        remote = { rev:1, files:options.body.put.map(file => ({ path:file.path, sha256:file.sha256, size:file.size, modified:file.modified })) };
        return { rev:remote.rev };
      }
      if (method === "GET") {
        if (!remote) return { project:null };
        const since = Number(/\?since=(\d+)$/.exec(pathname)?.[1]);
        if (since && remote.rev <= since) return { rev:remote.rev, changed:false };
        return { project:{ key:project.id, name:project.name, rev:remote.rev }, rev:remote.rev, changed:true, files:remote.files, running:[] };
      }
      throw new Error(`Unexpected Cloud request: ${method} ${pathname}`);
    },
    async accountFetch(pathname) {
      const bytes = blobs.get(pathname.split("/").pop());
      if (!bytes) return new Response("missing", { status:404 });
      return new Response(bytes);
    },
  };
  const scope = (p, opts) => {
    scopeCalls++;
    scopeInventories.push(opts?.files?.map(file => file.path) || null);
    return syncScope(service, p, opts);
  };
  const holders = new Map();
  const share = createCloudShare({
    store, connector, directory:path.join(temp, "cloud"), viewEveryMs:0, scope,
    pageView:(p, base, dbRev, opts) => {
      viewOptions.push(opts || null);
      return viewFor(service, p, holders, base, dbRev, scope, opts || undefined);
    },
    onChanged:() => { state = { ...state, rev:"r2", files:[...state.files.filter(file => file.path !== "README.md"), { path:"README.md" }] }; },
  });
  t.after(() => share.close());

  const first = await share.syncNow(project);
  assert.equal(first.changed, false, "publishing the initial snapshot is not a local pull/merge");
  await until(() => views.length === 1, "the first Cloud view");
  assert.equal(walks, 1, "manifest + scope + view walk once, not three times");
  assert.equal(scopeCalls, 1, "the view reuses the scope made by manifest");
  assert.equal(touches, 0, "Cloud scope never invalidates folderWatch");
  assert.ok(viewOptions[0]?.keep instanceof Set);
  assert.ok(viewOptions[0].keep.has("MEMORY.md"));
  assert.ok(Array.isArray(viewOptions[0]?.files), "the same raw inventory is handed to the view");
  assert.ok(views[0].state, "the first view is a complete, valid JSON view");

  // A Cloud-only knowledge file is pulled locally. The scope from before that pull must not be reused for the next view.
  const bytes = Buffer.from("# Brought from Cloud\n"), hash = sha(bytes);
  blobs.set(hash, bytes);
  remote.files.push({ path:"README.md", sha256:hash, size:bytes.length });
  remote.rev++;
  const before = walks;
  const second = await share.syncNow(project);
  assert.equal(second.changed, true);
  await until(() => views.length === 2, "the changed Cloud view");
  assert.equal(fs.readFileSync(path.join(project.docsPath, "README.md"), "utf8"), bytes.toString());
  assert.equal(walks - before, 2, "a changed round walks for its manifest and again for a fresh view scope");
  assert.equal(scopeCalls, 3, "the changed view recomputes scope instead of consuming the pre-pull scope");
  assert.equal(viewOptions[1], null, "no stale keep scope reaches the changed view");
  assert.equal(scopeInventories[1].includes("README.md"), false, "the manifest inventory predates the pull");
  assert.equal(scopeInventories[2], null, "the changed view falls back to a fresh walk");
  assert.equal(walkInventories[2].includes("README.md"), true, "the fresh view inventory includes the pulled file");
  assert.equal(touches, 0);
});

test("syncScope reuses an explicit state and inventory without walking or touching folderWatch", () => {
  let walks = 0, states = 0, touches = 0;
  const service = {
    folderWatch:{ touch:() => { touches++; } },
    stateOf:() => { states++; return { lines:[] }; },
    store:{
      walk:() => { walks++; return []; },
      readText:() => ({ text:"# Memory\n" }),
    },
  };
  const state = { lines:[], backlog:[], landed:[], notes:[], files:[] };
  const keep = syncScope(service, { id:"p", docsPath:"/unused" }, { state, files:[{ path:"MEMORY.md" }, { path:"files/scratch.txt" }] });
  assert.deepEqual([...keep], ["MEMORY.md"]);
  assert.deepEqual([walks, states, touches], [0, 0, 0]);
});

test("pushView uses asynchronous gzip and sends valid gzipped JSON with the existing three-argument pageView API", async t => {
  const body = { v:1, dbRev:7, state:{ tag:"view-1", words:"Cloud sync ✓", nested:{ values:[1, 2, 3] } } };
  const sent = [];
  const connector = {
    status:() => ({ accountSession:{ signedIn:true }, account:{ name:"Owner" } }),
    cloudRequest:async (pathname, options) => { sent.push({ pathname, options }); return { ok:true }; },
  };
  const share = createCloudShare({
    store:{ save() {}, projects:[] }, connector, viewEveryMs:0,
    pageView:function (project, base, dbRev) {
      assert.equal(arguments.length, 3, "an existing pageView callback receives no new required argument");
      assert.equal(base, "");
      assert.equal(dbRev, 7);
      return { tag:"view-1", body };
    },
  });
  const gzipSync = zlib.gzipSync;
  zlib.gzipSync = () => { throw new Error("pushView must not use gzipSync"); };
  try {
    share.pushViewSoon({ id:"p1", name:"Perf", cloud:{ sync:true, key:"perf" } }, 7);
    await until(() => sent.length === 1, "the gzipped view request");
    assert.equal(sent[0].pathname, "/api/v1/device-sync/line-projects/perf/view");
    assert.equal(sent[0].options.method, "PUT");
    assert.deepEqual(JSON.parse(zlib.gunzipSync(sent[0].options.bytes).toString("utf8")), body);
  } finally {
    zlib.gzipSync = gzipSync;
    share.close();
  }
});

test("five overlapping slow Cloud sync calls produce one active round and one shared dirty follow-up", async t => {
  const temp = temporary(t, "penecho-cloud-perf-rounds-"), project = { id:"rounds", docsPath:path.join(temp, "docs") };
  const gate = Promise.withResolvers();
  let requests = 0, rounds = 0;
  const sync = createCloudSync({
    store:{}, directory:temp,
    localFiles:() => { rounds++; return []; },
    request:async () => {
      requests++;
      if (requests === 1) await gate.promise;
      return requests === 1 ? { rev:1, changed:true, files:[] } : { rev:1, changed:false };
    },
    download:async () => { throw new Error("not used"); },
    upload:async () => {},
    publishFirst:async () => { throw new Error("not used"); },
  });
  const first = sync.run(project);
  const follow = sync.run(project);
  const overlapping = [follow, sync.run(project), sync.run(project), sync.run(project)];
  assert.notEqual(first, follow);
  assert.ok(overlapping.every(promise => promise === follow), "all overlapping callers share the one follow-up promise");
  assert.equal(sync.pending(project), follow, "pending includes the already-requested follow-up");
  assert.equal(requests, 1, "only the active round is in flight while it is slow");
  gate.resolve();
  const results = await Promise.all([first, ...overlapping]);
  assert.equal(results.length, 5);
  assert.equal(requests, 2);
  assert.equal(rounds, 2);
  assert.ok(results.every(result => result.rev === 1));
});

test("rev and conflicts reuse unchanged state JSON but follow saveState and external edits immediately", async t => {
  const temp = temporary(t, "penecho-cloud-perf-metadata-"), project = { id:"metadata", docsPath:path.join(temp, "docs") };
  const file = path.join(temp, "cloud-sync", `${project.id}.json`);
  const sync = createCloudSync({
    store:{}, directory:temp, localFiles:() => [], request:async () => { throw new Error("not used"); },
    download:async () => {}, upload:async () => {}, publishFirst:async () => {},
  });
  await sync.adopt(project, { rev:4, files:[] });
  const readFileSync = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (name, ...args) {
    if (path.resolve(String(name)) === file) reads++;
    return readFileSync.call(this, name, ...args);
  };
  try {
    assert.equal(sync.rev(project), 4, "first read after adopt parses once and caches verified disk state");
    assert.deepEqual(sync.conflicts(project), []);
    assert.equal(reads, 1, "subsequent calls reuse verified cached metadata");

    const conflict = { path:"topics/keep.md", otherPath:".history/keep.md", theirs:"remote-hash", at:"2026-11-21T12:00:00.000Z" };
    fs.writeFileSync(file, JSON.stringify({ rev:5, base:{}, remote:{}, conflicts:[conflict], exists:true }));
    assert.equal(sync.rev(project), 5, "an external state-file edit is seen on the next call");
    assert.equal(reads, 2);
    assert.deepEqual(sync.conflicts(project), [{ path:"lines/keep.md", otherPath:".history/keep.md", line:"keep", at:Date.parse(conflict.at) }]);
    assert.equal(sync.rev(project), 5);
    assert.equal(reads, 2, "rev and conflicts share one parse while file identity and timestamps are unchanged");

    fs.writeFileSync(file, JSON.stringify({ rev:6, base:{}, remote:{}, conflicts:[], exists:true, external:"changed" }));
    assert.equal(sync.rev(project), 6);
    assert.deepEqual(sync.conflicts(project), []);
    assert.equal(reads, 3);

    await sync.adopt(project, { rev:9, files:[] });
    assert.equal(reads, 4, "adopt itself loads the prior state once");
    assert.equal(sync.rev(project), 9);
    assert.deepEqual(sync.conflicts(project), []);
    assert.equal(reads, 5, "first rev() after adopt verifies disk once and caches");
    assert.equal(sync.rev(project), 9);
    assert.equal(reads, 5, "cached rev stays at zero additional reads");

    sync.forget(project);
    assert.equal(sync.rev(project), 0);
    assert.deepEqual(sync.conflicts(project), []);
    assert.equal(reads, 5, "forget clears both the file and its metadata cache");
  } finally {
    fs.readFileSync = readFileSync;
  }
});

test("P0-4: syncScope detects deleted Work details/links before watcher delivery and drops orphaned outputs", async t => {
  const temp = temporary(t, "penecho-cloud-perf-scope-del-");
  const service = new Service({ directory:path.join(temp, "state"), agents:{ available:() => [], desktop:() => null }, autoWatch:false, recoverOnStart:false, folderWatch:{ enabled:false } });
  const store = service.store;
  t.after(() => service.close());
  const project = store.create({ name:"ScopeDel", docsPath:path.join(temp, "docs") });
  project.cloud = { sync:true };
  const alpha = await service.createTopic(project, { title:"Alpha", text:"Build alpha", start:false });
  const beta = await service.createTopic(project, { title:"Beta", text:"Build beta", start:false });
  const workDir = path.join(project.docsPath, "works", alpha.slug);
  fs.mkdirSync(workDir, { recursive:true });
  fs.mkdirSync(path.join(project.docsPath, "files", alpha.slug), { recursive:true });
  fs.mkdirSync(path.join(project.docsPath, "files", "shared"), { recursive:true });
  const orphanRel = `files/${alpha.slug}/only-from-work.txt`;
  const sharedRel = "files/shared/kept-by-beta.txt";
  fs.writeFileSync(path.join(project.docsPath, orphanRel), "orphan output\n");
  fs.writeFileSync(path.join(project.docsPath, sharedRel), "shared attachment\n");
  const detailRel = `works/${alpha.slug}/work-1.md`;
  fs.writeFileSync(path.join(project.docsPath, detailRel), `# Work 1\n\nOutput: [${path.basename(orphanRel)}](../../${orphanRel}) and [shared](../../${sharedRel})\n`);
  const betaPath = path.join(project.docsPath, "lines", `${beta.slug}.md`);
  fs.writeFileSync(betaPath, `${fs.readFileSync(betaPath, "utf8")}\nSee [shared](../${sharedRel}).\n`);

  // Warm cached state with both files attributed.
  service.changed(project);
  const warm = service.stateOf(project);
  assert.ok(warm.files.some(f => f.path === detailRel));
  const initialScope = syncScope(service, project);
  assert.equal(initialScope.has(orphanRel), true);
  assert.equal(initialScope.has(sharedRel), true);

  // Delete the containing works/<slug>/ directory directly on disk WITHOUT calling service.changed(project),
  // simulating a deletion that beats watcher delivery before the first Cloud upload.
  fs.rmSync(workDir, { recursive:true, force:true });
  const committed = [];
  const connector = {
    status:() => ({ accountSession:{ signedIn:true }, account:{ id:"u1", name:"Owner" } }),
    async cloudRequest(pathname, options = {}) {
      if ((options.method || "GET") === "GET") return { project:null };
      if (options.method === "POST" && pathname.endsWith("/commit")) {
        committed.push(...options.body.put.map(f => f.path));
        return { rev:1 };
      }
      if (options.method === "POST" && pathname.endsWith("/blobs")) return { ok:true };
      return { ok:true };
    },
  };
  const share = createCloudShare({
    store, connector, directory:path.join(temp, "cloud"),
    scope:(p, opts) => syncScope(service, p, opts),
  });
  t.after(() => share.close());
  await share.setSync(project, true);
  assert.equal(committed.some(p => p.endsWith("only-from-work.txt")), false, "deleted Work detail drops its orphaned output from first commit");
  assert.equal(committed.some(p => p.endsWith("kept-by-beta.txt")), true, "attachment with a surviving reference in Beta stays in scope");
});

test("P1-6: viewFor keeps station tokens and project token summary on one snapshot, and same-dbRev queued views are not dropped", async t => {
  const temp = temporary(t, "penecho-cloud-perf-view-snap-");
  const service = new Service({ directory:path.join(temp, "state"), agents:{ available:() => [], desktop:() => null }, autoWatch:false, recoverOnStart:false, folderWatch:{ enabled:false } });
  const store = service.store;
  t.after(() => service.close());
  const project = store.create({ name:"TokensSnap", docsPath:path.join(temp, "docs") });
  project.cloud = { sync:true };
  const line = await service.createTopic(project, { title:"Measure", text:"Count tokens", start:false });
  const lineFile = path.join(project.docsPath, "lines", `${line.slug}.md`);
  const detailRel = F.detailPath(line.slug, "work-1");
  const tokensRel = detailRel.replace(/\.md$/, ".tokens.json");
  fs.mkdirSync(path.dirname(path.join(project.docsPath, detailRel)), { recursive:true });
  fs.writeFileSync(lineFile, F.initialLine({ title:"Measure", status:"working", steps:[F.workStep({ who:"codex", done:true, took:"2s" })] }));
  fs.writeFileSync(path.join(project.docsPath, detailRel), "# Work 1\n\nDone.\n");
  const ev = Tokens.create({ workId:`${line.slug}/work-1`, taskId:"t1", taskMode:"new" });
  const attempt = Tokens.startAttempt(ev, { agent:"codex", model:"gpt-5" });
  Tokens.observe(ev, attempt, { type:"message_end", message:{ role:"assistant", id:"r1", usage:{ input:12, output:2, cacheRead:0, cacheWrite:0 } } }, { agent:"pi" });
  fs.writeFileSync(path.join(project.docsPath, tokensRel), JSON.stringify(ev));
  service.changed(project);
  const keepAt12 = syncScope(service, project);

  // Add a second request (+3 input tokens = 15 total) on disk without invalidating service state yet.
  Tokens.observe(ev, attempt, { type:"message_end", message:{ role:"assistant", id:"r2", usage:{ input:3, output:1, cacheRead:0, cacheWrite:0 } } }, { agent:"pi" });
  fs.writeFileSync(path.join(project.docsPath, tokensRel), JSON.stringify(ev));

  const holders = new Map();
  const built = viewFor(service, project, holders, "", 1, (p, o) => syncScope(service, p, o), { keep:keepAt12 });
  const sentLine = [...built.body.state.lines, ...built.body.state.backlog].find(l => l.slug === line.slug);
  const station = sentLine.stations.find(s => s.id === "work-1");
  const record = built.body.state.tokens.records.find(r => r.lineId === line.slug && r.stepId === "work-1");
  assert.equal(station.tokens.inputTokens, 15, "station tokens match updated snapshot");
  assert.equal(record.inputTokens, 15, "project token record matches station tokens (no 12 vs 15 split)");

  // Same dbRev queued while the first view push is busy must still dispatch a follow-up with the newer scope.
  const gate = Promise.withResolvers();
  const sentBodies = [], seenOpts = [];
  const connector = {
    status:() => ({ accountSession:{ signedIn:true }, account:{ id:"u1", name:"Owner" } }),
    async cloudRequest(pathname, options) {
      if (sentBodies.length === 0) await gate.promise;
      sentBodies.push(JSON.parse(zlib.gunzipSync(options.bytes).toString("utf8")));
      return { ok:true };
    },
  };
  let seq = 0;
  const share = createCloudShare({
    store:{ save() {}, projects:[project] }, connector, viewEveryMs:5,
    pageView:(p, base, dbRev, opts) => {
      seenOpts.push(opts?.keep || null);
      seq++;
      return { tag:`t${seq}`, body:{ v:1, dbRev, state:{ tag:`t${seq}`, seq } } };
    },
  });
  t.after(() => share.close());
  const firstKeep = new Set(["MEMORY.md"]), secondKeep = new Set(["MEMORY.md", "README.md"]);
  share.pushViewSoon(project, 9, { keep:firstKeep });
  await until(() => seenOpts.length === 1, "first view started");
  share.pushViewSoon(project, 9, { keep:secondKeep });
  gate.resolve();
  await until(() => sentBodies.length === 2, "follow-up view for same dbRev with newer scope");
  assert.equal(seenOpts[0], firstKeep);
  assert.equal(seenOpts[1], secondKeep);
});

test("P1-7: switching Cloud account or turning off sync during async gzip aborts stale view dispatch", async t => {
  let accountId = "account-A";
  const sent = [];
  const project = { id:"p-switch", name:"Switch", cloud:{ sync:true, key:"switch" } };
  const store = { save() {}, projects:[project] };
  const connector = {
    status:() => ({ origin:"https://cloud.example", accountSession:{ signedIn:true }, account:{ id:accountId, name:accountId } }),
    cloudRequest:async (pathname, options) => { sent.push({ accountId, pathname, options }); return { ok:true }; },
  };
  const gate = Promise.withResolvers();
  const origGzip = zlib.gzip;
  let gzipStarted;
  const started = new Promise(resolve => { gzipStarted = resolve; });
  zlib.gzip = function (input, opts, cb) {
    const callback = typeof opts === "function" ? opts : cb;
    gzipStarted();
    gate.promise.then(() => origGzip.call(zlib, input, typeof opts === "function" ? {} : opts, callback));
  };
  // Reload cloud-share with patched zlib.gzip so promisify(zlib.gzip) wraps the delayed function.
  const sharePath = require.resolve("../src/server/project-lines/cloud-share.js");
  const savedModule = require.cache[sharePath];
  delete require.cache[sharePath];
  let share;
  try {
    const { createCloudShare: createShareFresh } = require(sharePath);
    share = createShareFresh({
      store, connector, viewEveryMs:0,
      pageView:(p, base, dbRev) => ({ tag:"t1", body:{ v:1, dbRev, state:{ tag:"t1", owner:accountId } } }),
    });
    share.pushViewSoon(project, 1);
    await started;
    accountId = "account-B";
    gate.resolve();
    await wait(40);
    assert.equal(sent.length, 0, "view built under account A must not dispatch under account B");
  } finally {
    share?.close();
    zlib.gzip = origGzip;
    if (savedModule) require.cache[sharePath] = savedModule;
  }
});

test("P1-8: cloud-sync metadata catches same-size same-mtime atomic replacement and never caches transient read errors", async t => {
  const temp = temporary(t, "penecho-cloud-perf-meta-hard-"), project = { id:"meta-hard", docsPath:path.join(temp, "docs") };
  const file = path.join(temp, "cloud-sync", `${project.id}.json`);
  const sync = createCloudSync({
    store:{}, directory:temp, localFiles:() => [], request:async () => { throw new Error("not used"); },
    download:async () => {}, upload:async () => {}, publishFirst:async () => {},
  });
  await sync.adopt(project, { rev:7, files:[] });
  assert.equal(sync.rev(project), 7);

  // Atomically replace state file with identical byte size and identical mtime (rev 7 -> rev 8).
  const origStat = fs.statSync(file);
  const replacement = `${file}.external`;
  fs.writeFileSync(replacement, fs.readFileSync(file, "utf8").replace('"rev":7', '"rev":8'));
  assert.equal(fs.statSync(replacement).size, origStat.size);
  fs.utimesSync(replacement, origStat.atime, origStat.mtime);
  fs.renameSync(replacement, file);
  assert.equal(sync.rev(project), 8, "same-size same-mtime atomic replacement refreshes cached revision");

  // Force a cache miss via another atomic replace (8 -> 9) and inject a single EIO during readFileSync.
  const stat8 = fs.statSync(file);
  fs.writeFileSync(replacement, fs.readFileSync(file, "utf8").replace('"rev":8', '"rev":9'));
  fs.utimesSync(replacement, stat8.atime, stat8.mtime);
  fs.renameSync(replacement, file);
  const origRead = fs.readFileSync;
  let failOnce = true;
  fs.readFileSync = function (target, ...args) {
    if (failOnce && path.resolve(String(target)) === file) {
      failOnce = false;
      throw Object.assign(new Error("transient EIO"), { code:"EIO" });
    }
    return origRead.call(this, target, ...args);
  };
  try {
    assert.equal(sync.rev(project), 0, "transient read error returns fallback rev 0");
    assert.equal(sync.rev(project), 9, "transient read error is never cached; next read returns real rev 9");
  } finally {
    fs.readFileSync = origRead;
  }

  // P2-2: same-inode rewrite preserving size and mtime right after saveState rename cannot seed stale rev.
  const origRename = fs.renameSync;
  let rewrote = false;
  fs.renameSync = function (from, to) {
    origRename.call(this, from, to);
    if (!rewrote && path.resolve(String(to)) === file) {
      rewrote = true;
      const st = fs.statSync(file);
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"rev":9', '"rev":8'));
      fs.utimesSync(file, st.atime, st.mtime);
    }
  };
  try {
    await sync.adopt(project, { rev:9, files:[] });
  } finally {
    fs.renameSync = origRename;
  }
  assert.equal(rewrote, true);
  assert.equal(sync.rev(project), 8, "same-inode rewrite after saveState is seen immediately instead of stale rev 9");
});

test("Round 2 Cloud fixes: cross-line linked Work deletion, same-size/mtime tokens, pre-gzip project removal, and cold 1-walk sync+view", async t => {
  const temp = temporary(t, "penecho-cloud-perf-r2-");
  const service = new Service({ directory:path.join(temp, "state"), agents:{ available:() => [], desktop:() => null }, autoWatch:false, recoverOnStart:false, folderWatch:{ enabled:false } });
  const store = service.store;
  t.after(() => service.close());
  const project = store.create({ name:"R2Cloud", docsPath:path.join(temp, "docs") });
  project.cloud = { sync:true };

  // P0-2: Beta links to Alpha's Work detail; deleting Alpha's detail drops its orphaned output from first commit.
  const alpha = await service.createTopic(project, { title:"Alpha", text:"Alpha task", start:false });
  const beta = await service.createTopic(project, { title:"Beta", text:"Beta task", start:false });
  const alphaDetail = F.detailPath(alpha.slug, "work-1");
  const orphanRel = `files/${alpha.slug}/linked-orphan.txt`;
  fs.mkdirSync(path.dirname(path.join(project.docsPath, alphaDetail)), { recursive:true });
  fs.mkdirSync(path.dirname(path.join(project.docsPath, orphanRel)), { recursive:true });
  fs.writeFileSync(path.join(project.docsPath, orphanRel), "orphan\n");
  fs.writeFileSync(path.join(project.docsPath, alphaDetail), `# Work 1\n\n## Result\n\nBuilt [linked-orphan.txt](../../${orphanRel}).\n`);
  fs.writeFileSync(path.join(project.docsPath, "lines", `${beta.slug}.md`),
    `${F.initialLine({ title:"Beta", status:"working", steps:[F.workStep({ who:"codex", done:true, took:"1s" })] })}\n[Details](../${alphaDetail})\n`);
  service.changed(project);
  const warmed = service.stateOf(project);
  assert.ok(warmed.files.some(f => f.path === orphanRel));
  assert.equal(syncScope(service, project).has(orphanRel), true);
  fs.rmSync(path.join(project.docsPath, alphaDetail), { force:true });
  const scopeAfterDelete = syncScope(service, project);
  assert.equal(scopeAfterDelete.has(orphanRel), false, "deleting Alpha's detail invalidates Beta's cached station/result and drops orphan");

  // P1-4: same-size, same-mtime atomic replacement of .tokens.json produces consistent 15 / 15 in viewFor().
  const tokDetail = F.detailPath(beta.slug, "work-1");
  const tokRel = tokDetail.replace(/\.md$/, ".tokens.json");
  fs.mkdirSync(path.dirname(path.join(project.docsPath, tokDetail)), { recursive:true });
  fs.writeFileSync(path.join(project.docsPath, tokDetail), "# Work 1\n\nDone.\n");
  const ev12 = Tokens.create({ workId:`${beta.slug}/work-1`, taskId:"t1", taskMode:"new" });
  const a12 = Tokens.startAttempt(ev12, { agent:"pi" });
  Tokens.observe(ev12, a12, { type:"message_end", message:{ role:"assistant", id:"r1", usage:{ input:12, output:2, cacheRead:0, cacheWrite:0 } } }, { agent:"pi" });
  const tokAbs = path.join(project.docsPath, tokRel);
  const raw12 = JSON.stringify(ev12);
  fs.writeFileSync(tokAbs, raw12);
  service.changed(project);
  const keep12 = syncScope(service, project);
  const origStat = fs.statSync(tokAbs);
  const raw15 = raw12.replace('"inputTokens":12', '"inputTokens":15').replace('"input":12', '"input":15').replace('"inputTokens":12', '"inputTokens":15').replace('"inputTokens":12', '"inputTokens":15');
  assert.equal(Buffer.byteLength(raw15), Buffer.byteLength(raw12));
  const tmpTok = `${tokAbs}.replace`;
  fs.writeFileSync(tmpTok, raw15);
  fs.utimesSync(tmpTok, origStat.atime, origStat.mtime);
  fs.renameSync(tmpTok, tokAbs);
  const built = viewFor(service, project, new Map(), "", 1, (p, o) => syncScope(service, p, o), { keep:keep12 });
  const bLine = [...built.body.state.lines, ...built.body.state.backlog].find(l => l.slug === beta.slug);
  const bStation = bLine.stations.find(s => s.id === "work-1");
  const bRecord = built.body.state.tokens.records.find(r => r.lineId === beta.slug && r.stepId === "work-1");
  assert.equal(bStation.tokens.inputTokens, 15);
  assert.equal(bRecord.inputTokens, 15);

  // P1-7 (Cloud cold): cold real Service + manifest + syncScope + viewFor executes 1 walk total.
  const coldSvc = new Service({ directory:path.join(temp, "cold-state"), agents:{ available:() => [], desktop:() => null }, autoWatch:false, recoverOnStart:false, folderWatch:{ enabled:false } });
  t.after(() => coldSvc.close());
  const coldProj = coldSvc.store.create({ name:"Cold", docsPath:path.join(temp, "cold-docs") });
  coldProj.cloud = { sync:true };
  let coldWalks = 0;
  const origColdWalk = coldSvc.store.walk.bind(coldSvc.store);
  coldSvc.store.walk = (...args) => { coldWalks++; return origColdWalk(...args); };
  const coldHolders = new Map();
  const coldViews = [];
  const coldConnector = {
    status:() => ({ accountSession:{ signedIn:true }, account:{ id:"u1", name:"Owner" } }),
    async cloudRequest(pathname, options = {}) {
      if (options.method === "PUT" && pathname.endsWith("/view")) { coldViews.push(pathname); return { ok:true }; }
      if (options.method === "POST" && pathname.endsWith("/commit")) return { rev:1 };
      return { project:null };
    },
  };
  const coldShare = createCloudShare({
    store:coldSvc.store, connector:coldConnector, directory:path.join(temp, "cold-cloud"), viewEveryMs:0,
    scope:(p, o) => syncScope(coldSvc, p, o),
    pageView:(p, base, dbRev, o) => viewFor(coldSvc, p, coldHolders, base, dbRev, (pr, op) => syncScope(coldSvc, pr, op), o || undefined),
  });
  t.after(() => coldShare.close());
  await coldShare.setSync(coldProj, true);
  await until(() => coldViews.length === 1, "cold view sent");
  assert.equal(coldWalks, 1, "cold Service manifest + scope + view takes 1 walk total");

  // P1-5: removing a project AFTER scheduling pushViewSoon and BEFORE gzip starts suppresses PUT /view.
  const rmSent = [];
  const rmProj = { id:"p-remove", name:"Remove", cloud:{ sync:true, key:"remove" } };
  const rmStore = { save() {}, projects:[rmProj] };
  const rmShare = createCloudShare({
    store:rmStore, viewEveryMs:25,
    connector:{ status:() => ({ accountSession:{ signedIn:true }, account:{ id:"u1", name:"Owner" } }), cloudRequest:async p => { rmSent.push(p); return { ok:true }; } },
    pageView:(p, base, dbRev) => ({ tag:"t1", body:{ v:1, dbRev, state:{ tag:"t1" } } }),
  });
  t.after(() => rmShare.close());
  rmShare.pushViewSoon(rmProj, 1);
  rmStore.projects.splice(0, 1);
  await wait(60);
  assert.equal(rmSent.length, 0, "project removed before timer fires never dispatches PUT /view");
});

test("Round 3 Cloud fixes: commit summary drops orphan preview, viewFor stays consistent under continuous edits, hash cache catches same-size/mtime tokens, and wired cold sync walks once", async t => {
  const { createProjectLines } = require("../src/server/project-lines/http.js");
  const { summaryOf } = require("../src/server/project-lines/summary.js");
  const temp = temporary(t, "penecho-cloud-perf-r3-");

  // P1-1: first Cloud commit summary excludes orphaned Canvas preview when linked Alpha detail is deleted before watcher fires.
  const svc1 = new Service({ directory:path.join(temp, "s1"), agents:{ available:() => [], desktop:() => null }, autoWatch:false, recoverOnStart:false, folderWatch:{ enabled:false } });
  t.after(() => svc1.close());
  const p1 = svc1.store.create({ name:"SummaryOrphan", docsPath:path.join(temp, "d1") });
  p1.cloud = { sync:true };
  const alpha = await svc1.createTopic(p1, { title:"Alpha", text:"Alpha task", start:false });
  const beta = await svc1.createTopic(p1, { title:"Beta", text:"Beta task", start:false });
  const alphaDetail = F.detailPath(alpha.slug, "work-1");
  const orphanCanvas = `files/${alpha.slug}/linked-orphan.penecho.json`;
  const orphanPng = `files/${alpha.slug}/linked-orphan.png`;
  fs.mkdirSync(path.dirname(path.join(p1.docsPath, alphaDetail)), { recursive:true });
  fs.mkdirSync(path.dirname(path.join(p1.docsPath, orphanPng)), { recursive:true });
  fs.writeFileSync(path.join(p1.docsPath, orphanCanvas), JSON.stringify({ assets:[], manifest:{} }));
  fs.writeFileSync(path.join(p1.docsPath, orphanPng), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  fs.writeFileSync(path.join(p1.docsPath, alphaDetail), `# Work 1\n\n## Result\n\n![Orphan](../../${orphanPng})\n`);
  fs.writeFileSync(path.join(p1.docsPath, "lines", `${beta.slug}.md`),
    `${F.initialLine({ title:"Beta", status:"working", steps:[F.workStep({ who:"codex", done:true, took:"1s" })] })}\n[Details](../${alphaDetail})\n`);
  svc1.changed(p1);
  const warmBeta = svc1.stateOf(p1).lines.find(l => l.slug === beta.slug);
  assert.equal(summaryOf(svc1, p1).lines.find(l => l.path === `lines/${beta.slug}.md`)?.lastWork?.picture, orphanPng, "warm summary references orphan Canvas preview");
  // Delete Alpha detail without notifying watcher.
  fs.rmSync(path.join(p1.docsPath, alphaDetail), { force:true });
  const commits1 = [];
  const share1 = createCloudShare({
    store:svc1.store, directory:path.join(temp, "c1"),
    summarize:(proj, opts) => summaryOf(svc1, proj, opts),
    scope:(proj, opts) => syncScope(svc1, proj, opts),
    connector:{
      status:() => ({ accountSession:{ signedIn:true }, account:{ id:"u1", name:"Owner" } }),
      async cloudRequest(pathname, options = {}) {
        if ((options.method || "GET") === "GET") return { project:null };
        if (options.method === "POST" && pathname.endsWith("/commit")) { commits1.push(options.body); return { rev:1 }; }
        return { ok:true };
      },
    },
  });
  t.after(() => share1.close());
  await share1.setSync(p1, true);
  assert.equal(commits1.length, 1);
  assert.equal(commits1[0].put.some(f => f.path.endsWith("linked-orphan.png")), false, "commit file list excludes orphan preview");
  const betaSum = commits1[0].summary.lines.find(l => l.path === `lines/${beta.slug}.md`);
  assert.equal(betaSum?.lastWork?.picture || null, null, "first commit Home summary excludes orphaned Canvas preview");

  // P1-4: continuous same-metadata .tokens.json replacements across retries AND final fresh:true rebuild never emit a 14/15 split.
  const tokSlug = "cont-tok", tokDetail = F.detailPath(tokSlug, "work-1"), tokRel = tokDetail.replace(/\.md$/, ".tokens.json");
  fs.mkdirSync(path.dirname(path.join(p1.docsPath, tokDetail)), { recursive:true });
  fs.writeFileSync(path.join(p1.docsPath, "lines", `${tokSlug}.md`), F.initialLine({ title:"Cont", status:"working", steps:[F.workStep({ who:"pi", done:true, took:"1s" })] }));
  fs.writeFileSync(path.join(p1.docsPath, tokDetail), "# Work 1\n\nDone.\n");
  const tokAbs = path.join(p1.docsPath, tokRel);
  const makeEvRaw = n => {
    const ev = Tokens.create({ workId:`${tokSlug}/work-1`, taskId:"t1", taskMode:"new" });
    const att = Tokens.startAttempt(ev, { agent:"pi" });
    Tokens.observe(ev, att, { type:"message_end", message:{ role:"assistant", id:"r1", usage:{ input:n, output:2, cacheRead:0, cacheWrite:0 } } }, { agent:"pi" });
    return JSON.stringify(ev);
  };
  const raw12 = makeEvRaw(12);
  fs.writeFileSync(tokAbs, raw12);
  const baseStat = fs.statSync(tokAbs);
  const replaceSameMeta = n => {
    const raw = makeEvRaw(n);
    assert.equal(Buffer.byteLength(raw), Buffer.byteLength(raw12));
    const tmp = `${tokAbs}.r${n}`;
    fs.writeFileSync(tmp, raw);
    fs.utimesSync(tmp, baseStat.atime, baseStat.mtime);
    fs.renameSync(tmp, tokAbs);
  };
  svc1.changed(p1);
  const keepAt12 = syncScope(svc1, p1);
  replaceSameMeta(13);
  const origProjectTokens = svc1.projectTokens.bind(svc1);
  let ptCalls = 0;
  svc1.projectTokens = (proj, lines, opts) => {
    ptCalls++;
    if (ptCalls === 2) replaceSameMeta(14);
    if (ptCalls === 3) replaceSameMeta(15);
    return origProjectTokens(proj, lines, opts);
  };
  const builtCont = viewFor(svc1, p1, new Map(), "", 1, (pr, op) => syncScope(svc1, pr, op), { keep:keepAt12 });
  svc1.projectTokens = origProjectTokens;
  const contLine = [...builtCont.body.state.lines, ...builtCont.body.state.backlog].find(l => l.slug === tokSlug);
  const contStation = contLine.stations.find(s => s.id === "work-1");
  const contRecord = builtCont.body.state.tokens.records.find(r => r.lineId === tokSlug && r.stepId === "work-1");
  assert.equal(contStation.tokens.inputTokens, contRecord.inputTokens, "viewFor never returns conflicting station vs project token counts");

  // P1-5: existing Cloud copy updates synced .tokens.json blob & rev after same-size, same-mtime atomic replacement.
  let remote5 = null;
  const blobs5 = new Map(), views5 = [];
  const p5 = svc1.store.create({ name:"HashGen", docsPath:path.join(temp, "d5") });
  p5.cloud = { sync:true };
  const t5Detail = F.detailPath("m", "work-1"), t5Rel = t5Detail.replace(/\.md$/, ".tokens.json");
  fs.mkdirSync(path.dirname(path.join(p5.docsPath, t5Detail)), { recursive:true });
  fs.writeFileSync(path.join(p5.docsPath, "lines", "m.md"), F.initialLine({ title:"M", status:"working", steps:[F.workStep({ who:"pi", done:true, took:"1s" })] }));
  fs.writeFileSync(path.join(p5.docsPath, t5Detail), "# Work 1\n\nDone.\n");
  const t5Abs = path.join(p5.docsPath, t5Rel);
  const make5 = n => {
    const ev = Tokens.create({ workId:"m/work-1", taskId:"t1", taskMode:"new" });
    const att = Tokens.startAttempt(ev, { agent:"pi" });
    Tokens.observe(ev, att, { type:"message_end", message:{ role:"assistant", id:"r1", usage:{ input:n, output:2, cacheRead:0, cacheWrite:0 } } }, { agent:"pi" });
    return JSON.stringify(ev);
  };
  const r5_12 = make5(12), r5_15 = make5(15);
  assert.equal(Buffer.byteLength(r5_12), Buffer.byteLength(r5_15));
  fs.writeFileSync(t5Abs, r5_12);
  const st5 = fs.statSync(t5Abs);
  const share5 = createCloudShare({
    store:svc1.store, directory:path.join(temp, "c5"), viewEveryMs:0,
    scope:(proj, opts) => syncScope(svc1, proj, opts),
    pageView:(proj, base, dbRev, opts) => viewFor(svc1, proj, new Map(), base, dbRev, (pr, op) => syncScope(svc1, pr, op), opts || undefined),
    connector:{
      status:() => ({ accountSession:{ signedIn:true }, account:{ id:"u1", name:"Owner" } }),
      async cloudRequest(pathname, options = {}) {
        const method = options.method || "GET";
        if (method === "PUT" && pathname.endsWith("/view")) { views5.push(JSON.parse(zlib.gunzipSync(options.bytes).toString("utf8"))); return { ok:true }; }
        if (method === "POST" && pathname.endsWith("/blobs")) {
          const len = options.bytes.readUInt32BE(0);
          const hdr = JSON.parse(options.bytes.subarray(4, 4 + len).toString("utf8"));
          let at = 4 + len;
          for (const item of hdr) { blobs5.set(item.sha256, options.bytes.subarray(at, at + item.size)); at += item.size; }
          return { ok:true };
        }
        if (method === "POST" && pathname.endsWith("/commit")) {
          const missing = (options.body.put || []).filter(f => !blobs5.has(f.sha256)).map(f => f.sha256);
          if (missing.length) throw Object.assign(new Error("missing"), { code:"line_project_missing_files", details:{ missing } });
          const files = new Map((remote5?.files || []).map(f => [f.path, f]));
          for (const r of options.body.remove || []) files.delete(r);
          for (const f of options.body.put || []) files.set(f.path, f);
          remote5 = { rev:(remote5?.rev || 0) + 1, files:[...files.values()] };
          return { rev:remote5.rev };
        }
        if (method === "GET") {
          if (!remote5) return { project:null };
          const since = Number(/\?since=(\d+)$/.exec(pathname)?.[1]);
          if (since && remote5.rev <= since) return { rev:remote5.rev, changed:false };
          return { project:{ key:p5.id, name:p5.name, rev:remote5.rev }, rev:remote5.rev, changed:true, files:remote5.files, running:[] };
        }
        return { ok:true };
      },
    },
  });
  t.after(() => share5.close());
  await share5.setSync(p5, true);
  await until(() => views5.length === 1, "first sync view at 12");
  assert.equal(remote5.rev, 1);
  // Atomically replace .tokens.json with 15 preserving size and mtime.
  fs.writeFileSync(`${t5Abs}.rep`, r5_15);
  fs.utimesSync(`${t5Abs}.rep`, st5.atime, st5.mtime);
  fs.renameSync(`${t5Abs}.rep`, t5Abs);
  await share5.syncNow(p5);
  await until(() => views5.length === 2, "second sync view at 15");
  assert.equal(remote5.rev, 2, "same-size same-mtime token replacement advances Cloud revision");
  const cloudTokEntry = remote5.files.find(f => f.path.endsWith("work-1.tokens.json"));
  assert.ok(cloudTokEntry);
  assert.equal(JSON.parse(blobs5.get(cloudTokEntry.sha256).toString("utf8")).attempts[0].totals.inputTokens, 15, "Cloud copy stores updated 15-token evidence");

  // P1-6: normal wired createProjectLines cold first Cloud sync (manifest + commit summary + onSynced freeHeld/runHeld) walks ONCE.
  const wiredConn = {
    status:() => ({ accountSession:{ signedIn:true }, account:{ id:"u1", name:"Owner" } }),
    async cloudRequest(pathname, options = {}) {
      if ((options.method || "GET") === "GET") return { project:null };
      if (options.method === "POST" && pathname.endsWith("/commit")) return { rev:1 };
      return { ok:true };
    },
  };
  const wiredApi = createProjectLines({
    directory:path.join(temp, "wired-state"),
    agents:{ available:() => [], desktop:() => null },
    cloud:wiredConn,
    computerRounds:0,
    examples:false,
    serviceOptions:{ autoWatch:false, recoverOnStart:false, folderWatch:{ enabled:false } },
  });
  t.after(() => wiredApi.close());
  const wiredProj = wiredApi.service.store.create({ name:"WiredCold", docsPath:path.join(temp, "wired-docs") });
  wiredProj.cloud = { sync:true };
  let wiredWalks = 0;
  const origWiredWalk = wiredApi.service.store.walk.bind(wiredApi.service.store);
  wiredApi.service.store.walk = (...args) => { wiredWalks++; return origWiredWalk(...args); };
  await wiredApi.cloudShare.setSync(wiredProj, true);
  assert.equal(wiredWalks, 1, "wired createProjectLines cold first Cloud sync (manifest + summary + freeHeld + runHeld) executes 1 walk total");

  // Round 4 P1: Work-detail-only replacement (preview A -> preview B) and deletion (preview B -> null) refresh Cloud Home summary with zero extra walks.
  const svcW = new Service({ directory:path.join(temp, "sw"), agents:{ available:() => [], desktop:() => null }, autoWatch:false, recoverOnStart:false, folderWatch:{ enabled:false } });
  t.after(() => svcW.close());
  const pW = svcW.store.create({ name:"WorkOnlySummary", docsPath:path.join(temp, "dw") });
  pW.cloud = { sync:true };
  const aW = await svcW.createTopic(pW, { title:"Alpha", text:"Alpha", start:false });
  const bW = await svcW.createTopic(pW, { title:"Beta", text:"Beta", start:false });
  const detailW = F.detailPath(aW.slug, "work-1");
  const prevACanvas = `files/${aW.slug}/prev-a.penecho.json`, prevAPng = `files/${aW.slug}/prev-a.png`;
  const prevBCanvas = `files/${aW.slug}/prev-b.penecho.json`, prevBPng = `files/${aW.slug}/prev-b.png`;
  fs.mkdirSync(path.dirname(path.join(pW.docsPath, detailW)), { recursive:true });
  fs.mkdirSync(path.dirname(path.join(pW.docsPath, prevAPng)), { recursive:true });
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  fs.writeFileSync(path.join(pW.docsPath, prevACanvas), JSON.stringify({ assets:[], manifest:{} }));
  fs.writeFileSync(path.join(pW.docsPath, prevAPng), pngBytes);
  fs.writeFileSync(path.join(pW.docsPath, prevBCanvas), JSON.stringify({ assets:[], manifest:{} }));
  fs.writeFileSync(path.join(pW.docsPath, prevBPng), pngBytes);
  fs.writeFileSync(path.join(pW.docsPath, detailW), `# Work 1\n\n## Result\n\n![A](../../${prevAPng})\n`);
  fs.writeFileSync(path.join(pW.docsPath, "lines", `${bW.slug}.md`),
    `${F.initialLine({ title:"Beta", status:"working", steps:[F.workStep({ who:"codex", done:true, took:"1s" })] })}\n[Details](../${detailW})\n`);
  let remoteW = null;
  const commitsW = [];
  const shareW = createCloudShare({
    store:svcW.store, directory:path.join(temp, "cw"),
    summarize:(proj, opts) => summaryOf(svcW, proj, opts),
    scope:(proj, opts) => syncScope(svcW, proj, opts),
    connector:{
      status:() => ({ accountSession:{ signedIn:true }, account:{ id:"u1", name:"Owner" } }),
      async cloudRequest(pathname, options = {}) {
        const method = options.method || "GET";
        if (method === "POST" && pathname.endsWith("/commit")) {
          commitsW.push(options.body);
          const files = new Map((remoteW?.files || []).map(f => [f.path, f]));
          for (const r of options.body.remove || []) files.delete(r);
          for (const f of options.body.put || []) files.set(f.path, f);
          remoteW = { rev:(remoteW?.rev || 0) + 1, files:[...files.values()] };
          return { rev:remoteW.rev };
        }
        if (method === "GET") {
          if (!remoteW) return { project:null };
          const since = Number(/\?since=(\d+)$/.exec(pathname)?.[1]);
          if (since && remoteW.rev <= since) return { rev:remoteW.rev, changed:false };
          return { project:{ key:pW.id, name:pW.name, rev:remoteW.rev }, rev:remoteW.rev, changed:true, files:remoteW.files, running:[] };
        }
        return { ok:true };
      },
    },
  });
  t.after(() => shareW.close());
  await shareW.setSync(pW, true);
  assert.equal(commitsW.length, 1);
  assert.equal(commitsW[0].summary.lines.find(l => l.path === `lines/${bW.slug}.md`)?.lastWork?.picture, prevAPng);

  // Edit ONLY Alpha's linked Work detail (preview A -> preview B) without touching either Line Markdown file or notifying watcher.
  let walksW = 0;
  const origWalkW = svcW.store.walk.bind(svcW.store);
  svcW.store.walk = (...args) => { walksW++; return origWalkW(...args); };
  fs.writeFileSync(path.join(pW.docsPath, detailW), `# Work 1\n\n## Result\n\n![B](../../${prevBPng})\n`);
  await shareW.syncNow(pW);
  assert.equal(commitsW.length, 2);
  assert.equal(walksW, 1, "Work-detail-only incremental commit with summary refresh uses 1 walk");
  assert.ok(commitsW[1].summary, "Work-detail-only commit sends refreshed summary");
  assert.equal(commitsW[1].summary.lines.find(l => l.path === `lines/${bW.slug}.md`)?.lastWork?.picture, prevBPng, "summary updates thumbnail to preview B");

  // Delete ONLY Alpha's linked Work detail without touching either Line Markdown file or notifying watcher.
  walksW = 0;
  fs.rmSync(path.join(pW.docsPath, detailW), { force:true });
  await shareW.syncNow(pW);
  assert.equal(commitsW.length, 3);
  assert.equal(walksW, 1, "Work-detail-only deletion commit with summary refresh uses 1 walk");
  assert.ok(commitsW[2].summary, "Work-detail-only deletion sends refreshed summary");
  assert.equal(commitsW[2].summary.lines.find(l => l.path === `lines/${bW.slug}.md`)?.lastWork?.picture || null, null, "summary clears removed thumbnail");
});
