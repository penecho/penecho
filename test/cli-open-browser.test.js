"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough, Writable } = require("node:stream");
const test = require("node:test");
const { main, parseArgs, buildRestartArgv } = require("../cli.js");
const { browserCommand, browserUrl, canOpenBrowser, openBrowser } = require("../src/cli/open-browser.js");

const TTY = { isTTY:true };

async function start(t, argv, {
  tty = true, env = {}, opens = true, address = { address:"0.0.0.0", port:4123 },
  version = "0.0.0", updateAnswer = "n", browserAnswer = "",
} = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-open-"));
  t.after(() => fs.rmSync(home, { recursive:true, force:true }));
  const opened = [], events = [], input = new PassThrough();
  input.isTTY = tty;
  let text = "";
  const output = new Writable({ write(chunk, _encoding, callback) {
    const line = chunk.toString();
    text += line;
    if (line === "Update PenEcho now? [Y/n] ") {
      events.push("update prompt");
      queueMicrotask(() => updateAnswer === null ? input.end() : input.write(`${updateAnswer}\n`));
    } else if (line === "Open PenEcho in your browser? [Y/n] ") {
      events.push("browser prompt");
      queueMicrotask(() => browserAnswer === null ? input.end() : input.write(`${browserAnswer}\n`));
    }
    callback();
  } });
  output.isTTY = tty;
  const code = await main(argv, {
    env, home, cwd:home, platform:"darwin", input, output, errorOutput:{ write:value => assert.fail(value) }, awaitUpdateCheck:true,
    startServer:async () => ({ listening:true, address:() => address, close:callback => { events.push("stop"); callback(); } }),
    updateChecker:async () => { events.push("check"); return version; },
    updateInstaller:async () => { events.push("install"); return true; },
    openBrowser:async url => { events.push("open"); opened.push(url); return opens; },
  });
  assert.equal(code, 0);
  return { opened, events, text };
}

test("with no update, Enter opens the page on the port the server got", async t => {
  const result = await start(t, ["--port", "0"]);
  assert.deepEqual(result.events, ["check", "browser prompt", "open"]);
  assert.deepEqual(result.opened, ["http://localhost:4123"]);
});

test("declining an available update leads to the browser prompt", async t => {
  const result = await start(t, [], { version:"99.0.0" });
  assert.deepEqual(result.events, ["check", "update prompt", "browser prompt", "open"]);
});

test("accepting an available update installs it and stops without asking to open the browser", async t => {
  const result = await start(t, [], { version:"99.0.0", updateAnswer:"" });
  assert.deepEqual(result.events, ["check", "update prompt", "install", "stop"]);
});

test("declining or closing the browser prompt leaves the server running", async t => {
  for (const browserAnswer of ["n", null]) {
    const result = await start(t, [], { browserAnswer });
    assert.deepEqual(result.events, ["check", "browser prompt"]);
    assert.match(result.text, /PenEcho is running at http:\/\/localhost:4123\./);
  }
});

test("closing terminal input at the update prompt skips the browser prompt", async t => {
  const result = await start(t, [], { version:"99.0.0", updateAnswer:null });
  assert.deepEqual(result.events, ["check", "update prompt"]);
  assert.match(result.text, /PenEcho is running at http:\/\/localhost:4123\./);
});

test("--no-open, a script, CI and SSH skip asking to open the browser", async t => {
  assert.deepEqual((await start(t, ["--no-open"])).events, ["check"]);
  assert.deepEqual((await start(t, [], { tty:false })).events, []);
  assert.deepEqual((await start(t, [], { env:{ CI:"true" } })).events, ["check"]);
  assert.deepEqual((await start(t, [], { env:{ SSH_CONNECTION:"a b" } })).events, ["check"]);
});

test("a browser that does not open leaves the link in the terminal", async t => {
  assert.match((await start(t, [], { opens:false })).text, /Open http:\/\/localhost:4123 in your browser\./);
});

test("a server that is not listening opens nothing", async t => {
  assert.deepEqual((await start(t, [], { address:null })).opened, []);
});

test("the page's address follows the server's", () => {
  assert.equal(browserUrl({ address:"::", port:1 }), "http://localhost:1");
  assert.equal(browserUrl({ address:"127.0.0.1", port:2 }), "http://127.0.0.1:2");
  assert.equal(browserUrl({ address:"fd00::5", port:3 }), "http://[fd00::5]:3");
  assert.equal(browserUrl(null), "");
});

test("each system opens its default browser without a shell", async () => {
  const url = "http://localhost:3888";
  assert.deepEqual(browserCommand("darwin", url), ["open", [url]]);
  assert.deepEqual(browserCommand("win32", url), ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]);
  assert.deepEqual(browserCommand("linux", url), ["xdg-open", [url]]);
  const result = event => openBrowser(url, { platform:"linux", spawnImpl:() => {
    const child = new EventEmitter();
    setImmediate(() => child.emit(...event));
    return child;
  } });
  assert.equal(await result(["exit", 0]), true);
  assert.equal(await result(["exit", 3]), false);
  assert.equal(await result(["error", new Error("ENOENT")]), false);
});

test("Linux opens a browser only with a display", () => {
  const base = { platform:"linux", input:TTY, output:TTY };
  assert.equal(canOpenBrowser({ ...base, env:{} }), false);
  assert.equal(canOpenBrowser({ ...base, env:{ WAYLAND_DISPLAY:"wayland-0" } }), true);
});

test("--no-open is kept by a restart", () => {
  assert.equal(parseArgs([]).open, true);
  assert.deepEqual(buildRestartArgv(["--no-open"], parseArgs(["restart"]), 3888), ["--no-open", "--port", "3888"]);
});
