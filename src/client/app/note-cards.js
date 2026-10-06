  // ---------- Note cards: Organize as Note, the Notes library and ranking ----------
  //
  // A note card is a General HTML Widget whose document PenEcho builds from a
  // compact note source (public/note-card.js), like scenes. It always renders
  // in the same portrait 3:4 frame, has a title, a category and an optional
  // bookmark, and comes in two looks from one type:
  //   • "card" — a knowledge card for study material (concepts, formulas…);
  //   • "note" — a work note (meetings, ideas, plans, to-dos).
  // The look follows the category and can be switched at any time; both share
  // one library, one size and one source format.
  //
  //   • Organize as Note (Suggest Bar, any lasso selection) gathers the selected
  //     ink, text, images and widgets into a card. With Canvas AI it also
  //     transcribes handwriting, names the card and picks the category; the
  //     original handwriting is kept on the card.
  //   • Canvas AI, PenEcho Agent and MCP create cards from the same source.
  //   • Notes & Cards keeps independent server snapshots with a durable Cloud
  //     outbox. IndexedDB is a recovery cache, not the authoritative backup.
  const NOTE_CATEGORY_STORAGE_KEY = "penecho-note-categories-v1",
    NOTE_LIBRARY_DB = "penecho-note-library",
    NOTE_LIBRARY_STORE = "notes",
    NOTE_LIBRARY_PAGE_STORE = "pages",
    NOTE_LIBRARY_PENDING_INDEX = "pending",
    NOTE_LIBRARY_CACHE_VIEWS = 8,
    NOTE_LIBRARY_CACHE_ROWS = 120,
    NOTE_LIBRARY_PAGE_SIZE = 12,
    NOTE_THUMB_W = 900,
    NOTE_THUMB_MAX_CHARS = 700 * 1024,
    noteCards = { entries:null, loading:null, entryLoads:new Map(), loadedIds:new Set(), pageCache:new Map(), lastView:null, cachePersist:Promise.resolve(), total:null, accountId:null, dirty:new Set(), removed:new Set(), timer:0, panel:null, chooser:null, rankBusy:false, rankKey:"", rankAgain:false, relevanceKey:"", awaiting:null, knownIds:new Set(), mathHooked:false, review:null, persist:null, reader:null, thumbTasks:new Map(), thumbQueue:Promise.resolve() };

  function noteCardRuntime() { return window.PENECHO_NOTE_CARD || null; }
  function noteCardWidget(widget) { return Boolean(widget && noteCardRuntime()?.isNoteFormat(widget.sourceFormat)); }
  function noteCopy(en, zh) { return state.language === "zh" ? zh : en; }

  // ---------- Rendering ----------
  function noteCardMathRenderer() {
    const mathJax = window.MathJax;
    if (typeof mathJax?.tex2svg !== "function") return null;
    return (latex, display) => {
      const node = mathJax.tex2svg(String(latex), { display });
      if (node?.querySelector?.("mjx-merror, [data-mjx-error]")) return "";
      const svg = node?.querySelector?.("svg");
      return svg ? svg.outerHTML : "";
    };
  }
  function noteCardDocument(source, options = {}) {
    const NOTE = noteCardRuntime();
    if (!NOTE) return "";
    const note = typeof source === "string" ? NOTE.parseSource(source, { categories:noteCategories(), language:state.language }) : source;
    let html = NOTE.documentFor(note, { ...options, language:state.language, renderMath:noteCardMathRenderer() });
    // Rendered math is the largest optional part; drop it before the media.
    if (html.length > NOTE.MAX_DOCUMENT_CHARS) html = NOTE.documentFor(note, { ...options, language:state.language });
    if (html.length > NOTE.MAX_DOCUMENT_CHARS) throw Error(noteCopy("This note is too large. Remove an image and try again.", "笔记过大，请删除一张图片后重试。"));
    return html;
  }
  function noteCardWidgetDocument(widget, source = widget.copyText) {
    const html = noteCardDocument(source);
    return widget.widgetAnimation ? widgetAnimationDocument(html, widget.widgetAnimation, window.PENECHO_SCENE) : html;
  }
  // MathJax loads after the Canvas restores. Re-render cards that showed
  // LaTeX source, without touching history or the saved revision.
  function noteCardsHookMath() {
    if (noteCards.mathHooked) return;
    const promise = window.MathJax?.startup?.promise;
    if (!promise?.then) { setTimeout(noteCardsHookMath, 1500); return; }
    noteCards.mathHooked = true;
    promise.then(() => noteCardsRefreshMath()).catch(() => {});
  }
  function noteCardsRefreshMath() {
    const NOTE = noteCardRuntime();
    if (!NOTE || !noteCardMathRenderer()) return;
    for (const widget of [...(state.widgets || []), ...(state.pendingWidget ? [state.pendingWidget] : [])]) {
      if (!noteCardWidget(widget) || !NOTE.documentNeedsMath(widget.html)) continue;
      try {
        const html = noteCardWidgetDocument(widget);
        if (html === widget.html) continue;
        widget.html = html;
        noteCardInvalidate(widget);
      } catch {}
    }
    requestRender();
    if (noteCards.panel) noteLibraryRender();
  }
  function noteCardInvalidate(widget) {
    widget.contentVersion = (widget.contentVersion || 0) + 1;
    widget.snapshotImage = null;
    widget.snapshotDataUrl = "";
    widget.snapshotVersion = -1;
    widget.initialized = false;
    widget.hostStateKey = null;
    if (widget.frame) widget.frame.title = widget.title;
    widget.shell?.setAttribute("aria-label", `${widget.title}. ${t("widgetRefineHint")}`);
    positionWidget(widget);
  }
  function noteCardSource(widget) {
    const NOTE = noteCardRuntime();
    try { return NOTE && widget?.copyText ? NOTE.parseSource(widget.copyText, { categories:noteCategories(), language:state.language }) : null; } catch { return null; }
  }
  // Fields shared by every path that creates a card Widget.
  function noteCardWidgetFields(note) {
    note.libraryId ||= canvasClientId();
    const NOTE = noteCardRuntime(), copyText = NOTE.formatSource(note);
    return { widgetType:"html_widget", pluginId:"general", title:note.title.slice(0, 120), refreshSeconds:0, sourceFormat:NOTE.FORMAT, frameworkVersion:NOTE.FRAMEWORK_VERSION, copyText, copyLabel:NOTE.COPY_LABEL, html:noteCardDocument(note), contentW:NOTE.CONTENT.w, contentH:NOTE.CONTENT.h };
  }
  function noteCardOccupied(except = null) {
    return [...(state.widgets || []).filter(widget => widget !== except).map(widgetBox), ...(state.images || []).map(imageBox), ...(state.textBoxes || []).map(textBoxBox)];
  }
  function noteCardDeckSize() {
    const NOTE = noteCardRuntime();
    return NOTE.cardSize((state.widgets || []).filter(noteCardWidget).map(widgetBox), viewportRect(), SIZE);
  }
  function noteCardPlacement(sourceBox) {
    const NOTE = noteCardRuntime(), size = noteCardDeckSize(), visible = viewportRect(), occupied = noteCardOccupied(), ink = visible && visibleInkBounds(visible);
    if (sourceBox) occupied.push(sourceBox);
    if (ink) occupied.push(ink);
    return NOTE.placeBeside(sourceBox || (visible ? { x:visible.x + visible.w * 0.35, y:visible.y + visible.h * 0.15, w:0, h:0 } : null), size, occupied, SIZE, null, visible);
  }
  // Pictures are large; edits by Canvas AI, the Agent or MCP read and patch the
  // note source with short media references that PenEcho restores.
  const NOTE_MEDIA_REF = /^penecho-note-media:(\d{1,3})$/;
  function noteCardStripMedia(copyText) {
    const media = [];
    try {
      const value = JSON.parse(String(copyText || ""));
      for (const block of Array.isArray(value?.blocks) ? value.blocks : []) {
        if (typeof block?.src === "string" && block.src.startsWith("data:")) { media.push(block.src); block.src = `penecho-note-media:${media.length - 1}`; }
      }
      return { source:JSON.stringify(value, null, 2), media };
    } catch { return { source:String(copyText || ""), media }; }
  }
  function noteCardRestoreMedia(copyText, originalCopyText) {
    const { media } = noteCardStripMedia(originalCopyText);
    try {
      const value = JSON.parse(String(copyText || ""));
      const original = JSON.parse(String(originalCopyText || "{}"));
      if (original.libraryId) value.libraryId = original.libraryId;
      for (const block of Array.isArray(value?.blocks) ? value.blocks : []) {
        const match = typeof block?.src === "string" ? NOTE_MEDIA_REF.exec(block.src) : null;
        if (match) { if (media[Number(match[1])]) block.src = media[Number(match[1])]; else delete block.src; }
      }
      return JSON.stringify(value);
    } catch { return String(copyText || ""); }
  }
  // Insert a committed (undoable) card. Returns the Widget.
  async function noteCardInsert(note, box = null, { inputSnapshot = null, documentId = canvasDocumentsCurrent().id, inputGeneration = null } = {}) {
    const NOTE = noteCardRuntime();
    if (!NOTE) throw Error("Note cards are unavailable.");
    await noteLibraryLoad();
    if (canvasDocumentsCurrent().id !== documentId) throw Error("The source canvas changed before the note could be created.");
    if (inputGeneration !== null && inputGeneration !== aiPreparationGeneration) return null;
    if (state.widgets.length >= MAX_VISIBLE_WIDGETS) throw Error(t("widgetLimitReached"));
    if (state.pendingWidget) acceptPendingWidget({ restoreMode:false });
    if (state.widgetEdit) acceptWidgetEdit();
    await enableSnapshotWidgetPlugins([{ pluginId:"general" }]);
    if (canvasDocumentsCurrent().id !== documentId) throw Error("The source canvas changed before the note could be created.");
    if (inputGeneration !== null && inputGeneration !== aiPreparationGeneration) return null;
    const placed = box && [box.x, box.y, box.w, box.h].every(Number.isFinite) ? box : noteCardPlacement(null),
      widget = widgetRecord({ ...noteCardWidgetFields(note), x:placed.x, y:placed.y, w:placed.w, h:placed.h });
    if (!widget) throw Error(noteCopy("The note card could not be created.", "无法创建笔记卡片。"));
    recordWidgetsBefore();
    state.widgets.push(widget);
    if (pluginEnabled(widget.pluginId)) mountWidget(widget);
    state.userRevision++;
    state.autoEligible = false;
    saveUserCanvasChange();
    // Consume only after the card is committed, before library I/O can fail or
    // yield to newer handwriting. This also updates the card's Undo snapshot.
    if (inputSnapshot) consumeDirtyInput(inputSnapshot);
    requestRender();
    noteCards.knownIds.add(widget.id);
    await noteLibraryUpsertWidget(widget);
    await noteLibraryPersist();
    return widget;
  }
  // Change a card's source in place (one undo step).
  function noteCardUpdate(widget, mutate) {
    const NOTE = noteCardRuntime(), note = noteCardSource(widget);
    if (!NOTE || !note || !state.widgets.includes(widget)) return null;
    const draft = structuredClone(note), next = mutate(draft) || draft;
    next.updated = Date.now();
    const copyText = NOTE.formatSource(next), html = noteCardWidgetDocument(widget, next);
    if (copyText === widget.copyText && html === widget.html) return widget;
    recordWidgetsBefore();
    widget.copyText = copyText;
    widget.html = html;
    widget.title = next.title.slice(0, 120);
    noteCardInvalidate(widget);
    state.userRevision++;
    state.autoEligible = false;
    saveUserCanvasChange();
    requestRender();
    noteLibraryUpsertWidget(widget);
    if (noteCards.panel) noteLibraryRender();
    return widget;
  }

  // ---------- Categories ----------
  function noteCategories() {
    const NOTE = noteCardRuntime();
    if (!NOTE) return [];
    let custom = [];
    try { custom = JSON.parse(localStorage.getItem(NOTE_CATEGORY_STORAGE_KEY) || "[]"); } catch {}
    const list = NOTE.CATEGORIES.map(item => ({ ...item, label:state.language === "zh" ? item.zh : item.en }));
    for (const item of Array.isArray(custom) ? custom.slice(0, 24) : []) {
      const category = NOTE.normalizeCategory(item, { categories:[] });
      if (category && !list.some(existing => existing.id === category.id)) list.push({ ...category, en:category.label, zh:category.label, style:item.style === "note" ? "note" : "card", custom:true });
    }
    return list;
  }
  function noteCategoryLabel(category) { return category?.label || noteCardRuntime()?.categoryLabel(category, state.language) || ""; }
  function addNoteCategory(label, color, style = "card") {
    const NOTE = noteCardRuntime(), category = NOTE?.normalizeCategory({ id:label, label, color }, { categories:[] });
    if (!category) return null;
    let custom = [];
    try { custom = JSON.parse(localStorage.getItem(NOTE_CATEGORY_STORAGE_KEY) || "[]"); } catch {}
    if (!Array.isArray(custom)) custom = [];
    if (!noteCategories().some(item => item.id === category.id)) custom.push({ ...category, style });
    try { localStorage.setItem(NOTE_CATEGORY_STORAGE_KEY, JSON.stringify(custom.slice(0, 24))); } catch {}
    return category;
  }
  function removeNoteCategory(id) {
    let custom = [];
    try { custom = JSON.parse(localStorage.getItem(NOTE_CATEGORY_STORAGE_KEY) || "[]"); } catch {}
    try { localStorage.setItem(NOTE_CATEGORY_STORAGE_KEY, JSON.stringify((Array.isArray(custom) ? custom : []).filter(item => item?.id !== id))); } catch {}
  }

  // ---------- Capturing a selection ----------
  function noteEncodeCanvas(source, { maxSide = 1720, budget = 360000, alpha = true } = {}) {
    if (!source?.width || !source?.height) return null;
    let scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    for (let attempt = 0; attempt < 7; attempt++, scale *= 0.78) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const context = canvas.getContext("2d");
      if (!alpha) { context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); }
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      for (const [type, quality] of alpha ? [["image/png"], ["image/webp", 0.96]] : [["image/webp", 0.92], ["image/jpeg", 0.92]]) {
        const url = canvas.toDataURL(type, quality);
        if (url.startsWith(`data:${type}`) && url.length <= budget) return { src:url, w:canvas.width, h:canvas.height };
      }
    }
    return null;
  }
  function noteInsidePath(path, box) {
    return path?.length >= 3 && SELECT.pointInPolygon({ x:box.x + box.w / 2, y:box.y + box.h / 2 }, path);
  }
  // Ink inside the lasso as a transparent image, cropped to the strokes.
  function noteSelectionInk(selection, path) {
    const box = selection.regionOnly ? { ...selection.box } : selectionContentBounds(selection) || { ...selection.box };
    if (!box || box.w < 2 || box.h < 2) return null;
    const scale = Math.min(2, 4800 / Math.max(box.w, box.h)), canvas = offscreen(box.w * scale, box.h * scale, true), context = canvas.getContext("2d", { willReadFrequently:true });
    context.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
    if (selection.regionOnly) {
      context.save();
      traceSelectionPath(context, path);
      context.clip("evenodd");
      forTiles(box.x, box.y, box.w, box.h, (tile, tx, ty) => context.drawImage(tile, tx * TILE, ty * TILE), false);
      drawSharpOverlays(context, box);
      context.restore();
    } else {
      for (const fragment of selection.fragments || []) {
        const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
        context.drawImage(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
      }
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    const ink = inkBox(canvas);
    if (!ink || ink.w < 3 || ink.h < 3) return null;
    const pad = Math.ceil(Math.max(ink.w, ink.h) * 0.03) + Math.ceil(8 * scale), crop = offscreen(ink.w + pad * 2, ink.h + pad * 2);
    crop.getContext("2d").drawImage(canvas, ink.x, ink.y, ink.w, ink.h, pad, pad, ink.w, ink.h);
    const encoded = noteEncodeCanvas(crop, { maxSide:1760, budget:380000, alpha:true });
    return encoded ? { ...encoded, y:box.y + ink.y / scale, x:box.x + ink.x / scale, worldBox:{ x:box.x + ink.x / scale, y:box.y + ink.y / scale, w:ink.w / scale, h:ink.h / scale } } : null;
  }
  async function noteWidgetPart(widget) {
    const NOTE = noteCardRuntime(), box = widgetBox(widget);
    if (noteCardWidget(widget)) { const note = noteCardSource(widget); return note ? { kind:"note", note, x:box.x, y:box.y } : null; }
    if (widget.sourceFormat === "penecho-graph") {
      const data = SMART_SUGGEST?.graphDocumentData?.(widget.html)?.data;
      const expressions = (data?.expressions || []).filter(value => typeof value === "string" && value.trim()).slice(0, 4);
      if (expressions.length && data?.mode !== "3d") return { kind:"graph", expressions, parameters:data.parameters || undefined, x:box.x, y:box.y };
    }
    try {
      const image = await requestWidgetSnapshot(widget, 6000, true, null, true);
      if (!image) return null;
      const canvas = offscreen(image.width || image.naturalWidth || widget.contentW, image.height || image.naturalHeight || widget.contentH);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const encoded = noteEncodeCanvas(canvas, { maxSide:1520, budget:240000, alpha:false });
      return encoded ? { kind:"widget", ...encoded, title:widget.title, x:box.x, y:box.y } : null;
    } catch { return NOTE ? { kind:"text", text:`**${widget.title}**`, x:box.x, y:box.y } : null; }
  }
  // A captured Note carries media inside its blocks. Fit all copied media as
  // one card, keeping the source cards untouched and retaining every picture.
  async function noteFitCapturedMedia(parts) {
    const NOTE = noteCardRuntime(), captured = structuredClone(parts), media = [];
    for (const item of [...captured.items, captured.ink].filter(Boolean)) {
      for (const block of item.kind === "note" ? item.note?.blocks || [] : [item]) {
        if (block.src?.startsWith("data:")) media.push(block);
      }
    }
    const total = media.reduce((sum, block) => sum + block.src.length, 0),
      overhead = JSON.stringify(captured).length - total,
      budget = Math.min(NOTE.MAX_MEDIA_CHARS - 4000, NOTE.MAX_SOURCE_CHARS - overhead - 8000);
    if (total <= budget) return captured;
    for (const block of media) {
      const share = Math.max(256, Math.floor(budget * block.src.length / total));
      if (block.src.length <= share) continue;
      try {
        const image = new Image();
        image.src = block.src;
        await image.decode();
        const canvas = offscreen(image.naturalWidth, image.naturalHeight);
        canvas.getContext("2d").drawImage(image, 0, 0);
        const encoded = noteEncodeCanvas(canvas, { budget:share, alpha:block.type === "ink" || block === captured.ink });
        if (encoded) Object.assign(block, encoded);
      } catch (error) { debug("note-capture-media-fit-failed", { error:String(error?.message || error).slice(0, 160) }); }
    }
    return captured;
  }
  // Everything the lasso holds, in reading order.
  async function noteCaptureSelection(selection) {
    const path = selectionPathFor(selection), items = [], lifted = !selection.regionOnly;
    const objects = lifted ? (selection.objects || []).map(object => ({ kind:object.kind, item:object.item }))
      : [...(state.textBoxes || []).filter(item => noteInsidePath(path, textBoxBox(item))).map(item => ({ kind:"textBoxes", item })),
        ...(state.images || []).filter(item => noteInsidePath(path, imageBox(item))).map(item => ({ kind:"images", item }))];
    for (const { kind, item } of objects) {
      if (kind === "textBoxes" && String(item.text || "").trim()) items.push({ kind:"text", text:String(item.text).slice(0, 6000), x:item.x, y:item.y });
      else if (kind === "images" && item.image) {
        if (item.plotExpression) { items.push({ kind:"graph", expression:`y = ${item.plotExpression}`, x:item.x, y:item.y }); continue; }
        const width = item.naturalW || item.w, height = item.naturalH || item.h, scale = Math.min(1, 3200 / Math.max(width, height));
        const canvas = offscreen(width * scale, height * scale);
        try { canvas.getContext("2d").drawImage(item.image, 0, 0, canvas.width, canvas.height); } catch { continue; }
        const encoded = noteEncodeCanvas(canvas, { maxSide:1520, budget:240000, alpha:false });
        if (encoded) items.push({ kind:"image", ...encoded, alt:item.sourceName || "", x:item.x, y:item.y });
      }
    }
    for (const widget of (state.widgets || []).filter(widget => !widget.pending && noteInsidePath(path, widgetBox(widget))).slice(0, 4)) {
      const part = await noteWidgetPart(widget);
      if (part) items.push(part);
    }
    const ink = noteSelectionInk(selection, path);
    return noteFitCapturedMedia({ items, ink, box:{ ...selection.box }, path });
  }

  // ---------- Organize as Note ----------
  function noteCategoryHint(parts) {
    const categories = noteCategories().map(item => `${item.id}=${item.label}`).join(", "),
      typed = parts.items.filter(item => item.kind === "text").map(item => item.text).join("\n").slice(0, 900);
    return `${noteCopy("Organize the selection as one PenEcho note card.", "将所选内容整理为一张 PenEcho 笔记卡片。")} Categories (id=label): ${categories}.${typed ? ` Typed text in the selection: ${typed}` : ""}`.slice(0, 1800);
  }
  // Keep the original handwriting, pictures and graphs from the request scope.
  function noteMergeModelNote(modelNote, parts) {
    const NOTE = noteCardRuntime(), note = structuredClone(modelNote), now = Date.now();
    let hasInk = false;
    note.blocks = note.blocks.map(block => {
      if (block.type !== "ink") return block;
      if (block.src) return block;
      if (!parts.ink || hasInk) return null;
      hasInk = true;
      return { ...block, src:parts.ink.src, w:parts.ink.w, h:parts.ink.h };
    }).filter(Boolean);
    const graphs = new Set(note.blocks.filter(block => block.type === "graph").flatMap(block => block.expressions.map(value => value.replace(/\s+/g, ""))));
    for (const item of parts.items) {
      if (note.blocks.length >= NOTE.MAX_BLOCKS - 1) break;
      if (item.kind === "image" || item.kind === "widget") note.blocks.push({ type:"image", src:item.src, w:item.w, h:item.h, ...(item.title || item.alt ? { alt:item.title || item.alt } : {}), ...(item.title ? { caption:item.title } : {}) });
      else if (item.kind === "graph") {
        const expressions = item.expressions || [item.expression];
        if (!expressions.some(value => graphs.has(String(value).replace(/\s+/g, "")))) note.blocks.push({ type:"graph", expressions, ...(item.parameters ? { parameters:item.parameters } : {}) });
      } else if (item.kind === "note") {
        for (const block of item.note.blocks) {
          if (note.blocks.length >= NOTE.MAX_BLOCKS - 1) break;
          if (block.src && !note.blocks.some(existing => existing.src === block.src)) note.blocks.push({ ...block });
        }
      }
    }
    if (parts.ink && !hasInk && note.blocks.length < NOTE.MAX_BLOCKS) note.blocks.push({ type:"ink", src:parts.ink.src, w:parts.ink.w, h:parts.ink.h });
    note.created = note.created || now;
    note.updated = now;
    note.source = { kind:"canvas-ai" };
    return NOTE.normalize(note, { categories:noteCategories(), language:state.language });
  }
  function noteTransformModelCommands(commands, parts, placement) {
    const NOTE = noteCardRuntime();
    for (const command of commands) {
      if (!command || command.tool !== "html_widget" || !NOTE.isNoteFormat(command.sourceFormat)) continue;
      try {
        const note = noteMergeModelNote(NOTE.parseSource(command.copyText, { categories:noteCategories(), language:state.language }), parts);
        return [{ tool:"html_widget", ...noteCardWidgetFields(note), x:placement.x, y:placement.y, w:placement.w, h:placement.h }];
      } catch (error) { debug("note-card-model-rejected", { error:String(error?.message || error).slice(0, 160) }); }
    }
    return [];
  }
  async function organizeSuggestAsNote(target) {
    if (!target || state.drawing || state.viewMode) return false;
    target = { ...target, fromSuggestBar:true };
    if (target.selection) return organizeSelectionAsNote(target);
    if (!noteCardRuntime() || state.selection || target.strokes?.some(stroke => !state.history.includes(stroke.historyEntry))) return false;
    supersedeActiveAI("organize-note");
    clearTimeout(state.timer);
    state.timer = 0;
    clearPenGesture("organize-note");
    dismissPenGestureOffer("organize-note");
    // A handwritten enclosure suggests Note; it does not create a lasso.
    // Capture source media for the complete pending input, matching requestAI.
    const box = { ...(state.dirty || target.box) },
      path = [{ x:box.x, y:box.y }, { x:box.x + box.w, y:box.y }, { x:box.x + box.w, y:box.y + box.h }, { x:box.x, y:box.y + box.h }],
      documentId = canvasDocumentsCurrent().id, generation = aiPreparationGeneration,
      inputSnapshot = captureDirtyInput(box);
    target = { ...target, box, canvasInput:true };
    renderAssist({ mode:"working", label:noteCopy("Organizing as note", "正在整理为笔记"), box, target, action:{ id:"note" } });
    let parts;
    try { parts = await noteCaptureSelection({ regionOnly:true, box, originalPath:path }); }
    catch (error) { releaseDirtyInput(inputSnapshot); hideAssist("note-failed"); setStatus(String(error?.message || error)); return false; }
    if (canvasDocumentsCurrent().id !== documentId || generation !== aiPreparationGeneration) { releaseDirtyInput(inputSnapshot); return false; }
    return organizeCapturedAsNote(target, parts, null, inputSnapshot);
  }
  async function organizeSelectionAsNote(target) {
    const NOTE = noteCardRuntime(), selection = target?.selection;
    if (!NOTE || !selection || selection !== state.selection || selection.phase !== "active") return false;
    const documentId = canvasDocumentsCurrent().id, generation = aiPreparationGeneration, inputSnapshot = captureSelectionDirtyInput(selection);
    renderAssist({ mode:"working", label:noteCopy("Organizing as note", "正在整理为笔记"), box:target.box, target, action:{ id:"note" } });
    let parts;
    try { parts = await noteCaptureSelection(selection); }
    catch (error) { releaseDirtyInput(inputSnapshot); hideAssist("note-failed"); setStatus(String(error?.message || error)); return false; }
    if (canvasDocumentsCurrent().id !== documentId || state.selection !== selection || generation !== aiPreparationGeneration) { releaseDirtyInput(inputSnapshot); return false; }
    return organizeCapturedAsNote(target, parts, () => buildSelectionImage(selection), inputSnapshot);
  }
  // Capture only this widget, even when other objects or new ink overlap it.
  // The temporary image scope never replaces or lifts the user's lasso.
  async function organizeWidgetAsNote(widget) {
    if (!noteCardRuntime() || !widget || widget.pending || noteCardWidget(widget)
      || !state.widgets.includes(widget) || state.drawing || state.viewMode) return false;
    const documentId = canvasDocumentsCurrent().id, revision = state.userRevision,
      box = { ...widgetBox(widget) }, target = { widget, box };
    renderAssist({ mode:"working", label:noteCopy("Organizing as note", "正在整理为笔记"), box, target, action:{ id:"note" } });
    let part;
    try { part = await noteWidgetPart(widget); }
    catch (error) { hideAssist("note-failed"); setStatus(String(error?.message || error)); return false; }
    if (canvasDocumentsCurrent().id !== documentId || state.userRevision !== revision || !state.widgets.includes(widget)) return false;
    const parts = { items:part ? [part] : [], ink:null, box };
    return organizeCapturedAsNote(target, parts, () => {
      if (!widget.snapshotImage) return null;
      const path = [{ x:box.x, y:box.y }, { x:box.x + box.w, y:box.y }, { x:box.x + box.w, y:box.y + box.h }, { x:box.x, y:box.y + box.h }];
      return buildSelectionImage({ phase:"active", regionOnly:false, box, originalBox:box, path, originalPath:path,
        fragments:[], objects:[{ kind:"images", box, item:{ ...box, image:widget.snapshotImage } }] });
    });
  }
  // All entry points share note creation, source media preservation and the
  // local fallback. Widget captures use an isolated request without dirty ink.
  function organizeCapturedAsNote(target, parts, packImage, inputSnapshot = null) {
    const NOTE = noteCardRuntime(), selection = target.selection || null,
      documentId = canvasDocumentsCurrent().id;
    if (!parts.ink && !parts.items.length) { if (inputSnapshot) releaseDirtyInput(inputSnapshot); hideAssist("note-empty"); setStatusKey("selectionEmpty"); return false; }
    const placement = noteCardPlacement(parts.box);
    // Local serialization is a fallback, never a prerequisite for sending AI.
    const finishLocal = (selected = selection, message = "", consumeInput = true) => {
      try {
        const local = NOTE.noteFromParts({ ...parts, language:state.language, categories:noteCategories() });
        return noteFinishLocal(local, placement, selected, message, inputSnapshot, documentId, consumeInput);
      } catch (error) {
        if (inputSnapshot) releaseDirtyInput(inputSnapshot);
        hideAssist("note-failed");
        setStatus(String(error?.message || error));
        return false;
      }
    };
    smartSuggestRecent("accepted note");
    if (!hasSelectedAiConnection() || window.PENECHO_CONFIG?.runtime === "viewer") return finishLocal();
    const packed = packImage?.();
    if (!target.canvasInput && !packed) return finishLocal();
    let produced = false;
    noteCards.awaiting = { documentId, since:Date.now(), before:new Set((state.widgets || []).map(widget => widget.id)), placement };
    const options = {
      fromSuggestBar:Boolean(target.fromSuggestBar),
      suggestion:"note",
      ...(inputSnapshot ? { inputSnapshot } : {}),
      ...(target.canvasInput ? { question:noteCategoryHint(parts) } : { selectionQuestion:noteCategoryHint(parts) }),
      transformCommands:commands => { const out = noteTransformModelCommands(commands, parts, placement); produced = out.length > 0; return out; },
      onSettled:outcome => {
        if (produced && outcome?.completed) { if (inputSnapshot) releaseDirtyInput(inputSnapshot); noteWatchAccepted(); return; }
        noteCards.awaiting = null;
        if (outcome?.superseded || canvasDocumentsCurrent().id !== documentId) { if (inputSnapshot) releaseDirtyInput(inputSnapshot); return; }
        // A request stopped before it started leaves no working bar behind.
        if (outcome?.started === false && smartSuggest.bar?.action?.id !== "note") { if (inputSnapshot) releaseDirtyInput(inputSnapshot); return; }
        // A local fallback is not a successful AI request. Preserve its dirty
        // input even when the fallback card itself is committed.
        void finishLocal(state.selection === selection ? selection : null, noteCopy("Made a quick note card from the captured content.", "已根据所选内容生成快速笔记卡片。"), false);
      },
    };
    if (selection) requestSelectionAI("answer", selection, packed, options);
    else {
      if (!target.canvasInput) supersedeActiveAI("widget-note");
      let settled = false;
      const request = requestAI("answer", target.canvasInput ? null : packed, { ...options,
        ...(target.canvasInput ? assistRequestOptions(target) : { isolatedSelection:true, thinkingBox:{ ...parts.box } }),
        onSettled:outcome => { settled = true; options.onSettled(outcome); },
      }), generation = aiPreparationGeneration;
      target.requestPromise = request.finally(() => {
        if (!settled) options.onSettled({ completed:false, superseded:generation !== aiPreparationGeneration, started:false });
      });
    }
    return true;
  }
  async function noteFinishLocal(note, placement, selection, message = "", inputSnapshot = null, documentId = canvasDocumentsCurrent().id, consumeInput = true) {
    try {
      if (canvasDocumentsCurrent().id !== documentId) return false;
      if (selection && state.selection === selection) cancelSelection(true);
      hideAssist("note-created");
      const widget = await noteCardInsert(note, placement, { inputSnapshot:consumeInput ? inputSnapshot : null, documentId, inputGeneration:aiPreparationGeneration });
      if (!widget) return false;
      setStatus(message || noteCopy("Note card created. Pick a category or bookmark it.", "已创建笔记卡片，可选择分类或收藏。"));
      showNoteChooser(widget, { fresh:true });
      return true;
    } catch (error) { setStatus(String(error?.message || error)); return false; }
    finally { if (inputSnapshot) releaseDirtyInput(inputSnapshot); }
  }
  // A Canvas AI card arrives as a draft; when it is kept, offer the chooser.
  function noteWatchAccepted() {
    const awaiting = noteCards.awaiting;
    if (!awaiting) return;
    clearInterval(noteCards.awaitTimer);
    noteCards.awaitTimer = setInterval(() => {
      const current = noteCards.awaiting;
      if (!current || Date.now() - current.since > 10 * 60000 || canvasDocumentsCurrent().id !== current.documentId) { clearInterval(noteCards.awaitTimer); noteCards.awaiting = null; return; }
      if (state.pendingWidget && noteCardWidget(state.pendingWidget)) return;
      const widget = (state.widgets || []).find(item => noteCardWidget(item) && !current.before.has(item.id));
      clearInterval(noteCards.awaitTimer);
      noteCards.awaiting = null;
      if (!widget) return;
      noteCards.knownIds.add(widget.id);
      noteLibraryUpsertWidget(widget);
      showNoteChooser(widget, { fresh:true });
    }, 400);
  }
  // A blank card for the Tools menu and for typing a note by hand.
  async function insertBlankNoteCard() {
    const NOTE = noteCardRuntime(), now = Date.now();
    const note = NOTE.normalize({ title:noteCopy("Untitled note", "未命名笔记"), style:"note", category:"idea", blocks:[{ type:"markdown", text:noteCopy("Write here, or ask PenEcho to refine this card.", "在这里书写，或让 PenEcho 完善这张卡片。") }], created:now, updated:now, source:{ kind:"manual" } }, { categories:noteCategories(), language:state.language });
    const widget = await noteCardInsert(note, noteCardPlacement(null));
    showNoteChooser(widget, { fresh:true });
    return widget;
  }

  // ---------- The chooser: category, bookmark and look ----------
  function closeNoteChooser() {
    const chooser = noteCards.chooser;
    if (!chooser) return;
    noteCards.chooser = null;
    cancelAnimationFrame(chooser.frame);
    clearTimeout(chooser.timer);
    chooser.element.remove();
  }
  function noteChip(label, icon, className, onClick, title = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    if (icon) { const glyph = document.createElement("span"); glyph.className = "note-chip-icon"; glyph.setAttribute("aria-hidden", "true"); glyph.textContent = icon; button.append(glyph); }
    if (label) { const text = document.createElement("span"); text.textContent = label; button.append(text); }
    if (title) { button.title = title; button.setAttribute("aria-label", title); }
    button.addEventListener("pointerdown", event => event.stopPropagation());
    button.addEventListener("click", event => { event.stopPropagation(); onClick(event); });
    return button;
  }
  function showNoteChooser(widget, { fresh = false } = {}) {
    if (!widget || !noteCardWidget(widget)) return;
    closeNoteChooser();
    const layer = typeof penIntelLayer === "function" ? penIntelLayer() : null;
    if (!layer) return;
    const element = document.createElement("div");
    element.className = "note-chooser";
    element.setAttribute("role", "toolbar");
    element.setAttribute("aria-label", noteCopy("Note card", "笔记卡片"));
    element.addEventListener("pointerdown", event => event.stopPropagation());
    element.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); closeNoteChooser(); } });
    element.addEventListener("pointerenter", () => clearTimeout(noteCards.chooser?.timer));
    element.addEventListener("pointerleave", () => noteChooserIdle());
    layer.append(element);
    const chooser = { element, widget, frame:0, timer:0, reading:false, fresh };
    noteCards.chooser = chooser;
    renderNoteChooser();
    noteChooserTrack();
    noteChooserIdle(fresh ? 26000 : 18000);
    // Keep creation separate from the library's shared metadata ranking.
    chooser.reading = true;
    renderNoteChooser();
    void noteRankWidget(widget).then(signals => {
      const current = noteCards.chooser;
      if (current === chooser) chooser.reading = false;
      if (signals?.category) noteApplyAutoCategory(widget, signals);
      if (current === chooser) renderNoteChooser();
    });
  }
  function noteApplyAutoCategory(widget, signals) {
    const note = noteCardSource(widget), category = noteCategories().find(item => item.id === signals?.category);
    if (!note || !category || note.categorySource === "user" || (signals.categoryConfidence ?? 1) < 0.35) return false;
    if (note.category?.id === category.id && note.categorySource === "penecho-llm") return false;
    // A model-chosen category (Canvas AI, Agent, MCP) changes only on a clear read.
    if (note.categorySource === "model" && note.category && note.category.id !== category.id && (signals.categoryConfidence ?? 0) < 0.85) return false;
    noteSetCategory(widget, category.id, { quiet:true, source:"penecho-llm" });
    return true;
  }
  function noteChooserIdle(delay = 14000) {
    const chooser = noteCards.chooser;
    if (!chooser) return;
    clearTimeout(chooser.timer);
    chooser.timer = setTimeout(() => { if (noteCards.chooser === chooser && !chooser.element.matches(":hover, :focus-within")) closeNoteChooser(); }, delay);
  }
  function renderNoteChooser() {
    const chooser = noteCards.chooser;
    if (!chooser) return;
    const { element, widget } = chooser, note = noteCardSource(widget);
    if (!note || !state.widgets.includes(widget)) { closeNoteChooser(); return; }
    element.textContent = "";
    const head = document.createElement("span"), auto = note.category && note.categorySource !== "user";
    head.className = "note-chooser-label";
    head.textContent = chooser.reading && !note.category ? noteCopy("Category · PenEchoLLM is reading the card…", "分类 · PenEchoLLM 正在识别……")
      : auto ? noteCopy(`Category · set automatically${note.categorySource === "penecho-llm" ? " by PenEchoLLM" : note.categorySource === "model" ? " by Canvas AI" : ""} — tap to change`, `分类 · ${note.categorySource === "penecho-llm" ? "PenEchoLLM " : note.categorySource === "model" ? "Canvas AI " : ""}自动设置，点按可更改`)
      : noteCopy("Category", "分类");
    element.append(head);
    const chips = document.createElement("div");
    chips.className = "note-chooser-chips";
    for (const category of noteCategories()) {
      const active = note.category?.id === category.id,
        chip = noteChip(category.label, category.icon, `note-chip${active ? " active" : ""}${active && auto ? " auto" : ""}`, () => { noteSetCategory(widget, category.id); renderNoteChooser(); noteChooserIdle(); },
          active && auto ? noteCopy(`${category.label} · assigned automatically`, `${category.label} · 自动分配`) : category.label);
      chip.style.setProperty("--note-chip-color", category.color);
      chip.setAttribute("aria-pressed", String(active));
      chips.append(chip);
    }
    element.append(chips);
    const actions = document.createElement("div");
    actions.className = "note-chooser-actions";
    const bookmark = noteChip(note.bookmarked ? noteCopy("Bookmarked", "已收藏") : noteCopy("Bookmark", "收藏"), note.bookmarked ? "★" : "☆", `note-chip note-bookmark${note.bookmarked ? " active" : ""}`, () => { noteToggleBookmark(widget); renderNoteChooser(); });
    bookmark.setAttribute("aria-pressed", String(Boolean(note.bookmarked)));
    const look = noteChip(note.style === "card" ? noteCopy("Knowledge card", "知识卡片") : noteCopy("Work note", "工作笔记"), note.style === "card" ? "◆" : "▤", "note-chip note-look", () => { noteCardUpdate(widget, value => { value.style = value.style === "card" ? "note" : "card"; value.styleChosen = true; }); renderNoteChooser(); },
      noteCopy("Switch between knowledge card and work note", "在知识卡片与工作笔记之间切换"));
    const library = noteChip(noteCopy("Library", "笔记库"), "▦", "note-chip note-open-library", () => { closeNoteChooser(); void openNoteLibrary({ focusId:noteLibraryId(canvasDocumentsCurrent().id, widget.id) }); });
    const done = noteChip("", "×", "note-chip note-close", () => closeNoteChooser(), noteCopy("Close", "关闭"));
    const entry = noteCards.entries?.find(item => item.id === noteLibraryId(canvasDocumentsCurrent().id, widget.id)), included = Boolean(entry && entry.saved !== false),
      saved = included && !entry.storage?.pending && Boolean(entry.storage?.server || entry.storage?.cloud === "saved"),
      backup = noteChip(saved ? noteCopy("Saved to Notes & Cards", "已保存到 Notes & Cards") : included ? noteCopy("Saving to Notes & Cards…", "正在保存到 Notes & Cards……") : noteCopy("Save to Notes & Cards", "保存到 Notes & Cards"), "▦", "note-chip", () => void noteLibrarySaveWidget(widget),
        noteCopy("Keep an independent backup that remains available after this Canvas closes", "独立保存；关闭或删除画布后仍可浏览"));
    backup.setAttribute("aria-pressed", String(saved));
    actions.append(bookmark, look, backup, library, done);
    element.append(actions);
  }
  function noteChooserTrack() {
    const chooser = noteCards.chooser;
    if (!chooser) return;
    const step = () => {
      if (noteCards.chooser !== chooser) return;
      if (!state.widgets.includes(chooser.widget) || canvasDocumentsCurrent().id && chooser.documentId && chooser.documentId !== canvasDocumentsCurrent().id) { closeNoteChooser(); return; }
      const screen = assistScreenBox(widgetBox(chooser.widget)), { width, height } = canvasViewportMetrics(), element = chooser.element;
      if (screen) {
        const now = performance.now(), navigation = chooser.navigation, previous = chooser.placement,
          changed = navigation && (navigation.width !== width || navigation.height !== height
            || ["x", "y", "w", "h"].some(key => navigation.screen[key] !== screen[key])),
          interacting = Boolean(state.drawing || state.panGesture || state.touchGesture || state.widgetGesture
            || state.imageGesture || state.animationGesture || state.selectionGesture || state.pendingGesture),
          until = changed || interacting ? now + ASSIST_NAVIGATION_SETTLE_MS : navigation?.until || 0,
          moving = interacting || now < until;
        chooser.navigation = { screen, width, height, until };
        // Wrap the existing controls into a usable side column when the full
        // toolbar would overlap a centered card. Narrow screens keep full width.
        // Keep its wrapping stable during input, and avoid forcing layout by
        // writing the same width before measuring it on every animation frame.
        const sideWidth = Math.max(screen.x - 24, width - screen.x - screen.w - 24),
          nextWidth = Math.floor(Math.min(560, sideWidth >= 300 ? sideWidth : width - 16)),
          targetWidth = moving && navigation?.width === width && chooser.width != null ? chooser.width : nextWidth;
        if (chooser.width !== targetWidth) { element.style.width = `${targetWidth}px`; chooser.width = targetWidth; }
        const w = element.offsetWidth || 420, h = element.offsetHeight || 80;
        // Beside the card first, clear of the floating tool dock at the bottom.
        const top = 12, bottom = height - 84, gap = 16,
          spots = [{ x:screen.x + screen.w + gap, y:screen.y + 12 }, { x:screen.x - w - gap, y:screen.y + 12 }, { x:screen.x + screen.w / 2 - w / 2, y:screen.y - h - gap }, { x:screen.x + screen.w / 2 - w / 2, y:screen.y + screen.h + gap }],
          fits = spot => spot.x >= 8 && spot.x + w <= width - 8 && spot.y >= top && spot.y + h <= bottom,
          fallback = spots.find(fits) || { x:screen.x + screen.w / 2 - w / 2, y:Math.min(bottom - h, screen.y + screen.h + gap) };
        let point = fallback;
        if (moving) {
          // Follow the card during pan, zoom and dragging without reading ink
          // pixels or searching every viewport position on the input path.
          if (previous) {
            const ratio = state.scale / previous.scale;
            point = { x:screen.x + (previous.point.x - previous.screen.x) * ratio,
              y:screen.y + (previous.point.y - previous.screen.y) * ratio };
          }
        } else {
          const mask = assistContentMask(width, height),
            spot = spots.find(spot => fits(spot) && !assistOccupiedArea(mask, spot.x, spot.y, w, h)) || fallback,
            key = JSON.stringify([w, h, screen, spot]);
          // Reuse the complete placement until content or layout changes.
          if (previous?.mask !== mask || previous.key !== key) chooser.placement = {
            mask, key, screen, scale:state.scale, point:assistFindPlacement(mask, w, h, spot, screen, { inkGap:0 }),
          };
          point = chooser.placement.point;
        }
        const x = Math.round(Math.max(8, Math.min(width - w - 8, point.x))),
          y = Math.round(Math.max(top, Math.min(bottom - h, point.y)));
        if (chooser.screenX !== x) { element.style.setProperty("--note-x", `${x}px`); chooser.screenX = x; }
        if (chooser.screenY !== y) { element.style.setProperty("--note-y", `${y}px`); chooser.screenY = y; }
      }
      chooser.frame = requestAnimationFrame(step);
    };
    chooser.documentId = canvasDocumentsCurrent().id;
    step();
  }
  function noteSetCategory(widget, id, { quiet = false, source = "user" } = {}) {
    const category = noteCategories().find(item => item.id === id);
    if (!category) return;
    noteCardUpdate(widget, note => {
      const NOTE = noteCardRuntime(), previous = note.category?.id;
      note.category = NOTE.normalizeCategory({ id:category.id, label:category.label, color:category.color, icon:category.icon }, { categories:noteCategories() });
      note.categorySource = source;
      // A card follows its category's look until the person picks a look.
      if (!note.styleChosen && (!previous || NOTE.categoryById(previous, noteCategories())?.style === note.style)) note.style = category.style || note.style;
    });
    if (!quiet) setStatus(noteCopy(`Category: ${category.label}`, `分类：${category.label}`));
  }
  function noteToggleBookmark(widget) {
    let bookmarked = false;
    noteCardUpdate(widget, note => { note.bookmarked = !note.bookmarked; bookmarked = note.bookmarked; if (!bookmarked) delete note.bookmarked; });
    setStatus(bookmarked ? noteCopy("Bookmarked", "已收藏") : noteCopy("Bookmark removed", "已取消收藏"));
  }
  // Object toolbar entries for a selected card.
  function noteCardToolbarItems(widget) {
    if (!noteCardWidget(widget)) return [];
    const note = noteCardSource(widget), entry = noteCards.entries?.find(item => item.id === noteLibraryId(canvasDocumentsCurrent().id, widget.id));
    return [
      { key:`widget:${widget.id}:note-category`, kind:"notecategory", label:noteCopy("Category and look", "分类与样式"), baseWidth:28, iconOnly:true, activate:() => showNoteChooser(widget) },
      { key:`widget:${widget.id}:note-bookmark`, kind:"notebookmark", label:note?.bookmarked ? noteCopy("Remove bookmark", "取消收藏") : noteCopy("Bookmark note", "收藏笔记"), baseWidth:28, iconOnly:true, pressed:Boolean(note?.bookmarked), activate:() => noteToggleBookmark(widget) },
      { key:`widget:${widget.id}:note-library`, kind:"notelibrary", label:noteCopy("Notes library", "笔记库"), baseWidth:28, iconOnly:true, activate:() => void openNoteLibrary({ focusId:noteLibraryId(canvasDocumentsCurrent().id, widget.id) }) },
      ...(entry?.saved === false ? [{ key:`widget:${widget.id}:note-save`, kind:"notelibrary", label:noteCopy("Save to Notes & Cards", "保存到 Notes & Cards"), baseWidth:28, iconOnly:true, activate:() => void noteLibrarySaveWidget(widget) }] : []),
    ];
  }

  // ---------- Independent library snapshots and browser recovery cache ----------
  function noteLibraryId(documentId, widgetId) {
    const widget = (state.widgets || []).find(item => item.id === widgetId);
    return noteCardSource(widget)?.libraryId || `${documentId}:${widgetId}`;
  }
  function noteLibraryApi(id = "") {
    const root = window.PENECHO_CONFIG?.runtime === "cloud" ? "/api/v1/notes" : "/api/notes";
    return `${root}${id ? `/${encodeURIComponent(id)}` : ""}`;
  }
  async function noteLibraryFetch(url, options = {}) {
    const response = await fetch(url, { credentials:"same-origin", ...options,
      headers:authenticatedApiHeaders({ "Content-Type":"application/json", Accept:"application/json", ...(options.headers || {}) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(Error(data.error || data.message || "Notes & Cards could not be saved."), {status:response.status});
    return data;
  }
  async function noteLibraryBindAccount() {
    if(window.PENECHO_CONFIG?.runtime!=="cloud")return;
    const session=await noteLibraryFetch("/api/v1/auth/session");
    noteLibrarySetAccount(session.account?.id||"anonymous");
  }
  function noteLibrarySetAccount(id) {
    if (noteCards.accountId !== id) {
      const revoke = noteCards.accountId !== null;
      noteCards.entries = []; noteCards.loading = null; noteCards.entryLoads.clear(); noteCards.loadedIds.clear();
      noteCards.pageCache.clear(); noteCards.lastView = null; noteCards.total = null; noteCards.dirty.clear(); noteCards.rankKey = "";
      noteCards.review = null;
      if (revoke) noteCards.reader?.close();
      const panel = noteCards.panel;
      if (panel) {
        panel.page.ids = []; panel.tiles?.clear();
        if (revoke) panel.selectedId = panel.focusId = "";
        panel.page.total = panel.page.totalSaved = null; panel.page.categories = []; panel.page.tags = [];
        panel.count.textContent = ""; panel.categoryNav?.replaceChildren(); panel.tagNav?.replaceChildren();
        panel.grid.replaceChildren(); panel.detail.hidden = true;
      }
    }
    noteCards.accountId = id;
  }
  function noteLibraryDb(accountId = noteCards.accountId) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(NOTE_LIBRARY_DB+(window.PENECHO_CONFIG?.runtime==="cloud"?`:${accountId||"anonymous"}`:""), 2);
      request.onupgradeneeded = event => {
        for (const store of [NOTE_LIBRARY_STORE, NOTE_LIBRARY_PAGE_STORE]) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath:"id" });
        const notes = request.transaction.objectStore(NOTE_LIBRARY_STORE);
        if (!notes.indexNames.contains(NOTE_LIBRARY_PENDING_INDEX)) notes.createIndex(NOTE_LIBRARY_PENDING_INDEX, "cachePending");
        // Migrate the existing recovery copies once; later opens read only the
        // indexed outbox instead of scanning every source and preview.
        if (event.oldVersion === 1) {
          const cursor = notes.openCursor();
          cursor.onsuccess = () => { const row = cursor.result; if (row) { row.update({...row.value,cachePending:row.value.localDirty ? 1 : 0}); row.continue(); } };
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("Notes library storage is unavailable."));
    });
  }
  async function noteLibraryLoad(id = "") {
    await noteLibraryBindAccount();
    noteCards.entries ||= [];
    // Canvas saves recover only their own card, never the entire library.
    if (!id || noteCards.loadedIds.has(id) || noteCards.entries.some(entry => entry.id === id)) return noteCards.entries;
    if (!noteCards.entryLoads.has(id)) {
      const accountId = noteCards.accountId;
      const pending = (async () => {
        let cached = null;
        try {
          const db = await noteLibraryDb(accountId);
          try { cached = await requestResult(db.transaction(NOTE_LIBRARY_STORE, "readonly").objectStore(NOTE_LIBRARY_STORE).get(id)); }
          finally { db.close(); }
        } catch {}
        let entry = cached;
        try {
          const result = await noteLibraryFetch(noteLibraryApi(id));
          if (!cached?.localDirty) entry = result.note || { ...result.entry, version:result.version, storage:{server:false,cloud:"saved"} };
        } catch (error) { if (error.status === 404 && !cached?.localDirty) entry = null; }
        if (accountId !== noteCards.accountId) return;
        if (entry && !noteCards.entries.some(item => item.id === id)) noteCards.entries.push(entry);
        if (entry?.localDirty) { noteCards.dirty.add(id); void noteLibraryPersist().catch(() => {}); }
        noteCards.loadedIds.add(id);
      })().finally(() => { if (accountId === noteCards.accountId) noteCards.entryLoads.delete(id); });
      noteCards.entryLoads.set(id, pending);
    }
    await noteCards.entryLoads.get(id);
    return noteCards.entries;
  }
  function noteLibraryPersistSoon() {
    void noteLibraryPersist().catch(error => {
      setStatus(noteCopy("Notes & Cards backup is pending. Keep PenEcho open and retry when the service is available.", "Notes & Cards 尚未完成备份，请保留 PenEcho，并在服务恢复后重试。"));
      debug("note-library-save-failed", {error:String(error.message).slice(0,160)});
    });
  }
  async function noteLibraryRecoverPending() {
    const panel = noteCards.panel, accountId = noteCards.accountId;
    if (!panel) return;
    let pending = [];
    try {
      const db = await noteLibraryDb(accountId);
      try {
        pending = await requestResult(db.transaction(NOTE_LIBRARY_STORE,"readonly").objectStore(NOTE_LIBRARY_STORE).index(NOTE_LIBRARY_PENDING_INDEX).getAll(1));
      } finally { db.close(); }
    } catch { return; }
    if (noteCards.panel !== panel || noteCards.accountId !== accountId || !pending.length) return;
    const entries = new Map(noteCards.entries.map(entry => [entry.id,entry]));
    for (const entry of pending) {
      if (!entries.get(entry.id)?.localDirty) entries.set(entry.id,entry);
      noteCards.dirty.add(entry.id);
    }
    noteCards.entries = [...entries.values()];
    // A new offline snapshot may not appear in any server page yet. Retry the
    // outbox only when its library opens, then refresh the bounded first page.
    void noteLibraryPersist().catch(() => {}).finally(() => {
      if (noteCards.panel === panel && noteCards.accountId === accountId) void noteLibraryRequestPage({reset:true});
    });
  }
  async function noteLibraryCachePut(entry, accountId = noteCards.accountId) {
    const db = await noteLibraryDb(accountId);
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(NOTE_LIBRARY_STORE, "readwrite"), store = tx.objectStore(NOTE_LIBRARY_STORE);
        store.put({...entry,cachePending:entry.localDirty ? 1 : 0});
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  function noteLibraryPersist() {
    if (noteCards.persist) return noteCards.persist;
    noteCards.persist = (async () => {
      const failed = new Set(); let failure;
      while (noteCards.entries && [...noteCards.dirty].some(id => !failed.has(id))) {
        const id = [...noteCards.dirty].find(id => !failed.has(id)), current = noteCards.entries.find(entry => entry.id === id);
        if (!current) { noteCards.dirty.delete(id); continue; }
        const entry = noteCardRuntime().libraryEntry(current), snapshot = JSON.stringify(entry), accountId=noteCards.accountId;
        // Attempt recovery caching independently: a failed browser quota must
        // not prevent the complete snapshot from reaching the server.
        await noteLibraryCachePut(current,accountId).catch(() => {});
        const body = JSON.stringify({ entry, expectedVersion:current.version || 0, ...(window.PENECHO_CONFIG?.runtime==="cloud"?{accountId}:{}) });
        let result;
        try { result = await noteLibraryFetch(noteLibraryApi(id), { method:"PUT", body, ...(body.length < 60000 ? {keepalive:true} : {}) }); }
        catch (error) {
          current.storage = { ...(current.storage || {}), pending:true, ...(error.status === 409 ? {cloud:"conflict"} : {}) }; noteLibraryRender();
          if (error.status !== 409) throw error;
          failed.add(id); failure = error; continue;
        }
        if(accountId!==noteCards.accountId)continue;
        const saved = result.note || { ...result.entry, version:result.version, storage:{server:false,cloud:"saved"} }, latest = noteCards.entries.find(item => item.id === id);
        if (!latest) continue;
        latest.version = saved.version;
        if (JSON.stringify(noteCardRuntime().libraryEntry(latest)) === snapshot) {
          latest.localDirty = false; latest.storage = saved.storage; noteCards.dirty.delete(id);
        }
        await noteLibraryCachePut(latest,accountId).catch(() => {});
        if (noteCards.chooser && noteLibraryId(canvasDocumentsCurrent().id, noteCards.chooser.widget.id) === id) renderNoteChooser();
        if (noteCards.panel) noteLibraryRender();
      }
      if (failure) throw failure;
    })().finally(() => { noteCards.persist = null; });
    return noteCards.persist;
  }
  async function noteLibraryRefreshServer() {
    if (noteCards.panel) await noteLibraryRequestPage({ reset:true });
  }
  function noteLibraryDocument() {
    if (typeof canvasIndexDocument === "function") return canvasIndexDocument();
    const doc = canvasDocumentsCurrent();
    return { documentId:doc.id, documentTitle:doc.title || noteCopy("Untitled Canvas", "未命名画布"), locator:doc.locator || null };
  }
  function noteLibraryPut(entry) {
    if (!noteCards.entries) return;
    const index = noteCards.entries.findIndex(item => item.id === entry.id);
    if (index >= 0) noteCards.entries[index] = entry;
    else noteCards.entries.unshift(entry);
    entry.localDirty = true;
    entry.storage = { ...(entry.storage || {}), pending:true };
    noteCards.dirty.add(entry.id);
    noteLibraryPersistSoon();
  }
  async function noteLibraryUpsertWidget(widget, { restore = false, document:documentInfo = null, sourceChanged = false } = {}) {
    if (window.PENECHO_CONFIG?.runtime === "viewer") return;
    const NOTE = noteCardRuntime(), note = noteCardSource(widget);
    if (!NOTE || !note) return;
    const doc = documentInfo || noteLibraryDocument(), id = note.libraryId || `${doc.documentId}:${widget.id}`, digest = NOTE.digest(note),
      changed = sourceChanged || widget.noteObservedDigest && widget.noteObservedDigest !== digest;
    widget.noteObservedDigest = digest;
    await noteLibraryLoad(id);
    const previous = noteCards.entries.find(entry => entry.id === id);
    if (previous?.saved === false && !restore) return;
    if (previous && !changed && previous.digest !== digest && (note.updated || 0) < (previous.updatedAt || 0) && !restore) return;
    if (previous && previous.saved !== false && previous.digest === digest && previous.documentTitle === doc.documentTitle && previous.box?.x === widget.x && previous.box?.y === widget.y && previous.box?.w === widget.w) return;
    noteLibraryPut({
      ...(previous || {}), id, ...doc, objectId:widget.id, note, saved:true, digest:NOTE.digest(note),
      box:widgetBox(widget), createdAt:previous?.createdAt || note.created || Date.now(), updatedAt:changed ? Date.now() : previous?.updatedAt || note.updated || Date.now(),
      // Metadata changes invalidate the shared ranking result.
      llm:previous?.digest === digest ? previous.llm : previous?.llm ? { ...previous.llm, stale:true } : null,
      thumb:previous?.digest === digest ? previous.thumb : previous?.thumb || "",
    });
    if (state.widgets.includes(widget)) noteCardThumbSoon(widget);
  }
  // A Canvas can update linked snapshots, but cannot delete them by omission.
  async function noteLibrarySyncCurrent() {
    if (!(state.widgets || []).some(noteCardWidget)) return;
    await noteLibraryLoad();
    const doc = noteLibraryDocument(), seen = new Set();
    for (const widget of state.widgets || []) {
      if (!noteCardWidget(widget)) continue;
      seen.add(noteLibraryId(doc.documentId, widget.id));
      noteCards.knownIds.add(widget.id);
      const entry = noteCards.entries.find(item => item.id === noteLibraryId(doc.documentId, widget.id));
      // A bookmark changed in the library while this Canvas was closed.
      if (entry?.pendingBookmark !== undefined) {
        const wanted = entry.pendingBookmark;
        delete entry.pendingBookmark;
        if (Boolean(noteCardSource(widget)?.bookmarked) !== wanted) noteCardUpdate(widget, note => { if (wanted) note.bookmarked = true; else delete note.bookmarked; });
      }
      if (entry?.pendingCategory) {
        const pending = entry.pendingCategory, note = noteCardSource(widget);
        delete entry.pendingCategory;
        if (note && (pending.source === "user" || note.categorySource !== "user")) noteSetCategory(widget, pending.id, { quiet:true, source:pending.source });
      }
      await noteLibraryUpsertWidget(widget);
    }
  }
  // Render library previews from the saved source, independently of the open
  // Canvas and its scroll position. Old previews migrate as they become visible.
  function noteCardThumbSoon(widget) {
    clearTimeout(widget.noteThumbTimer);
    widget.noteThumbTimer = setTimeout(() => void noteCardThumb(widget), 1600);
  }
  function noteThumbKey(entry) {
    const NOTE = noteCardRuntime();
    return `${NOTE.digest(entry.note)}:${NOTE.LOOK}:preview-900-webp96-v3:${noteCardMathRenderer() ? "math" : "plain"}`;
  }
  async function noteLibrarySnapshot(note) {
    const NOTE = noteCardRuntime(), html = noteCardDocument(note), frame = document.createElement("iframe"),
      hostUrl = widgetHostUrl({ id:"general", connect:[] }), hostOrigin = new URL(hostUrl).origin,
      requestId = `note-preview-${canvasClientId()}`;
    frame.title = note.title;
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.inert = true;
    Object.assign(frame.style, { position:"fixed", left:"-20000px", top:"0", width:`${NOTE.CONTENT.w}px`, height:`${NOTE.CONTENT.h}px`, border:"0", pointerEvents:"none" });
    let receive, timer;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        let requested = false;
        receive = event => {
          if (event.source !== frame.contentWindow || event.origin !== hostOrigin) return;
          const message = event.data;
          if (message?.type === "penecho-widget-host-ready") {
            frame.contentWindow.postMessage({ type:"penecho-widget-init", html, title:note.title, sourceFormat:NOTE.FORMAT, language:state.language }, hostOrigin);
            frame.contentWindow.postMessage({ type:"penecho-widget-state", active:true, selected:false, interactive:false, maximized:false, scaleX:1, scaleY:1 }, hostOrigin);
          } else if (message?.type === "penecho-widget-capture-ready" && !requested) {
            requested = true;
            frame.contentWindow.postMessage({ type:"penecho-widget-snapshot-request", requestId, width:NOTE.CONTENT.w, height:NOTE.CONTENT.h, waitForViewport:true, timeoutMs:10000 }, hostOrigin);
          } else if (message?.requestId === requestId && message.type === "penecho-widget-snapshot") {
            if (message.width !== NOTE.CONTENT.w || message.height !== NOTE.CONTENT.h || typeof message.dataUrl !== "string"
              || !message.dataUrl.startsWith("data:image/png;base64,") || message.dataUrl.length > 24 * 1024 * 1024) reject(Error("Invalid note preview snapshot."));
            else resolve(message.dataUrl);
          } else if (message?.requestId === requestId && message.type === "penecho-widget-snapshot-error") reject(Error(message.error || "Note preview capture failed."));
        };
        timer = setTimeout(() => reject(Error("Note preview capture timed out.")), 15000);
        window.addEventListener("message", receive);
        frame.src = hostUrl;
        document.body.append(frame);
      });
      return await decodeWidgetSnapshot(dataUrl);
    } finally {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      frame.remove();
    }
  }
  async function noteEncodeThumbnail(image) {
    let canvas = offscreen(NOTE_THUMB_W, Math.round(NOTE_THUMB_W * noteCardRuntime().ASPECT));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const maxBytes = Math.floor((NOTE_THUMB_MAX_CHARS - 40) * 3 / 4),
      encode = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
    // Prefer quality-0.96 WebP for both text and image previews. Preserve full
    // resolution through bounded encodings before reducing pixels as a last resort.
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const type of ["image/webp", "image/jpeg"]) for (const quality of [0.96, 0.9, 0.84]) {
        const blob = await encode(type, quality);
        if (blob && blob.type === type && blob.size <= maxBytes) return canvasAgentReadDataUrl(blob);
      }
      const next = offscreen(Math.round(canvas.width * 0.8), Math.round(canvas.height * 0.8));
      next.getContext("2d").imageSmoothingQuality = "high";
      next.getContext("2d").drawImage(canvas, 0, 0, next.width, next.height);
      canvas = next;
    }
    throw Error("Note preview exceeds the encoded size limit.");
  }
  function noteLibraryThumb(entry, { force = false } = {}) {
    if (!entry || entry.saved === false || window.PENECHO_CONFIG?.runtime === "viewer") return Promise.resolve("");
    const accountId = noteCards.accountId, key = noteThumbKey(entry), taskKey = JSON.stringify([accountId, entry.id, key]);
    if (entry.thumb && entry.thumbDigest === key && !force) return Promise.resolve(entry.thumb);
    if (noteCards.thumbTasks.has(taskKey)) return noteCards.thumbTasks.get(taskKey);
    const currentEntry = () => noteCards.accountId === accountId ? noteCards.entries?.find(item => item.id === entry.id && item.saved !== false && noteThumbKey(item) === key) : null;
    const task = noteCards.thumbQueue.then(async () => {
      const current = currentEntry();
      if (!current) return "";
      if (current.thumb && current.thumbDigest === key && !force) return current.thumb;
      const image = await noteLibrarySnapshot(structuredClone(current.note)), thumb = await noteEncodeThumbnail(image), latest = currentEntry();
      // Edits, deletion and account changes while rendering invalidate this job.
      if (!latest) return "";
      latest.thumb = thumb;
      latest.thumbDigest = key;
      noteLibraryPut(latest);
      if (noteCards.panel) noteLibraryRender();
      return thumb;
    }).catch(error => {
      debug("note-card-thumb-failed", { error:String(error?.message || error).slice(0, 160) });
      return "";
    }).finally(() => noteCards.thumbTasks.delete(taskKey));
    noteCards.thumbTasks.set(taskKey, task);
    noteCards.thumbQueue = task;
    return task;
  }
  async function noteCardThumb(widget, { force = false } = {}) {
    if (!noteCards.entries || !state.widgets.includes(widget)) return "";
    const doc = noteLibraryDocument(), entry = noteCards.entries.find(item => item.id === noteLibraryId(doc.documentId, widget.id));
    return noteLibraryThumb(entry, { force });
  }

  // ---------- PenEchoLLM ranking ----------
  function noteLibraryHasFilters(query = noteCards.panel?.input.value || "") {
    return Boolean(String(query || "").trim() || noteCards.panel?.category || noteCards.panel?.tag || noteCards.panel?.bookmarked);
  }
  // One text-only request evaluates bounded library candidates. Question ids map
  // to the immutable request snapshot, so edits during inference cannot receive
  // stale scores. Images remain presentation assets only.
  async function noteRankLibrary(query = "", { background = true } = {}) {
    const NOTE = noteCardRuntime(), key = String(query || "").trim().toLowerCase();
    if (!noteLibraryHasFilters(key)) return;
    await noteCards.panel?.page?.pending;
    if (noteCards.panel?.page && key !== String(noteCards.panel.input.value || "").trim().toLowerCase()) return;
    if (!NOTE || !noteCards.entries || typeof penechoLLMRequest !== "function" || !penIntelRemote()) return;
    if (noteCards.rankBusy) { noteCards.rankAgain = true; return; }
    const visibleIds = noteCards.panel?.page?.ids,
      entries = NOTE.rankCandidates(visibleIds ? noteCards.entries.filter(entry => visibleIds.includes(entry.id)) : noteCards.entries,key),
      metadata = entries.map(entry => NOTE.rankMetadata(entry));
    if (!metadata.length) return;
    const rankKey = JSON.stringify({ query:key, day:Math.floor(Date.now()/86400000), notes:metadata });
    if (noteCards.rankKey === rankKey) return;
    noteCards.rankBusy = true;
    try {
      const answers = await penechoLLMRequest("note_rank", null, {notes:metadata, ...(key ? {query:key.slice(0,160)} : {})}, {background});
      if (!answers) return;
      for (let index = 0; index < entries.length; index++) {
        const priority = answers[`note_${index}`]?.noul, current = noteCards.entries.find(entry => entry.id === entries[index].id);
        if (!current || current.saved === false || !Number.isFinite(priority) || priority < 0 || priority > 1
          || JSON.stringify(NOTE.rankMetadata(current)) !== JSON.stringify(metadata[index])) continue;
        current.llm = { ...(current.llm || {}), stale:false, basis:"metadata", digest:current.digest, at:Date.now(),
          ...(key ? {relevance:{...(current.llm?.relevance || {}), [key]:priority}} : {priority}) };
        noteLibraryPut(current);
      }
      noteCards.rankKey = rankKey;
      noteLibraryRender();
    } finally {
      noteCards.rankBusy = false;
      if (noteCards.rankAgain) { noteCards.rankAgain = false; void noteRankLibrary(noteCards.panel?.input.value || ""); }
    }
  }
  async function noteRankWidget(widget) {
    await noteLibraryUpsertWidget(widget);
    // Creation already has a category from its source. Library ranking is
    // shared across cards and only requested while filters are active.
    return noteCards.entries?.find(entry => entry.id === noteLibraryId(canvasDocumentsCurrent().id, widget.id))?.llm || null;
  }
  async function noteRankPending() { return noteRankLibrary(); }
  // Library reads also assign categories the person has not chosen. Cards on
  // a closed Canvas receive the category when that Canvas opens.
  function noteLibraryAutoCategory(entry, signals) {
    if (!signals?.category) return;
    const widget = entry.documentId === canvasDocumentsCurrent().id ? (state.widgets || []).find(item => item.id === entry.objectId && noteCardWidget(item)) : null;
    if (widget) { noteApplyAutoCategory(widget, signals); return; }
    const current = noteCards.entries.find(item => item.id === entry.id), category = noteCategories().find(item => item.id === signals.category);
    if (!current || !category || current.note.categorySource === "user" || current.note.category?.id === category.id || (signals.categoryConfidence ?? 1) < 0.35) return;
    if (current.note.categorySource === "model" && current.note.category && (signals.categoryConfidence ?? 0) < 0.85) return;
    current.note = { ...current.note, category:noteCardRuntime().normalizeCategory(category, { categories:noteCategories() }), categorySource:"penecho-llm" };
    current.pendingCategory = { id:category.id, source:"penecho-llm" };
    noteLibraryPut(current);
  }
  function noteLibrarySetCategory(entry, id) {
    const widget = entry.documentId === canvasDocumentsCurrent().id ? (state.widgets || []).find(item => item.id === entry.objectId && noteCardWidget(item)) : null;
    if (widget) { noteSetCategory(widget, id); return; }
    const current = noteCards.entries.find(item => item.id === entry.id), category = noteCategories().find(item => item.id === id);
    if (!current || !category) return;
    current.note = { ...current.note, category:noteCardRuntime().normalizeCategory(category, { categories:noteCategories() }), categorySource:"user" };
    current.pendingCategory = { id, source:"user" };
    noteLibraryPut(current);
    noteLibraryRender();
  }
  async function noteRankQuery(query) {
    noteCards.relevanceKey = String(query || "").trim().toLowerCase();
    return noteRankLibrary(query, {background:false});
  }

  // ---------- The Notes library ----------
  // The Notes view lives in the Library, beside Recent and Favorites. Without
  // a Library (the read-only viewer) it opens as a floating panel instead.
  function noteLibraryHost() {
    const library = document.getElementById("historyPanel"), view = document.getElementById("historyNotesView");
    return library && view ? { library, view, nav:document.getElementById("historyNotesNav") } : null;
  }
  function closeNoteLibrary({ library = false } = {}) {
    const panel = noteCards.panel;
    if (!panel) return;
    noteLibraryCachePage(panel);
    noteCards.panel = null;
    panel.page?.controller?.abort();
    noteCards.review = null;
    document.querySelector(".note-remove-dialog")?.close();
    panel.thumbObserver?.disconnect();
    panel.reviewCleanup?.();
    panel.categorySidebar?.remove();
    panel.tagSidebar?.remove();
    panel.element.remove();
    const host = noteLibraryHost();
    if (panel.embedded && host) {
      if (host.library.dataset.libraryView === "notes") delete host.library.dataset.libraryView;
      host.view.hidden = true;
      host.nav?.setAttribute("aria-current", "false");
      updateHistoryNavigation();
      if (library && host.library.classList.contains("open") && typeof closeHistoryPanel === "function") closeHistoryPanel();
    }
  }
  // Library wiring: sidebar entry, other destinations, and closing.
  function noteLibraryWire() {
    const host = noteLibraryHost();
    if (!host || host.library.dataset.notesWired) return;
    host.library.dataset.notesWired = "1";
    host.nav?.addEventListener("click", () => void openNoteLibrary());
    host.library.querySelector(".history-library-sidebar")?.addEventListener("click", event => {
      if (noteCards.panel?.embedded && event.target?.closest?.(".shell-library-link:not(#historyNotesNav), .snapshot-location-options label, .history-project-nav-item, #historyProjectCreate")) closeNoteLibrary();
    });
    new MutationObserver(() => {
      if (noteCards.panel?.embedded && (!host.library.classList.contains("open") || host.library.dataset.libraryView !== "notes")) closeNoteLibrary();
    }).observe(host.library, { attributes:true, attributeFilter:["class", "data-library-view"] });
    noteLibraryCount();
  }
  function noteLibraryCount() {
    const count = document.getElementById("historyNotesCount"), total = noteCards.total ?? noteCards.entries?.filter(entry => entry.saved !== false).length ?? 0;
    if (!count) return;
    count.hidden = !total;
    count.textContent = total ? String(total) : "";
  }
  function noteLibraryViewKey(panel) {
    return JSON.stringify([panel.input.value, panel.sort.value, panel.category, panel.tag || "", panel.bookmarked]);
  }
  function noteLibraryPageInfo(page) {
    const { ids, nextOffset, total, totalSaved, categories, categoryTotal, tags, tagTotal, dueCount } = page;
    return { ids:ids.slice(), nextOffset, total, totalSaved, categories:categories || [], categoryTotal, tags:tags || [], tagTotal, dueCount };
  }
  function noteLibraryCachePage(panel = noteCards.panel) {
    if (!panel || panel.initializing || panel.page.total == null || !panel.page.key) return;
    const key = panel.page.key, accountId = noteCards.accountId,
      cached = { id:key, page:noteLibraryPageInfo(panel.page), scrollTop:panel.grid.scrollTop, selectedId:panel.selectedId, updatedAt:Date.now() };
    noteCards.pageCache.delete(key); noteCards.pageCache.set(key, cached); noteCards.lastView = key;
    while (noteCards.pageCache.size > NOTE_LIBRARY_CACHE_VIEWS) noteCards.pageCache.delete(noteCards.pageCache.keys().next().value);
    // Persist a bounded set of view IDs, together with their complete sources
    // and previews. Restoring a view reads only its cached IDs.
    const persisted = { ...cached, page:{ ...cached.page, ids:cached.page.ids.slice(0, NOTE_LIBRARY_CACHE_ROWS) } };
    if (cached.page.ids.length > persisted.page.ids.length) {
      persisted.page.nextOffset = persisted.page.ids.length;
      persisted.scrollTop = 0;
    }
    const entries = persisted.page.ids.map(id => noteCards.entries.find(entry => entry.id === id)).filter(Boolean);
    noteCards.cachePersist = noteCards.cachePersist.catch(() => {}).then(async () => {
      const db = await noteLibraryDb(accountId);
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction([NOTE_LIBRARY_STORE, NOTE_LIBRARY_PAGE_STORE], "readwrite"), pages = tx.objectStore(NOTE_LIBRARY_PAGE_STORE);
          const notes = tx.objectStore(NOTE_LIBRARY_STORE);
          for (const entry of entries) {
            const read = notes.get(entry.id);
            read.onsuccess = () => {
              if (!read.result || !read.result.localDirty && (read.result.version || 0) <= (entry.version || 0)) notes.put({...entry,cachePending:entry.localDirty ? 1 : 0});
            };
          }
          pages.put(persisted); pages.put({id:"last", key});
          const request = pages.getAll();
          request.onsuccess = () => {
            const views = request.result.filter(view => view.id !== "last" && view.id !== key).sort((a,b) => b.updatedAt - a.updatedAt);
            for (const stale of views.slice(NOTE_LIBRARY_CACHE_VIEWS - 1)) pages.delete(stale.id);
          };
          tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    }).catch(() => {});
  }
  async function noteLibraryRestorePage(panel, { last = false } = {}) {
    const accountId = noteCards.accountId, generation = panel.page.generation, originalKey = noteLibraryViewKey(panel);
    let key = last ? noteCards.lastView : originalKey, cached = key && noteCards.pageCache.get(key), entries = [];
    if (!cached) try {
      const db = await noteLibraryDb(accountId);
      try {
        if (last) key = (await requestResult(db.transaction(NOTE_LIBRARY_PAGE_STORE,"readonly").objectStore(NOTE_LIBRARY_PAGE_STORE).get("last")))?.key;
        if (key) cached = await requestResult(db.transaction(NOTE_LIBRARY_PAGE_STORE,"readonly").objectStore(NOTE_LIBRARY_PAGE_STORE).get(key));
        if (cached?.page?.ids?.length <= NOTE_LIBRARY_CACHE_ROWS) {
          const store = db.transaction(NOTE_LIBRARY_STORE,"readonly").objectStore(NOTE_LIBRARY_STORE);
          entries = (await Promise.all(cached.page.ids.map(id => requestResult(store.get(id))))).filter(Boolean);
        } else cached = null;
      } finally { db.close(); }
    } catch { return false; }
    if (!cached || !Array.isArray(cached.page?.ids) || noteCards.panel !== panel || panel.page.generation !== generation
      || accountId !== noteCards.accountId || originalKey !== noteLibraryViewKey(panel)) return false;
    if (last) {
      const [query, sort, category, tag, bookmarked] = JSON.parse(key);
      panel.input.value = query; panel.sort.value = sort; panel.category = category; panel.tag = tag; panel.bookmarked = bookmarked;
    }
    const byId = new Map(noteCards.entries.map(entry => [entry.id,entry]));
    for (const entry of entries) if (!byId.has(entry.id) || entry.localDirty && !byId.get(entry.id).localDirty) byId.set(entry.id,entry);
    noteCards.entries = [...byId.values()];
    Object.assign(panel.page, cached.page, {ids:cached.page.ids.slice(), key, error:""});
    noteCards.total = cached.page.totalSaved;
    if (!panel.selectedId) panel.selectedId = cached.selectedId || "";
    panel.restoreScrollTop = cached.scrollTop;
    return true;
  }
  async function noteLibraryRequestPage({ reset = false } = {}) {
    const panel = noteCards.panel;
    if (!panel) return;
    const page = panel.page;
    if (!reset && (page.pending || page.nextOffset === null)) return page.pending;
    if (reset) {
      page.controller?.abort();
      const key = noteLibraryViewKey(panel);
      if (page.key !== key) {
        noteLibraryCachePage(panel);
        Object.assign(page, { ids:[], nextOffset:0, total:null, totalSaved:null, categories:[], tags:[] });
        panel.grid.scrollTop = 0;
      }
      Object.assign(page, {key, error:""});
    }
    const generation = ++page.generation, controller = new AbortController();
    page.controller = controller;
    const offset = reset ? 0 : page.nextOffset, key = page.key, timeout = setTimeout(() => controller.abort(), 15000);
    const pending = (async () => {
      let accountId = noteCards.accountId;
      const params = new URLSearchParams({ limit:String(NOTE_LIBRARY_PAGE_SIZE), offset:String(offset), sort:panel.sort.value,
        query:panel.input.value.trim().slice(0,160), category:panel.category, tag:panel.tag || "", bookmarked:panel.bookmarked ? "1" : "0" });
      try {
        await noteLibraryLoad();
        accountId = noteCards.accountId;
        if (controller.signal.aborted || noteCards.panel !== panel || page.generation !== generation || key !== noteLibraryViewKey(panel)) return;
        if (reset && !page.ids.length) {
          await noteLibraryRestorePage(panel);
          if (controller.signal.aborted || noteCards.panel !== panel || page.generation !== generation || key !== noteLibraryViewKey(panel) || accountId !== noteCards.accountId) return;
          noteLibraryRender();
        }
        // Refresh only the prefix already opened by the user, in bounded
        // requests. Keep that prefix visible until the fresh IDs are complete.
        const target = reset ? Math.max(NOTE_LIBRARY_PAGE_SIZE, page.ids.length) : NOTE_LIBRARY_PAGE_SIZE, fresh = [];
        let body, next = offset;
        do {
          params.set("offset", String(next));
          body = await noteLibraryFetch(`${noteLibraryApi()}?${params}`, { signal:controller.signal });
          if (controller.signal.aborted || noteCards.panel !== panel || page.generation !== generation || key !== noteLibraryViewKey(panel) || accountId !== noteCards.accountId) return;
          if (!Array.isArray(body.notes) || body.notes.length > NOTE_LIBRARY_PAGE_SIZE || !body.notes.length && body.nextOffset !== null) throw Error("Invalid Notes & Cards page.");
          fresh.push(...body.notes);
          next = Number.isInteger(body.nextOffset) && body.nextOffset > next ? body.nextOffset : null;
        } while (reset && next !== null && fresh.length < target);
        if (noteCards.panel !== panel || page.generation !== generation || key !== noteLibraryViewKey(panel) || accountId !== noteCards.accountId) return;
        const entries = new Map(noteCards.entries.map(entry => [entry.id, entry]));
        // Read recovery copies only for this page. A pending offline edit must
        // survive an older server response and retry with its original version.
        try {
          const db = await noteLibraryDb(accountId);
          try {
            const store = db.transaction(NOTE_LIBRARY_STORE,"readonly").objectStore(NOTE_LIBRARY_STORE);
            const cached = await Promise.all(fresh.map(entry => requestResult(store.get(entry.id))));
            for (const entry of cached) if (entry?.localDirty && !entries.get(entry.id)?.localDirty) entries.set(entry.id, entry);
          } finally { db.close(); }
        } catch {}
        if (controller.signal.aborted || noteCards.panel !== panel || page.generation !== generation || accountId !== noteCards.accountId) return;
        const ids = reset ? [] : page.ids.slice();
        for (const entry of fresh) {
          if (!entry?.id || !entry.note?.title || entry.saved === false) continue;
          if (!entries.get(entry.id)?.localDirty) {
            entries.set(entry.id, entry);
            void noteLibraryCachePut(entry, accountId).catch(() => {});
          }
          if (entries.get(entry.id)?.localDirty) noteCards.dirty.add(entry.id);
          if (!ids.includes(entry.id)) ids.push(entry.id);
          noteCards.loadedIds.add(entry.id);
        }
        noteCards.entries = [...entries.values()];
        if (noteCards.dirty.size) noteLibraryPersistSoon();
        Object.assign(page, { ids, total:body.total, totalSaved:body.totalSaved, categories:body.categories || [], categoryTotal:body.categoryTotal ?? body.totalSaved,
          tags:body.tags || [], tagTotal:body.tagTotal ?? body.totalSaved, dueCount:body.dueCount || 0,
          nextOffset:next, error:"" });
        noteCards.total = body.totalSaved;
        noteLibraryCachePage(panel);
        if (panel.focusId && !entries.has(panel.focusId)) await noteLibraryLoad(panel.focusId);
      } catch (error) {
        if (noteCards.panel !== panel || page.generation !== generation || accountId !== noteCards.accountId || key !== noteLibraryViewKey(panel)) return;
        if (error.status === 401 || error.status === 403) {
          noteLibrarySetAccount("anonymous"); page.error = noteCopy("Sign in to read your notes.", "请登录后读取笔记。"); return;
        }
        page.error = noteCopy("Could not load notes. Try again.", "未能读取笔记，请重试。");
        // Recovery is opened only with the library, and is displayed in pages.
        if (!page.ids.length || !reset) {
          try {
            const db = await noteLibraryDb(accountId);
            let cached;
            try { cached = await requestResult(db.transaction(NOTE_LIBRARY_STORE,"readonly").objectStore(NOTE_LIBRARY_STORE).getAll()); }
            finally { db.close(); }
            if (noteCards.panel !== panel || page.generation !== generation || accountId !== noteCards.accountId) return;
            const byId = new Map((cached || []).map(entry => [entry.id, entry]));
            for (const entry of noteCards.entries) byId.set(entry.id, entry);
            noteCards.entries = [...byId.values()];
            const fallback = noteCardRuntime().libraryPage(noteCards.entries, Object.fromEntries(params));
            page.ids = [...new Set([...page.ids, ...fallback.notes.map(entry => entry.id)])];
            Object.assign(page, { total:fallback.total, totalSaved:fallback.totalSaved, categories:fallback.categories, categoryTotal:fallback.categoryTotal,
              tags:fallback.tags, tagTotal:fallback.tagTotal, dueCount:fallback.dueCount, nextOffset:fallback.nextOffset });
            noteLibraryCachePage(panel);
          } catch {}
        }
      } finally {
        clearTimeout(timeout);
        if (noteCards.panel === panel && page.generation === generation) {
          page.pending = null;
          noteLibraryRender();
        }
      }
    })();
    page.pending = pending;
    noteLibraryRender();
    return pending;
  }
  function noteLibraryLoadMore() {
    const panel = noteCards.panel;
    if (!panel || panel.initializing || noteCards.review || panel.grid.scrollTop + panel.grid.clientHeight < panel.grid.scrollHeight - 160) return;
    void noteLibraryRequestPage();
  }
  async function openNoteLibrary(options = {}) {
    const NOTE = noteCardRuntime();
    if (!NOTE) return;
    if (noteCards.panel) { if (options.focusId) { noteCards.panel.focusId = noteCards.panel.selectedId = options.focusId; noteLibraryRender(); } return; }
    hideAssist("note-library");
    closeNoteChooser();
    noteLibraryWire();
    const host = window.PENECHO_CONFIG?.runtime === "viewer" ? null : noteLibraryHost();
    if (host) {
      if (!host.library.classList.contains("open")) openHistoryPanel();
      host.library.dataset.libraryView = "notes";
      updateHistoryNavigation();
      // Leave the Favorites view if it was showing.
      document.getElementById("historyFavoritesView")?.setAttribute("hidden", "");
      document.getElementById("historyFavoritesNav")?.setAttribute("aria-current", "false");
      host.view.hidden = false;
      host.nav?.setAttribute("aria-current", "page");
    }
    const element = document.createElement("section"), header = document.createElement("header"), title = document.createElement("h2"), count = document.createElement("span"),
      input = document.createElement("input"), filters = document.createElement("div"), toolbar = document.createElement("div"), sort = document.createElement("select"),
      status = document.createElement("p"), grid = document.createElement("div"), detail = document.createElement("div");
    element.className = `note-library${host ? " is-embedded" : ""}`;
    if (!host) element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", noteCopy("Notes library", "笔记库"));
    header.className = "note-library-header";
    title.textContent = noteCopy("Notes & knowledge cards", "笔记与知识卡片");
    count.className = "note-library-count";
    const close = noteChip("", "×", "note-library-close", () => closeNoteLibrary({ library:true }), noteCopy("Close", "关闭")),
      review = noteChip(noteCopy("Review", "复习"), "↻", "note-library-review", () => noteReviewStart(), noteCopy("Review knowledge cards that are due", "复习到期的知识卡片")),
      blank = noteChip(noteCopy("New note", "新建笔记"), "+", "note-library-new", () => { closeNoteLibrary({ library:true }); void insertBlankNoteCard().catch(error => setStatus(String(error?.message || error))); });
    const titleWrap = document.createElement("div");
    titleWrap.className = "note-library-title";
    titleWrap.append(title, count);
    header.append(titleWrap, blank, review, ...(host ? [] : [close]));
    input.type = "search";
    input.className = "note-library-search";
    input.placeholder = noteCopy("Search titles, tags, formulas…", "搜索标题、标签、公式……");
    input.setAttribute("aria-label", noteCopy("Search notes", "搜索笔记"));
    filters.className = "note-library-filters";
    filters.setAttribute("role", "toolbar");
    toolbar.className = "note-library-toolbar";
    for (const [value, en, zh] of [["recent", "Recently edited", "最近编辑"], ["smart", "Smart · PenEchoLLM", "智能 · PenEchoLLM"], ["review", "Due for review", "待复习"], ["category", "By category", "按分类"], ["title", "Title A–Z", "标题 A–Z"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = noteCopy(en, zh);
      sort.append(option);
    }
    sort.className = "note-library-sort";
    sort.value = "recent";
    sort.setAttribute("aria-label", noteCopy("Sort notes", "笔记排序"));
    status.className = "note-library-status";
    toolbar.append(status, sort);
    grid.className = "note-library-grid";
    grid.setAttribute("role", "list");
    grid.addEventListener("scroll", noteLibraryLoadMore, { passive:true });
    // A short first page can fit without a scrollbar. Downward input still
    // requests the next page; opening the panel itself never drains all pages.
    grid.addEventListener("wheel", event => { if (event.deltaY > 0) noteLibraryLoadMore(); }, { passive:true });
    grid.addEventListener("keydown", event => { if (["PageDown", "End", "ArrowDown"].includes(event.key)) noteLibraryLoadMore(); });
    detail.className = "note-library-detail";
    detail.hidden = true;
    element.append(header, input, filters, toolbar, grid, detail);
    element.addEventListener("pointerdown", event => event.stopPropagation());
    element.addEventListener("wheel", event => event.stopPropagation(), { passive:true });
    element.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); if (noteCards.review) noteReviewStop(); else if (!detail.hidden) { detail.hidden = true; noteCards.panel.selectedId = ""; noteLibraryRender(); } else closeNoteLibrary({ library:true }); }
    });
    let debounce = 0;
    input.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(() => { noteLibraryRender(); if (sort.value === "smart") void noteRankQuery(input.value); }, 160); });
    sort.addEventListener("change", () => { noteLibraryRender(); if (sort.value === "smart") void noteRankQuery(input.value); });
    (host ? host.view : document.body).append(element);
    noteCards.panel = { initializing:true, embedded:Boolean(host), element, input, filters, sort, status, grid, detail, count, category:"", tag:"", bookmarked:false, focusId:options.focusId || "", selectedId:options.focusId || "",
      page:{ ids:[], nextOffset:0, key:"", generation:0, pending:null, controller:null, error:"", total:null, categories:[], tags:[] } };
    noteCards.panel.thumbObserver = new IntersectionObserver(items => {
      for (const item of items) if (item.isIntersecting) {
        noteCards.panel?.thumbObserver?.unobserve(item.target);
        const entry = noteCards.entries?.find(entry => entry.id === item.target.dataset.noteId);
        if (entry) void noteLibraryThumb(entry);
      }
    }, { root:grid, rootMargin:"200px" });
    if (host) {
      const sidebar = document.createElement("section"), heading = document.createElement("div"), label = document.createElement("span"), nav = document.createElement("nav");
      sidebar.className = "note-category-sidebar history-sidebar-section";
      heading.className = "note-category-heading";
      label.textContent = noteCopy("Categories", "分类");
      const add = noteChip("", "+", "note-category-add", () => noteLibraryAddCategory(), noteCopy("Add a category", "添加分类"));
      add.setAttribute("aria-label", noteCopy("Add a category", "添加分类"));
      nav.className = "note-category-nav";
      nav.setAttribute("aria-label", noteCopy("Filter notes by category", "按分类筛选笔记"));
      heading.append(label, add); sidebar.append(heading, nav);
      const navigation = host.library.querySelector(".history-library-sidebar");
      navigation.insertBefore(sidebar, navigation.querySelector(":scope > .crafts-echoes-link"));
      Object.assign(noteCards.panel, { categorySidebar:sidebar, categoryNav:nav });
      const tagSidebar = document.createElement("section"), tagHeading = document.createElement("div"), tagNav = document.createElement("nav");
      tagSidebar.className = "note-category-sidebar note-tag-sidebar history-sidebar-section";
      tagHeading.className = "note-category-heading";
      tagHeading.textContent = noteCopy("Tags", "标签");
      tagNav.className = "note-category-nav note-tag-nav";
      tagNav.setAttribute("aria-label", noteCopy("Filter notes by tag", "按标签筛选笔记"));
      tagSidebar.append(tagHeading, tagNav);
      navigation.insertBefore(tagSidebar, navigation.querySelector(":scope > .crafts-echoes-link"));
      Object.assign(noteCards.panel, { tagSidebar, tagNav });
    }
    status.textContent = noteCopy("Loading…", "正在读取……");
    const panel = noteCards.panel;
    try {
      await noteLibraryLoad();
    } catch (error) {
      if (error.status === 401 || error.status === 403) noteLibrarySetAccount("anonymous");
    }
    if (noteCards.entries && (window.PENECHO_CONFIG?.runtime !== "cloud" || noteCards.accountId && noteCards.accountId !== "anonymous")) {
      await noteLibraryRestorePage(panel, {last:!options.focusId});
    }
    if (noteCards.panel !== panel) return;
    panel.initializing = false;
    panel.page.key = noteLibraryViewKey(panel);
    noteLibraryRender();
    // Canvas synchronization and recovery run alongside the visible cache and
    // list refresh. Neither may hold up opening the library.
    void noteLibraryRecoverPending().catch(() => {});
    void noteLibrarySyncCurrent().then(async () => {
      await noteLibraryPersist();
      if (noteCards.panel === panel && (state.widgets || []).some(widget => {
        const entry = noteCards.entries?.find(entry => entry.id === noteLibraryId(canvasDocumentsCurrent().id,widget.id));
        return noteCardWidget(widget) && entry?.saved !== false && entry && !panel.page.ids.includes(entry.id);
      })) await noteLibraryRefreshServer();
    }).catch(() => {});
    await noteLibraryRequestPage({ reset:true });
    void noteRankPending();
    for (const widget of (state.widgets || []).filter(noteCardWidget)) void noteCardThumb(widget);
  }
  function noteLibraryFilterButton(label, icon, active, onClick, color = "") {
    const button = noteChip(label, icon, `note-filter${active ? " active" : ""}`, onClick);
    button.setAttribute("aria-pressed", String(active));
    if (color) button.style.setProperty("--note-chip-color", color);
    return button;
  }
  function noteLibraryChooseCategory(id) {
    const panel = noteCards.panel;
    if (!panel) return;
    panel.category = id;
    panel.selectedId = "";
    if (noteCards.review) noteReviewStop(); else noteLibraryRender();
  }
  function noteLibraryChooseTag(id) {
    const panel = noteCards.panel;
    if (!panel) return;
    panel.tag = panel.tag === id ? "" : id;
    panel.selectedId = "";
    if (noteCards.review) noteReviewStop(); else noteLibraryRender();
  }
  function noteLibraryTagRender() {
    const panel = noteCards.panel;
    if (!panel?.tagNav) return;
    const focused = panel.tagNav.contains(document.activeElement) ? document.activeElement.dataset.tagId : null,
      tags = [...panel.page.tags];
    if (panel.tag && !tags.some(tag => tag.id === panel.tag)) tags.push({ id:panel.tag, label:panel.tag, count:0 });
    panel.tagNav.textContent = "";
    for (const tag of [{ id:"", label:noteCopy("All tags", "全部标签"), count:panel.page.tagTotal ?? panel.page.totalSaved ?? 0 }, ...tags]) {
      const button = noteChip(tag.label, tag.id ? "#" : "▦", "note-category-nav-item note-tag-nav-item", () => noteLibraryChooseTag(tag.id)), count = document.createElement("small");
      button.dataset.tagId = tag.id;
      button.setAttribute("aria-pressed", String(panel.tag === tag.id));
      count.textContent = String(tag.count); button.append(count); panel.tagNav.append(button);
    }
    if (focused !== null) panel.tagNav.querySelector(`[data-tag-id="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  }
  function noteLibraryCategoryRender(entries, categories, counts) {
    const panel = noteCards.panel;
    if (!panel?.categoryNav) return;
    const focused = panel.categoryNav.contains(document.activeElement) ? document.activeElement.dataset.categoryId : null;
    panel.categoryNav.textContent = "";
    for (const category of [{ id:"", label:noteCopy("All categories", "全部分类"), icon:"▦" }, ...categories]) {
      const total = category.id ? counts.get(category.id) || 0 : panel.page.categoryTotal ?? panel.page.totalSaved ?? entries.length;
      if (category.id && !total && (panel.tag || !category.custom) && panel.category !== category.id) continue;
      const button = noteChip(category.label, category.icon, "note-category-nav-item", () => noteLibraryChooseCategory(category.id)), count = document.createElement("small");
      button.dataset.categoryId = category.id;
      button.setAttribute("aria-current", panel.category === category.id ? "page" : "false");
      button.style.setProperty("--note-chip-color", category.color || "#475569");
      count.textContent = String(total); button.append(count); panel.categoryNav.append(button);
    }
    if (focused !== null) panel.categoryNav.querySelector(`[data-category-id="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  }
  function noteLibraryRender() {
    const panel = noteCards.panel, NOTE = noteCardRuntime();
    if (!panel || panel.initializing || !noteCards.entries || !NOTE) return;
    if (panel.page.key !== noteLibraryViewKey(panel)) { void noteLibraryRequestPage({ reset:true }); return; }
    const entries = panel.page.ids.map(id => noteCards.entries.find(entry => entry.id === id)).filter(entry => entry?.saved !== false && entry?.note), categories = noteCategories(),
      counts = new Map(panel.page.categories.map(category => [category.id, category.count]));
    for (const category of panel.page.categories) if (!categories.some(item => item.id === category.id)) categories.push({ ...category, custom:true });
    for (const entry of entries) {
      const category = entry.note.category;
      if (category?.id && !categories.some(item => item.id === category.id)) categories.push({ ...category, custom:true });
    }
    panel.count.textContent = noteCopy(`${panel.page.totalSaved ?? entries.length} cards`, `${panel.page.totalSaved ?? entries.length} 张`);
    noteLibraryCount();
    noteLibraryCategoryRender(entries, categories, counts);
    noteLibraryTagRender();
    if (noteCards.review) { noteReviewRender(); return; }
    panel.filters.textContent = "";
    panel.filters.append(
      ...(!panel.embedded ? [noteLibraryFilterButton(noteCopy("All", "全部"), "", !panel.category && !panel.tag && !panel.bookmarked, () => { panel.category = ""; panel.tag = ""; panel.bookmarked = false; noteLibraryRender(); })] : []),
      noteLibraryFilterButton(noteCopy("Bookmarked", "收藏"), "★", panel.bookmarked, () => { panel.bookmarked = !panel.bookmarked; noteLibraryRender(); }),
    );
    for (const category of panel.embedded ? [] : categories) {
      const total = counts.get(category.id) || 0;
      if (!total && (panel.tag || !category.custom) && panel.category !== category.id) continue;
      panel.filters.append(noteLibraryFilterButton(`${category.label}${total ? ` ${total}` : ""}`, category.icon, panel.category === category.id, () => { panel.category = panel.category === category.id ? "" : category.id; noteLibraryRender(); }, category.color));
    }
    if (!panel.embedded) panel.filters.append(noteChip(noteCopy("Category", "分类"), "+", "note-filter note-filter-add", () => noteLibraryAddCategory(), noteCopy("Add a category", "添加分类")));
    for (const tag of panel.embedded ? [] : panel.page.tags) panel.filters.append(noteLibraryFilterButton(tag.label, "#", panel.tag === tag.id, () => noteLibraryChooseTag(tag.id)));
    const query = panel.input.value, ranked = NOTE.rankNotes(entries, { query, sort:panel.sort.value, category:panel.category, tag:panel.tag, bookmarked:panel.bookmarked }),
      hasFilters = noteLibraryHasFilters(query),
      read = entries.filter(entry => entry.llm?.basis === "metadata" && !entry.llm.stale).length, now = Date.now(),
      due = panel.page.dueCount ?? entries.filter(entry => entry.note.style === "card" && (!Number.isFinite(entry.review?.due) || entry.review.due <= now)).length;
    panel.sort.querySelector('option[value="smart"]').textContent = hasFilters ? noteCopy("Smart · PenEchoLLM", "智能 · PenEchoLLM") : noteCopy("Smart", "智能");
    panel.status.textContent = panel.sort.value === "smart"
      ? (hasFilters && typeof penIntelRemote === "function" && penIntelRemote() ? noteCopy(`PenEchoLLM · title & attributes · ${read}/${entries.length}`, `PenEchoLLM · 标题和属性 · ${read}/${entries.length}`) : noteCopy(`Local ranking · ${due} due for review`, `本地排序 · ${due} 张待复习`))
      : noteCopy(`${ranked.length} shown · ${due} due for review`, `显示 ${ranked.length} 张 · ${due} 张待复习`);
    if (panel.page.pending) panel.status.textContent = entries.length ? noteCopy("Refreshing…", "正在更新……") : noteCopy("Loading…", "正在读取……");
    else if (panel.page.error) panel.status.textContent = panel.page.error;
    panel.grid.setAttribute("aria-busy", String(Boolean(panel.page.pending)));
    const restoringScroll = panel.restoreScrollTop != null, scrollTop = panel.restoreScrollTop ?? panel.grid.scrollTop;
    delete panel.restoreScrollTop;
    panel.thumbObserver?.disconnect();
    const children = [], retained = new Set();
    panel.tiles ||= new Map();
    if (!ranked.length && !panel.page.pending && !panel.page.error) {
      const empty = document.createElement("div");
      empty.className = "note-library-empty";
      const strong = document.createElement("strong"), text = document.createElement("span");
      strong.textContent = hasFilters ? noteCopy("No matching cards", "没有匹配的卡片") : noteCopy("No note cards yet", "还没有笔记卡片");
      text.textContent = hasFilters ? noteCopy("Try another word or clear the filters.", "换个关键词，或清除筛选。") : noteCopy("Lasso anything on the Canvas, then choose Organize as Note in the Suggest Bar.", "在画布上圈选内容，然后在建议栏中选择“整理为笔记”。");
      empty.append(strong, text);
      children.push(empty);
    }
    const viewKey = noteLibraryViewKey(panel), viewChanged = panel.viewKey !== viewKey;
    if (viewChanged) panel.viewKey = viewKey;
    panel.ranked = ranked;
    for (const item of ranked) {
      const entry = item.entry, key = JSON.stringify([entry.digest,entry.note.title,entry.note.summary,entry.note.category,entry.note.bookmarked,
        entry.note.style,entry.storage,item.due,entry.llm?.importance,panel.selectedId===entry.id,state.language]);
      let cached = panel.tiles.get(entry.id);
      if (!cached || cached.key !== key || cached.thumb !== entry.thumb) {
        const fresh = noteLibraryTile(item);
        if (cached) {
          // Keep the button and scroll target alive while a preview or backup
          // status changes; replacing the whole grid interrupts wheel input.
          cached.tile.replaceChildren(...fresh.childNodes);
          for (const attr of fresh.attributes) if (attr.name !== "style") cached.tile.setAttribute(attr.name,attr.value);
          cached.tile.style.setProperty("--note-tile-color",fresh.style.getPropertyValue("--note-tile-color"));
        } else cached = {tile:fresh};
        Object.assign(cached,{key,thumb:entry.thumb});
        panel.tiles.set(entry.id,cached);
      }
      retained.add(entry.id);
      children.push(cached.tile);
      if (!entry.thumb || entry.thumbDigest !== noteThumbKey(entry)) panel.thumbObserver?.observe(cached.tile);
    }
    for (const id of panel.tiles.keys()) if (!retained.has(id)) panel.tiles.delete(id);
    if (panel.page.nextOffset !== null || panel.page.error) {
      const more = noteChip(panel.page.pending ? noteCopy("Loading…", "正在读取……") : panel.page.error ? noteCopy("Retry", "重试") : noteCopy("Load more", "加载更多"), "", "note-library-page-more",
        () => void noteLibraryRequestPage({reset:Boolean(panel.page.error && panel.page.nextOffset === null)}));
      more.disabled = Boolean(panel.page.pending);
      children.push(more);
    }
    let cursor = panel.grid.firstChild;
    for (const child of children) {
      if (child === cursor) cursor = cursor.nextSibling;
      else panel.grid.insertBefore(child,cursor);
    }
    while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
    if (!viewChanged || restoringScroll) panel.grid.scrollTop = scrollTop;
    if (panel.focusId) {
      const focused = panel.grid.querySelector(`[data-note-id="${CSS.escape(panel.focusId)}"]`);
      focused?.scrollIntoView({ block:"nearest" });
      panel.focusId = "";
    }
    noteLibraryDetailRender();
  }
  function noteLibraryTile({ entry, due }) {
    const note = entry.note, tile = document.createElement("button"), band = document.createElement("span"), chip = document.createElement("span"), title = document.createElement("strong"),
      snippet = document.createElement("span"), foot = document.createElement("span"), color = note.category?.color || note.accent || "#475569";
    tile.type = "button";
    tile.className = `note-tile note-tile--${note.style}${note.bookmarked ? " is-bookmarked" : ""}${noteCards.panel?.selectedId === entry.id ? " is-selected" : ""}`;
    tile.dataset.noteId = entry.id;
    tile.setAttribute("role", "listitem");
    tile.style.setProperty("--note-tile-color", color);
    if (entry.thumb) {
      const image = document.createElement("img");
      image.src = entry.thumb;
      image.alt = "";
      image.className = "note-tile-thumb";
      tile.append(image);
    } else {
      band.className = "note-tile-band";
      chip.className = "note-tile-chip";
      chip.textContent = note.category ? `${note.category.icon || "●"} ${note.category.label}` : note.style === "card" ? noteCopy("Knowledge card", "知识卡片") : noteCopy("Note", "笔记");
      title.className = "note-tile-title";
      title.textContent = note.title;
      snippet.className = "note-tile-snippet";
      snippet.textContent = noteCardRuntime().searchText({ ...note, title:"", category:null, tags:[] }).replace(/\s+/g, " ").trim().slice(0, 160);
      band.append(chip);
      tile.append(band, title, snippet);
      const media = note.blocks.find(block => (block.type === "ink" || block.type === "image") && block.src);
      if (media) { const image = document.createElement("img"); image.src = media.src; image.alt = ""; image.className = "note-tile-media"; tile.append(image); }
    }
    foot.className = "note-tile-foot";
    for (const status of noteLibraryStorageLabels(entry)) {
      const badge = document.createElement("span"); badge.className = "note-tile-due note-tile-storage"; badge.textContent = status.label; badge.title = status.title; foot.append(badge);
    }
    if (due && note.style === "card") { const badge = document.createElement("span"); badge.className = "note-tile-due"; badge.textContent = noteCopy("Review", "复习"); foot.append(badge); }
    if (entry.llm?.importance >= 0.7) { const badge = document.createElement("span"); badge.className = "note-tile-key"; badge.textContent = "✦"; badge.title = noteCopy("PenEchoLLM: key card", "PenEchoLLM：关键卡片"); foot.append(badge); }
    if (foot.childElementCount) tile.append(foot);
    tile.setAttribute("aria-label", [note.title, note.category?.label, note.bookmarked ? noteCopy("bookmarked", "已收藏") : ""].filter(Boolean).join(" · "));
    tile.addEventListener("click", () => { if (!noteCards.panel) return; noteCards.panel.selectedId = entry.id; noteLibraryRender(); });
    tile.addEventListener("dblclick", () => noteLibraryReadEntry(entry));
    return tile;
  }
  function noteLibraryDetailRender() {
    const panel = noteCards.panel;
    if (!panel) return;
    const entry = noteCards.entries.find(item => item.id === panel.selectedId), detail = panel.detail;
    detail.textContent = "";
    detail.hidden = !entry;
    if (!entry) return;
    const note = entry.note, info = document.createElement("div"), header = document.createElement("header"), title = document.createElement("h3"), kindLabel = document.createElement("span"), actions = document.createElement("div"), secondary = document.createElement("div");
    info.className = "note-detail-info";
    header.className = "note-detail-header";
    kindLabel.className = "note-detail-kind";
    kindLabel.textContent = note.style === "card" ? noteCopy("Knowledge card", "知识卡片") : noteCopy("Work note", "工作笔记");
    title.textContent = note.title;
    const kind = entry.llm?.kind ? noteCardRuntime().NOTE_KINDS[entry.llm.kind] : null;
    header.append(kindLabel, title);
    if (note.tags?.length) {
      const tags = document.createElement("div"); tags.className = "note-detail-tags";
      for (const tag of note.tags) { const label = document.createElement("span"); label.textContent = `#${tag}`; tags.append(label); }
      header.append(tags);
    }
    info.append(header);
    if (note.summary) { const summary = document.createElement("p"); summary.className = "note-detail-summary"; summary.textContent = note.summary; info.append(summary); }
    actions.className = "note-detail-actions";
    secondary.className = "note-detail-secondary";
    const share = noteChip(noteCopy("Share", "分享"), "", "note-detail-action note-detail-share", () => void noteLibraryShareEntry(entry));
    share.insertAdjacentHTML("afterbegin", OBJECT_CHROME_ICONS.share);
    actions.append(
      noteChip(noteCopy("Read", "单独浏览"), "↗", "note-detail-action primary", () => noteLibraryReadEntry(entry)),
      noteChip(noteCopy("Add to current canvas", "添加到当前画布"), "+", "note-detail-action", () => void noteLibraryAddToCanvas(entry)),
      share,
    );
    secondary.append(
      noteChip(note.bookmarked ? noteCopy("Bookmarked", "已收藏") : noteCopy("Bookmark", "收藏"), note.bookmarked ? "★" : "☆", `note-detail-action${note.bookmarked ? " active" : ""}`, () => noteLibraryToggleBookmark(entry)),
      ...(note.style === "card" ? [noteChip(noteCopy("Review now", "现在复习"), "↻", "note-detail-action", () => noteReviewStart([entry.id]))] : []),
      ...(entry.locator || canvasDocuments.records.has(entry.documentId) ? [noteChip(noteCopy("Source canvas", "原画布"), "↗", "note-detail-action note-detail-source", () => void openNoteLibraryEntry(entry))] : []),
    );
    const categoryRow = document.createElement("label"), categorySelect = document.createElement("select"), categoryLabel = document.createElement("span");
    categoryRow.className = "note-detail-category";
    categoryLabel.textContent = note.category && note.categorySource !== "user" ? noteCopy("Category (auto)", "分类（自动）") : noteCopy("Category", "分类");
    for (const category of noteCategories()) { const option = document.createElement("option"); option.value = category.id; option.textContent = `${category.icon} ${category.label}`; categorySelect.append(option); }
    if (!note.category) { const option = document.createElement("option"); option.value = ""; option.textContent = noteCopy("Not assigned yet", "尚未分配"); categorySelect.prepend(option); }
    categorySelect.value = note.category?.id || "";
    categorySelect.addEventListener("change", () => { if (categorySelect.value) noteLibrarySetCategory(entry, categorySelect.value); });
    categoryRow.append(categoryLabel, categorySelect);
    const properties = document.createElement("div"), storage = document.createElement("div"), storageLabel = document.createElement("span"), badges = document.createElement("div");
    properties.className = "note-detail-properties";
    storage.className = "note-detail-storage";
    storageLabel.textContent = noteCopy("Saved", "保存状态");
    badges.className = "note-detail-storage-badges";
    for (const status of noteLibraryStorageLabels(entry)) {
      const badge = document.createElement("span"); badge.textContent = status.label; badge.title = status.title; badge.setAttribute("aria-label", status.title); badges.append(badge);
    }
    storage.append(storageLabel, badges);
    properties.append(categoryRow, storage);
    if (entry.storage?.pending || ["pending", "conflict", "other-account", "signed-out"].includes(entry.storage?.cloud)) {
      const status = document.createElement("p"); status.className = "note-detail-storage-note";
      status.textContent = noteLibraryStorageLabels(entry).filter(item => item.label !== noteCopy("Server", "服务器") || entry.storage.cloud === "signed-out").map(item => item.title).join(" · ");
      if (status.textContent) properties.append(status);
    }
    info.append(actions, secondary, properties);
    const signals = entry.llm && !entry.llm.stale ? entry.llm : null;
    if (signals) {
      const bars = document.createElement("div");
      bars.className = "note-detail-signals";
      for (const [key, en, zh] of signals.basis === "metadata" ? [["priority", "Browse priority", "浏览优先度"]] : [["importance", "Key knowledge", "关键程度"], ["complete", "Self-contained", "完整度"], ["review", "Worth reviewing", "复习价值"]]) {
        if (!Number.isFinite(signals[key])) continue;
        const row = document.createElement("span"), label = document.createElement("span"), meter = document.createElement("span"), fill = document.createElement("span");
        row.className = "note-signal";
        label.textContent = noteCopy(en, zh);
        meter.className = "note-signal-meter";
        fill.style.setProperty("--note-signal", `${Math.round(signals[key] * 100)}%`);
        meter.append(fill);
        row.append(label, meter);
        bars.append(row);
      }
      const source = document.createElement("small");
      source.textContent = signals.basis === "metadata" ? noteCopy("PenEchoLLM · title and attributes", "PenEchoLLM · 基于标题和属性") : kind ? noteCopy(`Read by PenEchoLLM · ${kind.en}`, `由 PenEchoLLM 评估 · ${kind.zh}`) : noteCopy("Read by PenEchoLLM", "由 PenEchoLLM 评估");
      bars.append(source);
      info.append(bars);
    }
    info.append(noteChip(noteCopy("Remove from Notes & Cards", "从 Notes & Cards 移除"), "", "note-detail-action note-detail-remove", () => noteLibraryRequestForget(entry), noteCopy("Remove the library copy; the original card stays on its canvas", "移除资料库副本；原画布中的卡片保留")));
    detail.append(info);
  }
  function noteLibraryToggleBookmark(entry) {
    const widget = entry.documentId === canvasDocumentsCurrent().id ? (state.widgets || []).find(item => item.id === entry.objectId && noteCardWidget(item)) : null;
    if (widget) { noteToggleBookmark(widget); return; }
    const current = noteCards.entries.find(item => item.id === entry.id);
    if (!current) return;
    current.note = { ...current.note, bookmarked:!current.note.bookmarked };
    if (!current.note.bookmarked) delete current.note.bookmarked;
    // Applied to the card itself when its Canvas opens next.
    current.pendingBookmark = Boolean(current.note.bookmarked);
    noteLibraryPut(current);
    noteLibraryRender();
  }
  function noteLibraryStorageLabels(entry) {
    const storage = entry.storage || {}, labels = [];
    if (storage.server) labels.push({label:noteCopy("Server", "服务器"), title:storage.pending ? noteCopy("Server backup exists; saving the latest change", "服务端已有独立备份；正在保存最新修改") : storage.cloud==="signed-out" ? noteCopy("Saved independently on the server. Sign in for automatic Cloud backup.", "已独立保存到服务端，不依赖画布；登录云端后自动备份") : noteCopy("Saved independently on the server", "已独立保存到服务端，不依赖画布")});
    else if (storage.pending || !storage.cloud) labels.push({label:noteCopy("Saving", "待保存"),title:noteCopy("Waiting for a durable backup", "正在等待服务端保存确认")});
    if (storage.cloud === "saved" && !storage.pending) labels.push({label:noteCopy("Cloud", "云端"), title:noteCopy("Backed up to your Cloud account", "已备份到当前云端账号")});
    else if (storage.cloud === "conflict") labels.push({label:noteCopy("Conflict", "同步冲突"),title:noteCopy("Both copies are retained; Cloud was not overwritten", "本机和云端两份内容均保留，云端未被覆盖")});
    else if (storage.cloud === "pending" || storage.cloud === "saved" && storage.pending) labels.push({label:noteCopy("Pending", "待同步"),title:noteCopy("Cloud backup is pending and will retry automatically", "等待云端备份，将自动重试")});
    else if (storage.cloud === "other-account") labels.push({label:noteCopy("Cloud account", "原云端账号"),title:noteCopy("Backed up under the previous account; sign in to that account to sync", "备份属于原云端账号，登录原账号后同步")});
    return labels;
  }
  async function noteLibrarySaveWidget(widget) {
    try {
      await noteLibraryUpsertWidget(widget, {restore:true});
      await noteLibraryPersist();
      renderNoteChooser(); noteLibraryCount(); requestRender();
      setStatus(noteCopy("Saved to Notes & Cards", "已保存到 Notes & Cards"));
    } catch { setStatus(noteCopy("Notes & Cards backup is pending. Please retry.", "Notes & Cards 备份尚未完成，请重试。")); }
  }
  async function noteLibraryAddToCanvas(entry) {
    try {
      const existing = (state.widgets || []).find(widget => noteCardWidget(widget) && noteLibraryId(canvasDocumentsCurrent().id, widget.id) === entry.id);
      if (existing) { closeNoteLibrary({library:true}); canvasAgentFrameRegion(widgetBox(existing),120); return; }
      await noteCardInsert({...structuredClone(entry.note),libraryId:entry.id});
      closeNoteLibrary({library:true});
      setStatus(noteCopy("Added to the current canvas", "已添加到当前画布"));
    } catch (error) { setStatus(String(error.message || error)); }
  }
  async function noteLibraryShareEntry(entry) {
    if (noteCards.sharing) return;
    noteCards.sharing = true;
    const panel = noteCards.panel;
    try {
      if (!window.PenEchoCommunityUI) throw Error(noteCopy("Sharing is unavailable. Please reload and try again.", "分享暂不可用，请刷新后重试。"));
      // Resolve the owning Canvas before dispatching the existing Widget action.
      // Widget ids are local to each Canvas and may collide across documents.
      if (entry.documentId !== canvasDocumentsCurrent().id) {
        if (canvasDocuments.records.has(entry.documentId)) await canvasDocumentsShow(entry.documentId);
        else if (entry.locator?.id && entry.locator?.location) await requestCanvasTransition({ type:"load", id:entry.locator.id, location:entry.locator.location });
        else throw Error(noteCopy("The source canvas is unavailable. Add this note to the current canvas, then share it.", "原画布已不可用。请先将这份笔记添加到当前画布，再分享。"));
      }
      if (entry.documentId !== canvasDocumentsCurrent().id) return;
      const matches = (state.widgets || []).filter(widget => noteCardWidget(widget) && noteLibraryId(entry.documentId, widget.id) === entry.id),
        widget = matches.find(item => item.id === entry.objectId) || matches[0];
      if (!widget) throw Error(noteCopy("The original note is no longer on its canvas. Add the library copy to the current canvas, then share it.", "原笔记已不在画布中。请先将资料库副本添加到当前画布，再分享。"));
      closeNoteLibrary({ library:true });
      window.dispatchEvent(new CustomEvent("penecho:community-widget-action", { detail:{ action:"share", widgetId:widget.id } }));
    } catch (error) {
      const message = String(error?.message || error);
      if (noteCards.panel === panel && panel) panel.status.textContent = message;
      setStatus(message);
    } finally { noteCards.sharing = false; }
  }
  // Open above either maximized surface, outside the scaled card iframe.
  function noteImageOpen(note, index) {
    if (!note || !Number.isInteger(index) || index < 0) return;
    const block = note.blocks.filter(block => ["ink", "image"].includes(block.type) && block.src)[index];
    if (!block) return;
    document.querySelector(".note-image-viewer")?.close();
    const dialog = document.createElement("dialog"), header = document.createElement("div"), title = document.createElement("span"),
      controls = document.createElement("div"), stage = document.createElement("div"), surface = document.createElement("div"), image = document.createElement("img"), trigger = document.activeElement;
    let zoom = 1, autoFit = true;
    dialog.className = "note-image-viewer";
    title.textContent = block.alt || block.caption || noteCopy("Original image", "原始图片");
    dialog.setAttribute("aria-label", title.textContent);
    header.className = "note-library-header"; controls.className = "note-image-controls";
    stage.className = "note-image-stage"; surface.className = "note-image-surface";
    image.alt = block.alt || title.textContent; image.referrerPolicy = "no-referrer";
    const fitZoom = () => Math.min(1, Math.max(1, stage.clientWidth - 48) / image.naturalWidth, Math.max(1, stage.clientHeight - 48) / image.naturalHeight);
    const setZoom = (value, fitted = false) => {
      if (!image.naturalWidth) return;
      autoFit = fitted;
      zoom = Math.max(fitZoom(), Math.min(8, value));
      image.style.width = `${image.naturalWidth * zoom}px`;
      image.style.height = `${image.naturalHeight * zoom}px`;
      label.textContent = `${Math.round(zoom * 100)}%`;
    };
    const fit = () => { setZoom(fitZoom(), true); stage.scrollTo(0, 0); };
    const label = document.createElement("span"); label.className = "note-image-zoom"; label.setAttribute("aria-live", "polite");
    controls.append(noteChip("", "−", "note-chip", () => setZoom(zoom / 1.5), noteCopy("Zoom out", "缩小")), label,
      noteChip("", "+", "note-chip", () => setZoom(zoom * 1.5), noteCopy("Zoom in", "放大")),
      noteChip("100%", "", "note-chip", () => setZoom(1), noteCopy("Actual size", "原始大小")),
      noteChip(noteCopy("Fit", "适应窗口"), "", "note-chip", fit),
      noteChip("", "×", "note-library-close", () => dialog.close(), noteCopy("Close", "关闭")));
    header.append(title, controls); surface.append(image); stage.append(surface); dialog.append(header, stage);
    image.addEventListener("load", fit, {once:true});
    image.addEventListener("error", () => { label.textContent = noteCopy("Image unavailable", "图片加载失败"); }, {once:true});
    dialog.addEventListener("keydown", event => event.stopPropagation());
    const observer = new ResizeObserver(() => { if (image.naturalWidth) autoFit ? fit() : setZoom(zoom); }); observer.observe(stage);
    dialog.addEventListener("close", () => { observer.disconnect(); dialog.remove(); trigger?.focus(); }, {once:true});
    document.body.append(dialog); dialog.showModal(); image.src = block.src;
  }
  function noteLibraryReadEntry(entry) {
    noteCards.reader?.close();
    const dialog = document.createElement("dialog"), header = document.createElement("div"), title = document.createElement("span"), body = document.createElement("div"), frame = document.createElement("iframe"), trigger = document.activeElement;
    dialog.className = "note-reader"; dialog.setAttribute("aria-label",entry.note.title);
    header.className = "note-library-header"; title.textContent = entry.note.title;
    header.append(title, noteChip(noteCopy("Close", "关闭"), "×", "note-library-close", () => dialog.close()));
    body.className = "note-reader-body"; frame.title = entry.note.title; frame.setAttribute("sandbox","allow-scripts allow-same-origin");
    const hostUrl = widgetHostUrl({id:"general",connect:[]}), hostOrigin = new URL(hostUrl).origin;
    const receive = event => {
      if(event.source!==frame.contentWindow || event.origin!==hostOrigin)return;
      if(event.data?.type==="penecho-widget-host-ready") {
        frame.contentWindow.postMessage({type:"penecho-widget-init",html:noteCardDocument(entry.note),title:entry.note.title,sourceFormat:noteCardRuntime().FORMAT,language:state.language},hostOrigin);
        frame.contentWindow.postMessage({type:"penecho-widget-state",maximized:true,selected:false,interactive:true,active:true,scaleX:1,scaleY:1},hostOrigin);
      } else if(event.data?.type==="penecho-widget-capture-ready")dialog.dataset.ready="true";
      else if(event.data?.type==="penecho-note-image-open")noteImageOpen(entry.note,event.data.index);
    };
    window.addEventListener("message",receive);frame.src=hostUrl;body.append(frame); dialog.append(header,body);
    const fit = () => { const scale = Math.min(body.clientWidth/900,body.clientHeight/1200); frame.style.transform = `translate(-50%, -50%) scale(${scale})`; };
    const observer = new ResizeObserver(fit); observer.observe(body);
    dialog.addEventListener("close", () => { observer.disconnect(); window.removeEventListener("message",receive); dialog.remove(); if (noteCards.reader === dialog) noteCards.reader = null; trigger?.focus(); }, {once:true});
    dialog.addEventListener("keydown", event => event.stopPropagation());
    document.body.append(dialog); noteCards.reader = dialog; dialog.showModal(); fit();
  }
  function noteLibraryRequestForget(entry) {
    if (document.querySelector(".note-remove-dialog")) return;
    const dialog = document.createElement("dialog"), form = document.createElement("form"), icon = document.createElement("div"), copy = document.createElement("div"), title = document.createElement("h2"), description = document.createElement("p"), actions = document.createElement("div"), trigger = document.activeElement, accountId = noteCards.accountId;
    dialog.className = "studio-session-delete-dialog history-delete-dialog note-remove-dialog";
    dialog.setAttribute("role", "alertdialog"); dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "noteRemoveTitle"); dialog.setAttribute("aria-describedby", "noteRemoveDescription");
    Object.assign(dialog.dataset, {peSurface:"alert", peSize:"s", peLayout:"single", pePresentation:"modal", peMaterial:"opaque", peState:"default"});
    form.method = "dialog"; copy.className = "studio-session-delete-copy"; actions.className = "studio-session-delete-actions";
    icon.className = "studio-session-delete-icon"; icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    title.id = "noteRemoveTitle"; title.textContent = noteCopy("Remove from Notes & Cards?", "从 Notes & Cards 移除？");
    description.id = "noteRemoveDescription"; description.textContent = noteCopy(`“${entry.note.title}” will be removed from Notes & Cards. The original card will stay on its canvas.`, `“${entry.note.title}”将从 Notes & Cards 移除。原画布中的卡片会保留。`);
    const cancel = document.createElement("button"), confirm = document.createElement("button");
    confirm.className = "danger";
    for (const [button, value, label, style] of [[cancel, "cancel", noteCopy("Cancel", "取消"), "secondary"], [confirm, "remove", noteCopy("Remove", "移除"), "danger-primary"]]) {
      button.type = "submit"; button.value = value; button.textContent = label; button.dataset.peButton = style; button.dataset.peDensity = "standard"; actions.append(button);
    }
    copy.append(title, description); form.append(icon, copy, actions); dialog.append(form);
    dialog.addEventListener("keydown", event => event.stopPropagation());
    dialog.addEventListener("close", () => {
      dialog.remove();
      const current = noteCards.accountId === accountId && noteCards.entries?.find(item => item.id === entry.id && item.saved !== false);
      if (dialog.returnValue === "remove" && current) noteLibraryForget(current);
      if (trigger?.isConnected) trigger.focus({preventScroll:true});
      else (noteCards.panel?.detail.querySelector(".note-detail-remove") || noteCards.panel?.grid.querySelector(".note-tile") || noteCards.panel?.input)?.focus({preventScroll:true});
    }, {once:true});
    document.body.append(dialog); dialog.showModal(); cancel.focus({preventScroll:true});
  }
  function noteLibraryForget(entry) {
    entry.saved = false;
    entry.updatedAt = Date.now();
    noteLibraryPut(entry);
    if (noteCards.panel) noteCards.panel.selectedId = "";
    noteLibraryRender();
  }
  function noteLibraryAddCategory() {
    const panel = noteCards.panel;
    const target = panel?.categorySidebar || panel?.filters;
    if (!target || target.querySelector(".note-category-form")) return;
    if (noteCards.review) noteReviewStop();
    const form = document.createElement("form"), name = document.createElement("input"), color = document.createElement("input"), look = document.createElement("select"), save = document.createElement("button");
    form.className = "note-category-form";
    name.type = "text";
    name.maxLength = 32;
    name.required = true;
    name.placeholder = noteCopy("New category", "新分类");
    name.setAttribute("aria-label", name.placeholder);
    color.type = "color";
    color.setAttribute("aria-label", noteCopy("Category color", "分类颜色"));
    look.setAttribute("aria-label", noteCopy("Card style", "卡片样式"));
    color.value = ["#0ea5e9", "#8b5cf6", "#f43f5e", "#84cc16", "#f59e0b"][noteCategories().length % 5];
    for (const [value, en, zh] of [["card", "Knowledge card", "知识卡片"], ["note", "Work note", "工作笔记"]]) { const option = document.createElement("option"); option.value = value; option.textContent = noteCopy(en, zh); look.append(option); }
    save.type = "submit";
    save.textContent = noteCopy("Add", "添加");
    const cancel = noteChip(noteCopy("Cancel", "取消"), "", "", () => form.remove());
    form.append(name, color, look, save, cancel);
    form.addEventListener("submit", event => { event.preventDefault(); const added = addNoteCategory(name.value.trim(), color.value, look.value); if (added) { panel.category = added.id; form.remove(); noteLibraryRender(); } });
    target.append(form);
    name.focus();
  }
  async function openNoteLibraryEntry(entry) {
    try {
      if (entry.documentId !== canvasDocumentsCurrent().id) {
        if (canvasDocuments.records.has(entry.documentId)) await canvasDocumentsShow(entry.documentId);
        else if (entry.locator?.id && entry.locator?.location) await requestCanvasTransition({ type:"load", id:entry.locator.id, location:entry.locator.location });
        else throw Error(noteCopy("That canvas is not open or saved anymore.", "该画布已关闭且未保存。"));
      }
      if (canvasDocumentsCurrent().id !== entry.documentId) return;
      const widget = (state.widgets || []).find(item => item.id === entry.objectId && noteCardWidget(item)), box = widget ? widgetBox(widget) : entry.box;
      closeNoteLibrary({ library:true });
      if (!box) return;
      canvasAgentFrameRegion(box, 120);
      if (typeof updateCoordinates === "function") updateCoordinates();
      if (typeof showCanvasIndexHighlight === "function") showCanvasIndexHighlight(box);
    } catch (error) { setStatus(String(error?.message || error)); }
  }

  // ---------- Review (knowledge cards, Leitner boxes) ----------
  async function noteReviewStart(ids = null) {
    const panel = noteCards.panel, now = Date.now();
    if (!panel) return;
    const filter = { query:panel.input.value.trim().slice(0,160), category:panel.category, tag:panel.tag || "", bookmarked:panel.bookmarked ? "1" : "0", sort:"review",style:"card",due:"1" };
    let entries = ids ? noteCards.entries.filter(entry => entry.saved !== false && ids.includes(entry.id))
      : noteCardRuntime().rankNotes(noteCards.entries, { query:filter.query, category:filter.category, tag:filter.tag, bookmarked:panel.bookmarked, sort:"review", style:"card" }).filter(item => item.due).map(item => item.entry);
    let more = false;
    if (!ids) {
      panel.status.textContent = noteCopy("Loading…", "正在读取……");
      try {
        const body = await noteLibraryFetch(`${noteLibraryApi()}?${new URLSearchParams({...filter,limit:String(NOTE_LIBRARY_PAGE_SIZE),offset:"0"})}`);
        if (noteCards.panel !== panel) return;
        entries = body.notes; more = body.nextOffset !== null;
        const byId = new Map(noteCards.entries.map(entry => [entry.id,entry]));
        for (const entry of entries) if (!byId.get(entry.id)?.localDirty) byId.set(entry.id,entry);
        noteCards.entries = [...byId.values()];
      } catch { if (noteCards.panel !== panel) return; }
    }
    const queue = entries.slice(0,40).map(entry => entry.id);
    if (!queue.length) { panel.status.textContent = noteCopy("Nothing is due. Every knowledge card is reviewed.", "没有待复习的卡片。"); return; }
    noteCards.review = { queue, index:0, revealed:false, done:0, started:now, more, filter };
    noteReviewRender();
  }
  async function noteReviewMore(review) {
    if (review.pending) return;
    review.pending = true;
    const panel = noteCards.panel;
    panel.status.textContent = noteCopy("Loading…", "正在读取……");
    try {
      await noteLibraryPersist();
      // Graded cards are no longer due. Read the first remaining page rather
      // than skipping an offset in a queue which shrinks after every grade.
      const body = await noteLibraryFetch(`${noteLibraryApi()}?${new URLSearchParams({...review.filter,limit:String(Math.min(NOTE_LIBRARY_PAGE_SIZE,40-review.done)),offset:"0"})}`);
      if (noteCards.review !== review || noteCards.panel !== panel) return;
      const byId = new Map(noteCards.entries.map(entry => [entry.id,entry]));
      for (const entry of body.notes) if (!review.queue.includes(entry.id)) {
        if (!byId.get(entry.id)?.localDirty) byId.set(entry.id,entry);
        review.queue.push(entry.id);
      }
      noteCards.entries = [...byId.values()];
      review.more = body.nextOffset !== null && review.index < review.queue.length;
    } catch { review.more = false; }
    finally {
      review.pending = false;
      if (noteCards.review === review && noteCards.panel === panel) { panel.reviewKey = ""; noteReviewRender(); }
    }
  }
  function noteReviewStop() {
    noteCards.review = null;
    if (noteCards.panel) { noteCards.panel.reviewCleanup?.(); noteCards.panel.reviewCleanup = null; noteCards.panel.reviewKey = ""; noteCards.panel.element.classList.remove("is-reviewing"); noteCards.panel.grid.hidden = false; }
    noteLibraryRender();
  }
  function noteReviewRender() {
    const panel = noteCards.panel, review = noteCards.review;
    if (!panel || !review) return;
    panel.element.classList.add("is-reviewing");
    const entry = noteCards.entries.find(item => item.id === review.queue[review.index]);
    const key = JSON.stringify([entry?.id, entry?.note, review.index, review.revealed, review.done, state.language]);
    if (panel.reviewKey === key) return;
    panel.reviewKey = key;
    panel.reviewCleanup?.(); panel.reviewCleanup = null;
    panel.grid.hidden = false;
    panel.detail.hidden = true;
    panel.grid.textContent = "";
    const stage = document.createElement("div");
    stage.className = "note-review";
    panel.grid.append(stage);
    if (!entry) {
      if (review.more && review.done < 40) { void noteReviewMore(review); return; }
      const done = document.createElement("div");
      done.className = "note-review-done";
      const strong = document.createElement("strong");
      strong.textContent = noteCopy(`Reviewed ${review.done} cards`, `已复习 ${review.done} 张卡片`);
      done.append(strong, noteChip(noteCopy("Back to library", "返回笔记库"), "", "note-detail-action primary", () => noteReviewStop()));
      stage.append(done);
      panel.status.textContent = "";
      return;
    }
    panel.status.textContent = noteCopy(`Card ${review.index + 1} of ${review.queue.length}`, `第 ${review.index + 1}/${review.queue.length} 张`);
    const note = entry.note, qa = note.blocks.find(block => block.type === "qa"), front = document.createElement("div"), prompt = document.createElement("strong"), hint = document.createElement("span");
    front.className = "note-review-front";
    front.style.setProperty("--note-tile-color", note.category?.color || "#2563eb");
    prompt.textContent = qa ? qa.question.replace(/\$/g, "") : note.title;
    hint.textContent = qa ? note.title : noteCopy("Recall the key idea of this card, then reveal it.", "先回忆这张卡片的要点，再查看。");
    front.append(prompt, hint);
    if (review.revealed) {
      const back = document.createElement("div"), frame = document.createElement("iframe");
      back.className = "note-review-back";
      frame.title = note.title;
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      const hostUrl = widgetHostUrl({id:"general",connect:[]}), hostOrigin = new URL(hostUrl).origin;
      const receive = event => {
        if (event.source !== frame.contentWindow || event.origin !== hostOrigin) return;
        if (event.data?.type === "penecho-widget-host-ready") {
          frame.contentWindow.postMessage({type:"penecho-widget-init",html:noteCardDocument(note, {review:true}),title:note.title,sourceFormat:noteCardRuntime().FORMAT,language:state.language}, hostOrigin);
          frame.contentWindow.postMessage({type:"penecho-widget-state",maximized:true,selected:false,interactive:true,active:true,scaleX:1,scaleY:1}, hostOrigin);
        } else if (event.data?.type === "penecho-widget-capture-ready") back.dataset.ready = "true";
        else if (event.data?.type === "penecho-note-image-open") noteImageOpen(note, event.data.index);
      };
      window.addEventListener("message", receive);
      panel.reviewCleanup = () => window.removeEventListener("message", receive);
      frame.src = hostUrl; back.append(frame);
      stage.append(back);
      const grades = document.createElement("div");
      grades.className = "note-review-grades";
      for (const [grade, en, zh] of [["again", "Again", "再看一次"], ["good", "Good", "记住了"], ["easy", "Easy", "很简单"]]) grades.append(noteChip(noteCopy(en, zh), "", `note-detail-action grade-${grade}`, () => noteReviewGrade(entry, grade)));
      stage.append(grades);
    } else {
      stage.append(front);
      stage.append(noteChip(noteCopy("Show card", "显示卡片"), "", "note-detail-action primary note-review-reveal", () => { review.revealed = true; noteReviewRender(); }));
    }
    stage.append(noteChip(noteCopy("Stop review", "结束复习"), "", "note-detail-action quiet", () => noteReviewStop()));
  }
  function noteReviewGrade(entry, grade) {
    const review = noteCards.review, current = noteCards.entries.find(item => item.id === entry.id);
    if (!review || !current) return;
    current.review = noteCardRuntime().nextReview(current.review, grade);
    noteLibraryPut(current);
    review.done++;
    review.index++;
    review.revealed = false;
    noteReviewRender();
  }

  // ---------- Agent and MCP ----------
  // canvas_create {type:"note"} and MCP present_widget {note} share this.
  function noteCardCreateItem(raw, source = "agent") {
    const NOTE = noteCardRuntime();
    if (!NOTE) throw Error("Note cards are unavailable.");
    const now = Date.now(), note = NOTE.normalize({ ...(raw?.note || raw || {}), created:raw?.note?.created || now, updated:now, source:{ kind:source } }, { categories:noteCategories(), language:state.language }),
      size = noteCardDeckSize();
    return { type:"widget", ...noteCardWidgetFields(note), width:size.w, height:size.h, ...(raw?.placement ? { placement:raw.placement } : {}) };
  }
  function noteCardsStart() {
    noteCardsHookMath();
    noteLibraryWire();
    const refresh = () => void noteLibraryRefreshServer().catch(() => {});
    window.addEventListener("online", refresh);
    window.addEventListener("penecho:cloud-account-changed", () => {
      if (window.PENECHO_CONFIG?.runtime === "cloud") noteLibrarySetAccount(null);
      refresh();
    });
    window.addEventListener("penecho:remote-cloud-status", () => {
      const id = window.PENECHO_REMOTE_CLOUD_STATUS?.accountId;
      if (window.PENECHO_CONFIG?.runtime === "cloud" && noteCards.accountId !== null && id !== noteCards.accountId) noteLibrarySetAccount(null);
      refresh();
    });
    window.addEventListener("beforeunload",event=>{
      const pending=noteCards.dirty.size || (state.widgets||[]).some(widget=>noteCardWidget(widget)&&!noteCards.entries?.some(entry=>entry.id===noteLibraryId(canvasDocumentsCurrent().id,widget.id)));
      if(pending && window.PENECHO_CONFIG?.runtime!=="viewer"){event.preventDefault();event.returnValue="";}
    });
  }
  if (window.PENECHO_NOTE_CARD) noteCardsStart();
