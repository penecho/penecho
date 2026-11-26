"use strict";
require("./helpers/safety.js");

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const vm = require("node:vm");
const { kimiPresetUpdates, normalizeSettings, publicSettings } = require("../desktop/settings-contract.js");
const { readSecret, writeSecret } = require("../desktop/secret-store.js");
const { assertCodexCliBundle, canInspectCli, inspectCli, installCli, installInvocation, managedCliPath, runProcess } = require("../desktop/cli-installer.js");
const { pathExecutables } = require("../src/providers/cli-discovery.js");
const {
  RELEASE_API_URL, RELEASES_API_URL, createUpdateManager, downloadReleaseAsset, expectedAssetName, installDownloadedUpdate, macBundlePath, releaseAsset,
} = require("../desktop/update-manager.js");
const { isPrivateIpv4, lanHosts, lanUrls } = require("../desktop/network-access.js");
const { desktopConfigurationEnvironment } = require("../desktop/config-environment.js");
const { packageName, reopenAfterSilentUpdate } = require("../desktop/windows-update.js");
const { processIsRunning, waitForSquirrelFirstRunExit } = require("../desktop/squirrel-first-run.js");
const { parseArgs, resolveConfiguration } = require("../cli.js");

const ROOT = path.resolve(__dirname, "..");

function base(overrides = {}) {
  return {
    provider:"api", apiFormat:"openai", apiUrl:"https://api.openai.com/v1", apiModel:"gpt-5.6-sol", apiKey:"secret",
    effort:"medium", imageFormat:"webp", timeout:"180", canvasAgentTurnLimit:"100", autoDelay:"1.2", host:"127.0.0.1", port:"3888",
    requestTrace:false, traceLimit:"100", ...overrides,
  };
}

test("desktop settings accept a secure API configuration and reject unsafe values", () => {
  const normalized = normalizeSettings(base());
  assert.equal(normalized.provider, "api");
  assert.equal(normalized.updates.AI_API_URL, "https://api.openai.com/v1");
  assert.equal(normalized.updates.AI_API_KEY, null);
  assert.equal(normalized.apiKey, "secret");
  assert.throws(() => normalizeSettings(base({ apiKey:"" })), /API key is required/);
  assert.doesNotThrow(() => normalizeSettings(base({ apiKey:"" }), { hasSavedApiKey:true }));
  assert.throws(() => normalizeSettings(base({ apiUrl:"https://user:pass@example.com" })), /without embedded credentials/);
  assert.throws(() => normalizeSettings(base({ host:"192.168.1.2" })), /local-only or LAN/);
  assert.equal(normalizeSettings(base({ effort:"" })).updates.AI_EFFORT, "medium");
  assert.equal(normalized.updates.PENECHO_CANVAS_AGENT_TURN_LIMIT,"100");
  assert.throws(() => normalizeSettings(base({ canvasAgentTurnLimit:"49" })),/integer of at least 50/);
  assert.throws(() => normalizeSettings(base({ canvasAgentTurnLimit:"50.5" })),/integer of at least 50/);
  assert.equal(normalizeSettings(base({ canvasAgentTurnLimit:"1000000" })).updates.PENECHO_CANVAS_AGENT_TURN_LIMIT,"1000000");
  assert.throws(() => normalizeSettings(base({ autoDelay:"1.25" })),/at most one decimal place/);
});

test("desktop settings support CLI providers without exposing API secrets", () => {
  const kimi = normalizeSettings(base({ provider:"kimi-cli", kimiCliModel:"kimi-code/k3", kimiCliPath:"/usr/local/bin/kimi", apiKey:"" }));
  assert.equal(kimi.updates.KIMI_CLI_PATH, "/usr/local/bin/kimi");
  assert.equal(kimi.updates.KIMI_CLI_MODEL, "kimi-code/k3");
  const codex = normalizeSettings(base({ provider:"codex-cli", codexModel:"gpt-5.6-sol", codexPath:"/usr/local/bin/codex", apiKey:"" }));
  assert.equal(codex.updates.CODEX_CLI_PATH, "/usr/local/bin/codex");
  const visible = publicSettings({
    configExists:true, provider:"api", configFile:"/config.env", stateDir:"/state", env:{ AI_API_KEY:"never-return-this", AI_API_MODEL:"model" },
  }, { version:"0.7.0", hasSavedApiKey:true });
  assert.equal(visible.apiKeySaved, true);
  assert.equal(JSON.stringify(visible).includes("never-return-this"), false);
  assert.equal(publicSettings({ env:{} }).host, "0.0.0.0");
  assert.equal(publicSettings({ env:{} }).autoDelay, "5");
  assert.equal(publicSettings({ env:{} }).canvasAgentAutoOpen, false);
  assert.equal(publicSettings({ env:{} }).canvasAgentTurnLimit,"100");
  assert.equal(publicSettings({ env:{ PENECHO_CANVAS_AGENT_TURN_LIMIT:"275" } }).canvasAgentTurnLimit,"275");
  assert.equal(publicSettings({ env:{ PENECHO_CANVAS_AGENT_AUTO_OPEN:"false" } }).canvasAgentAutoOpen, false);
  assert.equal(normalizeSettings(base({ autoDelay:undefined })).updates.AUTO_AI_DELAY_SECONDS, "5");
  assert.equal(normalizeSettings(base({ canvasAgentAutoOpen:false })).updates.PENECHO_CANVAS_AGENT_AUTO_OPEN, "false");
  assert.equal(normalizeSettings(base({ canvasAgentAutoOpen:undefined })).updates.PENECHO_CANVAS_AGENT_AUTO_OPEN, "false");
  const visibleKimi = publicSettings({ provider:"kimi-cli", env:{ KIMI_CLI_PATH:"kimi", KIMI_CLI_MODEL:"kimi-code/k3" } });
  assert.equal(visibleKimi.provider, "kimi-cli");
  assert.equal(visibleKimi.kimiCliPath, "kimi");
  assert.equal(visibleKimi.kimiCliModel, "kimi-code/k3");
});

test("desktop settings expose Kimi as a global partner preset over the API provider", () => {
  const kimi = normalizeSettings(base({
    provider:"kimi", apiFormat:"openai", apiUrl:"https://api.kimi.com/coding/v1", apiModel:"k3", kimiProduct:"code", kimiRegion:"global",
  }));
  assert.equal(kimi.provider, "kimi");
  assert.equal(kimi.updates.AI_PROVIDER, "api");
  assert.equal(kimi.updates.PENECHO_DESKTOP_PROVIDER, "kimi");
  assert.equal(kimi.updates.PENECHO_KIMI_PRODUCT, "code");
  assert.equal(kimi.updates.PENECHO_KIMI_REGION, "global");
  const repaired = normalizeSettings(base({
    provider:"kimi", apiFormat:"openai", apiUrl:"https://api.kimi.com/coding/v1", apiModel:"k3", kimiProduct:"platform", kimiRegion:"china",
  }));
  assert.equal(repaired.updates.AI_API_URL, "https://api.moonshot.cn/v1");
  assert.equal(repaired.updates.AI_API_MODEL, "kimi-k3");
  const custom = normalizeSettings(base({
    provider:"kimi", apiFormat:"openai", apiUrl:"https://gateway.example.com/kimi", apiModel:"custom-kimi", kimiProduct:"platform", kimiRegion:"china",
  }));
  assert.equal(custom.updates.AI_API_URL, "https://gateway.example.com/kimi");
  assert.equal(custom.updates.AI_API_MODEL, "custom-kimi");
  assert.throws(() => normalizeSettings(base({
    provider:"kimi", apiFormat:"anthropic", apiUrl:"https://api.moonshot.ai/v1", apiModel:"k3", kimiProduct:"platform", kimiRegion:"global",
  })), /OpenAI-compatible/);
  const visible = publicSettings({
    configExists:true, provider:"api", configFile:"/config.env", stateDir:"/state",
    env:{
      PENECHO_DESKTOP_PROVIDER:"kimi", PENECHO_KIMI_PRODUCT:"platform", PENECHO_KIMI_REGION:"china",
      AI_API_URL:"https://api.kimi.com/coding/v1", AI_API_MODEL:"k3",
    },
  });
  assert.equal(visible.provider, "kimi");
  assert.equal(visible.kimiProduct, "platform");
  assert.equal(visible.kimiRegion, "china");
  assert.equal(visible.apiFormat, "openai");
  assert.equal(visible.apiUrl, "https://api.moonshot.cn/v1");
  assert.equal(visible.apiModel, "kimi-k3");
  const visibleCustom = publicSettings({
    provider:"api",
    env:{
      PENECHO_DESKTOP_PROVIDER:"kimi", PENECHO_KIMI_PRODUCT:"platform", PENECHO_KIMI_REGION:"china",
      AI_API_URL:"https://gateway.example.com/kimi", AI_API_MODEL:"custom-kimi",
    },
  });
  assert.equal(visibleCustom.apiUrl, "https://gateway.example.com/kimi");
  assert.equal(visibleCustom.apiModel, "custom-kimi");
  assert.equal(publicSettings({
    provider:"api", env:{ PENECHO_DESKTOP_PROVIDER:"kimi", PENECHO_KIMI_PRODUCT:"code" },
  }).apiModel, "k3");
  assert.equal(publicSettings({
    provider:"api", env:{ PENECHO_DESKTOP_PROVIDER:"kimi", PENECHO_KIMI_PRODUCT:"platform" },
  }).apiModel, "kimi-k3");
});

test("every Kimi service, region, and format preset resolves to its matching endpoint", () => {
  const presets = [
    { product:"code", region:"global", format:"openai", url:"https://api.kimi.com/coding/v1", model:"k3" },
    { product:"code", region:"china", format:"openai", url:"https://api.kimi.com/coding/v1", model:"k3" },
    { product:"code", region:"global", format:"anthropic", url:"https://api.kimi.com/coding", model:"k3" },
    { product:"code", region:"china", format:"anthropic", url:"https://api.kimi.com/coding", model:"k3" },
    { product:"platform", region:"global", format:"openai", url:"https://api.moonshot.ai/v1", model:"kimi-k3" },
    { product:"platform", region:"china", format:"openai", url:"https://api.moonshot.cn/v1", model:"kimi-k3" },
  ];
  for (const preset of presets) {
    const normalized = normalizeSettings(base({
      provider:"kimi",
      apiFormat:preset.format,
      apiUrl:"https://api.moonshot.ai/v1",
      apiModel:"k3",
      kimiProduct:preset.product,
      kimiRegion:preset.region,
    }));
    assert.equal(normalized.updates.AI_API_URL, preset.url, `${preset.product}/${preset.region}/${preset.format}`);
    assert.equal(normalized.updates.AI_API_MODEL, preset.model, `${preset.product}/${preset.region}/${preset.format}`);
  }
});

test("desktop startup repairs stale built-in Kimi presets before starting the API service", () => {
  const stale = {
    provider:"api",
    env:{
      PENECHO_DESKTOP_PROVIDER:"kimi",
      PENECHO_KIMI_PRODUCT:"platform",
      PENECHO_KIMI_REGION:"china",
      AI_API_FORMAT:"anthropic",
      AI_API_URL:"https://api.kimi.com/coding/v1",
      AI_API_MODEL:"k3",
    },
  };
  assert.deepEqual(kimiPresetUpdates(stale), {
    AI_API_FORMAT:"openai",
    AI_API_URL:"https://api.moonshot.cn/v1",
    AI_API_MODEL:"kimi-k3",
  });
  assert.deepEqual(kimiPresetUpdates({
    provider:"api",
    env:{
      ...stale.env,
      AI_API_FORMAT:"openai",
      AI_API_URL:"https://gateway.example.com/kimi",
      AI_API_MODEL:"custom-kimi",
    },
  }), {});
});

test("desktop LAN addresses exclude tunnels and prioritize common LAN ranges", () => {
  const hosts = lanHosts({
    en0:[{ address:"192.168.1.20", family:"IPv4", internal:false }],
    en1:[{ address:"10.0.0.5", family:4, internal:false }],
    utun4:[{ address:"172.16.0.2", family:"IPv4", internal:false }],
    "vEthernet (WSL)":[{ address:"172.20.32.1", family:"IPv4", internal:false }],
    "VMware Network Adapter VMnet1":[{ address:"192.168.56.1", family:"IPv4", internal:false }],
    tailscale:[{ address:"100.100.1.2", family:"IPv4", internal:false }],
    linkLocal:[{ address:"169.254.10.20", family:"IPv4", internal:false }],
    duplicate:[{ address:"192.168.1.20", family:"IPv4", internal:false }],
    public:[{ address:"203.0.113.8", family:"IPv4", internal:false }],
    lo0:[{ address:"127.0.0.1", family:"IPv4", internal:true }],
    ipv6:[{ address:"2001:db8::1", family:"IPv6", internal:false }],
  });
  assert.deepEqual(hosts, ["192.168.1.20", "10.0.0.5", "203.0.113.8"]);
  assert.equal(isPrivateIpv4("172.31.255.1"), true);
  assert.equal(isPrivateIpv4("172.32.0.1"), false);
  assert.deepEqual(lanUrls(3888, hosts), hosts.map(host => `http://${host}:3888/`));
  assert.deepEqual(lanUrls(0, hosts), []);
});

test("desktop settings file is not overridden by stale inherited launch values", () => {
  const env = desktopConfigurationEnvironment({
    PATH:"/usr/bin", HTTPS_PROXY:"http://proxy.example", PENECHO_STATE_DIR:"/old-state",
    AI_PROVIDER:"api", PENECHO_DESKTOP_PROVIDER:"kimi", AI_API_URL:"https://api.kimi.com/coding/v1",
    AI_API_MODEL:"k3", AI_API_KEY:"old-secret", HOST:"0.0.0.0", PORT:"5080",
  }, "/new-state");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HTTPS_PROXY, "http://proxy.example");
  assert.equal(env.PENECHO_STATE_DIR, "/new-state");
  for (const name of ["AI_PROVIDER", "PENECHO_DESKTOP_PROVIDER", "AI_API_URL", "AI_API_MODEL", "AI_API_KEY", "HOST", "PORT"]) {
    assert.equal(env[name], undefined, name);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-desktop-config-test-")), configFile = path.join(directory, "config.env");
  try {
    fs.writeFileSync(configFile, "AI_PROVIDER=api\nPENECHO_DESKTOP_PROVIDER=api\nAI_API_URL=https://example.com/v1\nAI_API_MODEL=custom-model\nHOST=127.0.0.1\nPORT=3888\n");
    const configuration = resolveConfiguration(parseArgs(["--config", configFile]), { cwd:directory, home:directory, env });
    assert.equal(configuration.env.PENECHO_DESKTOP_PROVIDER, "api");
    assert.equal(configuration.env.AI_API_URL, "https://example.com/v1");
    assert.equal(configuration.env.AI_API_MODEL, "custom-model");
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});

test("desktop secret store compresses credentials into a user-only local file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-secret-test-")), file = path.join(directory, "credentials.json");
  try {
    writeSecret(file, "sk-private");
    assert.equal(readSecret(file), "sk-private");
    const serialized = fs.readFileSync(file, "utf8"), stored = JSON.parse(serialized);
    assert.equal(stored.version, 2);
    assert.equal(stored.encoding, "gzip+base64");
    assert.doesNotMatch(serialized, /sk-private/);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const safeStorage = {
      isEncryptionAvailable:() => true,
      encryptString:value => Buffer.from(`encrypted:${value}`).reverse(),
      decryptString:value => Buffer.from(value).reverse().toString().slice("encrypted:".length),
    };
    writeSecret(file, "windows-private", safeStorage);
    assert.equal(readSecret(file, safeStorage), "windows-private");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 1);
    assert.equal(readSecret(file), "");
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});

test("desktop shell and Forge config keep the renderer isolated and package native assets", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8"),
    serverMain = fs.readFileSync(path.join(ROOT, "src", "server", "main.js"), "utf8"),
    canvasPreload = fs.readFileSync(path.join(ROOT, "desktop", "canvas-preload.js"), "utf8"),
    updateCss = fs.readFileSync(path.join(ROOT, "public", "desktop-update.css"), "utf8"),
    updateWindowHtml = fs.readFileSync(path.join(ROOT, "desktop", "update-window.html"), "utf8"),
    updateWindowCss = fs.readFileSync(path.join(ROOT, "desktop", "update-window.css"), "utf8"),
    updateWindowJs = fs.readFileSync(path.join(ROOT, "desktop", "update-window.js"), "utf8"),
    updateWindowPreload = fs.readFileSync(path.join(ROOT, "desktop", "update-window-preload.js"), "utf8"),
    forge = fs.readFileSync(path.join(ROOT, "forge.config.js"), "utf8"),
    rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.doesNotMatch(main, /settingsWindow|configurationIsReady|save-and-test|SETTINGS_FILE/);
  assert.match(main, /mainWindow.webContents.send\("penecho:menu-command", command\)/);
  assert.match(canvasPreload, /onMenuCommand:listener/);
  assert.match(main, /if \(!unified\) Object.assign\(configuration.env, kimiPresetUpdates\(configuration\)\)/);
  for (const obsolete of ["preload.js", "settings/index.html", "settings/settings.js", "settings/settings.css"]) {
    assert.equal(fs.existsSync(path.join(ROOT, "desktop", obsolete)), false);
  }
  assert.match(main, /contextIsolation:true/);
  assert.match(main, /nodeIntegration:false/);
  assert.match(main, /sandbox:true/);
  assert.match(main, /PENECHO_PRIVATE_PLUGIN_DIR/);
  assert.match(main, /Object\.assign\(configuration\.env, kimiPresetUpdates\(configuration\)\)/);
  assert.match(main, /desktopConfigurationEnvironment\(process\.env, paths\.stateDir\)/);
  assert.match(main, /stateDir = app\.getPath\("userData"\)/);
  // The server is never loaded into the window's process: it is started in one of its own, with the settings' environment.
  assert.match(main, /serverProcess = createServerProcess\(\{[\s\S]*?settings:\(\) => \{[\s\S]*?PENECHO_CONFIG_FILE:configFile[\s\S]*?serverProcess\.start\(\)/);
  assert.doesNotMatch(main, /applyEnvironment|process\.env\.[A-Z_]+\s*(?:\|\||\?\?)?=/);
  assert.doesNotMatch(main, /require\("\.\.\/(?:server\.js|src\/server\/(?:main|local-access|canvas-agent\/native-picker-grants)\.js)"\)/);
  assert.match(fs.readFileSync(path.join(ROOT, "desktop", "server-entry.js"), "utf8"), /applyEnvironment\(env\);[\s\S]*?server = require\("\.\.\/server\.js"\)/);
  assert.match(serverMain, /const CONNECTIONS_FILE = STATE_DIRECTORY\s*\? path\.join\(STATE_DIRECTORY, "connections\.json"\)/);
  assert.match(serverMain, /\/api\/settings\/connections\/inspect-cli/);
  assert.match(serverMain, /status:await inspectConnectionCli\(provider\)/);
  assert.match(main, /configuration\.env\.HOST\) configuration\.env\.HOST = "0\.0\.0\.0"/);
  assert.match(main, /const DESKTOP_VERSION = pkg\.config\?\.desktopVersion \|\| pkg\.version/);
  assert.match(main, /createUpdateManager/);
  assert.match(main, /createUpdateManager\(\{[\s\S]*?currentVersion:DESKTOP_VERSION/);
  assert.match(main, /updateManager\.start\(\)/);
  assert.match(main, /createMenuTemplate/);
  assert.match(main, /checkUpdates:showUpdateWindow/);
  assert.match(main, /UPDATE_WINDOW_PRELOAD = path\.join\(__dirname, "update-window-preload\.js"\)/);
  assert.match(main, /UPDATE_WINDOW_HTML = path\.join\(__dirname, "update-window\.html"\)/);
  assert.match(main, /windowOpen:updateWindowVisible/);
  assert.match(main, /if \(status === "installing"\) updateDesktopUpdateUi\(\);\s*else void updateManager\.check\(true\)/);
  assert.match(main, /url\.pathname\.startsWith\("\/penecho\/penecho\/releases\/"\)/);
  assert.match(main, /penecho:update-open-release-page/);
  assert.doesNotMatch(main, /macUpdateMenu/);
  assert.match(main, /--squirrel-\(\?:install\|updated\|uninstall\|obsolete\)/);
  assert.doesNotMatch(main, /setProgressBar/);
  assert.doesNotMatch(main, /\bautoUpdater\b/);
  assert.match(canvasPreload, /penechoDesktopUpdate/);
  assert.match(canvasPreload, /installCli:provider => ipcRenderer\.invoke\("penecho:install-cli", provider\)/);
  assert.doesNotMatch(canvasPreload, /inspectCli|get-cli-statuses/);
  assert.doesNotMatch(canvasPreload, /pickProjectDirectory|penecho:pick-project-directory/);
  assert.match(canvasPreload, /pickProjectFile:\(\) => ipcRenderer\.invoke\("penecho:pick-project-file"\)/);
  assert.match(canvasPreload, /hasClipboardFile:\(\) => ipcRenderer\.sendSync\("penecho:has-clipboard-file"\)/);
  assert.match(canvasPreload, /readClipboardFile:\(\) => ipcRenderer\.invoke\("penecho:read-clipboard-file"\)/);
  assert.match(canvasPreload, /readClipboardFiles:\(\) => ipcRenderer\.invoke\("penecho:read-clipboard-files"\)/);
  assert.match(canvasPreload, /openProjectFile:projectId => ipcRenderer\.invoke\("penecho:open-project-file", projectId\)/);
  assert.match(canvasPreload, /setPageScale:scale => ipcRenderer\.invoke\("penecho:set-page-scale", scale\)/);
  assert.match(main, /ipcMain\.on\("penecho:has-clipboard-file"[\s\S]*?fromCanvas\(event\)/);
  assert.match(main, /ipcMain\.handle\("penecho:read-clipboard-file"[\s\S]*?fromCanvas\(event\)/);
  assert.match(main, /ipcMain\.handle\("penecho:read-clipboard-files"[\s\S]*?fromCanvas\(event\)/);
  assert.match(main, /public\.file-url[\s\S]*?text\/uri-list[\s\S]*?x-special\/gnome-copied-files/);
  assert.match(main, /CANVAS_AGENT_CLIPBOARD_FILE_LIMIT = 32 \* 1024 \* 1024/);
  assert.match(main, /CANVAS_AGENT_CLIPBOARD_FILE_COUNT_LIMIT = 5/);
  assert.match(main, /ipcMain\.handle\("penecho:open-project-file"[\s\S]*?fromCanvas\(event\)[\s\S]*?canvasAgentDesktopProjectStore\(\)\.resolve[\s\S]*?shell\.openPath\(project\.path\)/);
  assert.doesNotMatch(main, /penecho:pick-project-directory|properties:\["openDirectory"/);
  assert.doesNotMatch(canvasPreload, /openSettings/);
  assert.match(canvasPreload, /\["darwin", "win32"\]\.includes\(process\.platform\)/);
  assert.match(canvasPreload, /showWindow:\(\) => invoke\("penecho:update-show-window"\)/);
  assert.match(main, /ipcMain\.handle\("penecho:update-show-window"/);
  assert.match(canvasPreload, /document\.querySelector\("\.topbar \.brand"\)/);
  assert.match(canvasPreload, /brand\.after\(prompt\)/);
  assert.match(canvasPreload, /prompt\.id = "desktopUpdatePrompt"/);
  assert.doesNotMatch(canvasPreload, /main > footer|penecho-desktop-update-visible/);
  assert.match(updateCss, /width: 26px/);
  assert.match(updateCss, /:focus-within/);
  assert.match(updateCss, /prefers-reduced-motion/);
  assert.match(updateWindowHtml, /Content-Security-Policy/);
  assert.doesNotMatch(updateWindowHtml, /<style|<script(?! src)/);
  assert.match(updateWindowHtml, /role="progressbar"/);
  assert.match(updateWindowHtml, /id="release-button"/);
  assert.match(updateWindowCss, /grid-template-rows: auto auto minmax\(0, 1fr\) auto/);
  assert.match(updateWindowCss, /prefers-reduced-motion: reduce/);
  assert.match(updateWindowJs, /The download will continue in the background/);
  assert.match(updateWindowJs, /下载会在后台继续/);
  assert.match(updateWindowJs, /currentState\.status === "available"\) await api\.download\(\)/);
  assert.match(updateWindowJs, /currentState\.status === "ready" \|\| currentState\.ready/);
  assert.match(updateWindowPreload, /openReleasePage:\(\) => invoke\("penecho:update-open-release-page"\)/);
  assert.match(updateWindowPreload, /close:\(\) => invoke\("penecho:update-window-close"\)/);
  assert.doesNotMatch(updateWindowPreload, /update-dismiss/);
  assert.match(main, /dispatch:dispatchCanvasCommand/);
  assert.match(serverMain, /canvasAgentAutoOpen:CANVAS_AGENT_AUTO_OPEN/);
  assert.match(forge, /node_modules\/\{sharp,@img,@vscode\}/);
  assert.match(forge, /src\/server\/project-lines\/\{browser-call,orch-call\}\.js/);
  assert.match(forge, /readPackageJson/);
  assert.match(forge, /const DESKTOP_VERSION = pkg\.config\.desktopVersion/);
  assert.match(forge, /appVersion:DESKTOP_VERSION/);
  assert.match(forge, /buildVersion:DESKTOP_VERSION/);
  assert.match(forge, /version:DESKTOP_VERSION/);
  assert.match(forge, /\^\\\/\\\./);
  for (const directory of ["build", "fixtures", "logs", "output", "scripts", "spec", "test", "testcase"]) {
    assert.match(forge,new RegExp(`\\^\\\\\\/${directory}`),directory);
  }
  // Evaluate the real config without installing desktop-only maker packages in core CI.
  const configModule = { exports:{} }, resolvedMakers = [];
  const configRequire = name => {
    assert.ok(["node:path", "./package.json", "./tools/electron/package.json"].includes(name), name);
    return name.startsWith(".") ? require(path.join(ROOT, name)) : require(name);
  };
  configRequire.resolve = (name, options) => {
    assert.deepEqual(options.paths, [path.join(ROOT, "tools", "electron")]);
    assert.ok(["@electron-forge/maker-dmg", "@electron-forge/maker-zip", "@electron-forge/maker-squirrel"].includes(name), name);
    resolvedMakers.push(name);
    return path.join(ROOT, "tools", "electron", "node_modules", name, "index.js");
  };
  vm.runInThisContext("(function(require,module,__dirname,process){" + forge + "\n})", { filename:path.join(ROOT,"forge.config.js") })(configRequire, configModule, ROOT, { env:{} });
  assert.deepEqual(resolvedMakers, ["@electron-forge/maker-dmg", "@electron-forge/maker-zip", "@electron-forge/maker-squirrel"]);
  const packageIgnore = configModule.exports.packagerConfig.ignore;
  const ignoredByDesktopPackage = candidate => packageIgnore.some(pattern => {
    if (!(pattern instanceof RegExp)) return typeof pattern === "function" && pattern(candidate);
    pattern.lastIndex = 0;
    return pattern.test(candidate);
  });
  assert.equal(ignoredByDesktopPackage("/docs"),false,"the docs directory must be traversed");
  for (const iconPath of ["/build", "/build/", "/build/icons", "/build/icons/", "/build/icons/penecho.png"]) {
    assert.equal(ignoredByDesktopPackage(iconPath),false,"the native window icon must be packaged");
  }
  assert.equal(ignoredByDesktopPackage("/public/penecho-readme-header.webp"), false, "the desktop update window logo must be packaged");
  assert.ok(fs.existsSync(path.join(ROOT, "public/penecho-readme-header.webp")));
  for (const buildPath of ["/build/cache", "/build/toolchain", "/build/icons/penecho.icns", "/build/icons/penecho.png.bak", "/build/icons/private"]) {
    assert.equal(ignoredByDesktopPackage(buildPath),true,"unrelated build output must remain excluded");
  }
  assert.equal(ignoredByDesktopPackage("/docs/"),false,"the docs directory with a trailing slash must be traversed");
  assert.equal(ignoredByDesktopPackage("/docs/mcp-setup.md"),false,"the MCP setup guide must be packaged");
  assert.equal(ignoredByDesktopPackage("/docs/mcp-agent-instructions.md"),false,"the MCP agent instructions must be packaged");
  assert.equal(ignoredByDesktopPackage("/docs/architecture.md"),true,"unrelated docs remain excluded");
  assert.equal(ignoredByDesktopPackage("/docs/mcp-setup.md.bak"),true,"only the exact reviewed MCP docs are packaged");
  for (const directory of ["/skills", "/skills/penecho-mcp", "/src", "/src/server", "/src/server/mcp"]) {
    assert.equal(ignoredByDesktopPackage(directory),false,`${directory} must be traversed`);
  }
  assert.equal(ignoredByDesktopPackage("/skills/penecho-mcp/SKILL.md"),false,"the PenEcho MCP skill must be packaged");
  // PE-692: nothing local to this computer goes in a build made from a working folder.
  for (const local of ["/proto/.edge-profile/Default/History", "/proto/.edge-profile/Default/Cookies", "/proto/index.html", "/local/pe-404/state.json", "/public/lines/.shots/a.png", "/src/.cache/x", "/hand_off.md"]) {
    assert.equal(ignoredByDesktopPackage(local),true,`${local} must stay out of the package`);
  }
  assert.equal(ignoredByDesktopPackage("/node_modules/some-package/.package-lock.json"),false,"node_modules is left to the packager's own pruning");
  assert.equal(ignoredByDesktopPackage("/public/lines/main.js"),false,"the pages are packaged");
  for (const file of fs.readdirSync(path.join(ROOT,"src","server","mcp"))) {
    assert.equal(ignoredByDesktopPackage(`/src/server/mcp/${file}`),false,`the PenEcho MCP backend must include ${file}`);
  }
  assert.match(forge, /\^\\\/tools/);
  assert.match(forge, /maker-dmg/);
  assert.match(forge, /maker-squirrel/);
  assert.match(forge, /loadingGif:path\.join\(ROOT, "build", "icons", "penecho-install\.gif"\)/);
  assert.match(forge, /identity:"-"/);
  assert.match(forge, /identityValidation:false/);
  assert.match(forge, /optionsForFile:\(\) => \(\{/);
  assert.match(forge, /hardenedRuntime:false/);
  assert.match(forge, /appleApiKey:process\.env\.APPLE_API_KEY_PATH/);
  assert.match(forge, /appleApiKeyId:process\.env\.APPLE_API_KEY_ID/);
  assert.match(forge, /appleApiIssuer:process\.env\.APPLE_API_ISSUER/);
  assert.match(forge, /windowsSign:windowsSigning/);
  assert.match(forge, /timestampServer:process\.env\.WINDOWS_TIMESTAMP_SERVER/);
  assert.match(forge, /hashes:\["sha256"\]/);
  const desktopReleaseWorkflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "desktop-release.yml"), "utf8");
  assert.match(desktopReleaseWorkflow, /environment: macos-signing/);
  assert.match(desktopReleaseWorkflow, /Missing required macos-signing environment secret/);
  assert.match(desktopReleaseWorkflow, /codesign --verify --deep --strict/);
  assert.match(desktopReleaseWorkflow, /Authority=Developer ID Application:/);
  assert.match(desktopReleaseWorkflow, /spctl --assess --type execute/);
  assert.match(desktopReleaseWorkflow, /xcrun stapler validate/);
  assert.match(desktopReleaseWorkflow, /xcrun notarytool submit/);
  assert.match(desktopReleaseWorkflow, /environment: windows-signing/);
  assert.match(desktopReleaseWorkflow, /WINDOWS_SIGNING_MODE=unsigned/);
  assert.match(desktopReleaseWorkflow, /ACTIONS_ID_TOKEN_REQUEST_URL/);
  assert.match(desktopReleaseWorkflow, /Install-Module -Name ArtifactSigning -RequiredVersion 0\.1\.8/);
  assert.match(desktopReleaseWorkflow, /Invoke-ArtifactSigning/);
  assert.match(desktopReleaseWorkflow, /ExcludeWorkloadIdentityCredential \$false/);
  assert.match(desktopReleaseWorkflow, /AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME/);
  assert.match(desktopReleaseWorkflow, /npm run desktop:make:windows -- --arch=x64 --skip-package/);
  assert.match(desktopReleaseWorkflow, /Publishing unsigned Windows artifact/);
  assert.match(desktopReleaseWorkflow, /Get-AuthenticodeSignature/);
  assert.match(desktopReleaseWorkflow, /TimeStamperCertificate/);
  assert.match(main, /credentialProtector = process\.platform === "darwin" \? null : safeStorage/);
  assert.match(main, /readSecret\(paths\.secretFile, credentialProtector\)/);
  assert.equal(rootPackage.version, "1.5.0");
  const manifestPath = path.join(ROOT, ".penecho-build-manifest.json"),
    buildManifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
  assert.equal(rootPackage.config.desktopVersion, buildManifest?.desktopVersionOverride || rootPackage.version);
  assert.ok(rootPackage.files.includes("src/"));
  for (const asset of ["public/access.html", "public/access.css", "public/access.js"]) {
    assert.ok(rootPackage.files.includes(asset), asset);
  }
  assert.ok(rootPackage.files.includes("public/desktop-update.css"));
  assert.ok(rootPackage.files.includes("public/penecho-mark.png"));
});

test("README logo is a compact horizontal WebP: blue nautilus mark beside the PenEcho wordmark", async () => {
  const logo = path.join(ROOT, "public", "penecho-readme-header.webp"),
    metadata = await sharp(logo).metadata(),
    pixels = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  assert.deepEqual(fs.readFileSync(path.join(ROOT, "build/brand/penecho-logo.png")), fs.readFileSync(path.join(ROOT, "build/brand/penecho-logo-original.png")), "the master lockup must be used byte-for-byte, as scripts/make-brand-master.js wrote it");
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 840);
  assert.equal(metadata.hasAlpha, true);
  assert.ok(require("../package.json").files.includes("public/penecho-readme-header.webp"));
  assert.equal(pixels.data[3], 0, "outer corner stays transparent");
  const counts = brandPixels(pixels.data);
  assert.ok(counts.transparent > metadata.width * metadata.height * .6);
  assert.ok(counts.blue > 5000, "blue mark and Echo lettering");
  assert.ok(counts.ink > 2000, "ink Pen lettering");
  const left = brandPixels(cropPixels(pixels, 0, 0, Math.floor(metadata.width / 4), metadata.height));
  assert.ok(left.blue > 2000 && left.ink === 0, "the mark sits left of the wordmark");
  const rootReadme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.match(rootReadme, /docs\/assets\/penecho-lines-logo\.svg" alt="PenEcho Lines" width="340"/);
  assert.match(rootReadme, /prefers-color-scheme: dark[\s\S]*?docs\/assets\/penecho-lines-logo-dark\.svg/);
  for (const [svgFile, expectedBlue, expectedInk] of [
    ["docs/assets/penecho-lines-logo.svg", "#2563eb", "#0f172a"],
    ["docs/assets/penecho-lines-logo-dark.svg", "#7c9aff", "#f8fafc"],
  ]) {
    const svg = fs.readFileSync(path.join(ROOT, svgFile), "utf8");
    assert.ok(svg.includes(expectedBlue) && svg.includes(expectedInk), `${svgFile} must use the brand palette`);
    assert.ok(svg.includes("PenEcho") && svg.includes("Lines"), `${svgFile} must display the PenEcho Lines lockup`);
  }
  const translatedReadmes = fs.readdirSync(path.join(ROOT, "docs/readme")).filter(file => /^README.*\.md$/.test(file)).map(file => "docs/readme/" + file);
  for (const file of translatedReadmes) assert.match(fs.readFileSync(path.join(ROOT, file), "utf8"), /\.\.\/assets\/penecho-lines-logo\.svg" alt="PenEcho Lines" width="340"/);
  for (const file of translatedReadmes) assert.match(fs.readFileSync(path.join(ROOT, file), "utf8"), /prefers-color-scheme: dark[\s\S]*?\.\.\/assets\/penecho-lines-logo-dark\.svg/);
  const dark = await sharp(path.join(ROOT, "public/penecho-readme-header-dark.webp")).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  assert.equal(dark.info.width, metadata.width);
  assert.equal(dark.info.height, metadata.height);
  const darkCounts = brandPixels(dark.data);
  assert.ok(darkCounts.white > 2000 && darkCounts.ink === 0, "dark README must use light lettering");
  assert.ok(darkCounts.lightBlue > 5000 && darkCounts.blue === 0, "dark README lifts the blue for dark backgrounds");
  const favicon = await sharp(path.join(ROOT, "public/penecho-favicon.png")).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  assert.equal(favicon.info.width, 256);
  assert.equal(favicon.info.height, 256);
  assert.equal(favicon.data[3], 0, "favicon outer corners remain transparent");
  const faviconCounts = brandPixels(favicon.data);
  assert.equal(faviconCounts.white, 0, "favicon must not have a white tile behind the blue mark");
  // The nautilus is a filled shape, so it covers more of the square than the pen outline did.
  assert.ok(faviconCounts.transparent > favicon.info.width * favicon.info.height * .6, "the mark's surrounding background and the lines cut into it remain transparent");
  assert.ok(faviconCounts.blue > 5000, "favicon shows the blue mark");
});

// Brand colors: blue #2563EB (dark mode #7C9AFF), ink #1D1D1F, white tiles.
function brandPixels(data, channels = 4) {
  const counts = { transparent:0, ink:0, blue:0, lightBlue:0, white:0 };
  for (let i = 0; i < data.length; i += channels) {
    const [r, g, b, a] = data.subarray(i, i + 4);
    if (a === 0) counts.transparent++;
    if (a < 128) continue;
    if (r < 60 && g < 60 && b < 60) counts.ink++;
    if (b > 180 && r < 90 && g < 130) counts.blue++;
    if (b > 230 && r > 90 && r < 170 && g > 120 && g < 190) counts.lightBlue++;
    if (r > 240 && g > 240 && b > 240) counts.white++;
  }
  return counts;
}

function cropPixels({ data, info }, left, top, width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) data.copy(out, y * width * 4, ((top + y) * info.width + left) * 4, ((top + y) * info.width + left + width) * 4);
  return out;
}

function blueBox({ data, info }) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = data.subarray(i, i + 4);
    if (a < 128 || !(b > 180 && r < 90 && g < 130)) continue;
    const x = (i / 4) % info.width, y = Math.floor(i / 4 / info.width);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { cx:(x0 + x1) / 2, cy:(y0 + y1) / 2 };
}

test("Windows installer animation shows the blue nautilus logo and image-based wordmark", async () => {
  const splash = path.join(ROOT, "build", "icons", "penecho-install.gif"),
    metadata = await sharp(splash, { animated:true }).metadata(),
    pixels = await sharp(splash, { animated:true }).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  assert.equal(metadata.width, 268);
  assert.equal(metadata.pageHeight, 167);
  assert.equal(metadata.pages, 3);
  assert.deepEqual(metadata.delay, [240, 240, 240]);
  for (let frame = 0; frame < 3; frame++) {
    const framePixels = pixels.data.subarray(frame * 268 * 167 * 4, (frame + 1) * 268 * 167 * 4);
    assert.deepEqual([...framePixels.subarray(0, 4)], [255, 255, 255, 255]);
    const counts = brandPixels(framePixels);
    assert.ok(counts.blue > 300, "installer shows the blue mark");
    const lettering = framePixels.subarray(100 * 268 * 4, 126 * 268 * 4);
    assert.ok(brandPixels(lettering).ink > 80, "PenEcho letters remain visible below the symbol");
    assert.ok(counts.white > 35000, "background remains clean white");
  }
});

test("desktop icons show the blue nautilus mark on a white Mac tile and a transparent Windows background", async () => {
  const ico = fs.readFileSync(path.join(ROOT, "build/icons/penecho.ico")),
    icns = fs.readFileSync(path.join(ROOT, "build/icons/penecho.icns"));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 5, "Windows ICO includes multiple resolutions");
  assert.equal(ico.readUInt8(6), 16, "Windows ICO starts with a 16px entry");
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  // Inspect the shipped ICNS instead of an ignored, locally generated PNG.
  let macPng;
  for (let offset = 8; offset < icns.length;) {
    assert.ok(offset + 8 <= icns.length, "ICNS entry header must be complete");
    const type = icns.toString("ascii", offset, offset + 4), length = icns.readUInt32BE(offset + 4);
    assert.ok(length > 8 && offset + length <= icns.length, "ICNS entry must fit within the file");
    if (type === "ic10") macPng = icns.subarray(offset + 8, offset + length);
    offset += length;
  }
  assert.ok(macPng, "Mac ICNS includes a 1024px icon");
  const windows = await sharp(path.join(ROOT, "build/icons/penecho-desktop-1024.png")).ensureAlpha().raw().toBuffer({ resolveWithObject:true }),
    mac = await sharp(macPng).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  for (const pixels of [windows, mac]) {
    assert.equal(pixels.info.width, 1024);
    assert.equal(pixels.info.height, 1024);
    const counts = brandPixels(pixels.data);
    assert.ok(counts.blue > 20000, "blue mark must survive icon generation");
    const mark = blueBox(pixels);
    assert.ok(Math.abs(mark.cx - 512) < 40 && Math.abs(mark.cy - 512) < 40, "mark stays centered");
    assert.equal(pixels.data[3], 0, "outer corners stay transparent");
  }
  assert.ok(brandPixels(windows.data).transparent > 600000);
  assert.ok(brandPixels(mac.data).white > 300000);
  const tileEdge = (40 * 1024 + 512) * 4;
  assert.deepEqual([...mac.data.subarray(tileEdge, tileEdge + 4)], [255, 255, 255, 255], "Mac tile is white behind the mark");
});

test("Windows first run waits for Squirrel to close before revealing PenEcho", async () => {
  let now = 0, checks = 0;
  assert.equal(await waitForSquirrelFirstRunExit({
    platform:"darwin",
    argv:["PenEcho", "--squirrel-firstrun"],
    isRunning:() => { throw new Error("must not inspect a process outside Windows first run"); },
  }), false);
  assert.equal(await waitForSquirrelFirstRunExit({
    platform:"win32",
    argv:["PenEcho", "--squirrel-firstrun"],
    parentPid:42,
    pollMs:100,
    maxWaitMs:1000,
    now:() => now,
    delay:async milliseconds => { now += milliseconds; },
    isRunning:pid => { assert.equal(pid, 42); checks += 1; return checks < 4; },
  }), true);
  assert.equal(now, 300);
  assert.equal(processIsRunning(42, () => {}), true);
  assert.equal(processIsRunning(42, () => { const error = new Error("denied"); error.code = "EPERM"; throw error; }), true);
  assert.equal(processIsRunning(42, () => { const error = new Error("gone"); error.code = "ESRCH"; throw error; }), false);
  const main = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8");
  assert.match(main, /const squirrelFirstRunComplete = waitForSquirrelFirstRunExit\(\)/);
  assert.match(main, /async function revealMainWindow[\s\S]*?await squirrelFirstRunComplete[\s\S]*?window\.show\(\)/);
  assert.doesNotMatch(main, /ready-to-show", \(\) => mainWindow\?\.show\(\)/);
});

test("desktop Canvas file picker is sender-guarded, single-file, and type-limited", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8"),
    canvasPreload = fs.readFileSync(path.join(ROOT, "desktop", "canvas-preload.js"), "utf8"),
    handler = main.match(/ipcMain\.handle\("penecho:pick-project-file", async event => \{([\s\S]*?)\n  \}\);/)?.[1] || "";

  assert.match(canvasPreload, /pickProjectFile:\(\) => ipcRenderer\.invoke\("penecho:pick-project-file"\)/);
  assert.match(handler, /if \(!fromCanvas\(event\)\) return \{ canceled:true \}/);
  assert.match(handler, /dialog\.showOpenDialog\(mainWindow, \{/);
  assert.match(handler, /properties:\["openFile"\]/);
  assert.doesNotMatch(handler, /multiSelections/);
  assert.match(handler, /name:"Documents", extensions:\["pdf", "docx", "xlsx", "csv", "pptx"\]/);
  assert.match(handler, /name:"SQLite databases", extensions:\["db", "sqlite", "sqlite3"\]/);
  assert.match(handler, /name:"Images", extensions:\["png", "jpg", "jpeg", "webp", "gif"\]/);
  assert.match(handler, /name:"Text, source, and configuration"/);
  for (const extension of ["txt", "md", "mdx", "jsonc", "jsonl", "yaml", "svg", "ts", "mts", "py", "pyi", "scala", "bat", "sql", "proto", "astro", "toml", "conf", "diff"]) {
    assert.match(handler, new RegExp(`"${extension}"`));
  }
  assert.doesNotMatch(handler, /name:"All files"|extensions:\["\*"\]/);
  assert.match(handler, /if \(result\.canceled \|\| !selectedPath\) return \{ canceled:true \}/);
  assert.match(handler, /pickerToken:await serverProcess\.request\("picker-grant", \{ selectedPath, kind:"file" \}\)/);
  assert.doesNotMatch(main, /penecho:pick-project-directory|kind:"folder"/);
});

test("desktop build dependencies are isolated from normal root installs", () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")),
    desktopPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "electron", "package.json"), "utf8")),
    rootLock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")),
    desktopLock = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "electron", "package-lock.json"), "utf8")),
    runner = fs.readFileSync(path.join(ROOT, "tools", "electron", "run-forge.js"), "utf8"),
    workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "desktop-release.yml"), "utf8"),
    collector = fs.readFileSync(path.join(ROOT, "scripts", "collect-artifacts.js"), "utf8");
  for (const dependency of [
    "electron", "@electron-forge/cli", "@electron-forge/maker-dmg",
    "@electron-forge/maker-squirrel", "@electron-forge/maker-zip",
  ]) {
    assert.equal(rootPackage.devDependencies[dependency], undefined, dependency);
    assert.ok(desktopPackage.devDependencies[dependency], dependency);
    assert.equal(rootLock.packages[`node_modules/${dependency}`], undefined, dependency);
    assert.ok(desktopLock.packages[`node_modules/${dependency}`], dependency);
  }
  assert.equal(rootPackage.scripts["desktop:deps"], "npm ci --prefix tools/electron");
  assert.match(runner, /cwd:ROOT/);
  assert.match(runner, /@electron-forge\/cli/);
  assert.equal((workflow.match(/npm ci --prefix tools\/electron/g) || []).length, 2);
  assert.match(collector, /desktopVersion = pkg\.config\.desktopVersion/);
  assert.match(collector, /"\.zip"/);
  assert.match(collector, /"\.nupkg"/);
  assert.match(collector, /"RELEASES"/);
});

test("desktop updates resolve published GitHub Releases for each packaged target", async () => {
  assert.equal(expectedAssetName("darwin", "arm64", "0.7.1"), "PenEcho-0.7.1-mac-arm64.zip");
  assert.equal(expectedAssetName("win32", "x64", "0.7.1"), "PenEcho-Setup-0.7.1-win-x64.exe");
  const states = [], requests = [], downloads = [], installs = [], manager = createUpdateManager({
    app:{ getVersion:() => "0.6.0", getPath:name => name === "temp" ? "/tmp" : "" },
    platform:"darwin",
    arch:"arm64",
    logger:{ warn:() => {} },
    onStateChange:state => states.push(state),
    fetchImpl:async (url, options) => {
      requests.push({ url, options });
      return {
        ok:true,
        status:200,
        json:async () => ({
          tag_name:"v0.7.1",
          name:"PenEcho 0.7.1",
          body:"## What's new\n- Silent update notifications\n- Update progress",
          published_at:"2026-07-01T00:00:00Z",
          html_url:"https://github.com/penecho/penecho/releases/tag/v0.7.1",
          assets:[{
            name:"PenEcho-0.7.1-mac-arm64.zip",
            size:123456,
            browser_download_url:"https://github.com/penecho/penecho/releases/download/v0.7.1/PenEcho-0.7.1-mac-arm64.zip",
            digest:"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          }],
        }),
      };
    },
    downloadImpl:async input => {
      downloads.push(input);
      input.onProgress(47.2);
      input.onProgress(100);
      return input.destination;
    },
    installImpl:async input => { installs.push(input); },
  });

  await manager.check(false);
  assert.equal(requests[0].url, RELEASE_API_URL);
  assert.equal(requests[0].options.headers["User-Agent"], "PenEcho/0.6.0");
  assert.equal(downloads.length, 0, "metadata checks must not start a download");
  assert.equal(manager.getState().status, "available");
  assert.equal(manager.getState().version, "0.7.1");
  assert.match(manager.getState().notes, /Silent update notifications/);

  assert.equal(manager.dismiss(), true);
  assert.equal(manager.getState().status, "dismissed");
  assert.equal(manager.getState().visible, false);
  assert.equal(await manager.check(false), false);
  assert.equal(requests.length, 1, "dismissal lasts for the current app process");

  await manager.check(true);
  assert.equal(requests.length, 2);
  assert.equal(await manager.download(), true);
  assert.equal(downloads[0].asset.name, "PenEcho-0.7.1-mac-arm64.zip");
  assert.equal(downloads[0].destination, path.join("/tmp", "penecho-update", "PenEcho-0.7.1-mac-arm64.zip"));
  assert.ok(states.some(state => state.status === "downloading" && state.progress === 47.2));
  assert.equal(manager.getState().status, "ready");
  assert.equal(await manager.install(), true);
  assert.equal(installs[0].platform, "darwin");
  assert.equal(installs[0].version, "0.7.1");

  const source = fs.readFileSync(path.join(ROOT, "desktop", "update-manager.js"), "utf8");
  assert.doesNotMatch(source, /autoUpdater|quitAndInstall|checkForUpdates|setFeedURL/);
  assert.doesNotMatch(source, /update\.electronjs\.org/);
  assert.match(source, /CFBundleIdentifier/);
  assert.match(source, /sha256/);
  assert.equal(manager.start(), true);
  manager.stop();
});

test("desktop update dismissal stays quiet through a background download until a manual check", async () => {
  let finishDownload;
  const manager = createUpdateManager({
    app:{ getVersion:() => "0.6.0", getPath:() => "/tmp" },
    platform:"win32",
    arch:"x64",
    logger:{ warn:() => {} },
    fetchImpl:async () => ({
      ok:true,
      status:200,
      json:async () => ({
        tag_name:"v0.7.1",
        name:"PenEcho 0.7.1",
        assets:[{
          name:"PenEcho-Setup-0.7.1-win-x64.exe",
          browser_download_url:"https://github.com/penecho/penecho/releases/download/v0.7.1/PenEcho-Setup-0.7.1-win-x64.exe",
        }],
      }),
    }),
    downloadImpl:async input => {
      input.onProgress(12.4);
      await new Promise(resolve => { finishDownload = resolve; });
      input.onProgress(58.9);
      return input.destination;
    },
  });

  assert.equal(await manager.check(false), true);
  const pendingDownload = manager.download();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.getState().status, "downloading");
  assert.equal(manager.getState().progress, 12.4);

  assert.equal(manager.dismiss(), true);
  assert.equal(manager.getState().status, "downloading");
  assert.equal(manager.getState().visible, false);
  assert.equal(await manager.check(false), false);

  assert.equal(await manager.check(true), true);
  assert.equal(manager.getState().status, "downloading");
  assert.equal(manager.getState().visible, true);
  assert.equal(manager.getState().progress, 12.4);

  assert.equal(manager.dismiss(), true);
  finishDownload();
  assert.equal(await pendingDownload, true);
  assert.equal(manager.getState().status, "ready");
  assert.equal(manager.getState().visible, false);

  assert.equal(await manager.check(true), true);
  assert.equal(manager.getState().status, "ready");
  assert.equal(manager.getState().visible, true);
});

test("desktop update checks honor the desktop-only version override", () => {
  const manager = createUpdateManager({
    app:{ getVersion:() => "1.1.0", getPath:() => "/tmp" },
    currentVersion:"0.9.2",
    platform:"win32",
    arch:"x64",
    logger:{ warn:() => {} },
  });
  assert.equal(manager.getState().currentVersion, "0.9.2");
});

test("desktop update checks stay silent when current and reset dismissal on a new process", async () => {
  const release = async () => ({
    ok:true,
    status:200,
    json:async () => ({
      tag_name:"v0.6.0",
      name:"PenEcho 0.6.0",
      body:"Current release",
      assets:[{
        name:"PenEcho-Setup-0.6.0-win-x64.exe",
        browser_download_url:"https://github.com/penecho/penecho/releases/download/v0.6.0/PenEcho-Setup-0.6.0-win-x64.exe",
      }],
    }),
  });
  const firstStates = [], first = createUpdateManager({
    app:{ getVersion:() => "0.6.0", getPath:() => "/tmp" }, platform:"win32", arch:"x64",
    fetchImpl:release, onStateChange:state => firstStates.push(state), logger:{ warn:() => {} },
  });
  await first.check(false);
  assert.equal(first.getState().status, "up-to-date");
  assert.equal(first.getState().visible, false);
  await first.check(true);
  assert.equal(first.getState().visible, true);
  first.dismiss();
  assert.equal(first.getState().visible, false);

  const second = createUpdateManager({
    app:{ getVersion:() => "0.5.0", getPath:() => "/tmp" }, platform:"win32", arch:"x64",
    fetchImpl:release, logger:{ warn:() => {} },
  });
  await second.check(false);
  assert.equal(second.getState().status, "available");
  assert.equal(second.getState().visible, true);
  assert.ok(firstStates.some(state => state.status === "up-to-date"));
});

test("desktop updates order beta, rc and final versions and keep previews from stable users", async () => {
  const release = (version, extra = {}) => {
    const name = `PenEcho-Setup-${version}-win-x64.exe`;
    return { tag_name:`v${version}`, prerelease:version.includes("-"), assets:[{ name, browser_download_url:`https://github.com/penecho/penecho/releases/download/v${version}/${name}` }], ...extra };
  };
  const offered = async (currentVersion, releases) => {
    let requested = "";
    const manager = createUpdateManager({
      app:{ getVersion:() => currentVersion, getPath:() => "/tmp" }, platform:"win32", arch:"x64", logger:{ warn:() => {} },
      fetchImpl:async url => {
        requested = url;
        return { ok:true, json:async () => url === RELEASES_API_URL ? releases : releases.find(value => !value.prerelease && !value.draft) };
      },
    });
    assert.equal(await manager.check(true), true, manager.getState().error);
    assert.equal(requested, currentVersion.includes("-") ? RELEASES_API_URL : RELEASE_API_URL);
    return manager.getState().updateAvailable ? manager.getState().version : "";
  };
  const stable = release("1.4.0");
  assert.equal(await offered("1.5.0-beta.1", [release("1.5.0-beta.2"), stable]), "1.5.0-beta.2");
  assert.equal(await offered("1.5.0-beta.2", [release("1.5.0-beta.10"), stable]), "1.5.0-beta.10");
  assert.equal(await offered("1.5.0-beta.10", [release("1.5.0-beta.2"), stable]), "");
  assert.equal(await offered("1.5.0-beta.2", [release("1.5.0-beta.2"), stable]), "");
  assert.equal(await offered("1.5.0-beta.10", [release("1.5.0-rc.1"), stable]), "1.5.0-rc.1");
  assert.equal(await offered("1.5.0-rc.1", [release("1.5.0-beta.11"), stable]), "");
  assert.equal(await offered("1.5.0-rc.2", [release("1.5.0"), release("1.5.0-rc.3")]), "1.5.0");
  assert.equal(await offered("1.5.0-beta.1", [stable, release("1.5.0-rc.1"), release("1.5.0-beta.3")]), "1.5.0-rc.1", "the largest version wins, not the newest date");
  assert.equal(await offered("1.5.0-beta.1", [release("1.5.0-beta.3", { assets:[] }), release("1.5.0-beta.2")]), "1.5.0-beta.2");
  assert.equal(await offered("1.5.0-beta.1", [release("1.5.0-beta.3", { draft:true }), stable]), "");
  assert.equal(await offered("1.5.0-beta.1", [{ tag_name:"nightly", name:"9.0.0" }, stable]), "");
  assert.equal(await offered("1.4.0", [release("1.5.0-beta.2"), stable]), "", "stable users are not offered a preview");
  assert.equal(await offered("1.3.0", [release("1.5.0-beta.2"), stable]), "1.4.0");
  assert.equal(await offered("1.5.0", [release("1.5.0"), release("1.6.0-beta.1")]), "");
});

test("unsigned desktop updater accepts only exact PenEcho release assets", () => {
  const release = {
    version:"0.7.2",
    assets:[
      { name:"PenEcho-0.7.2-mac-arm64.zip", url:"https://example.com/PenEcho.zip" },
      { name:"PenEcho-Setup-0.7.2-win-x64.exe", url:"https://github.com/penecho/penecho/releases/download/v0.7.2/PenEcho-Setup-0.7.2-win-x64.exe" },
    ],
  };
  assert.equal(releaseAsset(release, "darwin", "arm64"), null);
  assert.equal(releaseAsset(release, "win32", "x64").name, "PenEcho-Setup-0.7.2-win-x64.exe");
  const appRoot = path.join(path.parse(process.cwd()).root, "Applications", "PenEcho.app");
  assert.equal(macBundlePath(path.join(appRoot, "Contents", "MacOS", "PenEcho")), appRoot);
  assert.equal(macBundlePath(path.join(os.tmpdir(), "PenEcho")), "");
});

test("unsigned desktop update download reports progress and verifies GitHub SHA-256", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-update-download-")),
    destination = path.join(directory, "PenEcho-0.7.2-mac-arm64.zip"),
    content = Buffer.from("unsigned PenEcho update"),
    digest = crypto.createHash("sha256").update(content).digest("hex"),
    progress = [];
  try {
    await downloadReleaseAsset({
      asset:{
        name:path.basename(destination),
        url:"https://github.com/penecho/penecho/releases/download/v0.7.2/PenEcho-0.7.2-mac-arm64.zip",
        size:content.length,
        digest:`sha256:${digest}`,
      },
      destination,
      userAgent:"PenEcho/0.6.0",
      signal:new AbortController().signal,
      onProgress:value => progress.push(value),
      fetchImpl:async () => new Response(content, {
        status:200,
        headers:{ "content-length":String(content.length) },
      }),
    });
    assert.deepEqual(fs.readFileSync(destination), content);
    assert.equal(progress.at(-1), 100);
    await assert.rejects(downloadReleaseAsset({
      asset:{
        name:path.basename(destination),
        url:"https://github.com/penecho/penecho/releases/download/v0.7.2/PenEcho-0.7.2-mac-arm64.zip",
        digest:`sha256:${"0".repeat(64)}`,
      },
      destination,
      userAgent:"PenEcho/0.6.0",
      signal:new AbortController().signal,
      onProgress:() => {},
      fetchImpl:async () => new Response(content, { status:200 }),
    }), /SHA-256/);
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});

test("unsigned macOS updater validates the extracted app and schedules an atomic replacement", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-mac-install-")),
    target = path.join(directory, "Applications", "PenEcho.app"),
    executable = path.join(target, "Contents", "MacOS", "PenEcho"),
    archive = path.join(directory, "PenEcho-0.7.2-mac-arm64.zip"),
    commands = [],
    spawns = [],
    app = {
      getPath:name => name === "exe" ? executable : "",
      quit:() => { app.quitCalled = true; },
    };
  fs.mkdirSync(path.dirname(executable), { recursive:true });
  fs.writeFileSync(executable, "");
  fs.writeFileSync(archive, "test archive");
  try {
    assert.equal(await installDownloadedUpdate({
      app,
      platform:"darwin",
      version:"0.7.2",
      downloadedPath:archive,
      runCommand:async (command, args) => {
        commands.push({ command, args });
        if (command === "/usr/bin/ditto") {
          fs.mkdirSync(path.join(args[3], "PenEcho.app", "Contents"), { recursive:true });
          return "";
        }
        return args[1] === "CFBundleIdentifier" ? "app.penecho.desktop" : "0.7.2";
      },
      spawnImpl:(command, args, options) => {
        spawns.push({ command, args, options });
        return { unref:() => {} };
      },
    }), true);
    assert.equal(commands[0].command, "/usr/bin/ditto");
    assert.equal(spawns[0].command, "/bin/sh");
    assert.equal(spawns[0].args[1], target);
    assert.equal(spawns[0].options.detached, true);
    assert.match(fs.readFileSync(spawns[0].args[0], "utf8"), /if \[ -d "\$backup" \].*\/bin\/mv "\$backup" "\$target"/);
    assert.equal(app.quitCalled, true);
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});

test("Windows updater runs a downloaded Setup so that it opens PenEcho", async () => {
  const calls = [], app = { quit:() => { app.quitCalled = true; } };
  assert.equal(await installDownloadedUpdate({
    app,
    platform:"win32",
    downloadedPath:"C:\\Temp\\PenEcho-Setup-0.7.2-win-x64.exe",
    spawnImpl:(command, args, options) => {
      calls.push({ command, args, options });
      return { unref:() => {} };
    },
  }), true);
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].options.detached, true);
  assert.equal(app.quitCalled, true);
});

test("Windows updater installs the package beside the running version and opens it after closing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-win-update-")),
    root = path.join(directory, "penecho"), exe = path.join(root, "app-1.4.0", "PenEcho.exe"),
    updateExe = path.join(root, "Update.exe"), downloads = path.join(directory, "downloads"),
    downloadedPath = path.join(downloads, packageName("1.5.0-beta.2")),
    spawns = [], app = { quits:0, getPath:() => exe, quit() { this.quits += 1; } },
    run = runCommand => installDownloadedUpdate({
      app, platform:"win32", version:"1.5.0-beta.2", downloadedPath, runCommand,
      spawnImpl:(command, args, options) => { spawns.push({ command, args, options }); return { unref:() => {} }; },
    });
  try {
    fs.mkdirSync(path.dirname(exe), { recursive:true });
    fs.mkdirSync(downloads);
    fs.writeFileSync(downloadedPath, "package");
    await assert.rejects(run(async () => ""), /installed with its Setup/);
    fs.writeFileSync(updateExe, "");
    await assert.rejects(run(async () => { throw new Error("disk full"); }), /disk full/);
    await assert.rejects(run(async () => ""), /did not install PenEcho v1\.5\.0-beta\.2/);
    assert.equal(app.quits, 0, "a failed install leaves PenEcho open");
    assert.deepEqual(fs.readdirSync(downloads), ["penecho-1.5.0-beta2-full.nupkg"], "and can be tried again");
    let releases = "";
    assert.equal(await run(async (command, args) => {
      assert.equal(command, updateExe);
      assert.equal(app.quits, 0);
      releases = fs.readFileSync(path.join(args[0].replace("--update=", ""), "RELEASES"), "utf8");
      fs.mkdirSync(path.join(root, "app-1.5.0-beta2"));
      fs.writeFileSync(path.join(root, "app-1.5.0-beta2", "PenEcho.exe"), "");
    }), true);
    assert.equal(releases, `${require("node:crypto").createHash("sha1").update("package").digest("hex").toUpperCase()} penecho-1.5.0-beta2-full.nupkg 7`);
    assert.deepEqual([spawns.length, spawns[0].command, spawns[0].args, spawns[0].options.detached], [1, updateExe, ["--processStartAndWait", "PenEcho.exe"], true]);
    assert.equal(app.quits, 1);
    assert.deepEqual(fs.readdirSync(downloads), [], "the download is removed");
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});

test("Windows takes the package when Squirrel sees it as newer, and Setup otherwise", () => {
  const pick = (version, current, platform = "win32", arch = "x64", names = [packageName(version), `PenEcho-Setup-${version}-win-${arch}.exe`]) =>
    releaseAsset({ version, assets:names.map(name => ({ name, url:`https://github.com/penecho/penecho/releases/download/v${version}/${name}` })) }, platform, arch, current)?.name;
  assert.equal(pick("1.4.0", "1.3.0"), "penecho-1.4.0-full.nupkg");
  assert.equal(pick("1.5.0", "1.5.0-rc.1"), "penecho-1.5.0-full.nupkg");
  assert.equal(pick("1.5.0-rc.1", "1.5.0-beta.2"), "penecho-1.5.0-rc1-full.nupkg");
  assert.equal(pick("1.5.0-beta.10", "1.5.0-beta.2"), "PenEcho-Setup-1.5.0-beta.10-win-x64.exe");
  assert.equal(pick("1.4.0", "1.3.0", "win32", "x64", ["PenEcho-Setup-1.4.0-win-x64.exe"]), "PenEcho-Setup-1.4.0-win-x64.exe");
  assert.equal(pick("1.4.0", "1.3.0", "win32", "arm64"), "PenEcho-Setup-1.4.0-win-arm64.exe");
});

test("a check during an install leaves it installing", async () => {
  let installs = 0, release;
  const manager = createUpdateManager({
    app:{ getVersion:() => "1.4.0" }, platform:"win32", arch:"x64", logger:{ warn() {} },
    fetchImpl:async () => ({ ok:true, json:async () => ({ tag_name:"v1.5.0", assets:[{ name:packageName("1.5.0"), browser_download_url:`https://github.com/penecho/penecho/releases/download/v1.5.0/${packageName("1.5.0")}` }] }) }),
    downloadImpl:async () => "package.nupkg",
    installImpl:() => { installs += 1; return new Promise(resolve => { release = resolve; }); },
  });
  await manager.check(true);
  await manager.download();
  const installing = manager.install();
  assert.equal(await manager.check(false), true);
  assert.equal(manager.getState().status, "installing");
  assert.equal(await manager.install(), false, "and a second click starts nothing");
  release();
  await installing;
  assert.equal(installs, 1);
});

test("the Windows install event opens PenEcho after an older version's silent Setup", () => {
  const { EventEmitter } = require("node:events"),
    child = new EventEmitter();
  let done = 0, call = null;
  reopenAfterSilentUpdate({
    updateExe:"C:\\Users\\O'Neil\\penecho\\Update.exe", exeName:"PenEcho.exe", done:() => { done += 1; },
    spawnImpl:(command, args, options) => { call = { command, args, options }; return child; },
  });
  const decode = value => Buffer.from(value, "base64").toString("utf16le"), script = decode(call.args.at(-1)),
    watch = decode(script.match(/'-EncodedCommand','([^']+)'/)[1]);
  assert.match(call.command, /powershell\.exe$/);
  assert.ok(!call.options.detached, "detached, PowerShell runs nothing");
  assert.match(watch, /Wait-Process/);
  assert.match(script, /PenEcho-Setup-\*[\s\S]*penecho-updates/);
  assert.match(watch, /'C:\\Users\\O''Neil\\penecho\\Update\.exe'/);
  assert.equal(done, 0);
  child.emit("exit", 0);
  assert.equal(done, 1);
  const main = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8");
  assert.match(main, /event === "--squirrel-install"[\s\S]*?reopenAfterSilentUpdate/);
});

test("desktop CLI setup uses official installers for Kimi, Claude, and standard-location latest Codex", () => {
  const options = { platform:"darwin", home:"/Users/example", stateDir:"/Users/example/Library/Application Support/PenEcho" },
    winOptions = { platform:"win32", home:"C:\\Users\\example", stateDir:"C:\\Users\\example\\AppData\\Roaming\\PenEcho", env:{ LOCALAPPDATA:"C:\\Users\\example\\AppData\\Local" } },
    resolvedHome = path.resolve(options.home), resolvedStateDir = path.resolve(options.stateDir),
    kimiPath = managedCliPath("kimi-cli", options),
    claudePath = managedCliPath("claude-cli", options),
    codexMacPath = managedCliPath("codex-cli", options),
    codexWinPath = managedCliPath("codex-cli", winOptions),
    kimi = installInvocation("kimi-cli", "/tmp/kimi.sh", options),
    claude = installInvocation("claude-cli", "/tmp/claude.sh", options),
    codexMac = installInvocation("codex-cli", "/tmp/codex.sh", options),
    codexWin = installInvocation("codex-cli", "C:\\tmp\\codex.ps1", winOptions);
  // Windows PowerShell 5.1 asks before every Invoke-WebRequest without -UseBasicParsing.
  for (const provider of ["kimi-cli", "codex-cli", "claude-cli", "pi-cli", "omp-cli", "antigravity-cli"]) {
    const { args, env } = installInvocation(provider, "C:\\tmp\\a b\\install.ps1", winOptions), command = args[args.indexOf("-Command") + 1];
    assert.ok(command.startsWith("$PSDefaultParameterValues['Invoke-WebRequest:UseBasicParsing'] = $true;"), provider);
    assert.equal(env.PENECHO_INSTALLER_SCRIPT, "C:\\tmp\\a b\\install.ps1");
  }
  assert.equal(kimiPath, path.join(resolvedStateDir, "tools", "kimi", "bin", "kimi"));
  assert.equal(claudePath, path.join(resolvedHome, ".local", "bin", "claude"));
  assert.equal(codexMacPath, path.join(resolvedHome, ".local", "bin", "codex"));
  assert.equal(codexWinPath, path.join(path.resolve("C:\\Users\\example\\AppData\\Local"), "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
  assert.equal(kimi.command, "/bin/bash");
  assert.equal(kimi.env.KIMI_INSTALL_DIR, path.dirname(path.dirname(kimiPath)));
  assert.equal(kimi.env.KIMI_NO_MODIFY_PATH, "1");
  assert.deepEqual(claude.args, ["/tmp/claude.sh", "stable"]);
  assert.equal(codexMac.command, "/bin/sh");
  assert.deepEqual(codexMac.args, ["/tmp/codex.sh"]);
  assert.equal(codexMac.env.CODEX_RELEASE, "latest");
  assert.equal(codexMac.env.CODEX_NON_INTERACTIVE, "1");
  assert.equal(codexMac.env.CODEX_HOME, path.join(resolvedHome, ".codex"));
  assert.equal(codexMac.env.CODEX_INSTALL_DIR, path.dirname(codexMacPath));
  assert.equal(codexWin.env.CODEX_RELEASE, "latest");
  assert.equal(codexWin.env.CODEX_NON_INTERACTIVE, "1");
  assert.equal(codexWin.env.CODEX_HOME, path.join(path.resolve(winOptions.home), ".codex"));
  assert.equal(codexWin.env.CODEX_INSTALL_DIR, path.dirname(codexWinPath));
});

test("CLI inspection distinguishes missing, login, ready, and repair states on macOS and Windows", async () => {
  const options = { home:"/tmp/penecho-cli-home", stateDir:"/tmp/penecho-cli-state", candidates:[] };
  const missingMac = await inspectCli("codex-cli", { ...options, platform:"darwin", preflight:async () => ({ ok:false, issue:"missing" }) });
  assert.equal(missingMac.state, "missing");
  assert.equal(missingMac.installCommand, "curl -fsSL https://chatgpt.com/codex/install.sh | sh");
  assert.equal(missingMac.loginCommand, "codex login");

  const missingWindows = await inspectCli("kimi-cli", { ...options, platform:"win32", preflight:async () => ({ ok:false, issue:"missing" }) });
  assert.equal(missingWindows.state, "missing");
  assert.equal(missingWindows.installCommand, "irm https://code.kimi.com/kimi-code/install.ps1 | iex");

  const auth = await inspectCli("claude-cli", { ...options, platform:"win32", preflight:async () => ({ ok:false, issue:"authentication", source:"system", executable:"C:\\Tools\\claude.exe" }) });
  assert.equal(auth.state, "auth_required");
  assert.equal(auth.loginCommand, "claude auth login");
  assert.equal(auth.executable, "C:\\Tools\\claude.exe");

  const ready = await inspectCli("codex-cli", { ...options, platform:"darwin", preflight:async () => ({ ok:true, source:"system", executable:"/tmp/codex", version:"codex 1.2.3" }) });
  assert.deepEqual({ state:ready.state, source:ready.source, executable:ready.executable, version:ready.version }, { state:"ready", source:"system", executable:"/tmp/codex", version:"codex 1.2.3" });

  const repair = await inspectCli("kimi-cli", { ...options, platform:"darwin", preflight:async () => ({ ok:false, issue:"execution", source:"managed", executable:"/tmp/kimi" }) });
  assert.equal(repair.state, "repair_required");
});

test("Windows CLI discovery uses semicolon-separated PATH entries", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-win-path-")), first = path.join(directory, "first"), second = path.join(directory, "second");
  try {
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    fs.writeFileSync(path.join(second, "codex.exe"), "test");
    assert.deepEqual(pathExecutables("codex", { platform:"win32", env:{ PATH:`${first};${second}`, PATHEXT:".EXE;.CMD" } }), [path.join(second, "codex.exe")]);
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});

test("automatic Codex CLI setup reuses an existing user Codex/app first and otherwise installs official latest into the standard user path", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-codex-standard-install-test-")),
    home = path.join(directory, "home"),
    stateDir = path.join(directory, "state"),
    appDir = path.join(directory, "Applications");
  try {
    // 1. Existing official Codex Desktop app on macOS is reused without downloading anything.
    const appCodex = path.join(appDir, "ChatGPT.app", "Contents", "Resources", "codex-cli", "bin", "codex");
    fs.mkdirSync(path.dirname(appCodex), { recursive:true });
    fs.writeFileSync(appCodex, "#!/bin/sh\n", { mode:0o755 });
    const reused = await installCli("codex-cli", {
      platform:"darwin", home, stateDir,
      env:{ HOME:home, PATH:"" },
      appFolders:[appDir],
      systemDirs:[],
      fetchImpl:async () => { throw new Error("must not download when official Codex app is installed"); },
      runner:async (command, args) => {
        assert.equal(command, appCodex);
        assert.deepEqual(args, ["--version"]);
        return { output:"codex-cli 0.172.0" };
      },
    });
    assert.equal(reused.alreadyInstalled, true);
    assert.equal(reused.executable, appCodex);
    assert.equal(reused.version, "codex-cli 0.172.0");

    // 2. When no user Codex exists on Windows, installs official latest into %LOCALAPPDATA%\Programs\OpenAI\Codex\bin (never tools\codex).
    const localAppData = path.join(directory, "LocalAppData");
    const expectedWin = managedCliPath("codex-cli", { platform:"win32", home, stateDir, env:{ LOCALAPPDATA:localAppData } });
    let fetchCount = 0;
    const winInstallOpts = {
      platform:"win32", home, stateDir,
      env:{ USERPROFILE:home, LOCALAPPDATA:localAppData, PATH:"", CODEX_CA_CERTIFICATE:path.join(directory, "missing-ca.pem") },
      windowsAppsRoot:path.join(directory, "empty-winapps"),
      fetchImpl:async url => {
        fetchCount += 1;
        assert.equal(url, "https://chatgpt.com/codex/install.ps1");
        return new Response("# CODEX_INSTALL_DIR\n", { status:200 });
      },
      runner:async (_command, args, options) => {
        if (args[0] === "--version") return { output:"codex-cli 0.185.0" };
        assert.equal(options.env.CODEX_RELEASE, "latest");
        assert.equal(options.env.CODEX_NON_INTERACTIVE, "1");
        assert.equal(options.env.CODEX_HOME, path.join(home, ".codex"));
        assert.equal(options.env.CODEX_INSTALL_DIR, path.dirname(expectedWin));
        assert.equal(options.env.CODEX_CA_CERTIFICATE, undefined, "dangling CA cert must be stripped for installer");
        await new Promise(resolve => setTimeout(resolve, 20));
        fs.mkdirSync(path.dirname(expectedWin), { recursive:true });
        fs.writeFileSync(expectedWin, "MZ");
        return { output:"installed" };
      },
    };
    const [firstWin, secondWin] = await Promise.all([installCli("codex-cli", winInstallOpts), installCli("codex-cli", winInstallOpts)]);
    assert.equal(fetchCount, 1, "concurrent Codex installs for the same home+platform are deduplicated");
    assert.equal(firstWin.alreadyInstalled, false);
    assert.equal(firstWin.executable, expectedWin);
    assert.equal(firstWin.version, "codex-cli 0.185.0");
    assert.deepEqual(secondWin, firstWin);
    assert.equal(fs.existsSync(path.join(stateDir, "tools", "codex")), false, "never retains a PenEcho-private tools/codex copy");
    assert.equal(fs.existsSync(path.join(stateDir, "installers", "codex-cli.ps1")), false, "cleans up downloaded installer script");

    // 3. When a legacy broken candidate on PATH fails --version, installs official latest into ~/.local/bin cleanly.
    const brokenDir = path.join(directory, "broken-bin");
    const brokenCodex = path.join(brokenDir, "codex");
    const expectedMac = managedCliPath("codex-cli", { platform:"darwin", home, stateDir });
    fs.mkdirSync(brokenDir, { recursive:true });
    fs.writeFileSync(brokenCodex, "#!/bin/sh\n", { mode:0o755 });
    const repaired = await installCli("codex-cli", {
      platform:"darwin", home, stateDir,
      env:{ HOME:home, PATH:brokenDir },
      appFolders:[],
      systemDirs:[],
      fetchImpl:async url => {
        assert.equal(url, "https://chatgpt.com/codex/install.sh");
        return new Response("#!/bin/sh\n# CODEX_INSTALL_DIR\n", { status:200 });
      },
      runner:async (command, args, options) => {
        if (command === brokenCodex) throw new Error("broken binary");
        if (args[0] === "--version") return { output:"codex-cli 0.185.0" };
        assert.equal(options.env.CODEX_INSTALL_DIR, path.dirname(expectedMac));
        fs.mkdirSync(path.dirname(expectedMac), { recursive:true });
        fs.writeFileSync(expectedMac, "#!/bin/sh\n", { mode:0o755 });
        return { output:"installed" };
      },
    });
    assert.equal(repaired.alreadyInstalled, false);
    assert.equal(repaired.executable, expectedMac);
    assert.equal(repaired.version, "codex-cli 0.185.0");
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});

test("Codex bundle validation requires the platform host beside the CLI", () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-codex-host-test-")),executable=path.join(directory,"codex.exe"),host=path.join(directory,"codex-code-mode-host.exe");
  try {
    fs.writeFileSync(executable,"codex");
    assert.throws(()=>assertCodexCliBundle(executable,"win32"),/codex-code-mode-host\.exe was not found beside codex\.exe/);
    fs.writeFileSync(host,"host");
    assert.deepEqual(assertCodexCliBundle(executable,"win32"),{executable:path.resolve(executable),hostExecutable:host});
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test("automatic Kimi CLI setup validates the official installer and managed executable", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-kimi-install-test-")),
    home = path.join(directory, "home"),
    stateDir = path.join(directory, "state"),
    expected = managedCliPath("kimi-cli", { platform:"darwin", home, stateDir }),
    calls = [];
  try {
    const result = await installCli("kimi-cli", {
      platform:"darwin", home, stateDir,
      fetchImpl:async url => {
        assert.equal(url, "https://code.kimi.com/kimi-code/install.sh");
        return new Response("#!/usr/bin/env bash\nKIMI_BINARY_BASE=https://code.kimi.com/kimi-code/binaries\n", { status:200 });
      },
      runner:async (command, args, options) => {
        calls.push({ command, args, env:options.env });
        if (args[0] === "--version") return { output:"kimi 1.2.3" };
        fs.mkdirSync(path.dirname(expected), { recursive:true });
        fs.writeFileSync(expected, "test");
        return { output:"installed" };
      },
    });
    assert.equal(result.executable, expected);
    assert.equal(result.version, "kimi 1.2.3");
    assert.equal(calls[0].command, "/bin/bash");
    assert.equal(calls[0].env.KIMI_NO_MODIFY_PATH, "1");
    assert.equal(fs.existsSync(path.join(stateDir, "installers", "kimi-cli.sh")), false);

    // Windows Kimi installer uses $KimiBinaryBase (camelCase), which must pass validation.
    const expectedWin = managedCliPath("kimi-cli", { platform:"win32", home, stateDir });
    const winResult = await installCli("kimi-cli", {
      platform:"win32", home, stateDir,
      fetchImpl:async url => {
        assert.equal(url, "https://code.kimi.com/kimi-code/install.ps1");
        return new Response("$KimiBinaryBase = 'https://code.kimi.com/kimi-code/binaries'\n", { status:200 });
      },
      runner:async (_command, args) => {
        if (args[0] === "--version") return { output:"2.7.3" };
        fs.mkdirSync(path.dirname(expectedWin), { recursive:true });
        fs.writeFileSync(expectedWin, "MZ");
        return { output:"installed" };
      },
    });
    assert.equal(winResult.executable, expectedWin);
    assert.equal(winResult.version, "2.7.3");
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});

test("automatic CLI setup supports OpenCode, Pi, omp, Antigravity, and dsh", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-all-agents-install-")),
    home = path.join(directory, "home"),
    stateDir = path.join(directory, "state");
  fs.mkdirSync(home, { recursive:true });
  fs.mkdirSync(stateDir, { recursive:true });
  try {
    assert.equal(canInspectCli("kimi-cli"), true);
    assert.equal(canInspectCli("codex-cli"), true);
    assert.equal(canInspectCli("claude-cli"), true);
    for (const provider of ["opencode-cli", "pi-cli", "omp-cli", "antigravity-cli", "dsh-cli"]) {
      assert.equal(canInspectCli(provider), false);
    }

    // OpenCode macOS (v2 script)
    const expectedOpenCode = managedCliPath("opencode-cli", { platform:"darwin", home, stateDir });
    const oc = await installCli("opencode-cli", {
      platform:"darwin", home, stateDir,
      fetchImpl:async url => {
        assert.equal(url, "https://opencode.ai/v2/install");
        return new Response("#!/usr/bin/env bash\nAPP=opencode\n", { status:200 });
      },
      runner:async (command, args) => {
        if (args[0] === "--version") return { output:"2.4.1" };
        assert.equal(command, "/bin/bash");
        fs.mkdirSync(path.dirname(expectedOpenCode), { recursive:true });
        fs.writeFileSync(expectedOpenCode, "#!/bin/sh\n", { mode:0o755 });
        return { output:"installed" };
      },
    });
    assert.equal(oc.executable, expectedOpenCode);
    assert.equal(oc.version, "2.4.1");

    // Pi macOS (places launcher in ~/.pi/agent/bin/pi or ~/.local/bin/pi)
    const piBin = path.join(home, ".local", "bin", "pi");
    const pi = await installCli("pi-cli", {
      platform:"darwin", home, stateDir,
      fetchImpl:async url => {
        assert.equal(url, "https://pi.dev/install.sh");
        return new Response('#!/bin/sh\nPI_PACKAGE="@earendil-works/pi-coding-agent"\n', { status:200 });
      },
      runner:async (_command, args) => {
        if (args[0] === "--version") return { output:"0.90.0" };
        fs.mkdirSync(path.dirname(piBin), { recursive:true });
        fs.writeFileSync(piBin, "#!/bin/sh\n", { mode:0o755 });
        return { output:"installed" };
      },
    });
    assert.equal(pi.executable, piBin);

    // omp macOS (falls back to omp.sh --binary and PI_INSTALL_DIR=~/.local/bin when GitHub Releases is unavailable)
    const expectedOmp = managedCliPath("omp-cli", { platform:"darwin", home, stateDir });
    const omp = await installCli("omp-cli", {
      platform:"darwin", home, stateDir,
      ompRetryDelayMs:0,
      fetchImpl:async url => {
        if (url === "https://omp.sh/install") return new Response('#!/bin/sh\nREPO="can1357/oh-my-pi"\n', { status:200 });
        return new Response("unavailable", { status:503 });
      },
      runner:async (command, args, options) => {
        if (args[0] === "--version") return { output:"18.9.0" };
        assert.equal(command, "/bin/sh");
        assert.equal(args[1], "--binary");
        assert.equal(options.env.PI_INSTALL_DIR, path.dirname(expectedOmp));
        fs.mkdirSync(path.dirname(expectedOmp), { recursive:true });
        fs.writeFileSync(expectedOmp, "#!/bin/sh\n", { mode:0o755 });
        return { output:"installed" };
      },
    });
    assert.equal(omp.executable, expectedOmp);

    // Antigravity macOS
    const expectedAgy = managedCliPath("antigravity-cli", { platform:"darwin", home, stateDir });
    const agy = await installCli("antigravity-cli", {
      platform:"darwin", home, stateDir,
      fetchImpl:async url => {
        assert.equal(url, "https://antigravity.google/cli/install.sh");
        return new Response('#!/bin/bash\nDOWNLOAD_BASE_URL="https://antigravity-cli-auto-updater"\n', { status:200 });
      },
      runner:async (_command, args) => {
        if (args[0] === "--version") return { output:"2.30.0" };
        fs.mkdirSync(path.dirname(expectedAgy), { recursive:true });
        fs.writeFileSync(expectedAgy, "#!/bin/sh\n", { mode:0o755 });
        return { output:"installed" };
      },
    });
    assert.equal(agy.executable, expectedAgy);

    // dsh via npm (--prefix ~/.local)
    const fakeNpm = path.join(directory, "fake-npm");
    fs.writeFileSync(fakeNpm, "#!/bin/sh\n", { mode:0o755 });
    const expectedDsh = managedCliPath("dsh-cli", { platform:"darwin", home, stateDir });
    const dsh = await installCli("dsh-cli", {
      platform:"darwin", home, stateDir,
      npmExecutable:fakeNpm,
      runner:async (command, args) => {
        if (args[0] === "--version") return { output:"0.2.2" };
        assert.equal(command, fakeNpm);
        assert.deepEqual(args, ["install", "-g", "--prefix", path.join(home, ".local"), "@deepseek-ai/dsh@latest"]);
        fs.mkdirSync(path.dirname(expectedDsh), { recursive:true });
        fs.writeFileSync(expectedDsh, "#!/bin/sh\n", { mode:0o755 });
        return { output:"added 1 package" };
      },
    });
    assert.equal(dsh.executable, expectedDsh);
    assert.equal(dsh.version, "0.2.2");
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});

test("browser-call.js and orch-call.js resolve to app.asar.unpacked when packaged and match forge asar.unpack", async () => {
  const { resolveUnpackedAsarPath:resolveBrowser } = require("../src/server/project-lines/browser-call.js");
  const { resolveUnpackedAsarPath:resolveOrch } = require("../src/server/project-lines/orch-call.js");
  for (const resolveHelper of [resolveBrowser, resolveOrch]) {
    const macAsar = "/Applications/PenEcho.app/Contents/Resources/app.asar/src/server/project-lines/browser-call.js";
    const macUnpacked = "/Applications/PenEcho.app/Contents/Resources/app.asar.unpacked/src/server/project-lines/browser-call.js";
    assert.equal(resolveHelper(macAsar, candidate => candidate === macUnpacked), macUnpacked);
    assert.equal(resolveHelper(macAsar, () => false), macAsar);
    const winAsar = "C:\\Users\\msi\\AppData\\Local\\penecho\\app-1.5.0\\resources\\app.asar\\src\\server\\project-lines\\browser-call.js";
    const winUnpacked = "C:\\Users\\msi\\AppData\\Local\\penecho\\app-1.5.0\\resources\\app.asar.unpacked\\src\\server\\project-lines\\browser-call.js";
    assert.equal(resolveHelper(winAsar, candidate => candidate === winUnpacked), winUnpacked);
    const devPath = "/Users/dev/penecho/src/server/project-lines/browser-call.js";
    assert.equal(resolveHelper(devPath, () => true), devPath);
  }
  const asarDir = path.join(ROOT, "tools", "electron", "node_modules", "@electron", "asar");
  if (fs.existsSync(asarDir)) {
    const asar = require(asarDir);
    const forgeConfig = require("../forge.config.js");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-asar-unpack-"));
    try {
      const stage = path.join(tmp, "app"), archive = path.join(tmp, "app.asar");
      for (const rel of [
        "src/server/project-lines/browser-call.js",
        "src/server/project-lines/orch-call.js",
        "src/server/project-lines/service.js",
        "node_modules/@vscode/ripgrep/bin/rg",
      ]) {
        const dest = path.join(stage, rel);
        fs.mkdirSync(path.dirname(dest), { recursive:true });
        fs.writeFileSync(dest, rel.endsWith(".js") ? "module.exports = {};\n" : "bin");
      }
      await asar.createPackageWithOptions(stage, archive, { unpack:forgeConfig.packagerConfig.asar.unpack });
      assert.equal(fs.existsSync(path.join(tmp, "app.asar.unpacked", "src/server/project-lines/browser-call.js")), true);
      assert.equal(fs.existsSync(path.join(tmp, "app.asar.unpacked", "src/server/project-lines/orch-call.js")), true);
      assert.equal(fs.existsSync(path.join(tmp, "app.asar.unpacked", "node_modules/@vscode/ripgrep/bin/rg")), true);
      assert.equal(fs.existsSync(path.join(tmp, "app.asar.unpacked", "src/server/project-lines/service.js")), false);
    } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
  }
});

test("Windows dsh retries only npm mirror transport failures against the official registry", async t => {
  const { EventEmitter } = require("node:events");
  const { PassThrough } = require("node:stream");
  const mirrorUrl = "https://cdn.npmmirror.com/packages/%40mixmark-io/domino/2.2.0/domino-2.2.0.tgz";
  const npmFailure = (code, url = mirrorUrl) => `npm error code ${code}\nnpm error network request to ${url} failed, reason: socket hang up\n`;
  const mirrorError = npmFailure("ECONNRESET");
  const cases = [
    { name:"configured registry works" },
    { name:"mirror reset is recovered even when outside the displayed output", firstError:mirrorError + "npm error details\n".repeat(120), retries:true },
    { name:"official retry failure is surfaced and stops", firstError:mirrorError, retries:true, retryError:"npm error code E404" },
    { name:"non-network errors are surfaced directly", firstError:npmFailure("EACCES") },
    { name:"other registry failures are surfaced directly", firstError:npmFailure("ECONNRESET", "https://cdn.npmmirror.com.example.org/package.tgz") },
    { name:"version check failures do not trigger reinstall", versionError:mirrorError },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penecho dsh install-"));
    const home = path.join(dir, "home"), stateDir = path.join(dir, "state");
    const env = { APPDATA:path.join(home, "AppData", "Roaming"), npm_config_registry:"https://registry.npmmirror.com/" };
    const executable = managedCliPath("dsh-cli", { platform:"win32", home, stateDir, env });
    const installs = [];
    let versionChecks = 0, retryCache;
    try {
      const install = installCli("dsh-cli", {
        platform:"win32", home, stateDir, env, npmExecutable:path.join(dir, "npm.cmd"),
        runner:(command, args, options) => runProcess(command, args, {
          ...options,
          spawnImpl(_command, childArgs, childOptions) {
            assert.equal(childOptions.windowsVerbatimArguments, true);
            assert.equal(childOptions.env.npm_config_registry, env.npm_config_registry);
            const line = childArgs[3];
            const child = Object.assign(new EventEmitter(), { stdout:new PassThrough(), stderr:new PassThrough() });
            queueMicrotask(() => {
              let error;
              if (line.includes("--version")) {
                versionChecks++;
                error = scenario.versionError;
                if (!error) child.stdout.end("0.2.2\n");
              } else {
                installs.push(line);
                if (installs.length === 1) error = scenario.firstError;
                else {
                  retryCache = / --cache (?:"([^"]+)"|(\S+))"$/.exec(line)?.slice(1).find(Boolean);
                  error = scenario.retryError;
                }
                if (!error) fs.writeFileSync(executable, "@echo off\n");
              }
              if (error) child.stderr.end(error);
              child.emit("close", error ? 1 : 0);
            });
            return child;
          },
        }),
      });
      if (scenario.retryError) await assert.rejects(install, /official npm registry also failed:\nnpm error code E404/);
      else if (scenario.versionError || (scenario.firstError && !scenario.retries)) await assert.rejects(install, /npm error code/);
      else assert.deepEqual(await install, { provider:"dsh-cli", executable, version:"0.2.2", label:"dsh" });

      assert.equal(installs.length, scenario.retries ? 2 : 1);
      assert.equal(installs[0].endsWith(`--prefix "${path.dirname(executable)}" @deepseek-ai/dsh@latest"`), true);
      assert.doesNotMatch(installs[0], /--registry|--cache/);
      if (scenario.retries) {
        assert.ok(installs[1].startsWith(`${installs[0].slice(0, -1)} --registry=https://registry.npmjs.org/ --@deepseek-ai:registry=https://registry.npmjs.org/ --cache `));
        assert.ok(retryCache);
        assert.equal(fs.existsSync(retryCache), false);
      }
      assert.equal(versionChecks, scenario.retryError || (scenario.firstError && !scenario.retries) ? 0 : 1);
    } finally { fs.rmSync(dir, { recursive:true, force:true }); }
  });
});

test("Windows Pi install checks the launcher before registering its folder on user PATH", async () => {
  const { EventEmitter } = require("node:events");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-pi-win-install-")),
    home = path.join(directory, "home"),
    stateDir = path.join(directory, "state");
  fs.mkdirSync(home, { recursive:true });
  fs.mkdirSync(stateDir, { recursive:true });
  try {
    const expectedPi = managedCliPath("pi-cli", { platform:"win32", home, stateDir });
    const piBinDir = path.dirname(expectedPi);
    const scriptPath = path.join(stateDir, "installers", "pi-cli.ps1");
    const calls = [];
    const result = await installCli("pi-cli", {
      platform:"win32",
      home,
      stateDir,
      env:{
        USERPROFILE:home,
        LOCALAPPDATA:path.join(directory, "LocalAppData"),
        APPDATA:path.join(directory, "Roaming"),
        COMSPEC:"C:\\Windows\\System32\\cmd.exe",
        Path:`C:\\Windows\\System32;${piBinDir.toUpperCase()}`,
      },
      fetchImpl:async url => {
        assert.equal(url, "https://pi.dev/install.ps1");
        return new Response('$PiPackage = "@earendil-works/pi-coding-agent"\n', { status:200 });
      },
      runner:async (command, args, options) => {
        calls.push({ command, args, options });
        if (calls.length === 1) {
          assert.match(command, /powershell\.exe$/i);
          assert.equal(options.env.PENECHO_INSTALLER_SCRIPT, scriptPath);
          assert.equal(args.includes("-NonInteractive"), true);
          assert.equal(args.includes("-Command"), true);
          assert.equal(args.includes("-File"), false);
          assert.match(args[args.indexOf("-Command") + 1], /function Read-Host \{ 'n' \};\s*\.\s*\$env:PENECHO_INSTALLER_SCRIPT/);
          const pathEntries = String(options.env.Path || options.env.PATH || "").split(";");
          assert.equal(pathEntries[0], piBinDir, "prepends Pi managed bin directory so Test-InstalledPiIsFirstOnPath passes");
          assert.equal(pathEntries.filter(entry => entry.toLowerCase() === piBinDir.toLowerCase()).length, 1, "deduplicates Pi bin dir case-insensitively");
          fs.mkdirSync(piBinDir, { recursive:true });
          fs.writeFileSync(expectedPi, "@echo off\r\n");
          return { output:"Managed Pi install complete" };
        }
        if (calls.length === 2) {
          assert.equal(command, "C:\\Windows\\System32\\cmd.exe");
          assert.deepEqual(args.slice(0, 3), ["/d", "/s", "/c"]);
          assert.match(args[3], /--version/);
          assert.equal(options.windowsVerbatimArguments, true, "Windows .cmd checks must pass windowsVerbatimArguments");
          return { output:"1.6.0" };
        }
        assert.equal(command, calls[0].command);
        assert.deepEqual(args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
        assert.equal(options.env.PENECHO_PI_BIN_DIR, piBinDir);
        const update = Buffer.from(args[4], "base64").toString("utf16le");
        assert.match(update, /CurrentUser\.CreateSubKey\('Environment'\)/);
        assert.match(update, /DoNotExpandEnvironmentNames/);
        assert.match(update, /SetValue\('Path', \$newPath, \$kind\)/);
        assert.match(update, /SendMessageTimeout/);
        return { output:"" };
      },
    });
    assert.equal(calls.length, 3);
    assert.equal(result.executable, expectedPi);
    assert.equal(result.version, "1.6.0");
    assert.equal(fs.existsSync(scriptPath), false, "cleans up downloaded Windows Pi installer script");

    const spawnCalls = [];
    const fakeSpawn = (command, args, spawnOptions) => {
      spawnCalls.push({ command, args, spawnOptions });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit("data", Buffer.from("1.6.0\n"));
        child.emit("close", 0, null);
      });
      return child;
    };
    await runProcess("cmd.exe", ["/d", "/s", "/c", '"pi.cmd --version"'], { spawnImpl:fakeSpawn, windowsVerbatimArguments:true });
    await runProcess("powershell.exe", ["-NoLogo"], { spawnImpl:fakeSpawn });
    assert.equal(spawnCalls[0].spawnOptions.windowsVerbatimArguments, true);
    assert.equal("windowsVerbatimArguments" in spawnCalls[1].spawnOptions, false);
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});

test("omp CLI setup downloads verified GitHub Releases binaries with Range resume and falls back to omp.sh", async () => {
  const crypto = require("node:crypto");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-omp-gh-install-")),
    home = path.join(directory, "home"),
    stateDir = path.join(directory, "state");
  fs.mkdirSync(home, { recursive:true });
  fs.mkdirSync(stateDir, { recursive:true });
  try {
    // 1. macOS arm64: resolves tag via HEAD redirect, verifies SHA256SUMS.txt, writes executable without invoking omp.sh.
    const macBinary = Buffer.from("#!/bin/sh\necho 19.2.0\n", "utf8");
    const macSha = crypto.createHash("sha256").update(macBinary).digest("hex");
    const expectedMac = managedCliPath("omp-cli", { platform:"darwin", home, stateDir });
    const macUrls = [];
    const macResult = await installCli("omp-cli", {
      platform:"darwin",
      arch:"arm64",
      home,
      stateDir,
      ompRetryDelayMs:0,
      fetchImpl:async (url, init = {}) => {
        macUrls.push(`${init.method || "GET"} ${url}`);
        if (url === "https://github.com/can1357/oh-my-pi/releases/latest") {
          assert.equal(init.method, "HEAD");
          return { ok:true, status:200, url:"https://github.com/can1357/oh-my-pi/releases/tag/v19.2.0", headers:new Headers() };
        }
        if (url === "https://github.com/can1357/oh-my-pi/releases/download/v19.2.0/SHA256SUMS.txt") {
          return new Response(`${macSha}  omp-darwin-arm64\n${"0".repeat(64)}  omp-darwin-x64\n`, { status:200 });
        }
        if (url === "https://github.com/can1357/oh-my-pi/releases/download/v19.2.0/omp-darwin-arm64") {
          return new Response(macBinary, { status:200, headers:{ "content-length":String(macBinary.length) } });
        }
        assert.fail(`unexpected URL: ${url}`);
      },
      runner:async (command, args) => {
        assert.equal(command, expectedMac);
        assert.deepEqual(args, ["--version"]);
        return { output:"19.2.0" };
      },
    });
    assert.equal(macResult.executable, expectedMac);
    assert.equal(macResult.version, "19.2.0");
    assert.deepEqual(fs.readFileSync(expectedMac), macBinary);
    assert.equal((fs.statSync(expectedMac).mode & 0o111) !== 0, true, "installed macOS omp binary is executable");
    assert.equal(macUrls.some(entry => entry.includes("omp.sh")), false, "never hits slow omp.sh when GitHub Releases succeeds");

    // 2. Windows x64: falls back to GitHub API when HEAD lacks a tag URL, resumes via Range after mid-stream error.
    const localAppData = path.join(directory, "LocalAppData");
    const winBinary = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(4096, 0x41), Buffer.alloc(4096, 0x42)]);
    const winSha = crypto.createHash("sha256").update(winBinary).digest("hex");
    const expectedWin = managedCliPath("omp-cli", { platform:"win32", home, stateDir, env:{ LOCALAPPDATA:localAppData } });
    const splitAt = 2048;
    const rangeHeaders = [];
    let downloadCalls = 0;
    const winResult = await installCli("omp-cli", {
      platform:"win32",
      arch:"x64",
      home,
      stateDir,
      env:{ USERPROFILE:home, LOCALAPPDATA:localAppData },
      ompRetryDelayMs:0,
      fetchImpl:async (url, init = {}) => {
        if (url === "https://github.com/can1357/oh-my-pi/releases/latest") {
          return { ok:true, status:200, url, headers:new Headers() };
        }
        if (url === "https://api.github.com/repos/can1357/oh-my-pi/releases/latest") {
          return new Response(JSON.stringify({ tag_name:"v19.2.0" }), { status:200, headers:{ "content-type":"application/json" } });
        }
        if (url === "https://github.com/can1357/oh-my-pi/releases/download/v19.2.0/SHA256SUMS.txt") {
          return new Response(`${winSha}  omp-windows-x64.exe\n`, { status:200 });
        }
        if (url === "https://github.com/can1357/oh-my-pi/releases/download/v19.2.0/omp-windows-x64.exe") {
          downloadCalls += 1;
          const range = init.headers?.Range || "";
          rangeHeaders.push(range);
          if (downloadCalls === 1) {
            let sent = false;
            const stream = new ReadableStream({
              pull(controller) {
                if (!sent) {
                  sent = true;
                  controller.enqueue(winBinary.subarray(0, splitAt));
                } else {
                  controller.error(new Error("HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR"));
                }
              },
            });
            return new Response(stream, { status:200, headers:{ "content-length":String(winBinary.length) } });
          }
          assert.equal(range, `bytes=${splitAt}-`);
          const rest = winBinary.subarray(splitAt);
          return new Response(rest, {
            status:206,
            headers:{
              "content-length":String(rest.length),
              "content-range":`bytes ${splitAt}-${winBinary.length - 1}/${winBinary.length}`,
            },
          });
        }
        assert.fail(`unexpected URL: ${url}`);
      },
      runner:async (command, args) => {
        assert.equal(command, expectedWin);
        assert.deepEqual(args, ["--version"]);
        return { output:"19.2.0" };
      },
    });
    assert.equal(winResult.executable, expectedWin);
    assert.equal(winResult.version, "19.2.0");
    assert.deepEqual(rangeHeaders, ["", `bytes=${splitAt}-`]);
    assert.deepEqual(fs.readFileSync(expectedWin), winBinary);

    // 3. Checksum mismatch rejects corrupt GitHub binary, cleans partial files, and surfaces both errors when omp.sh also fails.
    const badHome = path.join(directory, "bad-home");
    fs.mkdirSync(badHome, { recursive:true });
    await assert.rejects(installCli("omp-cli", {
      platform:"darwin",
      arch:"arm64",
      home:badHome,
      stateDir,
      ompMaxAttempts:2,
      ompRetryDelayMs:0,
      fetchImpl:async url => {
        if (url === "https://github.com/can1357/oh-my-pi/releases/latest") {
          return { ok:true, status:200, url:"https://github.com/can1357/oh-my-pi/releases/tag/v19.2.0", headers:new Headers() };
        }
        if (url === "https://github.com/can1357/oh-my-pi/releases/download/v19.2.0/SHA256SUMS.txt") {
          return new Response(`${"a".repeat(64)}  omp-darwin-arm64\n`, { status:200 });
        }
        if (url === "https://github.com/can1357/oh-my-pi/releases/download/v19.2.0/omp-darwin-arm64") {
          return new Response(Buffer.from("corrupt"), { status:200, headers:{ "content-length":"7" } });
        }
        if (url === "https://omp.sh/install") {
          return new Response('#!/bin/sh\nREPO="can1357/oh-my-pi"\n', { status:200 });
        }
        assert.fail(`unexpected URL: ${url}`);
      },
      runner:async () => { throw new Error("curl: (92) HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR (err 2)"); },
    }), /GitHub Releases download failed \(Checksum mismatch[\s\S]*Official installer fallback also failed:\ncurl: \(92\)/);
    const badBinDir = path.join(badHome, ".local", "bin");
    assert.deepEqual(fs.existsSync(badBinDir) ? fs.readdirSync(badBinDir) : [], [], "leaves no partial or corrupt omp binary behind");

    // 4. Desktop main IPC tracks CLI installs per provider so installing omp does not block Kimi.
    const desktopMain = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8");
    assert.match(desktopMain, /cliOperations = new Set\(\)/);
    assert.match(desktopMain, /if \(cliOperations\.has\(key\)\)/);
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});
