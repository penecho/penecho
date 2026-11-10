'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/client/app/canvas-runtime.js'), 'utf8');
const functions = source.slice(source.indexOf('  let widgetFitRequestSequence'), source.indexOf('  function resizeWidgetBox'));
function harness(mode, interacting = false) {
  const sent = [], widget = {id:'w',x:20,y:30,w:400,h:300,contentW:800,contentH:600,html:'fixture',hostReady:true,frame:{contentWindow:{postMessage:m=>sent.push(m)}}};
  const state = {mode,interactingWidgetId:interacting?'w':null};
  const ctx = {state,SIZE:20000,location:{origin:'http://localhost'},widgetLayout:w=>({...w}),beginWidgetEdit:w=>{state.widgetEdit={id:w.id};},positionWidget(){},sendWidgetHostState(){},refreshHandObjectToolbar(){},requestInteractionLayerRender(){}};
  vm.createContext(ctx);vm.runInContext(functions,ctx);
  return {ctx,widget,sent};
}
for (const mode of ['hand','select']) for (const hit of ['width','height','resize']) test(`${mode} ${hit} fits only requested axes and preserves typography scale`,()=>{
  const {ctx,widget,sent}=harness(mode,true);
  assert.equal(ctx.requestWidgetContentFit(widget,hit),true);
  assert.equal(ctx.applyWidgetContentFit(widget,{requestId:sent[0].requestId,width:1200,height:1800}),true);
  assert.equal(widget.w,hit==='height'?400:600); assert.equal(widget.h,hit==='width'?300:900);
  assert.equal(widget.w/widget.contentW,.5); assert.equal(widget.h/widget.contentH,.5);
});
test('late fit cannot overwrite a subsequent resize',()=>{
 const {ctx,widget,sent}=harness('hand');ctx.requestWidgetContentFit(widget,'height');widget.h+=20;
 assert.equal(ctx.applyWidgetContentFit(widget,{requestId:sent[0].requestId,width:1200,height:1800}),false);assert.equal(widget.h,320);
});
test('fit never shrinks content and combining axes retains both',()=>{
 const {ctx,widget,sent}=harness('hand');widget.fitContentAxes='width';ctx.requestWidgetContentFit(widget,'height');
 ctx.applyWidgetContentFit(widget,{requestId:sent[0].requestId,width:100,height:100});assert.equal(widget.h,300);assert.equal(widget.fitContentAxes,'resize');
});
