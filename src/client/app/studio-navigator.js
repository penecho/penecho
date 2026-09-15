// Studio-only navigator for recent Agent conversations and saved canvases.
  {
    const STUDIO_NAVIGATOR_TAB_KEY = "penecho-studio-navigator-tab",
      STUDIO_EDGE_SWIPE_START_PX = 28,
      STUDIO_EDGE_SWIPE_COMMIT_PX = 56,
      STUDIO_EDGE_SWIPE_CANCEL_PX = 36,
      STUDIO_EDGE_SWIPE_DIRECTION_RATIO = 1.25,
      STUDIO_NAVIGATOR_SETTLE_FALLBACK_MS = 320,
      studioNavigatorToggle = document.querySelector("#studioNavigatorToggle"),
      studioNavigator = document.querySelector("#studioNavigator"),
      studioNavigatorClose = document.querySelector("#studioNavigatorClose"),
      studioNavigatorScrim = document.querySelector("#studioNavigatorScrim"),
      studioNavigatorSearch = document.querySelector("#studioNavigatorSearch"),
      studioNavigatorAllTab = document.querySelector("#studioNavigatorAllTab"),
      studioNavigatorMcpTab = document.querySelector("#studioNavigatorMcpTab"),
      studioNavigatorMcpPanel = document.querySelector("#studioNavigatorMcpPanel"),
      studioMcpRecentList = document.querySelector("#studioMcpRecentList"),
      studioNavigatorAgentTab = document.querySelector("#studioNavigatorAgentTab"),
      studioNavigatorCanvasTab = document.querySelector("#studioNavigatorCanvasTab"),
      studioNavigatorAllPanel = document.querySelector("#studioNavigatorAllPanel"),
      studioNavigatorAgentPanel = document.querySelector("#studioNavigatorAgentPanel"),
      studioNavigatorCanvasPanel = document.querySelector("#studioNavigatorCanvasPanel"),
      studioWorkRecentList = document.querySelector("#studioWorkRecentList"),
      studioAgentRecentList = document.querySelector("#studioAgentRecentList"),
      studioCanvasRecentList = document.querySelector("#studioCanvasRecentList"),
      studioNavigatorManage = document.querySelector("#studioNavigatorManage"),
      studioSessionDeleteDialog = document.querySelector("#studioSessionDeleteDialog"),
      studioSessionDeleteDescription = document.querySelector("#studioSessionDeleteDescription"),
      studioSessionDeleteCancel = document.querySelector("#studioSessionDeleteCancel"),
      studioSessionDeleteConfirm = document.querySelector("#studioSessionDeleteConfirm"),
      canvasDocumentMeta = document.querySelector("#canvasDocumentMeta"),
      canvasDocumentName = document.querySelector("#canvasDocumentName"),
      canvasDocumentNameLabel = document.querySelector("#canvasDocumentNameLabel"),
      canvasDocumentNameEditor = document.querySelector("#canvasDocumentNameEditor"),
      canvasDocumentNameInput = document.querySelector("#canvasDocumentNameInput"),
      canvasDocumentNameConfirm = document.querySelector("#canvasDocumentNameConfirm"),
      canvasDocumentSaveState = document.querySelector("#canvasDocumentSaveState"),
      canvasDocumentSaveLabel = document.querySelector("#canvasDocumentSaveLabel"),
      saveCanvasLabel = document.querySelector("#saveCanvasLabel"),
      canvasWelcome = document.querySelector("#canvasWelcome"),
      studioNavigatorCompactMedia = window.matchMedia?.("(max-width: 1100px)");
    let studioNavigatorOpenPreference = false,
      studioNavigatorMcpEnabled = false,
      studioNavigatorActiveTab = storedStudioNavigatorTab(),
      studioNavigatorWorkPreviewUrls = new Map(),
      studioNavigatorAgentPreviewUrls = new Map(),
      studioNavigatorCanvasPreviewUrls = new Map(),
      studioNavigatorCanvasGroupSnapshots = new Map(),
      studioNavigatorCanvasGroupSnapshotLoads = new Map(),
      studioNavigatorCanvasGroupSnapshotRetryAt = new Map(),
      studioNavigatorDraftSnapshot = {canvasKey:"",revision:-1,item:null,request:null,retryAt:0},
      studioNavigatorSourceStates = new Map(["device","server","cloud"].map((location)=>[location,{location,status:"idle",items:[],error:"",signIn:false,loadedAt:0,request:null}])),
      studioNavigatorPendingConversation = null,
      studioNavigatorSuspendedAgent = false,
      studioNavigatorRestoreAgentAfterManager = false,
      studioSessionDeletePending = null,
      canvasDocumentRenameActive = false,
      canvasDocumentRenameCommitting = false,
      studioNavigatorTransitionHandler = null,
      studioNavigatorOpenTimer = 0,
      studioNavigatorHistoryDirty = true,
      studioEdgeSwipe = null;

    function storedStudioNavigatorTab() {
      try {
        const stored=localStorage.getItem(STUDIO_NAVIGATOR_TAB_KEY);
        return ["all","canvas","agent"].includes(stored)?stored:"all";
      }
      catch { return "all"; }
    }
    function studioNavigatorIsCompact() {
      return Boolean(studioNavigatorCompactMedia?.matches);
    }
    function studioNavigatorIsStudio() {
      return state.theme === "studio";
    }
    function studioNavigatorIsOpen() {
      return studioNavigatorIsStudio() && document.body.classList.contains("studio-navigator-open");
    }
    function studioNavigatorIsMcpDocked() {
      return studioNavigatorIsOpen() && studioNavigatorActiveTab === "mcp" && studioNavigatorMcpEnabled;
    }
    function studioCanvasHasContent() {
      return Boolean(tiles.size || state.images.length || state.textBoxes.length || state.preservedSnapshotAnimations.length || (pluginEnabled("animation") && state.animations.length) || visibleWidgets().length);
    }
    function updateStudioDocumentState() {
      const active = studioNavigatorIsStudio(), saved = Boolean(state.currentSnapshotId), edited = saved && (canvasHasUnsavedChanges() || Boolean(state.currentCanvasSuggestedName)),
        stateKey = snapshotSaveInProgress ? "saving" : !saved ? "unsaved" : edited ? "edited" : "saved",
        documentName = currentCanvasDisplayName() || t("canvasUntitledName"),
        copyKey = {
          unsaved:"canvasSaveStateUnsaved",
          saved:"canvasSaveStateSaved",
          edited:"canvasSaveStateEdited",
          saving:"canvasSaveStateSaving",
        }[stateKey];
      canvasDocumentMeta.hidden = !active;
      canvasDocumentNameLabel.textContent = documentName;
      canvasDocumentName.title = t("canvasRenameNamed").replace("{name}", documentName);
      canvasDocumentName.setAttribute("aria-label", t("canvasRenameNamed").replace("{name}", documentName));
      canvasDocumentNameInput.disabled = snapshotSaveInProgress;
      canvasDocumentNameInput.setAttribute("aria-busy", String(snapshotSaveInProgress));
      canvasDocumentNameConfirm.disabled = snapshotSaveInProgress;
      canvasDocumentNameConfirm.setAttribute("aria-busy", String(snapshotSaveInProgress));
      canvasDocumentSaveState.dataset.state = stateKey;
      canvasDocumentSaveLabel.textContent = t(copyKey);
      saveCanvasLabel.textContent = t(snapshotSaveInProgress ? "snapshotSavingShort" : "saveCurrentSnapshot");
      canvasWelcome.hidden = !active || state.viewMode || studioCanvasHasContent();
    }
    function finishCanvasDocumentRename({ focus = false } = {}) {
      canvasDocumentRenameActive = false;
      canvasDocumentRenameCommitting = false;
      canvasDocumentNameEditor.hidden = true;
      canvasDocumentNameInput.hidden = true;
      canvasDocumentNameInput.disabled = false;
      canvasDocumentNameConfirm.disabled = false;
      canvasDocumentNameInput.setCustomValidity("");
      canvasDocumentName.hidden = false;
      updateStudioDocumentState();
      if (focus) canvasDocumentName.focus({ preventScroll:true });
    }
    function beginCanvasDocumentRename() {
      if (!studioNavigatorIsStudio() || state.viewMode || snapshotSaveInProgress || canvasDocumentRenameActive) return;
      canvasDocumentRenameActive = true;
      canvasDocumentNameInput.value = currentCanvasDisplayName() || "";
      canvasDocumentNameInput.setCustomValidity("");
      canvasDocumentName.hidden = true;
      canvasDocumentNameEditor.hidden = false;
      canvasDocumentNameInput.hidden = false;
      canvasDocumentNameInput.focus({ preventScroll:true });
      canvasDocumentNameInput.select();
    }
    async function commitCanvasDocumentRename() {
      if (!canvasDocumentRenameActive || canvasDocumentRenameCommitting) return;
      const name = canvasDocumentNameInput.value.trim().slice(0, 48);
      if (!name) {
        canvasDocumentNameInput.setCustomValidity(t("canvasNameRequired"));
        canvasDocumentNameInput.reportValidity();
        canvasDocumentNameInput.focus({ preventScroll:true });
        return;
      }
      if (name === currentCanvasDisplayName()) {
        finishCanvasDocumentRename();
        return;
      }
      canvasDocumentRenameCommitting = true;
      canvasDocumentNameInput.disabled = true;
      canvasDocumentNameConfirm.disabled = true;
      const saved = await renameCurrentCanvasFromTitle(name);
      if (saved) finishCanvasDocumentRename();
      else {
        canvasDocumentRenameCommitting = false;
        canvasDocumentNameInput.disabled = false;
        canvasDocumentNameConfirm.disabled = false;
        canvasDocumentNameInput.focus({ preventScroll:true });
        canvasDocumentNameInput.select();
      }
    }
    function updateStudioNavigatorSurfaceInert() {
      const blocked = studioNavigatorIsStudio() && studioNavigatorIsOpen() && studioNavigatorIsCompact() && !studioNavigatorIsMcpDocked() && !state.viewMode;
      if (blocked && !view.hasAttribute("inert")) {
        view.inert = true;
        view.dataset.studioNavigatorInert = "true";
      } else if (!blocked && view.dataset.studioNavigatorInert === "true") {
        view.inert = false;
        delete view.dataset.studioNavigatorInert;
      }
    }
    function updateStudioNavigatorA11y({ deferSurface = false } = {}) {
      const active = studioNavigatorIsStudio(), open = active && studioNavigatorIsOpen(), unavailable = !active || !open || state.viewMode;
      document.body.classList.toggle("studio-mcp-docked",studioNavigatorIsMcpDocked());
      studioNavigatorToggle.hidden = !active;
      studioNavigator.hidden = !active;
      if (!deferSurface) {
        studioNavigator.inert = unavailable;
        studioNavigator.setAttribute("aria-hidden", String(unavailable));
      }
      studioNavigatorToggle.setAttribute("aria-expanded", String(open));
      studioNavigatorToggle.classList.toggle("active", open);
      const toggleKey = open ? "studioNavigatorClose" : "studioNavigatorOpen";
      studioNavigatorToggle.setAttribute("aria-label", t(toggleKey));
      studioNavigatorToggle.setAttribute("title", t(toggleKey));
      studioNavigatorScrim.hidden = !(active && open && studioNavigatorIsCompact() && !studioNavigatorIsMcpDocked() && !state.viewMode);
      if (!deferSurface) updateStudioNavigatorSurfaceInert();
    }
    function suspendStudioAgentForNavigator() {
      if (!studioNavigatorIsCompact() || canvasAgentPanel.hidden || !document.body.classList.contains("canvas-agent-open")) return false;
      studioNavigatorSuspendedAgent = true;
      closeCanvasAgent({ focus:false });
      return true;
    }
    function restoreStudioAgentAfterNavigator() {
      if (!studioNavigatorSuspendedAgent) return false;
      studioNavigatorSuspendedAgent = false;
      openCanvasAgent({ focus:false, connect:false, animate:false });
      return true;
    }
    function cancelStudioNavigatorOpenWork() {
      if (studioNavigatorTransitionHandler) studioNavigator.removeEventListener("transitionend", studioNavigatorTransitionHandler);
      if (studioNavigatorOpenTimer) clearTimeout(studioNavigatorOpenTimer);
      studioNavigatorTransitionHandler = null;
      studioNavigatorOpenTimer = 0;
    }
    function scheduleStudioNavigatorOpenWork(open, options) {
      const restoreAgent = options?.restoreAgent !== false;
      cancelStudioNavigatorOpenWork();
      const settle = () => {
        cancelStudioNavigatorOpenWork();
        if (studioNavigatorIsOpen() !== Boolean(open)) return;
        updateStudioNavigatorA11y();
        if (open) {
          renderStudioNavigator();
          void refreshStudioNavigatorSources();
        } else {
          releaseStudioNavigatorPreviewUrls(studioNavigatorWorkPreviewUrls);
          releaseStudioNavigatorPreviewUrls(studioNavigatorAgentPreviewUrls);
          releaseStudioNavigatorPreviewUrls(studioNavigatorCanvasPreviewUrls);
          if (restoreAgent) restoreStudioAgentAfterNavigator();
        }
      };
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !studioNavigatorIsStudio()) {
        settle();
        return;
      }
      studioNavigatorTransitionHandler = event => {
        const property = studioNavigatorIsMcpDocked() ? "opacity" : "transform";
        if (event.target === studioNavigator && event.propertyName === property) settle();
      };
      studioNavigator.addEventListener("transitionend", studioNavigatorTransitionHandler);
      studioNavigatorOpenTimer = setTimeout(settle, STUDIO_NAVIGATOR_SETTLE_FALLBACK_MS);
    }
    function setStudioNavigatorOpen(open, { restoreAgent = true } = {}) {
      studioNavigatorOpenPreference = Boolean(open);
      if (open) restoreCanvasChromeMaterial();
      document.body.classList.toggle("studio-navigator-open", studioNavigatorIsStudio() && studioNavigatorOpenPreference);
      updateStudioNavigatorA11y({ deferSurface:studioNavigatorIsStudio() });
      if (!open && studioNavigator.contains(document.activeElement)) studioNavigatorToggle.focus({ preventScroll:true });
      if (open) suspendStudioAgentForNavigator();
      scheduleStudioNavigatorOpenWork(open, { restoreAgent });
    }
    function syncStudioNavigatorTheme(theme = state.theme) {
      const active = theme === "studio", wasActive = document.body.classList.contains("studio-navigator-enabled");
      document.body.classList.toggle("studio-navigator-enabled", active);
      document.body.classList.toggle("studio-navigator-open", active && studioNavigatorOpenPreference);
      updateStudioNavigatorA11y();
      updateStudioDocumentState();
      if (active && !wasActive) renderStudioNavigator();
    }
    function setStudioNavigatorCanvasView(enabled) {
      if (enabled && studioNavigator.contains(document.activeElement)) document.activeElement.blur();
      updateStudioNavigatorA11y();
      updateStudioDocumentState();
    }
    function studioNavigatorSearchQuery() {
      return String(studioNavigatorSearch.value || "").trim().toLocaleLowerCase(state.language === "zh" ? "zh-CN" : "en");
    }
    function studioNavigatorEmpty(list, key, role = "status") {
      const empty = document.createElement("div");
      empty.className = "studio-navigator-empty";
      empty.setAttribute("role", role);
      empty.textContent = t(key);
      list.replaceChildren(empty);
    }
    function studioNavigatorMetaTime(value) {
      return canvasAgentHistoryTime(Number(value) || Date.now());
    }
    function studioNavigatorCanvasMeta(current, open, location, updatedAt) {
      return [current ? t("studioNavigatorCurrent") : open ? t("studioNavigatorOpened") : t("studioNavigatorNotOpened"),
        location ? snapshotLocationLabel(location) : "", studioNavigatorMetaTime(updatedAt)].filter(Boolean).join(" · ");
    }
    function studioNavigatorRenderCanvasMeta(meta, current, open, location, updatedAt) {
      const label = studioNavigatorCanvasMeta(current, open, location, updatedAt);
      meta.title = label;
      meta.setAttribute("aria-label", label);
      // Selection, unread content, and save order are independent states.
      meta.textContent = [current ? t("studioNavigatorCurrent") : "", location ? snapshotLocationLabel(location) : "", studioNavigatorMetaTime(updatedAt)].filter(Boolean).join(" · ");
    }
    function syncStudioNavigatorCurrentSource() {
      const location=String(snapshotItemsLocation||"");
      if(!studioNavigatorSourceStates.has(location))return;
      const source=studioNavigatorSourceStates.get(location);
      source.items=snapshotItems.slice();
      source.status=snapshotListInProgress?"loading":"ready";
      source.error="";
      source.signIn=location==="cloud"&&cloudHistorySignInRequired;
      source.loadedAt=Date.now();
    }
    async function refreshStudioNavigatorSource(location,{force=false}={}) {
      const source=studioNavigatorSourceStates.get(location);
      if(!source)return false;
      syncStudioNavigatorCurrentSource();
      if(source.request)return source.request;
      if(!force&&source.status==="ready"&&Date.now()-source.loadedAt<30_000)return true;
      source.status="loading";
      source.error="";
      source.signIn=false;
      renderActiveStudioNavigatorHistory();
      const request=snapshotsAt(location).then((items)=>{
        source.items=items.slice();
        source.status="ready";
        source.loadedAt=Date.now();
        return true;
      }).catch((error)=>{
        source.status="error";
        source.error=String(error?.message||error);
        source.signIn=location==="cloud"&&cloudHistoryRequiresSignIn(error);
        return false;
      }).finally(()=>{
        source.request=null;
        renderActiveStudioNavigatorHistory();
      });
      source.request=request;
      return request;
    }
    function refreshStudioNavigatorSources({force=false}={}) {
      for(const location of studioNavigatorSourceStates.keys())void refreshStudioNavigatorSource(location,{force});
    }
    function studioNavigatorSnapshots() {
      syncStudioNavigatorCurrentSource();
      return [...studioNavigatorSourceStates.values()].flatMap((source)=>source.items.map((item)=>{
        studioNavigatorCanvasGroupSnapshots.set(`${source.location}:${item.id}`,item);
        return {...item,location:source.location};
      }));
    }
    function renderStudioNavigatorSourceStates(list,query) {
      if(query)return;
      for(const source of studioNavigatorSourceStates.values()){
        if(source.status!=="loading"&&source.status!=="error")continue;
        const control=document.createElement("button"),label=document.createElement("strong"),detail=document.createElement("small");
        control.type="button";
        peChoice(control);
        control.className="studio-navigator-source-state";
        control.dataset.tone=source.signIn?"signin":source.status;
        label.textContent=snapshotLocationLabel(source.location);
        detail.textContent=source.signIn?t("snapshotCloudSignInRequired"):t(source.status==="loading"?"snapshotLibraryLoading":"snapshotLibraryLoadFailed").replace("{location}",snapshotLocationLabel(source.location));
        control.append(label,detail);
        if(source.signIn)control.addEventListener("click",()=>document.querySelector("#cloudAccountBtn")?.click());
        else if(source.status==="error")control.addEventListener("click",()=>void refreshStudioNavigatorSource(source.location,{force:true}));
        else control.disabled=true;
        list.append(control);
      }
    }
    function studioNavigatorConversationSummary(conversation) {
      const item=[...(conversation?.items||[])].reverse().find((entry)=>entry?.type==="message"&&["user","assistant"].includes(entry.role)&&String(entry.text||"").trim());
      return String(item?.text||"").replace(/\s+/g," ").trim().slice(0,96);
    }
    function closeStudioNavigatorAfterCompactAction() {
      if (studioNavigatorIsCompact() && !studioNavigatorIsMcpDocked()) setStudioNavigatorOpen(false);
    }
    function collapseStudioNavigatorForWorkspaceFocus(event) {
      if (!studioNavigatorIsOpen() || studioNavigatorIsMcpDocked()) return false;
      const target=event?.target;
      if (target && (studioNavigator.contains(target) || studioNavigatorToggle.contains(target))) return false;
      setStudioNavigatorOpen(false);
      return true;
    }
    function studioNavigatorCanvasIdentity(canvasKey) {
      const match=/^(device|server|cloud):(.+)$/.exec(String(canvasKey||""));
      return match?{location:match[1],id:match[2]}:null;
    }
    function studioNavigatorCanvasGroupSnapshot(group) {
      const canvasKey=String(group?.canvasKey||"");
      if(canvasKey.startsWith("draft:"))return canvasKey===state.canvasAgentCanvasKey&&studioNavigatorDraftSnapshot.canvasKey===canvasKey&&studioNavigatorDraftSnapshot.revision===state.userRevision?studioNavigatorDraftSnapshot.item:null;
      const identity=studioNavigatorCanvasIdentity(group?.canvasKey);
      if(!identity)return null;
      const key=`${identity.location}:${identity.id}`;
      if(snapshotItemsLocation===identity.location){
        const item=snapshotItems.find(candidate=>candidate.id===identity.id)||null;
        if(item){studioNavigatorCanvasGroupSnapshots.set(key,item);studioNavigatorCanvasGroupSnapshotRetryAt.delete(key);}
        else studioNavigatorCanvasGroupSnapshots.delete(key);
        return item;
      }
      return studioNavigatorCanvasGroupSnapshots.get(key)||null;
    }
    async function studioNavigatorLoadDraftSnapshot(request) {
      try{
        const preview=await snapshotPreviewBlob();
        if(request===studioNavigatorDraftSnapshot.request&&request.canvasKey===state.canvasAgentCanvasKey&&request.revision===state.userRevision){
          studioNavigatorDraftSnapshot.canvasKey=request.canvasKey;
          studioNavigatorDraftSnapshot.revision=request.revision;
          studioNavigatorDraftSnapshot.item={id:request.canvasKey,preview};
          studioNavigatorDraftSnapshot.retryAt=0;
        }
      }catch{
        if(request===studioNavigatorDraftSnapshot.request)studioNavigatorDraftSnapshot.retryAt=Date.now()+30_000;
      }finally{
        if(request===studioNavigatorDraftSnapshot.request)studioNavigatorDraftSnapshot.request=null;
        if(studioNavigatorIsStudio())studioNavigatorActiveTab==="agent"?renderStudioAgentHistory():studioNavigatorActiveTab==="all"&&renderStudioWorkHistory();
      }
    }
    function studioNavigatorQueueDraftSnapshot(group) {
      const canvasKey=String(group?.canvasKey||""),revision=state.userRevision,current=studioNavigatorDraftSnapshot.request;
      if(!canvasKey.startsWith("draft:")||canvasKey!==state.canvasAgentCanvasKey||studioNavigatorCanvasGroupSnapshot(group))return;
      if(studioNavigatorDraftSnapshot.retryAt>Date.now())return;
      if(current?.canvasKey===canvasKey&&current.revision===revision)return;
      const request={canvasKey,revision};
      studioNavigatorDraftSnapshot.request=request;
      void studioNavigatorLoadDraftSnapshot(request);
    }
    async function studioNavigatorLoadCanvasGroupSnapshots(location,request) {
      try{
        const items=snapshotItemsLocation===location?snapshotItems:await snapshotsAt(location),byId=new Map(items.map(item=>[item.id,item]));
        for(const [id,key] of request.ids){
          const item=byId.get(id)||null;
          if(item){studioNavigatorCanvasGroupSnapshots.set(key,item);studioNavigatorCanvasGroupSnapshotRetryAt.delete(key);}
          else{studioNavigatorCanvasGroupSnapshots.delete(key);studioNavigatorCanvasGroupSnapshotRetryAt.set(key,Date.now()+30_000);}
        }
      }catch{
        for(const key of request.ids.values())studioNavigatorCanvasGroupSnapshotRetryAt.set(key,Date.now()+30_000);
      }finally{
        studioNavigatorCanvasGroupSnapshotLoads.delete(location);
        if(studioNavigatorIsStudio())studioNavigatorActiveTab==="agent"?renderStudioAgentHistory():studioNavigatorActiveTab==="all"&&renderStudioWorkHistory();
      }
    }
    function studioNavigatorQueueCanvasGroupSnapshots(groups) {
      const now=Date.now(),byLocation=new Map();
      for(const group of groups){
        const identity=studioNavigatorCanvasIdentity(group.canvasKey),key=identity?`${identity.location}:${identity.id}`:"";
        if(!identity){studioNavigatorQueueDraftSnapshot(group);continue;}
        if(studioNavigatorCanvasGroupSnapshot(group)||studioNavigatorCanvasGroupSnapshotRetryAt.get(key)>now)continue;
        if(state.snapshotLocation===identity.location&&snapshotListInProgress)continue;
        if(!byLocation.has(identity.location))byLocation.set(identity.location,new Map());
        byLocation.get(identity.location).set(identity.id,key);
      }
      for(const [location,ids] of byLocation){
        const pending=studioNavigatorCanvasGroupSnapshotLoads.get(location);
        if(pending){for(const [id,key] of ids)pending.ids.set(id,key);continue;}
        const request={ids};
        studioNavigatorCanvasGroupSnapshotLoads.set(location,request);
        void studioNavigatorLoadCanvasGroupSnapshots(location,request);
      }
    }
    function studioNavigatorCanvasGroupName(group) {
      if(group.canvasKey===state.canvasAgentCanvasKey)return currentCanvasDisplayName()||t("canvasUntitledName");
      const metadata=studioNavigatorCanvasGroupSnapshot(group);
      return group.name||(metadata?snapshotName(metadata):t("studioNavigatorUnknownCanvas"));
    }
    function studioNavigatorWorkGroups() {
      const histories=new Map(canvasAgentStoredHistoryGroups().map((group)=>[group.canvasKey,group])),groups=new Map();
      for(const item of studioNavigatorSnapshots()){
        const canvasKey=`${item.location}:${item.id}`,history=histories.get(canvasKey);
        groups.set(canvasKey,{canvasKey,location:item.location,item,name:snapshotName(item),savedAt:Number(item.updatedAt||item.createdAt)||0,firstSeenAt:Number(item.createdAt)||0,updatedAt:Math.max(Number(item.updatedAt||item.createdAt)||0,Number(history?.updatedAt)||0),conversations:history?.conversations||[]});
        histories.delete(canvasKey);
      }
      for(const history of histories.values()){
        if(history.canvasKey.startsWith("draft:")&&history.canvasKey!==state.canvasAgentCanvasKey)continue;
        const identity=studioNavigatorCanvasIdentity(history.canvasKey),item=studioNavigatorCanvasGroupSnapshot(history);
        groups.set(history.canvasKey,{...history,location:identity?.location||"",item,name:studioNavigatorCanvasGroupName(history),savedAt:Number(item?.updatedAt||item?.createdAt)||0});
      }
      if(state.canvasAgentCanvasKey&&!groups.has(state.canvasAgentCanvasKey)){
        const identity=studioNavigatorCanvasIdentity(state.canvasAgentCanvasKey),item=studioNavigatorCanvasGroupSnapshot({canvasKey:state.canvasAgentCanvasKey});
        groups.set(state.canvasAgentCanvasKey,{canvasKey:state.canvasAgentCanvasKey,location:identity?.location||"",item,name:currentCanvasDisplayName()||t("canvasUntitledName"),savedAt:Number(item?.updatedAt||item?.createdAt)||0,updatedAt:Number(item?.updatedAt||item?.createdAt)||Date.now(),conversations:canvasAgentHistoryForCanvas(state.canvasAgentCanvasKey)});
      }
      if(typeof canvasDocuments!=="undefined")for(const [index,doc] of [...canvasDocuments.records.values()].entries()){
        const current=doc.id===canvasDocuments.activeId,
          canvasKey=doc.locator?`${doc.locator.location}:${doc.locator.id}`:current&&state.canvasAgentCanvasKey||`workspace:${doc.id}`,
          previous=groups.get(canvasKey),item=previous?.item||doc.stored?.item||null;
        groups.set(canvasKey,{...previous,canvasKey,documentId:doc.id,location:doc.locator?.location||"",item,
          name:doc.title||t("canvasUntitledName"),firstSeenAt:Number(doc.firstSeenAt)||index+1,savedAt:Math.max(Number(doc.savedAt)||0,Number(previous?.savedAt)||0),updatedAt:Math.max(Number(previous?.updatedAt)||0,Number(item?.updatedAt||item?.createdAt)||0,...(doc.changes||[]).map(change=>Number(change.at)||0)),
          conversations:previous?.conversations||[],current,unseen:doc.unseen>0});
      }
      return [...groups.values()].map((group)=>({...group,current:group.documentId?group.current:group.canvasKey===state.canvasAgentCanvasKey})).sort((a,b)=>(b.savedAt||b.firstSeenAt||0)-(a.savedAt||a.firstSeenAt||0)||String(a.documentId||a.canvasKey).localeCompare(String(b.documentId||b.canvasKey)));
    }
    function studioNavigatorGroupMatches(group,query) {
      if(!query)return true;
      const haystack=[group.name,group.location?snapshotLocationLabel(group.location):"",...group.conversations.flatMap((conversation)=>[conversation.title,studioNavigatorConversationSummary(conversation)])].filter(Boolean).join(" ").toLocaleLowerCase(state.language==="zh"?"zh-CN":"en");
      return haystack.includes(query);
    }
    function studioNavigatorSectionLabel(key) {
      const label=document.createElement("h3");
      label.className="studio-navigator-section-label";
      label.textContent=t(key);
      return label;
    }
    function studioNavigatorConversationEntry(group,conversation) {
      const entry=document.createElement("div"),row=document.createElement("button"),remove=document.createElement("button"),body=document.createElement("span"),title=document.createElement("strong"),current=group.current&&conversation.id===canvasAgent.currentConversation?.id,conversationName=conversation.title||t("canvasAgentHistoryUntitled"),deleteLabel=t("studioNavigatorDeleteSession").replace("{name}",conversationName);
      entry.className="studio-navigator-conversation-entry";
      row.type="button";row.className="studio-navigator-item studio-navigator-conversation";row.dataset.conversationId=conversation.id;row.classList.toggle("current",current);
      peChoice(row);
      if(current)row.setAttribute("aria-current","page");
      body.className="studio-navigator-item-body";
      title.className="studio-navigator-conversation-name";
      title.textContent=conversationName;
      title.title=conversationName;
      body.append(title);row.append(body);
      row.addEventListener("click",()=>void openStudioConversation(group,conversation,row));
      remove.type="button";remove.className="studio-navigator-session-delete";remove.setAttribute("aria-label",deleteLabel);remove.title=deleteLabel;
      peButton(remove,"toolbar","compact");
      remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
      remove.addEventListener("click",()=>openStudioSessionDeleteDialog(group,conversation));
      entry.append(row,remove);
      return entry;
    }
    function studioNavigatorGroupSection(group,{includeConversations=true,previewUrls=studioNavigatorWorkPreviewUrls}={}) {
      const section=document.createElement("section"),heading=document.createElement("button"),canvasPreview=studioNavigatorCanvasPreview(group.item||studioNavigatorCanvasGroupSnapshot(group),previewUrls),headingBody=document.createElement("span"),name=document.createElement("strong"),meta=document.createElement("small"),identity=studioNavigatorCanvasIdentity(group.canvasKey);
      section.className="studio-navigator-group";
      section.dataset.canvasKey=group.canvasKey;
      heading.type="button";
      peChoice(heading);
      heading.className="studio-navigator-group-heading studio-navigator-canvas-heading";
      heading.classList.toggle("current",group.current);
      if(group.current)heading.setAttribute("aria-current","page");
      headingBody.className="studio-navigator-item-body";
      name.textContent=group.name;
      name.title=group.name;
      studioNavigatorRenderCanvasMeta(meta,group.current,Boolean(group.documentId),group.location,group.updatedAt);
      headingBody.append(name,meta);heading.append(canvasPreview,headingBody);
      if(group.documentId){
        heading.dataset.workspaceDocumentId=group.documentId;
        const dot=document.createElement("span");dot.className="workspace-update-dot";dot.hidden=!group.unseen;
        dot.setAttribute("role","img");dot.title=canvasDocumentsCopy("New updates","有新内容");dot.setAttribute("aria-label",dot.title);name.prepend(dot);
        heading.disabled=canvasDocuments.switching;
      }
      heading.addEventListener("click",()=>{
        if(group.documentId){canvasDocumentsUiAction(async()=>{await canvasDocumentsShow(group.documentId);if(studioNavigatorActiveTab==="mcp")selectCanvasToolMode("hand");closeStudioNavigatorAfterCompactAction();});return;}
        if(group.current){closeStudioNavigatorAfterCompactAction();return;}
        if(!identity){setStatus(t("studioNavigatorCanvasUnavailable"));return;}
        closeStudioNavigatorAfterCompactAction();
        void runSnapshotLoadAction(heading,()=>requestLoadSnapshot(identity.id,identity.location));
      });
      section.append(heading);
      if(group.documentId)appendStudioCanvasClose(section,group.documentId,group.current,group.name);

      if(includeConversations&&group.conversations.length){
        const list=document.createElement("div");
        list.className="studio-navigator-group-conversations";
        for(const conversation of group.conversations)list.append(studioNavigatorConversationEntry(group,conversation));
        section.append(list);
      }
      return section;
    }
    function appendStudioCanvasClose(section,documentId,current,name) {
      section.classList.add("has-current-close");
      section.classList.toggle("current",current);
      const close=document.createElement("button");close.type="button";
      close.className="studio-navigator-current-close";peButton(close,"ghost","compact");
      close.title=canvasDocumentsCopy(`Close ${name}`,`关闭 ${name}`);close.setAttribute("aria-label",close.title);
      close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
      close.disabled=canvasDocuments.switching;
      close.addEventListener("click",()=>canvasDocumentsUiAction(async()=>{
        if(canvasDocuments.activeId!==documentId)await canvasDocumentsShow(documentId,null,{markSeen:false});
        return requestCanvasTransition({type:"close",documentId});
      }));
      section.append(close);
    }
    async function openStudioConversationOnCurrentCanvas(pending) {
      if(!pending||pending.canvasKey!==state.canvasAgentCanvasKey)return false;
      studioNavigatorPendingConversation=null;
      studioNavigator.removeAttribute("aria-busy");
      if(canvasAgent.projectId)await canvasAgentSelectProject("");
      const conversation=canvasAgentHistoryForCanvas(pending.canvasKey).find(item=>item.id===pending.conversationId);
      if(!conversation){setStatus(t("studioNavigatorConversationUnavailable"));renderStudioAgentHistory();return false;}
      if(canvasAgentPanel.hidden)openCanvasAgent({focus:false,connect:false});
      await canvasAgentViewStoredConversation(conversation.id);
      setStatus(t("studioNavigatorRestored").replace("{canvas}",pending.canvasName||currentCanvasDisplayName()||t("canvasUntitledName")).replace("{conversation}",pending.conversationName||conversation.title||t("canvasAgentHistoryUntitled")));
      renderStudioAgentHistory();
      renderStudioWorkHistory();
      return true;
    }
    async function openStudioConversation(group,conversation,control) {
      closeStudioNavigatorAfterCompactAction();
      const pending={canvasKey:group.canvasKey,conversationId:conversation.id,canvasName:group.name,conversationName:conversation.title||t("canvasAgentHistoryUntitled")};
      studioNavigatorPendingConversation=pending;
      studioNavigator.setAttribute("aria-busy","true");
      control.disabled=true;
      try{
        if(group.canvasKey===state.canvasAgentCanvasKey)return await openStudioConversationOnCurrentCanvas(pending);
        const identity=studioNavigatorCanvasIdentity(group.canvasKey);
        if(!identity)throw Error(t("studioNavigatorCanvasUnavailable"));
        const loaded=await requestLoadSnapshot(identity.id,identity.location);
        if(!loaded&&!document.querySelector("#newCanvasDialog").open){
          studioNavigatorPendingConversation=null;
          studioNavigator.removeAttribute("aria-busy");
          setStatus(t("studioNavigatorCanvasUnavailable"));
        }
        return loaded;
      }catch(error){
        studioNavigatorPendingConversation=null;
        studioNavigator.removeAttribute("aria-busy");
        setStatus(`${t("snapshotError")}${String(error?.message||error)}`);
        return false;
      }finally{control.disabled=false;}
    }
    function studioNavigatorCanvasDidLoad(identity) {
      const key=identity?.id&&identity?.location?`${identity.location}:${identity.id}`:"";
      if(!studioNavigatorPendingConversation||studioNavigatorPendingConversation.canvasKey!==key)return false;
      void openStudioConversationOnCurrentCanvas(studioNavigatorPendingConversation).catch(error=>{
        studioNavigatorPendingConversation=null;
        studioNavigator.removeAttribute("aria-busy");
        setStatus(`${t("snapshotError")}${String(error?.message||error)}`);
      });
      return true;
    }
    function wantsStudioConversationForCanvas(identity) {
      const key=identity?.id&&identity?.location?`${identity.location}:${identity.id}`:"";
      return Boolean(key&&studioNavigatorPendingConversation?.canvasKey===key);
    }
    function cancelStudioPendingConversation() {
      studioNavigatorPendingConversation=null;
      studioNavigator.removeAttribute("aria-busy");
      renderStudioAgentHistory();
    }
    function openStudioSessionDeleteDialog(group,conversation) {
      const title=conversation.title||t("canvasAgentHistoryUntitled"),current=group.canvasKey===state.canvasAgentCanvasKey&&conversation.id===canvasAgent.currentConversation?.id,busy=current&&(canvasAgent.requestPending||canvasAgent.running);
      studioSessionDeletePending={canvasKey:group.canvasKey,conversationId:conversation.id};
      studioSessionDeleteDescription.textContent=t(busy?"studioNavigatorDeleteSessionBusy":"studioNavigatorDeleteSessionConfirm").replace("{name}",title);
      studioSessionDeleteConfirm.disabled=busy;
      if(!studioSessionDeleteDialog.open)studioSessionDeleteDialog.showModal();
      requestAnimationFrame(()=>studioSessionDeleteCancel.focus({preventScroll:true}));
    }
    function confirmStudioSessionDelete() {
      if(!studioSessionDeletePending)return false;
      const result=canvasAgentDeleteStoredConversation(studioSessionDeletePending.canvasKey,studioSessionDeletePending.conversationId);
      if(!result.deleted){
        const key=result.reason==="busy"?"studioNavigatorDeleteSessionBusy":"studioNavigatorDeleteSessionFailed";
        studioSessionDeleteDescription.textContent=t(key);
        studioSessionDeleteConfirm.disabled=result.reason==="busy";
        return false;
      }
      studioSessionDeleteDialog.close("deleted");
      renderStudioAgentHistory();
      renderStudioWorkHistory();
      return true;
    }
    function renderStudioAgentHistory() {
      if (!studioAgentRecentList) return;
      if (!studioNavigatorIsOpen()) {
        studioNavigatorHistoryDirty = true;
        return;
      }
      studioNavigatorHistoryDirty = false;
      releaseStudioNavigatorPreviewUrls(studioNavigatorAgentPreviewUrls);
      const query=studioNavigatorSearchQuery(),groups=studioNavigatorWorkGroups().map((group)=>({...group,conversations:query?group.conversations.filter((conversation)=>`${group.name} ${conversation.title||t("canvasAgentHistoryUntitled")} ${studioNavigatorConversationSummary(conversation)}`.toLocaleLowerCase(state.language==="zh"?"zh-CN":"en").includes(query)):group.conversations})).filter((group)=>group.conversations.length);
      studioNavigatorQueueCanvasGroupSnapshots(groups);
      studioAgentRecentList.replaceChildren();
      if (!groups.length) {
        studioNavigatorEmpty(studioAgentRecentList, query ? "studioNavigatorAgentNoMatch" : "studioNavigatorAgentEmpty");
        return;
      }
      for (const group of groups) studioAgentRecentList.append(studioNavigatorGroupSection(group,{previewUrls:studioNavigatorAgentPreviewUrls}));
    }
    function revokeStudioNavigatorPreviewUrlWhenSettled(url, image) {
      const revoke = () => {
        image.removeEventListener("load", revoke);
        image.removeEventListener("error", revoke);
        URL.revokeObjectURL(url);
      };
      if (image.complete) revoke();
      else {
        image.addEventListener("load", revoke);
        image.addEventListener("error", revoke);
      }
    }
    function releaseStudioNavigatorPreviewUrls(urls) {
      const entries = [...urls];
      urls.clear();
      queueMicrotask(() => {
        for (const [url, image] of entries) revokeStudioNavigatorPreviewUrlWhenSettled(url, image);
      });
    }
    function studioNavigatorCanvasPreview(item, urls = studioNavigatorCanvasPreviewUrls) {
      const preview = document.createElement("span"), image = document.createElement("img");
      preview.className = "studio-navigator-item-icon canvas";
      image.alt = "";
      if (item?.preview instanceof Blob) {
        const url = URL.createObjectURL(item.preview);
        urls.set(url, image);
        image.src = url;
        image.onerror = () => {
          if (urls.delete(url)) URL.revokeObjectURL(url);
        };
      }
      preview.append(image);
      return preview;
    }
    function renderStudioWorkHistory() {
      if (!studioWorkRecentList) return;
      if (!studioNavigatorIsOpen()) {
        studioNavigatorHistoryDirty = true;
        return;
      }
      studioNavigatorHistoryDirty = false;
      releaseStudioNavigatorPreviewUrls(studioNavigatorWorkPreviewUrls);
      const query=studioNavigatorSearchQuery(),groups=studioNavigatorWorkGroups().filter((group)=>studioNavigatorGroupMatches(group,query));
      studioNavigatorQueueCanvasGroupSnapshots(groups);
      studioWorkRecentList.replaceChildren();
      for(const group of groups)studioWorkRecentList.append(studioNavigatorGroupSection(group));
      renderStudioNavigatorSourceStates(studioWorkRecentList,query);
      if(!studioWorkRecentList.childElementCount)studioNavigatorEmpty(studioWorkRecentList,query?"studioNavigatorNoMatch":"studioNavigatorEmpty");
    }
    function renderStudioCanvasHistory() {
      if (!studioCanvasRecentList) return;
      if (!studioNavigatorIsOpen()) {
        studioNavigatorHistoryDirty = true;
        return;
      }
      studioNavigatorHistoryDirty = false;
      releaseStudioNavigatorPreviewUrls(studioNavigatorCanvasPreviewUrls);
      const query=studioNavigatorSearchQuery(),groups=studioNavigatorWorkGroups().filter(group=>group.documentId||group.location);
      studioCanvasRecentList.replaceChildren();
      for(const group of groups.filter(group=>studioNavigatorGroupMatches(group,query))){
        studioCanvasRecentList.append(studioNavigatorGroupSection(group,{includeConversations:false,previewUrls:studioNavigatorCanvasPreviewUrls}));
      }
      renderStudioNavigatorSourceStates(studioCanvasRecentList,query);
      if(!studioCanvasRecentList.childElementCount)studioNavigatorEmpty(studioCanvasRecentList,groups.length?"studioNavigatorCanvasNoMatch":"studioNavigatorCanvasEmpty");
    }
    let studioMcpFollowLatest=true,studioMcpLatestDocumentId=null,studioMcpPendingDocumentId=null,studioMcpFollowing=false,studioMcpCloseQueue=null;
    let studioMcpLatestRegion=null,studioMcpPendingRegion=null,studioMcpUpdateRevision=0;
    function studioMcpOpenDocumentIds() {
      const live=new Set([...mcpRuntime.sessions.values()].filter(session=>!session.closed).map(session=>session.documentId));
      return [...canvasDocuments.records.values()].filter(doc=>doc.bindings?.length||doc.sessions?.length||live.has(doc.id)).map(doc=>doc.id);
    }
    function syncStudioMcpActions() {
      const follow=document.getElementById("studioMcpFollowLatest"),close=document.getElementById("studioMcpCloseAll"),group=document.getElementById("studioMcpActions");
      const mcpTab=studioNavigatorActiveTab==="mcp";
      const actionIds=mcpTab?studioMcpOpenDocumentIds():[...canvasDocuments.records.keys()];
      const count=document.getElementById("canvasWorkspaceCount");
      if(count){
        count.textContent=canvasDocumentsCopy(`${actionIds.length} open`,`${actionIds.length} 个已打开`);
        count.setAttribute("aria-busy",String(canvasDocuments.switching));
      }
      const menuOthers=document.getElementById("studioMcpCloseOthers"),more=document.getElementById("studioMcpMore");
      if(menuOthers){menuOthers.textContent=canvasDocumentsCopy("Close others","关闭其他画布");menuOthers.disabled=Boolean(studioMcpCloseQueue)||canvasDocuments.switching||!actionIds.some(id=>id!==canvasDocuments.activeId);}
      if(more){more.setAttribute("aria-label",canvasDocumentsCopy("Canvas actions","画布操作"));more.disabled=Boolean(studioMcpCloseQueue)||canvasDocuments.switching;}
      if(!follow||!close)return;
      const busy=Boolean(studioMcpCloseQueue)||canvasDocuments.switching;
      group?.setAttribute("aria-label",canvasDocumentsCopy("MCP canvas actions","MCP 画布操作"));
      const followLabel=document.getElementById("studioMcpFollowLabel");
      if(followLabel)followLabel.textContent=canvasDocumentsCopy("Follow latest","跟随最新");
      const description=document.getElementById("studioMcpFollowDescription");
      if(description)description.textContent=canvasDocumentsCopy("Auto-focus new content","自动定位到最新内容");
      follow.setAttribute("aria-checked",String(studioMcpFollowLatest));follow.disabled=busy;
      follow.title=canvasDocumentsCopy("Follow the latest updated content, switching canvases when needed. Pauses while you edit or navigate.","跟随最新更新的内容，必要时切换画布；编辑或移动视野时暂停。");
      close.textContent=canvasDocumentsCopy("Close all","关闭全部画布");close.disabled=busy||!actionIds.length;
      close.setAttribute("aria-busy",String(Boolean(studioMcpCloseQueue)));
      close.title=mcpTab?canvasDocumentsCopy("Close all open MCP canvases. Saved canvases stay in the library.","关闭所有已打开的 MCP 画布，已保存画布仍保留在画布库中。"):canvasDocumentsCopy("Close all open canvases. Saved canvases stay in the library.","关闭所有已打开的画布，已保存画布仍保留在画布库中。");
    }
    function cancelStudioMcpCloseAll() {studioMcpCloseQueue=null;syncStudioMcpActions();}
    async function continueStudioMcpCloseAll(batch) {
      if(studioMcpCloseQueue!==batch)return;
      while(batch.length&&!canvasDocuments.records.has(batch[0]))batch.shift();
      if(!batch.length){
        try {
          if(batch.retainedDocumentId&&canvasDocuments.records.has(batch.retainedDocumentId)&&canvasDocuments.activeId!==batch.retainedDocumentId)await canvasDocumentsShow(batch.retainedDocumentId,null,{markSeen:false});
        } finally {cancelStudioMcpCloseAll();}
        return;
      }
      const id=batch[0];
      try {
        await canvasDocumentsShow(id,null,{markSeen:false});
        if(studioMcpCloseQueue!==batch)return;
        await requestCanvasTransition({type:"close",documentId:id,onCancel:cancelStudioMcpCloseAll,onComplete:async()=>{
          if(studioMcpCloseQueue!==batch)return;
          batch.shift();await continueStudioMcpCloseAll(batch);
        }});
      } catch(error){cancelStudioMcpCloseAll();throw error;}
    }
    async function closeOtherStudioCanvases() {
      if(studioMcpCloseQueue||canvasDocuments.switching)return;
      const retainedDocumentId=canvasDocumentsCurrent().id;
      const batch=[...canvasDocuments.records.keys()].filter(id=>id!==retainedDocumentId);
      if(!batch.length)return;
      batch.retainedDocumentId=retainedDocumentId;
      studioMcpPendingDocumentId=null;studioMcpPendingRegion=null;studioMcpCloseQueue=batch;syncStudioMcpActions();
      await continueStudioMcpCloseAll(batch);
    }
    async function closeOtherStudioMcpCanvases() {
      if(studioMcpCloseQueue||canvasDocuments.switching)return;
      const retainedDocumentId=canvasDocumentsCurrent().id;
      const batch=(studioNavigatorActiveTab==="mcp"?studioMcpOpenDocumentIds():[...canvasDocuments.records.keys()]).filter(id=>id!==retainedDocumentId);
      if(!batch.length)return;
      batch.retainedDocumentId=retainedDocumentId;
      studioMcpPendingDocumentId=null;studioMcpPendingRegion=null;studioMcpCloseQueue=batch;syncStudioMcpActions();
      await continueStudioMcpCloseAll(batch);
    }
    async function closeAllStudioMcpCanvases() {
      if(studioMcpCloseQueue)return;
      const batch=studioNavigatorActiveTab==="mcp"?studioMcpOpenDocumentIds():[...canvasDocuments.records.keys()];
      if(!batch.length)return;
      studioMcpPendingDocumentId=null;studioMcpPendingRegion=null;studioMcpCloseQueue=batch;syncStudioMcpActions();
      await continueStudioMcpCloseAll(batch);
    }
    function noteStudioMcpContentUpdate(documentId,region=null) {
      if(!documentId||!canvasDocuments.records.has(documentId))return;
      studioMcpUpdateRevision++;
      studioMcpLatestDocumentId=documentId;
      studioMcpLatestRegion=region;
      if(studioMcpFollowLatest){studioMcpPendingDocumentId=documentId;studioMcpPendingRegion=region;}
    }
    function studioMcpConnectionCurrent(execution) {
      return !execution||execution.socket===mcpRuntime.socket&&execution.socket?.readyState===WebSocket.OPEN&&execution.generation===mcpRuntime.generation&&!execution.controller.signal.aborted;
    }
    async function flushStudioMcpFollowLatest(execution=null) {
      if(!studioMcpConnectionCurrent(execution))return;
      if(!studioMcpFollowLatest||!studioMcpPendingDocumentId||studioMcpFollowing||studioMcpCloseQueue||canvasDocuments.switching||mcpRuntime.queued||!mcpRuntime.ready)return;
      const active=document.activeElement;
      if(mcpViewBlockedBy()||document.querySelector("dialog[open]")||active?.matches?.("input,textarea,select,[contenteditable='true']"))return;
      const id=studioMcpPendingDocumentId,updateRevision=studioMcpUpdateRevision;
      if(!canvasDocuments.records.has(id)){studioMcpPendingDocumentId=null;studioMcpPendingRegion=null;return;}
      studioMcpFollowing=true;
      try {
        if(id!==canvasDocuments.activeId)await canvasDocumentsShow(id,execution,{markSeen:false});
        if(!studioMcpConnectionCurrent(execution))return;
        // Loading yields: recheck user activity and use the newest region even
        // when another update arrived for this same document during the switch.
        if(!studioMcpFollowLatest||studioMcpPendingDocumentId!==id||canvasDocuments.activeId!==id||mcpRuntime.queued||mcpViewBlockedBy()||document.querySelector("dialog[open]")||document.activeElement?.matches?.("input,textarea,select,[contenteditable='true']"))return;
        const region=studioMcpPendingRegion;
        if(region) {
          mcpRevealRegion(region);
          // This explicit follow supersedes older automatic reveals on this Canvas.
          for(const [sessionId] of mcpRuntime.pendingView||[])if(mcpRuntime.sessions.get(sessionId)?.documentId===id)mcpRuntime.pendingView.delete(sessionId);
          if(!mcpRuntime.pendingView?.size){clearTimeout(mcpRuntime.layoutTimer);mcpRuntime.layoutTimer=0;mcpRuntime.layoutSince=0;}
          mcpRenderCanvasStatus();
        }
        studioMcpPendingDocumentId=null;studioMcpPendingRegion=null;
      } catch(error) {
        // Busy work keeps just the newest target until the next real checkpoint.
        if(!["CANVAS_BUSY","CANVAS_CHANGED"].includes(error.code)){
          if(studioMcpPendingDocumentId===id&&studioMcpUpdateRevision===updateRevision){studioMcpPendingDocumentId=null;studioMcpPendingRegion=null;}
          canvasDocumentsReport(error);
        }
      } finally {
        studioMcpFollowing=false;syncStudioMcpActions();
        if(studioMcpConnectionCurrent(execution)&&studioMcpFollowLatest&&studioMcpPendingDocumentId&&(studioMcpPendingDocumentId!==id||studioMcpUpdateRevision!==updateRevision))queueMicrotask(()=>void flushStudioMcpFollowLatest());
      }
    }
    function studioNavigatorMcpGroups() {
      return studioNavigatorWorkGroups().filter(group=>group.documentId);
    }
    function renderStudioMcpHistory() {
      syncStudioMcpActions();
      if(!studioNavigatorIsOpen()){studioNavigatorHistoryDirty=true;return;}
      releaseStudioNavigatorPreviewUrls(studioNavigatorCanvasPreviewUrls);
      studioMcpRecentList.replaceChildren();
      const query=studioNavigatorSearchQuery();
      for(const group of studioNavigatorMcpGroups().filter(group=>studioNavigatorGroupMatches(group,query))){
        studioMcpRecentList.append(studioNavigatorGroupSection(group,{includeConversations:false,previewUrls:studioNavigatorCanvasPreviewUrls}));
      }
      if(!studioMcpRecentList.childElementCount)studioNavigatorEmpty(studioMcpRecentList,query?"studioNavigatorNoMatch":"studioNavigatorMcpEmpty");
    }
    function syncStudioNavigatorMcp(enabled,{reveal=true}={}) {
      enabled=Boolean(enabled);
      if(enabled===studioNavigatorMcpEnabled)return;
      studioNavigatorMcpEnabled=enabled;
      if(!enabled){studioMcpPendingDocumentId=null;studioMcpPendingRegion=null;studioMcpLatestDocumentId=null;studioMcpLatestRegion=null;}
      studioNavigatorMcpTab.hidden=!enabled;
      if(enabled&&reveal){
        selectCanvasToolMode("hand");
        studioNavigatorSuspendedAgent=false;
        studioNavigatorRestoreAgentAfterManager=false;
        closeCanvasAgent({focus:false});
        studioNavigatorSearch.value="";
        setStudioNavigatorTab("mcp",{persist:false});
        setStudioNavigatorOpen(true);
        // Connection changes preserve the user’s Follow latest preference.
        studioMcpPendingDocumentId=null;studioMcpPendingRegion=null;
        syncStudioMcpActions();
      }else if(!enabled&&studioNavigatorActiveTab==="mcp")setStudioNavigatorTab("all",{persist:false});
    }
    let studioWorkspaceSignature="";
    function studioWorkspaceChanged() {
      if(typeof canvasDocuments==="undefined")return;
      syncStudioMcpActions();
      const documents=[...canvasDocuments.records.values()],hasUpdates=documents.some(doc=>doc.unseen>0),attention=hasUpdates||Boolean(canvasDocuments.error);
      studioNavigatorToggle.dataset.workspaceUpdates=String(attention);
      const hint=document.getElementById("studioWorkspaceUpdateHint");
      if(hint)hint.textContent=canvasDocuments.error?canvasDocumentsCopy("Canvas needs attention. Open Recent Work to retry.","画布操作需要处理。打开最近工作以重试。"):hasUpdates?canvasDocumentsCopy("Canvases have new updates","画布有新内容"):"";
      const signature=JSON.stringify([canvasDocuments.activeId,...documents.map(doc=>[doc.id,doc.title,doc.savedAt,doc.locator?.location,doc.locator?.id,doc.bindings?.length,doc.sessions?.length,typeof mcpRuntime!=="undefined"&&[...mcpRuntime.sessions.values()].some(session=>session.documentId===doc.id)])]);
      if(signature!==studioWorkspaceSignature){studioWorkspaceSignature=signature;renderActiveStudioNavigatorHistory();}
      if(!studioNavigatorIsOpen()){studioNavigatorHistoryDirty=true;return;}
      for(const row of studioNavigator.querySelectorAll("[data-workspace-document-id]")){
        const doc=canvasDocuments.records.get(row.dataset.workspaceDocumentId),dot=row.querySelector(".workspace-update-dot");
        if(dot){dot.hidden=!doc?.unseen;dot.setAttribute("aria-label",canvasDocumentsCopy("New updates","有新内容"));}
        row.disabled=canvasDocuments.switching;
      }
      if(typeof studioNavigatorActiveTab!=="undefined"&&studioNavigatorActiveTab==="mcp"){
        const rows=new Map([...studioMcpRecentList.querySelectorAll("[data-workspace-document-id]")].map(row=>[row.dataset.workspaceDocumentId,row]));
        let index=0;
        for(const group of studioNavigatorMcpGroups()){
          const row=rows.get(group.documentId);if(!row)continue;
          const section=row.parentElement;
          if(studioMcpRecentList.children[index]!==section)studioMcpRecentList.insertBefore(section,studioMcpRecentList.children[index]||null);
          const meta=row.querySelector("small");
          if(meta&&meta.dataset.updatedAt!==String(group.updatedAt)){
            studioNavigatorRenderCanvasMeta(meta,group.current,true,group.location,group.updatedAt);
            meta.dataset.updatedAt=String(group.updatedAt);
          }
          index++;
        }
      }
    }
    function renderActiveStudioNavigatorHistory() {
      if (!studioNavigatorIsOpen()) {
        studioNavigatorHistoryDirty = true;
        return;
      }
      if(studioNavigatorActiveTab==="mcp")renderStudioMcpHistory();
      else if(studioNavigatorActiveTab==="canvas")renderStudioCanvasHistory();
      else if(studioNavigatorActiveTab==="agent")renderStudioAgentHistory();
      else renderStudioWorkHistory();
    }
    function setStudioNavigatorTab(tab, { focus = false, persist = true } = {}) {
      studioNavigatorActiveTab=(tab==="mcp"&&studioNavigatorMcpEnabled)||["all","canvas","agent"].includes(tab)?tab:"all";
      const tabs={all:studioNavigatorAllTab,mcp:studioNavigatorMcpTab,canvas:studioNavigatorCanvasTab,agent:studioNavigatorAgentTab},panels={all:studioNavigatorAllPanel,mcp:studioNavigatorMcpPanel,canvas:studioNavigatorCanvasPanel,agent:studioNavigatorAgentPanel};
      for(const [key,control] of Object.entries(tabs)){
        const active=key===studioNavigatorActiveTab;
        control.setAttribute("aria-selected",String(active));
        control.tabIndex=active?0:-1;
        panels[key].hidden=!active;
      }
      if (persist) {
        try { localStorage.setItem(STUDIO_NAVIGATOR_TAB_KEY, studioNavigatorActiveTab); }
        catch {}
      }
      setStudioMcpMenuOpen(false);
      syncStudioMcpActions();
      updateStudioNavigatorA11y();
      renderActiveStudioNavigatorHistory();
      if(focus)tabs[studioNavigatorActiveTab].focus({preventScroll:true});
    }
    function renderStudioNavigator() {
      setStudioNavigatorTab(studioNavigatorActiveTab, { persist:false });
      updateStudioNavigatorA11y();
      updateStudioDocumentState();
    }
    function openStudioCanvasHistoryManager() {
      openHistoryPanel();
    }
    function handleStudioNavigatorTabKeydown(event) {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const order=studioNavigatorMcpEnabled?["all","mcp","canvas","agent"]:["all","canvas","agent"],current=order.indexOf(studioNavigatorActiveTab),index=event.key==="Home"?0:event.key==="End"?order.length-1:event.key==="ArrowRight"?(current+1)%order.length:(current+order.length-1)%order.length;
      setStudioNavigatorTab(order[index],{focus:true});
    }
    function historyManagerWillOpen() {
      studioNavigatorRestoreAgentAfterManager=false;
      if(!studioNavigatorIsCompact()||studioNavigatorIsMcpDocked())return;
      if(studioNavigatorIsOpen()){
        studioNavigatorRestoreAgentAfterManager=studioNavigatorSuspendedAgent;
        setStudioNavigatorOpen(false,{restoreAgent:false});
      }else if(!canvasAgentPanel.hidden&&document.body.classList.contains("canvas-agent-open")){
        studioNavigatorRestoreAgentAfterManager=true;
        closeCanvasAgent({focus:false,animate:false});
      }
    }
    function historyManagerDidClose() {
      if(!studioNavigatorRestoreAgentAfterManager)return;
      studioNavigatorRestoreAgentAfterManager=false;
      studioNavigatorSuspendedAgent=false;
      openCanvasAgent({focus:false,connect:false,animate:false});
    }
    function studioNavigatorAgentWillOpen() {
      if(!studioNavigatorIsCompact()||!studioNavigatorIsOpen()||studioNavigatorIsMcpDocked())return;
      studioNavigatorSuspendedAgent=false;
      setStudioNavigatorOpen(false,{restoreAgent:false});
    }
    function handleStudioNavigatorCompactChange() {
      if(studioNavigatorIsOpen()){
        if(studioNavigatorIsCompact())suspendStudioAgentForNavigator();
        else restoreStudioAgentAfterNavigator();
      }
      updateStudioNavigatorA11y();
    }
    function studioEdgeSwipeInteractiveTarget(target) {
      return target instanceof Element && Boolean(target.closest("button, input, textarea, select, a, [contenteditable='true'], [role='button'], [role='separator']"));
    }
    function studioEdgeSwipeSide(event) {
      if (studioEdgeSwipe || event.pointerType !== "touch" || event.isPrimary === false || state.viewMode || !studioNavigatorIsStudio() || studioEdgeSwipeInteractiveTarget(event.target)) return "";
      const bounds = view.getBoundingClientRect(),
        leftInset = event.clientX - bounds.left,
        rightInset = bounds.right - event.clientX;
      if (leftInset >= 0 && leftInset <= STUDIO_EDGE_SWIPE_START_PX && !studioNavigatorIsOpen()) return "left";
      if (rightInset >= 0 && rightInset <= STUDIO_EDGE_SWIPE_START_PX && canvasAgentAvailable() && canvasAgentPanel.hidden && canvasAgentDockedPanel()) return "right";
      return "";
    }
    function consumeStudioEdgeSwipe(event) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    }
    function beginStudioEdgeSwipe(event) {
      const side = studioEdgeSwipeSide(event);
      if (!side) return;
      consumeStudioEdgeSwipe(event);
      studioEdgeSwipe = {
        pointerId:event.pointerId,
        side,
        startX:event.clientX,
        startY:event.clientY,
        cancelled:false,
        committed:false,
      };
      try { view.setPointerCapture(event.pointerId); }
      catch {}
    }
    function moveStudioEdgeSwipe(event) {
      const gesture = studioEdgeSwipe;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      consumeStudioEdgeSwipe(event);
      if (gesture.cancelled || gesture.committed) return;
      const deltaX = event.clientX - gesture.startX,
        deltaY = Math.abs(event.clientY - gesture.startY),
        inward = gesture.side === "left" ? deltaX : -deltaX;
      if (inward < -STUDIO_EDGE_SWIPE_START_PX / 2 || deltaY > STUDIO_EDGE_SWIPE_CANCEL_PX && deltaY > Math.max(0, inward)) {
        gesture.cancelled = true;
        return;
      }
      if (inward < STUDIO_EDGE_SWIPE_COMMIT_PX || inward < deltaY * STUDIO_EDGE_SWIPE_DIRECTION_RATIO) return;
      gesture.committed = true;
      if (gesture.side === "left") setStudioNavigatorOpen(true);
      else openCanvasAgent({ focus:false });
    }
    function finishStudioEdgeSwipe(event) {
      const gesture = studioEdgeSwipe;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      consumeStudioEdgeSwipe(event);
      studioEdgeSwipe = null;
      if (view.hasPointerCapture?.(event.pointerId)) view.releasePointerCapture(event.pointerId);
    }
    function loseStudioEdgeSwipeCapture(event) {
      if (studioEdgeSwipe?.pointerId === event.pointerId) studioEdgeSwipe = null;
    }

    function setStudioMcpMenuOpen(open,{focus=false}={}) {
      const menu=document.getElementById("studioMcpMenu"),trigger=document.getElementById("studioMcpMore");
      if(!menu||!trigger)return;
      menu.hidden=!open;trigger.setAttribute("aria-expanded",String(open));
      if(focus)(open?menu.querySelector("button:not(:disabled)"):trigger)?.focus({preventScroll:true});
    }
    const mcpMenu=document.getElementById("studioMcpMenu"),mcpMore=document.getElementById("studioMcpMore");
    mcpMore?.addEventListener("click",()=>setStudioMcpMenuOpen(mcpMenu.hidden,{focus:true}));
    mcpMenu?.addEventListener("click",event=>{if(event.target.closest("button"))setStudioMcpMenuOpen(false,{focus:true});});
    mcpMenu?.addEventListener("keydown",event=>{
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setStudioMcpMenuOpen(false,{focus:true});return;}
      if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
      event.preventDefault();
      const items=[...mcpMenu.querySelectorAll("button:not(:disabled)")],index=items.indexOf(document.activeElement);
      const next=event.key==="Home"?0:event.key==="End"?items.length-1:(index+(event.key==="ArrowDown"?1:-1)+items.length)%items.length;
      items[next]?.focus();
    });
    document.addEventListener("pointerdown",event=>{if(!mcpMenu?.hidden&&!mcpMenu.contains(event.target)&&!mcpMore.contains(event.target))setStudioMcpMenuOpen(false);});
    document.addEventListener("focusin",event=>{if(!mcpMenu?.hidden&&!mcpMenu.contains(event.target)&&!mcpMore.contains(event.target))setStudioMcpMenuOpen(false);});
    document.getElementById("studioMcpCloseOthers")?.addEventListener("click",()=>canvasDocumentsUiAction(closeOtherStudioMcpCanvases));
    function toggleStudioWorkspaceNavigator() {
      const opening=!studioNavigatorIsOpen();
      if(opening&&studioNavigatorToggle.dataset.workspaceUpdates==="true"){
        studioNavigatorSearch.value="";setStudioNavigatorTab(studioNavigatorMcpEnabled?"mcp":"all");
      }
      setStudioNavigatorOpen(opening);
    }
    studioNavigatorToggle.addEventListener("click", toggleStudioWorkspaceNavigator);
    studioNavigatorClose.addEventListener("click", () => setStudioNavigatorOpen(false));
    studioNavigatorScrim.addEventListener("click", () => setStudioNavigatorOpen(false));
    studioNavigatorSearch.addEventListener("input", renderActiveStudioNavigatorHistory);
    studioNavigatorMcpTab.addEventListener("click",()=>setStudioNavigatorTab("mcp"));
    document.getElementById("studioMcpCloseAll")?.addEventListener("click",()=>canvasDocumentsUiAction(closeAllStudioMcpCanvases));
    document.getElementById("studioMcpFollowLatest")?.addEventListener("click",()=>{
      studioMcpFollowLatest=!studioMcpFollowLatest;
      studioMcpPendingDocumentId=studioMcpFollowLatest?studioMcpLatestDocumentId:null;
      studioMcpPendingRegion=studioMcpFollowLatest?studioMcpLatestRegion:null;
      syncStudioMcpActions();void flushStudioMcpFollowLatest();
    });
    const resumeMcpFollow=()=>{if(studioMcpFollowLatest&&studioMcpPendingDocumentId)queueMicrotask(()=>void flushStudioMcpFollowLatest());};
    window.addEventListener("pointerup",resumeMcpFollow);
    window.addEventListener("pointercancel",resumeMcpFollow);
    document.addEventListener("focusout",resumeMcpFollow);
    document.addEventListener("visibilitychange",resumeMcpFollow);
    studioNavigatorMcpTab.addEventListener("keydown",handleStudioNavigatorTabKeydown);
    studioNavigatorAllTab.addEventListener("click", () => setStudioNavigatorTab("all"));
    studioNavigatorAgentTab.addEventListener("click", () => setStudioNavigatorTab("agent"));
    studioNavigatorCanvasTab.addEventListener("click", () => setStudioNavigatorTab("canvas"));
    studioNavigatorAllTab.addEventListener("keydown", handleStudioNavigatorTabKeydown);
    studioNavigatorAgentTab.addEventListener("keydown", handleStudioNavigatorTabKeydown);
    studioNavigatorCanvasTab.addEventListener("keydown", handleStudioNavigatorTabKeydown);
    studioNavigatorManage.addEventListener("click", openStudioCanvasHistoryManager);
    canvasDocumentName.addEventListener("click", beginCanvasDocumentRename);
    canvasDocumentNameInput.addEventListener("input", () => canvasDocumentNameInput.setCustomValidity(""));
    canvasDocumentNameEditor.addEventListener("focusout", (event) => {
      if (!canvasDocumentNameEditor.contains(event.relatedTarget)) void commitCanvasDocumentRename();
    });
    canvasDocumentNameConfirm.addEventListener("click", () => void commitCanvasDocumentRename());
    canvasDocumentNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        void commitCanvasDocumentRename();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finishCanvasDocumentRename({ focus:true });
      }
    });
    studioSessionDeleteConfirm.addEventListener("click",confirmStudioSessionDelete);
    studioSessionDeleteDialog.addEventListener("close",()=>{
      studioSessionDeletePending=null;
      studioSessionDeleteConfirm.disabled=false;
    });
    view.addEventListener("pointerdown", beginStudioEdgeSwipe, true);
    view.addEventListener("pointermove", moveStudioEdgeSwipe, true);
    view.addEventListener("pointerup", finishStudioEdgeSwipe, true);
    view.addEventListener("pointercancel", finishStudioEdgeSwipe, true);
    view.addEventListener("lostpointercapture", loseStudioEdgeSwipeCapture, true);
    document.addEventListener("pointerdown", collapseStudioNavigatorForWorkspaceFocus, true);
    document.addEventListener("focusin", collapseStudioNavigatorForWorkspaceFocus);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && studioNavigatorIsCompact() && studioNavigatorIsOpen() && studioNavigator.contains(document.activeElement)) {
        event.preventDefault();
        setStudioNavigatorOpen(false);
      }
    });
    studioNavigatorCompactMedia?.addEventListener?.("change", handleStudioNavigatorCompactChange);
    window.addEventListener("penecho:languagechange", renderStudioNavigator);
    window.PenEchoStudioNavigator = Object.freeze({
      render:renderStudioNavigator,
      renderWork:()=>{if(studioNavigatorActiveTab==="all")renderStudioWorkHistory();},
      renderAgent:()=>{studioNavigatorActiveTab==="agent"?renderStudioAgentHistory():studioNavigatorActiveTab==="all"&&renderStudioWorkHistory();},
      renderCanvases:renderActiveStudioNavigatorHistory,
      updateDocument:updateStudioDocumentState,
      workspaceChanged:studioWorkspaceChanged,
      noteMcpContentUpdate:noteStudioMcpContentUpdate,
      flushMcpFollow:flushStudioMcpFollowLatest,
      syncMcp:syncStudioNavigatorMcp,
      isMcpDocked:studioNavigatorIsMcpDocked,
      canvasDidLoad:studioNavigatorCanvasDidLoad,
      wantsConversationForCanvas:wantsStudioConversationForCanvas,
      cancelPendingConversation:cancelStudioPendingConversation,
      open:(tab="all")=>{setStudioNavigatorTab(tab);setStudioNavigatorOpen(true);},
      refreshSource:refreshStudioNavigatorSource,
      historyManagerWillOpen,
      historyManagerDidClose,
      agentWillOpen:studioNavigatorAgentWillOpen,
      setOpen:setStudioNavigatorOpen,
      syncCanvasView:setStudioNavigatorCanvasView,
      syncTheme:syncStudioNavigatorTheme,
    });
    setStudioNavigatorTab(studioNavigatorActiveTab, { persist:false });
    syncStudioNavigatorTheme(state.theme);
  }
