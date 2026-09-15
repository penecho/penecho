'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const persistence=fs.readFileSync(path.join(__dirname,'../src/client/app/persistence.js'),'utf8');
const runtime=fs.readFileSync(path.join(__dirname,'../src/client/app/mcp-runtime.js'),'utf8');
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const frames=new Map(),timers=new Map(),listeners=new Set();let next=0,decoded=0;
  const document={hidden:false,addEventListener:(_name,fn)=>listeners.add(fn),removeEventListener:(_name,fn)=>listeners.delete(fn)};
  class Socket extends EventTarget{
    static OPEN=1;readyState=1;sent=[];
    send(raw){this.sent.push(JSON.parse(raw));}
    close(){this.readyState=3;}
    receive(message){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(message)}));}
  }
  const mcpRuntime={socket:null,browserId:null,generation:0,controllers:new Map(),previews:new Map(),sessions:new Map(),pendingView:new Map(),queue:Promise.resolve(),queued:0,reconnectDelay:1000};
  const context=vm.createContext({Error,Promise,Map,Array,Set,JSON,Date,Math,AbortController,WebSocket:Socket,Event,MessageEvent,performance,document,mcpRuntime,
    window:{PenEchoCloudMcpSocket:Socket},state:{currentSnapshotName:'Test'},
    requestAnimationFrame:fn=>{const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    SNAPSHOT_IMAGE_DECODE_BATCH_SIZE:Number(persistence.match(/SNAPSHOT_IMAGE_DECODE_BATCH_SIZE\s*=\s*(\d+)/)[1]),MAX_VISIBLE_IMAGES:100,MCP_BROWSER_CALL_DEADLINE_MS:44000,
    decodeStoredImage:async item=>{decoded++;return item;},mcpLocal:()=>true,canvasClientId:()=> 'browser',mcpHeartbeat:()=>{},mcpRenderSettings:()=>{},
    canvasAgentAssertToolExecution:execution=>{if(execution.generation!==mcpRuntime.generation||execution.socket!==mcpRuntime.socket||execution.controller.signal.aborted)throw Error('cancelled');}
  });
  vm.runInContext(section(persistence,'  function waitForSnapshotTileFrame(','  async function finalizeCanvasForSnapshot()'),context);
  vm.runInContext(section(runtime,'  function mcpExecutionAbortError(','  function mcpExecutionCurrent(')+section(runtime,'  function mcpDisconnect(','  function mcpDisposeSession(')+section(runtime,'  function mcpConnect(','  function mcpEscape('),context);
  const connect=()=>{context.mcpConnect(true);return mcpRuntime.socket;};
  const runFallback=()=>{const entry=[...timers].find(([,value])=>value.ms===100||value.ms===0);assert.ok(entry,'frame fallback scheduled');timers.delete(entry[0]);entry[1].fn();};
  return {context,mcpRuntime,frames,timers,listeners,document,connect,runFallback,decoded:()=>decoded};
}

const documents=fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-documents.js'),'utf8');
const canvas=fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-runtime.js'),'utf8');
function documentsHarness() {
  const h=harness(),socket=h.connect(),execution={kind:'mcp',socket,generation:h.mcpRuntime.generation,controller:new AbortController()};
  Object.assign(h.context,{
    canvasDocuments:{records:new Map(),epoch:1},
    canvasDocumentsError:(code,message)=>Object.assign(Error(message),{code}),
    canvasDocumentsMetadata:doc=>({documentId:doc.id}),canvasDocumentsWorkspaceData:()=>({}),canvasDocumentsUnseen:value=>value||0,
  });
  vm.runInContext(section(documents,'  async function canvasDocumentsAwait(','  function canvasDocumentsId(')+section(documents,'  async function canvasDocumentsPersist(','  function canvasDocumentsReport('),h.context);
  return {...h,execution};
}
test('follow gets an independent deadline and disconnect aborts its registered execution',async()=>{
  const h=harness();let follow;
  h.context.window.PenEchoStudioNavigator={flushMcpFollow:execution=>{
    follow=execution;
    return h.context.mcpWaitForExecution(new Promise(()=>{}),execution);
  }};
  h.context.canvasDocumentsExecute=async()=>({read:true});
  const socket=h.connect();socket.receive({type:'call',requestId:'read',name:'read',arguments:{}});
  await h.mcpRuntime.queue;await tick();
  assert.equal(socket.sent[0].ok,true);assert.equal(h.mcpRuntime.queued,0);
  assert.equal(h.mcpRuntime.controllers.has('read'),false);
  assert.equal(h.mcpRuntime.controllers.get('mcp-follow'),follow.controller);
  assert.equal([...h.timers.values()].filter(timer=>timer.ms===44000).length,1);
  h.context.mcpDisconnect();await tick();
  assert.equal(follow.controller.signal.aborted,true);
  assert.equal(h.mcpRuntime.followOperation,null);assert.equal(h.mcpRuntime.controllers.size,0);
  assert.equal([...h.timers.values()].filter(timer=>timer.ms===44000).length,0);
});
test('follow deadline cancels stalled presentation after the RPC already succeeded',async()=>{
  const h=harness();let follow;
  h.context.window.PenEchoStudioNavigator={flushMcpFollow:execution=>{
    follow=execution;return h.context.mcpWaitForExecution(new Promise(()=>{}),execution);
  }};
  h.context.canvasDocumentsExecute=async()=>({read:true});
  h.connect().receive({type:'call',requestId:'read',name:'read',arguments:{}});
  await h.mcpRuntime.queue;await tick();
  const timer=[...h.timers.values()].find(value=>value.ms===44000);assert.ok(timer);timer.fn();await tick();
  assert.equal(follow.controller.signal.reason.code,'CANVAS_OPERATION_TIMEOUT');
  assert.equal(h.mcpRuntime.followOperation,null);assert.equal(h.mcpRuntime.controllers.size,0);
});
test('IndexedDB timeout aborts the transaction but capacity is retained until physical settlement',async()=>{
  const h=documentsHarness();let tx,aborts=0,puts=0;
  h.context.canvasDocumentsDb=async()=>({transaction:()=>{
    tx={abort:()=>{aborts++;},objectStore:()=>({put:()=>puts++})};return tx;
  }});
  const pending=h.context.canvasDocumentsPersist({id:'doc'},false,h.execution);
  const rejected=assert.rejects(pending,error=>error.code==='STORAGE_TIMEOUT');await tick();
  assert.equal(puts,1);assert.equal(h.context.canvasDocuments.pendingPreparations.size,1);
  const timer=[...h.timers.values()].find(value=>value.ms===15000);assert.ok(timer);timer.fn();await rejected;
  assert.ok(aborts>=1);assert.equal(h.context.canvasDocuments.pendingPreparations.size,1);
  tx.onabort();await tick();
  assert.equal(h.context.canvasDocuments.pendingPreparations.size,0);
  assert.equal([...h.timers.values()].filter(value=>value.ms===15000).length,0);
});
function prepareShow(h,doc) {
  Object.assign(h.context,{
    canvasDocumentsIsActive:value=>value.id==='active',canvasDocumentsRender:()=>{},
    canvasDocumentsPark:async()=>{},canvasDocumentsCurrent:()=>({id:'active'}),
    canvasAgent:{},snapshotLoadInProgress:false,
    decodeSnapshotTilesInBatches:async()=>new Map(),decodeSnapshotImagesInBatches:async()=>[],releaseSnapshotTileCanvases:value=>value.clear(),
    ensurePluginRuntime:async()=>{},
  });
  Object.assign(h.context.state,{userRevision:1,textEditors:new Map()});
  h.context.canvasDocuments.records.set(doc.id,doc);
  vm.runInContext(section(documents,'  async function canvasDocumentsShow(','  function canvasDocumentsApplyView('),h.context);
}
test('history hydration starts one decoder and canceled switches never start the remaining images',async()=>{
  const h=documentsHarness();let resolveImage;const calls=[];
  const images=Array.from({length:8},()=>({blob:{}})),doc={id:'other',revision:1,undo:[{imagesBefore:images}],redo:[],stored:{item:{images:[],textBoxes:[],widgets:[]},tileEntries:[]}};
  prepareShow(h,doc);
  h.context.decodeStoredImage=(image,execution)=>{calls.push({image,execution});return new Promise(resolve=>{resolveImage=resolve;});};
  const pending=h.context.canvasDocumentsShow(doc.id,h.execution);
  const rejected=assert.rejects(pending);await tick();
  assert.equal(calls.length,1);assert.equal(calls[0].execution,h.execution);
  h.execution.controller.abort();await rejected;
  assert.equal(h.context.canvasDocuments.switching,false);
  assert.equal(h.context.canvasDocuments.pendingPreparations.size,1);
  resolveImage({image:{}});await tick();
  assert.equal(calls.length,1);assert.equal(h.context.canvasDocuments.pendingPreparations.size,0);
  assert.equal(doc.undo[0].imagesBefore,images);
});
test('text preparation cancellation releases owned raster and preserves borrowed history raster',async()=>{
  const h=documentsHarness(),borrowed={width:80,height:40},owned={width:120,height:60},released=[];let resolveText;
  Object.assign(h.context,{
    MAX_VISIBLE_TEXT_BOXES:100,SIZE:32768,textImageRasterRatio:()=>1,textBoxHistoryRecord:item=>({...item}),
    releaseTextRaster:image=>{released.push(image);image.width=image.height=1;},
    renderedTextBoxRecord:()=>new Promise(resolve=>{resolveText=resolve;}),
  });
  vm.runInContext(section(canvas,'  async function mcpPrepareTextBoxes(','  async function restoreTextBoxes('),h.context);
  const pending=h.context.mcpPrepareTextBoxes([{id:'text-box-1',image:borrowed},{id:'text-box-2',text:'new'}],h.execution);
  const rejected=assert.rejects(pending);await tick();h.execution.controller.abort();resolveText({id:'text-box-2',image:owned});await rejected;
  assert.deepEqual(released,[owned]);assert.equal(borrowed.width,80);assert.equal(borrowed.height,40);
});
test('show cleanup does not release borrowed text raster when cancellation wins delivery race',async()=>{
  const h=documentsHarness(),borrowed={width:80,height:40},owned={width:120,height:60},released=[];
  const doc={id:'other',revision:1,undo:[],redo:[],stored:{item:{images:[],textBoxes:[{image:borrowed}],widgets:[]},tileEntries:[]}};
  prepareShow(h,doc);
  h.context.releaseTextRaster=image=>released.push(image);
  h.context.mcpPrepareTextBoxes=()=>{h.execution.controller.abort();return [{image:borrowed},{image:owned}];};
  await assert.rejects(h.context.canvasDocumentsShow(doc.id,h.execution));await tick();
  assert.deepEqual(released,[owned]);assert.equal(h.context.canvasDocuments.switching,false);
});

test('already-active MCP show preserves unread and cannot reveal after a cancelled wait',async()=>{
  const h=documentsHarness(),doc={id:'active',unseen:1};let resolveShow,reveals=0,saves=0,showExecution,showOptions;
  prepareShow(h,doc);
  const show=h.context.canvasDocumentsShow;
  h.context.canvasDocumentsPersist=()=>{saves++;throw Error('Automatic show must not acknowledge unread updates');};
  h.context.canvasDocumentsShow=async(id,execution,options)=>{
    showExecution=execution;showOptions=options;await show(id,execution,options);
    await new Promise(resolve=>{resolveShow=resolve;});
  };
  h.context.mcpRevealRegion=()=>reveals++;
  const start=documents.indexOf('  async function canvasDocumentsEdit('),end=documents.indexOf('\n  async function ',start+10);
  vm.runInContext(documents.slice(start,end),h.context);
  const pending=h.context.canvasDocumentsEdit(doc,{action:'show',region:{x:0,y:0,w:10,h:10}},h.execution);
  const rejected=assert.rejects(pending);await tick();
  assert.equal(showExecution,h.execution);assert.equal(showOptions.markSeen,false);
  assert.equal(doc.unseen,1);assert.equal(saves,0);
  h.execution.controller.abort();resolveShow();await rejected;
  assert.equal(reveals,0);assert.equal(h.execution.activeDocumentId,undefined);
});
test('MCP history image decode revokes its object URL when image loading stalls',async()=>{
  const h=documentsHarness(),revoked=[],images=[];
  h.context.URL={createObjectURL:()=> 'blob:history',revokeObjectURL:url=>revoked.push(url)};
  h.context.Image=class {constructor(){images.push(this);}};
  vm.runInContext(section(persistence,'  function imageFromBlob(','  function releaseSnapshotTileCanvases('),h.context);
  const pending=h.context.imageFromBlob({},h.execution),rejected=assert.rejects(pending,/decoding timed out/);
  const timer=[...h.timers.values()].find(value=>value.ms===15000);assert.ok(timer);timer.fn();await rejected;
  assert.deepEqual(revoked,['blob:history']);assert.equal(images[0].src,'');
  assert.equal(images[0].onload,null);assert.equal(images[0].onerror,null);
});
