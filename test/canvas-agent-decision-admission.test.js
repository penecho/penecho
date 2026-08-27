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

test('PenEcho Agent rejects a multi-tool step before execution and returns bounded corrective feedback',async()=>{
  const admission=await import('../src/server/canvas-agent/decision-admission.mjs'),session=decisionSession(),chunks=await collect(admission.admitCanvasAgentDecisionStream(modelBlocks([
    {type:'tool-call',id:'a',name:'canvas_inspect',arguments:'{"scope":"canvas"}'},
    {type:'tool-call',id:'b',name:'canvas_capture',arguments:'{"target":"canvas","quality":"basic"}'},
  ]),{session,availableTools:['canvas_inspect','canvas_capture']})),calls=chunks.filter(chunk=>chunk.type==='block-end'&&chunk.block?.type==='tool-call').map(chunk=>chunk.block)
  assert.equal(calls.length,1)
  assert.equal(calls[0].name,admission.CANVAS_DECISION_FEEDBACK_TOOL)
  const feedback=await admission.canvasDecisionFeedbackResult(session,{name:calls[0].name,callId:String(calls[0].id)},()=>Promise.reject(new Error('must not delegate')))
  assert.equal(feedback.isError,true)
  assert.equal(feedback.error.info.code,'CANVAS_ONE_TOOL_PER_STEP')
  assert.match(feedback.content[0].text,/returned 2 tool calls[\s\S]*no Canvas tool ran[\s\S]*one corrected standard JSON tool call/)
})

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
  assert.equal(session.protocolRecords[0].code,'CANVAS_ONE_TOOL_PER_STEP')
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
