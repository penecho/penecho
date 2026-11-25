#!/usr/bin/env node
// R4 from end to end, with no stand-in on either side: the real PenEcho Cloud (a checkout of penecho-cloud, run in memory mode on a
// free port) and this checkout's real Lines code as the computer, signed in with a real local-access session, its agent a small
// script. An Ask written on penecho.ai for a project that lives on the computer is held there, never run on penecho.ai; the
// computer's round fetches it and runs it; its Work and summary are back on penecho.ai; Stop on penecho.ai stops a run on the
// computer; the switch off leaves an Ask waiting with Cloud saying why.
//   node scripts/verify-computer-asks.mjs --cloud=/path/to/penecho-cloud   (its node_modules installed)
// --examples prints one real answer of each route (the contract in docs/design/one-penecho/reports/R4-work-for-the-computer.md).
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cloudRoot = path.resolve(process.argv.find(arg => arg.startsWith("--cloud="))?.slice(8) || path.join(here, "../penecho_cloud"));
const { buildApp } = await import(path.join(cloudRoot, "src/app.mjs"));
const { createProjectLines } = require(path.join(here, "src/server/project-lines/http.js"));
const { createAgents } = require(path.join(here, "src/server/project-lines/agents.js"));
const F = require(path.join(here, "src/server/project-lines/format.js"));

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-computer-asks-")));
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
const examples = process.argv.includes("--examples");
const example = (name, value) => { if (examples) console.log(`\n--- ${name}\n${JSON.stringify(value, null, 2)}`); return value; };
const check = (name, ok, detail = "") => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 600)}` : ""}`); } };
async function until(fn, label, ms = 20000) { const start = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(60); } }

// PenEcho Cloud, as production runs it but in memory, with Lines on. Its hosted model is never to be called: counted.
let modelCalls = 0;
const app = await buildApp({ logger:false, env:{ NODE_ENV:"test", AUTH_MODE:"development", DATA_MODE:"memory", SESSION_MODE:"memory", STORAGE_MODE:"memory", LINES_HOSTED_ENABLED:"true",
  LINES_WORKSPACE_ROOT:path.join(temp, "cloud-lines"), SIGNUP_PROMO_CREDITS:"500", SIGNUP_PROMO_CUTOFF:"2099-01-01T00:00:00.000Z" }, services:{ hostedChat:{ async complete() { modelCalls++; throw new Error("not here"); } } } });
await app.listen({ port:0, host:"127.0.0.1" });
const origin = `http://127.0.0.1:${app.server.address().port}`;
const email = "owner@computer-asks.test", password = "Computer asks password 7";
const registration = await app.inject({ method:"POST", url:"/api/v1/auth/register", payload:{ name:"Owner", email, password, termsAccepted:true, privacyAccepted:true } });
await app.inject({ method:"POST", url:"/api/v1/auth/verify-email", payload:{ email, code:registration.json().developmentCode } });
const login = await app.inject({ method:"POST", url:"/api/v1/auth/login", payload:{ email, password } });
const cookie = [].concat(login.headers["set-cookie"]).map(value => value.split(";", 1)[0]).join("; "), csrf = login.json().csrfToken;
const code = (await app.inject({ method:"POST", url:"/api/v1/local-access/authorizations", headers:{ cookie, "x-penecho-csrf":csrf }, payload:{} })).json().authorization.code;
const token = (await app.inject({ method:"POST", url:"/api/v1/local-access/session", payload:{ code } })).json().accessToken;
const page = (method, url, payload) => app.inject({ method, url, headers:{ cookie, ...(method === "GET" ? {} : { "x-penecho-csrf":csrf }) }, ...(payload === undefined ? {} : { payload }) });

// The computer: this checkout's Lines code, signed in to that Cloud over HTTP with the local-access session, as the app is.
const connector = {
  status:() => ({ origin, accountSession:{ signedIn:true }, account:{ name:"Owner", workspace:{ storageUsedBytes:0, storageLimitBytes:200 * 1048576 } } }),
  accountFetch:(pathname, { method = "GET", body, headers = {}, timeoutMs = 30000 } = {}) => fetch(`${origin}${pathname}`, { method, headers:{ ...Object.fromEntries(Object.entries(headers).filter(([, v]) => v)), authorization:`Bearer ${token}` }, body, signal:AbortSignal.timeout(timeoutMs) }),
  async cloudRequest(pathname, { method = "GET", body, bytes, timeoutMs = 30000 } = {}) {
    const response = await fetch(`${origin}${pathname}`, { method, headers:{ authorization:`Bearer ${token}`, ...(bytes ? { "content-type":"application/octet-stream" } : body !== undefined ? { "content-type":"application/json" } : {}) }, body:bytes || (body !== undefined ? JSON.stringify(body) : undefined), signal:AbortSignal.timeout(timeoutMs) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.message || `HTTP ${response.status}`), { status:response.status, code:payload.error, ...(payload.details ? { details:payload.details } : {}) });
    return payload;
  },
};
const agentScript = path.join(temp, "agent.js");
fs.writeFileSync(agentScript, `let p="";process.stdin.on("data",d=>p+=d).on("end",()=>{console.log(JSON.stringify({type:"system",subtype:"init",session_id:"s1"}));setTimeout(()=>console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"Made the chart.",session_id:"s1"})),/slow/.test(p)?30000:20);});`);
const fake = { name:"Fake agent", mono:"Fa", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }) };
const directory = path.join(temp, "state"), docsBase = path.join(temp, "docs");
fs.mkdirSync(directory, { recursive:true });
fs.writeFileSync(path.join(directory, "computer.json"), JSON.stringify({ name:"Test computer" }));
const lines = createProjectLines({ cloud:() => connector, directory, agents:createAgents({ env:{ PATH:"" }, extra:{ fake } }), serviceOptions:{ autoWatch:false, docsBase }, computerRounds:0,
  authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
  readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const local = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
await new Promise(r => local.listen(0, "127.0.0.1", r));
const call = async (method, route, body) => { const res = await fetch(`http://127.0.0.1:${local.address().port}/api/lines${route}`, { method, headers:body ? { "content-type":"application/json" } : {}, body:body ? JSON.stringify(body) : undefined }); return { status:res.status, ...(await res.json().catch(() => ({}))) }; };
const me = lines.computer, service = lines.service;

try {
  // A project on the computer, kept in Cloud.
  const project = service.store.create({ name:"Garden", docsPath:path.join(docsBase, "Garden") });
  project.defaultAgent = "fake";
  fs.writeFileSync(path.join(project.docsPath, "MEMORY.md"), "# Garden\n");
  check("the project syncs up", (await call("POST", `/projects/${project.id}/cloud`, { sync:true })).status === 200);
  const key = project.id, base = `/api/v1/line-projects/${key}`;
  check("the switch is off at first", example("GET /api/lines/computer", await call("GET", "/computer")).runsAsks === false);
  example("POST /api/v1/device-sync/computer (the round)", await me.round());
  const listed = example("GET /api/v1/computers", (await page("GET", "/api/v1/computers")).json()).computers;
  check("penecho.ai lists the computer, its agents and its switch", listed.length === 1 && listed[0].name === "Test computer" && listed[0].open && !listed[0].runsAsks && listed[0].agents.some(a => a.id === "fake" && a.ready), JSON.stringify(listed));

  // On penecho.ai: an Ask, Run with the computer's agent. Switch off: it waits, and Cloud says why.
  const ask = (await page("POST", `${base}/unsent`, { topic:"new", text:"Add a rain chart." })).json();
  const held = example("POST /api/v1/line-projects/:key/topics/:slug/run-unsent (a project on a computer)", (await page("POST", `${base}/topics/${ask.slug}/run-unsent`, { step:ask.step, agent:"fake" })).json());
  example("the line's file on penecho.ai", (await page("GET", `${base}/doc?path=${encodeURIComponent(`topics/${ask.slug}.md`)}`)).json().md);
  check("Run on penecho.ai holds the Ask for the computer", held.held?.reason === "computer" && held.held.computer === me.id() && held.waiting?.blocked === "switch", JSON.stringify(held));
  await me.round();
  await wait(500);
  check("switch off: nothing ran on the computer", !service.runs.size && !F.parseLine(service.readDoc(project, ask.slug)).steps.some(s => s.kind === "work"));
  const station = async () => { const state = (await page("GET", `${base}/state`)).json(); return [...state.lines, ...state.backlog, ...state.landed].find(l => l.slug === ask.slug)?.stations.find(s => s.unsent)?.held; };
  check("the page's state says why: switch", (await station())?.blocked === "switch", JSON.stringify(await station()));
  example("GET /api/v1/line-projects/:key/state: the held Ask's station", (await (async () => { const state = (await page("GET", `${base}/state`)).json(); const line = [...state.lines, ...state.backlog, ...state.landed].find(l => l.slug === ask.slug); return { line:{ slug:line.slug, status:line.status, why:line.stations.find(s => s.unsent)?.why }, station:line.stations.find(s => s.unsent) }; })()));
  const home = (await page("GET", "/api/v1/home")).json();
  example("GET /api/v1/home: computer and working", { computer:home.computer, working:home.working });
  check("Home: Waiting for your computer, blocked by the switch", home.working?.some(row => row.line.slug === ask.slug && row.state === "computer" && row.blocked === "switch" && row.where === "Test computer" && row.agent === "Fake agent") && home.computer?.name === "Test computer", JSON.stringify(home.working));

  // Switch on: the computer runs it, and its Work is back on penecho.ai.
  check("the switch turns on, on this computer", example("POST /api/lines/computer { runsAsks:true }", await call("POST", "/computer", { runsAsks:true })).runsAsks === true);
  await me.round();
  const doc = async slug => F.parseLine((await page("GET", `${base}/doc?path=${encodeURIComponent(`topics/${slug}.md`)}`)).json().md || "");
  const done = await until(async () => { const d = await doc(ask.slug); return d.steps.some(s => s.kind === "work" && s.done) && d; }, "the Work on penecho.ai");
  check("the Work, done by the computer's agent, is on penecho.ai", done.steps.find(s => s.kind === "work").who === "fake" && !done.steps.some(F.isUnsent));
  const recent = await until(async () => (await page("GET", "/api/v1/home")).json().work?.find(row => row.line.slug === ask.slug), "Recent work");
  check("Home's Recent work has the computer's Work, from its summary", recent.agent === "Fake agent" && recent.endedAt > 0, JSON.stringify(recent));
  example("GET /api/v1/home: work (Recent work)", (await page("GET", "/api/v1/home")).json().work);
  example("the summary the computer uploaded (one line)", (await app.services.repository.lineProject(login.json().account.id, key)).summary.lines.find(l => l.path === `topics/${ask.slug}.md`));
  check("penecho.ai never called its own model", modelCalls === 0);
  check("no run was recorded on penecho.ai", (await app.services.repository.lineProjectRuns((await app.services.repository.lineProject(login.json().account.id, key)).id)).length === 0);

  // Stop on penecho.ai, while the computer runs an Ask.
  const slow = (await page("POST", `${base}/unsent`, { topic:ask.slug, text:"Take it slow." })).json();
  await page("POST", `${base}/topics/${slow.slug}/run-unsent`, { step:slow.step, agent:"fake" });
  await me.round();
  await until(() => service.runs.size === 1, "the run on the computer");
  await until(async () => (await doc(slow.slug)).status === "working", "penecho.ai shows it working");
  example("GET /api/v1/home: working while the computer runs it", (await page("GET", "/api/v1/home")).json().working);
  const stopped = example("POST /api/v1/line-projects/:key/topics/:slug/stop (running on the computer)", (await page("POST", `${base}/topics/${slow.slug}/stop`, {})).json());
  check("Stop on penecho.ai drops the computer's hold", stopped.stopped === true, JSON.stringify(stopped));
  example("the round after Stop", await me.round());
  await until(() => !service.runs.size, "the run stopped on the computer", 10000);
  const after = await until(async () => { const d = await doc(slow.slug); return d.steps.some(s => s.kind === "work" && s.off === "stopped") && d; }, "the stopped Work on penecho.ai");
  check("the stopped Work is back on penecho.ai", Boolean(after));
} catch (error) {
  check("the run reached its end", false, error.stack);
} finally {
  local.close(); lines.close(); await app.close();
  fs.rmSync(temp, { recursive:true, force:true });
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
