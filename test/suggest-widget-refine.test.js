"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), vm=require("node:vm");
const SMART=require("../public/smart-suggest.js");
const source=fs.readFileSync(require.resolve("../src/client/app/smart-suggestions.js"),"utf8");
function functionSource(name) {
  const start=source.indexOf(`  function ${name}(`);
  return source.slice(start,source.indexOf("\n  }",start)+4);
}
function runtime() {
  const record={id:1,points:[{x:150,y:150},{x:180,y:180}],box:{x:150,y:150,w:30,h:30},size:4,historyEntry:{}},
    widget={id:"first",title:"Chart",shell:{},x:100,y:100,w:200,h:200}, calls=[],
    state={widgets:[widget],history:[record.historyEntry],dirty:record.box};
  let doc="canvas";
  const context=vm.createContext({SMART_SUGGEST:SMART,smartSuggest:{consumedStrokeId:0},state,
    canvasDocumentsCurrent:()=>({id:doc}),widgetBox:w=>w,assistUnion:(a,b)=>a||b,
    hideAssist:reason=>calls.push(reason),clearPenGesture(){},cancelPenRasterDeletion(){},dismissPenGestureOffer(){},dismissWidgetInkRefineOffer(){},
    requestWidgetRefinement:(w,mode,options)=>{calls.push({widget:w.id,mode,options});return true;}});
  vm.runInContext(["assistWidgetRefineTarget","assistWidgetRefineTargetValid","executeAssistWidgetRefinement"].map(functionSource).join("\n"),context);
  return {context,state,record,widget,calls,setDocument:id=>doc=id};
}
test("Refine targets the newest marked Widget, with the topmost Widget winning overlaps",()=>{
  const h=runtime(), c=h.context;
  const top={...h.widget,id:"top"};h.state.widgets.push(top);
  assert.equal(c.assistWidgetRefineTarget({strokes:[h.record]}).widget,top);
  top.pending=true;
  assert.equal(c.assistWidgetRefineTarget({strokes:[h.record]}).widget,h.widget);
  const second={...h.widget,id:"second",x:400};h.state.widgets.push(second);
  const newer={...h.record,id:2,points:[{x:450,y:150}],historyEntry:{}};h.state.history.push(newer.historyEntry);
  assert.equal(c.assistWidgetRefineTarget({strokes:[h.record,newer]}).widget,second);
  for(const flag of ["selection","result","followUp"])assert.equal(c.assistWidgetRefineTarget({strokes:[h.record],[flag]:true}),null);
});
test("the Suggest action directly requests Widget replacement without consuming annotations",async()=>{
  const h=runtime(), c=h.context, target=c.assistWidgetRefineTarget({strokes:[h.record]});
  const start=source.indexOf("  async function executeAssistAction("),end=source.indexOf("\n  // Kept for callers",start);
  vm.runInContext(source.slice(start,end),c);
  await c.executeAssistAction({id:"refine"},{widgetRefine:target});
  assert.equal(h.calls[1].widget,h.widget.id);
  assert.equal(h.calls[1].mode,"nearby-dirty");
  assert.equal(h.calls[1].options.actionId,"apply_marks");
  assert.equal(c.smartSuggest.consumedStrokeId,0);
  assert.equal(h.state.dirty,h.record.box);
});
test("Undo, switching Canvas, consuming ink, moving or deleting Widgets invalidate Refine taps",()=>{
  for(const invalidate of [h=>h.state.history=[],h=>h.setDocument("other"),h=>h.record.inputConsumed=true,
    h=>h.context.smartSuggest.consumedStrokeId=1,h=>h.widget.x=900,h=>h.state.widgets=[],h=>h.state.dirty=null,
    h=>h.widget.hiddenForReplacement=true,h=>h.state.pending={},h=>h.state.drawing={}]) {
    const h=runtime(), target=h.context.assistWidgetRefineTarget({strokes:[h.record]});invalidate(h);
    assert.equal(h.context.executeAssistWidgetRefinement(target),false);
    assert.deepEqual(h.calls,[]);
  }
});
