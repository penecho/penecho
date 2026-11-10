"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function cliAdapter(callCli) {
  const { PenEchoCliAdapter } = await import("../src/server/canvas-agent/cli-adapter.mjs");
  const adapter = new PenEchoCliAdapter({ callCli, timeoutMs:() => 10_000 });
  const provider = adapter.replaceConnections([{ id:"progress", provider:"claude-cli", cliPath:"claude", cliModel:"test", effort:"medium" }])[0];
  return { adapter, provider };
}

function streamOptions(provider, tools = []) {
  return { provider, model:"test", sessionId:"cli-progress", messages:[], tools };
}

async function collect(iterator) {
  const chunks = [];
  for await (const chunk of iterator) chunks.push(chunk);
  return chunks;
}

test("CLI progress is emitted before completion and precedes the tool block without leaking later JSON", async () => {
  let finishCli, cliComplete = false;
  const decision = JSON.stringify({
    progress:"Progress: Inspecting the visible Canvas",
    type:"tool_call",
    name:"canvas_inspect",
    arguments:{ scope:"canvas", privateArgument:"DO_NOT_STREAM" },
    privateReasoning:"DO_NOT_STREAM_EITHER",
  });
  const { adapter, provider } = await cliAdapter(({ onText, signal }) => new Promise((resolve, reject) => {
    onText(decision.slice(0, decision.indexOf("Canvas") + 3), { mode:"delta" });
    onText(decision.slice(decision.indexOf("Canvas") + 3), { mode:"delta" });
    finishCli = () => { cliComplete = true; resolve(decision); };
    signal.addEventListener("abort", () => reject(signal.reason), { once:true });
  }));
  const iterator = adapter.stream(streamOptions(provider, [{ name:"canvas_inspect", description:"Inspect", parameters:{ type:"object" } }]));
  const publicChunks = [(await iterator.next()).value, (await iterator.next()).value, (await iterator.next()).value];
  assert.equal(cliComplete, false, "the public progress block must finish while the CLI call is still pending");
  assert.deepEqual(publicChunks.map(chunk => [chunk.type, chunk.index]), [
    ["block-start", 0], ["text-delta", 0], ["block-end", 0],
  ]);
  assert.equal(publicChunks[1].text, "Progress: Inspecting the visible Canvas");
  assert.doesNotMatch(JSON.stringify(publicChunks), /DO_NOT_STREAM|privateReasoning|privateArgument|arguments/);
  finishCli();
  const rest = await collect(iterator);
  assert.deepEqual(rest.filter(chunk => chunk.type === "block-start").map(chunk => [chunk.index, chunk.blockType]), [[1, "tool-call"]]);
  assert.equal(rest.find(chunk => chunk.type === "block-end")?.block.name, "canvas_inspect");
  assert.equal(rest.at(-1).reason.kind, "tool-calls");
});

test("progress decoding handles JSON escapes, one-character boundaries, cumulative events, and malformed prefixes", async () => {
  const { createCliProgressDecoder } = await import("../src/server/canvas-agent/cli-adapter.mjs");
  const progress = "Progress: Checking \"quoted\" C:\\tmp\nnext";
  const source = JSON.stringify({ progress, type:"final", text:"Done" });
  const deltaDecoder = createCliProgressDecoder();
  let decoded = null;
  for (const char of source) decoded ||= deltaDecoder.push(char, { mode:"delta" });
  assert.equal(decoded, progress);

  const cumulativeDecoder = createCliProgressDecoder();
  decoded = null;
  for (let index = 1; index <= source.length; index++) decoded ||= cumulativeDecoder.push(source.slice(0, index), { mode:"complete" });
  assert.equal(decoded, progress);

  const largeDecoder = createCliProgressDecoder();
  const largeDecision = JSON.stringify({ progress:"Progress: bounded prefix", type:"tool_call", name:"canvas_create", arguments:{ html:"x".repeat(30_000) } });
  assert.equal(largeDecoder.push(largeDecision, { mode:"complete" }), "Progress: bounded prefix");
  assert.equal(largeDecoder.stopped, true);

  for (const malformed of [
    '{"progress":123,"type":"final","text":"safe"}',
    '{"type":"final","progress":"Progress: too late","text":"safe"}',
    'reasoning before {"progress":"Progress: hidden","type":"final","text":"safe"}',
    '{"progress":"unterminated\\uZZZZ',
  ]) {
    const decoder = createCliProgressDecoder();
    assert.equal(decoder.push(malformed, { mode:"complete" }), null);
  }
});

test("optional malformed or late progress never rejects an otherwise valid decision", async () => {
  const { parseCliDecision } = await import("../src/server/canvas-agent/cli-adapter.mjs");
  const late = parseCliDecision('{"type":"tool_call","name":"canvas_inspect","arguments":{},"progress":"Progress: late fallback"}', ["canvas_inspect"]);
  assert.equal(late.progress, "Progress: late fallback");
  for (const progress of [123, "", "x".repeat(161)]) {
    const parsed = parseCliDecision(JSON.stringify({ type:"tool_call", name:"canvas_inspect", arguments:{}, progress }), ["canvas_inspect"]);
    assert.equal(parsed.type, "tool_call");
    assert.equal(Object.hasOwn(parsed, "progress"), false);
  }
});

test("a repaired CLI decision does not duplicate already emitted progress", async () => {
  let calls = 0;
  const progress = "Progress: Repairing the decision envelope";
  const final = JSON.stringify({ progress, type:"final", text:"Done" });
  const { adapter, provider } = await cliAdapter(async ({ onText }) => {
    calls += 1;
    onText(final, { mode:"complete" });
    return calls === 1 ? "not-json" : final;
  });
  const chunks = await collect(adapter.stream(streamOptions(provider)));
  assert.equal(calls, 2);
  assert.deepEqual(chunks.filter(chunk => chunk.type === "block-end" && chunk.block.type === "text").map(chunk => chunk.block.text), [
    progress,
    "\n\nDone",
  ]);
  assert.deepEqual(chunks.filter(chunk => chunk.type === "block-start").map(chunk => chunk.index), [0, 1]);
});

test("closing the iterator after progress aborts the pending disposable CLI call", async () => {
  let reportAbort;
  const aborted = new Promise(resolve => { reportAbort = resolve; });
  const decision = '{"progress":"Progress: Waiting for inspection","type":"final","text":"stale"}';
  const { adapter, provider } = await cliAdapter(({ onText, signal }) => new Promise((resolve, reject) => {
    onText(decision, { mode:"complete" });
    signal.addEventListener("abort", () => { reportAbort(signal.reason); reject(signal.reason); }, { once:true });
  }));
  const iterator = adapter.stream(streamOptions(provider));
  assert.equal((await iterator.next()).value.type, "block-start");
  await iterator.return();
  const reason = await aborted;
  assert.equal(reason.name, "AbortError");
  assert.match(reason.message, /stream closed/);
});

test("Claude public text callback exposes text deltas but not thinking deltas", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-claude-public-text-"));
  const fakeCli = path.join(directory, "fake-claude.js");
  const decision = '{"progress":"Progress: Reading Canvas","type":"final","text":"Done"}';
  fs.writeFileSync(fakeCli, `"use strict";
process.stdin.resume();
process.stdin.on("end",()=>{
  const out=e=>process.stdout.write(JSON.stringify(e)+"\\n");
  out({type:"system",subtype:"init",tools:[],mcp_servers:[]});
  out({type:"stream_event",event:{type:"content_block_delta",delta:{type:"thinking_delta",thinking:"PRIVATE_REASONING"}}});
  out({type:"stream_event",event:{type:"content_block_delta",delta:{type:"text_delta",text:${JSON.stringify(decision.slice(0, 24))}}}});
  out({type:"stream_event",event:{type:"content_block_delta",delta:{type:"text_delta",text:${JSON.stringify(decision.slice(24))}}}});
  out({type:"result",subtype:"success",result:${JSON.stringify(decision)}});
});`);
  try {
    const { callClaudeCli } = require("../src/providers/claude-cli.js"), observed = [];
    const result = await callClaudeCli({ executable:fakeCli, systemPrompt:"system", prompt:"request", onText:(text, metadata) => observed.push({ text, mode:metadata.mode }) });
    assert.equal(result, decision);
    assert.equal(observed.filter(item => item.mode === "delta").map(item => item.text).join(""), decision);
    assert.doesNotMatch(JSON.stringify(observed), /PRIVATE_REASONING|thinking_delta/);
    assert.equal(observed.at(-1).mode, "complete");
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});

test("Kimi cumulative public text waits through a split CLI bullet prefix", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-kimi-public-text-"));
  const fakeCli = path.join(directory, "fake-kimi.js");
  const decision = '{"progress":"Progress: Inspecting Canvas","type":"final","text":"Done"}';
  fs.writeFileSync(fakeCli, `"use strict";
process.stdout.write("•");
setTimeout(()=>process.stdout.write(" "+${JSON.stringify(decision)}),10);`);
  try {
    const { callKimiCanvasAgentCli } = require("../src/providers/kimi-cli.js"), observed = [];
    const result = await callKimiCanvasAgentCli({ executable:fakeCli, prompt:"request", onText:(text, metadata) => observed.push({ text, mode:metadata.mode }) });
    assert.equal(result, decision);
    assert.equal(observed.some(item => item.text === "•"), false);
    assert.equal(observed.at(-1).text, decision);
    assert.equal(observed.at(-1).mode, "complete");
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});

test("Codex public text callback uses its completed assistant message event", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-codex-public-text-"));
  const fakeCli = path.join(directory, "fake-codex.js"), codexHome = path.join(directory, "codex-home");
  const decision = '{"progress":"Progress: Inspecting Canvas","type":"final","text":"Done"}';
  fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome, "auth.json"), '{"auth_mode":"test"}');
  fs.writeFileSync(fakeCli, `"use strict";
const out=e=>process.stdout.write(JSON.stringify(e)+"\\n");
out({type:"turn.started"});
out({type:"item.completed",item:{type:"agent_message",text:${JSON.stringify(decision)}}});
out({type:"turn.completed"});`);
  try {
    const { callCodexCli } = require("../src/providers/codex-cli.js"), observed = [];
    const result = await callCodexCli({ executable:fakeCli, prompt:"request", env:{ ...process.env, CODEX_HOME:codexHome }, onText:(text, metadata) => observed.push({ text, mode:metadata.mode }) });
    assert.equal(result, decision);
    assert.deepEqual(observed, [{ text:decision, mode:"complete" }]);
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});
