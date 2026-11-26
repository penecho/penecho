"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { CANVAS_COMMANDS, PROJECT_COMMANDS, menuCommandAllowed, createMenuTemplate, normalizeMenuState, canvasOwnsShortcut, acceleratorFor } = require("../desktop/menu.js");

test("Canvas menus keep document actions and send Settings to the Projects page on both platforms", () => {
  for (const platform of ["darwin", "win32"]) for (const language of ["en", "zh"]) {
    const calls = [], state = normalizeMenuState({ enabled:Object.fromEntries(CANVAS_COMMANDS.map(id => [id, true])), bindings:{ "new-canvas":"Mod+n", "save-canvas":"Mod+Alt+s", "search-work":"Tab" } });
    const menu = createMenuTemplate({ platform, language, state, canvasFocused:true, dispatch:id => calls.push(id), edit(){}, checkUpdates(){}, openHelp(){}, openLan(){} });
    const items = menu.flatMap(item => item.submenu), find = id => items.find(item => item.id === id);
    for (const id of CANVAS_COMMANDS) { assert(find(id)?.enabled, id); find(id).click(null, null); }
    for (const id of ["open-settings", "open-agents", "open-mcp", "show-projects", "new-project"]) { assert(find(id)?.enabled, id); assert(menuCommandAllowed(id, state), id); }
    for (const id of ["new-line", "find", "view-home"]) assert(!menuCommandAllowed(id, state), id);
    assert.equal(find("save-canvas").accelerator, "CommandOrControl+Alt+s");
    assert.equal(find("search-work").accelerator, undefined);
    assert.equal(find("open-settings").label, language === "zh" ? "设置…" : "Settings…");
    assert.equal(find("open-settings").accelerator, "CommandOrControl+,");
    assert.equal(items.filter(item => item.id === "check-updates").length, 1);
    assert.equal(items.filter(item => item.id === "open-settings").length, 1);
    assert.deepEqual(menu.map(item => item.id).filter(Boolean), [], "no AI, MCP or network top-level menus");
    assert(find("local-network-menu"), "other devices live in File");
    assert.equal(find("tour"), undefined); assert(!menuCommandAllowed("tour", state));
    assert(calls.includes("new-canvas")); assert(calls.includes("save-copy"));
    assert(!items.some(item => item.role === "reload"), "reload must not discard unsaved work from a menu shortcut");
    assert.equal(menu.length, mac(platform) ? 6 : 5);
  }
});

const mac = platform => platform === "darwin";

test("Projects page menus drive the page, list projects and open its folders", () => {
  for (const platform of ["darwin", "win32"]) {
    const calls = [], folders = [];
    const state = normalizeMenuState({ page:"projects", enabled:Object.fromEntries(PROJECT_COMMANDS.map(id => [id, true])), theme:"dark", topics:true, current:"p2",
      projects:[{ id:"p1", name:"Weather app" }, { id:"p2", name:"PenEcho" }, { id:"", name:"bad" }], docsPath:"/Users/me/Docs/PenEcho", codePath:"relative/not/allowed" });
    const menu = createMenuTemplate({ platform, language:"en", state, canvasFocused:true, dispatch:id => calls.push(id), edit(){}, checkUpdates(){}, openHelp(){}, openLan(){}, openFolder:path => folders.push(path) });
    const all = items => items.flatMap(item => [item, ...(Array.isArray(item.submenu) ? all(item.submenu) : [])]), items = all(menu), find = id => items.find(item => item.id === id);
    for (const id of PROJECT_COMMANDS.filter(id => id !== "show-projects")) { assert(find(id)?.enabled, id); find(id).click(); }
    assert.equal(find("show-projects"), undefined, "already on the Projects page");
    assert.equal(find("view-agents"), undefined);
    assert.equal(menuCommandAllowed("view-agents", state), false);
    assert.equal(find("save-canvas"), undefined, "Canvas items stay on the Canvas");
    assert.equal(find("new-line").accelerator, "CommandOrControl+N");
    assert.equal(find("find").accelerator, "CommandOrControl+F");
    assert.equal(find("go-back").registerAccelerator, false, "the page keeps its own Back key");
    assert.equal(find("theme-dark").checked, true);
    assert.equal(find("project:p2").checked, true);
    assert.equal(find("project:p1").accelerator, "Alt+1");
    assert.equal(find("project:p1").registerAccelerator, false);
    assert(!items.some(item => item.id === "project:"), "projects without an id are dropped");
    // Topics hidden (PE-1066): the page says topics:false, and View has no Topics item.
    const hidden = all(createMenuTemplate({ platform, language:"en", state:normalizeMenuState({ ...state, topics:false }), dispatch(){}, edit(){}, checkUpdates(){}, openHelp(){}, openLan(){} }));
    assert.equal(hidden.find(item => item.id === "view-topics"), undefined);
    assert(hidden.find(item => item.id === "view-files"));
    find("project:p1").click();
    assert(menuCommandAllowed("project:p1", state));
    assert(!menuCommandAllowed("project:p9", state));
    find("open-docs-folder").click();
    assert.deepEqual(folders, ["/Users/me/Docs/PenEcho"]);
    assert.equal(find("open-code-folder"), undefined, "a relative folder is never opened");
    assert.match(find("open-docs-folder").label, platform === "darwin" ? /Finder/ : /Explorer/);
    assert(calls.includes("new-line") && calls.includes("theme-dark") && calls.includes("project:p1"));
    assert(items.some(item => item.role === "undo" && !item.click), "text editing undo on the Projects page");
  }
  const idle = createMenuTemplate({ platform:"darwin", language:"en", state:normalizeMenuState({ page:"projects" }), canvasFocused:true, dispatch(){}, edit(){}, checkUpdates(){}, openHelp(){}, openLan(){} });
  const items = idle.flatMap(item => item.submenu);
  assert.equal(items.find(item => item.id === "open-settings").enabled, false, "waits for the page to say it is ready");
});

test("renderer owns customized shortcuts, recording, and text editing keys", () => {
  const state = normalizeMenuState({ bindings:{ "save-canvas":"Mod+Alt+s", undo:"Mod+z", "search-work":"Mod+k" } });
  assert(canvasOwnsShortcut({ key:"s", control:true, alt:true }, state));
  assert(canvasOwnsShortcut({ key:"z", meta:true }, state));
  assert(!canvasOwnsShortcut({ key:"s", control:true }, state));
  assert(!canvasOwnsShortcut({ key:"q", meta:true }, state));
  assert(canvasOwnsShortcut({ key:"q", meta:true }, { ...state, recording:true }));
  assert.equal(acceleratorFor("invalid+shortcut"), undefined);
  assert.equal(normalizeMenuState({ enabled:{ "save-canvas":1, unknown:true } }).enabled["save-canvas"], false);
});

function renderer() {
  const { document } = require("./helpers/dom.js").parseHTML('<html><body><button id="newCanvasBtn"></button><button id="saveCanvasBtn"></button><button data-action="undo"></button><div id="historyPanel"></div><details id="historySavePanel"></details><input id="historyName"></body></html>');
  const calls = [], context = vm.createContext({ document, state:{}, settings:{}, snapshotSaveInProgress:false, snapshotLoadInProgress:false,
    keyboardShortcutBlockingSurfaceOpen:() => false, keyboardShortcutTextEditingTarget:node => node?.tagName === "INPUT", canvasAgentAvailable:() => true,
    window:{ penechoDesktop:{ nativeEdit:id => calls.push(`native:${id}`) }, PenEchoMcpSettings:{ select:tab => calls.push(tab) } },
    projectLinesTarget:{ project:"p1", back:"" }, projectLinesSettingsReturnUrl:() => calls.push("return"), setStatus(){},
    projectLinesLeave:to => { calls.push(`leave:${to}`); return Promise.resolve(); },
    selectSettingsPage:page => calls.push(page), openSettings:() => calls.push("settings"), openHistoryPanel:() => calls.push("library"), keyboardShortcutPerform:id => calls.push(id), requestAnimationFrame:fn => fn(),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/client/app/desktop-menu.js"), "utf8"), context);
  return { context, document, calls };
}

test("desktop commands reuse safe Canvas controls and send Settings to the Projects page", () => {
  const { context, document, calls } = renderer();
  document.querySelector("#newCanvasBtn").onclick = () => calls.push("new-dialog");
  document.querySelector("#saveCanvasBtn").onclick = () => calls.push("save");
  for (const id of ["new-canvas", "save-canvas", "shortcuts", "save-copy", "open-settings", "open-mcp", "show-projects"]) assert(context.performDesktopMenuCommand(id), id);
  assert.deepEqual(calls, ["new-dialog", "save", "shortcuts", "settings", "library", "return", "leave:/projects.html#settings", "return", "leave:/projects.html#agents/apps", "leave:/projects.html#p1"]);
  assert.equal(document.querySelector("#historySavePanel").open, true);
  context.snapshotSaveInProgress = true;
  assert.equal(context.performDesktopMenuCommand("new-canvas"), false);
  assert.equal(context.performDesktopMenuCommand("save-canvas"), false);
  context.snapshotSaveInProgress = false;
  document.querySelector("#saveCanvasBtn").disabled = true;
  assert.equal(context.performDesktopMenuCommand("save-canvas"), false);
  document.body.insertAdjacentHTML("beforeend", '<dialog open></dialog>');
  assert.equal(context.performDesktopMenuCommand("shortcuts"), false);
  assert.equal(context.performDesktopMenuCommand("unknown"), false);
});

test("Undo menu preserves text undo and otherwise uses Canvas history", () => {
  const { context, document, calls } = renderer();
  document.querySelector('[data-action="undo"]').onclick = () => calls.push("canvas:undo");
  document.activeElement = document.querySelector("#historyName");
  assert(context.performDesktopMenuCommand("undo"));
  document.activeElement = document.body;
  assert(context.performDesktopMenuCommand("undo"));
  context.keyboardShortcutBlockingSurfaceOpen = () => true;
  assert.equal(context.performDesktopMenuCommand("undo"), false);
  assert.deepEqual(calls, ["native:undo", "canvas:undo"]);
});
