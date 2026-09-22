// Pointer and control bindings, portable snapshots, and application startup.
  document.addEventListener("pointerdown", unselectTextEditorsOutside, true);
  document.addEventListener("focusin", unselectTextEditorsOutside, true);
  window.addEventListener("blur", unselectTextEditorsOutside);
  const ERASER_TOOL_MENU_MS = 5000;
  let eraserToolMenuTimer = 0;
  // Derive rejection from live strokes, never a remembered Pencil mode.
  function canvasPencilWritingActive() {
    return state.drawing?.pointerType === "pen" || canvasAgent.inkStroke?.pointerType === "pen";
  }
  function rejectTouchDuringPencilWriting(event) {
    if (event.pointerType !== "touch" || !canvasPencilWritingActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function finishInterruptedPencilWriting(event) {
    if (event.type === "visibilitychange" && !document.hidden) return;
    if (event.type === "pointerdown" && event.pointerType === "touch") return;
    const all = ["blur", "pagehide", "visibilitychange", "pointerdown"].includes(event.type),
      released = event.type !== "pointermove" || event.pointerType === "pen" && Number(event.buttons) === 0;
    if (!released) return;
    const drawing = state.drawing;
    if (drawing?.pointerType === "pen" && (all || drawing.id === event.pointerId)) {
      state.pointers.delete(drawing.id);
      canvasAgentNavigationPointerDidEnd(drawing.id);
      finishDrawing("pen");
      if (drawing.erase) {
        state.pointerPreview = null;
        requestInteractionLayerRender();
      }
    }
    const ink = canvasAgent.inkStroke;
    if (ink?.pointerType === "pen" && (all || ink.pointerId === event.pointerId)) canvasAgentFinishInkStroke();
  }
  for (const type of ["pointerdown", "pointermove"]) {
    window.addEventListener(type, rejectTouchDuringPencilWriting, { capture:true, passive:false });
  }
  for (const type of ["pointerdown", "pointerup", "pointercancel", "lostpointercapture", "pointermove", "blur", "pagehide"]) {
    window.addEventListener(type, finishInterruptedPencilWriting, true);
  }
  document.addEventListener("visibilitychange", finishInterruptedPencilWriting);
  function canvasPenEraserActive(event) {
    return event?.pointerType === "pen"
      && (Number(event.button) === 5 || (Number(event.buttons) & 32) === 32);
  }
  function updateCanvasPointerPreview(event, point = null) {
    const drawing = state.drawing,
      eraserPointer = drawing ? drawing.erase && drawing.id === event.pointerId : state.mode === "eraser",
      next = eraserPointer && event.pointerType !== "touch"
        ? point || clientPoint(event)
        : null,
      preview = next && valid(next) ? next : null,
      changed = Boolean(preview) !== Boolean(state.pointerPreview)
        || preview && (!state.pointerPreview || Math.abs(preview.x - state.pointerPreview.x) > 0.01 || Math.abs(preview.y - state.pointerPreview.y) > 0.01);
    if (!changed) return;
    state.pointerPreview = preview;
    requestInteractionLayerRender();
  }
  function setCanvasViewMode(enabled) {
    enabled = Boolean(enabled);
    if (state.viewMode === enabled) return;
    finishDrawing("pen");
    setWidgetInteraction(null);
    setSpacePan(false);
    state.viewTool = "hand";
    state.widgetActivationTap = null;
    state.viewMode = enabled;
    state.pointers.clear();
    state.canvasAgentNavigationPointerIds.clear();
    state.touches.clear();
    state.touchGesture = null;
    state.panGesture = null;
    state.textTap = null;
    state.pointerPreview = null;
    cancelAreaEraseGesture();
    hideEraserToolMenu();
    document.body.classList.toggle("canvas-view-mode", enabled);
    view.classList.toggle("view-mode", enabled);
    window.PenEchoStudioNavigator?.syncCanvasView?.(enabled);
    canvasViewButton.setAttribute("aria-pressed", String(enabled));
    canvasViewActions.hidden = !enabled;
    const inactiveSurfaces = view.querySelectorAll([
      ".canvas-navigation-lock",
      ".object-chrome-layer",
      ".animation-controls",
      ".selection-overlay-layer",
      ".text-editor-layer",
      ".ai-embodiment",
      ".canvas-agent-panel",
    ].join(","));
    if (enabled) {
      for (const element of inactiveSurfaces) {
        if (element.inert) continue;
        element.inert = true;
        element.dataset.canvasViewInert = "true";
      }
    } else {
      for (const element of view.querySelectorAll('[data-canvas-view-inert="true"]')) {
        element.inert = false;
        delete element.dataset.canvasViewInert;
      }
    }
    if (enabled) {
      state.viewModeNavigationLocked = state.navigationLocked;
      if (state.navigationLocked) setCanvasNavigationLocked(false);
      if (!document.querySelector("#canvasAgentPanel")?.hidden) closeCanvasAgent();
      document.activeElement?.blur?.();
      setCanvasCursor("grab");
      requestAnimationFrame(() => canvasViewCloseButton.focus({ preventScroll:true }));
    } else {
      if (state.viewModeNavigationLocked) setCanvasNavigationLocked(true);
      state.viewModeNavigationLocked = false;
      resetCanvasCursor();
      requestAnimationFrame(() => canvasViewButton.focus({ preventScroll:true }));
    }
    syncCanvasNavigation();
    requestInteractionLayerRender();
    requestAnimationFrame(fit);
  }
  window.addEventListener("keydown", (event) => {
    if (!state.viewMode || document.querySelector(".penecho-cloud-overlay") || canvasNavigationTextTarget(event.target)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (state.interactingWidgetId) setWidgetInteraction(null);
      else setCanvasViewMode(false);
    }
  }, true);
  function beginCanvasPointerAction(e, point) {
    const options = arguments[2] || {};
    const forceEraser = options.forceEraser === true;
    if (state.selectedAnimationId) acceptAnimationEdit();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!forceEraser && state.mode === "hand") {
      state.panGesture = {
        id: e.pointerId,
        last: { x: e.clientX, y: e.clientY },
      };
      setCanvasCursor("grabbing");
      setNavigating(true);
      return;
    }
    if (!forceEraser && state.mode === "text" && e.pointerType === "touch") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      state.textTap = { id: e.pointerId, startX: e.clientX, startY: e.clientY, point };
      return;
    }
    if (!forceEraser && state.mode === "text") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      createTextEditor(point);
      return;
    }
    if (!forceEraser && state.mode === "area-eraser") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      beginAreaEraseGesture(e, point);
      return;
    }
    if (!forceEraser && state.mode === "select" && e.pointerType !== "touch") {
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
    releaseWidgetsForDrawing();
    const erasing = forceEraser || state.mode === "eraser";
    if (erasing) clearWidgetRefineCandidate();
    else state.latestTypedInput = null;
    const cssSize = erasing ? state.eraser : pressureWidth(e),
      size = logicalWidth(cssSize);
    state.userRevision++;
    state.drawing = {
      id: e.pointerId,
      pointerType: e.pointerType,
      last: p,
      size,
      color: state.inkColor,
      inputTransform: options.inputTransform || captureDrawingTransform(),
      samples: [],
      committedSamples: 0,
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
    noteCanvasChromeInteraction();
    view.classList.add("is-drawing");
    updateCanvasPointerPreview(e, p);
    appendLiveInkSample(state.drawing, p, size);
  }
  function beginHandObjectResize(event, point) {
    if (!["hand", "select"].includes(state.mode) || state.viewMode || state.spacePan || event.pointerType === "touch" || Number(event.button) !== 0 || !point || !valid(point)) return false;
    if (state.mode === "select" && state.pending) {
      const result = pendingHit(state.pending, event, state.pending.revealProgress < 1),
        hit = typeof result === "string" ? result : result?.hit,
        itemIndex = result && typeof result === "object" ? result.itemIndex : null;
      if (["resize", "width", "height", "batch-resize"].includes(hit)) {
        beginPendingGesture(event, hit, itemIndex);
        return true;
      }
    }
    const widgetResult = widgetRuntimeEnabled() ? widgetPointerHit(point, event.pointerType, false) : null;
    if (widgetResult && ["resize", "width", "height"].includes(widgetResult.hit)) {
      refreshHandObjectToolbar();
      return beginWidgetGesture(event, point, widgetResult);
    }
    const imageResult = imagePointerHit(point, event.pointerType, false);
    if (imageResult && ["resize", "width", "height"].includes(imageResult.hit)) {
      if (state.selectedAnimationId) acceptAnimationEdit();
      refreshHandObjectToolbar();
      return beginImageGesture(event, point, imageResult);
    }
    const animationResult = state.mode === "select" ? animationPointerHit(point, event.pointerType) : null;
    if (animationResult && ["resize", "width", "height"].includes(animationResult.hit)) {
      refreshHandObjectToolbar();
      return beginAnimationGesture(event, point, animationResult);
    }
    return false;
  }
  function handleCanvasPointerDown(e) {
    if (e.target?.closest?.(".canvas-widget")?.dataset.widgetId === state.interactingWidgetId) return;
    view.classList.remove("is-wheel-navigating");
    state.handToolbarTap = null;
    if (!state.viewMode && state.mode === "hand" && !state.spacePan && !e.altKey && e.button === 0 && !state.touches.size) {
      const point = clientPoint(e),
        resizeTarget = widgetPointerHit(point, e.pointerType, false),
        target = resizeTarget && ["resize", "width", "height"].includes(resizeTarget.hit)
          ? { kind:"widget", object:resizeTarget.widget }
          : handObjectToolbarTargetAtPoint(point);
      if (target) state.handToolbarTap = { id:e.pointerId, target, x:e.clientX, y:e.clientY };
      else hideHandObjectToolbar({ all:true, animate:false });
    }
    if (e.pointerType === "touch" && canvasPencilWritingActive()) return;
    if (e.pointerType === "mouse" && ![0, 1].includes(e.button)) return;
    e.preventDefault();
    if (state.viewMode) {
      const target = state.viewTool === "select" && !state.spacePan && e.button === 0
        ? canvasWidgetAtEvent(e) : null;
      setWidgetInteraction(null);
      if (target) state.widgetActivationTap = { id:e.pointerId, widget:target, x:e.clientX, y:e.clientY };
      if (e.pointerType === "mouse" && ![0, 1].includes(e.button)) return;
      state.canvasAgentNavigationPointerIds.add(e.pointerId);
      try { screen.setPointerCapture(e.pointerId); } catch {}
      calibrateScreenClientRatio(e, false);
      state.pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if (e.pointerType === "touch") {
        state.touches.set(e.pointerId, { x:e.clientX, y:e.clientY });
        if (state.touches.size >= 2) {
          state.widgetActivationTap = null;
          beginTouchGesture();
          return;
        }
      }
      state.panGesture = { id:e.pointerId, last:{ x:e.clientX, y:e.clientY } };
      setCanvasCursor("grabbing");
      setNavigating(true);
      return;
    }
    if (state.interactingWidgetId && !state.spacePan) setWidgetInteraction(null);
    finishStaleWidgetHostGesture(e);
    if (e.pointerType === "pen") {
      state.touches.clear();
      state.touchGesture = null;
      state.panGesture = null;
    }
    if (Date.now() < state.textInputBlockedUntil) return;
    state.canvasAgentNavigationPointerIds.add(e.pointerId);
    try {
      screen.setPointerCapture(e.pointerId);
    } catch {}
    calibrateScreenClientRatio(e, false);
    const penEraser = canvasPenEraserActive(e),
      handPoint = !penEraser && !state.spacePan && ["hand", "select"].includes(state.mode) ? clientPoint(e) : null;
    beginCanvasWidgetGestureResetTap(e, handPoint);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (handPoint && e.pointerType !== "touch" && beginHandObjectResize(e, handPoint)) {
      state.handToolbarTap = null;
      return;
    }

    if (handPoint) beginHandObjectFocus(e, handPoint);
    if (penEraser) {
      const input = captureDrawingInput(e);
      beginCanvasPointerAction(e, input.point, { forceEraser:true, inputTransform:input.inputTransform });
      return;
    }
    if (e.pointerType === "touch") {
      const touchPoint = clientPoint(e),
        touchWidget = valid(touchPoint) ? widgetAtRefinePoint(touchPoint) : null;
      if (touchWidget) {
        if (state.mode !== "select") showCanvasHint("canvasHintWidgetTouchHand");
        if (state.mode === "pen") beginWidgetRefineTouch(`canvas-touch:${e.pointerId}`, touchWidget);
      }
      state.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (state.touches.size >= 2) {
        state.textTap = null;
        cancelAreaEraseGesture();
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
    if (isMousePan(e) || state.spacePan) {
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
    if (state.mode === "select" && beginCanvasObjectSelection(e, handPoint || clientPoint(e))) return;
    const input = captureDrawingInput(e);
    beginCanvasPointerAction(e, input.point, { inputTransform:input.inputTransform });
  }
  screen.addEventListener("pointerdown", handleCanvasPointerDown);
  function updateActiveCanvasDrawing(e) {
    const d = state.drawing;
    if (!d || d.id !== e.pointerId) return false;
    const old = state.pointers.get(e.pointerId),
      p = drawingClientPoint(d, e),
      cssSize = d.erase ? state.eraser : pressureWidth(e),
      size = logicalWidth(cssSize);
    state.pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
    state.userRevision++;
    appendLiveInkSample(d, p, size);
    commitLiveInkDrawingProgress(d);
    if (d.erase) updateCanvasPointerPreview(e, p);
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
    d.bbox = { x:x1, y:y1, w:x2 - x1, h:y2 - y1 };
    return true;
  }
  screen.addEventListener("pointermove", (e) => {
    e.preventDefault();
    const handTap = state.handToolbarTap;
    if (handTap && Math.hypot(e.clientX - handTap.x, e.clientY - handTap.y) > 6) state.handToolbarTap = null;
    if (e.pointerType === "touch" && !state.touches.has(e.pointerId)) return;
    if (state.viewMode) {
      if (!state.pointers.has(e.pointerId)) return;
      const tap = state.widgetActivationTap;
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) state.widgetActivationTap = null;
      const old = state.pointers.get(e.pointerId);
      calibrateScreenClientRatio(e, true);
      state.pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if (e.pointerType === "touch") state.touches.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if (state.touches.size >= 2) {
        if (!state.touchGesture) beginTouchGesture();
        updateTouchGesture();
        return;
      }
      if (state.panGesture?.id === e.pointerId && old) {
        moveCanvas(e.clientX - old.x, e.clientY - old.y);
        state.panGesture.last = { x:e.clientX, y:e.clientY };
        setNavigating(true);
      }
      return;
    }
    if (updateActiveCanvasDrawing(e)) return;
    updateCanvasWidgetGestureResetTap(e);
    if (finishReleasedWidgetGesture(e)) return;
    const old = state.pointers.get(e.pointerId);
    calibrateScreenClientRatio(e, true);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch") state.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (state.panGesture?.id === e.pointerId && (e.pointerType !== "touch" || state.touches.size < 2)) {
      if (old) {
        moveCanvas(e.clientX - old.x, e.clientY - old.y);
        state.panGesture.last = { x:e.clientX, y:e.clientY };
        setNavigating(true);
      }
      return;
    }
    updateHandObjectFocus(e);
    if (["hand", "select"].includes(state.mode) && e.pointerType !== "touch" && Number(e.buttons) === 0) {
      const point = clientPoint(e);
      updateHandObjectHover(point);
      syncWidgetResizeCursor(point, e.pointerType);
    }
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
    if (state.areaEraseGesture?.id === e.pointerId) {
      updateAreaEraseGesture(e);
      const point = clientPoint(e);
      requestCoordinatesUpdate(point);
      return;
    }
    if (state.selectionGesture?.id === e.pointerId) {
      updateSelectionGesture(e);
      const point = clientPoint(e);
      requestCoordinatesUpdate(point);
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

      if (state.touches.size >= 2) {
        updateTouchGesture();
        return;
      }
      return;
    }
  });
  function finishHandCanvasTap(e) {
    const handTap = state.handToolbarTap;
    if (handTap?.id === e.pointerId) {
      state.handToolbarTap = null;
      if (e.type === "pointerup" && !state.viewMode && state.mode === "hand" && !state.spacePan && state.touches.size <= 1
          && Math.hypot(e.clientX - handTap.x, e.clientY - handTap.y) <= 6) showHandObjectToolbar(handTap.target.kind, handTap.target.object);
    }
  }
  function end(e) {
    finishHandCanvasTap(e);
    const activation = state.widgetActivationTap;
    if (activation?.id === e.pointerId) {
      state.widgetActivationTap = null;
      if (e.type === "pointerup" && Math.hypot(e.clientX - activation.x, e.clientY - activation.y) <= 6 && state.touches.size <= 1) {
        enterWidgetInteraction(activation.widget);
      }
    }
    finishCanvasNavigationPreview();
    if (coordinatesUpdatePending) flushCoordinatesUpdate();
    if (state.viewMode) {
      state.pointers.delete(e.pointerId);
      canvasAgentNavigationPointerDidEnd(e.pointerId);
      if (e.pointerType === "touch") state.touches.delete(e.pointerId);
      state.touchGesture = null;
      if (e.pointerType === "touch" && state.touches.size === 1) {
        const [id, point] = state.touches.entries().next().value;
        state.panGesture = { id, last:point };
      } else if (state.panGesture?.id === e.pointerId || !state.touches.size) state.panGesture = null;
      if (!state.panGesture) {
        setCanvasCursor("grab");
        setNavigating(false);
      }
      return;
    }
    state.pointers.delete(e.pointerId);
    canvasAgentNavigationPointerDidEnd(e.pointerId);
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
    if (state.areaEraseGesture?.id === e.pointerId) {
      finishAreaEraseGesture(e);
      if (e.pointerType === "touch") {
        state.touchGesture = null;
        state.panGesture = null;
        if (!state.touches.size) setNavigating(false);
      }
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
  // Capture releases even when an overlay consumes the event or capture is lost.
  window.addEventListener("pointermove", finishReleasedWidgetGesture, true);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) {
    window.addEventListener(type, finishInterruptedWidgetGesture, type !== "blur");
  }
  document.addEventListener("visibilitychange", finishInterruptedWidgetGesture);
  const finishCanvasAgentNavigationPointer = (event) => canvasAgentNavigationPointerDidEnd(event.pointerId);
  window.addEventListener("pointerup", finishCanvasAgentNavigationPointer, true);
  window.addEventListener("pointercancel", finishCanvasAgentNavigationPointer, true);
  screen.addEventListener("lostpointercapture", finishCanvasAgentNavigationPointer);
  screen.addEventListener("pointerleave", () => {
    cancelCanvasWidgetGestureResetTap();
    updateHandObjectHover(null);
    if (!state.widgetGesture) resetCanvasCursor();
    if (!state.pointerPreview) return;
    state.pointerPreview = null;
    requestInteractionLayerRender();
  });
  view.addEventListener("pointerleave", () => {
    updateHandObjectHover(null);
    updateWidgetRefinePointer(null);
  });
  // The viewport context menu is owned by canvas-navigation.js: it suppresses
  // the native menu and opens the Widget toolbar when one is under the pointer.
  view.addEventListener("wheel", handleCanvasWheel, { passive:false });
  view.addEventListener("gesturestart", beginCanvasTrackpadGesture, { passive:false });
  view.addEventListener("gesturechange", updateCanvasTrackpadGesture, { passive:false });
  view.addEventListener("gestureend", endCanvasTrackpadGesture, { passive:false });
  canvasNavigationLock.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  canvasNavigationLock.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCanvasNavigationLocked(!state.navigationLocked);
    void window.PenEchoStudioNavigator?.flushMcpFollow?.();
  });
  function enterAIDraftHandMode() {
    if (state.mode !== "select" && state.aiDraftReturnMode === null) state.aiDraftReturnMode = state.mode;
    state.pendingHistoryRestored = false;
    if (state.mode !== "select") setCanvasMode("select", {
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
    if (returnMode && state.mode === "select") setCanvasMode(returnMode, {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function updateEraserToolUI() {
    if (!eraserToolButton) return;
    const area = state.eraserMode === "area-eraser",
      key = area ? "areaEraser" : "eraser";
    eraserToolButton.dataset.i18nAria = key;
    eraserToolButton.dataset.i18nTitle = key;
    eraserToolButton.dataset.activeEraser = state.eraserMode;
    eraserToolButton.setAttribute("aria-label", t(key));
    eraserToolButton.setAttribute("title", t(key));
    eraserFreehandButton?.setAttribute("aria-checked", String(!area));
    eraserAreaButton?.setAttribute("aria-checked", String(area));
  }
  function showEraserToolMenu(focus = false) {
    if (!eraserToolMenu || !eraserToolButton) return;
    clearTimeout(eraserToolMenuTimer);
    eraserToolMenu.hidden = false;
    eraserToolButton.setAttribute("aria-expanded", "true");
    updateEraserToolUI();
    positionToolbarPopover("#eraserToolControl", "#eraserToolMenu", { align:"center", gap:6 });
    requestAnimationFrame(positionOpenToolbarPopovers);
    if (focus) (state.eraserMode === "area-eraser" ? eraserAreaButton : eraserFreehandButton)?.focus({ preventScroll:true });
    eraserToolMenuTimer = setTimeout(() => hideEraserToolMenu(), ERASER_TOOL_MENU_MS);
  }
  function hideEraserToolMenu(options) {
    options ||= {};
    clearTimeout(eraserToolMenuTimer);
    eraserToolMenuTimer = 0;
    if (!eraserToolMenu || eraserToolMenu.hidden) return;
    const restoreFocus = options.restoreFocus || eraserToolMenu.contains(document.activeElement);
    eraserToolMenu.hidden = true;
    eraserToolButton?.setAttribute("aria-expanded", "false");
    if (restoreFocus) eraserToolButton?.focus({ preventScroll:true });
  }
  function selectEraserMode(mode, options) {
    options ||= {};
    if (!["eraser", "area-eraser"].includes(mode)) return;
    state.eraserMode = mode;
    updateEraserToolUI();
    selectCanvasToolMode(mode, { showHint:true });
    if (options.keepMenuOpen) showEraserToolMenu();
  }
  function syncCanvasModePresentation() {
    const mode = state.mode,
      eraserMode = ["eraser", "area-eraser"].includes(mode),
      button = eraserMode ? eraserToolButton : document.querySelector(`[data-mode="${mode}"]`);
    if (!button) return false;
    document.body?.setAttribute("data-canvas-mode", mode);
    if (typeof canvasAgentScheduleToolbarLayout === "function") canvasAgentScheduleToolbarLayout();
    view.classList.toggle("hand-mode", mode === "hand");
    syncCanvasNavigation();
    document.querySelectorAll("[data-mode]").forEach((item) => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    updateEraserToolUI();
    resetCanvasCursor();
    return true;
  }
  function setCanvasMode(mode, options) {
    options ||= {};
    if (mode !== state.mode || state.interactingWidgetId) setWidgetInteraction(null, { restoreTool:false });
    const eraserMode = ["eraser", "area-eraser"].includes(mode),
      button = eraserMode ? eraserToolButton : document.querySelector(`[data-mode="${mode}"]`);
    if (!button) return;
    if (mode !== state.mode && state.drawing) finishDrawing(state.drawing.pointerType);
    if (state.widgetGesture) finishInterruptedWidgetGesture({ type:"tool-change" });
    if (eraserMode) {
      state.eraserMode = mode;
      localStorage.setItem(ERASER_MODE_STORAGE_KEY, mode);
    }
    if (state.areaEraseGesture) cancelAreaEraseGesture();
    hideEraserToolMenu();
    const finalizingPendingWidgetForEraser = eraserMode && ["hand", "select", "pen"].includes(state.mode)
      && !options.skipDraftFinalize && Boolean(state.pendingWidget);
    if (finalizingPendingWidgetForEraser) {
      state.aiDraftReturnMode = null;
      state.pendingHistoryRestored = false;
      acceptPendingWidget({ restoreMode:false, allowRevisionMismatch:true });
    }
    const staysInWidgetRefineModes = ["pen", "hand"].includes(state.mode) && ["pen", "hand"].includes(mode);
    if (mode !== state.mode && !staysInWidgetRefineModes && !options.preserveWidgetRefinement && (activeWidgetRefinement() || state.pendingWidgetReplacement)) {
      state.aiDraftReturnMode = null;
      state.pendingHistoryRestored = false;
      if (state.pendingWidgetReplacement) acceptPendingWidget({ restoreMode:false });
      else cancelWidgetRefinement("widget-refine-tool-change", { restoreMode:false });
    }
    const leavingDraftHand = state.mode === "select" && mode !== "select" && !options.skipDraftFinalize && (state.pending || state.pendingWidget);
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
    if (state.mode === "select" && mode !== "select") {
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
    if (state.mode !== "select") state.widgetReturnMode = state.mode;
    state.mode = mode;
    if (mode !== "select") state.widgetReturnMode = mode;
    updateAutoControl();
    if (mode !== "pen") updateWidgetRefinePointer(null);
    else refreshWidgetRefineHoverCandidate();
    if (mode !== "eraser") state.pointerPreview = null;
    if (mode !== "select") deselectAnimation();
    syncCanvasModePresentation();
    requestInteractionLayerRender();
    if (mode === "hand") setNavigating(true);
    if (mode === "hand" && options.showHint && !state.busy) {
      showHandStatusHint("hand-mode", ["handAutoAIManual", "handAutoAIResume"]);
    }
    if (options.showHint) {
      const shortcutHints = {
        agent:keyboardShortcutCanvasHint("focus-agent", "canvasHintShortcutAgent"),
        save:keyboardShortcutCanvasHint("save-canvas", "canvasHintShortcutSave"),
        undoRedo:keyboardShortcutUndoRedoHint(),
        library:keyboardShortcutCanvasHint("canvas-library", "canvasHintShortcutLibrary"),
        fullscreen:keyboardShortcutCanvasHint("toggle-fullscreen", "canvasHintShortcutFullscreen"),
        settings:keyboardShortcutCanvasHint("open-settings", "canvasHintShortcutSettings"),
      };
      const hintKey = {
        pen:[shortcutHints.agent, shortcutHints.save, shortcutHints.undoRedo, "canvasHintMcp"],
        hand:["canvasHintHand", "canvasHintHandAlt", shortcutHints.agent, shortcutHints.library, shortcutHints.fullscreen],
        select:["canvasHintLasso", state.widgets.length ? (widgetInteractionPresentation() === "maximized" ? "canvasHintWidgetFullscreen" : "canvasHintWidgetInline") : "canvasHintLassoAlt", shortcutHints.undoRedo],
        text:["canvasHintText", "canvasHintTextAlt", shortcutHints.save],
        eraser:["canvasHintEraser", "canvasHintEraserAlt"],
        "area-eraser":["canvasHintAreaEraser", "canvasHintAreaEraserAlt", shortcutHints.undoRedo, shortcutHints.settings],
      }[mode];
      if (hintKey) showCanvasHint(hintKey);
    }
    if (deferredSelectionCommit) queueMicrotask(() => {
      if (state.mode === mode && state.selection && !selectionAIBusy(state.selection)) commitSelection();
    });
  }
  function canvasToolMode(mode) {
    return ["hand", "pen", "select", "text", "eraser", "area-eraser"].includes(mode) ? mode : "";
  }
  function selectCanvasToolMode(mode, options) {
    mode = canvasToolMode(mode);
    if (!mode) return false;
    const previous = canvasToolMode(state.mode);
    setCanvasMode(mode, options);
    if (state.mode !== mode) return false;
    if (previous && previous !== mode) state.previousToolMode = previous;
    return true;
  }
  function performCanvasPencilAction(action) {
    if (state.viewMode || state.drawing || state.areaEraseGesture || state.selectionGesture) return false;
    const current = canvasToolMode(state.mode) || "pen",
      previous = canvasToolMode(state.previousToolMode);
    if (action === "switch-previous") {
      if (!previous || previous === current) return false;
      return selectCanvasToolMode(previous, { showHint:true });
    }
    if (action !== "switch-eraser") return false;
    const currentIsEraser = ["eraser", "area-eraser"].includes(current),
      previousNonEraser = previous && !["eraser", "area-eraser"].includes(previous) ? previous : "pen",
      target = currentIsEraser
        ? previousNonEraser
        : ["eraser", "area-eraser"].includes(state.eraserMode) ? state.eraserMode : "eraser";
    return selectCanvasToolMode(target, { showHint:true });
  }
  window.addEventListener("penecho:pencil-action", (event) => {
    performCanvasPencilAction(event.detail?.action);
  });
  document.querySelectorAll("[data-mode]").forEach((button) => {
    if (button === eraserToolButton) return;
    button.onclick = () => selectCanvasToolMode(button.dataset.mode, { showHint:true });
  });
  eraserToolButton?.addEventListener("contextmenu", (event) => event.preventDefault());
  eraserToolButton?.addEventListener("click", () => selectEraserMode(state.eraserMode, { keepMenuOpen:true }));
  eraserToolButton?.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    showEraserToolMenu(true);
  });
  for (const button of [eraserFreehandButton, eraserAreaButton].filter(Boolean)) {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectEraserMode(button.dataset.eraserMode, { keepMenuOpen:true });
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hideEraserToolMenu({ restoreFocus:true });
        return;
      }
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      (button === eraserFreehandButton ? eraserAreaButton : eraserFreehandButton)?.focus({ preventScroll:true });
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (eraserToolMenu && !eraserToolMenu.hidden && !eraserToolControl?.contains(event.target) && !eraserToolMenu.contains(event.target)) hideEraserToolMenu();
  });
  updateEraserToolUI();
  canvasViewButton.onclick = () => setCanvasViewMode(true);
  canvasViewCloseButton.onclick = () => setCanvasViewMode(false);
  canvasViewShareButton.onclick = () => document.querySelector("#shareCanvasBtn")?.click();
  canvasViewDownloadButton.onclick = exportCanvasPng;
  [selectionTypesetButton, selectionDeleteButton, selectionCancelButton].filter(Boolean).forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => event.stopPropagation());
  });
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
    const metrics = canvasViewportMetrics(),
      scale = Math.max(0.03, state.scale),
      width = Math.min(TEXT_EDITOR_DEFAULT_WIDTH, Math.max(TEXT_EDITOR_MIN_WIDTH, metrics.width - 24)),
      height = Math.min(TEXT_EDITOR_DEFAULT_HEIGHT, Math.max(TEXT_EDITOR_MIN_HEIGHT, metrics.height - 24)),
      center = { x:(metrics.width / 2 - state.panX) / scale, y:(metrics.height / 2 - state.panY) / scale };
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
    if (state.mode !== "select") setCanvasMode("select", {
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
    state.pen = clampPenWidth(Math.round(Number(e.target.value)));
    e.target.value = String(state.pen);
    document.querySelector("#penSizeValue").textContent = `${state.pen} px`;
  };
  document.querySelector("#aiFont").onchange = (e) => {
    setAiFont(e.target.value);
  };
  function colorOrbitFor(control) {
    const id = control?.querySelector(".color-orb-trigger")?.getAttribute("aria-controls");
    return id ? document.getElementById(id) : null;
  }
  function closeColorOrbs(except = null) {
    document.querySelectorAll("[data-color-control]").forEach((control) => {
      if (control === except) return;
      const trigger = control.querySelector(".color-orb-trigger"),
        orbit = colorOrbitFor(control),
        focusedInside = (control.contains(document.activeElement) || orbit?.contains(document.activeElement)) && document.activeElement !== trigger;
      control.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      if (orbit) {
        orbit.hidden = true;
        orbit.querySelector(".custom-color-editor").hidden = true;
        orbit.querySelector("[data-custom-color-open]").setAttribute("aria-expanded", "false");
        orbit.setAttribute("aria-hidden", "true");
        orbit.querySelectorAll(".orbit-swatch, [data-custom-color-open]").forEach((button) => button.setAttribute("tabindex", "-1"));
      }
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
      orbit.hidden = !open;
      if (!open) {
        orbit.querySelector(".custom-color-editor").hidden = true;
        orbit.querySelector("[data-custom-color-open]").setAttribute("aria-expanded", "false");
      }
      orbit.setAttribute("aria-hidden", String(!open));
      orbit.querySelectorAll(".orbit-swatch, [data-custom-color-open]").forEach((button) => button.setAttribute("tabindex", open ? "0" : "-1"));
      if (open) {
        positionToolbarPopover(`[data-color-control="${type}"]`, `#${orbit.id}`, { align:"center", gap:6 });
        requestAnimationFrame(positionOpenToolbarPopovers);
      }
    };
    const customInput = orbit.querySelector("[data-custom-color]");
    function selectColor(color) {
      if (!/^#[0-9a-f]{6}$/i.test(color)) return;
      color = color.toLowerCase();
      if (type === "ink") {
        state.inkColor = color;
        applySelectionColor(color);
        positionTextEditors();
        for (const editor of state.textEditors.values()) if (editor.mixedMode) scheduleTextEditorPreview(editor, 0);
      } else state.aiColor = color;
      trigger.classList.remove(...Object.values(COLOR_CLASS));
      if (COLOR_CLASS[color]) trigger.classList.add(COLOR_CLASS[color]);
      runtimeElementStyle(trigger, `color-trigger-${type}`)?.setProperty("--selected-color", color);
      if (customInput) customInput.value = color;
      orbit.querySelectorAll(".orbit-swatch").forEach((item) => {
        const active = (type === "ink" ? item.dataset.inkColor : item.dataset.aiColor) === color;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
    }
    orbit.onclick = (event) => event.stopPropagation();
    orbit.onkeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeColorOrbs();
    };
    const customEditor = orbit.querySelector(".custom-color-editor"),
      customOpen = orbit.querySelector("[data-custom-color-open]"),
      channels = [...customEditor.querySelectorAll("[data-color-channel]")];
    function previewCustomColor(color) {
      if (!/^#[0-9a-f]{6}$/i.test(color)) return;
      customInput.value = color.toLowerCase();
      customEditor.querySelector(".custom-color-preview").style.backgroundColor = color;
      channels.forEach((slider, index) => {
        slider.value = String(parseInt(color.slice(1 + index * 2, 3 + index * 2), 16));
        slider.nextElementSibling.value = slider.value;
      });
    }
    function closeCustomColor() {
      customEditor.hidden = true;
      customOpen.setAttribute("aria-expanded", "false");
      customOpen.focus({ preventScroll:true });
      positionOpenToolbarPopovers();
    }
    customOpen.onclick = () => {
      if (!customEditor.hidden) { closeCustomColor(); return; }
      previewCustomColor(type === "ink" ? state.inkColor : state.aiColor);
      customEditor.hidden = false;
      customOpen.setAttribute("aria-expanded", "true");
      positionOpenToolbarPopovers();
    };
    customInput.oninput = () => previewCustomColor(customInput.value);
    channels.forEach(slider => {
      slider.oninput = () => previewCustomColor("#" + channels.map(channel => Number(channel.value).toString(16).padStart(2, "0")).join(""));
    });
    customEditor.querySelector("[data-custom-color-cancel]").onclick = closeCustomColor;
    customEditor.onkeydown = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeCustomColor();
    };
    customEditor.onsubmit = event => {
      event.preventDefault();
      if (!customEditor.reportValidity()) return;
      selectColor(customInput.value);
      closeColorOrbs();
    };
    orbit.querySelectorAll(".orbit-swatch").forEach((button) => {
      button.setAttribute("tabindex", "-1");
      button.setAttribute("aria-pressed", String(button.classList.contains("active")));
      button.onclick = (event) => {
        event.stopPropagation();
        selectColor(type === "ink" ? button.dataset.inkColor : button.dataset.aiColor);
        closeColorOrbs();
      };
    });
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
  document.querySelector("#effortCustomForm").onsubmit = (event) => {
    event.preventDefault();
    const input = document.querySelector("#aiEffortCustomInput");
    if (setEffort(input.value)) document.querySelector("#aiEffortButton").focus({ preventScroll:true });
  };
  document.querySelector("#aiEffortCustomInput").addEventListener("input", (event) => {
    const input = event.currentTarget, start = input.selectionStart, end = input.selectionEnd,
      normalized = input.value.toLowerCase();
    if (normalized !== input.value) {
      input.value = normalized;
      if (start !== null && end !== null) input.setSelectionRange(start, end);
    }
    keepEffortControlOpen();
  });
  document.querySelector("#aiEffortCustomInput").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hideEffortControl();
      document.querySelector("#aiEffortButton").focus({ preventScroll:true });
      return;
    }
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    const options = [...document.querySelectorAll("#effortOptions .effort-option")], selected = options.find(option => option.getAttribute("aria-selected") === "true");
    (selected || options[0])?.focus({ preventScroll:true });
  });
  pluginButton.onclick = () => {
    if (pluginPopover.hidden) {
      closeSettings(false);
      showPluginControl();
    }
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
    option.onclick = () => {
      setEffort(option.dataset.effort);
      document.querySelector("#aiEffortButton").focus({ preventScroll:true });
    };
  });
  document.querySelector("#effortPopover").addEventListener("pointerdown", keepEffortControlOpen);
  document.querySelector("#effortPopover").addEventListener("focusin", () => {
    clearTimeout(state.effortPopoverTimer);
    state.effortPopoverTimer = 0;
  });
  document.querySelector("#effortPopover").addEventListener("focusout", keepEffortControlOpen);
  document.querySelector("#autoDelayPopover").addEventListener("pointerdown", keepAutoDelayControlOpen);
  document.querySelector(".toolbar").addEventListener("scroll", positionOpenToolbarPopovers, { passive:true });
  window.addEventListener("resize", positionOpenToolbarPopovers);
  document.addEventListener("pointerdown", (event) => {
    if (!document.querySelector("#autoControl").contains(event.target) && !document.querySelector("#autoDelayPopover").contains(event.target)) hideAutoDelayControl();
    if (!document.querySelector("#effortControl").contains(event.target) && !document.querySelector("#effortPopover").contains(event.target)) hideEffortControl();
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
  document.querySelectorAll(".studio-palette-option[data-studio-palette]").forEach((button) => {
    button.addEventListener("click", () => applyStudioPalette(button.dataset.studioPalette));
  });
  document.querySelectorAll("[data-page-scale]").forEach((button) => {
    button.addEventListener("click", () => applyPageScale(button.dataset.pageScale));
  });
  document.querySelector("#gridToggle").onclick = () => {
    state.gridVisible = !state.gridVisible;
    localStorage.setItem("penecho-grid", String(state.gridVisible));
    updateGridButton();
    requestRender();
  };
  const fullscreenButton = document.querySelector("#fullscreenBtn");
  fullscreenButton.onclick = async (event) => {
    const pointerActivated = (event?.detail || 0) > 0;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      setStatus(`${t("aiError")}${error.message}`);
    } finally {
      if (pointerActivated) requestAnimationFrame(() => fullscreenButton.blur());
    }
  };
  document.querySelector("#newCanvasBtn").onclick = () => canvasDocumentsUiAction(openNewCanvasDialog);
  document.querySelector("#saveCanvasBtn").onclick = saveCurrentCanvas;
  document.querySelector("#exportPngBtn").onclick = exportCanvasPng;
  document.querySelector("#historyBtn").onclick = openHistoryPanel;
  document.querySelector("#historyClose").onclick = closeHistoryPanel;
  document.querySelector("#historyBackdrop").onclick = closeHistoryPanel;
  document.querySelector("#historySaveCurrent").onclick = () => {
    closeHistorySavePanel();
    void saveCurrentCanvas();
  };
  document.querySelector("#historySave").onclick = () => {
    closeHistorySavePanel();
    void saveSnapshotFromHistory();
  };
  document.querySelector("#historySearch").addEventListener("input", () => historyFiltersChanged());
  window.addEventListener("penecho:cloud-account-changed", reconcileHistoryIdentity);
  window.addEventListener("penecho:remote-cloud-status", reconcileHistoryIdentity);
  document.querySelector("#historySort").addEventListener("change", () => historyFiltersChanged({immediate:true}));
  document.querySelectorAll("[data-history-view]").forEach((button) => {
    button.addEventListener("click", () => setHistoryView(button.dataset.historyView));
  });
  const historySavePanel = document.querySelector("#historySavePanel");
  historySavePanel.addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (historySavePanel.open && !historySavePanel.contains(document.activeElement)) closeHistorySavePanel();
    });
  });
  document.querySelector("#historyPanel").addEventListener("pointerdown", (event) => {
    if (historySavePanel.open && event.target instanceof Node && !historySavePanel.contains(event.target)) closeHistorySavePanel();
    if (event.target instanceof Element && event.target.closest(".history-more, .history-row-actions")) return;
    closeHistoryRowActions();
  });
  document.querySelector("#historyNewCanvas").onclick = () => {
    closeHistoryPanel();
    requestAnimationFrame(() => document.querySelector("#newCanvasBtn")?.click());
  };
  document.querySelector("#historyDeleteConfirm").onclick = () => void confirmSnapshotDelete();
  document.querySelector("#historyDeleteDialog").addEventListener("close", () => {
    historyDeletePending = null;
    document.querySelector("#historyDeleteConfirm").disabled = false;
  });
  document.querySelector("#historyProjectSelect").onchange = (event) => {
    if (state.snapshotLocation === "cloud") rememberSelectedCloudProject(event.target.value);
    else rememberSelectedServerProject(event.target.value);
    historyFiltersChanged({immediate:true});
  };
  document.querySelector("#newCanvasProjectSelect").onchange = (event) => {
    if (state.snapshotLocation === "cloud") rememberSelectedCloudProject(event.target.value);
    else rememberSelectedServerProject(event.target.value);
    renderSnapshotList();
  };
  document.querySelector("#historyProjectCreate").onclick = openServerProjectDialog;
  document.querySelector("#historyProjectDelete").onclick = requestSelectedProjectDelete;
  const projectDialog = document.querySelector("#projectDialog"),
    projectForm = document.querySelector("#projectForm"),
    closeProjectDialog = () => {
      if (projectDialog.dataset.busy !== "true" && projectDialog.open) projectDialog.close("cancel");
    };
  document.querySelector("#projectDialogClose").onclick = closeProjectDialog;
  document.querySelector("#projectName").addEventListener("input", (event) => event.currentTarget.setCustomValidity(""));
  projectDialog.addEventListener("cancel", (event) => {
    if (projectDialog.dataset.busy === "true") event.preventDefault();
  });
  projectForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (projectDialog.dataset.busy === "true") return;
    projectDialog.dataset.busy = "true";
    const buttons = [...projectForm.querySelectorAll("button")];
    buttons.forEach((button) => (button.disabled = true));
    try {
      await runSnapshotAction(createServerProject);
    } finally {
      projectDialog.dataset.busy = "false";
      buttons.forEach((button) => (button.disabled = false));
    }
  });
  document.querySelectorAll('input[name="historyStorageLocation"], input[name="newCanvasStorageLocation"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) setSnapshotLocation(input.value);
    });
  });
  document.querySelector("#newCanvasClose").onclick = () => {
    pendingCanvasTransition?.onCancel?.();
    pendingCanvasTransition = null;
    window.PenEchoStudioNavigator?.cancelPendingConversation?.();
    document.querySelector("#newCanvasDialog").close("cancel");
  };
  document.querySelector("#textHelpClose").onclick = closeTextHelp;
  document.querySelector("#textHelpDialog").addEventListener("close", restoreTextEditorAfterHelp);
  document.querySelector("#newDiscard").onclick = discardCanvasTransition;
  document.querySelector("#newSaveCopy").onclick = () => completeNewCanvas("new");
  document.querySelector("#newOverwrite").onclick = () => completeNewCanvas("overwrite");
  document.querySelector("#newCanvasDialog").addEventListener("cancel", (event) => {
    if (event.currentTarget.dataset.busy === "true") event.preventDefault();
    else {
      pendingCanvasTransition?.onCancel?.();
      pendingCanvasTransition = null;
      window.PenEchoStudioNavigator?.cancelPendingConversation?.();
    }
  });
  document.querySelector("#historyName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeHistorySavePanel();
      void saveCurrentCanvas();
    }
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
  const debugButton = document.querySelector("#debugBtn");
  if (debugButton) debugButton.onclick = (e) => {
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
            saveUserCanvasChange();
            render();
          }
        } else invokeAIAction(a);
      }),
  );
  embodiment.addEventListener("pointerenter", revealAIOrb);
  embodiment.addEventListener("pointerleave", scheduleAIOrbIdle);
  aiOrb.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    revealAIOrb();
    if (state.busy) {
      stopActiveAIRequests();
      return;
    }
    invokeAIAction("auto");
  });
  tourBackButton.addEventListener("click", previousFeatureTourStep);
  tourNextButton.addEventListener("click", nextFeatureTourStep);
  tourSkipButton.addEventListener("click", skipFeatureTour);
  changelogCloseButton.addEventListener("click", closeChangelog);
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
  settingsPanel.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-settings-page-target]");
    if (tab) selectSettingsPage(tab.dataset.settingsPageTarget);
  });
  settingsPanel.addEventListener("keydown", handleSettingsNavigationKeydown);
  settingsOpenApi?.addEventListener("click", () => openConfiguration("api"));
  settingsOpenSearch?.addEventListener("click", () => openConfiguration("search"));
  settingsOpenSystem?.addEventListener("click", () => openConfiguration("system"));
  configurationClose?.addEventListener("click", () => closeConfiguration());
  configurationBackdrop?.addEventListener("pointerdown", () => closeConfiguration());
  configurationPanel?.addEventListener("pointerdown", event => event.stopPropagation());
  canvasSettingsForm?.addEventListener("submit", saveCanvasSettings);
  settingsTestConnection?.addEventListener("click", () => void testCanvasConnection());
  settingsTestSearch?.addEventListener("click", () => void testCanvasSearch());
  settingsFetchModels?.addEventListener("click", () => void fetchConnectionModels());
  settingsInstallCli?.addEventListener("click", () => void installCanvasCli());
  settingsCliCopyCommand?.addEventListener("click", () => void copyCanvasCliCommand());
  settingsAddConnection?.addEventListener("click", () => fillConnectionEditor());
  settingsEditorCancel?.addEventListener("click", hideConnectionEditor);
  settingsConnectionList?.addEventListener("click", handleConnectionAction);
  settingsConnectionQuickList?.addEventListener("click", handleConnectionAction);
  document.getElementById("settingsHostedList")?.addEventListener("click", handleConnectionAction);
  document.getElementById("settingsHostedRefresh")?.addEventListener("click", () => void loadCanvasSettings());
  window.addEventListener("penecho:cloud-account-changed", () => void loadHostedModels({ accountChanged:true }));
  void loadHostedModels();
  settingsEffortToggle?.addEventListener("click", () => settingsEffortOptions.hidden ? showSettingsEffortOptions() : hideSettingsEffortOptions());
  settingsEffort?.addEventListener("pointerdown", showSettingsEffortOptions);
  settingsEffort?.addEventListener("input", () => {
    updateSettingsEffortOptions();
    showSettingsEffortOptions();
  });
  settingsEffort?.addEventListener("keydown", handleSettingsEffortKeydown);
  settingsEffortOptions?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-effort-value]");
    if (option) chooseSettingsEffort(option.dataset.effortValue);
  });
  settingsEffortOptions?.addEventListener("keydown", handleSettingsEffortOptionKeydown);
  document.addEventListener("pointerdown", (event) => {
    if (!settingsEffortCombobox?.contains(event.target)) hideSettingsEffortOptions();
    if (!document.querySelector("#settingsApiModelCombobox")?.contains(event.target)) hideApiModelOptions();
  });
  if (window.penechoDesktop) document.querySelector(".settings-links")?.remove();
  settingsProvider?.addEventListener("change", () => {
    updateSettingsProviderFields();
    selectDefaultConnectionEffort();
  });
  settingsDeepSeekSearchProvider?.addEventListener("change", () => {
    updateDeepSeekSearchProviderNotice();
    resetSearchTestStatuses();
  });
  settingsDeepSeekSearchApiKey?.addEventListener("input", resetSearchTestStatuses);
  settingsTavilyApiKey?.addEventListener("input", resetSearchTestStatuses);
  settingsApiFormat?.addEventListener("change", () => {
    updateApiPresetFields(true, true);
    selectDefaultConnectionEffort();
  });
  settingsApiRegion?.addEventListener("change", () => {
    updateApiPresetFields(true, false);
    clearFetchedApiModels();
  });
  settingsApiService?.addEventListener("change", () => {
    updateApiPresetFields(true, true);
    selectDefaultConnectionEffort();
  });
  settingsApiUrl?.addEventListener("input", clearFetchedApiModels);
  settingsApiKey?.addEventListener("input", clearFetchedApiModels);
  settingsApiModel?.addEventListener("input", updateApiModelSelection);
  settingsApiModel?.addEventListener("click", () => {
    if (PenEchoApiPresets.forFamily(settingsApiFormat?.value)) showApiModelOptions();
  });
  settingsApiModel?.addEventListener("keydown", handleApiModelKeydown);
  settingsApiModelOptions?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-api-model-value]");
    if (option) chooseApiModel(option.dataset.apiModelValue);
  });
  settingsApiModelOptions?.addEventListener("keydown", handleApiModelOptionKeydown);
  settingsTraceToggle?.addEventListener("click", () => {
    settings.requestTrace = !settings.requestTrace;
    updateTraceToggle();
  });
  settingsAutoToggle.addEventListener("click", () => setAutoEnabled(!state.auto));
  settingsCanvasAgentAutoOpenToggle.addEventListener("click", () => setCanvasAgentAutoOpen(!state.canvasAgentAutoOpen));
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
    if (e.defaultPrevented || e.isComposing || keyboardShortcutTextEditingTarget(e.target)) return;
    const canvasKeyContext = keyboardShortcutCanvasContext(e, keyboardShortcutChordFromEvent(e));
    if (e.key === "Escape" && (document.querySelector("#newCanvasDialog").open || document.querySelector("#textHelpDialog").open)) return;
    if (e.key === "Escape" && eraserToolMenu && !eraserToolMenu.hidden) {
      hideEraserToolMenu({ restoreFocus:true });
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Escape" && canvasKeyContext && state.areaEraseGesture) {
      cancelAreaEraseGesture();
      setStatusKey("ready");
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Escape" && canvasKeyContext && state.selection) {
      cancelSelection();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Escape" && canvasKeyContext && state.pendingWidget) {
      rejectPendingWidget();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Escape" && canvasKeyContext && activeWidgetRefinement()) {
      cancelWidgetRefinement();
      setStatusKey("ready");
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Escape" && canvasKeyContext && state.widgetRefineConfirmation) {
      cancelWidgetRefineConfirmation();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Escape" && canvasKeyContext && state.widgetRefineCandidate) {
      dismissWidgetRefineCandidate();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Escape" && canvasKeyContext && state.imageEdit) {
      cancelImageEdit();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.imageEdit && canvasKeyContext) {
      deleteImage(selectedImage());
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Escape" && canvasKeyContext && state.widgetEdit) {
      cancelWidgetEdit();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.widgetEdit && canvasKeyContext) {
      deleteWidget(selectedWidget());
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Enter" && state.selection?.phase === "active" && canvasKeyContext) {
      commitSelection();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Escape" && !document.querySelector("#autoDelayPopover").hidden) {
      hideAutoDelayControl();
      document.querySelector("#auto").focus();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === "Tab" && trapHistoryPanelFocus(e)) return;
    if (e.key === "Escape" && closeHistorySavePanel(true)) return;
    if (e.key === "Escape" && document.querySelector("#historyPanel").classList.contains("open") && !document.querySelector("dialog[open]")) {
      closeHistoryPanel();
      document.querySelector("#historyBtn").focus();
      e.preventDefault();
      e.stopImmediatePropagation();
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

  window.PenEchoCommunityCanvas = Object.freeze({
    widgetArtifact:communityWidgetArtifact,
    canvasArtifact:communityCanvasArtifact,
    suggestMetadata:suggestCommunityMetadata,
    importWidget:importCommunityWidgetArtifact,
    setWidgetFavorite:setCommunityWidgetFavorite,
    importCanvas:importCommunityCanvasArtifact,
    viewCanvas:viewCommunityCanvasArtifact,
    lineageForArtifact:communityLineageForArtifact,
    markPublishedOrigin:markPublishedCommunityOrigin,
  });
  window.PenEchoCloudProjects = Object.freeze({
    currentExecutionScope:canvasAgentCloudExecutionScope,
    currentCanvasId:() => state.currentSnapshotLocation === "cloud" && /^[0-9a-f-]{36}$/i.test(String(state.currentSnapshotId || "")) ? state.currentSnapshotId : null,
    saveEcho:saveEchoToCloud,
    saveForShare:saveLiveShareToCloud,
    shareWidgetId:(id) => state.widgets.find(widget => widget.id === id)?.shareSourceId || null,
    openHistory:openCloudProjectHistory,
    openCanvas:openCloudCanvas,
    confirmExternalOpen:confirmExternalCanvasOpen,
  });
  window.penechoDesktop?.onShowConnections?.(() => {
    selectSettingsPage("connections");
    openSettings();
  });
  setPluginTemplate("simple");
  applyLanguage();
  setWidgetShadowEnabled(state.widgetShadowEnabled);
  applyTheme(state.theme);
  applyStudioPalette(state.studioPalette);
  applyPageScale(state.pageScale);
  resetCanvasCursor();
  loadPluginDocuments().catch(() => {});
  // The public viewer has no history UI and must never probe private/local
  // snapshot APIs on the Cloud origin.
  // A Cloud deep link already identifies its document. Do not prefetch a
  // remembered Server Library (including every preview) on the opening path.
  // Opening Library itself owns its refresh through openHistoryPanel().
  if (window.PENECHO_CONFIG?.runtime !== "viewer"
    && !(window.PENECHO_CONFIG?.runtime === "cloud" && window.PENECHO_CONFIG?.remoteCanvasNativeReads === true)) refreshSnapshots().catch(() => {});
  fit();
  setNavigating(true);
  scheduleAIOrbIdle();
  if(window.PENECHO_CONFIG?.runtime!=="viewer")void canvasDocumentsReady().catch(error=>canvasDocumentsReport(error,()=>canvasDocumentsReady()));
  requestAnimationFrame(() => {
    if (window.PENECHO_CONFIG?.runtime !== "viewer") void loadCanvasSettings().finally(maybeStartOnboarding);
  });
})();
