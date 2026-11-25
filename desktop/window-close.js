"use strict";

function closeDialogOptions(language = "en", { kind = "close" } = {}) {
  const leavingPage = kind === "leave";
  if (language === "zh") {
    return {
      type:"question",
      title:leavingPage ? "离开当前页面？" : "关闭 PenEcho？",
      message:"当前有未保存的更改。",
      detail:leavingPage
        ? "离开此页面可能会丢失尚未保存的更改，或者留下来完成保存。"
        : "直接关闭可能会丢失尚未保存的更改，或者留下来完成保存。",
      buttons:[leavingPage ? "离开" : "关闭", "留下"],
      defaultId:0,
      cancelId:1,
      noLink:true,
    };
  }
  return {
    type:"question",
    title:leavingPage ? "Leave this page?" : "Close PenEcho?",
    message:"You have unsaved changes.",
    detail:leavingPage
      ? "Leave anyway and discard unsaved changes, or stay to finish saving."
      : "Close anyway and discard unsaved changes, or stay to finish saving.",
    buttons:[leavingPage ? "Leave" : "Close", "Stay"],
    defaultId:0,
    cancelId:1,
    noLink:true,
  };
}

// Electron silently aborts window closing when any frame (including a kept-alive iframe)
// prevents beforeunload unless webContents handles will-prevent-unload.
function attachWindowCloseGuard({
  window,
  app,
  getLanguage = () => "en",
  isQuitting = () => false,
  resetQuitting = () => {},
  shouldForceUnload = () => false,
  showDialog,
  showDialogSync,
}) {
  let allowUnload = false;
  let closingWindow = false;
  let prompting = false;

  const onClose = () => {
    closingWindow = true;
  };

  const onWillPreventUnload = event => {
    const isWindowClose = closingWindow || Boolean(isQuitting());
    closingWindow = false;

    if (allowUnload || shouldForceUnload()) {
      event.preventDefault();
      return;
    }
    if (!window || window.isDestroyed()) return;

    // Non-close unloads (reload or navigation) must decide synchronously so Chromium keeps the pending navigation.
    if (!isWindowClose) {
      if (typeof showDialogSync === "function") {
        const choice = showDialogSync(closeDialogOptions(getLanguage(), { kind:"leave" }));
        if (choice === 0) event.preventDefault();
      }
      return;
    }

    if (prompting) return;
    const fromQuit = Boolean(isQuitting());
    prompting = true;
    Promise.resolve()
      .then(() => showDialog(closeDialogOptions(getLanguage(), { kind:"close" })))
      .then(result => {
        if (!window || window.isDestroyed()) return;
        if (result?.response === 0) {
          allowUnload = true;
          // Destroy bypasses a second beforeunload cycle after the user explicitly confirmed closing.
          window.destroy();
          if (fromQuit) app.quit();
        } else if (fromQuit) {
          resetQuitting();
        }
      })
      .catch(() => {
        if (fromQuit) resetQuitting();
      })
      .finally(() => {
        prompting = false;
      });
  };

  const dispose = () => {
    try { window?.removeListener?.("close", onClose); } catch {}
    try { window?.webContents?.removeListener?.("will-prevent-unload", onWillPreventUnload); } catch {}
  };

  window.on("close", onClose);
  window.webContents.on("will-prevent-unload", onWillPreventUnload);
  window.once?.("closed", dispose);
  return {
    allowNextUnload() { allowUnload = true; },
    dispose,
  };
}

function destroyHelperWindows(windows, isHelper) {
  for (const window of windows || []) {
    if (!window || window.isDestroyed() || !isHelper(window)) continue;
    try { window.destroy(); } catch {}
  }
}

module.exports = {
  closeDialogOptions,
  attachWindowCloseGuard,
  destroyHelperWindows,
};
