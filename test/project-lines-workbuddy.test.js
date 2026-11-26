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
const { WORKBUDDY, workbuddyLine, workbuddyFolders, workbuddyTitle, workbuddyFile } = require("../src/server/project-lines/workbuddy-sessions.js");

// WorkBuddy is hidden for now. Its code stays, so these tests show it.
WORKBUDDY.hidden = false;

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-workbuddy-test-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
const wait = ms => new Promise(r => setTimeout(r, ms));
let counter = 0;
const fresh = name => { const dir = path.join(temp, `${name}-${++counter}`); fs.mkdirSync(dir, { recursive:true }); return fs.realpathSync(dir); };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// A conversation's log, written the way WorkBuddy 5.2.6 writes it: the folder's path with dashes, none in front.
function workbuddyLog(home, folder, id, rows) {
  const dir = path.join(home, "projects", folder.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+/, ""));
  fs.mkdirSync(path.join(dir, id, "tool-results"), { recursive:true });
  fs.appendFileSync(path.join(dir, `${id}.jsonl`), rows.map(row => `${JSON.stringify({ sessionId:id, cwd:folder, ...row })}\n`).join(""));
}
const now = () => Date.now();
const typed = (text, extra = {}) => ({ id:`u${++counter}`, timestamp:now(), type:"message", role:"user", content:[{ type:"input_text", text:`<system-reminder data-role="user-context">\n<user_info>OS Version: darwin</user_info>\n</system-reminder>\n<user_query>${text}</user_query>` }], providerData:{ agent:"cli" }, ...extra });
const answer = (text, status = "completed") => ({ id:`a${++counter}`, timestamp:now(), type:"message", role:"assistant", status, content:[{ type:"output_text", text }], providerData:{ agent:"cli" } });
const call = (callId, name, args) => ({ id:`c${++counter}`, timestamp:now(), type:"function_call", callId, name, arguments:JSON.stringify(args), providerData:{ agent:"cli" } });
const result = (callId, name, text) => ({ id:`r${++counter}`, timestamp:now(), type:"function_call_result", callId, name, status:"completed", output:{ type:"text", text }, providerData:{ agent:"cli" } });
const plist = (apps, version = "5.2.6", bundle = "com.workbuddy.workbuddy") => {
  const file = path.join(apps, "WorkBuddy.app", "Contents", "Info.plist");
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${bundle}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`);
};

test("a WorkBuddy log gives only what the person typed, and the agent's steps", () => {
  const line = o => workbuddyLine(JSON.stringify(o));
  const asked = line(typed("帮我安装 docker desktop"));
  assert.deepEqual([asked.turnOpen, asked.changes], [true, [{ me:"帮我安装 docker desktop" }]], "WorkBuddy's own notes around the words are left out");
  assert.equal(line({ ...typed("x"), cwd:"/Users/me/app" }).cwd, "/Users/me/app", "every line says where it happened");
  const pasted = line({ ...typed("x"), content:[{ type:"input_text", text:"Like this" }, { type:"input_image", image_url:`data:image/png;base64,${PNG}` }, { type:"input_image", image_url:"https://example.com/a.png" }] });
  assert.deepEqual(pasted.changes, [{ me:"Like this\n[1 picture]", pictures:[{ type:"image/png", data:PNG }] }]);
  assert.deepEqual(line({ ...typed("old words"), providerData:{ isCompacted:true, compactType:"pre-message-auto", agent:"cli" } }).changes, [], "its summary of a long conversation is nobody's words");
  assert.deepEqual(line({ ...typed(""), content:[{ type:"input_text", text:"<cb_summary>\nSummary of the conversation so far" }] }).changes, []);
  assert.deepEqual(line(answer("先检查下当前环境")).changes, [{ add:{ kind:"say", text:"先检查下当前环境" } }, { said:"先检查下当前环境" }]);
  assert.deepEqual(line(call("call_1", "Bash", { command:"which docker", description:"Check" })).changes, [{ add:{ kind:"tool", id:"call_1", state:"running", verb:"Ran", target:"which docker", code:true, summary:"Check" } }]);
  assert.equal(line(call("call_2", "Edit", { file_path:"/a/b.js", old_string:"a", new_string:"b" })).changes[0].add.verb, "Edited");
  assert.deepEqual(line(call("q", "AskUserQuestion", { questions:[{ question:"Which one?", options:[{ label:"A" }, { label:"B" }] }] })).changes[0].add.questions, [{ text:"Which one?", options:["A", "B"] }]);
  assert.deepEqual(line(result("call_1", "Bash", "not found")).changes, [{ patch:{ id:"call_1", state:"done", output:"not found" } }]);
  const stopped = line(answer("Interrupted by user", "incomplete"));
  assert.deepEqual([stopped.turnOpen, stopped.changes], [false, []], "stopping it is not something it said");
  assert.deepEqual(line(answer("401 Unauthorized", "incomplete")).changes, [{ add:{ kind:"note", text:"401 Unauthorized" } }]);
  assert.equal(line({ type:"ai-title", aiTitle:"安装 docker desktop" }), null);
  assert.equal(line({ type:"file-history-snapshot" }), null);
  assert.equal(line({ type:"reasoning", content:[] }), null, "thinking is not said");
});

test("a folder's WorkBuddy conversations are found by its path with dashes, and folders inside it too", () => {
  const names = ["Users-me-work-app", "Users-me-work-app-sub", "Users-me-work-apple", "Users-me-other"];
  assert.deepEqual(workbuddyFolders(["/Users/me/work/app"], names).map(f => f.name), ["Users-me-work-app", "Users-me-work-app-sub"]);
  assert.deepEqual(workbuddyFolders(["/Users/me/线性代数"], ["Users-me-----", "Users-me------sub", "Users-me-----x"]).map(f => f.name), ["Users-me-----", "Users-me------sub"], "the folder each line names settles a name made only of dashes");
});

test("the title WorkBuddy gave a conversation, and whether it still has it", () => {
  const home = fresh("wb-home"), folder = fresh("work");
  workbuddyLog(home, folder, "6f0c", [typed("hi"), { type:"ai-title", aiTitle:"First", timestamp:now() }, { type:"ai-title", aiTitle:"安装 docker desktop", timestamp:now() }]);
  assert.equal(workbuddyTitle(home, "6f0c"), "安装 docker desktop");
  assert.equal(workbuddyTitle(home, "nope"), "");
  assert.ok(workbuddyFile(home, "6f0c").endsWith("6f0c.jsonl"));
  assert.equal(workbuddyFile(home, "../6f0c"), "");
});

test("WorkBuddy counts with its app alone, which comes forward to paste into, and nothing runs in the background", { skip:process.platform !== "darwin" }, t => {
  const root = fresh("agents"), apps = path.join(root, "Applications");
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(apps);
  const list = () => { const agents = createAgents({ env:{ PATH:"", HOME:root }, appFolders:[apps] }); return { agents, wb:agents.available().find(a => a.id === "workbuddy") }; };
  assert.equal(list().wb.available, false);
  plist(apps, "5.1.0");
  assert.equal(list().wb.available, false, "an older WorkBuddy than the one read does not count");
  plist(apps);
  const { agents, wb } = list();
  assert.deepEqual([wb.available, wb.runs, wb.opens, wb.opensIn], [true, false, true, "app"]);
  assert.equal(agents.command("workbuddy", { workdir:root, docs:root, gitDir:"" }), null);
  const app = path.join(apps, "WorkBuddy.app");
  assert.deepEqual(agents.openApp("workbuddy"), { command:"open", args:["-a", app], app:"WorkBuddy", picks:true });
  assert.deepEqual(agents.openApp("workbuddy", "6f0c")?.args, ["-a", app]);
  assert.deepEqual(agents.appOnly("workbuddy", "6f0c"), { command:"open", args:["-a", app], app:"WorkBuddy" });
  assert.equal(agents.terminalLine("workbuddy", "6f0c"), "");
  assert.equal(createAgents({ env:{ PATH:"", HOME:root } }).available().find(a => a.id === "workbuddy").available, false, "a list made for a test does not look in the real apps");
  const described = agents.describe().find(a => a.id === "workbuddy");
  assert.deepEqual([described.launch, described.cli, described.app.version, described.app.enough], [null, "", "5.2.6", true]);
  plist(apps, "5.9.3", "com.tencent.workbuddy.mac");
  assert.equal(list().wb.available, true, "WorkBuddy 5.9.3 from workbuddy.ai is com.tencent.workbuddy.mac");
  plist(apps, "5.9.3", "com.example.other");
  assert.equal(list().wb.available, false, "another app called WorkBuddy does not count");
});

test("what a person says in WorkBuddy comes onto a line in their words, and Paste with context names it to pick", { skip:process.platform !== "darwin" }, async () => {
  const home = fresh("home"), apps = fresh("Applications"), docs = fresh("docs"), code = fresh("code"), wb = path.join(home, ".workbuddy");
  plist(apps);
  const service = new Service({ directory:fresh("state"), agents:createAgents({ env:{ PATH:"", HOME:home }, appFolders:[apps] }), autoWatch:false, conversations:{ home, env:{}, idleMs:30 } });
  const opened = [];
  service.runDesktop = async command => { opened.push(command); };
  const project = service.store.create({ name:"Demo", docsPath:docs, codePath:code });
  workbuddyLog(wb, code, "11111111-aaaa", [
    { ...typed("Written before this project existed"), timestamp:1 },
    typed("Tidy the README"),
    { type:"ai-title", aiTitle:"Tidy README", timestamp:now() },
    { type:"reasoning", content:[], rawContent:[{ type:"reasoning_text", text:"Let me look." }], timestamp:now() },
    answer("Looking at it."),
    call("call_1", "Edit", { file_path:path.join(code, "README.md"), old_string:"a", new_string:"b" }),
    result("call_1", "Edit", "ok"),
    answer("The README is tidy."),
  ]);
  workbuddyLog(wb, fresh("elsewhere"), "22222222-bbbb", [typed("Not in this project")]);
  await service.conversations.tick();
  const topics = service.store.scan(project).topics;
  assert.equal(topics.length, 1);
  const slug = topics[0].slug, md = service.readDoc(project, slug), doc = F.parseLine(md);
  assert.deepEqual([doc.front.source, doc.front.who], ["WorkBuddy", "@workbuddy"]);
  assert.match(md, /Tidy the README/);
  assert.doesNotMatch(md, /Written before|system-reminder|user_query/);
  assert.deepEqual(service.activityOf(project, slug, 0).rows.filter(r => r.kind === "tool").map(r => [r.verb, r.state]), [["Edited", "done"]]);
  const card = service.conversationOf(project, slug, doc);
  assert.deepEqual([card.agent, card.canOpen, card.opensApp, card.terminal], ["workbuddy", false, "WorkBuddy", ""]);
  assert.deepEqual(await service.openForPaste(project, slug, "workbuddy"), { opened:true, app:"WorkBuddy", fresh:false, pick:true, title:"Tidy README" });
  assert.deepEqual(opened.pop().args, ["-a", path.join(apps, "WorkBuddy.app")]);
  await wait(60);
  await service.conversations.tick();
  assert.match(service.readDoc(project, slug), /The README is tidy\./);
  service.close();
});

test("Windows WorkBuddy folder keys preserve drive matching, underscores, Unicode and boundaries", () => {
  const names = ["c-projects_important-stock_value", "C-projects_important-stock_value-sub", "c-projects_important-stock_value2", "d-projects_important-stock_value"];
  for (const root of ["C:\\projects_important\\stock_value", "c:/projects_important/stock_value", "\\\\?\\C:\\projects_important\\stock_value"]) {
    assert.deepEqual(workbuddyFolders([root], names).map(f=>f.name), names.slice(0,2));
  }
  assert.deepEqual(workbuddyFolders(["H:\\研究\\线性代数"], ["h-研究-线性代数", "h-研究-线性代数x"]).map(f=>f.name), ["h-研究-线性代数"]);
});

test("WorkBuddy monitoring reads appended messages, excludes foreign cwd and resumes without duplicates", async () => {
  const home=fresh("monitor-home"), directory=fresh("monitor-state"), docs=fresh("monitor-docs"), code=fresh("monitor-code"), wb=path.join(home,".workbuddy");
  const make=()=>new Service({directory,agents:createAgents({env:{PATH:"",HOME:home}}),autoWatch:false,conversations:{home,env:{},idleMs:30,codex:{call:async()=>({data:[]})},opencode:{list:async()=>[]}}});
  let service=make();
  const project=service.store.create({name:"Monitor",docsPath:docs,codePath:code});
  try {
    await service.conversations.tick();
    workbuddyLog(wb,code,"monitor-session",[typed("Monitor first ask"),answer("First reply")]);
    // A file under a candidate directory does not own a project if its cwd is elsewhere.
    workbuddyLog(wb,code,"foreign-session",[{...typed("Do not import"),cwd:fresh("foreign-code")}]);
    await service.conversations.tick();
    let topics=service.store.scan(project).topics;assert.equal(topics.length,1);
    const slug=topics[0].slug;
    workbuddyLog(wb,code,"monitor-session",[typed("Appended ask"),answer("Appended reply")]);
    await service.conversations.tick(); await wait(60); await service.conversations.tick();
    assert.match(service.readDoc(project,slug),/Appended ask/);
    assert.match(service.readDoc(project,slug),/Appended reply/);
    service.close(); service=make();
    const reopened=service.store.projects.find(p=>p.id===project.id);
    const before=service.readDoc(reopened,slug);
    await service.conversations.tick();
    assert.equal(service.store.scan(reopened).topics.length,1);
    assert.equal(service.readDoc(reopened,slug),before);
  } finally {service.close();}
});

test("Windows WorkBuddy is detected as an app, opens its executable, and is never a runnable CLI", async () => {
  const {createAgentCheck}=require("../src/server/project-lines/agent-check.js");
  let calls=0,found={};
  const agents=createAgents({platform:"win32",env:{PATH:"",HOME:fresh("windows-discovery")},windowsAppFinder:()=>{calls++;return found;}});
  assert.equal(agents.available().find(a=>a.id==="workbuddy").available,false);
  found={path:"C:\\Program Files\\WorkBuddy\\WorkBuddy.exe",version:"5.4.4"};agents.reset();
  const wb=agents.available().find(a=>a.id==="workbuddy");
  assert.deepEqual([wb.available,wb.runs,wb.opens,wb.opensIn],[true,false,true,"app"]);
  const after=calls;agents.describe();agents.openApp("workbuddy");assert.equal(calls,after,"one discovery result serves the setup and open routes");
  assert.equal(agents.command("workbuddy",{}),null);
  assert.deepEqual(agents.openApp("workbuddy","a-session"),{command:found.path,args:[],app:"WorkBuddy",picks:true,detached:true});
  assert.deepEqual(agents.appOnly("workbuddy"),{command:found.path,args:[],app:"WorkBuddy",detached:true});
  const checker=createAgentCheck({describe:()=>agents.describe().filter(a=>a.id==="workbuddy"),reset:()=>agents.reset()});
  const result=await checker.check({fresh:true});
  assert.equal(result.agents[0].state,"ready");assert.equal(result.agents[0].signedIn,null);assert.equal(result.agents[0].where,"");
  assert.equal(result.agents[0].app,"WorkBuddy 5.4.4");
  found={path:found.path,version:""};agents.reset();assert.equal((await checker.check({fresh:true})).agents[0].state,"ready","missing version does not mean missing installation");
});

test("Windows WorkBuddy lookup takes its usual folders first, and asks Windows in the background", () => {
  const {findWindowsWorkBuddy}=require("../src/server/project-lines/windows-workbuddy.js");
  const local=fresh("localappdata"),standard=path.join(local,"Programs","WorkBuddy","WorkBuddy.exe"),custom=path.join(fresh("custom install"),"WorkBuddy.exe");
  const never=()=>{throw Error("Windows is not asked");};
  fs.mkdirSync(path.dirname(standard),{recursive:true});fs.writeFileSync(standard,"");
  assert.deepEqual(findWindowsWorkBuddy({LOCALAPPDATA:local},never),{path:standard,version:""});
  fs.writeFileSync(custom,"");
  assert.deepEqual(findWindowsWorkBuddy({WORKBUDDY_APP_PATH:custom},never),{path:custom,version:""});
  let answer=null,calls=0;
  const read=(_command,args,options,done)=>{calls++;assert.ok(args.includes("-EncodedCommand"));assert.equal(options.windowsHide,true);answer=done;};
  assert.deepEqual(findWindowsWorkBuddy({},read),{},"it goes on without the answer");
  answer(null,JSON.stringify({path:custom,version:"5.4.4"}));
  assert.deepEqual(findWindowsWorkBuddy({},read),{path:custom,version:"5.4.4"});
  assert.equal(calls,1,"and is not asked again at once");
  fs.rmSync(custom);
  assert.deepEqual(findWindowsWorkBuddy({},read),{},"an app that is gone does not count");
});

test("WorkBuddy is hidden: not listed, not looked for and not followed", async t => {
  WORKBUDDY.hidden = true;
  t.after(() => { WORKBUDDY.hidden = false; });
  let calls = 0;
  const home = fresh("hidden-home"), docs = fresh("hidden-docs"), code = fresh("hidden-code");
  const agents = createAgents({ platform:"win32", env:{ PATH:"", HOME:home }, windowsAppFinder:() => { calls++; return { path:"C:\\WorkBuddy.exe", version:"5.4.4" }; } });
  assert.equal(agents.available().some(a => a.id === "workbuddy"), false);
  assert.equal(agents.describe().some(a => a.id === "workbuddy"), false);
  assert.deepEqual([agents.openApp("workbuddy"), agents.appOnly("workbuddy"), agents.command("workbuddy", {})], [null, null, null]);
  assert.equal(calls, 0, "Windows is never asked for it");
  assert.equal(agents.nameOf("workbuddy"), "WorkBuddy", "Work it did keeps its name");
  const service = new Service({ directory:fresh("hidden-state"), agents, autoWatch:false, conversations:{ home, env:{}, idleMs:30 } });
  const project = service.store.create({ name:"Hidden", docsPath:docs, codePath:code });
  workbuddyLog(path.join(home, ".workbuddy"), code, "33333333-cccc", [typed("Not followed"), answer("ok")]);
  await service.conversations.tick();
  assert.equal(service.store.scan(project).topics.length, 0);
});
