"use strict";

const INITIAL_SHOW_MS = 5000, INITIAL_LOAD_MS = 30000;

// Initial display is independent of Chromium's first-paint notification. Once
// shown, every pending automatic reveal is retired, including gate waiters.
function createInitialWindowVisibility({ window, app, gate, isQuitting = () => false, onEvent = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let done = false, pending = false, timer, resolveShown;
  const whenShown = new Promise(resolve => { resolveShown = resolve; });
  function cancel(reason) {
    if (done) return;
    done = true;
    clearTimer(timer);
    window.removeListener("ready-to-show", ready);
    window.webContents.removeListener("did-finish-load", loaded);
    window.removeListener("show", shown);
    window.removeListener("closed", closed);
    app.removeListener("before-quit", quitting);
    resolveShown(reason === "shown");
    onEvent("initial-show-complete", { reason });
  }
  async function request(trigger) {
    if (done || pending) return;
    pending = true;
    onEvent("initial-show-requested", { trigger });
    try {
      await gate;
      if (done || window.isDestroyed() || isQuitting()) return cancel("cancelled-before-show");
      // No additional await between this guard and show: another show followed
      // by user minimization must never be undone by an earlier request.
      window.show();
    } catch (error) {
      onEvent("initial-show-error", { code:error.code || "SHOW_FAILED" });
      cancel("error");
    }
  }
  const ready = () => { onEvent("ready-to-show"); void request("ready-to-show"); },
    loaded = () => { onEvent("first-load-finished"); void request("did-finish-load"); },
    shown = () => { onEvent("window-shown"); cancel("shown"); },
    closed = () => cancel("closed"), quitting = () => cancel("quitting");
  window.once("ready-to-show", ready);
  window.webContents.once("did-finish-load", loaded);
  window.once("show", shown);
  window.once("closed", closed);
  app.once("before-quit", quitting);
  timer = setTimer(() => void request("timeout"), INITIAL_SHOW_MS);
  Promise.resolve(gate).then(() => onEvent("installer-gate-complete"), () => {});
  return { cancel, whenShown };
}

// Only the initial page (and user-requested retries) is watched. Feedback never
// restores a window the user minimized, and stale dialogs cannot reload it.
function watchInitialWindowLoad({ window, app, gate, load, showDialog, isQuitting = () => false, onEvent = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let done = false, attempt = 0, timer, feedback = null, busy = false, controller = null;
  const alive = () => !done && !window.isDestroyed() && !isQuitting();
  function dispose() {
    if (done) return;
    done = true;
    clearTimer(timer);
    controller?.abort();
    window.removeListener("ready-to-show", ready);
    window.webContents.removeListener("did-finish-load", loaded);
    window.webContents.removeListener("did-fail-load", failed);
    window.removeListener("show", flush);
    window.removeListener("restore", flush);
    window.removeListener("closed", dispose);
    app.removeListener("before-quit", dispose);
  }
  async function flush() {
    if (!alive() || !feedback || busy) return;
    const current = feedback;
    busy = true;
    try {
      await gate;
      if (!alive() || current.attempt !== attempt || feedback !== current) return;
      if (!window.isVisible() || window.isMinimized()) return;
      controller = new AbortController();
      const { response } = await showDialog(current.kind, controller.signal);
      if (!alive() || current.attempt !== attempt || feedback !== current) return;
      feedback = null;
      if ((current.kind === "failed" && response === 0) || (current.kind === "slow" && response === 1)) start();
      else if (current.kind === "failed" && response === 1) window.close();
    } catch (error) {
      if (alive() && error.name !== "AbortError") onEvent("startup-dialog-error", { code:error.code || "DIALOG_FAILED" });
    } finally {
      controller = null;
      busy = false;
      // A load failure can supersede a slow-load message while it is open.
      if (alive() && feedback && feedback !== current) void flush();
    }
  }
  function report(kind, code, forAttempt = attempt) {
    if (!alive() || forAttempt !== attempt || (feedback && (feedback.kind === "failed" || feedback.kind === kind))) return;
    clearTimer(timer);
    controller?.abort();
    feedback = { kind, attempt, code };
    onEvent(kind === "failed" ? "first-load-failed" : "first-load-slow", { code });
    void flush();
  }
  function start() {
    if (!alive()) return;
    const current = ++attempt;
    feedback = null;
    controller?.abort();
    clearTimer(timer);
    onEvent("first-load-started", { attempt });
    timer = setTimer(() => report("slow", "LOAD_TIMEOUT", current), INITIAL_LOAD_MS);
    try {
      Promise.resolve(load()).catch(error => {
        if (error.code !== "ERR_ABORTED" && error.errno !== -3) report("failed", error.code || "LOAD_FAILED", current);
      });
    } catch (error) { report("failed", error.code || "LOAD_FAILED", current); }
  }
  function ready() {
    clearTimer(timer);
    if (feedback?.kind === "slow") { feedback = null; controller?.abort(); }
  }
  function loaded() { onEvent("initial-page-loaded"); dispose(); }
  function failed(_event, code, _description, _url, isMainFrame) {
    if (isMainFrame && code !== -3) report("failed", code);
  }
  window.on("ready-to-show", ready);
  window.webContents.once("did-finish-load", loaded);
  window.webContents.on("did-fail-load", failed);
  window.on("show", flush);
  window.on("restore", flush);
  window.once("closed", dispose);
  app.once("before-quit", dispose);
  return { start, dispose };
}

module.exports = { createInitialWindowVisibility, watchInitialWindowLoad, INITIAL_SHOW_MS, INITIAL_LOAD_MS };
