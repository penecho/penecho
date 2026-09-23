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
for(const preserveIdentity of [false,true])test(`${preserveIdentity?"importing current-format":"control: importing legacy"} community bundle creates an independent document`,async()=>{
  const h=harness();await h.canvasDocumentsReady();const original=h.canvasDocumentsCurrent();
  h.state.widgets.push({...snapshot().widgets[0],html:"<p>Newer local edits</p>"});
  const item=snapshot("published");
  item.bundleExtensions=structuredClone(h.canvasDocumentsSaveMetadata());
  if(!preserveIdentity)delete item.bundleExtensions.penechoDocument;
  item.bundleExtensions.penechoWorkspace.feedbackSequence=7;
  const origin={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",rootItemId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",name:"Shared source",generation:2};
  const result=await h.context.importCommunityCanvasArtifact(bundle(item),origin);
  const importedId=h.canvasDocumentsCurrent().id;
  const imported=h.saved.get(`device:${result.id}`).item;
  assert.equal(imported.widgets[0].html,"<p>Published source</p>");
  assert.equal(imported.bundleExtensions.penechoWorkspace.version,1,"an import starts with its own empty workspace");
  assert.equal(imported.bundleExtensions.penechoWorkspace.feedbackSequence,undefined);
  assert.equal(imported.bundleExtensions.penechoCommunity.originItemId,origin.id);
  assert.equal(imported.bundleExtensions.penechoCommunity.rootItemId,origin.rootItemId);
  if(preserveIdentity){
    assert.equal(imported.bundleExtensions.penechoDocument.documentId,importedId);
    assert.equal(imported.bundleExtensions.penechoDocument.title,imported.name);
    assert.equal(imported.bundleExtensions.penechoDocument.bindings.length,0);
    assert.equal(imported.bundleExtensions.penechoDocument.locators.length,0);
    assert.equal(imported.bundleExtensions.penechoDocument.processor.kind,"penecho");
  }
  assert.ok(h.canvasDocuments.records.has(original.id),"original must remain independently open");
  assert.equal(original.stored.item.widgets[0].html,"<p>Newer local edits</p>");
  await h.context.canvasDocumentsPark();
  console.log(JSON.stringify({case:"community-import",preserveIdentity,originalId:original.id,importedId,originalAfterParking:original.stored.item.widgets[0].html}));
  assert.equal(original.stored.item.widgets[0].html,"<p>Newer local edits</p>","parking the imported copy must not overwrite original edits");
  assert.notEqual(importedId,original.id,"an imported copy must not alias the open source");
});
