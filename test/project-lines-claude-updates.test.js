"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseLine } = require("../src/server/project-lines/activity.js");

const line = (o) => JSON.stringify({ type:"assistant", message:{ role:"assistant", content:[{ type:"thinking", thinking:"Profiling the rebuild now.\n\n", signature:"x" }, { type:"tool_use", id:"t1", name:"Bash", input:{ command:"ls" } }] }, ...o });

test("Claude progress updates written as thinking show as what it said, not as its answer", () => {
  for (const key of ["thinkingDisplay", "thinking_display"]) {
    const changes = parseLine(line({ [key]:"updates" }));
    assert.deepEqual(changes[0], { add:{ kind:"say", text:"Profiling the rebuild now." } });
    assert.equal(changes.some(c => c.said), false);
    assert.equal(changes[1].add.verb, "Ran");
  }
});

test("Thinking in any other display stays hidden", () => {
  for (const o of [{}, { thinkingDisplay:"summarized" }]) assert.equal(parseLine(line(o)).some(c => c.add?.kind === "say"), false);
});

test("Claude thinking between steps says so, without adding a row", () => {
  assert.deepEqual(parseLine(JSON.stringify({ type:"system", subtype:"thinking_tokens", estimated_tokens:200, estimated_tokens_delta:150 })), [{ now:"Thinking" }]);
});
