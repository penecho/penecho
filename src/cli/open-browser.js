"use strict";

const { spawn } = require("child_process");

// The page as this computer opens it: a server that listens on every address is reached on localhost.
function browserUrl(address) {
  if (!address || typeof address !== "object" || !address.port) return "";
  const host = String(address.address || "");
  if (!host || ["0.0.0.0", "::", "::1"].includes(host)) return `http://localhost:${address.port}`;
  return `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
}

function browserCommand(platform, url) {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

// Only a person at this computer's own terminal gets a page: not a script, CI, a restart in the background or a remote shell.
function canOpenBrowser(options = {}) {
  const env = options.env || process.env, platform = options.platform || process.platform,
    input = options.input || process.stdin, output = options.output || process.stdout;
  if (!input.isTTY || !output.isTTY) return false;
  if (env.CI && !/^(?:0|false)$/i.test(env.CI)) return false;
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (platform !== "darwin" && platform !== "win32") return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  return true;
}

function openBrowser(url, options = {}) {
  const [command, args] = browserCommand(options.platform || process.platform, url), spawnImpl = options.spawnImpl || spawn;
  return new Promise(resolve => {
    let child;
    try { child = spawnImpl(command, args, { stdio:"ignore", detached:true, windowsHide:true }); }
    catch { resolve(false); return; }
    child.once("error", () => resolve(false));
    child.once("exit", code => resolve(code === 0));
    child.unref?.();
  });
}

module.exports = { browserCommand, browserUrl, canOpenBrowser, openBrowser };
