"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("penechoDesktop", Object.freeze({
  getSettings:() => ipcRenderer.invoke("penecho:get-settings"),
  installCli:provider => ipcRenderer.invoke("penecho:install-cli", provider),
  saveAndTest:settings => ipcRenderer.invoke("penecho:save-and-test", settings),
  launch:() => ipcRenderer.invoke("penecho:launch"),
  copyText:text => ipcRenderer.invoke("penecho:copy-text", text),
  openHelp:() => ipcRenderer.invoke("penecho:open-help"),
  platform:process.platform,
}));
