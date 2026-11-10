const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
const section = (start,end) => source.slice(source.indexOf(`  function ${start}(`),source.indexOf(`  function ${end}(`));
test('errors deduplicate within a transport session but remain visible after session recreation',()=>{
  const rows=[], items=[{type:'error',eventKey:'turn:1',message:'legacy'}];
  let id=0;
  const context={canvasAgent:{sessionId:'session-a',currentConversation:{items},viewingHistoryId:null},
    canvasAgentHistoryText:(value,limit)=>String(value).slice(0,limit),canvasAgentNormalizeError:value=>value,
    canvasClientId:()=>String(++id),CANVAS_AGENT_HISTORY_ITEM_LIMIT:100,
    canvasAgentTranscript:{querySelectorAll:()=>rows},
    canvasAgentAppendErrorElement:item=>{const target={historyItem:item};rows.push({_canvasAgentErrorTarget:target});return target;},
    canvasAgentScheduleHistoryPersist(){},canvasAgentScrollToLatest(){},canvasAgentSyncInputHint(){}};
  vm.runInNewContext(section('canvasAgentErrorRow','canvasAgentAppendMessageElement'),context);
  const failure={code:'UNKNOWN',message:'The selected provider returned HTTP 400.'};
  const first=context.canvasAgentErrorRow(failure,{eventKey:'turn:1'});
  assert.equal(items.length,2);
  assert.equal(context.canvasAgentErrorRow(failure,{eventKey:'turn:1'}),first);
  context.canvasAgent.sessionId='session-b';
  const second=context.canvasAgentErrorRow(failure,{eventKey:'turn:1'});
  assert.notEqual(second,first);assert.equal(items.length,3);assert.equal(rows.length,2);
  assert.equal(context.canvasAgentErrorRow(failure,{eventKey:'turn:1'}),second);
  context.canvasAgentErrorRow(failure,{eventKey:'turn:2'});assert.equal(items.length,4);
});
test('provider HTTP 400 has an actionable summary without overriding more specific errors',()=>{
 const context={canvasAgentNormalizeError:v=>v,t:key=>key};
 vm.runInNewContext(section('canvasAgentErrorKind','canvasAgentMessageText'),context);
 assert.equal(context.canvasAgentErrorSummary({code:'UNKNOWN',message:'The selected provider returned HTTP 400.'}),'canvasAgentErrorRequestRejected');
 assert.equal(context.canvasAgentErrorKind({code:'400',message:'Bad request'}),'request_rejected');
 assert.equal(context.canvasAgentErrorKind({code:'CONTEXT_LENGTH_EXCEEDED',message:'HTTP 400'}),'request_too_large');
 assert.equal(context.canvasAgentErrorKind({code:'UNKNOWN',message:'Unexpected error'}),'generic');
});
