require('./helpers/safety.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
const section = (start,end) => source.slice(source.indexOf(`  function ${start}(`),source.indexOf(`  function ${end}(`));
test('provider HTTP 400 has an actionable summary without overriding more specific errors',()=>{
 const context={canvasAgentNormalizeError:v=>v,t:key=>key};
 vm.runInNewContext(section('canvasAgentErrorKind','canvasAgentMessageText'),context);
 assert.equal(context.canvasAgentErrorSummary({code:'UNKNOWN',message:'The selected provider returned HTTP 400.'}),'canvasAgentErrorRequestRejected');
 assert.equal(context.canvasAgentErrorKind({code:'400',message:'Bad request'}),'request_rejected');
 assert.equal(context.canvasAgentErrorKind({code:'CONTEXT_LENGTH_EXCEEDED',message:'HTTP 400'}),'request_too_large');
 assert.equal(context.canvasAgentErrorKind({code:'UNKNOWN',message:'Unexpected error'}),'generic');
});
test('errors are recorded once within a transport session and again after session recreation',()=>{
  const items=[{type:'error',eventKey:'turn:1',message:'legacy'}];
  let id=0;
  const context={canvasAgent:{sessionId:'session-a',currentConversation:{items}},
    canvasAgentHistoryText:(value,limit)=>String(value).slice(0,limit),canvasAgentNormalizeError:value=>value,
    canvasClientId:()=>String(++id),CANVAS_AGENT_HISTORY_ITEM_LIMIT:100,canvasAgentNewConversationRecord:()=>({items:[]})};
  vm.runInNewContext(section('canvasAgentErrorRow','canvasAgentRow'),context);
  const failure={code:'UNKNOWN',message:'The selected provider returned HTTP 400.'};
  context.canvasAgentErrorRow(failure,{eventKey:'turn:1'});
  assert.equal(items.length,2);
  context.canvasAgentErrorRow(failure,{eventKey:'turn:1'});
  assert.equal(items.length,2,'the same error of the same turn is recorded once');
  context.canvasAgent.sessionId='session-b';
  context.canvasAgentErrorRow(failure,{eventKey:'turn:1'});
  context.canvasAgentErrorRow(failure,{eventKey:'turn:1'});
  assert.equal(items.length,3);
  context.canvasAgentErrorRow(failure,{eventKey:'turn:2'});
  assert.deepEqual(items.slice(1).map(item=>item.eventKey),['session-a:turn:1','session-b:turn:1','session-b:turn:2']);
});
