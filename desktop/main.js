"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { fileURLToPath, pathToFileURL } = require("node:url");
const {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, safeStorage, shell, powerSaveBlocker,
} = require("electron");
const { createMcpPowerLease } = require("./mcp-power.js");
const mcpPowerLease = createMcpPowerLease(powerSaveBlocker);
const {
  parseArgs, resolveConfiguration,
} = require("../cli.js");
const { kimiPresetUpdates } = require("./settings-contract.js");
const { readSecret } = require("./secret-store.js");
const { inspectCli, installCli } = require("./cli-installer.js");
const { createUpdateManager } = require("./update-manager.js");
const { lanUrls } = require("./network-access.js");
const { desktopConfigurationEnvironment } = require("./config-environment.js");
const { waitForSquirrelFirstRunExit } = require("./squirrel-first-run.js");
const { CONNECTION_STORE_VERSION } = require("../src/server/connection-store.js");
const { issueNativePickerGrant } = require("../src/server/canvas-agent/native-picker-grants.js");
const { CanvasAgentProjectStore } = require("../src/server/canvas-agent/project-store.js");
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
    timeout = setTimeout(() => app.quit(), 1500);
  try {
    const child = spawn(updateExe, [operation, path.basename(process.execPath)], { detached:true, stdio:"ignore", windowsHide:true });
    child.once("exit", () => {
      clearTimeout(timeout);
      app.quit();
    });
    child.once("error", () => {
      clearTimeout(timeout);
      app.quit();
    });
    child.unref();
  } catch {
    clearTimeout(timeout);
    app.quit();
  }
  return true;
}

const squirrelStartup = handleSquirrelStartup(),
  gotLock = !squirrelStartup && app.requestSingleInstanceLock();
if (!gotLock) app.quit();
const squirrelFirstRunComplete = waitForSquirrelFirstRunExit();

const ROOT = path.resolve(__dirname, ".."),
  CANVAS_PRELOAD = path.join(__dirname, "canvas-preload.js"),
  UPDATE_WINDOW_PRELOAD = path.join(__dirname, "update-window-preload.js"),
  UPDATE_WINDOW_HTML = path.join(__dirname, "update-window.html"),
  WINDOW_ICON = path.join(ROOT, "build", "icons", "penecho.png"),
  HELP_URL = "https://github.com/penecho/penecho#quick-start";

let mainWindow = null,
  updateWindow = null,
  server = null,
  updateManager = null,
  currentLanUrls = [],
  cliOperation = null,
  quitting = false,
  desktopProjectStore = null;

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

function applyEnvironment(configuration) {
  for (const [key, value] of Object.entries(configuration.env)) {
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  const paths = userPaths();
  process.env.PENECHO_STATE_DIR = paths.stateDir;
  process.env.PENECHO_PRIVATE_PLUGIN_DIR = paths.privatePlugins;
  process.env.HOST ||= "0.0.0.0";
  process.env.PORT ||= "3888";
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

function restrictNavigation(window, allowed) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
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

function showSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!server?.listening) return;
    const address = server.address(), port = typeof address === "object" && address ? address.port : 3888,
      host = process.env.HOST === "0.0.0.0" ? "127.0.0.1" : process.env.HOST || "127.0.0.1";
    const window = createMainWindow(`http://${host}:${port}/`);
    window.webContents.once("did-finish-load", () => window.webContents.send("penecho:show-connections"));
    return;
  }
  void revealMainWindow(mainWindow, true).then(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("penecho:show-connections");
  });
}

function createMainWindow(url) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    void revealMainWindow(mainWindow, true);
    return mainWindow;
  }
  const origin = new URL(url).origin;
  mainWindow = new BrowserWindow(secureWindowOptions({
    width:1440,
    height:920,
    minWidth:820,
    minHeight:620,
    title:"PenEcho",
    webPreferences:{ preload:CANVAS_PRELOAD, zoomFactor:CANVAS_PAGE_SCALE },
  }));
  restrictNavigation(mainWindow, candidate => {
    try { return new URL(candidate).origin === origin; } catch { return false; }
  });
  mainWindow.once("ready-to-show", () => void revealMainWindow(mainWindow));
  mainWindow.webContents.once("did-finish-load", updateDesktopUpdateUi);
  mainWindow.webContents.on("render-process-gone",()=>mcpPowerLease.release());
  mainWindow.webContents.on("did-start-navigation",(_event,_url,inPlace,isMainFrame)=>{if(isMainFrame&&!inPlace)mcpPowerLease.release();});
  mainWindow.on("closed", () => { mcpPowerLease.release();mainWindow = null; });
  void mainWindow.loadURL(url);
  return mainWindow;
}

async function showLanAccessNotice(window) {
  await squirrelFirstRunComplete;
  if (!currentLanUrls.length || !window || window.isDestroyed()) return;
  const result = await dialog.showMessageBox(window, {
    type:"info",
    title:"PenEcho on your local network",
    message:"PenEcho is available to devices on your local network.",
    detail:`Open this address on another device:\n\n${currentLanUrls.join("\n")}\n\nKeep PenEcho open, and use this only on a trusted network.`,
    buttons:["Copy address", "Done"],
    defaultId:1,
    cancelId:1,
  });
  if (result.response === 0) clipboard.writeText(currentLanUrls[0]);
}

function startServer(configuration) {
  configuration.env.PENECHO_CONFIG_FILE = configuration.configFile;
  applyEnvironment(configuration);
  return new Promise((resolve, reject) => {
    let settled = false;
    const complete = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const succeed = complete(() => {
      const address = server.address(), port = typeof address === "object" && address ? address.port : Number(process.env.PORT),
        host = process.env.HOST === "0.0.0.0" ? "127.0.0.1" : process.env.HOST;
      resolve(`http://${host}:${port}/`);
    });
    const fail = complete(reject);
    const timer = setTimeout(() => fail(new Error("PenEcho server did not become ready.")), 10000);
    try {
      server = require("../server.js");
      server.once("error", fail);
      if (server.listening) succeed();
      else server.once("listening", succeed);
    } catch (error) { fail(error); }
  });
}

function sendUpdateState(window, state) {
  if (!window || window.isDestroyed() || !state) return;
  window.webContents.send("penecho:update-state", state);
}

function updateDesktopUpdateUi() {
  if (!updateManager) return;
  const state = updateManager.getState(),
    updateWindowVisible = Boolean(updateWindow && !updateWindow.isDestroyed() && updateWindow.isVisible());
  sendUpdateState(mainWindow, { ...state, visible:state.visible && !updateWindowVisible });
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
      width:440,
      height:330,
      minWidth:400,
      minHeight:300,
      maxWidth:560,
      maxHeight:440,
      title:"PenEcho Update",
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
    });
    void updateWindow.loadFile(UPDATE_WINDOW_HTML);
  }
  const status = updateManager.getState().status;
  if (status === "installing") updateDesktopUpdateUi();
  else void updateManager.check(true);
}

function installMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{
      label:"PenEcho",
      submenu:[
        { role:"about" },
        { type:"separator" },
        { label:"Settings…", accelerator:"CmdOrCtrl+,", click:showSettings },
        { type:"separator" },
        { role:"hide" }, { role:"hideOthers" }, { role:"unhide" },
        { type:"separator" },
        { role:"quit" },
      ],
    }] : []),
    {
      label:"File",
      submenu:[
        ...(process.platform !== "darwin" ? [{ label:"Settings…", accelerator:"Ctrl+,", click:showSettings }, { type:"separator" }] : []),
        { role:process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    { label:"Edit", submenu:[{ role:"undo" }, { role:"redo" }, { type:"separator" }, { role:"cut" }, { role:"copy" }, { role:"paste" }, { role:"selectAll" }] },
    { label:"View", submenu:[{ role:"reload" }, { role:"togglefullscreen" }] },
    { label:"Window", submenu:[{ role:"minimize" }, { role:"zoom" }] },
    { label:"Local Access", submenu:currentLanUrls.length
      ? currentLanUrls.map(url => ({ label:url, click:() => { clipboard.writeText(url); void shell.openExternal(url); } }))
      : [{ label:"Enable local network access in Settings", enabled:false }],
    },
    { label:"Help", submenu:[
      { label:"Getting started", click:() => void shell.openExternal(HELP_URL) },
      { type:"separator" },
      { label:"Check for Updates…", click:showUpdateWindow },
    ] },
  ];
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
    return { canceled:false, path:selectedPath, pickerToken:issueNativePickerGrant({ selectedPath, kind:"file" }) };
  });
  ipcMain.handle("penecho:get-update-state", event => fromUpdateSurface(event) ? updateManager?.getState() : null);
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
    if (!fromCanvas(event) || !mainWindow || mainWindow.isDestroyed()) return { ok:false };
    const scale = normalizeCanvasPageScale(value);
    mainWindow.webContents.setZoomFactor(scale);
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
    if (cliOperation) return { ok:false, error:"Another CLI setup operation is already running." };
    cliOperation = `install:${provider}`;
    try {
      const paths = userPaths(), result = await installCli(provider, {
        stateDir:paths.stateDir,
        home:app.getPath("home"),
        fetchImpl:(url, options) => net.fetch(url, options),
      });
      const loaded = loadConfiguration(), status = await inspectCli(provider, {
        stateDir:paths.stateDir,
        home:app.getPath("home"),
        env:loaded.configuration.env,
        configuredPath:result.executable,
      });
      return { ok:true, ...result, status };
    } catch (error) {
      return { ok:false, error:error.message || "Automatic installation failed." };
    } finally { cliOperation = null; }
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
  const loaded = loadConfiguration();
  try {
    const url = await startServer(loaded.configuration);
    const address = server.address(), port = typeof address === "object" && address ? address.port : Number(process.env.PORT);
    currentLanUrls = process.env.HOST === "0.0.0.0" ? lanUrls(port) : [];
    installMenu();
    const window = createMainWindow(url);
    if (currentLanUrls.length) window.webContents.once("did-finish-load", () => void showLanAccessNotice(window));
  } catch (error) {
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
  app.on("second-instance", () => {
    const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (!window) return;
    if (window.isMinimized()) window.restore();
    void revealMainWindow(window, true);
  });
  app.whenReady().then(bootstrap).catch(error => {
    void dialog.showErrorBox("PenEcho startup failed", error.message || String(error));
    app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length) return;
    if (server?.listening) {
      const address = server.address(), port = typeof address === "object" && address ? address.port : 3888,
        host = process.env.HOST === "0.0.0.0" ? "127.0.0.1" : process.env.HOST || "127.0.0.1";
      createMainWindow(`http://${host}:${port}/`);
    }
  });
  app.on("before-quit", () => {
    quitting = true;
    mcpPowerLease.release();
    updateManager?.stop();
    if (server?.listening) server.close();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !quitting) app.quit();
  });
}
