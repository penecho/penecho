"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const CHANNEL = "penecho:update-state";

function invoke(channel) {
  return ipcRenderer.invoke(channel);
}

const updateApi = Object.freeze({
  getState:() => invoke("penecho:get-update-state"),
  check:() => invoke("penecho:update-check"),
  showWindow:() => invoke("penecho:update-show-window"),
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
  onMenuCommand:listener => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, command) => listener(command);
    ipcRenderer.on("penecho:menu-command", handler);
    return () => ipcRenderer.removeListener("penecho:menu-command", handler);
  },
  setMenuState:state => ipcRenderer.send("penecho:menu-state", state),
  nativeEdit:command => ipcRenderer.invoke("penecho:menu-native-edit", command),
  installCli:provider => ipcRenderer.invoke("penecho:install-cli", provider),
  pickProjectFile:() => ipcRenderer.invoke("penecho:pick-project-file"),
  hasClipboardFile:() => ipcRenderer.sendSync("penecho:has-clipboard-file"),
  readClipboardFile:() => ipcRenderer.invoke("penecho:read-clipboard-file"),
  readClipboardFiles:() => ipcRenderer.invoke("penecho:read-clipboard-files"),
  openProjectFile:projectId => ipcRenderer.invoke("penecho:open-project-file", projectId),
  setMcpKeepAwake:enabled => ipcRenderer.invoke("penecho:mcp-keep-awake", enabled === true),
  setPageScale:scale => ipcRenderer.invoke("penecho:set-page-scale", scale),
}));

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function installDesktopUpdatePrompt() {
  if (!["darwin", "win32"].includes(process.platform) || !document.body) return;
  const brand = document.querySelector(".topbar .brand");
  if (!brand) return;
  const link = element("link");
  link.rel = "stylesheet";
  link.href = "/desktop-update.css";
  document.head.append(link);

  const prompt = element("div", "desktop-update-prompt"),
    button = element("button", "desktop-update-button"),
    tooltip = element("span", "desktop-update-tooltip"),
    announcement = element("span", "desktop-update-announcement");
  prompt.id = "desktopUpdatePrompt";
  prompt.hidden = true;
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-describedby", "desktopUpdateTooltip");
  button.innerHTML = '<svg class="desktop-update-icon" viewBox="0 0 24 24" aria-hidden="true"><path/></svg><svg class="desktop-update-ring" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12"/></svg>';
  tooltip.id = "desktopUpdateTooltip";
  tooltip.setAttribute("role", "tooltip");
  announcement.setAttribute("aria-live", "polite");
  prompt.append(button, tooltip, announcement);
  brand.after(prompt);
  const icon = button.querySelector(".desktop-update-icon path"),
    ring = button.querySelector(".desktop-update-ring circle");
  let currentState = null, language = "en", announcedStatus = "";
  const translations = Object.freeze({
    en:{ update:"Update", ready:"Install update", downloading:"Downloading", installing:"Installing update…", checking:"Checking for updates…", error:"Update failed · Try again" },
    zh:{ update:"更新", ready:"安装更新", downloading:"正在下载", installing:"正在安装更新…", checking:"正在检查更新…", error:"更新失败 · 重试" },
  });
  function setLanguage(event) {
    let savedLanguage = "";
    try { savedLanguage = localStorage.getItem("penecho-language") || ""; } catch {}
    const requested = event?.detail?.language || savedLanguage || document.documentElement.lang;
    language = String(requested || "").toLowerCase().startsWith("zh") ? "zh" : "en";
    ipcRenderer.send("penecho:set-language", language);
    if (currentState) render(currentState);
  }
  button.addEventListener("click", () => void updateApi.showWindow());
  button.addEventListener("keydown", event => {
    if (event.key === "Escape") prompt.classList.add("tooltip-dismissed");
  });
  button.addEventListener("blur", () => prompt.classList.remove("tooltip-dismissed"));
  prompt.addEventListener("mouseleave", () => prompt.classList.remove("tooltip-dismissed"));

  function render(state) {
    currentState = state;
    // Opening the update window or failing a metadata check is not evidence of
    // an update. Only the manager can confirm a newer, compatible release.
    const visible = Boolean(state?.updateAvailable &&
      ["available", "checking", "downloading", "ready", "installing", "error"].includes(state.status));
    prompt.hidden = !visible;
    if (!visible) return;
    const words = translations[language],
      ready = state.status === "ready" || state.ready,
      downloading = state.status === "downloading",
      known = typeof state.progress === "number" && Number.isFinite(state.progress),
      percent = known ? Math.max(0, Math.min(100, Math.round(state.progress))) : 0;
    prompt.dataset.state = ready ? "ready" : state.status;
    prompt.dataset.progress = known ? "known" : "unknown";
    icon.setAttribute("d", ready ? "M12 15V5m-4 4 4-4 4 4M5 16v4h14v-4" : "M12 4v10m-4-4 4 4 4-4M5 16v4h14v-4");
    ring.style.strokeDashoffset = String(75.4 * (1 - percent / 100));
    const label = state.status === "error" ? words.error : ready ? words.ready : downloading
      ? words.downloading + (known ? ` · ${percent}%` : "…")
      : words[state.status] || words.update;
    tooltip.textContent = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-expanded", String(Boolean(state.windowOpen)));
    button.disabled = state.status === "installing";
    if (announcedStatus !== state.status) {
      announcement.textContent = label;
      announcedStatus = state.status;
    }
  }
  setLanguage();
  window.addEventListener("penecho:languagechange", setLanguage);
  updateApi.onStateChange(render);
  void updateApi.getState().then(render);
}

window.addEventListener("DOMContentLoaded", installDesktopUpdatePrompt, { once:true });
