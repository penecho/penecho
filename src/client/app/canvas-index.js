  // ---------- Canvas index and search by text or sketch ----------
  //
  // Every region of every Canvas gets a label: what it is (formula, circuit,
  // wireframe, to-do…), its subject, a small thumbnail and a 12×12 sketch
  // signature. Labels come from three places:
  //   • Assist's PenEchoLLM classification of new ink (free: already computed);
  //   • widgets, typed text and images on the Canvas (local, no model call);
  //   • "Scan this Canvas", which asks PenEchoLLM (index mode) about older ink.
  // The index lives in this browser (IndexedDB) and spans all Canvases.
  const CANVAS_INDEX_DB = "penecho-canvas-index",
    CANVAS_INDEX_STORE = "entries",
    CANVAS_INDEX_LIMIT = 800,
    CANVAS_INDEX_SCAN_LIMIT = 24,
    CANVAS_INDEX_THUMB = 112,
    canvasIndex = { entries:null, loading:null, dirty:new Set(), removed:new Set(), timer:0, panel:null, scanning:null, sketchVector:null, sketchAnswers:null, highlight:null };

  function canvasIndexDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CANVAS_INDEX_DB, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(CANVAS_INDEX_STORE)) request.result.createObjectStore(CANVAS_INDEX_STORE, { keyPath:"id" }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("Canvas index storage is unavailable."));
    });
  }
  async function canvasIndexLoad() {
    if (canvasIndex.entries) return canvasIndex.entries;
    canvasIndex.loading ||= (async () => {
      try {
        const db = await canvasIndexDb();
        const all = await new Promise((resolve, reject) => {
          const request = db.transaction(CANVAS_INDEX_STORE, "readonly").objectStore(CANVAS_INDEX_STORE).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
        db.close();
        canvasIndex.entries = all.filter(entry => entry?.id && entry.box).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, CANVAS_INDEX_LIMIT);
      } catch (error) {
        debug("canvas-index-unavailable", { error:String(error?.message || error).slice(0, 160) });
        canvasIndex.entries = [];
      }
      return canvasIndex.entries;
    })();
    return canvasIndex.loading;
  }
  function canvasIndexPersistSoon() {
    clearTimeout(canvasIndex.timer);
    canvasIndex.timer = setTimeout(() => void canvasIndexPersist(), 800);
  }
  async function canvasIndexPersist() {
    if (!canvasIndex.entries || !canvasIndex.dirty.size && !canvasIndex.removed.size) return;
    const byId = new Map(canvasIndex.entries.map(entry => [entry.id, entry])), put = [...canvasIndex.dirty].map(id => byId.get(id)).filter(Boolean), removed = [...canvasIndex.removed].filter(id => !byId.has(id));
    canvasIndex.dirty.clear();
    canvasIndex.removed.clear();
    try {
      const db = await canvasIndexDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CANVAS_INDEX_STORE, "readwrite"), store = tx.objectStore(CANVAS_INDEX_STORE);
        for (const entry of put) store.put(entry);
        for (const id of removed) store.delete(id);
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (error) { debug("canvas-index-save-failed", { error:String(error?.message || error).slice(0, 160) }); }
  }
  function canvasIndexUpsert(entry) {
    if (!canvasIndex.entries || !PEN_INTEL) return;
    const before = new Set(canvasIndex.entries.map(item => item.id));
    canvasIndex.entries = PEN_INTEL.upsertIndexEntry(canvasIndex.entries, entry, CANVAS_INDEX_LIMIT);
    const after = new Set(canvasIndex.entries.map(item => item.id));
    for (const id of before) if (!after.has(id)) canvasIndex.removed.add(id);
    canvasIndex.dirty.add(entry.id);
    canvasIndexPersistSoon();
  }
  function canvasIndexDocument() {
    const doc = canvasDocumentsCurrent();
    return { documentId:doc.id, documentTitle:doc.title || penIntelCopy("Untitled Canvas", "未命名画布"), locator:doc.locator || (state.currentSnapshotId ? { location:state.snapshotLocation, id:state.currentSnapshotId } : null) };
  }
  // Renders a Canvas box (ink, text, images and widget snapshots) onto white.
  function canvasIndexRender(box, side, inkOnly = false) {
    const scale = Math.min(1, side / Math.max(box.w, box.h)), out = document.createElement("canvas");
    out.width = Math.max(8, Math.round(box.w * scale));
    out.height = Math.max(8, Math.round(box.h * scale));
    const context = out.getContext("2d", { willReadFrequently:true });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, out.width, out.height);
    context.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
    if (!inkOnly) {
      drawWidgetsToContext(context, box);
      drawImagesToContext(context, box);
      drawTextBoxesToContext(context, box);
    }
    forTiles(box.x, box.y, box.w, box.h, (canvas, tx, ty) => context.drawImage(canvas, tx * TILE, ty * TILE), false);
    if (!inkOnly) drawSharpOverlays(context, box);
    context.setTransform(1, 0, 0, 1, 0, 0);
    return out;
  }
  function canvasIndexSignature(box, inkOnly) {
    const thumbCanvas = canvasIndexRender(box, CANVAS_INDEX_THUMB, inkOnly), small = canvasIndexRender(box, 64, inkOnly),
      data = small.getContext("2d").getImageData(0, 0, small.width, small.height).data;
    let thumb = "";
    try { thumb = thumbCanvas.toDataURL("image/jpeg", 0.72); } catch {}
    return { thumb:thumb.startsWith("data:image/jpeg;base64,") ? thumb : "", vector:PEN_INTEL.sketchVector(data, small.width, small.height) };
  }
  function canvasIndexId(documentId, source, key) { return `${documentId}:${source}:${key}`; }

  // Assist already classified this ink with PenEchoLLM; keep the label.
  async function canvasIndexInk(cluster, answers) {
    if (!PEN_INTEL || !cluster || cluster.selection || !cluster.strokes?.length) return;
    const kind = PEN_INTEL.indexKindFromInk(answers?.kind?.choice);
    if (!kind || Number(answers.kind.confidence || 0) < 0.45) return;
    await canvasIndexLoad();
    const box = { ...cluster.box }, doc = canvasIndexDocument(), signature = canvasIndexSignature(box, true);
    canvasIndexUpsert({ id:canvasIndexId(doc.documentId, "ink", `${Math.round(box.x)},${Math.round(box.y)}`), ...doc, source:"ink", box, kind, subject:"", title:"", text:"", ...signature, updatedAt:Date.now() });
  }
  // Widgets, typed text and images describe themselves; no model call.
  async function canvasIndexSyncObjects() {
    if (!PEN_INTEL) return;
    await canvasIndexLoad();
    const doc = canvasIndexDocument(), seen = new Set();
    const add = (source, objectId, box, kind, title, text) => {
      const id = canvasIndexId(doc.documentId, source, objectId);
      seen.add(id);
      const previous = canvasIndex.entries.find(entry => entry.id === id);
      if (previous && previous.title === title && previous.text === text && previous.box.x === box.x && previous.box.y === box.y && previous.box.w === box.w && previous.box.h === box.h) return;
      canvasIndexUpsert({ id, ...doc, source, objectId, box:{ ...box }, kind, subject:previous?.subject || "", title, text, ...canvasIndexSignature(box, false), updatedAt:Date.now() });
    };
    for (const widget of state.widgets || []) add("widget", widget.id, widgetBox(widget), PEN_INTEL.indexKindFromWidget(widget), String(widget.title || "").slice(0, 120), String(widget.copyText || "").slice(0, 600));
    for (const text of state.textBoxes || []) add("text", text.id, textBoxBox(text), "text", "", String(text.text || "").slice(0, 600));
    for (const [index, image] of (state.images || []).entries()) add("image", image.id || `image-${Math.round(image.x)}-${Math.round(image.y)}-${index}`, imageBox(image), image.plotExpression ? "graph" : "image", image.plotExpression ? `y = ${image.plotExpression}` : "", "");
    // Objects deleted from this Canvas leave the index.
    const stale = canvasIndex.entries.filter(entry => entry.documentId === doc.documentId && ["widget", "text", "image"].includes(entry.source) && !seen.has(entry.id));
    if (stale.length) {
      const ids = new Set(stale.map(entry => entry.id));
      canvasIndex.entries = canvasIndex.entries.filter(entry => !ids.has(entry.id));
      for (const id of ids) canvasIndex.removed.add(id);
      canvasIndexPersistSoon();
    }
  }
  // Older ink (loaded files, other sessions) has no vectors: find inked regions
  // from the raster tiles, then label each with PenEchoLLM in the background.
  function canvasIndexInkRegions() {
    const CELL = 32, cells = new Set();
    for (const [key] of tiles) {
      const [tx, ty] = key.split(",").map(Number);
      let ink = state.inkBounds.get(key);
      if (ink === undefined) { const c = tiles.get(key); ink = c ? inkBox(c) : null; state.inkBounds.set(key, ink); }
      if (!ink) continue;
      const canvas = tiles.get(key), n = TILE / CELL, probe = document.createElement("canvas");
      probe.width = probe.height = n;
      const context = probe.getContext("2d", { willReadFrequently:true });
      context.drawImage(canvas, 0, 0, TILE, TILE, 0, 0, n, n);
      const data = context.getImageData(0, 0, n, n).data;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (data[(y * n + x) * 4 + 3] > 12) cells.add(`${tx * n + x},${ty * n + y}`);
    }
    const regions = [], seen = new Set(), reach = 3;
    for (const start of cells) {
      if (seen.has(start)) continue;
      const queue = [start], members = [];
      seen.add(start);
      while (queue.length) {
        const cell = queue.pop(), [cx, cy] = cell.split(",").map(Number);
        members.push([cx, cy]);
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
          const next = `${cx + dx},${cy + dy}`;
          if (cells.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      if (members.length < 3) continue;
      const xs = members.map(([x]) => x), ys = members.map(([, y]) => y), x0 = Math.min(...xs) * CELL, y0 = Math.min(...ys) * CELL;
      regions.push({ box:{ x:x0, y:y0, w:(Math.max(...xs) + 1) * CELL - x0, h:(Math.max(...ys) + 1) * CELL - y0 }, weight:members.length });
    }
    return regions.sort((a, b) => b.weight - a.weight);
  }
  async function canvasIndexScan(onProgress) {
    if (canvasIndex.scanning) return canvasIndex.scanning;
    canvasIndex.scanning = (async () => {
      await canvasIndexSyncObjects();
      const doc = canvasIndexDocument(), documentId = doc.documentId,
        known = canvasIndex.entries.filter(entry => entry.documentId === documentId && (entry.source === "ink" || entry.source === "scan")),
        area = box => Math.max(1, box.w * box.h),
        todo = canvasIndexInkRegions().filter(region => !known.some(entry => { const shared = PEN_INTEL.overlap(entry.box, region.box); return shared && area(shared) >= area(region.box) * 0.5; })).slice(0, CANVAS_INDEX_SCAN_LIMIT);
      let done = 0, labelled = 0;
      onProgress?.(done, todo.length, labelled);
      for (const region of todo) {
        if (canvasDocumentsCurrent().id !== documentId || !canvasIndex.panel) break;
        const pad = 16, box = { x:Math.max(0, region.box.x - pad), y:Math.max(0, region.box.y - pad), w:Math.min(SIZE, region.box.w + pad * 2), h:Math.min(SIZE, region.box.h + pad * 2) },
          image = smartSuggestEncodeImage(canvasIndexRender(box, SMART_SUGGEST_CROP_SIDE, true)),
          answers = image ? await penechoLLMRequest("index", image, {}, { background:true }) : null;
        done++;
        const kind = answers?.kind?.choice && answers.kind.choice !== "none" ? answers.kind.choice : null;
        if (kind) {
          labelled++;
          canvasIndexUpsert({ id:canvasIndexId(documentId, "scan", `${Math.round(box.x)},${Math.round(box.y)}`), ...doc, source:"scan", box, kind, subject:answers.subject?.choice && answers.subject.choice !== "other" ? answers.subject.choice : "", title:"", text:"", ...canvasIndexSignature(box, true), updatedAt:Date.now() });
        }
        onProgress?.(done, todo.length, labelled);
        if (!answers && !penIntelRemote()) break;
      }
      return { scanned:done, labelled, remaining:Math.max(0, todo.length - done) };
    })();
    try { return await canvasIndex.scanning; } finally { canvasIndex.scanning = null; }
  }

  // ---------- Search panel ----------
  function canvasIndexKindLabel(kind) {
    const item = PEN_INTEL?.INDEX_KINDS?.[kind];
    return item ? `${item.icon} ${state.language === "zh" ? item.zh : item.en}` : kind || "";
  }
  function canvasIndexSubjectLabel(subject) {
    const item = PEN_INTEL?.INDEX_SUBJECTS?.[subject];
    return item && subject !== "other" ? (state.language === "zh" ? item.zh : item.en) : "";
  }
  function closeCanvasSearch() {
    const panel = canvasIndex.panel;
    if (!panel) return;
    canvasIndex.panel = null;
    panel.element.remove();
  }
  async function openCanvasSearch() {
    if (!PEN_INTEL) return;
    if (canvasIndex.panel) { canvasIndex.panel.input.focus(); return; }
    hideAssist("canvas-search");
    const element = document.createElement("section"), header = document.createElement("div"), title = document.createElement("h2"),
      input = document.createElement("input"), sketchRow = document.createElement("div"), pad = document.createElement("canvas"),
      status = document.createElement("p"), results = document.createElement("div"), close = penIntelButton("", "×", "pen-intel-close", closeCanvasSearch, penIntelCopy("Close", "关闭"));
    element.className = "canvas-search-panel";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", penIntelCopy("Search canvases", "搜索画布"));
    header.className = "canvas-search-header";
    title.textContent = penIntelCopy("Search canvases", "搜索画布");
    header.append(title, close);
    input.type = "search";
    input.className = "canvas-search-input";
    input.placeholder = penIntelCopy("Formula, circuit, to-do, 电路…", "公式、电路、待办、circuit…");
    input.setAttribute("aria-label", penIntelCopy("Search canvases", "搜索画布"));
    sketchRow.className = "canvas-search-sketch";
    pad.width = 220;
    pad.height = 96;
    pad.className = "canvas-search-pad";
    pad.setAttribute("aria-label", penIntelCopy("Sketch what you are looking for", "画出你要找的内容"));
    const sketchCopy = document.createElement("span");
    sketchCopy.textContent = penIntelCopy("…or sketch it", "……或画出来");
    const sketchSearch = penIntelButton(penIntelCopy("Find similar", "查找相似"), "✦", "pen-intel-action", () => void runSketchSearch()),
      sketchClear = penIntelButton(penIntelCopy("Clear", "清除"), "", "pen-intel-quiet", () => { const c = pad.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, pad.width, pad.height); canvasIndex.sketchVector = null; canvasIndex.sketchAnswers = null; renderCanvasSearch(); }),
      scan = penIntelButton(penIntelCopy("Scan this canvas", "扫描当前画布"), "⟳", "pen-intel-quiet", () => void runCanvasScan());
    const sketchControls = document.createElement("div");
    sketchControls.className = "canvas-search-sketch-controls";
    sketchControls.append(sketchCopy, sketchSearch, sketchClear);
    sketchRow.append(pad, sketchControls);
    status.className = "canvas-search-status";
    results.className = "canvas-search-results";
    results.setAttribute("role", "list");
    const footer = document.createElement("div");
    footer.className = "canvas-search-footer";
    footer.append(status, scan);
    element.append(header, input, sketchRow, footer, results);
    element.addEventListener("pointerdown", event => event.stopPropagation());
    element.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); closeCanvasSearch(); }
    });
    // A small pad for search-by-sketch.
    const padContext = pad.getContext("2d");
    padContext.fillStyle = "#fff";
    padContext.fillRect(0, 0, pad.width, pad.height);
    let last = null;
    pad.addEventListener("pointerdown", event => { pad.setPointerCapture(event.pointerId); last = { x:event.offsetX, y:event.offsetY }; });
    pad.addEventListener("pointermove", event => {
      if (!last) return;
      padContext.strokeStyle = "#111827";
      padContext.lineWidth = 3;
      padContext.lineCap = padContext.lineJoin = "round";
      padContext.beginPath();
      padContext.moveTo(last.x, last.y);
      padContext.lineTo(event.offsetX, event.offsetY);
      padContext.stroke();
      last = { x:event.offsetX, y:event.offsetY };
    });
    const finish = () => { if (!last) return; last = null; canvasIndex.sketchVector = PEN_INTEL.sketchVector(padContext.getImageData(0, 0, pad.width, pad.height).data, pad.width, pad.height); canvasIndex.sketchAnswers = null; renderCanvasSearch(); };
    pad.addEventListener("pointerup", finish);
    pad.addEventListener("pointercancel", finish);
    let debounce = 0;
    input.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(renderCanvasSearch, 120); });
    document.body.append(element);
    canvasIndex.panel = { element, input, pad, status, results };
    input.focus();
    status.textContent = penIntelCopy("Loading index…", "正在读取索引……");
    await canvasIndexSyncObjects();
    renderCanvasSearch();
  }
  async function runSketchSearch() {
    const panel = canvasIndex.panel;
    if (!panel || !canvasIndex.sketchVector) return;
    panel.status.textContent = penIntelCopy("Reading your sketch…", "正在识别草图……");
    const image = smartSuggestEncodeImage(panel.pad);
    canvasIndex.sketchAnswers = image ? await penechoLLMRequest("index", image, {}) : null;
    renderCanvasSearch();
  }
  async function runCanvasScan() {
    const panel = canvasIndex.panel;
    if (!panel) return;
    if (!penIntelRemote()) { panel.status.textContent = penIntelCopy("Scanning needs PenEchoLLM. Sign in or check suggestions in Settings.", "扫描需要 PenEchoLLM。请登录，或在设置中检查自动提示。"); return; }
    const result = await canvasIndexScan((done, total) => {
      if (canvasIndex.panel) canvasIndex.panel.status.textContent = total ? penIntelCopy(`Scanning ${done}/${total} regions…`, `正在扫描 ${done}/${total} 个区域……`) : penIntelCopy("Everything on this canvas is already indexed.", "当前画布已全部索引。");
    });
    if (canvasIndex.panel) {
      renderCanvasSearch();
      canvasIndex.panel.status.textContent = penIntelCopy(`Scan finished: ${result.labelled} new regions labelled.`, `扫描完成：新标注 ${result.labelled} 个区域。`);
    }
  }
  function renderCanvasSearch() {
    const panel = canvasIndex.panel;
    if (!panel || !canvasIndex.entries) return;
    const current = canvasDocumentsCurrent().id, answers = canvasIndex.sketchAnswers,
      sketch = canvasIndex.sketchVector ? { vector:canvasIndex.sketchVector, kind:answers?.kind?.choice !== "none" ? answers?.kind?.choice : null, subject:answers?.subject?.choice || null } : null,
      ranked = PEN_INTEL.searchIndex(canvasIndex.entries, panel.input.value, { sketch }).slice(0, 24);
    panel.results.textContent = "";
    const documents = new Set(canvasIndex.entries.map(entry => entry.documentId));
    panel.status.textContent = sketch?.kind
      ? penIntelCopy(`Sketch looks like: ${canvasIndexKindLabel(sketch.kind)}`, `草图识别为：${canvasIndexKindLabel(sketch.kind)}`)
      : penIntelCopy(`${canvasIndex.entries.length} regions indexed across ${documents.size} canvases`, `已索引 ${documents.size} 个画布中的 ${canvasIndex.entries.length} 个区域`);
    if (!ranked.length) {
      const empty = document.createElement("p");
      empty.className = "canvas-search-empty";
      empty.textContent = panel.input.value.trim() || sketch ? penIntelCopy("No matches yet. Try another word, or scan this canvas.", "暂无结果。换个词，或扫描当前画布。") : penIntelCopy("Nothing indexed yet. Write on the canvas with suggestions on, or scan it.", "还没有索引。开启自动提示后书写，或扫描画布。");
      panel.results.append(empty);
      return;
    }
    for (const { entry } of ranked) {
      const item = document.createElement("button"), label = document.createElement("span"), meta = document.createElement("span"), body = document.createElement("span");
      item.type = "button";
      item.className = "canvas-search-result";
      item.setAttribute("role", "listitem");
      if (entry.thumb) {
        const thumb = document.createElement("img");
        thumb.src = entry.thumb;
        thumb.alt = "";
        item.append(thumb);
      }
      body.className = "canvas-search-result-body";
      label.className = "canvas-search-result-label";
      label.textContent = [canvasIndexKindLabel(entry.kind), canvasIndexSubjectLabel(entry.subject)].filter(Boolean).join(" · ");
      meta.className = "canvas-search-result-meta";
      const snippet = (entry.title || entry.text || "").replace(/\s+/g, " ").slice(0, 80);
      meta.textContent = [snippet, entry.documentId === current ? penIntelCopy("This canvas", "当前画布") : entry.documentTitle].filter(Boolean).join(" — ");
      body.append(label, meta);
      item.append(body);
      item.addEventListener("click", () => void openCanvasIndexEntry(entry));
      panel.results.append(item);
    }
  }
  async function openCanvasIndexEntry(entry) {
    try {
      if (entry.documentId !== canvasDocumentsCurrent().id) {
        if (canvasDocuments.records.has(entry.documentId)) await canvasDocumentsShow(entry.documentId);
        else if (entry.locator?.id && entry.locator?.location) await requestCanvasTransition({ type:"load", id:entry.locator.id, location:entry.locator.location });
        else throw Error(penIntelCopy("That canvas is not open or saved anymore.", "该画布已关闭且未保存。"));
      }
      if (canvasDocumentsCurrent().id !== entry.documentId) return;
      canvasAgentFrameRegion(entry.box, 120);
      if (typeof updateCoordinates === "function") updateCoordinates();
      showCanvasIndexHighlight(entry.box);
    } catch (error) {
      setStatus(String(error?.message || error));
    }
  }
  function showCanvasIndexHighlight(box) {
    const layer = penIntelLayer();
    if (!layer) return;
    canvasIndex.highlight?.element.remove();
    const element = document.createElement("div");
    element.className = "canvas-search-highlight";
    element.setAttribute("aria-hidden", "true");
    layer.append(element);
    canvasIndex.highlight = { element, box, until:performance.now() + 2200 };
    penIntelTrack();
  }
  // Called by the shared overlay loop; true while the highlight is visible.
  function canvasIndexTrack() {
    const highlight = canvasIndex.highlight;
    if (!highlight) return false;
    if (performance.now() > highlight.until) { highlight.element.remove(); canvasIndex.highlight = null; return false; }
    const screen = assistScreenBox(highlight.box);
    if (screen) {
      highlight.element.style.setProperty("--pen-intel-x", `${Math.round(screen.x - 6)}px`);
      highlight.element.style.setProperty("--pen-intel-y", `${Math.round(screen.y - 6)}px`);
      highlight.element.style.setProperty("--pen-intel-w", `${Math.round(screen.w + 12)}px`);
      highlight.element.style.setProperty("--pen-intel-h", `${Math.round(screen.h + 12)}px`);
    }
    return true;
  }
