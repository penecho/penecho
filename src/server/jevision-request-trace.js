"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { safeTraceValue } = require("./mcp/request-trace.js");

// Constructed only when the existing request-recording preference is enabled.
function createJeVisionRequestTracer({ requestTraceDirectory, requestTraceLimit = 100, logger = () => {} }) {
  const root = path.resolve(requestTraceDirectory), active = new Set();
  function guarded(action) {
    try { return action(); }
    catch (error) {
      try { logger({ type:"jevision-request-trace-error", errorCode:String(error?.code || "write_failed") }); } catch {}
      return null;
    }
  }
  function write(directory, name, value) {
    fs.writeFileSync(path.join(directory, name), value, { mode:0o600 });
  }
  function prune() {
    guarded(() => {
      const entries = fs.readdirSync(root, { withFileTypes:true })
        .filter(entry => entry.isDirectory() && /^\d{13}-[0-9a-f-]{36}$/i.test(entry.name))
        .map(entry => entry.name).sort();
      let excess = entries.length - requestTraceLimit;
      for (const name of entries) {
        if (excess <= 0) break;
        if (active.has(name)) continue;
        fs.rmSync(path.join(root, name), { recursive:true, force:true });
        excess--;
      }
    });
  }
  function begin(config, request, body) {
    return guarded(() => {
      const started = Date.now(), requestId = crypto.randomUUID(), name = `${started}-${requestId}`,
        directory = path.join(root, name), startedAt = new Date(started).toISOString();
      fs.mkdirSync(directory, { recursive:true, mode:0o700 });
      let image = null;
      if (request.image) {
        const match = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(request.image);
        if (match) {
          const bytes = Buffer.from(match[3], "base64"), file = `image.${match[2] === "jpeg" ? "jpg" : match[2]}`;
          write(directory, file, bytes);
          image = { file, mimeType:match[1], bytes:bytes.length, sha256:crypto.createHash("sha256").update(bytes).digest("hex"), includedInRequest:JSON.stringify(body).includes(request.image) };
        }
      }
      // Preserve the actual prompt and body, replacing only the encoded image.
      const savedBody = JSON.parse(JSON.stringify(body, (key, value) => image && value === request.image ? `<saved as ${image.file}>` : value));
      write(directory, "request.json", JSON.stringify(savedBody, null, 2));
      const state = savedBody.context ?? savedBody.state ?? savedBody.facts;
      write(directory, "prompt.txt", `State:\n${typeof state === "string" ? state : JSON.stringify(state, null, 2)}\n\nQuestions:\n${JSON.stringify(savedBody.questions || {mode:savedBody.mode,version:savedBody.version}, null, 2)}\n`);
      let endpoint = null;
      try { const url = new URL(config.url); endpoint = `${url.origin}${url.pathname}`; } catch {}
      const data = { version:1, kind:"penecho-llm-request", requestId, startedAt, updatedAt:startedAt, completedAt:null,
        status:"in-flight", phase:"prepared", model:config.model, stateFormat:config.stateFormat || "image", mock:Boolean(config.mock),
        endpoint, timeoutMs:config.timeoutMs, requestFile:"request.json", promptFile:"prompt.txt", image,
        upstreamAttempted:false, response:null, result:null, error:null };
      function update(values) {
        return guarded(() => {
          Object.assign(data, values, { updatedAt:new Date().toISOString() });
          write(directory, "trace.json", JSON.stringify(data, null, 2));
        });
      }
      function diagnostic(value) {
        // Provider failures can echo a credential even without a labelled field.
        return safeTraceValue(JSON.parse(JSON.stringify(value, (key, item) =>
          typeof item === "string" && config.key ? item.split(config.key).join("<redacted>") : item)));
      }
      function finish(values) {
        update({ ...values, completedAt:new Date().toISOString(), durationMs:Date.now() - started });
        active.delete(name);
        prune();
      }
      update({});
      active.add(name);
      prune();
      return {
        sending:() => update({ phase:"sending", upstreamAttempted:true }),
        response:status => update({ phase:"reading-response", response:{ status } }),
        responseBody:text => guarded(() => update({ phase:"validating-response", response:{ ...data.response, body:diagnostic(text) } })),
        complete:result => guarded(() => finish({ status:"completed", phase:"completed", result:diagnostic(result) })),
        fail:(error, { cancelled = false, timedOut = false } = {}) => guarded(() => finish({
          status:cancelled ? "cancelled" : timedOut ? "timeout" : "failed",
          error:diagnostic({ name:error?.name, message:String(error?.message || error), status:error?.status || null,
            upstreamStatus:error?.upstreamStatus || null, code:error?.code || null,
            cause:error?.cause ? { name:error.cause.name, message:error.cause.message, code:error.cause.code } : null }),
        })),
      };
    });
  }
  return { begin };
}

module.exports = { createJeVisionRequestTracer };
