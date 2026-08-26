"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildClaudeArgs, callClaudeCli, claudeEventUsage, claudeInput, claudeResult, sanitizeClaudeEnv } = require("../src/providers/claude-cli.js");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const WEBP = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==";

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-claude-test-"));
  test.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  return directory;
}

async function waitForMissing(file, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (fs.existsSync(file) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
}

test("Claude CLI arguments select one non-interactive image-analysis turn", () => {
  const args = buildClaudeArgs({ systemPrompt:"system instructions", model:"sonnet", effort:"max" });
  assert.deepEqual(args.slice(0, 5), ["-p", "--input-format", "stream-json", "--output-format", "stream-json"]);
  assert.ok(args.includes("--include-partial-messages"));
  assert.ok(args.includes("--verbose"));
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--disallowedTools") + 1], "Agent,Task");
  assert.equal(args[args.indexOf("--agents") + 1], "{}");
  assert.equal(args[args.indexOf("--prompt-suggestions") + 1], "false");
  assert.equal(args[args.indexOf("--system-prompt") + 1], "system instructions");
  assert.equal(args[args.indexOf("--model") + 1], "sonnet");
  assert.equal(args[args.indexOf("--effort") + 1], "max");
  assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]), { env:{ CLAUDE_CODE_EFFORT_LEVEL:"max" } });
  assert.equal(args.some(value => /temperature/i.test(String(value))), false);
  for (const flag of ["--no-session-persistence", "--safe-mode", "--disable-slash-commands", "--strict-mcp-config", "--no-chrome"]) assert.ok(args.includes(flag));
});

test("leaves Claude effort unset when the global value is empty", () => {
  const args = buildClaudeArgs({ systemPrompt:"system instructions", model:null, effort:null });
  assert.equal(args.includes("--effort"), false);
  assert.equal(args.includes("--settings"), false);
});

test("Claude none disables thinking without inventing a replacement effort", () => {
  const args = buildClaudeArgs({ systemPrompt:"system instructions", model:"opus", effort:"none" });
  assert.equal(args.includes("--effort"), false);
  assert.equal(args.includes("--settings"), false);
  assert.equal(args.includes("none"), false);
});

test("Claude CLI passes the configured effort through without model-family mapping", () => {
  const older = buildClaudeArgs({ systemPrompt:"system", model:"claude-opus-4-6", effort:"xhigh" });
  assert.equal(older[older.indexOf("--effort") + 1], "xhigh");
  const oldest = buildClaudeArgs({ systemPrompt:"system", model:"claude-opus-4-5", effort:"xhigh" });
  assert.equal(oldest[oldest.indexOf("--effort") + 1], "xhigh");
  const current = buildClaudeArgs({ systemPrompt:"system", model:"claude-opus-4-8", effort:"xhigh" });
  assert.equal(current[current.indexOf("--effort") + 1], "xhigh");
  const custom = buildClaudeArgs({ systemPrompt:"system", model:"claude-opus-4-8", effort:"Provider_Native" });
  assert.equal(custom[custom.indexOf("--effort") + 1], "Provider_Native");
});

test("Claude CLI input carries text and the canvas image in one streaming user message", () => {
  const payload = JSON.parse(claudeInput("request metadata", PNG));
  assert.equal(payload.type, "user");
  assert.equal(payload.message.content[0].text, "request metadata");
  assert.equal(payload.message.content[1].source.media_type, "image/png");
  assert.match(payload.message.content[1].source.data, /^[A-Za-z0-9+/]+=*$/);
});

test("Claude CLI input preserves a configured WebP image and MIME type", () => {
  const payload = JSON.parse(claudeInput("request metadata", WEBP));
  assert.equal(payload.message.content[1].source.media_type, "image/webp");
  assert.equal(Buffer.from(payload.message.content[1].source.data, "base64").toString("ascii", 0, 4), "RIFF");
});

test("Claude CLI input preserves a same-message image group", () => {
  const payload=JSON.parse(claudeInput("compare",[PNG,WEBP]));
  assert.deepEqual(payload.message.content.slice(1).map(part=>part.source.media_type),["image/png","image/webp"]);
});

test("Claude CLI input supports a text-only authoring request", () => {
  const payload = JSON.parse(claudeInput("improve this plugin"));
  assert.deepEqual(payload.message.content, [{ type:"text", text:"improve this plugin" }]);
});

test("Claude CLI child environment disables thinking only for none and removes API credentials", () => {
  const source = { PATH:"bin", HOME:"home", CLAUDE_CODE_OAUTH_TOKEN:"login-token", MAX_THINKING_TOKENS:"9000", AI_API_KEY:"secret", OPENAI_API_KEY:"legacy-secret", ANTHROPIC_API_KEY:"anthropic-secret", UNRELATED_SECRET:"private" },
    clean = sanitizeClaudeEnv(source, "none"), medium = sanitizeClaudeEnv(source, "medium"), native = sanitizeClaudeEnv(source, null);
  assert.equal(clean.PATH, "bin");
  assert.equal(clean.HOME, "home");
  assert.equal(clean.CLAUDE_CODE_OAUTH_TOKEN, "login-token");
  for (const name of ["AI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "UNRELATED_SECRET"]) assert.equal(clean[name], undefined);
  assert.equal(clean.CLAUDE_CODE_SKIP_PROMPT_HISTORY, "1");
  assert.equal(clean.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  assert.equal(clean.CLAUDE_CODE_DISABLE_TERMINAL_TITLE, "1");
  assert.equal(clean.MAX_THINKING_TOKENS, "0");
  assert.equal(medium.MAX_THINKING_TOKENS, undefined);
  assert.equal(native.MAX_THINKING_TOKENS, undefined);
});

test("Claude CLI JSON result parsing accepts text and structured output", () => {
  assert.equal(claudeResult(JSON.stringify({ type:"result", subtype:"success", result:"{\"commands\":[]}" })), '{"commands":[]}');
  assert.equal(claudeResult(`${JSON.stringify({ type:"system", subtype:"init" })}\n${JSON.stringify({ type:"result", subtype:"success", result:"{\"commands\":[]}" })}`), '{"commands":[]}');
  assert.equal(claudeResult(JSON.stringify({ type:"result", subtype:"success", structured_output:{ commands:[] } })), '{"commands":[]}');
  assert.throws(() => claudeResult("not-json"), /invalid JSON/);
  assert.throws(() => claudeResult(JSON.stringify({ type:"result", subtype:"error" })), /did not complete/);
  assert.throws(() => claudeResult(JSON.stringify({ type:"result", subtype:"success", result:"Failed to authenticate. API Error: 403 insufficient balance" })), error => error?.code === "UPSTREAM_ERROR" && /403 insufficient balance/.test(error.message));
});

test("Claude CLI exposes direct and per-model token usage", () => {
  assert.deepEqual(claudeEventUsage({ usage:{ input_tokens:12, cache_read_input_tokens:80, output_tokens:7 } }), { input_tokens:12, cache_read_input_tokens:80, output_tokens:7 });
  assert.deepEqual(claudeEventUsage({ modelUsage:{ opus:{ inputTokens:10, cacheReadInputTokens:40, cacheCreationInputTokens:5, outputTokens:3 }, haiku:{ inputTokens:2, cacheReadInputTokens:8, outputTokens:1 } } }), {
    input_tokens:12, cache_read_input_tokens:48, cache_creation_input_tokens:5, output_tokens:4,
  });
});

test("Claude CLI adapter sends the image, system prompt, model, and no API key", async () => {
  const directory = temporaryDirectory(), fakeCli = path.join(directory, "fake-claude.js"), record = path.join(directory, "record.json");
  fs.writeFileSync(fakeCli, `"use strict";const fs=require("node:fs");const args=process.argv.slice(2),input=JSON.parse(fs.readFileSync(0,"utf8").trim()),systemIndex=args.indexOf("--system-prompt"),systemPrompt=args[systemIndex+1],image=input.message.content.find(part=>part.type==="image");fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({args,systemPrompt,mediaType:image?.source?.media_type,hasImage:Boolean(image?.source?.data),maxThinkingTokens:process.env.MAX_THINKING_TOKENS}));const result={intent:"answer",observedText:"image",message:process.env.AI_API_KEY?"leaked":"ok",commands:[]};process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:JSON.stringify(result)}));\n`);
  let activityCount=0;
  const content = await callClaudeCli({ executable:fakeCli, model:"sonnet", effort:"medium", systemPrompt:"system instructions", prompt:"request metadata", atlasImage:PNG, env:{ ...process.env, AI_API_KEY:"must-not-leak", MAX_THINKING_TOKENS:"9000" }, onActivity:()=>activityCount++ });
  const result = JSON.parse(content), saved = JSON.parse(fs.readFileSync(record, "utf8"));
  assert.equal(result.message, "ok");
  assert.equal(saved.systemPrompt, "system instructions");
  assert.equal(saved.mediaType, "image/png");
  assert.equal(saved.hasImage, true);
  assert.equal(saved.args[saved.args.indexOf("--model") + 1], "sonnet");
  assert.equal(saved.args[saved.args.indexOf("--effort") + 1], "medium");
  assert.deepEqual(JSON.parse(saved.args[saved.args.indexOf("--settings") + 1]), { env:{ CLAUDE_CODE_EFFORT_LEVEL:"medium" } });
  assert.equal(saved.maxThinkingTokens, undefined);
  assert.ok(activityCount>0);
});

test("Claude CLI adapter executes a text-only request without an image part", async () => {
  const directory = temporaryDirectory(), fakeCli = path.join(directory, "fake-claude-text.js"), record = path.join(directory, "record.json");
  fs.writeFileSync(fakeCli, `"use strict";const fs=require("node:fs"),input=JSON.parse(fs.readFileSync(0,"utf8").trim());fs.writeFileSync(${JSON.stringify(record)},JSON.stringify(input.message.content));process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"improved plugin markdown"}));\n`);
  const content = await callClaudeCli({ executable:fakeCli, systemPrompt:"plugin authoring", prompt:"improve this plugin" });
  assert.equal(content, "improved plugin markdown");
  assert.deepEqual(JSON.parse(fs.readFileSync(record, "utf8")), [{ type:"text", text:"improve this plugin" }]);
});

test("Claude CLI none keeps the current thinking-disabled runtime", async () => {
  const directory = temporaryDirectory(), fakeCli = path.join(directory, "fake-claude.js"), record = path.join(directory, "record.json");
  fs.writeFileSync(fakeCli, `"use strict";const fs=require("node:fs"),args=process.argv.slice(2);fs.readFileSync(0,"utf8");fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({args,maxThinkingTokens:process.env.MAX_THINKING_TOKENS}));const result={intent:"answer",observedText:"image",message:"ok",commands:[]};process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:JSON.stringify(result)}));\n`);
  await callClaudeCli({ executable:fakeCli, model:"opus", effort:"none", systemPrompt:"system", prompt:"request", atlasImage:PNG });
  const saved = JSON.parse(fs.readFileSync(record, "utf8"));
  assert.equal(saved.maxThinkingTokens, "0");
  assert.equal(saved.args.includes("--effort"), false);
  assert.equal(saved.args.includes("--settings"), false);
  assert.equal(saved.args.includes("none"), false);
});

test("Claude CLI returns on the final result event without waiting for process exit", { timeout:10000 }, async () => {
  const directory = temporaryDirectory(), fakeCli = path.join(directory, "fake-claude.js"), marker = path.join(directory, "started.txt");
  fs.writeFileSync(fakeCli, `"use strict";const fs=require("node:fs");fs.writeFileSync(${JSON.stringify(marker)},process.cwd());const result={intent:"answer",observedText:"image",message:"early",commands:[]};process.stdout.write(JSON.stringify({type:"system",subtype:"init",tools:[],mcp_servers:[],model:"sonnet"})+"\\n");process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:JSON.stringify(result),usage:{input_tokens:12,cache_read_input_tokens:80,output_tokens:7}})+"\\n");setInterval(()=>{},1000);\n`);
  let usage = null;
  const started = Date.now(), content = await callClaudeCli({ executable:fakeCli, model:"sonnet", systemPrompt:"system", prompt:"request", atlasImage:PNG, onUsage:value=>{ usage=value; } });
  assert.equal(JSON.parse(content).message, "early");
  assert.deepEqual(usage, { input_tokens:12, cache_read_input_tokens:80, output_tokens:7 });
  assert.ok(Date.now() - started < 3000);
  const workDir = fs.readFileSync(marker, "utf8");
  await waitForMissing(workDir);
  assert.equal(fs.existsSync(workDir), false);
});

test("Claude CLI reports receiving when partial model output starts", { timeout:10000 }, async () => {
  const directory = temporaryDirectory(), fakeCli = path.join(directory, "fake-claude-stream.js");
  fs.writeFileSync(fakeCli, `"use strict";process.stdout.write(JSON.stringify({type:"system",subtype:"init",tools:[],mcp_servers:[]})+"\\n");setTimeout(()=>process.stdout.write(JSON.stringify({type:"stream_event",event:{type:"message_start",message:{role:"assistant",content:[]}}})+"\\n"),50);setTimeout(()=>process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"streamed result"})+"\\n"),150);\n`);
  let reportReceiving, activityCount=0;
  const receiving = new Promise(resolve => { reportReceiving = resolve; }), request = callClaudeCli({
    executable:fakeCli,
    systemPrompt:"system",
    prompt:"request",
    onProgress:phase => { if (phase === "receiving") reportReceiving(); },
    onActivity:()=>activityCount++,
  });
  assert.equal(await Promise.race([receiving.then(() => "receiving"), request.then(() => "resolved")]), "receiving");
  assert.equal(await request, "streamed result");
  assert.ok(activityCount >= 3);
});

test("Claude CLI rejects and stops any tool-use event", { timeout:10000 }, async () => {
  const directory = temporaryDirectory(), fakeCli = path.join(directory, "fake-claude.js"), marker = path.join(directory, "started.txt");
  fs.writeFileSync(fakeCli, `"use strict";const fs=require("node:fs");fs.writeFileSync(${JSON.stringify(marker)},process.cwd());process.stdout.write(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",name:"Agent",input:{}}]}})+"\\n");setInterval(()=>{},1000);\n`);
  await assert.rejects(callClaudeCli({ executable:fakeCli, model:"sonnet", systemPrompt:"system", prompt:"request", atlasImage:PNG }), error => /disabled tool use: Agent/.test(error?.message) && /assistant/.test(error?.traceDiagnostic || ""));
  const workDir = fs.readFileSync(marker, "utf8");
  await waitForMissing(workDir);
  assert.equal(fs.existsSync(workDir), false);
});

test("Claude CLI abort stops the process and discards its output", async () => {
  const directory = temporaryDirectory(), fakeCli = path.join(directory, "fake-claude.js"), marker = path.join(directory, "started.txt");
  fs.writeFileSync(fakeCli, `"use strict";const fs=require("node:fs");fs.writeFileSync(${JSON.stringify(marker)},process.cwd());process.stdout.write('{"type":"result","subtype":"success","result":"');setInterval(()=>process.stdout.write('stale'),10);\n`);
  const controller = new AbortController(), request = callClaudeCli({ executable:fakeCli, systemPrompt:"system", prompt:"wait", atlasImage:PNG, signal:controller.signal });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(marker) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(fs.existsSync(marker));
  const workDir = fs.readFileSync(marker, "utf8");
  controller.abort();
  await assert.rejects(request, error => error?.name === "AbortError");
  await waitForMissing(workDir);
  assert.equal(fs.existsSync(workDir), false);
});
