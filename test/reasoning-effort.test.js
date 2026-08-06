"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  apiReasoningParameters,
  anthropicModelProfile,
  mapAnthropicReasoningEffort,
  mapCodexReasoningEffort,
  mapKimiReasoningEffort,
  mapOpenAiReasoningEffort,
  normalizeReasoningEffort,
  reasoningEffortTimeoutMultiplier,
  reasoningEffortMapping,
} = require("../src/providers/reasoning-effort.js");

test("all new reasoning configurations default to medium", () => {
  assert.equal(normalizeReasoningEffort(""), "medium");
  assert.equal(normalizeReasoningEffort("medium"), "medium");
});

test("xhigh and max requests receive twice the configured timeout", () => {
  for (const effort of ["none", "low", "medium", "high", "config", ""]) assert.equal(reasoningEffortTimeoutMultiplier(effort),1);
  for (const effort of ["xhigh", "max", " MAX "]) assert.equal(reasoningEffortTimeoutMultiplier(effort),2);
});

test("Kimi API, CLI, and ACP map the six PenEcho levels onto Kimi's three native levels", () => {
  const expected = { none:"low", low:"low", medium:"high", high:"high", xhigh:"max", max:"max" };
  for (const [requested, native] of Object.entries(expected)) assert.equal(mapKimiReasoningEffort(requested), native);
  assert.equal(reasoningEffortMapping({ provider:"api", apiPreset:"kimi-global-api", model:"kimi-k3", effort:"medium" }).value, "high");
  assert.deepEqual(apiReasoningParameters({ apiPreset:"kimi-global-api", model:"kimi-k3", effort:"medium" }), { reasoning_effort:"high" });
  assert.deepEqual(apiReasoningParameters({ apiPreset:"kimi-global-api", model:"kimi-k2.7-code", effort:"none" }), {});
  assert.deepEqual(apiReasoningParameters({ apiPreset:"kimi-global-api", model:"kimi-k2.6", effort:"none" }), { thinking:{ type:"disabled" } });
  assert.deepEqual(apiReasoningParameters({ apiPreset:"kimi-global-api", model:"kimi-k2.6", effort:"medium" }), { thinking:{ type:"enabled" } });
});

test("MiniMax maps effort to documented thinking modes instead of sending invented strengths", () => {
  assert.deepEqual(apiReasoningParameters({ apiPreset:"minimax-global-api", model:"MiniMax-M3", effort:"medium" }), { thinking:{ type:"adaptive" } });
  assert.deepEqual(apiReasoningParameters({ apiPreset:"minimax-global-api", model:"MiniMax-M3", effort:"none" }), { thinking:{ type:"disabled" } });
  assert.deepEqual(apiReasoningParameters({ apiPreset:"minimax-global-api", model:"MiniMax-M2.7", effort:"none" }), { thinking:{ type:"adaptive" } });
});

test("Codex preserves medium and caps older model families without reducing current models", () => {
  assert.equal(mapCodexReasoningEffort("medium", "gpt-5.6-sol"), "medium");
  assert.equal(mapCodexReasoningEffort("max", "gpt-5.6-sol"), "max");
  assert.equal(mapCodexReasoningEffort("max", "gpt-5.5"), "xhigh");
  assert.equal(mapCodexReasoningEffort("max", ""), "xhigh");
  assert.equal(mapCodexReasoningEffort("none", "gpt-5.6-sol"), "low");
});

test("Anthropic and generic OpenAI parameters retain their documented native shape", () => {
  assert.deepEqual(apiReasoningParameters({ apiFormat:"anthropic", model:"claude-opus-4-8", effort:"medium" }), { thinking:{ type:"adaptive" }, output_config:{ effort:"medium" } });
  assert.deepEqual(apiReasoningParameters({ apiFormat:"anthropic", model:"claude-opus-4-6", effort:"xhigh" }), { thinking:{ type:"adaptive" }, output_config:{ effort:"max" } });
  assert.deepEqual(apiReasoningParameters({ apiFormat:"anthropic", model:"claude-opus-4-5", effort:"medium" }), { output_config:{ effort:"medium" } });
  assert.equal(mapAnthropicReasoningEffort("xhigh", "claude-opus-4-5"), "high");
  assert.equal(mapAnthropicReasoningEffort("max", "claude-opus-4-5"), "high");
  assert.equal(mapAnthropicReasoningEffort("xhigh", "claude-opus-4-8"), "xhigh");
  assert.equal(anthropicModelProfile("claude-sonnet-4-5").supportsEffort, false);
  assert.deepEqual(apiReasoningParameters({ apiFormat:"anthropic", model:"claude-sonnet-4-5", effort:"medium" }), {});
  assert.deepEqual(apiReasoningParameters({ apiFormat:"openai", effort:"max" }), { reasoning_effort:"xhigh" });
  assert.equal(mapOpenAiReasoningEffort("medium", "gpt-5.6-sol"), "medium");
  assert.deepEqual(apiReasoningParameters({ apiFormat:"openai", model:"gpt-5.6-sol", effort:"max" }), { reasoning_effort:"max" });
  assert.equal(reasoningEffortMapping({ provider:"claude-cli", model:"claude-opus-4-6", effort:"xhigh" }).value, "max");
});
