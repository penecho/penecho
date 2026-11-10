"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ai = fs.readFileSync(path.join(__dirname,"../src/client/app/ai-runtime.js"),"utf8"), assist = fs.readFileSync(path.join(__dirname,"../src/client/app/smart-suggestions.js"),"utf8");
function fn(source,name) {
  const start=source.indexOf(`  function ${name}(`),next=source.indexOf("\n  function ",start+1),asyncNext=source.indexOf("\n  async function ",start+1);
  assert.ok(start>=0);
  return source.slice(start,Math.min(...[next,asyncNext].filter(index=>index>=0))).trimEnd()+"\n";
}
function intersection(a,b) {
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),w=Math.min(a.x+a.w,b.x+b.w)-x,h=Math.min(a.y+a.h,b.y+b.h)-y;
  return w>0&&h>0?{x,y,w,h}:null;
}
const union=vm.runInNewContext(`(${fn(assist,"assistUnion")})`);
const plain=value=>JSON.parse(JSON.stringify(value));
const canvas = fs.readFileSync(path.join(__dirname,"../src/client/app/canvas-runtime.js"),"utf8");
const inside = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

test("every Widget Refine includes its source and all dirty input, including offscreen content",()=>{
  const widget={id:"target",x:550,y:500,w:360,h:300,widgetType:"html_widget",pluginId:"general",title:"Target",html:"<p>Complete source</p>",refreshSeconds:0},
    target={x:550,y:500,w:360,h:300},visible={x:0,y:0,w:1440,h:1100},calls=[],
    state={mode:"pen",widgets:[widget],scale:1,lastUserBox:{x:10,y:10,w:20,h:20}},
    context={state,assistAgent:{},window:{PENECHO_SMART_SUGGEST:require('../public/smart-suggest.js')},debug(){},viewportRect:()=>visible,intersection,unionLocalBounds:union,widgetBox:({x,y,w,h})=>({x,y,w,h}),
      activeWidgetRefinement:()=>false,clearTimeout(){},clearWidgetRefineCandidate(){},supersedeActiveAI(){},setStatusKey(){},
      widgetUsesHtmlCopySource:()=>false,VISUAL_EXPLAINER_SOURCE_FORMAT:"visual-explainer",requestAI:(...args)=>calls.push(args)};
  context.widgetEditContext=vm.runInNewContext(`(${fn(canvas,"widgetEditContext")})`,context);
  const request=vm.runInNewContext(`(${canvas.match(/  function requestWidgetRefinement\([^]*?\n  \}/)[0]})`,context);
  for(const mode of ["nearby-dirty","viewport-dirty","implicit-polish","action","ask"]) {
    for(const dirty of [null,{x:930,y:606,w:118,h:48},{x:100,y:100,w:120,h:50},{x:2000,y:100,w:200,h:50}]) {
      state.dirty=dirty;
      assert.equal(request(widget,mode,{instruction:"Larger text",actionId:"larger_text"}),true);
      const options=calls.at(-1)[2],input=dirty;
      assert.deepEqual(plain(options.attentionBox),input||target);
      assert.ok(inside(options.captureRegion,target));
      assert.ok(inside(options.thinkingBox,target));
      if(input) assert.ok(inside(options.captureRegion,input)&&inside(options.thinkingBox,input));
      else assert.deepEqual(plain(options.thinkingBox),target,"without dirty input the Widget anchors the scan");
      assert.ok(!inside(options.captureRegion,visible),"unrelated viewport content cannot widen the crop");
      assert.equal(options.widgetEditContext.html,widget.html);
      assert.equal(options.widgetEditContext.instructionMode,dirty?"canvas-dirty":mode);
      assert.equal(options.captureWholeInput,Boolean(dirty));
      assert.equal(options.widgetEditContext.instruction,"Larger text");
      assert.equal(state.dirty,dirty,"preparation preserves user dirty state");
    }
  }
});

test("Refine capture stays local at viewport edges and on fallback, even with distant canvas content",()=>{
  const visible={x:100,y:80,w:1000,h:800},region={x:40,y:20,w:600,h:500},target={x:90,y:60,w:400,h:300},
    context={viewportRect:()=>visible,captureRectFor:()=>visible,visibleInkBounds:()=>visible,widgetBounds:()=>visible,
      imageBounds:()=>null,textBoxBounds:()=>null,animationBounds:()=>null,unionLocalBounds:union,intersection,state:{scale:2},
      MAX_ATLAS_WIDTH:2048,MAX_ATLAS_HEIGHT:1536,buildViewportImage:()=>{throw Error("capture failed");},debug(){}};
  const plan=vm.runInNewContext(`(${fn(ai,"planViewportImage")})`,context)(target,true,region),
    fallback=vm.runInNewContext(`(${fn(ai,"emergencyViewportImage")})`,context)([],target,region);
  for(const result of [plan,fallback]) {
    assert.deepEqual(plain(result.sourceRect),intersection(region,visible));
    assert.ok(inside(visible,result.captureRect)&&inside(result.captureRect,result.sourceRect));
    assert.deepEqual(plain(result.latestVisible||result.changedBox),intersection(target,visible));
  }
});

test("whole-input Refine capture includes offscreen dirty and keeps valid request geometry on retry",()=>{
  const visible={x:100,y:80,w:1000,h:800},region={x:-56,y:-36,w:6192,h:4692},dirty={x:40,y:60,w:6000,h:4500},
    context={SIZE:20000,viewportRect:()=>visible,captureRectFor:()=>visible,visibleInkBounds:()=>null,widgetBounds:()=>null,
      imageBounds:()=>null,textBoxBounds:()=>null,animationBounds:()=>null,unionLocalBounds:union,intersection,state:{scale:1},
      MAX_ATLAS_WIDTH:2048,MAX_ATLAS_HEIGHT:1536,debug(){}};
  const plan=vm.runInNewContext(`(${fn(ai,"planViewportImage")})`,context)(dirty,true,region,true),
    emergency=vm.runInNewContext(`(${fn(ai,"emergencyViewportImage")})`,context);
  assert.deepEqual(plain(plan.sourceRect),{x:0,y:0,w:6136,h:4656});
  assert.deepEqual(plain(plan.latestVisible),dirty);
  assert.ok(inside(plan.visible,plan.captureRect)&&inside(plan.captureRect,plan.sourceRect));
  assert.equal(plan.imageSize.w,Math.ceil(plan.sourceRect.w*plan.imageScale));
  assert.equal(plan.imageSize.h,Math.ceil(plan.sourceRect.h*plan.imageScale));
  assert.ok(plan.imageSize.w<=2048&&plan.imageSize.h<=1536);
  context.buildViewportImage=(_points,_box,_full,retry,_region,whole)=>{assert.equal(whole,true);return retry;};
  const retry=emergency([],dirty,region,true);
  assert.deepEqual(plain(retry.sourceRect),plain(plan.sourceRect));
  assert.ok(inside(retry.visible,retry.captureRect)&&inside(retry.captureRect,retry.sourceRect));
  context.buildViewportImage=()=>{throw Error("capture failed");};
  assert.equal(emergency([],dirty,region,true),null,"missing instructions cannot be replaced with a blank image");
});

test("viewport capture includes widget-only content and never crops its visible bottom to old ink",()=>{
  const visible={x:0,y:0,w:1440,h:1100},widget={x:550,y:500,w:360,h:300};let ink=null;
  const context={viewportRect:()=>visible,captureRectFor:()=>visible,visibleInkBounds:()=>ink,widgetBounds:()=>widget,
    imageBounds:()=>null,textBoxBounds:()=>null,animationBounds:()=>null,unionLocalBounds:union,intersection,state:{scale:1},MAX_ATLAS_WIDTH:2048,MAX_ATLAS_HEIGHT:1536};
  const plan=vm.runInNewContext(`(${fn(ai,"planViewportImage")})`,context);
  for(const input of [widget,{x:100,y:100,w:300,h:40}]) {
    ink=input===widget?null:input;
    const result=plan(input);
    assert.ok(result);
    assert.ok(result.sourceRect.y+result.sourceRect.h>=800);
    assert.deepEqual(plain(result.latestVisible),input);
    assert.equal(result.imageSize.h,Math.ceil(result.sourceRect.h*result.imageScale));
  }
});
test("suggestion crops stay close to the input without importing nearby clean objects",()=>{
  const widget={x:550,y:500,w:360,h:300},distant={x:1500,y:500,w:300,h:300},viewport={x:0,y:0,w:1440,h:1100};
  const context={SIZE:20000,state:{images:[distant],textBoxes:[],animations:[]},viewportRect:()=>viewport,intersection,
    capturableWidgets:()=>[widget],widgetBox:x=>x,imageBox:x=>x,textBoxBox:x=>x,animationBox:x=>x,unionLocalBounds:union};
  context.smartSuggestDirtyBox=vm.runInNewContext(`(${fn(assist,"smartSuggestDirtyBox")})`,context);
  const crop=vm.runInNewContext(`(${fn(assist,"smartSuggestCropRegion")})`,context);
  const region=crop({box:{x:926,y:606,w:118,h:48}});
  assert.deepEqual(plain(region),{x:918,y:598,w:134,h:64});
  assert.equal(intersection(region,widget),null,"an adjacent widget is not the current request");
  assert.ok(region.x+region.w<1500);
  assert.equal(crop({box:{x:2000,y:100,w:100,h:40}}),null);
  const edge=crop({box:{x:2,y:2,w:50,h:30}});
  assert.ok(edge.x>=0&&edge.y>=0);
  const weather={x:170,y:175,w:680,h:165},formula={x:0,y:40,w:410,h:65};
  context.state.textBoxes=[formula];
  const weatherRegion=crop({box:weather});
  assert.ok(inside(weatherRegion,weather));
  assert.equal(intersection(weatherRegion,formula),null,"the old formula above the weather request is excluded");
  for(const flag of ["result","gesture"]) {
    const target={x:2000,y:1800,w:1400,h:1000};
    const result=crop({box:target,[flag]:true});
    assert.deepEqual(plain(result),{x:1992,y:1792,w:1416,h:1016});
    assert.ok(inside(result,target),"explicit targets remain complete outside the viewport");
  }
});
test("committed result geometry expands a follow-up independently of user dirty state",()=>{
  const dirty={x:100,y:100,w:300,h:40},target={box:dirty},state={dirty};
  const context={state,assistUnion:union};
  const options=vm.runInNewContext(`(${fn(assist,"assistRequestOptions")})`,context)(target);
  options.onResultCommitted({x:550,y:500,w:360,h:300});
  options.onResultCommitted({x:560,y:820,w:120,h:80});
  const follow=vm.runInNewContext(`(${fn(assist,"assistFollowUpTarget")})`,context)(target,dirty);
  assert.deepEqual(plain(follow.box),{x:100,y:100,w:810,h:800});
  assert.equal(state.dirty,dirty);
  assert.deepEqual(plain(dirty),{x:100,y:100,w:300,h:40});
});
test("batch commits report the accepted item's actual scaled bounds",()=>{
  const boxes=[],state={activeAI:{onResultCommitted:box=>boxes.push(box)}},context={state,
    blitSized(){},blitClipped(){},addAnimation(){},addPendingPlotImage(){},eraseWithMask(){}};
  context.pendingItemBounds=vm.runInNewContext(`(${fn(ai,"pendingItemBounds")})`);
  const commit=vm.runInNewContext(`(${fn(ai,"commitPendingItem")})`,context);
  commit({x:600,y:700,image:{width:100,height:50},scaleX:2,scaleY:3});
  assert.deepEqual(plain(boxes),[{x:600,y:700,w:200,h:150}]);
});
