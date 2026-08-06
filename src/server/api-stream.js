"use strict";

const { createParser } = require("eventsource-parser");

const MAX_SSE_EVENT_CHARS = 2 * 1024 * 1024;
const MAX_STREAM_CONTENT_CHARS = 4 * 1024 * 1024;

function responseContentType(response) {
  return String(response?.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
}

function isEventStreamResponse(response) {
  return responseContentType(response) === "text/event-stream";
}

function textFromParts(parts) {
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return "";
  return parts.map(part => typeof part === "string" ? part : part?.text || part?.output_text || "").join("");
}

function providerResponseText(raw, format) {
  if (format === "anthropic") return Array.isArray(raw?.content)
    ? raw.content.filter(block => block?.type === "text").map(block => block.text || "").join("\n")
    : "";
  if (format === "openai-responses") {
    if (typeof raw?.output_text === "string") return raw.output_text;
    return Array.isArray(raw?.output) ? raw.output
      .filter(item => item?.type === "message")
      .flatMap(item => Array.isArray(item.content) ? item.content : [])
      .filter(item => item?.type === "output_text")
      .map(item => item.text || "")
      .join("") : "";
  }
  return textFromParts(raw?.choices?.[0]?.message?.content);
}

function streamError(message, payload = null) {
  const error = new Error(message || "Model stream failed.");
  error.name = "ModelStreamError";
  if (payload) error.upstreamEvent = payload;
  return error;
}

function payloadError(payload) {
  const detail = payload?.error || payload;
  return String(detail?.message || detail?.type || detail?.code || "Model stream returned an error.");
}

function createStreamAccumulator(format) {
  const chunks = [];
  let contentChars = 0, responseId = null, model = null, finishReason = null, usage = null,
    completed = false, deltaSeen = false, finalResponse = null;

  const append = value => {
    const text = textFromParts(value);
    if (!text) return;
    contentChars += text.length;
    if (contentChars > MAX_STREAM_CONTENT_CHARS) throw streamError("Model stream content exceeded the 4 MB limit.");
    chunks.push(text);
    deltaSeen = true;
  };
  const metadata = value => {
    if (typeof value?.id === "string") responseId = value.id;
    if (typeof value?.model === "string") model = value.model;
    if (value?.usage && typeof value.usage === "object") usage = value.usage;
  };

  function acceptOpenAiChat(payload) {
    if (payload?.error) throw streamError(payloadError(payload), payload);
    metadata(payload);
    const choice = payload?.choices?.[0];
    append(choice?.delta?.content);
    if (!deltaSeen) append(choice?.message?.content);
    if (typeof choice?.finish_reason === "string") {
      finishReason = choice.finish_reason;
      completed = true;
    }
  }

  function acceptAnthropic(type, payload) {
    if (type === "error" || payload?.type === "error") throw streamError(payloadError(payload), payload);
    if (type === "message_start") {
      metadata(payload?.message);
      return;
    }
    if (type === "content_block_start") {
      if (payload?.content_block?.type === "text") append(payload.content_block.text);
      return;
    }
    if (type === "content_block_delta") {
      if (payload?.delta?.type === "text_delta") append(payload.delta.text);
      return;
    }
    if (type === "message_delta") {
      if (typeof payload?.delta?.stop_reason === "string") finishReason = payload.delta.stop_reason;
      if (payload?.usage && typeof payload.usage === "object") usage = { ...(usage || {}), ...payload.usage };
      return;
    }
    if (type === "message_stop") completed = true;
  }

  function acceptOpenAiResponses(type, payload) {
    if (type === "error" || payload?.type === "error") throw streamError(payloadError(payload), payload);
    const response = payload?.response;
    if (response) metadata(response);
    if (type === "response.output_text.delta") {
      append(payload?.delta);
      return;
    }
    if (type === "response.output_text.done") {
      if (!deltaSeen) append(payload?.text);
      return;
    }
    if (type === "response.completed") {
      finalResponse = response || payload;
      metadata(finalResponse);
      if (!deltaSeen) append(providerResponseText(finalResponse, "openai-responses"));
      finishReason = "completed";
      completed = true;
      return;
    }
    if (type === "response.incomplete") {
      const reason = response?.incomplete_details?.reason || "incomplete";
      throw streamError(`Model response was incomplete: ${reason}.`, payload);
    }
    if (type === "response.failed") throw streamError(payloadError(response?.error || payload), payload);
  }

  return {
    accept(event) {
      if (event.data === "[DONE]") {
        completed = true;
        return;
      }
      let payload;
      try { payload = JSON.parse(event.data); }
      catch { throw streamError("Model returned an invalid SSE JSON event."); }
      const type = event.event || payload?.type || "message";
      if (format === "anthropic") acceptAnthropic(type, payload);
      else if (format === "openai-responses") acceptOpenAiResponses(type, payload);
      else acceptOpenAiChat(payload);
    },
    result(eventCount, firstEventAt) {
      const content = chunks.join("");
      if (!completed) throw streamError("Model stream ended before its completion event.");
      if (!content) throw streamError("Model stream completed without text content.");
      const raw = format === "anthropic"
        ? { id:responseId, model, stop_reason:finishReason, content:[{ type:"text", text:content }], ...(usage ? { usage } : {}) }
        : format === "openai-responses"
          ? { ...(finalResponse && typeof finalResponse === "object" ? finalResponse : {}), id:responseId, model, output_text:content, ...(usage ? { usage } : {}) }
          : { id:responseId, model, choices:[{ finish_reason:finishReason, message:{ content } }], ...(usage ? { usage } : {}) };
      return { content, raw, stream:{ mode:"sse", eventCount, firstEventAt, completedAt:new Date().toISOString() } };
    },
  };
}

async function readProviderEventStream(response, format, options = {}) {
  if (!response?.body?.getReader) throw streamError("Model returned an empty SSE response body.");
  const reader = response.body.getReader(), decoder = new TextDecoder(), accumulator = createStreamAccumulator(format);
  let fatal = null, eventCount = 0, firstEventAt = null;
  const parser = createParser({
    maxBufferSize:MAX_SSE_EVENT_CHARS,
    onEvent(event) {
      if (fatal) return;
      try {
        eventCount++;
        if (!firstEventAt) firstEventAt = new Date().toISOString();
        options.onEvent?.({ eventCount, firstEventAt });
        accumulator.accept(event);
      } catch (error) { fatal = error; }
    },
    onError(error) { fatal ||= streamError(`Invalid model SSE stream: ${error.message}`); },
  });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value?.byteLength) options.onActivity?.();
      parser.feed(decoder.decode(value || new Uint8Array(), { stream:!done }));
      if (fatal) throw fatal;
      if (done) break;
    }
    // Some otherwise compatible providers close immediately after the final
    // data line. Treat EOF as the missing SSE event separator.
    parser.feed("\n\n");
    if (fatal) throw fatal;
    parser.reset();
    return accumulator.result(eventCount, firstEventAt);
  } catch (error) {
    if (error && typeof error === "object" && !error.traceStream) error.traceStream = {
      mode:"sse",
      eventCount,
      firstEventAt,
      failureAt:new Date().toISOString(),
    };
    try { await reader.cancel(error); } catch {}
    throw error;
  } finally {
    reader.releaseLock();
  }
}

module.exports = { isEventStreamResponse, providerResponseText, readProviderEventStream };
