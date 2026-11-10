"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildCodexArgs, callCodexCli, prepareIsolatedRuntime, sanitizeCodexEnv } = require("../src/providers/codex-cli.js");
const { cliCandidates } = require("../src/providers/cli-discovery.js");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const WEBP = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==";

function testCodexEnv(directory, overrides = {}) {
  const codexHome = path.join(directory, "source-codex-home");
  fs.mkdirSync(codexHome, { recursive:true });
  fs.writeFileSync(path.join(codexHome, "auth.json"), '{"auth_mode":"test"}');
  return { ...process.env, CODEX_HOME:codexHome, ...overrides };
}

test("Windows npm PenEcho discovers the desktop-managed Codex before a stale saved npm wrapper", () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-windows-codex-discovery-")),home=path.join(directory,"home"),appData=path.join(home,"AppData","Roaming"),stateDir=path.join(home,".penecho"),
    privateManaged=path.join(stateDir,"tools","codex","bin","codex.exe"),desktopManaged=path.join(appData,"PenEcho","tools","codex","bin","codex.exe"),configured=path.join(appData,"npm","codex.cmd");
  try {
    for(const file of [privateManaged,desktopManaged,configured]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,"test");}
    const candidates=cliCandidates("codex-cli",{platform:"win32",home,stateDir,env:{APPDATA:appData,PATH:"",PATHEXT:".COM;.EXE;.BAT;.CMD"},configuredPath:configured});
    assert.deepEqual(candidates.map(candidate=>candidate.executable),[privateManaged,desktopManaged,configured]);
    assert.deepEqual(candidates.map(candidate=>candidate.source),["managed","managed","configured"]);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test("builds a non-interactive read-only Codex invocation", () => {
  const args = buildCodexArgs({ workDir: "work", imageFile: "image.png", outputFile: "answer.txt", model: "test-model", effort:"max" });
  assert.deepEqual(args.slice(0, 8), ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--strict-config"]);
  assert.equal(args.at(-1), "-");
  assert.deepEqual(args.slice(args.indexOf("--disable"), args.indexOf("--disable") + 2), ["--disable", "apps"]);
  assert.ok(args.includes("shell_tool"));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes("mcp_servers={}"));
  assert.ok(args.includes("skills.include_instructions=false"));
  assert.ok(args.includes("skills.bundled.enabled=false"));
  assert.ok(args.includes("project_doc_max_bytes=0"));
  assert.ok(args.includes("image.png"));
  assert.ok(args.includes("answer.txt"));
  assert.ok(args.includes("test-model"));
  assert.ok(args.includes('model_reasoning_effort="max"'));
  assert.equal(args.some(value => /temperature/i.test(String(value))), false);
  assert.ok(args.includes("--json"));
  assert.equal(args.includes("--oss"), false);
  assert.equal(args.includes("--local-provider"), false);
});

test("leaves Codex reasoning effort unset when the global value is empty", () => {
  const args = buildCodexArgs({ workDir:"work", imageFile:"image.png", outputFile:"answer.txt", model:null, effort:null });
  assert.equal(args.some(value => String(value).startsWith("model_reasoning_effort=")), false);
});

test("passes the configured Codex effort through without model-family mapping", () => {
  assert.ok(buildCodexArgs({ workDir:"work", imageFile:null, outputFile:"answer.txt", model:"gpt-5.5", effort:"max" }).includes('model_reasoning_effort="max"'));
  assert.ok(buildCodexArgs({ workDir:"work", imageFile:null, outputFile:"answer.txt", model:"gpt-5.6-sol", effort:"max" }).includes('model_reasoning_effort="max"'));
  assert.ok(buildCodexArgs({ workDir:"work", imageFile:null, outputFile:"answer.txt", model:"gpt-5.6-sol", effort:"Provider_Native" }).includes('model_reasoning_effort="Provider_Native"'));
});

test("omits the Codex image argument for a text-only request", () => {
  const args = buildCodexArgs({ workDir:"work", imageFile:null, outputFile:"answer.txt", model:null, effort:null });
  assert.equal(args.includes("-i"), false);
  assert.ok(args.includes("answer.txt"));
});

test("attaches up to five Codex vision files in message order", () => {
  const args=buildCodexArgs({workDir:"work",imageFiles:["one.png","two.webp"],outputFile:"answer.txt",model:null,effort:null});
  assert.deepEqual(args.flatMap((value,index)=>value==="-i"?[args[index+1]]:[]),["one.png","two.webp"]);
});

test("passes only the required environment to the Codex process", () => {
  const env = sanitizeCodexEnv({ PATH: "bin", OPENAI_API_KEY: "secret", OPENAI_API_URL: "https://example.test", OPENAI_MODEL: "remote", HTTPS_PROXY: "http://user:secret@proxy.test", LOCAL_MODEL_URL: "https://remote-model.test", UNRELATED_SECRET: "private", CODEX_HOME: "host-codex", HOME: "host-home", USERPROFILE: "host-profile" });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.OPENAI_API_URL, undefined);
  assert.equal(env.OPENAI_MODEL, undefined);
  assert.equal(env.UNRELATED_SECRET, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.LOCAL_MODEL_URL, undefined);
  assert.equal(env.PATH, "bin");
  assert.equal(env.CODEX_HOME, undefined);
  assert.equal(env.HOME, undefined);
  assert.equal(env.USERPROFILE, undefined);
});

test("creates an isolated Codex home and copies only Codex authentication", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penecho-codex-home-test-"));
  const sourceHome = path.join(directory, "source"), workDir = path.join(directory, "work");
  await fs.promises.mkdir(sourceHome, { recursive: true });
  await fs.promises.mkdir(workDir, { recursive: true });
  await fs.promises.writeFile(path.join(sourceHome, "auth.json"), '{"auth_mode":"test"}');
  await fs.promises.writeFile(path.join(sourceHome, "config.toml"), '[mcp_servers.host]\ncommand="bad"\n');
  await fs.promises.mkdir(path.join(sourceHome, "skills"));
  try {
    const env = await prepareIsolatedRuntime(workDir, { ...process.env, CODEX_HOME: sourceHome });
    assert.notEqual(env.CODEX_HOME, sourceHome);
    assert.equal(await fs.promises.readFile(path.join(env.CODEX_HOME, "auth.json"), "utf8"), '{"auth_mode":"test"}');
    assert.equal(fs.existsSync(path.join(env.CODEX_HOME, "config.toml")), false);
    assert.equal(fs.existsSync(path.join(env.CODEX_HOME, "skills")), false);
    assert.equal(env.HOME, env.USERPROFILE);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("executes a configured Codex-compatible CLI with stdin and an attached image", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penecho-codex-test-"));
  const fakeCli = path.join(directory, "fake-codex.js");
  await fs.promises.writeFile(fakeCli, `
const fs = require("fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const output = process.argv[process.argv.indexOf("-o") + 1];
  const image = process.argv[process.argv.indexOf("-i") + 1];
  fs.writeFileSync(output, JSON.stringify({ intent: "answer", observedText: fs.existsSync(image) ? "image" : "missing", message: process.env.OPENAI_API_KEY ? "leaked" : input, commands: [] }));
  process.stdout.write(JSON.stringify({ message: "stdout-must-not-be-used" }));
});
`);
  try {
    const content = await callCodexCli({ executable: fakeCli, prompt: "prompt-through-stdin", atlasImage: PNG, env: testCodexEnv(directory, { OPENAI_API_KEY: "must-not-leak" }) });
    const result = JSON.parse(content);
    assert.equal(result.observedText, "image");
    assert.equal(result.message, "prompt-through-stdin");
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("executes a text-only Codex request without creating an image file", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penecho-codex-text-test-"));
  const fakeCli = path.join(directory, "fake-codex.js");
  await fs.promises.writeFile(fakeCli, `
const fs = require("fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const output = process.argv[process.argv.indexOf("-o") + 1];
  fs.writeFileSync(output, JSON.stringify({ hasImageArgument:process.argv.includes("-i"), input }));
});
`);
  try {
    const result = JSON.parse(await callCodexCli({ executable:fakeCli, prompt:"improve this plugin", env:testCodexEnv(directory) }));
    assert.equal(result.hasImageArgument, false);
    assert.equal(result.input, "improve this plugin");
  } finally {
    await fs.promises.rm(directory, { recursive:true, force:true });
  }
});

test("writes configured WebP input with the matching extension for Codex", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penecho-codex-webp-test-"));
  const fakeCli = path.join(directory, "fake-codex.js"), record = path.join(directory, "record.json");
  await fs.promises.writeFile(fakeCli, `
const fs = require("fs");
const path = require("path");
const output = process.argv[process.argv.indexOf("-o") + 1];
const image = process.argv[process.argv.indexOf("-i") + 1];
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ extension:path.extname(image), signature:fs.readFileSync(image).toString("ascii", 0, 4) }));
fs.writeFileSync(output, '{"intent":"none","commands":[]}');
`);
  try {
    await callCodexCli({ executable:fakeCli, prompt:"webp", atlasImage:WEBP, env:testCodexEnv(directory) });
    const saved = JSON.parse(await fs.promises.readFile(record, "utf8"));
    assert.equal(saved.extension, ".webp");
    assert.equal(saved.signature, "RIFF");
  } finally {
    await fs.promises.rm(directory, { recursive:true, force:true });
  }
});

test("returns the final JSON event without waiting for the Codex process to exit", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penecho-codex-stream-test-"));
  const fakeCli = path.join(directory, "fake-codex.js"), marker = path.join(directory, "cwd.txt");
  const response = JSON.stringify({ intent:"answer", observedText:"stream", message:"immediate", commands:[] });
  await fs.promises.writeFile(fakeCli, `
const fs = require("fs");
fs.writeFileSync(${JSON.stringify(marker)}, process.cwd());
process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"test"})+"\\n");
process.stdout.write(JSON.stringify({type:"turn.started"})+"\\n");
setTimeout(() => {
  process.stdout.write(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:${JSON.stringify(response)}}})+"\\n");
  process.stdout.write(JSON.stringify({type:"turn.completed",usage:{input_tokens:140,cached_input_tokens:90,output_tokens:12}})+"\\n");
  setInterval(() => {}, 1000);
}, 150);
`);
  try {
    let reportReceiving,activityCount=0,reportedUsage=null;
    const receiving = new Promise(resolve => { reportReceiving=resolve; }), request = callCodexCli({
      executable:fakeCli,
      prompt:"stream",
      atlasImage:PNG,
      env:testCodexEnv(directory),
      onProgress:phase => { if(phase === "receiving")reportReceiving(); },
      onActivity:() => activityCount++,
      onUsage:usage => { reportedUsage=usage; },
    });
    assert.equal(await Promise.race([receiving.then(() => "receiving"), request.then(() => "resolved")]), "receiving");
    let completionTimer;
    const completionDeadline = new Promise((_, reject) => {
      completionTimer = setTimeout(() => reject(new Error("Codex waited for a completed child process to exit")), 5000);
    });
    const content = await Promise.race([request, completionDeadline]).finally(() => clearTimeout(completionTimer));
    assert.equal(JSON.parse(content).message, "immediate");
    assert.ok(activityCount>0);
    assert.deepEqual(reportedUsage,{input_tokens:140,cached_input_tokens:90,output_tokens:12});
    const workDir = await fs.promises.readFile(marker, "utf8"), deadline=Date.now()+5000;
    while(fs.existsSync(workDir)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(fs.existsSync(workDir), false);
  } finally {
    await fs.promises.rm(directory, { recursive:true, force:true });
  }
});

test("aborts immediately, preserves CLI diagnostics, and cleans up in the background", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penecho-codex-abort-test-"));
  const fakeCli = path.join(directory, "fake-codex.js"), marker = path.join(directory, "cwd.txt");
  await fs.promises.writeFile(fakeCli, `
const fs = require("fs");
fs.writeFileSync(process.argv[process.argv.indexOf("-o") + 1], "partial-final-message");
process.stderr.write("waiting for child process to exit");
fs.writeFileSync(${JSON.stringify(marker)}, process.cwd());
setInterval(() => {}, 1000);
`);
  const controller = new AbortController(), request = callCodexCli({ executable: fakeCli, prompt: "wait", atlasImage: PNG, signal: controller.signal, env:testCodexEnv(directory) });
  try {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(marker) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(fs.existsSync(marker));
    const workDir = await fs.promises.readFile(marker, "utf8");
    await new Promise(resolve => setTimeout(resolve, 50));
    const started=Date.now();controller.abort();
    let failure;
    try { await request; } catch(error) { failure=error; }
    assert.equal(failure?.name, "AbortError");
    assert.ok(Date.now()-started < 1000);
    assert.match(failure.traceDiagnostic, /waiting for child process to exit/);
    assert.match(failure.traceDiagnostic, /partial-final-message/);
    const cleanupDeadline=Date.now()+5000;
    while(fs.existsSync(workDir)&&Date.now()<cleanupDeadline)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(fs.existsSync(workDir), false);
  } finally {
    controller.abort();
    await request.catch(() => {});
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("fails the request when its temporary directory cannot be removed", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penecho-codex-cleanup-test-"));
  const fakeCli = path.join(directory, "fake-codex.js"), marker = path.join(directory, "cwd.txt");
  await fs.promises.writeFile(fakeCli, `
const fs = require("fs");
fs.writeFileSync(${JSON.stringify(marker)}, process.cwd());
fs.writeFileSync(process.argv[process.argv.indexOf("-o") + 1], '{"intent":"none","commands":[]}');
`);
  const remove = fs.promises.rm;
  fs.promises.rm = async target => {
    if (path.basename(String(target)).startsWith("penecho-codex-")) throw new Error("simulated cleanup failure");
    return remove(target, { recursive: true, force: true });
  };
  let workDir;
  try {
    await assert.rejects(callCodexCli({ executable: fakeCli, prompt: "cleanup", atlasImage: PNG, env:testCodexEnv(directory) }), /temporary directory cleanup failed/);
    workDir = await fs.promises.readFile(marker, "utf8");
    assert.equal(fs.existsSync(workDir), true);
  } finally {
    fs.promises.rm = remove;
    if (workDir) await remove(workDir, { recursive: true, force: true });
    await remove(directory, { recursive: true, force: true });
  }
});
