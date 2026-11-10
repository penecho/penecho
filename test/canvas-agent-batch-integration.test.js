const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')

test('Harness advertises document tools, preserves their order, and lets a fresh decision retry an old Canvas revision',async t=>{
  const {CanvasHarnessHost}=await import('../src/server/canvas-agent/runtime.mjs')
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-batch-integration-'))
  const connection={id:'batch',provider:'claude-cli',name:'Batch fixture',cliPath:'unused-test-cli',cliModel:'test-model',effort:'medium'}
  let requests=0,session,resolveEnd,rejectEnd,currentRevision=10
  const finished=new Promise((resolve,reject)=>{resolveEnd=resolve;rejectEnd=reject}),browser=[],frames=[]
  const decisions=[
    {type:'tool_calls',calls:[
      {name:'penecho_read_file',arguments:{path:'canvas.json'}},
      {name:'penecho_read_file',arguments:{path:'objects/index.json'}},
    ]},
    {type:'tool_calls',calls:[
      {name:'penecho_edit_canvas',arguments:{requestId:'move-a',baseRevision:10,action:'move',objectId:'text-a',region:{x:10,y:10,w:100,h:100}}},
      {name:'penecho_edit_canvas',arguments:{requestId:'move-b',baseRevision:10,action:'move',objectId:'text-b',region:{x:20,y:20,w:100,h:100}}},
    ]},
    {type:'tool_call',name:'penecho_read_file',arguments:{path:'canvas.json'}},
    {type:'tool_call',name:'penecho_edit_canvas',arguments:{requestId:'move-b-retry',baseRevision:11,action:'move',objectId:'text-b',region:{x:20,y:20,w:100,h:100}}},
    {type:'final',text:'Updated both.'},
  ]
  const host=new CanvasHarnessHost({stateDirectory:directory,rootDirectory:path.resolve(__dirname,'..'),
    resolveConnection:()=>connection,listConnections:()=>[connection],
    callCli:async request=>{
      requests++
      const decision=decisions[requests-1]
      assert.ok(decision,`unexpected model request ${requests}`)
      if(requests===1){
        const names=JSON.parse(request.prompt).availableTools.map(tool=>tool.name)
        assert.ok(names.includes('penecho_read_file'))
        assert.ok(names.includes('penecho_edit_canvas'))
        assert.equal(names.includes('canvas_read'),false)
        assert.equal(names.includes('canvas_edit'),false)
      }
      return JSON.stringify(decision)
    }})
  t.after(()=>{void host.dispose();fs.rmSync(directory,{recursive:true,force:true})})
  const timeout=setTimeout(()=>rejectEnd(Error(`Batch did not complete: requests=${requests}, browser=${JSON.stringify(browser)}`)),5000)
  t.after(()=>clearTimeout(timeout))
  session=await host.connect({clientId:'batch-fixture',connectionId:'batch',binding:{},send(type,payload,identity){
    frames.push({type,payload,identity})
    if(type==='session_event'&&payload.kind==='turn_end')resolveEnd()
    if(type!=='tool_request')return
    assert.equal(payload.name,'canvas_document')
    const envelope=payload.arguments
    const args=envelope.arguments
    assert.equal(envelope.bindingKey,args.sessionId)
    browser.push({operation:envelope.operation,args,bindingKey:envelope.bindingKey})
    if(envelope.operation==='mcp_read_file'){
      assert.ok(['/canvas.json','/objects/index.json'].includes(args.path))
      const content=args.path==='/canvas.json'?JSON.stringify({revision:currentRevision}):'[]'
      queueMicrotask(()=>host.resolveToolResult(session,{requestId:payload.requestId,ok:true,result:{revision:currentRevision,content,contentHash:`revision-${currentRevision}`}}))
      return
    }
    assert.equal(envelope.operation,'mcp_edit_canvas')
    assert.equal(args.action,'move')
    if(args.baseRevision!==currentRevision){
      queueMicrotask(()=>host.resolveToolResult(session,{requestId:payload.requestId,ok:false,error:{code:'REVISION_CONFLICT',message:'The Canvas changed. Read canvas.json and retry with its current revision.'}}))
      return
    }
    const previousRevision=currentRevision
    currentRevision++
    queueMicrotask(()=>host.resolveToolResult(session,{requestId:payload.requestId,ok:true,result:{applied:true,objectId:args.objectId,previousRevision,revision:currentRevision}}))
  }})
  host.updateState(session,{revision:10,canvas:{width:2048,height:2048},objects:[]})
  await host.submit(session,'Read and update the two existing text objects.')
  await finished
  assert.equal(requests,5,JSON.stringify({requests,frames,browser}))
  assert.equal(new Set(browser.map(call=>call.bindingKey)).size,1)
  assert.deepEqual(browser.map(call=>call.operation),[
    'mcp_read_file','mcp_read_file','mcp_edit_canvas','mcp_edit_canvas','mcp_read_file','mcp_edit_canvas',
  ])
  assert.deepEqual(browser.filter(call=>call.operation==='mcp_read_file').map(call=>call.args.path),['/canvas.json','/objects/index.json','/canvas.json'])
  assert.deepEqual(browser.filter(call=>call.operation==='mcp_edit_canvas').map(call=>call.args.baseRevision),[10,10,11])
  assert.deepEqual(browser.filter(call=>call.operation==='mcp_edit_canvas').map(call=>call.args.requestId),['move-a','move-b','move-b-retry'])
  assert.equal(currentRevision,12)
  assert.equal(frames.findLast(frame=>frame.type==='session_event'&&frame.payload.kind==='turn_end').payload.reason.kind,'completed')
})
