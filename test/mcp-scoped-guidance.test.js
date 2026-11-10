"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { GUIDANCE_IDS, VISUAL_RULES, getAuthoringGuidance } = require("../src/server/mcp/authoring-guidance.js");

test("scoped rule discovery loads metadata without reading rule bodies", () => {
  const output = execFileSync(process.execPath, ["-e", `
    const fs = require('node:fs');
    const original = fs.readFileSync;
    const reads = [];
    fs.readFileSync = function(file, ...args) {
      if (/visual-rules[\\\\/](architecture|sequence|workflow)\\.md$/.test(String(file))) reads.push(String(file));
      return original.call(this, file, ...args);
    };
    const g = require('./src/server/mcp/authoring-guidance.js');
    const before = {};
    for (const id of g.GUIDANCE_IDS.filter(id => !g.VISUAL_RULES[id])) before[id] = g.getAuthoringGuidance(id, 'full');
    if (reads.length) throw Error('A base or unrelated guide read the architecture body');
    const rule = g.getAuthoringGuidance('architecture');
    if (reads.length !== 1) throw Error('Explicit rule read must load one body');
    const full = g.getAuthoringGuidance('architecture', 'full');
    if (reads.length !== 1 || full.document !== rule.document || full.hash !== rule.hash) throw Error('Brief/full rule identity drift');
    const sequence = g.getAuthoringGuidance('sequence');
    if (reads.length !== 2 || g.getAuthoringGuidance('sequence', 'full').hash !== sequence.hash || reads.length !== 2) throw Error('Sequence must load separately exactly once');
    const workflow = g.getAuthoringGuidance('workflow');
    if (reads.length !== 3 || g.getAuthoringGuidance('workflow', 'full').hash !== workflow.hash || reads.length !== 3) throw Error('Workflow must load separately exactly once');
    for (const id of Object.keys(before)) {
      if (g.getAuthoringGuidance(id, 'full') !== before[id]) throw Error('Loading a rule mutated an unrelated guide');
    }
    process.stdout.write('isolated');
  `], { cwd:path.join(__dirname, ".."), encoding:"utf8" });
  assert.equal(output, "isolated");
});

test("each registered rule is independently addressable and scoped without scientific runtime activation", () => {
  for (const [id, metadata] of Object.entries(VISUAL_RULES)) {
    assert.ok(GUIDANCE_IDS.includes(id));
    const rule = getAuthoringGuidance(id);
    assert.equal(rule.kind, "visual-rule");
    assert.equal(rule.base, metadata.base);
    assert.equal(rule.scope, metadata.scope);
    assert.equal(rule.document, fs.readFileSync(path.join(__dirname, "../src/server/canvas-agent/visual-rules", `${id}.md`), "utf8"));
    assert.ok(!getAuthoringGuidance("visual-explorer").document.includes(rule.document));
    assert.doesNotMatch(rule.document, /penecho-visual-skill|manim-web/);
  }
  for (const id of ["../architecture", "architecture/../general-html", "unknown-rule", "gantt", "ppt"]) {
    assert.throws(() => getAuthoringGuidance(id), RangeError);
  }
});

test("Agent, stdio and HTTP RPC return the same diagram rules without Canvas or model side effects", async () => {
  const { createDocumentTools } = await import("../src/server/canvas-agent/document-tools.mjs");
  const { PenEchoStdioServer } = require("../src/server/mcp/stdio.js");
  const { createMcpRpc } = require("../src/server/mcp/rpc.js");
  const fail = () => { throw Error("Guidance must not use a Canvas or execute a model"); };
  const agent = createDocumentTools({id:"scoped-rule-test",rpc:fail}).find(tool => tool.name === "penecho_get_guidance");
  const messages = [];
  const server = new PenEchoStdioServer({output:{write:text => messages.push(JSON.parse(text))}});
  server.records = fail;
  await server.handle({jsonrpc:"2.0",id:1,method:"initialize",params:{}});
  const rpc = createMcpRpc({callTool:fail,toolFailure:error => ({message:error.message})});
  for (const args of ["architecture","sequence","workflow"].flatMap(id => [{id},{id,detail:"brief"},{id,detail:"full"}])) {
    const request = {jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"penecho_get_guidance",arguments:args}};
    const expected = getAuthoringGuidance(args.id,args.detail);
    assert.deepEqual(await agent.execute(args, {}), expected);
    assert.deepEqual((await rpc(request,{ownerId:"test"})).result.structuredContent, expected);
    await server.handle(request);
    assert.deepEqual(messages.at(-1).result.structuredContent, expected);
  }
});
