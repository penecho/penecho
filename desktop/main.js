"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { fileURLToPath, pathToFileURL } = require("node:url");
const {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, safeStorage, shell, powerSaveBlocker,
} = require("electron");
const { menuCommandAllowed, createMenuTemplate, normalizeMenuState, canvasOwnsShortcut } = require("./menu.js");
const { createMcpPowerLease } = require("./mcp-power.js");
const mcpPowerLease = createMcpPowerLease(powerSaveBlocker);
const {
  parseArgs, resolveConfiguration,
} = require("../cli.js");
const { kimiPresetUpdates } = require("./settings-contract.js");
const { readSecret } = require("./secret-store.js");
const { canInspectCli, inspectCli, installCli } = require("./cli-installer.js");
const { createUpdateManager } = require("./update-manager.js");
const { lanUrls } = require("./network-access.js");
const { desktopConfigurationEnvironment } = require("./config-environment.js");
const { waitForSquirrelFirstRunExit } = require("./squirrel-first-run.js");
const { reopenAfterSilentUpdate } = require("./windows-update.js");
const { createWindowRecovery, keepsRunning } = require("./window-recovery.js");
const { attachWindowCloseGuard, destroyHelperWindows } = require("./window-close.js");
const { createServerProcess } = require("./server-process.js");
const { attachBrowserHost } = require("./browser-host.js");
const { createInitialWindowVisibility, watchInitialWindowLoad } = require("./startup-window.js");
const { initialDesktopUrl } = require("./startup-route.js");
const { normalizeThemePreference, resolveWindowColors, readWindowTheme, writeWindowTheme, titleBarOverlay, titleBarOptionsForPlatform } = require("./window-theme.js");
const { CONNECTION_STORE_VERSION } = require("../src/server/connection-store.js");
const { CanvasAgentProjectStore } = require("../src/server/canvas-agent/project-store.js");
const { isPictureWindow } = require("../src/server/project-lines/page-picture.js");
const { CANVAS_PAGE_SCALE, normalizeCanvasPageScale } = require("../public/page-scale.js");
const pkg = require("../package.json");
const DESKTOP_VERSION = pkg.config?.desktopVersion || pkg.version;

app.setName("PenEcho");

function handleSquirrelStartup() {
  if (process.platform !== "win32") return false;
  const event = process.argv.find(value => /^--squirrel-(?:install|updated|uninstall|obsolete)$/.test(value));
  if (!event) return false;
  if (event === "--squirrel-obsolete") {
    app.quit();
    return true;
  }
  const updateExe = path.resolve(path.dirname(process.execPath), "..", "Update.exe"),
    operation = event === "--squirrel-uninstall" ? "--removeShortcut" : "--createShortcut",
    pending = new Set(["shortcut"]),
    finish = part => { pending.delete(part); if (!pending.size) app.quit(); },
    timeout = setTimeout(() => finish("shortcut"), 1500);
  if (event === "--squirrel-install") {
    pending.add("reopen");
    reopenAfterSilentUpdate({ updateExe, exeName:path.basename(process.execPath), done:() => finish("reopen") });
  }
  try {
    const child = spawn(updateExe, [operation, path.basename(process.execPath)], { detached:true, stdio:"ignore", windowsHide:true });
    child.once("exit", () => {
      clearTimeout(timeout);
      finish("shortcut");
    });
    child.once("error", () => {
      clearTimeout(timeout);
      finish("shortcut");
    });
    child.unref();
  } catch {
    clearTimeout(timeout);
    finish("shortcut");
  }
  return true;
}

const squirrelStartup = handleSquirrelStartup(),
  gotLock = !squirrelStartup && app.requestSingleInstanceLock();
// A Squirrel event quits when its own work is done.
if (!gotLock && !squirrelStartup) app.quit();
const squirrelFirstRunComplete = waitForSquirrelFirstRunExit();

const ROOT = path.resolve(__dirname, ".."),
  CANVAS_PRELOAD = path.join(__dirname, "canvas-preload.js"),
  UPDATE_WINDOW_PRELOAD = path.join(__dirname, "update-window-preload.js"),
  UPDATE_WINDOW_HTML = path.join(__dirname, "update-window.html"),
  WINDOW_ICON = path.join(ROOT, "build", "icons", "penecho.png"),
  HELP_URL = "https://github.com/penecho/penecho#quick-start",
  ISSUE_URL = "https://github.com/penecho/penecho/issues",
  WEBSITE_URL = "https://penecho.ai";

let mainWindow = null,
  mainWindowVisibility = null,
  mainUrl = "",
  updateWindow = null,
  serverProcess = null,
  updateManager = null,
  currentLanUrls = [],
  networkAccessOff = false,
  desktopLanguage = "en",
  desktopMenuState = normalizeMenuState(null),
  windowThemePref = "system",
  cliOperations = new Set(),
  quitting = false,
  servicesShutDown = false,
  openAgain = false,
  pageFailed = false,
  endNow = false,
  desktopProjectStore = null;

function shutdownServices() {
  if (servicesShutDown) return;
  servicesShutDown = true;
  mcpPowerLease.release();
  updateManager?.stop();
  destroyHelperWindows(BrowserWindow.getAllWindows(), isPictureWindow);
  void serverProcess?.stop();
}

const credentialProtector = process.platform === "darwin" ? null : safeStorage;

function userPaths() {
  const stateDir = app.getPath("userData");
  return {
    stateDir,
    configFile:path.join(stateDir, "config.env"),
    secretFile:path.join(stateDir, "credentials.json"),
    privatePlugins:path.join(stateDir, "plugins", "private"),
  };
}

function canvasAgentDesktopProjectStore() {
  if(!desktopProjectStore)desktopProjectStore=new CanvasAgentProjectStore({stateDirectory:userPaths().stateDir});
  return desktopProjectStore;
}

function loadConfiguration() {
  const paths = userPaths(),
    args = parseArgs(["--config", paths.configFile]),
    configuration = resolveConfiguration(args, {
      cwd:paths.stateDir,
      home:app.getPath("home"),
      packageRoot:ROOT,
      env:desktopConfigurationEnvironment(process.env, paths.stateDir),
    }),
    unified = hasUnifiedConnections(paths.stateDir),
    apiKey = unified ? "" : readSecret(paths.secretFile, credentialProtector);
  configuration.stateDir = paths.stateDir;
  configuration.configFile = paths.configFile;
  if (!unified) Object.assign(configuration.env, kimiPresetUpdates(configuration));
  configuration.env.PENECHO_STATE_DIR = paths.stateDir;
  configuration.env.PENECHO_PRIVATE_PLUGIN_DIR = paths.privatePlugins;
  configuration.env.PENECHO_DESKTOP_APP = "true";
  if (!configuration.env.HOST) configuration.env.HOST = "0.0.0.0";
  if (!configuration.env.PORT) configuration.env.PORT = "3888";
  if (apiKey) configuration.env.AI_API_KEY = apiKey;
  return { configuration, paths, apiKey };
}

function hasUnifiedConnections(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, "connections.json"), "utf8")).version === CONNECTION_STORE_VERSION;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function secureWindowOptions(extra = {}) {
  const { webPreferences = {}, ...windowOptions } = extra;
  return {
    show:false,
    backgroundColor:"#f4f7fb",
    icon:WINDOW_ICON,
    ...windowOptions,
    webPreferences:{
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true,
      ...webPreferences,
    },
  };
}

function canOpenExternalWindowUrl(url, allowed) {
  if (/^https:\/\//i.test(url)) return true;
  return /^http:\/\//i.test(url) && Boolean(allowed(url));
}

function restrictNavigation(window, allowed) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternalWindowUrl(url, allowed)) void shell.openExternal(url);
    return { action:"deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (allowed(url)) return;
    event.preventDefault();
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
  });
}

async function revealMainWindow(window, focus = false) {
  await squirrelFirstRunComplete;
  if (!window || window.isDestroyed()) return;
  window.show();
  if (focus) window.focus();
}

function dispatchCanvasCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) return;
  if (menuCommandAllowed(command, desktopMenuState)) mainWindow.webContents.send("penecho:menu-command", command);
}

function editFromMenu(command, window) {
  if (window === mainWindow) dispatchCanvasCommand(command);
  else if (window && !window.isDestroyed()) window.webContents[command]();
}

function applyMainWindowTheme() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const colors = resolveWindowColors(windowThemePref, nativeTheme.shouldUseDarkColors);
  try { mainWindow.setBackgroundColor(colors.backgroundColor); } catch {}
  if (process.platform === "win32" && typeof mainWindow.setTitleBarOverlay === "function") {
    try { mainWindow.setTitleBarOverlay(titleBarOverlay(colors, mainWindow.webContents.getZoomFactor())); } catch {}
  }
}

function createMainWindow(url) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    void revealMainWindow(mainWindow, true);
    return mainWindow;
  }
  const stateDir = userPaths().stateDir;
  windowThemePref = readWindowTheme(stateDir);
  const colors = resolveWindowColors(windowThemePref, nativeTheme.shouldUseDarkColors);
  const launch = new URL(initialDesktopUrl(url, { stateDir, desktopLaunch:randomUUID() })), origin = launch.origin;
  mainUrl = url;
  mainWindow = new BrowserWindow(secureWindowOptions({
    width:1440,
    height:920,
    minWidth:820,
    minHeight:620,
    title:"PenEcho",
    backgroundColor:colors.backgroundColor,
    ...titleBarOptionsForPlatform(process.platform, colors),
    webPreferences:{ preload:CANVAS_PRELOAD, zoomFactor:CANVAS_PAGE_SCALE },
  }));
  desktopMenuState = normalizeMenuState({ page:menuPageFor(launch.href) });
  installMenu();
  restrictNavigation(mainWindow, candidate => {
    try { return new URL(candidate).origin === origin; } catch { return false; }
  });
  mainWindow.on("focus", installMenu);
  mainWindow.on("blur", installMenu);
  mainWindow.on("enter-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("penecho:fullscreen-change", true);
  });
  mainWindow.on("leave-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("penecho:fullscreen-change", false);
  });
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    // Let the existing renderer shortcut system retain text/modal guards and
    // user-customized bindings; menu clicks still use the command bridge.
    mainWindow.webContents.setIgnoreMenuShortcuts(canvasOwnsShortcut(input, desktopMenuState));
  });
  mainWindow.webContents.on("did-start-navigation", (_event, address, inPlace, isMainFrame) => {
    if (!isMainFrame || inPlace) return;
    desktopMenuState = normalizeMenuState({ page:menuPageFor(address) });
    installMenu();
  });
  const window = mainWindow, startedAt = Date.now();
  const startupEvent = (event, detail = {}) => {
    try {
      const directory = path.join(app.getPath("userData"), "logs"), file = path.join(directory, "desktop-startup.log");
      fs.mkdirSync(directory, { recursive:true });
      if (fs.existsSync(file) && fs.statSync(file).size > 65536) fs.truncateSync(file, 0);
      fs.appendFileSync(file, JSON.stringify({ time:new Date().toISOString(), pid:process.pid, windowId:window.id, elapsedMs:Date.now() - startedAt, event, ...detail }) + "\n");
    } catch { /* Diagnostics must never prevent opening the app. */ }
  };
  const startupOptions = { window, app, gate:squirrelFirstRunComplete, isQuitting:() => quitting, onEvent:startupEvent };
  mainWindowVisibility = createInitialWindowVisibility(startupOptions);
  const initialLoad = watchInitialWindowLoad({
    ...startupOptions,
    load:() => window.loadURL(launch.href),
    showDialog:(kind, signal) => dialog.showMessageBox(window, {
      type:kind === "failed" ? "error" : "warning",
      title:"PenEcho could not open",
      message:kind === "failed" ? "PenEcho could not load its window." : "PenEcho is taking longer than expected to open.",
      detail:kind === "failed" ? "Reload to try again, or close PenEcho and open it later." : "You can keep waiting or reload the window.",
      buttons:kind === "failed" ? ["Reload", "Close PenEcho"] : ["Keep Waiting", "Reload"],
      defaultId:0,
      cancelId:kind === "failed" ? 1 : 0,
      signal,
    }),
  });
  mainWindow.webContents.once("did-finish-load", updateDesktopUpdateUi);
  // A page asked for while the server was being started again is loaded again once it is there.
  mainWindow.webContents.on("did-fail-load", (_event, code, _description, _address, isMainFrame) => { if (isMainFrame && code !== -3) pageFailed = true; });
  mainWindow.webContents.on("did-navigate", () => { pageFailed = false; });
  mainWindow.webContents.on("render-process-gone",(_event,details)=>{mcpPowerLease.release();windowRecovery.pageGone(mainWindow,details);});
  mainWindow.webContents.on("did-start-navigation",(_event,_url,inPlace,isMainFrame)=>{if(isMainFrame&&!inPlace)mcpPowerLease.release();});
  attachWindowCloseGuard({
    window,
    app,
    getLanguage:() => desktopLanguage,
    isQuitting:() => quitting,
    resetQuitting:stayOpen,
    shouldForceUnload:() => endNow || updateManager?.getState()?.status === "installing",
    showDialog:options => dialog.showMessageBox(window, options),
    showDialogSync:options => dialog.showMessageBoxSync(window, options),
  });
  mainWindow.on("closed", () => {
    mcpPowerLease.release();mainWindow = null; mainWindowVisibility = null; desktopMenuState = normalizeMenuState(null); installMenu();
    if (process.platform !== "darwin" && !quitting && !keepsRunning(BrowserWindow.getAllWindows(), isPictureWindow)) {
      destroyHelperWindows(BrowserWindow.getAllWindows(), isPictureWindow);
      app.quit();
    }
  });
  initialLoad.start();
  return mainWindow;
}

const windowRecovery = createWindowRecovery({
  getWindow:() => mainWindow,
  openWindow:openMainWindow,
  reveal:window => void revealMainWindow(window, true),
});

function openMainWindow() {
  // Opened again while the server is still closing: PenEcho starts again once it has.
  if (servicesShutDown) { openAgain = true; return null; }
  return mainUrl && serverProcess?.listening() ? createMainWindow(mainUrl) : null;
}

// The server runs in a process of its own (server-process.js): however busy it is, the window scrolls and clicks at once.
function startServer(configuration) {
  let first = configuration;
  serverProcess = createServerProcess({
    // This process keeps the environment it was started with: keys among the settings stay out of it, and out of what it starts.
    settings:() => {
      const { env, configFile } = first || loadConfiguration().configuration;
      first = null;
      return { ...env, PENECHO_CONFIG_FILE:configFile };
    },
    inheritOutput:!app.isPackaged,
    logFile:path.join(app.getPath("userData"), "logs", "desktop-server.log"),
    attach:link => {
      attachBrowserHost(link);
      link.handle("network-access", ({ on }) => { networkAccessOff = !on; installMenu(); });
    },
    onUp:serverUp,
    // Stopped from outside (penecho stop, a signal): PenEcho ends with it, as it did when the two were one process.
    onEnded:() => app.quit(),
    onFailed:error => void serverFailed(error),
  });
  return serverProcess.start().then(serverUrl);
}

function serverUrl({ host, port }) {
  return `http://${!host || host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/`;
}

function serverUp(info) {
  networkAccessOff = !info.networkAccess;
  currentLanUrls = info.host === "0.0.0.0" ? lanUrls(info.port) : [];
  installMenu();
  if (!info.again || !mainWindow || mainWindow.isDestroyed()) return;
  // A server started again: the page stays as it is and asks it on, with the pass a page of this server is given.
  const url = serverUrl(info);
  if (pageFailed) { mainWindow.webContents.reload(); return; }
  if (url !== mainUrl) { mainUrl = url; void mainWindow.loadURL(initialDesktopUrl(url, { stateDir:userPaths().stateDir })); return; }
  void mainWindow.webContents.session.fetch(new URL("/projects.html", url).href, { credentials:"include", cache:"no-store" }).catch(() => {});
}

// PenEcho stays open after all ("Stay" when asked about unsaved changes): saving them needs the server.
function stayOpen() {
  quitting = false;
  if (!servicesShutDown && serverProcess && !serverProcess.running()) serverProcess.again().catch(error => void serverFailed(error));
}

async function serverFailed(error) {
  while (!quitting) {
    const options = {
      type:"error",
      title:"PenEcho stopped working",
      message:"PenEcho's local service stopped and could not be started again.",
      detail:error.message || String(error),
      buttons:["Try Again", "Quit PenEcho"],
      defaultId:0,
      cancelId:1,
    };
    const { response } = mainWindow && !mainWindow.isDestroyed() ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
    if (quitting) return;
    if (response === 1) { app.quit(); return; }
    try { await serverProcess.again(); return; }
    catch (failure) { error = failure; }
  }
}

function sendUpdateState(window, state) {
  if (!window || window.isDestroyed() || !state) return;
  window.webContents.send("penecho:update-state", { ...state, language:desktopLanguage });
}

function updateDesktopUpdateUi() {
  if (!updateManager) return;
  const state = updateManager.getState(),
    updateWindowVisible = Boolean(updateWindow && !updateWindow.isDestroyed() && updateWindow.isVisible());
  sendUpdateState(mainWindow, { ...state, windowOpen:updateWindowVisible });
  sendUpdateState(updateWindow, state);
}

function isPenEchoReleaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" &&
      url.pathname.startsWith("/penecho/penecho/releases/");
  } catch { return false; }
}

function showUpdateWindow() {
  if (!updateManager) return;
  if (updateWindow && !updateWindow.isDestroyed()) {
    void revealMainWindow(updateWindow, true).then(updateDesktopUpdateUi);
  } else {
    updateWindow = new BrowserWindow(secureWindowOptions({
      width:520,
      height:580,
      minWidth:400,
      minHeight:480,
      maxWidth:720,
      maxHeight:860,
      title:desktopLanguage === "zh" ? "PenEcho 更新" : "PenEcho Update",
      autoHideMenuBar:true,
      maximizable:false,
      fullscreenable:false,
      backgroundColor:"#ffffff",
      webPreferences:{ preload:UPDATE_WINDOW_PRELOAD },
    }));
    restrictNavigation(updateWindow, candidate => candidate === pathToFileURL(UPDATE_WINDOW_HTML).href);
    updateWindow.once("ready-to-show", () => void revealMainWindow(updateWindow, true).then(updateDesktopUpdateUi));
    updateWindow.webContents.once("did-finish-load", updateDesktopUpdateUi);
    updateWindow.on("closed", () => {
      updateWindow = null;
      updateDesktopUpdateUi();
      if (process.platform !== "darwin" && !quitting && !keepsRunning(BrowserWindow.getAllWindows(), isPictureWindow)) {
        destroyHelperWindows(BrowserWindow.getAllWindows(), isPictureWindow);
        app.quit();
      }
    });
    void updateWindow.loadFile(UPDATE_WINDOW_HTML);
  }
  const status = updateManager.getState().status;
  if (status === "installing") updateDesktopUpdateUi();
  else void updateManager.check(true);
}

// The Projects page and a Canvas each have their own menus; the page fills them in once it is ready.
function menuPageFor(address) {
  try { return new URL(address).pathname === "/projects.html" ? "projects" : "canvas"; } catch { return "canvas"; }
}
// Only a folder that exists is opened, in Finder or Explorer.
function openMenuFolder(folder) {
  try { if (folder && fs.statSync(folder).isDirectory()) void shell.openPath(folder); } catch { /* It was moved or removed; nothing to show. */ }
}

function installMenu() {
  const template = createMenuTemplate({
    platform:process.platform, language:desktopLanguage, state:desktopMenuState,
    canvasFocused:Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()),
    dispatch:dispatchCanvasCommand, edit:editFromMenu, checkUpdates:showUpdateWindow,
    // The same state the server keeps (Settings → Other devices): off, the menu says so and lists no address.
    openHelp:() => void shell.openExternal(HELP_URL), openIssue:() => void shell.openExternal(ISSUE_URL), openWebsite:() => void shell.openExternal(WEBSITE_URL), openFolder:openMenuFolder, lanUrls:networkAccessOff ? [] : currentLanUrls, networkOff:networkAccessOff,
    openLan:url => { clipboard.writeText(url); void shell.openExternal(url); },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const CANVAS_AGENT_CLIPBOARD_FILE_LIMIT = 32 * 1024 * 1024;
const CANVAS_AGENT_CLIPBOARD_FILE_COUNT_LIMIT = 5;

function clipboardUriPaths(value) {
  const paths=[];
  for(const rawLine of String(value||"").split(/[\r\n\0]+/)){
    const line=rawLine.trim();
    if(!line||line==="copy"||line==="cut"||line.startsWith("#"))continue;
    try{
      const url=new URL(line);
      if(url.protocol!=="file:")continue;
      paths.push(fileURLToPath(url));
    }catch{}
  }
  return paths;
}

function clipboardFilePaths() {
  const formats=new Set(clipboard.availableFormats()),paths=[];
  const add=value=>paths.push(...clipboardUriPaths(value));
  for(const format of ["public.file-url","text/uri-list","x-special/gnome-copied-files"]){
    if(!formats.has(format))continue;
    try{
      const buffer=clipboard.readBuffer(format);
      add(buffer.toString("utf8"));
      if(format==="public.file-url"&&process.platform==="darwin")add(buffer.toString("utf16le"));
    }catch{}
  }
  if(process.platform==="darwin"&&formats.has("NSFilenamesPboardType")){
    try{
      const value=clipboard.readBuffer("NSFilenamesPboardType").toString("utf8");
      for(const match of value.matchAll(/<string>([\s\S]*?)<\/string>/g)){
        const decoded=match[1].replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim();
        if(path.isAbsolute(decoded))paths.push(decoded);else add(decoded);
      }
    }catch{}
  }
  if(process.platform==="win32"){
    for(const [format,encoding] of [["FileNameW","utf16le"],["FileName","utf8"]]){
      if(!formats.has(format))continue;
      try{for(const candidate of clipboard.readBuffer(format).toString(encoding).split("\0"))if(path.isAbsolute(candidate.trim()))paths.push(candidate.trim());}catch{}
    }
    if(formats.has("CF_HDROP")){
      try{
        const buffer=clipboard.readBuffer("CF_HDROP"),offset=buffer.length>=20?buffer.readUInt32LE(0):buffer.length,wide=buffer.length>=20&&buffer.readUInt32LE(16)!==0;
        if(offset>=20&&offset<buffer.length)for(const candidate of buffer.subarray(offset).toString(wide?"utf16le":"utf8").split("\0"))if(path.isAbsolute(candidate.trim()))paths.push(candidate.trim());
      }catch{}
    }
  }
  return [...new Set(paths.filter(candidate=>typeof candidate==="string"&&candidate.length<=4096&&path.isAbsolute(candidate)))];
}

async function readCanvasClipboardFile() {
  let failureCode="";
  for(const selectedPath of clipboardFilePaths()){
    try{
      const canonical=await fs.promises.realpath(selectedPath),before=await fs.promises.lstat(canonical);
      if(!before.isFile()||before.isSymbolicLink())continue;
      if(before.size<1){failureCode="empty";continue;}
      if(before.size>CANVAS_AGENT_CLIPBOARD_FILE_LIMIT){failureCode="too_large";continue;}
      const data=await fs.promises.readFile(canonical),after=await fs.promises.lstat(canonical);
      if(!after.isFile()||after.isSymbolicLink()||after.size!==before.size||after.mtimeMs!==before.mtimeMs||data.length!==before.size)continue;
      return {ok:true,name:path.basename(canonical),size:data.length,lastModified:Math.trunc(after.mtimeMs),data:data.toString("base64")};
    }catch{}
  }
  return {ok:false,code:failureCode||"unreadable"};
}

async function readCanvasClipboardFiles() {
  const selectedPaths=clipboardFilePaths();
  if(selectedPaths.length>CANVAS_AGENT_CLIPBOARD_FILE_COUNT_LIMIT)return {ok:false,code:"too_many",count:selectedPaths.length};
  if(!selectedPaths.length)return {ok:false,code:"unreadable"};
  const files=[];
  for(const selectedPath of selectedPaths){
    try{
      const canonical=await fs.promises.realpath(selectedPath),before=await fs.promises.lstat(canonical);
      if(!before.isFile()||before.isSymbolicLink())return {ok:false,code:"unreadable"};
      if(before.size<1)return {ok:false,code:"empty"};
      if(before.size>CANVAS_AGENT_CLIPBOARD_FILE_LIMIT)return {ok:false,code:"too_large"};
      const data=await fs.promises.readFile(canonical),after=await fs.promises.lstat(canonical);
      if(!after.isFile()||after.isSymbolicLink()||after.size!==before.size||after.mtimeMs!==before.mtimeMs||data.length!==before.size)return {ok:false,code:"unreadable"};
      files.push({name:path.basename(canonical),size:data.length,lastModified:Math.trunc(after.mtimeMs),data:data.toString("base64")});
    }catch{return {ok:false,code:"unreadable"};}
  }
  return {ok:true,files};
}

function registerIpc() {
  const fromCanvas = event => Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents),
    fromUpdateWindow = event => Boolean(updateWindow && !updateWindow.isDestroyed() && event.sender === updateWindow.webContents),
    fromUpdateSurface = event => fromCanvas(event) || fromUpdateWindow(event);
  ipcMain.handle("penecho:startup-visible", event =>
    fromCanvas(event) && event.senderFrame === event.sender.mainFrame ? mainWindowVisibility?.whenShown ?? false : false);
  ipcMain.on("penecho:set-language", (event, language) => {
    if (!fromCanvas(event) || event.senderFrame !== event.sender.mainFrame || !["en", "zh"].includes(language)) return;
    if (desktopLanguage === language) return;
    desktopLanguage = language;
    installMenu();
    if (updateWindow && !updateWindow.isDestroyed()) updateWindow.setTitle(language === "zh" ? "PenEcho 更新" : "PenEcho Update");
    updateDesktopUpdateUi();
  });
  ipcMain.on("penecho:menu-state", (event, value) => {
    if (!fromCanvas(event) || event.senderFrame !== event.sender.mainFrame) return;
    const obj = value && typeof value === "object" ? value : {};
    const page = obj.page === "projects" || obj.page === "canvas" ? obj.page : menuPageFor(event.sender.getURL());
    desktopMenuState = normalizeMenuState({ ...obj, page });
    installMenu();
  });
  ipcMain.on("penecho:set-theme", (event, preference) => {
    if (!fromCanvas(event) || event.senderFrame !== event.sender.mainFrame) return;
    windowThemePref = writeWindowTheme(userPaths().stateDir, normalizeThemePreference(preference));
    applyMainWindowTheme();
  });
  ipcMain.handle("penecho:is-fullscreen", event =>
    Boolean(fromCanvas(event) && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()));
  ipcMain.handle("penecho:menu-native-edit", (event, command) => {
    if (!fromCanvas(event) || event.senderFrame !== event.sender.mainFrame || !["undo", "redo"].includes(command)) return false;
    event.sender[command]();
    return true;
  });
  ipcMain.handle("penecho:mcp-keep-awake",(event,enabled)=>{
    if(!fromCanvas(event)||event.senderFrame!==event.sender.mainFrame)return false;
    return mcpPowerLease.set(enabled===true,event.sender);
  });
  ipcMain.on("penecho:has-clipboard-file", event => { event.returnValue=fromCanvas(event)&&clipboardFilePaths().length>0; });
  ipcMain.handle("penecho:read-clipboard-file", event => fromCanvas(event)?readCanvasClipboardFile():{ok:false});
  ipcMain.handle("penecho:read-clipboard-files", event => fromCanvas(event)?readCanvasClipboardFiles():{ok:false});
  ipcMain.handle("penecho:open-project-file", async (event,projectId) => {
    if(!fromCanvas(event))return {ok:false};
    try{
      const project=await canvasAgentDesktopProjectStore().resolve(String(projectId||""));
      if(project.kind!=="file")return {ok:false,code:"unavailable"};
      const error=await shell.openPath(project.path);
      return error?{ok:false,code:"open_failed"}:{ok:true};
    }catch{return {ok:false,code:"unavailable"};}
  });
  ipcMain.handle("penecho:pick-project-file", async event => {
    if (!fromCanvas(event)) return { canceled:true };
    const result = await dialog.showOpenDialog(mainWindow, {
      title:"Choose a local file",
      buttonLabel:"Choose File",
      properties:["openFile"],
      filters:[
        {
          name:"Readable files",
          extensions:[
            "pdf", "docx", "xlsx", "csv", "pptx", "db", "sqlite", "sqlite3",
            "png", "jpg", "jpeg", "webp", "gif",
            "txt", "text", "md", "markdown", "mdx", "rst", "adoc", "log",
            "json", "jsonc", "jsonl", "ndjson", "yaml", "yml", "toml", "ini", "cfg", "conf", "config", "properties", "env", "xml", "xsd", "svg",
            "html", "htm", "css", "scss", "sass", "less", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
            "py", "pyi", "rb", "php", "java", "kt", "kts", "go", "rs", "c", "h", "cc", "cpp", "cxx", "hpp", "cs", "scala", "swift",
            "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "graphql", "gql", "proto", "vue", "svelte", "astro", "tex", "lock", "diff", "patch",
          ],
        },
        { name:"Documents", extensions:["pdf", "docx", "xlsx", "csv", "pptx"] },
        { name:"SQLite databases", extensions:["db", "sqlite", "sqlite3"] },
        { name:"Images", extensions:["png", "jpg", "jpeg", "webp", "gif"] },
        {
          name:"Text, source, and configuration",
          extensions:[
            "txt", "text", "md", "markdown", "mdx", "rst", "adoc", "log",
            "json", "jsonc", "jsonl", "ndjson", "yaml", "yml", "toml", "ini", "cfg", "conf", "config", "properties", "env", "xml", "xsd", "svg",
            "html", "htm", "css", "scss", "sass", "less", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
            "py", "pyi", "rb", "php", "java", "kt", "kts", "go", "rs", "c", "h", "cc", "cpp", "cxx", "hpp", "cs", "scala", "swift",
            "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "graphql", "gql", "proto", "vue", "svelte", "astro", "tex", "lock", "diff", "patch",
          ],
        },
      ],
    });
    const selectedPath = result.filePaths[0] || "";
    if (result.canceled || !selectedPath) return { canceled:true };
    return { canceled:false, path:selectedPath, pickerToken:await serverProcess.request("picker-grant", { selectedPath, kind:"file" }) };
  });
  ipcMain.handle("penecho:get-update-state", event => fromUpdateSurface(event) && updateManager ? { ...updateManager.getState(), language:desktopLanguage } : null);
  ipcMain.handle("penecho:update-show-window", event => {
    if (!fromCanvas(event) || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
    showUpdateWindow();
    return true;
  });
  ipcMain.handle("penecho:update-check", event => fromUpdateSurface(event) ? updateManager?.check(true) : false);
  ipcMain.handle("penecho:update-download", event => fromUpdateSurface(event) ? updateManager?.download() : false);
  ipcMain.handle("penecho:update-dismiss", event => fromCanvas(event) ? updateManager?.dismiss() : false);
  ipcMain.handle("penecho:update-install", event => fromUpdateSurface(event) ? updateManager?.install() : false);
  ipcMain.handle("penecho:update-open-release-page", async event => {
    if (!fromUpdateWindow(event)) return false;
    const url = updateManager?.getState().releaseUrl || "";
    if (!isPenEchoReleaseUrl(url)) return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle("penecho:update-window-close", event => {
    if (!fromUpdateWindow(event)) return false;
    updateWindow.close();
    return true;
  });
  ipcMain.handle("penecho:set-page-scale", (event, value) => {
    if (!fromCanvas(event) || event.senderFrame !== event.sender.mainFrame) return { ok:false };
    const scale = normalizeCanvasPageScale(value);
    mainWindow.webContents.setZoomFactor(scale);
    applyMainWindowTheme();
    return { ok:true, scale };
  });
  ipcMain.handle("penecho:copy-text", (_event, input) => {
    const text = String(input ?? "");
    if (!text || text.length > 4096 || /[\r\n\0]/.test(text)) return { ok:false };
    clipboard.writeText(text);
    return { ok:true };
  });
  ipcMain.handle("penecho:install-cli", async (event, provider) => {
    if (!fromCanvas(event)) return { ok:false, error:"CLI installation is available only in the PenEcho desktop application." };
    const key = String(provider || "").trim();
    if (cliOperations.has(key)) return { ok:false, error:"This CLI setup operation is already running." };
    cliOperations.add(key);
    try {
      const paths = userPaths(), loaded = loadConfiguration(), result = await installCli(provider, {
        stateDir:paths.stateDir,
        home:app.getPath("home"),
        env:loaded.configuration.env,
        fetchImpl:(url, options) => net.fetch(url, options),
      });
      const status = canInspectCli(provider)
        ? await inspectCli(provider, {
          stateDir:paths.stateDir,
          home:app.getPath("home"),
          env:loaded.configuration.env,
          configuredPath:result.executable,
        })
        : {
          provider,
          label:result.label,
          state:"ready",
          version:result.version || "",
          executable:result.executable || "",
        };
      return { ok:true, ...result, status };
    } catch (error) {
      return { ok:false, error:error.message || "Automatic installation failed." };
    } finally { cliOperations.delete(key); }
  });
  ipcMain.handle("penecho:open-help", () => shell.openExternal(HELP_URL));
}

async function bootstrap() {
  updateManager = createUpdateManager({
    app,
    currentVersion:DESKTOP_VERSION,
    fetchImpl:(url, options) => net.fetch(url, options),
    onStateChange:updateDesktopUpdateUi,
  });
  installMenu();
  registerIpc();
  updateManager.start();
  if (typeof nativeTheme !== "undefined" && typeof nativeTheme?.on === "function") {
    nativeTheme.on("updated", () => {
      if (windowThemePref === "system") applyMainWindowTheme();
    });
  }
  const loaded = loadConfiguration();
  try {
    const url = await startServer(loaded.configuration);
    if (quitting) return;
    createMainWindow(url);
  } catch (error) {
    if (quitting) return;
    await dialog.showMessageBox({
      type:"error",
      title:"PenEcho could not start",
      message:"PenEcho could not start its local canvas service.",
      detail:error.message || String(error),
    });
    app.quit();
  }
}

if (gotLock) {
  app.on("second-instance", () => { windowRecovery.reopen(); });
  app.whenReady().then(() => {
    // Asked by the system (kill, Ctrl-C), PenEcho ends without asking about unsaved changes. Electron sets its own answer before it is ready.
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { endNow = true; app.quit(); });
    return bootstrap();
  }).catch(error => {
    void dialog.showErrorBox("PenEcho startup failed", error.message || String(error));
    app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().some(window => !isPictureWindow(window))) return;
    openMainWindow();
  });
  app.on("before-quit", () => {
    quitting = true;
    if (!BrowserWindow.getAllWindows().some(window => !window.isDestroyed() && !isPictureWindow(window))) {
      shutdownServices();
    }
  });
  // The app stays, with no window, until the server has closed, so one opened right after finds the port free and nothing half written.
  app.on("will-quit", event => {
    quitting = true;
    shutdownServices();
    if (!serverProcess?.running()) {
      if (openAgain && updateManager?.getState().status !== "installing") app.relaunch();
      return;
    }
    event.preventDefault();
    void serverProcess.stop().then(() => app.quit());
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !quitting) app.quit();
  });
}
