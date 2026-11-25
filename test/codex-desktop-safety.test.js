"use strict";
require("./helpers/safety.js");
// PE-1131, owner: "Pls check if in the future penecho cli or desktop will ruin windows's codex desktop, it should not and must not."
// Each test is one way PenEcho could stop the person's own Codex app from working.
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const { prepareIsolatedRuntime, renewOwnSignIn } = require("../src/providers/codex-cli.js");
const { replaceCodex, configurationFragment, configureHttpClient } = require("../src/server/mcp/http-client-config.js");
const { treeOf } = require("../src/server/project-lines/run-watch.js");
const { createKeeper } = require("../src/server/project-lines/kept-child.js");

const ROOT = path.join(__dirname, "..");
// The words setup texts use to tell an agent never to do it.
const FORBIDDEN = "(setx, SetEnvironmentVariable, the registry, launchctl, LaunchAgents, shell profiles)";
const temp = (t, name) => { const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), name)); t.after(() => fs.rmSync(dir, { recursive:true, force:true })); return dir; };
function shipped() {
  const files = ["cli.js", "server.js", "forge.config.js"];
  const walk = folder => { for (const entry of fs.readdirSync(path.join(ROOT, folder), { withFileTypes:true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) { if (!["node_modules", "vendor", "examples"].includes(entry.name)) walk(file); }
    else if (/\.(?:c?js|mjs|ps1|cmd|bat|sh|html)$/.test(entry.name)) files.push(file);
  } };
  for (const folder of ["src", "desktop", "public", "tools/windows-cli", "skills"]) walk(folder);
  return files;
}
const jwt = exp => `h.${Buffer.from(JSON.stringify({ exp:Math.floor(exp / 1000) })).toString("base64url")}.s`;
const signIn = (exp, refresh = "RT-ONCE") => JSON.stringify({ auth_mode:"chatgpt", OPENAI_API_KEY:null, tokens:{ id_token:"id", access_token:jwt(exp), refresh_token:refresh, account_id:"a" }, last_refresh:"2026-01-01T00:00:00Z" });
function codexHome(t, auth) {
  const home = temp(t, "penecho-codex-safety-"), codex = path.join(home, ".codex");
  fs.mkdirSync(codex); fs.writeFileSync(path.join(codex, "auth.json"), auth);
  let n = 0;
  return { file:path.join(codex, "auth.json"), env:{ PATH:process.env.PATH, HOME:home, USERPROFILE:home, CODEX_HOME:codex },
    work:() => { const dir = path.join(home, `work-${++n}`); fs.mkdirSync(dir); return dir; } };
}
const copied = env => JSON.parse(fs.readFileSync(path.join(env.CODEX_HOME, "auth.json"), "utf8"));

test("nothing PenEcho ships sets an environment variable, a registry value or a startup item on the computer", () => {
  // The Windows CLI package adds its own folder to the user's PATH, and only there.
  const setter = /\bsetx(?:\.exe)?["'\s]|SetEnvironmentVariable\s*\((?!\s*'Path')|launchctl\W+setenv|\breg(?:\.exe)?["'\s,[]+add\b|(?:New|Set)-ItemProperty|HKEY_CURRENT_USER\\+Environment|HKCU:?\\+Environment/;
  const found = [];
  for (const file of shipped()) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8").replaceAll(FORBIDDEN, "");
    const at = setter.exec(text);
    if (at) found.push(`${file}: ${text.slice(Math.max(0, at.index - 40), at.index + 60).replace(/\s+/g, " ")}`);
  }
  assert.deepEqual(found, []);
});

test("no setup text asks an agent to make a certificate a setting of the whole computer", t => {
  for (const file of ["public/mcp-settings.js", "src/client/app/mcp-runtime.js", "public/app.js", "docs/mcp-setup.md", "src/server/mcp/http-client-config.js"]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const line of text.split("\n").filter(l => /CODEX_CA_CERTIFICATE/.test(l))) assert.match(line, /[Nn]ever set|do not set|\/\/ A CA named/, `${file}: ${line.slice(0, 160)}`);
    assert.doesNotMatch(text, /Configure persistent trust|supported launch or certificate settings|CODEX_CA_CERTIFICATE\s*:/, file);
  }
  for (const file of ["public/mcp-settings.js", "src/client/app/mcp-runtime.js", "public/app.js"]) assert.ok(fs.readFileSync(path.join(ROOT, file), "utf8").includes(FORBIDDEN), file);
  const result = configureHttpClient("codex", { url:"https://127.0.0.1:1/mcp", accessToken:"a".repeat(64), caFile:"/x/ca.pem" }, { home:temp(t, "penecho-codex-safety-"), env:{} });
  assert.equal(result.processEnvironment, undefined);
  assert.match(result.trustInstructions, /Never set it in a user or system environment variable/);
});

test("PenEcho never asks Codex to change the person's settings, sign-in, plugins or conversations", () => {
  const writes = /["'`](?:config\/(?:value\/write|batchWrite)|skills\/config\/write|account\/(?:login\/start|logout)|plugin\/(?:install|uninstall)|thread\/(?:archive|delete|unarchive|rollback|name\/set|metadata\/update)|windowsSandbox\/setupStart)["'`]/;
  assert.deepEqual(shipped().filter(file => /^(?:src|desktop)/.test(file) && writes.test(fs.readFileSync(path.join(ROOT, file), "utf8"))), []);
});

test("the Canvas's Codex never holds the refresh token, so it cannot use up the one the Codex app needs", async t => {
  const home = codexHome(t, signIn(Date.now() + 5 * 86400000)), before = fs.readFileSync(home.file, "utf8");
  const env = await prepareIsolatedRuntime(home.work(), home.env, { launch:{ command:"unused", prefixArgs:[] }, renew:async () => assert.fail("a sign-in with days left is not renewed") });
  assert.equal(copied(env).tokens.refresh_token, "");
  assert.equal(copied(env).tokens.access_token, JSON.parse(before).tokens.access_token);
  assert.ok(Date.now() - Date.parse(copied(env).last_refresh) < 60000, "an older Codex renews by this date");
  assert.equal(fs.readFileSync(home.file, "utf8"), before);
  const key = codexHome(t, '{"OPENAI_API_KEY":"sk-x"}');
  assert.equal(fs.readFileSync(path.join((await prepareIsolatedRuntime(key.work(), key.env)).CODEX_HOME, "auth.json"), "utf8"), '{"OPENAI_API_KEY":"sk-x"}');
});

test("a sign-in about to end is renewed by the person's own Codex in its own home, and one that stays ended says so", async t => {
  const home = codexHome(t, signIn(Date.now() + 60000));
  const env = await prepareIsolatedRuntime(home.work(), home.env, { launch:{ command:"codex", prefixArgs:[] }, renew:async (launch, own) => { assert.equal(own.CODEX_HOME, path.dirname(home.file)); fs.writeFileSync(home.file, signIn(Date.now() + 9 * 86400000, "RT-NEXT")); } });
  assert.deepEqual([copied(env).tokens.refresh_token, copied(env).tokens.access_token], ["", JSON.parse(fs.readFileSync(home.file, "utf8")).tokens.access_token]);
  const ended = codexHome(t, signIn(Date.now() - 60000));
  await assert.rejects(prepareIsolatedRuntime(ended.work(), ended.env, { launch:{ command:"codex", prefixArgs:[] }, renew:async () => {} }), /sign-in has expired/);
  const broken = codexHome(t, "{");
  await assert.rejects(prepareIsolatedRuntime(broken.work(), broken.env), /readable auth\.json/);
});

test("renewing asks Codex for its account once for all who wait, with nothing forced", async t => {
  const dir = temp(t, "penecho-codex-safety-"), log = path.join(dir, "log"), fake = path.join(dir, "codex.js");
  fs.writeFileSync(fake, `const fs=require("fs"),log=x=>fs.appendFileSync(${JSON.stringify(log)},x+"\\n");log("start "+process.argv.slice(2).join(" "));let b="";process.stdin.on("data",d=>{b+=d;const l=b.split("\\n");b=l.pop();for(const x of l){const m=JSON.parse(x);log(x);if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:{}})+"\\n");}});`);
  const launch = { command:process.execPath, prefixArgs:[fake] };
  await Promise.all([renewOwnSignIn(launch, process.env, dir), renewOwnSignIn(launch, process.env, dir)]);
  const said = fs.readFileSync(log, "utf8").trim().split("\n");
  assert.equal(said.filter(l => l.startsWith("start ")).length, 1);
  assert.equal(said[0], "start app-server");
  assert.deepEqual(said.slice(1).map(l => JSON.parse(l).method), ["initialize", "initialized", "account/read"]);
  assert.deepEqual(JSON.parse(said.at(-1)).params, { refreshToken:false });
});

test("PenEcho's own entry is the only thing it changes in Codex's config.toml", () => {
  const before = "model = \"gpt-6.1-sol\"\n[windows]\nsandbox = \"elevated\"\n[mcp_servers.node_repl]\nargs = []\n[mcp_servers.penecho]\ncommand = \"old\"\n[mcp_servers.penecho.env]\nX = \"1\"\n[projects.'c:\\users\\msi\\a b']\ntrust_level = \"trusted\"\n";
  const fragment = configurationFragment("codex", { type:"stdio", command:"C:\\Program Files\\nodejs\\node.exe", args:["client.js"] });
  assert.equal(replaceCodex(before, fragment), `${before.replace(/\[mcp_servers\.penecho\]\ncommand = "old"\n\[mcp_servers\.penecho\.env\]\nX = "1"\n/, "").trimEnd()}\n\n${fragment}`);
});

test("stopping a Work leaves alone an older process that only has its number as parent", () => {
  // The Codex app's service, whose real parent has ended, and the agent that has that number now.
  const table = [{ pid:900, ppid:1, cpu:1, startedAt:5000 }, { pid:901, ppid:900, cpu:2, startedAt:5001 }, { pid:77, ppid:900, cpu:500, startedAt:1000 }, { pid:78, ppid:77, cpu:500, startedAt:1001 }];
  assert.deepEqual(treeOf(table, 900), { below:[901], cpu:3 });
});

test("after the computer restarted, a program that has an old agent's number is not taken for it or stopped", async t => {
  const dir = path.join(temp(t, "penecho-codex-safety-"), "run"), other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio:"ignore", detached:true });
  t.after(() => { try { process.kill(-other.pid, "SIGKILL"); } catch { try { other.kill("SIGKILL"); } catch {} } });
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "pid.json"), JSON.stringify({ keeper:0, agent:other.pid, command:"codex", at:Date.now() - os.uptime() * 1000 - 3600000 }));
  const child = createKeeper({ root:path.dirname(dir) }).attach(dir, {}), closed = new Promise(resolve => child.on("close", resolve));
  child.kill("SIGKILL");
  assert.equal(await closed, 1, "the Work ends as lost");
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(other.exitCode, null); assert.equal(other.signalCode, null);
});
