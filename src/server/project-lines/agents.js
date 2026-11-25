"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
const { resolveClaudeLaunch } = require("../../providers/claude-cli.js");
const { commonPosixCodexPaths, commonWindowsCodexPaths, resolveCodexLaunch, prepareCodexEnv, findCodexInApp, namesCodex } = require("../../providers/codex-cli.js");
const { prepareAgentEnv } = require("../../providers/agent-env.js");
const { managedCliPath } = require("../../providers/cli-installer.js");
const { spawnSync:launchSync, runCommand } = require("./agent-process.js");
const { resolveKimiLaunch } = require("../../providers/kimi-cli.js");
const { inDesktop } = require("./kimi-sessions.js");
const { antigravityInDesktop } = require("./antigravity-sessions.js");
const { findWindowsWorkBuddy } = require("./windows-workbuddy.js");
const { WORKBUDDY } = require("./workbuddy-sessions.js");
const { modelOf, defaultEffortWith, parseOpenCodeModels } = require("./agent-model.js");
const Memory = require("./memory.js");
const { RUN_COMMANDS } = require("../agent-core/run-commands.js");
const { dshHome, dshPlan, stageDshPatch, yamlRows, validDshModel, DEFAULT_PLUGIN } = require("./dsh-models.js");

// The command-line agents PenEcho can start: the same ones you run yourself, with your sign-in and your settings.
// Each prints what it is doing as JSON lines, and can pick the same conversation up again later.
function firstLaunch(resolve, candidates) {
  for (const candidate of candidates) {
    try { return resolve(candidate); } catch { /* Try the next place this agent might be installed. */ }
  }
  return null;
}
function managed(provider, paths) {
  try { const file = managedCliPath(provider, paths); return file && fs.existsSync(file) ? file : null; } catch { return null; }
}
const electronNodeEnv = () => (process.versions?.electron ? { env:{ ELECTRON_RUN_AS_NODE:"1" } } : {});
function withLaunchEnv(launch, spec, adapter = null, platform = process.platform) {
  if (!spec) return spec;
  const merged = launch?.env && Object.keys(launch.env).length ? { ...spec, env:{ ...launch.env, ...(spec.env || {}) } } : spec;
  if (!merged.prepareEnv) {
    const sandboxWindowsPath = Boolean(merged.sandboxWindowsPath);
    const prepare = adapter?.prepareEnv
      ? (env, extra) => adapter.prepareEnv(env, extra, platform, { sandboxWindowsPath })
      : (env, extra) => prepareAgentEnv(env, extra, { platform, sandboxWindowsPath });
    return { ...merged, prepareEnv:prepare };
  }
  return merged;
}
function launchForFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".js" || ext === ".cjs" || ext === ".mjs") return { command:process.execPath, prefixArgs:[file], ...electronNodeEnv() };
  // The shared launcher handles Windows batch quoting, including spaces and metacharacters.
  if (ext === ".cmd" || ext === ".bat") return { command:file, prefixArgs:[] };
  return { command:file, prefixArgs:[] };
}
// Agents with their own installers put themselves in folders that a PenEcho started from a desktop app may not have on its PATH.
function findAllClis(env, variable, name, folders = []) {
  const home = env.HOME || env.USERPROFILE;
  const wanted = String(env[variable] || "").trim();
  if (wanted) {
    const file = path.resolve(wanted);
    return isFile(file) ? [launchForFile(file)] : [];
  }
  const dirs = [...String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean), ...(home ? folders.map(folder => path.join(home, folder)) : [])];
  const names = process.platform === "win32" ? [".exe", ".cmd", ".bat"].map(ext => `${name}${ext}`) : [name];
  const seen = new Set(), out = [];
  for (const dir of dirs) {
    const cleanDir = dir.replace(/^"|"$/g, "");
    for (const n of names) {
      const file = path.join(cleanDir, n);
      if (!isFile(file)) continue;
      const resolved = physical(file), key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(launchForFile(file));
    }
  }
  return out;
}
function findCli(env, variable, name, folders = []) {
  return findAllClis(env, variable, name, folders)[0] || null;
}
// The dsh command inside DeepSeek Harness's desktop app. Tests and an explicit DSH_CLI_PATH never fall back to it.
function dshInApp(env) {
  if (process.platform !== "darwin" || env.DSH_CLI_PATH || env.NODE_ENV === "test") return null;
  const apps = ["/Applications", ...(env.HOME ? [path.join(env.HOME, "Applications")] : [])];
  const file = apps.map(dir => path.join(dir, "DeepSeek Harness.app", "Contents", "Resources", "runtime", "cli", "bin", "dsh")).find(isFile);
  return file ? { command:file, prefixArgs:[] } : null;
}
// The keys DeepSeek Harness's Models page saved, which its desktop app uses. dsh's headless mode turns that store off and reads keys
// only from the environment it starts in (read in 0.2.2), so PenEcho passes along each saved key the environment does not already have.
function dshSavedKeys(env) {
  const home = dshHome(env);
  let text = "";
  try { text = fs.readFileSync(path.join(home, ".credentials.yaml"), "utf8"); } catch { return {}; }
  const keys = {};
  let inRefs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) { inRefs = /^refs:\s*$/.test(line); continue; }
    const m = inRefs && line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (/^"(.*)"$/.test(value)) { try { value = JSON.parse(value); } catch { continue; } }
    else if (/^'(.*)'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
    else value = value.replace(/\s+#.*$/, "");
    if (value && !env[m[1]]) keys[m[1]] = value;
  }
  return keys;
}
// dsh's headless mode takes --permission-mode, --approval-policy and --add-dir from 0.2.2 (read in 0.2.1-rc.2 and 0.2.2-rc.1). An older one stops
// at the first with "unknown option", so those are left out for it. A version that cannot be read is taken as new enough.
// Asked through the same launcher a run uses: Node will not run a Windows .cmd shim directly (EINVAL), and every Windows dsh
// was taken as new enough and refused its run (PE-692).
const askLaunch = (launch, args, env, timeout = 15000, cwd) => {
  const result = launchSync(launch.command, [...launch.prefixArgs, ...args], { encoding:"utf8", timeout, cwd, env:prepareAgentEnv(env, launch.env, { platform:process.platform }), stdio:["ignore", "pipe", "ignore"], windowsHide:true });
  return result.status === 0 ? String(result.stdout || "") : "";
};
const dshVersions = new Map(), versionIn = text => /\d+\.\d+\.\d+/.exec(text)?.[0] || "";
// The same question asked ahead of a run and in the background, so its answer is there when the run starts: the desktop app's window waits for whatever its server waits for.
const askingAhead = new Set();
function askAhead(answers, launch, args, env, read, ask, key = [launch.command, ...launch.prefixArgs].join("\0")) {
  if (answers.has(key) || askingAhead.has(key)) return;
  askingAhead.add(key);
  // No answer leaves it to be asked when the run starts, and it is not asked ahead again.
  Promise.resolve().then(() => ask(launch.command, [...launch.prefixArgs, ...args], { env:prepareAgentEnv(env, launch.env, { platform:process.platform }) }))
    .then(result => { if (result?.status === 0 && !answers.has(key)) answers.set(key, read(String(result.stdout || ""))); }, () => {});
}
function dshVersion(launch, env) {
  const key = [launch.command, ...launch.prefixArgs].join("\0");
  if (!dshVersions.has(key)) {
    let text = "";
    try { text = askLaunch(launch, ["--version"], env); } catch { /* No answer, so nothing is left out. */ }
    dshVersions.set(key, versionIn(text));
  }
  return dshVersions.get(key);
}
const dshTakesFolders = version => !version || atLeast(version, "0.2.2");
const knownDshVersion = version => version && atLeast(version, "0.1.7") && !atLeast(version, "0.2.3");
function dshDefaultRow(rows, depth = 0, seen = new Set()) {
  if (!Array.isArray(rows) || depth > 10 || seen.has(rows)) return null;
  seen.add(rows);
  for (const row of rows) {
    if (!row || row.disabled) continue;
    if (row.id === "agent-default-model" && row.name === DEFAULT_PLUGIN) return row;
    const nested = row.group && dshDefaultRow(row.config, depth + 1, seen);
    if (nested) return nested;
  }
  return null;
}
function dshSelectionFromDump(launch, env, cwd, runtimeDirectory, patch) {
  // Check the effective configuration for this launch. A profile can change between runs.
  // Neither the dump nor launcher diagnostics should leave this function.
  let directory;
  try {
    let args = ["--profile", "headless"];
    if (patch) {
      directory = fs.mkdtempSync(path.join(runtimeDirectory, "dsh-verify-"));
      args = stageDshPatch({ args, dshPatch:patch }, directory);
    }
    const dumped = yamlRows(askLaunch(launch, [...args, "--dump-config"], env, 2500, cwd));
    const target = dshDefaultRow(dumped);
    const { provider, model, reasoningEffort } = target?.config || {};
    if (typeof provider === "string" && /^[\w.-]+$/.test(provider) && typeof model === "string" && model && validDshModel(`${provider}/${model}`)) {
      return { provider, model, effort:typeof reasoningEffort === "string" ? reasoningEffort : "" };
    }
  } catch { /* This launch cannot establish the model selected by dsh. */ }
  finally { if (directory) try { fs.rmSync(directory, { recursive:true, force:true }); } catch { /* Leave launch and failure reporting intact. */ } }
  return null;
}
// Claude Code's auto mode, its own reviewer for each command, is a choice of --permission-mode only in newer versions. An older one stops at an unknown choice,
// so the choices its help lists are read once. Help that cannot be read keeps acceptEdits, the mode every version takes.
const claudeModes = new Map(), offersAuto = text => /--permission-mode[\s\S]{0,400}?choices:[^)]*"auto"/.test(text);
function claudeTakesAuto(launch, env) {
  const key = [launch.command, ...launch.prefixArgs].join("\0");
  if (!claudeModes.has(key)) {
    let text = "";
    try { text = askLaunch(launch, ["--help"], env); } catch { /* No answer, so the older mode. */ }
    claudeModes.set(key, offersAuto(text));
  }
  return claudeModes.get(key);
}
// OpenCode 2 takes a model's reasoning level as provider/model#level, and its `run` stops at the older --variant, --dir and --pure with "Unrecognized flag".
// Its background service would also run a Work with the service's own environment, and go on with it after a stop, so a run has a private server.
// An update replaces the program under the same name, so what it said holds only for that file. A version that cannot be read is asked again, and is taken as 1.
const openCodeVersions = new Map();
function openCodeKey(launch) {
  const at = [launch.command, ...launch.prefixArgs].map(file => { try { const { mtimeMs, size } = fs.statSync(file); return `${mtimeMs}:${size}`; } catch { return ""; } });
  return [launch.command, ...launch.prefixArgs, ...at].join("\0");
}
function openCode2(launch, env) {
  const key = openCodeKey(launch);
  if (!openCodeVersions.get(key)) {
    let text = "";
    try { text = askLaunch(launch, ["--version"], env); } catch { /* No answer, so it is taken as 1. */ }
    openCodeVersions.set(key, versionIn(text));
  }
  const version = openCodeVersions.get(key);
  return Boolean(version) && atLeast(version, "2.0.0");
}
// What `run` takes for the model, its level, the conversation and its own extras, in either version.
function openCodeRun(launch, env, { model, effort, resume, older }) {
  if (!openCode2(launch, env)) return ["run", "--format", "json", ...older, ...(model ? ["--model", model] : []), ...(effort ? ["--variant", effort] : []), ...(resume ? ["--session", resume] : [])];
  const name = model || (effort ? modelOf("opencode", env)?.name || "" : "");
  if (effort && !name) throw Object.assign(Error("OpenCode 2 takes a reasoning level only together with a model. Pick a model too."), { code:"BAD_EFFORT", status:409 });
  return ["run", "--standalone", "--format", "json", ...(older.includes("--auto") ? ["--auto"] : []), ...(name ? ["--model", `${name}${effort ? `#${effort}` : ""}`] : []), ...(resume ? ["--session", resume] : [])];
}
// What each agent's Access choice in Settings means for its runs. "" is the default.
// Claude Code and Codex check each command with their own reviewer by default, with Full access as an option.
// dsh runs with Full access (danger-full-access, approval-policy never) by default, with Project folders (workspace-write) as an option.
// PenEcho keeps writes to the run's folders. The others take no choice: their command lines have no reviewer that works with nobody there, so they already run every tool, within their own settings.
const ACCESS = { claude:"reviewed", codex:"reviewed", dsh:"full", penecho:"folders", opencode:"full", pi:"full", omp:"full", kimi:"full", antigravity:"full" };
const accessOf = id => {
  const base = { normal:ACCESS[id] || "", full:["claude", "codex", "dsh"].includes(id) };
  return id === "dsh" ? { ...base, folders:true } : base;
};
// A conversation belongs to the folder it happened in, so a command to carry it on starts from there.
function fromFolder(command, folder) {
  if (!folder) return command;
  return process.platform === "win32" ? `cd /d "${folder}" && ${command}` : `cd '${String(folder).replace(/'/g, "'\\''")}' && ${command}`;
}
const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const physical = folder => { try { return fs.realpathSync(folder); } catch { return folder; } };
const openLink = url => (process.platform === "darwin" ? { command:"open", args:[url] } : null);
// Whether an app is open right now, from macOS's own list of running apps. Asking needs no permission.
function runningOnMac(bundle) {
  try { return Boolean(execFileSync("lsappinfo", ["find", `bundleid=${bundle}`], { encoding:"utf8", timeout:2000 }).trim()); } catch { return false; }
}
const plistValue = (text, key) => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(text)?.[1] || "";
function atLeast(version, floor) {
  const have = version.split(".").map(Number), want = floor.split(".").map(Number);
  for (let i = 0; i < want.length; i++) if ((have[i] || 0) !== want[i]) return (have[i] || 0) > want[i];
  return true;
}
// An app counts only if it is really the one that answers these links. A plain ChatGPT.app, say, knows nothing of codex://.
function findMacApp({ names, bundle }, folders) {
  for (const folder of folders) for (const name of names) {
    const app = path.join(folder, `${name}.app`);
    let plist; try { plist = fs.readFileSync(path.join(app, "Contents", "Info.plist"), "utf8"); } catch { continue; }
    if ([bundle].flat().includes(plistValue(plist, "CFBundleIdentifier"))) return { path:app, version:plistValue(plist, "CFBundleShortVersionString") || "0" };
  }
  return {};
}
// The level picked for a Claude Code run. `--effort` alone does not decide it: a CLAUDE_CODE_EFFORT_LEVEL in the shell PenEcho was started from, or in the `env` of
// Claude's own settings, comes before it, and the run would go at that level while PenEcho shows this one. Settings given on the command line come before both (read on the wire, 2.1.300).
const claudeEffort = effort => (effort ? ["--effort", effort, "--settings", JSON.stringify({ env:{ CLAUDE_CODE_EFFORT_LEVEL:effort } })] : []);
const shellWord = word => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${String(word).replace(/'/g, "'\\''")}'`);
const ADAPTERS = {
  claude:{
    name:"Claude Code", mono:"Cl", color:"#a8502a", role:"Discuss and review", desktopName:"Claude",
    cli:"claude", envVar:"CLAUDE_CLI_PATH", install:process.platform === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash",
    // `claude auth status` prints JSON whose loggedIn says it all. Anything else is no answer.
    signIn:{ args:["auth", "status"], ok:({ stdout }) => { const { loggedIn } = JSON.parse(stdout); return typeof loggedIn === "boolean" ? loggedIn : null; }, login:"claude auth login" },
    resolve:(env, paths) => firstLaunch(file => resolveClaudeLaunch(file, env), [env.CLAUDE_CLI_PATH, "claude", managed("claude-cli", paths)].filter(Boolean)),
    ahead(launch, env, ask) { askAhead(claudeModes, launch, ["--help"], env, offersAuto, ask); },
    command(launch, { workdir, docs, also = [], resume, instructions, name, model, effort, access, env = process.env }) {
      // Nobody is there to answer a permission prompt. In auto mode Claude's own reviewer approves what is safe, chained commands included, and turns down
      // what goes beyond the request; a turned-down command is told why and the run goes on (PE-485: in acceptEdits 8.5% of its commands were refused by shape alone).
      // The everyday tools stay listed too: where auto mode is not offered to the account, Claude starts in its manual mode, and they still run.
      // Full access, picked in Settings, approves everything.
      const mode = access === "full" ? "bypassPermissions" : claudeTakesAuto(launch, env) ? "auto" : "acceptEdits";
      // PenEcho's instructions go in the system prompt, which Claude Code records with the conversation and sends again on every resume, so its app shows only the person's words.
      // A new conversation is named after its Topic. Left to itself, Claude's app calls many of them "General coding session".
      // Its words come in as JSON lines on a pipe left open while it works, so more of them can join the turn, as typing into Claude while it works does.
      const shell = RUN_COMMANDS.map(tool => `Bash(${tool}:*)`);
      // The project's memory command too, as PenEcho tells the agent to type it and with its path bare. Without it, every unattended run stops there.
      const memory = docs ? [...new Set([Memory.commandFor(docs), Memory.commandFor(docs).replace(/'([^'\s]*)'/, "$1")])].map(cmd => `Bash(${cmd}:*)`) : [];
      // Computer use and MCP browser tools stay discoverable without blanket pre-approval; --allowedTools only pre-approves everyday tools,
      // while other tools continue through Claude's auto-reviewer or PenEcho's permission prompt flow.
      return { command:launch.command, args:[...launch.prefixArgs, "-p", ...(resume ? ["--resume", resume] : []), ...(model ? ["--model", model] : []), ...claudeEffort(effort), ...(name && !resume ? ["--name", name] : []), "--permission-mode", mode, "--permission-prompt-tool", "stdio", ...[docs, ...also].flatMap(folder => ["--add-dir", folder]), "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--allowedTools", ["Read", "Edit", "Write", "Glob", "Grep", "Task", "TodoWrite", "WebFetch", "WebSearch", ...shell, ...memory].join(","), ...(instructions ? ["--append-system-prompt", instructions] : [])], cwd:workdir, stdin:true, input:"stream-json", ownInstructions:true, permissionMode:mode, steerMode:"live" };
    },
    // The app's own link, which goes to the session it already has or adds this one. `claude --desktop --resume` refuses any session a process still holds, and a conversation in the app always has one.
    macApp:{ names:["Claude"], bundle:"com.anthropic.claudefordesktop", from:"1.1.9669" },
    desktop(launch, id) { return openLink(`claude://resume?session=${encodeURIComponent(id)}`); },
    desktopNew(launch, folder) { return openLink(`claude://code/new?folder=${encodeURIComponent(folder)}`); },
    classify(launch) { return { command:launch.command, args:[...launch.prefixArgs, "-p", "--model", "haiku", "--no-session-persistence", "--tools", "", "--output-format", "text"] }; },
    // A quick answer about the project (the Ask tab): everything it needs is in the words sent, so it gets no tools and keeps no session.
    answer(launch, { model, effort }) { return { command:launch.command, args:[...launch.prefixArgs, "-p", ...(model ? ["--model", model] : []), ...claudeEffort(effort), "--no-session-persistence", "--tools", "", "--output-format", "text"] }; },
    // A review of finished work: it may read the folders and run commands that change nothing, as often as it needs. Nothing that edits is offered, and nobody is there to approve anything else.
    review(launch, { model, effort, dirs = [] }) { return { command:launch.command, args:[...launch.prefixArgs, "-p", ...(model ? ["--model", model] : []), ...claudeEffort(effort), "--no-session-persistence", "--strict-mcp-config", "--tools", "Read,Grep,Glob,Bash", "--allowedTools", "Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git status:*)", ...(dirs.length ? ["--add-dir", dirs.join(",")] : []), "--output-format", "stream-json", "--verbose"], json:true }; },
    // Every conversation a process holds right now, Claude's desktop app included. Carrying on one of those from here would make a copy the app never sees.
    openNow(launch) { return { command:launch.command, args:[...launch.prefixArgs, "agents", "--json"] }; },
  },
  codex:{
    name:"Codex", mono:"Cx", color:"#2b303a", role:"Build", desktopName:"Codex",
    cli:"codex", envVar:"CODEX_CLI_PATH", install:process.platform === "win32" ? "irm https://chatgpt.com/codex/install.ps1 | iex" : "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    // `codex login status` exits 0 only when signed in, and says "Not logged in" when not. Any other failure is no answer.
    signIn:{ args:["login", "status"], ok:({ status, stdout, stderr }) => (status === 0 ? true : /not logged in/i.test(stdout + stderr) ? false : null), login:"codex login" },
    resolve:(env, paths = {}) => {
      const fromEnv = env.CODEX_CLI_PATH ? firstLaunch(file => resolveCodexLaunch(file, env), [env.CODEX_CLI_PATH]) : null;
      if (fromEnv && namesCodex(env.CODEX_CLI_PATH)) return fromEnv;
      const appLaunch = paths.fromApps
        ? firstLaunch(file => resolveCodexLaunch(file, env), [findCodexInApp(env, { platform:paths.platform, home:paths.home, appFolders:paths.appFolders, onFound:paths.onAppFound })].filter(Boolean))
        : null;
      // The user's own Codex CLI or official Codex desktop app comes before the copy PenEcho once installed, which is left for a
      // computer with no other Codex.
      const extraCliPaths = paths.platform === "win32"
        ? commonWindowsCodexPaths(env, { platform:paths.platform, home:paths.home })
        : commonPosixCodexPaths(env, { platform:paths.platform, home:paths.home, includeSystemDirs:paths.fromApps, systemDirs:paths.systemDirs });
      const cliLaunch = firstLaunch(file => resolveCodexLaunch(file, env), ["codex", ...extraCliPaths].filter(Boolean));
      // On Windows, an npm-managed codex under %APPDATA%\npm lacks BUILTIN\Users RX ACLs so Codex's restricted
      // sandbox user gets "Access is denied" executing apply_patch.bat. Prefer the official Codex Desktop App
      // (auto-updated under Program Files\WindowsApps with proper RX ACLs) over an npm wrapper when both exist.
      const isWindowsNpmWrapper = paths.platform === "win32" && cliLaunch && (cliLaunch.env?.CODEX_MANAGED_BY_NPM === "1" || /\\appdata\\roaming\\npm\\/i.test(`${cliLaunch.command} ${(cliLaunch.prefixArgs || []).join(" ")}`));
      if (isWindowsNpmWrapper && appLaunch) return appLaunch;
      return cliLaunch || appLaunch || fromEnv;
    },
    prepareEnv:(env, extra, platform, opts = {}) => prepareCodexEnv(env, extra, { platform, sandboxWindowsPath:opts.sandboxWindowsPath ?? true }),
    command(launch, { workdir, docs, gitDir, also = [], resume, plain, instructions, model, effort, access, network = false }) {
      // Codex's sandbox covers only named folders, and a worktree commits into the main repository's .git folder.
      const roots = [docs, ...(gitDir ? [gitDir] : []), ...also];
      // An orchestrator's every PenEcho function is a curl to this computer. With the network shut, each one became a request to leave the sandbox,
      // which Codex's auto-reviewer judged alone and refused for handing a task to another agent (PE-658). Codex has no switch for this computer only.
      // Full access, picked in Settings: no sandbox and nothing asked, as Codex's own "Full access" (names read in its app-server schema, SandboxMode and SandboxPolicy).
      const full = access === "full";
      // A model and reasoning level picked for PenEcho go in as settings, which `codex exec` and `codex exec resume` both take.
      const picked = [...(model ? ["-c", `model=${JSON.stringify(model)}`] : []), ...(effort ? ["-c", `model_reasoning_effort=${JSON.stringify(effort)}`] : [])];
      if (plain) {
        const sandbox = full ? ["-c", 'sandbox_mode="danger-full-access"'] : ["-c", 'sandbox_mode="workspace-write"', "-c", `sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`, ...(network ? ["-c", "sandbox_workspace_write.network_access=true"] : [])];
        if (resume) return { command:launch.command, args:[...launch.prefixArgs, "exec", "resume", "--json", "--skip-git-repo-check", ...picked, "-c", 'approval_policy="never"', ...sandbox, resume, "-"], cwd:workdir, stdin:true, steerMode:"interrupt-resume", sandboxWindowsPath:!full };
        return { command:launch.command, args:[...launch.prefixArgs, "exec", "--json", ...picked, ...(full ? ["--sandbox", "danger-full-access"] : ["--sandbox", "workspace-write", ...roots.flatMap(folder => ["--add-dir", folder]), ...(network ? ["-c", "sandbox_workspace_write.network_access=true"] : [])]), "--skip-git-repo-check", "--cd", workdir, "-c", 'approval_policy="never"', "-"], cwd:workdir, stdin:true, steerMode:"interrupt-resume", sandboxWindowsPath:!full };
      }
      // A thread started through the app-server is listed with Codex's own desktop threads, which one from `codex exec` is not. PenEcho's instructions go in as developer instructions, which the app does not show.
      // Approval as Codex's desktop app runs by default: on request, so something the sandbox blocks (a browser, a local server) can ask to run outside it.
      // Who answers is the person's own Codex setting: its auto-reviewer decides by itself, and anything sent to PenEcho is declined (codex-server.js).
      const policy = full ? { approvalPolicy:"never", sandbox:"danger-full-access" } : { approvalPolicy:"on-request", sandbox:"workspace-write" };
      return { command:launch.command, args:[...launch.prefixArgs, "app-server"], cwd:workdir, protocol:"app-server", ownInstructions:true, steerMode:"live", sandboxWindowsPath:!full, thread:{ cwd:workdir, ...policy, ...(model ? { model } : {}), ...(instructions ? { developerInstructions:instructions } : {}) }, turn:{ sandboxPolicy:full ? { type:"dangerFullAccess" } : { type:"workspaceWrite", writableRoots:roots, networkAccess:Boolean(network) }, ...(effort ? { effort } : {}) } };
    },
    // Codex's app can be called ChatGPT. A new thread takes the folder as its project, adding it to Codex's list if it is not there yet. That part of the link was read in version 26.1103.
    macApp:{ names:["Codex", "ChatGPT"], bundle:"com.openai.codex", newFrom:"26.1103" },
    desktop(launch, id) { return openLink(`codex://threads/${id}`); },
    desktopNew(launch, folder) { return openLink(`codex://threads/new?path=${encodeURIComponent(folder)}`); },
    classify(launch) { return { command:launch.command, args:[...launch.prefixArgs, "exec", "--ephemeral", "--json", "--sandbox", "read-only", "--skip-git-repo-check", "-c", 'approval_policy="never"', "-c", 'model_reasoning_effort="low"', "-"], json:true, sandboxWindowsPath:true }; },
    // Low effort unless the saved agent says otherwise: the answer has to come quickly.
    answer(launch, { model, effort, quick = true }) { return { command:launch.command, args:[...launch.prefixArgs, "exec", "--ephemeral", "--json", "--sandbox", "read-only", "--skip-git-repo-check", "-c", 'approval_policy="never"', ...(model ? ["-c", `model=${JSON.stringify(model)}`] : []), ...(effort || quick ? ["-c", `model_reasoning_effort=${JSON.stringify(effort || "low")}`] : []), "-"], json:true, sandboxWindowsPath:true }; },
    // A review: the same read-only sandbox, where it can read and run commands that write nothing, in the code folder.
    // It is not a quick answer: a saved agent that names no effort reviews at Codex's own, as its card says, and not at low.
    review(launch, opts) { return this.answer(launch, { ...opts, quick:false }); },
  },
  opencode:{
    name:"OpenCode", mono:"Oc", color:"#3f4754", role:"Build",
    cli:"opencode", envVar:"OPENCODE_CLI_PATH", install:process.platform === "win32" ? "npm install -g @opencode/cli" : "curl -fsSL https://opencode.ai/v2/install | bash", extraFolders:[".opencode/bin", ".local/bin", "AppData/Roaming/npm"],
    resolve(env) { return findCli(env, this.envVar, this.cli, this.extraFolders); },
    // Nobody is there to answer a permission prompt. Anything your own OpenCode settings deny stays denied.
    // Its reasoning levels are a model's variants. OpenCode 1's `run --variant` quietly drops one the model does not have and runs with none,
    // and OpenCode works a model's variants out itself, from more than its settings files say, so its own list is asked for them. OpenCode 2 lists no variants, and turns one the model does not have down itself.
    levels(launch) { return { command:launch.command, args:[...launch.prefixArgs, "models", "--verbose"], parse:parseOpenCodeModels }; },
    ahead(launch, env, ask) { askAhead(openCodeVersions, launch, ["--version"], env, versionIn, ask, openCodeKey(launch)); },
    command(launch, { workdir, resume, model, effort, env = process.env }) { return { command:launch.command, args:[...launch.prefixArgs, ...openCodeRun(launch, env, { model, effort, resume, older:["--auto", "--dir", workdir] })], cwd:workdir, stdin:true, dialect:"opencode", steerMode:"interrupt-resume" }; },
    // Its desktop app takes no link to a conversation or a folder: 2.2.5 and 2.2.6 pass `opencode://` to the window, and only the sign-in link is acted on. The terminal program inside it opens either, from the same store. An older `opencode` on the PATH may not: 1.19.5 says "Session not found" for what the app holds.
    macApp:{ names:["OpenCode"], bundle:"ai.opencode.desktop", from:"2.2.5" },
    appProgram:"Contents/Resources/opencode-cli",
    // While its app is open, that is where you work, so the app comes forward instead of a terminal, on whatever it was showing.
    forwardWhenOpen:true,
    terminal:(id, program = "opencode") => `${program} --session ${id}`,
    // A quick answer (the Ask tab). Without --auto a permission it would ask for is turned down, and it keeps the conversation, so it runs outside the project's folders.
    // Claude Code's own instructions are left out: what they send it to read, outside that folder, would be turned down and end the turn with no answer.
    // Passing --dir ensures OpenCode binds the session to the isolated cwd rather than an inherited PWD from the server process.
    // OpenCode 2 has no --dir and works in the folder it is started in.
    answer(launch, { model, effort, resume, env = process.env } = {}) { return { command:launch.command, args:[...launch.prefixArgs, ...openCodeRun(launch, env, { model, effort, resume, older:["--pure"] })], env:{ OPENCODE_DISABLE_CLAUDE_CODE:"1", OPENCODE_DISABLE_AUTOUPDATE:"1" }, dialect:"opencode", keeps:true, resumes:true, ...(openCode2(launch, env) ? {} : { dirFlag:"--dir" }) }; },
  },
  pi:{
    name:"Pi", mono:"Pi", color:"#0f766e", role:"Build",
    cli:"pi", envVar:"PI_CLI_PATH", install:process.platform === "win32" ? "irm https://pi.dev/install.ps1 | iex" : "curl -fsSL https://pi.dev/install.sh | sh", extraFolders:[".local/bin", ".pi/agent/bin", "AppData/Roaming/npm"],
    resolve(env) { return findCli(env, this.envVar, this.cli, this.extraFolders); },
    // `--model` takes provider/id, as its settings list them. RPC mode supports live mid-run steer, follow-up prompts, and extension_ui_request answering.
    command(launch, { workdir, resume, model, effort }) { return { command:launch.command, args:[...launch.prefixArgs, "--mode", "rpc", ...(model ? ["--model", model] : []), ...(effort ? ["--thinking", effort] : []), ...(resume ? ["--session", resume] : [])], cwd:workdir, stdin:true, input:"pi-rpc", dialect:"pi", steerMode:"live" }; },
    terminal:id => `pi --session ${id}`,
    classify(launch) { return { command:launch.command, args:[...launch.prefixArgs, "-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files"] }; },
    answer(launch, { model, effort }) { return { command:launch.command, args:[...launch.prefixArgs, "-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files", ...(model ? ["--model", model] : []), ...(effort ? ["--thinking", effort] : [])] }; },
    // Its JSON lines say each step as it goes, for the review's panel.
    review(launch, { model, effort }) { return { command:launch.command, args:[...launch.prefixArgs, "-p", "--mode", "json", "--no-session", "--tools", "read,grep,find,ls", "--no-extensions", "--no-skills", "--no-context-files", ...(model ? ["--model", model] : []), ...(effort ? ["--thinking", effort] : [])], dialect:"pi" }; },
  },
  // Oh My Pi, a fork of Pi: the same JSON events and the same transcripts, in ~/.omp.
  omp:{
    name:"omp", mono:"Om", color:"#7c3aed", role:"Build",
    cli:"omp", envVar:"OMP_CLI_PATH", install:process.platform === "win32" ? "irm https://omp.sh/install.ps1 | iex" : "curl -fsSL https://omp.sh/install | sh", extraFolders:[".local/bin", ".bun/bin", "AppData/Local/omp"],
    resolve(env) { return findCli(env, this.envVar, this.cli, this.extraFolders); },
    // Unlike Pi, omp asks before running tools, and nobody is there to answer, so --auto-approve is used. `--mode rpc-ui` enables live steer and extension_ui_request answering.
    // `--model` takes provider/id as its models.yml lists them, and `--thinking` a level (read in its own help).
    command(launch, { workdir, resume, model, effort }) { return { command:launch.command, args:[...launch.prefixArgs, "--mode", "rpc-ui", "--auto-approve", ...(model ? ["--model", model] : []), ...(effort ? ["--thinking", effort] : []), ...(resume ? ["--resume", resume] : [])], cwd:workdir, stdin:true, input:"pi-rpc", dialect:"pi", steerMode:"live" }; },
    terminal:id => `omp --resume ${id}`,
    classify(launch) { return { command:launch.command, args:[...launch.prefixArgs, "-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files", "--no-title"] }; },
    answer(launch, { model, effort }) { return { command:launch.command, args:[...launch.prefixArgs, "-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files", "--no-title", ...(model ? ["--model", model] : []), ...(effort ? ["--thinking", effort] : [])] }; },
    // Only tools that read are offered, so approving them all changes nothing.
    review(launch, { model, effort }) { return { command:launch.command, args:[...launch.prefixArgs, "-p", "--mode=json", "--no-session", "--tools=read,grep,glob", "--auto-approve", "--no-extensions", "--no-skills", "--no-context-files", "--no-title", ...(model ? ["--model", model] : []), ...(effort ? ["--thinking", effort] : [])], dialect:"pi" }; },
  },
  dsh:{
    name:"dsh", mono:"Ds", color:"#3457c9", role:"Build",
    cli:"dsh", envVar:"DSH_CLI_PATH", install:"npm install -g @deepseek-ai/dsh@latest", extraFolders:[".local/bin", "AppData/Roaming/npm", "AppData/Local/deepseek-harness/bin"], installFrom:"the DeepSeek Harness app",
    // DeepSeek Harness's own app carries the command, so dsh counts as here even with nothing on the PATH.
    // When multiple dsh binaries exist (for example an older 0.2.1 from DeepSeek Harness on PATH plus a newly updated 0.2.2+ from npm),
    // prefer the first one supporting 0.2.2+ headless flags unless DSH_CLI_PATH pins a specific binary.
    resolve(env, paths = {}) {
      const candidates = findAllClis(env, this.envVar, this.cli, this.extraFolders);
      if (!env[this.envVar] && paths.fromApps) {
        const app = dshInApp(env);
        if (app && !candidates.some(c => physical(c.command) === physical(app.command))) candidates.push(app);
      }
      if (candidates.length <= 1) return candidates[0] || null;
      return candidates.find(candidate => { const v = dshVersion(candidate, env); return Boolean(v) && dshTakesFolders(v); }) || candidates[0];
    },
    // Full access (dsh's danger-full-access preset with approval-policy never) is the default on 0.2.2+, matching Claude's bypassPermissions.
    // Picking Project folders in Settings restricts writes to the workspace and --add-dir folders via workspace-write.
    // Before 0.2.2 none of those flags exist, so they are omitted and dsh's own defaults hold.
    ahead(launch, env, ask) { askAhead(dshVersions, launch, ["--version"], env, versionIn, ask); },
    command(launch, { workdir, docs, gitDir, also = [], resume, access, env = process.env, model, effort, runtimeDirectory = os.tmpdir() }) {
      const version = dshVersion(launch, env);
      const overrides = { ...launch.env, ...dshSavedKeys(env), ...(env.DSH_HOME ? { DSH_HOME:dshHome(env) } : {}) };
      const probeEnv = { ...env, ...overrides };
      const readSelection = patch => dshSelectionFromDump(launch, probeEnv, workdir, runtimeDirectory, patch);
      const supportedVersion = knownDshVersion(version);
      const plan = dshPlan(env, model, effort, (selection, verify) => {
        if (!verify && supportedVersion) return selection;
        return effort && model?.includes("/") ? null : readSelection();
      });
      if (plan.patch && (plan.verify || !supportedVersion)) {
        const expected = plan.patch.at(-1).config, actual = readSelection(plan.patch);
        if (actual?.provider !== expected.provider || actual.model !== expected.model || expected.reasoningEffort && actual.effort !== expected.reasoningEffort) {
          throw Error("This dsh installation could not apply a headless model selection. Update dsh or choose its default.");
        }
      }
      const folders = [docs, ...(gitDir ? [gitDir] : []), ...also].flatMap(folder => ["--add-dir", physical(folder)]);
      const sandboxed = access === "folders";
      const policy = !dshTakesFolders(version) ? [] : sandboxed ? ["--permission-mode", "workspace-write", "--approval-policy", "never", ...folders] : ["--permission-mode", "danger-full-access", "--approval-policy", "never"];
      return { command:launch.command, args:[...launch.prefixArgs, "--profile", "headless", "--json", ...(resume ? ["--session-id", resume] : []), ...policy], cwd:workdir, stdin:true,
        env:overrides, dialect:"dsh", steerMode:"interrupt-resume", sandboxWindowsPath:sandboxed, dshSelection:plan.selection, ...(plan.patch ? { dshPatch:plan.patch } : {}) };
    },
    // dsh's web app lists a folder's conversations. It ships no terminal app, and has no way to open one conversation by name.
    terminal:() => "dsh web",
    // Its desktop app takes only dsh://open, which brings it forward with its own conversations listed. It needs no dsh on the PATH.
    macApp:{ names:["DeepSeek Harness"], bundle:"com.deepseek.dsh", from:"0.2" },
    appLink:"dsh://open",
  },
  kimi:{
    name:"Kimi", mono:"Ki", color:"#16181d", role:"Build", desktopName:"Kimi",
    cli:"kimi", envVar:"KIMI_CLI_PATH", install:process.platform === "win32" ? "irm https://code.kimi.com/kimi-code/install.ps1 | iex" : "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash", installFrom:"Kimi Code",
    // Kimi Code on the command line: user's ~/.kimi-code/bin or PenEcho's managed tools/kimi/bin.
    resolve:(env, paths) => { const home = env.HOME || env.USERPROFILE; return firstLaunch(file => resolveKimiLaunch(file, env), [env.KIMI_CLI_PATH, "kimi", ...(home ? [path.join(home, ".kimi-code", "bin", process.platform === "win32" ? "kimi.exe" : "kimi")] : []), managed("kimi-cli", paths)].filter(Boolean)); },
    // With --prompt Kimi approves its own tool calls and asks nothing. It reads no words from stdin, so they go last, after --prompt.
    command(launch, { workdir, docs, gitDir, also = [], resume, model, effort }) {
      const folders = [docs, ...(gitDir ? [gitDir] : []), ...also].flatMap(folder => ["--add-dir", folder]);
      // Kimi Code takes its reasoning level from the environment, as PenEcho's Canvas connection to it does.
      return { command:launch.command, args:[...launch.prefixArgs, ...(resume ? ["--session", resume] : []), ...(model ? ["--model", model] : []), ...folders, "--output-format", "stream-json", "--prompt"], cwd:workdir, promptLast:true, env:{ KIMI_CODE_NO_AUTO_UPDATE:"1", ...(effort ? { KIMI_MODEL_THINKING_EFFORT:effort } : {}) }, dialect:"kimi", steerMode:"interrupt-resume" };
    },
    // Either one installed is enough, and the desktop app comes first. Its links open no conversation and no folder: kimi-work://share and kimi-work://plugin-detail have pages of their own,
    // and any other kimi-work:// link brings Kimi forward on its Kimi Work page (read in 3.2.25). It runs Kimi Code inside, but ships no kimi command, so only the command line runs in the background.
    macApp:{ names:["Kimi"], bundle:"com.moonshot.kimichat", from:"3.2" },
    appCounts:true, appFirst:true, appLink:"kimi-work://home",
    // The desktop app keeps its own conversations. One had on the command line opens there again, in a terminal.
    appHolds:id => inDesktop(id),
    cliTerminal:true,
    terminal:(id, program = "kimi") => (id && !inDesktop(id) ? `${program} --session ${id}` : ""),
    // A quick answer (the Ask tab). --prompt cannot be had with --plan, and it keeps the conversation, so it runs outside the project's folders, with nothing there to change.
    answer(launch, { model, effort, resume } = {}) { return { command:launch.command, args:[...launch.prefixArgs, ...(resume ? ["--session", resume] : []), ...(model ? ["--model", model] : []), "--output-format", "stream-json", "--prompt"], promptLast:true, env:{ KIMI_CODE_NO_AUTO_UPDATE:"1", ...(effort ? { KIMI_MODEL_THINKING_EFFORT:effort } : {}) }, dialect:"kimi", keeps:true, resumes:true }; },
  },
  // Google's Antigravity: the agy command runs in the background, and its desktop app is where you paste.
  antigravity:{
    name:"Antigravity", mono:"Ag", color:"#1a73e8", role:"Build", desktopName:"Antigravity",
    cli:"agy", envVar:"AGY_CLI_PATH", install:process.platform === "win32" ? "irm https://antigravity.google/cli/install.ps1 | iex" : "curl -fsSL https://antigravity.google/cli/install.sh | bash", extraFolders:[".local/bin", "AppData/Local/agy/bin"],
    resolve(env) {
      const launch = findCli(env, this.envVar, this.cli, this.extraFolders);
      // On Windows, agy spawns a detached background self-updater without CREATE_NO_WINDOW whenever its check timestamp is missing or stale, popping up a visible Terminal window.
      // agy's updater (auto_updater.go) specifically requires the literal string "true" (not "1").
      return launch ? { ...launch, env:{ ...(launch.env || {}), AGY_CLI_DISABLE_AUTO_UPDATE:"true" } } : null;
    },
    // Its headless mode turns down any tool that needs approval and carries on, so every tool is approved: nobody is there to answer.
    // Words come in as JSON lines on stdin, which it keeps reading until stdin closes, so more can join a turn. `--effort` levels depend on the model.
    command(launch, { workdir, docs, gitDir, also = [], resume, model, effort }) {
      const folders = [docs, ...(gitDir ? [gitDir] : []), ...also].filter(Boolean).flatMap(folder => ["--add-dir", folder]);
      // `agy` fails if a tier-suffixed model (`gemini-4-hydrogen-xhigh`) is passed alongside `--effort`; split to its base model whenever an effort is supplied.
      const tier = effort && model?.match(/^(.*)-(low|medium|high|xhigh|max)$/i);
      const agyModel = tier ? tier[1] : model;
      return { command:launch.command, args:[...launch.prefixArgs, "--input-format", "stream-json", "--output-format", "stream-json", "--dangerously-skip-permissions", ...(resume ? ["--conversation", resume] : []), ...(agyModel ? ["--model", agyModel] : []), ...(effort ? ["--effort", effort] : []), ...folders], cwd:workdir, stdin:true, input:"stream-json", dialect:"antigravity", steerMode:"live" };
    },
    // Its app's antigravity:// links only bring its window forward (read in 2.28), and it lists only its own conversations, not agy's. So the app holds its own conversations and new Asks,
    // and a conversation agy had opens again in a terminal.
    macApp:{ names:["Antigravity"], bundle:"com.google.antigravity", from:"2.0" },
    appCounts:true, appFirst:true,
    appHolds:(id, agentEnv) => antigravityInDesktop(id, agentEnv),
    cliTerminal:true,
    terminal:(id, program = "agy", agentEnv) => (id && !antigravityInDesktop(id, agentEnv) ? `${program} --conversation ${id}` : ""),
    // A quick answer (the Ask tab). Without --dangerously-skip-permissions a tool that needs approval is turned down. Its -p takes the words as its own value, so they go last.
    // It keeps the conversation, so it runs outside the project's folders.
    answer(launch, { model, effort, resume } = {}) {
      const tier = effort && model?.match(/^(.*)-(low|medium|high|xhigh|max)$/i);
      return { command:launch.command, args:[...launch.prefixArgs, "--output-format", "stream-json", "--disable-slash-commands", ...(resume ? ["--conversation", resume] : []), ...((tier ? tier[1] : model) ? ["--model", tier ? tier[1] : model] : []), ...(effort ? ["--effort", effort] : []), "-p"], promptLast:true, dialect:"antigravity", keeps:true, resumes:true };
    },
  },
  // Tencent's WorkBuddy runs CodeBuddy Code inside its app, which it starts itself and ships no command for, so nothing runs in the background: its app is where you paste.
  // No link of its is known to open a conversation or a folder (its workbuddy:// links are for connector sign-ins, read in 5.2.6), so the app is brought forward and you pick there.
  workbuddy:{
    name:"WorkBuddy", mono:"Wb", color:"#0052d9", role:"Build", desktopName:"WorkBuddy", installFrom:"workbuddy.ai",
    resolve:() => null,
    // 5.9.3 from workbuddy.ai is com.tencent.workbuddy.mac.
    macApp:{ names:["WorkBuddy"], bundle:["com.tencent.workbuddy.mac", "com.workbuddy.workbuddy"], from:"5.2" },
    windowsApp:{ names:["WorkBuddy"], from:"5.2" },
    appCounts:true, appFirst:true, hidden:() => WORKBUDDY.hidden,
  },
  // PenEcho's own agent, which needs nothing installed. It is here once this computer is signed in to PenEcho Cloud, whose models are paid with credits.
  // It comes last, so an agent you installed yourself stays the first choice.
  penecho:{
    name:"PenEcho", mono:"Pe", color:"#2563eb", role:"Build", builtIn:true,
    resolve(env, paths = {}) {
      const source = paths.penecho;
      if (!source?.ready()) return null;
      const state = paths.stateDir || path.join(paths.home || env.HOME || env.USERPROFILE || os.homedir(), ".penecho");
      // Inside the desktop app, the program that runs PenEcho is the app itself, told to act as Node.
      return { command:process.execPath, prefixArgs:[PENECHO_RUNNER], source, sessions:path.join(state, "project-lines", "penecho-sessions"), ...electronNodeEnv() };
    },
    // It prints what Claude Code prints and reads its words the same way, so the thread, words said while it works and Stop need nothing of their own.
    // Its files are kept to the folders named here and its commands to the list unattended Claude runs get, plus the project's memory command.
    // The model is reached through PenEcho's own proxy with a secret made for this run. No key and no account token is handed over:
    // whatever in PenEcho's own environment is named like one is blanked for it, the first AI connection's key among them.
    command(launch, { workdir, docs, also = [], gitDir = "", resume, exactResume, instructions, model, effort, env = process.env }) {
      const run = launch.source.open({ pick:model, effort });
      if (!run) return null;
      const blank = Object.fromEntries(Object.keys(env).filter(name => SECRET_NAME.test(name)).map(name => [name, ""]));
      const folders = [...(docs ? ["--docs", docs] : []), ...also.flatMap(folder => ["--add-dir", folder]), ...(gitDir ? ["--git-dir", gitDir] : [])];
      return { command:launch.command, args:[...launch.prefixArgs, ...(resume ? ["--resume", resume] : []), ...(exactResume ? ["--require-session"] : []), "--sessions", launch.sessions, ...folders, ...(docs ? ["--allow-command", Memory.commandFor(docs)] : []), ...(instructions ? ["--instructions", instructions] : [])],
        cwd:workdir, stdin:true, input:"stream-json", ownInstructions:true, steerMode:"live", proxyRun:run.id, env:{ ...blank, ...launch.env, PENECHO_MODEL_PROXY_URL:run.url, PENECHO_MODEL_PROXY_SECRET:run.secret, ...(run.endpointFile ? { PENECHO_MODEL_PROXY_ENDPOINT:run.endpointFile } : {}), ...(run.proxyToken ? { PENECHO_MODEL_PROXY_TOKEN:run.proxyToken } : {}), ...(run.instanceId ? { PENECHO_MODEL_PROXY_INSTANCE:run.instanceId } : {}) } };
    },
  },
};
const PENECHO_RUNNER = path.join(__dirname, "penecho-runner.mjs");
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|^PENECHO_ORCH/i;
// A stand-in used only by the test suite: it never appears unless this variable names a script.
function testAdapter(env, second = false) {
  const script = second ? env.PENECHO_LINES_TEST_AGENT_TWO : env.PENECHO_LINES_TEST_AGENT;
  if (!script) return null;
  return {
    name:second ? "Second test agent" : "Test agent", mono:second ? "T2" : "Ts", color:second ? "#b4532a" : "#3457c9", role:"Build",
    resolve:() => ({ command:process.execPath, prefixArgs:[path.resolve(script)], ...electronNodeEnv() }),
    command:(launch, { workdir, resume }) => ({ command:launch.command, args:[...launch.prefixArgs, ...(resume ? [`--resume=${resume}`] : [])], cwd:workdir, stdin:true }),
    terminal:id => `test-agent --resume ${id}`,
    answer:launch => ({ command:launch.command, args:[...launch.prefixArgs, "--answer"] }),
  };
}
function createAgents(options = {}) {
  const platform = options.platform || process.platform, windowsAppFinder = options.windowsAppFinder || findWindowsWorkBuddy;
  const { env = process.env, extra = {}, paths = {}, appFolders = ["/Applications", path.join(env.HOME || os.homedir(), "Applications")], isRunning = env === process.env ? runningOnMac : () => false } = options;
  // A second stand-in, so a test can give parts of one plan to two agents (N6).
  const test = testAdapter(env), second = testAdapter(env, true), all = { ...ADAPTERS, ...(test ? { tester:test } : {}), ...(second ? { tester2:second } : {}), ...extra };
  // Only the real server looks inside installed apps for a command. A list made for a test, with its own environment, never does unless explicitly requested.
  const fromApps = typeof options.fromApps === "boolean" ? options.fromApps : env === process.env;
  // Listing and running look in the same places, so an agent shown as here can also run: dsh from inside its app, say.
  const where = { ...paths, fromApps, platform, ...(Array.isArray(options.appFolders) ? { appFolders } : {}), onAppFound:() => { cached = null; found.delete("codex"); } };
  // Pre-warm Windows Codex app discovery asynchronously so app-only Windows users do not wait for a second poll.
  if (fromApps && platform === "win32" && env.NODE_ENV !== "test") {
    try { findCodexInApp(env, { platform, onFound:where.onAppFound }); } catch {}
  }
  // An agent whose app alone is enough counts the app only for the real server, as dsh's does, or for a test that names its own app folders.
  const countApps = (fromApps && env.NODE_ENV !== "test") || Array.isArray(options.appFolders) || typeof options.windowsAppFinder === "function";
  let cached = null, cachedAt = 0;
  // The model PenEcho runs an agent with, picked on Agent setup from those its own settings name. None picked is the agent's own default.
  // It is kept in PenEcho's own state, never in the agent's settings, so the agent's app goes on using its own.
  let picked = {}, pickedFile = "";
  function useModelFile(file) {
    pickedFile = file;
    try { const read = JSON.parse(fs.readFileSync(file, "utf8")); picked = read && typeof read === "object" && !Array.isArray(read) ? read : {}; } catch { picked = {}; }
  }
  // Each agent's pick is { model, effort }, either one left out for the agent's own. An older file kept the model alone.
  const pickOf = id => (typeof picked[id] === "string" ? { model:picked[id] } : picked[id] && typeof picked[id] === "object" ? picked[id] : {});
  const modelFor = id => (typeof pickOf(id).model === "string" ? pickOf(id).model : "");
  const effortFor = id => (typeof pickOf(id).effort === "string" ? pickOf(id).effort : "");
  const configuredModel = id => {
    if (id !== "dsh") return modelOf(id, env, id === "penecho" ? where.penecho : null)?.name || "";
    const plan = dshPlan(env, "", "");
    return plan.verify ? "" : plan.selection?.model || "";
  };
  // An agent that works its models' levels out itself (`levels` above) is asked for its own list, now and then, since asking starts it.
  // Only the real server asks: a test's agents are not real ones, unless the test brings its own way to run them.
  const run = options.run || (fromApps && env.NODE_ENV !== "test" ? runCommand : null), listed = new Map();
  const runAhead = options.runAhead || (fromApps && env.NODE_ENV !== "test" ? runCommand : null);
  function listLevels(id, { fresh = false } = {}) {
    const adapter = all[id], known = listed.get(id);
    if (!adapter?.levels || !run) return Promise.resolve(null);
    if (known && !fresh && Date.now() - known.at < 30000) return known.reading;
    const launch = launchOf(id);
    if (!launch || launch.app) return Promise.resolve(null);
    const { command:cmd, args, parse } = adapter.levels(launch);
    // A list that could not be read leaves the last one standing.
    const entry = { at:Date.now(), effortsFor:known?.effortsFor || null, reading:null };
    entry.reading = Promise.resolve().then(() => run(cmd, args, { env:prepareAgentEnv(env, launch.env, { platform }), timeout:20000, maxBuffer:16 * 1024 * 1024 }))
      .then(answer => { const read = answer?.status === 0 ? parse(answer.stdout) : null; if (read) entry.effortsFor = read; return entry.effortsFor; }, () => entry.effortsFor);
    listed.set(id, entry);
    return entry.reading;
  }
  // While PenEcho updates an agent (agent-check.js), a Work of it starts after the update, or after a minute, whichever is first.
  const updating = new Map();
  function setUpdating(id, job) {
    const done = job.then(() => {}, () => {}).then(() => { if (updating.get(id) === done) updating.delete(id); });
    updating.set(id, done);
  }
  async function whenUpdated(id) {
    const job = updating.get(id);
    if (!job) return;
    let timer;
    await Promise.race([job, new Promise(resolve => { timer = setTimeout(resolve, 60000); })]);
    clearTimeout(timer);
  }
  // What is known of an agent's models: what its settings say, and over that what it last listed itself.
  const aboutOf = id => {
    const about = modelOf(id, env, id === "penecho" ? where.penecho : null), known = listed.get(id)?.effortsFor;
    return about && known ? { ...about, effortsFor:{ ...about.effortsFor, ...known } } : about;
  };
  // A level its model is known not to take is never handed over. Pi and omp would quietly run at another level, OpenCode with none, and Kimi Code with none
  // or with a level its settings do not give the model, while PenEcho went on showing the one picked. Known means these agents' own word on that very model;
  // a model they say nothing of gets what was picked.
  // The others are left alone: Codex reports the level it ran at, dsh is checked where its command is made, and agy turns a wrong level down itself.
  const SAYS_LEVELS = new Set(["opencode", "pi", "omp", "kimi"]);
  function refusal(id, model, effort) {
    if (!effort || !SAYS_LEVELS.has(id)) return "";
    let about = null;
    try { about = aboutOf(id); } catch { return ""; }
    const name = model || about?.name || "", levels = name && Object.hasOwn(about?.effortsFor || {}, name) ? about.effortsFor[name] : null;
    if (!levels || levels.includes(effort)) return "";
    return `${name} does not take the reasoning level ${effort}. It takes ${levels.length ? levels.join(", ") : `none${about.whyNone?.[name] ? `: ${about.whyNone[name]}` : ""}`}.`;
  }
  function sure(id, model, effort) {
    const why = refusal(id, model, effort);
    if (why) throw Object.assign(Error(why), { code:"BAD_EFFORT", status:409 });
  }
  // The effort the agent's own settings give a run with `model` (its own model when empty), so a Work left on Default is still rated.
  // dsh's default effort belongs to its default model alone. The others say theirs in their settings, some of them model by model (defaultEffortWith).
  const configuredEffort = (id, model = "") => {
    try {
      if (id !== "dsh") return defaultEffortWith(model, aboutOf(id));
      const plan = dshPlan(env, "", ""), d = plan.verify ? null : plan.selection;
      return d && (!model || model === d.model || model === `${d.provider}/${d.model}`) ? d.effort || "" : "";
    } catch { return ""; }
  };
  function pickModel(id, model, effort = effortFor(id)) {
    if (!all[id]) return false;
    const next = { ...(String(model || "").trim() ? { model:String(model).trim() } : {}), ...(String(effort || "").trim() ? { effort:String(effort).trim() } : {}) };
    if (Object.keys(next).length) picked[id] = next; else delete picked[id];
    if (pickedFile) { fs.mkdirSync(path.dirname(pickedFile), { recursive:true }); fs.writeFileSync(pickedFile, `${JSON.stringify(picked, null, 2)}\n`); }
    return true;
  }
  // Asked for every line on every refresh, so it is looked up only now and then.
  const apps = new Map();
  const isHidden = id => Boolean(all[id]?.hidden?.());
  const appDefinition = id => isHidden(id) ? null : platform === "win32" ? all[id]?.windowsApp : all[id]?.macApp;
  function appReady(id, floor = "from") {
    const definition = appDefinition(id);
    if (!definition) return true;
    let known = apps.get(id);
    if (!known || Date.now() - known.at > 30000) {
      known = { at:Date.now(), ...(platform === "win32" ? windowsAppFinder(env) : findMacApp(definition, appFolders)) };
      apps.set(id, known);
    }
    return Boolean(known.path) && (!known.version || atLeast(known.version, definition[floor] || "0"));
  }
  // The terminal program inside an agent's app, the one that knows what that app holds.
  function appProgram(id) {
    const adapter = all[id];
    if (!adapter?.appProgram || platform !== "darwin" || !appReady(id)) return "";
    const file = path.join(apps.get(id).path, adapter.appProgram);
    return isFile(file) ? shellWord(file) : "";
  }
  // The agent's own command line, as a terminal would run it, for an agent whose conversations its command line opens again.
  function cliProgram(id) {
    const adapter = all[id];
    if (!adapter?.cliTerminal || platform !== "darwin") return "";
    const launch = launchOf(id);
    return launch ? [launch.command, ...launch.prefixArgs].map(shellWord).join(" ") : "";
  }
  function available() {
    if (cached && Date.now() - cachedAt < 30000) return cached;
    cached = Object.entries(all).filter(([id]) => !isHidden(id)).map(([id, adapter]) => {
      let launch = null;
      try { launch = adapter.resolve(env, where); } catch { launch = null; }
      // Its desktop app alone is enough: it is where you paste. Only a run in the background needs the command line.
      if (launch && runAhead) adapter.ahead?.(launch, env, runAhead);
      if (!launch && adapter.appCounts && countApps && ["darwin", "win32"].includes(platform) && appDefinition(id) && appReady(id)) launch = { app:true };
      return { id, name:adapter.name, mono:adapter.mono, color:adapter.color, role:adapter.role, available:Boolean(launch), runs:Boolean(launch && !launch.app), app:launch && adapter.desktop && platform === "darwin" ? adapter.desktopName || adapter.name : "", opens:Boolean(launch && (appProgram(id) || cliProgram(id) || (adapter.appFirst && openApp(id)) || (adapter.desktopNew && platform === "darwin" && appReady(id) && appReady(id, "newFrom")))), ...(adapter.appProgram || adapter.appFirst ? { opensIn:launch && openApp(id) ? "app" : "Terminal" } : {}) };
    });
    cachedAt = Date.now();
    return cached;
  }
  function command(id, options) {
    const adapter = all[id];
    if (!adapter) return null;
    const launch = adapter.resolve(env, where);
    if (!launch) return null;
    const given = { env, model:modelFor(id), effort:effortFor(id), ...options };
    sure(id, given.model, given.effort);
    return withLaunchEnv(launch, adapter.command(launch, given), adapter, platform);
  }
  // Credits, for an agent paid with them (PenEcho's own on Cloud models): Cloud's 402 answer before a run, or the one a run got.
  async function creditsRefusal(id) { return id === "penecho" && where.penecho?.preflight ? where.penecho.preflight(modelFor(id)) : null; }
  function endRun(id, proxyRun) { return id === "penecho" && proxyRun && where.penecho?.end ? Boolean(where.penecho.end(proxyRun)) : true; }
  // Each model call of a PenEcho run that is about to be tried again: fn(proxyRun, { attempt, of, why, waitMs }).
  function onModelRetry(fn) { return where.penecho?.onRetry ? where.penecho.onRetry(fn) : () => {}; }
  function creditsRefused(id, proxyRun) { return id === "penecho" && proxyRun && where.penecho?.refused ? where.penecho.refused(proxyRun) : null; }
  function clearCreditsRefusal(id, proxyRun) { return id === "penecho" && proxyRun && where.penecho?.clearRefusal ? Boolean(where.penecho.clearRefusal(proxyRun)) : true; }
  // Where an agent's command is, for the links that open its app. Asked for every conversation of every line when a project's state is made,
  // and finding it reads every folder on the PATH, so it is looked up only now and then, as the apps are (PE-460).
  const found = new Map();
  function resolvedOf(id) {
    let known = found.get(id);
    if (!known || Date.now() - known.at > 30000) {
      let launch = null;
      try { launch = all[id].resolve(env, where); } catch { launch = null; }
      known = { at:Date.now(), launch };
      found.set(id, known);
    }
    return known.launch;
  }
  function hasResumeSession(agent, id) {
    // Other runners own their storage and report resume errors themselves.
    if (agent !== "penecho") return undefined;
    const sessions = resolvedOf(agent)?.sessions;
    if (!sessions || !/^[0-9a-f-]{36}$/i.test(id)) return false;
    try { return fs.statSync(path.join(sessions, `${id}.json`)).isFile(); } catch { return false; }
  }
  function desktop(id, session) {
    const adapter = all[id];
    if (!adapter?.desktop || !appReady(id)) return null;
    const launch = resolvedOf(id);
    return launch ? adapter.desktop(launch, session) : null;
  }
  function desktopNew(id, folder) {
    const adapter = all[id];
    if (!adapter?.desktopNew || !appReady(id) || !appReady(id, "newFrom")) return null;
    const launch = resolvedOf(id);
    return launch ? adapter.desktopNew(launch, folder) : null;
  }
  // An agent's app that takes no link to a conversation: OpenCode's while it is open, Kimi's, Antigravity's and WorkBuddy's whenever they are installed. It comes forward on whatever it was showing, so you pick the conversation there.
  // A conversation that app does not hold is not opened there.
  function openApp(id, session = "") {
    const adapter = all[id];
    if (!(adapter?.forwardWhenOpen || adapter?.appFirst) || !appDefinition(id) || !appReady(id)) return null;
    if (platform === "win32") return countApps && adapter.windowsApp ? { command:apps.get(id).path, args:[], app:adapter.name, picks:true, detached:true } : null;
    if (platform !== "darwin") return null;
    if ((session && adapter.appHolds && !adapter.appHolds(session, env)) || (adapter.appFirst ? !countApps : !isRunning(adapter.macApp.bundle))) return null;
    const app = adapter.macApp.names[0];
    return adapter.appLink ? { ...openLink(adapter.appLink), app, picks:true } : { command:"open", args:["-a", apps.get(id).path], app, picks:true };
  }
  // An app that can only be brought forward, not sent to one conversation. Never used where landing in the right conversation matters. One with no link of its own, as WorkBuddy, is opened by name.
  function appOnly(id, session = "") {
    const adapter = all[id];
    if (!(adapter?.appLink || adapter?.appFirst) || !appDefinition(id) || !appReady(id) || (adapter.appCounts && !countApps)) return null;
    if (platform === "win32") return adapter.windowsApp ? { command:apps.get(id).path, args:[], app:adapter.name, detached:true } : null;
    if (platform !== "darwin") return null;
    if (session && adapter.appHolds && !adapter.appHolds(session, env)) return null;
    return { ...(adapter.appLink ? openLink(adapter.appLink) : { command:"open", args:["-a", apps.get(id).path] }), app:adapter.macApp.names[0] };
  }
  function launchOf(id) { try { return all[id]?.resolve(env, where) || null; } catch { return null; } }
  // How to pick a conversation up yourself, for an agent with no desktop app to open.
  function terminal(id, session) { return all[id]?.terminal?.(session, appProgram(id) || undefined, env) || ""; }
  // What to run in a terminal window to open a conversation, or with none to start a new one in that folder.
  function terminalLine(id, session = "") { const program = appProgram(id) || cliProgram(id); return !program ? "" : session ? all[id].terminal(shellWord(session), program, env) || "" : program; }
  const nameOf = id => all[id]?.desktopName || all[id]?.name || id;
  // The small, cheap question of which Topic a message belongs to goes to whichever agent is here.
  function classifier() {
    for (const id of Object.keys(all)) {
      if (!all[id].classify) continue;
      let launch = null;
      try { launch = all[id].resolve(env, where); } catch { /* Not installed here, so another agent is asked. */ }
      if (launch) return withLaunchEnv(launch, all[id].classify(launch), all[id], platform);
    }
    return null;
  }
  // Ask tab: the one-off command that answers a question about the project with this agent, or null when it has no such mode.
  const canAnswer = id => Boolean(all[id]?.answer);
  function answerer(id, { model = "", effort = "", resume = "" } = {}) {
    if (!all[id]?.answer) return null;
    const launch = launchOf(id);
    if (!launch || launch.app) return null;
    sure(id, model, effort);
    return withLaunchEnv(launch, all[id].answer(launch, { model, effort, resume, env }), all[id], platform);
  }
  // The orchestrator's reviewer: the command that reads the code folder itself (tools:true), else the plain answer with what PenEcho hands it.
  // Simple no-edit tasks pass noTools:true to run a single fast no-tool turn without launching workspace tools.
  const canReviewWithTools = id => Boolean(all[id]?.review);
  function reviewer(id, { model = "", effort = "", dirs = [], resume = "", noTools = false } = {}) {
    if (noTools) return answerer(id, { model, effort, resume });
    const launch = all[id]?.review && launchOf(id);
    if (!launch || launch.app) return answerer(id, { model, effort, resume });
    sure(id, model, effort);
    return { ...withLaunchEnv(launch, all[id].review(launch, { model, effort, dirs, resume }), all[id], platform), tools:true };
  }
  // The conversations of this agent some process holds now, or null when the agent cannot say. Only the real server asks: a test's agents are not real ones.
  let openCache = null;
  function openNow(id) {
    const adapter = all[id];
    if (!adapter?.openNow || !fromApps || env.NODE_ENV === "test") return Promise.resolve(null);
    if (openCache && openCache.id === id && Date.now() - openCache.at < 3000) return openCache.list;
    const launch = launchOf(id);
    if (!launch) return Promise.resolve(null);
    const { command:cmd, args, env:cmdEnv } = withLaunchEnv(launch, adapter.openNow(launch));
    const list = new Promise(resolve => {
      const childEnv = prepareAgentEnv(env, cmdEnv, { platform }); delete childEnv.CLAUDE_CODE_ENTRYPOINT; delete childEnv.CLAUDECODE;
      execFile(cmd, args, { encoding:"utf8", timeout:5000, maxBuffer:4 * 1024 * 1024, env:childEnv, windowsHide:true }, (error, stdout) => {
        if (error) return resolve(null);
        try { const rows = JSON.parse(stdout); resolve(Array.isArray(rows) ? new Set(rows.filter(r => r?.pid && r.sessionId).map(r => r.sessionId)) : null); } catch { resolve(null); }
      });
    });
    openCache = { id, at:Date.now(), list };
    return list;
  }
  // What the Agent setup page checks: the command PenEcho would run, the setting that names one, how to install it and how to sign in, and the agent's app.
  function describe() {
    return Object.entries(all).filter(([id]) => !isHidden(id)).map(([id, adapter]) => {
      const definition = appDefinition(id), app = definition && ["darwin", "win32"].includes(platform) && (appReady(id), apps.get(id));
      return {
        id, name:adapter.name, mono:adapter.mono, color:adapter.color, launch:launchOf(id), cli:adapter.cli || "", envVar:adapter.envVar || "", configured:adapter.envVar ? String(env[adapter.envVar] || "").trim() : "",
        install:adapter.install || "", installFrom:adapter.installFrom || "", builtIn:Boolean(adapter.builtIn), signIn:adapter.signIn || null, extraFolders:adapter.extraFolders || [], picked:modelFor(id), pickedEffort:effortFor(id), access:accessOf(id),
        app:app?.path ? { name:definition.names[0], version:app.version || "", path:app.path, ok:!app.version || atLeast(app.version, definition.from || "0"), opensNew:!app.version || atLeast(app.version, definition.newFrom || "0"), enough:Boolean(adapter.appCounts && countApps) } : null,
      };
    });
  }
  return { available, setUpdating, whenUpdated, command, hasResumeSession, creditsRefusal, creditsRefused, clearCreditsRefusal, endRun, onModelRetry, desktop, desktopNew, openApp, appOnly, terminal, terminalLine, nameOf, launch:launchOf, classifier, canAnswer, canReviewWithTools, answerer, reviewer, openNow, describe, useModelFile, pickModel, modelFor, effortFor, configuredModel, configuredEffort, listLevels, refusal, env, reset() { cached = null; apps.clear(); found.clear(); listed.clear(); openCache = null; dshVersions.clear(); claudeModes.clear(); } };
}

module.exports = { createAgents, dshInApp, dshSavedKeys, dshTakesFolders, fromFolder, accessOf };
