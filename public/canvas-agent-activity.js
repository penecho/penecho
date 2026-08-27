"use strict";

// User-only PenEcho Agent activity. This module deliberately observes the public
// UI projection instead of joining Canvas state, capture, persistence, or tools.
// It performs no network/model request and keeps all text work locally bounded.
// Removal seam: delete this file, its CSS/index/package references, the isolated
// test, and the single "Optional public status" PERSONA line.
(() => {
  const MAX_MODEL_CUES = 2;
  const MAX_DIALOG_NOTES = 4;
  const PHASE_MATCHERS = [
    ["search", /search|research|github|stock|web|搜索|检索|资料|股票/i],
    ["capture", /capture|screenshot|look at|截取|截图|查看画布/i],
    ["inspect", /inspect|structure|检查画布|检查结构/i],
    ["read", /read|读取|阅读/i],
    ["create", /create|build|place|创建|生成|放置/i],
    ["view", /set view|adjust canvas view|frame|viewport|视图|取景/i],
    ["edit", /edit|update|patch|adjust|修改|更新|调整/i],
    ["revert", /revert|undo|撤回|恢复/i],
  ];
  const COPY = {
    en:{
      live:"PenEcho Agent · live", started:"Task started", completed:"Completed", needsRetry:"Needs another try",
      start:["Understanding your request","Following verified Canvas activity"],
      work:["Working across the canvas","Following visible actions without exposing private reasoning"],
      inspect:["Inspecting the canvas","Checking structure, selection, and object layout"],
      read:["Reading canvas content","Looking at the relevant object and its visible content"],
      capture:["Looking at the canvas","Reviewing the current visual state"],
      create:["Building on the canvas","Creating the requested content"],
      edit:["Updating the canvas","Applying a visible change"],
      search:["Researching sources","Gathering information for the task"],
      view:["Adjusting the view","Framing the relevant canvas area"],
      revert:["Reverting a change","Returning the latest Agent change"],
      stop:["Stopping safely","Waiting for the current action to finish"],
      done:["Finished","Leaving the canvas view"],
      error:["Stopped","The activity layer is leaving the canvas"],
      dialog:{
        understand:["Understanding the canvas","First checking the relevant structure and content"],
        research:["Gathering needed information","Collecting external material required for the task"],
        build:["Building the canvas result","Turning confirmed content into a visible result"],
        verify:["Checking the latest result","Verifying that the visible change is complete"],
        recover:["Recovering the latest change","Returning the most recent Agent change"],
        work:["Handling the next step","Following the visible operations needed for the task"],
        running:"{count} actions · working", done:"{count} actions · done", error:"{count} actions · needs attention",
      },
    },
    zh:{
      live:"PenEcho Agent · 实时", started:"任务已开始", completed:"已完成", needsRetry:"需要重试",
      start:["正在理解你的要求","只展示可验证的 Canvas 活动"],
      work:["正在处理画布任务","跟随可见动作，不展示内部推理"],
      inspect:["正在检查画布","确认结构、选择与对象布局"],
      read:["正在读取画布内容","查看相关对象及其可见内容"],
      capture:["正在查看画布","检查当前视觉状态"],
      create:["正在构建画布内容","创建你需要的结果"],
      edit:["正在更新画布","应用一项可见修改"],
      search:["正在查找资料","为任务收集信息"],
      view:["正在调整视图","聚焦相关画布区域"],
      revert:["正在撤回修改","恢复最近一次 Agent 变更"],
      stop:["正在安全停止","等待当前动作结束"],
      done:["已完成","正在从画布上隐去"],
      error:["已停止","动态提示正在离开画布"],
      dialog:{
        understand:["了解画布现状","为了确定处理范围，先查看结构与相关内容"],
        research:["收集所需资料","补充完成任务所需的外部信息"],
        build:["落实画布内容","把已确认的内容转成可见结果"],
        verify:["核对修改结果","检查刚才的修改是否完整"],
        recover:["恢复最近修改","正在处理需要恢复的最近一步"],
        work:["处理下一步","跟随完成任务所需的可见操作"],
        running:"{count} 项操作 · 进行中", done:"{count} 项操作 · 已完成", error:"{count} 项操作 · 有一步未完成",
      },
    },
  };
  function activityLocale(language = "") {
    return String(language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function activityPhaseFromIntent(value) {
    const text = String(value || "").split("·",1)[0].trim();
    return PHASE_MATCHERS.find(([,pattern]) => pattern.test(text))?.[0] || "work";
  }

  function activityDialogPhase(phase, didMutate = false) {
    if (phase === "search") return "research";
    if (["inspect","read","capture","view"].includes(phase)) return didMutate ? "verify" : "understand";
    if (["create","edit"].includes(phase)) return "build";
    if (phase === "revert") return "recover";
    return "work";
  }

  function activitySafeLabel(value, maximum = 54) {
    const text = String(value || "").split("·",1)[0].replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/|file:\/\/)[^\s]+/gi, "").replace(/\s+/g," ").trim();
    return text.length > maximum ? `${text.slice(0,maximum - 1)}…` : text;
  }

  function extractActivityCue(value) {
    const first=String(value||"").slice(0,256).split(/\r?\n/).find(line=>line.trim())?.trim()||"",
      match=/^(Progress\s*:\s*|进展\s*[:：]\s*)(.+)$/i.exec(first);
    if(!match)return "";
    const prefix=match[1].replace(/\s+/g," ");
    return activitySafeLabel(match[2].replace(/^[-*]\s*/,""),Math.max(1,48-prefix.length));
  }

  function activityCueOnly(value) {
    const text=String(value||"").trim();
    return Boolean(extractActivityCue(text))&&text.split(/\r?\n/).filter(line=>line.trim()).length===1;
  }

  function activityPosition(viewRect, panelRect, panelVisible = false) {
    const width=Math.max(1,Number(viewRect?.width)||1),height=Math.max(1,Number(viewRect?.height)||1),margin=18;
    if (!panelVisible || !panelRect) return {x:width/2,y:height/2,compact:width<520||height<300};
    const left=Math.max(0,Math.min(width,(Number(panelRect.left)||0)-(Number(viewRect.left)||0))),
      right=Math.max(left,Math.min(width,(Number(panelRect.right)||0)-(Number(viewRect.left)||0))),
      top=Math.max(0,Math.min(height,(Number(panelRect.top)||0)-(Number(viewRect.top)||0))),
      bottom=Math.max(top,Math.min(height,(Number(panelRect.bottom)||0)-(Number(viewRect.top)||0))),
      spaces=[
        {x0:margin,y0:margin,x1:left-margin,y1:height-margin},
        {x0:right+margin,y0:margin,x1:width-margin,y1:height-margin},
        {x0:margin,y0:margin,x1:width-margin,y1:top-margin},
        {x0:margin,y0:bottom+margin,x1:width-margin,y1:height-margin},
      ].map(space=>({...space,w:space.x1-space.x0,h:space.y1-space.y0})).filter(space=>space.w>80&&space.h>54)
        .sort((a,b)=>((b.w>=390&&b.h>=210?2:1)*b.w*b.h)-((a.w>=390&&a.h>=210?2:1)*a.w*a.h)),
      best=spaces[0]||{x0:margin,y0:margin,x1:width-margin,y1:height-margin,w:width-margin*2,h:height-margin*2};
    return {x:(best.x0+best.x1)/2,y:(best.y0+best.y1)/2,compact:best.w<500||best.h<260};
  }

  function activityPlacement(viewRect, position, panelRect = null, panelVisible = false) {
    const width=Math.max(1,Number(viewRect?.width)||1),height=Math.max(1,Number(viewRect?.height)||1),viewLeft=Number(viewRect?.left)||0,viewTop=Number(viewRect?.top)||0,compact=Boolean(position?.compact),boxW=Math.min(compact?330:500,Math.max(1,width-(compact?20:32))),boxH=Math.min(compact?112:260,height),idealX=Number(position?.x)||width/2,idealY=Number(position?.y)||height/2,candidates=[16,28,40,50,60,72,84];
    const panel=panelVisible&&panelRect?{left:(Number(panelRect.left)||0)-viewLeft-12,top:(Number(panelRect.top)||0)-viewTop-12,right:(Number(panelRect.right)||0)-viewLeft+12,bottom:(Number(panelRect.bottom)||0)-viewTop+12}:null;
    let best=null;
    for(const y of candidates)for(const x of candidates){
      const centerX=width*x/100,centerY=height*y/100,left=centerX-boxW/2,top=centerY-boxH/2,right=left+boxW,bottom=top+boxH,overflow=Math.max(0,-left)*boxH+Math.max(0,right-width)*boxH+Math.max(0,-top)*boxW+Math.max(0,bottom-height)*boxW,overlap=panel?Math.max(0,Math.min(right,panel.right)-Math.max(left,panel.left))*Math.max(0,Math.min(bottom,panel.bottom)-Math.max(top,panel.top)):0,distance=(centerX-idealX)**2+(centerY-idealY)**2,clear=overflow===0&&overlap===0,score=overflow*6+overlap*10+distance;
      if(!best||clear&&!best.clear||clear===best.clear&&score<best.score)best={x,y,clear,score,box:{left,top,right,bottom}};
    }
    return best;
  }

  function activityShouldBeVisible(status, stopHidden, requestPending = false) {
    return Boolean(requestPending) || String(status || "") === "running" || stopHidden === false;
  }

  function activityPresentationVisible(agentRunning, panelHidden, agentFocused) {
    return Boolean(agentRunning) && !panelHidden && Boolean(agentFocused);
  }

  const exported={activityLocale,activityPhaseFromIntent,activityDialogPhase,activitySafeLabel,extractActivityCue,activityCueOnly,activityPosition,activityPlacement,activityShouldBeVisible,activityPresentationVisible};
  if (typeof module !== "undefined" && module.exports) module.exports=exported;
  if (typeof document === "undefined") return;
  if (window.PENECHO_CONFIG?.runtime === "viewer" || window.PENECHO_CONFIG?.canvasAgent === false) return;

  const viewport=document.querySelector("#viewport"), panel=document.querySelector("#canvasAgentPanel"), picker=document.querySelector("#canvasAgentWidgetPickerLayer"),
    transcript=document.querySelector("#canvasAgentTranscript"), stopButton=document.querySelector("#canvasAgentStop"), form=document.querySelector("#canvasAgentForm"),
    input=document.querySelector("#canvasAgentInput"), sendButton=document.querySelector("#canvasAgentSend");
  if (!viewport || !panel || !transcript || !stopButton) return;

  const root=document.createElement("section");
  root.id="canvasAgentActivityOverlay";
  root.className="canvas-agent-activity";
  root.dataset.penechoModelHidden="true";
  root.dataset.html2canvasIgnore="true";
  root.setAttribute("aria-hidden","true");
  root.innerHTML=`
    <div class="canvas-agent-activity-orbit" aria-hidden="true"></div>
    <div class="canvas-agent-activity-core">
      <span class="canvas-agent-activity-kicker"><i></i><span></span></span>
      <strong class="canvas-agent-activity-title"></strong>
      <small class="canvas-agent-activity-detail"></small>
      <div class="canvas-agent-activity-trail"></div>
    </div>`;
  viewport.insertBefore(root,picker||panel);

  const kicker=root.querySelector(".canvas-agent-activity-kicker span"),title=root.querySelector(".canvas-agent-activity-title"),detail=root.querySelector(".canvas-agent-activity-detail"),
    trail=root.querySelector(".canvas-agent-activity-trail"),toolStates=new WeakMap(),
    activity={active:false,requestPending:false,stopping:false,agentFocused:!panel.hidden&&panel.contains(document.activeElement),phase:"start",milestones:[],cueText:"",cueCount:0,cueBodies:new WeakSet(),cueRow:null,cueObserver:null,cueFrame:0,positionFrame:0,dialogDidMutate:false,dialogLastPhase:"",dialogNoteCount:0,dialogCurrent:null,dialogPendingCue:null,dialogGroups:new WeakMap()};

  function language(){return activityLocale(document.documentElement.lang);}
  function copy(){return COPY[language()];}
  function phaseCopy(phase=activity.phase){return copy()[phase]||copy().work;}
  function renderTrail(){
    trail.replaceChildren();
    for(const item of activity.milestones.slice(-3)){
      const entry=document.createElement("span");
      entry.className=`canvas-agent-activity-step ${item.kind||"done"}`;
      entry.textContent=item.text;
      trail.append(entry);
    }
  }
  function renderPhase(){
    const [heading,description]=phaseCopy();
    kicker.textContent=copy().live;
    title.textContent=heading;
    detail.textContent=activity.cueText||description;
    root.dataset.phase=activity.phase;
    renderTrail();
  }
  function addMilestone(text,kind="done"){
    if(!activity.active)return;
    const clean=activitySafeLabel(text,68);
    if(!clean||activity.milestones.at(-1)?.text===clean)return;
    activity.milestones.push({text:clean,kind});
    if(activity.milestones.length>6)activity.milestones.splice(0,activity.milestones.length-6);
    renderTrail();
  }
  function dialogCopy(phase){return copy().dialog[phase]||copy().dialog.work;}
  function dialogMeta(group){
    const rows=group.rows,failed=rows.some(row=>row.classList.contains("error")),running=!group.finished&&rows.some(row=>row.classList.contains("running")),key=failed?"error":running?"running":"done";
    return copy().dialog[key].replace("{count}",String(rows.length));
  }
  function updateDialogGroup(group){
    if(!group)return;
    if(group.meta)group.meta.textContent=dialogMeta(group);
    for(const row of group.rows)activity.dialogGroups.set(row,group);
  }
  function createDialogNote(row,phase){
    if(activity.dialogNoteCount>=MAX_DIALOG_NOTES)return null;
    const note=document.createElement("aside"),dot=document.createElement("i"),text=document.createElement("span"),heading=document.createElement("strong"),reason=document.createElement("small"),meta=document.createElement("em"),[titleText,reasonText]=dialogCopy(phase);
    note.className="canvas-agent-dialog-progress";
    note.dataset.phase=phase;
    note.dataset.penechoModelHidden="true";
    note.dataset.html2canvasIgnore="true";
    note.setAttribute("aria-label",`${titleText}. ${reasonText}`);
    heading.textContent=titleText;reason.textContent=reasonText;meta.className="canvas-agent-dialog-progress-meta";
    text.append(heading,reason);note.append(dot,text,meta);row.before(note);
    activity.dialogNoteCount+=1;
    return {note,meta,rows:[]};
  }
  function dialogToolStarted(row,phase){
    const macro=activityDialogPhase(phase,activity.dialogDidMutate);
    if(macro!==activity.dialogLastPhase){
      activity.dialogLastPhase=macro;
      const cue=activity.dialogPendingCue;
      activity.dialogPendingCue=null;
      activity.dialogCurrent=cue?{note:cue,meta:null,rows:[]}:createDialogNote(row,macro);
    }
    const group=activity.dialogCurrent;
    if(group&&!group.rows.includes(row)){group.rows.push(row);updateDialogGroup(group);}
    if(["create","edit","revert"].includes(phase))activity.dialogDidMutate=true;
  }
  function syncPresentation(){
    const visible=activityPresentationVisible(activity.active,panel.hidden,!panel.hidden&&activity.agentFocused);
    root.classList.toggle("is-suppressed",activity.active&&!visible);
    root.classList.toggle("is-visible",visible);
    if(visible)schedulePosition();
  }
  function startActivity(){
    if(!activity.active){
      activity.active=true;activity.stopping=false;activity.phase="start";activity.milestones=[];activity.cueText="";activity.cueCount=0;activity.cueBodies=new WeakSet();activity.cueRow=null;activity.dialogDidMutate=false;activity.dialogLastPhase="";activity.dialogNoteCount=0;activity.dialogCurrent=null;activity.dialogPendingCue=null;activity.dialogGroups=new WeakMap();
      addMilestone(copy().started,"current");
    }
    renderPhase();
    syncPresentation();
  }
  function finishActivity(failed=false){
    if(!activity.active&&!root.classList.contains("is-visible"))return;
    activity.cueObserver?.disconnect();activity.cueObserver=null;
    activity.active=false;activity.requestPending=false;activity.stopping=false;activity.cueText="";activity.cueRow=null;activity.phase=failed?"error":"done";
    if(activity.dialogCurrent)activity.dialogCurrent.finished=true;
    updateDialogGroup(activity.dialogCurrent);
    renderPhase();
    root.classList.remove("is-suppressed","is-visible");
  }
  function syncAgentState(){
    const status=String(panel.dataset.status||"");
    if(status==="running"||stopButton.hidden===false)activity.requestPending=false;
    else if(status==="error"||status==="offline")activity.requestPending=false;
    const active=activityShouldBeVisible(status,stopButton.hidden,activity.requestPending);
    if(active){const starting=!activity.active;startActivity();if(starting)processToolRows(transcript.querySelectorAll(".canvas-agent-tool.running"));else syncPresentation();}
    else if(activity.active||root.classList.contains("is-visible"))finishActivity(status==="error"||status==="offline");
  }
  function processToolRows(rows){
    if(panel.dataset.historyViewing==="true")return;
    for(const row of rows){
      const next=row.classList.contains("running")?"running":row.classList.contains("error")?"error":"done",previous=toolStates.get(row);
      if(next===previous)continue;
      toolStates.set(row,next);
      if(previous===undefined&&next!=="running")continue;
      const label=activitySafeLabel(row.querySelector(".canvas-agent-tool-intent")?.textContent||"");
      if(next==="running"){
        if(!activityShouldBeVisible(panel.dataset.status,stopButton.hidden,activity.requestPending))continue;
        if(!activity.active)startActivity();
        if(!activity.stopping){activity.phase=activityPhaseFromIntent(label);dialogToolStarted(row,activity.phase);renderPhase();}
      }else if(label){
        addMilestone(`${next==="error"?copy().needsRetry:copy().completed} · ${label}`,next==="error"?"error":"done");
        updateDialogGroup(activity.dialogGroups.get(row));
      }
    }
  }
  function schedulePosition(){
    if(!activity.active&&!root.classList.contains("is-visible"))return;
    if(activity.positionFrame)return;
    activity.positionFrame=requestAnimationFrame(()=>{
      activity.positionFrame=0;
      const viewRect=viewport.getBoundingClientRect(),panelVisible=!panel.hidden,panelRect=panelVisible?panel.getBoundingClientRect():null,position=activityPosition(viewRect,panelRect,panelVisible);
      const placement=activityPlacement(viewRect,position,panelRect,panelVisible);
      root.dataset.placementX=String(placement.x);root.dataset.placementY=String(placement.y);
      root.classList.toggle("is-compact",position.compact);
    });
  }

  function activityToolRowsFromMutations(records){
    const rows=new Set();
    for(const record of records){
      if(record.type==="attributes"&&record.target instanceof Element&&record.target.matches(".canvas-agent-tool"))rows.add(record.target);
      for(const node of record.addedNodes||[]){
        if(!(node instanceof Element))continue;
        if(node.matches(".canvas-agent-tool"))rows.add(node);
        for(const row of node.querySelectorAll(".canvas-agent-tool"))rows.add(row);
      }
    }
    return rows;
  }

  function watchAssistantBody(body){
    if(!activity.active||panel.dataset.historyViewing==="true"||!(body instanceof Element))return;
    activity.cueObserver?.disconnect();
    const inspect=()=>{
      activity.cueFrame=0;
      if(!activity.active||activity.stopping)return;
      const row=body.closest(".canvas-agent-message.assistant");
      if(!assistantRowIsCurrentTurn(row)){
        row?.classList.remove("canvas-agent-public-progress");
        if(activity.dialogPendingCue===row)activity.dialogPendingCue=null;
        if(activity.cueRow===row){activity.cueRow=null;activity.cueText="";renderPhase();}
        return;
      }
      const firstBlock=body.firstElementChild?.textContent||body.firstChild?.textContent||"",cue=extractActivityCue(firstBlock),visibleText=[...body.childNodes].map(node=>node.textContent||"").join("\n"),first=!activity.cueBodies.has(body);
      if(!cue){row?.classList.remove("canvas-agent-public-progress");if(activity.cueRow===row){activity.cueRow=null;activity.cueText="";renderPhase();}return;}
      if(first&&activity.cueCount>=MAX_MODEL_CUES){row?.classList.remove("canvas-agent-public-progress");return;}
      const cueOnly=activityCueOnly(visibleText),styled=cueOnly&&(activity.cueBodies.has(body)&&row?.classList.contains("canvas-agent-public-progress")||activity.dialogNoteCount<MAX_DIALOG_NOTES);
      row?.classList.toggle("canvas-agent-public-progress",Boolean(styled));
      if(first){activity.cueBodies.add(body);activity.cueCount+=1;if(styled)activity.dialogNoteCount+=1;}
      if(activity.cueText===cue)return;
      activity.cueText=cue;activity.cueRow=row;
      activity.dialogPendingCue=row;
      renderPhase();
    };
    activity.cueObserver=new MutationObserver(()=>{
      if(activity.cueFrame)return;
      activity.cueFrame=requestAnimationFrame(inspect);
    });
    activity.cueObserver.observe(body,{subtree:true,childList:true,characterData:true});
    inspect();
  }

  function assistantRowIsCurrentTurn(row){
    if(!(row instanceof Element))return false;
    for(let next=row.nextElementSibling;next;next=next.nextElementSibling)if(next.matches?.(".canvas-agent-message.user"))return false;
    return true;
  }

  function watchAssistantRows(records){
    const assistantRows=[],userRows=[];
    for(const record of records)for(const node of record.addedNodes||[]){
      if(!(node instanceof Element))continue;
      if(node.matches(".canvas-agent-message.user"))userRows.push(node);else userRows.push(...node.querySelectorAll(".canvas-agent-message.user"));
      if(node.matches(".canvas-agent-message.assistant"))assistantRows.push(node);else assistantRows.push(...node.querySelectorAll(".canvas-agent-message.assistant"));
    }
    if(userRows.length){
      activity.cueObserver?.disconnect();activity.cueObserver=null;activity.cueRow?.classList.remove("canvas-agent-public-progress");activity.cueRow=null;activity.cueText="";activity.cueCount=0;activity.cueBodies=new WeakSet();activity.phase="start";activity.dialogDidMutate=false;activity.dialogLastPhase="";activity.dialogNoteCount=0;activity.dialogCurrent=null;activity.dialogPendingCue=null;
      renderPhase();
    }
    for(const row of assistantRows){
      const body=row?.querySelector(".canvas-agent-message-body");
      if(body&&assistantRowIsCurrentTurn(row)){activity.dialogLastPhase="";activity.dialogCurrent=null;activity.dialogPendingCue=null;watchAssistantBody(body);}
    }
  }

  const stateObserver=new MutationObserver(records=>{
    if(records.some(record=>record.attributeName==="data-status"||(record.target===stopButton&&record.attributeName==="hidden")))syncAgentState();
    if(records.some(record=>record.target===panel&&record.attributeName==="hidden"))syncPresentation();
    if(records.some(record=>record.target===panel&&["hidden","class","style"].includes(record.attributeName)))schedulePosition();
  });
  stateObserver.observe(panel,{attributes:true,attributeFilter:["data-status","hidden","class","style"]});
  stateObserver.observe(stopButton,{attributes:true,attributeFilter:["hidden"]});
  new MutationObserver(records=>{
    if(!activity.active||panel.dataset.historyViewing==="true")return;
    watchAssistantRows(records);
    const rows=activityToolRowsFromMutations(records);
    if(rows.size)processToolRows(rows);
  }).observe(transcript,{childList:true});
  new MutationObserver(records=>{
    if(!activity.active||panel.dataset.historyViewing==="true")return;
    const rows=activityToolRowsFromMutations(records);
    if(rows.size)processToolRows(rows);
  }).observe(transcript,{subtree:true,attributes:true,attributeFilter:["class"]});
  form?.addEventListener("submit",()=>{
    queueMicrotask(()=>{
      if(!(input?.disabled||sendButton?.disabled))return;
      activity.agentFocused=true;
      activity.requestPending=!activityShouldBeVisible(panel.dataset.status,stopButton.hidden);
      startActivity();
    });
  });
  stopButton.addEventListener("click",()=>{
    if(!activity.active)return;
    activity.cueObserver?.disconnect();activity.cueObserver=null;activity.stopping=true;activity.cueText="";activity.phase="stop";renderPhase();
  });
  document.addEventListener("pointerdown",event=>{
    if(!activity.active)return;
    activity.agentFocused=!panel.hidden&&event.target instanceof Element&&panel.contains(event.target);
    syncPresentation();
  },true);
  document.addEventListener("focusin",event=>{
    activity.agentFocused=!panel.hidden&&event.target instanceof Element&&panel.contains(event.target);
    if(activity.active)syncPresentation();
  });
  window.addEventListener("penecho:languagechange",()=>{if(activity.active)renderPhase();});
  window.addEventListener("resize",schedulePosition,{passive:true});
  if(typeof ResizeObserver==="function"){
    const resizeObserver=new ResizeObserver(schedulePosition);resizeObserver.observe(viewport);resizeObserver.observe(panel);
  }
  syncAgentState();
  if(activity.active)watchAssistantBody([...transcript.querySelectorAll(".canvas-agent-message.assistant .canvas-agent-message-body")].at(-1));
  schedulePosition();
})();
