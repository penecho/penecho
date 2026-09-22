  // Live Clay owns scene edits; the normal Canvas owns history, drafts and sharing.
  const playground = { ready:false, open:false, widgetId:null, revision:0, timer:null, controller:null, composing:false, request:null };
  const playgroundCopy = (en,zh) => state.language === "zh" ? zh : en;
  const playgroundTrigger = document.getElementById("playgroundToggle");
  const playgroundTriggerHome=playgroundTrigger?.parentElement;
  const playgroundDock=document.createElement("div");playgroundDock.className="playground-dock";document.body.append(playgroundDock);
  const playgroundPanel = document.createElement("section");
  playgroundPanel.id="playgroundPanel"; playgroundPanel.hidden=true; playgroundPanel.className="playground-panel";
  playgroundPanel.setAttribute("aria-label","Live Clay");
  playgroundPanel.innerHTML=`<header><label for="playgroundPrompt">Live Clay</label><button id="playgroundClose" type="button" data-pe-button="icon" data-pe-density="compact" aria-label="Close / 收起"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 12"/></svg></button></header><textarea id="playgroundPrompt" maxlength="180" rows="2" spellcheck="false"></textarea><footer><span id="playgroundStatus" role="status" aria-live="polite"></span><button id="playgroundRetry" type="button" data-pe-button="ghost" data-pe-density="compact" hidden></button></footer><div class="playground-examples"><button type="button" data-example="小猫在吃鱼" data-pe-button="ghost" data-pe-density="compact">Cat / 小猫</button><button type="button" data-example="地球围绕太阳旋转，月球围绕地球旋转" data-pe-button="ghost" data-pe-density="compact">Orbits / 公转</button><button type="button" data-example="一个红色小球从高处落下，在地面弹跳" data-pe-button="ghost" data-pe-density="compact">Gravity / 重力</button></div>`;
  document.body.append(playgroundPanel);
  const playgroundPrompt=document.getElementById("playgroundPrompt"),playgroundStatus=document.getElementById("playgroundStatus");
  const playgroundHeader=document.createElement("header");playgroundHeader.className="playground-header";playgroundHeader.hidden=true;
  playgroundHeader.innerHTML=`<a href="/" class="playground-brand" aria-label="PenEcho"><img src="${canvasAssetUrl("penecho-mark.png")}" alt=""><span>PenEcho</span></a><nav aria-label="Playground"><button id="playgroundCanvas" type="button" data-pe-button="ghost" data-pe-density="compact"></button><button id="playgroundShare" type="button" data-pe-button="secondary" data-pe-density="compact"></button><button id="playgroundSave" type="button" data-pe-button="primary" data-pe-density="compact"></button></nav>`;document.body.append(playgroundHeader);
  function playgroundLabels(){
    playgroundPrompt.placeholder=playgroundCopy("Describe a little world…","写一句话，让小世界动起来…");
    playgroundPrompt.setAttribute("aria-describedby","playgroundStatus");
    document.getElementById("playgroundRetry").textContent=playgroundCopy("Retry","重试");
    document.getElementById("playgroundCanvas").textContent=playgroundCopy("Canvas tools","画布工具");
    document.getElementById("playgroundShare").textContent=playgroundCopy("Share","分享");
    document.getElementById("playgroundSave").textContent=window.PENECHO_CONFIG?.guestCanvas?playgroundCopy("Sign in & save","登录并保存"):playgroundCopy("Save","保存");
  }
  function playgroundNotice(text,error=false){playgroundStatus.textContent=text;document.getElementById("playgroundRetry").hidden=!error;}
  function playgroundInteract(widget){if(!widget)return;setCanvasMode("select");setWidgetInteraction(widget);setWidgetMaximized(widget,false);}
  function playgroundWidget(){return state.widgets.find(w=>w.id===playground.widgetId&&w.sourceFormat==="penecho-liveclay+json")||state.widgets.find(w=>w.sourceFormat==="penecho-liveclay+json");}
  function playgroundDocument(widget=playgroundWidget()){try{return JSON.parse(widget?.copyText||"null");}catch{return null;}}
  function playgroundHtml(doc){
    const data=JSON.stringify(doc).replace(/</g,"\\u003c");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:system-ui}#liveclay-root{position:absolute;inset:0}#liveclay-status{position:absolute;inset:40% 12%;text-align:center;color:#42483d}nav{position:absolute;right:16px;bottom:16px;display:flex;gap:10px}button{width:44px;height:44px;border:0;border-radius:5px;background:#fffef9;color:#42483d;font:20px system-ui;cursor:pointer}button:focus-visible{outline:2px solid #087f83;outline-offset:2px}.simulation-label{position:absolute;font:14px system-ui;color:#42483d;pointer-events:none}</style></head><body><div id="liveclay-root"></div><p id="liveclay-status">Loading Live Clay…</p><nav aria-label="Playback"><button id="liveclay-pause" aria-label="Pause / 暂停">Ⅱ</button><button id="liveclay-reset" aria-label="Reset view / 恢复视角">↺</button></nav><script id="liveclay-data" type="application/json">${data}</script><script src="https://penecho.ai/canvas/playground/liveclay-v1.js"></script></body></html>`;
  }
  async function playgroundApply(doc){
    let widget=playgroundWidget();
    const html=playgroundHtml(doc);
    if(html.length>MAX_WIDGET_HTML_LENGTH)throw Error(playgroundCopy("This scene is too large to save.","场景过大，无法保存。"));
    if(!widget){
      const rect=view.getBoundingClientRect(),scale=state.scale;
      const w=Math.max(300,Math.round(rect.width*.9)),h=Math.max(200,Math.round(rect.height*.72));
      const result=await importCommunityWidgetArtifact({format:"penecho-widget",formatVersion:1,widget:{pluginId:"general",widgetType:"html_widget",title:"Live Clay",html,sourceFormat:"penecho-liveclay+json",frameworkVersion:"liveclay/1",copyText:JSON.stringify(doc),copyLabel:"Scene JSON",refreshSeconds:0,w:Math.round(w/scale),h:Math.round(h/scale),contentW:w,contentH:h}});
      playground.widgetId=result.id;widget=playgroundWidget();
    } else {
      recordWidgetsBefore();widget.html=html;widget.copyText=JSON.stringify(doc);widget.contentVersion++;widget.snapshotDataUrl="";
      if(widget.hostReady&&widget.initialized)widget.frame?.contentWindow?.postMessage({type:"penecho-liveclay-update",document:doc},widget.hostOrigin||location.origin);
      state.userRevision++;state.autoEligible=false;saveUserCanvasChange();requestRender();
    }
    if(widget&&playground.open)playgroundInteract(widget);
    await window.PenEchoBrowserDraft?.flush();
    return widget;
  }
  async function playgroundGenerate(){
    const text=playgroundPrompt.value.trim(),revision=++playground.revision,documentId=canvasDocumentsCurrent().id;
    playground.controller?.abort();clearTimeout(playground.timer);
    const controller=playground.controller=new AbortController();
    const run=async()=>{
      if(!text){await playgroundApply({version:1,description:"",world:{entities:[],mood:"day",abstract:false}});playgroundNotice(playgroundCopy("Type to shape your world.","输入文字，让世界成形。"));return;}
      playgroundNotice(playgroundCopy("Shaping your world…","正在塑造你的世界…"));
      const response=await fetch("/api/playground/liveclay",{method:"POST",headers:authenticatedApiHeaders({"Content-Type":"application/json"}),body:JSON.stringify({text}),signal:controller.signal});
      const result=await response.json();
      if(!response.ok)throw Error(result.message||result.error||"Live Clay unavailable");
      if(controller.signal.aborted||revision!==playground.revision||documentId!==canvasDocumentsCurrent().id)return;
      await playgroundApply({version:1,description:text,world:result.world});
      playgroundNotice(playgroundCopy("Drag to rotate · Your scene stays on this Canvas","拖动旋转 · 场景会保留在这张画布上"));
    };
    playground.request=run().catch(error=>{if(!controller.signal.aborted&&revision===playground.revision)playgroundNotice(String(error.message||error),true);}).finally(()=>{if(revision===playground.revision)playground.request=null;});
    return playground.request;
  }
  function playgroundInput(){
    clearTimeout(playground.timer);playground.controller?.abort();playground.revision++;
    try{sessionStorage.setItem("penecho-playground-input:"+canvasDocumentsCurrent().id,playgroundPrompt.value);}catch{}
    if(!playground.composing)playground.timer=setTimeout(()=>void playgroundGenerate(),650);
  }
  async function playgroundOpen(){
    playground.closeAnimation?.cancel();playground.open=true;playgroundPanel.hidden=false;playgroundTrigger?.setAttribute("aria-expanded","true");
    if(!document.getElementById("canvasAgentPanel")?.hidden)closeCanvasAgent();
    window.PenEchoStudioNavigator?.setOpen(false);playgroundLabels();
    let widget=playgroundWidget();
    if(!widget)widget=await playgroundApply({version:1,description:"",world:{entities:[],mood:"day",abstract:false}});
    playground.widgetId=widget.id;playgroundPrompt.value=playgroundDocument(widget)?.description||"";
    try{const pending=sessionStorage.getItem("penecho-playground-input:"+canvasDocumentsCurrent().id);if(pending!==null)playgroundPrompt.value=pending;}catch{}
    playgroundInteract(widget);if(document.body.classList.contains("playground-entry"))fit();playgroundNotice(playgroundCopy("Type to shape your world. No Enter needed.","随输入变化，无需回车。"));
  }
  function playgroundClose(){
    playground.open=false;playgroundTrigger?.setAttribute("aria-expanded","false");
    const from=playgroundPanel.getBoundingClientRect(),to=playgroundTrigger?.getBoundingClientRect();
    const finish=()=>{if(playground.open)return;playgroundPanel.hidden=true;if(document.body.classList.contains("playground-entry"))fit();playgroundTrigger?.focus({preventScroll:true});};
    if(to&&!matchMedia("(prefers-reduced-motion: reduce)").matches){
      const animation=playground.closeAnimation=playgroundPanel.animate([{transform:"translateX(-50%)",opacity:1},{transform:`translate(calc(-50% + ${to.x+to.width/2-from.x-from.width/2}px), ${to.y-from.y}px) scale(.12)`,opacity:0}],{duration:230,easing:"cubic-bezier(.2,.7,.2,1)"});
      animation.finished.then(()=>{finish();playgroundTrigger.animate([{transform:"scale(1)"},{transform:"scale(1.12)"},{transform:"scale(1)"}],{duration:220});}).catch(finish);
    }else finish();
  }
  async function playgroundAction(action){
    const button=document.getElementById(action==="share"?"playgroundShare":"playgroundSave");button.disabled=true;
    try{
      if(playground.timer){clearTimeout(playground.timer);playground.timer=null;if(playgroundPrompt.value.trim()!==(playgroundDocument()?.description||""))await playgroundGenerate();}
      await playground.request;
      if(playgroundPrompt.value.trim()!==(playgroundDocument()?.description||""))throw Error(playgroundCopy("Finish generating your scene before saving.","请先完成场景生成，再保存或分享。"));
      await window.PenEchoBrowserDraft?.flush();
      if(window.PENECHO_CONFIG?.guestCanvas){sessionStorage.setItem("penecho-playground-action:"+window.PENECHO_CONFIG.browserDraftId,action);await window.PenEchoBrowserDraft.signIn();return;}
      const id=await saveLiveShareToCloud();
      if(action==="share"){
        document.getElementById("shareCanvasBtn")?.click();
      }else playgroundNotice(playgroundCopy("Saved to your PenEcho space.","已保存到你的 PenEcho 空间。"));
      await window.PenEchoBrowserDraft?.flush();
      return id;
    }catch(error){playgroundNotice(String(error.message||error),false);}finally{button.disabled=false;}
  }
  playgroundPrompt.addEventListener("input",playgroundInput);
  playgroundPrompt.addEventListener("compositionstart",()=>{playground.composing=true;clearTimeout(playground.timer);playground.controller?.abort();playground.revision++;});
  playgroundPrompt.addEventListener("compositionend",()=>{playground.composing=false;playgroundInput();});
  playgroundPanel.querySelectorAll("[data-example]").forEach(button=>button.addEventListener("click",()=>{playgroundPrompt.value=button.dataset.example;playgroundInput();playgroundPrompt.focus();}));
  playgroundTrigger?.addEventListener("click",()=>{if(playground.open)playgroundClose();else void playgroundOpen().catch(error=>playgroundNotice(error.message,true));});
  document.getElementById("playgroundClose").onclick=playgroundClose;
  document.getElementById("playgroundRetry").onclick=()=>void playgroundGenerate();
  document.getElementById("playgroundSave").onclick=()=>void playgroundAction("save");
  document.getElementById("playgroundShare").onclick=()=>void playgroundAction("share");
  document.getElementById("playgroundCanvas").onclick=()=>{document.body.classList.remove("playground-entry");if(playgroundTriggerHome&&playgroundTrigger)playgroundTriggerHome.append(playgroundTrigger);playgroundHeader.hidden=true;playgroundClose();setWidgetInteraction(null);};
  playgroundPanel.addEventListener("keydown",event=>{if(event.key==="Escape"){event.stopPropagation();playgroundClose();}});
  window.addEventListener("penecho:languagechange",playgroundLabels);
  window.PenEchoPlayground={
    async start(){
      if(playground.ready||window.PENECHO_CONFIG?.runtime==="viewer")return;playground.ready=true;
      const entry=window.PENECHO_CONFIG?.playground==="liveclay"||new URLSearchParams(location.search).get("playground")==="liveclay";
      if(!entry)return;
      document.body.classList.add("playground-entry");if(playgroundTrigger)playgroundDock.append(playgroundTrigger);playgroundHeader.hidden=false;
      await playgroundOpen();
      const key="penecho-playground-action:"+window.PENECHO_CONFIG?.browserDraftId,action=sessionStorage.getItem(key);
      if(action&&!window.PENECHO_CONFIG?.guestCanvas){sessionStorage.removeItem(key);await playgroundAction(action);}
    },
    open:playgroundOpen,
  };
