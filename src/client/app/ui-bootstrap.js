// Pointer and control bindings, portable snapshots, and application startup.
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
    state.latestTypedInput = null;
    const erasing = state.mode === "eraser";
    if (erasing) invalidateRecognition();
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
    };
    dot(p, erasing, size, !erasing);
    requestRender();
  }
  screen.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (Date.now() < state.textInputBlockedUntil) return;
    try {
      screen.setPointerCapture(e.pointerId);
    } catch {}
    calibrateScreenClientRatio(e, false);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch") {
      state.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.touches.size >= 2) {
        cancelAnimationTouchHold();
        cancelImageTouchHold();
        state.textTap = null;
        if (state.pendingGesture) state.pendingGesture = null;
        if (state.widgetGesture) finishWidgetGesture({ pointerId:state.widgetGesture.id });
        if (state.selectedWidgetId) acceptWidgetEdit();
        if (state.imageGesture) finishImageGesture({ pointerId:state.imageGesture.id });
        if (state.selectedImageId) acceptImageEdit();
        if (state.animationGesture) finishAnimationGesture({ pointerId: state.animationGesture.id });
        if (state.selectedAnimationId) acceptAnimationEdit();
        finishDrawing("pen");
        beginTouchGesture();
        return;
      }
    }
    if (isMousePan(e)) {
      if (state.selectedImageId) acceptImageEdit();
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
    if (state.pending) {
      const result = pendingHit(state.pending, e, state.pending.revealProgress < 1),
        hit = typeof result === "string" ? result : result?.hit,
        itemIndex = result && typeof result === "object" ? result.itemIndex : null;
      if (hit) {
        if (hit === "copy" || hit === "item-copy") {
          armPendingCopy(e, hit, itemIndex);
          return;
        }
        if (hit === "accept") return acceptPending();
        if (hit === "cancel") return rejectPending();
        if (hit === "item-accept") return acceptPendingItem(itemIndex);
        if (hit === "item-cancel") return rejectPendingItem(itemIndex);
        beginPendingGesture(e, hit, itemIndex);
        return;
      }
    }
    const point = clientPoint(e);
    const handMode = state.mode === "hand",
      widgetResult = widgetRuntimeEnabled() && valid(point) ? widgetPointerHit(point, e.pointerType, handMode) : null;
    if (widgetResult) {
      beginWidgetGesture(e, point, widgetResult);
      return;
    }
    if (state.selectedWidgetId) acceptWidgetEdit();
    const selectedImageResult = valid(point) ? imagePointerHit(point, e.pointerType, handMode) : null;
    if (selectedImageResult) {
      if (state.selectedAnimationId) acceptAnimationEdit();
      if (!handMode && e.pointerType === "touch" && selectedImageResult.hit === "move") {
        beginImageTouchHold(e, point, selectedImageResult.image);
        return;
      }
      beginImageGesture(e, point, selectedImageResult);
      return;
    }
    if (state.selectedImageId) acceptImageEdit();
    if (handMode && valid(point)) {
      const animationResult = animationPointerHit(point, e.pointerType);
      if (animationResult) {
        beginAnimationGesture(e, point, animationResult);
        return;
      }
    }
    if (e.pointerType === "touch" && valid(point)) {
      const animationResult = animationPointerHit(point, e.pointerType);
      if (animationResult) {
        beginAnimationTouchHold(e, point, animationResult);
        return;
      }
    }
    if (isAnimationActivationPointer(e) && valid(point)) {
      const animationResult = animationPointerHit(point, e.pointerType);
      if (animationResult) {
        beginAnimationGesture(e, point, animationResult);
        return;
      }
    }
    if (e.pointerType === "touch" && valid(point)) {
      const item = imageAtPoint(point);
      if (item) {
        if (state.selectedAnimationId) acceptAnimationEdit();
        beginImageTouchHold(e, point, item);
        return;
      }
    }
    if (isAnimationActivationPointer(e) && valid(point)) {
      const item = imageAtPoint(point);
      if (item) {
        if (state.selectedAnimationId) acceptAnimationEdit();
        beginImageTouchHold(e, point, item);
        return;
      }
    }
    beginCanvasPointerAction(e, point);
  });
  screen.addEventListener("pointermove", (e) => {
    e.preventDefault();
    const old = state.pointers.get(e.pointerId);
    calibrateScreenClientRatio(e, true);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch") state.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    if (state.imageTouchHold?.id === e.pointerId) {
      const hold = state.imageTouchHold,
        distance = Math.hypot(e.clientX - hold.startX, e.clientY - hold.startY);
      if (distance <= IMAGE_TOUCH_HOLD_MOVE_PX) return;
      cancelImageTouchHold(e.pointerId);
      if (hold.pointerType === "touch") {
        state.panGesture = { id:e.pointerId, last:old || { x:hold.startX, y:hold.startY } };
        setNavigating(true);
      } else beginCanvasPointerAction(hold.downEvent, hold.point);
    }
    if (state.animationTouchHold?.id === e.pointerId) {
      const hold = state.animationTouchHold,
        distance = Math.hypot(e.clientX - hold.startX, e.clientY - hold.startY);
      if (distance <= ANIMATION_TOUCH_HOLD_MOVE_PX) return;
      cancelAnimationTouchHold(e.pointerId);
      state.panGesture = { id: e.pointerId, last: old || { x: hold.startX, y: hold.startY } };
      setNavigating(true);
    }
    if (e.pointerType === "touch") {
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
    stroke(a, p, d.erase, size, !d.erase);
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
    if (e.pointerType === "touch") state.touches.delete(e.pointerId);
    cancelAnimationTouchHold(e.pointerId);
    const imageTapHold = state.imageTouchHold?.id === e.pointerId ? state.imageTouchHold : null;
    cancelImageTouchHold(e.pointerId);
    if (imageTapHold && imageTapHold.pointerType !== "touch" && e.type !== "pointercancel") beginCanvasPointerAction(imageTapHold.downEvent, imageTapHold.point);
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
    if (state.drawing?.id === e.pointerId) finishDrawing(e.pointerType);
  }
  screen.addEventListener("pointerup", end);
  screen.addEventListener("pointercancel", end);
  screen.addEventListener("contextmenu", (e) => e.preventDefault());
  view.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = view.getBoundingClientRect(),
        factor = e.deltaY < 0 ? 1.12 : 0.89,
        n = Math.max(0.03, Math.min(2, state.scale * factor)),
        px = e.clientX - r.left,
        py = e.clientY - r.top;
      state.panX = px - ((px - state.panX) * n) / state.scale;
      state.panY = py - ((py - state.panY) * n) / state.scale;
      state.scale = n;
      updateCoordinates();
      requestRender();
      wheelNavigating();
    },
    { passive: false },
  );
  function setCanvasMode(mode) {
    const button = document.querySelector(`[data-mode="${mode}"]`);
    if (!button) return;
    if (state.mode === "select" && mode !== "select" && state.selection) {
      if (selectionAIBusy(state.selection)) {
        setStatusKey(selectionAIStatusKey(state.selection));
        return;
      }
      commitSelection();
    }
    if (state.mode === "hand" && mode !== "hand") {
      if (state.widgetEdit) acceptWidgetEdit();
      if (state.imageEdit) acceptImageEdit();
      if (state.animationEdit) acceptAnimationEdit();
    }
    state.mode = mode;
    if (mode !== "select") deselectAnimation();
    view.classList.toggle("hand-mode", mode === "hand");
    document.querySelectorAll("[data-mode]").forEach((item) => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    resetCanvasCursor();
    requestInteractionLayerRender();
    if (mode === "hand") setNavigating(true);
  }
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.onclick = () => setCanvasMode(button.dataset.mode);
  });
  [selectionTypesetButton, selectionDeleteButton, selectionCancelButton].filter(Boolean).forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => event.stopPropagation());
  });
  imagePlaceButton.onclick = () => acceptImageEdit();
  imageMergeButton.onclick = () => {
    const item = selectedImage();
    if (item) mergeImage(item);
  };
  imageDeleteButton.onclick = () => {
    const item = selectedImage();
    if (item) deleteImage(item);
  };
  for (const button of [imagePlaceButton, imageMergeButton, imageDeleteButton]) {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => event.stopPropagation());
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
  if (selectionTypesetButton) selectionTypesetButton.onclick = normalizeSelectionForAI;
  if (selectionDeleteButton) selectionDeleteButton.onclick = deleteSelection;
  if (selectionCancelButton) selectionCancelButton.onclick = () => cancelSelection();
  [animationPlayPause, animationRestart, animationDelete].forEach((button) => button.addEventListener("pointerdown", (event) => event.stopPropagation()));
  animationPlayPause.onclick = toggleSelectedAnimationPlayback;
  animationRestart.onclick = restartSelectedAnimation;
  animationDelete.onclick = deleteSelectedAnimation;
  animationControls.addEventListener("click", (event) => event.stopPropagation());
  animationControls.addEventListener("pointerdown", (event) => event.stopPropagation());

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
    const deleteButton = event.target.closest("button[data-plugin-delete]");
    if (!deleteButton) return;
    event.preventDefault();
    event.stopPropagation();
    void deleteLocalPlugin(deleteButton.dataset.pluginDelete);
  });
  pluginOptions.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-plugin-id]");
    if (!input) return;
    setPluginEnabled(input.dataset.pluginId, input.checked);
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
  document.querySelector("#newCanvasClose").onclick = () => document.querySelector("#newCanvasDialog").close("cancel");
  document.querySelector("#newCanvasCancel").onclick = () => document.querySelector("#newCanvasDialog").close("cancel");
  document.querySelector("#textHelpClose").onclick = closeTextHelp;
  document.querySelector("#textHelpDone").onclick = closeTextHelp;
  document.querySelector("#textHelpDialog").addEventListener("close", restoreTextEditorAfterHelp);
  document.querySelector("#newDiscard").onclick = startBlankCanvas;
  document.querySelector("#newSaveCopy").onclick = () => completeNewCanvas("new");
  document.querySelector("#newOverwrite").onclick = () => completeNewCanvas("overwrite");
  document.querySelector("#newCanvasDialog").addEventListener("cancel", (event) => {
    if (event.currentTarget.dataset.busy === "true") event.preventDefault();
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
        if ((state.pending || state.pendingWidget) && a !== "clear") {
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
            state.animations = [];
            state.selectedAnimationId = null;
            state.animationGesture = null;
            state.animationEdit = null;
            hideAnimationControls();
            requestAnimationLayerRender();
            restoreWidgets([]);
            restoreImages([]);
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
  tourReplayButton.addEventListener("click", replayFeatureTour);
  tourBackButton.addEventListener("click", previousFeatureTourStep);
  tourNextButton.addEventListener("click", nextFeatureTourStep);
  tourSkipButton.addEventListener("click", skipFeatureTour);
  changelogCloseButton.addEventListener("click", closeChangelog);
  changelogDoneButton.addEventListener("click", closeChangelog);
  changelogLayer.addEventListener("pointerdown", (event) => {
    if (event.target === changelogLayer) closeChangelog();
  });
  changelogLayer.addEventListener("keydown", handleChangelogKeydown);
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
  applyTheme(state.theme);
  loadPluginDocuments().catch(() => {});
  refreshSnapshots().catch(() => {});
  fit();
  setNavigating(true);
  requestAnimationFrame(() => requestAnimationFrame(maybeStartOnboarding));
})();
