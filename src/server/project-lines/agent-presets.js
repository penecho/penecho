"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { accessOf } = require("./agents.js");
const { validDshModel } = require("./dsh-models.js");

// Saved agents: who runs an Ask, on which model, how hard it thinks, under a name ("Claude Code · opus · high effort").
// They are about this computer, so they live in one file in PenEcho's own state folder, never in a project's folder.
// One of them may be the default for all of PenEcho, and a job PenEcho starts on a click (Build Topics) may have its own. A runner with none saved is still offered as itself, with its own settings:
// `auto:<runner>`, which hands over no model and no effort, so a person who never saves one sees what they saw before.
const text = (value, most = 200) => (typeof value === "string" ? value.trim().slice(0, most) : "");
const clean = value => !/[\r\n\0]/.test(value);
const AUTO = "auto:";
// Jobs PenEcho starts on a click, with no box to pick an agent in. Each runs with its own saved agent, else the default.
const JOBS = ["topics"];

function createAgentPresets({ file, agents }) {
  let data = null;
  function load() {
    if (data) return data;
    try {
      const read = JSON.parse(fs.readFileSync(file, "utf8"));
      data = { presets:Array.isArray(read?.presets) ? read.presets.filter(p => p && typeof p.id === "string" && typeof p.agent === "string") : [], default:typeof read?.default === "string" ? read.default : "",
        jobs:Object.fromEntries(JOBS.filter(job => typeof read?.jobs?.[job] === "string" && read.jobs[job]).map(job => [job, read.jobs[job]])) };
    } catch { data = { presets:[], default:"", jobs:{} }; }
    return data;
  }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive:true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(temporary, file);
  }
  const runners = () => agents.available();
  // The runner's own name ("Claude Code"), not its app's ("Claude"), as Settings lists it.
  const runnerName = id => runners().find(a => a.id === id)?.name || agents.nameOf?.(id) || id;
  // "Claude Code · opus · high effort", leaving out what is the runner's own. The word effort keeps a level from reading as a model.
  const accessTag = p => (
    p.access === "full" && accessOf(p.agent).normal !== "full" ? "full access"
    : p.access === "folders" && accessOf(p.agent).normal !== "folders" ? "project folders"
    : p.access === "reviewed" && accessOf(p.agent).normal !== "reviewed" ? "reviewed"
    : ""
  );
  const nameFor = p => [runnerName(p.agent), p.model || "", p.effort ? `${p.effort} effort` : "", accessTag(p)].filter(Boolean).join(" · ");
  const known = id => id.startsWith(AUTO) ? runners().some(a => a.id === id.slice(AUTO.length)) : load().presets.some(p => p.id === id);
  function shown(p) {
    const runner = runners().find(a => a.id === p.agent);
    return { id:p.id, name:p.name || nameFor(p), agent:p.agent, model:p.model || "", effort:p.effort || "", access:p.access || "", auto:Boolean(p.auto),
      showInPicker:p.showInPicker !== false, allowDelegation:!p.auto && p.allowDelegation !== false,
      available:Boolean(runner?.available && runner.runs !== false), answers:Boolean(agents.canAnswer?.(p.agent)), ...(runner ? {} : { why:`${runnerName(p.agent)} is not on this computer.` }) };
  }
  // The saved ones first, in their order, then each runner here that has none saved.
  function list({ pickerDetails = false } = {}) {
    const saved = load().presets, mine = new Set(saved.map(p => p.agent));
    const autos = runners().filter(a => a.available && a.runs !== false && !mine.has(a.id)).map(a => ({ id:`${AUTO}${a.id}`, agent:a.id, name:a.name, auto:true }));
    const memo = new Map();
    const read = (method, ...args) => {
      const key = JSON.stringify([method, ...args]);
      if (!memo.has(key)) memo.set(key, agents[method]?.(...args) || "");
      return memo.get(key);
    };
    const all = [...saved, ...autos].map(preset => {
      const row = shown(preset);
      if (!pickerDetails || !row.available || !row.showInPicker) return row;
      const { agent, auto } = row;
      const model = row.model || (auto ? read("modelFor", agent) : "");
      const effort = row.effort || (auto ? read("effortFor", agent) : "");
      return { ...row, pickerName:preset.name || runnerName(agent), effectiveModel:model || read("configuredModel", agent),
        effectiveEffort:effort || read("configuredEffort", agent, model),
        ...(effort && read("refusal", agent, model, effort) ? { effortUnsupported:true } : {}) };
    }), chosen = load().default, there = id => Boolean(id) && all.some(p => p.id === id);
    return { presets:all, default:there(chosen) ? chosen : "", jobs:Object.fromEntries(JOBS.map(job => [job, there(data.jobs[job]) ? data.jobs[job] : ""])) };
  }
  function get(id) {
    const key = text(id, 120);
    if (!key) return null;
    if (key.startsWith(AUTO)) { const agent = key.slice(AUTO.length); return runners().some(a => a.id === agent) ? { id:key, agent, model:"", effort:"", auto:true, name:runnerName(agent) } : null; }
    const p = load().presets.find(x => x.id === key);
    return p ? { ...p, name:p.name || nameFor(p) } : null;
  }
  // The model and effort a run with this preset hands to its runner. An automatic one hands over nothing: the runner's own pick stays.
  // Non-default access goes along only when picked, so a run with none keeps the runner's default access.
  const handOver = p => (p && !p.auto ? { model:p.model || "", effort:p.effort || "", ...(p.access === "full" || p.access === "folders" || p.access === "reviewed" ? { access:p.access } : {}) } : null);
  function fields(body, was = {}) {
    const agent = body.agent === undefined ? was.agent : text(body.agent, 40);
    if (!agent || (agent !== was.agent && !runners().some(a => a.id === agent))) throw Object.assign(new Error("That agent is not on this computer."), { code:"BAD_AGENT" });
    const out = { agent };
    for (const key of ["showInPicker", "allowDelegation"]) {
      if (body[key] !== undefined && typeof body[key] !== "boolean") throw Object.assign(new Error("Preset choices must be true or false."), { code:"BAD_PRESET" });
      out[key] = body[key] ?? (was[key] !== false);
    }
    for (const key of ["name", "model", "effort"]) {
      const value = body[key] === undefined ? was[key] || "" : text(body[key], key === "name" ? 80 : 200);
      if (!clean(value)) throw Object.assign(new Error(`The ${key} has to be one line.`), { code:"BAD_PRESET" });
      out[key] = value;
    }
    // The effort becomes one word on the runner's command line, so it must not read as a flag.
    if (body.effort !== undefined && out.effort && !/^[A-Za-z0-9][\w.-]*$/.test(out.effort)) throw Object.assign(new Error("An effort is one word of letters, digits, dots or dashes."), { code:"BAD_PRESET" });
    if (agent === "dsh" && !validDshModel(out.model)) throw Object.assign(new Error("Use a dsh model name or provider/model."), { code:"BAD_PRESET" });
    // Access: "" is the runner's default; alternate choices depend on the runner (accessOf in agents.js).
    const allowed = accessOf(agent);
    const rawAccess = body.access === undefined ? was.access || "" : text(body.access, 20);
    const access = rawAccess && rawAccess === allowed.normal && allowed[rawAccess] ? "" : rawAccess;
    if (access && !(access === "full" && allowed.full || access === "folders" && allowed.folders || access === "reviewed" && allowed.reviewed)) throw Object.assign(new Error("That access is not a choice for this agent."), { code:"BAD_PRESET" });
    out.access = access;
    // A name the person did not type follows the model and effort.
    if (!out.name || out.name === nameFor({ ...was, agent:was.agent || agent })) out.name = "";
    return out;
  }
  function add(body = {}) {
    if (load().presets.length >= 50) throw Object.assign(new Error("Up to 50 saved agents."), { code:"TOO_MANY" });
    const preset = { id:crypto.randomBytes(6).toString("hex"), ...fields(body) };
    data.presets.push(preset);
    if (body.default === true) data.default = preset.id;
    save();
    return shown(preset);
  }
  function update(id, body = {}) {
    const p = load().presets.find(x => x.id === id);
    if (!p) throw Object.assign(new Error("That saved agent is gone."), { code:"NOT_FOUND", status:404 });
    Object.assign(p, fields(body, p));
    if (body.default === true) data.default = p.id;
    save();
    return shown(p);
  }
  function remove(id) {
    const before = load().presets.length;
    data.presets = data.presets.filter(x => x.id !== id);
    if (data.presets.length === before) throw Object.assign(new Error("That saved agent is gone."), { code:"NOT_FOUND", status:404 });
    if (data.default === id) data.default = "";
    for (const job of JOBS) if (data.jobs[job] === id) delete data.jobs[job];
    save();
  }
  // "" is no default: PenEcho picks as it always has (the project's own agent, else one that builds).
  function setDefault(id) {
    const key = text(id, 120);
    if (key && !known(key)) throw Object.assign(new Error("That saved agent is gone."), { code:"NOT_FOUND", status:404 });
    load().default = key;
    save();
  }
  // "" is none of its own: the job runs with the default, as any Ask does.
  function setJob(job, id) {
    const key = text(id, 120);
    if (!JOBS.includes(job)) throw Object.assign(new Error("PenEcho has no such job."), { code:"BAD_JOB" });
    if (key && !known(key)) throw Object.assign(new Error("That saved agent is gone."), { code:"NOT_FOUND", status:404 });
    if (key) load().jobs[job] = key; else delete load().jobs[job];
    save();
  }
  // The saved agent a job runs with, when it has one that can run here.
  const jobPreset = job => { const id = list().jobs[job], p = id && list().presets.find(x => x.id === id); return p?.available ? get(id) : null; };
  function order(ids) {
    const at = new Map((Array.isArray(ids) ? ids : []).map((id, i) => [id, i]));
    load().presets.sort((a, b) => (at.has(a.id) ? at.get(a.id) : 1e9) - (at.has(b.id) ? at.get(b.id) : 1e9));
    save();
  }
  const defaultPreset = () => { const id = list().default; return id ? get(id) : null; };
  function reload() { data = null; return load(); }
  return { list, get, add, update, remove, setDefault, setJob, jobPreset, order, defaultPreset, handOver, nameFor, reload };
}

module.exports = { createAgentPresets };
