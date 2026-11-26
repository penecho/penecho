"use strict";

const fs = require("node:fs");
const path = require("node:path");

const WINDOW_COLORS = Object.freeze({
  light:Object.freeze({ mode:"light", backgroundColor:"#f8fafc", titleBarColor:"#ffffff", symbolColor:"#0f172a" }),
  dark:Object.freeze({ mode:"dark", backgroundColor:"#0e131a", titleBarColor:"#161c25", symbolColor:"#e6e9ef" }),
});

function normalizeThemePreference(value) {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function resolveWindowColors(preference, shouldUseDarkColors = false) {
  const pref = normalizeThemePreference(preference);
  const dark = pref === "dark" || (pref === "system" && Boolean(shouldUseDarkColors));
  return dark ? WINDOW_COLORS.dark : WINDOW_COLORS.light;
}

function themeFile(stateDir) {
  return path.join(stateDir, "window-theme.json");
}

function readWindowTheme(stateDir) {
  if (!stateDir || typeof stateDir !== "string") return "system";
  try {
    const saved = JSON.parse(fs.readFileSync(themeFile(stateDir), "utf8"));
    return normalizeThemePreference(saved?.mode);
  } catch {
    return "system";
  }
}

function writeWindowTheme(stateDir, preference) {
  const mode = normalizeThemePreference(preference);
  if (!stateDir || typeof stateDir !== "string") return mode;
  try {
    fs.mkdirSync(stateDir, { recursive:true });
    fs.writeFileSync(themeFile(stateDir), JSON.stringify({ mode }) + "\n");
  } catch { /* Best-effort preference persistence; never fail startup or theme changes. */ }
  return mode;
}

// As high as the page's 46px top bar at this page size, less its bottom border.
function titleBarOverlay(colors, scale = 1) {
  return { color:colors.titleBarColor, symbolColor:colors.symbolColor, height:Math.floor(45 * scale) };
}

function titleBarOptionsForPlatform(platform, colors) {
  if (platform === "darwin") {
    return { titleBarStyle:"hiddenInset", trafficLightPosition:{ x:14, y:15 } };
  }
  if (platform === "win32") {
    return { titleBarStyle:"hidden", titleBarOverlay:titleBarOverlay(colors || WINDOW_COLORS.light) };
  }
  return {};
}

module.exports = {
  WINDOW_COLORS,
  normalizeThemePreference,
  resolveWindowColors,
  readWindowTheme,
  writeWindowTheme,
  titleBarOverlay,
  titleBarOptionsForPlatform,
};
