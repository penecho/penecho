"use strict";
require("./helpers/safety.js");
// B3, local part: Cloud projects in the local app. Two computers and a stand-in Cloud: the account, the list, the pass-through,
// a copy on a second computer, sync both ways with merge or local first, and lines shown as working in Cloud, never holding back work here.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { fakeCloud, fakeConnector, sha } = require("./fake-cloud-lines.js");
const { mergeCanvas, renumberTheirs } = require("../src/server/project-lines/cloud-sync.js");

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-sync-")));
const closing = [];
after(async () => { for (const close of closing.reverse()) await close(); fs.rmSync(temp, { recursive:true, force:true }); });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 20000) { const start = Date.now(); for (;;) { const v = await check(); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(40); } }
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `
const say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  say({ type:"system", subtype:"init", session_id:"s-" + Date.now() });
  setTimeout(() => say({ type:"result", subtype:"success", is_error:false, result:"Done: " + (prompt.match(/slow|quick|[A-Z][a-z]+ here/) || ["it"])[0], session_id:"s" }), /slow/.test(prompt) ? 1500 : 10);
});
`);
const fakeAgent = name => ({ name, mono:name.slice(0, 2), color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }) });
const agents = () => createAgents({ env:{ PATH:"" }, extra:{ fake:fakeAgent("Fake"), other:fakeAgent("Other") } });
let count = 0;
// cloudScope: false keeps every file in the sync, for the tests of how a round moves files; true is the owner's rule (PE-581).
async function computer(cloud, { lineBeatMs = 0, retryMs = null, cloudScope = false, maxFiles = null, cloudSyncLogger = null } = {}) {
  const n = ++count, directory = path.join(temp, `state-${n}`), docsBase = path.join(temp, `computer-${n}`), connector = fakeConnector(cloud);
  fs.mkdirSync(directory, { recursive:true });
  const lines = createProjectLines({ cloud:() => connector, cloudSyncLogger, directory, agents:agents(), serviceOptions:{ autoWatch:false, cloudScope, docsBase, lineBeatMs, ...(retryMs ? { cloudRetryMs:retryMs } : {}), ...(maxFiles ? { cloudMaxFiles:maxFiles } : {}) }, authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  closing.push(() => { server.close(); lines.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  const call = async (method, route, body, headers = {}) => { const res = await fetch(`${base}${route}`, { method, headers:{ ...(body !== undefined ? { "content-type":"application/json" } : {}), ...headers }, ...(body !== undefined ? { body:typeof body === "string" ? body : JSON.stringify(body) } : {}) }); const text = await res.text(); let json = {}; try { json = JSON.parse(text); } catch { json = { text }; } return { status:res.status, ...json }; };
  const project = name => { const p = lines.service.store.create({ name, docsPath:path.join(docsBase, name) }); p.defaultAgent = "fake"; return p; };
  const service = lines.service, share = lines.cloudShare;
  const read = (p, rel) => fs.readFileSync(path.join(p.docsPath, rel), "utf8");
  const write = (p, rel, text) => { fs.mkdirSync(path.dirname(path.join(p.docsPath, rel)), { recursive:true }); fs.writeFileSync(path.join(p.docsPath, rel), text); };
  return { lines, service, share, connector, call, project, read, write, docsBase, sync:p => share.syncNow(p) };
}
async function copyOn(machine, key) { const made = await machine.call("POST", `/cloud/projects/${encodeURIComponent(key)}/copy`, {}); assert.equal(made.status, 200, made.error); return machine.service.store.projects.find(x => x.id === made.project.id); }
const topic = (title, asks) => `---\nid: T-1\nstatus: done\n---\n\n# ${title}\n\n${asks.map(([when, words]) => `## Ask · ${when}\n\n${words}\n`).join("\n")}`;

test("the account, the Cloud list, the pass-through, and a copy kept on a second computer", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), b = await computer(cloud), p = a.project("Garden");
  a.write(p, "notes/plan.md", "Plant tomatoes.\n");
  const on = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  assert.equal(on.status, 200, on.error);
  assert.equal(cloud.text(p.id, "notes/plan.md"), "Plant tomatoes.\n");
  const account = await a.call("GET", "/cloud/account");
  assert.deepEqual([account.signedIn, account.plan, account.credits, account.kept], [true, "free", { available:1500 }, { projects:1, limit:3 }]);
  const listed = await b.call("GET", "/cloud/projects");
  assert.deepEqual(listed.projects.map(x => [x.key, x.name, x.here]), [[p.id, "Garden", false]]);
  assert.deepEqual([listed.kept, listed.limit], [1, 3]);
  assert.deepEqual((await a.call("GET", "/cloud/projects")).projects.map(x => [x.here, x.id]), [[true, p.id]]);
  // Through Cloud, as it came and as it goes.
  const got = await b.call("GET", `/cloud/p/${p.id}/state?rev=7`);
  assert.deepEqual(got.echo, { method:"GET", path:`/api/v1/line-projects/${p.id}/state`, search:"?rev=7", body:"", type:"" });
  const posted = await b.call("POST", `/cloud/p/${p.id}/unsent`, { text:"Water them." });
  assert.deepEqual([posted.echo.method, posted.echo.path, JSON.parse(posted.echo.body), posted.echo.type], ["POST", `/api/v1/line-projects/${p.id}/unsent`, { text:"Water them." }, "application/json"]);
  assert.equal((await b.call("GET", `/cloud/p/${p.id}/../../device-sync`)).status, 404, "only that project's paths");
  // Keep a copy on this computer.
  const copied = await b.call("POST", `/cloud/projects/${encodeURIComponent(p.id)}/copy`, {});
  assert.equal(copied.status, 200, copied.error);
  const there = b.service.store.projects.find(x => x.id === copied.project.id);
  assert.equal(b.read(there, "notes/plan.md"), "Plant tomatoes.\n");
  assert.ok(p.cloud.owner);
  assert.deepEqual(there.cloud, { sync:true, key:p.id, owner:p.cloud.owner });
  assert.equal((await b.call("POST", `/cloud/projects/${encodeURIComponent(p.id)}/copy`, {})).existed, true, "asking again gives the same project");
  assert.deepEqual((await b.call("GET", "/cloud/projects")).projects.map(x => x.here), [true]);
  // Signed out: the pages hear it, nothing breaks.
  b.connector.signedIn = false;
  assert.equal((await b.call("GET", "/cloud/projects")).status, 401);
  assert.equal((await b.call("GET", "/cloud/account")).signedIn, false);
});

test("both ways: one-side edits cross, Asks added on each side both stay, a line rewritten two ways keeps this computer's, deletions go to .trash", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), b = await computer(cloud), p = a.project("Kitchen");
  a.write(p, "lines/menu.md", topic("Menu", [["2026-11-10 09:00", "Plan the menu."]]));
  a.write(p, "files/menu/list.txt", "eggs\n");
  a.write(p, "files/old.txt", "remove me\n");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  const q = await copyOn(b, p.id);
  // A file changed on each side.
  a.write(p, "files/menu/list.txt", "eggs\nflour\n");
  b.write(q, "MEMORY.md", `${b.read(q, "MEMORY.md")}\n- Use the big pan. (PE-1, 2026-11-10)\n`);
  await a.sync(p); await b.sync(q); await a.sync(p);
  assert.equal(b.read(q, "files/menu/list.txt"), "eggs\nflour\n", "A's edit is on B");
  assert.match(a.read(p, "MEMORY.md"), /Use the big pan/, "B's edit is on A");
  // An Ask added to the same line on each side: one file with both, in time order.
  a.write(p, "lines/menu.md", topic("Menu", [["2026-11-10 09:00", "Plan the menu."], ["2026-11-10 10:30", "Add a dessert."]]));
  b.write(q, "lines/menu.md", topic("Menu", [["2026-11-10 09:00", "Plan the menu."], ["2026-11-10 10:10", "No nuts, please."]]));
  await a.sync(p); await b.sync(q); await a.sync(p);
  for (const text of [a.read(p, "lines/menu.md"), b.read(q, "lines/menu.md")]) {
    assert.ok(text.indexOf("No nuts, please.") > 0 && text.indexOf("No nuts, please.") < text.indexOf("Add a dessert."), text);
    assert.equal(F.parseLine(text).steps.filter(s => s.kind === "ask").length, 3);
  }
  assert.deepEqual((await b.call("GET", `/projects/${q.id}/state`)).conflicts, []);
  // A line rewritten differently on each side: local first, Cloud's version kept in .history/, nobody asked (PE-578).
  a.write(p, "lines/menu.md", topic("Menu", [["2026-11-10 09:00", "Plan a vegan menu."]]));
  b.write(q, "lines/menu.md", topic("Menu", [["2026-11-10 09:00", "Plan a fish menu."]]));
  await a.sync(p); await b.sync(q);
  assert.deepEqual((await b.call("GET", `/projects/${q.id}/state`)).conflicts, [], "nothing for the person to choose");
  assert.match(b.read(q, "lines/menu.md"), /fish/, "the local file stays in place");
  assert.match(cloud.text(p.id, "topics/menu.md"), /fish/, "and goes to Cloud");
  const history = path.join(q.docsPath, ".history"), keptDir = fs.readdirSync(history).find(d => d.startsWith("cloud-"));
  assert.match(fs.readFileSync(path.join(history, keptDir, "topics/menu.md"), "utf8"), /vegan/, "Cloud's version is kept here");
  await a.sync(p);
  assert.match(a.read(p, "lines/menu.md"), /fish/, "the other computer takes it");
  // Deleted on one side: in .trash on the other.
  fs.rmSync(path.join(p.docsPath, "files/old.txt"));
  await a.sync(p); await b.sync(q);
  assert.equal(fs.existsSync(path.join(q.docsPath, "files/old.txt")), false);
  const trash = fs.readdirSync(path.join(q.docsPath, ".trash"));
  assert.ok(trash.some(d => fs.existsSync(path.join(q.docsPath, ".trash", d, "files/old.txt"))), "moved to .trash, not deleted");
});

test("a Cloud failure in the middle leaves both sides readable and the next round finishes; a fourth free project is refused as Cloud says", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Shed");
  a.write(p, "files/a.txt", "one\n");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  a.write(p, "files/a.txt", "two\n");
  cloud.edit(p.id, "files/b.txt", "from cloud\n");
  cloud.down = true;
  await assert.rejects(a.sync(p));
  assert.equal(a.read(p, "files/a.txt"), "two\n");
  cloud.down = false;
  await a.sync(p);
  assert.equal(cloud.text(p.id, "files/a.txt"), "two\n");
  assert.equal(a.read(p, "files/b.txt"), "from cloud\n");
  for (const name of ["Two", "Three"]) { const x = a.project(name); assert.equal((await a.call("POST", `/projects/${x.id}/cloud`, { sync:true })).status, 200); }
  const fourth = a.project("Four"), refused = await a.call("POST", `/projects/${fourth.id}/cloud`, { sync:true });
  assert.deepEqual(refused, { status:409, error:"project_limit", message:"A free account keeps 3 projects in Cloud.", details:{ kept:3, limit:3 } });
});

test("PE-574: a big upload cut off part way carries on: a cut batch is sent again, a lost connection keeps the switch on, and the next round sends only what Cloud lacks", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { retryMs:[5, 5] });
  const notes = (p, n, from = 0) => { for (let i = from; i < from + n; i++) a.write(p, `files/notes/n${i}.txt`, `note ${i} of ${p.name}\n`); };
  const inCloud = p => cloud.projects.get(p.id).files.filter(f => f.path.startsWith("files/notes/")).length;

  // A batch cut once on the way is sent again, and the first upload finishes.
  const p = a.project("Cut once");
  notes(p, 250);
  cloud.blobFail = n => n === 2 ? 503 : 0;
  const kept = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  assert.equal(kept.status, 200, kept.error); assert.equal(kept.sync, true); assert.equal(kept.error, "");
  assert.equal(inCloud(p), 250);

  // The connection stays down past every retry: the switch stays on, the box says so, and nothing was lost.
  const q = a.project("Dropped");
  notes(q, 450);
  let cutFrom = cloud.batches + 2;
  cloud.blobFail = n => n > cutFrom ? 503 : 0;
  const paused = await a.call("POST", `/projects/${q.id}/cloud`, { sync:true });
  assert.equal(paused.status, 200, paused.error); assert.equal(paused.sync, true);
  assert.match(paused.error, /connection to PenEcho Cloud dropped\. PenEcho carries on by itself/);
  assert.equal(q.cloud.sync, true, "kept on, so the round each minute carries on");
  const held = cloud.blobs.size;

  // The connection is back: the next round asks Cloud first and sends only the files it lacks.
  cloud.blobFail = null;
  const before = cloud.batches, commitsBefore = cloud.requests.filter(r => r.path.endsWith("/commit") || r.method === "PUT").length;
  await a.sync(q);
  assert.equal(inCloud(q), 450);
  const sent = cloud.blobs.size - held;
  assert.ok(sent < 450 && sent > 0, `only what Cloud lacked went up (${sent})`);
  assert.equal(cloud.batches - before, Math.ceil(sent / 100), "in as few batches as that takes");
  assert.ok(cloud.requests.filter(r => r.path.endsWith("/commit") || r.method === "PUT").length > commitsBefore);
  assert.equal((await a.call("GET", `/projects/${q.id}/cloud`)).error, "");

  // Kept in Cloud, many new files at once: Cloud is asked first here too, and a try cut off after two batches is carried on, not sent again.
  notes(p, 400, 1000);
  cutFrom = cloud.batches + 2;
  cloud.blobFail = n => n > cutFrom ? 503 : 0;
  await assert.rejects(a.sync(p));
  const partly = cloud.blobs.size;
  cloud.blobFail = null;
  const again = cloud.batches;
  await a.sync(p);
  assert.equal(inCloud(p), 650);
  assert.equal(cloud.batches - again, Math.ceil((cloud.blobs.size - partly) / 100));
  assert.ok(cloud.blobs.size - partly < 400, "the two batches stored before the cut were not sent again");
});

// PE-1067: Cloudflare ends any request not answered within about 140 s, upload time included, so the owner's 31 MB films never
// arrived in one request. A big file goes in 2 MB parts; a part cut off is sent again without the parts before it.
test("PE-1067: a big file goes up in parts, a cut-off part is sent again alone, and an older Cloud gets it whole", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { retryMs:[5, 5] });
  const big = require("node:crypto").randomBytes(2_600_000).toString("hex"), MB2 = 2 * 1024 * 1024;
  const p = a.project("Films");
  a.write(p, "files/film.txt", big);
  a.write(p, "files/note.txt", "small\n");
  cloud.partFail = n => n === 2 ? 524 : 0;
  const kept = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  assert.equal(kept.status, 200, kept.error); assert.equal(kept.error, "");
  const hash = cloud.projects.get(p.id).files.find(f => f.path === "files/film.txt").sha256;
  assert.equal(cloud.blobs.get(hash).toString("utf8"), big);
  assert.deepEqual(cloud.partsSent.map(x => [x.index, x.count]), [[0, 3], [1, 3], [2, 3]], "part 1 was cut once and sent again alone");
  assert.ok(cloud.partsSent.every(x => x.bytes <= MB2));
  assert.equal(cloud.requests.filter(r => r.method === "PUT" && r.path.endsWith(`/blobs/${hash}`)).length, 0, "never sent whole");

  // A Cloud from before parts answers 404: the file goes whole, as before.
  cloud.noParts = true;
  const q = a.project("Old Cloud");
  const other = big.replace(/^./, "x");
  a.write(q, "files/film.txt", other);
  const old = await a.call("POST", `/projects/${q.id}/cloud`, { sync:true });
  assert.equal(old.status, 200, old.error); assert.equal(old.error, "");
  const otherHash = cloud.projects.get(q.id).files.find(f => f.path === "files/film.txt").sha256;
  assert.equal(cloud.blobs.get(otherHash).toString("utf8"), other);
});

test("Cloudflare's 524 (penecho.ai did not answer within about 140 s) is sent again, keeps the switch on, and a new try does not show the old error", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { retryMs:[5, 5] });
  const notes = (p, n) => { for (let i = 0; i < n; i++) a.write(p, `files/notes/n${i}.txt`, `note ${i} of ${p.name}\n`); };
  const inCloud = p => cloud.projects.get(p.id).files.filter(f => f.path.startsWith("files/notes/")).length;

  // One batch answered 524 is sent again, and the first upload finishes with no error.
  const p = a.project("Slow store");
  notes(p, 250);
  cloud.blobFail = n => n === 2 ? 524 : 0;
  const kept = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  assert.equal(kept.status, 200, kept.error); assert.equal(kept.sync, true); assert.equal(kept.error, "");
  assert.equal(inCloud(p), 250);

  // Cloud keeps answering 524 past every retry: the switch stays on and the box says PenEcho carries on, not that the request failed.
  const q = a.project("Stalled store");
  notes(q, 450);
  const cutFrom = cloud.batches + 2;
  cloud.blobFail = n => n > cutFrom ? 524 : 0;
  const paused = await a.call("POST", `/projects/${q.id}/cloud`, { sync:true });
  assert.equal(paused.status, 200, paused.error); assert.equal(paused.sync, true);
  assert.match(paused.error, /PenEcho carries on by itself/);
  assert.doesNotMatch(paused.error, /HTTP 524|request failed/);
  assert.equal(q.cloud.sync, true);

  // A try that failed for good leaves its error; the next try the person starts does not show it beside its own progress.
  const r = a.project("Retried by hand");
  notes(r, 150);
  cloud.blobFail = () => 400;
  const failed = await a.call("POST", `/projects/${r.id}/cloud`, { sync:true });
  assert.notEqual(failed.status, 200);
  assert.ok(a.share.activity(r).error, "the failed try's error is shown");
  cloud.blobFail = null;
  const again = a.share.setSync(r, true);
  assert.equal(a.share.activity(r).error, "", "a new try starts without the old error");
  await again;
  assert.equal(inCloud(r), 150);

  // The stalled project finishes on the next round once Cloud answers again.
  await a.sync(q);
  assert.equal(inCloud(q), 450);
});

test("Cloud never holds back work on a computer: an Ask on a line working elsewhere runs at once; with Cloud away both run and are merged", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), b = await computer(cloud), p = a.project("Porch");
  const { slug } = await a.call("POST", `/projects/${p.id}/topics`, { text:"quick: paint it" });
  await until(() => !a.service.runs.size && ["done", "ready"].includes(F.parseLine(a.service.readDoc(p, slug)).status), "the first run");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  const q = await copyOn(b, p.id);
  q.defaultAgent = "fake";
  // A starts a slow Ask on the line; B asks on the same line while it works, and B's Ask runs at once (PE-583).
  await a.call("POST", `/projects/${p.id}/topics`, { topic:slug, text:"slow: paint it blue" });
  await until(() => a.service.runs.size === 1, "A's run");
  await until(() => [...cloud.runs.values()].some(r => r.line === slug), "A to hold the line in Cloud");
  const worksBefore = F.parseLine(b.service.readDoc(q, slug)).steps.filter(s => s.kind === "work").length;
  const sent = await b.call("POST", `/projects/${q.id}/topics`, { topic:slug, text:"quick: and the door" });
  assert.equal(sent.status, 200);
  await until(() => !b.service.runs.size, "B's run");
  const there = F.parseLine(b.service.readDoc(q, slug));
  assert.ok(!there.steps.some(s => F.isUnsent(s)), "nothing held back as Not sent");
  assert.equal(there.steps.filter(s => s.kind === "work").length, worksBefore + 1, "B's Ask ran");
  assert.notEqual(there.front.why, `Working on ${a.lines.computer.name()}`);
  assert.deepEqual([...cloud.runs.values()].filter(r => r.line === slug).map(r => r.where), [a.lines.computer.name()], "A keeps the line in Cloud");
  // A finishes and gives the line back; the next rounds bring both Asks to both sides.
  await until(() => !a.service.runs.size && ![...cloud.runs.values()].length, "A to finish and give the line back");
  for (let i = 0; i < 2; i++) { await a.sync(p); await b.sync(q); }
  for (const md of [a.read(p, `lines/${slug}.md`), b.read(q, `lines/${slug}.md`)]) { assert.match(md, /paint it blue/); assert.match(md, /and the door/); }
  // Cloud away: both sides run, and the next rounds merge what they did.
  cloud.down = true;
  await a.call("POST", `/projects/${p.id}/topics`, { topic:slug, text:"Anna here: sand first" });
  await b.call("POST", `/projects/${q.id}/topics`, { topic:slug, text:"Ben here: two coats" });
  await until(() => !a.service.runs.size && !b.service.runs.size, "both runs");
  cloud.down = false;
  for (let i = 0; i < 3; i++) { await a.sync(p).catch(() => {}); await b.sync(q).catch(() => {}); }
  const merged = a.read(p, `lines/${slug}.md`), conflicts = (await a.call("GET", `/projects/${p.id}/state`)).conflicts;
  assert.deepEqual(conflicts, [], "nothing for the person to choose");
  // Where the two clash, each computer's own part won in its round (local first, PE-578); the part it lost is in its .history/.
  const aside = [p.docsPath, q.docsPath].flatMap(root => { const history = path.join(root, ".history"); return fs.existsSync(history) ? fs.readdirSync(history).map(d => path.join(history, d, `topics/${slug}.md`)).filter(f => fs.existsSync(f)) : []; });
  const kept = [merged, ...aside.map(f => fs.readFileSync(f, "utf8"))].join("\n");
  assert.match(kept, /sand first/); assert.match(kept, /two coats/, "nothing either side asked is lost");
});

test("merging: lines added at one place on both sides both stay; a Canvas merges by its parts", () => {
  // Two Works made on two sides with the same number: Cloud's is renumbered, in its heading and its link.
  { const was = "# L\n\n## Ask · 2026-11-10 09:00\n\nGo.\n";
  const ours = `${was}\n## [x] Work 1 · @a\n\n[Details](l/work-1.md)\n`, cloudLine = `${was}\n## [x] Work 1 · @b\n\n[Details](l/work-1.md)\n`;
  const { text, moves } = renumberTheirs("l", was, ours, cloudLine);
  assert.deepEqual([...moves], [[1, 2]]);
  assert.match(text, /## \[x\] Work 2 · @b\n\n\[Details\]\(l\/work-2\.md\)/); }
  const widget = (id, html) => ({ kind:"widget", metadata:{ widgetId:id }, dataBase64:Buffer.from(JSON.stringify({ id, html })).toString("base64") });
  const tile = key => ({ kind:"tile", metadata:{ tileKey:key }, dataBase64:key });
  const bundle = assets => JSON.stringify({ bundleVersion:2, name:"C", manifest:{ format:"penecho-raster-tiles", extensions:{} }, assets });
  const base = bundle([widget("w1", "one"), tile("0,0")]);
  const mine = bundle([widget("w1", "one"), tile("0,0"), tile("1,1")]), theirs = bundle([widget("w1", "two"), tile("0,0")]);
  const out = JSON.parse(mergeCanvas(base, mine, theirs));
  assert.deepEqual(out.assets.map(a => a.metadata.widgetId || a.metadata.tileKey).sort(), ["0,0", "1,1", "w1"]);
  assert.equal(JSON.parse(Buffer.from(out.assets.find(a => a.kind === "widget").dataBase64, "base64").toString()).html, "two");
  assert.equal(mergeCanvas(base, bundle([widget("w1", "mine")]), bundle([widget("w1", "theirs")])), null, "the same Widget changed two ways cannot be decided");
  // Local first (PE-578): that Widget is this computer's, and Cloud's other parts still come in.
  const first = JSON.parse(mergeCanvas(base, bundle([widget("w1", "mine"), tile("0,0")]), bundle([widget("w1", "theirs"), tile("0,0"), tile("2,2")]), { localFirst:true }));
  assert.deepEqual(first.assets.map(a => a.metadata.widgetId || a.metadata.tileKey).sort(), ["0,0", "2,2", "w1"]);
  assert.equal(JSON.parse(Buffer.from(first.assets.find(a => a.kind === "widget").dataBase64, "base64").toString()).html, "mine");
});

test("two Works made on two sides with one detail file name: Cloud's is kept under the next number and its link follows", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), b = await computer(cloud), p = a.project("Works");
  a.write(p, "lines/fix.md", topic("Fix", [["2026-11-10 09:00", "Fix it."]]));
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  const q = await copyOn(b, p.id);
  const withWork = (when, words, who, detail) => `${topic("Fix", [["2026-11-10 09:00", "Fix it."], [when, words]])}\n## [x] Work 1 · @${who} · 1 min\n\nDone\n\n[Details](fix/work-1.md)\n`;
  a.write(p, "lines/fix.md", withWork("2026-11-10 10:00", "Anna asks", "claude")); a.write(p, "works/fix/work-1.md", "# Work 1\n\nAnna's work\n");
  b.write(q, "lines/fix.md", withWork("2026-11-10 10:05", "Ben asks", "codex")); b.write(q, "works/fix/work-1.md", "# Work 1\n\nBen's work\n");
  await a.sync(p); await b.sync(q); await b.sync(q); await a.sync(p);
  for (const [side, project] of [[a, p], [b, q]]) {
    const line = side.read(project, "lines/fix.md");
    // Whichever side merged second renumbered the piece that came from Cloud: each Work keeps its own number and detail file.
    const works = [...line.matchAll(/## \[x\] Work (\d+) · @(\w+)[\s\S]*?\[Details\]\(fix\/work-(\d+)\.md\)/g)].map(m => ({ n:m[1], who:m[2], file:m[3] }));
    assert.deepEqual(works.map(w => w.who), ["claude", "codex"], line);
    assert.deepEqual(works.map(w => w.n).sort(), ["1", "2"]);
    for (const w of works) {
      assert.equal(w.n, w.file, "the link follows the number");
      assert.match(side.read(project, `works/fix/work-${w.file}.md`), w.who === "claude" ? /Anna's work/ : /Ben's work/);
    }
    assert.deepEqual((await side.call("GET", `/projects/${project.id}/state`)).conflicts, [], "nothing for the person to choose");
  }
});

test("a commit Cloud refuses as stale writes nothing there and the next round finishes; a Canvas changed on both sides merges by its parts", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), b = await computer(cloud), p = a.project("Stale");
  const widget = (id, html) => ({ kind:"widget", contentType:"application/json", metadata:{ widgetId:id }, dataBase64:Buffer.from(JSON.stringify({ id, html })).toString("base64") });
  const canvas = assets => JSON.stringify({ version:2, bundleVersion:2, mode:"snapshot", formatVersion:1, name:"Board", manifest:{ format:"penecho-raster-tiles", formatVersion:1, extensions:{} }, assets });
  a.write(p, "files/board/canvas.penecho.json", canvas([widget("w1", "one")]));
  a.write(p, "notes.md", "first\n");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  const q = await copyOn(b, p.id);
  a.write(p, "notes.md", "first\nsecond\n");
  cloud.staleOnce = true;
  const refused = await a.sync(p);
  assert.equal(refused.stale, true);
  assert.equal(cloud.text(p.id, "notes.md"), "first\n", "nothing of ours was written there");
  await a.sync(p);
  assert.equal(cloud.text(p.id, "notes.md"), "first\nsecond\n", "the next round finishes");
  // The Canvas: a Widget added here, another changed there.
  a.write(p, "files/board/canvas.penecho.json", canvas([widget("w1", "one"), widget("w2", "added here")]));
  b.write(q, "files/board/canvas.penecho.json", canvas([widget("w1", "changed there")]));
  await b.sync(q); await a.sync(p); await b.sync(q);
  for (const [side, project] of [[a, p], [b, q]]) {
    const bundle = JSON.parse(side.read(project, "files/board/canvas.penecho.json"));
    const html = bundle.assets.map(x => JSON.parse(Buffer.from(x.dataBase64, "base64").toString()).html).sort();
    assert.deepEqual(html, ["added here", "changed there"]);
  }
});

test("a project removed in Cloud stops syncing and keeps every file here", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Removed");
  a.write(p, "notes.md", "keep me\n");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  cloud.projects.delete(p.id);
  await a.sync(p);
  assert.equal(a.read(p, "notes.md"), "keep me\n");
  assert.ok(!fs.existsSync(path.join(p.docsPath, ".trash")), "nothing was trashed");
  assert.equal(Boolean(p.cloud?.sync), false, "sync is off");
});

test("a run whose hold Cloud says is lost carries on to its end", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { lineBeatMs:100 }), p = a.project("Lost");
  const { slug } = await a.call("POST", `/projects/${p.id}/topics`, { text:"quick: start" });
  await until(() => !a.service.runs.size && ["done", "ready"].includes(F.parseLine(a.service.readDoc(p, slug)).status), "the first run");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  await a.call("POST", `/projects/${p.id}/topics`, { topic:slug, text:"slow: keep going" });
  await until(() => [...cloud.runs.values()].some(r => r.line === slug), "the hold");
  cloud.runs.clear();
  await new Promise(r => setTimeout(r, 400));
  assert.equal(a.service.runs.size, 1, "still running");
  await until(() => !a.service.runs.size, "the run to end", 5000);
  const doc = F.parseLine(a.service.readDoc(p, slug)), works = doc.steps.filter(s => s.kind === "work");
  assert.equal(works.length, 2);
  assert.ok(works[1].done && !works[1].off, "it finished, not stopped");
});

test("a run started here never stops when Cloud drops its hold (the computer round); it only lets the hold go", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Dropped");
  const { slug } = await a.call("POST", `/projects/${p.id}/topics`, { text:"quick: start" });
  await until(() => !a.service.runs.size && ["done", "ready"].includes(F.parseLine(a.service.readDoc(p, slug)).status), "the first run");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  await a.call("POST", `/projects/${p.id}/topics`, { topic:slug, text:"slow: keep going" });
  await until(() => a.service.runs.values().next().value?.lease?.id, "the hold");
  // Expired in Cloud (the computer slept, say): the round answers it as dropped.
  cloud.runs.clear();
  const answer = await a.lines.computer.round();
  assert.equal(answer.dropped.length, 1, "Cloud dropped it");
  const run = a.service.runs.values().next().value;
  assert.ok(run && !run.stopping, "still running");
  assert.equal(run.lease, null, "the hold is let go");
  await until(() => !a.service.runs.size, "the run to end", 5000);
  const works = F.parseLine(a.service.readDoc(p, slug)).steps.filter(s => s.kind === "work");
  assert.ok(works[1].done && !works[1].off, "it finished, not stopped");
});

test("E2E L1: a line held on penecho.ai still runs here at once; an Ask an older PenEcho held back is Not sent again and never starts by itself", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { lineBeatMs:100 }), p = a.project("Held");
  const { slug } = await a.call("POST", `/projects/${p.id}/topics`, { text:"quick: start" });
  await until(() => !a.service.runs.size && ["done", "ready"].includes(F.parseLine(a.service.readDoc(p, slug)).status), "the first run");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  // penecho.ai holds the line.
  cloud.runs.set("ai-hold", { id:"ai-hold", key:p.id, line:slug, where:"penecho.ai", since:new Date().toISOString(), touched:Date.now() });
  await a.call("POST", `/projects/${p.id}/topics`, { topic:slug, text:"slow: and the door", agent:"other" });
  assert.ok(!F.parseLine(a.service.readDoc(p, slug)).steps.some(s => F.isUnsent(s)), "not held back");
  await until(() => a.service.runs.size === 1, "the run");
  await until(() => !a.service.runs.size, "the run to end");
  let doc = F.parseLine(a.service.readDoc(p, slug));
  const works = doc.steps.filter(s => s.kind === "work");
  assert.equal(works.length, 2, "it ran");
  assert.equal(works[1].who, "other", "with the agent it was sent to");
  assert.notEqual(doc.front.why, "Working on penecho.ai");
  assert.deepEqual([...cloud.runs.keys()], ["ai-hold"], "penecho.ai's hold is left as it was");
  // An Ask an older PenEcho held back for that busy line, and the line said to be working there.
  const md = a.service.readDoc(p, slug);
  a.service.writeDoc(p, slug, F.setFront(`${md.trimEnd()}\n\n## Ask · 2026-11-17 07:42 · Not sent\n\nquick: and the gate\n\n${F.heldLine({ reason:"busy", where:"MacBook Air", since:"2026-11-17T07:42:57.420Z", agent:"fake" })}\n`, { status:"waiting", why:"Working on MacBook Air" }));
  assert.equal(F.parseLine(a.service.readDoc(p, slug)).steps.find(s => F.isUnsent(s)).held.reason, "busy");
  assert.equal(a.service.freeHeld(p), 1);
  doc = F.parseLine(a.service.readDoc(p, slug));
  const left = doc.steps.find(s => F.isUnsent(s));
  assert.equal(left.held, null, "a plain Not sent, with Send");
  assert.match(left.text, /and the gate/, "its words kept");
  assert.equal(doc.front.why, F.NOT_SENT);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(a.service.runs.size, 0, "nothing started by itself");
});

test("the Work that follows another on a line takes over its hold in Cloud, and the hold is given back at the end", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Relay");
  const { slug } = await a.call("POST", `/projects/${p.id}/topics`, { text:"quick: start" });
  await until(() => !a.service.runs.size && ["done", "ready"].includes(F.parseLine(a.service.readDoc(p, slug)).status), "the first run");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  await a.call("POST", `/projects/${p.id}/topics`, { topic:slug, text:"slow: first coat" });
  await until(() => [...cloud.runs.values()].some(r => r.line === slug), "the hold");
  const first = a.service.runs.values().next().value, hold = first.lease.id;
  // A second Ask for another agent waits for this Work and runs after it, here.
  await a.call("POST", `/projects/${p.id}/topics`, { topic:slug, text:"slow: second coat", agent:"other" });
  await until(() => a.service.runs.size === 1 && a.service.runs.values().next().value !== first, "the next Work", 8000);
  const next = a.service.runs.values().next().value;
  assert.equal(next.lease?.id, hold, "the same hold, passed on");
  assert.deepEqual([...cloud.runs.keys()], [hold]);
  await until(() => !a.service.runs.size, "the next Work to end", 8000);
  await until(() => !cloud.runs.size, "the hold to be given back");
  const doc = F.parseLine(a.service.readDoc(p, slug));
  assert.equal(doc.steps.filter(s => s.kind === "work" && s.done && !s.off).length, 3);
  assert.ok(!doc.steps.some(s => F.isUnsent(s)));
});

test("E2E L2: a project copied from Cloud keeps syncing to the key it was copied from, through status reads and sync toggles", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), b = await computer(cloud), p = a.project("Keyed");
  a.write(p, "notes.md", "one\n");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  const q = await copyOn(b, p.id);
  assert.notEqual(q.id, p.id);
  // What the page does next: read the project's Cloud state, and turn sync on again.
  assert.equal((await b.call("GET", `/projects/${q.id}/cloud`)).status, 200);
  assert.equal((await b.call("POST", `/projects/${q.id}/cloud`, { sync:true })).status, 200);
  assert.equal(q.cloud.key, p.id, "the key is kept");
  b.write(q, "notes.md", "one\ntwo\n");
  await b.sync(q);
  assert.equal(cloud.text(p.id, "notes.md"), "one\ntwo\n", "the change reaches the project it came from");
  assert.equal(cloud.projects.size, 1, "no second Cloud project");
  // Turning sync off keeps the Cloud project (it is the original) and the key; on again, it carries on.
  assert.equal((await b.call("POST", `/projects/${q.id}/cloud`, { sync:false })).status, 200);
  assert.ok(cloud.projects.has(p.id), "the Cloud project is not removed");
  assert.equal(q.cloud?.key, p.id);
  assert.equal((await b.call("POST", `/projects/${q.id}/cloud`, { sync:true })).status, 200);
  b.write(q, "notes.md", "one\ntwo\nthree\n");
  await b.sync(q);
  assert.equal(cloud.text(p.id, "notes.md"), "one\ntwo\nthree\n");
  assert.equal(cloud.projects.size, 1);
});

test("E2E L3: a commit that changes a line carries the project's summary, so Cloud's list and Home stay current", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Summary");
  a.write(p, "lines/one.md", topic("One", [["2026-11-10 09:00", "First line."]]));
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  assert.equal(cloud.projects.get(p.id).summary?.lines?.length, 1);
  a.write(p, "lines/two.md", topic("Two", [["2026-11-10 10:00", "Second line."]]));
  a.write(p, "lines/three.md", topic("Three", [["2026-11-10 11:00", "Third line."]]));
  await a.sync(p);
  const summary = cloud.projects.get(p.id).summary;
  assert.deepEqual(summary.lines.map(l => l.title).sort(), ["One", "Three", "Two"]);
  // A commit that changes no line leaves the summary to the last one that did.
  cloud.projects.get(p.id).summary = { marker:true };
  a.write(p, "notes.md", "just a note file\n");
  await a.sync(p);
  assert.deepEqual(cloud.projects.get(p.id).summary, { marker:true });
});

test("E2E L4: the account's storage follows Cloud, not the figure from sign-in", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Storage");
  a.write(p, "notes.md", "x".repeat(5000));
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  const used = [...cloud.projects.values()][0].files.reduce((n, f) => n + f.size, 0);
  assert.ok(used >= 5000);
  assert.deepEqual((await a.call("GET", "/cloud/account")).storage, { used, limit:200 * 1048576 }, "from Cloud's summary, read with the account");
  // An older Cloud with no summary: the figure is refreshed in the background, so the next read has it, and the page is not kept waiting.
  cloud.noSummary = true; cloud.storageUsed = 21270;
  const first = await a.call("GET", "/cloud/account");
  assert.equal(first.storage.used, 0, "this read answers at once with what it had");
  await until(() => a.connector.libraryCalls >= 1, "the background refresh");
  assert.equal((await a.call("GET", "/cloud/account")).storage.used, 21270);
});

// ---------- PE-303: why Keep in Cloud moved a whole project to its Trash ----------
// penecho.ai on 2026-11-11 had only the sharing routes (PR #78): a project answers { project } with no revision and no list of files,
// and `?since=` is not read. The first round made the project with the whole-list route and took "revision 1" and every file as
// agreed; the next round read the missing list as "Cloud has no files", so every unchanged file here was put aside.
const trashed = p => { try { return fs.readdirSync(path.join(p.docsPath, ".trash")).filter(n => n.startsWith("sync-")); } catch { return []; } };
const filesOf = (machine, p, n) => { for (let i = 0; i < n; i++) machine.write(p, i % 3 ? `notes/n${i}.md` : `lines/t${i}.md`, i % 3 ? `Note ${i}.\n` : topic(`Line ${i}`, [["2026-11-11 07:00", `Ask ${i}.`]])); };
for (const size of [3, 12]) {
  test(`PE-303: a Cloud that cannot sync both ways never puts this computer's files aside (${size} files)`, async () => {
    const cloud = await fakeCloud(); closing.push(() => cloud.close());
    cloud.old = true;
    const a = await computer(cloud), p = a.project(`Meetcue ${size}`);
    filesOf(a, p, size);
    const kept = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
    let refused = kept.status >= 400 ? kept : null;
    for (let round = 0; round < 3; round++) { try { await a.sync(p); } catch (error) { refused = refused || { code:error.code, error:error.message }; } }
    assert.deepEqual(trashed(p), [], "nothing was put aside");
    for (let i = 0; i < size; i++) assert.ok(fs.existsSync(path.join(p.docsPath, i % 3 ? `notes/n${i}.md` : `lines/t${i}.md`)), `file ${i} is still here`);
    assert.equal(refused?.code, "cloud_cannot_sync", "the person is told why");
    assert.match(refused.error, /nothing on this computer was changed/i);
  });
}

test("PE-303: a Cloud copy made again (its revision went back, with fewer files) is not a reason to put files aside here", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Remade");
  filesOf(a, p, 3);
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  a.write(p, "notes/n1.md", "Changed.\n"); await a.sync(p);
  a.write(p, "notes/n2.md", "Changed again.\n"); await a.sync(p);
  const before = cloud.projects.get(p.id).rev;
  assert.ok(before >= 2);
  // Removed in Cloud and made again from somewhere else with one file: a new project, revision 1.
  cloud.projects.set(p.id, { key:p.id, name:"Remade", files:[cloud.projects.get(p.id).files.find(f => f.path === "topics/t0.md")], rev:1, updatedAt:Date.now() });
  const did = await a.sync(p);
  assert.deepEqual(trashed(p), []);
  assert.equal(did.trashed, 0); assert.equal(did.kept, 0, "the guard is not what saved them");
  assert.deepEqual(cloud.projects.get(p.id).files.map(f => f.path).filter(f => f !== "MEMORY.md").sort(), ["notes/n1.md", "notes/n2.md", "topics/t0.md"], "Cloud has them again");
});

test("PE-303, the other way: this computer lacking much of a project does not make Cloud remove much of it", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Folder emptied");
  filesOf(a, p, 12);
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  // Two files removed on purpose: Cloud removes them too, as before.
  const all = cloud.projects.get(p.id).files.length;
  fs.rmSync(path.join(p.docsPath, "notes/n1.md")); fs.rmSync(path.join(p.docsPath, "notes/n2.md"));
  let did = await a.sync(p);
  assert.equal(did.removed, 2);
  assert.equal(cloud.projects.get(p.id).files.length, all - 2);
  // Then most of the folder goes (a drive not there, a folder moved): those are brought back, and Cloud keeps them.
  for (const name of fs.readdirSync(path.join(p.docsPath, "notes"))) fs.rmSync(path.join(p.docsPath, "notes", name));
  for (const name of fs.readdirSync(path.join(p.docsPath, "lines"))) if (name.startsWith("t")) fs.rmSync(path.join(p.docsPath, "lines", name));
  did = await a.sync(p);
  assert.equal(did.removed, 0);
  assert.ok(did.restored >= 6, `brought back: ${did.restored}`);
  assert.equal(cloud.projects.get(p.id).files.length, all - 2, "Cloud removed nothing");
  assert.ok(fs.existsSync(path.join(p.docsPath, "notes/n4.md")), "and this computer has them again");
  const status = await a.call("GET", `/projects/${p.id}/cloud`);
  assert.match(status.notice, /were missing on this computer\. They were brought back from Cloud/);
});

test("a project here is never also listed as only in Cloud: its id or its Cloud key is what matches, synced or not", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("PenEcho");
  a.write(p, "notes/a.md", "A.\n");
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  // Another PenEcho server writing the same projects.json, or an older version, left this one without its Cloud setting.
  delete p.cloud;
  const listed = (await a.call("GET", "/cloud/projects")).projects.filter(x => x.name === "PenEcho");
  assert.deepEqual(listed.map(x => [x.here, x.id, x.syncing]), [[true, p.id, false]]);
});

test("PE-466: a Line deleted on either side goes from the other with its Works and files, however many; restored, it comes back on both", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), b = await computer(cloud), p = a.project("Deletes");
  const here = ["lines/plan.md", "works/plan/work-1.md", "works/plan/work-2.md", "works/plan/work-3.md", "files/plan/a.txt", "files/plan/b.txt"];
  const there = ["topics/plan.md", "topics/plan/work-1.md", "topics/plan/work-2.md", "topics/plan/work-3.md", "files/plan/a.txt", "files/plan/b.txt"];
  a.write(p, "lines/plan.md", topic("Plan", [["2026-11-15 09:00", "Plan it."]]));
  for (const rel of here.slice(1)) a.write(p, rel, `${rel}\n`);
  a.write(p, "lines/keep.md", topic("Keep", [["2026-11-15 09:00", "Keep it."]]));
  for (let i = 0; i < 3; i++) a.write(p, `notes/n${i}.md`, `Note ${i}.\n`);
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  const q = await copyOn(b, p.id);
  // Each side's own small edits (the status block it writes) settle first, as the rounds every minute do.
  await b.sync(q); await a.sync(p); await b.sync(q);
  const inCloud = () => there.filter(rel => cloud.text(p.id, rel) !== null);
  const onDisk = project => here.filter(rel => fs.existsSync(path.join(project.docsPath, rel)));
  assert.deepEqual(inCloud(), there);
  assert.ok(here.length * 5 > cloud.projects.get(p.id).files.length, "more than the brakes let go in this project");
  // Deleted on A: all of it leaves Cloud in one round, and nothing comes back to A.
  await a.service.act(p, "plan", "delete", { confirm:"plan", baseHash:a.service.store.readText(p, "lines/plan.md").hash });
  let did = await a.sync(p);
  assert.deepEqual([did.removed, did.restored], [6, 0]);
  assert.deepEqual([inCloud(), onDisk(p)], [[], []]);
  assert.equal(p.cloud?.sync, true, "files removed in Cloud are not the project removed there: sync stays on");
  assert.match(cloud.text(p.id, "topics/keep.md"), /Keep it/);
  // On B it goes to Deleted, as if deleted there, and nothing is sent back.
  did = await b.sync(q);
  assert.deepEqual([did.kept, did.pushed], [0, 0]);
  assert.equal(b.service.store.isDeleted(q, "plan"), true);
  assert.deepEqual([inCloud(), onDisk(q), trashed(q)], [[], [], []]);
  assert.ok(fs.existsSync(path.join(q.docsPath, b.service.store.deleted[`${q.id}:plan`].trash, "works/plan/work-2.md")));
  // Restored on B: back in Cloud, and A takes it back out of its Deleted.
  b.service.store.restoreTopic(q, "plan");
  await b.sync(q);
  assert.deepEqual(inCloud(), there);
  did = await a.sync(p);
  assert.deepEqual(onDisk(p), here);
  assert.equal(a.service.store.isDeleted(p, "plan"), false);
  assert.deepEqual(inCloud(), there, "and Cloud keeps it");
  // Changed in Cloud before A's deletion reached it: Cloud's version goes with the deleted Line on A, so restoring brings the newest.
  b.write(q, "lines/plan.md", topic("Plan", [["2026-11-15 09:00", "Plan it."], ["2026-11-15 10:00", "From the phone."]]));
  await b.sync(q);
  await a.service.act(p, "plan", "delete", { confirm:"plan", baseHash:a.service.store.readText(p, "lines/plan.md").hash });
  did = await a.sync(p);
  assert.deepEqual([did.restored, inCloud(), onDisk(p)], [0, [], []]);
  a.service.store.restoreTopic(p, "plan");
  assert.match(a.read(p, "lines/plan.md"), /From the phone/);
});

test("PE-582: a Cloud review of a linked archived Work survives repeated syncs at the file limit", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  // At Cloud's old limit of 5,000, so the test stays quick; the rule is the same at 20,000 (PE-581).
  const a = await computer(cloud, { maxFiles:5000 }), p = a.project("Reviewed work");
  a.write(p, "lines/old.md", topic("Old", []).replace("status: done", "status: closed"));
  a.write(p, "works/old/work-1.md", "---\nstep: Work 1\n---\n\n## Result\n\nFinished.\n");
  a.write(p, "lines/current.md", `${topic("Current", [])}\n## [x] Work 1 · @fake\n\n[Details](../archive/works/old/work-1.md)\n`);
  assert.equal(a.service.store.placeLine(p, "old", true), true);
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  const rel = "topics/old/work-1.md", reviewed = "2026-11-17 07:42";
  cloud.edit(p.id, rel, F.setFront(cloud.text(p.id, rel), { reviewed }));
  // Attachments grow after the last sync. Missing a Work from the next bounded
  // listing must not be mistaken for deleting it from Cloud.
  for (let i = 0; i < 4600; i++) a.write(p, `files/research/log-${i}.txt`, "log\n");
  // Knowledge Topics go to Cloud too since PE-581 (under .knowledge/), so they count.
  for (let i = 0; i < 200; i++) a.write(p, `topics/knowledge-${i}.md`, "# Knowledge\n");
  for (let round = 0; round < 3; round++) {
    await a.sync(p);
    assert.equal(F.splitFront(cloud.text(p.id, rel)).front.reviewed, reviewed, `Cloud keeps the review after round ${round + 1}`);
    const state = a.service.stateOf(p), current = [...state.lines, ...state.landed, ...state.backlog].find(l => l.slug === "current");
    assert.equal(current.stations.find(s => s.id === "work-1").reviewed, true, "the active Line uses its linked Work's review");
    assert.equal(F.splitFront(a.read(p, "archive/works/old/work-1.md")).front.reviewed, reviewed);
  }
  // Explicitly unreviewing in Cloud must still come through.
  cloud.edit(p.id, rel, F.setFront(cloud.text(p.id, rel), { reviewed:null }));
  await a.sync(p);
  assert.equal(F.splitFront(a.read(p, "archive/works/old/work-1.md")).front.reviewed, undefined);
  // A genuinely oversized sync must report the limit, never send a partial
  // inventory that removes existing Cloud files to make room for other ones.
  cloud.edit(p.id, rel, F.setFront(cloud.text(p.id, rel), { reviewed }));
  const before = cloud.projects.get(p.id).rev;
  for (let i = 4600; i < 4900; i++) a.write(p, `files/research/log-${i}.txt`, "log\n");
  await assert.rejects(a.sync(p), error => error.code === "TOO_MANY_FILES" && error.status === 413);
  assert.equal(cloud.projects.get(p.id).rev, before, "no partial commit when over Cloud's limit");
  assert.equal(F.splitFront(cloud.text(p.id, rel)).front.reviewed, reviewed);
});

test("PE-466: an archived Line syncs under its own name, and deleted on the other side it goes to Deleted from archive/", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), b = await computer(cloud), p = a.project("Archived");
  a.write(p, "lines/old.md", topic("Old", [["2026-11-15 09:00", "Done long ago."]]).replace("status: done", "status: closed"));
  for (const rel of ["works/old/work-1.md", "works/old/work-2.md", "files/old/a.txt"]) a.write(p, rel, `${rel}\n`);
  a.write(p, "lines/keep.md", topic("Keep", [["2026-11-15 09:00", "Keep it."]]));
  assert.equal(a.service.store.placeLine(p, "old", true), true);
  assert.ok(fs.existsSync(path.join(p.docsPath, "archive/lines/old.md")), "archived into archive/");
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  assert.match(cloud.text(p.id, "topics/old.md"), /status: closed/, "in Cloud by its own name");
  assert.equal(cloud.text(p.id, "topics/old/work-2.md"), "works/old/work-2.md\n");
  const q = await copyOn(b, p.id);
  await b.sync(q); await a.sync(p); await b.sync(q);
  await b.service.act(q, "old", "delete", { confirm:"old", baseHash:b.service.store.readText(q, "lines/old.md").hash });
  await b.sync(q);
  assert.equal(cloud.text(p.id, "topics/old.md"), null);
  const did = await a.sync(p);
  assert.deepEqual([did.kept, a.service.store.isDeleted(p, "old")], [0, true]);
  assert.deepEqual(["archive/lines/old.md", "archive/works/old", "archive/files/old"].filter(rel => fs.existsSync(path.join(p.docsPath, rel))), []);
  assert.equal(cloud.text(p.id, "topics/old.md"), null, "and not sent back");
});

test("PE-466: Cloud losing most of a project's Lines at once is not taken for Lines deleted there", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Lost lines");
  for (let i = 0; i < 5; i++) {
    a.write(p, `lines/l${i}.md`, topic(`Line ${i}`, [["2026-11-15 09:00", `Ask ${i}.`]]));
    for (const n of [1, 2]) a.write(p, `works/l${i}/work-${n}.md`, `Work ${n} of line ${i}.\n`);
  }
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  const kept = cloud.projects.get(p.id);
  kept.files = kept.files.filter(f => !/^topics\/l[0-3](?:\.md|\/)/.test(f.path)); kept.rev++;
  const did = await a.sync(p);
  assert.deepEqual([did.trashed, did.kept], [0, 12]);
  assert.deepEqual([0, 1, 2, 3].filter(i => a.service.store.isDeleted(p, `l${i}`)), []);
  assert.match(cloud.text(p.id, "topics/l2.md"), /Ask 2/, "sent to Cloud again");
});

// PE-585: a file that cannot fit in Cloud must not stop unrelated project work.
const oversizeFile = (project, rel) => {
  const file = path.join(project.docsPath, rel);
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const fd = fs.openSync(file, "w");
  try { fs.ftruncateSync(fd, 237 * 1048576); } finally { fs.closeSync(fd); }
  return file;
};

test("PE-585: oversized files are never read; first sync and later uploads/downloads continue", async t => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Skip large first");
  const large = oversizeFile(p, "files/installer.dmg");
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", function(file, ...args) {
    assert.notEqual(String(file), large, "oversized file content must not be read");
    return read.call(this, file, ...args);
  });
  a.write(p, "notes/local.md", "first local version");
  const on = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  assert.equal(on.status, 200, on.error);
  assert.equal(on.error, "");
  assert.equal(on.skipped.length, 1);
  assert.match(on.notice, /64 MB/);
  assert.equal(cloud.text(p.id, "files/installer.dmg"), null);
  assert.equal(cloud.text(p.id, "notes/local.md"), "first local version");
  cloud.edit(p.id, "notes/remote.md", "from Cloud");
  a.write(p, "notes/local.md", "second local version");
  await a.sync(p);
  assert.equal(a.read(p, "notes/remote.md"), "from Cloud");
  assert.equal(cloud.text(p.id, "notes/local.md"), "second local version");
  assert.equal(fs.statSync(large).size, 237 * 1048576);
  await a.sync(p);
  assert.equal(cloud.text(p.id, "files/installer.dmg"), null);
});

test("PE-1054: a file that cannot be read is held, not treated as deleted", async context => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const mac = await computer(cloud), project = mac.project("Temporary read failure");
  const held = "files/unavailable.txt", healthy = "files/healthy.txt", full = path.join(project.docsPath, held);
  mac.write(project, held, "local draft"); mac.write(project, healthy, "first healthy version");
  const read = fs.readFileSync;
  let denied = true;
  context.mock.method(fs, "readFileSync", (file, ...args) => {
    if (denied && file === full) throw Object.assign(new Error("Read denied"), { code:"EACCES" });
    return read(file, ...args);
  });
  const first = await mac.share.setSync(project, true);
  assert.equal(first.sync, true);
  assert.equal(cloud.text(project.id, healthy), "first healthy version");
  assert.equal(cloud.text(project.id, held), null);
  assert.equal(first.skipped.find(file => file.path === held)?.reason, "unreadable");
  denied = false;
  await mac.sync(project);
  assert.equal(cloud.text(project.id, held), "local draft");

  mac.write(project, held, "new local draft"); mac.write(project, healthy, "second healthy version");
  cloud.edit(project.id, held, "cloud draft");
  denied = true;
  await mac.sync(project);
  assert.equal(cloud.text(project.id, healthy), "second healthy version");
  assert.equal(cloud.text(project.id, held), "cloud draft");
  assert.equal(read(full, "utf8"), "new local draft");
  denied = false;
  await mac.sync(project);
  assert.equal(cloud.text(project.id, held), "new local draft");
  assert.deepEqual(mac.share.activity(project).skipped, []);
});

test("PE-1054: a rejected blob holds every alias, retries, and never appears committed", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const mac = await computer(cloud), project = mac.project("Rejected blob");
  const held = ["files/rejected.txt", "files/alias.txt"], healthy = "files/healthy.txt";
  let badHash = sha(Buffer.from("rejected bytes"));
  const request = mac.connector.cloudRequest;
  mac.connector.cloudRequest = async (url, options) => {
    if (url.endsWith("/blobs") && options.bytes && badHash) {
      const header = JSON.parse(options.bytes.subarray(4, 4 + options.bytes.readUInt32BE(0)));
      if (header.some(file => file.sha256 === badHash)) throw Object.assign(new Error("Blob checksum rejected"), { code:"checksum_mismatch", status:400, details:{ sha256:badHash } });
    }
    return request(url, options);
  };
  for (const file of held) mac.write(project, file, "rejected bytes");
  mac.write(project, healthy, "first healthy version");
  const first = await mac.share.setSync(project, true);
  assert.equal(first.sync, true);
  assert.deepEqual(first.skipped.filter(file => file.reason === "rejected").map(file => file.path).sort(), held.slice().sort());
  assert.equal(cloud.text(project.id, healthy), "first healthy version");
  for (const file of held) assert.equal(cloud.text(project.id, file), null);
  badHash = null;
  await mac.sync(project);
  for (const file of held) assert.equal(cloud.text(project.id, file), "rejected bytes");

  badHash = sha(Buffer.from("second rejection"));
  for (const file of held) mac.write(project, file, "second rejection");
  mac.write(project, healthy, "second healthy version");
  const partial = await mac.sync(project);
  assert.equal(partial.pushed, 1);
  assert.equal(cloud.text(project.id, healthy), "second healthy version");
  for (const file of held) assert.equal(cloud.text(project.id, file), "rejected bytes");
  badHash = null;
  assert.equal((await mac.sync(project)).pushed, 2);
  for (const file of held) assert.equal(cloud.text(project.id, file), "second rejection");
  assert.deepEqual(mac.share.activity(project).skipped, []);
});

test("PE-1054: a missing download does not strand other files or advance its agreement", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const mac = await computer(cloud), project = mac.project("Missing download");
  const held = "files/missing.txt", healthy = "files/healthy.txt";
  mac.write(project, held, "before");
  await mac.share.setSync(project, true);
  cloud.edit(project.id, held, "temporarily missing bytes");
  cloud.edit(project.id, healthy, "healthy download");
  const hash = sha(Buffer.from("temporarily missing bytes")), bytes = cloud.blobs.get(hash);
  cloud.blobs.delete(hash);
  assert.equal((await mac.sync(project)).pulled, 1);
  assert.equal(mac.read(project, healthy), "healthy download");
  assert.equal(mac.read(project, held), "before");
  assert.equal(mac.share.activity(project).skipped.find(file => file.path === held)?.reason, "download_failed");
  cloud.blobs.set(hash, bytes);
  assert.equal((await mac.sync(project)).pulled, 1);
  assert.equal(mac.read(project, held), "temporarily missing bytes");
});

test("PE-1054: if no file can publish, keep retrying without reporting success", async context => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const mac = await computer(cloud), project = mac.project("Retry before publication");
  const file = "files/readable-later.txt";
  mac.write(project, file, "eventually readable");
  const projectFiles = new Set(mac.service.store.walk(project).map(entry => path.join(project.docsPath, entry.path)));
  const read = fs.readFileSync;
  const readFailure = context.mock.method(fs, "readFileSync", (full, ...args) => {
    if (projectFiles.has(full)) throw Object.assign(new Error("Temporarily unavailable"), { code:"EACCES" });
    return read(full, ...args);
  });
  const first = await mac.share.setSync(project, true);
  assert.equal(first.sync, true);
  assert.equal(first.syncedAt, 0);
  assert.equal(cloud.projects.has(project.id), false);
  assert.equal((await mac.share.status(project)).sync, true);
  assert.equal(JSON.parse(fs.readFileSync(mac.service.store.file)).projects.find(entry => entry.id === project.id)?.cloud.sync, true);
  readFailure.mock.restore();
  await mac.share.tick();
  assert.equal(cloud.text(project.id, file), "eventually readable");
  assert.equal((await mac.share.status(project)).error, "");
});

test("PE-1054: project quota cannot be mistaken for a single-file rejection", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const events = [];
  const mac = await computer(cloud, { cloudSyncLogger:event => events.push(event) }), project = mac.project("Workspace full");
  mac.write(project, "files/one.txt", "only file");
  const request = mac.connector.cloudRequest;
  mac.connector.cloudRequest = (url, options) => {
    if (url.endsWith("/blobs")) throw Object.assign(new Error("Cloud storage is full"), { code:"line_project_too_large", status:413, details:{ maxBytes:0 } });
    return request(url, options);
  };
  await assert.rejects(mac.share.setSync(project, true), { code:"line_project_too_large" });
  assert.equal(cloud.projects.get(project.id).rev, 0);
  assert.deepEqual(mac.share.activity(project).skipped, []);
  assert.equal(mac.share.activity(project).sync, false);
  assert.ok(events.some(event => event.event === "blob-upload-failed" && event.code === "line_project_too_large" && event.status === 413));
});

test("PE-585: growing files retain their Cloud copy and baseline across reload, edits and removal; shrinking rejoins", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Skip grown file"), rel = "files/installer.dmg";
  a.write(p, rel, "old small copy");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  const stateFile = path.join(a.service.store.directory, "cloud-sync", `${p.id}.json`);
  const original = JSON.parse(fs.readFileSync(stateFile)).base[rel];
  const large = oversizeFile(p, rel);
  await a.sync(p);
  assert.equal(cloud.text(p.id, rel), "old small copy");
  cloud.edit(p.id, rel, "Cloud changed while skipped");
  const { createCloudShare } = require("../src/server/project-lines/cloud-share.js");
  const reloaded = createCloudShare({ store:a.service.store, directory:a.service.store.directory, connector:a.connector });
  closing.push(() => reloaded.close());
  for (let round = 0; round < 2; round++) {
    await reloaded.syncNow(p);
    assert.equal(fs.statSync(large).size, 237 * 1048576);
    assert.equal(cloud.text(p.id, rel), "Cloud changed while skipped");
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).base[rel], original);
  }
  const remote = cloud.projects.get(p.id);
  remote.files = remote.files.filter(f => f.path !== rel); remote.rev++;
  await reloaded.syncNow(p);
  assert.equal(fs.statSync(large).size, 237 * 1048576, "remote deletion cannot trash a skipped local file");
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).base[rel], original);
  a.write(p, rel, "small again");
  await reloaded.syncNow(p);
  assert.equal(cloud.text(p.id, rel), "small again");
  assert.deepEqual((await reloaded.status(p)).skipped, []);
  assert.doesNotMatch((await reloaded.status(p)).notice || "", /skipped/);
  oversizeFile(p, rel); await reloaded.syncNow(p);
  fs.unlinkSync(large); await reloaded.syncNow(p);
  assert.equal(cloud.text(p.id, rel), null, "a real local deletion still reaches Cloud");
});

test("PE-585: full sharing snapshots retain skipped Cloud copies and fence concurrent edits", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Skip while sharing"), rel = "files/installer.dmg";
  a.write(p, rel, "original Cloud copy");
  await a.call("POST", `/projects/${p.id}/share`, {});
  const large = oversizeFile(p, rel);
  a.write(p, "notes/now.md", "eligible update");
  await a.share.push(p);
  assert.equal(cloud.text(p.id, rel), "original Cloud copy");
  assert.equal(cloud.text(p.id, "notes/now.md"), "eligible update");
  const request = a.connector.cloudRequest.bind(a.connector);
  let race = true;
  a.connector.cloudRequest = async (url, options) => {
    if (race && options?.method === "PUT") { race = false; cloud.edit(p.id, rel, "concurrent Cloud copy"); }
    return request(url, options);
  };
  await assert.rejects(a.share.push(p), error => error.code === "line_project_changed");
  assert.equal(cloud.text(p.id, rel), "concurrent Cloud copy");
  assert.equal(fs.statSync(large).size, 237 * 1048576);
  await a.share.push(p);
  const missingHash = cloud.projects.get(p.id).files.find(f => f.path === rel).sha256;
  cloud.blobs.delete(missingHash);
  await assert.rejects(a.share.push(p), error => error.code === "line_project_missing_files");
  assert.equal(cloud.blobs.has(missingHash), false, "never uploads local oversize bytes as the retained remote blob");
  const before = cloud.projects.get(p.id).rev;
  a.connector.cloudRequest = async (url, options) => !options?.method ? { project:{ key:p.id } } : request(url, options);
  await assert.rejects(a.share.push(p), error => error.code === "cloud_cannot_sync");
  assert.equal(cloud.projects.get(p.id).rev, before, "an incomplete manifest cannot authorize a replacement snapshot");
});

test("PE-585: Cloud Line deletion cannot delete a skipped local attachment", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Skip within Line");
  a.write(p, "lines/keep.md", topic("Keep", [["2026-11-17 09:00", "Keep the installer."]]));
  a.write(p, "files/keep/installer.dmg", "small copy");
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  const large = oversizeFile(p, "files/keep/installer.dmg"), remote = cloud.projects.get(p.id);
  remote.files = remote.files.filter(f => f.path !== "topics/keep.md" && !f.path.startsWith("files/keep/")); remote.rev++;
  await a.sync(p);
  assert.equal(fs.statSync(large).size, 237 * 1048576);
  assert.equal(a.service.store.isDeleted(p, "keep"), false);
});

// PE-581. Owner: "we should only include Lines/Lines related files. if the file will never be viewed by any active(not archived or
// deleted) Lines, it should not be synced" — "also for memory and topic files".
test("PE-581: only current Lines, their Works, what they show or link, and the knowledge go to Cloud", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { cloudScope:true }), p = a.project("Scoped");
  a.write(p, "lines/plan.md", `${topic("Plan", [["2026-11-17 09:00", "Make a plan."]])}\n## [x] Work 1 · @fake\n\nSee ![chart](../files/plan/chart.png) and [the report](../files/plan/report.md).\n`);
  a.write(p, "works/plan/work-1.md", "---\nstep: Work 1\n---\n\n## Result\n\nDone.\n");
  a.write(p, "files/plan/chart.png", "png");
  a.write(p, "files/plan/report.md", "# Report\n\n![figure](figure.png)\n");
  a.write(p, "files/plan/figure.png", "figure");
  for (let i = 0; i < 20; i++) a.write(p, `files/plan/runs/run-${i}.json`, "{}");   // scratch output no Line shows
  a.write(p, "lines/old.md", topic("Old", [["2026-11-15 09:00", "Done long ago."]]).replace("status: done", "status: closed"));
  a.write(p, "works/old/work-1.md", "old work\n");
  a.write(p, "files/old/a.txt", "old file\n");
  assert.equal(a.service.store.placeLine(p, "old", true), true);
  a.write(p, "topics/plan-page.md", "# Plan page\n");
  a.write(p, "understanding.md", "# Understanding\n");
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true, syncDays:"all" })).status, 200);
  await a.sync(p);
  const inCloud = cloud.projects.get(p.id).files.map(f => f.path).sort();
  for (const rel of ["MEMORY.md", "topics/plan.md", "topics/plan/work-1.md", "files/plan/chart.png", "files/plan/report.md", "files/plan/figure.png"]) assert.ok(inCloud.includes(rel), `${rel} is in Cloud`);
  assert.ok(inCloud.includes(".knowledge/topics/plan-page.md"), "the knowledge Topics go too, under .knowledge/");
  assert.ok(inCloud.includes(".knowledge/understanding.md"), "understanding.md goes too");
  assert.deepEqual(inCloud.filter(rel => /runs\/|old/.test(rel)), [], "scratch output and the archived Line stay on this computer");
  assert.equal(a.read(p, "files/plan/runs/run-3.json"), "{}", "and stay here as they are");
  // Another computer gets the knowledge back under its own names.
  const b = await computer(cloud, { cloudScope:true }), q = await copyOn(b, p.id);
  await b.sync(q);
  assert.equal(b.read(q, "topics/plan-page.md"), "# Plan page\n");
  assert.equal(b.read(q, "understanding.md"), "# Understanding\n");
  assert.equal(fs.existsSync(path.join(q.docsPath, "files/plan/runs/run-3.json")), false, "what stayed on the first computer is not on the second");
});

test("PE-581: files no current Line uses any more leave Cloud only, however many, and Cloud's copy never comes down", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { cloudScope:true }), p = a.project("Grown");
  const runs = Array.from({ length:30 }, (_, i) => `files/keep/runs/run-${i}.txt`);
  const line = links => `${topic("Keep", [["2026-11-17 09:00", "Keep it."]])}\nSee [notes](../files/keep/notes.txt).\n${links.map(rel => `[${rel}](../${rel})`).join("\n")}\n`;
  a.write(p, "lines/keep.md", line(runs));
  a.write(p, "files/keep/notes.txt", "notes\n");
  for (const [i, rel] of runs.entries()) a.write(p, rel, `run ${i}\n`);
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true, syncDays:"all" })).status, 200);
  await a.sync(p);
  assert.equal(cloud.projects.get(p.id).files.filter(f => f.path.includes("/runs/")).length, 30, "linked, so in Cloud");
  // The Line stops linking them, and Cloud's copy of one changed meanwhile.
  a.write(p, "lines/keep.md", line([]));
  cloud.edit(p.id, "files/keep/runs/run-0.txt", "changed in Cloud\n");
  const did = await a.sync(p);
  const inCloud = cloud.projects.get(p.id).files.map(f => f.path);
  assert.deepEqual(inCloud.filter(rel => rel.includes("/runs/")), [], "all 30 left Cloud, past the guard for files gone missing here");
  assert.ok(inCloud.includes("files/keep/notes.txt") && inCloud.includes("topics/keep.md"));
  assert.equal(did.restored || 0, 0);
  assert.equal(a.read(p, "files/keep/runs/run-0.txt"), "run 0\n", "this computer's copy is untouched, Cloud's never came down");
  assert.equal(a.read(p, "files/keep/runs/run-29.txt"), "run 29\n");
  await a.sync(p);
  assert.deepEqual(cloud.projects.get(p.id).files.map(f => f.path).filter(rel => rel.includes("/runs/")), [], "later rounds leave them out");
});

test("PE-581: an archived Work a current Line links still goes to Cloud", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { cloudScope:true }), p = a.project("Linked archive");
  a.write(p, "lines/old.md", topic("Old", []).replace("status: done", "status: closed"));
  a.write(p, "works/old/work-1.md", "---\nstep: Work 1\n---\n\n## Result\n\nFinished.\n");
  a.write(p, "works/old/work-2.md", "not linked\n");
  a.write(p, "lines/current.md", `${topic("Current", [])}\n## [x] Work 1 · @fake\n\n[Details](../archive/works/old/work-1.md)\n`);
  assert.equal(a.service.store.placeLine(p, "old", true), true);
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  await a.sync(p);
  const inCloud = cloud.projects.get(p.id).files.map(f => f.path);
  assert.ok(inCloud.includes("topics/old/work-1.md"), "the linked Work");
  assert.ok(!inCloud.includes("topics/old/work-2.md") && !inCloud.includes("topics/old.md"), "not the rest of the archived Line");
});

// PE-581. Owner: "if sync error, user should know. but not every sync error notify user, which would be very very annoying".
test("PE-581: a dropped connection says nothing; a sync the person must fix is told at once, once, and a good round clears it", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { retryMs:[5], maxFiles:40 }), p = a.project("Told");
  const noticeOf = async () => (await a.call("GET", "/projects")).projects.find(x => x.id === p.id).cloudNotice || null;
  a.write(p, "files/notes/first.txt", "first\n");
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  assert.equal(await noticeOf(), null);
  // The project grows past the limit between rounds: the person has to act, so the round each minute tells it straight away.
  for (let i = 0; i < 60; i++) a.write(p, `files/notes/n${i}.txt`, `note ${i}\n`);
  await a.share.tick();
  const told = await noticeOf();
  assert.match(told?.message || "", /PenEcho Cloud holds up to 40 files/);
  // The same trouble keeps the same notice, so the page tells it once.
  await a.share.tick();
  assert.equal((await noticeOf())?.id, told.id);
  // Back under the limit: a good round clears it.
  for (let i = 0; i < 60; i++) fs.rmSync(path.join(p.docsPath, `files/notes/n${i}.txt`));
  await a.share.tick();
  assert.equal(await noticeOf(), null);
  // A Cloud that answers 503 for a while: tried again each minute, and nothing is told until it has lasted 15 minutes.
  a.write(p, "files/notes/late.txt", "late\n");
  cloud.blobFail = () => 503;
  await a.share.tick();
  assert.equal(await noticeOf(), null, "a brief failure is not told");
  assert.match((await a.call("GET", `/projects/${p.id}/cloud`)).error, /connection to PenEcho Cloud dropped/, "the Cloud panel still says what happened");
  await a.share.tick();
  assert.match(a.share.noticeFor(p, Date.now() + 16 * 60_000)?.message || "", /could not be reached for a while/, "lasting 15 minutes, it is told");
  cloud.blobFail = () => 0;
  await a.share.tick();
  assert.equal((await a.call("GET", `/projects/${p.id}/cloud`)).error, "");
});

test("PE-611: a successful sync records when it synced, clears when turned off or removed, and ignores failed or stale rounds", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { retryMs:[5] }), p = a.project("Recent");
  const syncedAtOf = async () => (await a.call("GET", "/projects")).projects.find(x => x.id === p.id).cloudSyncedAt || 0;
  a.write(p, "files/notes/first.txt", "first\n");
  assert.equal(await syncedAtOf(), 0);
  const before = Date.now();
  const kept = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  assert.equal(kept.status, 200);
  assert.ok(kept.syncedAt >= before, "cloud status includes syncedAt");
  const first = await syncedAtOf();
  assert.ok(first >= before, "project summary includes cloudSyncedAt after syncing");

  // A failed round or a stale round never moves syncedAt forward.
  await wait(15);
  cloud.down = true;
  await a.share.tick();
  assert.equal(await syncedAtOf(), first);
  cloud.down = false;
  cloud.staleOnce = true;
  a.write(p, "files/notes/second.txt", "second\n");
  await a.share.tick();
  assert.equal(await syncedAtOf(), first);

  // A clean round (including a no-op check) moves syncedAt forward.
  await wait(15);
  await a.share.tick();
  const second = await syncedAtOf();
  assert.ok(second > first);
  await wait(15);
  await a.share.tick();
  const third = await syncedAtOf();
  assert.ok(third > second);

  // Turning sync off clears cloudSyncedAt.
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:false });
  assert.equal(await syncedAtOf(), 0);

  // A project removed in Cloud also drops cloudSyncedAt.
  await a.call("POST", `/projects/${p.id}/cloud`, { sync:true });
  assert.ok((await syncedAtOf()) > 0);
  cloud.projects.delete(p.id);
  await a.sync(p);
  assert.equal(await syncedAtOf(), 0);
});

test("PE-1114: GET /cloud/projects preserves cloudMade and archived flags and never marks Cloud-only projects as local", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud), p = a.project("Local");
  a.write(p, "notes/a.md", "Local note.\n");
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  cloud.projects.set("cloud-only-1", { key:"cloud-only-1", name:"Cloud Project", files:[], rev:1, updatedAt:Date.now(), cloudMade:true });
  cloud.projects.set("cloud-only-archived", { key:"cloud-only-archived", name:"Old Cloud Project", files:[], rev:1, updatedAt:Date.now(), cloudMade:true, archived:true });
  cloud.projects.set("my-canvases", { key:"my-canvases", name:"My Canvases", files:[], rev:1, updatedAt:Date.now(), system:"my-canvases" });

  const listed = await a.call("GET", "/cloud/projects");
  assert.equal(listed.status, 200);
  const byKey = new Map(listed.projects.map(item => [item.key, item]));
  assert.equal(byKey.has("my-canvases"), false, "system projects stay excluded");
  assert.equal(byKey.get(p.id)?.here, true);
  assert.equal(byKey.get(p.id)?.cloudMade, undefined);
  assert.deepEqual(
    { key:byKey.get("cloud-only-1")?.key, name:byKey.get("cloud-only-1")?.name, here:byKey.get("cloud-only-1")?.here, cloudMade:byKey.get("cloud-only-1")?.cloudMade, archived:byKey.get("cloud-only-1")?.archived },
    { key:"cloud-only-1", name:"Cloud Project", here:false, cloudMade:true, archived:undefined }
  );
  assert.deepEqual(
    { key:byKey.get("cloud-only-archived")?.key, here:byKey.get("cloud-only-archived")?.here, cloudMade:byKey.get("cloud-only-archived")?.cloudMade, archived:byKey.get("cloud-only-archived")?.archived },
    { key:"cloud-only-archived", here:false, cloudMade:true, archived:true }
  );
});

test("PE-1094: a brand-new Cloud Line colliding with a local archived Line slug is rehomed instead of unshared or overwriting archive", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { cloudScope:true }), p = a.project("Collision");
  const archivedMd = "---\nid: T-1\nstatus: closed\narchived at: 2026-01-01T00:00:00.000Z\n---\n\n# Test\n\n<!-- status: PenEcho keeps this current -->\n> [!status] Closed\n<!-- /status -->\n\n## Ask · 2026-11-15 04:34\n\nold archived test\n";
  a.write(p, "lines/test.md", archivedMd);
  assert.equal(a.service.store.placeLine(p, "test", true), true);
  a.write(p, "lines/active.md", topic("Active", [["2026-11-24 09:00", "Keep working."]]));
  assert.equal((await a.call("POST", `/projects/${p.id}/cloud`, { sync:true })).status, 200);
  await a.sync(p);
  assert.ok(!cloud.projects.get(p.id).files.some(f => f.path === "topics/test.md"), "archived Line stayed local");

  // Cloud creates a brand-new Line at topics/test.md with an attachment at files/test/shot.png.
  const cloudNewMd = "---\nid: CO-9\nstatus: waiting\nwhy: Not sent\ncreated: 2026-11-24 14:24\n---\n\n# Test\n\n## Ask · 2026-11-24 14:24 · Not sent\n\ntest\n\n![shot.png](../files/test/shot.png)\n";
  cloud.edit(p.id, "topics/test.md", cloudNewMd);
  cloud.edit(p.id, "files/test/shot.png", "PNGDATA");

  await a.sync(p);

  // Local archive/lines/test.md is untouched, and the new Cloud Line lives at lines/test-2.md + files/test-2/shot.png on both sides.
  assert.equal(fs.readFileSync(path.join(p.docsPath, "archive/lines/test.md"), "utf8"), archivedMd, "archived Line untouched");
  assert.equal(fs.existsSync(path.join(p.docsPath, "lines/test-2.md")), true, "new Cloud Line rehomed to free local slug");
  assert.match(fs.readFileSync(path.join(p.docsPath, "lines/test-2.md"), "utf8"), /\.\.\/files\/test-2\/shot\.png/, "attachment link updated");
  assert.equal(fs.readFileSync(path.join(p.docsPath, "files/test-2/shot.png"), "utf8"), "PNGDATA");

  const inCloud = cloud.projects.get(p.id).files.map(f => f.path).sort();
  assert.ok(inCloud.includes("topics/test-2.md") && inCloud.includes("files/test-2/shot.png"), "rehomed Line synced back to Cloud");
  assert.ok(!inCloud.includes("topics/test.md") && !inCloud.includes("files/test/shot.png"), "colliding Cloud paths cleaned up");
});
