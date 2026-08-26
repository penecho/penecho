"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const UPDATE_OWNER = "penecho";
const UPDATE_REPOSITORY = "penecho";
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 20 * 1000;
const RELEASE_REQUEST_TIMEOUT_MS = 15 * 1000;
const RELEASE_API_URL = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPOSITORY}/releases/latest`;

function parsedVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return { numbers:match.slice(1, 4).map(Number), prerelease:Boolean(match[4]) };
}

function compareVersions(left, right) {
  const a = parsedVersion(left), b = parsedVersion(right);
  if (!a || !b) throw new Error("The release service returned an invalid PenEcho version.");
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  return a.prerelease ? -1 : 1;
}

function releaseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : "";
}

function expectedAssetName(platform, arch, version) {
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) return `PenEcho-${version}-mac-${arch}.zip`;
  if (platform === "win32" && ["arm64", "x64"].includes(arch)) return `PenEcho-Setup-${version}-win-${arch}.exe`;
  return "";
}

function releaseAsset(release, platform = process.platform, arch = process.arch) {
  const expected = expectedAssetName(platform, arch, release?.version);
  if (!expected) return null;
  const asset = release?.assets?.find(candidate => candidate.name === expected);
  if (!asset || !asset.url) return null;
  let url;
  try { url = new URL(asset.url); } catch { return null; }
  const expectedPath = `/${UPDATE_OWNER}/${UPDATE_REPOSITORY}/releases/download/`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(expectedPath)) return null;
  return asset;
}

function responseHeader(response, name) {
  return response?.headers && typeof response.headers.get === "function" ? response.headers.get(name) : "";
}

async function downloadReleaseAsset(options) {
  const { asset, destination, fetchImpl, signal } = options,
    partial = `${destination}.${process.pid}.download`,
    expectedDigest = String(asset.digest || "").match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase() || "",
    hash = crypto.createHash("sha256");
  await fs.promises.mkdir(path.dirname(destination), { recursive:true });
  await fs.promises.rm(partial, { force:true });
  const response = await fetchImpl(asset.url, {
    headers:{ "User-Agent":options.userAgent, Accept:"application/octet-stream" },
    redirect:"follow",
    signal,
  });
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status} for ${asset.name}.`);
  const headerSize = Number(responseHeader(response, "content-length")),
    total = Number.isFinite(headerSize) && headerSize > 0 ? headerSize : Number(asset.size) || 0,
    file = await fs.promises.open(partial, "w", 0o600);
  let received = 0;
  try {
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        await file.write(chunk);
        hash.update(chunk);
        received += chunk.length;
        options.onProgress(total > 0 ? Math.min(100, received / total * 100) : null);
      }
    } else {
      const chunk = Buffer.from(await response.arrayBuffer());
      await file.write(chunk);
      hash.update(chunk);
      received = chunk.length;
      options.onProgress(100);
    }
  } catch (error) {
    await file.close().catch(() => {});
    await fs.promises.rm(partial, { force:true }).catch(() => {});
    throw error;
  }
  await file.close();
  if (!received) {
    await fs.promises.rm(partial, { force:true });
    throw new Error("The downloaded update is empty.");
  }
  const digest = hash.digest("hex");
  if (expectedDigest && digest !== expectedDigest) {
    await fs.promises.rm(partial, { force:true });
    throw new Error("The downloaded update did not match its GitHub SHA-256 digest.");
  }
  await fs.promises.rm(destination, { force:true });
  await fs.promises.rename(partial, destination);
  return destination;
}

function macBundlePath(executable) {
  const marker = `.app${path.sep}Contents${path.sep}MacOS${path.sep}`,
    index = String(executable || "").lastIndexOf(marker);
  return index < 0 ? "" : String(executable).slice(0, index + 4);
}

function runFile(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding:"utf8", maxBuffer:1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}${stderr ? `: ${String(stderr).trim()}` : ""}`;
        reject(error);
      } else resolve(String(stdout || "").trim());
    });
  });
}

function macInstallerScript() {
  return `#!/bin/sh
set -eu
target=$1
candidate=$2
old_pid=$3
staging=$4
archive=$5
backup=$6

attempt=0
while /bin/kill -0 "$old_pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 120 ]; then exit 1; fi
  /bin/sleep 1
done

if [ ! -d "$candidate" ] || [ ! -d "$target" ]; then exit 1; fi
/bin/mv "$target" "$backup"
if /bin/mv "$candidate" "$target"; then
  /usr/bin/open "$target" >/dev/null 2>&1 || true
  /bin/rm -rf "$backup" "$staging"
  /bin/rm -f "$archive" "$0"
  exit 0
fi

if [ -d "$backup" ] && [ ! -e "$target" ]; then /bin/mv "$backup" "$target"; fi
exit 1
`;
}

async function installMacUpdate(options) {
  const target = macBundlePath(options.app.getPath("exe"));
  if (!target || path.basename(target) !== "PenEcho.app") throw new Error("PenEcho must be run from an installed PenEcho.app before it can update itself.");
  await fs.promises.access(path.dirname(target), fs.constants.W_OK);
  const directory = path.dirname(options.downloadedPath),
    token = `${Date.now()}-${process.pid}`,
    staging = path.join(directory, `install-${token}`),
    candidate = path.join(staging, "PenEcho.app"),
    helper = path.join(directory, `install-${token}.sh`),
    backup = `${target}.penecho-backup-${token}`,
    runCommand = options.runCommand || runFile;
  await fs.promises.mkdir(staging, { recursive:true });
  try {
    await runCommand("/usr/bin/ditto", ["-x", "-k", options.downloadedPath, staging]);
    const info = path.join(candidate, "Contents", "Info.plist"),
      identifier = await runCommand("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", info]),
      version = await runCommand("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", info]);
    if (identifier !== "app.penecho.desktop") throw new Error("The update archive is not a PenEcho desktop application.");
    if (version !== options.version) throw new Error(`The update archive contains v${version || "unknown"} instead of v${options.version}.`);
    await fs.promises.writeFile(helper, macInstallerScript(), { encoding:"utf8", mode:0o700 });
    const child = (options.spawnImpl || spawn)("/bin/sh", [
      helper, target, candidate, String(process.pid), staging, options.downloadedPath, backup,
    ], { detached:true, stdio:"ignore" });
    child.unref?.();
    options.app.quit();
    return true;
  } catch (error) {
    await fs.promises.rm(staging, { recursive:true, force:true }).catch(() => {});
    await fs.promises.rm(helper, { force:true }).catch(() => {});
    throw error;
  }
}

async function installWindowsUpdate(options) {
  const child = (options.spawnImpl || spawn)(options.downloadedPath, ["--silent"], {
    detached:true,
    stdio:"ignore",
    windowsHide:true,
  });
  child.unref?.();
  options.app.quit();
  return true;
}

async function installDownloadedUpdate(options) {
  if (options.platform === "darwin") return installMacUpdate(options);
  if (options.platform === "win32") return installWindowsUpdate(options);
  throw new Error("This operating system does not support desktop updates.");
}

function createUpdateManager(options) {
  const { app } = options,
    logger = options.logger || console,
    fetchImpl = options.fetchImpl || globalThis.fetch,
    onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {},
    platform = options.platform || process.platform,
    arch = options.arch || process.arch,
    currentVersion = String(options.currentVersion || app.getVersion()),
    supported = Boolean(expectedAssetName(platform, arch, currentVersion)),
    updateDirectory = options.updateDirectory || path.join(app.getPath?.("temp") || os.tmpdir(), "penecho-updates");
  let checkingMetadata = false,
    downloadActive = false,
    downloadReady = false,
    dismissed = false,
    firstTimer = null,
    intervalTimer = null,
    downloadController = null,
    downloadedPath = "",
    release = null,
    state = Object.freeze({
      status:"idle", visible:false, currentVersion, version:"", title:"", notes:"",
      publishedAt:"", releaseUrl:"", progress:null, error:"", ready:false,
    });

  function getState() {
    return { ...state };
  }

  function publish(status, updates = {}) {
    state = Object.freeze({
      ...state,
      status,
      progress:null,
      error:"",
      ...updates,
      ready:downloadReady,
    });
    try { onStateChange(getState()); } catch (error) { logger.warn?.(`PenEcho update UI failed: ${error.message || error}`); }
    return getState();
  }

  async function fetchLatestRelease() {
    if (typeof fetchImpl !== "function") throw new Error("No network client is available for the update check.");
    const controller = new AbortController(),
      timeoutMs = Number(options.requestTimeoutMs) || RELEASE_REQUEST_TIMEOUT_MS,
      timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetchImpl(RELEASE_API_URL, {
        headers:{
          Accept:"application/vnd.github+json",
          "User-Agent":`PenEcho/${currentVersion}`,
          "X-GitHub-Api-Version":"2022-11-28",
        },
        redirect:"follow",
        signal:controller.signal,
      });
      if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}.`);
      const value = await response.json(),
        version = releaseVersion(value?.tag_name || value?.name);
      if (!version) throw new Error("GitHub Releases returned an invalid version.");
      return {
        version,
        title:String(value?.name || `PenEcho ${version}`).trim().slice(0, 200),
        notes:String(value?.body || "").trim().slice(0, 8000),
        publishedAt:String(value?.published_at || "").trim(),
        releaseUrl:String(value?.html_url || "").trim(),
        assets:Array.isArray(value?.assets) ? value.assets.map(asset => ({
          name:String(asset?.name || ""),
          url:String(asset?.browser_download_url || ""),
          size:Number(asset?.size) || 0,
          digest:String(asset?.digest || ""),
        })) : [],
      };
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`The update check timed out after ${timeoutMs} ms.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function check(manual = false) {
    if (downloadReady) {
      dismissed = false;
      publish("ready", { visible:true, progress:100 });
      return true;
    }
    if (checkingMetadata || downloadActive || dismissed && !manual) return false;
    if (!supported || process.env.PENECHO_DISABLE_AUTO_UPDATE === "1") {
      if (manual) publish("error", {
        visible:true,
        error:"Automatic updates currently support macOS and Windows on arm64 or x64.",
      });
      return false;
    }
    dismissed = false;
    checkingMetadata = true;
    publish("checking", { visible:Boolean(manual) });
    try {
      const latest = await fetchLatestRelease();
      release = latest;
      if (compareVersions(latest.version, currentVersion) <= 0) {
        publish("up-to-date", {
          visible:Boolean(manual), version:latest.version, title:latest.title, notes:latest.notes,
          publishedAt:latest.publishedAt, releaseUrl:latest.releaseUrl,
        });
        return true;
      }
      const asset = releaseAsset(latest, platform, arch);
      if (!asset) throw new Error(`PenEcho v${latest.version} does not include ${expectedAssetName(platform, arch, latest.version) || "a compatible installer"}.`);
      publish("available", {
        visible:true, version:latest.version, title:latest.title, notes:latest.notes,
        publishedAt:latest.publishedAt, releaseUrl:latest.releaseUrl,
      });
      return true;
    } catch (error) {
      logger.warn?.(`PenEcho update check failed: ${error.message || error}`);
      publish("error", {
        visible:Boolean(manual),
        error:`PenEcho could not check GitHub Releases. ${String(error?.message || error || "").trim()}`.trim().slice(0, 500),
      });
      return false;
    } finally {
      checkingMetadata = false;
    }
  }

  async function download() {
    if (downloadReady) {
      dismissed = false;
      publish("ready", { visible:true, progress:100 });
      return true;
    }
    if (state.status !== "available" || downloadActive) return false;
    const asset = releaseAsset(release, platform, arch);
    if (!asset) {
      publish("error", { visible:true, error:"The release does not include a compatible PenEcho installer." });
      return false;
    }
    dismissed = false;
    downloadActive = true;
    downloadController = new AbortController();
    publish("downloading", { visible:true });
    let lastProgress = -1;
    try {
      const destination = path.join(updateDirectory, asset.name),
        downloader = options.downloadImpl || downloadReleaseAsset;
      downloadedPath = await downloader({
        asset,
        destination,
        fetchImpl,
        signal:downloadController.signal,
        userAgent:`PenEcho/${currentVersion}`,
        onProgress:progress => {
          const rounded = progress === null ? null : Math.floor(progress);
          if (rounded === lastProgress) return;
          lastProgress = rounded;
          publish("downloading", { visible:true, progress });
        },
      });
      downloadActive = false;
      downloadController = null;
      downloadReady = true;
      publish("ready", { visible:true, progress:100 });
      return true;
    } catch (error) {
      downloadActive = false;
      downloadController = null;
      logger.warn?.(`PenEcho update download failed: ${error.message || error}`);
      publish("error", {
        visible:true,
        error:`The update could not be downloaded. ${String(error?.message || error || "").trim()}`.trim().slice(0, 500),
      });
      return false;
    }
  }

  function dismiss() {
    if (state.status === "downloading" || state.status === "installing") return false;
    dismissed = true;
    publish("dismissed", { visible:false });
    return true;
  }

  async function install() {
    if (!downloadReady || !downloadedPath || !release) return false;
    publish("installing", { visible:true, progress:100 });
    try {
      const installer = options.installImpl || installDownloadedUpdate;
      await installer({
        app,
        platform,
        arch,
        version:release.version,
        downloadedPath,
        runCommand:options.runCommand,
        spawnImpl:options.spawnImpl,
      });
      return true;
    } catch (error) {
      logger.warn?.(`PenEcho could not install the downloaded update: ${error.message || error}`);
      publish("error", {
        visible:true,
        error:`The downloaded update could not be installed. ${String(error?.message || error || "").trim()}`.trim().slice(0, 500),
      });
      return false;
    }
  }

  function start() {
    if (!supported || process.env.PENECHO_DISABLE_AUTO_UPDATE === "1") return false;
    firstTimer = setTimeout(() => void check(false), FIRST_CHECK_DELAY_MS);
    intervalTimer = setInterval(() => void check(false), UPDATE_INTERVAL_MS);
    firstTimer.unref?.();
    intervalTimer.unref?.();
    return true;
  }

  function stop() {
    if (firstTimer) clearTimeout(firstTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    downloadController?.abort();
    firstTimer = null;
    intervalTimer = null;
  }

  return { check, dismiss, download, getState, install, start, stop };
}

module.exports = {
  RELEASE_API_URL, createUpdateManager, downloadReleaseAsset, expectedAssetName, installDownloadedUpdate, macBundlePath, releaseAsset,
};
