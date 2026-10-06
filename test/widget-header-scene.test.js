"use strict";
// Widget header, specific Refine suggestions, and host-rendered scenes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const SCENE = require("../public/scene-spec.js");
const widgetPatch = require("../src/server/widget-patch.js");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  let depth = 0, index = source.indexOf("{", source.indexOf(")", start));
  for (; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) break;
  }
  return source.slice(start, index + 1);
}

const motion = {
  actors:[
    { id:"ax", type:"axes", box:[80, 60, 800, 420], x:[-4, 4], y:[-2, 2] },
    { id:"f", type:"fn", axes:"ax", expr:"sin(x)" },
    { id:"p", type:"circle", x:80, y:270, r:12, fill:"orange" },
    { id:"t", type:"text", x:480, y:40, text:"y = sin x", size:36 },
  ],
  beats:[
    { caption:"Axes", steps:[{ do:"draw", target:"ax" }] },
    { caption:"Curve", steps:[{ do:"draw", target:"f", dur:1.2 }, { do:"write", target:"t", with:true }] },
    { steps:[{ do:"move", target:"p", along:"f", dur:2 }] },
  ],
};

test("scene spec normalizes motion, physics and 3d scenes with sensible defaults", () => {
  const scene = SCENE.normalize(motion);
  assert.equal(scene.engine, "motion");
  assert.deepEqual(scene.size, [960, 540]);
  assert.equal(scene.controls, true);
  assert.deepEqual(scene.beats[0].steps[0], { do:"draw", dur:0.8, target:["ax"] });
  assert.equal(scene.beats[2].steps[0].along, "f");
  assert.deepEqual(scene.beats[2].steps[0].range, [0, 1]);
  const physics = SCENE.normalize({ bodies:[{ id:"ball", shape:"circle", x:100, y:50, r:20 }, { id:"ramp", shape:"segment", x:0, y:300, to:[600, 400] }] });
  assert.equal(physics.engine, "physics");
  assert.equal(physics.bodies[1].static, true);
  assert.equal(physics.walls, "box");
  const solid = SCENE.normalize({ shapes:[{ id:"cube", type:"box", width:80 }] });
  assert.equal(solid.engine, "3d");
  assert.deepEqual(solid.spin, [0, 20, 0]);
});

test("scene spec rejects structural mistakes with actionable messages", () => {
  const cases = [
    [{ actors:[{ id:"a", type:"star" }] }, /unknown type "star"/],
    [{ actors:[{ id:"a", type:"circle" }, { id:"a", type:"circle" }] }, /duplicate id "a"/],
    [{ actors:[{ id:"a", type:"circle" }], beats:[{ steps:[{ do:"move", target:"b", to:[1, 2] }] }] }, /unknown target "b"/],
    [{ actors:[{ id:"a", type:"circle" }], beats:[{ steps:[{ do:"fly", target:"a" }] }] }, /unknown step "fly"/],
    [{ actors:[{ id:"a", type:"circle" }], beats:[{ steps:[{ do:"move", target:"a" }] }] }, /move needs/],
    [{ actors:[{ id:"ax", type:"axes" }, { id:"f", type:"fn", axes:"ax", expr:"alert(1)" }] }, /unknown name "alert"/],
    [{ actors:[{ id:"p", type:"path", d:"M0 0 <script>" }] }, /SVG path data/],
    [{ engine:"webgl", actors:[] }, /engine must be/],
    ["{not json", /not valid JSON/],
  ];
  for (const [value, pattern] of cases) {
    const result = SCENE.validate(value);
    assert.equal(result.ok, false);
    assert.match(result.error, pattern);
  }
});

test("scene expressions are parsed without eval and support implicit multiplication", () => {
  const f = SCENE.compileExpression("2x^2 + sin(3x) - pi", ["x"]);
  assert.ok(Math.abs(f({ x:1 }) - (2 + Math.sin(3) - Math.PI)) < 1e-12);
  assert.ok(Number.isNaN(SCENE.compileExpression("sqrt(x)")({ x:-1 })));
  assert.equal(SCENE.compileExpression("max(x, 2)")({ x:1 }), 2);
  assert.throws(() => SCENE.compileExpression("constructor"), /unknown name/);
  assert.doesNotMatch(read("public/scene-spec.js"), /\beval\(|new Function/);
});

test("scene source is diff-friendly and the Widget document embeds only validated JSON", () => {
  const source = SCENE.formatSource(motion);
  assert.match(source, /\n    \{"id":"ax","type":"axes"/);
  assert.match(source, /\n        \{"do":"draw","dur":0\.8,"target":\["ax"\]\}/);
  assert.deepEqual(SCENE.normalize(source), SCENE.normalize(motion));
  const html = SCENE.documentFor({ ...motion, actors:[...motion.actors, { id:"x", type:"text", x:1, y:1, text:"</script><img onerror=1>" }] }, { title:"Sine <demo>" });
  assert.match(html, /data-penecho-scene-engine="motion"/);
  assert.match(html, /<title>Sine &lt;demo&gt;<\/title>/);
  assert.doesNotMatch(html, /<\/script><img/);
  assert.match(html, /\\u003c\/script\\u003e/);
});

test("physics source without an optional duration remains valid JSON after repeated normalization", () => {
  const scene = { engine:"physics", bodies:[{ id:"ball", shape:"circle", x:100, y:50, r:20 }] },
    source = SCENE.formatSource(scene);
  assert.equal(Object.hasOwn(JSON.parse(source),"duration"),false);
  assert.deepEqual(SCENE.normalize(source),SCENE.normalize(scene));
  assert.equal(SCENE.formatSource(source),source);
});

test("3d fill booleans and legacy color fills survive repeated source, document and server normalization", () => {
  const spec={engine:"3d",shapes:[
    {id:"outline",type:"ellipse",fill:false,color:"red"},
    {id:"solid",type:"rect",fill:true,color:"blue"},
    {id:"colored",type:"polygon",fill:"#AABBCC"},
    {id:"canonical",type:"rect",filled:false,fill:"green",color:"purple"},
    {id:"canonicalSolid",type:"rect",filled:true},
  ]},normalized=SCENE.normalize(spec),source=SCENE.formatSource(normalized),
    serverNormalize=vm.runInNewContext(`(${functionSource(read("src/server/main.js"),"normalizedSceneCommand")})`,{SCENE,optionalWidgetText:value=>String(value||"")});
  assert.deepEqual(normalized.shapes.map(shape=>shape.filled),[false,true,true,false,true]);
  assert.deepEqual(normalized.shapes.map(shape=>shape.color),["red","blue","#aabbcc","purple",undefined]);
  assert.deepEqual(SCENE.normalize(normalized),normalized);assert.deepEqual(SCENE.normalize(source),normalized);assert.equal(SCENE.formatSource(source),source);
  const html=SCENE.documentFor(source),embedded=JSON.parse(/data-penecho-scene>(.*?)<\/script>/s.exec(html)[1]);
  assert.deepEqual(embedded,normalized);
  let command=serverNormalize({tool:"scene",title:"Fill round trip",scene:spec});
  for(let i=0;i<4;i++){
    assert.equal(command.copyText,source);assert.deepEqual(SCENE.normalize(command.copyText),normalized);
    command=serverNormalize(command);
  }
});

test("scene Refine patches only the scene source; PenEcho owns the HTML", () => {
  const source = SCENE.formatSource(motion),
    edit = {
      widgetType:"html_widget", pluginId:"general", title:"Sine", refreshSeconds:0,
      sourceFormat:SCENE.FORMAT, frameworkVersion:SCENE.FRAMEWORK_VERSION, source, copyLabel:SCENE.COPY_LABEL,
      html:SCENE.documentFor(motion, { title:"Sine" }), box:{ x:10, y:20, w:960, h:540 },
    };
  assert.equal(widgetPatch.hostCompiledWidget(edit), true);
  assert.deepEqual(widgetPatch.widgetPatchFiles(edit).map(file => file.path), ["widget.json", "widget.source"]);
  const manifest = JSON.parse(widgetPatch.widgetPatchFiles(edit)[0].content);
  assert.equal(manifest.sourceFile, "widget.source");
  assert.equal(manifest.htmlFile, undefined);
  const lines = source.split("\n"), index = lines.findIndex(line => line.includes('"id":"p"')),
    before = lines[index], after = before.replace('"orange"', '"red"'),
    patch = `--- a/widget.source\n+++ b/widget.source\n@@ -${index + 1},1 +${index + 1},1 @@\n-${before}\n+${after}\n`,
    command = widgetPatch.commandFromWidgetPatch({ tool:"widget_patch", patch }, edit, {});
  assert.equal(command.tool, "html_widget");
  assert.equal(command.sourceFormat, SCENE.FORMAT);
  assert.match(command.copyText, /"fill":"red"/);
  assert.deepEqual({ x:command.x, y:command.y, w:command.w, h:command.h }, edit.box);
  const htmlPatch = `--- a/widget.html\n+++ b/widget.html\n@@ -1,1 +1,1 @@\n-<!doctype html>\n+<!doctype html><script>\n`;
  const diagnostics = {};
  assert.equal(widgetPatch.commandFromWidgetPatch({ tool:"widget_patch", patch:htmlPatch }, edit, diagnostics), null);
});

test("the server turns a scene command into a host-rendered General widget and reports invalid scenes", () => {
  const server = read("src/server/main.js"),
    source = functionSource(server, "normalizedSceneCommand"),
    optionalWidgetText = (value, limit) => typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : "",
    normalize = vm.runInNewContext(`(${source})`, { SCENE, optionalWidgetText });
  const command = normalize({ tool:"html_widget", pluginId:"general", x:1, y:2, w:960, h:540, title:"Sine", sourceFormat:SCENE.FORMAT, scene:motion });
  assert.equal(command.tool, "html_widget");
  assert.equal(command.pluginId, "general");
  assert.equal(command.scene, undefined);
  assert.equal(command.copyLabel, SCENE.COPY_LABEL);
  assert.match(command.html, /data-penecho-scene>/);
  assert.deepEqual(SCENE.normalize(command.copyText), SCENE.normalize(motion));
  const alias = normalize({ tool:"scene", title:"Alias", scene:motion });
  assert.equal(alias.sourceFormat, SCENE.FORMAT);
  const context = {};
  assert.equal(normalize({ tool:"scene", scene:{ actors:[{ id:"a", type:"blob" }] } }, context), null);
  assert.match(context.sceneError, /unknown type "blob"/);
  assert.equal(normalize({ tool:"write_text", text:"hi" }).tool, "write_text");
  assert.match(server, /:invalidScene\?`Your scene failed PenEcho validation/);
  assert.match(server, /SCENE_CONTRACT_PROMPT = fs\.readFileSync\(path\.join\(__dirname, "scene-contract\.md"\)/);
  assert.match(server, /sections\.push\(PLUGIN_ROUTING_PROMPT, PLUGIN_SYSTEM_PROMPT, SCENE_CONTRACT_PROMPT\)/);
  for (const route of ["/scene-spec.js", "/scene-runtime.js", "/scene-vendor/anime.js", "/scene-vendor/matter.js", "/scene-vendor/zdog.js"]) assert.ok(server.includes(`["${route}"`), route);
});

test("the scene contract documents every engine and the plugin document stays within its size cap", () => {
  const contract = read("src/server/scene-contract.md"), general = read("public/plugins/general/plugin.md");
  for (const phrase of ['sourceFormat:"penecho-scene+json"', 'engine:"motion"', 'engine:"physics"', 'engine:"3d"', "along", "camera", "constraints", "spin"]) assert.ok(contract.includes(phrase), phrase);
  const example = JSON.parse(/Example: `(\{.*\})`/.exec(contract)[1]);
  assert.equal(SCENE.validate(example).ok, true);
  assert.ok(Buffer.byteLength(general, "utf8") <= 12000);
  assert.match(general, /prefer the Motion scene path/);
});

test("the Widget host loads only the pinned engine a scene needs and relays scene controls", () => {
  const host = read("public/widget-host.js");
  assert.match(host, /sceneEngineUrls = Object\.freeze\(\{[\s\S]*?motion:new URL\("scene-vendor\/anime\.js\?v=4\.5\.0"[\s\S]*?physics:new URL\("scene-vendor\/matter\.js\?v=0\.20\.0"[\s\S]*?"3d":new URL\("scene-vendor\/zdog\.js\?v=1\.1\.3"/);
  assert.match(host, /concat\(sceneEngine && Object\.hasOwn\(sceneEngineUrls, sceneEngine\) \? \[sceneSpecUrl, sceneRuntimeUrl, sceneEngineUrls\[sceneEngine\]\]\.filter\(Boolean\) : \[\]\)/);
  assert.match(host, /puppet:"",/);
  assert.match(host, /for \(const url of \[sceneSpecUrl, sceneEngineUrls\[sceneEngine\], sceneRuntimeUrl\]\.filter\(Boolean\)\)/);
  assert.match(host, /penecho-scene-control" && \["replay", "play", "pause", "toggle"\]\.includes\(message\.action\)/);
  for (const file of ["anime-4.5.0.umd.min.js", "matter-0.20.0.min.js", "zdog-1.1.3.dist.min.js", "anime.LICENSE", "matter.LICENSE", "zdog.LICENSE"]) {
    assert.ok(fs.existsSync(path.join(root, "public", "vendor", "scene", file)), file);
  }
  for (const license of ["anime.LICENSE", "matter.LICENSE", "zdog.LICENSE"]) assert.match(read(`public/vendor/scene/${license}`), /MIT License/);
  assert.match(read("NOTICE"), /under the MIT License:\n- anime\.js 4\.5\.0[\s\S]*?matter-js 0\.20\.0[\s\S]*?Zdog 1\.1\.3[\s\S]*?remains AGPL-3\.0-only/);
  assert.match(read("LICENSE"), /GNU AFFERO GENERAL PUBLIC LICENSE/);
});

test("hover shows the Widget header; the header carries Interact, specific suggestions and Refine", () => {
  const app = read("public/app.js");
  const chrome = functionSource(app, "objectChromeSpecs"), tools = functionSource(app, "addWidgetToolSpecs");
  assert.match(chrome, /!\["select", "hand", "pen"\]\.includes\(state\.mode\)\) return \[\];/);
  assert.match(tools, /widgetAssistHeaderSuggestions\(widget\)[\s\S]*?kind:"suggest"[\s\S]*?runWidgetAssistAction\(widget, suggestion, "header"\)/);
  assert.match(tools, /kind:"refine"[\s\S]*?marks:refineCandidate\?\.instructionMode === "nearby-dirty"/);
  assert.match(tools, /const order = \["interact", "suggest", "refine", "notecategory", "notebookmark", "notelibrary", "favorite"/);
  assert.match(functionSource(app, "beginObjectChromeMove"), /\["hand", "pen"\]\.includes\(state\.mode\) && \["widget", "image", "animation"\]\.includes\(spec\.target\)/);
  assert.match(functionSource(app, "widgetHeaderHoverAllowed"), /!state\.drawing[\s\S]*?!state\.interactingWidgetId[\s\S]*?\["pen", "hand", "select"\]\.includes\(state\.mode\)/);
  assert.match(functionSource(app, "releaseWidgetHeaderToken"), /hideHandObjectToolbar\(\{ key \}\)/);
  assert.match(functionSource(app, "scheduleWidgetHeaderLeave"), /chrome-hover:[\s\S]*?scheduleWidgetHeaderLeave\(400\)/);
  // A stray click outside a live Widget ends interaction without drawing.
  assert.match(app, /const inPlace = state\.widgetInteractionInPlace === true;[\s\S]*?setWidgetInteraction\(null\);[\s\S]*?if \(inPlace\) return;/);
  const css = read("public/style.css");
  assert.match(css, /#viewport:not\(\.view-mode\):not\(\.temporary-hand\) \.canvas-widget\.is-interacting \{ pointer-events: auto;/);
  assert.match(css, /\.widget-refine-confirmation\.widget-refine-panel \{[^}]*flex-direction: column/);
});

test("Refine requests carry an explicit instruction for tapped suggestions and Ask", () => {
  const app = read("public/app.js"), server = read("src/server/main.js");
  assert.match(functionSource(app, "widgetEditContext"), /instruction = typeof options\.instruction === "string" \? options\.instruction\.trim\(\)\.slice\(0, 600\)/);
  assert.match(functionSource(app, "requestWidgetRefinement"), /\["pen", "hand", "select"\]\.includes\(state\.mode\)/);
  const canonical = functionSource(server, "canonicalWidgetEdit");
  assert.match(canonical, /\["nearby-dirty", "viewport-dirty", "canvas-dirty", "implicit-polish", "action", "ask"\]\.includes\(value\.instructionMode\)/);
  assert.match(canonical, /\["action", "ask"\]\.includes\(value\.instructionMode\) && !instruction/);
  assert.match(server, /For action and ask, widgetEdit\.instruction is the user's explicit requested change/);
  assert.match(functionSource(server, "widgetRefineRequestText"), /currentMetadata\.widgetEdit = \{ box, instructionMode, \.\.\.\(instruction \? \{ instruction \} : \{\}\)/);
});

function assistHarness(widget, overrides = {}) {
  const source = read("src/client/app/widget-assist.js");
  const context = {
    state:{ language:"en", scale:1, widgets:[widget], widgetRefineConfirmation:null, ...overrides.state },
    document:{ addEventListener(){}, createElement:() => ({ getContext:() => null }) },
    currentWidgetRefineCandidate:() => overrides.candidate || null,
    smartSuggest:{enabled:true},
    suggestionAccessBlocked:() => false,
    SMART_SUGGEST_TIMEOUT_MS:8500,
    WIDGET_CLASSIFY_SNAPSHOT_TIMEOUT_MS:8000,
    WIDGET_CLASSIFY_SNAPSHOT_REUSE_MS:2000,
    performance,
    widgetSnapshotFresh:widget => Boolean(widget.snapshotImage),
    smartSuggestRemote:() => false,
    structuredClone,
    Math, JSON, Number, String, Object, Array, Map, Set, Boolean, Date,
    PenEchoIllustrationStyle:require("../src/shared/illustration-style.js"),
    ...overrides.context,
  };
  vm.runInNewContext(`${source}\n;${overrides.transport?'widgetAssistCrop=()=>"data:image/png;base64,AAAA";widgetAssistCropRegion=()=>({});':''}globalThis.api={widgetAssistSuggestions,widgetAssistHeaderSuggestions,widgetAssistPanelSuggestions,widgetAssistPanelMore,widgetAssistInstruction,widgetAssistMarks,widgetAssistCropRegion,widgetAssistEntry,widgetAssistQuestions,widgetAssistFactText,runWidgetAssistAction,widgetAssistPrefetch,requestWidgetAssistSuggestions,cancelWidgetAssistSuggestions,resumeWidgetAssistSuggestions,WIDGET_ASSIST_ACTIONS,widgetAssist,widgetAssistActionLabel};`, context);
  return { api:context.api, context };
}

test("Widget Assist ranks specific, local-first suggestions from the Widget's own facts", () => {
  const broken = { id:"w1", widgetType:"html_widget", title:"Clock", w:900, html:"<div id=a></div><script>setInterval(()=>{},1000)</script>", runtimeDiagnostics:{ errors:[{ message:"x is not defined" }] } };
  const plain = value => JSON.parse(JSON.stringify(value));
  let ranked = assistHarness(broken).api.widgetAssistHeaderSuggestions(broken).map(item => item.id).slice();
  assert.deepEqual(plain(ranked), [], "removed repair actions cannot reappear from runtime facts");
  const marked = { id:"w2", widgetType:"html_widget", title:"Chart", w:900, html:"<svg><rect/></svg>" };
  ranked = assistHarness(marked, { candidate:{ widget:marked, instructionMode:"nearby-dirty" } }).api.widgetAssistHeaderSuggestions(marked).map(item => item.id).slice();
  assert.equal(ranked[0], "apply_marks");
  const scene = { id:"w3", widgetType:"html_widget", title:"Sine", w:900, sourceFormat:SCENE.FORMAT, copyText:SCENE.formatSource(motion), html:"" };
  const suggestions = assistHarness(scene).api.widgetAssistSuggestions(scene).map(item => item.id).slice();
  assert.equal(suggestions[0], "animate");
  assert.ok(suggestions.includes("animate_sketch"));
  assert.ok(!suggestions.includes("add_controls"));
  assert.ok(!suggestions.includes("scene_replay"));
});

test("explicit Widget suggestions retry once, reuse current pixels immediately and allow a new manual request",async()=>{
  const widget={id:'recover-widget',widgetType:'html_widget',w:600,h:400,html:'<svg></svg>',snapshotImage:{},snapshotTakenAt:performance.now()+60000};
  const timers=new Map();let nextTimer=1,calls=0,preparations=0,fail=true;
  const {api,context}=assistHarness(widget,{transport:true,state:{handToolbarActiveKey:'widget:recover-widget'},context:{
    AbortController,smartSuggest:{enabled:true,available:true},authenticatedApiHeaders:x=>x,suggestionApiPath:()=>'/api/suggest',
    canvasDocumentsCurrent:()=>({id:'current'}),requestWidgetSnapshot:()=>{preparations++;return new Promise(()=>{});},updateSuggestionAccess(){},requestInteractionLayerRender(){},debug(){},
    setTimeout:(fn,delay)=>{const id=nextTimer++;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:async()=>{calls++;return {ok:!fail,status:fail?503:200,json:async()=>fail?{ok:false,reason:'suggestions_unavailable'}:{ok:true,answers:{action:{choice:'note',probabilities:{note:1}}}}};},
  }});
  const tick=async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();await new Promise(resolve=>setImmediate(resolve));};
  await api.widgetAssistPrefetch(widget);api.resumeWidgetAssistSuggestions();assert.equal(calls,0,'a visible header never requests ranking');
  context.state.widgetRefineConfirmation={widgetId:widget.id};
  await api.widgetAssistPrefetch(widget,'panel');api.resumeWidgetAssistSuggestions();assert.equal(calls,0,'a confirmation without a requested key cannot start ranking');
  await api.requestWidgetAssistSuggestions(widget);assert.equal(calls,1);assert.equal(timers.size,1);
  assert.equal(context.state.widgetRefineConfirmation.assistStatus,'failed');
  await api.widgetAssistPrefetch(widget);assert.equal(calls,1,'hover cannot bypass retry pacing');
  await tick();assert.equal(calls,2);assert.equal(timers.size,0);assert.equal(preparations,0);
  api.resumeWidgetAssistSuggestions();await api.widgetAssistPrefetch(widget);assert.equal(calls,2,'recovery and hover cannot exceed one retry');
  fail=false;await api.requestWidgetAssistSuggestions(widget);assert.equal(calls,3);assert.equal(timers.size,0);assert.equal(api.widgetAssist.cache.size,1);
  api.widgetAssist.cache.clear();fail=true;await api.requestWidgetAssistSuggestions(widget);
  context.state.widgetRefineConfirmation=null;await tick();assert.equal(calls,4);assert.equal(timers.size,0);
  context.state.widgetRefineConfirmation={widgetId:widget.id};await api.requestWidgetAssistSuggestions(widget);
  api.cancelWidgetAssistSuggestions();assert.equal(timers.size,0);assert.equal(api.widgetAssist.retries.size,0);
});

test("a missing Widget image is captured before classification; failure sends nothing and releases ownership",async()=>{
  for(const outcome of ['captured','failed']){
    const widget={id:'missing-image',widgetType:'html_widget',w:600,h:400,html:'<svg></svg>',snapshotImage:null};
    let calls=0;const preparations=[],delays=[];
    const {api,context}=assistHarness(widget,{transport:true,state:{widgetRefineConfirmation:{widgetId:widget.id}},context:{
      AbortController,smartSuggest:{enabled:true,available:true},canvasDocumentsCurrent:()=>({id:'current'}),authenticatedApiHeaders:x=>x,suggestionApiPath:()=>'/api/suggest',updateSuggestionAccess(){},
      requestWidgetSnapshot:async(target,timeoutMs,requireFresh,signal)=>{preparations.push({target,timeoutMs,requireFresh,aborted:signal.aborted,modelDeadline:delays.includes(8500)});if(outcome==='failed')throw Object.assign(Error('capture failed'),{code:'WIDGET_CAPTURE_FAILED'});target.snapshotImage={};return target.snapshotImage;},
      requestInteractionLayerRender(){},debug(){},
      setTimeout:(fn,delay)=>{delays.push(delay);return setTimeout(fn,delay);},clearTimeout,
      fetch:async()=>{calls++;return {ok:true,json:async()=>({ok:true,answers:{action:{choice:'note',probabilities:{note:1}}}})};},
    }});
    await api.requestWidgetAssistSuggestions(widget);
    assert.equal(preparations.length,1);assert.equal(preparations[0].target,widget);assert.equal(preparations[0].timeoutMs,8000);
    assert.equal(preparations[0].requireFresh,true);assert.equal(preparations[0].aborted,false);assert.equal(preparations[0].modelDeadline,false,"the model deadline starts after capture");
    assert.equal(calls,outcome==='captured'?1:0,"an image without the Widget's pixels is never sent");
    assert.equal(api.widgetAssist.inflight.size,0);assert.equal(api.widgetAssist.controllers.size,0);
  }
});

test("Widget ranking ignores the automatic toggle, reuses matching cache and rejects changed targets",async()=>{
  const widget={id:'manual-widget',widgetType:'html_widget',w:600,h:400,html:'<svg></svg>'};
  let calls=0,release;
  const {api,context}=assistHarness(widget,{transport:true,state:{widgetRefineConfirmation:{widgetId:widget.id}},context:{
    AbortController,smartSuggest:{enabled:false,available:true},authenticatedApiHeaders:x=>x,suggestionApiPath:()=>'/api/suggest',
    canvasDocumentsCurrent:()=>({id:'current'}),requestWidgetSnapshot:async target=>{target.snapshotImage={};return target.snapshotImage;},updateSuggestionAccess(){},requestInteractionLayerRender(){},debug(){},
    setTimeout,clearTimeout,
    fetch:async()=>{calls++;await new Promise(resolve=>{release=resolve;});return {ok:true,json:async()=>({ok:true,answers:{action:{choice:'note',probabilities:{note:1}}}})};},
  }});
  const request=api.requestWidgetAssistSuggestions(widget);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  const duplicate=api.requestWidgetAssistSuggestions(widget);assert.equal(calls,1);
  release();await request;await duplicate;assert.equal(context.state.widgetRefineConfirmation.assistStatus,'ranked');
  context.state.widgetRefineConfirmation={widgetId:widget.id};
  await api.widgetAssistPrefetch(widget,'panel');assert.equal(calls,1);
  assert.equal(context.state.widgetRefineConfirmation.assistRequestedKey,undefined,'an unrequested confirmation does not reveal cached ranking');
  await api.requestWidgetAssistSuggestions(widget);assert.equal(calls,1,'requesting suggestions reuses the cached answer');
  widget.html='<svg><rect/></svg>';
  api.resumeWidgetAssistSuggestions();assert.equal(calls,1,'content changes require another click');
  const changed=api.requestWidgetAssistSuggestions(widget);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
  widget.html='<svg><circle/></svg>';release();await changed;
  assert.equal(api.widgetAssist.cache.size,1,'an answer for old content is not cached or displayed');
  const cancelled=api.requestWidgetAssistSuggestions(widget);await new Promise(resolve=>setImmediate(resolve));
  context.state.widgetRefineConfirmation=null;api.cancelWidgetAssistSuggestions();release();await cancelled;
  assert.equal(api.widgetAssist.cache.size,1,'closing Refine discards the in-flight answer');
  assert.equal(api.widgetAssist.inflight.size,0);assert.equal(api.widgetAssist.retries.size,0);
});

test("automatic suggestions can be hidden from Widget headers while manual Refine remains available", () => {
  const widget = { id:"automatic", widgetType:"html_widget", title:"Illustration", w:400, html:"<svg></svg>", runtimeDiagnostics:{ errors:[{ message:"failed" }] } };
  const { api, context } = assistHarness(widget);
  api.widgetAssist.cache.set(api.widgetAssistEntry(widget).key, {answers:{action:{choice:"animate",probabilities:{animate:1}}}});
  assert.ok(api.widgetAssistHeaderSuggestions(widget).length > 0);
  context.smartSuggest.enabled = false;
  assert.equal(api.widgetAssistHeaderSuggestions(widget).length, 0);
  assert.ok(api.widgetAssistSuggestions(widget).length > 0, "Refine keeps its explicit action choices");
  context.smartSuggest.enabled = true;
  assert.ok(api.widgetAssistHeaderSuggestions(widget).length > 0);
});

test("JeVision ranking replaces local priorities for every Widget action", () => {
  const widget = { id:"ranked", widgetType:"html_widget", title:"Illustration", w:900,
    html:"<style>svg { transition:transform .2s }</style><svg></svg>", runtimeDiagnostics:{ errors:[{ message:"failed" }] } };
  const { api } = assistHarness(widget, { candidate:{ widget, instructionMode:"nearby-dirty" } });
  assert.equal(api.widgetAssistSuggestions(widget)[0].id, "apply_marks");
  const probabilities = { none:0.01, note:0.45, present:0.2, larger_text:0.15, add_controls:0.09, fix_error:0.05, apply_marks:0.03, simplify:0.02, fix_layout:0 };
  api.widgetAssist.cache.set(api.widgetAssistEntry(widget).key, { answers:{ action:{ choice:"note", probabilities }, marks_intent:{ noul:1 } } });
  const suggestions = api.widgetAssistSuggestions(widget);
  assert.deepEqual(Array.from(suggestions, item => item.id), ["note", "apply_marks", "simplify"]);
  for (const item of suggestions) assert.equal(item.score, probabilities[item.id]);
  assert.deepEqual(Array.from(api.widgetAssistHeaderSuggestions(widget), item => item.id), ["note"]);
});

test("all Widgets exclude labels even from an old model response and offer ranked notes", () => {
  const widget = { id:"ordinary", widgetType:"html_widget", title:"Lesson", w:900, html:"<p>A useful lesson</p>" };
  const { api } = assistHarness(widget);
  const questions = api.widgetAssistQuestions(widget, api.widgetAssistEntry(widget).facts, false);
  assert.ok(questions.action.criteria.note);
  assert.equal(questions.action.criteria.add_labels, undefined);
  api.widgetAssist.cache.set(api.widgetAssistEntry(widget).key, { answers:{ action:{ choice:"add_labels", probabilities:{add_labels:0.8,note:0.15,present:0.05} } } });
  assert.deepEqual(Array.from(api.widgetAssistPanelSuggestions(widget), item => item.id), ["note"]);
  const diagram = { ...widget, id:"diagram", widgetType:"diagram_source", source:"flowchart LR\nA-->B" };
  const diagramApi = assistHarness(diagram).api;
  assert.equal(diagramApi.widgetAssistQuestions(diagram, diagramApi.widgetAssistEntry(diagram).facts, false).action.criteria.add_labels, undefined);
  assert.ok(!diagramApi.WIDGET_ASSIST_ACTIONS.some(action => action.id === "add_labels"));
  const note = { ...widget, sourceFormat:"penecho-note-card+json" }, noteApi = assistHarness(note).api;
  assert.equal(noteApi.widgetAssistQuestions(note, noteApi.widgetAssistEntry(note).facts, false).action.criteria.note, undefined);
});

test("Make notes closes Refine and creates a note from the target Widget", async () => {
  const widget = { id:"notes-widget" }, calls = [];
  const { api } = assistHarness(widget, { state:{widgetRefineConfirmation:{widgetId:widget.id}}, context:{
    debug(){}, cancelWidgetRefineConfirmation:()=>calls.push("close-refine"),
    organizeWidgetAsNote:async item=>{ assert.equal(item,widget); calls.push("create-note"); return true; },
  } });
  assert.equal(await api.runWidgetAssistAction(widget,{id:"note"},"panel"),true);
  assert.deepEqual(calls,["close-refine","create-note"]);
});

test("JeVision none suppresses panel and header suggestions, including local actions and errors", () => {
  const widget = { id:"finished", widgetType:"html_widget", title:"Illustration", w:900,
    html:"<svg></svg>", runtimeDiagnostics:{ errors:[{ message:"failed" }] } };
  const { api } = assistHarness(widget, { candidate:{ widget, instructionMode:"nearby-dirty" } });
  assert.ok(api.widgetAssistSuggestions(widget).length > 0, "local predictions remain available before an answer");
  api.widgetAssist.cache.set(api.widgetAssistEntry(widget).key, { answers:{ action:{ choice:"none", probabilities:{ none:0.9678, present:0.0108, animate:0.0095, fix_error:0.006, apply_marks:0.0059 } } } });
  assert.equal(api.widgetAssistSuggestions(widget).length, 0);
  assert.equal(api.widgetAssistHeaderSuggestions(widget).length, 0);
});

test("Widget action space retains the two animation intents and excludes the removed utility actions", () => {
  for (const html of ["<svg></svg>", "<style>svg { transition:transform .2s }</style><svg></svg>", "<script>requestAnimationFrame(draw)</script>"]) {
    const widget = { id:"art", widgetType:"html_widget", title:"Character illustration", w:400, html };
    const { api } = assistHarness(widget), { facts, marks } = api.widgetAssistEntry(widget);
    for (const id of ["make_interactive", "larger_text", "fix_error", "fix_layout", "match_theme", "add_controls", "scene_replay", "scene_slower", "scene_faster", "present"]) {
      assert.ok(!api.WIDGET_ASSIST_ACTIONS.some(action => action.id === id));
      assert.equal(api.widgetAssistQuestions(widget, facts, marks).action.criteria[id], undefined);
      assert.ok(!api.widgetAssistHeaderSuggestions(widget).some(item => item.id === id));
    }
    assert.match(api.WIDGET_ASSIST_ACTIONS.find(action => action.id === "vivid").instruction, /separate[\s\S]*original Widget unchanged/);
  }
});

test("Refine limits model recommendations to three and never uses local guesses in the panel", () => {
  const widget = { id:"three", widgetType:"html_widget", w:400, html:"<svg></svg>" };
  const { api } = assistHarness(widget, { candidate:{ widget, instructionMode:"nearby-dirty" } });
  assert.equal(api.widgetAssistPanelSuggestions(widget).length, 0);
  const probabilities = { apply_marks:.4, make_interactive:.3, animate:.2, larger_text:.16, fix_layout:.12, note:.08, simplify:.06, present:.04 };
  api.widgetAssist.cache.set(api.widgetAssistEntry(widget).key, { answers:{ action:{ choice:"apply_marks", probabilities } } });
  assert.deepEqual(Array.from(api.widgetAssistPanelSuggestions(widget), item => item.id), ["animate", "note", "simplify"]);
  api.widgetAssist.cache.set(api.widgetAssistEntry(widget).key, { answers:{ action:{ choice:"none", probabilities:{ none:1 } } } });
  assert.equal(api.widgetAssistPanelSuggestions(widget).length, 0);
});

test("Refine includes viewport dirty marks without a nearby candidate and invalidates changed ink", () => {
  const widget = { id:"dirty", x:100, y:100, w:400, h:300, html:"<svg></svg>" },
    dirty = { x:620, y:200, w:80, h:100 };
  const { api, context } = assistHarness(widget, { state:{ userRevision:7, dirty, widgetRefineConfirmation:{ widgetId:widget.id, hasDirty:true } }, context:{
    widgetBox:item => ({ x:item.x, y:item.y, w:item.w, h:item.h }),
    viewportRect:() => ({ x:0, y:0, w:1000, h:800 }), intersection:() => dirty,
  } });
  assert.equal(api.widgetAssistMarks(widget), true);
  assert.deepEqual(JSON.parse(JSON.stringify(api.widgetAssistCropRegion(widget))), { x:92, y:92, w:616, h:316 });
  const key = api.widgetAssistEntry(widget).key;
  api.widgetAssist.cache.set(key, { answers:{ action:{ choice:"apply_marks", probabilities:{ apply_marks:1 } } } });
  context.state.userRevision++;
  assert.notEqual(api.widgetAssistEntry(widget).key, key);
  assert.equal(api.widgetAssistEntry(widget).cached, null);
});

test("tapping a suggestion runs a focused Refine; local actions never call the model", () => {
  const plain = value => JSON.parse(JSON.stringify(value));
  const widget = { id:"w1", widgetType:"html_widget", title:"Chart", w:900, html:"<svg></svg>" };
  const calls = [];
  const { api, context } = assistHarness(widget, { context:{
    requestWidgetRefinement:(...args) => { calls.push(["refine", ...args]); return true; },
    confirmWidgetRefinement:options => { calls.push(["confirm", options]); return true; },
    cancelWidgetRefineConfirmation:() => calls.push(["cancel"]),
    triggerWidgetRefineClickPulse:() => {},
    enterWidgetInteraction:item => { calls.push(["interact", item.id]); return true; },
    widgetHeaderRefineCandidate:() => ({ instructionMode:"nearby-dirty" }),
    debug(){},
  } });
  const vivid = api.WIDGET_ASSIST_ACTIONS.find(action => action.id === "vivid");
  api.runWidgetAssistAction(widget, { id:"vivid", action:vivid });
  assert.equal(calls[0][0], "refine");
  assert.equal(calls[0][2], "action");
  assert.equal(calls[0][3].actionId, "vivid");
  // The default illustration style is Storybook; the setting switches both label and instruction.
  assert.match(calls[0][3].instruction, /picture-book illustration[\s\S]*separate illustrated Widget[\s\S]*original Widget unchanged/);
  assert.equal(api.widgetAssistActionLabel(vivid), "Storybook illustration");
  context.state.illustrationStyle = "3d";
  assert.equal(api.widgetAssistActionLabel(vivid), "3D illustration");
  api.runWidgetAssistAction(widget, { id:"vivid", action:vivid });
  assert.match(calls.at(-1)[3].instruction, /soft 3D illustration[\s\S]*specular highlights[\s\S]*separate illustrated Widget/);
  calls.splice(1);
  context.state.illustrationStyle = "storybook";
  api.runWidgetAssistAction(widget, { id:"present", action:api.WIDGET_ASSIST_ACTIONS.find(action => action.id === "present") });
  assert.equal(api.runWidgetAssistAction(widget, {id:"present"}), false);
  assert.equal(calls.filter(call => call[0] === "refine").length, 1);
  api.runWidgetAssistAction(widget, { id:"apply_marks", action:api.WIDGET_ASSIST_ACTIONS[0] });
  assert.equal(calls.at(-1)[0], "refine");
  assert.equal(calls.at(-1)[1], widget);
  assert.equal(calls.at(-1)[2], "nearby-dirty");
});

test("removed Present cannot run from Refine", () => {
  const widget = { id:"present-widget" }, calls = [];
  const { api, context } = assistHarness(widget, {
    state:{ widgetRefineConfirmation:{ widgetId:widget.id } },
    context:{
      cancelWidgetRefineConfirmation:() => {
        calls.push("close-refine");
        context.state.widgetRefineConfirmation = null;
      },
      enterWidgetInteraction:item => {
        assert.equal(item, widget);
        assert.equal(context.state.widgetRefineConfirmation, null);
        calls.push("interact");
        return false;
      },
      debug(){},
    },
  });
  assert.equal(api.runWidgetAssistAction(widget, { id:"present" }, "panel"), false);
  assert.deepEqual(calls, []);
});


test("Make notes remains in Refine More without promotion and is excluded on note cards", () => {
  const widget={id:"more",widgetType:"html_widget",title:"Formula",w:400,html:"<p>x=2</p>"}, {api}=assistHarness(widget);
  for(const probabilities of [{animate:.6,animate_sketch:.3,simplify:.1,note:0},{none:1}]) {
    api.widgetAssist.cache.set(api.widgetAssistEntry(widget).key,{answers:{action:{choice:probabilities.none?"none":"animate",probabilities}}});
    assert.ok(!api.widgetAssistPanelSuggestions(widget).some(item=>item.id==="note"));
    assert.equal(api.widgetAssistPanelMore(widget).filter(item=>item.id==="note").length,1);
  }
  const note={...widget,sourceFormat:"penecho-note-card+json"}, notes=assistHarness(note,{context:{debug(){}}}).api;
  notes.widgetAssist.cache.set(notes.widgetAssistEntry(note).key,{answers:{action:{choice:"note",probabilities:{note:1}}}});
  assert.ok(![...notes.widgetAssistSuggestions(note),...notes.widgetAssistPanelMore(note)].some(item=>item.id==="note"));
  assert.equal(notes.runWidgetAssistAction(note,{id:"note"}),false);
});

test("Widget animations reuse the established tasks and keep the two existing labels", () => {
  const agent=read("src/client/app/assist-agent.js"), start=agent.indexOf("  const ASSIST_AGENT_TASKS ="), end=agent.indexOf("  function assistAgentCard",start);
  const tasks=vm.runInNewContext(agent.slice(start,end)+"\nASSIST_AGENT_TASKS",{PenEchoIllustrationStyle:require("../src/shared/illustration-style.js"),PenEchoFinishDrawing:require("../src/shared/finish-drawing.js")});
  const widget={id:"animate",widgetType:"html_widget",html:"<svg></svg>"}, calls=[],{api}=assistHarness(widget,{context:{ASSIST_AGENT_TASKS:tasks,debug(){},triggerWidgetRefineClickPulse(){},requestWidgetRefinement:(...args)=>calls.push(args)}});
  for(const id of ["animate","animate_sketch"]) {
    const action=api.WIDGET_ASSIST_ACTIONS.find(item=>item.id===id), instruction=api.widgetAssistInstruction(action);
    assert.ok(instruction.startsWith(tasks[id]));
    assert.match(instruction,/one separate animated Widget with a new artifactId/);
    assert.match(instruction,/preserving the original Widget unchanged/);
    api.runWidgetAssistAction(widget,{id});
    assert.equal(calls.at(-1)[0],widget);assert.equal(calls.at(-1)[2].actionId,id);
    assert.equal(api.widgetAssistActionLabel(action),require("../public/smart-suggest.js").label(require("../public/smart-suggest.js").actionById(id),"en"));
  }
  assert.match(api.widgetAssistInstruction(api.WIDGET_ASSIST_ACTIONS.find(item=>item.id==="animate")),/For notes[\s\S]*For diagrams[\s\S]*Do not invent/);
});
