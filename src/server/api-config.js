"use strict";

const { DEFAULT_REASONING_EFFORT, apiReasoningParameters } = require("../providers/reasoning-effort.js");

const DEFAULT_MAX_TOKENS = 20000;
const MIN_MAX_TOKENS = 15000;

const NOVITA_ENDPOINTS = Object.freeze({
  openaiBaseUrl:"https://api.novita.ai/openai/v1",
  anthropicBaseUrl:"https://api.novita.ai/anthropic",
  docsRoot:"https://novita.ai/docs",
});

const NOVITA_MODELS = Object.freeze({
  "moonshotai/kimi-k3":Object.freeze({
    modelId:"moonshotai/kimi-k3",
    contextWindow:1048576,
    pricingUsdPerMillionTokens:Object.freeze({ input:3.0, output:15.0, cacheRead:0.3, cacheWrite:null }),
    inputModalities:Object.freeze(["text", "image", "video"]),
    thinking:Object.freeze(["adaptive", "disabled"]),
  }),
});

function resolveApiConfig(value, formatOverride) {
  if (!value) return null;
  const requestedFormat = String(formatOverride || "").trim().toLowerCase();
  if (requestedFormat && !["openai", "anthropic"].includes(requestedFormat)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.hash = "";
    const basePath = url.pathname.replace(/\/+$/, ""), path = basePath.toLowerCase(),
      explicitAnthropic = path.endsWith("/v1/messages"), explicitOpenAi = path.endsWith("/chat/completions");
    if (requestedFormat === "openai" && explicitAnthropic || requestedFormat === "anthropic" && explicitOpenAi) return null;
    if (explicitAnthropic) {
      url.pathname = basePath;
      return { format: "anthropic", endpoint: url.href };
    }
    if (explicitOpenAi) {
      url.pathname = basePath;
      return { format: "openai", endpoint: url.href };
    }
    const openaiBase = path.endsWith("/v1") || /\/(?:v1beta\/)?openai$/i.test(path),
      format = requestedFormat || (openaiBase ? "openai" : "anthropic");
    url.pathname = format === "openai" ? `${basePath}/chat/completions` : `${basePath}/v1/messages`;
    return { format, endpoint: url.href };
  } catch {
    return null;
  }
}

function normalizedApiEffort(format, value) {
  const effort = String(value || "").trim();
  return effort || DEFAULT_REASONING_EFFORT;
}

function anthropicEffortParameters(effort, enableThinking = true, options = {}) {
  const parameters = apiReasoningParameters({ ...options, apiFormat:"anthropic", effort:normalizedApiEffort("anthropic", effort) });
  if (enableThinking || parameters.thinking?.type === "disabled") return parameters;
  const { thinking, ...rest } = parameters;
  return rest;
}

function configuredMaxTokens(value, fallback = DEFAULT_MAX_TOKENS) {
  const text = String(value ?? "").trim(), parsed = text ? Number(text) : fallback;
  return Number.isSafeInteger(parsed) && parsed > MIN_MAX_TOKENS ? parsed : null;
}

function anthropicResponseMaxTokens(effort, maxTokens = DEFAULT_MAX_TOKENS) {
  return configuredMaxTokens(maxTokens) || DEFAULT_MAX_TOKENS;
}

module.exports = {
  DEFAULT_MAX_TOKENS,
  MIN_MAX_TOKENS,
  NOVITA_ENDPOINTS,
  NOVITA_MODELS,
  anthropicEffortParameters,
  anthropicResponseMaxTokens,
  configuredMaxTokens,
  normalizedApiEffort,
  resolveApiConfig,
};
