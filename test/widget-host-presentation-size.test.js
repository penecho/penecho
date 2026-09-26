"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/widget-host.js'),'utf8');
const start=source.indexOf('    let fitContentStyle = null;');
const end=source.indexOf('    addEventListener("message", (event) => {',start);
function harness(){
 const marks=new Map(),sheets=[],listeners=new Map(),messages=[],frames=[],observers=[];
 const root={scrollWidth:900,clientWidth:900,scrollHeight:2200,clientHeight:1100};
 const body={querySelectorAll:()=>[node]};
 const node={nodeType:1,parentElement:body,closest:()=>null,getAttribute:key=>marks.get(key)??null,setAttribute:(k,v)=>marks.set(k,v),removeAttribute:k=>marks.delete(k),scrollWidth:902,clientWidth:400,offsetWidth:402,scrollHeight:800,clientHeight:400,scrollTop:0};
 class Observer{constructor(cb){this.cb=cb;observers.push(this)}observe(){}disconnect(){this.disconnected=true}}
 const ctx={widgetState:{maximized:true,fitContent:true},activeSnapshot:null,activeSnapshotRender:null,HTMLElement:Object,innerWidth:900,innerHeight:1100,runtimeVersion:2,
  ResizeObserver:Observer,MutationObserver:Observer,nativeRequestAnimationFrame:cb=>frames.push(cb),nativeCancelAnimationFrame:()=>{},
  parent:{postMessage:m=>messages.push(m)},document:{body,documentElement:root,scrollingElement:root,head:{append(){}},createElement:()=>{const sheet={disabled:false,textContent:''};sheets.push(sheet);return sheet}},
  getComputedStyle:()=>({overflowY:'auto',overflowX:'scroll'}),addEventListener:(k,v)=>listeners.set(k,v)};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 return {ctx,marks,sheets,listeners,messages,frames,observers,node,body,root,flush(){frames.splice(0).forEach(cb=>cb())}};
}
test('presentation uses one document scroll owner without changing authored dimensions',()=>{
 const h=harness();h.ctx.setPresentationLayout();h.flush();
 assert.equal(h.marks.size,0);
 assert.equal(h.sheets.length,1);assert.match(h.sheets[0].textContent,/overflow:hidden/);
 assert.doesNotMatch(h.sheets[0].textContent,/[{;](?:min-|max-)?(?:width|height):/);
 assert.equal(h.messages[0].action,'extent');assert.equal(h.messages[0].height,2200);
 h.root.scrollHeight=2800;h.observers[0].cb();h.flush();
 assert.equal(h.messages[1].height,2800);assert.equal(h.ctx.innerHeight,1100);
 h.observers[0].cb();h.flush();assert.equal(h.messages.length,2,'unchanged extent is deduplicated');
 h.ctx.widgetState.maximized=false;h.ctx.setPresentationLayout();
 assert.equal(h.sheets[0].disabled,true);assert.ok(h.observers.every(o=>o.disconnected));
});
test('wheel forwards document scrolling and boundary overflow, preserving active nested scrollers',()=>{
 const h=harness(),wheel=h.listeners.get('wheel');
 const run=(target,extra={})=>{let prevented=false;wheel({target,deltaX:0,deltaY:100,deltaMode:0,preventDefault(){prevented=true},...extra});return prevented};
 assert.equal(run(h.body),true);assert.equal(h.messages.at(-1).dy,100);
 assert.equal(run(h.node),false);h.node.scrollTop=400;assert.equal(run(h.node),true);
 assert.equal(run(h.body,{defaultPrevented:true}),false);
 assert.equal(run(h.body,{ctrlKey:true}),false);
 h.ctx.widgetState.maximized=false;assert.equal(run(h.body),false);
});
test('full-height body scrolling is reported as the page range',()=>{
 const h=harness();h.root.scrollHeight=1100;
 Object.assign(h.body,{scrollWidth:900,clientWidth:900,scrollHeight:2400,clientHeight:1100});
 h.ctx.setPresentationLayout();h.flush();assert.equal(h.messages[0].height,2400);
 assert.equal(h.ctx.presentationDocumentScroller(),h.body);
});
for(const axis of ['width','height','resize'])test(`legacy Canvas Fit ${axis} is restored only outside presentation`,()=>{
 const h=harness();h.ctx.widgetState={maximized:false,fitContentAxes:axis};h.ctx.setPresentationLayout();
 const fit=h.sheets[0];assert.equal(fit.textContent.includes('height:auto!important'),axis!=='width');
 assert.equal(fit.textContent.includes('min-width:904px!important'),axis!=='height');
 h.ctx.widgetState.maximized=true;h.ctx.setPresentationLayout();assert.equal(fit.disabled,true);assert.equal(h.marks.size,0);
 h.ctx.widgetState.maximized=false;h.ctx.setPresentationLayout();assert.equal(fit.disabled,false);
});
