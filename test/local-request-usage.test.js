"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeLocalTokenUsage, localUsageRecord } = require("../src/server/local-request-usage.js");

test("local usage preserves unknown counters and recognizes explicit zero",()=>{
  assert.deepEqual(normalizeLocalTokenUsage(null),{inputTokens:null,outputTokens:null,cacheReadInputTokens:null,cacheWriteInputTokens:null});
  assert.deepEqual(normalizeLocalTokenUsage({prompt_tokens:100,completion_tokens:0,prompt_tokens_details:{cached_tokens:0}}),{inputTokens:100,outputTokens:0,cacheReadInputTokens:0,cacheWriteInputTokens:null});
});

test("local usage normalizes inclusive OpenAI and exclusive Anthropic/Harness inputs",()=>{
  const expected={inputTokens:150,outputTokens:20,cacheReadInputTokens:40,cacheWriteInputTokens:10};
  assert.deepEqual(normalizeLocalTokenUsage({prompt_tokens:150,completion_tokens:20,prompt_tokens_details:{cached_tokens:40},cacheWriteInputTokens:10}),expected);
  assert.deepEqual(normalizeLocalTokenUsage({input_tokens:100,output_tokens:20,cache_read_input_tokens:40,cache_creation_input_tokens:10},"anthropic"),expected);
  assert.deepEqual(normalizeLocalTokenUsage({inputTokens:100,outputTokens:20,cacheReadTokens:40,cacheWriteTokens:10},"harness"),expected);
});

test("local usage keeps a record when cache is known but input is unknown, without inferring the total",()=>{
  const usage={input_tokens:null,cache_read_input_tokens:40,cache_creation_input_tokens:10,output_tokens:20};
  assert.deepEqual(normalizeLocalTokenUsage(usage,"anthropic"),{
    inputTokens:null,outputTokens:20,cacheReadInputTokens:40,cacheWriteInputTokens:10,
  });
  const partial=localUsageRecord({usage:{input_tokens:100,cache_read_input_tokens:40},usageFormat:"anthropic"});
  assert.ok(partial);
  assert.equal(partial.inputTokens,null);
  assert.equal(partial.cacheReadInputTokens,40);
  assert.equal(partial.cacheWriteInputTokens,null);
});

test("local usage accepts provider cache aliases and keeps inclusive OpenAI input independent of unknown cache",()=>{
  assert.deepEqual(normalizeLocalTokenUsage({promptTokens:100,completionTokens:8,prompt_tokens_details:{cached_tokens:40,cache_write_tokens:3}}),{
    inputTokens:100,outputTokens:8,cacheReadInputTokens:40,cacheWriteInputTokens:3,
  });
  assert.deepEqual(normalizeLocalTokenUsage({input_tokens:100,cache_read_tokens:40,cache_write_tokens:3},"anthropic"),{
    inputTokens:143,outputTokens:null,cacheReadInputTokens:40,cacheWriteInputTokens:3,
  });
  assert.deepEqual(normalizeLocalTokenUsage({inputTokens:100,cacheReadInputTokens:40,cacheWriteInputTokens:3},"openai"),{
    inputTokens:100,outputTokens:null,cacheReadInputTokens:40,cacheWriteInputTokens:3,
  });
  assert.deepEqual(normalizeLocalTokenUsage({prompt_tokens:100,prompt_tokens_details:{cached_tokens:40}},"openai"),{
    inputTokens:100,outputTokens:null,cacheReadInputTokens:40,cacheWriteInputTokens:null,
  });
});

test("reported records contain only account usage metadata and do not double report hosted billing",()=>{
  const input={connectionId:"default",connectionName:"My API",model:"test-model",createdAt:1,completedAt:2,usage:{prompt_tokens:10,completion_tokens:3},prompt:"private",apiKey:"secret",response:"private"};
  const record=localUsageRecord(input);
  assert.match(record.requestId,/^[0-9a-f-]{36}$/);
  assert.equal(record.connectionName,"My API");
  assert.equal(record.inputTokens,10);
  assert.equal(record.cacheReadInputTokens,null);
  assert.equal(record.createdAt,"1970-01-01T00:00:00.001Z");
  assert.equal(JSON.stringify(record).includes("secret"),false);
  assert.equal(JSON.stringify(record).includes("private"),false);
  assert.equal(localUsageRecord({...input,connectionId:"hosted:db6e5128-0ec7-4a2a-a9bd-6b20c49c322b"}),null);
});

test("reported records satisfy the bounded Cloud metadata contract",()=>{
  const record=localUsageRecord({
    requestId:"not-a-uuid",connectionId:"not-a-connection",connectionName:"line\tbreak",model:"model\u0007name",
    action:"unexpected",status:"unexpected",createdAt:"not-a-date",completedAt:2,
  });
  assert.match(record.requestId,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(record.connectionId,"default");
  assert.equal(record.connectionName,"line break");
  assert.equal(record.model,"model name");
  assert.equal(record.action,"main-canvas");
  assert.equal(record.status,"failed");
  assert.doesNotThrow(()=>new Date(record.createdAt).toISOString());
  assert.equal(record.completedAt,"1970-01-01T00:00:00.002Z");
});
