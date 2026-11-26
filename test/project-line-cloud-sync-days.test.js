"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const { parseSyncDays, firstSyncWindow, DEFAULT_SYNC_DAYS } = require("../src/server/project-lines/cloud-share.js");
const { syncScope } = require("../src/server/project-lines/sync-scope.js");
const { cloudView } = require("../src/server/project-lines/cloud-view.js");
const { fakeCloud, fakeConnector } = require("./fake-cloud-lines.js");

const DAY_MS = 24 * 60 * 60 * 1000;
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cloud-sync-days-")));
const closing = [];
after(async () => {
  for (const close of closing.reverse()) await close();
  fs.rmSync(temp, { recursive:true, force:true });
});

function labelDaysAgo(days, now = Date.now()) {
  const d = new Date(now - days * DAY_MS);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const makeLineDoc = (id, title, daysAgo, extra = "") => `---\nid: ${id}\nstatus: done\n---\n\n# ${title}\n\n## Ask · ${labelDaysAgo(daysAgo)}\n\nWork on ${title}.\n${extra}`;

let count = 0;
async function computer(cloud, { maxFiles = null, retryMs = null, directory = null } = {}) {
  const n = ++count;
  const dir = directory || path.join(temp, `state-${n}`);
  const docsBase = path.join(temp, `docs-${n}`);
  const connector = fakeConnector(cloud);
  fs.mkdirSync(dir, { recursive:true });
  const lines = createProjectLines({
    cloud:() => connector,
    directory:dir,
    agents:{ available:() => [], useModelFile() {} },
    serviceOptions:{ autoWatch:false, cloudScope:true, docsBase, ...(maxFiles ? { cloudMaxFiles:maxFiles } : {}), ...(retryMs ? { cloudRetryMs:retryMs } : {}) },
    authorizeRead:() => null,
    authorizeWrite:() => null,
    isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => {
      let s = "";
      req.on("data", d => { s += d; }).on("end", () => {
        try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); }
      });
    }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); },
  });
  const server = http.createServer(async (req, res) => {
    if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const close = () => { server.close(); lines.close(); };
  closing.push(close);
  const base = `http://127.0.0.1:${server.address().port}/api/lines`;
  const call = async (method, route, body) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers:body !== undefined ? { "content-type":"application/json" } : {},
      ...(body !== undefined ? { body:JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch { json = { text }; }
    return { status:res.status, ...json };
  };
  const project = name => lines.service.store.create({ name, docsPath:path.join(docsBase, name) });
  const write = (p, rel, text) => {
    const full = path.join(p.docsPath, rel);
    fs.mkdirSync(path.dirname(full), { recursive:true });
    fs.writeFileSync(full, text);
  };
  const read = (p, rel) => fs.readFileSync(path.join(p.docsPath, rel), "utf8");
  return { lines, service:lines.service, share:lines.cloudShare, connector, call, project, write, read, dir, close };
}

function seedHistoryProject(machine, name) {
  const p = machine.project(name);
  machine.write(p, "lines/recent.md", makeLineDoc("T-1", "Recent", 3, "\n## [x] Work 1 · @fake\n\nSee ![shot](../files/recent/shot.png).\n"));
  machine.write(p, "works/recent/work-1.md", "---\nstep: Work 1\n---\n\n## Result\n\nRecent result.\n");
  machine.write(p, "files/recent/shot.png", "recent-png");

  machine.write(p, "lines/two-weeks.md", makeLineDoc("T-2", "Two weeks", 15, "\n## [x] Work 1 · @fake\n\nDone.\n"));
  machine.write(p, "works/two-weeks/work-1.md", "---\nstep: Work 1\n---\n\n## Result\n\nMid result.\n");
  machine.write(p, "files/two-weeks/note.txt", "mid");

  machine.write(p, "lines/ancient.md", makeLineDoc("T-3", "Ancient", 60, "\n## [x] Work 1 · @fake\n\nSee ![old](../files/ancient/old.png) and [canvas](../files/ancient/canvas.penecho.json).\n"));
  machine.write(p, "works/ancient/work-1.md", "---\nstep: Work 1\n---\n\n## Result\n\nAncient result.\n");
  machine.write(p, "files/ancient/old.png", "ancient-png");
  machine.write(p, "files/ancient/canvas.penecho.json", JSON.stringify({ manifest:{}, assets:[] }));

  // Knowledge index files linking every Line (including a 2-hop link) — must NOT drag excluded older Lines back into first sync.
  machine.write(p, "README.md", "# Project\n\n| Line |\n| --- |\n| [Recent](lines/recent.md) |\n| [Two weeks](lines/two-weeks.md) |\n| [Ancient](lines/ancient.md) |\n\nSee [Index](files/shared/index.md).\n");
  machine.write(p, "files/shared/index.md", "# Index\n\nSee [Old work](../../works/ancient/work-1.md).\n");
  machine.write(p, "understanding.md", "# Understanding\n\nSee [Ancient](lines/ancient.md) and [Two weeks](lines/two-weeks.md).\n");
  machine.write(p, "topics/history.md", "# History\n\n| [Ancient](../lines/ancient.md) | [Work](../works/ancient/work-1.md) |\n");
  machine.write(p, "lines/overview.md", "# Overview\n");
  machine.write(p, "files/board/canvas.penecho.json", JSON.stringify({ manifest:{}, assets:[] }));
  return p;
}

test("parseSyncDays and firstSyncWindow validate 7, 30, and all with 30-day default", () => {
  assert.equal(DEFAULT_SYNC_DAYS, 30);
  assert.equal(parseSyncDays(undefined), undefined);
  assert.equal(parseSyncDays(null), undefined);
  assert.equal(parseSyncDays(""), undefined);
  assert.equal(parseSyncDays(7), 7);
  assert.equal(parseSyncDays("7"), 7);
  assert.equal(parseSyncDays(30), 30);
  assert.equal(parseSyncDays("30"), 30);
  assert.equal(parseSyncDays("all"), "all");
  assert.equal(parseSyncDays("ALL"), "all");
  for (const bad of [0, -7, 14, 90, "week", true, {}]) {
    assert.throws(() => parseSyncDays(bad), { code:"BAD_SYNC_DAYS", status:400 });
  }
  const now = Date.UTC(2026, 10, 24, 12, 0, 0);
  assert.deepEqual(firstSyncWindow(undefined, now), { syncDays:30, syncSince:now - 30 * DAY_MS, syncStartedAt:now });
  assert.deepEqual(firstSyncWindow(7, now), { syncDays:7, syncSince:now - 7 * DAY_MS, syncStartedAt:now });
  assert.deepEqual(firstSyncWindow("all", now), { syncDays:"all", syncSince:0, syncStartedAt:now });
});

test("first sync defaults to 30 days, supports 7 days and all, and keeps index links and canvases from leaking excluded Lines", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud);

  // 1) Default (omitted syncDays) = 30 days
  const p30 = seedHistoryProject(a, "Default 30");
  const r30 = await a.call("POST", `/projects/${p30.id}/cloud`, { sync:true });
  assert.equal(r30.status, 200, JSON.stringify(r30));
  assert.equal(r30.syncDays, 30);
  assert.ok(r30.syncSince > 0);
  const paths30 = cloud.projects.get(p30.id).files.map(f => f.path).sort();
  for (const want of ["MEMORY.md", "README.md", ".knowledge/understanding.md", ".knowledge/topics/history.md", "topics/overview.md", "files/board/canvas.penecho.json", "topics/recent.md", "topics/recent/work-1.md", "files/recent/shot.png", "topics/two-weeks.md", "topics/two-weeks/work-1.md"]) {
    assert.ok(paths30.includes(want), `30d should include ${want} (got ${paths30.join(", ")})`);
  }
  assert.deepEqual(paths30.filter(p => p.includes("ancient")), [], "60-day-old Line, its works, its files, and its Canvas stay off Cloud");
  assert.equal(a.read(p30, "files/ancient/old.png"), "ancient-png", "local files stay untouched");
  // Cloud summary and Cloud page view exclude the unsynced older Line too.
  assert.deepEqual(cloud.projects.get(p30.id).summary.lines.map(l => l.path).sort(), ["lines/recent.md", "lines/two-weeks.md"]);
  const view30 = cloudView(a.service.stateOf(p30), syncScope(a.service, p30), { project:p30 });
  assert.deepEqual(view30.lines.map(l => l.slug).sort(), ["recent", "two-weeks"]);

  // 2) 7 days
  const p7 = seedHistoryProject(a, "Last 7");
  const r7 = await a.call("POST", `/projects/${p7.id}/cloud`, { sync:true, syncDays:7 });
  assert.equal(r7.status, 200, JSON.stringify(r7));
  assert.equal(r7.syncDays, 7);
  const paths7 = cloud.projects.get(p7.id).files.map(f => f.path);
  assert.ok(paths7.includes("topics/recent.md") && paths7.includes("topics/recent/work-1.md"));
  assert.deepEqual(paths7.filter(p => p.includes("two-weeks") || p.includes("ancient")), [], "15d and 60d Lines stay off Cloud under 7-day first sync");

  // 3) All
  const pAll = seedHistoryProject(a, "All history");
  const rAll = await a.call("POST", `/projects/${pAll.id}/cloud`, { sync:true, syncDays:"all" });
  assert.equal(rAll.status, 200, JSON.stringify(rAll));
  assert.equal(rAll.syncDays, "all");
  assert.equal(rAll.syncSince, 0);
  const pathsAll = cloud.projects.get(pAll.id).files.map(f => f.path);
  assert.ok(pathsAll.includes("topics/recent.md") && pathsAll.includes("topics/two-weeks.md") && pathsAll.includes("topics/ancient.md") && pathsAll.includes("files/ancient/canvas.penecho.json"));

  // 4) Invalid syncDays returns 400
  const badCloud = await a.call("POST", `/projects/${pAll.id}/cloud`, { sync:true, syncDays:14 });
  assert.equal(badCloud.status, 400);
  assert.equal(badCloud.code, "BAD_SYNC_DAYS");
  const badShare = await a.call("POST", `/projects/${pAll.id}/share`, { syncDays:"year" });
  assert.equal(badShare.status, 400);
  assert.equal(badShare.code, "BAD_SYNC_DAYS");
});

test("after first sync, old uploaded work is never cleared from Cloud as days grow and only new work syncs", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud);
  const p = seedHistoryProject(a, "Growing");
  a.write(p, "lines/still-old.md", makeLineDoc("T-4", "Still old", 75));

  const on = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true, syncDays:7 });
  assert.equal(on.status, 200);
  assert.ok(cloud.projects.get(p.id).files.some(f => f.path === "topics/recent.md"));
  assert.ok(!cloud.projects.get(p.id).files.some(f => f.path === "topics/ancient.md"));
  assert.ok(!cloud.projects.get(p.id).files.some(f => f.path === "topics/still-old.md"));

  // Simulate 45 days later: the originally synced "recent" line is now 48 days old relative to today,
  // and even if its recorded date predated syncSince, Cloud still keeps it because it is already synced.
  const originalSince = p.cloud.syncSince;
  a.write(p, "lines/recent.md", makeLineDoc("T-1", "Recent", 48, "\n## [x] Work 1 · @fake\n\nSee ![shot](../files/recent/shot.png).\n"));
  // Brand-new Line created after first sync.
  a.write(p, "lines/brand-new.md", makeLineDoc("T-5", "Brand new", 0));
  // Previously excluded older Line receives a manual edit (no new timed step, just edited on disk after syncStartedAt).
  const editedOld = path.join(p.docsPath, "lines/ancient.md");
  fs.writeFileSync(editedOld, `${makeLineDoc("T-3", "Ancient", 60)}\nHand-edited note.\n`);
  const futureSec = (Date.now() + 5000) / 1000;
  fs.utimesSync(editedOld, futureSec, futureSec);
  // Also simulate a remote edit pulled in the same round so flags.localMutated=true and fresh summary builds.
  cloud.edit(p.id, "MEMORY.md", "# Memory\n\nRemote update.\n");

  await a.share.syncNow(p);

  assert.equal(p.cloud.syncSince, originalSince, "syncSince stays fixed from first sync");
  const inCloud = cloud.projects.get(p.id).files.map(f => f.path);
  assert.ok(inCloud.includes("topics/recent.md"), "previously uploaded Line is never cleared from Cloud even as it ages past the initial window");
  assert.ok(inCloud.includes("topics/recent/work-1.md"), "its Work detail stays in Cloud");
  assert.ok(inCloud.includes("files/recent/shot.png"), "its files stay in Cloud");
  assert.ok(inCloud.includes("topics/brand-new.md"), "new Line syncs to Cloud");
  assert.ok(inCloud.includes("topics/ancient.md"), "older Line edited after first sync now syncs to Cloud");
  assert.ok(!inCloud.includes("topics/still-old.md"), "untouched older Line stays off Cloud");
  assert.ok(!inCloud.includes("topics/two-weeks.md"), "other untouched pre-cutoff Line stays off Cloud");
  assert.equal(fs.existsSync(path.join(p.docsPath, "lines/still-old.md")), true, "untouched older Line stays on this computer");
  // Even after a localMutated pull+push round, Cloud's summary still excludes unsynced older Lines.
  const summaryPaths = cloud.projects.get(p.id).summary.lines.map(l => l.path);
  assert.ok(summaryPaths.includes("lines/recent.md") && summaryPaths.includes("lines/brand-new.md") && summaryPaths.includes("lines/ancient.md"));
  assert.equal(summaryPaths.includes("lines/still-old.md"), false, "fresh commit summary does not leak unsynced older Lines");
  assert.equal(summaryPaths.includes("lines/two-weeks.md"), false);
});

test("choosing a shorter first-sync window lets a long-history project fit under Cloud file limits and retries cleanly after failure", async () => {
  const cloud = await fakeCloud(); closing.push(() => cloud.close());
  const a = await computer(cloud, { maxFiles:12 });
  const p = a.project("Long history");
  for (let i = 0; i < 10; i++) {
    a.write(p, `lines/old-${i}.md`, makeLineDoc(`OLD-${i}`, `Old ${i}`, 45 + i));
    a.write(p, `works/old-${i}/work-1.md`, `old work ${i}\n`);
  }
  a.write(p, "lines/today.md", makeLineDoc("NEW-1", "Today", 1));
  a.write(p, "works/today/work-1.md", "today work\n");

  // All history exceeds maxFiles (12) and fails without dirtying project.cloud.
  const tooMany = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true, syncDays:"all" });
  assert.equal(tooMany.status, 413);
  assert.equal(tooMany.code, "TOO_MANY_FILES");
  assert.equal(p.cloud, undefined, "failed first sync does not lock in syncDays");

  // Switching to 30 days (or 7 days) succeeds cleanly.
  const ok = await a.call("POST", `/projects/${p.id}/cloud`, { sync:true, syncDays:30 });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.syncDays, 30);
  const inCloud = cloud.projects.get(p.id).files.map(f => f.path);
  assert.ok(inCloud.includes("topics/today.md"));
  assert.equal(inCloud.some(rel => rel.includes("old-")), false);
});

test("first Share honors syncDays, paused first sync keeps its window across restart, legacy sync stays untouched, and removing Cloud copy resets choice", async () => {
  const cloud = await fakeCloud({ limit:10 }); closing.push(() => cloud.close());
  const a = await computer(cloud, { retryMs:[5] });

  // 1) Share first publish with 7 days
  const pShare = seedHistoryProject(a, "Shared 7");
  const shared = await a.call("POST", `/projects/${pShare.id}/share`, { syncDays:7 });
  assert.equal(shared.status, 200, JSON.stringify(shared));
  assert.ok(shared.link);
  assert.equal(shared.syncDays, 7);
  const sharedPaths = cloud.projects.get(pShare.id).files.map(f => f.path);
  assert.ok(sharedPaths.includes("topics/recent.md"));
  assert.equal(sharedPaths.some(rel => rel.includes("two-weeks") || rel.includes("ancient")), false);

  // Stop sharing + remove Cloud copy resets first-sync choice so re-enabling with "all" uploads everything.
  assert.equal((await a.call("DELETE", `/projects/${pShare.id}/share`)).status, 200);
  assert.equal((await a.call("POST", `/projects/${pShare.id}/cloud`, { sync:false })).status, 200);
  assert.equal(pShare.cloud, undefined);
  const reAll = await a.call("POST", `/projects/${pShare.id}/cloud`, { sync:true, syncDays:"all" });
  assert.equal(reAll.status, 200);
  assert.equal(reAll.syncDays, "all");
  assert.ok(cloud.projects.get(pShare.id).files.some(f => f.path === "topics/ancient.md"));

  // 2) Legacy project already synced (no syncDays / syncSince): never retroactively drops old Lines.
  const pLegacy = seedHistoryProject(a, "Legacy");
  // Enable with all then strip syncDays/syncSince to match pre-feature projects.json.
  assert.equal((await a.call("POST", `/projects/${pLegacy.id}/cloud`, { sync:true, syncDays:"all" })).status, 200);
  delete pLegacy.cloud.syncDays;
  delete pLegacy.cloud.syncSince;
  a.service.store.save();
  await a.share.syncNow(pLegacy);
  assert.ok(cloud.projects.get(pLegacy.id).files.some(f => f.path === "topics/ancient.md"), "legacy synced project keeps old Lines");

  // 3) Paused first sync (503 on blobs) persists syncDays/syncSince across restart and completes with same 7-day window.
  const b = await computer(cloud, { retryMs:[5] });
  const pPaused = seedHistoryProject(b, "Paused 7");
  cloud.blobFail = () => 503;
  const paused = await b.call("POST", `/projects/${pPaused.id}/cloud`, { sync:true, syncDays:7 });
  assert.equal(paused.status, 200);
  assert.equal(paused.sync, true);
  assert.equal(paused.syncDays, 7);
  assert.ok(paused.syncSince > 0);
  b.close();

  cloud.blobFail = () => 0;
  const bRestarted = await computer(cloud, { directory:b.dir, retryMs:[5] });
  await bRestarted.share.tick();
  const resumedPaths = cloud.projects.get(pPaused.id).files.map(f => f.path);
  assert.ok(resumedPaths.includes("topics/recent.md"), "recent Line uploads on resume");
  assert.equal(resumedPaths.some(rel => rel.includes("two-weeks") || rel.includes("ancient")), false, "7-day cutoff survived restart");

  // 4) Half-finished first Share (upload succeeds with 7d, POST /share fails, retry Share): 7-day window is NOT lost.
  const c = await computer(cloud, { retryMs:[5] });
  const pHalf = seedHistoryProject(c, "Half share");
  const origReq = c.connector.cloudRequest.bind(c.connector);
  let failShareOnce = true;
  c.connector.cloudRequest = async (pathname, options) => {
    if (pathname.endsWith("/share") && options?.method === "POST" && failShareOnce) {
      failShareOnce = false;
      throw Object.assign(new Error("Temporary share failure"), { status:503, code:"cloud_temporarily_unavailable" });
    }
    return origReq(pathname, options);
  };
  const failedShare = await c.call("POST", `/projects/${pHalf.id}/share`, { syncDays:7 });
  assert.equal(failedShare.status, 503);
  assert.equal(pHalf.cloud?.syncDays, 7, "7-day window was persisted as soon as first upload published");
  const retriedShare = await c.call("POST", `/projects/${pHalf.id}/share`, { syncDays:7 });
  assert.equal(retriedShare.status, 200);
  assert.equal(retriedShare.syncDays, 7);
  await c.share.tick();
  const halfPaths = cloud.projects.get(pHalf.id).files.map(f => f.path);
  assert.ok(halfPaths.includes("topics/recent.md"));
  assert.equal(halfPaths.some(rel => rel.includes("two-weeks") || rel.includes("ancient")), false, "retry after half-finished Share never leaks older Lines");
});

test("Cloud UI (Project settings, Keep in Cloud popover, Share dialog) offers 7 days / 30 days (default) / All only for first sync", async () => {
  const cloudSrc = fs.readFileSync(path.join(__dirname, "..", "public", "lines", "cloud.js"), "utf8");
  const shareSrc = fs.readFileSync(path.join(__dirname, "..", "public", "lines", "share.js"), "utf8");
  const { document, window } = parseHTML("<!doctype html><html><body><div id='projbar'><button class='bar-share'></button></div><div id='root'></div></body></html>");
  let focused = document.body;
  Object.defineProperty(document, "activeElement", { get:() => focused?.isConnected ? focused : document.body });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  window.HTMLDialogElement && (window.HTMLDialogElement.prototype.showModal = function () { this.open = true; });
  window.HTMLDialogElement && (window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); });
  const origCreate = document.createElement.bind(document);
  document.createElement = tag => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === "dialog") {
      el.showModal = function () { this.open = true; };
      el.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
    }
    return el;
  };
  document.querySelector(".bar-share").getBoundingClientRect = () => ({ right:400, bottom:50, width:80, height:30 });

  const calls = [];
  let statusReply = { signedIn:true, name:"Heack", accountVersion:"v1", sync:false, shared:false, remote:null, plus:true, origin:"https://penecho.ai", maxBytes:300 * 1048576 };
  const curProject = { id:"p1", name:"PenEcho" };
  const S = { cloudAccount:{ signedIn:true, name:"Heack", plan:"plus" }, cloudProjects:{ projects:[] }, cloudKept:{}, projects:[curProject], thisComputer:true };
  const ACT = {};
  const ctx = vm.createContext({
    window, document, Date, Math, Number, String, Boolean, Array, Object, Set, Map, JSON, Error,
    innerWidth:1280, innerHeight:800,
    clamp:(v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    ICONS:{ cloud:"<path/>", warn:"<path/>", link:"<path/>", copy:"<path/>", down:"<path/>" },
    S, HOSTED:null, ACT,
    $: (sel, root = document) => root.querySelector(sel),
    $$: (sel, root = document) => [...root.querySelectorAll(sel)],
    esc:s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])),
    ic:n => `<svg data-ic="${n}"></svg>`,
    pathFor:id => `/projects/${id}`,
    project:() => curProject,
    summaryOf:() => curProject,
    closeMenu:() => { document.querySelector("#menu")?.remove(); },
    openMenu:() => {},
    toast:() => {},
    copyText:() => {},
    renderRail:() => {},
    underPage:() => true,
    loadCloudAccount:async () => S.cloudAccount,
    addEventListener:() => {},
    setInterval:() => 0, clearInterval:() => {},
    setTimeout:() => 0, clearTimeout:() => {},
    location:{ hash:"" },
    api:async (url, opts = {}) => {
      calls.push({ url, method:opts.method || "GET", body:opts.body });
      if (opts.method === "POST" && url.endsWith("/cloud")) {
        return { ...statusReply, sync:Boolean(opts.body?.sync), syncDays:opts.body?.syncDays, syncSince:opts.body?.syncDays === "all" ? 0 : Date.now() - Number(opts.body?.syncDays || 30) * DAY_MS, remote:opts.body?.sync ? { rev:1, files:5 } : null };
      }
      if (opts.method === "POST" && url.endsWith("/share")) {
        return { ...statusReply, sync:true, shared:true, syncDays:opts.body?.syncDays ?? 30, link:"https://penecho.ai/l/abc", remote:{ rev:1, files:5, share:{ url:"/l/abc", ended:false } } };
      }
      return statusReply;
    },
  });
  vm.runInContext(shareSrc, ctx, { filename:"public/lines/share.js" });
  vm.runInContext(cloudSrc, ctx, { filename:"public/lines/cloud.js" });

  // 1) Project settings: first sync shows 7 days / 30 days (default) / All, sends chosen syncDays on Enable sync, hides picker after sync is On.
  const root = document.getElementById("root");
  root.innerHTML = ctx.projectCloudSettingsHTML(curProject);
  ctx.mountProjectCloudSettings(curProject);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const radios = [...document.querySelectorAll('#projectCloudSettings [role="radio"]')];
  assert.deepEqual(radios.map(b => [b.dataset.days, b.getAttribute("aria-checked"), b.getAttribute("tabindex")]), [["7", "false", "-1"], ["30", "true", "0"], ["all", "false", "-1"]]);

  // ArrowLeft moves selection and focus from 30 days to 7 days.
  radios[1].focus();
  radios[1].dispatchEvent(new window.Event("keydown", { bubbles:true, cancelable:true }));
  const keyEvt = Object.assign(new window.Event("keydown", { bubbles:true, cancelable:true }), { key:"ArrowLeft" });
  radios[1].dispatchEvent(keyEvt);
  assert.equal(document.activeElement?.dataset.days, "7");
  ctx.ACT["project-cloud-sync-days"](document.activeElement);
  assert.equal(document.querySelector('#projectCloudSettings [data-days="7"]').getAttribute("aria-checked"), "true");
  assert.equal(document.querySelector('#projectCloudSettings [data-days="7"]').getAttribute("tabindex"), "0");
  assert.equal(document.activeElement?.dataset.days, "7");

  calls.length = 0;
  await ctx.ACT["project-cloud-setting"](document.querySelector('#projectCloudSettings [data-command="enable"]'));
  const enableCall = calls.find(c => c.method === "POST" && c.url === "/projects/p1/cloud");
  assert.deepEqual({ ...enableCall.body }, { sync:true, syncDays:7 });
  // Once synced, the first-sync picker is gone and the note explains uploaded work stays in Cloud.
  assert.equal(document.querySelectorAll('#projectCloudSettings [role="radio"]').length, 0);
  assert.match(document.getElementById("projectCloudSettings").textContent, /First sync included the last 7 days/);
  assert.match(document.getElementById("projectCloudSettings").textContent, /stays in Cloud as days grow/);

  // 2) Keep in Cloud popover before first sync (including unpublished rev-0 stub): defaults to 30 days, switching to All sends syncDays:"all".
  statusReply = { ...statusReply, sync:false, shared:false, remote:{ rev:0, files:0 } };
  S.cloudKept = {};
  await ctx.ACT["cloud-keep"]();
  const pop = document.querySelector("#menu.cloud-pop");
  assert.ok(pop);
  assert.equal(pop.querySelector('[data-keep-days][data-days="30"]').getAttribute("aria-checked"), "true");
  pop.querySelector('[data-keep-days][data-days="all"]').click();
  assert.equal(pop.querySelector('[data-keep-days][data-days="all"]').getAttribute("aria-checked"), "true");
  calls.length = 0;
  pop.querySelector("[data-keep-switch]").click();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const keepCall = calls.find(c => c.method === "POST" && c.url === "/projects/p1/cloud");
  assert.deepEqual({ ...keepCall.body }, { sync:true, syncDays:"all" });
  pop.remove();

  // 3) Share dialog before first sync: defaults to 30 days, selecting 7 days sends { syncDays: 7 }.
  statusReply = { ...statusReply, sync:false, shared:false, remote:null };
  S.cloudKept = {};
  await ctx.ACT["project-share"]();
  const dialog = document.querySelector("dialog.share-dialog");
  assert.ok(dialog);
  assert.equal(dialog.querySelector('[data-share-days][data-days="30"]').getAttribute("aria-checked"), "true");
  dialog.querySelector('[data-share-days][data-days="7"]').click();
  assert.equal(dialog.querySelector('[data-share-days][data-days="7"]').getAttribute("aria-checked"), "true");
  calls.length = 0;
  dialog.querySelector("[data-share-create]").click();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const shareCall = calls.find(c => c.method === "POST" && c.url === "/projects/p1/share");
  assert.deepEqual({ ...shareCall.body }, { syncDays:7 });
  dialog.close();

  // 4) Already-synced project in Share dialog: no first-sync picker, no syncDays sent.
  statusReply = { ...statusReply, sync:true, shared:false, remote:{ rev:2, files:10, share:null } };
  await ctx.ACT["project-share"]();
  const dialog2 = document.querySelector("dialog.share-dialog");
  assert.equal(dialog2.querySelectorAll("[data-share-days]").length, 0);
  calls.length = 0;
  dialog2.querySelector("[data-share-create]").click();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const shareCall2 = calls.find(c => c.method === "POST" && c.url === "/projects/p1/share");
  assert.equal(shareCall2.body, undefined);
  dialog2.close();

  // 5) Disconnected attached Cloud project (remote copy exists) does not show first-sync picker or send syncDays on reconnect.
  statusReply = { ...statusReply, sync:false, shared:false, key:"remote-orig", remote:{ rev:3, files:8, share:null } };
  root.innerHTML = ctx.projectCloudSettingsHTML(curProject);
  ctx.mountProjectCloudSettings(curProject);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(document.querySelectorAll('#projectCloudSettings [role="radio"]').length, 0);
  calls.length = 0;
  await ctx.ACT["project-cloud-setting"](document.querySelector('#projectCloudSettings [data-command="enable"]'));
  const reconnectCall = calls.find(c => c.method === "POST" && c.url === "/projects/p1/cloud");
  assert.deepEqual({ ...reconnectCall.body }, { sync:true });
});
