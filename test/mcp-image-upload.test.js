'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp'),crypto=require('node:crypto');
const {prepareUploadedImage,MAX_BYTES}=require('../src/server/mcp/image-upload');
for(const format of ['png','jpeg','webp','gif','tiff','avif']) test(`decodes actual ${format} and normalizes upload`,async()=>{
 const bytes=await sharp({create:{width:16,height:12,channels:4,background:'#ab3400'}}).toFormat(format).toBuffer();
 const result=await prepareUploadedImage(bytes,'test.fake');
 assert.equal(result.inputSha256,crypto.createHash('sha256').update(bytes).digest('hex'));
 assert.equal(result.originalName,'test.fake');assert.equal(result.width,16);assert.equal(result.height,12);
 const output=Buffer.from(result.source.split(',')[1],'base64');const meta=await sharp(output).metadata();
 assert.ok(['png','jpeg','webp'].includes(meta.format));assert.equal(result.mimeType,'image/'+meta.format);assert.ok(result.source.length<=800000);
 if(['png','jpeg','webp'].includes(format))assert.deepEqual(output,bytes);
});
test('rejects SVG, empty, spoofed signature, truncated payload, byte and pixel overflow',async()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from('<svg></svg>'),Buffer.from('89504e470d0a1a0a00000000','hex'),Buffer.from('ffd8ff000000','hex')])await assert.rejects(prepareUploadedImage(bytes,'x.png'));
 const image=await sharp({create:{width:100,height:100,channels:3,background:'red'}}).png().toBuffer();
 await assert.rejects(prepareUploadedImage(image.subarray(0,50),'x.png'));
 await assert.rejects(prepareUploadedImage(Buffer.alloc(MAX_BYTES+1),'x.png'),{status:413});
 const oversized=await sharp({create:{width:6400,height:6400,channels:3,background:'red'}}).png().toBuffer();
 await assert.rejects(prepareUploadedImage(oversized,'x.png'),{status:413});
});
test('cancelled work cannot return a source',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(prepareUploadedImage(Buffer.from('test'),'x',{signal:controller.signal}));
});
test('cancelling active Sharp metadata rejects without an unhandled stream error',async t=>{
 const bytes=await sharp({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer();
 const controller=new AbortController(),metadata=sharp.prototype.metadata;
 t.mock.method(sharp.prototype,'metadata',function(...args){const pending=metadata.apply(this,args);controller.abort();return pending;});
 await assert.rejects(prepareUploadedImage(bytes,'test.png',{signal:controller.signal}),{code:'upload_cancelled',status:408});
 // node:test also catches any detached error emitted by Sharp.destroy().
 await new Promise(resolve=>setImmediate(resolve));
});
for(const format of ['png','tiff']) test(`${format} larger than Canvas dimension limit resizes losslessly with transparency`,async()=>{
 const bytes=await sharp({create:{width:2500,height:40,channels:4,background:{r:10,g:50,b:77,alpha:0.4}}}).toFormat(format,format==='tiff'?{compression:'lzw'}:{}).toBuffer();
 const result=await prepareUploadedImage(bytes,`wide.${format}`);assert.equal(result.mimeType,'image/png');assert.equal(result.width,2048);assert.ok(result.height<=2048);
 const output=Buffer.from(result.source.split(',')[1],'base64');assert.equal((await sharp(output).metadata()).hasAlpha,true);
 assert.deepEqual(await sharp(output).raw().toBuffer(),await sharp(bytes).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).raw().toBuffer());
});
test('missing encoder and unsupported HEIF codec provide actionable safe errors',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),source=fs.readFileSync(require.resolve('../src/server/mcp/image-upload'),'utf8');
 const load=sharpFactory=>{const module={exports:{}};vm.runInNewContext(source,{require:id=>id==='sharp'?sharpFactory():require(id),module,Buffer});return module.exports.prepareUploadedImage;};
 const png=Buffer.from('89504e470d0a1a0a','hex');
 await assert.rejects(load(()=>{throw new Error('private local path');})(png,'x'),e=>e.code==='image_encoder_unavailable'&&e.status===503&&/reinstall PenEcho/.test(e.message)&&!e.message.includes('private'));
 const heif=Buffer.from('00000018667479706865696300000000','hex');
 const decode=load(()=>()=>({timeout(){return this;},metadata:async()=>{throw new Error('heif: Unsupported feature: Unsupported codec');},destroy(){}}));
 await assert.rejects(decode(heif,'x.heic'),e=>e.code==='image_codec_unavailable'&&e.status===415&&/PNG/.test(e.message));
});
