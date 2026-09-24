// Library pages own their requests, cache, and bottom observer. Document loading
// is independent: a background list request never locks an existing Canvas row.
  const HISTORY_PAGE_SIZE = 24, historyPageCache = new Map();
  let historyPageInfo = null, historyPageKey = "", historyPageController = null,
    historyPageObserver = null, historyPageError = false, historyFilterTimer = 0,
    historyDeviceVisible = HISTORY_PAGE_SIZE, historyAutoLoad = localStorage.getItem("penecho-history-auto-load") !== "false";
  function historyCacheScope(location = state.snapshotLocation) {
    if (location === "cloud") return window.PenEchoCloudSettings?.cacheIdentity?.() || "";
    if (location === "server" && window.PENECHO_CONFIG?.runtime === "cloud") return window.PenEchoLinkedDevice?.cacheIdentity?.() || "";
    return location;
  }
  function historyCurrentPageKey() {
    return JSON.stringify([state.snapshotLocation,historyCacheScope(),state.snapshotLocation === "server" ? selectedServerProjectId : state.snapshotLocation === "cloud" ? selectedCloudProjectId : "all",historySearchQuery(),document.querySelector("#historySort")?.value || "modified",state.language]);
  }
  function historyPageOptions(offset = 0) {
    return {limit:HISTORY_PAGE_SIZE,offset,q:historySearchQuery(),projectId:state.snapshotLocation === "server" ? selectedServerProjectId : selectedCloudProjectId,sort:document.querySelector("#historySort")?.value || "modified",locale:state.language === "zh" ? "zh" : "en",previews:"0"};
  }
  async function remoteHistoryPage(location, options, signal) {
    if (location === "server") await window.PenEchoLinkedDevice?.refresh({ifNeeded:true});
    const query = new URLSearchParams(options);
    const response = await fetch(`${location === "server" ? "/api/canvases" : "/api/cloud/library"}?${query}`,{credentials:"same-origin",cache:"no-store",headers:authenticatedApiHeaders(),signal});
    const body = await snapshotApiResponse(response);
    if (location === "cloud" && (body?.sync?.bundleVersion !== 2 || body.sync.conflictPolicy !== "base-revision-required")) throw Error("PenEcho Cloud does not support this Canvas sync version");
    if (!Array.isArray(body?.canvases) || !body.page || !Number.isSafeInteger(body.page.total) || !(body.page.nextOffset === null || Number.isSafeInteger(body.page.nextOffset) && body.page.nextOffset > options.offset)) throw Error("The Canvas Library server must be updated to support pages.");
    return body;
  }
  function cacheHistoryPage() {
    if (!historyPageInfo || !historyPageKey) return;
    const projects = state.snapshotLocation === "cloud" ? cloudCanvasProjects : serverCanvasProjects;
    const entry = {items:snapshotItems.slice(),projects:projects.slice(),page:{...historyPageInfo}};
    historyPageCache.delete(historyPageKey);
    historyPageCache.set(historyPageKey,entry);
    while (historyPageCache.size > 12) historyPageCache.delete(historyPageCache.keys().next().value);
    // Persist only the first lightweight page. A reload resumes at its real
    // boundary; previews and Canvas document payloads never enter sessionStorage.
    if (!historyCacheScope()) return;
    try {
      const persisted={...entry,items:entry.items.slice(0,HISTORY_PAGE_SIZE).map(({preview,previewDataUrl,...item})=>item),page:{...entry.page,nextOffset:entry.page.total>HISTORY_PAGE_SIZE?HISTORY_PAGE_SIZE:null}};
      const key=`penecho-library-page:${historyPageKey}`;
      sessionStorage.setItem(key,JSON.stringify(persisted));
      const keys=Object.keys(sessionStorage).filter(key=>key.startsWith("penecho-library-page:"));
      for(const stale of keys.slice(0,Math.max(0,keys.length-12)))if(stale!==key)sessionStorage.removeItem(stale);
    } catch {}
  }
  function restoreHistoryPage() {
    if (state.snapshotLocation === "device") return false;
    const key=historyCurrentPageKey();
    let entry=historyPageCache.get(key);
    if (!entry && historyCacheScope()) try {entry=JSON.parse(sessionStorage.getItem(`penecho-library-page:${key}`));} catch {}
    if (!entry || !Array.isArray(entry.items) || !Array.isArray(entry.projects) || !entry.page) return false;
    snapshotItems=entry.items.slice();
    if (state.snapshotLocation === "cloud") cloudCanvasProjects=entry.projects.slice();
    else serverCanvasProjects=entry.projects.slice();
    snapshotItemsLocation=state.snapshotLocation;
    historyPageInfo={...entry.page}; historyPageKey=key; historyPageError=false;
    return true;
  }
  function clearHistoryPages(location) {
    for (const key of historyPageCache.keys()) if (JSON.parse(key)[0] === location) historyPageCache.delete(key);
    try {for(const key of Object.keys(sessionStorage)) if(key.startsWith(`penecho-library-page:["${location}",`))sessionStorage.removeItem(key);} catch {}
  }
  function historyFiltersChanged({immediate=false} = {}) {
    clearTimeout(historyFilterTimer);
    historyDeviceVisible=HISTORY_PAGE_SIZE;
    if (state.snapshotLocation === "device") {renderSnapshotList();return;}
    // Invalidate immediately, including while typing, so an earlier search
    // cannot replace the current results during the input debounce.
    snapshotListGeneration++;
    historyPageController?.abort();
    snapshotListInProgress=false;
    historyPageObserver?.disconnect();
    historyFilterTimer=setTimeout(()=>{void refreshSnapshots().catch(()=>{});},immediate?0:180);
  }
  async function refreshHistoryPage({append=false} = {}) {
    const location=state.snapshotLocation;
    let key=historyCurrentPageKey();
    if (append && (snapshotListInProgress || key!==historyPageKey || historyPageInfo?.nextOffset == null)) return false;
    historyPageController?.abort();
    const controller=new AbortController(), generation=++snapshotListGeneration;
    historyPageController=controller;
    const timer=setTimeout(()=>controller.abort(),12000);
    const sameView=historyPageKey===key && snapshotItemsLocation===location;
    if (!append && !sameView && !restoreHistoryPage()) {
      snapshotItems=[]; snapshotItemsLocation=null; historyPageInfo=null;
    }
    const retained=snapshotItemsLocation===location;
    historyPageKey=key; historyPageError=false;
    snapshotListInProgress=true; snapshotListFailedLocation=null;
    serverSnapshotUnavailableKey="";
    if (!retained) renderSnapshotListLoading(location);
    else if (!sameView) renderSnapshotList();
    if (retained) setHistoryActivity(t("snapshotLibraryLoading").replace("{location}",snapshotLocationLabel(location)));
    updateHistoryReadControls();
    updateHistoryPagination();
    try {
      const body=await remoteHistoryPage(location,historyPageOptions(append?historyPageInfo.nextOffset:0),controller.signal);
      if (generation!==snapshotListGeneration || location!==state.snapshotLocation) return false;
      if (key!==historyCurrentPageKey()) {
        const before=JSON.parse(key),after=JSON.parse(historyCurrentPageKey());
        if(before[1] || before.some((value,index)=>index!==1&&value!==after[index]))return false;
        key=historyCurrentPageKey(); historyPageKey=key;
      }
      const items=body.canvases.map(item=>({...item,preview:null}));
      snapshotItems=append?[...new Map([...snapshotItems,...items].map(item=>[item.id,item])).values()]:items;
      snapshotItemsLocation=location; historyPageInfo=body.page;
      if(location==="cloud"){cloudCanvasProjects=body.projects||[];cloudHistorySignInRequired=false;cacheCloudHistory(snapshotItems);}
      else serverCanvasProjects=body.projects||[];
      cacheHistoryPage();
      renderSnapshotList({append});
      return true;
    } catch(error) {
      if(generation!==snapshotListGeneration || location!==state.snapshotLocation)return false;
      historyPageError=true;
      const auth=location==="cloud"&&(cloudHistoryRequiresSignIn(error)||(window.PENECHO_CONFIG?.runtime==="cloud"&&error.status===401&&error.code==="unauthorized"));
      if(auth){cloudHistorySignInRequired=true;clearCloudHistoryCache();clearHistoryPages(location);snapshotItems=[];snapshotItemsLocation=null;historyPageInfo=null;renderCloudHistorySignIn();}
      else {
        snapshotListFailedLocation=location;
        if(location==="server"&&["device_offline","linked_device_required"].includes(error.code))serverSnapshotUnavailableKey=error.code==="device_offline"?"serverHistoryDeviceOffline":"serverHistoryDeviceRequired";
        renderSnapshotListError(location,retained&&snapshotItems.length>0);
      }
      return false;
    } finally {
      clearTimeout(timer);
      if(generation===snapshotListGeneration){snapshotListInProgress=false;historyPageController=null;hideHistoryActivity();updateHistoryReadControls();updateHistoryPagination();}
    }
  }
  function loadMoreHistory() {
    if(snapshotListInProgress || historyListRenderFrame || historyPageKey && historyPageKey!==historyCurrentPageKey())return;
    if(state.snapshotLocation==="device"){historyDeviceVisible+=HISTORY_PAGE_SIZE;renderSnapshotList({append:true});}
    else void refreshHistoryPage({append:true});
  }
  function reconcileHistoryIdentity() {
    if(!historyPageKey || state.snapshotLocation==="device")return;
    const previous=JSON.parse(historyPageKey);
    if(previous[1]===historyCacheScope())return;
    // Initial status discovery may safely hydrate an identity-scoped cache.
    // A sign-out or a switch from a known identity must revoke the old rows.
    if(previous[1]){
      snapshotListGeneration++; historyPageController?.abort(); snapshotListInProgress=false;
      clearHistoryPages(state.snapshotLocation);
      snapshotItems=[];snapshotItemsLocation=null;historyPageInfo=null;historyPageKey="";
    }
    else if(snapshotListInProgress && restoreHistoryPage())renderSnapshotList();
    if(!snapshotListInProgress && document.querySelector("#historyPanel")?.classList.contains("open"))void refreshSnapshots().catch(()=>{});
  }
  function updateHistoryPagination() {
    historyPageObserver?.disconnect(); historyPageObserver=null;
    if(historyListRenderFrame)return;
    const list=document.querySelector("#historyList");
    if(!list || !document.querySelector("#historyPanel")?.classList.contains("open"))return;
    let footer=list.querySelector(".history-pagination");
    if(snapshotItemsLocation!==state.snapshotLocation || state.snapshotLocation==="cloud"&&cloudHistorySignInRequired){footer?.remove();return;}
    if(!footer){footer=document.createElement("div");footer.className="history-pagination";list.append(footer);}
    footer.replaceChildren();
    const count=list.querySelectorAll(".history-card").length, total=historyPageInfo?.total ?? historySortItems(snapshotItemsForCurrentView().filter(item=>!historySearchQuery()||snapshotName(item).toLocaleLowerCase().includes(historySearchQuery()))).length,
      more=state.snapshotLocation==="device"?count<total:historyPageInfo?.nextOffset!=null,
      status=document.createElement("span"),toggle=document.createElement("button"),button=document.createElement("button");
    status.setAttribute("role","status");
    status.textContent=t(more?"historyLoadedCount":"historyEnd").replace("{count}",String(count)).replace("{total}",String(total));
    footer.dataset.compact = String(!more && total <= HISTORY_PAGE_SIZE);
    footer.append(status);
    if(!more || historyPageError)return;
    toggle.type=button.type="button";peButton(toggle,"secondary","compact");peButton(button,"secondary","compact");
    toggle.textContent=t("historyAutoLoad");toggle.setAttribute("aria-pressed",String(historyAutoLoad));
    toggle.onclick=()=>{historyAutoLoad=!historyAutoLoad;localStorage.setItem("penecho-history-auto-load",String(historyAutoLoad));updateHistoryPagination();};
    button.textContent=t(snapshotListInProgress?"snapshotLoadingShort":historyPageError?"snapshotLibraryRetry":"historyLoadMore");
    button.disabled=snapshotListInProgress;button.onclick=loadMoreHistory;
    footer.append(toggle,button);
    if(historyAutoLoad&&!snapshotListInProgress&&!historyPageError&&typeof IntersectionObserver==="function"){
      historyPageObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))loadMoreHistory();},{root:list,rootMargin:"0px 0px 160px 0px"});
      historyPageObserver.observe(footer);
    }
  }
