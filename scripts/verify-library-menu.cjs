"use strict";
// Canonical assets, isolated profile and API fixtures; no real document access.
const {app,BrowserWindow,session,nativeTheme}=require("electron");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-library-menu-"));
app.setPath("userData",path.join(directory,"profile"));
let win;const report={directory,checks:[],errors:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<100;i++){if(await check())return;await pause(50);}throw Error("Timed out: "+label);}
app.whenReady().then(async()=>{try{
 const partition=session.fromPartition("library-menu");
 partition.webRequest.onBeforeRequest({urls:["https://*/*"]},(_details,callback)=>callback({cancel:true}));
 const fixtures=Array.from({length:24},(_,i)=>({id:`1234567890123-canvas-${i}`,name:["Checkout service","Login sequence","Physics review · optics"][i%3]+` ${i+1}`,projectId:"project-checkout123",createdAt:Date.now()-i*86400000,updatedAt:Date.now()-i*86400000,tileCount:2,widgetCount:1}));
 await partition.protocol.handle("http",async request=>{
  const url=new URL(request.url);if(url.origin!=="http://library.test")return new Response("",{status:403});
  if(url.pathname==="/api/config.js")return new Response("",{headers:{"Content-Type":"text/javascript"}});
  if(url.pathname.startsWith("/api/")){
   const data=url.pathname==="/api/canvases"?{canvases:fixtures,projects:[{id:"project-checkout123",name:"Checkout redesign"},{id:"project-physics123",name:"Physics review with a very long project name"}],page:{total:24,totalAll:24,projectCounts:{"project-checkout123":24,"project-physics123":0},nextOffset:null}}:url.pathname==="/api/config"?{configured:false,connections:[]}:{};
   return new Response(JSON.stringify(data),{status:request.method==="GET"?200:403,headers:{"Content-Type":"application/json"}});
  }
  const file=path.join(root,"public",url.pathname==="/"?"index.html":url.pathname);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response("",{status:404});
  let data=fs.readFileSync(file);
  if(file.endsWith("/app.js"))data=data.toString().replace(/\}\)\(\);\s*$/,`window.menuTest={state,setAll:()=>rememberSelectedServerProject(SERVER_ALL_PROJECTS_ID),setSnapshotLocation,openHistoryPanel,closeHistoryPanel,setHistoryView,setLanguage:value=>{state.language=value;applyLanguage();},ready:()=>!snapshotListInProgress&&!historyListRenderFrame,moves:[]};moveServerSnapshot=async(id,project)=>{window.menuTest.moves.push({id,project});};})();`);
  return new Response(data,{headers:{"Content-Type":file.endsWith(".css")?"text/css":file.endsWith(".js")?"text/javascript":file.endsWith(".html")?"text/html":"application/octet-stream"}});
 });
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{session:partition,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
 await win.loadURL("http://library.test");const js=code=>win.webContents.executeJavaScript(code,true);
 await until(()=>js("!!window.menuTest"),"startup");
 await js(`document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelectorAll('dialog[open]').forEach(d=>d.close());menuTest.setLanguage('en');document.body.dataset.theme='studio';menuTest.openHistoryPanel(false);menuTest.setAll();menuTest.setSnapshotLocation('server');`);
 await until(()=>js(`menuTest.ready()&&document.querySelectorAll('#historyList .history-card').length===24`),"fixtures");
 async function open(index){
  await js(`(()=>{const card=document.querySelectorAll('#historyList .history-card')[${index}];card.scrollIntoView({block:'nearest'});card.querySelector('.history-card-select').click();})()`);
  await pause(100);
  await js(`document.querySelector('.selected .history-more').click()`);
  await pause(50);
 }
 async function inspect(){return js(`(()=>{const menu=document.querySelector('.history-row-actions:not([hidden])'),r=menu.getBoundingClientRect(),trigger=document.querySelector('.selected .history-more').getBoundingClientRect();return {topLayer:menu.matches(':popover-open'),placement:menu.dataset.pePlacement,rect:r.toJSON(),trigger:trigger.toJSON(),viewport:{width:innerWidth,height:innerHeight},hits:[...menu.querySelectorAll('button,select')].map(e=>{const b=e.getBoundingClientRect();return {name:e.className,hit:e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};}),overflow:menu.scrollWidth-menu.clientWidth};})()`);}
 function visible(result){assert.equal(result.topLayer,true);assert.ok(result.hits.every(x=>x.hit),JSON.stringify(result));assert.ok(result.rect.x>=0&&result.rect.y>=0&&result.rect.right<=result.viewport.width+1&&result.rect.bottom<=result.viewport.height+1,JSON.stringify(result));assert.ok(result.overflow<=1,JSON.stringify(result));assert.ok(Math.abs(result.rect.right-result.trigger.right)<2,JSON.stringify(result));}
 for(const [name,width,height,view,language,scale,dark] of [
  ["list",1440,1000,"list","en",1,false],
  ["grid",1440,1000,"grid","en",1,false],
  ["scaled-list",1440,1000,"list","en",1.25,false],
  ["narrow-zh",390,844,"grid","zh",1,false],
  ["short-list",900,500,"list","en",1,false],
  ["dark-grid",1280,900,"grid","en",1,true],
 ]){
  win.setSize(width,height);nativeTheme.themeSource=dark?"dark":"light";
  await js(`PenEchoPageScale.apply(${scale});menuTest.setLanguage('${language}');menuTest.setHistoryView('${view}');`);
  await until(()=>js("menuTest.ready()"),"render");await pause(500);
  await open(0);let result=await inspect();visible(result);report[name+"-first"]=result;
  if(view==="list"&&height===1000)assert.equal(result.placement,"bottom");
  fs.writeFileSync(path.join(directory,name+"-first.png"),(await win.webContents.capturePage()).toPNG());
  if(name==="list")fs.writeFileSync(path.join(directory,"menu-detail.png"),(await win.webContents.capturePage({x:Math.floor(result.rect.x-150),y:Math.floor(result.trigger.y-35),width:420,height:300})).toPNG());
  await js(`document.querySelector('.history-row-actions:not([hidden]) .history-rename').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await js(`document.querySelectorAll('.history-row-actions:popover-open').length`),0);
  assert.equal(await js(`document.activeElement.matches('.selected .history-more')`),true);
  await open(23);result=await inspect();visible(result);assert.equal(result.placement,"top");report[name+"-last"]=result;
  fs.writeFileSync(path.join(directory,name+"-last.png"),(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('#historyList').scrollTop-=40`);await pause(100);
  assert.equal(await js(`document.querySelectorAll('.history-row-actions:popover-open').length`),0);
  report.checks.push(name+": first/last row visible and clickable; viewport bounds, trigger alignment, Escape focus and scroll dismissal pass");
 }
 // Verify the actions still dispatch to the selected Canvas.
 await open(0);await js(`const move=document.querySelector('.selected .history-move');move.value='project-physics123';move.dispatchEvent(new Event('change',{bubbles:true}));`);
 assert.deepEqual(await js("menuTest.moves"),[{id:fixtures[0].id,project:"project-physics123"}]);
 await open(0);await js(`document.querySelector('.selected .history-rename').click()`);
 assert.ok(await js(`!!document.querySelector('.selected .history-rename-input')`));
 await js(`document.querySelector('.history-rename-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 await open(0);await js(`document.querySelector('.selected .history-delete').click()`);
 assert.equal(await js(`document.querySelector('#historyDeleteDialog').open`),true);
 assert.equal(await js(`document.querySelectorAll('.history-row-actions:popover-open').length`),0);
 await js(`document.querySelector('#historyDeleteDialog').close()`);
 await open(0);await js(`document.querySelector('#historyPanel').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
 assert.equal(await js(`document.querySelectorAll('.history-row-actions:popover-open').length`),0);
 await open(0);win.setSize(1200,860);await pause(100);
 assert.equal(await js(`document.querySelectorAll('.history-row-actions:popover-open').length`),0);
 await open(0);await js(`menuTest.closeHistoryPanel()`);
 assert.equal(await js(`document.querySelectorAll('.history-row-actions:popover-open').length`),0);
 report.checks.push("Rename, move and delete dispatch; outside click, resize and Library close dismiss the popover");
 assert.deepEqual(report.errors,[]);
 }catch(error){report.failure=error.stack;try{fs.writeFileSync(path.join(directory,"failure.png"),(await win.webContents.capturePage()).toPNG());}catch{}}
 finally{fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win?.destroy();app.exit(report.failure?1:0);}
});
