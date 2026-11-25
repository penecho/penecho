"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");
const { execFile, spawn } = require("child_process");
const {
  envKey,
  hasWindowsAppsPwshAlias,
  isReadableRegularFile,
  prepareAgentEnv,
  resolveWindowsCmdShim,
} = require("./agent-env.js");

const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_AUTH_BYTES = 1024 * 1024;
const SIGN_IN_SOON_MS = 10 * 60 * 1000;
const SIGN_IN_RENEW_MS = 20 * 1000;
const WINDOWS_APP_QUERY_MS = 10 * 60 * 1000;
const WINDOWS_APPX_PACKAGES_KEY = "HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages";

// Prepare an environment for spawning Codex without mutating the user's system/user settings:
// delegates to the shared cross-agent environment sanitizer with Windows sandbox PATH protection on by default.
function prepareCodexEnv(env = process.env, extra = null, options = {}) {
  return prepareAgentEnv(env, extra, {
    platform: process.platform,
    sandboxWindowsPath: true,
    ...options,
  });
}

function parseVersionTuple(text) {
  const match = /(\d+(?:\.\d+)*)/.exec(String(text || ""));
  return match ? match[1].split(".").map(Number) : [0];
}

function compareVersionsDesc(a, b) {
  const va = parseVersionTuple(a), vb = parseVersionTuple(b);
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i++) {
    const diff = (vb[i] || 0) - (va[i] || 0);
    if (diff !== 0) return diff;
  }
  return String(b).localeCompare(String(a));
}

function parseAppxPackageKeys(stdout, prefix = "OpenAI.Codex") {
  const needle = prefix.toLowerCase();
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^HKEY_/i.test(line) && path.win32.basename(line).toLowerCase().startsWith(needle))
    .sort((a, b) => compareVersionsDesc(path.win32.basename(a), path.win32.basename(b)));
}

function parsePackageRootFolder(stdout) {
  const match = /PackageRootFolder\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/i.exec(String(stdout || ""));
  return match ? match[1].trim() : "";
}

function codexExeInAppRoot(root, fsOps = fs) {
  if (!root) return "";
  for (const parts of [["app", "resources", "codex.exe"], ["resources", "codex.exe"]]) {
    const exe = path.join(root, ...parts);
    if (isReadableRegularFile(exe, fsOps)) return exe;
  }
  return "";
}

function scanWindowsAppsForCodex(windowsAppsRoot, fsOps = fs) {
  if (!windowsAppsRoot) return "";
  let entries;
  try {
    entries = fsOps.readdirSync(windowsAppsRoot);
  } catch {
    return "";
  }
  const matches = entries
    .filter((name) => /^openai\.codex(?:_|$)/i.test(String(name || "")))
    .sort(compareVersionsDesc);
  for (const name of matches) {
    const exe = codexExeInAppRoot(path.join(windowsAppsRoot, name), fsOps);
    if (exe) return exe;
  }
  return "";
}

function findNonStoreWindowsCodexApp(env, fsOps = fs) {
  const localAppDataKey = envKey(env, "LOCALAPPDATA");
  const programFilesKey = envKey(env, "ProgramFiles");
  const localAppData = localAppDataKey ? String(env[localAppDataKey] || "").trim() : "";
  const programFiles = programFilesKey ? String(env[programFilesKey] || "").trim() : "";
  const roots = [
    ...(localAppData ? [path.join(localAppData, "Programs", "Codex"), path.join(localAppData, "Programs", "OpenAI Codex")] : []),
    ...(programFiles ? [path.join(programFiles, "Codex")] : []),
  ];
  for (const root of roots) {
    const exe = codexExeInAppRoot(root, fsOps);
    if (exe) return exe;
  }
  return "";
}

let windowsCodexAppState = { at: 0, dirAt: 0, asking: false, found: "" };

function resetWindowsCodexAppCache() {
  windowsCodexAppState = { at: 0, dirAt: 0, asking: false, found: "" };
}

function queryWindowsCodexApp(env, run, fsOps, onFound) {
  windowsCodexAppState.at = Date.now();
  windowsCodexAppState.asking = true;
  const regOpts = { env, encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 };
  run("reg.exe", ["query", WINDOWS_APPX_PACKAGES_KEY, "/f", "OpenAI.Codex", "/k"], regOpts, (error, stdout) => {
    const keys = error ? [] : parseAppxPackageKeys(stdout, "OpenAI.Codex");
    const tryKey = (index) => {
      if (index >= keys.length) {
        windowsCodexAppState.asking = false;
        windowsCodexAppState.found = "";
        return;
      }
      run("reg.exe", ["query", keys[index], "/v", "PackageRootFolder"], regOpts, (valErr, valOut) => {
        const root = valErr ? "" : parsePackageRootFolder(valOut);
        const exe = codexExeInAppRoot(root, fsOps);
        if (exe) {
          windowsCodexAppState.asking = false;
          const changed = windowsCodexAppState.found !== exe;
          windowsCodexAppState.found = exe;
          if (changed) try { onFound?.(exe); } catch {}
          return;
        }
        tryKey(index + 1);
      });
    };
    tryKey(0);
  });
}

function darwinCodexAppPaths(options = {}) {
  const fsOps = options.fs || fs;
  const home = String(options.home || "").trim();
  const appFolders = Array.isArray(options.appFolders)
    ? options.appFolders
    : ["/Applications", ...(home ? [path.join(home, "Applications")] : [])];
  const candidates = [];
  for (const dir of appFolders) {
    if (!dir) continue;
    for (const appName of ["Codex.app", "ChatGPT.app"]) {
      const resources = path.join(dir, appName, "Contents", "Resources");
      const cliRoot = path.join(resources, "codex-cli");
      try {
        const pkg = JSON.parse(fsOps.readFileSync(path.join(cliRoot, "codex-package.json"), "utf8"));
        const entry = typeof pkg?.entrypoint === "string" ? pkg.entrypoint.trim() : "";
        if (entry && !path.isAbsolute(entry) && !entry.split(/[\\/]/).includes("..")) {
          candidates.push(path.join(cliRoot, entry));
        }
      } catch {}
      candidates.push(path.join(cliRoot, "bin", "codex"));
      candidates.push(path.join(resources, "codex"));
    }
  }
  return [...new Set(candidates)];
}

function commonPosixCodexPaths(env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === "win32" || !env || typeof env !== "object") return [];
  const home = String(options.home || env[envKey(env, "HOME")] || "").trim();
  const userDirs = home ? [
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".cargo", "bin"),
  ] : [];
  const systemDirs = options.includeSystemDirs === false
    ? []
    : Array.isArray(options.systemDirs)
      ? options.systemDirs
      : [...(platform === "darwin" ? ["/opt/homebrew/bin"] : []), "/usr/local/bin"];
  return [...new Set([...userDirs, ...systemDirs].filter(Boolean).map((dir) => path.join(dir, "codex")))];
}

// PenEcho once installed a Codex of its own under its tools folder. It is never updated any more, and a connection saved back then still
// names it. An old Codex does not know the newer models and sends every tool's full definition with each request: about 68k tokens at the
// start of a conversation instead of 25k (PE-1129).
function isRetiredCodexCopy(file) {
  return /[\\/](?:PenEcho|\.penecho)[\\/]tools[\\/]codex[\\/]bin[\\/]codex(?:\.exe)?$/i.test(String(file || "").trim());
}
// A saved connection with no path of its own says just "codex", which picks no Codex in particular.
function namesCodex(file) {
  const value = String(file || "").trim();
  return Boolean(value) && value !== "codex" && !isRetiredCodexCopy(value);
}

// Discover the Codex CLI bundled inside the official Codex desktop app:
// - macOS: Codex.app / ChatGPT.app (modern Contents/Resources/codex-cli/bin/codex and legacy Contents/Resources/codex)
// - Windows: non-Store desktop installs, direct Program Files\WindowsApps\OpenAI.Codex_* scan when readable,
//   and non-blocking async HKCU AppModel\Repository\Packages registry fallback when WindowsApps denies listing.
function findCodexInApp(env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const fsOps = options.fs || fs;
  if (namesCodex(env?.CODEX_CLI_PATH) || env?.NODE_ENV === "test") return null;
  if (platform === "darwin") {
    const home = options.home || env?.HOME || "";
    for (const file of darwinCodexAppPaths({ home, appFolders: options.appFolders, fs: fsOps })) {
      if (isReadableRegularFile(file, fsOps)) return file;
    }
    return null;
  }
  if (platform === "win32") {
    const nonStore = findNonStoreWindowsCodexApp(env, fsOps);
    if (nonStore) return nonStore;
    if (windowsCodexAppState.found && isReadableRegularFile(windowsCodexAppState.found, fsOps)) {
      return windowsCodexAppState.found;
    }
    const programFilesKey = envKey(env, "ProgramFiles");
    const windowsAppsRoot = options.windowsAppsRoot
      || (programFilesKey && env[programFilesKey] ? path.join(String(env[programFilesKey]).trim(), "WindowsApps") : "");
    if (windowsAppsRoot && (options.windowsAppsRoot || Date.now() - windowsCodexAppState.dirAt >= WINDOWS_APP_QUERY_MS)) {
      if (!options.windowsAppsRoot) windowsCodexAppState.dirAt = Date.now();
      const scanned = scanWindowsAppsForCodex(windowsAppsRoot, fsOps);
      if (scanned) {
        if (!options.windowsAppsRoot) windowsCodexAppState.found = scanned;
        return scanned;
      }
    }
    const allowRegistry = env === process.env || typeof options.run === "function";
    if (allowRegistry && !windowsCodexAppState.asking && Date.now() - windowsCodexAppState.at >= WINDOWS_APP_QUERY_MS) {
      queryWindowsCodexApp(env, options.run || execFile, fsOps, options.onFound);
    }
    return null;
  }
  return null;
}

function commonWindowsCodexPaths(env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32" || !env || typeof env !== "object") return [];
  const home = options.home || env[envKey(env, "USERPROFILE")] || env[envKey(env, "HOME")] || "";
  const appData = env[envKey(env, "APPDATA")] || "";
  const localAppData = env[envKey(env, "LOCALAPPDATA")] || (home ? path.join(home, "AppData", "Local") : "");
  const dirs = [
    ...(localAppData ? [path.join(localAppData, "Programs", "OpenAI", "Codex", "bin")] : []),
    ...(home ? [
      path.join(home, ".local", "bin"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".cargo", "bin"),
      path.join(home, "scoop", "shims"),
    ] : []),
    ...(appData ? [path.join(appData, "npm")] : []),
    ...(localAppData ? [path.join(localAppData, "pnpm"), path.join(localAppData, "Volta", "bin")] : []),
  ];
  const files = [];
  for (const dir of dirs) {
    for (const name of ["codex.exe", "codex.cmd", "codex.bat"]) {
      files.push(path.join(dir, name));
    }
  }
  return files;
}

function findOnPath(name, env = process.env) {
  const directories = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const candidates = process.platform === "win32" && !path.extname(name) ? [`.exe`, `.com`, `.cmd`, `.bat`].map((extension) => `${name}${extension}`) : [name];
  for (const directory of directories) {
    for (const candidate of candidates) {
      const file = path.join(directory.replace(/^"|"$/g, ""), candidate);
      try {
        if (fs.statSync(file).isFile()) return file;
      } catch {}
    }
  }
  return null;
}

function electronNodeEnv() {
  return process.versions?.electron ? { env: { ELECTRON_RUN_AS_NODE: "1" } } : {};
}

// npm's codex.js only starts codex.exe, and starts it in a window of its own when its parent has no console, as the desktop app has none.
// The program it would start (read in 0.144.5) is started directly, with the settings codex.js gives it. A layout it is not found in keeps codex.js.
const WINDOWS_CODEX = { x64:["codex-win32-x64", "x86_64-pc-windows-msvc"], arm64:["codex-win32-arm64", "aarch64-pc-windows-msvc"] };
function nativeWindowsCodex(npmScript) {
  const [name, target] = WINDOWS_CODEX[process.arch] || [];
  if (process.platform !== "win32" || !name || path.basename(npmScript).toLowerCase() !== "codex.js") return null;
  const root = path.dirname(path.dirname(npmScript));
  const candidateRoots = [path.join(root, "node_modules", "@openai", name), path.join(path.dirname(root), name), root];
  try {
    const pkgJson = createRequire(npmScript).resolve(`@openai/${name}/package.json`);
    if (pkgJson) candidateRoots.push(path.dirname(pkgJson));
  } catch {}
  const file = candidateRoots.map(folder => path.join(folder, "vendor", target, "bin", "codex.exe")).find(fs.existsSync);
  if (!file) return null;
  let packageRoot = root;
  try { packageRoot = fs.realpathSync(root); } catch {}
  return { command: file, prefixArgs: [], env: { CODEX_MANAGED_PACKAGE_ROOT: packageRoot, CODEX_MANAGED_BY_NPM: "1" } };
}

function resolveCodexLaunch(configuredPath = "codex", env = process.env) {
  const requested = String(configuredPath || "codex").trim();
  if (!requested || requested.includes("\0")) throw new Error("CODEX_CLI_PATH is invalid.");
  const hasDirectory = path.isAbsolute(requested) || requested.includes("/") || requested.includes("\\");
  const executable = hasDirectory ? path.resolve(requested) : findOnPath(requested, env);
  if (!executable) throw new Error(`Codex CLI was not found. Set CODEX_CLI_PATH to the installed executable.`);
  try {
    if (!fs.statSync(executable).isFile()) throw new Error();
  } catch {
    throw new Error(`Codex CLI path is not a file: ${executable}`);
  }
  const extension = path.extname(executable).toLowerCase();
  if (extension === ".js") return nativeWindowsCodex(executable) || { command: process.execPath, prefixArgs: [executable], ...electronNodeEnv() };
  if (process.platform === "win32" && [".cmd", ".bat"].includes(extension)) {
    const npmScript = path.join(path.dirname(executable), "node_modules", "@openai", "codex", "bin", "codex.js");
    if (fs.existsSync(npmScript)) return nativeWindowsCodex(npmScript) || { command: process.execPath, prefixArgs: [npmScript], ...electronNodeEnv() };
    const shimTarget = resolveWindowsCmdShim(executable, ["codex.js", "codex.exe"]);
    if (shimTarget) {
      if (path.extname(shimTarget).toLowerCase() === ".js") {
        return nativeWindowsCodex(shimTarget) || { command: process.execPath, prefixArgs: [shimTarget], ...electronNodeEnv() };
      }
      return { command: shimTarget, prefixArgs: [] };
    }
    throw new Error("Windows batch wrappers are unsupported. Set CODEX_CLI_PATH to codex.exe or the npm-installed codex.cmd wrapper.");
  }
  return { command: executable, prefixArgs: [] };
}

function sanitizeCodexEnv(env = process.env, isolated = null) {
  const clean = {},
    allowed = [
      "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
      "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LANG", "LC_ALL", "TERM", "COLORTERM", "NO_COLOR", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS",
    ];
  for (const name of allowed) {
    const sourceName = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase());
    if (sourceName && env[sourceName] !== undefined) clean[sourceName] = env[sourceName];
  }
  if (isolated) {
    clean.HOME = isolated.homeDir;
    clean.USERPROFILE = isolated.homeDir;
    clean.CODEX_HOME = isolated.codexHome;
    clean.APPDATA = isolated.appData;
    clean.LOCALAPPDATA = isolated.localAppData;
    clean.XDG_CONFIG_HOME = isolated.xdgConfigHome;
    clean.XDG_CACHE_HOME = isolated.xdgCacheHome;
  }
  return prepareCodexEnv(clean);
}

function buildCodexArgs({ workDir, imageFile, imageFiles, outputFile, model, effort }) {
  const disabledFeatures = [
      "apps", "auth_elicitation", "browser_use", "browser_use_external", "browser_use_full_cdp_access", "code_mode", "code_mode_host", "computer_use",
      "goals", "hooks", "image_generation", "in_app_browser", "memories", "multi_agent", "network_proxy", "plugins", "remote_plugin",
      "request_permissions_tool", "shell_snapshot", "shell_tool", "skill_mcp_dependency_install", "tool_call_mcp_elicitation", "tool_suggest", "unified_exec", "workspace_dependencies",
    ],
    args = ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--strict-config", "--json", "--color", "never"];
  for (const feature of disabledFeatures) args.push("--disable", feature);
  args.push(
    "-c", 'approval_policy="never"',
    "-c", 'web_search="disabled"',
    "-c", "mcp_servers={}",
    "-c", "project_doc_max_bytes=0",
    "-c", "project_root_markers=[]",
    "-c", "include_environment_context=false",
    "-c", "include_apps_instructions=false",
    "-c", "include_collaboration_mode_instructions=false",
    "-c", "skills.include_instructions=false",
    "-c", "skills.bundled.enabled=false",
    "-c", "orchestrator.skills.enabled=false",
    "-c", "orchestrator.mcp.enabled=false",
    "-c", "memories.generate_memories=false",
    "-c", "memories.use_memories=false",
    "-c", "memories.dedicated_tools=false",
    "-c", "notify=[]",
    "-c", "check_for_update_on_startup=false",
    "-c", "analytics.enabled=false",
    "-c", "feedback.enabled=false",
    "-c", 'history.persistence="none"',
    "-C", workDir,
  );
  const attachedImages = Array.isArray(imageFiles) ? imageFiles.filter(Boolean).slice(0, 5) : imageFile ? [imageFile] : [];
  for (const attachedImage of attachedImages) args.push("-i", attachedImage);
  args.push("-o", outputFile);
  if (model) args.push("--model", model);
  if (effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(String(effort).trim())}`);
  args.push("-");
  return args;
}

function sourceCodexHome(env = process.env) {
  if (env.CODEX_HOME) return path.resolve(env.CODEX_HOME);
  const home = env.USERPROFILE || env.HOME;
  return home ? path.join(path.resolve(home), ".codex") : null;
}

// When a ChatGPT sign-in's access token ends, in milliseconds. 0 when it does not say.
function accessTokenEnds(auth) {
  try { return (Number(JSON.parse(Buffer.from(String(auth.tokens.access_token).split(".")[1], "base64url").toString("utf8")).exp) || 0) * 1000; } catch { return 0; }
}

// Asks the person's own Codex about its account, in its own home. Codex renews a sign-in about to end by itself (five minutes before, read in
// 0.167) and saves it where its app and its other programs read it.
const renewals = new Map();
function renewOwnSignIn(launch, env, sourceHome) {
  if (!renewals.has(sourceHome)) renewals.set(sourceHome, new Promise((resolve) => {
    let child, buffer = "", timer = null;
    const done = () => { clearTimeout(timer); resolve(child ? stopProcessTree(child).catch(() => {}) : undefined); };
    const send = (message) => { try { child.stdin.write(`${JSON.stringify(message)}\n`); } catch {} };
    timer = setTimeout(done, SIGN_IN_RENEW_MS);
    try {
      child = spawn(launch.command, [...launch.prefixArgs, "app-server"], { cwd: os.tmpdir(), env: prepareCodexEnv(env, launch.env), stdio: ["pipe", "pipe", "ignore"], windowsHide: true, shell: false, detached: process.platform !== "win32" });
    } catch { return done(); }
    child.once("error", done);
    child.once("close", done);
    child.stdin.on("error", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message?.id === 1 && !message.method) { send({ method: "initialized" }); send({ id: 2, method: "account/read", params: { refreshToken: false } }); }
        else if (message?.id === 2 && !message.method) done();
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "penecho", title: "PenEcho", version: "1" } } });
  }).finally(() => renewals.delete(sourceHome)));
  return renewals.get(sourceHome);
}

// The isolated Codex gets the sign-in without its refresh token. That token works once: a Codex that renews with it gets the next one, which here
// would go with the temporary folder, and the Codex app, left holding the used one, would be signed out.
async function isolatedAuth(sourceAuth, { launch, env, sourceHome, renew }) {
  const read = async () => {
    const stat = await fs.promises.stat(sourceAuth).catch(() => null);
    if (!stat || !stat.isFile() || stat.size <= 0 || stat.size > MAX_AUTH_BYTES) throw new Error("Codex CLI requires a readable auth.json. Run `codex login` first.");
    const text = await fs.promises.readFile(sourceAuth, "utf8");
    try { return { text, auth: JSON.parse(text) }; } catch { throw new Error("Codex CLI requires a readable auth.json. Run `codex login` first."); }
  };
  let { text, auth } = await read();
  if (!auth?.tokens?.refresh_token) return text;
  const ends = accessTokenEnds(auth);
  if (launch && ends && ends - Date.now() < SIGN_IN_SOON_MS) {
    await renew(launch, env, sourceHome);
    ({ text, auth } = await read());
    const now = accessTokenEnds(auth);
    if (now && now <= Date.now()) throw new Error("Codex's sign-in has expired. Open Codex, sign in again, then retry.");
    if (!auth?.tokens?.refresh_token) return text;
  }
  return JSON.stringify({ ...auth, tokens: { ...auth.tokens, refresh_token: "" }, last_refresh: new Date().toISOString() }, null, 2);
}

async function prepareIsolatedRuntime(workDir, env = process.env, { launch = null, renew = renewOwnSignIn } = {}) {
  const homeDir = path.join(workDir, "home"), codexHome = path.join(homeDir, ".codex"),
    appData = path.join(homeDir, "AppData", "Roaming"), localAppData = path.join(homeDir, "AppData", "Local"),
    xdgConfigHome = path.join(homeDir, ".config"), xdgCacheHome = path.join(homeDir, ".cache");
  for (const directory of [homeDir, codexHome, appData, localAppData, xdgConfigHome, xdgCacheHome]) await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  const sourceHome = sourceCodexHome(env);
  if (!sourceHome) throw new Error("Codex CLI requires a readable auth.json. Run `codex login` first.");
  const text = await isolatedAuth(path.join(sourceHome, "auth.json"), { launch, env, sourceHome, renew });
  const destination = path.join(codexHome, "auth.json");
  await fs.promises.writeFile(destination, text, { flag: "wx", mode: 0o600 });
  await fs.promises.chmod(destination, 0o600).catch(() => {});
  return sanitizeCodexEnv(env, { homeDir, codexHome, appData, localAppData, xdgConfigHome, xdgCacheHome });
}

function abortError(traceDiagnostic = "") {
  const error = Object.assign(new Error("Codex CLI request aborted."), { name: "AbortError" });
  if (traceDiagnostic) error.traceDiagnostic = traceDiagnostic;
  return error;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function processGroupExists(pid) {
  try { process.kill(-pid, 0); return true; } catch { return false; }
}
async function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise((resolve) => {
      let settled = false;
      const fallback = () => { try { child.kill(); } catch {} };
      const finish = (fallbackNeeded = false) => { if (!settled) { settled = true; clearTimeout(timer); if(fallbackNeeded)fallback(); resolve(); } };
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true, shell: false });
      const timer=setTimeout(()=>{try{killer.kill()}catch{}finish(true)},2000);
      killer.once("error", () => finish(true));
      killer.once("close", code => finish(code !== 0));
    });
    const deadline=Date.now()+1000;
    while(child.exitCode===null&&child.signalCode===null&&Date.now()<deadline)await wait(40);
    if(child.exitCode===null&&child.signalCode===null)try{child.kill()}catch{}
    return;
  }
  if (!processGroupExists(child.pid)) {
    if (child.exitCode === null && child.signalCode === null) try { child.kill("SIGTERM"); } catch {}
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  const deadline = Date.now() + 1000;
  while (processGroupExists(child.pid) && Date.now() < deadline) await wait(40);
  if (processGroupExists(child.pid)) {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    const forceDeadline = Date.now() + 500;
    while (processGroupExists(child.pid) && Date.now() < forceDeadline) await wait(40);
  }
}

function appendTail(current, value, limit = MAX_CAPTURE_BYTES) {
  const combined = `${current}${value}`;
  const buffer = Buffer.from(combined, "utf8");
  return buffer.length <= limit ? combined : buffer.subarray(buffer.length - limit).toString("utf8").replace(/^\uFFFD/, "");
}

function codexAgentMessage(event) {
  if (event?.type !== "item.completed") return "";
  const item = event.item, type = String(item?.type || "").toLowerCase();
  if (!["agent_message", "assistant_message", "message"].includes(type)) return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return item.content.map(part => typeof part === "string" ? part : part?.text || part?.output_text || "").join("");
}

function codexEventError(event) {
  const value = event?.error?.message || event?.error || event?.message || event?.detail;
  return typeof value === "string" ? value.trim() : "";
}

function runJsonProcess(launch, args, prompt, cwd, env, signal, onProgress = null, onText = null, onActivity = null, onUsage = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    let child;
    const spawnEnv = prepareCodexEnv(env, launch.env);
    try {
      child = spawn(launch.command, [...launch.prefixArgs, ...args], { cwd, env: spawnEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false, detached: process.platform !== "win32" });
    } catch (error) {
      return reject(error);
    }
    let termination = null, settled = false, lineBuffer = "", stderr = "", finalContent = "", responseStarted = false;
    const events = [];
    const terminate = () => termination ||= stopProcessTree(child);
    const traceDiagnostic = () => JSON.stringify({ events, stderr:stderr.slice(-4000) });
    const reportResponseStarted = () => {
      if (responseStarted) return;
      responseStarted = true;
      try { onProgress?.("receiving"); } catch {}
    };
    const remember = (event, invalid = false) => {
      const summary = invalid
        ? { type:"invalid-json", preview:String(event).slice(0, 200) }
        : { type:String(event?.type || "unknown"), ...(event?.item?.type ? { itemType:String(event.item.type) } : {}), ...(codexEventError(event) ? { error:codexEventError(event).slice(0, 500) } : {}) };
      events.push(summary);
      if (events.length > 64) events.shift();
    };
    const finishEarly = (content) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      const cleanupReady = terminate();
      resolve({ code:0, content, stderr, traceDiagnostic:traceDiagnostic(), cleanupReady, deferCleanup:true });
    };
    const failEarly = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      error.traceDiagnostic ||= traceDiagnostic();
      error.cleanupReady = terminate();
      error.deferCleanup = true;
      reject(error);
    };
    const handleLine = (rawLine) => {
      const line = rawLine.replace(/\r$/, "").trim();
      if (!line || settled) return;
      if (Buffer.byteLength(line, "utf8") > MAX_CAPTURE_BYTES) return failEarly(new Error("Codex CLI produced an oversized JSON event."));
      let event;
      try { event = JSON.parse(line); }
      catch { remember(line, true); return; }
      remember(event);
      if (event?.type === "turn.started" || String(event?.type || "").startsWith("item.")) reportResponseStarted();
      const content = codexAgentMessage(event);
      if (content) {
        if (Buffer.byteLength(content, "utf8") > MAX_CAPTURE_BYTES) return failEarly(new Error("Codex CLI final response is too large."));
        try { onText?.(content, { mode:"complete" }); } catch {}
        finalContent = content;
      }
      if (event?.type === "turn.completed") {
        if (signal?.aborted) return failEarly(abortError(traceDiagnostic()));
        if (!finalContent) return failEarly(new Error("Codex CLI completed the turn without a final agent message."));
        try { if (event.usage && typeof event.usage === "object") onUsage?.(event.usage); } catch {}
        finishEarly(finalContent);
      } else if (event?.type === "turn.failed" || event?.type === "error") {
        const detail = codexEventError(event), error = new Error(`Codex CLI turn failed${detail ? `: ${detail}` : "."}`);
        if (detail) error.diagnostic = detail.slice(0, 4000);
        failEarly(error);
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (settled) return;
      try { onActivity?.(); } catch {}
      lineBuffer += chunk;
      let newline;
      while ((newline = lineBuffer.indexOf("\n")) >= 0 && !settled) {
        const line = lineBuffer.slice(0, newline);
        lineBuffer = lineBuffer.slice(newline + 1);
        handleLine(line);
      }
      if (!settled && Buffer.byteLength(lineBuffer, "utf8") > MAX_CAPTURE_BYTES) failEarly(new Error("Codex CLI produced an oversized unterminated JSON event."));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { if (!settled) stderr = appendTail(stderr, chunk); });
    const onAbort = () => {
      if (settled) return;
      const error = abortError(traceDiagnostic());
      failEarly(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      error.traceDiagnostic ||= traceDiagnostic();
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      if (lineBuffer.trim()) handleLine(lineBuffer);
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return reject(abortError(traceDiagnostic()));
      resolve({ code, content:finalContent || null, stderr, traceDiagnostic:traceDiagnostic(), cleanupReady:Promise.resolve(), deferCleanup:false });
    });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") failEarly(error);
    });
    child.stdin.end(prompt);
  });
}

function decodeAtlasImage(dataUrl) {
  const match = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(dataUrl || ""));
  if (!match) throw new Error("Codex CLI received an invalid PNG or WebP image.");
  const format = match[1].toLowerCase();
  return { buffer:Buffer.from(match[2], "base64"), extension:format, mimeType:`image/${format}` };
}

async function callCodexCli({ executable, model, effort, prompt, atlasImage, signal, env = process.env, onProgress = null, onText = null, onActivity = null, onUsage = null }) {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penecho-codex-"));
  const imageInputs = (Array.isArray(atlasImage) ? atlasImage : atlasImage ? [atlasImage] : []).filter(Boolean).slice(0, 5),
    images = imageInputs.map(decodeAtlasImage),
    imageFiles = images.map((image, index) => path.join(workDir, `atlas-${index + 1}.${image.extension}`)),
    outputFile = path.join(workDir, "last-message.txt");
  let caughtError = null, cleanupReady = Promise.resolve(), deferCleanup = false;
  try {
    await fs.promises.chmod(workDir, 0o700).catch(() => {});
    await Promise.all(images.map((image, index) => fs.promises.writeFile(imageFiles[index], image.buffer, { mode:0o600 })));
    const launch = resolveCodexLaunch(executable, env),
      args = buildCodexArgs({ workDir, imageFiles, outputFile, model, effort }),
      childEnv = await prepareIsolatedRuntime(workDir, env, { launch }),
      result = await runJsonProcess(launch, args, prompt, workDir, childEnv, signal, onProgress, onText, onActivity, onUsage);
    cleanupReady = result.cleanupReady || cleanupReady;
    deferCleanup = Boolean(result.deferCleanup);
    if (signal?.aborted) throw abortError();
    if (result.content) return result.content;
    if (result.code !== 0) {
      const error = new Error(`Codex CLI failed with exit code ${result.code}.`);
      error.diagnostic = result.stderr.slice(-4000);
      error.traceDiagnostic = result.traceDiagnostic;
      throw error;
    }
    const stat = await fs.promises.stat(outputFile).catch(() => null);
    if (signal?.aborted) throw abortError();
    if (!stat || !stat.isFile() || stat.size <= 0) throw new Error("Codex CLI did not produce a final response.");
    if (stat.size > MAX_CAPTURE_BYTES) throw new Error("Codex CLI final response is too large.");
    const content = await fs.promises.readFile(outputFile, { encoding:"utf8", signal });
    if (signal?.aborted) throw abortError();
    return content;
  } catch (error) {
    caughtError = error;
    cleanupReady = error.cleanupReady || cleanupReady;
    deferCleanup = deferCleanup || Boolean(error.deferCleanup);
    const stat = await fs.promises.stat(outputFile).catch(() => null);
    if (stat?.isFile() && stat.size > 0 && stat.size <= MAX_CAPTURE_BYTES) {
      const lastMessage = await fs.promises.readFile(outputFile, "utf8").catch(() => "");
      if (lastMessage) error.traceDiagnostic = `${error.traceDiagnostic || ""}\nlast-message.txt:\n${lastMessage}`.trim();
    }
    throw error;
  } finally {
    const cleanup = async () => {
      await cleanupReady.catch(() => {});
      await fs.promises.rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    };
    if (deferCleanup) {
      void cleanup().catch(() => {});
    } else {
      try { await cleanup(); }
      catch (cleanupError) {
        if (caughtError) caughtError.cleanupDiagnostic = cleanupError.message;
        else throw new Error(`Codex CLI temporary directory cleanup failed: ${cleanupError.message}`);
      }
    }
  }
}

module.exports = { buildCodexArgs, callCodexCli, commonPosixCodexPaths, commonWindowsCodexPaths, darwinCodexAppPaths, decodeAtlasImage, findCodexInApp, hasWindowsAppsPwshAlias, namesCodex, parseAppxPackageKeys, parsePackageRootFolder, prepareCodexEnv, prepareIsolatedRuntime, renewOwnSignIn, resetWindowsCodexAppCache, resolveCodexLaunch, sanitizeCodexEnv, sourceCodexHome };
