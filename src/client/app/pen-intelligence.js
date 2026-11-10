  // ---------- Pen intelligence: gestures and the step checker ----------
  //
  // Both read the Canvas the way Assist does and ask PenEchoLLM (Cloud)
  // closed, server-owned questions through /api/suggest:
  //   • Pen gestures  — a local shape fit proposes a command mark (circle, double
  //     underline, strike, L axes). Strong cancellations offer locally; other
  //     gestures need PenEchoLLM confirmation before anything runs.
  //   • Step checker  — flags a derivation line that looks wrong. It only
  //     suggests: the focused check runs when the person taps the flag.
  const PEN_INTEL = window.PENECHO_PEN_INTEL || null,
    PEN_INTEL_STORAGE_KEY = "penecho-pen-intelligence",
    PEN_INTEL_TIMEOUT_MS = SMART_SUGGEST_TIMEOUT_MS,
    PEN_GESTURE_OFFER_MS = 9000,
    PEN_GESTURE_ICONS = Object.freeze({ explain:"i", typeset:"∑", solve:"=", plot:"∿", animate:"▶", chart:"▥", delete:"⌫" }),
    penIntel = {
      settings:(() => {
        const defaults = { gestures:true, stepCheck:true };
        try { return { ...defaults, ...JSON.parse(localStorage.getItem(PEN_INTEL_STORAGE_KEY) || "{}") }; } catch { return defaults; }
      })(),
      active:0,
      layer:null,
      frame:0,
      gesture:null,
      raster:null,
      offer:null,
      refineOffer:null,
      step:null,
      stepKeys:new Set(),
    };

  function penIntelCopy(en, zh) { return state.language === "zh" ? zh : en; }
  function penIntelSetting(name) { return penIntel.settings[name] !== false; }
  function setPenIntelSetting(name, value) {
    penIntel.settings[name] = Boolean(value);
    try { localStorage.setItem(PEN_INTEL_STORAGE_KEY, JSON.stringify(penIntel.settings)); } catch {}
    if (name === "gestures" && !value) { clearPenGesture("disabled"); dismissPenGestureOffer("disabled"); }
    if (name === "stepCheck" && !value) clearStepFlag("disabled");
    syncPenIntelToggles();
  }
  function syncPenIntelToggles() {
    for (const [id, name] of [["penGesturesToggle", "gestures"], ["stepCheckToggle", "stepCheck"]]) {
      const toggle = document.getElementById(id);
      if (!toggle) continue;
      toggle.classList.toggle("on", penIntelSetting(name));
      toggle.setAttribute("aria-checked", String(penIntelSetting(name)));
    }
  }
  // PenEchoLLM needs a configured relay and remaining allowance; the settings
  // above decide which features may use it.
  function penIntelRemote() {
    return Boolean(PEN_INTEL && SMART_SUGGEST && smartSuggest.available && !suggestionAccessBlocked());
  }
  function penIntelSleep(ms, signal) {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once:true });
    });
  }
  // Cloud allows two concurrent analyses per account. Assist and Widget ranking
  // keep their own requests, so these features wait for a free slot and
  // background work (indexing) waits until nothing else is running.
  function penIntelOtherBusy() {
    return (smartSuggest.controller ? 1 : 0) + (typeof widgetAssist === "object" && widgetAssist?.controllers ? widgetAssist.controllers.size : 0);
  }
  async function penIntelSlot(background, signal) {
    const deadline = performance.now() + (background ? 60000 : PEN_INTEL_TIMEOUT_MS);
    while (!signal?.aborted && performance.now() < deadline) {
      const busy = penIntel.active + penIntelOtherBusy();
      if (background ? busy === 0 : penIntel.active < 1 && busy < 2) return true;
      await penIntelSleep(120, signal);
    }
    return false;
  }
  // One PenEchoLLM call in the Cloud action space. Returns the typed answers,
  // or null when the service is unavailable (every feature then falls back).
  async function penechoLLMRequest(mode, image, context, options) {
    options ||= {};
    if ((!image && mode !== "note_rank") || !penIntelRemote()) return null;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.min(PEN_INTEL_TIMEOUT_MS, options.timeoutMs || PEN_INTEL_TIMEOUT_MS)),
      abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once:true });
    let slot = false;
    try {
      slot = await penIntelSlot(options.background, controller.signal);
      if (!slot || controller.signal.aborted) return null;
      penIntel.active++;
      const started = performance.now(),
        response = await fetch(suggestionApiPath(), {
          method:"POST",
          credentials:"same-origin",
          signal:controller.signal,
          headers:authenticatedApiHeaders({ "Content-Type":"application/json", Accept:"application/json", "X-PenEcho-Suggest":"1" }),
          body:JSON.stringify({ version:1, mode, ...(image ? {image} : {}), context:context || {} }),
        }),
        data = await response.json().catch(() => null);
      updateSuggestionAccess(data);
      if (!response.ok || !data?.ok || !data.answers) {
        debug("penecho-llm-unavailable", { mode, reason:data?.reason || `http-${response.status}` });
        return null;
      }
      debug("penecho-llm", { mode, latencyMs:Math.round(performance.now() - started), cached:data.cached === true });
      return data.answers;
    } catch (error) {
      if (!controller.signal.aborted) debug("penecho-llm-failed", { mode, error:String(error?.message || error).slice(0, 160) });
      return null;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (slot) penIntel.active = Math.max(0, penIntel.active - 1);
    }
  }

  // ---------- Overlay layer (flags and offers beside the ink) ----------
  function penIntelLayer() {
    if (penIntel.layer?.isConnected) return penIntel.layer;
    const parent = smartSuggestLayer?.parentElement;
    if (!parent) return null;
    const layer = document.createElement("div");
    layer.className = "pen-intel-layer";
    layer.setAttribute("aria-live", "polite");
    parent.insertBefore(layer, smartSuggestLayer.nextSibling);
    penIntel.layer = layer;
    return layer;
  }
  function penIntelSyncWriting() {
    for (const element of [penIntel.offer?.element, penIntel.refineOffer?.element, penIntel.step?.chip].filter(Boolean)) {
      const writing = Boolean(state.drawing || element === penIntel.step?.chip && performance.now() < smartSuggest.localReadyAt);
      element.classList.toggle("is-writing", writing);
      element.inert = writing;
    }
  }
  // Reserve the same screen-space writing clearance as Assist. On a crowded
  // screen keep the chip visible, giving distance from current ink priority
  // over older content. Reuse the placement until ink or geometry changes.
  function penIntelPlace(element, box) {
    penIntelSyncWriting();
    if (state.drawing) return false;
    const screen = assistScreenBox(box), { width, height } = canvasViewportMetrics();
    if (!screen) return false;
    const w = element.offsetWidth || 200, h = element.offsetHeight || 34, gap = ASSIST_INK_CLEARANCE_PX,
      previous = element.penIntelPlacement, now = performance.now(), navigation = element.penIntelNavigation,
      changed = navigation && (navigation.scale !== state.scale || navigation.panX !== state.panX || navigation.panY !== state.panY),
      navigating = Boolean(state.panGesture || state.touchGesture),
      until = changed || navigating ? now + ASSIST_NAVIGATION_SETTLE_MS : navigation?.until || 0;
    element.penIntelNavigation = { scale:state.scale, panX:state.panX, panY:state.panY, until };
    let x = screen.x + screen.w + gap, y = screen.y + screen.h / 2 - h / 2;
    if (navigating || now < until) {
      // Navigation frames only transform the last position; no pixel reads.
      if (previous) {
        x = (previous.x - previous.panX) * state.scale / previous.scale + state.panX;
        y = (previous.y - previous.panY) * state.scale / previous.scale + state.panY;
      }
      x = Math.max(8, Math.min(width - w - 8, x));
      y = Math.max(8, Math.min(height - h - 84, y));
    } else {
      const assist = smartSuggest.bar?.element,
        surfaces = [assist, element === penIntel.step?.chip ? penIntel.refineOffer?.element || penIntel.offer?.element : null]
          .filter(surface => surface && !surface.inert),
        obstacles = surfaces.map(canvasElementLayoutRect).filter(rect => rect?.width && rect.height)
          .map(rect => ({ x:rect.left, y:rect.top, w:rect.width, h:rect.height })),
        mask = assistContentMask(width, height), anchorKey = JSON.stringify([screen, width, height, obstacles]);
      if (previous?.mask === mask && previous.w === w && previous.h === h && previous.anchorKey === anchorKey) ({ x, y } = previous);
      else {
        ({ x, y } = assistFindPlacement(mask, w, h, previous?.anchorKey === anchorKey ? previous : { x, y }, screen,
          { inkGap:gap, prioritizeInkGap:true, obstacles }));
        element.penIntelPlacement = { x, y, w, h, mask, anchorKey, scale:state.scale, panX:state.panX, panY:state.panY };
      }
    }
    const kind = element.classList.contains("pen-step-flag") ? "step" : element.classList.contains("pen-gesture-offer") ? "gesture" : "refine",
      style = runtimeElementStyle(element, `pen-intel-${kind}`), roundedX = Math.round(x), roundedY = Math.round(y);
    if (element.penIntelScreenX !== roundedX) { style?.setProperty("--pen-intel-x", `${roundedX}px`); element.penIntelScreenX = roundedX; }
    if (element.penIntelScreenY !== roundedY) { style?.setProperty("--pen-intel-y", `${roundedY}px`); element.penIntelScreenY = roundedY; }
    return screen.x < width && screen.y < height && screen.x + screen.w > 0 && screen.y + screen.h > 0;
  }
  function penIntelTrack() {
    if (penIntel.frame) return;
    const step = () => {
      penIntel.frame = 0;
      let alive = false;
      const offer = penIntel.offer;
      if (offer) {
        if (offer.records.some(record => !state.history.includes(record.historyEntry)) || performance.now() > offer.expiresAt || canvasDocumentsCurrent().id !== offer.documentId
          || offer.pending.revision != null && offer.pending.revision !== state.userRevision) dismissPenGestureOffer("expired");
        else {
          penIntelPlace(offer.element, offer.box);
          alive = true;
        }
      }
      const flag = penIntel.step;
      const refine = penIntel.refineOffer;
      if (refine) {
        if (!assistWidgetRefineTargetValid(refine.target) || performance.now() > refine.expiresAt
          || state.drawing || state.selection || state.viewMode || state.mode !== "pen"
          || state.pending || state.pendingWidget || state.widgetRefineConfirmation || activeWidgetRefinement()) dismissWidgetInkRefineOffer("expired");
        else { penIntelPlace(refine.element, refine.target.box); alive = true; }
      }
      if (flag) {
        if (flag.strokes.some(record => !state.history.includes(record.historyEntry)) || canvasDocumentsCurrent().id !== flag.documentId) clearStepFlag("ink-changed");
        else {
          const screen = assistScreenBox(flag.lineBox);
          if (screen) {
            flag.underline.style.setProperty("--pen-intel-x", `${Math.round(screen.x)}px`);
            flag.underline.style.setProperty("--pen-intel-y", `${Math.round(screen.y + screen.h + 2)}px`);
            flag.underline.style.setProperty("--pen-intel-w", `${Math.max(24, Math.round(screen.w))}px`);
          }
          penIntelPlace(flag.chip, flag.lineBox);
          alive = true;
        }
      }
      if (typeof canvasIndexTrack === "function" && canvasIndexTrack()) alive = true;
      if (alive) penIntel.frame = requestAnimationFrame(step);
    };
    penIntel.frame = requestAnimationFrame(step);
  }
  function penIntelButton(label, icon, className, onClick, title = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    if (icon) {
      const glyph = document.createElement("span");
      glyph.className = "pen-intel-icon";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = icon;
      button.append(glyph);
    }
    if (label) {
      const text = document.createElement("span");
      text.textContent = label;
      button.append(text);
    }
    if (title) { button.title = title; button.setAttribute("aria-label", title); }
    button.addEventListener("pointerdown", event => event.stopPropagation());
    button.addEventListener("click", event => { event.stopPropagation(); onClick(event); });
    return button;
  }

  // ---------- 1. Pen gestures ----------
  function penGestureLabel(gesture) {
    return {
      explain:penIntelCopy("Explain this", "解释这里"),
      typeset:penIntelCopy("Typeset", "排版"),
      solve:penIntelCopy("Solve", "求解"),
      plot:penIntelCopy("Plot", "绘图"),
      animate:penIntelCopy("Animate", "动画讲解"),
      chart:penIntelCopy("Make a chart", "生成图表"),
      delete:penIntelCopy("Delete", "删除"),
    }[gesture] || gesture;
  }
  // Immediate local annotation offer, using the same surface as Delete.
  // Classification can continue behind it; no model or gesture setting is needed.
  function widgetInkRefineButton(target) {
    const label = SMART_SUGGEST.label(SMART_SUGGEST.actionById("refine"), state.language),
      button = penIntelButton(label, "✦", "pen-intel-action", () => executeAssistWidgetRefinement(target),
        penIntelCopy(`Refine Widget: ${target.widget.title || "Widget"}`, `修改 Widget：${target.widget.title || "Widget"}`));
    button.dataset.widgetRefine = target.widgetId;
    return button;
  }
  function dismissWidgetInkRefineOffer(reason) {
    const offer = penIntel.refineOffer;
    if (!offer) return;
    penIntel.refineOffer = null;
    offer.element.remove();
    debug("widget-ink-refine-offer-closed", { reason });
  }
  function offerWidgetInkRefinement(target) {
    dismissWidgetInkRefineOffer("replaced");
    if (!smartSuggest.enabled || !assistWidgetRefineTargetValid(target) || state.viewMode || state.selection || state.mode !== "pen"
      || state.pending || state.pendingWidget || state.pendingWidgetReplacement || activeWidgetRefinement()) return;
    hideWidgetRefineHint();
    if (penDeleteOfferVisible()) {
      const element = penIntel.offer.element;
      element.querySelector("[data-widget-refine]")?.remove();
      element.append(widgetInkRefineButton(target));
      penIntelPlace(element, penIntel.offer.box);
      return;
    }
    const layer = penIntelLayer();
    if (!layer) return;
    const element = document.createElement("div");
    element.className = "pen-intel-chip pen-widget-refine-offer";
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", SMART_SUGGEST.label(SMART_SUGGEST.actionById("refine"), state.language));
    element.append(widgetInkRefineButton(target), penIntelButton(penIntelCopy("Keep as ink", "保留笔迹"), "", "pen-intel-quiet", () => dismissWidgetInkRefineOffer("kept")));
    element.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); dismissWidgetInkRefineOffer("escape"); } });
    layer.append(element);
    penIntel.refineOffer = { element, target, expiresAt:performance.now() + PEN_GESTURE_OFFER_MS };
    penIntelPlace(element, target.box);
    element.classList.add("visible");
    penIntelTrack();
  }
  function penGesturePending() { return Boolean(penIntel.gesture); }
  function penDeleteOfferVisible() { return penIntel.offer?.gesture === "delete"; }
  // Earlier vector strokes, so a strike can take whole strokes it crosses.
  function penGestureStrokes(exclude) {
    return smartSuggest.strokes.filter(record => !exclude.has(record.id) && state.history.includes(record.historyEntry)).map(record => ({ id:record.id, points:record.points, box:record.box, at:record.at }));
  }
  function penGestureContentBoxes(exclude) {
    const boxes = [];
    for (const record of smartSuggest.strokes) if (!exclude.has(record.id) && state.history.includes(record.historyEntry)) boxes.push({ ...record.box, at:record.at, stroke:true });
    for (const widget of state.widgets || []) boxes.push(widgetBox(widget));
    for (const image of state.images || []) boxes.push(imageBox(image));
    for (const text of state.textBoxes || []) boxes.push(textBoxBox(text));
    return boxes;
  }
  // Fraction of a Canvas box covered by committed ink (raster tiles): catches
  // ink loaded from files, which has no vector history.
  function penIntelInkDensity(box) {
    if (!box || !(box.w > 0) || !(box.h > 0)) return 0;
    const side = 40, out = document.createElement("canvas");
    out.width = out.height = side;
    const context = out.getContext("2d", { willReadFrequently:true }), sx = side / box.w, sy = side / box.h;
    context.setTransform(sx, 0, 0, sy, -box.x * sx, -box.y * sy);
    forTiles(box.x, box.y, box.w, box.h, (canvas, tx, ty) => context.drawImage(canvas, tx * TILE, ty * TILE), false);
    const data = context.getImageData(0, 0, side, side).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 40) count++;
    return count / (side * side);
  }
  function penGestureAllowed() {
    return Boolean(PEN_INTEL && penIntelSetting("gestures") && state.mode === "pen" && !state.viewMode && !state.selection && !state.activeAI);
  }
  function penIntelRasterDeletion(record, region, marks = [record]) {
    const changes = marks.flatMap(mark => mark.historyEntry?.tiles || []);
    if (!Array.isArray(changes) || !changes.length || Math.ceil(region.w / TILE + 1) * Math.ceil(region.h / TILE + 1) > 36) return null;
    // Reconstruct ink before the FIRST mark, retaining the earliest snapshot
    // for each touched tile. The first line must not join the target raster.
    const before = new Map();
    for (const change of changes) if (!before.has(change.k)) before.set(change.k, change.before);
    const scale = Math.min(1, 384 / Math.max(region.w, region.h), Math.sqrt(32768 / (region.w * region.h))), out = document.createElement("canvas");
    out.width = Math.max(1, Math.floor(region.w * scale)); out.height = Math.max(1, Math.floor(region.h * scale));
    const context = out.getContext("2d", { willReadFrequently:true });
    context.setTransform(out.width / region.w, 0, 0, out.height / region.h, -region.x * out.width / region.w, -region.y * out.height / region.h);
    forTiles(region.x, region.y, region.w, region.h, (canvas, tx, ty) => {
      const key = `${tx},${ty}`, ink = before.has(key) ? before.get(key) : canvas;
      if (ink) context.drawImage(ink, tx * TILE, ty * TILE);
    }, false);
    const data = context.getImageData(0, 0, out.width, out.height).data,
      candidates = marks.map(mark => PEN_INTEL.rasterDeletionTarget(data, out.width, out.height, region, mark.points, mark.size)).filter(Boolean);
    if (!candidates.length) return null;
    const candidate = { ...candidates.at(-1), confidence:Math.max(...candidates.map(item => item.confidence)),
      target:candidates.reduce((box, item) => PEN_INTEL.union(box, item.target), null) };
    for (const item of candidates.slice(0, -1)) for (let i = 0; i < candidate.mask.data.length; i++) candidate.mask.data[i] |= item.mask.data[i];
    return candidate;
  }
  function cancelPenRasterDeletion() {
    const pending = penIntel.raster;
    if (!pending) return;
    clearTimeout(pending.timer);
    if (pending.idle != null) window.cancelIdleCallback?.(pending.idle);
    penIntel.raster = null;
  }
  function schedulePenRasterDeletion(record, region, marks = [record]) {
    cancelPenRasterDeletion();
    if (!Array.isArray(record.historyEntry?.tiles) || (!smartSuggest.enabled && !penIntelSetting("gestures"))) return;
    const pending = { documentId:canvasDocumentsCurrent().id, revision:state.userRevision, timer:null, idle:null };
    penIntel.raster = pending;
    const inspect = () => {
      if (penIntel.raster !== pending) return;
      penIntel.raster = null;
      if (state.drawing || state.activeAI || state.pending || state.mode !== "pen" || record.exact || canvasDocumentsCurrent().id !== pending.documentId
        || state.userRevision !== pending.revision || smartSuggest.strokes.at(-1) !== record || marks.some(mark => !state.history.includes(mark.historyEntry))) return;
      const started = performance.now(), candidate = penIntelRasterDeletion(record, region, marks);
      debug("pen-delete-raster", { durationMs:performance.now() - started, matched:Boolean(candidate) });
      if (!candidate) return;
      record.deletionGesture = candidate;
      clearPenGesture("raster-delete");
      penIntelStrokeFinished(record);
      assistRefresh("raster-delete");
      scheduleSmartSuggest(0);
    };
    // Never read pixels on pointermove or pen-up. A new pen-down cancels this
    // job; only one bounded raster analysis can be waiting at a time.
    pending.timer = setTimeout(() => {
      if (penIntel.raster !== pending) return;
      if (typeof window.requestIdleCallback === "function") pending.idle = window.requestIdleCallback(inspect);
      else pending.timer = setTimeout(inspect, 0);
    }, 400);
  }
  // Called for every finished pen stroke. Returns true while the stroke is held
  // as a possible command. Auto AI keeps its independent user-set deadline.
  function penIntelStrokeFinished(record) {
    if (!record || record.exact || !penGestureAllowed()) { if (penIntel.gesture && !penIntel.gesture.resolving) clearPenGesture("continued-input"); return false; }
    const pending = penIntel.gesture?.resolving ? null : penIntel.gesture, now = performance.now();
    // A cancellation owns only its marked strokes. Continued ordinary writing
    // must never be silently appended to the set that a Delete tap will erase.
    if (pending && !["strike", "scribble"].includes(pending.local.shape) && !record.deletionGesture && now - pending.lastAt <= PEN_INTEL.GESTURE_FOLLOW_MS * 1.6) {
      const near = PEN_INTEL.inflate(pending.box, Math.max(pending.box.w, pending.box.h) * 0.9 + 24 / Math.max(0.03, state.scale));
      if (PEN_INTEL.overlap(near, record.box)) {
        // A second underline makes a double underline; anything else nearby
        // (a question mark, an arrow) joins the gesture for PenEchoLLM to read.
        if (pending.local.shape === "underline") {
          const second = PEN_INTEL.classifyGestureStroke(record.points, { size:record.size, contentBoxes:penGestureContentBoxes(new Set([...pending.records.map(item => item.id), record.id])), strokes:penGestureStrokes(new Set([...pending.records.map(item => item.id), record.id])), tolerance:4 / Math.max(0.03, state.scale), probe:penIntelInkDensity, now, pauseMs:0 }),
            combined = PEN_INTEL.combineUnderlines(pending.local, second, { size:record.size });
          if (combined) pending.local = combined;
        }
        pending.records.push(record);
        pending.box = PEN_INTEL.union(pending.box, record.box);
        pending.lastAt = now;
        pending.revision = state.userRevision;
        clearTimeout(pending.timer);
        pending.timer = setTimeout(resolvePenGesture, Math.max(0, smartSuggest.inkReadyAt - performance.now()));
        return true;
      }
    }
    // A distant or long continued stroke turns the old candidate back into
    // ordinary ink. Never launch an old gesture immediately at the new pen-up,
    // or leave its paused timer blocking subsequent ink classification.
    if (pending) clearPenGesture("continued-input");
    const excluded = new Set(record.deletionMarkIds || [record.id]),
      records = record.deletionGesture ? smartSuggest.strokes.filter(item => excluded.has(item.id)) : [record],
      local = record.deletionGesture || PEN_INTEL.classifyGestureStroke(record.points, { size:record.size, contentBoxes:penGestureContentBoxes(excluded), strokes:penGestureStrokes(excluded), tolerance:4 / Math.max(0.03, state.scale), probe:penIntelInkDensity, now });
    if (!local) return false;
    dismissPenGestureOffer("new-gesture");
    penIntel.gesture = { records, local, box:records.reduce((box, item) => PEN_INTEL.union(box, item.box), null), lastAt:now, revision:state.userRevision, documentId:canvasDocumentsCurrent().id, timer:setTimeout(resolvePenGesture, Math.max(0, smartSuggest.inkReadyAt - performance.now())), controller:null };
    debug("pen-gesture-candidate", { shape:local.shape, confidence:local.confidence });
    return true;
  }
  function clearPenGesture(reason) {
    const pending = penIntel.gesture;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.controller?.abort();
    penIntel.gesture = null;
    debug("pen-gesture-cleared", { reason });
  }
  // Release the ink to Assist without restarting the Auto AI countdown.
  function releasePenGestureInk() {
    scheduleAssist();
  }
  async function resolvePenGesture() {
    const pending = penIntel.gesture;
    if (!pending || pending.resolving) return;
    pending.resolving = true;
    clearTimeout(pending.timer);
    const controller = new AbortController();
    pending.controller = controller;
    let answers = null;
    try {
      if (PEN_INTEL.gestureDecision(null, pending.local).gesture !== "delete" && penIntelRemote()) {
        const target = pending.local.target || pending.box,
          cluster = { gesture:true, strokes:pending.records, recentIds:new Set(pending.records.map(record => record.id)), box:PEN_INTEL.union(target, pending.box), newBox:{ ...pending.box } },
          region = smartSuggestCropRegion(cluster);
        if (region) {
          // A gesture over a Widget is classified only with that Widget's
          // current pixels; otherwise the local decision stands.
          const required = smartSuggestRequiredWidgets(cluster, region, false),
            prepared = required.length ? await ensureWidgetSnapshots(required, { signal:controller.signal, timeoutMs:WIDGET_CLASSIFY_SNAPSHOT_TIMEOUT_MS }) : { complete:true };
          if (!prepared.complete) debug("pen-gesture-snapshot-unavailable", { missing:prepared.missing, widgetIds:prepared.missingWidgets.map(widget => widget.id) });
          const image = prepared.complete && !controller.signal.aborted && smartSuggestCrop(cluster, region, false);
          if (image) {
            answers = await penechoLLMRequest("gesture", image, { shape:PEN_INTEL.GESTURE_SHAPES.includes(pending.local.shape) ? pending.local.shape : "enclosure" }, { signal:controller.signal });
          }
        }
      }
    } catch (error) {
      debug("pen-gesture-unavailable", { message:String(error?.message || error) });
    } finally {
      if (penIntel.gesture === pending) penIntel.gesture = null;
    }
    if (controller.signal.aborted || canvasDocumentsCurrent().id !== pending.documentId || pending.records.some(record => !state.history.includes(record.historyEntry))) { releasePenGestureInk(); return; }
    const decision = PEN_INTEL.gestureDecision(answers, pending.local);
    debug("pen-gesture-decision", { shape:pending.local.shape, ...decision });
    if (decision.act === "run" && !state.auto) runPenGesture(pending, decision.gesture);
    else if (decision.act === "offer" || decision.act === "run") offerPenGesture(pending, decision);
    else releasePenGestureInk();
  }
  function offerPenGesture(pending, decision) {
    if (decision.gesture === "delete") {
      for (const record of pending.records) record.deletionGesture = pending.local;
      hideAssist("delete-gesture");
    }
    const layer = penIntelLayer();
    if (!layer) { releasePenGestureInk(); return; }
    dismissPenGestureOffer("replaced");
    const element = document.createElement("div");
    element.className = "pen-intel-chip pen-gesture-offer";
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", penIntelCopy("Pen gesture", "笔势指令"));
    const label = penGestureLabel(decision.gesture),
      run = penIntelButton(`${label}?`, PEN_GESTURE_ICONS[decision.gesture] || "✦", "pen-intel-action", () => {
        const offer = penIntel.offer;
        dismissPenGestureOffer("accepted", false);
        if (offer) runPenGesture(offer.pending, decision.gesture);
      }, penIntelCopy(`Pen gesture: ${label}`, `笔势：${label}`)),
      keep = penIntelButton(penIntelCopy("Keep as ink", "保留笔迹"), "", "pen-intel-quiet", () => dismissPenGestureOffer("kept"));
    run.dataset.gesture = decision.gesture;
    if (decision.gesture === "delete") run.classList.add("danger");
    element.append(run, keep);
    if (decision.gesture === "delete") {
      dismissWidgetInkRefineOffer("delete-offer");
      const target = assistWidgetRefineTarget({ strokes:pending.records });
      if (target) element.append(widgetInkRefineButton(target));
    }
    layer.append(element);
    penIntel.offer = { element, pending, gesture:decision.gesture, records:pending.records, box:PEN_INTEL.union(pending.local.target, pending.box), expiresAt:performance.now() + PEN_GESTURE_OFFER_MS, documentId:pending.documentId };
    penIntelPlace(element, penIntel.offer.box);
    element.classList.add("visible");
    penIntelTrack();
  }
  function dismissPenGestureOffer(reason, release = true) {
    const offer = penIntel.offer;
    if (!offer) return;
    penIntel.offer = null;
    offer.element.remove();
    debug("pen-gesture-offer-closed", { reason });
    if (release && reason !== "replaced" && reason !== "new-gesture") releasePenGestureInk();
  }
  function runPenGesture(pending, gesture) {
    const target = pending.local.target || pending.box, records = pending.records.filter(record => state.history.includes(record.historyEntry));
    if (canvasDocumentsCurrent().id !== pending.documentId || !records.length || records.length !== pending.records.length || state.drawing || state.activeAI
      || state.pending || state.selection || state.viewMode || pending.revision != null && pending.revision !== state.userRevision) return;
    if (gesture === "delete") {
      // Delete is a local Canvas edit, including confirmed Widget targets.
      clearTimeout(state.timer); state.timer = 0;
      cancelPenRasterDeletion();
      executeAssistDeletion({ box:PEN_INTEL.union(target, pending.box), newBox:pending.box, strokes:records,
        deletion:{ ...pending.local, marks:records, markBox:pending.box, box:PEN_INTEL.union(target, pending.box) } });
      return;
    }
    smartSuggest.consumedStrokeId = Math.max(smartSuggest.consumedStrokeId, ...records.map(record => record.id));
    smartSuggestRecent(`gesture ${gesture}`);
    setStatus(penIntelCopy(`Pen gesture · ${penGestureLabel(gesture)}`, `笔势 · ${penGestureLabel(gesture)}`));
    const box = { ...target };
    // The mark is a command, not content: lift it before the model looks.
    liftStrokes(records);
    if (gesture === "chart") {
      clearTimeout(state.timer);
      state.timer = 0;
      supersedeActiveAI("pen-gesture");
      const requestTarget = { box, newBox:box, strokes:[] };
      renderAssist({ mode:"working", label:penGestureLabel("chart"), box, target:requestTarget, action:{ id:"chart" } });
      requestTarget.requestPromise = requestAI("plot", null, { ...assistRequestOptions(requestTarget), attentionBox:box, focusAttention:true, suggestion:"chart" });
      return;
    }
    executeAssistAction({ id:gesture, source:"gesture" }, { box, newBox:box, strokes:[] });
  }

  // ---------- 2. Step checker (suggestion only) ----------
  async function stepCheckerConsider(cluster, inkAnswers, region) {
    if (!PEN_INTEL || !penIntelSetting("stepCheck") || !smartSuggest.enabled || !cluster || cluster.selection || !region) return;
    const features = assistLocalFeatures(cluster, assistAnalyze(cluster));
    if (!PEN_INTEL.stepCheckCandidate(inkAnswers, features)) return;
    const key = `${canvasDocumentsCurrent().id}:${[...cluster.recentIds].join(",")}`;
    if (penIntel.stepKeys.has(key)) return;
    penIntel.stepKeys.add(key);
    if (penIntel.stepKeys.size > 200) penIntel.stepKeys.delete(penIntel.stepKeys.values().next().value);
    const documentId = canvasDocumentsCurrent().id, image = smartSuggestCrop(cluster, region);
    if (!image) return;
    const answers = await penechoLLMRequest("step", image, {});
    if (canvasDocumentsCurrent().id !== documentId || cluster.strokes.some(record => !state.history.includes(record.historyEntry))) return;
    const decision = PEN_INTEL.stepDecision(answers);
    debug("step-check", { flagged:decision.flagged, score:decision.score, step:answers?.step?.choice });
    if (decision.flagged) showStepFlag(cluster, decision, documentId);
  }
  function showStepFlag(cluster, decision, documentId) {
    const layer = penIntelLayer();
    if (!layer) return;
    clearStepFlag("replaced");
    const underline = document.createElement("div"), chip = document.createElement("div");
    underline.className = "pen-step-underline";
    underline.setAttribute("aria-hidden", "true");
    chip.className = "pen-intel-chip pen-step-flag";
    chip.setAttribute("role", "group");
    chip.setAttribute("aria-label", penIntelCopy("Step checker", "步骤检查"));
    const recent = cluster.strokes.filter(record => cluster.recentIds.has(record.id)),
      lineBox = recent.reduce((box, record) => PEN_INTEL.union(box, record.box), null) || cluster.newBox,
      target = { box:{ ...cluster.box }, newBox:{ ...cluster.newBox }, strokes:[...cluster.strokes] },
      check = penIntelButton(penIntelCopy("This step may be wrong — check it?", "这一步可能有误，检查一下？"), "✓", "pen-intel-action", () => {
        clearStepFlag("accepted");
        executeAssistAction({ id:"check_step", source:"step-checker" }, target);
      }, penIntelCopy("Check this step", "检查这一步")),
      close = penIntelButton("", "×", "pen-intel-close", () => clearStepFlag("dismissed"), penIntelCopy("Dismiss", "忽略"));
    check.dataset.stepScore = String(decision.score ?? "");
    chip.append(check, close);
    layer.append(underline, chip);
    penIntel.step = { underline, chip, lineBox, strokes:cluster.strokes, documentId };
    chip.classList.add("visible");
    penIntelTrack();
  }
  function clearStepFlag(reason) {
    const flag = penIntel.step;
    if (!flag) return;
    penIntel.step = null;
    flag.underline.remove();
    flag.chip.remove();
    debug("step-flag-closed", { reason });
  }

  for (const [id, name] of [["penGesturesToggle", "gestures"], ["stepCheckToggle", "stepCheck"]]) {
    document.getElementById(id)?.addEventListener("click", () => setPenIntelSetting(name, !penIntelSetting(name)));
  }
  syncPenIntelToggles();
