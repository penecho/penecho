"use strict";
require("./helpers/safety.js");
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");
function fn(source,name){
 const start=source.indexOf(`  function ${name}(`);assert.ok(start>=0,name);
 let depth=0;
 for(let i=source.indexOf("{",source.indexOf(")",start));i<source.length;i++){
  if(source[i]==="{")depth++;
  else if(source[i]==="}"&&--depth===0)return source.slice(start,i+1);
 }
 assert.fail(`unterminated ${name}`);
}
const runtime=read("src/client/app/canvas-runtime.js");
test("native Hand input enables the existing iframe without explicit outlines and retains selected resize chrome",()=>{
 const classes=new Map(),frame={inert:true},widget={id:"w",shell:{classList:{toggle:(k,v)=>classes.set(k,v)}},frame,w:600,h:375,contentW:1200,contentH:750};
 const state={mode:"hand",scale:1,widgetEdit:{id:"w"},selectedWidgetId:"w",interactingWidgetId:null};
 const send=vm.runInNewContext(`(${fn(runtime,"sendWidgetHostState")})`,{state,canvasWidgetInteractive:()=>true,canvasWidgetSelectionEnabled:()=>false});
 send(widget);
 assert.equal(frame.inert,false);assert.equal(classes.get("is-live"),true);
 assert.equal(classes.get("is-interacting"),false);assert.equal(classes.get("is-selected"),true);
 assert.equal(widget.shell.tabIndex,0);
 state.interactingWidgetId="w";send(widget);
 assert.equal(classes.get("is-interacting"),true);assert.equal(classes.get("is-selected"),false);
 assert.equal(widget.frame,frame);
});
test("a native Hand widget press reaches its document without Canvas preventDefault or capture",()=>{
 const widget={id:"w"},state={mode:"hand",interactingWidgetId:null};
 const down=vm.runInNewContext(`(${fn(read("src/client/app/ui-bootstrap.js"),"handleCanvasPointerDown")})`,{
  state,visibleWidgets:()=>[widget],canvasWidgetInteractive:w=>w===widget,
 });
 down({pointerType:"mouse",target:{closest:()=>({dataset:{widgetId:"w"}})},preventDefault:()=>assert.fail("native input was cancelled")});
 assert.equal(state.interactingWidgetId,null);
});
function regionsHarness(){
 const state={mode:"hand",scale:.5,panX:10,panY:20,frontCanvasObjectKind:"image"},regions=new Map(),styles=new Map();
 const image={id:"image",x:100,y:120,w:300,h:200},text={id:"text",x:200,y:180,w:250,h:80};
 let images=[image],texts=[text],placed;
 const document={createElement(){return {className:"",children:[],listeners:{},setAttribute(){},append(e){this.children.push(e);e.parent=this;},
  remove(){this.parent.children=this.parent.children.filter(e=>e!==this);},addEventListener(k,v){this.listeners[k]=v;}};}};
 const events=[],ctx={state,placedContentInputRegions:regions,document,textContentLayer:{after(e){placed=e;}},
  visibleWidgets:()=>[{id:"w"}],visibleImages:()=>images,visibleTextBoxes:()=>texts,imageBox:w=>w,textBoxBox:w=>w,
  runtimeElementStyle(e){if(!styles.has(e))styles.set(e,{});return styles.get(e);},handleCanvasPointerDown:e=>events.push(e),
 };
 vm.createContext(ctx);vm.runInContext(`let placedContentInputLayer=null;${fn(runtime,"syncCanvasPlacedInputRegions")}`,ctx);
 return {state,regions,styles,image,text,events,sync:()=>ctx.syncCanvasPlacedInputRegions(),layer:()=>placed,deleteImages(){images=[];},deleteTexts(){texts=[];}};
}
test("foreground image and text input regions match painted geometry, reuse nodes and forward the original press",()=>{
 const h=regionsHarness();h.sync();
 assert.equal(h.regions.size,2);
 const image=h.regions.get("image:image"),text=h.regions.get("text:text");
 assert.deepEqual(h.styles.get(image),{left:"60px",top:"80px",width:"150px",height:"100px"});
 const event={pointerId:3};image.listeners.pointerdown(event);assert.equal(h.events[0],event);
 h.state.scale=2;h.state.panX=-30;h.image.x=140;h.sync();
 assert.equal(h.regions.get("image:image"),image);assert.equal(h.styles.get(image).left,"250px");
 h.state.frontCanvasObjectKind="widget";h.sync();
 assert.equal(h.regions.has("image:image"),false);assert.equal(h.regions.get("text:text"),text,"text paints above Widgets in either image order");
 h.deleteTexts();h.sync();assert.equal(h.regions.size,0);assert.equal(h.layer().hidden,true);
});
test("placed-object blockers disappear in drawing, Lasso, temporary pan, View and explicit interaction",()=>{
 for(const change of [{mode:"pen"},{mode:"select"},{spacePan:true},{viewMode:true},{interactingWidgetId:"w"}]){
  const h=regionsHarness();h.sync();assert.equal(h.regions.size,2);
  Object.assign(h.state,change);h.sync();assert.equal(h.regions.size,0);assert.equal(h.layer().hidden,true);
 }
});
test("Hand keeps a live Widget's right edge, bottom edge and corner grabbable without selecting it",()=>{
 const css=read("public/style.css");
 assert.ok(css.includes(".canvas-widget.is-live:not(.is-selected):not(.pending):not(.is-interacting):not(.widget-maximized) .canvas-widget-resize-handle:is(.width, .height, .resize-se) { pointer-events: auto; }"));
 assert.ok(css.includes(".canvas-widget-resize-handle.width { width: calc(var(--widget-resize-edge-x, 28px) * .3); }"),"unselected bands stay thin so Widget content keeps its scrollbars");
});
