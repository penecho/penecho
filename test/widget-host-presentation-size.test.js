'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/widget-host.js'),'utf8');
const parentSource=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/canvas-runtime.js'),'utf8');
const applyPresentationSize=vm.runInNewContext(parentSource.slice(parentSource.indexOf('  function applyWidgetPresentationSize('),parentSource.indexOf('  async function handleWidgetMessage('))+';applyWidgetPresentationSize',{sendWidgetHostState(){}});
const start=source.indexOf('    // One presentation owner:');
const end=source.indexOf('    addEventListener("message", (event) => {',start);
function harness(){
 const frames=new Map(),messages=[],layouts=[],observers=[],mutations=[],listeners=new Map();let id=0;
 const body={scrollWidth:720,getBoundingClientRect:()=>({right:640,bottom:900}),querySelectorAll:()=>[{getBoundingClientRect:()=>({right:720,bottom:1200})}]};
 const ctx={widgetState:{maximized:true,fitContent:false},document:{body},innerWidth:1024,innerHeight:900,scrollX:0,scrollY:0,getComputedStyle:()=>({marginBottom:'0px'}),activeSnapshot:null,activeSnapshotRender:null,runtimeVersion:7,fitContentStyle:null,
 nativeRequestAnimationFrame:fn=>{frames.set(++id,fn);return id;},nativeCancelAnimationFrame:id=>frames.delete(id),setFitContentLayout:(...args)=>layouts.push(args),addEventListener:(type,listener)=>listeners.set(type,listener),parent:{postMessage:m=>messages.push(m)},
 ResizeObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}},
 MutationObserver:class{constructor(callback){this.callback=callback;mutations.push(this);}observe(){}disconnect(){this.disconnected=true;}}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 const widget={maximized:true,contentW:ctx.innerWidth,contentH:ctx.innerHeight,styleRule:{style:{setProperty(){}}}};
 return {ctx,frames,messages,layouts,observers,mutations,listeners,body,widget,emit(type){listeners.get(type)?.();},flush(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());},applyReport(){
  if(!applyPresentationSize(widget,messages.at(-1)))return;
  const changed=ctx.innerWidth!==widget.presentationWidth||ctx.innerHeight!==widget.presentationHeight;
  ctx.innerWidth=widget.presentationWidth;ctx.innerHeight=widget.presentationHeight;
  if(changed)listeners.get('resize')?.();
 }};
}
function stylesheetHarness(){
 let textContent='';
 const sheet={disabled:false,cssRules:[]};
 Object.defineProperty(sheet,'textContent',{
  get(){return textContent;},
  set(value){
   textContent=value;
   sheet.cssRules=value.split('}').flatMap(block=>{
    const brace=block.indexOf('{');
    if(brace<0)return[];
    const selectorText=block.slice(0,brace).trim();
    const declarations=block.slice(brace+1).split(';').flatMap(declaration=>{
     const colon=declaration.indexOf(':');
     if(colon<0)return[];
     const property=declaration.slice(0,colon).trim();
     const value=declaration.slice(colon+1).trim();
     return property&&value?[{property,value}]:[];
    });
    return selectorText&&declarations.length?[{selectorText,declarations}]:[];
   });
  },
 });
 return sheet;
}
function stylesheetDeclarations(sheet,selector){
 return sheet.cssRules.filter(rule=>rule.selectorText===selector).flatMap(rule=>rule.declarations);
}
function stylesheetValues(sheet,selector,property){
 return stylesheetDeclarations(sheet,selector).filter(declaration=>declaration.property===property).map(declaration=>declaration.value);
}
function stylesheetValue(sheet,selector,property){
 return stylesheetValues(sheet,selector,property).at(-1);
}
test('host presentation measures natural overflow, coalesces and deduplicates reports',()=>{
 const h=harness();h.ctx.setPresentationLayout();h.ctx.schedulePresentationSize();assert.equal(h.frames.size,1);h.flush();
 assert.equal(h.messages.length,1);assert.equal(h.messages[0].width,720);assert.equal(h.messages[0].height,1200);
 h.observers[0].callback();h.flush();assert.equal(h.messages.length,1);assert.equal(h.layouts.length,1);
 h.ctx.setPresentationLayout(false);assert.equal(h.frames.size,0);
});
test('host presentation cancels observers and frames on exit, preserving legacy fit preference',()=>{
 const h=harness();h.ctx.setPresentationLayout();assert.equal(h.observers[0].node,h.body);
 h.ctx.widgetState={maximized:false,fitContent:true};h.ctx.setPresentationLayout();assert.equal(h.frames.size,0);
 assert.equal(h.observers[0].disconnected,true);assert.equal(h.mutations[0].disconnected,true);assert.equal(h.layouts.at(-1)[0],true);
});
test('host presentation defers snapshot geometry and ignores its own marker mutations',()=>{
 const h=harness();h.ctx.activeSnapshot={};h.ctx.setPresentationLayout();h.flush();assert.equal(h.messages.length,0);
 h.ctx.activeSnapshot=null;h.mutations[0].callback([{target:{},attributeName:'data-penecho-fit-scroll'}]);assert.equal(h.frames.size,0);
 h.mutations[0].callback([{target:{},attributeName:'class'}]);h.flush();assert.equal(h.messages.length,1);
});
test('host presentation caps dimensions before sending',()=>{
 const h=harness();h.body.scrollWidth=900000;h.body.getBoundingClientRect=()=>({right:900000,bottom:900000});
 h.ctx.setPresentationLayout();h.flush();assert.equal(h.messages[0].width,100000);assert.equal(h.messages[0].height,100000);
});
test('fit layout assigns one root scroll owner, expands ordinary containers, and restores authored state',()=>{
 class Element {
  constructor(style,excluded=false){this.authored=style;this.excluded=excluded;this.children=[{}];this.attributes=new Map();this.scrollWidth=500;this.clientWidth=500;this.offsetWidth=500;}
  closest(){return this.excluded?this:null;}
  getAttribute(key){return this.attributes.get(key)??null;}
  setAttribute(key,value){this.attributes.set(key,value);}
  removeAttribute(key){this.attributes.delete(key);}
 }
 const viewport=new Element({height:'450px',minHeight:'0px',overflowY:'visible',overflowX:'visible'});
 const minimum=new Element({height:'650px',minHeight:'450px',overflowY:'visible',overflowX:'visible'});
 const scroller=new Element({height:'320px',minHeight:'0px',overflowY:'auto',overflowX:'scroll'});
 scroller.scrollWidth=900;scroller.clientWidth=400;scroller.offsetWidth=402;
 const control=new Element({height:'450px',minHeight:'450px',overflowY:'auto',overflowX:'auto'},true);
 const architectureMap=new Element({height:'320px',minHeight:'0px',overflowY:'auto',overflowX:'auto'});
 architectureMap.scrollWidth=1200;architectureMap.clientWidth=400;
 architectureMap.closest=selector=>selector.split(', ').includes('[data-penecho-architecture] .pa-map')?architectureMap:null;
 viewport.setAttribute('data-penecho-fit-scroll','authored-root');
 scroller.setAttribute('data-penecho-fit-scroll','authored-scroller');
 const sequenceMap=new Element({height:'320px',minHeight:'0px',overflowY:'auto',overflowX:'auto'});
 sequenceMap.scrollWidth=980;sequenceMap.clientWidth=400;
 sequenceMap.closest=selector=>selector.split(', ').includes('[data-penecho-sequence] .pa-map')?sequenceMap:null;
 const workflowMap=new Element({height:'320px',minHeight:'0px',overflowY:'auto',overflowX:'auto'});
 workflowMap.scrollWidth=1000;workflowMap.clientWidth=400;
 workflowMap.closest=selector=>selector.split(', ').includes('[data-penecho-workflow] .pa-map')?workflowMap:null;
 const nodes=[viewport,minimum,scroller,control,architectureMap,sequenceMap,workflowMap],sheet=stylesheetHarness();
 const authoredStyles=nodes.map(element=>({...element.authored}));
 const ctx={widgetState:{maximized:true},innerHeight:450,HTMLElement:Element,getComputedStyle:element=>element.authored,
  document:{body:{querySelectorAll:()=>nodes},head:{append(){}},createElement:()=>sheet}};
 vm.createContext(ctx);
 const begin=source.indexOf('    let fitContentStyle = null;');
 vm.runInContext(source.slice(begin,start),ctx);
 ctx.setFitContentLayout(true,true);
 assert.equal(sheet.disabled,false);
 assert.deepEqual(stylesheetValues(sheet,'html,body','overflow'),['hidden!important','clip!important']);
 assert.equal(stylesheetValue(sheet,'html,body','overflow'),'clip!important');
 assert.equal(stylesheetValue(sheet,'html,body','overscroll-behavior'),'auto!important');
 const scrollerSelector='[data-penecho-fit-scroll="2"]';
 assert.equal(scroller.getAttribute('data-penecho-fit-scroll'),'2');
 assert.equal(stylesheetValue(sheet,scrollerSelector,'height'),'auto!important');
 assert.equal(stylesheetValue(sheet,scrollerSelector,'min-height'),'0!important');
 assert.equal(stylesheetValue(sheet,scrollerSelector,'overflow-y'),'visible!important');
 assert.equal(stylesheetValue(sheet,scrollerSelector,'max-width'),'none!important');
 assert.equal(stylesheetValue(sheet,scrollerSelector,'overflow-x'),'visible!important');
 assert.equal(stylesheetValue(sheet,scrollerSelector,'min-width'),'902px!important');
 assert.equal(control.getAttribute('data-penecho-fit-scroll'),null);
 assert.equal(architectureMap.getAttribute('data-penecho-fit-scroll'),null,'architecture retains its own width-aware map scroller');
 assert.equal(sequenceMap.getAttribute('data-penecho-fit-scroll'),null,'sequence retains participant-column scrolling');
 assert.equal(workflowMap.getAttribute('data-penecho-fit-scroll'),null,'workflow owns its map reflow without expanding the whole page');
 ctx.widgetState={maximized:false,fitContent:true};ctx.setFitContentLayout(true,true);
 assert.equal(sheet.disabled,false);
 assert.equal(stylesheetValue(sheet,'html,body','overflow-y'),'visible!important');
 assert.equal(stylesheetValue(sheet,'html,body','overflow-x'),'visible!important');
 assert.equal(stylesheetValue(sheet,'html,body','overflow'),undefined);
 ctx.widgetState={maximized:false,fitContent:false};ctx.setFitContentLayout(false);
 assert.equal(sheet.disabled,true);
 assert.equal(viewport.getAttribute('data-penecho-fit-scroll'),'authored-root');
 assert.equal(minimum.getAttribute('data-penecho-fit-scroll'),null);
 assert.equal(scroller.getAttribute('data-penecho-fit-scroll'),'authored-scroller');
 assert.equal(control.getAttribute('data-penecho-fit-scroll'),null);
 nodes.forEach((element,index)=>assert.deepEqual(element.authored,authoredStyles[index]));
});
for(const axis of ['width','height','resize']) test(`content fit expands ${axis} scrolling without rewriting authored styles`,()=>{
 class Element {
  constructor(){this.children=[];this.attributes=new Map();this.scrollWidth=900;this.clientWidth=400;this.offsetWidth=402;}
  closest(){return null;} getAttribute(k){return this.attributes.get(k)??null;} setAttribute(k,v){this.attributes.set(k,v);} removeAttribute(k){this.attributes.delete(k);}
 }
 const node=new Element(),sheet={disabled:false,textContent:''};
 const ctx={widgetState:{maximized:false,fitContentAxes:axis},innerHeight:450,HTMLElement:Element,getComputedStyle:()=>({height:'300px',minHeight:'0px',overflowY:'auto',overflowX:'auto'}),document:{body:{querySelectorAll:()=>[node]},head:{append(){}},createElement:()=>sheet}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('    let fitContentStyle = null;'),start),ctx);ctx.setFitContentLayout(true,true);
 assert.equal(sheet.textContent.includes('height:auto!important'),axis!=='width');
 assert.equal(sheet.textContent.includes('min-width:902px!important'),axis!=='height');
 ctx.setFitContentLayout(false);assert.equal(sheet.disabled,true);assert.equal(node.attributes.size,0);
});

test('presentation includes the body bottom margin without inheriting viewport height',()=>{
 const h=harness();h.body.getBoundingClientRect=()=>({right:640,bottom:5097.67});
 h.body.querySelectorAll=()=>[];h.ctx.getComputedStyle=()=>({marginBottom:'8px'});
 h.ctx.setPresentationLayout();h.flush();assert.equal(h.messages[0].height,5106);
 h.ctx.schedulePresentationSize();h.flush();assert.equal(h.messages.length,1);
 h.body.getBoundingClientRect=()=>({right:640,bottom:800});
 h.ctx.schedulePresentationSize();h.flush();assert.equal(h.messages[1].height,808);
});

test('height-only presentation resize measures changed natural height without refreshing fit layout',()=>{
 const h=harness();h.ctx.setPresentationLayout();h.flush();
 const initialLayouts=h.layouts.length,initialMessages=h.messages.length;
 h.ctx.innerHeight=1400;h.body.getBoundingClientRect=()=>({right:640,bottom:1400});
 h.emit('resize');assert.equal(h.frames.size,1);h.flush();
 assert.equal(h.layouts.length,initialLayouts);
 assert.equal(h.messages.length,initialMessages+1);
 assert.equal(h.messages.at(-1).height,1400);
});

test('width presentation resize refreshes fit layout before measuring new natural width',()=>{
 const h=harness();h.ctx.setPresentationLayout();h.flush();
 const initialLayouts=h.layouts.length,initialMessages=h.messages.length;
 h.ctx.innerWidth=1280;h.body.getBoundingClientRect=()=>({right:800,bottom:900});
 h.emit('resize');assert.equal(h.frames.size,1);h.flush();
 assert.equal(h.layouts.length,initialLayouts+1);
 assert.equal(h.messages.length,initialMessages+1);
 assert.equal(h.messages.at(-1).width,800);
});

test('authored presentation mutations refresh fit layout after a resize-only measurement',()=>{
 const h=harness();h.ctx.setPresentationLayout();h.flush();
 const initialLayouts=h.layouts.length;
 h.body.getBoundingClientRect=()=>({right:640,bottom:1400});
 h.ctx.innerHeight=1400;h.emit('resize');h.flush();
 assert.equal(h.layouts.length,initialLayouts);
 h.mutations[0].callback([{target:h.body,attributeName:'style'}]);
 assert.equal(h.frames.size,1);h.flush();
 assert.equal(h.layouts.length,initialLayouts+1);
 assert.equal(h.messages.at(-1).height,1400);
});

test('presentation exit resets the width cache and reentry initializes the current viewport width',()=>{
 const h=harness();h.ctx.setPresentationLayout();h.flush();
 h.ctx.widgetState={maximized:false,fitContent:true};h.ctx.setPresentationLayout();
 h.ctx.innerWidth=1440;h.ctx.widgetState={maximized:true,fitContent:false};
 h.ctx.setPresentationLayout();h.flush();
 const reentryLayouts=h.layouts.length;
 h.emit('resize');h.flush();
 assert.equal(h.layouts.length,reentryLayouts);
});

function measuredDocument(h,extent){
 h.body.scrollWidth=0;
 h.body.querySelectorAll=()=>[];
 h.body.getBoundingClientRect=()=>{const [right,bottom]=extent();return {right,bottom};};
}
for(const [name,extent] of [
 ['height doubling',h=>[720,h.ctx.innerHeight*2]],
 ['coupled width and height doubling',h=>[h.ctx.innerWidth*2,h.ctx.innerHeight*2]],
 ['viewport plus padding',h=>[720,h.ctx.innerHeight+16]],
 ['one pixel feedback',h=>[720,h.ctx.innerHeight+1]],
 ['oscillating heights',h=>[720,h.ctx.innerHeight===900?1200:900]],
])test(`presentation restores authored geometry after repeated ${name}`,()=>{
 const h=harness();measuredDocument(h,()=>extent(h));h.ctx.setPresentationLayout();h.flush();
 for(let i=0;i<3;i++){h.applyReport();h.flush();}
 h.applyReport();assert.equal(h.ctx.innerWidth,1024);assert.equal(h.ctx.innerHeight,900);
 assert.equal(h.layouts.at(-1)[0],false,'restore authored scrolling instead of clipping measured content');
 assert.equal(h.observers[0].disconnected,true);assert.equal(h.mutations[0].disconnected,true);
 const reports=h.messages.length;h.applyReport();h.observers[0].callback();h.mutations[0].callback([{target:h.body,attributeName:'style'}]);h.flush();
 assert.equal(h.frames.size,0);assert.equal(h.messages.length,reports,'the recovery resize must not restart measurement');
});

test('normal long documents, late content and shrinkage retain their measured height',()=>{
 const h=harness();let height=2400;measuredDocument(h,()=>[720,height]);h.ctx.setPresentationLayout();h.flush();
 assert.equal(h.messages.at(-1).height,2400);
 height=2700;h.applyReport();h.flush();
 assert.equal(h.messages.at(-1).height,2700,'content arriving during the resize must not be subtracted');
 h.applyReport();h.flush();
 for(height of [4800,9600,1800,60000]){
  h.mutations[0].callback([{target:h.body,attributeName:'style'}]);h.flush();
  assert.equal(h.messages.at(-1).height,height);
  h.applyReport();h.flush();
 }
 assert.notEqual(h.layouts.at(-1)[0],false);assert.notEqual(h.observers[0].disconnected,true);
});

test('presentation allows slowly converging reflow to finish',()=>{
 const h=harness();measuredDocument(h,()=>[720,Math.floor((h.ctx.innerHeight+2400)/2)]);
 h.ctx.setPresentationLayout();h.flush();
 for(let i=0;i<12;i++){h.applyReport();h.flush();}
 assert.equal(h.messages.at(-1).height,2399);assert.notEqual(h.layouts.at(-1)[0],false);
});

test('duplicate observer frames do not count as extra resize cycles',()=>{
 const h=harness();measuredDocument(h,()=>[720,h.ctx.innerHeight*2]);h.ctx.setPresentationLayout();h.flush();
 h.applyReport();h.flush();
 for(let i=0;i<8;i++){h.observers[0].callback();h.flush();}
 assert.equal(h.messages.length,2);assert.notEqual(h.layouts.at(-1)[0],false);
 h.applyReport();h.flush();assert.notEqual(h.layouts.at(-1)[0],false);
 h.applyReport();h.flush();assert.equal(h.layouts.at(-1)[0],false);
});

test('external viewport changes reset the feedback streak',()=>{
 const h=harness();measuredDocument(h,()=>[720,h.ctx.innerHeight+16]);h.ctx.setPresentationLayout();h.flush();
 for(let i=0;i<2;i++){h.applyReport();h.flush();}
 h.ctx.innerHeight=1100;h.emit('resize');h.flush();
 h.applyReport();h.flush();assert.notEqual(h.layouts.at(-1)[0],false);
});

test('unbounded resize feedback recovers before remaining at the dimension cap',()=>{
 const h=harness();measuredDocument(h,()=>[720,h.ctx.innerHeight*100]);h.ctx.setPresentationLayout();h.flush();
 h.applyReport();h.flush();h.applyReport();assert.equal(h.ctx.innerHeight,900);assert.equal(h.layouts.at(-1)[0],false);
});

test('a stable document beyond the dimension cap is not misclassified as a resize loop',()=>{
 const h=harness();measuredDocument(h,()=>[720,150000]);h.ctx.setPresentationLayout();h.flush();
 h.applyReport();h.flush();
 for(let i=0;i<4;i++){h.observers[0].callback();h.flush();}
 assert.equal(h.messages.at(-1).height,100000);assert.notEqual(h.layouts.at(-1)[0],false);
});

test('recovery survives reentry, preserves saved fit preferences on exit and resets with a new document',()=>{
 const h=harness();measuredDocument(h,()=>[720,h.ctx.innerHeight*2]);h.ctx.setPresentationLayout();h.flush();
 for(let i=0;i<3;i++){h.applyReport();h.flush();}
 h.applyReport();h.ctx.widgetState={maximized:false,fitContent:true};h.ctx.setPresentationLayout();
 assert.equal(h.layouts.at(-1)[0],true);
 h.ctx.widgetState.maximized=true;h.ctx.setPresentationLayout();h.flush();
 assert.equal(h.layouts.at(-1)[0],false);assert.equal(h.observers.length,1);assert.equal(h.frames.size,0);
 const fresh=harness();fresh.ctx.setPresentationLayout();fresh.flush();assert.equal(fresh.messages[0].height,1200);
});

test('snapshot capture defers feedback recovery until measurement resumes',()=>{
 const h=harness();measuredDocument(h,()=>[720,h.ctx.innerHeight*2]);h.ctx.setPresentationLayout();h.flush();
 for(let i=0;i<2;i++){h.applyReport();h.flush();}
 h.ctx.activeSnapshotRender={};h.applyReport();h.flush();assert.notEqual(h.layouts.at(-1)[0],false);
 h.ctx.activeSnapshotRender=null;h.ctx.schedulePresentationSize();h.flush();assert.equal(h.layouts.at(-1)[0],false);
});

test('a replacement document recovers to saved geometry rather than the previous document viewport',()=>{
 const h=harness();h.ctx.innerHeight=10000;
 measuredDocument(h,()=>[720,h.ctx.innerHeight*2]);h.ctx.setPresentationLayout();h.flush();
 for(let i=0;i<3;i++){h.applyReport();h.flush();}
 h.applyReport();assert.equal(h.ctx.innerHeight,900);assert.equal(h.ctx.innerWidth,1024);
 assert.equal(h.widget.contentH,900);assert.equal(h.widget.contentW,1024);
});

test('zoom transitions cannot promote a temporary browser viewport into content width',()=>{
 const h=harness();h.ctx.innerWidth=900;h.ctx.widgetState.viewportWidth=900;h.ctx.widgetState.scaleX=1.361111;
 measuredDocument(h,()=>[h.ctx.innerWidth,2855]);h.ctx.setPresentationLayout();h.flush();
 assert.equal(h.messages.at(-1).width,900);
 const layouts=h.layouts.length;
 h.ctx.innerWidth=3071;h.ctx.innerHeight=9742;h.emit('resize');h.flush();
 assert.equal(h.messages.length,1);assert.equal(h.layouts.length,layouts,'do not classify authored layout using the transient viewport');
 h.ctx.widgetState.scaleX=.398888;h.ctx.innerWidth=900;h.ctx.innerHeight=2855;h.emit('resize');h.flush();
 assert.equal(h.messages.length,1);assert.equal(h.layouts.length,layouts+1);
 // The reverse zoom transition briefly reports a narrower viewport too.
 h.ctx.innerWidth=263;h.emit('resize');h.flush();assert.equal(h.messages.length,1);
 h.ctx.innerWidth=900;h.ctx.widgetState.scaleX=1.361111;h.emit('resize');h.flush();
 assert.equal(h.messages.length,1);assert.notEqual(h.layouts.at(-1)[0],false);
});

test('authoritative viewport widths still permit real horizontal content overflow',()=>{
 const h=harness();h.ctx.widgetState.viewportWidth=1024;h.ctx.widgetState.scaleX=.4;
 measuredDocument(h,()=>[1800,2400]);h.ctx.setPresentationLayout();h.flush();
 assert.equal(h.messages.at(-1).width,1800);
 h.ctx.widgetState.viewportWidth=1800;h.applyReport();h.flush();
 assert.equal(h.ctx.innerWidth,1800);assert.notEqual(h.layouts.at(-1)[0],false);
});

test('parent scale updates resume a deferred measurement without another observer',()=>{
 const h=harness();h.ctx.widgetState={maximized:true,fitContent:false,scaleX:1,viewportWidth:900};h.ctx.innerWidth=3071;
 h.ctx.setPresentationLayout();h.flush();assert.equal(h.messages.length,0);
 Object.assign(h.ctx,{widgetStateReceived:true,setControlCursor(){},setRuntimeActive(){},notifyVisibleViewport(){}});
 const begin=source.indexOf('        const becameVisible = event.data.active');
 const finish=source.indexOf('        if (becameVisible) notifyVisibleViewport();',begin)+'        if (becameVisible) notifyVisibleViewport();'.length;
 const stateUpdate=vm.runInContext('(function(event){'+source.slice(begin,finish)+'})',h.ctx);
 h.ctx.innerWidth=900;
 stateUpdate({data:{maximized:true,fitContent:false,viewportWidth:900,scaleX:.4,scaleY:.4,active:true,selected:false}});
 assert.equal(h.frames.size,1);h.flush();assert.equal(h.messages.length,1);assert.equal(h.observers.length,1);
});
