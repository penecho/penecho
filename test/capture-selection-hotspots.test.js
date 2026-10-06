"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");
function fn(source,name){
  const match=new RegExp(`(?:^|\\n)\\s*(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match,`Missing function ${name}`);
  const start=match.index+match[0].indexOf("function"),next=/\n\s{0,2}(?:async )?function /.exec(source.slice(start+1));
  return source.slice(start,next?start+1+next.index:source.length).trimEnd();
}
const agent=read("src/client/app/canvas-agent-runtime.js"),ai=read("src/client/app/ai-runtime.js");

test("hotspots from older input outside the final attention box cannot reject the AI request",()=>{
  const map=vm.runInNewContext(`(${fn(ai,"mapHotspots")})`),
    metadata=vm.runInNewContext(`(${fn(read("src/server/main.js"),"latestInputMetadata")})`),
    source={x:100,y:200,w:1600,h:1200},latest={x:1100,y:950,w:100,h:100},size={w:1600,h:1200},
    points=[{x:110,y:210},{x:1110,y:970},{x:1150,y:990},{x:300,y:300}],
    grid=map(source,size,points,latest),input=metadata(latest,source,1,size).imageRect;
  assert.ok(grid.hotspots.length);
  assert.ok(grid.hotspots.every(({imageRect:r})=>r.x<input.x+input.w&&r.x+r.w>input.x&&r.y<input.y+input.h&&r.y+r.h>input.y));
  assert.equal(grid.hotspots.some(h=>h.cell[0]===0&&h.cell[1]===0),false);
  assert.equal(points.length,4,"capture filtering does not consume the shared input trail");
});

function captureFixture(){
  const selection={phase:"active",regionOnly:true,box:{x:100,y:200,w:300,h:200},path:[{x:100,y:200},{x:400,y:200},{x:100,y:400}]},draws=[],masked={id:"masked-lasso-render"},
    canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage:(...args)=>draws.push(args)})},
    context={state:{selection,paint:{paper:"white"},userRevision:5},SIZE:20000,
      document:{createElement:()=>canvas},performance:{now:()=>0},WIDGET_SNAPSHOT_TIMEOUT_MS:5000,
      CANVAS_AGENT_LAYOUT_CAPTURE_POLICY:{maxLongEdge:1024,maxPixels:1048576,id:"layout",maxBytes:100000},
      canvasAgentToolError:(code,message)=>Object.assign(Error(message),{code}),selectionPathFor:s=>s.path,
      prepareVisibleWidgetSnapshots:async()=>{},capturableWidgets:()=>[],renderSelectionImage:s=>{assert.equal(s,selection);return {out:masked};},
      canvasAgentGridStep:()=>100,canvasAgentCompressedCanvas:async c=>({canvas:c,blob:{type:"image/webp",size:200},mediaType:"image/webp",encodeQuality:.8}),
      canvasAgentReadDataUrl:async()=>"data:image/webp;base64,AAAA",canvasAgentViewFacts:()=>({viewRevision:2})};
  vm.createContext(context);
  vm.runInContext(fn(agent,"canvasAgentValidatedRegion")+"\n"+fn(agent,"canvasAgentTargetRegion")+"\nasync "+fn(agent,"canvasAgentCapture"),context);
  return {context,selection,draws,masked};
}
test("MCP selection capture uses the lasso mask and reports the selection's logical mapping",async()=>{
  const h=captureFixture(),result=await h.context.canvasAgentCapture({target:"selection",coordinates:"metadata"});
  assert.equal(h.draws.length,1);assert.equal(h.draws[0][0],h.masked);
  assert.deepEqual(JSON.parse(JSON.stringify(result.logicalRegion)),{x:100,y:200,width:300,height:200});
  assert.equal(result.coordinateGrid.rendered,false);
  h.context.state.selection=null;
  await assert.rejects(h.context.canvasAgentCapture({target:"selection",coordinates:"metadata"}),{code:"SELECTION_REQUIRED"});
});
test("selection capture rejects a moved or replaced lasso after asynchronous snapshot preparation",async()=>{
  for(const change of [h=>h.selection.box.x++,h=>h.context.state.selection={...h.selection},h=>h.selection.path[0].y++]){
    const h=captureFixture();h.context.prepareVisibleWidgetSnapshots=async()=>change(h);
    await assert.rejects(h.context.canvasAgentCapture({target:"selection",coordinates:"metadata"}),{code:"SELECTION_CHANGED"});
    assert.equal(h.draws.length,0);
  }
});

test("narrow standalone draft Keep and Copy controls remain separate, including viewport edges",()=>{
  for(const viewportWidth of [280,1280]){
    const position=vm.runInNewContext(`(${fn(read("src/client/app/canvas-runtime.js"),"objectChromePosition")})`,{
      view:{clientWidth:viewportWidth,clientHeight:720},screenObjectBox:box=>({left:box.x,top:box.y,width:box.w,height:box.h}),
    });
    for(const width of [16,48,160])for(const x of [0,100,viewportWidth-width])for(const count of [3,4]){
      const boxes=["cancel","move","accept",...(count===4?["copy"]:[])].map(kind=>{
        const p=position({x,y:50,w:width,h:60},kind,"",{standaloneDraftControl:true,draftControlCount:count});
        assert.ok(p.x>=6&&p.x+p.baseWidth<=viewportWidth-6);
        return {x:p.x,y:p.y,w:p.baseWidth,h:p.baseHeight};
      });
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        assert.ok(boxes[i].x+boxes[i].w<=boxes[j].x||boxes[j].x+boxes[j].w<=boxes[i].x,"click targets must not overlap");
      }
    }
  }
});
