"use strict";
// This computer, as PenEcho Cloud knows it (R4): who it is, which agents it has, whether it runs Asks sent from penecho.ai, and the
// round that fetches those Asks.
//
// A project that lives on this computer and syncs to Cloud never runs on penecho.ai. An Ask written there for it waits in the line's
// file, held for a computer (computer-asks.js). Nothing in Cloud reaches into this computer: this computer asks Cloud, signed in with
// its own Cloud sign-in, over the sync it already does.
//
//   every ROUND_MS, while signed in and syncing at least one project:
//     POST /api/v1/device-sync/computer { id, name, agents, presets, runsAsks, projects:{ key: rev }, holding:[{ project, hold }] }
//       → { computer, projects:[{ key, rev, changed }], dropped:[hold] }
//     a project Cloud changed is synced; the sync round then runs the Asks held for this computer (runHeld)
//     a hold Cloud dropped (Stop on penecho.ai) stops the run that had it, when penecho.ai sent its Ask; one started here carries on
//   with nothing changed, the round is that one request.
//
// The switch "Run Asks sent from penecho.ai" is off until the person turns it on, here, on this computer. Off, such Asks wait and are
// never run; Cloud knows why from the round (runsAsks), and so does an agent that is not ready here (agents[].ready).
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const F = require("./format.js");
const CA = require("./computer-asks.js");
const { failure, writeAtomic, clip } = require("./store.js");

const ROUND_MS = 10_000;
// An Ask that could not start here is not tried again for this long (an agent that fails at once would otherwise start every round).
const RETRY_AFTER_MS = 60_000;
// A Cloud that has no round route yet (older than R4) is asked again after this.
const OLD_CLOUD_MS = 10 * 60_000;
const ROUTE = "/api/v1/device-sync/computer";

// The name people know this computer by: macOS's own (System Settings, General, About), else its host name.
function machineName(platform = process.platform) {
  if (platform === "darwin") {
    try { const name = execFileSync("scutil", ["--get", "ComputerName"], { encoding:"utf8", timeout:2000, stdio:["ignore", "pipe", "ignore"] }).trim(); if (name) return name; } catch { /* The host name below. */ }
  }
  return os.hostname().replace(/\.local$/i, "") || "This computer";
}
const cleanName = value => clip(String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " "), 80).trim();

function createComputer({ directory, service, cloudShare, connector, everyMs = ROUND_MS, name = machineName, logger = null }) {
  const file = path.join(directory, "computer.json");
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { /* Made below, once. */ }
  // The id is made once and kept: Cloud knows this computer by it, whatever it is called.
  const state = { id:CA.COMPUTER_ID.test(String(saved.id || "")) ? saved.id : crypto.randomUUID(), name:cleanName(saved.name) || cleanName(name()) || "This computer", runsAsks:saved.runsAsks === true };
  const save = () => writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
  if (saved.id !== state.id || saved.name !== state.name || saved.runsAsks !== state.runsAsks) { try { save(); } catch (error) { logger?.({ type:"project-lines-computer", event:"save-failed", message:error.message }); } }

  const cloud = () => (typeof connector === "function" ? connector() : connector);
  const signedIn = () => { try { return Boolean(cloud()?.status().accountSession?.signedIn); } catch { return false; } };
  // The agents set up here, and whether each can run an Ask in the background now (one whose app alone is here cannot).
  const agents = () => (service.agents.available() || []).filter(a => a.available).slice(0, 40).map(a => ({ id:a.id, name:cleanName(a.name) || a.id, ready:Boolean(a.runs) }));
  const readyHere = agent => agents().some(a => a.id === agent && a.ready);
  // Its saved agents, as Agents lists them, for penecho.ai to show read-only: names, runners, models and efforts, never a key.
  const presets = () => {
    let list = null;
    try { list = service.presets?.list(); } catch { return []; }
    return (list?.presets || []).filter(p => p.showInPicker !== false).slice(0, 40).map(p => ({ id:clip(String(p.id), 120), name:cleanName(p.name).slice(0, 120) || p.agent, agent:p.agent, model:clip(String(p.model || ""), 120), effort:clip(String(p.effort || ""), 40), default:p.id === list.default }))
      .filter(p => /^[a-z0-9][a-z0-9._-]{0,39}$/i.test(String(p.agent || "")));
  };
  const failedAt = new Map(), looking = new Set();
  let last = null, busy = null, laterUntil = 0, lookAll = false, timer = null;

  // The Asks held for this computer on one project it syncs: each whose agent is ready here runs as a Send here runs it, after this
  // computer has taken the line in Cloud (two computers: the one that takes it runs it, once). Switch off: nothing is started.
  async function runHeld(project, { files = null } = {}) {
    if (!state.runsAsks || !project?.cloud?.sync || looking.has(project.id) || !signedIn()) return 0;
    looking.add(project.id);
    let started = 0;
    try {
      let topics = [];
      try { topics = service.store.scan(project, files || service.folderList?.(project) || null).topics; } catch { return 0; }
      for (const t of topics) {
        const key = service.key(project, t.slug);
        if (service.runs.has(key)) continue;
        const ask = CA.heldAsks(t.doc).filter(a => !a.computer || a.computer === state.id).pop();
        if (!ask || !readyHere(ask.agent)) continue;
        const tried = `${key}/${ask.step}`;
        if (Date.now() - (failedAt.get(tried) || 0) < RETRY_AFTER_MS) continue;
        // Only with the line taken in Cloud: busy (another computer has it) or Cloud away, it waits for a later round.
        const lease = await cloudShare.takeLine(project, t.slug).catch(() => null);
        if (!lease?.id) continue;
        const giveBack = () => cloudShare.giveLine({ ...project, cloud:{ ...project.cloud, sync:false } }, lease).catch(() => {});
        // Another computer may have run it since this one last looked: Cloud's newest copy decides.
        const checked = await cloudShare.syncNow(project).catch(() => null);
        if (!checked || checked.stale || checked.removed === true) { await giveBack(); continue; }
        let still = null;
        try { still = CA.heldAsks(F.parseLine(service.readDoc(project, t.slug))).find(a => a.step === ask.step && a.agent === ask.agent && (!a.computer || a.computer === state.id)); } catch { still = null; }
        if (!still || service.runs.has(key)) { await giveBack(); continue; }
        // Marked as penecho.ai's, so Stop there (a hold Cloud drops) stops this run, and only runs like it (PE-583).
        lease.fromCloud = true;
        service.pendingLease.set(key, lease);
        // The saved agent chosen on penecho.ai runs with its own model and effort; one removed since runs the agent as it is set up.
        let preset = "";
        try { preset = ask.preset && service.presets?.get(ask.preset)?.agent === ask.agent ? ask.preset : ""; } catch { preset = ""; }
        try { await service.runUnsent(project, t.slug, { step:ask.step, agent:ask.agent, preset }); started++; }
        catch (error) { failedAt.set(tried, Date.now()); logger?.({ type:"project-lines-computer", event:"start-failed", project:project.id, message:error.message }); }
        // A hold the run did not take up (it could not start) is given back.
        if (service.pendingLease.get(key) === lease) { service.pendingLease.delete(key); await giveBack(); }
        // The Ask, sent now, goes to Cloud at once, so no other computer starts it.
        await cloudShare.syncNow(project).catch(() => {});
      }
    } finally { looking.delete(project.id); }
    return started;
  }

  // The runs here that hold their line in Cloud: [{ project, slug, run, key }] (key: the project's key in Cloud).
  function holding(synced) {
    const out = [];
    for (const [runKey, run] of service.runs) {
      if (!run?.lease?.id) continue;
      const entry = synced.find(s => runKey.startsWith(`${s.project.id}/`));
      if (entry) out.push({ project:entry.project, slug:runKey.slice(entry.project.id.length + 1), run, key:entry.key });
    }
    return out;
  }

  async function round() {
    if (busy) return busy;
    busy = (async () => {
      // The desktop app has not looked into the projects' folders yet (http.js openFolders): nothing here can be run or synced until then.
      if (!signedIn() || Date.now() < laterUntil || service.foldersHeld) return null;
      const synced = cloudShare.synced();
      if (!synced.length) return null;
      const held = holding(synced), at = Date.now();
      const body = { id:state.id, name:state.name, agents:agents(), presets:presets(), runsAsks:state.runsAsks, projects:Object.fromEntries(synced.map(s => [s.key, s.rev])), holding:held.map(h => ({ project:h.key, hold:h.run.lease.id })) };
      let answer;
      try { answer = await cloud().cloudRequest(ROUTE, { method:"POST", body, timeoutMs:15_000 }); }
      catch (error) {
        if (error.status === 404) laterUntil = Date.now() + OLD_CLOUD_MS;
        last = { at, ok:false, error:error.message };
        return null;
      }
      last = { at, ok:true };
      // Stopped on penecho.ai (or lost): a run of an Ask sent from there stops now, as Stop here would stop it. A run started on this
      // computer never stops for Cloud (PE-583): it only lets the hold go, and carries on.
      for (const id of Array.isArray(answer?.dropped) ? answer.dropped : []) {
        const h = held.find(x => x.run.lease?.id === id);
        if (!h) continue;
        if (!h.run.lease.fromCloud) { clearInterval(h.run.leaseTimer); h.run.leaseTimer = null; h.run.lease = null; continue; }
        await service.stopWork(h.project, h.slug).catch(error => logger?.({ type:"project-lines-computer", event:"stop-failed", project:h.project.id, message:error.message }));
        // The stopped Work goes to Cloud at once.
        await cloudShare.syncNow(h.project).catch(() => {});
      }
      // Changed in Cloud: synced now (a held Ask among the changes is run by the sync round, through runHeld).
      for (const entry of Array.isArray(answer?.projects) ? answer.projects : []) {
        if (!entry?.changed) continue;
        const s = synced.find(x => x.key === entry.key);
        if (s) await cloudShare.syncNow(s.project).catch(() => {});
      }
      // The switch was just turned on: every Ask already waiting here is looked at now, not at the next change.
      if (lookAll && state.runsAsks) { lookAll = false; for (const s of synced) await runHeld(s.project).catch(() => {}); }
      return answer;
    })().finally(() => { busy = null; });
    return busy;
  }
  if (everyMs > 0) { timer = setInterval(() => { round().catch(() => {}); }, everyMs); timer.unref?.(); }

  const view = () => ({ id:state.id, name:state.name, runsAsks:state.runsAsks, agents:agents(), signedIn:signedIn(), round:last });
  // The switch and the name. Only on this computer: what runs here is decided here.
  function set(body = {}) {
    if (body.runsAsks !== undefined && typeof body.runsAsks !== "boolean") throw failure("BAD_REQUEST", "runsAsks is true or false.");
    if (body.name !== undefined && !cleanName(body.name)) throw failure("BAD_NAME", "Give this computer a name.");
    const turnedOn = body.runsAsks === true && !state.runsAsks;
    if (body.runsAsks !== undefined) state.runsAsks = body.runsAsks;
    if (body.name !== undefined) state.name = cleanName(body.name);
    save();
    if (turnedOn) { lookAll = true; laterUntil = 0; }
    // Cloud hears of it at once, so a page on penecho.ai says the right thing.
    round().catch(() => {});
    return view();
  }

  return { id:() => state.id, name:() => state.name, runsAsks:() => state.runsAsks, agents, view, set, round, runHeld, close:() => clearInterval(timer) };
}

module.exports = { createComputer, machineName, ROUND_MS };
