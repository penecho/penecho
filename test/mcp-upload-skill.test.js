'use strict';
// Isolated loopback acceptance of the skill command, not a two-machine/app test.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {spawn}=require('node:child_process');
const sharp=require('sharp');
const {createDirectHttpService}=require('../src/server/mcp/direct-http-service.js');
const {sessionClientBundle}=require('../src/server/mcp/session-client-bundle.js');
const {importCredentials}=require('../src/server/mcp/discovery-client.js');
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));});}
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('skill generated client command uploads client-only files through real HTTPS normalization and resolves HTML/CSS',async t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'penecho-skill-')));
 const clientDir=path.join(dir,'agent machine'),serverDir=path.join(dir,'host');fs.mkdirSync(clientDir);
 const assets=new Map();let callbacks=0;
 const service=createDirectHttpService({preferredPort:0,stateDirectory:serverDir,getHostnames:()=>[],getAddresses:()=>[],announce:()=>({close(){}}),disposeOwner:()=>{},callTool:async()=>{throw Error('Raw upload must not initialize MCP');},uploadImage:async args=>{
  callbacks++;assert.equal(args.canvasId,'selected-canvas');assert.equal(args.documentId,'current-document');
  assert.match(args.source,/^data:image\/(png|jpeg|webp);base64,/);assert.ok(!args.source.includes(clientDir));
  const bytes=Buffer.from(args.source.split(',')[1],'base64'),assetId=sha(bytes);assets.set(assetId,args);
  return {source:'penecho-asset:'+assetId,assetId,inputSha256:args.inputSha256,name:args.name,mediaType:args.mimeType,bytes:bytes.length,width:args.width,height:args.height,revision:1,canvasId:args.canvasId,documentId:args.documentId,requestId:args.requestId};
 }});
 t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});
 const status=await service.start(),stateDirectory=path.join(clientDir,'isolated credentials');
 importCredentials({...status,addresses:[status.localUrl]},{stateDirectory});
 const bundle=path.join(clientDir,'client.js');fs.writeFileSync(bundle,sessionClientBundle());
 const host=fs.readFileSync(path.join(__dirname,'../public/widget-host.js'),'utf8'),start=host.indexOf('  function resolveImageAssets('),end=host.indexOf('  function csp(',start);
 assert.ok(start>=0&&end>start);const context=vm.createContext({});vm.runInContext(host.slice(start,end),context);
 for(const extension of ['png','webp','jpg','jpeg','gif'])await t.test(extension+' command and returned asset source',async()=>{
  const format=['jpg','jpeg'].includes(extension)?'jpeg':extension;
  const input=await sharp({create:{width:12,height:9,channels:3,background:'#3f8ba1'}}).toFormat(format).toBuffer();
  const file=path.join(clientDir,'授权 空格 image.'+extension);fs.writeFileSync(file,input);
  assert.equal(fs.existsSync(path.join(serverDir,path.basename(file))),false);
  const result=await run(process.execPath,[bundle,'--host-id',status.hostId,'--state-directory',stateDirectory,'--upload-image',file,'--canvas-id','selected-canvas','--document-id','current-document','--request-id','skill-'+extension]);
  assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');const receipt=JSON.parse(result.stdout);
  assert.equal(receipt.inputSha256,sha(input));assert.equal(receipt.requestId,'skill-'+extension);assert.equal(receipt.width,12);assert.equal(receipt.height,9);
  const prepared=assets.get(receipt.assetId),output=Buffer.from(prepared.source.split(',')[1],'base64');
  if(extension==='gif'){assert.equal(receipt.mediaType,'image/png');assert.notDeepEqual(output,input);}else assert.deepEqual(output,input);
  const html=`<img src="${receipt.source}" alt="Image" style="max-width:100%;height:auto"><div style="background-image:url('${receipt.source}');min-height:240px"></div>`;
  assert.equal(context.resolveImageAssets(html,{[receipt.source]:prepared.source}),html.split(receipt.source).join(prepared.source));
  assert.equal((await sharp(output).metadata()).width,12);
 });
 assert.equal(callbacks,5);assert.equal(service.status().sessionCount,0);
});
