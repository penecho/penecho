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
for(const mode of ["active","inactive","workspace-failure","dom-exception"])test(`${mode==="active"?"control: renaming the active":mode==="inactive"?"renaming another open":"retrying a partial Library rename of another open"} Canvas updates the workspace title (${mode})`,async()=>{
  const hidden=mode!=="active";
  const h=harness();await h.canvasDocumentsReady();const original=h.canvasDocumentsCurrent(),item=snapshot("saved-a");
  Object.assign(h.state,{currentSnapshotId:item.id,currentSnapshotLocation:"device",currentSnapshotName:"Before",widgets:item.widgets});
  item.name="Before";item.bundleExtensions=structuredClone(h.canvasDocumentsSaveMetadata());
  await h.canvasDocumentsDidSave(item,"device",item.id,[]);h.saved.set(`device:${item.id}`,{item:structuredClone(item),tileEntries:[]});
  if(hidden)await h.context.requestCanvasTransition({type:"new"});
  const otherId=hidden?h.canvasDocumentsCurrent().id:null;
  const snapshots=new Map([[item.id,structuredClone(item)]]),db=h.memoryDb(snapshots,{persistFailures:0,persistWrites:0});
  Object.assign(h.context,{historyBusy:()=>false,setHistorySaveBusy:value=>{h.context.snapshotSaveInProgress=value;},refreshSnapshots:async()=>{},showHistoryNoticeKey(){},canvasAgentCanvasDidPersist(){},
    snapshotDb:async()=>db,SNAPSHOT_STORE:"snapshots"});
  for(const name of ["transactionDone","renameDeviceSnapshot"])vm.runInContext(declaration("persistence.js",name),h.context);
  if(mode==="dom-exception"){
    const persist=h.context.canvasDocumentsPersist;
    let fail=true;
    h.context.canvasDocumentsPersist=async (...args)=>{
      if(fail){fail=false;throw new DOMException("Storage quota exceeded","QuotaExceededError")}
      return persist(...args);
    };
  }
  if(mode==="workspace-failure"||mode==="dom-exception"){
    if(mode==="workspace-failure")h.control.persistFailures=1;
    await assert.rejects(h.context.renameSnapshot(item.id,"device","After"),error=>{
      assert.match(error.message,/saved Canvas was renamed/);
      if(mode==="dom-exception")assert.equal(error.cause?.name,"QuotaExceededError","preserve the storage failure as the cause");
      return true;
    });
    assert.equal(snapshots.get(item.id).name,"After","the backing rename is reported honestly");
    assert.equal(original.title,"Before","failed workspace persistence does not claim a synchronized tab");
  }
  await h.context.renameSnapshot(item.id,"device","After");
  assert.equal(snapshots.get(item.id).name,"After","the real device rename committed the new name");
  if(hidden){
    assert.equal(h.canvasDocumentsCurrent().id,otherId,"the active Canvas remains selected");
    assert.equal(original.title,"After","the inactive open record gets the new title");
    assert.equal(original.stored.item.name,"After");
    assert.equal(h.records.get(original.id).metadata.title,"After","the workspace record survives restart");
  }
  await h.context.requestLoadSnapshot(item.id,"device");
  assert.equal(h.canvasDocumentsCurrent().id,original.id);
  assert.equal(h.state.currentSnapshotName,"After","opening the renamed Library entry must display its new title");
  assert.equal(h.canvasDocumentsCurrent().title,"After");
});

async function hiddenRenameHarness(hidden=true){
  const h=harness();await h.canvasDocumentsReady();const original=h.canvasDocumentsCurrent(),item=snapshot("saved-a");
  Object.assign(h.state,{currentSnapshotId:item.id,currentSnapshotLocation:"device",currentSnapshotName:"Before",widgets:item.widgets});
  item.name="Before";item.bundleExtensions=structuredClone(h.canvasDocumentsSaveMetadata());
  await h.canvasDocumentsDidSave(item,"device",item.id,[]);h.saved.set(`device:${item.id}`,{item:structuredClone(item),tileEntries:[]});
  if(hidden)await h.context.requestCanvasTransition({type:"new"});
  const snapshots=new Map([[item.id,structuredClone(item)]]),db=h.memoryDb(snapshots,{persistFailures:0,persistWrites:0});
  Object.assign(h.context,{historyBusy:()=>h.context.snapshotSaveInProgress,setHistorySaveBusy(value){h.context.snapshotSaveInProgress=value;},refreshSnapshots:async()=>{},showHistoryNoticeKey(){},canvasAgentCanvasDidPersist(){},snapshotDb:async()=>db,SNAPSHOT_STORE:"snapshots"});
  for(const name of ["transactionDone","renameDeviceSnapshot"])vm.runInContext(declaration("persistence.js",name),h.context);
  return {h,original,item,snapshots};
}
test("a paused Library rename preserves newer inactive Canvas images",async()=>{
  const {h,original,item}=await hiddenRenameHarness(),persist=h.context.canvasDocumentsPersist;
  let release,entered;
  const paused=new Promise(resolve=>entered=resolve);
  h.context.canvasDocumentsPersist=async (doc,...args)=>{
    if(doc.id===original.id&&doc.title==="After"){entered();await new Promise(resolve=>release=resolve)}
    return persist(doc,...args);
  };
  const rename=h.context.renameSnapshot(item.id,"device","After");await paused;
  original.stored.item.images=[{id:"image-1",x:0,y:0,w:20,h:20}];
  const background=persist(original);release();await Promise.all([rename,background]);
  assert.deepEqual(original.stored.item.images.map(image=>image.id),["image-1"]);
  assert.deepEqual(h.records.get(original.id).stored.item.images.map(image=>image.id),["image-1"]);
});
test("a background write begun after Library rename preparation commits after its transaction",async()=>{
  const {h,original,item}=await hiddenRenameHarness(),persist=h.context.canvasDocumentsPersist;
  let background;
  h.context.canvasDocumentsPersist=(doc,closed,execution,beforeWrite,renameOwner)=>{
    if(doc.id===original.id&&doc.title==="After")return persist(doc,closed,execution,()=>{
      beforeWrite?.();
      original.stored.item.images=[{id:"image-late",x:0,y:0,w:20,h:20}];
      background=persist(original);
    },renameOwner);
    return persist(doc,closed,execution,beforeWrite,renameOwner);
  };
  await h.context.renameSnapshot(item.id,"device","After");
  assert.ok(background,"the later content write began after rename preparation");
  await background;
  assert.deepEqual(original.stored.item.images.map(image=>image.id),["image-late"]);
  assert.deepEqual(h.records.get(original.id).stored.item.images.map(image=>image.id),["image-late"]);
  assert.equal(h.records.get(original.id).metadata.title,"After");
});
test("a background write times out behind a stalled rename without writing later",async()=>{
  const {h,original,item}=await hiddenRenameHarness(),persist=h.context.canvasDocumentsPersist,bound=h.context.canvasDocumentsBound;
  let release,entered;
  const paused=new Promise(resolve=>entered=resolve);
  h.context.canvasDocumentsPersist=async (doc,...args)=>{
    if(doc.id===original.id&&doc.title==="After"){entered();await new Promise(resolve=>release=resolve)}
    return persist(doc,...args);
  };
  const rename=h.context.renameSnapshot(item.id,"device","After");await paused;
  h.context.canvasDocumentsBound=(promise,ms)=>bound(promise,Math.min(ms??15000,20));
  const writes=h.control.persistWrites;
  await assert.rejects(persist(original),{code:"STORAGE_TIMEOUT",message:/Canvas rename is still finishing/});
  release();await rename;
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(h.control.persistWrites,writes+1,"timed-out background work never starts a late write");
});
test("a newer Agent rename remains authoritative while a Library rename is paused",async()=>{
  const {h,original,item,snapshots}=await hiddenRenameHarness(),persist=h.context.canvasDocumentsPersist;
  let release,entered;
  const paused=new Promise(resolve=>entered=resolve);
  h.context.canvasDocumentsPersist=async (doc,...args)=>{
    if(doc.id===original.id&&doc.title==="Manual older"){entered();await new Promise(resolve=>release=resolve)}
    return persist(doc,...args);
  };
  const manual=h.context.renameSnapshot(item.id,"device","Manual older");await paused;
  const newer=h.context.canvasDocumentsRename({documentId:original.id,title:"Agent newer"});
  await new Promise(resolve=>setTimeout(resolve,20));
  release();await manual;await newer;
  assert.equal(snapshots.get(item.id).name,"Agent newer");
  assert.equal(original.title,"Agent newer");
  assert.equal(h.records.get(original.id).metadata.title,"Agent newer");
});
test("a queued active Agent rename starts after the Library save-busy flag clears",async()=>{
  const {h,original,item,snapshots}=await hiddenRenameHarness(false),renameDevice=h.context.renameDeviceSnapshot;
  let release,entered;
  const paused=new Promise(resolve=>entered=resolve);
  h.context.renameDeviceSnapshot=async (...args)=>{entered();await new Promise(resolve=>release=resolve);return renameDevice(...args)};
  const manual=h.context.renameSnapshot(item.id,"device","Manual older");await paused;
  const newer=h.context.canvasDocumentsRename({documentId:original.id,title:"Agent newer"});
  release();await manual;await newer;
  assert.equal(snapshots.get(item.id).name,"Agent newer");
  assert.equal(h.state.currentSnapshotName,"Agent newer");
  assert.equal(h.records.get(original.id).metadata.title,"Agent newer");
});
test("a paused Agent rename preserves newer inactive Canvas images",async()=>{
  const {h,original}=await hiddenRenameHarness(),persist=h.context.canvasDocumentsPersist;
  let release,entered;
  const paused=new Promise(resolve=>entered=resolve);
  h.context.canvasDocumentsPersist=async (doc,...args)=>{
    if(doc.id===original.id&&doc.title==="After"){entered();await new Promise(resolve=>release=resolve)}
    return persist(doc,...args);
  };
  const rename=h.context.canvasDocumentsRename({documentId:original.id,title:"After"});await paused;
  original.stored.item.images=[{id:"image-1",x:0,y:0,w:20,h:20}];
  const background=persist(original);release();await Promise.all([rename,background]);
  assert.deepEqual(original.stored.item.images.map(image=>image.id),["image-1"]);
  assert.deepEqual(h.records.get(original.id).stored.item.images.map(image=>image.id),["image-1"]);
});
test("Agent rename retains partial-save guidance for read-only DOMException messages",async()=>{
  const {h,original,snapshots}=await hiddenRenameHarness(),persist=h.context.canvasDocumentsPersist;
  h.context.canvasDocumentsPersist=async (doc,...args)=>{
    if(doc.id===original.id&&doc.title==="After")throw new DOMException("Storage quota exceeded","QuotaExceededError");
    return persist(doc,...args);
  };
  await assert.rejects(h.context.canvasDocumentsRename({documentId:original.id,title:"After"}),error=>{
    assert.match(error.message,/saved copy name was updated/);
    assert.equal(error.details?.savedNameUpdated,true);
    assert.equal(error.cause?.name,"QuotaExceededError");
    return true;
  });
  assert.equal(snapshots.get(original.locator.id).name,"After");
  assert.equal(original.title,"Before");
});
