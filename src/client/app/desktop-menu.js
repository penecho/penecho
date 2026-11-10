// Native menu actions share the Canvas controls, persistence and modal guards.
// The bridge is absent in browsers, CLI-served pages and Cloud.
  const DESKTOP_MENU_BUTTONS = Object.freeze({
    "new-canvas":"#newCanvasBtn", "save-canvas":"#saveCanvasBtn", "export-png":"#exportPngBtn",
    undo:'[data-action="undo"]', redo:'[data-action="redo"]', "canvas-view":"#canvasViewBtn",
    "fit-content":"#canvasFitContents", "zoom-in":"#canvasZoomIn", "zoom-out":"#canvasZoomOut",
    "zoom-reset":"#canvasZoomLevel", "toggle-fullscreen":"#fullscreenBtn", "mcp-status":"#mcpToolbarToggle",
  });
  const DESKTOP_MENU_SETTINGS = Object.freeze({ "open-settings":null, connections:"connections", "ai-settings":"canvas", shortcuts:"shortcuts", "mcp-local":"mcp", "mcp-cloud":"mcp" });

  function desktopMenuCommandEnabled(command) {
    const dialogOpen = Boolean(document.querySelector("dialog[open]")), editing = keyboardShortcutTextEditingTarget(document.activeElement) || document.activeElement?.tagName === "IFRAME";
    if (command === "undo" || command === "redo") return editing || (!keyboardShortcutBlockingSurfaceOpen() && !state.interactingWidgetId);
    if (Object.hasOwn(DESKTOP_MENU_SETTINGS, command)) return !dialogOpen && !settings.configurationMode;
    if (command === "canvas-library" && document.querySelector("#historyPanel")?.classList.contains("open")) return !dialogOpen;
    if (keyboardShortcutBlockingSurfaceOpen() || state.interactingWidgetId) return false;
    if (command === "save-copy" || command === "save-canvas" || command === "new-canvas" || command === "close-canvas") {
      if (snapshotSaveInProgress || snapshotLoadInProgress) return false;
    }
    const selector = DESKTOP_MENU_BUTTONS[command], button = selector && document.querySelector(selector);
    if (selector) return Boolean(button && !button.disabled);
    if (command === "focus-agent" || command === "agent-history") return canvasAgentAvailable();
    return ["canvas-library", "save-copy", "search-work", "tour", "close-canvas"].includes(command);
  }

  function performDesktopMenuCommand(command) {
    if (!desktopMenuCommandEnabled(command)) return false;
    if ((command === "undo" || command === "redo") && (keyboardShortcutTextEditingTarget(document.activeElement) || document.activeElement?.tagName === "IFRAME")) {
      void window.penechoDesktop.nativeEdit(command);
    } else if (Object.hasOwn(DESKTOP_MENU_SETTINGS, command)) {
      const page = DESKTOP_MENU_SETTINGS[command];
      if (page) selectSettingsPage(page);
      openSettings();
      if (command.startsWith("mcp-")) window.PenEchoMcpSettings?.select(command === "mcp-local" ? "local" : "cloud");
    } else if (command === "agent-history") {
      window.PenEchoStudioNavigator?.open?.("agent");
    } else if (command === "mcp-status") {
      void mcpOpenStatus(null, { connect:false });
    } else if (command === "close-canvas") {
      canvasDocumentsUiAction(() => requestCanvasTransition({ type:"close", documentId:canvasDocumentsCurrent().id }));
    } else if (command === "save-copy") {
      // Use the existing copy form so the user can choose its name and location.
      openHistoryPanel();
      document.querySelector("#historySavePanel").open = true;
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector("#historyName")?.focus()));
    } else if (command === "tour") replayFeatureTour();
    else if (DESKTOP_MENU_BUTTONS[command]) document.querySelector(DESKTOP_MENU_BUTTONS[command])?.click();
    else keyboardShortcutPerform(command);
    return true;
  }

  function installDesktopMenuBridge() {
    const desktop = window.penechoDesktop;
    if (!desktop?.onMenuCommand || !desktop?.setMenuState) return;
    let pending = false, previous = "";
    function sync() {
      pending = false;
      const commands = [...Object.keys(DESKTOP_MENU_BUTTONS), ...Object.keys(DESKTOP_MENU_SETTINGS), "canvas-library", "save-copy", "search-work", "focus-agent", "agent-history", "tour", "close-canvas"],
        value = { enabled:Object.fromEntries(commands.map(command => [command, desktopMenuCommandEnabled(command)])), bindings:{ ...keyboardShortcutBindings }, recording:Boolean(keyboardShortcutRecordingId), canvasView:document.querySelector("#canvasViewBtn")?.getAttribute("aria-pressed") === "true" },
        serialized = JSON.stringify(value);
      if (serialized !== previous) { previous = serialized; desktop.setMenuState(value); }
    }
    function schedule() { if (!pending) { pending = true; requestAnimationFrame(sync); } }
    desktop.onMenuCommand(command => { performDesktopMenuCommand(command); schedule(); });
    window.addEventListener("penecho:shortcutschange", schedule);
    window.addEventListener("focusin", schedule);
    window.addEventListener("focusout", schedule);
    // Observe control state only; drawing and live Widget mutations do not poll menus.
    const observer = new MutationObserver(schedule);
    for (const element of document.querySelectorAll([...Object.values(DESKTOP_MENU_BUTTONS), "dialog", "#settingsLayer", "#configurationLayer", "#historyPanel", ".tour-layer", ".changelog-layer", ".plugin-modal-layer", "body"].join(","))) {
      observer.observe(element, { attributes:true, attributeFilter:["disabled", "hidden", "open", "class", "aria-pressed"] });
    }
    sync();
  }
