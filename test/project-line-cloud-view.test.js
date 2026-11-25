require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const zlib = require("node:zlib");
const { Service } = require("../src/server/project-lines/service.js");
const { cloudView, viewFor } = require("../src/server/project-lines/cloud-view.js");
const { createCloudShare } = require("../src/server/project-lines/cloud-share.js");

// penecho.ai's page data for a synced project is made on the computer (owner, 2026-11-18): only what the sync takes, nothing of this computer.
const docs = "/Users/someone/Documents/Garden", code = "/Users/someone/code/garden";
const station = (id, extra = {}) => ({ id, kind:"work", state:"done", text:"Made it.", detail:`works/rain/${id}.md`, ...extra });
const line = (slug, extra = {}) => ({ id:slug, slug, title:slug, topicPath:`lines/${slug}.md`, topicAbsolutePath:`${docs}/lines/${slug}.md`, folder:code, workdir:`${code}/.worktrees/${slug}`,
  conversation:{ agent:"claude" }, conversations:{ claude:{ agent:"claude" } }, activitySeq:9, branch:"main", stations:[station("work-1")], ask:{ text:"Make rain." }, result:{ text:"Done." }, ...extra });
const stateOf = () => ({
  format:2, rev:"r1", project:{ id:"p1", name:"Garden", here:code, git:{ head:"abc" }, vault:{ path:docs, code:[{ path:code }] } },
  deleted:{ lines:[{ slug:"gone" }], nodes:[], canvases:[], files:[], days:7 }, deletionWarnings:[{ slug:"gone" }], conflicts:[{ path:"x" }], branches:{ main:{} },
  tokens:{ records:[] },
  lines:[line("rain", { route:"delegate", routeWhy:"Cheaper local preset ($0.34 vs $2.27).", routeParts:"Task → Claude Code", stations:[station("work-1", { orchScore:4, orchNote:"good", diff:{ add:1 }, now:`Running ${code}/scripts/x.sh`, outputs:[{ path:`${code}/out.html` }, { path:"files/rain/out.png" }] }), station("work-2", { detail:"works/rain/work-2.md" })] }), line("local-only")],
  landed:[line("old", { topicPath:"lines/old.md", stations:[station("work-1", { detail:"works/old/work-1.md" })] })],
  backlog:[],
  files:[{ path:"lines/rain.md" }, { path:"works/rain/work-1.md" }, { path:"files/rain/out.png" }, { path:"files/secret.txt" }],
  notes:[{ path:"notes/idea.md" }, { path:"topics/weather.md" }], pictures:[], artifacts:[], latestFiles:[{ path:"files/secret.txt" }], knowledge:[{ path:"topics/weather.md" }],
});
const keep = new Set(["lines/rain.md", "works/rain/work-1.md", "files/rain/out.png", "lines/old.md", "notes/idea.md", "topics/weather.md"]);

test("the view holds only synced Lines and files, and nothing that is this computer's", () => {
  const view = cloudView(stateOf(), keep, { project:{ docsPath:docs, code }, tokensOf:lines => ({ lines:lines.length }) });
  assert.deepEqual(view.lines.map(l => l.slug), ["rain"], "a Line whose file stays here is left out");
  assert.deepEqual(view.landed.map(l => l.slug), ["old"], "an archived Line Cloud has stays, where it is here");
  assert.deepEqual(view.files.map(f => f.path), ["lines/rain.md", "works/rain/work-1.md", "files/rain/out.png"]);
  assert.deepEqual(view.notes.map(n => n.path), ["notes/idea.md"], "Topics go as knowledge, not notes");
  assert.deepEqual(view.latestFiles, []);
  assert.deepEqual(view.tokens, { lines:2 }, "token counts for these Lines only");
  assert.deepEqual([view.deleted.lines, view.deletionWarnings, view.conflicts, view.branches], [[], [], [], {}]);
  const rain = view.lines[0], [one, two] = rain.stations;
  assert.deepEqual([rain.topicAbsolutePath, rain.folder, rain.workdir, rain.conversation, rain.activitySeq, rain.branch], ["", "", "", null, 0, "main"]);
  assert.equal(one.diff, undefined);
  // The Orchestrator works on penecho.ai for a project on a computer (owner, 2026-11-22): its ratings and its route go.
  assert.deepEqual([one.orchScore, one.orchNote, rain.route, rain.routeParts], [4, "good", "delegate", "Task → Claude Code"]);
  assert.equal(view.orchestrator, undefined, "no Orchestrator Line, nothing asked of the Orchestrator");
  assert.equal(one.now, "Working", "a run's command line names folders on this computer");
  assert.deepEqual(one.outputs, [{ path:"files/rain/out.png" }]);
  assert.equal(one.detail, "works/rain/work-1.md");
  assert.equal(two.detail, "", "a Work file Cloud does not have is not linked");
  assert.equal(view.landed[0].stations[0].detail, "");
  assert.equal(rain.ask.text, "Make rain.");
  const paths = JSON.stringify(view).match(/\/Users\/someone[^"]*/g) || [];
  assert.deepEqual(paths, [], "no path on this computer is sent");
  assert.ok(!JSON.stringify(view).includes(os.homedir() + "/"), "nor anything under this computer's home folder");
  assert.ok(!JSON.stringify(view).includes("local-only") && !JSON.stringify(view).includes("gone"), "unsynced and deleted slug names are not sent in plain text");
  const hashSlug = s => require("node:crypto").createHash("sha256").update(s).digest("hex").slice(0, 12);
  for (const s of ["rain", "local-only", "old", "gone"]) {
    assert.ok(view.takenSlugHashes.includes(hashSlug(s)), `takenSlugHashes covers ${s}`);
  }
});

test("the Orchestrator's sessions go with the view, for the Lines Cloud has", () => {
  const state = stateOf();
  state.lines[0].orchestratorRef = "PE-1";
  let asked = 0;
  const made = () => { asked++; return { kinds:["code", "chat"], sessions:[
    { line:"rain", ref:"PE-1", title:"rain", status:"working", running:true, progress:`Running ${code}/scripts/x.sh`, report:`See ${code}/out.md`, waitingOn:[{ line:"old" }, { line:"kept-here" }],
      lines:[{ line:"old", title:"old", status:"done", works:[{ work:"work-1", score:4, note:"good" }] }, { line:"kept-here", title:"Private", works:[] }] },
    { line:"kept-here", ref:"PE-2", title:"Private", lines:[] },
  ] }; };
  const view = cloudView(state, keep, { project:{ docsPath:docs, code }, orchestrator:made });
  assert.equal(asked, 1);
  assert.deepEqual(view.orchestrator.kinds, ["code", "chat"]);
  assert.deepEqual(view.orchestrator.sessions.map(x => x.line), ["rain"], "a job whose Line stays here is not named");
  const [job] = view.orchestrator.sessions;
  assert.equal(job.progress, undefined, "what a run is at names commands and folders here");
  assert.equal(job.report, `See ${code}/out.md`, "an agent's words go as written");
  assert.deepEqual(job.waitingOn, [{ line:"old" }]);
  assert.deepEqual(job.lines, [{ line:"old", title:"old", status:"done", works:[{ work:"work-1", score:4, note:"good" }] }]);
  assert.equal(cloudView(state, keep, { project:{ docsPath:docs, code }, orchestrator:() => { throw new Error("no"); } }).orchestrator, undefined, "a failed look leaves the view whole");
});

test("the first view goes whole, then only what changed, and nothing when nothing did", () => {
  let state = stateOf();
  const service = Object.create(Service.prototype);
  service.stateOf = () => state;
  service.projectTokens = (_p, lines) => ({ lines:lines.length });
  const holders = new Map(), project = { id:"p1", docsPath:docs, code }, scope = () => keep;
  const first = viewFor(service, project, holders, "", 4, scope);
  assert.ok(first.body.state && first.body.state.tag === first.tag);
  assert.equal(first.body.dbRev, 4);
  state = { ...stateOf(), rev:"r2", lines:[line("rain", { title:"Rain, renamed", stations:[station("work-1")] }), line("local-only")] };
  const next = viewFor(service, project, holders, first.tag, 5, scope);
  assert.equal(next.body.delta.base, first.tag);
  assert.deepEqual(next.body.delta.lists.lines.put.map(l => l.title), ["Rain, renamed"], "only the Line that changed");
  assert.equal(next.body.delta.lists.files, undefined, "files that did not change are not sent");
  const same = viewFor(service, project, holders, next.tag, 6, scope);
  assert.equal(same.same, true);
  assert.deepEqual(same.body, { v:1, dbRev:6, same:true, base:next.tag, tag:same.tag });
  const unknown = viewFor(service, project, holders, "not-a-tag", 7, scope);
  assert.ok(unknown.body.state, "a base Cloud named that is not kept here: whole again");
});

test("views go after sync rounds, at most every interval, whole again after Cloud says it lacks the base", async () => {
  const sent = [];
  let answer = () => ({ ok:true });
  const connector = { status:() => ({ accountSession:{ signedIn:true }, account:{ name:"Owner" } }),
    cloudRequest:async (pathname, options) => { const body = JSON.parse(zlib.gunzipSync(options.bytes)); sent.push({ pathname, method:options.method, body }); const a = answer(body); if (a.error) throw Object.assign(new Error(a.error), { status:a.status }); return a; } };
  let n = 0;
  const share = createCloudShare({ store:{ save() {}, projects:[] }, connector, viewEveryMs:20,
    pageView:(project, base, dbRev) => ({ tag:`t${++n}`, body:base ? { v:1, dbRev, delta:{ base, tag:`t${n}` } } : { v:1, dbRev, state:{ tag:`t${n}` } } }) });
  const project = { id:"p1", name:"Garden", cloud:{ sync:true, key:"garden" } };
  const settle = () => new Promise(resolve => setTimeout(resolve, 60));
  try {
    share.pushViewSoon(project, 3); share.pushViewSoon(project, 4);
    await settle();
    assert.equal(sent.length, 1, "two rounds close together: one view");
    assert.deepEqual([sent[0].pathname, sent[0].method, sent[0].body.dbRev, Boolean(sent[0].body.state)], ["/api/v1/device-sync/line-projects/garden/view", "PUT", 4, true]);
    share.pushViewSoon(project, 5);
    await settle();
    assert.deepEqual([sent[1].body.dbRev, sent[1].body.delta?.base], [5, "t1"], "then only changes");
    answer = () => ({ error:"view_base", status:409 });
    share.pushViewSoon(project, 6);
    await settle();
    answer = () => ({ ok:true });
    await settle();
    assert.ok(sent.at(-1).body.state, "after a 409 the view goes whole");
    share.pushViewSoon({ ...project, cloud:{ sync:false } }, 9);
    await settle();
    assert.equal(sent.at(-1).body.dbRev, 6, "a project that does not sync sends nothing");
  } finally { share.close(); }
});

test("a view Cloud was slow to take is followed by the next one later, in step with how long it took", async () => {
  const sent = [];
  let slow = 300;
  const connector = { status:() => ({ accountSession:{ signedIn:true }, account:{ name:"Owner" } }),
    cloudRequest:async (_pathname, options) => { await new Promise(resolve => setTimeout(resolve, slow)); sent.push(JSON.parse(zlib.gunzipSync(options.bytes))); return { ok:true }; } };
  let n = 0;
  const share = createCloudShare({ store:{ save() {}, projects:[] }, connector, viewEveryMs:10,
    pageView:(project, base, dbRev) => ({ tag:`t${++n}`, body:{ v:1, dbRev, state:{ tag:`t${n}` } } }) });
  const project = { id:"p1", name:"Garden", cloud:{ sync:true, key:"garden" } };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    share.pushViewSoon(project, 1);
    await wait(400);
    assert.equal(sent.length, 1);
    slow = 0;
    share.pushViewSoon(project, 2);
    await wait(600);
    assert.equal(sent.length, 1, "Cloud took 300 ms: the next view waits many times that, not the usual interval");
    await wait(3600);
    assert.equal(sent.length, 2, "and then goes");
    share.pushViewSoon(project, 3);
    await wait(150);
    assert.equal(sent.length, 3, "a view taken at once keeps the usual interval");
  } finally { share.close(); }
});

test("PE-692: idle rounds that Cloud is not sent keep its base, so a later change goes as a delta", () => {
  let state = stateOf();
  const service = Object.create(Service.prototype);
  service.stateOf = () => ({ ...state });
  service.projectTokens = (_p, lines) => ({ lines:lines.length });
  const holders = new Map(), project = { id:"p1", docsPath:docs, code }, scope = () => keep;
  const first = viewFor(service, project, holders, "", 4, scope);
  assert.ok(first.body.state);
  // Cloud took `first`; the next rounds find nothing changed and send nothing, so Cloud still knows only first.tag.
  for (let i = 0; i < 5; i++) assert.equal(viewFor(service, project, holders, first.tag, 4, scope).same, true, `idle round ${i + 1}`);
  state = { ...stateOf(), lines:[line("rain", { title:"Rain, renamed", stations:[station("work-1")] }), line("local-only")] };
  const changed = viewFor(service, project, holders, first.tag, 5, scope);
  assert.equal(changed.body.delta?.base, first.tag, "only the change goes");
});

test("PE-692: a view Cloud refuses for good is not sent again until the project changes; one that passes waits longer each time", async () => {
  const sent = [];
  let answer = () => ({ error:"too_large", status:413 });
  const connector = { status:() => ({ accountSession:{ signedIn:true }, account:{ name:"Owner" } }),
    cloudRequest:async (pathname, options) => { sent.push(options.method); const a = answer(); if (a.error) throw Object.assign(new Error(a.error), { status:a.status }); return a; } };
  let n = 0;
  const share = createCloudShare({ store:{ save() {}, projects:[] }, connector, viewEveryMs:8,
    pageView:(project, base, dbRev) => ({ tag:`t${++n}`, body:{ v:1, dbRev, state:{ tag:`t${n}` } } }) });
  const project = { id:"p1", name:"Garden", cloud:{ sync:true, key:"garden" } };
  const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    share.pushViewSoon(project, 3);
    await settle(100);
    assert.equal(sent.length, 1, "a 413 is sent once");
    share.pushViewSoon(project, 3);
    await settle(50);
    assert.equal(sent.length, 1, "the same project again: still not sent");
    answer = () => ({ ok:true });
    share.pushViewSoon(project, 4);
    await settle(50);
    assert.equal(sent.length, 2, "a change: sent again");
    answer = () => ({ error:"busy", status:503 });
    share.pushViewSoon(project, 5);
    await settle(150);
    assert.ok(sent.length <= 6, `a 503 backs off, sent ${sent.length - 2} times in 150 ms`);
  } finally { share.close(); }
});

test("PE-692: an upload has as long as its size needs over a slow uplink", () => {
  const { uploadTimeout } = require("../src/server/project-lines/cloud-share.js");
  assert.equal(uploadTimeout(0), 120_000, "a small one keeps two minutes");
  const big = 19.4e6, atSixtyKB = big / 60e3 * 1000;
  assert.ok(uploadTimeout(big) > atSixtyKB * 3, "a 19.4 MB file finishes at 60 KB/s even sharing the link with two others");
});
