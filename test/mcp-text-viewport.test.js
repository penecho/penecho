'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'src/client/app/canvas-runtime.js'),'utf8');
function declaration(name){
 const start=runtime.search(new RegExp(`^  (?:async )?function ${name}\\(`,'m'));
 assert.ok(start>=0,`real ${name} implementation exists`);
 const rest=runtime.slice(start),end=rest.indexOf('\n  }')+4;
 return rest.slice(0,end);
}
function harness(){
 const renders=[];
 const context=vm.createContext({Blob,Number,Math,Set,canvasTextQualityGeneration:0,
  state:{nextTextBoxId:1,nextImageId:1,nextWidgetId:1,textBoxes:[],inkColor:'#345'},SIZE:32768,
  MAX_VISIBLE_TEXT_BOXES:100,TEXT_INPUT_MAX_LENGTH:100000,TEXT_EDITOR_FONT_FAMILY:'sans-serif',
  MAX_IMAGE_SOURCE_BYTES:1000000,MAX_IMAGE_DIMENSION:10000,MAX_IMAGE_PIXELS:100000000,
  MAX_WIDGET_HTML_LENGTH:100000,MAX_WIDGET_CONTENT_DIMENSION:10000,MAX_WIDGET_COPY_TEXT_LENGTH:10000,
  PRIVATE_WIDGET_FAVORITE_ID:/^favorite-/,newPrivateWidgetFavoriteId:()=> 'favorite-1',diagramRuntime:()=>null,
  n:(v,min=0,max=32768)=>Number.isFinite(v)&&v>=min&&v<=max,
  normalizeTextBoxFontFamily:v=>v||'sans-serif',desiredCanvasTextRasterRatio:()=>1,
  renderTextBoxImage:async (item,ratio)=>{renders.push({...item,ratio});return {image:{width:item.maxWidth*ratio,height:40*ratio,logicalWidth:item.maxWidth,logicalHeight:40,pixelRatio:ratio}};},
  textImageRasterRatio:image=>image.pixelRatio||1,
  clearHandToolbarTargets:()=>{},clearTextEditors:()=>{},positionTextEditors:()=>{},requestRender:()=>{},refreshVisibleTextBoxQuality:()=>{},
 });
 for(const name of ['textBoxHistoryRecord','storedTextBoxes','fittedTextBoxContent','renderedTextBoxRecord','restoreTextBoxes','imageRecord','widgetRecord'])vm.runInContext(declaration(name),context);
 vm.runInContext(fs.readFileSync(path.join(root,'src/client/app/mcp-primitives.js'),'utf8'),context);
 return {context,renders};
}
const frame=item=>({x:item.x,y:item.y,w:item.w,h:item.h});
for(const scale of [.1,.5,1,2])test(`real text persistence retains world frame after rerasterization at placement zoom ${scale}`,async()=>{
 const {context:c,renders}=harness();
 const original=await c.renderedTextBoxRecord({text:'Readable text',x:0,y:0,fontSize:20,maxWidth:240,fontFamily:'sans-serif'});
 Object.assign(original,c.mcpPrimitiveWorldBox(frame(original),1/scale,{x:1000,y:1100}));
 c.state.textBoxes=[original];
 const expected=frame(original),saved=JSON.parse(JSON.stringify(c.storedTextBoxes()));
 assert.equal(saved[0].image,undefined,'stored text strips only the raster');
 assert.equal(saved[0].fontSize,20);assert.equal(saved[0].maxWidth,240);
 c.state.scale=2;
 await c.restoreTextBoxes(saved,2);
 const reopened=c.state.textBoxes[0];
 assert.deepEqual(frame(reopened),expected);assert.notEqual(reopened.image,original.image);
 assert.equal(reopened.fontSize*reopened.w/reopened.image.logicalWidth*scale,20);
 assert.equal(reopened.image.width,480,'zoom mapping does not enlarge author raster allocation');
 assert.equal(renders.length,2);
 // A retained low-resolution history image takes the rerasterization path too.
 reopened.w*=1.25;reopened.h*=1.5;reopened.x+=17;
 const editedFrame=frame(reopened),history=c.textBoxHistoryRecord(reopened);
 await c.restoreTextBoxes([history],3);
 assert.deepEqual(frame(c.state.textBoxes[0]),editedFrame);
 assert.equal(c.state.textBoxes[0].image.width,720);assert.equal(renders.length,3);
});
test('invalid saved text frames do not overwrite validated rendered geometry',async()=>{
 const {context:c}=harness();
 for(const geometry of [{w:NaN,h:40},{w:240,h:Infinity},{w:-1,h:40},{w:32768,h:40}]){
  await c.restoreTextBoxes([{id:'text-box-1',text:'Valid',fontSize:20,maxWidth:240,x:100,y:100,...geometry}]);
  assert.deepEqual(frame(c.state.textBoxes[0]),{x:100,y:100,w:240,h:40});
 }
});
function identity(){return vm.runInNewContext(fs.readFileSync(path.join(root,'src/client/app/document-identity.js'),'utf8')+'\ncanvasDocumentIdentity',{TextEncoder});}
function workspaceArtifact(api,worldPerPixel){
 const metadata={version:1,documentId:'doc-1',bindings:[{key:'binding-1',client:'desktop',documentId:'doc-1'}]};
 const workspace={version:1,sessions:[{sessionKey:'binding-1',client:'desktop',documentId:'doc-1',artifacts:[['drawing',{kind:'drawing',objectId:'text-box-1',origin:{x:1000,y:1000},worldPerPixel}]]}]};
 return {metadata,workspace,normalized:api.normalizeWorkspace(workspace,metadata)};
}
test('artifact author mapping survives the real workspace JSON normalization roundtrip',()=>{
 const api=identity();
 for(const mapping of [.5,1,2,10,1/.03]){
  const {metadata,normalized}=workspaceArtifact(api,mapping);
  const reopened=api.normalizeWorkspace(JSON.parse(JSON.stringify(normalized)),metadata);
  assert.equal(reopened.sessions[0].artifacts[0][1].worldPerPixel,mapping);
 }
});
test('artifact normalizer discards nonfinite and out-of-contract author mappings',()=>{
 const api=identity();
 for(const mapping of [NaN,Infinity,-Infinity,0,-1,.49,1/.03+.01,'2',null,undefined]){
  const {normalized}=workspaceArtifact(api,mapping);
  assert.equal(Object.hasOwn(normalized.sessions[0].artifacts[0][1],'worldPerPixel'),false);
 }
});
test('real widget and image records preserve small world frames at zoom two',()=>{
 const {context:c}=harness();
 const widget={pluginId:'mcp',title:'Viewport',html:'<p>Readable</p>',refreshSeconds:0,x:100,y:100,w:150,h:100,contentW:300,contentH:200};
 const record=c.widgetRecord(widget);
 assert.ok(record);assert.equal(record.w,150);assert.equal(record.h,100);
 assert.equal(record.w/record.contentW*2,1);assert.equal(record.h/record.contentH*2,1);
 const image={x:100,y:100,w:40,h:40,naturalW:80,naturalH:80,image:{width:80,height:80},blob:new Blob(['pixels'])};
 const placed=c.imageRecord(image);
 assert.ok(placed);assert.equal(placed.w,40);assert.equal(placed.h,40);assert.equal(placed.w/placed.naturalW*2,1);
 const {contentW,contentH,...legacyWidget}=widget,{naturalW,naturalH,...legacyImage}=image;
 assert.equal(c.widgetRecord(legacyWidget),null,'legacy widgets still require author minimum size');
 assert.equal(c.imageRecord(legacyImage),null,'legacy images still require author minimum size');
 assert.equal(c.widgetRecord({...widget,w:.5}),null);assert.equal(c.imageRecord({...image,h:.5}),null);
});

test('dragging a viewport-mapped widget reflows without a world-pixel minimum jump',()=>{
 const resize=vm.runInNewContext(`(${declaration('resizeWidgetBox')})`,{SIZE:32768});
 const start={x:100,y:200,w:240,h:110,contentW:480,contentH:220};
 const taller=resize(start,{x:0,y:350},'height');
 assert.equal(taller.h,150);assert.equal(taller.contentH,300);assert.equal(taller.w,240);
 const wider=resize(start,{x:370,y:0},'width');
 assert.equal(wider.w,270);assert.equal(wider.contentW,540);assert.equal(wider.h,110);
 assert.equal(resize(start,{x:0,y:0},'height').h,100);
 assert.equal(resize(start,{x:0,y:0},'width').w,150);
});

test('a superseded text restore cannot repopulate a cleared canvas or consume its next id',async()=>{
 const {context:c}=harness(),released=[],effects=[];
 let finish;
 c.renderTextBoxImage=()=>new Promise(resolve=>{finish=resolve;});
 c.releaseTextRaster=image=>released.push(image);
 c.positionTextEditors=()=>effects.push('position');c.requestRender=()=>effects.push('render');c.refreshVisibleTextBoxQuality=()=>effects.push('quality');
 const pending=c.restoreTextBoxes([{text:'Old Canvas',fontSize:20,maxWidth:240,x:100,y:100}]);
 await c.restoreTextBoxes([]);
 const effectCount=effects.length,image={width:240,height:40,logicalWidth:240,logicalHeight:40};
 finish({image});await pending;
 assert.equal(c.state.textBoxes.length,0);
 assert.equal(c.state.nextTextBoxId,1);
 assert.deepEqual(released,[image]);
 assert.equal(effects.length,effectCount,'stale completion must not refresh the new canvas');
});

test('the latest text restore owns matching ids and unrelated quality refreshes do not cancel it',async()=>{
 const {context:c}=harness(),released=[];let finish;
 const render=c.renderTextBoxImage;
 c.renderTextBoxImage=(item,ratio)=>item.text==='Old'?new Promise(resolve=>{finish=resolve;}):render(item,ratio);
 c.releaseTextRaster=image=>released.push(image);
 const item={id:'text-box-1',fontSize:20,maxWidth:240,x:100,y:100};
 const pending=c.restoreTextBoxes([{...item,text:'Old'}]);
 await c.restoreTextBoxes([{...item,text:'New'}]);
 const image={width:240,height:40,logicalWidth:240,logicalHeight:40};finish({image});await pending;
 assert.equal(c.state.textBoxes.length,1);assert.equal(c.state.textBoxes[0].text,'New');assert.deepEqual(released,[image]);
 const current=c.restoreTextBoxes([{...item,text:'Old'}]);
 c.canvasTextQualityGeneration++;
 finish({image:{...image}});await current;
 assert.equal(c.state.textBoxes[0].text,'Old','quality refresh generation is separate from restore ownership');
});

test('a failed superseded text restore does not begin rendering later stale items',async()=>{
 const {context:c}=harness();let reject,rendered=0;
 c.renderTextBoxImage=()=>{rendered++;return rendered===1?new Promise((resolve,fail)=>{reject=fail;}):Promise.resolve({image:{width:240,height:40,logicalWidth:240,logicalHeight:40}});};
 const item={fontSize:20,maxWidth:240,x:100,y:100};
 const pending=c.restoreTextBoxes([{...item,text:'First'},{...item,text:'Second'}]);
 await c.restoreTextBoxes([]);reject(Error('render failed'));await pending;
 assert.equal(rendered,1);assert.equal(c.state.textBoxes.length,0);
});
