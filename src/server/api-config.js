"use strict";

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
  "zai-org/glm-5.2":Object.freeze({
    modelId:"zai-org/glm-5.2",
    contextWindow:1048576,
    pricingUsdPerMillionTokens:Object.freeze({ input:1.4, output:4.4, cacheRead:0.26, cacheWrite:null }),
    inputModalities:Object.freeze(["text"]),
    thinking:Object.freeze(["adaptive", "disabled"]),
  }),
  "deepseek/deepseek-v4-flash-0731":Object.freeze({
    modelId:"deepseek/deepseek-v4-flash-0731",
    contextWindow:1048576,
    pricingUsdPerMillionTokens:Object.freeze({ input:0.14, output:0.28, cacheRead:0.028, cacheWrite:null }),
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
