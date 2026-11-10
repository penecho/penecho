"use strict";
// Browser-only acceptance against an existing runtime. This never starts or
// restarts a PenEcho server and never writes to real Canvas storage.
const {app,BrowserWindow,session,net,nativeTheme}=require("electron");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),origin=process.env.PENECHO_TEST_ORIGIN||"http://127.0.0.1:3921",directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-library-browser-"));
app.setPath("userData",path.join(directory,"profile"));
const report={directory,checks:[],errors:[],requests:[]};let win,releaseList,delayList=false,failList=false;
const canvases=Array.from({length:245},(_,i)=>({id:`1234567890123-canvas-${i}`,name:i===0?"Old needle canvas":"Canvas with a deliberately long localized title 画布长标题 "+i,projectId:"uncategorized",createdAt:i+1,updatedAt:i+1,tileCount:1,widgetCount:0,hasPreview:false}));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){for(let i=0;i<100;i++){if(await check())return;await pause(50);}throw Error("Timed out: "+label);}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});}
app.whenReady().then(async()=>{try{
 const partition=session.fromPartition("library-acceptance");
 await partition.protocol.handle("http",async request=>{
  const url=new URL(request.url);if(url.origin!==origin)return new Response("",{status:403});
  if(url.pathname==="/app.js"){
   const source=fs.readFileSync(path.join(root,"public/app.js"),"utf8").replace(/\}\)\(\);\s*$/,`window.libraryTest={state,setSnapshotLocation,refreshSnapshots,openHistoryPanel,closeHistoryPanel,renderSnapshotList,setHistoryView,historyFiltersChanged,loadMoreHistory,setLanguage:value=>{state.language=value;applyLanguage();},read:()=>({items:snapshotItems.length,busy:snapshotListInProgress,rendering:!!historyListRenderFrame,key:historyPageKey,current:historyCurrentPageKey(),page:historyPageInfo}),setAuto:value=>{historyAutoLoad=value;updateHistoryPagination();},loadCount:0};requestLoadSnapshot=async()=>{window.libraryTest.loadCount++;};})();`);
   return new Response(source,{headers:{"Content-Type":"text/javascript"}});
  }
  if(["/style.css","/locales/zh.js"].includes(url.pathname))return new Response(fs.readFileSync(path.join(root,"public",url.pathname.slice(1))),{headers:{"Content-Type":url.pathname.endsWith("css")?"text/css":"text/javascript"}});
  if(url.pathname==="/api/cloud/status"||url.pathname==="/api/cloud/account")return json({account:{id:"test-account",name:"Test"},accountSession:{signedIn:true},origin,device:{}});
  if(url.pathname==="/api/mcp/status")return json({enabled:false});
  if((url.pathname==="/api/canvases"||url.pathname==="/api/cloud/library")&&url.searchParams.has("limit")){
   report.requests.push(request.url);if(delayList)await new Promise(resolve=>{releaseList=resolve;});if(failList)return json({error:"gateway_error"},503);
   const query=(url.searchParams.get("q")||"").toLowerCase(),items=canvases.filter(item=>item.name.toLowerCase().includes(query)).sort((a,b)=>b.updatedAt-a.updatedAt),offset=Number(url.searchParams.get("offset")),limit=Number(url.searchParams.get("limit"));
   return json({canvases:items.slice(offset,offset+limit),projects:[{id:"uncategorized",name:"Uncategorized",system:true}],page:{total:items.length,totalAll:245,projectCounts:{uncategorized:245},nextOffset:offset+limit<items.length?offset+limit:null},sync:{bundleVersion:2,conflictPolicy:"base-revision-required"}});
  }
  if(request.method!=="GET")return json({error:"read_only_acceptance"},403);
  return net.fetch(request,{bypassCustomProtocolHandlers:true});
 });
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{session:partition,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
 await win.loadURL(origin);const js=code=>win.webContents.executeJavaScript(code,true);
 await until(()=>js("!!window.libraryTest"),"startup");
 await js(`document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();libraryTest.setAuto(false);libraryTest.setHistoryView('list');libraryTest.openHistoryPanel(false);`);
 await js(`libraryTest.setSnapshotLocation('server')`);
 await until(()=>js(`document.querySelectorAll('#historyList .history-card').length===24&&!!document.querySelector('.history-pagination button')`),"first page");
 await until(()=>js("!libraryTest.read().busy&&!libraryTest.read().rendering&&libraryTest.read().key===libraryTest.read().current"),"ready page controls");assert.equal(await js("libraryTest.read().page.total"),245);report.checks.push("First render: 24 of 245 rows");
 await js("window.firstLibraryRow=document.querySelector('.history-card');libraryTest.loadMoreHistory()");
 await until(()=>js(`document.querySelectorAll('#historyList .history-card').length===48`),"second page");
 assert.equal(await js("window.firstLibraryRow===document.querySelector('.history-card')"),true);report.checks.push("Load more appends 24 rows and retains existing DOM");
 delayList=true;await js("void libraryTest.refreshSnapshots()");await until(()=>Boolean(releaseList),"pending refresh");
 assert.equal(await js("document.querySelector('.history-load').disabled"),false);
 await js("document.querySelector('.history-load').click()");assert.equal(await js("libraryTest.loadCount"),1);report.checks.push("Cached Canvas opens while refresh is pending");
 delayList=false;releaseList();await until(()=>js("!libraryTest.read().busy"),"refresh settled");
 await js(`document.querySelector('#historySearch').value='needle';document.querySelector('#historySearch').dispatchEvent(new Event('input'));`);
 await until(()=>js(`document.querySelectorAll('#historyList .history-card').length===1&&document.querySelector('.history-card-title')?.textContent==='Old needle canvas'`),"global search");
 report.checks.push("Search finds a Canvas outside loaded pages");
 await js(`document.querySelector('#historySearch').value='';libraryTest.historyFiltersChanged({immediate:true});`);await until(()=>js("!libraryTest.read().busy&&libraryTest.read().items===24"),"reset search");
 await js(`libraryTest.setAuto(true);document.querySelector('#historyList').scrollTop=100000;`);await until(()=>js("libraryTest.read().items>=48"),"scroll pagination");
 report.checks.push("Scrolling near the bottom automatically loads another page");
 await js("libraryTest.setAuto(false)");
 for(let i=0;i<12;i++){if(await js("libraryTest.read().page.nextOffset===null"))break;await js("libraryTest.loadMoreHistory()");await until(()=>js("!libraryTest.read().busy&&!libraryTest.read().rendering"),"load remaining page");}
 await until(()=>js("document.querySelectorAll('#historyList .history-card').length===245"),"end rows");
 assert.match(await js("document.querySelector('.history-pagination').textContent"),/End of results/);report.checks.push("All 245 rows remain reachable with an end notice");
 await js("libraryTest.setSnapshotLocation('cloud')");await until(()=>js("libraryTest.read().items===24&&!libraryTest.read().busy&&!libraryTest.read().rendering"),"Cloud first page");
 delayList=true;await js("void libraryTest.refreshSnapshots()");await until(()=>Boolean(releaseList),"pending Cloud refresh");
 assert.equal(await js("document.querySelector('.history-load').disabled"),false);assert.equal(await js("document.querySelectorAll('.history-card').length"),24);
 delayList=false;releaseList();await until(()=>js("!libraryTest.read().busy"),"Cloud refresh settled");report.checks.push("Cloud pages and cached Load remain usable during refresh");
 await js("libraryTest.setSnapshotLocation('server')");await until(()=>js("!libraryTest.read().busy"),"back to Server");
 delayList=true;releaseList=null;await new Promise(resolve=>{win.webContents.once("did-finish-load",resolve);win.reload();});await until(()=>js("!!window.libraryTest"),"reload startup");
 await js("libraryTest.setAuto(false);libraryTest.openHistoryPanel(false)");
 await until(()=>js("document.querySelectorAll('.history-card').length===24"),"restored session cache");
 assert.equal(await js("document.querySelector('.history-load').disabled"),false);report.checks.push("Reload restores 24 cached rows while the network request is pending");
 delayList=false;releaseList?.();await until(()=>js("!libraryTest.read().busy"),"reload refresh settled");
 for(const [name,width,height,dark,language,zoom,view] of [["wide-en",1280,900,false,"en",1,"list"],["narrow-zh-dark",390,844,true,"zh",1,"list"],["wide-en-200",1280,900,false,"en",2,"list"],["wide-grid",1280,900,false,"en",1,"grid"],["narrow-grid",390,844,false,"zh",1,"grid"]]){
  nativeTheme.themeSource=dark?"dark":"light";win.setSize(width,height);win.webContents.setZoomFactor(zoom);await js(`document.querySelector('#changelogClose')?.click();document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());libraryTest.openHistoryPanel(false);libraryTest.setLanguage('${language}');document.body.dataset.theme='${dark?"dark":"studio"}';libraryTest.setHistoryView('${view}');`);await until(()=>js("!!document.querySelector('.history-pagination')"),"render localized footer");await js("document.querySelector('#changelogClose')?.click();document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());document.querySelector('#historyList').scrollTop=100000");await until(()=>js("!libraryTest.read().rendering"),"settled rendering");await js("document.querySelector('.history-pagination').scrollIntoView({block:'end',behavior:'instant'})");await until(()=>js("(()=>{const e=document.querySelector('#historyList').getBoundingClientRect(),f=document.querySelector('.history-pagination').getBoundingClientRect();return f.bottom<=e.bottom+1&&f.top>=e.top;})()"),"visible page footer");
  const overflow=await js(`['#historyPanel','#historyList','.history-pagination'].map(selector=>{const e=document.querySelector(selector);return {selector,width:e.clientWidth,scroll:e.scrollWidth};})`);
  assert.ok(overflow.every(item=>item.scroll<=item.width+1),JSON.stringify(overflow));
  fs.writeFileSync(path.join(directory,name+".png"),(await win.webContents.capturePage()).toPNG());report.checks.push(name+": no horizontal overflow");
 }
 console.log(JSON.stringify(report));
}catch(error){report.failure=error.stack;try{report.state=await win.webContents.executeJavaScript("libraryTest.read()");report.geometry=await win.webContents.executeJavaScript("(()=>{const e=document.querySelector('#historyList'),f=document.querySelector('.history-pagination');return {top:e.scrollTop,height:e.scrollHeight,client:e.clientHeight,footer:f?.getBoundingClientRect().toJSON(),list:e.getBoundingClientRect().toJSON(),children:[...e.children].map(x=>x.className)};})()");}catch{}console.error(JSON.stringify(report));process.exitCode=1;}finally{fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));win?.destroy();app.exit(report.failure?1:0);}});
