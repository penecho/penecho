"use strict";
// Orchestrator (PE-613): one saved agent the person picks plans a job, gives its parts to other saved agents as Lines or as tasks on one
// Line (which can run at the same time), checks their Works and reports. It does this through PenEcho's own functions, listed in TOOLS:
// the Orchestrator tab calls them for the person, and the orchestrator's agent calls them over HTTP with a pass only its run is given.
// What each agent did on each kind of job, the orchestrator's scores and the person's model prices are kept on this computer, so the
// next plan picks agents by what worked and what it cost.
const AgentIndex = require("./agent-index.js");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID, createHmac, timingSafeEqual } = require("node:crypto");
const F = require("./format.js");
const LINE_STATUS = require("../../../public/lines/line-status.js");
const { concreteModel, modelOf, priceModelOf, priceFor, estimate } = require("../../../public/lines/work-pricing.js");
const L = require("./layout.js");
const Knowledge = require("./knowledge.js");
const { failure, clip } = require("./store.js");
const { HELPER_PATH, expectedOrchProof } = require("./orch-call.js");
const { createOrchReview, scoreOf, normalizeVerdict } = require("./orch-review.js");
const { jobKind } = require("./job-kind.js");
const {
  SCOPES, SCOPE_LABELS, normalizeScope, resolveWorkScope, isTrivialAsk, inferLightScope,
  emptyTierBuckets, addScoreToBucket, tierRating, provenScopeOf, scoreAggregateDelta,
} = require("./job-scope.js");

const ORCHESTRATOR = "Orchestrator";
const MODEL_PRICES = "model-prices";
const AUTO_PRESET = "auto";
// Older Statistics pages started the same lookup without a job marker.
const legacyPriceGoal = words => words?.startsWith("Look up the current list prices, in US$ per million tokens (input, output, and cached input where the provider has one), for: ") &&
  words.endsWith(". Use the providers' own pricing pages. Save each with set-price, putting the page you read in source. Do not create Lines for this. Reply with a short table of what you saved.");
const KINDS = ["code", "chat", "design", "research", "docs"];
const KIND_RULES = {
  code:"writing, fixing, or testing code",
  chat:"discussion, Q&A, or general conversation",
  design:"UI/UX, visual, canvas/prototypes, and 3D object/modeling work such as Blender",
  research:"investigation or analysis",
  docs:"documentation, notes, or slides",
};
const kindKey = value => String(value || "").trim().toLowerCase();
const normalizeKind = value => {
  const k = kindKey(value);
  return KINDS.includes(k) ? k : "";
};
const storedKind = value => {
  const k = kindKey(value);
  return k === "fix" || k === "test" ? "code" : normalizeKind(k);
};
const isReviewWork = (station, record) => station?.kind === "review" || kindKey(record?.kind) === "review";
const isDesignMake = make => make?.kind === "diagram" || make?.kind === "explorer";
function askForWork(line, station) {
  const stations = Array.isArray(line?.stations) ? line.stations : [];
  const at = stations.indexOf(station);
  if (at <= 0) return null;
  for (let i = at - 1; i >= 0; i--) {
    const prev = stations[i];
    if (!prev) continue;
    if (prev.kind === "ask") {
      if (!prev.unsent) return prev;
      continue;
    }
    // A Work after a dedicated prototype/grill step (e.g. ['ask', 'prototype', 'work']) is a later stage, not that Ask's prototype/canvas output.
    if (prev.kind === "prototype" || prev.kind === "grill") return null;
  }
  return null;
}
function implicitWorkKind(line, station) {
  if (!station || isReviewWork(station, null)) return "";
  if (station.kind === "prototype" || station.kind === "sketch" || Boolean(station.canvas)) return "design";
  const ask = askForWork(line, station);
  if (ask && (Boolean(ask.canvas) || isDesignMake(ask.make))) return "design";
  return "";
}
const resolvedWorkKind = (line, station, record) => (isReviewWork(station, record) ? "" : storedKind(record?.kind) || implicitWorkKind(line, station));
// Keep the legacy review marker when copying an assignment so it stays ineligible for ratings.
const inheritedKind = value => kindKey(value) === "review" ? "review" : storedKind(value);
const requireKind = value => {
  const k = normalizeKind(value);
  if (!k) throw failure("BAD_KIND", `kind must be one of: ${KINDS.join(", ")}.`);
  return k;
};
const optionalScope = value => {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const s = normalizeScope(value);
  if (!s) throw failure("BAD_SCOPE", `scope must be one of: ${SCOPES.join(", ")}.`);
  return s;
};
// The reviewer's standard (orch-review.js), so a coordinator and a reviewer rate the same Work alike whatever else their prompts say.
// It is in every orchestrator Work's prompt, so it stays under 100 tokens: the longer words are in RATING_RULES, read from help.
const RATING_STANDARD = "rate by finishing the job well (0-5, one decimal; skip N/A, no bonus or penalty): outcome 60% (met the ask well), verification 20% (proven when needed, N/A for simple chat), safety & scope 20% (no harm or broken limits, ignore scratch). Cap at min+1 only if outcome or safety <= 2. Simple clean tasks score 5";
const RATING_RULES = [
  `The reviewer's standard: ${RATING_STANDARD}.`,
  "Verdicts: ready (satisfies the ask cleanly; simple tasks like \"hi\" -> \"hi\" score 5), caveats (usable with minor caveats), fix (unmet requirement, wrong result, harm, or skipped required check), unverified (lacks evidence to judge outcome — do not score).",
  "Outcome (60%, primary): did it finish what was asked, accurately and well? Never N/A for a scored Work; if the outcome cannot be judged, mark verdict unverified instead of guessing 3.",
  "Verification (20%): real evidence it works (test/check outputs, verified files/data, inspected output). Set to null (N/A) for simple chat/Q&A that needs no proof, or when you cannot verify.",
  "Safety & Scope (20%): no regressions, broken limits (merge/push/delete), or live-service breakage. Set to null (N/A) for pure text/chat. Ignore agent scratch/memory.",
  "No bonus or penalty adjustments: score comes strictly from Outcome, Verification, and Safety & Scope (no separate report-mismatch deduction or extra credit).",
  "Score formula: weighted average of scored dimensions only (weights auto-re-normalize), capped at min+1 only when outcome or safety <= 2, clamped to 1.0-5.0 (e.g. outcome 4, verification 4.5, safety 5 is 4.3; outcome 5 with N/A verification and safety is 5).",
];
// A score as kept: 1 to 5 to one decimal. null when it is not one.
const scoreIn = value => {
  const n = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
  return n >= 1 && n <= 5 ? Math.round(n * 10) / 10 : null;
};
const effectiveScore = r => (r && !r.ignored && r.verdict !== "unverified" && r.review?.verdict !== "unverified" ? scoreIn(r.score) : null);
const ratingSourceOf = r => r?.source || (r?.review ? "reviewer" : (r?.scoredBy || r?.by) ? "coordinator" : "user");
const explicitSourceOf = r => r?.source || (r?.review ? "reviewer" : "");
const FINDING_KINDS = ["bug", "gap", "risk", "unverified"];
function reviewFindingsOf(r) {
  if (!r || r.ignored) return [];
  const list = Array.isArray(r.review?.findings) ? r.review.findings : Array.isArray(r.findings) ? r.findings : [];
  return list.filter(f => f && FINDING_KINDS.includes(f.kind));
}
function addFindingCounts(target, findings) {
  if (!findings?.length) return;
  for (const f of findings) target[f.kind] = (target[f.kind] || 0) + 1;
}
function addSourceScore(target, source, score) {
  if (score == null || !source) return;
  const slot = target[source] || (target[source] = { sum:0, count:0 });
  slot.sum += score;
  slot.count += 1;
}
function summarizeSources(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    if (v?.count > 0) out[k] = { score:Math.round((v.sum / v.count) * 10) / 10, count:v.count };
  }
  return Object.keys(out).length ? out : null;
}
function summarizeFindings(map) {
  const out = {};
  for (const k of FINDING_KINDS) if (map?.[k] > 0) out[k] = map[k];
  return Object.keys(out).length ? out : null;
}
const WAIT_MS = 3000, WAIT_MOST = 15 * 60 * 1000, RECORDS_MOST = 5000;
const ENDED = new Set(["done", "ready", "stopped", "waiting", "not-started", "closed", "landed", "notes"]);
const blockingToolQuestion = asking => asking?.kind === "tool" && asking.isBlocking !== false;
const waitPending = l => !l.archived && !L.ARCHIVED.has(l.status)
  && !(l.status === "waiting" && blockingToolQuestion(l.asking))
  && (l.running || !ENDED.has(l.status));
const yes = value => /^(?:yes|true)$/i.test(String(value || ""));

// What the orchestrator's agent can call, with its arguments. The agent reads the rest from {"do":"help"}, so its prompt stays short.
const BRIEF_CALLS = "decide; create-line; add-task; wait; work; rate; agents; plan";
const SKIP_REVIEW_RATING = "Review Works should not be rated — judging a review of another agent's job is unreliable, so skip rate for review tasks.";
// Lazy-loaded onto the first delegation reply of a Work (decide with brief, create-line, or add-task), keeping solo briefs lean (PE-1097).
function handoffGuidance(reviewForYou = false) {
  return [
    "Delegation rules: Leave agent out and PenEcho picks; name one (from agents) only when the person did or a part needs a tool only it has. Your own Line holds only your work: assignments go on other Lines. Related tasks share one Line (create-line, then add-task; parallel:true only for independent work with distinct files); unrelated ones get their own. Lines have no type of their own; give each task a required kind.",
    `Wait for Works to settle in one wait call for all their Lines (seconds up to 900, with a longer command timeout; wait:<seconds> on decide/create-line/add-task waits in the same call; do not look in between waits; call work when resultCut). A part stopped by a usage limit or an error goes on once with the next agent by itself; if that stops too, do it yourself. Read each finished Work's actual result, fix small gaps yourself, and send bigger ones back with add-task and no agent (the same one goes on). Rate each inspected non-review Work with rate (several at once with rates), except reviews, by the reviewer's standard: ${RATING_STANDARD}. Judge the inspected output and diff, not self-claims, and only what the agent controlled (a Work cut off from outside with no usable output is not rated); put concrete evidence in note, and keep scores out of your reply.`,
    reviewForYou
      ? "The person asked you to review for them: mark the Works you accept reviewed."
      : "The person reviews the Works themselves: do not mark them reviewed; say in your report what waits for their review.",
  ].join(" ");
}
// Requests that explicitly ask to orchestrate, delegate, split, or compare agents always get the full brief, never the Light/chat shortcut.
const WANTS_ORCH_BRIEF = /\b(?:delegat\w*|split|hand[- ]?off|sub-?agents?|other agents?|another agent|two agents?|multiple agents?|compare\b[^.!?\n]{0,30}\bagents?|roundtable|orchestrat\w*|agents? in parallel|assign\b[^.!?\n]{0,20}\b(?:to|agent))\b|分工|拆分|交给|委托|子\s*agent|其他\s*agent|多个\s*agent|对比.*agent|并行.*agent/i;
const PURE_GREETING = /^(?:hi|hey|hello|yo|gm|thanks?|thank you|thx|ok|okay|got it|sure|你好|您好|嗨|谢谢|好的|收到)[.!?,，。！？\s]*$/i;
const TOOLS = [
  ["help", "", "This list."],
  ["overview", "status?", "Every open Line: ref, line (its slug), title, status, agent, Works, and who started it."],
  ["line", "line", "One Line: its Asks with their current step ids, unsent status and saved task kind, and each Work's kind, agent, state, time, tokens, cost, summary, review and scores."],
  ["work", "line, work", "One Work's kind, whole result and the files it changed."],
  ["agents", "", "Runnable saved presets with Allow orchestrator assignments enabled. Use a returned id as agent when delegating."],
  ["stats", "kind?, days?", "Per agent, model it ran, effort and kind of job: Works, median time, tokens, cost, your scores and the person's ratings."],
  ["plan", "kind?, scope?, all?, limit?", "Top eligible presets and you (default 8 + you; pass all:true for every preset): finished Works, scores, time, cost per Work and expected cost for this kind/scope (light, standard, heavy; default standard), handoff included, cheapest first, with cheaperThanYou and tryIt marked."],
  ["decide", "route, why, parts?, kind?, scope?, wait?", "Record who does each task when delegating or splitting (keeping a job yourself is the silent default, so decide is optional for route: self). route: self, delegate or split. why: one sentence. parts: [{task, kind, scope?, role?, agent?, brief?, title?}] where every task has its own kind from kinds (see kindRules), optional difficulty scope (light, standard, heavy; default standard), and agent is left out for PenEcho to pick, a preset id the person named, or \"self\" (top-level kind/scope is only for a single-task self route with no parts). role: execution (default: about as good as you at under half your cost) or decision (rated above you; changes no files). A part with brief (the goal, the context it needs and the reply you want) is started at once on a Line of its own, every such part side by side; the answer names them in started, and in kept the parts nobody fits, which are yours. wait: seconds to wait for those Lines in this same call; the answer then has waited, as wait gives it."],
  ["prices", "", "Model prices the person entered, in US$ per million tokens."],
  ["set-price", "model, input, output, cached?, cacheWrite?, source?", "Save a model's price (US$ per million tokens). Only when the person asks you to."],
  ["create-line", "task, kind, agent?, role?, scope?, title?, why?, wait?, run?, branch?", "Create a Line with its first task (Work), its agent (left out, PenEcho picks as for decide; kept means nobody fits and it is yours), that task's required kind (from kinds: code, chat, design, research, or docs; see kindRules), and optional difficulty scope (light, standard, heavy; default standard). A Line itself has no kind; add further tasks of any kind to the same Line with add-task. Returns line, ref, ask (current step id), work, kind and started. why: when you hand the whole job to this agent and have not called decide, one sentence that records the delegate route. wait: seconds to wait for it in this same call; the answer then has waited, as wait gives it. run:false saves that first Ask, its agent and its kind for later, with an empty work id and started:false. branch:\"new\" gives it a branch of its own."],
  ["start-line", "line, ask?, revision?, agent?, kind?, scope?", "Run a saved task (Ask) or queued Work on an idle Line. When selecting an Ask, send its step id and the revision from line. agent may override its saved preset; kind is for that task and is required when the saved task has no kind; scope is optional (light, standard, heavy)."],
  ["add-task", "line, task, kind, agent?, role?, scope?, parallel?, wait?", "Add a task (Work) to a Line, with its own agent (left out, the Line's agent goes on, or the next that fits when its app stopped it), required kind (from kinds: code, chat, design, research, or docs; see kindRules), and optional difficulty scope (light, standard, heavy; default standard). One Line can hold tasks of different kinds from different agents (e.g. research, design, code, chat, docs). parallel:true starts it beside the other Works; otherwise it waits until all running Works have saved their results. It starts a new conversation beside another Work, or when the task says it is independent; otherwise the same agent may carry its short, recent one on. wait: seconds to wait for the Line in this same call; the answer then has waited, as wait gives it."],
  ["stop", "line", "Stop the work running on a Line."],
  ["retry", "line, work?", "Retry a stopped or interrupted Line in place, or retry a specific stopped parallel Work by its work id."],
  ["wait", "lines, seconds?", "Wait for each Line to settle, be archived, or reach a blocking tool question. Returns open questions and whether each Line still has a live agent; for a settled Line its newest Work with its result (cut when long: work has all of it) and the Line's other Works; for one still going, what its agent is doing now and how long it has been quiet. At most seconds (900)."],
  ["rate", "line, work, score?, outcome?, verification?, safety?, verdict?, note?, kind?, scope? | rates", `Several Works in one call with rates:[{line, work, score?, outcome?, verification?, safety?, verdict?, note?, kind?, scope?}]. Score a finished Work 1-5 to one decimal (4.2) using ratingRules and concrete evidence in note, or pass outcome/verification/safety (0-5 or null when N/A) for strict server calculation (no bonus or penalty adjustments). Pass verdict:"unverified" when outcome cannot be judged. Pass kind (from kinds; see kindRules) if the Work has no recorded kind yet. Kept for choosing agents next time. ${SKIP_REVIEW_RATING}`],
  ["review", "line, work?", "Mark a finished Work (or every finished Work on the Line) reviewed. Only when the person asked you to review for them."],
  ["todo", "line, todo", "Mark a finished Line Todo (true) or not (false)."],
  ["status", "line, to", "to: archive, reopen, outdated, pin or unpin."],
  ["rename", "line, title", "A better title for a Line."],
  ["rebuild-topics", "agent?", "Rebuild the project's Topics on a new Line. Use an eligible agent id, or an eligible Topics or default preset."],
];

function writeAtomic(file, text, { mode = 0 } = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive:true, ...(mode ? { mode:0o700 } : {}) });
  if (mode) try { fs.chmodSync(dir, 0o700); } catch { /* Best-effort permission tightening. */ }
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, text, mode ? { mode } : undefined);
    if (mode) try { fs.chmodSync(temp, mode); } catch { /* Best-effort permission tightening. */ }
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* Ignore cleanup failure. */ }
    throw error;
  }
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function readJsonStrict(file, fallback) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw Object.assign(new Error(`Could not read orchestrator state ${path.basename(file)}: ${error.message}`), { code:"ORCH_STATE_UNREADABLE", cause:error });
  }
  try { return JSON.parse(raw); }
  catch (error) {
    throw Object.assign(new Error(`Orchestrator state ${path.basename(file)} is corrupted: ${error.message}`), { code:"ORCH_STATE_CORRUPT", cause:error });
  }
}
const median = xs => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), mid = s.length >> 1; return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2; };
const num = (value, most = 1e6) => { const n = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN; return Number.isFinite(n) && n >= 0 && n <= most ? n : null; };
// "2026-11-12 09:30", as PenEcho writes times in a line.
function labelMs(label) {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d))?/.exec(String(label || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
}
const tookMin = took => { const m = /(\d+)\s*min/.exec(String(took || "")); return m ? Number(m[1]) : 0; };
const allLines = state => [...(state.lines || []), ...(state.backlog || []), ...(state.landed || [])];
const isWork = s => s && !s.unsent && !["ask", "note", "canvas", "meeting", "merge", "deliver", "orch-review"].includes(s.kind);

function createOrchestrator({ service, directory, onUsage = () => {}, dice = Math.random }) {
  const usage = key => { try { onUsage(key); } catch {} };
  const dir = path.join(directory, "orchestrator"), pricesFile = path.join(dir, "model-prices.json"), recordsFile = path.join(dir, "records.json");
  // One pass per orchestrator Line: the agent's env carries it, and it opens only that Line's project. Kept in the state folder
  // (only this user can read it), so an orchestrator that keeps working through a restart of PenEcho can still call it.
  const passesFile = path.join(dir, "passes.json"), passSecretFile = path.join(dir, "pass-secret"), gensFile = path.join(dir, "generations.json"), opsFile = path.join(dir, "ops.json"), endpointFile = path.join(dir, "endpoint.json");
  const passes = new Map(), passOf = new Map(), sessionGens = new Map(), ops = new Map(), inFlightOps = new Map();
  let genSeq = 0;
  let passSecret = "";
  const NONCE_OK = /^[a-zA-Z0-9_-]{8,128}$/;
  const OP_ID_OK = /^[a-zA-Z0-9_-]{8,128}$/;
  const MUTATING_OPS = new Set([
    "decide", "set-price", "create-line", "start-line", "add-task",
    "stop", "retry", "rate", "review", "todo", "status", "rename", "rebuild-topics",
  ]);
  const LAUNCH_OPS = new Set(["create-line", "add-task", "start-line", "retry", "rebuild-topics"]);
  const OPS_MOST = 500;
  const instanceId = randomUUID();
  const orchToken = randomBytes(32).toString("base64url");
  let announcedPort = 0;

  function loadPassSecret({ create = false } = {}) {
    if (passSecret) return passSecret;
    try {
      const text = fs.readFileSync(passSecretFile, "utf8").trim();
      if (text) { passSecret = text; return passSecret; }
    } catch (error) {
      if (error?.code !== "ENOENT") throw Object.assign(new Error(`Could not read orchestrator pass secret: ${error.message}`), { code:"ORCH_STATE_UNREADABLE", cause:error });
    }
    if (!create) return "";
    const fresh = randomBytes(32).toString("base64url");
    writeAtomic(passSecretFile, fresh, { mode:0o600 });
    passSecret = fresh;
    return passSecret;
  }
  function signPass({ projectId, slug, gen, lineId = "" }) {
    const secret = loadPassSecret({ create:true });
    const payload = Buffer.from(JSON.stringify({ p:projectId, s:slug, g:gen, ...(lineId ? { i:lineId } : {}), n:randomBytes(12).toString("hex") })).toString("base64url");
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    return `v2.${payload}.${sig}`;
  }
  function parseSignedPass(token) {
    if (typeof token !== "string" || !token.startsWith("v2.")) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const secret = loadPassSecret({ create:false });
    if (!secret) return null;
    const want = createHmac("sha256", secret).update(parts[1]).digest("base64url");
    const a = Buffer.from(parts[2]), b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const data = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (!data?.p || !data?.s || !Number.isInteger(Number(data.g))) return null;
      return { projectId:String(data.p), slug:String(data.s), gen:Number(data.g), lineId:typeof data.i === "string" ? data.i : "" };
    } catch { return null; }
  }
  function liveLineKey(key) {
    const slash = String(key || "").indexOf("/");
    if (slash <= 0) return false;
    const pid = key.slice(0, slash), slug = key.slice(slash + 1);
    const project = service.store?.projects?.find(p => p.id === pid);
    if (!project) return false;
    try { return Boolean(service.isLine(project, slug)); } catch { return true; }
  }
  function loadGenerations({ strict = false } = {}) {
    const data = (strict ? readJsonStrict : readJson)(gensFile, {}) || {};
    sessionGens.clear();
    let maxSeen = genSeq;
    for (const [k, v] of Object.entries(data)) {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) continue;
      if (k === "_seq") { maxSeen = Math.max(maxSeen, n); continue; }
      sessionGens.set(k, n);
      maxSeen = Math.max(maxSeen, n);
    }
    genSeq = maxSeen;
  }
  function saveGenerations() {
    const existing = readJsonStrict(gensFile, {}) || {};
    const merged = {};
    let maxSeq = Math.max(genSeq, Number(existing._seq) || 0);
    for (const [k, v] of Object.entries(existing)) {
      if (k === "_seq") continue;
      const n = Number(v);
      if (k && Number.isInteger(n) && n > 0 && (sessionGens.has(k) || liveLineKey(k))) {
        merged[k] = n;
        maxSeq = Math.max(maxSeq, n);
      }
    }
    for (const [k, v] of sessionGens) {
      merged[k] = Math.max(Number(merged[k]) || 0, v);
      maxSeq = Math.max(maxSeq, merged[k]);
    }
    genSeq = maxSeq;
    if (maxSeq > 0) merged._seq = maxSeq;
    writeAtomic(gensFile, JSON.stringify(merged), { mode:0o600 });
  }
  function ensureSessionGen(project, slug) {
    if (!project?.id || !slug) return 0;
    const key = `${project.id}/${slug}`;
    const existing = sessionGens.get(key) || 0;
    if (existing > 0) return existing;
    loadGenerations({ strict:true });
    const reloaded = sessionGens.get(key) || 0;
    if (reloaded > 0) return reloaded;
    const nextGen = ++genSeq;
    sessionGens.set(key, nextGen);
    saveGenerations();
    return nextGen;
  }
  function loadOps({ strict = false } = {}) {
    const data = (strict ? readJsonStrict : readJson)(opsFile, {}) || {};
    ops.clear();
    for (const [k, v] of Object.entries(data)) {
      if (k && v && typeof v === "object" && typeof v.fp === "string") ops.set(k, v);
    }
  }
  function saveOps() {
    // Never evict unresolved `pending` operations to make room for settled receipts: only settled receipts are bounded by OPS_MOST.
    const pending = [], settled = [];
    for (const entry of ops.entries()) {
      if (entry[1]?.state === "pending") pending.push(entry);
      else settled.push(entry);
    }
    const keptSettled = settled.sort((a, b) => (a[1].at || 0) - (b[1].at || 0)).slice(-OPS_MOST);
    const kept = [...pending, ...keptSettled];
    ops.clear();
    for (const [k, v] of kept) ops.set(k, v);
    writeAtomic(opsFile, JSON.stringify(Object.fromEntries(kept)), { mode:0o600 });
  }
  function loadPasses({ strict = false } = {}) {
    loadGenerations({ strict });
    try { loadPassSecret({ create:false }); } catch (error) { if (strict) throw error; }
    const data = (strict ? readJsonStrict : readJson)(passesFile, {}) || {};
    passes.clear();
    passOf.clear();
    const migratedGens = new Map();
    const adoptedGens = new Map();
    const prevSeq = genSeq;
    for (const [pass, held] of Object.entries(data)) {
      if (held?.projectId && held.slug) {
        const key = `${held.projectId}/${held.slug}`;
        let gen = Number(held.gen) || 0;
        const curGen = sessionGens.get(key) || 0;
        if (gen < curGen) continue;
        // Recover cleanly from an interrupted migration where passes.json wrote gen>=1 before generations.json flushed.
        if (gen > curGen) {
          adoptedGens.set(key, Math.max(adoptedGens.get(key) || 0, gen));
          genSeq = Math.max(genSeq, gen);
        } else if (gen === 0 && curGen === 0) {
          // Preserve active, never-stopped legacy generation-0 passes across upgrade by assigning a monotonic generation >= 1.
          gen = migratedGens.get(key) || ++genSeq;
          migratedGens.set(key, gen);
        }
        const normalized = { projectId:held.projectId, slug:held.slug, gen, ...(held.lineId ? { lineId:String(held.lineId) } : {}) };
        passes.set(pass, normalized);
        passOf.set(key, pass);
      }
    }
    // Two-phase crash-safe migration ordering:
    // 1) Persist upgraded gen>=1 in passes.json FIRST (before bumping generations.json), so an EIO on passes.json leaves
    //    both files at gen 0 and the next load retries migration cleanly instead of mistaking it for a Stop.
    // 2) Persist generations.json SECOND, so an EIO on generations.json leaves passes.json at gen>=1 > curGen=0,
    //    which the next load adopts and finishes flushing cleanly (whereas a genuinely stopped pass always has gen < curGen).
    if (migratedGens.size) {
      try {
        writeBoundedPasses();
      } catch (error) {
        // Roll back ALL unpersisted migration state (including cached passes/passOf) so a later passFor()/env()
        // does not observe an in-memory upgraded gen:1 while passes.json on disk still holds gen:0.
        genSeq = prevSeq;
        passes.clear();
        passOf.clear();
        if (strict) throw error;
        return;
      }
    }
    if (migratedGens.size || adoptedGens.size) {
      for (const [k, g] of adoptedGens) sessionGens.set(k, Math.max(sessionGens.get(k) || 0, g));
      for (const [k, g] of migratedGens) sessionGens.set(k, Math.max(sessionGens.get(k) || 0, g));
      try {
        saveGenerations();
      } catch (error) {
        if (strict) throw error;
      }
    }
  }
  loadPasses();
  loadOps();
  function writeBoundedPasses(extraPass = null, extraEntry = null) {
    const disk = readJsonStrict(passesFile, {}) || {};
    const kept = {};
    const targetKey = extraEntry ? `${extraEntry.projectId}/${extraEntry.slug}` : "";
    for (const [token, held] of Object.entries(disk)) {
      if (!held?.projectId || !held.slug) continue;
      const key = `${held.projectId}/${held.slug}`;
      if (targetKey && key === targetKey) continue;
      const gen = Number(held.gen) || 0;
      const curGen = sessionGens.get(key) || 0;
      if (gen < curGen) continue;
      kept[token] = held;
    }
    for (const [token, held] of passes.entries()) {
      const key = `${held.projectId}/${held.slug}`;
      if (targetKey && key === targetKey) continue;
      if ((held.gen || 0) < (sessionGens.get(key) || 0)) continue;
      kept[token] = held;
    }
    if (extraPass && extraEntry) kept[extraPass] = extraEntry;
    writeAtomic(passesFile, JSON.stringify(kept), { mode:0o600 });
  }
  function invalidateSession(project, slug) {
    if (!project?.id || !slug) return 0;
    const key = `${project.id}/${slug}`;
    const hadSession = passOf.has(key) || sessionGens.has(key) || [...passes.values()].some(h => h.projectId === project.id && h.slug === slug);
    if (!hadSession && !isOrchestrator(project, slug)) return 0;
    loadGenerations({ strict:true });
    const nextGen = Math.max((sessionGens.get(key) || 0) + 1, ++genSeq);
    genSeq = nextGen;
    sessionGens.set(key, nextGen);
    passOf.delete(key);
    for (const [token, held] of [...passes.entries()]) {
      if (held.projectId === project.id && held.slug === slug) passes.delete(token);
    }
    saveGenerations();
    try { writeBoundedPasses(); } catch { /* Best-effort pass pruning on stop; generation is durably bumped. */ }
    return nextGen;
  }
  function purgeLine(project, slug) {
    if (!project?.id || !slug) return;
    reviews?.purgeLine?.(project, slug);
    const key = `${project.id}/${slug}`;
    const hadGen = sessionGens.has(key);
    // Strict two-phase purge ordering using readJsonStrict (never existsSync, so only ENOENT counts as absence and
    // ELOOP/EACCES/EIO fail closed without removing the per-Line fence):
    // 1) Remove passes for this Line from passes.json FIRST while the revocation fence in generations.json stays intact.
    const passDisk = readJsonStrict(passesFile, null);
    if (passDisk && typeof passDisk === "object") {
      let removed = false;
      for (const [token, held] of Object.entries(passDisk)) {
        if (held?.projectId === project.id && held.slug === slug) { delete passDisk[token]; removed = true; }
      }
      if (removed) writeAtomic(passesFile, JSON.stringify(passDisk), { mode:0o600 });
    }
    // 2) Only after passes.json removal is durable, remove the per-Line key from generations.json while keeping monotonic `_seq`.
    const genDisk = readJsonStrict(gensFile, null);
    if (genDisk && typeof genDisk === "object") {
      const diskHasKey = Object.prototype.hasOwnProperty.call(genDisk, key);
      if (hadGen || diskHasKey) {
        const prevGen = Math.max(Number(sessionGens.get(key)) || 0, Number(genDisk[key]) || 0);
        delete genDisk[key];
        const maxSeq = Math.max(genSeq, Number(genDisk._seq) || 0, prevGen);
        if (maxSeq > 0) genDisk._seq = maxSeq;
        writeAtomic(gensFile, JSON.stringify(genDisk), { mode:0o600 });
        genSeq = maxSeq;
      }
    }
    lastWaitAt.delete(key);
    sessionGens.delete(key);
    passOf.delete(key);
    for (const [token, held] of [...passes.entries()]) {
      if (held.projectId === project.id && held.slug === slug) passes.delete(token);
    }
  }
  function sessionGenOf(project, slug) {
    if (!project?.id || !slug) return 0;
    return sessionGens.get(`${project.id}/${slug}`) || 0;
  }
  function announce(port) {
    const n = Number(port);
    if (!Number.isInteger(n) || n <= 0) return;
    announcedPort = n;
    try {
      writeAtomic(endpointFile, JSON.stringify({ url:`http://127.0.0.1:${n}/api/lines/orchestrate`, port:n, pid:process.pid, instanceId, orchToken, updatedAt:Date.now() }), { mode:0o600 });
    } catch { /* Discovery is best-effort. */ }
  }
  function identity(nonce, port = 0) {
    const raw = String(nonce || "");
    if (!NONCE_OK.test(raw)) throw failure("BAD_NONCE", "A valid nonce is required.", 400);
    const effectivePort = Number(port) || announcedPort || (() => { try { return Number(new URL(urlOf()).port) || 0; } catch { return 0; } })();
    return {
      ok:true,
      instanceId,
      port:effectivePort,
      opDedup:true,
      proof:expectedOrchProof(orchToken, raw, effectivePort, instanceId),
    };
  }
  const waits = new Set();
  const lastWaitAt = new Map();
  const guidedWorks = new Set();
  const delegatedWorks = new Set();
  const trackBounded = (set, key, max = 2000) => {
    set.delete(key);
    set.add(key);
    while (set.size > max) set.delete(set.values().next().value);
  };
  const WAIT_GRACE_MS = 90_000;
  function pruneWaitGrace(now = Date.now()) {
    for (const [k, at] of lastWaitAt) if (now - at >= WAIT_GRACE_MS) lastWaitAt.delete(k);
  }
  let records = null;
  const loadRecords = () => (records ||= (readJson(recordsFile, { records:[] }).records || []).filter(r => r && r.id));
  const saveRecords = () => writeAtomic(recordsFile, JSON.stringify({ records:loadRecords().slice(-RECORDS_MOST) }));
  function reload() {
    loadPasses({ strict:true });
    loadOps({ strict:true });
    records = null;
    indexCache = null;
  }

  // ---------- Prices ----------
  function prices() { return (readJson(pricesFile, { models:[] }).models || []).filter(m => m && m.model); }
  const writePrices = list => writeAtomic(pricesFile, JSON.stringify({ models:list }, null, 2));
  function priceEntry(body) {
    const model = clip(String(body?.model || "").trim(), 120);
    if (!model) throw failure("BAD_PRICE", "Name the model first.");
    const input = num(body.input), output = num(body.output);
    if (input === null || output === null) throw failure("BAD_PRICE", "Input and output prices are US$ per million tokens, 0 or more.");
    const entry = { model, input, output, updated:new Date().toISOString().slice(0, 10) };
    for (const field of ["cached", "cacheWrite"]) {
      if (body[field] == null || body[field] === "") continue;
      const value = num(body[field]);
      if (value === null) throw failure("BAD_PRICE", "Cache prices are US$ per million tokens, 0 or more.");
      entry[field] = value;
    }
    if (body.source) entry.source = clip(String(body.source), 300);
    return entry;
  }
  // One price, its removal, or several at once ({ models:[…] }, an AI's pasted answer): all are saved or none.
  function setPrice(body = {}) {
    const several = Array.isArray(body?.models), given = several ? body.models : [body];
    if (several && (!given.length || given.length > 200)) throw failure("BAD_PRICE", "Send 1 to 200 prices.");
    const gone = !several && body?.remove === true ? clip(String(body.model || "").trim(), 120) : "";
    if (!several && body?.remove === true && !gone) throw failure("BAD_PRICE", "Name the model first.");
    const entries = gone ? [] : given.map(priceEntry), keys = new Set([gone, ...entries.map(m => m.model)].map(m => m.toLowerCase()));
    const list = prices().filter(m => !keys.has(m.model.toLowerCase()));
    // A model named twice keeps its last price.
    if (entries.length) list.push(...new Map(entries.map(m => [m.model.toLowerCase(), m])).values());
    writePrices(list.sort((a, b) => a.model.localeCompare(b.model)));
    return { models:list };
  }
  // The model a saved agent runs: the one it names, else its app's own default, else the one its app last ran with nobody naming one.
  // A name with no price of its own ("opus") has that of the version it last ran, as when its cost is judged.
  function presetPrice(preset, list, records) {
    const ran = test => records.findLast(r => r.agent === preset.agent && concreteModel(r.model) && test(r))?.model || "";
    const model = concreteModel(preset.model) || concreteModel(service.agents?.configuredModel?.(preset.agent) || "") || concreteModel(ran(r => r.selectedModel === ""));
    const named = concreteModel(preset.model) ? preset.model : model, version = ran(r => r.model.toLowerCase() !== model.toLowerCase() && sameModel(r.model, model));
    return { model, priced:Boolean(priceFor(named, list) || priceFor(version, list)) };
  }
  // An agent on this computer that was given the prices prompt leaves its answer in this file. It is taken in when the list is next
  // read, then removed; one that cannot be read stays, and the page says so.
  const inboxFile = path.join(dir, "new-prices.json");
  function takeInbox() {
    let text = "";
    try { if (fs.statSync(inboxFile).size > 262144) throw failure("BAD_PRICE", "The file is too large."); text = fs.readFileSync(inboxFile, "utf8"); }
    catch (error) { return error.code === "ENOENT" ? { taken:0 } : { taken:0, error:`Could not read ${inboxFile}: ${error.message}` }; }
    try {
      const read = JSON.parse(text.replace(/^\uFEFF/, "")), models = Array.isArray(read) ? read : read?.models;
      if (!Array.isArray(models)) throw failure("BAD_PRICE", "it has no list of models.");
      setPrice({ models });
      fs.rmSync(inboxFile, { force:true });
      return { taken:models.length };
    } catch (error) { return { taken:0, error:`Could not read ${inboxFile}: ${error.message}` }; }
  }
  // Every price on this computer, the saved agents whose model has none, and the other models its recent Works ran that have none.
  function modelPrices() {
    const inbox = takeInbox(), list = prices(), records = loadRecords(), agents = {}, missing = new Map(), known = new Set();
    const lacking = model => { const key = model.toLowerCase(); if (!missing.has(key)) missing.set(key, { model, agents:[] }); return missing.get(key); };
    for (const preset of service.presets?.list().presets || []) {
      if (!preset.available) continue;
      const { model, priced } = presetPrice(preset, list, records);
      if (!model) continue;
      agents[preset.id] = { model, priced };
      if (priced) known.add(model.toLowerCase());
      else lacking(model).agents.push({ id:preset.id, name:preset.name, agent:preset.agent });
    }
    const since = Date.now() - ROUTE_DAYS * 86400000;
    for (const r of records) {
      const model = concreteModel(r.model || "");
      if (model && !known.has(model.toLowerCase()) && Date.parse(r.at) > since && !priceFor(r.model, list)) lacking(model);
    }
    const rows = [...missing.values()].sort((a, b) => Boolean(b.agents.length) - Boolean(a.agents.length) || a.model.localeCompare(b.model));
    return { models:list, agents, missing:rows, sync:reviews.settings().sync, inbox:{ file:inboxFile, ...inbox } };
  }
  // Each saved key has its own price. Model variants and provider aliases can cost different amounts.
  function costOf(tokens, price) {
    const usd = estimate(tokens, price);
    return usd == null ? null : Math.round(usd * 10000) / 10000;
  }

  // ---------- Records: who was given which job, and how it went ----------
  function record(fields) {
    if ("model" in fields) fields = { ...fields, model:concreteModel(fields.model) };
    const list = loadRecords(), at = list.findIndex(r => r.project === fields.project && r.line === fields.line && r.work && r.work === fields.work);
    if (at >= 0) { list[at] = { ...list[at], ...fields, id:list[at].id }; saveRecords(); return list[at]; }
    const made = { id:randomUUID().slice(0, 8), at:new Date().toISOString(), ...fields };
    list.push(made); saveRecords();
    return made;
  }
  const recordsOf = project => loadRecords().filter(r => r.project === project.id);
  const recordedModelRow = row => "model" in row ? { ...row, model:concreteModel(row.model) } : row;
  const workPriceModel = (station, record) => priceModelOf(station) || (!station.selected ? record?.model : "");

  function scoresByLine(project) {
    const lines = new Map();
    for (const r of recordsOf(project)) {
      const isReview = isReviewWork(null, r);
      const effScore = effectiveScore(r);
      const recScope = normalizeScope(r.scope);
      if (effScore == null && !r.review && !isReview && !recScope) continue;
      if (!lines.has(r.line)) lines.set(r.line, []);
      lines.get(r.line).push(isReview ? { work:r.work, isReview:true }
        : {
          work:r.work,
          ...(effScore != null ? { score:effScore } : {}),
          ...(r.ignored ? { ignored:true } : {}),
          ...(r.source ? { source:r.source } : {}),
          ...(recScope ? { scope:recScope, ...(r.scopeSource ? { scopeSource:r.scopeSource } : {}) } : {}),
          note:r.note || "",
          scoredAt:r.scoredAt || r.at || "",
          by:r.scoredBy || r.by || "",
          ...(r.review ? { review:r.ignored ? { ...r.review, ignored:true } : r.review } : {}),
        });
    }
    // A Work its reviewer is reading now: said on the Line until the review card takes its place.
    for (const item of reviews.reviewingIn(project)) {
      const { line, work, ...meta } = item;
      if (!lines.has(line)) lines.set(line, []);
      const row = lines.get(line).find(x => x.work === work);
      const reviewPending = meta.by ? meta : null;
      if (row) { row.reviewing = true; if (reviewPending) row.reviewPending = reviewPending; }
      else lines.get(line).push({ work, reviewing:true, ...(reviewPending ? { reviewPending } : {}) });
    }
    // A review that was stopped or failed unexpectedly stays visible so the person can continue or resend it.
    for (const item of reviews.stoppedIn(project)) {
      const { line, work, ...meta } = item;
      if (!lines.has(line)) lines.set(line, []);
      const row = lines.get(line).find(x => x.work === work);
      if (row) { if (!row.reviewing) row.reviewStopped = meta; }
      else lines.get(line).push({ work, reviewStopped:meta });
    }
    for (const scores of lines.values()) scores.sort((a, b) => a.work.localeCompare(b.work));
    return lines;
  }
  const scoresForLine = (project, slug) => scoresByLine(project).get(slug) || [];

  // ---------- Reading the project ----------
  const stateOf = project => service.stateOf(project);
  function lineOf(project, slug) {
    const l = allLines(stateOf(project)).find(x => x.id === String(slug || "") || x.code === String(slug || ""));
    if (!l) throw failure("NOT_FOUND", `There is no Line "${clip(String(slug || ""), 80)}". Use overview for the Lines.`, 404);
    return l;
  }
  function orchestratorOf(project, slug) {
    try { return service.parsedDoc(project, slug).front["orchestrated by"] || ""; } catch { return ""; }
  }
  function overview(project, { status = "" } = {}) {
    const lines = allLines(stateOf(project)).filter(l => (status ? l.status === status : !l.archived));
    return { project:project.name, lines:lines.map(l => {
      const works = l.stations.filter(isWork), by = orchestratorOf(project, l.id);
      return { ref:l.code || "", line:l.id, title:l.title, status:l.status, ...(l.todo ? { todo:true } : {}), agent:l.agent || "", running:Boolean(l.running), works:works.length, open:works.filter(s => s.state !== "done" && s.state !== "off").length, toReview:works.filter(s => LINE_STATUS.canReview(s) && !s.reviewed).length, ...(l.questions?.length ? { questions:l.questions.map(q => q.text) } : {}), ...(by ? { by } : {}), ...(l.branch ? { branch:l.branch } : {}) };
    }) };
  }
  function lineView(project, slug) {
    const l = lineOf(project, slug), list = prices(), mine = recordsOf(project).filter(r => r.line === l.id);
    let savedAsks = null;
    if (l.stations.some(s => s.kind === "ask" && s.unsent) && typeof service.parsedDoc === "function") {
      try { savedAsks = new Map(service.parsedDoc(project, l.id).asks.map(a => [a.id, a])); } catch {}
    }
    return { ref:l.code || "", line:l.id, title:l.title, status:l.status, running:l.running, revision:l.topicHash, branch:l.branch || "", ...(l.questions?.length ? { questions:l.questions.map(q => ({ text:q.text, options:q.options })) } : {}),
      steps:l.stations.filter(s => s.kind === "ask" || isWork(s)).map(s => {
        if (s.kind === "ask") {
          const askKind = storedKind(savedAsks?.get(s.id)?.held?.kind || s.held?.kind);
          return { ask:clip(String(s.text || ""), 600), step:s.id, unsent:s.unsent, ...(s.savedAgentId ? { savedAgentId:s.savedAgentId } : {}), ...(askKind ? { kind:askKind } : {}) };
        }
        const r = mine.find(x => x.work === s.id), priceModel = workPriceModel(s, r), isReview = isReviewWork(s, r);
        const kind = resolvedWorkKind(l, s, r);
        const effScore = effectiveScore(r) ?? (!s.orchIgnored && s.review?.verdict !== "unverified" ? scoreIn(s.orchScore) : null);
        const noteText = r?.note || s.orchNote || "";
        return { work:s.id, label:s.label, ...(kind ? { kind } : {}), agent:s.agent, savedAgent:s.savedAgent || r?.presetName || "", model:concreteModel(priceModel), state:s.state, took:s.took || "", tokens:s.tokens ? { input:s.tokens.inputTokens, output:s.tokens.outputTokens } : null, cost:costOf(s.tokens, priceFor(priceModel, list)), summary:clip(String(s.out || ""), 600), reviewed:Boolean(s.reviewed), ...(!isReview && s.rating ? { personRating:s.rating } : {}), ...(!isReview && effScore != null ? { score:effScore, note:noteText } : {}), ...(s.diff ? { diff:s.diff } : {}) };
      }) };
  }
  function workView(project, { line, work }) {
    const l = lineOf(project, line), s = l.stations.find(x => x.id === String(work || ""));
    if (!s || !isWork(s)) throw failure("NOT_FOUND", "That Work is not on this Line. Use line for its Works.", 404);
    const r = recordsOf(project).find(x => x.line === l.id && x.work === s.id);
    const kind = resolvedWorkKind(l, s, r);
    // Keep the original Markdown, including link-only evidence and the end of long answers.
    const result = s.detail && service.store.exists(project, s.detail) ? F.sectionText(service.store.readText(project, s.detail).text, "Result") : s.out || "";
    return { line:l.id, work:s.id, ...(kind ? { kind } : {}), agent:s.agent, state:s.state, took:s.took || "", result, diff:s.diff || null, detail:s.detail ? service.store.full(project, s.detail) : "" };
  }
  function agents() {
    const list = service.presets?.list() || { presets:[] };
    const eligible = list.presets.filter(p => !p.auto && p.allowDelegation !== false && p.available);
    return { default:eligible.some(p => p.id === list.default) ? list.default : "",
      agents:eligible.map(p => ({ id:p.id, name:p.name, runner:p.agent, model:p.model || "", effort:p.effort || "", canRun:true })) };
  }
  function assignmentPreset(id) {
    const offered = agents().agents;
    const preset = offered.find(p => p.id === id);
    if (!preset) throw failure("BAD_AGENT", offered.length
      ? "Choose a preset returned by agents. It must allow orchestrator assignments and be runnable."
      : "No saved preset can take an assignment. In Settings → Agents, enable Allow orchestrator assignments for a runnable preset.");
    return service.presets.get(preset.id);
  }

  // ---------- Statistics ----------
  function activePriceLookup(project, lines) {
    for (const l of lines) {
      if (!l.running && (l.archived || !["working", "waiting"].includes(l.status))) continue;
      if (l.job === MODEL_PRICES || (legacyPriceGoal(l.ask?.text) && isOrchestrator(project, l.id))) {
        return { line:l.id, status:l.status === "waiting" ? "waiting" : "working" };
      }
    }
    return null;
  }
  // Runtime effort from the runner takes precedence; otherwise honor a recorded preset selection (including Default "")
  // before falling back to an assignment record for older Works that predate `selected`.
  const EFFORT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
  const effortOf = (station, fallback = "") => station?.picked?.effort || (station?.selected ? station.selected.effort || "" : fallback || "");
  // Every Work of the project, not only the orchestrator's, so its first plan already has history: what both stats and plan count.
  function history(project, { since = 0, state = null } = {}) {
    const list = prices(), assignments = new Map(recordsOf(project).map(r => [`${r.line}\0${r.work}`, r])), items = [];
    const lines = allLines(state || stateOf(project));
    const childCounts = new Map();
    for (const l of lines) {
      if (l.orchestratedBySlug) childCounts.set(l.orchestratedBySlug, (childCounts.get(l.orchestratedBySlug) || 0) + 1);
      if (l.orchestratedBy) childCounts.set(`ref:${l.orchestratedBy}`, (childCounts.get(`ref:${l.orchestratedBy}`) || 0) + 1);
    }
    for (const l of lines) {
      const childCount = Math.max(childCounts.get(l.id) || 0, l.orchestratorRef ? (childCounts.get(`ref:${l.orchestratorRef}`) || 0) : 0);
      let firstWorkId = "";
      for (const s of l.stations) {
        if (!isWork(s) || s.state === "todo") continue;
        if (!firstWorkId) firstWorkId = s.id;
        let r = assignments.get(`${l.id}\0${s.id}`);
        if (s.review && (!r?.review || (s.review.at && (!r.review.at || s.review.at >= r.review.at)))) {
          const storedIgnored = Boolean(s.orchIgnored || s.review.ignored);
          const storedScore = !storedIgnored && s.review.verdict !== "unverified" ? scoreIn(s.orchScore ?? s.review.score) : null;
          r = {
            ...(r || { line:l.id, work:s.id, agent:s.agent || "", preset:s.savedAgentId || "", presetName:s.savedAgent || "" }),
            score:storedScore,
            ignored:storedIgnored,
            source:s.orchSource || s.review.source || "reviewer",
            ...(s.review.verdict ? { verdict:s.review.verdict } : {}),
            ...(s.review.findings ? { findings:s.review.findings } : {}),
            note:s.orchNote || s.review.note || "",
            scoredAt:s.orchScoredAt || s.review.at || r?.scoredAt || "",
            scoredBy:s.orchBy || s.review.by || r?.scoredBy || "",
            review:s.review,
          };
        }
        const when = s.startedAt || labelMs(s.when) || Date.parse(r?.scoredAt || r?.at);
        if (since && !(when >= since)) continue;
        const priceModel = workPriceModel(s, r), model = concreteModel(priceModel);
        const isReview = isReviewWork(s, r), kind = resolvedWorkKind(l, s, r);
        const ask = askForWork(l, s);
        const askText = ask?.text || (s.id === firstWorkId ? l.ask?.text || "" : "");
        const effScore = isReview ? null : effectiveScore(r);
        const safety = r?.safety ?? r?.review?.safety ?? s.review?.safety ?? null;
        const resolved = isReview
          ? { scope:"standard", trivial:false, source:"review" }
          : resolveWorkScope({
              askText,
              kind,
              route:l.route || "",
              childCount,
              diff:s.diff || null,
              hasOutputs:Boolean(s.outputs?.length),
              hasCanvas:Boolean(s.canvas || s.pictures?.length || ask?.canvas),
              hasAttachments:Boolean(ask?.files?.length || (s.id === firstWorkId && l.ask?.files?.length)),
              userScope:s.scope || "",
              recordScope:r?.scope || "",
              recordScopeSource:r?.scopeSource || (l.orchestratedBy || l.orchestratedBySlug ? "orchestrator" : ""),
              safety,
              score:effScore,
            });
        items.push({ l, s, r, model, kind, scope:resolved.scope, scopeSource:resolved.source, trivial:resolved.trivial, isReview,
          name:s.savedAgent || r?.presetName || [s.agent, model].filter(Boolean).join(" · ") || "agent",
          preset:s.savedAgentId || r?.preset || "", effort:effortOf(s, r?.effort || ""),
          tokens:s.tokens?.inputTokens != null && s.tokens?.outputTokens != null ? s.tokens : null, cost:estimate(s.tokens, priceFor(priceModel, list)) });
      }
    }
    return items;
  }
  // Anonymous agent results for the usage report (usage-stats.js): per UTC start day, agent app, model, effort, kind
  // and difficulty scope, the same Works, outcomes, scores, time and cost Statistics shows. Never a Line, project, prompt or id.
  // Trivial test/ping messages are excluded (PE-1087). When `ranOn` is given (Cloud upload), only Works owned by this install
  // (matching `ran on`, or pre-upgrade Works with step-level local execution provenance in this install's private state folder)
  // are included so shared/synced projects are never counted twice across installs (PE-817). `strict: true` performs a fail-closed scan.
  function agentDays(project, { from, to, fromAt = 0, ranOn = "", requireRanOnFrom = "", strict = false }) {
    const state = strict && typeof service.strictStateOf === "function" ? service.strictStateOf(project) : stateOf(project);
    const rows = new Map(), items = new Map(history(project, { state }).map(w => [`${w.l.id}\0${w.s.id}`, w]));
    const startMs = w => w.s.startedAt || labelMs(w.s.when) || 0;
    const rowOf = w => {
      if (w.isReview || w.trivial) return null;
      const runner = String(w.s.agent || w.r?.agent || "").toLowerCase(), at = startMs(w), day = at ? new Date(at).toISOString().slice(0, 10) : "";
      // Built-in PenEcho Agent ratings are neither counted in the Agent index nor uploaded (PE-782).
      // Exclude by runner only so third-party agents with custom or UUID-shaped model IDs remain eligible.
      if (!/^[a-z][a-z0-9]{1,23}$/.test(runner) || !day || day < from || day > to || AgentIndex.isExcludedRating({ runner })) return null;
      if (fromAt && at < fromAt) return null;
      if (ranOn) {
        const owner = String(w.s.ranOn || "").trim();
        if (owner) {
          if (owner !== ranOn) return null;
        } else {
          if (requireRanOnFrom && day >= requireRanOnFrom) return null;
          if (!service.hasWorkProvenance?.(project, w.l.id, w.s.id)) return null;
        }
      }
      const model = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/.test(w.model) ? w.model : "";
      const rawEffort = String(w.effort || "").trim(), effort = EFFORT_RE.test(rawEffort) ? rawEffort.toLowerCase() : "";
      const scope = normalizeScope(w.scope) || "standard";
      const key = JSON.stringify([day, runner, model.toLowerCase(), effort, w.kind, scope]);
      let row = rows.get(key);
      if (!row) rows.set(key, row = { day, runner, model, effort, kind:w.kind, scope, works:0, finished:0, failed:0, stopped:0, followups:0, scoreSum:0, scoreCount:0, passCount:0, passSum:0, negWeight:0, negWeightedSum:0, good:0, bad:0, minutes:0, tokens:0, costUsd:0, tokensIn:0, tokensOut:0, tokensCached:0 });
      return row;
    };
    for (const w of items.values()) {
      const row = rowOf(w);
      if (!row) continue;
      row.works++;
      if (w.s.state === "done") { row.finished++; row.minutes += tookMin(w.s.took); }
      else if (w.s.state === "off") row.stopped++;
      else if (w.s.state === "error") row.failed++;
      // Input, cached input and output apart, so penecho.ai can work out cost at its own prices (PE-742).
      if (w.tokens) { row.tokens += (w.tokens.inputTokens || 0) + (w.tokens.outputTokens || 0); row.tokensIn += w.tokens.inputTokens || 0; row.tokensOut += w.tokens.outputTokens || 0; row.tokensCached += w.tokens.cacheReadInputTokens || 0; }
      if (Number.isFinite(w.cost) && w.cost > 0) row.costUsd += w.cost;
      const score = effectiveScore(w.r);
      if (score != null) {
        row.scoreSum += score;
        row.scoreCount++;
        const delta = scoreAggregateDelta(score);
        if (delta) {
          row.passCount += delta.passCount;
          row.passSum += delta.passSum;
          row.negWeight += delta.negWeight;
          row.negWeightedSum += delta.negWeightedSum;
        }
      }
      if (w.s.rating === "good") row.good++; else if (w.s.rating === "bad") row.bad++;
    }
    // A new Ask on a Line after a finished Work: that Work needed a correction or more.
    for (const l of allLines(state)) {
      let last = null;
      for (const s of l.stations) {
        if (isWork(s)) last = s.state === "done" ? s : null;
        else if (s.kind === "ask" && !s.unsent && last) { const w = items.get(`${l.id}\0${last.id}`), row = w && rowOf(w); if (row) row.followups++; last = null; }
      }
    }
    return [...rows.values()].map(row => ({
      ...row,
      scoreSum:Math.round(row.scoreSum * 10) / 10,
      passSum:Math.round(row.passSum * 10) / 10,
      negWeight:Math.round(row.negWeight * 100) / 100,
      negWeightedSum:Math.round(row.negWeightedSum * 100) / 100,
      minutes:Math.round(row.minutes * 10) / 10,
      costUsd:Math.round(row.costUsd * 10000) / 10000,
    }));
  }
  // One rating per Work from the coordinator's 1-5 and the person's own good or not (PE-706). The person lives with the result,
  // so theirs counts twice: 4/5 and good make 4.3, 4/5 and not good make 2.7. Either alone is the rating.
  // Not good means it fell short, not that it was worthless: 2/5, so one thumbs-down does not outweigh a record (PE-660).
  // Good is 4.5, not 5: the rubric keeps 5 for complete, verified work, so a casual thumbs-up does not outrank a strict 4.
  const OWN = { good:4.5, bad:2 };
  function workRating(score, rating) {
    const orch = scoreIn(score), own = OWN[rating] ?? null;
    return orch == null ? own : own == null ? orch : (orch + 2 * own) / 3;
  }
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  // Per agent, the model it actually ran, effort and kind of job (PE-701): a saved agent recreated or renamed, here or on another
  // computer, keeps its record. Without a recorded model the Works stay with their saved agent, so unknowns are not lumped together.
  const recordName = (runner, model, effort) => service.presets?.nameFor?.({ agent:runner, model, effort }) || [runner, model, effort ? `${effort} effort` : ""].filter(Boolean).join(" · ");
  function stats(project, { kind = "", days = 0 } = {}) {
    const filterKind = storedKind(kind) || kindKey(kind);
    const list = prices(), mine = recordsOf(project), since = Number(days) > 0 ? Date.now() - Number(days) * 86400000 : 0, groups = new Map(), ratings = [], daily = new Map();
    for (const w of history(project, { since })) {
      const workKind = w.isReview ? "" : w.kind;
      if (filterKind && workKind !== filterKind) continue;
      const { l, s, r, model } = w, runner = s.agent || r?.agent || "";
      // Works per local day, kind of job and agent app, for the Statistics page's by-day chart.
      const startedAt = s.startedAt || labelMs(s.when) || 0;
      if (startedAt && workKind) {
        const d = new Date(startedAt), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const dayKey = `${day}\0${workKind}\0${runner}`, row = daily.get(dayKey) || { day, kind:workKind, runner, works:0 };
        row.works++; daily.set(dayKey, row);
      }
      const key = JSON.stringify(model ? [runner, model.toLowerCase(), w.effort, workKind] : [runner, "", w.effort, workKind, w.preset || w.name]);
      const g = groups.get(key) || { preset:w.preset, agent:model ? recordName(runner, model, w.effort) : w.name, runner, model, effort:w.effort, kind:workKind, names:new Set(), at:0, works:0, finished:0, failed:0, running:0, minutes:[], tokens:0, tokensKnown:0, cost:0, costKnown:0, scores:[], rated:[], good:0, bad:0, sources:{}, findings:{} };
      const at = s.startedAt || labelMs(s.when) || 0;
      if (at >= g.at && w.preset) { g.at = at; g.preset = w.preset; }
      if (s.savedAgent || r?.presetName) g.names.add(s.savedAgent || r.presetName);
      g.works++;
      if (s.state === "done") g.finished++; else if (s.state === "off" || s.state === "error") g.failed++; else g.running++;
      if (tookMin(s.took)) g.minutes.push(tookMin(s.took));
      if (w.tokens) { g.tokens += (w.tokens.inputTokens || 0) + (w.tokens.outputTokens || 0); g.tokensKnown++; }
      if (w.cost != null) { g.cost += w.cost; g.costKnown++; }
      if (!w.isReview && !w.trivial) {
        const eff = effectiveScore(r);
        if (eff != null) {
          const source = ratingSourceOf(r);
          g.scores.push(eff);
          addSourceScore(g.sources, source, eff);
          const verdict = r?.review?.verdict || r?.verdict || "";
          ratings.push({ line:l.id, ref:l.code || "", title:l.title, work:s.id, label:s.label, agent:w.name, runner:s.agent, model, kind:workKind, scope:w.scope,
            score:eff, source, ...(verdict ? { verdict } : {}), note:r.note || "", scoredAt:r.scoredAt || r.at || "", by:r.scoredBy || r.by || "" });
        }
        addFindingCounts(g.findings, reviewFindingsOf(r));
        if (s.rating === "good") g.good++; else if (s.rating === "bad") g.bad++;
        const rated = workRating(eff, s.rating);
        if (rated != null) g.rated.push(rated);
      }
      groups.set(key, g);
    }
    const rows = [...groups.values()].map(g => {
      const bySource = summarizeSources(g.sources), findings = summarizeFindings(g.findings);
      return { preset:g.preset, agent:g.agent, savedAgents:[...g.names].filter(n => n !== g.agent).sort(), runner:g.runner, model:g.model, effort:g.effort, kind:g.kind, works:g.works, running:g.running, medianMinutes:median(g.minutes), tokensPerWork:g.tokensKnown ? Math.round(g.tokens / g.tokensKnown) : null, tokensKnown:g.tokensKnown, costPerWork:g.costKnown ? Math.round(10000 * g.cost / g.costKnown) / 10000 : null, costKnown:g.costKnown, totalCost:g.costKnown ? round(g.cost, 4) : null, score:round(mean(g.scores), 1), scored:g.scores.length, rating:round(mean(g.rated), 1), rated:g.rated.length, good:g.good, bad:g.bad, ...(bySource ? { bySource } : {}), ...(findings ? { findings } : {}) };
    });
    rows.sort((a, b) => b.works - a.works || a.agent.localeCompare(b.agent));
    ratings.sort((a, b) => b.scoredAt.localeCompare(a.scoredAt));
    const lookup = activePriceLookup(project, allLines(stateOf(project))) || (priceStarts.has(project.id) ? { status:"starting" } : null);
    return { kinds:KINDS, rows, ratings:ratings.slice(0, 50), daily:[...daily.values()].sort((a, b) => a.day.localeCompare(b.day)), priced:list.length, recorded:mine.length, activePriceLookup:lookup };
  }

  // The Statistics page's Agent index (PE-742): every project on this computer, cached for a minute.
  let indexCache = null;
  function index({ days = 0, scope = "all" } = {}) {
    const n = Number(days) > 0 ? Math.min(3650, Math.round(Number(days))) : 0, activeScope = normalizeScope(scope) || "all", key = `${n}:${activeScope}`;
    if (indexCache?.key === key && Date.now() - indexCache.at < 60000) return indexCache.value;
    const today = new Date().toISOString().slice(0, 10), from = n ? new Date(Date.now() - (n - 1) * 86400000).toISOString().slice(0, 10) : "2000-01-01";
    const projects = service.store.projects.filter(p => !p.myCanvases);
    const rows = projects.flatMap(project => { try { return agentDays(project, { from, to:today }); } catch { return []; } });
    const value = AgentIndex.agentIndex(rows, { from:n ? from : "", to:today, projects:projects.length, scope:activeScope });
    indexCache = { key, at:Date.now(), value };
    return value;
  }

  // The Orchestrator page's Agents list (PE-706): each agent, the model it ran and its effort, over every kind of job, with its
  // combined rating, average tokens and cost per Work, and its rating by kind of job for the detail it opens.
  function agentRecord(project) {
    const groups = new Map();
    for (const w of history(project)) {
      const { s, r, model } = w, runner = s.agent || r?.agent || "";
      const id = JSON.stringify(model ? [runner, model.toLowerCase(), w.effort] : [runner, "", w.effort, w.preset || w.name]);
      const g = groups.get(id) || { id, agent:model ? recordName(runner, model, w.effort) : w.name, runner, model, effort:w.effort, names:new Set(), kinds:new Map(),
        works:0, finished:0, failed:0, good:0, bad:0, rated:0, ratingSum:0, scored:0, scoreSum:0, tokens:0, tokenSum:0, costs:0, costSum:0, sources:{}, findings:{} };
      if (s.savedAgent || r?.presetName) g.names.add(s.savedAgent || r.presetName);
      const tokens = w.tokens ? (w.tokens.inputTokens || 0) + (w.tokens.outputTokens || 0) : null, score = w.isReview || w.trivial ? null : effectiveScore(r);
      const source = score != null ? explicitSourceOf(r) : "";
      const findings = w.isReview || w.trivial ? [] : reviewFindingsOf(r);
      const own = !w.isReview && !w.trivial && (s.rating === "good" || s.rating === "bad") ? s.rating : "", rating = workRating(score, own);
      const done = s.state === "done", failed = s.state === "off" || s.state === "error";
      g.works++;
      if (done) g.finished++; else if (failed) g.failed++;
      if (tokens != null) { g.tokens++; g.tokenSum += tokens; }
      if (w.cost != null) { g.costs++; g.costSum += w.cost; }
      if (score) { g.scored++; g.scoreSum += score; addSourceScore(g.sources, source, score); }
      addFindingCounts(g.findings, findings);
      if (own === "good") g.good++; else if (own === "bad") g.bad++;
      if (rating != null) { g.rated++; g.ratingSum += rating; }
      if (w.kind) {
        const k = g.kinds.get(w.kind) || { kind:w.kind, works:0, finished:0, failed:0, good:0, bad:0, rated:0, ratingSum:0, scored:0, scoreSum:0, sources:{}, findings:{} };
        k.works++;
        if (done) k.finished++; else if (failed) k.failed++;
        if (score) { k.scored++; k.scoreSum += score; addSourceScore(k.sources, source, score); }
        addFindingCounts(k.findings, findings);
        if (own === "good") k.good++; else if (own === "bad") k.bad++;
        if (rating != null) { k.rated++; k.ratingSum += rating; }
        g.kinds.set(w.kind, k);
      }
      groups.set(id, g);
    }
    const agents = [...groups.values()].map(g => {
      const byKind = [...g.kinds.values()].sort((a, b) => b.works - a.works || a.kind.localeCompare(b.kind)).map(k => {
        const kSources = summarizeSources(k.sources), kFindings = summarizeFindings(k.findings);
        return {
          kind:k.kind, works:k.works, running:k.works - k.finished - k.failed,
          rating:round(k.rated ? k.ratingSum / k.rated : null, 1), rated:k.rated,
          score:round(k.scored ? k.scoreSum / k.scored : null, 1), scored:k.scored, good:k.good, bad:k.bad,
          ...(kSources ? { bySource:kSources } : {}), ...(kFindings ? { findings:kFindings } : {}),
        };
      });
      const gSources = summarizeSources(g.sources), gFindings = summarizeFindings(g.findings);
      return { id:g.id, agent:g.agent, runner:g.runner, model:g.model, effort:g.effort, savedAgents:[...g.names].filter(n => n !== g.agent).sort(), byKind,
        works:g.works, running:g.works - g.finished - g.failed,
        rating:round(g.rated ? g.ratingSum / g.rated : null, 1), rated:g.rated,
        score:round(g.scored ? g.scoreSum / g.scored : null, 1), scored:g.scored, good:g.good, bad:g.bad,
        ...(gSources ? { bySource:gSources } : {}), ...(gFindings ? { findings:gFindings } : {}),
        tokensPerWork:g.tokens ? Math.round(g.tokenSum / g.tokens) : null, tokensKnown:g.tokens,
        costPerWork:g.costs ? round(g.costSum / g.costs, 4) : null, costKnown:g.costs, cost:g.costs ? round(g.costSum, 4) : null };
    });
    agents.sort((a, b) => b.works - a.works || a.agent.localeCompare(b.agent));
    return { agents };
  }

  // ---------- Routing (PE-660): who should own each part, from each preset's history and price ----------
  // Coordinators kept every job to themselves when the brief only allowed delegation. Now they see, in their prompt and from plan,
  // what each eligible preset would likely cost to finish a Work well next to their own cost, and record the route they chose.
  const ROUTE_DAYS = 60, ROUTES = ["self", "delegate", "split"];
  // Briefing a part and reading its result back, in the coordinator's tokens.
  const HANDOFF = { inputTokens:40000, outputTokens:4000 };
  // "opus" names the same model as "claude-opus-5-5"; "gpt-6-astra" is not "gpt-6.2-astra".
  function sameModel(a, b) {
    a = String(a || "").trim().toLowerCase(); b = String(b || "").trim().toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    return /^[a-z]+$/.test(short) && long.split(/[-/_.\s]+/).includes(short);
  }
  const presetRow = p => p && { id:p.id, name:p.name || p.id, runner:p.agent || p.runner || "", model:p.model || "", effort:p.effort || "" };
  // A later Ask on the same job can run with another agent: the coordinator is the one running now, with the model and effort it runs with.
  function selfPreset(project, session) {
    if (!session) return null;
    try {
      const works = lineOf(project, session).stations.filter(isWork), now = works.findLast(s => s.state === "active") || works.at(-1);
      const preset = now?.savedAgentId ? presetRow(service.presets?.get(now.savedAgentId)) : null;
      return preset && { ...preset, model:priceModelOf(now) || preset.model, effort:effortOf(now, preset.effort) };
    } catch { return null; }
  }
  const round = (n, places = 2) => n == null ? null : Math.round(n * 10 ** places) / 10 ** places;
  const SETTLED = new Set(["done", "off", "error"]);
  // A Work's stop why comes from its detail file (stop-why.js); a Line PenEcho left stopped when it closed says so in its why.
  const cutOff = w => w.s.state !== "done" && (w.s.stopWhy === "limit" || /^PenEcho closed while this was running/.test(w.s.why || ""));
  // byRunner: settled Works by the agent that ran them. Every match is the same runner; the preset id only counts while its model is the same.
  function judge(preset, byRunner, kind, typical, list, handoff, configured = "", scope = "standard", defaultEffort = "") {
    const targetScope = normalizeScope(scope) || "standard";
    const mine = (byRunner.get(preset.runner) || []).filter(w => !w.trivial);
    const selected = concreteModel(preset.model), defaultModel = concreteModel(configured);
    const effectiveEffort = String(preset.effort || defaultEffort || "").trim();
    const sameEffVal = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    const exact = (a, b) => a.toLowerCase() === b.toLowerCase();
    const usesDefault = w => !concreteModel(w.s.selected ? w.s.selected.model : (w.r?.selectedModel ?? w.r?.model));
    // Match the effective effort when known (preset or CLI configured default); otherwise distinguish default-effort runs from explicit-effort runs.
    const sameEffort = effectiveEffort
      ? w => Boolean(w.effort) && sameEffVal(w.effort, effectiveEffort)
      : w => ((w.s.selected ? w.s.selected.effort : w.r ? w.r.effort : w.effort) || "") === "";
    const effortFits = w => !effectiveEffort || !w.effort || sameEffVal(w.effort, effectiveEffort);
    const chose = w => Boolean((w.s.selected ? w.s.selected.effort : w.r?.effort) || "");
    const ownEffort = effectiveEffort ? effortFits : w => !chose(w);
    const observed = w => w.model && (!concreteModel(w.s.resolvedModel) || concreteModel(w.s.picked?.model) || concreteModel(w.s.tokens?.requestModel) || concreteModel(w.s.tokens?.lastRequest?.model));
    const latestDefault = !selected && !defaultModel ? mine.filter(w => observed(w) && usesDefault(w) && (w.preset === preset.id ? ownEffort(w) : sameEffort(w)))
      .reduce((a, w) => w.at > (a?.at || 0) ? w : a, null) : null;
    const target = selected || defaultModel || latestDefault?.model || "";
    const compareModel = latestDefault ? exact : sameModel;
    let fits = target ? w => compareModel(w.model, target) : usesDefault;
    let resolvedTarget = target;
    // An alias ("opus") can match several versions over time: use the one it ran most recently.
    if (target && !latestDefault && !mine.some(w => exact(w.model, target))) {
      const latest = mine.filter(fits).reduce((a, w) => (w.at > (a?.at || 0) ? w : a), null);
      if (latest) { resolvedTarget = latest.model; fits = w => exact(w.model, latest.model); }
    }
    const sameSetup = w => fits(w) && (!latestDefault || usesDefault(w));
    const tiers = [
      [selected || defaultModel ? "same agent, model and effort" : "same agent, default model and effort", w => sameSetup(w) && (w.preset === preset.id ? ownEffort(w) : sameEffort(w))],
      ["same agent and model", w => target && fits(w) && (effectiveEffort ? effortFits(w) : !chose(w))],
    ];
    let basis = "", matched = [];
    for (const [name, test] of tiers) { matched = mine.filter(test); if (matched.length) { basis = name; break; } }
    const ofKind = kind ? matched.filter(w => w.kind === kind) : [];
    const use = ofKind.filter(w => w.s.state === "done").length >= 3 ? ofKind : matched;
    // Finish rate is neither counted nor shown (PE-660): a run stopped by the person or a coordinator says nothing about the agent
    // (people stop runs when they find they missed something), nor does one cut off by a limit or an error. Its record is its finished Works.
    const counted = use.filter(w => w.s.state === "done");
    // Its ratings, except where its provider's usage or rate limit, or PenEcho closing, cut it off, or the ask was trivial.
    const eligibleRating = w => !w.isReview && !w.trivial && !cutOff(w);
    const ratedOf = xs => xs.filter(eligibleRating).map(w => workRating(effectiveScore(w.r), w.s.rating)).filter(n => n != null);
    const rated = use.filter(eligibleRating), good = rated.filter(w => w.s.rating === "good").length, bad = rated.filter(w => w.s.rating === "bad").length;
    const buckets = emptyTierBuckets();
    const scores = [];
    for (const w of rated) {
      const val = workRating(effectiveScore(w.r), w.s.rating);
      if (val == null) continue;
      scores.push(val);
      addScoreToBucket(buckets[normalizeScope(w.scope) || "standard"], val, 1, 1);
    }
    const score = mean(scores);
    const provenScope = provenScopeOf(buckets);
    const lightOnly = provenScope === "light";
    const lightRated = buckets.light.rated, standardRated = buckets.standard.rated, heavyRated = buckets.heavy.rated;
    const lightAvg = lightRated > 0 ? (buckets.light.passSum + buckets.light.failSum) / lightRated : null;
    // A short record counts for little: four imagined Works at 4/5, a normal good pass, so one lucky or poor rating moves it only a little.
    // A weaker family starts it lower: the same agent and model at other efforts (for a preset on the default effort, those whose Ask
    // chose one), from 3 ratings. A stronger family does not start it higher, or two poor ratings of its own would not show.
    const otherEffort = effectiveEffort ? w => !effortFits(w) : chose;
    const family = target ? ratedOf(mine.filter(w => w.model && fits(w) && otherEffort(w) && !use.includes(w))) : [];
    // When the person has synced, its rating on penecho.ai is where it starts (orch-review.js), counted as five ratings; else 4, as four.
    // That is only the start: its own ratings here are never replaced, and each one moves it. Only those go to penecho.ai (usageReport).
    const base = reviews.cloudStart(preset.runner, resolvedTarget, effectiveEffort, kind), imagined = base == null ? 4 : 5;
    const start = Math.min(base ?? 4, family.length >= 3 ? mean(family) : 5);
    const tiered = scores.length ? tierRating(buckets, targetScope, { prior:start, priorWeight:imagined }) : null;
    const quality = tiered ? tiered.rating / 5 : null;
    // An occasional poor rating is one; a pattern is two. Two ratings of 2.5 or less end its trials.
    const poor = scores.filter(n => n <= 2.5).length;
    const models = new Map();
    for (const w of use) if (w.model) models.set(w.model, (models.get(w.model) || 0) + 1);
    const usual = [...models].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const priceTarget = selected ? preset.model : defaultModel ? configured : target;
    const price = priceFor(priceTarget, list) || priceFor(usual, list) || null;
    const ofScope = w => (normalizeScope(w.scope) || "standard") === targetScope;
    const measuredScoped = counted.filter(w => w.cost != null && ofScope(w)).map(w => w.cost);
    const measured = measuredScoped.length >= 2 ? measuredScoped : counted.filter(w => w.cost != null).map(w => w.cost);
    // Too few of its own: a typical finished Work's tokens at its price, from the same agent app and difficulty scope first,
    // then same kind, so one app's cache tokens or Light-only costs are not projected onto Standard/Heavy tasks.
    const tokensOf = test => mine.filter(w => w.s.state === "done" && w.tokens && test(w)).map(w => w.tokens);
    const ofThisKind = w => !kind || w.kind === kind;
    const pool = [
      w => fits(w) && ofThisKind(w) && ofScope(w),
      w => fits(w) && ofThisKind(w),
      w => fits(w) && ofScope(w),
      fits,
      w => ofThisKind(w) && ofScope(w),
      ofThisKind,
      () => true,
    ].map(tokensOf).find(t => t.length >= 3) || typical;
    let cost = null, costBasis = "";
    if (measured.length >= 2) { cost = median(measured); costBasis = "measured"; }
    else if (price && pool.length) { cost = median(pool.map(t => estimate(t, price))); costBasis = "a typical Work at its price"; }
    // handoff: 0 for the coordinator itself or without one; null when the coordinator's price is unknown, so the total is too.
    const expected = cost == null || handoff === null ? null : cost / (quality ?? start / 5) + handoff;
    return { agent:preset.id, name:preset.name, runner:preset.runner, model:target, effort:effectiveEffort,
      history:basis || "none", kindBasis:use === ofKind ? kind : "all kinds", scope:targetScope,
      ...(provenScope ? { provenScope } : {}), ...(lightOnly ? { lightOnly:true } : {}),
      works:counted.length,
      score:round(score, 1), tierScore:tiered ? round(tiered.rating, 2) : null, scored:scores.length, good, bad, medianMinutes:median(counted.map(w => tookMin(w.s.took)).filter(Boolean)),
      costPerWork:round(cost), costBasis:costBasis || "unknown", expectedCost:round(expected), price:price ? { input:price.input, output:price.output } : null,
      quality, expected, poor, start, lightRated, lightAvg, standardRated, heavyRated, resolved:resolvedTarget };
  }
  // What every judgement of a project shares: its settled Works by agent app, a typical Work's tokens, prices, each app's default model.
  function planContext(project, kind, scope = "standard") {
    const targetScope = normalizeScope(scope) || "standard";
    const items = history(project, { since:Date.now() - ROUTE_DAYS * 86400000 }).filter(w => SETTLED.has(w.s.state) && !w.trivial), list = prices();
    const byRunner = new Map();
    for (const w of items) {
      w.at = w.s.startedAt || labelMs(w.s.when) || 0;
      if (!byRunner.has(w.s.agent)) byRunner.set(w.s.agent, []);
      byRunner.get(w.s.agent).push(w);
    }
    const doneOf = xs => xs.filter(w => w.s.state === "done" && w.tokens).map(w => w.tokens);
    let typical = doneOf(items.filter(w => (!kind || w.kind === kind) && (normalizeScope(w.scope) || "standard") === targetScope));
    if (typical.length < 5) typical = doneOf(items.filter(w => !kind || w.kind === kind));
    if (typical.length < 5) typical = doneOf(items);
    const defaults = new Map(), defaultEfforts = new Map();
    const configured = preset => {
      if (concreteModel(preset.model)) return "";
      if (!defaults.has(preset.runner)) defaults.set(preset.runner, service.agents?.configuredModel?.(preset.runner) || "");
      return defaults.get(preset.runner);
    };
    const configuredEffort = preset => {
      if (preset.effort) return "";
      const runner = preset.runner || preset.agent || "", model = preset.model || "";
      const key = `${runner}\0${model}`;
      if (!defaultEfforts.has(key)) defaultEfforts.set(key, service.agents?.configuredEffort?.(runner, model) || "");
      return defaultEfforts.get(key);
    };
    return { byRunner, typical, list, configured, configuredEffort };
  }
  // Saved agents compared with no handoff between them: who PenEcho Auto starts.
  // quality is 0-1 (an unrated agent's is where it starts), cost what a Work done well is expected to cost, null when unknown.
  function rank(project, presets) {
    const { byRunner, typical, list, configured, configuredEffort } = planContext(project, "");
    return new Map(presets.map(p => {
      const preset = presetRow(p);
      const row = judge(preset, byRunner, "", typical, list, 0, configured(preset), "standard", configuredEffort(preset));
      return [p.id, { quality:row.quality ?? row.start / 5, cost:row.expected, works:row.works }];
    }));
  }
  // Coding-first ranking for the Orchestrator auto-reviewer across all local projects (last 60 days,
  // falling back to all-time if no recent coding ratings exist) plus synced penecho.ai coding ratings.
  // Matches each saved agent's exact runner, model, and effort so untested or chat-only presets never
  // borrow another effort's coding record or outrank a proven coding agent.
  function rankReviewers(project, presets) {
    const projects = [project, ...(service.store?.projects || []).filter(p => p && p.id !== project?.id && !p.myCanvases)].filter(Boolean);
    const collect = since => {
      const items = [];
      for (const proj of projects) {
        try {
          for (const w of history(proj, { since })) if (SETTLED.has(w.s.state)) items.push(w);
        } catch { /* Skip unreadable sibling project. */ }
      }
      return items;
    };
    const eligibleRating = w => !w.isReview && !w.trivial && !cutOff(w);
    const ratedOf = xs => xs.filter(eligibleRating).map(w => workRating(effectiveScore(w.r), w.s.rating)).filter(n => n != null);
    const tierQualityOf = (xs, prior, imagined) => {
      const buckets = emptyTierBuckets();
      let count = 0;
      for (const w of xs.filter(eligibleRating)) {
        const val = workRating(effectiveScore(w.r), w.s.rating);
        if (val == null) continue;
        addScoreToBucket(buckets[normalizeScope(w.scope) || "standard"], val, 1, 1);
        count++;
      }
      return count ? tierRating(buckets, "standard", { prior, priorWeight:imagined }).rating / 5 : null;
    };
    let items = collect(Date.now() - ROUTE_DAYS * 86400000);
    if (!ratedOf(items.filter(w => w.kind === "code")).length) {
      const allTime = collect(0);
      if (ratedOf(allTime.filter(w => w.kind === "code")).length || !ratedOf(items).length) items = allTime;
    }
    const list = prices();
    const byRunner = new Map();
    for (const w of items) {
      w.at = w.s.startedAt || labelMs(w.s.when) || 0;
      if (!byRunner.has(w.s.agent)) byRunner.set(w.s.agent, []);
      byRunner.get(w.s.agent).push(w);
    }
    const doneOf = xs => xs.filter(w => w.s.state === "done" && w.tokens).map(w => w.tokens);
    let typical = doneOf(items.filter(w => w.kind === "code"));
    if (typical.length < 5) typical = doneOf(items);
    const defaults = new Map(), defaultEfforts = new Map();
    const configured = preset => {
      if (concreteModel(preset.model)) return "";
      if (!defaults.has(preset.runner)) defaults.set(preset.runner, service.agents?.configuredModel?.(preset.runner) || "");
      return defaults.get(preset.runner);
    };
    const configuredEffort = preset => {
      if (preset.effort) return "";
      const key = `${preset.runner}\0${preset.model || ""}`;
      if (!defaultEfforts.has(key)) defaultEfforts.set(key, service.agents?.configuredEffort?.(preset.runner, preset.model || "") || "");
      return defaultEfforts.get(key);
    };
    const exact = (a, b) => a.toLowerCase() === b.toLowerCase();
    const usesDefault = w => !concreteModel(w.s.selected ? w.s.selected.model : (w.r?.selectedModel ?? w.r?.model));
    const observed = w => w.model && (!concreteModel(w.s.resolvedModel) || concreteModel(w.s.picked?.model) || concreteModel(w.s.tokens?.requestModel) || concreteModel(w.s.tokens?.lastRequest?.model));
    const workEffortOf = w => String(w.effort || (w.s.selected ? w.s.selected.effort : w.r?.effort) || "").trim().toLowerCase();
    const chosenEffortOf = w => String((w.s.selected ? w.s.selected.effort : (w.r?.effort || w.effort)) || "").trim().toLowerCase();
    return new Map(presets.map(p => {
      const preset = presetRow(p);
      const mine = byRunner.get(preset.runner) || [];
      const selected = concreteModel(preset.model), defaultModel = concreteModel(configured(preset));
      const defaultEffort = configuredEffort(preset);
      const wantEffort = String(preset.effort || defaultEffort || "").trim().toLowerCase();
      const sameEffort = wantEffort ? w => workEffortOf(w) === wantEffort : w => chosenEffortOf(w) === "";
      const latestDefault = !selected && !defaultModel ? mine.filter(w => observed(w) && usesDefault(w) && sameEffort(w))
        .reduce((a, w) => w.at > (a?.at || 0) ? w : a, null) : null;
      let target = selected || defaultModel || latestDefault?.model || "";
      const compareModel = latestDefault ? exact : sameModel;
      let fits = target ? w => compareModel(w.model, target) : usesDefault;
      if (target && !latestDefault && !mine.some(w => exact(w.model, target))) {
        const latest = mine.filter(fits).reduce((a, w) => (w.at > (a?.at || 0) ? w : a), null);
        if (latest) { target = latest.model; fits = w => exact(w.model, latest.model); }
      }
      const sameSetup = w => fits(w) && (!latestDefault || usesDefault(w)) && sameEffort(w);
      const matched = mine.filter(sameSetup);
      const codeMatched = matched.filter(w => w.kind === "code");
      const codeWorks = codeMatched.filter(w => w.s.state === "done").length;
      const codeScores = ratedOf(codeMatched);
      const cloudCode = reviews.cloudCodeRating?.(preset.runner, target, wantEffort) || null;
      let codeQuality = null;
      if (codeScores.length) {
        const imagined = cloudCode == null ? 4 : 5;
        const prior = cloudCode == null ? 4 : cloudCode.rating;
        codeQuality = tierQualityOf(codeMatched, prior, imagined);
      } else if (cloudCode != null) {
        codeQuality = cloudCode.rating / 5;
      }
      const allScores = ratedOf(matched);
      const cloudAll = reviews.cloudStart(preset.runner, target, wantEffort, "");
      const allPrior = cloudAll ?? 4, allImagined = cloudAll == null ? 4 : 5;
      const allQuality = allScores.length
        ? tierQualityOf(matched, allPrior, allImagined)
        : allPrior / 5;
      const row = judge(preset, byRunner, "code", typical, list, 0, configured(preset), "standard", defaultEffort);
      return [p.id, {
        codeQuality,
        codeWorks,
        codeRated:codeScores.length + (cloudCode ? cloudCode.rated : 0),
        quality:allQuality,
        cost:row.expected,
        works:matched.filter(w => w.s.state === "done").length,
      }];
    }));
  }
  // ---------- PenEcho Auto (PE-1085, PE-1190): the saved agent that starts a job given to "PenEcho Auto" ----------
  // 1. What the job is about, from its own words (job-kind.js). No model is asked, so it takes no time and costs nothing.
  // 2. The first choice: the agent scored best for that kind of job, whatever it costs, that did not fail to run lately and whose app is
  //    free now. How many Works it was given before is no reason to pass it over (the owner's rule).
  // 3. One about as good at half the cost or less starts instead; else, now and then, the first choice's model at a lower effort.
  // A job always starts: with every agent out, one of them is tried anyway. A score is the 0-5 rating in points of 100.
  const AUTO = {
    unproven:8,              // fewer than 3 rated Works of this kind: its rating comes from other kinds of jobs, or from where it starts
    hours:3, most:5,         // out after its app's usage limit until the reset the app said, else these hours, and tried at least every five; an error: these hours
    busy:10,                 // an agent whose app is running Works gives way to one whose app runs fewer, scored this much lower at most
    near:5, cheaper:0.5,     // about as good: this many points below the first choice, on 3 ratings or more; cheaper: this share of its cost at most
    lower:1 / 3, drop:10,    // how often a lower effort is tried, unless its own record is this much below
  };
  const EFFORT_STEPS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"], MEDIUM = EFFORT_STEPS.indexOf("medium");
  // What this project's jobs usually are: one kind in 4 of 10 of its recorded Works, from ten Works on.
  function usualKind(project) {
    const since = Date.now() - ROUTE_DAYS * 86400000, counts = new Map();
    for (const r of recordsOf(project)) {
      const kind = storedKind(r.kind);
      if (kind && !(Date.parse(r.at) < since)) counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0), top = [...counts].sort((a, b) => b[1] - a[1])[0];
    return top && total >= 10 && top[1] / total >= 0.4 ? top[0] : "";
  }
  // What happened lately to the agent apps on this computer: this project and the others open here.
  function autoRecent(project, now) {
    const since = now - AUTO.most * 3600000, works = [];
    const others = (service.store?.projects || []).filter(p => p && p.id !== project.id).map(p => service.states?.get(p.id)?.state).filter(Boolean);
    for (const state of [stateOf(project), ...others]) for (const l of allLines(state)) for (const s of l.stations) {
      if (!isWork(s) || s.state === "todo") continue;
      const at = s.endedAt || s.startedAt || 0, resetsAt = s.resetsAt ? (Number(s.resetsAt) || Date.parse(s.resetsAt) || 0) : 0;
      if (!(at >= since)) continue;
      const trouble = s.state === "done" ? "" : s.stopWhy === "limit" ? "limit"
        : (s.stopWhy === "error" || (s.state === "error" && !s.stopWhy)) && !/^PenEcho closed while this was running/.test(s.why || "") ? "error" : "";
      const until = trouble === "limit" && resetsAt ? Math.min(resetsAt, at + AUTO.most * 3600000) : at + AUTO.hours * 3600000;
      works.push({ runner:s.agent || "", model:concreteModel(priceModelOf(s)), state:s.state, trouble:until > now ? trouble : "", resetsAt, until, at });
    }
    const running = (service.localRunEntries?.() || []).map(([, run]) => run).filter(run => run && !run.stopping).map(run => run.agent || "");
    return { works, running };
  }
  // Saved agents as both choices below see them: score in points of 100, what a Work costs, and whether its app can take one now.
  function scoredRows(presets, { kind, targetScope, context, recent, judged = null }) {
    const { byRunner, typical, list, configured, configuredEffort } = context;
    return presets.map(p => {
      const preset = presetRow(p), row = judged ? judged(preset) : judge(preset, byRunner, kind, typical, list, 0, configured(preset), targetScope, configuredEffort(preset));
      // A Work on a model nobody named ran on the app's own choice: counted as this one's.
      const fits = w => !w.model || !row.model || sameModel(w.model, row.model);
      // Limits and errors are its app's, whichever model met them. They are over once it finished a Work of its own after them.
      const mine = recent.works.filter(w => w.runner === preset.runner), fineAt = Math.max(0, ...mine.filter(w => w.state === "done" && fits(w)).map(w => w.at));
      const trouble = mine.filter(w => w.trouble && w.at > fineAt), limits = trouble.filter(w => w.trouble === "limit");
      const lightOnlyForHarder = targetScope !== "light" && row.lightOnly, quality = row.quality ?? row.start / 5;
      const ofKind = !kind || row.kindBasis === kind, known = row.scored >= 3 && !lightOnlyForHarder, proven = ofKind && known;
      return { p, row, ofKind, known, proven, rating:5 * quality, score:round(100 * quality - (proven ? 0 : AUTO.unproven), 1),
        cost:row.expected == null ? null : row.expected * quality, level:EFFORT_STEPS.indexOf(String(row.effort || "").toLowerCase()),
        busy:recent.running.filter(runner => runner === preset.runner).length, out:limits.length ? "limit" : trouble.length ? "error" : "",
        errors:trouble.length - limits.length, own:trouble.some(fits), said:limits.some(w => w.resetsAt), back:Math.max(0, ...limits.map(w => w.resetsAt || w.until)) };
    });
  }
  // → { id, name, kind, from, why }: the saved agent to start, what the job was taken to be and from which words, and why this agent.
  function autoPreset(project, { text = "", make = null } = {}) {
    const saved = service.presets?.list() || {}, can = (saved.presets || []).filter(p => p.available && p.showInPicker !== false);
    if (!can.length) throw failure("BAD_AGENT", "PenEcho Auto has no agent to start. Add one in Settings → Agents.");
    const guess = jobKind(text, { make, usual:usualKind(project) }), kind = guess.kind;
    const scopeInfo = resolveWorkScope({ askText:text, kind, hasCanvas:Boolean(make) });
    const targetScope = scopeInfo.trivial ? "light" : scopeInfo.scope;
    const now = Date.now(), rows = scoredRows(can, { kind, targetScope, context:planContext(project, kind, targetScope), recent:autoRecent(project, now) });
    const count = (n, one = "Work") => `${n} ${n === 1 ? one : `${one}s`}`;
    // Scored alike: the person's own default, then the one that did more of these Works.
    const isDefault = r => r.p.id === saved.default;
    rows.sort((a, b) => b.score - a.score || isDefault(b) - isDefault(a) || b.row.works - a.row.works);
    const ready = rows.filter(r => !r.out), near = ready.filter(r => r.score >= ready[0].score - AUTO.busy), fewest = Math.min(...near.map(r => r.busy));
    // Everyone out: an error may be over by now, best on a model that did not meet it; else the limit that ends first; with no end said, the default.
    const said = rows.some(r => r.said), backAt = r => r.out === "error" ? Number(r.own) : said ? r.back : Number(!isDefault(r));
    const first = near.find(r => r.busy === fewest) || [...rows].sort((a, b) => (a.out === "limit") - (b.out === "limit") || backAt(a) - backAt(b))[0];
    // One look each, at who is as free as the first choice.
    const pool = first.out ? [] : ready.filter(r => r !== first && r.busy <= first.busy);
    const cheaper = first.cost == null ? null : pool.find(r => r.known && r.score >= first.score - AUTO.near
      && r.cost != null && r.cost < first.cost && r.cost <= first.cost * AUTO.cheaper);
    const sameAgent = r => r.p.agent === first.p.agent && (!(r.p.model || first.p.model) || sameModel(r.row.model, first.row.model));
    const step = cheaper || first.level <= MEDIUM ? null : pool.filter(r => r.level >= MEDIUM && r.level < first.level && sameAgent(r)).sort((a, b) => b.level - a.level)[0];
    const worse = step && ((step.row.scored >= 3 && 20 * (first.rating - step.rating) > AUTO.drop) || (step.cost != null && first.cost != null && step.cost >= first.cost));
    const lower = step && !worse && dice() < AUTO.lower ? step : null;
    const top = cheaper || lower || first, n = top.row.scored, shown = round(top.rating, 1);
    const lightNote = targetScope !== "light" && top.row.lightOnly ? " (Light only)" : "";
    const rated = !n ? `not rated here yet, so it starts at ${shown}/5`
      : kind && top.ofKind ? `rated ${shown}/5 on ${count(n, `${kind} Work`)} here${lightNote}`
      : `rated ${shown}/5 on ${count(n)} of all kinds here${lightNote}${kind ? `, with too few ${kind} ones yet` : ""}`;
    const autoLabel = (p, row) => {
      const base = String(p.name || "").trim();
      const autoName = service.presets?.nameFor?.(p);
      if (!p.auto && autoName && base && base !== autoName) return base;
      const low = base.toLowerCase();
      const model = !p.model ? String(row?.model || "").trim() : "";
      const effort = !p.effort ? String(row?.effort || "").trim() : "";
      const escRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const extras = [
        model && !low.includes(model.toLowerCase()) ? model : "",
        effort && !new RegExp(`(?:^|[·\\s(])${escRe(effort)}\\s+effort(?:$|[·\\s)])`, "i").test(base) ? `${effort} effort` : "",
      ].filter(Boolean);
      return extras.length ? [base, ...extras].join(" · ") : base;
    };
    const topName = autoLabel(top.p, top.row), firstName = autoLabel(first.p, first.row), gap = round(first.score - top.score, 1);
    const rule = cheaper ? ` Cheaper and about as good: ${gap ? `${count(gap, "point")} of 100 below` : "scored the same as"} ${firstName}, ${Math.round(100 * (1 - top.cost / first.cost))}% cheaper.`
      : lower ? ` Trying a lower effort than ${firstName}, as one time in three.`
      : !first.out ? "" : rows.length > 1 ? " Every agent reached its usage limit or stopped with an error lately, so this one is tried."
      : ` It ${first.out === "limit" ? "reached its usage limit" : "stopped with an error lately"} and is the only agent to start.`;
    // Who scored better than the first choice and what stood against it.
    const against = r => r.out === "limit" ? "it reached its usage limit" : r.out ? `${count(r.errors)} of its app stopped with an error in the last ${AUTO.hours} hours`
      : `its app is running ${count(r.busy)} now`;
    const passed = first.out ? [] : [...new Set(rows.filter(r => r.score > first.score).map(r => `${autoLabel(r.p, r.row)} (${against(r)})`))];
    const over = passed.length ? ` Passed over: ${passed.slice(0, 2).join("; ")}${passed.length > 2 ? `; and ${passed.length - 2} more` : ""}.` : "";
    return { id:top.p.id, name:topName, kind, from:guess.from, why:clip(`${topName}: ${rated}.${rule}${over}`, 600) };
  }
  // ---------- Sub-agents (PE-1190): who does a part the orchestrator hands over without naming an agent ----------
  // decision: the best-rated for that kind above the orchestrator, whatever it costs. execution: the orchestrator's score less `near` or
  // better, at less than `cheaper` of its cost, cheapest first, `each` parts to each. Now and then one part goes to a model with few Works
  // yet, so it earns a record. A model at one effort is one choice whichever apps run it: their Works are counted together.
  // With nobody fit the part stays with the orchestrator, which is always there to do it.
  const SUB = { near:5, cheaper:0.5, each:2, few:5, trial:0.25 };
  const ROLES = ["execution", "decision"];
  const optionalRole = value => {
    const role = String(value || "").trim().toLowerCase();
    if (role && !ROLES.includes(role)) throw failure("BAD_ROLE", `role must be one of: ${ROLES.join(", ")}.`);
    return role || "execution";
  };
  const namesNobody = args => /^(?:auto)?$/i.test(String(args?.agent || "").trim());
  const sameChoice = (a, b) => a.effort === b.effort && (a.model === b.model || sameModel(a.model, b.model));
  const choiceOf = (model, effort) => ({ model:AgentIndex.modelKey(model), effort:String(effort || "").trim().toLowerCase() });
  // → { self, groups }: the orchestrator's own score and cost for this kind of work, and each model at an effort that may be given a part.
  function subAgents(project, session, kind, scope = "") {
    const targetScope = normalizeScope(scope) || "standard", context = planContext(project, kind, targetScope), recent = autoRecent(project, Date.now());
    const { byRunner, typical, list, configured, configuredEffort } = context;
    const all = [...byRunner].flatMap(([runner, works]) => works.map(w => ({ w, runner, of:choiceOf(w.model, w.effort) }))).filter(x => x.of.model);
    const judged = preset => {
      const judgeWith = (as, runners) => judge(as, runners, kind, typical, list, 0, configured(as), targetScope, configuredEffort(as));
      const alone = judgeWith(preset, byRunner), me = choiceOf(alone.resolved, alone.effort);
      const others = me.model ? all.filter(x => x.runner !== preset.runner && sameChoice(x.of, me)).map(x => ({ ...x.w, model:alone.resolved })) : [];
      if (!others.length) return alone;
      const pooled = judgeWith({ ...preset, model:concreteModel(preset.model) ? preset.model : alone.resolved }, new Map(byRunner).set(preset.runner, [...(byRunner.get(preset.runner) || []), ...others]));
      // Its ratings are shared; what a Work costs is its own app's, whose provider may charge another price.
      const quality = row => row.quality ?? row.start / 5;
      return alone.expected == null ? pooled : { ...pooled, expected:alone.expected * quality(alone) / quality(pooled) };
    };
    const rowsOf = presets => scoredRows(presets, { kind, targetScope, context, recent, judged }).map(r => ({ ...r, of:choiceOf(r.row.resolved || r.row.model, r.row.effort) }));
    const groups = [];
    for (const r of rowsOf(agents().agents)) {
      const same = r.of.model && groups.find(g => sameChoice(g.of, r.of));
      if (same) same.members.push(r); else groups.push({ of:r.of, members:[r] });
    }
    const running = runningChoices(project, session);
    for (const g of groups) {
      // The app that can take it now, the cheapest, then the one that runs fewest Works; with every app of it out, the choice is out.
      const by = n => n ?? Infinity, free = g.members.filter(r => !r.out).sort((a, b) => by(a.cost) - by(b.cost) || a.busy - b.busy)[0] || null, top = free || g.members[0];
      Object.assign(g, { key:`${g.of.model || g.members[0].p.id}\0${g.of.effort}`, free, name:top.p.name, busy:top.busy, score:top.score, cost:top.cost, known:top.known, proven:top.proven, poor:top.row.poor,
        jobs:all.filter(x => !x.w.isReview && x.w.s.state === "done" && sameChoice(x.of, g.of)).length,
        given:running.filter(x => g.members.some(r => r.p.id === x.preset) || sameChoice(x.of, g.of)).length });
    }
    const mine = selfAgent(project, session), self = mine ? rowsOf([mine])[0] : null;
    return { self, groups:groups.filter(g => !self || !self.of.model || !sameChoice(g.of, self.of)) };
  }
  // The coordinator running now, also when it runs on no saved agent.
  function selfAgent(project, session) {
    const saved = selfPreset(project, session);
    if (saved || !session) return saved;
    try {
      const works = lineOf(project, session).stations.filter(isWork), now = works.findLast(s => s.state === "active") || works.at(-1);
      return now?.agent ? { id:"", name:now.agent, runner:now.agent, model:priceModelOf(now), effort:effortOf(now) } : null;
    } catch { return null; }
  }
  const childrenOf = (project, session) => session ? allLines(stateOf(project)).filter(l => l.orchestratedBySlug === session) : [];
  // What the parts this orchestrator handed over are running on now.
  const runningChoices = (project, session) => childrenOf(project, session).flatMap(l => l.stations).filter(s => isWork(s) && s.state === "active").map(s => ({ preset:s.savedAgentId || "", of:choiceOf(modelOf(s), effortOf(s)) }));
  // Who may be given this part, best first, and who may be tried with it.
  function subChoices({ self, groups }, role) {
    const free = groups.filter(g => g.free), cheaper = g => self?.cost != null && g.cost != null && g.cost < SUB.cheaper * self.cost;
    if (!self) return { list:[], trials:[], why:"PenEcho does not know your own record, so it cannot tell who fits." };
    if (role === "decision") {
      const list = free.filter(g => g.proven && g.score > self.score).sort((a, b) => b.score - a.score || (a.cost ?? Infinity) - (b.cost ?? Infinity) || a.busy - b.busy);
      return { list, trials:[], why:"No free agent is rated above you for this kind of work." };
    }
    const list = free.filter(g => g.known && cheaper(g) && g.score >= self.score - SUB.near).sort((a, b) => a.cost - b.cost || b.score - a.score || a.busy - b.busy);
    return { list, trials:free.filter(g => g.jobs <= SUB.few && g.poor < 2 && cheaper(g) && !list.includes(g)),
      why:self.cost == null ? "Your own model has no price, so PenEcho cannot tell who is cheaper." : "No free agent is both as good as you, within 5 points, and under half your cost." };
  }
  // The parts given without an agent, each with the one that does it, or kept with why. `without`: a model an error just stopped at it. One
  // stopped by its app's limit may go on in another app.
  function assignParts(project, session, parts, { without = null, trial = true } = {}) {
    const seen = new Map(), given = new Map(), open = parts.filter(part => namesNobody(part));
    const tried = trial && open.length && dice() < SUB.trial ? open[Math.floor(dice() * open.length)] : null;
    return parts.map(part => {
      if (!namesNobody(part)) return { part };
      const kind = requireKind(part.kind), scope = optionalScope(part.scope), role = optionalRole(part.role), key = `${kind}\0${scope}`;
      if (!seen.has(key)) seen.set(key, subAgents(project, session, kind, scope));
      const { list, trials, why } = subChoices(seen.get(key), role), fits = g => !without || !sameChoice(g.of, without);
      const count = g => g.given + (given.get(g.key) || 0);
      const some = part === tried && role === "execution" && scope !== "heavy" ? trials.filter(g => fits(g) && count(g) < SUB.each) : [];
      const pick = some.length ? some[Math.floor(dice() * some.length)] : list.filter(fits).find(g => count(g) < SUB.each);
      if (!pick) return { part, kept:list.filter(fits).length ? `Each agent that fits has ${SUB.each} of your parts. Do it yourself, or send it again when they are done.` : `${why} Do it yourself, or name an agent if the person asked for others.` };
      given.set(pick.key, (given.get(pick.key) || 0) + 1);
      return { part, agent:pick.free.p.id, name:pick.name, picked:some.length ? "trial" : role };
    });
  }
  // What the brief says of who could take a part of a job like this one now. Scores and prices stay out: PenEcho does the choosing.
  function subNow(project, session, kind) {
    const all = subAgents(project, session, kind), names = (role, most) => { const { list } = subChoices(all, role); return list.length ? `${list.slice(0, most).map(g => g.name).join(", ")}${list.length > most ? ` and ${list.length - most} more` : ""}` : ""; };
    const up = names("decision", 1), down = names("execution", 2);
    return `For ${kind || "general"} work now. Decision: ${up ? `${up} is rated above you` : "nobody free is rated above you"}. Execution: ${down || "nobody free fits, so it stays with you"}.`;
  }
  const PLAN_DEFAULT_LIMIT = 6;
  // Pick up to `cap` leading non-you candidates (prioritizing proven cheaper agents and at most `maxTrials` trial candidates)
  // while preserving plan's expected-cost sort order and always keeping `you`.
  function selectTopRows(rows, cap, { maxTrials = 1 } = {}) {
    if (!Number.isFinite(cap)) return rows;
    const others = rows.filter(r => !r.you);
    if (others.length <= cap) return rows;
    const picked = new Set();
    const trials = others.filter(r => r.tryIt);
    const trialBudget = Math.min(maxTrials, trials.length, cap);
    const cheaperBudget = Math.max(0, cap - trialBudget);
    for (const r of others) {
      if (picked.size >= cheaperBudget) break;
      if (r.cheaperThanYou) picked.add(r);
    }
    let trialsPicked = 0;
    for (const r of trials) {
      if (picked.size >= cap || trialsPicked >= trialBudget) break;
      if (!picked.has(r)) { picked.add(r); trialsPicked++; }
    }
    for (const r of others) {
      if (picked.size >= cap) break;
      picked.add(r);
    }
    return rows.filter(r => r.you || picked.has(r));
  }
  function formatPlanRow(row, { compact = false } = {}) {
    const { quality, expected, poor, start, lightRated, lightAvg, standardRated, heavyRated, resolved, ...pub } = row;
    if (!compact) return pub;
    const out = {
      agent:pub.agent, name:pub.name, runner:pub.runner, model:pub.model,
      ...(pub.effort ? { effort:pub.effort } : {}),
      history:pub.history, kindBasis:pub.kindBasis,
      ...(pub.provenScope ? { provenScope:pub.provenScope } : {}),
      ...(pub.lightOnly ? { lightOnly:true } : {}),
      works:pub.works, score:pub.score, scored:pub.scored,
      ...(pub.medianMinutes ? { medianMinutes:pub.medianMinutes } : {}),
      ...(pub.good ? { good:pub.good } : {}),
      ...(pub.bad ? { bad:pub.bad } : {}),
      costPerWork:pub.costPerWork, costBasis:pub.costBasis, expectedCost:pub.expectedCost,
      ...(pub.you ? { you:true } : { cheaperThanYou:Boolean(pub.cheaperThanYou), tryIt:Boolean(pub.tryIt), ...(pub.tryReason ? { tryReason:pub.tryReason } : {}) }),
    };
    return out;
  }
  function plan(project, { kind = "", scope = "", all = false, limit = 0 } = {}, session = "") {
    kind = storedKind(kind);
    const targetScope = optionalScope(scope) || "standard";
    const { byRunner, typical, list, configured, configuredEffort } = planContext(project, kind, targetScope);
    const self = selfPreset(project, session), you = self ? judge(self, byRunner, kind, typical, list, 0, configured(self), targetScope, configuredEffort(self)) : null;
    const handoff = !you ? 0 : you.price ? estimate(HANDOFF, you.price) : null;
    const rows = agents().agents.map(a => a.id === self?.id ? you : judge(presetRow(a), byRunner, kind, typical, list, handoff, configured(a), targetScope, configuredEffort(a)));
    if (you && !rows.includes(you)) rows.push(you);
    for (const row of rows) {
      if (row === you) { row.you = true; continue; }
      const lightOnlyForHarder = targetScope !== "light" && row.lightOnly;
      // Clearly cheaper to do well, handoff included, on records long enough on both sides, scoring no worse.
      // A Light-only record never qualifies as proven cheaper for Standard/Heavy until it has Standard/Heavy evidence.
      row.cheaperThanYou = !lightOnlyForHarder && Boolean(you && you.expected > 0 && row.expected != null && row.expected < 0.6 * you.expected &&
        you.works >= 3 && row.works >= (row.quality == null ? 5 : 3) &&
        (row.quality == null || you.quality == null || row.quality >= you.quality - 0.1));
      // Too short a record to be called cheaper, or proven on >=3 Light Works (>=4.0) with no Standard/Heavy record yet:
      // worth a small, easy-to-verify trial so it can earn real Standard evidence. Ended after two poor ratings (<= 2.5).
      const readyForStandardTrial = targetScope === "standard" && row.lightOnly && row.lightRated >= 3 && (row.lightAvg ?? 0) >= 4.0 && row.standardRated === 0 && row.heavyRated === 0;
      row.tryIt = !row.cheaperThanYou && Boolean(you && you.expected > 0 && row.expected != null && row.expected < 0.6 * you.expected &&
        (row.works < (row.quality == null ? 5 : 3) || readyForStandardTrial) && row.poor < 2);
      if (row.tryIt && readyForStandardTrial) row.tryReason = "proven on Light, worth a small Standard trial";
    }
    // Unknown totals (the coordinator's price unknown) by cost per Work, so the dearest are not first just for being used most.
    const by = n => n ?? Infinity;
    rows.sort((a, b) => by(a.expected) - by(b.expected) || by(a.costPerWork) - by(b.costPerWork) || b.works - a.works);
    const showAll = all === true || all === "true" || all === 1;
    const cap = showAll ? Infinity : Number(limit) > 0 ? Math.min(100, Math.round(Number(limit))) : PLAN_DEFAULT_LIMIT;
    const shown = selectTopRows(rows, cap, { maxTrials:2 });
    const more = Math.max(0, rows.length - shown.length);
    return {
      kind:kind || "all kinds", scope:targetScope, days:ROUTE_DAYS, handoffCost:you ? round(handoff) : null,
      ...(more ? { more } : {}),
      agents:shown.map(row => formatPlanRow(row, { compact:Boolean(session) })),
      note:`expectedCost = cost ÷ tiered quality + handoffCost; null = unknown.${more ? " Pass all:true for every agent." : ""}`,
    };
  }
  // route and its parts must agree, so a session card never reports a handoff the plan did not have.
  function decide(project, session, { route, why = "", parts = [], kind, scope } = {}, by = "") {
    if (!session) throw failure("NOT_SESSION", "Only an orchestrator's own run records its route.", 403);
    if (!ROUTES.includes(route)) throw failure("BAD_ROUTE", "route is self (you do all of it), delegate (another agent owns it) or split (parts go to different owners).");
    const words = clip(String(why || "").replace(/\s+/g, " ").trim(), 400);
    if (!words) throw failure("NO_WHY", "Say in why, in one sentence, why this route finishes the job well for the least time and cost.");
    const offered = new Map(agents().agents.map(a => [a.id, a])), list = (Array.isArray(parts) ? parts : []).filter(Boolean).slice(0, 20);
    for (const part of list) if (part.agent && part.agent !== "self" && !offered.has(part.agent)) throw failure("BAD_AGENT", "Each part's agent is \"self\" or a preset returned by agents.");
    const ownerOf = part => part.agent && part.agent !== "self" ? part.agent : "self";
    const owners = new Set(list.map(ownerOf)), others = list.filter(part => ownerOf(part) !== "self").length;
    if (route === "self" && others) throw failure("BAD_ROUTE", "A self route keeps every part. Use delegate or split when another agent owns one.");
    if (route === "delegate" && (!others || others !== list.length)) throw failure("BAD_ROUTE", "A delegate route gives its parts to other agents; name each with its agent. Use split when you keep a part.");
    if (route === "split" && (list.length < 2 || owners.size < 2 || !others)) throw failure("BAD_ROUTE", "A split route has two or more parts with different owners, at least one of them another agent.");
    const topKind = kind !== undefined ? requireKind(kind) : "";
    const topScope = optionalScope(scope);
    const normalizedParts = list.map(part => {
      const partKind = part.kind != null && String(part.kind).trim() !== "" ? requireKind(part.kind) : "";
      if (!partKind) throw failure("BAD_KIND", `Each part (task) needs its own kind: ${KINDS.join(", ")}.`);
      const partScope = optionalScope(part.scope);
      return { ...part, kind:partKind, ...(partScope ? { scope:partScope } : {}) };
    });
    if (!normalizedParts.length && !topKind) throw failure("BAD_KIND", `Include parts with each task's kind (or kind for a single self task): ${KINDS.join(", ")}.`);
    const said = normalizedParts.map(part => `${clip(String(part.task || "").replace(/\s+/g, " ").trim(), 60) || "a part"} → ${ownerOf(part) === "self" ? "you" : offered.get(part.agent).name}`).join("; ");
    service.writeDoc(project, session, F.setFront(service.readDoc(project, session), { route, "route why":words, "route parts":said ? clip(said, 600) : null }));
    const selfParts = normalizedParts.filter(part => ownerOf(part) === "self");
    const selfKind = selfParts[0]?.kind || (route === "self" ? topKind : "");
    // Self-reported difficulty: allow light/standard, never self-proclaimed heavy (objective split/diff or user chip can still raise it).
    const rawSelfScope = selfParts[0]?.scope || (route === "self" ? topScope : "");
    const selfScope = rawSelfScope === "heavy" ? "standard" : rawSelfScope;
    if (selfKind) {
      let now = null;
      try {
        const works = lineOf(project, session).stations.filter(isWork);
        now = works.findLast(s => s.state === "active") || works.at(-1) || null;
      } catch {}
      if (now) {
        record({
          project:project.id, line:session, work:now.id, kind:selfKind, kindSource:"decide",
          ...(selfScope ? { scope:selfScope, scopeSource:"self" } : {}),
          preset:now.savedAgentId || "", presetName:now.savedAgent || "", agent:now.agent || "",
          model:modelOf(now) || "", effort:now.picked?.effort || now.selected?.effort || "", by,
        });
      }
    }
    service.changed(project);
    service.onChange?.(project.id);
    return { route, why:words, parts:normalizedParts.length, delegated:others };
  }

  // ---------- Doing ----------
  function parentIdentityOf(project, session) {
    if (!session) return null;
    if (!service.isLine(project, session)) throw failure("PARENT_STOPPED", "The parent orchestrator no longer exists.", 409);
    const parentDoc = F.parseLine(service.readDoc(project, session));
    return {
      startGen: ensureSessionGen(project, session),
      lineId: parentDoc.front.id || "",
      created: parentDoc.front.created || "",
    };
  }
  function assertParentActive(project, session, identity, passGen = null, passLineId = "") {
    if (!session) return;
    if (!service.isLine(project, session)) {
      throw failure("PARENT_STOPPED", "The parent orchestrator was deleted or stopped.", 409);
    }
    const curGen = sessionGenOf(project, session);
    if (!identity || curGen !== identity.startGen || curGen <= 0) {
      throw failure("PARENT_STOPPED", "The parent orchestrator was stopped.", 409);
    }
    if (passGen !== null && passGen < curGen) {
      throw failure("PARENT_STOPPED", "The parent orchestrator was stopped.", 409);
    }
    if (service.isStoppingLine?.(project, session)) {
      throw failure("PARENT_STOPPED", "The parent orchestrator was stopped.", 409);
    }
    let parentDoc;
    try {
      parentDoc = F.parseLine(service.readDoc(project, session));
    } catch {
      throw failure("PARENT_STOPPED", "The parent orchestrator is no longer available.", 409);
    }
    if (!yes(parentDoc.front.orchestrator) || L.ARCHIVED.has(parentDoc.status) || parentDoc.front["archive pending"]) {
      throw failure("PARENT_STOPPED", "The parent orchestrator is no longer active.", 409);
    }
    if ((identity.lineId && (parentDoc.front.id || "") !== identity.lineId)
      || (passLineId && (parentDoc.front.id || "") !== passLineId)
      || (identity.created && (parentDoc.front.created || "") !== identity.created)) {
      throw failure("PARENT_STOPPED", "The parent orchestrator was replaced after deletion.", 409);
    }
    if (parentDoc.status === "stopped" && !service.heldWorks?.(project, session)?.length) {
      throw failure("PARENT_STOPPED", "The parent orchestrator was stopped.", 409);
    }
  }
  async function createLine(project, args, by = "", session = "", passGen = null, passLineId = "", picked = "") {
    const parentIdentity = session ? parentIdentityOf(project, session) : null;
    const guard = session ? () => assertParentActive(project, session, parentIdentity, passGen, passLineId) : null;
    guard?.();
    const task = clip(String(args.task || args.text || ""), 100000).trim();
    if (!task) throw failure("EMPTY", "Say what the task is in task.");
    const preset = assignmentPreset(args.agent);
    const kind = requireKind(args.kind);
    const scope = optionalScope(args.scope);
    // branch:"new": a branch of its own from the trunk, as New branch in the box does.
    const chosen = args.branch === "new" ? await service.placeChosen(project, { newFrom:await service.refreshTrunk(project) }) : {};
    guard?.();
    const unsent = args.run === false;
    if (args.branch === "new" && !chosen.newFrom) {
      throw failure("NO_BRANCH", service.codePath(project)
        ? "This folder isn't tracked with Git yet. Click Track changes on Home to use branches, or run without a new branch."
        : "A new branch needs a project with a code folder and a Git commit.", 409);
    }
    const fields = { ...(by ? { "orchestrated by":by } : {}), ...(session ? { "orchestrated by slug":session } : {}) };
    if (args.title) fields["title by"] = "you";
    const { slug } = await service.createTopic(project, { text:task, ...(args.title ? { title:clip(String(args.title), 160) } : {}), agent:preset?.agent || "", preset:preset?.id || "", ...(unsent ? { kinds:["ask"], unsent:true, jobKind:kind } : {}), start:false, chosen }, fields, guard);
    const doc = F.parseLine(service.readDoc(project, slug));
    const ask = unsent ? doc.asks.find(F.isUnsent) : doc.asks[0];
    if (unsent) {
      service.sync(project);
      return { line:slug, ref:doc.front.id || "", ask:ask?.id || "", revision:F.hashText(service.readDoc(project, slug)), work:"", kind, ...(scope ? { scope } : {}), started:false };
    }
    const work = doc.steps.find(s => F.AGENT_LIKE(s) && !s.done);
    try {
      guard?.();
    } catch (error) {
      if (work && !L.ARCHIVED.has(doc.status)) {
        service.writeDoc(project, slug, F.setFront(F.updateSteps(service.readDoc(project, slug), steps => { const s = steps.find(x => x.id === work.id); if (s) { s.done = true; s.off = "stopped"; } }), { status:"stopped", why:"Stopped by you" }));
      }
      service.sync(project);
      throw error;
    }
    if (preset && work) service.stepPresets.set(`${service.key(project, slug)}:${work.id}`, preset.id);
    if (work) record({ project:project.id, line:slug, work:work.id, kind, ...(scope ? { scope, scopeSource:"orchestrator" } : {}), preset:preset?.id || "", presetName:preset?.name || "", agent:preset?.agent || work.who || "", model:preset?.model || "", selectedModel:preset?.model || "", effort:preset?.effort || "", by, ...(picked ? { picked } : {}) });
    await service.begin(project, slug, { beforeLaunch:guard });
    return { line:slug, ref:doc.front.id || "", ask:ask.id, work:work?.id || "", kind, ...(scope ? { scope } : {}), started:true };
  }
  async function startLine(project, args, by, session = "", passGen = null, passLineId = "") {
    const parentIdentity = session ? parentIdentityOf(project, session) : null;
    const guard = session ? () => assertParentActive(project, session, parentIdentity, passGen, passLineId) : null;
    const line = lineOf(project, args.line), slug = line.id, pending = line.stations.filter(s => s.unsent);
    if (line.archived || line.running || service.startsNow.has(service.key(project, slug))) throw failure("BUSY", "The Line must be open and idle.", 409);
    if ((args.ask || args.revision) && args.revision !== line.topicHash) throw failure("CONFLICT", "Read the current Line and send its revision with the Ask.", 409);
    guard?.();
    const explicitKind = args.kind !== undefined ? requireKind(args.kind) : "";
    const explicitScope = optionalScope(args.scope);
    let work, preset, kind = explicitKind;
    if (pending.length) {
      const ask = args.ask ? pending.find(s => s.id === args.ask) : pending.length === 1 && pending[0];
      if (!ask) throw failure("BAD_ASK", "Choose a pending Ask from line and send its step id and revision.", 409);
      const saved = service.parsedDoc(project, slug).asks.find(s => s.id === ask.id);
      preset = assignmentPreset(args.agent || ask.savedAgentId);
      kind ||= storedKind(saved?.held?.kind);
      if (!kind) requireKind("");
      const made = await service.runUnsent(project, slug, { step:ask.id, revision:line.topicHash, independent:true, preset:preset?.id || "", beforeLaunch:guard,
        assigned:by ? id => record({ project:project.id, line:slug, work:id, kind, by }) : null });
      work = made.step;
    } else {
      // Older saved Lines already contain a Work with a fixed assignment.
      const queued = line.stations.filter(s => isWork(s) && s.state === "todo");
      if (args.ask || args.agent || line.status !== "not-started" || queued.length !== 1) throw failure("NOT_QUEUED", "There is no saved assignment to start.", 409);
      work = queued[0].id;
      const assigned = service.presetFor(project, slug, queued[0].agent, work);
      preset = assignmentPreset(assigned?.id);
      const existing = recordsOf(project).find(r => r.line === slug && r.work === work);
      kind ||= isReviewWork(queued[0], existing) ? "" : storedKind(existing?.kind);
      if (!kind) requireKind("");
      service.stepPresets.set(`${service.key(project, slug)}:${work}`, preset.id);
      await service.act(project, slug, "start", { beforeLaunch:guard });
    }
    const current = lineOf(project, slug), station = current.stations.find(s => s.id === work);
    if (station && kind) record({ project:project.id, line:slug, work, kind,
      ...(explicitScope ? { scope:explicitScope, scopeSource:"orchestrator" } : {}),
      preset:station.savedAgentId || preset?.id || "", presetName:station.savedAgent || preset?.name || "", agent:station.agent,
      model:modelOf(station) || preset?.model || "", selectedModel:station.selected?.model ?? preset?.model ?? "", effort:effortOf(station, preset?.effort || ""), by });
    return { line:slug, work:station?.id || "", kind, ...(explicitScope ? { scope:explicitScope } : {}), status:current.status, state:station?.state || "", started:["active", "done"].includes(station?.state) };
  }
  async function addTask(project, args, by = "", session = "", passGen = null, passLineId = "", picked = "") {
    const parentIdentity = session ? parentIdentityOf(project, session) : null;
    const guard = session ? () => assertParentActive(project, session, parentIdentity, passGen, passLineId) : null;
    const slug = lineOf(project, args.line).id, task = clip(String(args.task || args.text || ""), 100000).trim();
    if (!task) throw failure("EMPTY", "Say what the task is in task.");
    const preset = assignmentPreset(args.agent);
    const kind = requireKind(args.kind);
    const scope = optionalScope(args.scope);
    guard?.();
    // Written before its agent starts: the prompt tells an assigned Work from the person's own (assignedBy).
    let recorded = "";
    const assigned = id => { recorded = id; record({ project:project.id, line:slug, work:id, kind, ...(scope ? { scope, scopeSource:"orchestrator" } : {}), preset:preset?.id || "", presetName:preset?.name || "", agent:preset?.agent || "", model:preset?.model || "", selectedModel:preset?.model || "", effort:preset?.effort || "", by, ...(picked ? { picked } : {}) }); };
    const made = await service.addAgentTask(project, slug, { text:task, preset:preset?.id || "", parallel:args.parallel === true, beforeLaunch:guard, assigned });
    const work = made.step, parallel = made.parallel;
    if (work && work !== recorded) assigned(work);
    return { line:slug, work, kind, ...(scope ? { scope } : {}), parallel };
  }
  function rate(project, { line, work, score, outcome, verification, safety, verdict, findings, note = "", kind, scope }, by = "") {
    const l = lineOf(project, line), s = l.stations.find(x => x.id === String(work || ""));
    if (!s || !isWork(s)) throw failure("NOT_FOUND", "That Work is not on this Line.", 404);
    const old = recordsOf(project).find(r => r.line === l.id && r.work === s.id);
    if (isReviewWork(s, old)) throw failure("NOT_RATEABLE", "Review Works cannot be rated.", 400);
    if (!["done", "off", "error"].includes(s.state)) throw failure("WORK_BUSY", "Wait for this Work to finish before rating it.", 409);
    const hasDims = outcome !== undefined || verification !== undefined || safety !== undefined || verdict !== undefined;
    let n = null, normVerdict = "", dims = null, cleanFindings = null;
    if (hasDims) {
      if (verdict !== undefined && verdict !== null && String(verdict).trim() !== "") {
        normVerdict = normalizeVerdict(verdict);
        if (!normVerdict) throw failure("BAD_SCORE", "verdict must be ready, caveats, fix, or unverified.");
      }
      const parseDim = val => {
        if (val === undefined || val === null || val === "") return null;
        const v = typeof val === "number" || (typeof val === "string" && val.trim()) ? Number(val) : NaN;
        if (!Number.isFinite(v) || v < 0 || v > 5) throw failure("BAD_SCORE", "outcome, verification, and safety are 0 to 5 (one decimal), or null when N/A.");
        return Math.round(v * 10) / 10;
      };
      dims = { outcome:parseDim(outcome), verification:parseDim(verification), safety:parseDim(safety) };
      if (Array.isArray(findings)) {
        cleanFindings = findings.map(f => {
          const fk = FINDING_KINDS.includes(String(f?.kind || "").trim().toLowerCase()) ? String(f.kind).trim().toLowerCase() : "";
          const where = clip(String(f?.where || "").replace(/\s+/g, " ").trim(), 120);
          const detail = clip(String(f?.detail || "").replace(/\s+/g, " ").trim(), 240);
          return fk && detail ? { kind:fk, ...(where ? { where } : {}), detail } : null;
        }).filter(Boolean).slice(0, 8);
      }
      if (normVerdict === "unverified") {
        n = null;
      } else if (dims.outcome != null) {
        n = scoreOf({ verdict:normVerdict, ...dims });
        if (n == null) throw failure("BAD_SCORE", "score is 1 (unusable) to 5 (complete and verified), to one decimal (4.2).");
        if (!normVerdict) {
          const severe = (cleanFindings || []).some(f => f.kind === "bug" || f.kind === "risk");
          normVerdict = n >= 4.5 && !severe ? "ready"
            : n >= 3.5 && dims.outcome >= 3.5 && (dims.safety == null || dims.safety >= 3.5) ? "caveats"
            : "fix";
        }
      } else {
        n = scoreIn(score);
        if (n == null) throw failure("BAD_SCORE", "score is 1 (unusable) to 5 (complete and verified), to one decimal (4.2).");
      }
    } else {
      n = scoreIn(score);
      if (n == null) throw failure("BAD_SCORE", "score is 1 (unusable) to 5 (complete and verified), to one decimal (4.2).");
    }
    const validKind = kind !== undefined ? requireKind(kind) : "";
    const validScope = optionalScope(scope);
    const resolvedKind = validKind || storedKind(old?.kind) || implicitWorkKind(l, s);
    if (!resolvedKind) requireKind("");
    const model = modelOf(s);
    const source = by ? "coordinator" : "user";
    const rating = record({
      project:project.id, line:l.id, work:s.id,
      ...(by ? { scoredBy:by } : {}), score:n, source, ignored:false, note:clip(String(note || ""), 500), scoredAt:new Date().toISOString(),
      kind:resolvedKind,
      ...(validKind ? { kindSource:source } : {}),
      ...(validScope ? { scope:validScope, scopeSource:by ? "orchestrator" : "user" } : {}),
      ...(normVerdict ? { verdict:normVerdict } : { verdict:undefined }),
      ...(dims ? { outcome:dims.outcome, verification:dims.verification, safety:dims.safety } : {}),
      ...(hasDims ? { reportMismatch:undefined } : {}),
      ...(cleanFindings?.length ? { findings:cleanFindings } : hasDims ? { findings:undefined } : {}),
      ...(model ? { model, selectedModel:s.selected?.model ?? old?.selectedModel ?? old?.model ?? "" } : {}),
      ...(old ? {} : {
        preset:s.savedAgentId || "", presetName:s.savedAgent || "", agent:s.agent,
        effort:s.picked?.effort || s.selected?.effort || "", by,
      }),
    });
    service.changed(project);
    service.onChange(project.id);
    return recordedModelRow(rating);
  }
  function inheritAssignment(project, slug, fromWorkId, toWorkId, { preset = null, agent = "", by = "" } = {}) {
    if (!project?.id || !slug || !fromWorkId || !toWorkId || fromWorkId === toWorkId) return null;
    const existing = recordsOf(project).find(r => r.line === slug && r.work === toWorkId);
    if (existing) return existing;
    const prevRecord = recordsOf(project).find(r => r.line === slug && r.work === fromWorkId);
    if (!prevRecord) return null;
    return record({
      project:project.id, line:slug, work:toWorkId, kind:inheritedKind(prevRecord.kind),
      ...(prevRecord.scope ? { scope:prevRecord.scope, ...(prevRecord.scopeSource ? { scopeSource:prevRecord.scopeSource } : {}) } : {}),
      preset:preset?.id || prevRecord.preset || "",
      presetName:preset?.name || prevRecord.presetName || "",
      agent:preset?.agent || agent || prevRecord.agent || "",
      model:preset?.model || prevRecord.model || "",
      selectedModel:preset ? preset.model || "" : prevRecord.selectedModel || prevRecord.model || "",
      effort:preset ? preset.effort || "" : prevRecord.effort || "",
      by:by || prevRecord.by || "",
    });
  }
  async function retryLine(project, args, by = "", session = "", passGen = null, passLineId = "") {
    const parentIdentity = session ? parentIdentityOf(project, session) : null;
    const guard = session ? () => assertParentActive(project, session, parentIdentity, passGen, passLineId) : null;
    guard?.();
    const line = lineOf(project, args.line), slug = line.id, requestedWork = args.work ? String(args.work) : "";
    if (line.archived) throw failure("BUSY", "The Line must be open and idle.", 409);
    if (!requestedWork) {
      if (line.running || service.startsNow.has(service.key(project, slug))) throw failure("BUSY", "The Line must be open and idle.", 409);
      if (line.status !== "stopped") throw failure("NOT_STOPPED", "Only a stopped Line can be retried.", 409);
    }
    const before = new Map(line.stations.filter(isWork).map(s => [s.id, { state:s.state, off:s.off }]));
    const retried = await service.act(project, slug, "retry", { ...(requestedWork ? { step:requestedWork } : {}), ...(guard ? { beforeLaunch:guard } : {}) });
    const current = lineOf(project, slug);
    const station = current.stations.find(s => isWork(s) && s.id === retried?.step);
    const workId = station?.id || "";
    const old = before.get(workId);
    // The service can return a historical Work when Retry settles the Line without launching.
    const changed = station && (!old || old.state !== station.state || old.off !== station.off);
    const started = changed && (!requestedWork || workId === requestedWork)
      && (station.state === "active" || station.state === "done" || (station.state === "wait" && blockingToolQuestion(station.asking)));
    const existingRecord = workId ? recordsOf(project).find(r => r.line === slug && r.work === workId) : null;
    const replacedFromId = retried?.replaced || "";
    const prevRecord = replacedFromId ? recordsOf(project).find(r => r.line === slug && r.work === replacedFromId) : null;
    if (workId && prevRecord && !existingRecord && workId !== prevRecord.work) {
      const currentPreset = station?.savedAgentId ? service.presets?.get(station.savedAgentId) : null;
      const hasRecordedLaunch = Boolean(station && (station.picked || station.selected || station.savedAgentId || station.savedAgent || station.detail));
      const retryEffort = station?.picked?.effort
        || (station?.selected ? station.selected.effort || "" : currentPreset ? currentPreset.effort || "" : hasRecordedLaunch ? "" : prevRecord.effort || "");
      const retryModel = modelOf(station)
        || (station?.selected ? station.selected.model || "" : currentPreset ? currentPreset.model || "" : hasRecordedLaunch ? "" : prevRecord.model || "");
      record({
        project:project.id, line:slug, work:workId, kind:inheritedKind(prevRecord.kind),
        ...(prevRecord.scope ? { scope:prevRecord.scope, ...(prevRecord.scopeSource ? { scopeSource:prevRecord.scopeSource } : {}) } : {}),
        preset:station?.savedAgentId || prevRecord.preset || "",
        presetName:station?.savedAgent || prevRecord.presetName || "",
        agent:station?.agent || prevRecord.agent || "",
        model:retryModel, selectedModel:station?.selected?.model ?? currentPreset?.model ?? "",
        effort:retryEffort,
        by:by || prevRecord.by || "",
      });
    }
    const effectiveRecord = existingRecord || (workId ? recordsOf(project).find(r => r.line === slug && r.work === workId) : null);
    const kind = resolvedWorkKind(current, station, effectiveRecord);
    return {
      line:slug, work:workId, ...(kind ? { kind } : {}),
      status:current.status, state:station?.state || "",
      started:Boolean(started),
    };
  }
  // What wait says of a Line beyond its status, so the coordinator needs no further call to go on (PE-927): a settled Line's
  // newest Work with its result as work gives it, cut in the middle when long; a Line still going, what its agent is doing now
  // and for how long nothing was heard.
  const RESULT_MOST = 8000, RESULT_HEAD = 5000;
  function waitedLine(project, l) {
    const works = l.stations.filter(isWork);
    if (waitPending(l)) {
      const runs = service.heldWorks?.(project, l.id) || [];
      const now = runs.find(r => r.now)?.now || works.find(s => s.state === "active" && s.now)?.now || "";
      const heard = Math.max(l.lastActivityAt || 0, service.activity?.load(project, l.id).rows.at(-1)?.at || 0, ...runs.map(r => r.heardAt || r.started || 0));
      return { ...(now && now !== "Working" ? { now:clip(now, 200) } : {}), ...(heard ? { quietSeconds:Math.max(0, Math.round((Date.now() - heard) / 1000)) } : {}) };
    }
    const newest = works.findLast(s => s.state !== "todo" && s.state !== "active");
    if (!newest) return {};
    let result = "";
    try { result = workView(project, { line:l.id, work:newest.id }).result || ""; } catch { /* Gone since the Line was read: work says why. */ }
    const cut = result.length > RESULT_MOST;
    if (cut) result = `${result.slice(0, RESULT_HEAD)}\n\n[… ${result.length - RESULT_MOST} characters left out here: call work for all of it …]\n\n${result.slice(RESULT_HEAD - RESULT_MOST)}`;
    return { work:newest.id, state:newest.state, ...(newest.off ? { off:newest.off } : {}), agent:newest.agent, ...(newest.took ? { took:newest.took } : {}), result, ...(cut ? { resultCut:true } : {}),
      ...(works.length > 1 ? { works:works.map(s => ({ work:s.id, state:s.state, ...(s.off ? { off:s.off } : {}) })) } : {}) };
  }
  // wait:<seconds> on create-line or add-task: waited for in the same call, one turn fewer for the coordinator. The wait comes
  // after the task is made and kept as done (agentCall), never inside that operation: a call sent again after PenEcho restarted
  // is answered with the task as it was made and waits on, as a separate wait would.
  async function andWait(project, made, args, signal, session) {
    const seconds = Number(args.wait);
    if (!(seconds > 0) || !made?.line || made.started === false) return made;
    return { ...made, waited:await waitFor(project, { lines:[made.line], seconds }, signal, session) };
  }
  // why on create-line: handing the whole job to one agent records the delegate route there, when decide has not been called.
  function routeOnce(project, session, args, by) {
    if (!session || !String(args.why || "").trim()) return;
    try {
      if (service.parsedDoc(project, session).front.route) return;
      decide(project, session, { route:"delegate", why:args.why, parts:[{ task:args.title || args.task || args.text || "", kind:args.kind, ...(args.scope ? { scope:args.scope } : {}), agent:args.agent }] }, by);
    } catch { /* The task runs all the same: decide says what was wrong with a route. */ }
  }
  async function waitFor(project, { lines = [], seconds = 600 } = {}, signal = null, session = "") {
    const slugs = [...new Set((Array.isArray(lines) ? lines : [lines]).map(x => lineOf(project, x).id))];
    const until = Date.now() + Math.min(WAIT_MOST, Math.max(1, Number(seconds) || 600) * 1000);
    if (!slugs.length) throw failure("EMPTY", "Name the lines to wait for.");
    const wait = { project:project.id, session, pending:[] };
    const sessionKey = session ? `${project.id}/${session}` : "";
    pruneWaitGrace();
    if (session) { waits.add(wait); lastWaitAt.set(sessionKey, Date.now()); }
    const stoppedWorksOf = l => l.stations
      .filter(s => isWork(s) && s.off !== "discarded" && s.off !== "ended" && (s.state === "error" || (s.state === "off" && (s.off === "stopped" || s.stopWhy === "error" || s.stopWhy === "limit"))))
      .map(s => ({ work:s.id, state:s.state, ...(s.off ? { off:s.off } : {}), ...(s.stopWhy ? { stopWhy:s.stopWhy } : {}) }));
    try {
      for (;;) {
        const now = slugs.map(slug => lineOf(project, slug));
        const halted = session && !signal?.aborted ? now.filter(l => !l.running && !waitPending(l) && l.orchestratedBySlug === session && l.stations.some(s => isWork(s) && cutShort(s))) : [];
        let handed = false;
        for (const l of halted) if (await handOn(project, l, session)) handed = true;
        if (handed) continue;
        wait.pending = now.filter(waitPending).map(l => ({ line:l.id, label:l.code || l.title }));
        const over = !wait.pending.length;
        if (over || Date.now() >= until || signal?.aborted) {
          return {
            done:over,
            lines:now.map(l => {
              const stoppedWorks = stoppedWorksOf(l);
              const toolQuestions = blockingToolQuestion(l.asking) ? l.asking.questions || [] : [];
              const questions = [...new Set([...(l.questions || []), ...toolQuestions].map(q => q.text).filter(Boolean))];
              let why = "";
              if (l.status === "stopped" || l.status === "waiting") { try { why = service.parsedDoc(project, l.id).front.why || ""; } catch { why = ""; } }
              return {
                line:l.id, status:l.status, running:Boolean(l.running),
                ...(why ? { why } : {}),
                ...(stoppedWorks.length ? { stoppedWorks } : {}),
                ...(questions.length ? { questions } : {}),
                ...waitedLine(project, l),
              };
            }),
          };
        }
        await new Promise(resolve => setTimeout(resolve, WAIT_MS));
      }
    } finally {
      waits.delete(wait);
      pruneWaitGrace();
      if (sessionKey && wait.pending.length && isOrchestrator(project, session)) lastWaitAt.set(sessionKey, Date.now());
      else if (sessionKey) lastWaitAt.delete(sessionKey);
    }
  }
  function setLineStatus(project, { line, to }) {
    const slug = lineOf(project, line).id;
    if (to === "archive") return service.act(project, slug, "close");
    if (to === "reopen") return service.act(project, slug, "reopen");
    if (to === "outdated") return service.act(project, slug, "outdated", { outdated:true });
    if (to === "pin" || to === "unpin") return service.act(project, slug, "pin", { pinned:to === "pin" });
    throw failure("BAD_STATUS", "to is archive, reopen, outdated, pin or unpin.");
  }
  function rename(project, { line, title }) {
    const slug = lineOf(project, line).id;
    return service.act(project, slug, "rename", { title:String(title || ""), baseHash:service.store.readText(project, L.linePath(slug)).hash });
  }

  function activeWorkIdOf(project, slug) {
    if (!project || !slug) return "";
    try {
      const works = lineOf(project, slug).stations.filter(isWork);
      return (works.findLast(s => s.state === "active") || works.at(-1))?.id || "";
    } catch { return ""; }
  }
  function markDelegated(project, session) {
    if (!project || !session) return;
    const workId = activeWorkIdOf(project, session);
    if (workId) trackBounded(delegatedWorks, `${project.id}\0${session}\0${workId}`);
  }
  function takeHandoffGuidance(project, session, own) {
    if (!project || !session) return "";
    const workId = activeWorkIdOf(project, session);
    const key = `${project.id}\0${session}\0${workId || "session"}`;
    if (guidedWorks.has(key)) return "";
    trackBounded(guidedWorks, key);
    return handoffGuidance(yes(own?.front?.["review for you"]));
  }
  // Reset stale route metadata from an earlier finished Work when a new follow-up Work starts on an Orchestrator Line.
  function workStarted(project, slug, step, { continuation = false, sameWorkRecovery = false, lane = false } = {}) {
    if (continuation || sameWorkRecovery || lane || !step?.id || step.replaces) return;
    let md, doc;
    try { md = service.readDoc(project, slug); doc = F.parseLine(md); } catch { return; }
    if (!yes(doc.front.orchestrator) || doc.front.job === MODEL_PRICES) return;
    const hasPriorFinished = doc.steps.some(s => F.AGENT_LIKE(s) && s.done && !s.off && s.id !== step.id);
    if (!hasPriorFinished) return;
    if (doc.front.route || doc.front["route why"] || doc.front["route parts"]) {
      service.writeDoc(project, slug, F.setFront(md, { route:null, "route why":null, "route parts":null }));
      service.changed(project);
    }
  }
  // When an Orchestrator Work finishes without calling decide, PenEcho records its silent default route ("self", or "delegate"
  // if it spawned child Lines directly) and infers the Work's kind via job-kind.js so ratings and per-kind rankings stay intact.
  function workFinished(project, slug, stepId) {
    if (!project || !slug || !stepId) return null;
    let md, doc, line;
    try { md = service.readDoc(project, slug); doc = F.parseLine(md); line = lineOf(project, slug); } catch { return null; }
    if (!yes(doc.front.orchestrator) || doc.front.job === MODEL_PRICES) return null;
    const works = line.stations.filter(isWork);
    const station = works.find(s => s.id === stepId);
    if (!station || isReviewWork(station, null)) return null;
    const workKey = `${project.id}\0${slug}\0${stepId}`;
    const isFirstWork = works[0]?.id === stepId;
    const startMin = station.startedAt ? Math.floor(station.startedAt / 60000) * 60000 : 0;
    const children = allLines(stateOf(project)).filter(l => l.id !== slug && (l.orchestratedBySlug === slug || (doc.front.id && l.orchestratedBy === doc.front.id)));
    const spawnedChild = delegatedWorks.has(workKey)
      || (isFirstWork ? children.length > 0 : startMin > 0 && children.some(c => (c.createdAt || 0) >= startMin));
    delegatedWorks.delete(workKey);
    guidedWorks.delete(workKey);
    let route = ROUTES.includes(doc.front.route) ? doc.front.route : "";
    if (!route) {
      route = spawnedChild ? "delegate" : "self";
      service.writeDoc(project, slug, F.setFront(md, { route, "route why":null, "route parts":null }));
      service.changed(project);
      service.onChange?.(project.id);
    }
    if (route === "delegate") return { route };
    const old = recordsOf(project).find(r => r.line === slug && r.work === stepId);
    const existingKind = storedKind(old?.kind);
    if (existingKind) return { route, kind:existingKind };
    const ask = askForWork(line, station);
    const askText = ask?.text || (isFirstWork ? line.ask?.text || "" : "");
    let kind = implicitWorkKind(line, station);
    if (!kind && isFirstWork) kind = storedKind(doc.front["auto kind"]);
    if (!kind) kind = jobKind(askText, { make:ask?.make || null, usual:usualKind(project) }).kind;
    if (!kind && station.diff?.files > 0) kind = "code";
    if (!kind) {
      const idx = works.indexOf(station);
      const recs = recordsOf(project);
      const prior = works.slice(0, idx).reverse().map(w => storedKind(recs.find(r => r.line === slug && r.work === w.id)?.kind)).find(Boolean);
      kind = prior || "chat";
    }
    record({
      project:project.id, line:slug, work:stepId, kind, kindSource:"inferred",
      preset:station.savedAgentId || "", presetName:station.savedAgent || "", agent:station.agent || "",
      model:modelOf(station) || "", selectedModel:station.selected?.model || "", effort:effortOf(station, ""),
      by:doc.front.id || "",
    });
    return { route, kind };
  }

  // One level and no further: a part another agent was given hands nothing on, and no orchestrator's Line is given work by another,
  // or two of them could keep handing the same job to each other.
  const isPart = front => Boolean(front?.["orchestrated by"] || front?.["orchestrated by slug"]);
  function oneLevel(project, session, name, args, own) {
    if (isPart(own?.front) && (LAUNCH_OPS.has(name) || name === "decide")) throw failure("SUB_AGENT", "This is a part another orchestrator handed over. Do it here: it cannot be handed on.", 403);
    if (!["add-task", "start-line", "retry"].includes(name) || !args.line) return;
    const line = lineOf(project, args.line).id;
    if (line !== session && isOrchestrator(project, line)) throw failure("ORCHESTRATOR_LINE", "That Line has an orchestrator of its own, which only the person starts. Put the task on a new Line with create-line.", 403);
  }
  const partLabel = part => clip(String(part.task || "").replace(/\s+/g, " ").trim(), 60) || "a part";
  // A decision is an answer, not a change.
  const briefOf = part => { const words = String(part.brief || "").trim(); return words && optionalRole(part.role) === "decision" ? `${words}\n\nChange no files. Answer with the decision and the plan.` : words; };
  // decide's parts with a brief and no agent get theirs, so the route is read from who does what in the end.
  function settleParts(project, session, args) {
    const picks = new Map(), kept = [], parts = (Array.isArray(args.parts) ? args.parts : []).filter(Boolean).slice(0, 20);
    const open = parts.filter(part => namesNobody(part) && String(part.brief || "").trim());
    if (!session || args.route === "self" || !open.length) return { args, picks, kept };
    const by = new Map(assignParts(project, session, open).map(one => [one.part, one]));
    const all = parts.map(part => {
      const one = by.get(part);
      if (!one) return part;
      const settled = { ...part, agent:one.agent || "self" };
      if (one.agent) picks.set(settled, one); else kept.push({ task:partLabel(part), why:one.kept });
      return settled;
    });
    const others = all.filter(part => !namesNobody(part) && part.agent !== "self").length, route = !others ? "self" : others === all.length ? "delegate" : "split";
    return { args:{ ...args, route, parts:all, ...(route === "self" ? { why:"PenEcho found no other agent that fits." } : {}) }, picks, kept };
  }
  // A task added to a Line with no agent named: the Line's own agent goes on. When its app stopped it, the next that fits; after two, nobody.
  const cutShort = s => ["off", "error"].includes(s.state) && !["ended", "discarded"].includes(s.off) && ["limit", "error"].includes(s.stopWhy) && !/^PenEcho closed while this was running/.test(s.why || "");
  function nextOnLine(project, session, args) {
    const works = lineOf(project, args.line).stations.filter(isWork), last = works.findLast(s => s.state !== "todo"), stopped = works.filter(s => cutShort({ ...s, off:"" }));
    const own = last && !cutShort(last) && agents().agents.find(a => a.id === last.savedAgentId);
    if (own) return { agent:own.id, name:own.name, picked:optionalRole(args.role) };
    if (stopped.length > 1) return { kept:"Two agents were stopped on this Line already. Do it yourself." };
    return assignParts(project, session, [args], { without:last && cutShort(last) && last.stopWhy === "error" ? choiceOf(modelOf(last), effortOf(last)) : null, trial:false })[0];
  }
  // A new task on the Line says what happens next: Works stopped on it before are not handed on besides.
  function settleStopped(project, line) {
    const l = lineOf(project, line);
    for (const s of l.stations) if (isWork(s) && cutShort(s)) {
      const r = recordsOf(project).find(x => x.line === l.id && x.work === s.id);
      if (r?.picked && !r.handedOn) record({ project:project.id, line:l.id, work:s.id, handedOn:true });
    }
  }
  // A part PenEcho gave out that its app's usage limit or an error stopped goes on once with the next agent that fits. Stopped again, or with
  // nobody left, it is the orchestrator's own, as wait tells it. A part given to an agent by name stays as that choice left it.
  async function handOn(project, l, session) {
    const recorded = id => recordsOf(project).find(x => x.line === l.id && x.work === id);
    const s = l.stations.find(x => { const r = isWork(x) && cutShort(x) ? recorded(x.id) : null; return r?.picked && !r.handedOn; });
    if (!s) return false;
    const r = recorded(s.id);
    record({ project:project.id, line:l.id, work:s.id, handedOn:true });
    try {
      const [next] = assignParts(project, session, [{ kind:storedKind(r.kind), scope:r.scope || "", role:r.picked === "decision" ? "decision" : "" }],
        { without:s.stopWhy === "error" ? choiceOf(modelOf(s) || r.model, effortOf(s, r.effort)) : null, trial:false });
      if (!next.agent) return false;
      assertParentActive(project, session, parentIdentityOf(project, session));
      const made = await service.act(project, l.id, "carry-on", { preset:next.agent, step:s.id });
      if (made?.step) record({ project:project.id, line:l.id, work:made.step, picked:r.picked, handedOn:true });
      return Boolean(made?.step);
    } catch { return false; }
  }

  // One call, from the tab or the orchestrator's agent. `session`: the orchestrator Line calling, so its own rules apply.
  async function call(project, args = {}, { session = "", passGen = null, passLineId = "", signal = null } = {}) {
    const name = String(args.do || "");
    const own = session ? F.parseLine(service.readDoc(project, session)) : null, by = own?.front.id || "";
    if (session) oneLevel(project, session, name, args, own);
    switch (name) {
      case "help": return { functions:TOOLS.filter(([n]) => n !== "rebuild-topics" || Knowledge.topicsOn(project)).map(([n, a, d]) => ({ do:n, args:a, does:d })), kinds:KINDS, kindRules:KIND_RULES, ratingRules:RATING_RULES };
      case "overview": return overview(project, args);
      case "line": return lineView(project, args.line);
      case "work": return workView(project, args);
      case "agents": return agents();
      case "stats": return stats(project, args);
      case "plan": return plan(project, args, session);
      case "decide": {
        const { args:settled, picks, kept } = settleParts(project, session, args);
        const decided = decide(project, session, settled, by);
        if (settled.route === "delegate" || settled.route === "split") markDelegated(project, session);
        const answer = { ...decided, ...(kept.length ? { kept } : {}) };
        // The parts of other agents that came with a brief are started here, all of them before any is waited for: handed off one
        // after another, sub-Works ran side by side for only 6% of their time (PE-927).
        const briefed = (Array.isArray(settled.parts) ? settled.parts : []).filter(part => part && part.agent && part.agent !== "self" && String(part.brief || "").trim());
        if (!briefed.length) return answer;
        const started = [];
        for (const part of briefed) {
          const label = partLabel(part), pick = picks.get(part), said = { task:label, agent:part.agent, ...(pick ? { name:pick.name, ...(pick.picked === "trial" ? { trial:true } : {}) } : {}) };
          try {
            const made = await createLine(project, { task:briefOf(part), agent:part.agent, kind:part.kind, ...(part.scope ? { scope:part.scope } : {}), ...(part.title ? { title:part.title } : {}) }, by, session, passGen, passLineId, pick?.picked || "");
            started.push({ ...said, line:made.line, ref:made.ref, work:made.work });
          } catch (error) { started.push({ ...said, error:clip(error?.message || String(error), 300) }); }
        }
        const next = started.some(part => part.line) ? takeHandoffGuidance(project, session, own) : "";
        return { ...answer, started, ...(next ? { next } : {}) };
      }
      case "prices": return { models:prices() };
      case "set-price": return setPrice(args);
      case "create-line": {
        const one = session && namesNobody(args) ? assignParts(project, session, [args])[0] : null;
        if (one?.kept) return { started:false, kept:one.kept };
        const given = one ? { ...args, agent:one.agent } : args;
        const made = await createLine(project, { ...given, task:briefOf({ ...given, brief:given.task || given.text }) }, by, session, passGen, passLineId, one?.picked || "");
        if (made.started) {
          markDelegated(project, session);
          routeOnce(project, session, given, by);
        }
        const next = session && made.started ? takeHandoffGuidance(project, session, own) : "";
        return { ...made, ...(one ? { agent:one.agent, name:one.name } : {}), ...(next ? { next } : {}) };
      }
      case "start-line": return startLine(project, args, by, session, passGen, passLineId);
      case "add-task": {
        if (session && lineOf(project, args.line).id === session) throw failure("OWN_LINE", "Your own Line holds only your work. Start the first related task on a new Line with create-line, then add the others to that Line with add-task.");
        const one = session && namesNobody(args) ? nextOnLine(project, session, args) : null;
        if (one?.kept) return { line:lineOf(project, args.line).id, started:false, kept:one.kept };
        const given = one ? { ...args, agent:one.agent } : args;
        if (session) settleStopped(project, args.line);
        const added = await addTask(project, { ...given, task:briefOf({ ...given, brief:given.task || given.text }) }, by, session, passGen, passLineId, one?.picked || "");
        if (session) markDelegated(project, session);
        const next = session ? takeHandoffGuidance(project, session, own) : "";
        return { ...added, ...(one ? { agent:one.agent, name:one.name } : {}), ...(next ? { next } : {}) };
      }
      case "stop": await service.act(project, lineOf(project, args.line).id, "stop"); return { ok:true };
      case "retry": return retryLine(project, args, by, session, passGen, passLineId);
      case "wait": return waitFor(project, args, signal, session);
      case "rate": {
        // Several at once: each finished Work was a turn of its own to rate.
        if (Array.isArray(args.rates)) {
          const rated = [], errors = [];
          for (const one of args.rates.slice(0, 30)) {
            try { rated.push(rate(project, one || {}, by)); usage("work-rate"); }
            catch (error) { errors.push({ line:String(one?.line || ""), work:String(one?.work || ""), error:clip(error?.message || String(error), 300) }); }
          }
          return { rated, ...(errors.length ? { errors } : {}) };
        }
        const rated = rate(project, args, by); usage("work-rate"); return rated;
      }
      case "review": {
        // The person reviews unless they asked the orchestrator to review for them.
        if (own && !yes(own.front["review for you"])) throw failure("PERSON_REVIEWS", "The person reviews these Works themselves. Rate them instead, and say in your report what waits for their review.", 403);
        const slug = lineOf(project, args.line).id;
        if (args.work) await service.act(project, slug, "review", { step:String(args.work), reviewed:args.reviewed !== false });
        else await service.act(project, slug, "review-all");
        return { ok:true };
      }
      case "todo": await service.act(project, lineOf(project, args.line).id, "todo", { todo:args.todo !== false }); return { ok:true };
      case "status": await setLineStatus(project, args); return { ok:true };
      case "rename": await rename(project, args); return { ok:true };
      case "rebuild-topics": {
        const parentIdentity = session ? parentIdentityOf(project, session) : null;
        const guard = session ? () => assertParentActive(project, session, parentIdentity, passGen, passLineId) : null;
        guard?.();
        if (!session && !args.agent) return service.buildTopics(project, { rebuild:true });
        const choices = service.presets.list();
        const preset = assignmentPreset(args.agent || choices.jobs?.topics || choices.default);
        return service.buildTopics(project, { rebuild:true, preset:preset.id, ...(guard ? { beforeLaunch:guard } : {}) });
      }
      default: throw failure("BAD_FUNCTION", `There is no function "${clip(name, 40)}". Send {"do":"help"} for the list.`);
    }
  }

  // ---------- Orchestrator Lines ----------
  // An orchestrator is a Line of its own, marked so: its Ask is the person's job, word for word, and its agent gets the brief below.
  const starts = new Map(), priceStarts = new Map();
  async function start(project, { goal, preset, reviewForYou = false, attachments = [], requestId = "", purpose = "", make = null } = {}, { deferred = false } = {}) {
    const words = clip(String(goal || ""), 100000).trim();
    if (!words) throw failure("EMPTY", "Say what the orchestrator should get done.");
    if (requestId && !/^[a-f0-9-]{32,36}$/i.test(requestId)) throw failure("BAD_REQUEST_ID", "Invalid Start request id.");
    const files = (Array.isArray(attachments) ? attachments : []).filter(file => file && typeof file.path === "string")
      .map(({ path, name, type }) => ({ path, name, type }));
    if (files.length > 20) throw failure("TOO_MANY_FILES", "A job can include up to 20 files.");
    const lookup = !deferred && purpose === MODEL_PRICES;
    const output = lookup ? null : F.cleanMake(make);
    const fingerprint = F.hashText(JSON.stringify([words, preset, reviewForYou === true, files, ...(lookup ? [MODEL_PRICES] : []), ...(output ? [output] : []), ...(deferred ? ["deferred"] : [])]));
    const key = requestId && `${project.id}/${requestId}`;
    const conflict = () => failure("CONFLICT", "This Start request has already been used for a different job.", 409);
    if (key && starts.has(key)) {
      const pending = starts.get(key);
      if (pending.fingerprint !== fingerprint) throw conflict();
      return pending.result;
    }
    async function begin() {
      service.startRuntime();
      let slug, kept = null;
      const replayField = `price lookup ${requestId}`;
      if (requestId) {
        const topics = service.store.scan(project).topics;
        const existing = topics.find(t => t.doc.front[replayField]) || topics.find(t => t.doc.front["orchestrator request"] === requestId);
        if (existing) {
          if (existing.doc.front[replayField]) {
            if (existing.doc.front[replayField] !== fingerprint) throw conflict();
            return { line:existing.slug, status:existing.doc.status };
          }
          if (existing.doc.front["request fingerprint"] !== fingerprint) throw conflict();
          if (deferred) return { line:existing.slug, status:existing.doc.status };
          slug = existing.slug; kept = existing.doc.front;
          const work = existing.doc.steps.find(F.AGENT_LIKE);
          if (existing.doc.status !== "not-started" || !work || work.done || service.heldWorks(project, slug).length ||
              service.store.exists(project, F.detailPath(slug, work.id))) return { line:slug, status:existing.doc.status };
        }
      }
      // PenEcho Auto: only when the person picked it. A request sent again keeps the agent its first try chose, while it can still run.
      const runnable = id => service.presets?.list().presets.some(p => p.id === id && p.available && p.showInPicker !== false);
      if (deferred) {
        const isAuto = preset === AUTO_PRESET;
        let savedAgent = "", savedPreset = "";
        if (isAuto) {
          if (!service.presets?.list().presets.some(p => p.available && p.showInPicker !== false)) {
            throw failure("BAD_AGENT", "PenEcho Auto has no agent to start. Add one in Settings → Agents.");
          }
          savedPreset = AUTO_PRESET;
        } else {
          const chosen = service.presets?.get(String(preset || ""));
          if (!chosen || !runnable(chosen.id)) throw failure("BAD_AGENT", "Choose a runnable agent shown in your agent pickers.");
          savedAgent = chosen.agent;
          savedPreset = chosen.id;
        }
        for (const file of files) if (!/^files\/_incoming\/[^/\\]+$/.test(file.path)) throw failure("BAD_UPLOAD", "Choose an uploaded file from this project.");
        const front = { orchestrator:"yes", "review for you":reviewForYou === true ? "yes" : null, labels:ORCHESTRATOR,
          ...(requestId ? { "orchestrator request":requestId, "request fingerprint":fingerprint } : {}) };
        const made = await service.createTopic(project, { text:words, kinds:["ask"], unsent:true, agent:savedAgent, preset:savedPreset, start:false, attachments:files, make:output }, front);
        return { line:made.slug, status:service.parsedDoc(project, made.slug).status };
      }
      const first = kept && runnable(kept["auto agent"]) ? { id:kept["auto agent"], name:service.presets.get(kept["auto agent"])?.name || "", kind:normalizeKind(kept["auto kind"]), from:kept["auto from"] ? [kept["auto from"]] : [], why:kept["auto why"] || "" } : null;
      const auto = preset === AUTO_PRESET ? first || autoPreset(project, { text:words, make:output }) : null;
      const autoFront = auto ? { "auto agent":auto.id, "auto kind":auto.kind || null, "auto from":auto.from.join(", ") || null, "auto why":auto.why || null } : {};
      const chosen = service.presets?.get(String(auto ? auto.id : preset || ""));
      if (!chosen || !runnable(chosen.id)) throw failure("BAD_AGENT", "Choose a runnable agent shown in your agent pickers.");
      if (lookup) {
        const active = priceStarts.get(project.id) || activePriceLookup(project, allLines(stateOf(project)));
        if (active) {
          const result = await active;
          // A second tab may lose its response and replay its own ID after this lookup has finished.
          if (requestId) service.writeDoc(project, result.line, F.setFront(service.readDoc(project, result.line), { [replayField]:fingerprint }));
          return result;
        }
      }
      async function launch() {
        if (!slug) {
          for (const file of files) if (!/^files\/_incoming\/[^/\\]+$/.test(file.path)) throw failure("BAD_UPLOAD", "Choose an uploaded file from this project.");
          const front = { orchestrator:"yes", "review for you":reviewForYou === true ? "yes" : null, labels:ORCHESTRATOR,
            ...(lookup ? { job:MODEL_PRICES } : {}), ...(requestId ? { "orchestrator request":requestId, "request fingerprint":fingerprint } : {}), ...autoFront };
          const made = await service.createTopic(project, { text:words, agent:chosen.agent, preset:chosen.id, start:false, attachments:files, make:output }, front);
          slug = made.slug;
        } else if (auto && auto !== first) {
          // The agent its first try chose cannot run any more: the job says the new one, and its Work goes to that agent's app.
          service.writeDoc(project, slug, F.setFront(service.readDoc(project, slug), autoFront));
          service.handTo(project, slug, chosen.agent);
        }
        service.pickPreset(project, slug, chosen.id, chosen.agent);
        await service.begin(project, slug);
        if (!lookup) usage("orchestrator-job");
        return { line:slug, status:service.parsedDoc(project, slug).status, ...(auto ? { auto:{ agent:auto.name, kind:auto.kind, from:auto.from.join(", "), why:auto.why } } : {}) };
      }
      const result = launch();
      if (!lookup) return result;
      priceStarts.set(project.id, result);
      try { return await result; }
      finally { priceStarts.delete(project.id); }
    }
    const result = begin();
    if (key) starts.set(key, { fingerprint, result });
    try { return await result; }
    finally { if (key) starts.delete(key); }
  }
  function sessions(project) {
    // Each Line file is read once: which Lines are orchestrators, and which orchestrator started each of the others.
    const lines = allLines(stateOf(project)), fronts = new Map(lines.map(l => { try { return [l.id, service.parsedDoc(project, l.id).front]; } catch { return [l.id, {}]; } }));
    const parents = F.orchestratorParents(fronts);
    const held = new Map();
    for (const [key, run] of service.localRunEntries()) {
      if (!held.has(key)) held.set(key, []);
      held.get(key).push(run);
    }
    function activity(l) {
      const runs = held.get(service.key(project, l.id)) || [];
      const reviewing = LINE_STATUS.lineReviewing(l);
      const progress = runs.find(r => r.now)?.now || l.stations.find(s => s.state === "active" && s.now)?.now;
      const lastActivityAt = Math.max(l.lastActivityAt || 0, service.activity.load(project, l.id).rows.at(-1)?.at || 0, ...runs.map(r => r.heardAt || r.started || 0));
      return { lastActivityAt, canStop:runs.some(r => !r.stopping) || reviewing, ...(reviewing ? { reviewing:true } : {}), ...(l.running && progress && progress !== "Working" ? { progress:clip(progress, 300) } : {}) };
    }
    const recordsByWork = new Map(recordsOf(project).map(r => [`${r.line}\0${r.work}`, r]));
    const reason = l => ["stopped", "waiting"].includes(l.status) && fronts.get(l.id)?.why ? { why:fronts.get(l.id).why } : {};
    const workOf = (line, s) => {
      const r = recordsByWork.get(`${line.id}\0${s.id}`), isReview = isReviewWork(s, r);
      const kind = resolvedWorkKind(line, s, r);
      return { work:s.id, label:s.label, ...(kind ? { kind } : {}), agent:s.agent, savedAgent:s.savedAgent || "", state:s.state, reviewed:Boolean(s.reviewed),
        ...(s.off ? { off:s.off } : {}),
        ...(s.stopWhy ? { stopWhy:s.stopWhy } : {}),
        ...(!isReview && s.orchScore ? { score:s.orchScore, note:s.orchNote || "", scoredAt:s.orchScoredAt || "", by:s.orchBy || "" } : {}) };
    };
    return lines.filter(l => yes(fronts.get(l.id).orchestrator)).map(l => {
      const front = fronts.get(l.id), ref = front.id || "", works = l.stations.filter(isWork), last = [...works].reverse().find(s => s.state === "done" && s.out);
      // A report from an earlier Work is named as such, and a Work stopped before it reported says so, instead of reading as this job's answer (PE-639).
      const newest = works.at(-1), earlier = last && newest && newest.id !== last.id ? { reportLabel:last.label || last.id } : {};
      const settled = ["ready", "landed"].includes(LINE_STATUS.lineState(l)) && !LINE_STATUS.lineWorking(l) && !LINE_STATUS.lineNeedsYou(l) && !LINE_STATUS.nextToReview(l);
      const cut = !l.running && !l.archived && !l.closed && !settled && newest?.state === "off" && newest.off === "stopped" && newest.reviewed !== true
        ? { stoppedWork:newest.label || newest.id } : {};
      const children = lines.filter(x => x.id !== l.id && parents.get(x.id) === l.id);
      const waitingOn = new Map();
      if (l.running) for (const wait of waits) {
        if (wait.project === project.id && wait.session === l.id) for (const target of wait.pending) waitingOn.set(target.line, target);
      }
      const route = ROUTES.includes(front.route) ? { route:front.route, routeWhy:front["route why"] || "", ...(front["route parts"] ? { routeParts:front["route parts"] } : {}) } : {};
      // What PenEcho Auto took the job to be and why it started this agent (autoPreset).
      const auto = front["auto agent"] ? { auto:{ kind:normalizeKind(front["auto kind"]), from:front["auto from"] || "", why:front["auto why"] || "" } } : {};
      const reviewed = works.findLast(s => s.review && !s.review.ignored && (s.review.score || s.review.verdict));
      const unsentAsk = !works.length ? l.stations.find(s => s.kind === "ask" && s.unsent) : null;
      const unsentPreset = unsentAsk?.savedAgentId || "";
      const unsentAgent = unsentPreset && unsentPreset !== AUTO_PRESET ? (service.presets?.get(unsentPreset)?.agent || "") : "";
      const ownReason = unsentAsk && front.why === F.NOT_SENT ? {} : reason(l);
      // When the job was handed over, which is when one kept for later was started: the page keeps the jobs under way in this order.
      const made = madeBy([l, ...children]);
      const askedAt = F.labelTime(l.stations.find(s => s.kind === "ask" && !s.unsent)?.when) || l.createdAt || 0;
      return { line:l.id, ref, title:l.title, status:l.status, askedAt, ...(front["orchestrator request"] ? { requestId:front["orchestrator request"] } : {}), ...ownReason, ...route, ...auto, ...(unsentAsk ? { unsent:true, unsentStep:unsentAsk.id, ...(unsentPreset ? { unsentPreset } : {}) } : {}), ...(reviewed ? { ...(reviewed.review.score ? { reviewScore:reviewed.review.score } : {}), ...(reviewed.review.verdict ? { reviewVerdict:reviewed.review.verdict } : {}) } : {}), ...activity(l), ...(waitingOn.size ? { waitingOn:[...waitingOn.values()] } : {}), running:Boolean(l.running), archived:Boolean(l.archived), agent:l.agent || unsentAgent || "", reviewForYou:yes(front["review for you"]), updatedAt:l.updatedAt || 0,
        ...(last ? { report:clip(String(last.out), 600), reportWork:last.id, ...earlier } : {}), ...cut, ...(l.questions?.length ? { questions:l.questions.map(q => q.text) } : {}),
        ...(made.length ? { made } : {}),
        lines:children.map(x => ({ line:x.id, ref:x.code || "", title:x.title, status:x.status, ...reason(x), ...activity(x), running:Boolean(x.running), archived:Boolean(x.archived), works:x.stations.filter(isWork).map(s => workOf(x, s)) })) };
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  // What a Line's Works made that a person opens, newest first, for its session's card: what they drew and what their results point to
  // (work-outputs.js). Plain pictures and links to other Lines stay on the Works.
  const MADE_MOST = 24;
  function madeBy(lines) {
    const made = new Map();
    for (const l of lines) for (const s of [...l.stations].reverse()) {
      if (!isWork(s) || s.state === "todo" || s.off === "discarded") continue;
      for (const o of [...(s.pictures || []).map(pic => ({ kind:"drawn", path:pic.path, title:pic.title })), ...(s.outputs || []).filter(o => o.kind !== "picture" && o.kind !== "line")]) {
        if (made.size < MADE_MOST && !made.has(o.path)) made.set(o.path, { kind:o.kind, path:o.path, ...(o.title ? { title:o.title } : {}), ...(o.code ? { code:true } : {}), line:l.id, step:s.id });
      }
    }
    return [...made.values()];
  }
  function isOrchestrator(project, slug) {
    try { return yes(F.parseLine(service.readDoc(project, slug)).front.orchestrator); } catch { return false; }
  }
  function isWaiting(project, slug) {
    const pid = typeof project === "string" ? project : project?.id;
    if (!pid || !slug) return false;
    for (const wait of waits) if (wait.project === pid && wait.session === slug) return true;
    const proj = typeof project === "object" && project?.docsPath ? project : service.store?.projects?.find(p => p.id === pid);
    if (proj && isOrchestrator(proj, slug) && service.activeChildrenOf?.(proj, slug, null, { includeExternal:true })?.length > 0) return true;
    return false;
  }
  function isWaitGrace(project, slug, now = Date.now()) {
    const pid = typeof project === "string" ? project : project?.id;
    if (!pid || !slug) return false;
    pruneWaitGrace(now);
    const key = `${pid}/${slug}`;
    const recent = lastWaitAt.get(key) || 0;
    if (recent && now - recent < WAIT_GRACE_MS) return true;
    if (recent) lastWaitAt.delete(key);
    return false;
  }
  function passFor(project, slug) {
    const key = `${project.id}/${slug}`;
    // Always reload & complete any pending legacy gen-0 migration strictly BEFORE allocating/ensuring a generation fence,
    // so preparing a launch after a recovered passes.json EIO never bumps generations.json ahead of passes.json.
    loadPasses({ strict:true });
    const latestGen = ensureSessionGen(project, slug);
    const reloaded = passOf.get(key);
    if (reloaded && (passes.get(reloaded)?.gen || 0) >= latestGen) return reloaded;
    let lineId = "";
    try { lineId = F.parseLine(service.readDoc(project, slug)).front.id || ""; } catch {}
    const pass = signPass({ projectId:project.id, slug, gen:latestGen, lineId });
    const entry = { projectId:project.id, slug, gen:latestGen, ...(lineId ? { lineId } : {}) };
    // Persist bounded passes (pruning older generations for this Line) BEFORE caching or handing it to an agent.
    writeBoundedPasses(pass, entry);
    for (const [token, held] of [...passes.entries()]) {
      if (held.projectId === project.id && held.slug === slug) passes.delete(token);
    }
    passOf.set(key, pass);
    passes.set(pass, entry);
    return pass;
  }
  let base = "";
  const urlOf = () => {
    const draw = service.drawEnv?.()?.PENECHO_DRAW_URL || "";
    return base || (draw ? draw.replace(/\/api\/draw$/, "/api/lines/orchestrate") : "");
  };
  // Only an orchestrator Line's run is given these. Not *TOKEN*: Codex leaves such names out of the environment its commands get.
  function env(project, slug, doc) {
    if (!yes(doc?.front?.orchestrator) || isPart(doc.front) || !urlOf()) return null;
    return { PENECHO_ORCH_URL:urlOf(), PENECHO_ORCH_PASS:passFor(project, slug), PENECHO_ORCH_ENDPOINT:endpointFile, PENECHO_ORCH_HELPER:HELPER_PATH, PENECHO_ORCH_PROOF_KEY:orchToken, PENECHO_ORCH_INSTANCE:instanceId };
  }
  // The orchestrator's Line when it gave this Work out, so its agent is told it does one part; null for what the person asked themselves.
  function assignedBy(project, slug, work) {
    const r = recordsOf(project).find(x => x.line === slug && x.work === work);
    if (!r?.by) return null;
    let front;
    try { front = service.parsedDoc(project, slug).front; } catch { return null; }
    return yes(front.orchestrator) && !isPart(front) ? null : { line:front["orchestrated by slug"] || "" };
  }
  // Which tier of Orchestrator brief this Ask needs: "lookup" (model prices), "light" (trivial, simple chat, or narrow Light tweak),
  // or "full" (standard/heavy work, follow-ups like "build it", or any request mentioning delegation/splitting/comparing agents).
  function briefMode(doc, { askText = "", make = null, hasCanvas = false, hasAttachments = false } = {}) {
    if (!yes(doc?.front?.orchestrator) || isPart(doc.front)) return "";
    if (doc.front.job === MODEL_PRICES) return "lookup";
    const text = String(askText || "").trim();
    if (!text || hasCanvas || make) return "full";
    if (WANTS_ORCH_BRIEF.test(text)) return "full";
    if (PURE_GREETING.test(text) || isTrivialAsk(text, { hasCanvas, hasAttachments })) return "light";
    const guess = jobKind(text, { make });
    if (guess.kind === "chat" && text.length <= 400 && !/```/.test(text)) return "light";
    if (inferLightScope(text, { kind:guess.kind, hasCanvas, hasAttachments })) return "light";
    return "full";
  }
  function brief(project, slug, doc, { agent = "", askText = "", make = null, hasCanvas = false, hasAttachments = false, resumedBrief = "", platform = process.platform } = {}) {
    const mode = briefMode(doc, { askText, make, hasCanvas, hasAttachments });
    if (!mode) return "";
    // A resumed conversation already holds its brief in history unless it previously only received the 2-line Light brief and now needs full.
    if (resumedBrief === "full" || (resumedBrief === "light" && mode === "light")) return "";
    const runner = String(agent || doc?.front?.who || "").replace(/^@/, "").toLowerCase();
    const builtIn = runner === "penecho";
    const reviewForYou = yes(doc.front["review for you"]);
    const win = platform === "win32";
    const callSyntax = builtIn
      ? `your \`orchestrate\` tool, a JSON string with "do" and its arguments (for example \`orchestrate({ "payload": "{\\"do\\":\\"help\\"}" })\`)`
      : win
        ? `\`'{"do":"<call>", ...}' | node "$env:PENECHO_ORCH_HELPER"\``
        : `\`node "$PENECHO_ORCH_HELPER" '{"do":"<call>", ...}'\``;
    const planCall = builtIn
      ? `\`orchestrate({ "payload": "{\\"do\\":\\"plan\\"}" })\``
      : win
        ? `\`'{"do":"plan"}' | node "$env:PENECHO_ORCH_HELPER"\``
        : `\`node "$PENECHO_ORCH_HELPER" '{"do":"plan"}'\``;
    if (mode === "lookup") {
      return [
        `You are this project's orchestrator. Call PenEcho with ${callSyntax}; it survives restarts, so check state before repeating a call.`,
        "Calls: prices; set-price {model, input, output, cached?, cacheWrite?, source?}; help.",
        "Never merge, push or delete. End with a short report of what you saved.",
      ].join("\n\n");
    }
    if (mode === "light") {
      return [
        `You are on an Orchestrator Line. For a quick or simple ask like this, answer or handle it directly — no decide call needed. If it turns out to need delegation or parallel agents, call ${planCall} (or \`help\`).`,
        reviewForYou ? "The person asked you to review for them: mark delegated Works you accept reviewed." : "",
        "Never merge, push or delete; archive only if asked.",
      ].filter(Boolean).join("\n");
    }
    // Who could take a part now, for the kind of job the Ask reads as.
    let now = "";
    try { now = subNow(project, slug, jobKind(askText, { make, usual:usualKind(project) }).kind); } catch { /* The brief still holds without it; decide says who fits. */ }
    // Compact brief (PE-1097, PE-1190): when to keep the job and when to split it; PenEcho picks who does a part.
    // The wait/check/rate rules arrive lazily on the first delegation reply, so solo Works never carry them.
    return [
      `You are this project's orchestrator. Call PenEcho with ${callSyntax}; it survives restarts, so check state before repeating a call. Calls: ${BRIEF_CALLS}; help lists the rest.`,
      [
        "1. The person named agents or models, or asked for several agents (views, a comparison, a round table, parts side by side): do that, naming each part's agent (agents lists them).",
        "2. A question, a simple fix, anything done in about 5 minutes: do it yourself, with no decide call.",
        "3. Longer work: first decide, then do. Make the plan, architecture and hard trade-offs yourself, or ask one stronger model with a part of role:\"decision\". Then hand over the parts that stand on their own with decide {route:\"delegate\"|\"split\", why, parts:[{task, kind, scope?, role?, brief, title?}], wait?}, naming no agent: PenEcho picks one about as good as you at under half your cost, and you keep the parts nobody fits. Send independent parts together and do yours meanwhile; send ordered ones one after another. Keep a change with its tests, parts under 5 minutes, and work that hangs on what you hold.",
        "A brief is the goal, the context it needs (facts you checked, files, the person's limits) and the reply you want. How to do it and how much to test is theirs.",
        "Kinds: code, chat, design (UI/UX, visual, canvas/prototypes, 3D/Blender), research, docs. Scopes: light, standard [default], heavy.",
      ].join("\n"),
      now,
      reviewForYou ? "The person asked you to review for them: mark the Works you accept reviewed." : "",
      "Never merge, push or delete; archive only if asked. Report the job as one result and link what its parts made for the person; leave out the route, agent names, scores and bookkeeping.",
    ].filter(Boolean).join("\n\n");
  }
  // The agent's own call. The pass names the Line and its project; nothing else can be reached with it.
  async function agentCall(pass, args, signal, options = {}) {
    const at = {}, made = await agentOp(pass, args, signal, options, at), action = String(args?.do || "");
    if (!at.project) return made;
    if (action === "decide" && Number(args.wait) > 0) {
      const lines = (made?.started || []).map(part => part.line).filter(Boolean);
      return lines.length ? { ...made, waited:await waitFor(at.project, { lines, seconds:Number(args.wait) }, signal, at.session) } : made;
    }
    return ["create-line", "add-task"].includes(action) ? andWait(at.project, made, args, signal, at.session) : made;
  }
  async function agentOp(pass, args, signal, { opId = "" } = {}, at = {}) {
    const token = String(pass || "");
    const action = String(args?.do || "");
    // Always consult authoritative passes.json & generations.json on disk so external revocation/removal is unconditional.
    if (token) loadPasses({ strict:true });
    const held = token ? passes.get(token) : null;
    if (!held && token) {
      const signed = parseSignedPass(token);
      // Every active v2 pass is stored in passes.json; a verified v2 pass absent from passes.json was revoked by Stop or Delete.
      if (signed) throw failure("PARENT_STOPPED", "The parent orchestrator was stopped.", 409);
    }
    const project = held && service.store.projects.find(p => p.id === held.projectId);
    if (!project || !service.isLine(project, held.slug) || !isOrchestrator(project, held.slug)) throw failure("NO_PASS", "This pass is not an orchestrator's.", 403);
    const passGen = Number(held.gen) || 0;
    const passLineId = held.lineId || "";
    at.project = project; at.session = held.slug;
    if (LAUNCH_OPS.has(action) && (passGen < sessionGenOf(project, held.slug) || service.isStoppingLine?.(project, held.slug))) {
      throw failure("PARENT_STOPPED", "The parent orchestrator was stopped.", 409);
    }
    const cleanOpId = OP_ID_OK.test(String(opId || "")) && MUTATING_OPS.has(action) ? String(opId) : "";
    const run = async () => {
      const result = await call(project, args, { session:held.slug, passGen, passLineId, signal });
      if (["create-line", "add-task"].includes(action) && !result?.kept) usage("orchestrator-task");
      if (action === "decide") for (const part of result?.started || []) if (part.line) usage("orchestrator-task");
      return result;
    };
    if (!cleanOpId) return run();
    const opKey = `${project.id}/${held.slug}/${cleanOpId}`;
    const fp = F.hashText(JSON.stringify(args || {}));
    const prior = ops.get(opKey);
    if (prior) {
      if (prior.fp !== fp) throw failure("CONFLICT", "This operation ID was already used for a different request.", 409);
      if (prior.state === "done" || (!prior.state && "result" in prior)) return prior.result;
      if (prior.state === "failed") throw failure(prior.code || "ERROR", prior.message || "Operation failed.", prior.status || 500);
      const activeOp = inFlightOps.get(opKey);
      if (activeOp) {
        if (activeOp.fp !== fp) throw failure("CONFLICT", "This operation ID is already in flight for a different request.", 409);
        return activeOp.promise;
      }
      // Persisted as pending from an earlier PenEcho that exited mid-operation: never re-execute blindly.
      throw failure("AMBIGUOUS_OUTCOME", "This operation was started before PenEcho restarted and its outcome is unknown. Inspect current Line state before submitting a new request.", 409);
    }
    const activeOp = inFlightOps.get(opKey);
    if (activeOp) {
      if (activeOp.fp !== fp) throw failure("CONFLICT", "This operation ID is already in flight for a different request.", 409);
      return activeOp.promise;
    }
    // Write-ahead durable operation record BEFORE side effects: fail closed if the operation log cannot be written.
    ops.set(opKey, { state:"pending", at:Date.now(), fp });
    try {
      saveOps();
    } catch (error) {
      ops.delete(opKey);
      throw failure("OP_LOG_FAILED", `Could not persist operation record before executing ${action}: ${error.message}`, 503);
    }
    const promise = (async () => {
      try {
        const result = await run();
        ops.set(opKey, { state:"done", at:Date.now(), fp, result });
        try { saveOps(); } catch { /* Pending WAL already prevents duplicate replay across restarts. */ }
        return result;
      } catch (error) {
        ops.set(opKey, { state:"failed", at:Date.now(), fp, code:error?.code || "ERROR", status:error?.status || 500, message:error?.message || String(error) });
        try { saveOps(); } catch { /* Pending WAL already prevents duplicate replay across restarts. */ }
        throw error;
      }
    })();
    inFlightOps.set(opKey, { fp, promise });
    try { return await promise; }
    finally { inFlightOps.delete(opKey); }
  }
  const reviews = createOrchReview({ service, dir, prices, writePrices, record, recordsOf, lineOf, isOrchestrator, isWork, rank:rankReviewers, writeAtomic, readJson,
    recordOf:(project, line, work) => recordsOf(project).find(r => r.line === line && r.work === work),
    eligibleAgents:() => agents().agents,
    // The models this computer's agents run: its saved agents', each agent app's default, and those its Works are recorded with.
    models:() => [...(service.presets?.list().presets || []).flatMap(p => [p.model, service.agents?.configuredModel?.(p.agent)]), ...loadRecords().flatMap(r => [r.model, r.selectedModel])],
    // A price lookup is PenEcho's own errand, not the person's job.
    skipLine:(project, slug) => service.parsedDoc(project, slug).front.job === MODEL_PRICES });
  return { settings:reviews.settings, setSettings:reviews.setSettings, sync:reviews.sync, lineFinished:reviews.lineFinished, requestReview:reviews.requestReview, stopReview:reviews.stopReview, stopReviewsForLine:reviews.stopReviewsForLine, continueReview:reviews.continueReview, resendReview:reviews.resendReview, ignoreReview:reviews.ignoreReview, close:reviews.close, reviews, TOOLS, KINDS, KIND_RULES, RATING_RULES, handoffGuidance, scoresByLine, scoresForLine, call, agentCall, start, autoPreset, sessions, stats, index, agentRecord, agentDays, prices, setPrice, modelPrices, env, briefMode, brief, workStarted, workFinished, isOrchestrator, assignedBy, isWaiting, isWaitGrace, announce, identity, invalidateSession, purgeLine, inheritAssignment, reload, records:project => recordsOf(project).map(recordedModelRow), setBase:url => { base = url; } };
}

module.exports = { createOrchestrator, TOOLS, KINDS, KIND_RULES, RATING_RULES, handoffGuidance };
