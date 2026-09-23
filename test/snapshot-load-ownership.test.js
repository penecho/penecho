"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),Module=require("node:module");
const root=process.env.PENECHO_PROOF_ROOT||path.resolve(__dirname,"..");
function declaration(file,name){
  const source=fs.readFileSync(path.join(root,"src/client/app",file),"utf8"),start=source.search(new RegExp(`^  (?:async )?function ${name}\\(`,"m"));
  assert.ok(start>=0,name);const rest=source.slice(start),end=rest.indexOf("\n  }")+4;return rest.slice(0,end);
}
function harness(){
  const file=path.join(root,"test/canvas-documents.test.js"),source=fs.readFileSync(file,"utf8"),m=new Module(file,module);
  m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(source.slice(0,source.indexOf("\ntest("))+"\nmodule.exports={harness,memoryDb};",file);
  const saved=new Map(),h=m.exports.harness({saved}),events=[];
  const dialog={value:"",open:false,classList:{contains:()=>false},close(){this.open=false;}};
  Object.assign(h.state,{snapshotLoadGeneration:0,preservedSnapshotAnimations:[],snapshotLocation:"device"});
  Object.assign(h.context,{
    snapshotItems:[],snapshotLoadingId:null,snapshotSaveInProgress:false,pendingCanvasTransition:null,SERVER_DEFAULT_PROJECT_ID:"uncategorized",
    snapshotName:item=>item.name||"Untitled",t:key=>key,updateHistoryReadControls(){},setHistoryActivity(){},
    refreshVisibleTextBoxQuality(){},closeHistoryPanel(){},fit(){},setStatusKey:key=>events.push(key),setStatus:message=>events.push(message),
    document:{getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>dialog},
    saveDeviceSnapshot:async(item,tileEntries)=>{saved.set(`device:${item.id}`,{item:structuredClone(item),tileEntries});},
    dataUrlBlob:value=>{const [header,data]=value.split(",");return new Blob([Buffer.from(data,"base64")],{type:header.slice(5,-7)});},
  });
  for(const name of ["loadSnapshot","startBlankCanvas","performCanvasTransition","requestCanvasTransition","requestLoadSnapshot","canvasHasUnsavedChanges","snapshotBundleAssetBlob","readSnapshotBundle","importCommunityCanvasArtifact","renameSnapshot"])
    vm.runInContext(declaration("persistence.js",name),h.context);
  return {...h,saved,events,memoryDb:m.exports.memoryDb};
}
function snapshot(id="target"){
  return {id,name:"Published",version:2,theme:"light",widgets:[{id:"widget-1",pluginId:"general",html:"<p>Published source</p>",x:100,y:100,w:400,h:200}],images:[],textBoxes:[],animations:[],bundleExtensions:{},manifestExtensions:{},preservedAssets:[]};
}
function bundle(item){
  return {version:2,bundleVersion:2,mode:"snapshot",formatVersion:1,id:item.id,name:item.name,extensions:item.bundleExtensions,manifest:{format:"penecho-raster-tiles",formatVersion:1,theme:"light",textBoxes:[],animations:[],view:{scale:1,panX:0,panY:0}},assets:[
    {kind:"preview",contentType:"image/png",metadata:{},dataBase64:"AAAA"},
    ...item.widgets.map(widget=>({kind:"widget",contentType:"application/json",metadata:{widgetId:widget.id},dataBase64:Buffer.from(JSON.stringify(widget)).toString("base64")}))]};
}
test("ordinary snapshot load releases its busy state",async()=>{
  const h=harness();await h.canvasDocumentsReady();h.saved.set("device:target",{item:snapshot(),tileEntries:[]});
  assert.equal(await h.context.requestLoadSnapshot("target","device"),true);
  assert.equal(h.state.currentSnapshotId,"target");
  assert.equal(h.context.snapshotLoadInProgress,false);
});
test("new Canvas during a pending read keeps a blank document and releases the load lock",async()=>{
  const h=harness();await h.canvasDocumentsReady();let finish;
  h.context.readSnapshot=()=>new Promise(resolve=>{finish=resolve;});
  const pending=h.context.requestLoadSnapshot("target","device");
  for(let i=0;!finish&&i<30;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof finish,"function");
  await h.context.requestCanvasTransition({type:"new"});
  const blankId=h.canvasDocumentsCurrent().id;finish({item:snapshot(),tileEntries:[]});
  assert.equal(await pending,false);assert.equal(h.canvasDocumentsCurrent().id,blankId);assert.equal(h.state.currentSnapshotId,null);
  assert.equal(h.context.snapshotLoadInProgress,false,"cancelled load must release its busy lock");
});
test("new Canvas during text restoration is not relabeled by late snapshot completion",async()=>{
  const h=harness();await h.canvasDocumentsReady();const target=snapshot();target.textBoxes=[{id:"text-box-1",text:"Published label",x:100,y:100,w:200,h:40,fontSize:20,maxWidth:200}];
  h.saved.set("device:target",{item:target,tileEntries:[]});let finish,releases=0;
  const raster={tagName:"CANVAS",width:200,height:40};
  Object.assign(h.context,{MAX_VISIBLE_TEXT_BOXES:50,canvasTextQualityGeneration:0,clearHandToolbarTargets(){},positionTextEditors(){},
    releaseTextRaster(image){if(image===raster){releases++;raster.width=raster.height=0;}},
    renderedTextBoxRecord:async item=>{await new Promise(resolve=>{finish=resolve;});return {...item,image:raster};}});
  vm.runInContext(declaration("canvas-runtime.js","restoreTextBoxes"),h.context);
  const pending=h.context.requestLoadSnapshot("target","device");
  for(let i=0;!finish&&i<30;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof finish,"function");await h.context.requestCanvasTransition({type:"new"});const blankId=h.canvasDocumentsCurrent().id;
  finish();await pending;
  assert.equal(h.canvasDocumentsCurrent().id,blankId,"late metadata must not reactivate the loaded identity");
  assert.equal(h.state.currentSnapshotId,null);assert.equal(h.context.snapshotLoadInProgress,false);
  assert.equal(h.state.textBoxes.length,0,"late text must not contaminate the blank Canvas");
  assert.equal(releases,1,"discarded text raster must be released");
});
test("new Canvas during legacy identity lookup is not adopted by a stale load",async()=>{
  const h=harness();await h.canvasDocumentsReady();h.saved.set("device:target",{item:snapshot(),tileEntries:[]});
  const original=h.context.canvasDocumentIdentity.legacyId;let finish,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  h.context.canvasDocumentIdentity.legacyId=async locator=>{entered();await new Promise(resolve=>{finish=resolve;});return original(locator);};
  const pending=h.context.requestLoadSnapshot("target","device");await started;
  await h.context.requestCanvasTransition({type:"new"});const blankId=h.canvasDocumentsCurrent().id;
  finish();assert.equal(await pending,false);
  assert.equal(h.canvasDocumentsCurrent().id,blankId);
  assert.equal(h.state.currentSnapshotId,null);
  assert.equal(h.context.snapshotLoadInProgress,false);
});
