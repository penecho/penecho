'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/mcp-runtime.js'),'utf8');
const helper=source.slice(source.indexOf('  function mcpContentUpdateRegion('),source.indexOf('  function mcpViewBlockedBy('));
const revealHelper=source.slice(source.indexOf('  function mcpReadingScreenStage('),source.indexOf('  function mcpWidgetFramePlan('));
function harness(){
 const doc={id:'background',objects:new Map([['a',{x:100,y:200,w:300,h:400}],['b',{x:600,y:800,w:100,h:50}],['space id',{x:10,y:20,w:30,h:40}]])};
 const ctx={canvasDocuments:{records:new Map([[doc.id,doc]])},canvasDocumentsObject:(d,id)=>d.objects.get(id),canvasDocumentsBounds:o=>o,unionDirtyBounds:(a,b)=>a?{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x),h:Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y)}:{...b}};
 return {doc,region:vm.runInNewContext(helper+';mcpContentUpdateRegion',ctx)};
}
const plain=value=>JSON.parse(JSON.stringify(value));
function revealHarness({stage={x:0,y:0,w:1000,h:700},scale=.5,panX=0,panY=0}={}){
 const calls=[],state={scale,panX,panY};
 const context=vm.createContext({SIZE:32768,state,canvasDocumentsIsActive:()=>true,canvasAgentFramePlan:()=>({stage}),requestRender:()=>calls.push('render'),canvasAgentSyncState:()=>calls.push('sync')});
 const reveal=vm.runInContext(`${revealHelper};mcpRevealRegion`,context);
 return {state,calls,reveal};
}
test('follow resolves background geometry and the whole multi-object artifact without mutating result IDs',()=>{
 const {region}=harness(),ids=Object.freeze(['a','b']);
 assert.deepEqual(plain(region({documentId:'background',objectIds:ids},{path:'objects/a/geometry.json'})),{x:100,y:200,w:600,h:650});
 assert.deepEqual(plain(region({documentId:'background',objectId:'a'},{})),{x:100,y:200,w:300,h:400});
});
test('patch paths resolve encoded object IDs, while metadata and missing objects do not invent framing',()=>{
 const {region}=harness();
 assert.deepEqual(plain(region({documentId:'background'},{path:'objects/space%20id/widget.html'})),{x:10,y:20,w:30,h:40});
 for(const args of [{path:'context.md'},{path:'objects/%/widget.html'},{objectId:'missing'}])assert.equal(region({documentId:'background'},args),null);
 assert.equal(region({documentId:'closed'},{objectId:'a'}),null);
});
test('erasure uses its bounded region and rejects invalid geometry',()=>{
 const {region}=harness();
 assert.deepEqual(plain(region({documentId:'background'},{region:{x:1,y:2,w:3,h:4}})),{x:1,y:2,w:3,h:4});
 for(const w of [0,-1,NaN,Infinity])assert.equal(region({documentId:'background'},{region:{x:1,y:2,w,h:4}}),null);
});

test('mcpRevealRegion leaves an already visible region and the current camera unchanged',()=>{
 const h=revealHarness({scale:.5,panX:100,panY:80}),region={x:200,y:200,w:200,h:100},before={...h.state};
 assert.equal(h.reveal(region),false);
 assert.deepEqual({...h.state},before);
 assert.deepEqual(h.calls,[]);
});

test('mcpRevealRegion pans an out of stage region without changing Canvas scale',()=>{
 const h=revealHarness({scale:.5}),region={x:2000,y:1600,w:200,h:100};
 assert.equal(h.reveal(region),true);
 assert.equal(h.state.scale,.5);
 assert.equal(h.state.panX,-550);
 assert.equal(h.state.panY,-463);
 assert.deepEqual(h.calls,['render','sync']);
});
