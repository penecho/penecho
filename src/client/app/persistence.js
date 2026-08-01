// Canvas snapshots, export, drawing history, strokes, and lasso selection.
  const SNAPSHOT_DB = "penecho-canvas-history",
    SNAPSHOT_STORE = "snapshots",
    SNAPSHOT_TILE_STORE = "snapshot-tiles",
    SNAPSHOT_LOCATIONS = new Set(["device", "server"]);
  let snapshotDbPromise = null,
    snapshotItems = [],
    snapshotSaveInProgress = false,
    snapshotListGeneration = 0,
    historyNoticeTimer = 0;
  function snapshotLocationLabel(location = state.snapshotLocation) {
    return t(location === "server" ? "storagePenEchoServer" : "storageThisDevice");
  }
  function updateSnapshotLocationUi() {
    const location = SNAPSHOT_LOCATIONS.has(state.snapshotLocation) ? state.snapshotLocation : "device",
      descriptionKey = location === "server" ? "storagePenEchoServerDescription" : "storageThisDeviceDescription";
    document.querySelectorAll('input[name="historyStorageLocation"], input[name="newCanvasStorageLocation"]').forEach((input) => {
      input.checked = input.value === location;
    });
    for (const id of ["historyStorageDescription", "newCanvasStorageDescription"]) {
      const description = document.querySelector(`#${id}`);
      if (description) description.textContent = t(descriptionKey);
    }
  }
  function setSnapshotLocation(location) {
    if (!SNAPSHOT_LOCATIONS.has(location) || state.snapshotLocation === location) {
      updateSnapshotLocationUi();
      return;
    }
    state.snapshotLocation = location;
    localStorage.setItem("penecho-snapshot-location", location);
    updateSnapshotLocationUi();
    updateNewCanvasDialog();
    refreshSnapshots().catch((error) => setStatus(`${t("snapshotError")}${error.message}`));
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
    document.querySelectorAll('input[name="historyStorageLocation"]').forEach((input) => (input.disabled = busy));
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
    return items.sort((a, b) => b.createdAt - a.createdAt);
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
      return await canvasBlob(snapshotPreview());
    } catch (error) {
      console.warn("PenEcho snapshot thumbnail failed; saving with a fallback thumbnail:", error);
      return dataUrlBlob("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
    }
  }
  async function snapshotApiResponse(response) {
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) throw Error(body?.error || `PenEcho server returned HTTP ${response.status}`);
    return body;
  }
  async function serverSnapshotItems() {
    const response = await fetch("/api/canvases", {
        credentials:"same-origin",
        cache:"no-store",
        headers:authenticatedApiHeaders(),
      }),
      body = await snapshotApiResponse(response);
    return Promise.all((Array.isArray(body?.canvases) ? body.canvases : []).map(async (item) => ({
      ...item,
      preview:dataUrlBlob(item.preview),
    })));
  }
  async function snapshotsAt(location) {
    return location === "server" ? serverSnapshotItems() : allSnapshots();
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
  function snapshotPreview() {
    const preview = offscreen(180, 120),
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
    drawAnimationsToContext(q, bounds, captureTime);
    drawWidgetsToContext(q, bounds);
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
    await snapshotVisibleWidgets();
    const region = exportRegion();
    if (!region) return null;
    const scale = Math.min(1, EXPORT_MAX_DIMENSION / region.w, EXPORT_MAX_DIMENSION / region.h, Math.sqrt(EXPORT_MAX_PIXELS / (region.w * region.h))),
      canvas = offscreen(Math.max(1, Math.ceil(region.w * scale)), Math.max(1, Math.ceil(region.h * scale))),
      context = canvas.getContext("2d");
    const captureTime = performance.now();
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
    drawImagesToContext(context, region);
    drawTextBoxesToContext(context, region);
    for (const [tileKey, tileCanvas] of tiles) {
      const [tx, ty] = tileKey.split(",").map(Number),
        x = tx * TILE,
        y = ty * TILE;
      if (intersection({ x, y, w: TILE, h: TILE }, region)) context.drawImage(tileCanvas, x, y);
    }
    drawSharpOverlays(context, region);
    drawAnimationsToContext(context, region, captureTime);
    drawWidgetsToContext(context, region);
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
    const button = document.querySelector("#exportPngBtn");
    if (button.disabled) return;
    button.disabled = true;
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
      button.disabled = false;
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
  async function serverSnapshotPayload(item, tileEntries) {
    const [preview, serverTiles, serverImages] = await Promise.all([
      blobDataUrl(item.preview),
      Promise.all(tileEntries.map(async ({ k, blob }) => ({ k, data:await blobDataUrl(blob) }))),
      Promise.all(item.images.map(async ({ blob, ...image }) => ({ ...image, data:await blobDataUrl(blob) }))),
    ]);
    return {
      version:1,
      id:item.id,
      createdAt:item.createdAt,
      name:item.name,
      theme:item.theme,
      view:item.view,
      animations:item.animations,
      widgets:item.widgets,
      textBoxes:item.textBoxes,
      images:serverImages,
      tiles:serverTiles,
      preview,
    };
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
  async function saveSnapshot({ overwriteId = null, name = null, location = state.snapshotLocation } = {}) {
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return null;
    }
    if (!SNAPSHOT_LOCATIONS.has(location)) throw Error("Invalid snapshot location");
    if (overwriteId && state.currentSnapshotLocation !== location) throw Error(t("noCurrentSnapshot"));
    await finalizeCanvasForSnapshot();
    if (!tiles.size && !state.images.length && !state.textBoxes.length && (!pluginEnabled("animation") || !state.animations.length) && !visibleWidgets().length) {
      setStatusKey("emptyCanvas");
      return null;
    }
    await snapshotVisibleWidgets({ bestEffort:true });
    const nameInput = document.querySelector("#historyName"),
      existing = overwriteId ? snapshotItems.find((item) => item.id === overwriteId) : null,
      id = overwriteId || `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
      createdAt = Date.now(),
      animations = serializedAnimations(),
      widgets = serializedWidgets(),
      textBoxes = storedTextBoxes(),
      images = storedImages(),
      tileEntries = await Promise.all([...tiles].map(async ([k, canvas]) => ({ k, blob: await canvasBlob(canvas) }))),
      preview = await snapshotPreviewBlob(),
      requestedName = String(name === null ? nameInput.value : name).trim().slice(0, 48),
      item = {
        id,
        createdAt,
        name: requestedName || (overwriteId ? (existing ? existing.name : state.currentSnapshotName) : ""),
        theme: state.theme,
        view: { scale: state.scale, panX: state.panX, panY: state.panY },
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
      };
    if (overwriteId && !existing && overwriteId !== state.currentSnapshotId) throw Error(t("noCurrentSnapshot"));
    if (location === "server") await saveServerSnapshot(item, tileEntries, overwriteId);
    else await saveDeviceSnapshot(item, tileEntries, overwriteId);
    nameInput.value = "";
    state.currentSnapshotId = id;
    state.currentSnapshotName = snapshotName(item);
    state.currentSnapshotLocation = location;
    await refreshSnapshots();
    setStatusKey(overwriteId ? "snapshotOverwritten" : "snapshotSaved");
    return id;
  }
  async function readDeviceSnapshot(id) {
    const db = await snapshotDb(),
      transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readonly"),
      itemRequest = transaction.objectStore(SNAPSHOT_STORE).get(id),
      tilesRequest = transaction.objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAll(id),
      [item, tileEntries] = await Promise.all([requestResult(itemRequest), requestResult(tilesRequest)]);
    return item ? { item, tileEntries } : null;
  }
  async function readServerSnapshot(id) {
    const response = await fetch(`/api/canvases/${encodeURIComponent(id)}`, {
        credentials:"same-origin",
        cache:"no-store",
        headers:authenticatedApiHeaders(),
      }),
      body = await snapshotApiResponse(response),
      stored = body?.canvas;
    if (!stored || !Array.isArray(stored.tiles) || !Array.isArray(stored.images)) throw Error("PenEcho server returned an invalid canvas");
    return {
      item:{
        ...stored,
        preview:dataUrlBlob(stored.preview),
        images:stored.images.map(({ data, ...image }) => ({ ...image, blob:dataUrlBlob(data) })),
      },
      tileEntries:stored.tiles.map(({ k, data }) => ({ k, blob:dataUrlBlob(data) })),
    };
  }
  async function readSnapshot(location, id) {
    return location === "server" ? readServerSnapshot(id) : readDeviceSnapshot(id);
  }
  async function loadSnapshot(id, location = state.snapshotLocation) {
    const loadGeneration=++state.snapshotLoadGeneration;
    if (state.selection) cancelSelection(true);
    clearTextEditors();
    state.userRevision++;
    invalidateRecognition();
    cancelPendingForRevision();
    const expectedRevision=state.userRevision,
      stored = await readSnapshot(location, id);
    if (!stored) return;
    const { item, tileEntries } = stored;
    const [decoded, images] = await Promise.all([
      Promise.all(tileEntries.map(async ({ k, blob }) => ({ k, image: await imageFromBlob(blob) }))),
      decodeStoredImages(item.images),
    ]);
    if(loadGeneration!==state.snapshotLoadGeneration||state.userRevision!==expectedRevision)return;
    await enableSnapshotWidgetPlugins(item.widgets);
    if(loadGeneration!==state.snapshotLoadGeneration||state.userRevision!==expectedRevision)return;
    state.userRevision++;
    invalidateRecognition();
    cancelPendingForRevision();
    clearTextEditors();
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
    for (const { k, image } of decoded) {
      const canvas = offscreen(TILE, TILE);
      canvas.getContext("2d").drawImage(image, 0, 0);
      tiles.set(k, canvas);
    }
    restoreAnimations(item.animations);
    restoreWidgets(item.widgets);
    if (["arcane", "scifi", "research", "studio"].includes(item.theme)) applyTheme(item.theme);
    restoreImages(images);
    await restoreTextBoxes(item.textBoxes);
    if (item.view) {
      state.scale = Math.max(0.03, Math.min(2, item.view.scale));
      state.panX = item.view.panX;
      state.panY = item.view.panY;
      updateCoordinates();
    }
    state.currentSnapshotId = item.id;
    state.currentSnapshotName = snapshotName(item);
    state.currentSnapshotLocation = location;
    render();
    closeHistoryPanel();
    setStatusKey("snapshotLoaded");
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
  async function deleteSnapshot(id, location = state.snapshotLocation) {
    if (!confirm(t(location === "server" ? "deleteSnapshotConfirmServer" : "deleteSnapshotConfirmDevice"))) return;
    if (location === "server") await deleteServerSnapshot(id);
    else await deleteDeviceSnapshot(id);
    if (state.currentSnapshotId === id && state.currentSnapshotLocation === location) {
      state.currentSnapshotId = null;
      state.currentSnapshotName = "";
      state.currentSnapshotLocation = null;
    }
    await refreshSnapshots();
    setStatusKey("snapshotDeleted");
  }
  function updateNewCanvasDialog() {
    const label = document.querySelector("#currentSnapshotLabel"),
      overwrite = document.querySelector("#newOverwrite");
    if (!label || !overwrite) return;
    if (!state.currentSnapshotId) label.textContent = t("noCurrentSnapshot");
    else {
      const sameLocation = state.currentSnapshotLocation === state.snapshotLocation,
        key = sameLocation ? "currentSnapshot" : "currentSnapshotOtherLocation";
      label.textContent = t(key)
        .replace("{name}", state.currentSnapshotName || state.currentSnapshotId)
        .replace("{location}", snapshotLocationLabel(state.currentSnapshotLocation));
    }
    overwrite.disabled = !state.currentSnapshotId || state.currentSnapshotLocation !== state.snapshotLocation;
    updateSnapshotLocationUi();
  }
  function setNewCanvasDialogBusy(busy) {
    const dialog = document.querySelector("#newCanvasDialog");
    dialog.dataset.busy = String(busy);
    dialog.querySelectorAll("button, input").forEach((control) => (control.disabled = busy));
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
    state.viewInitialized = false;
    state.aiDraftReturnMode = null;
    state.pendingHistoryRestored = false;
    setCanvasMode("pen", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
    document.querySelector("#newSnapshotName").value = "";
    if (dialog.open) dialog.close();
    if (document.querySelector("#historyPanel").classList.contains("open")) closeHistoryPanel();
    fit();
    setStatusKey("newCanvasReady");
  }
  function openNewCanvasDialog() {
    if (!tiles.size && !state.images.length && !state.textBoxes.length && (!pluginEnabled("animation") || !state.animations.length) && !visibleWidgets().length) {
      startBlankCanvas();
      return;
    }
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
      startBlankCanvas();
    } catch (error) {
      setStatus(`${t("snapshotError")}${error.message}`);
      setNewCanvasDialogBusy(false);
    }
  }
  function snapshotName(item) {
    return item.name || new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt);
  }
  function renderSnapshotList() {
    const list = document.querySelector("#historyList"),
      location = state.snapshotLocation;
    if (!list) return;
    list.replaceChildren();
    if (!snapshotItems.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = t(state.snapshotLocation === "server" ? "emptyServerHistory" : "emptyDeviceHistory");
      list.append(empty);
      return;
    }
    for (const item of snapshotItems) {
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
      detail.textContent = `${new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en", { dateStyle: "short", timeStyle: "short" }).format(item.createdAt)} · ${item.tileCount} ${t("snapshotTiles")}`;
      if (pluginEnabled("animation") && item.animationCount) detail.textContent += " · " + item.animationCount + " " + t("snapshotAnimations");
      if (item.widgetCount) detail.textContent += " · " + item.widgetCount + " " + t("snapshotWidgets");
      if (item.imageCount) detail.textContent += " · " + item.imageCount + " " + t("snapshotImages");
      actions.className = "history-actions";
      load.textContent = t("loadSnapshot");
      load.onclick = () => runSnapshotAction(() => loadSnapshot(item.id, location));
      remove.className = "history-delete";
      remove.textContent = t("deleteSnapshot");
      remove.onclick = () => runSnapshotAction(() => deleteSnapshot(item.id, location));
      actions.append(load, remove);
      meta.append(title, detail, actions);
      card.append(preview, meta);
      list.append(card);
    }
  }
  async function refreshSnapshots() {
    const generation = ++snapshotListGeneration,
      location = state.snapshotLocation,
      items = await snapshotsAt(location);
    if (generation !== snapshotListGeneration || location !== state.snapshotLocation) return;
    snapshotItems = items;
    renderSnapshotList();
  }
  async function runSnapshotAction(action) {
    try {
      await action();
    } catch (error) {
      setStatus(`${t("snapshotError")}${error.message}`);
    }
  }
  function openHistoryPanel() {
    const panel = document.querySelector("#historyPanel"),
      backdrop = document.querySelector("#historyBackdrop"),
      button = document.querySelector("#historyBtn");
    backdrop.hidden = false;
    panel.inert = false;
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-expanded", "true");
    updateSnapshotLocationUi();
    refreshSnapshots().catch((error) => setStatus(`${t("snapshotError")}${error.message}`));
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
      h = Math.abs(a.y - b.y) + pad * 2;
    invalidateSharpOverlays({ x, y, w, h });
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
    if (userChange) {
      mergeDirty(a.x, a.y, pad);
      mergeDirty(b.x, b.y, pad);
    }
  }
  function dot(p, erase = false, size = state.pen, userChange = false) {
    stroke(p, { x: p.x + 0.01, y: p.y + 0.01 }, erase, size, userChange);
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
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      ctx.drawImage(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
    }
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
