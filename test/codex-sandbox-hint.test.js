"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const { isCodexSandboxBroken, codexSandboxBrokeIn } = require("../src/server/project-lines/activity.js");
const { Service } = require("../src/server/project-lines/service.js");
const F = require("../src/server/project-lines/format.js");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label = "condition", timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (fn()) return; await wait(15); }
  throw new Error(`Timed out waiting for ${label}`);
}
function fakeChild(pid) {
  const child = new EventEmitter();
  Object.assign(child, { pid, stdout:new PassThrough(), stderr:new PassThrough(), stdin:new PassThrough() });
  child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", 0)); };
  return child;
}
// What Codex printed on the owner's Windows PC when .git belonged to Administrators (2026-11-26).
const BROKEN = "Failed to create unified exec process: helper_unknown_error: setup refresh had errors";
const ran = (id, output, exit = 1) => ({ type:"item.completed", item:{ id, type:"command_execution", command:"powershell -Command Get-Location", exit_code:exit, aggregated_output:output } });

test("Codex's own words for a Windows sandbox that could not start are known, and ordinary sandbox refusals are not", () => {
  for (const text of [
    BROKEN,
    "windows sandbox: setup refresh had errors",
    "Windows sandbox setup failed: helper_firewall_rule_create_or_add_failed",
    "CreateProcessAsUserW failed: 5",
    "elevated Windows sandbox provisioning is incomplete or outdated",
    "sandbox provisioning: failed",
    "failed to prepare process sandbox: access denied",
  ]) assert.equal(isCodexSandboxBroken(text), true, text);
  for (const text of ["", "Command denied by sandbox: rm -rf /", "Network access was denied by the Codex sandbox network proxy.", "npm ERR! missing script: test", "Access is denied."]) assert.equal(isCodexSandboxBroken(text), false, text);
  assert.equal(codexSandboxBrokeIn({ kind:"tool", state:"failed", output:BROKEN }), true);
  assert.equal(codexSandboxBrokeIn({ kind:"tool", state:"done", output:BROKEN }), false, "a command that ran is not a broken sandbox");
  assert.equal(codexSandboxBrokeIn({ kind:"note", text:"Windows sandbox setup failed: helper_unknown_error" }), true);
  assert.equal(codexSandboxBrokeIn(null), false);
});

test("a Codex Work whose sandbox could not start says so once, keeps it in its file, and the next run that works clears it", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-sandbox-hint-"));
  const stateDir = path.join(root, "state"), docsDir = path.join(root, "docs");
  fs.mkdirSync(stateDir, { recursive:true });
  const script = { codex:[ran("a", BROKEN), ran("b", BROKEN), { type:"item.completed", item:{ id:"m", type:"agent_message", text:"I could not run any command." } }], claude:[] };
  let lines = [], spawned = 0;
  const service = new Service({
    directory:stateDir,
    autoWatch:false,
    agents:{
      available:() => [{ id:"codex", available:true, name:"Codex" }, { id:"claude", available:true, name:"Claude" }],
      classifier:() => null,
      command:(id, opts) => ({ command:id, args:[], cwd:opts.workdir, stdin:true }),
    },
    spawnFn:() => {
      const child = fakeChild(97500 + spawned++), out = lines;
      setImmediate(() => { for (const event of out) child.stdout.write(`${JSON.stringify(event)}\n`); child.stdout.write(`${JSON.stringify({ type:"turn.completed" })}\n`); setImmediate(() => child.emit("close", 0)); });
      return child;
    },
  });
  t.after(() => { service.runs.clear(); service.close(); fs.rmSync(root, { recursive:true, force:true }); });
  const project = service.store.create({ name:"Sandbox", docsPath:docsDir });
  const settled = () => !service.runs.size && !service.finishing.size;
  const front = (slug, step) => F.splitFront(service.store.readText(project, F.detailPath(slug, step)).text).front;
  const station = (slug, step) => service.stateOf(project).lines.find(l => l.slug === slug).stations.find(s => s.id === step);

  lines = script.codex;
  const broken = await service.createTopic(project, { text:"Check the folder", agent:"codex", kinds:["ask", "work"], start:true });
  await until(() => spawned === 1 && settled(), "Codex run ended");
  const workId = F.parseLine(service.readDoc(project, broken.slug)).steps.find(s => s.kind === "work").id;
  const notes = service.activity.load(project, broken.slug).rows.filter(r => r.kind === "note" && /could not start its sandbox/.test(r.text || ""));
  assert.equal(notes.length, 1, "two failed commands, one note");
  assert.match(notes[0].text, /Full access in Settings/);
  assert.equal(front(broken.slug, workId)["sandbox failed"], "yes");
  assert.equal(station(broken.slug, workId).sandboxFailed, true);

  // Another agent printing the same words is not Codex's sandbox, and a Codex run that works says nothing.
  lines = [ran("c", BROKEN), { type:"item.completed", item:{ id:"n", type:"agent_message", text:"Done." } }];
  const other = await service.createTopic(project, { text:"Same words", agent:"claude", kinds:["ask", "work"], start:true });
  await until(() => spawned === 2 && settled(), "Claude run ended");
  const otherWork = F.parseLine(service.readDoc(project, other.slug)).steps.find(s => s.kind === "work").id;
  assert.equal(station(other.slug, otherWork).sandboxFailed, undefined);
  assert.equal(service.activity.load(project, other.slug).rows.some(r => /could not start its sandbox/.test(r.text || "")), false);

  // A close with nothing to say of the sandbox (a Work picked up from another app) keeps it; a later run of this Work that worked clears it.
  await service.closeDetail(project, broken.slug, workId, { result:"I could not run any command." });
  assert.equal(front(broken.slug, workId)["sandbox failed"], "yes");
  await service.closeDetail(project, broken.slug, workId, { result:"It works now.", who:"codex", sandbox:false });
  assert.equal(front(broken.slug, workId)["sandbox failed"], undefined);
  assert.equal(station(broken.slug, workId).sandboxFailed, undefined);

  // When an initial sandboxed command fails, then a later escalated command outside the sandbox succeeds, sandboxFailed is NOT set on the finished Work.
  lines = [ran("d1", BROKEN, 1), ran("d2", "README.md\n", 0), { type:"item.completed", item:{ id:"m2", type:"agent_message", text:"Listed files outside the sandbox." } }];
  const recovered = await service.createTopic(project, { text:"Recover outside sandbox", agent:"codex", kinds:["ask", "work"], start:true });
  await until(() => spawned === 3 && settled(), "Recovered Codex run ended");
  const recoveredWork = F.parseLine(service.readDoc(project, recovered.slug)).steps.find(s => s.kind === "work").id;
  assert.equal(front(recovered.slug, recoveredWork)["sandbox failed"], undefined);
  assert.equal(station(recovered.slug, recoveredWork).sandboxFailed, undefined);
});

test("the Work's page offers Settings beside the hint, and the button opens the saved agent it ran with", () => {
  const src = fs.readFileSync(path.join(__dirname, "../public/lines/line.js"), "utf8");
  const from = src.indexOf("// Codex's Windows sandbox could not start, so its commands did not run"), to = src.indexOf("function resultHTML(p, l, s, doc)");
  assert.ok(from > 0 && to > from, "the hint sits just before resultHTML");
  const calls = [], presets = { mine:{ id:"mine", agent:"codex", access:"reviewed" }, made:{ id:"made", agent:"codex", auto:true } };
  const ctx = vm.createContext({
    ACT:{}, isWork:s => s.kind === "work", ic:name => `<i data-ic="${name}"></i>`, esc:value => String(value).replace(/"/g, "&quot;"),
    openSettings:id => calls.push(["settings", id]), settingsUp:() => true, savedPreset:id => presets[id], openPresetForm:x => calls.push(["edit", x.id]),
  });
  vm.runInContext(`${src.slice(from, to)}\nthis.sandboxHintHTML = sandboxHintHTML;`, ctx);
  assert.equal(ctx.sandboxHintHTML({ kind:"work", state:"done" }), "");
  assert.equal(ctx.sandboxHintHTML({ kind:"ask", sandboxFailed:true }), "");
  const html = ctx.sandboxHintHTML({ kind:"work", state:"done", sandboxFailed:true, savedAgentId:"mine" });
  assert.match(html, /could not start its sandbox in this folder/);
  assert.match(html, /Full access/);
  assert.match(html, /data-act="sandbox-settings" data-id="mine">Open Settings</);
  ctx.ACT["sandbox-settings"]({ dataset:{ id:"mine" } });
  ctx.ACT["sandbox-settings"]({ dataset:{ id:"made" } });
  ctx.ACT["sandbox-settings"]({ dataset:{ id:"" } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["settings", "agents"], ["edit", "mine"], ["settings", "agents"], ["settings", "agents"]]);
});
