const test = require('node:test')
const assert = require('node:assert/strict')

function decisionSession(){
  return{
    decisionFeedbackCalls:new Map(),
    decisionFeedbackCallIds:new Set(),
    protocolRecords:[],
    traceDecisionProtocol(record){this.protocolRecords.push(record)},
  }
}

async function collect(stream){
  const chunks=[]
  for await(const chunk of stream)chunks.push(chunk)
  return chunks
}

async function* modelBlocks(blocks,{finishKind='tool-calls',replayState=null}={}){
  for(let index=0;index<blocks.length;index++){
    const block=blocks[index]
    yield{type:'block-start',index,blockType:block.type}
    if(block.type==='tool-call')yield{type:'tool-call-delta',index,id:block.id,name:block.name,argumentsDelta:block.arguments}
    else yield{type:'text-delta',index,text:block.text}
    yield{type:'block-end',index,block}
  }
  yield{type:'finish',reason:{kind:finishKind},...(replayState?{replayState}:{})}
}

test('public progress streams before provider completion while tool admission stays atomic',async()=>{
  const {admitCanvasAgentDecisionStream,CANVAS_DECISION_FEEDBACK_TOOL}=await import('../src/server/canvas-agent/decision-admission.mjs')
  let release,providerCompleted=false
  const gate=new Promise(resolve=>{release=resolve}),session=decisionSession(),progress={type:'text',text:'Progress: checking the current structure.\n'}
  async function* upstream(){
    yield{type:'block-start',index:0,blockType:'text'}
    yield{type:'text-delta',index:0,text:progress.text}
    yield{type:'block-end',index:0,block:progress}
    await gate
    for(let index=1;index<=2;index++){
      const block={type:'tool-call',id:`call-${index}`,name:'canvas_inspect',arguments:'{}'}
      yield{type:'block-start',index,blockType:'tool-call'}
      yield{type:'tool-call-delta',index,id:block.id,name:block.name,argumentsDelta:block.arguments}
      yield{type:'block-end',index,block}
    }
    providerCompleted=true
    yield{type:'finish',reason:{kind:'tool-calls'}}
  }
  const stream=admitCanvasAgentDecisionStream(upstream(),{session,availableTools:['canvas_inspect']}),chunks=[]
  // The timeout releases the producer too, so a buffering regression fails
  // promptly rather than leaving the test runner waiting on an unresolved gate.
  const deadline=setTimeout(release,1000)
  try{
    for(let count=0;count<3;count++)chunks.push((await stream.next()).value)
    assert.equal(providerCompleted,false,'progress must arrive while generation is still pending')
    assert.deepEqual(chunks.map(chunk=>chunk.type),['block-start','text-delta','block-end'])
    release()
    for await(const chunk of stream)chunks.push(chunk)
    assert.equal(chunks.filter(chunk=>chunk.type==='text-delta').length,1,'do not replay streamed commentary')
    const calls=chunks.filter(chunk=>chunk.type==='block-end'&&chunk.block?.type==='tool-call')
    assert.equal(calls.length,2)
    assert.equal(calls.every(call=>call.block.name==='canvas_inspect'),true,'release the validated batch only after provider completion')
  }finally{clearTimeout(deadline);release();await stream.return()}
})

test('closing a progress stream closes its upstream before any tool executes',async()=>{
  const {admitCanvasAgentDecisionStream}=await import('../src/server/canvas-agent/decision-admission.mjs')
  let closed=false,toolReached=false
  async function* upstream(){
    try{
      yield{type:'block-start',index:0,blockType:'text'}
      yield{type:'text-delta',index:0,text:'Progress: checking.'}
      toolReached=true
      yield{type:'block-start',index:1,blockType:'tool-call'}
    }finally{closed=true}
  }
  const stream=admitCanvasAgentDecisionStream(upstream(),{session:decisionSession()})
  await stream.next();await stream.next();await stream.return()
  assert.equal(closed,true)
  assert.equal(toolReached,false)
})

test('PenEcho Agent admits a known tool batch without an extra model round',async()=>{
  const admission=await import('../src/server/canvas-agent/decision-admission.mjs'),session=decisionSession();
  const blocks=[{type:'tool-call',id:'a',name:'canvas_inspect',arguments:'{}'}, {type:'tool-call',id:'b',name:'canvas_capture',arguments:'{}'}];
  const chunks=await collect(admission.admitCanvasAgentDecisionStream(modelBlocks(blocks),{session,availableTools:['canvas_inspect','canvas_capture']}));
  assert.deepEqual(chunks.filter(c=>c.type==='block-end').map(c=>c.block),blocks);
  assert.equal(session.protocolRecords.length,0);
});

test('PenEcho Agent passes a large standard JSON tool call unchanged and preserves exact HTML after one parse',async()=>{
  const admission=await import('../src/server/canvas-agent/decision-admission.mjs'),session=decisionSession(),html=`<!doctype html>\n<style>.quote::after{content:'"\\\\';}</style>\n<script>const path="C:\\\\tmp\\\\widget";</script>\n<main>${'long-source-line\n'.repeat(500)}</main>`,
    args={baseRevision:0,items:[{type:'widget',pluginId:'general',widgetType:'html_widget',title:'Standard JSON',html,width:900,height:600,placement:{mode:'auto'}}]},block={type:'tool-call',id:'large-json',name:'canvas_create',arguments:JSON.stringify(args)},replayState={response:{id:'provider-response'}},
    chunks=await collect(admission.admitCanvasAgentDecisionStream(modelBlocks([block],{replayState}),{session,availableTools:['canvas_create']})),passed=chunks.find(chunk=>chunk.type==='block-end')?.block
  assert.equal(passed,block)
  assert.equal(JSON.parse(passed.arguments).items[0].html,html)
  assert.equal(Buffer.byteLength(html,'utf8')>4096,true)
  assert.deepEqual(chunks.at(-1).replayState,replayState)
  assert.equal(session.protocolRecords.length,0)
})

test('PenEcho Agent rejects invalid or unavailable standard JSON tool calls without execution',async()=>{
  const admission=await import('../src/server/canvas-agent/decision-admission.mjs')
  for(const [block,code] of [
    [{type:'tool-call',id:'bad-json',name:'canvas_create',arguments:'{"items":[{"html":"<div class="broken">"}]}'},'CANVAS_TOOL_ARGUMENTS_INVALID'],
    [{type:'tool-call',id:'bad-tool',name:'run_bash',arguments:'{}'},'CANVAS_TOOL_UNAVAILABLE'],
  ]){
    const session=decisionSession(),result=admission.admitCanvasDecision({session,blocks:[block],availableTools:['canvas_create']})
    assert.equal(result.kind,'feedback')
    assert.equal(session.decisionFeedbackCalls.get(String(result.block.id)).code,code)
  }
})

test('PenEcho Agent validates a multi-tool decision atomically before exposing any call',async()=>{
  const admission=await import('../src/server/canvas-agent/decision-admission.mjs'),session=decisionSession(),blocks=[
    {type:'tool-call',id:'valid-first',name:'canvas_inspect',arguments:'{"scope":"canvas"}'},
    {type:'tool-call',id:'invalid-second',name:'canvas_capture',arguments:'{"target":"canvas"'},
  ],chunks=await collect(admission.admitCanvasAgentDecisionStream(modelBlocks(blocks),{session,availableTools:['canvas_inspect','canvas_capture']})),calls=chunks.filter(chunk=>chunk.type==='block-end'&&chunk.block?.type==='tool-call').map(chunk=>chunk.block)
  assert.equal(calls.length,1)
  assert.equal(calls[0].name,admission.CANVAS_DECISION_FEEDBACK_TOOL)
  assert.equal(session.protocolRecords[0].code,'CANVAS_TOOL_ARGUMENTS_INVALID')
})

test('PenEcho Agent leaves final text and one valid tool stream unchanged',async()=>{
  const admission=await import('../src/server/canvas-agent/decision-admission.mjs'),session=decisionSession(),finalReplay={response:{id:'final'}},finalChunks=await collect(admission.admitCanvasAgentDecisionStream(modelBlocks([{type:'text',text:'Finished.'}],{finishKind:'stop',replayState:finalReplay}),{session,availableTools:[]}))
  assert.equal(finalChunks.find(chunk=>chunk.type==='text-delta').text,'Finished.')
  assert.deepEqual(finalChunks.at(-1).replayState,finalReplay)
  const tool={type:'tool-call',id:'inspect',name:'canvas_inspect',arguments:'{"scope":"canvas"}'},toolChunks=await collect(admission.admitCanvasAgentDecisionStream(modelBlocks([tool]),{session,availableTools:['canvas_inspect']}))
  assert.equal(toolChunks.find(chunk=>chunk.type==='block-end').block,tool)
})

test('PenEcho Agent rejects a token-truncated tool decision and continues through feedback',async()=>{
  const admission=await import('../src/server/canvas-agent/decision-admission.mjs'),session=decisionSession(),chunks=await collect(admission.admitCanvasAgentDecisionStream(modelBlocks([
    {type:'tool-call',id:'truncated',name:'canvas_create',arguments:'{"baseRevision":0}'},
  ],{finishKind:'max-tokens'}),{session,availableTools:['canvas_create']})),call=chunks.filter(chunk=>chunk.type==='block-end'&&chunk.block?.type==='tool-call').at(-1)?.block
  assert.equal(call.name,admission.CANVAS_DECISION_FEEDBACK_TOOL)
  assert.equal(session.decisionFeedbackCalls.get(String(call.id)).code,'CANVAS_TOOL_DECISION_INCOMPLETE')
})

test('batch admission rejects duplicate call identities and bounded-size overflow',async()=>{
  const admission=await import('../src/server/canvas-agent/decision-admission.mjs')
  for(const [blocks,code] of [
    [[{type:'tool-call',id:'same',name:'canvas_read',arguments:'{}'},{type:'tool-call',id:'same',name:'canvas_read',arguments:'{}'}],'CANVAS_TOOL_CALL_ID_INVALID'],
    [Array.from({length:17},(_,i)=>({type:'tool-call',id:String(i),name:'canvas_read',arguments:'{}'})),'CANVAS_TOOL_BATCH_LIMIT'],
  ]){
    const session=decisionSession(),result=admission.admitCanvasDecision({session,blocks,availableTools:['canvas_read']})
    assert.equal(result.kind,'feedback');assert.equal(session.protocolRecords[0].code,code)
  }
})
