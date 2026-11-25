"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");

const read = name => fs.readFileSync(path.join(__dirname, "../public/lines", `${name}.js`), "utf8");
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const ic = (name, size = 16) => `<svg class="ic" data-icon="${name}" width="${size}" height="${size}" aria-hidden="true"></svg>`;

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

function createHomeContext({ project, hosted = false, storage = createStorage(), apiImpl = null, now = Date.now() } = {}) {
  const { document, window } = parseHTML("<html><body><div id=\"view\"></div></body></html>");
  const listeners = { storage:[] };
  const S = { cur:project.id, route:{ view:"home" }, data:{ [project.id]:project }, tokenPeriod:"week", topicsNew:{} };
  const choice = {};
  let deskRefreshes = 0;
  const ctx = vm.createContext({
    document, window, console, Math, Number, String, Array, Object, Set, Map, JSON, Promise, RegExp, Intl, Error,
    Date:class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    URL, URLSearchParams, encodeURIComponent,
    CSS:{ escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&") },
    HOSTED:hosted, EMBED:null, ACT:{}, SEND:{}, Pano:{},
    S,
    localStorage:storage,
    addEventListener:(type, fn) => { if (listeners[type]) listeners[type].push(fn); },
    setTimeout:fn => { fn(); return 1; },
    clearTimeout() {},
    requestAnimationFrame() {},
    $:(s, r = document) => r.querySelector(s),
    $$:(s, r = document) => [...r.querySelectorAll(s)],
    esc, ic,
    LINE_STATUS:require("../public/lines/line-status.js"),
    WORK_PRICING:require("../public/lines/work-pricing.js"),
    project:() => project,
    allLines:p => [...(p.lines || []), ...(p.landed || []), ...(p.backlog || [])],
    lineById:(p, id) => [...(p.lines || []), ...(p.landed || []), ...(p.backlog || [])].find(l => l.id === id) || null,
    homeChoice:() => choice,
    setHomeChoice:(_p, patch) => { Object.assign(choice, patch); for (const k of Object.keys(choice)) if (!choice[k]) delete choice[k]; },
    topicsGrew:() => false,
    viewHere:() => true,
    agentInfo:id => ({
      claude:{ id:"claude", name:"Claude Code", mono:"Cl", color:"#b4552f" },
      codex:{ id:"codex", name:"Codex", mono:"Cx", color:"#334155" },
      antigravity:{ id:"antigravity", name:"Antigravity", mono:"Ag", color:"#2f6b34" },
    }[id] || { id, name:id, mono:id.slice(0, 2), color:"#5b6472" }),
    av:id => `<span class="av">${id}</span>`,
    shortWhen:() => "Today",
    pathFor:id => `/projects/${encodeURIComponent(id)}`,
    api:apiImpl || (async () => ({ daily:[] })),
    fvBackTo() {}, fvPendingTry() {}, panoHTML:() => '<div id="pano"></div>',
    composerHTML:() => "", lineWarningsHTML:() => "",
    refreshAfterChange() { deskRefreshes++; ctx.refreshDesk(); },
    rowFacts:() => ({ at:0 }),
    rowMark:(_p, l) => l._mark || "done",
  });
  vm.runInContext(read("state"), ctx);
  vm.runInContext("S.cur = __init.id; S.data[__init.id] = __init.project; S.route = { view:'home' }; S.tokenPeriod = 'week';", Object.assign(ctx, { __init:{ id:project.id, project } }));
  if (apiImpl) ctx.api = apiImpl;
  vm.runInContext(read("stats"), ctx);
  ctx.projectDailySeries = window.projectDailySeries;
  vm.runInContext(read("desk"), ctx);
  return { ctx, document, window, storage, S, choice, listeners, deskRefreshes:() => deskRefreshes };
}

test("per-project line visits persist, rename on settle, trim to 40, and sync across tabs", () => {
  const storage = createStorage();
  const p = { id:"proj-a", name:"Alpha", projectTopics:false, lines:[{ id:"l1", slug:"l1", title:"One", stations:[] }], landed:[], backlog:[] };
  const { ctx, listeners } = createHomeContext({ project:p, storage });

  // Fill 45 visits and verify only newest 40 are retained.
  for (let i = 1; i <= 45; i++) ctx.recordLineVisit("proj-a", `line-${i}`, 1000 + i * 10);
  const kept = ctx.projectLineVisits(p);
  assert.equal(Object.keys(kept).length, 40);
  assert.equal("line-1" in kept, false);
  assert.equal("line-5" in kept, false);
  assert.equal(kept["line-6"], 1060);
  assert.equal(kept["line-45"], 1450);

  // Rename a temporary saving line id to its real server slug, preserving timestamp.
  ctx.recordLineVisit("proj-a", "saving-abc", 9000);
  ctx.renameLineVisit("proj-a", "saving-abc", "real-slug");
  const renamed = ctx.projectLineVisits(p);
  assert.equal("saving-abc" in renamed, false);
  assert.equal(renamed["real-slug"], 9000);

  // Cross-tab storage event updates visits in memory.
  const external = JSON.stringify({ "proj-a":{ l1:55555 } });
  storage.setItem("penecho-line-visits-v1", external);
  for (const fn of listeners.storage) fn({ key:"penecho-line-visits-v1", newValue:external });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.projectLineVisits(p))), { l1:55555 });
});

test("Recent lines renders all statuses, unread dots, relative times, empty state, and omits deleted lines", () => {
  const now = new Date(2026, 10, 24, 12, 0, 0).getTime();
  const p = {
    id:"proj-r",
    name:"Knowledge",
    projectTopics:false,
    lines:[
      { id:"run", slug:"run", title:"Working line", status:"working", _mark:"run", readRevision:"r1", stations:[] },
      { id:"you", slug:"you", title:"Needs answer", status:"waiting", _mark:"you", stations:[] },
      { id:"rev", slug:"rev", title:"Review item", status:"ready", _mark:"review", stations:[] },
      { id:"stp", slug:"stp", title:"Stopped task", status:"stopped", _mark:"bad", stations:[] },
      { id:"uns", slug:"uns", title:"Draft ask", status:"notes", _mark:"unsent", stations:[] },
      { id:"done", slug:"done", title:"Finished item", status:"done", _mark:"done", stations:[] },
    ],
    landed:[
      { id:"arc", slug:"arc", title:"Archived line", status:"closed", archived:true, _mark:"done", stations:[] },
    ],
    backlog:[],
  };
  const { ctx, document, window } = createHomeContext({ project:p });

  // First visit: empty prompt.
  document.body.innerHTML = `<div id="hmRecent">${ctx.recentLinesHTML(p, now)}</div>`;
  assert.match(document.querySelector("#hmRecent").textContent, /Lines you open show here\./);

  // Record visits across statuses + one deleted line.
  ctx.recordLineVisit(p.id, "run", now - 20 * 1000);          // Just now
  ctx.recordLineVisit(p.id, "you", now - 18 * 60000);         // 18m ago
  ctx.recordLineVisit(p.id, "rev", now - 2 * 3600000);        // 2h ago
  ctx.recordLineVisit(p.id, "stp", now - 26 * 3600000);       // Yesterday
  ctx.recordLineVisit(p.id, "arc", now - 3 * 86400000);       // 3d ago
  ctx.recordLineVisit(p.id, "deleted-line", now - 5 * 1000);  // Should be omitted

  document.body.innerHTML = `<div id="hmRecent">${ctx.recentLinesHTML(p, now)}</div>`;
  const rows = [...document.querySelectorAll("#hmRecent .hm-rc")];
  assert.deepEqual(rows.map(r => r.dataset.line), ["run", "you", "rev", "stp", "arc"]);
  assert.deepEqual(rows.map(r => r.querySelector(".hm-rc-when").textContent), ["Just now", "18m ago", "2h ago", "Yesterday", "3d ago"]);
  assert.equal(rows[0].querySelector(".hm-rc-when").classList.contains("is-fresh"), true);
  assert.equal(rows[0].classList.contains("is-unread"), true);
  assert.ok(rows[0].querySelector(".hm-rc-dot"));
  assert.deepEqual(rows.map(r => r.querySelector(".hm-rc-sy").getAttribute("aria-label")), ["Working", "Needs you", "To review", "Stopped", "Archived"]);

  // tickRecentTimes updates relative time in place.
  ctx.tickRecentTimes(now + 120000);
  assert.equal(rows[0].querySelector(".hm-rc-when").textContent, "2m ago");
  assert.equal(rows[0].querySelector(".hm-rc-when").classList.contains("is-fresh"), false);

  // Topics visible -> Recent lines stays hidden.
  p.projectTopics = true;
  assert.equal(ctx.recentLinesHTML(p, now), "");
});

test("Works by day renders 30-day agent chart, loads Kind of job on local, toggles, pins, and shows tooltip", async () => {
  const now = new Date(2026, 10, 24, 12, 0, 0).getTime();
  const dayStr = offset => {
    const d = new Date(now - offset * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const apiCalls = [];
  const dailyRows = [
    { day:dayStr(0), kind:"code", runner:"claude", works:2 },
    { day:dayStr(1), kind:"design", runner:"codex", works:1 },
  ];
  const p = {
    id:"proj-c",
    name:"Knowledge",
    rev:"r1",
    projectTopics:false,
    lines:[
      {
        id:"l1", slug:"l1", title:"Build", status:"done",
        stations:[
          { id:"w1", kind:"work", agent:"claude", state:"done", startedAt:now - 1000, endedAt:now },
          { id:"w2", kind:"work", agent:"claude", state:"done", startedAt:now - 2000, endedAt:now - 500 },
          { id:"w3", kind:"work", agent:"codex", state:"done", startedAt:now - 86400000, endedAt:now - 86400000 + 500 },
        ],
      },
    ],
    landed:[],
    backlog:[],
  };
  const { ctx, document, window } = createHomeContext({
    project:p,
    now,
    apiImpl:async url => { apiCalls.push(url); return { daily:dailyRows }; },
  });
  document.body.innerHTML = '<div id="hmRecent"></div><div id="hmChart"></div><div id="hmWeek"></div><div id="hmTokens"></div><div id="hmNeeds"></div><div id="lineWarnings"></div>';

  ctx.refreshDesk();
  // Before async daily returns, Agent mode renders immediately with 3 Works and Statistics button.
  assert.match(document.querySelector("#hmChart h2").textContent, /3 Works by agent/);
  assert.equal(document.querySelectorAll("#hmChart .hm-dy").length, 30);
  assert.ok(document.querySelector('#hmChart [data-act="go-view"][data-view="stats"]'));
  assert.equal(document.querySelector('#hmChart [data-act="home-chart-by"]'), null);

  // Wait for background loadHomeDaily promise to resolve.
  await new Promise(r => setImmediate(r));
  assert.deepEqual(apiCalls, ["/projects/proj-c/orchestrator/stats?days=30"]);
  assert.equal(document.querySelectorAll('#hmChart [data-act="home-chart-by"]').length, 2);

  // Switch to Kind of job.
  const kindBtn = document.querySelector('#hmChart [data-act="home-chart-by"][data-by="kind"]');
  ctx.ACT["home-chart-by"](kindBtn);
  assert.match(document.querySelector("#hmChart h2").textContent, /3 Works by kind of job/);
  assert.deepEqual([...document.querySelectorAll("#hmChart .hm-lg button")].map(b => b.dataset.k), ["code", "design"]);

  // Pin a legend series and verify highlight state.
  const codeLegend = document.querySelector('#hmChart .hm-lg button[data-k="code"]');
  ctx.ACT["home-chart-pin"](codeLegend);
  assert.equal(document.querySelector("#hmChartCard").classList.contains("is-hl"), true);
  assert.equal(codeLegend.getAttribute("aria-pressed"), "true");

  // Hovering a day shows its tooltip with breakdown.
  const todayCol = document.querySelector('#hmChart .hm-dy[data-i="29"]');
  ctx.showHomeChartTip(todayCol);
  const tip = document.querySelector("#hmChartTip");
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /2 Works/);
  assert.match(tip.textContent, /Code/);

  // Keyboard navigation moves roving tabindex across days and Escape hides tooltip.
  const day28 = document.querySelector('#hmChart .hm-dy[data-i="28"]');
  let focusedDay = null;
  day28.focus = () => { focusedDay = day28; };
  const arrowLeft = new window.Event("keydown", { bubbles:true, cancelable:true });
  arrowLeft.key = "ArrowLeft";
  todayCol.dispatchEvent(arrowLeft);
  assert.equal(focusedDay, day28);
  assert.equal(todayCol.getAttribute("tabindex"), "-1");
  assert.equal(day28.getAttribute("tabindex"), "0");
  const escEv = new window.Event("keydown", { bubbles:true, cancelable:true });
  escEv.key = "Escape";
  day28.dispatchEvent(escEv);
  assert.equal(tip.hidden, true);

  // Re-running refreshDesk with same rev does not re-fetch /orchestrator/stats.
  ctx.refreshDesk();
  assert.equal(apiCalls.length, 1);

  // Empty 30-day state renders calm placeholder.
  const emptyWorkProject = { id:"proj-e", name:"EmptyWorks", projectTopics:false, lines:[{ id:"l1", slug:"l1", title:"Note", stations:[] }], landed:[], backlog:[] };
  assert.match(ctx.homeChartHTML(emptyWorkProject), /No Works in the last 30 days\./);

  // Hosted mode never fetches /orchestrator/stats.
  const hostedCalls = [];
  const hostedCtx = createHomeContext({
    project:p,
    hosted:{ key:"proj-c" },
    apiImpl:async url => { hostedCalls.push(url); return { daily:dailyRows }; },
  });
  hostedCtx.document.body.innerHTML = '<div id="hmRecent"></div><div id="hmChart"></div><div id="hmWeek"></div><div id="hmTokens"></div><div id="hmNeeds"></div><div id="lineWarnings"></div>';
  hostedCtx.ctx.refreshDesk();
  assert.equal(hostedCalls.length, 0);
  assert.match(hostedCtx.document.querySelector("#hmChart h2").textContent, /3 Works by agent/);
});

test("Token savings card shows dollar savings when priced and keeps period switch and Details", () => {
  const now = Date.now();
  const p = {
    id:"proj-t",
    name:"Knowledge",
    projectTopics:false,
    lines:[{ id:"l1", slug:"l1", title:"One", stations:[] }],
    landed:[],
    backlog:[],
    tokens:{
      measuredWorks:2,
      inputTokens:1542900,
      cacheReadInputTokens:1500000,
      outputTokens:19600,
      daily:[{ day:new Date(now).toISOString().slice(0, 10), inputTokens:1542900, cacheReadInputTokens:1500000, outputTokens:19600 }],
      starts:[
        {
          at:now - 60000,
          status:"compared",
          difference:500000,
          cost:{
            costPercent:38,
            tokensPercent:45,
            fresh:{ tokensIn:600000, cost:100, usd:0.66 },
            resumed:{ tokensIn:1100000, cost:160, usd:1.06 },
          },
        },
      ],
    },
  };
  const { ctx, document, window } = createHomeContext({ project:p });
  document.body.innerHTML = ctx.tokenProjectHTML(p);
  assert.match(document.querySelector(".tk-big").textContent, /≈ 38% less cost · ≈ \$0\.40/);
  assert.ok(document.querySelector(".tk-head .tp-period"));
  assert.ok(document.querySelector(".tk-details"));
});
