const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=file=>fs.readFileSync(require('node:path').join(__dirname,'../src/client/app',file),'utf8');
function fixture(){
  const state={widgets:[],images:[],animations:[],textBoxes:[],textEditors:new Map(),userRevision:1,history:[],future:[],historyBefore:new Map(),widgetHistoryBefore:null,imageHistoryBefore:null,animationHistoryBefore:null,textBoxHistoryBefore:null,nextWidgetId:10,nextImageId:10,nextTextBoxId:10};
  const copied=kind=>state[kind].map(item=>({...item})),effects=[];
  const c={state,canvasAgent:{},tiles:new Map(),MAX_HISTORY:50,window:{},canvasAgentAssertToolExecution(){},canvasAgentToolError:(code,message,details)=>Object.assign(Error(message),{code,details}),
    serializedWidgets:()=>copied('widgets'),imageHistoryState:()=>copied('images'),serializedAnimations:()=>copied('animations'),textBoxHistoryState:()=>copied('textBoxes'),
    updateHistoryButtons(){},widgetRecord:item=>({...item,frame:{}}),imageRecord:item=>({...item}),textBoxHistoryRecord:item=>({...item}),renderedTextBoxRecord:async item=>({...item,image:{}}),
    unmountWidget:item=>effects.push(['unmount',item.id]),mountWidget:item=>effects.push(['mount',item.id]),pluginEnabled:()=>true,clearHandToolbarTarget(){},removeTextEditor:editor=>state.textEditors.delete(editor.id),requestRender(){},
    hasPendingHistoryChanges:()=>Boolean(state.historyBefore.size||state.widgetHistoryBefore||state.imageHistoryBefore||state.animationHistoryBefore||state.textBoxHistoryBefore)};
  vm.createContext(c);
  const history=read('persistence.js'),agent=read('canvas-agent-runtime.js');
  vm.runInContext(history.slice(history.indexOf('  function canvasHistoryChangedObjectIds('),history.indexOf('  function saveUserCanvasChange('))+agent.slice(agent.indexOf('  function canvasAgentMutationState('),agent.indexOf('  function canvasAgentFinite(')),c);
  return {c,state,effects};
}
test('Agent mutation ownership records committed Canvas writes and ignores an empty transaction',()=>{
  const {c,state}=fixture(),readExecution={},writeExecution={};
  c.canvasAgentBeginMutation(readExecution,[])();
  assert.equal(readExecution.canvasWritten,undefined);
  const finish=c.canvasAgentBeginMutation(writeExecution,[]);
  state.textBoxHistoryBefore=[];state.textBoxes.push({id:'text-1',text:'Agent output',image:{}});c.save();finish();
  assert.equal(writeExecution.canvasWritten,true);
});
for(const kind of ['widgets','images'])test(`${kind}: independent Agent changes preserve a pending user edit and its cancellation baseline`,async()=>{
  const {c,state,effects}=fixture(),editKey=kind==='widgets'?'widgetEdit':'imageEdit',historyKey=kind==='widgets'?'widgetHistoryBefore':'imageHistoryBefore';
  const original={id:kind==='widgets'?'widget-1':'image-1',x:10,y:10,w:100,h:100,frame:{}},frame=original.frame;
  state[kind]=[original];state[editKey]={id:original.id,before:{x:10,y:10,w:100,h:100},changed:true};state[historyKey]=[{...original}];original.x=25;
  const restore=c.canvasAgentBeginMutation(null,[]);assert.equal(state[historyKey],null);
  state[historyKey]=state[kind].map(item=>({...item}));state[kind].push({id:kind==='widgets'?'widget-2':'image-2',x:300,y:300,w:100,h:100});
  const entry=c.save();restore();
  assert.equal(state.history.length,1);assert.equal(state[historyKey][0].x,10);assert.equal(state[historyKey].length,2);assert.equal(original.x,25);
  Object.assign(original,state[editKey].before);state[editKey]=null;state[historyKey]=null;
  await c.canvasHistoryRestoreObjects(entry,'before');assert.equal(state[kind].length,1);assert.equal(state[kind][0],original);assert.equal(original.x,10);assert.equal(original.frame,frame);
  await c.canvasHistoryRestoreObjects(entry,'after');assert.equal(state[kind].length,2);assert.equal(state[kind][0],original);assert.ok(!effects.some(([,id])=>id===original.id));
});
test('unchanged selected geometry rebases to Agent result without a no-op history entry',()=>{
  const {c,state}=fixture(),item={id:'image-1',x:10,y:10,w:100,h:100};state.images=[item];state.imageEdit={id:item.id,before:{...item},changed:false};state.imageHistoryBefore=[{...item}];
  const finish=c.canvasAgentBeginMutation(null,[item.id]);state.imageHistoryBefore=[{...item}];item.x=50;c.save();finish();
  assert.equal(state.history.length,1);assert.equal(state.imageEdit.before.x,50);assert.equal(state.imageHistoryBefore,null);assert.equal(state.imageEdit.changed,false);
});
test('text Undo preserves an unrelated live draft and its object identity',async()=>{
  const {c,state}=fixture(),draft={id:1,sourceTextBoxId:'text-box-1',text:'User draft'},source={id:'text-box-1',text:'Original',image:{}};
  state.textEditors.set(1,draft);state.textBoxes=[source];const finish=c.canvasAgentBeginMutation(null,[]);
  state.textBoxHistoryBefore=[{...source}];state.textBoxes.push({id:'text-box-2',text:'Agent output',image:{}});const entry=c.save();finish();
  await c.canvasHistoryRestoreObjects(entry,'before');assert.equal(state.textEditors.get(1),draft);assert.equal(state.textBoxes[0],source);
});
test('commit-time object check rejects a newly opened source editor without consuming history',()=>{
  const {c,state}=fixture();state.textBoxes=[{id:'text-box-1',text:'Source'}];const history=state.history;
  state.textEditors.set(1,{id:1,sourceTextBoxId:'text-box-1'});
  assert.throws(()=>c.canvasAgentBeginMutation(null,['text-box-1']),{code:'OBJECT_EDIT_CONFLICT'});assert.equal(state.history,history);assert.equal(state.agentMutationHistory,undefined);
});
test('an unfinished animation edit retains its pending snapshot across an unrelated Agent write',()=>{
  const {c,state}=fixture(),animation={id:'animation-1',x:10,y:10,w:100,h:100};
  state.animations=[animation];state.animationEdit={id:animation.id,before:{...animation},changed:true};state.animationHistoryBefore=[{...animation}];animation.x=30;
  const pending=state.animationHistoryBefore,finish=c.canvasAgentBeginMutation(null,[]);
  state.textBoxHistoryBefore=[];state.textBoxes.push({id:'text-box-1',text:'Agent output',image:{}});const entry=c.save();finish();
  assert.equal(state.animationHistoryBefore,pending);assert.equal(animation.x,30);assert.equal(state.animationEdit.before.x,10);assert.equal(entry.animationsBefore,null);assert.equal(entry.animationsAfter,null);
});
