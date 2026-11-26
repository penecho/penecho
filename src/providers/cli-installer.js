"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { CLI_INSTALL_COMMANDS:INSTALL_COMMANDS, CLI_LOGIN_COMMANDS:LOGIN_COMMANDS, inspectCli } = require("./cli-inspection.js");
const { cliCandidates } = require("./cli-discovery.js");
const { resolveCodexLaunch } = require("./codex-cli.js");
const { envKey, prepareAgentEnv } = require("./agent-env.js");

const MAX_INSTALLER_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const NPM_REGISTRY = "https://registry.npmjs.org/";
const OMP_RELEASE_OWNER = "can1357";
const OMP_RELEASE_REPO = "oh-my-pi";
const OMP_RELEASES_LATEST_URL = `https://github.com/${OMP_RELEASE_OWNER}/${OMP_RELEASE_REPO}/releases/latest`;
const OMP_RELEASES_API_LATEST_URL = `https://api.github.com/repos/${OMP_RELEASE_OWNER}/${OMP_RELEASE_REPO}/releases/latest`;
const OMP_RELEASE_DOWNLOAD_BASE = `https://github.com/${OMP_RELEASE_OWNER}/${OMP_RELEASE_REPO}/releases/download`;
const MAX_OMP_BINARY_BYTES = 512 * 1024 * 1024;
const OMP_METADATA_TIMEOUT_MS = 30 * 1000;
const OMP_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const OMP_DOWNLOAD_IDLE_MS = 45 * 1000;
const OMP_DOWNLOAD_MAX_ATTEMPTS = 4;
const PROCESS_OUTPUT = Symbol("process output");
const inFlightCodexInstalls = new Map();

const DEFINITIONS = Object.freeze({
  "kimi-cli":Object.freeze({
    label:"Kimi Code",
    urls:Object.freeze({
      darwin:"https://code.kimi.com/kimi-code/install.sh",
      win32:"https://code.kimi.com/kimi-code/install.ps1",
    }),
    markers:Object.freeze({
      darwin:"KIMI_BINARY_BASE",
      win32:"KimiBinaryBase",
    }),
    executable:"kimi",
  }),
  "codex-cli":Object.freeze({
    label:"Codex CLI",
    urls:Object.freeze({
      darwin:"https://chatgpt.com/codex/install.sh",
      win32:"https://chatgpt.com/codex/install.ps1",
    }),
    marker:"CODEX_INSTALL_DIR",
    executable:"codex",
  }),
  "claude-cli":Object.freeze({
    label:"Claude Code",
    urls:Object.freeze({
      darwin:"https://claude.ai/install.sh",
      win32:"https://claude.ai/install.ps1",
    }),
    marker:"DOWNLOAD_BASE_URL",
    executable:"claude",
  }),
  "opencode-cli":Object.freeze({
    label:"OpenCode",
    urls:Object.freeze({
      darwin:"https://opencode.ai/v2/install",
    }),
    npmPackages:Object.freeze({
      win32:"@opencode/cli",
    }),
    marker:"APP=opencode",
    executable:"opencode",
  }),
  "pi-cli":Object.freeze({
    label:"Pi",
    urls:Object.freeze({
      darwin:"https://pi.dev/install.sh",
      win32:"https://pi.dev/install.ps1",
    }),
    marker:"@earendil-works/pi-coding-agent",
    executable:"pi",
  }),
  "omp-cli":Object.freeze({
    label:"omp",
    urls:Object.freeze({
      darwin:"https://omp.sh/install",
      win32:"https://omp.sh/install.ps1",
    }),
    marker:"can1357/oh-my-pi",
    executable:"omp",
  }),
  "antigravity-cli":Object.freeze({
    label:"Antigravity",
    urls:Object.freeze({
      darwin:"https://antigravity.google/cli/install.sh",
      win32:"https://antigravity.google/cli/install.ps1",
    }),
    marker:"antigravity-cli-auto-updater",
    executable:"agy",
  }),
  "dsh-cli":Object.freeze({
    label:"dsh",
    urls:Object.freeze({}),
    npmPackages:Object.freeze({
      darwin:"@deepseek-ai/dsh@latest",
      win32:"@deepseek-ai/dsh@latest",
    }),
    executable:"dsh",
  }),
});

function definition(provider, platform = process.platform) {
  const result = DEFINITIONS[provider];
  if (!result) throw new Error("Choose a supported CLI agent to install.");
  if (!result.urls?.[platform] && !result.npmPackages?.[platform]) {
    throw new Error(`${result.label} automatic installation is available on macOS and Windows.`);
  }
  return result;
}

function definitionMarker(item, platform = process.platform) {
  return item.markers?.[platform] || item.marker || "";
}

function executableName(base, platform) {
  return platform === "win32" ? `${base}.exe` : base;
}

function npmShimName(base, platform) {
  return platform === "win32" ? `${base}.cmd` : base;
}

function codexHostName(platform = process.platform) {
  return executableName("codex-code-mode-host", platform);
}

function executableFile(file) {
  try { return fs.statSync(file).isFile(); }
  catch { return false; }
}

function assertCodexCliBundle(executable, platform = process.platform) {
  const resolved = path.resolve(String(executable || "")), expectedName = executableName("codex", platform), hostExecutable = path.join(path.dirname(resolved), codexHostName(platform));
  if (path.basename(resolved).toLowerCase() !== expectedName.toLowerCase() || !executableFile(resolved)) {
    const error = new Error(`Codex CLI bundle is incomplete: ${expectedName} was not found.`);
    error.code = "CODEX_CLI_BUNDLE_INCOMPLETE";
    throw error;
  }
  if (!executableFile(hostExecutable)) {
    const error = new Error(`Codex CLI bundle is incomplete: ${codexHostName(platform)} was not found beside ${expectedName}.`);
    error.code = "CODEX_CLI_BUNDLE_INCOMPLETE";
    throw error;
  }
  return { executable:resolved, hostExecutable };
}

function codexLocalAppData(home, options = {}) {
  const explicitEnv = options.env && typeof options.env === "object" ? options.env : null;
  const fromExplicit = explicitEnv ? String(explicitEnv[envKey(explicitEnv, "LOCALAPPDATA")] || "").trim() : "";
  if (fromExplicit) return path.resolve(fromExplicit);
  if (!options.home) {
    const fromProcess = String(process.env[envKey(process.env, "LOCALAPPDATA")] || "").trim();
    if (fromProcess) return path.resolve(fromProcess);
  }
  return path.join(home, "AppData", "Local");
}

function windowsAppData(home, options = {}) {
  const explicitEnv = options.env && typeof options.env === "object" ? options.env : null;
  const fromExplicit = explicitEnv ? String(explicitEnv[envKey(explicitEnv, "APPDATA")] || "").trim() : "";
  if (fromExplicit) return path.resolve(fromExplicit);
  if (!options.home) {
    const fromProcess = String(process.env[envKey(process.env, "APPDATA")] || "").trim();
    if (fromProcess) return path.resolve(fromProcess);
  }
  return path.join(home, "AppData", "Roaming");
}

function managedCliPath(provider, options = {}) {
  const platform = options.platform || process.platform, homeValue = String(options.home || "").trim(), stateValue = String(options.stateDir || "").trim();
  const item = definition(provider, platform);
  if (!homeValue || !stateValue) throw new Error("Application paths are unavailable.");
  const home = path.resolve(homeValue), stateDir = path.resolve(stateValue);
  if (provider === "kimi-cli") {
    return path.join(stateDir, "tools", "kimi", "bin", executableName(item.executable, platform));
  }
  // Codex CLI installs into OpenAI's standard user-level location (never a private PenEcho copy)
  // so Terminal, Codex Desktop, and Codex's own auto-updater share the same installation and ~/.codex state.
  if (provider === "codex-cli") {
    if (platform === "win32") {
      return path.join(codexLocalAppData(home, options), "Programs", "OpenAI", "Codex", "bin", executableName(item.executable, platform));
    }
    return path.join(home, ".local", "bin", executableName(item.executable, platform));
  }
  if (provider === "opencode-cli") {
    if (platform === "win32") {
      return path.join(windowsAppData(home, options), "npm", npmShimName(item.executable, platform));
    }
    return path.join(home, ".opencode", "bin", executableName(item.executable, platform));
  }
  if (provider === "omp-cli") {
    if (platform === "win32") {
      return path.join(codexLocalAppData(home, options), "omp", executableName(item.executable, platform));
    }
    return path.join(home, ".local", "bin", executableName(item.executable, platform));
  }
  if (provider === "antigravity-cli") {
    if (platform === "win32") {
      return path.join(codexLocalAppData(home, options), "agy", "bin", executableName(item.executable, platform));
    }
    return path.join(home, ".local", "bin", executableName(item.executable, platform));
  }
  if (provider === "pi-cli") {
    if (platform === "win32") {
      return path.join(home, ".pi", "agent", "bin", npmShimName(item.executable, platform));
    }
    return path.join(home, ".pi", "agent", "bin", item.executable);
  }
  if (provider === "dsh-cli") {
    if (platform === "win32") {
      return path.join(windowsAppData(home, options), "npm", npmShimName(item.executable, platform));
    }
    return path.join(home, ".local", "bin", item.executable);
  }
  return path.join(home, ".local", "bin", executableName(item.executable, platform));
}

function installedCliCandidates(provider, options = {}) {
  const platform = options.platform || process.platform,
    home = path.resolve(String(options.home || "")),
    item = definition(provider, platform),
    primary = managedCliPath(provider, options),
    candidates = [primary];
  if (provider === "pi-cli") {
    if (platform === "win32") {
      candidates.push(
        path.join(windowsAppData(home, options), "npm", npmShimName(item.executable, platform)),
        path.join(home, ".local", "bin", npmShimName(item.executable, platform)),
      );
    } else {
      candidates.push(
        path.join(home, ".local", "bin", item.executable),
        path.join(home, "bin", item.executable),
        "/opt/homebrew/bin/pi",
        "/usr/local/bin/pi",
      );
    }
  }
  if (provider === "opencode-cli" && platform === "win32") {
    candidates.push(path.join(windowsAppData(home, options), "npm", executableName(item.executable, platform)));
  }
  return [...new Set(candidates.map(file => path.resolve(file)))];
}

function npmPrefixFor(provider, options = {}) {
  const platform = options.platform || process.platform,
    home = path.resolve(String(options.home || ""));
  if (platform === "win32") return path.join(windowsAppData(home, options), "npm");
  return path.join(home, ".local");
}

function enrichInstallerPath(env, home, platform = process.platform, options = {}) {
  const delimiter = platform === "win32" ? ";" : ":";
  const pathKey = envKey(env, "PATH") || (platform === "win32" ? "Path" : "PATH");
  const current = String(env[pathKey] || "").split(delimiter).filter(Boolean);
  const extra = platform === "win32"
    ? [
      path.join(windowsAppData(home, options), "npm"),
      path.join(codexLocalAppData(home, options), "Programs", "nodejs"),
      path.join(String(env[envKey(env, "ProgramFiles")] || "C:\\Program Files"), "nodejs"),
      path.join(codexLocalAppData(home, options), "pi-node", "current"),
      path.join(home, ".volta", "bin"),
      path.join(home, "scoop", "shims"),
    ]
    : [
      path.join(home, ".local", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, ".bun", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ];
  const merged = [...current];
  const seen = new Set(current.map(dir => (platform === "win32" ? dir.toLowerCase() : dir)));
  for (const dir of extra) {
    if (!dir) continue;
    const key = platform === "win32" ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    if (options.includeAllPathDirs || (fs.existsSync(dir) && fs.statSync(dir).isDirectory())) {
      merged.push(dir);
      seen.add(key);
    }
  }
  env[pathKey] = merged.join(delimiter);
  return env;
}

function prependInstallerPath(env, dir, platform = process.platform) {
  if (!dir) return env;
  const delimiter = platform === "win32" ? ";" : ":";
  const pathKey = envKey(env, "PATH") || (platform === "win32" ? "Path" : "PATH");
  const key = platform === "win32" ? dir.toLowerCase() : dir;
  const current = String(env[pathKey] || "").split(delimiter).filter(Boolean);
  const filtered = current.filter(entry => (platform === "win32" ? entry.toLowerCase() : entry) !== key);
  env[pathKey] = [dir, ...filtered].join(delimiter);
  return env;
}

function findNpmExecutable(env, platform = process.platform) {
  const delimiter = platform === "win32" ? ";" : ":";
  const pathKey = envKey(env, "PATH");
  const dirs = String((pathKey && env[pathKey]) || "").split(delimiter).filter(Boolean);
  const names = platform === "win32" ? ["npm.cmd", "npm.exe"] : ["npm"];
  for (const dir of dirs) {
    const cleanDir = dir.replace(/^"|"$/g, "");
    for (const name of names) {
      const candidate = path.join(cleanDir, name);
      if (executableFile(candidate)) return candidate;
    }
  }
  return "";
}

function quoteCmdArg(value) {
  const text = String(value ?? "");
  return /[\s"&|<>^()%!]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function commandInvocation(executable, args, env, platform = process.platform) {
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
    const comspec = String(env?.[envKey(env, "COMSPEC")] || "cmd.exe");
    const line = [quoteCmdArg(executable), ...args.map(quoteCmdArg)].join(" ");
    return { command:comspec, args:["/d", "/s", "/c", `"${line}"`], windowsVerbatimArguments:true };
  }
  return { command:executable, args, windowsVerbatimArguments:false };
}

function managedCliHome(provider, options = {}) {
  if (provider === "codex-cli") {
    const explicitEnv = options.env && typeof options.env === "object" ? options.env : null;
    const configured = explicitEnv ? String(explicitEnv[envKey(explicitEnv, "CODEX_HOME")] || "").trim() : "";
    if (configured) return path.resolve(configured);
    const homeValue = String(options.home || "").trim();
    if (!homeValue) throw new Error("Application paths are unavailable.");
    return path.join(path.resolve(homeValue), ".codex");
  }
  const stateValue = String(options.stateDir || "").trim();
  if (!stateValue) throw new Error("Application state path is unavailable.");
  const stateDir = path.resolve(stateValue);
  return path.join(stateDir, "tools", provider === "kimi-cli" ? "kimi" : "claude", "home");
}

// Windows PowerShell 5.1 stops at a "script execution risk" question (a dialog box when it has no console) on every
// Invoke-WebRequest without -UseBasicParsing, and the official installers do not all pass it. Its progress display also
// slows large downloads many times over.
const POWERSHELL_INSTALL_DEFAULTS = "$PSDefaultParameterValues['Invoke-WebRequest:UseBasicParsing'] = $true; $ProgressPreference = 'SilentlyContinue'";

const WINDOWS_PI_USER_PATH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$directory = $env:PENECHO_PI_BIN_DIR
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
  $userPath = $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $kind = if ($null -eq $userPath) { 'String' } else { $key.GetValueKind('Path') }
  foreach ($entry in ($userPath -split ';')) {
    $candidate = $entry.Trim().Trim('"')
    if ($kind -eq 'ExpandString') { $candidate = [Environment]::ExpandEnvironmentVariables($candidate) }
    if ($candidate.TrimEnd([char[]]'\/') -ieq $directory) { return }
  }
  $newPath = if ($userPath) { "$directory;$userPath" } else { $directory }
  $key.SetValue('Path', $newPath, $kind)
} finally {
  $key.Dispose()
}

# Notify Explorer so it can use the updated PATH when starting new processes.
Add-Type -Namespace PenEcho -Name WindowsEnvironment -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wParam,
    string lParam, uint flags, uint timeout, out UIntPtr result);
'@
$result = [UIntPtr]::Zero
[PenEcho.WindowsEnvironment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero,
    'Environment', 2, 1000, [ref]$result) | Out-Null
`;

function powershellExecutable(env) {
  const root = String(env[envKey(env, "SystemRoot")] || env[envKey(env, "WINDIR")] || "C:\\Windows");
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function cleanOutput(value) {
  return String(value || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\r\t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function codexCliVersion(value) {
  const match = /(?:^|\s|v)(\d+\.\d+\.\d+)(?:[-+\s]|$)/i.exec(String(value || ""));
  return match ? match[1] : "";
}

function runProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || INSTALL_TIMEOUT_MS,
    spawnImpl = options.spawnImpl || spawn;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        cwd:options.cwd,
        env:options.env,
        shell:false,
        windowsHide:true,
        ...(options.windowsVerbatimArguments ? { windowsVerbatimArguments:true } : {}),
        stdio:["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new Error(`Unable to start the installer: ${error.message}`));
      return;
    }
    let stdout = "", stderr = "", settled = false;
    const capture = target => chunk => {
      const text = chunk.toString("utf8");
      if (target === "stdout") stdout = `${stdout}${text}`.slice(-MAX_OUTPUT_BYTES);
      else stderr = `${stderr}${text}`.slice(-MAX_OUTPUT_BYTES);
    };
    child.stdout?.on("data", capture("stdout"));
    child.stderr?.on("data", capture("stderr"));
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    }, timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(new Error(`The operation timed out after ${Math.round(timeoutMs / 60000)} minutes.`));
    }, timeoutMs);
    child.once("error", error => finish(new Error(`Unable to start the installer: ${error.message}`)));
    child.once("close", (code, signal) => {
      const output = cleanOutput(`${stdout}\n${stderr}`);
      if (code === 0) finish(null, { code, output:cleanOutput(stdout), diagnostic:output });
      else {
        const error = new Error(output.slice(-1600) || `The operation stopped with ${signal || `exit code ${code}`}.`);
        error[PROCESS_OUTPUT] = output;
        finish(error);
      }
    });
  });
}

function isNpmMirrorNetworkFailure(output) {
  const code = /^npm (?:error|ERR!) code (\w+)\s*$/im.exec(output || "")?.[1];
  if (!/^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ERR_SOCKET_TIMEOUT)$/.test(code)) return false;
  const url = /^npm (?:error|ERR!) (?:network )?request to (https?:\/\/\S+) failed\b/im.exec(output)?.[1];
  const host = url && URL.parse(url)?.hostname;
  return host === "npmmirror.com" || Boolean(host?.endsWith(".npmmirror.com"));
}

function responseHeader(response, name) {
  return response?.headers && typeof response.headers.get === "function" ? String(response.headers.get(name) || "") : "";
}

function normalizeOmpArch(value) {
  const arch = String(value || "").trim().toLowerCase();
  if (arch === "arm64" || arch === "aarch64") return "arm64";
  if (arch === "x64" || arch === "x86_64" || arch === "amd64") return "x64";
  return "";
}

function ompReleaseAsset(platform = process.platform, options = {}) {
  let arch = normalizeOmpArch(options.arch);
  if (!arch && platform === "win32") {
    const env = options.env && typeof options.env === "object" ? options.env : null;
    arch = normalizeOmpArch(
      (env && (env[envKey(env, "PROCESSOR_ARCHITEW6432")] || env[envKey(env, "PROCESSOR_ARCHITECTURE")]))
      || (!options.home ? (process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE) : ""),
    );
  }
  if (!arch) arch = normalizeOmpArch(process.arch);
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return `omp-darwin-${arch}`;
  if (platform === "win32" && (arch === "arm64" || arch === "x64")) return `omp-windows-${arch}.exe`;
  return "";
}

function parseOmpReleaseTag(value) {
  const text = String(value || "").trim();
  const fromUrl = /\/releases\/tag\/(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:[/?#]|$)/.exec(text);
  if (fromUrl) return fromUrl[1];
  const direct = /^(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(text);
  return direct ? direct[1] : "";
}

function parseSha256Sums(text, assetName) {
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})[ \t]+\*?(.+?)\s*$/i.exec(line.trim());
    if (match && match[2] === assetName) return match[1].toLowerCase();
  }
  return "";
}

function parseContentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(String(value || "").trim());
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total) || end < start || total <= end) return null;
  return { start, end, total };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256"), stream = fs.createReadStream(file);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function sleep(ms) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function fetchMetadataWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error("Request timed out.")), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, { ...init, signal:controller.signal });
    let body = Buffer.alloc(0);
    if (init.method === "HEAD") {
      try { await response.body?.cancel?.(); } catch {}
    } else {
      body = Buffer.from(await response.arrayBuffer());
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveOmpLatestReleaseTag(fetchImpl, timeoutMs = OMP_METADATA_TIMEOUT_MS) {
  let headError = null;
  try {
    const { response } = await fetchMetadataWithTimeout(fetchImpl, OMP_RELEASES_LATEST_URL, {
      method:"HEAD",
      redirect:"follow",
      headers:{ "User-Agent":"PenEcho" },
    }, timeoutMs);
    if (response.ok || (response.status >= 300 && response.status < 400)) {
      const tag = parseOmpReleaseTag(responseHeader(response, "location")) || parseOmpReleaseTag(response.url);
      if (tag) return tag;
    }
    headError = new Error(`GitHub Releases returned HTTP ${response.status} without a release tag.`);
  } catch (error) {
    headError = error;
  }
  const { response, body } = await fetchMetadataWithTimeout(fetchImpl, OMP_RELEASES_API_LATEST_URL, {
    method:"GET",
    redirect:"follow",
    headers:{ Accept:"application/vnd.github+json", "User-Agent":"PenEcho" },
  }, timeoutMs);
  if (!response.ok) {
    throw new Error(`Could not resolve latest omp release on GitHub (HEAD: ${headError?.message || "no tag"}; API: HTTP ${response.status}).`);
  }
  let parsed;
  try { parsed = JSON.parse(body.toString("utf8")); }
  catch { throw new Error("GitHub Releases returned invalid JSON for latest omp release."); }
  const tag = parseOmpReleaseTag(parsed?.tag_name);
  if (!tag) throw new Error("GitHub Releases returned an invalid omp release tag.");
  return tag;
}

async function fetchOmpExpectedSha256(fetchImpl, tag, assetName, timeoutMs = OMP_METADATA_TIMEOUT_MS) {
  const url = `${OMP_RELEASE_DOWNLOAD_BASE}/${tag}/SHA256SUMS.txt`;
  const { response, body } = await fetchMetadataWithTimeout(fetchImpl, url, {
    method:"GET",
    redirect:"follow",
    headers:{ "User-Agent":"PenEcho" },
  }, timeoutMs);
  if (!response.ok) throw new Error(`Could not download omp SHA256SUMS.txt (HTTP ${response.status}).`);
  if (!body.length || body.length > MAX_INSTALLER_BYTES) throw new Error("omp SHA256SUMS.txt had an unexpected size.");
  const expected = parseSha256Sums(body.toString("utf8"), assetName);
  if (!expected) throw new Error(`omp SHA256SUMS.txt did not contain a checksum for ${assetName}.`);
  return expected;
}

async function writeFullChunk(file, chunk, position) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset, position + offset);
    if (!(bytesWritten > 0)) throw new Error("Failed writing downloaded omp binary.");
    offset += bytesWritten;
  }
  return position + offset;
}

async function downloadOmpReleaseBinary(url, partialPath, expectedSha256, options = {}) {
  const fetchImpl = options.fetchImpl,
    maxAttempts = Math.max(1, Number(options.maxAttempts) || OMP_DOWNLOAD_MAX_ATTEMPTS),
    timeoutMs = Math.max(1000, Number(options.timeoutMs) || OMP_DOWNLOAD_TIMEOUT_MS),
    idleTimeoutMs = Math.max(1000, Number(options.idleTimeoutMs) || OMP_DOWNLOAD_IDLE_MS),
    retryDelayMs = options.retryDelayMs === undefined ? 1000 : Math.max(0, Number(options.retryDelayMs) || 0),
    deadline = Date.now() + timeoutMs;
  let received = 0, expectedTotal = 0, checksumRetried = false, lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Downloading omp timed out after ${Math.round(timeoutMs / 60000)} minutes.`);
    }
    if (received > 0 && !fs.existsSync(partialPath)) {
      received = 0;
      expectedTotal = 0;
    }
    const controller = new AbortController();
    let idleTimer = null, file = null, reader = null;
    const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };
    const armIdle = () => {
      clearIdle();
      const left = deadline - Date.now();
      if (left <= 0) {
        controller.abort(new Error("Download timed out."));
        return;
      }
      idleTimer = setTimeout(() => controller.abort(new Error("Download stalled.")), Math.min(idleTimeoutMs, left));
      idleTimer.unref?.();
    };
    try {
      armIdle();
      const headers = { Accept:"application/octet-stream", "User-Agent":"PenEcho" };
      if (received > 0) headers.Range = `bytes=${received}-`;
      const response = await fetchImpl(url, { method:"GET", redirect:"follow", headers, signal:controller.signal });
      if (received > 0 && response.status === 416) {
        const rangeHeader = responseHeader(response, "content-range");
        if (new RegExp(`^bytes\\s+\\*/${received}$`, "i").test(rangeHeader.trim())) {
          clearIdle();
        } else {
          received = 0;
          expectedTotal = 0;
          try { fs.rmSync(partialPath, { force:true }); } catch {}
          throw new Error("Download range reset; retrying from start.");
        }
      } else if (received > 0 && response.status === 206) {
        const range = parseContentRange(responseHeader(response, "content-range"));
        if (!range || range.start !== received || (expectedTotal > 0 && range.total !== expectedTotal)) {
          received = 0;
          expectedTotal = 0;
          try { fs.rmSync(partialPath, { force:true }); } catch {}
          throw new Error("Server returned an unexpected Content-Range header.");
        }
        if (range.total > MAX_OMP_BINARY_BYTES) {
          const sizeError = new Error("The omp release binary exceeded the maximum supported size.");
          sizeError.noRetry = true;
          throw sizeError;
        }
        expectedTotal = range.total;
        file = await fs.promises.open(partialPath, "r+");
        await file.truncate(received);
      } else if (response.status === 200) {
        received = 0;
        expectedTotal = 0;
        const headerLength = Number(responseHeader(response, "content-length"));
        if (Number.isSafeInteger(headerLength) && headerLength > 0) {
          if (headerLength > MAX_OMP_BINARY_BYTES) {
            const sizeError = new Error("The omp release binary exceeded the maximum supported size.");
            sizeError.noRetry = true;
            throw sizeError;
          }
          expectedTotal = headerLength;
        }
        file = await fs.promises.open(partialPath, "w", 0o700);
      } else {
        const httpError = new Error(`GitHub Releases returned HTTP ${response.status} while downloading omp.`);
        if ([401, 403, 404, 410].includes(response.status)) httpError.noRetry = true;
        throw httpError;
      }

      if (file) {
        if (response.body && typeof response.body.getReader === "function") {
          reader = response.body.getReader();
          while (true) {
            armIdle();
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            if (!chunk.length) continue;
            if (received + chunk.length > MAX_OMP_BINARY_BYTES) {
              const sizeError = new Error("The omp release binary exceeded the maximum supported size.");
              sizeError.noRetry = true;
              throw sizeError;
            }
            received = await writeFullChunk(file, chunk, received);
          }
        } else {
          armIdle();
          const chunk = Buffer.from(await response.arrayBuffer());
          if (received + chunk.length > MAX_OMP_BINARY_BYTES) {
            const sizeError = new Error("The omp release binary exceeded the maximum supported size.");
            sizeError.noRetry = true;
            throw sizeError;
          }
          if (chunk.length) received = await writeFullChunk(file, chunk, received);
        }
        await file.close();
        file = null;
      }
      clearIdle();

      if (received === 0) throw new Error("The downloaded omp binary was empty.");
      if (expectedTotal > 0 && received < expectedTotal) {
        throw new Error(`Download ended early after ${received} of ${expectedTotal} bytes.`);
      }
      const actualSha256 = await sha256File(partialPath);
      if (actualSha256 !== expectedSha256) {
        received = 0;
        expectedTotal = 0;
        try { fs.rmSync(partialPath, { force:true }); } catch {}
        const checksumError = new Error(`Checksum mismatch for omp binary: expected ${expectedSha256}, got ${actualSha256}.`);
        if (checksumRetried) checksumError.noRetry = true;
        checksumRetried = true;
        throw checksumError;
      }
      return { bytes:received, sha256:actualSha256 };
    } catch (error) {
      clearIdle();
      if (reader) { try { await reader.cancel(); } catch {} reader = null; }
      if (file) { try { await file.close(); } catch {} file = null; }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.noRetry || attempt >= maxAttempts) throw lastError;
      const delay = Math.min(retryDelayMs * (2 ** (attempt - 1)), Math.max(0, deadline - Date.now()));
      if (delay > 0) await sleep(delay);
    }
  }
  throw lastError || new Error("Could not download omp from GitHub Releases.");
}

// omp.sh/install fetches ~234 MB binaries from build.stencil.so over uncached HTTP/2 without Range
// support or retries, which frequently stalls or aborts with curl (92) HTTP/2 INTERNAL_ERROR on
// slow/proxied connections. GitHub Releases publishes the exact same signed binaries alongside
// SHA256SUMS.txt with Accept-Ranges support, matching can1357/homebrew-tap's official mirror.
async function installOmpFromGitHubReleases(options = {}) {
  const platform = options.platform || process.platform,
    fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Secure download support is unavailable.");
  const assetName = ompReleaseAsset(platform, options);
  if (!assetName) throw new Error(`No prebuilt omp GitHub Release binary is available for ${platform}/${options.arch || process.arch}.`);
  const target = managedCliPath("omp-cli", options),
    metadataTimeoutMs = Math.max(1000, Number(options.metadataTimeoutMs) || OMP_METADATA_TIMEOUT_MS);
  const tag = await resolveOmpLatestReleaseTag(fetchImpl, metadataTimeoutMs);
  const expectedSha256 = await fetchOmpExpectedSha256(fetchImpl, tag, assetName, metadataTimeoutMs);
  const downloadUrl = `${OMP_RELEASE_DOWNLOAD_BASE}/${tag}/${assetName}`;
  const partial = `${target}.download.${process.pid}.${Date.now()}`;
  fs.mkdirSync(path.dirname(target), { recursive:true });
  try {
    await downloadOmpReleaseBinary(downloadUrl, partial, expectedSha256, {
      fetchImpl,
      maxAttempts:options.maxAttempts,
      idleTimeoutMs:options.idleTimeoutMs,
      timeoutMs:options.timeoutMs,
      retryDelayMs:options.retryDelayMs,
    });
    if (platform !== "win32") fs.chmodSync(partial, 0o755);
    fs.renameSync(partial, target);
    return { executable:target, tag, assetName };
  } finally {
    try { fs.rmSync(partial, { force:true }); } catch {}
  }
}

async function downloadInstaller(provider, destination, options = {}) {
  const platform = options.platform || process.platform,
    item = definition(provider, platform),
    fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!item.urls?.[platform]) throw new Error(`${item.label} does not use a script installer on this platform.`);
  if (typeof fetchImpl !== "function") throw new Error("Secure download support is unavailable.");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
  let response, bytes;
  try {
    response = await fetchImpl(item.urls[platform], { redirect:"follow", signal:controller.signal });
    if (!response.ok) throw new Error(`The official ${item.label} installer returned HTTP ${response.status}.`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error.message?.startsWith("The official")) throw error;
    throw new Error(`Could not download the official ${item.label} installer: ${error.message}`);
  } finally { clearTimeout(timer); }
  if (!bytes.length || bytes.length > MAX_INSTALLER_BYTES) throw new Error(`The official ${item.label} installer had an unexpected size.`);
  const text = bytes.toString("utf8"), marker = definitionMarker(item, platform);
  if (marker && !text.includes(marker)) throw new Error(`The downloaded ${item.label} installer did not pass validation.`);
  fs.mkdirSync(path.dirname(destination), { recursive:true, mode:0o700 });
  fs.writeFileSync(destination, bytes, { mode:0o700 });
  return item;
}

function installInvocation(provider, script, options = {}) {
  const platform = options.platform || process.platform, homeValue = String(options.home || "").trim(), stateValue = String(options.stateDir || "").trim();
  const item = definition(provider, platform);
  if (!homeValue || !stateValue) throw new Error("Application paths are unavailable.");
  const home = path.resolve(homeValue),
    stateDir = path.resolve(stateValue),
    env = prepareAgentEnv(process.env, { ...options.env, HOME:home, USERPROFILE:home }, { platform, sandboxWindowsPath:false });
  enrichInstallerPath(env, home, platform, { env:options.env });
  if (platform === "win32") {
    const localKey = envKey(env, "LOCALAPPDATA") || "LOCALAPPDATA";
    if (!env[localKey]) env[localKey] = codexLocalAppData(home, options);
    const appDataKey = envKey(env, "APPDATA") || "APPDATA";
    if (!env[appDataKey]) env[appDataKey] = windowsAppData(home, options);
  }
  if (provider === "codex-cli") {
    env.CODEX_NON_INTERACTIVE = "1";
    env.CODEX_RELEASE = "latest";
    env.CODEX_HOME = managedCliHome(provider, { platform, home, stateDir, env:options.env });
    env.CODEX_INSTALL_DIR = path.dirname(managedCliPath(provider, { platform, home, stateDir, env:options.env }));
    if (platform === "win32") {
      const localKey = envKey(env, "LOCALAPPDATA") || "LOCALAPPDATA";
      env[localKey] = codexLocalAppData(home, options);
    }
  }
  if (provider === "kimi-cli") {
    env.KIMI_INSTALL_DIR = path.dirname(path.dirname(managedCliPath(provider, { platform, home, stateDir })));
    env.KIMI_NO_MODIFY_PATH = "1";
  }
  if (provider === "omp-cli") {
    env.PI_INSTALL_DIR = path.dirname(managedCliPath(provider, { platform, home, stateDir, env:options.env }));
  }
  const npmPackage = !item.urls?.[platform] ? item.npmPackages?.[platform] : "";
  if (npmPackage) {
    const npm = options.npmExecutable || findNpmExecutable(env, platform);
    if (!npm) {
      throw new Error(`Node.js (npm) is required to install ${item.label} automatically. Install Node.js or use Copy install prompt.`);
    }
    const prefix = npmPrefixFor(provider, { platform, home, env:options.env });
    const npmArgs = ["install", "-g", "--prefix", prefix, npmPackage];
    const launch = commandInvocation(npm, npmArgs, env, platform);
    return {
      command:launch.command,
      args:launch.args,
      ...(launch.windowsVerbatimArguments ? { windowsVerbatimArguments:true } : {}),
      env,
      item,
      prefix,
      npm,
      npmArgs,
    };
  }
  if (platform === "win32") {
    // The script is named in the environment, so no path needs quoting.
    env.PENECHO_INSTALLER_SCRIPT = script;
    const extraArgs = provider === "claude-cli" ? " stable" : provider === "omp-cli" ? " -Binary" : "";
    let run = `& $env:PENECHO_INSTALLER_SCRIPT${extraArgs}`;
    if (provider === "pi-cli") {
      // pi.dev/install.ps1 calls Read-Host in Write-PiNotOnPathMessage without checking
      // Test-InstallerInteractiveInput, which throws PSInvalidOperationException under -NonInteractive.
      // Prepending ~/.pi/agent/bin satisfies Test-InstalledPiIsFirstOnPath for managed installs, and
      // shadowing Read-Host keeps fallback/custom install paths from crashing on the PATH prompt.
      prependInstallerPath(env, path.dirname(managedCliPath(provider, { platform, home, stateDir, env:options.env })), platform);
      run = "function Read-Host { 'n' }; . $env:PENECHO_INSTALLER_SCRIPT";
    }
    return {
      command:powershellExecutable(env),
      args:["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `${POWERSHELL_INSTALL_DEFAULTS}; ${run}`],
      env,
      item,
    };
  }
  const extraArgs = provider === "claude-cli" ? ["stable"] : provider === "omp-cli" ? ["--binary"] : [];
  return {
    command:["kimi-cli", "claude-cli", "opencode-cli", "antigravity-cli"].includes(provider) ? "/bin/bash" : "/bin/sh",
    args:[script, ...extraArgs],
    env,
    item,
  };
}

function existingCodexCheckEnv(home, options = {}) {
  const base = options.env && typeof options.env === "object" ? { ...options.env } : { ...process.env };
  if (!base[envKey(base, "HOME")]) base.HOME = home;
  if (!base[envKey(base, "USERPROFILE")]) base.USERPROFILE = home;
  return base;
}

async function findExistingCodex(options = {}) {
  const platform = options.platform || process.platform,
    home = path.resolve(String(options.home || "")),
    stateDir = path.resolve(String(options.stateDir || "")),
    runner = options.runner || runProcess,
    checkEnv = existingCodexCheckEnv(home, options),
    candidates = Array.isArray(options.existingCandidates)
      ? options.existingCandidates
      : cliCandidates("codex-cli", {
        platform,
        home,
        stateDir,
        env:checkEnv,
        configuredPath:options.configuredPath,
        appFolders:options.appFolders,
        includeSystemDirs:options.includeSystemDirs,
        systemDirs:options.systemDirs,
        windowsAppsRoot:options.windowsAppsRoot,
        run:options.appRun,
      });
  for (const candidate of candidates) {
    const executable = String(candidate?.executable || "").trim();
    if (!executable) continue;
    let launch;
    try {
      launch = platform === process.platform
        ? resolveCodexLaunch(executable, checkEnv)
        : { command:executable, prefixArgs:[] };
    } catch {
      continue;
    }
    try {
      const childEnv = prepareAgentEnv(checkEnv, launch.env, { platform, sandboxWindowsPath:false });
      const version = await runner(launch.command, [...launch.prefixArgs, "--version"], { cwd:stateDir, env:childEnv, timeoutMs:15000 });
      const versionText = cleanOutput(version?.output || version?.diagnostic).slice(0, 200);
      return {
        executable:path.resolve(executable),
        version:versionText,
        source:candidate.source || "system",
      };
    } catch {
      // Candidate could not start cleanly; continue checking remaining user installations.
    }
  }
  return null;
}

async function installCliOnce(provider, options = {}) {
  const platform = options.platform || process.platform, homeValue = String(options.home || "").trim(), stateValue = String(options.stateDir || "").trim();
  const item = definition(provider, platform);
  if (!homeValue || !stateValue) throw new Error("Application paths are unavailable.");
  const home = path.resolve(homeValue),
    stateDir = path.resolve(stateValue),
    runner = options.runner || runProcess;
  // Always check the user's own Codex CLI / Codex Desktop app first; only download official `latest` when none is available.
  if (provider === "codex-cli" && !options.skipExistingCheck) {
    const existing = await findExistingCodex({ ...options, platform, home, stateDir, runner });
    if (existing) {
      return {
        provider,
        executable:existing.executable,
        version:existing.version,
        label:item.label,
        alreadyInstalled:true,
        source:existing.source,
      };
    }
  }
  const usesScript = Boolean(item.urls?.[platform]);
  const extension = platform === "win32" ? "ps1" : "sh",
    script = usesScript ? path.join(stateDir, "installers", `${provider}.${extension}`) : "";
  let ompGithubError = null, ompInstalledDirect = false;
  if (provider === "omp-cli") {
    try {
      await installOmpFromGitHubReleases({
        platform,
        arch:options.arch,
        home,
        stateDir,
        env:options.env,
        fetchImpl:options.fetchImpl,
        maxAttempts:options.ompMaxAttempts,
        idleTimeoutMs:options.ompIdleTimeoutMs,
        timeoutMs:options.ompTimeoutMs,
        metadataTimeoutMs:options.ompMetadataTimeoutMs,
        retryDelayMs:options.ompRetryDelayMs,
      });
      ompInstalledDirect = true;
    } catch (error) {
      ompGithubError = error instanceof Error ? error : new Error(String(error));
    }
  }
  const invocation = installInvocation(provider, script, { platform, home, stateDir, env:options.env, npmExecutable:options.npmExecutable });
  if (!ompInstalledDirect) {
    try {
      if (usesScript) await downloadInstaller(provider, script, { platform, fetchImpl:options.fetchImpl });
      if (invocation.prefix) fs.mkdirSync(invocation.prefix, { recursive:true });
      const installOptions = {
        cwd:stateDir,
        env:invocation.env,
        timeoutMs:INSTALL_TIMEOUT_MS,
        ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments:true } : {}),
      };
      try {
        await runner(invocation.command, invocation.args, installOptions);
      } catch (error) {
        if (provider !== "dsh-cli" || !isNpmMirrorNetworkFailure(error[PROCESS_OUTPUT])) throw error;
        const cache = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-dsh-npm-"));
        try {
          // Use fresh registry metadata so npm does not reuse tarball URLs advertised by the mirror.
          const args = [...invocation.npmArgs, `--registry=${NPM_REGISTRY}`, `--@deepseek-ai:registry=${NPM_REGISTRY}`, "--cache", cache];
          const retry = commandInvocation(invocation.npm, args, invocation.env, platform);
          await runner(retry.command, retry.args, installOptions);
        } catch (retryError) {
          throw new Error(`The npm mirror connection failed. Retrying dsh from the official npm registry also failed:\n${retryError.message}`, { cause:retryError });
        } finally {
          try { fs.rmSync(cache, { recursive:true, force:true }); } catch {}
        }
      }
    } catch (error) {
      if (ompGithubError) {
        throw new Error(`GitHub Releases download failed (${ompGithubError.message}). Official installer fallback also failed:\n${error.message}`, { cause:error });
      }
      throw error;
    } finally {
      if (script) try { fs.rmSync(script, { force:true }); } catch {}
    }
  }
  const executable = installedCliCandidates(provider, { platform, home, stateDir, env:options.env }).find(file => fs.existsSync(file));
  if (!executable) throw new Error(`${item.label} finished installing, but its executable could not be found.`);
  const check = commandInvocation(executable, ["--version"], invocation.env, platform);
  const version = await runner(check.command, check.args, {
    cwd:stateDir,
    env:invocation.env,
    timeoutMs:30000,
    ...(check.windowsVerbatimArguments ? { windowsVerbatimArguments:true } : {}),
  });
  if (platform === "win32" && provider === "pi-cli") {
    const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WINDOWS_PI_USER_PATH_SCRIPT, "utf16le").toString("base64")];
    try {
      await runner(invocation.command, args, {
        cwd:stateDir,
        env:{ ...invocation.env, PENECHO_PI_BIN_DIR:path.dirname(executable) },
        timeoutMs:30000,
      });
    } catch (error) {
      throw new Error(`Could not add Pi to your Windows user PATH. ${error.message}`, { cause:error });
    }
  }
  const versionText = cleanOutput(version.output || version.diagnostic).slice(0, 200);
  return {
    provider,
    executable,
    version:versionText,
    label:item.label,
    ...(provider === "codex-cli" ? { alreadyInstalled:false, source:"system" } : {}),
  };
}

function installCli(provider, options = {}) {
  if (provider !== "codex-cli") return installCliOnce(provider, options);
  const homeValue = String(options.home || "").trim(),
    platform = options.platform || process.platform;
  if (!homeValue) return installCliOnce(provider, options);
  const key = `${path.resolve(homeValue)}\0${platform}`;
  const existing = inFlightCodexInstalls.get(key);
  if (existing) return existing;
  const installing = installCliOnce(provider, options);
  inFlightCodexInstalls.set(key, installing);
  installing.finally(() => {
    if (inFlightCodexInstalls.get(key) === installing) inFlightCodexInstalls.delete(key);
  }).catch(() => {});
  return installing;
}

function canInspectCli(provider) {
  return Boolean(INSTALL_COMMANDS[provider]);
}

module.exports = {
  DEFINITIONS,
  INSTALL_COMMANDS,
  LOGIN_COMMANDS,
  canInspectCli,
  definition,
  downloadInstaller,
  enrichInstallerPath,
  assertCodexCliBundle,
  codexHostName,
  codexCliVersion,
  findExistingCodex,
  inspectCli,
  installCli,
  installInvocation,
  installOmpFromGitHubReleases,
  installedCliCandidates,
  managedCliHome,
  managedCliPath,
  ompReleaseAsset,
  parseSha256Sums,
  runProcess,
};
