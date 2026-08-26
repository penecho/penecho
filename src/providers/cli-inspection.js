"use strict";

const os = require("node:os");
const path = require("node:path");
const { cliCandidates, cliDefinition } = require("./cli-discovery.js");

const CLI_LOGIN_COMMANDS = Object.freeze({
  "kimi-cli":"kimi login",
  "codex-cli":"codex login",
  "claude-cli":"claude auth login",
});
const CLI_INSTALL_COMMANDS = Object.freeze({
  "kimi-cli":Object.freeze({ posix:"curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash", win32:"irm https://code.kimi.com/kimi-code/install.ps1 | iex" }),
  "codex-cli":Object.freeze({ posix:"curl -fsSL https://chatgpt.com/codex/install.sh | sh", win32:"irm https://chatgpt.com/codex/install.ps1 | iex" }),
  "claude-cli":Object.freeze({ posix:"curl -fsSL https://claude.ai/install.sh | bash", win32:"irm https://claude.ai/install.ps1 | iex" }),
});

function cliDisplayLabel(provider) {
  if (provider === "kimi-cli") return "Kimi Code";
  if (provider === "codex-cli") return "Codex CLI";
  if (provider === "claude-cli") return "Claude Code";
  throw new Error("Choose Kimi CLI, Codex CLI, or Claude CLI.");
}

function cliInspectionStatus(provider, result, platform = process.platform) {
  const label = cliDisplayLabel(provider), loginCommand = CLI_LOGIN_COMMANDS[provider],
    installCommand = CLI_INSTALL_COMMANDS[provider][platform === "win32" ? "win32" : "posix"],
    base = { provider, label, source:result.source || "", version:"", executable:result.executable || "", installCommand, loginCommand };
  if (result.ok) return { ...base, state:"ready", version:String(result.version || "").trim().slice(0, 200), authenticationDeferred:provider === "kimi-cli" };
  if (result.issue === "authentication") return { ...base, state:"auth_required" };
  if (result.issue === "missing") return { ...base, state:"missing", source:"", executable:"" };
  return { ...base, state:"repair_required" };
}

async function inspectCli(provider, options = {}) {
  const platform = options.platform || process.platform, sourceEnv = options.env || process.env,
    home = path.resolve(options.home || sourceEnv.HOME || sourceEnv.USERPROFILE || os.homedir()),
    stateDir = path.resolve(options.stateDir || sourceEnv.PENECHO_STATE_DIR || path.join(home, ".penecho")),
    item = cliDefinition(provider), env = { ...sourceEnv, HOME:home, USERPROFILE:home, KIMI_CODE_NO_AUTO_UPDATE:"1" },
    configuredPath = String(options.configuredPath ?? env[item.envName] ?? "").trim(),
    candidates = Array.isArray(options.candidates) ? options.candidates : cliCandidates(provider, { platform, home, stateDir, env, configuredPath }),
    preflight = options.preflight || require("../cli/main.js").resolveCliPreflight,
    result = await preflight({ provider, env, cwd:options.cwd || stateDir, home, stateDir }, { platform, candidates, runner:options.runner });
  return cliInspectionStatus(provider, result, platform);
}

module.exports = { CLI_INSTALL_COMMANDS, CLI_LOGIN_COMMANDS, cliDisplayLabel, cliInspectionStatus, inspectCli };
