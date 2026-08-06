"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  buildKimiArgs,
  callKimiCliSpawn,
  kimiAssistantText,
  kimiEventHasToolActivity,
  mapKimiEffort,
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

test("Kimi stream-json extracts assistant content and detects tool activity", () => {
  assert.equal(kimiAssistantText({ type:"message", role:"assistant", content:[{ type:"text", text:"answer" }] }), "answer");
  assert.equal(kimiAssistantText({ type:"message", role:"tool", content:"secret tool output" }), "");
  assert.equal(kimiEventHasToolActivity({ role:"assistant", content:"answer" }), false);
  assert.equal(kimiEventHasToolActivity({ role:"assistant", tool_calls:[{ type:"function" }] }), true);
  assert.equal(kimiEventHasToolActivity({ role:"assistant", content:[{ type:"tool_use", name:"Read" }] }), true);
});

test("Kimi CLI receives a temporary canvas reference and returns assistant JSON", async () => {
  const executable = fakeKimi(`
const fs=require("fs"),args=process.argv.slice(2),prompt=args[args.indexOf("--prompt")+1],agentFile=args[args.indexOf("--agent-file")+1];
const image=/@(canvas\\.(?:png|webp))/.exec(prompt)?.[1];
if(!image||!fs.existsSync(image)||!agentFile||!fs.readFileSync(agentFile,"utf8").includes("tools: []"))process.exit(3);
process.stdout.write(JSON.stringify({type:"message",role:"assistant",content:[{type:"text",text:'{"intent":"none","commands":[]}'}]})+"\\n");
`);
  let activityCount=0;
  const result = await callKimiCliSpawn({ executable, model:"kimi-code/k3", prompt:"Return JSON.", atlasImage:PNG, onActivity:()=>activityCount++ });
  assert.equal(result, '{"intent":"none","commands":[]}');
  assert.ok(activityCount>0);
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

test("Kimi CLI rejects malformed canvas images and attempted tools", async () => {
  const executable = fakeKimi(`
process.stdout.write(JSON.stringify({role:"assistant",content:"",tool_calls:[{type:"function",function:{name:"Bash"}}]})+"\\n");
setInterval(()=>{},1000);
`);
  await assert.rejects(callKimiCliSpawn({ executable, prompt:"test", atlasImage:"data:image/svg+xml;base64,PHN2Zz4=" }), /invalid canvas image/);
  await assert.rejects(callKimiCliSpawn({ executable, prompt:"test" }), /attempted to use a tool while tools are disabled/);
});
