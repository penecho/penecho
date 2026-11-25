"use strict";
const F = require("./format.js");

// Topics used to be two files: x.md with the words and a results section, and x.tasks.md with a list of steps.
// This turns one such pair into the single file used now, with a detail file for each piece of work.
// What was said and done between messages comes from the activity PenEcho kept, so each Work gets its own result instead of sharing the last one.
const STEP_LINE = /^\s*[-*]\s+\[( |x|X)\]\s+\*\*(.+?)\*\*(?:\s*\(([^)]*)\))?\s*(?::\s*(.*))?$/;
const ENTRY_START = /^\*\*(\d{4}-\d{2}-\d{2}[^*]*?)\.\*\*\s*(.*)$/;
// Claude Code's own summaries, and messages with a picture that an earlier PenEcho could not read.
const NOT_A_PERSON = /^(?:This session is being continued from a previous conversation|(?:\[object Object\],?)+$)/;
const KNOWN_TOPIC = new Set(["What I asked for", "Pictures", "Result", "Feedback"]);
const KNOWN_TASKS = new Set(["Now", "Steps", F.QUESTIONS, F.DECIDED, F.HANDOFFS, "Feedback from the Topic", "Links"]);
const DRAWN = /^Drew "(.+)" on the Canvas$/;

function oldSteps(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const m = line.match(STEP_LINE); if (!m) continue;
    const step = { label:m[2].trim(), kind:F.kindOf(m[2].trim()), done:m[1] !== " ", who:"", took:"", wait:false, out:(m[4] || "").trim() };
    for (const token of String(m[3] || "").split(",").map(x => x.trim()).filter(Boolean)) {
      if (token.startsWith("@")) step.who = F.normalizeWho(token);
      else if (token.toLowerCase() === "wait") step.wait = true;
      else step.took = token;
    }
    out.push(step);
  }
  return out;
}
// An entry runs until the next dated line, so every paragraph someone wrote stays in one message.
function oldEntries(text) {
  const out = []; let cur = null;
  for (const line of String(text || "").split("\n")) {
    const m = line.match(ENTRY_START);
    if (m) {
      const decision = /Decision$/.test(m[1]), [when, ...via] = m[1].replace(/\.?\s*Decision$/, "").split(" · ");
      cur = { when:when.trim(), via:via.join(" · ").trim(), decision, lines:[m[2]] };
      out.push(cur);
    } else if (cur) cur.lines.push(line);
    else if (line.trim() && !/^Write here, or anywhere in this file/.test(line.trim())) { cur = { when:"", via:"", decision:false, lines:[line] }; out.push(cur); }
  }
  return out.map(e => ({ ...e, body:e.lines.join("\n").trim() })).filter(e => e.body);
}
const norm = text => String(text).replace(/\s+/g, " ").trim();
const sameStart = (a, b) => { const x = norm(a), y = norm(b); return Boolean(x && y) && (x.startsWith(y) || y.startsWith(x)); };
const pad = n => String(n).padStart(2, "0");
const label = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const tookOf = rows => { const at = rows.map(r => r.at).filter(Boolean); if (at.length < 2) return ""; return `${Math.max(1, Math.round((Math.max(...at) - Math.min(...at)) / 60000))} min`; };
const lastSay = rows => [...rows].reverse().find(r => r.kind === "say")?.text || "";
// Links in text moved down one folder.
const oneDeeper = text => String(text).replace(/(!?\[[^\]]*\]\()(?![a-z]+:|\/|#)/gi, "$1../");

function upgradeTopic({ slug, topicMd, tasksMd, rows = [] }) {
  const topic = F.splitFront(topicMd), tasks = F.splitFront(tasksMd), old = oldSteps(F.sectionText(tasks.body, "Steps"));
  const title = (topic.body.match(/^# (.+)$/m) || [])[1]?.trim() || topic.front.topic || slug;
  const firstWords = F.sectionText(topic.body, "What I asked for") ?? "", entries = oldEntries(F.sectionText(topic.body, "Feedback"));
  const asks = [{ body:firstWords, text:F.withoutLinkLines(firstWords), when:tasks.front.created || old[0]?.took || "", via:tasks.front.source || "" }];
  const decisions = [];
  for (const e of entries) {
    if (e.decision) { decisions.push(e.body); continue; }
    if (NOT_A_PERSON.test(e.body)) continue;
    asks.push({ body:e.body, text:F.withoutLinkLines(e.body), when:e.when, via:e.via });
  }
  // What happened after each message.
  const after = asks.map(() => []), sorted = [...rows].sort((a, b) => a.i - b.i);
  let at = 0;
  for (const row of sorted) {
    if (row.kind === "me") {
      const next = asks.findIndex((ask, i) => i > at && sameStart(ask.text, row.text));
      if (next > 0) at = next;
      continue;
    }
    after[at].push(row);
  }
  const fromRows = sorted.some(r => r.kind !== "me");
  const defaultWho = (tasks.front.who || "").replace(/^@/, "") || [...old].reverse().find(s => s.who && s.who !== "you")?.who || "";
  const agentOld = old.filter(s => s.kind !== "ask" && s.kind !== "merge");
  const steps = [], details = new Map(), tags = new Map();
  const addWork = ({ kind = "work", who = defaultWho, took = "", result = "", rows:own = [], out = "" }) => {
    const step = F.workStep({ kind, who, took, done:true });
    steps.push(step);
    F.numberSteps(steps);
    const summary = F.summaryOf(result || out);
    const pictures = own.filter(r => r.kind === "note" && DRAWN.test(r.text) && r.picture).map(r => `![${r.text.match(DRAWN)[1]}](../${r.picture})`);
    F.closeStep(step, { slug, took, summary });
    if (pictures.length) step.body = [summary, ...pictures, `[Details](${slug}/${step.id}.md)`].filter(Boolean).join("\n\n");
    details.set(step.id, { step, result:result || out, rows:own, started:own[0]?.at ? label(own[0].at) : "" });
    for (const r of own) tags.set(r.i, step.id);
    return step;
  };
  const addAsk = ask => steps.push(F.askStep({ words:"", when:ask.when, via:ask.via }) && { kind:"ask", num:0, done:true, who:"you", took:"", when:ask.when, via:ask.via, wait:false, body:ask.body.trim() });
  if (fromRows) {
    asks.forEach((ask, i) => {
      addAsk(ask);
      // A run with another label is another step, such as Build then Self-review.
      const groups = []; let cur = null;
      for (const row of after[i]) {
        if (row.kind === "start" && row.label && cur?.label !== row.label) { cur = { label:row.label, agent:row.agent, rows:[row] }; groups.push(cur); continue; }
        if (!cur) { cur = { label:"Work", agent:row.agent, rows:[] }; groups.push(cur); }
        if (row.kind === "start" && row.agent) cur.agent = row.agent;
        cur.rows.push(row);
      }
      for (const g of groups) {
        if (!g.rows.some(r => r.kind !== "start")) { for (const r of g.rows) tags.set(r.i, ""); continue; }
        const kind = F.kindOf(g.label);
        addWork({ kind:kind === "ask" || kind === "merge" ? "work" : kind, who:g.agent || defaultWho, took:tookOf(g.rows), result:lastSay(g.rows), rows:g.rows });
      }
    });
  } else {
    const n = Math.max(asks.length, agentOld.length);
    for (let i = 0; i < n; i++) {
      if (asks[i]) addAsk(asks[i]);
      const s = agentOld[i];
      if (s?.done) addWork({ kind:s.kind, who:s.who || defaultWho, took:s.took, out:s.out });
    }
  }
  // The result the Topic kept was the last agent's last words.
  const kept = F.resultOf(F.sectionText(topic.body, "Result"));
  const lastWork = [...steps].reverse().find(F.AGENT_LIKE);
  if (kept.text && lastWork) { const d = details.get(lastWork.id); if (d && (!d.result || !fromRows)) { d.result = kept.text; F.closeStep(lastWork, { slug, took:lastWork.took, summary:F.summaryOf(kept.text) }); } }
  // What was still going on stays open. The first open step may be the one the last rows belong to.
  const open = old.filter(s => !s.done && s.kind !== "merge" && s.kind !== "ask"), status = String(tasks.front.status || "").toLowerCase();
  if (open.length && !F.FINISHED.has(status)) {
    const lastIsWork = steps[steps.length - 1]?.kind !== "ask";
    const first = open[0];
    if (lastIsWork && lastWork && (lastWork.kind === first.kind) && (first.wait || status === "working" || status === "stopped" || status === "paused") && details.get(lastWork.id)?.rows.length) {
      lastWork.done = false; lastWork.wait = first.wait; if (!first.wait) lastWork.took = "";
      open.shift();
    }
    for (const s of open) steps.push(F.workStep({ kind:s.kind, who:s.who || defaultWho, wait:s.wait, took:s.took, body:s.out }));
  }
  for (const s of old.filter(x => x.kind === "merge")) steps.push(F.workStep({ kind:"merge", who:s.who || "you", done:s.done, took:s.took, body:s.out }));
  F.numberSteps(steps);
  // Pictures not tied to a run go with the last work.
  const usedPictures = new Set(steps.flatMap(s => F.linksIn(s.body).map(l => l.href)));
  const picturesMd = (F.sectionText(topic.body, "Pictures") || "").split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).filter(block => !F.linksIn(block).some(l => usedPictures.has(l.href)));
  const home = lastWork && steps.includes(lastWork) ? lastWork : steps[steps.length - 1];
  if (picturesMd.length && home) {
    const at = home.body.search(/\n*\[details\]\(/i), block = picturesMd.join("\n\n");
    home.body = at < 0 ? [home.body, block].filter(Boolean).join("\n\n") : `${home.body.slice(0, at).trimEnd()}\n\n${block}\n\n${home.body.slice(at).trim()}`;
  }
  // Sections of the old files that are not PenEcho's own stay.
  const othersIn = (body, known) => [...`\n${body}`.matchAll(/\n## ([^\n]+)\n([\s\S]*?)(?=\n## |$)/g)].filter(m => !known.has(m[1].trim())).map(m => `## ${m[1].trim()}\n\n${m[2].trim()}`);
  const aboveTopic = othersIn(topic.body, KNOWN_TOPIC), detailExtras = othersIn(tasks.body, KNOWN_TASKS);
  const linksLeft = (F.sectionText(tasks.body, "Links") || "").split("\n").filter(line => line.trim() && !/^\s*[-*]\s+Topic:/.test(line));
  if (linksLeft.length) detailExtras.push(`## Links\n\n${linksLeft.join("\n")}`);
  const front = { ...tasks.front }; delete front.topic; delete front.tasks;
  const questions = F.sectionText(tasks.body, F.QUESTIONS), decided = F.sectionText(tasks.body, F.DECIDED), handoffs = F.sectionText(tasks.body, F.HANDOFFS);
  const parsedQuestions = F.parseQuestions(questions);
  if (String(front.status || "").toLowerCase() === "paused") {
    const normalized = F.normalizeLegacyStatus({ status:"paused", why:front.why || "", front, steps, questions:parsedQuestions });
    front.status = normalized.status;
    if (normalized.why) front.why = normalized.why; else delete front.why;
  }
  if (topic.front.code) front.code = topic.front.code;
  let md = `---\n${Object.entries(front).map(([k, v]) => F.formatFrontLine(k, v)).join("\n")}\n---\n\n# ${title}\n\n`;
  const above = [questions ? `## ${F.QUESTIONS}\n\n${questions}` : "", decided ? `## ${F.DECIDED}\n\n${decided}` : "", handoffs ? `## ${F.HANDOFFS}\n\n${handoffs}` : "", ...aboveTopic].filter(Boolean);
  if (above.length) md += `${above.join("\n\n")}\n\n`;
  md += F.renderSteps(steps);
  // One file for each piece of work.
  const files = [];
  for (const [id, d] of details) {
    const step = d.step;
    let text = F.initialDetail({ slug, title, label:step.label, who:step.who || "agent", started:d.started || step.took, asks:F.asksFor(steps, step), now:"" });
    text = F.setSection(text, "Now", null);
    if (d.result) text = F.setResult(text, oneDeeper(d.result));
    const pics = F.linksIn(step.body).filter(l => l.image);
    if (pics.length) text = F.setSection(text, "Pictures", pics.map(l => `![${l.name}](../${l.href})`).join("\n\n"));
    const how = F.howBlock(d.rows);
    if (how) text = F.setSection(text, "How it was done", how);
    if (step === lastWork && detailExtras.length) text = `${text.trimEnd()}\n\n${detailExtras.join("\n\n")}\n`;
    files.push({ id, md:text });
  }
  return { md, files, tags, kept:{ asks:asks.length, works:details.size } };
}

module.exports = { upgradeTopic, oldSteps, oldEntries };
