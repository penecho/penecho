const assert = require('node:assert/strict')
const test = require('node:test')

function busy({ epoch=4, blockers=['text-draft'], transient=false }={}) {
  return { code:'CANVAS_BUSY', message:'A Canvas edit is active.', details:{
    mutationGuard:'canvas-edit', retry:transient?'after_gesture':'after_state_change',
    mutationState:{revision:epoch,blockers,transient},
  } }
}

async function fixture({ error=busy(), hostName='CanvasHarnessHost' }={}) {
  const runtime=await import('../src/server/canvas-agent/runtime.mjs'), native=await import('../src/server/canvas-agent/codex-native-host.mjs'),
    {createDocumentTools}=await import('../src/server/canvas-agent/document-tools.mjs'),
    {executeCanvasBatchTool}=await import('../src/server/canvas-agent/tool-batch.mjs')
  const host=Object.create((native[hostName]||runtime[hostName]).prototype), calls=[]
  let fail=error, nextId=0
  const session={id:'busy-session',logicalConversationId:'busy-logical',canvasTurnBudget:runtime.freshCanvasAgentTurnBudget(),
    stateDigest:{revision:10,viewRevision:1,mutationState:{revision:3,blockers:[],transient:false}},
    pending:new Map(),ignoredToolResultIds:new Set(),rpc:async(name,envelope)=>{
      calls.push({name,...envelope})
      const requestId=String(++nextId)
      return new Promise((resolve,reject)=>{
        session.pending.set(requestId,{resolve,reject})
        let result
        if(envelope.operation==='mcp_read_file') result={revision:10,content:'old\n',contentHash:'hash',mutationState:session.stateDigest.mutationState}
        else if(envelope.operation==='mcp_inspect_session') result={revision:10,mutationState:session.stateDigest.mutationState}
        else if(envelope.operation==='mcp_patch_file') result={applied:true,revision:11,sourcePath:envelope.arguments.path,contentHash:'new-hash'}
        else if(envelope.operation==='mcp_upload_image') result={source:'penecho-asset:'+'a'.repeat(64),revision:10}
        else if(envelope.arguments.action==='show') result={applied:true,revision:10}
        else if(!fail) result={applied:true,revision:11,objectId:'created'}
        host.resolveToolResult(session,{requestId,...(result?{ok:true,result}:{ok:false,error:fail})})
      })
    }}
  const tools=createDocumentTools(session,{wrap:(name,execute)=>(args,exec)=>executeCanvasBatchTool(session,name,args,exec,execute)})
  return {session,calls,runtime,fail:value=>{fail=value},
    run:(name,args)=>tools.find(tool=>tool.name===name).execute(args,{callId:String(++nextId),signal:new AbortController().signal}),
    legacy:(name,args,execute)=>(executeCanvasBatchTool(session,name,args,{callId:String(++nextId)},execute)),
  }
}

const writes=[
  ['penecho_present_widget',{artifactId:'answer',title:'Answer',html:'<p>Answer</p>'}],
  ['penecho_edit_canvas',{action:'create_text',text:'Answer'}],
  ['penecho_draw',{artifactId:'drawing',title:'Drawing',items:[{id:'label',type:'text',text:'Answer',x:0,y:0}]}],
]

for(const hostName of ['CanvasHarnessHost','CodexNativeHost']) test(`${hostName} busy errors preserve actual blocker metadata and fence different writing tools`,async()=>{
  const f=await fixture({hostName})
  for(let i=0;i<7;i++) {
    const [name,args]=writes[i%writes.length]
    await assert.rejects(f.run(name,{...args,requestId:`write-${i}`}),error=>{
      assert.equal(error.code,'CANVAS_BUSY')
      assert.equal(error.details.mutationGuard,'canvas-edit')
      assert.deepEqual([...error.details.mutationState.blockers],['text-draft'])
      assert.equal(error.details.recovery.blocked,true)
      assert.equal(error.details.recovery.mutationAttempts,1)
      assert.match(error.message,i<2?/Do not switch writing tools/:/Automatic Canvas work stopped/)
      return true
    })
  }
  assert.equal(f.calls.length,1,'same persistent guard never receives seven writes')
  assert.equal(f.calls[0].operation,'mcp_present_widget')
})

test('spatial busy leaves actual read/source patch/upload/show operations available',async()=>{
  const f=await fixture()
  await assert.rejects(f.run('penecho_edit_canvas',{action:'create_text',text:'Answer',requestId:'create'}),{code:'CANVAS_BUSY'})
  assert.equal((await f.run('penecho_read_file',{path:'canvas.json'})).content,'old\n')
  const patch='--- a/objects/widget/widget.html\n+++ b/objects/widget/widget.html\n@@ -1 +1 @@\n-old\n+new\n'
  assert.equal((await f.run('penecho_patch_file',{requestId:'source',path:'objects/widget/widget.html',contentHash:'hash',patch})).applied,true)
  assert.equal((await f.run('penecho_upload_image',{requestId:'upload',name:'Image',source:'data:image/png;base64,YQ=='})).source,'penecho-asset:'+'a'.repeat(64))
  assert.equal((await f.run('penecho_edit_canvas',{requestId:'show',action:'show'})).applied,true)
  const result=await f.legacy('canvas_patch_widget',{sourceHash:'unchanged'},async()=>({revision:11,applied:true}))
  assert.equal(result.applied,true)
  await assert.rejects(f.run('penecho_edit_canvas',{action:'create_text',text:'Still blocked',requestId:'create-2'}),{code:'CANVAS_BUSY'})
  assert.deepEqual(f.calls.map(call=>call.operation),['mcp_edit_canvas','mcp_read_file','mcp_patch_file','mcp_upload_image','mcp_edit_canvas'])
})

test('transient/unknown busy permits one retry across tools, and no more mutation dispatch',async()=>{
  for(const error of [busy({blockers:['drawing'],transient:true}),{code:'CANVAS_BUSY',message:'Queue is full.'}]) {
    const f=await fixture({error})
    for(let i=0;i<7;i++) {
      const [name,args]=writes[i%writes.length]
      if(!error.details)f.fail({code:'CANVAS_BUSY',message:`A differently worded busy response from tool ${name}.`})
      await assert.rejects(f.run(name,{...args,requestId:`retry-${i}`}),e=>e.code==='CANVAS_BUSY'&&e.details.recovery.mutationAttempts===Math.min(i+1,2))
    }
    assert.equal(f.calls.length,2)
  }
})

test('busy rejections are not retained as uncertain writes, and completed receipts remain reusable',async()=>{
  const f=await fixture()
  f.fail(null)
  const args={requestId:'completed',action:'create_text',text:'Existing successful text'}
  assert.equal((await f.run('penecho_edit_canvas',args)).applied,true)
  f.fail(busy())
  for(let i=0;i<6;i++) {
    f.session.canvasTurnBudget=f.runtime.freshCanvasAgentTurnBudget()
    await assert.rejects(f.run('penecho_edit_canvas',{requestId:`rejected-${i}`,action:'create_text',text:'Answer'}),{code:'CANVAS_BUSY'})
    assert.equal(f.session.documentToolSession.mutationRequests.has(`rejected-${i}`),false)
  }
  const dispatched=f.calls.length
  assert.equal((await f.run('penecho_edit_canvas',args)).reused,true)
  assert.equal(f.calls.length,dispatched)
})

test('new accepted turn and newer blocker epoch clear fences; stale idle or pan/zoom do not',async()=>{
  const f=await fixture()
  await assert.rejects(f.run('penecho_edit_canvas',{action:'create_text',text:'Answer',requestId:'create'}),{code:'CANVAS_BUSY'})
  f.fail(null)
  // The idle epoch 3 predates the busy reply's epoch 4. View changes do not
  // prove that a text editor closed, even if this digest arrives later.
  f.session.stateDigest={...f.session.stateDigest,viewRevision:20,viewport:{x:100,y:100,width:300,height:200}}
  await f.run('penecho_inspect_session',{})
  await assert.rejects(f.run('penecho_edit_canvas',{action:'create_text',text:'Answer',requestId:'stale'}),{code:'CANVAS_BUSY'})
  assert.equal(f.calls.length,2)
  f.session.stateDigest.mutationState={revision:5,blockers:[],transient:false}
  assert.equal((await f.run('penecho_edit_canvas',{action:'create_text',text:'Answer',requestId:'idle'})).applied,true)
  f.fail(busy({epoch:6}))
  await assert.rejects(f.run('penecho_edit_canvas',{action:'create_text',text:'Answer',requestId:'draft-again'}),{code:'CANVAS_BUSY'})
  f.session.canvasTurnBudget=f.runtime.freshCanvasAgentTurnBudget()
  f.fail(null)
  assert.equal((await f.run('penecho_edit_canvas',{action:'create_text',text:'Answer',requestId:'new-turn'})).applied,true)
})

test('a legitimate inspection can observe gesture end without changing Canvas revision',async()=>{
  const f=await fixture({error:busy({blockers:['drawing'],transient:true})})
  await assert.rejects(f.run('penecho_edit_canvas',{action:'create_text',text:'Answer',requestId:'one'}),{code:'CANVAS_BUSY'})
  await assert.rejects(f.run('penecho_edit_canvas',{action:'create_text',text:'Answer',requestId:'two'}),{code:'CANVAS_BUSY'})
  const liveDigest=f.session.stateDigest
  f.session.stateDigest={...liveDigest,mutationState:{revision:5,blockers:[],transient:false}}
  await f.run('penecho_inspect_session',{})
  // Simulate the digest still being delayed after the inspection receipt.
  f.session.stateDigest=liveDigest
  f.fail(null)
  assert.equal((await f.run('penecho_edit_canvas',{action:'create_text',text:'Answer',requestId:'finished'})).applied,true)
  assert.equal(f.session.stateDigest.revision,10)
})

test('source/revision conflicts and uncertain outcomes keep their valid retry paths',async()=>{
  const f=await fixture()
  for(const code of ['SOURCE_CONFLICT','REVISION_CONFLICT','TRANSPORT']) {
    let attempts=0
    const execute=async args=>{
      attempts++
      if(attempts===1)throw Object.assign(Error('Changed or uncertain.'),{code,details:{expected:10,current:11}})
      assert.equal(args.baseRevision,11)
      return {revision:12,applied:true}
    }
    await assert.rejects(f.legacy('canvas_edit',{baseRevision:10},execute),error=>error.code===code&&error.details.current===11&&error.message==='Changed or uncertain.')
    assert.equal((await f.legacy('canvas_edit',{baseRevision:11},execute)).applied,true)
    assert.equal(attempts,2)
  }
})
