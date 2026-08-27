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
  return vm.runInNewContext(`(() => {${source}\nreturn { normalize:visualExplainerNormalizePlan, document:visualExplainerDocument, widget:visualExplainerWidgetItem, artifact:visualExplainerArtifactWidgetEdit, replaceArtifact:visualExplainerReplaceArtifact };})()`,{structuredClone});
}

function samplePlan() {
  return {
    intent:"explain",title:"Transformer 架构",subtitle:"从 token 到 logits 的单 Widget 视觉解释",
    takeaways:["先看主流程，再看注意力内部结构"],theme:{tone:"technical",accent:"#2563eb"},
    regions:[
      {id:"main",title:"主流程",renderer:"flow",importance:"primary",layout:{columnStart:1,columnSpan:12,rowStart:1,rowSpan:1},items:[
        {id:"tokens",label:"Token 输入",description:"离散 token ids"},
        {id:"embed",label:"Embedding",description:"映射到隐藏空间"},
        {id:"blocks",label:"Transformer Blocks",description:"注意力与前馈网络"},
      ]},
      {id:"attention",title:"注意力",renderer:"relationship",layout:{columnStart:1,columnSpan:12,rowStart:2,rowSpan:1},items:[
        {id:"q",label:"Query"},{id:"k",label:"Key"},{id:"v",label:"Value"},{id:"out",label:"Context"},
      ],links:[{from:"q",to:"out",label:"weighted match"},{from:"k",to:"out"},{from:"v",to:"out"}]},
    ],annotations:["形状与参数应来自用户材料；缺失信息必须标注不确定。"],
  };
}

function sampleArtifactPlan() {
  return {
    intent:"explain",title:"Recurrent Shared-Depth GPT",subtitle:"Pipeline, recurrent core, and operating policy",
    typography:{titlePx:64,subtitlePx:24,regionTitlePx:28,bodyPx:19,captionPx:15},theme:{tone:"technical",accent:"#f97316"},
    regions:[
      {id:"pipeline",title:"Model pipeline",renderer:"flow",importance:"primary",layout:{columnStart:1,columnSpan:12,rowStart:1,rowSpan:1},ports:[{id:"core",side:"bottom",offset:.55}],items:[{id:"input",label:"Input IDs"},{id:"embed",label:"Embedding"},{id:"recur",label:"Recurrent Core"}]},
      {id:"tower",title:"Structural tower",renderer:"embedded-html",layout:{columnStart:1,columnSpan:4,rowStart:2,rowSpan:2},artifactId:"tower-html",ports:[{id:"out",side:"right",offset:.5}]},
      {id:"core",title:"Shared recurrent core",renderer:"embedded-html",importance:"primary",layout:{columnStart:5,columnSpan:6,rowStart:2,rowSpan:2},artifactId:"core-html",ports:[{id:"in",side:"top",offset:.5},{id:"tower",side:"left",offset:.5}]},
      {id:"policy",title:"Recurrence policy",renderer:"cards",layout:{columnStart:11,columnSpan:2,rowStart:2,rowSpan:2},ports:[],items:[{id:"train",label:"Training"},{id:"infer",label:"Inference"}]},
    ],
    relations:[{id:"pipeline-core",from:{regionId:"pipeline",port:"core"},to:{regionId:"core",port:"in"},kind:"drilldown",label:"K iterations"},{id:"tower-core",from:{regionId:"tower",port:"out"},to:{regionId:"core",port:"tower"},kind:"flow"}],
    artifacts:[
      {id:"tower-html",title:"Tower details",html:"<!doctype html><style>body{font:18px system-ui}</style><div data-penecho-port=\"out\">n-gram gates</div>"},
      {id:"core-html",title:"Core details",html:"<!doctype html><button data-penecho-port=\"in\">Step</button><div data-penecho-port=\"tower\">MoE × 224</div><script>document.querySelector('button').onclick=()=>document.body.dataset.step=1<\/script>"},
    ],
  };
}

test("VisualExplainerPlan compiler preserves semantics and owns all renderer syntax",()=>{
  const compiler=clientCompiler(),normalized=compiler.normalize(samplePlan()),html=compiler.document(samplePlan()),widget=compiler.widget(samplePlan(),{width:1400,height:900});
  assert.equal(normalized.regions.length,2);
  assert.match(html,/data-penecho-visual-explainer/);
  assert.match(html,/Transformer 架构/);
  assert.doesNotMatch(html,/AntVInfographic|sequence-steps|grid-template-columns/);
  assert.equal(widget.pluginId,"general");
  assert.equal(widget.widgetType,"html_widget");
  assert.equal(widget.sourceFormat,"penecho-visual-explainer-plan+json");
  assert.match(widget.frameworkVersion,/penecho-visual-explainer\/3/);
  assert.match(widget.frameworkVersion,/antv-infographic\/0\.2\.20/);
  assert.equal(JSON.stringify(JSON.parse(widget.copyText)),JSON.stringify(normalized));
});

test("VisualExplainerPlan rejects coordinates, unknown links, and excess semantic density",()=>{
  const {normalize}=clientCompiler(),coordinatePlan=samplePlan();coordinatePlan.regions[0].items[0].x=120;
  assert.throws(()=>normalize(coordinatePlan),/Unexpected regions\[0\]\.items\[0\] field: x/);
  const badLink=samplePlan();badLink.regions[1].links[0].to="missing";
  assert.throws(()=>normalize(badLink),/unknown item/);
  const dense=samplePlan();dense.regions=Array.from({length:8},(_,region)=>({id:`r${region}`,title:`Region ${region}`,renderer:"cards",layout:{columnStart:1,columnSpan:12,rowStart:region+1,rowSpan:1},items:Array.from({length:9},(_,item)=>({id:`i${item}`,label:`Item ${item}`}))}));
  assert.throws(()=>normalize(dense),/exceeds 64 total items/);
});

test("Visual Explainer assets use the single current plan, local AntV, fallback rendering, and structured diagnostics",()=>{
  const runtime=read("public/visual-explainer-runtime.js"),host=read("public/widget-host.js"),server=read("src/server/main.js"),agent=read("src/server/canvas-agent/runtime.mjs"),browser=read("src/client/app/canvas-agent-runtime.js"),plugin=read("public/plugins/general/plugin.md");
  assert.doesNotMatch(runtime,/plan\.sections|function responsiveLayout|function renderHybridPlan/);
  assert.match(runtime,/ANTV_RENDER_TIMEOUT/);
  assert.match(runtime,/body\.append\(renderNative\(\{\.\.\.region,kind:region\.renderer\}\)\)/);
  assert.match(runtime,/penecho-visual-explainer-diagnostics/);
  assert.match(runtime,/relation-dagre-flow-lr-compact-card/);
  assert.match(runtime,/ResizeObserver/);
  assert.match(runtime,/penecho-widget-updated/);
  assert.match(runtime,/semanticReplanRecommended/);
  assert.match(host,/visual-explainer-vendor\.js/);
  assert.match(host,/visual-explainer-runtime\.js\?v=3/);
  assert.match(host,/frame-src 'self' data: blob:/);
  assert.match(host,/visualExplainerAllowsNestedFrames\(visualPlan\)/);
  assert.match(runtime,/function renderCurrentPlan/);
  assert.match(runtime,/data-penecho-port/);
  assert.match(runtime,/penecho-visual-artifact-ports/);
  assert.match(runtime,/function drawRelations/);
  assert.match(host,/validVisualExplainerDiagnostics/);
  assert.match(server,/antv-infographic-0\.2\.20\.min\.js/);
  assert.match(agent,/VISUAL_EXPLAINER_MAX_MODEL_REPLANS_PER_USER_TURN = 1/);
  assert.match(agent,/VISUAL_EXPLAINER_MAX_DETAIL_CAPTURES_PER_USER_TURN = 2/);
  assert.match(agent,/insufficient-improvement/);
  assert.match(agent,/repeated-issue-signature/);
  assert.match(agent,/VISUAL_EXPLAINER_SOURCE_PATCH_REQUIRED/);
  assert.match(agent,/artifactId.*embedded General HTML artifact/);
  assert.match(agent,/target=canvas shows the complete composition/);
  assert.match(agent,/target=viewport shows current user framing/);
  assert.match(agent,/an object-only capture validates neither/);
  assert.match(agent,/CANVAS_LAYOUT_OVERVIEW_REQUIRED/);
  assert.match(browser,/canvasAgentVisualExplainerCreate/);
  assert.match(browser,/canvasAgentVisualExplainerUpdate/);
  assert.match(read("src/client/app/ai-runtime.js"),/widgetEditTarget\?\.sourceFormat===VISUAL_EXPLAINER_SOURCE_FORMAT[\s\S]*visualExplainerWidgetItem\(JSON\.parse\(c\.copyText\)/);
  assert.match(plugin,/Never perform repeated cosmetic self-polishing/);
  assert.equal(read("public/vendor/antv-infographic-0.2.20.min.js"),read("node_modules/@antv/infographic/dist/infographic.min.js"));
  assert.equal(read("public/vendor/antv-infographic.LICENSE"),read("node_modules/@antv/infographic/LICENSE"));
});

test("PenEcho Agent frames a new Visual Explainer in the unobscured viewport beside its panel",()=>{
  const browser=read("src/client/app/canvas-agent-runtime.js"),frameSource=functionSource(browser,"canvasAgentFrameRegion"),framePlanSource=functionSource(browser,"canvasAgentFramePlan"),state={scale:.24,panX:0,panY:0},viewRect={left:0,top:0,width:1600,height:900},panelRect={left:1200,top:120,right:1580,bottom:880,width:380,height:760},calls={render:0,sync:0};
  const frame=vm.runInNewContext(`(() => { ${framePlanSource} return ${frameSource}; })()`,{
    SIZE:20000,state,
    view:{getBoundingClientRect:()=>viewRect},
    canvasAgentPanel:{hidden:false,getBoundingClientRect:()=>panelRect},
    requestRender:()=>calls.render++,canvasAgentViewFacts:()=>({viewport:{x:0,y:0,w:1,h:1}}),canvasAgentSyncState:()=>calls.sync++,
    canvasAgentExternalRect:region=>({x:region.x,y:region.y,width:region.w,height:region.h}),
  });
  const widget={x:6667,y:8551,w:1200,h:800},result=frame(widget,48),screen={left:state.panX+widget.x*state.scale,top:state.panY+widget.y*state.scale,right:state.panX+(widget.x+widget.w)*state.scale,bottom:state.panY+(widget.y+widget.h)*state.scale};
  assert.ok(state.scale>.9);
  assert.ok(screen.left>=0&&screen.right<=1188);
  assert.ok(screen.top>=0&&screen.bottom<=900);
  assert.deepEqual(result.viewport,{x:0,y:0,width:1,height:1});
  assert.deepEqual(calls,{render:1,sync:1});
  assert.match(functionSource(browser,"canvasAgentCreate"),/singleWidget[\s\S]*canvasAgentFrameRegion\(canvasAgentBox\(\{kind:"widget",item:singleWidget\.record\}\),48\)/);
});

test("nested HTML frames are enabled only when the current Visual Explainer embeds HTML",()=>{
  const host=read("public/widget-host.js"),policies=vm.runInNewContext(`(() => {
    const rendererUrl="http://127.0.0.1/vendor/penecho-dom-renderer.js",visualExplainerVendorUrl="http://127.0.0.1/vendor/visual-explainer.js",visualExplainerRuntimeUrl="http://127.0.0.1/visual-explainer-runtime.js";
    ${functionSource(host,"csp")}
    return [csp(),csp(true)];
  })()`),allows=vm.runInNewContext(`(${functionSource(host,"visualExplainerAllowsNestedFrames")})`);
  assert.match(policies[0],/frame-src 'none'/);
  assert.doesNotMatch(policies[0],/frame-src 'self' data: blob:/);
  assert.match(policies[1],/frame-src 'self' data: blob:/);
  assert.equal(allows(null),false);
  assert.equal(allows({textContent:JSON.stringify(samplePlan())}),false);
  assert.equal(allows({textContent:JSON.stringify(sampleArtifactPlan())}),true);
  assert.equal(allows({textContent:"{"}),false);
});

test("Current Visual Explainer compiles multiple isolated HTML artifacts, explicit typography, and cross-region ports",()=>{
  const compiler=clientCompiler(),plan=sampleArtifactPlan(),normalized=compiler.normalize(plan),widget=compiler.widget(plan,{width:2200,height:1400}),artifact=compiler.artifact(plan,"core-html",{w:1200,h:800});
  assert.equal(normalized.regions.length,4);assert.equal(normalized.artifacts.length,2);assert.equal(normalized.typography.titlePx,64);
  assert.equal(artifact.pluginId,"general");assert.equal(artifact.sourceMirrorsHtml,true);assert.match(artifact.html,/MoE × 224/);
  const replaced=compiler.replaceArtifact(plan,"core-html",{tool:"html_widget",pluginId:"general",title:"Core live",html:"<!doctype html><div data-penecho-port=\"in\">Patched</div>",sourceFormat:"html",refreshSeconds:0});
  assert.match(replaced.artifacts.find(item=>item.id==="core-html").html,/Patched/);assert.match(replaced.artifacts.find(item=>item.id==="tower-html").html,/n-gram gates/);
  assert.doesNotMatch(widget.copyText,/"version"|compositionMode/);assert.match(widget.html,/\\u003cbutton/);
  const bad=structuredClone(plan);bad.relations[0].to.port="missing";assert.throws(()=>compiler.normalize(bad),/unknown port core\.missing/);
});

test("Visual Explainer parent and embedded HTML use strict minimal patches without replacing sibling artifacts",()=>{
  const {commandFromWidgetPatch}=require("../src/server/widget-patch.js"),compiler=clientCompiler(),plan=sampleArtifactPlan(),widget=compiler.widget(plan,{width:2200,height:1400}),source=widget.copyText,lines=source.split("\n"),titleIndex=lines.findIndex(line=>line.includes('"title": "Recurrent Shared-Depth GPT"')),
    parentEdit={widgetType:"html_widget",pluginId:"general",title:plan.title,refreshSeconds:0,html:widget.html,source,sourceMirrorsHtml:false,sourceFormat:widget.sourceFormat,frameworkVersion:widget.frameworkVersion,copyLabel:widget.copyLabel,box:{x:0,y:0,w:2200,h:1400}},
    parentPatch=`--- a/widget.source\n+++ b/widget.source\n@@ -${titleIndex+1},1 +${titleIndex+1},1 @@\n-${lines[titleIndex]}\n+  "title": "Recurrent Core — Patched",\n`,parentCommand=commandFromWidgetPatch({tool:"widget_patch",patch:parentPatch},parentEdit),patchedPlan=compiler.normalize(JSON.parse(parentCommand.copyText));
  assert.equal(patchedPlan.title,"Recurrent Core — Patched");assert.match(patchedPlan.artifacts.find(item=>item.id==="tower-html").html,/n-gram gates/);assert.match(patchedPlan.artifacts.find(item=>item.id==="core-html").html,/MoE × 224/);
  const artifactEdit=compiler.artifact(plan,"core-html",{w:1200,h:800}),oldHtml=artifactEdit.html,newHtml=oldHtml.replace("MoE × 224","MoE × 256"),artifactPatch=`--- a/widget.html\n+++ b/widget.html\n@@ -1,1 +1,1 @@\n-${oldHtml}\n+${newHtml}\n`,artifactCommand=commandFromWidgetPatch({tool:"widget_patch",patch:artifactPatch},artifactEdit),replaced=compiler.replaceArtifact(plan,"core-html",artifactCommand);
  assert.match(replaced.artifacts.find(item=>item.id==="core-html").html,/MoE × 256/);assert.match(replaced.artifacts.find(item=>item.id==="tower-html").html,/n-gram gates/);
});

test("Visual Explainer preserves the authored 12-column composition and stacks it responsively",()=>{
  const runtime=read("public/visual-explainer-runtime.js"),layout=vm.runInNewContext(`(() => {${functionSource(runtime,"responsiveRegionLayout")}\nreturn responsiveRegionLayout;})()`),regions=samplePlan().regions;
  assert.deepEqual(JSON.parse(JSON.stringify(layout(2400,regions))),{columns:12,rows:2,placements:[{columnStart:1,columnSpan:12,rowStart:1,rowSpan:1},{columnStart:1,columnSpan:12,rowStart:2,rowSpan:1}]});
  assert.deepEqual(JSON.parse(JSON.stringify(layout(760,regions))),{columns:1,rows:2,placements:[{columnStart:1,columnSpan:1,rowStart:1,rowSpan:1},{columnStart:1,columnSpan:1,rowStart:2,rowSpan:1}]});
  assert.equal(layout(1100,regions).columns,6);
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
