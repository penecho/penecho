"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const CHANNEL = "penecho:update-state";

function invoke(channel) {
  return ipcRenderer.invoke(channel);
}

const updateApi = Object.freeze({
  getState:() => invoke("penecho:get-update-state"),
  check:() => invoke("penecho:update-check"),
  download:() => invoke("penecho:update-download"),
  dismiss:() => invoke("penecho:update-dismiss"),
  install:() => invoke("penecho:update-install"),
  onStateChange:listener => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on(CHANNEL, handler);
    return () => ipcRenderer.removeListener(CHANNEL, handler);
  },
});

contextBridge.exposeInMainWorld("penechoDesktopUpdate", updateApi);
contextBridge.exposeInMainWorld("penechoDesktop", Object.freeze({
  installCli:provider => ipcRenderer.invoke("penecho:install-cli", provider),
}));

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function installWindowsBanner() {
  if (process.platform !== "win32" || !document.body) return;
  const link = element("link");
  link.rel = "stylesheet";
  link.href = "/desktop-update.css";
  document.head.append(link);

  const banner = element("aside", "desktop-update-banner");
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.hidden = true;

  const row = element("div", "desktop-update-row"),
    copy = element("div", "desktop-update-copy"),
    title = element("strong", "desktop-update-title"),
    detail = element("span", "desktop-update-detail"),
    progress = element("progress", "desktop-update-progress"),
    actions = element("div", "desktop-update-actions"),
    notesButton = element("button", "desktop-update-secondary", "What's new"),
    primaryButton = element("button", "desktop-update-primary"),
    closeButton = element("button", "desktop-update-close", "\u00d7"),
    notes = element("div", "desktop-update-notes");

  progress.hidden = true;
  notes.hidden = true;
  notesButton.type = primaryButton.type = closeButton.type = "button";
  notesButton.setAttribute("aria-expanded", "false");
  closeButton.setAttribute("aria-label", "Dismiss update notification until next launch");
  closeButton.title = "Dismiss until next launch";
  copy.append(title, detail, progress);
  actions.append(notesButton, primaryButton, closeButton);
  row.append(copy, actions);
  banner.append(row, notes);
  document.body.prepend(banner);

  let currentState = null;
  function toggleNotes(force) {
    const expanded = force ?? notes.hidden;
    notes.hidden = !expanded;
    notesButton.setAttribute("aria-expanded", String(expanded));
  }
  notesButton.addEventListener("click", () => toggleNotes());
  closeButton.addEventListener("click", () => void updateApi.dismiss());
  primaryButton.addEventListener("click", () => {
    if (currentState?.status === "available") void updateApi.download();
    else if (currentState?.status === "ready") void updateApi.install();
    else if (currentState?.status === "error") void (currentState.ready ? updateApi.install() : updateApi.check());
  });

  function render(state) {
    currentState = state;
    const visible = Boolean(state?.visible);
    banner.hidden = !visible;
    document.body.classList.toggle("penecho-desktop-update-visible", visible);
    if (!visible) return;

    const version = state.version ? ` v${state.version}` : "";
    notes.textContent = state.notes || "Bug fixes and improvements.";
    notesButton.hidden = !state.notes || !["available", "ready"].includes(state.status);
    primaryButton.hidden = false;
    closeButton.hidden = state.status === "downloading";
    detail.textContent = "";
    progress.hidden = true;

    if (state.status === "available") {
      title.textContent = `PenEcho${version} is available`;
      detail.textContent = `Current version: v${state.currentVersion}`;
      primaryButton.textContent = "Upgrade";
    } else if (state.status === "downloading") {
      title.textContent = `Downloading PenEcho${version}...`;
      detail.textContent = state.progress === null ? "You can keep working." : `${Math.round(state.progress)}% downloaded`;
      progress.hidden = false;
      if (state.progress === null) progress.removeAttribute("value");
      else progress.value = state.progress;
      progress.max = 100;
      primaryButton.hidden = true;
      toggleNotes(false);
    } else if (state.status === "ready") {
      title.textContent = `PenEcho${version} is ready`;
      detail.textContent = "Install the downloaded update and restart PenEcho.";
      primaryButton.textContent = "Install";
    } else if (state.status === "installing") {
      title.textContent = `Installing PenEcho${version}...`;
      detail.textContent = "PenEcho will restart when installation finishes.";
      primaryButton.hidden = true;
      closeButton.hidden = true;
    } else if (state.status === "checking") {
      title.textContent = "Checking for PenEcho updates...";
      primaryButton.hidden = true;
      notesButton.hidden = true;
    } else if (state.status === "up-to-date") {
      title.textContent = `PenEcho v${state.currentVersion} is up to date`;
      primaryButton.hidden = true;
      notesButton.hidden = true;
    } else {
      title.textContent = "PenEcho update failed";
      detail.textContent = state.error || "Try again later.";
      primaryButton.textContent = state.ready ? "Retry install" : "Retry";
      notesButton.hidden = true;
    }
  }

  updateApi.onStateChange(render);
  void updateApi.getState().then(render);
}

window.addEventListener("DOMContentLoaded", installWindowsBanner, { once:true });
