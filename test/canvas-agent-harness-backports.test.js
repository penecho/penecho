require('./helpers/safety.js');
const test=require('node:test'),assert=require('node:assert/strict')

test('Harness freezes every new message graph but skips rewalking identities it already proved',async()=>{
  const {ReactLoopAgent}=await import('../src/server/canvas-agent/vendor/dsh-agent-loop.mjs')
  const {isAgentLoopRequest}=await import('@deepseek-ai/dsh-llm')
  let header,context,reads=0,messages=[],seq=0
  const session={id:'freeze-test',surface:{contentGeneration:0},requestHeader:()=>header,requestContext:()=>context,
    deriveMessages:()=>[...messages],toolHistory:()=>[],
    append(type,data){if(type==='request/header')header=data.header;else if(type==='request/context')context=data;return{seq:seq++}}}
  const owner={session,id:'freeze-test',frozenMessages:new WeakSet(),requestHeaderLogged:false}
  const content=[{type:'text',text:'original'}],message={role:'user',get content(){reads++;return content}}
  Object.freeze(message) // A shallow freeze must NOT skip its mutable children.
  const controller=new AbortController(),tools=[{name:'test',parameters:{type:'object'}}]
  messages=[message]
  const build=(step,visibleTools)=>ReactLoopAgent.prototype.buildRequest.call(owner,{provider:'test',model:'model'},undefined,visibleTools,{turn:1,step},false,controller.signal)
  const first=build(1,tools)
  const afterFirst=reads
  assert.equal(Object.isFrozen(content),true);assert.equal(Object.isFrozen(content[0]),true)
  assert.equal(Object.isFrozen(tools[0].parameters),true);assert.equal(isAgentLoopRequest(first),true)
  const second=build(2,[])
  assert.equal(reads,afterFirst,'unchanged proven messages must not be recursively traversed again')
  assert.equal(second.messages[0],message)
  const replacement={role:'user',content:[{type:'text',text:'replacement'}]}
  messages=[replacement]
  build(3,[])
  assert.equal(Object.isFrozen(replacement.content[0]),true)
  controller.abort();assert.equal(first.signal.aborted,true,'the signal must remain live')
})

test('Anthropic alias replay retains source identity and the resolved provider model',async()=>{
  const {toPiReplayState,replayedAssistant,toStreamChunks}=await import('../src/server/canvas-agent/vendor/dsh-llm-pi-ai.mjs')
  const native={api:'anthropic-messages',provider:'anthropic',model:'requested-alias',responseModel:'resolved-model',content:[{type:'thinking',thinking:'test fixture',thinkingSignature:'signature'}],stopReason:'stop',usage:{input:1,output:1,totalTokens:2,cost:{input:0,output:0,total:0}}}
  const replay=toPiReplayState(native,'requested-alias')
  assert.equal(replay.response.model,'requested-alias');assert.equal(replay.response.responseModel,'resolved-model')
  const message={content:[{type:'reasoning',text:'test fixture'}]},source={provider:'anthropic',model:'requested-alias'}
  const restored=replayedAssistant(message,source,replay)
  assert.equal(restored.model,'requested-alias');assert.equal(restored.responseModel,'resolved-model');assert.equal(restored.content[0].thinkingSignature,'signature')
  const path=require('node:path'),{pathToFileURL}=require('node:url')
  const piRoot=path.resolve(path.dirname(require.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json')),'../../@earendil-works/pi-ai')
  const {transformMessages}=await import(pathToFileURL(path.join(piRoot,'dist/api/transform-messages.js')))
  const model={id:'requested-alias',api:'anthropic-messages',provider:'anthropic',input:['text']}
  assert.equal(transformMessages([restored],model)[0].content[0].thinkingSignature,'signature')
  assert.deepEqual(transformMessages([restored],{...model,id:'another-model'})[0].content,[])
  async function* events(){yield{type:'done',message:native}}
  const chunks=[];for await(const chunk of toStreamChunks(events(),10000,undefined,'requested-alias'))chunks.push(chunk)
  assert.equal(chunks.at(-1).replayState.response.model,'requested-alias')
  const completions=toPiReplayState({...native,api:'openai-completions',model:'requested-alias',responseModel:'informational-model'},'requested-alias')
  assert.equal(replayedAssistant(message,source,completions).model,'requested-alias')
})

test('metadata audit does not label native whole-turn spans as pure model generation',()=>{
  const {summarize}=require('../scripts/audit-canvas-agent-performance.cjs')
  const result=summarize({kind:'canvas-conversation-turn',events:[{type:'turn/start',data:{engine:'codex-native'}},{type:'tool/result',data:{error:{message:'failure'}}}],steps:[{response:{usage:{last:{outputTokens:12},total:{outputTokens:123456}}}}]})
  assert.equal(result.engine,'codex-native');assert.equal(result.outputTokens,null);assert.equal(result.toolErrors,1)
})
