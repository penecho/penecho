"use strict";
// Anonymous daily action counts and anonymous agent/model ratings, both on by default and controlled from Projects Settings.
// Only fixed action names, runner ids, model names, ratings and registered MCP tool names are kept:
// never project or Line names, files, prompts, drawings, paths or account details.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { concreteModel } = require("../../public/lines/work-pricing.js");

const DAY_MS = 86_400_000, KEEP_FINISHED_DAYS = 30, MAX_REPORT_DAYS = 31, MAX_FEATURES = 64;
// On start: send once within FIRST_SEND_MS, at a moment when no agent is running (checked every IDLE_CHECK_MS; at the
// deadline it sends anyway), and only if something is unsent. Then once a day while the app stays open (owner, PE-742).
// Agent results: every completed day of the last KEEP_FINISHED_DAYS (the window penecho.ai shows) whose results changed
// since they were last sent, in requests of whole days that Cloud stores atomically as replacements of those days (PE-817).
const MAX_AGENT_ROWS = 200, MAX_DAY_ROWS = 500, MAX_REPORT_BYTES = 90_000, MAX_DAY_BYTES = 200_000;
const FIRST_SEND_MS = 5 * 60_000, IDLE_CHECK_MS = 30_000, SEND_EVERY_MS = 24 * 3_600_000, SAVE_EVERY_MS = 2_000, SEND_TIMEOUT_MS = 10_000;
const USAGE_ANNOTATIONS = Symbol.for("penecho.usage-stats.keys");
// Keep in step with LOCAL_FEATURES in PenEcho Cloud's src/services/feature-use.mjs.
const USAGE_KEYS = new Set([
  "open", "canvas-new", "canvas-ai", "suggestions", "plugin-install", "plugin-improve", "liveclay", "live-link", "slides-download", "model-connection", "agent-folder",
  "cloud-sign-in", "device-link", "cloud-project", "project-share", "project-sync",
  "project-new", "line-new", "line-ask", "line-steer", "work-run", "work-stop", "work-review", "work-rate", "line-todo", "line-archive", "line-merge", "line-answer", "line-note", "project-search", "project-ask", "agent-preset", "settings-change",
  "orchestrator-job", "orchestrator-task",
]);
const USAGE_ROUTES = new Map([
  ["POST /api/ai/command", "canvas-ai"],
  ["POST /api/canvases", "canvas-new"],
  ["POST /api/cloud/live/links", "live-link"],
  ["POST /api/cloud/projects", "cloud-project"],
  ["POST /api/canvas-agent/projects", "agent-folder"],
  ["POST /api/canvas-agent/projects/from-root", "agent-folder"],
  ["POST /api/canvas-agent/projects/from-host-root", "agent-folder"],
  ["POST /api/plugins", "plugin-install"],
  ["POST /api/plugins/improve", "plugin-improve"],
  ["POST /api/playground/liveclay", "liveclay"],
  ["POST /api/suggest", "suggestions"],
  ["POST /api/settings/connections", "model-connection"],
  ["POST /api/settings", "settings-change"],
  ["POST /api/suggest/preferences", "settings-change"],
  ["POST /api/local-access/network", "settings-change"],
  ["POST /api/local-access/setup-pin", "settings-change"],
  ["POST /api/local-access/open", "settings-change"],
  ["POST /api/mcp/configure", "settings-change"],
  ["POST /api/mcp/http", "settings-change"],
  ["POST /api/mcp/ip-direct", "settings-change"],
  ["POST /api/lines/computer", "settings-change"],
  ["POST /api/lines/agents/skill", "settings-change"],
]);
const INSTALLATION = /^[0-9a-f]{32}$/, DAY_KEY = /^\d{4}-\d{2}-\d{2}$/, RUN_KEY = /^run-[a-z][a-z0-9]{1,23}$/, AGENT_EFFORT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const PLATFORMS = { darwin:"macos", win32:"windows", linux:"linux" };
const AGENT_KINDS = new Set(["", "code", "chat", "design", "research", "docs"]);
const AGENT_SCOPES = new Set(["", "light", "standard", "heavy"]);
const LINE_ACTION_KEYS = {
  stop:"work-stop", review:"work-review", "review-all":"work-review", rate:"work-rate", scope:"work-rate", todo:"line-todo",
  close:"line-archive", outdated:"line-archive", answer:"line-answer", merge:"line-merge",
};

function annotateUsage(res, key) {
  if (USAGE_KEYS.has(key)) (res[USAGE_ANNOTATIONS] ??= new Set()).add(key);
}
/** Fixed route mappings only. Body-dependent and internal actions use annotateUsage/onUsage. */
function routeKeys(method, pathname) {
  const direct = USAGE_ROUTES.get(`${method} ${pathname}`);
  if (direct) return [direct];
  if (["POST", "PATCH", "DELETE"].includes(method) && (pathname === "/api/lines/agent-presets" || pathname.startsWith("/api/lines/agent-presets/"))) return ["agent-preset"];
  if (method === "POST" && /^\/api\/lines\/agents\/model\/[^/]+$/.test(pathname)) return ["settings-change"];
  if (method === "POST" && /^\/api\/v1\/mcp\/workspaces\/[^/]+\/project\/canvases$/.test(pathname)) return ["canvas-new"];
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "lines" || parts[2] !== "projects" || !parts[3]) return [];
  const action = parts[4], rest = parts.length;
  if (method === "GET" && action === "find" && rest === 5) return ["project-search"];
  if (method === "POST" && action === "ask" && rest === 5) return ["project-ask"];
  if (method === "POST" && action === "cloud" && rest === 5) return ["project-sync"];
  if (method === "POST" && action === "share" && rest === 5) return ["project-share"];
  if (method === "POST" && action === "notes" && rest === 5) return ["line-note", "line-new"];
  if (method === "POST" && ["topics", "unsent"].includes(action) && rest === 5) return ["line-ask"];
  if (method === "POST" && action === "topics" && rest === 7 && parts[6] === "feedback") return ["line-ask"];
  return [];
}
function dayOf(time) { return new Date(time).toISOString().slice(0, 10); }
function nextDay(day) { return dayOf(Date.parse(`${day}T00:00:00.000Z`) + DAY_MS); }
function validDay(day) { return typeof day === "string" && DAY_KEY.test(day) && dayOf(Date.parse(`${day}T00:00:00.000Z`)) === day; }
function validInstallation(value) { return typeof value === "string" && INSTALLATION.test(value); }
/** A day's sum of scores, rounded up to a tenth (4.21 and 4.25 become 4.3); float noise such as 4.3000000001 is not rounded up. */
function upToTenth(value) { return typeof value === "number" && Number.isFinite(value) ? (Math.ceil(Math.round(value * 1e6) / 1e5) / 10) || 0 : value; }

function createUsageStats({ agentRows = () => [], busy = () => false, account = () => null, stateDirectory, origin = () => "https://penecho.ai", version = "unknown", app = process.env.PENECHO_DESKTOP_APP === "true" ? "desktop" : "local", tools = new Set(), platform = process.platform, fetchImpl = globalThis.fetch, now = Date.now, logger = () => {} }) {
  const file = path.join(stateDirectory, "usage-stats.json");
  const mcpKeys = new Set([...tools].filter(name => typeof name === "string" && /^penecho_[a-z][a-z0-9_]{0,55}$/.test(name)).map(name => `mcp.${name.slice("penecho_".length)}`));
  let state = read(), saveTimer = null, sendTimer = null, queue = Promise.resolve(), pendingSend = null, activeController = null, countsEpoch = 0, ratingsEpoch = 0, closed = false, currentDay = dayOf(now());

  function validKey(key) { return USAGE_KEYS.has(key) || RUN_KEY.test(key) || mcpKeys.has(key); }
  function pruned(days) {
    const oldest = dayOf(now() - KEEP_FINISHED_DAYS * DAY_MS), today = dayOf(now()), kept = {};
    for (const [day, counts] of Object.entries(days && typeof days === "object" && !Array.isArray(days) ? days : {})) {
      if (!validDay(day) || day < oldest || day > today || !counts || typeof counts !== "object" || Array.isArray(counts)) continue;
      const entries = Object.entries(counts).filter(([key, count]) => validKey(key) && Number.isSafeInteger(count) && count > 0).slice(0, MAX_FEATURES);
      if (entries.length) kept[day] = Object.fromEntries(entries);
    }
    return kept;
  }
  // Agent results start from when sharing ratings is on: Works from before installation or opt-in (even earlier on the
  // same UTC day) are never sent. agentsFrom / agentsFromAt hold the opt-in day and exact timestamp, ranOnFrom the first
  // day requiring a `ran on` mark, agentsThrough the last day of the last complete send, agentsSent each day's last
  // confirmed digest, agentsPending days with uncertain in-flight/lost-204 delivery that must be reconciled even if now
  // empty, and agentRevision a persisted monotonic counter (PE-817).
  function agentStart() { return dayOf(now()); }
  function fresh() {
    const at = now(), start = dayOf(at);
    return { enabled:true, ratingsEnabled:true, installation:crypto.randomBytes(16).toString("hex"), days:{}, agentsThrough:"", agentsFrom:start, agentsFromAt:at, ranOnFrom:start, agentsSent:{}, agentsPending:{}, agentRevision:0 };
  }
  function sentDigests(value) {
    const oldest = dayOf(now() - KEEP_FINISHED_DAYS * DAY_MS), kept = {};
    for (const [day, digest] of Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {})) if (validDay(day) && day >= oldest && /^[0-9a-f]{12}$/.test(digest)) kept[day] = digest;
    return kept;
  }
  function pendingDays(value) {
    // Keep unresolved pending days past the 30-day upload window (up to 60 days) so a day-30 manual upload whose 204
    // was lost is never pruned on restart or day rollover before reconciliation clears or confirms it (PE-817).
    const oldest = dayOf(now() - 2 * KEEP_FINISHED_DAYS * DAY_MS), kept = {};
    for (const day of Array.isArray(value) ? value : Object.keys(value && typeof value === "object" ? value : {})) if (validDay(day) && day >= oldest) kept[day] = 1;
    return kept;
  }
  function validRevision(value) { return Number.isSafeInteger(value) && value > 0 ? value : 0; }
  function validTime(value) { return Number.isSafeInteger(value) && value > 0 ? value : 0; }
  // Nothing is shared: no installation id and no pending data either.
  function off() { return { enabled:false, ratingsEnabled:false, installation:null, days:{} }; }
  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      // A file from before ratings were separate: an opt-out then stays off for both, an opt-in shares both.
      if (typeof value?.enabled !== "boolean") return off();
      if (value.ratingsEnabled !== undefined && typeof value.ratingsEnabled !== "boolean") return off();
      const enabled = value.enabled;
      const ratingsEnabled = typeof value.ratingsEnabled === "boolean" ? value.ratingsEnabled : enabled;
      if ((!enabled && !ratingsEnabled) || !validInstallation(value.installation)) return off();
      const through = validDay(value.agentsThrough) ? value.agentsThrough : "";
      const agentsFrom = validDay(value.agentsFrom) ? value.agentsFrom : through ? nextDay(through) : agentStart();
      const agentsFromAt = validTime(value.agentsFromAt) || (validDay(value.agentsFrom) || through ? Date.parse(`${agentsFrom}T00:00:00.000Z`) : now());
      const ranOnFrom = validDay(value.ranOnFrom) ? value.ranOnFrom : through ? dayOf(now() + DAY_MS) : agentStart();
      return {
        enabled, ratingsEnabled, installation:value.installation,
        days:enabled ? pruned(value.days) : {},
        agentRevision:validRevision(value.agentRevision),
        ...(ratingsEnabled ? { agentsThrough:through, agentsFrom, agentsFromAt, ranOnFrom, agentsSent:sentDigests(value.agentsSent), agentsPending:pendingDays(value.agentsPending) } : {}),
      };
    } catch (error) {
      if (error?.code === "ENOENT") return fresh();
      // A corrupt or unreadable preference is not a missing one: fail closed.
      return off();
    }
  }
  function save() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      fs.mkdirSync(stateDirectory, { recursive:true });
      const temporary = `${file}.${process.pid}.tmp`;
      const pendingList = state.ratingsEnabled ? Object.keys(state.agentsPending || {}).sort() : [];
      const stored = state.enabled || state.ratingsEnabled
        ? {
            enabled:state.enabled, ratingsEnabled:state.ratingsEnabled, installation:state.installation,
            ...(state.enabled ? { days:state.days } : {}),
            ...(state.agentRevision ? { agentRevision:state.agentRevision } : {}),
            ...(state.ratingsEnabled ? {
              agentsThrough:state.agentsThrough || "",
              agentsFrom:state.agentsFrom || agentStart(),
              agentsFromAt:validTime(state.agentsFromAt) || Date.parse(`${state.agentsFrom || agentStart()}T00:00:00.000Z`),
              ranOnFrom:state.ranOnFrom || agentStart(),
              agentsSent:state.agentsSent || {},
              ...(pendingList.length ? { agentsPending:pendingList } : {}),
            } : {}),
          }
        : { enabled:false, ratingsEnabled:false };
      fs.writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, { mode:0o600 });
      fs.renameSync(temporary, file);
      return true;
    } catch (error) { logger({ type:"usage-stats", event:"save-failed", error:String(error?.message || error).slice(0, 200) }); return false; }
  }
  function scheduleSave() { if (!saveTimer) { saveTimer = setTimeout(save, SAVE_EVERY_MS); saveTimer.unref?.(); } }

  function count(feature) {
    if (!state.enabled || closed || !validKey(feature)) return;
    const day = dayOf(now());
    if (day !== currentDay) { currentDay = day; state.days = pruned(state.days); }
    const counts = state.days[day] ??= {};
    if (!(feature in counts) && Object.keys(counts).length >= MAX_FEATURES) return;
    if (counts[feature] === Number.MAX_SAFE_INTEGER) return;
    counts[feature] = (counts[feature] || 0) + 1;
    scheduleSave();
  }
  function workRun(runner) {
    count("work-run");
    const normalized = String(runner || "").toLowerCase();
    if (RUN_KEY.test(`run-${normalized}`)) count(`run-${normalized}`);
  }
  /** Count a finished local request by fixed route and annotations; the request itself is not kept. */
  function observe(req, res, url) {
    if (!state.enabled || closed || res.statusCode < 200 || res.statusCode >= 400) return;
    const routed = routeKeys(req.method, url.pathname), annotated = res[USAGE_ANNOTATIONS];
    if (!routed.length && !annotated) return;
    for (const feature of new Set([...routed, ...(annotated || [])])) count(feature);
  }
  function toolCall(name) { if (typeof name === "string" && tools.has(name)) count(`mcp.${name.slice("penecho_".length)}`); }

  // The days whose agent results may be sent: the last KEEP_FINISHED_DAYS completed days plus today (matching
  // penecho.ai's 30-day window), never before agentsFrom. Because Cloud replaces each day atomically with revision
  // fencing and per-day SHA-256 digests skip unchanged days, including today keeps Cloud aligned with local Statistics
  // without waiting for UTC midnight or double-counting (PE-817, PE-851).
  function agentRange(first = dayOf(now() - KEEP_FINISHED_DAYS * DAY_MS)) {
    if (!state.ratingsEnabled) return null;
    const floor = validDay(state.agentsFrom) ? state.agentsFrom : agentStart();
    const to = dayOf(now()), from = [first, floor].sort().at(-1);
    return from <= to ? { from, to } : null;
  }
  // Check the 30-day window (including today) plus any earlier unresolved pending days whenever send() runs;
  // unchanged days are skipped by their stored digest, so a quiet send does zero HTTP work.
  function agentWindow() {
    if (!state.ratingsEnabled) return null;
    const pendingKeys = Object.keys(state.agentsPending || {}).filter(validDay).sort();
    const hasPending = pendingKeys.length > 0;
    const defaultFirst = dayOf(now() - KEEP_FINISHED_DAYS * DAY_MS);
    const first = hasPending && pendingKeys[0] < defaultFirst ? pendingKeys[0] : defaultFirst;
    return agentRange(first);
  }
  function completedThrough(window) {
    if (!window) return state.agentsThrough || "";
    const yesterday = dayOf(now() - DAY_MS);
    if (window.to <= yesterday) return window.to;
    return window.from <= yesterday ? yesterday : (state.agentsThrough || "");
  }
  function isExcludedAgentRating(row) {
    return Boolean(row && typeof row === "object" && String(row.runner || "").trim().toLowerCase() === "penecho");
  }
  function validAgentRow(row) {
    const counts = ["works", "finished", "failed", "stopped", "followups", "scoreCount", "good", "bad"], amounts = ["minutes", "tokens", "costUsd", "tokensIn", "tokensOut", "tokensCached"];
    // Built-in PenEcho Agent ratings never leave, even from an older caller that still builds them (PE-782).
    // Cloud ratings require an explicit effort because the default can vary by agent setup.
    const scope = row?.scope == null ? "" : String(row.scope).trim().toLowerCase();
    const hasTier = row?.passCount !== undefined || row?.passSum !== undefined || row?.negWeight !== undefined || row?.negWeightedSum !== undefined;
    const tierOk = !hasTier || (
      Number.isSafeInteger(row.passCount) && row.passCount >= 0 && row.passCount <= row.scoreCount
      && typeof row.passSum === "number" && Number.isFinite(row.passSum) && row.passSum >= 0 && row.passSum <= 5 * row.passCount + 1e-9 && row.passSum >= 4 * row.passCount - 1e-9 && row.passSum <= row.scoreSum + 1e-9
      && typeof row.negWeight === "number" && Number.isFinite(row.negWeight) && row.negWeight >= 0 && row.negWeight <= (row.scoreCount - row.passCount) + 1e-6
      && typeof row.negWeightedSum === "number" && Number.isFinite(row.negWeightedSum) && row.negWeightedSum >= 0 && row.negWeightedSum <= 4 * row.negWeight + 1e-6 && row.negWeightedSum >= row.negWeight - 1e-6
    );
    return row && !isExcludedAgentRating(row) && validDay(row.day)
      && typeof row.runner === "string" && /^[a-z][a-z0-9]{1,23}$/.test(row.runner)
      && /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,79}$/.test(row.model)
      && typeof row.effort === "string" && AGENT_EFFORT.test(row.effort) && row.effort.toLowerCase() !== "default" && AGENT_KINDS.has(row.kind)
      && AGENT_SCOPES.has(scope) && tierOk
      && counts.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0 && row[key] <= 10_000) && amounts.every(key => Number.isFinite(row[key] ?? (key.startsWith("tokens") && key !== "tokens" ? 0 : NaN)) && (row[key] ?? 0) >= 0)
      // Scores are 1 to 5 to one decimal; validate raw bounds before merging and round each final daily sum up to a tenth.
      && typeof row.scoreSum === "number" && Number.isFinite(row.scoreSum) && row.scoreSum >= 0 && row.scoreSum <= 50_000 && row.scoreSum >= row.scoreCount - 1e-9 && row.scoreSum <= 5 * row.scoreCount + 1e-9;
  }
  /** Valid rows of the window, one per day, agent app, model, effort, kind and scope: rows of several projects are summed,
   *  as Cloud would, so a report carries fewer rows. Sorted deterministically so digests never flap. */
  function agents(window = agentWindow(), { strict = false } = {}) {
    if (!state.ratingsEnabled || !window) return [];
    let rows;
    try {
      rows = agentRows(window, { ranOnFrom:state.ranOnFrom || "", fromAt:validTime(state.agentsFromAt) });
      if (!Array.isArray(rows)) throw new Error("agentRows must return an array");
    } catch (error) {
      if (strict) throw error;
      return null;
    }
    const merged = new Map(), sums = ["works", "finished", "failed", "stopped", "followups", "scoreSum", "scoreCount", "good", "bad", "minutes", "tokens", "costUsd", "tokensIn", "tokensOut", "tokensCached"];
    const tierSums = ["passCount", "passSum", "negWeight", "negWeightedSum"];
    for (const raw of rows) {
      if (typeof raw?.kind !== "string") continue;
      const kindKey = raw.kind.trim().toLowerCase();
      if (kindKey === "review") continue;
      const scope = raw.scope == null ? "" : String(raw.scope).trim().toLowerCase();
      const row = { ...raw, model:concreteModel(raw.model), kind:kindKey === "fix" || kindKey === "test" ? "code" : kindKey === "other" ? "" : kindKey, scope };
      if (!validAgentRow(row) || row.day < window.from || row.day > window.to) continue;
      const hasTier = row.passCount !== undefined || row.passSum !== undefined || row.negWeight !== undefined || row.negWeightedSum !== undefined;
      const { day, runner, model, effort, kind, works, finished, failed, stopped, followups, scoreSum, scoreCount, good, bad, minutes, tokens, costUsd, tokensIn = 0, tokensOut = 0, tokensCached = 0 } = row;
      const clean = {
        day, runner, model, effort:effort.toLowerCase(), kind,
        ...(scope ? { scope } : {}),
        works, finished, failed, stopped, followups, scoreSum, scoreCount, good, bad, minutes, tokens, costUsd, tokensIn, tokensOut, tokensCached,
        ...(hasTier ? { passCount:row.passCount || 0, passSum:row.passSum || 0, negWeight:row.negWeight || 0, negWeightedSum:row.negWeightedSum || 0 } : {}),
      };
      const key = JSON.stringify([day, runner, model, clean.effort, kind, scope]), current = merged.get(key);
      if (current) {
        for (const name of sums) current[name] += clean[name];
        if (hasTier && current.passCount !== undefined) {
          for (const name of tierSums) current[name] += clean[name];
        } else if (current.passCount !== undefined || hasTier) {
          // Mixed legacy + exact rows for the same bucket: drop exact breakdown so Cloud uses row average fallback cleanly.
          for (const name of tierSums) delete current[name];
        }
      } else merged.set(key, clean);
    }
    const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    return [...merged.values()].map(row => {
      const next = { ...row, scoreSum:upToTenth(row.scoreSum), minutes:Math.round(row.minutes * 10) / 10, costUsd:Math.round(row.costUsd * 10000) / 10000 };
      if (next.passCount !== undefined) {
        next.passSum = Math.min(next.scoreSum, upToTenth(next.passSum));
        next.negWeight = Math.round(next.negWeight * 100) / 100;
        next.negWeightedSum = Math.round(next.negWeightedSum * 100) / 100;
      }
      return next;
    })
      .sort((a, b) => cmp(a.day, b.day) || cmp(a.runner, b.runner) || cmp(a.model, b.model) || cmp(a.effort, b.effort) || cmp(a.kind, b.kind) || cmp(a.scope || "", b.scope || ""));
  }
  const digestOf = rows => rows.length ? crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 12) : "";
  function baseEnvelope(completeOnly = false) {
    const today = dayOf(now()), oldest = dayOf(now() - KEEP_FINISHED_DAYS * DAY_MS);
    let days = Object.entries(state.days).filter(([day]) => day >= oldest && day < today || !completeOnly && day === today)
      .sort(([a], [b]) => a.localeCompare(b)).map(([day, counts]) => ({ day, counts:{ ...counts } }));
    days = completeOnly ? days.slice(0, MAX_REPORT_DAYS) : days.slice(-MAX_REPORT_DAYS);
    return {
      installation:state.installation,
      version:/^[0-9A-Za-z][0-9A-Za-z._+-]{0,47}$/.test(version) ? version : "unknown",
      platform:PLATFORMS[platform] || "unknown",
      app:app === "desktop" ? "desktop" : "local",
      days:state.enabled ? days : [],
    };
  }
  /** The days of the window to send and their rows: every day whose rows changed since last sent, plus any uncertain
   *  day in `agentsPending` (even if now empty, so a Work deleted after a lost 204 still clears Cloud). A day exceeding
   *  single-request row or byte limits is NEVER truncated or acknowledged. */
  function agentPlan(window, { force = false, strict = false, base = null } = {}) {
    const collected = agents(window, { strict });
    if (collected === null) return { days:[], digests:{}, rows:[], byDay:new Map(), oversized:[], failed:true };
    const byDay = new Map();
    for (const row of collected) { const list = byDay.get(row.day) || []; list.push(row); byDay.set(row.day, list); }
    const days = [], digests = {}, oversized = [], sent = state.agentsSent || {}, pending = state.agentsPending || {};
    const oldestNormal = dayOf(now() - KEEP_FINISHED_DAYS * DAY_MS);
    const probeBase = { ...(base || baseEnvelope(true)), days:[] }, nextRev = validRevision(state.agentRevision) + 1;
    if (window) for (let at = Date.parse(`${window.from}T00:00:00.000Z`), end = Date.parse(`${window.to}T00:00:00.000Z`); at <= end; at += DAY_MS) {
      const day = dayOf(at), rows = byDay.get(day) || [];
      digests[day] = digestOf(rows);
      const wanted = day < oldestNormal
        ? Boolean(pending[day])
        : (force ? Boolean(rows.length || sent[day] || pending[day]) : (digests[day] !== (sent[day] || "") || Boolean(pending[day])));
      if (!wanted) continue;
      const singleBytes = Buffer.byteLength(JSON.stringify({ ...probeBase, agents:rows, agentDays:[day], agentRevision:nextRev }));
      if (rows.length > MAX_DAY_ROWS || singleBytes > MAX_DAY_BYTES) {
        logger({ type:"usage-stats", event:"agent-day-too-large", day, rows:rows.length, bytes:singleBytes });
        oversized.push(day);
        continue;
      }
      days.push(day);
    }
    return { days, digests, rows:days.flatMap(day => byDay.get(day) || []), byDay, oversized, failed:false };
  }
  /** The report shape. Settings asks for completeOnly so it shows exactly the next POST. */
  function report({ completeOnly = false, withAgents = true } = {}) {
    const base = baseEnvelope(completeOnly);
    if (!withAgents) return base;
    if (!state.ratingsEnabled) return { ...base, agents:[] };
    const plan = agentPlan(agentWindow(), { strict:false, base });
    return { ...base, agents:plan.rows, ...(plan.days.length ? { agentDays:plan.days, agentRevision:validRevision(state.agentRevision) + 1 } : {}) };
  }
  function status() {
    const sharing = state.enabled || state.ratingsEnabled;
    return { enabled:state.enabled, ratingsEnabled:state.ratingsEnabled, report:sharing ? report({ completeOnly:true }) : null };
  }
  /** Each switch keeps its own data: counts live in days, ratings in agentsThrough. A failed opt-in is rolled back;
   *  a failed opt-out stays in effect here, because continuing to send after it would be worse than losing it on restart. */
  function setPreferences({ enabled, ratingsEnabled } = {}) {
    const previous = state, next = { ...state };
    if (typeof enabled === "boolean") next.enabled = enabled;
    if (typeof ratingsEnabled === "boolean") next.ratingsEnabled = ratingsEnabled;
    const enabledChanged = next.enabled !== state.enabled, ratingsChanged = next.ratingsEnabled !== state.ratingsEnabled;
    if (enabledChanged) countsEpoch++;
    if (ratingsChanged) ratingsEpoch++;
    if ((enabledChanged && !next.enabled) || (ratingsChanged && !next.ratingsEnabled)) activeController?.abort();
    const wasSharing = state.enabled || state.ratingsEnabled, sharing = next.enabled || next.ratingsEnabled;
    if (sharing && !wasSharing) { next.installation = crypto.randomBytes(16).toString("hex"); next.agentRevision = 0; }
    const noRatings = value => { delete value.agentsThrough; delete value.agentsFrom; delete value.agentsFromAt; delete value.ranOnFrom; delete value.agentsSent; delete value.agentsPending; };
    if (!sharing) { next.installation = null; next.days = {}; delete next.agentRevision; noRatings(next); }
    else {
      if (!next.enabled) next.days = {};
      if (!next.ratingsEnabled) noRatings(next);
      // Works from while ratings were off (including earlier on the same UTC day) are never sent: only from this instant onward.
      else if (!state.ratingsEnabled) {
        const at = now(), start = dayOf(at);
        Object.assign(next, { agentsThrough:dayOf(at - DAY_MS), agentsFrom:start, agentsFromAt:at, ranOnFrom:start, agentsSent:{}, agentsPending:{}, agentRevision:validRevision(next.agentRevision) });
      }
    }
    state = next;
    if (!save()) {
      const rolled = { ...next, enabled:previous.enabled && next.enabled, ratingsEnabled:previous.ratingsEnabled && next.ratingsEnabled };
      if (!rolled.enabled && !rolled.ratingsEnabled) state = off();
      else {
        if (!rolled.enabled) rolled.days = {};
        if (!rolled.ratingsEnabled) noRatings(rolled);
        if (!validInstallation(rolled.installation)) rolled.installation = previous.installation;
        state = rolled;
      }
      if (state.enabled !== next.enabled) countsEpoch++;
      if (state.ratingsEnabled !== next.ratingsEnabled) ratingsEpoch++;
      throw Object.assign(new Error("Could not save the privacy preferences."), { status:500 });
    }
    return status();
  }
  function setEnabled(enabled) { return setPreferences({ enabled }); }

  // Reports from an app signed in to PenEcho Cloud carry its account token, only to that same Cloud, so its agent
  // results count fully on the PenEcho Real-World AI Agent Leaderboard (the account is kept there only as a one-way hash).
  function reportHeaders(target) {
    const headers = { "content-type":"application/json" };
    try {
      const signedIn = account();
      if (signedIn?.token && new URL(signedIn.origin).origin === target.origin) headers.authorization = `Bearer ${signedIn.token}`;
    } catch { /* Anonymous. */ }
    return headers;
  }
  /** Whole days per request: multi-day batches target MAX_AGENT_ROWS / MAX_REPORT_BYTES, while a single busy day up to
   *  MAX_DAY_ROWS / MAX_DAY_BYTES goes alone (splitting action counts into their own leading request if combining them
   *  would exceed the batch byte limit). Every agent request lists `agentDays` and monotonic `agentRevision` (PE-817). */
  function requests(base, plan, revision = 0) {
    const out = [];
    let days = [], rows = [], countsPending = base.days.length > 0;
    const body = (counts, list, rowsOf) => ({
      ...base,
      days:counts ? base.days : [],
      agents:rowsOf,
      ...(list.length ? { agentDays:list, ...(revision > 0 ? { agentRevision:revision } : {}) } : {}),
    });
    if (countsPending && plan.days.length) {
      const firstDay = plan.days[0], firstRows = plan.byDay.get(firstDay) || [];
      if (firstRows.length > MAX_AGENT_ROWS || Buffer.byteLength(JSON.stringify(body(true, [firstDay], firstRows))) > MAX_REPORT_BYTES) {
        out.push(body(true, [], []));
        countsPending = false;
      }
    }
    for (const day of plan.days) {
      const dayRows = plan.byDay.get(day) || [], nextDays = [...days, day], nextRows = [...rows, ...dayRows];
      if (days.length && (nextRows.length > MAX_AGENT_ROWS || Buffer.byteLength(JSON.stringify(body(countsPending, nextDays, nextRows))) > MAX_REPORT_BYTES)) {
        out.push(body(countsPending, days, rows));
        countsPending = false;
        days = [day]; rows = [...dayRows];
      } else {
        days = nextDays; rows = nextRows;
      }
    }
    if (days.length || countsPending || !out.length) out.push(body(countsPending, days, rows));
    return out;
  }
  /** Sends the requests in order and records each one Cloud stored. Persists revision and pending days BEFORE sending
   *  (aborting if persistence fails), rechecks preference epochs before every POST, retains counts on 429/409/5xx, and
   *  syncs `agentRevision` on 409 stale_revision so Local never acknowledges data Cloud skipped (PE-817). */
  async function deliver(base, plan, { window = null } = {}) {
    let target;
    try { target = new URL("/api/v1/analytics/local-usage", origin() || "https://penecho.ai"); } catch { return { ok:false, reason:"origin", rows:0 }; }
    if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))) return { ok:false, reason:"origin", rows:0 };
    const myCountsEpoch = countsEpoch, myRatingsEpoch = ratingsEpoch;
    let revision = 0;
    if (plan.days.length && state.ratingsEnabled && state.installation === base.installation) {
      const prevRevision = validRevision(state.agentRevision);
      const prevPending = { ...(state.agentsPending || {}) };
      revision = prevRevision + 1;
      state.agentRevision = revision;
      const pending = state.agentsPending ??= {};
      for (const day of plan.days) pending[day] = 1;
      // Never transmit an unpersisted revision: a restart after a failed save could otherwise reuse a lower revision.
      if (!save()) {
        state.agentRevision = prevRevision;
        state.agentsPending = prevPending;
        return { ok:false, reason:"save-failed", rows:0 };
      }
    }
    const list = requests(base, plan, revision);
    let rows = 0;
    for (const body of list) {
      // Recheck opt-out / installation / preference epochs right before EVERY POST in a multi-batch send.
      if (closed || state.installation !== body.installation) return { ok:false, reason:"changed", rows };
      if (body.days.length && (countsEpoch !== myCountsEpoch || !state.enabled)) return { ok:false, reason:"changed", rows };
      if ((body.agents.length || body.agentDays?.length) && (ratingsEpoch !== myRatingsEpoch || !state.ratingsEnabled)) return { ok:false, reason:"changed", rows };
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
      timeout.unref?.(); activeController = controller;
      try {
        const response = await fetchImpl(target, { method:"POST", redirect:"error", headers:reportHeaders(target), body:JSON.stringify(body), signal:controller.signal });
        if (response.status >= 500 || response.status === 429) return { ok:false, reason:`HTTP ${response.status}`, rows };
        if (state.installation !== body.installation) return { ok:false, reason:"changed", rows };
        if (response.status === 409) {
          let detail = null;
          try { detail = typeof response.json === "function" ? await response.json() : null; } catch {}
          if (ratingsEpoch === myRatingsEpoch && state.ratingsEnabled && validRevision(detail?.minRevision) > validRevision(state.agentRevision)) {
            state.agentRevision = validRevision(detail.minRevision);
            save();
          }
          return { ok:false, reason:"HTTP 409", rows };
        }
        let changed = false;
        const hasAgents = Boolean(body.agents.length || body.agentDays?.length);
        // Never discard valid daily feature counts when a mixed counts+agents request is rejected (e.g. 400 on an agent field).
        if (countsEpoch === myCountsEpoch && state.enabled && body.days.length && (response.ok || !hasAgents)) { for (const { day } of body.days) delete state.days[day]; changed = true; }
        if (response.ok && ratingsEpoch === myRatingsEpoch && state.ratingsEnabled) {
          const sent = state.agentsSent ??= {}, pending = state.agentsPending ??= {};
          for (const day of body.agentDays || []) {
            if (plan.digests[day]) sent[day] = plan.digests[day]; else delete sent[day];
            delete pending[day];
          }
          changed = true;
        }
        if (changed) save();
        if (!response.ok) return { ok:false, reason:`HTTP ${response.status}`, rows };
        rows += body.agents.length;
      } catch (error) { return { ok:false, reason:String(error?.message || error).slice(0, 120), rows }; }
      finally { clearTimeout(timeout); if (activeController === controller) activeController = null; }
    }
    if (plan.oversized?.length) {
      if (ratingsEpoch === myRatingsEpoch && state.ratingsEnabled && state.installation === base.installation) {
        const pending = state.agentsPending ??= {};
        for (const day of plan.oversized) pending[day] = 1;
        save();
      }
      return { ok:false, reason:"day-too-large", rows, oversized:plan.oversized };
    }
    if (window && ratingsEpoch === myRatingsEpoch && state.ratingsEnabled && state.installation === base.installation) {
      state.agentsThrough = completedThrough(window); state.agentsSent = sentDigests(state.agentsSent); state.agentsPending = pendingDays(state.agentsPending); save();
    }
    return { ok:true, rows };
  }
  function enqueue(fn) {
    const next = queue.then(fn, fn);
    queue = next.then(() => {}, () => {});
    return next;
  }
  /** The person asked to share their last `days` days of agent results now (through today): every eligible day is sent
   *  again, serialized behind any active upload so snapshots, Cloud commits and local digests stay in one order. */
  function sendRecent(days = 7) {
    return enqueue(async () => {
      if (!state.ratingsEnabled || closed || typeof fetchImpl !== "function") return { sent:false, reason:"off" };
      const n = Math.max(1, Math.min(30, Math.round(Number(days) || 7)));
      const window = agentRange(dayOf(now() - n * DAY_MS));
      if (!window) return { sent:false, reason:"nothing", rows:0 };
      const base = baseEnvelope(true);
      let plan;
      try { plan = agentPlan(window, { force:true, strict:true, base }); }
      catch (error) { logger({ type:"usage-stats", event:"agent-collect-failed", error:String(error?.message || error).slice(0, 200) }); return { sent:false, reason:"collect-failed", rows:0 }; }
      if (!plan.days.length && plan.oversized.length) {
        const pending = state.agentsPending ??= {};
        for (const day of plan.oversized) pending[day] = 1;
        save();
        return { sent:false, reason:"day-too-large", rows:0 };
      }
      if (!plan.days.length) return { sent:false, reason:"nothing", rows:0 };
      const result = await deliver(base, plan);
      return result.ok ? { sent:true, rows:result.rows, from:window.from, to:window.to } : { sent:false, reason:result.reason, rows:result.rows };
    });
  }

  function send() {
    if (pendingSend) return pendingSend;
    pendingSend = enqueue(async () => {
      if ((!state.enabled && !state.ratingsEnabled) || closed || typeof fetchImpl !== "function") return false;
      if (state.enabled) {
        const beforePrune = JSON.stringify(state.days);
        state.days = pruned(state.days);
        if (beforePrune !== JSON.stringify(state.days)) save();
      }
      const base = baseEnvelope(true);
      const window = agentWindow();
      let plan = { days:[], digests:{}, rows:[], byDay:new Map(), oversized:[] }, collectFailed = false;
      if (window) {
        try { plan = agentPlan(window, { strict:true, base }); }
        catch (error) {
          collectFailed = true;
          logger({ type:"usage-stats", event:"agent-collect-failed", error:String(error?.message || error).slice(0, 200) });
        }
      }
      if (collectFailed) {
        // Still deliver pending action counts if any, but never touch agentsSent, agentsPending or agentsThrough on error.
        if (base.days.length) await deliver(base, plan);
        return false;
      }
      if (!base.days.length && !plan.days.length) {
        if (plan.oversized.length) {
          const pending = state.agentsPending ??= {};
          for (const day of plan.oversized) pending[day] = 1;
          save();
          return false;
        }
        if (window) { state.agentsThrough = completedThrough(window); state.agentsSent = sentDigests(state.agentsSent); state.agentsPending = pendingDays(state.agentsPending); save(); }
        return false;
      }
      return (await deliver(base, plan, { window })).ok;
    }).finally(() => { pendingSend = null; });
    return pendingSend;
  }
  function start() {
    if (sendTimer || closed) return;
    let checks = 0;
    const daily = () => { void send(); sendTimer = setTimeout(daily, SEND_EVERY_MS); sendTimer.unref?.(); };
    const first = () => {
      let idle = true;
      try { idle = !busy(); } catch { /* Unknown counts as idle. */ }
      checks++;
      if (idle || checks * IDLE_CHECK_MS >= FIRST_SEND_MS) { void send(); sendTimer = setTimeout(daily, SEND_EVERY_MS); }
      else sendTimer = setTimeout(first, IDLE_CHECK_MS);
      sendTimer.unref?.();
    };
    sendTimer = setTimeout(first, IDLE_CHECK_MS); sendTimer.unref?.();
  }
  function close() {
    if (closed) return;
    closed = true; clearTimeout(sendTimer); sendTimer = null; activeController?.abort();
    if (saveTimer) save();
  }

  save(); // Persist a fresh installation id, or the explicit off marker, across restarts.
  return { count, workRun, observe, toolCall, report, status, setPreferences, setEnabled, send, start, close, file, sendRecent };
}

module.exports = { createUsageStats, routeKeys, annotateUsage, LINE_ACTION_KEYS, USAGE_ROUTES, USAGE_KEYS, USAGE_ANNOTATIONS };
