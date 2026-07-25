"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const {
  app, autoUpdater, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, safeStorage, shell,
} = require("electron");
const {
  apiConfigurationIssues, parseArgs, resolveConfiguration, saveConfiguration, testConfiguredProvider,
} = require("../cli.js");
const { normalizeSettings, publicSettings } = require("./settings-contract.js");
const { readSecret, writeSecret } = require("./secret-store.js");
const { installCli, managedCliPath } = require("./cli-installer.js");
const { createUpdateManager } = require("./update-manager.js");
const { lanHosts, lanUrls } = require("./network-access.js");
const { desktopConfigurationEnvironment } = require("./config-environment.js");
const pkg = require("../package.json");

app.setName("PenEcho");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const ROOT = path.resolve(__dirname, ".."),
  SETTINGS_FILE = path.join(__dirname, "settings", "index.html"),
  PRELOAD = path.join(__dirname, "preload.js"),
  WINDOW_ICON = path.join(ROOT, "build", "icons", "penecho.png"),
  HELP_URL = "https://github.com/penecho/penecho#quick-start";

let mainWindow = null,
  settingsWindow = null,
  server = null,
  currentConfiguration = null,
  updateManager = null,
  currentLanUrls = [],
  settingsReadyToLaunch = false,
  cliOperation = null,
  quitting = false;

function userPaths() {
  const stateDir = app.getPath("userData");
  return {
    stateDir,
    configFile:path.join(stateDir, "config.env"),
    secretFile:path.join(stateDir, "credentials.json"),
    privatePlugins:path.join(stateDir, "plugins", "private"),
  };
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
    apiKey = readSecret(paths.secretFile, safeStorage);
  configuration.stateDir = paths.stateDir;
  configuration.configFile = paths.configFile;
  configuration.env.PENECHO_STATE_DIR = paths.stateDir;
  configuration.env.PENECHO_PRIVATE_PLUGIN_DIR = paths.privatePlugins;
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
  return ["codex-cli", "claude-cli"].includes(configuration.provider);
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
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }
  settingsReadyToLaunch = false;
  settingsWindow = new BrowserWindow(secureWindowOptions({
    width:1120,
    height:780,
    minWidth:920,
    minHeight:680,
    title:"PenEcho Setup",
    autoHideMenuBar:true,
    webPreferences:{ preload:PRELOAD },
  }));
  restrictNavigation(settingsWindow, url => url === pathToFileURL(SETTINGS_FILE).href);
  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.on("closed", () => { settingsWindow = null; });
  void settingsWindow.loadFile(SETTINGS_FILE);
  return settingsWindow;
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
  }));
  restrictNavigation(mainWindow, candidate => {
    try { return new URL(candidate).origin === origin; } catch { return false; }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
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

function registerIpc() {
  ipcMain.handle("penecho:get-settings", () => {
    const loaded = loadConfiguration();
    const settings = publicSettings(loaded.configuration, { version:pkg.version, hasSavedApiKey:Boolean(loaded.apiKey) }),
      options = { stateDir:loaded.paths.stateDir, home:app.getPath("home") },
      codex = managedCliPath("codex-cli", options), claude = managedCliPath("claude-cli", options);
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
  ipcMain.handle("penecho:install-cli", async (_event, provider) => {
    if (cliOperation) return { ok:false, error:"Another CLI setup operation is already running." };
    cliOperation = `install:${provider}`;
    try {
      const paths = userPaths(), result = await installCli(provider, {
        stateDir:paths.stateDir,
        home:app.getPath("home"),
        fetchImpl:(url, options) => net.fetch(url, options),
      });
      return { ok:true, ...result };
    } catch (error) {
      return { ok:false, error:error.message || "Automatic installation failed." };
    } finally { cliOperation = null; }
  });
  ipcMain.handle("penecho:save-and-test", async (_event, input) => {
    try {
      const loaded = loadConfiguration(), normalized = normalizeSettings(input, { hasSavedApiKey:Boolean(loaded.apiKey) }),
        apiKey = normalized.apiKey || loaded.apiKey;
      if (["api", "kimi"].includes(normalized.provider) && normalized.apiKey) writeSecret(loaded.paths.secretFile, normalized.apiKey, safeStorage);
      saveConfiguration(loaded.configuration, normalized.updates);
      loaded.configuration.env.PENECHO_STATE_DIR = loaded.paths.stateDir;
      loaded.configuration.env.PENECHO_PRIVATE_PLUGIN_DIR = loaded.paths.privatePlugins;
      if (apiKey) loaded.configuration.env.AI_API_KEY = apiKey;
      currentConfiguration = loaded.configuration;
      let diagnostic;
      try {
        diagnostic = await testConfiguredProvider(loaded.configuration);
      } catch (error) {
        settingsReadyToLaunch = true;
        return { ok:false, saved:true, error:error.message || "Connection test failed." };
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
  updateManager = createUpdateManager({ app, autoUpdater, dialog });
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
