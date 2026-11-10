"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../src/server/main.js"),"utf8");
function extract(name){const start=source.indexOf(`function ${name}(`),end=source.indexOf("\nfunction ",start+1);assert.ok(start>=0);return source.slice(start,end);}
test("metadata list retains lightweight fields and excludes preview bytes",()=>{
 const context={};vm.createContext(context);vm.runInContext(extract("sharedCanvasListMetadata"),context);
 const item={id:"1234567890123-canvasname",name:"Canvas",projectId:"project-example123",version:2,theme:"dark",tileCount:3,animationCount:1,widgetCount:2,textBoxCount:4,imageCount:5,createdAt:1,updatedAt:2,preview:"data:image/png;base64,AAAA"};
 const result=context.sharedCanvasListMetadata(item);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{...Object.fromEntries(Object.entries(item).filter(([key])=>key!=="preview")),documentId:null,hasPreview:true});
 assert.equal(context.sharedCanvasListMetadata({...item,documentId:"document-123"}).documentId,"document-123");
 assert.equal(context.sharedCanvasListMetadata({...item,preview:""}).hasPreview,false);
 assert.equal(item.preview,"data:image/png;base64,AAAA");
});
test("preview reads only the bounded metadata sidecar and returns compact JSON",()=>{
 const reads=[],context={fs:{statSync:()=>({isFile:()=>true,size:20}),readFileSync:file=>{reads.push(file);return JSON.stringify({preview:"data:image/png;base64,AAAA"});}},canvasSnapshotPath:(id,metadata)=>{assert.equal(metadata,true);return id==="invalid"?null:`${id}.meta.json`;},canonicalSharedCanvasMetadata:item=>item};
 vm.createContext(context);vm.runInContext(extract("readSharedCanvasPreview"),context);
 assert.equal(JSON.stringify(context.readSharedCanvasPreview("canvas")),JSON.stringify({preview:"data:image/png;base64,AAAA"}));
 assert.deepEqual(reads,["canvas.meta.json"]);
 assert.throws(()=>context.readSharedCanvasPreview("invalid"),error=>error.status===400);
 context.fs.statSync=()=>{throw Error("ENOENT");};assert.throws(()=>context.readSharedCanvasPreview("missing"),error=>error.status===404);
 context.fs.statSync=()=>({isFile:()=>true,size:4*1024*1024});assert.throws(()=>context.readSharedCanvasPreview("oversized"),error=>error.status===404);
 context.fs.statSync=()=>({isFile:()=>true,size:20});context.canonicalSharedCanvasMetadata=()=>null;assert.throws(()=>context.readSharedCanvasPreview("corrupt"),error=>error.status===404);
});
test("preview route uses the same shared canvas read authorization",()=>{
 const start=source.indexOf('if(url.pathname==="/api/canvases"||sharedCanvasMatch||sharedCanvasPreviewMatch)'),end=source.indexOf('if (req.method === "GET" && url.pathname === "/api/plugins")',start),route=source.slice(start,end);
 assert.ok(start>=0);assert.ok(route.indexOf("sharedCanvasReadError(req)")<route.indexOf("readSharedCanvasPreview(sharedCanvasPreviewMatch[1])"));
 assert.match(route,/if\(authorizationError\)return send\(res,403/);
});
