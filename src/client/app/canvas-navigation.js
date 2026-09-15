// One owner for canvas navigation and explicit, native Widget interaction.
// Iframes retain their identity. Selecting a Widget never replays the selecting
// click into its document, and inactive front shells block underlying Widgets.

  function widgetInteractionPresentation() {
    try { return localStorage.getItem("penecho.widgetInteractionPresentation") || "maximized"; }
    catch { return "maximized"; }
  }
  function switchWidgetPresentation(widget, maximized) {
    try { localStorage.setItem("penecho.widgetInteractionPresentation", maximized ? "maximized" : "canvas"); } catch {}
    setWidgetMaximized(widget, maximized);
    requestInteractionLayerRender();
  }
  function setWidgetPresentationZoom(widget, percent, notifyHost = true) {
    if (!widget?.shell) return;
    const value = Number(percent),
      zoom = Math.max(50, Math.min(100, Number.isFinite(value) ? value : 100));
    widget.presentationZoom = zoom;
    widget.shell.setAttribute("data-presentation-zoom", String(zoom));
    const controls = widget.presentationZoomControls;
    if (controls) {
      controls.label.textContent = `${zoom}%`;
      controls.zoomOut.disabled = zoom === 50;
      controls.zoomIn.disabled = zoom === 100;
    }
    if (notifyHost) sendWidgetHostState(widget);
  }
  function setWidgetMaximized(widget, maximized) {
    const shell = widget?.shell;
    if (!shell || widget.maximized === maximized) return;
    if (maximized && typeof shell.showPopover !== "function") return;
    widget.maximized = maximized;
    if (maximized) {
      if (!widget.presentationToolbar) {
        const toolbar = document.createElement("div");
        toolbar.className = "widget-presentation-toolbar";
        toolbar.setAttribute("role", "toolbar");
        const title = document.createElement("span");
        title.className = "widget-presentation-title";
        title.textContent = widget.title;
        title.title = widget.title;
        toolbar.append(title);
        const action = (label, icon, activate) => {
          const button = document.createElement("button");
          button.type = "button";
          button.title = label;
          button.setAttribute("aria-label", label);
          button.innerHTML = icon;
          button.addEventListener("click", activate);
          toolbar.append(button);
          return button;
        };
        const zoomOut = action(t("imageZoomOut"), '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>', () => setWidgetPresentationZoom(widget, widget.presentationZoom - 10)),
          label = document.createElement("output");
        label.className = "image-presentation-zoom";
        label.setAttribute("aria-live", "polite");
        toolbar.append(label);
        const zoomIn = action(t("imageZoomIn"), '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>', () => setWidgetPresentationZoom(widget, widget.presentationZoom + 10));
        widget.presentationZoomControls = { zoomOut, zoomIn, label };
        action(t("widgetReturnToCanvas"), '<svg viewBox="0 0 24 24"><path d="M4 9h5V4m11 11h-5v5M9 9 3 3m12 12 6 6"/></svg>', () => switchWidgetPresentation(widget, false));
        action(t("downloadWidget"), OBJECT_CHROME_ICONS.download, async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try { await downloadWidgetImage(widget); }
          finally { button.disabled = false; }
        });
        action(t("widgetExitInteraction"), '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg>', () => setWidgetInteraction(null));
        toolbar.addEventListener("pointerdown", event => event.stopPropagation());
        toolbar.addEventListener("dblclick", (event) => {
          if (!widget.maximized || event.target.closest("button")) return;
          event.preventDefault();
          event.stopPropagation();
          setWidgetInteraction(null);
        });
        shell.prepend(toolbar);
        widget.presentationToolbar = toolbar;
      }
      setWidgetPresentationZoom(widget, 100, false);
      shell.setAttribute("popover", "manual");
      shell.classList.add("widget-maximized");
      shell.showPopover();
    } else {
      if (shell.matches(":popover-open")) shell.hidePopover();
      shell.removeAttribute("popover");
      shell.classList.remove("widget-maximized");
      shell.removeAttribute("data-presentation-zoom");
      widget.presentationZoom = 100;
      widget.presentationWidth = widget.presentationHeight = null;
      widget.styleRule?.style?.removeProperty("--widget-presentation-width");
      widget.styleRule?.style?.removeProperty("--widget-presentation-height");
    }
    positionWidget(widget);
    widget.frame?.focus({ preventScroll:true });
  }

  function showImagePresentation(item) {
    if (!item || !state.images.includes(item) || !(item.blob instanceof Blob)) return false;
    const previous = document.querySelector(".canvas-image-presentation");
    if (previous) previous.close();
    const dialog = document.createElement("dialog"),
      toolbar = document.createElement("div"),
      title = document.createElement("span"),
      close = document.createElement("button"),
      zoomOut = document.createElement("button"),
      zoomIn = document.createElement("button"),
      zoomLabel = document.createElement("output"),
      image = document.createElement("img"),
      sourceUrl = URL.createObjectURL(item.blob);
    dialog.className = "canvas-image-presentation widget-maximized";
    dialog.setAttribute("aria-label", item.sourceName || t("widgetMaximize"));
    toolbar.className = "widget-presentation-toolbar";
    toolbar.setAttribute("role", "toolbar");
    title.className = "widget-presentation-title";
    title.textContent = item.sourceName || "";
    title.title = item.sourceName || "";
    close.type = "button";
    close.title = t("widgetReturnToCanvas");
    close.setAttribute("aria-label", close.title);
    close.innerHTML = '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg>';
    close.addEventListener("click", () => dialog.close());
    let zoomPercent = 100;
    const updateZoom = (change = 0) => {
      zoomPercent = Math.max(50, Math.min(100, zoomPercent + change));
      image.setAttribute("data-zoom", String(zoomPercent));
      zoomLabel.textContent = `${zoomPercent}%`;
      zoomOut.disabled = zoomPercent === 50;
      zoomIn.disabled = zoomPercent === 100;
    };
    zoomOut.type = zoomIn.type = "button";
    zoomOut.title = t("imageZoomOut");
    zoomIn.title = t("imageZoomIn");
    zoomOut.setAttribute("aria-label", zoomOut.title);
    zoomIn.setAttribute("aria-label", zoomIn.title);
    zoomOut.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
    zoomIn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>';
    zoomOut.addEventListener("click", () => updateZoom(-10));
    zoomIn.addEventListener("click", () => updateZoom(10));
    zoomLabel.className = "image-presentation-zoom";
    zoomLabel.setAttribute("aria-live", "polite");
    updateZoom();
    image.alt = item.sourceName || "";
    image.src = sourceUrl;
    image.draggable = false;
    image.addEventListener("dblclick", () => dialog.close());
    dialog.addEventListener("close", () => {
      URL.revokeObjectURL(sourceUrl);
      dialog.remove();
    }, { once:true });
    toolbar.append(title, zoomOut, zoomLabel, zoomIn, close);
    dialog.append(toolbar, image);
    document.body.append(dialog);
    dialog.showModal();
    return true;
  }

  function canvasNavigationTextTarget(target) {
    return keyboardShortcutTextEditingTarget(target);
  }
  function canvasWidgetSelectionEnabled() {
    return !state.spacePan && (state.viewMode ? state.viewTool === "select" : state.mode === "select");
  }
  function canvasWidgetInteractive(widget) {
    return canvasWidgetSelectionEnabled() && state.interactingWidgetId === widget.id && !widget.hiddenForReplacement;
  }
  function canvasWidgetAtEvent(event) {
    const shell = event.target?.closest?.('.canvas-widget');
    const widget = shell ? visibleWidgets().find(widget => widget.id === shell.dataset.widgetId) : null;
    if (widget?.maximized) return widget;
    const target = handObjectToolbarTargetAtPoint(clientPoint(event));
    // The painted image layer has pointer-events:none, so a DOM shell hit can
    // belong to a Widget covered by the front image.
    if (target?.kind === "image") return null;
    if (shell) return widget || null;
    return target?.kind === "widget" ? target.object : null;
  }
  function syncCanvasNavigation() {
    view.classList.toggle("select-mode", !state.viewMode && state.mode === "select");
    view.classList.toggle("widget-selection-enabled", canvasWidgetSelectionEnabled());
    view.classList.toggle("temporary-hand", state.spacePan);
    view.classList.toggle("widget-interacting", Boolean(state.interactingWidgetId));
    document.querySelector('#canvasViewHand')?.setAttribute('aria-pressed', String(state.viewTool === 'hand'));
    document.querySelector('#canvasViewSelect')?.setAttribute('aria-pressed', String(state.viewTool === 'select'));
    const exit = document.querySelector('#canvasWidgetExit');
    if (exit) exit.hidden = !state.interactingWidgetId;
    syncWidgetHostStates();
    resetCanvasCursor();
  }
  function setWidgetInteraction(widget, options = {}) {
    if (widget && (!canvasWidgetSelectionEnabled() || !visibleWidgets().includes(widget))) return false;
    const next = widget?.id || null;
    if (state.interactingWidgetId === next) return true;
    const previous = state.widgets.find(item => item.id === state.interactingWidgetId);
    if (previous?.frame && document.activeElement === previous.frame) document.activeElement.blur();
    if (previous) setWidgetMaximized(previous, false);
    state.interactingWidgetId = next;
    if (!next) {
      const returnTool = state.widgetInteractionReturnTool;
      state.widgetInteractionReturnTool = null;
      if (options.restoreTool !== false && returnTool && returnTool.viewMode === state.viewMode) {
        if (state.viewMode) setCanvasViewTool(returnTool.mode);
        else setCanvasMode(returnTool.mode);
      }
    }
    syncCanvasNavigation();
    if (widget?.frame) widget.frame.focus({ preventScroll:true });
    requestInteractionLayerRender();
    return true;
  }
  // One entry point for every explicit activation gesture (toolbar, double-click,
  // context menu): it selects the tool that can own Widget interaction first.
  function enterWidgetInteraction(widget) {
    if (!widget || widget.pending || !visibleWidgets().includes(widget)) return false;
    const returnTool = state.widgetInteractionReturnTool || {
      viewMode:state.viewMode,
      mode:state.viewMode ? "hand" : state.mode === "select" ? state.widgetReturnMode || "pen" : state.mode,
    };
    if (state.viewMode) {
      if (state.viewTool !== "select") setCanvasViewTool("select");
    } else if (state.mode !== "select") {
      setCanvasMode("select");
    }
    state.widgetInteractionReturnTool = returnTool;
    const entered = setWidgetInteraction(widget);
    if (entered) setWidgetMaximized(widget, widgetInteractionPresentation() === "maximized");
    return entered;
  }
  function canvasWidgetInteractionChromeTarget(target) {
    return Boolean(target?.closest?.("#canvasViewActions, #canvasNavigationActions, .canvas-fit-contents, .canvas-navigation-lock, .object-chrome-button, .widget-interaction-status, .widget-presentation-toolbar"));
  }
  function showWidgetContextToolbar(event) {
    event.preventDefault();
    if (state.viewMode || state.spacePan || state.interactingWidgetId) return false;
    if (!["pen", "hand", "select"].includes(state.mode)) return false;
    if (canvasWidgetInteractionChromeTarget(event.target)) return false;
    const widget = canvasWidgetAtEvent(event);
    if (!widget || widget.pending || !state.widgets.includes(widget)) return false;
    return showHandObjectToolbar("widget", widget);
  }
  function setCanvasViewTool(tool) {
    if (!state.viewMode || !['hand', 'select'].includes(tool)) return;
    setWidgetInteraction(null, { restoreTool:false });
    state.widgetActivationTap = null;
    state.viewTool = tool;
    syncCanvasNavigation();
  }
  function setSpacePan(enabled) {
    enabled = Boolean(enabled);
    if (state.spacePan === enabled) return;
    if (enabled && state.drawing?.pointerType === "pen") finishDrawing("pen");
    state.spacePan = enabled;
    syncCanvasNavigation();
  }
  function beginCanvasObjectSelection(event, point) {
    if (!point || !valid(point) || event.button !== 0) return false;
    // Existing ink lasso takes priority when a lasso is already active.
    if (state.selection) return false;
    if (state.pending) {
      const result = pendingHit(state.pending, event, state.pending.revealProgress < 1);
      const hit = typeof result === 'string' ? result : result?.hit;
      if (hit) { beginPendingGesture(event, hit, result?.itemIndex ?? null); return true; }
    }
    const widget = canvasWidgetAtEvent(event);
    const target = handObjectToolbarTargetAtPoint(point) || (widget ? { kind:'widget', object:widget } : null);
    if (state.pendingWidget && !target) {
      const result = widgetPointerHit(point, event.pointerType, true);
      if (result?.pending) return beginWidgetGesture(event, point, result);
    }
    if (!target) {
      hideHandObjectToolbar({ all:true });
      if (state.widgetEdit) acceptWidgetEdit();
      if (state.imageEdit) acceptImageEdit();
      return false;
    }
    if (target.kind === 'text-box') return editTextBox(target.object);
    showHandObjectToolbar(target.kind, target.object);
    if (target.kind === 'widget') {
      const hit = state.selectedWidgetId === target.object.id ? widgetResizeHit(widgetBox(target.object), point, event.pointerType) : null;
      return beginWidgetGesture(event, point, { widget:target.object, hit:hit || 'move', pending:false });
    }
    if (target.kind === 'image') {
      const result = imagePointerHit(point, event.pointerType, true);
      return beginImageGesture(event, point, result || { image:target.object, hit:'move' });
    }
    if (target.kind === 'animation') return beginAnimationGesture(event, point, animationPointerHit(point, event.pointerType) || { animation:target.object, hit:'move' });
    return false;
  }
  function canvasNavigationSurface(target) {
    if (!target || target === view || target === screen) return true;
    const shell = target.closest?.('.canvas-widget');
    return Boolean(shell && shell.dataset.widgetId !== state.interactingWidgetId);
  }
  function handleCanvasWheel(event) {
    if (!canvasNavigationSurface(event.target)) return;
    event.preventDefault();
    if (state.navigationLocked || state.drawing || state.widgetGesture || state.imageGesture || state.selectionGesture || state.trackpadGesture) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvasViewportMetrics().height : 1;
    let dx = event.deltaX * unit, dy = event.deltaY * unit;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !dx && !dy) return;
    if (event.ctrlKey || event.metaKey || state.wheelZoom) zoomCanvasAt(event.clientX, event.clientY, dy);
    else {
      if (event.shiftKey && !dx) { dx = dy; dy = 0; }
      moveCanvas(-dx, -dy);
      requestCoordinatesUpdate();
      wheelNavigating();
    }
  }
  function beginCanvasTrackpadGesture(event) {
    if (!canvasNavigationSurface(event.target)) return;
    event.preventDefault();
    if (state.navigationLocked || state.drawing) return;
    state.trackpadGesture = { scale:Number(event.scale) || 1 };
  }
  function updateCanvasTrackpadGesture(event) {
    const gesture = state.trackpadGesture;
    if (!gesture) return;
    event.preventDefault();
    const scale = Number(event.scale);
    if (!Number.isFinite(scale) || scale <= 0) return;
    zoomCanvasAt(event.clientX, event.clientY, -Math.log(scale / gesture.scale) / .002);
    gesture.scale = scale;
  }
  function endCanvasTrackpadGesture(event) {
    if (!state.trackpadGesture) return;
    event.preventDefault();
    state.trackpadGesture = null;
    void window.PenEchoStudioNavigator?.flushMcpFollow?.();
  }
  function canvasFitViewportSize() {
    const metrics = canvasViewportMetrics();
    let width = metrics.width, height = metrics.height;
    const panel = document.querySelector('#canvasAgentPanel');
    if (panel && !panel.hidden && document.body.classList.contains('canvas-agent-open')
      && !document.body.classList.contains('canvas-agent-navigation-hidden')) {
      const rect = canvasElementLayoutRect(panel);
      if (rect && rect.width > 0 && rect.height > 0 && rect.right > 0
        && rect.left < width && rect.bottom > 0 && rect.top < height) {
        // Only the Agent panel occludes Fit All; the left navigator is ignored.
        if (rect.left > 0) width = Math.min(width, rect.left);
        else if (rect.top > 0) height = Math.min(height, rect.top);
      }
    }
    return { width, height };
  }
  function fitCanvasContents() {
    if (state.drawing) return;
    setWidgetInteraction(null);
    if (state.navigationLocked) setCanvasNavigationLocked(false);
    let bounds = visibleInkBounds({ x:0, y:0, w:SIZE, h:SIZE });
    for (const next of [imageBounds(), textBoxBounds(), animationBounds(), widgetBounds()]) bounds = unionLocalBounds(bounds, next);
    if (!bounds) bounds = { x:SIZE / 2 - 1500, y:SIZE / 2 - 1000, w:3000, h:2000 };
    const metrics = canvasFitViewportSize(), padding = 64;
    const previousPanX = state.panX, previousPanY = state.panY, previousScale = state.scale;
    state.scale = Math.max(.03, Math.min(2, (metrics.width - padding * 2) / Math.max(1,bounds.w), (metrics.height - padding * 2) / Math.max(1,bounds.h)));
    state.panX = (metrics.width - bounds.w * state.scale) / 2 - bounds.x * state.scale;
    state.panY = (metrics.height - bounds.h * state.scale) / 2 - bounds.y * state.scale;
    requestCanvasNavigationPreview(previousPanX, previousPanY, previousScale);
    requestCoordinatesUpdate();
  }
  document.querySelector('#canvasViewHand')?.addEventListener('click', () => setCanvasViewTool('hand'));
  document.querySelector('#canvasViewSelect')?.addEventListener('click', () => setCanvasViewTool('select'));
  document.querySelector('#canvasWidgetExit')?.addEventListener('click', () => {
    setWidgetInteraction(null);
    (state.viewMode ? document.querySelector('#canvasViewSelect') : document.querySelector('#lassoToolBtn'))?.focus({ preventScroll:true });
  });
  view.addEventListener('dblclick', (event) => {
    if (state.spacePan || state.interactingWidgetId) return;
    const tool = state.viewMode ? state.viewTool : state.mode;
    if (tool !== 'hand' && tool !== 'select') return;
    if (canvasWidgetInteractionChromeTarget(event.target)) return;
    // Canvas resize zones extend beyond the DOM handles. Use the same hit
    // test as the resize cursor and drag gesture before body activation.
    const point = clientPoint(event);
    const resize = !state.viewMode && widgetPointerHit(point, event.pointerType || 'mouse', false);
    if (resize && ['width', 'height', 'resize'].includes(resize.hit)) {
      event.preventDefault();
      event.stopPropagation();
      requestWidgetContentFit(resize.widget, resize.hit);
      return;
    }
    const target = handObjectToolbarTargetAtPoint(point);
    if (target?.kind === "image") {
      event.preventDefault();
      showImagePresentation(target.object);
    } else if (target?.kind === "widget") enterWidgetInteraction(target.object);
  });
  view.addEventListener('contextmenu', (event) => { showWidgetContextToolbar(event); });
  document.querySelector('#canvasFitContents')?.addEventListener('click', fitCanvasContents);
  const wheelZoomSetting = document.querySelector('#settingsWheelZoom');
  if (wheelZoomSetting) {
    wheelZoomSetting.setAttribute('aria-checked', String(state.wheelZoom));
    wheelZoomSetting.classList.toggle('on', state.wheelZoom);
    wheelZoomSetting.addEventListener('click', () => {
      state.wheelZoom = !state.wheelZoom;
      wheelZoomSetting.setAttribute('aria-checked', String(state.wheelZoom));
      wheelZoomSetting.classList.toggle('on', state.wheelZoom);
      localStorage.setItem('penecho-wheel-zoom', String(state.wheelZoom));
    });
  }
  window.addEventListener('keydown', (event) => {
    if (state.interactingWidgetId && event.key !== 'Escape') return;
    if (event.defaultPrevented || event.isComposing || canvasNavigationTextTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 'Escape' && !keyboardShortcutCanvasContext(event, keyboardShortcutChordFromEvent(event))) return;
    if (keyboardShortcutBlockingSurfaceOpen()) return;
    if (event.code === 'Space' && !event.target?.closest?.('button') && !state.drawing) {
      event.preventDefault();
      setSpacePan(true);
    } else if (event.key === 'Escape' && state.interactingWidgetId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setWidgetInteraction(null);
    } else if (!event.repeat && !state.drawing && !state.widgetGesture && !state.selectionGesture && ['h','v','p'].includes(event.key.toLowerCase())) {
      if (state.viewMode && event.key.toLowerCase() === 'p') return;
      event.preventDefault();
      if (state.viewMode) setCanvasViewTool(event.key.toLowerCase() === 'h' ? 'hand' : 'select');
      else selectCanvasToolMode({ h:'hand', v:'select', p:'pen' }[event.key.toLowerCase()], { showHint:true });
    }
  }, true);
  window.addEventListener('keyup', (event) => { if (event.code === 'Space') setSpacePan(false); }, true);
  window.addEventListener('blur', () => { setSpacePan(false); state.trackpadGesture = null; state.widgetActivationTap = null; });
