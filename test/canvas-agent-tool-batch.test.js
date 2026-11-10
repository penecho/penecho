const test = require('node:test')
const assert = require('node:assert/strict')

async function fixture() {
  const api = await import('../src/server/canvas-agent/tool-batch.mjs')
  const session = { stateDigest:{ revision:10 } }, calls=['a','b','c'].map(id=>({id}))
  api.registerCanvasDecisionBatch(session,calls)
  let revision=10
  const seen=[]
  return { ...api, session, seen, get revision(){return revision}, externalEdit(){revision++},
    run(id,args,execute,name='canvas_edit'){
      return api.executeCanvasBatchTool(session,name,args,{callId:id},execute|| (async submitted=>{
        seen.push(submitted.baseRevision)
        assert.equal(submitted.baseRevision,revision,'browser commit still compares the exact revision')
        return {ok:true,previousRevision:revision,revision:++revision}
      }))
    },
  }
}

test('sibling writes advance only the revisions committed by their own decision',async()=>{
  const f=await fixture(),args={baseRevision:10}
  await f.run('a',args);await f.run('b',args);await f.run('c',args)
  assert.deepEqual(f.seen,[10,11,12]);assert.equal(args.baseRevision,10)
})

test('user edit between sibling writes remains a conflict and stops later writes',async()=>{
  const f=await fixture()
  await f.run('a',{baseRevision:10});f.externalEdit()
  await assert.rejects(f.run('b',{baseRevision:10}),/browser commit/)
  await assert.rejects(f.run('c',{baseRevision:10}),{code:'CANVAS_BATCH_WRITE_STOPPED'})
  assert.deepEqual(f.seen,[10,11]);assert.equal(f.revision,12)
})

test('a stale initial revision is never rebased to the current state',async()=>{
  const f=await fixture()
  await assert.rejects(f.run('a',{baseRevision:9}),/browser commit/)
  assert.equal(f.revision,10)
})

test('failed writes preserve successful siblings and allow a diagnostic read',async()=>{
  const f=await fixture()
  await f.run('a',{baseRevision:10})
  await assert.rejects(f.run('b',{baseRevision:10},async()=>{throw Error('source mismatch')}),/source mismatch/)
  const read=await f.run('c',{},async()=>({revision:f.revision}),'canvas_read')
  assert.equal(read.revision,11)
})

test('source hashes stay exact and successful object-scoped receipts can advance the batch',async()=>{
  const f=await fixture()
  await f.run('a',{sourceHash:'original',baseRevision:10},async args=>{
    assert.equal(args.sourceHash,'original');return {previousRevision:10,revision:11}
  },'canvas_patch_widget')
  await f.run('b',{baseRevision:10},async args=>{
    assert.equal(args.baseRevision,11);return {previousRevision:11,revision:12}
  })
  await f.run('c',{sourceHash:'original',baseRevision:10},async args=>{
    assert.equal(args.sourceHash,'original');assert.equal(args.baseRevision,10)
    return {previousRevision:12,revision:13}
  },'canvas_patch_widget')
})

test('unproven revision jumps prevent further writes instead of guessing ownership',async()=>{
  const f=await fixture()
  await f.run('a',{baseRevision:10},async()=>({revision:14}))
  await assert.rejects(f.run('b',{baseRevision:10}),{code:'CANVAS_BATCH_WRITE_STOPPED'})
})

test('another decision cannot inherit an earlier revision chain',async()=>{
  const f=await fixture();await f.run('a',{baseRevision:10})
  f.session.stateDigest.revision=11
  f.registerCanvasDecisionBatch(f.session,[{id:'b'},{id:'c'}])
  await assert.rejects(f.run('b',{baseRevision:10}),/browser commit/)
})

test('a write receipt invalidates capture reuse before the browser digest catches up',async()=>{
  const f=await fixture();f.session.captureCache=new Map([['revision-10',{image:'old'}]])
  await f.run('a',{baseRevision:10})
  assert.equal(f.session.stateDigest.revision,10)
  assert.equal(f.session.captureCache.size,0)
})

test('the next decision can use a committed receipt while its digest is still delayed',async()=>{
  const f=await fixture();await f.run('a',{baseRevision:10})
  assert.equal(f.session.stateDigest.revision,10)
  f.registerCanvasDecisionBatch(f.session,[{id:'b'},{id:'c'}])
  await f.run('b',{baseRevision:11});await f.run('c',{baseRevision:11})
  assert.deepEqual(f.seen,[10,11,12])
})

test('schema failures before execute stop later writes in the same batch',async()=>{
  const f=await fixture()
  f.recordCanvasBatchToolResult(f.session,{callId:'a',name:'canvas_edit'},{isError:true})
  await assert.rejects(f.run('b',{baseRevision:10}),{code:'CANVAS_BATCH_WRITE_STOPPED'})
})
