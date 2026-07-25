"use strict";

const UPDATE_OWNER = "penecho";
const UPDATE_REPOSITORY = "penecho";
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 20 * 1000;

function updateFeedUrl(options = {}) {
  const platform = options.platform || process.platform,
    arch = options.arch || process.arch,
    version = String(options.version || "").trim();
  if (!version || !["darwin", "win32"].includes(platform) || !["arm64", "x64"].includes(arch)) return null;
  return `https://update.electronjs.org/${UPDATE_OWNER}/${UPDATE_REPOSITORY}/${platform}-${arch}/${encodeURIComponent(version)}`;
}

function createUpdateManager(options) {
  const { app, autoUpdater, dialog } = options,
    logger = options.logger || console,
    feedUrl = updateFeedUrl({ platform:options.platform, arch:options.arch, version:app.getVersion() });
  let configured = false, checking = false, manualCheck = false, firstTimer = null, intervalTimer = null;

  async function message(settings) {
    try { return await dialog.showMessageBox(settings); } catch { return { response:settings.cancelId ?? 0 }; }
  }

  function configure() {
    if (configured || !feedUrl || !app.isPackaged || process.env.PENECHO_DISABLE_AUTO_UPDATE === "1") return false;
    configured = true;
    autoUpdater.setFeedURL({ url:feedUrl });
    autoUpdater.on("checking-for-update", () => { checking = true; });
    autoUpdater.on("update-available", () => {
      if (!manualCheck) return;
      void message({
        type:"info", title:"PenEcho update found", message:"A new PenEcho version is downloading.",
        detail:"You can keep working. PenEcho will tell you when the update is ready.", buttons:["OK"], defaultId:0,
      });
    });
    autoUpdater.on("update-not-available", () => {
      checking = false;
      if (!manualCheck) return;
      manualCheck = false;
      void message({ type:"info", title:"PenEcho is up to date", message:`You are using the latest PenEcho version (${app.getVersion()}).`, buttons:["OK"], defaultId:0 });
    });
    autoUpdater.on("error", error => {
      checking = false;
      logger.warn?.(`PenEcho update check failed: ${error.message || error}`);
      if (!manualCheck) return;
      manualCheck = false;
      void message({
        type:"warning", title:"Update check unavailable", message:"PenEcho could not check GitHub Releases right now.",
        detail:"Your current version will keep working. Try again later from the PenEcho menu.", buttons:["OK"], defaultId:0,
      });
    });
    autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
      checking = false;
      manualCheck = false;
      void message({
        type:"info", title:"PenEcho update ready", message:`${releaseName || "A new PenEcho version"} is ready to install.`,
        detail:typeof releaseNotes === "string" && releaseNotes.trim() ? releaseNotes.slice(0, 1200) : "Restart PenEcho to finish the update. Your local settings and canvases are preserved.",
        buttons:["Restart and install", "Later"], defaultId:0, cancelId:1,
      }).then(result => { if (result.response === 0) autoUpdater.quitAndInstall(); });
    });
    return true;
  }

  async function check(manual = false) {
    if (!configure()) {
      if (manual) await message({
        type:"info", title:"Updates in packaged releases", message:"Automatic updates are available in signed macOS and installed Windows releases.",
        detail:"Development and unsigned test builds do not install updates automatically.", buttons:["OK"], defaultId:0,
      });
      return false;
    }
    if (checking) {
      if (manual) await message({ type:"info", title:"Checking for updates", message:"PenEcho is already checking GitHub Releases.", buttons:["OK"], defaultId:0 });
      return false;
    }
    manualCheck = manualCheck || manual;
    try {
      await autoUpdater.checkForUpdates();
      return true;
    } catch (error) {
      checking = false;
      logger.warn?.(`PenEcho update check failed: ${error.message || error}`);
      if (manualCheck) {
        manualCheck = false;
        await message({ type:"warning", title:"Update check unavailable", message:"PenEcho could not check GitHub Releases right now.", detail:"Try again later from the PenEcho menu.", buttons:["OK"], defaultId:0 });
      }
      return false;
    }
  }

  function start() {
    if (!configure()) return false;
    firstTimer = setTimeout(() => void check(false), FIRST_CHECK_DELAY_MS);
    intervalTimer = setInterval(() => void check(false), UPDATE_INTERVAL_MS);
    firstTimer.unref?.();
    intervalTimer.unref?.();
    return true;
  }

  function stop() {
    if (firstTimer) clearTimeout(firstTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    firstTimer = null;
    intervalTimer = null;
  }

  return { check, feedUrl, start, stop };
}

module.exports = { createUpdateManager, updateFeedUrl };
