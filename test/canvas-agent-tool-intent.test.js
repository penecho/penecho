"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");
const vm=require("node:vm");

const ROOT=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(ROOT,"src/client/app/canvas-agent-runtime.js"),"utf8");

function functionSource(name){
  const start=source.indexOf(`function ${name}(`),signature=source.indexOf("(",start);let parentheses=0,signatureEnd=-1;
  assert.notEqual(start,-1,`missing function ${name}`);
  for(let index=signature;index<source.length;index++){
    if(source[index]==="(")parentheses++;
    else if(source[index]===")"&&--parentheses===0){signatureEnd=index;break;}
  }
  const body=source.indexOf("{",signatureEnd);let depth=0;
  for(let index=body;index<source.length;index++){
    if(source[index]==="{")depth++;
    else if(source[index]==="}"&&--depth===0)return source.slice(start,index+1);
  }
  assert.fail(`unterminated function ${name}`);
}

const labels={
  canvasAgentToolInspect:"Inspect canvas",canvasAgentToolRead:"Read canvas object",canvasAgentToolCapture:"Capture canvas",canvasAgentToolCreate:"Create canvas content",canvasAgentToolEdit:"Edit canvas content",canvasAgentToolPatchWidget:"Update widget",canvasAgentToolSetView:"Adjust canvas view",canvasAgentToolRevert:"Revert Agent change",
  canvasAgentToolRunProjectCommand:"Run project command",canvasAgentToolReadDocument:"Read document",canvasAgentToolReadProjectFile:"Read project file",canvasAgentToolReadBinary:"Inspect binary file",canvasAgentToolReadProjectImage:"Inspect project image",canvasAgentToolReadDatabase:"Query project database",canvasAgentToolLoadDocumentReader:"Load document reader",canvasAgentToolLoadDatabaseReader:"Load database reader",canvasAgentToolFindProjectFiles:"Find project files",canvasAgentToolSearchProjectFiles:"Search project contents",canvasAgentToolListProjectFolder:"List project folder",
  canvasAgentToolSearch:"Search the web",canvasAgentToolReadWeb:"Read web page",canvasAgentToolStock:"Look up stock data",
  canvasAgentToolVisualMath2D:"Use Canvas Math 2D",canvasAgentToolVisualPhysics2D:"Use Canvas Physics 2D",canvasAgentToolVisualMath3D:"Use Canvas Math 3D",
  canvasAgentToolGeneralHtml:"Use Canvas General HTML",canvasAgentToolProfessionalDiagrams:"Use Canvas Professional Diagrams",canvasAgentToolUse:"Use canvas tool",
  canvasAgentToolTargetViewport:"viewport",canvasAgentToolTargetCanvas:"entire canvas",canvasAgentToolTargetObject:"canvas object",canvasAgentToolTargetSelection:"selection",canvasAgentToolTargetRegion:"canvas region",
};
const intent=vm.runInNewContext(`(()=>{${functionSource("canvasAgentToolIntent")}return canvasAgentToolIntent;})()`,{t:key=>labels[key]||key});

test("PenEcho Agent tool hints name visual capabilities in one sentence",()=>{
  assert.equal(intent("load_visual_skill",{skill:"physics-2d"}),"Use Canvas Physics 2D");
  assert.equal(intent("load_visual_skill",{skill:"math-3d"}),"Use Canvas Math 3D");
  assert.equal(intent("load_widget_contract",{route:"general-html"}),"Use Canvas General HTML");
  assert.equal(intent("load_widget_contract",{route:"professional-diagrams"}),"Use Canvas Professional Diagrams");
});

test("PenEcho Agent search hints include compact search keywords in the same sentence",()=>{
  assert.equal(intent("deepseek_search",{query:"WebGPU browser support 2026"}),"Search the web · “WebGPU browser support 2026”");
  assert.equal(intent("duckduckgo_search",{query:"  PenEcho\nAgent  "}),"Search the web · “PenEcho Agent”");
  assert.equal(intent("web_read",{url:"https://example.com/reference"}),"Read web page · https://example.com/reference");
  assert.doesNotMatch(intent("tavily_search",{query:"x".repeat(140)}),/[\r\n]/);
  assert.ok(intent("tavily_search",{query:"x".repeat(140)}).endsWith("…”"));
});

test("PenEcho Agent gives every current host tool a specific one-sentence hint",()=>{
  const calls={
    canvas_inspect:{scope:"selection"},canvas_read:{resource:"widget.html"},canvas_capture:{target:"object"},canvas_create:{summary:"Create a force diagram"},canvas_edit:{summary:"Align the labels"},canvas_patch_widget:{patch:"--- a/widget.html\n+++ b/widget.html\n"},canvas_set_view:{target:"region"},canvas_revert:{changeId:"change-1"},
    bash:{command:"npm test"},read_document:{file_path:"brief.pdf"},read:{file_path:"src/app.js"},read_binary:{file_path:"sample.bin"},read_image:{file_path:"diagram.png"},read_database:{file_path:"data.sqlite",query:"SELECT name FROM items"},load_project_plugin:{plugin:"documents"},glob:{pattern:"**/*.test.js"},grep:{pattern:"canvasAgentToolIntent"},list_directory:{path:"src/client"},
    tavily_search:{query:"PenEcho"},deepseek_search:{query:"PenEcho"},research_search:{query:"PenEcho"},github_repository_search:{query:"PenEcho"},duckduckgo_search:{query:"PenEcho"},web_read:{url:"https://example.com"},stock_symbol_search:{query:"Apple"},stock_market_data:{symbol:"AAPL"},load_visual_skill:{skill:"physics-2d"},load_widget_contract:{route:"professional-diagrams"},
  };
  for(const [name,args] of Object.entries(calls)){
    const hint=intent(name,args);
    assert.notEqual(hint,"Use canvas tool",`${name} should not use the generic hint`);
    assert.doesNotMatch(hint,/[\r\n]/,`${name} should remain one sentence`);
  }
  assert.equal(intent("bash",{command:"npm\n test"}),"Run project command · “npm test”");
  assert.equal(intent("read_database",{file_path:"data.sqlite",query:"SELECT name FROM items"}),"Query project database · data.sqlite · “SELECT name FROM items”");
  assert.equal(intent("canvas_capture",{target:"object"}),"Capture canvas · canvas object");
  assert.equal(intent("canvas_patch_widget",{patch:"--- a/widget.html\n+++ b/widget.html\n"}),"Update widget · widget.html");
  assert.equal(intent("future_special_tool",{}),"Use canvas tool · future_special_tool");
});
