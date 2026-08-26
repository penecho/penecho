#!/usr/bin/env node
"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { anthropicEffortParameters, anthropicResponseMaxTokens, normalizedApiEffort, resolveApiConfig } = require("../server/api-config.js");
const { isEventStreamResponse, readProviderEventStream } = require("../server/api-stream.js");
const { apiReasoningParameters, reasoningEffortMapping } = require("../providers/reasoning-effort.js");
const { callCodexCli, resolveCodexLaunch } = require("../providers/codex-cli.js");
const { callClaudeCli, resolveClaudeLaunch } = require("../providers/claude-cli.js");
const { callKimiCli, resolveKimiLaunch } = require("../providers/kimi-cli.js");
const { cliCandidates, cliDefinition } = require("../providers/cli-discovery.js");
const { isPromptExit, runConfigureMenu } = require("./configure-ui.js");
const { maybeUpdateOnStart } = require("./update.js");

const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const PACKAGE_JSON = require("../../package.json");
const DEFAULT_PORT = 3888;
const DEFAULT_TIMEOUT_SECONDS = 180;
const UAT_CLOUD_ORIGIN = "https://internaltest.penecho.ai";
const MAX_COMMAND_OUTPUT = 1024 * 1024;
const REQUIRED_ASSETS = [
  "server.js",
  "src/server/main.js", "src/server/typeset.js", "src/server/api-config.js",
  "src/server/canvas-agent/http.js", "src/server/canvas-agent/protocol.mjs", "src/server/canvas-agent/runtime.mjs",
  "src/cli/update.js", "src/cli/configure-ui.js",
  "src/providers/cli-discovery.js", "src/providers/cli-inspection.js", "src/providers/kimi-cli.js", "src/providers/kimi-acp.js", "src/providers/codex-cli.js", "src/providers/claude-cli.js",
  "public/index.html", "public/access.html", "public/access.css", "public/access.js", "public/app.js", "public/draw.js", "public/selection.js", "public/tour.js", "public/style.css",
];

const PROVIDER_OPTIONS = "api, kimi-cli, codex-cli, or claude-cli";
const CLI_UPGRADE_COMMANDS = Object.freeze({
  "kimi-cli":Object.freeze({ posix:"curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash", win32:"irm https://code.kimi.com/kimi-code/install.ps1 | iex" }),
  "codex-cli":Object.freeze({ posix:"curl -fsSL https://chatgpt.com/codex/install.sh | sh", win32:"irm https://chatgpt.com/codex/install.ps1 | iex" }),
  "claude-cli":Object.freeze({ posix:"curl -fsSL https://claude.ai/install.sh | bash", win32:"irm https://claude.ai/install.ps1 | iex" }),
});
const CLI_LOGIN_COMMANDS = Object.freeze({ "kimi-cli":"kimi login", "codex-cli":"codex login", "claude-cli":"claude auth login" });
const CLI_PREFLIGHT_TIMEOUT_MS = 30000;

function cliUpgradeCommand(provider, platform = process.platform) {
  const commands = CLI_UPGRADE_COMMANDS[provider];
  if (!commands) throw new Error("Choose Kimi CLI, Codex CLI, or Claude CLI.");
  return platform === "win32" ? commands.win32 : commands.posix;
}

function parsePort(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error("--port must be an integer from 0 to 65535.");
  const port = Number(text);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer from 0 to 65535.");
  return port;
}

function parseTextOption(name, value) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} requires a non-empty value.`);
  if (/[\r\n\0]/.test(text)) throw new Error(`${name} contains invalid characters.`);
  return text;
}

function parseArgs(argv = []) {
  const result = { command: "start", provider: null, port: null, model: null, effort: null, config: null, uat: false, help: false, version: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "doctor" || argument === "configure") {
      if (result.command !== "start") throw new Error("Only one command may be specified.");
      result.command = argument;
    } else if (argument === "--api") {
      if (result.provider && result.provider !== "api") throw new Error("--api, --kimi, --codex, and --claude cannot be used together.");
      result.provider = "api";
    } else if (argument === "--kimi") {
      if (result.provider && result.provider !== "kimi-cli") throw new Error("--api, --kimi, --codex, and --claude cannot be used together.");
      result.provider = "kimi-cli";
    } else if (argument === "--codex") {
      if (result.provider && result.provider !== "codex-cli") throw new Error("--api, --kimi, --codex, and --claude cannot be used together.");
      result.provider = "codex-cli";
    } else if (argument === "--claude") {
      if (result.provider && result.provider !== "claude-cli") throw new Error("--api, --kimi, --codex, and --claude cannot be used together.");
      result.provider = "claude-cli";
    } else if (argument === "--port") {
      if (index + 1 >= argv.length) throw new Error("--port requires a value.");
      result.port = parsePort(argv[++index]);
    } else if (argument.startsWith("--port=")) {
      result.port = parsePort(argument.slice("--port=".length));
    } else if (argument === "--model") {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new Error("--model requires a value.");
      result.model = parseTextOption("--model", argv[++index]);
    } else if (argument.startsWith("--model=")) {
      result.model = parseTextOption("--model", argument.slice("--model=".length));
    } else if (argument === "--effort") {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new Error("--effort requires a value.");
      result.effort = parseTextOption("--effort", argv[++index]);
    } else if (argument.startsWith("--effort=")) {
      result.effort = parseTextOption("--effort", argument.slice("--effort=".length));
    } else if (argument === "--config") {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new Error("--config requires a file path.");
      result.config = parseTextOption("--config", argv[++index]);
    } else if (argument.startsWith("--config=")) {
      result.config = parseTextOption("--config", argument.slice("--config=".length));
    } else if (argument === "--uat") {
      result.uat = true;
    } else if (argument === "--help" || argument === "-h") {
      result.help = true;
    } else if (argument === "--version" || argument === "-v") {
      result.version = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      throw new Error(`Unknown command: ${argument}`);
    }
  }
  if (result.uat && result.command !== "start") throw new Error("--uat is only supported when starting PenEcho.");
  return result;
}

function parseEnvText(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function loadEnvFile(file) {
  try { return parseEnvText(fs.readFileSync(file, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!provider) return null;
  if (provider === "api") return "api";
  if (provider === "kimi" || provider === "kimi-cli") return "kimi-cli";
  if (provider === "codex" || provider === "codex-cli") return "codex-cli";
  if (provider === "claude" || provider === "claude-cli") return "claude-cli";
  return null;
}

function resolveConfiguration(args, options = {}) {
  const sourceEnv = options.env || process.env,
    cwd = path.resolve(options.cwd || process.cwd()),
    home = path.resolve(options.home || os.homedir()),
    packageRoot = path.resolve(options.packageRoot || PACKAGE_ROOT),
    defaultStateDir = sourceEnv.PENECHO_STATE_DIR ? path.resolve(cwd, sourceEnv.PENECHO_STATE_DIR) : path.join(home, ".penecho"),
    configFile = args.config ? path.resolve(cwd, args.config) : path.join(defaultStateDir, "config.env"),
    fileEnv = loadEnvFile(configFile),
    configuredStateDir = sourceEnv.PENECHO_STATE_DIR || fileEnv.PENECHO_STATE_DIR,
    stateDir = configuredStateDir ? path.resolve(cwd, configuredStateDir) : defaultStateDir;
  const env = { ...fileEnv, ...sourceEnv };
  if (args.provider) env.AI_PROVIDER = args.provider;
  if (args.port !== null) env.PORT = String(args.port);
  const provider = normalizeProvider(env.AI_PROVIDER);
  if (args.model !== null || args.effort !== null) {
    if (provider === "kimi-cli") {
      if (args.model !== null) env.KIMI_CLI_MODEL = args.model;
    } else if (provider === "codex-cli") {
      if (args.model !== null) env.CODEX_CLI_MODEL = args.model;
    } else if (provider === "claude-cli") {
      if (args.model !== null) env.CLAUDE_CLI_MODEL = args.model;
    } else {
      throw new Error("--model and --effort are only supported with Kimi, Codex, or Claude CLI mode.");
    }
    if (args.effort !== null) env.AI_EFFORT = args.effort;
  }
  if (args.uat) {
    env.PENECHO_CLOUD_ENV = "uat";
    env.PENECHO_CLOUD_ORIGIN = UAT_CLOUD_ORIGIN;
    env.PENECHO_CLOUD_STATE_DIR = path.join(stateDir, "cloud-uat");
  }
  env.PENECHO_STATE_DIR = stateDir;
  return {
    env,
    cwd,
    home,
    packageRoot,
    stateDir,
    configFile,
    configExplicit:Boolean(args.config),
    configExists:fs.existsSync(configFile),
    provider,
    port: env.PORT === undefined || env.PORT === "" ? DEFAULT_PORT : parsePort(env.PORT),
  };
}

function isPlaceholder(value) {
  return /^(?:your[_ -]|replace[_ -]|changeme|api[_ -]?key|sk-\.{3})/i.test(String(value || "").trim());
}

function apiEnvValue(env, name) {
  const canonical = String(env[`AI_API_${name}`] || "").trim();
  const legacyName = { KEY:"OPENAI_API_KEY", URL:"OPENAI_API_URL", MODEL:"OPENAI_MODEL", FORMAT:"OPENAI_API_FORMAT" }[name];
  return canonical || String(env[legacyName] || "").trim();
}

function normalizedEffort(value) {
  return String(value || "").trim();
}

function configuredTimeoutSeconds(env) {
  const text = String(env.AI_TIMEOUT_SECONDS || env.CODEX_CLI_TIMEOUT_SECONDS || env.CLAUDE_CLI_TIMEOUT_SECONDS || DEFAULT_TIMEOUT_SECONDS).trim(),
    value = Number(text);
  if (!Number.isInteger(value) || value < 10 || value > 600) throw new Error("AI_TIMEOUT_SECONDS must be an integer from 10 to 600.");
  return value;
}

function apiConfigurationIssues(env) {
  const issues = [], key = apiEnvValue(env, "KEY"), model = apiEnvValue(env, "MODEL"), apiUrl = apiEnvValue(env, "URL"), format = apiEnvValue(env, "FORMAT");
  if (!key || isPlaceholder(key)) issues.push("AI_API_KEY");
  if (!model || isPlaceholder(model)) issues.push("AI_API_MODEL");
  if (!apiUrl || isPlaceholder(apiUrl)) issues.push("AI_API_URL");
  else {
    try {
      const parsed = new URL(apiUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) issues.push("AI_API_URL");
    } catch { issues.push("AI_API_URL"); }
  }
  if (format && !["openai", "anthropic"].includes(format.toLowerCase())) issues.push("AI_API_FORMAT");
  if (env.PENECHO_AI_IMAGE_FORMAT && !["webp", "png"].includes(String(env.PENECHO_AI_IMAGE_FORMAT).trim().toLowerCase())) issues.push("PENECHO_AI_IMAGE_FORMAT");
  return [...new Set(issues)];
}

function safeApiDiagnostic(value, key) {
  let text = String(value || "").replace(/[\r\n\t]+/g, " ").trim();
  if (key) text = text.split(key).join("[redacted]");
  return text.slice(0, 500);
}

function connectionTestTimeoutError(message) {
  const error = new Error(message);
  error.code = "PENECHO_CONNECTION_TEST_TIMEOUT";
  return error;
}

async function testApiConnection(env, options = {}) {
  const issues = apiConfigurationIssues(env);
  if (issues.length) throw new Error(`API configuration is incomplete: ${issues.join(", ")}`);
  const apiUrl = apiEnvValue(env, "URL"), format = apiEnvValue(env, "FORMAT").toLowerCase(), model = apiEnvValue(env, "MODEL"), key = apiEnvValue(env, "KEY"),
    api = resolveApiConfig(apiUrl, format || undefined);
  if (!api) throw new Error("AI_API_URL and AI_API_FORMAT do not describe a compatible OpenAI or Anthropic endpoint.");
  const effort = normalizedApiEffort(api.format, env.AI_EFFORT), mapping = reasoningEffortMapping({ provider:"api", apiFormat:api.format, apiPreset:env.PENECHO_API_PRESET, apiUrl, model, effort }), reasoning = apiReasoningParameters({ apiFormat:api.format, apiPreset:env.PENECHO_API_PRESET, apiUrl, model, effort }), testImage = configuredTestImage(env), [imageHeader, imageData] = testImage.split(",", 2), imageType = imageHeader.slice(5).split(";", 1)[0];
  const request = api.format === "anthropic"
    ? {
        headers: { "Content-Type":"application/json", "x-api-key":key, "anthropic-version":"2023-06-01" },
        body: JSON.stringify({ model, max_tokens:anthropicResponseMaxTokens(effort), stream:true, ...(mapping.family === "minimax" ? reasoning : anthropicEffortParameters(effort, false, { apiUrl, model })), messages:[{ role:"user", content:[{ type:"text", text:"Inspect the attached test image and reply with OK only." }, { type:"image", source:{ type:"base64", media_type:imageType, data:imageData } }] }] }),
      }
    : {
        headers: { "Content-Type":"application/json", Authorization:`Bearer ${key}` },
        body: JSON.stringify({ model, stream:true, messages:[{ role:"user", content:[{ type:"text", text:"Inspect the attached test image and reply with OK only." }, { type:"image_url", image_url:{ url:testImage } }] }], ...reasoning }),
      };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("This Node.js version does not provide fetch().");
  const timeoutMs = options.timeoutMs || configuredTimeoutSeconds(env) * 1000, controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let response, phase = "connecting";
  try {
    try {
      response = await fetchImpl(api.endpoint, { method:"POST", redirect:"error", signal:controller.signal, ...request });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error(`API connection failed: ${safeApiDiagnostic(error.message, key) || "network error"}`);
    }
    phase = "reading response";
    if (!response.ok) {
      const responseText = await response.text();
      const diagnostic = safeApiDiagnostic(responseText, key);
      throw new Error(`${api.format} API returned HTTP ${response.status}${diagnostic ? `: ${diagnostic}` : ""}`);
    }
    if (isEventStreamResponse(response)) await readProviderEventStream(response,api.format);
    else await response.text();
    return { format:api.format, status:response.status };
  } catch (error) {
    if (controller.signal.aborted) throw connectionTestTimeoutError(`API connection test timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    if (phase === "connecting") throw new Error(`API connection failed: ${safeApiDiagnostic(error.message, key) || "network error"}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function runCaptured(launch, args, options = {}) {
  const timeoutMs = options.timeoutMs || CLI_PREFLIGHT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(launch.command, [...launch.prefixArgs, ...args], {
        cwd: options.cwd || process.cwd(), env: options.env || process.env,
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false,
      });
    } catch (error) { reject(error); return; }
    let stdout = "", stderr = "", overflow = false, settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error(`Command timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    const capture = (target) => chunk => {
      if (overflow) return;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + chunk.length > MAX_COMMAND_OUTPUT) {
        overflow = true;
        try { child.kill(); } catch {}
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    child.once("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (overflow) reject(new Error("Command produced too much output."));
      else resolve({ code, stdout, stderr });
    });
  });
}

async function runCodexPreflight(configuration, options = {}) {
  const runner = options.runner || runCaptured;
  let launch;
  try { launch = resolveCodexLaunch(configuration.env.CODEX_CLI_PATH || "codex", configuration.env); }
  catch (error) { return { ok:false, issue:/not found|not a file/i.test(error.message) ? "missing" : "execution", error:error.message }; }
  try {
    const version = await runner(launch, ["--version"], { cwd: configuration.cwd, env: configuration.env, timeoutMs: CLI_PREFLIGHT_TIMEOUT_MS });
    if (version.code !== 0) return { ok:false, issue:"execution", error:"Codex CLI could not report its version." };
    const login = await runner(launch, ["login", "status"], { cwd: configuration.cwd, env: configuration.env, timeoutMs: CLI_PREFLIGHT_TIMEOUT_MS });
    if (login.code !== 0) {
      const diagnostic = `${login.stdout || ""}\n${login.stderr || ""}`;
      if (/not logged in|not authenticated|authentication required|login required/i.test(diagnostic)) return { ok:false, issue:"authentication", error:"Codex CLI is not logged in." };
      return { ok:false, issue:"execution", error:"Codex CLI could not complete its login check." };
    }
    return { ok: true, version: (version.stdout || version.stderr).trim().split(/\r?\n/, 1)[0] || "Codex CLI" };
  } catch (error) { return { ok:false, issue:"execution", error:`Codex CLI check failed: ${error.message}` }; }
}

async function codexBundledModels(configuration, options = {}) {
  const runner = options.runner || runCaptured;
  let launch;
  try { launch = resolveCodexLaunch(configuration.env.CODEX_CLI_PATH || "codex", configuration.env); }
  catch (error) { throw new Error(error.message); }
  const result = await runner(launch, ["debug", "models", "--bundled"], { cwd:configuration.cwd, env:configuration.env, timeoutMs:CLI_PREFLIGHT_TIMEOUT_MS });
  if (result.code !== 0) throw new Error("Codex CLI could not read its bundled model catalog. Upgrade Codex with `npm install -g @openai/codex@latest`.");
  let catalog;
  try { catalog = JSON.parse(result.stdout); }
  catch { throw new Error("Codex CLI returned an invalid bundled model catalog. Upgrade Codex with `npm install -g @openai/codex@latest`."); }
  if (!Array.isArray(catalog?.models)) throw new Error("Codex CLI bundled model catalog is missing its model list.");
  return catalog.models.map(item => String(item?.slug || "").trim()).filter(Boolean);
}

async function runClaudePreflight(configuration, options = {}) {
  const runner = options.runner || runCaptured;
  let launch;
  try { launch = resolveClaudeLaunch(configuration.env.CLAUDE_CLI_PATH || "claude", configuration.env); }
  catch (error) { return { ok:false, issue:/not found|not a file/i.test(error.message) ? "missing" : "execution", error:error.message }; }
  try {
    const version = await runner(launch, ["--version"], { cwd: configuration.cwd, env: configuration.env, timeoutMs: CLI_PREFLIGHT_TIMEOUT_MS });
    if (version.code !== 0) return { ok:false, issue:"execution", error:"Claude CLI could not report its version." };
    const login = await runner(launch, ["auth", "status"], { cwd: configuration.cwd, env: configuration.env, timeoutMs: CLI_PREFLIGHT_TIMEOUT_MS });
    if (login.code !== 0) {
      const diagnostic = `${login.stdout || ""}\n${login.stderr || ""}`;
      if (/not logged in|not authenticated|authentication required|login required/i.test(diagnostic)) return { ok:false, issue:"authentication", error:"Claude CLI is not logged in." };
      return { ok:false, issue:"execution", error:"Claude CLI could not complete its authentication check." };
    }
    return { ok: true, version: (version.stdout || version.stderr).trim().split(/\r?\n/, 1)[0] || "Claude CLI" };
  } catch (error) { return { ok:false, issue:"execution", error:`Claude CLI check failed: ${error.message}` }; }
}

async function runKimiPreflight(configuration, options = {}) {
  const runner = options.runner || runCaptured;
  let launch;
  try { launch = resolveKimiLaunch(configuration.env.KIMI_CLI_PATH || "kimi", configuration.env); }
  catch (error) { return { ok:false, issue:/not found|not a file/i.test(error.message) ? "missing" : "execution", error:error.message }; }
  try {
    const env = { ...configuration.env, KIMI_CODE_NO_AUTO_UPDATE:"1" },
      version = await runner(launch, ["--version"], { cwd:configuration.cwd, env, timeoutMs:CLI_PREFLIGHT_TIMEOUT_MS });
    if (version.code !== 0) return { ok:false, issue:"execution", error:"Kimi Code CLI could not report its version." };
    return { ok:true, version:(version.stdout || version.stderr).trim().split(/\r?\n/, 1)[0] || "Kimi Code CLI" };
  } catch (error) {
    return { ok:false, issue:"execution", error:`Kimi Code CLI check failed: ${error.message}` };
  }
}

function providerPreflight(provider) {
  if (provider === "kimi-cli") return runKimiPreflight;
  if (provider === "codex-cli") return runCodexPreflight;
  if (provider === "claude-cli") return runClaudePreflight;
  throw new Error("Choose Kimi CLI, Codex CLI, or Claude CLI.");
}

async function resolveCliPreflight(configuration, options = {}) {
  const provider = configuration.provider, item = cliDefinition(provider), candidates = options.candidates || cliCandidates(provider, {
    env:configuration.env, home:configuration.home, stateDir:configuration.stateDir, platform:options.platform,
    configuredPath:configuration.env[item.envName],
  }), failures = [], preflight = providerPreflight(provider);
  if (!candidates.length) return { ok:false, issue:"missing", error:`${item.label} CLI was not found.`, failures };
  for (const candidate of candidates) {
    const candidateConfiguration = { ...configuration, env:{ ...configuration.env, [item.envName]:candidate.executable } },
      result = await preflight(candidateConfiguration, { runner:options.runner });
    if (result.ok) return { ...result, executable:candidate.executable, source:candidate.source, failures };
    failures.push({ ...result, executable:candidate.executable, source:candidate.source });
  }
  const selected = failures.find(failure => failure.issue === "authentication") || failures[0];
  return { ...selected, failures };
}

function checkNodeVersion() {
  const [major,minor]=process.versions.node.split(".",2).map(Number);
  return Number.isInteger(major)&&Number.isInteger(minor)&&(major>22||major===22&&minor>=19);
}

function checkAssets(packageRoot = PACKAGE_ROOT) {
  return REQUIRED_ASSETS.filter(relative => {
    try { return !fs.statSync(path.join(packageRoot, relative)).isFile(); } catch { return true; }
  });
}

function checkPortAvailable(port, host = "0.0.0.0") {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once("error", error => resolve({ ok: false, error: error.code || error.message }));
    server.listen({ port, host, exclusive: true }, () => server.close(error => resolve(error ? { ok: false, error: error.message } : { ok: true })));
  });
}

function serializeEnvValue(value) {
  const text = String(value ?? "");
  return /^[A-Za-z0-9_./:@+\-=]+$/.test(text) ? text : JSON.stringify(text);
}

function writeConfigFile(file, values) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lines = Object.keys(values).sort().map(key => `${key}=${serializeEnvValue(values[key])}`), temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch (error) { if (process.platform !== "win32") throw error; }
}

function saveConfiguration(configuration, updates = {}) {
  const saved = { ...loadEnvFile(configuration.configFile) }, legacyMappings = {
    OPENAI_API_FORMAT:"AI_API_FORMAT",
    OPENAI_API_KEY:"AI_API_KEY",
    OPENAI_API_URL:"AI_API_URL",
    OPENAI_MODEL:"AI_API_MODEL",
  };
  for (const [legacy, canonical] of Object.entries(legacyMappings)) {
    if (saved[canonical] === undefined && saved[legacy] !== undefined) saved[canonical] = saved[legacy];
  }
  const defaults = {
    AI_TIMEOUT_SECONDS:String(saved.AI_TIMEOUT_SECONDS || configuration.env.AI_TIMEOUT_SECONDS || saved.CODEX_CLI_TIMEOUT_SECONDS || saved.CLAUDE_CLI_TIMEOUT_SECONDS || configuration.env.CODEX_CLI_TIMEOUT_SECONDS || configuration.env.CLAUDE_CLI_TIMEOUT_SECONDS || DEFAULT_TIMEOUT_SECONDS),
    PENECHO_AI_IMAGE_FORMAT:String(configuration.env.PENECHO_AI_IMAGE_FORMAT || "webp"),
    AUTO_AI_DELAY_SECONDS:String(configuration.env.AUTO_AI_DELAY_SECONDS || "5"),
    HOST:String(configuration.env.HOST || "0.0.0.0"),
    PORT:String(configuration.env.PORT || configuration.port || DEFAULT_PORT),
    PENECHO_REQUEST_TRACE:String(configuration.env.PENECHO_REQUEST_TRACE || "false"),
    PENECHO_REQUEST_TRACE_LIMIT:String(configuration.env.PENECHO_REQUEST_TRACE_LIMIT || "100"),
  };
  for (const [name, value] of Object.entries(defaults)) if (saved[name] === undefined) saved[name] = value;
  for (const [name, value] of Object.entries(updates)) {
    if (value === null || value === undefined) delete saved[name];
    else {
      const text = String(value);
      if (/[\r\n\0]/.test(text)) throw new Error(`${name} contains invalid characters.`);
      saved[name] = text;
    }
  }
  for (const legacy of ["OPENAI_API_FORMAT", "OPENAI_API_KEY", "OPENAI_API_URL", "OPENAI_MODEL", "CODEX_CLI_TIMEOUT_SECONDS", "CLAUDE_CLI_TIMEOUT_SECONDS"]) delete saved[legacy];
  writeConfigFile(configuration.configFile, saved);
  for (const name of ["OPENAI_API_FORMAT", "OPENAI_API_KEY", "OPENAI_API_URL", "OPENAI_MODEL", "CODEX_CLI_TIMEOUT_SECONDS", "CLAUDE_CLI_TIMEOUT_SECONDS"]) delete configuration.env[name];
  Object.assign(configuration.env, saved);
  configuration.provider = normalizeProvider(saved.AI_PROVIDER);
  configuration.port = parsePort(saved.PORT);
  configuration.configExists = true;
  return saved;
}

const CONFIG_TEST_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";
const CONFIG_TEST_WEBP = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==";

function configuredTestImage(env) {
  return String(env.PENECHO_AI_IMAGE_FORMAT || "webp").trim().toLowerCase() === "png" ? CONFIG_TEST_IMAGE : CONFIG_TEST_WEBP;
}

function cliTestError(error) {
  const message = String(error?.message || "CLI test failed.").replace(/[\r\n\t]+/g, " ").trim(),
    diagnostic = String(error?.diagnostic || "").replace(/[\r\n\t]+/g, " ").trim();
  return diagnostic ? `${message} ${diagnostic}`.slice(0, 800) : message.slice(0, 800);
}

function apiConnectionTestLabel(env, format) {
  const preset = String(env.PENECHO_API_PRESET || "").trim().toLowerCase();
  if (preset.startsWith("kimi-")) return "Kimi";
  if (preset.startsWith("minimax-")) return "MiniMax";
  return format === "openai" ? "OpenAI-compatible" : format;
}

async function testConfiguredProvider(configuration, options = {}) {
  const provider = configuration.provider;
  if (!["api", "kimi-cli", "codex-cli", "claude-cli"].includes(provider)) throw new Error(`AI_PROVIDER must be ${PROVIDER_OPTIONS}.`);
  const requestedTimeoutMs = Number(options.timeoutMs),
    timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0 ? requestedTimeoutMs : configuredTimeoutSeconds(configuration.env) * 1000;
  if (provider === "api") {
    const result = await (options.apiTester || testApiConnection)(configuration.env, { fetchImpl:options.fetchImpl, timeoutMs });
    return `${apiConnectionTestLabel(configuration.env, result.format)} API responded with HTTP ${result.status}.`;
  }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs), atlasImage = configuredTestImage(configuration.env);
  try {
    const preflight = provider === "kimi-cli"
      ? await runKimiPreflight(configuration, { runner:options.runner })
      : provider === "codex-cli"
        ? await runCodexPreflight(configuration, { runner:options.runner })
        : await runClaudePreflight(configuration, { runner:options.runner });
    if (controller.signal.aborted) throw connectionTestTimeoutError(`Connection test timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    if (!preflight.ok) throw new Error(preflight.error);
    if (provider === "codex-cli") {
      const model = normalizedEffort(configuration.env.CODEX_CLI_MODEL);
      const models = model ? await codexBundledModels(configuration, { runner:options.runner }) : [];
      if (controller.signal.aborted) throw connectionTestTimeoutError(`Connection test timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      if (model && !models.some(candidate => candidate.toLowerCase() === model.toLowerCase())) {
        throw new Error(`Codex model "${model}" is not present in ${preflight.version}'s bundled model catalog. The configuration was saved; upgrade Codex or choose another model.`);
      }
    }
    const common = {
      effort:reasoningEffortMapping({ provider, model:configuration.env[provider === "kimi-cli" ? "KIMI_CLI_MODEL" : provider === "codex-cli" ? "CODEX_CLI_MODEL" : "CLAUDE_CLI_MODEL"], effort:normalizedEffort(configuration.env.AI_EFFORT) || "medium" }).requested,
      prompt:"Inspect the attached PenEcho connection-test image and reply with OK only. Do not use tools.",
      atlasImage,
      signal:controller.signal,
      env:configuration.env,
    };
    if (provider === "kimi-cli") await (options.kimiCaller || callKimiCli)({ ...common, executable:configuration.env.KIMI_CLI_PATH || "kimi", model:normalizedEffort(configuration.env.KIMI_CLI_MODEL) || null });
    else if (provider === "codex-cli") await (options.codexCaller || callCodexCli)({ ...common, executable:configuration.env.CODEX_CLI_PATH || "codex", model:normalizedEffort(configuration.env.CODEX_CLI_MODEL) || null });
    else await (options.claudeCaller || callClaudeCli)({ ...common, executable:configuration.env.CLAUDE_CLI_PATH || "claude", model:normalizedEffort(configuration.env.CLAUDE_CLI_MODEL) || null, systemPrompt:"You are running a PenEcho connection test. Do not use tools. Reply with OK only." });
    return `${preflight.version}; the selected ${provider === "kimi-cli" ? "Kimi" : provider === "codex-cli" ? "Codex" : "Claude"} model, image input, and reasoning effort responded successfully.`;
  } catch (error) {
    if (controller.signal.aborted) throw connectionTestTimeoutError(`Connection test timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    throw new Error(cliTestError(error));
  } finally { clearTimeout(timer); }
}

async function runDoctor(args, configuration, options = {}) {
  const output = options.output || process.stdout;
  let ready = true;
  const report = (ok, message) => { output.write(`[${ok ? "ok" : "fail"}] ${message}\n`); if (!ok) ready = false; };
  report(checkNodeVersion(), `Node.js ${process.versions.node} (22.19+ required)`);
  const missingAssets = checkAssets(configuration.packageRoot);
  report(missingAssets.length === 0, missingAssets.length ? `Missing PenEcho assets: ${missingAssets.join(", ")}` : "PenEcho assets are present");
  const port = await (options.portChecker || checkPortAvailable)(configuration.port, configuration.env.HOST || "0.0.0.0");
  report(port.ok, port.ok ? `Port ${configuration.port} is available` : `Port ${configuration.port} is unavailable (${port.error})`);
  try { report(true, `Unified model timeout is ${configuredTimeoutSeconds(configuration.env)} seconds`); }
  catch (error) { report(false, error.message); }
  report(true, `Reasoning effort is ${configuration.env.AI_EFFORT || "medium (PenEcho default)"}`);
  if (configuration.provider === "kimi-cli") report(true, `Model is ${configuration.env.KIMI_CLI_MODEL || "the Kimi Code CLI configured default"}`);
  if (configuration.provider === "codex-cli") report(true, `Model is ${configuration.env.CODEX_CLI_MODEL || "the Codex CLI default for PenEcho's isolated session"}`);
  if (configuration.provider === "claude-cli") report(true, `Model is ${configuration.env.CLAUDE_CLI_MODEL || "the Claude CLI default"}`);

  if (!configuration.provider) {
    report(false, `AI_PROVIDER must be ${PROVIDER_OPTIONS}`);
  } else if (configuration.provider === "api") {
    const issues = apiConfigurationIssues(configuration.env);
    report(issues.length === 0, issues.length ? `API configuration is incomplete: ${issues.join(", ")}. Run \`penecho configure\`.` : "API configuration is ready (no paid request was made)");
  } else if (configuration.provider === "kimi-cli") {
    const kimi = await runKimiPreflight(configuration, { runner:options.runner });
    report(kimi.ok, kimi.ok ? `${kimi.version}; executable is ready (authentication is checked when Kimi handles the first request)` : kimi.error);
  } else if (configuration.provider === "codex-cli") {
    const codex = await runCodexPreflight(configuration, { runner: options.runner });
    report(codex.ok, codex.ok ? `${codex.version}; login is ready (no model request was made)` : codex.error);
  } else {
    const claude = await runClaudePreflight(configuration, { runner: options.runner });
    report(claude.ok, claude.ok
      ? `${claude.version}; Claude CLI reports an authenticated session, but no model request was made. If a request fails, run \`claude auth login\` and try again.`
      : claude.error);
  }
  return ready;
}

function applyConfiguration(env) {
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== null) process.env[key] = String(value);
  }
}
function closeStartedServer(server) {
  if (!server || typeof server.close !== "function" || !server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
  });
}

async function runPostStartUpdate(server, argv, options, output, errorOutput) {
  const updateOptions = { ...options, output, errorOutput };
  if (!updateOptions.updateFinalizer && server && typeof server.close === "function") {
    updateOptions.updateFinalizer = () => closeStartedServer(server);
  }
  return maybeUpdateOnStart(argv, updateOptions);
}

function schedulePostStartUpdate(server, argv, options, output, errorOutput) {
  const task = () => runPostStartUpdate(server, argv, options, output, errorOutput).catch(error => {
    errorOutput.write(`PenEcho update check failed: ${error.message}\n`);
    return { checked:false, restarted:false };
  });
  if (options.awaitUpdateCheck) return task();
  (options.updateScheduler || setImmediate)(() => { void task(); });
  return Promise.resolve(null);
}

function cliDisplayLabel(provider) {
  return provider === "kimi-cli" ? "Kimi Code CLI" : provider === "codex-cli" ? "Codex CLI" : "Claude Code";
}

function cliRecovery(provider, issue, platform) {
  if (issue === "authentication") return { action:`Authenticate ${cliDisplayLabel(provider)}`, command:CLI_LOGIN_COMMANDS[provider] };
  return { action:`Upgrade or repair ${cliDisplayLabel(provider)}`, command:cliUpgradeCommand(provider, platform) };
}

function applyResolvedCli(configuration, server, result) {
  const item = cliDefinition(configuration.provider);
  configuration.env[item.envName] = result.executable;
  process.env[item.envName] = result.executable;
  if (typeof server?.applyCliResolution === "function") server.applyCliResolution(configuration.provider, result.executable);
}

async function runPostStartCliPreflight(server, configuration, options, output, errorOutput) {
  const result = await resolveCliPreflight(configuration, options), label = cliDisplayLabel(configuration.provider), item = cliDefinition(configuration.provider);
  if (result.ok) {
    applyResolvedCli(configuration, server, result);
    const source = result.source === "managed" ? "PenEcho-managed" : result.source === "system" ? "system" : "configured";
    output.write(`PenEcho is using the ${source} ${label} (${result.version}).\n`);
    return result;
  }
  const recovery = cliRecovery(configuration.provider, result.issue, options.platform);
  errorOutput.write(`PenEcho ${item.label} check warning: ${result.error}\n${recovery.action}:\n  ${recovery.command}\nPenEcho has started, but ${item.label} requests may fail until this is resolved. Run \`penecho doctor --${item.doctor}\` for full diagnostics.\n`);
  return result;
}

function schedulePostStartCliPreflight(server, configuration, options, output, errorOutput) {
  if (!configuration.provider?.endsWith("-cli")) return Promise.resolve(null);
  const task = runPostStartCliPreflight(server, configuration, options, output, errorOutput).catch(error => {
    const item = cliDefinition(configuration.provider), recovery = cliRecovery(configuration.provider, "execution", options.platform);
    errorOutput.write(`PenEcho ${item.label} check warning: ${error.message}\n${recovery.action}:\n  ${recovery.command}\nPenEcho has started, but ${item.label} requests may fail until this is resolved.\n`);
    return { ok:false, issue:"execution", error:error.message };
  });
  if (typeof server?.setCliResolutionTask === "function") server.setCliResolutionTask(configuration.provider, task);
  if (options.awaitCliPreflight) return task;
  return Promise.resolve(null);
}


function helpText() {
  return `PenEcho ${PACKAGE_JSON.version}\n\nUsage:\n  penecho [--config FILE] [--port 3888]\n  penecho configure [--config FILE]\n  penecho doctor [--api|--kimi|--codex|--claude] [--config FILE]\n  penecho --kimi [--model MODEL] [--effort LEVEL]\n  penecho --codex [--model MODEL] [--effort LEVEL]\n  penecho --claude [--model MODEL] [--effort LEVEL]\n\nOptions:\n  --config <file>   Use this configuration file instead of ~/.penecho/config.env\n  --api             Use an OpenAI-compatible or Anthropic-compatible API\n  --kimi            Use the authenticated Kimi Code CLI\n  --codex           Use the authenticated Codex CLI\n  --claude          Use the authenticated Claude CLI\n  --model <model>   Override the model for a CLI mode\n  --effort <level>  Override reasoning effort with a known or CLI-supported value\n  --port <port>     Override the configured listening port\n  -h, --help        Show help\n  -v, --version     Show version\n\nRun \`penecho configure\` for the interactive configuration center. Known effort values include none, low, medium, high, xhigh, and max; other strings are passed through.\n\nKimi Code CLI installation (run these yourself):\n  macOS/Linux: curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash\n  Windows PowerShell: irm https://code.kimi.com/kimi-code/install.ps1 | iex\n  Then: kimi --version && kimi login\n  Official guide: https://github.com/MoonshotAI/kimi-code\n\nExamples:\n  penecho configure\n  penecho\n  penecho --config ./team.env\n  penecho --kimi\n  penecho --codex --model gpt-5.6-sol --effort xhigh\n`;
}

async function main(argv = process.argv.slice(2), options = {}) {
  const output = options.output || process.stdout, errorOutput = options.errorOutput || process.stderr;
  let args;
  try { args = parseArgs(argv); }
  catch (error) { errorOutput.write(`PenEcho: ${error.message}\nRun \`penecho --help\` for usage.\n`); return 1; }
  if (args.help) { output.write(helpText()); return 0; }
  if (args.version) { output.write(`${PACKAGE_JSON.version}\n`); return 0; }
  if (!checkNodeVersion()) {
    errorOutput.write(`PenEcho requires Node.js 22.19 or newer for the embedded DeepSeek Harness (current: ${process.versions.node}).\n`);
    return 1;
  }
  if (args.command === "start") {
    output.write(`PenEcho v${PACKAGE_JSON.version}\n`);
    if (args.uat) output.write(`PenEcho Cloud target: UAT (${UAT_CLOUD_ORIGIN})\n`);
  }
  let configuration;
  try { configuration = resolveConfiguration(args, options); }
  catch (error) { errorOutput.write(`PenEcho configuration error: ${error.message}\n`); return 1; }

  const configure = async directProvider => {
    try {
      await runConfigureMenu(configuration, {
        ui:options.ui,
        input:options.input,
        output,
        allowNonInteractive:options.allowNonInteractive,
        directProvider,
        save:async updates => saveConfiguration(configuration, updates),
        test:async () => testConfiguredProvider(configuration, options),
      });
      return true;
    } catch (error) {
      if (isPromptExit(error)) return true;
      errorOutput.write(`PenEcho configuration failed: ${error.message}\n`);
      return false;
    }
  };

  if (args.command === "configure") {
    return await configure(args.provider || "") ? 0 : 1;
  }
  if (args.command === "doctor") return (await runDoctor(args, configuration, options)) ? 0 : 1;

  const sourceEnv = options.env || process.env, sourceConfigured = Boolean(args.provider || String(sourceEnv.AI_PROVIDER || "").trim());
  if (!configuration.configExists && !sourceConfigured) {
    const input = options.input || process.stdin,
      interactive = Boolean(options.ui?.interactive || options.allowNonInteractive || input.isTTY && output.isTTY);
    if (!interactive) {
      errorOutput.write(`PenEcho is not configured. Run \`penecho configure${args.config ? ` --config ${args.config}` : ""}\` in a terminal first.\n`);
      return 1;
    }
    output.write(`PenEcho has no saved configuration. Opening the configuration center at ${configuration.configFile}.\n`);
    if (!await configure("")) return 1;
  }
  if (!configuration.provider) {
    errorOutput.write(`PenEcho has no LLM source. Run \`penecho configure\` and select Kimi CLI, Claude CLI, Codex CLI, or API.\n`);
    return 1;
  }
  if (configuration.provider === "api") {
    const issues = apiConfigurationIssues(configuration.env);
    if (issues.length) {
      errorOutput.write(`PenEcho API configuration is incomplete: ${issues.join(", ")}.\nRun \`penecho configure\` to correct it.\n`);
      return 1;
    }
  }
  configuration.env.PENECHO_CONFIG_FILE = configuration.configFile;
  applyConfiguration(configuration.env);
  let startedServer;
  if (options.startServer) {
    startedServer = await options.startServer(configuration);
    await schedulePostStartCliPreflight(startedServer, configuration, options, output, errorOutput);
    const update = await schedulePostStartUpdate(startedServer, argv, options, output, errorOutput);
    if (update?.exitCode) return update.exitCode;
  } else {
    startedServer = require("../../server.js");
    const schedule = () => {
      void schedulePostStartCliPreflight(startedServer, configuration, options, output, errorOutput);
      void schedulePostStartUpdate(startedServer, argv, options, output, errorOutput);
    };
    if (startedServer?.listening) schedule();
    else if (typeof startedServer?.once === "function") startedServer.once("listening", schedule);
  }
  return 0;
}

if (require.main === module) {
  main().then(code => { if (code) process.exitCode = code; }).catch(error => {
    console.error(`PenEcho: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  apiConfigurationIssues,
  checkAssets,
  checkPortAvailable,
  cliCandidates,
  codexBundledModels,
  configuredTimeoutSeconds,
  helpText,
  loadEnvFile,
  main,
  parseArgs,
  parseEnvText,
  resolveConfiguration,
  resolveCliPreflight,
  runCodexPreflight,
  runClaudePreflight,
  runKimiPreflight,
  runDoctor,
  saveConfiguration,
  testConfiguredProvider,
  testApiConnection,
  writeConfigFile,
};
