"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_GRANTS = 64;
const TOKEN_PATTERN = /^picker-[A-Za-z0-9_-]{43}$/;

function validSelection(selectedPath, kind) {
  return typeof selectedPath === "string"
    && selectedPath.length > 0
    && selectedPath.length <= 4096
    && !selectedPath.includes("\0")
    && path.isAbsolute(selectedPath)
    && kind === "file";
}

function createNativePickerGrantStore({
  now = Date.now,
  randomBytes = crypto.randomBytes,
  ttlMs = DEFAULT_TTL_MS,
  maxGrants = DEFAULT_MAX_GRANTS,
} = {}) {
  if (typeof now !== "function" || typeof randomBytes !== "function") throw new TypeError("Picker grant dependencies must be functions.");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 5 * 60_000) throw new TypeError("Picker grant lifetime is invalid.");
  if (!Number.isSafeInteger(maxGrants) || maxGrants < 1 || maxGrants > 256) throw new TypeError("Picker grant capacity is invalid.");

  const grants = new Map();

  function prune(currentTime) {
    for (const [token, grant] of grants) if (grant.expiresAt <= currentTime) grants.delete(token);
    while (grants.size >= maxGrants) grants.delete(grants.keys().next().value);
  }

  function issue({ selectedPath, kind } = {}) {
    if (!validSelection(selectedPath, kind)) throw new TypeError("A native picker grant requires an absolute file path.");
    const currentTime = now();
    prune(currentTime);
    let token = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = `picker-${randomBytes(32).toString("base64url")}`;
      if (TOKEN_PATTERN.test(candidate) && !grants.has(candidate)) { token = candidate; break; }
    }
    if (!token) throw new Error("Unable to issue a native picker grant.");
    grants.set(token, { selectedPath, kind, expiresAt:currentTime + ttlMs });
    return token;
  }

  function consume({ token, selectedPath, kind } = {}) {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
    const grant = grants.get(token);
    if (!grant) return false;
    grants.delete(token);
    return grant.expiresAt > now() && grant.selectedPath === selectedPath && grant.kind === kind;
  }

  return Object.freeze({ issue, consume });
}

const nativePickerGrants = createNativePickerGrantStore();

module.exports = Object.freeze({
  DEFAULT_MAX_GRANTS,
  DEFAULT_TTL_MS,
  TOKEN_PATTERN,
  createNativePickerGrantStore,
  issueNativePickerGrant:input => nativePickerGrants.issue(input),
  consumeNativePickerGrant:input => nativePickerGrants.consume(input),
});
