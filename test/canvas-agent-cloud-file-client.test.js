'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
function fixture(request){
 const context=vm.createContext({location:{pathname:'/canvas/11111111-1111-4111-8111-111111111111'},window:{PENECHO_CONFIG:{hostedDocumentFiles:true}},canvasAgent:{currentConversation:{id:'conversation-test'}},canvasAgentCloudSavedCanvasId:()=>"saved",canvasAgentCloudCanvasId:()=>"11111111-1111-4111-8111-111111111111",t:key=>key,canvasAgentUsesCloudHost:()=>true,canvasAgentProjectRequest:request,encodeURIComponent});
 vm.runInContext(source.slice(source.indexOf('  function canvasAgentCloudFileScope('),source.indexOf('  async function canvasAgentUploadProjectFile(')),context);return context;
}
test('Cloud picker uploads raw bytes bound to logical conversation with strict format/size gate',async()=>{
 const calls=[],context=fixture(async(url,options)=>{calls.push({url,options});return{project:{id:'cloud-file-id'}};});
 await assert.rejects(context.canvasAgentUploadCloudFile({name:'legacy.doc',size:1}),/canvasAgentCloudFileFormats/);
 await assert.rejects(context.canvasAgentUploadCloudFile({name:'large.pdf',size:8*1024*1024+1}),/canvasAgentCloudFileFormats/);
 const file={name:'中文.xlsx',size:10},result=await context.canvasAgentUploadCloudFile(file);
 assert.equal(calls.length,1);assert.match(calls[0].url,/files\/conversation-test$/);assert.equal(calls[0].options.body,file);assert.equal(calls[0].options.headers['content-type'],'application/x-penecho-document');assert.equal(result.cloudScope.conversationId,'conversation-test');
});
test('late upload does not attach to replacement conversation and removes only original upload',async()=>{
 let context;const calls=[];context=fixture(async(url,options)=>{calls.push({url,options});if(options.method==='POST'){context.canvasAgent.currentConversation.id='replacement';return{project:{id:'cloud-file-id'}};}return{};});
 await assert.rejects(context.canvasAgentUploadCloudFile({name:'notes.txt',size:10}),/canvasAgentCloudFileScopeChanged/);
 assert.equal(calls[1].options.method,'DELETE');assert.match(calls[1].url,/files\/conversation-test\/cloud-file-id$/);
});
test('late upload after Cloud Canvas switch removes original upload and never attaches to new Canvas',async()=>{
 let context,current='11111111-1111-4111-8111-111111111111';const calls=[];
 context=fixture(async(url,options)=>{calls.push({url,options});if(options.method==='POST'){current='22222222-2222-4222-8222-222222222222';return{project:{id:'cloud-file-id'}};}return{};});
 context.canvasAgentCloudCanvasId=()=>current;
 await assert.rejects(context.canvasAgentUploadCloudFile({name:'notes.txt',size:10}),/canvasAgentCloudFileScopeChanged/);
 assert.equal(calls[1].options.method,'DELETE');assert.match(calls[1].url,/canvases\/11111111-1111-4111-8111-111111111111\/files\/conversation-test\/cloud-file-id$/);
});
