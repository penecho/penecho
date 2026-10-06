'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const SMART=require('../public/smart-suggest.js'),SCENE=require('../public/scene-spec.js');
const {validateToolArguments,TOOLS}=require('../src/server/mcp/schema.js');
const {executeBoundCanvasTool}=require('../src/server/mcp/bound-operations.js');
const choice=route=>({type:'choice',choice:route});
test('create_visual has an independent execution verdict and visual request',()=>{
 const action=SMART.actionById('create_visual');
 assert.equal(action.label.zh,'生成可视内容');
 assert.deepEqual(action.exec,{type:'ai',action:'plot',suggestion:'create_visual'});
 const answers={action:choice('answer'),execution:choice('penecho_agent'),execution_create_visual:choice('canvas_ai')};
 assert.equal(SMART.suggestionExecution('create_visual',answers).choice,'canvas_ai');
 const ranked=SMART.rankActions({answers:{kind:{type:'choice',choice:'question'},action:{type:'choice',choice:'create_visual',probabilities:{none:.02,create_visual:.9,answer:.08}}}});
 assert.equal(ranked.items[0].id,'create_visual');
});
test('instant conditional actions use Canvas AI; only a closed JeVision choice upgrades them',()=>{
 for(const id of ['ask','answer','create_visual','explain','solve','practice','diagram','organize','vivid','finish_drawing']) {
  assert.equal(SMART.executionRoute(id), 'canvas_ai');
  assert.equal(SMART.executionRoute(id,choice('penecho_agent')), 'penecho_agent');
  for(const bad of [{choice:'penecho_agent'},choice('shell'),choice('canvas_ai')])assert.equal(SMART.executionRoute(id,bad),'canvas_ai');
 }
 for(const id of ['typeset','hint','check_step','next_step','plot','snap_shapes'])assert.equal(SMART.executionRoute(id,choice('penecho_agent')),'canvas_ai');
 for(const id of ['animate','prototype'])assert.equal(SMART.executionRoute(id),'penecho_agent');
 // Sketch animation rigs the user's own strokes in one Canvas AI response.
 assert.equal(SMART.executionRoute('animate_sketch'),'canvas_ai');
 assert.equal(SMART.executionRoute('animate_sketch',choice('penecho_agent')),'canvas_ai');
 assert.equal(SMART.executionRoute('fix_error',null,'widget'),'penecho_agent');
 assert.equal(SMART.executionRoute('fix_layout',null,'widget'),'canvas_ai');
 assert.equal(SMART.executionRoute('fix_layout',choice('penecho_agent'),'widget'),'penecho_agent');
 for(const id of ['scene_replay','scene_slower','scene_faster','present','larger_text'])assert.equal(SMART.executionRoute(id,choice('penecho_agent'),'widget'),'canvas_ai');
});
const scenes=[
 {engine:'motion',actors:[{id:'ball',type:'circle',x:100,y:100,r:20}],beats:[{steps:[{do:'move',target:'ball',to:[200,100]}]}]},
 {engine:'physics',bodies:[{id:'ball',shape:'circle',x:100,y:100,r:20}]},
 {engine:'3d',shapes:[{id:'cube',type:'box',width:80}]},
];
const base={sessionId:'s',artifactId:'a',requestId:'r',title:'Scene'};
test('MCP accepts all three scene engines with canonical editable source and rejects ambiguous or invalid content',()=>{
 const schema=TOOLS.find(t=>t.name==='penecho_present_widget').inputSchema;
 assert.ok(schema.properties.scene);assert.ok(schema.oneOf.some(x=>x.required.includes('scene')));
 for(const scene of scenes) {
  const result=validateToolArguments('penecho_present_widget',{...base,scene});
  assert.equal(result.sourceFormat,SCENE.FORMAT);
  assert.equal(result.copyText,SCENE.formatSource(scene));
  assert.match(result.html,/data-penecho-scene/);
  for(const other of ['html','architecture','sequence','workflow'])assert.throws(()=>validateToolArguments('penecho_present_widget',{...base,scene,[other]:other==='html'?'<p>x</p>':{}}),/exactly one/);
 }
 for(const scene of ['{}',{}, {engine:'motion',actors:[{id:'x',type:'circle'}],beats:[{steps:[{do:'move',target:'missing',to:[1,2]}]}]}])assert.throws(()=>validateToolArguments('penecho_present_widget',{...base,scene}),{code:'invalid_arguments'});
});
test('MCP and bound Agent compile identical scenes and preserve source across the browser boundary',async()=>{
 const {createDocumentTools}=await import('../src/server/canvas-agent/document-tools.mjs');
 for(const scene of scenes) {
  let externalArgs,agentArgs;
  const session={id:'s',connection:{},mutationRequests:new Map()};
  await executeBoundCanvasTool({name:'penecho_present_widget',args:{...base,scene},session,canvasCall:async(_connection,name,args)=>{assert.equal(name,'mcp_present_widget');externalArgs=args;return {result:{artifactId:'a',objectId:'widget-1',revision:1}};}});
  const tools=createDocumentTools({id:'s',rpc:async(name,payload)=>{assert.equal(name,'canvas_document');agentArgs=payload.arguments;return {artifactId:'a',objectId:'widget-1',revision:1};}});
  await tools.find(t=>t.name==='penecho_present_widget').execute({artifactId:'a',requestId:'r',title:'Scene',scene},{callId:'c',signal:new AbortController().signal});
  for(const field of ['html','sourceFormat','frameworkVersion','copyText','copyLabel'])assert.equal(agentArgs[field],externalArgs[field],field);
 }
});
test('failed Agent submission preserves input and never falls through to a duplicate AI task',async()=>{
 const source=fs.readFileSync('src/client/app/smart-suggestions.js','utf8');
 const start=source.indexOf('  async function executeAssistAction('),end=source.indexOf('  // Kept for callers',start);
 const calls=[],stroke={id:7},target={box:{x:1,y:2,w:3,h:4},strokes:[stroke]};
 let outcome='blocked';
 const context={SMART_SUGGEST:SMART,state:{language:'en'},smartSuggest:{consumedStrokeId:0},clearTimeout(){},cancelWidgetRefinement(){},supersedeActiveAI(){},assistAgentRun:async()=>outcome,smartSuggestRecent:x=>calls.push(x),hideAssist:x=>calls.push(x)};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 await context.executeAssistAction({id:'prototype'},target);assert.equal(context.smartSuggest.consumedStrokeId,0);assert.deepEqual(calls,[]);
 outcome='submitted';await context.executeAssistAction({id:'animate'},target);assert.equal(context.smartSuggest.consumedStrokeId,0,'submission keeps suggestions recoverable until completion');assert.deepEqual(calls,['accepted animate'],'submission retains the bar for source-aware request visibility');
});
test('non-primary ink and lasso actions use their saved executor without a classification request',async()=>{
 const source=fs.readFileSync('src/client/app/smart-suggestions.js','utf8');
 const start=source.indexOf('  async function executeAssistAction('),end=source.indexOf('  // Kept for callers',start);
 const calls=[],target={box:{x:1,y:2,w:3,h:4},strokes:[],routing:{action:choice('typeset'),execution:choice('canvas_ai'),execution_organize:choice('penecho_agent'),execution_explain:choice('canvas_ai')}};
 const context={SMART_SUGGEST:SMART,state:{language:'en'},smartSuggest:{cooldown:{}},assistSelectionTargetValid:()=>true,renderAssist:model=>calls.push(['working',model.label]),clearTimeout(){},cancelWidgetRefinement(){},supersedeActiveAI(){},assistRequestOptions:()=>({}),debug(){},smartSuggestRecent:()=>{},hideAssist:()=>{},assistAgentRun:async id=>{calls.push(['submit',id]);return 'submitted';},requestAI:async id=>calls.push(['ai',id]),assistClassifyRequest:()=>assert.fail('suggestion clicks must not classify')};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 await context.executeAssistAction({id:'organize'},target);
 assert.deepEqual(calls,[['submit','organize']]);
 calls.length=0;await context.executeAssistAction({id:'organize'},{...target,selection:{}});
 assert.deepEqual(calls,[['submit','organize']]);
 calls.length=0;await context.executeAssistAction({id:'explain'},target);
 assert.deepEqual(calls,[['working','Explain'],['ai','explain']]);
 for(const routing of [null,{action:choice('organize'),execution:choice('penecho_agent')}]) {
  calls.length=0;await context.executeAssistAction({id:'answer'},{...target,routing,followUp:true});
  assert.deepEqual(calls,[['working','Answer'],['ai','answer']]);
 }
});

test('ordinary Answer uses the real manual Canvas AI entry point for ink and selections regardless of ranking',async()=>{
 const source=fs.readFileSync('src/client/app/smart-suggestions.js','utf8'),core=fs.readFileSync('src/client/app/core.js','utf8');
 const start=source.indexOf('  async function executeAssistAction('),end=source.indexOf('  // Kept for callers',start);
 const manualStart=core.indexOf('  function invokeAIAction('),manualEnd=core.indexOf('  const AI_ORB_IDLE_DELAY_MS',manualStart);
 const calls=[],selection={phase:'active'},packed={sourceRect:{x:20,y:30,w:60,h:50}},target={box:{x:1,y:2,w:3,h:4},strokes:[{id:7}],routing:{action:choice('answer'),execution_answer:choice('penecho_agent')}};
 const context={SMART_SUGGEST:SMART,state:{language:'en',dirty:target.box},smartSuggest:{consumedStrokeId:0},assistSelectionTargetValid:()=>true,
  clearTimeout(){},cancelWidgetRefinement(){},supersedeActiveAI(){},hideAssist:()=>{},buildSelectionTypesetRequest:s=>{assert.equal(s,selection);return packed;},
  requestAI:(...args)=>calls.push(args),requestSelectionAI:(...args)=>calls.push(args),assistAgentRun:()=>assert.fail('manual Answer cannot be rerouted to Agent'),assistClassifyRequest:()=>assert.fail('manual Answer cannot classify its executor')};
 vm.createContext(context);vm.runInContext(core.slice(manualStart,manualEnd)+source.slice(start,end),context);
 await context.executeAssistAction({id:'answer'},target);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['auto',null,{fromSuggestBar:true,captureCurrentViewport:true}]]);
 assert.equal(context.smartSuggest.consumedStrokeId,0,'manual input is consumed by its successful request, not the shortcut click');
 assert.equal(context.state.dirty,target.box);
 calls.length=0;context.state.selection=selection;
 await context.executeAssistAction({id:'answer'},{...target,selection});
 assert.equal(calls[0][0],'auto');assert.equal(calls[0][1],selection);assert.equal(calls[0][2],packed);assert.equal(calls[0][3].fromSuggestBar,true);
 assert.equal(calls.length,1);
});

test('legacy verdicts apply only to their own action and specific verdicts take precedence',()=>{
 const answers={action:choice('answer'),execution:choice('penecho_agent'),execution_answer:choice('canvas_ai')};
 assert.equal(SMART.executionRoute('answer',SMART.suggestionExecution('answer',answers)),'canvas_ai');
 delete answers.execution_answer;
 assert.equal(SMART.executionRoute('answer',SMART.suggestionExecution('answer',answers)),'penecho_agent');
 assert.equal(SMART.executionRoute('explain',SMART.suggestionExecution('explain',answers)),'canvas_ai');
});

test('Widget actions ignore saved executor verdicts and use the central Refine entry point',async()=>{
 const source=fs.readFileSync('src/client/app/widget-assist.js','utf8');
 const start=source.indexOf('  function runWidgetAssistAction('),end=source.indexOf('  async function submitWidgetAsk(',start);
 const calls=[],widget={id:'w'},answers={action:choice('animate'),execution:choice('penecho_agent'),execution_fix_layout:choice('canvas_ai'),execution_apply_marks:choice('penecho_agent')};
 const context={window:{PENECHO_SMART_SUGGEST:SMART},state:{widgets:[widget]},debug(){},widgetAssistEntry:()=>({cached:{answers}}),widgetBox:()=>({x:1,y:2,w:3,h:4}),widgetAssistActionLabel:a=>a.id,triggerWidgetRefineClickPulse(){},requestWidgetRefinement:(_w,_mode,options)=>{calls.push(['refine',options.actionId]);return true;},assistAgentRun:()=>assert.fail('Widget actions must use the central Refine router'),assistClassifyRequest:()=>assert.fail('Widget clicks must not classify')};
 context.PenEchoIllustrationStyle=require('../src/shared/illustration-style.js');
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  function widgetAssistInstruction('),source.indexOf('  function widgetAssistChipWidth('))+source.slice(start,end),context);
 for(const id of ['fix_layout','apply_marks'])await context.runWidgetAssistAction(widget,{action:{id,kind:'ai',instruction:'Edit'}});
 assert.deepEqual(calls,[['refine','fix_layout'],['refine','apply_marks']]);
});

test('ranking updates hovered buttons executor without moving them or adopting another target verdict',()=>{
 const source=fs.readFileSync('src/client/app/smart-suggestions.js','utf8');
 const start=source.indexOf('  function assistRefresh(reason'),end=source.indexOf('  // Compatibility for callers',start);
 const target={},cluster={key:'a',box:{w:100,h:100}},routing={execution_answer:choice('penecho_agent')};
 const context={performance,smartSuggest:{bar:{mode:'suggest',hovered:true,target,cluster}},state:{scale:1},smartSuggestActive:()=>true,assistRequestsActive:()=>false,smartSuggestResultCluster:()=>null,smartSuggestReopenedInk:()=>false,assistSuggestBlocked:()=>false,smartSuggestCluster:()=>cluster,assistView:()=>({items:[{id:'answer'}],routing}),assistRefreshRank(){},renderAssist:()=>assert.fail('hovered buttons must stay still')};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 context.assistRefresh('ranking');assert.equal(target.routing,routing);
 context.smartSuggest.bar.cluster={key:'old'};target.routing=null;
 context.assistRefresh('ranking');assert.equal(target.routing,null);
});
