"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../src/client/app/persistence.js"), "utf8");
function extract(name, input = source) {
  const start = input.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0);
  const rest = input.slice(start + 1);
  const end = rest.search(/^  (?:async )?function /m);
  return input.slice(start, end < 0 ? undefined : start + 1 + end);
}
function harness(code, previous = "server") {
  const rendered = [], activity = [];
  const pages = fs.readFileSync(require("node:path").join(__dirname,"../src/client/app/library-pagination.js"),"utf8");
  const context = {
    state:{ snapshotLocation:"server" }, snapshotListGeneration:0, snapshotItemsLocation:previous,
    historyPageKey:previous === "server" ? "view" : "old-view",historyPageInfo:null,historyPageController:null,historyPageError:false,
    historyCurrentPageKey:()=>"view", historyPageOptions:()=>({}), restoreHistoryPage:()=>false,cacheHistoryPage(){},
    updateHistoryPagination(){},AbortController,setTimeout,clearTimeout,
    remoteHistoryPage:async()=>{if(code)throw Object.assign(Error(code),{code});return {canvases:[],projects:[],page:{total:0,totalAll:0,nextOffset:null}};},
    renderSnapshotListError:(location,retained)=>rendered.push({location,retained}),
    snapshotItems:[{id:"old"}], cloudHistoryCache:null, snapshotListInProgress:false,
    serverSnapshotUnavailableKey:"", serverCanvasProjects:[{id:"old"}],
    snapshotsAt:async () => { if (code) throw Object.assign(Error(code), {code}); return []; },
    renderSnapshotListLoading:() => rendered.push("loading"),
    renderSnapshotList:() => rendered.push(context.serverSnapshotUnavailableKey || "empty"),
    setHistoryActivity:() => activity.push("loading"), hideHistoryActivity:() => activity.push("hidden"),
    updateHistoryReadControls:() => {}, t:key => key, snapshotLocationLabel:value => value,
  };
  vm.createContext(context);
  vm.runInContext(extract("refreshHistoryPage",pages)+extract("refreshSnapshots"), context);
  return {context, rendered, activity};
}
for (const code of ["device_offline", "linked_device_required"]) {
  for (const previous of ["server", "cloud", null]) {
    test(`${code} retains only same-location rows from ${previous} and ends loading`, async () => {
      const {context, rendered, activity} = harness(code, previous);
      assert.equal(await context.refreshSnapshots(), false);
      assert.equal(context.serverSnapshotUnavailableKey, code === "device_offline" ? "serverHistoryDeviceOffline" : "serverHistoryDeviceRequired");
      assert.deepEqual(rendered.at(-1), {location:"server",retained:previous === "server"});
      assert.equal(context.snapshotItems.length, previous === "server" ? 1 : 0);
      assert.equal(context.snapshotListInProgress, false);
      assert.equal(activity.at(-1), "hidden");
    });
  }
}
test("successful empty Server read clears an earlier connection notice", async () => {
  const {context, rendered} = harness(null);
  context.serverSnapshotUnavailableKey = "serverHistoryDeviceOffline";
  assert.equal(await context.refreshSnapshots(), true);
  assert.equal(context.serverSnapshotUnavailableKey, "");
  assert.equal(rendered.at(-1), "empty");
});
test("connection notice renders one localized message and a working retry control", async () => {
  const list = {querySelector:()=>null, replaceChildren(...items) { this.children = items; }};
  let retries = 0;
  const context = {
    state:{snapshotLocation:"server"}, serverSnapshotUnavailableKey:"serverHistoryDeviceOffline",
    document:{querySelector:() => list, createElement:tag => ({tag,setAttribute(){},append(...nodes){this.children=nodes;}})},
    renderServerProjectUi(){}, updateHistoryLibrarySummary(){}, peButton(){}, snapshotListInProgress:false, refreshSnapshots:async()=>{retries++;},
    cancelHistoryListRender(){}, releaseHistoryPreviewUrls(){}, updateHistorySelectionUi(){}, window:{},
    t:key => key, snapshotLocationLabel:value => value,
  };
  vm.createContext(context);
  vm.runInContext(extract("renderSnapshotListError"), context);
  context.renderSnapshotListError();
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].tag, "div");
  const [title, detail, retry] = list.children[0].children[0].children;
  assert.equal(detail.textContent, "serverHistoryDeviceOffline");
  assert.equal(title.textContent, "snapshotLibraryUnavailable");
  retry.onclick();
  assert.equal(retries, 1);
  assert.equal(retry.disabled, true);
});
test("list rerender preserves the connection notice while the refresh is settling", () => {
  let shown = "";
  const context = {
    state:{snapshotLocation:"server"}, snapshotItems:[], snapshotItemsLocation:null, historyPageInfo:null,
    snapshotListInProgress:true, snapshotListFailedLocation:null, serverSnapshotUnavailableKey:"serverHistoryDeviceOffline",
    document:{querySelector:selector => selector === "#historyPanel" ? {classList:{contains:() => true}} : {}},
    snapshotItemsForCurrentView:() => [], historySearchQuery:() => "", historySortItems:items => items,
    cancelHistoryListRender(){}, renderServerProjectUi(){}, updateHistoryLibrarySummary(){},
    renderSnapshotListError:() => {shown = "offline";}, renderSnapshotListLoading:() => {shown = "loading";},
  };
  vm.createContext(context);
  vm.runInContext(extract("renderSnapshotList"), context);
  context.renderSnapshotList();
  assert.equal(shown, "offline");
  context.serverSnapshotUnavailableKey = "";
  context.snapshotListFailedLocation = "server";
  context.snapshotListInProgress = false;
  shown = "";
  context.renderSnapshotList();
  assert.equal(shown, "offline", "a gateway failure must survive a search or view rerender");
});

test("gateway failure replaces the old location with one error and hides loading", async () => {
  const {context,rendered,activity} = harness("gateway_error", "cloud");
  context.renderSnapshotListError=(location,retained)=>rendered.push({location,retained});
  assert.equal(await context.refreshSnapshots(),false);
  assert.deepEqual(rendered.at(-1), {location:"server",retained:false});
  assert.equal(context.snapshotItems.length,0);
  assert.equal(context.snapshotListInProgress,false);
  assert.equal(activity.at(-1),"hidden");
  assert.equal(activity.filter(x=>x==="loading").length,0);
});

test("failed refresh keeps same-location cached canvases and shows one inline error", async () => {
  const {context,rendered,activity} = harness("gateway_error", "server");
  context.renderSnapshotListError=(location,retained)=>rendered.push({location,retained});
  assert.equal(await context.refreshSnapshots(),false);
  assert.deepEqual(rendered.at(-1),{location:"server",retained:true});
  assert.equal(context.snapshotItems[0].id,"old");
  assert.equal(activity.at(-1),"hidden");
});

 test("Server list requests lightweight metadata and keeps project membership", async () => {
  const requests=[];
  const context={fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url.includes("canvas-projects")?{projects:[{id:"p",name:"Project"}]}:{canvases:[{id:"c",name:"Canvas",projectId:"p",hasPreview:true,updatedAt:1}]}};},
    AbortSignal, authenticatedApiHeaders:()=>({}), serverCanvasProjects:[], selectedServerProjectId:"p", SERVER_ALL_PROJECTS_ID:"all",SERVER_DEFAULT_PROJECT_ID:"uncategorized",rememberSelectedServerProject(){},dataUrlBlob:()=>{throw Error("metadata must not decode previews");}};
  vm.createContext(context);
  vm.runInContext(extract("snapshotApiResponse")+extract("snapshotJsonBody")+extract("serverSnapshotItems"),context);
  const items=await context.serverSnapshotItems();
  assert.equal(requests[0].url,"/api/canvases?metadataOnly=1");
  assert.ok(requests.every(r=>r.options.signal));
  assert.equal(items[0].projectId,"p");assert.equal(items[0].preview,null);assert.equal(items[0].hasPreview,true);
 });

test("Server previews load only on visibility, at most two at once, and stop on release", async () => {
  let callback, disconnected=false;
  const requests=[];
  const context={historyPreviewLoader:null,historyPreviewUrls:new Map(),
    IntersectionObserver:class {constructor(cb){callback=cb;}observe(){}unobserve(){}disconnect(){disconnected=true;}},
    fetch:(url,options)=>{requests.push({url,options});return new Promise((resolve,reject)=>options.signal.addEventListener("abort",()=>reject(Error("aborted"))));},
    authenticatedApiHeaders:()=>({}),AbortController,setTimeout,clearTimeout,queueMicrotask,
    window:{},snapshotApiResponse:r=>r.json(),dataUrlBlob:()=>{},URL,revokeHistoryPreviewUrlWhenSettled(){} };
  vm.createContext(context);
  vm.runInContext(extract("observeServerHistoryPreview")+extract("releaseHistoryPreviewUrls"),context);
  const targets=[];
  for(let i=0;i<4;i++){const parent={};targets.push(parent);context.observeServerHistoryPreview({id:String(i),hasPreview:true},{parentElement:parent,isConnected:true},{});}
  assert.equal(requests.length,0,"offscreen previews must not start network work");
  callback(targets.map(target=>({target,isIntersecting:true})));
  assert.equal(requests.length,2);
  context.releaseHistoryPreviewUrls();
  assert.ok(disconnected);
  assert.ok(requests.every(r=>r.options.signal.aborted));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,2,"release must discard queued previews");
});
