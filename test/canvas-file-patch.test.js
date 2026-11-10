'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const nodeApi=require('../src/shared/canvas-file-patch'),{canvasFilePatchBundle}=require('../scripts/build-canvas-file-patch'),{createTwoFilesPatch}=require('diff');
const context=vm.createContext({TextEncoder});vm.runInContext(canvasFilePatchBundle(),context);const browserApi=context.PenEchoCanvasFilePatch;
for(const [label,before,after] of [['lf','one\ntwo\n','one\nthree\n'],['crlf','one\r\ntwo\r\n','one\r\nthree\r\n'],['no final newline','one','two'],['unicode','你好\n','你好世界\n'],['empty','','hello\n']])test('Node and browser patch parity: '+label,()=>{const patch=createTwoFilesPatch('a/context.md','b/context.md',before,after);assert.equal(nodeApi.applyCanvasFilePatch(before,patch,'context.md'),after);assert.equal(browserApi.applyCanvasFilePatch(before,patch,'context.md'),after);});
test('strict patch repairs single-hunk counts but rejects conflicts, wrong paths, malformed bodies and oversized output in both runtimes',()=>{for(const api of [nodeApi,browserApi]){
 const patch=createTwoFilesPatch('a/context.md','b/context.md','old\n','new\n');
 assert.throws(()=>api.applyCanvasFilePatch('different\n',patch,'context.md'),{code:'PATCH_CONFLICT'});
 assert.throws(()=>api.applyCanvasFilePatch('old\n',patch,'other.md'),{code:'invalid_patch'});
 const countOnly='--- a/context.md\n+++ b/context.md\n@@ -1,2 +1,1 @@\n-old\n+new\n';
 assert.equal(api.applyCanvasFilePatch('old\n',countOnly,'context.md'),'new\n');
 assert.throws(()=>api.applyCanvasFilePatch('different\n',countOnly,'context.md'),{code:'PATCH_CONFLICT'});
 assert.throws(()=>api.validateCanvasFilePatch(countOnly.replace('+new','unprefixed body\n+new'),'context.md'),{code:'invalid_patch'});
 assert.throws(()=>api.validateCanvasFilePatch(countOnly+'@@ -5,2 +5,2 @@\n-a\n+b\n','context.md'),{code:'invalid_patch'});
 const large='a'.repeat(799999)+'\n';const grow=createTwoFilesPatch('a/context.md','b/context.md',large,large+'b\n',{},{},{context:0});
 assert.throws(()=>api.applyCanvasFilePatch(large,grow,'context.md'),{code:'patch_too_large'});
}});
