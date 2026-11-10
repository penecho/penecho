'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function harness() {
  const calls=[],captures=[],historyEntry={},visible={x:50,y:80,w:900,h:600};
  const context={
    PenEchoFinishDrawing:require('../src/shared/finish-drawing.js'),
    PenEchoIllustrationStyle:require('../src/shared/illustration-style.js'),
    window:{addEventListener(){}},smartSuggest:{enabled:true,strokes:[]},
    captureDirtyInput:box=>({box}), captureSelectionDirtyInput:selection=>({selection,box:selection.box}), consumeAllDirtyInput:()=>{context.consumed=true;context.state.dirty=null;}, releaseDirtyInput(){}, smartSuggestInputConsumed(){}, state:{language:'zh',history:[historyEntry],widgets:[],dirty:{x:180,y:180,w:1800,h:1800}},
    canvasAgent:{currentConversation:{id:'conversation',items:[]}},canvasDocumentsCurrent:()=>({id:'canvas'}),
    canvasAgentExecutionAvailable:()=>true,allAiConnections:()=>[{}],canvasDocumentsExternal:()=>false,
    requireAiConnectionSelection:()=>true,selectedAiConnectionId:()=> 'connection',viewportRect:()=>visible,
    intersection:(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),w=Math.min(a.x+a.w,b.x+b.w)-x,h=Math.min(a.y+a.h,b.y+b.h)-y;return w>0&&h>0?{x,y,w,h}:null;},
    assistUnion:(a,b)=>{if(!a)return b;if(!b)return a;const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};},
    assistSelectionTargetValid:()=>true,
    buildSelectionImage:()=>({atlasImage:'data:image/png;base64,bWFza2Vk',atlasSize:{w:200,h:160}}),
    prepareVisibleWidgetSnapshots:async()=>({missing:0}),
    canvasAgentCapture:async(args,options)=>{captures.push(args);options.assertCurrent();return {dataUrl:'data:image/webp;base64,c2tldGNo',width:1000,height:800};},
    canvasAgentSubmitMessage:async options=>{calls.push(options);return true;},
  };
  vm.createContext(context);
  const suggest=fs.readFileSync('src/client/app/smart-suggestions.js','utf8'), start=suggest.indexOf('  function assistFinishDrawingInk('), end=suggest.indexOf('\n  function ',start+1);
  vm.runInContext(suggest.slice(start,end),context);
  vm.runInContext(fs.readFileSync('src/client/app/assist-agent.js','utf8')+'\nassistAgentShow=()=>{assistAgent.active=true;assistAgent.status={textContent:""};}; globalThis.agent=assistAgent;',context);
  return {context,calls,captures,visible,target:{box:{x:100,y:120,w:200,h:160},newBox:{x:190,y:200,w:30,h:40},strokes:[{id:1,historyEntry}]}};
}

test('Suggest-to-Agent preparation blocks suggestions until the Agent owns the request',async()=>{
  const {context,target}=harness(), requests=new Map(), finished=[];
  let releaseCapture;
  const captured=new Promise(resolve=>{releaseCapture=resolve;});
  context.assistRequestStarted=(owner,{hideSuggestions=false}={})=>requests.set(owner,hideSuggestions);
  context.assistRequestFinished=(owner,outcome)=>{requests.delete(owner);finished.push(outcome);};
  context.canvasAgentCapture=async()=>{await captured;return {dataUrl:'data:image/webp;base64,c2tldGNo',width:200,height:160};};
  context.canvasAgentSubmitMessage=async()=>{context.canvasAgent.requestPending=true;return true;};
  const pending=context.assistAgentRun('animate_sketch',target,{label:'Animate sketch',fromSuggestBar:true});
  assert.equal(context.agent.preparing,true);
  assert.deepEqual([...requests.values()],[true],'Suggest image preparation must already hide the bar');
  releaseCapture();
  assert.equal(await pending,'submitted');
  assert.equal(context.agent.preparing,false);
  assert.equal(requests.size,0);
  assert.deepEqual(finished,['superseded'],'handoff keeps the Agent request in control of restoration');
});

test('successful scoped Agent output closes only its original selection',()=>{
  const {context,target}=harness(),selection={},shown=[];
  context.state.selection=selection;
  context.commitSelection=()=>{context.state.selection=null;};
  context.renderAssist=model=>shown.push(model);
  context.agent.resultTarget={...target,inputTarget:{selection},resultBox:target.box,generation:context.agent.generation,documentId:'canvas',conversationId:'conversation',strokeId:0};
  context.assistAgentFinishResult(true);
  assert.equal(context.state.selection,null);
  assert.equal(shown.length,1);
});

test('Agent requests started in Lasso switch to Hand only on current successful output',async()=>{
  for(const outcome of ['success','failed','empty','new-selection','new-tool','new-drawing']) {
    const {context,target}=harness(),selection={phase:'active',box:target.box},modes=[];
    Object.assign(context.state,{mode:'select',selection});target.selection=selection;
    context.commitSelection=()=>{context.state.selection=null;};
    context.renderInteractionLayer=()=>{};context.renderAssist=()=>{};
    context.setCanvasMode=mode=>{context.state.mode=mode;modes.push(mode);};
    assert.equal(await context.assistAgentRun('solve',target),'submitted');
    assert.equal(context.agent.resultTarget.returnToHand,true);
    assert.equal(context.state.mode,'select','keep Lasso during the request');
    if(outcome!=='empty')context.agent.resultTarget.resultBox=target.box;
    if(outcome==='new-selection')context.state.selection={phase:'active'};
    if(outcome==='new-tool')context.state.mode='pen';
    if(outcome==='new-drawing')context.state.drawing={};
    context.assistAgentFinishResult(outcome!=='failed');
    assert.deepEqual(modes,outcome==='success'?['hand']:[],outcome);
    if(outcome==='success')assert.equal(context.state.selection,null);
    if(['failed','empty'].includes(outcome))assert.equal(context.state.selection,selection);
  }
});

test('stopped scoped Agent work preserves its source without touching a newer selection',()=>{
  for(const newer of [false,true]){
    const {context,target}=harness(),selection={},replacement={};
    context.state.selection=newer?replacement:selection;
    context.agent.resultTarget={...target,inputTarget:{selection},generation:context.agent.generation,documentId:'canvas',conversationId:'conversation'};
    context.assistAgentFinishResult(false);
    assert.equal(context.state.selection,newer?replacement:selection);
    assert.deepEqual(selection,{});
  }
});

test('successful suggestion Agent completion ranks only its actual Canvas mutations',async()=>{
  const {context,target}=harness(),shown=[],box={x:600,y:500,w:400,h:300},dirty=context.state.dirty;
  Object.assign(context,{smartSuggest:{enabled:true,strokes:[]},renderAssist:model=>shown.push(model),mcpContentUpdateRegion:result=>result.objectId==='new-widget'?box:null});
  await context.assistAgentRun('animate_sketch',target,{label:'Animate sketch',fromSuggestBar:true});
  context.assistAgentRecordResult('canvas_document',{operation:'mcp_capture_widget',arguments:{}},{objectId:'new-widget'});
  assert.equal(context.agent.resultTarget.resultBox,undefined,'read-only tools cannot create follow-ups');
  context.assistAgentRecordResult('canvas_document',{operation:'mcp_present_widget',arguments:{}},{objectId:'new-widget'}, {canvasWritten:true});
  context.assistAgentFinishResult(true);
  assert.equal(shown.length,1);assert.deepEqual(JSON.parse(JSON.stringify(shown[0].box)),box);
  assert.equal(shown[0].mode,'followup');assert.equal(shown[0].target.resultBox,box);assert.equal(context.state.dirty,null);assert.equal(context.consumed,true);
  context.assistAgentFinishResult(true);assert.equal(shown.length,1,'completion cannot rank twice');
  for(const failure of ['error','cancel','conversation','document']) {
    context.state.dirty=dirty;
    await context.assistAgentRun('animate_sketch',target,{label:'Animate sketch',fromSuggestBar:true});
    context.assistAgentRecordResult('canvas_document',{operation:'mcp_present_widget',arguments:{}},{objectId:'new-widget'}, {canvasWritten:true});
    if(failure==='cancel')context.agent.generation++;
    if(failure==='conversation')context.canvasAgent.currentConversation.id='another';
    if(failure==='document')context.canvasDocumentsCurrent=()=>({id:'another'});
    context.assistAgentFinishResult(failure!=='error');
    assert.equal(shown.length,1,'failed, cancelled or stale work has no next action');
  }
});

test('suggestion Agent completion preserves a new lasso instead of replacing it with result actions',async()=>{
  const {context,target}=harness(),shown=[];
  Object.assign(context,{renderAssist:model=>shown.push(model),mcpContentUpdateRegion:()=>({x:600,y:500,w:400,h:300})});
  await context.assistAgentRun('animate',target);
  context.assistAgentRecordResult('canvas_document',{operation:'mcp_present_widget',arguments:{}},{objectId:'result'}, {canvasWritten:true});
  const selection={phase:'active'};
  context.state.selection=selection;
  context.assistAgentFinishResult(true);
  assert.equal(context.state.selection,selection);
  assert.equal(shown.length,0);
  assert.ok(context.consumed,'the completed task clears all pending input');
});

test('Finish drawing Agent uses whole-object completion and fixed target geometry with its own tool schema',async()=>{
  const {context,calls,target}=harness(), record={...target.strokes[0],size:6,points:[{x:130,y:150},{x:180,y:140},{x:230,y:150}]};
  target.strokes=[record]; context.smartSuggest.strokes=[record];
  assert.equal(await context.assistAgentRun('finish_drawing',target,{label:'补全画作'}),'submitted');
  const request=calls[0];
  assert.match(request.textOverride,/missing repeated parts/);
  assert.match(request.textOverride,/shared center or axis/);
  assert.match(request.textOverride,/native drawing tool in Canvas world coordinates/);
  assert.match(request.textOverride,/"strokeWidth":6/);
  assert.match(request.textOverride,/\[130,150\]/);
  assert.doesNotMatch(request.textOverride,/integer relative coordinates|closed, fill and arrows/);
  assert.equal(request.omitInitialCapture,true);
  await context.assistAgentRun('finish_drawing',{...target,selection:{}},{label:'补全画作'});
  assert.doesNotMatch(calls.at(-1).textOverride,/sourceInk \(fixed existing geometry/,'masked selections cannot reveal excluded vector ink');
  await context.assistAgentRun('finish_drawing',target,{instruction:'Describe the drawing'});
  assert.doesNotMatch(calls.at(-1).textOverride,/sourceInk \(fixed existing geometry|missing repeated parts/,'a custom instruction retains precedence');
});

test('Practice Agent generates exactly one question without a delivered solution',async()=>{
  const {context,calls,target}=harness();
  assert.equal(await context.assistAgentRun('practice',target,{label:'练一题'}),'submitted');
  const request=calls[0];
  assert.equal(request.displayTextOverride,'练一题');
  assert.match(request.textOverride,/Create exactly one new, self-contained practice question/);
  assert.match(request.textOverride,/privately check that it is solvable/);
  assert.match(request.textOverride,/Do not solve the source or include an answer, worked solution, hint, answer key or hidden solution/);
  assert.match(request.textOverride,/room for the learner to work/);
  assert.equal(request.omitInitialCapture,true);
});

test('Explain with animation handoff requires a visible timed scene and its playback controls',async()=>{
  const {context,calls,target}=harness();
  assert.equal(await context.assistAgentRun('animate',target,{label:'Explain with animation'}),'submitted');
  assert.match(calls[0].textOverride,/penecho_get_guidance\(\{id:"scene",detail:"full"\}\)/);
  assert.match(calls[0].textOverride,/use penecho_present_widget with scene when its vocabulary fits/);
  assert.match(calls[0].textOverride,/takes precedence over the default static Visual Explorer route/);
  assert.match(calls[0].textOverride,/verify visible content and meaningful motion before reporting completion/);
  assert.match(calls[0].textOverride,/Include pause and replay/);
});

test('ordinary Agent sends all dirty groups with stable invocation geometry and viewport context',async()=>{
  const {context,calls,captures,visible,target}=harness(),capture=context.canvasAgentCapture;
  context.canvasAgentCapture=async(...args)=>{const image=await capture(...args);visible.x=5000;context.state.dirty=null;return image;};
  assert.equal(await context.assistAgentRun('animate_sketch',target,{label:'Animate sketch'}),'submitted');
  const request=calls[0];
  assert.equal(request.displayTextOverride,'Animate sketch');
  assert.match(request.textOverride,/Animate the same subject and composition/);
  assert.match(request.textOverride,/Target region.*x=100, y=120, width=1880, height=1860/);
  assert.match(request.textOverride,/Recent stroke region.*x=190, y=200, width=30, height=40/);
  assert.match(request.textOverride,/Dirty region.*x=180, y=180, width=1800, height=1800/);
  assert.match(request.textOverride,/Viewport at invocation.*x=50, y=80, width=900, height=600/);
  assert.match(request.textOverride,/report completion and stop/);
  assert.match(request.textOverride,/verify meaningful motion plus pause and replay/);
  assert.doesNotMatch(request.textOverride,/x=5000/);
  assert.deepEqual(JSON.parse(JSON.stringify(captures)),[{target:'region',region:{x:100,y:120,width:1880,height:1860},quality:'basic',coordinates:'none'}]);
  assert.equal(request.omitInitialCapture,true);
  assert.equal(request.imageOverrides[0].data,'c2tldGNo');
  assert.equal(request.includeDraftMedia,false);
  assert.equal(request.clearInput,false);
  assert.deepEqual(JSON.parse(JSON.stringify(request.referencesOverride.region)),{x:100,y:120,width:1880,height:1860});
});

test('masked selection takes priority over dirty bounds and never captures unselected pixels',async()=>{
  const {context,calls,captures,target}=harness();target.selection={box:target.box};
  assert.equal(await context.assistAgentRun('animate',target),'submitted');
  assert.equal(captures.length,0);
  assert.equal(calls[0].imageOverrides[0].data,'bWFza2Vk');
  assert.match(calls[0].textOverride,/authoritative masked lasso selection; excluded pixels are not input/);
  assert.equal(calls[0].omitInitialCapture,true);
  context.mcpContentUpdateRegion=()=>({x:600,y:500,w:200,h:100});
  context.renderAssist=()=>{};
  context.assistAgentRecordResult('canvas_document',{operation:'mcp_present_widget',arguments:{}},{objectId:'result'}, {canvasWritten:true});
  context.assistAgentFinishResult(true);
  assert.equal(context.consumed,true,'successful selected work clears all pending input');assert.equal(context.state.dirty,null);
});

test('PenEchoLLM routing waits for current Widget pixels under its own deadline, then starts the model deadline',async()=>{
  for(const outcome of ['complete','incomplete','cancelled']){
    const {context,target}=harness(),requests=[],timers=[],widget={id:'lasso-widget'};let preparedWith=null,finish;
    target.selection={phase:'active',regionOnly:true,box:target.box,fragments:[]};
    Object.assign(context,{
      AbortController,SMART_SUGGEST_TIMEOUT_MS:12000,WIDGET_CLASSIFY_SNAPSHOT_TIMEOUT_MS:8000,clearTimeout,
      setTimeout:(fn,ms)=>{timers.push(ms);return setTimeout(fn,ms);},
      smartSuggest:{available:true},suggestionAccessBlocked:()=>false,authenticatedApiHeaders:x=>x,suggestionApiPath:()=>'/api/suggest',updateSuggestionAccess(){},
      smartSuggestRequiredWidgets:cluster=>{assert.equal(cluster.selection,target.selection);return [widget];},
      ensureWidgetSnapshots:(widgets,options)=>{preparedWith={widgets,options};return new Promise((resolve,reject)=>{finish=()=>outcome==='cancelled'?reject(Error('cancelled')):resolve({complete:outcome==='complete',missing:outcome==='complete'?0:1,missingWidgets:outcome==='complete'?[]:[widget]});});},
      smartSuggestCrop:cluster=>{assert.equal(cluster.selection,target.selection);return 'data:image/png;base64,CURRENT';},
      fetch:async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true,answers:{execution:{choice:'penecho_agent'}}})};},
    });
    const routed=context.assistClassifyRequest('animate',target,'Explain this');
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(preparedWith.widgets,[widget]);assert.equal(preparedWith.options.timeoutMs,8000);assert.equal(preparedWith.options.reuseWithinMs,undefined,"routing captures current pixels");
    assert.deepEqual(timers,[],'the model deadline has not started during Widget preparation');
    if(outcome==='cancelled')context.agent.routeController.abort();
    finish();
    const result=await routed;
    if(outcome==='complete'){
      assert.equal(result.choice,'penecho_agent');assert.equal(requests.length,1);assert.equal(requests[0].mode,'route');assert.equal(requests[0].image,'data:image/png;base64,CURRENT');
      assert.deepEqual(timers,[12000]);
    } else {assert.equal(result,null);assert.equal(requests.length,0,'an incomplete image is never sent');}
    assert.equal(context.agent.routeController,null);
  }
});

test('Widget-only selection refreshes its current pixels before Agent handoff',async()=>{
  const {context,calls,target}=harness(),originalBox={x:10,y:20,w:100,h:90};target.selection={phase:'active',regionOnly:true,originalBox,box:target.box,fragments:[]};
  let ready,refreshed=false;const widget={id:'w'};
  context.selectionPathFor=()=>[];context.widgetsRequiredForCapture=region=>{assert.equal(region,target.box);return [widget];};
  context.ensureWidgetSnapshots=async widgets=>{
    assert.deepEqual(widgets,[widget]);
    await new Promise(resolve=>{ready=resolve;});refreshed=true;return {complete:true,missing:0,missingWidgets:[]};
  };
  context.buildSelectionImage=()=>{assert.equal(refreshed,true);return {atlasImage:'data:image/png;base64,ZnJlc2g=',atlasSize:{w:100,h:90}};};
  const running=context.assistAgentRun('animate',target);
  assert.equal(calls.length,0);ready();assert.equal(await running,'submitted');
  assert.equal(calls[0].imageOverrides[0].data,'ZnJlc2g=');
});

test('failed or cancelled Widget snapshot cannot submit an incomplete selection to Agent',async()=>{
  for(const cancelled of [false,true]) {
    const {context,calls,target}=harness();target.selection={phase:'active',regionOnly:true,box:target.box,fragments:[]};
    context.selectionPathFor=()=>[];context.widgetsRequiredForCapture=()=>[{id:'w'}];
    context.widgetSnapshotsUnavailableError=()=>Error('Widget snapshot failed');
    context.buildSelectionImage=()=>assert.fail('an incomplete lasso image is never built');
    context.ensureWidgetSnapshots=async()=>{if(cancelled)context.agent.generation++;return {complete:false,missing:1,missingWidgets:[{id:'w'}]};};
    assert.equal(await context.assistAgentRun('animate',target),'blocked');
    assert.equal(calls.length,0);
  }
});

test('widget and clean follow-up requests retain explicit scope when dirty input is elsewhere',async()=>{
  for(const widget of [null,{id:'widget-1'}]) {
    const {context,calls,target}=harness();
    context.state.dirty={x:5000,y:5000,w:50,h:50};target.strokes=[];
    if(widget){target.widget=widget;context.state.widgets.push(widget);}else target.followUp=true;
    assert.equal(await context.assistAgentRun('ask',target,{instruction:'Explain this result'}),'submitted');
    const request=calls[0];
    assert.match(request.textOverride,/Canvas suggestion task: Explain this result/);
    assert.match(request.textOverride,/Dirty region.*: none/);
    assert.match(request.textOverride,/Recent stroke region.*: none/);
    assert.deepEqual(Array.from(request.referencesOverride.objectIds),widget?['widget-1']:[]);
    assert.match(request.textOverride,widget?/The referenced widget is widget-1/:/previous result/);
    if(widget)assert.match(request.textOverride,/If the requested task requires editing it/);
  }
});

test('structured Widget Refine sends local mark detail, loads scoped rules and consumes ink only after a successful patch',async()=>{
  const {context,calls,captures,target}=harness();
  target.box={x:100,y:120,w:1000,h:800};target.widget={id:'architecture',sourceFormat:'penecho-mcp+html'};
  target.refinement={route:{reason:'structured-diagram',guidance:['architecture']},instructionMode:'nearby-dirty'};
  target.strokes=[];context.state.widgets=[target.widget];context.state.dirty={x:500,y:450,w:50,h:40};
  context.mcpContentUpdateRegion=()=>target.box;context.renderAssist=()=>{};
  assert.equal(await context.assistAgentRun('apply_marks',target,{instruction:'Apply the new handwritten marks.'}),'submitted');
  assert.equal(captures.length,2);assert.equal(captures[1].quality,'detail');
  assert.deepEqual(JSON.parse(JSON.stringify(captures[1].region)),{x:404,y:354,width:242,height:232});
  assert.equal(calls[0].imageOverrides.length,2);
  assert.deepEqual(Array.from(calls[0].referencesOverride.objectIds),['architecture']);
  assert.match(calls[0].textOverride,/penecho_get_guidance\(\{id:"architecture",detail:"full"\}\)/);
  assert.match(calls[0].textOverride,/second attached image.*x=404, y=354/);
  assert.match(calls[0].textOverride,/edit the existing semantic JSON\/source/);
  assert.match(calls[0].textOverride,/not a guessed label elsewhere/);
  assert.doesNotMatch(calls[0].textOverride,/explicit custom instruction takes precedence/,'host action text does not select the language');
  assert.equal(context.consumed,undefined);
  context.assistAgentRecordResult('canvas_document',{operation:'mcp_patch_file',arguments:{path:'objects/architecture/widget.html'}},{objectId:'architecture'}, {canvasWritten:true});
  context.assistAgentFinishResult(true);
  assert.equal(context.consumed,true);assert.equal(context.state.dirty,null);
  delete context.consumed;
  await context.assistAgentRun('apply_marks',target,{instruction:'Apply the new handwritten marks.'});
  context.assistAgentFinishResult(false);
  assert.equal(context.consumed,undefined,'failed Agent edits preserve annotations');
});

test('Widget Refine includes every dirty instruction outside the viewport and clears it only on success',async()=>{
  for(const completed of [false,true]){
    const {context,calls,captures,target}=harness(),dirty={x:80,y:90,w:6000,h:4500};
    target.widget={id:'architecture',sourceFormat:'html'};target.strokes=[];
    target.refinement={route:{reason:'structured-diagram',guidance:['architecture']},instructionMode:'canvas-dirty'};
    context.state.widgets=[target.widget];context.state.dirty=dirty;
    assert.equal(await context.assistAgentRun('apply_marks',target),'submitted');
    assert.deepEqual(JSON.parse(JSON.stringify(captures[0].region)),{x:80,y:90,width:6000,height:4500});
    assert.match(calls[0].textOverride,/All pending handwriting, text and images.*including distant content and content outside the viewport/);
    assert.deepEqual(Array.from(calls[0].referencesOverride.objectIds),['architecture']);
    assert.equal(context.state.dirty,dirty,"submission keeps dirty");
    context.agent.resultTarget.canvasWritten=true;
    context.assistAgentFinishResult(completed);
    assert.equal(context.state.dirty,completed?null:dirty);
    assert.equal(context.consumed,completed?true:undefined);
  }
});

test('derived Widget actions preserve source, capture only it, and clear dirty only after success',async()=>{
  for(const id of ['vivid','animate','animate_sketch']) {
    const {context,calls,captures,target}=harness(),dirty=context.state.dirty;
    target.widget={id:'source-widget',sourceFormat:'penecho-note-card+json'};
    target.variant={guidance:[id==='vivid'?'general-html':'scene']};target.strokes=[];
    context.state.widgets=[target.widget];
    context.captureDirtyInput=()=>assert.fail('a derived Widget action must not capture pending ink');
    context.mcpContentUpdateRegion=()=>({x:400,y:120,w:300,h:300});context.renderAssist=()=>{};
    assert.equal(await context.assistAgentRun(id,target,{instruction:id==='vivid'?context.PenEchoIllustrationStyle.widgetInstruction('3d','none',{inPlace:false}):vm.runInContext('ASSIST_AGENT_TASKS.'+id,context)}),'submitted');
    const request=calls[0];
    assert.match(request.textOverride,/one separate derived Widget through penecho_present_widget with a new artifactId/);
    assert.match(request.textOverride,/Do not patch, replace or remove the source Widget/);
    assert.match(request.textOverride,/Omit explicit placement/);
    assert.match(request.textOverride,/Dirty region.*: none/);
    assert.doesNotMatch(request.textOverride,/explicit custom instruction takes precedence|Widget Refine uses local routing|Do not create a replacement object/);
    assert.deepEqual(Array.from(request.referencesOverride.objectIds),['source-widget']);
    assert.equal(captures.length,1);assert.equal(context.agent.resultTarget.inputSnapshot,null);
    assert.equal(request.includeDraftMedia,false);assert.equal(request.clearInput,false);
    context.assistAgentRecordResult('canvas_document',{operation:'mcp_present_widget',arguments:{}},{objectId:'derived-widget'}, {canvasWritten:true});
    context.assistAgentFinishResult(true);
    assert.equal(context.state.dirty,null);assert.equal(context.consumed,true);
    assert.equal(context.state.widgets[0],target.widget);
  }
});

test('failed mark detail capture blocks Widget Refine rather than sending an incomplete request',async()=>{
  const {context,calls,target}=harness();target.box={x:100,y:120,w:1000,h:800};target.widget={id:'w'};
  target.refinement={route:{reason:'structured-diagram',guidance:['workflow']},instructionMode:'nearby-dirty'};
  context.state.widgets=[target.widget];context.state.dirty={x:500,y:450,w:50,h:40};
  const original=context.canvasAgentCapture;
  context.canvasAgentCapture=async(args,options)=>{if(args.quality==='detail')throw Error('detail unavailable');return original(args,options);};
  assert.equal(await context.assistAgentRun('apply_marks',target),'blocked');
  assert.equal(calls.length,0);assert.equal(context.consumed,undefined);assert.equal(context.agent.preparing,false);
});

test('a thrown Agent submission retires Widget Refine ownership so it can be retried',async()=>{
  const {context,target}=harness();target.widget={id:'w'};context.state.widgets=[target.widget];
  target.refinement={route:{reason:'professional-diagram',guidance:[]},instructionMode:'ask'};
  context.canvasAgentSubmitMessage=async options=>{throw Error('submission failed');};
  assert.equal(await context.assistAgentRun('ask',target,{instruction:'修复连线'}),'blocked');
  assert.equal(context.agent.resultTarget,null);assert.equal(context.agent.turnTarget,null);assert.equal(context.agent.preparing,false);
});

test('cancelled, undone or switched targets cannot submit after asynchronous capture',async()=>{
  for(const change of [c=>{c.agent.generation++;},c=>{c.state.history=[];},c=>{c.canvasDocumentsCurrent=()=>({id:'other'});}]) {
    const {context,calls,target}=harness(),capture=context.canvasAgentCapture;
    context.canvasAgentCapture=async(...args)=>{const image=await capture(...args);change(context);return image;};
    assert.equal(await context.assistAgentRun('animate_sketch',target),'blocked');
    assert.equal(calls.length,0);
  }
});

test('capture failure blocks a text-only handoff and permits retry',async()=>{
  const {context,calls,target}=harness(),capture=context.canvasAgentCapture;
  context.canvasAgentCapture=async()=>{throw Error('capture failed');};
  assert.equal(await context.assistAgentRun('animate_sketch',target),'blocked');
  assert.equal(calls.length,0);assert.equal(context.agent.preparing,false);
  context.canvasAgentCapture=capture;
  assert.equal(await context.assistAgentRun('animate_sketch',target),'submitted');
});

test('suggestion placement context is host-owned, immutable and revoked with its execution identity',async()=>{
 for(const invalidation of ['completion','cancel','document','epoch','conversation','session','sessionGeneration','undo']) {
  const {context,target}=harness();context.state.scale=.17;
  context.canvasDocuments={epoch:2};Object.assign(context.canvasAgent,{sessionId:'session',sessionGeneration:4});
  context.canvasAgentSubmitMessage=async options=>{options.assertCurrent();options.beforeSend();return true;};
  await context.assistAgentRun('answer',target);
  const trusted=context.assistAgentToolContext();assert.ok(trusted);assert.equal(trusted.scale,.17);
  const sourceX=trusted.box.x;target.box.x+=1000;context.viewportRect=()=>({x:8000,y:8000,w:900,h:600});
  assert.equal(trusted.box.x,sourceX);assert.equal(trusted.viewport.x,50);assert.equal(Object.isFrozen(trusted.box),true);
  assert.equal(context.assistAgentToolContextCurrent(trusted),true);
  if(invalidation==='completion')context.assistAgentFinishResult(false);
  if(invalidation==='cancel'){context.agent.generation++;context.agent.resultTarget=null;}
  if(invalidation==='document')context.canvasDocumentsCurrent=()=>({id:'other'});
  if(invalidation==='epoch')context.canvasDocuments.epoch++;
  if(invalidation==='conversation')context.canvasAgent.currentConversation.id='other';
  if(invalidation==='session')context.canvasAgent.sessionId='other';
  if(invalidation==='sessionGeneration')context.canvasAgent.sessionGeneration++;
  if(invalidation==='undo')context.state.history=[];
  assert.equal(context.assistAgentToolContextCurrent(trusted),false,invalidation);
  if(invalidation==='completion')assert.equal(context.assistAgentToolContext(),null);
  else {
   const revoked=context.assistAgentToolContext();assert.ok(revoked,invalidation+' retains owned turn until turn_end');
   assert.equal(revoked.owner,trusted.owner);assert.equal(context.assistAgentToolContextCurrent(revoked),false);
   context.assistAgentFinishResult(false);assert.equal(context.assistAgentToolContext(),null,'turn_end releases ownership');
  }
 }
});

test('retiring an owned turn releases its input but preserves a different preparing suggestion',async()=>{
 const {context,target}=harness();context.canvasDocuments={epoch:2};Object.assign(context.canvasAgent,{sessionId:'session',sessionGeneration:4});
 context.canvasAgentSubmitMessage=async options=>{options.beforeSend();return true;};
 const released=[];context.releaseDirtyInput=snapshot=>released.push(snapshot);
 await context.assistAgentRun('answer',target);
 const owned=context.agent.turnTarget,snapshot=owned.inputSnapshot;
 context.assistAgentRetireTurn();assert.equal(context.assistAgentToolContext(),null);assert.equal(context.agent.resultTarget,null);assert.deepEqual(released,[snapshot]);
 context.agent.turnTarget=owned;const preparing={submitted:false};context.agent.resultTarget=preparing;
 context.assistAgentRetireTurn();assert.equal(context.agent.resultTarget,preparing);assert.equal(context.assistAgentToolContext(),null);assert.equal(released.length,1);
});

test('forced Agent Answer responds to the message meaning and retains explicit visual construction intent',async()=>{
 const {context,target,calls}=harness();await context.assistAgentRun('answer',target);
 const prompt=calls[0].textOverride;
 assert.match(prompt,/Reply naturally to greetings and conversational messages/);
 assert.match(prompt,/unless the user requests transcription/);
 assert.match(prompt,/math blanks, routes and constructions/);
 assert.match(prompt,/actual returned tool geometry and sourcePlacement evidence/);
});

test('completed Agent text-only turns preserve all dirty input and release snapshots',async()=>{
 for(const selected of [false,true]) {
  const {context,target}=harness(),shown=[];
  if(selected)target.selection={phase:'active',box:target.box};
  context.renderAssist=model=>shown.push(model);
  await context.assistAgentRun('answer',target);
  const snapshot=context.agent.resultTarget.inputSnapshot,dirty=context.state.dirty,released=[];
  context.releaseDirtyInput=input=>released.push(input);
  context.assistAgentFinishResult(true);
  assert.equal(context.consumed,undefined);assert.equal(context.state.dirty,dirty);assert.equal(shown.length,0);assert.deepEqual(released,[snapshot]);
 }
});

test('ordinary Agent tools only count verified current-Canvas writes, including deletion without a result region',async()=>{
  for(const mode of ['read','write','delete','reused','other-canvas']){
    const {context,target}=harness(),owner=context.canvasAgent,dirty=context.state.dirty;
    context.smartSuggest.requests=new Map([[owner,{documentId:'canvas'}]]);
    context.mcpContentUpdateRegion=()=>null;
    context.assistAgentRecordResult('canvas_document',{operation:mode==='read'?'mcp_capture_widget':'mcp_edit_canvas',arguments:{action:mode==='delete'?'delete':'update'}},
      {documentId:mode==='other-canvas'?'other':'canvas',reused:mode==='reused'}, {canvasWritten:mode!=='read'});
    assert.equal(context.smartSuggest.requests.get(owner).canvasWritten,['write','delete'].includes(mode)?true:undefined,mode);
    assert.equal(context.state.dirty,dirty,"a tool write alone is not successful turn completion");
  }
});

test('the actual Agent tool executor reports committed writes while reads, view changes, errors and reused results stay clean',async()=>{
  const source=fs.readFileSync('src/client/app/canvas-agent-runtime.js','utf8'),start=source.indexOf('  async function canvasAgentExecuteTool('),end=source.indexOf('\n  function ',start),
    changeStart=source.indexOf('  function canvasAgentRecordChange('),changeEnd=source.indexOf('\n  function ',changeStart+1);
  for(const mode of ['read','write','source','view','failed','reused','other-canvas']){
    const {context}=harness(),owner=context.canvasAgent;
    context.smartSuggest.requests=new Map([[owner,{documentId:'canvas'}]]);
    owner.toolControllers=new Map();owner.toolResultCache=new Map();
    Object.assign(context,{AbortController,canvasAgentHash:async()=>'',canvasAgentAssertToolExecution(){},canvasAgentToolExecutionCurrent:()=>true,
      canvasAgentAssertToolKeys(){},canvasAgentSendEnvelope(){},canvasAgentRead:async()=>{context.state.userRevision++;return {revision:context.state.userRevision};},
      canvasAgentSetView:()=>({revision:7,viewRevision:9}),
      canvasAgentReplaceWidget:async(_args,execution)=>{context.canvasAgentRecordChange('patch',{},execution);return {objectId:'widget'};},
      canvasAgentDocumentOperation:async(_args,execution)=>{
        if(mode==='failed')throw Error('write failed');
        execution.canvasWritten=true;
        return {documentId:mode==='other-canvas'?'other':'canvas',reused:mode==='reused'};
      }});
    vm.runInContext(source.slice(changeStart,changeEnd)+source.slice(start,end),context);
    const name=mode==='read'?'canvas_read':mode==='view'?'canvas_set_view':mode==='source'?'canvas_internal_replace_widget':'canvas_document';
    await context.canvasAgentExecuteTool({name,arguments:{operation:'mcp_edit_canvas',arguments:{action:'delete'}}});
    assert.equal(context.smartSuggest.requests.get(owner).canvasWritten,['write','source'].includes(mode)?true:undefined,mode);
  }
});

test('failed and superseded Agent turns preserve all submitted dirty input',async()=>{
 for(const reason of ['failure','cancel','document','recognition']) {
  const {context,target}=harness(),released=[];
  context.releaseDirtyInput=snapshot=>released.push(snapshot);
  await context.assistAgentRun('answer',target);
  const snapshot=context.agent.resultTarget.inputSnapshot;
  if(reason==='cancel')context.agent.generation++;
  if(reason==='document')context.canvasDocumentsCurrent=()=>({id:'other'});
  if(reason==='recognition')context.state.recognitionGeneration=1;
  context.assistAgentFinishResult(reason!=='failure');
  assert.equal(context.consumed,undefined,reason);assert.deepEqual(released,[snapshot],reason);
 }
});

test('Finish drawing passes distant pending source geometry through the expanded execution scope',async()=>{
 const {context,target,calls}=harness();
 const near={...target.strokes[0],size:6,points:[{x:130,y:150},{x:180,y:140},{x:230,y:150}]},
  far={id:2,historyEntry:{},size:6,points:[{x:1300,y:650},{x:1380,y:640},{x:1430,y:650}]};
 context.state.history.push(far.historyEntry);target.strokes=[near];context.smartSuggest.strokes=[near,far];
 await context.assistAgentRun('finish_drawing',target);
 assert.match(calls[0].textOverride,/\[1300,650\]/);
 assert.match(calls[0].textOverride,/\[130,150\]/);
});
