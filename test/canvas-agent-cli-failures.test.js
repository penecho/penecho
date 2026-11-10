"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

for (const providerName of ["claude-cli", "kimi-cli"]) {
  test(`${providerName} failures cannot become Harness answers or trigger JSON repair`, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-cli-failure-"));
    t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
    const executable = path.join(directory, "fake-cli.js"), counter = path.join(directory, "calls.txt");
    const answer = JSON.stringify({ type:"final", text:"This failed response must not be accepted" });
    const output = providerName === "claude-cli"
      ? JSON.stringify({ type:"result", subtype:"success", is_error:true, result:answer })
      : answer;
    fs.writeFileSync(executable, `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(counter)},'call\\n');process.stdout.write(${JSON.stringify(output + "\n")});process.exitCode=1;`);
    const { PenEchoCliAdapter } = await import("../src/server/canvas-agent/cli-adapter.mjs");
    const adapter = new PenEchoCliAdapter({ timeoutMs:() => 5000 });
    const provider = adapter.replaceConnections([{ id:providerName, provider:providerName, cliPath:executable, cliModel:"test", effort:"medium" }])[0];
    const chunks = [];
    await assert.rejects(async () => {
      for await (const chunk of adapter.stream({ provider, model:"test", sessionId:"failed-cli", messages:[], tools:[] })) chunks.push(chunk);
    }, error => /failed|error|exit(?:ed)? (?:with )?code/i.test(error.message) && !/invalid Harness decision/i.test(error.message));
    assert.deepEqual(chunks, [], "a failed CLI response must not create user-visible answers or tool calls");
    assert.equal(fs.readFileSync(counter, "utf8"), "call\n", "an upstream failure is not a model JSON-format mistake to repair");
  });
}
