"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { compareVersions } = require("../src/cli/update.js");

const REOPEN_READY_MS = 8_000;

// The package keeps npm's version without the dots after the dash: 1.5.0-beta.2 is 1.5.0-beta2.
function packageVersion(version) {
  const [core, ...rest] = String(version || "").split("+")[0].split("-");
  return rest.length ? `${core}-${rest.join("-").replaceAll(".", "")}` : core;
}

function packageName(version) {
  return `penecho-${packageVersion(version)}-full.nupkg`;
}

// Squirrel compares pre-releases as text, so it takes beta10 for older than beta2 and would install nothing.
function packageIsNewer(version, currentVersion) {
  if (compareVersions(version, currentVersion) <= 0) return false;
  const [core, pre] = packageVersion(version).split(/-(.*)/s), [currentCore, currentPre] = packageVersion(currentVersion).split(/-(.*)/s);
  return core !== currentCore || !pre || !currentPre || pre.toLowerCase() > currentPre.toLowerCase();
}

async function sha1(file) {
  const hash = crypto.createHash("sha1");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

// Puts the new version beside the running one, so nothing is closed or removed until it is there, then opens it once PenEcho has closed.
async function installWindowsPackage(options) {
  const exe = options.app.getPath("exe"),
    root = path.dirname(path.dirname(exe)),
    updateExe = path.join(root, "Update.exe"),
    name = path.basename(options.downloadedPath),
    installed = path.join(root, `app-${packageVersion(options.version)}`, path.basename(exe)),
    staging = path.join(path.dirname(options.downloadedPath), `install-${Date.now()}-${process.pid}`),
    staged = path.join(staging, name);
  if (!fs.existsSync(updateExe)) throw new Error("PenEcho must be installed with its Setup before it can update itself.");
  await fs.promises.mkdir(staging, { recursive:true });
  try {
    const { size } = await fs.promises.stat(options.downloadedPath);
    await fs.promises.writeFile(path.join(staging, "RELEASES"), `${await sha1(options.downloadedPath)} ${name} ${size}`);
    await fs.promises.rename(options.downloadedPath, staged);
    await options.runCommand(updateExe, [`--update=${staging}`]);
    if (!fs.existsSync(installed)) throw new Error(`Windows did not install PenEcho v${options.version}.`);
  } catch (error) {
    await fs.promises.rename(staged, options.downloadedPath).catch(() => {});
    throw error;
  } finally {
    await fs.promises.rm(staging, { recursive:true, force:true }).catch(() => {});
  }
  const child = (options.spawnImpl || spawn)(updateExe, ["--processStartAndWait", path.basename(exe)], {
    detached:true,
    stdio:"ignore",
    windowsHide:true,
  });
  child.on?.("error", () => {});
  child.unref?.();
  options.app.quit();
  return true;
}

// PenEcho up to 1.4 updates with Setup --silent from this folder, which never opens what it installed.
// The install event is the new version's first chance to run: it leaves a watcher that opens PenEcho when that Setup is done.
const SILENT_UPDATE_FOLDER = "penecho-updates";
const encoded = script => Buffer.from(script, "utf16le").toString("base64");

function reopenScript(updateExe, exeName) {
  const quoted = value => `'${String(value).replaceAll("'", "''")}'`,
    watch = `$p = Get-Process PenEcho-Setup-* | Where-Object { $_.Path -like '*\\${SILENT_UPDATE_FOLDER}\\*' }
if ($p) { $p | Wait-Process -Timeout 180 }
Start-Process -FilePath ${quoted(updateExe)} -ArgumentList '--processStart',${quoted(exeName)}`;
  // Not Win32_Process, which can take longer than the install event may.
  return `if (Get-Process PenEcho-Setup-* | Where-Object { $_.Path -like '*\\${SILENT_UPDATE_FOLDER}\\*' }) {
  Start-Process -FilePath (Get-Process -Id $PID).Path -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded(watch)}'
}
`;
}

// Calls done once the watcher runs, or is not needed. The first PowerShell ends with this process; the watcher it starts does not.
// Started detached, PowerShell has no console and ends before it runs anything.
function reopenAfterSilentUpdate(options) {
  const timer = setTimeout(() => finished(), options.readyMs || REOPEN_READY_MS),
    finished = () => { clearTimeout(timer); options.done(); };
  try {
    const child = (options.spawnImpl || spawn)(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
      "-NoProfile", "-NonInteractive", "-EncodedCommand",
      encoded(reopenScript(options.updateExe, options.exeName)),
    ], { stdio:"ignore", windowsHide:true });
    child.once("error", finished);
    child.once("exit", finished);
  } catch { finished(); }
}

module.exports = { installWindowsPackage, packageIsNewer, packageName, packageVersion, reopenAfterSilentUpdate };
