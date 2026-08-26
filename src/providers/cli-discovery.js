"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CLI_DEFINITIONS = Object.freeze({
  "kimi-cli":Object.freeze({ command:"kimi", envName:"KIMI_CLI_PATH", label:"Kimi", doctor:"kimi" }),
  "codex-cli":Object.freeze({ command:"codex", envName:"CODEX_CLI_PATH", label:"Codex", doctor:"codex" }),
  "claude-cli":Object.freeze({ command:"claude", envName:"CLAUDE_CLI_PATH", label:"Claude", doctor:"claude" }),
});

function cliDefinition(provider) {
  const item = CLI_DEFINITIONS[provider];
  if (!item) throw new Error("Choose Kimi CLI, Codex CLI, or Claude CLI.");
  return item;
}

function executableNames(command, platform = process.platform, env = process.env) {
  if (platform !== "win32" || path.extname(command)) return [command];
  const extensions = String(env.PATHEXT || ".EXE;.COM;.CMD;.BAT").split(";").map(value => value.trim().toLowerCase()).filter(Boolean);
  return [...new Set(extensions)].map(extension => `${command}${extension.startsWith(".") ? extension : `.${extension}`}`);
}

function executableFile(file) {
  try { return fs.statSync(file).isFile(); }
  catch { return false; }
}

function canonicalFile(file) {
  try { return fs.realpathSync(file); }
  catch { return path.resolve(file); }
}

function pathExecutables(command, options = {}) {
  const env = options.env || process.env, platform = options.platform || process.platform, results = [];
  const delimiter = platform === "win32" ? ";" : path.delimiter;
  for (const directory of String(env.PATH || env.Path || "").split(delimiter).filter(Boolean)) {
    const cleanDirectory = directory.replace(/^"|"$/g, "");
    for (const name of executableNames(command, platform, env)) {
      const candidate = path.join(cleanDirectory, name);
      if (executableFile(candidate)) results.push(candidate);
    }
  }
  return results;
}

function desktopStateDirectory(home, platform, env) {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "PenEcho");
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "PenEcho");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "PenEcho");
}

function managedCliPaths(provider, options = {}) {
  const item = cliDefinition(provider), env = options.env || process.env, platform = options.platform || process.platform,
    home = path.resolve(options.home || env.HOME || env.USERPROFILE || "."), stateDir = options.stateDir ? path.resolve(options.stateDir) : "",
    executable = executableNames(item.command, platform, env)[0], states = [stateDir, desktopStateDirectory(home, platform, env)].filter(Boolean), values = [];
  if (provider === "claude-cli") values.push(path.join(home, ".local", "bin", executable));
  else for (const directory of states) values.push(path.join(directory, "tools", item.command, "bin", executable));
  return [...new Set(values.map(value => path.resolve(value)))];
}

function knownSystemCliPaths(provider, options = {}) {
  const platform = options.platform || process.platform, home = path.resolve(options.home || options.env?.HOME || options.env?.USERPROFILE || ".");
  if (provider !== "codex-cli" || platform !== "darwin") return [];
  return [
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    path.join(home, "Applications", "ChatGPT.app", "Contents", "Resources", "codex"),
  ];
}

function hasDirectory(value) {
  return path.isAbsolute(value) || value.includes("/") || value.includes("\\");
}

function cliCandidates(provider, options = {}) {
  const item = cliDefinition(provider), env = options.env || process.env, configured = String(options.configuredPath ?? env[item.envName] ?? "").trim(), values = [];
  const add = (executable, source) => { if (executable && executableFile(executable)) values.push({ executable:path.resolve(executable), source }); };
  for (const executable of managedCliPaths(provider, options)) add(executable, "managed");
  if (configured && hasDirectory(configured)) add(path.resolve(configured), "configured");
  else if (configured && configured !== item.command) for (const executable of pathExecutables(configured, options)) add(executable, "configured");
  for (const executable of pathExecutables(item.command, options)) add(executable, "system");
  for (const executable of knownSystemCliPaths(provider, options)) add(executable, "system");
  const seen = new Set();
  return values.filter(candidate => {
    const canonical = canonicalFile(candidate.executable);
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

module.exports = { CLI_DEFINITIONS, canonicalFile, cliCandidates, cliDefinition, managedCliPaths, pathExecutables };
