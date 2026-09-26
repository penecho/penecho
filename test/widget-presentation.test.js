'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-navigation.js'),'utf8');
const helperSource=source.slice(0,source.indexOf('\n  function canvasNavigationTextTarget'));
const PRESENTATION_KEY='penecho.widgetInteractionPresentation';

class FakeElement {
 constructor(tagName) {
  this.tagName=String(tagName).toUpperCase();
  this.children=[];
  this.listeners=new Map();
  this.attributes=new Map();
  this.parentNode=null;
  this.className='';
  this.disabled=false;
  this.textContent='';
  this.style={};this.offsetHeight=52;
 }
 setAttribute(name,value){this.attributes.set(name,String(value));}
 getAttribute(name){return this.attributes.get(name)??null;}
 removeAttribute(name){this.attributes.delete(name);}
 remove() { if(this.parentNode?.children)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);this.parentNode=null; }
 addEventListener(type,listener,options={}){
  const entries=this.listeners.get(type)||[];
  entries.push({listener,once:options.once===true});
  this.listeners.set(type,entries);
 }
 append(...children){for(const child of children){child.parentNode=this;this.children.push(child);}}
 prepend(...children){for(const child of [...children].reverse()){child.parentNode=this;this.children.unshift(child);}}
 dispatch(type,init={}){
  const entries=[...(this.listeners.get(type)||[])],event={...init,type,currentTarget:this,target:this};
  return entries.map(entry=>{
   if(entry.once){const current=this.listeners.get(type)||[],index=current.indexOf(entry);if(index>=0)current.splice(index,1);}
   return entry.listener(event);
  })[0];
 }
}

function harness({stored=null,failGet=false,failSet=false,downloadImpl=()=>Promise.resolve()}={}) {
 const storage=new Map([[PRESENTATION_KEY,stored]]);
 const writes=[],renders=[],positions=[],downloads=[],hostStateCalls=[];
 const localStorage={
  getItem(key){if(failGet)throw new Error('storage read failed');return storage.get(key)??null;},
  setItem(key,value){if(failSet)throw new Error('storage write failed');storage.set(key,value);writes.push([key,value]);}
 };
 const ctx={
  state:{scale:1.5},
  location:{origin:'https://canvas.test'},
  getComputedStyle:()=>({paddingLeft:'20',paddingRight:'20',paddingBottom:'20'}),
  ResizeObserver:class{observe(){}disconnect(){}},
  localStorage,
  requestInteractionLayerRender(){renders.push(true);},
  positionWidget(widget){positions.push(widget);},
  document:{createElement(tagName){return new FakeElement(tagName);}},
  t(key){return key;},
  OBJECT_CHROME_ICONS:{download:''},
  downloadWidgetImage(widget){downloads.push(widget);return downloadImpl(widget);},
  sendWidgetHostState(widget){hostStateCalls.push(widget);},
  setWidgetInteraction(){}
 };
 const api=vm.runInNewContext(`${helperSource};({widgetInteractionPresentation,switchWidgetPresentation,setWidgetPresentationZoom,setWidgetMaximized,updateWidgetPresentationScroll,syncWidgetPresentationScroll})`,ctx);
 return {api,downloads,hostStateCalls,storage,writes,renders,positions};
}

function widgetFixture({presentationToolbar={id:'existing-toolbar',offsetHeight:52}}={}) {
 const parent={id:'canvas-layer'};
 const classChanges=[];
 const shell={
  parentNode:parent,
  clientWidth:1440,clientHeight:900,scrollTop:0,scrollLeft:0,
  append(){},addEventListener(){},removeEventListener(){},
  classList:{add(name){classChanges.push(['add',name]);},remove(name){classChanges.push(['remove',name]);}},
  attributes:new Map(),
  popoverOpen:false,
  setAttribute(name,value){this.attributes.set(name,value);},
  removeAttribute(name){this.attributes.delete(name);},
  showPopoverCalls:0,
  showPopover(){this.showPopoverCalls++;this.popoverOpen=true;},
  hidePopoverCalls:0,
  hidePopover(){this.hidePopoverCalls++;this.popoverOpen=false;},
  matches(selector){return selector===':popover-open'&&this.popoverOpen;},
  prependCalls:0,
  prepend(...children){this.prependCalls++;this.prepended=children[0];children[0].parentNode=this;}
 };
 const frame={contentWindow:{postMessage(){}},focusCalls:0,focus(){this.focusCalls++;}};
 const widget={id:'widget-1',title:'Widget',shell,frame,presentationToolbar,styleRule:{style:{setProperty(){},removeProperty(){}}},maximized:false,w:240,h:160,contentW:480,contentH:320,presentationWidth:null,presentationHeight:null};
 return {widget,parent,shell,frame,toolbar:presentationToolbar,classChanges};
}

function toolbarButton(toolbar,label) {
 return toolbar?.children?.find(child=>child.tagName==='BUTTON'&&child.getAttribute('aria-label')===label);
}

function toolbarZoomLabel(toolbar) {
 return toolbar?.children?.find(child=>child.tagName==='OUTPUT');
}

test('Widget presentation defaults to maximized and honors saved canvas/max modes',()=>{
 const h=harness();
 assert.equal(h.api.widgetInteractionPresentation(),'maximized');
 h.storage.set(PRESENTATION_KEY,'canvas');
 assert.equal(h.api.widgetInteractionPresentation(),'canvas');
 h.storage.set(PRESENTATION_KEY,'maximized');
 assert.equal(h.api.widgetInteractionPresentation(),'maximized');
});

test('Widget presentation tolerates localStorage failures and still switches state',()=>{
 const readFailure=harness({failGet:true});
 assert.equal(readFailure.api.widgetInteractionPresentation(),'maximized');

 const writeFailure=harness({failSet:true});
 const fixture=widgetFixture();
 writeFailure.api.switchWidgetPresentation(fixture.widget,true);
 assert.equal(fixture.widget.maximized,true);
 assert.equal(fixture.shell.attributes.get('popover'),'manual');
 assert.equal(fixture.shell.showPopoverCalls,1);
 assert.deepEqual(writeFailure.writes,[]);
 assert.deepEqual(writeFailure.renders,[true]);
});

test('repeated maximize/minimize preserves the Widget shell and frame without reparenting',()=>{
 const h=harness();
 const fixture=widgetFixture();
 const {widget,parent,shell,frame,toolbar}=fixture;

 h.api.setWidgetMaximized(widget,true);
 h.api.setWidgetMaximized(widget,true);
 h.api.setWidgetMaximized(widget,false);
 h.api.setWidgetMaximized(widget,false);
 h.api.setWidgetMaximized(widget,true);

 assert.equal(widget.shell,shell);
 assert.equal(widget.frame,frame);
 assert.equal(widget.presentationToolbar,toolbar);
 assert.equal(shell.parentNode,parent);
 assert.equal(shell.prependCalls,0);
 assert.equal(shell.showPopoverCalls,2);
 assert.equal(shell.hidePopoverCalls,1);
 assert.equal(widget.maximized,true);
 assert.equal(frame.focusCalls,3);
 assert.deepEqual(h.positions,[widget,widget,widget]);
});

test('Widget presentation zoom clamps, updates controls, and notifies the host',()=>{
 const h=harness();
 const fixture=widgetFixture();
 const controls={zoomOut:new FakeElement('button'),zoomIn:new FakeElement('button'),label:new FakeElement('output')};
 fixture.widget.presentationZoomControls=controls;

 h.api.setWidgetPresentationZoom(fixture.widget,70);
 assert.equal(fixture.widget.presentationZoom,70);
 assert.equal(fixture.shell.attributes.get('data-presentation-zoom'),'70');
 assert.equal(controls.label.textContent,'70%');
 assert.equal(controls.zoomOut.disabled,false);
 assert.equal(controls.zoomIn.disabled,false);
 assert.deepEqual(h.hostStateCalls,[fixture.widget]);

 h.api.setWidgetPresentationZoom(fixture.widget,0,false);
 assert.equal(fixture.widget.presentationZoom,50);
 assert.equal(fixture.shell.attributes.get('data-presentation-zoom'),'50');
 assert.equal(controls.label.textContent,'50%');
 assert.equal(controls.zoomOut.disabled,true);
 assert.equal(controls.zoomIn.disabled,false);
 assert.equal(h.hostStateCalls.length,1,'notifyHost=false must not send another host state');

 h.api.setWidgetPresentationZoom(fixture.widget,150);
 assert.equal(fixture.widget.presentationZoom,100);
 assert.equal(fixture.shell.attributes.get('data-presentation-zoom'),'100');
 assert.equal(controls.label.textContent,'100%');
 assert.equal(controls.zoomOut.disabled,false);
 assert.equal(controls.zoomIn.disabled,true);
 assert.equal(h.hostStateCalls.length,2);
});

test('maximizing creates one zoom control set, resets it on re-entry, and preserves Widget geometry',()=>{
 const h=harness();
 const fixture=widgetFixture({presentationToolbar:null});
 const {widget,parent,shell,frame}=fixture;
 const geometry={w:widget.w,h:widget.h,contentW:widget.contentW,contentH:widget.contentH};

 h.api.setWidgetMaximized(widget,true);
 const toolbar=widget.presentationToolbar;
 const zoomOut=toolbarButton(toolbar,'imageZoomOut');
 const zoomIn=toolbarButton(toolbar,'imageZoomIn');
 const label=toolbarZoomLabel(toolbar);
 assert.ok(toolbar);
 assert.ok(zoomOut);
 assert.ok(zoomIn);
 assert.ok(label);
 assert.equal(widget.presentationZoom,100);
 assert.equal(shell.attributes.get('data-presentation-zoom'),'100');
 assert.equal(label.textContent,'100%');
 assert.equal(zoomOut.disabled,false);
 assert.equal(zoomIn.disabled,true);
 zoomOut.dispatch('click');
 assert.equal(widget.presentationZoom,90);
 assert.equal(label.textContent,'90%');

 h.api.setWidgetMaximized(widget,false);
 assert.equal(widget.presentationZoom,100);
 assert.equal(shell.attributes.has('data-presentation-zoom'),false);
 h.api.setWidgetMaximized(widget,true);

 assert.strictEqual(widget.presentationToolbar,toolbar);
 assert.strictEqual(widget.frame,frame);
 assert.equal(shell.parentNode,parent);
 assert.equal(shell.prependCalls,1,'re-entry must not rebuild the toolbar or iframe');
 assert.equal(widget.presentationZoom,100);
 assert.equal(toolbarZoomLabel(toolbar).textContent,'100%');
 assert.equal(toolbarButton(toolbar,'imageZoomOut').disabled,false);
 assert.equal(toolbarButton(toolbar,'imageZoomIn').disabled,true);
 assert.deepEqual({w:widget.w,h:widget.h,contentW:widget.contentW,contentH:widget.contentH},geometry);
});

test('Widget download button restores itself after success and failure without toolbar index lookup',async()=>{
 let resolveDownload;
 const pending=new Promise(resolve=>{resolveDownload=resolve;});
 const success=harness({downloadImpl:()=>pending});
 const successFixture=widgetFixture({presentationToolbar:null});
 success.api.setWidgetMaximized(successFixture.widget,true);
 const successButton=toolbarButton(successFixture.widget.presentationToolbar,'downloadWidget');
 const successRun=successButton.dispatch('click');
 assert.equal(successButton.disabled,true);
 resolveDownload();
 await successRun;
 assert.equal(successButton.disabled,false);
 assert.deepEqual(success.downloads,[successFixture.widget]);

 const failure=harness({downloadImpl:async()=>{throw Error('download failed');}});
 const failureFixture=widgetFixture({presentationToolbar:null});
 failure.api.setWidgetMaximized(failureFixture.widget,true);
 const failureButton=toolbarButton(failureFixture.widget.presentationToolbar,'downloadWidget');
 await assert.rejects(failureButton.dispatch('click'),/download failed/);
 assert.equal(failureButton.disabled,false);
 assert.deepEqual(failure.downloads,[failureFixture.widget]);
});

test('presentation fits width on entry and resize, with manual zoom and cleanup',()=>{
 const h=harness(),{widget}=widgetFixture();
 const properties=new Map();
 widget.styleRule={style:{setProperty:(k,v)=>properties.set(k,v),removeProperty:k=>properties.delete(k)}};
 h.api.setWidgetMaximized(widget,true);
 assert.equal(Number(properties.get('--widget-page-scale')),1400/480);
 h.api.setWidgetPresentationZoom(widget,50);
 assert.equal(Number(properties.get('--widget-page-scale')),1400/480*.5);
 widget.shell.clientWidth=520;
 h.api.updateWidgetPresentationScroll(widget);
 assert.equal(Number(properties.get('--widget-page-scale')),.5);
 h.api.setWidgetMaximized(widget,false);
 assert.equal(properties.has('--widget-page-scale'),false);
});

test('maximized wide pages fit their full width without an outer horizontal scroll track',()=>{
 const h=harness(),{widget}=widgetFixture();
 const properties=new Map();
 widget.styleRule={style:{setProperty:(k,v)=>properties.set(k,v),removeProperty:k=>properties.delete(k)}};
 h.api.setWidgetMaximized(widget,true);
 widget.presentationScrollContent={width:1800,viewportWidth:480,height:1200,viewportHeight:320};
 h.api.updateWidgetPresentationScroll(widget);
 assert.equal(Number(properties.get('--widget-page-scale')),1400/1800);
 assert.equal(widget.presentationScrollExtent.style.width,'1400px');
 assert.ok(parseFloat(widget.presentationScrollExtent.style.height)>widget.shell.clientHeight);
 h.api.setWidgetPresentationZoom(widget,50);
 assert.equal(Number(properties.get('--widget-page-scale')),700/1800);
 assert.equal(widget.presentationScrollExtent.style.width,'1400px');
});

test('content changes grow the scroll track without resizing the layout viewport',()=>{
 const h=harness(),{widget}=widgetFixture();
 widget.h=widget.contentH=1100;widget.w=widget.contentW=900;
 h.api.setWidgetMaximized(widget,true);
 const properties=new Map(),messages=[];
 widget.styleRule.style.setProperty=(k,v)=>properties.set(k,v);
 widget.frame.contentWindow.postMessage=m=>messages.push(m);
 widget.presentationScrollContent={height:2200,viewportHeight:1100,width:900,viewportWidth:900};
 h.api.updateWidgetPresentationScroll(widget);
 const height=properties.get('--widget-presentation-frame-height');
 assert.equal(height,'1100px');assert.ok(Math.abs(parseFloat(widget.presentationScrollExtent.style.height)-2200*1400/900)<1e-9);
 widget.presentationScrollContent.height=2800;h.api.updateWidgetPresentationScroll(widget);
 assert.equal(properties.get('--widget-presentation-frame-height'),height);
 assert.ok(Math.abs(parseFloat(widget.presentationScrollExtent.style.height)-2800*1400/900)<1e-9);
 widget.shell.scrollTop=widget.presentationScrollMetrics.outside+200*widget.presentationScrollMetrics.scale;h.api.syncWidgetPresentationScroll(widget);
 assert.ok(Math.abs(messages.at(-1).top-200)<1e-9);
 assert.equal(widget.contentH,1100);
});
