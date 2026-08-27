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
    CLOUD_PROJECT_SESSION_KEY = "penecho-selected-cloud-project";
  let snapshotDbPromise = null,
    snapshotItems = [],
    snapshotSaveInProgress = false,
    snapshotListGeneration = 0,
    historyNoticeTimer = 0,
    historyActivityTimer = 0,
    snapshotListInProgress = false,
    snapshotLoadInProgress = false,
    snapshotLoadingId = null,
    snapshotItemsLocation = null,
    serverCanvasProjects = [],
    selectedServerProjectId = storedServerProjectId(),
    cloudCanvasProjects = [],
    selectedCloudProjectId = storedCloudProjectId(),
    cloudHistorySignInRequired = false,
    pendingCanvasTransition = null;
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
    renderSnapshotListLoading(location);
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
      panel = document.querySelector("#historyPanel");
    if (panel) panel.setAttribute("aria-busy", String(snapshotListInProgress || snapshotLoadInProgress));
    document.querySelectorAll('input[name="historyStorageLocation"]').forEach((control) => (control.disabled = snapshotSaveInProgress));
    document.querySelectorAll('#historyProjectSelect, #historyProjectCreate, #historyProjectDelete, #historyName, #historySaveCurrent, #historySave').forEach((control) => (control.disabled = busy || cloudBlocked));
    const topSave = document.querySelector("#saveCanvasBtn");
    if (topSave) topSave.disabled = snapshotSaveInProgress || cloudBlocked;
    document.querySelectorAll(".history-load, .history-delete, .history-move").forEach((control) => (control.disabled = busy));
    document.querySelectorAll(".history-card").forEach((card) => card.classList.toggle("loading", snapshotLoadInProgress && card.dataset.snapshotId === snapshotLoadingId));
    document.querySelectorAll(".history-load").forEach((button) => {
      const active = snapshotLoadInProgress && button.dataset.snapshotId === snapshotLoadingId;
      button.textContent = t(active ? "snapshotLoadingShort" : "loadSnapshot");
      if (active) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    });
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
    const overwriteId = state.currentSnapshotLocation === state.snapshotLocation ? state.currentSnapshotId : null,
      requestedName = document.querySelector("#historyName")?.value.trim(),
      name = requestedName || (overwriteId ? state.currentSnapshotName : "");
    setHistorySaveBusy(true);
    showHistoryNoticeKey("snapshotSaving", "busy", 0);
    try {
      const selectionBusy = selectionAIBusy(),
        selectionBusyKey = selectionAIStatusKey(),
        id = await saveSnapshot({ overwriteId, name, location:state.snapshotLocation });
      showHistoryNoticeKey(id ? (overwriteId ? "snapshotOverwritten" : "snapshotSaved") : selectionBusy ? selectionBusyKey : "emptyCanvas", id ? "success" : "info");
    } catch (error) {
      const message = `${t("snapshotError")}${error.message}`;
      setStatus(message);
      showHistoryNotice(message, "error", { duration:5000 });
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
  function canvasBlob(canvas, type = "image/png", quality) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(Error("Could not encode canvas"))), type, quality));
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
  function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      if (!(blob instanceof Blob)) return reject(Error("Snapshot contains invalid binary data"));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || Error("Could not encode snapshot data"));
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
      error.code = body?.code || null;
      throw error;
    }
    return body;
  }
  async function serverSnapshotItems() {
    const [canvasResponse, projectResponse] = await Promise.all([
        fetch("/api/canvases", { credentials:"same-origin", cache:"no-store", headers:authenticatedApiHeaders() }),
        fetch("/api/canvas-projects", { credentials:"same-origin", cache:"no-store", headers:authenticatedApiHeaders() }),
      ]),
      body = await snapshotApiResponse(canvasResponse),
      projectBody = projectResponse.ok ? await snapshotApiResponse(projectResponse) : null;
    serverCanvasProjects = Array.isArray(projectBody?.projects) ? projectBody.projects : [{ id:SERVER_DEFAULT_PROJECT_ID, name:"Uncategorized", system:true }];
    if (!serverCanvasProjects.some((project) => project.id === selectedServerProjectId) && selectedServerProjectId !== SERVER_ALL_PROJECTS_ID) rememberSelectedServerProject(SERVER_DEFAULT_PROJECT_ID);
    return Promise.all((Array.isArray(body?.canvases) ? body.canvases : []).map(async (item) => ({
      ...item,
      projectId:item.projectId || SERVER_DEFAULT_PROJECT_ID,
      preview:dataUrlBlob(item.preview),
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
    await prepareVisibleWidgetSnapshots(null, false, null, true);
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
    if (state.gridVisible) {
      const right = region.x + region.w,
        bottom = region.y + region.h;
      context.strokeStyle = state.paint.paperGrid;
      context.lineWidth = 1 / scale;
      context.beginPath();
      for (let x = Math.floor(region.x / 500) * 500; x <= right; x += 500) {
        context.moveTo(x, region.y);
        context.lineTo(x, bottom);
      }
      for (let y = Math.floor(region.y / 500) * 500; y <= bottom; y += 500) {
        context.moveTo(region.x, y);
        context.lineTo(right, y);
      }
      context.stroke();
    }
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
  function imageFromBlob(blob) {
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
  function releaseSnapshotTileCanvases(canvases) {
    for (const canvas of canvases.values()) canvas.width = canvas.height = 1;
    canvases.clear();
  }
  function waitForSnapshotTileFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  async function decodeSnapshotTilesInBatches(tileEntries, isCurrent, onProgress = null) {
    const decodedTiles = new Map();
    try {
      if (!tileEntries.length) onProgress?.(1);
      for (let start = 0; start < tileEntries.length; start += SNAPSHOT_TILE_DECODE_BATCH_SIZE) {
        const end = Math.min(tileEntries.length, start + SNAPSHOT_TILE_DECODE_BATCH_SIZE),
          batch = await Promise.all(tileEntries.slice(start, end).map(async ({ k, blob }) => ({ k, image:await imageFromBlob(blob) })));
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
          await waitForSnapshotTileFrame();
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
  async function decodeSnapshotImagesInBatches(items, isCurrent, onProgress = null) {
    const source = Array.isArray(items) ? items.slice(0, MAX_VISIBLE_IMAGES) : [], decoded = [];
    if (!source.length) {
      onProgress?.(1);
      return decoded;
    }
    for (let start = 0; start < source.length; start += SNAPSHOT_IMAGE_DECODE_BATCH_SIZE) {
      const end = Math.min(source.length, start + SNAPSHOT_IMAGE_DECODE_BATCH_SIZE),
        batch = (await Promise.all(source.slice(start, end).map(decodeStoredImage))).filter(Boolean);
      if (!isCurrent()) return null;
      decoded.push(...batch);
      onProgress?.(end / source.length);
      if (end < source.length) {
        await waitForSnapshotTileFrame();
        if (!isCurrent()) return null;
      }
    }
    return decoded;
  }
  async function finalizeCanvasForSnapshot() {
    if (state.pendingWidget) acceptPendingWidget({ restoreMode:false });
    if (state.pending) acceptPending({ restoreMode:false });
    if (state.widgetEdit) acceptWidgetEdit();
    if (state.imageEdit) acceptImageEdit();
    if (state.animationEdit) acceptAnimationEdit();
    for (const editor of [...state.textEditors.values()]) await confirmTextEditor(editor);
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
        bundleExtensions:snapshotExtensionObject(state.currentSnapshotBundleExtensions),
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
    if(!response.ok)throw Error(body.error||`AI auto-fill failed (HTTP ${response.status}).`);
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
      restoreAnimations(item.animations);
      restoreWidgets(item.widgets);
      applyTheme(item.theme);
      restoreImages(imageResult.value);
      await restoreTextBoxes(item.textBoxes);
      if (!loadIsCurrent()) throw Error("The read-only Canvas load was superseded.");

      // A viewer URL does not own a local snapshot. Preserve artifact extension
      // metadata for rendering, but keep the editable storage identity empty.
      state.currentSnapshotId = null;
      state.currentSnapshotName = String(item.name || "").slice(0, 160);
      state.currentSnapshotLocation = null;
      state.currentSnapshotProjectId = null;
      state.currentSnapshotRevisionId = null;
      state.currentSnapshotBundleExtensions = snapshotExtensionObject(item.bundleExtensions);
      state.currentSnapshotManifestExtensions = snapshotExtensionObject(item.manifestExtensions);
      state.currentSnapshotPreservedAssets = snapshotPreservedAssets(item.preservedAssets);
      state.dirty = null;
      state.snapshotSavedRevision = state.userRevision;
      setCanvasNavigationLocked(false);
      closeHistoryPanel();
      fitViewerCanvas();
      render();
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
  async function saveSnapshot({ overwriteId = null, name = null, location = state.snapshotLocation } = {}) {
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return null;
    }
    if (!SNAPSHOT_LOCATIONS.has(location)) throw Error("Invalid snapshot location");
    if (overwriteId && state.currentSnapshotLocation !== location) throw Error(t("noCurrentSnapshot"));
    await finalizeCanvasForSnapshot();
    if (!tiles.size && !state.images.length && !state.textBoxes.length && !state.preservedSnapshotAnimations.length && (!pluginEnabled("animation") || !state.animations.length) && !visibleWidgets().length) {
      setStatusKey("emptyCanvas");
      return null;
    }
    await prepareVisibleWidgetSnapshots(null, false);
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
      requestedName = String(name === null ? nameInput.value : name).trim().slice(0, 48),
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
        view: { scale: state.scale, panX: state.panX, panY: state.panY, navigationLocked:state.navigationLocked },
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
        bundleExtensions:snapshotExtensionObject(state.currentSnapshotBundleExtensions),
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
    state.currentSnapshotLocation = location;
    state.currentSnapshotProjectId = item.projectId;
    state.currentSnapshotRevisionId = storedRevisionId;
    state.currentSnapshotBundleExtensions = snapshotExtensionObject(item.bundleExtensions);
    state.currentSnapshotManifestExtensions = snapshotExtensionObject(item.manifestExtensions);
    state.currentSnapshotPreservedAssets = snapshotPreservedAssets(item.preservedAssets);
    state.snapshotSavedRevision = savedUserRevision;
    canvasAgentCanvasDidPersist(location, storedId);
    await refreshSnapshots();
    setStatusKey(overwriteId ? "snapshotOverwritten" : "snapshotSaved");
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
      restoreAnimations(item.animations);
      restoreWidgets(item.widgets);
      applyTheme(item.theme);
      restoreImages(images);
      await restoreTextBoxes(item.textBoxes);
      if (item.view) {
        state.scale = Math.max(0.03, Math.min(2, item.view.scale));
        state.panX = item.view.panX;
        state.panY = item.view.panY;
        updateCoordinates();
      }
      setCanvasNavigationLocked(item.view?.navigationLocked === true);
      state.currentSnapshotId = item.id;
      state.currentSnapshotName = snapshotName(item);
      state.currentSnapshotLocation = location;
      state.currentSnapshotProjectId = item.projectId || null;
      state.currentSnapshotRevisionId = location === "cloud" ? item.currentRevisionId || null : null;
      state.currentSnapshotBundleExtensions = snapshotExtensionObject(item.bundleExtensions);
      state.currentSnapshotManifestExtensions = snapshotExtensionObject(item.manifestExtensions);
      state.currentSnapshotPreservedAssets = snapshotPreservedAssets(item.preservedAssets);
      state.snapshotSavedRevision = state.userRevision;
      canvasAgentCanvasDidChange({ id:item.id, location },{clearProject:true});
      setHistoryActivity(t("snapshotLoading").replace("{name}", displayName), t("snapshotLoadApplying"), 100);
      render();
      closeHistoryPanel();
      setStatusKey("snapshotLoaded");
      return true;
    } catch (error) {
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
    if (!confirm(t(location === "server" ? "deleteSnapshotConfirmServer" : location === "cloud" ? "deleteSnapshotConfirmCloud" : "deleteSnapshotConfirmDevice"))) return;
    if (location === "server") await deleteServerSnapshot(id);
    else if (location === "cloud") await deleteCloudSnapshot(id);
    else await deleteDeviceSnapshot(id);
    if (state.currentSnapshotId === id && state.currentSnapshotLocation === location) {
      state.currentSnapshotId = null;
      state.currentSnapshotName = "";
      state.currentSnapshotLocation = null;
      state.currentSnapshotProjectId = null;
      state.currentSnapshotRevisionId = null;
      state.currentSnapshotBundleExtensions = {};
      state.currentSnapshotManifestExtensions = {};
      state.currentSnapshotPreservedAssets = [];
    }
    await refreshSnapshots();
    setStatusKey("snapshotDeleted");
  }
  function updateNewCanvasDialog() {
    const label = document.querySelector("#currentSnapshotLabel"),
      overwrite = document.querySelector("#newOverwrite"),
      title = document.querySelector("#newCanvasTitle"),
      description = document.querySelector("#newCanvasDialog > form > p:not(.current-snapshot)"),
      discard = document.querySelector("#newDiscard"),
      saveCopy = document.querySelector("#newSaveCopy"),
      loading = Boolean(pendingCanvasTransition),
      cloudBlocked = state.snapshotLocation === "cloud" && cloudHistorySignInRequired;
    if (!label || !overwrite) return;
    if (title) title.textContent = t(loading ? "loadCanvasTitle" : "newCanvasTitle");
    if (description) description.textContent = t(loading ? "loadCanvasDescription" : "newCanvasDescription");
    if (discard) discard.textContent = t(loading ? "loadWithoutSave" : "newWithoutSave");
    if (saveCopy) saveCopy.textContent = t(loading ? "saveAsNewAndLoad" : "saveAsNewAndCreate");
    overwrite.textContent = t(loading ? "overwriteAndLoad" : "overwriteAndCreate");
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
    state.currentSnapshotLocation = null;
    state.currentSnapshotProjectId = null;
    state.currentSnapshotRevisionId = null;
    state.currentSnapshotBundleExtensions = {};
    state.currentSnapshotManifestExtensions = {};
    state.currentSnapshotPreservedAssets = [];
    canvasAgentCanvasDidChange(null,{clearProject:true});
    state.viewInitialized = false;
    state.aiDraftReturnMode = null;
    state.pendingHistoryRestored = false;
    setCanvasNavigationLocked(false);
    setCanvasMode("pen", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
    state.snapshotSavedRevision = state.userRevision;
    pendingCanvasTransition = null;
    document.querySelector("#newSnapshotName").value = "";
    if (dialog.open) dialog.close();
    if (document.querySelector("#historyPanel").classList.contains("open")) closeHistoryPanel();
    fit();
    setStatusKey("newCanvasReady");
  }
  function openNewCanvasDialog() {
    if (!canvasHasUnsavedChanges()) {
      startBlankCanvas();
      return;
    }
    pendingCanvasTransition = null;
    const dialog = document.querySelector("#newCanvasDialog");
    document.querySelector("#newSnapshotName").value = "";
    setNewCanvasDialogBusy(false);
    updateNewCanvasDialog();
    if (!dialog.open) dialog.showModal();
  }
  async function completeNewCanvas(saveMode) {
    const name = document.querySelector("#newSnapshotName").value;
    setNewCanvasDialogBusy(true);
    try {
      let saved = true;
      if (saveMode === "new") saved = await saveSnapshot({ name, location:state.snapshotLocation });
      else if (saveMode === "overwrite") saved = await saveSnapshot({ overwriteId:state.currentSnapshotId, name, location:state.snapshotLocation });
      if (saved === null) {
        setNewCanvasDialogBusy(false);
        return;
      }
      const transition = pendingCanvasTransition;
      pendingCanvasTransition = null;
      if (transition) {
        const dialog = document.querySelector("#newCanvasDialog");
        if (dialog.open) dialog.close();
        await loadSnapshot(transition.id, transition.location);
      } else startBlankCanvas();
    } catch (error) {
      setStatus(`${t("snapshotError")}${error.message}`);
      setNewCanvasDialogBusy(false);
    }
  }
  function canvasHasUnsavedChanges() {
    const hasContent = tiles.size || state.images.length || state.textBoxes.length || state.preservedSnapshotAnimations.length || (pluginEnabled("animation") && state.animations.length) || visibleWidgets().length;
    return Boolean(hasContent && (state.dirty || state.userRevision !== state.snapshotSavedRevision));
  }
  function confirmExternalCanvasOpen() {
    return !canvasHasUnsavedChanges() || window.confirm(cloudHistoryCopy("confirmExternalOpen"));
  }
  function requestLoadSnapshot(id, location = state.snapshotLocation) {
    if (!canvasHasUnsavedChanges()) return loadSnapshot(id, location);
    pendingCanvasTransition = { id, location };
    const dialog = document.querySelector("#newCanvasDialog");
    document.querySelector("#newSnapshotName").value = "";
    setNewCanvasDialogBusy(false);
    updateNewCanvasDialog();
    if (!dialog.open) dialog.showModal();
    return Promise.resolve(false);
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
    if (!transition) return startBlankCanvas();
    const dialog = document.querySelector("#newCanvasDialog");
    if (dialog.open) dialog.close();
    return loadSnapshot(transition.id, transition.location);
  }
  function snapshotName(item) {
    return item.name || new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt);
  }
  function renderSnapshotListLoading(location = state.snapshotLocation) {
    const list = document.querySelector("#historyList");
    if (!list) return;
    const loading = document.createElement("div");
    loading.className = "history-list-loading";
    loading.setAttribute("role", "status");
    loading.textContent = t("snapshotLibraryLoading").replace("{location}", snapshotLocationLabel(location));
    list.replaceChildren(loading);
  }
  function renderSnapshotListError(location = state.snapshotLocation) {
    const list = document.querySelector("#historyList");
    if (!list) return;
    const error = document.createElement("div");
    error.className = "history-list-loading error";
    error.setAttribute("role", "alert");
    error.textContent = t("snapshotLibraryLoadFailed").replace("{location}", snapshotLocationLabel(location));
    list.replaceChildren(error);
  }
  function renderCloudHistorySignIn() {
    const list = document.querySelector("#historyList");
    if (!list) return;
    const empty = document.createElement("div"), title = document.createElement("strong"),
      description = document.createElement("p"), action = document.createElement("button");
    empty.className = "history-cloud-auth";
    title.textContent = cloudHistoryCopy("title");
    description.textContent = cloudHistoryCopy("description");
    action.type = "button";
    action.textContent = cloudHistoryCopy("action");
    action.onclick = () => {
      closeHistoryPanel();
      document.querySelector("#cloudAccountBtn")?.click();
    };
    empty.append(title, description, action);
    list.replaceChildren(empty);
  }
  function serverProjectName(project) {
    return project?.id === SERVER_DEFAULT_PROJECT_ID || project?.system || project?.systemKey === "uncategorized" ? t("canvasProjectUncategorized") : project?.name || t("canvasProjectUncategorized");
  }
  function renderServerProjectUi() {
    const manager = document.querySelector("#serverProjectManager"),
      select = document.querySelector("#historyProjectSelect"),
      remove = document.querySelector("#historyProjectDelete"),
      dialogField = document.querySelector("#newCanvasProjectField"),
      dialogSelect = document.querySelector("#newCanvasProjectSelect");
    if (!manager || !select || !remove) return;
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
    all.textContent = t("canvasProjectAll");
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
    const selected = projects.find((project) => project.id === select.value);
    remove.disabled = isCloud && cloudHistorySignInRequired || !selected || selected.id === SERVER_DEFAULT_PROJECT_ID || selected.system === true || selected.systemKey === "uncategorized";
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
  async function deleteSelectedServerProject() {
    const isCloud = state.snapshotLocation === "cloud",
      projects = isCloud ? cloudCanvasProjects : serverCanvasProjects,
      selectedProjectId = isCloud ? selectedCloudProjectId : selectedServerProjectId,
      project = projects.find((item) => item.id === selectedProjectId);
    if (!project || project.id === SERVER_DEFAULT_PROJECT_ID || project.system || project.systemKey === "uncategorized") return;
    if (isCloud && !confirm(t("deleteCloudProjectConfirm").replace("{name}", project.name || t("canvasProjectUncategorized")))) return;
    const response = await fetch(isCloud ? `/api/cloud/projects/${encodeURIComponent(project.id)}` : `/api/canvas-projects/${encodeURIComponent(project.id)}`, {
      method:"DELETE",
      credentials:"same-origin",
      headers:authenticatedApiHeaders(),
    });
    await snapshotApiResponse(response);
    if (isCloud) rememberSelectedCloudProject(CLOUD_ALL_PROJECTS_ID);
    else rememberSelectedServerProject(SERVER_DEFAULT_PROJECT_ID);
    await refreshSnapshots();
    showHistoryNoticeKey("canvasProjectDeleted", "success", 4200);
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
  function renderSnapshotList() {
    const list = document.querySelector("#historyList"),
      location = state.snapshotLocation,
      items = location === "server" && selectedServerProjectId !== SERVER_ALL_PROJECTS_ID
        ? snapshotItems.filter((item) => (item.projectId || SERVER_DEFAULT_PROJECT_ID) === selectedServerProjectId)
        : location === "cloud" && selectedCloudProjectId !== CLOUD_ALL_PROJECTS_ID
          ? snapshotItems.filter((item) => item.projectId === selectedCloudProjectId)
        : snapshotItems;
    if (!list) return;
    renderServerProjectUi();
    if (location === "cloud" && cloudHistorySignInRequired) {
      renderCloudHistorySignIn();
      updateHistoryReadControls();
      return;
    }
    if (snapshotListInProgress && snapshotItemsLocation !== location) {
      renderSnapshotListLoading(location);
      return;
    }
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = t((location === "server" || location === "cloud") && snapshotItems.length ? "emptyProjectHistory" : location === "server" ? "emptyServerHistory" : location === "cloud" ? "emptyCloudHistory" : "emptyDeviceHistory");
      list.append(empty);
      return;
    }
    for (const item of items) {
      const card = document.createElement("article"),
        preview = document.createElement("div"),
        image = document.createElement("img"),
        meta = document.createElement("div"),
        title = document.createElement("strong"),
        detail = document.createElement("small"),
        actions = document.createElement("div"),
        load = document.createElement("button"),
        remove = document.createElement("button"),
        url = item.preview instanceof Blob ? URL.createObjectURL(item.preview) : "";
      card.className = "history-card";
      card.dataset.snapshotId = item.id;
      const isCurrent = item.id === state.currentSnapshotId && location === state.currentSnapshotLocation;
      card.classList.toggle("current", isCurrent);
      if (isCurrent) card.setAttribute("aria-current", "true");
      preview.className = "history-preview";
      image.alt = "";
      if (url) {
        image.src = url;
        image.onload = image.onerror = () => URL.revokeObjectURL(url);
      }
      preview.append(image);
      meta.className = "history-meta";
      title.textContent = snapshotName(item);
      const modified = new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en", { dateStyle: "short", timeStyle: "short" }).format(item.updatedAt || item.createdAt);
      detail.textContent = t("snapshotModified").replace("{time}", modified);
      const stats = document.createElement("div"),
        counts = Number.isFinite(item.tileCount) ? [[item.tileCount, "snapshotTiles"]] : [];
      if (pluginEnabled("animation") && item.animationCount) counts.push([item.animationCount, "snapshotAnimations"]);
      if (item.widgetCount) counts.push([item.widgetCount, "snapshotWidgets"]);
      if (item.imageCount) counts.push([item.imageCount, "snapshotImages"]);
      stats.className = "history-stats";
      for (const [count, key] of counts) {
        const chip = document.createElement("span");
        chip.className = "history-stat";
        chip.textContent = `${count} ${t(key)}`;
        stats.append(chip);
      }
      actions.className = "history-actions";
      load.className = "history-load";
      load.dataset.snapshotId = item.id;
      load.textContent = t("loadSnapshot");
      load.onclick = () => runSnapshotLoadAction(load, () => requestLoadSnapshot(item.id, location));
      remove.className = "history-delete";
      remove.textContent = t("deleteSnapshot");
      remove.onclick = () => runSnapshotAction(() => deleteSnapshot(item.id, location));
      actions.append(load, remove);
      meta.append(title, detail, stats, actions);
      if (location === "server" || location === "cloud") {
        const move = document.createElement("select");
        move.className = "history-move";
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
        meta.append(move);
      }
      card.append(preview, meta);
      list.append(card);
    }
  }
  async function refreshSnapshots() {
    const generation = ++snapshotListGeneration,
      location = state.snapshotLocation,
      replacingLocation = snapshotItemsLocation !== location;
    snapshotListInProgress = true;
    if (replacingLocation) {
      snapshotItems = [];
      snapshotItemsLocation = null;
      renderSnapshotListLoading(location);
    }
    setHistoryActivity(
      t("snapshotLibraryLoading").replace("{location}", snapshotLocationLabel(location)),
      t("snapshotLibraryLoadingDetail"),
      null,
    );
    updateHistoryReadControls();
    let authenticationRequired = false;
    try {
      const items = await snapshotsAt(location);
      if (generation !== snapshotListGeneration || location !== state.snapshotLocation) return false;
      if (location === "cloud") cloudHistorySignInRequired = false;
      snapshotItems = items;
      snapshotItemsLocation = location;
      renderSnapshotList();
      hideHistoryActivity(260);
      return true;
    } catch (error) {
      if (generation === snapshotListGeneration && location === state.snapshotLocation) {
        authenticationRequired = location === "cloud" && cloudHistoryRequiresSignIn(error);
        if (location === "cloud") cloudHistorySignInRequired = authenticationRequired;
        if (authenticationRequired) {
          snapshotItems = [];
          snapshotItemsLocation = null;
          cloudCanvasProjects = [];
          renderCloudHistorySignIn();
        } else if (replacingLocation) {
          snapshotItems = [];
          snapshotItemsLocation = null;
          renderSnapshotListError(location);
        }
        if (!authenticationRequired) {
          setHistoryActivity(
            t("snapshotLibraryLoading").replace("{location}", snapshotLocationLabel(location)),
            t("snapshotLibraryLoadFailed").replace("{location}", snapshotLocationLabel(location)),
            null,
            "error",
          );
        }
      }
      if (authenticationRequired) return false;
      throw error;
    } finally {
      if (generation === snapshotListGeneration) {
        snapshotListInProgress = false;
        if (authenticationRequired) hideHistoryActivity();
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
    backdrop.hidden = false;
    panel.inert = false;
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-expanded", "true");
    updateSnapshotLocationUi();
    if (refresh) refreshSnapshots().catch((error) => {
      if (state.snapshotLocation !== "cloud" || !cloudHistoryRequiresSignIn(error)) setStatus(`${t("snapshotError")}${error.message}`);
    });
  }
  function closeHistoryPanel() {
    const panel = document.querySelector("#historyPanel"),
      backdrop = document.querySelector("#historyBackdrop"),
      button = document.querySelector("#historyBtn");
    if (panel.contains(document.activeElement)) button.focus({ preventScroll:true });
    panel.inert = true;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
    setTimeout(() => {
      if (!panel.classList.contains("open")) backdrop.hidden = true;
    }, 220);
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
  function stroke(a, b, erase = false, size = state.pen, userChange = false) {
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
        q.strokeStyle = state.inkColor;
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
          extendInkBounds(k, local);
        }
      }
    if (userChange && !erase) {
      mergeDirty(a.x, a.y, pad);
      mergeDirty(b.x, b.y, pad);
    }
  }
  function dot(p, erase = false, size = state.pen, userChange = false) {
    stroke(p, { x: p.x + 0.01, y: p.y + 0.01 }, erase, size, userChange);
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
    save();
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
      if (returnMode && state.mode === "hand") setCanvasMode(returnMode, { preserveSelection:true, skipDraftFinalize:true });
      return;
    }
    const snapshot = side === "before" ? entry.pendingBefore : entry.pendingAfter;
    if (!snapshot) {
      const mode = entry.aiDraftReturnMode;
      if (mode && state.mode === "hand") setCanvasMode(mode, { preserveSelection:true, skipDraftFinalize:true });
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
      setCanvasMode("hand", { preserveSelection:true, skipDraftFinalize:true });
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
    return entry;
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
    save();
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
    const viewport = view.getBoundingClientRect(),
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
      maxX = Math.max(8, viewport.width - width - 8),
      x = Math.max(8, Math.min(maxX, left + (box.w * state.scale - width) / 2)),
      preferredY = top - height - 8,
      y = preferredY >= 8 ? preferredY : bottom + 8,
      maxY = Math.max(8, viewport.height - height - 8);
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
    save();
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
