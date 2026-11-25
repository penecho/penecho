"use strict";
// When a model call from PenEcho's own agent is tried again, and how long to wait first. One place for these rules:
// the proxy (model-proxy.js) is the only part that tries a call again. The dsh loop inside the runner only tries an empty
// answer once more (penecho-source.js), so the two never multiply.
//
// Tried again: no connection, 408, 429, 5xx (and Cloudflare's 52x), an answer that stops before its end, no bytes for too
// long, and an error Cloud sends inside a stream that it marks as worth another try. At most TRIES tries in all; a call Cloud
// says is still in progress (request_in_progress) is waited for apart from those (IN_PROGRESS_*).
// Never tried again: 400, 401, 402, 403, 404, 413, 422, any other 4xx, an answer whose JSON says retryable false, and a call
// the person stopped.
// Cloudflare stands in front of PenEcho Cloud and replaces any 502 or 504 with its own HTML page. Since R1b Cloud answers its own
// failures as 503 (worth another try) or 500 (its JSON says retryable false when another try cannot help), so its words arrive;
// a 502 or 504 here is Cloudflare's own page (the tunnel down during a deploy, say), and is tried again like every 5xx.

// Like Claude Code and Codex when a model has trouble (owner, 2026-11-13): the run waits and tries again for a while, visibly
// ("Trying again (3 of 8)"), and only then stops with a plain sentence the person can Retry from. 8 tries with the waits below
// is about a minute and a half of waiting (68 to 114 s with jitter), plus each try's own time: long enough to ride out a
// deploy (a rolling restart takes 2 to 4 minutes, of which the other task serves throughout), a tunnel connection dropping,
// or a provider's minute of 429s or 503s; short enough that a real outage is said within a few minutes, not hidden.
const TRIES = 8;
// Backoff before try 2 to 8: 1, 2, 4, 8, 16, 30, 30 s, each with ±25% jitter, so many runs cut at the same moment do not come back together.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
const JITTER = 0.25;
// A `retry-after` longer than this is not waited for: the call fails and says so, rather than sitting quiet for minutes.
const RETRY_AFTER_MOST_MS = 60_000;
// Cloud sends a keepalive every 10 s while a hosted answer is on its way (penecho-cloud src/routes/hosted-chat.mjs), so 45 s with
// no byte at all means the connection is dead. A person's own provider sends nothing while it thinks, so it gets the longer limit
// PenEcho's model timeout already uses (180 s unless set).
const HOSTED_SILENCE_MS = 45_000;
// A call Cloud says is still being finished from an earlier try (409 request_in_progress, after a PenEcho restart) is waited for, not
// counted as one of the TRIES: an answer that thinks for minutes would otherwise use all 8 in 14 seconds and fail. The wait has its own
// limits, in time and in polls, so a call that never ends is still said plainly.
const IN_PROGRESS_WAIT_MOST_MS = 180_000;
const IN_PROGRESS_POLLS_MOST = 40;

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);
// Cloud's own error codes (penecho-cloud src/services/provider-executor.mjs, hosted-chat.mjs, provider-routing.mjs) that are
// worth another try: the provider was slow, cut, busy or briefly gone. Anything else (credits, a request too large, a model
// that does not take tools) gives the same answer however often it is asked.
const RETRY_CODES = new Set([
  "provider_timeout", "provider_temporarily_unavailable", "provider_request_failed", "provider_stream_incomplete", "provider_stream_invalid",
  "provider_usage_missing", "invalid_provider_response", "hosted_request_lease_lost", "hosted_model_unavailable", "hosted_stream_backpressure",
  "hosted_service_unavailable", "request_in_progress", "service_unavailable",
  // Anthropic's and OpenAI's own words for the same, from a person's own key.
  "overloaded_error", "api_error", "rate_limit_error", "timeout_error", "server_error",
]);

function backoffMs(tried, random = Math.random) {
  const base = BACKOFF_MS[Math.min(Math.max(tried, 1), BACKOFF_MS.length) - 1];
  return Math.round(base * (1 - JITTER + 2 * JITTER * random()));
}

// `retry-after` in seconds or as a date, in ms; null when absent or unreadable.
function retryAfterMs(value, now = Date.now()) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

// An HTTP answer: worth another try? A 409 is, only when Cloud says the same call is still being finished from the last try.
function retryableStatus(status, code = "") {
  if (status === 409) return code === "request_in_progress";
  return RETRY_STATUS.has(status);
}

// An error event inside a stream: { code?, type?, retryable? } as Cloud or a provider sent it.
function retryableEvent(error) {
  if (!error || typeof error !== "object") return true;
  if (typeof error.retryable === "boolean") return error.retryable;
  return RETRY_CODES.has(String(error.code || error.type || "")) ;
}

// What went wrong with one try, in words a person can read on the line ("Trying again (2 of 4): <why>").
const WHY = {
  connect:"PenEcho Cloud could not be reached",
  connectOwn:"The model's service could not be reached",
  silent:"No answer came for a while",
  cut:"The answer stopped halfway",
  busy:"The model service is busy",
  server:"The model service had a problem",
  timeout:"The model took too long to answer",
  inProgress:"Waiting for the earlier model call to finish",
};
function whyOfStatus(status, code = "") {
  if (status === 409 && code === "request_in_progress") return WHY.inProgress;
  if (status === 429) return WHY.busy;
  if (status === 408 || status === 504 || status === 524) return WHY.timeout;
  return WHY.server;
}
function whyOfEvent(error) {
  const code = String(error?.code || error?.type || "");
  if (code === "request_in_progress") return WHY.inProgress;
  if (/timeout/.test(code)) return WHY.timeout;
  if (/stream_incomplete|stream_invalid|usage_missing|invalid_provider_response/.test(code)) return WHY.cut;
  if (/rate_limit|temporarily|overloaded|backpressure/.test(code)) return WHY.busy;
  return WHY.server;
}

// Why a turn failed, as one plain sentence. The model"s adapter says it as "503: {json}" or "pi-ai stream idle timeout after 7200000ms";
// PenEcho"s own proxy (model-proxy.js) has already put it in words inside that JSON, after trying the call again where that helps.
function plainFailure(error) {
  let text = String((error instanceof Error ? error.message : error?.message ?? error?.code ?? error) || "").trim();
  if (!text) return "The run stopped with an error.";
  if (/request aborted by caller/i.test(text)) return "Stopped.";
  const idle = /stream idle timeout after (\d+)\s*ms/i.exec(text);
  if (idle) return `No answer came from the model for ${Math.max(1, Math.round(Number(idle[1]) / 60000))} minutes.`;
  text = text.replace(/^\d{3}:?\s*/, "");
  if (/^[[{"]/.test(text)) {
    try {
      const o = JSON.parse(text);
      const said = typeof o === "string" ? o : o?.error?.message || o?.message || (typeof o?.error === "string" ? o.error : "");
      if (said) text = String(said);
    } catch { /* Not JSON after all: kept as it is. */ }
  }
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}

module.exports = { plainFailure, TRIES, BACKOFF_MS, RETRY_AFTER_MOST_MS, HOSTED_SILENCE_MS, IN_PROGRESS_WAIT_MOST_MS, IN_PROGRESS_POLLS_MOST, RETRY_STATUS, RETRY_CODES, WHY, backoffMs, retryAfterMs, retryableStatus, retryableEvent, whyOfStatus, whyOfEvent };
