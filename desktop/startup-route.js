"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Reads PenEcho's own registry inside Electron's userData directory without ever
// touching user project folders (e.g. ~/Documents), preserving PE-940 startup guarantees.
function hasOwnProjects(stateDir) {
  if (!stateDir || typeof stateDir !== "string") return false;
  try {
    const file = path.join(stateDir, "project-lines", "projects.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    const projects = Array.isArray(saved?.projects) ? saved.projects : [];
    return projects.some(p => p && !p.example && !p.myCanvases && !p.archived);
  } catch {
    return false;
  }
}

// Decide whether to boot directly into the persistent Projects shell or the first-run
// Canvas welcome before BrowserWindow.loadURL, eliminating the startup redirect double-load.
function initialDesktopUrl(baseUrl, { stateDir = "", desktopLaunch = "" } = {}) {
  const url = new URL(baseUrl);
  if (hasOwnProjects(stateDir)) url.pathname = "/projects.html";
  if (desktopLaunch) url.searchParams.set("desktopLaunch", desktopLaunch);
  return url.href;
}

module.exports = { hasOwnProjects, initialDesktopUrl };
