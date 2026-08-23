"use strict";

const DEFAULT_REASONING_EFFORT = "medium";
const PENECHO_REASONING_EFFORTS = Object.freeze(["none", "low", "medium", "high", "xhigh", "max"]);
const PENECHO_REASONING_EFFORT_SET = new Set(PENECHO_REASONING_EFFORTS);

function normalizeReasoningEffort(value, fallback = DEFAULT_REASONING_EFFORT) {
  const effort = String(value || "").trim().toLowerCase();
  return PENECHO_REASONING_EFFORT_SET.has(effort) ? effort : fallback;
}

function reasoningEffortTimeoutMultiplier(effort) {
  return new Set(["xhigh", "max"]).has(String(effort || "").trim().toLowerCase()) ? 2 : 1;
}

function apiFamily({ apiPreset = "", apiUrl = "" } = {}) {
  const preset = String(apiPreset || "").trim().toLowerCase();
  if (preset.startsWith("kimi-")) return "kimi";
  if (preset.startsWith("minimax-")) return "minimax";
  let hostname = "";
  try { hostname = new URL(apiUrl).hostname.toLowerCase(); } catch {}
  if (["api.moonshot.ai", "api.moonshot.cn", "api.kimi.com"].includes(hostname)) return "kimi";
  if (["api.minimax.io", "api.minimaxi.com"].includes(hostname)) return "minimax";
  return "generic";
}

function mapKimiReasoningEffort(effort) {
  return { none:"low", low:"low", medium:"high", high:"high", xhigh:"max", max:"max" }[effort];
}

function reasoningEffortMapping({ provider = "api", apiFormat = "openai", apiPreset = "", apiUrl = "", model = "", effort } = {}) {
  const raw = String(effort || "").trim(), requested = raw || DEFAULT_REASONING_EFFORT,
    family = provider === "api" ? apiFamily({ apiPreset, apiUrl }) : provider.replace(/-cli$/, "");
  if (family === "kimi") {
    if (provider !== "api") return { requested, family, mode:"reasoning_effort", value:mapKimiReasoningEffort(requested) || requested, canDisable:false };
    const id = String(model || "").trim().toLowerCase();
    if (/^(?:kimi-)?k3(?:$|[-.])/.test(id)) return { requested, family, mode:"reasoning_effort", value:mapKimiReasoningEffort(requested) || requested, canDisable:false };
    if (/^kimi-k2\.7-code(?:$|[-.])/.test(id)) return { requested, family, mode:"native-default", value:null, canDisable:false };
    if (/^kimi-k2\.[56](?:$|[-.])/.test(id)) return { requested, family, mode:"thinking", value:requested === "none" ? "disabled" : "enabled", canDisable:true };
    return { requested, family, mode:"native-default", value:null, canDisable:false };
  }
  if (provider !== "api") return { requested, family, mode:"effort", value:requested, canDisable:requested === "none" };
  if (String(apiFormat || "").trim().toLowerCase() === "anthropic") {
    if (requested === "none") return { requested, family:"anthropic", mode:"thinking", value:"disabled", canDisable:true };
    return { requested, family:family === "generic" ? "anthropic" : family, mode:"output_config.effort", value:requested, canDisable:true, adaptiveThinking:true };
  }
  return { requested, family:family === "generic" ? "openai" : family, mode:"reasoning_effort", value:requested, canDisable:requested === "none" };
}

function apiReasoningParameters(options = {}) {
  const mapping = reasoningEffortMapping({ ...options, provider:"api" });
  if (mapping.family === "kimi" && mapping.mode === "thinking") return { thinking:{ type:mapping.value } };
  if (mapping.family === "kimi" && mapping.mode === "native-default") return {};
  if (String(options.apiFormat || "").trim().toLowerCase() === "anthropic") {
    if (mapping.requested === "none") return { thinking:{ type:"disabled" } };
    return { thinking:{ type:"adaptive" }, output_config:{ effort:mapping.value } };
  }
  return { reasoning_effort:mapping.value };
}

module.exports = {
  DEFAULT_REASONING_EFFORT,
  PENECHO_REASONING_EFFORTS,
  apiFamily,
  apiReasoningParameters,
  mapKimiReasoningEffort,
  normalizeReasoningEffort,
  reasoningEffortTimeoutMultiplier,
  reasoningEffortMapping,
};
