"use strict";
require("./helpers/safety.js");
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const STATUS = require("../public/lines/line-status.js");
const turn = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const listeners = {}, requests = [], storage = new Map(), body = { dataset:{}, innerHTML:"", contains:() => false };
  const p = { id:"p", lines:[{ id:"draft", title:"Draft invoice", status:"notes", stations:[{ id:"ask-1", kind:"ask", text:"invoice", unsent:true }], questions:[] }], landed:[], backlog:[] };
  const context = vm.createContext({
    LINE_STATUS:STATUS, ACT:{}, HOSTED:false, MOD_ENTER:"Ctrl ↵", AbortController, wordsMd:x => x, S:{ route:{ view:"find" } }, URLSearchParams, setTimeout, clearTimeout, queueMicrotask,
    document:{ activeElement:null, addEventListener(type, fn) { listeners[type] = fn; } },
    localStorage:{ getItem:k => (storage.has(k) ? storage.get(k) : null), setItem(k, v) { storage.set(k, String(v)); } },
    $:selector => selector === "#findBody" ? body : null, $$:() => [], project:() => p,
    pathFor:id => `/projects/${id}`, allLines:p => [...p.lines, ...p.landed, ...p.backlog],
    lineById:(p, id) => p.lines.find(l => l.id === id), shownState:STATUS.shownState, lineReviewed:STATUS.lineReviewed,
    STATE_TEXT:{ notes:"Notes", ready:"Finished", landed:"Finished", reviewed:"Reviewed", archived:"Archived", review:"To review" }, ic:name => `<i>${name}</i>`, av:() => "", stepLabel:() => "Ask",
    esc:value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])),
    askOnly:x => x, plainOut:x => x, syncHash() {}, toast() {},
    api:(url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/find.js"), "utf8"), context);
  const run = code => vm.runInContext(code, context);
  run("FIND.q = 'invoice'");
  const data = (tab = "all", status = "all", extra = {}) => ({ q:"invoice", filterVersion:1, tab, status,
    words:["invoice"], total:1, yours:1, work:0, lineCount:1,
    statusCounts:{ all:1, working:0, stopped:0, you:0, todo:0, review:0, send:1 },
    lines:[{ slug:"draft", title:"Draft invoice", count:1, hits:[{ kind:"ask", step:"ask-1", snippet:"invoice", score:1 }] }], ...extra });
  return { p, body, run, requests, data, context, listeners, storage };
}

test("Find renders six visible status controls including Todo, combines a tab and status, and keeps zero-result recovery visible", async () => {
  const h = harness(), first = h.run("runFind()");
  h.requests[0].resolve(h.data()); await first;
  assert.match(h.body.innerHTML, /1 to send/);
  assert.equal((h.body.innerHTML.match(/data-act="find-status" data-status="(?:working|stopped|you|todo|review|send)"/g) || []).length, 6);
  assert.ok(h.body.innerHTML.indexOf('data-status="you"') < h.body.innerHTML.indexOf('data-status="review"'));
  h.run("ACT['find-status']({dataset:{status:'send'}})");
  assert.match(h.requests[1].url, /tab=all&status=send/);
  h.requests[1].resolve(h.data("all", "send")); await turn();
  h.run("ACT['find-tab']({dataset:{tab:'work'}})");
  assert.match(h.requests[2].url, /tab=work&status=send/);
  h.requests[2].resolve(h.data("work", "send", { lines:[], lineCount:0 })); await turn();
  assert.match(h.body.innerHTML, /No matching lines with this status/);
  assert.match(h.body.innerHTML, /Clear status/); assert.match(h.body.innerHTML, /Show all statuses/);
  h.run("ACT['find-status']({dataset:{status:'send'}})");
  assert.equal(h.run("FIND.status"), "all");
  h.requests[3].resolve(h.data("work")); await turn();
});

test("late responses cannot replace newer filters, and changing the query resets both dimensions", async () => {
  const h = harness(), older = h.run("runFind()");
  h.run("FIND.status = 'send'"); const newer = h.run("runFind()");
  h.requests[1].resolve(h.data("all", "send")); await newer;
  h.requests[0].resolve(h.data()); await older;
  assert.equal(h.run("FIND.data.status"), "send");
  h.run("FIND.tab = 'work'; findTyped('new invoice'); clearTimeout(FIND.timer)");
  assert.equal(h.run("FIND.tab"), "all"); assert.equal(h.run("FIND.status"), "all");
  assert.match(h.body.innerHTML, /Searching/);
  h.run("findTyped('')"); assert.equal(h.body.innerHTML, "");
});

test("Find shows Reviewed, Finished or Archived rather than a Git merge status", () => {
  const { context } = harness();
  const work = { kind:"work", state:"off", off:"stopped", reviewed:true };
  for (const status of ["ready", "done", "landed"]) {
    const line = { status, branch:"main", commit:"abc123", stations:[work] };
    assert.match(context.findState(line), />Reviewed</);
    assert.match(context.findState({ ...line, stations:[] }), />Finished</);
    assert.match(context.findState({ ...line, archived:true }), />Archived</);
  }
});

test("an older capped response qualifies available results and hides incomplete status counts", async () => {
  const h = harness(), pending = h.run("runFind()");
  const legacy = h.data(); delete legacy.filterVersion; legacy.lineCount = 61;
  h.requests[0].resolve(legacy); await pending;
  assert.match(h.body.innerHTML, /Showing part of the results/);
  assert.match(h.body.innerHTML, /Available: 1 line/);
  assert.doesNotMatch(h.body.innerHTML, /0 working|1 to send/);
  h.run("ACT['find-status']({dataset:{status:'working'}})");
  h.requests[1].resolve(legacy); await turn();
  assert.match(h.body.innerHTML, /No matches in the available results/);
  assert.doesNotMatch(h.body.innerHTML, /Nothing found/);
});

test("live refresh preserves settled results until the new response and skips an unchanged redraw", async () => {
  const h = harness(), first = h.run("runFind()");
  h.requests[0].resolve(h.data()); await first;
  const before = h.body.innerHTML;
  const quiet = h.run("runFind(project(), true)");
  assert.equal(h.body.innerHTML, before);
  h.requests[1].resolve(h.data()); await quiet;
  assert.equal(h.body.innerHTML, before);
});

test("a state change during a foreground search is refreshed after that response", async () => {
  const h = harness(), first = h.run("runFind()");
  await h.run("runFind(project(), true)");
  assert.equal(h.requests.length, 1, "the pending foreground request is left alone");
  h.requests[0].resolve(h.data()); await first;
  assert.equal(h.requests.length, 2, "the newer project state still gets searched");
  h.requests[1].resolve(h.data("all", "all", { lineCount:0, lines:[] })); await turn();
  assert.match(h.body.innerHTML, /Nothing found/);
});

test("typing and Enter only request matches; explicit Ask sends one question to the selected preset", async () => {
  const h = harness();
  h.context.S.presets = { presets:[
    { id:"first", name:"First", available:true, answers:true },
    { id:"chosen", name:"Chosen", available:true, answers:true },
  ], default:"chosen" };
  h.listeners.input({ target:{ id:"findInput", value:"draft" } });
  h.listeners.keydown({ target:{ id:"findInput", value:"draft" }, key:"Enter", preventDefault() {} });
  assert.deepEqual(h.requests.map(r => r.url.split("?")[0]), ["/projects/p/find"]);
  h.requests[0].resolve(h.data()); await turn();

  h.listeners.input({ target:{ id:"findInput", value:"invoice" } });
  const answer = h.run("ACT['find-ask']()");
  assert.equal(h.requests[1].url, "/projects/p/ask");
  assert.equal(h.requests[1].options.method, "POST");
  assert.deepEqual({ ...h.requests[1].options.body }, { question:"invoice", preset:"chosen" });
  h.requests[1].resolve({ id:"saved", answer:"Read [PE-1].", lines:[{ ref:"PE-1", slug:"draft", title:"Draft invoice", cited:true }] });
  await answer;
  assert.match(h.run("answerHTML(project())"), /class="fa-ref" data-act="find-open" data-line="draft"/);
  await new Promise(resolve => setTimeout(resolve, h.run("FIND_WAIT") + 15));
  assert.equal(h.requests[2].url.split("?")[0], "/projects/p/find", "Ask leaves the new query's pending matches intact");
  h.requests[2].resolve(h.data()); await turn();
  assert.equal(h.requests.length, 3);
});

for (const modifier of ["metaKey", "ctrlKey"]) {
  test(`${modifier} + Enter asks the selected agent once and preserves pending text matches`, async () => {
    const h = harness();
    h.context.S.presets = { presets:[
      { id:"first", available:true, answers:true }, { id:"chosen", available:true, answers:true },
    ], default:"chosen" };
    assert.match(h.run("askControlHTML()"), /aria-keyshortcuts="Meta\+Enter Control\+Enter"/);
    const target = { id:"findInput", value:"draft" };
    const enter = { key:"Enter", [modifier]:true, target, preventDefault() {} };
    h.listeners.input({ target });
    h.listeners.keydown({ ...enter, isComposing:true });
    h.listeners.keydown({ ...enter, keyCode:229 });
    h.listeners.keydown({ ...enter, target:{ id:"findAgent" } });
    assert.equal(h.requests.length, 0);

    h.listeners.keydown(enter);
    h.listeners.keydown({ ...enter, repeat:true });
    assert.deepEqual(h.requests.map(r => r.url), ["/projects/p/ask"]);
    assert.deepEqual({ ...h.requests[0].options.body }, { question:"draft", preset:"chosen" });
    h.requests[0].resolve({ answer:"Draft found" });
    await new Promise(resolve => setTimeout(resolve, h.run("FIND_WAIT") + 15));
    assert.equal(h.requests.length, 2);
    assert.match(h.requests[1].url, /\/find\?q=draft/);
    h.requests[1].resolve(h.data()); await turn();

    h.listeners.input({ target:{ ...target, value:" " } });
    h.listeners.keydown({ ...enter, target:{ ...target, value:" " } });
    assert.equal(h.requests.length, 2);
  });
}

test("opening Search with no preset can reopen and delete a saved answer without asking again", async () => {
  const h = harness(), saved = { id:"saved", name:"Former agent", question:"invoice", answer:"Saved text", lines:[] };
  const page = h.run("findHTML(project(), { view:'find' })");
  assert.match(page, /enterkeyhint="search"/);
  assert.doesNotMatch(page, /data-act="find-ask"/);
  assert.equal(h.run("FIND.q"), "");
  await turn();
  assert.deepEqual(h.requests.map(r => r.url), ["/projects/p/asks"]);
  h.requests[0].resolve({ asks:[saved] }); await turn();
  assert.match(h.body.innerHTML, /Saved answers/);
  h.run("ACT['find-asked']({dataset:{ id:'saved' }})");
  h.requests[1].resolve(h.data()); await turn();
  const html = h.run("answerHTML(project())");
  assert.match(html, /Saved text/);
  assert.doesNotMatch(html, /Ask again/);
  assert.match(html, /Delete this answer/);
  const deleting = h.run("ACT['find-asked-delete']({dataset:{ id:'saved' }})");
  assert.equal(h.requests[2].options.method, "DELETE");
  h.requests[2].resolve({ asks:[] }); await deleting;
  assert.equal(h.run("answerHTML(project())"), "");
  assert.equal(h.requests.some(r => r.options?.method === "POST"), false);
});

test("a hosted search link loads its matches without local history or an agent", async () => {
  const h = harness();
  h.context.HOSTED = { read:true };
  h.context.S.presets = { presets:[{ id:"local", available:true, answers:true }] };
  const html = h.run("findHTML(project(), {view:'find', q:'invoice'})");
  assert.match(html, /value="invoice"/); assert.doesNotMatch(html, /data-act="find-ask"/);
  await turn();
  assert.deepEqual(h.requests.map(r => r.url.split("?")[0]), ["/projects/p/find"]);
  h.requests[0].resolve(h.data()); await turn();
  assert.match(h.body.innerHTML, /Draft invoice/);
  h.listeners.keydown({ target:{ id:"findInput", value:"invoice" }, key:"Enter", ctrlKey:true, preventDefault() {} });
  assert.deepEqual(h.requests.map(r => r.url.split("?")[0]), ["/projects/p/find", "/projects/p/find"]);
  h.requests[1].resolve(h.data()); await turn();
});

test("Find displays highlighted Line IDs in headers and client-side findHere matches job IDs", async () => {
  const h = harness();
  h.p.lines = [
    { id:"job-775", code:"PE-775", title:"Fix waiting orchestrator", status:"done", stations:[{ id:"ask-1", kind:"ask", text:"The sub worker finished" }], questions:[] },
    { id:"sub-779", code:"PE-779", orchestratedBy:"PE-775", title:"Check watchdog parser", status:"ready", stations:[{ id:"ask-1", kind:"ask", text:"Review parser" }], questions:[] },
    { id:"other-794", code:"PE-794", title:"Other follow-up", status:"done", stations:[{ id:"ask-1", kind:"ask", text:"Mentions PE-775 in prose" }], questions:[] },
  ];
  const local = h.run("findHere(project(), 'pe-775')");
  assert.deepEqual(Array.from(local.lines, g => g.slug), ["job-775", "sub-779", "other-794"]);
  assert.equal(local.lines[0].code, "PE-775");
  assert.match(local.lines[1].hits[0].snippet, /PE-779 · from PE-775/);

  h.run("FIND.q = 'pe-775'");
  const pending = h.run("runFind()");
  h.requests[0].resolve({ ...local, q:"pe-775", filterVersion:1, tab:"all", status:"all", statusCounts:{ all:3, working:0, stopped:0, you:0, todo:0, review:1, send:0 } });
  await pending;
  assert.match(h.body.innerHTML, /<code class="fl-code"><mark>PE-775<\/mark><\/code>/);
  assert.match(h.body.innerHTML, /<code class="fl-code">PE-779<\/code>/);
});

test("Find renders each result Line title as a clickable button that opens the Line", async () => {
  const h = harness();
  const opened = [];
  h.context.stationById = (line, id) => (line?.stations || []).find(s => s.id === id);
  h.context.go = (route, opts) => opened.push({ route, opts });

  const pending = h.run("runFind()");
  h.requests[0].resolve(h.data());
  await pending;

  assert.match(
    h.body.innerHTML,
    /<button type="button" class="fl-title" data-act="find-open" data-line="draft" title="Draft invoice">Draft invoice<\/button>/,
  );
  assert.doesNotMatch(h.body.innerHTML, /<header>.*<strong>Draft invoice<\/strong>/);

  const titleEl = { dataset:{ act:"find-open", line:"draft" } };
  h.context.ACT["find-open"](titleEl);
  assert.deepEqual({ ...opened[0].route }, { view:"line", line:"draft", step:undefined });
  assert.equal(opened[0].opts.from, titleEl);

  const hitEl = { dataset:{ act:"find-open", line:"draft", step:"ask-1" } };
  h.context.ACT["find-open"](hitEl);
  assert.deepEqual({ ...opened[1].route }, { view:"line", line:"draft", step:"ask-1" });
  assert.equal(opened[1].opts.from, hitEl);
});

test("Recent searches can be deleted one by one without affecting other projects", async () => {
  const h = harness();
  h.storage.set("penecho-find-recent-v1", JSON.stringify({
    p: ["leaderboard", 'canvas "design" & <ui>'],
    other: ["keep-me"],
  }));
  h.run("findTyped('')");
  assert.match(h.body.innerHTML, /Recent searches/);
  assert.match(h.body.innerHTML, /data-act="find-recent-delete" data-q="leaderboard"/);
  assert.match(h.body.innerHTML, /data-act="find-recent-delete" data-q="canvas &quot;design&quot; &amp; &lt;ui&gt;"/);

  h.context.ACT["find-recent-delete"]({ dataset:{ q:"leaderboard" } });
  assert.doesNotMatch(h.body.innerHTML, /data-q="leaderboard"/);
  assert.match(h.body.innerHTML, /Recent searches/);
  assert.deepEqual(JSON.parse(h.storage.get("penecho-find-recent-v1")), {
    p: ['canvas "design" & <ui>'],
    other: ["keep-me"],
  });

  h.context.ACT["find-recent-delete"]({ dataset:{ q:'canvas "design" & <ui>' } });
  assert.doesNotMatch(h.body.innerHTML, /Recent searches/);
  assert.deepEqual(JSON.parse(h.storage.get("penecho-find-recent-v1")), { other: ["keep-me"] });
});

test("Deleting a saved answer also clears it from recent searches and re-enables on error", async () => {
  const h = harness();
  const saved = { id:"ans-1", name:"Agent", question:"how does split work?", answer:"It routes tasks.", lines:[] };
  h.storage.set("penecho-find-recent-v1", JSON.stringify({ p: ["how does split work?", "rating"] }));
  h.run("findHTML(project(), { view:'find' })");
  await turn();
  h.requests[0].resolve({ asks:[saved] }); await turn();
  assert.match(h.body.innerHTML, /data-act="find-asked-delete" data-id="ans-1"/);
  assert.match(h.body.innerHTML, /data-act="find-recent-delete" data-q="rating"/);
  assert.doesNotMatch(h.body.innerHTML, /data-act="find-recent-delete" data-q="how does split work\?"/);

  const failingBtn = { dataset:{ id:"ans-1" }, disabled:false };
  const failed = h.context.ACT["find-asked-delete"](failingBtn);
  assert.equal(failingBtn.disabled, true);
  h.requests[1].reject(new Error("boom"));
  await failed;
  assert.equal(failingBtn.disabled, false);
  assert.deepEqual(JSON.parse(h.storage.get("penecho-find-recent-v1")).p, ["how does split work?", "rating"]);

  const btn = { dataset:{ id:"ans-1" }, disabled:false };
  const deleting = h.context.ACT["find-asked-delete"](btn);
  assert.equal(btn.disabled, true);
  h.requests[2].resolve({ asks:[] });
  await deleting;
  assert.doesNotMatch(h.body.innerHTML, /Saved answers/);
  assert.doesNotMatch(h.body.innerHTML, /how does split work\?/);
  assert.match(h.body.innerHTML, /data-act="find-recent-delete" data-q="rating"/);
  assert.deepEqual(JSON.parse(h.storage.get("penecho-find-recent-v1")).p, ["rating"]);
});
