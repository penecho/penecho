"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/canvas-agent-runtime.js'),'utf8');
const fn=source.slice(source.indexOf('  async function canvasAgentCompressedCanvas('),source.indexOf('  async function canvasAgentCapture('));
const policy=vm.runInNewContext('('+source.match(/CANVAS_AGENT_LAYOUT_CAPTURE_POLICY = Object.freeze\((\{[^\n]+?\})\)/)[1]+')');
function harness(encode){
  const sizes=[],context={document:{createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}})})},canvasAgentCanvasBlob:async(c,type,quality)=>{sizes.push({width:c.width,height:c.height,type,quality});return encode(c,type,quality);},canvasAgentToolError:(code,message)=>Object.assign(Error(message),{code})};
  vm.runInNewContext(fn+';this.compress=canvasAgentCompressedCanvas;',context);return{...context,sizes};
}
test('feedback basic policy also bounds PNG fallback through real shared compression algorithm',async()=>{
  const h=harness((c,type)=>type==='image/webp'?null:{size:c.width*c.height*4,type:'image/png'}),input={width:1024,height:500};
  const result=await h.compress(input,policy);
  assert.ok(result.blob.size<=700*1024);assert.ok(result.canvas.width<1024);assert.ok(result.canvas.width*result.canvas.height<=520000);
  assert.equal(input.width,1024);assert.equal(result.blob.type,'image/png');assert.ok(h.sizes.length>2);
});
test('an uncompressible result fails instead of returning an oversized feedback image',async()=>{
  const h=harness(()=>({size:policy.maxBytes+1,type:'image/webp'}));
  await assert.rejects(h.compress({width:1024,height:500},policy),{code:'CAPTURE_TOO_LARGE'});
  assert.ok(h.sizes.length<=10);
});
