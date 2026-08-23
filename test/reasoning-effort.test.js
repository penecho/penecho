"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  apiReasoningParameters,
  mapKimiReasoningEffort,
  normalizeReasoningEffort,
  reasoningEffortTimeoutMultiplier,
  reasoningEffortMapping,
} = require("../src/providers/reasoning-effort.js");

test("all new reasoning configurations default to medium", () => {
  assert.equal(normalizeReasoningEffort(""), "medium");
  assert.equal(normalizeReasoningEffort("medium"), "medium");
});

test("custom reasoning values preserve their exact spelling", () => {
  const custom = "Provider_Native";
  assert.equal(reasoningEffortMapping({ provider:"api", apiFormat:"openai", effort:custom }).value, custom);
  assert.deepEqual(apiReasoningParameters({ apiFormat:"openai", effort:custom }), { reasoning_effort:custom });
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

test("MiniMax preserves the configured effort like every non-Kimi provider", () => {
  assert.deepEqual(apiReasoningParameters({ apiPreset:"minimax-global-api", model:"MiniMax-M3", effort:"medium" }), { reasoning_effort:"medium" });
  assert.deepEqual(apiReasoningParameters({ apiPreset:"minimax-global-api", model:"MiniMax-M3", effort:"none" }), { reasoning_effort:"none" });
  assert.deepEqual(apiReasoningParameters({ apiPreset:"minimax-global-api", model:"MiniMax-M2.7", effort:"Provider_Native" }), { reasoning_effort:"Provider_Native" });
});

test("Codex preserves the exact configured effort for every model family", () => {
  for (const effort of ["medium", "max", "none", "Provider_Native"]) {
    assert.equal(reasoningEffortMapping({ provider:"codex-cli", model:"gpt-5.6-sol", effort }).value, effort);
  }
  assert.equal(reasoningEffortMapping({ provider:"codex-cli", model:"gpt-5.5", effort:"max" }).value, "max");
});

test("Anthropic and generic OpenAI retain protocol shape without changing effort values", () => {
  assert.deepEqual(apiReasoningParameters({ apiFormat:"anthropic", model:"claude-opus-4-8", effort:"medium" }), { thinking:{ type:"adaptive" }, output_config:{ effort:"medium" } });
  assert.deepEqual(apiReasoningParameters({ apiFormat:"anthropic", model:"claude-opus-4-6", effort:"xhigh" }), { thinking:{ type:"adaptive" }, output_config:{ effort:"xhigh" } });
  assert.deepEqual(apiReasoningParameters({ apiFormat:"anthropic", model:"claude-opus-4-5", effort:"medium" }), { thinking:{ type:"adaptive" }, output_config:{ effort:"medium" } });
  assert.deepEqual(apiReasoningParameters({ apiFormat:"anthropic", model:"claude-opus-5", effort:"Provider_Native" }), { thinking:{ type:"adaptive" }, output_config:{ effort:"Provider_Native" } });
  assert.deepEqual(apiReasoningParameters({ apiFormat:"anthropic", model:"claude-sonnet-4-5", effort:"medium" }), { thinking:{ type:"adaptive" }, output_config:{ effort:"medium" } });
  assert.deepEqual(apiReasoningParameters({ apiFormat:"openai", effort:"max" }), { reasoning_effort:"max" });
  assert.deepEqual(apiReasoningParameters({ apiFormat:"openai", model:"gpt-5.6-sol", effort:"max" }), { reasoning_effort:"max" });
  assert.equal(reasoningEffortMapping({ provider:"claude-cli", model:"claude-opus-4-6", effort:"xhigh" }).value, "xhigh");
});
