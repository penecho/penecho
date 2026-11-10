'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/client/app/persistence.js'),'utf8');
const canvas=fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-runtime.js'),'utf8');
const start=source.indexOf('  async function renderExportCanvas('),end=source.indexOf('  function exportFilename(',start);
const fresh=canvas.slice(canvas.indexOf('  function widgetSnapshotFresh('),canvas.indexOf('  function widgetSnapshotDeadlineError('));
const preparation=canvas.slice(canvas.indexOf('  function selectionPathIntersectsBox('),canvas.indexOf('\n  function animationBox('));
const SELECT=require('../public/selection.js');
const intersection=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),r=Math.min(a.x+a.w,b.x+b.w),bt=Math.min(a.y+a.h,b.y+b.h);return r>x&&bt>y?{x,y,w:r-x,h:bt-y}:null;};
function harness(widgets,request){
  let drawn=false;const ctx={fillRect(){},save(){},setTransform(){},restore(){},clip(){}},out={getContext:()=>ctx},requested=[];
  const env={exportRegion:()=>({x:0,y:0,w:400,h:400}),capturableWidgets:region=>widgets.filter(widget=>!region||intersection(widget,region)),widgetBox:widget=>({x:widget.x,y:widget.y,w:widget.w,h:widget.h}),intersection,SELECT,
    requestWidgetSnapshot:async(widget,...args)=>{requested.push(widget.id);return request(widget,...args);},widgetSnapshotAbortError:()=>Error('aborted'),widgetSnapshotDeadlineError:()=>Error('deadline'),t:x=>x,
    WIDGET_SNAPSHOT_TIMEOUT_MS:20000,WIDGET_HISTORY_SNAPSHOT_WAIT_MS:3000,WIDGET_SNAPSHOT_CONCURRENCY:2,performance,
    debug(){},CANVAS_DOWNLOAD_RESOLUTION_SCALE:1,EXPORT_MAX_DIMENSION:2048,EXPORT_MAX_PIXELS:4194304,offscreen:()=>out,state:{paint:{paper:'#fff'}},
    drawAnimationsToContext(){},drawWidgetsToContext(){drawn=true;},drawImagesToContext(){},drawTextBoxesToContext(){},tiles:new Map(),drawSharpOverlays(){},
    traceSelectionPath(){},selectionPathFor:selection=>selection.path};
  vm.createContext(env);vm.runInContext(fresh+preparation+source.slice(start,end),env);
  return {run:(...args)=>env.renderExportCanvas(...args),requested,drawn:()=>drawn,out};
}
test('image export reuses same-version pixels after capture failure, but never silently drops a missing or outdated Widget',async()=>{
  for(const mode of ["available","missing","stale"]){
    const widget={id:'w',x:0,y:0,w:200,h:200,snapshotImage:mode==="missing"?null:{},snapshotVersion:mode==="stale"?0:1,contentVersion:1};
    const h=harness([widget],async()=>{throw Object.assign(Error('snapshot timeout'),{code:'WIDGET_CAPTURE_FAILED'});});
    if(mode==="available"){assert.equal(await h.run(),h.out);assert.equal(h.drawn(),true);}
    else {await assert.rejects(h.run(),error=>error.message==='snapshot timeout'&&error.details.widgetIds[0]==='w');assert.equal(h.drawn(),false);}
  }
});
test('a lasso download captures only Widgets the lasso itself touches',async()=>{
  const inside={id:'inside',x:20,y:20,w:60,h:60,contentVersion:0,snapshotVersion:-1},outside={id:'corner',x:330,y:330,w:60,h:60,contentVersion:0,snapshotVersion:-1};
  const h=harness([inside,outside],async widget=>{if(widget.id==='corner')throw Error('broken corner widget');widget.snapshotImage={};widget.snapshotVersion=widget.contentVersion;return widget.snapshotImage;});
  // A triangle whose bounding box contains both Widgets, while its area only reaches the first.
  const selection={box:{x:0,y:0,w:400,h:400},path:[{x:0,y:0},{x:400,y:0},{x:0,y:400}]};
  assert.equal(await h.run(selection,()=>{}),h.out);
  assert.deepEqual(h.requested,['inside']);
});
test('lasso download never substitutes an old cached image after a failed current-frame capture',async()=>{
  const widget={id:'w',x:0,y:0,w:200,h:200,contentVersion:1,snapshotVersion:1,snapshotImage:{old:true}};
  const h=harness([widget],async(_widget,_timeout,_fresh,_signal,highResolution,fullContent,currentFrame)=>{
    assert.equal(highResolution,true);assert.equal(fullContent,false);assert.equal(currentFrame,true);
    throw Object.assign(Error('renderer failed'),{code:'WIDGET_CAPTURE_FAILED'});
  });
  await assert.rejects(h.run({box:{x:0,y:0,w:200,h:200},path:[{x:0,y:0},{x:200,y:0},{x:0,y:200}]}),/renderer failed/);
  assert.equal(h.drawn(),false);
});
