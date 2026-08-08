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
    assert.match(html, /is still loading[\s\S]*?could not be rendered/);
    assert.doesNotMatch(html, /rendering timed out/);
  }
  const geoJson = runtime.documentFor({ sourceFormat:"geojson", source:"{}", title:"Map" });
  assert.match(geoJson, /mt1\.google\.com[\s\S]*?is\.autonavi\.com/);
  assert.match(geoJson, /wgs84ToGcj02[\s\S]*?activateProvider/);
  assert.match(geoJson, /geoJson\.basemap === "none"/);
  assert.match(geoJson, /if \(noBasemap\) \{[\s\S]*?stage\.style\.background = "transparent";[\s\S]*?notify\(\);[\s\S]*?\} else activateProvider\(0\)/);
  assert.match(geoJson, /\.pd-status\[hidden\]\{display:none\}/);
  assert.match(geoJson, /render\(\)\.then\(\(\) => \{[\s\S]*?finish\(\);/);
  assert.match(geoJson, /\.pd-stage>canvas\{/);
  assert.doesNotMatch(geoJson, /\.pd-stage canvas\{/);
  const smiles = runtime.documentFor({ sourceFormat:"smiles", source:"CC(=O)Oc1ccccc1C(=O)O", title:"Aspirin" });
  assert.match(smiles, /new globalThis\.SmilesDrawer\.SvgDrawer/);
  assert.match(smiles, /SmilesDrawer\.parse\(source\.trim\(\),\s*resolve,\s*reject\)/);
  assert.match(smiles, /compactDrawing:config\.compactDrawing===true/);
  assert.match(smiles, /"compactDrawing":false/);
  assert.match(smiles, /\.draw\(tree,svg,"light",null,false,\[\]\)/);
  assert.match(smiles, /preserveAspectRatio","xMidYMid meet"/);
  assert.doesNotMatch(smiles, /new globalThis\.SmilesDrawer\.Drawer|createElement\("canvas"\)|resizeRender\s*=\s*draw/);
  const compactSmiles = runtime.documentFor({ sourceFormat:"smiles", source:"CC(=O)Oc1ccccc1C(=O)O", title:"Compact aspirin", diagramKind:"molecular-structure-compact" });
  assert.match(compactSmiles, /"compactDrawing":true/);
  assert.equal(runtime.documentFor({ sourceFormat:"plantuml", source:"@startuml", title:"Unsupported" }), "");
  assert.ok(runtime.documentFor({ sourceFormat:"mermaid", source:"x".repeat(100 * 1024), title:"Large source" }));
  assert.equal(runtime.documentFor({ sourceFormat:"mermaid", source:"x".repeat(100 * 1024 + 1), title:"Too large" }), "");
});

test("complex Mermaid phases reflow when the widget aspect ratio changes", () => {
  const source = `%% penecho:responsive
flowchart LR
  subgraph Shop
    direction TB
    A --> B --> C --> D
  end
  subgraph Pay
    direction TB
    E --> F --> G --> H
  end
  subgraph Fulfill
    direction TB
    I --> J --> K --> L
  end
  D --> E
  H --> I`,
    wide = runtime.responsiveMermaidSource(source, 1400, 700),
    narrow = runtime.responsiveMermaidSource(source, 600, 1000);
  assert.equal(wide.direction, "LR");
  assert.equal(wide.responsive, true);
  assert.match(wide.source, /^flowchart LR/m);
  assert.equal((wide.source.match(/direction TB/g) || []).length, 3);
  assert.equal(narrow.direction, "TB");
  assert.equal(narrow.responsive, true);
  assert.match(narrow.source, /^flowchart TB/m);
  assert.equal((narrow.source.match(/direction LR/g) || []).length, 3);
});

test("complex Graphviz diagrams provide horizontal and vertical layouts for the widget shape", () => {
  const source = `digraph Transformer {
  graph [rankdir=LR, bgcolor="transparent"];
  subgraph cluster_encoder { a -> b -> c -> d -> e -> f; }
  subgraph cluster_decoder { g -> h -> i -> j -> k -> l; }
  a -> g; b -> h; c -> i;
}`,
    wide = runtime.responsiveDotSource(source, 1600, 700),
    compact = runtime.responsiveDotSource(source, 1200, 1050);
  assert.equal(wide.responsive, true);
  assert.equal(wide.direction, "LR");
  assert.match(wide.source, /rankdir=LR/);
  assert.equal(compact.direction, "TB");
  assert.match(compact.source, /rankdir=TB/);

  const inserted = runtime.responsiveDotSource(`// penecho:responsive\ndigraph G { a -> b; }`, 500, 900);
  assert.equal(inserted.direction, "TB");
  assert.match(inserted.source, /\{\n  graph \[rankdir=TB\];/);
  assert.match(inserted.source, /graph \[bgcolor="transparent"\]/);

  const quoted = runtime.responsiveDotSource(`// penecho:responsive\ndigraph G { graph [rankdir="LR"]; a -> b; }`, 500, 900);
  assert.match(quoted.source, /rankdir="TB"/);

  const fixed = runtime.responsiveDotSource(`// penecho:fixed-layout\ndigraph G { graph [rankdir=LR]; a -> b; }`, 500, 900);
  assert.equal(fixed.responsive, false);
  assert.equal(fixed.source.includes("rankdir=LR"), true);
  assert.match(fixed.source, /graph \[bgcolor="transparent"\]/);

  const explicitBackground = runtime.responsiveDotSource(`digraph G { graph [bgcolor="#f5f5f5"]; a -> b; }`, 800, 600);
  assert.match(explicitBackground.source, /bgcolor="#f5f5f5"/);
  assert.doesNotMatch(explicitBackground.source, /bgcolor="transparent"/);

  const clusterBackgroundOnly = runtime.responsiveDotSource(`digraph G { subgraph cluster_a { bgcolor="#f5f5f5"; a -> b; } }`, 800, 600);
  assert.match(clusterBackgroundOnly.source, /graph \[bgcolor="transparent"\]/);
});

test("Graphviz renderer selects the layout with the largest readable fit on resize", () => {
  const html = runtime.documentFor({ sourceFormat:"dot", source:"digraph G { a -> b; }", title:"Graph" });
  assert.match(html, /responsiveDotSource/);
  assert.match(html, /Math\.min\(width \/ layout\.intrinsicWidth, height \/ layout\.intrinsicHeight\)/);
  assert.match(html, /resizeRender = paint/);
});

test("responsive Mermaid reflows one rendered diagram as the widget changes shape", () => {
  const html = runtime.documentFor({ sourceFormat:"mermaid", source:"%% penecho:responsive\nflowchart LR\nA-->B", title:"Flow" });
  assert.match(html, /flowchart:\{ defaultRenderer:"elk" \}/);
  assert.match(html, /responsiveMermaidSource\(source, stage\.clientWidth, stage\.clientHeight\)/);
  assert.match(html, /renderedDirection = next\.direction/);
  assert.match(html, /resizeRender = \(\) => void paint\(\)\.catch/);
});

test("every local renderer defaults its outer visualization surface to transparent", () => {
  const vegaDefault = runtime.vegaLiteSpecWithDefaultBackground({ mark:"bar" }),
    explicitVega = runtime.vegaLiteSpecWithDefaultBackground({ background:"#fff", mark:"bar" }),
    configuredVega = runtime.vegaLiteSpecWithDefaultBackground({ config:{ background:"black" }, mark:"bar" }),
    html = runtime.documentFor({ sourceFormat:"mermaid", source:"flowchart LR\nA-->B", title:"Transparent" });
  assert.equal(vegaDefault.background, "transparent");
  assert.equal(explicitVega.background, "#fff");
  assert.equal(configuredVega.config.background, "black");
  assert.equal(Object.prototype.hasOwnProperty.call(configuredVega, "background"), false);
  assert.match(html, /themeVariables:\{ background:"transparent" \}/);
  assert.match(html, /svg\.style\.background="transparent"/);
  assert.match(html, /stage\.style\.background = "transparent"/);
  assert.match(html, /\.pd-stage\{[^}]*background:transparent/);
  assert.match(html, /vegaLiteSpecWithDefaultBackground\(parseJson\(\)\)/);
});

test("diagram source is persisted canonically and regenerated through the widget iframe", () => {
  const canvas = read("src/client/app/canvas-runtime.js"),
    core = read("src/client/app/core.js"),
    persistence = read("src/client/app/persistence.js"),
    build = read("scripts/build-client.js"),
    packageJson = JSON.parse(read("package.json"));
  assert.match(canvas, /widgetType === "diagram_source" \? \{ source:widget\.source \} : \{ html:widget\.html \}/);
  assert.match(canvas, /runtime\?\.documentFor\(\{ sourceFormat:normalizedSourceFormat, source, title:item\.title, diagramKind:item\.diagramKind \}\)/);
  assert.match(canvas, /copyText: widgetType === "diagram_source" \? source/);
  assert.match(persistence, /widgetType:widget\.widgetType[\s\S]*?widget\.widgetType === "diagram_source" \? \{ source:widget\.source \} : \{ html:widget\.html \}/);
  assert.match(core, /script\.src = "plugins\/flowchart\/runtime\.js"/);
  assert.match(core, /MAX_DIAGRAM_SOURCE_BYTES = 100 \* 1024/);
  assert.equal((canvas.match(/documentFor\(\{ sourceFormat:[^}]+diagramKind:/g) || []).length,2);
  assert.doesNotMatch(build, /diagram-runtime/);
  assert.doesNotMatch(read("public/app.js"), /mermaid@10\.9\.1|@viz-js\/viz@3\.9\.0|bpmn-js@17\.11\.1/);
  assert.ok(packageJson.files.includes(runtimePath));
});

module.exports = runtime;
