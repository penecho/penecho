"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CA_FILE_ENV_VARS = Object.freeze([
  "CODEX_CA_CERTIFICATE",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
]);

const CA_DIR_ENV_VARS = Object.freeze([
  "SSL_CERT_DIR",
]);

const WINDOWS_SANDBOX_SHELL_ALIASES = Object.freeze([
  "pwsh.exe",
  "powershell.exe",
  "bash.exe",
]);

const MAX_SHIM_BYTES = 64 * 1024;

function envKey(env, name) {
  const wanted = String(name || "").toLowerCase();
  return Object.keys(env || {}).find((key) => key.toLowerCase() === wanted) || null;
}

function envKeys(env, name) {
  const wanted = String(name || "").toLowerCase();
  return Object.keys(env || {}).filter((key) => key.toLowerCase() === wanted);
}

function deleteEnvKey(env, name) {
  for (const key of envKeys(env, name)) delete env[key];
}

function stripOuterQuotes(value) {
  return String(value || "").trim().replace(/^"|"$/g, "");
}

function isReadableRegularFile(file, fsOps = fs, { nonEmpty = false } = {}) {
  const target = String(file || "").trim();
  if (!target) return false;
  try {
    const stat = fsOps.statSync(target);
    if (!stat.isFile()) return false;
    if (nonEmpty && !(stat.size > 0)) return false;
    fsOps.accessSync(target, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isReadableDirectory(dir, fsOps = fs) {
  const target = String(dir || "").trim();
  if (!target) return false;
  try {
    if (!fsOps.statSync(target).isDirectory()) return false;
    fsOps.accessSync(target, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectoryPath(dir, fsOps = fs) {
  const target = String(dir || "").trim();
  if (!target) return false;
  try {
    return fsOps.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

// Matches Microsoft Store App Execution Alias directories (%LOCALAPPDATA%\Microsoft\WindowsApps)
// and MSIX package directories under Program Files\WindowsApps, none of which can be executed
// under Windows restricted-user sandboxes (CreateProcessAsUserW fails with ERROR_ACCESS_DENIED = 5).
function isWindowsStoreAppsDir(dir) {
  const clean = stripOuterQuotes(dir);
  if (!clean) return false;
  return /[\\/]microsoft[\\/]windowsapps[\\/]?$/i.test(clean)
    || /[\\/]program files(?: \(x86\))?[\\/]windowsapps(?:[\\/]|$)/i.test(clean);
}

// Generic detection for Windows Store App Execution Aliases or inaccessible reparse points
// in any PATH directory: lstatSync succeeds while statSync fails with EACCES/EPERM.
function hasInaccessibleShellAlias(dir, fsOps = fs, names = WINDOWS_SANDBOX_SHELL_ALIASES) {
  const clean = stripOuterQuotes(dir);
  if (!clean) return false;
  for (const name of names) {
    const candidate = path.join(clean, name);
    try {
      fsOps.lstatSync(candidate);
    } catch {
      continue;
    }
    try {
      fsOps.statSync(candidate);
    } catch (error) {
      if (!error || ["EACCES", "EPERM", "ENOENT"].includes(error.code)) return true;
    }
  }
  return false;
}

function isSandboxUnsafeWindowsPathDir(dir, fsOps = fs) {
  return isWindowsStoreAppsDir(dir) || hasInaccessibleShellAlias(dir, fsOps);
}

// Backwards-compatible helper: detects Windows Store pwsh.exe App Execution Aliases (reparse points
// where statSync/existsSync fail with EACCES/false while lstatSync succeeds).
function hasWindowsAppsPwshAlias(dir, fsOps = fs) {
  const clean = stripOuterQuotes(dir);
  if (!clean || !isWindowsStoreAppsDir(clean)) return false;
  try {
    fsOps.lstatSync(path.join(clean, "pwsh.exe"));
    return true;
  } catch {
    return false;
  }
}

function normalizeWindowsDirKey(dir) {
  return stripOuterQuotes(dir).replace(/[\\/]+$/, "").toLowerCase();
}

function windowsBaselineSystemDirs(env, fsOps = fs) {
  const rootKey = envKey(env, "SystemRoot") || envKey(env, "WINDIR");
  const root = String((rootKey && env[rootKey]) || "C:\\Windows").trim();
  const candidates = [
    path.join(root, "System32"),
    path.join(root, "System32", "WindowsPowerShell", "v1.0"),
  ];
  return candidates.filter((dir) => isDirectoryPath(dir, fsOps));
}

function hasAccessiblePowerShell(dirs, fsOps = fs) {
  for (const dir of dirs) {
    const clean = stripOuterQuotes(dir);
    if (!clean) continue;
    for (const exe of ["pwsh.exe", "powershell.exe"]) {
      try {
        if (fsOps.statSync(path.join(clean, exe)).isFile()) return true;
      } catch {}
    }
  }
  return false;
}

// Prepare a clean child environment for spawning any CLI agent without mutating the user's system settings:
// 1. Merge overrides case-insensitively on Windows so Path/PATH or mixed-case vars never duplicate.
// 2. Strip dangling/unreadable/empty TLS CA env vars across all agents and OSes (preserving valid CA files).
// 3. On Windows sandboxed runs (e.g. Codex workspace-write/read-only, dsh workspace-write), omit Windows Store
//    App Execution Alias / MSIX WindowsApps directories from child PATH so restricted sandbox tokens never hit
//    CreateProcessAsUserW Error 5, while keeping non-Store PowerShell 7 and ensuring System32 + WindowsPowerShell.
function prepareAgentEnv(env = process.env, extra = null, options = {}) {
  const platform = options.platform || process.platform;
  const fsOps = options.fs || fs;
  const sandboxWindowsPath = Boolean(options.sandboxWindowsPath);
  const clean = { ...(env || {}) };
  if (extra && typeof extra === "object") {
    for (const [key, value] of Object.entries(extra)) {
      if (platform === "win32") deleteEnvKey(clean, key);
      if (value === undefined) delete clean[key];
      else clean[key] = value;
    }
  }
  for (const certVar of CA_FILE_ENV_VARS) {
    for (const key of envKeys(clean, certVar)) {
      if (!isReadableRegularFile(clean[key], fsOps, { nonEmpty: true })) delete clean[key];
    }
  }
  for (const certDirVar of CA_DIR_ENV_VARS) {
    for (const key of envKeys(clean, certDirVar)) {
      if (!isReadableDirectory(clean[key], fsOps)) delete clean[key];
    }
  }
  if (platform === "win32" && sandboxWindowsPath) {
    const pathKey = envKey(clean, "PATH");
    if (pathKey && typeof clean[pathKey] === "string") {
      const entries = clean[pathKey].split(";").filter(Boolean);
      const filtered = entries.filter((entry) => !isSandboxUnsafeWindowsPathDir(entry, fsOps));
      const hasSystemRoot = Boolean(envKey(clean, "SystemRoot") || envKey(clean, "WINDIR"));
      const removed = filtered.length !== entries.length;
      const needsPowerShellFallback = entries.length > 0 && hasSystemRoot && !hasAccessiblePowerShell(filtered, fsOps);
      if (removed || needsPowerShellFallback) {
        const baseline = windowsBaselineSystemDirs(clean, fsOps);
        for (const sysDir of baseline) {
          if (!filtered.some((entry) => normalizeWindowsDirKey(entry) === normalizeWindowsDirKey(sysDir))) {
            filtered.push(sysDir);
          }
        }
        deleteEnvKey(clean, "PATH");
        clean[pathKey] = filtered.join(";");
      }
    }
  }
  return clean;
}

// Safely parse a Windows .cmd/.bat shim (npm, pnpm, yarn, volta, scoop, etc.) without executing a shell,
// returning the resolved target .js/.cjs/.mjs/.exe file when it matches one of `expectedNames` and exists.
function resolveWindowsCmdShim(shimFile, expectedNames, options = {}) {
  const fsOps = options.fs || fs;
  const expected = new Set((expectedNames || []).map((name) => String(name || "").toLowerCase()).filter(Boolean));
  if (!shimFile || !expected.size) return null;
  let content = "";
  try {
    const stat = fsOps.statSync(shimFile);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SHIM_BYTES) return null;
    content = fsOps.readFileSync(shimFile, "utf8");
  } catch {
    return null;
  }
  const shimDir = path.dirname(shimFile);
  const tokens = [];
  for (const match of content.matchAll(/"([^"\r\n]+)"|([^\s"'\r\n]+)/g)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (raw) tokens.push(raw);
  }
  for (const raw of tokens) {
    if (/[|&<>;\0]/.test(raw)) continue;
    const lower = raw.toLowerCase();
    const baseName = lower.split(/[\\/]/).pop();
    if (!expected.has(baseName)) continue;
    let candidate = "";
    if (/^%~?dp0%?[\\/]?/i.test(raw)) {
      const rel = raw.replace(/^%~?dp0%?[\\/]?/i, "");
      if (/%[^%]+%/.test(rel)) continue;
      const parts = rel.split(/[\\/]+/).filter(Boolean);
      candidate = path.resolve(shimDir, ...parts);
    } else if (/^(?:[A-Za-z]:[\\/]|\/)/.test(raw)) {
      if (/%[^%]+%/.test(raw)) continue;
      candidate = path.resolve(raw);
    } else {
      continue;
    }
    if (!expected.has(path.basename(candidate).toLowerCase())) continue;
    try {
      if (fsOps.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

module.exports = {
  CA_DIR_ENV_VARS,
  CA_FILE_ENV_VARS,
  deleteEnvKey,
  envKey,
  envKeys,
  hasInaccessibleShellAlias,
  hasWindowsAppsPwshAlias,
  isDirectoryPath,
  isReadableDirectory,
  isReadableRegularFile,
  isSandboxUnsafeWindowsPathDir,
  isWindowsStoreAppsDir,
  normalizeWindowsDirKey,
  prepareAgentEnv,
  resolveWindowsCmdShim,
  stripOuterQuotes,
  windowsBaselineSystemDirs,
};
