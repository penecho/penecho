'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

for (const hostName of ['CodexNativeHost', 'CanvasHarnessHost']) {
  async function fixture(respond) {
    const runtime = await import('../src/server/canvas-agent/runtime.mjs');
    const native = await import('../src/server/canvas-agent/codex-native-host.mjs');
    const {createDocumentTools} = await import('../src/server/canvas-agent/document-tools.mjs');
    const host = Object.create((native[hostName] || runtime[hostName]).prototype);
    const session = {id:'test',logicalConversationId:'test',pending:new Map(),ignoredToolResultIds:new Set()};
    let counter = 0;
    session.rpc = async (name, args) => {
      const requestId = String(++counter);
      return new Promise((resolve, reject) => {
        session.pending.set(requestId,{resolve,reject});
        host.resolveToolResult(session,{requestId,...respond(args.operation)});
      });
    };
    return {session,tools:createDocumentTools(session)};
  }
  test(`${hostName} browser capture error reaches bound document recovery as structured data`, async () => {
    for (const code of ['WIDGET_READY_TIMEOUT','WIDGET_CAPTURE_TIMEOUT','CANVAS_NOT_VISIBLE','canvas_timeout']) {
      const {tools} = await fixture(op => {
        assert.equal(op,'mcp_present_widget');
        return {ok:true,result:{artifactId:'chart',objectId:'widget',revision:9,captureFailure:{code,message:'Capture unavailable',details:{stage:'ready'}}}};
      });
      const result = await tools.find(t=>t.name==='penecho_present_widget').execute({requestId:'chart-create',artifactId:'chart',title:'Chart',html:'<p>Chart</p>',capture:true},{callId:'1',signal:new AbortController().signal});
      assert.equal(result.applied,true);
      assert.equal(result.pixelVerified,false);
      assert.equal(result.revision,9);
      assert.equal(result.captureFailure.code,code);
    }
  });
  test(`${hostName} retains ordinary errors and never recovers an aborted capture`, async () => {
    const {session} = await fixture(()=>({ok:false,error:{code:'SOURCE_CONFLICT',message:'Changed',details:{revision:2}}}));
    await assert.rejects(session.rpc('canvas_document',{}),error=>error.code==='SOURCE_CONFLICT'&&error.message==='Changed'&&error.details.revision===2);
    const legacy = await fixture(()=>({ok:false,error:'Plain failure'}));
    await assert.rejects(legacy.session.rpc('canvas_document',{}),{message:'Plain failure'});
    const controller = new AbortController();
    const {tools} = await fixture(op=>{
      assert.equal(op,'mcp_present_widget');
      controller.abort();
      return {ok:false,error:{code:'WIDGET_READY_TIMEOUT',message:'Cancelled capture'}};
    });
    await assert.rejects(tools.find(t=>t.name==='penecho_present_widget').execute({requestId:'chart-create',artifactId:'chart',title:'Chart',html:'<p>Chart</p>',capture:true},{callId:'1',signal:controller.signal}),{code:'WIDGET_READY_TIMEOUT',message:'Cancelled capture'});
  });
}

test('browser error diagnostics are bounded and an already aborted RPC is never sent', async () => {
  const {canvasBrowserToolError,CanvasHarnessHost} = await import('../src/server/canvas-agent/runtime.mjs');
  const {CodexNativeHost} = await import('../src/server/canvas-agent/codex-native-host.mjs');
  const details={text:'x'.repeat(40_000)};details.circular=details;
  const error=canvasBrowserToolError({code:'C'.repeat(200),message:'m'.repeat(4_000),details});
  assert.ok(error.code.length<=150);
  assert.ok(error.message.length<2_100);
  assert.ok(JSON.stringify(error.details).length<20_000);
  for(const Host of [CanvasHarnessHost,CodexNativeHost]) {
    const host=Object.create(Host.prototype),controller=new AbortController(),reason=new Error('Stop');
    controller.abort(reason);
    host.send=()=>assert.fail('Aborted request was sent');
    await assert.rejects(host.callBrowserTool({connected:true},'canvas_document',{},'1',controller.signal),value=>value===reason);
  }
});
