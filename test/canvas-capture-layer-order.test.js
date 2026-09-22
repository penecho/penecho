"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),sharp=require("sharp");
const read=file=>fs.readFileSync(path.join(__dirname,"../src/client/app",file),"utf8");
function extract(source,name){const start=source.search(new RegExp(`^  (?:async )?function ${name}\\(`,"m"));assert.ok(start>=0,name);const end=source.slice(start+1).search(/^  (?:async )?function /m);return source.slice(start,end<0?undefined:start+1+end);}
const runtime=read("canvas-runtime.js"),persistence=read("persistence.js"),agent=read("canvas-agent-runtime.js"),ai=read("ai-runtime.js");
function harness(frontKind,{ink=false,text=false,selected=false}={}){
 const region={x:0,y:0,w:16,h:16},canvases=[],noop=()=>{},paint=(label,pixel)=>({label,pixel});
 const widget=paint("widget",[255,0,0,255]),image=paint("image",[0,0,255,255]),inkImage=paint("ink",[0,0,0,255]),textImage=paint("text",[0,255,0,255]);
 const makeCanvas=(width=16,height=16)=>{
  const canvas={width,height,paints:[],toDataURL:()=>"data:image/png;base64,fixture"};
  const context={save:noop,restore:noop,setTransform:noop,scale:noop,translate:noop,beginPath:noop,rect:noop,clip:noop,fillRect:noop,drawImage:value=>canvas.paints.push(value)};
  canvas.getContext=()=>context;canvases.push(canvas);return canvas;
 };
 const state={paint:{paper:"#fff"},frontCanvasObjectKind:frontKind,frontPlacedCanvasObjectKind:"image",userRevision:1,gridVisible:false,selectedTextBoxId:selected?"text-box-1":null,
  widgets:[{...region,snapshotImage:widget,snapshotVersion:1,contentVersion:1}],images:[{...region,image}],textBoxes:text?[{id:"text-box-1",...region,image:textImage}]:[],sharpOverlays:[]};
 const context=vm.createContext({state,performance,SIZE:20000,TILE:512,CANVAS_DOWNLOAD_RESOLUTION_SCALE:1,EXPORT_MAX_DIMENSION:1000,EXPORT_MAX_PIXELS:1000000,
  FOCUS_INSET_ENABLED:false,CANVAS_AGENT_LAYOUT_CAPTURE_POLICY:{maxLongEdge:16,maxPixels:256,id:"test",maxBytes:10000},
  tiles:new Map(ink?[["0,0",inkImage]]:[]),offscreen:makeCanvas,document:{createElement:()=>makeCanvas()},
  exportRegion:()=>region,visibleInkBounds:()=>ink?region:null,imageBounds:()=>region,textBoxBounds:()=>text?region:null,animationBounds:()=>null,widgetBounds:()=>region,
  unionLocalBounds:(a,b)=>a||b,intersection:()=>true,visibleImages:()=>state.images,capturableWidgets:()=>state.widgets,
  drawAnimationsToContext:(q)=>q.drawImage(paint("animation",[255,255,0,255])),prepareVisibleWidgetSnapshots:async()=>{},
  forTiles:(x,y,w,h,fn)=>{if(ink)fn(inkImage,0,0);},canvasAgentTargetRegion:()=>region,canvasAgentGridStep:()=>1,canvasAgentViewFacts:()=>({viewRevision:1}),
  canvasAgentCompressedCanvas:async canvas=>({canvas,blob:{type:"image/png",size:1},mediaType:"image/png"}),canvasAgentReadDataUrl:async()=>"data:image/png;base64,fixture",
  mapHotspots:()=>({hotspots:[]}),debug:noop,
 });
 for(const name of ["textBoxBox","visibleTextBoxes","drawImagesToContext","drawWidgetsToContext","drawTextBoxesToContext","drawSharpOverlays"])
  vm.runInContext(extract(runtime,name),context);
 if(runtime.includes("function drawWidgetsAndImagesToContext("))vm.runInContext(extract(runtime,"drawWidgetsAndImagesToContext"),context);
 for(const name of ["snapshotPreview","renderExportCanvas"])vm.runInContext(extract(persistence,name),context);
 vm.runInContext(extract(agent,"canvasAgentCapture")+extract(ai,"buildViewportImage"),context);
 return {context,canvases,region};
}
async function render(kind,frontKind,options){
 const h=harness(frontKind,options),c=h.context;
 if(kind==="preview")c.snapshotPreview(32,32);
 else if(kind==="export")await c.renderExportCanvas();
 else if(kind==="agent")await c.canvasAgentCapture({target:"region",coordinates:"none"});
 else{const r=h.region;c.buildViewportImage([],r,false,{visible:r,captureRect:r,sourceRect:r,imageScale:1,imageSize:{w:16,h:16},latestVisible:r});}
 return h.canvases.at(-1);
}
async function encodedPixel(canvas){
 // The fixtures fully overlap. Composite the production draw calls at their
 // common center, then encode/decode a real PNG without opening a browser.
 const overlays=canvas.paints.map(image=>({input:Buffer.from(image.pixel),raw:{width:1,height:1,channels:4}}));
 const png=await sharp({create:{width:1,height:1,channels:4,background:"white"}}).composite(overlays).png().toBuffer();
 return [...await sharp(png).raw().toBuffer()];
}
for(const kind of ["preview","export","agent","viewport"])for(const front of ["image","widget","text-box"])test(`${kind} preserves ${front} front order in encoded pixels`,async()=>{
 const canvas=await render(kind,front);
 assert.deepEqual(await encodedPixel(canvas),front==="widget"?[255,0,0,255]:[0,0,255,255]);
});
for(const kind of ["preview","export","agent","viewport"])test(`${kind} retains text above settled ink and object layers`,async()=>{
 const canvas=await render(kind,"widget",{ink:true,text:true});
 assert.deepEqual(await encodedPixel(canvas),[0,255,0,255]);
 assert.ok(canvas.paints.findIndex(p=>p.label==="animation")<canvas.paints.findIndex(p=>p.label==="image"));
});

for(const selected of [false,true])test(`agent capture retains stored text while editor selection is ${selected}`,async()=>{
 const canvas=await render("agent","widget",{ink:true,text:true,selected});
 assert.equal(canvas.paints.filter(image=>image.label==="text").length,1,"stored text must remain in the capture while its editor is open");
 assert.deepEqual(await encodedPixel(canvas),[0,255,0,255]);
});
