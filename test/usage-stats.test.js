"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createUsageStats, routeKeys, annotateUsage, USAGE_KEYS } = require("../src/server/usage-stats.js");

const DAY = 86_400_000;
function harness(t, options = {}) {
  const stateDirectory = options.stateDirectory || fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-")), sent = [];
  let time = Date.UTC(2026, 10, 2, 9), status = 204, networkError = false;
  const stats = createUsageStats({ stateDirectory, now:() => time, version:"1.5.0", platform:"darwin", tools:new Set(["penecho_draw", "penecho_list_canvases"]),
    fetchImpl:async (url, init) => { sent.push({ url:String(url), body:JSON.parse(init.body) }); if (networkError) throw new Error("offline"); return { status, ok:status >= 200 && status < 300 }; }, ...options });
  t.after(() => {
    stats.close();
    // Node 22 does not count a folder under a plain file as gone.
    try { fs.rmSync(stateDirectory, { recursive:true, force:true }); } catch (error) { if (error.code !== "ENOTDIR") throw error; }
  });
  return { stats, stateDirectory, sent, advance:days => { time += days * DAY; }, respond:value => { status = value; networkError = false; }, fail:() => { networkError = true; } };
}
const request = (method, pathname, statusCode = 200, headers = {}) => [{ method, headers }, { statusCode }, new URL(pathname, "http://localhost")];
const counts = stats => Object.fromEntries(stats.report().days.map(({ day, counts }) => [day, counts]));

test("a missing state file starts with both usage counts and model ratings enabled", t => {
  const { stats, stateDirectory } = harness(t);
  const file = path.join(stateDirectory, "usage-stats.json"), stored = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(stats.status().enabled, true);
  assert.equal(stats.status().ratingsEnabled, true);
  assert.match(stored.installation, /^[0-9a-f]{32}$/);
  assert.equal(stored.enabled, true);
  assert.equal(stored.ratingsEnabled, true);
  assert.deepEqual(stored.days, {});
  assert.deepEqual(stats.status().report.days, [], "the Settings preview is exactly the next completed-day report");
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600");
  stats.count("open"); stats.close();
  const again = createUsageStats({ stateDirectory, now:() => Date.UTC(2026, 10, 2, 9), tools:new Set() });
  t.after(() => again.close());
  assert.equal(again.status().enabled, true);
  assert.equal(again.status().ratingsEnabled, true);
  assert.equal(again.status().report.installation, stored.installation);
  assert.equal(again.report().days[0].counts.open, 1, "close flushed pending counts without sending them");
});

test("toggles operate independently; turning both off wipes data and stays off until a new opt-in", t => {
  const { stats, stateDirectory } = harness(t), file = path.join(stateDirectory, "usage-stats.json");
  const first = stats.status().report.installation;
  stats.count("open");

  const countsOff = stats.setPreferences({ enabled:false });
  assert.equal(countsOff.enabled, false);
  assert.equal(countsOff.ratingsEnabled, true);
  assert.equal(countsOff.report.installation, first, "keeping model ratings on preserves the installation id");
  assert.deepEqual(countsOff.report.days, []);
  const storedPartial = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(storedPartial.enabled, false);
  assert.equal(storedPartial.ratingsEnabled, true);
  assert.equal("days" in storedPartial, false, "turning usage counts off deletes pending counts");
  stats.count("open"); stats.toolCall("penecho_draw");
  assert.deepEqual(stats.report().days, []);

  assert.deepEqual(stats.setPreferences({ ratingsEnabled:false }), { enabled:false, ratingsEnabled:false, report:null });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { enabled:false, ratingsEnabled:false });
  stats.close();

  const offAgain = createUsageStats({ stateDirectory, tools:new Set(["penecho_draw"]) });
  t.after(() => offAgain.close());
  assert.deepEqual(offAgain.status(), { enabled:false, ratingsEnabled:false, report:null });

  const second = offAgain.setPreferences({ enabled:true }).report;
  assert.equal(offAgain.status().ratingsEnabled, false);
  assert.match(second.installation, /^[0-9a-f]{32}$/);
  assert.notEqual(second.installation, first);
  assert.deepEqual(second.days, []);
});

test("legacy usage-stats.json files migrate opt-in to both on and opt-out to both off", t => {
  const enabledDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-legacy-on-"));
  fs.writeFileSync(path.join(enabledDir, "usage-stats.json"), JSON.stringify({ enabled:true, installation:"b".repeat(32), days:{ "2026-11-01":{ open:2 } } }));
  const on = harness(t, { stateDirectory:enabledDir });
  assert.equal(on.stats.status().enabled, true);
  assert.equal(on.stats.status().ratingsEnabled, true);
  assert.equal(on.stats.status().report.installation, "b".repeat(32));
  assert.deepEqual(on.stats.status().report.days, [{ day:"2026-11-01", counts:{ open:2 } }]);

  const disabledDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-legacy-off-"));
  fs.writeFileSync(path.join(disabledDir, "usage-stats.json"), JSON.stringify({ enabled:false }));
  const off = harness(t, { stateDirectory:disabledDir });
  assert.deepEqual(off.stats.status(), { enabled:false, ratingsEnabled:false, report:null });
});

test("corrupt or unwritable preferences fail closed and keep opt-outs in effect on save failure", t => {
  const corrupt = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-corrupt-"));
  fs.writeFileSync(path.join(corrupt, "usage-stats.json"), "not json");
  const first = harness(t, { stateDirectory:corrupt });
  assert.deepEqual(first.stats.status(), { enabled:false, ratingsEnabled:false, report:null });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(corrupt, "usage-stats.json"), "utf8")), { enabled:false, ratingsEnabled:false });

  const badType = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-badtype-"));
  fs.writeFileSync(path.join(badType, "usage-stats.json"), JSON.stringify({ enabled:true, ratingsEnabled:"yes", installation:"c".repeat(32) }));
  const bad = harness(t, { stateDirectory:badType });
  assert.deepEqual(bad.stats.status(), { enabled:false, ratingsEnabled:false, report:null });

  const badInstall = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-badinstall-"));
  fs.writeFileSync(path.join(badInstall, "usage-stats.json"), JSON.stringify({ enabled:true, ratingsEnabled:true, installation:["d".repeat(32)] }));
  const coerced = harness(t, { stateDirectory:badInstall });
  assert.deepEqual(coerced.stats.status(), { enabled:false, ratingsEnabled:false, report:null });

  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-blocked-"));
  fs.writeFileSync(path.join(blocked, "file"), "not a directory");
  const second = harness(t, { stateDirectory:path.join(blocked, "file", "child") });
  assert.equal(second.stats.status().enabled, false);
  assert.equal(second.stats.status().ratingsEnabled, false);
  assert.throws(() => second.stats.setEnabled(true), { status:500 });
  assert.equal(second.stats.status().enabled, false);
  assert.throws(() => second.stats.setPreferences({ ratingsEnabled:true }), { status:500 });
  assert.equal(second.stats.status().ratingsEnabled, false);
});

test("fixed route mappings cover Canvas, Cloud, Projects and Lines without retired actions", () => {
  const cases = [
    ["POST", "/api/ai/command", ["canvas-ai"]], ["POST", "/api/canvases", ["canvas-new"]],
    ["POST", "/api/cloud/live/links", ["live-link"]], ["POST", "/api/cloud/projects", ["cloud-project"]],
    ["POST", "/api/v1/mcp/workspaces/workspace/project/canvases", ["canvas-new"]],
    ["POST", "/api/canvas-agent/projects", ["agent-folder"]], ["POST", "/api/canvas-agent/projects/from-root", ["agent-folder"]], ["POST", "/api/canvas-agent/projects/from-host-root", ["agent-folder"]],
    ["POST", "/api/plugins", ["plugin-install"]], ["POST", "/api/plugins/improve", ["plugin-improve"]],
    ["POST", "/api/playground/liveclay", ["liveclay"]], ["POST", "/api/suggest", ["suggestions"]],
    ["POST", "/api/settings/connections", ["model-connection"]],
    ["POST", "/api/settings", ["settings-change"]], ["POST", "/api/suggest/preferences", ["settings-change"]],
    ["POST", "/api/local-access/network", ["settings-change"]], ["POST", "/api/mcp/configure", ["settings-change"]],
    ["POST", "/api/lines/computer", ["settings-change"]], ["POST", "/api/lines/agents/skill", ["settings-change"]], ["POST", "/api/lines/agents/model/claude", ["settings-change"]],
    ["POST", "/api/lines/agent-presets", ["agent-preset"]], ["PATCH", "/api/lines/agent-presets/preset", ["agent-preset"]],
    ["GET", "/api/lines/projects/project/find", ["project-search"]], ["POST", "/api/lines/projects/project/ask", ["project-ask"]],
    ["POST", "/api/lines/projects/project/cloud", ["project-sync"]], ["POST", "/api/lines/projects/project/share", ["project-share"]],
    ["POST", "/api/lines/projects/project/notes", ["line-note", "line-new"]],
    ["POST", "/api/lines/projects/project/topics", ["line-ask"]], ["POST", "/api/lines/projects/project/unsent", ["line-ask"]], ["POST", "/api/lines/projects/project/topics/line/feedback", ["line-ask"]],
  ];
  for (const [method, pathname, expected] of cases) assert.deepEqual(routeKeys(method, pathname), expected, `${method} ${pathname}`);
  for (const [method, pathname] of [["POST", "/api/cloud/projects/123e4567-e89b-12d3-a456-426614174000/save"], ["POST", "/api/settings/connections/test"], ["POST", "/api/usage-stats"], ["GET", "/api/lines/agent-presets"], ["POST", "/api/cloud/pair"], ["GET", "/api/lines/projects/project/canvas-slides"], ["POST", "/api/lines/projects/project/sync"], ["POST", "/api/lines/projects"], ["POST", "/api/lines/projects/import"], ["POST", "/api/lines/projects/project/canvases"], ["GET", "/"]]) {
    assert.deepEqual(routeKeys(method, pathname), [], `${method} ${pathname}`);
  }
  assert.equal(USAGE_KEYS.has("device-link"), true, "retired device-link remains allowed by Cloud but has no local mapping");
  assert.equal(USAGE_KEYS.has("slides-download"), true, "browser-only slide downloads have no server mapping");
});

test("requests count only fixed keys on 2xx/3xx, annotations, valid runners and registered MCP tools", t => {
  const { stats } = harness(t);
  stats.observe(...request("POST", "/api/ai/command", 500));
  stats.observe(...request("POST", "/api/canvases?name=private", 201));
  stats.observe(...request("POST", "/api/notes/sync"));
  const res = { statusCode:200 }; annotateUsage(res, "line-new"); annotateUsage(res, "not-allowed");
  stats.observe({ method:"POST", headers:{} }, res, new URL("/api/lines/projects/private/topics", "http://localhost"));
  stats.count("private project name"); stats.count("mcp.made_up"); stats.count("run-INVALID");
  stats.workRun("Claude"); stats.workRun("not valid!");
  stats.toolCall("penecho_draw"); stats.toolCall("penecho_made_up");
  assert.deepEqual(counts(stats), { "2026-11-02":{ "canvas-new":1, "line-new":1, "line-ask":1, "work-run":2, "run-claude":1, "mcp.draw":1 } });
});

test("only finished UTC days send; 5xx and network failure keep them, 2xx and 4xx finish them", async t => {
  const { stats, sent, advance, respond, fail } = harness(t, { origin:() => "https://penecho.example" });
  stats.toolCall("penecho_draw");
  assert.equal(await stats.send(), false, "today is not finished");
  advance(1); stats.toolCall("penecho_list_canvases");
  respond(503); assert.equal(await stats.send(), false);
  fail(); assert.equal(await stats.send(), false);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].body.days, [{ day:"2026-11-02", counts:{ "mcp.draw":1 } }]);
  assert.equal(sent[0].body.app, "local");
  assert.equal(sent[0].body.platform, "macos");
  respond(204); assert.equal(await stats.send(), true);
  assert.equal(sent[2].url, "https://penecho.example/api/v1/analytics/local-usage");
  assert.deepEqual(stats.report().days, [{ day:"2026-11-03", counts:{ "mcp.list_canvases":1 } }]);
  advance(1); respond(400);
  assert.equal(await stats.send(), false, "4xx is done even though it is not ok");
  assert.deepEqual(stats.report().days, [], "the refused finished day was discarded");
});

test("reports go only to HTTPS or loopback HTTP and identify desktop and platform", async t => {
  for (const [origin, expected] of [["http://penecho.example", 0], ["http://127.0.0.1:8787", 1]]) {
    const { stats, sent, advance } = harness(t, { origin:() => origin, app:"desktop", platform:"win32" });
    stats.count("open"); advance(1); await stats.send();
    assert.equal(sent.length, expected, origin);
    if (expected) { assert.equal(sent[0].body.app, "desktop"); assert.equal(sent[0].body.platform, "windows"); }
  }
});

test("storage keeps 30 finished days plus today, reports at most 31 days and 64 valid keys", t => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-retention-")), days = {};
  for (let offset = -34; offset <= 0; offset++) {
    const day = new Date(Date.UTC(2026, 10, 2, 9) + offset * DAY).toISOString().slice(0, 10);
    days[day] = Object.fromEntries([...Array(70)].map((_, i) => [`run-r${i}`, 1]));
  }
  days["2026-11-02"]["Bad Key"] = 100;
  days["2026-12-01"] = { open:1 };
  fs.writeFileSync(path.join(stateDirectory, "usage-stats.json"), JSON.stringify({ enabled:true, installation:"a".repeat(32), days }));
  const { stats } = harness(t, { stateDirectory });
  assert.equal(stats.report().days.length, 31);
  assert.equal(stats.status().report.days.length, 30);
  assert.equal(stats.report().days[0].day, "2026-10-03");
  assert.equal(stats.report().days.at(-1).day, "2026-11-02");
  assert.equal(Object.keys(stats.report().days[0].counts).length, 64);
  assert.equal("Bad Key" in stats.report().days.at(-1).counts, false);
});

test("a scheduled check prunes expired days even when nobody acts", async t => {
  const { stats, stateDirectory, sent, advance } = harness(t);
  stats.count("open");
  advance(31);
  assert.equal(await stats.send(), false);
  assert.equal(sent.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateDirectory, "usage-stats.json"), "utf8")).days, {});
});

test("pruning is persisted before a failed send with a mix of expired and valid days", async t => {
  const { stats, stateDirectory, sent, advance, respond } = harness(t);
  stats.count("open"); advance(1); stats.count("canvas-new"); advance(30); respond(503);
  assert.equal(await stats.send(), false);
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateDirectory, "usage-stats.json"), "utf8")).days, { "2026-11-03":{ "canvas-new":1 } });
});

test("the scheduler sends once at a quiet moment within five minutes of start, then once a day, never on close", async t => {
  t.mock.timers.enable({ apis:["setTimeout"] });
  let running = true;
  const { stats, sent, advance } = harness(t, { origin:() => "https://penecho.example", busy:() => running });
  stats.count("open"); advance(1); stats.start();
  for (let i = 0; i < 2; i++) { t.mock.timers.tick(30_000); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(sent.length, 0, "an agent is running: wait");
  running = false;
  t.mock.timers.tick(30_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1, "the first quiet check sends");
  stats.count("open"); advance(1);
  t.mock.timers.tick(24 * 3_600_000 - 1);
  assert.equal(sent.length, 1);
  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 2, "then once a day");
  advance(1); stats.close();
  t.mock.timers.tick(24 * 3_600_000);
  assert.equal(sent.length, 2, "close does not send the newly finished day");
});

test("a busy app still sends at five minutes", async t => {
  t.mock.timers.enable({ apis:["setTimeout"] });
  const { stats, sent, advance } = harness(t, { origin:() => "https://penecho.example", busy:() => true });
  stats.count("open"); advance(1); stats.start();
  for (let i = 0; i < 9; i++) { t.mock.timers.tick(30_000); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(sent.length, 0, "four and a half minutes, still busy: wait");
  t.mock.timers.tick(30_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1, "at five minutes it sends anyway");
  stats.close();
});

test("agent results: days from install/opt-in through today, unchanged days skipped, only valid rows, two projects summed", async t => {
  const asked = [], good = { runner:"claude", model:"claude-opus-5-5", effort:"medium", kind:"code", works:2, finished:1, failed:0, stopped:1, followups:1, scoreSum:4.3, scoreCount:1, good:1, bad:0, minutes:7, tokens:1000, costUsd:0.5 };
  const each = (window, make) => { const out = []; for (let at = Date.parse(`${window.from}T00:00:00Z`); at <= Date.parse(`${window.to}T00:00:00Z`); at += DAY) out.push(...make(new Date(at).toISOString().slice(0, 10))); return out; };
  // Fresh install on Nov 2 must never send pre-install Works (Oct 31, Nov 1); post-install Works on Nov 2 upload right away.
  // A score is 1 to 5 to one decimal; impossible raw sums (-0.09, 0.91, 9) are dropped before rounding, and merged daily rows round up once.
  let rows = window => each(window, day => [
    { ...good, day },
    { ...good, day, runner:"Not Valid" },
    { ...good, day, scoreSum:9 },
    { ...good, day, scoreSum:-0.09, scoreCount:0 },
    { ...good, day, scoreSum:0.91, scoreCount:1 },
    { ...good, day, scoreSum:4.21 },
    { ...good, day, title:"secret" },
    { ...good, day, model:"claude-sonnet-5-5", scoreSum:4.21 },
    { ...good, day, model:"claude-sonnet-5-5", scoreSum:4.21 },
  ]);
  const { stats, sent, advance, respond } = harness(t, { agentRows:window => { asked.push(window); return rows(window); } });
  const preview = stats.status().report;
  const merged = { ...good, day:"2026-11-02", works:6, finished:3, stopped:3, followups:3, scoreSum:12.9, scoreCount:3, good:3, minutes:21, tokens:3000, costUsd:1.5, tokensIn:0, tokensOut:0, tokensCached:0 };
  const mergedSonnet = { ...good, day:"2026-11-02", model:"claude-sonnet-5-5", works:4, finished:2, stopped:2, followups:2, scoreSum:8.5, scoreCount:2, good:2, minutes:14, tokens:2000, costUsd:1, tokensIn:0, tokensOut:0, tokensCached:0 };
  assert.deepEqual(preview.agents, [merged, mergedSonnet], "Settings shows exactly the rows sent; invalid rows and extra fields never leave; two projects' rows merge before rounding up once");
  assert.deepEqual(preview.agentDays, ["2026-11-02"], "only days from install onward (never pre-install days)");
  assert.equal(preview.agentRevision, 1);
  assert.deepEqual(asked.at(-1), { from:"2026-11-02", to:"2026-11-02" });
  assert.equal(await stats.send(), true);
  assert.deepEqual(sent.at(-1).body.agents, preview.agents);
  assert.deepEqual(sent.at(-1).body.agentDays, preview.agentDays);
  assert.equal(sent.at(-1).body.agentRevision, 1);
  assert.equal(await stats.send(), false, "an unchanged day (including today) is not sent again");
  assert.equal(sent.length, 1);
  // New Works/ratings later on the same UTC day replace today atomically via a bumped revision.
  rows = window => each(window, day => [{ ...good, day, works:3, finished:2, scoreSum:5, scoreCount:1 }]);
  assert.equal(await stats.send(), true, "same-day updates re-send today atomically");
  assert.deepEqual(sent.at(-1).body.agentDays, ["2026-11-02"]);
  assert.equal(sent.at(-1).body.agentRevision, 2);
  rows = window => each(window, day => [{ ...good, day }, { ...good, day, runner:"Not Valid" }, { ...good, day, scoreSum:9 }, { ...good, day, title:"secret" }]);
  assert.equal(await stats.send(), true);
  respond(500); advance(1);
  assert.equal(await stats.send(), false);
  respond(204);
  assert.equal(await stats.send(), true, "a server error keeps the day for next time");
  assert.deepEqual(sent.at(-1).body.agentDays, ["2026-11-03"], "unchanged days are not sent again");
  respond(400); advance(1);
  assert.equal(await stats.send(), false);
  respond(204);
  assert.equal(await stats.send(), true, "a refused request keeps its agent days for next time too");
  assert.deepEqual(sent.at(-1).body.agentDays, ["2026-11-04"]);
  stats.setPreferences({ ratingsEnabled:false });
  advance(5);
  assert.deepEqual(stats.report().agents, [], "turning ratings off stops agent rows even while usage counts stay on");
  assert.equal(await stats.send(), false);
  // Re-enabling on Nov 9 must never send days from the opt-out window (Nov 5-8); Nov 9 itself is eligible from re-enable onward.
  rows = window => each(window, day => [{ ...good, day }]);
  stats.setPreferences({ enabled:false, ratingsEnabled:true });
  assert.deepEqual(stats.report().agentDays, ["2026-11-09"], "re-enabling ratings excludes opt-out days and starts at the re-enable day");
  assert.equal(await stats.send(), true, "model ratings send from the re-enable day onward");
  assert.deepEqual(sent.at(-1).body.days, []);
  assert.deepEqual(sent.at(-1).body.agents.map(r => r.day), ["2026-11-09"]);
  advance(1);
  assert.equal(await stats.send(), true);
  assert.deepEqual(sent.at(-1).body.agents.map(r => r.day), ["2026-11-10"]);
});

test("a late rating, a new kind or a deleted Work sends that day again whole, so Cloud replaces it instead of adding (PE-817)", async t => {
  const row = { runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"", works:2, finished:2, failed:0, stopped:0, followups:0, scoreSum:0, scoreCount:0, good:0, bad:0, minutes:10, tokens:1000, costUsd:0, tokensIn:800, tokensOut:200, tokensCached:0 };
  const byDay = { "2026-11-02":[{ ...row, day:"2026-11-02" }], "2026-11-03":[{ ...row, day:"2026-11-03" }] };
  const { stats, sent, advance } = harness(t, { agentRows:({ from, to }) => Object.entries(byDay).filter(([d]) => d >= from && d <= to).flatMap(([, list]) => list) });
  stats.setPreferences({ enabled:false });
  advance(2); // Nov 4: Nov 2 and Nov 3 are completed.
  assert.equal(await stats.send(), true);
  assert.deepEqual(sent.at(-1).body.agentDays, ["2026-11-02", "2026-11-03"]);
  assert.equal(sent.at(-1).body.agentRevision, 1);
  advance(1); // Nov 5.
  // Nov 3's Work got its kind and a rating; Nov 2's Work was deleted; Nov 4 had none.
  byDay["2026-11-03"] = [{ ...row, day:"2026-11-03", kind:"code", scoreSum:4, scoreCount:1 }]; delete byDay["2026-11-02"];
  assert.equal(await stats.send(), true);
  assert.deepEqual(sent.at(-1).body.agentDays, ["2026-11-02", "2026-11-03"], "both changed days go again in full; the unchanged empty day does not");
  assert.deepEqual(sent.at(-1).body.agents, [{ ...row, day:"2026-11-03", kind:"code", scoreSum:4, scoreCount:1 }], "the deleted day goes with no rows, so Cloud clears it");
  assert.equal(sent.at(-1).body.agentRevision, 2);
  advance(1);
  assert.equal(await stats.send(), false, "nothing changed: no request");
  assert.equal(sent.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(stats.file, "utf8")).agentsThrough, "2026-11-05");
});

test("30 days of many results go in several requests of whole days, none cut off, and a failure resends only what was not stored (PE-817)", async t => {
  const row = { runner:"claude", model:"claude-opus-5-5", effort:"high", kind:"code", works:1, finished:1, failed:0, stopped:0, followups:0, scoreSum:5, scoreCount:1, good:1, bad:0, minutes:3, tokens:1000, costUsd:0, tokensIn:800, tokensOut:200, tokensCached:0 };
  const models = Array.from({ length:30 }, (_, i) => `model-${i}`);
  const rowsFor = ({ from, to }) => { const out = []; for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += DAY) for (const model of models) out.push({ ...row, model, day:new Date(at).toISOString().slice(0, 10) }); return out; };
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-"));
  // Existing install opted in on Oct 4: all 29 completed days (Oct 4..Nov 1) are eligible.
  fs.writeFileSync(path.join(stateDirectory, "usage-stats.json"), JSON.stringify({ enabled:false, ratingsEnabled:true, installation:"a".repeat(32), agentsThrough:"2026-10-29", agentsFrom:"2026-10-04" }));
  let failAt = 3, calls = 0;
  const { stats, sent } = harness(t, { stateDirectory, agentRows:rowsFor,
    fetchImpl:async (url, init) => { calls++; const body = JSON.parse(init.body); sent.push({ body, bytes:init.body.length }); return calls === failAt ? { status:503, ok:false } : { status:204, ok:true }; } });
  assert.equal(await stats.send(), false, "the third request failed");
  assert.equal(sent.length, 3);
  for (const { body, bytes } of sent) { assert.ok(body.agents.length <= 200); assert.ok(bytes <= 90_000); assert.deepEqual([...new Set(body.agents.map(r => r.day))], body.agentDays, "whole days only"); }
  const stored = new Set(sent.slice(0, 2).flatMap(({ body }) => body.agentDays));
  assert.equal(sent[0].body.agentDays[0], "2026-10-04", "the window is the 30 days penecho.ai shows: today and 29 completed days before");
  assert.notEqual(JSON.parse(fs.readFileSync(stats.file, "utf8")).agentsThrough, "2026-11-01", "an incomplete send is not complete");
  failAt = 0;
  const before = sent.length;
  assert.equal(await stats.send(), true);
  const resent = sent.slice(before).flatMap(({ body }) => body.agentDays);
  assert.equal(resent.some(day => stored.has(day)), false, "stored days are not sent again");
  const all = [...stored, ...resent].sort();
  assert.equal(all.length, 30); assert.equal(all[0], "2026-10-04"); assert.equal(all.at(-1), "2026-11-02");
  assert.equal(sent.slice(0, 2).concat(sent.slice(before)).reduce((n, { body }) => n + body.agents.length, 0), 900, "every row of every day (including today) arrived");
  assert.equal(JSON.parse(fs.readFileSync(stats.file, "utf8")).agentsThrough, "2026-11-01");
});

test("fresh and legacy state enforce opt-in floors and never retroactively upload earlier days (PE-817)", async t => {
  const row = { runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"code", works:1, finished:1, failed:0, stopped:0, followups:0, scoreSum:5, scoreCount:1, good:1, bad:0, minutes:4, tokens:500, costUsd:0, tokensIn:400, tokensOut:100, tokensCached:0 };
  // 1) Fresh install on 2026-11-02: pre-install Works (Oct 31, Nov 1) must never upload on send() or sendRecent(7); post-install Nov 2 is eligible.
  const fresh = harness(t, { agentRows:({ from, to }) => ["2026-10-31", "2026-11-01", "2026-11-02"].filter(d => d >= from && d <= to).map(day => ({ ...row, day })) });
  fresh.stats.setPreferences({ enabled:false });
  const savedFresh = JSON.parse(fs.readFileSync(fresh.stats.file, "utf8"));
  assert.equal(savedFresh.agentsFrom, "2026-11-02");
  assert.equal(savedFresh.ranOnFrom, "2026-11-02");
  assert.equal(await fresh.stats.send(), true);
  assert.deepEqual(fresh.sent[0].body.agentDays, ["2026-11-02"], "never uploads pre-install Oct 31 or Nov 1");
  const recentFresh = await fresh.stats.sendRecent(7);
  assert.equal(recentFresh.sent, true);
  assert.deepEqual(fresh.sent[1].body.agentDays, ["2026-11-02"], "sendRecent also honors agentsFrom floor");

  // 2) Legacy state with agentsThrough="2026-10-29" and no agentsFrom: floor is next day ("2026-10-30"), never Oct 10 or Oct 29.
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-legacy-floor-"));
  fs.writeFileSync(path.join(legacyDir, "usage-stats.json"), JSON.stringify({ enabled:false, ratingsEnabled:true, installation:"c".repeat(32), agentsThrough:"2026-10-29" }));
  const legacy = harness(t, { stateDirectory:legacyDir, agentRows:({ from, to }) => ["2026-10-10", "2026-10-29", "2026-10-30", "2026-11-01"].filter(d => d >= from && d <= to).map(day => ({ ...row, day })) });
  assert.equal(await legacy.stats.send(), true);
  assert.deepEqual(legacy.sent[0].body.agentDays, ["2026-10-30", "2026-11-01"]);
  assert.equal(JSON.parse(fs.readFileSync(legacy.stats.file, "utf8")).agentsFrom, "2026-10-30");
});

test("oversized single days (>500 rows or >200 KB) are never silently truncated or acknowledged, while 250-row days go whole (PE-817)", async t => {
  const row = { runner:"claude", model:"claude-opus-5-5", effort:"high", kind:"code", works:1, finished:1, failed:0, stopped:0, followups:0, scoreSum:5, scoreCount:1, good:1, bad:0, minutes:3, tokens:1000, costUsd:0, tokensIn:800, tokensOut:200, tokensCached:0 };
  const events = [];
  // 1) A 250-row single day (>200 batch target, <=500 single-day cap) goes in its own whole-day request; leading action counts split off.
  const busy = harness(t, {
    logger:e => events.push(e),
    agentRows:({ from, to }) => from <= "2026-11-02" && to >= "2026-11-02"
      ? Array.from({ length:250 }, (_, i) => ({ ...row, day:"2026-11-02", model:`model-${i}` }))
      : [],
  });
  busy.stats.count("open");
  busy.advance(1);
  assert.equal(await busy.stats.send(), true);
  assert.equal(busy.sent.length, 2, "counts split into request 1 so the 250-row day goes alone");
  assert.equal(busy.sent[0].body.days.length, 1); assert.equal(busy.sent[0].body.agents.length, 0);
  assert.equal(busy.sent[1].body.agents.length, 250); assert.deepEqual(busy.sent[1].body.agentDays, ["2026-11-02"]);

  // 2) A 501-row single day is never truncated or marked sent; valid adjacent days still deliver, agentsThrough stays unadvanced.
  const hugeEvents = [];
  const huge = harness(t, {
    logger:e => hugeEvents.push(e),
    agentRows:({ from, to }) => [
      ...(from <= "2026-11-02" && to >= "2026-11-02" ? Array.from({ length:501 }, (_, i) => ({ ...row, day:"2026-11-02", model:`m-${i}` })) : []),
      ...(from <= "2026-11-03" && to >= "2026-11-03" ? [{ ...row, day:"2026-11-03", model:"ok-model" }] : []),
    ],
  });
  huge.stats.setPreferences({ enabled:false });
  huge.advance(2); // Nov 4.
  assert.equal(await huge.stats.send(), false, "oversized day prevents marking window complete");
  assert.equal(huge.sent.length, 1);
  assert.deepEqual(huge.sent[0].body.agentDays, ["2026-11-03"], "valid day still delivered");
  const savedHuge = JSON.parse(fs.readFileSync(huge.stats.file, "utf8"));
  assert.equal("2026-11-02" in savedHuge.agentsSent, false, "501-row day was not acknowledged as sent");
  assert.equal("2026-11-03" in savedHuge.agentsSent, true);
  assert.notEqual(savedHuge.agentsThrough, "2026-11-03");
  assert.ok(hugeEvents.some(e => e.event === "agent-day-too-large" && e.day === "2026-11-02"));

  // 3) A single day <=500 rows whose JSON exceeds 200,000 bytes is also rejected without truncation or wire send.
  const wide = harness(t, {
    agentRows:({ from, to }) => from <= "2026-11-02" && to >= "2026-11-02"
      ? Array.from({ length:490 }, (_, i) => ({ ...row, day:"2026-11-02", model:`${"x".repeat(70)}-${String(i).padStart(4, "0")}`, effort:"e".repeat(40), tokens:123456789012, tokensIn:123456789000, tokensOut:12, tokensCached:123456789000 }))
      : [],
  });
  wide.stats.setPreferences({ enabled:false });
  wide.advance(1);
  assert.equal(await wide.stats.send(), false);
  assert.equal(wide.sent.length, 0, "over-byte single day is never posted");
  assert.deepEqual(await wide.stats.sendRecent(7), { sent:false, reason:"day-too-large", rows:0 });
});

test("a collection failure aborts without clearing stored Cloud days or advancing state (PE-817)", async t => {
  const row = { day:"2026-11-02", runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"code", works:2, finished:2, failed:0, stopped:0, followups:0, scoreSum:9, scoreCount:2, good:1, bad:0, minutes:10, tokens:1000, costUsd:0, tokensIn:800, tokensOut:200, tokensCached:0 };
  let failCollect = false;
  const { stats, sent, advance } = harness(t, {
    agentRows:({ from, to }) => {
      if (failCollect) throw new Error("disk unreadable");
      return from <= "2026-11-02" && to >= "2026-11-02" ? [row] : [];
    },
  });
  stats.setPreferences({ enabled:false });
  advance(1); // Nov 3.
  assert.equal(await stats.send(), true);
  assert.equal(sent.length, 1);
  const digestBefore = JSON.parse(fs.readFileSync(stats.file, "utf8")).agentsSent["2026-11-02"];
  assert.ok(digestBefore);

  // Next day: collection throws. Must NOT send empty agentDays clearing Nov 2!
  advance(1); // Nov 4.
  failCollect = true;
  assert.equal(await stats.send(), false);
  assert.equal(sent.length, 1, "no clearing request sent on collection error");
  assert.deepEqual(await stats.sendRecent(7), { sent:false, reason:"collect-failed", rows:0 });
  assert.equal(sent.length, 1);
  const saved = JSON.parse(fs.readFileSync(stats.file, "utf8"));
  assert.equal(saved.agentsSent["2026-11-02"], digestBefore, "prior digest preserved");
  assert.equal(saved.agentsThrough, "2026-11-02", "cursor not advanced past failed scan");
});

test("scheduled send() and manual sendRecent() are serialized with strictly increasing agentRevision (PE-817)", async t => {
  const baseRow = { day:"2026-11-02", runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"code", finished:1, failed:0, stopped:0, followups:0, scoreSum:4, scoreCount:1, good:0, bad:0, minutes:5, tokens:500, costUsd:0, tokensIn:400, tokensOut:100, tokensCached:0 };
  let currentWorks = 1, releaseFirst = null, inFlight = 0, maxInFlight = 0;
  const delivered = [];
  const { stats, advance } = harness(t, {
    agentRows:({ from, to }) => from <= "2026-11-02" && to >= "2026-11-02" ? [{ ...baseRow, works:currentWorks, finished:currentWorks, scoreSum:4 * currentWorks, scoreCount:currentWorks }] : [],
    fetchImpl:async (_url, init) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      const body = JSON.parse(init.body);
      if (delivered.length === 0) await new Promise(resolve => { releaseFirst = resolve; });
      delivered.push(body);
      inFlight--;
      return { status:204, ok:true };
    },
  });
  stats.setPreferences({ enabled:false });
  advance(1); // Nov 3.
  const first = stats.send();
  await new Promise(resolve => setImmediate(resolve));
  // Mutate to 2 Works and trigger concurrent sendRecent while send() is still in flight.
  currentWorks = 2;
  const second = stats.sendRecent(7);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(maxInFlight, 1, "sendRecent waits behind active send() instead of racing");
  releaseFirst();
  assert.equal(await first, true);
  assert.equal((await second).sent, true);
  assert.equal(maxInFlight, 1);
  assert.equal(delivered.length, 2);
  assert.equal(delivered[0].agents[0].works, 1); assert.equal(delivered[0].agentRevision, 1);
  assert.equal(delivered[1].agents[0].works, 2); assert.equal(delivered[1].agentRevision, 2);
  // Next day: Local digest matches the 2-Work snapshot that committed last on Cloud.
  advance(1);
  assert.equal(await stats.send(), false);
  assert.equal(delivered.length, 2);
});

test("an in-flight ratings send cannot overwrite state after an off/on cycle", async t => {
  const row = { runner:"codex", model:"gpt-6.1-sol", effort:"high", kind:"code", works:2, finished:2, failed:0, stopped:0, followups:0, scoreSum:9, scoreCount:2, good:1, bad:0, minutes:20, tokens:1000, costUsd:0, tokensIn:800, tokensOut:200, tokensCached:0 };
  let finishFetch = null, aborted = false;
  const { stats, advance } = harness(t, {
    origin:() => "https://penecho.example",
    agentRows:window => [{ ...row, day:window.to }],
    fetchImpl:(_url, init) => new Promise(resolve => {
      init.signal?.addEventListener("abort", () => { aborted = true; });
      finishFetch = () => resolve({ status:204, ok:true });
    }),
  });
  advance(1); // Nov 3 so Nov 2 is eligible for sendRecent.
  const pending = stats.sendRecent(7);
  await new Promise(resolve => setImmediate(resolve));
  // Toggle ratings off then back on while counts stay on (preserving installation id).
  stats.setPreferences({ ratingsEnabled:false });
  assert.equal(aborted, true, "opting out aborts an in-flight ratings send");
  stats.setPreferences({ ratingsEnabled:true });
  const cursorAfterReenable = JSON.parse(fs.readFileSync(stats.file, "utf8")).agentsThrough;
  finishFetch();
  await pending;
  assert.equal(JSON.parse(fs.readFileSync(stats.file, "utf8")).agentsThrough, cursorAfterReenable, "stale response cannot move the new ratings cursor backward");
});

test("the person can send their last 7 days of agent results now, as whole days", async t => {
  const asked = [], row = { runner:"codex", model:"gpt-6.1-sol", effort:"high", kind:"code", works:2, finished:2, failed:0, stopped:0, followups:0, scoreSum:9, scoreCount:2, good:1, bad:0, minutes:20, tokens:1000, costUsd:0, tokensIn:800, tokensOut:200, tokensCached:0 };
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-usage-"));
  fs.writeFileSync(path.join(stateDirectory, "usage-stats.json"), JSON.stringify({ enabled:true, ratingsEnabled:true, installation:"b".repeat(32), agentsThrough:"2026-10-20" }));
  const { stats, sent } = harness(t, { stateDirectory, origin:() => "https://penecho.example", agentRows:window => { asked.push(window); return [{ ...row, day:window.to }]; } });
  stats.setPreferences({ enabled:false });
  const result = await stats.sendRecent(7);
  assert.equal(result.sent, true); assert.equal(result.rows, 1);
  assert.deepEqual(asked.at(-1), { from:"2026-10-26", to:"2026-11-02" }, "the last 7 completed days plus today");
  assert.equal(sent.length, 1); assert.equal(sent[0].body.agents.length, 1); assert.deepEqual(sent[0].body.agentDays, ["2026-11-02"]);
  assert.deepEqual(sent[0].body.days, [], "days stay empty when usage counts are off");
  assert.equal(await stats.send(), false, "the daily send covers the 30-day window but has nothing new to send");
  assert.equal(sent.length, 1, "a day already stored is not sent again");
  assert.equal(JSON.parse(fs.readFileSync(stats.file, "utf8")).agentsThrough, "2026-11-01");
  stats.setPreferences({ ratingsEnabled:false });
  assert.equal((await stats.sendRecent(7)).sent, false, "never while model ratings are off");
});

test("a signed-in app sends its account token only to its own Cloud", async t => {
  const calls = [];
  const make = origin => harness(t, { origin:() => "https://penecho.example", account:() => ({ origin, token:"tok123" }),
    fetchImpl:async (url, init) => { calls.push(init.headers); return { status:204, ok:true }; } });
  const same = make("https://penecho.example");
  same.stats.count("open"); same.advance(1); await same.stats.send();
  assert.equal(calls.at(-1).authorization, "Bearer tok123");
  const other = make("https://elsewhere.example");
  other.stats.count("open"); other.advance(1); await other.stats.send();
  assert.equal(calls.at(-1).authorization, undefined, "never to another address");
});

test("the preview and both upload paths exclude default effort and PenEcho while preserving explicit-effort ratings and action counts", async t => {
  const bareUuid = "3ea3e82e-095e-4aa1-9c93-9eed1b963810";
  const prefixedUuid = "external/d460c354-bffd-44e3-82bf-ca5c1d7e4691";
  const withoutEffort = { day:"2026-11-02", runner:"codex", model:"gpt-6.2-sol", kind:"code", works:2, finished:2, failed:0, stopped:0, followups:0, scoreSum:9, scoreCount:2, good:1, bad:0, minutes:10, tokens:1000, costUsd:0, tokensIn:800, tokensOut:200, tokensCached:100 };
  const base = { ...withoutEffort, effort:"high" };
  const codexUuid = { ...base, model:bareUuid, effort:"xhigh", scoreSum:10, good:2 };
  const claudeUuid = { ...base, runner:"claude", model:prefixedUuid, effort:"medium", scoreSum:7, good:0, bad:1 };
  const rows = [
    withoutEffort,
    ...[undefined, "", "   ", "default", "DEFAULT", " DeFaUlT "].map(effort => ({ ...withoutEffort, effort })),
    base,
    { ...base, runner:"penecho", model:bareUuid, effort:"max" },
    { ...base, runner:"penecho", model:"deepseek-4.1-flash", effort:"max" },
    codexUuid,
    claudeUuid,
  ];
  const { stats, sent, advance } = harness(t, { origin:() => "https://penecho.example", agentRows:({ from, to }) => rows.filter(({ day }) => day >= from && day <= to) });
  for (const runner of ["penecho", "codex", "pi", "omp"]) stats.workRun(runner);
  advance(1); // Nov 3: Nov 2 is complete.
  const expectedAgents = [
    { ...claudeUuid, model:"d460c354-bffd-44e3-82bf-ca5c1d7e4691" },
    codexUuid,
    base,
  ];
  const preview = stats.report();
  assert.deepEqual(preview.agents, expectedAgents);
  assert.deepEqual(preview.days, [{ day:"2026-11-02", counts:{ "work-run":4, "run-penecho":1, "run-codex":1, "run-pi":1, "run-omp":1 } }]);
  assert.deepEqual(stats.status().report, preview, "Settings shows the filtered report");

  assert.equal(await stats.send(), true);
  assert.deepEqual(sent[0].body, preview, "scheduled upload keeps action counts, ratings, votes and tokens");

  const recent = await stats.sendRecent(7);
  assert.equal(recent.sent, true);
  assert.equal(recent.rows, expectedAgents.length);
  assert.deepEqual(sent[1].body.agents, expectedAgents, "manual resend keeps the same ratings, votes and tokens");

  // Regression check: when a third-party UUID row is the only rating (with usage counts off), both send paths still upload it.
  const solo = harness(t, { origin:() => "https://penecho.example", agentRows:window => [{ ...codexUuid, day:window.to }] });
  solo.stats.setPreferences({ enabled:false });
  solo.advance(1);
  assert.equal(await solo.stats.send(), true);
  assert.equal(solo.sent.length, 1);
  assert.equal(solo.sent[0].body.agents[0].model, bareUuid);
  const soloRecent = await solo.stats.sendRecent(7);
  assert.equal(soloRecent.sent, true);
  assert.equal(solo.sent.length, 2);
  assert.equal(solo.sent[1].body.agents[0].model, bareUuid);
});

test("a default-effort-only window advances the scheduled cursor without uploading when counts are off", async t => {
  const row = { runner:"codex", model:"gpt-6.2-sol", effort:"default", kind:"code", works:1, finished:1, failed:0, stopped:0, followups:0, scoreSum:5, scoreCount:1, good:1, bad:0, minutes:2, tokens:15, costUsd:0, tokensIn:10, tokensOut:5, tokensCached:0 };
  const { stats, sent, advance } = harness(t, { agentRows:({ to }) => [{ ...row, day:to }] });
  stats.setPreferences({ enabled:false });
  const cursor = () => JSON.parse(fs.readFileSync(stats.file, "utf8")).agentsThrough;
  assert.equal(cursor(), "");

  advance(1);
  assert.equal(await stats.send(), false);
  assert.equal(cursor(), "2026-11-02");
  assert.deepEqual(await stats.sendRecent(7), { sent:false, reason:"nothing", rows:0 });
  assert.equal(sent.length, 0);
});

test("explicit OpenCode variant names survive validation while malformed efforts and non-string identities are rejected", async t => {
  const base = { day:"2026-11-02", runner:"opencode", model:"openai/gpt-6.2-sol", kind:"code", works:1, finished:1, failed:0, stopped:0, followups:0, scoreSum:5, scoreCount:1, good:1, bad:0, minutes:4, tokens:500, costUsd:0, tokensIn:400, tokensOut:100, tokensCached:0 };
  const rows = [
    { ...base, effort:"high-v2" },
    { ...base, effort:"High-V2" },
    { ...base, effort:"medium_2" },
    { ...base, effort:"low.1" },
    { ...base, effort:"high" },
    { ...base, effort:"" },
    { ...base, effort:null },
    { ...base, effort:123 },
    { ...base, effort:"-high" },
    { ...base, effort:"high!" },
    { ...base, effort:"high\n" },
    { ...base, effort:"  high  " },
    { ...base, runner:["opencode"], effort:"high" },
    { ...base, runner:null, effort:"high" },
    { ...base, model:["openai/gpt-6.2-sol"], effort:"high" },
    ...["", "   ", "default", "magpie/Auto/DeFaUlT", "provider/"].map(model => ({ ...base, model, effort:"high" })),
  ];
  const { stats, sent, advance } = harness(t, { origin:() => "https://penecho.example", agentRows:({ from, to }) => rows.filter(({ day }) => day >= from && day <= to) });
  stats.setPreferences({ enabled:false });
  advance(1); // Nov 3.
  const preview = stats.report();
  assert.deepEqual(preview.agents.map(r => [r.effort, r.works]), [["high", 1], ["high-v2", 2], ["low.1", 1], ["medium_2", 1]], "High-V2 and high-v2 are one pairing");
  assert.ok(preview.agents.every(r => r.model === "gpt-6.2-sol"));
  assert.equal(await stats.send(), true);
  assert.deepEqual(sent[0].body.agents, preview.agents);
  const recent = await stats.sendRecent(7);
  assert.equal(recent.sent, true);
  assert.deepEqual(sent[1].body.agents, preview.agents);
});

test("shared project across two installs uploads each Work only from the install that ran it while local Statistics keeps all Works (PE-817)", t => {
  const { Service } = require("../src/server/project-lines/service.js");
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-ran-on-"));
  const dirA = path.join(root, "state-a"), dirB = path.join(root, "state-b"), docs = path.join(root, "docs");
  const svcA = new Service({ directory:dirA, agents:{ available:() => [] }, keepAgents:false });
  const svcB = new Service({ directory:dirB, agents:{ available:() => [] }, keepAgents:false });
  t.after(() => { svcA.close(); svcB.close(); fs.rmSync(root, { recursive:true, force:true }); });
  assert.notEqual(svcA.originId, svcB.originId);
  const projA = svcA.store.create({ name:"Shared", docsPath:docs });
  const projB = svcB.store.importFolder({ docsPath:docs });
  fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
  fs.mkdirSync(path.join(docs, "works", "shared-line"), { recursive:true });
  const orchA = createOrchestrator({ service:svcA, directory:dirA });
  const orchB = createOrchestrator({ service:svcB, directory:dirB });
  fs.writeFileSync(path.join(docs, "lines", "shared-line.md"),
    "---\nid: PE-1\nstatus: done\nwho: @codex\ncreated: 2026-11-02 10:00\n---\n\n# Shared\n\n## Ask · 2026-11-02 10:00\n\nDo it\n\n## [x] Work 1 · @codex · 2 min\n\nDone\n\n[Details](../works/shared-line/work-1.md)\n\n## [x] Work 2 · @codex · 2 min\n\nLegacy\n\n[Details](../works/shared-line/work-2.md)\n");
  fs.writeFileSync(path.join(docs, "works", "shared-line", "work-1.md"),
    `---\nline: ../../lines/shared-line.md\nstep: Work 1\nwho: @codex\nstarted: 2026-11-02 10:00\nended: 2026-11-02 10:02\nran on: ${svcA.originId}\nmodel: gpt-6.2-sol\neffort: xhigh\nrating: good\n---\n\n# Work 1\n`);
  fs.writeFileSync(path.join(docs, "works", "shared-line", "work-2.md"),
    "---\nline: ../../lines/shared-line.md\nstep: Work 2\nwho: @codex\nstarted: 2026-11-02 10:05\nended: 2026-11-02 10:07\nmodel: gpt-6.2-sol\neffort: xhigh\nrating: good\n---\n\n# Work 2\n");
  // Record local step-level provenance ONLY on install A (as happens when install A actually ran Work 2 before upgrade).
  svcA.stepPresets.set(`${svcA.key(projA, "shared-line")}:work-2`, "preset-1");
  // Local Statistics on BOTH installs sees both Works (unfiltered).
  assert.equal(orchA.index().works, 2);
  assert.equal(orchB.index().works, 2);
  // Upgraded install A sees Work 1 (ran on A) + legacy Work 2 (step-level provenance on A).
  const rowsA = orchA.agentDays(projA, { from:"2026-11-01", to:"2026-11-03", ranOn:svcA.originId, requireRanOnFrom:"2026-11-03", strict:true });
  assert.equal(rowsA.reduce((n, r) => n + r.works, 0), 2);
  // Upgraded legacy install B (even BEFORE requireRanOnFrom!) has NO provenance for Work 2 and wrong ranOn for Work 1 -> 0!
  const rowsBUpgraded = orchB.agentDays(projB, { from:"2026-11-01", to:"2026-11-03", ranOn:svcB.originId, requireRanOnFrom:"2026-11-03", strict:true });
  assert.equal(rowsBUpgraded.length, 0, "two upgraded legacy installs never double-count an unstamped shared Work");
  // Same-day opt-in timestamp excludes morning Works started before opt-in!
  const work1Start = Date.parse("2026-11-02T10:00:00");
  const afterMorning = orchA.agentDays(projA, { from:"2026-11-01", to:"2026-11-03", fromAt:work1Start + 3 * 60_000, ranOn:svcA.originId, requireRanOnFrom:"2026-11-03", strict:true });
  assert.equal(afterMorning.reduce((n, r) => n + r.works, 0), 1, "Work started before opt-in timestamp is excluded even on the same UTC day");
  // Strict scan propagates transient EIO instead of swallowing and producing an empty replacement!
  const origRead = svcA.store.readText.bind(svcA.store);
  svcA.store.readText = (p, rel) => { if (rel.endsWith("shared-line.md")) throw Object.assign(new Error("EIO"), { code:"EIO" }); return origRead(p, rel); };
  assert.throws(() => orchA.agentDays(projA, { from:"2026-11-01", to:"2026-11-03", ranOn:svcA.originId, strict:true }), /EIO/);
});

test("lost 204 followed by Work deletion reconciles via agentsPending, 409 syncs minRevision, 429 keeps counts, and mid-batch opt-out stops next POST (PE-817)", async t => {
  const row = { day:"2026-11-02", runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"code", works:1, finished:1, failed:0, stopped:0, followups:0, scoreSum:5, scoreCount:1, good:1, bad:0, minutes:5, tokens:500, costUsd:0, tokensIn:400, tokensOut:100, tokensCached:0 };
  // 1) Lost 204 followed by Work deletion before next scan still sends empty clearing report!
  let rows = [row], mode = "drop";
  const del = harness(t, {
    agentRows:({ from, to }) => rows.filter(r => r.day >= from && r.day <= to),
    fetchImpl:async (_url, init) => {
      const body = JSON.parse(init.body);
      del.sent.push({ body });
      if (mode === "drop") { mode = "ok"; throw new Error("lost 204 after commit"); }
      return { status:204, ok:true };
    },
  });
  del.stats.setPreferences({ enabled:false });
  del.advance(1); // Nov 3.
  assert.equal(await del.stats.send(), false, "first attempt loses 204");
  assert.deepEqual(JSON.parse(fs.readFileSync(del.stats.file, "utf8")).agentsPending, ["2026-11-02"]);
  rows = []; // Work deleted before next scan!
  assert.equal(await del.stats.send(), true, "reconciles uncertain pending day even though now empty");
  assert.deepEqual(del.sent.at(-1).body.agentDays, ["2026-11-02"]);
  assert.deepEqual(del.sent.at(-1).body.agents, [], "sends empty clearing report so Cloud deletes the committed Work");
  assert.equal(del.sent.at(-1).body.agentRevision, 2);
  assert.equal(JSON.parse(fs.readFileSync(del.stats.file, "utf8")).agentsPending, undefined);

  // 2) 409 stale_revision does not mark day sent and syncs minRevision so next send succeeds; 429 retains feature counts.
  let status = 429, conflictOnce = true;
  const retry = harness(t, {
    agentRows:({ from, to }) => from <= "2026-11-02" && to >= "2026-11-02" ? [row] : [],
    fetchImpl:async (_url, init) => {
      const body = JSON.parse(init.body);
      retry.sent.push({ body });
      if (status === 429) { status = 409; return { status:429, ok:false }; }
      if (conflictOnce) { conflictOnce = false; return { status:409, ok:false, json:async () => ({ error:"stale_revision", minRevision:5 }) }; }
      return { status:204, ok:true };
    },
  });
  retry.stats.count("open");
  retry.advance(1);
  assert.equal(await retry.stats.send(), false, "429 fails without discarding counts");
  assert.equal(retry.stats.report().days.length, 1, "feature counts kept on 429");
  assert.equal(await retry.stats.send(), false, "409 fails without acknowledging skipped revision");
  assert.equal(retry.stats.report().days.length, 1, "feature counts kept on 409");
  assert.equal(JSON.parse(fs.readFileSync(retry.stats.file, "utf8")).agentRevision, 5, "synced to Cloud minRevision");
  assert.equal(await retry.stats.send(), true, "next send uses revision 6 and succeeds");
  assert.equal(retry.sent.at(-1).body.agentRevision, 6);
  assert.equal(retry.stats.report().days.length, 0);

  // 3) Turning ratings off during batch 1 of a 2-batch send prevents batch 2 even if batch 1 resolves!
  const multiDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-optout-batch-"));
  fs.writeFileSync(path.join(multiDir, "usage-stats.json"), JSON.stringify({ enabled:false, ratingsEnabled:true, installation:"f".repeat(32), agentsThrough:"2026-10-20", agentsFrom:"2026-10-25" }));
  let batchCalls = 0, releaseFirst = null;
  const multi = harness(t, {
    stateDirectory:multiDir,
    agentRows:({ from, to }) => {
      const out = [];
      for (const d of ["2026-10-26", "2026-10-27", "2026-10-28"]) if (d >= from && d <= to) for (let i = 0; i < 120; i++) out.push({ ...row, day:d, model:`m-${i}` });
      return out;
    },
    fetchImpl:async (_url, init) => {
      batchCalls++;
      if (batchCalls === 1) await new Promise(resolve => { releaseFirst = resolve; });
      return { status:204, ok:true };
    },
  });
  const pending = multi.stats.send();
  await new Promise(resolve => setImmediate(resolve));
  multi.stats.setPreferences({ ratingsEnabled:false });
  releaseFirst(); // First fetch resolves despite abort signal: second batch must STILL be blocked!
  assert.equal(await pending, false);
  assert.equal(batchCalls, 1, "second ratings batch must never be sent after ratings opt-out");
});

test("ratings preview and uploads merge legacy Code kinds, fold legacy Other to uncategorized, and exclude Review rows", async t => {
  const kinds = ["code", "chat", "design", "research", "docs"];
  const row = { day:"2026-11-02", runner:"codex", model:"gpt-6.2-sol", effort:"high",
    works:1, finished:1, failed:0, stopped:0, followups:0, scoreSum:4, scoreCount:1, good:0, bad:0, minutes:2, tokens:100, costUsd:0 };
  const { stats, sent, advance } = harness(t, {
    agentRows:() => [...kinds, "", "other", " OTHER ", " Fix ", "test", " REVIEW ", "unknown", 0].map(kind => ({ ...row, kind })),
  });
  advance(1);
  const preview = stats.status().report.agents;
  assert.deepEqual(preview.map(r => r.kind), ["", ...kinds].sort());
  const code = preview.find(r => r.kind === "code");
  assert.deepEqual([code.works, code.scoreSum, code.scoreCount, code.minutes], [3, 12, 3, 6]);
  const uncategorized = preview.find(r => r.kind === "");
  assert.deepEqual([uncategorized.works, uncategorized.scoreSum, uncategorized.scoreCount], [3, 12, 3]);
  assert.equal(await stats.send(), true);
  assert.deepEqual(sent.at(-1).body.agents, preview);
});

test("Round 3 regressions: strict Work-detail EIO, 201 attachments, rating-only provenance, exact ms start time, day-30 pending rollover, and mixed-batch 400 count retention (PE-817)", async t => {
  const { Service } = require("../src/server/project-lines/service.js");
  const { createOrchestrator } = require("../src/server/project-lines/orchestrator.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-r3-regressions-"));
  const dirA = path.join(root, "state-a"), dirB = path.join(root, "state-b"), docs = path.join(root, "docs");
  const svcA = new Service({ directory:dirA, agents:{ available:() => [] }, keepAgents:false });
  const svcB = new Service({ directory:dirB, agents:{ available:() => [] }, keepAgents:false });
  t.after(() => { svcA.close(); svcB.close(); fs.rmSync(root, { recursive:true, force:true }); });
  const projA = svcA.store.create({ name:"R3", docsPath:docs });
  const projB = svcB.store.importFolder({ docsPath:docs });
  fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
  fs.mkdirSync(path.join(docs, "works", "r3-line"), { recursive:true });
  fs.mkdirSync(path.join(docs, "files", "r3-line"), { recursive:true });
  const orchA = createOrchestrator({ service:svcA, directory:dirA });
  const orchB = createOrchestrator({ service:svcB, directory:dirB });

  // 1) Add 205 unrelated attachments in files/ (above FOLDER_SHARE = 200) + 1 unstamped Work + 2 works separated by 40s.
  for (let i = 0; i < 205; i++) fs.writeFileSync(path.join(docs, "files", "r3-line", `att-${i}.txt`), "x");
  fs.writeFileSync(path.join(docs, "lines", "r3-line.md"),
    "---\nid: PE-10\nstatus: done\nwho: @codex\ncreated: 2026-11-02 10:00\n---\n\n# R3\n\n## Ask · 2026-11-02 10:00\n\nDo it\n\n"
    + "## [x] Work 1 · @codex · 2 min\n\nDone 1\n\n[Details](../works/r3-line/work-1.md)\n\n"
    + "## [x] Work 2 · @codex · 2 min\n\nDone 2\n\n[Details](../works/r3-line/work-2.md)\n\n"
    + "## [x] Work 3 · @codex · 2 min\n\nLegacy unstamped\n\n[Details](../works/r3-line/work-3.md)\n");
  fs.writeFileSync(path.join(docs, "works", "r3-line", "work-1.md"),
    `---\nline: ../../lines/r3-line.md\nstep: Work 1\nwho: @codex\nstarted: 2026-11-02 10:00\nstarted at: 2026-11-02T10:00:05.000Z\nended: 2026-11-02 10:02\nran on: ${svcA.originId}\nmodel: gpt-6.2-sol\neffort: xhigh\nrating: good\n---\n\n# Work 1\n`);
  fs.writeFileSync(path.join(docs, "works", "r3-line", "work-2.md"),
    `---\nline: ../../lines/r3-line.md\nstep: Work 2\nwho: @codex\nstarted: 2026-11-02 10:00\nstarted at: 2026-11-02T10:00:45.000Z\nended: 2026-11-02 10:02\nran on: ${svcA.originId}\nmodel: gpt-6.2-sol\neffort: xhigh\nrating: good\n---\n\n# Work 2\n`);
  fs.writeFileSync(path.join(docs, "works", "r3-line", "work-3.md"),
    "---\nline: ../../lines/r3-line.md\nstep: Work 3\nwho: @codex\nstarted: 2026-11-02 10:05\nended: 2026-11-02 10:07\nmodel: gpt-6.2-sol\neffort: xhigh\nrating: good\n---\n\n# Work 3\n");
  svcA.stepPresets.set(`${svcA.key(projA, "r3-line")}:work-3`, "preset-1");

  // S3: 205 attachments must NEVER cause strict scan to truncate or fail!
  const allA = orchA.agentDays(projA, { from:"2026-11-01", to:"2026-11-03", ranOn:svcA.originId, requireRanOnFrom:"2026-11-03", strict:true });
  assert.equal(allA.reduce((n, r) => n + r.works, 0), 3, "205 attachments do not break strict rating scan");

  // B5: Opt-in at 10:00:25Z excludes Work 1 (10:00:05Z, 20s before) and INCLUDES Work 2 (10:00:45Z, 20s after)!
  const optInMs = Date.parse("2026-11-02T10:00:25.000Z");
  const afterOptIn = orchA.agentDays(projA, { from:"2026-11-01", to:"2026-11-03", fromAt:optInMs, ranOn:svcA.originId, requireRanOnFrom:"2026-11-03", strict:true });
  assert.equal(afterOptIn.reduce((n, r) => n + r.works, 0), 2, "Work started 20s after opt-in is included while Work 20s before is excluded");
  // Also verify startDetail writes exact ISO `started at` front matter!
  const doc = require("../src/server/project-lines/format.js").parseLine(svcA.readDoc(projA, "r3-line"));
  svcA.startDetail(projA, "r3-line", { id:"work-4", label:"Work 4", kind:"work" }, "codex", doc);
  const w4Front = require("../src/server/project-lines/format.js").splitFront(svcA.store.readText(projA, "works/r3-line/work-4.md").text).front;
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(w4Front["started at"] || ""), "startDetail persists exact ISO started at");

  // B2: Install B ONLY rates unstamped Work 3 through Orchestrator (creating a record in B's orchestrator/records.json) -> STILL 0 owned!
  orchB.call(projB, { do:"rate", line:"r3-line", work:"work-3", score:5, note:"Rated on B", kind:"code" });
  const rowsB = orchB.agentDays(projB, { from:"2026-11-01", to:"2026-11-03", ranOn:svcB.originId, requireRanOnFrom:"2026-11-03", strict:true });
  assert.equal(rowsB.length, 0, "rating an unstamped Work on install B never confers execution ownership");

  // B1: EIO injected at Work-detail existence check (store.resolve) must propagate instead of silently dropping the Work!
  const origResolve = svcA.store.resolve.bind(svcA.store);
  svcA.store.resolve = (p, rel, opts) => { if (String(rel).endsWith("work-1.md")) throw Object.assign(new Error("EIO detail"), { code:"EIO" }); return origResolve(p, rel, opts); };
  assert.throws(() => orchA.agentDays(projA, { from:"2026-11-01", to:"2026-11-03", ranOn:svcA.originId, strict:true }), /EIO detail/);
  svcA.store.resolve = origResolve;

  // B4: Day-30 manual upload with lost 204 survives restart AND day rollover, reconciling an empty deletion!
  const day30Dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-day30-"));
  t.after(() => fs.rmSync(day30Dir, { recursive:true, force:true }));
  let now30 = Date.UTC(2026, 11, 2, 12); // 2026-12-02 -> 30 days ago is 2026-11-02!
  const day30 = "2026-11-02";
  fs.writeFileSync(path.join(day30Dir, "usage-stats.json"), JSON.stringify({ enabled:false, ratingsEnabled:true, installation:"d".repeat(32), agentsThrough:"2026-12-01", agentsFrom:"2026-10-01", agentsSent:{} }));
  const row30 = { day:day30, runner:"codex", model:"gpt-6.2-sol", effort:"xhigh", kind:"code", works:1, finished:1, failed:0, stopped:0, followups:0, scoreSum:5, scoreCount:1, good:1, bad:0, minutes:5, tokens:500, costUsd:0, tokensIn:400, tokensOut:100, tokensCached:0 };
  let rows30 = [row30], sent30 = [];
  const firstRun = createUsageStats({
    stateDirectory:day30Dir, origin:() => "https://penecho.example", now:() => now30,
    agentRows:({ from, to }) => rows30.filter(r => r.day >= from && r.day <= to),
    fetchImpl:async (_url, init) => { sent30.push(JSON.parse(init.body)); throw new Error("lost 204"); },
  });
  const manualRes = await firstRun.sendRecent(30);
  assert.equal(manualRes.sent, false);
  assert.deepEqual(sent30[0].agentDays, [day30]);
  firstRun.close();
  // Restart the next day (day30 is now 31 days ago!) AND the Work was deleted locally!
  now30 += DAY;
  rows30 = [];
  const restarted = createUsageStats({
    stateDirectory:day30Dir, origin:() => "https://penecho.example", now:() => now30,
    agentRows:({ from, to }) => rows30.filter(r => r.day >= from && r.day <= to),
    fetchImpl:async (_url, init) => { sent30.push(JSON.parse(init.body)); return { status:204, ok:true }; },
  });
  t.after(() => restarted.close());
  assert.equal(await restarted.send(), true, "restarted app reconciles aged day-30 pending day");
  assert.deepEqual(sent30.at(-1).agentDays, [day30], "sends empty clearing replacement ONLY for the unresolved pending day");
  assert.deepEqual(sent30.at(-1).agents, []);
  assert.equal(JSON.parse(fs.readFileSync(restarted.file, "utf8")).agentsPending, undefined);

  // Mixed counts+agents 400 must NOT discard valid feature counts!
  const mix = harness(t, {
    agentRows:({ from, to }) => from <= "2026-11-02" && to >= "2026-11-02" ? [row30] : [],
    fetchImpl:async (_url, init) => { mix.sent.push(JSON.parse(init.body)); return { status:400, ok:false }; },
  });
  mix.stats.count("open");
  mix.advance(1);
  assert.equal(await mix.stats.send(), false);
  assert.equal(mix.stats.report().days.length, 1, "valid feature counts are retained when a mixed counts+agents POST gets 400");

  // Round 4 B1: EIO during unmarked legacy topics/ layout detection must propagate in strict walk/scan!
  const v1Docs = path.join(root, "v1-docs");
  fs.mkdirSync(path.join(v1Docs, "topics"), { recursive:true });
  fs.writeFileSync(path.join(v1Docs, "topics", "old-line.md"), "---\nid: PE-99\nstatus: done\n---\n\n# Old\n");
  const v1Proj = { id:"pv1", docsPath:v1Docs };
  const origReaddir = fs.readdirSync;
  fs.readdirSync = (p, opts) => {
    if (String(p) === path.join(v1Docs, "topics")) throw Object.assign(new Error("EIO topics"), { code:"EIO" });
    return origReaddir(p, opts);
  };
  try {
    assert.throws(() => svcA.store.walk(v1Proj, { strict:true, ratingOnly:true }), /EIO topics/);
  } finally {
    fs.readdirSync = origReaddir;
  }

  // Round 4 S3: Day-30 oversized day (>500 rows) enters agentsPending, survives rollover without advancing agentsThrough,
  // and uploads cleanly once its row count fits!
  const bigDir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-oversized-rollover-"));
  t.after(() => fs.rmSync(bigDir, { recursive:true, force:true }));
  let bigNow = Date.UTC(2026, 11, 2, 12); // 2026-12-02 -> day30 is 2026-11-02
  fs.writeFileSync(path.join(bigDir, "usage-stats.json"), JSON.stringify({ enabled:false, ratingsEnabled:true, installation:"e".repeat(32), agentsThrough:"2026-12-01", agentsFrom:"2026-10-01", agentsSent:{} }));
  let bigCount = 501, bigSent = [];
  const makeBig = () => createUsageStats({
    stateDirectory:bigDir, origin:() => "https://penecho.example", now:() => bigNow,
    agentRows:({ from, to }) => from <= day30 && to >= day30 ? Array.from({ length:bigCount }, (_, i) => ({ ...row30, model:`m-${i}` })) : [],
    fetchImpl:async (_url, init) => { bigSent.push(JSON.parse(init.body)); return { status:204, ok:true }; },
  });
  const big1 = makeBig();
  assert.equal((await big1.sendRecent(30)).reason, "day-too-large");
  assert.deepEqual(JSON.parse(fs.readFileSync(big1.file, "utf8")).agentsPending, [day30], "oversized day enters agentsPending");
  big1.close();
  bigNow += DAY; // Roll past day 30!
  const big2 = makeBig();
  assert.equal(await big2.send(), false, "oversized pending day does not advance cursor on rollover");
  assert.equal(JSON.parse(fs.readFileSync(big2.file, "utf8")).agentsThrough, "2026-12-01");
  bigCount = 2; // Once rows fit, rollover reconciliation delivers day30!
  assert.equal(await big2.send(), true);
  assert.deepEqual(bigSent.at(-1).agentDays, [day30]);
  assert.equal(bigSent.at(-1).agents.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(big2.file, "utf8")).agentsPending, undefined);
  big2.close();
});
