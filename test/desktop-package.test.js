"use strict";

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
const { CODEX_CLI_PINNED_VERSION, assertCodexCliBundle, codexHostName, inspectCli, installCli, installInvocation, managedCliPath } = require("../desktop/cli-installer.js");
const { pathExecutables } = require("../src/providers/cli-discovery.js");
const {
  RELEASE_API_URL, createUpdateManager, downloadReleaseAsset, expectedAssetName, installDownloadedUpdate, macBundlePath, releaseAsset,
} = require("../desktop/update-manager.js");
const { isPrivateIpv4, lanHosts, lanUrls } = require("../desktop/network-access.js");
const { desktopConfigurationEnvironment } = require("../desktop/config-environment.js");
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
  assert.equal(publicSettings({ env:{} }).canvasAgentAutoOpen, true);
  assert.equal(publicSettings({ env:{} }).canvasAgentTurnLimit,"100");
  assert.equal(publicSettings({ env:{ PENECHO_CANVAS_AGENT_TURN_LIMIT:"275" } }).canvasAgentTurnLimit,"275");
  assert.equal(publicSettings({ env:{ PENECHO_CANVAS_AGENT_AUTO_OPEN:"false" } }).canvasAgentAutoOpen, false);
  assert.equal(normalizeSettings(base({ autoDelay:undefined })).updates.AUTO_AI_DELAY_SECONDS, "5");
  assert.equal(normalizeSettings(base({ canvasAgentAutoOpen:false })).updates.PENECHO_CANVAS_AGENT_AUTO_OPEN, "false");
  assert.equal(normalizeSettings(base({ canvasAgentAutoOpen:undefined })).updates.PENECHO_CANVAS_AGENT_AUTO_OPEN, "true");
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
  assert.match(main, /mainWindow.webContents.send\("penecho:show-connections"\)/);
  assert.match(canvasPreload, /onShowConnections:listener/);
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
  assert.match(main, /configuration\.env\.PENECHO_CONFIG_FILE = configuration\.configFile;\s*applyEnvironment\(configuration\);[\s\S]*?server = require\("\.\.\/server\.js"\)/);
  assert.match(serverMain, /const CONNECTIONS_FILE = STATE_DIRECTORY\s*\? path\.join\(STATE_DIRECTORY, "connections\.json"\)/);
  assert.match(serverMain, /\/api\/settings\/connections\/inspect-cli/);
  assert.match(serverMain, /status:await inspectConnectionCli\(provider\)/);
  assert.match(main, /configuration\.env\.HOST\) configuration\.env\.HOST = "0\.0\.0\.0"/);
  assert.match(main, /const DESKTOP_VERSION = pkg\.config\?\.desktopVersion \|\| pkg\.version/);
  assert.match(main, /createUpdateManager/);
  assert.match(main, /createUpdateManager\(\{[\s\S]*?currentVersion:DESKTOP_VERSION/);
  assert.match(main, /updateManager\.start\(\)/);
  assert.match(main, /Check for Updates/);
  assert.match(main, /Check for Updates…", click:showUpdateWindow/);
  assert.match(main, /UPDATE_WINDOW_PRELOAD = path\.join\(__dirname, "update-window-preload\.js"\)/);
  assert.match(main, /UPDATE_WINDOW_HTML = path\.join\(__dirname, "update-window\.html"\)/);
  assert.match(main, /visible:state\.visible && !updateWindowVisible/);
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
  assert.match(main, /issueNativePickerGrant.*require\("\.\.\/src\/server\/canvas-agent\/native-picker-grants\.js"\)/);
  assert.doesNotMatch(canvasPreload, /openSettings/);
  assert.match(canvasPreload, /\["darwin", "win32"\]\.includes\(process\.platform\)/);
  assert.match(canvasPreload, /`Update available\$\{version\}`/);
  assert.match(canvasPreload, /有新版本/);
  assert.match(canvasPreload, /download:"Download"/);
  assert.match(canvasPreload, /download:"下载"/);
  assert.doesNotMatch(canvasPreload, /desktop-update-progress|element\("progress"/);
  assert.match(canvasPreload, /document\.querySelector\("main > footer"\)/);
  assert.match(canvasPreload, /\(footer \|\| document\.body\)\.append\(prompt\)/);
  assert.match(canvasPreload, /prompt\.id = "desktopUpdatePrompt"/);
  assert.match(canvasPreload, /data-pe-surface", "toast"/);
  assert.match(canvasPreload, /data-pe-presentation", "anchored"/);
  assert.match(updateCss, /main > footer \{ position: relative; \}/);
  assert.match(updateCss, /#desktopUpdatePrompt\.desktop-update-prompt\s*\{[\s\S]*?position: absolute;[\s\S]*?top: 50%;[\s\S]*?right: 4px;[\s\S]*?height: 22px;[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.doesNotMatch(updateCss, /grid-column:\s*4|penecho-desktop-update-visible\s*\{[^}]*grid-template-columns/);
  assert.match(updateCss, /#desktopUpdatePrompt \.desktop-update-row\s*\{[^}]*height: 22px;/);
  assert.match(updateCss, /#desktopUpdatePrompt \.desktop-update-primary\s*\{[^}]*height: 18px;[^}]*min-height: 18px;[^}]*max-height: 18px;[^}]*border-radius: 5px;/);
  assert.match(updateCss, /#desktopUpdatePrompt \.desktop-update-actions \.desktop-update-close\s*\{[^}]*width: 18px;[^}]*min-width: 18px;[^}]*max-width: 18px;[^}]*height: 18px;[^}]*min-height: 18px;[^}]*max-height: 18px;[^}]*border: 0;[^}]*background: transparent;/);
  assert.match(updateCss, /#desktopUpdatePrompt \.desktop-update-close:hover\s*\{[^}]*border: 0;[^}]*background: transparent;/);
  assert.doesNotMatch(updateCss, /min-height:\s*(?:2[5-9]|[3-9]\d)px|box-shadow:\s*0 [1-9]/);
  assert.match(updateWindowHtml, /Content-Security-Policy/);
  assert.doesNotMatch(updateWindowHtml, /<style|<script(?! src)/);
  assert.match(updateWindowHtml, /role="progressbar"/);
  assert.match(updateWindowHtml, /id="release-button"/);
  assert.match(updateWindowCss, /grid-template-rows: auto 1fr auto/);
  assert.match(updateWindowCss, /prefers-reduced-motion: reduce/);
  assert.match(updateWindowJs, /The download will continue in the background/);
  assert.match(updateWindowJs, /下载会在后台继续/);
  assert.match(updateWindowJs, /currentState\.status === "available"\) await api\.download\(\)/);
  assert.match(updateWindowJs, /currentState\.status === "ready" \|\| currentState\.ready/);
  assert.match(updateWindowPreload, /openReleasePage:\(\) => invoke\("penecho:update-open-release-page"\)/);
  assert.match(updateWindowPreload, /close:\(\) => invoke\("penecho:update-window-close"\)/);
  assert.doesNotMatch(updateWindowPreload, /update-dismiss/);
  assert.match(main, /label:"Settings…"[\s\S]*?click:showSettings/);
  assert.match(serverMain, /canvasAgentAutoOpen:CANVAS_AGENT_AUTO_OPEN/);
  assert.match(forge, /node_modules\/\{sharp,@img,@vscode\}/);
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
  assert.equal(rootPackage.version, "1.3.2");
  assert.equal(rootPackage.config.desktopVersion, "1.3.2");
  assert.ok(rootPackage.files.includes("src/"));
  for (const asset of ["public/access.html", "public/access.css", "public/access.js"]) {
    assert.ok(rootPackage.files.includes(asset), asset);
  }
  assert.ok(rootPackage.files.includes("public/desktop-update.css"));
  assert.ok(rootPackage.files.includes("public/penecho-mark.png"));
});

test("README logo is a compact WebP with transparent background and letter counters", async () => {
  const logo = path.join(ROOT, "public", "penecho-readme-header.webp"),
    metadata = await sharp(logo).metadata(),
    pixels = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  assert.deepEqual(fs.readFileSync(path.join(ROOT, "build/brand/penecho-logo.png")), fs.readFileSync(path.join(ROOT, "build/brand/penecho-logo-original.png")), "the supplied transparent PNG must remain byte-for-byte unchanged");
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 840);
  assert.equal(metadata.hasAlpha, true);
  assert.ok(require("../package.json").files.includes("public/penecho-readme-header.webp"));
  const at = (x, y) => pixels.data[(y * pixels.info.width + x) * 4 + 3];
  assert.equal(at(0, 0), 0);
  assert.equal(at(Math.floor(metadata.width / 2), Math.floor(metadata.height / 3)), 0, "symbol interior stays transparent");
  assert.equal(at(53, 630), 0, "the counter inside the P stays transparent");
  let transparent = 0;
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] === 0) transparent++;
  assert.ok(transparent > metadata.width * metadata.height * .6);
  const readmes = ["README.md", ...fs.readdirSync(path.join(ROOT, "docs/readme")).filter(file => /^README.*\.md$/.test(file)).map(file => "docs/readme/" + file)];
  for (const file of readmes) assert.match(fs.readFileSync(path.join(ROOT, file), "utf8"), /penecho-readme-header\.webp" alt="PenEcho" width="280"/);
  for (const file of readmes) assert.match(fs.readFileSync(path.join(ROOT, file), "utf8"), /prefers-color-scheme: dark[\s\S]*?penecho-readme-header-dark\.webp/);
  const dark = await sharp(path.join(ROOT, "public/penecho-readme-header-dark.webp")).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  assert.equal(dark.info.width, metadata.width);
  assert.equal(dark.info.height, metadata.height);
  assert.ok(brandPixels(dark.data).white > 10000, "dark README must use light lettering");
  const favicon = await sharp(path.join(ROOT, "public/penecho-favicon.png")).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  assert.equal(favicon.info.width, 256);
  assert.equal(favicon.data[3], 0, "favicon outer corners remain transparent");
  assert.ok(brandPixels(favicon.data).white > 20000, "white favicon plate protects the black circular dot on dark tabs");
});

function brandPixels(data, channels = 4) {
  const counts = { transparent:0, ink:0, orange:0, pink:0, white:0 };
  for (let i = 0; i < data.length; i += channels) {
    const [r, g, b, a] = data.subarray(i, i + 4);
    if (a === 0) counts.transparent++;
    if (a < 128) continue;
    if (r < 60 && g < 60 && b < 60) counts.ink++;
    if (r > 190 && g > 70 && g < 195 && b < 100) counts.orange++;
    if (r > 190 && g < 110 && b > 110) counts.pink++;
    if (r > 240 && g > 240 && b > 240) counts.white++;
  }
  return counts;
}

test("Windows installer animation shows the full color logo and image-based wordmark", async () => {
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
    assert.ok(counts.orange > 20 && counts.pink > 20, "installer must retain the brand gradient");
    const lettering = framePixels.subarray(100 * 268 * 4, 126 * 268 * 4);
    assert.ok(brandPixels(lettering).ink > 80, "PenEcho letters remain visible below the symbol");
    assert.ok(counts.white > 35000, "background remains clean white");
  }
});

test("desktop icons retain the color symbol, white Mac tile and transparent Windows background", async () => {
  const ico = fs.readFileSync(path.join(ROOT, "build/icons/penecho.ico")),
    icns = fs.readFileSync(path.join(ROOT, "build/icons/penecho.icns"));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 5, "Windows ICO includes multiple resolutions");
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
    assert.ok(counts.orange > 1000 && counts.pink > 1000, "color gradient must survive icon generation");
    assert.ok(counts.ink > 1000, "disconnected black circular dot remains visible");
    assert.equal(pixels.data[3], 0, "outer corners stay transparent");
  }
  assert.ok(brandPixels(windows.data).transparent > 600000);
  assert.ok(brandPixels(mac.data).white > 300000);
  const center = (512 * 1024 + 512) * 4;
  assert.equal(windows.data[center + 3], 0, "symbol center is empty rather than a pen or text");
  assert.deepEqual([...mac.data.subarray(center, center + 4)], [255, 255, 255, 255]);
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
  assert.match(handler, /pickerToken:issueNativePickerGrant\(\{ selectedPath, kind:"file" \}\)/);
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
  assert.equal(downloads[0].destination, path.join("/tmp", "penecho-updates", "PenEcho-0.7.1-mac-arm64.zip"));
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

test("unsigned Windows updater launches the downloaded Squirrel Setup silently", async () => {
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
  assert.deepEqual(calls[0].args, ["--silent"]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(app.quitCalled, true);
});

test("desktop CLI setup uses official installers without requiring npm", () => {
  const options = { platform:"darwin", home:"/Users/example", stateDir:"/Users/example/Library/Application Support/PenEcho" },
    resolvedHome = path.resolve(options.home), resolvedStateDir = path.resolve(options.stateDir),
    kimiPath = managedCliPath("kimi-cli", options),
    codexPath = managedCliPath("codex-cli", options),
    claudePath = managedCliPath("claude-cli", options),
    kimi = installInvocation("kimi-cli", "/tmp/kimi.sh", options),
    codex = installInvocation("codex-cli", "/tmp/codex.sh", options),
    latestCodex = installInvocation("codex-cli", "/tmp/codex.sh", { ...options, codexVersion:"latest" }),
    claude = installInvocation("claude-cli", "/tmp/claude.sh", options);
  assert.equal(kimiPath, path.join(resolvedStateDir, "tools", "kimi", "bin", "kimi"));
  assert.equal(codexPath, path.join(resolvedStateDir, "tools", "codex", "bin", "codex"));
  assert.equal(claudePath, path.join(resolvedHome, ".local", "bin", "claude"));
  assert.equal(kimi.command, "/bin/bash");
  assert.equal(kimi.env.KIMI_INSTALL_DIR, path.dirname(path.dirname(kimiPath)));
  assert.equal(kimi.env.KIMI_NO_MODIFY_PATH, "1");
  assert.equal(codex.command, "/bin/sh");
  assert.equal(codex.env.CODEX_NON_INTERACTIVE, "1");
  assert.equal(codex.env.CODEX_RELEASE, CODEX_CLI_PINNED_VERSION);
  assert.equal(latestCodex.env.CODEX_RELEASE, "latest");
  assert.equal(codex.env.CODEX_INSTALL_DIR, path.dirname(codexPath));
  assert.equal(codex.env.CODEX_HOME, path.join(resolvedStateDir,"tools","codex","home"));
  assert.deepEqual(claude.args, ["/tmp/claude.sh", "stable"]);
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

  const ready = await inspectCli("codex-cli", { ...options, platform:"darwin", preflight:async () => ({ ok:true, source:"managed", executable:"/tmp/codex", version:"codex 1.2.3" }) });
  assert.deepEqual({ state:ready.state, source:ready.source, executable:ready.executable, version:ready.version }, { state:"ready", source:"managed", executable:"/tmp/codex", version:"codex 1.2.3" });

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

test("automatic CLI setup validates the official script and installed executable", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cli-install-test-")), home = path.join(directory, "home"), stateDir = path.join(directory, "state"),
    expected = managedCliPath("codex-cli", { platform:"darwin", home, stateDir }), calls = [];
  try {
    const result = await installCli("codex-cli", {
      platform:"darwin", home, stateDir,
      fetchImpl:async url => {
        assert.equal(url, "https://chatgpt.com/codex/install.sh");
        return new Response("#!/bin/sh\n# CODEX_INSTALL_DIR\n", { status:200 });
      },
      runner:async (command, args, options) => {
        calls.push({ command, args, env:options.env });
        if (args[0] === "--version") return { output:`codex-cli ${CODEX_CLI_PINNED_VERSION}` };
        const staged=path.join(options.env.CODEX_INSTALL_DIR,"codex");
        fs.mkdirSync(path.dirname(staged), { recursive:true });
        fs.writeFileSync(staged, "test");
        fs.writeFileSync(path.join(path.dirname(staged),codexHostName("darwin")),"host");
        fs.writeFileSync(path.join(path.dirname(staged),"runtime-sidecar"),"sidecar");
        return { output:"installed" };
      },
    });
    assert.equal(result.executable, expected);
    assert.equal(result.version, `codex-cli ${CODEX_CLI_PINNED_VERSION}`);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].env.CODEX_HOME,path.join(stateDir,"tools","codex","home"));
    assert.equal(calls[0].env.CODEX_RELEASE,CODEX_CLI_PINNED_VERSION);
    assert.notEqual(calls[0].env.CODEX_HOME,path.join(home,".codex"));
    assert.ok(calls[0].env.CODEX_INSTALL_DIR.startsWith(path.join(stateDir,"installers")));
    assert.equal(fs.readFileSync(expected,"utf8"),"test");
    assert.equal(fs.readFileSync(path.join(path.dirname(expected),"codex-code-mode-host"),"utf8"),"host");
    assert.equal(fs.readFileSync(path.join(path.dirname(expected),"runtime-sidecar"),"utf8"),"sidecar");
    assert.equal(fs.existsSync(path.join(stateDir, "installers", "codex-cli.sh")), false);
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});

test("automatic Codex setup keeps the existing managed CLI when the downloaded version is not pinned", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cli-version-test-")), home = path.join(directory, "home"), stateDir = path.join(directory, "state"),
    expected = managedCliPath("codex-cli", { platform:"darwin", home, stateDir });
  try {
    fs.mkdirSync(path.dirname(expected), { recursive:true });
    fs.writeFileSync(expected, "known-good");
    fs.writeFileSync(path.join(path.dirname(expected),"codex-code-mode-host"),"known-good-host");
    await assert.rejects(()=>installCli("codex-cli", {
      platform:"darwin", home, stateDir,
      fetchImpl:async () => new Response("#!/bin/sh\n# CODEX_INSTALL_DIR\n", { status:200 }),
      runner:async (_command, args, options) => {
        if (args[0] === "--version") return { output:"codex-cli 0.150.1" };
        const staged=path.join(options.env.CODEX_INSTALL_DIR,"codex");
        fs.mkdirSync(path.dirname(staged), { recursive:true });
        fs.writeFileSync(staged, "unapproved");
        fs.writeFileSync(path.join(path.dirname(staged),"codex-code-mode-host"),"unapproved-host");
        return { output:"installed" };
      },
    }), error => {
      assert.equal(error.code,"CODEX_CLI_VERSION_INCOMPATIBLE");
      assert.equal(error.expectedVersion,CODEX_CLI_PINNED_VERSION);
      assert.equal(error.actualVersion,"0.150.1");
      return true;
    });
    assert.equal(fs.readFileSync(expected,"utf8"),"known-good");
    assert.equal(fs.readFileSync(path.join(path.dirname(expected),"codex-code-mode-host"),"utf8"),"known-good-host");
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

test("automatic Windows Codex setup publishes the host and sidecars with codex.exe", async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-win-codex-install-test-")),home=path.join(directory,"home"),stateDir=path.join(directory,"state"),
    executable=managedCliPath("codex-cli",{platform:"win32",home,stateDir}),bin=path.dirname(executable);
  try {
    const result=await installCli("codex-cli",{
      platform:"win32",home,stateDir,
      fetchImpl:async()=>new Response("# CODEX_INSTALL_DIR\n",{status:200}),
      runner:async(_command,args,options)=>{
        if(args[0]==="--version")return{output:`codex-cli ${CODEX_CLI_PINNED_VERSION}`};
        fs.mkdirSync(options.env.CODEX_INSTALL_DIR,{recursive:true});
        fs.writeFileSync(path.join(options.env.CODEX_INSTALL_DIR,"codex.exe"),"codex");
        fs.writeFileSync(path.join(options.env.CODEX_INSTALL_DIR,"codex-code-mode-host.exe"),"host");
        fs.writeFileSync(path.join(options.env.CODEX_INSTALL_DIR,"codex-command-runner.exe"),"sidecar");
        return{output:"installed"};
      },
    });
    assert.equal(result.executable,executable);
    assert.equal(result.hostExecutable,path.join(bin,"codex-code-mode-host.exe"));
    assert.equal(fs.readFileSync(path.join(bin,"codex-code-mode-host.exe"),"utf8"),"host");
    assert.equal(fs.readFileSync(path.join(bin,"codex-command-runner.exe"),"utf8"),"sidecar");
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test("automatic Codex setup keeps the old bundle when the staged host is missing", async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-codex-missing-host-install-test-")),home=path.join(directory,"home"),stateDir=path.join(directory,"state"),
    executable=managedCliPath("codex-cli",{platform:"darwin",home,stateDir}),host=path.join(path.dirname(executable),"codex-code-mode-host");
  try {
    fs.mkdirSync(path.dirname(executable),{recursive:true});
    fs.writeFileSync(executable,"old-codex");
    fs.writeFileSync(host,"old-host");
    await assert.rejects(()=>installCli("codex-cli",{
      platform:"darwin",home,stateDir,
      fetchImpl:async()=>new Response("# CODEX_INSTALL_DIR\n",{status:200}),
      runner:async(_command,_args,options)=>{
        fs.mkdirSync(options.env.CODEX_INSTALL_DIR,{recursive:true});
        fs.writeFileSync(path.join(options.env.CODEX_INSTALL_DIR,"codex"),"new-codex");
        return{output:"installed"};
      },
    }),/codex-code-mode-host was not found beside codex/);
    assert.equal(fs.readFileSync(executable,"utf8"),"old-codex");
    assert.equal(fs.readFileSync(host,"utf8"),"old-host");
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
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});
