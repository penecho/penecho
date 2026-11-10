const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const ROOT=path.resolve(__dirname,'..'),{CODEX_CLI_PINNED_VERSION}=require('../src/providers/cli-installer.js')
const error={code:'CANVAS_BUSY',message:'A text draft is active.',details:{mutationGuard:'canvas-edit',retry:'after_state_change',mutationState:{revision:4,blockers:['text-draft'],transient:false}}}
const waitFor=async predicate=>{const end=Date.now()+5000;while(!predicate()){if(Date.now()>end)throw Error('Busy-stop integration timed out.');await new Promise(resolve=>setTimeout(resolve,10))}}

test('Harness concludes a repeated busy turn after three model decisions and reports blocked, preserving the conversation',async t=>{
  const {CanvasHarnessHost}=await import('../src/server/canvas-agent/runtime.mjs'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-busy-harness-')),
    connection={id:'busy-cli',provider:'claude-cli',name:'Busy fixture',cliPath:'never-launched',cliModel:'test-model',effort:'medium'},frames=[]
  let session,requests=0,browserWrites=0,continued=false
  const host=new CanvasHarnessHost({stateDirectory:directory,rootDirectory:ROOT,resolveConnection:()=>connection,listConnections:()=>[connection],callCli:async()=>{
    requests++
    if(continued)return JSON.stringify({type:'final',text:'Continued successfully.'})
    assert.ok(requests<=3,'concludeTurn prevents another model request')
    return JSON.stringify({type:'tool_call',name:'penecho_edit_canvas',arguments:{requestId:`write-${requests}`,action:'create_text',text:'Must not appear'}})
  }})
  t.after(async()=>{await host.dispose();fs.rmSync(directory,{recursive:true,force:true})})
  session=await host.connect({clientId:'busy-fixture',connectionId:connection.id,binding:{},send(type,payload){
    frames.push({type,payload})
    if(type==='tool_request'){
      assert.equal(payload.arguments.operation,'mcp_edit_canvas');browserWrites++
      queueMicrotask(()=>host.resolveToolResult(session,{requestId:payload.requestId,ok:false,error}))
    }
  }})
  host.updateState(session,{revision:10,canvas:{width:20000,height:20000},objects:[],mutationState:{revision:3,blockers:[],transient:false}})
  await host.submit(session,'Create an answer.')
  await waitFor(()=>frames.some(frame=>frame.type==='session_event'&&frame.payload.kind==='turn_end'))
  assert.equal(requests,3);assert.equal(browserWrites,1)
  const end=frames.findLast(frame=>frame.payload.kind==='turn_end'),lastResult=frames.findLast(frame=>frame.payload.kind==='tool_result')
  assert.equal(end.payload.reason.kind,'blocked');assert.equal(end.payload.reason.error.code,'CANVAS_BUSY')
  assert.equal(lastResult.payload.error.code,'CANVAS_BUSY');assert.deepEqual(lastResult.payload.error.details.mutationState.blockers,['text-draft'])
  assert.equal(session.canvasTurnBudget.stop.details.recovery.ignoredBlockedCalls,2)
  assert.equal(host.sessions.has(session.id),true)
  continued=true;await host.submit(session,'Continue the conversation.')
  await waitFor(()=>frames.some(frame=>frame.payload.kind==='assistant_message'&&frame.payload.text==='Continued successfully.'))
  assert.equal(requests,4);assert.equal(session.canvasTurnBudget.stop,null)
})

class FakeNative {
  constructor(options){this.options=options;this.threadId='busy-thread';this.alive=false;this.requests=[];this.responses=[];this.continued=false}
  async start(){this.alive=true;return this.threadId}
  notify(){}
  async request(method,params){
    this.requests.push({method,params})
    if(method!=='turn/start')return{}
    const turnId=this.continued?'continued-turn':'busy-turn'
    setImmediate(async()=>{
      this.options.onNotification('turn/started',{threadId:this.threadId,turn:{id:turnId}})
      if(this.continued){
        this.options.onNotification('item/agentMessage/delta',{threadId:this.threadId,turnId,delta:'Continued successfully.'})
        this.options.onNotification('turn/completed',{threadId:this.threadId,turn:{id:turnId,status:'completed',items:[]}})
        return
      }
      for(let n=1;n<=3;n++){
        const callId=`write-${n}`,args={requestId:callId,action:'create_text',text:'Must not appear'}
        this.options.onNotification('rawResponseItem/completed',{threadId:this.threadId,turnId,item:{type:'function_call',call_id:callId,namespace:'penecho',name:'penecho_edit_canvas',arguments:JSON.stringify(args)}})
        this.options.onNotification('rawResponse/completed',{threadId:this.threadId,turnId,responseId:`response-${n}`,usage:null})
        const result=await this.options.onRequest(`request-${n}`,'item/tool/call',{threadId:this.threadId,turnId,callId,namespace:'penecho',tool:'penecho_edit_canvas',arguments:args})
        this.responses.push(result)
      }
    })
    return{turn:{id:turnId}}
  }
  async interrupt(threadId,turnId){this.requests.push({method:'turn/interrupt',params:{threadId,turnId}})}
  async close(){this.alive=false}
}

test('native busy stop actually interrupts the upstream turn and reports the cause, preserving the native thread',async t=>{
  const {CodexNativeHost}=await import('../src/server/canvas-agent/codex-native-host.mjs'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-busy-native-')),
    connection={id:'busy-native',provider:'codex-cli',name:'Native fixture',cliPath:'never-launched',cliModel:'test-model',effort:'medium'},frames=[]
  let process,session,browserWrites=0
  const host=new CodexNativeHost({stateDirectory:directory,rootDirectory:ROOT,resolveConnection:()=>connection,resolveProject:async()=>null,
    resolveWebSearch:()=>({apiKey:''}),resolveWidgetCapabilities:()=>({professionalEnabled:false,privatePlugins:[]}),modelTimeoutMs:()=>5000,
    resolveCliCandidates:()=>[{executable:connection.cliPath,source:'configured'}],inspectCliCandidate:async()=>`codex-cli ${CODEX_CLI_PINNED_VERSION}`,
    installManagedCli:async()=>{throw Error('Not authorized in fixture')},createAppServer:options=>(process=new FakeNative(options))})
  t.after(async()=>{await host.dispose();fs.rmSync(directory,{recursive:true,force:true})})
  session=await host.connect({clientId:'busy-native-fixture',connectionId:connection.id,binding:{},send(type,payload){
    frames.push({type,payload})
    if(type==='tool_request'){
      assert.equal(payload.arguments.operation,'mcp_edit_canvas');browserWrites++
      queueMicrotask(()=>host.resolveToolResult(session,{requestId:payload.requestId,ok:false,error}))
    }
  }})
  await host.ensureStarted(session);host.updateState(session,{revision:10,canvas:{width:20000,height:20000},objects:[],mutationState:{revision:3,blockers:[],transient:false}})
  await host.submit(session,'Create an answer.',false,[],{},null)
  await waitFor(()=>process.requests.some(request=>request.method==='turn/interrupt'))
  assert.equal(process.responses.length,3);assert.equal(browserWrites,1)
  assert.equal(process.responses[2].success,true,'terminal protocol completed; the Canvas mutation did not')
  assert.match(process.responses[2].contentItems[0].text,/"stopped":true/)
  assert.match(process.responses[2].contentItems[0].text,/"terminal":true/)
  assert.equal(frames.findLast(frame=>frame.payload.kind==='turn_end').payload.reason.kind,'blocked')
  const lastResult=frames.findLast(frame=>frame.payload.kind==='tool_result')
  assert.equal(lastResult.payload.error.code,'CANVAS_BUSY');assert.deepEqual(lastResult.payload.error.details.mutationState.blockers,['text-draft'])
  assert.equal(session.active,null);assert.equal(host.sessions.has(session.id),true)
  process.continued=true
  assert.equal((await host.submit(session,'Continue the conversation.',false,[],{},null)).output,'Continued successfully.')
  assert.equal(session.canvasTurnBudget.stop,null)
})
