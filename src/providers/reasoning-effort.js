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

function mapCodexReasoningEffort(effort, model = "") {
  if (effort === "none") return "low";
  if (effort !== "max") return effort;
  return /^gpt-5\.6(?:$|[-.])/i.test(String(model || "").trim()) ? "max" : "xhigh";
}

function mapOpenAiReasoningEffort(effort, model = "") {
  if (effort !== "max") return effort;
  return /^gpt-5\.6(?:$|[-.])/i.test(String(model || "").trim()) ? "max" : "xhigh";
}

function anthropicModelProfile(model = "") {
  const id = String(model || "").trim().toLowerCase();
  if (!id || !id.startsWith("claude-")) return { supportsEffort:true, adaptiveThinking:true, maximum:"max", supportsXhigh:true };
  if (/^claude-opus-4-5(?:$|[-.])/.test(id)) return { supportsEffort:true, adaptiveThinking:false, maximum:"high", supportsXhigh:false };
  if (/^claude-(?:opus|sonnet)-4-6(?:$|[-.])/.test(id)) return { supportsEffort:true, adaptiveThinking:true, maximum:"max", supportsXhigh:false };
  if (/^claude-opus-4-[78](?:$|[-.])/.test(id) || /^claude-(?:opus|sonnet|fable|mythos)-5(?:$|[-.])/.test(id) || /^claude-mythos-preview(?:$|[-.])/.test(id)) {
    return { supportsEffort:true, adaptiveThinking:true, maximum:"max", supportsXhigh:true };
  }
  return { supportsEffort:false, adaptiveThinking:false, maximum:null, supportsXhigh:false };
}

function mapAnthropicReasoningEffort(effort, model = "") {
  const profile = anthropicModelProfile(model);
  if (!profile.supportsEffort) return null;
  if (profile.maximum === "high" && new Set(["xhigh", "max"]).has(effort)) return "high";
  if (effort === "xhigh" && !profile.supportsXhigh) return "max";
  return effort;
}

function mapClaudeCliReasoningEffort(effort, model = "") {
  if (effort === "none") return "low";
  return mapAnthropicReasoningEffort(effort, model);
}

function reasoningEffortMapping({ provider = "api", apiFormat = "openai", apiPreset = "", apiUrl = "", model = "", effort } = {}) {
  const raw = String(effort || "").trim().toLowerCase(), requested = raw || DEFAULT_REASONING_EFFORT,
    family = provider === "api" ? apiFamily({ apiPreset, apiUrl }) : provider.replace(/-cli$/, "");
  if (family === "kimi") {
    if (provider !== "api") return { requested, family, mode:"reasoning_effort", value:mapKimiReasoningEffort(requested) || requested, canDisable:false };
    const id = String(model || "").trim().toLowerCase();
    if (/^(?:kimi-)?k3(?:$|[-.])/.test(id)) return { requested, family, mode:"reasoning_effort", value:mapKimiReasoningEffort(requested) || requested, canDisable:false };
    if (/^kimi-k2\.7-code(?:$|[-.])/.test(id)) return { requested, family, mode:"native-default", value:null, canDisable:false };
    if (/^kimi-k2\.[56](?:$|[-.])/.test(id)) return { requested, family, mode:"thinking", value:requested === "none" ? "disabled" : "enabled", canDisable:true };
    return { requested, family, mode:"native-default", value:null, canDisable:false };
  }
  if (family === "minimax") {
    const canDisable = /^minimax-m3(?:$|[-.])/i.test(String(model || "").trim());
    return { requested, family, mode:"thinking", value:requested === "none" && canDisable ? "disabled" : "adaptive", canDisable };
  }
  if (provider === "codex-cli") return { requested, family:"codex", mode:"effort", value:mapCodexReasoningEffort(requested, model), canDisable:false };
  if (provider === "claude-cli") return { requested, family:"claude", mode:"effort", value:mapClaudeCliReasoningEffort(requested, model), canDisable:true };
  if (String(apiFormat || "").trim().toLowerCase() === "anthropic") {
    const profile = anthropicModelProfile(model);
    if (requested === "none") return { requested, family:"anthropic", mode:"thinking", value:"disabled", canDisable:true };
    if (!profile.supportsEffort) return { requested, family:"anthropic", mode:"native-default", value:null, canDisable:true };
    return { requested, family:"anthropic", mode:"output_config.effort", value:mapAnthropicReasoningEffort(requested, model), canDisable:true, adaptiveThinking:profile.adaptiveThinking };
  }
  return { requested, family:"openai", mode:"reasoning_effort", value:mapOpenAiReasoningEffort(requested, model), canDisable:requested === "none" };
}

function apiReasoningParameters(options = {}) {
  const mapping = reasoningEffortMapping({ ...options, provider:"api" });
  if (mapping.family === "kimi" && mapping.mode === "thinking") return { thinking:{ type:mapping.value } };
  if (mapping.family === "kimi" && mapping.mode === "native-default") return {};
  if (mapping.family === "minimax") return { thinking:{ type:mapping.value } };
  if (mapping.family === "anthropic") {
    if (mapping.requested === "none") return { thinking:{ type:"disabled" } };
    if (mapping.mode === "native-default") return {};
    return { ...(mapping.adaptiveThinking ? { thinking:{ type:"adaptive" } } : {}), output_config:{ effort:mapping.value } };
  }
  return { reasoning_effort:mapping.value };
}

module.exports = {
  DEFAULT_REASONING_EFFORT,
  PENECHO_REASONING_EFFORTS,
  anthropicModelProfile,
  apiFamily,
  apiReasoningParameters,
  mapAnthropicReasoningEffort,
  mapCodexReasoningEffort,
  mapClaudeCliReasoningEffort,
  mapKimiReasoningEffort,
  mapOpenAiReasoningEffort,
  normalizeReasoningEffort,
  reasoningEffortTimeoutMultiplier,
  reasoningEffortMapping,
};
