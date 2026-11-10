"use strict";

const ACTIONS = new Set(["like", "criticism", "retry"]);
const CLIENTS = new Set(["cloud", "desktop", "web", "mobile"]);
const PLATFORMS = new Set(["web", "macos", "windows", "linux", "ios", "android", "unknown"]);
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,47}$/;
const SAFE_LABEL_PATTERN = /^[^\0-\x1f\x7f]{1,200}$/;
const ALLOWED_FIELDS = new Set(["eventId", "conversationId", "action", "modelName", "channel", "client", "platform", "appVersion"]);

function normalizeModelEvaluation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !ALLOWED_FIELDS.has(key))) return null;
  const eventId = String(value.eventId || "").trim().toLowerCase();
  const conversationId = String(value.conversationId || "").trim().toLowerCase();
  const action = String(value.action || "").trim().toLowerCase();
  const modelName = String(value.modelName || "").trim();
  const channel = String(value.channel || "").trim().toLowerCase();
  const client = String(value.client || "").trim().toLowerCase();
  const platform = String(value.platform || "").trim().toLowerCase();
  const appVersion = String(value.appVersion || "").trim();
  if (!EVENT_ID_PATTERN.test(eventId) || !EVENT_ID_PATTERN.test(conversationId) || !ACTIONS.has(action) || !SAFE_LABEL_PATTERN.test(modelName) || channel.length > 80 || !SAFE_LABEL_PATTERN.test(channel) || !CLIENTS.has(client) || !PLATFORMS.has(platform) || !VERSION_PATTERN.test(appVersion)) return null;
  return { eventId, conversationId, action, modelName, channel, client, platform, appVersion };
}

async function forwardModelEvaluation(fetchImpl, cloudOrigin, cloudCredential, event, timeoutMs = 10_000) {
  const token = String(cloudCredential || "").trim();
  if (!token) throw Object.assign(new Error("An authenticated PenEcho Cloud credential is required for model evaluation reporting."), { code:"cloud_auth_required" });
  const target = new URL("/api/v1/device-sync/model-evaluation", cloudOrigin);
  const response = await fetchImpl(target, {
    method:"POST",
    headers:{ accept:"application/json", authorization:`Bearer ${token}`, "content-type":"application/json", "user-agent":"penecho-model-evaluation" },
    body:JSON.stringify(event),
    redirect:"error",
    signal:AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw Object.assign(new Error("PenEcho Cloud rejected model evaluation feedback."), { status:response.status });
  return true;
}

module.exports = { normalizeModelEvaluation, forwardModelEvaluation };
