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
  const source = "digraph G { Client -> API; }", html = runtime.documentFor({sourceFormat:"dot",source,title:"Client path"});
  assert.match(html, /@viz-js/);
  assert.ok(html.includes(Buffer.from(source,"utf8").toString("base64")));
  assert.match(html, /Client path/);
  assert.doesNotMatch(html, /mermaid@|renderMermaid/);
});

test("saved Mermaid sources render without reopening the new-diagram capability", () => {
  assert.equal(runtime.supports("mermaid"),false);
  assert.equal(runtime.normalizeFormat("mermaid"), "");
  const source = 'flowchart LR\nA[<script>bad()</script>] --> B',
    html=runtime.documentFor({sourceFormat:"mermaid",source,title:"Old <source>"});
  assert.match(html,/mermaid@10\.9\.1/);
  assert.match(html,/securityLevel:"strict"/);
  assert.match(html,/Old &lt;source&gt;/);
  assert.ok(html.includes(Buffer.from(source).toString("base64")));
  assert.doesNotMatch(html,/<script>bad\(\)<\/script>|rendering has been removed/);
  for (const source of ["", "   ", "x".repeat(100 * 1024 + 1), "图".repeat(35000)])
    assert.equal(runtime.documentFor({sourceFormat:"mermaid",source}), "");
});

test("legacy Mermaid paints SVG in the existing frame and reports renderer failure", async () => {
  const source = "sequenceDiagram\nAlice->>Bob: Hello", importUrl = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs",
    html = runtime.documentFor({sourceFormat:"mermaid",source,title:"Saved sequence"}),
    script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  for (const failure of [false, true]) {
    const classes = { toggle(){}, remove(){} }, svg = { style:{}, removeAttribute(){}, setAttribute(name,value){this[name]=value;} },
      stage = { innerHTML:"", querySelector:selector=>selector === "svg" && stage.innerHTML ? svg : null },
      status = { isConnected:true, hidden:false, classList:classes }, root = { classList:classes }, timers = new Set();
    let initialization, receivedSource, boundStage, loads=0;
    const mermaid = {
      initialize:options=>{initialization=options;},
      render:async (_id,value)=>{receivedSource=value;return { svg:'<svg viewBox="0 0 100 60"></svg>',bindFunctions:element=>{boundStage=element;} };},
    };
    const execute = new Function("document", "parent", "loadMermaid", "setTimeout", "clearTimeout", "ResizeObserver",
      script.replace(`import("${importUrl}")`, "loadMermaid()"));
    execute({querySelector:selector=>({"#diagram-stage":stage,"#diagram-status":status,".pd-root":root})[selector]},
      {postMessage(){}}, async ()=>{loads++;if(failure)throw Error("renderer unavailable");return {default:mermaid};},
      callback=>{timers.add(callback);return callback;}, timer=>timers.delete(timer), undefined);
    await new Promise(setImmediate);
    assert.equal(loads, 1);
    assert.equal(timers.size, 0);
    if (failure) {
      assert.equal(status.hidden, false);
      assert.match(status.textContent, /Mermaid could not be rendered.*renderer unavailable/);
    } else {
      assert.equal(initialization.securityLevel, "strict");
      assert.equal(initialization.startOnLoad, false);
      assert.equal(initialization.themeVariables.lineColor, "#64748b");
      assert.equal(receivedSource, source);
      assert.equal(boundStage, stage);
      assert.match(stage.innerHTML, /<svg/);
      assert.equal(svg.preserveAspectRatio, "xMidYMid meet");
      assert.equal(svg.style.width, "100%");
      assert.equal(svg.style.height, "100%");
      assert.equal(status.hidden, true);
    }
  }
});

test("each local format maps to one fixed on-demand renderer and unknown formats stay unsupported", () => {
  const expected = new Map([
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
  assert.ok(runtime.documentFor({ sourceFormat:"dot", source:"x".repeat(100 * 1024), title:"Large source" }));
  assert.equal(runtime.documentFor({ sourceFormat:"dot", source:"x".repeat(100 * 1024 + 1), title:"Too large" }), "");
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

test("every local renderer defaults its outer visualization surface to transparent", () => {
  const vegaDefault = runtime.vegaLiteSpecWithDefaultBackground({ mark:"bar" }),
    explicitVega = runtime.vegaLiteSpecWithDefaultBackground({ background:"#fff", mark:"bar" }),
    configuredVega = runtime.vegaLiteSpecWithDefaultBackground({ config:{ background:"black" }, mark:"bar" }),
    html = runtime.documentFor({ sourceFormat:"dot", source:"digraph G { A -> B; }", title:"Transparent" });
  assert.equal(vegaDefault.background, "transparent");
  assert.equal(explicitVega.background, "#fff");
  assert.equal(configuredVega.config.background, "black");
  assert.equal(Object.prototype.hasOwnProperty.call(configuredVega, "background"), false);
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

// Other Professional Diagram renderers keep the original single-document path.
test("professional runtime has no nested diagram viewer or retired native types", () => {
  for (const format of ["architecture", "sequence", "mermaid"]) assert.equal(runtime.supports(format), false);
  for (const format of runtime.FORMATS) {
    const html = runtime.documentFor({ sourceFormat:format.id, source:"source", title:"Retained renderer" });
    assert.doesNotMatch(html, /<iframe|archify|diagram-assets|renderMermaid/i);
  }
  const guidance = read("src/server/canvas-agent/visual-explorer-contract.md");
  assert.match(guidance, /Visual Explorer is the default route[\s\S]*architecture and sequence diagrams/);
});
