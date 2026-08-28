"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Writable } = require("node:stream");
const { EventEmitter } = require("node:events");
const {
  UPDATE_CHECK_TIMEOUT_MS,
  compareVersions,
  fetchLatestNpmVersion,
  maybeUpdateOnStart,
  runNpmGlobalUpdate,
  updateCheckAllowed,
} = require("../src/cli/update.js");

function capture() {
  let value = "";
  return {
    stream:new Writable({ write(chunk, _encoding, callback) { value += chunk.toString("utf8"); callback(); } }),
    text:() => value,
  };
}

test("semantic version comparison handles stable and prerelease npm versions", () => {
  assert.equal(UPDATE_CHECK_TIMEOUT_MS, 30000);
  assert.equal(compareVersions("0.5.2", "0.5.1"), 1);
  assert.equal(compareVersions("0.5.1", "0.5.1"), 0);
  assert.equal(compareVersions("0.5.0", "0.5.1"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  assert.throws(() => compareVersions("latest", "0.5.1"), /invalid npm version/);
});

test("npm latest-version lookup uses the registry latest endpoint and validates its response", async () => {
  const calls = [];
  const latest = await fetchLatestNpmVersion("penecho", {
    timeoutMs:1000,
    fetchImpl:async (url, options) => {
      calls.push({ url, options });
      return { ok:true, status:200, json:async () => ({ version:"0.6.0" }) };
    },
  });
  assert.equal(latest, "0.6.0");
  assert.equal(calls[0].url, "https://registry.npmjs.org/penecho/latest");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers["User-Agent"], "penecho/1.1.7");
  await assert.rejects(
    fetchLatestNpmVersion("penecho", { timeoutMs:1000, attempts:1, fetchImpl:async () => ({ ok:true, status:200, json:async () => ({ version:"invalid" }) }) }),
    /invalid PenEcho version/,
  );
});

test("npm latest-version lookup retries one transient failure", async () => {
  let calls = 0;
  const latest = await fetchLatestNpmVersion("penecho", {
    timeoutMs:1000,
    retryDelayMs:1,
    fetchImpl:async () => {
      calls++;
      if (calls === 1) throw new Error("temporary DNS failure");
      return { ok:true, status:200, json:async () => ({ version:"0.7.1" }) };
    },
  });
  assert.equal(latest, "0.7.1");
  assert.equal(calls, 2);
});

test("update checks run for interactive starts but skip noninteractive and explicitly disabled checks", () => {
  const interactive = { ui:{ interactive:true }, env:{}, packageRoot:process.cwd() };
  assert.equal(updateCheckAllowed({ output:capture().stream, input:{ isTTY:false }, env:{} }), false);
  assert.equal(updateCheckAllowed(interactive), true);
  assert.equal(updateCheckAllowed({ ...interactive, env:{ PENECHO_SKIP_UPDATE_CHECK:"1" } }), false);
});

test("an up-to-date check visibly reports the current version", async () => {
  const output = capture();
  const result = await maybeUpdateOnStart([], {
    ui:{ interactive:true },
    output:output.stream,
    errorOutput:capture().stream,
    updateChecker:async () => "0.0.0",
  });
  assert.equal(result.checked, true);
  assert.match(output.text(), /Checking latest PenEcho version/);
  assert.match(output.text(), /is the latest version/);
});

test("available updates default to yes, install globally, stop the service, and require a manual start", async () => {
  const output = capture(), errors = capture(), events = [];
  const result = await maybeUpdateOnStart([], {
    ui:{ interactive:true, confirm:async (_message, fallback) => fallback },
    output:output.stream,
    errorOutput:errors.stream,
    forceUpdateCheck:true,
    updateChecker:async () => { events.push("check"); return "99.0.0"; },
    updateInstaller:async version => { events.push(`install:${version}`); return true; },
    updateFinalizer:async () => { events.push("stop"); },
  });
  assert.equal(result.updated, true);
  assert.equal(result.restarted, false);
  assert.deepEqual(events, ["check", "install:99.0.0", "stop"]);
  assert.match(output.text(), /Checking latest PenEcho version/);
  assert.match(output.text(), /newer PenEcho version.*v99\.0\.0/i);
  assert.match(output.text(), /Updating PenEcho/);
  assert.match(output.text(), /installed successfully/);
  assert.match(output.text(), /Run `penecho` again/);
  assert.doesNotMatch(output.text(), /Restarting/);
  assert.equal(errors.text(), "");
});


test("Windows global updates launch the npm cmd shim through the command processor", async () => {
  const calls = [], commandProcessor = "C:\\Windows\\System32\\cmd.exe";
  const installChild = new EventEmitter();
  const installing = runNpmGlobalUpdate("9.8.7", {
    platform:"win32",
    env:{ ComSpec:commandProcessor },
    spawnImpl:(command, args, options) => {
      calls.push({ command, args, options });
      process.nextTick(() => installChild.emit("close", 0));
      return installChild;
    },
  });
  assert.equal(await installing, true);
  assert.equal(calls[0].command, commandProcessor);
  assert.deepEqual(calls[0].args, ["/d", "/s", "/c", "npm.cmd", "install", "--global", "penecho@9.8.7"]);
  assert.equal(calls[0].options.shell, false);

});

test("declining or failing an update keeps the current service running", async () => {
  let installed = false;
  const declinedOutput = capture();
  const declined = await maybeUpdateOnStart([], {
    ui:{ interactive:true, confirm:async () => false },
    output:declinedOutput.stream,
    errorOutput:capture().stream,
    forceUpdateCheck:true,
    updateChecker:async () => "99.0.0",
    updateInstaller:async () => { installed = true; return true; },
  });
  assert.equal(declined.restarted, false);
  assert.equal(installed, false);
  assert.match(declinedOutput.text(), /Continuing with PenEcho/);

  const failedErrors = capture();
  const failed = await maybeUpdateOnStart([], {
    ui:{ interactive:true, confirm:async () => true },
    output:capture().stream,
    errorOutput:failedErrors.stream,
    forceUpdateCheck:true,
    updateChecker:async () => "99.0.0",
    updateInstaller:async () => false,
  });
  assert.equal(failed.restarted, false);
  assert.match(failedErrors.text(), /update manually/);
});

test("offline or invalid update checks never block startup", async () => {
  const output = capture();
  const result = await maybeUpdateOnStart([], {
    ui:{ interactive:true },
    output:output.stream,
    errorOutput:capture().stream,
    updateChecker:async () => { throw new Error("offline"); },
  });
  assert.deepEqual(result, { checked:false, restarted:false });
  assert.match(output.text(), /Checking latest PenEcho version/);
  assert.match(output.text(), /check unavailable/);
  assert.match(output.text(), /offline/);
});
