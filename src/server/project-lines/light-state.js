"use strict";
// A project's state with only what a page shows (PE-1132). A big project has hundreds of finished lines; the whole of them, with every
// Ask, result and token record, is tens of megabytes, sent each time the project opened. Here a finished line nobody has to look at is
// its name, where it stands and when its steps were (lightLine); a line that is going, waits for you or is still to review is whole. A page asks for more only
// when it shows it: `full`, the lines it has open, and `parts`:
//   files    the folder's list of files
//   tokens   each Work's own token record
//   stats    what Statistics counts of every Work
//   archive  the files an archived line links to
//   words    all of each line's last words, which the Home's filter looks through
// A line is never changed once it is in a state, so its light form is made once and kept with it: two states share the lines that did
// not change, and what changed between them (service.js stateChanges) is found by looking at which objects differ.
const LINE_STATUS = require("../../../public/lines/line-status.js");

const PARTS = ["files", "tokens", "stats", "archive", "words"];
// A row shows about this much of what was said last.
const WORDS_KEPT = 110;
// A project this small is sent whole: its state is a few tens of kilobytes compressed.
const SMALL = { stations:240, files:600 };
const COUNTED = ["id", "kind", "state", "off", "stopWhy", "agent", "reviewed"], COUNTED_MS = 32 * 24 * 60 * 60_000;
const DECK = /\.(?:pptx?|key|odp)$/i;

// The line's parts a page reads only while the line is open.
const HEAVY = new Set(["stations", "ask", "result", "tokens", "pictures", "conversation", "conversations", "decided", "handoffs", "removed", "questions", "questionRev",
  "topicAbsolutePath", "folder", "workdir", "routeWhy", "routeParts", "topicHash", "partList", "activitySeq", "started", "runLaunch", "runSteerMode", "titleBy"]);
const STATION = ["id", "index", "kind", "label", "state", "off", "agent", "when", "took", "startedAt", "endedAt", "reviewed", "finishedAsk", "unsent", "asked", "reviewing", "stopWhy", "meetingId", "isReview", "from"];
const STATION_STATS = ["savedAgent", "picked", "selected", "ranOn", "resolvedModel", "diff", "rating", "ratingNote", "ratedAt", "orchScore", "orchNote", "orchScoredAt", "carriedFrom", "resetsAt"];
const empty = value => value === undefined || value === null || value === "" || value === false || (Array.isArray(value) && !value.length);
// The words as the row shows them (line.js plainOut, firstLine), cut where they run past it. A line named from its first words does not
// say them twice, so those are kept besides.
const plain = text => String(text || "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
function clip(text, title = "", all = false) {
  const words = plain(text), name = plain(title).replace(/…$/, "").toLowerCase(), kept = WORDS_KEPT + (name && words.toLowerCase().startsWith(name) ? name.length : 0);
  return words.length > kept && !all ? `${words.slice(0, kept).replace(/\s+\S{0,12}$/, "")}…` : words;
}
const lastParagraph = text => { const t = String(text ?? "").trim(), last = t.split(/\n\s*\n/).pop() || ""; return last.length > WORDS_KEPT * 2 ? last.slice(-WORDS_KEPT * 2) : last; };
const isEnd = s => s.kind === "merge" || s.kind === "deliver";

// Finished, reviewed and with nothing to answer, send or run: nobody has to do anything about it.
function isQuiet(l) {
  if (!l || l.running || l.elsewhere || l.asking || l.waitingForReply || l.questions?.length) return false;
  if (l.archived) return true;
  if (LINE_STATUS.lineState(l) !== "landed" || LINE_STATUS.toLookAt(l) || LINE_STATUS.isReviewPending(l) || LINE_STATUS.lineReviewing(l) || LINE_STATUS.lineWorking(l)) return false;
  return !(l.stations || []).some(s => s.unsent || s.held || s.state === "active" || s.state === "wait");
}

// The light form of each line, by what it has besides: nothing, "stats", "files" or both.
const forms = new Map();
// What Statistics counts of a Work's tokens.
function statTokens(t) {
  if (!t || typeof t !== "object") return null;
  const model = { requestModelId:t.requestModelId, requestModel:t.requestModel, ...(t.lastRequest?.model ? { lastRequest:{ model:t.lastRequest.model } } : {}) };
  const { startup } = t, cost = startup?.status === "compared" && startup.cost ? startup.cost : null;
  return { inputTokens:t.inputTokens ?? null, outputTokens:t.outputTokens ?? null, cacheReadInputTokens:t.cacheReadInputTokens ?? null, cacheWriteInputTokens:t.cacheWriteInputTokens ?? null,
    ...Object.fromEntries(Object.entries(model).filter(([, value]) => !empty(value))),
    ...(startup ? { startup:{ status:startup.status, ...(cost ? { cost:{ fresh:cost.fresh, resumed:cost.resumed, tokensPercent:cost.tokensPercent, costPercent:cost.costPercent } } : {}) } } : {}) };
}
// What the page fills in again (state.js fillLight) is left out: a step's place, "you" on your own steps, a Work's time said twice.
function lightStation(s, i, said, title, { stats, files, words, made }) {
  const out = {}, mine = LINE_STATUS.isYours(s);
  for (const key of STATION) if (!empty(s[key]) || (key === "reviewed" && typeof s[key] === "boolean" && !mine)) out[key] = s[key];
  if (s.index !== i) out.index = s.index;
  if (mine && out.agent === "you") delete out.agent;
  if (out.when && (out.when === out.took || (s.kind === "orch-review" && /^[1-9]\d* min/.test(out.took || "")))) delete out.when;
  // The row says its last words, and a question an agent ended on is still found in them.
  const speaks = said.includes(s);
  if (speaks) {
    // An Ask of nothing but an app's own blocks says what it holds (line.js stopWords), so it is kept as it is.
    if (s.text && mine) out.text = s.kind === "ask" ? clip(LINE_STATUS.askOnly(s.text), title, words) || String(s.text).slice(0, 400) : s.kind === "meeting" ? String(s.text).slice(0, 400) : clip(s.text, title, words);
    if (s.out || (!mine && s.text)) out.out = clip(s.out || s.text, title, words);
    if (s.why) out.why = clip(s.why, title, words);
    if (s.reviewStopped) out.reviewStopped = s.reviewStopped;
    if (s.review && typeof s.review === "object") out.review = { score:s.review.score, verdict:s.review.verdict };
  }
  if (made) {
    if (s.pictures?.length) out.pictures = s.pictures;
    if (s.outputs?.length) out.outputs = s.outputs;
  }
  if (speaks || files) {
    if (s.files?.length) out.files = s.files;
    if (s.pictures?.length) out.pictures = s.pictures;
    if (s.refers?.length && speaks) out.refers = s.refers;
  }
  if (stats) {
    for (const key of STATION_STATS) if (!empty(s[key])) out[key] = s[key];
    const tokens = statTokens(s.tokens);
    if (tokens) out.tokens = tokens;
    if (s.review && typeof s.review === "object") out.review = { score:s.review.score, verdict:s.review.verdict };
  }
  return out;
}
function countedStation(s) {
  const out = {}, at = ["endedAt", "startedAt", "when"].find(key => !empty(s[key]));
  for (const key of COUNTED) if (!empty(s[key])) out[key] = s[key];
  if (at) out[at] = s[at];
  return out;
}
// A line as its row needs it. `stats` and `files` add what Statistics and the Archive read of its steps.
function lightLine(line, { stats = false, files = false, words = false } = {}) {
  const form = `${stats ? "stats " : ""}${files ? "files" : ""}`, kept = form + (words ? " words" : ""), memo = forms.get(kept) || forms.set(kept, new WeakMap()).get(kept), had = memo.get(line);
  if (had) return had;
  const out = { light:true };
  for (const [key, value] of Object.entries(line)) if (!HEAVY.has(key) && !empty(value)) out[key] = typeof value === "number" ? Math.round(value) : value;
  if (out.slug === out.id) delete out.slug;
  if (out.topicPath === `lines/${line.slug}.md`) delete out.topicPath;
  if (!line.archived) delete out.landedAt;
  if (!out.runStarted) delete out.runStarted;
  // The step the row quotes (panorama.js lastWords) and the one an agent may have ended on a question in (state.js askedYou).
  const stations = line.stations || [], back = [...stations].reverse(), said = [back.find(s => !isEnd(s) && (s.unsent || (s.state !== "todo" && s.state !== "off"))) || stations[0], back.find(s => !isEnd(s) && s.kind !== "orch-review")];
  // An archived line is listed by its name; the Home's Works by day still counts its last month.
  // What an orchestrator's part made is shown on the orchestrator's own line too (line.js lineMade).
  const made = Boolean(line.orchestratedBySlug || line.orchestratedBy);
  out.stations = !line.archived || form ? stations.map((s, i) => lightStation(s, i, said, line.title, { stats, files, words, made }))
    : Date.now() - (line.lastActivityAt || 0) > COUNTED_MS ? [] : stations.filter(s => LINE_STATUS.isWork(s) && !s.unsent).map(countedStation);
  if (files) {
    if (line.ask?.files?.length || line.ask?.later?.some(x => x.files?.length)) out.ask = { text:"", when:line.ask.when || "", files:line.ask.files || [], later:(line.ask.later || []).filter(x => x.files?.length).map(x => ({ text:"", files:x.files })) };
    if (line.pictures?.length) out.pictures = line.pictures;
  }
  // A result that ended on no question is only known to be there.
  const ended = lastParagraph(line.result?.text || said[1]?.out);
  if (ended) out.result = { text:/[?？]/.test(ended) ? ended : "…", files:[] };
  memo.set(line, out);
  return out;
}

// The Home's card adds up what fresh starts saved over its period: these are all it reads of them. The rest of each Work's record stays behind.
const startRows = new WeakMap();
const side = x => ({ tokensIn:x?.tokensIn, cost:x?.cost, ...(x?.usd != null ? { usd:x.usd } : {}) });
function lightStart(x) {
  let row = startRows.get(x);
  if (!row) startRows.set(x, row = { workId:x.workId, at:x.at, status:x.status, difference:x.difference, taskEstimate:x.taskEstimate, baseline:x.baseline, ...(x.cost ? { cost:{ fresh:side(x.cost.fresh), resumed:side(x.cost.resumed), tokensPercent:x.cost.tokensPercent, costPercent:x.cost.costPercent } } : {}) });
  return row;
}
const lightStarts = starts => (Array.isArray(starts) ? starts.filter(x => x?.status === "compared").map(lightStart) : starts);

// What decides whether a project is sent whole: how much there is of it, and whether it is a folder of slides, whose Home draws its files.
// PenEcho Cloud keeps these with what it keeps of a project, and asks the same question of them.
const isDeckLine = l => (l.labels || []).includes("Slides"), isDeckFile = f => DECK.test(f.path);
const sentWhole = ({ stations = 0, files = 0, code = false, deck = false }) => (files <= SMALL.files && stations <= SMALL.stations) || (!code && deck);
const isSentWhole = state => sentWhole({ code:Boolean(state.project?.code), files:state.files?.length || 0, stations:[...state.lines, ...state.backlog, ...state.landed].reduce((n, l) => n + (l.stations?.length || 0), 0),
  deck:!state.project?.code && ([...state.lines, ...state.landed].some(isDeckLine) || (state.files || []).some(isDeckFile)) });
// An open line shows the files it made: those of the folder's list that are its own.
const fileOwner = f => /^(?:files|works)\/([^/]+)\//.exec(f.path)?.[1] || "";
const filesShown = state => (state.files || []).filter(f => f.kind).length + (state.artifacts || []).length;

// full: the lines to send whole (their ids), or "*" for every line. parts: which of PARTS.
function lightState(state, { full = [], parts = [] } = {}) {
  const whole = isSentWhole(state), every = whole || full === "*", open = new Set(every ? [] : full), want = new Set(whole ? PARTS : parts);
  const stats = want.has("stats"), words = want.has("words"), opened = l => every || open.has(l.id) || open.has(l.slug);
  const line = l => (opened(l) || !isQuiet(l) ? l : lightLine(l, { stats, words })), landed = l => (opened(l) ? l : lightLine(l, { stats, files:want.has("archive") }));
  const { files, tokens, artifacts, orchestrator:_orchestrator, takenSlugHashes:_taken, ...rest } = state, { records, starts, ...counts } = tokens || {};
  const lists = { lines:state.lines.map(line), landed:state.landed.map(landed), backlog:state.backlog.map(line) };
  const shown = every ? [] : [...lists.lines, ...lists.landed, ...lists.backlog].filter(opened), own = new Set(shown.map(l => l.slug));
  return {
    ...rest, view:"light", full:every ? "*" : shown.map(l => l.id), parts:PARTS.filter(part => want.has(part)),
    ...(own.size && !want.has("files") ? { lineFiles:(files || []).filter(f => own.has(fileOwner(f))) } : {}),
    filesShown:filesShown(state), artifacts:artifacts || [],
    tokens:tokens ? { ...counts, ...(starts ? { starts:lightStarts(starts) } : {}), ...(want.has("tokens") && records ? { records } : {}) } : tokens,
    ...lists,
    ...(want.has("files") ? { files:files || [] } : {}),
  };
}
// What a page asked for, as given in an address: full=a,b or *; parts=files,stats.
function wantsOf({ full = "", parts = "" } = {}) {
  const list = String(full || "").split(",").map(x => x.trim()).filter(Boolean);
  return { full:list.includes("*") ? "*" : [...new Set(list)].slice(0, 24).sort(), parts:PARTS.filter(part => String(parts || "").split(",").includes(part)) };
}

module.exports = { PARTS, fileOwner, filesShown, isDeckFile, isDeckLine, isQuiet, lightLine, lightStarts, lightState, sentWhole, wantsOf };
