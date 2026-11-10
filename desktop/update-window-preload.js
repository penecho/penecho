"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const CHANNEL = "penecho:update-state";

function invoke(channel) {
  return ipcRenderer.invoke(channel);
}

contextBridge.exposeInMainWorld("penechoDesktopUpdateWindow", Object.freeze({
  getState:() => invoke("penecho:get-update-state"),
  check:() => invoke("penecho:update-check"),
  download:() => invoke("penecho:update-download"),
  install:() => invoke("penecho:update-install"),
  openReleasePage:() => invoke("penecho:update-open-release-page"),
  close:() => invoke("penecho:update-window-close"),
  onStateChange:listener => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on(CHANNEL, handler);
    return () => ipcRenderer.removeListener(CHANNEL, handler);
  },
}));
