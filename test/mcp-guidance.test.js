"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { test } = require("node:test");
const { GUIDANCE_IDS, getAuthoringGuidance } = require("../src/server/mcp/authoring-guidance.js");
const { TOOLS, validateToolArguments } = require("../src/server/mcp/schema.js");
const { PenEchoStdioServer, INSTRUCTIONS } = require("../src/server/mcp/stdio.js");

const read = file => fs.readFileSync(path.join(__dirname, "../src/server/canvas-agent", file), "utf8");

test("shared guidance preserves the complete authoritative design and scientific documents", () => {
  const contract = read("visual-explorer-contract.md");
  const body = contract.slice(contract.indexOf("Do not start from visual decoration."), contract.indexOf("## PenEcho Agent source and invocation"));
  assert.ok(getAuthoringGuidance("visual-explorer","full").document.includes(body));
  for (const id of ["math-2d", "physics-2d", "math-3d"]) {
    assert.equal(getAuthoringGuidance(id,"full").document, read(`visual-skills/${id}.md`));
  }
  for (const id of GUIDANCE_IDS) {
    const result = getAuthoringGuidance(id,"full");
    assert.equal(result.id, id);
    assert.equal(result.hash, crypto.createHash("sha256").update(result.document).digest("hex"));
    assert.equal(getAuthoringGuidance(id,"full"), result);
    assert.doesNotMatch(result.document, /canvas_create|load_visual_skill|plannedWidget|professional.diagram|private.plugin/i);
  }
  assert.throws(() => getAuthoringGuidance("../private","full"), RangeError);
});

test("default and explicit brief deliver the complete Visual Explorer contract through Agent and MCP", async () => {
  const { createDocumentTools } = await import("../src/server/canvas-agent/document-tools.mjs");
  const agent = createDocumentTools({id:"guidance-quality-test"}).find(tool => tool.name === "penecho_get_guidance");
  const messages = [];
  const server = new PenEchoStdioServer({output:{write:text => messages.push(JSON.parse(text))}});
  server.records = () => { throw new Error("guidance must not discover a Canvas"); };
  await server.handle({jsonrpc:"2.0",id:1,method:"initialize",params:{}});
  const full = getAuthoringGuidance("visual-explorer", "full");
  for (const args of [{id:"visual-explorer"}, {id:"visual-explorer",detail:"brief"}]) {
    const direct = getAuthoringGuidance(args.id, args.detail);
    const actualAgent = await agent.execute(args, {});
    await server.handle({jsonrpc:"2.0",id:messages.length+1,method:"tools/call",params:{name:"penecho_get_guidance",arguments:args}});
    const actualMcp = messages.at(-1).result.structuredContent;
    for (const result of [direct, actualAgent, actualMcp]) {
      assert.equal(result.document, full.document);
      assert.equal(result.hash, full.hash);
      assert.doesNotMatch(result.document, /ordinary HTML\/SVG explanations can proceed from this brief/);
    }
  }
});

test("general HTML retains canonical runtime safety and authoring rules", () => {
  const contract = read("general-html-contract.md");
  const general = getAuthoringGuidance("general-html","full").document;
  const runtime = contract.slice(contract.indexOf("## Runtime safety"), contract.indexOf("## Refinement")).trim();
  assert.ok(general.includes(runtime));
  assert.match(general, /The visible Widget must answer visually/);
  assert.match(general, /Treat the Canvas as an existing document/);
  assert.match(general, /Content Security Policy remain authoritative/);
  assert.match(general, /SOURCE_CONFLICT/);
  assert.doesNotMatch(general, /canvas_inspect|canvas_patch_widget|sourceHash|afterWindows/);
});

test("routing keeps page UI separate and default guidance compact", () => {
  assert.match(getAuthoringGuidance("general-html","full").document, /new page does not automatically use Visual Explorer/);
  assert.match(getAuthoringGuidance("visual-explorer","full").document, /Bare function graphs use penecho_plot/);
  assert.match(INSTRUCTIONS, /penecho_get_guidance/);
  assert.ok(INSTRUCTIONS.length < 5000);
  assert.doesNotMatch(INSTRUCTIONS, /## 1. Information Architecture|Verified Manim-Web/);
});

test("guidance is discoverable and validates strict arguments without changing old tool contracts", () => {
  const tool = TOOLS.find(tool => tool.name === "penecho_get_guidance");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(tool.inputSchema.properties.id.enum, GUIDANCE_IDS);
  for (const id of GUIDANCE_IDS) assert.deepEqual(validateToolArguments(tool.name, {id}), {id});
  for (const args of [{}, {id:"private"}, {id:"visual-explorer",sessionId:"x"}]) {
    assert.throws(() => validateToolArguments(tool.name, args), {code:"invalid_arguments"});
  }
  assert.deepEqual(validateToolArguments("penecho_list_canvases", {}), {});
});

test("stdio returns guidance and legacy prompt without discovery or a live instance", async () => {
  const messages = [];
  const server = new PenEchoStdioServer({output:{write:text => messages.push(JSON.parse(text))}});
  server.records = () => { throw new Error("must not discover instances"); };
  const call = async (method, params) => {
    await server.handle({jsonrpc:"2.0",id:messages.length + 1,method,params});
    return messages.at(-1);
  };
  await call("initialize", {});
  const listed = await call("tools/list", {});
  assert.ok(listed.result.tools.some(tool => tool.name === "penecho_get_guidance"));
  for (const id of GUIDANCE_IDS) {
    const response = await call("tools/call", {name:"penecho_get_guidance",arguments:{id,detail:"full"}});
    assert.deepEqual(response.result.structuredContent, getAuthoringGuidance(id,"full"));
  }
  const invalid = await call("tools/call", {name:"penecho_get_guidance",arguments:{id:"private"}});
  assert.equal(invalid.result.isError, true);
  assert.equal(invalid.result.structuredContent.code, "invalid_arguments");
  const prompt = await call("prompts/get", {name:"penecho_visual_explorer",arguments:{}});
  assert.ok(prompt.result.messages[0].content.text.includes(getAuthoringGuidance("visual-explorer","full").document));
  assert.equal(server.pending.size, 0);
});

test('live workspace guidance uses direct HTTP and persistent conversation recovery', () => {
  const {WORKSPACE_INSTRUCTIONS,VISUAL_INSTRUCTIONS}=require('../src/server/mcp/guidance.js');
  assert.match(WORKSPACE_INSTRUCTIONS,/omit instanceId\/canvasId/);
  assert.match(WORKSPACE_INSTRUCTIONS,/client\/sessionKey/);
  assert.match(WORKSPACE_INSTRUCTIONS,/only DOCUMENT_NOT_FOUND permits replacement/);
  assert.match(WORKSPACE_INSTRUCTIONS,/Permission\/storage errors remain errors/);
  assert.match(WORKSPACE_INSTRUCTIONS,/one-shot discovery/);
  assert.match(WORKSPACE_INSTRUCTIONS,/Relaunch belongs to the AI host and must be verified/);
  assert.match(WORKSPACE_INSTRUCTIONS,/fresh process must start_session/);
  assert.doesNotMatch(WORKSPACE_INSTRUCTIONS,/16 host LAN leases|suspend after 60 seconds|probe \/pair/);
  assert.match(VISUAL_INSTRUCTIONS,/Default\/page takes its aspect ratio/);
  assert.doesNotMatch(VISUAL_INSTRUCTIONS,/Choose page \(1200×800\)/);
});

test("HTML guidance establishes responsive viewport sizing without a planning round trip", () => {
  for (const id of ["general-html", "visual-explorer"]) {
    const document = getAuthoringGuidance(id,"full").document;
    for (const expected of [/available unobscured viewport/, /Default\/page sizing takes its aspect ratio/, /capped independently/, /width:100% and min-width:0/, /media or container queries/, /readable normal CSS font sizes/, /vertical scrolling/, /whole-page transform\/zoom/, /Source updates preserve existing artifact geometry/, /intent:inspect renders the exact requested viewport/]) assert.match(document, expected);
  }
  const tool = TOOLS.find(tool => tool.name === "penecho_present_widget");
  assert.match(tool.description, /returned viewport is actual CSS size/);
  assert.match(tool.inputSchema.properties.width.description, /CSS width: capped/);
  assert.match(tool.inputSchema.properties.height.description, /independently capped/);
});

test("live and tool instructions agree on viewport-first delivery and exact inspect", () => {
  const {VISUAL_INSTRUCTIONS,VISUAL_TOOL_INSTRUCTIONS,MCP_PRESENTATION_INSTRUCTIONS}=require('../src/server/mcp/guidance.js');
  for (const instructions of [VISUAL_INSTRUCTIONS,VISUAL_TOOL_INSTRUCTIONS,MCP_PRESENTATION_INSTRUCTIONS]) {
    assert.match(instructions, /available unobscured viewport/);
    assert.match(instructions, /capped independently/);
    assert.match(instructions, /intent:inspect keeps the exact requested viewport and creates no Canvas object/);
    assert.match(instructions, /Source updates preserve existing artifact geometry/);
  }
  assert.match(MCP_PRESENTATION_INSTRUCTIONS, /page requests 1200×800 for inspect/);
});


test("rendering guidance separates Canvas delivery, chat source, and explicit implementation bans", async () => {
  const { CANVAS_RENDERING_ROUTING } = require("../src/server/mcp/authoring-guidance.js");
  const { DOCUMENT_TOOL_INSTRUCTIONS } = await import("../src/server/canvas-agent/document-tools.mjs");
  for (const document of [DOCUMENT_TOOL_INSTRUCTIONS, getAuthoringGuidance("visual-explorer").document, getAuthoringGuidance("visual-explorer", "full").document]) {
    assert.ok(document.includes(CANVAS_RENDERING_ROUTING));
    assert.match(document, /a diagram type or chat source language alone does not select HTML/);
    assert.match(document, /select the Canvas representation by the task/);
    assert.match(document, /edit existing objects in their current form/);
    assert.match(document, /first create a small coherent usable version/);
    assert.match(document, /remaining requested content must still be completed/);
    assert.match(document, /both a rendered Canvas diagram and Mermaid\/PlantUML chat source/);
    assert.match(document, /Source-only requests do not require a Canvas artifact/);
    assert.match(document, /Respect an explicit ban on using HTML\/Widgets for implementation/);
  }
  assert.match(TOOLS.find(tool => tool.name === "penecho_present_widget").description, /including static diagrams/);
  assert.match(TOOLS.find(tool => tool.name === "penecho_draw").description, /few simple native.*explicitly requested native/);
});


test("Agent and MCP use the canonical 1.2.0 Visual Explorer selection conditions", async () => {
  const { VISUAL_EXPLORER_SELECTION, CANVAS_RENDERING_ROUTING, ROUTING } = require("../src/server/mcp/authoring-guidance.js");
  const { DOCUMENT_TOOL_INSTRUCTIONS } = await import("../src/server/canvas-agent/document-tools.mjs");
  const paragraph = read("visual-explorer-contract.md").split(/\r?\n\r?\n/).find(text => text.startsWith("Visual Explorer is the default route"));
  assert.equal(VISUAL_EXPLORER_SELECTION, paragraph.replace('host-native `canvas_create` `type:"plot"`', '`penecho_plot`'));
  for (const document of [ROUTING, CANVAS_RENDERING_ROUTING, DOCUMENT_TOOL_INSTRUCTIONS, getAuthoringGuidance("visual-explorer").document]) {
    assert.ok(document.includes(VISUAL_EXPLORER_SELECTION));
    assert.match(document, /even when the user does not explicitly ask for an infographic/);
    assert.match(document, /substantial pasted text, equations to explain, project explanations \(including architecture and sequence diagrams\), document analysis, study material, structured summaries/);
    assert.match(document, /Do not select it when the primary task is merely to supplement or modify existing Canvas/);
  }
});
