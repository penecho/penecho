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
  onShowConnections:listener => {
    if (typeof listener !== "function") return () => {};
    const handler = () => listener();
    ipcRenderer.on("penecho:show-connections", handler);
    return () => ipcRenderer.removeListener("penecho:show-connections", handler);
  },
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
  const link = element("link");
  link.rel = "stylesheet";
  link.href = "/desktop-update.css";
  document.head.append(link);

  const prompt = element("aside", "desktop-update-prompt");
  prompt.id = "desktopUpdatePrompt";
  prompt.setAttribute("role", "status");
  prompt.setAttribute("aria-live", "polite");
  prompt.setAttribute("data-pe-surface", "toast");
  prompt.setAttribute("data-pe-size", "s");
  prompt.setAttribute("data-pe-layout", "single");
  prompt.setAttribute("data-pe-presentation", "anchored");
  prompt.setAttribute("data-pe-material", "opaque");
  prompt.hidden = true;

  const row = element("div", "desktop-update-row"),
    title = element("strong", "desktop-update-title"),
    actions = element("div", "desktop-update-actions"),
    primaryButton = element("button", "desktop-update-primary"),
    closeButton = element("button", "desktop-update-close");

  primaryButton.type = closeButton.type = "button";
  primaryButton.setAttribute("data-pe-button", "primary");
  primaryButton.setAttribute("data-pe-density", "compact");
  closeButton.setAttribute("data-pe-button", "icon");
  closeButton.setAttribute("data-pe-density", "compact");
  closeButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
  actions.append(primaryButton, closeButton);
  row.append(title, actions);
  prompt.append(row);
  const footer = document.querySelector("main > footer");
  (footer || document.body).append(prompt);

  let currentState = null, language = "en";
  const translations = Object.freeze({
    en:{
      dismiss:"Dismiss update notification until next launch",
      newVersion:version => `Update available${version}`,
      download:"Download",
      downloading:progressValue => progressValue === null ? "Downloading update…" : `Downloading update · ${progressValue}%`,
      ready:version => `Update${version} downloaded`,
      install:"Install",
      installing:"Installing update…",
      checking:"Checking for updates…",
      current:version => `PenEcho v${version} is up to date`,
      failed:"Update failed",
      tryLater:"Try again later.",
      retry:"Retry",
    },
    zh:{
      dismiss:"本次启动不再提示更新",
      newVersion:version => `有新版本${version}`,
      download:"下载",
      downloading:progressValue => progressValue === null ? "正在下载…" : `正在下载 · ${progressValue}%`,
      ready:version => `更新${version}已下载`,
      install:"安装",
      installing:"正在安装…",
      checking:"正在检查更新…",
      current:version => `PenEcho v${version} 已是最新版本`,
      failed:"更新失败",
      tryLater:"请稍后重试。",
      retry:"重试",
    },
  });

  function detectLanguage(event) {
    const requested = event?.detail?.language || localStorage.getItem("penecho-language") || document.documentElement.lang;
    return String(requested || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  }
  function setLanguage(event) {
    language = detectLanguage(event);
    const words = translations[language];
    closeButton.setAttribute("aria-label", words.dismiss);
    closeButton.title = words.dismiss;
    if (currentState) render(currentState);
  }
  closeButton.addEventListener("click", () => void updateApi.dismiss());
  primaryButton.addEventListener("click", () => {
    if (currentState?.status === "available") void updateApi.download();
    else if (currentState?.status === "ready") void updateApi.install();
    else if (currentState?.status === "error") void (currentState.ready ? updateApi.install() : updateApi.check());
  });

  function render(state) {
    currentState = state;
    const visible = Boolean(state?.visible);
    prompt.hidden = !visible;
    footer?.classList.toggle("penecho-desktop-update-visible", visible);
    if (!visible) return;

    const words = translations[language], version = state.version ? ` v${state.version}` : "";
    prompt.setAttribute("data-pe-state", state.status === "ready" ? "success" : ["checking", "downloading", "installing"].includes(state.status) ? "busy" : state.status === "error" ? "error" : "default");
    primaryButton.hidden = false;
    closeButton.hidden = state.status === "installing";
    prompt.title = "";
    title.removeAttribute("aria-label");

    if (state.status === "available") {
      title.textContent = words.newVersion(version);
      primaryButton.textContent = words.download;
    } else if (state.status === "downloading") {
      title.textContent = words.downloading(state.progress === null ? null : Math.round(state.progress));
      primaryButton.hidden = true;
    } else if (state.status === "ready") {
      title.textContent = words.ready(version);
      primaryButton.textContent = words.install;
    } else if (state.status === "installing") {
      title.textContent = words.installing;
      primaryButton.hidden = true;
    } else if (state.status === "checking") {
      title.textContent = words.checking;
      primaryButton.hidden = true;
    } else if (state.status === "up-to-date") {
      title.textContent = words.current(state.currentVersion);
      primaryButton.hidden = true;
    } else {
      title.textContent = words.failed;
      prompt.title = state.error || words.tryLater;
      title.setAttribute("aria-label", `${words.failed}. ${state.error || words.tryLater}`);
      primaryButton.textContent = words.retry;
    }
    primaryButton.title = primaryButton.textContent;
  }

  setLanguage();
  window.addEventListener("penecho:languagechange", setLanguage);
  updateApi.onStateChange(render);
  void updateApi.getState().then(render);
}

window.addEventListener("DOMContentLoaded", installDesktopUpdatePrompt, { once:true });
