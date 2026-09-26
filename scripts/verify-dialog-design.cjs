'use strict';
// Render canonical assets with isolated, read-only API fixtures and a fresh profile.
const {app,BrowserWindow,session,nativeTheme}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-dialog-design-'));
app.setPath('userData',path.join(out,'profile'));
let win;const report={out,checks:[],errors:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{try{
 const ses=session.fromPartition('dialog-design');
 ses.webRequest.onBeforeRequest({urls:['https://*/*']},(_details,callback)=>callback({cancel:true}));
 await ses.protocol.handle('http',async req=>{
  const url=new URL(req.url);
  if(url.origin!=='http://dialog.test')return new Response('',{status:403});
  if(url.pathname==='/api/config.js')return new Response('',{headers:{'Content-Type':'text/javascript'}});
  if(url.pathname.startsWith('/api/')){
   const data=url.pathname==='/api/canvases'?{canvases:[],projects:[],page:{total:0,totalAll:0,nextOffset:null}}:url.pathname==='/api/config'?{configured:false,connections:[]}:{};
   return new Response(JSON.stringify(data),{status:req.method==='GET'?200:403,headers:{'Content-Type':'application/json'}});
  }
  const file=path.join(root,'public',url.pathname==='/'?'index.html':url.pathname);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response('',{status:404});
  let data=fs.readFileSync(file);
  if(file.endsWith('/app.js'))data=data.toString().replace(/\}\)\(\);\s*$/, 'window.dialogTest={state,applyLanguage,openHistoryPanel,closeHistoryPanel,maybeShowChangelog};})();');
  return new Response(data,{headers:{'Content-Type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream'}});
 });
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message)});
 await win.loadURL('http://dialog.test');const js=code=>win.webContents.executeJavaScript(code,true);
 for(let i=0;i<100&&!await js('!!window.dialogTest');i++)await pause(50);
 assert.ok(await js('!!window.dialogTest'),'Runtime initialized');
 await js(`document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click()`);
 const inspect=selector=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(e),r=e.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y,radius:s.borderRadius,background:s.backgroundColor,filter:s.backdropFilter,color:s.color,overflow:e.scrollWidth-e.clientWidth}})()`);
 for(const [name,width,height,lang,dark] of [['desktop',1440,1000,'en',false],['narrow',390,844,'zh',false],['short',900,430,'en',false],['system-dark',1280,900,'en',true]]){
  win.setSize(width,height);nativeTheme.themeSource=dark?'dark':'light';await js(`dialogTest.state.language='${lang}';dialogTest.applyLanguage()`);await pause(100);
  for(const [id,expected,radius] of [['historyDeleteDialog',440,'12px'],['projectDialog',560,'14px'],['newCanvasDialog',560,'14px'],['mcpCertificateDialog',560,'14px'],['textHelpDialog',560,'14px'],['canvasAgentProjectPopover',560,'14px']]){
   if(id==='canvasAgentProjectPopover')await js(`document.querySelector('#canvasAgentToggle').click()`);
   await js(`document.querySelector('#${id}').showModal()`);await pause(260);
   const result=await inspect('#'+id);report[name+'-'+id]=result;
   assert.ok(result.width>0&&result.height>0,JSON.stringify(result));assert.ok(result.width<=Math.min(expected,width-32)+1,JSON.stringify(result));assert.equal(result.radius,radius);assert.equal(result.background,'rgb(255, 255, 255)');assert.equal(result.filter,'none');assert.ok(result.overflow<=1,JSON.stringify(result));assert.ok(result.y>=-1&&result.y+result.height<=height+1,JSON.stringify(result));
   if(id==='canvasAgentProjectPopover'){
    const groups=await js(`[...document.querySelectorAll('#canvasAgentProjectPopover .canvas-agent-resource-group')].map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,overflow:e.scrollHeight-e.clientHeight}))`);assert.ok(groups.every(g=>g.overflow<=1),JSON.stringify(groups));assert.ok(groups[1].top>=groups[0].bottom,JSON.stringify(groups));
   }
   if(id==='newCanvasDialog'){
    const geom=await js(`(()=>{const d=document.querySelector('#newCanvasDialog'),h=d.querySelector('header'),b=d.querySelector('.pe-dialog-body'),f=d.querySelector('.new-canvas-actions');b.scrollTop=10000;return {header:h.getBoundingClientRect().height,footer:f.getBoundingClientRect().bottom,dialog:d.getBoundingClientRect().bottom,scroll:getComputedStyle(b).overflowY}})()`);
    assert.ok(Math.abs(geom.header-56)<1);assert.ok(geom.footer<=geom.dialog);assert.equal(geom.scroll,'auto');
   }
   fs.writeFileSync(path.join(out,name+'-'+id+'.png'),(await win.webContents.capturePage()).toPNG());
   if(id==='mcpCertificateDialog'){await js(`document.querySelector('#mcpCertificateClose').click()`);assert.equal(await js(`document.querySelector('#mcpCertificateDialog').open`),false);}else await js(`document.querySelector('#${id}').close()`);
   if(id==='canvasAgentProjectPopover')await js(`document.querySelector('#canvasAgentClose').click()`);
  }
  await js(`document.querySelector('#tourSkip')?.click();dialogTest.maybeShowChangelog(true)`);await pause(300);
  report[name+'-changelog']=await inspect('#changelogDialog');assert.ok(report[name+'-changelog'].width>0&&report[name+'-changelog'].width<=560);
  fs.writeFileSync(path.join(out,name+'-changelog.png'),(await win.webContents.capturePage()).toPNG());await js(`document.querySelector('#changelogClose').click();document.querySelector('#shareCanvasBtn').click()`);await pause(300);
  report[name+'-share']=await inspect('.penecho-live-share-dialog');assert.ok(report[name+'-share'].width>0&&report[name+'-share'].width<=Math.min(560,width-32));
  fs.writeFileSync(path.join(out,name+'-share.png'),(await win.webContents.capturePage()).toPNG());await js(`document.querySelector('.penecho-live-share-dialog .cloud-dialog-close').click()`);
  await js(`document.querySelector('#settingsBtn').click();document.querySelector('#settingsNavCanvas').click()`);await pause(300);
  report[name+'-settings']=await inspect('#settingsPanel');assert.ok(report[name+'-settings'].width<=Math.min(1080,width-32)+1);assert.equal(report[name+'-settings'].background,'rgb(255, 255, 255)');
  fs.writeFileSync(path.join(out,name+'-settings.png'),(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('#settingsClose').click();dialogTest.openHistoryPanel(false)`);await pause(300);
  await js(`document.querySelector('#tourSkip')?.click()`);
  report[name+'-library']=await inspect('#historyPanel');assert.ok(report[name+'-library'].width<=Math.min(1080,width-32)+1,JSON.stringify(report[name+'-library']));
  fs.writeFileSync(path.join(out,name+'-library.png'),(await win.webContents.capturePage()).toPNG());await js(`dialogTest.closeHistoryPanel()`);
  const ink=await js(`getComputedStyle(document.body).getPropertyValue('--pe-ink').trim()`);assert.match(ink,/^#/,'Primary text token resolves without a cycle');
  const contrast=await js(`(()=>{const probe=document.createElement('span');document.body.append(probe);const luminance=rgb=>rgb.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);const values={};for(const token of ['--pe-ink','--pe-ink-2','--pe-ink-3']){probe.style.color='var('+token+')';values[token]=1.05/(luminance(getComputedStyle(probe).color)+.05)}probe.remove();return values})()`);
  for(const ratio of Object.values(contrast))assert.ok(ratio>=4.5,JSON.stringify(contrast));report[name+'-contrast']=contrast;
  report.checks.push(name+': S/M/L bounds, opaque surfaces, body scrolling, close action, resolved text tokens');
 }
 console.log(JSON.stringify(report));
}catch(e){report.failure=e.stack;console.error(JSON.stringify(report));}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));win?.destroy();app.exit(report.failure?1:0)}});
