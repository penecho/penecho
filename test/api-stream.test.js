"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isEventStreamResponse, providerResponseText, readProviderEventStream } = require("../src/server/api-stream.js");

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers:{ "Content-Type":"text/event-stream; charset=utf-8" } });
}

function data(value, event = "") {
  return `${event ? `event: ${event}\n` : ""}data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`;
}

test("OpenAI Chat Completions SSE survives arbitrary network chunk boundaries", async () => {
  const content = '{"intent":"answer","commands":[]}', events = [
    ": heartbeat\n\n",
    data({ id:"chat-1", model:"test-model", choices:[{ delta:{ role:"assistant" }, finish_reason:null }] }),
    data({ id:"chat-1", model:"test-model", choices:[{ delta:{ content:content.slice(0,12) }, finish_reason:null }] }),
    data({ id:"chat-1", model:"test-model", choices:[{ delta:{ content:content.slice(12) }, finish_reason:null }] }),
    data({ id:"chat-1", model:"test-model", choices:[{ delta:{}, finish_reason:"stop" }], usage:{ prompt_tokens:10, completion_tokens:4 } }),
    data("[DONE]"),
  ].join(""), cuts = [1, 7, 19, 53, 121, events.length - 4], chunks = [];
  let start = 0;
  for (const end of cuts) { chunks.push(events.slice(start,end));start=end; }
  chunks.push(events.slice(start));
  let activityCount=0;
  const response = streamResponse(chunks), result = await readProviderEventStream(response,"openai",{onActivity:()=>activityCount++});
  assert.equal(isEventStreamResponse(response),true);
  assert.equal(result.content,content);
  assert.equal(result.raw.id,"chat-1");
  assert.equal(result.raw.choices[0].finish_reason,"stop");
  assert.equal(result.raw.usage.prompt_tokens,10);
  assert.equal(result.stream.mode,"sse");
  assert.equal(result.stream.eventCount,5);
  assert.equal(activityCount,chunks.length);
});

test("Anthropic Messages SSE joins text deltas and completion metadata", async () => {
  const content = '{"intent":"none","commands":[]}', response = streamResponse([
    data({ type:"message_start", message:{ id:"msg-1", model:"claude-test", usage:{ input_tokens:20 } } },"message_start"),
    data({ type:"content_block_start", index:0, content_block:{ type:"text", text:"" } },"content_block_start"),
    data({ type:"content_block_delta", index:0, delta:{ type:"text_delta", text:content.slice(0,9) } },"content_block_delta"),
    data({ type:"content_block_delta", index:0, delta:{ type:"text_delta", text:content.slice(9) } },"content_block_delta"),
    data({ type:"message_delta", delta:{ stop_reason:"end_turn" }, usage:{ output_tokens:5 } },"message_delta"),
    data({ type:"message_stop" },"message_stop"),
  ]), result = await readProviderEventStream(response,"anthropic");
  assert.equal(result.content,content);
  assert.equal(result.raw.id,"msg-1");
  assert.equal(result.raw.stop_reason,"end_turn");
  assert.deepEqual(result.raw.usage,{ input_tokens:20, output_tokens:5 });
});

test("OpenAI Responses SSE reads typed output events", async () => {
  const content = '{"intent":"answer","commands":[]}', response = streamResponse([
    data({ type:"response.created", response:{ id:"resp-1", model:"gpt-test" } },"response.created"),
    data({ type:"response.output_text.delta", delta:content.slice(0,10) },"response.output_text.delta"),
    data({ type:"response.output_text.delta", delta:content.slice(10) },"response.output_text.delta"),
    data({ type:"response.completed", response:{ id:"resp-1", model:"gpt-test", status:"completed", usage:{ input_tokens:30, output_tokens:6 } } },"response.completed"),
  ]), result = await readProviderEventStream(response,"openai-responses");
  assert.equal(result.content,content);
  assert.equal(result.raw.id,"resp-1");
  assert.equal(result.raw.status,"completed");
  assert.equal(result.raw.usage.input_tokens,30);
});

test("SSE dispatches an otherwise complete final event without a trailing blank line", async () => {
  const content = '{"intent":"answer","commands":[]}', response = streamResponse([
    `data: ${JSON.stringify({ id:"chat-eof", model:"test-model", choices:[{ delta:{ content }, finish_reason:"stop" }] })}`,
  ]), result = await readProviderEventStream(response,"openai");
  assert.equal(result.content,content);
  assert.equal(result.raw.id,"chat-eof");
  assert.equal(result.raw.choices[0].finish_reason,"stop");
  assert.equal(result.stream.eventCount,1);
});

test("Anthropic dispatches an unterminated message_stop event at EOF", async () => {
  const content = '{"intent":"none","commands":[]}', response = streamResponse([
    data({ type:"content_block_delta", index:0, delta:{ type:"text_delta", text:content } },"content_block_delta"),
    `event: message_delta\ndata: ${JSON.stringify({ type:"message_delta", delta:{ stop_reason:"end_turn" } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type:"message_stop" })}`,
  ]), result = await readProviderEventStream(response,"anthropic");
  assert.equal(result.content,content);
  assert.equal(result.raw.stop_reason,"end_turn");
  assert.equal(result.stream.eventCount,3);
});

test("provider JSON extraction remains compatible with non-streaming envelopes", () => {
  assert.equal(providerResponseText({ choices:[{ message:{ content:"chat" } }] },"openai"),"chat");
  assert.equal(providerResponseText({ content:[{ type:"thinking", thinking:"hidden" }, { type:"text", text:"anthropic" }] },"anthropic"),"anthropic");
  assert.equal(providerResponseText({ output:[{ type:"message", content:[{ type:"output_text", text:"responses" }] }] },"openai-responses"),"responses");
});

test("an SSE connection closing without a completion event is rejected", async () => {
  const response = streamResponse([data({ choices:[{ delta:{ content:"partial" }, finish_reason:null }] })]);
  await assert.rejects(readProviderEventStream(response,"openai"),error => {
    assert.match(error.message,/ended before its completion event/);
    assert.equal(error.traceStream.mode,"sse");
    assert.equal(error.traceStream.eventCount,1);
    assert.ok(error.traceStream.firstEventAt);
    return true;
  });
});
