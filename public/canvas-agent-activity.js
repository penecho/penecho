"use strict";

// What the Agent's engine is doing, turned into words a person can follow. The engine
// (src/client/app/canvas-agent-runtime.js) says it in "penecho:agent-activity" events; this
// module only listens. It does not join Canvas state, capture, persistence or tools, makes no
// network or model request, and keeps all text work locally bounded. What it works out goes
// out again as "penecho:agent-progress", which the card of a lasso or a suggestion shows.
// Removal seam: delete this file, its CSS/index/package references, the isolated
// test, and the single "Optional public status" PERSONA line.
(() => {
  const MAX_MODEL_CUES = 2;
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
    },
  };
  function activityLocale(language = "") {
    return String(language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function activityPhaseFromIntent(value) {
    const text = String(value || "").split("·",1)[0].trim();
    return PHASE_MATCHERS.find(([,pattern]) => pattern.test(text))?.[0] || "work";
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
      ].map(space=>({...space,w:space.x1-space.x0,h:space.y1-space.y0})).filter(space=>space.w>=Math.min(330,width-margin*2)&&space.h>=112)
        .sort((a,b)=>((b.w>=390&&b.h>=210?2:1)*b.w*b.h)-((a.w>=390&&a.h>=210?2:1)*a.w*a.h)),
      best=spaces[0]||{x0:margin,y0:margin,x1:width-margin,y1:height-margin,w:width-margin*2,h:height-margin*2};
    return {x:(best.x0+best.x1)/2,y:(best.y0+best.y1)/2,compact:best.w<500||best.h<260};
  }

  function activityPlacement(viewRect, position, panelRect = null, panelVisible = false) {
    const width=Math.max(1,Number(viewRect?.width)||1),height=Math.max(1,Number(viewRect?.height)||1),viewLeft=Number(viewRect?.left)||0,viewTop=Number(viewRect?.top)||0,compact=Boolean(position?.compact),boxW=Math.min(compact?330:500,Math.max(1,width-(compact?20:32))),boxH=Math.min(compact?112:260,height),idealX=Number(position?.x)||width/2,idealY=Number(position?.y)||height/2,candidates=[16,28,40,50,60,72,84];
    const panel=panelVisible&&panelRect?{left:(Number(panelRect.left)||0)-viewLeft-12,top:(Number(panelRect.top)||0)-viewTop-12,right:(Number(panelRect.right)||0)-viewLeft+12,bottom:(Number(panelRect.bottom)||0)-viewTop+12}:null;
    let best=null;
    // Keep the card on screen even when the panel leaves no unobscured space.
    for(const y of candidates)for(const x of candidates){
      const centerX=width*x/100,centerY=height*y/100,left=centerX-boxW/2,top=centerY-boxH/2,right=left+boxW,bottom=top+boxH,overflow=Math.max(0,-left)*boxH+Math.max(0,right-width)*boxH+Math.max(0,-top)*boxW+Math.max(0,bottom-height)*boxW,overlap=panel?Math.max(0,Math.min(right,panel.right)-Math.max(left,panel.left))*Math.max(0,Math.min(bottom,panel.bottom)-Math.max(top,panel.top)):0,distance=(centerX-idealX)**2+(centerY-idealY)**2,fits=overflow===0,clear=fits&&overlap===0,score=overflow*6+overlap*10+distance;
      if(!best||fits&&!best.fits||fits===best.fits&&(clear&&!best.clear||clear===best.clear&&score<best.score))best={x,y,fits,clear,score,box:{left,top,right,bottom}};
    }
    return best;
  }

  // A turn that can still be stopped has not ended, whatever its status says.
  function activityShouldBeVisible(status, running = false) {
    return String(status || "") === "running" || running === true;
  }

  const exported={activityLocale,activityPhaseFromIntent,activitySafeLabel,extractActivityCue,activityPosition,activityPlacement,activityShouldBeVisible};
  if (typeof module !== "undefined" && module.exports) module.exports=exported;
  if (typeof document === "undefined") return;
  if (window.PENECHO_CONFIG?.runtime === "viewer" || window.PENECHO_CONFIG?.canvasAgent === false) return;

  const viewport=document.querySelector("#viewport");
  if (!viewport) return;
  // The stage the Canvas shares with a panel beside it, so the card stays whole and above either.
  const stage=viewport.closest(".canvas-frame")||viewport,
    besidePanel=()=>document.querySelector("#projectLinesPanel:not([hidden])");

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
  stage.append(root);

  const kicker=root.querySelector(".canvas-agent-activity-kicker span"),title=root.querySelector(".canvas-agent-activity-title"),detail=root.querySelector(".canvas-agent-activity-detail"),
    trail=root.querySelector(".canvas-agent-activity-trail"),
    activity={active:false,status:"",running:false,stopping:false,phase:"start",milestones:[],tools:new Map(),cueText:"",cueCount:0,cueKeys:new Set(),cueKey:"",positionFrame:0};

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
  function tellProgress(detail){
    window.dispatchEvent(new window.CustomEvent("penecho:agent-progress",{detail}));
  }
  function renderPhase(){
    const [heading,description]=phaseCopy();
    kicker.textContent=copy().live;
    title.textContent=heading;
    detail.textContent=activity.cueText||description;
    root.dataset.phase=activity.phase;
    renderTrail();
    tellProgress({heading,label:activity.cueText||description,milestones:activity.milestones,phase:activity.phase});
  }
  function addMilestone(text,kind="done"){
    if(!activity.active)return;
    const clean=activitySafeLabel(text,68);
    if(!clean||activity.milestones.at(-1)?.text===clean)return;
    activity.milestones.push({text:clean,kind});
    if(activity.milestones.length>6)activity.milestones.splice(0,activity.milestones.length-6);
    renderTrail();
  }
  function resetCues(){
    activity.cueText="";activity.cueCount=0;activity.cueKeys=new Set();activity.cueKey="";
  }
  function startActivity(){
    if(!activity.active){
      activity.active=true;activity.stopping=false;activity.phase="start";activity.milestones=[];resetCues();
      addMilestone(copy().started,"current");
    }
    renderPhase();
    root.classList.add("is-visible");
    schedulePosition();
  }
  function finishActivity(failed=false){
    if(!activity.active&&!root.classList.contains("is-visible"))return;
    activity.active=false;activity.stopping=false;activity.cueText="";activity.cueKey="";activity.phase=failed?"error":"done";
    renderPhase();
    root.classList.remove("is-visible");
  }
  // The engine's own word on whether a turn is running.
  function agentState({status,running}){
    activity.status=String(status||"");activity.running=running===true;
    if(activityShouldBeVisible(activity.status,activity.running))startActivity();
    else if(activity.active||root.classList.contains("is-visible"))finishActivity(activity.status==="error"||activity.status==="offline");
  }
  // One tool call, when it starts and when it ends.
  function agentTool({callId,state,label}){
    const key=String(callId||""),next=state==="running"?"running":state==="error"?"error":"done",previous=activity.tools.get(key);
    if(next===previous)return;
    activity.tools.set(key,next);
    if(activity.tools.size>200)activity.tools.delete(activity.tools.keys().next().value);
    if(previous===undefined&&next!=="running")return;
    const text=activitySafeLabel(label);
    if(next==="running"){
      if(!activityShouldBeVisible(activity.status,activity.running))return;
      if(!activity.active)startActivity();
      if(!activity.stopping){activity.phase=activityPhaseFromIntent(text);renderPhase();tellProgress({label:text,milestones:activity.milestones,phase:activity.phase});}
    }else if(text)addMilestone(`${next==="error"?copy().needsRetry:copy().completed} · ${text}`,next==="error"?"error":"done");
  }
  // What the model has written so far in one message. A first line "Progress: …" is its own word on what it is doing.
  function agentAssistant({key,text}){
    if(!activity.active||activity.stopping)return;
    const id=String(key||""),cue=extractActivityCue(text),first=!activity.cueKeys.has(id);
    if(!cue){
      if(activity.cueKey===id){activity.cueKey="";activity.cueText="";renderPhase();}
      return;
    }
    if(first&&activity.cueCount>=MAX_MODEL_CUES)return;
    if(first){activity.cueKeys.add(id);activity.cueCount+=1;}
    if(activity.cueText===cue)return;
    activity.cueText=cue;activity.cueKey=id;
    renderPhase();
  }
  function schedulePosition(){
    if(!activity.active&&!root.classList.contains("is-visible"))return;
    if(activity.positionFrame)return;
    activity.positionFrame=requestAnimationFrame(()=>{
      activity.positionFrame=0;
      const viewRect=stage.getBoundingClientRect(),panel=besidePanel(),panelVisible=Boolean(panel),panelRect=panel?panel.getBoundingClientRect():null,position=activityPosition(viewRect,panelRect,panelVisible);
      const placement=activityPlacement(viewRect,position,panelRect,panelVisible);
      root.dataset.placementX=String(placement.x);root.dataset.placementY=String(placement.y);
      root.classList.toggle("is-compact",position.compact);
    });
  }

  window.addEventListener("penecho:agent-activity",event=>{
    const said=event.detail||{};
    if(said.type==="state")agentState(said);
    else if(said.type==="tool")agentTool(said);
    else if(said.type==="assistant")agentAssistant(said);
    else if(said.type==="user"){
      // A new message from the person starts the count of the model's own progress lines again.
      if(!activity.active)return;
      resetCues();activity.phase="start";
      renderPhase();
    }else if(said.type==="stop"){
      if(!activity.active)return;
      activity.stopping=true;activity.cueText="";activity.cueKey="";activity.phase="stop";renderPhase();
    }
  });
  window.addEventListener("penecho:languagechange",()=>{if(activity.active)renderPhase();});
  window.addEventListener("resize",schedulePosition,{passive:true});
  if(typeof ResizeObserver==="function"){
    const resizeObserver=new ResizeObserver(schedulePosition);resizeObserver.observe(stage);resizeObserver.observe(viewport);
  }
})();
