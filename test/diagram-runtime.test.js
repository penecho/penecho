"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const runtimePath = "public/plugins/flowchart/runtime.js",
  runtime = require(path.join(ROOT, runtimePath));
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("diagram runtime exposes the exact source-first capability registry", () => {
  assert.deepEqual(runtime.FORMATS.map((format) => format.id), [
    "mermaid",
    "dot",
    "bpmn-xml",
    "vega-lite",
    "geojson",
    "smiles",
    "cytoscape-json",
  ]);
  assert.equal(runtime.normalizeFormat("Graphviz DOT"), "dot");
  assert.equal(runtime.normalizeFormat("BPMN"), "bpmn-xml");
  assert.equal(runtime.normalizeFormat("PlantUML"), "");
});

test("diagram runtime generates an isolated lazy renderer document", () => {
  const source = "flowchart LR\nA[Client] --> B[API]",
    html = runtime.documentFor({ sourceFormat:"mermaid", source, title:"Client path" });
  assert.match(html, /mermaid@10\.9\.1/);
  assert.equal(html.split("flowchart LR").length, 1);
  assert.match(html, new RegExp(Buffer.from(source, "utf8").toString("base64")));
  assert.match(html, /Client path/);
  assert.match(html, /if \(format === "mermaid"\) await renderMermaid\(\)[\s\S]*?else if \(format === "dot"\)/);
});

test("each local format maps to one fixed on-demand renderer and unknown formats stay unsupported", () => {
  const expected = new Map([
    ["mermaid", "mermaid@10.9.1"],
    ["dot", "@viz-js/viz@3.9.0"],
    ["bpmn-xml", "bpmn-js@17.11.1"],
    ["vega-lite", "vega-embed@6.26.0"],
    ["geojson", "leaflet@1.9.4"],
    ["smiles", "smiles-drawer@2.1.7"],
    ["cytoscape-json", "cytoscape@3.30.4"],
  ]);
  for (const [format, marker] of expected) {
    const html = runtime.documentFor({ sourceFormat:format, source:format.endsWith("json") || format === "geojson" || format === "vega-lite" ? "{}" : "source", title:format });
    assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), format);
    assert.match(html, /rendering timed out[\s\S]*?could not be rendered/);
  }
  assert.equal(runtime.documentFor({ sourceFormat:"plantuml", source:"@startuml", title:"Unsupported" }), "");
  assert.equal(runtime.documentFor({ sourceFormat:"mermaid", source:"x".repeat(20001), title:"Too large" }), "");
});

test("diagram source is persisted canonically and regenerated through the widget iframe", () => {
  const canvas = read("src/client/app/canvas-runtime.js"),
    core = read("src/client/app/core.js"),
    persistence = read("src/client/app/persistence.js"),
    build = read("scripts/build-client.js"),
    packageJson = JSON.parse(read("package.json"));
  assert.match(canvas, /widgetType === "diagram_source" \? \{ source:widget\.source \} : \{ html:widget\.html \}/);
  assert.match(canvas, /runtime\?\.documentFor\(\{ sourceFormat:normalizedSourceFormat, source, title:item\.title \}\)/);
  assert.match(canvas, /copyText: widgetType === "diagram_source" \? source/);
  assert.match(persistence, /widgetType:widget\.widgetType[\s\S]*?widget\.widgetType === "diagram_source" \? \{ source:widget\.source \} : \{ html:widget\.html \}/);
  assert.match(core, /script\.src = "plugins\/flowchart\/runtime\.js"/);
  assert.doesNotMatch(build, /diagram-runtime/);
  assert.doesNotMatch(read("public/app.js"), /mermaid@10\.9\.1|@viz-js\/viz@3\.9\.0|bpmn-js@17\.11\.1/);
  assert.ok(packageJson.files.includes(runtimePath));
});

module.exports = runtime;
