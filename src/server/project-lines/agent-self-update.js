"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { runCommand } = require("./agent-process.js");
const { compareVersions, SOURCES } = require("./agent-updates.js");
const { installCli, enrichInstallerPath } = require("../../providers/cli-installer.js");

// Updates one agent with the agent's own updater, which knows how its copy was installed. Every command runs hidden and in an empty folder,
// and an update counts only when the same command then answers with a newer version.
const TIMEOUT_MS = 10 * 60 * 1000;
const COMMANDS = Object.freeze({
  claude:["update"],
  codex:["update"],
  opencode:["upgrade"],
  pi:["update", "--self"],
  omp:["update"],
});
const realOf = file => { try { return fs.realpathSync(file); } catch { return file; } };
// A copy Homebrew keeps is updated by Homebrew; its own updater only says so.
function homebrewOf(real) {
  const found = /^(.*)\/(Cellar|Caskroom)\/([^/]+)\//.exec(real);
  if (!found) return null;
  return { command:path.join(found[1], "bin", "brew"), args:["upgrade", ...(found[2] === "Caskroom" ? ["--cask"] : []), found[3]] };
}

// The command line of every process on this computer, or null when they cannot be read.
async function processLines() {
  if (process.platform === "win32") return require("./windows-processes.js").commands();
  return new Promise(resolve => {
    execFile("ps", ["-A", "-ww", "-o", "command="], { timeout:10000, maxBuffer:32 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : String(stdout).split("\n")));
  });
}
// Claude Code keeps each version in its own file, so a running one goes on with its own. Any other copy is replaced where it is.
const keepsVersions = (id, real) => id === "claude" && process.platform !== "win32" && real.includes("/claude/versions/");
function runsIn(line, { id, command, real, cli }) {
  const text = process.platform === "win32" ? line.toLowerCase().replaceAll("\\", "/") : line;
  const has = file => text.includes(process.platform === "win32" ? file.toLowerCase().replaceAll("\\", "/") : file);
  if (has(command) || has(real) || has(`/node_modules/${SOURCES[id].pkg}/`)) return true;
  return text.trim().split(/\s+/).slice(0, 2).some(word => word.replace(/^.*\//, "").replace(/\.(?:exe|cmd)$/, "") === cli);
}

async function updateAgent(agent, { env, stateDir, version, kind, run = runCommand, lines = processLines, install = installCli } = {}) {
  const { id, cli, launch } = agent, home = env.HOME || env.USERPROFILE || os.homedir(), real = realOf(launch.command);
  if (!keepsVersions(id, real)) {
    const table = await lines();
    // With no list, nobody can say the agent is idle.
    if (!table || table.some(line => runsIn(line, { id, command:launch.command, real, cli }))) return { ok:false, busy:true, said:"" };
  }
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-update-"));
  const childEnv = { ...env }; delete childEnv.PWD; delete childEnv.OLDPWD;
  enrichInstallerPath(childEnv, home, process.platform, { env:childEnv });
  const ask = (command, args, timeout) => run(command, args, { env:childEnv, cwd:folder, timeout, maxBuffer:8 * 1024 * 1024 });
  const words = answer => `${answer.stdout || ""}\n${answer.stderr || ""}`.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim();
  let said = "";
  try {
    const brew = homebrewOf(real), args = COMMANDS[id];
    if (brew) {
      Object.assign(childEnv, { NONINTERACTIVE:"1", HOMEBREW_NO_INSTALL_CLEANUP:"1", HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK:"1", HOMEBREW_NO_ENV_HINTS:"1" });
      const answer = await ask(brew.command, brew.args, TIMEOUT_MS);
      said = answer.timedOut ? "The update did not end in 10 minutes." : words(answer);
    } else {
      // An older version without the updater could take its name for a prompt, so it must be in the agent's own help.
      const help = args ? words(await ask(launch.command, [...launch.prefixArgs, "--help"], 20000)) : "";
      if (args && new RegExp(`^\\s*(?:${cli}\\s+)?${args[0]}\\b`, "m").test(help)) {
        const answer = await ask(launch.command, [...launch.prefixArgs, ...args], TIMEOUT_MS);
        said = answer.timedOut ? "The update did not end in 10 minutes." : words(answer);
      } else if (kind === "managed") {
        await install(SOURCES[id].provider, { home, stateDir, env:childEnv });
      } else said = "This version has no update command.";
    }
    const answer = await ask(launch.command, [...launch.prefixArgs, "--version"], 30000), now = words(answer);
    if (answer.status === 0 && compareVersions(now, version) > 0) return { ok:true, busy:false, said:"" };
    return { ok:false, busy:false, said:(answer.status === 0 ? said : `${said}\n${now}`).trim().slice(-1200) };
  } catch (error) {
    return { ok:false, busy:false, said:`${said}\n${error.message}`.trim().slice(-1200) };
  } finally {
    fs.rmSync(folder, { recursive:true, force:true });
  }
}

module.exports = { updateAgent, runsIn, homebrewOf };
