"use strict";
// What the Cloud view draws as a project's home, uploaded with each sync: its lines, where each stands, and its steps (E2E L3).
// Since R4 each line also says when it last changed, who works on it, since when a run here is going, what its last finished Work
// made, and the Ask it holds for a computer, so penecho.ai's Home can show a synced project's work (Working now, Recent work).
// Cloud keeps these fields as they are (penecho_cloud src/services/line-projects.mjs cleanSummary); keep the two in step.
const F = require("./format.js");
const { heldOfLine } = require("./computer-asks.js");

const isWork = s => F.AGENT_LIKE({ kind:s.kind });
const CANVAS = /\.penecho\.json$/i;
// The last Work that finished on the line, and what it made: the Canvases and other files it links, and its first picture.
function lastWorkOf(line) {
  const s = [...(line.stations || [])].reverse().find(x => isWork(x) && x.state === "done" && !x.off);
  if (!s) return null;
  const files = (s.files || []).filter(f => !f.image), canvases = new Set(files.filter(f => CANVAS.test(f.path)).map(f => f.path));
  const picture = (s.pictures || [])[0]?.path || (s.files || []).find(f => f.image)?.path || null;
  return { agent:s.agent || "", startedAt:s.startedAt || null, endedAt:s.endedAt || null, canvases:canvases.size, files:files.filter(f => !CANVAS.test(f.path)).length, picture };
}
function lineSummary(l) {
  const held = heldOfLine(l), last = lastWorkOf(l), updatedAt = Math.round(Number(l.updatedAt) || Number(l.statusAt) || 0), agent = (l.running && l.runAgent) || l.agent || "";
  return { title:l.title, code:l.code, status:l.status, landed:Boolean(l.landed), path:l.topicPath, questions:l.questions?.length || 0,
    ...(updatedAt ? { updatedAt } : {}), ...(agent ? { agent } : {}), ...(l.running && l.runStarted ? { runStarted:l.runStarted } : {}),
    ...(last ? { lastWork:last } : {}), ...(held ? { held } : {}),
    steps:(l.stations || []).map(s => ({ kind:s.kind, state:s.state, label:s.label || "" })) };
}
function summaryOf(service, project, { state = null, files = null, keep = null } = {}) {
  const current = state || (files && typeof service.makeState === "function" ? service.makeState(project, files).state : service.stateOf(project));
  const lines = [...current.lines, ...current.backlog, ...current.landed].filter(l => !keep || keep.has(l.topicPath));
  const notes = (current.notes || []).filter(n => !keep || keep.has(n.path));
  return { lines:lines.map(lineSummary), notes:notes.length };
}

module.exports = { summaryOf, lineSummary, lastWorkOf };
