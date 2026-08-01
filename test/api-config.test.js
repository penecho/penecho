"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MINIMAX_ENDPOINTS, MINIMAX_MODELS, anthropicEffortParameters, anthropicResponseMaxTokens, normalizedApiEffort, resolveApiConfig,
} = require("../src/server/api-config.js");

test("MiniMax presets retain current endpoint and model metadata", () => {
  assert.deepEqual(MINIMAX_ENDPOINTS, {
    global_en:{
      openaiBaseUrl:"https://api.minimax.io/v1",
      anthropicBaseUrl:"https://api.minimax.io/anthropic",
      docsRoot:"https://platform.minimax.io/docs",
    },
    cn_zh:{
      openaiBaseUrl:"https://api.minimaxi.com/v1",
      anthropicBaseUrl:"https://api.minimaxi.com/anthropic",
      docsRoot:"https://platform.minimaxi.com/docs",
    },
  });
  assert.deepEqual(MINIMAX_MODELS["MiniMax-M3"], {
    modelId:"MiniMax-M3",
    contextWindow:1000000,
    pricingUsdPerMillionTokens:{ input:0.6, output:2.4, cacheRead:0.12, cacheWrite:null },
    inputModalities:["text", "image", "video"],
    thinking:["adaptive", "disabled"],
  });
  assert.deepEqual(MINIMAX_MODELS["MiniMax-M2.7"], {
    modelId:"MiniMax-M2.7",
    contextWindow:204800,
    pricingUsdPerMillionTokens:{ input:0.3, output:1.2, cacheRead:0.06, cacheWrite:0.375 },
    inputModalities:["text"],
    thinking:["always_on"],
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
