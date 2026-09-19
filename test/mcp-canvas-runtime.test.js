"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
function harness(){
  const widgets=new Map(),sent=[],saved=[],captureRequests=[],listeners={},state={language:"en",userRevision:1};let next=1,captures=0;
  const document={getElementById:()=>null,querySelectorAll:()=>[]};
  const context=vm.createContext({SIZE:32768,state,document,window:{PENECHO_CONFIG:{}},location:{origin:"http://127.0.0.1"},WebSocket:{OPEN:1},AbortController,AbortSignal,setTimeout,clearTimeout,performance,
    addEventListener:(type,fn)=>{listeners[type]=fn;},save:()=>saved.push(true),canvasAgentObject:id=>widgets.has(id)?{kind:"widget",item:widgets.get(id)}:null,
    canvasAgentCreate:async(args,execution)=>{const item=args.items[0],id=`widget-${next++}`,widget={id,...item,x:item.placement?.x||0,y:item.placement?.y||0,contentVersion:0,contentW:execution?.widgetContentViewport?.width||item.width,contentH:execution?.widgetContentViewport?.height||item.height,w:item.width,h:item.height,hostReady:true,renderActive:true,frame:{contentWindow:{postMessage:value=>sent.push(value)}}};widgets.set(id,widget);state.userRevision++;return{receipts:[{objectId:id}]};},
    canvasAgentBox:object=>({x:object.item.x,y:object.item.y,w:object.item.w,h:object.item.h}),requestWidgetSnapshot:()=>{captures++;throw Error("not requested");},
    unionDirtyBounds:(a,b)=>!a?{...b}:({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x),h:Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y)}),
    canvasAgentAssertToolExecution:()=>{},canvasAgentCapture:async(args)=>{captures++;captureRequests.push(args);return {dataUrl:"data:image/webp;base64,AQ==",logicalRegion:args.region,encodedBytes:1};},
    canvasAgentPlacementBox:(w,h,p,reserved)=>({x:100+reserved.length*5000,y:100,w,h,crowded:false}),canvasAgentInternalRect:b=>b,visibleInkBounds:()=>null,intersection:(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y,
    requestRender:()=>{},canvasAgentSyncState:()=>{},canvasAgentFramePlan:()=>({scale:.8}),canvasAgentFrameRegion:region=>{context.frames.push(region);},frames:[],
    writeClipboardText:async()=>true,peButton:()=>{},canvasAgentAllObjects:()=>[...widgets.values()].map(w=>({id:w.id,box:{x:w.x,y:w.y,w:w.w,h:w.h}})),canvasAgentContentBounds:()=>widgets.size?{}:null,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/client/app/mcp-runtime.js"),"utf8")+"\nglobalThis.api={mcpRuntime,mcpExecute,mcpBoardHtml,mcpDisconnect,mcpExecutionCurrent,syncMcpWidgetProgress,mcpRecordFeedback,mcpQueueView,mcpFlushView,mcpPauseView,mcpTaskBounds};",context);
  return {...context.api,context,captureRequests,widgets,sent,saved,state,listeners,captures:()=>captures};
}
test("external sessions keep distinct metadata without creating a board or capturing progress",async()=>{
  const h=harness(),one=await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Build",client:"Codex"},{}),two=await h.mcpExecute("mcp_start_session",{sessionId:"two",title:"Review",client:"Kimi"},{});
  assert.equal(one.boardObjectId,null);assert.equal(two.boardObjectId,null);const revision=h.state.userRevision;
  await h.mcpExecute("mcp_update_session",{sessionId:"one",summary:"Contract confirmed",steps:[{id:"api",label:"API",status:"done"}],events:[{id:"check",text:"Validated"}]},{});
  assert.equal(h.state.userRevision,revision);assert.equal(h.widgets.size,0);assert.equal(h.sent.length,0);assert.equal(h.captures(),0);assert.equal(h.saved.length,0);
  assert.equal(h.mcpRuntime.sessions.get("two").summary,"");
  await h.mcpExecute("mcp_update_session",{sessionId:"one",events:[{id:"check",text:"Revalidated"}]},{});
  assert.equal(h.mcpRuntime.sessions.get("one").events.length,1);
});
test("hidden board updates stay canonical and defer iframe work until visible",async()=>{
  const h=harness();await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Build"},{});const widget={id:"legacy",contentVersion:0,hostReady:true,frame:{contentWindow:{postMessage:v=>h.sent.push(v)}}};h.widgets.set(widget.id,widget);h.mcpRuntime.sessions.get("one").boardObjectId=widget.id;widget.renderActive=false;
  await h.mcpExecute("mcp_update_session",{sessionId:"one",summary:"Latest saved source"},{});
  assert.equal(h.sent.length,0);assert.match(widget.html,/Latest saved source/);assert.equal(h.captures(),0);
  widget.renderActive=true;h.syncMcpWidgetProgress(widget);h.syncMcpWidgetProgress(widget);assert.equal(h.sent.length,1);
});
test("disconnect revokes in-flight executions and session bindings; retained canvas artifacts remain",async()=>{
  const h=harness(),socket={readyState:1,close(){this.readyState=3;}},controller=new AbortController();h.mcpRuntime.socket=socket;h.mcpRuntime.controllers.set("call",controller);
  const execution={socket,generation:0,controller};assert.equal(h.mcpExecutionCurrent(execution),true);
  await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Build"},{});await h.mcpExecute("mcp_present_widget",{sessionId:"one",artifactId:"retained",title:"Retained",html:"<p>Work</p>"},{});h.mcpDisconnect();
  assert.equal(controller.signal.aborted,true);assert.equal(h.mcpExecutionCurrent(execution),false);assert.equal(h.mcpRuntime.sessions.size,0);assert.equal(h.widgets.size,1);
  await assert.rejects(h.mcpExecute("mcp_inspect_session",{sessionId:"one"},{}),/no longer connected/);
});
test("board data escapes script terminators and untrusted markup stays text",()=>{
  const h=harness(),html=h.mcpBoardHtml({title:"</script><img src=x onerror=alert(1)>",client:"",status:"working"});
  assert.ok(!html.includes("</script><img"));assert.match(html,/\\u003c\/script>/);assert.match(html,/textContent/);
});

test("feedback is incremental, replayable, session-scoped and independent of dirty tracking",async()=>{
  const h=harness();h.mcpRuntime.socket={readyState:1,close(){}};const bounds={x:10,y:20,w:100,h:40};
  h.mcpRecordFeedback("text",bounds,{id:"old",text:"before session"});
  await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Design"},{});
  h.state.dirty={...bounds};h.mcpRecordFeedback("text",bounds,{id:"text-1",text:"Make this blue"});h.mcpRecordFeedback("stroke",bounds);
  const first=await h.mcpExecute("mcp_read_feedback",{capture:false,sessionId:"one",limit:1},{});
  assert.equal(first.entries.length,1);assert.equal(first.entries[0].text,"Make this blue");assert.equal(first.hasMore,true);
  assert.equal((await h.mcpExecute("mcp_read_feedback",{capture:false,sessionId:"one",limit:1},{})).entries[0].cursor,first.nextCursor);
  const next=await h.mcpExecute("mcp_read_feedback",{capture:false,sessionId:"one",after:first.nextCursor},{});assert.equal(next.entries[0].kind,"stroke");assert.equal(next.hasMore,false);
  assert.deepEqual(h.state.dirty,bounds);assert.equal(h.captures(),0);
  await h.mcpExecute("mcp_start_session",{sessionId:"two",title:"Other"},{});assert.equal((await h.mcpExecute("mcp_read_feedback",{capture:false,sessionId:"two",after:0},{})).entries.length,0);
  await assert.rejects(h.mcpExecute("mcp_read_feedback",{capture:false,sessionId:"one",after:999},{}),/cursor/);
  h.mcpDisconnect();await assert.rejects(h.mcpExecute("mcp_read_feedback",{capture:false,sessionId:"one"},{}),/no longer connected/);
});
test("feedback history is bounded and reports gaps without silently consuming input",async()=>{
  const h=harness();h.mcpRuntime.socket={readyState:1};await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Design"},{});
  for(let i=0;i<205;i++)h.mcpRecordFeedback("text",{x:0,y:0,w:10,h:10},{id:"a",text:"x".repeat(4001)});
  const result=await h.mcpExecute("mcp_read_feedback",{capture:false,sessionId:"one",limit:50},{});assert.equal(h.mcpRuntime.feedback.length,200);assert.equal(result.truncated,true);assert.equal(result.entries.length,50);assert.equal(result.entries[0].text.length,4000);assert.equal(result.entries[0].textTruncated,true);
  h.mcpRuntime.socket=null;h.mcpRecordFeedback("image",{x:0,y:0,w:10,h:10},{id:"new"});assert.equal(h.mcpRuntime.feedbackSequence,205);
});

test("inspect exposes owned preview bounds for interpreting spatial user feedback",async()=>{
  const h=harness();await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Design"},{});
  h.widgets.set("preview",{id:"preview",x:10,y:20,w:300,h:200});h.mcpRuntime.sessions.get("one").artifacts.set("design",{objectId:"preview",title:"Design"});
  const result=await h.mcpExecute("mcp_inspect_session",{sessionId:"one"},{});assert.equal(result.artifacts[0].bounds.x,10);assert.equal(result.artifacts[0].bounds.w,300);
});

test("feedback defaults to compressed Canvas context even for text, and pages distant input",async()=>{
  const h=harness();h.mcpRuntime.socket={readyState:1};await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Design"},{});
  h.mcpRecordFeedback("text",{x:10,y:20,w:100,h:40},{text:"Smaller"});h.mcpRecordFeedback("stroke",{x:10000,y:20,w:40,h:40});
  const first=await h.mcpExecute("mcp_read_feedback",{sessionId:"one"},{});
  assert.equal(first.entries.length,1);assert.equal(first.hasMore,true);assert.ok(first.dataUrl);
  assert.equal(h.captureRequests[0].quality,"basic");assert.equal(h.captureRequests[0].coordinates,"metadata");
  assert.equal(first.logicalRegion.x,0);assert.equal(first.logicalRegion.width,230);
  const second=await h.mcpExecute("mcp_read_feedback",{sessionId:"one",after:first.nextCursor},{});assert.equal(second.hasMore,false);assert.ok(second.logicalRegion.x>9000);
  await h.mcpExecute("mcp_read_feedback",{sessionId:"one",after:second.nextCursor},{});assert.equal(h.captures(),2,"empty reads do not encode screenshots");
});
test("baseline begins at session establishment, and failed capture never consumes feedback",async()=>{
  const h=harness();h.mcpRuntime.socket={readyState:1};h.mcpRecordFeedback("text",{x:0,y:0,w:10,h:10},{text:"before session"});
  const start=await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Design"},{});assert.equal(start.feedbackCursor,1);
  assert.equal((await h.mcpExecute("mcp_read_feedback",{sessionId:"one"},{})).entries.length,0);
  h.mcpRecordFeedback("text",{x:0,y:0,w:10,h:10},{text:"after applied"});h.state.drawing=true;
  await assert.rejects(h.mcpExecute("mcp_read_feedback",{sessionId:"one"},{}),/Finish/);h.state.drawing=false;
  const originalCapture=h.context.canvasAgentCapture;h.context.canvasAgentCapture=async()=>{throw Error("snapshot unavailable");};
  await assert.rejects(h.mcpExecute("mcp_read_feedback",{sessionId:"one"},{}),/snapshot unavailable/);h.context.canvasAgentCapture=originalCapture;
  await h.mcpExecute("mcp_update_session",{sessionId:"one",summary:"Another update"},{});
  const presentation=await h.mcpExecute("mcp_present_widget",{sessionId:"one",artifactId:"next",title:"Next",html:"<p>Next design</p>"},{});assert.equal(presentation.feedbackCursor,2);assert.equal(h.mcpRuntime.sessions.get("one").feedbackStart,1);
  const retry=await h.mcpExecute("mcp_read_feedback",{sessionId:"one"},{});assert.equal(retry.entries[0].text,"after applied");
});

test("ordinary work flows down and comparisons stay related without moving user objects",async()=>{
  const h=harness();await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Design"},{});
  const create=(id,presentation)=>h.mcpExecute("mcp_present_widget",{sessionId:"one",artifactId:id,title:id,html:"<p>Preview</p>",presentation},{});
  const a=await create("a"),b=await create("b"),wa=h.widgets.get(a.objectId),wb=h.widgets.get(b.objectId);
  assert.ok(wa.y>=0);assert.equal(wa.w,1200);assert.equal(wa.h,800);assert.equal(wa.x,wb.x);assert.equal(wb.y,wa.y+wa.h+32);
  h.context.viewportRect=()=>({x:0,y:0,w:3000,h:2000});
  h.context.canvasAgentFramePlan=()=>({scale:.8,stage:{x:0,y:0,w:3000,h:2000}});
  const c=await create("c",{intent:"compare",relativeTo:"a",relation:"beside",size:"base"}),wc=h.widgets.get(c.objectId);
  assert.equal(wc.x,wa.x+wa.w+32);assert.equal(wc.y,wa.y);
  const old={x:wb.x,y:wb.y};wa.x+=25;await create("d");assert.deepEqual({x:wb.x,y:wb.y},old);
  await assert.rejects(create("bad",{relativeTo:"missing",relation:"below"}),/Related artifact/);
});
test("placement errors identify only unambiguous artifact IDs owned by the current session",async()=>{
  const h=harness();await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Design"},{});
  const create=(artifactId,relativeTo)=>h.mcpExecute("mcp_present_widget",{sessionId:"one",artifactId,title:artifactId,html:"<p>Preview</p>",...(relativeTo?{presentation:{relativeTo,relation:"beside"}}:{})},{});
  const original=await create("existing-chart"),revision=h.state.userRevision;
  await assert.rejects(create("simple-chart",original.objectId),error=>{
    assert.match(error.message,/presentation.relativeTo="existing-chart"/);assert.match(error.message,/not an objectId/);assert.match(error.message,/new requestId/);return true;
  });
  assert.equal(h.widgets.size,1);assert.equal(h.state.userRevision,revision);
  await create("simple-chart","existing-chart");assert.equal(h.widgets.size,2);
  await h.mcpExecute("mcp_start_session",{sessionId:"other",title:"Other"},{});
  h.mcpRuntime.sessions.get("other").artifacts.set("foreign-artifact",{objectId:"foreign-object"});
  await assert.rejects(create("bad","foreign-object"),error=>{
    assert.match(error.message,/Use an existing artifactId from this session/);assert.doesNotMatch(error.message,/foreign-artifact/);return true;
  });
  const session=h.mcpRuntime.sessions.get("one");
  session.artifacts.set("alias",{objectIds:[original.objectId]});
  await assert.rejects(create("ambiguous",original.objectId),/Use an existing artifactId from this session/);
  session.artifacts.delete("alias");session.artifacts.set("native-group",{objectIds:["native-member"]});
  await assert.rejects(create("native","native-member"),/presentation.relativeTo="native-group"/);
});
test("new previews frame once as a batch, user navigation pauses following, disconnect clears it",async()=>{
  const h=harness();await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Design"},{});
  h.mcpRuntime.ready=true;h.mcpRuntime.socket={readyState:1,close(){}};
  for(const id of ["a","b","c"])await h.mcpExecute("mcp_present_widget",{sessionId:"one",artifactId:id,title:id,html:"<p>Preview</p>"},{});
  assert.equal(h.context.frames.length,0);h.mcpFlushView();assert.equal(h.context.frames.length,1);assert.equal(h.context.frames[0].w,1200);assert.equal(h.context.frames[0].h,2464);
  await h.mcpExecute("mcp_present_widget",{sessionId:"one",artifactId:"d",title:"D",html:"<p>D</p>"},{});h.mcpPauseView();h.mcpFlushView();assert.equal(h.context.frames.length,1);assert.equal(h.mcpRuntime.pendingView.size,1);
  h.mcpFlushView(true);assert.equal(h.context.frames.length,2);assert.equal(h.mcpRuntime.pendingView.size,0);
  h.mcpQueueView(h.mcpRuntime.sessions.get("one"),h.widgets.values().next().value);h.mcpDisconnect();assert.equal(h.mcpRuntime.pendingView.size,0);assert.equal(h.mcpRuntime.layoutTimer,0);
});

test('idle navigation and a paused different Canvas do not suppress a new batch',async()=>{
  const h=harness();
  await h.mcpExecute('mcp_start_session',{sessionId:'old',title:'Old'},{});
  await h.mcpExecute('mcp_start_session',{sessionId:'new',title:'New'},{});
  h.mcpRuntime.sessions.get('old').internalAgent=true;h.mcpRuntime.sessions.get('new').internalAgent=true;
  h.context.mcpSessionVisible=session=>session.sessionId==='new';
  h.mcpRuntime.pendingView.set('old',new Set(['old-result']));h.mcpPauseView();
  await h.mcpExecute('mcp_present_widget',{sessionId:'new',artifactId:'first',title:'First',html:'<p>First</p>'},{});
  h.mcpFlushView();
  assert.equal(h.context.frames.length,1);assert.equal(h.mcpRuntime.pendingView.has('new'),false);
  assert.equal(h.mcpRuntime.pendingView.get('old').size,1,'other Canvas retains its pending content');
  h.mcpPauseView();
  await h.mcpExecute('mcp_present_widget',{sessionId:'new',artifactId:'second',title:'Second',html:'<p>Second</p>'},{});
  h.mcpFlushView();assert.equal(h.context.frames.length,2,'idle interaction does not opt out of future deliveries');
  clearTimeout(h.mcpRuntime.layoutTimer);
});

test('a fresh Agent turn follows its newest Widget without replaying older attention',async()=>{
  const h=harness();await h.mcpExecute('mcp_start_session',{sessionId:'internal',title:'Agent'},{});
  const session=h.mcpRuntime.sessions.get('internal');session.internalAgent=true;
  Object.assign(h.state,{scale:.25,panX:0,panY:0});
  h.context.canvasAgentFramePlan=()=>({scale:.8,stage:{x:0,y:0,w:1200,h:900}});
  h.context.viewportRect=()=>({x:-h.state.panX/.25,y:-h.state.panY/.25,w:4800,h:3600});
  const present=(id,presentation)=>h.mcpExecute('mcp_present_widget',{sessionId:'internal',artifactId:id,title:id,html:`<p>${id}</p>`,presentation},{});
  await present('previous',{attention:'request'});h.mcpPauseView();
  const source=fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
  const start=source.indexOf('  function canvasAgentHandleEvent('),end=source.indexOf('  async function canvasAgentHandleMessage(',start);
  h.context.canvasAgent={};h.context.canvasAgentSetRunning=()=>{};
  vm.runInContext(source.slice(start,end),h.context);
  h.context.canvasAgentHandleEvent({kind:'turn_start'},{replay:true});
  assert.equal(h.mcpRuntime.viewPaused,true,'history replay must not resume the camera');
  assert.equal(h.mcpRuntime.pendingView.get('internal').size,1);
  h.context.canvasAgentHandleEvent({kind:'turn_start'});
  assert.equal(h.mcpRuntime.pendingView.has('internal'),false,'a fresh request retires older turn attention only');
  assert.deepEqual([h.state.panX,h.state.panY],[0,0],'starting a turn does not itself move the camera');
  await present('first');const latest=await present('second'),widget=h.widgets.get(latest.objectId);
  h.mcpFlushView();
  assert.equal(h.state.scale,.25,'follow preserves Canvas zoom');
  assert.equal(h.state.panY,48-widget.y*.25,'latest Widget starts inside the reading viewport');
  assert.equal(h.mcpRuntime.pendingView.size,0);
  const pan=h.state.panY;h.mcpFlushView();assert.equal(h.state.panY,pan,'older output never pulls the camera back');
  await present('third');h.state.drawing=true;h.mcpFlushView();
  assert.equal(h.state.panY,pan,'active drawing still blocks automatic movement');
  assert.equal(h.mcpRuntime.pendingView.get('internal').size,1);
  clearTimeout(h.mcpRuntime.layoutTimer);
});

test('native artifact bounds include every owned object and capture reuses bounded Canvas path',async()=>{
  const h=harness();await h.mcpExecute('mcp_start_session',{sessionId:'one',title:'Drawing'},{});
  h.widgets.set('first',{id:'first',x:100,y:200,w:100,h:80});h.widgets.set('last',{id:'last',x:400,y:400,w:100,h:80});
  h.mcpRuntime.sessions.get('one').artifacts.set('drawing',{kind:'drawing',objectId:'first',objectIds:['first','last'],elements:[['a',{objectId:'first',kind:'image'}],['b',{objectId:'last',kind:'text'}]]});
  const inspected=await h.mcpExecute('mcp_inspect_session',{sessionId:'one'},{});assert.equal(inspected.artifacts[0].bounds.w,400);assert.equal(inspected.artifacts[0].elements.length,2);
  await h.mcpExecute('mcp_capture_primitives',{sessionId:'one',artifactId:'drawing'},{});assert.equal(h.captureRequests[0].quality,'basic');assert.equal(h.captureRequests[0].region.width,448);
  await assert.rejects(h.mcpExecute('mcp_capture_primitives',{sessionId:'one',artifactId:'unowned'},{}),/not found/);
});

test("quiet supporting updates never frame and review requests win bounded framing",async()=>{
  const h=harness();await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Review"},{});h.mcpRuntime.ready=true;h.mcpRuntime.socket={readyState:1,close(){}};
  const create=(id,presentation)=>h.mcpExecute("mcp_present_widget",{sessionId:"one",artifactId:id,title:id,html:"<p>Content</p>",presentation},{});
  await create("support",{role:"supporting"});assert.equal(h.mcpRuntime.pendingView.size,0);
  await create("main",{intent:"deliver"});const review=await create("review",{intent:"review"});
  h.context.canvasAgentFramePlan=()=>({scale:.6});h.mcpFlushView();
  assert.equal(h.context.frames.length,1);assert.equal(h.context.frames[0].y,h.widgets.get(review.objectId).y);assert.equal(h.mcpRuntime.pendingView.get("one").size,1);
  h.mcpDisconnect();
});
test("narrow comparisons fall below and initial placement follows the supplied viewport",()=>{
  const h=harness(),session={artifacts:new Map([["a",{objectId:"a"}]])};
  const bounds={x:1050,y:2120,w:480,h:360};
  const plan=h.context.mcpArrange(480,360,session,{intent:"compare",relativeTo:"a"},{x:1000,y:2000,w:700,h:800},()=>bounds,()=>[]);
  assert.equal(plan.placement.x,1050);assert.equal(plan.placement.y,2512);
  const first=h.context.mcpArrange(480,360,{artifacts:new Map()},null,{x:1000,y:2000,w:1000,h:800},()=>null,()=>[]);
  assert.equal(first.placement.x,1000);assert.equal(first.placement.y,2000);
  const internal=h.context.mcpArrange(480,360,{internalAgent:true,artifacts:new Map()},null,{x:1000,y:2000,w:1000,h:800},()=>null,()=>[]);
  assert.equal(internal.placement.x,1000);assert.equal(internal.placement.y,2000);
});
test("source updates preserve user geometry and presentation identity",async()=>{
  const h=harness();h.context.widgetEditContext=w=>({...w});h.context.canvasAgentHash=async()=>"hash";h.context.canvasAgentReplaceWidget=async({command,objectId})=>Object.assign(h.widgets.get(objectId),{html:command.html});
  await h.mcpExecute("mcp_start_session",{sessionId:"one",title:"Design"},{});
  const result=await h.mcpExecute("mcp_present_widget",{sessionId:"one",artifactId:"main",title:"Design",html:"<p>A</p>",presentation:{intent:"review",size:"wide"}},{});
  const widget=h.widgets.get(result.objectId);Object.assign(widget,{x:3000,y:4000,w:700,h:400});
  await h.mcpExecute("mcp_present_widget",{sessionId:"one",artifactId:"main",title:"Design",html:"<p>B</p>",width:480},{});
  assert.deepEqual([widget.x,widget.y,widget.w,widget.h],[3000,4000,700,400]);assert.equal(h.mcpRuntime.sessions.get("one").artifacts.get("main").presentation.intent,"review");
});
test("temporary inspect releases its sandbox on success and failure without Canvas mutation",async()=>{
  const h=harness();h.context.canvasClientId=()=>"test";let mounted=0,unmounted=0;
  h.context.mountWidget=w=>{mounted++;w.shell={setAttribute(){},style:{}};};h.context.unmountWidget=()=>{unmounted++;};
  h.context.mcpCaptureWidget=async w=>({dataUrl:"data:image/webp;base64,AQ==",objectId:w.id,viewport:{width:w.contentW,height:w.contentH}});
  const args={artifactId:"test",title:"Inspect",html:"<p>Test</p>",presentation:{intent:"inspect",size:"tall"},capture:true};
  const result=await h.context.mcpInspectHtml(args,{});assert.equal(result.ephemeral,true);assert.equal(result.objectId,undefined);assert.equal(result.viewport.height,752);
  assert.equal(h.widgets.size,0);assert.equal(h.state.userRevision,1);assert.equal(h.mcpRuntime.previews.size,0);
  h.context.mcpCaptureWidget=async()=>{throw Error("capture failed");};await assert.rejects(h.context.mcpInspectHtml(args,{}),/capture failed/);
  assert.equal(mounted,2);assert.equal(unmounted,2);assert.equal(h.mcpRuntime.previews.size,0);
});

test('attention frames a whole native artifact rather than one diagram element',async()=>{
 const h=harness();await h.mcpExecute('mcp_start_session',{sessionId:'one',title:'Diagram'},{});h.mcpRuntime.ready=true;h.mcpRuntime.socket={readyState:1,close(){}};
 const session=h.mcpRuntime.sessions.get('one');h.widgets.set('node-a',{id:'node-a',x:100,y:100,w:100,h:80});h.widgets.set('node-b',{id:'node-b',x:400,y:300,w:100,h:80});
 session.artifacts.set('diagram',{kind:'drawing',objectId:'node-a',objectIds:['node-a','node-b'],presentation:{intent:'review',attention:'request'}});
 h.context.canvasAgentFramePlan=()=>({scale:.6});h.mcpQueueView(session,h.widgets.get('node-a'));h.mcpQueueView(session,h.widgets.get('node-b'));h.mcpFlushView();
 assert.equal(h.context.frames[0].w,400);assert.equal(h.context.frames[0].h,280);assert.equal(h.mcpRuntime.pendingView.size,0);h.mcpDisconnect();
});
test('visible but unreadably zoomed-out content still receives readable framing',async()=>{
 const h=harness();await h.mcpExecute('mcp_start_session',{sessionId:'one',title:'Result'},{});h.mcpRuntime.ready=true;h.mcpRuntime.socket={readyState:1,close(){}};
 h.state.scale=.1;h.context.viewportRect=()=>({x:0,y:0,w:10000,h:10000});
 await h.mcpExecute('mcp_present_widget',{sessionId:'one',artifactId:'main',title:'Result',html:'<p>Readable result</p>'},{});h.mcpFlushView();
 assert.equal(h.context.frames.length,1);h.mcpDisconnect();
});

test('inspect reports bounded attention state and the active view guard',async()=>{
 const h=harness();await h.mcpExecute('mcp_start_session',{sessionId:'one',title:'Attention'},{});
 h.mcpRuntime.pendingView.set('one',new Set(['preview-a','preview-b']));h.mcpRuntime.viewPaused=true;h.state.scale=.625;
 const reset=()=>{
  h.context.document.hidden=false;h.context.document.activeElement=null;h.context.document.getElementById=()=>null;
  Object.assign(h.state,{navigationLocked:false,drawing:false,panGesture:null,touchGesture:null,widgetGesture:null,imageGesture:null,selectionGesture:null,animationGesture:null,pointers:new Map(),canvasAgentNavigationPointerIds:new Set(),textEditors:new Map()});
  h.mcpRuntime.queued=0;
 };
 reset();h.state.pointers.set(99,{hover:true});
 const idle=await h.mcpExecute('mcp_inspect_session',{sessionId:'one'},{});
 assert.equal(idle.attention.pendingObjects,2);assert.equal(idle.attention.paused,true);assert.equal(idle.attention.blockedBy,null);assert.equal(idle.attention.canvasScale,.625);
 const cases=[
  ['page hidden',()=>{h.context.document.hidden=true;},'page-hidden'],
  ['navigation lock',()=>{h.state.navigationLocked=true;},'navigation-locked'],
  ['active pointer',()=>{h.state.canvasAgentNavigationPointerIds.add(7);},'active-gesture'],
  ['active gesture',()=>{h.state.panGesture={active:true};},'active-gesture'],
  ['text editing',()=>{h.state.textEditors.set('editor',{});},'text-editing'],
  ['widget interaction',()=>{h.context.document.activeElement={tagName:'IFRAME'};},'widget-interaction'],
  ['settings open',()=>{h.context.document.getElementById=id=>id==='settingsLayer'?{hidden:false}:null;},'settings-open'],
  ['canvas queue',()=>{h.mcpRuntime.queued=2;},'canvas-queue'],
 ];
 for(const [label,setup,expected] of cases){reset();setup();const result=await h.mcpExecute('mcp_inspect_session',{sessionId:'one'},{});assert.equal(result.attention.blockedBy,expected,label);assert.equal(result.attention.pendingObjects,2,label);assert.equal(result.attention.paused,true,label);assert.equal(result.attention.canvasScale,.625,label);}
 h.mcpDisconnect();
});

test('manual show focuses visible content but never bypasses view guards',async()=>{
 const h=harness();await h.mcpExecute('mcp_start_session',{sessionId:'one',title:'Show'},{});h.mcpRuntime.ready=true;h.mcpRuntime.socket={readyState:1,close(){}};
 h.context.viewportRect=()=>({x:0,y:0,w:1000,h:900});
 const session=h.mcpRuntime.sessions.get('one'),widget={id:'preview',x:100,y:100,w:480,h:360};h.widgets.set(widget.id,widget);session.artifacts.set('preview',{objectId:widget.id,title:'Preview'});
 const reset=()=>{
  h.context.document.hidden=false;h.context.document.activeElement=null;h.context.document.getElementById=()=>null;
  Object.assign(h.state,{navigationLocked:false,drawing:false,panGesture:null,touchGesture:null,widgetGesture:null,imageGesture:null,selectionGesture:null,animationGesture:null,pointers:new Map(),canvasAgentNavigationPointerIds:new Set(),textEditors:new Map(),scale:1,panX:0,panY:0});
  h.mcpRuntime.queued=0;h.mcpRuntime.viewPaused=false;h.mcpRuntime.pendingView.set('one',new Set([widget.id]));h.context.frames.length=0;
 };
 reset();h.mcpFlushView(false);assert.equal(h.context.frames.length,0,'automatic flush leaves already-visible content in place');assert.equal(h.mcpRuntime.pendingView.size,0);
 reset();h.mcpFlushView(true);assert.equal(h.context.frames.length,1,'manual Show explicitly focuses visible content');assert.equal(h.mcpRuntime.pendingView.size,0);
 reset();h.state.pointers.set(99,{hover:true});h.mcpFlushView(true);assert.equal(h.context.frames.length,1,'hover bookkeeping must not block manual Show');assert.equal(h.mcpRuntime.pendingView.size,0);
 const guards=[
  ['page hidden',()=>{h.context.document.hidden=true;}],
  ['navigation lock',()=>{h.state.navigationLocked=true;}],
  ['active pointer',()=>{h.state.canvasAgentNavigationPointerIds.add(3);}],
  ['active gesture',()=>{h.state.panGesture={active:true};}],
  ['text editing',()=>{h.state.textEditors.set('editor',{});}],
  ['widget interaction',()=>{h.context.document.activeElement={tagName:'IFRAME'};}],
  ['settings open',()=>{h.context.document.getElementById=id=>id==='settingsLayer'?{hidden:false}:null;}],
  ['canvas queue',()=>{h.mcpRuntime.queued=2;}],
 ];
 for(const [label,setup] of guards){reset();setup();h.mcpFlushView(true);assert.equal(h.context.frames.length,0,`${label}: Show must not frame while blocked`);assert.equal(h.mcpRuntime.pendingView.get('one')?.size,1,`${label}: pending object must remain`);clearTimeout(h.mcpRuntime.layoutTimer);h.mcpRuntime.layoutTimer=0;}
 h.mcpDisconnect();
});

test("internal presentation works without MCP and survives external disconnect while respecting user navigation",async()=>{
  const h=harness(),unmounted=[];
  const statusNodes=Object.fromEntries(["mcpCanvasNotice","mcpCanvasNoticeButton","mcpShowNewContent","mcpCanvasRing"].map(id=>[id,{hidden:true,setAttribute(){}}]));
  h.context.document.getElementById=id=>statusNodes[id]||null;
  h.context.unmountWidget=widget=>unmounted.push(widget.id);
  await h.mcpExecute("mcp_start_session",{sessionId:"internal",title:"Internal"},{});
  const session=h.mcpRuntime.sessions.get("internal");session.internalAgent=true;
  await h.mcpExecute("mcp_present_widget",{sessionId:"internal",artifactId:"page",title:"Page",html:"<p>Visible</p>"},{});
  assert.equal(h.mcpRuntime.ready,false);assert.equal(h.mcpRuntime.pendingView.size,1);
  assert.equal(statusNodes.mcpCanvasNotice.hidden,false);assert.equal(statusNodes.mcpShowNewContent.hidden,false);
  assert.equal(statusNodes.mcpCanvasNoticeButton.hidden,true);assert.equal(statusNodes.mcpCanvasRing.hidden,true);
  h.mcpPauseView();h.mcpFlushView();assert.equal(h.context.frames.length,0);
  h.mcpRuntime.sessions.set("external",{sessionId:"external",artifacts:new Map()});
  h.mcpRuntime.previews.set("internal-preview",{id:"internal-preview",internalAgent:true});
  h.mcpRuntime.previews.set("external-preview",{id:"external-preview"});
  h.mcpDisconnect();
  assert.equal(h.mcpRuntime.sessions.get("internal"),session);
  assert.equal(h.mcpRuntime.sessions.has("external"),false);
  assert.deepEqual(unmounted,["external-preview"]);
  assert.equal(h.mcpRuntime.previews.has("internal-preview"),true);
  assert.equal(h.mcpRuntime.pendingView.size,1);assert.equal(h.mcpRuntime.viewPaused,true);
  h.mcpFlushView(true);assert.equal(h.context.frames.length,1);assert.equal(h.mcpRuntime.pendingView.size,0);
});

test("internal user feedback is available without an external socket",async()=>{
  const h=harness();
  await h.mcpExecute("mcp_start_session",{sessionId:"internal-feedback",title:"Internal"},{});
  h.mcpRuntime.sessions.get("internal-feedback").internalAgent=true;
  h.mcpRecordFeedback("text",{x:10,y:20,w:100,h:40},{id:"annotation",text:"Please enlarge this label"});
  h.mcpDisconnect();
  const result=await h.mcpExecute("mcp_read_feedback",{sessionId:"internal-feedback",capture:false},{});
  assert.equal(result.entries.length,1);assert.equal(result.entries[0].text,"Please enlarge this label");
  assert.equal(result.nextCursor,1);
});

test('new page uses viewport dimensions without changing Canvas scale or camera',async()=>{
 const h=harness();await h.mcpExecute('mcp_start_session',{sessionId:'page',title:'Page'},{});
 h.mcpRuntime.ready=true;h.mcpRuntime.socket={readyState:1,close(){}};
 const source=fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
 const start=source.indexOf('  function canvasAgentFramePlan('),end=source.indexOf('  function canvasAgentFrameRegion(',start);
 Object.assign(h.context,{view:{clientWidth:640,clientHeight:480},canvasAgentPanel:{hidden:true}});
 vm.runInContext(source.slice(start,end),h.context);
 Object.assign(h.state,{scale:.08,panX:17,panY:23});
 h.context.canvasAgentFrameRegion=region=>{h.context.frames.push(region);};
 const result=await h.mcpExecute('mcp_present_widget',{sessionId:'page',artifactId:'page',title:'Page',html:'<p>Report</p>',presentation:{size:'page'}},{});
 const widget=h.widgets.get(result.objectId),beforeView=[h.state.scale,h.state.panX,h.state.panY];h.mcpFlushView();
 assert.equal(h.context.frames.length,0,'responsive widgets do not run the legacy zoom-to-fit');
 assert.equal(widget.contentW,592);assert.equal(widget.contentH,408);
 assert.equal(widget.w,widget.contentW/beforeView[0]);assert.equal(widget.h,widget.contentH/beforeView[0]);
 assert.ok(Math.abs(widget.w*h.state.scale/widget.contentW-1)<.001,'18px stays 18px on screen');
 assert.ok(Math.abs(widget.h*h.state.scale/widget.contentH-1)<.001);
 assert.deepEqual([h.state.scale,h.state.panX,h.state.panY],beforeView,'initial placement preserves the current Canvas camera');
 assert.equal(h.mcpRuntime.pendingView.size,0);assert.equal(h.mcpRuntime.viewPaused,false);h.mcpDisconnect();
});

test("external initial placement avoids occupied inset and stays within Canvas bounds",()=>{
  const h=harness(),arrange=(w,height,collisions)=>h.context.mcpArrange(w,height,{artifacts:new Map()},null,null,()=>null,collisions);
  const empty=arrange(1200,800,()=>[]);
  assert.deepEqual([empty.placement.x,empty.placement.y],[0,0]);
  const occupied={x:0,y:0,w:1200,h:800};
  const avoided=arrange(1200,800,box=>h.context.intersection(box,occupied)?[occupied]:[]);
  assert.deepEqual([avoided.placement.x,avoided.placement.y],[0,832]);
  const large=arrange(32000,32000,()=>[]);
  assert.deepEqual([large.placement.x,large.placement.y],[0,0]);
});

test('initial placement uses the supplied viewport coordinates for an internal document',()=>{
 const h=harness(),view={x:2400,y:1800,w:1000,h:800,readableWidth:952};
 const plan=h.context.mcpArrange(480,360,{internalAgent:true,artifacts:new Map()},null,view,()=>null,()=>[]);
 assert.deepEqual([plan.placement.x,plan.placement.y],[2400,1800]);
});

test('viewport presentation caps each axis, leaves inspect exact and uses saved geometry for parked documents',()=>{
 const h=harness();h.state.scale=.5;h.context.canvasAgentFramePlan=()=>({stage:{x:0,y:0,w:1000,h:700}});
 const page=h.context.mcpPresentationSize({width:1200,height:800});
 assert.deepEqual({...page},{width:1904,height:1256,contentWidth:952,contentHeight:628});
 const portrait=h.context.mcpPresentationSize({width:390,height:844});
 assert.deepEqual({...portrait},{width:780,height:1256,contentWidth:390,contentHeight:628});
 assert.deepEqual({...h.context.mcpPresentationSize({width:390,height:844,presentation:{intent:'inspect'}})},{width:390,height:844});
 h.context.canvasDocumentsIsActive=()=>false;
 const parked=h.context.mcpPresentationSize({presentation:{size:'page'}},{stored:{item:{view:{scale:.5,region:{w:1400,h:1000}}}}});
 assert.deepEqual({...parked},{width:1304,height:856,contentWidth:652,contentHeight:428});
});

test('new parked documents use the current Canvas stage before a saved view exists',()=>{
 const h=harness();h.context.canvasDocumentsIsActive=()=>false;h.state.scale=.5;
 h.context.canvasAgentFramePlan=()=>({stage:{x:0,y:0,w:1000,h:1600}});
 const doc={stored:{item:{}}};
 const page=h.context.mcpPresentationSize({presentation:{size:'page'}},doc);
 assert.deepEqual({...page},{width:1904,height:3056,contentWidth:952,contentHeight:1528});
});

test('new widget dimensions follow the current zoom and retain readable framing',()=>{
 const h=harness();h.context.canvasAgentFramePlan=()=>({stage:{x:0,y:0,w:1000,h:700}});
 for(const zoom of [.03,.1,.5,1,2]){
  h.state.scale=zoom;
  const size=h.context.mcpPresentationSize({presentation:{size:'page'}}),widget={x:3000,y:4000,w:size.width,h:size.height,contentW:size.contentWidth,contentH:size.contentHeight};
  const frame=h.context.mcpWidgetFramePlan(widget);
  assert.equal(widget.w,size.contentWidth/zoom);
  assert.equal(widget.h,size.contentHeight/zoom);
  assert.ok(widget.w>=300&&widget.h>=200&&widget.w<=h.context.SIZE&&widget.h<=h.context.SIZE);
  assert.equal(frame.scale,zoom,'framing keeps the current Canvas scale');
  assert.ok(Math.abs(h.state.scale*widget.w/widget.contentW-1)<.002,'screen typography stays 1:1 on the x axis');
  assert.ok(Math.abs(h.state.scale*widget.h/widget.contentH-1)<.002,'screen typography stays 1:1 on the y axis');
  assert.ok(frame.panX+widget.x*frame.scale>=23.5);
  assert.ok(frame.panY+widget.y*frame.scale>=47.5);
 }
});

test('consecutive documents keep clear footprints and reveal the latest without returning to older pending results',async()=>{
 const h=harness();h.state.scale=.5;
 h.context.canvasAgentFramePlan=()=>({scale:.5,stage:{x:0,y:0,w:1000,h:700}});
 await h.mcpExecute('mcp_start_session',{sessionId:'reading',title:'Reading'},{});
 const session=h.mcpRuntime.sessions.get('reading');session.internalAgent=true;
 const first=await h.mcpExecute('mcp_present_widget',{sessionId:'reading',artifactId:'one',title:'One',html:'<p>One</p>'},{});
 const second=await h.mcpExecute('mcp_present_widget',{sessionId:'reading',artifactId:'two',title:'Two',html:'<p>Two</p>'},{});
 const a=h.widgets.get(first.objectId),b=h.widgets.get(second.objectId);
 assert.ok(b.y>=a.y+a.h+32);
 h.mcpFlushView();
 assert.ok(Math.abs(h.state.panX+(b.x+b.w/2)*h.state.scale-500)<.01);
 assert.ok(Math.abs(h.state.panY+(b.y+b.h/2)*h.state.scale-362)<.01);
 assert.equal(h.mcpRuntime.pendingView.size,0);
 const geometry=[h.state.scale,h.state.panX,h.state.panY];h.mcpFlushView();
 assert.deepEqual([h.state.scale,h.state.panX,h.state.panY],geometry);
 h.mcpDisconnect();
});

test('append at the Canvas bottom falls back to clear space without covering the prior widget',()=>{
 const h=harness(),previous={x:1000,y:30000,w:1800,h:2000},session={artifacts:new Map([['last',{objectId:'last'}]])};
 const plan=h.context.mcpArrange(1800,2000,session,{},null,()=>previous,box=>h.context.intersection(box,previous)?[previous]:[]);
 assert.ok(plan.placement.y+2000<=32768-48);
 assert.equal(h.context.intersection({...plan.placement,w:1800,h:2000},previous),false);
});


test('interleaved sessions reveal the most recently queued result',async()=>{
 const h=harness();h.state.scale=.5;h.mcpRuntime.socket={readyState:1,close(){}};h.mcpRuntime.ready=true;
 h.context.canvasAgentFramePlan=()=>({scale:.5,stage:{x:0,y:0,w:1000,h:700}});
 for(const sessionId of ['a','b'])await h.mcpExecute('mcp_start_session',{sessionId,title:sessionId},{});
 for(const [sessionId,artifactId] of [['a','one'],['b','one'],['a','two']]){
  await h.mcpExecute('mcp_present_widget',{sessionId,artifactId,title:artifactId,html:'<p>Result</p>'},{});
 }
 const latest=h.widgets.get(h.mcpRuntime.sessions.get('a').artifacts.get('two').objectId);
 h.mcpFlushView();
 assert.ok(Math.abs(h.state.panX+(latest.x+latest.w/2)*h.state.scale-500)<.01);
 assert.ok(Math.abs(h.state.panY+(latest.y+latest.h/2)*h.state.scale-362)<.01);
 assert.equal(h.mcpRuntime.pendingView.size,0);
 h.mcpDisconnect();
});

test('Widget artifact captures include full content and overflow while inspect keeps its viewport',async()=>{
 for(const ephemeral of [false,true]){
  const h=harness(),requests=[],draws=[],image={width:1200,height:2400};
  const widget={id:'long',contentW:800,contentH:400,w:1600,h:800,mcpEphemeral:ephemeral,frame:{contentWindow:{}}};
  h.context.mcpWaitForWidgetLoad=async()=>{};
  h.context.WIDGET_SNAPSHOT_TIMEOUT_MS=18000;
  h.context.CANVAS_AGENT_LAYOUT_CAPTURE_POLICY={maxLongEdge:1024,maxPixels:520000};
  h.context.requestWidgetSnapshot=async(...args)=>{requests.push(args);return args[5]?{image,contentWidth:800,contentHeight:1600,overflow:{x:true,y:true}}:{width:800,height:400};};
  h.context.document.createElement=()=>({width:0,height:0,getContext:()=>({drawImage:(...args)=>draws.push(args)})});
  h.context.canvasAgentCompressedCanvas=async canvas=>({canvas,blob:{type:'image/webp',size:12}});
  h.context.canvasAgentReadDataUrl=async()=> 'data:image/webp;base64,AQ==';
  const result=await h.context.mcpCaptureWidget(widget,{artifactId:'long'},{controller:new AbortController()});
  assert.equal(requests[0][5],!ephemeral);
  assert.deepEqual({...result.viewport},{width:800,height:400});
  assert.equal(result.capture.scope,ephemeral?'viewport':'full-content');
  if(!ephemeral){assert.deepEqual({...result.capture.contentSize},{width:800,height:1600});assert.deepEqual({...result.capture.overflow},{x:true,y:true});}
  assert.ok(result.width<=1024&&result.height<=1024&&result.width*result.height<=520000);
  assert.equal(draws.length,1);assert.deepEqual([widget.w,widget.h,widget.contentW,widget.contentH],[1600,800,800,400]);
 }
});
