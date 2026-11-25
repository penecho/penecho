"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { failure } = require("./store.js");

// Paths come from the line on the server, never from a command supplied by the page.
function folderCommand(platform, folder) {
  if (platform === "darwin") return ["open", [folder]];
  if (platform === "win32") return ["explorer.exe", [folder]];
  if (platform === "linux") return ["xdg-open", [folder]];
  return null;
}
function revealCommand(platform, file) {
  if (platform === "darwin") return ["open", ["-R", file]];
  if (platform === "win32") return ["explorer.exe", ["/select,", String(file).replace(/\//g, "\\")]];
  if (platform === "linux") return ["xdg-open", [path.posix.dirname(file)]];
  return null;
}
// On Windows, explorer.exe often exits with code 1 after handing off to an existing Explorer window.
const explorerExitOk = (platform, command, error) =>
  platform === "win32" && command[0] === "explorer.exe" && Boolean(error) && !error.killed && !error.signal && error.code === 1;
// A test server (NODE_ENV=test) checks the folder but opens no Finder window: page tests click Open folder on temp folders.
const skipOpen = (command, args, options, done) => done(null);
function createFolderOpener({ platform = process.platform, run = process.env.NODE_ENV === "test" ? skipOpen : execFile } = {}) {
  const label = { darwin:"Open folder in Finder", win32:"Open folder in File Explorer", linux:"Open folder" }[platform] || "";
  const revealLabel = { darwin:"Reveal in Finder", win32:"Show in File Explorer", linux:"Show in folder" }[platform] || "";
  return { label, revealLabel, async open(folder) {
    const command = folderCommand(platform, folder);
    if (!command) throw failure("UNAVAILABLE", "Opening folders is not supported on this system.", 400);
    try { if (!fs.statSync(folder).isDirectory()) throw new Error(); }
    catch { throw failure("NOT_FOUND", "This folder no longer exists on this computer.", 404); }
    await new Promise((resolve, reject) => run(command[0], command[1], { timeout:10000, windowsHide:false }, error => {
      if (error && !explorerExitOk(platform, command, error)) reject(failure("OPEN_FAILED", "The file manager could not open this folder. Copy its path and open it manually.", 400));
      else resolve();
    }));
    return { ok:true };
  }, async reveal(target) {
    let stat;
    try { stat = fs.statSync(target); }
    catch { throw failure("NOT_FOUND", "This file no longer exists on this computer.", 404); }
    const command = platform === "linux" && stat.isDirectory() ? folderCommand(platform, target) : revealCommand(platform, target);
    if (!command) throw failure("UNAVAILABLE", "Revealing files is not supported on this system.", 400);
    await new Promise((resolve, reject) => run(command[0], command[1], { timeout:10000, windowsHide:false }, error => {
      if (error && !explorerExitOk(platform, command, error)) reject(failure("OPEN_FAILED", "The file manager could not show this file. Copy its path and open it manually.", 400));
      else resolve();
    }));
    return { ok:true };
  }, async openFile(file) {
    // A page an agent made in the code folder (a prototype) opens in the browser, as a double-click on it would.
    const command = folderCommand(platform, file);
    if (!command) throw failure("UNAVAILABLE", "Opening files is not supported on this system.", 400);
    try { if (!fs.statSync(file).isFile()) throw new Error(); }
    catch { throw failure("NOT_FOUND", "This file no longer exists on this computer.", 404); }
    await new Promise((resolve, reject) => run(command[0], command[1], { timeout:10000, windowsHide:false }, error => {
      if (error) reject(failure("OPEN_FAILED", "The file could not be opened. Copy its path and open it manually.", 400));
      else resolve();
    }));
    return { ok:true };
  } };
}
module.exports = { createFolderOpener, folderCommand, revealCommand };
