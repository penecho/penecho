"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { find, wordsOf } = require("../src/server/project-lines/find.js");
const F = require("../src/server/project-lines/format.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-find-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const s = new Service({ directory, agents, autoWatch:false });
  const p = s.store.create({ name:"Find", docsPath:path.join(root, "docs") });
  p.follow = false; s.store.save();
  const line = (slug, title, status, steps) => s.writeDoc(p, slug, F.initialLine({ title, status, steps }));
  const detail = (slug, n, result, started = "2026-11-07 09:00") => s.store.writeText(p, `topics/${slug}/work-${n}.md`, F.setResult(F.initialDetail({ slug, title:slug, label:`Work ${n}`, who:"claude", started, now:"" }), result));
  const work = (who, body) => F.workStep({ who, done:true, took:"5 min", body });
  line("colours", "Status colours", "done", [
    F.askStep({ words:"Running must not be red. Please arrange these colours, especially for status.", when:"2026-11-06 13:10" }),
    work("claude", "Running is teal now."),
    F.askStep({ words:"<in-app-browser-context>secret wrapper words</in-app-browser-context>\n把分支的颜色改成灰色", when:"2026-11-06 14:00" }),
    work("codex", "Done."),
  ]);
  detail("colours", 1, "Running is **teal** now, and red is kept for what failed or stopped.", "2026-11-06 13:12");
  detail("colours", 2, "分支现在是深灰色。", "2026-11-06 14:02");
  line("merge", "How will this merge take place", "closed", [F.askStep({ words:"how will this merge take place?", when:"2026-11-07 04:40" }), work("claude", "It merges the whole branch.")]);
  detail("merge", 1, "Merge into main merges the whole branch into your local main.", "2026-11-07 04:41");
  line("gone", "A deleted line", "done", [F.askStep({ words:"words that must stay hidden once deleted", when:"2026-11-05 10:00" })]);
  s.activity.add(p, "colours", { kind:"say", text:"Checking the hover colour on the map before I change anything.", step:"work-1" });
  s.activity.add(p, "colours", { kind:"tool", verb:"Ran", target:"grep hover", step:"work-1" });
  s.sync(p);
  t.after(() => { s.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { s, p, root, line, work, detail, look:(q, options = {}) => find(s.store, s.activity, p, q, { state:s.stateOf(p), ...options }) };
}
const hits = r => r.lines.flatMap(l => l.hits.map(h => ({ ...h, slug:l.slug })));

test("finds your Asks, a Work's whole result, and what an agent said on the way", t => {
  const { look } = setup(t);
  const ask = hits(look("red")).find(h => h.kind === "ask");
  assert.ok(ask, "an Ask");
  assert.equal(ask.slug, "colours"); assert.equal(ask.step, "ask-1"); assert.equal(ask.who, "you"); assert.equal(ask.when, "2026-11-06 13:10");
  const result = hits(look("failed or stopped"));
  assert.equal(result.length, 1, "only in Work 1's result, which the Topic file does not hold");
  assert.deepEqual([result[0].kind, result[0].step, result[0].label, result[0].who, result[0].when, result[0].said], ["work", "work-1", "Work 1", "claude", "2026-11-06 13:12", false]);
  assert.doesNotMatch(result[0].snippet, /\*\*/, "Markdown marks are not shown");
  const spoken = hits(look("hover"));
  assert.equal(spoken.length, 1, "a tool's command is not something said");
  assert.deepEqual([spoken[0].step, spoken[0].said], ["work-1", true]);
  assert.match(spoken[0].snippet, /hover colour on the map/);
});

test("counts what is yours and what is the agents', line by line", t => {
  const { look } = setup(t);
  const r = look("merge");
  assert.equal(r.yours, 1); assert.equal(r.work, 1); assert.equal(r.total, 2); assert.equal(r.lineCount, 1);
  assert.equal(r.lines[0].slug, "merge");
  assert.equal(r.lines[0].count, 2);
});

test("a few words are found together, and a sentence leaves out words like what and did", t => {
  const { look } = setup(t);
  assert.equal(look("teal red").total, 1, "only Work 1's result has both");
  assert.equal(look("teal purple").total, 0);
  assert.deepEqual(wordsOf("What did I decide about merging?"), ["decide", "merging"]);
  assert.deepEqual(wordsOf("Why is it RED?"), ["red"]);
  assert.deepEqual(wordsOf("  "), []);
  assert.equal(look("").total, 0);
});

test("Chinese is found as it is written, and what apps wrap around a message is not searched", t => {
  const { look } = setup(t);
  const zh = hits(look("分支"));
  assert.deepEqual(zh.map(h => h.step).sort(), ["ask-2", "work-2"]);
  assert.equal(look("secret wrapper").total, 0);
  assert.doesNotMatch(zh.find(h => h.kind === "ask").snippet, /in-app-browser-context|secret/);
});

test("archived lines are found, and deleted ones are not", async t => {
  const { s, p, look } = setup(t);
  assert.ok(hits(look("merge")).every(h => h.slug === "merge"), "the archived line is there");
  assert.ok(hits(look("hidden")).some(h => h.slug === "gone"));
  await s.act(p, "gone", "delete", { confirm:"gone", baseHash:s.store.readText(p, "topics/gone.md").hash });
  assert.equal(look("hidden").total, 0);
});

test("a changed result is read again, and an unchanged one is not", t => {
  const { look, detail } = setup(t);
  assert.equal(look("violet").total, 0);
  detail("colours", 1, "Unread is violet now.", "2026-11-06 13:12");
  assert.equal(look("violet").total, 1);
  assert.equal(look("failed or stopped").total, 0, "the old words are gone");
});

test("the newest comes first when two match as well", t => {
  const { look } = setup(t);
  const r = look("the");
  const whens = r.lines.map(l => l.hits[0].when);
  assert.deepEqual(whens, [...whens].sort().reverse());
});

test("status counts are unique matching lines, while tabs and statuses intersect before truncation", t => {
  const { s, p, line, work, look } = setup(t);
  const ask = via => F.askStep({ words:"Filterneedle in your Ask", via, when:"2026-11-08 09:00" });
  line("run", "Running", "working", [ask(), F.workStep({ who:"claude", done:false, body:"" })]);
  line("stop", "Stopped", "stopped", [ask(), F.workStep({ who:"claude", done:false, body:"" })]);
  line("review", "Review", "ready", [ask(), work("claude", "Filterneedle in the result")]);
  line("todo", "Uncertain work", "done", [ask(), work("claude", "Filterneedle pending result")]);
  s.writeDoc(p, "todo", F.setFront(s.readDoc(p, "todo"), { todo:"yes" }));
  line("wait", "Waiting", "waiting", [ask(), F.workStep({ who:"claude", done:false, body:"" })]);
  line("send", "To send", "notes", [ask(F.NOT_SENT), ask(F.NOT_SENT)]);
  line("mixed", "Running with another Ask", "working", [ask(), F.workStep({ who:"claude", done:false, body:"" }), ask(F.NOT_SENT)]);
  line("archive", "Archived", "closed", [ask(), work("claude", "Filterneedle archived result")]);
  s.sync(p);
  const all = look("filterneedle");
  assert.deepEqual(all.statusCounts, { all:8, working:2, stopped:1, you:1, todo:1, review:1, send:2 });
  assert.equal(all.filterVersion, 1);
  const you = look("filterneedle", { status:"you" });
  assert.deepEqual(you.lines.map(g => g.slug), ["wait"]);
  assert.deepEqual(you.statusCounts, all.statusCounts, "chips ignore the selected status");
  assert.deepEqual([you.total, you.yours, you.work], [1, 1, 0]);
  const review = look("filterneedle", { status:"review" });
  assert.deepEqual(review.lines.map(g => g.slug), ["review"]);
  assert.deepEqual(review.statusCounts, all.statusCounts, "chips ignore the selected status");
  assert.deepEqual([review.total, review.yours, review.work], [2, 1, 1]);
  const works = look("filterneedle", { tab:"work", status:"review" });
  assert.deepEqual(works.lines.map(g => g.slug), ["review"]);
  assert.deepEqual(works.statusCounts, { all:3, working:0, stopped:0, you:0, todo:1, review:1, send:0 });
  assert.deepEqual([works.total, works.yours, works.work], [2, 1, 1], "tab badges describe the selected status");
  assert.ok(look("filterneedle", { status:"send" }).lines.every(g => ["send", "mixed"].includes(g.slug)));
  assert.ok(all.lines.some(g => g.slug === "archive"), "unfiltered searches include the archive");
  assert.deepEqual(look("filterneedle", { tab:"invalid", status:"__proto__" }).lines, all.lines);
  assert.deepEqual(look("filterneedle", { status:"todo" }).lines.map(g => g.slug), ["todo"]);
  assert.equal(look("filterneedle", { tab:"work", status:"todo" }).lines[0].hits[0].kind, "work");
});

test("a status below the first sixty lines and a content kind below the first twelve hits are found", t => {
  const { s, p, line, work, look } = setup(t);
  for (let i = 0; i < 65; i++) line(`cap-${i}`, `Cap ${i}`, "notes", [F.askStep({ words:"Capneedle", when:"2026-11-09 09:00" })]);
  line("cap-stopped", "Older stopped line", "stopped", [F.askStep({ words:"Capneedle", when:"2026-11-01 09:00" }), F.workStep({ who:"claude", done:false, body:"" })]);
  const steps = Array.from({ length:13 }, () => F.askStep({ words:"Kindneedle", when:"2026-11-09 09:00" }));
  line("kind-capped", "Many matching Asks", "ready", [...steps, work("claude", "Kindneedle old result")]);
  s.sync(p);
  const all = look("capneedle");
  assert.equal(all.lineCount, 66); assert.equal(all.lines.length, 60);
  assert.equal(all.statusCounts.stopped, 1);
  assert.ok(!all.lines.some(g => g.slug === "cap-stopped"));
  assert.deepEqual(look("capneedle", { status:"stopped" }).lines.map(g => g.slug), ["cap-stopped"]);
  const kinds = look("kindneedle");
  assert.equal(kinds.lines[0].count, 14); assert.equal(kinds.lines[0].hits.length, 12);
  assert.ok(kinds.lines[0].hits.every(h => h.kind === "ask"));
  const onlyWork = look("kindneedle", { tab:"work" });
  assert.equal(onlyWork.lineCount, 1); assert.equal(onlyWork.lines[0].count, 1);
  assert.equal(onlyWork.lines[0].hits[0].kind, "work");
});

test("the shared you, review and send rules keep questions apart from review and respect archive, commits and overlap", () => {
  const status = require("../public/lines/line-status.js");
  const review = { status:"ready", stations:[{ kind:"work", state:"done", reviewed:false }], questions:[] };
  assert.equal(status.matches(review, "review"), true);
  assert.equal(status.matches(review, "you"), false);
  assert.equal(status.matches({ ...review, commit:"abc" }, "review"), true, "committed work still waits for your review");
  assert.equal(status.matches({ ...review, commit:"abc", todo:true }, "todo"), false, "but it is not kept as Todo");
  assert.equal(status.matches({ ...review, closed:true }, "review"), false);
  assert.equal(status.matches({ ...review, archived:true }, "review"), false);
  assert.equal(status.matches({ ...review, stations:[{ kind:"work", state:"done" }] }, "review"), false, "old servers do not offer review");
  assert.equal(status.matches({ ...review, status:"notes", questions:[{ text:"Which?" }] }, "you"), true);
  assert.equal(status.matches({ ...review, status:"working", asking:{ kind:"question" } }, "you"), true);
  assert.equal(status.matches({ ...review, status:"waiting" }, "you"), true);
  assert.equal(status.matches({ ...review, asking:{ kind:"reply" } }, "review"), false, "needing your answer comes before To review");
  assert.equal(status.shownState({ ...review, asking:{ kind:"reply" } }), "wait");
  const mixed = { ...review, status:"stopped", stations:[{ kind:"ask", unsent:true }] };
  assert.equal(status.matches(mixed, "stopped"), true); assert.equal(status.matches(mixed, "send"), true);
  assert.equal(status.matches(null, "all"), true); assert.equal(status.matches(null, "working"), false);
});

test("GET Find passes both filters and current line state without invoking write authorization", async t => {
  const { createProjectLines } = require("../src/server/project-lines/http.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-find-route-"));
  const api = createProjectLines({ directory:path.join(root, "state"), agents,
    serviceOptions:{ autoWatch:false, memory:{ home:path.join(root, "home"), env:{} } },
    authorizeRead:() => null, authorizeWrite:() => { throw Error("Search must stay a read"); },
    readJson:async () => ({}), send:(res, status, body) => Object.assign(res, { status, body }) });
  t.after(() => { api.service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  const s = api.service, p = s.store.create({ name:"Route", docsPath:path.join(root, "docs") });
  p.follow = false; s.store.save();
  s.writeDoc(p, "draft", F.initialLine({ title:"Draft", status:"notes", steps:[F.askStep({ words:"Invoice", via:F.NOT_SENT })] }));
  const response = {};
  await api.handle({ method:"GET" }, response, new URL(`http://localhost/api/lines/projects/${p.id}/find?q=invoice&tab=yours&status=send`));
  assert.equal(response.status, 200);
  assert.deepEqual([response.body.tab, response.body.status, response.body.lineCount, response.body.statusCounts.send], ["yours", "send", 1, 1]);
});

test("Find searches Line and orchestrator job IDs (PE-xxx), ranks exact ID matches first, and combines ID with keywords", async t => {
  const { s, p, work, look } = setup(t);
  const lineWithFront = (slug, title, status, steps, front) => s.writeDoc(p, slug, F.setFront(F.initialLine({ title, status, steps }), front));
  lineWithFront("job-775", "Fix waiting orchestrator premature exit", "done", [
    F.askStep({ words:"The sub worker finished, and the orchestrator seems dead.", when:"2026-11-20 04:15" }),
    work("antigravity", "Investigated the premature exit in watchdog monitoring."),
  ], { id:"PE-775", orchestrator:"yes" });
  lineWithFront("sub-779", "Check watchdog transcript task detection", "ready", [
    F.askStep({ words:"Review run-watch transcript boundaries.", when:"2026-11-20 04:35" }),
    work("codex", "Found long transcript truncation."),
  ], { id:"PE-779", "orchestrated by":"PE-775" });
  lineWithFront("mentions-775", "Other watchdog follow-up", "done", [
    F.askStep({ words:"Follow up on PE-775 findings.", when:"2026-11-20 06:00" }),
    work("claude", "Referenced PE-775 in the fix."),
  ], { id:"PE-794" });
  lineWithFront("solo-790", "Open Settings page by default", "closed", [
    F.askStep({ words:"Default Settings to the Agents tab.", when:"2026-11-20 05:10" }),
  ], { id:"PE-790" });
  s.sync(p);
  await s.act(p, "job-775", "review-all", {});
  await s.act(p, "mentions-775", "review-all", {});

  // Searching an ID never mentioned in prose still finds the Line (including archived Lines).
  const bySolo = look("pe-790");
  assert.equal(bySolo.lineCount, 1);
  assert.equal(bySolo.lines[0].slug, "solo-790");
  assert.equal(bySolo.lines[0].code, "PE-790");
  assert.match(bySolo.lines[0].hits[0].snippet, /PE-790/);

  // Exact job ID ranks first, its spawned sub-Line ranks second, and prose mentions follow.
  const byJob = look("pe-775");
  assert.deepEqual(byJob.lines.map(l => l.slug), ["job-775", "sub-779", "mentions-775"]);
  assert.equal(byJob.lines[0].code, "PE-775");
  assert.equal(byJob.lines[1].code, "PE-779");
  assert.equal(byJob.lines[1].orchestratedBy, "PE-775");
  assert.match(byJob.lines[1].hits[0].snippet, /PE-779 · from PE-775/);

  // Uppercase, numeric-only, and status-filtered searches work with job IDs.
  assert.deepEqual(look("PE-775", { status:"review" }).lines.map(l => l.slug), ["sub-779"]);
  assert.ok(look("775").lines.some(l => l.slug === "job-775"));

  // Multi-word query combining a job ID with a keyword matches steps on that Line.
  const combined = look("pe-775 watchdog");
  assert.ok(combined.lines.some(l => l.slug === "job-775"));
  assert.ok(combined.lines.some(l => l.slug === "sub-779"));
  assert.ok(!combined.lines.some(l => l.slug === "solo-790"));
});
