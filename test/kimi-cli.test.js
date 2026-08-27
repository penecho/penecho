"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  buildKimiArgs,
  callKimiCanvasAgentCli,
  callKimiCliSpawn,
  extractKimiCanvasAgentJson,
  kimiAssistantText,
  kimiEventHasToolActivity,
  kimiEventToolName,
  kimiEventUsage,
  mapKimiEffort,
  normalizeKimiTranscript,
  sanitizeKimiEnv,
} = require("../src/providers/kimi-cli.js");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-kimi-test-"));
  test.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  return directory;
}

function fakeKimi(source) {
  const file = path.join(temporaryDirectory(), "kimi.js");
  fs.writeFileSync(file, `"use strict";${source}\n`);
  return file;
}

test("Kimi arguments use the non-interactive stream-json command and isolated agent", () => {
  assert.deepEqual(buildKimiArgs({ model:"kimi-code/k3", prompt:"draw", agentFile:"/tmp/penecho-agent.md" }), [
    "--prompt", "draw", "--output-format", "stream-json", "--agent-file", "/tmp/penecho-agent.md", "--model", "kimi-code/k3",
  ]);
});

test("Kimi text transcript removes only CLI block rendering", () => {
  assert.deepEqual(buildKimiArgs({ prompt:"draw", outputFormat:"text" }).slice(0, 4), ["--prompt", "draw", "--output-format", "text"]);
  assert.equal(normalizeKimiTranscript('• {"type":"final",\n  "text":"done"}\n\n'), '{"type":"final",\n"text":"done"}');
  assert.equal(normalizeKimiTranscript("Progress: still working"), "Progress: still working");
});

test("Kimi PenEcho Agent extracts a complete Harness JSON value from surrounding text", () => {
  const decision='{"type":"tool_call","name":"canvas_capture","arguments":{"note":"literal } and \\\" quote"}}';
  assert.equal(extractKimiCanvasAgentJson(`说明文字\n\`\`\`JSON\n${decision}\n\`\`\`\n完成`),decision);
  assert.equal(extractKimiCanvasAgentJson(`progress {"percent":100}\n${decision}\ntrailing status`),decision);
  assert.equal(extractKimiCanvasAgentJson(decision),decision);
  const incomplete='progress {"type":"tool_call"';
  assert.equal(extractKimiCanvasAgentJson(incomplete),incomplete);
});

test("Kimi stream-json extracts assistant content and detects tool activity", () => {
  assert.equal(kimiAssistantText({ type:"message", role:"assistant", content:[{ type:"text", text:"answer" }] }), "answer");
  assert.equal(kimiAssistantText({ type:"message", role:"tool", content:"secret tool output" }), "");
  assert.equal(kimiEventHasToolActivity({ role:"assistant", content:"answer" }), false);
  assert.equal(kimiEventHasToolActivity({ role:"assistant", tool_calls:[{ type:"function" }] }), true);
  assert.equal(kimiEventHasToolActivity({ role:"assistant", content:[{ type:"tool_use", name:"Read" }] }), true);
  assert.equal(kimiEventToolName({ role:"assistant", tool_calls:[{ function:{ name:"Bash" } }] }), "Bash");
  assert.equal(kimiEventToolName({ role:"assistant", content:[{ type:"tool_use", name:"ReadMediaFile" }] }), "ReadMediaFile");
  assert.deepEqual(kimiEventUsage({ type:"result", usage:{ input_tokens:20, cache_read_tokens:70, output_tokens:8 } }), { input_tokens:20, cache_read_tokens:70, output_tokens:8 });
});

test("Kimi CLI receives a temporary canvas reference and returns assistant JSON", async () => {
  const executable = fakeKimi(`
const fs=require("fs"),args=process.argv.slice(2),prompt=args[args.indexOf("--prompt")+1],agentFile=args[args.indexOf("--agent-file")+1];
const images=[...prompt.matchAll(/@(canvas-[0-9]+[.](?:png|webp))/g)].map(match=>match[1]);
if(images.length!==2||images.some(image=>!fs.existsSync(image))||!agentFile||!fs.readFileSync(agentFile,"utf8").includes("tools: []")){
  process.stderr.write(JSON.stringify({images,cwd:process.cwd(),exists:images.map(image=>fs.existsSync(image)),agentFile,agentExists:Boolean(agentFile&&fs.existsSync(agentFile))}));
  process.exit(3);
}
process.stdout.write(JSON.stringify({type:"message",role:"assistant",content:[{type:"text",text:'{"intent":"none","commands":[]}'}],usage:{input_tokens:20,cache_read_tokens:70,output_tokens:8}})+"\\n");
`);
  let activityCount=0,usage=null;
  const result = await callKimiCliSpawn({ executable, model:"kimi-code/k3", prompt:"Return JSON.", atlasImage:[PNG,PNG], onActivity:()=>activityCount++, onUsage:value=>{usage=value;} });
  assert.equal(result, '{"intent":"none","commands":[]}');
  assert.ok(activityCount>0);
  assert.deepEqual(usage,{input_tokens:20,cache_read_tokens:70,output_tokens:8});
});

test("PenEcho Agent Kimi uses the disposable no-tools CLI path instead of ACP", async () => {
  const executable = fakeKimi(`
const fs=require("fs"),args=process.argv.slice(2);
if(args.includes("acp"))process.exit(8);
const prompt=args[args.indexOf("--prompt")+1]||"",agentFile=args[args.indexOf("--agent-file")+1],agent=agentFile?fs.readFileSync(agentFile,"utf8"):"";
if(args[args.indexOf("--output-format")+1]!=="text"||!prompt.includes("--- HARNESS REQUEST ---")||!agent.includes("tools: []")||!agent.includes("subagents: []"))process.exit(9);
const fence=String.fromCharCode(96).repeat(3);
process.stderr.write("private thinking delta");
process.stdout.write('• 已完成，结果如下：\\n  '+fence+'json\\n  {"type":"final",\\n');
setTimeout(()=>process.stdout.write('  "text":"isolated"}\\n  '+fence+'\\n  处理完成\\n\\n'),10);
`);
  const { callPenEchoCli } = await import("../src/server/canvas-agent/cli-adapter.mjs");
  let activityCount=0;
  const result = await callPenEchoCli({
    connection:{ provider:"kimi-cli", cliPath:executable, cliModel:"kimi-code/k3", effort:"medium" },
    systemPrompt:"PenEcho Agent system",
    prompt:'{"availableTools":[]}',
    atlasImage:null,
    onActivity:()=>activityCount++,
  });
  assert.equal(result, '{"type":"final",\n"text":"isolated"}');
  assert.ok(activityCount >= 3);
});

test("PenEcho Agent Kimi counts thinking as activity without exposing it in diagnostics", async () => {
  const executable = fakeKimi(`
process.stderr.write("PRIVATE_CHAIN_OF_THOUGHT");
setInterval(()=>{},1000);
`);
  const controller = new AbortController();
  let caught;
  try {
    await callKimiCanvasAgentCli({ executable, prompt:"test", signal:controller.signal, onActivity:()=>controller.abort() });
  } catch (error) {
    caught=error;
  }
  assert.equal(caught?.name, "AbortError");
  assert.match(caught?.traceDiagnostic || "", /thinking[.]delta/);
  assert.doesNotMatch(caught?.traceDiagnostic || "", /PRIVATE_CHAIN_OF_THOUGHT/);
});

test("Kimi child environment keeps runtime settings and drops API secrets", () => {
  const clean = sanitizeKimiEnv({
    PATH:"/bin", HOME:"/tmp/home", KIMI_CODE_HOME:"/tmp/kimi", KIMI_SHELL_PATH:"/bin/bash",
    AI_API_KEY:"must-not-leak", OPENAI_API_KEY:"must-not-leak",
  });
  assert.equal(clean.PATH, "/bin");
  assert.equal(clean.KIMI_CODE_HOME, "/tmp/kimi");
  assert.equal(clean.KIMI_CODE_EXPERIMENTAL_FLAG, "1");
  assert.equal(clean.KIMI_CODE_NO_AUTO_UPDATE, "1");
  assert.equal(clean.AI_API_KEY, undefined);
  assert.equal(clean.OPENAI_API_KEY, undefined);
});

test("Kimi effort maps PenEcho levels onto low, high, and max", () => {
  assert.equal(mapKimiEffort("none"), "low");
  assert.equal(mapKimiEffort("low"), "low");
  assert.equal(mapKimiEffort("medium"), "high");
  assert.equal(mapKimiEffort("high"), "high");
  assert.equal(mapKimiEffort("xhigh"), "max");
  assert.equal(mapKimiEffort("max"), "max");
  assert.equal(mapKimiEffort("config"), null);
});

test("Kimi CLI rejects malformed canvas images and recovers from an attempted built-in tool", async () => {
  const executable = fakeKimi(`
const fs=require("fs"),args=process.argv.slice(2),prompt=args[args.indexOf("--prompt")+1],marker=".attempted-tool";
if(!fs.existsSync(marker)){
  fs.writeFileSync(marker,"1");
  process.stdout.write(JSON.stringify({role:"assistant",content:"",tool_calls:[{type:"function",function:{name:"Bash"}}]})+"\\n");
  setInterval(()=>{},1000);
}else{
  if(!prompt.includes("ERROR: PenEcho rejected your Kimi/CLI built-in tool call (Bash)")||!prompt.includes("HARNESS REQUEST.availableTools"))process.exit(4);
  process.stdout.write(JSON.stringify({type:"message",role:"assistant",content:[{type:"text",text:'{"type":"final","text":"recovered"}'}]})+"\\n");
}
`);
  await assert.rejects(callKimiCliSpawn({ executable, prompt:"test", atlasImage:"data:image/svg+xml;base64,PHN2Zz4=" }), /invalid canvas image/);
  assert.equal(await callKimiCliSpawn({ executable, prompt:"test" }), '{"type":"final","text":"recovered"}');
});
