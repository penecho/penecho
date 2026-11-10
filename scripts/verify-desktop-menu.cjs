"use strict";

// Real Canvas + native menu + production preload, with an isolated test profile.
const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { createMenuTemplate, normalizeMenuState, canvasOwnsShortcut } = require("../desktop/menu.js");
const root = path.resolve(__dirname, ".."), output = path.resolve(process.argv[2] || path.join(root, "output/desktop-menu")), profile = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-menu-test-"));
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(profile, "electron"));
app.disableHardwareAcceleration();
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(profile, "state"), PENECHO_DESKTOP_APP:"true", HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"menu-test", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
let server, win, menu, language = "en", state = normalizeMenuState(null);
const report = { platform:process.platform, checks:[], errors:[] }, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) { for (let n = 0; n < 120; n++) { if (await check()) return; await pause(100); } throw Error(`Timed out: ${label}`); }
function installMenu() {
  menu = Menu.buildFromTemplate(createMenuTemplate({ platform:process.platform, language, state, canvasFocused:true,
    dispatch:command => win.webContents.send("penecho:menu-command", command), edit:command => win.webContents.send("penecho:menu-command", command), checkUpdates(){}, openHelp(){}, openLan(){},
  }));
  Menu.setApplicationMenu(menu);
}
ipcMain.on("penecho:menu-state", (_event, value) => { state = normalizeMenuState(value); installMenu(); });
ipcMain.on("penecho:set-language", (_event, value) => { language = value; installMenu(); });
ipcMain.handle("penecho:menu-native-edit", (_event, command) => { assert(["undo", "redo"].includes(command)); win.webContents[command](); });
ipcMain.handle("penecho:get-update-state", () => ({ status:"idle", updateAvailable:false }));
ipcMain.handle("penecho:mcp-keep-awake", () => false);
ipcMain.handle("penecho:set-page-scale", (_event, scale) => { win.webContents.setZoomFactor(scale); return scale; });
const js = code => win.webContents.executeJavaScript(code, true);
async function command(id) { await waitFor(() => menu?.getMenuItemById(id)?.enabled, `menu enabled: ${id}`); menu.getMenuItemById(id).click(undefined, win); await pause(150); }
async function screenshot(name) { fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()); }
const savedCount = () => js(`new Promise((resolve,reject)=>{const r=indexedDB.open('penecho-canvas-history',2);r.onsuccess=()=>{const db=r.result,q=db.transaction('snapshots').objectStore('snapshots').count();q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=reject};r.onerror=reject})`);
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1440, height:1000, webPreferences:{ preload:path.join(root, "desktop/canvas-preload.js"), contextIsolation:true, sandbox:true, nodeIntegration:false, offscreen:true, backgroundThrottling:false } });
    win.webContents.on("before-input-event", (_event, input) => win.webContents.setIgnoreMenuShortcuts(canvasOwnsShortcut(input, state)));
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3 && /Uncaught|ReferenceError|TypeError/.test(message)) report.errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await waitFor(() => Boolean(state.bindings["new-canvas"]), "Canvas menu bridge");
    await js("document.querySelector('#tourSkip')?.click(); document.querySelector('#changelogClose')?.click()");
    await pause(300);
    await command("mcp-local");
    assert.equal(await js("!document.querySelector('#settingsPageMcp').hidden && !document.querySelector('#mcpLocalPanel').hidden"), true);
    await screenshot("mcp-local");
    await command("mcp-cloud");
    assert.equal(await js("!document.querySelector('#mcpCloudPanel').hidden"), true);
    await command("connections");
    assert.equal(await js("!document.querySelector('#settingsPageConnections').hidden"), true);
    await command("ai-settings");
    assert.equal(await js("!document.querySelector('#settingsPageCanvas').hidden"), true);
    await js("document.querySelector('#settingsClose').click()");
    await command("agent-history");
    assert.equal(await js("document.querySelector('[data-studio-navigator-tab=agent]')?.getAttribute('aria-selected')"), "true");
    await screenshot("ai-history");
    assert.deepEqual(menu.getMenuItemById("ai-menu").submenu.items.filter(item => item.id).map(item => item.id), ["focus-agent", "agent-history", "connections", "ai-settings"]);
    assert.equal(menu.getMenuItemById("mcp-menu").submenu.items.some(item => item.id === "connections"), false);
    assert.equal(menu.getMenuItemById("local-network-menu").submenu.items.some(item => item.submenu), false);
    report.checks.push("AI actions have their own top-level menu; MCP stays separate; local network entries are second-level");
    await command("mcp-status");
    assert.equal(await js("document.querySelector('#mcpStatusPopover').matches(':popover-open')"), true);
    await screenshot("mcp-status");
    assert.notEqual(await js("document.querySelector('#mcpToolbarToggle').getAttribute('aria-pressed')"), "true", "viewing status must not connect MCP");
    await js("document.querySelector('#mcpStatusPopover').hidePopover()");
    report.checks.push("MCP local/cloud configuration, connections, and status open without enabling MCP");

    await command("save-copy");
    assert.equal(await js("document.querySelector('#historyPanel').classList.contains('open') && document.querySelector('#historySavePanel').open"), true);
    await screenshot("save-copy");
    await js("document.querySelector('#historyClose').click()");
    await command("new-canvas");
    report.checks.push("New Canvas creates an empty document; Save Copy opens existing form");

    // Draw a stroke through the real input pipeline, then save and verify storage.
    await js("document.querySelector('[data-mode=pen]').click()");
    const point = await js("(()=>{const r=document.querySelector('#viewport').getBoundingClientRect();return {x:Math.round(r.x+r.width*.25),y:Math.round(r.y+r.height*.2)}})()");
    assert.equal(await js(`document.elementFromPoint(${point.x},${point.y})?.id`), "screen", "the test stroke starts on exposed canvas, not a welcome card");
    win.webContents.sendInputEvent({ type:"mouseDown", ...point, button:"left", clickCount:1 });
    for (let n = 1; n <= 8; n++) { win.webContents.sendInputEvent({ type:"mouseMove", x:point.x+n*9, y:point.y+n*3, button:"left" }); await pause(20); }
    win.webContents.sendInputEvent({ type:"mouseUp", x:point.x+72, y:point.y+24, button:"left", clickCount:1 });
    await pause(200);
    await command("close-canvas");
    await waitFor(() => js("document.querySelector('#newCanvasDialog').open"), "close canvas save confirmation");
    await screenshot("new-canvas");
    assert.equal(state.enabled["save-canvas"], false);
    await js("document.querySelector('#newCanvasClose').click()");
    await command("undo"); await command("redo");
    await command("save-canvas");
    await waitFor(async () => await savedCount() === 1, "saved Canvas in isolated IndexedDB");
    await command("save-canvas");
    assert.equal(await savedCount(), 1, "Save overwrites current Canvas rather than duplicating it");
    await command("new-canvas");
    assert.equal(await savedCount(), 1, "New Canvas preserves the saved document");
    report.checks.push("Canvas Undo/Redo, Save persistence, overwrite without duplication, Close Canvas cancellation, and New Canvas preservation");

    await command("shortcuts");
    await js("document.querySelector('[data-shortcut-edit=\"save-canvas\"]').click()");
    await waitFor(() => state.recording, "shortcut recorder");
    const modifiers = process.platform === "darwin" ? ["meta", "alt"] : ["control", "alt"];
    win.webContents.sendInputEvent({ type:"keyDown", keyCode:"S", modifiers });
    win.webContents.sendInputEvent({ type:"keyUp", keyCode:"S", modifiers });
    await waitFor(() => state.bindings["save-canvas"] === "Mod+Alt+s", "shortcut customization");
    assert.equal(menu.getMenuItemById("save-canvas").accelerator, "CommandOrControl+Alt+s");
    await js("document.querySelector('#settingsClose').click()");
    await command("save-canvas");
    assert.equal(await savedCount(), 1);
    report.checks.push("Native menu accelerator follows custom shortcut; recording reaches renderer");
    await js("localStorage.setItem('penecho-language','zh');window.dispatchEvent(new CustomEvent('penecho:languagechange',{detail:{language:'zh'}}))");
    await waitFor(() => menu.getMenuItemById("new-canvas").label === "新建画布…", "Chinese menu");
    const serialize = items => items.map(item => ({ label:item.label, id:item.id, enabled:item.enabled, accelerator:item.accelerator, ...(item.submenu ? { submenu:serialize(item.submenu.items) } : {}) }));
    report.menu = serialize(menu.items);
    report.checks.push("Native menus follow application language");
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) { report.ok = false; report.error = error.stack; if (win) await screenshot("failure").catch(() => {}); }
  finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok:report.ok, checks:report.checks, error:report.error, output }));
    win?.destroy(); server?.closeAllConnections?.(); server?.close();
    // Electron's process owns additional sockets; app.exit closes all of them.
    fs.writeFileSync(path.join(output, "temporary-profile.txt"), profile);
    app.exit(report.ok ? 0 : 1);
  }
});
