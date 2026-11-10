const test=require('node:test'),assert=require('node:assert/strict')

test('Harness freezes every new message graph but skips rewalking identities it already proved',async()=>{
  const {ReactLoopAgent}=await import('../src/server/canvas-agent/vendor/dsh-agent-loop.mjs')
  const {isAgentLoopRequest}=await import('@deepseek-ai/dsh-llm')
  let header,context,reads=0
  const session={id:'freeze-test',requestHeader:()=>header,requestContext:()=>context,
    append(type,data){if(type==='request/header')header=data.header;else if(type==='request/context')context=data}}
  const owner={session,id:'freeze-test',options:{provider:'test',model:'model'},frozenMessages:new WeakSet(),requestHeaderLogged:false,
    dispatch:{waterfall:(_name,_event,next)=>next()},loopCtx:{llm:{prepareCall:async config=>({config,adapterDefaults:{}})}}}
  const content=[{type:'text',text:'original'}],message={role:'user',get content(){reads++;return content}}
  Object.freeze(message) // A shallow freeze must NOT skip its mutable children.
  const controller=new AbortController(),tools=[{name:'test',parameters:{type:'object'}}]
  const first=(await ReactLoopAgent.prototype.buildRequest.call(owner,1,1,tools,[],[message],controller.signal)).request
  const afterFirst=reads
  assert.equal(Object.isFrozen(content),true);assert.equal(Object.isFrozen(content[0]),true)
  assert.equal(Object.isFrozen(tools[0].parameters),true);assert.equal(isAgentLoopRequest(first),true)
  const second=(await ReactLoopAgent.prototype.buildRequest.call(owner,1,2,[],[],[message],controller.signal)).request
  assert.equal(reads,afterFirst,'unchanged proven messages must not be recursively traversed again')
  assert.equal(second.messages[0],message)
  const replacement={role:'user',content:[{type:'text',text:'replacement'}]}
  await ReactLoopAgent.prototype.buildRequest.call(owner,1,3,[],[],[replacement],controller.signal)
  assert.equal(Object.isFrozen(replacement.content[0]),true)
  controller.abort();assert.equal(first.signal.aborted,true,'the signal must remain live')
})

test('Anthropic alias replay retains source identity and the resolved provider model',async()=>{
  const {toPiReplayState,replayedAssistant,toStreamChunks}=await import('../src/server/canvas-agent/vendor/dsh-llm-pi-ai.mjs')
  const native={api:'anthropic-messages',provider:'anthropic',model:'resolved-model',content:[{type:'thinking',thinking:'test fixture',thinkingSignature:'signature'}],stopReason:'stop',usage:{input:1,output:1,totalTokens:2,cost:{input:0,output:0,total:0}}}
  const replay=toPiReplayState(native,'requested-alias')
  assert.equal(replay.response.model,'requested-alias');assert.equal(replay.response.responseModel,'resolved-model')
  const message={content:[{type:'reasoning',text:'test fixture'}]},source={provider:'anthropic',model:'requested-alias'}
  const restored=replayedAssistant(message,source,replay)
  assert.equal(restored.model,'resolved-model');assert.equal(restored.content[0].thinkingSignature,'signature')
  async function* events(){yield{type:'done',message:native}}
  const chunks=[];for await(const chunk of toStreamChunks(events(),10000,'requested-alias'))chunks.push(chunk)
  assert.equal(chunks.at(-1).replayState.response.model,'requested-alias')
  const completions=toPiReplayState({...native,api:'openai-completions',model:'requested-alias',responseModel:'informational-model'},'requested-alias')
  assert.equal(replayedAssistant(message,source,completions).model,'requested-alias')
})

test('metadata audit does not label native whole-turn spans as pure model generation',()=>{
  const {summarize}=require('../scripts/audit-canvas-agent-performance.cjs')
  const result=summarize({kind:'canvas-conversation-turn',events:[{type:'turn/start',data:{engine:'codex-native'}},{type:'tool/result',data:{error:{message:'failure'}}}],steps:[{response:{usage:{last:{outputTokens:12},total:{outputTokens:123456}}}}]})
  assert.equal(result.engine,'codex-native');assert.equal(result.outputTokens,null);assert.equal(result.toolErrors,1)
})
