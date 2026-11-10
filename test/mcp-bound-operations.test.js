"use strict";
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {BOUND_CANVAS_TOOL_NAMES,executeBoundCanvasTool,patchVirtualFile}=require('../src/server/mcp/bound-operations.js');
function harness(respond,callOptions={}) {
 const session={id:'bound',connection:{},mutationRequests:new Map()},calls=[];
 return {session,calls,run:(name,args)=>executeBoundCanvasTool({name,args:{sessionId:session.id,...args},session,canvasCall:async(connection,operation,args)=>{assert.equal(connection,session.connection);calls.push({operation,args});return {result:await respond(operation,args),timing:{requestedAt:10,completedAt:15,durationMs:5}};},callOptions})};
}
const widgetArgs={requestId:'widget-1',artifactId:'chart',title:'Chart',html:'<p>chart</p>',capture:true};
const pixels={dataUrl:'data:image/webp;base64,AQIDBA==',width:480,height:360,encodedBytes:4,revision:7};
test('full Widget capture metadata reaches MCP in artifact and combined presentation results',async()=>{
 const viewport={width:800,height:400},capture={scope:'full-content',contentSize:{width:800,height:1600},overflow:{x:false,y:true}};
 const h=harness(()=>({artifactId:'chart',objectId:'widget',...pixels,viewport,capture}));
 for(const [name,args] of [['penecho_capture_canvas',{target:'artifact',artifactId:'chart'}],['penecho_present_widget',widgetArgs]]){
  const r=await h.run(name,args);assert.deepEqual(r.viewport,viewport);assert.deepEqual(r.capture,capture);assert.equal(r.pixelVerified,true);
 }
});
test('bound tools exclude lifecycle and reject retired aliases and wrong bindings',async()=>{
 const h=harness(()=>({}));
 for(const name of ['penecho_list_canvases','penecho_open_canvas','penecho_start_session','penecho_close_session','penecho_read_feedback','penecho_read_messages','penecho_ack_messages','penecho_capture_widget'])assert.ok(!BOUND_CANVAS_TOOL_NAMES.includes(name));
 await assert.rejects(h.run('penecho_read_file',{path:'/notes.md',unexpected:true}));
 await assert.rejects(h.run('penecho_read_file',{sessionId:'other',path:'/notes.md'}),{code:'session_mismatch'});
 assert.equal(h.calls.length,0);
});
test('one presentation RPC preserves applied receipt for a failed optional capture and never marks done',async()=>{
 for(const code of ['CANVAS_NOT_VISIBLE','WIDGET_READY_TIMEOUT','WIDGET_CAPTURE_TIMEOUT','canvas_timeout']){
 const h=harness(()=>({artifactId:'chart',objectId:'widget',revision:7,captureFailure:{code,message:'Capture existing artifact after readiness',retryTool:'penecho_capture_canvas',retryArguments:{sessionId:'bound',target:'artifact',artifactId:'chart'}}}));
 const r=await h.run('penecho_present_widget',widgetArgs);
 assert.equal(r.applied,true);assert.equal(r.pixelVerified,false);assert.equal(r.image,undefined);assert.equal(r.completion,undefined);assert.equal(r.captureFailure.code,code);assert.equal(h.calls.length,1);
 assert.deepEqual(h.calls[0].args.capture,true);
 assert.equal((await h.run('penecho_present_widget',widgetArgs)).reused,true);assert.equal(h.calls.length,1);
 }
 const bad=harness(()=>({artifactId:'chart',objectId:'widget',revision:7,captureFailure:{code:'WIDGET_CAPTURE_TIMEOUT'},completion:{status:'done'}}));
 await assert.rejects(bad.run('penecho_present_widget',widgetArgs),{code:'invalid_browser_result'});
});
test('cancellation and session failures remain errors rather than applied results',async()=>{
 for(const code of ['request_cancelled','CANVAS_TOOL_FAILED','invalid_browser_result']){
 const error=Object.assign(new Error('failure'),{code}),h=harness(()=>{throw error;});
 await assert.rejects(h.run('penecho_present_widget',widgetArgs),e=>e===error);assert.equal(h.calls.length,1);
 }
});
test('failed artifact creation keeps request identity and corrected arguments need a new requestId',async()=>{
 const h=harness((operation,args)=>{
  if(args.presentation.relativeTo==='widget-2')throw Error('Related artifact not found in this session.');
  return {artifactId:'chart',objectId:'widget-3',revision:15};
 });
 const args={...widgetArgs,capture:false,presentation:{relativeTo:'widget-2',relation:'beside'}};
 await assert.rejects(h.run('penecho_present_widget',args),/Related artifact/);
 const corrected={...args,presentation:{relativeTo:'existing-chart',relation:'beside'}};
 await assert.rejects(h.run('penecho_present_widget',corrected),error=>{
  assert.equal(error.code,'REQUEST_ID_CONFLICT');assert.match(error.message,/new requestId/);assert.match(error.message,/previous attempt failed/);return true;
 });
 assert.equal(h.calls.length,1,'conflicting arguments never reach the browser');
 const retry={...corrected,requestId:'corrected-create'};
 assert.equal((await h.run('penecho_present_widget',retry)).objectId,'widget-3');
 assert.equal((await h.run('penecho_present_widget',retry)).reused,true);
 assert.equal(h.calls.length,2,'identical retry does not create another object');
});
test('combined presentation returns pixel evidence, source receipt and completion with detailed timing',async()=>{
 const completion={status:'done',summary:'Ready',handledMessageIds:['m1']};
 const h=harness(()=>({artifactId:'chart',objectId:'widget',...pixels,sourcePath:'/objects/widget/source.html',contentHash:'hash',viewport:{width:480,height:360},completion}));
 const r=await h.run('penecho_present_widget',{...widgetArgs,output:'detailed',completion});
 assert.equal(r.pixelVerified,true);assert.deepEqual(r.image,{mimeType:'image/webp',data:'AQIDBA==',bytes:4});assert.deepEqual(r.completion,completion);assert.equal(r.sourcePath,'/objects/widget/source.html');assert.equal(r.contentHash,'hash');assert.equal(r.timing.durationMs,5);assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].args.completion,completion);
 await assert.rejects(h.run('penecho_present_widget',{...widgetArgs,html:'changed'}),{code:'REQUEST_ID_CONFLICT'});
 const invalid=harness(()=>({artifactId:'chart',objectId:'widget',revision:7}));
 await assert.rejects(invalid.run('penecho_present_widget',widgetArgs),{code:'invalid_capture'});
});
test('draw and plot combine optional capture and retain their bounded validated artifact identities',async()=>{
 for(const [name,kind,extra] of [['penecho_draw','drawing',{items:[{id:'n',type:'rect'}]}],['penecho_plot','plot',{expression:'x'}]]){
 const args={requestId:'native',artifactId:'native',title:'Native',...extra,capture:true};
 const h=harness(()=>({artifactId:'native',kind,objectIds:['object'],feedbackCursor:0,...pixels}));
 const r=await h.run(name,args);assert.equal(r.pixelVerified,true);assert.deepEqual(r.objectIds,['object']);assert.equal(h.calls.length,1);
 const invalid=harness(()=>({artifactId:'other',kind,objectIds:['object'],feedbackCursor:0,...pixels}));await assert.rejects(invalid.run(name,args),{code:'invalid_browser_result'});
 }
});
test('single patch RPC preserves exact conflict and retry receipts without reading source over the bridge',async()=>{
 const h=harness((op,args)=>{assert.equal(op,'mcp_patch_file');if(args.expectedHash!=='hash-1')throw Object.assign(new Error('Changed'),{code:'SOURCE_CONFLICT'});assert.equal(patchVirtualFile('hello\n',args.patch,args.path),'world\n');return {applied:true,contentHash:'hash-2'};});
 const args={path:'/notes.md',contentHash:'hash-1',requestId:'patch-1',patch:'--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-hello\n+world\n'};
 await assert.rejects(h.run('penecho_patch_file',{...args,contentHash:'stale'}),{code:'SOURCE_CONFLICT'});assert.equal(h.session.mutationRequests.size,0);
 assert.equal((await h.run('penecho_patch_file',args)).applied,true);assert.equal(h.calls.at(-1).args.patch,args.patch);assert.equal(h.calls.at(-1).args.content,undefined);
 const count=h.calls.length;assert.equal((await h.run('penecho_patch_file',args)).reused,true);assert.equal(h.calls.length,count);
 await assert.rejects(h.run('penecho_patch_file',{...args,patch:args.patch.replace('world','again')}),{code:'REQUEST_ID_CONFLICT'});
});
test('malformed patches are rejected before any browser RPC and diagnostics never expose source',async()=>{
 const h=harness(()=>assert.fail('must not dispatch'));
 await assert.rejects(h.run('penecho_patch_file',{path:'/notes.md',contentHash:'h',requestId:'bad',patch:'--- a/notes.md\n+++ b/notes.md\n@@ -1,2 +1,2 @@\n-hello\nunprefixed private body\n+world'}),e=>{assert.equal(e.code,'invalid_patch');assert.match(e.message,/line 3/);assert.doesNotMatch(e.message,/hello|world|private/);return true;});assert.equal(h.calls.length,0);
 await assert.rejects(h.run('penecho_patch_file',{path:'/notes.md',contentHash:'h',requestId:'bad-multi',patch:'--- a/notes.md\n+++ b/notes.md\n@@ -1,2 +1,2 @@\n-hello\n+world\n@@ -5,2 +5,2 @@\n-secret old\n+secret new\n'}),e=>{assert.equal(e.code,'invalid_patch');assert.doesNotMatch(e.message,/hello|world|secret/);return true;});assert.equal(h.calls.length,0);
 const secret='PRIVATE_SOURCE_SHOULD_NOT_BE_ECHOED';assert.throws(()=>patchVirtualFile('hello\n',`--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-hello\n${secret}\n+world`,'/notes.md'),e=>{assert.equal(e.code,'invalid_patch');assert.doesNotMatch(e.message,new RegExp(secret));return true;});
 assert.throws(()=>patchVirtualFile('hello\n',undefined,'/notes.md'),{code:'invalid_patch'});
});
test('image mutations preserve independent request receipts and document binding',async()=>{
 const h=harness(op=>({operation:op,revision:2,documentId:'doc'})),source='penecho-asset:'+'a'.repeat(64);
 for(const [name,args] of [['penecho_upload_image',{requestId:'u',name:'Image',source}],['penecho_place_image',{requestId:'p',source}]]){
 assert.equal((await h.run(name,args)).operation,name.replace('penecho_','mcp_'));assert.equal((await h.run(name,args)).reused,true);
 await assert.rejects(h.run(name,{...args,source:'penecho-asset:'+'b'.repeat(64)}),{code:'REQUEST_ID_CONFLICT'});
 await assert.rejects(h.run(name,{...args,sessionId:'foreign'}),{code:'session_mismatch'});
 }
 await assert.rejects(h.run('penecho_edit_canvas',{requestId:'p',action:'show'}),{code:'REQUEST_ID_CONFLICT'});assert.equal(h.calls.length,2);
});
test('inbox preserves two independent pages and acknowledges only explicit IDs',async()=>{
 const h=harness((op,args)=>{assert.equal(op,'mcp_inbox');return args.mode==='ack'?{sessionId:'bound',acknowledged:args.ids}:{sessionId:'bound',messages:{after:4,nextCursor:5,latestCursor:9,hasMore:true,messages:[{id:'m5',cursor:5,text:'Continue'}]},feedback:{sessionId:'bound',after:7,nextCursor:7,latestCursor:7,hasMore:false,truncated:false,entries:[]}};});
 const r=await h.run('penecho_inbox',{messageAfter:4,feedbackAfter:7});assert.equal(r.messages.nextCursor,5);assert.equal(r.feedback.nextCursor,7);assert.equal(r.image,undefined);assert.equal(h.calls[0].args.capture,false);assert.equal(h.calls[0].args.limit,10);
 assert.deepEqual((await h.run('penecho_inbox',{mode:'ack',ids:['m5'],status:'done'})).acknowledged,['m5']);assert.equal(h.calls.length,2);
});

test('definite precommit patch failures release unresolved capacity; uncertain outcomes retain IDs',async()=>{
  let fail=true;
  const h=harness(()=>{if(fail)throw Object.assign(new Error('does not apply'),{code:'PATCH_CONFLICT'});return {applied:true,contentHash:'new'};});
  const base={path:'/notes.md',contentHash:'h',patch:'--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-a\n+b\n'};
  for(let i=0;i<5;i++)await assert.rejects(h.run('penecho_patch_file',{...base,requestId:`r${i}`}),{code:'PATCH_CONFLICT'});
  assert.equal(h.session.mutationRequests.size,0);
  fail=false;assert.equal((await h.run('penecho_patch_file',{...base,requestId:'valid'})).applied,true);
  const unknown=harness(()=>{throw Object.assign(new Error('timeout'),{code:'canvas_timeout'});});
  await assert.rejects(unknown.run('penecho_patch_file',{...base,requestId:'unknown'}),{code:'canvas_timeout'});assert.equal(unknown.session.mutationRequests.size,1);
});

test('completion flushes queued progress before mutation and synchronizes session state only once',async()=>{
  const order=[],session={id:'bound',connection:{},status:'working',summary:'old',mutationRequests:new Map()};
  const args={sessionId:'bound',requestId:'done-edit',action:'create_text',text:'Done',completion:{status:'done',summary:'Ready'}};
  const run=()=>executeBoundCanvasTool({name:'penecho_edit_canvas',args,session,flushUpdate:async()=>order.push('flush-working'),canvasCall:async()=>{order.push('mutation-done');return {result:{applied:true,completion:args.completion},timing:{requestedAt:1,completedAt:2,durationMs:1}};}});
  await run();assert.deepEqual(order,['flush-working','mutation-done']);assert.equal(session.status,'done');assert.equal(session.summary,'Ready');
  session.status='waiting';await run();assert.equal(session.status,'waiting');assert.deepEqual(order,['flush-working','mutation-done']);
});

test('presentation presets are normalized once before RPC, without conflicting synthesized dimensions',async()=>{
  const h=harness((op,args)=>({artifactId:args.artifactId,kind:'plot',objectIds:['plot'],revision:1,feedbackCursor:0}));
  await h.run('penecho_plot',{requestId:'plot-size',artifactId:'plot',title:'Plot',expression:'x',presentation:{size:'wide'}});
  assert.equal(h.calls[0].args.width,992);assert.equal(h.calls[0].args.height,360);assert.equal(h.calls[0].args.presentation.size,'wide');
});
