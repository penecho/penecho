"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectLines } = require("../src/server/project-lines/http.js");

const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
// The Cloud routes the local app uses, kept in memory: blobs by hash, a manifest, a link.
function fakeCloud({ plus = false, account = { name:"Ada" } } = {}) {
  const projects = new Map(), calls = [];
  let signedIn = true;
  const view = p => ({ key:p.key, rev:p.rev, name:p.name, files:p.files.length, sizeBytes:p.files.reduce((s, f) => s + f.size, 0), maxBytes:300 * 1048576, plus,
    share:p.token ? { token:p.token, url:`/l/${p.token}`, expiresAt:plus ? null : p.sharedAt + 7 * 86400000, ended:false } : null });
  const fail = (status, code, message, details) => { throw Object.assign(new Error(message), { status, code, details }); };
  const connector = {
    calls, projects, uploaded:0, summaries:[],
    signOut() { signedIn = false; },
    status: () => ({ origin:"https://cloud.test", accountSession:{ signedIn }, account:signedIn ? account : null }),
    async cloudRequest(pathname, { method = "GET", body, bytes } = {}) {
      calls.push(`${method} ${pathname.replace(/[0-9a-f]{64}/, "<sha>")}`);
      // ?since=<rev>: Cloud answers { rev, changed:false } when nothing is newer (B3).
      const since = /\?since=(\d+)$/.exec(pathname)?.[1]; pathname = pathname.replace(/\?since=\d+$/, "");
      // A big file in parts (PE-1067): the last part stores it.
      const part = pathname.match(/^\/api\/v1\/device-sync\/line-projects\/([^/]+)\/blobs\/([0-9a-f]{64})\/parts\/(\d+)\?count=(\d+)&size=\d+&part=\d+$/);
      if (part && method === "PUT") {
        const p = projects.get(decodeURIComponent(part[1])), held = (p.parts ||= new Map()).get(part[2]) || [], index = Number(part[3]), count = Number(part[4]);
        held[index] = Buffer.from(bytes); p.parts.set(part[2], held);
        if (index < count - 1) return { part:index };
        const whole = Buffer.concat(held); p.parts.delete(part[2]);
        assert.equal(sha(whole), part[2]); p.blobs.set(part[2], whole); connector.uploaded++;
        return { added:true, stored:true };
      }
      const m =pathname.match(/^\/api\/v1\/device-sync\/line-projects\/([^/]+)(?:\/(blobs|share|commit)(?:\/([0-9a-f]{64}))?)?$/);
      assert.ok(m, `unexpected Cloud path ${pathname}`);
      const key = decodeURIComponent(m[1]); let p = projects.get(key);
      if (!m[2] && method === "GET") return !p ? { project:null } : since !== undefined && p.rev <= Number(since) ? { rev:p.rev, changed:false } : { project:view(p), rev:p.rev, changed:true, files:p.files, running:[] };
      if (!m[2] && method === "PUT") {
        if (!p) projects.set(key, p = { key, rev:0, name:body.name, files:[], blobs:new Map(), token:null });
        const missing = [...new Set(body.files.map(f => f.sha256))].filter(h => !p.blobs.has(h));
        if (missing.length) fail(409, "line_project_missing_files", "Upload these files first.", { missing });
        if (JSON.stringify(p.files) !== JSON.stringify(body.files) || !p.rev) p.rev++;
        Object.assign(p, { name:body.name, files:body.files });
        if (body.summary) connector.summaries.push(body.summary);
        return { project:view(p) };
      }
      if (!m[2] && method === "DELETE") { projects.delete(key); return { project:null }; }
      if (!p && m[2] === "commit" && method === "POST" && body.rev === 0) {
        projects.set(key, p = { key, rev:0, name:body.name, files:[], blobs:new Map(), token:null });
      }
      if (!p) fail(404, "not_found", "This project is not in Cloud.");
      if (m[2] === "blobs" && m[3]) { assert.equal(sha(bytes), m[3]); p.blobs.set(m[3], bytes); connector.uploaded++; return { added:true }; }
      if (m[2] === "blobs" && method === "POST") {
        // A batch: 4-byte header length, the JSON header, then the files' bytes.
        const length = bytes.readUInt32BE(0), header = JSON.parse(bytes.subarray(4, 4 + length).toString());
        let offset = 4 + length;
        for (const entry of header) { const part = bytes.subarray(offset, offset + entry.size); offset += entry.size; assert.equal(sha(part), entry.sha256); p.blobs.set(entry.sha256, part); connector.uploaded++; }
        assert.equal(offset, bytes.length);
        return { added:header.length };
      }
      // One commit naming the revision it was planned against (ARCHITECTURE.md A).
      if (m[2] === "commit" && method === "POST") {
        if (body.rev !== p.rev) fail(409, "stale", "Cloud moved on.");
        // As Cloud does: a commit naming files it does not hold writes nothing and lists them (src/routes/line-projects.mjs).
        const lacking = [...new Set(body.put.map(f => f.sha256))].filter(h => !p.blobs.has(h));
        if (lacking.length) fail(409, "line_project_missing_files", "Upload these files first.", { missing:lacking });
        const next = new Map(p.files.map(f => [f.path, f]));
        for (const f of body.put) next.set(f.path, f);
        for (const gone of body.remove) next.delete(gone);
        p.files = [...next.values()]; p.rev++;
        if (body.summary) connector.summaries.push(body.summary);
        return { rev:p.rev };
      }
      if (m[2] === "share" && method === "POST") { if (!p.token) { p.token = crypto.randomUUID(); p.sharedAt = Date.now(); } return { project:view(p) }; }
      if (m[2] === "share" && method === "DELETE") { p.token = null; return { project:view(p) }; }
      fail(404, "not_found", "Not found.");
    },
  };
  return connector;
}

async function setup(cloud, serviceOptions = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-share-"));
  const lines = createProjectLines({ directory:path.join(temp, "state"), agents:{ available:() => [], useModelFile() {} }, serviceOptions:{ autoWatch:false, cloudScope:false, ...serviceOptions },
    authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true, cloud:() => cloud, cloudSignIn:() => ({ authorizationUrl:"https://cloud.test/dashboard.html" }),
    readJson:req => new Promise(res => { let s = ""; req.on("data", d => s += d).on("end", () => res(s ? JSON.parse(s) : {})); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const project = lines.service.store.create({ name:"Weather app", docsPath:path.join(temp, "docs") });
  fs.writeFileSync(path.join(project.docsPath, "lines", "first.md"), "# First line\n");
  fs.writeFileSync(path.join(project.docsPath, "files", "plan.png"), Buffer.from("PNG"));
  fs.mkdirSync(path.join(project.docsPath, ".history"), { recursive:true });
  fs.writeFileSync(path.join(project.docsPath, ".history", "old.md"), "a restore point");
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  const call = async (suffix, method = "GET", body) => {
    const response = await fetch(`${base}${suffix}`, { method, headers:body ? { "content-type":"application/json" } : {}, body:body ? JSON.stringify(body) : undefined });
    return { status:response.status, body:await response.json() };
  };
  const done = async () => { lines.close(); await new Promise(r => server.close(r)); fs.rmSync(temp, { recursive:true, force:true }); };
  return { lines, project, call, done, temp };
}

for (const boundary of ["first manifest", "stored blobs", "batch retry"]) {
  test(`a first sync stays in the starting account across a pending ${boundary}`, { timeout:10000 }, async t => {
    const alice = fakeCloud({ account:{ id:"a", name:"User" } });
    const bob = fakeCloud({ account:{ id:"b", name:"User" } });
    const reached = Promise.withResolvers(), release = Promise.withResolvers();
    let active = alice, paused = false;
    const connector = {
      status:() => active.status(),
      async cloudRequest(url, options) {
        const target = active;
        const match = boundary === "first manifest" ? !options.method : url.endsWith("/blobs");
        if (paused || !match) return target.cloudRequest(url, options);
        paused = true;
        if (boundary === "batch retry") {
          // Signal in the next event-loop turn, after the failed batch enters its retry delay.
          setImmediate(reached.resolve);
          throw Object.assign(new Error("Cloud busy"), { status:503 });
        }
        const answer = await target.cloudRequest(url, options);
        reached.resolve();
        await release.promise;
        return answer;
      },
    };
    const f = await setup(connector, { cloudRetryMs:[80] });
    t.after(f.done);
    const enable = f.lines.cloudShare.setSync(f.project, true);
    const done = assert.rejects(enable, { code:"CLOUD_ACCOUNT_CHANGED" });
    await reached.promise;
    const queued = assert.rejects(f.lines.cloudShare.setSync(f.project, true), { code:"CLOUD_ACCOUNT_CHANGED" });
    active = bob;
    release.resolve();
    await Promise.all([done, queued]);
    await f.lines.cloudShare.tick();
    assert.deepEqual(bob.calls, [], "no file list, commit, upload or retry uses the new account");
    assert.equal(Boolean(f.project.cloud?.sync), false);
    assert.equal(fs.readFileSync(path.join(f.project.docsPath, "files/plan.png"), "utf8"), "PNG");
  });
}

test("a paused first publication resumes only under its original account, including after reopen", async t => {
  const alice = fakeCloud({ account:{ id:"a", name:"Owner" } }), bob = fakeCloud({ account:{ id:"b", name:"Owner" } });
  let active = alice, offline = true;
  const connector = {
    status:() => active.status(),
    cloudRequest(url, options) {
      if (offline) throw Object.assign(new Error("Unavailable"), { status:503 });
      return active.cloudRequest(url, options);
    },
  };
  const f = await setup(connector);
  t.after(f.done);
  const { cloudShare, service } = f.lines;
  assert.equal((await cloudShare.setSync(f.project, true)).sync, true);
  f.lines.close();
  offline = false;
  active = bob;
  const next = createProjectLines({ directory:service.store.directory, cloud:connector, serviceOptions:{ autoWatch:false, cloudScope:false } });
  t.after(() => next.close());
  await next.cloudShare.tick();
  assert.deepEqual(bob.calls, []);
  active = alice;
  await next.cloudShare.tick();
  assert.ok(alice.projects.get(f.project.id)?.files.some(file => file.path === "files/plan.png"));
});

test("an enabled project from an older registry adopts its published copy but cannot bootstrap a different account", async t => {
  const alice = fakeCloud({ account:{ id:"a", name:"User" } }), bob = fakeCloud({ account:{ id:"b", name:"User" } });
  let active = alice;
  const f = await setup({ status:() => active.status(), cloudRequest:(...args) => active.cloudRequest(...args) });
  t.after(f.done);
  const share = f.lines.cloudShare, p = f.project;
  // This is the entire setting a pre-upgrade paused first sync persisted.
  p.cloud = { sync:true };
  active = bob;
  await share.tick();
  assert.ok(bob.calls.every(call => call.startsWith("GET ")));
  assert.equal(bob.projects.size, 0);
  assert.equal(p.cloud.owner, undefined);
  active = alice;
  await share.setSync(p, true);
  const owner = p.cloud.owner;
  // A pre-upgrade installation with an established Cloud copy needs no new enable.
  p.cloud = { sync:true };
  fs.writeFileSync(path.join(p.docsPath, "files/plan.png"), "Updated");
  await share.tick();
  assert.equal(p.cloud.owner, owner);
  assert.ok(alice.projects.get(p.id).blobs.has(sha(Buffer.from("Updated"))));
  active = bob;
  bob.calls.length = 0;
  await share.tick();
  await assert.rejects(share.setSync(p, false), { code:"CLOUD_ACCOUNT_CHANGED" });
  assert.deepEqual(bob.calls, []);
});

test("sync-off fences an active read and its queued round, and a later explicit enable still works", { timeout:10000 }, async t => {
  const cloud = fakeCloud(), f = await setup(cloud);
  t.after(f.done);
  const share = f.lines.cloudShare, p = f.project;
  await share.setSync(p, true);
  const read = Promise.withResolvers(), release = Promise.withResolvers();
  const answer = cloud.cloudRequest.bind(cloud);
  let pauseRead = true;
  cloud.cloudRequest = async (url, options) => {
    const result = await answer(url, options);
    if (pauseRead && !options.method) {
      pauseRead = false;
      read.resolve();
      await release.promise;
    }
    return result;
  };
  const first = share.syncNow(p);
  await read.promise;
  const settled = Promise.allSettled([first, share.syncNow(p)]);
  const off = await share.setSync(p, false);
  const callsAtOff = cloud.calls.length;
  release.resolve();
  const results = await settled;
  assert.ok(results.every(result => result.status === "rejected" && result.reason.code === "SYNC_CHANGED"));
  await share.tick();
  assert.equal(off.sync, false);
  assert.equal(cloud.projects.has(p.id), false);
  assert.equal(cloud.calls.length, callsAtOff);
  assert.equal(fs.existsSync(path.join(f.temp, "state/cloud-sync", p.id + ".json")), false);
  await share.setSync(p, true);
  assert.ok(cloud.projects.get(p.id).files.some(file => file.path === "files/plan.png"));
});

test("sync-off orders deletion after a dispatched commit and a late enable cannot turn sync back on", { timeout:10000 }, async t => {
  const cloud = fakeCloud(), f = await setup(cloud);
  t.after(f.done);
  const share = f.lines.cloudShare, p = f.project;
  const sent = Promise.withResolvers(), finish = Promise.withResolvers();
  const answer = cloud.cloudRequest.bind(cloud);
  cloud.cloudRequest = async (url, options) => {
    if (url.endsWith("/commit")) { sent.resolve(); await finish.promise; }
    return answer(url, options);
  };
  const enable = assert.rejects(share.setSync(p, true), { code:"SYNC_CHANGED" });
  await sent.promise;
  const disable = share.setSync(p, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!cloud.calls.some(call => call.startsWith("DELETE ")));
  finish.resolve();
  await enable;
  assert.equal((await disable).sync, false);
  assert.equal(cloud.projects.has(p.id), false);
  assert.equal(Boolean(p.cloud?.sync), false);
  assert.equal(cloud.uploaded, 0);
});

test("standby sends no project or computer sync, then takes over with the owner's saved settings", { timeout:15000 }, async t => {
  const cloud = fakeCloud(), f = await setup(cloud, { cloudScope:true });
  t.after(f.done);
  const p = f.project;
  await f.lines.cloudShare.setSync(p, true);
  const acquired = Promise.withResolvers();
  const standby = createProjectLines({ directory:f.lines.service.store.directory, cloud, computerRounds:0,
    serviceOptions:{ autoWatch:false, recoverOnStart:true }, onRuntimeAcquired:acquired.resolve });
  t.after(() => standby.close());
  assert.ok(standby.service.runtimeBusy && !standby.service.releaseRuntime);
  const stale = standby.service.store.get(p.id);
  assert.equal(stale.cloud.sync, true);
  await f.lines.cloudShare.setSync(p, false);
  cloud.calls.length = 0;
  await standby.cloudShare.tick();
  await standby.computer.round();
  await assert.rejects(standby.cloudShare.syncNow(stale), { code:"RUNTIME_BUSY" });
  assert.deepEqual(cloud.calls, []);
  f.lines.close();
  await acquired.promise;
  await standby.cloudShare.tick();
  assert.equal(Boolean(stale.cloud?.sync), false);
  assert.deepEqual(cloud.calls, []);
  await standby.cloudShare.setSync(stale, true);
  assert.ok(cloud.projects.has(p.id), "an explicit enable works after takeover");
});

test("Share uploads the project once, gives a link, keeps it in Cloud, and Stop sharing keeps the copy", async () => {
  const cloud = fakeCloud(), t = await setup(cloud);
  try {
    const before = await t.call(`/projects/${t.project.id}/cloud`);
    assert.equal(before.status, 200);
    assert.equal(before.body.signedIn, true);
    assert.equal(before.body.remote, null);

    const shared = await t.call(`/projects/${t.project.id}/share`, "POST");
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.match(shared.body.link, /^https:\/\/cloud\.test\/l\/[0-9a-f-]{36}$/);
    assert.equal(shared.body.shared, true);
    assert.equal(shared.body.sync, true, "sharing keeps the project in Cloud");
    assert.equal((await t.call(`/projects/${t.project.id}/cloud`, "POST", { sync:false })).status, 409, "a shared project cannot leave Cloud");
    assert.ok(shared.body.remote.share.expiresAt > Date.now(), "a free account's link has an end date");
    const remote = cloud.projects.get(t.project.id);
    assert.deepEqual(remote.files.map(f => f.path).sort(), ["MEMORY.md", "README.md", "files/plan.png", "topics/first.md"].filter(p => fs.existsSync(path.join(t.project.docsPath, p.replace(/^topics\//, "lines/")))).sort(), "Cloud gets a line by the name it knows, topics/");
    assert.ok(!remote.files.some(f => f.path.startsWith(".history/")), "restore points stay on this computer");
    assert.equal(cloud.uploaded, new Set(remote.files.map(f => f.sha256)).size, "each file uploads once");
    assert.equal(cloud.calls.filter(c => c.includes("/blobs")).length, 1, "small files travel in one batch");
    const summary = cloud.summaries.at(-1);
    assert.ok(Array.isArray(summary.lines) && summary.notes >= 1, "the Cloud view gets the project's lines and notes");

    // Sharing saved the baseline. Even the first subsequent round needs only a revision check.
    cloud.calls.length = 0;
    await t.lines.cloudShare.tick();
    assert.deepEqual(cloud.calls, [`GET /api/v1/device-sync/line-projects/${t.project.id}?since=${cloud.projects.get(t.project.id).rev}`]);
    cloud.calls.length = 0;
    await t.lines.cloudShare.tick();
    assert.deepEqual(cloud.calls, [`GET /api/v1/device-sync/line-projects/${t.project.id}?since=${cloud.projects.get(t.project.id).rev}`]);
    // One changed file uploads alone.
    fs.writeFileSync(path.join(t.project.docsPath, "lines", "first.md"), "# First line\n\nMore.\n");
    const uploadedBefore = cloud.uploaded;
    await t.lines.cloudShare.tick();
    assert.equal(cloud.uploaded - uploadedBefore, 1, "only the changed file uploads");
    assert.ok(cloud.calls.includes(`POST /api/v1/device-sync/line-projects/${t.project.id}/commit`), "in one commit");

    const stored = JSON.parse(fs.readFileSync(path.join(t.lines.service.store.directory, "projects.json"), "utf8")).projects.find(p => p.id === t.project.id);
    assert.equal(stored.cloud.shared, true, "the choice survives a restart");

    const stopped = await t.call(`/projects/${t.project.id}/share`, "DELETE");
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.shared, false);
    assert.equal(stopped.body.sync, true, "a shared project stays in the user's Cloud space");
    assert.ok(cloud.projects.has(t.project.id));
    // Removing it from Cloud is a separate, explicit choice.
    await t.call(`/projects/${t.project.id}/cloud`, "POST", { sync:false });
    assert.equal(cloud.projects.has(t.project.id), false);
  } finally { await t.done(); }
});

test("Sync keeps a copy after sharing stops, and turning it off removes it", async () => {
  const cloud = fakeCloud({ plus:true }), t = await setup(cloud);
  try {
    const synced = await t.call(`/projects/${t.project.id}/cloud`, "POST", { sync:true });
    assert.equal(synced.status, 200);
    assert.equal(synced.body.sync, true);
    assert.ok(cloud.projects.has(t.project.id));
    const shared = await t.call(`/projects/${t.project.id}/share`, "POST");
    assert.equal(shared.body.remote.share.expiresAt, null, "Plus links stay open");
    const stopped = await t.call(`/projects/${t.project.id}/share`, "DELETE");
    assert.equal(stopped.body.remote.share, null);
    assert.ok(cloud.projects.has(t.project.id), "Sync keeps the copy");
    await t.call(`/projects/${t.project.id}/cloud`, "POST", { sync:false });
    assert.equal(cloud.projects.has(t.project.id), false);
    assert.equal(t.project.cloud, undefined);
  } finally { await t.done(); }
});

test("project settings can read upload activity and completion without contacting Cloud", { timeout:10000 }, async t => {
  const cloud = fakeCloud(), fixture = await setup(cloud);
  t.after(fixture.done);
  const route = `/projects/${fixture.project.id}/cloud`;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const answer = cloud.cloudRequest.bind(cloud);
  cloud.cloudRequest = async (url, options) => {
    if (url.endsWith("/blobs")) { entered.resolve(); await release.promise; }
    return answer(url, options);
  };
  const enabling = fixture.call(route, "POST", { sync:true });
  await entered.promise;
  try {
    const calls = cloud.calls.length;
    const { body } = await fixture.call(`${route}?activity=1`);
    assert.equal(body.progress.phase, "uploading");
    assert.ok(body.progress.total > 0);
    assert.equal(body.syncedAt, 0);
    assert.equal(body.remote, undefined);
    assert.equal(body.link, undefined);
    assert.equal(cloud.calls.length, calls);
  } finally { release.resolve(); }
  const enabled = await enabling;
  assert.equal(enabled.status, 200);
  const complete = (await fixture.call(`${route}?activity=1`)).body;
  assert.ok(complete.syncedAt > 0);
  assert.equal(complete.progress, null);

  cloud.cloudRequest = async () => { throw Object.assign(new Error("Cloud is temporarily unreachable."), { status:503 }); };
  const unavailable = (await fixture.call(route)).body;
  assert.equal(unavailable.statusError, "Cloud is temporarily unreachable.");
  assert.equal(unavailable.remote, null);
  assert.equal(unavailable.sync, true);
  const later = (await fixture.call(`${route}?activity=1`)).body;
  assert.equal(later.error, "", "a failed status read is not a failed sync");
  assert.equal(later.syncedAt, complete.syncedAt, "status reads never advance the timestamp");
});

test("disconnecting an attached Cloud project keeps the Cloud original and local files", async t => {
  const cloud = fakeCloud(), fixture = await setup(cloud);
  t.after(fixture.done);
  const route = `/projects/${fixture.project.id}/cloud`;
  const original = "cloud-original";
  fixture.project.cloud = { sync:false, key:original };
  const enabled = await fixture.call(route, "POST", { sync:true });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.key, original);
  const localFile = path.join(fixture.project.docsPath, "lines", "first.md");
  const before = fs.readFileSync(localFile, "utf8");
  cloud.calls.length = 0;
  const disconnected = await fixture.call(route, "POST", { sync:false });
  assert.equal(disconnected.status, 200);
  assert.equal(disconnected.body.sync, false);
  assert.equal(disconnected.body.key, original);
  assert.ok(cloud.projects.has(original));
  assert.equal(fs.readFileSync(localFile, "utf8"), before);
  assert.ok(!cloud.calls.some(call => call.startsWith("DELETE ")));
});

test("signed out, sharing asks for sign-in; a project over 300 MB is refused before anything uploads", async () => {
  const cloud = fakeCloud(), t = await setup(cloud);
  try {
    cloud.signOut();
    assert.equal((await t.call(`/projects/${t.project.id}/cloud`)).body.signedIn, false);
    const refused = await t.call(`/projects/${t.project.id}/share`, "POST");
    assert.equal(refused.status, 401);
    assert.equal(refused.body.code, "SIGN_IN");
    assert.equal((await t.call("/cloud/sign-in", "POST")).body.authorizationUrl, "https://cloud.test/dashboard.html");
  } finally { await t.done(); }
  const big = fakeCloud(), u = await setup(big);
  try {
    // Sparse files: large on paper, nothing written to disk.
    for (let n = 0; n < 7; n++) { const fd = fs.openSync(path.join(u.project.docsPath, "files", `big-${n}.bin`), "w"); fs.ftruncateSync(fd, 60 * 1024 * 1024 - n); fs.closeSync(fd); }
    const refused = await u.call(`/projects/${u.project.id}/share`, "POST");
    assert.equal(refused.status, 413);
    assert.match(refused.body.error, /free account keeps up to 200 MB/);
    assert.ok(big.calls.every(call => call.startsWith("GET ")), "no files or project changes were sent");
  } finally { await u.done(); }
});

test("a paid account's limit is its own Cloud storage, not a fixed 300 MB", async () => {
  const gib = 1024 ** 3;
  const paid = fakeCloud({ plus:true, account:{ name:"Ada", membership:{ tier:"pro" }, workspace:{ storageLimitBytes:2 * gib, storageUsedBytes:0 } } }), t = await setup(paid);
  try {
    assert.equal((await t.call(`/projects/${t.project.id}/cloud`)).body.maxBytes, 2 * gib);
  } finally { await t.done(); }
  const small = fakeCloud({ plus:true, account:{ name:"Ada", membership:{ tier:"plus" }, workspace:{ storageLimitBytes:3 * 1048576 } } }), u = await setup(small);
  try {
    const fd = fs.openSync(path.join(u.project.docsPath, "files", "big.bin"), "w"); fs.ftruncateSync(fd, 5 * 1048576); fs.closeSync(fd);
    const refused = await u.call(`/projects/${u.project.id}/share`, "POST");
    assert.equal(refused.status, 413);
    assert.match(refused.body.error, /Your PenEcho Cloud storage holds 3 MB/);
    assert.doesNotMatch(refused.body.error, /free account|300 MB/);
  } finally { await u.done(); }
});

test("a big first upload goes 100 files a request, three at a time, and says nothing is uploading once it is kept (PE-552)", async () => {
  const cloud = fakeCloud(), t = await setup(cloud), seen = [];
  const answer = cloud.cloudRequest.bind(cloud);
  let flying = 0, most = 0;
  // Blob requests take a moment, as on penecho.ai, so requests that overlap can be counted.
  cloud.cloudRequest = async (pathname, options = {}) => {
    if (!pathname.includes("/blobs")) return answer(pathname, options);
    flying++; most = Math.max(most, flying);
    try { await new Promise(r => setTimeout(r, 15)); return await answer(pathname, options); } finally { flying--; }
  };
  try {
    for (let i = 0; i < 250; i++) fs.writeFileSync(path.join(t.project.docsPath, "files", `note-${i}.md`), `note ${i}\n`);
    const peek = setInterval(async () => { try { const now = await t.call(`/projects/${t.project.id}/cloud`); if (now.body.progress?.phase === "uploading") seen.push(now.body.progress.done); } catch { /* the next look */ } }, 5);
    const kept = await t.call(`/projects/${t.project.id}/cloud`, "POST", { sync:true });
    clearInterval(peek);
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
    const batches = cloud.calls.filter(c => c.startsWith("POST") && c.endsWith("/blobs")).length;
    assert.ok(batches >= 3, `250+ files take at least 3 requests of up to 100 (${batches})`);
    assert.ok(most > 1, "requests go side by side");
    assert.equal((await t.call(`/projects/${t.project.id}/cloud`)).body.progress, null, "nothing is uploading once it is kept");

    // A later round with many changed files sends them side by side too.
    for (let i = 0; i < 250; i++) fs.writeFileSync(path.join(t.project.docsPath, "files", `note-${i}.md`), `note ${i} changed\n`);
    most = 0;
    await t.lines.cloudShare.tick();
    assert.equal(cloud.projects.get(t.project.id).files.find(f => f.path === "files/note-0.md").sha256, sha(Buffer.from("note 0 changed\n")));
    assert.ok(most > 1, "a later round's batches go side by side");
  } finally { await t.done(); }
});

test("PE-585: a first Share skips oversized files and keeps the small files in Cloud", async () => {
  const cloud = fakeCloud(), t = await setup(cloud);
  try {
    const large = path.join(t.project.docsPath, "files", "installer.dmg");
    const fd = fs.openSync(large, "w");
    try { fs.ftruncateSync(fd, 237 * 1048576); } finally { fs.closeSync(fd); }
    const result = await t.call(`/projects/${t.project.id}/share`, "POST");
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.shared, true);
    assert.equal(result.body.skipped.length, 1);
    assert.match(result.body.notice, /64 MB/);
    const files = cloud.projects.get(t.project.id).files;
    assert.equal(files.some(file => file.path === "files/installer.dmg"), false);
    assert.equal(files.some(file => file.path === "files/plan.png"), true);
    assert.equal(files.some(file => file.skipped), false, "local markers never go into Cloud snapshots");
    assert.equal(fs.statSync(large).size, 237 * 1048576);
  } finally { await t.done(); }
});

test("the skip notice says files over 64 MB stay on this computer apart from files PenEcho tries again", async () => {
  const cloud = fakeCloud(), t = await setup(cloud);
  const locked = path.join(t.project.docsPath, "files", "locked.md");
  try {
    const large = path.join(t.project.docsPath, "files", "film.mp4");
    const fd = fs.openSync(large, "w");
    try { fs.ftruncateSync(fd, 80 * 1048576); } finally { fs.closeSync(fd); }
    fs.writeFileSync(locked, "being written\n");
    fs.chmodSync(locked, 0o000);
    const result = await t.call(`/projects/${t.project.id}/share`, "POST");
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.skipped.length, 2);
    assert.match(result.body.notice, /^1 file is over 64 MB and stays on this computer: files\/film\.mp4 \(80 MB\)\. 1 file was skipped; PenEcho will try again: files\/locked\.md \(1 MB\)\. Skipping a transfer does not delete either copy\./);
  } finally { fs.chmodSync(locked, 0o644); await t.done(); }
});

for (const firstAction of ["share", "cloud"]) {
  test(`a file edited during first ${firstAction} is published consistently and catches up on the same link`, async () => {
    const cloud = fakeCloud(), t = await setup(cloud);
    try {
      const base = `/projects/${t.project.id}`, rel = "files/plan.png";
      const local = path.join(t.project.docsPath, rel);
      const original = Buffer.alloc(9 * 1024 * 1024, 65); // Larger than the in-memory snapshot budget.
      fs.writeFileSync(local, original);
      const answer = cloud.cloudRequest.bind(cloud);
      let edits = 0;
      cloud.cloudRequest = async (url, options) => {
        if (url.endsWith("/commit") && options?.body.rev === 0) {
          fs.writeFileSync(local, `edit ${++edits}`);
        }
        return answer(url, options);
      };
      const initial = await t.call(`${base}/${firstAction}`, "POST", firstAction === "cloud" ? { sync:true } : undefined);
      assert.equal(initial.status, 200, JSON.stringify(initial.body));
      assert.equal(edits, 2, "file changed during negotiation and again before publication");
      const shared = firstAction === "cloud" ? await t.call(`${base}/share`, "POST") : initial;
      assert.equal(shared.status, 200);
      const remote = cloud.projects.get(t.project.id);
      const published = () => remote.files.find(file => file.path === rel).sha256;
      assert.equal(published(), sha(original));
      assert.deepEqual(remote.blobs.get(published()), original);
      const link = shared.body.link;
      assert.ok(link);
      await t.lines.cloudShare.tick();
      assert.equal(remote.blobs.get(published()).toString(), "edit 2");
      assert.equal((await t.call(`${base}/cloud`)).body.link, link);
    } finally { await t.done(); }
  });
}

test("sharing a published revision preserves Cloud edits while local sync has a problem", async () => {
  const cloud = fakeCloud(), t = await setup(cloud);
  try {
    const base = `/projects/${t.project.id}`;
    await t.call(`${base}/cloud`, "POST", { sync:true });
    const remote = cloud.projects.get(t.project.id);
    const bytes = Buffer.from("guest note"), hash = sha(bytes);
    remote.files.push({ path:"topics/guest.md", sha256:hash, size:bytes.length });
    remote.blobs.set(hash, bytes);
    remote.rev++;
    fs.writeFileSync(path.join(t.project.docsPath, "files", "plan.png"), "pending local edit");
    const answer = cloud.cloudRequest.bind(cloud);
    cloud.cloudRequest = async (url, options) => {
      if (url.endsWith("/blobs")) throw new Error("Sync temporarily failed");
      return answer(url, options);
    };
    const uploaded = cloud.uploaded, rev = remote.rev;
    cloud.calls.length = 0;
    const shared = await t.call(`${base}/share`, "POST");
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.ok(shared.body.link);
    assert.equal(cloud.uploaded, uploaded);
    assert.equal(remote.rev, rev);
    assert.ok(remote.files.some(file => file.sha256 === hash));
    assert.deepEqual(cloud.calls.map(call => call.split(" ")[0]), ["GET", "POST"]);
    assert.ok(cloud.calls[1].endsWith("/share"));
  } finally { await t.done(); }
});

test("a partial first upload cannot produce a link until a revision is published", async () => {
  const cloud = fakeCloud(), t = await setup(cloud);
  try {
    const route = `/projects/${t.project.id}/share`, answer = cloud.cloudRequest.bind(cloud);
    cloud.cloudRequest = async (url, options) => {
      if (url.endsWith("/blobs")) throw Object.assign(new Error("Cloud storage is full"), { status:413 });
      return answer(url, options);
    };
    for (let i = 0; i < 2; i++) {
      assert.equal((await t.call(route, "POST")).status, 413);
      assert.equal(cloud.projects.get(t.project.id).rev, 0);
      assert.ok(!cloud.calls.some(call => call.endsWith("/share")));
    }
    cloud.cloudRequest = answer;
    assert.ok((await t.call(route, "POST")).body.link);
  } finally { await t.done(); }
});

test("a different computer publishing first keeps its Cloud files when this link starts syncing", async () => {
  const cloud = fakeCloud(), t = await setup(cloud);
  try {
    const base = `/projects/${t.project.id}`, remote = () => cloud.projects.get(t.project.id);
    const answer = cloud.cloudRequest.bind(cloud);
    cloud.cloudRequest = async (url, options) => {
      if (url.endsWith("/commit") && options.body.rev === 0 && remote()?.blobs.size) {
        const bytes = Buffer.from("from another computer"), hash = sha(bytes);
        remote().files = [{ path:"topics/guest.md", sha256:hash, size:bytes.length }];
        remote().blobs.set(hash, bytes);
        remote().rev++;
      }
      return answer(url, options);
    };
    cloud.accountFetch = async url => new Response(remote().blobs.get(url.split("/").pop()));
    const shared = await t.call(`${base}/share`, "POST");
    assert.ok(shared.body.link);
    assert.deepEqual(remote().files.map(file => file.path), ["topics/guest.md"]);
    await t.lines.cloudShare.tick();
    assert.equal(fs.readFileSync(path.join(t.project.docsPath, "lines", "guest.md"), "utf8"), "from another computer");
    assert.ok(remote().files.some(file => file.path === "topics/first.md"));
  } finally { await t.done(); }
});

test("a share-only Cloud can still publish a local project and reuse its link", async () => {
  const cloud = fakeCloud(), t = await setup(cloud);
  try {
    const answer = cloud.cloudRequest.bind(cloud);
    cloud.cloudRequest = async (url, options) => {
      if (url.endsWith("/commit")) throw Object.assign(new Error("No such route"), { code:"not_found", status:404 });
      if (!options?.method) {
        const response = await answer(url.split("?")[0], options);
        return { project:response.project && { ...response.project, rev:undefined } };
      }
      return answer(url, options);
    };
    const route = `/projects/${t.project.id}/share`;
    const shared = await t.call(route, "POST");
    assert.ok(shared.body.link, JSON.stringify(shared.body));
    const count = cloud.uploaded;
    assert.equal((await t.call(route, "POST")).body.link, shared.body.link);
    assert.equal(cloud.uploaded, count);
  } finally { await t.done(); }
});

test("Share joins an active first Keep in Cloud upload without waiting for the next edit", async () => {
  const cloud = fakeCloud(), t = await setup(cloud);
  const upload = Promise.withResolvers(), resume = Promise.withResolvers(), sharing = Promise.withResolvers();
  try {
    const base = `/projects/${t.project.id}`, answer = cloud.cloudRequest.bind(cloud);
    cloud.cloudRequest = async (url, options) => {
      if (url.endsWith("/blobs")) { upload.resolve(); await resume.promise; }
      const response = await answer(url, options);
      if (url.includes("?since=")) sharing.resolve();
      return response;
    };
    const keep = t.call(`${base}/cloud`, "POST", { sync:true });
    await upload.promise;
    const link = t.call(`${base}/share`, "POST");
    await sharing.promise;
    fs.writeFileSync(path.join(t.project.docsPath, "files", "plan.png"), "edit waiting for the next sync");
    resume.resolve();
    const [kept, shared] = await Promise.all([keep, link]);
    assert.equal(kept.status, 200);
    assert.ok(shared.body.link);
    const remote = cloud.projects.get(t.project.id);
    assert.equal(remote.rev, 1, "both actions used the first publication");
    assert.equal(remote.files.find(f => f.path === "files/plan.png").sha256, sha("PNG"));
    assert.equal(cloud.calls.filter(call => call.endsWith("/blobs")).length, 1);
  } finally { resume.resolve(); await t.done(); }
});
