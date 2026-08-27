"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { fileURLToPath, pathToFileURL } = require("node:url");
const {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, safeStorage, shell,
} = require("electron");
const {
  apiConfigurationIssues, parseArgs, resolveConfiguration, saveConfiguration, testConfiguredProvider,
} = require("../cli.js");
const { kimiPresetUpdates, normalizeSettings, publicSettings } = require("./settings-contract.js");
const { readSecret, writeSecret } = require("./secret-store.js");
const { inspectCli, installCli, managedCliPath } = require("./cli-installer.js");
const { createUpdateManager } = require("./update-manager.js");
const { lanHosts, lanUrls } = require("./network-access.js");
const { desktopConfigurationEnvironment } = require("./config-environment.js");
const { issueNativePickerGrant } = require("../src/server/canvas-agent/native-picker-grants.js");
const { CanvasAgentProjectStore } = require("../src/server/canvas-agent/project-store.js");
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

const ROOT = path.resolve(__dirname, ".."),
  SETTINGS_FILE = path.join(__dirname, "settings", "index.html"),
  PRELOAD = path.join(__dirname, "preload.js"),
  CANVAS_PRELOAD = path.join(__dirname, "canvas-preload.js"),
  WINDOW_ICON = path.join(ROOT, "build", "icons", "penecho.png"),
  HELP_URL = "https://github.com/penecho/penecho#quick-start",
  SETTINGS_TEST_TIMEOUT_MS = 30_000;

let mainWindow = null,
  settingsWindow = null,
  server = null,
  currentConfiguration = null,
  updateManager = null,
  currentLanUrls = [],
  settingsReadyToLaunch = false,
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
    apiKey = readSecret(paths.secretFile, credentialProtector);
  configuration.stateDir = paths.stateDir;
  configuration.configFile = paths.configFile;
  Object.assign(configuration.env, kimiPresetUpdates(configuration));
  configuration.env.PENECHO_STATE_DIR = paths.stateDir;
  configuration.env.PENECHO_PRIVATE_PLUGIN_DIR = paths.privatePlugins;
  configuration.env.PENECHO_DESKTOP_APP = "true";
  if (!configuration.env.HOST) configuration.env.HOST = "0.0.0.0";
  if (!configuration.env.PORT) configuration.env.PORT = "3888";
  if (apiKey) configuration.env.AI_API_KEY = apiKey;
  currentConfiguration = configuration;
  return { configuration, paths, apiKey };
}

function configurationIsReady(loaded) {
  const { configuration, apiKey } = loaded;
  if (!configuration.configExists || !configuration.provider) return false;
  if (configuration.provider === "api") {
    if (apiKey) configuration.env.AI_API_KEY = apiKey;
    return apiConfigurationIssues(configuration.env).length === 0;
  }
  return ["kimi-cli", "codex-cli", "claude-cli"].includes(configuration.provider);
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

function showSettings() {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (parent && settingsWindow.getParentWindow() !== parent) settingsWindow.setParentWindow(parent);
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }
  settingsReadyToLaunch = false;
  settingsWindow = new BrowserWindow(secureWindowOptions({
    ...(parent ? { parent } : {}),
    width:1120,
    height:780,
    minWidth:920,
    minHeight:680,
    title:"PenEcho Setup",
    autoHideMenuBar:true,
    webPreferences:{ preload:PRELOAD },
  }));
  const window = settingsWindow, reveal = () => {
    if (window.isDestroyed()) return;
    window.show();
    window.focus();
  };
  restrictNavigation(window, url => url === pathToFileURL(SETTINGS_FILE).href);
  window.once("ready-to-show", reveal);
  window.on("closed", () => { if (settingsWindow === window) settingsWindow = null; });
  void window.loadFile(SETTINGS_FILE).then(reveal);
  return window;
}

function createMainWindow(url) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  const origin = new URL(url).origin;
  mainWindow = new BrowserWindow(secureWindowOptions({
    width:1440,
    height:920,
    minWidth:820,
    minHeight:620,
    title:"PenEcho",
    webPreferences:{ preload:CANVAS_PRELOAD },
  }));
  restrictNavigation(mainWindow, candidate => {
    try { return new URL(candidate).origin === origin; } catch { return false; }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.once("did-finish-load", () => sendUpdateState(mainWindow));
  mainWindow.on("closed", () => { mainWindow = null; });
  void mainWindow.loadURL(url);
  return mainWindow;
}

async function showLanAccessNotice(window) {
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

function sendUpdateState(window) {
  if (!window || window.isDestroyed() || !updateManager) return;
  window.webContents.send("penecho:update-state", updateManager.getState());
}

function updateDesktopUpdateUi() {
  sendUpdateState(mainWindow);
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
      { label:"Check for Updates…", click:() => void updateManager?.check(true) },
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
  const fromCanvas = event => Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
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
  ipcMain.handle("penecho:get-update-state", event => fromCanvas(event) ? updateManager?.getState() : null);
  ipcMain.handle("penecho:update-check", event => fromCanvas(event) ? updateManager?.check(true) : false);
  ipcMain.handle("penecho:update-download", event => fromCanvas(event) ? updateManager?.download() : false);
  ipcMain.handle("penecho:update-dismiss", event => fromCanvas(event) ? updateManager?.dismiss() : false);
  ipcMain.handle("penecho:update-install", event => fromCanvas(event) ? updateManager?.install() : false);
  ipcMain.handle("penecho:get-settings", () => {
    const loaded = loadConfiguration();
    const settings = publicSettings(loaded.configuration, { version:DESKTOP_VERSION, hasSavedApiKey:Boolean(loaded.apiKey) }),
      options = { stateDir:loaded.paths.stateDir, home:app.getPath("home") },
      kimi = managedCliPath("kimi-cli", options),
      codex = managedCliPath("codex-cli", options),
      claude = managedCliPath("claude-cli", options);
    if (!settings.kimiCliPath && fs.existsSync(kimi)) settings.kimiCliPath = kimi;
    if (!settings.codexPath && fs.existsSync(codex)) settings.codexPath = codex;
    if (!settings.claudePath && fs.existsSync(claude)) settings.claudePath = claude;
    settings.lanHosts = lanHosts();
    return settings;
  });
  ipcMain.handle("penecho:copy-text", (_event, input) => {
    const text = String(input ?? "");
    if (!text || text.length > 4096 || /[\r\n\0]/.test(text)) return { ok:false };
    clipboard.writeText(text);
    return { ok:true };
  });
  ipcMain.handle("penecho:install-cli", async (event, provider) => {
    const fromSetup = Boolean(settingsWindow && !settingsWindow.isDestroyed() && event.sender === settingsWindow.webContents);
    if (!fromCanvas(event) && !fromSetup) return { ok:false, error:"CLI installation is available only in the PenEcho desktop application." };
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
  ipcMain.handle("penecho:save-and-test", async (_event, input) => {
    try {
      const loaded = loadConfiguration(), normalized = normalizeSettings(input, { hasSavedApiKey:Boolean(loaded.apiKey) }),
        apiKey = normalized.apiKey || loaded.apiKey;
      if (["api", "kimi"].includes(normalized.provider) && normalized.apiKey) writeSecret(loaded.paths.secretFile, normalized.apiKey, credentialProtector);
      saveConfiguration(loaded.configuration, normalized.updates);
      loaded.configuration.env.PENECHO_STATE_DIR = loaded.paths.stateDir;
      loaded.configuration.env.PENECHO_PRIVATE_PLUGIN_DIR = loaded.paths.privatePlugins;
      if (apiKey) loaded.configuration.env.AI_API_KEY = apiKey;
      currentConfiguration = loaded.configuration;
      let diagnostic;
      try {
        let timer;
        diagnostic = await Promise.race([
          testConfiguredProvider(loaded.configuration, { timeoutMs:SETTINGS_TEST_TIMEOUT_MS }),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error("Connection test timed out after 30 seconds.");
              error.code = "PENECHO_SETTINGS_TEST_TIMEOUT";
              reject(error);
            }, SETTINGS_TEST_TIMEOUT_MS);
            timer.unref?.();
          }),
        ]).finally(() => clearTimeout(timer));
      } catch (error) {
        settingsReadyToLaunch = true;
        return {
          ok:false,
          saved:true,
          timedOut:["PENECHO_SETTINGS_TEST_TIMEOUT", "PENECHO_CONNECTION_TEST_TIMEOUT"].includes(error.code),
          error:error.message || "Connection test failed.",
        };
      }
      settingsReadyToLaunch = true;
      return { ok:true, saved:true, message:diagnostic };
    } catch (error) {
      settingsReadyToLaunch = false;
      return { ok:false, saved:false, error:error.message || "Unable to save settings." };
    }
  });
  ipcMain.handle("penecho:launch", () => {
    if (!settingsReadyToLaunch) return { ok:false, error:"Save valid settings before launching." };
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 250);
    return { ok:true };
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
  if (!configurationIsReady(loaded)) {
    showSettings();
    return;
  }
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
    showSettings();
  }
}

if (gotLock) {
  app.on("second-instance", () => {
    const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : settingsWindow;
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
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
    } else showSettings();
  });
  app.on("before-quit", () => {
    quitting = true;
    updateManager?.stop();
    if (server?.listening) server.close();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !quitting) app.quit();
  });
}
