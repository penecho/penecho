"use strict";

const MINIMAX_ENDPOINTS = Object.freeze({
  global_en:Object.freeze({
    openaiBaseUrl:"https://api.minimax.io/v1",
    anthropicBaseUrl:"https://api.minimax.io/anthropic",
    docsRoot:"https://platform.minimax.io/docs",
  }),
  cn_zh:Object.freeze({
    openaiBaseUrl:"https://api.minimaxi.com/v1",
    anthropicBaseUrl:"https://api.minimaxi.com/anthropic",
    docsRoot:"https://platform.minimaxi.com/docs",
  }),
});

const MINIMAX_MODELS = Object.freeze({
  "MiniMax-M3":Object.freeze({
    modelId:"MiniMax-M3",
    contextWindow:1000000,
    pricingUsdPerMillionTokens:Object.freeze({ input:0.6, output:2.4, cacheRead:0.12, cacheWrite:null }),
    inputModalities:Object.freeze(["text", "image", "video"]),
    thinking:Object.freeze(["adaptive", "disabled"]),
  }),
  "MiniMax-M2.7":Object.freeze({
    modelId:"MiniMax-M2.7",
    contextWindow:204800,
    pricingUsdPerMillionTokens:Object.freeze({ input:0.3, output:1.2, cacheRead:0.06, cacheWrite:0.375 }),
    inputModalities:Object.freeze(["text"]),
    thinking:Object.freeze(["always_on"]),
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
  MINIMAX_ENDPOINTS,
  MINIMAX_MODELS,
  anthropicEffortParameters,
  anthropicResponseMaxTokens,
  normalizedApiEffort,
  resolveApiConfig,
};
