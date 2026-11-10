"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const SMART = require("../public/smart-suggest.js"), route = SMART.widgetRefineRoute;
const plain = value => JSON.parse(JSON.stringify(value));
const widget = (html, extra = {}) => ({ id:"existing", widgetType:"html_widget", pluginId:"general", html, ...extra });

test("structured source markers win over general/html metadata; names and comments do not", () => {
  for (const id of ["architecture", "sequence", "workflow"]) {
    assert.deepEqual(route(widget(`<section data-penecho-${id}><script type="application/json" data-${id}-source>{}</script></section>`)), { executor:"penecho_agent", reason:"structured-diagram", guidance:[id] });
  }
  assert.equal(route(widget('<p>architecture workflow</p><!-- <section data-penecho-architecture> -->', { title:"Flowchart" })).executor, "canvas_ai");
  for (const extra of [{ widgetType:"diagram_source" }, { pluginId:"flowchart" }, { sourceFormat:"dot" }, { frameworkVersion:"penecho-professional-diagrams-v1" }]) assert.equal(route(widget("", extra)).reason, "professional-diagram");
  assert.equal(route(widget("<svg></svg>",{diagramKind:"sequence"})).executor,"penecho_agent");
  assert.deepEqual(route(widget("", { sourceFormat:"penecho-scene+json" })).guidance, ["scene"]);
  assert.deepEqual(route(widget("", { sourceFormat:"penecho-visual-explainer-plan+json" })).guidance, ["visual-explorer"]);
});
test("clock timers, local controls and embedded images stay fast; executable complexity goes to Agent", () => {
  assert.equal(route(widget('<svg></svg><script>setInterval(update,1000);'+" ".repeat(5858)+'</script>')).executor, "canvas_ai");
  assert.equal(route(widget('<button>Clock</button><img src="data:image/png;base64,'+"a".repeat(30000)+'">')).executor, "canvas_ai");
  for (const html of ['<script>fetch("/api/data")</script>', '<script src="https://example.com/runtime.js"></script>', '<script>new WebSocket("wss://example.com")</script>', '<script>'+" ".repeat(12001)+'</script>']) assert.equal(route(widget(html)).executor, "penecho_agent");
  for (const actionId of ["fix_error", "add_controls"]) assert.equal(route(widget("<p>Clock</p>"), { actionId }).executor, "penecho_agent");
  assert.equal(route(widget("", { runtimeDiagnostics:{ errors:[{ message:"error" }] } })).executor, "penecho_agent");
  for (const instruction of ["Make the button blue", "Colorful", "Date", "把文字放大", "增加日期"]) assert.equal(route(widget(""), { instruction }).executor, "canvas_ai");
  for (const instruction of ["Add drag interaction", "增加暂停播放控制", "修复计算逻辑", "Connect to an API"]) assert.equal(route(widget(""), { instruction }).executor, "penecho_agent");
});
function centralHarness(html) {
  const w = widget(html, { x:100, y:100, w:400, h:300 }), calls = [], dirty = { x:490, y:200, w:70, h:80 };
  const context = { window:{ PENECHO_SMART_SUGGEST:SMART }, state:{ widgets:[w], mode:"pen", scale:1, dirty }, assistAgent:{},
    activeWidgetRefinement:()=>null, clearTimeout(){}, clearWidgetRefineCandidate(){}, supersedeActiveAI(){}, setStatusKey(){}, debug(){}, t:key=>key,
    viewportRect:()=>({ x:0, y:0, w:1000, h:800 }), intersection:(_a,b)=>b===dirty?dirty:_a,
    widgetBox:()=>({ x:w.x, y:w.y, w:w.w, h:w.h }), unionLocalBounds:(a,b)=>!b ? {...a} : ({ x:Math.min(a.x,b.x), y:Math.min(a.y,b.y), w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x), h:Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y) }),
    widgetEditContext:(_widget,instructionMode,options)=>({ html, instructionMode, ...options }), requestAI:(_id,_selection,options)=>calls.push({ executor:"canvas_ai", options }),
    assistAgentRun:async(id,target,options)=>{ calls.push({ executor:"penecho_agent", id, target, options }); return "submitted"; },
  };
  vm.createContext(context);
  const source = fs.readFileSync("src/client/app/canvas-runtime.js", "utf8").match(/  function requestWidgetRefinement\([^]*?\n  \}/)[0];
  vm.runInContext(source, context);
  return { context, w, calls, dirty };
}
test("central Refine preserves annotations, includes nearby ink, and handles unavailable or busy Agent", async () => {
  const h = centralHarness('<section data-penecho-architecture></section>');
  assert.equal(await h.context.requestWidgetRefinement(h.w,"nearby-dirty",{ actionId:"apply_marks" }),true);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].executor,"penecho_agent");
  assert.deepEqual(plain(h.calls[0].target.box),{ x:100,y:100,w:460,h:300 });
  assert.deepEqual(plain(h.calls[0].target.refinement.route.guidance),["architecture"]);
  assert.equal(h.context.state.dirty,h.dirty);
  h.context.assistAgentRun=async()=>"blocked";
  assert.equal(await h.context.requestWidgetRefinement(h.w,"nearby-dirty"),false);
  assert.equal(h.calls.length,1,"blocked Agent never falls back to a one-shot Canvas AI rewrite");
  h.context.assistAgent.preparing=true;
  assert.equal(h.context.requestWidgetRefinement(h.w,"nearby-dirty"),false);
  const simple=centralHarness('<script>setInterval(update,1000)</script>');
  assert.equal(simple.context.requestWidgetRefinement(simple.w,"nearby-dirty"),true);
  assert.equal(simple.calls[0].executor,"canvas_ai");
});
test("Widget Refine sends all distant and offscreen dirty to only the selected Widget on both executors",async()=>{
  for(const html of ['<p>Simple Widget</p>','<section data-penecho-architecture></section>']){
    const h=centralHarness(html),dirty={x:40,y:60,w:6000,h:4500};
    h.context.state.dirty=dirty;
    assert.equal(await h.context.requestWidgetRefinement(h.w,"nearby-dirty"),true);
    const request=h.calls[0],box={x:40,y:60,w:6000,h:4500};
    if(request.executor==="canvas_ai"){
      assert.equal(request.options.widgetEditTarget,h.w);
      assert.equal(request.options.widgetEditContext.instructionMode,"canvas-dirty");
      assert.equal(request.options.captureWholeInput,true);
      assert.deepEqual(plain(request.options.attentionBox),dirty);
      assert.deepEqual(plain(request.options.thinkingBox),box);
      assert.deepEqual(plain(request.options.captureRegion),{x:-56,y:-36,w:6192,h:4692});
      assert.equal(request.options.inputScope,undefined);
    }else{
      assert.equal(request.target.widget,h.w);
      assert.equal(request.target.refinement.instructionMode,"canvas-dirty");
      assert.deepEqual(plain(request.target.box),box);
      assert.match(request.options.instruction,/all pending user content.*distant handwriting, text and images/);
    }
    assert.equal(h.context.state.dirty,dirty,"preparation never consumes the instructions");
  }
});
test("the server accepts complete Canvas dirty instructions for a Widget replacement",()=>{
  const server=fs.readFileSync("src/server/main.js","utf8"),start=server.indexOf("function canonicalWidgetEdit("),end=server.indexOf("\nfunction ",start+1),
    context={selectionBox:box=>box,widgetSourceMirrorsHtml:()=>false,canonicalWidgetRuntimeDiagnostics:()=>null,
      SCENE:{isSceneFormat:()=>false},NOTE_CARD:{isNoteFormat:()=>false},MAX_WIDGET_COPY_TEXT_LENGTH:100000,MAX_WIDGET_HTML_LENGTH:100000};
  const canonical=vm.runInNewContext(`(${server.slice(start,end)})`,context),
    edit={mode:"replace",widgetType:"html_widget",pluginId:"general",title:"Target",instructionMode:"canvas-dirty",box:{x:100,y:100,w:400,h:300},html:"<p>Source</p>",instruction:"Larger text"};
  assert.equal(canonical(edit,[{id:"general"}]).instructionMode,"canvas-dirty");
  assert.equal(canonical(edit,[{id:"general"}]).instruction,"Larger text");
  assert.equal(canonical({...edit,instructionMode:"unknown"},[{id:"general"}]),false);
});
test("typed Widget Ask uses central routing without PenEchoLLM classification", async () => {
  const source=fs.readFileSync("src/client/app/widget-assist.js","utf8").match(/  async function submitWidgetAsk\([^]*?\n  \}/)[0], calls=[];
  const context={state:{},requestWidgetRefinement:(...args)=>{calls.push(args);return true;},assistClassifyRequest:()=>assert.fail("No executor classification request")};
  vm.createContext(context);vm.runInContext(source,context);
  assert.equal(await context.submitWidgetAsk({id:"w"},"增加日期"),true);
  assert.deepEqual(plain(calls[0].slice(1)),["ask",{instructionMode:"ask",instruction:"增加日期",actionId:"ask"}]);
});


test("Widget animation explanation, sketch animation and illustration create variants for every source format",()=>{
  for(const sourceFormat of ["html","penecho-note-card+json","penecho-scene+json","mermaid"])for(const actionId of ["animate","animate_sketch","vivid"]){
    assert.deepEqual(route(widget("<p>Source</p>",{sourceFormat}),{actionId}),{executor:"penecho_agent",reason:"widget-variant",guidance:[actionId==="vivid"?"general-html":"scene"]});
  }
});

test("central Refine binds derived Widgets to the original box and preserves nearby annotations", async()=>{
  for(const actionId of ["vivid","animate","animate_sketch"]){
    const h=centralHarness('<section data-penecho-workflow></section>'),before=JSON.stringify(h.w);
    assert.equal(await h.context.requestWidgetRefinement(h.w,"nearby-dirty",{actionId}),true);
    const request=h.calls[0];
    assert.equal(request.executor,"penecho_agent");assert.equal(request.id,actionId);
    assert.deepEqual(plain(request.target.box),{x:100,y:100,w:400,h:300});
    assert.deepEqual(plain(request.target.variant.guidance),[actionId==="vivid"?"general-html":"scene"]);
    assert.equal(request.target.refinement,undefined);assert.equal(request.target.widget,h.w);
    assert.equal(h.context.state.dirty,h.dirty);assert.equal(JSON.stringify(h.w),before);
  }
});
