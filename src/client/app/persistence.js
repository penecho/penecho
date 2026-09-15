// Canvas snapshots, export, drawing history, strokes, and lasso selection.
  const SNAPSHOT_DB = "penecho-canvas-history",
    SNAPSHOT_STORE = "snapshots",
    SNAPSHOT_TILE_STORE = "snapshot-tiles",
    SNAPSHOT_TILE_DECODE_BATCH_SIZE = 8,
    SNAPSHOT_IMAGE_DECODE_BATCH_SIZE = 4,
    SNAPSHOT_LOCATIONS = new Set(["device", "server", "cloud"]),
    SERVER_DEFAULT_PROJECT_ID = "uncategorized",
    SERVER_ALL_PROJECTS_ID = "all",
    SERVER_PROJECT_SESSION_KEY = "penecho-selected-canvas-project",
    CLOUD_ALL_PROJECTS_ID = "all",
    CLOUD_PROJECT_SESSION_KEY = "penecho-selected-cloud-project",
    HISTORY_VIEW_STORAGE_KEY = "penecho-history-view-v2";
  let snapshotDbPromise = null,
    snapshotItems = [],
    snapshotSaveInProgress = false,
    canvasSnapshotFinalizationDepth = 0,
    snapshotListGeneration = 0,
    historyListRenderGeneration = 0,
    historyListRenderFrame = 0,
    historyOpenWorkGeneration = 0,
    historyNoticeTimer = 0,
    historyActivityTimer = 0,
    historyPreviewUrls = new Map(),
    historyPreviewLoader = null,
    snapshotListInProgress = false,
    snapshotLoadInProgress = false,
    snapshotLoadingId = null,
    snapshotItemsLocation = null,
    snapshotListFailedLocation = null,
    snapshotLocationCountCache = new Map(),
    serverSnapshotUnavailableKey = "",
    serverCanvasProjects = [],
    selectedServerProjectId = storedServerProjectId(),
    cloudCanvasProjects = [],
    cloudHistoryCache = null,
    selectedCloudProjectId = storedCloudProjectId(),
    cloudHistorySignInRequired = false,
    pendingCanvasTransition = null,
    historyDeletePending = null,
    historySelectedSnapshotId = null,
    historySelectedSnapshotLocation = null,
    historyGridSelectionActivated = false;
  function currentCanvasDisplayName() {
    return state.currentCanvasSuggestedName || state.currentSnapshotName;
  }
  function currentCanvasNeedsAgentName() {
    return !state.currentSnapshotHasExplicitName && !state.currentCanvasSuggestedName;
  }
  function applyCurrentCanvasGeneratedName(value) {
    const name=String(value||"").replace(/\s+/g," ").trim().slice(0,48).trim();
    if(!name||!currentCanvasNeedsAgentName())return false;
    state.currentCanvasSuggestedName=name;
    window.PenEchoStudioNavigator?.updateDocument?.();
    window.PenEchoStudioNavigator?.renderAgent?.();
    return true;
  }
  function validServerProjectSelection(projectId) {
    return projectId === SERVER_DEFAULT_PROJECT_ID || projectId === SERVER_ALL_PROJECTS_ID || /^project-[a-zA-Z0-9-]{8,64}$/.test(projectId || "");
  }
  function storedServerProjectId() {
    try {
      const projectId = sessionStorage.getItem(SERVER_PROJECT_SESSION_KEY);
      return validServerProjectSelection(projectId) ? projectId : SERVER_DEFAULT_PROJECT_ID;
    } catch {
      return SERVER_DEFAULT_PROJECT_ID;
    }
  }
  function rememberSelectedServerProject(projectId) {
    selectedServerProjectId = validServerProjectSelection(projectId) ? projectId : SERVER_DEFAULT_PROJECT_ID;
    try { sessionStorage.setItem(SERVER_PROJECT_SESSION_KEY, selectedServerProjectId); } catch {}
    return selectedServerProjectId;
  }
  function selectedServerSaveProjectId() {
    return selectedServerProjectId === SERVER_ALL_PROJECTS_ID ? SERVER_DEFAULT_PROJECT_ID : selectedServerProjectId;
  }
  function validCloudProjectSelection(projectId) {
    return projectId === CLOUD_ALL_PROJECTS_ID || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId || "");
  }
  function storedCloudProjectId() {
    try {
      const projectId = sessionStorage.getItem(CLOUD_PROJECT_SESSION_KEY);
      return validCloudProjectSelection(projectId) ? projectId : CLOUD_ALL_PROJECTS_ID;
    } catch {
      return CLOUD_ALL_PROJECTS_ID;
    }
  }
  function rememberSelectedCloudProject(projectId) {
    selectedCloudProjectId = validCloudProjectSelection(projectId) ? projectId : CLOUD_ALL_PROJECTS_ID;
    try { sessionStorage.setItem(CLOUD_PROJECT_SESSION_KEY, selectedCloudProjectId); } catch {}
    return selectedCloudProjectId;
  }
  function cloudDefaultProjectId() {
    return cloudCanvasProjects.find((project) => project.systemKey === "uncategorized")?.id || cloudCanvasProjects[0]?.id || null;
  }
  function selectedCloudSaveProjectId() {
    return selectedCloudProjectId === CLOUD_ALL_PROJECTS_ID ? cloudDefaultProjectId() : selectedCloudProjectId;
  }
  function snapshotLocationLabel(location = state.snapshotLocation) {
    return t(location === "server" ? "storagePenEchoServer" : location === "cloud" ? "storagePenEchoCloud" : "storageThisDevice");
  }
  function cloudHistoryCopy(key) {
    return t({
      title:"snapshotCloudSignInRequired",
      description:"snapshotCloudSignInHint",
      action:"openPenEchoCloud",
      confirmExternalOpen:"openCloudCanvasUnsaved",
    }[key] || key);
  }
  function cloudHistoryRequiresSignIn(error) {
    // Only the connector's explicit session-invalid contract may turn Cloud
    // History into a signed-out state. A generic 401 can come from a proxy or
    // an unrelated request and must remain an ordinary recoverable error.
    return String(error?.code || "") === "cloud_sign_in_required";
  }
  function cacheCloudHistory(items) {
    cloudHistoryCache = {
      items:Array.isArray(items) ? items.slice() : [],
      projects:cloudCanvasProjects.slice(),
    };
  }
  function restoreCloudHistoryCache() {
    if (!cloudHistoryCache) return false;
    snapshotItems = cloudHistoryCache.items.slice();
    cloudCanvasProjects = cloudHistoryCache.projects.slice();
    snapshotItemsLocation = "cloud";
    return true;
  }
  function clearCloudHistoryCache() {
    cloudHistoryCache = null;
  }
  function updateSnapshotLocationUi() {
    const location = SNAPSHOT_LOCATIONS.has(state.snapshotLocation) ? state.snapshotLocation : "device",
      descriptionKey = location === "server" ? "storagePenEchoServerDescription" : location === "cloud" ? "storagePenEchoCloudDescription" : "storageThisDeviceDescription";
    document.querySelectorAll('input[name="historyStorageLocation"], input[name="newCanvasStorageLocation"]').forEach((input) => {
      input.checked = input.value === location;
    });
    for (const id of ["historyStorageDescription", "newCanvasStorageDescription"]) {
      const description = document.querySelector(`#${id}`);
      if (description) description.textContent = t(descriptionKey);
    }
    renderServerProjectUi();
  }
  function setSnapshotLocation(location, { refresh = true } = {}) {
    if (!SNAPSHOT_LOCATIONS.has(location) || state.snapshotLocation === location) {
      updateSnapshotLocationUi();
      if (location === "cloud" && snapshotItemsLocation !== "cloud" && restoreCloudHistoryCache()) renderSnapshotList();
      return refresh ? refreshSnapshots() : Promise.resolve(false);
    }
    if (snapshotLoadInProgress) {
      state.snapshotLoadGeneration++;
      snapshotLoadInProgress = false;
      snapshotLoadingId = null;
    }
    state.snapshotLocation = location;
    localStorage.setItem("penecho-snapshot-location", location);
    snapshotItems = [];
    snapshotItemsLocation = null;
    if (location === "cloud") cloudCanvasProjects = [];
    else if (location === "server") serverCanvasProjects = [];
    updateSnapshotLocationUi();
    updateNewCanvasDialog();
    if (location === "cloud" && restoreCloudHistoryCache()) renderSnapshotList();
    else renderSnapshotListLoading(location);
    if (!refresh) return Promise.resolve(true);
    const request = refreshSnapshots();
    request.catch((error) => {
      if (location !== "cloud" || !cloudHistoryRequiresSignIn(error)) setStatus(`${t("snapshotError")}${error.message}`);
    });
    return request;
  }
  function updateHistorySaveFeedbackLanguage() {
    const button = document.querySelector("#historySave"),
      currentButton = document.querySelector("#historySaveCurrent"),
      notice = document.querySelector("#historyNotice");
    if (button) button.textContent = t(snapshotSaveInProgress ? "snapshotSavingShort" : "saveSnapshot");
    if (currentButton) currentButton.textContent = t(snapshotSaveInProgress ? "snapshotSavingShort" : "saveCurrentSnapshot");
    if (notice?.dataset.messageKey) notice.textContent = t(notice.dataset.messageKey);
    updateSnapshotLocationUi();
  }
  function showHistoryNotice(text, tone = "info", { messageKey = "", duration = 2800 } = {}) {
    const notice = document.querySelector("#historyNotice");
    if (!notice) return;
    clearTimeout(historyNoticeTimer);
    notice.textContent = text;
    notice.dataset.messageKey = messageKey;
    notice.dataset.tone = tone;
    notice.classList.add("visible");
    if (duration > 0) {
      historyNoticeTimer = setTimeout(() => {
        notice.classList.remove("visible");
        notice.dataset.messageKey = "";
        notice.textContent = "";
      }, duration);
    }
  }
  function showHistoryNoticeKey(key, tone = "info", duration = 2800) {
    showHistoryNotice(t(key), tone, { messageKey: key, duration });
  }
  function closeHistorySavePanel(focusSummary = false) {
    const panel = document.querySelector("#historySavePanel");
    if (!panel?.open) return false;
    panel.open = false;
    if (focusSummary) panel.querySelector("summary")?.focus({ preventScroll:true });
    return true;
  }
  function setHistoryActivity(text, detail = "", progress = null, tone = "busy") {
    const activity = document.querySelector("#historyActivity"),
      title = document.querySelector("#historyActivityTitle"),
      description = document.querySelector("#historyActivityDetail"),
      bar = document.querySelector("#historyActivityProgress");
    if (!activity || !title || !description || !bar) return;
    clearTimeout(historyActivityTimer);
    activity.hidden = false;
    activity.dataset.tone = tone;
    title.textContent = text;
    description.textContent = detail;
    bar.hidden = tone === "error";
    if (Number.isFinite(progress)) bar.value = Math.max(0, Math.min(100, progress));
    else bar.removeAttribute("value");
  }
  function snapshotByteLabel(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function hideHistoryActivity(delay = 0) {
    clearTimeout(historyActivityTimer);
    const hide = () => {
      const activity = document.querySelector("#historyActivity");
      if (activity && !snapshotListInProgress && !snapshotLoadInProgress) activity.hidden = true;
    };
    if (delay > 0) historyActivityTimer = setTimeout(hide, delay);
    else hide();
  }
  function historyBusy() { return snapshotSaveInProgress || snapshotListInProgress || snapshotLoadInProgress; }
  function updateHistoryReadControls() {
    const busy = historyBusy(), cloudBlocked = state.snapshotLocation === "cloud" && cloudHistorySignInRequired,
      currentSaveLocation = state.currentSnapshotLocation || state.snapshotLocation,
      currentSaveBlocked = currentSaveLocation === "cloud" && cloudHistorySignInRequired,
      panel = document.querySelector("#historyPanel");
    if (panel) panel.setAttribute("aria-busy", String(snapshotListInProgress || snapshotLoadInProgress));
    document.querySelectorAll('input[name="historyStorageLocation"]').forEach((control) => (control.disabled = snapshotSaveInProgress));
    document.querySelectorAll('#historyProjectSelect, #historyProjectCreate, #historyName, #historySave').forEach((control) => (control.disabled = busy || cloudBlocked));
    const projectDelete = document.querySelector("#historyProjectDelete");
    if (projectDelete) projectDelete.disabled = busy || cloudBlocked || projectDelete.dataset.projectProtected === "true";
    const currentSave = document.querySelector("#historySaveCurrent");
    if (currentSave) currentSave.disabled = busy || currentSaveBlocked;
    const topSave = document.querySelector("#saveCanvasBtn");
    if (topSave) topSave.disabled = snapshotSaveInProgress || currentSaveBlocked;
    document.querySelectorAll(".history-load, .history-delete, .history-move, .history-rename").forEach((control) => (control.disabled = busy));
    document.querySelectorAll(".history-save-current").forEach((control) => {
      control.disabled = busy || currentSaveBlocked;
      control.textContent = t(snapshotSaveInProgress ? "snapshotSavingShort" : "saveCurrentSnapshot");
      if (snapshotSaveInProgress) control.setAttribute("aria-busy", "true");
      else control.removeAttribute("aria-busy");
    });
    document.querySelectorAll(".history-card").forEach((card) => card.classList.toggle("loading", snapshotLoadInProgress && card.dataset.snapshotId === snapshotLoadingId));
    document.querySelectorAll(".history-load").forEach((button) => {
      const active = snapshotLoadInProgress && button.dataset.snapshotId === snapshotLoadingId;
      const label = button.querySelector(".history-open-label");
      if (label) label.textContent = t(active ? "snapshotLoadingShort" : "historyOpenCanvas");
      else button.textContent = t(active ? "snapshotLoadingShort" : "loadSnapshot");
      if (active) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    });
    updateHistorySelectionUi();
  }
  function setHistorySaveBusy(busy) {
    const button = document.querySelector("#historySave"),
      currentButton = document.querySelector("#historySaveCurrent"),
      saveButton = document.querySelector("#saveCanvasBtn");
    snapshotSaveInProgress = busy;
    if (button) {
      button.disabled = busy;
      button.classList.toggle("is-saving", busy);
      button.setAttribute("aria-busy", String(busy));
      button.textContent = t(busy ? "snapshotSavingShort" : "saveSnapshot");
    }
    if (currentButton) {
      currentButton.disabled = busy;
      currentButton.classList.toggle("is-saving", busy);
      currentButton.setAttribute("aria-busy", String(busy));
      currentButton.textContent = t(busy ? "snapshotSavingShort" : "saveCurrentSnapshot");
    }
    if (saveButton) {
      saveButton.disabled = busy;
      saveButton.classList.toggle("is-saving", busy);
      saveButton.setAttribute("aria-busy", String(busy));
    }
    window.PenEchoStudioNavigator?.updateDocument?.();
    if (!busy) renderServerProjectUi();
    updateHistoryReadControls();
  }
  async function saveSnapshotFromHistory() {
    if (snapshotSaveInProgress) return;
    setHistorySaveBusy(true);
    showHistoryNoticeKey("snapshotSaving", "busy", 0);
    try {
      const selectionBusy = selectionAIBusy(),
        selectionBusyKey = selectionAIStatusKey(),
        id = await saveSnapshot();
      showHistoryNoticeKey(id ? "snapshotSaved" : selectionBusy ? selectionBusyKey : "emptyCanvas", id ? "success" : "info");
    } catch (error) {
      const message = `${t("snapshotError")}${error.message}`;
      setStatus(message);
      showHistoryNotice(message, "error", { duration: 5000 });
    } finally {
      setHistorySaveBusy(false);
    }
  }
  async function saveCurrentCanvas() {
    if (snapshotSaveInProgress) return;
    const location = state.currentSnapshotLocation || (window.PENECHO_CONFIG?.browserCanvasEditing ? "cloud" : state.snapshotLocation),
      overwriteId = state.currentSnapshotId && state.currentSnapshotLocation === location ? state.currentSnapshotId : null,
      requestedName = document.querySelector("#historyName")?.value.trim(),
      name = requestedName || currentCanvasDisplayName();
    setHistorySaveBusy(true);
    showHistoryNoticeKey("snapshotSaving", "busy", 0);
    try {
      if (location === "cloud" && !overwriteId) await cloudSnapshotItems();
      const selectionBusy = selectionAIBusy(),
        selectionBusyKey = selectionAIStatusKey(),
        id = await saveSnapshot({ overwriteId, name, location });
      showHistoryNoticeKey(id ? (overwriteId ? "snapshotOverwritten" : "snapshotSaved") : selectionBusy ? selectionBusyKey : "emptyCanvas", id ? "success" : "info");
    } catch (error) {
      const message = `${t("snapshotError")}${error.message}`;
      setStatus(message);
      showHistoryNotice(message, "error", { duration:5000 });
    } finally {
      setHistorySaveBusy(false);
    }
  }
  async function saveCurrentHistoryItem(item, location) {
    if (snapshotSaveInProgress || !item || item.id !== state.currentSnapshotId || location !== state.currentSnapshotLocation) return false;
    setHistorySaveBusy(true);
    showHistoryNoticeKey("snapshotSaving", "busy", 0);
    try {
      const selectionBusy = selectionAIBusy(),
        selectionBusyKey = selectionAIStatusKey(),
        id = await saveSnapshot({ overwriteId:item.id, name:currentCanvasDisplayName() || snapshotName(item), location });
      showHistoryNoticeKey(id ? "snapshotOverwritten" : selectionBusy ? selectionBusyKey : "emptyCanvas", id ? "success" : "info");
      return Boolean(id);
    } catch (error) {
      const message = `${t("snapshotError")}${error.message}`;
      setStatus(message);
      showHistoryNotice(message, "error", { duration:5000 });
      return false;
    } finally {
      setHistorySaveBusy(false);
    }
  }
  async function renameCurrentCanvasFromTitle(value) {
    if (snapshotSaveInProgress) return false;
    const name = String(value || "").trim().slice(0, 48),
      location = state.currentSnapshotLocation || state.snapshotLocation,
      overwriteId = state.currentSnapshotId && state.currentSnapshotLocation === location ? state.currentSnapshotId : null;
    if (!name) throw Error(t("canvasNameRequired"));
    if (name === state.currentSnapshotName) return true;
    setHistorySaveBusy(true);
    showHistoryNoticeKey("snapshotSaving", "busy", 0);
    try {
      const id = await saveSnapshot({ overwriteId, name, location, allowEmpty:true });
      if (!id) {
        showHistoryNoticeKey(selectionAIBusy() ? selectionAIStatusKey() : "emptyCanvas", "info");
        return false;
      }
      showHistoryNoticeKey("canvasRenamed", "success");
      return true;
    } catch (error) {
      const message = `${t("snapshotError")}${error.message}`;
      setStatus(message);
      showHistoryNotice(message, "error", { duration:5000 });
      return false;
    } finally {
      setHistorySaveBusy(false);
    }
  }
  function snapshotDb() {
    if (snapshotDbPromise) return snapshotDbPromise;
    snapshotDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(SNAPSHOT_DB, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(SNAPSHOT_TILE_STORE)) {
          const store = db.createObjectStore(SNAPSHOT_TILE_STORE, { keyPath: "id" });
          store.createIndex("snapshotId", "snapshotId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("Could not open IndexedDB"));
    });
    return snapshotDbPromise;
  }
  function canvasBlob(canvas, type = "image/png", quality, execution = null) {
    if(execution?.kind!=="mcp") {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(Error("Could not encode canvas"))), type, quality));
      }

    const pending=canvasBlob.pending||(canvasBlob.pending=new Set());
    if(pending.size>=128)return Promise.reject(Object.assign(Error("Canvas image encoders are still finishing."),{code:"CANVAS_BUSY"}));
    const resource={};pending.add(resource);

    return new Promise((resolve, reject) => {
      let settled=false;
      const finish=(error,blob)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(blob);};
      const timer=setTimeout(()=>finish(Error("Canvas encoding timed out")),15_000);
      try { canvas.toBlob(blob => {pending.delete(resource);blob ? finish(null,blob) : finish(Error("Could not encode canvas"));}, type, quality); }
      catch(error){pending.delete(resource);finish(error);}
    });
  }
  function communityCanvasHasContent(canvas) {
    const sample=document.createElement("canvas"),width=Math.min(64,canvas.width),height=Math.min(64,canvas.height);
    sample.width=Math.max(1,width);
    sample.height=Math.max(1,height);
    const context=sample.getContext("2d",{willReadFrequently:true});
    context.drawImage(canvas,0,0,sample.width,sample.height);
    const pixels=context.getImageData(0,0,sample.width,sample.height).data;
    sample.width=sample.height=1;
    let visible=0,nonWhite=0,min=255,max=0;
    for(let offset=0;offset<pixels.length;offset+=4){
      const alpha=pixels[offset+3];
      if(alpha<12)continue;
      visible++;
      const luminance=(pixels[offset]*299+pixels[offset+1]*587+pixels[offset+2]*114)/1000;
      min=Math.min(min,luminance);
      max=Math.max(max,luminance);
      if(luminance<246)nonWhite++;
    }
    return visible>0&&(nonWhite>0||max-min>5);
  }
  async function communityImageForCanvas(canvas,{maximumBytes,initialQuality}) {
    if(!(canvas instanceof HTMLCanvasElement)||!Number.isInteger(canvas.width)||!Number.isInteger(canvas.height)
      ||canvas.width<1||canvas.height<1||canvas.width>2048||canvas.height>2048)throw Error("The generated community image must be between 1 and 2048 pixels on each side.");
    if(!communityCanvasHasContent(canvas))throw Error("The generated community image does not contain visible content.");
    const qualities=[initialQuality,.78,.70,.62,.54,.46,.38];
    for (const quality of qualities) {
      const blob=await canvasBlob(canvas,"image/webp",quality);
      if (blob.type !== "image/webp") throw Error("This browser could not create the required WebP community preview.");
      if (blob.size<=maximumBytes) {
        const decoded=await imageFromBlob(blob),width=decoded.naturalWidth||decoded.width,height=decoded.naturalHeight||decoded.height;
        if(width!==canvas.width||height!==canvas.height)throw Error("The generated WebP image failed dimension validation.");
        const dataUrl=await blobDataUrl(blob);
        return { contentType:"image/webp",width,height,dataBase64:dataUrl.split(",",2)[1] };
      }
    }
    throw Error("This preview is too detailed to share. Simplify the view or zoom out, then try again.");
  }
  async function communityImagesForCanvas(canvas,initialQuality=.82) {
    const preview=await communityImageForCanvas(canvas,{maximumBytes:4*1024*1024,initialQuality}),maximum=1200,
      scale=Math.min(1,maximum/canvas.width,maximum/canvas.height),thumbnailCanvas=document.createElement("canvas");
    thumbnailCanvas.width=Math.max(1,Math.round(canvas.width*scale));
    thumbnailCanvas.height=Math.max(1,Math.round(canvas.height*scale));
    thumbnailCanvas.getContext("2d").drawImage(canvas,0,0,thumbnailCanvas.width,thumbnailCanvas.height);
    const thumbnail=await communityImageForCanvas(thumbnailCanvas,{maximumBytes:768*1024,initialQuality:.78});
    thumbnailCanvas.width=thumbnailCanvas.height=1;
    const socialCanvas=document.createElement("canvas"),socialWidth=1200,socialHeight=630,padding=24;
    socialCanvas.width=socialWidth;
    socialCanvas.height=socialHeight;
    const socialContext=socialCanvas.getContext("2d"),socialScale=Math.min(
      (socialWidth-padding*2)/canvas.width,
      (socialHeight-padding*2)/canvas.height,
    ),drawWidth=Math.max(1,Math.round(canvas.width*socialScale)),drawHeight=Math.max(1,Math.round(canvas.height*socialScale));
    socialContext.fillStyle="#f8fafc";
    socialContext.fillRect(0,0,socialWidth,socialHeight);
    socialContext.drawImage(canvas,Math.round((socialWidth-drawWidth)/2),Math.round((socialHeight-drawHeight)/2),drawWidth,drawHeight);
    const socialBlob=await canvasBlob(socialCanvas,"image/png"),socialImage=await imageFromBlob(socialBlob);
    if(socialBlob.type!=="image/png"||socialBlob.size>5*1024*1024
      ||(socialImage.naturalWidth||socialImage.width)!==socialWidth||(socialImage.naturalHeight||socialImage.height)!==socialHeight){
      throw Error("The generated social card failed validation.");
    }
    const socialDataUrl=await blobDataUrl(socialBlob);
    socialCanvas.width=socialCanvas.height=1;
    return {
      communityPreview:preview,
      communityThumbnail:thumbnail,
      communitySocialCard:{contentType:"image/png",width:socialWidth,height:socialHeight,dataBase64:socialDataUrl.split(",",2)[1]},
    };
  }
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("IndexedDB request failed"));
    });
  }
  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error || Error("IndexedDB transaction failed"));
    });
  }
  async function allSnapshots() {
    const db = await snapshotDb(),
      items = await requestResult(db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll());
    return items.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  }
  function blobDataUrl(blob, execution = null) {
    if(execution?.kind!=="mcp") {
    return new Promise((resolve, reject) => {
      if (!(blob instanceof Blob)) return reject(Error("Snapshot contains invalid binary data"));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || Error("Could not encode snapshot data"));
      reader.readAsDataURL(blob);
    });
      }

    return new Promise((resolve, reject) => {
      if (!(blob instanceof Blob)) return reject(Error("Snapshot contains invalid binary data"));
      const reader = new FileReader();let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);reader.onload=reader.onerror=reader.onabort=null;error?reject(error):resolve(value);};
      const timer=setTimeout(()=>{finish(Error("Snapshot data encoding timed out"));try{reader.abort();}catch{}},15_000);
      reader.onload = () => finish(null,String(reader.result || ""));
      reader.onerror = () => finish(reader.error || Error("Could not encode snapshot data"));
      reader.onabort = () => finish(Error("Snapshot data encoding was cancelled"));
      reader.readAsDataURL(blob);
    });
  }
  function dataUrlBlob(value) {
    if (typeof value !== "string") throw Error("Snapshot contains invalid encoded data");
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) throw Error("Snapshot contains invalid encoded data");
    const binary = atob(match[2]),
      bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type:match[1] });
  }
  async function snapshotPreviewBlob() {
    try {
      return await canvasBlob(snapshotPreview(), "image/webp", .78);
    } catch (error) {
      console.warn("PenEcho snapshot thumbnail failed; saving with a fallback thumbnail:", error);
      return dataUrlBlob("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
    }
  }
  async function cloudSnapshotPreviewBlob() {
    const canvas = snapshotPreview();
    try {
      for (const quality of [.78, .66, .54, .42]) {
        const blob = await canvasBlob(canvas, "image/webp", quality);
        if (blob.type === "image/webp" && blob.size <= 512 * 1024) return blob;
      }
      throw Error("The Cloud preview is too detailed. Zoom out or simplify the visible Canvas, then save again.");
    } finally {
      canvas.width = canvas.height = 1;
    }
  }
  async function snapshotJsonBody(response, onProgress) {
    if (typeof onProgress !== "function" || !response.body?.getReader) return response.json();
    const total = Number(response.headers.get("content-length")) || 0,
      reader = response.body.getReader(), chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress(total > 0 ? Math.min(1, received / total) : null, received, total);
    }
    return JSON.parse(await new Blob(chunks, { type:"application/json" }).text());
  }
  async function snapshotApiResponse(response, onProgress = null) {
    let body = null;
    try { body = await snapshotJsonBody(response, onProgress); } catch {}
    if (!response.ok) {
      const error = Error(body?.error || `PenEcho server returned HTTP ${response.status}`);
      error.status = response.status;
      error.code = body?.code || body?.error || null;
      throw error;
    }
    return body;
  }
  async function serverSnapshotItems() {
    const [canvasResponse, projectResponse] = await Promise.all([
        fetch("/api/canvases?metadataOnly=1", { credentials:"same-origin", cache:"no-store", headers:authenticatedApiHeaders(), signal:AbortSignal.timeout(12000) }),
        fetch("/api/canvas-projects", { credentials:"same-origin", cache:"no-store", headers:authenticatedApiHeaders(), signal:AbortSignal.timeout(12000) }),
      ]),
      body = await snapshotApiResponse(canvasResponse),
      projectBody = projectResponse.ok ? await snapshotApiResponse(projectResponse) : null;
    serverCanvasProjects = Array.isArray(projectBody?.projects) ? projectBody.projects : [{ id:SERVER_DEFAULT_PROJECT_ID, name:"Uncategorized", system:true }];
    if (!serverCanvasProjects.some((project) => project.id === selectedServerProjectId) && selectedServerProjectId !== SERVER_ALL_PROJECTS_ID) rememberSelectedServerProject(SERVER_DEFAULT_PROJECT_ID);
    return Promise.all((Array.isArray(body?.canvases) ? body.canvases : []).map(async (item) => ({
      ...item,
      projectId:item.projectId || SERVER_DEFAULT_PROJECT_ID,
      preview:item.preview ? dataUrlBlob(item.preview) : null,
    }))).then((items) => items.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)));
  }
  async function cloudSnapshotItems() {
    const response = await fetch("/api/cloud/library", { credentials:"same-origin", cache:"no-store", headers:authenticatedApiHeaders() }),
      body = await snapshotApiResponse(response);
    if (body?.sync?.bundleVersion !== 2 || body.sync.conflictPolicy !== "base-revision-required") throw Error("PenEcho Cloud does not support this Canvas sync version");
    cloudCanvasProjects = Array.isArray(body.projects) ? body.projects : [];
    const selectedExists = selectedCloudProjectId === CLOUD_ALL_PROJECTS_ID || cloudCanvasProjects.some((project) => project.id === selectedCloudProjectId);
    if (!selectedExists) rememberSelectedCloudProject(cloudDefaultProjectId() || CLOUD_ALL_PROJECTS_ID);
    return (Array.isArray(body.canvases) ? body.canvases : []).map((item) => ({
      ...item,
      preview:typeof item.previewDataUrl === "string" && item.previewDataUrl ? dataUrlBlob(item.previewDataUrl) : null,
    })).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  }
  async function snapshotsAt(location) {
    if (location === "server") await window.PenEchoLinkedDevice?.refresh({ ifNeeded:true });
    return location === "server" ? serverSnapshotItems() : location === "cloud" ? cloudSnapshotItems() : allSnapshots();
  }
  function animationBounds(region = null) {
    if (!pluginEnabled("animation")) return null;
    let bounds = null;
    for (const animation of visibleAnimations(region)) {
      const box = animationBox(animation),
        visible = region ? intersection(box, region) : box;
      if (visible) bounds = unionLocalBounds(bounds, visible);
    }
    return bounds;
  }
  function snapshotPreview(width = 640, height = 426) {
    const preview = offscreen(width, height),
      q = preview.getContext("2d"),
      bounds = unionLocalBounds(unionLocalBounds(unionLocalBounds(unionLocalBounds(visibleInkBounds({ x:0, y:0, w:SIZE, h:SIZE }), imageBounds()), textBoxBounds()), animationBounds()), widgetBounds());
    q.fillStyle = state.paint.paper;
    q.fillRect(0, 0, preview.width, preview.height);
    if (!bounds) return preview;
    const pad = 8,
      scale = Math.min((preview.width - pad * 2) / bounds.w, (preview.height - pad * 2) / bounds.h),
      dx = (preview.width - bounds.w * scale) / 2,
      dy = (preview.height - bounds.h * scale) / 2;
    const captureTime = performance.now();
    q.save();
    q.setTransform(scale, 0, 0, scale, dx - bounds.x * scale, dy - bounds.y * scale);
    drawAnimationsToContext(q, bounds, captureTime);
    drawWidgetsToContext(q, bounds);
    drawImagesToContext(q, bounds);
    drawTextBoxesToContext(q, bounds);
    q.restore();
    for (const [k, canvas] of tiles) {
      const [tx, ty] = k.split(",").map(Number),
        x = tx * TILE,
        y = ty * TILE;
      if (!intersection({ x, y, w: TILE, h: TILE }, bounds)) continue;
      q.drawImage(canvas, dx + (x - bounds.x) * scale, dy + (y - bounds.y) * scale, TILE * scale, TILE * scale);
    }
    q.save();
    q.setTransform(scale, 0, 0, scale, dx - bounds.x * scale, dy - bounds.y * scale);
    drawSharpOverlays(q, bounds);
    q.restore();
    return preview;
  }
  function exportInkBounds() {
    let bounds = null;
    for (const [tileKey, tileCanvas] of tiles) {
      const [tx, ty] = tileKey.split(",").map(Number),
        ink = inkBox(tileCanvas, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE));
      if (!ink) continue;
      state.inkBounds.set(tileKey, ink);
      bounds = unionLocalBounds(bounds, { x: tx * TILE + ink.x, y: ty * TILE + ink.y, w: ink.w, h: ink.h });
    }
    bounds = unionLocalBounds(bounds, animationBounds());
    bounds = unionLocalBounds(bounds, imageBounds());
    bounds = unionLocalBounds(bounds, textBoxBounds());
    bounds = unionLocalBounds(bounds, widgetBounds());
    const selection = state.selection;
    if (selection?.phase !== "active") return bounds;
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      bounds = unionLocalBounds(bounds, target);
    }
    return bounds;
  }
  function exportRegion() {
    const ink = exportInkBounds();
    if (!ink) return null;
    const x = Math.floor(ink.x) - TILE,
      y = Math.floor(ink.y) - TILE,
      right = Math.ceil(ink.x + ink.w) + TILE,
      bottom = Math.ceil(ink.y + ink.h) + TILE;
    return { x, y, w: right - x, h: bottom - y };
  }
  async function renderExportCanvas() {
    const region = exportRegion();
    if (!region) return null;
    try { await prepareVisibleWidgetSnapshots(null, false, null, true); }
    catch (error) {
      // A fresh raster is optional when every Widget already has usable pixels.
      // Never silently omit a Widget from an image download.
      if (capturableWidgets(region).some(widget => !widget.snapshotImage || widget.snapshotVersion < widget.contentVersion)) throw error;
      debug("widget-export-cached", {error:String(error?.message || error).slice(0,300)});
    }
    const scale = Math.min(CANVAS_DOWNLOAD_RESOLUTION_SCALE, EXPORT_MAX_DIMENSION / region.w, EXPORT_MAX_DIMENSION / region.h, Math.sqrt(EXPORT_MAX_PIXELS / (region.w * region.h))),
      canvas = offscreen(Math.max(1, Math.ceil(region.w * scale)), Math.max(1, Math.ceil(region.h * scale))),
      context = canvas.getContext("2d");
    const captureTime = performance.now();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = state.paint.paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
    if (state.gridVisible) drawCanvasLineGrid(context, region, scale);
    drawAnimationsToContext(context, region, captureTime);
    drawWidgetsToContext(context, region);
    drawImagesToContext(context, region);
    drawTextBoxesToContext(context, region);
    for (const [tileKey, tileCanvas] of tiles) {
      const [tx, ty] = tileKey.split(",").map(Number),
        x = tx * TILE,
        y = ty * TILE;
      if (intersection({ x, y, w: TILE, h: TILE }, region)) context.drawImage(tileCanvas, x, y);
    }
    drawSharpOverlays(context, region);
    const selection = state.selection;
    if (selection?.phase === "active")
      for (const fragment of selection.fragments) {
        const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
        context.drawImage(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
      }
    context.restore();
    return canvas;
  }
  function exportFilename() {
    const now = new Date(),
      pad = (value) => String(value).padStart(2, "0");
    return `penecho-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
  }
  async function exportCanvasPng() {
    const buttons = [document.querySelector("#exportPngBtn"), canvasViewDownloadButton].filter(Boolean);
    if (buttons.some(button => button.disabled)) return;
    for (const button of buttons) button.disabled = true;
    let canvas = null;
    try {
      canvas = await renderExportCanvas();
      if (!canvas) {
        setStatusKey("emptyCanvas");
        return;
      }
      const blob = await canvasBlob(canvas),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = exportFilename();
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatusKey("exportComplete");
    } catch (error) {
      setStatus(`${t("exportError")}${error.message}`);
    } finally {
      if (canvas) canvas.width = canvas.height = 1;
      for (const button of buttons) button.disabled = false;
    }
  }
  function imageFromBlob(blob, execution = null) {
    if(execution?.kind!=="mcp") {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob),
        image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(Error("Could not decode snapshot tile"));
      };
      image.src = url;
    });
      }

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob),
        image = new Image();
      let settled=false;
      const finish=(error)=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        image.onload=image.onerror=null;
        URL.revokeObjectURL(url);
        error?reject(error):resolve(image);
      };
      const timer=setTimeout(()=>{image.src="";finish(Error("Snapshot tile decoding timed out"));},15_000);
      image.onload = () => {
        finish();
      };
      image.onerror = () => {
        finish(Error("Could not decode snapshot tile"));
      };
      image.src = url;
    });
  }
  function releaseSnapshotTileCanvases(canvases) {
    for (const canvas of canvases.values()) canvas.width = canvas.height = 1;
    canvases.clear();
  }
  function waitForSnapshotTileFrame(signal = null) {
      if(!signal) {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
        }

    return new Promise((resolve) => {
      let frame = null, timer = null, finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (frame !== null) cancelAnimationFrame(frame);
        if (timer !== null) clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        document.removeEventListener("visibilitychange", visibilityChanged);
        resolve();
      };
      const visibilityChanged = () => { if (document.hidden) finish(); };
      if (signal?.aborted) { finish(); return; }
      signal?.addEventListener("abort", finish, { once:true });
      document.addEventListener("visibilitychange", visibilityChanged);
      // Foreground decoding yields to paint. Hidden or suspended animation
      // frames must not retain the Canvas operation queue indefinitely.
      frame = requestAnimationFrame(finish);
      timer = setTimeout(finish, document.hidden ? 0 : 100);
    });
  }
  async function decodeSnapshotTilesInBatches(tileEntries, isCurrent, onProgress = null, execution = null) {
    const decodedTiles = new Map();
    try {
      if (!tileEntries.length) onProgress?.(1);
      for (let start = 0; start < tileEntries.length; start += SNAPSHOT_TILE_DECODE_BATCH_SIZE) {
        const end = Math.min(tileEntries.length, start + SNAPSHOT_TILE_DECODE_BATCH_SIZE),
          batch = await Promise.all(tileEntries.slice(start, end).map(async ({ k, blob }) => ({ k, image:await imageFromBlob(blob, execution) })));
        if (!isCurrent()) {
          batch.length = 0;
          releaseSnapshotTileCanvases(decodedTiles);
          return null;
        }
        for (const { k, image } of batch) {
          const canvas = offscreen(TILE, TILE),
            context = canvas.getContext("2d");
          if (!context) throw Error("Could not restore snapshot tile");
          context.drawImage(image, 0, 0);
          const previous = decodedTiles.get(k);
          if (previous) previous.width = previous.height = 1;
          decodedTiles.set(k, canvas);
        }
        onProgress?.(end / tileEntries.length);
        // Drop this batch's decoded image references before yielding. The tile
        // canvases retain the pixels needed for the atomic swap below.
        batch.length = 0;
        if (end < tileEntries.length) {
          await waitForSnapshotTileFrame(execution?.kind==="mcp" ? execution.controller.signal : null);
          if (!isCurrent()) {
            releaseSnapshotTileCanvases(decodedTiles);
            return null;
          }
        }
      }
      return decodedTiles;
    } catch (error) {
      releaseSnapshotTileCanvases(decodedTiles);
      throw error;
    }
  }
  async function decodeSnapshotImagesInBatches(items, isCurrent, onProgress = null, execution = null) {
    const source = Array.isArray(items) ? items.slice(0, MAX_VISIBLE_IMAGES) : [], decoded = [];
    if (!source.length) {
      onProgress?.(1);
      return decoded;
    }
    for (let start = 0; start < source.length; start += SNAPSHOT_IMAGE_DECODE_BATCH_SIZE) {
      const end = Math.min(source.length, start + SNAPSHOT_IMAGE_DECODE_BATCH_SIZE),
        batch = (await Promise.all(source.slice(start, end).map(item=>decodeStoredImage(item,execution)))).filter(Boolean);
      if (!isCurrent()) return null;
      decoded.push(...batch);
      onProgress?.(end / source.length);
      if (end < source.length) {
        await waitForSnapshotTileFrame(execution?.kind==="mcp" ? execution.controller.signal : null);
        if (!isCurrent()) return null;
      }
    }
    return decoded;
  }
  async function finalizeCanvasForSnapshot() {
    canvasSnapshotFinalizationDepth++;
    try {
      if (state.pendingWidget) acceptPendingWidget({ restoreMode:false });
      if (state.pending) acceptPending({ restoreMode:false });
      if (state.widgetEdit) acceptWidgetEdit();
      if (state.imageEdit) acceptImageEdit();
      if (state.animationEdit) acceptAnimationEdit();
      for (const editor of [...state.textEditors.values()]) await confirmTextEditor(editor);
    } finally {
      canvasSnapshotFinalizationDepth--;
    }
    if (state.selection) commitSelection();
    finishAIDraftHandMode();
  }
  async function saveDeviceSnapshot(item, tileEntries, overwriteId) {
    const db = await snapshotDb();
    let oldTileKeys = [];
    if (overwriteId) oldTileKeys = await requestResult(db.transaction(SNAPSHOT_TILE_STORE, "readonly").objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAllKeys(overwriteId));
    const transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).put(item);
    const tileStore = transaction.objectStore(SNAPSHOT_TILE_STORE);
    oldTileKeys.forEach((key) => tileStore.delete(key));
    tileEntries.forEach(({ k, blob }) => tileStore.put({ id:`${item.id}:${k}`, snapshotId:item.id, k, blob }));
    await transactionDone(transaction);
  }
  async function snapshotBundleAsset(kind, blob, metadata = {}) {
    const encoded = await blobDataUrl(blob),
      match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(encoded);
    if (!match) throw Error("Could not encode canvas bundle asset");
    return { kind, contentType:match[1], metadata, dataBase64:match[2] };
  }
  function snapshotExtensionObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return {};
    }
  }
  function snapshotCanvasObjectExtensions() {
    return { ...snapshotExtensionObject(state.currentSnapshotBundleExtensions), penechoObjectOrder:{
      version:1, frontKind:state.frontCanvasObjectKind, placedKind:state.frontPlacedCanvasObjectKind,
    } };
  }
  function restoreSnapshotCanvasObjectOrder(extensions) {
    const order = extensions?.penechoObjectOrder;
    restoreCanvasObjectFrontKinds(order?.version === 1 ? order.frontKind : "image", order?.version === 1 ? order.placedKind : "image");
  }
  function snapshotPreservedAssets(value) {
    if (!Array.isArray(value)) return [];
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return [];
    }
  }
  function snapshotBundleAssetBlob(asset) {
    if (!asset || typeof asset.contentType !== "string" || typeof asset.dataBase64 !== "string") throw Error("Canvas bundle contains an invalid asset");
    return dataUrlBlob(`data:${asset.contentType};base64,${asset.dataBase64}`);
  }
  async function serverSnapshotPayload(item, tileEntries) {
    const [previewAsset, tileAssets, imageAssets, widgetAssets] = await Promise.all([
      snapshotBundleAsset("preview", item.preview, { width:640, height:426 }),
      Promise.all(tileEntries.map(({ k, blob }) => snapshotBundleAsset("tile", blob, { tileKey:k }))),
      Promise.all(item.images.map(({ blob, ...image }) => snapshotBundleAsset("resource", blob, { resourceId:image.id, resourceType:"image", ...image }))),
      Promise.all(item.widgets.map((widget) => snapshotBundleAsset("widget", new Blob([JSON.stringify(widget)], { type:"application/json" }), { widgetId:widget.id, ...(widget.pluginId ? { pluginId:widget.pluginId } : {}) }))),
    ]);
    return {
      version:2,
      bundleVersion:2,
      mode:"snapshot",
      formatVersion:1,
      extensions:snapshotExtensionObject(item.bundleExtensions),
      id:item.id,
      createdAt:item.createdAt,
      updatedAt:item.updatedAt,
      name:item.name,
      projectId:item.projectId || SERVER_DEFAULT_PROJECT_ID,
      manifest:{
        format:"penecho-raster-tiles",
        formatVersion:1,
        canvasSize:{ width:SIZE, height:SIZE },
        tileSize:TILE,
        theme:item.theme,
        view:item.view,
        animations:item.animations,
        textBoxes:item.textBoxes,
        savedAt:new Date(item.updatedAt).toISOString(),
        extensions:snapshotExtensionObject(item.manifestExtensions),
      },
      assets:[...snapshotPreservedAssets(item.preservedAssets), ...tileAssets, ...widgetAssets, ...imageAssets, previewAsset],
    };
  }
  async function communityCanvasArtifact(name = "") {
    if (selectionAIBusy()) throw Error(t(selectionAIStatusKey()));
    await finalizeCanvasForSnapshot();
    if (!tiles.size && !state.images.length && !state.textBoxes.length && !state.preservedSnapshotAnimations.length && (!pluginEnabled("animation") || !state.animations.length) && !visibleWidgets().length) throw Error(t("emptyCanvas"));
    await prepareVisibleWidgetSnapshots(null, false);
    const previewCanvas=snapshotPreview(2048,1365),communityImages=await communityImagesForCanvas(previewCanvas,.78);
    previewCanvas.width=previewCanvas.height=1;
    const stamp=Date.now(),animations=serializedAnimations(),widgets=serializedWidgets(),textBoxes=storedTextBoxes(),images=storedImages(),
      tileEntries=await Promise.all([...tiles].map(async ([k, canvas]) => ({ k, blob:await canvasBlob(canvas) }))),
      preview=await snapshotPreviewBlob(),item={
        version:2,
        id:`community-${crypto.randomUUID?.() || stamp}`,
        createdAt:stamp,
        updatedAt:stamp,
        name:String(name || state.currentSnapshotName || "").trim().slice(0, 160),
        projectId:null,
        theme:state.theme,
        view:{ scale:state.scale, panX:state.panX, panY:state.panY, navigationLocked:state.navigationLocked },
        animations,
        widgets,
        textBoxes,
        images,
        preview,
        bundleExtensions:snapshotCanvasObjectExtensions(),
        manifestExtensions:snapshotExtensionObject(state.currentSnapshotManifestExtensions),
    };
    return { ...(await serverSnapshotPayload(item, tileEntries)), ...communityImages };
  }
  async function suggestCommunityMetadata({kind,artifact,current={}}) {
    const preview=artifact?.communityThumbnail||artifact?.communityPreview;
    if(!["widget","canvas"].includes(kind)||!preview)throw Error("Prepare the automatic share preview before using AI auto-fill.");
    const response=await fetch("/api/community/metadata",{
      method:"POST",
      credentials:"same-origin",
      headers:aiRequestHeaders({"Content-Type":"application/json"}),
      body:JSON.stringify({
        kind,
        preview,
        reasoningEffort:state.reasoningEffort,
        language:document.documentElement.lang==="zh"?"zh":"en",
        current:{
          name:String(current.name||"").slice(0,160),
          description:String(current.description||"").slice(0,1200),
          category:String(current.category||"productivity"),
          tags:Array.isArray(current.tags)?current.tags.slice(0,8):[],
          continuationPrompt:String(current.continuationPrompt||"").slice(0,500),
        },
        context:kind==="widget"?{title:String(artifact?.widget?.title||"").slice(0,120),pluginId:String(artifact?.widget?.pluginId||"").slice(0,64)}:{title:String(artifact?.name||"").slice(0,160)},
      }),
    }),body=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(body.message||body.error||`AI auto-fill failed (HTTP ${response.status}).`);
    return body.metadata;
  }
  async function importCommunityCanvasArtifact(artifact, origin = null) {
    const parsed = await readSnapshotBundle(artifact),stamp=Date.now(),id=`community-${crypto.randomUUID?.() || stamp}`,
      item={ ...parsed.item,id,createdAt:stamp,updatedAt:stamp,name:String(parsed.item.name || "Community Canvas").slice(0,160),projectId:null };
    if (origin?.id && /^[0-9a-f-]{36}$/i.test(origin.id)) {
      item.bundleExtensions = {
        ...snapshotExtensionObject(item.bundleExtensions),
        penechoCommunity:{
          originItemId:origin.id,
          rootItemId:origin.rootItemId || origin.id,
          originName:String(origin.name || "").trim().slice(0, 160),
          originGeneration:Number.isInteger(origin.generation) && origin.generation >= 0 ? origin.generation : 0,
        },
      };
    }
    await saveDeviceSnapshot(item, parsed.tileEntries, null);
    // The imported public Canvas now has an explicit device identity. Load it
    // through that read-only store path instead of refreshing the currently
    // selected History location (which may be Cloud and unrelated to import).
    await requestLoadSnapshot(id, "device");
    return { id, name:item.name };
  }

  // The public Viewer is presentation runtime, not an import workflow. Restore
  // the published bundle directly into memory so opening a shared link never
  // writes duplicate snapshots into IndexedDB, refreshes the private history
  // library, or depends on editable-Canvas dialogs. Viewer CSS and the hand
  // tool keep the restored objects read-only while fitViewerCanvas() frames
  // the complete artifact instead of its publishing-time pan/zoom.
  async function viewCommunityCanvasArtifact(artifact) {
    if (window.PENECHO_CONFIG?.runtime !== "viewer") throw Error("Read-only Canvas viewing is unavailable in this runtime.");
    const parsed = await readSnapshotBundle(artifact),
      { item, tileEntries } = parsed,
      loadGeneration = ++state.snapshotLoadGeneration,
      loadIsCurrent = () => loadGeneration === state.snapshotLoadGeneration;
    if (item.widgets?.length) {
      if (!state.pluginCatalogLoaded && !state.pluginCatalogLoading) await loadPluginDocuments();
      const catalogDeadline = Date.now() + 15000;
      while (state.pluginCatalogLoading && Date.now() < catalogDeadline) await new Promise((resolve) => setTimeout(resolve, 40));
      const missingPlugin = item.widgets.find((widget) => !pluginManifests.has(widget?.pluginId));
      if (missingPlugin) throw Error(`The read-only Canvas needs the unavailable ${missingPlugin.pluginId || "Widget"} plugin.`);
    }
    await enableSnapshotWidgetPlugins(item.widgets);
    let decodedTiles = null;
    try {
      const [tileResult, imageResult] = await Promise.allSettled([
        decodeSnapshotTilesInBatches(tileEntries, loadIsCurrent).then((value) => (decodedTiles = value)),
        decodeSnapshotImagesInBatches(item.images, loadIsCurrent),
      ]);
      if (tileResult.status === "rejected") throw tileResult.reason;
      if (imageResult.status === "rejected") throw imageResult.reason;
      if (!decodedTiles || !imageResult.value || !loadIsCurrent()) throw Error("The read-only Canvas load was superseded.");

      if (state.selection) cancelSelection(true);
      clearTextEditors();
      state.userRevision++;
      invalidateRecognition();
      cancelPendingForRevision();
      for (const canvas of tiles.values()) canvas.width = canvas.height = 1;
      tiles.clear();
      clearSharpOverlays();
      state.inkBounds.clear();
      state.history = [];
      state.future = [];
      state.animationHistoryBefore = null;
      state.widgetHistoryBefore = null;
      state.historyBefore.clear();
      state.imageHistoryBefore = null;
      state.textBoxHistoryBefore = null;
      for (const [key, canvas] of decodedTiles) tiles.set(key, canvas);
      decodedTiles.clear();
      state.currentSnapshotPreservedAssets = snapshotPreservedAssets(item.preservedAssets);
      restoreAnimations(item.animations);
      restoreWidgets(item.widgets);
      applyTheme(item.theme);
      restoreImages(imageResult.value);
      await restoreTextBoxes(item.textBoxes, 1);
      if (!loadIsCurrent()) throw Error("The read-only Canvas load was superseded.");

      // A viewer URL does not own a local snapshot. Preserve artifact extension
      // metadata for rendering, but keep the editable storage identity empty.
      state.currentSnapshotId = null;
      state.currentSnapshotName = String(item.name || "").slice(0, 160);
      state.currentSnapshotHasExplicitName = Boolean(state.currentSnapshotName.trim());
      state.currentCanvasSuggestedName = "";
      state.currentSnapshotLocation = null;
      state.currentSnapshotProjectId = null;
      state.currentSnapshotRevisionId = null;
      state.currentSnapshotBundleExtensions = snapshotExtensionObject(item.bundleExtensions);
      restoreSnapshotCanvasObjectOrder(item.bundleExtensions);
      state.currentSnapshotManifestExtensions = snapshotExtensionObject(item.manifestExtensions);
      state.dirty = null;
      state.snapshotSavedRevision = state.userRevision;
      setCanvasNavigationLocked(false);
      closeHistoryPanel();
      fitViewerCanvas();
      render();
      void refreshVisibleTextBoxQuality();
      return { id:String(item.id || ""), name:state.currentSnapshotName };
    } catch (error) {
      if (decodedTiles?.size) releaseSnapshotTileCanvases(decodedTiles);
      throw error;
    }
  }

  function communityLineageForArtifact(kind, artifact) {
    const lineage = kind === "widget"
      ? {
          originItemId:artifact?.widget?.communityOriginItemId,
          rootItemId:artifact?.widget?.communityRootItemId,
          originName:artifact?.widget?.communityOriginName,
          originGeneration:artifact?.widget?.communityOriginGeneration,
        }
      : artifact?.extensions?.penechoCommunity;
    return lineage && /^[0-9a-f-]{36}$/i.test(String(lineage.originItemId || ""))
      ? {
          parentItemId:lineage.originItemId,
          rootItemId:lineage.rootItemId || lineage.originItemId,
          parentName:String(lineage.originName || "").trim().slice(0, 160),
          parentGeneration:Number.isInteger(lineage.originGeneration) && lineage.originGeneration >= 0 ? lineage.originGeneration : null,
        }
      : null;
  }
  function publishedCommunityOrigin(item) {
    if (!item || !/^[0-9a-f-]{36}$/i.test(String(item.id || ""))) throw Error("PenEcho Cloud returned an invalid Craft confirmation.");
    return {
      originItemId:item.id,
      rootItemId:/^[0-9a-f-]{36}$/i.test(String(item.rootItemId || "")) ? item.rootItemId : item.id,
      originName:String(item.name || "").trim().slice(0, 160),
      originGeneration:Number.isInteger(item.generation) && item.generation >= 0 ? item.generation : 0,
    };
  }
  async function persistCurrentCanvasCommunityOrigin(origin) {
    state.currentSnapshotBundleExtensions = {
      ...snapshotExtensionObject(state.currentSnapshotBundleExtensions),
      penechoCommunity:origin,
    };
    if (state.currentSnapshotLocation !== "device" || !state.currentSnapshotId) return;
    const db = await snapshotDb(), transaction = db.transaction(SNAPSHOT_STORE, "readwrite"), store = transaction.objectStore(SNAPSHOT_STORE), item = await requestResult(store.get(state.currentSnapshotId));
    if (!item) return;
    item.bundleExtensions = { ...snapshotExtensionObject(item.bundleExtensions), penechoCommunity:origin };
    store.put(item);
    await transactionDone(transaction);
  }
  async function markPublishedCommunityOrigin(kind, artifact, item) {
    const origin = publishedCommunityOrigin(item);
    if (kind === "widget") {
      const widgetId = artifact?.widget?.id, widget = state.widgets.find((candidate) => candidate.id === widgetId);
      if (!widget) throw Error("The published Widget is no longer on this Canvas.");
      widget.communityOriginItemId = origin.originItemId;
      widget.communityRootItemId = origin.rootItemId;
      widget.communityOriginName = origin.originName;
      widget.communityOriginGeneration = origin.originGeneration;
      save();
      requestRender();
    } else if (kind === "canvas") await persistCurrentCanvasCommunityOrigin(origin);
    else throw Error("Unsupported Craft type.");
    return origin;
  }
  async function saveServerSnapshot(item, tileEntries, overwriteId) {
    const response = await fetch(overwriteId ? `/api/canvases/${encodeURIComponent(overwriteId)}` : "/api/canvases", {
      method:overwriteId ? "PUT" : "POST",
      credentials:"same-origin",
      headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
      body:JSON.stringify(await serverSnapshotPayload(item, tileEntries)),
    });
    await snapshotApiResponse(response);
  }
  async function saveCloudSnapshot(item, tileEntries, overwriteId) {
    const bundle = await serverSnapshotPayload(item, tileEntries);
    if (overwriteId) {
      const existing = snapshotItems.find((entry) => entry.id === overwriteId),
        baseRevisionId = existing?.currentRevisionId || state.currentSnapshotRevisionId || null,
        response = await fetch(`/api/cloud/canvases/${encodeURIComponent(overwriteId)}/save`, {
          method:"POST",
          credentials:"same-origin",
          headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
          body:JSON.stringify({ baseRevisionId, bundle }),
        }),
        body = await snapshotApiResponse(response).catch(async (error) => {
          if (error.status === 409) {
            await refreshSnapshots();
            throw Error(t("cloudCanvasConflict"));
          }
          throw error;
        });
      return { id:overwriteId, revisionId:body?.revision?.id || null };
    }
    const projectId = item.projectId || selectedCloudSaveProjectId();
    if (!projectId) throw Error("Create a Cloud project before saving this Canvas");
    const response = await fetch(`/api/cloud/projects/${encodeURIComponent(projectId)}/save`, {
        method:"POST",
        credentials:"same-origin",
        headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify({ name:item.name || "Untitled Canvas", bundle }),
      }),
      body = await snapshotApiResponse(response);
    if (!body?.canvas?.id || !body?.revision?.id) throw Error("PenEcho Cloud returned an invalid save confirmation");
    return { id:body.canvas.id, revisionId:body.revision.id };
  }
  async function saveSnapshot({ overwriteId = null, name = null, location = state.snapshotLocation, allowEmpty = false } = {}) {
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return null;
    }
    if (!SNAPSHOT_LOCATIONS.has(location)) throw Error("Invalid snapshot location");
    if (overwriteId && state.currentSnapshotLocation !== location) throw Error(t("noCurrentSnapshot"));
    await finalizeCanvasForSnapshot();
    if (!allowEmpty && !tiles.size && !state.images.length && !state.textBoxes.length && !state.preservedSnapshotAnimations.length && (!pluginEnabled("animation") || !state.animations.length) && !visibleWidgets().length) {
      setStatusKey("emptyCanvas");
      return null;
    }
    // Widget source is authoritative; preview failure must not prevent saving it.
    await prepareVisibleWidgetSnapshots(null, true);
    const savedUserRevision = state.userRevision;
    const nameInput = document.querySelector("#historyName"),
      existing = overwriteId ? snapshotItems.find((item) => item.id === overwriteId) : null,
      id = overwriteId || `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
      now = Date.now(),
      createdAt = overwriteId ? existing?.createdAt || now : now,
      updatedAt = now,
      animations = serializedAnimations(),
      widgets = serializedWidgets(),
      textBoxes = storedTextBoxes(),
      images = storedImages(),
      tileEntries = await Promise.all([...tiles].map(async ([k, canvas]) => ({ k, blob: await canvasBlob(canvas) }))),
      preview = location === "cloud" ? await cloudSnapshotPreviewBlob() : await snapshotPreviewBlob(),
      requestedName = String(name === null ? nameInput.value || state.currentCanvasSuggestedName : name).trim().slice(0, 48),
      item = {
        version:2,
        id,
        createdAt,
        updatedAt,
        name: requestedName || (overwriteId ? (existing ? existing.name : state.currentSnapshotName) : location === "cloud" ? "Untitled Canvas" : ""),
        projectId:location === "server"
          ? overwriteId
            ? existing?.projectId || state.currentSnapshotProjectId || SERVER_DEFAULT_PROJECT_ID
            : selectedServerSaveProjectId()
          : location === "cloud"
            ? overwriteId
              ? existing?.projectId || state.currentSnapshotProjectId || selectedCloudSaveProjectId()
              : selectedCloudSaveProjectId()
          : null,
        theme: state.theme,
        view: { scale: state.scale, panX: state.panX, panY: state.panY, navigationLocked:state.navigationLocked, ...(typeof canvasDocumentsSavedView==="function"?{region:canvasDocumentsSavedView().region}:{}) },
        tileCount: tileEntries.length,
        animationCount: animations.length,
        animations,
        widgetCount: widgets.length,
        widgets,
        textBoxCount:textBoxes.length,
        textBoxes,
        imageCount: images.length,
        images,
        preview,
        bundleExtensions:typeof canvasDocumentsSaveMetadata==="function"?canvasDocumentsSaveMetadata({copy:!overwriteId&&Boolean(state.currentSnapshotId)}):snapshotCanvasObjectExtensions(),
        manifestExtensions:snapshotExtensionObject(state.currentSnapshotManifestExtensions),
        preservedAssets:snapshotPreservedAssets(state.currentSnapshotPreservedAssets),
      };
    if (overwriteId && !existing && overwriteId !== state.currentSnapshotId) throw Error(t("noCurrentSnapshot"));
    let storedId = id,
      storedRevisionId = null;
    if (location === "server") await saveServerSnapshot(item, tileEntries, overwriteId);
    else if (location === "cloud") {
      const saved = await saveCloudSnapshot(item, tileEntries, overwriteId);
      storedId = saved.id;
      storedRevisionId = saved.revisionId;
    } else await saveDeviceSnapshot(item, tileEntries, overwriteId);
    nameInput.value = "";
    state.currentSnapshotId = storedId;
    state.currentSnapshotName = snapshotName(item);
    state.currentSnapshotHasExplicitName = Boolean(String(item.name||"").trim());
    state.currentCanvasSuggestedName = "";
    state.currentSnapshotLocation = location;
    state.currentSnapshotProjectId = item.projectId;
    state.currentSnapshotRevisionId = storedRevisionId;
    state.currentSnapshotBundleExtensions = snapshotExtensionObject(item.bundleExtensions);
    state.currentSnapshotManifestExtensions = snapshotExtensionObject(item.manifestExtensions);
    state.currentSnapshotPreservedAssets = snapshotPreservedAssets(item.preservedAssets);
    state.snapshotSavedRevision = savedUserRevision;
    if(typeof canvasDocumentsDidSave==="function")await canvasDocumentsDidSave(item,location,storedId,tileEntries);
    canvasAgentCanvasDidPersist(location, storedId);
    await refreshSnapshots();
    window.PenEchoStudioNavigator?.refreshSource?.(location, { force:true });
    setStatusKey(overwriteId ? "snapshotOverwritten" : "snapshotSaved");
    window.PenEchoStudioNavigator?.updateDocument?.();
    return storedId;
  }
  async function readDeviceSnapshot(id) {
    const db = await snapshotDb(),
      transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readonly"),
      itemRequest = transaction.objectStore(SNAPSHOT_STORE).get(id),
      tilesRequest = transaction.objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAll(id),
      [item, tileEntries] = await Promise.all([requestResult(itemRequest), requestResult(tilesRequest)]);
    return item ? { item, tileEntries } : null;
  }
  async function readSnapshotBundle(stored) {
    if (!stored || stored.bundleVersion !== 2 || stored.mode !== "snapshot" || stored.formatVersion !== 1 || stored.manifest?.format !== "penecho-raster-tiles" || stored.manifest?.formatVersion !== 1 || !Array.isArray(stored.assets)) throw Error("PenEcho returned an invalid canvas bundle");
    const previewAsset = stored.assets.find((asset) => asset.kind === "preview"),
      tileAssets = stored.assets.filter((asset) => asset.kind === "tile"),
      imageAssets = stored.assets.filter((asset) => asset.kind === "resource" && asset.metadata?.resourceType === "image"),
      widgetAssets = stored.assets.filter((asset) => asset.kind === "widget"),
      widgets = await Promise.all(widgetAssets.map(async (asset) => {
        const widget = JSON.parse(await snapshotBundleAssetBlob(asset).text());
        if (!widget?.id || widget.id !== asset.metadata?.widgetId) throw Error("Canvas bundle contains an invalid widget");
        return widget;
      })),
      imageById = new Map(imageAssets.map((asset) => [asset.metadata.resourceId, {
        ...asset.metadata,
        id:asset.metadata.resourceId,
        blob:snapshotBundleAssetBlob(asset),
      }])),
      knownAssets = new Set([previewAsset, ...tileAssets, ...imageAssets, ...widgetAssets]),
      preservedAssets = stored.assets.filter((asset) => !knownAssets.has(asset));
    if (!previewAsset) throw Error("Canvas bundle has no preview");
    return {
      item:{
        version:2,
        id:stored.id,
        createdAt:stored.createdAt,
        updatedAt:stored.updatedAt || stored.createdAt,
        name:stored.name || "",
        theme:stored.manifest.theme,
        view:stored.manifest.view,
        animations:stored.manifest.animations || [],
        textBoxes:stored.manifest.textBoxes || [],
        projectId:stored.projectId || SERVER_DEFAULT_PROJECT_ID,
        bundleExtensions:snapshotExtensionObject(stored.extensions),
        manifestExtensions:snapshotExtensionObject(stored.manifest.extensions),
        preservedAssets:snapshotPreservedAssets(preservedAssets),
        preview:snapshotBundleAssetBlob(previewAsset),
        widgets,
        images:[...imageById.values()],
      },
      tileEntries:tileAssets.map((asset) => ({ k:asset.metadata?.tileKey, blob:snapshotBundleAssetBlob(asset) })),
    };
  }
  async function readServerSnapshot(id, onProgress = null) {
    const response = await fetch(`/api/canvases/${encodeURIComponent(id)}`, {
        credentials:"same-origin",
        cache:"no-store",
        headers:authenticatedApiHeaders(),
      }),
      body = await snapshotApiResponse(response, onProgress),
      stored = body?.canvas;
    if (!stored) throw Error("PenEcho server returned an invalid canvas");
    const storedVersion = stored.version ?? stored.bundleVersion ?? 1;
    if (storedVersion === 2) return readSnapshotBundle(stored);
    if (!Array.isArray(stored.tiles) || !Array.isArray(stored.images)) throw Error("PenEcho server returned an invalid canvas");
    return {
      item:{
        ...stored,
        version:1,
        updatedAt:stored.updatedAt || stored.createdAt,
        projectId:stored.projectId || SERVER_DEFAULT_PROJECT_ID,
        preview:dataUrlBlob(stored.preview),
        images:stored.images.map(({ data, ...image }) => ({ ...image, blob:dataUrlBlob(data) })),
      },
      tileEntries:stored.tiles.map(({ k, data }) => ({ k, blob:dataUrlBlob(data) })),
    };
  }
  async function readCloudSnapshot(id, onProgress = null) {
    const response = await fetch(`/api/cloud/canvases/${encodeURIComponent(id)}`, {
        credentials:"same-origin",
        cache:"no-store",
        headers:authenticatedApiHeaders(),
      }),
      body = await snapshotApiResponse(response, onProgress);
    if (!body?.bundle || !body?.revision?.id) throw Error("PenEcho Cloud returned an invalid Canvas");
    const parsed = await readSnapshotBundle(body.bundle),
      metadata = snapshotItems.find((item) => item.id === id);
    parsed.item = {
      ...parsed.item,
      id,
      name:metadata?.name || parsed.item.name,
      projectId:metadata?.projectId || parsed.item.projectId,
      currentRevisionId:body.revision.id,
      updatedAt:metadata?.updatedAt || parsed.item.updatedAt,
    };
    return parsed;
  }
  async function readSnapshot(location, id, onProgress = null) {
    if (location === "device") {
      onProgress?.(0, 0, 0);
      const stored = await readDeviceSnapshot(id);
      onProgress?.(1, 0, 0);
      return stored;
    }
    return location === "server" ? readServerSnapshot(id, onProgress) : readCloudSnapshot(id, onProgress);
  }
  async function loadSnapshot(id, location = state.snapshotLocation) {
    if (snapshotLoadInProgress) return false;
    if(typeof canvasDocuments!=="undefined"&&canvasDocuments.activeId) {
      const open=[...canvasDocuments.records.values()].find(doc=>doc.locator?.id===id&&doc.locator?.location===location);
      if(open){
        await canvasDocumentsShow(open.id);
        closeHistoryPanel();
        setStatusKey("snapshotLoaded");
        return true;
      }
      await canvasDocumentsPark();
    }
    const loadGeneration=++state.snapshotLoadGeneration,
      expectedRevision=state.userRevision,
      metadata=snapshotItems.find((item) => item.id === id),
      displayName=metadata ? snapshotName(metadata) : id;
    snapshotLoadInProgress = true;
    snapshotLoadingId = id;
    updateHistoryReadControls();
    setHistoryActivity(t("snapshotLoading").replace("{name}", displayName), t("snapshotLoadRequesting"), 4);
    const loadIsCurrent = () => loadGeneration===state.snapshotLoadGeneration && state.userRevision===expectedRevision,
      requireCurrent = () => { if (!loadIsCurrent()) throw Error(t("snapshotLoadChanged")); };
    let decodedTiles = null;
    try {
      const stored = await readSnapshot(location, id, (fraction, received) => {
        if (!loadIsCurrent()) return;
        const progress = Number.isFinite(fraction) ? 5 + fraction * 30 : 12;
        const bytes = received > 0 ? ` ${snapshotByteLabel(received)}` : "";
        setHistoryActivity(t("snapshotLoading").replace("{name}", displayName), `${t("snapshotLoadDownloading")}${bytes}`, progress);
      });
      if (!stored) throw Error("Canvas snapshot was not found.");
      requireCurrent();
      const { item, tileEntries } = stored;
      setHistoryActivity(t("snapshotLoading").replace("{name}", displayName), t("snapshotLoadPreparing"), 38);
      await enableSnapshotWidgetPlugins(item.widgets);
      requireCurrent();
      let tileProgress = tileEntries.length ? 0 : 1, imageProgress = item.images?.length ? 0 : 1;
      const updateDecodeProgress = () => setHistoryActivity(t("snapshotLoading").replace("{name}", displayName), t("snapshotLoadDecoding"), 42 + (tileProgress * .7 + imageProgress * .3) * 48);
      const tileTask = decodeSnapshotTilesInBatches(tileEntries, loadIsCurrent, (progress) => { tileProgress = progress; updateDecodeProgress(); })
        .then((tilesResult) => (decodedTiles = tilesResult)),
        imageTask = decodeSnapshotImagesInBatches(item.images, loadIsCurrent, (progress) => { imageProgress = progress; updateDecodeProgress(); });
      const [tileResult, imageResult] = await Promise.allSettled([tileTask, imageTask]);
      if (tileResult.status === "rejected") throw tileResult.reason;
      if (imageResult.status === "rejected") throw imageResult.reason;
      const images = imageResult.value;
      if (!decodedTiles || !loadIsCurrent()) {
        if (decodedTiles) releaseSnapshotTileCanvases(decodedTiles);
        requireCurrent();
      }
      if (!images || !loadIsCurrent()) {
        releaseSnapshotTileCanvases(decodedTiles);
        requireCurrent();
      }
      setHistoryActivity(t("snapshotLoading").replace("{name}", displayName), t("snapshotLoadApplying"), 94);
      if (state.selection) cancelSelection(true);
      clearTextEditors();
      state.userRevision++;
      invalidateRecognition();
      cancelPendingForRevision();
      for (const canvas of tiles.values()) canvas.width = canvas.height = 1;
      tiles.clear();
      clearSharpOverlays();
      state.inkBounds.clear();
      state.history = [];
      state.future = [];
      state.animationHistoryBefore = null;
      state.widgetHistoryBefore = null;
      state.historyBefore.clear();
      state.imageHistoryBefore = null;
      state.textBoxHistoryBefore = null;
      for (const [k, canvas] of decodedTiles) tiles.set(k, canvas);
      decodedTiles.clear();
      state.currentSnapshotPreservedAssets = snapshotPreservedAssets(item.preservedAssets);
      restoreAnimations(item.animations);
      restoreWidgets(item.widgets);
      applyTheme(item.theme);
      restoreImages(images);
      await restoreTextBoxes(item.textBoxes, 1);
      if(typeof canvasDocumentsApplyView==="function")canvasDocumentsApplyView(item.view);
      else if (item.view) {
        state.scale = Math.max(0.03, Math.min(2, item.view.scale));
        state.panX = item.view.panX;
        state.panY = item.view.panY;
        updateCoordinates();
      }
      setCanvasNavigationLocked(item.view?.navigationLocked === true);
      state.currentSnapshotId = item.id;
      state.currentSnapshotName = snapshotName(item);
      state.currentSnapshotHasExplicitName = Boolean(String(item.name||"").trim());
      state.currentCanvasSuggestedName = "";
      state.currentSnapshotLocation = location;
      state.currentSnapshotProjectId = item.projectId || null;
      state.currentSnapshotRevisionId = location === "cloud" ? item.currentRevisionId || null : null;
      state.currentSnapshotBundleExtensions = snapshotExtensionObject(item.bundleExtensions);
      restoreSnapshotCanvasObjectOrder(item.bundleExtensions);
      state.currentSnapshotManifestExtensions = snapshotExtensionObject(item.manifestExtensions);
      state.snapshotSavedRevision = state.userRevision;
      if(typeof canvasDocumentsAdopt==="function")await canvasDocumentsAdopt(item,location);
      resetCanvasDefaultMode();
      const restoreStudioConversation=window.PenEchoStudioNavigator?.wantsConversationForCanvas?.({ id:item.id, location })===true;
      canvasAgentCanvasDidChange({ id:item.id, location },{clearProject:true,deferConversationStart:restoreStudioConversation});
      window.PenEchoStudioNavigator?.canvasDidLoad?.({ id:item.id, location });
      window.PenEchoStudioNavigator?.renderCanvases?.();
      window.PenEchoStudioNavigator?.updateDocument?.();
      setHistoryActivity(t("snapshotLoading").replace("{name}", displayName), t("snapshotLoadApplying"), 100);
      render();
      void refreshVisibleTextBoxQuality();
      closeHistoryPanel();
      setStatusKey("snapshotLoaded");
      return true;
    } catch (error) {
      window.PenEchoStudioNavigator?.cancelPendingConversation?.();
      if (decodedTiles?.size) releaseSnapshotTileCanvases(decodedTiles);
      if (loadGeneration !== state.snapshotLoadGeneration) return false;
      const message = t("snapshotLoadFailed").replace("{message}", String(error?.message || error));
      setHistoryActivity(t("snapshotLoading").replace("{name}", displayName), message, null, "error");
      throw error;
    } finally {
      if (loadGeneration === state.snapshotLoadGeneration) {
        snapshotLoadInProgress = false;
        snapshotLoadingId = null;
        updateHistoryReadControls();
      }
    }
  }
  async function deleteDeviceSnapshot(id) {
    const db = await snapshotDb(),
      readTransaction = db.transaction(SNAPSHOT_TILE_STORE, "readonly"),
      tileKeys = await requestResult(readTransaction.objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAllKeys(id)),
      transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).delete(id);
    const tileStore = transaction.objectStore(SNAPSHOT_TILE_STORE);
    tileKeys.forEach((key) => tileStore.delete(key));
    await transactionDone(transaction);
  }
  async function deleteServerSnapshot(id) {
    const response = await fetch(`/api/canvases/${encodeURIComponent(id)}`, {
      method:"DELETE",
      credentials:"same-origin",
      headers:authenticatedApiHeaders(),
    });
    await snapshotApiResponse(response);
  }
  async function deleteCloudSnapshot(id) {
    const response = await fetch(`/api/cloud/canvases/${encodeURIComponent(id)}`, {
      method:"DELETE",
      credentials:"same-origin",
      headers:authenticatedApiHeaders(),
    });
    if (!response.ok) await snapshotApiResponse(response);
  }
  async function deleteSnapshot(id, location = state.snapshotLocation) {
    if (location === "server") await deleteServerSnapshot(id);
    else if (location === "cloud") await deleteCloudSnapshot(id);
    else await deleteDeviceSnapshot(id);
    if (state.currentSnapshotId === id && state.currentSnapshotLocation === location) {
      state.currentSnapshotId = null;
      state.currentSnapshotName = "";
      state.currentSnapshotHasExplicitName = false;
      state.currentCanvasSuggestedName = "";
      state.currentSnapshotLocation = null;
      state.currentSnapshotProjectId = null;
      state.currentSnapshotRevisionId = null;
      state.currentSnapshotBundleExtensions = {};
      state.currentSnapshotManifestExtensions = {};
      state.currentSnapshotPreservedAssets = [];
    }
    await refreshSnapshots();
    window.PenEchoStudioNavigator?.refreshSource?.(location, { force:true });
    window.PenEchoStudioNavigator?.updateDocument?.();
    setStatusKey("snapshotDeleted");
  }
  function requestSnapshotDelete(item, location = state.snapshotLocation) {
    if (!item || historyBusy()) return false;
    const dialog = document.querySelector("#historyDeleteDialog"),
      title = document.querySelector("#historyDeleteTitle"),
      description = document.querySelector("#historyDeleteDescription"),
      cancel = document.querySelector("#historyDeleteCancel"),
      confirm = document.querySelector("#historyDeleteConfirm"),
      detailKey = location === "server" ? "deleteSnapshotConfirmServer" : location === "cloud" ? "deleteSnapshotConfirmCloud" : "deleteSnapshotConfirmDevice";
    historyDeletePending = { type:"snapshot", id:item.id, location, name:snapshotName(item) };
    title.textContent = t("historyDeleteTitle");
    description.textContent = `${historyDeletePending.name} · ${snapshotLocationLabel(location)}. ${t(detailKey)}`;
    confirm.textContent = t("deleteSnapshot");
    confirm.disabled = false;
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => cancel.focus({ preventScroll:true }));
    return true;
  }
  function requestSelectedProjectDelete() {
    if (historyBusy()) return false;
    const isCloud = state.snapshotLocation === "cloud",
      projects = isCloud ? cloudCanvasProjects : serverCanvasProjects,
      selectedProjectId = isCloud ? selectedCloudProjectId : selectedServerProjectId,
      project = projects.find((item) => item.id === selectedProjectId);
    if (!project || project.id === SERVER_DEFAULT_PROJECT_ID || project.system || project.systemKey === "uncategorized") return false;
    const dialog = document.querySelector("#historyDeleteDialog"),
      title = document.querySelector("#historyDeleteTitle"),
      description = document.querySelector("#historyDeleteDescription"),
      cancel = document.querySelector("#historyDeleteCancel"),
      confirm = document.querySelector("#historyDeleteConfirm"),
      name = project.name || t("canvasProjectUncategorized");
    historyDeletePending = { type:"project", id:project.id, location:state.snapshotLocation, name };
    title.textContent = t("canvasProjectDelete");
    description.textContent = t("deleteCloudProjectConfirm").replace("{name}", name);
    confirm.textContent = t("canvasProjectDelete");
    confirm.disabled = false;
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => cancel.focus({ preventScroll:true }));
    return true;
  }
  async function confirmSnapshotDelete() {
    if (!historyDeletePending) return false;
    const pending = historyDeletePending,
      dialog = document.querySelector("#historyDeleteDialog"),
      description = document.querySelector("#historyDeleteDescription"),
      confirm = document.querySelector("#historyDeleteConfirm");
    confirm.disabled = true;
    confirm.setAttribute("aria-busy", "true");
    try {
      if (pending.type === "project") await deleteSelectedServerProject(pending);
      else await deleteSnapshot(pending.id, pending.location);
      dialog.close("deleted");
      return true;
    } catch (error) {
      const message = `${t("snapshotError")}${String(error?.message || error)}`;
      setStatus(message);
      description.textContent = message;
      confirm.disabled = false;
      return false;
    } finally {
      confirm.removeAttribute("aria-busy");
    }
  }
  function updateNewCanvasDialog() {
    const label = document.querySelector("#currentSnapshotLabel"),
      overwrite = document.querySelector("#newOverwrite"),
      title = document.querySelector("#newCanvasTitle"),
      description = document.querySelector("#newCanvasDialog > form > p:not(.current-snapshot)"),
      discard = document.querySelector("#newDiscard"),
      saveCopy = document.querySelector("#newSaveCopy"),
      loading = pendingCanvasTransition?.type === "load",
      closing = pendingCanvasTransition?.type === "close",
      cloudBlocked = state.snapshotLocation === "cloud" && cloudHistorySignInRequired;
    if (!label || !overwrite) return;
    if (title) title.textContent = t(closing ? "closeCanvasTitle" : loading ? "loadCanvasTitle" : "newCanvasTitle");
    if (description) description.textContent = t(closing ? "closeCanvasDescription" : loading ? "loadCanvasDescription" : "newCanvasDescription");
    if (discard) discard.textContent = t(closing ? "closeWithoutSave" : loading ? "loadWithoutSave" : "newWithoutSave");
    if (saveCopy) saveCopy.textContent = t(closing ? "saveAsNewAndClose" : loading ? "saveAsNewAndLoad" : "saveAsNewAndCreate");
    overwrite.textContent = t(closing ? "overwriteAndClose" : loading ? "overwriteAndLoad" : "overwriteAndCreate");
    const hasCurrentSnapshot = Boolean(state.currentSnapshotId);
    label.hidden = !hasCurrentSnapshot;
    overwrite.hidden = !hasCurrentSnapshot;
    if (hasCurrentSnapshot) {
      const sameLocation = state.currentSnapshotLocation === state.snapshotLocation,
        key = sameLocation ? "currentSnapshot" : "currentSnapshotOtherLocation";
      label.textContent = t(key)
        .replace("{name}", state.currentSnapshotName || state.currentSnapshotId)
        .replace("{location}", snapshotLocationLabel(state.currentSnapshotLocation));
    }
    overwrite.disabled = cloudBlocked || !hasCurrentSnapshot || state.currentSnapshotLocation !== state.snapshotLocation;
    if (saveCopy) saveCopy.disabled = cloudBlocked;
    const project = document.querySelector("#newCanvasProjectSelect");
    if (project) project.disabled = cloudBlocked;
    updateSnapshotLocationUi();
  }
  function setNewCanvasDialogBusy(busy) {
    const dialog = document.querySelector("#newCanvasDialog");
    dialog.dataset.busy = String(busy);
    dialog.querySelectorAll("button, input, select").forEach((control) => (control.disabled = busy));
    if (!busy) updateNewCanvasDialog();
  }
  function resetCanvasDefaultMode() {
    const hasContent = tiles.size || state.images.length || state.textBoxes.length || state.preservedSnapshotAnimations.length || (pluginEnabled("animation") && state.animations.length) || visibleWidgets().length;
    setCanvasMode(hasContent ? "hand" : "pen", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function startBlankCanvas() {
    const dialog = document.querySelector("#newCanvasDialog");
    if (state.selection) cancelSelection(true);
    clearTextEditors();
    state.snapshotLoadGeneration++;
    state.userRevision++;
    invalidateRecognition();
    cancelPendingForRevision();
    tiles.clear();
    clearSharpOverlays();
    state.inkBounds.clear();
    state.history = [];
    state.future = [];
    state.animationHistoryBefore = null;
    restoreAnimations([]);
    state.widgetHistoryBefore = null;
    restoreWidgets([]);
    state.imageHistoryBefore = null;
    restoreImages([]);
    state.textBoxHistoryBefore = null;
    void restoreTextBoxes([]);
    state.historyBefore.clear();
    state.currentSnapshotId = null;
    state.currentSnapshotName = "";
    state.currentSnapshotHasExplicitName = false;
    state.currentCanvasSuggestedName = "";
    state.currentSnapshotLocation = null;
    state.currentSnapshotProjectId = null;
    state.currentSnapshotRevisionId = null;
    state.currentSnapshotBundleExtensions = {};
    state.currentSnapshotManifestExtensions = {};
    state.currentSnapshotPreservedAssets = [];
    if(typeof canvasDocuments!=="undefined"){canvasDocuments.activeId=null;canvasDocuments.epoch++;canvasDocumentsCurrent();mcpRuntime.feedback=[];mcpRuntime.feedbackSequence=0;canvasDocumentsRender();}
    canvasAgentCanvasDidChange(null,{clearProject:true});
    window.PenEchoStudioNavigator?.renderCanvases?.();
    window.PenEchoStudioNavigator?.updateDocument?.();
    state.viewInitialized = false;
    state.aiDraftReturnMode = null;
    state.pendingHistoryRestored = false;
    setCanvasNavigationLocked(false);
    resetCanvasDefaultMode();
    state.snapshotSavedRevision = state.userRevision;
    pendingCanvasTransition = null;
    document.querySelector("#newSnapshotName").value = "";
    if (dialog.open) dialog.close();
    if (document.querySelector("#historyPanel").classList.contains("open")) closeHistoryPanel();
    fit();
    setStatusKey("newCanvasReady");
  }
  function openNewCanvasDialog() {
    window.PenEchoStudioNavigator?.cancelPendingConversation?.();
    return requestCanvasTransition({ type:"new" });
  }
  async function completeNewCanvas(saveMode) {
    const name = document.querySelector("#newSnapshotName").value;
    setNewCanvasDialogBusy(true);
    try {
      if(pendingCanvasTransition?.type==="close"&&canvasDocumentsCurrent().id!==pendingCanvasTransition.documentId)throw canvasDocumentsError("CANVAS_CHANGED",canvasDocumentsCopy("The active Canvas changed. Close it again when ready.","当前画布已切换，请重新选择要关闭的画布。"));
      let saved = true;
      if (saveMode === "new") saved = await saveSnapshot({ name, location:state.snapshotLocation });
      else if (saveMode === "overwrite") saved = await saveSnapshot({ overwriteId:state.currentSnapshotId, name, location:state.snapshotLocation });
      if (saved === null) {
        setNewCanvasDialogBusy(false);
        return;
      }
      const transition = pendingCanvasTransition;
      if(transition?.type==="close"&&canvasDocumentsCurrent().id!==transition.documentId){transition.sourceDocumentId=transition.documentId;transition.documentId=canvasDocumentsCurrent().id;}
      pendingCanvasTransition = null;
      if (transition?.type === "load" || transition?.type === "close") {
        const dialog = document.querySelector("#newCanvasDialog");
        if (dialog.open) dialog.close();
      }
      await performCanvasTransition(transition);
    } catch (error) {
      setStatus(`${t("snapshotError")}${error.message}`);
      setNewCanvasDialogBusy(false);
    }
  }
  function canvasHasUnsavedChanges() {
    const nameChanged = Boolean(state.currentSnapshotId && state.currentCanvasSuggestedName);
    if (!nameChanged && state.userRevision === state.snapshotSavedRevision) return false;
    const hasContent = tiles.size || state.images.length || state.textBoxes.length || state.preservedSnapshotAnimations.length || (pluginEnabled("animation") && state.animations.length) || visibleWidgets().length;
    return Boolean(state.currentSnapshotId || hasContent);
  }
  async function performCanvasTransition(transition) {
    if (transition?.type === "close") {
      const closed=await canvasDocumentsClose(transition.documentId,transition.sourceDocumentId);
      if(closed)await transition.onComplete?.();
      return closed;
    }
    if (transition?.type === "load") return loadSnapshot(transition.id, transition.location);
    if(typeof canvasDocuments!=="undefined"&&canvasDocuments.activeId)await canvasDocumentsPark();
    startBlankCanvas();
    return true;
  }
  function requestCanvasTransition(transition) {
    if (transition?.type === "new" && typeof canvasDocuments !== "undefined" && canvasDocuments.records.size >= (typeof CANVAS_DOCUMENT_LIMIT === "number" ? CANVAS_DOCUMENT_LIMIT : 32)) {
      setStatus(typeof canvasDocumentsLimitMessage === "function" ? canvasDocumentsLimitMessage() : "32 Canvases are already open. Close an unused Canvas before opening another.");
      return Promise.resolve(false);
    }
    if (!canvasHasUnsavedChanges()) return performCanvasTransition(transition);
    pendingCanvasTransition = transition;
    const dialog = document.querySelector("#newCanvasDialog");
    document.querySelector("#newSnapshotName").value = transition?.type === "close" ? currentCanvasDisplayName() || "" : "";
    setNewCanvasDialogBusy(false);
    updateNewCanvasDialog();
    if (!dialog.open) dialog.showModal();
    return Promise.resolve(false);
  }
  function confirmExternalCanvasOpen() {
    return !canvasHasUnsavedChanges() || window.confirm(cloudHistoryCopy("confirmExternalOpen"));
  }
  function requestLoadSnapshot(id, location = state.snapshotLocation) {
    return requestCanvasTransition({ type:"load", id, location });
  }
  async function openCloudProjectHistory(projectId = null) {
    if (projectId && validCloudProjectSelection(projectId)) rememberSelectedCloudProject(projectId);
    setSnapshotLocation("cloud", { refresh:false });
    await refreshSnapshots();
    // The explicit refresh above verifies the selected project before the
    // panel becomes visible. Do not immediately issue the same Cloud library
    // request again from openHistoryPanel(); duplicated requests can race and
    // used to surface a misleading 502 after an otherwise successful load.
    openHistoryPanel(false);
    return true;
  }
  async function saveEchoToCloud(name) {
    if (window.PENECHO_CONFIG?.runtime !== "cloud" || !window.PENECHO_CONFIG?.browserCanvasEditing) throw Error("Cloud browser editing is unavailable");
    await cloudSnapshotItems();
    setSnapshotLocation("cloud", { refresh:false });
    const id = await saveSnapshot({ location:"cloud", overwriteId:null, name:String(name || currentCanvasDisplayName() || "Untitled Canvas"), allowEmpty:true });
    if (!id) throw Error("The Cloud copy could not be saved");
    return id;
  }
  async function openCloudCanvas(canvasId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(canvasId || ""))) throw Error("Invalid Cloud Canvas");
    setSnapshotLocation("cloud", { refresh:false });
    // Cloud Center already resolved this explicit Canvas id. Load that bundle
    // through the local Cloud proxy without refreshing the unrelated library.
    return requestLoadSnapshot(canvasId, "cloud");
  }
  function discardCanvasTransition() {
    const transition = pendingCanvasTransition;
    pendingCanvasTransition = null;
    const dialog = document.querySelector("#newCanvasDialog");
    if (dialog.open) dialog.close();
    return performCanvasTransition(transition);
  }
  function snapshotName(item) {
    return item.name || new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt);
  }
  async function renameDeviceSnapshot(id, name) {
    const db = await snapshotDb(),
      transaction = db.transaction(SNAPSHOT_STORE, "readwrite"),
      store = transaction.objectStore(SNAPSHOT_STORE),
      item = await requestResult(store.get(id));
    if (!item) throw Error(t("noCurrentSnapshot"));
    item.name = name;
    item.updatedAt = Date.now();
    store.put(item);
    await transactionDone(transaction);
  }
  async function renameSnapshot(id, location, value) {
    const name = String(value || "").trim().slice(0, 48);
    if (!name) throw Error(t("canvasNameRequired"));
    if (historyBusy()) throw Error(t("snapshotSaving"));
    setHistorySaveBusy(true);
    try {
      if (location === "device") await renameDeviceSnapshot(id, name);
      else {
        const response = await fetch(location === "cloud" ? `/api/cloud/canvases/${encodeURIComponent(id)}` : `/api/canvases/${encodeURIComponent(id)}`, {
          method:"PATCH",
          credentials:"same-origin",
          headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
          body:JSON.stringify({ name }),
        });
        await snapshotApiResponse(response);
      }
      if (state.currentSnapshotId === id && state.currentSnapshotLocation === location) {
        state.currentSnapshotName = name;
        state.currentSnapshotHasExplicitName = true;
        state.currentCanvasSuggestedName = "";
        canvasAgentCanvasDidPersist(location, id);
        if(typeof canvasDocumentsSyncExtension==="function"){canvasDocumentsSyncExtension();canvasDocumentsRender();}
        window.PenEchoStudioNavigator?.updateDocument?.();
      }
      await refreshSnapshots();
      showHistoryNoticeKey("canvasRenamed", "success");
      return true;
    } finally {
      setHistorySaveBusy(false);
    }
  }
  function beginSnapshotRename(item, location, titleRow, title, renameButton) {
    if (historyBusy()) return;
    const form = document.createElement("form"), input = document.createElement("input"),
      confirm = document.createElement("button"), cancel = document.createElement("button"),
      originalName = snapshotName(item), restore = () => titleRow.replaceChildren(title);
    form.className = "history-rename-form";
    form.setAttribute("aria-label", t("canvasRenameNamed").replace("{name}", originalName));
    input.className = "history-rename-input";
    input.type = "text";
    input.maxLength = 48;
    input.value = originalName;
    input.setAttribute("aria-label", t("canvasNamePlaceholder"));
    confirm.type = "submit";
    peButton(confirm, "primary", "compact");
    confirm.textContent = "✓";
    confirm.setAttribute("aria-label", t("saveCurrentSnapshot"));
    cancel.type = "button";
    peButton(cancel, "secondary", "compact");
    cancel.textContent = "×";
    cancel.setAttribute("aria-label", t("cancel"));
    cancel.addEventListener("click", restore);
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        restore();
        renameButton.focus({ preventScroll:true });
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = input.value.trim().slice(0, 48);
      if (!name) {
        input.setCustomValidity(t("canvasNameRequired"));
        input.reportValidity();
        return;
      }
      if (name === originalName) {
        restore();
        renameButton.focus({ preventScroll:true });
        return;
      }
      input.disabled = confirm.disabled = cancel.disabled = true;
      try {
        await renameSnapshot(item.id, location, name);
      } catch (error) {
        const message = `${t("snapshotError")}${error.message}`;
        setStatus(message);
        showHistoryNotice(message, "error", { duration:5000 });
        input.disabled = confirm.disabled = cancel.disabled = false;
        input.focus({ preventScroll:true });
      }
    });
    form.append(input, confirm, cancel);
    titleRow.replaceChildren(form);
    input.focus({ preventScroll:true });
    input.select();
  }
  function renderSnapshotListLoading(location = state.snapshotLocation) {
    const list = document.querySelector("#historyList");
    if (!list) return;
    cancelHistoryListRender();
    releaseHistoryPreviewUrls();
    const loading = document.createElement("div");
    loading.className = "history-list-loading";
    loading.setAttribute("role", "status");
    renderServerProjectUi();
    updateHistoryLibrarySummary(null);
    loading.textContent = t("snapshotLibraryLoading").replace("{location}", snapshotLocationLabel(location));
    list.replaceChildren(loading);
    updateHistorySelectionUi(null);
    window.PenEchoStudioNavigator?.renderCanvases?.();
  }
  function renderSnapshotListError(location = state.snapshotLocation, retainItems = false) {
    const list = document.querySelector("#historyList");
    if (!list) return;
    cancelHistoryListRender();
    if (!retainItems) releaseHistoryPreviewUrls();
    list.querySelector(".history-library-error")?.remove();
    const error = document.createElement("div"), copy = document.createElement("div"),
      title = document.createElement("strong"), detail = document.createElement("p"), retry = document.createElement("button");
    error.className = `history-library-error${retainItems ? " with-cache" : ""}`;
    error.setAttribute("role", "alert");
    title.textContent = t("snapshotLibraryUnavailable").replace("{location}", snapshotLocationLabel(location));
    detail.textContent = t(location === "server" && serverSnapshotUnavailableKey || (retainItems ? "snapshotLibraryCacheRetained" : "snapshotLibraryRetryDetail"));
    retry.type = "button";
    peButton(retry, "secondary", "standard");
    retry.textContent = t("snapshotLibraryRetry");
    retry.onclick = () => {
      if (snapshotListInProgress || location !== state.snapshotLocation) return;
      retry.disabled = true;
      void refreshSnapshots().catch(() => {});
    };
    copy.append(title, detail, retry);
    error.append(copy);
    if (retainItems) list.prepend(error);
    else {
      list.replaceChildren(error);
      renderServerProjectUi();
      updateHistoryLibrarySummary(null);
      updateHistorySelectionUi(null);
    }
    window.PenEchoStudioNavigator?.renderCanvases?.();
  }
  function renderCloudHistorySignIn() {
    const list = document.querySelector("#historyList");
    if (!list) return;
    cancelHistoryListRender();
    releaseHistoryPreviewUrls();
    const empty = document.createElement("div"), title = document.createElement("strong"),
      description = document.createElement("p"), action = document.createElement("button");
    empty.className = "history-cloud-auth";
    title.textContent = cloudHistoryCopy("title");
    description.textContent = cloudHistoryCopy("description");
    action.type = "button";
    peButton(action, "primary", "standard");
    action.textContent = cloudHistoryCopy("action");
    action.onclick = () => {
      closeHistoryPanel();
      document.querySelector("#cloudAccountBtn")?.click();
    };
    empty.append(title, description, action);
    list.replaceChildren(empty);
    updateHistorySelectionUi(null);
    window.PenEchoStudioNavigator?.renderCanvases?.();
  }
  function serverProjectName(project) {
    return project?.id === SERVER_DEFAULT_PROJECT_ID || project?.system || project?.systemKey === "uncategorized" ? t("canvasProjectUncategorized") : project?.name || t("canvasProjectUncategorized");
  }
  function renderServerProjectUi() {
    const manager = document.querySelector("#serverProjectManager"),
      select = document.querySelector("#historyProjectSelect"),
      nav = document.querySelector("#historyProjectNav"),
      remove = document.querySelector("#historyProjectDelete"),
      dialogField = document.querySelector("#newCanvasProjectField"),
      dialogSelect = document.querySelector("#newCanvasProjectSelect");
    if (!manager || !select || !nav || !remove) return;
    const location = state.snapshotLocation,
      visible = location === "server" || location === "cloud";
    manager.hidden = !visible;
    if (dialogField) dialogField.hidden = !visible;
    if (!visible) return;
    const isCloud = location === "cloud",
      projects = isCloud ? cloudCanvasProjects : serverCanvasProjects.length
        ? serverCanvasProjects
        : [{ id:SERVER_DEFAULT_PROJECT_ID, name:"Uncategorized", system:true }],
      allProjectId = isCloud ? CLOUD_ALL_PROJECTS_ID : SERVER_ALL_PROJECTS_ID,
      selectedProjectId = isCloud ? selectedCloudProjectId : selectedServerProjectId;
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = allProjectId;
    all.textContent = t("historyAllCanvases");
    select.append(all);
    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = serverProjectName(project);
      select.append(option);
    }
    if (projects.length && ![...select.options].some((option) => option.value === selectedProjectId)) {
      if (isCloud) rememberSelectedCloudProject(cloudDefaultProjectId() || CLOUD_ALL_PROJECTS_ID);
      else rememberSelectedServerProject(SERVER_DEFAULT_PROJECT_ID);
    }
    select.value = isCloud ? selectedCloudProjectId : selectedServerProjectId;
    if (!select.value) select.value = allProjectId;
    const selected = projects.find((project) => project.id === select.value),
      projectProtected = !selected || selected.id === SERVER_DEFAULT_PROJECT_ID || selected.system === true || selected.systemKey === "uncategorized";
    remove.dataset.projectProtected = String(projectProtected);
    remove.disabled = historyBusy() || isCloud && cloudHistorySignInRequired || projectProtected;
    nav.replaceChildren();
    for (const option of select.options) {
      const button = document.createElement("button"), icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
        path = document.createElementNS("http://www.w3.org/2000/svg", "path"), label = document.createElement("span"), count = document.createElement("small"),
        isAll = option.value === allProjectId,
        itemCount = isAll ? snapshotItems.length : snapshotItems.filter((item) => (item.projectId || (isCloud ? "" : SERVER_DEFAULT_PROJECT_ID)) === option.value).length;
      button.className = "history-project-nav-item";
      button.type = "button";
      peButton(button, "menu-item", "");
      button.dataset.projectId = option.value;
      button.setAttribute("aria-current", option.value === select.value ? "page" : "false");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      path.setAttribute("d", isAll ? "M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z" : "M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z");
      icon.append(path);
      label.textContent = option.textContent;
      count.textContent = String(itemCount);
      count.hidden = snapshotItemsLocation !== location;
      button.append(icon, label, count);
      button.onclick = () => {
        if (button.disabled || select.value === option.value) return;
        select.value = option.value;
        if (isCloud) rememberSelectedCloudProject(option.value);
        else rememberSelectedServerProject(option.value);
        renderSnapshotList();
      };
      nav.append(button);
    }
    if (dialogSelect) {
      dialogSelect.replaceChildren();
      for (const project of projects) {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = serverProjectName(project);
        dialogSelect.append(option);
      }
      dialogSelect.value = isCloud ? selectedCloudSaveProjectId() : selectedServerSaveProjectId();
      if (!dialogSelect.value) dialogSelect.value = isCloud ? cloudDefaultProjectId() || "" : SERVER_DEFAULT_PROJECT_ID;
    }
  }
  function openServerProjectDialog() {
    const dialog = document.querySelector("#projectDialog"),
      input = document.querySelector("#projectName");
    input.value = "";
    input.setCustomValidity("");
    dialog.dataset.busy = "false";
    if (!dialog.open) dialog.showModal();
    queueMicrotask(() => input.focus());
  }
  async function createServerProject() {
    const dialog = document.querySelector("#projectDialog"),
      input = document.querySelector("#projectName"),
      name = input.value.trim().slice(0, 48);
    if (!name) {
      input.setCustomValidity(t("canvasProjectName"));
      input.reportValidity();
      return false;
    }
    input.setCustomValidity("");
    const isCloud = state.snapshotLocation === "cloud",
      response = await fetch(isCloud ? "/api/cloud/projects" : "/api/canvas-projects", {
        method:"POST",
        credentials:"same-origin",
        headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify({ name }),
      }),
      body = await snapshotApiResponse(response);
    if (isCloud) rememberSelectedCloudProject(body.project.id);
    else rememberSelectedServerProject(body.project.id);
    await refreshSnapshots();
    if (dialog.open) dialog.close("created");
    showHistoryNoticeKey("canvasProjectCreated", "success");
    return true;
  }
  async function deleteSelectedServerProject(pending = historyDeletePending) {
    if (!pending || pending.type !== "project") return false;
    const isCloud = pending.location === "cloud",
      response = await fetch(isCloud ? `/api/cloud/projects/${encodeURIComponent(pending.id)}` : `/api/canvas-projects/${encodeURIComponent(pending.id)}`, {
      method:"DELETE",
      credentials:"same-origin",
      headers:authenticatedApiHeaders(),
    });
    await snapshotApiResponse(response);
    if (isCloud) rememberSelectedCloudProject(CLOUD_ALL_PROJECTS_ID);
    else rememberSelectedServerProject(SERVER_DEFAULT_PROJECT_ID);
    await refreshSnapshots();
    showHistoryNoticeKey("canvasProjectDeleted", "success", 4200);
    return true;
  }
  async function moveServerSnapshot(id, projectId) {
    const isCloud = state.snapshotLocation === "cloud",
      response = await fetch(isCloud ? `/api/cloud/canvases/${encodeURIComponent(id)}` : `/api/canvases/${encodeURIComponent(id)}/project`, {
      method:isCloud ? "PATCH" : "PUT",
      credentials:"same-origin",
      headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
      body:JSON.stringify({ projectId }),
    });
    await snapshotApiResponse(response);
    if (state.currentSnapshotId === id && state.currentSnapshotLocation === state.snapshotLocation) state.currentSnapshotProjectId = projectId;
    await refreshSnapshots();
    showHistoryNoticeKey("canvasProjectMoved", "success");
  }
  function snapshotItemsForCurrentView() {
    const location = state.snapshotLocation;
    return location === "server" && selectedServerProjectId !== SERVER_ALL_PROJECTS_ID
      ? snapshotItems.filter((item) => (item.projectId || SERVER_DEFAULT_PROJECT_ID) === selectedServerProjectId)
      : location === "cloud" && selectedCloudProjectId !== CLOUD_ALL_PROJECTS_ID
        ? snapshotItems.filter((item) => item.projectId === selectedCloudProjectId)
        : snapshotItems;
  }
  function historySearchQuery() {
    return String(document.querySelector("#historySearch")?.value || "").trim().toLocaleLowerCase(state.language === "zh" ? "zh-CN" : "en");
  }
  function historySortItems(items) {
    const mode = document.querySelector("#historySort")?.value || "modified",
      locale = state.language === "zh" ? "zh-CN" : "en";
    return items.slice().sort((a, b) => mode === "name"
      ? snapshotName(a).localeCompare(snapshotName(b), locale, { numeric:true, sensitivity:"base" })
      : mode === "created"
        ? Number(b.createdAt || 0) - Number(a.createdAt || 0)
        : Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  }
  function updateHistoryLibrarySummary(visibleCount, scopedCount = visibleCount) {
    const location = state.snapshotLocation,
      title = document.querySelector("#historySectionTitle"),
      summary = document.querySelector("#historySectionSummary"),
      windowSummary = document.querySelector("#historyWindowSummary"),
      select = document.querySelector("#historyProjectSelect"),
      projectName = location === "device" ? t("historyAllCanvases") : select?.selectedOptions?.[0]?.textContent || t("historyAllCanvases"),
      countText = Number.isFinite(visibleCount) ? t("historyCanvasCount").replace("{count}", String(visibleCount)) : "",
      locationText = snapshotLocationLabel(location);
    if (snapshotItemsLocation === location && Number.isFinite(scopedCount)) snapshotLocationCountCache.set(location, scopedCount);
    if (title) title.textContent = projectName;
    if (summary) summary.textContent = [countText, locationText].filter(Boolean).join(" · ");
    if (windowSummary) windowSummary.textContent = [locationText, projectName, countText].filter(Boolean).join(" · ");
    document.querySelectorAll(".history-location-count").forEach((node) => {
      const cachedCount = snapshotLocationCountCache.get(node.dataset.location);
      const hasLoadedCount = Number.isFinite(cachedCount);
      node.hidden = !hasLoadedCount;
      node.textContent = hasLoadedCount ? String(cachedCount) : "";
    });
  }
  function updateHistorySelectionUi(items = snapshotItemsForCurrentView()) {
    if (items === null) {
      historySelectedSnapshotId = null;
      historySelectedSnapshotLocation = null;
      historyGridSelectionActivated = false;
    }
    const selectedItem = Array.isArray(items) && historySelectedSnapshotLocation === state.snapshotLocation
      ? items.find((item) => item.id === historySelectedSnapshotId) || null
      : null,
      list = document.querySelector("#historyList"),
      grid = list?.classList.contains("grid-view") === true,
      selectedCard = selectedItem ? list?.querySelector(`.history-card[data-snapshot-id="${CSS.escape(selectedItem.id)}"]`) : null,
      visiblySelectedItem = selectedCard && (!grid || historyGridSelectionActivated) ? selectedItem : null;
    document.querySelectorAll(".history-card").forEach((card) => {
      const selected = Boolean(visiblySelectedItem && card.dataset.snapshotId === visiblySelectedItem.id);
      card.classList.toggle("selected", selected);
      card.dataset.peState = selected ? "selected" : "default";
      card.querySelector(".history-card-select")?.setAttribute("aria-pressed", String(selected));
    });
    return selectedItem;
  }
  function closeHistoryRowActions(except = null) {
    document.querySelectorAll(".history-row-actions:not([hidden])").forEach((row) => {
      if (row === except) return;
      row.hidden = true;
      row.closest(".history-card")?.querySelector(".history-more")?.setAttribute("aria-expanded", "false");
    });
  }
  function positionHistoryRowActions(row, trigger) {
    if (!row || row.hidden || !trigger) return;
    const list = row.closest("#historyList");
    if (!list || list.classList.contains("grid-view")) {
      row.dataset.pePlacement = "top";
      return;
    }
    const listRect = list.getBoundingClientRect(),
      triggerRect = trigger.getBoundingClientRect(),
      menuHeight = row.offsetHeight,
      gutter = 8,
      spaceAbove = triggerRect.top - listRect.top,
      spaceBelow = listRect.bottom - triggerRect.bottom;
    row.dataset.pePlacement = spaceBelow >= menuHeight + gutter || spaceBelow >= spaceAbove ? "bottom" : "top";
  }
  function selectHistorySnapshot(item, location = state.snapshotLocation, { focus = false } = {}) {
    if (!item || location !== state.snapshotLocation) return false;
    historySelectedSnapshotId = item.id;
    historySelectedSnapshotLocation = location;
    if (document.querySelector("#historyList")?.classList.contains("grid-view")) historyGridSelectionActivated = true;
    closeHistoryRowActions();
    updateHistorySelectionUi(snapshotItemsForCurrentView());
    if (focus) document.querySelector(`.history-card[data-snapshot-id="${CSS.escape(item.id)}"] .history-card-select`)?.focus({ preventScroll:true });
    return true;
  }
  function ensureHistorySelection(items, location = state.snapshotLocation) {
    if (!items.length) {
      updateHistorySelectionUi(null);
      return null;
    }
    const previousId = historySelectedSnapshotLocation === location ? historySelectedSnapshotId : null;
    let selected = previousId ? items.find((item) => item.id === previousId) : null;
    selected ||= items.find((item) => item.id === state.currentSnapshotId && location === state.currentSnapshotLocation) || items[0];
    if (selected.id !== previousId) historyGridSelectionActivated = false;
    historySelectedSnapshotId = selected.id;
    historySelectedSnapshotLocation = location;
    return selected;
  }
  function historyItemContentSummary(item) {
    const counts = Number.isFinite(item.tileCount)
      ? [[item.tileCount, item.tileCount === 1 ? "historySnapshotTile" : "historySnapshotTiles"]]
      : [];
    if (item.widgetCount) {
      counts.push([item.widgetCount, item.widgetCount === 1 ? "historySnapshotWidget" : "historySnapshotWidgets"]);
    }
    return counts.map(([count, key]) => `${count} ${t(key)}`).join(" · ");
  }
  function loadHistorySnapshot(item, location, button) {
    if (!item || !button || button.disabled || location !== state.snapshotLocation) return false;
    return runSnapshotLoadAction(button, () => requestLoadSnapshot(item.id, location));
  }
  function setHistoryView(view) {
    const grid = view === "grid", list = document.querySelector("#historyList"), header = document.querySelector("#historyColumnHeader"),
      main = document.querySelector(".history-library-main"),
      changed = Boolean(list) && list.classList.contains("grid-view") !== grid;
    if (changed) historyGridSelectionActivated = false;
    closeHistoryRowActions();
    list?.classList.toggle("grid-view", grid);
    if (list) list.dataset.peList = grid ? "grid" : "media-list";
    main?.classList.toggle("grid-view", grid);
    if (header) header.hidden = grid;
    document.querySelectorAll("[data-history-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.historyView === (grid ? "grid" : "list"))));
    localStorage.setItem(HISTORY_VIEW_STORAGE_KEY, grid ? "grid" : "list");
    updateHistorySelectionUi();
  }
  function renderStudioSnapshotLists() {
    window.PenEchoStudioNavigator?.render?.();
  }
  function revokeHistoryPreviewUrlWhenSettled(url, image) {
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
  function observeServerHistoryPreview(item, image, fallback) {
    if (!item.hasPreview || typeof IntersectionObserver !== "function") return;
    if (!historyPreviewLoader) {
      const loader = { queue:[], active:0, controllers:new Set(), observer:null };
      const pump = () => {
        while (historyPreviewLoader === loader && loader.active < 2 && loader.queue.length) {
          const task = loader.queue.shift();
          if (!task.image.isConnected) continue;
          const controller = new AbortController();
          loader.controllers.add(controller);
          loader.active++;
          const timer = setTimeout(() => controller.abort(), 12000);
          void fetch(`/api/canvases/${encodeURIComponent(task.item.id)}/preview`, {
            credentials:"same-origin", headers:authenticatedApiHeaders(), signal:controller.signal,
          }).then(snapshotApiResponse).then((body) => {
            if (historyPreviewLoader !== loader || !task.image.isConnected || !body?.preview) return;
            const blob = dataUrlBlob(body.preview);
            if (!blob) return;
            task.item.preview = blob;
            const url = URL.createObjectURL(blob);
            historyPreviewUrls.set(url, task.image);
            task.image.onerror = () => {
              if (historyPreviewUrls.delete(url)) URL.revokeObjectURL(url);
              task.image.hidden = true;
              task.fallback.hidden = false;
            };
            task.image.src = url;
            task.image.hidden = false;
            task.fallback.hidden = true;
          }).catch(() => {}).finally(() => {
            clearTimeout(timer);
            loader.controllers.delete(controller);
            loader.active--;
            pump();
          });
        }
      };
      const tasks = new WeakMap();
      loader.tasks = tasks;
      loader.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          loader.observer.unobserve(entry.target);
          const task = tasks.get(entry.target);
          if (task) loader.queue.push(task);
        }
        pump();
      });
      historyPreviewLoader = loader;
    }
    historyPreviewLoader.tasks.set(image.parentElement, { item, image, fallback });
    historyPreviewLoader.observer.observe(image.parentElement);
  }
  function releaseHistoryPreviewUrls() {
    const loader = historyPreviewLoader;
    historyPreviewLoader = null;
    if (loader) {
      loader.observer.disconnect();
      loader.queue.length = 0;
      for (const controller of loader.controllers) controller.abort();
    }
    const entries = [...historyPreviewUrls];
    historyPreviewUrls.clear();
    queueMicrotask(() => {
      for (const [url, image] of entries) revokeHistoryPreviewUrlWhenSettled(url, image);
    });
  }
  function cancelHistoryListRender() {
    historyListRenderGeneration++;
    if (historyListRenderFrame) cancelAnimationFrame(historyListRenderFrame);
    historyListRenderFrame = 0;
  }
  function renderSnapshotList() {
    const list = document.querySelector("#historyList"),
      location = state.snapshotLocation,
      scopedItems = snapshotItemsForCurrentView(),
      query = historySearchQuery(),
      filteredItems = query ? scopedItems.filter((item) => snapshotName(item).toLocaleLowerCase(state.language === "zh" ? "zh-CN" : "en").includes(query)) : scopedItems,
      items = historySortItems(filteredItems);
    if (!list) return;
    cancelHistoryListRender();
    if (!document.querySelector("#historyPanel")?.classList.contains("open")) {
      releaseHistoryPreviewUrls();
      list.replaceChildren();
      renderStudioSnapshotLists();
      return;
    }
    renderServerProjectUi();
    updateHistoryLibrarySummary(items.length, snapshotItems.length);
    if (location === "cloud" && cloudHistorySignInRequired) {
      renderCloudHistorySignIn();
      updateHistoryReadControls();
      return;
    }
    if ((location === "server" && serverSnapshotUnavailableKey) || snapshotListFailedLocation === location) {
      renderSnapshotListError(location, snapshotItemsLocation === location && snapshotItems.length > 0);
      return;
    }
    if (snapshotListInProgress && snapshotItemsLocation !== location) {
      renderSnapshotListLoading(location);
      return;
    }
    releaseHistoryPreviewUrls();
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = t(query && scopedItems.length ? "historyNoMatch" : (location === "server" || location === "cloud") && snapshotItems.length ? "emptyProjectHistory" : location === "server" ? "emptyServerHistory" : location === "cloud" ? "emptyCloudHistory" : "emptyDeviceHistory");
      list.append(empty);
      updateHistorySelectionUi(null);
      renderStudioSnapshotLists();
      return;
    }
    const selectedItem = ensureHistorySelection(items, location),
      renderGeneration = historyListRenderGeneration,
      locale = state.language === "zh" ? "zh-CN" : "en",
      modifiedFormatter = new Intl.DateTimeFormat(locale, { dateStyle:"short", timeStyle:"short" }),
      gridDateFormatter = new Intl.DateTimeFormat(locale, { month:"short", day:"numeric" });
    setHistoryView(localStorage.getItem(HISTORY_VIEW_STORAGE_KEY) === "list" ? "list" : "grid");
    const appendHistoryCard = (item, fragment) => {
      const card = document.createElement("article"),
        selectButton = document.createElement("button"),
        image = document.createElement("img"),
        fallback = document.createElement("span"),
        content = document.createElement("div"),
        meta = document.createElement("div"),
        titleRow = document.createElement("div"),
        title = document.createElement("strong"),
        currentLabel = document.createElement("span"),
        rename = document.createElement("button"),
        load = document.createElement("button"),
        description = document.createElement("p"),
        gridDate = document.createElement("span"),
        footer = document.createElement("div"),
        advancedActions = document.createElement("div"),
        more = document.createElement("button"),
        remove = document.createElement("button"),
        url = item.preview instanceof Blob ? URL.createObjectURL(item.preview) : "";
      card.className = "history-card";
      card.dataset.peItem = "card-action";
      card.dataset.snapshotId = item.id;
      card.setAttribute("role", "listitem");
      const isCurrent = item.id === state.currentSnapshotId && location === state.currentSnapshotLocation;
      card.classList.toggle("current", isCurrent);
      if (isCurrent) card.setAttribute("aria-current", "true");
      const isSelected = selectedItem?.id === item.id;
      card.classList.toggle("selected", isSelected);
      card.dataset.peState = isSelected ? "selected" : "default";
      selectButton.className = "history-card-select history-preview";
      selectButton.type = "button";
      peChoice(selectButton);
      selectButton.dataset.peRegion = "media";
      selectButton.setAttribute("aria-pressed", String(isSelected));
      selectButton.setAttribute("aria-label", isCurrent ? `${snapshotName(item)} · ${t("studioNavigatorCurrent")}` : snapshotName(item));
      image.dataset.peMedia = "prompt-preview";
      image.alt = "";
      image.decoding = "async";
      fallback.dataset.peMedia = "prompt-icon";
      fallback.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4Z"/><path d="m7 15 3-3 2.5 2.5L15 12l3 3"/><circle cx="9" cy="9" r="1.2"/></svg>`;
      if (url) {
        image.src = url;
        historyPreviewUrls.set(url, image);
        fallback.hidden = true;
        image.onerror = () => {
          if (historyPreviewUrls.delete(url)) URL.revokeObjectURL(url);
          image.hidden = true;
          fallback.hidden = false;
        };
      } else image.hidden = true;
      selectButton.append(image, fallback);
      if (!url && location === "server") observeServerHistoryPreview(item, image, fallback);
      if (isCurrent) {
        currentLabel.className = "history-current-label";
        currentLabel.textContent = t("studioNavigatorCurrent");
        selectButton.append(currentLabel);
      }
      content.className = "history-card-content";
      content.dataset.peRegion = "content";
      meta.className = "history-meta";
      meta.dataset.peRegion = "copy";
      titleRow.className = "history-title-row";
      title.className = "history-card-title";
      title.dataset.peRegion = "title";
      title.textContent = snapshotName(item);
      title.title = title.textContent;
      rename.className = "history-rename";
      rename.type = "button";
      peButton(rename, "menu-item", "");
      rename.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.4-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.8 7.6 3 3"/></svg><span>${t("canvasRename")}</span>`;
      rename.setAttribute("aria-label", t("canvasRenameNamed").replace("{name}", title.textContent));
      rename.title = t("canvasRename");
      rename.addEventListener("click", () => {
        closeHistoryRowActions();
        beginSnapshotRename(item, location, titleRow, title, rename);
      });
      titleRow.append(title);
      load.className = isCurrent ? "history-item-save history-save-current" : "history-item-load history-load";
      load.type = "button";
      peButton(load, "secondary", "compact");
      load.dataset.snapshotId = item.id;
      load.textContent = t(isCurrent ? "saveCurrentSnapshot" : "loadSnapshot");
      load.setAttribute("aria-label", `${t(isCurrent ? "saveCurrentSnapshot" : "loadSnapshot")}: ${title.textContent}`);
      load.onclick = isCurrent ? () => saveCurrentHistoryItem(item, location) : () => loadHistorySnapshot(item, location, load);
      const modifiedAt = item.updatedAt || item.createdAt,
        modified = modifiedFormatter.format(modifiedAt),
        gridDateText = gridDateFormatter.format(modifiedAt);
      const stats = document.createElement("div"),
        contentSummary = historyItemContentSummary(item);
      stats.className = "history-stats";
      for (const text of contentSummary.split(" · ").filter(Boolean)) {
        const chip = document.createElement("span");
        chip.className = "history-stat";
        chip.textContent = text;
        stats.append(chip);
      }
      description.className = "history-card-description";
      description.dataset.peRegion = "description";
      gridDate.className = "history-grid-date";
      gridDate.textContent = gridDateText;
      description.append(gridDate, stats);
      const modifiedColumn = document.createElement("div");
      modifiedColumn.className = "history-modified";
      modifiedColumn.textContent = modified;
      more.className = "history-more";
      more.type = "button";
      peButton(more, "toolbar", "compact");
      more.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`;
      more.setAttribute("aria-expanded", "false");
      more.setAttribute("aria-label", t("historyMoreActions").replace("{name}", title.textContent));
      more.title = t("historyMoreActions").replace("{name}", title.textContent);
      const actionId = String(item.id).replace(/[^a-zA-Z0-9_-]/g, "-");
      more.id = `history-more-${actionId}`;
      more.setAttribute("aria-controls", `history-actions-${actionId}`);
      advancedActions.id = `history-actions-${actionId}`;
      advancedActions.className = "history-row-actions pe-compact-menu";
      advancedActions.dataset.peSurface = "menu";
      advancedActions.dataset.peSize = "xs";
      advancedActions.dataset.peLayout = "single";
      advancedActions.dataset.peList = "menu";
      advancedActions.dataset.peMaterial = "popover-glass";
      advancedActions.dataset.pePresentation = "anchored";
      advancedActions.dataset.peState = "default";
      advancedActions.setAttribute("aria-labelledby", more.id);
      advancedActions.hidden = true;
      more.onclick = (event) => {
        const willOpen = advancedActions.hidden;
        closeHistoryRowActions(advancedActions);
        advancedActions.hidden = !willOpen;
        more.setAttribute("aria-expanded", String(!advancedActions.hidden));
        if (!advancedActions.hidden) {
          positionHistoryRowActions(advancedActions, more);
          if (event.detail === 0) rename.focus({ preventScroll:true });
        }
      };
      more.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || advancedActions.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        advancedActions.hidden = true;
        more.setAttribute("aria-expanded", "false");
      });
      advancedActions.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        advancedActions.hidden = true;
        more.setAttribute("aria-expanded", "false");
        more.focus({ preventScroll:true });
      });
      remove.className = "history-delete";
      remove.type = "button";
      peButton(remove, "menu-item", "");
      remove.dataset.peTone = "danger";
      remove.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg><span>${t("deleteSnapshot")}</span>`;
      remove.onclick = () => {
        closeHistoryRowActions();
        requestSnapshotDelete(item, location);
      };
      advancedActions.append(rename);
      if (location === "server" || location === "cloud") {
        const move = document.createElement("select");
        move.className = "history-move";
        move.dataset.peControl = "select";
        move.setAttribute("aria-label", t("canvasProjectMove"));
        move.title = t("canvasProjectMove");
        const projects = location === "cloud" ? cloudCanvasProjects : serverCanvasProjects;
        for (const project of projects) {
          const option = document.createElement("option");
          option.value = project.id;
          option.textContent = `${t("canvasProject")}: ${serverProjectName(project)}`;
          move.append(option);
        }
        move.value = item.projectId || (location === "cloud" ? cloudDefaultProjectId() || "" : SERVER_DEFAULT_PROJECT_ID);
        move.onchange = () => runSnapshotAction(() => moveServerSnapshot(item.id, move.value));
        advancedActions.append(move);
      }
      const actionSeparator = document.createElement("div");
      actionSeparator.className = "menu-separator";
      actionSeparator.setAttribute("role", "separator");
      advancedActions.append(actionSeparator, remove);
      footer.className = "history-card-footer";
      footer.dataset.peRegion = "actions";
      meta.append(titleRow, description);
      footer.append(modifiedColumn, load, more);
      content.append(meta, footer);
      selectButton.onclick = () => selectHistorySnapshot(item, location);
      selectButton.ondblclick = () => {
        selectHistorySnapshot(item, location);
        loadHistorySnapshot(item, location, load);
      };
      content.onclick = (event) => {
        if (event.target.closest("button, input, select, textarea, a")) return;
        selectHistorySnapshot(item, location);
      };
      content.ondblclick = (event) => {
        if (event.target.closest("button, input, select, textarea, a")) return;
        selectHistorySnapshot(item, location);
        loadHistorySnapshot(item, location, load);
      };
      card.append(selectButton, content, advancedActions);
      fragment.append(card);
    };
    let itemIndex = 0;
    const renderBatch = () => {
      historyListRenderFrame = 0;
      if (renderGeneration !== historyListRenderGeneration || !document.querySelector("#historyPanel")?.classList.contains("open")) return;
      const fragment = document.createDocumentFragment(), startedAt = performance.now(), batchEnd = Math.min(items.length, itemIndex + 12);
      while (itemIndex < batchEnd && performance.now() - startedAt < 4) appendHistoryCard(items[itemIndex++], fragment);
      list.append(fragment);
      if (itemIndex < items.length) {
        historyListRenderFrame = requestAnimationFrame(renderBatch);
        return;
      }
      updateHistorySelectionUi(items);
      renderStudioSnapshotLists();
    };
    renderBatch();
  }
  async function refreshSnapshots() {
    const generation = ++snapshotListGeneration,
      location = state.snapshotLocation,
      replacingLocation = snapshotItemsLocation !== location,
      showingCloudCache = location === "cloud" && snapshotItemsLocation === "cloud" && Boolean(cloudHistoryCache);
    snapshotListInProgress = true;
    snapshotListFailedLocation = null;
    if (location === "server") serverSnapshotUnavailableKey = "";
    if (replacingLocation) {
      snapshotItems = [];
      snapshotItemsLocation = null;
      renderSnapshotListLoading(location);
    }
    // The content region owns first-load feedback. Only refreshing visible
    // cached rows needs the existing activity indicator.
    if (replacingLocation || snapshotItems.length === 0) {
      hideHistoryActivity();
      if (!replacingLocation) renderSnapshotListLoading(location);
    } else setHistoryActivity(
      t("snapshotLibraryLoading").replace("{location}", snapshotLocationLabel(location)),
      showingCloudCache ? t("snapshotCloudCacheRefreshing") : "",
      null,
    );
    updateHistoryReadControls();
    let authenticationRequired = false, loadFailed = false;
    try {
      const items = await snapshotsAt(location);
      if (generation !== snapshotListGeneration || location !== state.snapshotLocation) return false;
      if (location === "cloud") cloudHistorySignInRequired = false;
      if (location === "server") serverSnapshotUnavailableKey = "";
      snapshotItems = items;
      snapshotItemsLocation = location;
      if (location === "cloud") cacheCloudHistory(items);
      renderSnapshotList();
      hideHistoryActivity(260);
      return true;
    } catch (error) {
      if (generation === snapshotListGeneration && location === state.snapshotLocation) {
        loadFailed = true;
        snapshotListFailedLocation = location;
        if (location === "server" && ["device_offline", "linked_device_required"].includes(error.code)) {
          serverSnapshotUnavailableKey = error.code === "device_offline" ? "serverHistoryDeviceOffline" : "serverHistoryDeviceRequired";
          snapshotItems = [];
          snapshotItemsLocation = null;
          serverCanvasProjects = [];
          renderSnapshotList();
          hideHistoryActivity();
          return false;
        }
        authenticationRequired = location === "cloud" && cloudHistoryRequiresSignIn(error);
        if (location === "cloud") cloudHistorySignInRequired = authenticationRequired;
        if (authenticationRequired) {
          snapshotItems = [];
          snapshotItemsLocation = null;
          cloudCanvasProjects = [];
          clearCloudHistoryCache();
          renderCloudHistorySignIn();
        } else {
          const retainItems = snapshotItemsLocation === location && snapshotItems.length > 0;
          if (!retainItems) {
            snapshotItems = [];
            snapshotItemsLocation = null;
          }
          renderSnapshotListError(location, retainItems);
        }
      }
      if (authenticationRequired) return false;
      throw error;
    } finally {
      if (generation === snapshotListGeneration) {
        snapshotListInProgress = false;
        if (authenticationRequired || loadFailed) hideHistoryActivity();
        updateHistoryReadControls();
      }
    }
  }
  async function runSnapshotAction(action) {
    try {
      await action();
    } catch (error) {
      setStatus(`${t("snapshotError")}${error.message}`);
    }
  }
  async function runSnapshotLoadAction(button, action) {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      await runSnapshotAction(action);
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
  function openHistoryPanel(refresh = true) {
    const panel = document.querySelector("#historyPanel"),
      backdrop = document.querySelector("#historyBackdrop"),
      button = document.querySelector("#historyBtn");
    window.PenEchoStudioNavigator?.historyManagerWillOpen?.();
    backdrop.hidden = false;
    panel.inert = false;
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-expanded", "true");
    updateSnapshotLocationUi();
    historyGridSelectionActivated = false;
    setHistoryView(localStorage.getItem(HISTORY_VIEW_STORAGE_KEY) === "list" ? "list" : "grid");
    const generation = ++historyOpenWorkGeneration;
    requestAnimationFrame(() => {
      if (generation !== historyOpenWorkGeneration || !panel.classList.contains("open")) return;
      panel.focus({ preventScroll:true });
      requestAnimationFrame(() => {
        if (generation !== historyOpenWorkGeneration || !panel.classList.contains("open")) return;
        renderSnapshotList();
        if (refresh) refreshSnapshots().catch((error) => {
          if (state.snapshotLocation !== "cloud" || !cloudHistoryRequiresSignIn(error)) setStatus(`${t("snapshotError")}${error.message}`);
        });
      });
    });
  }
  function closeHistoryPanel() {
    const panel = document.querySelector("#historyPanel"),
      backdrop = document.querySelector("#historyBackdrop"),
      button = document.querySelector("#historyBtn");
    closeHistorySavePanel();
    historyOpenWorkGeneration++;
    cancelHistoryListRender();
    if (panel.contains(document.activeElement)) button.focus({ preventScroll:true });
    panel.inert = true;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
    window.PenEchoStudioNavigator?.historyManagerDidClose?.();
    setTimeout(() => {
      if (!panel.classList.contains("open")) {
        backdrop.hidden = true;
        document.querySelector("#historyList")?.replaceChildren();
        releaseHistoryPreviewUrls();
      }
    }, 220);
  }
  function trapHistoryPanelFocus(event) {
    const panel = document.querySelector("#historyPanel");
    if (event.key !== "Tab" || !panel?.classList.contains("open") || document.querySelector("dialog[open]")) return false;
    const controls = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')].filter((control) => !control.hidden && control.getClientRects().length);
    if (!controls.length) {
      event.preventDefault();
      panel.focus({ preventScroll:true });
      return true;
    }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll:true });
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll:true });
      return true;
    }
    if (!panel.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll:true });
      return true;
    }
    return false;
  }
  function recordBefore(tx, ty) {
    const k = key(tx, ty);
    if (!state.historyBefore.has(k)) state.historyBefore.set(k, cloneCanvas(tiles.get(k)));
  }
  function unionLocalBounds(current, next) {
    if (!current) return next;
    if (!next) return current;
    const x = Math.min(current.x, next.x),
      y = Math.min(current.y, next.y),
      right = Math.max(current.x + current.w, next.x + next.w),
      bottom = Math.max(current.y + current.h, next.y + next.h);
    return { x, y, w: right - x, h: bottom - y };
  }
  function extendInkBounds(k, next) {
    if (!state.inkBounds.has(k)) return;
    state.inkBounds.set(k, unionLocalBounds(state.inkBounds.get(k), next));
  }
  function lineIntersectsRect(a, b, rect) {
    let t0 = 0,
      t1 = 1;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      tests = [
        [-dx, a.x - rect.x],
        [dx, rect.x + rect.w - a.x],
        [-dy, a.y - rect.y],
        [dy, rect.y + rect.h - a.y],
      ];
    for (const [p, q] of tests) {
      if (!p) {
        if (q < 0) return false;
        continue;
      }
      const ratio = q / p;
      if (p < 0) t0 = Math.max(t0, ratio);
      else t1 = Math.min(t1, ratio);
      if (t0 > t1) return false;
    }
    return true;
  }
  function stroke(a, b, erase = false, size = state.pen, userChange = false, color = state.inkColor) {
    if (!valid(a) || !valid(b)) return;
    const pad = size / 2 + 2,
      x = Math.min(a.x, b.x) - pad,
      y = Math.min(a.y, b.y) - pad,
      w = Math.abs(a.x - b.x) + pad * 2,
      h = Math.abs(a.y - b.y) + pad * 2,
      changedBox = { x, y, w, h };
    invalidateSharpOverlays(changedBox);
    const x0 = Math.max(0, Math.floor(x / TILE)),
      y0 = Math.max(0, Math.floor(y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.floor((x + w) / TILE)),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.floor((y + h) / TILE));
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const expanded = { x: tx * TILE - pad, y: ty * TILE - pad, w: TILE + pad * 2, h: TILE + pad * 2 };
        if (!lineIntersectsRect(a, b, expanded)) continue;
        const existing = tile(tx, ty, false);
        if (erase && !existing) continue;
        recordBefore(tx, ty);
        const c = existing || tile(tx, ty),
          q = c.getContext("2d");
        q.save();
        q.globalCompositeOperation = erase ? "destination-out" : "source-over";
        q.strokeStyle = color;
        q.lineWidth = size;
        q.lineCap = q.lineJoin = "round";
        q.beginPath();
        q.moveTo(a.x - tx * TILE, a.y - ty * TILE);
        q.lineTo(b.x - tx * TILE, b.y - ty * TILE);
        q.stroke();
        q.restore();
        if (userChange) trackDirtyStrokeSegment(tx, ty, a, b, erase, size, changedBox);
        const k = key(tx, ty);
        if (erase) state.inkBounds.delete(k);
        else {
          const local = {
            x: Math.max(0, Math.min(a.x, b.x) - tx * TILE - pad),
            y: Math.max(0, Math.min(a.y, b.y) - ty * TILE - pad),
            w: Math.min(TILE, Math.max(a.x, b.x) - tx * TILE + pad) - Math.max(0, Math.min(a.x, b.x) - tx * TILE - pad),
            h: Math.min(TILE, Math.max(a.y, b.y) - ty * TILE + pad) - Math.max(0, Math.min(a.y, b.y) - ty * TILE - pad),
          };
          if (!existing) state.inkBounds.set(k, local);
          else extendInkBounds(k, local);
        }
      }
    if (userChange && !erase) {
      mergeDirty(a.x, a.y, pad);
      mergeDirty(b.x, b.y, pad);
    }
  }
  function dot(p, erase = false, size = state.pen, userChange = false, color = state.inkColor) {
    stroke(p, { x: p.x + 0.01, y: p.y + 0.01 }, erase, size, userChange, color);
  }
  function areaEraseBox(gesture = state.areaEraseGesture) {
    if (!gesture?.start || !gesture.current) return null;
    const x = Math.min(gesture.start.x, gesture.current.x),
      y = Math.min(gesture.start.y, gesture.current.y),
      right = Math.max(gesture.start.x, gesture.current.x),
      bottom = Math.max(gesture.start.y, gesture.current.y);
    return { x, y, w:right - x, h:bottom - y };
  }
  function beginAreaEraseGesture(event, point) {
    if (!valid(point)) return false;
    supersedeActiveAI("user-input-started");
    clearTimeout(state.timer);
    state.timer = 0;
    hideWidgetRefineHint();
    clearWidgetRefineCandidate();
    const clipped = SELECT.clipPoint(point, SIZE);
    state.areaEraseGesture = { id:event.pointerId, start:clipped, current:clipped };
    resetCanvasCursor();
    requestInteractionLayerRender();
    return true;
  }
  function updateAreaEraseGesture(event) {
    const gesture = state.areaEraseGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    gesture.current = SELECT.clipPoint(clientPoint(event), SIZE);
    requestInteractionLayerRender();
    return true;
  }
  function cancelAreaEraseGesture() {
    if (!state.areaEraseGesture) return false;
    state.areaEraseGesture = null;
    resetCanvasCursor();
    requestInteractionLayerRender();
    return true;
  }
  function clearDirtyInkRegion(box) {
    const touchedTiles = new Set();
    for (const [tileKey, canvas] of state.dirtyInkTiles) {
      const [tx, ty] = tileKey.split(",").map(Number),
        tileBox = { x:tx * TILE, y:ty * TILE, w:TILE, h:TILE },
        part = intersection(tileBox, box);
      if (!part) continue;
      canvas.getContext("2d", { willReadFrequently:true }).clearRect(
        (part.x - tileBox.x) * DIRTY_MASK_SCALE,
        (part.y - tileBox.y) * DIRTY_MASK_SCALE,
        part.w * DIRTY_MASK_SCALE,
        part.h * DIRTY_MASK_SCALE,
      );
      state.dirtyInkBounds.delete(tileKey);
      touchedTiles.add(tileKey);
    }
    return touchedTiles;
  }
  function eraseInkRegion(box) {
    if (!box || box.w <= 0 || box.h <= 0) return false;
    save();
    invalidateSharpOverlays(box);
    let changed = false;
    forTiles(
      box.x,
      box.y,
      box.w,
      box.h,
      (canvas, tx, ty) => {
        const tileKey = key(tx, ty),
          tileBox = { x:tx * TILE, y:ty * TILE, w:TILE, h:TILE },
          part = intersection(tileBox, box);
        if (!part) return;
        let bounds = state.inkBounds.get(tileKey);
        if (bounds === undefined) {
          bounds = inkBox(canvas, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE));
          state.inkBounds.set(tileKey, bounds);
        }
        const localPart = { x:part.x - tileBox.x, y:part.y - tileBox.y, w:part.w, h:part.h };
        if (!bounds || !intersection(bounds, localPart)) return;
        recordBefore(tx, ty);
        canvas.getContext("2d").clearRect(localPart.x, localPart.y, localPart.w, localPart.h);
        state.inkBounds.delete(tileKey);
        changed = true;
      },
      false,
    );
    const touchedTiles = clearDirtyInkRegion(box);
    if (!changed && !touchedTiles.size) {
      setStatusKey("selectionEmpty");
      requestInteractionLayerRender();
      return false;
    }
    state.userRevision++;
    if (state.pending) state.pending.latestUserRevision = state.userRevision;
    recomputeDirtyBounds();
    filterErasedDirtyHotspots(touchedTiles);
    const refineCandidate = relatchWidgetRefineCandidateFromDirty();
    saveUserCanvasChange();
    requestRender();
    if (state.dirty && state.autoEligible && !refineCandidate) schedule();
    setStatusKey(refineCandidate ? "widgetRefinePending" : state.pending?.items ? "batchDraftReady" : state.pending ? "draftReady" : "areaEraseDeleted");
    return true;
  }
  function finishAreaEraseGesture(event) {
    const gesture = state.areaEraseGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    if (event.type !== "pointercancel") gesture.current = SELECT.clipPoint(clientPoint(event), SIZE);
    const box = areaEraseBox(gesture);
    state.areaEraseGesture = null;
    resetCanvasCursor();
    requestInteractionLayerRender();
    if (event.type === "pointercancel") return true;
    if (!box || box.w * state.scale < 4 || box.h * state.scale < 4) {
      setStatusKey("areaEraseTooSmall");
      return true;
    }
    eraseInkRegion(box);
    return true;
  }
  function pressureWidth(e) {
    if (e.pointerType !== "pen" || !Number.isFinite(e.pressure) || e.pressure <= 0) return state.pen;
    return Math.max(3, Math.min(16, state.pen * (0.72 + e.pressure * 0.7)));
  }
  function logicalWidth(cssWidth) {
    const maximum = state.mode === "eraser" ? 1600 : 320;
    return Math.max(1, Math.min(maximum, cssWidth / Math.max(0.03, state.scale)));
  }
  function drawPreview(s, context = ctx) {
    const ctx = context;
    ctx.strokeStyle = s.erase ? "#dc262666" : `${state.inkColor}88`;
    ctx.lineWidth = s.size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
  }
  function clonePendingHistoryItem(item) {
    if (!item) return null;
    return {
      ...item,
      command:item.command ? { ...item.command } : item.command,
      textCommand:item.textCommand ? { ...item.textCommand } : item.textCommand,
      animationPlayback:item.animationPlayback ? { ...item.animationPlayback } : item.animationPlayback,
      bounds:item.bounds ? { ...item.bounds } : item.bounds,
    };
  }
  function clonePendingHistoryDraft(pending) {
    if (!pending) return null;
    const clone = {
      ...pending,
      command:pending.command ? { ...pending.command } : pending.command,
      textCommand:pending.textCommand ? { ...pending.textCommand } : pending.textCommand,
      animationPlayback:pending.animationPlayback ? { ...pending.animationPlayback } : pending.animationPlayback,
      resolves:[],
      resolve:null,
    };
    if (pending.items) clone.items = pending.items.map(clonePendingHistoryItem);
    return clone;
  }
  function pendingWidgetHistoryRecord(widget) {
    if (!widget) return null;
    return {
      id:widget.id,
      pluginId:widget.pluginId,
      x:widget.x,
      y:widget.y,
      w:widget.w,
      h:widget.h,
      contentW:widget.contentW,
      contentH:widget.contentH,
      title:widget.title,
      refreshSeconds:widget.refreshSeconds,
      widgetType:widget.widgetType,
      ...(widget.widgetType === "diagram_source" ? { source:widget.source } : { html:widget.html }),
      ...(widget.diagramKind ? { diagramKind:widget.diagramKind } : {}),
      ...(widget.sourceFormat ? { sourceFormat:widget.sourceFormat } : {}),
      ...(widget.frameworkVersion ? { frameworkVersion:widget.frameworkVersion } : {}),
      ...(widget.copyText ? { copyText:widget.copyText, copyLabel:widget.copyLabel } : {}),
      revision:widget.revision,
    };
  }
  function capturePendingHistoryState() {
    if (!state.pending && !state.pendingWidget) return null;
    return {
      pending:clonePendingHistoryDraft(state.pending),
      pendingWidget:pendingWidgetHistoryRecord(state.pendingWidget),
      returnMode:state.aiDraftReturnMode,
    };
  }
  function recordPendingHistory(entry, before, after = null) {
    if (!entry || !before) return;
    entry.pendingBefore = before;
    entry.pendingAfter = after;
    entry.aiDraftReturnMode = before.returnMode;
  }
  function clearPendingHistoryState() {
    const returnMode = state.aiDraftReturnMode;
    state.pending = null;
    state.pendingGesture = null;
    if (state.pendingWidget) rejectPendingWidget(AI_CANCELLED, { restoreMode:false, status:false });
    state.pendingWidgetReplacement = null;
    state.pendingHistoryRestored = false;
    state.aiDraftReturnMode = null;
    hideAnimationControls();
    updateBatchActions();
    return returnMode;
  }
  function restorePendingHistoryState(entry, side) {
    const returnMode = clearPendingHistoryState(),
      hasPendingTransition = !Array.isArray(entry) && Object.prototype.hasOwnProperty.call(entry || {}, "pendingBefore");
    if (!hasPendingTransition) {
      if (returnMode && state.mode === "select") setCanvasMode(returnMode, { preserveSelection:true, skipDraftFinalize:true });
      return;
    }
    const snapshot = side === "before" ? entry.pendingBefore : entry.pendingAfter;
    if (!snapshot) {
      const mode = entry.aiDraftReturnMode;
      if (mode && state.mode === "select") setCanvasMode(mode, { preserveSelection:true, skipDraftFinalize:true });
      return;
    }
    state.aiDraftReturnMode = snapshot.returnMode;
    if (snapshot.pending) {
      state.pending = clonePendingHistoryDraft(snapshot.pending);
      state.pending.revision = state.userRevision;
      state.pending.latestUserRevision = state.userRevision;
    }
    if (snapshot.pendingWidget) {
      const widget = widgetRecord(snapshot.pendingWidget);
      if (widget) {
        widget.pending = true;
        widget.revision = state.userRevision;
        const numbered = /^widget-(\d+)$/.exec(widget.id);
        if (numbered) state.nextWidgetId = Math.max(state.nextWidgetId, Number(numbered[1]) + 1);
        state.pendingWidget = widget;
        mountWidget(widget);
      }
    }
    state.pendingHistoryRestored = Boolean(state.pending || state.pendingWidget);
    if (state.pendingHistoryRestored) {
      setCanvasMode("select", { preserveSelection:true, skipDraftFinalize:true });
      updateBatchActions();
      setStatusKey(state.pending?.items ? "batchDraftReady" : "draftReady");
    }
  }
  function save() {
    if (!state.historyBefore.size && !state.animationHistoryBefore && !state.widgetHistoryBefore && !state.imageHistoryBefore && !state.textBoxHistoryBefore) return null;
    const changes = [];
    const animationsBefore = state.animationHistoryBefore,
      animationsAfter = animationsBefore ? serializedAnimations() : null,
      widgetsBefore = state.widgetHistoryBefore,
      widgetsAfter = widgetsBefore ? serializedWidgets() : null,
      imagesBefore = state.imageHistoryBefore,
      imagesAfter = imagesBefore ? imageHistoryState() : null,
      textBoxesBefore = state.textBoxHistoryBefore,
      textBoxesAfter = textBoxesBefore ? textBoxHistoryState() : null;
    for (const [k, before] of state.historyBefore) {
      let current = tiles.get(k);
      if (current && state.inkBounds.get(k) === undefined) {
        const [tx, ty] = k.split(",").map(Number),
          ink = inkBox(current, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE));
        if (ink) state.inkBounds.set(k, ink);
        else {
          tiles.delete(k);
          state.inkBounds.delete(k);
          current = null;
        }
      }
      changes.push({ k, before, after: cloneCanvas(current) });
    }
    state.historyBefore.clear();
    const entry = { tiles: changes, animationsBefore, animationsAfter, widgetsBefore, widgetsAfter, imagesBefore, imagesAfter, textBoxesBefore, textBoxesAfter };
    state.history.push(entry);
    state.animationHistoryBefore = null;
    state.widgetHistoryBefore = null;
    state.imageHistoryBefore = null;
    state.textBoxHistoryBefore = null;
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future = [];
    window.PenEchoStudioNavigator?.updateDocument?.();
    return entry;
  }
  function saveUserCanvasChange() {
    return canvasAgentDidCommitUserCanvasChange(save(), { allowAutoHide:canvasSnapshotFinalizationDepth === 0 });
  }
  function applyHistory(entry, side) {
    const changes = Array.isArray(entry) ? entry : entry?.tiles || [];
    for (const change of changes) {
      const value = change[side];
      if (value) tiles.set(change.k, cloneCanvas(value));
      else tiles.delete(change.k);
      state.inkBounds.delete(change.k);
    }
    const animationState = !Array.isArray(entry) ? entry?.[side === "before" ? "animationsBefore" : "animationsAfter"] : null;
    if (animationState) restoreAnimations(animationState);
    const widgetState = !Array.isArray(entry) ? entry?.[side === "before" ? "widgetsBefore" : "widgetsAfter"] : null;
    if (widgetState) restoreWidgets(widgetState);
    const imageState = !Array.isArray(entry) ? entry?.[side === "before" ? "imagesBefore" : "imagesAfter"] : null;
    if (imageState) restoreImages(imageState);
    const textBoxState = !Array.isArray(entry) ? entry?.[side === "before" ? "textBoxesBefore" : "textBoxesAfter"] : null;
    if (textBoxState) void restoreTextBoxes(textBoxState);
    restorePendingHistoryState(entry, side);
    clearSharpOverlays();
    requestAnimationLayerRender();
    render();
    window.PenEchoStudioNavigator?.updateDocument?.();
  }
  function undo() {
    save();
    const change = state.history.pop();
    if (!change) return;
    invalidateRecognition();
    state.future.push(change);
    applyHistory(change, "before");
  }
  function redo() {
    const change = state.future.pop();
    if (!change) return;
    invalidateRecognition();
    state.history.push(change);
    applyHistory(change, "after");
  }
  function sameBox(a, b) {
    return a && b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;
  }
  function selectionHasChanges(selection) {
    return Boolean(selection?.color) || !sameBox(selection?.box, selection?.originalBox);
  }
  function recolorSelectionImage(image, color) {
    const recolored = offscreen(image.width, image.height),
      context = recolored.getContext("2d");
    context.drawImage(image, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, recolored.width, recolored.height);
    return recolored;
  }
  function traceSelectionPath(context, points, offsetX = 0, offsetY = 0, close = true) {
    if (!points.length) return;
    context.beginPath();
    context.moveTo(points[0].x - offsetX, points[0].y - offsetY);
    for (let index = 1; index < points.length; index++) context.lineTo(points[index].x - offsetX, points[index].y - offsetY);
    if (close) context.closePath();
  }
  function selectionPathFor(selection, box = selection.box) {
    const source = selection.originalPath || selection.points || [];
    return selection.originalBox && box ? SELECT.mapPath(source, selection.originalBox, box) : source.map((point) => ({ ...point }));
  }
  function selectionContentBounds(selection) {
    let bounds = null;
    for (const fragment of selection.fragments || []) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      bounds = SELECT.unionBox(bounds, target);
    }
    return bounds;
  }
  function drawSelectionAxisHandles(context, box, size) {
    context.moveTo(box.x + box.w, box.y + box.h / 2 - size * 0.48);
    context.lineTo(box.x + box.w, box.y + box.h / 2 + size * 0.48);
    context.moveTo(box.x + box.w / 2 - size * 0.48, box.y + box.h);
    context.lineTo(box.x + box.w / 2 + size * 0.48, box.y + box.h);
  }
  function drawSelectionContent(selection, context = ctx) {
    if (selection?.phase !== "active") return;
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      context.drawImage(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
    }
  }
  function drawSelection(selection, context = ctx) {
    const ctx = context,
      unit = 1 / state.scale,
      size = 14 * unit;
    if (selection.phase === "lasso") {
      ctx.save();
      ctx.fillStyle = "#2679b81a";
      ctx.strokeStyle = "#2679b8";
      ctx.lineWidth = 1.5 * unit;
      ctx.setLineDash([7 * unit, 6 * unit]);
      traceSelectionPath(ctx, selection.points);
      ctx.fill("evenodd");
      ctx.stroke();
      ctx.restore();
      return;
    }
    drawSelectionContent(selection, ctx);
    const path = selectionPathFor(selection);
    ctx.save();
    ctx.strokeStyle = "#2679b8";
    ctx.lineWidth = 1.8 * unit;
    ctx.setLineDash([7 * unit, 6 * unit]);
    traceSelectionPath(ctx, path);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    ctx.beginPath();
    drawResizeHandle(ctx, selection.box, size);
    drawSelectionAxisHandles(ctx, selection.box, size);
    ctx.stroke();
    ctx.restore();
    if (selection.showMoveHandle) drawMoveHandle(ctx, selection.box, size, true);
    // Keep the legacy call shape available for integrations that opt into the old controls.
    if (selection.legacyActions) drawDraftActions(ctx, selection.box, size);
  }
  function captureSelection(points) {
    const box = SELECT.polygonBounds(points, SIZE);
    if (!box || points.length < 3 || SELECT.pathLength(points, state.scale) < 12 || box.w * state.scale < 4 || box.h * state.scale < 4) {
      setStatusKey("selectionTooSmall");
      return false;
    }
    const fragments = [];
    const originalBox = { ...box };
    forTiles(
      box.x,
      box.y,
      box.w,
      box.h,
      (canvas, tx, ty) => {
        const tileBox = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE },
          part = intersection(tileBox, box);
        if (!part) return;
        const clipped = offscreen(part.w, part.h, true),
          clippedContext = clipped.getContext("2d", { willReadFrequently: true });
        clippedContext.save();
        traceSelectionPath(clippedContext, points, part.x, part.y);
        clippedContext.clip("evenodd");
        clippedContext.drawImage(canvas, part.x - tileBox.x, part.y - tileBox.y, part.w, part.h, 0, 0, part.w, part.h);
        clippedContext.restore();
        const ink = inkBox(clipped);
        if (!ink) return;
        const image = offscreen(ink.w, ink.h);
        image.getContext("2d").drawImage(clipped, ink.x, ink.y, ink.w, ink.h, 0, 0, ink.w, ink.h);
        const fragment = { image, x: part.x + ink.x, y: part.y + ink.y, w: ink.w, h: ink.h };
        fragments.push(fragment);
      },
      false,
    );
    if (!fragments.length) {
      state.selection = null;
      setStatusKey("selectionEmpty");
      render();
      return false;
    }
    invalidateSharpOverlays(box);
    save();
    invalidateRecognition();
    state.userRevision++;
    const beforeTiles = new Map();
    forTiles(
      box.x,
      box.y,
      box.w,
      box.h,
      (canvas, tx, ty) => {
        const tileKey = key(tx, ty),
          before = cloneCanvas(canvas);
        beforeTiles.set(tileKey, before);
        state.historyBefore.set(tileKey, before);
      },
      false,
    );
    forTiles(
      box.x,
      box.y,
      box.w,
      box.h,
      (canvas, tx, ty) => {
        recordBefore(tx, ty);
        const tileContext = canvas.getContext("2d");
        tileContext.save();
        tileContext.globalCompositeOperation = "destination-out";
        tileContext.fillStyle = "#000";
        traceSelectionPath(tileContext, points, tx * TILE, ty * TILE);
        tileContext.fill("evenodd");
        tileContext.restore();
        state.inkBounds.delete(key(tx, ty));
      },
      false,
    );
    state.selection = {
      phase: "active",
      originalPath: points.map((point) => ({ ...point })),
      path: points.map((point) => ({ ...point })),
      originalBox,
      box: { ...originalBox },
      fragments,
      contentBox: selectionContentBounds({ fragments, originalBox, box: originalBox }),
      beforeTiles,
      color: null,
    };
    state.selectionGesture = null;
    setStatusKey("selectionReady");
    render();
    return true;
  }
  function restoreSelectionSource(selection) {
    for (const [tileKey, before] of selection.beforeTiles) {
      if (before) tiles.set(tileKey, cloneCanvas(before));
      else tiles.delete(tileKey);
      state.inkBounds.delete(tileKey);
    }
    state.historyBefore.clear();
  }
  function cancelSelection(silent = false) {
    const selection = state.selection;
    if (!selection) return false;
    const pending = state.pending,
      selectionRequest = state.activeAI?.selection === selection,
      pendingSelection = pending?.selection === selection || (pending?.isolatedSelection && selectionRequest);
    if (pendingSelection) rejectPending();
    if (selectionAIBusy(selection) || selectionRequest) supersedeActiveAI("selection-cancelled");
    if (selection.phase === "active" && !selection.acceptedDraft) restoreSelectionSource(selection);
    state.selection = null;
    state.selectionGesture = null;
    resetCanvasCursor();
    render();
    if (!silent) setStatusKey("selectionCancelled");
    return true;
  }
  function commitSelection() {
    const selection = state.selection;
    if (!selection) return false;
    if (selectionAIBusy(selection)) return false;
    if (selection.phase !== "active") {
      state.selection = null;
      state.selectionGesture = null;
      render();
      return false;
    }
    if (!selectionHasChanges(selection)) {
      cancelSelection(true);
      setStatusKey("selectionCommitted");
      return false;
    }
    state.selection = null;
    state.selectionGesture = null;
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      blitSized(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
    }
    state.userRevision++;
    saveUserCanvasChange();
    resetCanvasCursor();
    render();
    setStatusKey("selectionCommitted");
    return true;
  }
  function applySelectionColor(color) {
    const selection = state.selection;
    if (!selection || selection.phase !== "active" || selection.color === color) return false;
    selection.color = color;
    for (const fragment of selection.fragments) fragment.renderImage = recolorSelectionImage(fragment.image, color);
    render();
    setStatusKey("selectionRecolored");
    return true;
  }
  function updateSelectionToolbar() {
    if (!selectionOverlayLayer || !selectionToolbar) return;
    const selection = state.selection,
      active = selection?.phase === "active";
    selectionOverlayLayer.hidden = !active;
    selectionOverlayLayer.setAttribute("aria-hidden", String(!active));
    if (!active) return;
    const { width:viewportWidth, height:viewportHeight } = canvasViewportMetrics(),
      box = selection.box,
      toolbarStyle = runtimeElementStyle(selectionToolbar, "selection-toolbar"),
      selectionBusy = selectionAIBusy(selection),
      isTypesetting = selectionIsTypesetting(selection);
    selectionToolbar.hidden = false;
    selectionToolbar.setAttribute("aria-busy", String(selectionBusy));
    if (selectionTypesetButton) {
      selectionTypesetButton.disabled = false;
      selectionTypesetButton.setAttribute("aria-busy", String(isTypesetting));
      selectionTypesetButton.textContent = t(isTypesetting ? "selectionTypesetting" : "selectionTypeset");
    }
    if (selectionDeleteButton) selectionDeleteButton.disabled = selectionBusy;
    const width = selectionToolbar.offsetWidth || 280,
      height = selectionToolbar.offsetHeight || 36,
      left = box.x * state.scale + state.panX,
      top = box.y * state.scale + state.panY,
      bottom = (box.y + box.h) * state.scale + state.panY,
      maxX = Math.max(8, viewportWidth - width - 8),
      x = Math.max(8, Math.min(maxX, left + (box.w * state.scale - width) / 2)),
      preferredY = top - height - 8,
      y = preferredY >= 8 ? preferredY : bottom + 8,
      maxY = Math.max(8, viewportHeight - height - 8);
    toolbarStyle?.setProperty("--selection-toolbar-x", `${x}px`);
    toolbarStyle?.setProperty("--selection-toolbar-y", `${Math.max(8, Math.min(maxY, y))}px`);
  }
  function releaseSelectionAITransformLock(run = state.activeAI) {
    const selection = run?.isolatedSelection ? run.selection : null,
      token = run?.selectionRequestToken;
    if (!selection || !token || selection.aiRequest?.token !== token || state.selection !== selection) return;
    selection.aiRequest = null;
    updateSelectionToolbar();
  }
  function preservePendingAfterSelectionDelete(selection, pending = state.pending, selectionRequest = false) {
    if (!pending || (pending.selection !== selection && !(pending.isolatedSelection && selectionRequest))) return;
    pending.revision = state.userRevision;
    pending.latestUserRevision = state.userRevision;
  }
  function deleteSelection() {
    const selection = state.selection;
    if (!selection || selection.phase !== "active") return false;
    const pending = state.pending,
      selectionRequest = state.activeAI?.selection === selection || pending?.selection === selection;
    supersedeActiveAI("selection-deleted");
    state.selection = null;
    state.selectionGesture = null;
    state.userRevision++;
    preservePendingAfterSelectionDelete(selection, pending, selectionRequest);
    saveUserCanvasChange();
    resetCanvasCursor();
    render();
    setStatusKey("selectionDeleted");
    return true;
  }
  function buildSelectionTypesetRequest(selection) {
    const packed = buildSelectionImage(selection);
    if (!packed) {
      setStatusKey("selectionEmpty");
      return null;
    }
    return packed;
  }
  function normalizeSelectionForAI() {
    const selection = state.selection;
    if (!selection || selection.phase !== "active") return false;
    const packed = buildSelectionTypesetRequest(selection);
    if (!packed) return false;
    return requestSelectionAI("normalize", selection, packed);
  }
  function selectionHit(selection, event) {
    const point = clientPoint(event),
      size = 14 / state.scale;
    const includeLegacyActions = Boolean(selection.legacyActions);
    return selection.path?.length >= 3
      ? SELECT.hitTestPath(selection.path, selection.box, point, size, includeLegacyActions)
      : SELECT.hitTest(selection.box, point, size, includeLegacyActions);
  }
  function beginSelectionLasso(event, point) {
    state.selection = { phase: "lasso", points: [SELECT.clipPoint(point, SIZE)], box: null };
    state.selectionGesture = { id: event.pointerId, hit: "lasso" };
    resetCanvasCursor();
    requestRender();
  }
  function beginSelectionTransform(event, hit) {
    if (selectionAIBusy()) return false;
    const point = clientPoint(event);
    state.selectionGesture = {
      id: event.pointerId,
      hit,
      startPoint: point,
      startBox: { ...state.selection.box },
    };
    setCanvasCursor(hit === "resize" ? "nwse-resize" : hit === "width" ? "ew-resize" : hit === "height" ? "ns-resize" : "grabbing");
  }
  function addLassoPoint(selection, point, minimumDistance) {
    if (!SELECT.shouldAddPoint(selection.points, point, minimumDistance)) return false;
    if (selection.points.length >= MAX_LASSO_POINTS) selection.points = selection.points.filter((_, index) => index % 2 === 0);
    selection.points.push(point);
    return true;
  }
  function updateSelectionGesture(event) {
    const gesture = state.selectionGesture,
      selection = state.selection;
    if (!gesture || !selection || gesture.id !== event.pointerId || selectionAIBusy(selection)) return false;
    const point = clientPoint(event);
    if (gesture.hit === "lasso") {
      const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [],
        events = samples.length ? samples : [event],
        minimumDistance = 0.75 / Math.max(0.03, state.scale);
      for (const sample of events) addLassoPoint(selection, SELECT.clipPoint(clientPoint(sample), SIZE), minimumDistance);
      selection.box = SELECT.polygonBounds(selection.points, SIZE);
    } else if (gesture.hit === "move") selection.box = SELECT.moveBox(gesture.startBox, point.x - gesture.startPoint.x, point.y - gesture.startPoint.y, SIZE);
    else if (gesture.hit === "resize") selection.box = SELECT.resizeBox(gesture.startBox, point, 24 / state.scale, SIZE);
    else if (gesture.hit === "width" || gesture.hit === "height") selection.box = SELECT.resizeBoxAxis(gesture.startBox, point, gesture.hit, 24 / state.scale, SIZE);
    if (selection.phase === "active") selection.path = selectionPathFor(selection);
    requestRender();
    return true;
  }
  function finishSelectionGesture(event) {
    const gesture = state.selectionGesture,
      selection = state.selection;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.selectionGesture = null;
    resetCanvasCursor();
    if (gesture.hit === "lasso") {
      if (selection && event.type !== "pointercancel") {
        const point = SELECT.clipPoint(clientPoint(event), SIZE);
        addLassoPoint(selection, point, 0.5 / state.scale);
      }
      const points = selection?.points || [];
      state.selection = null;
      if (event.type !== "pointercancel") captureSelection(points);
      else requestRender();
      return true;
    }
    if (selection) {
      selection.path = selectionPathFor(selection);
      selection.changed = selectionHasChanges(selection);
    }
    requestRender();
    return true;
  }
  function handleSelectionPointerDown(event, point) {
    const selection = state.selection;
    if (selection?.phase === "active") {
      if (selectionAIBusy(selection)) return true;
      const hit = selectionHit(selection, event);
      if (hit === "cancel") {
        cancelSelection();
        return true;
      }
      if (hit === "accept") {
        commitSelection();
        return true;
      }
      if (hit) {
        beginSelectionTransform(event, hit);
        return true;
      }
      commitSelection();
    } else if (selection) cancelSelection(true);
    beginSelectionLasso(event, point);
    return true;
  }
