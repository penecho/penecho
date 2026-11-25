"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("./helpers/dom.js");
const activity = require("../public/canvas-agent-activity.js");

const ROOT = path.resolve(__dirname,"..");
const read = file => fs.readFileSync(path.join(ROOT,file),"utf8");

test("PenEcho Agent activity derives bounded public labels without exposing paths",()=>{
  assert.equal(activity.activityPhaseFromIntent("Inspect canvas"),"inspect");
  assert.equal(activity.activityPhaseFromIntent("搜索互联网"),"search");
  assert.equal(activity.activityPhaseFromIntent("Update widget · private summary"),"edit");
  assert.equal(activity.activityPhaseFromIntent("截取画布"),"capture");
  assert.equal(activity.activityPhaseFromIntent("调整画布视图"),"view");
  assert.equal(activity.activitySafeLabel("Read /Users/example/private.txt"),"Read");
  assert.equal(activity.extractActivityCue("Progress: Grouping the key milestones"),"Grouping the key milestones");
  assert.equal(activity.extractActivityCue("进展：正在提炼三个关键节点"),"正在提炼三个关键节点");
  assert.equal(activity.extractActivityCue("普通回复，不是定向提示"),"");
  assert.equal(activity.extractActivityCue("普通开场\nProgress: 句中提示不应抓取"),"");
  assert.equal(activity.extractActivityCue("```text\nProgress: code block\n```"),"");
  assert.equal(activity.extractActivityCue("进展：读取 /Users/example/private.txt"),"读取");
  assert.ok(`Progress: ${activity.extractActivityCue(`Progress: ${"long ".repeat(30)}`)}`.length<=48);
});

test("PenEcho Agent activity stays until the engine says the turn has ended",()=>{
  assert.equal(activity.activityShouldBeVisible("running",false),true);
  assert.equal(activity.activityShouldBeVisible("error",true),true,"a turn that can still be stopped has not ended");
  assert.equal(activity.activityShouldBeVisible("ready",false),false);
  assert.equal(activity.activityShouldBeVisible("idle",false),false);
  assert.equal(activity.activityShouldBeVisible("ready"),false);
});

// The page has a Canvas and nothing of the Agent's panel: what the engine says is the only source.
function activityPage() {
  const {document,window}=parseHTML(`<!doctype html><html lang="zh"><body><section class="canvas-frame"><div id="viewport"></div></section></body></html>`);
  window.PENECHO_CONFIG={};
  let frame=0;
  class TestResizeObserver { observe(){} }
  const progress=[];
  window.addEventListener("penecho:agent-progress",event=>progress.push(event.detail));
  vm.runInContext(read("public/canvas-agent-activity.js"),vm.createContext({window,document,module:{exports:{}},Intl,Element:window.Element,ResizeObserver:TestResizeObserver,requestAnimationFrame(callback){const id=++frame;queueMicrotask(callback);return id;},queueMicrotask}),{filename:"canvas-agent-activity.js"});
  const say=(type,detail={})=>window.dispatchEvent(new window.CustomEvent("penecho:agent-activity",{detail:{type,...detail}}));
  return {document,window,progress,say,root:document.querySelector("#canvasAgentActivityOverlay"),detail:()=>document.querySelector("#canvasAgentActivityOverlay .canvas-agent-activity-detail").textContent};
}

test("PenEcho Agent activity needs no Agent panel in the page",()=>{
  const {document,root,say,progress}=activityPage();
  assert.equal(document.querySelector("#canvasAgentPanel"),null);
  assert.equal(root.parentElement,document.querySelector(".canvas-frame"),"the layer sits on the stage outside the clipped viewport");
  assert.equal(root.classList.contains("is-visible"),false);
  say("state",{status:"connecting",running:false});
  assert.equal(root.classList.contains("is-visible"),false,"connecting is not yet a turn");
  say("state",{status:"running",running:true});
  assert.equal(root.classList.contains("is-visible"),true);
  assert.equal(root.querySelector(".canvas-agent-activity-term"),null,"the activity card does not surround itself with guessed prompt keywords");
  assert.equal(progress.at(-1).phase,"start");
  say("state",{status:"error",running:true});
  assert.equal(root.classList.contains("is-visible"),true,"an error status with the turn still running keeps the activity");
  say("stop");
  assert.equal(root.dataset.phase,"stop");
  assert.equal(progress.at(-1).phase,"stop");
  say("state",{status:"ready",running:false});
  assert.equal(root.classList.contains("is-visible"),false,"the node stays mounted while CSS performs the fade");
  assert.equal(root.parentElement,document.querySelector(".canvas-frame"));
  assert.equal(progress.at(-1).phase,"done");
  say("state",{status:"running",running:true});
  say("state",{status:"offline",running:false});
  assert.equal(progress.at(-1).phase,"error","a lost connection ends the activity as stopped");
});

test("PenEcho Agent activity reports each tool as it starts and as it ends",()=>{
  const {say,progress,root}=activityPage();
  say("tool",{callId:"early",state:"running",label:"查看画布"});
  assert.equal(root.classList.contains("is-visible"),false,"a tool heard while no turn is running does not start the activity");
  say("state",{status:"running",running:true});
  say("tool",{callId:"a",state:"running",label:"截取画布 · /Users/example/private.png"});
  assert.equal(root.dataset.phase,"capture");
  assert.deepEqual({label:progress.at(-1).label,phase:progress.at(-1).phase},{label:"截取画布",phase:"capture"},"the card hears the tool's own words, without what follows the dot");
  say("tool",{callId:"a",state:"running",label:"截取画布"});
  const heard=progress.length;
  say("tool",{callId:"a",state:"running",label:"截取画布"});
  assert.equal(progress.length,heard,"the same state said twice is one step");
  say("tool",{callId:"a",state:"done",label:"截取画布"});
  say("tool",{callId:"b",state:"running",label:"创建画布内容"});
  assert.equal(root.dataset.phase,"create");
  say("tool",{callId:"b",state:"error",label:"创建画布内容"});
  assert.deepEqual(Array.from(progress.at(-1).milestones,item=>item.text),["任务已开始","已完成","需要重试"],"a step is named by how it ended; what follows the dot is never shown");
  say("tool",{callId:"never-started",state:"done",label:"修改画布内容"});
  assert.equal(progress.at(-1).milestones.length,3,"a tool that was never heard starting adds nothing");
  say("stop");
  say("tool",{callId:"c",state:"running",label:"搜索互联网"});
  assert.equal(root.dataset.phase,"stop","nothing replaces Stopping once Stop was pressed");
});

test("PenEcho Agent activity shows the model's own Progress line, two a turn",()=>{
  const {say,detail,root}=activityPage();
  say("assistant",{key:"0:0:x",text:"进展：还没有开始"});
  say("state",{status:"running",running:true});
  assert.notEqual(detail(),"还没有开始","what was written before the turn ran is not this turn's progress");
  say("assistant",{key:"1:0:a",text:"进展：正在提炼发布计划的关键节点"});
  assert.equal(detail(),"正在提炼发布计划的关键节点");
  say("assistant",{key:"1:1:b",text:"进展：正在核对时间线层级"});
  say("assistant",{key:"1:2:c",text:"进展：第三条提示不应覆盖"});
  assert.equal(detail(),"正在核对时间线层级","only two model cues are consumed per turn");
  say("assistant",{key:"1:1:b",text:"进展：正在核对时间线层级\n\n## 总结"});
  assert.equal(detail(),"正在核对时间线层级","the same message growing keeps its cue");
  say("assistant",{key:"1:1:b",text:"普通回复"});
  assert.notEqual(detail(),"正在核对时间线层级","a message that stops being a cue is no longer shown as one");
  say("tool",{callId:"s",state:"running",label:"搜索互联网"});
  say("user");
  assert.equal(root.dataset.phase,"start","a steered user turn no longer inherits the previous tool phase");
  say("assistant",{key:"2:0:d",text:"进展：正在核对新一轮布局"});
  assert.equal(detail(),"正在核对新一轮布局","the model cue budget resets for the steered user turn");
  say("stop");
  say("assistant",{key:"2:1:e",text:"进展：停止后不再更新"});
  assert.notEqual(detail(),"停止后不再更新");
});

test("PenEcho Agent activity chooses free Canvas space and compacts around a large panel",()=>{
  const desktop=activity.activityPosition({left:0,top:0,width:1200,height:800},{left:900,top:160,right:1180,bottom:780},true);
  assert.equal(desktop.compact,false);
  assert.ok(desktop.x<700,"desktop activity should sit left of the panel beside the Canvas");
  assert.equal(activity.activityPlacement({left:0,top:0,width:1200,height:800},desktop,{left:900,top:160,right:1180,bottom:780},true).x,40);
  const mobile=activity.activityPosition({left:0,top:0,width:390,height:844},{left:8,top:235,right:382,bottom:836},true);
  assert.equal(mobile.compact,true);
  assert.ok(mobile.y<180,"mobile activity should use the compact space above the panel");
  assert.equal(activity.activityPlacement({left:0,top:0,width:390,height:844},mobile,{left:8,top:235,right:382,bottom:836},true).y,16);
  const narrow=activity.activityPosition({left:0,top:0,width:390,height:844},{left:86,top:0,right:390,bottom:844},true);
  assert.equal(narrow.x,195,"a narrow Canvas strip cannot squeeze the activity beside a docked panel");
  assert.equal(narrow.compact,true);
  const narrowPlacement=activity.activityPlacement({left:0,top:0,width:390,height:844},narrow,{left:86,top:0,right:390,bottom:844},true);
  assert.ok(narrowPlacement.box.left>=0&&narrowPlacement.box.right<=390,"staying on screen takes priority over avoiding a wide Agent panel");
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
  assert.match(source,/stage=viewport\.closest\("\.canvas-frame"\)\|\|viewport/);
  assert.match(source,/stage\.append\(root\)/);
  assert.match(source,/dataset\.penechoModelHidden="true"/);
  assert.match(source,/dataset\.html2canvasIgnore="true"/);
  const baseRule=css.match(/\.canvas-agent-activity\s*\{[\s\S]*?\n\}/)?.[0]||"";
  assert.match(baseRule,/z-index:\s*70;/);
  assert.match(baseRule,/pointer-events:\s*none;/);
  assert.match(baseRule,/visibility:\s*hidden/);
  assert.match(baseRule,/contain:\s*layout style/);
  assert.doesNotMatch(baseRule,/contain:[^;]*\bpaint\b/,"the activity surface must sample the Canvas outside its own paint boundary for real backdrop blur");
  assert.doesNotMatch(css,/\.canvas-agent-activity\.is-visible\s*\{[^}]*will-change/,"the visible wrapper must not create a backdrop root above the frosted card");
  assert.match(css,/radial-gradient\(ellipse 48% 46%[\s\S]*?transparent 82%\)/,"the activity wash fades before its paint boundary");
  assert.doesNotMatch(source,/canvas-agent-activity-ring/,"the activity card has no rotating ellipse that can be paint-clipped");
  assert.doesNotMatch(css,/canvas-agent-activity-ring|canvas-agent-activity-orbit-reverse|@keyframes canvas-agent-activity-orbit\b/);
  assert.match(css,/\.canvas-agent-activity\s*\{[\s\S]*?--canvas-agent-activity-accent:\s*var\(--studio-accent,[^)]+\)[\s\S]*?--canvas-agent-activity-surface:\s*var\(--studio-agent-overlay, rgba\(255,255,255,\.88\)\)[\s\S]*?--canvas-agent-activity-surface-raised:\s*color-mix\(in srgb, var\(--studio-agent-overlay,[\s\S]*?25%, var\(--studio-panel-raised, #f8fafc\) 75%\)/,"the activity card uses the denser Studio Agent overlay surface over Canvas content");
  assert.match(css,/\.canvas-agent-activity-core\s*\{[\s\S]*?background:\s*rgba\(255,255,255,\.88\)[\s\S]*?background:\s*var\(--canvas-agent-activity-surface\)[\s\S]*?box-shadow:\s*0 8px 14px[\s\S]*?-webkit-backdrop-filter:\s*saturate\(1\.08\) blur\(30px\)[\s\S]*?backdrop-filter:\s*saturate\(1\.08\) blur\(30px\)/,"the activity card matches the Studio Agent frost coefficients with a denser overlay surface");
  assert.match(css,/\[data-phase="search"\],[\s\S]*?\[data-phase="create"\],[\s\S]*?\[data-phase="edit"\][\s\S]*?--canvas-agent-activity-accent:\s*var\(--studio-accent,[^)]+\)/,"live request phases inherit the selected Studio accent");
  assert.match(css,/visibility 0s linear \.18s/);
  assert.match(css,/\.canvas-agent-activity:not\(\.is-visible\) \.canvas-agent-activity-kicker > i \{ animation-play-state:\s*paused/);
  const visibleRule=css.match(/\.canvas-agent-activity\.is-visible\s*\{[\s\S]*?\n\}/)?.[0]||"";
  assert.match(visibleRule,/opacity:\s*1;[\s\S]*?visibility:\s*visible/);
  assert.match(visibleRule,/transition:\s*transform \.18s/);
  assert.doesNotMatch(visibleRule,/transition:[^}]*opacity/,"the bounded frosted surface is fully composited on the first visible frame");
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.canvas-agent-activity\.is-visible \{ transition:\s*none;/);
  assert.equal(pkg.files.includes("public/canvas-agent-activity.js"),true);
  assert.equal(pkg.files.includes("public/canvas-agent-activity.css"),true);
  assert.doesNotMatch(source,/extractActivityTerms|phaseTerms|promptTerms/,"the activity layer does not guess or decorate prompt keywords");
  assert.doesNotMatch(source,/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|sendFollowUpMessage|canvasAgentSendEnvelope/,"the activity layer must not call a model or network service");
  assert.doesNotMatch(source,/MutationObserver|canvasAgentTranscript|canvasAgentStop|canvasAgentForm|canvasAgentInput|canvasAgentSend/,"the activity layer hears the engine; it does not watch the Agent's panel");
  assert.match(source,/addEventListener\("penecho:agent-activity"/);
  assert.match(runtime,/new CustomEvent\("penecho:agent-activity"/);
  assert.doesNotMatch(source,/root\.style|setAttribute\(["']style/,"strict CSP positioning stays class/data driven");
  assert.match(serverRuntime,/Public progress: use at most one short task-specific sentence before substantial work[\s\S]*?Add another only for a blocker or material change of approach[\s\S]*?Never expose hidden reasoning, paths, IDs, arguments, or unverified results/);
  assert.doesNotMatch(runtime,/canvasAgentActivityOverlay|penechoModelHidden|canvas-agent-activity/);
  for(const name of ["canvasAgentCapture","canvasAgentAllObjects","canvasAgentDigest","canvasAgentRead"]){
    const start=runtime.indexOf(`function ${name}(`);
    assert.notEqual(start,-1,name);
    assert.doesNotMatch(runtime.slice(start,start+9000),/canvasAgentActivityOverlay|canvas-agent-activity/);
  }
});
