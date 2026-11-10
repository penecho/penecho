"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Run the production launch resolvers as Windows without spawning any process.
function fixture(t, respond) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-mcp-windows-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const calls = [], cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports:{} }, localRequire = createRequire(filename);
    cache.set(filename, module.exports);
    const requireMock = name => {
      if (name === "node:child_process") return { execFile(command, args, options, callback) {
        const call = { command, args:Array.from(args), options };
        calls.push(call);
        respond(call, callback);
      } };
      if (name === "../../providers/codex-cli.js" || name === "../../providers/claude-cli.js") return load(localRequire.resolve(name));
      return localRequire(name);
    };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
      require:requireMock, module, exports:module.exports,
      process:{ platform:"win32", execPath:process.execPath, env:process.env, cwd:()=>root },
      Buffer, setTimeout, clearTimeout,
    }, { filename });
    cache.set(filename, module.exports);
    return module.exports;
  }
  const api = load(path.join(__dirname, "../src/server/mcp/configure.js"));
  const configure=api.configureClient;api.configureClient=(client,launch,options={})=>configure(client,launch,{home:root,...options});
  const file = relative => {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive:true });
    fs.writeFileSync(filename, "");
    return filename;
  };
  return { api, calls, root, file };
}

const launch = {
  command:'C:\\Program Files\\PenEcho & Tools\\PenEcho.exe',
  args:['C:\\Users\\用户\\stdio.js', '--state-dir', 'C:\\space & %PATH% ! ^ ( )\\', 'literal "quote"'],
  env:{ ELECTRON_RUN_AS_NODE:"1", EXACT:'space & %PATH% ! ^ "quoted"' },
};
const missingEntry = (call, callback) => callback(call.args.includes("get") ? new Error("not configured") : null, "", "");

for (const client of ["codex", "claude"]) {
  test(`${client} npm Windows wrapper configures with literal arguments through Node`, async t => {
    const { api, calls, root, file } = fixture(t, missingEntry);
    const wrapper = file(`${client}.cmd`);
    const script = file(client === "codex" ? "node_modules/@openai/codex/bin/codex.js" : "node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs");
    const env = { PATH:"test-path", HOME:root };
    const result = await api.configureClient(client, launch, { candidates:[{ executable:wrapper }], rootDirectory:root, env });
    assert.equal(result.configured, true);
    assert.equal(result.updated,false);
    assert.equal(calls.length, client === "codex" ? 2 : 1);
    if(client === "codex")assert.deepEqual(calls[0].args, [script, "mcp", "get", "penecho"]);
    assert.deepEqual(calls.at(-1).args, [script, ...api.configurationArguments(client, launch)]);
    for (const call of calls) {
      assert.equal(call.command, process.execPath);
      assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, "1");
      assert.equal(call.options.env.HOME, root);
      assert.equal(call.options.cwd, root);
      assert.equal(call.options.timeout, 20_000);
      assert.equal(call.options.shell, undefined);
      assert.equal(call.options.windowsHide, true);
    }
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  });
}

test("Windows inspection resolves Claude native payload and Codex npm payload without writes", async t => {
  const { api, calls, file } = fixture(t, (call, callback) => callback(null, "entry", ""));
  const codex = file("codex.cmd"), claude = file("claude.cmd");
  const script = file("node_modules/@openai/codex/bin/codex.js");
  const native = file("node_modules/@anthropic-ai/claude-code/bin/claude.exe");
  const result = await api.inspectConfiguredClients({ candidates:{ codex:[{ executable:codex }], claude:[{ executable:claude }] } });
  assert.deepEqual(Array.from(result), ["codex", "claude"]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.find(call => call.command === process.execPath).args, [script, "mcp", "get", "penecho"]);
  assert.deepEqual(calls.find(call => call.command === native).args, ["mcp", "get", "penecho"]);
  assert.ok(calls.every(call => call.options.timeout === 1_000 && !call.options.shell));
});

test("unsupported Windows wrapper falls back to native candidate and preserves existing entry", async t => {
  const { api, calls, file } = fixture(t, (call, callback) => callback(null, "entry", ""));
  const wrapper = file("unsupported/codex.cmd"), native = file("managed/codex.exe");
  const result = await api.configureClient("codex", launch, { candidates:[{ executable:wrapper }, { executable:native }] });
  assert.equal(result.updated, true);
  assert.equal(result.configured, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, native);
  assert.deepEqual(calls[0].args, ["mcp", "get", "penecho"]);
});

test("unsupported Windows wrapper fails without invoking a shell", async t => {
  const { api, calls, file } = fixture(t, () => assert.fail("must not execute wrapper"));
  const result = await api.configureClient("codex", launch, { candidates:[{ executable:file("codex.bat") }] });
  assert.equal(result.configured, false);
  assert.match(result.error, /Windows batch wrappers are unsupported/);
  assert.equal(calls.length, 0);
});

for (const client of ["codex", "claude"]) {
  test(`${client} packaged configuration launches from resources with literal arguments`, async t => {
    const { api, calls, root, file } = fixture(t, (call, callback) => {
      // Model the OS rejecting Electron's virtual archive directory.
      if (call.options.cwd !== resources) return callback(Object.assign(new Error("spawn ENOENT"), { code:"ENOENT" }), "", "");
      missingEntry(call, callback);
    });
    const resources = path.join(root, "resources");
    const executable = file(client === "codex" ? "codex.cmd" : "claude.exe");
    const prefix = client === "codex" ? [file("node_modules/@openai/codex/bin/codex.js")] : [];
    const env = { PATH:"literal-path", EXACT:"space & %PATH% ! ^" };
    const result = await api.configureClient(client, launch, {
      candidates:[{ executable }], rootDirectory:path.join(resources, "app.asar"), env,
    });
    assert.equal(result.configured, true);
    assert.equal(calls.length, client === "codex" ? 2 : 1);
    if(client === "codex")assert.deepEqual(calls[0].args, [...prefix, "mcp", "get", "penecho"]);
    assert.deepEqual(calls.at(-1).args, [...prefix, ...api.configurationArguments(client, launch)]);
    assert.ok(calls.every(call => call.options.cwd === resources && call.options.env.EXACT === env.EXACT && !call.options.shell));
    assert.equal(calls.at(-1).command, client === "codex" ? process.execPath : executable);
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  });
}

test("packaged Windows inspection uses a real cwd for Node and native clients", async t => {
  const resources = 'C:\\Program Files\\PenEcho\\resources';
  const { api, calls, file } = fixture(t, (call, callback) => callback(
    call.options.cwd === resources ? null : Object.assign(new Error("spawn ENOENT"), { code:"ENOENT" }), "entry", "",
  ));
  const codex = file("codex.cmd"), claude = file("claude.exe");
  file("node_modules/@openai/codex/bin/codex.js");
  const result = await api.inspectConfiguredClients({
    candidates:{ codex:[{ executable:codex }], claude:[{ executable:claude }] },
    rootDirectory:resources + '\\app.asar\\src',
  });
  assert.deepEqual(Array.from(result), ["codex", "claude"]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.cwd === resources && call.options.timeout === 1_000));
});

test("configuration and inspection normalize cwd before injected runners and preserve existing entries", async t => {
  const { api } = fixture(t, () => assert.fail("injected runner expected"));
  const roots = [
    ['C:\\PenEcho\\resources\\app.asar', 'C:\\PenEcho\\resources'],
    ['C:/PenEcho/resources/app.asar/src', 'C:/PenEcho/resources'],
    ['/Applications/PenEcho.app/Contents/Resources/app.asar/src', '/Applications/PenEcho.app/Contents/Resources'],
    ['C:\\PenEcho\\resources\\app.asar.unpacked\\src', 'C:\\PenEcho\\resources\\app.asar.unpacked\\src'],
    ['/workspace/app.asar.unpacked/src', '/workspace/app.asar.unpacked/src'],
    ['/workspace/source', '/workspace/source'],
    [undefined, undefined],
  ];
  for (const [rootDirectory, expected] of roots) {
    const calls = [];
    const env = { EXACT:"literal" };
    const executeFile = async (executable, args, options) => {
      calls.push({ args:Array.from(args), options });
      assert.equal(options.cwd, expected);
      assert.equal(options.env, env);
      return { stdout:"entry" };
    };
    const candidates = [{ executable:"client.exe" }];
    for (const client of ["codex", "claude"]) {
      const result = await api.configureClient(client, launch, { candidates, rootDirectory, env, executeFile });
      assert.equal(result.updated, client === "codex");
      assert.equal(result.configured, true);
    }
    assert.deepEqual(Array.from(await api.inspectConfiguredClients({ candidates, rootDirectory, env, executeFile })), ["codex", "claude"]);
    assert.equal(calls.length, 5);
    assert.equal(calls.filter(call=>call.args.includes("add")).length,2);
  }
});
test('Claude replaces only the user PenEcho entry atomically with literal launch data',async t=>{
 const {api,root}=fixture(t,()=>assert.fail('existing user entry must not launch its old command'));
 const dir=path.join(root,'claude-user');fs.mkdirSync(dir);const file=path.join(dir,'.claude.json');const config={apiKey:'private-test-value',mcpServers:{other:{type:'http',url:'https://example.test'},penecho:{type:'http',url:'https://old.test',headers:{Authorization:'old'}}},projects:{'/project':{mcpServers:{penecho:{command:'project-only'}}}}};fs.writeFileSync(file,JSON.stringify(config));
 const result=await api.configureClient('claude',launch,{candidates:[{executable:'claude.exe'}],env:{CLAUDE_CONFIG_DIR:dir}});assert.equal(result.configured,true);assert.equal(result.updated,true);const saved=JSON.parse(fs.readFileSync(file));assert.deepEqual(saved.mcpServers.penecho,{type:'stdio',...launch});assert.deepEqual(saved.mcpServers.other,config.mcpServers.other);assert.deepEqual(saved.projects,config.projects);assert.equal(saved.apiKey,config.apiKey);assert.deepEqual(fs.readdirSync(dir),['.claude.json']);
});
test('Claude malformed user JSON fails without changing bytes or leaking content',async t=>{
 const {api,root}=fixture(t,()=>assert.fail('invalid file must not invoke CLI'));const file=path.join(root,'.claude.json'),source='{"secret":"NEVER-RETURN-THIS", bad';fs.writeFileSync(file,source);
 const result=await api.configureClient('claude',launch,{candidates:[{executable:'claude.exe'}]});assert.equal(result.configured,false);assert.match(result.error,/invalid JSON/);assert(!JSON.stringify(result).includes('NEVER-RETURN-THIS'));assert.equal(fs.readFileSync(file,'utf8'),source);
});
test('unknown Codex inspection failure does not overwrite or report a new configuration',async t=>{
 const {api,calls,file}=fixture(t,(_call,callback)=>callback(new Error('inspection timed out'),'',''));const result=await api.configureClient('codex',launch,{candidates:[{executable:file('codex.exe')}]});assert.equal(result.configured,false);assert.equal(calls.length,1);assert(!calls.some(c=>c.args.includes('add')));
});
