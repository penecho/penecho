"use strict";
// A stand-in for PenEcho Cloud's hosted model routes (/api/v1/hosted/chat/completions and /api/v1/hosted/v1/messages)
// that answers each call from a script of faults, so a test can see what the PenEcho agent does when Cloud or the
// network misbehaves. Every call is recorded with its idempotency key.
//
// A script entry is one of:
//   "ok"                       a whole answer (the text given by `answer`, or "Done.")
//   "refuse"                   the connection is closed before any answer
//   { status, retryAfter, body }   an HTTP error answer
//   { status, cloudflare:true }    Cloudflare's own HTML error page with that status (it replaces any 502 or 504 from Cloud)
//   "stall"                    headers, then nothing at all
//   "stall-headers"            nothing at all, not even headers
//   "cut"                      some words, then the answer ends cleanly with no end marker
//   "reset"                    some words, then the connection is torn down
//   "error-event"              some words, then an error inside the stream (what Cloud sends after its first byte)
//   "keepalive-error"          a keepalive comment, then an error inside the stream before any words
//   "finish-no-done"           a whole answer whose closing [DONE] / message_stop was lost
//   { tool, args }             a whole answer that calls one tool (OpenAI format only)
//   { slow:ms }                keepalive comments every 50 ms, then a whole answer after ms (as Cloud does on a slow model)
const http = require("node:http");

const openaiChunk = (delta, finish = null, usage) => `data: ${JSON.stringify({ id:"chatcmpl-fake", object:"chat.completion.chunk", created:1, model:"fake", choices:[{ index:0, delta, finish_reason:finish }], ...(usage ? { usage } : {}) })}\n\n`;
const anthropicEvent = value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;

function startFakeModelCloud({ script = [], answer = "Done.", after = "ok" } = {}) {
  const calls = [], sockets = new Set();
  let index = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* recorded as empty */ }
    const anthropic = req.url.endsWith("/v1/messages");
    const step = index < script.length ? script[index] : after;
    index += 1;
    calls.push({ at:Date.now(), url:req.url, key:String(req.headers["idempotency-key"] || ""), product:String(req.headers["x-penecho-product"] || ""), step, body });
    const start = () => res.writeHead(200, { "content-type":"text/event-stream" });
    const words = () => anthropic
      ? anthropicEvent({ type:"message_start", message:{ id:"msg_fake", type:"message", role:"assistant", model:"fake", content:[], usage:{ input_tokens:5, output_tokens:0 } } })
        + anthropicEvent({ type:"content_block_start", index:0, content_block:{ type:"text", text:"" } })
        + anthropicEvent({ type:"content_block_delta", index:0, delta:{ type:"text_delta", text:"Half an ans" } })
      : openaiChunk({ role:"assistant", content:"Half an ans" });
    if (step === "refuse") return req.socket.destroy();
    if (step === "stall-headers") return;
    if (step === "stall") { start(); res.flushHeaders(); return; }
    if (step && typeof step === "object" && step.slow) {
      start();
      const beat = setInterval(() => res.write(": keepalive\n\n"), 50);
      return setTimeout(() => {
        clearInterval(beat);
        if (anthropic) {
          res.write(words()); res.write(anthropicEvent({ type:"content_block_stop", index:0 }));
          res.write(anthropicEvent({ type:"message_delta", delta:{ stop_reason:"end_turn", stop_sequence:null }, usage:{ output_tokens:3 } }));
          return res.end(anthropicEvent({ type:"message_stop" }));
        }
        res.write(openaiChunk({ role:"assistant", content:answer }));
        res.end(openaiChunk({}, "stop", { prompt_tokens:5, completion_tokens:3, total_tokens:8 }) + "data: [DONE]\n\n");
      }, step.slow);
    }
    if (step && typeof step === "object" && step.tool) {
      start();
      res.write(openaiChunk({ role:"assistant", tool_calls:[{ index:0, id:`call_${index}`, type:"function", function:{ name:step.tool, arguments:JSON.stringify(step.args || {}) } }] }));
      res.write(openaiChunk({}, "tool_calls", { prompt_tokens:5, completion_tokens:3, total_tokens:8 }));
      return res.end("data: [DONE]\n\n");
    }
    if (step === "finish-no-done") {
      start();
      if (anthropic) {
        res.write(words());
        res.write(anthropicEvent({ type:"content_block_stop", index:0 }));
        return res.end(anthropicEvent({ type:"message_delta", delta:{ stop_reason:"end_turn", stop_sequence:null }, usage:{ output_tokens:3 } }));
      }
      res.write(openaiChunk({ role:"assistant", content:answer }));
      return res.end(openaiChunk({}, "stop", { prompt_tokens:5, completion_tokens:3, total_tokens:8 }));
    }
    // Cloudflare's own error page, which it puts in place of any 502 or 504 the origin sends (what Cloud's JSON 502 became before R1b).
    if (step && typeof step === "object" && step.cloudflare) {
      res.writeHead(step.status, { "content-type":"text/html; charset=UTF-8", server:"cloudflare" });
      return res.end(`<!DOCTYPE html><html><head><title>penecho.ai | ${step.status}: ${step.status === 504 ? "Gateway time-out" : "Bad gateway"}</title></head><body><h1>${step.status === 504 ? "Gateway time-out" : "Bad gateway"}</h1><span>Error code ${step.status}</span><p>Cloudflare</p></body></html>`);
    }
    if (step && typeof step === "object") {
      res.writeHead(step.status, { "content-type":"application/json", ...(step.retryAfter !== undefined ? { "retry-after":String(step.retryAfter) } : {}) });
      return res.end(JSON.stringify(step.body || { error:`fake_${step.status}`, message:`Fake Cloud answered ${step.status}.` }));
    }
    if (step === "cut") { start(); res.write(words()); return res.end(); }
    if (step === "reset") { start(); res.write(words()); return setTimeout(() => req.socket.destroy(), 20); }
    if (step === "error-event" || step === "keepalive-error") {
      start();
      res.write(step === "keepalive-error" ? ": keepalive\n\n" : words());
      const error = { code:"provider_timeout", message:"The provider produced no model progress within the inactivity timeout." };
      return res.end(anthropic ? anthropicEvent({ type:"error", error:{ type:error.code, message:error.message } }) : `data: ${JSON.stringify({ error })}\n\n`);
    }
    // "ok": a whole answer.
    start();
    if (anthropic) {
      res.write(anthropicEvent({ type:"message_start", message:{ id:"msg_fake", type:"message", role:"assistant", model:"fake", content:[], usage:{ input_tokens:5, output_tokens:0 } } }));
      res.write(anthropicEvent({ type:"content_block_start", index:0, content_block:{ type:"text", text:"" } }));
      res.write(anthropicEvent({ type:"content_block_delta", index:0, delta:{ type:"text_delta", text:answer } }));
      res.write(anthropicEvent({ type:"content_block_stop", index:0 }));
      res.write(anthropicEvent({ type:"message_delta", delta:{ stop_reason:"end_turn", stop_sequence:null }, usage:{ output_tokens:3 } }));
      return res.end(anthropicEvent({ type:"message_stop" }));
    }
    res.write(openaiChunk({ role:"assistant", content:answer }));
    res.write(openaiChunk({}, "stop", { prompt_tokens:5, completion_tokens:3, total_tokens:8 }));
    res.end("data: [DONE]\n\n");
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    resolve({
      origin, calls,
      script(next) { script = next; index = 0; calls.length = 0; },
      close() { for (const socket of sockets) socket.destroy(); return new Promise(done => server.close(() => done())); },
    });
  }));
}

module.exports = { startFakeModelCloud };
