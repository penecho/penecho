"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { CLI_INSTALL_COMMANDS:INSTALL_COMMANDS, CLI_LOGIN_COMMANDS:LOGIN_COMMANDS, inspectCli } = require("./cli-inspection.js");

const MAX_INSTALLER_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const CODEX_CLI_PINNED_VERSION = "0.149.1";

const DEFINITIONS = Object.freeze({
  "kimi-cli":Object.freeze({
    label:"Kimi Code",
    urls:Object.freeze({
      darwin:"https://code.kimi.com/kimi-code/install.sh",
      win32:"https://code.kimi.com/kimi-code/install.ps1",
    }),
    marker:"KIMI_BINARY_BASE",
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
});

function definition(provider, platform = process.platform) {
  const result = DEFINITIONS[provider];
  if (!result) throw new Error("Choose Kimi CLI, Codex CLI, or Claude CLI.");
  if (!result.urls[platform]) throw new Error(`${result.label} automatic installation is available on macOS and Windows.`);
  return result;
}

function executableName(base, platform) {
  return platform === "win32" ? `${base}.exe` : base;
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

function managedCliPath(provider, options = {}) {
  const platform = options.platform || process.platform, homeValue=String(options.home||"").trim(), stateValue=String(options.stateDir||"").trim();
  if (!homeValue || !stateValue) throw new Error("Application paths are unavailable.");
  const home = path.resolve(homeValue), stateDir = path.resolve(stateValue), item = definition(provider, platform);
  if (provider === "codex-cli") {
    return path.join(stateDir, "tools", "codex", "bin", executableName(item.executable, platform));
  }
  if (provider === "kimi-cli") {
    return path.join(stateDir, "tools", "kimi", "bin", executableName(item.executable, platform));
  }
  return path.join(home, ".local", "bin", executableName(item.executable, platform));
}

function managedCliHome(provider, options = {}) {
  const stateValue=String(options.stateDir||"").trim();
  if (!stateValue) throw new Error("Application state path is unavailable.");
  const stateDir = path.resolve(stateValue);
  return path.join(stateDir, "tools", provider === "codex-cli" ? "codex" : provider === "kimi-cli" ? "kimi" : "claude", "home");
}

function powershellExecutable(env) {
  const root = String(env.SystemRoot || env.WINDIR || "C:\\Windows");
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function cleanOutput(value) {
  return String(value || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\r\t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function codexCliVersion(value) {
  const match = /(?:^|\s|v)(\d+\.\d+\.\d+)(?:[-+\s]|$)/i.exec(String(value || ""));
  return match ? match[1] : "";
}

function assertCodexCliVersion(value, expectedVersion = CODEX_CLI_PINNED_VERSION) {
  const expected = String(expectedVersion || "").trim(), actual = codexCliVersion(value);
  if (actual && (expected === "latest" || actual === expected)) return actual;
  const error = new Error(actual
    ? `PenEcho Agent requires Codex CLI ${expected}, but found ${actual}.`
    : `PenEcho Agent requires Codex CLI ${expected}, but the candidate did not report a compatible version.`);
  error.code = "CODEX_CLI_VERSION_INCOMPATIBLE";
  error.expectedVersion = expected;
  error.actualVersion = actual;
  throw error;
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
      else finish(new Error(output.slice(-1600) || `The operation stopped with ${signal || `exit code ${code}`}.`));
    });
  });
}

async function downloadInstaller(provider, destination, options = {}) {
  const platform = options.platform || process.platform,
    item = definition(provider, platform),
    fetchImpl = options.fetchImpl || globalThis.fetch;
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
  const text = bytes.toString("utf8");
  if (!text.includes(item.marker)) throw new Error(`The downloaded ${item.label} installer did not pass validation.`);
  fs.mkdirSync(path.dirname(destination), { recursive:true, mode:0o700 });
  fs.writeFileSync(destination, bytes, { mode:0o700 });
  return item;
}

function installInvocation(provider, script, options = {}) {
  const platform = options.platform || process.platform, homeValue=String(options.home||"").trim(), stateValue=String(options.stateDir||"").trim();
  if (!homeValue || !stateValue) throw new Error("Application paths are unavailable.");
  const home = path.resolve(homeValue),
    stateDir = path.resolve(stateValue),
    env = { ...process.env, ...options.env, HOME:home, USERPROFILE:home },
    item = definition(provider, platform);
  if (provider === "codex-cli") {
    env.CODEX_NON_INTERACTIVE = "1";
    env.CODEX_RELEASE = String(options.codexVersion || CODEX_CLI_PINNED_VERSION);
    env.CODEX_HOME = path.resolve(options.managedHome || managedCliHome(provider, { stateDir }));
    env.CODEX_INSTALL_DIR = path.resolve(options.installDirectory || path.dirname(managedCliPath(provider, { platform, home, stateDir })));
  }
  if (provider === "kimi-cli") {
    env.KIMI_INSTALL_DIR = path.dirname(path.dirname(managedCliPath(provider, { platform, home, stateDir })));
    env.KIMI_NO_MODIFY_PATH = "1";
  }
  if (platform === "win32") {
    return {
      command:powershellExecutable(env),
      args:["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...(provider === "claude-cli" ? ["stable"] : [])],
      env,
      item,
    };
  }
  return {
    command:["kimi-cli", "claude-cli"].includes(provider) ? "/bin/bash" : "/bin/sh",
    args:[script, ...(provider === "claude-cli" ? ["stable"] : [])],
    env,
    item,
  };
}

function replaceManagedDirectory(stagedDirectory, destinationDirectory) {
  const parent = path.dirname(destinationDirectory);
  fs.mkdirSync(parent, { recursive:true, mode:0o700 });
  const replacement = path.join(parent, `.penecho-codex-${randomUUID()}`),
    backup = path.join(parent, `.penecho-codex-backup-${randomUUID()}`),
    hadExisting = fs.existsSync(destinationDirectory);
  fs.renameSync(stagedDirectory, replacement);
  try {
    if (hadExisting) fs.renameSync(destinationDirectory, backup);
    fs.renameSync(replacement, destinationDirectory);
  } catch (error) {
    try { fs.rmSync(replacement, { recursive:true, force:true }); } catch {}
    if (hadExisting && !fs.existsSync(destinationDirectory) && fs.existsSync(backup)) {
      try { fs.renameSync(backup, destinationDirectory); } catch {}
    }
    throw error;
  }
  if (hadExisting) try { fs.rmSync(backup, { recursive:true, force:true }); } catch {}
}

async function installCli(provider, options = {}) {
  const platform = options.platform || process.platform, homeValue=String(options.home||"").trim(), stateValue=String(options.stateDir||"").trim();
  if (!homeValue || !stateValue) throw new Error("Application paths are unavailable.");
  const home = path.resolve(homeValue),
    stateDir = path.resolve(stateValue),
    extension = platform === "win32" ? "ps1" : "sh",
    script = path.join(stateDir, "installers", `${provider}.${extension}`),
    runner = options.runner || runProcess,
    stagingRoot = provider === "codex-cli" ? path.join(stateDir, "installers", `codex-${randomUUID()}`) : "",
    installDirectory = stagingRoot ? path.join(stagingRoot, "bin") : "";
  const item = await downloadInstaller(provider, script, { platform, fetchImpl:options.fetchImpl });
  try {
    const requestedCodexVersion = String(options.codexVersion || CODEX_CLI_PINNED_VERSION),
      invocation = installInvocation(provider, script, { platform, home, stateDir, env:options.env, codexVersion:requestedCodexVersion, ...(installDirectory ? { installDirectory } : {}) });
    await runner(invocation.command, invocation.args, { cwd:stateDir, env:invocation.env, timeoutMs:INSTALL_TIMEOUT_MS });
    const executable = managedCliPath(provider, { platform, home, stateDir }),
      installedExecutable = installDirectory ? path.join(installDirectory, executableName(item.executable, platform)) : executable;
    if (!fs.existsSync(installedExecutable)) throw new Error(`${item.label} finished installing, but its executable could not be found.`);
    if (provider === "codex-cli") assertCodexCliBundle(installedExecutable, platform);
    const version = await runner(installedExecutable, ["--version"], { cwd:stateDir, env:invocation.env, timeoutMs:30000 });
    const versionText = cleanOutput(version.output || version.diagnostic).slice(0, 200);
    if (provider === "codex-cli") assertCodexCliVersion(versionText, requestedCodexVersion);
    if (installDirectory) replaceManagedDirectory(installDirectory, path.dirname(executable));
    return { provider, executable, ...(provider === "codex-cli" ? { hostExecutable:path.join(path.dirname(executable),codexHostName(platform)) } : {}), version:versionText, label:item.label };
  } finally {
    try { fs.rmSync(script, { force:true }); } catch {}
    if (stagingRoot) try { fs.rmSync(stagingRoot, { recursive:true, force:true }); } catch {}
  }
}

module.exports = {
  CODEX_CLI_PINNED_VERSION,
  DEFINITIONS,
  INSTALL_COMMANDS,
  LOGIN_COMMANDS,
  definition,
  downloadInstaller,
  assertCodexCliBundle,
  assertCodexCliVersion,
  codexHostName,
  codexCliVersion,
  inspectCli,
  installCli,
  installInvocation,
  managedCliHome,
  managedCliPath,
  replaceManagedDirectory,
  runProcess,
};
