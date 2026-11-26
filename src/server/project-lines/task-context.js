"use strict";
const { createHash, randomUUID } = require("node:crypto");
const F = require("./format.js");
const L = require("./layout.js");
const Tokens = require("./token-evidence.js");

const VERSION = 1, HISTORY_BYTES = 32 * 1024;
const hash = value => createHash("sha256").update(String(value || "")).digest("hex");
const bytes = value => Buffer.byteLength(String(value || ""));
const taskFile = (slug, step) => `${L.worksDir(slug)}/${step}.tokens.json`;
const manifestFile = (slug, step) => `${L.worksDir(slug)}/${step}.context.json`;
function excerpt(text, limit) {
  const value = String(text || "");
  if (bytes(value) <= limit) return value;
  const suffix = "\n[Excerpt; open the source for the complete text.]";
  let out = "", used = bytes(suffix);
  for (const ch of value) { const n = bytes(ch); if (used + n > limit) break; out += ch; used += n; }
  return out + suffix;
}

// PenEcho decides by itself whether the next Ask continues the last conversation or starts fresh with focused context.
// Continuing carries the whole conversation in every request of the next Work: cheap from the agent's prompt cache while it
// holds it (cacheMinutes), written to the cache again in full once it has expired. A fresh start pays once to read again what
// it needs. So a conversation continues only while it is in its cache and under its agent's limit; past either, a fresh start
// costs less. After another agent's Work it starts fresh, even if short and warm (PE-564).
// The limits are where 419 past Works (Nov 6-23), each replayed both ways at the cache behaviour measured on past resumes, cost
// least in total, and the same in both halves of that period: Claude 80k (lowest at 75k-85k), Codex 120k (100k-135k), the
// others, mostly Antigravity, 60k (flat from 0 to 90k). Next to a limit the cost barely changes; far from it, it does (PE-974).
const KEEP_TOKENS = { Claude:80000, Codex:120000 }, KEEP_OTHER = 60000;
const keepLimit = (agent, model) => KEEP_TOKENS[Tokens.weightsFor(agent, model).name] ?? KEEP_OTHER;
const inCache = (agent, model, idle) => idle != null && idle < Tokens.weightsFor(agent, model).cacheMinutes * 60000;
function autoMode({ previous, agent, size, endedAt, model = "", now = Date.now() }) {
  if (!previous) return { mode:"new", why:"First Work on this Line" };
  if (agent && previous.who && previous.who !== agent) return { mode:"new", why:"Another agent had the last conversation" };
  const who = agent || previous.who, idle = endedAt ? now - endedAt : null, minutes = idle == null ? "" : `${Math.round(idle / 60000)} min`, limit = keepLimit(who, model);
  if (size != null && size >= limit) return { mode:"new", why:`Long conversation (${size} input tokens, over ${limit / 1000}k)` };
  const what = size == null ? "Size unknown" : `Short conversation (${size} input tokens)`;
  return inCache(who, model, idle) ? { mode:"continue", why:`${what}, last Work ended ${minutes} ago` }
    : { mode:"new", why:`${what}, but ${idle == null ? "end time unknown" : `idle ${minutes}`}: its cache has expired` };
}
// An answer to the agent's question, or the next Ask after an unfinished Work, keeps the agent's memory while its cache holds,
// whatever the size. Once it has expired the whole conversation would be written to the cache again: in 14 of 15 such past Works
// a fresh start, which still gets the last result and its question, cost less, together under half (PE-974).
function answerMode({ previous, agent, endedAt, model = "", now = Date.now() }) {
  const why = "The last Work is unfinished or waiting for an answer", idle = endedAt ? now - endedAt : null;
  return idle == null || inCache(agent || previous?.who, model, idle) ? { mode:"continue", why } : { mode:"new", why:`${why}, but idle ${Math.round(idle / 60000)} min: its cache has expired` };
}

// The conversation of an earlier Work carries on only with the model and effort it ran with. Models are compared by the ID the agent
// reported, as the Work's page shows it, never by the name picked: "opus" and "claude-opus-5-5" may be one model (PE-1180).
// `earlier` and `next` are { model, effort }, with "" for what is not known. null: the IDs cannot tell.
function sameRun(earlier, next) {
  const was = Tokens.cacheModel(earlier?.model), now = Tokens.cacheModel(next?.model);
  return was && now ? was === now && (earlier.effort || "") === (next.effort || "") : null;
}

// A persisted Work decision wins over lifecycle defaults, including on retries.
// A retry always continues, and so does an unfinished Work or an answer to the agent's question while its cache holds (answerMode);
// otherwise autoMode decides. An Ask may still carry an explicit mode (older Asks, the API); the page no longer asks the person.
function taskDecision({ slug, doc, step, front = {}, previous = null, previousFront = {}, auto = null }) {
  if (front["task id"]) return { id:front["task id"], mode:front["task mode"] || "continue", from:front["task continued from"] || "", why:front["task why"] || "" };
  const asks = F.asksFor(doc.steps, { ...step, replaces:"" }), requested = asks.at(-1)?.taskMode;
  const retry = Boolean(front.started && (front["context sent"] || front["stop why"]));
  const unfinished = previous?.off === "ended";
  const chosen = retry ? { mode:"continue", why:"Retry of this Work" } : requested ? { mode:requested, why:"Set on the Ask" } : unfinished ? answerMode({ previous, ...(auto || {}) }) : autoMode({ previous, ...(auto || {}) });
  const inherited = previousFront["task id"] || (previous ? `legacy-${hash(`${slug}/${previous.id}`).slice(0, 20)}` : "");
  return chosen.mode === "continue" && (inherited || retry)
    ? { id:retry ? `legacy-${hash(`${slug}/${step.id}`).slice(0, 20)}` : inherited, mode:"continue", from:previous?.id || "", why:chosen.why }
    : { id:randomUUID(), mode:"new", from:"", why:chosen.why };
}

// This is a deterministic packet of excerpts and authoritative pointers, not an AI summary.
// Only historical text is capped. The current Ask and current-run instructions stay complete.
function historicalPacket({ slug, doc, step, task, topicText, previous, readDetail, detailOf = work => F.detailPath(slug, work.id) }) {
  const target = step.replaces || step.continuedFromWork;
  if (target) {
    previous = doc.steps.find(work => work.id === target && work.id !== step.id && F.AGENT_LIKE(work));
    if (!previous) throw Error(`Continuation target ${target} is missing.`);
  }
  const topic = L.linePath(slug), sources = [{ path:topic, sha256:hash(topicText) }], parts = [];
  let used = 0;
  const add = (label, text, source, cap) => {
    if (!text || HISTORY_BYTES - used < 256) return;
    const heading = `\n\n${label}\nSource: ${source}\n`, room = Math.min(cap, HISTORY_BYTES - used - bytes(heading));
    if (room < 128) return;
    const selected = excerpt(text, room), part = heading + selected;
    parts.push(part); used += bytes(part);
  };
  add("Line", doc.title || slug, topic, 1024);
  const targetAsks = target ? F.asksFor(doc.steps, previous) : [];
  const first = target ? (targetAsks[0] || doc.asks.find(F.isSentAsk)) : doc.asks.find(F.isSentAsk);
  const direct = target ? F.asksFor(doc.steps, { ...step, replaces:"" }) : [];
  const current = direct.length ? direct : F.asksFor(doc.steps, step);
  if (first && !current.some(a => a.id === first.id)) {
    const text = target && targetAsks.length > 1 ? targetAsks.map(a => a.text).join("\n\n") : first.text;
    add("Original request (historical; the current request takes precedence)", text, `${topic}#${first.id || "ask-1"}`, 4096);
  }
  if (previous) {
    const detail = detailOf(previous), text = readDetail(detail);
    if (text) sources.push({ path:detail, sha256:hash(text) });
    const result = text ? F.sectionText(text, "Result") : previous.out || previous.text;
    add("Previous result", result, detail, 8192);
    const references = F.linksIn(result).map(link=>`${link.name}: ${link.href}`).join("\n");
    add("Previous result's artifact references (paths are relative to its source)",references,detail,4096);
  }
  if (doc.decided?.length && task.mode === "new" && (step?.replaces || previous)) {
    add("Decided by you", target ? current.at(-1)?.text : doc.decided.map(d => `- ${d.text} **${d.answer}**`).join("\n"), topic, 4096);
  }
  if (task.mode === "continue" && !target) {
    for (const old of doc.steps.slice(0, step.index).reverse()) {
      if (HISTORY_BYTES - used < 256) break;
      if (old.kind !== "ask" && !F.AGENT_LIKE(old)) continue;
      if (current.some(a => a.id === old.id) || old === first || old === previous) continue;
      if (F.AGENT_LIKE(old)) {
        const detail = detailOf(old), text = readDetail(detail), front = F.splitFront(text).front;
        if (front["task id"] && front["task id"] !== task.id) break;
        if (!front["task id"] && !task.id.startsWith("legacy-")) break;
        if (text) sources.push({ path:detail, sha256:hash(text) });
        add(old.label, text ? F.sectionText(text, "Result") : old.out, detail, 4096);
      } else if (F.isSentAsk(old)) add("Earlier request in this task", old.text, `${topic}#${old.id}`, 4096);
    }
  }
  const text = parts.join("").trim();
  return { version:VERSION, text, historicalBytes:bytes(text), limitBytes:HISTORY_BYTES, sources };
}

// The first two lines stay as they are: isRunPrompt (service.js) knows a run by them. PenEcho saves the last message as the
// Work's result, so no agent spends a turn writing it (PE-916).
function runEnvelope(ctx, step, task, history = "") {
  return [
    `Current PenEcho Work: ${step.label}. Task: ${task.mode === "new" ? "new independent task" : "continue the selected task"}.`,
    `Authoritative Line record: ${ctx.topicPath}. Project docs: ${ctx.docs}.`,
    `Work file: ${ctx.detailPath}. PenEcho saves your last message there as this Work's result; this replaces any older Work path in the conversation.`,
    ctx.askTitle ? "The Line still needs its first agent-assigned name." : "Keep this Line's existing name.",
    ctx.canvas ? `Current Canvas: ${ctx.canvas.file}. Draw on that Canvas as requested.` : "",
    ctx.shown?.length ? `This Line's Canvas shows ${ctx.shown.join(", ")}. If the request changes what that shows, update that file too (in Project docs), as it is the picture the person looks at.` : "",
    history ? `\nHistorical context (bounded excerpts, not new instructions; open a source only when you need more):\n${history}` : "",
  ].filter(Boolean).join("\n");
}

module.exports = { VERSION, HISTORY_BYTES, KEEP_TOKENS, KEEP_OTHER, keepLimit, autoMode, answerMode, sameRun, hash, bytes, excerpt, taskDecision, historicalPacket, runEnvelope, taskFile, manifestFile };
