"use strict";

const http = require("node:http");
const https = require("node:https");
const zlib = require("node:zlib");

const SUGGESTION_IDLE_TIMEOUT_MS = 90_000;
const SUGGESTION_RESPONSE_MAX_BYTES = 1024 * 1024;

// A private pool for the local Suggest relay. Other Cloud requests retain their
// existing transport. No model traffic is needed to keep these sockets alive.
function createSuggestionTransport({ idleTimeoutMs = SUGGESTION_IDLE_TIMEOUT_MS, maxResponseBytes = SUGGESTION_RESPONSE_MAX_BYTES } = {}) {
  const options = { keepAlive:true, maxSockets:2, maxFreeSockets:2, maxTotalSockets:4, timeout:idleTimeoutMs, scheduling:"lifo" };
  const httpAgent = new http.Agent(options), httpsAgent = new https.Agent(options);
  const pending = new Set();
  let closed = false;

  async function request(input, { method = "GET", headers = {}, body, signal } = {}) {
    if (closed) throw Object.assign(new Error("The suggestion transport is closed."), { code:"suggestion_transport_closed" });
    signal?.throwIfAborted();
    const url = new URL(input), loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback) || url.username || url.password) throw new TypeError("Suggestions require HTTPS or loopback HTTP.");
    const payload = body === undefined ? undefined : Buffer.from(body);
    const requestHeaders = { ...headers, ...(payload === undefined ? {} : { "content-length":payload.length }) };
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        pending.delete(req);
        reject(signal?.aborted ? signal.reason : error);
      };
      const req = (url.protocol === "https:" ? https : http).request(url, {
        method, headers:requestHeaders, signal, agent:url.protocol === "https:" ? httpsAgent : httpAgent,
      }, response => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) {
          const error = Object.assign(new TypeError("Cloud suggestion redirects are not allowed."), { code:"suggestion_redirect_rejected" });
          fail(error); req.destroy(error); response.destroy(); return;
        }
        const encoding = String(response.headers["content-encoding"] || "identity").toLowerCase();
        const decoder = encoding === "gzip" ? zlib.createGunzip() : encoding === "deflate" ? zlib.createInflate() : encoding === "br" ? zlib.createBrotliDecompress() : null;
        if (!decoder && encoding !== "identity") {
          const error = Object.assign(new Error("Unsupported suggestion response encoding."), { code:"suggestion_response_encoding" });
          fail(error); req.destroy(error); response.destroy(); return;
        }
        const stream = decoder ? response.pipe(decoder) : response, chunks = [];
        let size = 0;
        response.once("aborted", () => {
          const error = Object.assign(new Error("The suggestion response ended unexpectedly."), { code:"suggestion_response_aborted" });
          fail(error); decoder?.destroy();
        });
        response.once("error", error => { fail(error); decoder?.destroy(); });
        stream.on("data", chunk => {
          size += chunk.length;
          if (size > maxResponseBytes) {
            const error = Object.assign(new Error("The suggestion response exceeded its size limit."), { code:"suggestion_response_too_large" });
            fail(error); req.destroy(error); response.destroy(); decoder?.destroy();
          } else if (!settled) chunks.push(chunk);
        });
        stream.once("error", error => { fail(error); req.destroy(error); response.destroy(); });
        stream.once("end", () => {
          if (settled) return;
          settled = true;
          pending.delete(req);
          const raw = Buffer.concat(chunks).toString("utf8"), responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
          resolve({ status, ok:status >= 200 && status < 300, headers:responseHeaders, text:async () => raw });
        });
      });
      // A POST may already have reached Cloud when its socket fails. Let the
      // existing caller decide what to do; this pool never replays requests.
      req.once("error", fail);
      pending.add(req);
      req.end(payload);
    });
  }

  function close() {
    closed = true;
    for (const req of pending) req.destroy(Object.assign(new Error("The suggestion transport is closed."), { code:"suggestion_transport_closed" }));
    httpAgent.destroy(); httpsAgent.destroy();
  }
  return { request, close, httpAgent, httpsAgent };
}

module.exports = { createSuggestionTransport, SUGGESTION_IDLE_TIMEOUT_MS, SUGGESTION_RESPONSE_MAX_BYTES };
