  const KEYBOARD_SHORTCUT_STORAGE_KEY = "penecho-keyboard-shortcuts-v1";
  const KEYBOARD_SHORTCUT_COMMANDS = Object.freeze([
    { id:"pen-tool", group:"essential", labelKey:"pen", descriptionKey:"shortcutPenHelp", defaultChord:"p" },
    { id:"search-work", group:"essential", labelKey:"shortcutSearchWork", descriptionKey:"shortcutSearchWorkHelp", defaultChord:"Mod+k" },
    { id:"focus-agent", group:"essential", labelKey:"shortcutFocusAgent", descriptionKey:"shortcutFocusAgentHelp", defaultChord:"Tab" },
    { id:"save-canvas", group:"essential", labelKey:"saveCanvas", descriptionKey:"shortcutSaveCanvasHelp", defaultChord:"Mod+s" },
    { id:"undo", group:"essential", labelKey:"undo", descriptionKey:"shortcutUndoHelp", defaultChord:"Mod+z" },
    { id:"redo", group:"essential", labelKey:"redo", descriptionKey:"shortcutRedoHelp", defaultChord:"Mod+Shift+z" },
    { id:"canvas-library", group:"workspace", labelKey:"shortcutCanvasLibrary", descriptionKey:"shortcutCanvasLibraryHelp", defaultChord:"Mod+o" },
    { id:"toggle-fullscreen", group:"workspace", labelKey:"fullscreen", descriptionKey:"shortcutFullscreenHelp", defaultChord:"Mod+Shift+f" },
    { id:"open-settings", group:"workspace", labelKey:"settingsTitle", descriptionKey:"shortcutSettingsHelp", defaultChord:"Mod+," },
  ]);
  const KEYBOARD_SHORTCUT_GROUPS = Object.freeze([
    { id:"essential", labelKey:"settingsShortcutGroupEssential" },
    { id:"workspace", labelKey:"settingsShortcutGroupWorkspace" },
  ]);
  const KEYBOARD_SHORTCUT_SPECIAL_KEYS = new Map([
    [" ", "Space"], ["Spacebar", "Space"], ["Esc", "Escape"], ["Left", "ArrowLeft"],
    ["Right", "ArrowRight"], ["Up", "ArrowUp"], ["Down", "ArrowDown"],
  ]);
  const KEYBOARD_SHORTCUT_RESERVED = new Set(["Mod+q", "Mod+w", "Mod+r", "Mod+t", "Mod+l"]);
  let keyboardShortcutBindings = keyboardShortcutLoadBindings(),
    keyboardShortcutRecordingId = "",
    keyboardShortcutStatus = null;

  function keyboardShortcutCommand(commandId) {
    return KEYBOARD_SHORTCUT_COMMANDS.find((command) => command.id === commandId) || null;
  }
  function keyboardShortcutDefaults() {
    return Object.fromEntries(KEYBOARD_SHORTCUT_COMMANDS.map((command) => [command.id, command.defaultChord]));
  }
  function keyboardShortcutLoadBindings() {
    const bindings = keyboardShortcutDefaults();
    try {
      const saved = JSON.parse(localStorage.getItem(KEYBOARD_SHORTCUT_STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return bindings;
      // Migrate the previous default while retaining explicitly customized bindings.
      if (!("search-work" in saved) && saved["focus-agent"] === "Mod+k") saved["focus-agent"] = "Tab";
      if (!("search-work" in saved) && Object.values(saved).includes("Mod+k")) bindings["search-work"] = "";
      for (const command of KEYBOARD_SHORTCUT_COMMANDS) {
        if (Object.prototype.hasOwnProperty.call(saved, command.id) && typeof saved[command.id] === "string") bindings[command.id] = saved[command.id];
      }
    } catch {}
    return bindings;
  }
  function keyboardShortcutPersistBindings() {
    try { localStorage.setItem(KEYBOARD_SHORTCUT_STORAGE_KEY, JSON.stringify(keyboardShortcutBindings)); }
    catch {}
  }
  function keyboardShortcutKey(event) {
    const raw = KEYBOARD_SHORTCUT_SPECIAL_KEYS.get(event.key) || event.key;
    if (!raw || ["Control", "Meta", "Alt", "Shift", "AltGraph", "OS"].includes(raw)) return "";
    if (raw.length === 1) return raw.toLocaleLowerCase("en-US");
    if (/^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(raw)) return raw.toUpperCase();
    return raw;
  }
  function keyboardShortcutChordFromEvent(event) {
    const key = keyboardShortcutKey(event);
    if (!key) return "";
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push("Mod");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    parts.push(key);
    return parts.join("+");
  }
  function keyboardShortcutChordKey(chord) {
    return String(chord || "").split("+").at(-1) || "";
  }
  function keyboardShortcutChordHasModifier(chord) {
    return /(?:^|\+)(?:Mod|Alt|Shift)(?:\+|$)/.test(chord);
  }
  function keyboardShortcutChordAllowed(chord) {
    const key = keyboardShortcutChordKey(chord);
    if (!key) return false;
    if (KEYBOARD_SHORTCUT_RESERVED.has(chord)) return false;
    return key.length === 1 || ["Tab", "Enter", "Escape", "Space", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key) || /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key);
  }
  function keyboardShortcutIsMac() {
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
  }
  function keyboardShortcutDisplay(chord) {
    if (!chord) return t("settingsShortcutNotSet");
    const mac = keyboardShortcutIsMac(), labels = {
      Mod:mac ? "⌘" : "Ctrl", Alt:mac ? "⌥" : "Alt", Shift:mac ? "⇧" : "Shift",
      Tab:"Tab", Enter:mac ? "↩" : "Enter", Escape:"Esc", Space:"Space", Backspace:mac ? "⌫" : "Backspace",
      Delete:mac ? "⌦" : "Delete", ArrowLeft:"←", ArrowRight:"→", ArrowUp:"↑", ArrowDown:"↓",
      PageUp:"Page Up", PageDown:"Page Down",
    };
    return chord.split("+").map((part) => labels[part] || (part.length === 1 ? part.toLocaleUpperCase(state.language === "zh" ? "zh-CN" : "en-US") : part)).join(mac ? " " : " + ");
  }
  function keyboardShortcutFormat(key, values = {}) {
    let value = t(key);
    for (const [name, replacement] of Object.entries(values)) value = value.replace(`{${name}}`, replacement);
    return value;
  }
  function keyboardShortcutCanvasHint(commandId, key) {
    const chord = keyboardShortcutBindings[commandId];
    return chord ? { key, values:{ shortcut:keyboardShortcutDisplay(chord) } } : null;
  }
  function keyboardShortcutUndoRedoHint() {
    const undo = keyboardShortcutBindings.undo, redo = keyboardShortcutBindings.redo;
    return undo && redo ? {
      key:"canvasHintShortcutUndoRedo",
      values:{ undo:keyboardShortcutDisplay(undo), redo:keyboardShortcutDisplay(redo) },
    } : null;
  }
  function keyboardShortcutSetStatus(key, values = {}, stateName = "") {
    keyboardShortcutStatus = key ? { key, values, stateName } : null;
    const status = document.querySelector("#settingsShortcutStatus");
    if (!status) return;
    status.textContent = keyboardShortcutStatus ? keyboardShortcutFormat(key, values) : "";
    status.dataset.state = stateName;
  }
  function keyboardShortcutFocusEditor(commandId) {
    requestAnimationFrame(() => document.querySelector(`[data-shortcut-edit="${commandId}"]`)?.focus({ preventScroll:true }));
  }
  function renderKeyboardShortcuts() {
    const penShortcut = document.querySelector('[data-welcome-shortcut="pen"]');
    if (penShortcut) { penShortcut.textContent = keyboardShortcutDisplay(keyboardShortcutBindings["pen-tool"] || ""); penShortcut.hidden = !keyboardShortcutBindings["pen-tool"]; }
    const shortcut = document.querySelector('[data-welcome-shortcut="focusAgent"]');
    // On the empty canvas, Mod+K opens the Agent directly from the welcome card.
    if (shortcut) { shortcut.textContent = keyboardShortcutDisplay("Mod+k"); shortcut.hidden = false; }
    const search = document.querySelector("#studioNavigatorSearchShortcut");
    if (search) { search.textContent = keyboardShortcutDisplay(keyboardShortcutBindings["search-work"] || ""); search.hidden = !keyboardShortcutBindings["search-work"]; }
    const container = document.querySelector("#settingsShortcutList");
    if (!container) return;
    container.replaceChildren();
    for (const group of KEYBOARD_SHORTCUT_GROUPS) {
      const section = document.createElement("section"), heading = document.createElement("h4"), list = document.createElement("div");
      section.className = "settings-shortcut-group";
      heading.textContent = t(group.labelKey);
      heading.id = `settingsShortcutGroup-${group.id}`;
      list.className = "settings-shortcut-list";
      list.dataset.peContainer = "component";
      section.setAttribute("aria-labelledby", heading.id);
      for (const command of KEYBOARD_SHORTCUT_COMMANDS.filter((item) => item.group === group.id)) {
        const row = document.createElement("div"), copy = document.createElement("div"), title = document.createElement("strong"), description = document.createElement("small"), actions = document.createElement("div"), edit = document.createElement("button"), binding = document.createElement("kbd"), reset = document.createElement("button");
        const chord = keyboardShortcutBindings[command.id] || "", recording = keyboardShortcutRecordingId === command.id;
        row.className = "settings-shortcut-row";
        row.dataset.peList = "settings";
        row.dataset.peState = recording ? "selected" : "default";
        copy.className = "settings-shortcut-copy";
        copy.dataset.peRegion = "copy";
        title.textContent = t(command.labelKey);
        description.textContent = t(command.descriptionKey);
        copy.append(title, description);
        actions.className = "settings-shortcut-actions";
        actions.dataset.peRegion = "control-rail";
        edit.type = "button";
        edit.className = "settings-shortcut-binding";
        edit.dataset.shortcutEdit = command.id;
        edit.dataset.peButton = "secondary";
        edit.dataset.peDensity = "compact";
        edit.dataset.peState = recording ? "selected" : "default";
        edit.setAttribute("aria-pressed", String(recording));
        edit.setAttribute("aria-label", keyboardShortcutFormat("settingsShortcutEdit", { command:t(command.labelKey) }));
        binding.textContent = recording ? t("settingsShortcutPressKeys") : keyboardShortcutDisplay(chord);
        edit.append(binding);
        reset.type = "button";
        reset.className = "settings-shortcut-reset";
        reset.dataset.shortcutReset = command.id;
        reset.dataset.peButton = "icon";
        reset.dataset.peDensity = "compact";
        reset.hidden = chord === command.defaultChord;
        reset.setAttribute("aria-label", keyboardShortcutFormat("settingsShortcutReset", { command:t(command.labelKey) }));
        reset.title = reset.getAttribute("aria-label");
        reset.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8v5h5M6.6 16.2A7 7 0 1 0 6 8.8L5 10"/></svg>';
        actions.append(edit, reset);
        row.append(copy, actions);
        list.append(row);
      }
      section.append(heading, list);
      container.append(section);
    }
    if (keyboardShortcutStatus) keyboardShortcutSetStatus(keyboardShortcutStatus.key, keyboardShortcutStatus.values, keyboardShortcutStatus.stateName);
  }
  function keyboardShortcutStartRecording(commandId) {
    const command = keyboardShortcutCommand(commandId);
    if (!command) return false;
    keyboardShortcutRecordingId = commandId;
    keyboardShortcutSetStatus("settingsShortcutRecording", { command:t(command.labelKey) });
    renderKeyboardShortcuts();
    keyboardShortcutFocusEditor(commandId);
    return true;
  }
  function keyboardShortcutStopRecording({ restoreFocus = true } = {}) {
    const commandId = keyboardShortcutRecordingId;
    keyboardShortcutRecordingId = "";
    renderKeyboardShortcuts();
    if (restoreFocus && commandId) keyboardShortcutFocusEditor(commandId);
  }
  function keyboardShortcutAssign(commandId, chord) {
    const command = keyboardShortcutCommand(commandId);
    if (!command) return false;
    const conflict = chord && KEYBOARD_SHORTCUT_COMMANDS.find((item) => item.id !== commandId && keyboardShortcutBindings[item.id] === chord);
    if (conflict) {
      keyboardShortcutSetStatus("settingsShortcutConflict", { shortcut:keyboardShortcutDisplay(chord), command:t(conflict.labelKey) }, "error");
      return false;
    }
    keyboardShortcutBindings = { ...keyboardShortcutBindings, [commandId]:chord };
    keyboardShortcutPersistBindings();
    keyboardShortcutSetStatus(chord ? "settingsShortcutUpdated" : "settingsShortcutCleared", { command:t(command.labelKey) }, "success");
    keyboardShortcutRecordingId = "";
    renderKeyboardShortcuts();
    keyboardShortcutFocusEditor(commandId);
    return true;
  }
  function keyboardShortcutReset(commandId) {
    const command = keyboardShortcutCommand(commandId);
    if (!command) return false;
    keyboardShortcutRecordingId = "";
    keyboardShortcutBindings = { ...keyboardShortcutBindings, [commandId]:command.defaultChord };
    keyboardShortcutPersistBindings();
    keyboardShortcutSetStatus("settingsShortcutResetDone", { command:t(command.labelKey) }, "success");
    renderKeyboardShortcuts();
    keyboardShortcutFocusEditor(commandId);
    return true;
  }
  function keyboardShortcutResetAll() {
    keyboardShortcutRecordingId = "";
    keyboardShortcutBindings = keyboardShortcutDefaults();
    keyboardShortcutPersistBindings();
    keyboardShortcutSetStatus("settingsShortcutResetAllDone", {}, "success");
    renderKeyboardShortcuts();
  }
  function keyboardShortcutTextEditingTarget(target) {
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'));
  }
  function keyboardShortcutInteractiveTarget(target) {
    return keyboardShortcutTextEditingTarget(target) || Boolean(target?.closest?.('button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], summary'));
  }
  // A pointer-focused workspace control retains Canvas shortcuts. Keyboard
  // navigation or a focus move relinquishes that exception without moving focus.
  let keyboardShortcutPointerControl = null;
  function keyboardShortcutControl(target) {
    return target?.closest?.('button, a[href], [role="button"], [role="tab"], summary') || null;
  }
  function keyboardShortcutPointerDown(event) {
    const control = keyboardShortcutControl(event.target);
    keyboardShortcutPointerControl = control?.closest?.('#studioNavigator, .toolbar, .topbar') ? control : null;
  }
  function keyboardShortcutFocusChanged(event) {
    if (keyboardShortcutControl(event.target) !== keyboardShortcutPointerControl) keyboardShortcutPointerControl = null;
  }
  function keyboardShortcutControlOwnsKey(event, chord) {
    if (!keyboardShortcutInteractiveTarget(event.target)) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const key = keyboardShortcutChordKey(chord);
    // Activation, destructive, and directional keys always belong to controls.
    if (["Enter", "Space", "Delete", "Backspace", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return true;
    return keyboardShortcutControl(event.target) !== keyboardShortcutPointerControl || !keyboardShortcutPointerControl;
  }
  function keyboardShortcutLocalSurface(target) {
    return Boolean(target?.closest?.('[role="menu"], [role="listbox"], [role="dialog"], .canvas-widget'))
      || Boolean(document.querySelector('[role="menu"]:not([hidden]), #autoDelayPopover:not([hidden]), #effortPopover:not([hidden]), #craftsPopover:not([hidden])'));
  }
  function keyboardShortcutCanvasContext(event, chord) {
    return !event.defaultPrevented && !event.isComposing && !state.interactingWidgetId
      && !keyboardShortcutBlockingSurfaceOpen() && !keyboardShortcutLocalSurface(event.target)
      && !keyboardShortcutTextEditingTarget(event.target) && !canvasAgentPanel.contains(event.target)
      && !keyboardShortcutControlOwnsKey(event, chord);
  }
  window.addEventListener("pointerdown", keyboardShortcutPointerDown, true);
  window.addEventListener("focusin", keyboardShortcutFocusChanged, true);
  window.addEventListener("blur", () => { keyboardShortcutPointerControl = null; });
  window.addEventListener("keydown", (event) => {
    if ((event.key === "Tab" && event.shiftKey) || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " ", "Escape"].includes(event.key)) keyboardShortcutPointerControl = null;
  }, true);
  function keyboardShortcutBlockingSurfaceOpen() {
    return Boolean(settings.open || settings.configurationMode || document.querySelector("dialog[open]") || document.querySelector(".plugin-modal-layer:not([hidden]), .changelog-layer:not([hidden]), .tour-layer:not([hidden]), .history-panel.open"));
  }
  function keyboardShortcutCanRun(command, event, chord) {
    if (!command || event.defaultPrevented || event.isComposing || event.repeat) return false;
    // Tab is the global Agent toggle, including pointer focus and its composer.
    if (command.id === "focus-agent" && chord === "Tab" && !keyboardShortcutBlockingSurfaceOpen()) return canvasAgentAvailable();
    if (state.interactingWidgetId) return false;
    if (command.id === "open-settings" && settings.open) return true;
    if (keyboardShortcutBlockingSurfaceOpen()) return false;
    if (keyboardShortcutLocalSurface(event.target)) return false;
    if (keyboardShortcutTextEditingTarget(event.target)) return command.id === "save-canvas" || command.id === "search-work";
    if (command.id === "focus-agent" && (!canvasAgentAvailable() || canvasAgentPanel.contains(event.target))) return false;
    if (keyboardShortcutControlOwnsKey(event, chord)) return false;
    return true;
  }
  function keyboardShortcutPerform(commandId) {
    if (commandId === "search-work") { window.PenEchoStudioNavigator?.focusSearch(); return true; }
    if (commandId === "pen-tool") { setCanvasMode("pen"); return true; }
    if (commandId === "focus-agent") {
      const opening = canvasAgentPanel.hidden || !document.body.classList.contains("canvas-agent-open");
      if (opening) openCanvasAgent({ focus:false, animate:true });
      else closeCanvasAgent({ focus:false });
      return true;
    }
    if (commandId === "save-canvas") { void saveCurrentCanvas(); return true; }
    if (commandId === "undo" || commandId === "redo") { document.querySelector(`[data-action="${commandId}"]`)?.click(); return true; }
    if (commandId === "canvas-library") { openHistoryPanel(); return true; }
    if (commandId === "toggle-fullscreen") { document.querySelector("#fullscreenBtn")?.click(); return true; }
    if (commandId === "open-settings") { if (settings.open) closeSettings(); else openSettings(); return true; }
    return false;
  }
  function handleKeyboardShortcutKeydown(event) {
    if (keyboardShortcutRecordingId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        keyboardShortcutSetStatus("settingsShortcutCancelled");
        keyboardShortcutStopRecording();
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        keyboardShortcutAssign(keyboardShortcutRecordingId, "");
        return;
      }
      const chord = keyboardShortcutChordFromEvent(event);
      if (!chord) return;
      if (!keyboardShortcutChordAllowed(chord)) {
        keyboardShortcutSetStatus(KEYBOARD_SHORTCUT_RESERVED.has(chord) ? "settingsShortcutReserved" : "settingsShortcutInvalid", { shortcut:keyboardShortcutDisplay(chord) }, "error");
        return;
      }
      keyboardShortcutAssign(keyboardShortcutRecordingId, chord);
      return;
    }
    const chord = keyboardShortcutChordFromEvent(event);
    if (!chord) return;
    const welcomeAgentShortcut = chord === "Mod+k" && !document.querySelector("#canvasWelcome")?.hidden;
    const command = chord === "Tab" || welcomeAgentShortcut ? keyboardShortcutCommand("focus-agent") : KEYBOARD_SHORTCUT_COMMANDS.find((item) => keyboardShortcutBindings[item.id] === chord);
    if (!keyboardShortcutCanRun(command, event, chord)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    keyboardShortcutPerform(command.id);
  }

  const settingsShortcutList = document.querySelector("#settingsShortcutList"),
    settingsShortcutResetAll = document.querySelector("#settingsShortcutResetAll");
  settingsShortcutList?.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-shortcut-edit]"), reset = event.target.closest("[data-shortcut-reset]");
    if (edit) keyboardShortcutStartRecording(edit.dataset.shortcutEdit);
    else if (reset) keyboardShortcutReset(reset.dataset.shortcutReset);
  });
  settingsShortcutResetAll?.addEventListener("click", keyboardShortcutResetAll);
  window.addEventListener("keydown", handleKeyboardShortcutKeydown, true);
  window.addEventListener("penecho:languagechange", renderKeyboardShortcuts);
  window.addEventListener("storage", (event) => {
    if (event.key !== KEYBOARD_SHORTCUT_STORAGE_KEY) return;
    keyboardShortcutBindings = keyboardShortcutLoadBindings();
    keyboardShortcutRecordingId = "";
    renderKeyboardShortcuts();
  });
  renderKeyboardShortcuts();
  window.PenEchoKeyboardShortcuts = Object.freeze({
    bindings:() => ({ ...keyboardShortcutBindings }),
    reset:keyboardShortcutResetAll,
    open:() => { selectSettingsPage("shortcuts"); return openSettings(); },
  });
