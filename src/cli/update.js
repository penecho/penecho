"use strict";

const readline = require("readline/promises");
const { spawn } = require("child_process");
const PACKAGE_JSON = require("../../package.json");

const UPDATE_CHECK_TIMEOUT_MS = 30000;
const UPDATE_CHECK_ATTEMPTS = 2;
const UPDATE_RETRY_DELAY_MS = 250;
const UPDATE_SKIP_ENV = "PENECHO_SKIP_UPDATE_CHECK";

function parsedVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return { numbers:match.slice(1, 4).map(Number), prerelease:match[4] ? match[4].split(".") : [] };
}

function compareVersions(left, right) {
  const a = parsedVersion(left), b = parsedVersion(right);
  if (!a || !b) throw new Error("PenEcho received an invalid npm version.");
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index++) {
    if (a.prerelease[index] === undefined || b.prerelease[index] === undefined) return a.prerelease[index] === undefined ? -1 : 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumber = /^\d+$/.test(a.prerelease[index]) ? Number(a.prerelease[index]) : null,
      bNumber = /^\d+$/.test(b.prerelease[index]) ? Number(b.prerelease[index]) : null;
    if (aNumber !== null && bNumber !== null) return aNumber > bNumber ? 1 : -1;
    if (aNumber !== null || bNumber !== null) return aNumber !== null ? -1 : 1;
    return a.prerelease[index] > b.prerelease[index] ? 1 : -1;
  }
  return 0;
}

async function fetchLatestNpmVersion(packageName = PACKAGE_JSON.name, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("This Node.js version does not provide fetch().");
  const timeoutMs = options.timeoutMs || UPDATE_CHECK_TIMEOUT_MS,
    attempts = Math.max(1, Number(options.attempts) || UPDATE_CHECK_ATTEMPTS),
    retryDelayMs = Math.max(0, Number(options.retryDelayMs) || UPDATE_RETRY_DELAY_MS),
    url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    deadline = Date.now() + timeoutMs;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      lastError = new Error(`npm update check timed out after ${timeoutMs} ms.`);
      break;
    }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), remainingMs);
    try {
      const response = await fetchImpl(url, {
        headers:{ Accept:"application/json", "User-Agent":`penecho/${PACKAGE_JSON.version}` },
        redirect:"error",
        signal:controller.signal,
      });
      if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}.`);
      const latest = String((await response.json())?.version || "").trim();
      if (!parsedVersion(latest)) throw new Error("npm registry returned an invalid PenEcho version.");
      return latest.replace(/^v/, "");
    } catch (error) {
      lastError = controller.signal.aborted ? new Error(`npm update check timed out after ${timeoutMs} ms.`) : error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts && retryDelayMs) {
      const delayMs = Math.min(retryDelayMs, Math.max(0, deadline - Date.now()));
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError || new Error("npm update check failed.");
}

function updateCheckErrorMessage(error) {
  return String(error?.message || error || "unknown error").replace(/\s+/g, " ").trim().slice(0, 180);
}

async function confirmUpdate(message, options = {}) {
  if (typeof options.confirmUpdate === "function") return Boolean(await options.confirmUpdate(message, true));
  if (typeof options.ui?.confirm === "function") return Boolean(await options.ui.confirm(message, true));
  const input = options.input || process.stdin, output = options.output || process.stdout,
    prompt = readline.createInterface({ input, output });
  try {
    const answer = String(await prompt.question(`${message} [Y/n] `)).trim();
    return !/^(?:n|no)$/i.test(answer);
  } finally {
    prompt.close();
  }
}

function commandInvocation(command, args, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(command)) return { command, args:[...args] };
  const env = options.env || process.env,
    commandProcessor = env.ComSpec || env.COMSPEC || process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
  return { command:commandProcessor, args:["/d", "/s", "/c", command, ...args] };
}

function runNpmGlobalUpdate(version, options = {}) {
  const spawnImpl = options.spawnImpl || spawn,
    platform = options.platform || process.platform,
    command = platform === "win32" ? "npm.cmd" : "npm",
    args = ["install", "--global", `${PACKAGE_JSON.name}@${version}`],
    invocation = commandInvocation(command, args, { platform, env:options.env });
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(invocation.command, invocation.args, {
        cwd:options.cwd || process.cwd(),
        env:options.env || process.env,
        stdio:"inherit",
        windowsHide:false,
        shell:false,
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", reject);
    child.once("close", code => resolve(code === 0));
  });
}


function updateCheckAllowed(options = {}) {
  const env = options.env || process.env, input = options.input || process.stdin, output = options.output || process.stdout,
    interactive = Boolean(options.ui?.interactive || input.isTTY && output.isTTY);
  if (!interactive || /^(?:1|true|yes|on)$/i.test(String(env[UPDATE_SKIP_ENV] || "").trim())) return false;
  return options.updateCheck !== false;
}

async function maybeUpdateOnStart(argv, options = {}) {
  if (!updateCheckAllowed(options)) return { checked:false, restarted:false };
  const output = options.output || process.stdout,
    errorOutput = options.errorOutput || process.stderr,
    checker = options.updateChecker || (() => fetchLatestNpmVersion(PACKAGE_JSON.name, {
      fetchImpl:options.updateFetch,
      timeoutMs:options.updateTimeoutMs,
    }));
  output.write("Checking latest PenEcho version...\n");
  let latest;
  try {
    latest = await checker();
    if (compareVersions(latest, PACKAGE_JSON.version) <= 0) {
      output.write(`PenEcho v${PACKAGE_JSON.version} is the latest version.\n`);
      return { checked:true, latest, restarted:false };
    }
  } catch (error) {
    output.write(`Latest PenEcho version check unavailable (${updateCheckErrorMessage(error)}); continuing with the running service.\n`);
    return { checked:false, restarted:false };
  }

  output.write(`A newer PenEcho version is available: v${latest} (current v${PACKAGE_JSON.version}).\n`);
  if (!await confirmUpdate("Update PenEcho now?", options)) {
    output.write(`Continuing with PenEcho v${PACKAGE_JSON.version}.\n`);
    return { checked:true, latest, restarted:false };
  }

  output.write(`Updating PenEcho to v${latest}...\n`);
  const installer = options.updateInstaller || (version => runNpmGlobalUpdate(version, { cwd:options.cwd, env:options.env }));
  let installed = false;
  try {
    installed = Boolean(await installer(latest));
  } catch (error) {
    errorOutput.write(`PenEcho update failed: ${error.message}\n`);
  }
  if (!installed) {
    errorOutput.write(`Continuing with v${PACKAGE_JSON.version}. You can update manually with \`npm install --global ${PACKAGE_JSON.name}@latest\`.\n`);
    return { checked:true, latest, restarted:false };
  }

  output.write(`PenEcho v${latest} installed successfully.\n`);
  try {
    if (typeof options.updateFinalizer === "function") await options.updateFinalizer();
  } catch (error) {
    errorOutput.write(`PenEcho was updated, but the current service could not stop: ${error.message}\nStop it manually, then run \`penecho\` to start v${latest}.\n`);
    return { checked:true, latest, updated:true, restarted:false, exitCode:1 };
  }
  output.write(`Update complete. Run \`penecho\` again to start v${latest}.\n`);
  return { checked:true, latest, updated:true, restarted:false };
}

module.exports = {
  UPDATE_CHECK_TIMEOUT_MS,
  compareVersions,
  fetchLatestNpmVersion,
  maybeUpdateOnStart,
  runNpmGlobalUpdate,
  updateCheckAllowed,
};
