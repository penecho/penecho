'use strict';
// Render the live share dialog from canonical assets with isolated API fixtures,
// a disposable profile, blocked external network, and an in-page clipboard stub.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-social-sharing.cjs [--output=docs/verification/social-sharing-YYYYMMDD]
// Without --output, screenshots and report.json go to a new temporary directory.
const {app,BrowserWindow,session,nativeTheme}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||fs.mkdtempSync(path.join(os.tmpdir(),'penecho-social-sharing-')));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-social-profile-'));
fs.mkdirSync(out,{recursive:true});app.setPath('userData',profile);
const CANVAS='123e4567-e89b-42d3-a456-426614174101',SOURCE='123e4567-e89b-42d3-a456-426614174102';
const report={out,
 // What is real and what is simulated, so screenshots are not mistaken for live Cloud evidence.
 provenance:{
  assets:'canonical public/ files served through an intercepted http://share.test origin; app.js only gains a test hook exposing state and applyLanguage',
  api:'mocked in this script: /api/cloud/status and /api/cloud/account report a signed-in account; /api/cloud/canvases/:id/share GET/POST/DELETE use an in-memory map keyed by Canvas and optional widgetId; other /api/ GETs return empty fixtures',
  cloudProjects:'window.PenEchoCloudProjects is replaced with a stub: fixed Canvas id after saveForShare, hasShareableContent true, verify-widget maps to a fixed share source id',
  network:'every https:// and wss:// request is cancelled; no Cloud, X, or LinkedIn page is contacted',
  outbound:'X and LinkedIn are clicked with real input events; webContents.setWindowOpenHandler records the requested URL and referrer, then denies the window',
  clipboard:'navigator.clipboard is replaced in-page by a recorder; the system clipboard is untouched',
  nativeShare:'Electron exposes no navigator.share; the More… screenshot and AbortError check use an in-page stub',
  profile:'temporary userData directory, removed when the run ends',
 },
 inputs:Object.fromEntries(['app.js','cloud-connect.js','cloud-connect.css','studio-shell.css','style.css'].map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'public',file))).digest('hex')])),checks:[],opened:[],layouts:{},errors:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const shares=new Map();let win;
app.whenReady().then(async()=>{try{
 const ses=session.fromPartition('social-sharing');
 ses.webRequest.onBeforeRequest({urls:['https://*/*','wss://*/*']},(_details,callback)=>callback({cancel:true}));
 await ses.protocol.handle('http',async request=>{
  const url=new URL(request.url),json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(url.origin!=='http://share.test')return new Response('',{status:403});
  if(url.pathname==='/api/config.js')return new Response('',{headers:{'Content-Type':'text/javascript'}});
  if(url.pathname==='/api/cloud/status'||url.pathname==='/api/cloud/account')return json({account:{id:'verify-account',name:'Verify User'},accountSession:{signedIn:true},device:{configured:false},browserSignIn:{pending:false}});
  const share=url.pathname.match(/^\/api\/cloud\/canvases\/([0-9a-f-]{36})\/share$/i);
  if(share){
   const body=request.method==='GET'?{}:JSON.parse(await request.text()||'{}'),key=`${share[1]}:${url.searchParams.get('widgetId')||body.widgetId||''}`;
   if(request.method==='POST')shares.set(key,{url:`/canvas/share/${require('node:crypto').randomUUID()}`});
   if(request.method==='DELETE')shares.delete(key);
   return json({share:shares.get(key)||null});
  }
  if(url.pathname.startsWith('/api/')){
   const data=url.pathname==='/api/canvases'?{canvases:[],projects:[],page:{total:0,totalAll:0,nextOffset:null}}:url.pathname==='/api/config'?{configured:false,connections:[]}:{};
   return json(data,request.method==='GET'?200:403);
  }
  const file=path.join(root,'public',url.pathname==='/'?'index.html':url.pathname);
  if(!file.startsWith(path.join(root,'public'))||!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response('',{status:404});
  let data=fs.readFileSync(file);
  if(file.endsWith('/app.js'))data=data.toString().replace(/\}\)\(\);\s*$/,'window.shareTest={state,applyLanguage};})();');
  return new Response(data,{headers:{'Content-Type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream'}});
 });
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on('console-message',(event,level,message)=>{const error=event?.level==='error'||level>=3;if(error)report.errors.push(event?.message||message);});
 // Outbound links must open from the real click and carry no referrer.
 win.webContents.setWindowOpenHandler(details=>{report.opened.push({url:details.url,disposition:details.disposition,referrer:details.referrer?.url||''});return {action:'deny'};});
 await win.loadURL('http://share.test/');
 const js=async code=>{
  const result=await win.webContents.executeJavaScript(`(async()=>{try{return await (0,eval)(${JSON.stringify(code)})}catch(error){return {__verificationError:String(error.stack||error)}}})()`,true);
  if(result?.__verificationError)throw Error(result.__verificationError);
  return result;
 };
 for(let i=0;i<100&&!await js('!!window.shareTest');i++)await pause(50);
 assert.ok(await js('!!window.shareTest'),'Runtime initialized');
 await js(`document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
  document.querySelector('#canvasDocumentNameLabel').textContent='Quarterly research map — cell membranes & transport';
  window.verifyCopied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.verifyCopied.push(String(value));}}});
  window.PenEchoCloudProjects={...window.PenEchoCloudProjects,currentCanvasId:()=>window.verifyCanvasId||null,hasShareableContent:()=>true,
   shareWidgetId:id=>id==='verify-widget'?'${SOURCE}':null,saveForShare:async()=>{window.verifyCanvasId='${CANVAS}';return window.verifyCanvasId;}};void 0;`);
 const shot=async name=>{await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await pause(80);fs.writeFileSync(path.join(out,`${name}.png`),(await win.webContents.capturePage()).toPNG());};
 const settle=async(check,label)=>{for(let i=0;i<60;i++){if(await js(check))return;await pause(50);}throw Error(`Timed out: ${label}`);};
 // Geometry: the dialog fits, nothing scrolls sideways, every visible control is legible and reachable.
 const layout=name=>js(`(()=>{const d=document.querySelector('.penecho-live-share-dialog'),r=d.getBoundingClientRect(),body=d.querySelector('[data-pe-region="body"]'),s=getComputedStyle(d);
  const controls=[...d.querySelectorAll('button,a,input,textarea')].filter(n=>n.getClientRects().length).map(n=>{const b=n.getBoundingClientRect();return {label:(n.getAttribute('aria-label')||n.textContent||n.tagName).trim().slice(0,40),w:Math.round(b.width),h:Math.round(b.height),clipped:n.dataset.peButton!=='icon'&&n.tagName!=='INPUT'&&n.tagName!=='TEXTAREA'&&n.scrollWidth>n.clientWidth+1,outside:b.left<r.left-1||b.right>r.right+1}});
  const luminance=c=>c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((t,v,i)=>t+v*[.2126,.7152,.0722][i],0);
  const contrast=(fg,bg)=>{const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  const texts=[...d.querySelectorAll('.live-share-scope span,.live-share-post-field small,.live-share-image-note span,h2')].filter(n=>n.getClientRects().length).map(n=>{let bg='rgba(0, 0, 0, 0)',e=n;while(e&&/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)){bg=getComputedStyle(e).backgroundColor;e=e.parentElement;}return +contrast(getComputedStyle(n).color,bg).toFixed(2);});
  return {name:${JSON.stringify(name)},width:Math.round(r.width),height:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom),viewport:[innerWidth,innerHeight],background:s.backgroundColor,bodyOverflowX:body.scrollWidth-body.clientWidth,controls,minContrast:Math.min(...texts),targets:[...d.querySelectorAll('.live-share-target')].map(n=>n.dataset.shareTarget),state:d.dataset.liveShare}})()`);
 const check=(result,{active})=>{
  report.layouts[result.name]=result;
  assert.ok(result.width<=Math.min(560,result.viewport[0]-32)+1,`${result.name} width ${JSON.stringify(result)}`);
  assert.ok(result.top>=0&&result.bottom<=result.viewport[1],`${result.name} fits vertically`);
  assert.ok(result.bodyOverflowX<=1,`${result.name} has no sideways scrolling`);
  for(const control of result.controls){assert.ok(!control.clipped&&!control.outside,`${result.name} control ${JSON.stringify(control)}`);assert.ok(control.h>=28,`${result.name} target height ${JSON.stringify(control)}`);}
  assert.ok(result.minContrast>=4.5,`${result.name} text contrast ${result.minContrast}`);
  if(active)assert.deepEqual(result.targets.slice(0,2),['x','linkedin'],`${result.name} targets`);
  else assert.deepEqual(result.targets,[],`${result.name} offers no outbound targets while inactive`);
 };
 const clickAt=async selector=>{
  const box=await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseDown',x:box.x,y:box.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:box.x,y:box.y,button:'left',clickCount:1});await pause(250);
 };
 const scenarios=[['desktop-en',1440,1000,'en',false],['narrow-zh',390,844,'zh',false],['short-en',900,560,'en',false],['system-dark-en',1280,900,'en',true]];
 for(const [name,width,height,lang,dark] of scenarios){
  shares.clear();win.setSize(width,height);nativeTheme.themeSource=dark?'dark':'light';
  await js(`shareTest.state.language='${lang}';document.documentElement.lang='${lang}';window.verifyCanvasId=null;document.querySelector('.penecho-cloud-overlay')?.remove();`);await pause(150);
  await js(`document.querySelector('#shareCanvasBtn').click()`);await settle(`!!document.querySelector('.penecho-live-share-dialog [data-pe-button="primary"]:not(:disabled)')`,'inactive dialog');
  check(await layout(`${name}-canvas-inactive`),{active:false});await shot(`${name}-canvas-inactive`);
  await js(`document.querySelector('.penecho-live-share-dialog [data-pe-button="primary"]').click()`);await settle(`document.querySelector('.penecho-live-share-dialog')?.dataset.liveShare==='on'&&!!document.querySelector('[data-share-target="x"][href]')`,'active share');
  check(await layout(`${name}-canvas-active`),{active:true});await shot(`${name}-canvas-active`);
  if(name==='desktop-en'){
   // Keyboard: Tab stays inside the dialog and reaches every share control in order.
   win.webContents.focus();await js(`document.querySelector('.penecho-live-share-dialog .cloud-dialog-close').focus()`);
   const order={seen:[],inside:true};
   for(let i=0;i<16;i++){
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await pause(40);
    const focus=await js(`(()=>{const e=document.activeElement,d=document.querySelector('.penecho-live-share-dialog');return {name:e.dataset.shareTarget||(e.tagName==='TEXTAREA'?'post':e.tagName==='INPUT'?'link':(e.textContent||e.getAttribute('aria-label')||e.tagName).trim().slice(0,24)),inside:d.contains(e)}})()`);
    order.seen.push(focus.name);order.inside&&=focus.inside;
   }
   report.keyboard=order;assert.ok(order.inside,`focus stays in the dialog ${JSON.stringify(order)}`);for(const target of ['link','post','Copy post','x','linkedin','Turn off sharing','Copy link'])assert.ok(order.seen.includes(target),`Tab reaches ${target}: ${JSON.stringify(order.seen)}`);
   // Real pointer clicks: the browser opens each intent from the gesture itself.
   await js(`(()=>{const t=document.querySelector('.penecho-live-share-dialog textarea');t.value='Field notes & a #map — try it';t.dispatchEvent(new Event('input'));})()`);
   await clickAt('[data-share-target="x"]');await clickAt('[data-share-target="linkedin"]');
   const x=report.opened.find(entry=>entry.url.startsWith('https://x.com/')),linkedin=report.opened.find(entry=>entry.url.startsWith('https://www.linkedin.com/'));
   assert.ok(x&&linkedin,`outbound windows ${JSON.stringify(report.opened)}`);
   const publicUrl=await js(`document.querySelector('.penecho-live-share-dialog input').value`),xParams=new URL(x.url).searchParams;
   assert.equal(xParams.get('text'),'Field notes & a #map — try it');assert.equal(xParams.get('url'),publicUrl);assert.equal(new URL(linkedin.url).searchParams.get('url'),publicUrl);
   assert.equal(x.referrer,'');assert.equal(linkedin.referrer,'');
   await clickAt('.live-share-copy-post');
   assert.deepEqual(await js('window.verifyCopied'),['Field notes & a #map — try it',`Field notes & a #map — try it\n${publicUrl}`],'LinkedIn copies the text; Copy post copies text and link');
   // Simulated system share sheet: Electron has no navigator.share, so cancellation is stubbed.
   await js(`navigator.share=()=>Promise.reject(new DOMException('closed','AbortError'));navigator.canShare=()=>true;document.querySelector('.penecho-live-share-dialog textarea').dispatchEvent(new Event('input'));`);
   await settle(`!!document.querySelector('[data-share-target="system"]')`,'system share');await shot(`${name}-canvas-active-system-share`);
   await clickAt('[data-share-target="system"]');assert.match(await js(`document.querySelector('.penecho-live-share-dialog [role="status"]').textContent`),/cancelled/);
   await js('delete navigator.share;delete navigator.canShare');
   report.checks.push('desktop: Tab order and trap, real-gesture X/LinkedIn opens with no referrer, encoded intent params, LinkedIn text copy, Copy post text+link, simulated AbortError');
  }
  await js(`(()=>{const b=[...document.querySelectorAll('.penecho-live-share-dialog button')].find(n=>/Turn off sharing|关闭分享/.test(n.textContent));b.focus();b.click();})()`);
  await settle(`document.querySelector('.penecho-live-share-dialog')?.dataset.liveShare==='off'&&!document.querySelector('.penecho-live-share-dialog [role="status"]')?.textContent.match(/Working|正在处理/)`,'revoked');
  const revoked=await js(`(()=>{const d=document.querySelector('.penecho-live-share-dialog');return {outbound:d.querySelectorAll('a[target=_blank]').length,focus:document.activeElement?.dataset.peButton,status:d.querySelector('[role="status"]').textContent}})()`);
  assert.equal(revoked.outbound,0);assert.equal(revoked.focus,'primary');report.layouts[`${name}-revoked`]=revoked;await shot(`${name}-canvas-revoked`);
  await js(`document.querySelector('.penecho-live-share-dialog .cloud-dialog-close').click()`);
  // In-Canvas note card share: the Widget dialog carries the note title and kind.
  if(name==='desktop-en'||name==='narrow-zh'){
   shares.set(`${CANVAS}:${SOURCE}`,{url:'/canvas/share/note-token'});
   await js(`window.dispatchEvent(new CustomEvent('penecho:community-widget-action',{detail:{action:'share',widgetId:'verify-widget',title:'PenEcho 项目架构：四层分层、模型执行器与关键约束',noteKind:'card'}}))`);
   await settle(`document.querySelector('.penecho-live-share-dialog')?.dataset.liveShare==='on'`,'note share');
   const note=await layout(`${name}-note-active`);await shot(`${name}-note-active`);check(note,{active:true});
   assert.match(await js(`document.querySelector('.penecho-live-share-dialog h2').textContent`),lang==='zh'?/分享知识卡片/:/Share knowledge card/);
   await js(`document.querySelector('.penecho-live-share-dialog .cloud-dialog-close').click()`);
  }
  report.checks.push(`${name}: inactive/active/revoked bounds, no sideways scroll, unclipped >=28px controls, text contrast >=4.5, outbound only while active, focus kept after revoke`);
 }
 // Base-theme token fallback: the dialog stays legible when Studio tokens are absent.
 win.setSize(1280,900);nativeTheme.themeSource='light';shares.clear();
 await js(`shareTest.state.language='en';document.documentElement.lang=shareTest.state.language;window.verifyCanvasId='${CANVAS}';document.body.dataset.theme='verify-base';`);
 shares.set(`${CANVAS}:`,{url:'/canvas/share/base-token'});
 await js(`document.querySelector('#shareCanvasBtn').click()`);await settle(`document.querySelector('.penecho-live-share-dialog')?.dataset.liveShare==='on'`,'base theme');
 const base=await layout('base-theme-active');report.layouts['base-theme-active']=base;assert.ok(base.minContrast>=4.5,`base theme contrast ${base.minContrast}`);await shot('base-theme-active');
 report.checks.push('base theme: fallback tokens keep dialog text at >=4.5 contrast');
 assert.deepEqual(report.errors.filter(message=>!/ERR_BLOCKED|net::|Failed to load resource/.test(message)),[],'no console errors');
 console.log(JSON.stringify({out,checks:report.checks,opened:report.opened.length},null,1));
}catch(error){report.failure=error.stack;console.error(error.stack);}finally{
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));win?.destroy();
 try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
 app.exit(report.failure?1:0);
}});
