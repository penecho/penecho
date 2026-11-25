"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const F = require("../src/server/project-lines/format.js");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const { parseDialect } = require("../src/server/project-lines/activity.js");
const { kimiLine, kimiFolders, kimiTitle, kimiHolds, kimiStores, shortHash } = require("../src/server/project-lines/kimi-sessions.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-kimi-test-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 8000) {
  const start = Date.now();
  for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(25); }
}
let counter = 0;
const fresh = name => { const dir = path.join(temp, `${name}-${++counter}`); fs.mkdirSync(dir, { recursive:true }); return fs.realpathSync(dir); };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// A conversation's log, written the way Kimi Code 0.35 and Kimi desktop 3.2.25 write it.
function kimiLog(home, folder, id, rows) {
  const dir = path.join(home, "sessions", `wd_${path.basename(folder).toLowerCase()}_${shortHash(folder)}`, id, "agents", "main");
  fs.mkdirSync(dir, { recursive:true });
  fs.appendFileSync(path.join(dir, "wire.jsonl"), rows.map(row => `${JSON.stringify(row)}\n`).join(""));
  return dir;
}
const now = () => Date.now();
const prompt = (text, extra = {}) => ({ type:"turn.prompt", input:[{ type:"text", text }], origin:{ kind:"user" }, time:now(), ...extra });
const loop = event => ({ type:"context.append_loop_event", event:{ turnId:"0", step:1, ...event }, time:now() });

test("what `kimi --prompt` prints becomes rows, and its session id comes at the end", () => {
  // Printed by Kimi Code 0.35 against a stand-in model.
  const lines = [
    { role:"meta", type:"system.version", version:"0.35.0" },
    { role:"assistant", content:"Writing the file now.", tool_calls:[{ type:"function", id:"call_1", function:{ name:"Write", arguments:"{\"path\":\"hello.txt\",\"content\":\"hi\\n\"}" } }] },
    { role:"tool", tool_call_id:"call_1", content:"Wrote 3 bytes to hello.txt" },
    { role:"meta", type:"turn.step.retrying", failed_attempt:1, error_name:"APIConnectionError", error_message:"Connection error." },
    { role:"assistant", content:"Done: wrote hello.txt." },
    { role:"meta", type:"session.resume_hint", session_id:"session_ba92eb86", command:"kimi -r session_ba92eb86" },
  ].flatMap(o => parseDialect("kimi", JSON.stringify(o)));
  assert.deepEqual(lines, [
    { add:{ kind:"say", text:"Writing the file now." } }, { said:"Writing the file now." },
    { add:{ kind:"tool", id:"call_1", state:"running", verb:"Wrote", target:"hello.txt" } },
    { patch:{ id:"call_1", state:"done", output:"Wrote 3 bytes to hello.txt" } },
    { add:{ kind:"note", text:"Trying again: Connection error." } },
    { add:{ kind:"say", text:"Done: wrote hello.txt." } }, { said:"Done: wrote hello.txt." },
    { session:"session_ba92eb86" },
  ]);
});

test("a Kimi log gives only what the person typed, with pictures, and the agent's steps", () => {
  const picture = path.join(fresh("attach"), "shot.png"), notes = path.join(path.dirname(picture), "notes.txt");
  fs.writeFileSync(picture, Buffer.from(PNG, "base64")); fs.writeFileSync(notes, "notes\n");
  const typed = kimiLine(JSON.stringify(prompt(`<meta awareness="low" timestamp="2026-07-27 13:00" />\nLook at this <attachment>${JSON.stringify({ type:"image", name:"image.png", path:picture, size:68 })}</attachment> and <attachment>${JSON.stringify({ type:"file", name:"notes.txt", path:notes })}</attachment>`)));
  assert.equal(typed.turnOpen, true);
  assert.deepEqual(typed.changes, [{ me:"Look at this  and", pictures:[{ type:"image/png", data:PNG }], files:[notes] }]);
  const pasted = kimiLine(JSON.stringify({ type:"turn.prompt", input:[{ type:"text", text:"Like this" }, { type:"image_url", imageUrl:{ url:`data:image/png;base64,${PNG}` } }], origin:{ kind:"user" }, time:1 }));
  assert.deepEqual(pasted.changes, [{ me:"Like this", pictures:[{ type:"image/png", data:PNG }] }]);
  const gone = kimiLine(JSON.stringify(prompt(`Old <attachment>${JSON.stringify({ type:"image", name:"image.png", path:"/nowhere/x.png" })}</attachment>`)));
  assert.deepEqual(gone.changes, [{ me:"Old\n[1 picture]" }], "a picture whose file has gone is counted");
  assert.deepEqual(kimiLine(JSON.stringify(prompt("<system-reminder>Auto mode</system-reminder>", { origin:{ kind:"injection" } }))).changes, [], "what Kimi adds is not the person");
  assert.deepEqual(kimiLine(JSON.stringify(loop({ type:"content.part", part:{ type:"think", think:"hmm" } }))), null, "thinking is not said");
  assert.deepEqual(kimiLine(JSON.stringify(loop({ type:"tool.call", toolCallId:"t1", name:"Bash", args:{ command:"git status", description:"x" } }))).changes, [{ add:{ kind:"tool", id:"t1", state:"running", verb:"Ran", target:"git status", code:true, summary:"x" } }]);
  assert.deepEqual(kimiLine(JSON.stringify(loop({ type:"tool.call", toolCallId:"t2", name:"Edit", args:{ path:"a.js", old_string:"a", new_string:"b" } }))).changes[0].add.verb, "Edited");
  assert.deepEqual(kimiLine(JSON.stringify(loop({ type:"tool.result", toolCallId:"t1", result:{ output:"rejected", isError:true } }))).changes, [{ patch:{ id:"t1", state:"failed", output:"rejected" } }]);
  assert.deepEqual(kimiLine(JSON.stringify(loop({ type:"tool.call", toolCallId:"q", name:"AskUserQuestion", args:{ questions:[{ question:"Which one?", options:[{ label:"A" }, { label:"B" }] }] } }))).changes[0].add.questions, [{ text:"Which one?", options:["A", "B"] }]);
  assert.equal(kimiLine(JSON.stringify({ type:"turn.ended", turnId:0, reason:"completed", time:5 })).turnOpen, false);
});

test("a folder's Kimi conversations are found by the hash of its path, or by Kimi's own list for a folder inside", () => {
  const home = fresh("kimi-home"), linked = fresh("linked"), inner = path.join(linked, "sub"), other = fresh("other");
  fs.mkdirSync(inner);
  fs.writeFileSync(path.join(home, "projects.json"), JSON.stringify({ schema_version:2, projects:{ [`wd_sub_${shortHash(inner)}`]:{ root:inner } } }));
  const names = [`wd_${path.basename(linked)}_${shortHash(linked)}`, `wd_sub_${shortHash(inner)}`, `wd_${path.basename(other)}_${shortHash(other)}`, "junk"];
  assert.deepEqual(kimiFolders(home, [linked], names), [{ name:names[0], cwd:linked }, { name:names[1], cwd:inner }]);
});

test("Kimi counts with either its command line or its desktop app, and the desktop app comes first", { skip:process.platform !== "darwin" }, t => {
  const root = fresh("agents"), apps = path.join(root, "Applications"), cli = path.join(root, ".kimi-code", "bin", "kimi");
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(apps);
  const list = () => { const agents = createAgents({ env:{ PATH:"", HOME:root }, appFolders:[apps] }); return { agents, kimi:agents.available().find(a => a.id === "kimi") }; };
  assert.equal(list().kimi.available, false);
  // Only the desktop app: where you paste, though nothing runs in the background.
  const plist = path.join(apps, "Kimi.app", "Contents", "Info.plist");
  fs.mkdirSync(path.dirname(plist), { recursive:true });
  fs.writeFileSync(plist, `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.moonshot.kimichat</string><key>CFBundleShortVersionString</key><string>3.2.25</string></dict></plist>`);
  let { agents, kimi } = list();
  assert.deepEqual([kimi.available, kimi.opens, kimi.opensIn], [true, true, "app"]);
  assert.equal(agents.command("kimi", { workdir:root, docs:root, gitDir:"" }), null);
  assert.deepEqual(agents.openApp("kimi"), { command:"open", args:["kimi-work://home"], app:"Kimi", picks:true }, "a new conversation: Kimi comes forward");
  assert.deepEqual(agents.openApp("kimi", "conv-abc")?.args, ["kimi-work://home"], "so does one of its own");
  assert.equal(agents.openApp("kimi", "session_1"), null, "one had on the command line is not in the app");
  assert.equal(agents.appOnly("kimi", "conv-abc").app, "Kimi");
  assert.equal(agents.appOnly("kimi", "session_1"), null);
  assert.equal(agents.terminalLine("kimi", "session_1"), "", "and with no command line there is nothing to open it with");
  assert.equal(createAgents({ env:{ PATH:"", HOME:root } }).available().find(a => a.id === "kimi").available, false, "a list made for a test does not look in the real apps");
  // The command line too, from its own installer's folder.
  fs.mkdirSync(path.dirname(cli), { recursive:true }); fs.writeFileSync(cli, "#!/bin/sh\n", { mode:0o755 });
  ({ agents, kimi } = list());
  assert.equal(kimi.opensIn, "app", "the desktop app still comes first");
  assert.equal(agents.terminalLine("kimi", "session_1"), `${cli} --session session_1`);
  assert.equal(agents.terminalLine("kimi", "conv-abc"), "", "the command line keeps its own conversations");
  assert.equal(agents.terminal("kimi", "session_1"), "kimi --session session_1");
  assert.equal(agents.terminal("kimi", "conv-abc"), "");
  const run = agents.command("kimi", { workdir:root, docs:"/docs", gitDir:"/repo/.git", resume:"session_1" });
  assert.deepEqual(run.args, ["--session", "session_1", "--add-dir", "/docs", "--add-dir", "/repo/.git", "--output-format", "stream-json", "--prompt"]);
  assert.equal(run.promptLast, true); assert.equal(run.dialect, "kimi");
  // Only the command line: a terminal.
  fs.rmSync(path.join(apps, "Kimi.app"), { recursive:true });
  ({ agents, kimi } = list());
  assert.deepEqual([kimi.available, kimi.opens, kimi.opensIn], [true, true, "Terminal"]);
  assert.equal(agents.openApp("kimi"), null);
  assert.equal(agents.terminalLine("kimi"), cli, "with no conversation, a new one");
});

test("the desktop app's list gives a conversation's title, and each store says what it still holds", () => {
  let sqlite; try { sqlite = require("node:sqlite"); } catch { return; }
  const home = fresh("home"), stores = kimiStores({}, home), folder = fresh("work");
  fs.mkdirSync(path.dirname(stores.desktop.titles), { recursive:true });
  const db = new sqlite.DatabaseSync(stores.desktop.titles);
  db.exec("create table conversations (kernel_session_id text, title text not null, updated_at_ms integer not null)");
  db.prepare("insert into conversations values (?, ?, ?)").run("conv-1", "代码P0缺陷审查", 1);
  db.close();
  assert.equal(kimiTitle(stores.desktop.titles, "conv-1"), "代码P0缺陷审查");
  assert.equal(kimiTitle(stores.desktop.titles, "conv-2"), "");
  kimiLog(stores.desktop.home, folder, "conv-1", [prompt("hi")]);
  kimiLog(stores.cli.home, folder, "session_1", [prompt("hi")]);
  const archived = kimiLog(stores.cli.home, folder, "session_2", [prompt("hi")]);
  fs.writeFileSync(path.join(archived, "..", "..", "state.json"), JSON.stringify({ archived:true }));
  assert.deepEqual(["conv-1", "session_1", "session_2", "conv-9", "session_1/../x"].map(id => kimiHolds(stores, id)), [true, true, false, false, false]);
});

test("what a person says in Kimi, desktop or command line, comes onto a line in their words", async () => {
  const home = fresh("home"), docs = fresh("docs"), code = fresh("code"), stores = kimiStores({}, home);
  const service = new Service({ directory:fresh("state"), agents:createAgents({ env:{ PATH:"" } }), autoWatch:false, conversations:{ home, env:{}, idleMs:30 } });
  const project = service.store.create({ name:"Demo", docsPath:docs, codePath:code });
  kimiLog(stores.desktop.home, code, "conv-1", [
    { type:"metadata", protocol_version:"1.4", created_at:now() },
    { ...prompt("Written before this project existed"), time:1 },
    prompt("<meta awareness=\"low\" timestamp=\"2026-11-07 20:00\" />\nTidy the README"),
    loop({ type:"content.part", part:{ type:"think", think:"Let me look." } }),
    loop({ type:"tool.call", toolCallId:"t1", name:"Edit", args:{ path:path.join(code, "README.md"), old_string:"a", new_string:"b" } }),
    loop({ type:"tool.result", toolCallId:"t1", result:{ output:"ok" } }),
    loop({ type:"content.part", part:{ type:"text", text:"The README is tidy." } }),
    { type:"turn.ended", turnId:0, reason:"completed", time:now() },
  ]);
  kimiLog(stores.desktop.home, code, "ctitle-1", [prompt("Name this conversation")]);
  kimiLog(stores.cli.home, code, "session_9", [prompt("Add a test")]);
  kimiLog(stores.cli.home, fresh("elsewhere"), "session_8", [prompt("Not in this project")]);
  await service.conversations.tick();
  const topics = service.store.scan(project).topics.map(t => F.parseLine(service.readDoc(project, t.slug)));
  const bySource = Object.fromEntries(topics.map(t => [t.front.source, t]));
  assert.deepEqual(Object.keys(bySource).sort(), ["Kimi Code", "Kimi desktop"]);
  const desk = bySource["Kimi desktop"], slug = service.store.scan(project).topics.find(t => F.parseLine(service.readDoc(project, t.slug)).front.source === "Kimi desktop").slug;
  assert.equal(desk.front.who, "@kimi");
  const md = service.readDoc(project, slug);
  assert.match(md, /Tidy the README/);
  assert.doesNotMatch(md, /meta awareness|Written before|Name this conversation/);
  assert.deepEqual(service.activityOf(project, slug, 0).rows.filter(r => r.kind === "tool").map(r => [r.verb, r.state]), [["Edited", "done"]]);
  const card = service.conversationOf(project, slug, F.parseLine(md));
  assert.equal(card.agent, "kimi"); assert.equal(card.canOpen, false); assert.equal(card.terminal, "", "a desktop conversation is not opened from a terminal");
  assert.equal(service.sessions[service.key(project, slug)].kimi.cwd, code, "the folder it is filed under is where it happened");
  await wait(60);
  await service.conversations.tick();
  assert.match(service.readDoc(project, slug), /The README is tidy\./);
  service.close();
});

test("a run in Kimi Code takes the words as its last argument and carries on in the same session", async () => {
  const dir = fresh("kimi-run"), script = path.join(dir, "kimi.js"), log = path.join(dir, "runs.jsonl");
  fs.writeFileSync(script, `
const fs = require("fs"), args = process.argv.slice(2), at = args.indexOf("--prompt"), words = args[at + 1];
let stdin = ""; process.stdin.on("data", d => stdin += d).on("end", () => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, words, stdin, resume:args.includes("--session") ? args[args.indexOf("--session") + 1] : "", update:process.env.KIMI_CODE_NO_AUTO_UPDATE }) + "\\n");
  const say = o => console.log(JSON.stringify(o));
  say({ role:"meta", type:"system.version", version:"0.35.0" });
  say({ role:"assistant", content:"Checking.", tool_calls:[{ type:"function", id:"c1", function:{ name:"Bash", arguments:JSON.stringify({ command:"npm test" }) } }] });
  say({ role:"tool", tool_call_id:"c1", content:"3 passing" });
  say({ role:"assistant", content:"Finished in Kimi." });
  say({ role:"meta", type:"session.resume_hint", session_id:"session_k1" });
});`);
  const agents = createAgents({ env:{ PATH:"", KIMI_CLI_PATH:script } });
  assert.deepEqual(agents.available().filter(a => a.available).map(a => a.id), ["kimi"]);
  const service = new Service({ directory:fresh("state"), agents, autoWatch:false, conversations:{ home:fresh("home"), env:{} } });
  const project = service.store.create({ name:"Demo", docsPath:fresh("docs"), codePath:null });
  project.defaultAgent = "kimi";
  const runs = () => fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const asked = await service.request(project, { text:"Tidy the notes", topic:"new" });
  await until(() => !service.runs.size && F.parseLine(service.readDoc(project, asked.slug)).status === "done" && fs.existsSync(log), "the run");
  const first = runs()[0];
  assert.match(first.words, /Tidy the notes/); assert.equal(first.stdin, ""); assert.equal(first.args[first.args.length - 2], "--prompt");
  assert.equal(first.update, "1"); assert.equal(first.resume, "");
  assert.ok(first.args.includes(project.docsPath), "Kimi may work in the docs folder");
  assert.deepEqual(service.activityOf(project, asked.slug, 0).rows.filter(r => r.kind === "tool").map(r => [r.verb, r.target, r.state, r.output]), [["Ran", "npm test", "done", "3 passing"]]);
  assert.match(service.readDoc(project, asked.slug), /Finished in Kimi/);
  assert.equal(service.conversationOf(project, asked.slug, F.parseLine(service.readDoc(project, asked.slug))).terminal, "kimi --session session_k1");
  await service.act(project, asked.slug, "feedback", { text:"And the index" });
  await until(() => runs().length === 2 && !service.runs.size, "the follow-up");
  assert.equal(runs()[1].resume, "session_k1", "the same conversation carries on");
  service.close();
});

test("Paste with context brings Kimi forward and names what to pick there; a command-line conversation opens in Terminal", { skip:process.platform !== "darwin" }, async () => {
  let sqlite; try { sqlite = require("node:sqlite"); } catch { return; }
  const home = fresh("home"), apps = fresh("Applications"), docs = fresh("docs"), code = fresh("code"), stores = kimiStores({}, home), cli = path.join(home, ".kimi-code", "bin", "kimi");
  const plist = path.join(apps, "Kimi.app", "Contents", "Info.plist");
  fs.mkdirSync(path.dirname(plist), { recursive:true });
  fs.writeFileSync(plist, `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.moonshot.kimichat</string><key>CFBundleShortVersionString</key><string>3.2.25</string></dict></plist>`);
  fs.mkdirSync(path.dirname(cli), { recursive:true }); fs.writeFileSync(cli, "#!/bin/sh\n", { mode:0o755 });
  fs.mkdirSync(path.dirname(stores.desktop.titles), { recursive:true });
  const db = new sqlite.DatabaseSync(stores.desktop.titles);
  db.exec("create table conversations (kernel_session_id text, title text not null, updated_at_ms integer not null)");
  db.prepare("insert into conversations values (?, ?, ?)").run("conv-1", "Dark mode switch", 1);
  db.close();
  const service = new Service({ directory:fresh("state"), agents:createAgents({ env:{ PATH:"", HOME:home }, appFolders:[apps] }), autoWatch:false, conversations:{ home, env:{}, idleMs:30 } });
  const opened = [];
  service.runDesktop = async command => { opened.push(command); };
  const project = service.store.create({ name:"Demo", docsPath:docs, codePath:code });
  kimiLog(stores.desktop.home, code, "conv-1", [prompt("Add a dark mode switch")]);
  kimiLog(stores.cli.home, code, "session_1", [prompt("Add a test")]);
  await service.conversations.tick();
  const slugOf = text => service.store.scan(project).topics.find(t => service.readDoc(project, t.slug).includes(text)).slug;
  assert.deepEqual(await service.openForPaste(project, slugOf("dark mode"), "kimi"), { opened:true, app:"Kimi", fresh:false, pick:true, title:"Dark mode switch" });
  assert.deepEqual(opened.pop().args, ["kimi-work://home"]);
  const terminal = await service.openForPaste(project, slugOf("Add a test"), "kimi"), window = opened.pop();
  assert.deepEqual([terminal.opened, terminal.app, terminal.pick], [true, "Terminal", undefined]);
  assert.deepEqual(window.args.slice(0, 2), ["-a", "Terminal"]);
  assert.match(fs.readFileSync(window.file, "utf8"), new RegExp(`exec ${cli.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} --session session_1`));
  fs.rmSync(window.file, { force:true });
  service.forgetSession(project, slugOf("dark mode"), "kimi");
  assert.deepEqual(await service.openForPaste(project, slugOf("dark mode"), "kimi"), { opened:true, app:"Kimi", fresh:true, pick:true, folder:path.basename(code) }, "a new conversation names the folder to start it in");
  service.close();
});

test("a run's own Kimi conversation, named only at its end, is that run's line and never a line of its own", async t => {
  const dir = fresh("kimi-late"), script = path.join(dir, "kimi.js"), home = fresh("home"), stores = kimiStores({}, home), id = "session_late1";
  // Like Kimi Code: its log starts before it has the Ask, the Ask comes next, and the session is named only when it ends.
  fs.writeFileSync(script, `
const fs = require("fs"), path = require("path"), { createHash } = require("crypto"), args = process.argv.slice(2), words = args[args.indexOf("--prompt") + 1];
const cwd = process.cwd(), log = path.join(${JSON.stringify(stores.cli.home)}, "sessions", "wd_" + path.basename(cwd).toLowerCase() + "_" + createHash("sha256").update(cwd).digest("hex").slice(0, 12), ${JSON.stringify(id)}, "agents", "main");
const signal = name => new Promise(go => { const look = () => fs.existsSync(path.join(${JSON.stringify(dir)}, name)) ? go() : setTimeout(look, 20); look(); });
setTimeout(() => process.exit(1), 15000).unref();
(async () => {
  fs.mkdirSync(log, { recursive:true });
  const add = o => fs.appendFileSync(path.join(log, "wire.jsonl"), JSON.stringify({ time:Date.now(), ...o }) + "\\n");
  add({ type:"metadata", protocol_version:"1.5", created_at:Date.now() });
  await signal("ask");
  add({ type:"turn.prompt", input:[{ type:"text", text:words }], origin:{ kind:"user" } });
  add({ type:"context.append_loop_event", event:{ type:"content.part", part:{ type:"text", text:"Working on it." } } });
  console.log(JSON.stringify({ role:"assistant", content:"Working on it." }));
  await signal("end");
  add({ type:"turn.ended", reason:"completed" });
  console.log(JSON.stringify({ role:"assistant", content:"Done in Kimi." }));
  console.log(JSON.stringify({ role:"meta", type:"session.resume_hint", session_id:${JSON.stringify(id)} }));
})();`);
  const service = new Service({ directory:fresh("state"), agents:createAgents({ env:{ PATH:"", KIMI_CLI_PATH:script } }), autoWatch:false, conversations:{ home, env:{}, idleMs:30 } });
  const project = service.store.create({ name:"Demo", docsPath:fresh("docs"), codePath:null });
  project.defaultAgent = "kimi";
  const slugs = () => service.store.scan(project).topics.map(t => t.slug);
  const asked = await service.request(project, { text:"Tidy the notes", topic:"new" });
  const rec = () => service.conversations.records[`kimi:${id}`];
  t.after(() => { for (const name of ["ask", "end"]) fs.writeFileSync(path.join(dir, name), ""); service.close(); });
  const wire = await until(() => { let names; try { names = fs.readdirSync(path.join(stores.cli.home, "sessions")); } catch { return null; } return names.map(name => path.join(stores.cli.home, "sessions", name, id, "agents", "main", "wire.jsonl")).find(file => fs.existsSync(file)); }, "its log");
  await service.conversations.tick();
  assert.deepEqual(slugs(), [asked.slug], "a log with no Ask yet waits");
  assert.equal(rec(), undefined);
  fs.writeFileSync(path.join(dir, "ask"), "");
  await until(() => fs.readFileSync(wire, "utf8").includes("turn.prompt"), "its Ask");
  // Someone else's conversation in the same folder, begun meanwhile, still comes in as theirs.
  kimiLog(stores.cli.home, project.docsPath, "session_mine", [{ type:"metadata", protocol_version:"1.5", created_at:now() }, prompt("My own question")]);
  await service.conversations.tick();
  assert.equal(rec()?.slug, asked.slug, "the run's conversation belongs to its line at once");
  assert.equal(rec().startedHere, true);
  assert.equal(service.runs.get(service.key(project, asked.slug)).sessionId, id);
  const theirs = slugs().filter(slug => slug !== asked.slug);
  assert.equal(theirs.length, 1);
  assert.match(service.readDoc(project, theirs[0]), /My own question/);
  fs.writeFileSync(path.join(dir, "end"), "");
  await until(() => !service.runs.size && F.parseLine(service.readDoc(project, asked.slug)).status === "done", "the run");
  await wait(60);
  await service.conversations.tick();
  assert.deepEqual(slugs().sort(), [asked.slug, theirs[0]].sort(), "no line of its own after it ends either");
  assert.equal(rec().slug, asked.slug);
  assert.doesNotMatch(service.readDoc(project, asked.slug), /## Ask[^\n]*Kimi Code/, "its Ask is not brought in again");
  assert.match(service.readDoc(project, asked.slug), /Done in Kimi/);
});
