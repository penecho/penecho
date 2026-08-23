"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT=path.resolve(__dirname,".."),read=file=>fs.readFileSync(path.join(ROOT,file),"utf8");

function functionSource(source,name) {
  const start=source.indexOf(`function ${name}(`);assert.notEqual(start,-1,`missing function ${name}`);
  const body=source.indexOf("{",start);let depth=0;
  for(let index=body;index<source.length;index++){if(source[index]==="{")depth++;else if(source[index]==="}"&&--depth===0)return source.slice(start,index+1);}
  assert.fail(`unterminated function ${name}`);
}

function clientCompiler() {
  const source=read("src/client/app/visual-explainer.js");
  return vm.runInNewContext(`(() => {${source}\nreturn { normalize:visualExplainerNormalizePlan, document:visualExplainerDocument, widget:visualExplainerWidgetItem };})()`,{structuredClone});
}

function samplePlan() {
  return {
    version:1,intent:"explain",title:"Transformer 架构",subtitle:"从 token 到 logits 的单 Widget 视觉解释",
    takeaways:["先看主流程，再看注意力内部结构"],theme:{tone:"technical",accent:"#2563eb"},
    sections:[
      {id:"main",title:"主流程",kind:"flow",importance:"primary",items:[
        {id:"tokens",label:"Token 输入",description:"离散 token ids"},
        {id:"embed",label:"Embedding",description:"映射到隐藏空间"},
        {id:"blocks",label:"Transformer Blocks",description:"注意力与前馈网络"},
      ]},
      {id:"attention",title:"注意力",kind:"relationship",items:[
        {id:"q",label:"Query"},{id:"k",label:"Key"},{id:"v",label:"Value"},{id:"out",label:"Context"},
      ],links:[{from:"q",to:"out",label:"weighted match"},{from:"k",to:"out"},{from:"v",to:"out"}]},
    ],annotations:["形状与参数应来自用户材料；缺失信息必须标注不确定。"],
  };
}

test("VisualExplainerPlan compiler preserves semantics and owns all renderer syntax",()=>{
  const compiler=clientCompiler(),normalized=compiler.normalize(samplePlan()),html=compiler.document(samplePlan()),widget=compiler.widget(samplePlan(),{width:1400,height:900});
  assert.equal(normalized.sections.length,2);
  assert.match(html,/data-penecho-visual-explainer/);
  assert.match(html,/Transformer 架构/);
  assert.doesNotMatch(html,/AntVInfographic|sequence-steps|grid-template-columns/);
  assert.equal(widget.pluginId,"general");
  assert.equal(widget.widgetType,"html_widget");
  assert.equal(widget.sourceFormat,"penecho-visual-explainer-plan+json");
  assert.match(widget.frameworkVersion,/penecho-visual-explainer\/2/);
  assert.match(widget.frameworkVersion,/antv-infographic\/0\.2\.20/);
  assert.equal(JSON.stringify(JSON.parse(widget.copyText)),JSON.stringify(normalized));
});

test("VisualExplainerPlan rejects coordinates, unknown links, and excess semantic density",()=>{
  const {normalize}=clientCompiler(),coordinatePlan=samplePlan();coordinatePlan.sections[0].items[0].x=120;
  assert.throws(()=>normalize(coordinatePlan),/Unexpected item field: x/);
  const badLink=samplePlan();badLink.sections[1].links[0].to="missing";
  assert.throws(()=>normalize(badLink),/unknown item/);
  const dense=samplePlan();dense.sections=Array.from({length:8},(_,section)=>({id:`s${section}`,title:`Section ${section}`,kind:"cards",items:Array.from({length:9},(_,item)=>({id:`i${item}`,label:`Item ${item}`}))}));
  assert.throws(()=>normalize(dense),/exceeds 64 total items/);
});

test("Visual Explainer assets use local AntV, bounded density attempts, fallback rendering, and structured diagnostics",()=>{
  const runtime=read("public/visual-explainer-runtime.js"),host=read("public/widget-host.js"),server=read("src/server/main.js"),agent=read("src/server/canvas-agent/runtime.mjs"),browser=read("src/client/app/canvas-agent-runtime.js"),plugin=read("public/plugins/general/plugin.md");
  assert.match(runtime,/DENSITIES = \["comfortable","compact","dense"\]/);
  assert.match(runtime,/ANTV_RENDER_TIMEOUT/);
  assert.match(runtime,/body\.append\(renderNative\(section\)\)/);
  assert.match(runtime,/penecho-visual-explainer-diagnostics/);
  assert.match(runtime,/relation-dagre-flow-lr-compact-card/);
  assert.match(runtime,/ResizeObserver/);
  assert.match(runtime,/penecho-widget-updated/);
  assert.match(runtime,/semanticReplanRecommended/);
  assert.match(host,/visual-explainer-vendor\.js/);
  assert.match(host,/visual-explainer-runtime\.js\?v=2/);
  assert.match(host,/validVisualExplainerDiagnostics/);
  assert.match(server,/antv-infographic-0\.2\.20\.min\.js/);
  assert.match(agent,/VISUAL_EXPLAINER_MAX_MODEL_REPLANS_PER_USER_TURN = 1/);
  assert.match(agent,/VISUAL_EXPLAINER_MAX_DETAIL_CAPTURES_PER_USER_TURN = 2/);
  assert.match(agent,/insufficient-improvement/);
  assert.match(agent,/repeated-issue-signature/);
  assert.match(agent,/VISUAL_EXPLAINER_PLAN_REQUIRED/);
  assert.match(browser,/canvasAgentVisualExplainerCreate/);
  assert.match(browser,/canvasAgentVisualExplainerUpdate/);
  assert.match(plugin,/Never perform repeated cosmetic self-polishing/);
  assert.equal(read("public/vendor/antv-infographic-0.2.20.min.js"),read("node_modules/@antv/infographic/dist/infographic.min.js"));
  assert.equal(read("public/vendor/antv-infographic.LICENSE"),read("node_modules/@antv/infographic/LICENSE"));
});

test("Visual Explainer packs panels without dead grid columns and changes layout when either Widget axis changes",()=>{
  const runtime=read("public/visual-explainer-runtime.js"),layout=vm.runInNewContext(`(() => {${functionSource(runtime,"responsiveLayout")}\nreturn responsiveLayout;})()`),sections=Array.from({length:5},(_,index)=>({id:`s${index}`,importance:index<2?"primary":"standard"}));
  assert.deepEqual(JSON.parse(JSON.stringify(layout(2400,1600,sections))),{columns:3,rows:3,spans:[3,3,1,1,1],aspect:1.5});
  assert.deepEqual(JSON.parse(JSON.stringify(layout(760,1600,sections))),{columns:1,rows:5,spans:[1,1,1,1,1],aspect:.475});
  assert.equal(layout(1100,700,sections).columns,2);
  assert.equal(layout(1100,1600,sections).columns,1);
  assert.deepEqual(JSON.parse(JSON.stringify(layout(2400,1600,Array.from({length:5},()=>({importance:"standard"}))))).spans,[2,1,1,1,1]);
});

test("PenEcho's deterministic AntV resolver produces renderable sequence, hierarchy, and relationship SVG",async()=>{
  const runtime=read("public/visual-explainer-runtime.js"),resolver=vm.runInNewContext(`(() => {${functionSource(runtime,"hierarchyRoot")}\n${functionSource(runtime,"antvOptions")}\nreturn antvOptions;})()`),
    {renderToString}=await import("@antv/infographic/ssr"),palette=["#2563eb","#16a34a","#ea580c"],sections=[
      {id:"flow",title:"Flow",kind:"flow",items:[{id:"a",label:"Input",description:"Start"},{id:"b",label:"Output",description:"Finish"}]},
      {id:"tree",title:"Tree",kind:"hierarchy",items:[{id:"root",label:"Transformer"},{id:"attn",label:"Attention",parentId:"root"},{id:"ffn",label:"FFN",parentId:"root"}]},
      {id:"network",title:"Network",kind:"relationship",items:[{id:"q",label:"Query"},{id:"out",label:"Context"}],links:[{from:"q",to:"out",direction:"forward"}]},
    ];
  for(const section of sections){const options=resolver(section,palette,{width:800,height:420}),svg=await renderToString(options,{width:800,height:420});assert.match(svg,/<svg\b/);assert.ok(svg.length>1000,`${section.kind} SVG is unexpectedly small`);if(section.kind==="relationship"){assert.match(options.template,/relation-dagre-flow-lr-compact-card/);assert.match(svg,/Query/);assert.match(svg,/Context/);}}
});
