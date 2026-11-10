const assert = require('node:assert/strict');
const test = require('node:test');
const { TOOLS } = require('../src/server/mcp/schema.js');
const { BOUND_CANVAS_TOOL_NAMES } = require('../src/server/mcp/bound-operations.js');
const { GUIDANCE_IDS, getAuthoringGuidance } = require('../src/server/mcp/authoring-guidance.js');

async function fixture() {
  const module = await import('../src/server/canvas-agent/document-tools.mjs');
  const calls = [], session = {id:'test-session',logicalConversationId:'logical-conversation',rpc:async (...args) => {
    calls.push(args);
    return {content:'{"revision":7}',contentHash:'source-hash',absolutePath:'/private/never-return'};
  }};
  const tools = module.createDocumentTools(session);
  return {module,session,calls,tools,tool:name=>tools.find(tool=>tool.name===name),exec:{callId:'call-1',signal:new AbortController().signal}};
}

test('built-in document tool discovery exactly matches the public bound content surface', async () => {
  const {tools} = await fixture();
  const expected = TOOLS.filter(tool=>BOUND_CANVAS_TOOL_NAMES.includes(tool.name)||tool.name==='penecho_get_guidance');
  assert.deepEqual(tools.map(tool=>tool.name),expected.map(tool=>tool.name));
  for (const tool of tools) {
    assert.equal(tool.isConcurrencySafe(),false);
    assert.equal(tool.parameters.required?.includes('sessionId')||false,false);
    assert.equal(tool.description,expected.find(item=>item.name===tool.name).description);
  }
  assert.ok(!tools.some(tool=>/canvas_create|^load_|professional|private/.test(tool.name)));
});

test('built-in guidance equals MCP guidance without browser RPC or duplicate source injection', async () => {
  const {tool,exec,calls} = await fixture();
  for (const id of GUIDANCE_IDS) {
    const first = await tool('penecho_get_guidance').execute({id},exec);
    assert.deepEqual(first,getAuthoringGuidance(id));
    assert.deepEqual(await tool('penecho_get_guidance').execute({id},exec),first);
    assert.equal(first.hash.length,64);
  }
  assert.equal(calls.length,0);
  await assert.rejects(tool('penecho_get_guidance').execute({id:'professional-diagrams'},exec),{code:'invalid_arguments'});
});

test('empty arguments are correctable in the same bound session without an RPC side effect', async () => {
  const {module,session,tool,exec,calls} = await fixture();
  await assert.rejects(tool('penecho_read_file').execute({},exec),{code:'invalid_arguments'});
  assert.equal(calls.length,0);
  const input={path:'canvas.json'};
  const result=await tool('penecho_read_file').execute(input,exec);
  assert.deepEqual(input,{path:'canvas.json'});
  assert.equal(result.content,'{"revision":7}');
  assert.equal(Object.hasOwn(result,'absolutePath'),false);
  assert.equal(calls.length,1);
  const [name,payload,callId,signal]=calls[0];
  assert.equal(name,'canvas_document');
  assert.equal(payload.operation,'mcp_read_file');
  assert.equal(payload.arguments.path,'/canvas.json');
  assert.equal(payload.bindingKey,module.documentSessionId(session));
  assert.equal(payload.arguments.sessionId,payload.bindingKey);
  assert.equal(callId,'call-1:1');
  assert.equal(signal,exec.signal);
  await assert.rejects(tool('penecho_read_file').execute({path:'canvas.json',sessionId:'other-session'},exec),{code:'SESSION_SCOPE_MISMATCH'});
  assert.equal(calls.length,1);
});

test('public Canvas capture uses the shared RPC and preserves bounded image attachment evidence', async () => {
  const {createDocumentTools}=await import('../src/server/canvas-agent/document-tools.mjs');
  const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  const calls=[],images=[],session={id:'capture-session',rpc:async(name,payload)=>{
    calls.push({name,payload});
    return {dataUrl:`data:image/png;base64,${pixel}`,mediaType:'image/png',width:1,height:1,encodedBytes:Buffer.from(pixel,'base64').length,revision:3};
  }};
  const tool=createDocumentTools(session,{saveImage:async image=>{images.push(image);return {attachmentId:'captured-image'};}}).find(tool=>tool.name==='penecho_capture_canvas');
  const result=await tool.execute({target:'canvas',quality:'basic'},{callId:'capture',signal:new AbortController().signal});
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'canvas_document');
  assert.equal(calls[0].payload.operation,'mcp_capture_canvas');
  assert.equal(calls[0].payload.arguments.target,'canvas');
  assert.equal(calls[0].payload.arguments.quality,'basic');
  assert.deepEqual(images,[{mimeType:'image/png',data:pixel,bytes:Buffer.from(pixel,'base64').length}]);
  assert.equal(result.pixelVerified,true);
  assert.equal(result.revision,3);
  assert.deepEqual(result.attachment,{attachmentId:'captured-image'});
  assert.equal(Object.hasOwn(result,'image'),false);
});

test('built-in upload reads only session-owned attachments and emits canonical source without host paths', async () => {
  const {createDocumentTools,validateDocumentToolArguments}=await import('../src/server/canvas-agent/document-tools.mjs');
  const calls=[],reads=[],ref={attachmentId:'owned',mediaType:'image/png',name:'Image',absolutePath:'/private/image.png'};
  const session={id:'s',attachmentRefs:new Map([['owned',ref]]),rpc:async(name,payload)=>{calls.push(payload);return {source:'penecho-asset:'+'a'.repeat(64),revision:1};}};
  const tool=createDocumentTools(session,{readImage:async value=>{reads.push(value);return {ref:value,data:Buffer.from('a')};}}).find(t=>t.name==='penecho_upload_image');
  const exec={callId:'upload',signal:new AbortController().signal};
  for(const input of [{attachmentId:'foreign'},{attachmentId:'owned',source:'data:image/png;base64,YQ=='}]) {
    assert.throws(()=>validateDocumentToolArguments(tool.name,{requestId:'u',name:'Image',...input},session));
    await assert.rejects(tool.execute({requestId:'u',name:'Image',...input},exec));
  }
  assert.equal(reads.length,0);
  await tool.execute({requestId:'u',name:'Image',attachmentId:'owned'},exec);
  assert.equal(reads[0],ref);
  assert.equal(calls[0].operation,'mcp_upload_image');
  assert.equal(calls[0].arguments.source,'data:image/png;base64,YQ==');
  assert.ok(!JSON.stringify(calls).includes('/private/'));
  assert.equal(calls[0].arguments.attachmentId,undefined);
});

test('built-in upload rejects oversized or unsupported stored images before any browser RPC', async () => {
  const {createDocumentTools,DOCUMENT_TOOL_INSTRUCTIONS}=await import('../src/server/canvas-agent/document-tools.mjs');
  assert.match(DOCUMENT_TOOL_INSTRUCTIONS,/Widget HTML img src or CSS url\(\)/);
  for(const stored of [
    {ref:{mediaType:'image/png'},data:Buffer.alloc(600000)},
    {ref:{mediaType:'image/gif'},data:Buffer.from('GIF89a')},
    {ref:{mediaType:'image/svg+xml'},data:Buffer.from('<svg/>')},
  ]) {
    let reads=0,rpcs=0;
    const session={id:'bounded',attachmentRefs:new Map([['owned',{attachmentId:'owned'}]]),rpc:async()=>{rpcs++;return {};}};
    const tool=createDocumentTools(session,{readImage:async()=>{reads++;return stored;}}).find(tool=>tool.name==='penecho_upload_image');
    await assert.rejects(tool.execute({requestId:'u',name:'Image',attachmentId:'owned'},{callId:'upload',signal:new AbortController().signal}),{code:'invalid_arguments'});
    assert.equal(reads,1);
    assert.equal(rpcs,0);
    assert.equal(session.documentToolSession.mutationRequests.size,0);
  }
});
