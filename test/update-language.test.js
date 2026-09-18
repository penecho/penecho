"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("update window follows app language across states, independently of system language", async () => {
  const nodes = new Map();
  function element(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      textContent:"", style:{}, attributes:{},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener() {}, querySelector:element,
    });
    return nodes.get(selector);
  }
  let listener;
  const document = { querySelector:element, documentElement:{}, body:{ dataset:{} } };
  const api = {
    onStateChange(fn) { listener = fn; },
    getState:async () => ({ status:"checking", currentVersion:"1.0", language:"zh" }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../desktop/update-window.js"), "utf8"), {
    window:{ penechoDesktopUpdateWindow:api }, document, navigator:{ language:"en-US" },
  });
  await Promise.resolve();
  assert.equal(document.title, "PenEcho 更新");
  assert.equal(element("#status-title").textContent, "正在检查更新…");
  for (const status of ["available", "downloading", "ready", "installing", "up-to-date", "error"]) {
    listener({ status, language:"zh", version:"2.0", currentVersion:"1.0", progress:42 });
    assert.match(element("#status-title").textContent, /[\u4e00-\u9fff]/);
  }
  listener({ status:"downloading", language:"zh", version:"2.0", progress:42 });
  assert.equal(element("#progress-label").textContent, "正在下载 · 42%");
  assert.equal(element("[role='progressbar']").attributes["aria-label"], "下载进度");
  listener({ status:"ready", language:"en", version:"2.0" });
  assert.equal(document.title, "PenEcho Update");
  assert.equal(element("#primary-button").textContent, "Install");
  assert.equal(element("#close-button").textContent, "Close");
  assert.equal(document.documentElement.lang, "en");
  listener({ status:"ready", language:"zh", version:"2.0" });
  assert.equal(element("#primary-button").textContent, "安装");
});

test("native update menu accepts language changes only from the Canvas main frame", () => {
  const source = fs.readFileSync(path.join(__dirname, "../desktop/main.js"), "utf8");
  const menuFunction = source.slice(source.indexOf("function installMenu()"), source.indexOf("const CANVAS_AGENT_CLIPBOARD_FILE_LIMIT"));
  const handler = source.slice(source.indexOf('  ipcMain.on("penecho:set-language"'), source.indexOf('  ipcMain.handle("penecho:mcp-keep-awake"'));
  let receive, menu, updates = 0;
  const frame = {}, sender = { mainFrame:frame };
  const context = vm.createContext({
    desktopLanguage:"en", process:{ platform:"darwin" }, currentLanUrls:[], updateWindow:null,
    showSettings() {}, showUpdateWindow() {}, HELP_URL:"https://example.com",
    shell:{}, clipboard:{},
    Menu:{ buildFromTemplate:template => template, setApplicationMenu:template => { menu = template; } },
    fromCanvas:event => event.sender === sender,
    ipcMain:{ on(_channel, callback) { receive = callback; } },
    updateDesktopUpdateUi() { updates++; },
  });
  vm.runInContext(menuFunction + handler + "\ninstallMenu();", context);
  const label = () => menu.find(item => item.label === "Help").submenu.at(-1).label;
  assert.equal(label(), "Check for Updates…");
  receive({ sender:{}, senderFrame:frame }, "zh");
  receive({ sender, senderFrame:{} }, "zh");
  receive({ sender, senderFrame:frame }, "fr");
  assert.equal(updates, 0);
  receive({ sender, senderFrame:frame }, "zh");
  assert.equal(label(), "检查更新…");
  receive({ sender, senderFrame:frame }, "zh");
  assert.equal(updates, 1);
  receive({ sender, senderFrame:frame }, "en");
  assert.equal(label(), "Check for Updates…");
});
