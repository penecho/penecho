const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  const source=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
  const context={state:{textEditors:new Map(),widgets:[],images:[],animations:[]},canvasAgent:{},canvasAgentAssertToolExecution:()=>{},canvasAgentToolError:(code,message,details)=>Object.assign(Error(message),{code,details})};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function canvasAgentMutationState('),source.indexOf('  function canvasAgentFinite(')),context);
  return context;
}
test('derived Widget execution permits creation but protects source geometry and deletion',()=>{
  const c=fixture(),source={id:'original'},execution={assistContext:{owner:{inputTarget:{widget:source,variant:{}}}}};
  c.canvasAgentMutationIdle(execution,[]);c.canvasAgentMutationIdle(execution,['new-widget']);
  assert.throws(()=>c.canvasAgentMutationIdle(execution,['original']),{code:'READ_ONLY_SOURCE'});
  c.canvasAgentMutationIdle({},['original']);
});
test('passive lasso retains identity and permits writes, while extracted ink and active gestures remain protected',()=>{
  const c=fixture(),selection=c.state.selection={regionOnly:true,phase:'active',fragments:[],beforeTiles:new Map()};
  c.canvasAgentMutationIdle();assert.equal(c.state.selection,selection);
  for(const [property,value,reason,transient] of [
    ['selection',{fragments:[{}],beforeTiles:new Map([['tile',{}]])},'selection-edit',false],
    ['selection',{phase:'lasso',path:[]},'selection-gesture',true],
    ['selectionGesture',{kind:'move'},'selection-gesture',true],['drawing',{},'drawing',true],
  ]){
    const before=c.state[property];c.state[property]=value;
    assert.throws(()=>c.canvasAgentMutationIdle(),e=>e.code==='CANVAS_BUSY'&&e.details.mutationState.blockers.includes(reason)&&e.details.mutationState.transient===transient);
    assert.equal(c.state[property],value);c.state[property]=before;c.canvasAgentMutationIdle();
  }
});
test('mutation epochs track blockers independently of content and viewport revisions',()=>{
  const c=fixture(),idle=c.canvasAgentMutationState();
  c.state.panX=900;c.state.scale=2;c.state.userRevision=55;
  assert.equal(c.canvasAgentMutationState().revision,idle.revision);
  c.state.drawing={};const active=c.canvasAgentMutationState();assert.ok(active.revision>idle.revision);
  c.state.textEditors.set(1,{sourceTextBoxId:'text-box-1'});const draft=c.canvasAgentMutationState();assert.equal(draft.objectLocks[0].objectId,'text-box-1');assert.equal(draft.transient,true);assert.ok(draft.revision>active.revision);
  c.state.drawing=null;c.state.textEditors.clear();const end=c.canvasAgentMutationState();assert.ok(end.revision>draft.revision);assert.equal(end.blockers.length,0);assert.equal(c.state.userRevision,55);
});

test('idle selections and new text drafts permit writes; dirty edits lock only their own objects',()=>{
  const c=fixture();c.state.imageImporting=true;c.state.textEditors.set(1,{});c.canvasAgentMutationIdle();
  for(const kind of ['widget','image','animation']){
    const item={id:kind+'-1',x:10,y:20,w:100,h:100};c.state[kind+'s']=[item];
    c.state[kind+'Edit']={id:item.id,before:{...item},changed:false};c.canvasAgentMutationIdle(null,[item.id]);
    item.x=50;c.canvasAgentMutationIdle(null,['another-object']);
    assert.throws(()=>c.canvasAgentMutationIdle(null,[item.id]),e=>e.code==='OBJECT_EDIT_CONFLICT'&&e.details.objectLocks[0].objectId===item.id);
    c.state[kind+'Edit']=null;
  }
  c.state.textEditors.set(2,{sourceTextBoxId:'text-box-1'});c.canvasAgentMutationIdle(null,['text-box-2']);
  assert.throws(()=>c.canvasAgentMutationIdle(null,['text-box-1']),{code:'OBJECT_EDIT_CONFLICT'});
});
