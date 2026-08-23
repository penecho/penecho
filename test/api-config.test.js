"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  anthropicEffortParameters,
  anthropicResponseMaxTokens,
  configuredMaxTokens,
  normalizedApiEffort,
  resolveApiConfig,
} = require("../src/server/api-config.js");

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

test("Anthropic protocol preserves effort values while encoding disabled or adaptive thinking", () => {
  assert.equal(normalizedApiEffort("anthropic", ""), "medium");
  assert.equal(normalizedApiEffort("openai", ""), "medium");
  assert.deepEqual(anthropicEffortParameters("none"), { thinking:{ type:"disabled" } });
  assert.deepEqual(anthropicEffortParameters("medium"), {
    thinking:{ type:"adaptive" }, output_config:{ effort:"medium" },
  });
  assert.deepEqual(anthropicEffortParameters("high", false), { output_config:{ effort:"high" } });
  assert.deepEqual(anthropicEffortParameters("medium", true, { model:"claude-opus-4-5" }), {
    thinking:{ type:"adaptive" }, output_config:{ effort:"medium" },
  });
  assert.deepEqual(anthropicEffortParameters("Provider_Native", true, { model:"claude-sonnet-4-5" }), {
    thinking:{ type:"adaptive" }, output_config:{ effort:"Provider_Native" },
  });
  assert.equal(anthropicResponseMaxTokens("none"), 20000);
  assert.equal(anthropicResponseMaxTokens("low"), 20000);
  assert.equal(anthropicResponseMaxTokens("medium"), 20000);
  assert.equal(anthropicResponseMaxTokens("high"), 20000);
  assert.equal(anthropicResponseMaxTokens("max"), 20000);
});

test("API response-token limits default to 20000 and require more than 15000", () => {
  assert.equal(configuredMaxTokens(undefined), 20000);
  assert.equal(configuredMaxTokens("15000"), null);
  assert.equal(configuredMaxTokens("15001"), 15001);
  assert.equal(configuredMaxTokens("14999"), null);
  assert.equal(configuredMaxTokens("200001"), 200001);
  assert.equal(anthropicResponseMaxTokens("medium", 24000), 24000);
});
