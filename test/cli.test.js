"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const {
  CODEX_CLI_PINNED_VERSION,
  codexHostName,
  installCli,
  managedCliPath,
} = require("../src/providers/cli-installer.js");

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

const { DEFAULT_MAX_TOKENS } = require("../src/server/api-config.js");
const { runConfigureMenu } = require("../src/cli/configure-ui.js");
const ROOT = path.resolve(__dirname, "..");

async function runLegacyConfigure(argv, options) {
  const args = parseArgs(argv), configuration = resolveConfiguration(args, options);
  await runConfigureMenu(configuration, {
    ui:options.ui, output:options.output, directProvider:args.provider,
    save:async updates => saveConfiguration(configuration, updates),
    test:async () => testConfiguredProvider(configuration, options),
  });
  return 0;
}

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

function fixtureExecutable(file) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, "fixture");
  return file;
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

test("migrated connections supply provider settings and an empty store ignores legacy defaults", () => {
  const home = temporaryDirectory(), stateDir = path.join(home, ".penecho");
  fs.mkdirSync(stateDir);
  fs.writeFileSync(path.join(stateDir, "config.env"), "AI_PROVIDER=api\nAI_API_KEY=legacy-key\nOPENAI_API_KEY=legacy-alias\nPORT=4555\n");
  const file = path.join(stateDir, "connections.json");
  fs.writeFileSync(file, JSON.stringify({ version:1, connections:[{ id:"saved", provider:"codex-cli", cliModel:"saved-model", effort:"high" }] }));
  const configuration = resolveConfiguration(parseArgs([]), { env:{}, home });
  assert.equal(configuration.provider, "codex-cli");
  assert.equal(configuration.env.CODEX_CLI_MODEL, "saved-model");
  assert.equal(configuration.env.AI_API_KEY, "");
  assert.equal(configuration.env.OPENAI_API_KEY, "");
  assert.equal(configuration.port, 4555);
  fs.writeFileSync(file, JSON.stringify({ version:1, connections:[] }));
  assert.equal(resolveConfiguration(parseArgs([]), { env:{}, home }).provider, null);
});

test("explicit CLI overrides are passed separately without rewriting migrated connections", () => {
  const home = temporaryDirectory(), stateDir = path.join(home, ".penecho");
  fs.mkdirSync(stateDir);
  const file = path.join(stateDir, "connections.json"), saved = JSON.stringify({ version:1, connections:[{ id:"saved", provider:"claude-cli", cliModel:"opus", effort:"high" }] });
  fs.writeFileSync(file, saved);
  const config = resolveConfiguration(parseArgs(["--codex", "--model", "custom-model", "--effort", "low"]), { env:{}, home });
  assert.deepEqual(JSON.parse(config.env.PENECHO_CONNECTION_OVERRIDE), { AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"custom-model", AI_EFFORT:"low" });
  assert.equal(config.provider, "codex-cli");
  assert.equal(fs.readFileSync(file, "utf8"), saved);
  const normal = resolveConfiguration(parseArgs([]), { env:{ PENECHO_CONNECTION_OVERRIDE:config.env.PENECHO_CONNECTION_OVERRIDE }, home });
  assert.equal(normal.provider, "claude-cli");
  assert.deepEqual(JSON.parse(normal.env.PENECHO_CONNECTION_OVERRIDE), {});
});

test("first launch sends legacy baseline separately from transient CLI flags", async () => {
  const home = temporaryDirectory(), stateDir = path.join(home, ".penecho");
  fs.mkdirSync(stateDir);
  fs.writeFileSync(path.join(stateDir, "config.env"), "AI_PROVIDER=claude-cli\nCLAUDE_CLI_MODEL=opus\nAI_EFFORT=high\n");
  let launched;
  const code = await main(["--codex", "--model", "transient", "--effort", "low", "--port", "4444"], {
    env:{}, home, output:capture().stream, errorOutput:capture().stream,
    updateScheduler:() => {}, runner:async () => ({ code:1, stdout:"", stderr:"missing" }), candidates:[], awaitCliPreflight:true,
    startServer:async config => { launched = config; },
  });
  assert.equal(code, 0);
  assert.equal(launched.env.AI_PROVIDER, "claude-cli");
  assert.equal(launched.env.CLAUDE_CLI_MODEL, "opus");
  assert.equal(launched.env.AI_EFFORT, "high");
  assert.equal(launched.env.CODEX_CLI_MODEL, "");
  assert.equal(launched.env.PORT, "4444");
  assert.deepEqual(JSON.parse(launched.env.PENECHO_CONNECTION_OVERRIDE), { AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"transient", AI_EFFORT:"low" });
  assert.equal(fs.existsSync(path.join(stateDir, "connections.json")), false);
});

test("damaged connection stores fail clearly and preserve the original file", async () => {
  for (const saved of ["{broken", '{"version":1,"connections":null}', '{"version":99,"connections":[]}']) {
    const home = temporaryDirectory(), stateDir = path.join(home, ".penecho");
    fs.mkdirSync(stateDir);
    const file = path.join(stateDir, "connections.json"), errors = capture();
    fs.writeFileSync(file, saved);
    const code = await main([], { env:{}, home, output:capture().stream, errorOutput:errors.stream,
      startServer:async () => assert.fail("must not start with corrupted storage") });
    assert.equal(code, 1);
    assert.match(errors.text(), /Restore or repair the connection store/);
    assert.equal(fs.readFileSync(file, "utf8"), saved);
  }
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

for (const interactive of [false, true]) {
  test(`first ${interactive ? "interactive" : "noninteractive"} startup serves the UI without terminal configuration`, async () => {
    const errors = capture(); let started = false;
    const code = await main([], {
      env:{}, home:temporaryDirectory(), cwd:temporaryDirectory(), packageRoot:ROOT,
      ui:interactive ? scriptedUi() : undefined,
      output:capture().stream, errorOutput:errors.stream, updateScheduler:() => {},
      startServer:async () => { started = true; },
    });
    assert.equal(code, 0);
    assert.equal(started, true);
    assert.equal(errors.text(), "");
  });
}

test("incomplete API configuration starts the UI but doctor remains strict", async () => {
  const options = { env:{ AI_PROVIDER:"api" }, home:temporaryDirectory(), cwd:temporaryDirectory(), packageRoot:ROOT,
    output:capture().stream, errorOutput:capture().stream, updateScheduler:() => {} };
  let started = false;
  assert.equal(await main([], { ...options, startServer:async () => { started = true; } }), 0);
  assert.equal(started, true);
  assert.equal(await main(["doctor"], { ...options, portChecker:async () => ({ ok:true }) }), 1);
});

test("configure opens the UI connections manager without terminal prompts or saving legacy config", async () => {
  const home = temporaryDirectory(); let started;
  assert.equal(await main(["configure"], {
    env:{}, home, cwd:temporaryDirectory(), packageRoot:ROOT, ui:scriptedUi(),
    output:capture().stream, errorOutput:capture().stream, updateScheduler:() => {},
    startServer:async configuration => { started = configuration; },
  }), 0);
  assert.equal(started.env.PENECHO_OPEN_CONNECTIONS, "true");
  assert.equal(fs.existsSync(path.join(home, ".penecho", "config.env")), false);
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
  const code = await runLegacyConfigure(["configure", "--api"], {
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
  const code = await runLegacyConfigure(["configure", "--api"], {
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
    const code = await runLegacyConfigure(["configure", scenario.flag], options), saved = fs.readFileSync(path.join(home, ".penecho", "config.env"), "utf8");
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
  assert.equal(anthropicBody.max_tokens,DEFAULT_MAX_TOKENS);
  assert.equal(anthropicBody.output_config.effort, "max");
  assert.equal(anthropicBody.messages[0].content.find(part => part.type === "image").source.media_type, "image/webp");
  assert.equal(Object.hasOwn(anthropicBody,"temperature"),false);
  assert.deepEqual(disabledAnthropicBody.thinking, { type:"disabled" });
  assert.equal(disabledAnthropicBody.max_tokens,DEFAULT_MAX_TOKENS);
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
      return { code:0, stdout:args[0] === "--version" ? `codex ${CODEX_CLI_PINNED_VERSION}\n` : args[0] === "debug" ? JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }) : "logged in\n", stderr:"" };
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
    runner:async (_launch, args) => ({ code:0, stdout:args[0] === "--version" ? `codex ${CODEX_CLI_PINNED_VERSION}\n` : args[0] === "debug" ? JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }) : "logged in\n", stderr:"" }),
  }), /not present.*bundled model catalog/);
});

test("configured CLI connection tests abort the model request at an explicit caller timeout", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
    AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"gpt-5.6-sol", CODEX_CLI_PATH:process.execPath, PATH:process.env.PATH,
  });
  await assert.rejects(testConfiguredProvider(configuration, {
    timeoutMs:25,
    runner:async (_launch, args) => ({ code:0, stdout:args[0] === "--version" ? `codex ${CODEX_CLI_PINNED_VERSION}\n` : args[0] === "debug" ? JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }) : "logged in\n", stderr:"" }),
    codexCaller:input => new Promise((resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once:true });
    }),
  }), error => error.code === "PENECHO_CONNECTION_TEST_TIMEOUT" && /timed out/.test(error.message));
});

test("configured Codex Test upgrades an old CLI and performs every remaining check with the managed CLI", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
    AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"gpt-5.6-sol", AI_EFFORT:"xhigh", CODEX_CLI_PATH:"placeholder", PATH:"",
  }), oldExecutable = fixtureExecutable(path.join(configuration.stateDir, "fixtures", "codex-old")),
    managedExecutable = managedCliPath("codex-cli", { ...configuration, platform:"darwin" }), events = [];
  configuration.env.CODEX_CLI_PATH = oldExecutable;
  const originalEnv = { ...configuration.env };
  const result = await testConfiguredProvider(configuration, {
    platform:"darwin",
    runner:async (launch, args) => {
      events.push(`run:${launch.command}:${args.join(" ")}`);
      if (args[0] === "--version") return { code:0, stdout:`codex ${launch.command === oldExecutable ? "0.149.1" : CODEX_CLI_PINNED_VERSION}\n`, stderr:"" };
      if (args[0] === "debug") return { code:0, stdout:JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }), stderr:"" };
      return { code:0, stdout:"logged in\n", stderr:"" };
    },
    onCliUpgrade:async event => events.push(`upgrade:${event.phase}`),
    codexInstaller:async (provider, options) => {
      events.push(`install:${provider}:${options.stateDir}`);
      fixtureExecutable(managedExecutable);
      return { provider, executable:managedExecutable, version:`codex ${CODEX_CLI_PINNED_VERSION}` };
    },
    codexCaller:async input => {
      events.push(`model:${input.executable}:${input.model}:${input.effort}`);
      assert.equal(input.env.CODEX_CLI_PATH, managedExecutable);
      assert.match(input.atlasImage, /^data:image\/webp;base64,/);
      return "OK";
    },
  });
  assert.match(result, new RegExp(CODEX_CLI_PINNED_VERSION.replaceAll(".", "\\.")));
  assert.deepEqual(configuration.env, originalEnv);
  assert.deepEqual(events, [
    `run:${oldExecutable}:--version`, `run:${oldExecutable}:login status`,
    "upgrade:start", `install:codex-cli:${configuration.stateDir}`, "upgrade:complete",
    `run:${managedExecutable}:--version`, `run:${managedExecutable}:login status`,
    `run:${managedExecutable}:debug models --bundled`,
    `model:${managedExecutable}:gpt-5.6-sol:xhigh`,
  ]);
});

test("configured Codex Test reuses a compatible managed CLI instead of repeatedly upgrading an old configured CLI", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
    AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"gpt-5.6-sol", CODEX_CLI_PATH:"placeholder", PATH:"",
  }), oldExecutable = fixtureExecutable(path.join(configuration.stateDir, "fixtures", "codex-old")),
    managedExecutable = fixtureExecutable(managedCliPath("codex-cli", { ...configuration, platform:"darwin" })), calls = [];
  configuration.env.CODEX_CLI_PATH = oldExecutable;
  await testConfiguredProvider(configuration, {
    platform:"darwin",
    runner:async (launch, args) => {
      calls.push([launch.command, ...args]);
      if (args[0] === "--version") return { code:0, stdout:`codex ${launch.command === oldExecutable ? "0.149.1" : "0.154.0"}`, stderr:"" };
      if (args[0] === "debug") return { code:0, stdout:JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }), stderr:"" };
      return { code:0, stdout:"logged in", stderr:"" };
    },
    codexInstaller:async () => { throw new Error("compatible managed CLI must be reused"); },
    onCliUpgrade:async () => { throw new Error("no installation callback expected"); },
    codexCaller:async input => { assert.equal(input.executable, managedExecutable); return "OK"; },
  });
  assert.deepEqual(calls.map(call => call[0]), [oldExecutable, oldExecutable, managedExecutable, managedExecutable, managedExecutable]);
});

test("configured Codex Test does not reinstall a current managed CLI when its login check fails", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
    AI_PROVIDER:"codex-cli", CODEX_CLI_PATH:"placeholder", PATH:"",
  }), oldExecutable = fixtureExecutable(path.join(configuration.stateDir, "fixtures", "codex-old")),
    managedExecutable = fixtureExecutable(managedCliPath("codex-cli", { ...configuration, platform:"darwin" }));
  configuration.env.CODEX_CLI_PATH = oldExecutable;
  let installs = 0;
  await assert.rejects(testConfiguredProvider(configuration, {
    platform:"darwin",
    runner:async (launch, args) => {
      if (args[0] === "--version") return { code:0, stdout:`codex ${launch.command === oldExecutable ? "0.149.1" : CODEX_CLI_PINNED_VERSION}`, stderr:"" };
      return launch.command === managedExecutable
        ? { code:1, stdout:"", stderr:"login check unavailable" }
        : { code:0, stdout:"logged in", stderr:"" };
    },
    codexInstaller:async () => { installs += 1; },
  }), /could not complete its login check/);
  assert.equal(installs, 0);
});

test("configured Codex Test neither installs nor downgrades current and newer CLIs", async () => {
  for (const version of [CODEX_CLI_PINNED_VERSION, "1.0.0"]) {
    const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
      AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"gpt-5.6-sol", CODEX_CLI_PATH:process.execPath, PATH:process.env.PATH,
    });
    let modelExecutable;
    await testConfiguredProvider(configuration, {
      runner:async (_launch, args) => ({ code:0, stdout:args[0] === "--version" ? `codex ${version}` : args[0] === "debug" ? JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }) : "logged in", stderr:"" }),
      codexInstaller:async () => { throw new Error("installation was not expected"); },
      onCliUpgrade:async () => { throw new Error("upgrade callback was not expected"); },
      codexCaller:async input => { modelExecutable=input.executable; return "OK"; },
    });
    assert.equal(modelExecutable, process.execPath);
  }
});

test("a failed Codex Test upgrade does not call a model and can retry on the next explicit Test", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
    AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"gpt-5.6-sol", CODEX_CLI_PATH:"placeholder", PATH:"",
  }), oldExecutable = fixtureExecutable(path.join(configuration.stateDir, "fixtures", "codex-old")),
    managedExecutable = managedCliPath("codex-cli", { ...configuration, platform:"darwin" }), phases = [];
  configuration.env.CODEX_CLI_PATH = oldExecutable;
  let attempts = 0, modelCalls = 0;
  const options = {
    platform:"darwin",
    runner:async (launch, args) => {
      if (args[0] === "--version") return { code:0, stdout:`codex ${launch.command === oldExecutable ? "0.149.1" : CODEX_CLI_PINNED_VERSION}`, stderr:"" };
      if (args[0] === "debug") return { code:0, stdout:JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }), stderr:"" };
      return { code:0, stdout:"logged in", stderr:"" };
    },
    onCliUpgrade:async event => phases.push(event.phase),
    codexInstaller:async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("simulated official installer failure");
      fixtureExecutable(managedExecutable);
      return { executable:managedExecutable };
    },
    codexCaller:async () => { modelCalls += 1; return "OK"; },
  };
  await assert.rejects(testConfiguredProvider(configuration, options), /simulated official installer failure/);
  assert.equal(modelCalls, 0);
  await testConfiguredProvider(configuration, options);
  assert.equal(attempts, 2);
  assert.equal(modelCalls, 1);
  assert.deepEqual(phases, ["start", "complete", "start", "complete"]);
});

test("Codex Test rejects an unparseable CLI version without installing", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
    AI_PROVIDER:"codex-cli", CODEX_CLI_PATH:process.execPath, PATH:process.env.PATH,
  });
  let installs = 0;
  await assert.rejects(testConfiguredProvider(configuration, {
    runner:async (_launch, args) => ({ code:0, stdout:args[0] === "--version" ? "codex development" : "logged in", stderr:"" }),
    codexInstaller:async () => { installs += 1; },
  }), /did not report a semantic version/);
  assert.equal(installs, 0);
});

test("Codex upgrade waiting is outside the model timeout and the restarted timeout still aborts the upgraded model", async () => {
  const makeConfiguration = () => {
    const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
      AI_PROVIDER:"codex-cli", CODEX_CLI_MODEL:"gpt-5.6-sol", CODEX_CLI_PATH:"placeholder", PATH:"",
    });
    configuration.env.CODEX_CLI_PATH = fixtureExecutable(path.join(configuration.stateDir, "fixtures", "codex-old"));
    return configuration;
  };
  const run = async (configuration, codexCaller) => {
    const managedExecutable = managedCliPath("codex-cli", { ...configuration, platform:"darwin" });
    return testConfiguredProvider(configuration, {
      platform:"darwin",
      timeoutMs:20,
      runner:async (launch, args) => {
        if (args[0] === "--version") return { code:0, stdout:`codex ${launch.command === configuration.env.CODEX_CLI_PATH ? "0.149.1" : CODEX_CLI_PINNED_VERSION}`, stderr:"" };
        if (args[0] === "debug") return { code:0, stdout:JSON.stringify({ models:[{ slug:"gpt-5.6-sol" }] }), stderr:"" };
        return { code:0, stdout:"logged in", stderr:"" };
      },
      codexInstaller:async () => {
        await new Promise(resolve => setTimeout(resolve, 45));
        fixtureExecutable(managedExecutable);
        return { executable:managedExecutable };
      },
      codexCaller,
    });
  };
  await run(makeConfiguration(), async () => "OK");
  await assert.rejects(run(makeConfiguration(), input => new Promise((resolve, reject) => {
    input.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once:true });
  })), error => error.code === "PENECHO_CONNECTION_TEST_TIMEOUT");
});

test("Codex Test does not begin an upgrade after its pre-install test budget expires", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--codex"]), {
    AI_PROVIDER:"codex-cli", CODEX_CLI_PATH:process.execPath, PATH:process.env.PATH,
  });
  let installs = 0, callbacks = 0;
  await assert.rejects(testConfiguredProvider(configuration, {
    timeoutMs:20,
    runner:async (_launch, args) => {
      if (args[0] === "--version") await new Promise(resolve => setTimeout(resolve, 30));
      return { code:0, stdout:args[0] === "--version" ? "codex 0.149.1" : "logged in", stderr:"" };
    },
    codexInstaller:async () => { installs += 1; },
    onCliUpgrade:async () => { callbacks += 1; },
  }), error => error.code === "PENECHO_CONNECTION_TEST_TIMEOUT");
  assert.equal(installs, 0);
  assert.equal(callbacks, 0);
});

test("non-Codex configured tests never invoke the Codex installer or upgrade callback", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--kimi"]), {
    AI_PROVIDER:"kimi-cli", KIMI_CLI_PATH:process.execPath, PATH:process.env.PATH,
  });
  await testConfiguredProvider(configuration, {
    runner:async () => ({ code:0, stdout:"kimi-code 1.0.0", stderr:"" }),
    kimiCaller:async () => "OK",
    codexInstaller:async () => { throw new Error("Codex installer must not run"); },
    onCliUpgrade:async () => { throw new Error("Codex upgrade callback must not run"); },
  });
});

test("Codex installs share one in-flight operation per state directory and version", async () => {
  const directory = temporaryDirectory(), home = path.join(directory, "home"), stateA = path.join(directory, "state-a"), stateB = path.join(directory, "state-b");
  fs.mkdirSync(home, { recursive:true });
  let downloads = 0;
  const fetchImpl = async () => {
    downloads += 1;
    await new Promise(resolve => setTimeout(resolve, 15));
    return { ok:true, arrayBuffer:async () => new TextEncoder().encode("#!/bin/sh\nCODEX_INSTALL_DIR\n").buffer };
  };
  const runner = async (_command, args, options) => {
    if (args[0] === "--version") return { output:`codex ${CODEX_CLI_PINNED_VERSION}` };
    assert.equal(options.env.HOME, path.join(options.cwd, "tools", "codex", "home"));
    assert.equal(options.env.USERPROFILE, options.env.HOME);
    assert.notEqual(options.env.HOME, home);
    fs.mkdirSync(options.env.CODEX_INSTALL_DIR, { recursive:true });
    fixtureExecutable(path.join(options.env.CODEX_INSTALL_DIR, "codex"));
    fixtureExecutable(path.join(options.env.CODEX_INSTALL_DIR, codexHostName("darwin")));
    return { output:"installed" };
  };
  const installOptions = stateDir => ({ platform:"darwin", home, stateDir, fetchImpl, runner });
  const [first, second] = await Promise.all([installCli("codex-cli", installOptions(stateA)), installCli("codex-cli", installOptions(stateA))]);
  assert.equal(downloads, 1);
  assert.equal(first.executable, second.executable);
  await Promise.all([installCli("codex-cli", installOptions(stateA)), installCli("codex-cli", installOptions(stateB))]);
  assert.equal(downloads, 3);
});

test("a failed shared Codex install is removed so the same state can retry", async () => {
  const directory = temporaryDirectory(), home = path.join(directory, "home"), stateDir = path.join(directory, "state");
  fs.mkdirSync(home, { recursive:true });
  let downloads = 0, attempts = 0;
  const options = {
    platform:"darwin",
    home,
    stateDir,
    fetchImpl:async () => {
      downloads += 1;
      return { ok:true, arrayBuffer:async () => new TextEncoder().encode("#!/bin/sh\nCODEX_INSTALL_DIR\n").buffer };
    },
    runner:async (_command, args, runOptions) => {
      if (args[0] === "--version") return { output:`codex ${CODEX_CLI_PINNED_VERSION}` };
      attempts += 1;
      if (attempts === 1) throw new Error("simulated install failure");
      fs.mkdirSync(runOptions.env.CODEX_INSTALL_DIR, { recursive:true });
      fixtureExecutable(path.join(runOptions.env.CODEX_INSTALL_DIR, "codex"));
      fixtureExecutable(path.join(runOptions.env.CODEX_INSTALL_DIR, codexHostName("darwin")));
      return { output:"installed" };
    },
  };
  await assert.rejects(installCli("codex-cli", options), /simulated install failure/);
  const installed = await installCli("codex-cli", options);
  assert.equal(downloads, 2);
  assert.equal(attempts, 2);
  assert.equal(installed.executable, managedCliPath("codex-cli", options));
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

test("Claude preflight classifies JSON loggedIn false as authentication and preserves other command failures", async () => {
  const configuration = isolatedConfiguration(parseArgs(["--claude"]), { AI_PROVIDER:"claude-cli", CLAUDE_CLI_PATH:process.execPath, PATH:process.env.PATH });
  const run = status => runClaudePreflight(configuration, { runner:async (_launch, args) => args[0] === "--version" ? { code:0, stdout:"claude test\n", stderr:"" } : status });
  assert.equal((await run({ code:0, stdout:'{"loggedIn":true,"authMethod":"oauth_token"}', stderr:"" })).ok, true);
  for (const code of [0, 1]) {
    const result = await run({ code, stdout:'{"loggedIn":false,"authMethod":"oauth_token"}', stderr:"" });
    assert.equal(result.ok, false);
    assert.equal(result.issue, "authentication");
  }
  for (const status of [
    { code:1, stdout:'{"loggedIn":true,"authMethod":"oauth_token"}', stderr:"" },
    { code:1, stdout:"", stderr:"status service unavailable" },
  ]) {
    const execution = await run(status);
    assert.equal(execution.ok, false);
    assert.equal(execution.issue, "execution");
  }
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

test("Claude startup uses the login recovery command for JSON logged-out status", async () => {
  for (const loginCode of [0, 1]) {
    const directory = temporaryDirectory(), errorOutput = capture();
    const code = await main(["--claude"], {
      env:{ AI_PROVIDER:"claude-cli", CLAUDE_CLI_PATH:process.execPath, PATH:"" }, home:directory, cwd:directory, packageRoot:ROOT,
      candidates:[{ executable:process.execPath, source:"configured" }], awaitCliPreflight:true,
      output:capture().stream, errorOutput:errorOutput.stream,
      runner:async (_launch, args) => args[0] === "--version"
        ? { code:0, stdout:"claude test\n", stderr:"" }
        : { code:loginCode, stdout:'{"loggedIn":false,"authMethod":"oauth_token"}', stderr:"" },
      startServer:async () => ({ listening:true }), updateScheduler:() => {},
    });
    assert.equal(code, 0);
    assert.match(errorOutput.text(), /claude auth login/);
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
  assert.match(output.text(), /Node\.js .*22\.19\.0\+ required/);
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

test("help documents active options without obsolete setup or legacy stdio guidance", () => {
  const help = helpText();
  assert.doesNotMatch(help, /configure|legacy stdio|curl|irm /);
  assert.match(help, /Settings → Connections/);
  assert.match(help, /~\/.penecho\/config\.env/);
  assert.match(help, /--config/);
  assert.match(help, /--model/);
  assert.match(help, /--effort/);
  assert.match(help, /--kimi/);
  assert.match(help, /mcp discover/);
  assert.match(help, /hermes/);
});

test("Linux automatic CLI installation rejects before downloading or running an installer", async () => {
  const configuration = isolatedConfiguration();
  for (const provider of ["codex-cli", "kimi-cli", "claude-cli"]) {
    await assert.rejects(installCli(provider, {
      ...configuration, platform:"linux",
      fetchImpl:async () => { assert.fail("unsupported platforms must not download installers"); },
      runner:async () => { assert.fail("unsupported platforms must not execute installers"); },
    }), /automatic installation is available on macOS and Windows/);
  }
});
