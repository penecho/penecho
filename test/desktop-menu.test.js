"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { COMMANDS, createMenuTemplate, normalizeMenuState, canvasOwnsShortcut, acceleratorFor } = require("../desktop/menu.js");

test("native menus expose localized document and MCP actions on both platforms", () => {
  for (const platform of ["darwin", "win32"]) for (const language of ["en", "zh"]) {
    const calls = [], state = normalizeMenuState({ enabled:Object.fromEntries(COMMANDS.map(id => [id, true])), bindings:{ "new-canvas":"Mod+n", "save-canvas":"Mod+Alt+s", "focus-agent":"Tab" } });
    const menu = createMenuTemplate({ platform, language, state, canvasFocused:true, dispatch:id => calls.push(id), edit(){}, checkUpdates(){}, openHelp(){}, openLan(){} });
    const items = menu.flatMap(item => item.submenu), find = id => items.find(item => item.id === id);
    for (const id of COMMANDS) { assert(find(id)?.enabled, id); find(id).click(null, null); }
    assert.equal(find("save-canvas").accelerator, "CommandOrControl+Alt+s");
    assert.equal(find("focus-agent").accelerator, undefined);
    assert.equal(find("mcp-local").label, language === "zh" ? "配置本地 MCP…" : "Set Up Local MCP…");
    assert.equal(items.filter(item => item.id === "check-updates").length, 1);
    assert(calls.includes("new-canvas")); assert(calls.includes("save-copy")); assert(calls.includes("mcp-status"));
    assert(!items.some(item => item.role === "reload"), "reload must not discard unsaved work from a menu shortcut");
  }
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
  const { document } = require("linkedom").parseHTML('<html><body><button id="newCanvasBtn"></button><button id="saveCanvasBtn"></button><button data-action="undo"></button><button id="mcpToolbarToggle"></button><div id="historyPanel"></div><details id="historySavePanel"></details><input id="historyName"></body></html>');
  const calls = [], context = vm.createContext({ document, state:{}, settings:{}, snapshotSaveInProgress:false, snapshotLoadInProgress:false,
    keyboardShortcutBlockingSurfaceOpen:() => false, keyboardShortcutTextEditingTarget:node => node?.tagName === "INPUT", canvasAgentAvailable:() => true,
    window:{ penechoDesktop:{ nativeEdit:id => calls.push(`native:${id}`) }, PenEchoMcpSettings:{ select:tab => calls.push(tab) } },
    mcpOpenStatus:(_event, options) => calls.push(`mcp-status:${options.connect}`),
    selectSettingsPage:page => calls.push(page), openSettings:() => calls.push("settings"), openHistoryPanel:() => calls.push("library"), keyboardShortcutPerform:id => calls.push(id), replayFeatureTour:() => calls.push("tour"), requestAnimationFrame:fn => fn(),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/client/app/desktop-menu.js"), "utf8"), context);
  return { context, document, calls };
}

test("desktop commands reuse safe Canvas controls and open exact MCP tabs without enabling MCP", () => {
  const { context, document, calls } = renderer();
  document.querySelector("#newCanvasBtn").onclick = () => calls.push("new-dialog");
  document.querySelector("#saveCanvasBtn").onclick = () => calls.push("save");
  for (const id of ["new-canvas", "save-canvas", "mcp-local", "mcp-cloud", "mcp-status", "save-copy"]) assert(context.performDesktopMenuCommand(id));
  assert.deepEqual(calls, ["new-dialog", "save", "mcp", "settings", "local", "mcp", "settings", "cloud", "mcp-status:false", "library"]);
  assert.equal(document.querySelector("#historySavePanel").open, true);
  context.snapshotSaveInProgress = true;
  assert.equal(context.performDesktopMenuCommand("new-canvas"), false);
  assert.equal(context.performDesktopMenuCommand("save-canvas"), false);
  context.snapshotSaveInProgress = false;
  document.querySelector("#saveCanvasBtn").disabled = true;
  assert.equal(context.performDesktopMenuCommand("save-canvas"), false);
  document.body.insertAdjacentHTML("beforeend", '<dialog open></dialog>');
  assert.equal(context.performDesktopMenuCommand("mcp-local"), false);
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
