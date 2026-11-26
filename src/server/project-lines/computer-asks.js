"use strict";
// An Ask written on penecho.ai for a project that lives on a computer (R4). Such a project's Asks never run on penecho.ai: the
// project's code is only on the computer. Each one waits in the line's own file, held for a computer, until that computer fetches it
// with its next sync round and runs it there with the agent named:
//
//   ## Ask · 2026-11-13 10:20 · Not sent
//
//   Add a rain chart.
//
//   > Held · computer · agent claude · computer 0b6f3c1e-…
//
// `computer` is left out when the account had no computer to name: the first of its computers that takes the line runs it.
// An answer given on penecho.ai to an agent's question waits the same way, held for the agent that asked, with ` · reply work-2`: the Work
// it carries on (Cloud writes it; service.js sendUnsent).
// The hold is words of the line, so it goes wherever the project goes, every page shows it (`held` on the Ask's station) and it
// survives sync's merges like any other words. PenEcho Cloud uses this file too (tools/sync-canvas-agent-runtime.mjs): it writes
// holds there, and the computer reads them here.
const F = require("./format.js");

const COMPUTER = "computer";
// The line's own words while it waits (owner, 2026-11-13: "Waiting for your computer").
const WAITING = "Waiting for your computer";
const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,39}$/i;
const COMPUTER_ID = /^[A-Za-z0-9_-]{8,64}$/;
// A saved agent of that computer (its model and effort), by the id its Agents page gave it.
const PRESET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const isComputerHold = held => held?.reason === COMPUTER;
const withHold = (body, held) => [F.withoutHeld(body), F.heldLine(held)].filter(Boolean).join("\n\n");

// The hold an Ask is given. `agents`: the ids the chosen computer has set up (null: no computer to check against); `where`: its name.
function holdOf({ agent, computer = "", agents = null, where = "", preset = "" }) {
  const id = String(agent || "");
  if (!AGENT_ID.test(id)) throw fail("BAD_AGENT", "Choose an agent for this Ask.");
  if (computer && !COMPUTER_ID.test(String(computer))) throw fail("BAD_COMPUTER", "That is not one of your computers.");
  if (agents && !agents.includes(id)) throw fail("BAD_AGENT", `That agent is not set up on ${where || "that computer"}.`);
  if (preset && !PRESET_ID.test(String(preset))) throw fail("BAD_AGENT", "That saved agent is not one of this computer's.");
  return { reason:COMPUTER, agent:id, ...(computer ? { computer:String(computer) } : {}), ...(preset ? { preset:String(preset) } : {}) };
}

// The agent an Ask goes to when the page names none: the one this line works with, else PenEcho, which every computer signed in to
// PenEcho Cloud has.
const lineAgent = doc => String(doc.front.who || "").replace(/^@/, "") || "penecho";

// The line's text with the Ask Not sent at `step` (or its newest one) held for a computer. Answers { md, step, held }.
function holdUnsentText(md, { step = "", agent = "", computer = "", agents = null, where = "", preset = "" } = {}) {
  const doc = F.parseLine(md);
  const ask = step ? doc.steps.find(s => s.id === step && F.isUnsent(s)) : [...doc.steps].reverse().find(F.isUnsent);
  if (!ask) throw fail("NOT_FOUND", "This has already gone to an agent.", 404);
  const held = holdOf({ agent:agent || lineAgent(doc), computer, agents, where, preset });
  const next = F.updateSteps(md, steps => { const s = steps.find(x => x.id === ask.id); if (s) s.body = withHold(s.body, held); });
  return { md:F.setFront(next, { status:"waiting", why:WAITING }), step:ask.id, held };
}

// Retry from penecho.ai: the Work that stopped gives its Asks back as Not sent, held for a computer, as a run that could not go does
// (service.js holdAsks). A Work that started stays where it ended, greyed out; one that never started goes. The computer then runs the
// Asks as one new Work, carrying on the line's conversation with that agent when it has one.
function holdRetryText(md, { agent = "", computer = "", agents = null, where = "", preset = "", started = () => true } = {}) {
  const doc = F.parseLine(md);
  const open = doc.steps.find(s => !s.done && F.AGENT_LIKE(s));
  const work = open || [...doc.steps].reverse().find(s => F.AGENT_LIKE(s) && s.done && s.off === "stopped");
  const asks = work ? F.asksFor(doc.steps, work) : [];
  if (!work || !asks.length) throw fail("NOTHING_TO_RETRY", "There is nothing to try again on this line.", 409);
  const held = holdOf({ agent:agent || work.who || lineAgent(doc), computer, agents, where, preset });
  const ids = new Set(asks.map(a => a.id)), began = open ? started(open) : true;
  const next = F.updateSteps(md, steps => {
    for (const s of steps) if (ids.has(s.id)) { s.via = F.NOT_SENT; s.body = withHold(s.body, held); }
    const s = open && steps.find(x => x.id === open.id);
    if (s && began) { s.done = true; s.off = "stopped"; } else if (s) steps.splice(steps.indexOf(s), 1);
  });
  // Asks Not sent move to the end of the line, and an Ask's id follows its place, so the step is read again from the new text.
  const out = F.setFront(next, { status:"waiting", why:WAITING });
  return { md:out, step:heldAsks(F.parseLine(out)).pop()?.step || "", held };
}

// Stop from penecho.ai on an Ask still waiting: it stays, Not sent, and no computer will start it. Answers { md, count }.
function unholdText(md) {
  const doc = F.parseLine(md), held = doc.steps.filter(s => F.isUnsent(s) && isComputerHold(s.held));
  if (!held.length) return { md, count:0 };
  let next = F.updateSteps(md, steps => { for (const s of steps) if (F.isUnsent(s) && isComputerHold(s.held)) s.body = F.withoutHeld(s.body); });
  if (doc.front.why === WAITING) next = F.setFront(next, { status:"waiting", why:F.NOT_SENT });
  return { md:next, count:held.length };
}

// The Asks of a line held for a computer, oldest first: [{ step, agent, computer, preset }] (computer and preset "" when none was named).
const heldAsks = doc => doc.steps.filter(s => F.isUnsent(s) && isComputerHold(s.held)).map(s => ({ step:s.id, agent:String(s.held.agent || ""), computer:String(s.held.computer || ""), preset:String(s.held.preset || "") }));
// The same for a line as the state shows it (its stations): the newest, or null.
function heldOfLine(line) {
  const s = [...(line?.stations || [])].reverse().find(x => x.unsent && isComputerHold(x.held));
  return s ? { reason:COMPUTER, agent:String(s.held.agent || ""), ...(s.held.computer ? { computer:String(s.held.computer) } : {}), ...(s.held.preset ? { preset:String(s.held.preset) } : {}) } : null;
}

// The same three on a project's line, through its Lines service (here, or penecho.ai's own).
function onLine(service, project, slug, change) {
  if (!service.isLine(project, slug)) throw fail("NOT_FOUND", "This line is not in the project any more.", 404);
  const done = change(service.readDoc(project, slug));
  if (done.md !== undefined && (done.count === undefined || done.count > 0)) { service.writeDoc(project, slug, done.md); service.sync?.(project); }
  const { md:_md, ...answer } = done;
  return answer;
}
const holdUnsent = (service, project, slug, options) => onLine(service, project, slug, md => holdUnsentText(md, options));
const holdRetry = (service, project, slug, options) => onLine(service, project, slug, md => holdRetryText(md, { ...options, started:work => service.store.exists(project, F.detailPath(slug, work.id)) }));
const unhold = (service, project, slug) => onLine(service, project, slug, md => unholdText(md));

module.exports = { COMPUTER, WAITING, AGENT_ID, COMPUTER_ID, PRESET_ID, isComputerHold, holdUnsentText, holdRetryText, unholdText, heldAsks, heldOfLine, holdUnsent, holdRetry, unhold };
