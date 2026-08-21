"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { kimiPresetUpdates, normalizeSettings, publicSettings } = require("../desktop/settings-contract.js");
const { readSecret, writeSecret } = require("../desktop/secret-store.js");
const { installCli, installInvocation, managedCliPath } = require("../desktop/cli-installer.js");
const {
  RELEASE_API_URL, createUpdateManager, downloadReleaseAsset, expectedAssetName, installDownloadedUpdate, macBundlePath, releaseAsset,
} = require("../desktop/update-manager.js");
const { isPrivateIpv4, lanHosts, lanUrls } = require("../desktop/network-access.js");
const { desktopConfigurationEnvironment } = require("../desktop/config-environment.js");
const { parseArgs, resolveConfiguration } = require("../cli.js");

const ROOT = path.resolve(__dirname, "..");

function base(overrides = {}) {
  return {
    provider:"api", apiFormat:"openai", apiUrl:"https://api.openai.com/v1", apiModel:"gpt-5.6-sol", apiKey:"secret",
    effort:"medium", imageFormat:"webp", timeout:"180", autoDelay:"1.2", host:"127.0.0.1", port:"3888",
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
  assert.equal(normalizeSettings(base({ autoDelay:undefined })).updates.AUTO_AI_DELAY_SECONDS, "5");
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

test("desktop LAN addresses prefer physical private IPv4 interfaces", () => {
  const hosts = lanHosts({
    en0:[{ address:"192.168.1.20", family:"IPv4", internal:false }],
    en1:[{ address:"10.0.0.5", family:"IPv4", internal:false }],
    utun4:[{ address:"172.16.0.2", family:"IPv4", internal:false }],
    lo0:[{ address:"127.0.0.1", family:"IPv4", internal:true }],
  });
  assert.deepEqual(hosts, ["10.0.0.5", "192.168.1.20"]);
  assert.equal(isPrivateIpv4("172.31.255.1"), true);
  assert.equal(isPrivateIpv4("172.32.0.1"), false);
  assert.deepEqual(lanUrls(3888, hosts), ["http://10.0.0.5:3888/", "http://192.168.1.20:3888/"]);
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
    preload = fs.readFileSync(path.join(ROOT, "desktop", "preload.js"), "utf8"),
    canvasPreload = fs.readFileSync(path.join(ROOT, "desktop", "canvas-preload.js"), "utf8"),
    updateCss = fs.readFileSync(path.join(ROOT, "public", "desktop-update.css"), "utf8"),
    forge = fs.readFileSync(path.join(ROOT, "forge.config.js"), "utf8"),
    html = fs.readFileSync(path.join(ROOT, "desktop", "settings", "index.html"), "utf8"),
    settings = fs.readFileSync(path.join(ROOT, "desktop", "settings", "settings.js"), "utf8"),
    rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(main, /contextIsolation:true/);
  assert.match(main, /nodeIntegration:false/);
  assert.match(main, /sandbox:true/);
  assert.match(main, /PENECHO_PRIVATE_PLUGIN_DIR/);
  assert.match(main, /Object\.assign\(configuration\.env, kimiPresetUpdates\(configuration\)\)/);
  assert.match(main, /desktopConfigurationEnvironment\(process\.env, paths\.stateDir\)/);
  assert.match(main, /stateDir = app\.getPath\("userData"\)/);
  assert.match(main, /configuration\.env\.PENECHO_CONFIG_FILE = configuration\.configFile;\s*applyEnvironment\(configuration\);[\s\S]*?server = require\("\.\.\/server\.js"\)/);
  assert.match(serverMain, /const CONNECTIONS_FILE = STATE_DIRECTORY\s*\? path\.join\(STATE_DIRECTORY, "connections\.json"\)/);
  assert.match(serverMain, /if \(error\?\.code === "ENOENT"\) return \{ defaultName:"Default connection", connections:\[\] \}/);
  assert.match(serverMain, /fs\.mkdirSync\(path\.dirname\(CONNECTIONS_FILE\), \{ recursive:true, mode:0o700 \}\);[\s\S]*?fs\.renameSync\(temporary, CONNECTIONS_FILE\)/);
  assert.match(main, /configuration\.env\.HOST\) configuration\.env\.HOST = "0\.0\.0\.0"/);
  assert.match(main, /createUpdateManager/);
  assert.match(main, /updateManager\.start\(\)/);
  assert.match(main, /Check for Updates/);
  assert.match(main, /macUpdateMenu/);
  assert.match(main, /Install Update/);
  assert.match(main, /--squirrel-\(\?:install\|updated\|uninstall\|obsolete\)/);
  assert.doesNotMatch(main, /setProgressBar/);
  assert.doesNotMatch(main, /\bautoUpdater\b/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /installCli/);
  assert.doesNotMatch(preload, /loginCli/);
  assert.match(preload, /copyText/);
  assert.match(canvasPreload, /penechoDesktopUpdate/);
  assert.match(canvasPreload, /installCli:provider => ipcRenderer\.invoke\("penecho:install-cli", provider\)/);
  assert.doesNotMatch(canvasPreload, /openSettings/);
  assert.match(canvasPreload, /process\.platform !== "win32"/);
  assert.match(canvasPreload, /What's new/);
  assert.match(canvasPreload, /desktop-update-progress/);
  assert.match(updateCss, /\.desktop-update-banner/);
  assert.match(updateCss, /\.desktop-update-notes/);
  assert.match(main, /\["api", "kimi"\]\.includes\(normalized\.provider\)/);
  assert.match(main, /if \(!configurationIsReady\(loaded\)\) \{\s*showSettings\(\);\s*return;/);
  assert.match(main, /label:"Settings…"[\s\S]*?click:showSettings/);
  assert.match(main, /if \(!fromCanvas\(event\) && !fromSetup\) return \{ ok:false/);
  assert.match(main, /window\.loadFile\(SETTINGS_FILE\)\.then\(reveal\)/);
  assert.match(main, /settingsReadyToLaunch = true;[\s\S]*?ok:false,[\s\S]*?saved:true/);
  assert.match(main, /SETTINGS_TEST_TIMEOUT_MS = 30_000/);
  assert.match(main, /Promise\.race\(\[[\s\S]*?testConfiguredProvider\(loaded\.configuration, \{ timeoutMs:SETTINGS_TEST_TIMEOUT_MS \}\)[\s\S]*?PENECHO_SETTINGS_TEST_TIMEOUT/);
  assert.match(main, /timedOut:\["PENECHO_SETTINGS_TEST_TIMEOUT", "PENECHO_CONNECTION_TEST_TIMEOUT"\]\.includes\(error\.code\)/);
  assert.match(settings, /Launch anyway/);
  assert.match(settings, /setStatus\("success"[\s\S]*?const launched = await desktop\.launch\(\)/);
  assert.match(settings, /result\.timedOut[\s\S]*?Connection test timed out[\s\S]*?still launch PenEcho and enter the canvas/);
  assert.match(settings, /连接测试超过 30 秒，你仍然可以启动 PenEcho 进入画布/);
  assert.match(settings, /KIMI_MODELS = Object\.freeze\(\{ code:"k3", platform:"kimi-k3" \}\)/);
  assert.match(settings, /kimiProduct\.addEventListener\("change", \(\) => updateKimiEndpoint\(true, true\)\)/);
  assert.match(settings, /if \(activeProvider === "kimi"\) repairKimiPreset\(\)/);
  assert.match(settings, /activeProvider = settings\.provider;[\s\S]*?repairKimiPreset\(\);[\s\S]*?captureApiDraft\(activeProvider\)/);
  assert.match(settings, /provider\(\) === "kimi" && value\("kimiProduct"\) === "platform"/);
  assert.match(settings, /anthropicOption\.disabled = kimiPlatform/);
  assert.match(forge, /node_modules\/\{sharp,@img\}/);
  assert.match(forge, /readPackageJson/);
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
  assert.match(html, /Test, save &amp; launch/);
  assert.match(html, />Install<\/button>/);
  assert.doesNotMatch(html, /Sign in|data-login-cli/);
  assert.match(html, /PenEcho is a Kimi 2026 Open Source Partner/);
  assert.match(settings, /PenEcho 是 Kimi 2026 开源合作伙伴/);
  assert.match(html, /value="kimi-cli"/);
  assert.equal(html.match(/name="provider" value="([^"]+)"/)?.[1], "kimi");
  const kimiGroup = html.match(/<section class="provider-group kimi-provider-group"[\s\S]*?<\/section>/)?.[0] || "",
    otherGroup = html.match(/<section class="provider-group" aria-labelledby="otherProviderGroupTitle"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(kimiGroup, /value="kimi"/);
  assert.match(kimiGroup, /value="kimi-cli"/);
  assert.match(otherGroup, /value="api"/);
  assert.match(otherGroup, /value="codex-cli"/);
  assert.match(otherGroup, /value="claude-cli"/);
  assert.ok(html.indexOf("kimi-provider-group") < html.indexOf("otherProviderGroupTitle"));
  assert.equal(rootPackage.version, "1.0.1");
  assert.match(html, /data-install-cli="kimi-cli"/);
  assert.match(html, /github\.com\/MoonshotAI\/kimi-code/);
  assert.match(html, /data-i18n="installGuide">Guide<\/a>/);
  assert.match(fs.readFileSync(path.join(ROOT, "desktop", "settings", "settings.css"), "utf8"), /\.inline-primary,\.inline-secondary\{[^}]*display:inline-flex[^}]*text-decoration:none/);
  assert.match(settings, /\["kimi-cli", "codex-cli", "claude-cli"\]\.includes\(selected\)/);
  assert.match(settings, /"kimi-cli":"kimiCliPath"/);
  assert.ok(rootPackage.files.includes("src/"));
  for (const asset of ["public/access.html", "public/access.css", "public/access.js"]) {
    assert.ok(rootPackage.files.includes(asset), asset);
  }
  assert.ok(rootPackage.files.includes("public/desktop-update.css"));
  assert.match(html, /value="0\.0\.0\.0" selected/);
  assert.match(html, /platform\.kimi\.com\?aff=penecho/);
  assert.match(html, /platform\.kimi\.ai\?aff=penecho/);
  assert.match(html, /Content-Security-Policy/);
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
  assert.equal(downloads[0].destination, "/tmp/penecho-updates/PenEcho-0.7.1-mac-arm64.zip");
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
  assert.equal(macBundlePath("/Applications/PenEcho.app/Contents/MacOS/PenEcho"), "/Applications/PenEcho.app");
  assert.equal(macBundlePath("/tmp/PenEcho"), "");
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
    kimiPath = managedCliPath("kimi-cli", options),
    codexPath = managedCliPath("codex-cli", options),
    claudePath = managedCliPath("claude-cli", options),
    kimi = installInvocation("kimi-cli", "/tmp/kimi.sh", options),
    codex = installInvocation("codex-cli", "/tmp/codex.sh", options),
    claude = installInvocation("claude-cli", "/tmp/claude.sh", options);
  assert.equal(kimiPath, "/Users/example/Library/Application Support/PenEcho/tools/kimi/bin/kimi");
  assert.equal(codexPath, "/Users/example/Library/Application Support/PenEcho/tools/codex/bin/codex");
  assert.equal(claudePath, "/Users/example/.local/bin/claude");
  assert.equal(kimi.command, "/bin/bash");
  assert.equal(kimi.env.KIMI_INSTALL_DIR, "/Users/example/Library/Application Support/PenEcho/tools/kimi");
  assert.equal(kimi.env.KIMI_NO_MODIFY_PATH, "1");
  assert.equal(codex.command, "/bin/sh");
  assert.equal(codex.env.CODEX_NON_INTERACTIVE, "1");
  assert.equal(codex.env.CODEX_INSTALL_DIR, path.dirname(codexPath));
  assert.deepEqual(claude.args, ["/tmp/claude.sh", "stable"]);
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
      runner:async (command, args) => {
        calls.push({ command, args });
        if (args[0] === "--version") return { output:"codex-cli 1.2.3" };
        fs.mkdirSync(path.dirname(expected), { recursive:true });
        fs.writeFileSync(expected, "test");
        return { output:"installed" };
      },
    });
    assert.equal(result.executable, expected);
    assert.equal(result.version, "codex-cli 1.2.3");
    assert.equal(calls.length, 2);
    assert.equal(fs.existsSync(path.join(stateDir, "installers", "codex-cli.sh")), false);
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
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
