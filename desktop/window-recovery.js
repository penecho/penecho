"use strict";

// PenEcho kept running with no window, or with a window whose page process had died, and opening it again did nothing (PE-571).
// Opening it again now always shows a working window, and a page whose process dies is loaded again, a few times a minute at most.
const RELOADS_MOST = 3, RELOADS_WITHIN_MS = 60_000;

function createWindowRecovery({ getWindow, openWindow, reveal, now = Date.now, most = RELOADS_MOST, withinMs = RELOADS_WITHIN_MS }) {
  const reloads = [];
  return {
    // A second launch: the window comes back, made again if it is gone, its page loaded again if its process died.
    reopen() {
      const window = getWindow();
      if (!window || window.isDestroyed()) return openWindow();
      if (window.webContents.isCrashed?.()) window.webContents.reload();
      if (window.isMinimized()) window.restore();
      reveal(window);
      return window;
    },
    // The page's process ended: anything but PenEcho closing it is loaded again, unless it keeps dying.
    pageGone(window, details = {}) {
      if (!window || window.isDestroyed() || details.reason === "clean-exit") return false;
      const at = now();
      while (reloads.length && at - reloads[0] > withinMs) reloads.shift();
      if (reloads.length >= most) return false;
      reloads.push(at);
      window.webContents.reload();
      return true;
    },
  };
}

// On Windows and Linux PenEcho ends with its window. Hidden helper windows (page pictures, a closed update window) do not keep it running unseen.
const keepsRunning = (windows, isHelper) => windows.some(window => !window.isDestroyed() && !isHelper(window) && window.isVisible());

module.exports = { createWindowRecovery, keepsRunning, RELOADS_MOST, RELOADS_WITHIN_MS };
