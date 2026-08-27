"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const activity = require("../public/canvas-agent-activity.js");

const ROOT = path.resolve(__dirname,"..");
const read = file => fs.readFileSync(path.join(ROOT,file),"utf8");

test("PenEcho Agent activity derives bounded public labels without exposing paths",()=>{
  assert.equal(activity.activityPhaseFromIntent("Inspect canvas"),"inspect");
  assert.equal(activity.activityPhaseFromIntent("搜索互联网"),"search");
  assert.equal(activity.activityPhaseFromIntent("Update widget · private summary"),"edit");
  assert.equal(activity.activityPhaseFromIntent("截取画布"),"capture");
  assert.equal(activity.activityPhaseFromIntent("调整画布视图"),"view");
  assert.equal(activity.activityDialogPhase("capture",false),"understand");
  assert.equal(activity.activityDialogPhase("capture",true),"verify");
  assert.equal(activity.activitySafeLabel("Read /Users/example/private.txt"),"Read");
  assert.equal(activity.extractActivityCue("Progress: Grouping the key milestones"),"Grouping the key milestones");
  assert.equal(activity.extractActivityCue("进展：正在提炼三个关键节点"),"正在提炼三个关键节点");
  assert.equal(activity.extractActivityCue("普通回复，不是定向提示"),"");
  assert.equal(activity.extractActivityCue("普通开场\nProgress: 句中提示不应抓取"),"");
  assert.equal(activity.extractActivityCue("```text\nProgress: code block\n```"),"");
  assert.equal(activity.extractActivityCue("进展：读取 /Users/example/private.txt"),"读取");
  assert.equal(activity.activityCueOnly("进展：正在查看画布"),true);
  assert.equal(activity.activityCueOnly("进展：正在查看画布\n\n## 总结"),false);
  assert.ok(`Progress: ${activity.extractActivityCue(`Progress: ${"long ".repeat(30)}`)}`.length<=48);
});

test("PenEcho Agent activity keeps cancellation visible until the authoritative stop",()=>{
  assert.equal(activity.activityShouldBeVisible("ready",true,true),true,"a submitted request is visible before turn_start");
  assert.equal(activity.activityShouldBeVisible("running",true),true);
  assert.equal(activity.activityShouldBeVisible("error",false),true,"an active Stop control means the turn has not ended");
  assert.equal(activity.activityShouldBeVisible("ready",true),false);
  assert.equal(activity.activityShouldBeVisible("idle",true),false);
  assert.equal(activity.activityPresentationVisible(true,false,true),true);
  assert.equal(activity.activityPresentationVisible(true,true,true),false,"a minimized Agent suppresses the user-only overlay");
  assert.equal(activity.activityPresentationVisible(true,false,false),false,"canvas focus suppresses the user-only overlay");
});

test("PenEcho Agent activity appears on submit and fades only after the running state ends",async()=>{
  const {document,window}=parseHTML(`<!doctype html><html lang="zh"><body><div id="viewport"><div id="canvasAgentWidgetPickerLayer"></div><aside id="canvasAgentPanel" data-status="ready"><div id="canvasAgentTranscript"></div><form id="canvasAgentForm"><textarea id="canvasAgentInput"></textarea><button id="canvasAgentSend" type="submit">Send</button></form><button id="canvasAgentStop" hidden>Stop</button></aside></div></body></html>`);
  const form=document.querySelector("#canvasAgentForm"),input=document.querySelector("#canvasAgentInput"),send=document.querySelector("#canvasAgentSend"),stop=document.querySelector("#canvasAgentStop"),panel=document.querySelector("#canvasAgentPanel"),transcript=document.querySelector("#canvasAgentTranscript"),viewport=document.querySelector("#viewport"),picker=document.querySelector("#canvasAgentWidgetPickerLayer");
  form.addEventListener("submit",event=>{event.preventDefault();input.disabled=true;send.disabled=true;});
  window.PENECHO_CONFIG={};
  let frame=0;
  class TestResizeObserver { observe(){} }
  const context=vm.createContext({window,document,module:{exports:{}},Intl,Element:window.Element,MutationObserver:window.MutationObserver,ResizeObserver:TestResizeObserver,requestAnimationFrame(callback){const id=++frame;queueMicrotask(callback);return id;},queueMicrotask});
  vm.runInContext(read("public/canvas-agent-activity.js"),context,{filename:"canvas-agent-activity.js"});
  const root=document.querySelector("#canvasAgentActivityOverlay");
  assert.equal(root.parentElement,viewport);
  assert.equal(root.nextElementSibling,picker);
  assert.equal(root.classList.contains("is-visible"),false);

  input.value="整理这张画布的发布计划";
  form.dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(root.classList.contains("is-visible"),true);
  assert.equal(root.querySelector(".canvas-agent-activity-term"),null,"the activity card does not surround itself with guessed prompt keywords");
  const assistant=document.createElement("article"),body=document.createElement("div");
  assistant.className="canvas-agent-message assistant";body.className="canvas-agent-message-body";body.textContent="进展：正在提炼发布计划的关键节点";assistant.append(body);transcript.append(assistant);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(root.querySelector(".canvas-agent-activity-detail").textContent,"正在提炼发布计划的关键节点");
  const cueRows=[];
  for(const cue of ["进展：正在核对时间线层级","进展：第三条提示不应覆盖"]){
    const row=document.createElement("article"),cueBody=document.createElement("div");
    row.className="canvas-agent-message assistant";cueBody.className="canvas-agent-message-body";cueBody.textContent=cue;row.append(cueBody);transcript.append(row);
    cueRows.push(row);
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(root.querySelector(".canvas-agent-activity-detail").textContent,"正在核对时间线层级","only two model cues are consumed per turn");
  assert.equal(cueRows[1].classList.contains("canvas-agent-public-progress"),false,"a third cue is neither consumed nor styled as another progress note");

  panel.dataset.status="running";
  stop.hidden=false;
  await new Promise(resolve=>setImmediate(resolve));
  viewport.dispatchEvent(new window.Event("pointerdown",{bubbles:true}));
  assert.equal(root.classList.contains("is-visible"),false,"clicking the canvas suppresses the overlay without stopping the turn");
  assert.equal(root.classList.contains("is-suppressed"),true);
  input.dispatchEvent(new window.Event("focusin",{bubbles:true}));
  assert.equal(root.classList.contains("is-visible"),true,"refocusing the Agent restores a still-running activity");
  panel.hidden=true;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(root.classList.contains("is-visible"),false,"minimizing the Agent suppresses the overlay");
  panel.hidden=false;
  input.dispatchEvent(new window.Event("focusin",{bubbles:true}));
  assert.equal(root.classList.contains("is-visible"),true);
  stop.dispatchEvent(new window.Event("click",{bubbles:true}));
  assert.equal(root.dataset.phase,"stop");

  stop.hidden=true;
  panel.dataset.status="ready";
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(root.classList.contains("is-visible"),false,"the node stays mounted while CSS performs the fade");
  assert.equal(root.parentElement,viewport);
});

test("PenEcho Agent dialog adds one bounded local explanation per observable tool phase",async()=>{
  const {document,window}=parseHTML(`<!doctype html><html lang="zh"><body><div id="viewport"><div id="canvasAgentWidgetPickerLayer"></div><aside id="canvasAgentPanel" data-status="ready"><div id="canvasAgentTranscript"></div><form id="canvasAgentForm"><textarea id="canvasAgentInput"></textarea><button id="canvasAgentSend" type="submit">Send</button></form><button id="canvasAgentStop" hidden>Stop</button></aside></div></body></html>`);
  const panel=document.querySelector("#canvasAgentPanel"),transcript=document.querySelector("#canvasAgentTranscript"),form=document.querySelector("#canvasAgentForm"),input=document.querySelector("#canvasAgentInput"),send=document.querySelector("#canvasAgentSend"),stop=document.querySelector("#canvasAgentStop");
  form.addEventListener("submit",event=>{event.preventDefault();input.disabled=true;send.disabled=true;});
  window.PENECHO_CONFIG={};
  let frame=0;
  class TestResizeObserver { observe(){} }
  const context=vm.createContext({window,document,module:{exports:{}},Intl,Element:window.Element,MutationObserver:window.MutationObserver,ResizeObserver:TestResizeObserver,requestAnimationFrame(callback){const id=++frame;queueMicrotask(callback);return id;},queueMicrotask});
  vm.runInContext(read("public/canvas-agent-activity.js"),context,{filename:"canvas-agent-activity.js"});
  input.value="整理并核对这张画布";
  form.dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));
  panel.dataset.status="running";stop.hidden=false;
  await new Promise(resolve=>setImmediate(resolve));
  const addTool=label=>{
    const row=document.createElement("details"),intent=document.createElement("span");
    row.className="canvas-agent-tool running";intent.className="canvas-agent-tool-intent";intent.textContent=label;row.append(intent);transcript.append(row);return row;
  };
  const inspect=addTool("查看画布"),capture=addTool("截取画布");
  await new Promise(resolve=>setImmediate(resolve));
  let notes=[...transcript.querySelectorAll(".canvas-agent-dialog-progress")];
  assert.equal(notes.length,1,"repeated understanding tools share one explanation");
  assert.equal(notes[0].dataset.phase,"understand");
  assert.match(notes[0].querySelector(".canvas-agent-dialog-progress-meta").textContent,/2 项操作/);
  assert.equal(inspect.parentElement,transcript,"tool rows remain in their canonical DOM positions");
  assert.equal(notes[0].dataset.penechoModelHidden,"true");
  assert.equal(notes[0].dataset.html2canvasIgnore,"true");
  inspect.classList.remove("running");capture.classList.remove("running");
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(notes[0].querySelector(".canvas-agent-dialog-progress-meta").textContent,/已完成/);
  addTool("创建画布内容");addTool("修改画布内容");
  await new Promise(resolve=>setImmediate(resolve));
  addTool("截取画布");
  await new Promise(resolve=>setImmediate(resolve));
  notes=[...transcript.querySelectorAll(".canvas-agent-dialog-progress")];
  assert.deepEqual(notes.map(note=>note.dataset.phase),["understand","build","verify"]);
  addTool("搜索互联网");addTool("撤回 Agent 修改");addTool("使用画布工具");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(transcript.querySelectorAll(".canvas-agent-dialog-progress").length,4,"local explanations stay bounded per turn");
  panel.dataset.historyViewing="true";addTool("查看画布");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(transcript.querySelectorAll(".canvas-agent-dialog-progress").length,4,"history-view tool rows never pollute the live activity timeline");
});

test("PenEcho Agent dialog reuses a fresh public Progress cue instead of duplicating it",async()=>{
  const {document,window}=parseHTML(`<!doctype html><html lang="zh"><body><div id="viewport"><div id="canvasAgentWidgetPickerLayer"></div><aside id="canvasAgentPanel" data-status="ready"><div id="canvasAgentTranscript"></div><form id="canvasAgentForm"><textarea id="canvasAgentInput"></textarea><button id="canvasAgentSend" type="submit">Send</button></form><button id="canvasAgentStop" hidden>Stop</button></aside></div></body></html>`);
  const panel=document.querySelector("#canvasAgentPanel"),transcript=document.querySelector("#canvasAgentTranscript"),form=document.querySelector("#canvasAgentForm"),input=document.querySelector("#canvasAgentInput"),send=document.querySelector("#canvasAgentSend"),stop=document.querySelector("#canvasAgentStop");
  form.addEventListener("submit",event=>{event.preventDefault();input.disabled=true;send.disabled=true;});window.PENECHO_CONFIG={};
  let frame=0;class TestResizeObserver { observe(){} }
  vm.runInContext(read("public/canvas-agent-activity.js"),vm.createContext({window,document,module:{exports:{}},Intl,Element:window.Element,MutationObserver:window.MutationObserver,ResizeObserver:TestResizeObserver,requestAnimationFrame(callback){const id=++frame;queueMicrotask(callback);return id;},queueMicrotask}),{filename:"canvas-agent-activity.js"});
  form.dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));panel.dataset.status="running";stop.hidden=false;
  const cue=document.createElement("article"),body=document.createElement("div"),tool=document.createElement("details"),intent=document.createElement("span");
  cue.className="canvas-agent-message assistant";body.className="canvas-agent-message-body";body.textContent="进展：先确认画布的结构与范围";cue.append(body);
  tool.className="canvas-agent-tool running";intent.className="canvas-agent-tool-intent";intent.textContent="查看画布";tool.append(intent);
  transcript.append(cue,tool);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cue.classList.contains("canvas-agent-public-progress"),true);
  assert.equal(transcript.querySelector(".canvas-agent-dialog-progress"),null,"the local fallback is suppressed when the model already supplied a bounded public cue");
  const ordinary=document.createElement("article"),ordinaryBody=document.createElement("div"),search=document.createElement("details"),searchIntent=document.createElement("span");
  ordinary.className="canvas-agent-message assistant";ordinaryBody.className="canvas-agent-message-body";ordinaryBody.textContent="我会继续处理。";ordinary.append(ordinaryBody);
  search.className="canvas-agent-tool running";searchIntent.className="canvas-agent-tool-intent";searchIntent.textContent="搜索互联网";search.append(searchIntent);transcript.append(ordinary,search);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(transcript.querySelectorAll(".canvas-agent-dialog-progress").length,1,"an ordinary assistant message expires the previous cue before the next phase");
  const steer=document.createElement("article"),steerBody=document.createElement("div");
  steer.className="canvas-agent-message user";steerBody.className="canvas-agent-message-body";steerBody.textContent="继续重点核对布局";steer.append(steerBody);transcript.append(steer);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cue.classList.contains("canvas-agent-public-progress"),false,"a new steer expires the prior turn cue");
  assert.equal(document.querySelector("#canvasAgentActivityOverlay").dataset.phase,"start","a steered user turn no longer inherits the previous tool phase");
  search.classList.remove("running");
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(transcript.querySelector(".canvas-agent-dialog-progress-meta").textContent,/已完成/,"a pre-steer running tool can still finish its original dialog group");
  body.textContent="进展：旧提示后续更新不应覆盖";
  await new Promise(resolve=>setImmediate(resolve));
  assert.notEqual(document.querySelector("#canvasAgentActivityOverlay .canvas-agent-activity-detail").textContent,"旧提示后续更新不应覆盖");
  const freshCue=document.createElement("article"),freshBody=document.createElement("div");
  freshCue.className="canvas-agent-message assistant";freshBody.className="canvas-agent-message-body";freshBody.textContent="进展：正在核对新一轮布局";freshCue.append(freshBody);transcript.append(freshCue);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(freshCue.classList.contains("canvas-agent-public-progress"),true,"the model cue budget resets for the steered user turn");
  assert.equal(document.querySelector("#canvasAgentActivityOverlay .canvas-agent-activity-detail").textContent,"正在核对新一轮布局");
  const oldUser=document.createElement("article"),oldCue=document.createElement("article"),oldCueBody=document.createElement("div"),latestUser=document.createElement("article");
  oldUser.className=latestUser.className="canvas-agent-message user";oldUser.textContent="较早的一轮";latestUser.textContent="当前一轮";
  oldCue.className="canvas-agent-message assistant";oldCueBody.className="canvas-agent-message-body";oldCueBody.textContent="进展：旧会话中的提示";oldCue.append(oldCueBody);
  panel.dataset.historyViewing="false";transcript.replaceChildren(oldUser,oldCue,latestUser);
  await new Promise(resolve=>setImmediate(resolve));
  assert.notEqual(document.querySelector("#canvasAgentActivityOverlay .canvas-agent-activity-detail").textContent,"旧会话中的提示","re-rendered cues before the latest user turn never overwrite the live activity");
  assert.equal(oldCue.classList.contains("canvas-agent-public-progress"),false);
});

test("PenEcho Agent activity chooses free Canvas space and compacts around a large panel",()=>{
  const desktop=activity.activityPosition({left:0,top:0,width:1200,height:800},{left:900,top:160,right:1180,bottom:780},true);
  assert.equal(desktop.compact,false);
  assert.ok(desktop.x<700,"desktop activity should sit left of the Agent panel");
  assert.equal(activity.activityPlacement({left:0,top:0,width:1200,height:800},desktop,{left:900,top:160,right:1180,bottom:780},true).x,40);
  const mobile=activity.activityPosition({left:0,top:0,width:390,height:844},{left:8,top:235,right:382,bottom:836},true);
  assert.equal(mobile.compact,true);
  assert.ok(mobile.y<180,"mobile activity should use the compact space above the panel");
  assert.equal(activity.activityPlacement({left:0,top:0,width:390,height:844},mobile,{left:8,top:235,right:382,bottom:836},true).y,16);
  const centerPanel={left:408,top:248,right:768,bottom:568},centerPosition=activity.activityPosition({left:0,top:0,width:1200,height:800},centerPanel,true),centerPlacement=activity.activityPlacement({left:0,top:0,width:1200,height:800},centerPosition,centerPanel,true),box=centerPlacement.box;
  assert.equal(Math.max(0,Math.min(box.right,centerPanel.right)-Math.max(box.left,centerPanel.left))*Math.max(0,Math.min(box.bottom,centerPanel.bottom)-Math.max(box.top,centerPanel.top)),0,"CSP-safe candidates still avoid a centrally dragged Agent panel");
  for(const [view,panel] of [[{left:0,top:0,width:1200,height:800},{left:264,top:72,right:864,bottom:572}],[{left:0,top:0,width:800,height:600},{left:72,top:72,right:432,bottom:392}]]){
    const position=activity.activityPosition(view,panel,true),placement=activity.activityPlacement(view,position,panel,true),candidate=placement.box,overlap=Math.max(0,Math.min(candidate.right,panel.right)-Math.max(candidate.left,panel.left))*Math.max(0,Math.min(candidate.bottom,panel.bottom)-Math.max(candidate.top,panel.top));
    assert.equal(overlap,0,"a clear candidate wins over a closer panel-overlapping candidate");
    assert.ok(candidate.left>=0&&candidate.top>=0&&candidate.right<=view.width&&candidate.bottom<=view.height,"a clear candidate remains inside the viewport");
  }
});

test("PenEcho Agent activity is a removable user-only sibling outside capture and object state",()=>{
  const html=read("public/index.html"),css=read("public/canvas-agent-activity.css"),source=read("public/canvas-agent-activity.js"),runtime=read("src/client/app/canvas-agent-runtime.js"),serverRuntime=read("src/server/canvas-agent/runtime.mjs"),pkg=require("../package.json");
  assert.match(html,/<link rel="stylesheet" href="canvas-agent-activity\.css">/);
  assert.match(html,/<script src="app\.js"><\/script>[\s\S]*?<script src="canvas-agent-activity\.js"><\/script>/);
  assert.match(source,/viewport\.insertBefore\(root,picker\|\|panel\)/);
  assert.match(source,/dataset\.penechoModelHidden="true"/);
  assert.match(source,/dataset\.html2canvasIgnore="true"/);
  const baseRule=css.match(/\.canvas-agent-activity\s*\{[\s\S]*?\n\}/)?.[0]||"";
  assert.match(baseRule,/z-index:\s*40;/);
  assert.match(baseRule,/pointer-events:\s*none;/);
  assert.match(baseRule,/visibility:\s*hidden/);
  assert.match(baseRule,/contain:\s*layout paint style/);
  assert.match(css,/radial-gradient\(ellipse 48% 46%[\s\S]*?transparent 82%\)/,"the activity wash fades before its paint boundary");
  assert.doesNotMatch(source,/canvas-agent-activity-ring/,"the activity card has no rotating ellipse that can be paint-clipped");
  assert.doesNotMatch(css,/canvas-agent-activity-ring|canvas-agent-activity-orbit-reverse|@keyframes canvas-agent-activity-orbit\b/);
  assert.match(css,/\.canvas-agent-activity-core\s*\{[\s\S]*?box-shadow:\s*0 8px 24px rgba\(15,23,42,\.08\)/,"the card shadow stays inside the contained activity box");
  assert.match(css,/visibility 0s linear \.72s/);
  assert.match(css,/\.canvas-agent-activity:not\(\.is-visible\) \.canvas-agent-activity-kicker > i \{ animation-play-state:\s*paused/);
  assert.match(css,/\.canvas-agent-activity\.is-visible\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?visibility:\s*visible/);
  assert.equal(pkg.files.includes("public/canvas-agent-activity.js"),true);
  assert.equal(pkg.files.includes("public/canvas-agent-activity.css"),true);
  assert.doesNotMatch(source,/extractActivityTerms|phaseTerms|promptTerms/,"the activity layer does not guess or decorate prompt keywords");
  assert.doesNotMatch(source,/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|sendFollowUpMessage|canvasAgentSendEnvelope/,"the activity layer must not call a model or network service");
  assert.doesNotMatch(source,/root\.style|setAttribute\(["']style/,"strict CSP positioning stays class/data driven");
  assert.match(serverRuntime,/Optional public status:[\s\S]*?at most twice per user turn[\s\S]*?Never expose hidden reasoning, paths, IDs, arguments, or unverified results/);
  assert.doesNotMatch(runtime,/canvasAgentActivityOverlay|penechoModelHidden|canvas-agent-activity/);
  for(const name of ["canvasAgentCapture","canvasAgentAllObjects","canvasAgentDigest","canvasAgentRead"]){
    const start=runtime.indexOf(`function ${name}(`);
    assert.notEqual(start,-1,name);
    assert.doesNotMatch(runtime.slice(start,start+9000),/canvasAgentActivityOverlay|canvas-agent-activity/);
  }
});
