"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { normalizeSettings, publicSettings } = require("../desktop/settings-contract.js");
const { readSecret, writeSecret } = require("../desktop/secret-store.js");
const { installCli, installInvocation, managedCliPath } = require("../desktop/cli-installer.js");
const { createUpdateManager, updateFeedUrl } = require("../desktop/update-manager.js");
const { isPrivateIpv4, lanHosts, lanUrls } = require("../desktop/network-access.js");
const { desktopConfigurationEnvironment } = require("../desktop/config-environment.js");
const { parseArgs, resolveConfiguration } = require("../cli.js");

const ROOT = path.resolve(__dirname, "..");

function base(overrides = {}) {
  return {
    provider:"api", apiFormat:"openai", apiUrl:"https://api.openai.com/v1", apiModel:"gpt-5.6-sol", apiKey:"secret",
    effort:"xhigh", imageFormat:"webp", timeout:"180", autoDelay:"1.2", host:"127.0.0.1", port:"3888",
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
});

test("desktop settings support CLI providers without exposing API secrets", () => {
  const codex = normalizeSettings(base({ provider:"codex-cli", codexModel:"gpt-5.6-sol", codexPath:"/usr/local/bin/codex", apiKey:"" }));
  assert.equal(codex.updates.CODEX_CLI_PATH, "/usr/local/bin/codex");
  const visible = publicSettings({
    configExists:true, provider:"api", configFile:"/config.env", stateDir:"/state", env:{ AI_API_KEY:"never-return-this", AI_API_MODEL:"model" },
  }, { version:"0.7.0", hasSavedApiKey:true });
  assert.equal(visible.apiKeySaved, true);
  assert.equal(JSON.stringify(visible).includes("never-return-this"), false);
  assert.equal(publicSettings({ env:{} }).host, "0.0.0.0");
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
  assert.throws(() => normalizeSettings(base({
    provider:"kimi", apiFormat:"anthropic", apiUrl:"https://api.moonshot.ai/v1", apiModel:"k3", kimiProduct:"platform", kimiRegion:"global",
  })), /OpenAI-compatible/);
  const visible = publicSettings({
    configExists:true, provider:"api", configFile:"/config.env", stateDir:"/state",
    env:{ PENECHO_DESKTOP_PROVIDER:"kimi", PENECHO_KIMI_PRODUCT:"platform", PENECHO_KIMI_REGION:"china", AI_API_MODEL:"k3" },
  });
  assert.equal(visible.provider, "kimi");
  assert.equal(visible.kimiProduct, "platform");
  assert.equal(visible.kimiRegion, "china");
  assert.equal(publicSettings({
    provider:"api", env:{ PENECHO_DESKTOP_PROVIDER:"kimi", PENECHO_KIMI_PRODUCT:"code" },
  }).apiModel, "k3");
  assert.equal(publicSettings({
    provider:"api", env:{ PENECHO_DESKTOP_PROVIDER:"kimi", PENECHO_KIMI_PRODUCT:"platform" },
  }).apiModel, "kimi-k3");
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

test("desktop secret store round-trips only encrypted bytes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-secret-test-")), file = path.join(directory, "credentials.json"),
    safeStorage = {
      isEncryptionAvailable:() => true,
      encryptString:value => Buffer.from(`encrypted:${value}`).reverse(),
      decryptString:value => Buffer.from(value).reverse().toString().slice("encrypted:".length),
    };
  try {
    writeSecret(file, "sk-private", safeStorage);
    assert.equal(readSecret(file, safeStorage), "sk-private");
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /sk-private/);
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});

test("desktop shell and Forge config keep the renderer isolated and package native assets", () => {
  const main = fs.readFileSync(path.join(ROOT, "desktop", "main.js"), "utf8"),
    preload = fs.readFileSync(path.join(ROOT, "desktop", "preload.js"), "utf8"),
    forge = fs.readFileSync(path.join(ROOT, "forge.config.js"), "utf8"),
    html = fs.readFileSync(path.join(ROOT, "desktop", "settings", "index.html"), "utf8");
  assert.match(main, /contextIsolation:true/);
  assert.match(main, /nodeIntegration:false/);
  assert.match(main, /sandbox:true/);
  assert.match(main, /PENECHO_PRIVATE_PLUGIN_DIR/);
  assert.match(main, /desktopConfigurationEnvironment\(process\.env, paths\.stateDir\)/);
  assert.match(main, /configuration\.env\.HOST\) configuration\.env\.HOST = "0\.0\.0\.0"/);
  assert.match(main, /createUpdateManager/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /installCli/);
  assert.doesNotMatch(preload, /loginCli/);
  assert.match(preload, /copyText/);
  assert.match(main, /\["api", "kimi"\]\.includes\(normalized\.provider\)/);
  assert.match(main, /settingsReadyToLaunch = true;\s*return \{ ok:false, saved:true/);
  assert.match(fs.readFileSync(path.join(ROOT, "desktop", "settings", "settings.js"), "utf8"), /Launch anyway/);
  assert.match(fs.readFileSync(path.join(ROOT, "desktop", "settings", "settings.js"), "utf8"), /KIMI_MODELS = Object\.freeze\(\{ code:"k3", platform:"kimi-k3" \}\)/);
  assert.match(fs.readFileSync(path.join(ROOT, "desktop", "settings", "settings.js"), "utf8"), /kimiProduct\.addEventListener\("change", \(\) => updateKimiEndpoint\(true, true\)\)/);
  assert.match(forge, /node_modules\/\{sharp,@img\}/);
  assert.match(forge, /maker-dmg/);
  assert.match(forge, /maker-squirrel/);
  assert.match(html, /Test, save &amp; launch/);
  assert.match(html, />Install<\/button>/);
  assert.doesNotMatch(html, /Sign in|data-login-cli/);
  assert.match(html, /Official Kimi Open Source Friend/);
  assert.match(html, /value="0\.0\.0\.0" selected/);
  assert.match(html, /platform\.kimi\.com\?aff=penecho/);
  assert.match(html, /platform\.kimi\.ai\?aff=penecho/);
  assert.match(html, /Content-Security-Policy/);
});

test("desktop updates resolve published GitHub Releases for each packaged target", async () => {
  assert.equal(updateFeedUrl({ platform:"darwin", arch:"arm64", version:"0.7.0" }), "https://update.electronjs.org/penecho/penecho/darwin-arm64/0.7.0");
  assert.equal(updateFeedUrl({ platform:"win32", arch:"x64", version:"0.7.0" }), "https://update.electronjs.org/penecho/penecho/win32-x64/0.7.0");
  assert.equal(updateFeedUrl({ platform:"linux", arch:"x64", version:"0.7.0" }), null);
  class FakeUpdater extends EventEmitter {
    setFeedURL(value) { this.feed = value; }
    async checkForUpdates() { this.emit("checking-for-update"); this.emit("update-not-available"); }
  }
  const updater = new FakeUpdater(), messages = [], manager = createUpdateManager({
    app:{ isPackaged:true, getVersion:() => "0.7.0" }, autoUpdater:updater,
    dialog:{ showMessageBox:async value => { messages.push(value); return { response:0 }; } },
    platform:"darwin", arch:"arm64", logger:{ warn:() => {} },
  });
  await manager.check(true);
  assert.equal(updater.feed.url, "https://update.electronjs.org/penecho/penecho/darwin-arm64/0.7.0");
  assert.equal(messages[0].title, "PenEcho is up to date");
  manager.stop();
});

test("desktop CLI setup uses official installers without requiring npm", () => {
  const options = { platform:"darwin", home:"/Users/example", stateDir:"/Users/example/Library/Application Support/PenEcho" },
    codexPath = managedCliPath("codex-cli", options), claudePath = managedCliPath("claude-cli", options),
    codex = installInvocation("codex-cli", "/tmp/codex.sh", options), claude = installInvocation("claude-cli", "/tmp/claude.sh", options);
  assert.equal(codexPath, "/Users/example/Library/Application Support/PenEcho/tools/codex/bin/codex");
  assert.equal(claudePath, "/Users/example/.local/bin/claude");
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
