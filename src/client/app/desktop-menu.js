// Native menu actions share the Canvas controls, persistence and modal guards.
// The bridge is absent in browsers, CLI-served pages and Cloud.
  const DESKTOP_MENU_BUTTONS = Object.freeze({
    "new-canvas":"#newCanvasBtn", "save-canvas":"#saveCanvasBtn", "export-png":"#exportPngBtn",
    undo:'[data-action="undo"]', redo:'[data-action="redo"]', "canvas-view":"#canvasViewBtn",
    "fit-content":"#canvasFitContents", "zoom-in":"#canvasZoomIn", "zoom-out":"#canvasZoomOut",
    "zoom-reset":"#canvasZoomLevel", "toggle-fullscreen":"#fullscreenBtn",
  });
  const DESKTOP_MENU_SETTINGS = Object.freeze({ shortcuts:"shortcuts" });
  // Settings live on the Projects page: these save the Canvas and go there (projectLinesLeave in project-lines-bridge.js).
  const DESKTOP_MENU_PROJECT_PAGES = Object.freeze({ "new-project":"#new", "open-settings":"#settings", "open-agents":"#agents", "open-mcp":"#agents/apps", "open-archived":"#archived" });
  function desktopMenuProjectsAddress(command) {
    if (DESKTOP_MENU_PROJECT_PAGES[command]) return `/projects.html${DESKTOP_MENU_PROJECT_PAGES[command]}`;
    const project = projectLinesTarget && !projectLinesTarget.draft ? projectLinesTarget.back || projectLinesTarget.project : "";
    return project ? `/projects.html#${encodeURIComponent(project)}` : "/projects.html";
  }

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
    return ["canvas-library", "save-copy", "search-work", "close-canvas"].includes(command);
  }

  function performDesktopMenuCommand(command) {
    if (command === "show-projects" || Object.hasOwn(DESKTOP_MENU_PROJECT_PAGES, command)) {
      if (DESKTOP_MENU_PROJECT_PAGES[command] && command !== "new-project") projectLinesSettingsReturnUrl();
      projectLinesLeave(desktopMenuProjectsAddress(command)).catch(error => setStatus(String(error?.message || error)));
      return true;
    }
    if (!desktopMenuCommandEnabled(command)) return false;
    if ((command === "undo" || command === "redo") && (keyboardShortcutTextEditingTarget(document.activeElement) || document.activeElement?.tagName === "IFRAME")) {
      void window.penechoDesktop.nativeEdit(command);
    } else if (Object.hasOwn(DESKTOP_MENU_SETTINGS, command)) {
      selectSettingsPage(DESKTOP_MENU_SETTINGS[command]);
      openSettings();
    } else if (command === "close-canvas") {
      canvasDocumentsUiAction(() => requestCanvasTransition({ type:"close", documentId:canvasDocumentsCurrent().id }));
    } else if (command === "save-copy") {
      // Use the existing copy form so the user can choose its name and location.
      openHistoryPanel();
      document.querySelector("#historySavePanel").open = true;
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector("#historyName")?.focus()));
    } else if (DESKTOP_MENU_BUTTONS[command]) document.querySelector(DESKTOP_MENU_BUTTONS[command])?.click();
    else keyboardShortcutPerform(command);
    return true;
  }

  function installDesktopMenuBridge() {
    const desktop = window.penechoDesktop;
    if (!desktop?.onMenuCommand || !desktop?.setMenuState) return;
    let pending = false, previous = "";
    function sync() {
      pending = false;
      const commands = [...Object.keys(DESKTOP_MENU_BUTTONS), ...Object.keys(DESKTOP_MENU_SETTINGS), "canvas-library", "save-copy", "search-work", "close-canvas"],
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
    for (const element of document.querySelectorAll([...Object.values(DESKTOP_MENU_BUTTONS), "dialog", "#settingsLayer", "#configurationLayer", "#historyPanel", ".plugin-modal-layer", "body"].join(","))) {
      observer.observe(element, { attributes:true, attributeFilter:["disabled", "hidden", "open", "class", "aria-pressed"] });
    }
    sync();
  }
