"use strict";

const { DEFAULT_REASONING_EFFORT } = require("../src/providers/reasoning-effort.js");

const PROVIDERS = new Set(["api", "kimi", "kimi-cli", "codex-cli", "claude-cli"]);
const FORMATS = new Set(["openai", "anthropic"]);
const KIMI_PRODUCTS = new Set(["code", "platform"]);
const KIMI_REGIONS = new Set(["global", "china"]);
const KIMI_ENDPOINTS = Object.freeze({
  code:Object.freeze({ openai:"https://api.kimi.com/coding/v1", anthropic:"https://api.kimi.com/coding" }),
  platform:Object.freeze({ china:"https://api.moonshot.cn/v1", global:"https://api.moonshot.ai/v1" }),
});
const KIMI_MODELS = Object.freeze({ code:"k3", platform:"kimi-k3" });
const KIMI_PRESET_ENDPOINTS = new Set([
  ...Object.values(KIMI_ENDPOINTS.code),
  ...Object.values(KIMI_ENDPOINTS.platform),
]);
const KIMI_PRESET_MODELS = new Set(Object.values(KIMI_MODELS));
const IMAGE_FORMATS = new Set(["webp", "png"]);
const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

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

function kimiEndpoint(product, region, format) {
  return product === "platform" ? KIMI_ENDPOINTS.platform[region] : KIMI_ENDPOINTS.code[format];
}

function isKimiPresetEndpoint(value) {
  return KIMI_PRESET_ENDPOINTS.has(String(value || "").trim().replace(/\/+$/, ""));
}

function kimiPresetUpdates(configuration) {
  const env = configuration?.env || {},
    desktopProvider = String(env.PENECHO_DESKTOP_PROVIDER || "").toLowerCase();
  if (configuration?.provider !== "api" || desktopProvider !== "kimi") return {};
  const requestedProduct = String(env.PENECHO_KIMI_PRODUCT || "code"),
    requestedRegion = String(env.PENECHO_KIMI_REGION || "global"),
    product = KIMI_PRODUCTS.has(requestedProduct) ? requestedProduct : "code",
    region = KIMI_REGIONS.has(requestedRegion) ? requestedRegion : "global",
    requestedFormat = String(env.AI_API_FORMAT || "openai").toLowerCase(),
    format = product === "platform" || !FORMATS.has(requestedFormat) ? "openai" : requestedFormat,
    canonicalUrl = kimiEndpoint(product, region, format),
    currentUrl = String(env.AI_API_URL || "").trim().replace(/\/+$/, ""),
    currentModel = String(env.AI_API_MODEL || "").trim(),
    updates = {};
  if (requestedProduct !== product) updates.PENECHO_KIMI_PRODUCT = product;
  if (requestedRegion !== region) updates.PENECHO_KIMI_REGION = region;
  if (requestedFormat !== format) updates.AI_API_FORMAT = format;
  if ((!currentUrl || isKimiPresetEndpoint(currentUrl)) && currentUrl !== canonicalUrl) updates.AI_API_URL = canonicalUrl;
  if ((!currentModel || KIMI_PRESET_MODELS.has(currentModel)) && currentModel !== KIMI_MODELS[product]) {
    updates.AI_API_MODEL = KIMI_MODELS[product];
  }
  return updates;
}

function normalizeSettings(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Settings are invalid.");
  const provider = text(input.provider, "AI provider", 32);
  if (!PROVIDERS.has(provider)) throw new Error("Choose a supported AI provider.");
  const imageFormat = text(input.imageFormat || "webp", "Image format", 16);
  if (!IMAGE_FORMATS.has(imageFormat)) throw new Error("Choose WebP or PNG image transport.");
  const effort = text(input.effort || DEFAULT_REASONING_EFFORT, "Reasoning effort", 32).toLowerCase();
  if (!EFFORTS.has(effort)) throw new Error("Choose a supported reasoning effort.");
  const host = text(input.host || "127.0.0.1", "Listening interface", 64);
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) throw new Error("Choose local-only or LAN listening.");
  const port = number(input.port ?? 3888, "Port", 0, 65535, true);
  const timeout = number(input.timeout ?? 180, "Model timeout", 10, 600, true);
  const autoDelay = number(input.autoDelay ?? 5, "Auto AI delay", 0, 10);
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
    KIMI_CLI_TIMEOUT_SECONDS:null,
    CODEX_CLI_TIMEOUT_SECONDS:null,
    CLAUDE_CLI_TIMEOUT_SECONDS:null,
  };
  let apiKey = "";
  if (provider === "api" || provider === "kimi") {
    const format = text(input.apiFormat || "openai", "API format", 32).toLowerCase();
    if (!FORMATS.has(format)) throw new Error("Choose OpenAI-compatible or Anthropic-compatible API format.");
    let apiUrl = endpoint(input.apiUrl), apiModel = text(input.apiModel, "API model", 256);
    if (provider === "kimi") {
      const product = text(input.kimiProduct || "code", "Kimi service", 32), region = text(input.kimiRegion || "global", "Kimi access region", 32);
      if (!KIMI_PRODUCTS.has(product)) throw new Error("Choose Kimi Code or Kimi Open Platform.");
      if (!KIMI_REGIONS.has(region)) throw new Error("Choose Global or Mainland China Kimi access.");
      if (product === "platform" && format !== "openai") throw new Error("Kimi Open Platform uses the OpenAI-compatible API format.");
      if (isKimiPresetEndpoint(apiUrl)) apiUrl = kimiEndpoint(product, region, format);
      if (KIMI_PRESET_MODELS.has(apiModel)) apiModel = KIMI_MODELS[product];
      Object.assign(updates, { PENECHO_KIMI_PRODUCT:product, PENECHO_KIMI_REGION:region });
    }
    apiKey = text(input.apiKey ?? "", "API key", 4096, true);
    if (!apiKey && !options.hasSavedApiKey) throw new Error("API key is required.");
    Object.assign(updates, {
      AI_API_FORMAT:format,
      AI_API_URL:apiUrl,
      AI_API_MODEL:apiModel,
      AI_API_KEY:null,
    });
  } else if (provider === "kimi-cli") {
    Object.assign(updates, {
      KIMI_CLI_MODEL:text(input.kimiCliModel ?? "", "Kimi model", 256, true),
      KIMI_CLI_PATH:text(input.kimiCliPath ?? "", "Kimi executable", 1024, true) || null,
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
  const sourceEnv = configuration.env || {},
    env = { ...sourceEnv, ...kimiPresetUpdates(configuration) },
    desktopProvider = String(env.PENECHO_DESKTOP_PROVIDER || "").toLowerCase(),
    provider = configuration.provider === "api" && desktopProvider === "kimi" ? "kimi" : configuration.provider || "api",
    configuredKimiProduct = String(env.PENECHO_KIMI_PRODUCT || "code"),
    configuredKimiRegion = String(env.PENECHO_KIMI_REGION || "global"),
    kimiProduct = KIMI_PRODUCTS.has(configuredKimiProduct) ? configuredKimiProduct : "code",
    kimiRegion = KIMI_REGIONS.has(configuredKimiRegion) ? configuredKimiRegion : "global",
    requestedFormat = String(env.AI_API_FORMAT || "openai").toLowerCase(),
    configuredFormat = FORMATS.has(requestedFormat) ? requestedFormat : "openai",
    apiFormat = provider === "kimi" && kimiProduct === "platform" ? "openai" : configuredFormat,
    kimiPresetUrl = kimiEndpoint(kimiProduct, kimiRegion, apiFormat),
    configuredApiUrl = String(env.AI_API_URL || (provider === "kimi" ? kimiPresetUrl : "https://api.openai.com/v1")),
    configuredApiModel = String(env.AI_API_MODEL || (provider === "kimi" ? KIMI_MODELS[kimiProduct] : "gpt-5.6-sol"));
  return {
    version:options.version || "",
    firstRun:configuration.configExists !== true,
    provider,
    apiFormat,
    apiUrl:provider === "kimi" && isKimiPresetEndpoint(configuredApiUrl) ? kimiPresetUrl : configuredApiUrl,
    apiModel:provider === "kimi" && KIMI_PRESET_MODELS.has(configuredApiModel) ? KIMI_MODELS[kimiProduct] : configuredApiModel,
    apiKeySaved:options.hasSavedApiKey === true,
    kimiProduct,
    kimiRegion,
    kimiCliModel:String(env.KIMI_CLI_MODEL || ""),
    kimiCliPath:String(env.KIMI_CLI_PATH || ""),
    codexModel:String(env.CODEX_CLI_MODEL || "gpt-5.6-sol"),
    codexPath:String(env.CODEX_CLI_PATH || ""),
    claudeModel:String(env.CLAUDE_CLI_MODEL || "opus"),
    claudePath:String(env.CLAUDE_CLI_PATH || ""),
    effort:String(env.AI_EFFORT || "medium"),
    timeout:String(env.AI_TIMEOUT_SECONDS || "180"),
    imageFormat:String(env.PENECHO_AI_IMAGE_FORMAT || "webp"),
    autoDelay:String(env.AUTO_AI_DELAY_SECONDS || "5"),
    host:String(env.HOST || "0.0.0.0"),
    port:String(env.PORT || "3888"),
    requestTrace:/^(?:1|true|yes|on)$/i.test(String(env.PENECHO_REQUEST_TRACE || "false")),
    traceLimit:String(env.PENECHO_REQUEST_TRACE_LIMIT || "100"),
    configFile:configuration.configFile,
    stateDir:configuration.stateDir,
  };
}

module.exports = { kimiPresetUpdates, normalizeSettings, publicSettings };
