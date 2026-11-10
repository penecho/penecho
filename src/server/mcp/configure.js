"use strict";

const { execFile } = require("node:child_process");
const os = require("node:os");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { cliCandidates } = require("../../providers/cli-discovery.js");
const { resolveCodexLaunch } = require("../../providers/codex-cli.js");
const { resolveClaudeLaunch } = require("../../providers/claude-cli.js");
const { McpBridgeError } = require("./schema.js");

const MAX_OUTPUT_BYTES = 64 * 1024;
const CONFIGURE_TIMEOUT_MS = 20_000;
const CLIENT_INSPECTION_TIMEOUT_MS = 1_000;
const MAX_INSPECTION_CANDIDATES = 2;

// Electron can read inside ASAR archives, but the OS cannot use one as cwd.
function subprocessDirectory(rootDirectory) {
  if (typeof rootDirectory !== "string") return rootDirectory;
  const archive = /(?:^|[\\/])[^\\/]+\.asar(?=[\\/]|$)/i.exec(rootDirectory);
  if (!archive) return rootDirectory;
  const paths = rootDirectory.includes("\\") || /^[A-Za-z]:/.test(rootDirectory) ? path.win32 : path.posix;
  return paths.dirname(rootDirectory.slice(0, archive.index + archive[0].length));
}

function configurationArguments(client, launch) {
  const envArgs = Object.entries(launch.env || {}).flatMap(([name, value]) => ["--env", `${name}=${value}`]);
  if (client === "codex") return ["mcp", "add", ...envArgs, "penecho", "--", launch.command, ...launch.args];
  if (client === "claude") return ["mcp", "add", "--transport", "stdio", "--scope", "user", "penecho", ...envArgs, "--", launch.command, ...launch.args];
  throw new McpBridgeError("invalid_client", "Choose Codex or Claude.", 400);
}

function executeFile(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    // Resolve npm shell wrappers to their native/Node entry point, keeping every
    // MCP argument literal instead of passing configuration through a shell.
    const launch = (options.client === "codex" ? resolveCodexLaunch : resolveClaudeLaunch)(executable, options.env);
    const env = launch.command === process.execPath && launch.prefixArgs.length
      ? { ...options.env, ELECTRON_RUN_AS_NODE:"1" }
      : options.env;
    execFile(launch.command, [...launch.prefixArgs, ...args], {
      cwd:options.cwd,
      env,
      timeout:options.timeout === undefined ? CONFIGURE_TIMEOUT_MS : options.timeout,
      maxBuffer:MAX_OUTPUT_BYTES,
      windowsHide:true,
    }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }));
  });
}

function boundedInspectionRun(runner, executable, args, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("MCP client inspection timed out."), { code:"ETIMEDOUT" })), timeoutMs);
    Promise.resolve().then(() => runner(executable, args, options)).then(
      result => { clearTimeout(timer); resolve(result); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function inspectConfiguredClients(options = {}) {
  const runner = options.executeFile || executeFile;
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, CLIENT_INSPECTION_TIMEOUT_MS)
    : CLIENT_INSPECTION_TIMEOUT_MS;
  const inspect = async client => {
    const provider = `${client}-cli`;
    const injected = options.candidates && !Array.isArray(options.candidates) ? options.candidates[client] : options.candidates;
    const candidates = (injected || cliCandidates(provider, {
      env:options.env || process.env,
      home:options.home || os.homedir(),
      stateDir:options.stateDirectory,
    })).slice(0, MAX_INSPECTION_CANDIDATES);
    for (const candidate of candidates) {
      try {
        await boundedInspectionRun(runner, candidate.executable, ["mcp", "get", "penecho"], {
          client,
          cwd:subprocessDirectory(options.rootDirectory),
          env:options.env || process.env,
          timeout:timeoutMs,
        }, timeoutMs);
        return client;
      } catch {}
    }
    return null;
  };
  return (await Promise.all(["codex", "claude"].map(inspect))).filter(Boolean);
}

// Claude's `mcp get` merges scopes and health-checks the command. Read the user
// scope directly so a project override cannot be mistaken for the entry to update.
function claudeUserConfig(options) {
  const env=options.env || process.env;
  const home=options.home || (process.platform === "win32" ? env.USERPROFILE || env.HOME : env.HOME) || os.homedir();
  return env.CLAUDE_CONFIG_DIR ? path.resolve(subprocessDirectory(options.rootDirectory) || process.cwd(),env.CLAUDE_CONFIG_DIR,".claude.json") : path.join(home,".claude.json");
}
function replaceClaudeUserEntry(launch, options) {
  const file=claudeUserConfig(options);let before,stat;
  try {stat=fs.lstatSync(file);if(!stat.isFile() || stat.size>8*1024*1024)throw new Error("Claude user configuration is not a supported regular file.");before=fs.readFileSync(file,"utf8");}
  catch(error){if(error.code === "ENOENT")return false;throw error;}
  let config;try{config=JSON.parse(before);}catch{throw new Error("Claude user configuration is invalid JSON. Repair it before retrying.");}
  if(!config || typeof config !== "object" || Array.isArray(config))throw new Error("Claude user configuration is invalid.");
  if(!config.mcpServers || !Object.prototype.hasOwnProperty.call(config.mcpServers,"penecho"))return false;
  if(typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))throw new Error("Claude MCP configuration is invalid.");
  config.mcpServers.penecho={type:"stdio",command:launch.command,args:[...launch.args],env:{...launch.env}};
  const temporary=path.join(path.dirname(file),`.penecho-mcp-${crypto.randomUUID()}.tmp`);let fd;
  try {
    fd=fs.openSync(temporary,"wx",0o600);fs.writeFileSync(fd,JSON.stringify(config,null,2)+"\n");fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    if(fs.readFileSync(file,"utf8")!==before)throw new Error("Claude configuration changed while updating. Try again.");
    fs.renameSync(temporary,file);
  } finally {if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(error){if(error.code!=="ENOENT")throw error;}}
  return true;
}

async function configureClient(client, launch, options = {}) {
  if(launch?.type==="http"||launch?.type==="stdio"){
    try{return require("./http-client-config.js").configureHttpClient(client,launch,options);}
    catch(error){
      const messages={
        MCP_CONFIG_UNSUPPORTED:"The existing client configuration contains syntax PenEcho cannot safely update. Use the setup prompt to update only its PenEcho entry.",
        MCP_CONFIG_SYMLINK:"The client configuration uses a symbolic link. Use the setup prompt to update its intended target safely.",
        MCP_CONFIG_INVALID:"The existing client configuration is invalid. Repair its syntax before retrying automatic configuration.",
        CONFIG_CONFLICT:"The client configuration changed during setup. Check its current PenEcho entry and retry.",
        EACCES:"PenEcho does not have permission to write this client's configuration.",
        EPERM:"PenEcho does not have permission to write this client's configuration.",
        ENOSPC:"There is not enough disk space to save the client configuration.",
        EROFS:"The client configuration is on a read-only filesystem.",
      };
      if(messages[error?.code])return {configured:false,client,code:error.code,error:messages[error.code]};
      throw error;
    }
  }
  const provider = client === "codex" ? "codex-cli" : client === "claude" ? "claude-cli" : "";
  if (!provider) throw new McpBridgeError("invalid_client", "Choose Codex or Claude.", 400);
  const candidates = options.candidates || cliCandidates(provider, {
    env:options.env || process.env,
    home:options.home || os.homedir(),
    stateDir:options.stateDirectory,
  });
  if (!candidates.length) return {
    configured:false,
    client,
    error:`${client === "codex" ? "Codex" : "Claude"} CLI was not found. Install or repair its official CLI, then try again.`,
    command:launch,
  };
  const args = configurationArguments(client, launch), inspectArgs = ["mcp", "get", "penecho"], runner = options.executeFile || executeFile;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      let updated=false;
      if(client === "claude") {
        if(replaceClaudeUserEntry(launch,options))return {configured:true,updated:true,client};
      } else {
        try {await runner(candidate.executable,inspectArgs,{client,cwd:subprocessDirectory(options.rootDirectory),env:options.env || process.env});updated=true;}catch(error){if(!/not (?:configured|found)|no (?:mcp )?server|does not exist/i.test(String(error.stderr || error.stdout || error.message)))throw error;}
      }
      await runner(candidate.executable, args, { client, cwd:subprocessDirectory(options.rootDirectory), env:options.env || process.env });
      return { configured:true, updated, client };
    } catch (error) { lastError = error; }
  }
  const detail = String(lastError?.stderr || lastError?.stdout || lastError?.message || "Configuration failed").trim().slice(0, 800);
  return { configured:false, client, error:detail || "The client could not save the PenEcho MCP configuration.", command:launch };
}

module.exports = {
  CLIENT_INSPECTION_TIMEOUT_MS,
  CONFIGURE_TIMEOUT_MS,
  MAX_INSPECTION_CANDIDATES,
  configurationArguments,
  configureClient,
  inspectConfiguredClients,
};
