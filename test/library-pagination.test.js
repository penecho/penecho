"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");
const server=read("src/server/main.js"),client=read("src/client/app/library-pagination.js"),persistence=read("src/client/app/persistence.js");
function extract(source,name){const start=source.search(new RegExp(`^(?:  )?(?:async )?function ${name}\\(`,"m"));assert.ok(start>=0);const end=source.slice(start+1).search(/^(?:  )?(?:async )?function /m);return source.slice(start,end<0?undefined:start+1+end);}
test("Server pages have no 200-canvas ceiling and search beyond the first page",()=>{
 const canvases=Array.from({length:245},(_,i)=>({id:`canvas-${i}`,name:i===0?"Old Needle":"Canvas "+i,projectId:i%2?"p":"uncategorized",createdAt:i,updatedAt:i,preview:"large-preview"}));
 const context={listSharedCanvases:()=>canvases,sharedCanvasProjects:()=>[],URLSearchParams};vm.createContext(context);vm.runInContext(extract(server,"sharedCanvasListMetadata")+extract(server,"sharedCanvasLibraryPage"),context);
 const seen=new Set();let offset=0;
 do{const result=context.sharedCanvasLibraryPage(new URLSearchParams({limit:24,offset}));assert.ok(result.canvases.length<=24);assert.equal(result.page.total,245);for(const item of result.canvases){assert.ok(!seen.has(item.id));assert.equal(item.preview,undefined);seen.add(item.id);}offset=result.page.nextOffset;}while(offset!==null);
 assert.equal(seen.size,245);
 const search=context.sharedCanvasLibraryPage(new URLSearchParams({limit:24,q:"needle"}));assert.equal(search.canvases[0].id,"canvas-0");assert.equal(search.page.total,1);
 assert.throws(()=>context.sharedCanvasLibraryPage(new URLSearchParams({limit:0})),error=>error.status===400);
});
test("Server saves a new Canvas even when more than 200 already exist",()=>{
 const writes=[],snapshot={id:"new",createdAt:1,updatedAt:2};
 const context={fs:{existsSync:()=>false},crypto:{randomUUID:()=>"id"},Buffer,MAX_SHARED_CANVAS_BYTES:9999,DEFAULT_CANVAS_PROJECT_ID:"uncategorized",canonicalSharedCanvas:()=>snapshot,sharedCanvasLogicalSnapshot:()=>snapshot,canvasSnapshotPath:(id,meta)=>id+(meta?".meta":""),sharedCanvasProject:()=>true,sharedCanvasMetadata:()=>snapshot,atomicJsonWrite:(...args)=>writes.push(args),sharedCanvasFiles:()=>Array(245).fill("existing")};
 vm.createContext(context);vm.runInContext(extract(server,"saveSharedCanvas"),context);context.saveSharedCanvas(snapshot);assert.equal(writes.length,2);
});
function harness(location="server"){
 const rendered=[],storage=new Map();let next;
 const context={state:{snapshotLocation:location,language:"en"},selectedServerProjectId:"all",selectedCloudProjectId:"all",snapshotItems:[{id:"cached"}],snapshotItemsLocation:location,serverCanvasProjects:[],cloudCanvasProjects:[],historyListRenderFrame:0,snapshotListGeneration:0,snapshotListInProgress:false,snapshotListFailedLocation:null,serverSnapshotUnavailableKey:"",cloudHistorySignInRequired:false,
  localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  document:{querySelector:selector=>selector==="#historySort"?{value:"modified"}:null},window:{PenEchoCloudSettings:{cacheIdentity:()=>"account-1"}},
  historySearchQuery:()=>"",snapshotApiResponse:async response=>{if(!response.ok)throw response.error;return response.body;},authenticatedApiHeaders:()=>({}),
  fetch:()=>new Promise(resolve=>{next=resolve;}),AbortController,URLSearchParams,setTimeout,clearTimeout,
  renderSnapshotList:options=>rendered.push(options||{}),renderSnapshotListLoading:()=>rendered.push("loading"),renderSnapshotListError:(_location,retain)=>rendered.push({retain}),
  updateHistoryReadControls(){},setHistoryActivity(){},hideHistoryActivity(){},snapshotLocationLabel:x=>x,t:x=>x,cacheCloudHistory(){},cloudHistoryRequiresSignIn:error=>error.code==="cloud_sign_in_required",clearCloudHistoryCache(){},renderCloudHistorySignIn:()=>rendered.push("auth"),
 };
 vm.createContext(context);vm.runInContext(client+`\nhistoryPageKey=historyCurrentPageKey();historyPageInfo={total:50,totalAll:50,projectCounts:{},nextOffset:24};`,context);
 return {context,rendered,storage,resolve:async body=>{await Promise.resolve();next({ok:true,body:{sync:{bundleVersion:2,conflictPolicy:"base-revision-required"},projects:[],...body}});},reject:async error=>{await Promise.resolve();next({ok:false,error});},get:code=>vm.runInContext(code,context)};
}
for(const location of ["server","cloud"])test(`${location} refresh preserves cached rows and Load remains independent`,async()=>{
 const h=harness(location),promise=h.context.refreshHistoryPage();assert.equal(h.context.snapshotItems[0].id,"cached");assert.equal(h.context.snapshotListInProgress,true);assert.ok(!h.rendered.includes("loading"));
 vm.runInContext(extract(persistence,"historyBusy"),h.context);h.context.snapshotLoadInProgress=false;h.context.snapshotSaveInProgress=false;assert.equal(h.context.historyBusy(),false);
 h.resolve({canvases:[{id:"fresh"}],page:{total:1,totalAll:1,projectCounts:{},nextOffset:null}});assert.equal(await promise,true);assert.equal(h.context.snapshotItems[0].id,"fresh");
});
test("append deduplicates IDs, preserves earlier rows, and completes the list",async()=>{
 const h=harness(),promise=h.context.refreshHistoryPage({append:true});h.resolve({canvases:[{id:"cached"},{id:"last"}],page:{total:2,totalAll:2,projectCounts:{},nextOffset:null}});await promise;
 assert.deepEqual(Array.from(h.context.snapshotItems,item=>item.id),["cached","last"]);assert.equal(h.rendered.at(-1).append,true);assert.equal(h.get("historyPageInfo.nextOffset"),null);
});
test("a superseded search cannot overwrite current results",async()=>{
 const h=harness(),pending=h.context.refreshHistoryPage();h.context.historySearchQuery=()=>"new query";h.context.snapshotListGeneration++;
 h.resolve({canvases:[{id:"stale"}],page:{total:1,totalAll:1,nextOffset:null}});assert.equal(await pending,false);assert.equal(h.context.snapshotItems[0].id,"cached");
});
test("refresh failure keeps cached rows and failed append keeps its retry cursor",async()=>{
 const h=harness(),pending=h.context.refreshHistoryPage({append:true});h.reject({code:"gateway_error"});assert.equal(await pending,false);assert.equal(h.context.snapshotItems[0].id,"cached");assert.equal(h.get("historyPageInfo.nextOffset"),24);assert.equal(h.rendered.at(-1).retain,true);assert.equal(h.context.snapshotListInProgress,false);
});
test("Cloud invalid session revokes cached rows",async()=>{
 const h=harness("cloud"),pending=h.context.refreshHistoryPage();h.reject({code:"cloud_sign_in_required"});await pending;assert.equal(h.context.snapshotItems.length,0);assert.equal(h.rendered.at(-1),"auth");
});
test("reload cache is bounded metadata with a correct next page and account scope",()=>{
 const h=harness("cloud");h.context.snapshotItems=Array.from({length:48},(_,i)=>({id:String(i),preview:{blob:true},previewDataUrl:"bytes"}));h.context.cacheHistoryPage();
 const saved=JSON.parse([...h.storage.values()][0]);assert.equal(saved.items.length,24);assert.equal(saved.page.nextOffset,24);assert.equal(saved.items[0].preview,undefined);assert.ok([...h.storage.keys()][0].includes("account-1"));
 h.context.window.PenEchoCloudSettings.cacheIdentity=()=>"account-2";assert.equal(h.context.restoreHistoryPage(),false);
});
for(const identity of ["account-2",""])test(`Cloud identity change to ${identity||"signed out"} revokes rows and in-flight results`,async()=>{
 const h=harness("cloud");h.context.cacheHistoryPage();
 const pending=h.context.refreshHistoryPage();
 h.context.window.PenEchoCloudSettings.cacheIdentity=()=>identity;
 h.context.reconcileHistoryIdentity();
 assert.equal(h.context.snapshotItems.length,0);
 assert.equal(h.get("historyPageController.signal.aborted"),true);
 assert.equal(h.get("historyPageCache.size"),0);
 h.resolve({canvases:[{id:"old-account-canvas"}],page:{total:1,totalAll:1,nextOffset:null}});
 assert.equal(await pending,false);
 assert.equal(h.context.snapshotItems.length,0);
});
