"use strict";

const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.join(__dirname,".."),read=file=>fs.readFileSync(path.join(root,file),"utf8"),SMART=require("../public/smart-suggest.js");
const runtime=read("src/client/app/canvas-runtime.js"),persistence=read("src/client/app/persistence.js"),ai=read("src/client/app/ai-runtime.js");
const plain=value=>JSON.parse(JSON.stringify(value));
function functionSource(source,name) {
  const start=source.indexOf(`function ${name}(`);assert.ok(start>=0,`missing ${name}`);
  let depth=0,index=source.indexOf("{",source.indexOf(")",start));
  for(;index<source.length;index++){if(source[index]==="{")depth++;else if(source[index]==="}"&&--depth===0)break;}
  return source.slice(start,index+1);
}
function fixture() {
  const command=SMART.graphWidgetCommand({expression:"y=a*x"}),graph={...command,id:"graph",widgetType:"html_widget",contentVersion:0,snapshotDataUrl:"",pending:false},
    other={id:"other",widgetType:"html_widget",pluginId:"general",html:"older AI result",title:"Older result"},tiles=new Map(),
    state={widgets:[graph,other],history:[],future:[],historyBefore:new Map(),inkBounds:new Map(),widgetHistoryBefore:null,animationHistoryBefore:null,imageHistoryBefore:null,textBoxHistoryBefore:null,userRevision:0,recognitionGeneration:0,interactingWidgetId:graph.id,autoEligible:true,language:"en"},
    context=vm.createContext({state,tiles,MAX_HISTORY:30,MAX_WIDGET_HTML_LENGTH:1000000,TILE:256,SIZE:10000,canvasSnapshotFinalizationDepth:0,
      window:{PENECHO_SMART_SUGGEST:SMART,PenEchoStudioNavigator:{updateDocument(){}}},document:{querySelector:()=>null},
      serializedAnimations:()=>[],imageHistoryState:()=>[],textBoxHistoryState:()=>[],cloneCanvas:value=>value?structuredClone(value):null,
      canvasAgentDidCommitUserCanvasChange:entry=>entry,restoreAnimations(){},restoreImages(){},restoreTextBoxes(){},restorePendingHistoryState(){},clearSharpOverlays(){},requestAnimationLayerRender(){},render(){},requestRender(){},t:()=>"Refine",
      invalidateRecognition(){state.recognitionGeneration++;},
      restoreWidgets(items){for(const w of state.widgets)w.graphHistoryInteraction=null;state.widgets=plain(items).map(w=>({...w,contentVersion:0}));},
      aiWidgetSourceSignature:widget=>JSON.stringify({html:widget.html,copyText:widget.copyText,title:widget.title}),
    });
  vm.runInContext([...["serializedWidgets","recordWidgetsBefore","handleGraphWidgetChange"].map(name=>functionSource(runtime,name)),
    ...["hasPendingHistoryChanges","updateHistoryButtons","save","saveUserCanvasChange","applyHistory","undo","redo"].map(name=>functionSource(persistence,name)),
    ...["aiInputInvalid","aiWidgetEditChanged"].map(name=>functionSource(ai,name))].join("\n"),context);
  const document=(value=2)=>({version:2,mode:"2d",expressions:["y=a*x"],parameters:{a:value},window2:[-5/value,5/value,-4,4],view3:null});
  const change=(value,id="wheel-1",phase="update")=>context.handleGraphWidgetChange(state.widgets.find(w=>w.id==="graph"),{document:document(value),...(id?{interaction:{id,phase}}:{})});
  const ink=value=>{state.historyBefore.set("0,0",tiles.get("0,0")?structuredClone(tiles.get("0,0")):null);tiles.set("0,0",{value});state.inkBounds.set("0,0",{});state.userRevision++;return context.save();};
  const data=()=>SMART.graphDocumentData(state.widgets.find(w=>w.id==="graph").html).data;
  return {context,state,graph,other,tiles,change,ink,data,document};
}

test("hundreds of wheel and slider updates use one Undo entry each and preserve older ink and AI history",()=>{
  const h=fixture(),original=h.graph.html,inkEntry=h.ink("old ink");
  h.context.recordWidgetsBefore();h.other.html="accepted AI result";const aiEntry=h.context.save();
  for(let i=1;i<=160;i++)h.change(1+i/100,"wheel-1");
  h.change(2.6,"wheel-1","end");
  for(let i=1;i<=400;i++)h.change(2.6+i/100,"parameter-2");
  h.change(6.6,"parameter-2","end");
  assert.equal(h.state.history.length,4);assert.equal(h.state.history[0],inkEntry);assert.equal(h.state.history[1],aiEntry);
  assert.equal(h.state.history[2].widgetsBefore[0].html,original);
  assert.equal(SMART.graphDocumentData(h.state.history.at(-1).widgetsAfter[0].html).data.parameters.a,6.6);
  h.context.undo();assert.equal(h.data().parameters.a,2.6);assert.equal(h.state.widgets[1].html,"accepted AI result");
  h.context.redo();assert.equal(h.data().parameters.a,6.6);assert.equal(h.state.future.length,0);
  h.context.undo();h.context.undo();assert.equal(h.state.widgets[0].html,original);assert.equal(h.tiles.get("0,0").value,"old ink");
  h.context.undo();assert.equal(h.state.widgets[1].html,"older AI result");h.context.undo();assert.equal(h.tiles.has("0,0"),false);
});

test("coalescing cannot consume another pending edit or modify a detached/replayed entry",()=>{
  const h=fixture();h.change(2);const first=h.state.history[0],firstAfter=first.widgetsAfter[0].html;
  h.state.historyBefore.set("0,0",null);h.tiles.set("0,0",{value:"interleaved ink"});h.state.inkBounds.set("0,0",{});
  h.change(3);assert.equal(h.state.history.length,3);assert.equal(first.widgetsAfter[0].html,firstAfter);
  h.context.undo();assert.equal(h.data().parameters.a,2);h.context.undo();assert.equal(h.tiles.has("0,0"),false);
  h.context.redo();h.context.redo();assert.equal(h.data().parameters.a,3);
  // Even if an Undo/Redo keeps an object alive, its recognition generation is a barrier.
  h.state.interactingWidgetId="graph";h.change(4,"wheel-3");const replayed=h.state.history.at(-1),replayedAfter=replayed.widgetsAfter[0].html;
  const live=h.state.widgets[0],transaction=live.graphHistoryInteraction;
  h.context.undo();assert.equal(live.graphHistoryInteraction,null);h.context.redo();
  h.state.widgets[0].graphHistoryInteraction=transaction;h.state.interactingWidgetId="graph";h.change(5,"wheel-3");
  assert.notEqual(h.state.history.at(-1),replayed);assert.equal(replayed.widgetsAfter[0].html,replayedAfter);
  h.context.undo();assert.equal(h.data().parameters.a,4);
});

test("document restoration, unrelated Widget changes and discrete/legacy graph actions break a transaction",()=>{
  const h=fixture();h.change(2);const first=h.state.history.at(-1),firstAfter=first.widgetsAfter[0].html;
  h.context.recordWidgetsBefore();h.other.html="user edit";h.state.userRevision++;h.change(3);
  assert.equal(h.state.history.length,3);assert.equal(first.widgetsAfter[0].html,firstAfter);
  const current=h.state.history.at(-1);h.state.recognitionGeneration++;h.change(4);
  assert.notEqual(h.state.history.at(-1),current);
  h.change(5,null);h.change(6,null);assert.equal(h.state.history.length,6);
  h.change(7,"parameter-4","end");assert.equal(h.state.widgets[0].graphHistoryInteraction,null);
  h.change(8,"parameter-4");assert.equal(h.state.history.length,8);
});

test("live serialized save/export state and the current after-state retain the last value before interaction end",()=>{
  const h=fixture();h.change(2,"parameter-1");const entry=h.state.history[0];
  for(let i=3;i<70;i++)h.change(i,"parameter-1");
  const saved=plain(h.context.serializedWidgets());
  assert.equal(SMART.graphDocumentData(saved[0].html).data.parameters.a,69);assert.match(saved[0].copyText,/a = 69/);
  assert.equal(entry.widgetsAfter[0].html,saved[0].html);assert.equal(h.state.widgetHistoryBefore,null);assert.equal(h.context.save(),null);
  h.change(69,"parameter-1","end");h.change(70,"wheel-2");assert.equal(h.state.history.length,2);
});

test("graph source changes invalidate same-Widget refinement while preserving unrelated AI input",()=>{
  const h=fixture(),unrelated={recognitionGeneration:h.state.recognitionGeneration},edit={target:h.graph,targetId:h.graph.id,sourceSignature:h.context.aiWidgetSourceSignature(h.graph)};
  h.change(3);
  assert.equal(h.context.aiInputInvalid(unrelated),false);assert.equal(h.context.aiWidgetEditChanged(edit),true);
  assert.equal(h.state.recognitionGeneration,0);
});

test("saved native v2 graphs gain transaction publishing without altering data or authored surrounding HTML",()=>{
  const old=read("test/fixtures/graph-v2-before-interactions.html").replace("</style>","/* Saved custom appearance */.badge{color:tomato}</style>"),
    upgraded=SMART.upgradeGraphWidgetHtml(old);
  assert.notEqual(upgraded,old);assert.deepEqual(SMART.graphDocumentData(upgraded).data,SMART.graphDocumentData(old).data);
  assert.match(upgraded,/Saved custom appearance/);assert.match(upgraded,/interactionSequence/);assert.match(upgraded,/r\.onpointercancel/);
  assert.equal(SMART.upgradeGraphWidgetHtml(upgraded),upgraded);
  new Function(upgraded.slice(upgraded.indexOf("<script>")+8,upgraded.lastIndexOf("</script>")));
  const custom=old.replace("zoom(Math.exp(-e.deltaY * 0.0015)","zoom(Math.exp(-e.deltaY * 0.002)");
  const customUpgraded=SMART.upgradeGraphWidgetHtml(custom);
  assert.match(customUpgraded,/zoom\(Math\.exp\(-e\.deltaY \* 0\.002\)/,"custom wheel handler is preserved");
  assert.doesNotMatch(customUpgraded,/interactionSequence/,"custom handlers prevent interaction migration");
  assert.match(customUpgraded,/innerWidth < 600/,"the shipped layout still receives the Canvas zoom repair");
});
