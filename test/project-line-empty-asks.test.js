"use strict";
require("./helpers/safety.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const { humanWords } = require("../src/server/project-lines/agent-sessions.js");
const { codexWords, codexChanges, claudeLine } = require("../src/server/project-lines/conversations.js");
const F = require("../src/server/project-lines/format.js");
const { Service } = require("../src/server/project-lines/service.js");
const { find } = require("../src/server/project-lines/find.js");

function lineHarness(line) {
  const project = {
    id:"p", name:"Test", defaultAgent:"codex", vault:{ path:"/tmp/docs" },
    files:[{ path:"files/pic.png", name:"pic.png", image:true }, { path:"files/spec.md", name:"spec.md", image:false }],
    pictures:[], lines:[line], landed:[], backlog:[],
  };
  const context = vm.createContext({
    S:{}, HOSTED:null, SEND:{}, STATE_COLOR:{}, KIND:{ ask:{ label:"Ask" }, note:{ label:"Note" }, canvas:{ label:"Canvas" }, meeting:{ label:"Meeting" } },
    document:{ addEventListener() {} }, window:{}, addEventListener() {},
    availableAgents:() => [], can:() => true,
    fileEntry:(p, filePath) => (p.files || []).find(f => f.path === filePath) || null,
    assetUrl:(_p, filePath) => `/asset/${filePath}`, filesApart:() => false,
    wordsMd:text => (text ? `<p>${text}</p>` : ""), texInline:text => text, inlineSay:text => text,
    quoteInner:(label, words) => `${label}: ${words}`, nodeWhen:w => w, dayOf:w => (w || "").slice(0, 10),
    av:a => `<av>${a}</av>`, agentInfo:a => ({ name:a, mono:a[0], color:"#000" }),
    project:() => project, lineById:() => line, stationById:(l, id) => l.stations.find(s => s.id === id),
    questionsHTML:() => "", openQuestions:() => [], stepLabel:s => s.label || s.kind, stateWord:s => s.state || "done",
    canReview:() => false, isReviewed:() => false, reviewTag:() => "", wasMerged:() => false, nodeIcon:() => "",
    lineState:l => l.status || "done", currentStation:l => l.stations.at(-1), workWords:(_l, s) => s.out || "",
    workBodyHTML:(_p, _l, s) => `<p>${s.out || ""}</p>`, workOutputsHTML:() => "", workSubHTML:() => "", workMoreHTML:() => "", reviewTool:() => "", carryWork:() => null,
    docsFile:(_p, filePath) => filePath, referForm:(_d, r) => r, toolCopy:() => [],
    nodeTool:() => "", nodeTools:() => "", copiedNow:() => false, fromMark:() => "",
    picturePreview:(_p, filePath, name) => `<img src="/asset/${filePath}" alt="${name || ""}">`,
    offText:() => "Canceled", p:project, l:line,
  });
  for (const name of ["line-status", "core", "line", "merge"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../public/lines/${name}.js`), "utf8"), context);
  }
  return { project, context, run:code => vm.runInContext(code, context) };
}

test("structured question replies extract user answers on import, title generation, and search", t => {
  const single = `<send_user_message_question_reply>\n[{"questionItemId":"call_1,0","question":"是否同意登录授权？","answer":"登陆好了"}]\n</send_user_message_question_reply>`;
  assert.equal(humanWords(single), "登陆好了");
  assert.equal(codexWords(single), "登陆好了");
  assert.equal(codexChanges({ type:"userMessage", content:[{ type:"text", text:single }] })[0].me, "登陆好了");
  assert.equal(F.titleFromText(single), "登陆好了");

  const multi = `<send_user_message_question_reply>\n[{"question":"Q1","answer":"First choice"},{"question":"Q2","answer":"Second choice"}]\n</send_user_message_question_reply>`;
  assert.equal(codexWords(multi), "First choice\n\nSecond choice");

  const malformed = `<send_user_message_question_reply>\n[{broken\n</send_user_message_question_reply>`;
  assert.equal(humanWords(malformed), "");

  // Search indexes extracted answer words without matching wrapper keys or question prompt noise.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "line-reply-find-"));
  const s = new Service({ directory:path.join(root, "state"), agents:{ available:() => [], desktop:() => null, terminal:() => "" }, autoWatch:false });
  fs.mkdirSync(path.join(root, "state"), { recursive:true });
  const p = s.store.create({ name:"Reply", docsPath:path.join(root, "docs") });
  p.follow = false; s.store.save();
  t.after(() => { s.close(); fs.rmSync(root, { recursive:true, force:true }); });
  s.writeDoc(p, "login", F.initialLine({ title:"Login", status:"done", steps:[F.askStep({ words:single, when:"2026-11-14 15:03" })] }));
  s.sync(p);
  const found = find(s.store, s.activity, p, "登陆好了", { state:s.stateOf(p) });
  assert.equal(found.total, 1);
  assert.equal(found.lines[0].hits[0].snippet, "登陆好了");
  assert.equal(find(s.store, s.activity, p, "request_user_input_async", { state:s.stateOf(p) }).total, 0);
});

test("internal agent notifications and interrupt markers are excluded on import while ambient wrappers preserve user words", () => {
  for (const raw of [
    "<side-sessions-event>None of the sessions you started is working now.</side-sessions-event>",
    '<cross-session-message from="local_1">The usage limit that stopped you has reset.</cross-session-message>',
    '<ci-monitor-event>"Auto-fix pull requests" was enabled.</ci-monitor-event>',
    "[Request interrupted by user]",
    "[Request interrupted by user for tool use]",
  ]) {
    assert.equal(humanWords(raw), "");
    assert.deepEqual(claudeLine(JSON.stringify({ type:"user", timestamp:"2026-11-14T10:00:00Z", message:{ content:raw } })).changes, []);
  }

  const ambient = `<in-app-browser-context source="ambient-ui-state">\n# In app browser:\n- Current URL: https://penecho.ai\n</in-app-browser-context>\n\n### My request:\n侧边栏好了`;
  assert.equal(codexWords(ambient), "侧边栏好了");
  assert.equal(F.titleFromText(ambient), "侧边栏好了");

  const artifact = `<artifact-view-context artifact="a1">\n{"page":"Home"}<artifact-content-authored-by-others/>\n</artifact-view-context>\n\nread hand_off.md`;
  assert.equal(humanWords(artifact), "read hand_off.md");
  assert.equal(codexWords(artifact), "read hand_off.md");

  const selfClosing = `<artifact-content-authored-by-others/>\n\nKeep this request`;
  assert.equal(humanWords(selfClosing), "Keep this request");
});

test("UI display unwraps structured replies, fixes self-closing wrapper regex, and skips empty Ask bubbles everywhere", () => {
  const reply = `<send_user_message_question_reply>\n[{"questionItemId":"q1","question":"同意授权？","answer":"登陆好了"}]\n</send_user_message_question_reply>`;
  const line = {
    id:"demo", slug:"demo", title:"Demo", status:"done", topicPath:"topics/demo.md",
    stations:[
      { id:"ask-0", index:0, kind:"ask", state:"done", when:"2026-11-13 10:00", text:"<side-sessions-event>worker idle</side-sessions-event>", files:[], refers:[] },
      { id:"ask-1", index:1, kind:"ask", state:"done", when:"2026-11-14 09:00", via:"Codex desktop", text:reply, files:[], refers:[] },
      { id:"work-1", index:2, kind:"work", agent:"codex", state:"done", out:"First done.", took:"1m", pictures:[], files:[] },
      { id:"ask-2", index:3, kind:"ask", state:"done", when:"2026-11-14 09:05", via:"Claude desktop", text:"[Request interrupted by user for tool use]", files:[], refers:[] },
      { id:"ask-3", index:4, kind:"ask", state:"done", when:"2026-11-14 09:10", text:"<artifact-content-authored-by-others/>\nCheck this screenshot", files:[{ path:"files/pic.png", name:"pic.png", image:true }], refers:[] },
      { id:"ask-4", index:5, kind:"ask", state:"done", when:"2026-11-14 09:15", text:"<cross-session-message>relay</cross-session-message>", files:[], refers:[] },
      { id:"ask-5", index:6, kind:"ask", state:"done", when:"2026-11-14 09:20", text:"", files:[], refers:[{ step:"work-1", label:"Work 1", words:"First done." }] },
      { id:"ask-6", index:7, kind:"ask", state:"done", when:"2026-11-14 09:25", text:"", files:[{ path:"files/pic.png", name:"pic.png", image:true }], refers:[] },
      { id:"ask-7", index:8, kind:"ask", state:"done", when:"2026-11-14 09:30", text:"<ci-monitor-event>ignored</ci-monitor-event>", files:[], refers:[] },
    ],
  };

  const h = lineHarness(line);
  const thread = h.run("threadHTML(p, l)");
  const list = h.run("listHTML(p, l)");

  // Empty/internal Asks produce no bubble, no header, no sidebar item, and no orphan day header.
  assert.doesNotMatch(thread, /item-ask-0|item-ask-2|item-ask-4|item-ask-7/);
  assert.doesNotMatch(thread, /worker idle|Request interrupted|relay|ci-monitor-event/);
  assert.doesNotMatch(list, /data-step="ask-0"|data-step="ask-2"|data-step="ask-4"|data-step="ask-7"|2026-11-13/);
  // When leading and trailing empty Asks are skipped, the first/last rendered sidebar stops inherit `.first` and `.last`.
  assert.match(list, /<div class="lps-day first /);
  assert.match(list, /class="[^"]*\bfirst\b[^"]*"[^>]*data-step="ask-1"/);
  assert.match(list, /class="[^"]*\blast\b[^"]*"[^>]*data-step="ask-6"/);

  // Structured reply renders the actual answer, and self-closing tag does not swallow following words.
  assert.match(thread, /id="item-ask-1"[\s\S]*登陆好了/);
  assert.doesNotMatch(thread, /questionItemId|同意授权/);
  assert.match(thread, /id="item-ask-3"[\s\S]*Check this screenshot/);

  // Quoted-only and picture-only Asks remain visible, while a truly blank Ask produces empty stopWords.
  assert.match(thread, /id="item-ask-5"[\s\S]*Work 1: First done\./);
  assert.doesNotMatch(thread, /id="item-ask-5"[\s\S]*lp-words/);
  assert.match(thread, /id="item-ask-6"[\s\S]*<img src="\/asset\/files\/pic\.png"/);
  assert.equal(h.run("stopWords({ kind:'ask', text:'', files:[] })"), "");
});
