"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { resolveApiConfig } = require("./api-config.js");
const CONNECTION_STORE_VERSION = 1;
function validateStore(store) {
  if (!store || typeof store !== "object" || Array.isArray(store) || !Array.isArray(store.connections)) throw new Error("AI connection storage is invalid; repair connections.json before saving.");
  if (store.version !== undefined && store.version !== CONNECTION_STORE_VERSION) throw new Error("AI connection storage version is unsupported.");
  const ids = new Set();
  for (const item of store.connections) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || !item.id || typeof item.provider !== "string" || ids.has(item.id)) throw new Error("AI connection storage contains invalid or duplicate connections.");
    ids.add(item.id);
  }
  return store;
}
function readStoredFile(file) {
  try { return validateStore(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error) { if (error instanceof SyntaxError) throw new Error("AI connection storage contains malformed JSON; repair connections.json before saving."); throw error; }
}
function writeConnectionStore(file, store) {
  if (!file) throw new Error("This PenEcho process does not have writable connection storage.");
  validateStore(store);
  // Never turn a damaged existing file into an apparently successful empty save.
  try { readStoredFile(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ ...store, version:CONNECTION_STORE_VERSION }, null, 2)}\n`, { encoding:"utf8", mode:0o600, flag:"wx" });
    fs.renameSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}
function readConnectionStore(file, { legacyConnection = null } = {}) {
  let store;
  try { store = readStoredFile(file); }
  catch (error) { if (error.code !== "ENOENT" && !(file == null && error.code === "ERR_INVALID_ARG_TYPE")) throw error; store = { connections:[] }; }
  if (store.version === CONNECTION_STORE_VERSION) return store;
  const connections = [...store.connections];
  const existingDefault = connections.findIndex(item => item.id === "default");
  if (existingDefault > 0) connections.unshift(...connections.splice(existingDefault, 1));
  if (legacyConnection && existingDefault < 0) connections.unshift({ ...legacyConnection, id:"default" });
  const migrated = { ...store, version:CONNECTION_STORE_VERSION, connections };
  if (file) writeConnectionStore(file, migrated);
  return migrated;
}
function isUsableConnection(connection) {
  if (!connection || typeof connection !== "object") return false;
  if (["kimi-cli", "codex-cli", "claude-cli"].includes(connection.provider)) return true;
  if (connection.provider !== "api" || !["openai", "anthropic"].includes(connection.apiFormat)) return false;
  if (![connection.apiModel, connection.apiKey].every(value => typeof value === "string" && value.trim() && !/[\r\n\0]/.test(value))) return false;
  if (connection.apiModel.length > 200 || connection.apiKey.length > 8192 || !resolveApiConfig(connection.apiUrl, connection.apiFormat)) return false;
  try { const url = new URL(connection.apiUrl); return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}
function connectionEnvironment(connection) {
  const values = Object.fromEntries(["AI_PROVIDER", "AI_API_FORMAT", "AI_API_URL", "AI_API_MODEL", "AI_API_KEY", "AI_EFFORT", "PENECHO_API_PRESET", "OPENAI_API_FORMAT", "OPENAI_API_URL", "OPENAI_MODEL", "OPENAI_API_KEY", "KIMI_CLI_MODEL", "KIMI_CLI_PATH", "CODEX_CLI_MODEL", "CODEX_CLI_PATH", "CLAUDE_CLI_MODEL", "CLAUDE_CLI_PATH"].map(key => [key, ""]));
  if (!connection) return values;
  values.AI_PROVIDER = connection.provider || "";
  values.AI_EFFORT = connection.effort || "";
  if (connection.provider === "api") Object.assign(values, { AI_API_FORMAT:connection.apiFormat || "", AI_API_URL:connection.apiUrl || "", AI_API_MODEL:connection.apiModel || "", AI_API_KEY:connection.apiKey || "", PENECHO_API_PRESET:connection.apiPreset || "" });
  const prefix = { "kimi-cli":"KIMI_CLI", "codex-cli":"CODEX_CLI", "claude-cli":"CLAUDE_CLI" }[connection.provider];
  if (prefix) Object.assign(values, { [`${prefix}_MODEL`]:connection.cliModel || "", [`${prefix}_PATH`]:connection.cliPath || connection.provider.replace("-cli", "") });
  return values;
}
function withConnectionOverride(store, override = {}) {
  if (!override || !Object.keys(override).length) return store;
  const first = store.connections[0], env = { ...connectionEnvironment(first), ...override };
  const rawProvider = String(env.AI_PROVIDER || "").trim().toLowerCase();
  const provider = { kimi:"kimi-cli", codex:"codex-cli", claude:"claude-cli" }[rawProvider] || rawProvider;
  if (!["api", "kimi-cli", "codex-cli", "claude-cli"].includes(provider)) return store;
  const prefix = { "kimi-cli":"KIMI_CLI", "codex-cli":"CODEX_CLI", "claude-cli":"CLAUDE_CLI" }[provider];
  const connection = { id:first?.id || "cli-override", provider, effort:env.AI_EFFORT || "",
    ...(provider === "api" ? { apiFormat:env.AI_API_FORMAT, apiUrl:env.AI_API_URL, apiModel:env.AI_API_MODEL, apiKey:env.AI_API_KEY, apiPreset:env.PENECHO_API_PRESET } : { cliModel:env[`${prefix}_MODEL`] || "", cliPath:env[`${prefix}_PATH`] || provider.replace("-cli", "") }) };
  return { ...store, connections:[connection, ...store.connections.slice(1)] };
}
module.exports = { CONNECTION_STORE_VERSION, readConnectionStore, writeConnectionStore, isUsableConnection, connectionEnvironment, withConnectionOverride };
