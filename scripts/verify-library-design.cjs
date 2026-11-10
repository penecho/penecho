"use strict";
// Visual and interaction acceptance using canonical assets and isolated fixtures.
// Existing runtime supplies read-only configuration; document writes are blocked.
const {app,BrowserWindow,session,net,nativeTheme}=require("electron");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),origin=process.env.PENECHO_TEST_ORIGIN||"http://127.0.0.1:3921",directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-library-browser-"));
app.setPath("userData",path.join(directory,"profile"));
const report={directory,checks:[],errors:[]};let win;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){for(let i=0;i<100;i++){if(await check())return;await pause(50);}throw Error("Timed out: "+label);}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});}
app.whenReady().then(async()=>{try{
 const partition=session.fromPartition("library-design-acceptance");
 const names=["Checkout service", "Login sequence", "Physics review · optics", "Self-check quiz · lenses", "Pricing page prototype", "UK journey plan"];
 const fixtures=names.map((name,i)=>({id:`1234567890123-canvas-${i}`,name,projectId:i<4?"project-checkout123":"project-physics123",createdAt:Date.now()-(i+1)*86400000,updatedAt:Date.now()-(i?i*86400000:480000),tileCount:1,widgetCount:0,hasPreview:true}));
 await partition.protocol.handle("http",async request=>{
  const url=new URL(request.url);if(url.origin!==origin)return new Response("",{status:403});
  if(url.pathname==="/app.js"){
   const source=fs.readFileSync(path.join(root,"public/app.js"),"utf8").replace(/\}\)\(\);\s*$/,`window.libraryTest={state,setAll:()=>rememberSelectedServerProject(SERVER_ALL_PROJECTS_ID),setSnapshotLocation,refreshSnapshots,openHistoryPanel,closeHistoryPanel,renderSnapshotList,setHistoryView,historyFiltersChanged,loadMoreHistory,setLanguage:value=>{state.language=value;applyLanguage();},read:()=>({busy:snapshotListInProgress,rendering:!!historyListRenderFrame}),setAuto:value=>{historyAutoLoad=value;updateHistoryPagination();},loadCount:0};requestLoadSnapshot=async()=>{window.libraryTest.loadCount++;};})();`);
   return new Response(source,{headers:{"Content-Type":"text/javascript"}});
  }
  if(url.pathname==="/api/canvases"&&url.searchParams.has("limit"))return json({canvases:fixtures,projects:[{id:"project-checkout123",name:"Checkout redesign"},{id:"project-physics123",name:"Physics review"}],page:{total:6,totalAll:6,projectCounts:{"project-checkout123":4,"project-physics123":2},nextOffset:null}});
  if(/\/api\/canvases\/[^/]+\/preview/.test(url.pathname))return json({preview:"data:image/svg+xml;base64,"+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="384" viewBox="0 0 640 384"><rect width="640" height="384" fill="#f7f8fa"/><g fill="white" stroke="#c7c9ce" stroke-width="2"><path d="M130 192h120m110 0 70-80m-70 80 70 80" fill="none" stroke="#7c8490"/><rect x="60" y="160" width="108" height="64" rx="10"/><rect x="235" y="160" width="116" height="64" rx="10"/><rect x="420" y="76" width="132" height="64" rx="10" fill="#efedff" stroke="#6354ff"/><rect x="420" y="244" width="132" height="64" rx="10"/></g></svg>`).toString("base64")});
  if(request.method!=="GET")return json({error:"read_only_acceptance"},403);
  const filename=path.join(root,"public",url.pathname==="/"?"index.html":url.pathname);
  if(fs.existsSync(filename)&&fs.statSync(filename).isFile())return new Response(fs.readFileSync(filename),{headers:{"Content-Type":filename.endsWith("css")?"text/css":filename.endsWith("js")?"text/javascript":filename.endsWith("html")?"text/html":"application/octet-stream"}});
  return net.fetch(request,{bypassCustomProtocolHandlers:true});
 });
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{session:partition,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
 await win.loadURL(origin);const js=code=>win.webContents.executeJavaScript(code,true);
 await until(()=>js("!!window.libraryTest"),"startup");
 await js(`document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelectorAll('dialog[open]').forEach(d=>d.close());libraryTest.setLanguage('en');document.body.dataset.theme='studio';libraryTest.setAuto(false);libraryTest.openHistoryPanel(false);`);
 await js(`libraryTest.setAll();libraryTest.setSnapshotLocation('server')`);
 await until(()=>js(`document.querySelectorAll('#historyList .history-card').length===6&&!libraryTest.read().busy&&!libraryTest.read().rendering`),"fixtures");
 await js(`libraryTest.setHistoryView('grid');document.querySelector('#historyRecentNav').click()`);
 await until(()=>js(`!libraryTest.read().busy&&!libraryTest.read().rendering`),"recent");await pause(300);
 assert.equal(await js(`[...document.querySelectorAll('.history-more,.history-item-load')].filter(e=>e.getClientRects().length).length`),0);
 await js(`document.querySelector('.history-card-select').click()`);
 assert.equal(await js(`libraryTest.loadCount`),0);
 assert.equal(await js(`[...document.querySelectorAll('.history-more')].filter(e=>e.getClientRects().length).length`),1);
 assert.equal(await js(`[...document.querySelectorAll('.history-item-load')].filter(e=>e.getClientRects().length).length`),1);
 assert.equal(await js(`document.querySelector('.selected .history-item-load').textContent`),'Open now');
 await js(`document.querySelector('.selected .history-item-load').click()`);assert.equal(await js(`libraryTest.loadCount`),1);
 await js(`document.querySelectorAll('.history-card-select')[1].dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);assert.equal(await js(`libraryTest.loadCount`),2);
 await js(`document.querySelectorAll('.history-card-select')[2].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);assert.equal(await js(`libraryTest.loadCount`),3);
 await js(`document.querySelector('.selected .history-more').click()`);assert.equal(await js(`document.querySelector('.selected .history-row-actions').hidden`),false);
 await js(`document.querySelector('.history-card-select').click()`);assert.equal(await js(`document.querySelectorAll('.history-row-actions:not([hidden])').length`),0);
 report.checks.push('Single click selects without opening; Open now, double click and Enter open; only selected actions are visible; selecting another card closes the menu.');
 for(const [name,width,height,dark,language,view] of [["reference-grid",1440,1000,false,"en","grid"],["reference-list",1440,1000,false,"en","list"],["narrow-zh",390,844,false,"zh","grid"],["system-dark-grid",1280,900,true,"en","grid"]]){
  win.setSize(width,height);nativeTheme.themeSource=dark?"dark":"light";await js(`libraryTest.setLanguage('${language}');document.body.dataset.theme='studio';libraryTest.setHistoryView('${view}');`);await until(()=>js(`!libraryTest.read().rendering`),'render');await pause(350);
  await js(`document.querySelector('#changelogClose')?.click();document.querySelector('#tourSkip')?.click();document.querySelector('.history-card-select').click()`);
  const overflow=await js(`[document.querySelector('#historyPanel'),document.querySelector('#historyList')].map(e=>({width:e.clientWidth,scroll:e.scrollWidth}))`);assert.ok(overflow.every(x=>x.scroll<=x.width+1),JSON.stringify(overflow));
  report[name]=await js(`(()=>{const e=document.querySelector('.selected .history-item-load'),c=document.querySelector('.selected'),s=getComputedStyle(e);return {button:e.getBoundingClientRect().toJSON(),card:c.getBoundingClientRect().toJSON(),display:s.display,visibility:s.visibility,opacity:s.opacity,position:s.position,gridArea:s.gridArea,offsetParent:e.offsetParent?.className,hit:document.elementFromPoint(e.getBoundingClientRect().x+5,e.getBoundingClientRect().y+5)?.outerHTML.slice(0,200)}})()`);
  if(name==='reference-grid')assert.equal(await js("getComputedStyle(document.querySelector('#historyList')).gridTemplateColumns.split(' ').length"),3,'Desktop Library has three columns');
  if(view==='grid') { const g=report[name]; assert.ok(g.button.top>=g.card.top&&g.button.top<g.card.top+40,JSON.stringify(g));assert.match(g.hit,/^<button/); }
  fs.writeFileSync(path.join(directory,name+".png"),(await win.webContents.capturePage()).toPNG());report.checks.push(name+': no horizontal overflow');
 }
 await js(`libraryTest.state.currentSnapshotId='1234567890123-canvas-0';libraryTest.state.currentSnapshotLocation='server';libraryTest.renderSnapshotList()`);
 await until(()=>js(`!libraryTest.read().rendering`),'current canvas');
 await js(`document.querySelector('.history-card-select').click();document.querySelector('.selected .history-item-load').click()`);
 assert.equal(await js(`document.querySelector('#historyPanel').classList.contains('open')`),false);
 assert.equal(await js(`libraryTest.loadCount`),3);
 report.checks.push('Open now on the current Canvas returns to the editor without reloading or saving the document.');
 console.log(JSON.stringify(report));
}catch(error){report.failure=error.stack;try{report.state=await win.webContents.executeJavaScript("({state:libraryTest.read(),text:document.querySelector('#historyList').innerText})");fs.writeFileSync(path.join(directory,'failure.png'),(await win.webContents.capturePage()).toPNG());}catch{}console.error(JSON.stringify(report));process.exitCode=1;}finally{fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));win?.destroy();app.exit(report.failure?1:0);}});
