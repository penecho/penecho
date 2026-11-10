"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), {execFileSync} = require("node:child_process");
const prompt = require("../src/server/canvas-command-prompt.js"), source = fs.readFileSync(path.join(__dirname,"../src/server/main.js"),"utf8");

test("the exported command policies equal the actual local server policies for every mode", () => {
  const scope = { fs, path, __dirname:path.join(__dirname,"../src/server"), NORMALIZE_TYPESET_POLICY:require("../src/server/typeset.js").NORMALIZE_TYPESET_POLICY };
  const constants = ["MODEL_FINAL_JSON_TARGET_TOKENS","MODEL_REASONING_BUDGET_FRACTION"].map(name=>source.match(new RegExp(`const ${name} = [^\\n]+`))[0]).join("\n"),
    block = source.slice(source.indexOf("const SYSTEM_PROMPT = `"),source.indexOf("const THEME_PERSONAS = {"));
  vm.runInNewContext(constants+"\n"+block+"\nthis.local={activeSystemPrompt,anthropicSystemPrompt};",scope);
  for(const typeset of [false,true])for(const animation of [false,true])for(const plugins of [false,true]) {
    assert.equal(prompt.activeSystemPrompt(typeset,animation,plugins),scope.local.activeSystemPrompt(typeset,animation,plugins));
    assert.equal(prompt.anthropicSystemPrompt("medium",typeset,animation,plugins),scope.local.anthropicSystemPrompt("medium",typeset,animation,plugins));
  }
  execFileSync(process.execPath,[path.join(__dirname,"../scripts/build-canvas-command-prompt.cjs"),"--check"]);
});

test("the shared command input carries authoritative attention and native plot guidance",()=>{
  const payload={userAction:"plot",suggestion:"plot",uiTheme:"studio",changedBox:{x:80,y:120,w:300,h:100},sourceRect:{x:0,y:0,w:1000,h:800},visibleRect:{x:0,y:0,w:2000,h:1500},captureRect:{x:0,y:0,w:1000,h:800},atlasSize:{w:1000,h:800},imageScale:1,plugins:[{id:"general",name:"General",document:"test"}]},input=prompt.canvasCommandModelInput(payload);
  assert.deepEqual(input.latestInput,{globalRect:payload.changedBox,imageRect:{x:76,y:116,w:308,h:108}});
  assert.equal(input.enabledPlugins,payload.plugins);
  assert.deepEqual(input.widgetGeometry.max,{w:1000,h:1000});
  assert.match(input.actionMeaning,/exactly one plot_function/);
  assert.match(prompt.activeSystemPrompt(),/Never use JavaScript code, Math.sin, Math.PI/);
  assert.deepEqual(JSON.parse(prompt.modelRequestText(input)).latestInput,input.latestInput);
});

test("the shared command result renders software structure graphs locally and refuses retired diagram formats",()=>{
  const payload={userAction:"plot",suggestion:"diagram",uiTheme:"studio",changedBox:{x:80,y:120,w:600,h:400},sourceRect:{x:0,y:0,w:2000,h:1500},visibleRect:{x:0,y:0,w:4000,h:3000},captureRect:{x:0,y:0,w:2000,h:1500},atlasSize:{w:2000,h:1500},imageScale:1,plugins:[{id:"general",name:"General",document:"test"},{id:"flowchart",name:"Professional Diagrams",document:"test"}]},
    geometry={x:100,y:100,w:1400,h:900},
    run=command=>prompt.canvasCommandResult({intent:"plot",commands:[command]},payload).commands,
    dependencies={version:1,title:"Service dependencies",nodes:[{id:"web",label:"Web",type:"frontend"},{id:"orders",label:"Orders"},{id:"pg",label:"Postgres",type:"database"},{id:"kafka",label:"Kafka",type:"messagebus"}],edges:[{from:"web",to:"orders"},{from:"orders",to:"pg",kind:"data"},{from:"orders",to:"kafka",label:"events"}]};
  const [built]=run({tool:"html_widget",pluginId:"general",...geometry,title:"Service dependencies",architecture:dependencies});
  assert.equal(built.pluginId,"general");
  assert.equal(built.html,require("../src/architecture/schema.js").architectureHtml(dependencies));
  for(const sourceFormat of ["dot","Graphviz DOT","cytoscape-json","cytoscape"])
    assert.deepEqual(run({tool:"diagram_source",pluginId:"flowchart",...geometry,title:"Graph",sourceFormat,source:"{}"}),[],sourceFormat);
  assert.equal(run({tool:"diagram_source",pluginId:"flowchart",...geometry,title:"Chart",sourceFormat:"vega-lite",source:'{"mark":"bar"}'})[0].sourceFormat,"vega-lite");
  const system=prompt.activeSystemPrompt(false,false,true);
  assert.match(system,/# Local diagram contract[\s\S]*?service or module dependency graph, a network or deployment topology, a data flow or data lineage graph/);
  assert.match(system,/biological pathways or causal and clinical networks, are not local diagrams: use the Visual Explainer route, or General HTML with inline SVG here/);
  assert.match(system,/Dependency graphs point each edge from the dependent to its dependency[\s\S]*?Lineage uses database nodes for datasets and tables/);
});
