'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 let next=0;const saved=[];
 const context=vm.createContext({state:{scale:1,userRevision:1,textBoxes:[],images:[],aiFont:'sans-serif',frontCanvasObjectKind:'image',frontPlacedCanvasObjectKind:'image'},SIZE:32768,MAX_VISIBLE_TEXT_BOXES:100,MAX_VISIBLE_IMAGES:100,
 intersection:(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y,
 unionDirtyBounds:(a,b)=>!a?{...b}:{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x),h:Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y)},
 offscreen:(w,h)=>({width:w,height:h,getContext:()=>new Proxy({measureText:s=>({width:s.length*10})},{get:(o,k)=>o[k]||(()=>{})})}),
 renderedTextBoxRecord:async raw=>({id:`text-${++next}`,w:raw.maxWidth,h:40,...raw,image:{width:raw.maxWidth,height:40}}),canvasBlob:async()=>({size:100}),
 imageRecord:raw=>({id:raw.id||`image-${++next}`,...raw}),canvasAgentBox:o=>({x:o.item.x,y:o.item.y,w:o.item.w,h:o.item.h}),
 canvasAgentObject:id=>{for(const [key,kind]of [['textBoxes','text'],['images','image']]){const item=context.state[key].find(i=>i.id===id);if(item)return{item,kind};}return null;},
 setCanvasObjectFrontKind:kind=>{context.state.frontCanvasObjectKind=kind;context.state.frontPlacedCanvasObjectKind=kind;},canvasAgentMutationIdle:()=>{},canvasAgentAssertRevision:r=>assert.equal(context.state.userRevision,r),canvasAgentAssertToolExecution:()=>{},
 plotView:()=>({xMin:-5,xMax:5,yMin:-10,yMax:10}),mcpPresentation:(args,previous)=>args.presentation||previous?.presentation||{intent:"deliver",role:"primary",attention:"normal"},mcpPlanPlacement:()=>({placement:{x:1000,y:1000},layout:{}}),save:()=>saved.push(true),textBoxHistoryState:()=>[],imageHistoryState:()=>[],requestRender:()=>{},canvasAgentSyncState:()=>{},mcpQueueView:()=>{},mcpRuntime:{feedbackSequence:0},
 });
 const source=fs.readFileSync('src/client/app/ai-runtime.js','utf8'),start=source.indexOf('  function compileExpression('),end=source.indexOf('  async function plotObjectImage',start);
 vm.runInContext(source.slice(start,end)+fs.readFileSync('src/client/app/mcp-primitives.js','utf8')+';globalThis.api={mcpPrimitiveLayout,mcpPlotView,mcpPresentPrimitives};',context);
 return {context,...context.api,saved};
}
test('node layout and ID connectors require no client coordinates',()=>{
 const h=harness(),r=h.mcpPrimitiveLayout([{id:'a',type:'rect'},{id:'b',type:'ellipse'},{id:'edge',type:'arrow',from:'a',to:'b'}]);
 assert.ok(r.items[1].box.x>r.items[0].box.x+r.items[0].box.w);assert.equal(r.items[2].points.length,2);
 assert.throws(()=>h.mcpPrimitiveLayout([{id:'edge',type:'arrow',from:'missing',to:'other'}]),/endpoints/);
 assert.throws(()=>h.mcpPrimitiveLayout([{id:'a',type:'rect',width:4000}]),/too large/);
});
test('expression parsing is restricted and domains are sampled locally',()=>{
 const h=harness();assert.throws(()=>h.mcpPlotView({expression:'globalThis.alert(1)'}),/Unsupported|Unknown|Expression too complex/);
 assert.throws(()=>h.mcpPlotView({expression:'sqrt(-1)',xMin:0,xMax:2}),/no finite/);
 const view=h.mcpPlotView({expression:'sin(x)',xMin:-Math.PI,xMax:Math.PI});assert.ok(view.yMin<-1&&view.yMax>1);
 assert.equal(h.mcpPlotView({expression:'x^2',xMin:0,xMax:3,yMin:0,yMax:10}).yMax,10);
});
test('native batches replace owned stable objects and preserve user moves without creating Widgets',async()=>{
 const h=harness(),session={artifacts:new Map()},args={artifactId:'flow',title:'Flow',items:[{id:'a',type:'rect',text:'Plan'},{id:'b',type:'text',text:'Verify'}]};
 const first=await h.mcpPresentPrimitives(session,args,'drawing',{});assert.equal(first.objectIds.length,2);assert.equal(h.context.state.images.length,1);assert.equal(h.context.state.textBoxes.length,1);assert.equal(h.saved.length,2);
 const shape=h.context.state.images[0];shape.x+=50;const moved=shape.x;
 const second=await h.mcpPresentPrimitives(session,{...args,items:[{id:'a',type:'ellipse',text:'Done'}]},'drawing',{});
 assert.equal(second.objectIds[0],first.objectIds[0]);assert.equal(shape.x,moved);assert.equal(h.context.state.textBoxes.length,0);
 const stranger={id:'image-999',x:0,y:0,w:100,h:100};h.context.state.images.push(stranger);
 await h.mcpPresentPrimitives(session,args,'drawing',{});assert.ok(h.context.state.images.includes(stranger));
 assert.equal(first.feedbackCursor,0);
});
test('invalid batch and revoked asynchronous preparation leave Canvas untouched',async()=>{
 const h=harness(),session={artifacts:new Map()},args={artifactId:'bad',title:'Bad',items:[{id:'a',type:'text',text:'Ready'},{id:'b',type:'rect',text:'x'.repeat(1000)}]};
 await assert.rejects(h.mcpPresentPrimitives(session,args,'drawing',{}),/label is too long/);assert.equal(h.saved.length,0);assert.equal(h.context.state.textBoxes.length,0);assert.equal(session.artifacts.size,0);
 h.context.renderedTextBoxRecord=async raw=>{h.context.state.userRevision++;return {id:'t',w:100,h:40,...raw};};
 await assert.rejects(h.mcpPresentPrimitives(session,{...args,items:[args.items[0]]},'drawing',{}));assert.equal(h.saved.length,0);
});
test('updating one label reuses unchanged text and raster content',async()=>{
 const h=harness(),session={artifacts:new Map()},args={artifactId:'flow',title:'Flow',items:[{id:'a',type:'rect',text:'Plan'},{id:'b',type:'ellipse',text:'Build'},{id:'c',type:'text',text:'Review'}]};
 await h.mcpPresentPrimitives(session,args,'drawing',{});
 let encodes=0;h.context.canvasBlob=async()=>{encodes++;return{size:100};};h.context.renderedTextBoxRecord=async()=>{throw Error('unchanged text must not rerender');};
 await h.mcpPresentPrimitives(session,{...args,items:args.items.map(item=>item.id==='a'?{...item,text:'Done'}:item)},'drawing',{});
 assert.equal(encodes,1,'only the changed shape encodes a raster');
});


test('new native labels use text foreground while updates preserve the user foreground',async()=>{
 const h=harness(),session={artifacts:new Map()},args={artifactId:'hello',title:'Hello',items:[
  {id:'box',type:'rect',x:200,y:200,width:280,height:120,fill:'#ffffff'},
  {id:'label',type:'text',x:200,y:230,width:280,text:'Hello'}]};
 await h.mcpPresentPrimitives(session,args,'drawing',{});
 assert.equal(h.context.state.frontPlacedCanvasObjectKind,'text-box');
 assert.equal(h.context.state.frontCanvasObjectKind,'text-box');
 h.context.state.frontCanvasObjectKind=h.context.state.frontPlacedCanvasObjectKind='image';
 await h.mcpPresentPrimitives(session,args,'drawing',{});
 assert.equal(h.context.state.frontPlacedCanvasObjectKind,'image');
 const shapes=harness();
 await shapes.mcpPresentPrimitives({artifacts:new Map()},{...args,items:[args.items[0]]},'drawing',{});
 assert.equal(shapes.context.state.frontPlacedCanvasObjectKind,'image');
});

for(const scale of [.1,.5,1,2])test(`native drawing uses author pixels at zoom ${scale} and keeps mapping on update`,async()=>{
 const h=harness(),session={artifacts:new Map()},args={artifactId:'viewport',title:'Viewport',items:[
  {id:'a',type:'rect',x:0,y:0,width:200,height:100,strokeWidth:3},
  {id:'b',type:'text',x:300,y:0,width:200,fontSize:20,text:'Readable'},
  {id:'edge',type:'arrow',from:'a',to:'b',strokeWidth:3}]};
 h.context.state.scale=scale;
 const allocations=[];const offscreen=h.context.offscreen;
 h.context.offscreen=(w,h)=>{const canvas=offscreen(w,h),q=canvas.getContext('2d');canvas.getContext=()=>q;allocations.push(canvas);return canvas;};
 let placement;
 h.context.mcpPlanPlacement=(w,h)=>{placement={w,h};return {placement:{x:1000,y:1000},layout:{}};};
 await h.mcpPresentPrimitives(session,args,'drawing',{});
 const shape=h.context.state.images[0],edge=h.context.state.images[1],text=h.context.state.textBoxes[0],artifact=session.artifacts.get(args.artifactId);
 assert.equal(h.context.state.scale,scale);assert.equal(artifact.worldPerPixel,1/scale);
 assert.equal(placement.w*scale,500);assert.equal(shape.w*scale,200);assert.equal(shape.h*scale,100);
 assert.equal((text.x-shape.x)*scale,300);assert.equal(text.w*scale,200);assert.equal(text.h*scale,40);
 assert.equal(text.fontSize*text.w/text.image.width*scale,20);assert.equal(allocations[0].width,200);
 assert.equal(allocations[0].getContext('2d').lineWidth*shape.w/allocations[0].width*scale,3);
 const image=shape.image,textImage=text.image,origin={...artifact.origin};
 shape.x+=40/scale;text.x+=40/scale;const movedEdgeX=edge.x+40/scale;
 const frame={x:text.x,y:text.y,w:text.w,h:text.h};
 h.context.state.scale=2.5;
 h.context.renderedTextBoxRecord=async()=>{throw Error('unchanged text must be reused');};
 await h.mcpPresentPrimitives(session,args,'drawing',{});
 assert.equal(h.context.state.scale,2.5);assert.equal(session.artifacts.get(args.artifactId).worldPerPixel,1/scale);
 assert.deepEqual({...session.artifacts.get(args.artifactId).origin},origin);
 assert.deepEqual({x:text.x,y:text.y,w:text.w,h:text.h},frame);
 assert.equal(edge.x,movedEdgeX);assert.equal(shape.image,image);assert.equal(text.image,textImage);
 assert.equal(allocations.length,2,'translating both endpoints reuses connector raster');
});
test('legacy native artifacts keep world-unit geometry when updated at another zoom',async()=>{
 const h=harness(),session={artifacts:new Map()},args={artifactId:'legacy',items:[{id:'a',type:'text',text:'Legacy'}]};
 await h.mcpPresentPrimitives(session,args,'drawing',{});delete session.artifacts.get(args.artifactId).worldPerPixel;
 const text=h.context.state.textBoxes[0];text.w=350;text.h=60;h.context.state.scale=.1;
 await h.mcpPresentPrimitives(session,args,'drawing',{});
 assert.equal(text.w,350);assert.equal(text.h,60);assert.equal(session.artifacts.get(args.artifactId).worldPerPixel,1);
});
for(const scale of [.1,.5,1,2])test(`native plot uses a bounded raster at zoom ${scale}`,async()=>{
 const h=harness(),session={artifacts:new Map()};h.context.state.scale=scale;
 h.context.plotObjectImage=async args=>({image:{width:args.w,height:args.h},blob:{size:100},logicalWidth:args.w,logicalHeight:args.h});
 const args={artifactId:'plot',expression:'x^2',width:900,height:600};
 await h.mcpPresentPrimitives(session,args,'plot',{});
 const plot=h.context.state.images[0];assert.equal(plot.w*scale,900);assert.equal(plot.h*scale,600);assert.equal(plot.image.width,900);
 plot.x+=20;plot.w*=1.2;const frame={x:plot.x,y:plot.y,w:plot.w,h:plot.h};h.context.state.scale=3;
 await h.mcpPresentPrimitives(session,{...args,expression:'x^3'},'plot',{});
 assert.deepEqual({x:plot.x,y:plot.y,w:plot.w,h:plot.h},frame);
});
test('small shapes retain author size and connectors follow a single moved node',async()=>{
 const h=harness(),session={artifacts:new Map()};h.context.state.scale=2;
 const args={artifactId:'small',items:[{id:'a',type:'rect',x:0,y:0,width:80,height:80},{id:'b',type:'rect',x:200,y:0,width:80,height:80},{id:'edge',type:'arrow',from:'a',to:'b'}]};
 await h.mcpPresentPrimitives(session,args,'drawing',{});
 const [a,b,edge]=h.context.state.images,oldImage=edge.image;
 assert.equal(a.w,40);assert.equal(a.image.width,80);
 a.x+=10;b.h=60;h.context.state.scale=.1;
 await h.mcpPresentPrimitives(session,args,'drawing',{});
 const scene=h.mcpPrimitiveLayout([{...args.items[0],x:20},{...args.items[1],height:120},args.items[2]]),origin=session.artifacts.get(args.artifactId).origin;
 const expected=scene.items[2].box;
 assert.equal(edge.x,origin.x+expected.x*.5);assert.equal(edge.y,origin.y+expected.y*.5);
 assert.equal(edge.w,expected.w*.5);assert.equal(edge.h,expected.h*.5);
 assert.notEqual(edge.image,oldImage);assert.equal(a.w,40);assert.equal(b.h,60);
});


test('MCP native text stages IDs and passes execution independently of raster scale',async()=>{
 const h=harness(),session={artifacts:new Map()},execution={kind:'mcp',controller:new AbortController()};h.context.state.nextTextBoxId=7;
 h.context.canvasAgentAssertToolExecution=value=>{if(value.controller.signal.aborted)throw Error('cancelled');};
 h.context.renderedTextBoxRecord=async(raw,pixelRatio,owner)=>{
   assert.equal(pixelRatio,undefined);assert.equal(owner.controller,execution.controller);assert.equal(h.context.state.nextTextBoxId,7);
   return {...raw,id:`text-box-${owner.nextTextBoxId++}`,w:100,h:40,image:{width:100,height:40}};
 };
 const result=await h.mcpPresentPrimitives(session,{artifactId:'text',items:[{id:'label',type:'text',text:'Ready'}]},'drawing',execution);
 assert.equal(result.objectIds[0],'text-box-7');assert.equal(h.context.state.nextTextBoxId,8);
});
test('canceling native text preparation does not allocate live IDs or continue the batch',async()=>{
 const h=harness(),session={artifacts:new Map()},execution={kind:'mcp',controller:new AbortController()};h.context.state.nextTextBoxId=7;let calls=0;
 h.context.canvasAgentAssertToolExecution=value=>{if(value.controller.signal.aborted)throw Error('cancelled');};
 h.context.renderedTextBoxRecord=async(raw,pixelRatio,owner)=>{calls++;execution.controller.abort();return {...raw,id:`text-box-${owner.nextTextBoxId++}`,w:100,h:40};};
 await assert.rejects(h.mcpPresentPrimitives(session,{artifactId:'text',items:[{id:'one',type:'text',text:'One'},{id:'two',type:'text',text:'Two'}]},'drawing',execution),/cancelled/);
 assert.equal(calls,1);assert.equal(h.context.state.nextTextBoxId,7);assert.equal(h.saved.length,0);assert.equal(session.artifacts.size,0);
});
