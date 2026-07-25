"use strict";

const PROVIDERS = new Set(["api", "kimi", "codex-cli", "claude-cli"]);
const FORMATS = new Set(["openai", "anthropic"]);
const KIMI_PRODUCTS = new Set(["code", "platform"]);
const KIMI_REGIONS = new Set(["global", "china"]);
const KIMI_MODELS = Object.freeze({ code:"k3", platform:"kimi-k3" });
const IMAGE_FORMATS = new Set(["webp", "png"]);
const EFFORTS = new Set(["", "none", "low", "medium", "high", "xhigh", "max"]);

function text(value, label, maximum = 512, allowEmpty = false) {
  const result = String(value ?? "").trim();
  if (!allowEmpty && !result) throw new Error(`${label} is required.`);
  if (result.length > maximum || /[\r\n\0]/.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}

function number(value, label, minimum, maximum, integer = false) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum || integer && !Number.isInteger(result)) {
    throw new Error(`${label} must be ${integer ? "an integer " : "a number "}from ${minimum} to ${maximum}.`);
  }
  return result;
}

function endpoint(value) {
  const result = text(value, "API base URL", 1024);
  let url;
  try { url = new URL(result); } catch { throw new Error("Enter a valid API base URL."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error("API base URL must be HTTP(S) without embedded credentials.");
  }
  return result.replace(/\/$/, "");
}

function normalizeSettings(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Settings are invalid.");
  const provider = text(input.provider, "AI provider", 32);
  if (!PROVIDERS.has(provider)) throw new Error("Choose a supported AI provider.");
  const imageFormat = text(input.imageFormat || "webp", "Image format", 16);
  if (!IMAGE_FORMATS.has(imageFormat)) throw new Error("Choose WebP or PNG image transport.");
  const effort = text(input.effort ?? "", "Reasoning effort", 32, true).toLowerCase();
  if (!EFFORTS.has(effort)) throw new Error("Choose a supported reasoning effort.");
  const host = text(input.host || "127.0.0.1", "Listening interface", 64);
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) throw new Error("Choose local-only or LAN listening.");
  const port = number(input.port ?? 3888, "Port", 0, 65535, true);
  const timeout = number(input.timeout ?? 180, "Model timeout", 10, 600, true);
  const autoDelay = number(input.autoDelay ?? 1.2, "Auto AI delay", 0, 10);
  const traceLimit = number(input.traceLimit ?? 100, "Request record limit", 1, 1000, true);
  const updates = {
    AI_PROVIDER:provider === "kimi" ? "api" : provider,
    PENECHO_DESKTOP_PROVIDER:provider,
    AI_EFFORT:effort,
    AI_TIMEOUT_SECONDS:String(timeout),
    PENECHO_AI_IMAGE_FORMAT:imageFormat,
    AUTO_AI_DELAY_SECONDS:String(autoDelay),
    HOST:host,
    PORT:String(port),
    PENECHO_REQUEST_TRACE:input.requestTrace === true ? "true" : "false",
    PENECHO_REQUEST_TRACE_LIMIT:String(traceLimit),
    CODEX_CLI_TIMEOUT_SECONDS:null,
    CLAUDE_CLI_TIMEOUT_SECONDS:null,
  };
  let apiKey = "";
  if (provider === "api" || provider === "kimi") {
    const format = text(input.apiFormat || "openai", "API format", 32).toLowerCase();
    if (!FORMATS.has(format)) throw new Error("Choose OpenAI-compatible or Anthropic-compatible API format.");
    if (provider === "kimi") {
      const product = text(input.kimiProduct || "code", "Kimi service", 32), region = text(input.kimiRegion || "global", "Kimi access region", 32);
      if (!KIMI_PRODUCTS.has(product)) throw new Error("Choose Kimi Code or Kimi Open Platform.");
      if (!KIMI_REGIONS.has(region)) throw new Error("Choose Global or Mainland China Kimi access.");
      if (product === "platform" && format !== "openai") throw new Error("Kimi Open Platform uses the OpenAI-compatible API format.");
      Object.assign(updates, { PENECHO_KIMI_PRODUCT:product, PENECHO_KIMI_REGION:region });
    }
    apiKey = text(input.apiKey ?? "", "API key", 4096, true);
    if (!apiKey && !options.hasSavedApiKey) throw new Error("API key is required.");
    Object.assign(updates, {
      AI_API_FORMAT:format,
      AI_API_URL:endpoint(input.apiUrl),
      AI_API_MODEL:text(input.apiModel, "API model", 256),
      AI_API_KEY:null,
    });
  } else if (provider === "codex-cli") {
    Object.assign(updates, {
      CODEX_CLI_MODEL:text(input.codexModel ?? "", "Codex model", 256, true),
      CODEX_CLI_PATH:text(input.codexPath ?? "", "Codex executable", 1024, true) || null,
    });
  } else {
    Object.assign(updates, {
      CLAUDE_CLI_MODEL:text(input.claudeModel ?? "", "Claude model", 256, true),
      CLAUDE_CLI_PATH:text(input.claudePath ?? "", "Claude executable", 1024, true) || null,
    });
  }
  return { provider, updates, apiKey };
}

function publicSettings(configuration, options = {}) {
  const env = configuration.env || {}, desktopProvider = String(env.PENECHO_DESKTOP_PROVIDER || "").toLowerCase(),
    provider = configuration.provider === "api" && desktopProvider === "kimi" ? "kimi" : configuration.provider || "api",
    kimiProduct = String(env.PENECHO_KIMI_PRODUCT || "code");
  return {
    version:options.version || "",
    firstRun:configuration.configExists !== true,
    provider,
    apiFormat:String(env.AI_API_FORMAT || "openai").toLowerCase(),
    apiUrl:String(env.AI_API_URL || (provider === "kimi" ? "https://api.kimi.com/coding/v1" : "https://api.openai.com/v1")),
    apiModel:String(env.AI_API_MODEL || (provider === "kimi" ? KIMI_MODELS[kimiProduct] || KIMI_MODELS.code : "gpt-5.6-sol")),
    apiKeySaved:options.hasSavedApiKey === true,
    kimiProduct,
    kimiRegion:String(env.PENECHO_KIMI_REGION || "global"),
    codexModel:String(env.CODEX_CLI_MODEL || "gpt-5.6-sol"),
    codexPath:String(env.CODEX_CLI_PATH || ""),
    claudeModel:String(env.CLAUDE_CLI_MODEL || "opus"),
    claudePath:String(env.CLAUDE_CLI_PATH || ""),
    effort:String(env.AI_EFFORT || "xhigh"),
    timeout:String(env.AI_TIMEOUT_SECONDS || "180"),
    imageFormat:String(env.PENECHO_AI_IMAGE_FORMAT || "webp"),
    autoDelay:String(env.AUTO_AI_DELAY_SECONDS || "1.2"),
    host:String(env.HOST || "0.0.0.0"),
    port:String(env.PORT || "3888"),
    requestTrace:/^(?:1|true|yes|on)$/i.test(String(env.PENECHO_REQUEST_TRACE || "false")),
    traceLimit:String(env.PENECHO_REQUEST_TRACE_LIMIT || "100"),
    configFile:configuration.configFile,
    stateDir:configuration.stateDir,
  };
}

module.exports = { normalizeSettings, publicSettings };
