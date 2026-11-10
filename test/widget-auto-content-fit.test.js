"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../src/client/app/canvas-runtime.js"), "utf8"),
  functions = source.slice(source.indexOf("  let widgetFitRequestSequence"), source.indexOf("  function resizeWidgetBox"));
function harness() {
  const sent = [], widget = {id:"widget-1",x:20,y:30,w:400,h:300,contentW:800,contentH:600,html:"fixture",hostReady:true,
    frame:{contentWindow:{postMessage:message=>sent.push(message)}}},
    snapshot = {id:widget.id,x:20,y:30,w:400,h:300,contentW:800,contentH:600,html:widget.html},
    entry = {widgetsBefore:[],widgetsAfter:[snapshot]},
    state = {mode:"pen",widgets:[widget],history:[entry],future:[],userRevision:1},
    context = {state,SIZE:20000,MAX_WIDGET_CONTENT_DIMENSION:20000,location:{origin:"http://localhost"},window:{},
      widgetLayout:item=>({...item}),positionWidget(){},sendWidgetHostState(){},refreshHandObjectToolbar(){},requestInteractionLayerRender(){},requestRender(){},canvasAgentSyncState(){}};
  vm.createContext(context);vm.runInContext(functions,context);
  widget.autoContentHeight = {start:context.widgetLayout(widget),html:widget.html,historyEntry:entry,documentReady:false};
  return {context,widget,sent,state,entry,snapshot,
    ready(){widget.mcpDocumentLoaded=true;widget.autoContentHeight.documentReady=true;return context.requestWidgetAutomaticContentFit(widget);},
    fit(height){return context.applyWidgetContentFit(widget,{requestId:sent.at(-1).requestId,width:800,height});}};
}
test("automatic height waits for document load and renderer readiness in either order, and runs once in pen mode",()=>{
  for (const rendererFirst of [true,false]) {
    const h=harness();
    assert.equal(h.context.requestWidgetAutomaticContentFit(h.widget),false);
    if(rendererFirst)h.widget.autoContentHeight.documentReady=true;else h.widget.mcpDocumentLoaded=true;
    assert.equal(h.context.requestWidgetAutomaticContentFit(h.widget),false);
    h.ready();assert.equal(h.sent.length,1);assert.equal(h.sent[0].automatic,true);assert.equal(h.sent[0].hit,"height");
    assert.equal(h.context.requestWidgetAutomaticContentFit(h.widget),false);
  }
});
test("host scenes keep their initial viewport instead of persisting flow-based automatic height",()=>{
  const h=harness();h.widget.sourceFormat="penecho-scene+json";
  assert.equal(h.ready(),false);assert.equal(h.sent.length,0);assert.equal(h.widget.autoContentHeight,null);
  assert.equal(h.widget.contentH,600);assert.equal(h.widget.h,300);assert.equal(h.widget.fitContentAxes,undefined);
  assert.equal(h.state.userRevision,1);assert.equal(h.snapshot.contentH,600);
});
for(const height of [120,600,900,1199])test(`automatic height ${height} fits complete content and preserves width and typography scale`,()=>{
  const h=harness();h.ready();assert.equal(h.fit(height),true);
  assert.equal(h.widget.contentH,height);assert.equal(h.widget.h,height/2);
  assert.equal(h.widget.contentW,800);assert.equal(h.widget.w,400);assert.equal(h.widget.fitContentAxes,"height");
  assert.equal(h.snapshot.contentH,height);assert.equal(h.snapshot.h,height/2);
  assert.equal(h.state.history.length,1);assert.equal(h.state.userRevision,2);assert.equal(h.state.widgetEdit,undefined);
});
for(const height of [1200,1201,3000])test(`automatic height ${height} retains scrolling at or above twice the initial height`,()=>{
  const h=harness();h.ready();assert.equal(h.fit(height),false);
  assert.equal(h.widget.h,300);assert.equal(h.widget.contentH,600);assert.equal(h.widget.fitContentAxes,undefined);
  assert.equal(h.state.userRevision,1);
});
test("the threshold uses the viewport's default height even when the requested Widget is smaller",()=>{
  const h=harness();h.widget.autoContentHeight.defaultContentHeight=800;
  h.ready();assert.equal(h.fit(1500),true);assert.equal(h.widget.contentH,1500);
});
test("late automatic height preserves subsequent object actions and their Undo/Redo snapshots",()=>{
  const h=harness(),other={id:"widget-2",html:"unrelated",h:500};
  const subsequent={widgetsBefore:[{...h.snapshot}],widgetsAfter:[{...h.snapshot},other]};
  h.state.history.push(subsequent);h.state.widgetHistoryBefore=[{...h.snapshot},other];
  h.state.widgetEdit={id:"widget-2",changed:true,before:{h:500}};
  h.ready();assert.equal(h.fit(900),true);
  for(const item of [h.snapshot,subsequent.widgetsBefore[0],subsequent.widgetsAfter[0],h.state.widgetHistoryBefore[0]])assert.equal(item.contentH,900);
  assert.equal(other.h,500);assert.equal(h.state.widgetEdit.changed,true);assert.equal(h.state.history.length,2);
});
for(const change of ["resize","move","source","fit-axis","undo","maximized","canvas-edge","snapshot-edit"])test(`automatic height cannot overwrite ${change}`,()=>{
  const h=harness();h.ready();
  if(change==="resize")h.widget.h=350;
  if(change==="move")h.widget.x=40;
  if(change==="source")h.widget.html="new source";
  if(change==="fit-axis")h.widget.fitContentAxes="width";
  if(change==="undo")h.state.history=[];
  if(change==="maximized")h.widget.maximized=true;
  if(change==="canvas-edge"){h.widget.y=19900;h.widget.contentFitRequest.start.y=19900;h.snapshot.y=19900;}
  if(change==="snapshot-edit")h.snapshot.h=350;
  const before={h:h.widget.h,contentH:h.widget.contentH,html:h.widget.html};
  assert.equal(h.fit(900),false);assert.equal(h.widget.h,before.h);assert.equal(h.widget.contentH,before.contentH);assert.equal(h.widget.html,before.html);
});
test("automatic height restores a short fitted Widget through the canonical validator",()=>{
  const record=source.slice(source.indexOf("  function widgetRecord("),source.indexOf("  function restoreWidgets("));
  const context={state:{nextWidgetId:1},window:{},SIZE:20000,MAX_WIDGET_CONTENT_DIMENSION:20000,MAX_WIDGET_HTML_LENGTH:10000,
    MAX_WIDGET_COPY_TEXT_LENGTH:10000,PRIVATE_WIDGET_FAVORITE_ID:/^none$/,n:(value,min=0,max=20000)=>Number.isFinite(value)&&value>=min&&value<=max,
    diagramRuntime:()=>null,newPrivateWidgetFavoriteId:()=>"private"};
  vm.createContext(context);vm.runInContext(record,context);
  const item={pluginId:"general",html:"<p>Short content</p>",title:"Short",x:0,y:0,w:800,h:120,contentW:800,contentH:120,refreshSeconds:0};
  assert.equal(context.widgetRecord(item),null);
  assert.equal(context.widgetRecord({...item,fitContentAxes:"height"}).contentH,120);
});
test("automatic host measurement excludes the root viewport floor and restores authored scroll layout",async()=>{
  const host=fs.readFileSync(require.resolve("../public/widget-host.js"),"utf8"),
    fit=host.slice(host.indexOf("    async function fitWidgetContent("),host.indexOf("    let presentationScrollStyle"));
  const sent=[],layouts=[],body={offsetHeight:120,scrollHeight:120,getBoundingClientRect:()=>({bottom:120}),querySelectorAll:()=>[{getBoundingClientRect:()=>({right:400,bottom:120})}]},
    context={widgetState:{fitContentAxes:null},scrollX:0,scrollY:0,setTimeout,clearTimeout,
      document:{body,documentElement:{clientWidth:800,scrollWidth:800,clientHeight:600,scrollHeight:600,offsetHeight:120,getBoundingClientRect:()=>({bottom:120})},fonts:{ready:Promise.resolve()}},
      setFitContentLayout:(...args)=>layouts.push(args),parent:{postMessage:message=>sent.push(message)}};
  vm.createContext(context);vm.runInContext(fit,context);
  await context.fitWidgetContent({requestId:"auto",hit:"height",automatic:true});
  assert.equal(sent[0].height,120);assert.equal(context.widgetState.fitContentAxes,null);assert.equal(layouts.at(-1)[0],false);
  await context.fitWidgetContent({requestId:"manual",hit:"height",automatic:false});
  assert.equal(sent[1].height,600);assert.equal(context.widgetState.fitContentAxes,"height");
});
test("automatic host height includes the document's trailing margins without reusing a viewport floor",async()=>{
  const host=fs.readFileSync(require.resolve("../public/widget-host.js"),"utf8"),
    fit=host.slice(host.indexOf("    async function fitWidgetContent("),host.indexOf("    let presentationScrollStyle"));
  for(const [bodyBottom,documentBottom,expected] of [[1330.140625,1338.140625,1339],[328,336,336],[323.5,341,341],[320,356,356]]) {
    const sent=[],body={offsetHeight:Math.floor(bodyBottom),scrollHeight:Math.floor(bodyBottom),getBoundingClientRect:()=>({bottom:bodyBottom}),querySelectorAll:()=>[]},
      root={clientWidth:1299,scrollWidth:1299,clientHeight:1039,scrollHeight:2000,offsetHeight:Math.round(documentBottom),getBoundingClientRect:()=>({bottom:documentBottom})},
      context={widgetState:{fitContentAxes:null},scrollX:0,scrollY:0,setTimeout,clearTimeout,
        document:{body,documentElement:root,fonts:{ready:Promise.resolve()}},setFitContentLayout(){},parent:{postMessage:message=>sent.push(message)}};
    vm.createContext(context);vm.runInContext(fit,context);
    await context.fitWidgetContent({requestId:"first",hit:"height",automatic:true});
    assert.equal(sent[0].height,expected);
    root.clientHeight=expected;root.scrollHeight=expected;
    await context.fitWidgetContent({requestId:"repeat",hit:"height",automatic:true});
    assert.equal(sent[1].height,expected,"a new viewport does not add height again");
    assert.equal(context.widgetState.fitContentAxes,null,"measurement restores the previous layout state");
  }
});
test("settled automatic height is not requested again during maximize or viewport changes",()=>{
  const h=harness();h.ready();assert.equal(h.fit(900),true);
  for(const maximized of [true,false,true,false]) {
    h.widget.maximized=maximized;
    assert.equal(h.context.requestWidgetAutomaticContentFit(h.widget),false);
  }
  assert.equal(h.sent.length,1);assert.equal(h.widget.contentH,900);
});
