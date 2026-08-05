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
  assert.deepEqual(NOVITA_MODELS["deepseek/deepseek-v3.2-exp"], {
    modelId:"deepseek/deepseek-v3.2-exp",
    contextWindow:163840,
    pricingUsdPerMillionTokens:{ input:0.27, output:0.41, cacheRead:null, cacheWrite:null },
    inputModalities:["text"],
    thinking:["adaptive", "disabled"],
  });
  assert.deepEqual(NOVITA_MODELS["moonshotai/Kimi-K2-Instruct"], {
    modelId:"moonshotai/Kimi-K2-Instruct",
    contextWindow:131072,
    pricingUsdPerMillionTokens:{ input:0.57, output:2.3, cacheRead:null, cacheWrite:null },
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
