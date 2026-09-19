"use strict";
const { randomUUID } = require("node:crypto");
const presets = require("./api-presets.js");
const { version } = require("../../package.json");

function presetRequestHeaders(connection, sessionId) {
  if (!presets.isOpenCode(connection.apiPreset)) return {};
  const preset = presets.get(connection.apiPreset);
  const url = String(connection.apiUrl || "").replace(/\/+$/, "");
  if (![preset.url, `${preset.url}/messages`, `${preset.url}/chat/completions`].includes(url)) return {};
  const session = String(sessionId || randomUUID());
  if (session.length > 200 || /[\r\n\0]/.test(session)) throw new Error("Invalid OpenCode session ID.");
  return { "user-agent":`PenEcho/${version}`, "x-opencode-session":session };
}

function catalogModels(payload, presetId) {
  const values = Array.isArray(payload) ? payload : payload?.data || payload?.models;
  if (!Array.isArray(values) || values.length > presets.maxModels) throw new Error("Provider returned an invalid or oversized model list.");
  const models = new Set();
  for (const value of values) {
    const id = typeof value === "string" ? value : value?.id;
    if (typeof id !== "string" || !id.trim() || id.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(id)) throw new Error("Provider returned an invalid model identifier.");
    if (presets.isOpenCode(presetId) && !presets.openCodeFormat(id)) continue;
    // Respect capability metadata when the provider supplies it. Embedding,
    // audio and image-generation catalogs must not become chat suggestions.
    if (value?.capabilities?.completion_chat === false || value?.active === false) continue;
    const output = value?.architecture?.output_modalities;
    if (Array.isArray(output) && !output.includes("text")) continue;
    if (/(?:embedding|rerank|whisper|tts|dall-e|stable-diffusion|flux|cogvideo)/i.test(id)) continue;
    models.add(id.trim());
  }
  if (!models.size) throw new Error("Provider returned no compatible chat models.");
  return [...models].sort();
}

async function discoverPresetModels(request, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const preset = presets.get(request.apiPreset);
  if (!preset) throw new Error("Choose a supported API preset.");
  const url = new URL(presets.editorUrl(request));
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/i, "")}/models`;
  url.search = "";
  url.hash = "";
  // SiliconFlow documents this query to exclude speech/embedding/image models.
  if (["siliconflow", "siliconflow-global"].includes(preset.family)) url.searchParams.set("type", "text");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method:"GET", redirect:"error", credentials:"omit", cache:"no-store", signal:controller.signal,
      headers:{ Accept:"application/json", Authorization:`Bearer ${request.apiKey}`, ...presetRequestHeaders(request) } });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status} while listing models.`);
    const type = String(response.headers.get("content-type") || "").split(";", 1)[0].trim();
    if (!(type === "application/json" || type.endsWith("+json")) || !response.body?.getReader) throw new Error("Provider returned a non-JSON model list.");
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("Provider returned an oversized model list."); }
      chunks.push(Buffer.from(value));
    }
    let payload;
    try { payload = JSON.parse(new TextDecoder("utf-8", { fatal:true }).decode(Buffer.concat(chunks))); }
    catch { throw new Error("Provider returned malformed JSON."); }
    return catalogModels(payload, preset.id);
  } catch (error) {
    // Do not expose SDK/network errors that can contain credential-bearing URLs.
    const message = controller.signal.aborted ? "Provider model discovery timed out." : /^Provider returned /.test(error.message) ? error.message : "Unable to fetch models from the provider.";
    throw Object.assign(new Error(message), { safeMessage:message, status:controller.signal.aborted ? 504 : 502 });
  } finally { clearTimeout(timer); }
}
module.exports = { presetRequestHeaders, catalogModels, discoverPresetModels };
