// Pointer and control bindings, portable snapshots, and application startup.
  function updateCanvasPointerPreview(event) {
    const drawing = state.drawing,
      next = state.mode === "eraser"
        && event.pointerType !== "touch"
        && (!drawing || drawing.erase && drawing.id === event.pointerId)
        ? clientPoint(event)
        : null,
      preview = next && valid(next) ? next : null,
      changed = Boolean(preview) !== Boolean(state.pointerPreview)
        || preview && (!state.pointerPreview || Math.abs(preview.x - state.pointerPreview.x) > 0.01 || Math.abs(preview.y - state.pointerPreview.y) > 0.01);
    if (!changed) return;
    state.pointerPreview = preview;
    requestInteractionLayerRender();
  }
  function beginCanvasPointerAction(e, point) {
    if (state.selectedAnimationId) acceptAnimationEdit();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (state.mode === "hand") {
      state.panGesture = {
        id: e.pointerId,
        last: { x: e.clientX, y: e.clientY },
      };
      setCanvasCursor("grabbing");
      setNavigating(true);
      return;
    }
    if (state.mode === "text" && e.pointerType === "touch") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      state.textTap = { id: e.pointerId, startX: e.clientX, startY: e.clientY, point };
      return;
    }
    if (state.mode === "text") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      createTextEditor(point);
      return;
    }
    if (state.mode === "select" && e.pointerType !== "touch") {
      if (state.pending) {
        setStatusKey("pendingConfirm");
        return;
      }
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      deselectAnimation();
      handleSelectionPointerDown(e, point);
      return;
    }
    if (e.pointerType === "touch") {
      state.panGesture = {
        id: e.pointerId,
        last: { x: e.clientX, y: e.clientY },
      };
      setNavigating(true);
      return;
    }
    const p = point;
    if (!valid(p)) {
      setStatusKey("outsideCanvas");
      return;
    }
    supersedeActiveAI("user-input-started");
    clearTimeout(state.timer);
    state.timer = 0;
    hideWidgetRefineHint();
    const erasing = state.mode === "eraser";
    if (erasing) clearWidgetRefineCandidate();
    else state.latestTypedInput = null;
    const cssSize = erasing ? state.eraser : pressureWidth(e),
      size = logicalWidth(cssSize);
    state.userRevision++;
    state.drawing = {
      id: e.pointerId,
      last: p,
      size,
      start: p,
      points: 1,
      screenDistance: 0,
      widthMin: cssSize,
      widthMax: cssSize,
      bbox: { x: p.x, y: p.y, w: 0, h: 0 },
      trail: [p],
      erase: erasing,
      dirtyMaskTouched:erasing ? new Set() : null,
    };
    updateCanvasPointerPreview(e);
    dot(p, erasing, size, true);
    requestRender();
  }
  screen.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    finishStaleWidgetHostGesture(e);
    if (Date.now() < state.textInputBlockedUntil) return;
    try {
      screen.setPointerCapture(e.pointerId);
    } catch {}
    calibrateScreenClientRatio(e, false);
    const handPoint = state.mode === "hand" ? clientPoint(e) : null;
    beginCanvasWidgetGestureResetTap(e, handPoint);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (handPoint) beginHandObjectFocus(e, handPoint);
    if (e.pointerType === "touch") {
      const touchPoint = clientPoint(e),
        touchWidget = valid(touchPoint) ? widgetAtRefinePoint(touchPoint) : null;
      if (touchWidget) {
        if (state.mode !== "hand") showCanvasHint("canvasHintWidgetTouchHand");
        if (state.mode === "pen") beginWidgetRefineTouch(`canvas-touch:${e.pointerId}`, touchWidget);
      }
      state.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.mode === "hand" && state.handGestureIncludesWidget) return;
      if (state.touches.size >= 2) {
        state.textTap = null;
        if (state.pendingGesture) state.pendingGesture = null;
        if (state.widgetGesture) finishWidgetGesture({ pointerId:state.widgetGesture.id });
        if (state.selectedWidgetId) acceptWidgetEdit();
        if (state.imageGesture) finishImageGesture({ pointerId:state.imageGesture.id });
        if (state.animationGesture) finishAnimationGesture({ pointerId: state.animationGesture.id });
        if (state.selectedAnimationId) acceptAnimationEdit();
        finishDrawing("pen");
        beginTouchGesture();
        return;
      }
    }
    if (isMousePan(e)) {
      if (state.selectedWidgetId) acceptWidgetEdit();
      if (state.selectedAnimationId) acceptAnimationEdit();
      state.panGesture = {
        id: e.pointerId,
        last: { x: e.clientX, y: e.clientY },
      };
      setCanvasCursor("grabbing");
      setNavigating(true);
      return;
    }
    if (state.mode !== "hand") {
      beginCanvasPointerAction(e, clientPoint(e));
      return;
    }
    if (state.pending) {
      const result = pendingHit(state.pending, e, state.pending.revealProgress < 1),
        hit = typeof result === "string" ? result : result?.hit,
        itemIndex = result && typeof result === "object" ? result.itemIndex : null;
      if (["resize", "width", "height", "batch-resize"].includes(hit)) {
        beginPendingGesture(e, hit, itemIndex);
        return;
      }
    }
    const point = handPoint || clientPoint(e);
    const widgetResult = widgetRuntimeEnabled() && valid(point) ? widgetPointerHit(point, e.pointerType, false) : null;
    if (widgetResult && ["resize", "width", "height"].includes(widgetResult.hit)) {
      refreshHandObjectToolbar();
      beginWidgetGesture(e, point, widgetResult);
      return;
    }
    if (state.selectedWidgetId) acceptWidgetEdit();
    const selectedImageResult = valid(point) ? imagePointerHit(point, e.pointerType, false) : null;
    if (selectedImageResult && selectedImageResult.hit !== "move") {
      if (state.selectedAnimationId) acceptAnimationEdit();
      refreshHandObjectToolbar();
      beginImageGesture(e, point, selectedImageResult);
      return;
    }
    if (valid(point)) {
      const animationResult = animationPointerHit(point, e.pointerType);
      if (animationResult && animationResult.hit !== "move") {
        refreshHandObjectToolbar();
        beginAnimationGesture(e, point, animationResult);
        return;
      }
    }
    beginCanvasPointerAction(e, point);
  });
  screen.addEventListener("pointermove", (e) => {
    e.preventDefault();
    updateCanvasWidgetGestureResetTap(e);
    if (finishReleasedWidgetGesture(e)) return;
    const old = state.pointers.get(e.pointerId);
    calibrateScreenClientRatio(e, true);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch") state.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    updateHandObjectFocus(e);
    if (state.mode === "hand" && e.pointerType !== "touch" && Number(e.buttons) === 0) updateHandObjectHover(clientPoint(e));
    updateCanvasPointerPreview(e);
    if (e.pointerType !== "touch") updateWidgetRefinePointer(clientPoint(e));
    if (state.pendingGesture?.id === e.pointerId) {
      updatePendingGesture(e);
      return;
    }
    if (state.widgetGesture?.id === e.pointerId) {
      updateWidgetGesture(e);
      return;
    }
    if (state.imageGesture?.id === e.pointerId) {
      updateImageGesture(e);
      return;
    }
    if (state.animationGesture?.id === e.pointerId) {
      updateAnimationGesture(e);
      return;
    }
    if (state.selectionGesture?.id === e.pointerId) {
      updateSelectionGesture(e);
      const point = clientPoint(e);
      coords.textContent = `x ${Math.round(point.x)} · y ${Math.round(point.y)} · ${Math.round(state.scale * 100)}%`;
      return;
    }
    if (state.textTap?.id === e.pointerId) {
      const tap = state.textTap,
        distance = Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY);
      if (distance > 8) {
        state.textTap = null;
        state.panGesture = { id: e.pointerId, last: { x: e.clientX, y: e.clientY } };
        setNavigating(true);
      } else return;
    }
    if (e.pointerType === "touch") {
      if (state.mode === "hand" && state.handGestureIncludesWidget) return;
      if (state.touches.size >= 2) {
        updateTouchGesture();
        return;
      }
      if (state.panGesture?.id === e.pointerId && old) {
        moveCanvas(e.clientX - old.x, e.clientY - old.y);
        state.panGesture.last = { x: e.clientX, y: e.clientY };
        setNavigating(true);
      }
      return;
    }
    if (state.panGesture?.id === e.pointerId) {
      if (old) {
        moveCanvas(e.clientX - old.x, e.clientY - old.y);
        setNavigating(true);
      }
      return;
    }
    if (!state.drawing || state.drawing.id !== e.pointerId) return;
    const p = clientPoint(e),
      a = state.drawing.last,
      d = state.drawing,
      cssSize = d.erase ? state.eraser : pressureWidth(e),
      size = logicalWidth(cssSize);
    state.userRevision++;
    stroke(a, p, d.erase, size, true);
    d.last = p;
    d.size = size;
    d.points++;
    d.screenDistance += old ? Math.hypot(e.clientX - old.x, e.clientY - old.y) : 0;
    if (d.points % 8 === 0) d.trail.push(p);
    d.widthMin = Math.min(d.widthMin, cssSize);
    d.widthMax = Math.max(d.widthMax, cssSize);
    const x1 = Math.min(d.bbox.x, p.x),
      y1 = Math.min(d.bbox.y, p.y),
      x2 = Math.max(d.bbox.x + d.bbox.w, p.x),
      y2 = Math.max(d.bbox.y + d.bbox.h, p.y);
    d.bbox = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    requestRender();
    coords.textContent = `x ${Math.round(p.x)} · y ${Math.round(p.y)} · ${Math.round(state.scale * 100)}%`;
  });
  function end(e) {
    state.pointers.delete(e.pointerId);
    finishHandObjectFocus(e);
    if (e.pointerType === "touch") {
      state.touches.delete(e.pointerId);
      finishWidgetRefineTouch(`canvas-touch:${e.pointerId}`);
    }
    finishCanvasWidgetGestureResetTap(e);
    if (e.pointerType === "touch" && state.handGestureIncludesWidget) {
      if (!state.touches.size && !state.handWidgetPointerIds.size) state.handGestureIncludesWidget = false;
      state.touchGesture = null;
      state.panGesture = null;
      if (!state.touches.size) setNavigating(false);
      return;
    }
    if (state.widgetGesture?.id === e.pointerId) {
      finishWidgetGesture(e);
      return;
    }
    if (state.imageGesture?.id === e.pointerId) {
      finishImageGesture(e);
      return;
    }
    if (state.pendingGesture?.id === e.pointerId) {
      if (!finishPendingCopy(e)) {
        if (state.pendingGesture.armed) resetCanvasCursor();
        state.pendingGesture = null;
      }
      if (e.pointerType === "touch") {
        state.touchGesture = null;
        if (state.touches.size === 1) {
          const [id, p] = state.touches.entries().next().value;
          state.panGesture = { id, last: p };
        } else state.panGesture = null;
        if (!state.touches.size) setNavigating(false);
      }
      return;
    }
    if (state.animationGesture?.id === e.pointerId) {
      finishAnimationGesture(e);
      return;
    }
    if (state.selectionGesture?.id === e.pointerId) {
      finishSelectionGesture(e);
      return;
    }
    if (state.textTap?.id === e.pointerId) {
      const tap = state.textTap;
      state.textTap = null;
      if (e.type !== "pointercancel" && state.mode === "text") createTextEditor(tap.point);
      state.touchGesture = null;
      state.panGesture = null;
      if (!state.touches.size) setNavigating(false);
      return;
    }
    if (e.pointerType === "touch") {
      state.touchGesture = null;
      if (state.touches.size === 1) {
        const [id, p] = state.touches.entries().next().value;
        state.panGesture = { id, last: p };
      } else state.panGesture = null;
      if (!state.touches.size) setNavigating(false);
      return;
    }
    if (state.panGesture?.id === e.pointerId) {
      state.panGesture = null;
      resetCanvasCursor();
      setNavigating(false);
      return;
    }
    if (state.drawing?.id === e.pointerId) {
      const wasErasing = state.drawing.erase;
      finishDrawing(e.pointerType);
      if (wasErasing && state.pointerPreview) {
        state.pointerPreview = null;
        requestInteractionLayerRender();
      }
    }
  }
  screen.addEventListener("pointerup", end);
  screen.addEventListener("pointercancel", end);
  screen.addEventListener("pointerleave", () => {
    cancelCanvasWidgetGestureResetTap();
    updateHandObjectHover(null);
    if (!state.pointerPreview) return;
    state.pointerPreview = null;
    requestInteractionLayerRender();
  });
  view.addEventListener("pointerleave", () => {
    updateHandObjectHover(null);
    updateWidgetRefinePointer(null);
  });
  screen.addEventListener("contextmenu", (e) => e.preventDefault());
  view.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomCanvasAt(e.clientX, e.clientY, e.deltaY);
    },
    { passive: false },
  );
  canvasNavigationLock.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  canvasNavigationLock.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCanvasNavigationLocked(!state.navigationLocked);
  });
  function enterAIDraftHandMode() {
    if (state.mode !== "hand" && state.aiDraftReturnMode === null) state.aiDraftReturnMode = state.mode;
    state.pendingHistoryRestored = false;
    if (state.mode !== "hand") setCanvasMode("hand", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function finishAIDraftHandMode() {
    if (state.pending || state.pendingWidget || state.imageEdit) return;
    const returnMode = state.aiDraftReturnMode;
    state.aiDraftReturnMode = null;
    state.pendingHistoryRestored = false;
    if (returnMode && state.mode === "hand") setCanvasMode(returnMode, {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function setCanvasMode(mode, options) {
    options ||= {};
    const button = document.querySelector(`[data-mode="${mode}"]`);
    if (!button) return;
    const staysInWidgetRefineModes = ["pen", "hand"].includes(state.mode) && ["pen", "hand"].includes(mode);
    if (mode !== state.mode && !staysInWidgetRefineModes && !options.preserveWidgetRefinement && (activeWidgetRefinement() || state.pendingWidgetReplacement)) {
      state.aiDraftReturnMode = null;
      state.pendingHistoryRestored = false;
      if (state.pendingWidgetReplacement) acceptPendingWidget({ restoreMode:false });
      else cancelWidgetRefinement("widget-refine-tool-change", { restoreMode:false });
    }
    const leavingDraftHand = state.mode === "hand" && mode !== "hand" && !options.skipDraftFinalize && (state.pending || state.pendingWidget);
    let deferredSelectionCommit = false;
    if (leavingDraftHand) {
      state.aiDraftReturnMode = null;
      state.pendingHistoryRestored = false;
      if (state.pending) acceptPending({ restoreMode:false });
      if (state.pendingWidgetReplacement) acceptPendingWidget({ restoreMode:false });
      else if (state.pendingWidget) acceptPendingWidget({ restoreMode:false });
    }
    if (!options.preserveSelection && mode !== "select" && state.selection && (state.mode === "select" || leavingDraftHand)) {
      if (selectionAIBusy(state.selection)) {
        if (leavingDraftHand) deferredSelectionCommit = true;
        else {
          setStatusKey(selectionAIStatusKey(state.selection));
          return;
        }
      } else commitSelection();
    }
    if (state.mode === "hand" && mode !== "hand") {
      hideHandObjectToolbar({ animate:false, all:true });
      state.handHoverKey = null;
      state.handPointerFocusKeys.clear();
      state.handToolbarOperationPointers.clear();
      state.handWidgetPointerIds.clear();
      state.handGestureIncludesWidget = false;
      for (const editor of [...state.textEditors.values()]) void confirmTextEditor(editor);
      if (state.widgetEdit) acceptWidgetEdit();
      if (state.imageEdit) {
        state.aiDraftReturnMode = null;
        state.imageHandReturnMode = null;
        acceptImageEdit();
      }
      if (state.animationEdit) acceptAnimationEdit();
    }
    if (mode === "hand") {
      clearTimeout(state.timer);
      state.timer = 0;
      hideAutoDelayControl();
    }
    state.mode = mode;
    updateAutoControl();
    if (!["pen", "hand"].includes(mode)) updateWidgetRefinePointer(null);
    else refreshWidgetRefineHoverCandidate();
    if (mode !== "eraser") state.pointerPreview = null;
    if (mode !== "select") deselectAnimation();
    view.classList.toggle("hand-mode", mode === "hand");
    document.querySelectorAll("[data-mode]").forEach((item) => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    resetCanvasCursor();
    requestInteractionLayerRender();
    if (mode === "hand") setNavigating(true);
    if (mode === "hand" && options.showHint && !state.busy) {
      showHandStatusHint("hand-mode", ["handAutoAIManual", "handAutoAIResume"]);
    }
    if (options.showHint) {
      const hintKey = {
        hand:["canvasHintHand", "canvasHintHandAlt"],
        select:["canvasHintLasso", "canvasHintLassoAlt"],
        text:["canvasHintText", "canvasHintTextAlt"],
        eraser:["canvasHintEraser", "canvasHintEraserAlt"],
      }[mode];
      if (hintKey) showCanvasHint(hintKey);
    }
    if (deferredSelectionCommit) queueMicrotask(() => {
      if (state.mode === mode && state.selection && !selectionAIBusy(state.selection)) commitSelection();
    });
  }
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.onclick = () => setCanvasMode(button.dataset.mode, { showHint:true });
  });
  [selectionTypesetButton, selectionDeleteButton, selectionCancelButton].filter(Boolean).forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => event.stopPropagation());
  });
  imagePlaceButton.onclick = () => acceptImageEdit({ showHint:true });
  imageMergeButton.onclick = () => {
    const item = selectedImage();
    if (item) mergeImage(item, { showHint:true });
  };
  imageDeleteButton.onclick = () => {
    const item = selectedImage();
    if (item) deleteImage(item);
  };
  for (const button of [imagePlaceButton, imageMergeButton, imageDeleteButton]) {
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      refreshHandObjectToolbar();
    });
    button.addEventListener("click", (event) => event.stopPropagation());
  }
  function bindHandToolbarSurface(element, kind, currentObject) {
    const currentKey = () => {
      const object = currentObject();
      return object ? handToolbarKey(kind, object.id) : "";
    };
    element.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      const key = currentKey();
      if (key) setHandToolbarHold(key, `${kind}-toolbar-hover:${event.pointerId}`, true);
    });
    element.addEventListener("pointerleave", (event) => {
      const key = currentKey();
      if (key) setHandToolbarHold(key, `${kind}-toolbar-hover:${event.pointerId}`, false);
    });
    element.addEventListener("pointerdown", (event) => {
      const key = currentKey();
      if (key) beginHandToolbarOperation(event.pointerId, key);
    });
    element.addEventListener("pointerup", (event) => finishHandToolbarOperation(event.pointerId));
    element.addEventListener("pointercancel", (event) => finishHandToolbarOperation(event.pointerId));
    element.addEventListener("focusin", () => {
      const key = currentKey();
      if (key) setHandToolbarHold(key, `${kind}-toolbar-focus`, true);
    });
    element.addEventListener("focusout", (event) => {
      if (event.relatedTarget && element.contains(event.relatedTarget)) return;
      const key = currentKey();
      if (key) setHandToolbarHold(key, `${kind}-toolbar-focus`, false);
    });
  }
  bindHandToolbarSurface(imageEditBar, "image", selectedImage);
  imagePickerButton.addEventListener("click", () => {
    if (state.imageImporting) return;
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return;
    }
    if (state.images.length >= MAX_VISIBLE_IMAGES) {
      setStatusKey("imageLimitReached");
      return;
    }
    imagePickerInput.value = "";
    imagePickerInput.click();
  });
  imagePickerInput.addEventListener("change", () => {
    const file = imagePickerInput.files?.[0];
    if (file) void addImageFile(file);
    else imagePickerInput.value = "";
  });
  function clipboardTextEditorPoint() {
    const rect = view.getBoundingClientRect(),
      scale = Math.max(0.03, state.scale),
      width = Math.min(TEXT_EDITOR_DEFAULT_WIDTH, Math.max(TEXT_EDITOR_MIN_WIDTH, rect.width - 24)),
      height = Math.min(TEXT_EDITOR_DEFAULT_HEIGHT, Math.max(TEXT_EDITOR_MIN_HEIGHT, rect.height - 24)),
      center = clientPoint({ clientX:rect.left + rect.width / 2, clientY:rect.top + rect.height / 2 });
    return {
      x:Math.max(0, Math.min(SIZE - width / scale, center.x - width / scale / 2)),
      y:Math.max(0, Math.min(SIZE - height / scale, center.y - height / scale / 2)),
    };
  }
  function addClipboardText(text) {
    const value = typeof text === "string" ? text.slice(0, TEXT_INPUT_MAX_LENGTH) : "";
    if (!value.trim()) {
      setStatusKey("clipboardUnsupported");
      return false;
    }
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return false;
    }
    if (state.pending) acceptPending();
    if (state.pendingWidgetReplacement) rejectPendingWidget(AI_CANCELLED);
    else if (state.pendingWidget) acceptPendingWidget();
    if (state.selection) commitSelection();
    if (state.selection) {
      setStatusKey(selectionAIStatusKey());
      return false;
    }
    if (state.widgetEdit) acceptWidgetEdit();
    if (state.animationEdit) acceptAnimationEdit();
    if (state.imageEdit) acceptImageEdit();
    const returnMode = state.mode;
    if (state.mode !== "hand") setCanvasMode("hand", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
    createTextEditor(clipboardTextEditorPoint(), { text:value, returnMode });
    setStatusKey("clipboardTextAdded");
    return true;
  }
  async function importClipboardPayload(payload) {
    if (payload?.image instanceof Blob) {
      await addImageFile(payload.image);
      return true;
    }
    if (typeof payload?.text === "string" && payload.text.trim()) return addClipboardText(payload.text);
    setStatusKey("clipboardUnsupported");
    return false;
  }
  function clipboardPayloadFromDataTransfer(data) {
    if (!data) return null;
    const files = [...(data.files || [])],
      itemImage = [...(data.items || [])].find((item) => String(item.type || "").toLowerCase().startsWith("image/")),
      image = files.find((file) => String(file.type || "").toLowerCase().startsWith("image/")) || itemImage?.getAsFile?.() || null;
    if (image) return { image };
    const text = data.getData?.("text/plain") || "";
    return text ? { text } : null;
  }
  async function navigatorClipboardPayload() {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = [...item.types].find((type) => String(type).toLowerCase().startsWith("image/"));
        if (imageType) return { image:await item.getType(imageType) };
      }
      for (const item of items) {
        if (item.types.includes("text/plain")) return { text:await (await item.getType("text/plain")).text() };
      }
      return null;
    }
    if (navigator.clipboard?.readText) return { text:await navigator.clipboard.readText() };
    throw Error("Clipboard reading is unavailable");
  }
  async function copyFromSystemClipboard() {
    if (state.clipboardImporting || state.imageImporting) return false;
    state.clipboardImporting = true;
    clipboardCopyButton.disabled = true;
    setStatusKey("clipboardReading");
    try {
      return await importClipboardPayload(await navigatorClipboardPayload());
    } catch {
      setStatusKey("clipboardReadFailed");
      return false;
    } finally {
      state.clipboardImporting = false;
      clipboardCopyButton.disabled = false;
    }
  }
  function editableClipboardTarget(target) {
    return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
  }
  clipboardCopyButton.addEventListener("click", () => void copyFromSystemClipboard());
  document.addEventListener("paste", (event) => {
    if (editableClipboardTarget(event.target)) return;
    event.preventDefault();
    void importClipboardPayload(clipboardPayloadFromDataTransfer(event.clipboardData));
  });
  if (selectionTypesetButton) selectionTypesetButton.onclick = normalizeSelectionForAI;
  if (selectionDeleteButton) selectionDeleteButton.onclick = deleteSelection;
  if (selectionCancelButton) selectionCancelButton.onclick = () => cancelSelection();
  [animationPlayPause, animationRestart, animationDelete].forEach((button) => button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    refreshHandObjectToolbar();
  }));
  animationPlayPause.onclick = toggleSelectedAnimationPlayback;
  animationRestart.onclick = restartSelectedAnimation;
  animationDelete.onclick = deleteSelectedAnimation;
  animationControls.addEventListener("click", (event) => event.stopPropagation());
  animationControls.addEventListener("pointerdown", (event) => event.stopPropagation());
  bindHandToolbarSurface(animationControls, "animation", selectedAnimation);

  document.querySelector("#penSize").oninput = (e) => {
    state.pen = +e.target.value;
    document.querySelector("#penSizeValue").textContent = `${state.pen} px`;
  };
  document.querySelector("#aiFont").onchange = (e) => {
    state.aiFont = e.target.value;
  };
  function closeColorOrbs(except = null) {
    document.querySelectorAll("[data-color-control]").forEach((control) => {
      if (control === except) return;
      const trigger = control.querySelector(".color-orb-trigger"),
        focusedInside = control.contains(document.activeElement) && document.activeElement !== trigger;
      control.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      control.querySelector(".color-orbit").setAttribute("aria-hidden", "true");
      control.querySelectorAll(".orbit-swatch").forEach((button) => button.setAttribute("tabindex", "-1"));
      if (focusedInside) trigger.focus();
    });
  }
  document.querySelectorAll("[data-color-control]").forEach((control) => {
    const trigger = control.querySelector(".color-orb-trigger"),
      orbit = control.querySelector(".color-orbit"),
      type = control.dataset.colorControl;
    trigger.onclick = (event) => {
      event.stopPropagation();
      const open = !control.classList.contains("open");
      closeColorOrbs(control);
      control.classList.toggle("open", open);
      trigger.setAttribute("aria-expanded", String(open));
      orbit.setAttribute("aria-hidden", String(!open));
      control.querySelectorAll(".orbit-swatch").forEach((button) => button.setAttribute("tabindex", open ? "0" : "-1"));
    };
    control.querySelectorAll(".orbit-swatch").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const color = type === "ink" ? button.dataset.inkColor : button.dataset.aiColor;
        if (type === "ink") {
          state.inkColor = color;
          applySelectionColor(color);
          positionTextEditors();
          for (const editor of state.textEditors.values()) if (editor.mixedMode) scheduleTextEditorPreview(editor, 0);
        }
        else state.aiColor = color;
        trigger.classList.remove(...Object.values(COLOR_CLASS));
        trigger.classList.add(COLOR_CLASS[color]);
        control.querySelectorAll(".orbit-swatch").forEach((item) => {
          const active = item === button;
          item.classList.toggle("active", active);
          item.setAttribute("aria-checked", String(active));
        });
        closeColorOrbs();
      };
    });
  });
  document.querySelectorAll(".orbit-swatch").forEach((button) => {
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("tabindex", "-1");
    button.setAttribute("aria-checked", String(button.classList.contains("active")));
  });
  document.addEventListener("click", () => closeColorOrbs());
  document.querySelector("#rejectBatch").onclick = rejectPending;
  document.querySelector("#acceptBatch").onclick = acceptPending;
  document.querySelector("#auto").onclick = () => {
    if (state.auto) setAutoEnabled(false);
    else setAutoEnabled(true, true);
  };
  document.querySelector("#autoDelayRange").oninput = (event) => {
    state.autoDelayMs = Math.round(Math.max(0, Math.min(10, Number(event.target.value))) * 1000);
    localStorage.setItem("penecho-auto-delay-ms", String(state.autoDelayMs));
    updateAutoControl();
    schedule();
    keepAutoDelayControlOpen();
  };
  document.querySelector("#aiEffortButton").onclick = () => {
    if (document.querySelector("#effortPopover").hidden) showEffortControl();
    else hideEffortControl();
  };
  pluginButton.onclick = () => {
    if (pluginPopover.hidden) showPluginControl();
    else hidePluginControl();
  };
  pluginClose.onclick = hidePluginControl;
  pluginRefresh.onclick = () => {
    state.pluginCatalogNotice = null;
    void loadPluginDocuments();
  };
  pluginLocalTab.onclick = () => setPluginTab("local");
  pluginCreateTab.onclick = () => setPluginTab("create");
  pluginServerTab.onclick = () => setPluginTab("server");
  pluginSimpleTemplate.onclick = () => setPluginTemplate("simple");
  pluginTitle.addEventListener("input", () => {
    if (state.pluginAuthoringStatus?.type === "error") state.pluginAuthoringStatus = null;
    updatePluginAuthoringUi();
  });
  pluginDocumentEditor.addEventListener("input", () => {
    state.pluginAuthoringStatus = null;
    updatePluginAuthoringUi();
  });
  pluginStylesEditor.addEventListener("input", () => {
    state.pluginAuthoringStatus = null;
    updatePluginAuthoringUi();
  });
  pluginStylesUploadButton.onclick = () => {
    if (state.pluginAuthoringBusy) return;
    pluginStylesUpload.value = "";
    pluginStylesUpload.click();
  };
  pluginStylesUpload.addEventListener("change", () => {
    const file = pluginStylesUpload.files?.[0];
    if (file) void importPluginStylesFile(file);
    else pluginStylesUpload.value = "";
  });
  pluginImprove.onclick = () => void improvePluginDraft();
  pluginCreateForm.addEventListener("submit", (event) => void savePluginDraft(event));
  pluginOptions.addEventListener("click", (event) => {
    const detailButton = event.target.closest("button[data-plugin-detail]");
    if (detailButton) {
      event.preventDefault();
      event.stopPropagation();
      togglePluginDetails(detailButton.dataset.pluginDetail, detailButton);
      return;
    }
    const copyButton = event.target.closest("button[data-plugin-copy]");
    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();
      void copyPluginMarkdown(copyButton.dataset.pluginCopy, copyButton);
      return;
    }
    const duplicateButton = event.target.closest("button[data-plugin-duplicate]");
    if (duplicateButton) {
      event.preventDefault();
      event.stopPropagation();
      createPluginCopy(duplicateButton.dataset.pluginDuplicate);
      return;
    }
    const deleteButton = event.target.closest("button[data-plugin-delete]");
    if (!deleteButton) return;
    event.preventDefault();
    event.stopPropagation();
    void deleteLocalPlugin(deleteButton.dataset.pluginDelete);
  });
  pluginOptions.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-plugin-id]");
    if (!input) return;
    void setPluginEnabled(input.dataset.pluginId, input.checked).then((enabled) => {
      if (!enabled && input.isConnected) input.checked = pluginEnabled(input.dataset.pluginId);
    });
  });
  pluginPopover.addEventListener("pointerdown", (event) => {
    if (event.target === pluginPopover) hidePluginControl();
  });
  pluginPopover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hidePluginControl();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...pluginPopover.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)")].filter((element) => !element.closest("[hidden]"));
    if (!focusable.length) return;
    const current = focusable.indexOf(document.activeElement), next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
    event.preventDefault();
    focusable[next].focus();
  });
  document.querySelectorAll("#effortOptions .effort-option").forEach((option) => {
    option.onclick = () => setEffort(option.dataset.effort);
  });
  document.querySelector("#effortPopover").addEventListener("pointerdown", keepEffortControlOpen);
  document.querySelector("#autoDelayPopover").addEventListener("pointerdown", keepAutoDelayControlOpen);
  document.addEventListener("pointerdown", (event) => {
    if (!document.querySelector("#autoControl").contains(event.target)) hideAutoDelayControl();
    if (!document.querySelector("#effortControl").contains(event.target)) hideEffortControl();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideEffortControl();
    if (event.key === "Escape") hidePluginControl();
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.onclick = () => {
      state.language = button.dataset.language;
      localStorage.setItem("penecho-language", state.language);
      applyLanguage();
    };
  });
  document.querySelector("#theme").onchange = (e) => applyTheme(e.target.value);
  document.querySelector("#gridToggle").onclick = () => {
    state.gridVisible = !state.gridVisible;
    localStorage.setItem(state.theme === "research" ? "penecho-research-grid" : "penecho-grid", String(state.gridVisible));
    updateGridButton();
    requestRender();
  };
  document.querySelector("#fullscreenBtn").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      setStatus(`${t("aiError")}${error.message}`);
    }
  };
  document.querySelector("#newCanvasBtn").onclick = openNewCanvasDialog;
  document.querySelector("#saveCanvasBtn").onclick = saveCurrentCanvas;
  document.querySelector("#exportPngBtn").onclick = exportCanvasPng;
  document.querySelector("#historyBtn").onclick = openHistoryPanel;
  document.querySelector("#historyClose").onclick = closeHistoryPanel;
  document.querySelector("#historyBackdrop").onclick = closeHistoryPanel;
  document.querySelector("#historySaveCurrent").onclick = saveCurrentCanvas;
  document.querySelector("#historySave").onclick = saveSnapshotFromHistory;
  document.querySelector("#historyNew").onclick = openNewCanvasDialog;
  document.querySelector("#historyProjectSelect").onchange = (event) => {
    rememberSelectedServerProject(event.target.value);
    renderSnapshotList();
  };
  document.querySelector("#newCanvasProjectSelect").onchange = (event) => {
    rememberSelectedServerProject(event.target.value);
    renderSnapshotList();
  };
  document.querySelector("#historyProjectCreate").onclick = () => runSnapshotAction(createServerProject);
  document.querySelector("#historyProjectDelete").onclick = () => runSnapshotAction(deleteSelectedServerProject);
  document.querySelectorAll('input[name="historyStorageLocation"], input[name="newCanvasStorageLocation"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) setSnapshotLocation(input.value);
    });
  });
  document.querySelector("#newCanvasClose").onclick = () => {
    pendingCanvasTransition = null;
    document.querySelector("#newCanvasDialog").close("cancel");
  };
  document.querySelector("#newCanvasCancel").onclick = () => {
    pendingCanvasTransition = null;
    document.querySelector("#newCanvasDialog").close("cancel");
  };
  document.querySelector("#textHelpClose").onclick = closeTextHelp;
  document.querySelector("#textHelpDone").onclick = closeTextHelp;
  document.querySelector("#textHelpDialog").addEventListener("close", restoreTextEditorAfterHelp);
  document.querySelector("#newDiscard").onclick = discardCanvasTransition;
  document.querySelector("#newSaveCopy").onclick = () => completeNewCanvas("new");
  document.querySelector("#newOverwrite").onclick = () => completeNewCanvas("overwrite");
  document.querySelector("#newCanvasDialog").addEventListener("cancel", (event) => {
    if (event.currentTarget.dataset.busy === "true") event.preventDefault();
    else pendingCanvasTransition = null;
  });
  document.querySelector("#historyName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveCurrentCanvas();
  });
  document.querySelector("#newSnapshotName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      completeNewCanvas("new");
    }
  });
  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButton();
    requestAnimationFrame(fit);
  });
  document.querySelector("#debugBtn").onclick = (e) => {
    const panel = document.querySelector("#debugPanel");
    panel.hidden = !panel.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
    e.currentTarget.classList.toggle("active", !panel.hidden);
  };
  document.querySelectorAll("[data-action]").forEach(
      (b) =>
      (b.onclick = () => {
        const a = b.dataset.action;
        if (selectionAIBusy()) {
          setStatusKey(selectionAIStatusKey());
          return;
        }
        if ((state.pending || state.pendingWidget) && a !== "clear" && !(state.pendingHistoryRestored && (a === "undo" || a === "redo"))) {
          setStatusKey("pendingConfirm");
          return;
        }
        if (a === "undo") {
          if (state.selection) commitSelection();
          state.userRevision++;
          undo();
        } else if (a === "redo") {
          if (state.selection) commitSelection();
          state.userRevision++;
          redo();
        } else if (a === "clear") {
          if (confirm(t("clearConfirm"))) {
            if (state.selection) commitSelection();
            clearTextEditors();
            state.userRevision++;
            state.snapshotLoadGeneration++;
            invalidateRecognition();
            state.historyBefore.clear();
            clearSharpOverlays();
            for (const [k, c] of tiles) state.historyBefore.set(k, cloneCanvas(c));
            recordAnimationsBefore();
            recordWidgetsBefore();
            recordImagesBefore();
            recordTextBoxesBefore();
            state.animations = [];
            state.selectedAnimationId = null;
            state.animationGesture = null;
            state.animationEdit = null;
            hideAnimationControls();
            requestAnimationLayerRender();
            restoreWidgets([]);
            restoreImages([]);
            void restoreTextBoxes([]);
            tiles.clear();
            state.inkBounds.clear();
            cancelPendingForRevision();
            save();
            render();
          }
        } else invokeAIAction(a);
      }),
  );
  embodiment.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse" || e.pointerType === "pen") openRadialMenu();
  });
  embodiment.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    if (!state.radialGesture) {
      state.radialCloseTimer = setTimeout(closeRadialMenu, 2000);
    }
  });
  aiOrb.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (state.busy) {
      stopActiveAIRequests();
      return;
    }
    openRadialMenu();
    state.radialGesture = { id: e.pointerId, moved: false, selected: null };
    try {
      aiOrb.setPointerCapture(e.pointerId);
    } catch {}
  });
  aiOrb.addEventListener("pointermove", (e) => {
    const gesture = state.radialGesture;
    if (!gesture || gesture.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const r = aiOrb.getBoundingClientRect(),
      distance = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (distance > 12) gesture.moved = true;
    gesture.selected = gesture.moved ? chooseRadialAction(e.clientX, e.clientY) : null;
  });
  function finishRadialGesture(e) {
    const gesture = state.radialGesture;
    if (!gesture || gesture.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const selected = gesture.selected;
    state.radialGesture = null;
    state.radialSuppressClickUntil = performance.now() + 450;
    if (selected) {
      invokeAIAction(selected.dataset.aiAction);
      closeRadialMenu();
      return;
    }
    if (gesture.moved) {
      closeRadialMenu();
    }
  }
  aiOrb.addEventListener("pointerup", finishRadialGesture);
  aiOrb.addEventListener("pointercancel", (e) => {
    if (state.radialGesture?.id !== e.pointerId) return;
    state.radialGesture = null;
    state.radialSuppressClickUntil = performance.now() + 450;
    closeRadialMenu();
  });
  aiOrb.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() < state.radialSuppressClickUntil) return;
    if (state.busy) {
      stopActiveAIRequests();
      return;
    }
    if (embodiment.classList.contains("menu-open")) closeRadialMenu();
    else openRadialMenu();
  });
  document.querySelectorAll(".radial-action").forEach((button) => {
    button.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      clearTimeout(state.radialCloseTimer);
      openRadialMenu();
    });
    button.addEventListener("pointerleave", (e) => {
      if ((e.pointerType !== "mouse" && e.pointerType !== "pen") || state.radialGesture) return;
      state.radialCloseTimer = setTimeout(closeRadialMenu, 2000);
    });
    button.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      invokeAIAction(button.dataset.aiAction);
      closeRadialMenu();
    });
  });
  tourBackButton.addEventListener("click", previousFeatureTourStep);
  tourNextButton.addEventListener("click", nextFeatureTourStep);
  tourSkipButton.addEventListener("click", skipFeatureTour);
  changelogCloseButton.addEventListener("click", closeChangelog);
  changelogDoneButton.addEventListener("click", closeChangelog);
  changelogLayer.addEventListener("pointerdown", (event) => {
    if (event.target === changelogLayer) closeChangelog();
  });
  changelogLayer.addEventListener("keydown", handleChangelogKeydown);
  settingsButton.addEventListener("click", () => {
    if (settings.open) closeSettings();
    else openSettings();
  });
  settingsCloseButton.addEventListener("click", () => closeSettings());
  settingsBackdrop.addEventListener("pointerdown", () => closeSettings());
  settingsPanel.addEventListener("pointerdown", (event) => event.stopPropagation());
  settingsOpenApi?.addEventListener("click", () => openConfiguration("api"));
  settingsOpenSystem?.addEventListener("click", () => openConfiguration("system"));
  configurationClose?.addEventListener("click", () => closeConfiguration());
  configurationBackdrop?.addEventListener("pointerdown", () => closeConfiguration());
  configurationPanel?.addEventListener("pointerdown", event => event.stopPropagation());
  canvasSettingsForm?.addEventListener("submit", saveCanvasSettings);
  settingsTestConnection?.addEventListener("click", () => void testCanvasConnection());
  settingsInstallCli?.addEventListener("click", () => void installCanvasCli());
  settingsAddConnection?.addEventListener("click", () => fillConnectionEditor());
  settingsEditorCancel?.addEventListener("click", hideConnectionEditor);
  settingsConnectionList?.addEventListener("click", handleConnectionAction);
  settingsConnectionQuickList?.addEventListener("click", handleConnectionAction);
  settingsProvider?.addEventListener("change", () => {
    updateSettingsProviderFields();
    selectDefaultConnectionEffort();
  });
  settingsApiFormat?.addEventListener("change", () => {
    updateApiPresetFields(true, true);
    selectDefaultConnectionEffort();
  });
  settingsApiRegion?.addEventListener("change", () => updateApiPresetFields(true, false));
  settingsApiService?.addEventListener("change", () => {
    updateApiPresetFields(true, true);
    selectDefaultConnectionEffort();
  });
  settingsTraceToggle?.addEventListener("click", () => {
    settings.requestTrace = !settings.requestTrace;
    updateTraceToggle();
  });
  settingsAutoToggle.addEventListener("click", () => setAutoEnabled(!state.auto));
  settingsWidgetShadowToggle.addEventListener("click", () => setWidgetShadowEnabled(!state.widgetShadowEnabled));
  summonToggle.addEventListener("click", () => setSummonEnabled(!state.summonEnabled));
  settingsTourButton.addEventListener("click", () => {
    closeSettings(false);
    replayFeatureTour();
  });
  settingsChangelogButton.addEventListener("click", () => {
    closeSettings(false);
    maybeShowChangelog(true);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && settings.open) {
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    } else if (event.key === "Escape" && settings.configurationMode) {
      event.preventDefault();
      event.stopPropagation();
      closeConfiguration();
    }
  }, true);
  window.addEventListener("keydown", handleFeatureTourKeydown, true);
  window.addEventListener("resize", handleFeatureTourViewportChange);
  window.addEventListener("scroll", scheduleFeatureTourPosition, true);
  window.visualViewport?.addEventListener("resize", handleFeatureTourViewportChange);
  window.visualViewport?.addEventListener("scroll", scheduleFeatureTourPosition);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (document.querySelector("#newCanvasDialog").open || document.querySelector("#textHelpDialog").open)) return;
    if (e.key === "Escape" && state.selection) {
      cancelSelection();
      return;
    }
    if (e.key === "Escape" && state.pendingWidget) {
      rejectPendingWidget();
      return;
    }
    if (e.key === "Escape" && activeWidgetRefinement()) {
      cancelWidgetRefinement();
      setStatusKey("ready");
      return;
    }
    if (e.key === "Escape" && state.widgetRefineConfirmation) {
      cancelWidgetRefineConfirmation();
      return;
    }
    if (e.key === "Escape" && state.widgetRefineCandidate) {
      dismissWidgetRefineCandidate();
      return;
    }
    if (e.key === "Escape" && state.imageEdit) {
      cancelImageEdit();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.imageEdit && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      deleteImage(selectedImage());
      return;
    }
    if (e.key === "Escape" && state.widgetEdit) {
      cancelWidgetEdit();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.widgetEdit && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      deleteWidget(selectedWidget());
      return;
    }
    if (e.key === "Enter" && state.selection?.phase === "active" && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      commitSelection();
      return;
    }
    if (e.key === "Escape" && !document.querySelector("#autoDelayPopover").hidden) {
      hideAutoDelayControl();
      document.querySelector("#auto").focus();
      return;
    }
    if (e.key === "Escape" && document.querySelector("#historyPanel").classList.contains("open")) {
      closeHistoryPanel();
      document.querySelector("#historyBtn").focus();
      return;
    }
    if (e.key === "Escape" && embodiment.classList.contains("menu-open")) {
      state.radialGesture = null;
      closeRadialMenu();
      aiOrb.focus();
      return;
    }
    if (e.key === "Alt" && !state.drawing && !state.pending && !state.pendingWidget) setCanvasCursor("grab");
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Alt" && !state.panGesture && !state.drawing && !state.pending && !state.pendingWidget) resetCanvasCursor();
  });
  new ResizeObserver(fit).observe(view);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAnimationFrames();
    else requestAnimationLayerRender();
  });

  document.querySelectorAll(".radial-action").forEach((button) => button.setAttribute("tabindex", "-1"));
  setPluginTemplate("simple");
  applyLanguage();
  setWidgetShadowEnabled(state.widgetShadowEnabled);
  applyTheme(state.theme);
  resetCanvasCursor();
  loadPluginDocuments().catch(() => {});
  refreshSnapshots().catch(() => {});
  fit();
  setNavigating(true);
  scheduleAIOrbIdle();
  requestAnimationFrame(() => requestAnimationFrame(maybeStartOnboarding));
})();
