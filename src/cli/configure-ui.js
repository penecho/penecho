"use strict";

const fs = require("fs");
const path = require("path");
const { DEFAULT_MAX_TOKENS, MIN_MAX_TOKENS, configuredMaxTokens } = require("../server/api-config.js");

const PROVIDERS = {
  kimi: "kimi-cli",
  claude: "claude-cli",
  codex: "codex-cli",
  api: "api",
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function apiValue(env, name) {
  const canonical = cleanText(env[`AI_API_${name}`]),
    legacy = { FORMAT:"OPENAI_API_FORMAT", URL:"OPENAI_API_URL", MODEL:"OPENAI_MODEL", KEY:"OPENAI_API_KEY" }[name];
  return canonical || cleanText(env[legacy]);
}

function uniqueChoices(choices) {
  const seen = new Set();
  return choices.filter(choice => {
    if (choice.value === "__manual__" || choice.value === "__back__") return true;
    const key = String(choice.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readJsonModel(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const candidates = [data.model, data.defaultModel, data?.env?.ANTHROPIC_MODEL];
    return candidates.map(cleanText).find(Boolean) || "";
  } catch { return ""; }
}

function discoverConfiguredModel(provider, configuration) {
  const home = configuration.home;
  if (provider === PROVIDERS.codex) {
    try {
      const text = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"),
        match = text.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
      return cleanText(match?.[1]);
    } catch { return ""; }
  }
  if (provider === PROVIDERS.claude) {
    return readJsonModel(path.join(home, ".claude", "settings.json")) || readJsonModel(path.join(home, ".claude.json"));
  }
  if (provider === PROVIDERS.kimi) {
    try {
      const text = fs.readFileSync(path.join(home, ".kimi-code", "config.toml"), "utf8"),
        match = text.match(/^\s*default_model\s*=\s*["']([^"']+)["']/m);
      return cleanText(match?.[1]);
    } catch { return ""; }
  }
  return "";
}

async function createRichUi(options = {}) {
  const prompts = await import("@inquirer/prompts"), inputStream = options.input || process.stdin,
    output = options.output || process.stdout, context = { input:inputStream, output };
  const ansi = (code, text) => output.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text;
  return {
    interactive: Boolean(inputStream.isTTY && output.isTTY),
    async select(message, choices, defaultValue) {
      return prompts.select({ message, choices, default:defaultValue, pageSize:12, loop:false }, context);
    },
    async input(message, defaultValue = "", validate) {
      return prompts.input({ message, default:defaultValue, validate }, context);
    },
    async password(message) {
      return prompts.password({ message, mask:"•" }, context);
    },
    async confirm(message, defaultValue = false) {
      return prompts.confirm({ message, default:defaultValue }, context);
    },
    header(title, breadcrumb, detail = "") {
      if (output.isTTY) output.write("\u001b[2J\u001b[H");
      output.write(`${ansi("1;36", "PenEcho Configuration")}  ${ansi("2", breadcrumb)}\n`);
      output.write(`${ansi("1", title)}\n`);
      if (detail) output.write(`${detail}\n`);
      output.write("\n");
    },
    note(title, message, kind = "info") {
      const color = kind === "success" ? "32" : kind === "error" ? "31" : kind === "warning" ? "33" : "36";
      output.write(`\n${ansi(`1;${color}`, title)}\n${String(message).trim()}\n`);
    },
    async pause() { await prompts.input({ message:"Press Enter to return" }, context); },
  };
}

function textValidator(label, options = {}) {
  return value => {
    const text = cleanText(value);
    if (!text && !options.allowEmpty) return `${label} is required.`;
    if (/[\r\n\0]/.test(text)) return `${label} contains invalid characters.`;
    return true;
  };
}

function numberValidator(label, minimum, maximum, integer = false, exclusiveMinimum = false) {
  return value => {
    const text = cleanText(value), number = Number(text);
    if (!text || !Number.isFinite(number) || (exclusiveMinimum ? number <= minimum : number < minimum) || number > maximum || integer && !Number.isInteger(number)) {
      return exclusiveMinimum
        ? `${label} must be ${integer ? "an integer " : "a number "}larger than ${minimum}.`
        : `${label} must be ${integer ? "an integer " : "a number "}from ${minimum} to ${maximum}.`;
    }
    return true;
  };
}

async function chooseModel(ui, provider, configuration) {
  const env = configuration.env,
    current = cleanText(provider === PROVIDERS.kimi ? env.KIMI_CLI_MODEL : provider === PROVIDERS.codex ? env.CODEX_CLI_MODEL : env.CLAUDE_CLI_MODEL),
    detected = discoverConfiguredModel(provider, configuration);
  const choices = provider === PROVIDERS.kimi
    ? [
        { name:"Use the Kimi Code CLI default", value:"", description:"Do not pass an explicit model." },
        ...(current ? [{ name:`Current PenEcho model: ${current}`, value:current }] : []),
        ...(detected ? [{ name:`Detected Kimi model: ${detected}`, value:detected, description:"Read from ~/.kimi-code/config.toml." }] : []),
        { name:"Enter a model manually…", value:"__manual__", description:"Use any model alias supported by your installed Kimi CLI." },
      ]
    : provider === PROVIDERS.codex
    ? [
        { name:"Use the Codex CLI default", value:"", description:"Do not pass an explicit model." },
        ...(current ? [{ name:`Current PenEcho model: ${current}`, value:current }] : []),
        ...(detected ? [{ name:`Detected Codex model: ${detected}`, value:detected, description:"Read from ~/.codex/config.toml." }] : []),
        { name:"gpt-5.6-sol (recommended)", value:"gpt-5.6-sol", description:"Best current choice for PenEcho." },
        { name:"gpt-5.5", value:"gpt-5.5", description:"Minimum recommended generation." },
        { name:"Enter a model manually…", value:"__manual__", description:"Use any model ID supported by your installed CLI." },
      ]
    : [
        { name:"Use the Claude CLI default", value:"", description:"Do not pass an explicit model." },
        ...(current ? [{ name:`Current PenEcho model: ${current}`, value:current }] : []),
        ...(detected ? [{ name:`Detected Claude model: ${detected}`, value:detected, description:"Read from the local Claude settings when available." }] : []),
        { name:"Opus alias (recommended for Opus 4.8 or newer)", value:"opus", description:"Uses the Opus alias resolved by your installed Claude CLI." },
        { name:"claude-opus-4-6", value:"claude-opus-4-6", description:"Supported, but PenEcho quality may be lower." },
        { name:"Sonnet alias", value:"sonnet", description:"Supported, but PenEcho quality may be lower." },
        { name:"Enter a model manually…", value:"__manual__", description:"Use any model ID or alias supported by your installed CLI." },
      ];
  const selected = await ui.select("Model", uniqueChoices(choices), current || "");
  if (selected !== "__manual__") return selected;
  return cleanText(await ui.input("Model ID or alias", current || detected, textValidator("Model")));
}

async function chooseEffort(ui, provider, current, format = "") {
  const isKimi = provider === PROVIDERS.kimi, isCodex = provider === PROVIDERS.codex, isClaude = provider === PROVIDERS.claude,
    defaultValue = current || "medium";
  const levels = isCodex
    ? [["low","Low"],["medium","Medium (recommended default)"],["high","High"],["xhigh","Extra high"],["max","Maximum"]]
    : isKimi
      ? [["none","None (maps to Kimi low)"],["low","Low"],["medium","Medium (maps to Kimi high)"],["high","High"],["xhigh","Extra high (maps to Kimi max)"],["max","Max"]]
      : isClaude
      ? [["none","None (thinking disabled)"],["low","Low"],["medium","Medium (recommended default)"],["high","High"],["xhigh","Extra high"],["max","Max"]]
      : format === "anthropic"
        ? [["none","None (thinking disabled)"],["low","Low"],["medium","Medium (recommended default)"],["high","High"],["xhigh","Extra high"],["max","Max"]]
        : [["low","Low"],["medium","Medium"],["high","High"],["xhigh","Extra high (OpenAI-compatible maximum)"],["max","Max"]];
  const choices = [
    ...((isKimi || isCodex || isClaude) ? [{ name:`Use the ${isKimi ? "Kimi" : isCodex ? "Codex" : "Claude"} CLI default`, value:"", description:"Do not pass an explicit effort." }] : []),
    ...levels.map(([value, name]) => ({ name, value })),
    ...(current && !levels.some(([value]) => value === current) ? [{ name:`Current custom value: ${current}`, value:current }] : []),
    { name:"Enter a value manually…", value:"__manual__", description:"For model-specific or future effort levels." },
  ];
  const selected = await ui.select("Reasoning effort", uniqueChoices(choices), defaultValue);
  if (selected !== "__manual__") return selected;
  return cleanText(await ui.input("Effort value", current, textValidator("Effort")));
}

async function finishProviderConfiguration(ui, configuration, values, options) {
  const action = await ui.select("Action", [
    { name:"Test & Save", value:"save", description:"Save first, then send one small image request through the selected model." },
    { name:"Cancel", value:"cancel", description:"Discard these changes and return." },
  ], "save");
  if (action === "cancel") return false;
  await options.save(values);
  ui.note("Configuration saved", configuration.configFile, "success");
  try {
    const result = await options.test(values.AI_PROVIDER);
    ui.note("Configuration check passed", result, "success");
  } catch (error) {
    ui.note("Configuration check failed — configuration was still saved", error.message, "error");
  }
  await ui.pause();
  return true;
}

async function configureClaude(ui, configuration, options) {
  ui.header("Claude CLI", "Main menu  ›  LLM source  ›  Claude CLI",
    "For best canvas reasoning, prefer Opus 4.8 or newer. Sonnet and Opus 4.6 can respond, but results may be noticeably weaker.");
  const model = await chooseModel(ui, PROVIDERS.claude, configuration),
    effort = await chooseEffort(ui, PROVIDERS.claude, cleanText(configuration.env.AI_EFFORT));
  return finishProviderConfiguration(ui, configuration, {
    AI_PROVIDER:PROVIDERS.claude,
    CLAUDE_CLI_MODEL:model,
    AI_EFFORT:effort,
  }, options);
}

async function configureKimi(ui, configuration, options) {
  ui.header("Kimi CLI", "Main menu  ›  LLM source  ›  Kimi CLI",
    "Kimi Code CLI runs locally. PenEcho does not install or log in for you.\nmacOS/Linux: curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash\nWindows PowerShell: irm https://code.kimi.com/kimi-code/install.ps1 | iex\nThen run: kimi --version; kimi login\nOfficial guide: https://github.com/MoonshotAI/kimi-code");
  const model = await chooseModel(ui, PROVIDERS.kimi, configuration),
    effort = await chooseEffort(ui, PROVIDERS.kimi, cleanText(configuration.env.AI_EFFORT));
  return finishProviderConfiguration(ui, configuration, {
    AI_PROVIDER:PROVIDERS.kimi,
    KIMI_CLI_MODEL:model,
    AI_EFFORT:effort,
  }, options);
}

async function configureCodex(ui, configuration, options) {
  ui.header("Codex CLI", "Main menu  ›  LLM source  ›  Codex CLI",
    "Use GPT-5.5 or newer. gpt-5.6-sol is recommended and supports PenEcho's medium default plus higher effort levels.");
  const model = await chooseModel(ui, PROVIDERS.codex, configuration),
    effort = await chooseEffort(ui, PROVIDERS.codex, cleanText(configuration.env.AI_EFFORT));
  return finishProviderConfiguration(ui, configuration, {
    AI_PROVIDER:PROVIDERS.codex,
    CODEX_CLI_MODEL:model,
    AI_EFFORT:effort,
  }, options);
}

async function configureApi(ui, configuration, options) {
  ui.header("API", "Main menu  ›  LLM source  ›  API",
    "Choose the wire format used by your endpoint. Compatible gateways and local services are supported.");
  const env = configuration.env, currentFormat = apiValue(env, "FORMAT").toLowerCase(),
    format = await ui.select("API type", [
      { name:"OpenAI-compatible", value:"openai", description:"Uses the Chat Completions request format." },
      { name:"Anthropic / Claude-compatible", value:"anthropic", description:"Uses the Claude Messages request format." },
    ], ["openai","anthropic"].includes(currentFormat) ? currentFormat : "openai"),
    sameFormat = format === currentFormat,
    defaultUrl = sameFormat && apiValue(env, "URL") || (format === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"),
    defaultModel = sameFormat && apiValue(env, "MODEL") || (format === "anthropic" ? "claude-opus-4-8" : "gpt-5.6-sol"),
    apiUrl = cleanText(await ui.input("API base URL", defaultUrl, value => {
      try {
        const url = new URL(cleanText(value));
        return ["http:","https:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? true : "Enter a valid HTTP(S) URL without embedded credentials.";
      } catch { return "Enter a valid HTTP(S) URL."; }
    })),
    model = cleanText(await ui.input("Model", defaultModel, textValidator("Model"))),
    effort = await chooseEffort(ui, PROVIDERS.api, sameFormat ? cleanText(env.AI_EFFORT) : "", format),
    currentKey = apiValue(env, "KEY"), enteredKey = cleanText(await ui.password(currentKey ? "API key (leave blank to keep the saved key)" : "API key")),
    key = enteredKey || currentKey;
  if (!key) {
    ui.note("API key required", "Enter an API key before using Test & Save.", "error");
    await ui.pause();
    return false;
  }
  return finishProviderConfiguration(ui, configuration, {
    AI_PROVIDER:PROVIDERS.api,
    AI_API_FORMAT:format,
    AI_API_URL:apiUrl,
    AI_API_MODEL:model,
    AI_API_KEY:key,
    AI_EFFORT:effort,
  }, options);
}

async function configureSettings(ui, configuration, options) {
  const env = configuration.env;
  const savedMaxTokens = configuredMaxTokens(env.MAX_TOKENS);
  ui.header("Settings", "Main menu  ›  Settings",
    `Request details are stored in ${path.join(configuration.stateDir, "logs", "requests")} when recording is enabled.`);
  const legacyTimeout = cleanText(env.CODEX_CLI_TIMEOUT_SECONDS || env.CLAUDE_CLI_TIMEOUT_SECONDS),
    timeout = cleanText(await ui.input("Unified model timeout in seconds", cleanText(env.AI_TIMEOUT_SECONDS) || legacyTimeout || "180", numberValidator("Timeout", 10, 600, true))),
    maxTokens = cleanText(await ui.input("Maximum response tokens (including thinking)", String(savedMaxTokens ?? DEFAULT_MAX_TOKENS), numberValidator("MAX_TOKENS", MIN_MAX_TOKENS, Number.MAX_SAFE_INTEGER, true, true))),
    currentImageFormat = ["webp","png"].includes(cleanText(env.PENECHO_AI_IMAGE_FORMAT).toLowerCase()) ? cleanText(env.PENECHO_AI_IMAGE_FORMAT).toLowerCase() : "webp",
    imageFormat = await ui.select("Image format sent to the model", [
      { name:"WebP (recommended, default)", value:"webp", description:"Lossless and usually much smaller; applies to API, Kimi CLI, Codex CLI, and Claude CLI." },
      { name:"PNG", value:"png", description:"Send the original lossless canvas image without conversion." },
    ], currentImageFormat),
    trace = await ui.confirm("Record complete AI request details", /^(?:1|true|yes|on)$/i.test(cleanText(env.PENECHO_REQUEST_TRACE))),
    traceLimit = cleanText(await ui.input("Maximum retained request records", cleanText(env.PENECHO_REQUEST_TRACE_LIMIT) || "100", numberValidator("Retention", 1, 1000, true))),
    currentHost = cleanText(env.HOST) || "0.0.0.0",
    hostChoice = await ui.select("Listening interface", uniqueChoices([
      { name:"All network interfaces (LAN access)", value:"0.0.0.0", description:"Reach PenEcho from this computer and the local network." },
      { name:"This computer only", value:"127.0.0.1", description:"Only local browser connections are accepted." },
      ...(!["0.0.0.0","127.0.0.1"].includes(currentHost) ? [{ name:`Current custom interface: ${currentHost}`, value:currentHost }] : []),
      { name:"Enter an interface manually…", value:"__manual__" },
    ]), currentHost),
    host = hostChoice === "__manual__" ? cleanText(await ui.input("Host or interface address", currentHost, textValidator("Host"))) : hostChoice,
    port = cleanText(await ui.input("Listening port", cleanText(env.PORT) || "3888", numberValidator("Port", 0, 65535, true))),
    autoDelay = cleanText(await ui.input("Initial Auto AI delay in seconds", cleanText(env.AUTO_AI_DELAY_SECONDS) || "5", numberValidator("Auto AI delay", 0, 10)));
  ui.note("Auto AI delay", "This is the startup value. It can also be changed directly on the canvas.");
  ui.note("Response token limit", "This includes thinking tokens. Do not set it too low or the model may run out of budget while reasoning.");
  const action = await ui.select("Action", [
    { name:"Save settings", value:"save" },
    { name:"Cancel", value:"cancel" },
  ], "save");
  if (action === "cancel") return false;
  await options.save({
    AI_TIMEOUT_SECONDS:timeout,
    MAX_TOKENS:maxTokens,
    PENECHO_AI_IMAGE_FORMAT:imageFormat,
    PENECHO_REQUEST_TRACE:trace ? "true" : "false",
    PENECHO_REQUEST_TRACE_LIMIT:traceLimit,
    HOST:host,
    PORT:port,
    AUTO_AI_DELAY_SECONDS:autoDelay,
    CODEX_CLI_TIMEOUT_SECONDS:null,
    CLAUDE_CLI_TIMEOUT_SECONDS:null,
  });
  ui.note("Settings saved", `Request records: ${path.join(configuration.stateDir, "logs", "requests")}`, "success");
  await ui.pause();
  return true;
}

async function llmSourceMenu(ui, configuration, options, directProvider = "") {
  let requested = directProvider;
  while (true) {
    if (!requested) {
      ui.header("LLM source", "Main menu  ›  LLM source",
        `Current source: ${configuration.env.AI_PROVIDER || "not configured"}`);
      requested = await ui.select("Select an LLM source", [
        { name:"Kimi CLI", value:PROVIDERS.kimi, description:"Use your authenticated local Kimi Code CLI installation." },
        { name:"Claude CLI", value:PROVIDERS.claude, description:"Use your authenticated Claude Code installation." },
        { name:"Codex CLI", value:PROVIDERS.codex, description:"Use your authenticated OpenAI Codex CLI installation." },
        { name:"API", value:PROVIDERS.api, description:"Use an OpenAI- or Anthropic-compatible HTTP API." },
        { name:"Back", value:"__back__" },
      ], configuration.env.AI_PROVIDER || PROVIDERS.codex);
    }
    if (requested === "__back__") return;
    if (requested === PROVIDERS.kimi) await configureKimi(ui, configuration, options);
    else if (requested === PROVIDERS.claude) await configureClaude(ui, configuration, options);
    else if (requested === PROVIDERS.codex) await configureCodex(ui, configuration, options);
    else if (requested === PROVIDERS.api) await configureApi(ui, configuration, options);
    if (directProvider) return;
    requested = "";
  }
}

async function runConfigureMenu(configuration, options = {}) {
  const ui = options.ui || await createRichUi({ input:options.input, output:options.output });
  if (!ui.interactive && !options.allowNonInteractive) throw new Error("Interactive configuration requires a terminal.");
  const actions = { save:options.save, test:options.test };
  if (options.directProvider) {
    await llmSourceMenu(ui, configuration, actions, options.directProvider);
    return;
  }
  while (true) {
    ui.header("Main menu", "Main menu",
      `Configuration file: ${configuration.configFile}\nCurrent LLM source: ${configuration.env.AI_PROVIDER || "not configured"}`);
    const action = await ui.select("Choose a section", [
      { name:"LLM source", value:"llm", description:"Configure Kimi CLI, Claude CLI, Codex CLI, or an HTTP API." },
      { name:"Settings", value:"settings", description:"Timeout, model image format, request recording, network, port, and Auto AI delay." },
      { name:"Exit", value:"exit" },
    ], "llm");
    if (action === "exit") return;
    if (action === "llm") await llmSourceMenu(ui, configuration, actions);
    else await configureSettings(ui, configuration, actions);
  }
}

function isPromptExit(error) {
  return error?.name === "ExitPromptError" || error?.name === "AbortPromptError";
}

module.exports = {
  createRichUi,
  discoverConfiguredModel,
  isPromptExit,
  runConfigureMenu,
};
