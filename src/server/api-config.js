"use strict";

const NOVITA_ENDPOINTS = Object.freeze({
  openaiBaseUrl:"https://api.novita.ai/openai/v1",
  anthropicBaseUrl:"https://api.novita.ai/anthropic",
  docsRoot:"https://novita.ai/docs",
});

const NOVITA_MODELS = Object.freeze({
  "deepseek/deepseek-v3.2-exp":Object.freeze({
    modelId:"deepseek/deepseek-v3.2-exp",
    contextWindow:163840,
    pricingUsdPerMillionTokens:Object.freeze({ input:0.27, output:0.41, cacheRead:null, cacheWrite:null }),
    inputModalities:Object.freeze(["text"]),
    thinking:Object.freeze(["adaptive", "disabled"]),
  }),
  "moonshotai/Kimi-K2-Instruct":Object.freeze({
    modelId:"moonshotai/Kimi-K2-Instruct",
    contextWindow:131072,
    pricingUsdPerMillionTokens:Object.freeze({ input:0.57, output:2.3, cacheRead:null, cacheWrite:null }),
    inputModalities:Object.freeze(["text"]),
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
  return effort || (format === "anthropic" ? "medium" : "max");
}

function anthropicEffortParameters(effort, enableThinking = true) {
  const normalized = normalizedApiEffort("anthropic", effort);
  if (normalized.toLowerCase() === "none") return { thinking: { type:"disabled" } };
  return {
    ...(enableThinking ? { thinking: { type:"adaptive" } } : {}),
    output_config: { effort:normalized },
  };
}

function anthropicResponseMaxTokens(effort) {
  return String(effort || "").trim().toLowerCase() === "max" ? 16384 : 12288;
}

module.exports = {
  NOVITA_ENDPOINTS,
  NOVITA_MODELS,
  anthropicEffortParameters,
  anthropicResponseMaxTokens,
  normalizedApiEffort,
  resolveApiConfig,
};
