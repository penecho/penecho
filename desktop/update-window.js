"use strict";

const api = window.penechoDesktopUpdateWindow;
const statusTitle = document.querySelector("#status-title"),
  statusDetail = document.querySelector("#status-detail"),
  versionLabel = document.querySelector("#update-version"),
  progressRegion = document.querySelector("#progress-region"),
  progressTrack = progressRegion.querySelector("[role='progressbar']"),
  progressValue = document.querySelector("#progress-value"),
  progressLabel = document.querySelector("#progress-label"),
  errorDetail = document.querySelector("#error-detail"),
  releaseButton = document.querySelector("#release-button"),
  closeButton = document.querySelector("#close-button"),
  primaryButton = document.querySelector("#primary-button");

const language = String(navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
const copy = Object.freeze({
  en:{
    windowTitle:"PenEcho Update", installedVersion:version => `Installed version: v${version}`,
    checking:["Checking for updates…", "This usually takes only a moment."],
    available:version => [`PenEcho v${version} is available`, "Download it now and keep working while it completes."],
    downloading:version => [`Downloading PenEcho v${version}…`, "You can close this window. The download will continue in the background."],
    ready:version => [`PenEcho v${version} is ready to install`, "Install now to finish the update."],
    installing:["Starting the installer…", "PenEcho will close while the update is installed."],
    current:version => [`PenEcho v${version} is up to date`, "You already have the latest version."],
    error:["The update could not be completed", "Try checking again. Your current PenEcho installation has not changed."],
    download:"Download", install:"Install", retry:"Check again", close:"Close", release:"Open release page",
    starting:"Starting download…", progress:value => `Downloading · ${value}%`, unknownError:"Please try again later.",
  },
  zh:{
    windowTitle:"PenEcho 更新", installedVersion:version => `当前版本：v${version}`,
    checking:["正在检查更新…", "通常只需片刻。"],
    available:version => [`PenEcho v${version} 可以更新`, "现在下载；下载期间可以继续使用 PenEcho。"],
    downloading:version => [`正在下载 PenEcho v${version}…`, "可以关闭此窗口，下载会在后台继续。"],
    ready:version => [`PenEcho v${version} 已可安装`, "现在安装即可完成升级。"],
    installing:["正在启动安装程序…", "安装更新时 PenEcho 将退出。"],
    current:version => [`PenEcho v${version} 已是最新版本`, "当前不需要更新。"],
    error:["更新未能完成", "请重新检查；当前 PenEcho 安装不会受影响。"],
    download:"下载", install:"安装", retry:"重新检查", close:"关闭", release:"打开更新页面",
    starting:"正在开始下载…", progress:value => `正在下载 · ${value}%`, unknownError:"请稍后重试。",
  },
})[language];

document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
document.title = copy.windowTitle;
document.querySelector("#update-title").textContent = copy.windowTitle;
closeButton.textContent = copy.close;
releaseButton.textContent = copy.release;

let currentState = null;

function stateCopy(state) {
  if (state.status === "available") return copy.available(state.version);
  if (state.status === "downloading") return copy.downloading(state.version);
  if (state.status === "ready") return copy.ready(state.version);
  if (state.status === "installing") return copy.installing;
  if (state.status === "up-to-date") return copy.current(state.currentVersion);
  if (state.status === "error") return copy.error;
  return copy.checking;
}

function render(state) {
  if (!state) return;
  currentState = state;
  document.body.dataset.state = state.status || "checking";
  versionLabel.textContent = state.currentVersion ? copy.installedVersion(state.currentVersion) : "";
  const [title, detail] = stateCopy(state);
  statusTitle.textContent = title;
  statusDetail.textContent = detail;

  const downloading = state.status === "downloading", progress = state.progress;
  progressRegion.hidden = !downloading;
  if (downloading) {
    const known = typeof progress === "number" && Number.isFinite(progress),
      rounded = known ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
    progressTrack.setAttribute("aria-valuenow", known ? String(rounded) : "0");
    progressTrack.setAttribute("aria-valuetext", known ? `${rounded}%` : copy.starting);
    progressValue.style.transform = `scaleX(${rounded / 100})`;
    progressLabel.textContent = known ? copy.progress(rounded) : copy.starting;
  }

  errorDetail.hidden = state.status !== "error";
  errorDetail.textContent = state.status === "error" ? state.error || copy.unknownError : "";
  releaseButton.hidden = !state.releaseUrl;
  primaryButton.hidden = !["available", "ready", "error"].includes(state.status);
  if (state.status === "available") primaryButton.textContent = copy.download;
  else if (state.status === "ready") primaryButton.textContent = copy.install;
  else if (state.status === "error") primaryButton.textContent = state.ready ? copy.install : copy.retry;
}

async function runPrimaryAction() {
  if (!currentState) return;
  primaryButton.disabled = true;
  try {
    if (currentState.status === "available") await api.download();
    else if (currentState.status === "ready" || currentState.ready) await api.install();
    else if (currentState.status === "error") await api.check();
  } finally { primaryButton.disabled = false; }
}

primaryButton.addEventListener("click", () => void runPrimaryAction());
releaseButton.addEventListener("click", () => void api.openReleasePage());
closeButton.addEventListener("click", () => void api.close());
api.onStateChange(render);
void api.getState().then(render);
