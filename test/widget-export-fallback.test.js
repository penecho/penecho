'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/persistence.js'),'utf8');
const start=source.indexOf('  async function renderExportCanvas('),end=source.indexOf('  function exportFilename(',start);
test('image export reuses available pixels after capture failure, but never silently drops a missing Widget',async()=>{
 for(const mode of ["available","missing","stale"]){
  const available=mode==="available";let drawn=false;const error=Error('snapshot timeout'),context={fillRect(){},save(){},setTransform(){},restore(){}},canvas={getContext:()=>context};
  const env={exportRegion:()=>({x:0,y:0,w:400,h:400}),prepareVisibleWidgetSnapshots:async()=>{throw error;},capturableWidgets:()=>[{snapshotImage:mode==="missing"?null:{},snapshotVersion:mode==="stale"?0:1,contentVersion:1}],debug(){},CANVAS_DOWNLOAD_RESOLUTION_SCALE:1,EXPORT_MAX_DIMENSION:2048,EXPORT_MAX_PIXELS:4194304,offscreen:()=>canvas,performance,state:{paint:{paper:'#fff'}},drawAnimationsToContext(){},drawWidgetsAndImagesToContext(){drawn=true;},drawTextBoxesToContext(){},tiles:new Map(),drawSharpOverlays(){}};
  const run=vm.runInNewContext(source.slice(start,end)+';renderExportCanvas',env);
  if(available){assert.equal(await run(),canvas);assert.equal(drawn,true);}
  else {await assert.rejects(run(),e=>e===error);assert.equal(drawn,false);}
 }
});
