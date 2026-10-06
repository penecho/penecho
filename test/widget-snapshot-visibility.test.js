'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/canvas-runtime.js'),'utf8');
test('navigation visibility updates keep a capture target active until its capture ends',()=>{
 const start=source.indexOf('  function updateWidgetRenderVisibility('),end=source.indexOf('  let canvasWidgetCarrierPanX',start),classes=new Set();
 let initialized=0;
 const fn=vm.runInNewContext(source.slice(start,end)+';updateWidgetRenderVisibility',{view:{clientWidth:1000,clientHeight:800},state:{scale:1},sendWidgetInit:()=>initialized++});
 const widget={w:400,h:400,shell:{classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}}};
 assert.equal(fn(widget,2000,2000),false);
 widget.snapshotCaptureActive=true;
 assert.equal(fn(widget,2000,2000),true);assert.equal(classes.has('widget-offscreen'),false);assert.equal(initialized,1);
 widget.snapshotCaptureActive=false;
 assert.equal(fn(widget,2000,2000),false);assert.equal(classes.has('widget-offscreen'),true);
 assert.equal(fn(widget,100,100),true);
});
test('capture activity lease covers the shared capture; cancelling a caller detaches it without orphaning the host render',async()=>{
 const start=source.indexOf('  async function requestWidgetSnapshot('),end=source.indexOf('  async function handleWidgetMessage(',start);
 for(const abort of [false,true]){
  const pending=new Map(),controller=new AbortController(),states=[];
  const widget={id:'w',renderActive:false,hostReady:true,initialized:true,contentW:400,contentH:400,contentVersion:0,shell:{classList:{remove(){},add(){}}},frame:{contentWindow:{postMessage(){}}}};
  const context={performance,crypto:{randomUUID:()=> 'capture'},WIDGET_SNAPSHOT_TIMEOUT_MS:1000,widgetSnapshotRequests:pending,location:{origin:'http://local'},setTimeout,clearTimeout,
   sendWidgetHostState(){states.push(widget.renderActive);},widgetSnapshotAbortError:()=>Error('cancelled'),debug(){},t:x=>x,positionWidget(){assert.fail('no style rule');}};
  const fn=vm.runInNewContext(source.slice(start,end)+';requestWidgetSnapshot',context);
  const promise=fn(widget,1000,true,controller.signal);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(widget.snapshotCaptureActive,true);assert.equal(widget.renderActive,true);
  const request=pending.get('capture');
  if(abort){
   controller.abort();await assert.rejects(promise,/cancelled/);
   assert.equal(widget.snapshotCaptureActive,true,'the host render continues and will fill the cache');
   assert.ok(widget.snapshotPromise,'a later request joins the running capture');
  }
  clearTimeout(request.timer);pending.delete('capture');request.resolve({width:400,height:400});
  if(!abort)await promise;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(widget.snapshotCaptureActive,false);assert.equal(widget.renderActive,false);assert.equal(widget.snapshotPromise,null);
 }
});
test('content races and a draining host are retried within one capture budget',async()=>{
 const start=source.indexOf('  async function requestWidgetSnapshot('),end=source.indexOf('  async function handleWidgetMessage(',start);
 const pending=new Map(),posted=[];let id=0;
 const widget={id:'w',renderActive:true,hostReady:true,initialized:true,contentW:400,contentH:400,contentVersion:0,snapshotVersion:-1,shell:{classList:{remove(){},add(){}}},frame:{contentWindow:{postMessage:m=>posted.push(m)}}};
 const context={performance,crypto:{randomUUID:()=>`capture-${++id}`},WIDGET_SNAPSHOT_TIMEOUT_MS:20000,widgetSnapshotRequests:pending,location:{origin:'http://local'},setTimeout,clearTimeout,
  sendWidgetHostState(){},widgetSnapshotAbortError:()=>Error('cancelled'),debug(){},t:x=>x,positionWidget(){}};
 const fn=vm.runInNewContext(source.slice(start,end)+';requestWidgetSnapshot',context);
 const promise=fn(widget,20000,true,null);
 const next=async()=>{for(let i=0;i<40&&!pending.size;i++)await new Promise(resolve=>setTimeout(resolve,10));const [key,request]=[...pending][0];pending.delete(key);clearTimeout(request.timer);return request;};
 let request=await next();assert.equal(request.acceptContentRace,false);
 request.reject(Object.assign(Error('changed'),{code:'WIDGET_CONTENT_CHANGED'}));
 request=await next();request.reject(Object.assign(Error('busy'),{code:'WIDGET_RENDER_BUSY'}));
 request=await next();assert.equal(request.acceptContentRace,true,'the last attempt tolerates a self-updating Widget');
 const image={width:400,height:400};request.resolve(image);
 assert.equal(await promise,image);assert.equal(posted.length,3);
 const failing=fn(widget,20000,true,null);request=await next();
 request.reject(Object.assign(Error('broken'),{code:'WIDGET_CAPTURE_FAILED'}));
 await assert.rejects(failing,/broken/);assert.equal(posted.length,4,'ordinary failures are not retried');
});
test('a lasso joins an existing capture and releases its document-load wait without starting a second render',async()=>{
 const start=source.indexOf('  async function requestWidgetSnapshot('),end=source.indexOf('  async function handleWidgetMessage(',start),pending=new Map(),posted=[];
 const widget={id:'w',renderActive:true,hostReady:true,initialized:true,contentW:400,contentH:300,contentVersion:0,snapshotVersion:-1,frame:{contentWindow:{postMessage:m=>posted.push(m)}}};
 const context={performance,crypto:{randomUUID:()=> 'capture'},WIDGET_SNAPSHOT_TIMEOUT_MS:1000,widgetSnapshotRequests:pending,location:{origin:'http://local'},setTimeout,clearTimeout,sendWidgetHostState(){},widgetSnapshotAbortError:()=>Error('cancelled'),debug(){},t:x=>x};
 const request=vm.runInNewContext(source.slice(start,end)+';requestWidgetSnapshot',context);
 const first=request(widget,1000,true),lasso=request(widget,1000,true,null,false,false,true);
 assert.deepEqual(posted.map(message=>message.type),['penecho-widget-snapshot-request','penecho-widget-snapshot-current-frame']);
 assert.equal(widget.snapshotCaptureOptions.currentFrame,true);
 const capture=pending.get('capture');assert.equal(capture.currentFrame,true);
 clearTimeout(capture.timer);pending.delete('capture');widget.snapshotImage={width:400,height:300};widget.snapshotVersion=0;capture.resolve(widget.snapshotImage);
 assert.equal(await first,widget.snapshotImage);assert.equal(await lasso,widget.snapshotImage);
 assert.equal(posted.filter(message=>message.type==='penecho-widget-snapshot-request').length,1);
});
