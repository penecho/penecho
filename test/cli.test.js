"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");

const {
  apiConfigurationIssues,
  cliCandidates,
  codexBundledModels,
  configuredTimeoutSeconds,
  helpText,
  main,
  parseArgs,
  resolveConfiguration,
  resolveCliPreflight,
  runClaudePreflight,
  runCodexPreflight,
  runKimiPreflight,
  runDoctor,
  saveConfiguration,
  testApiConnection,
  testConfiguredProvider,
} = require("../cli.js");

const ROOT = path.resolve(__dirname, "..");

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cli-test-"));
  test.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  return directory;
}

function capture() {
  let value = "";
  return {
    stream:new Writable({ write(chunk, _encoding, callback) { value += chunk.toString("utf8"); callback(); } }),
    text:() => value,
  };
}

function isolatedConfiguration(args = parseArgs([]), overrides = {}) {
  const directory = temporaryDirectory(), home = path.join(directory, "home"), cwd = path.join(directory, "cwd"), packageRoot = path.join(directory, "package");
  for (const item of [home, cwd, packageRoot]) fs.mkdirSync(item, { recursive:true });
  return resolveConfiguration(args, { env:overrides, home, cwd, packageRoot });
}

function scriptedUi(script = {}) {
  const selections = [...(script.selections || [])], inputs = [...(script.inputs || [])],
    passwords = [...(script.passwords || [])], confirms = [...(script.confirms || [])], notes = [];
  return {
    interactive:true,
    select:async () => {
      assert.ok(selections.length, "unexpected select prompt");
      return selections.shift();
    },
    input:async (_message, fallback = "") => inputs.length ? inputs.shift() : fallback,
    password:async () => passwords.length ? passwords.shift() : "",
    confirm:async (_message, fallback = false) => confirms.length ? confirms.shift() : fallback,
    header() {},
    note:(title, message, kind) => notes.push({ title, message, kind }),
    pause:async () => {},
    notes,
  };
}

function expectedArgs(overrides = {}) {
  return { command:"start", provider:null, port:null, model:null, effort:null, config:null, uat:false, help:false, version:false, ...overrides };
}

test("parses commands, provider overrides, and explicit config files", () => {
  assert.deepEqual(parseArgs(["--api", "--port", "4000"]), expectedArgs({ provider:"api", port:4000 }));
  assert.deepEqual(parseArgs(["doctor", "--codex", "--port=0"]), expectedArgs({ command:"doctor", provider:"codex-cli", port:0 }));
  assert.deepEqual(parseArgs(["doctor", "--kimi"]), expectedArgs({ command:"doctor", provider:"kimi-cli" }));
  assert.deepEqual(parseArgs(["configure"]), expectedArgs({ command:"configure" }));
  assert.deepEqual(parseArgs(["configure", "--claude", "--config", "team.env"]), expectedArgs({ command:"configure", provider:"claude-cli", config:"team.env" }));
  assert.deepEqual(parseArgs(["--codex", "--model", "gpt-5.6-sol", "--effort=xhigh", "--config=custom.env"]), expectedArgs({ provider:"codex-cli", model:"gpt-5.6-sol", effort:"xhigh", config:"custom.env" }));
  assert.deepEqual(parseArgs(["--uat"]), expectedArgs({ uat:true }));
  assert.throws(() => parseArgs(["--api", "--codex"]), /cannot be used together/);
  assert.throws(() => parseArgs(["--port", "65536"]), /0 to 65535/);
  assert.throws(() => parseArgs(["--config"]), /requires a file path/);
  assert.throws(() => parseArgs(["doctor", "configure"]), /Only one command/);
  assert.throws(() => parseArgs(["doctor", "--uat"]), /only supported when starting/);
});

test("hidden UAT mode forces the public UAT origin and isolates Cloud credentials", () => {
  const directory = temporaryDirectory(), home = path.join(directory, "home"), cwd = path.join(directory, "cwd"), stateDir = path.join(home, ".penecho");
  fs.mkdirSync(stateDir, { recursive:true }); fs.mkdirSync(cwd, { recursive:true });
  fs.writeFileSync(path.join(stateDir, "config.env"), "AI_PROVIDER=codex-cli\nCODEX_CLI_MODEL=gpt-5.6-sol\nPENECHO_CLOUD_ORIGIN=https://penecho.ai\n");
  const configuration = resolveConfiguration(parseArgs(["--uat"]), { env:{ PENECHO_CLOUD_ENV:"prod" }, home, cwd, packageRoot:ROOT });
  assert.equal(configuration.env.PENECHO_CLOUD_ENV, "uat");
  assert.equal(configuration.env.PENECHO_CLOUD_ORIGIN, "https://internaltest.penecho.ai");
  assert.equal(configuration.env.PENECHO_CLOUD_STATE_DIR, path.join(stateDir, "cloud-uat"));
  assert.equal(configuration.env.CODEX_CLI_MODEL, "gpt-5.6-sol");
  assert.doesNotMatch(helpText(), /--uat/);
});

test("default startup reads only the global config and ignores project env files", () => {
  const directory = temporaryDirectory(), home = path.join(directory, "home"), cwd = path.join(directory, "cwd"), packageRoot = path.join(directory, "package"), stateDir = path.join(home, ".penecho");
  for (const item of [stateDir, cwd, packageRoot]) fs.mkdirSync(item, { recursive:true });
  fs.writeFileSync(path.join(packageRoot, ".env"), "AI_PROVIDER=api\nAI_API_MODEL=package\n");
  fs.writeFileSync(path.join(cwd, ".env"), "AI_PROVIDER=api\nAI_API_MODEL=cwd\n");
  fs.writeFileSync(path.join(stateDir, "config.env"), "AI_PROVIDER=codex-cli\nCODEX_CLI_MODEL=global-model\nPORT=4000\n");
  const configuration = resolveConfiguration(parseArgs([]), { env:{}, home, cwd, packageRoot });
  assert.equal(configuration.provider, "codex-cli");
  assert.equal(configuration.env.CODEX_CLI_MODEL, "global-model");
  assert.equal(configuration.env.AI_API_MODEL, undefined);
  assert.equal(configuration.port, 4000);
  assert.equal(configuration.configExists, true);
});

test("--config replaces the global config source", () => {
  const directory = temporaryDirectory(), home = path.join(directory, "home"), cwd = path.join(directory, "cwd"), stateDir = path.join(home, ".penecho");
  fs.mkdirSync(stateDir, { recursive:true }); fs.mkdirSync(cwd, { recursive:true });
  fs.writeFileSync(path.join(stateDir, "config.env"), "AI_PROVIDER=codex-cli\nCODEX_CLI_MODEL=global-model\n");
  fs.writeFileSync(path.join(cwd, "team.env"), "AI_PROVIDER=claude-cli\nCLAUDE_CLI_MODEL=team-model\n");
  const configuration = resolveConfiguration(parseArgs(["--config", "team.env"]), { env:{}, home, cwd, packageRoot:ROOT });
  assert.equal(configuration.provider, "claude-cli");
  assert.equal(configuration.env.CLAUDE_CLI_MODEL, "team-model");
  assert.equal(configuration.env.CODEX_CLI_MODEL, undefined);
  assert.equal(configuration.configFile, path.join(cwd, "team.env"));
  assert.equal(configuration.configExplicit, true);
});

test("CLI model and effort override saved configuration", () => {
  const codex = isolatedConfiguration(parseArgs(["--codex", "--model", "gpt-5.6-sol", "--effort", "xhigh"]), {
    AI_PROVIDER:"api", CODEX_CLI_MODEL:"old", AI_EFFORT:"high",
  });
  assert.equal(codex.provider, "codex-cli");
  assert.equal(codex.env.CODEX_CLI_MODEL, "gpt-5.6-sol");
  assert.equal(codex.env.AI_EFFORT, "xhigh");
  assert.throws(() => isolatedConfiguration(parseArgs(["--api", "--effort", "low"]), { AI_PROVIDER:"api" }), /only supported with Kimi, Codex, or Claude/);
});

test("canonical save creates global defaults and removes legacy names", () => {
  const configuration = isolatedConfiguration(parseArgs([]), { PORT:"4000" });
  fs.mkdirSync(path.dirname(configuration.configFile), { recursive:true });
  fs.writeFileSync(configuration.configFile, "OPENAI_API_KEY=old\nOPENAI_API_URL=https://old.test/v1\nOPENAI_MODEL=old-model\nCODEX_CLI_TIMEOUT_SECONDS=180\nCUSTOM_SETTING=keep\n");
  saveConfiguration(configuration, { AI_PROVIDER:"api", AI_API_FORMAT:"openai", AI_API_URL:"https://example.test/v1", AI_API_MODEL:"gpt-test", AI_API_KEY:"new", AI_EFFORT:"xhigh" });
  const saved = fs.readFileSync(configuration.configFile, "utf8");
  assert.match(saved, /^AI_TIMEOUT_SECONDS=180$/m);
  assert.match(saved, /^PENECHO_AI_IMAGE_FORMAT=webp$/m);
  assert.match(saved, /^AI_API_URL=https:\/\/example\.test\/v1$/m);
  assert.match(saved, /^PENECHO_REQUEST_TRACE=false$/m);
  assert.match(saved, /^AUTO_AI_DELAY_SECONDS=5$/m);
  assert.match(saved, /^CUSTOM_SETTING=keep$/m);
  assert.doesNotMatch(saved, /OPENAI_|CODEX_CLI_TIMEOUT_SECONDS/);
  assert.equal(configuration.provider, "api");
});

test("unified timeout accepts 10 to 600 seconds and defaults to 180", () => {
  assert.equal(configuredTimeoutSeconds({}), 180);
  assert.equal(configuredTimeoutSeconds({ AI_TIMEOUT_SECONDS:"180" }), 180);
  assert.equal(configuredTimeoutSeconds({ CODEX_CLI_TIMEOUT_SECONDS:"240" }), 240);
  assert.throws(() => configuredTimeoutSeconds({ AI_TIMEOUT_SECONDS:"601" }), /10 to 600/);
});

test("first noninteractive startup points to the full configure command", async () => {
  const errors = capture(); let started = false;
  const code = await main([], {
    env:{}, home:temporaryDirectory(), cwd:temporaryDirectory(), packageRoot:ROOT,
    output:capture().stream, errorOutput:errors.stream,
    startServer:async () => { started = true; },
  });
  assert.equal(code, 1);
  assert.equal(started, false);
  assert.match(errors.text(), /penecho configure/);
});

test("first interactive startup opens the configuration center automatically", async () => {
  const output = capture(), errors = capture(), ui = scriptedUi({ selections:["exit"] });
  const code = await main([], {
    env:{}, home:temporaryDirectory(), cwd:temporaryDirectory(), packageRoot:ROOT,
    ui, output:output.stream, errorOutput:errors.stream,
  });
  assert.equal(code, 1);
  assert.match(output.text(), /Opening the configuration center/);
  assert.match(errors.text(), /no LLM source/);
});

test("normal startup serves first, then checks, installs, stops, and waits for a manual start", async () => {
  const directory = temporaryDirectory(), output = capture(), errors = capture(), events = [], argv = ["--port", "4111"];
  const server = {
    listening:true,
    close(callback) { events.push("stop"); this.listening = false; callback(); },
    closeIdleConnections() {},
  };
  const code = await main(argv, {
    env:{ AI_PROVIDER:"api", AI_API_FORMAT:"openai", AI_API_URL:"https://example.test/v1", AI_API_MODEL:"test-model", AI_API_KEY:"test-key" },
    home:directory, cwd:directory, packageRoot:directory, ui:scriptedUi(), output:output.stream, errorOutput:errors.stream,
    forceUpdateCheck:true, awaitUpdateCheck:true,
    startServer:async () => { events.push("server"); return server; },
    updateChecker:async () => { events.push("check"); return "99.0.0"; },
    updateInstaller:async version => { events.push(`install:${version}`); return true; },
  });
  assert.equal(code, 0);
  assert.deepEqual(events, ["server", "check", "install:99.0.0", "stop"]);
  assert.match(output.text(), /PenEcho v\d+\.\d+\.\d+/);
  assert.match(output.text(), /newer PenEcho version/);
  assert.match(output.text(), /Run `penecho` again/);
  assert.equal(errors.text(), "");
});

test("API configure saves before testing, keeps an existing key, and returns success after a failed test", async () => {
  const directory = temporaryDirectory(), home = path.join(directory, "home"), cwd = path.join(directory, "cwd");
  fs.mkdirSync(path.join(home, ".penecho"), { recursive:true }); fs.mkdirSync(cwd, { recursive:true });
  fs.writeFileSync(path.join(home, ".penecho", "config.env"), "AI_PROVIDER=api\nAI_API_FORMAT=openai\nAI_API_URL=https://old.test/v1\nAI_API_MODEL=old-model\nAI_API_KEY=existing-key\nAI_EFFORT=high\n");
  const ui = scriptedUi({
    selections:["openai", "xhigh", "save"],
    inputs:["https://new.test/v1", "gpt-5.6-sol"],
    passwords:[""],
  });
  const code = await main(["configure", "--api"], {
    env:{}, home, cwd, packageRoot:ROOT, ui, output:capture().stream, errorOutput:capture().stream,
    apiTester:async () => { throw new Error("endpoint unavailable"); },
  });
  const saved = fs.readFileSync(path.join(home, ".penecho", "config.env"), "utf8");
  assert.equal(code, 0);
  assert.match(saved, /^AI_API_URL=https:\/\/new\.test\/v1$/m);
  assert.match(saved, /^AI_API_MODEL=gpt-5\.6-sol$/m);
  assert.match(saved, /^AI_API_KEY=existing-key$/m);
  assert.match(saved, /^AI_EFFORT=xhigh$/m);
  assert.ok(ui.notes.some(note => note.kind === "error" && /still saved/.test(note.title)));
});

test("Anthropic API configure saves none as an explicit thinking-disabled effort", async () => {
  const directory = temporaryDirectory(), home = path.join(directory, "home"), cwd = path.join(directory, "cwd");
  fs.mkdirSync(home, { recursive:true }); fs.mkdirSync(cwd, { recursive:true });
  const ui = scriptedUi({
    selections:["anthropic", "none", "save"],
    inputs:["https://anthropic.test", "claude-opus-4-8"],
    passwords:["test-key"],
  });
  const code = await main(["configure", "--api"], {
    env:{}, home, cwd, packageRoot:ROOT, ui, output:capture().stream, errorOutput:capture().stream,
    apiTester:async () => ({ format:"anthropic", status:200 }),
  });
  const saved = fs.readFileSync(path.join(home, ".penecho", "config.env"), "utf8");
  assert.equal(code, 0);
  assert.match(saved, /^AI_API_FORMAT=anthropic$/m);
  assert.match(saved, /^AI_EFFORT=none$/m);
});

test("Kimi, Codex, and Claude are supported by configure and save their model choices", async () => {
  for (const scenario of [
    { flag:"--kimi", selections:["__manual__", "high", "save"], inputs:["kimi-code/kimi-for-coding"], field:"KIMI_CLI_MODEL", model:"kimi-code/kimi-for-coding" },
    { flag:"--codex", selections:["gpt-5.6-sol", "xhigh", "save"], field:"CODEX_CLI_MODEL", model:"gpt-5.6-sol", caller:"codexCaller" },
    { flag:"--claude", selections:["opus", "max", "save"], field:"CLAUDE_CLI_MODEL", model:"opus", caller:"claudeCaller" },
  ]) {
    const directory = temporaryDirectory(), home = path.join(directory, "home"), cwd = path.join(directory, "cwd");
    fs.mkdirSync(home, { recursive:true }); fs.mkdirSync(cwd, { recursive:true });
    const ui = scriptedUi({ selections:scenario.selections, inputs:scenario.inputs || [] });
    const options = {
      env:{ PATH:process.env.PATH, KIMI_CLI_PATH:process.execPath, CODEX_CLI_PATH:process.execPath, CLAUDE_CLI_PATH:process.execPath }, home, cwd, packageRoot:ROOT, ui, output:capture().stream, errorOutput:capture().stream,
      runner:async (_launch, args) => ({ code:0, stdout:args[0] === "--version" ? "test cli\n" : args[0] === "debug" ? JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }) : "logged in\n", stderr:"" }),
      kimiCaller:async () => "OK",
      codexCaller:async () => "OK",
      claudeCaller:async () => "OK",
    };
    const code = await main(["configure", scenario.flag], options), saved = fs.readFileSync(path.join(home, ".penecho", "config.env"), "utf8");
    assert.equal(code, 0);
    assert.match(saved, new RegExp(`^${scenario.field}=${scenario.model.replaceAll(".", "\\.")}$`, "m"));
  }
});

test("API validation and connection requests use the selected wire format", async () => {
  assert.deepEqual(apiConfigurationIssues({ AI_API_KEY:"key", AI_API_URL:"https://example.test/v1", AI_API_MODEL:"model", AI_API_FORMAT:"openai" }), []);
  assert.deepEqual(apiConfigurationIssues({ AI_API_KEY:"key", AI_API_URL:"https://example.test/v1", AI_API_MODEL:"model", PENECHO_AI_IMAGE_FORMAT:"jpeg" }), ["PENECHO_AI_IMAGE_FORMAT"]);
  const calls = [], fetchImpl = async (url, options) => { calls.push({ url, options }); return { ok:true, status:200, text:async () => "{}" }; };
  await testApiConnection({ AI_API_FORMAT:"openai", AI_API_URL:"https://openai.test/v1", AI_API_MODEL:"gpt", AI_API_KEY:"key", AI_EFFORT:"xhigh" }, { fetchImpl, timeoutMs:1000 });
  await testApiConnection({ AI_API_FORMAT:"anthropic", AI_API_URL:"https://anthropic.test", AI_API_MODEL:"claude", AI_API_KEY:"key", AI_EFFORT:"max" }, { fetchImpl, timeoutMs:1000 });
  await testApiConnection({ AI_API_FORMAT:"anthropic", AI_API_URL:"https://anthropic.test", AI_API_MODEL:"claude", AI_API_KEY:"key", AI_EFFORT:"none" }, { fetchImpl, timeoutMs:1000 });
  await testApiConnection({ AI_API_FORMAT:"openai", AI_API_URL:"https://openai.test/v1", AI_API_MODEL:"gpt-5.6-sol", AI_API_KEY:"key", AI_EFFORT:"max" }, { fetchImpl, timeoutMs:1000 });
  const openAiBody=JSON.parse(calls[0].options.body),anthropicBody=JSON.parse(calls[1].options.body),disabledAnthropicBody=JSON.parse(calls[2].options.body),gpt56Body=JSON.parse(calls[3].options.body);
  assert.equal(calls[0].url, "https://openai.test/v1/chat/completions");
  assert.equal(openAiBody.stream,true);
  assert.equal(Object.hasOwn(openAiBody,"max_tokens"),false);
  assert.equal(openAiBody.reasoning_effort, "xhigh");
  assert.match(openAiBody.messages[0].content.find(part => part.type === "image_url").image_url.url, /^data:image\/webp;base64,/);
  assert.equal(Object.hasOwn(openAiBody,"temperature"),false);
  assert.equal(calls[1].url, "https://anthropic.test/v1/messages");
  assert.equal(anthropicBody.stream,true);
  assert.equal(anthropicBody.max_tokens,20000);
  assert.equal(anthropicBody.output_config.effort, "max");
  assert.equal(anthropicBody.messages[0].content.find(part => part.type === "image").source.media_type, "image/webp");
  assert.equal(Object.hasOwn(anthropicBody,"temperature"),false);
  assert.deepEqual(disabledAnthropicBody.thinking, { type:"disabled" });
  assert.equal(disabledAnthropicBody.max_tokens,20000);
  assert.equal(disabledAnthropicBody.output_config, undefined);
  assert.equal(Object.hasOwn(disabledAnthropicBody,"temperature"),false);
  assert.equal(gpt56Body.reasoning_effort, "max");
  assert.equal(Object.hasOwn(gpt56Body,"max_tokens"),false);

  const kimiCalls = [], kimiFetch = async (url, options) => {
    kimiCalls.push({ url, options });
    return { ok:true, status:200, text:async () => "{}" };
  };
  await testApiConnection({ AI_API_FORMAT:"openai", AI_API_URL:"https://api.kimi.com/coding/v1", AI_API_MODEL:"k3", AI_API_KEY:"key", AI_EFFORT:"high" }, { fetchImpl:kimiFetch, timeoutMs:1000 });
  assert.equal(JSON.parse(kimiCalls[0].options.body).stream,true);
  assert.equal(JSON.parse(kimiCalls[0].options.body).reasoning_effort,"high");
  assert.equal(Object.hasOwn(JSON.parse(kimiCalls[0].options.body),"max_tokens"),false);
  assert.equal(Object.hasOwn(JSON.parse(kimiCalls[0].options.body),"temperature"),false);

  const minimaxCalls = [], minimaxFetch = async (url, options) => {
    minimaxCalls.push({ url, options });
    return { ok:true, status:200, text:async () => "{}" };
  };
  await testApiConnection({ AI_API_FORMAT:"openai", AI_API_URL:"https://api.minimax.io/v1", AI_API_MODEL:"MiniMax-M3", AI_API_KEY:"key", AI_EFFORT:"medium", PENECHO_API_PRESET:"minimax-global-api" }, { fetchImpl:minimaxFetch, timeoutMs:1000 });
  const minimaxBody = JSON.parse(minimaxCalls[0].options.body);
  assert.equal(minimaxBody.stream,true);
  assert.equal(minimaxBody.reasoning_effort,"medium");
  assert.equal(Object.hasOwn(minimaxBody,"max_tokens"),false);
  assert.equal(Object.hasOwn(minimaxBody,"thinking"),false);
});

test("API connection success labels distinguish presets from wire formats", async () => {
  const tested = async () => ({ format:"openai", status:200 });
  const kimi = isolatedConfiguration(parseArgs(["--api"]), {
    AI_PROVIDER:"api", AI_API_FORMAT:"openai", AI_API_URL:"https://api.kimi.com/coding/v1", AI_API_MODEL:"k3", AI_API_KEY:"key", PENECHO_API_PRESET:"kimi-global-coding",
  });
  const custom = isolatedConfiguration(parseArgs(["--api"]), {
    AI_PROVIDER:"api", AI_API_FORMAT:"openai", AI_API_URL:"https://example.test/v1", AI_API_MODEL:"model", AI_API_KEY:"key",
  });
  assert.equal(await testConfiguredProvider(kimi, { apiTester:tested }), "Kimi API responded with HTTP 200.");
  assert.equal(await testConfiguredProvider(custom, { apiTester:tested }), "OpenAI-compatible API responded with HTTP 200.");
});

test("API failure diagnostics redact the key", async () => {
  const key = "sk-never-print";
  await assert.rejects(
    testApiConnection({ AI_API_FORMAT:"openai", AI_API_URL:"https://openai.test/v1", AI_API_MODEL:"gpt", AI_API_KEY:key }, {
      fetchImpl:async () => ({ ok:false, status:401, text:async () => `invalid ${key}` }), timeoutMs:1000,
    }),
    error => error.message.includes("HTTP 401") && !error.message.includes(key) && error.message.includes("[redacted]"),
  );
});

test("API connection timeout covers an SSE body that never completes", async () => {
  await assert.rejects(
    testApiConnection({ AI_API_FORMAT:"openai", AI_API_URL:"https://openai.test/v1", AI_API_MODEL:"gpt", AI_API_KEY:"key" }, {
      timeoutMs:25,
      fetchImpl:async (_url, options) => new Response(new ReadableStream({
        start(controller) {
          options.signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once:true });
        },
      }), { headers:{ "Content-Type":"text/event-stream" } }),
    }),
    /API connection test timed out/,
  );
});

test("configured Codex check reads the bundled catalog and sends one small image request", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
    AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"gpt-5.6-sol", AI_EFFORT:"xhigh", AI_TIMEOUT_SECONDS:"120", PENECHO_AI_IMAGE_FORMAT:"webp", CODEX_CLI_PATH:process.execPath, PATH:process.env.PATH,
  });
  const calls = [];
  let modelRequest;
  const result = await testConfiguredProvider(configuration, {
    runner:async (_launch, args) => {
      calls.push(args);
      return { code:0, stdout:args[0] === "--version" ? "codex test\n" : args[0] === "debug" ? JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }) : "logged in\n", stderr:"" };
    },
    codexCaller:async input => { modelRequest=input; return "OK"; },
  });
  assert.deepEqual(calls, [["--version"], ["login", "status"], ["debug", "models", "--bundled"]]);
  assert.match(result, /image input.*responded successfully/);
  assert.match(modelRequest.atlasImage, /^data:image\/webp;base64,/);
  assert.equal(modelRequest.model, "gpt-5.6-sol");
});

test("configured Codex check reports an unknown saved model immediately", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
    AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"missing-model", CODEX_CLI_PATH:process.execPath, PATH:process.env.PATH,
  });
  await assert.rejects(testConfiguredProvider(configuration, {
    runner:async (_launch, args) => ({ code:0, stdout:args[0] === "--version" ? "codex test\n" : args[0] === "debug" ? JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }) : "logged in\n", stderr:"" }),
  }), /not present.*bundled model catalog/);
});

test("configured CLI connection tests abort the model request at an explicit caller timeout", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
    AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"gpt-5.6-sol", CODEX_CLI_PATH:process.execPath, PATH:process.env.PATH,
  });
  await assert.rejects(testConfiguredProvider(configuration, {
    timeoutMs:25,
    runner:async (_launch, args) => ({ code:0, stdout:args[0] === "--version" ? "codex test\n" : args[0] === "debug" ? JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }) : "logged in\n", stderr:"" }),
    codexCaller:input => new Promise((resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once:true });
    }),
  }), error => error.code === "PENECHO_CONNECTION_TEST_TIMEOUT" && /timed out/.test(error.message));
});

test("Codex bundled-model query uses the offline catalog command", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), { AI_PROVIDER:"codex-cli", CODEX_CLI_PATH:process.execPath, PATH:process.env.PATH });
  let args;
  const models = await codexBundledModels(configuration, { runner:async (_launch, values) => { args=values; return { code:0, stdout:'{"models":[{"slug":"gpt-test"}]}', stderr:"" }; } });
  assert.deepEqual(args, ["debug", "models", "--bundled"]);
  assert.deepEqual(models, ["gpt-test"]);
});

test("Kimi, Codex, and Claude preflight use only their documented offline checks", async () => {
  const kimi = isolatedConfiguration(parseArgs(["--kimi"]), { AI_PROVIDER:"kimi-cli", KIMI_CLI_PATH:process.execPath, PATH:process.env.PATH }), codex = isolatedConfiguration(parseArgs(["--codex"]), { AI_PROVIDER:"codex-cli", CODEX_CLI_PATH:process.execPath, PATH:process.env.PATH }), claude = isolatedConfiguration(parseArgs(["--claude"]), { AI_PROVIDER:"claude-cli", CLAUDE_CLI_PATH:process.execPath, PATH:process.env.PATH }), calls=[];
  const runner = async (_launch, args) => { calls.push(args.join(" ")); return { code:0, stdout:args[0] === "--version" ? "test cli\n" : "logged in\n", stderr:"" }; };
  assert.equal((await runKimiPreflight(kimi, { runner })).ok, true);
  assert.equal((await runCodexPreflight(codex, { runner })).ok, true);
  assert.equal((await runClaudePreflight(claude, { runner })).ok, true);
  assert.deepEqual(calls, ["--version", "--version", "login status", "--version", "auth status"]);
});

test("Kimi startup identifies the resolved provider after the server is available", async () => {
  const directory = temporaryDirectory(), output = capture(), errorOutput = capture();
  const code = await main(["--kimi"], {
    env:{ AI_PROVIDER:"kimi-cli", KIMI_CLI_PATH:process.execPath, PATH:process.env.PATH }, home:directory, cwd:directory, packageRoot:ROOT,
    candidates:[{ executable:process.execPath, source:"configured" }], awaitCliPreflight:true,
    output:output.stream, errorOutput:errorOutput.stream,
    runner:async () => ({ code:0, stdout:"kimi-code 0.test\n", stderr:"" }),
    startServer:async () => ({ listening:true, close() {} }),
    updateScheduler:() => {},
  });
  assert.equal(code, 0, errorOutput.text());
  assert.match(output.text(), /using the configured Kimi Code CLI/);
});

test("CLI preflight failures print one upgrade command without blocking startup", async () => {
  const providers = [
    { name:"kimi", pathName:"KIMI_CLI_PATH", label:"Kimi", command:"curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash" },
    { name:"codex", pathName:"CODEX_CLI_PATH", label:"Codex", command:"curl -fsSL https://chatgpt.com/codex/install.sh | sh" },
    { name:"claude", pathName:"CLAUDE_CLI_PATH", label:"Claude", command:"curl -fsSL https://claude.ai/install.sh | bash" },
  ];
  for (const provider of providers) {
    const directory = temporaryDirectory(), output = capture(), errorOutput = capture(), starts = [];
    const cliProvider = `${provider.name}-cli`;
    const code = await main([`--${provider.name}`], {
      env:{ AI_PROVIDER:cliProvider, [provider.pathName]:process.execPath, PATH:process.env.PATH }, home:directory, cwd:directory, packageRoot:ROOT,
      platform:"darwin", candidates:[{ executable:process.execPath, source:"configured" }], awaitCliPreflight:true,
      output:output.stream, errorOutput:errorOutput.stream,
      runner:async () => ({ code:1, stdout:"", stderr:"test failure" }),
      startServer:async configuration => { starts.push(configuration.provider); return { listening:true, close() {} }; },
      updateScheduler:() => {},
    });
    assert.equal(code, 0, errorOutput.text());
    assert.deepEqual(starts, [cliProvider]);
    assert.match(errorOutput.text(), new RegExp(`PenEcho ${provider.label} check warning`));
    assert.match(errorOutput.text(), /Upgrade or repair/);
    assert.match(errorOutput.text(), new RegExp(provider.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal((errorOutput.text().match(/install\.(?:sh|ps1)/g) || []).length, 1);
    assert.match(errorOutput.text(), /PenEcho has started/);
    assert.match(errorOutput.text(), new RegExp(`penecho doctor --${provider.name}`));
  }
});

test("explicit authentication failures print login commands instead of upgrade commands", async () => {
  for (const provider of [
    { name:"codex", pathName:"CODEX_CLI_PATH", command:"codex login" },
    { name:"claude", pathName:"CLAUDE_CLI_PATH", command:"claude auth login" },
  ]) {
    const directory = temporaryDirectory(), errorOutput = capture();
    const code = await main([`--${provider.name}`], {
      env:{ AI_PROVIDER:`${provider.name}-cli`, [provider.pathName]:process.execPath, PATH:"" }, home:directory, cwd:directory, packageRoot:ROOT,
      candidates:[{ executable:process.execPath, source:"configured" }], awaitCliPreflight:true,
      output:capture().stream, errorOutput:errorOutput.stream,
      runner:async (_launch, args) => args[0] === "--version" ? { code:0, stdout:`${provider.name} test\n`, stderr:"" } : { code:1, stdout:"", stderr:"not logged in" },
      startServer:async () => ({ listening:true }), updateScheduler:() => {},
    });
    assert.equal(code, 0);
    assert.match(errorOutput.text(), new RegExp(provider.command.replaceAll(" ", "\\s")));
    assert.doesNotMatch(errorOutput.text(), /install\.(?:sh|ps1)/);
  }
});

test("CLI discovery prefers managed executables and deduplicates their system aliases", () => {
  const directory = temporaryDirectory(), home = path.join(directory, "home"), stateDir = path.join(directory, "state"), systemBin = path.join(directory, "system-bin");
  for (const provider of ["kimi", "codex", "claude"]) {
    const managed = provider === "claude" ? path.join(home, ".local", "bin", provider) : path.join(stateDir, "tools", provider, "bin", provider),
      system = path.join(systemBin, provider), aliasDirectory = path.join(directory, `${provider}-alias`), alias = path.join(aliasDirectory, provider);
    for (const file of [managed, system]) { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, "test", { mode:0o700 }); }
    fs.mkdirSync(aliasDirectory, { recursive:true });
    fs.symlinkSync(managed, alias);
    const candidates = cliCandidates(`${provider}-cli`, { env:{ PATH:[aliasDirectory, systemBin].join(path.delimiter) }, home, stateDir, platform:"linux" });
    assert.deepEqual(candidates.map(candidate => candidate.executable), [managed, system]);
    assert.deepEqual(candidates.map(candidate => candidate.source), ["managed", "system"]);
  }
});

test("Kimi, Codex, and Claude preflight fall back from managed to system executables", async () => {
  for (const provider of ["kimi", "codex", "claude"]) {
    const directory = temporaryDirectory(), managed = path.join(directory, "managed", provider), system = path.join(directory, "system", provider), envName = `${provider.toUpperCase()}_CLI_PATH`;
    for (const file of [managed, system]) { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, "test", { mode:0o700 }); }
    const configuration = isolatedConfiguration(parseArgs([`--${provider}`]), { AI_PROVIDER:`${provider}-cli`, [envName]:managed, PATH:"" }), calls = [];
    const result = await resolveCliPreflight(configuration, {
      candidates:[{ executable:managed, source:"managed" }, { executable:system, source:"system" }],
      runner:async (launch, args) => {
        calls.push([launch.command, ...args]);
        if (launch.command === managed) return { code:1, stdout:"", stderr:"managed failed" };
        return { code:0, stdout:args[0] === "--version" ? `${provider} system\n` : "logged in\n", stderr:"" };
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.executable, system);
    assert.equal(result.source, "system");
    assert.equal(result.failures.length, 1);
    assert.equal(calls[0][0], managed);
    assert.ok(calls.some(call => call[0] === system));
  }
});

test("CLI preflight begins only after the server starts and never delays main", async () => {
  const directory = temporaryDirectory(), output = capture(), errorOutput = capture(), events = [];
  let finishRunner, task;
  const code = await main(["--codex"], {
    env:{ AI_PROVIDER:"codex-cli", CODEX_CLI_PATH:process.execPath, PATH:"" }, home:directory, cwd:directory, packageRoot:ROOT,
    candidates:[{ executable:process.execPath, source:"managed" }], output:output.stream, errorOutput:errorOutput.stream,
    startServer:async () => {
      events.push("server");
      return {
        listening:true,
        setCliResolutionTask(_provider, value) { events.push("task"); task = value; },
        applyCliResolution() { events.push("apply"); },
      };
    },
    runner:async () => { events.push("preflight"); return new Promise(resolve => { finishRunner = resolve; }); },
    updateScheduler:() => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(events, ["server", "preflight", "task"]);
  assert.equal(typeof finishRunner, "function");
  finishRunner({ code:1, stdout:"", stderr:"failed" });
  await task;
  assert.match(errorOutput.text(), /PenEcho has started/);
});

test("a successful system fallback is shared with the running server", async () => {
  for (const provider of ["kimi", "codex", "claude"]) {
    const directory = temporaryDirectory(), managed = path.join(directory, "managed", provider), system = path.join(directory, "system", provider), envName = `${provider.toUpperCase()}_CLI_PATH`, applied = [];
    for (const file of [managed, system]) { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, "test", { mode:0o700 }); }
    const code = await main([`--${provider}`], {
      env:{ AI_PROVIDER:`${provider}-cli`, [envName]:managed, PATH:"" }, home:directory, cwd:directory, packageRoot:ROOT,
      candidates:[{ executable:managed, source:"managed" }, { executable:system, source:"system" }], awaitCliPreflight:true,
      output:capture().stream, errorOutput:capture().stream,
      runner:async (launch, args) => launch.command === managed ? { code:1, stdout:"", stderr:"failed" } : { code:0, stdout:args[0] === "--version" ? `${provider} system\n` : "logged in\n", stderr:"" },
      startServer:async () => ({ listening:true, applyCliResolution:(selected, executable) => applied.push([selected, executable]) }),
      updateScheduler:() => {},
    });
    assert.equal(code, 0);
    assert.deepEqual(applied, [[`${provider}-cli`, system]]);
  }
});

test("doctor is diagnostic-only and reports the unified timeout", async () => {
  const directory = temporaryDirectory(), output = capture(), configuration = resolveConfiguration(parseArgs(["doctor", "--codex"]), {
    env:{ AI_PROVIDER:"codex-cli", AI_TIMEOUT_SECONDS:"180", PORT:"3888", CODEX_CLI_PATH:process.execPath, PATH:process.env.PATH },
    home:directory, cwd:directory, packageRoot:ROOT,
  });
  const ready = await runDoctor(parseArgs(["doctor", "--codex"]), configuration, {
    output:output.stream,
    portChecker:async () => ({ ok:true }),
    runner:async (_launch, args) => ({ code:0, stdout:args[0] === "--version" ? "codex test\n" : "logged in\n", stderr:"" }),
  });
  assert.equal(ready, true);
  assert.match(output.text(), /Node\.js .*22\.19\+ required/);
  assert.match(output.text(), /Unified model timeout is 180 seconds/);
  assert.match(output.text(), /Reasoning effort is medium \(PenEcho default\)/);
  assert.match(output.text(), /no model request was made/);
});

test("Claude doctor does not claim an untested session is ready", async () => {
  const directory = temporaryDirectory(), output = capture(), configuration = resolveConfiguration(parseArgs(["doctor", "--claude"]), {
    env:{ AI_PROVIDER:"claude-cli", AI_TIMEOUT_SECONDS:"180", PORT:"3888", CLAUDE_CLI_PATH:process.execPath, PATH:process.env.PATH },
    home:directory, cwd:directory, packageRoot:ROOT,
  });
  const ready = await runDoctor(parseArgs(["doctor", "--claude"]), configuration, {
    output:output.stream,
    portChecker:async () => ({ ok:true }),
    runner:async (_launch, args) => ({ code:0, stdout:args[0] === "--version" ? "claude test\n" : "logged in\n", stderr:"" }),
  });
  assert.equal(ready, true);
  assert.match(output.text(), /Claude CLI reports an authenticated session/);
  assert.match(output.text(), /no model request was made/);
  assert.match(output.text(), /claude auth login/);
  assert.doesNotMatch(output.text(), /login is ready/);
});

test("help documents configure, global config, explicit config, and transient overrides", () => {
  const help = helpText();
  assert.match(help, /penecho configure/);
  assert.match(help, /~\/.penecho\/config\.env/);
  assert.match(help, /--config/);
  assert.match(help, /--model/);
  assert.match(help, /--effort/);
  assert.match(help, /--kimi/);
  assert.match(help, /MoonshotAI\/kimi-code/);
});
