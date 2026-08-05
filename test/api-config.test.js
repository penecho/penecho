"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NOVITA_ENDPOINTS, NOVITA_MODELS, anthropicEffortParameters, anthropicResponseMaxTokens, normalizedApiEffort, resolveApiConfig,
} = require("../src/server/api-config.js");

test("Novita presets retain current endpoint and model metadata", () => {
  assert.deepEqual(NOVITA_ENDPOINTS, {
    openaiBaseUrl:"https://api.novita.ai/openai/v1",
    anthropicBaseUrl:"https://api.novita.ai/anthropic",
    docsRoot:"https://novita.ai/docs",
  });
  assert.deepEqual(NOVITA_MODELS["moonshotai/kimi-k3"], {
    modelId:"moonshotai/kimi-k3",
    contextWindow:1048576,
    pricingUsdPerMillionTokens:{ input:3.0, output:15.0, cacheRead:0.3, cacheWrite:null },
    inputModalities:["text", "image", "video"],
    thinking:["adaptive", "disabled"],
  });
  assert.deepEqual(NOVITA_MODELS["zai-org/glm-5.2"], {
    modelId:"zai-org/glm-5.2",
    contextWindow:1048576,
    pricingUsdPerMillionTokens:{ input:1.4, output:4.4, cacheRead:0.26, cacheWrite:null },
    inputModalities:["text"],
    thinking:["adaptive", "disabled"],
  });
  assert.deepEqual(NOVITA_MODELS["deepseek/deepseek-v4-flash-0731"], {
    modelId:"deepseek/deepseek-v4-flash-0731",
    contextWindow:1048576,
    pricingUsdPerMillionTokens:{ input:0.14, output:0.28, cacheRead:0.028, cacheWrite:null },
    inputModalities:["text"],
    thinking:["adaptive", "disabled"],
  });
});

test("API format selection builds the matching endpoint", () => {
  assert.deepEqual(resolveApiConfig("https://api.openai.com/v1", "openai"), {
    format:"openai", endpoint:"https://api.openai.com/v1/chat/completions",
  });
  assert.deepEqual(resolveApiConfig("https://api.anthropic.com", "anthropic"), {
    format:"anthropic", endpoint:"https://api.anthropic.com/v1/messages",
  });
});

test("explicit API endpoints must agree with the selected format", () => {
  assert.equal(resolveApiConfig("https://example.test/v1/messages", "openai"), null);
  assert.equal(resolveApiConfig("https://example.test/v1/chat/completions", "anthropic"), null);
  assert.equal(resolveApiConfig("https://user:secret@example.test/v1", "openai"), null);
});

test("Anthropic effort maps none to disabled thinking and other levels to adaptive thinking", () => {
  assert.equal(normalizedApiEffort("anthropic", ""), "medium");
  assert.equal(normalizedApiEffort("openai", ""), "max");
  assert.deepEqual(anthropicEffortParameters("none"), { thinking:{ type:"disabled" } });
  assert.deepEqual(anthropicEffortParameters("medium"), {
    thinking:{ type:"adaptive" }, output_config:{ effort:"medium" },
  });
  assert.deepEqual(anthropicEffortParameters("high", false), { output_config:{ effort:"high" } });
  assert.equal(anthropicResponseMaxTokens("medium"), 12288);
  assert.equal(anthropicResponseMaxTokens("none"), 12288);
  assert.equal(anthropicResponseMaxTokens("max"), 16384);
});
