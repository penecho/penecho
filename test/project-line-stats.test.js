"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");
const { computeProjectStats, statsHTML, STATS_STATE } = require("../public/lines/stats.js");

const agents = { available:() => [], desktop:() => null, terminal:() => "" };
const work = (extra = {}) => ({ ...F.workStep({ who:"codex", done:true, took:"45s", body:"Implemented cleanly." }), ...extra });

function setupService(t, steps = [F.askStep({ words:"Please build stats" }), work()]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-stats-")), directory = path.join(root, "state");
  fs.mkdirSync(directory);
  const service = new Service({ directory, agents, autoWatch:false });
  const project = service.store.create({ name:"StatsProj", docsPath:path.join(root, "docs") });
  project.follow = false;
  service.store.save();
  service.writeDoc(project, "one", F.initialLine({ title:"One", status:"done", steps }));
  service.store.writeText(project, "topics/one/work-1.md", F.initialDetail({ slug:"one", title:"One", label:"Work 1", who:"codex", started:"2026-11-10 10:00", now:"" }));
  service.sync(project);
  const line = () => service.stateOf(project).lines.find(l => l.id === "one");
  const station = id => line().stations.find(s => s.id === id);
  const detail = (id = "work-1") => service.store.readText(project, `topics/one/${id}.md`).text;
  t.after(() => { service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  return { directory, service, project, line, station, detail };
}

test("rating a Work good/bad with a note persists in detail frontmatter without touching Topic timestamps or unread state", async t => {
  const { directory, service:s, project:p, line, station, detail } = setupService(t);
  const topic = s.readDoc(p, "one"), before = line(), initialDetail = detail(), rev = s.stateOf(p).rev;
  assert.equal(station("work-1").rating, undefined);

  await s.act(p, "one", "rate", { step:"work-1", rating:"good", note:"Clear API\n  and fast tests" });
  assert.equal(s.readDoc(p, "one"), topic);
  const front = F.splitFront(detail()).front;
  assert.equal(front.rating, "good");
  assert.equal(front["rating note"], "Clear API and fast tests");
  assert.match(front["rated at"], /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(station("work-1").rating, "good");
  assert.equal(station("work-1").ratingNote, "Clear API and fast tests");
  assert.equal(line().readRevision, before.readRevision);
  assert.equal(line().updatedAt, before.updatedAt);
  assert.notEqual(s.stateOf(p).rev, rev);

  // Switch rating to bad with updated note
  await s.act(p, "one", "rate", { step:"work-1", rating:"bad", note:"Missed edge case" });
  assert.equal(station("work-1").rating, "bad");
  assert.equal(station("work-1").ratingNote, "Missed edge case");

  // Persists across a fresh Service restart
  const restarted = new Service({ directory, agents, autoWatch:false });
  t.after(() => restarted.close());
  const st2 = restarted.stateOf(restarted.store.projects[0]).lines.find(l => l.id === "one").stations.find(x => x.id === "work-1");
  assert.equal(st2.rating, "bad");
  assert.equal(st2.ratingNote, "Missed edge case");

  // Clearing rating restores detail file cleanly
  await s.act(p, "one", "rate", { step:"work-1", rating:null });
  assert.equal(station("work-1").rating, undefined);
  assert.equal(station("work-1").ratingNote, undefined);
  assert.equal(detail(), initialDetail);
  assert.equal(s.readDoc(p, "one"), topic);
});

test("rating validation rejects invalid rating values and unfinished works", async t => {
  const unfinished = work({ done:false, took:"" });
  const { service:s, project:p } = setupService(t, [F.askStep({ words:"Run" }), unfinished]);

  await assert.rejects(() => s.act(p, "one", "rate", { step:"work-1", rating:"good" }), err => err.code === "NOT_FINISHED");
  await s.act(p, "one", "stop", {});
  await assert.rejects(() => s.act(p, "one", "rate", { step:"work-1", rating:"meh" }), err => err.code === "BAD_RATING");
});

// Shaped as the server sends them: startedAt/endedAt in ms, status words, title, tokens with cache reads inside input.
const at = (now, h) => now - h * 3600e3;
function fixture(now) {
  const work = (id, agent, state, h, extra = {}) => ({ id, kind:"work", label:`Work ${id.slice(2)}`, agent, state, startedAt:at(now, h), ...(state === "active" || state === "wait" ? {} : { endedAt:at(now, h) + 60e3 }), ...extra });
  return {
    id:"p1", name:"Core",
    lines:[
      { id:"auth", slug:"auth", title:"Auth refactor", status:"working", lastActivityAt:at(now, 1), stations:[
        { id:"ask-1", kind:"ask", state:"done" },
        work("w-1", "claude", "done", 3, { picked:{ model:"claude-opus-5-5" }, tokens:{ inputTokens:1000, outputTokens:20, cacheReadInputTokens:900, startup:{ status:"compared", cost:{ fresh:{ tokensIn:100, cost:1 }, resumed:{ tokensIn:400, cost:4 } } } }, diff:{ add:45, del:12 }, rating:"good", ratingNote:"Clean diff", ratedAt:"2026-11-14 17:00" }),
        work("w-2", "codex", "off", 2.5, { off:"stopped", stopWhy:"limit", picked:{ model:"gpt-5.5" }, tokens:{ inputTokens:500, outputTokens:50, cacheReadInputTokens:0 }, rating:"bad", ratingNote:"Stopped at the limit" }),
        work("w-3", "claude", "done", 2, { carriedFrom:{ agent:"codex", why:"limit" }, picked:{ model:"claude-opus-5-5" } }),
        work("w-4", "codex", "active", 0.2),
      ] },
      { id:"ask", slug:"ask", title:"Question line", status:"waiting", asking:{ kind:"question" }, lastActivityAt:at(now, 2), stations:[work("w-5", "claude", "wait", 2)] },
      { id:"broke", slug:"broke", title:"Broken run", status:"stopped", lastActivityAt:at(now, 4), stations:[work("w-6", "codex", "error", 4, { stopWhy:"error", endedAt:undefined })] },
      { id:"notes", slug:"notes", title:"Just notes", status:"notes", lastActivityAt:at(now, 5), stations:[{ id:"n-1", kind:"note", state:"done" }] },
      { id:"queued", slug:"queued", title:"Queued one", status:"not-started", lastActivityAt:at(now, 6), stations:[] },
    ],
    landed:[
      { id:"old", slug:"old", title:"Old merged", status:"landed", archived:true, landed:true, lastActivityAt:at(now, 24 * 45), stations:[work("w-7", "claude", "done", 24 * 45, { rating:"good" })] },
      { id:"arch", slug:"arch", title:"Archived only", status:"closed", archived:true, lastActivityAt:at(now, 3), stations:[work("w-8", "codex", "off", 3, { off:"discarded" })] },
    ],
    backlog:[],
  };
}

test("computeProjectStats counts Works by their own times, every Line state once, and agents within the filter", () => {
  const now = new Date(2026, 10, 14, 18, 0).getTime(), p = fixture(now);
  const st = computeProjectStats(p, { period:"30d", agent:"all", now });
  // w-7 ended 45 days ago: outside 30 days, although nothing else dates it.
  assert.deepEqual(st.works.map(w => w.stepId).sort(), ["w-1", "w-2", "w-3", "w-4", "w-5", "w-6", "w-8"]);
  assert.equal(st.totals.done, 2);
  assert.equal(st.totals.ended, 5);
  assert.equal(st.totals.finishedPct, 40);
  assert.equal(st.totals.rated, 2);
  assert.equal(st.totals.goodPct, 50);
  // New input plus output; cache reads apart. 100 + 20 and 500 + 50.
  assert.equal(st.totals.tokens, 670);
  assert.equal(st.totals.cache, 900);
  assert.equal(st.totals.saved.costPercent, 75);
  assert.equal(st.totals.add, 45);

  const kinds = Object.fromEntries(st.breakdown.map(x => [x.kind, x.count]));
  assert.deepEqual(kinds, { working:1, waiting:1, queued:1, notes:1, stopped:1, archived:1 });
  assert.equal(st.breakdown.reduce((n, x) => n + x.count, 0), st.lines.length);
  assert.ok(!("merged" in kinds), "archiving is not merging");
  assert.equal(st.lines.find(l => l.id === "auth").title, "Auth refactor");

  const statuses = st.now.map(x => `${x.lineId}:${x.status}`).sort();
  assert.deepEqual(statuses, ["ask:waiting", "auth:working", "broke:failed"]);

  const claude = st.agents.find(a => a.id === "claude"), codex = st.agents.find(a => a.id === "codex");
  assert.equal(claude.rescued, 1);
  assert.equal(codex.handedOff, 1);
  assert.equal(codex.fails.limit, 1);
  assert.equal(codex.fails.error, 1);
  assert.equal(codex.fails.discarded, 1);
  assert.equal(codex.working, true);
  assert.equal(st.best, "", "nobody is Best with fewer than five rated Works each");

  // Only finished or stopped Works can be rated, as the server allows.
  assert.equal(st.works.find(w => w.stepId === "w-6").canRate, false);
  assert.deepEqual(st.toRate.map(w => w.stepId).sort(), ["w-3", "w-8"]);

  const all = computeProjectStats(p, { period:"all", agent:"all", now });
  assert.equal(all.breakdown.find(x => x.kind === "archived").count, 2);
  assert.equal(all.lines.find(line => line.id === "old").kind, "archived");
  assert.ok(!all.breakdown.some(x => x.kind === "merged" || x.label === "Merged"));
  const legacy = computeProjectStats({ ...p, landed:p.landed.map(line => line.id === "old" ? { ...line, archived:false } : line) }, { period:"all", agent:"all", now });
  assert.equal(legacy.lines.find(line => line.id === "old").kind, "done");
  assert.equal(legacy.breakdown.find(x => x.kind === "done").label, "Finished");
  assert.ok(!legacy.breakdown.some(x => x.kind === "merged" || x.label === "Merged"));

  const today = computeProjectStats(p, { period:"today", agent:"all", now });
  assert.ok(!today.works.some(w => w.stepId === "w-7"));
  assert.equal(today.days.length, 1);

  // An agent filter narrows every section, not only the Works.
  const cx = computeProjectStats(p, { period:"30d", agent:"codex", now });
  assert.ok(cx.works.every(w => w.agent === "codex"));
  assert.deepEqual(cx.agents.map(a => a.id), ["codex"]);
  assert.ok(cx.models.every(m => m.agent === "codex"));
  assert.ok(cx.now.every(x => x.agent === "codex"));
  assert.equal(cx.totals.tokens, 550);
  // Hand-offs still count the other agent that finished codex's Work.
  assert.equal(cx.agents[0].handedOff, 1);
});

test("Statistics shows all unrated Works on request and never NaN", () => {
  const now = Date.now(), p = { id:"p", name:"P", landed:[], backlog:[], lines:[{ id:"l", slug:"l", title:"Many", status:"done", lastActivityAt:now, stations:Array.from({ length:12 }, (_, i) => ({ id:`w-${i + 1}`, kind:"work", label:`Work ${i + 1}`, agent:"claude", state:"done", startedAt:now - (i + 1) * 60e3, endedAt:now - i * 60e3 })) }] };
  Object.assign(STATS_STATE, { period:"30d", agent:"all", rateAll:false, day:"" });
  let html = statsHTML(p);
  assert.ok(!/NaN|undefined/.test(html));
  assert.equal((html.match(/data-act="work-rate"[^>]*data-rating="good"/g) || []).length, 7);
  assert.match(html, /Show all 12/);
  STATS_STATE.rateAll = true;
  html = statsHTML(p);
  assert.equal((html.match(/class="sx-rq"/g) || []).length, 12);
  STATS_STATE.rateAll = false;
});

test("statsHTML escapes untrusted line, model and project text cleanly", () => {
  Object.assign(STATS_STATE, { period:"all", agent:"all", day:"" });
  const html = statsHTML({
    id:"p1", name:"<img src=x onerror=alert(1)>", landed:[], backlog:[],
    lines:[{ id:"l1", slug:"l1", title:"<script>alert(1)</script>", status:"done", stations:[
      { id:"w1", kind:"work", label:"Work 1", agent:"claude", state:"done", startedAt:Date.now() - 60e3, endedAt:Date.now(), picked:{ model:"gateway/provider/<img onerror=x>" }, orchScore:4, orchNote:"<img onerror=y>good & fast" },
    ] }],
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<img onerror=x>"));
  assert.ok(!html.includes("<img onerror=y>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img onerror=x&gt;"));
  assert.ok(!html.includes("gateway/provider/"));
});

test('estimated cost follows the period and agent, with exact rates and explicit coverage', () => {
  const now = new Date(2026, 10, 14, 18).getTime(), p = fixture(now);
  const prices = [{ model:'CLAUDE-OPUS-5-5', input:2, output:8, cached:.5, cacheWrite:4 }, { model:'gpt-5', input:1, output:2 }];
  const steps = p.lines[0].stations; steps[1].tokens.cacheWriteInputTokens = 50;
  steps[3].tokens = { inputTokens:200, outputTokens:null };
  p.landed[0].stations[0].selected = { model:'claude-opus-5-5' }; p.landed[0].stations[0].tokens = { inputTokens:1e6, outputTokens:0 };
  const stats = (period, agent) => computeProjectStats(p, { now, period, agent, prices });
  const recent = stats('30d', 'all');
  assert.equal(recent.totals.estimatedCost, (50*2 + 900*.5 + 50*4 + 20*8)/1e6);
  assert.equal(recent.totals.priced, 1); assert.equal(recent.totals.works, 7);
  assert.equal(recent.models.find(row => row.model === 'claude-opus-5-5').estimatedCost, recent.totals.estimatedCost);
  assert.equal(stats('30d', 'codex').totals.estimatedCost, null);
  assert.equal(stats('all', 'all').totals.estimatedCost, 2 + recent.totals.estimatedCost);
  prices.push({ model:'gpt-5.5', input:0, output:0 }); assert.equal(stats('30d', 'codex').totals.estimatedCost, 0);
  const { statsInnerHTML } = require('../public/lines/stats.js');
  const html = statsInnerHTML(p, { now, period:'30d', prices });
  assert.match(html, /Est\. cost \(USD\)/); assert.match(html, /2 of 7 Works priced/); assert.match(html, /\$0\.0009/);
});

test("Statistics renders one unified Agents section and omits redundant sections", () => {
  const vm = require("node:vm"), { parseHTML } = require("./helpers/dom.js");
  const p = fixture(new Date(2026, 10, 14, 18, 0).getTime());
  const ctx = vm.createContext({ p });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/work-pricing.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/stats.js"), "utf8"), ctx);
  vm.runInContext("STATS_STATE.period = 'all'; STATS_STATE.agent = 'all';", ctx);
  const render = () => parseHTML(vm.runInContext("statsHTML(p)", ctx)).document;

  // Standalone / hosted mode: 5 KPIs, exactly one Agents section, no Models/Now/Lines/Why clutter.
  const hosted = render();
  assert.ok(hosted.querySelector("#statsBody"));
  assert.equal(hosted.querySelector("#statsRecord, #statsPrices"), null);
  assert.equal(hosted.querySelectorAll(".sx-sum > div").length, 5);
  assert.equal(hosted.querySelectorAll(".sx-agents").length, 1);
  assert.equal(hosted.querySelector(".sx-models, .sx-now, .sx-lines, .sx-why-card") === null, true);
  // PE-742: Works by day and the agents' share are drawn for the project; the Agent index (every project) is only on the local app.
  assert.equal(hosted.querySelectorAll(".sx-daily .sx-day").length > 0, true);
  assert.equal(hosted.querySelectorAll(".sx-share-list li").length, 2);
  assert.equal(hosted.querySelector(".sx-index") === null, false, "the index card shows while it counts");
  assert.doesNotMatch(hosted.querySelector(".sx-sum").textContent, /Finished/);

  // Local mode with #statsRecord: #statsBody omits its fallback Agents table so only #statsRecord renders Agents.
  ctx.statsRecordHTML = proj => `<div id="statsRecord"><section class="sx-card sx-agents">Record for ${proj.id}</section></div>`;
  ctx.statsPricesHTML = proj => `<div id="statsPrices">Prices for ${proj.id}</div>`;
  const doc = render();
  assert.equal(doc.querySelector("#statsBody .sx-agents"), null);
  assert.equal(doc.querySelectorAll(".sx-agents").length, 1);
  assert.equal(doc.querySelector("#statsBody ~ #statsRecord").textContent, "Record for p1");
  assert.equal(doc.querySelector("#statsBody ~ #statsRate ~ #statsPrices").textContent, "Prices for p1");

  // Agent index table renders ratings-only scores without a Follow-ups column or follow-up copy.
  ctx.STATS_INDEX.key = "0";
  ctx.STATS_INDEX.at = Date.now();
  ctx.STATS_INDEX.data = {
    projects:2, thresholds:{ works:3, rated:1 },
    tables:{
      all:{
        ranked:[{ rank:1, agent:"codex", agentName:"Codex", model:"gpt-6.2-sol", provider:"OpenAI", effort:"max", score:87.5, low:60.2, high:96.8, rating:4.5, rated:5, minutes:10.3, costPerWork:1.13, works:5 }],
        collecting:[],
      },
    },
  };
  const indexed = render();
  const headers = [...indexed.querySelectorAll(".sx-ix-table th")].map(th => th.textContent.trim());
  assert.deepEqual(headers, ["Rank", "Model · Agent · Effort", "Score", "Cost / Work", "Time / Work", "Rating", "Works"]);
  assert.doesNotMatch(indexed.querySelector(".sx-index").textContent, /follow-?up/i);
  assert.doesNotMatch(indexed.querySelector(".sx-index").textContent, /NaN|undefined/);
});

test("Statistics shows an interactive example page when no ratings can be shown, and exits once ratings arrive", () => {
  const vm = require("node:vm"), { parseHTML } = require("./helpers/dom.js");
  const now = new Date(2026, 10, 20, 12, 0).getTime();
  const emptyProject = { id:"empty-proj", name:"Fresh project", lines:[], landed:[], backlog:[] };
  const unratedProject = {
    id:"unrated-proj", name:"Unrated project", landed:[], backlog:[],
    lines:[{ id:"l1", slug:"l1", title:"Landing polish", status:"done", lastActivityAt:now, stations:[
      { id:"w-1", kind:"work", label:"Work 1", agent:"claude", state:"done", startedAt:now - 120e3, endedAt:now - 60e3 },
      { id:"w-2", kind:"work", label:"Work 2", agent:"codex", state:"done", startedAt:now - 90e3, endedAt:now - 30e3 },
    ] }],
  };
  const ctx = vm.createContext({ ACT:{}, p:emptyProject });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/work-pricing.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/lines/stats.js"), "utf8"), ctx);
  ctx.statsRecordHTML = proj => `<div id="statsRecord"><section class="sx-card sx-agents">Record for ${proj.id}</section></div>`;
  ctx.statsPricesHTML = proj => `<div id="statsPrices">Prices for ${proj.id}</div>`;
  const render = proj => { ctx.p = proj; return parseHTML(vm.runInContext("statsHTML(p)", ctx)).document; };

  // 1. Completely empty project shows the full example statistics page clearly marked as example.
  const exDoc = render(emptyProject);
  assert.ok(exDoc.querySelector(".sx-page.is-example"), "page is marked as example");
  assert.equal(exDoc.querySelector(".sx-ex-pill").textContent.trim(), "Example");
  const bannerText = exDoc.querySelector(".sx-ex-banner").textContent.replace(/\s+/g, " ");
  assert.match(bannerText, /example/i);
  assert.match(bannerText, /sample data/i);
  assert.match(bannerText, /optional/i);
  assert.match(bannerText, /auto-rate/i);
  assert.match(bannerText, /Orchestrator decisions more and more accurate/i);
  assert.ok(exDoc.querySelector('.sx-ex-banner [data-act="go-view"][data-view="orchestrator"]'), "local example banner links to Orchestrator");
  assert.ok(exDoc.querySelector(".sx-ex-frame"), "example cards live inside a clearly marked preview frame");
  assert.equal(exDoc.querySelectorAll(".sx-ex-frame .sx-sum > div").length, 5);
  assert.ok(exDoc.querySelectorAll(".sx-ex-frame .sx-daily .sx-day").length > 0);
  assert.ok(exDoc.querySelectorAll(".sx-ex-frame .sx-share-list li").length >= 3);
  assert.equal(exDoc.querySelectorAll(".sx-ex-frame .sx-pick").length, 3, "Top rated, Best value, Fastest among the top");
  assert.ok(exDoc.querySelectorAll(".sx-ex-frame .sx-ix-table tr").length >= 6);
  assert.deepEqual([...exDoc.querySelectorAll(".sx-ex-frame .sx-ix-table .sx-pill")].map(el => el.textContent.trim()), ["1", "2", "3", "4", "5", "6"]);
  ctx.STATS_STATE.indexKind = "docs";
  const docsExDoc = render(emptyProject);
  assert.deepEqual([...docsExDoc.querySelectorAll(".sx-ex-frame .sx-ix-table .sx-pill")].map(el => el.textContent.trim()), ["1", "2", "3", "4", "5"]);
  ctx.STATS_STATE.indexKind = "all";
  const kinds = ["Code", "Chat", "Design", "Research", "Docs"];
  assert.deepEqual([...exDoc.querySelectorAll(".sx-ex-frame .sx-heat tr:first-child th")].map(el => el.textContent), ["Model", ...kinds]);
  assert.deepEqual([...exDoc.querySelectorAll('[data-act="stats-index-kind"]')].map(el => el.dataset.kind), ["all", "code", "chat", "design", "research", "docs"]);
  assert.deepEqual([...exDoc.querySelectorAll(".sx-daily .sx-legend > span")].map(el => el.textContent.replace(/\d+$/, "")), ["Claude", "Codex", "Kimi", "Antigravity"]);
  ctx.STATS_STATE.dayBy = "kind";
  assert.deepEqual([...render(emptyProject).querySelectorAll(".sx-daily .sx-legend > span")].map(el => el.textContent.replace(/\d+$/, "")), kinds);
  ctx.STATS_STATE.dayBy = "";
  assert.match(exDoc.querySelector(".sx-ex-frame").textContent, /Chat · Auth token refresh Q&A/);
  ctx.ACT["stats-index-kind"]({ dataset:{ kind:"chat" } });
  const chatDoc = render(emptyProject);
  assert.equal(chatDoc.querySelector('[data-kind="chat"]').getAttribute("aria-selected"), "true");
  assert.ok(chatDoc.querySelector(".sx-ix-table .sx-pill"));
  ctx.STATS_STATE.indexKind = "all";
  assert.ok(exDoc.querySelector(".sx-ex-frame .sx-value"), "example score-against-cost scatter renders");
  assert.doesNotMatch(exDoc.querySelector(".sx-page").textContent, /NaN|undefined/);

  // 2. Project with unrated Works still shows the example page, offers Rate N Works CTA, and keeps real Needs your rating below.
  const unratedDoc = render(unratedProject);
  assert.ok(unratedDoc.querySelector(".sx-page.is-example"));
  assert.match(unratedDoc.querySelector('[data-act="stats-jump-rate"]').textContent, /Rate 2 Works/);
  assert.equal(unratedDoc.querySelectorAll("#statsRate .sx-rq").length, 2);

  // 3. Toggling to current stats shows real stats with the compact notice and View example button; switching project resets it.
  ctx.ACT["stats-example-toggle"]();
  const realPeek = render(unratedProject);
  assert.equal(realPeek.querySelector(".sx-page.is-example"), null);
  assert.ok(realPeek.querySelector(".sx-ex-mini"));
  assert.match(realPeek.querySelector(".sx-ex-mini").textContent, /View example/);
  const switchedDoc = render(emptyProject);
  assert.ok(switchedDoc.querySelector(".sx-page.is-example"), "switching to another unrated project returns to example mode");

  // 4. As soon as a user rating or Orchestrator rating arrives, example mode exits automatically.
  unratedProject.lines[0].stations[0].rating = "good";
  const ratedDoc = render(unratedProject);
  assert.equal(ratedDoc.querySelector(".sx-page.is-example"), null);
  assert.equal(ratedDoc.querySelector(".sx-ex-banner"), null);
  assert.equal(ratedDoc.querySelector(".sx-ex-mini"), null);

  const today = new Date(), day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const daily = [["fix", 2], ["test", 3], ["chat", 1], ["review", 1], ["other", 2], ["unknown", 2]]
    .map(([kind, works]) => ({ day, runner:"claude", kind, works }));
  ctx.ORCH = { project:unratedProject.id, stats:{ daily } };
  // Works by day groups by agent until the person picks Kind of job.
  assert.match(render(unratedProject).querySelector(".sx-daily").textContent, /Works by agent/);
  ctx.STATS_STATE.dayBy = "kind";
  assert.deepEqual([...render(unratedProject).querySelectorAll(".sx-daily .sx-legend > span")].map(el => el.textContent),
    ["Code5", "Chat1"]);
  ctx.STATS_STATE.dayBy = "";
  // When only uncategorized/legacy-other daily rows exist, Works by day falls back to grouping by agent rather than showing 0 Works.
  ctx.ORCH = { project:unratedProject.id, stats:{ daily:[{ day, runner:"claude", kind:"other", works:2 }] } };
  const fallbackDaily = render(unratedProject).querySelector(".sx-daily");
  assert.match(fallbackDaily.textContent, /2 Works by agent/);
  assert.doesNotMatch(fallbackDaily.textContent, /Other/);

  // 5. Computer-wide ranked pairings in Agent index also disable example mode even when the current project has 0 ratings.
  ctx.STATS_INDEX.key = "30";
  ctx.STATS_INDEX.at = Date.now();
  ctx.STATS_INDEX.data = {
    projects:2, thresholds:{ works:3, rated:1 },
    tables:{ all:{ ranked:[{ rank:1, agent:"codex", agentName:"Codex", model:"gpt-5.4", provider:"OpenAI", effort:"high", score:86, low:70, high:94, rating:4.4, rated:4, minutes:5, costPerWork:0.6, works:4 }], collecting:[] } },
  };
  const indexedDoc = render(emptyProject);
  assert.equal(indexedDoc.querySelector(".sx-page.is-example"), null);
  assert.equal(indexedDoc.querySelector(".sx-ex-banner"), null);

  assert.match(indexedDoc.querySelector(".sx-index .sx-link-inline").getAttribute("href"), /^https:\/\/penecho\.ai\/leaderboard$/);
  assert.match(indexedDoc.querySelector(".sx-index .sx-link-inline").textContent, /PenEcho Real-World AI Agent Leaderboard/);

  // 6. Hosted mode with 0 ratings shows the example page without the local-only Orchestrator button and keeps the Leaderboard card.
  ctx.STATS_INDEX.data = null;
  ctx.HOSTED = { key:"k", read:false };
  const hostedEx = render(emptyProject);
  assert.ok(hostedEx.querySelector(".sx-page.is-example"));
  assert.equal(hostedEx.querySelector('[data-view="orchestrator"]'), null);
  assert.ok(hostedEx.querySelector(".sx-ar-card"));
  assert.equal(hostedEx.querySelector(".sx-ar-card .sx-ar-go").getAttribute("href"), "/leaderboard");
  assert.match(hostedEx.querySelector(".sx-ar-card").textContent, /PenEcho Real-World AI Agent Leaderboard/);
  assert.doesNotMatch(hostedEx.querySelector(".sx-ar-card").textContent, /AgentsRatings/);

  // 7. Default example models are up-to-date (no outdated 4-6 / 5.4 / 2.5-pro / k2 / v3 models), and saved user presets replace them dynamically.
  ctx.HOSTED = null;
  const defaultText = render(emptyProject).querySelector(".sx-ex-frame").textContent;
  assert.doesNotMatch(defaultText, /claude-opus-4-6|claude-sonnet-4-6|gpt-5\.4|gemini-2\.5-pro|kimi-k2|deepseek-v3|qwen3-coder/i);
  assert.match(defaultText, /claude-opus-5-5/);
  assert.match(defaultText, /gpt-6\.2-astra/);
  assert.match(defaultText, /gemini-4-neon/);
  assert.match(defaultText, /gpt-6\.2-sol/);
  assert.match(defaultText, /kimi-k3\.1-pro/);
  assert.match(defaultText, /deepseek-v4\.1-flash/);

  ctx.S = {
    presets:{
      presets:[
        { id:"1", agent:"claude", model:"opus", effort:"high" },
        { id:"2", agent:"codex", model:"gpt-6.2-sol", effort:"max" },
        { id:"3", agent:"codex", model:"gpt-6.2-astra", effort:"xhigh" },
        { id:"4", agent:"kimi", model:"magpie/moonshot-cn/kimi-k3.1-pro", effort:"max" },
        { id:"5", agent:"antigravity", model:"gemini-4-hydrogen", effort:"xhigh" },
        { id:"6", agent:"opencode", model:"magpie/opencode-go/deepseek-v4.1-flash", effort:"low" },
        { id:"7", agent:"antigravity", model:"gemini-4-neon", effort:"high" },
        { id:"8", agent:"claude", model:"sonnet", effort:"high" },
        { id:"9", agent:"penecho", model:"penecho-built-in", effort:"max" },
        { id:"10", agent:"opencode", model:"", effort:"max" },
      ],
    },
  };
  const presetDoc = render(emptyProject);
  const presetText = presetDoc.querySelector(".sx-ex-frame").textContent;
  assert.match(presetText, /\bopus\b/);
  assert.match(presetText, /gpt-6\.2-astra/);
  assert.match(presetText, /gpt-6\.2-sol/);
  assert.match(presetText, /gemini-4-hydrogen/);
  assert.match(presetText, /kimi-k3\.1-pro/);
  assert.match(presetText, /deepseek-v4\.1-flash/);
  assert.match(presetText, /gemini-4-neon/);
  assert.match(presetText, /\bsonnet\b/);
  assert.doesNotMatch(presetText, /magpie\//, "gateway prefixes are stripped cleanly");
  assert.doesNotMatch(presetText, /penecho-built-in/i, "built-in penecho preset is excluded");
  assert.equal(presetDoc.querySelectorAll(".sx-ex-frame .sx-pick").length, 3, "still renders all 3 picks with user presets");
});

test("person cannot rate a Review step or a Work with a saved Review assignment", async t => {
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const { directory, service:s, project:p, station, detail } = setupService(t, [
    F.askStep({ words:"Check the implementation" }), work(), work({ kind:"review", label:"Review 1" }),
  ]);
  fs.mkdirSync(path.join(directory, "orchestrator"), { recursive:true });
  fs.writeFileSync(path.join(directory, "orchestrator", "records.json"), JSON.stringify({
    records:[{ id:"legacy", project:p.id, line:"one", work:"work-1", kind:" REVIEW ", score:1 }],
  }));
  s.orchestrator = createOrchestrator({ service:s, directory });
  s.sync(p);
  const review = s.stateOf(p).lines.find(l => l.id === "one").stations.find(w => w.kind === "review");
  assert.ok(review, "the document contains an actual Review step");
  const before = detail();
  for (const step of [review.id, "work-1"]) {
    await assert.rejects(s.act(p, "one", "rate", { step, rating:"good" }), { code:"NOT_RATEABLE" });
  }
  assert.equal(detail(), before);
  const assignedReview = station("work-1");
  assert.equal(assignedReview.isReview, true);
  assert.equal(assignedReview.orchScore, undefined);
});

test("Statistics keeps an orchestrator score's decimal", () => {
  const now = Date.now(), p = fixture(now), rated = p.lines[0].stations.find(s => s.rating === "good");
  rated.orchScore = 4.3;
  const st = computeProjectStats(p, { now, period:"all" });
  assert.equal(st.works.find(w => w.stepId === rated.id).orchScore, 4.3);
  assert.ok(st.agents.some(a => a.score === 4.3 && a.scored === 1), JSON.stringify(st.agents.map(a => [a.score, a.scored])));
});

test("project Statistics retains Review activity while excluding both review forms from ratings", () => {
  const now = Date.now(), p = fixture(now), stations = p.lines[0].stations;
  const [original] = stations.filter(s => s.rating === "good");
  stations.push(
    { ...original, id:"review-1", kind:"review", label:"Review station", rating:"bad", orchScore:1 },
    { ...original, id:"review-2", isReview:true, label:"Legacy review", rating:"good", orchScore:5 },
  );
  const st = computeProjectStats(p, { now, period:"all" });
  const reviews = st.works.filter(w => w.stepId.startsWith("review-"));
  assert.deepEqual(reviews.map(w => [w.canRate, w.rating, w.orchScore]), [[false, "", null], [false, "", null]]);
  assert.ok(reviews.every(w => !st.toRate.includes(w) && w.tokens && w.ended));
  const html = statsHTML(p);
  assert.doesNotMatch(html, /data-step="review-[12]"/);
});
