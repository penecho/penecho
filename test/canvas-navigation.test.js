'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-navigation.js'),'utf8');
function harness(overrides={}) {
 const changes=[],widgets=[{id:'rear'},{id:'front'}];
 const state={mode:'pen',viewMode:false,viewTool:'hand',spacePan:false,interactingWidgetId:null,navigationLocked:false,scale:1,panX:0,panY:0,widgets,...overrides};
 const classList={toggle(name,value){changes.push([name,value]);}},view={classList},screen={};
 const ctx={setCanvasMode(mode){state.mode=mode;},state,view,screen,Math,Number,Boolean,document:{querySelector:()=>null,activeElement:null},window:{PenEchoStudioNavigator:{flushMcpFollow(){changes.push(['flush']);}}},syncWidgetHostStates(){},resetCanvasCursor(){},requestInteractionLayerRender(){},visibleWidgets:()=>widgets,clientPoint:e=>({x:e.clientX,y:e.clientY}),handObjectToolbarTargetAtPoint:()=>({kind:'widget',object:widgets[1]}),canvasViewportMetrics:()=>({width:1000,height:800}),moveCanvas:(dx,dy)=>{state.panX+=dx;state.panY+=dy;},zoomCanvasAt:(x,y,delta)=>{changes.push(['zoom',x,y,delta]);},requestCoordinatesUpdate(){},wheelNavigating(){}};
 const api=vm.runInNewContext(`${source.slice(0,source.indexOf("\n  document.querySelector('#canvasViewHand')"))};({enterWidgetInteraction,canvasWidgetSelectionEnabled,canvasWidgetInteractive,canvasWidgetAtEvent,setWidgetInteraction,setCanvasViewTool,setSpacePan,handleCanvasWheel,beginCanvasTrackpadGesture,updateCanvasTrackpadGesture,endCanvasTrackpadGesture})`,ctx);
 const wheel=(values={})=>{let prevented=false;const event={target:view,deltaX:0,deltaY:0,deltaMode:0,clientX:200,clientY:300,preventDefault(){prevented=true;},...values};api.handleCanvasWheel(event);return prevented;};
 return {api,state,changes,widgets,wheel,view,ctx};
}
test('two-axis scroll pans without scaling, follows shift and deltaMode, and ignores zero events',()=>{
 const h=harness();assert.equal(h.wheel({deltaX:20,deltaY:-30}),true);assert.equal(h.state.panX,-20);assert.equal(h.state.panY,30);assert.equal(h.changes.length,0);
 h.wheel({shiftKey:true,deltaY:4,deltaMode:1});assert.equal(h.state.panX,-84);assert.equal(h.state.panY,30);
 h.wheel({deltaY:1,deltaMode:2});assert.equal(h.state.panY,-770);
 h.wheel();assert.equal(h.changes.length,0);assert.equal(h.state.scale,1);
});
test('pinch-style Ctrl wheel, Cmd wheel and explicit preference zoom at the pointer',()=>{
 for(const options of [{ctrlKey:true},{metaKey:true}]){const h=harness();h.wheel({deltaY:-40,...options});assert.deepEqual(h.changes,[['zoom',200,300,-40]]);assert.equal(h.state.panX,0);}
 const h=harness({wheelZoom:true});h.wheel({deltaY:20});assert.deepEqual(h.changes,[['zoom',200,300,20]]);
});
test('wheel never steals panel scrolling and cannot change camera during drawing, dragging or a navigation lock',()=>{
 const h=harness();assert.equal(h.wheel({target:{closest:()=>null},deltaY:30}),false);assert.equal(h.state.panY,0);
 for(const state of [{navigationLocked:true},{drawing:{}},{widgetGesture:{}},{selectionGesture:{}},{trackpadGesture:{}}]){const h=harness(state);h.wheel({deltaY:30,ctrlKey:true});assert.equal(h.changes.length,0);assert.equal(h.state.panY,0);}
});
test('Hand and Pen never enable iframe interaction; View requires its own Select tool',()=>{
 const h=harness();assert.equal(h.api.setWidgetInteraction(h.widgets[1]),false);
 h.state.mode='hand';assert.equal(h.api.canvasWidgetSelectionEnabled(),false);
 h.state.viewMode=true;h.state.mode='select';assert.equal(h.api.canvasWidgetSelectionEnabled(),false);
 h.api.setCanvasViewTool('select');assert.equal(h.api.canvasWidgetSelectionEnabled(),true);assert.equal(h.api.setWidgetInteraction(h.widgets[1]),true);
 assert.equal(h.api.canvasWidgetInteractive(h.widgets[0]),false);assert.equal(h.api.canvasWidgetInteractive(h.widgets[1]),true);
 h.api.setCanvasViewTool('hand');assert.equal(h.state.interactingWidgetId,null);assert.equal(h.api.canvasWidgetInteractive(h.widgets[1]),false);
});
test('only the hit front shell can be selected; activating it does not reorder Widgets',()=>{
 const h=harness({viewMode:true,viewTool:'select'});
 const shell={dataset:{widgetId:'front'}};const hit=h.api.canvasWidgetAtEvent({target:{closest:()=>shell}});assert.equal(hit,h.widgets[1]);
 h.api.setWidgetInteraction(h.widgets[0]);h.api.setWidgetInteraction(hit);
 assert.equal(h.api.canvasWidgetInteractive(h.widgets[0]),false);assert.deepEqual(h.widgets.map(w=>w.id),['rear','front']);
 assert.equal(h.api.setWidgetInteraction({id:'outside'}),false);
});
test('temporary Space pan suspends and restores native Widget interaction without changing the tool',()=>{
 const h=harness({mode:'select'});h.api.setWidgetInteraction(h.widgets[0]);
 h.api.setSpacePan(true);assert.equal(h.api.canvasWidgetInteractive(h.widgets[0]),false);assert.equal(h.state.mode,'select');
 h.api.setSpacePan(false);assert.equal(h.api.canvasWidgetInteractive(h.widgets[0]),true);
});
test('Safari gesture scale is cumulative, and wheel cannot double-apply the same pinch',()=>{
 const h=harness(),e=scale=>({target:h.view,scale,clientX:5,clientY:7,preventDefault(){}});
 h.api.beginCanvasTrackpadGesture(e(1));h.api.updateCanvasTrackpadGesture(e(1.5));h.wheel({ctrlKey:true,deltaY:-30});h.api.updateCanvasTrackpadGesture(e(2));
 assert.equal(h.changes.length,2);assert.ok(Math.abs(h.changes[0][3]+h.changes[1][3]+Math.log(2)/.002)<1e-8);
 h.api.endCanvasTrackpadGesture(e(2));assert.equal(h.state.trackpadGesture,null);assert.deepEqual(h.changes.at(-1),['flush']);
});
test('continuous zoom preserves its anchor, cancels on equal inverse deltas and ignores zero',()=>{
 const runtime=fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-runtime.js'),'utf8');
 const start=runtime.indexOf('  function zoomCanvasAt('),end=runtime.indexOf('\n  function valid(',start);
 const state={scale:.5,panX:-400,panY:75,navigationLocked:false};
 const zoom=vm.runInNewContext(`(${runtime.slice(start,end).trim()})`,{state,canvasClientPosition:(x,y)=>({x,y}),requestCoordinatesUpdate(){},requestCanvasNavigationPreview(){},wheelNavigating(){}});
 const anchor=[(200-state.panX)/state.scale,(300-state.panY)/state.scale];
 zoom(200,300,-17);assert.ok(Math.abs((200-state.panX)/state.scale-anchor[0])<1e-9);assert.ok(Math.abs((300-state.panY)/state.scale-anchor[1])<1e-9);
 zoom(200,300,17);assert.ok(Math.abs(state.scale-.5)<1e-10);assert.ok(Math.abs(state.panX+400)<1e-9);
 const before={...state};assert.equal(zoom(200,300,0),false);assert.deepEqual(state,before);
});

test('interactive Widget shell retains wheel and pinch while blank Canvas still navigates',()=>{
 const h=harness({mode:'select'});h.api.setWidgetInteraction(h.widgets[0]);
 const target={closest:()=>({dataset:{widgetId:'rear'}})};
 assert.equal(h.wheel({target,deltaY:30,ctrlKey:true}),false);
 let prevented=false;h.api.beginCanvasTrackpadGesture({target,scale:1,preventDefault(){prevented=true;}});
 assert.equal(prevented,false);assert.equal(h.state.trackpadGesture,undefined);assert.equal(h.changes.some(c=>c[0]==='zoom'),false);
 h.wheel({deltaY:20});assert.equal(h.state.panY,-20);
});

function gestureHarness(overrides={}) {
 const calls=[],listeners={},widgets=overrides.widgets||[{id:'rear'},{id:'front'}];
 const state={mode:'pen',viewMode:false,viewTool:'hand',spacePan:false,interactingWidgetId:null,navigationLocked:false,scale:1,panX:0,panY:0,handToolbarTargets:new Map(),...overrides,widgets};
 const view={classList:{toggle(){}},clientWidth:1000,clientHeight:800,addEventListener(type,listener){(listeners[type]||(listeners[type]=[])).push(listener);}};
 const ctx={state,view,screen:{},Math,Number,Boolean,String,JSON,
  document:{querySelector:()=>null,activeElement:null},
  window:{addEventListener(){},PenEchoStudioNavigator:{flushMcpFollow(){}}},
  localStorage:{setItem(){},getItem:()=>null},
  syncWidgetHostStates(){},resetCanvasCursor(){},requestInteractionLayerRender(){},requestCoordinatesUpdate(){},wheelNavigating(){},
  visibleWidgets:()=>widgets,clientPoint:e=>({x:e.clientX,y:e.clientY}),
  widgetPointerHit:()=>null, // This harness exercises Widget body activation, outside resize zones.
  handObjectToolbarTargetAtPoint:()=>({kind:'widget',object:widgets[1]}),
  canvasViewportMetrics:()=>({width:1000,height:800}),
  showHandObjectToolbar:(kind,object)=>{calls.push(['toolbar',kind,object?.id]);return true;},
  setCanvasMode:(mode)=>{calls.push(['mode',mode]);state.mode=mode;}};
 vm.runInNewContext(source,ctx);
 const fire=(type,values={})=>{const event={target:{},clientX:400,clientY:300,preventDefault(){event.prevented=true;},...values};for(const listener of listeners[type]||[])listener(event);return event;};
 return {state,calls,widgets,fire};
}
test('right-click lists the Widget toolbar and double-click enters interaction from Hand or View',()=>{
 const hand=gestureHarness({mode:'hand'});
 const menu=hand.fire('contextmenu');
 assert.equal(menu.prevented,true);assert.deepEqual(hand.calls,[['toolbar','widget','front']]);
 hand.fire('dblclick');
 assert.deepEqual(hand.calls.at(-1),['mode','select']);
 assert.equal(hand.state.mode,'select');assert.equal(hand.state.interactingWidgetId,'front');

 const view=gestureHarness({viewMode:true,viewTool:'hand'});
 view.fire('dblclick');
 assert.equal(view.state.viewTool,'select');assert.equal(view.state.interactingWidgetId,'front');

 const pen=gestureHarness({mode:'pen'});
 pen.fire('dblclick');
 assert.equal(pen.state.interactingWidgetId,null);assert.deepEqual(pen.calls,[]);

 const chrome=gestureHarness({mode:'hand'});
 chrome.fire('contextmenu',{target:{closest:()=>({})}});
 assert.deepEqual(chrome.calls,[]);

 const pending=gestureHarness({mode:'hand',widgets:[{id:'rear'},{id:'front',pending:true}]});
 pending.fire('contextmenu');
 assert.deepEqual(pending.calls,[]);

 const active=gestureHarness({mode:'hand',interactingWidgetId:'front'});
 active.fire('contextmenu');
 active.fire('dblclick');
 assert.deepEqual(active.calls,[]);assert.equal(active.state.interactingWidgetId,'front');
});

test('explicit widget interaction restores the originating Hand or Pen tool on exit',()=>{
 for(const mode of ['hand','pen','eraser','area-eraser','text']){
  const h=harness({mode});
  assert.equal(h.api.enterWidgetInteraction(h.widgets[0]),true);
  assert.equal(h.state.mode,'select');
  h.api.enterWidgetInteraction(h.widgets[1]);
  h.api.setWidgetInteraction(null);
  assert.equal(h.state.mode,mode);
  assert.equal(h.state.interactingWidgetId,null);
  assert.equal(h.state.widgetInteractionReturnTool,null);
 }
});
test('explicit tool changes discard the interaction return tool',()=>{
 const h=harness({mode:'hand'});
 h.api.enterWidgetInteraction(h.widgets[0]);
 h.api.setWidgetInteraction(null,{restoreTool:false});
 assert.equal(h.state.mode,'select');
 assert.equal(h.state.widgetInteractionReturnTool,null);
});
test('view interaction restores its own Hand tool independently of the editing tool',()=>{
 const h=harness({viewMode:true,viewTool:'hand',mode:'pen'});
 h.api.enterWidgetInteraction(h.widgets[0]);
 assert.equal(h.state.viewTool,'select');
 h.api.setWidgetInteraction(null);
 assert.equal(h.state.viewTool,'hand');
 assert.equal(h.state.mode,'pen');
});

test('a front image blocks the HTML shell beneath it without blocking exposed or maximized Widgets',()=>{
 const h=harness({mode:'select'});
 const event={clientX:20,clientY:30,target:{closest:()=>({dataset:{widgetId:'front'}})}};
 h.ctx.handObjectToolbarTargetAtPoint=()=>({kind:'image',object:{id:'image-1'}});
 assert.equal(h.api.canvasWidgetAtEvent(event),null);
 h.ctx.handObjectToolbarTargetAtPoint=()=>({kind:'widget',object:h.widgets[1]});
 assert.equal(h.api.canvasWidgetAtEvent(event),h.widgets[1]);
 h.ctx.handObjectToolbarTargetAtPoint=()=>null;
 assert.equal(h.api.canvasWidgetAtEvent(event),h.widgets[1]);
 h.ctx.handObjectToolbarTargetAtPoint=()=>({kind:'image',object:{id:'image-1'}});
 h.widgets[1].maximized=true;
 assert.equal(h.api.canvasWidgetAtEvent(event),h.widgets[1]);
});

 test('selection mode exits to the last working tool, never the selection arrow',()=>{
  for(const mode of ['hand','pen','eraser']){
   const h=harness({mode:'select',widgetReturnMode:mode});
   h.api.enterWidgetInteraction(h.widgets[0]);
   h.api.enterWidgetInteraction(h.widgets[1]);
   h.api.setWidgetInteraction(null);
   assert.equal(h.state.mode,mode);
  }
  const h=harness({viewMode:true,viewTool:'select'});
  h.api.enterWidgetInteraction(h.widgets[0]);
  h.api.setWidgetInteraction(null);
  assert.equal(h.state.viewTool,'hand');
 });
