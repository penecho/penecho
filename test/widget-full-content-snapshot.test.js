'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const host=fs.readFileSync('public/widget-host.js','utf8'),client=fs.readFileSync('src/client/app/canvas-runtime.js','utf8');
const captureSource=host.slice(host.indexOf('    async function snapshotDocument('),host.indexOf('    // Compatibility for canvases saved'));
for(const fullContent of [false,true])test(`snapshot fullContent=${fullContent} respects document extent independently of presentation zoom`,async()=>{
 for(const scaleX of [.5,1]){
 const messages=[],sizes=[];
 const context={clock:()=>0,widgetState:{maximized:true,scaleX},document:{documentElement:{clientWidth:800,clientHeight:400,scrollWidth:800,scrollHeight:1400},body:{scrollWidth:800,scrollHeight:1400}},
 HIGH_RESOLUTION_SNAPSHOT_SCALE:1.5,MAX_HIGH_RESOLUTION_SNAPSHOT_DIMENSION:3600,MAX_HIGH_RESOLUTION_SNAPSHOT_PIXELS:10800000,MAX_SNAPSHOT_DIMENSION:2400,MAX_SNAPSHOT_PIXELS:4800000,
 snapshotDebugLog(){},mcpPreviewMode:true,waitForSnapshotViewport:async()=>{},settleSnapshotFrame:async()=>true,
 inlineSvgComputedStyles:()=>()=>{},inlineSnapshotCompatibleColors:()=>()=>{},schedulePresentationSize(){},
 snapshotPrimarySvg:async(w,h,scale)=>{sizes.push([w,h]);return {width:Math.floor(w*scale),height:Math.floor(h*scale),toDataURL:()=> 'data:image/png;base64,new'};},
 withTimeout:async p=>p,parent:{postMessage:m=>messages.push(m)},runtimeVersion:1,activeSnapshotRender:null};
 vm.createContext(context);vm.runInContext(captureSource,context);
 await context.snapshotDocument({requestId:'test',width:800,height:400,highResolution:true,fullContent});
 assert.equal(messages[0].type,'penecho-widget-snapshot');
 assert.deepEqual(sizes,[[800,fullContent?1400:400]]);
 assert.equal(messages[0].height,fullContent?2100:600);
 assert.equal(messages[0].contentHeight,fullContent?1400:400);
 }
});
test('full content response leaves every preview cache field intact',async()=>{
 const start=client.indexOf('    try {\n      const snapshotImage=await decodeWidgetSnapshot');
 const end=client.indexOf('\n  function selectedWidget()',start);
 const code=client.slice(start,end).replace(/\n  }\s*$/,'');
 const oldImage={},image={},widget={snapshotImage:oldImage,snapshotDataUrl:'old',snapshotVersion:4,snapshotHighResolution:false,contentVersion:5};
 let result;
 const context={widget,message:{dataUrl:'data:image/png;base64,new'},pending:{fullContent:true,contentVersion:5,resolve:r=>result=r,reject:e=>{throw e;}},finishPending:()=>true,decodeWidgetSnapshot:async()=>image};
 vm.createContext(context);await vm.runInContext(`(async()=>{${code}})()`,context);
 assert.equal(result.image,image);assert.equal(result.dataUrl,'data:image/png;base64,new');
 assert.equal(widget.snapshotImage,oldImage);assert.equal(widget.snapshotDataUrl,'old');assert.equal(widget.snapshotVersion,4);assert.equal(widget.snapshotHighResolution,false);
});
test('download requests complete content and uses its returned PNG instead of cached preview',async()=>{
 const start=client.indexOf('  async function downloadWidgetImage('),end=client.indexOf('  function widgetEditContext(',start);
 const link={click(){},remove(){}},calls=[],widget={snapshotDataUrl:'data:image/png;base64,old'};
 const context={syncObjectChrome(){},setStatusKey(){},setStatus(){},t:x=>x,WIDGET_SNAPSHOT_TIMEOUT_MS:18000,
 requestWidgetSnapshot:async(...args)=>{calls.push(args);return {dataUrl:'data:image/png;base64,full'};},document:{createElement:()=>link,body:{append(){}}},widgetImageFilename:()=> 'widget.png'};
 vm.createContext(context);vm.runInContext(client.slice(start,end),context);
 assert.equal(await context.downloadWidgetImage(widget),true);assert.equal(calls[0][5],true);assert.equal(link.href,'data:image/png;base64,full');assert.equal(widget.downloadBusy,false);
});
