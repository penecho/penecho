"use strict";

const { randomUUID } = require("node:crypto");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TOKEN_COUNT = 2_147_483_647;

function tokenCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_TOKEN_COUNT ? number : null;
}

function firstToken(raw, keys) {
  for (const key of keys) {
    if (!Object.hasOwn(raw, key)) continue;
    const count = tokenCount(raw[key]);
    if (count !== null) return count;
  }
  return null;
}

function nestedToken(raw, objectKeys, keys) {
  for (const objectKey of objectKeys) {
    const nested = raw[objectKey];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const count = firstToken(nested, keys);
    if (count !== null) return count;
  }
  return null;
}

// OpenAI input includes cache; Anthropic and Harness input excludes cache.
// A missing counter is not evidence of zero usage.
function normalizeLocalTokenUsage(value, format = "openai") {
  const raw = value && typeof value === "object" ? value : {};
  const read = firstToken(raw, [
    "cache_read_input_tokens", "cacheReadInputTokens", "cacheReadTokens", "cache_read_tokens",
    "cachedInputTokens", "cached_input_tokens", "prompt_cache_hit_tokens", "cacheHitTokens",
  ]) ?? nestedToken(raw, ["prompt_tokens_details", "input_tokens_details"], [
    "cached_tokens", "cachedInputTokens", "cache_read_input_tokens", "cache_read_tokens",
  ]);
  const write = firstToken(raw, [
    "cache_creation_input_tokens", "cacheCreationInputTokens", "cacheWriteInputTokens", "cacheWriteTokens",
    "cache_write_input_tokens", "cache_write_tokens", "cache_creation_tokens", "cacheCreationTokens",
  ]) ?? nestedToken(raw, ["prompt_tokens_details", "input_tokens_details"], [
    "cache_creation_input_tokens", "cacheCreationInputTokens", "cache_write_input_tokens", "cache_write_tokens",
    "cache_creation_tokens", "cacheCreationTokens",
  ]);
  const input = firstToken(raw, ["prompt_tokens", "promptTokens", "input_tokens", "inputTokens"]);
  const output = firstToken(raw, ["completion_tokens", "completionTokens", "output_tokens", "outputTokens"]);
  const normalizedFormat = String(format || "openai").toLowerCase();
  const separate = normalizedFormat === "harness" || normalizedFormat === "anthropic"
    || [
      // These snake_case fields are emitted by Anthropic-style APIs and are
      // the only cache aliases that may infer an exclusive input format.
      "cache_read_input_tokens", "cache_read_tokens", "cache_creation_input_tokens",
      "cache_write_input_tokens", "cache_write_tokens",
    ].some(key => Object.hasOwn(raw, key));
  // Anthropic and Harness report input excluding cache. The Cloud contract stores
  // the inclusive total, so a missing cache counter keeps the total unknown.
  const total = input === null || (separate && (read === null || write === null))
    ? null
    : tokenCount(separate ? input + read + write : input);
  return {
    inputTokens:total,
    outputTokens:output,
    cacheReadInputTokens:read,
    cacheWriteInputTokens:write,
  };
}

function localUsageRecord({ requestId = randomUUID(), connectionId = "default", connectionName = "", model = "", action = "main-canvas", createdAt = Date.now(), completedAt = Date.now(), status = "succeeded", usage = null, usageFormat = "openai" } = {}) {
  const requestedConnectionId = String(connectionId ?? "default");
  if (requestedConnectionId.startsWith("hosted:")) return null;
  const safeId = requestedConnectionId === "default" || UUID_PATTERN.test(requestedConnectionId) ? requestedConnectionId : "default";
  const safeRequestId = UUID_PATTERN.test(String(requestId)) ? String(requestId) : randomUUID();
  const safeText = (value, fallback = "") => String(value || fallback).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0,160);
  const safeDate = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  };
  return {
    requestId:safeRequestId, connectionId:safeId,
    connectionName:safeText(connectionName, model || "Local connection"),
    model:safeText(model),
    action:["main-canvas", "canvas-agent"].includes(action) ? action : "main-canvas",
    createdAt:safeDate(createdAt), completedAt:safeDate(completedAt),
    status:["succeeded","failed","cancelled"].includes(status) ? status : "failed",
    ...normalizeLocalTokenUsage(usage, usageFormat),
  };
}

module.exports = { tokenCount, normalizeLocalTokenUsage, localUsageRecord };
