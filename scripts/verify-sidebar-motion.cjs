'use strict';
// Local canonical assets, isolated profile, no writes to the running service.
const {app,BrowserWindow,session,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:3921',label=process.env.MOTION_LABEL||'after',out=path.join(root,'test-results/sidebar-motion');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'penecho-motion-')));
const pause=ms=>new Promise(r=>setTimeout(r,ms)),cpuThrottle=Number(process.env.MOTION_CPU||4),allowGaps=Boolean(process.env.MOTION_ALLOW_GAPS)||process.env.MOTION_SOURCE==='baseline';let win;
const fixtures=Array.from({length:36},(_,i)=>({id:'1234567890123-motion-'+i,name:'Motion acceptance canvas '+(i+1),createdAt:1700000000000+i,updatedAt:1700000000000+i,hasPreview:true,projectId:'default'}));
const thumbnail='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250"><rect width="400" height="250" fill="white"/><g fill="white" stroke="#6554ff"><rect x="30" y="80" width="100" height="70"/><rect x="260" y="80" width="100" height="70"/><path d="M130 115h130"/></g></svg>').toString('base64');
app.whenReady().then(async()=>{try{
 const partition=session.fromPartition('sidebar-motion');
 await partition.protocol.handle('http',async request=>{
  const u=new URL(request.url);if(u.origin!==origin||request.method!=='GET')return new Response('{}',{status:403});
  const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  if(u.pathname==='/api/canvases')return json({canvases:fixtures});
  if(u.pathname==='/api/canvas-projects')return json({projects:[{id:'default',name:'Acceptance',system:true}]});
  if(u.pathname==='/api/cloud/library')return json({canvases:[],projects:[],sync:{bundleVersion:2,conflictPolicy:'base-revision-required'}});
  if(/^\/api\/canvases\/1234567890123-motion-\d+\/preview$/.test(u.pathname))return json({preview:thumbnail});
  const filename=path.join(root,'public',u.pathname==='/'?'index.html':u.pathname);
  if(fs.existsSync(filename)&&fs.statSync(filename).isFile()){
   const override=process.env.MOTION_ASSETS&&path.join(path.resolve(process.env.MOTION_ASSETS),u.pathname);
   let bytes=override&&fs.existsSync(override)&&fs.statSync(override).isFile()?fs.readFileSync(override):process.env.MOTION_SOURCE==='baseline'&&['/app.js','/studio-shell.js','/studio-shell.css','/style.css'].includes(u.pathname)?require('node:child_process').execFileSync('git',['show','7f1a80f:public'+u.pathname],{cwd:root,maxBuffer:32*1024*1024}):fs.readFileSync(filename);
   if(u.pathname==='/app.js')bytes=bytes.toString().replace('function fit() {','function fit() { window.motionFitCount=(window.motionFitCount||0)+1; const motionFitStart=performance.now();').replace('    requestRender();\n  }\n  function fitViewerCanvas()', '    requestRender(); (window.motionFitTimes??=[]).push(performance.now()-motionFitStart);\n  }\n  function fitViewerCanvas()').replace(/\}\)\(\);\s*$/,`window.motionTest={open:()=>openCanvasAgent({focus:false,connect:false}),close:()=>closeCanvasAgent({focus:false}),state,canvasAgent};})();`);
   if(u.pathname==='/studio-shell.js')bytes=bytes.toString().replace('function layoutDock() {','function layoutDock() { window.motionDockCount=(window.motionDockCount||0)+1; const motionDockStart=performance.now();').replace('      delete body.dataset.shellDockMeasuring;', '      delete body.dataset.shellDockMeasuring; (window.motionDockTimes??=[]).push(performance.now()-motionDockStart);');
   return new Response(bytes,{headers:{'Content-Type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.html')?'text/html':'application/octet-stream'}});
  }
  return net.fetch(request,{bypassCustomProtocolHandlers:true});
 });
 win=new BrowserWindow({show:process.env.MOTION_VISIBLE==='1',width:1440,height:1000,webPreferences:{session:partition,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await win.loadURL(origin);const js=s=>win.webContents.executeJavaScript(s,true);
 for(let i=0;i<100&&!await js('!!window.motionTest');i++)await pause(80);
 await js(`document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.body.dataset.theme='studio';window.motionErrors=[];addEventListener('error',e=>motionErrors.push(e.message));PenEchoStudioNavigator.setOpen(true);`);await pause(1500);
 win.webContents.debugger.attach('1.3');const cdp=(method,params)=>win.webContents.debugger.sendCommand(method,params);await cdp('Performance.enable');const trace=[];if(process.env.MOTION_TRACE){win.webContents.debugger.on('message',(_e,method,params)=>{if(method==='Tracing.dataCollected')trace.push(...params.value);});await cdp('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline.stack,disabled-by-default-devtools.timeline.invalidationTracking,v8.execute',options:'record-as-much-as-possible'});}await cdp('Emulation.setCPUThrottlingRate',{rate:cpuThrottle});
 const metrics=async()=>Object.fromEntries((await cdp('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 await js(`window.motionGeometry=()=>{const f=document.querySelector('.canvas-frame').getBoundingClientRect(),n=document.querySelector('#studioNavigator').getBoundingClientRect(),v=document.querySelector('#viewport').getBoundingClientRect(),s=document.querySelector('#screen').getBoundingClientRect(),a=document.querySelector('#canvasAgentPanel').getBoundingClientRect(),z=document.querySelector('#canvasZoomControls').getBoundingClientRect();const left=Math.max(f.left,n.right),right=Math.min(f.right,a.left);return {leftGap:Math.max(0,v.left-left,s.left-left),rightGap:Math.max(0,right-v.right,right-s.right),zoomX:z.x,zoomY:z.y,running:window.PenEchoShellMotion?.isRunning()||false};};void 0;`);
 const runs=[],canvasBefore=await js('JSON.stringify([motionTest.state.panX,motionTest.state.panY,motionTest.state.scale,motionTest.state.userRevision])');
 for(let round=0;round<Number(process.env.MOTION_ROUNDS||3);round++)for(const [name,action] of [['left-close','PenEchoStudioNavigator.setOpen(false)'],['left-open','PenEchoStudioNavigator.setOpen(true)'],['right-open','motionTest.open()'],['right-close','motionTest.close()']]){
  await pause(400);const before=await metrics();
  const samples=await js(`new Promise(resolve=>{const times=[],widths=[],positions=[],geometry=[],start=performance.now(),fits=window.motionFitCount||0,docks=window.motionDockCount||0;${action};function tick(now){times.push(now);widths.push(document.querySelector('#viewport').clientWidth);const panel=document.querySelector('${name.startsWith('left')?'#studioNavigator':'#canvasAgentPanel'}');positions.push(panel.getBoundingClientRect().x);geometry.push(motionGeometry());if(now-start<380)requestAnimationFrame(tick);else resolve({times,widths,positions,geometry,fits:(window.motionFitCount||0)-fits,docks:(window.motionDockCount||0)-docks});}requestAnimationFrame(tick);})`);
  const after=await metrics(),gaps=samples.times.slice(1).map((t,i)=>t-samples.times[i]);
  const maxGap=Math.max(...samples.geometry.flatMap(g=>[g.leftGap,g.rightGap]));
  const moving=samples.geometry.filter(g=>g.running),chromeDrift=Math.max(0,...moving.map(g=>Math.hypot(g.zoomX-moving[0].zoomX,g.zoomY-moving[0].zoomY)));
  runs.push({name,round,layouts:after.LayoutCount-before.LayoutCount,layoutMs:1000*(after.LayoutDuration-before.LayoutDuration),styleMs:1000*(after.RecalcStyleDuration-before.RecalcStyleDuration),fits:samples.fits,docks:samples.docks,widthChanges:new Set(samples.widths).size,maxFrameGap:Math.max(...gaps),gapsOver25:gaps.filter(g=>g>25).length,maxGap,chromeDrift,positions:samples.positions});
  if(!allowGaps){assert.ok(maxGap<1,`${name}: uncovered canvas strip ${maxGap}px`);assert.ok(chromeDrift<1,`${name}: fixed chrome drift ${chromeDrift}px`);}
 }
 await cdp('Emulation.setCPUThrottlingRate',{rate:1});await js('PenEchoStudioNavigator.setOpen(true);motionTest.open()');await pause(700);
 fs.writeFileSync(path.join(out,label+'.png'),(await win.webContents.capturePage()).toPNG());
 const geometry=await js(`(()=>{const n=document.querySelector('#studioNavigator').getBoundingClientRect(),v=document.querySelector('#viewport').getBoundingClientRect(),a=document.querySelector('#canvasAgentPanel').getBoundingClientRect();return {navRight:n.right,viewLeft:v.left,viewRight:v.right,agentLeft:a.left};})()`);assert.ok(Math.abs(geometry.navRight-geometry.viewLeft)<2);assert.ok(Math.abs(geometry.viewRight-geometry.agentLeft)<2);
 const canvasAfter=await js('JSON.stringify([motionTest.state.panX,motionTest.state.panY,motionTest.state.scale,motionTest.state.userRevision])');assert.equal(canvasAfter,canvasBefore,'Sidebar motion preserves canvas coordinates and content revision');
 const stress=[];
 if(!allowGaps){
  await js(`new Promise(resolve=>{const frame=document.createElement('iframe');frame.srcdoc='<input value="live widget input"><script>window.motionToken=Math.random()<\/script>';frame.style.cssText='position:absolute;width:300px;height:200px;left:80px;top:80px';frame.addEventListener('load',()=>{window.motionLiveFrame={frame,document:frame.contentDocument,token:frame.contentWindow.motionToken};frame.contentDocument.querySelector('input').value='edited before sidebar motion';resolve();},{once:true});document.querySelector('#widgetLayer').append(frame);})`);
  for(const [name,setup,action] of [
   ['left-open','PenEchoStudioNavigator.setOpen(false);motionTest.close()','PenEchoStudioNavigator.setOpen(true)'],
   ['left-close','PenEchoStudioNavigator.setOpen(true)','PenEchoStudioNavigator.setOpen(false)'],
   ['right-open','PenEchoStudioNavigator.setOpen(true);motionTest.close()','motionTest.open()'],
   ['right-close','motionTest.open()','motionTest.close()']
  ]){
   await js(setup);await pause(400);await js(`${action};document.querySelector('.canvas-frame').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=80;});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));`);
   fs.writeFileSync(path.join(out,label+'-mid-'+name+'.png'),(await win.webContents.capturePage()).toPNG());
   await js(`document.querySelector('.canvas-frame').getAnimations({subtree:true}).forEach(a=>a.play());void 0;`);await pause(400);
  }
  for(const [width,zoom] of [[1440,1],[1100,1],[760,1],[701,1],[390,1],[1440,.85]]){
   win.setSize(width,900);await js(`document.documentElement.style.zoom='${zoom}';PenEchoStudioNavigator.setOpen(false);motionTest.close()`);await pause(400);
   const result=await js(`new Promise(resolve=>{const samples=[],plan=[[0,()=>PenEchoStudioNavigator.setOpen(true)],[45,()=>PenEchoStudioNavigator.setOpen(false)],[90,()=>PenEchoStudioNavigator.setOpen(true)],[135,()=>motionTest.open()],[180,()=>motionTest.close()],[225,()=>{PenEchoStudioNavigator.setOpen(false);motionTest.open();}],[280,()=>{PenEchoStudioNavigator.setOpen(true);motionTest.close();}]],start=performance.now();function tick(now){while(plan.length&&now-start>=plan[0][0])plan.shift()[1]();samples.push(motionGeometry());if(now-start<800)requestAnimationFrame(tick);else resolve({maxGap:Math.max(...samples.flatMap(g=>[g.leftGap,g.rightGap])),running:PenEchoShellMotion.isRunning(),inlineGeometry:document.querySelector('#viewport').style.flex});}requestAnimationFrame(tick);})`);
   assert.ok(result.maxGap<1,`${width}px at zoom ${zoom}: rapid reversal gap ${result.maxGap}`);assert.equal(result.running,false);assert.equal(result.inlineGeometry,'');stress.push({width,zoom,...result});
  }
  await js(`document.documentElement.style.removeProperty('zoom')`);win.setSize(1440,1000);await pause(350);
  assert.equal(await js(`motionLiveFrame.frame.contentDocument===motionLiveFrame.document&&motionLiveFrame.frame.contentWindow.motionToken===motionLiveFrame.token&&motionLiveFrame.frame.contentDocument.querySelector('input').value==='edited before sidebar motion'`),true,'Live iframe identity, runtime state and edited input survive every slide');
  await js('motionLiveFrame.frame.remove()');
 }
 if(process.env.MOTION_SOURCE!=='baseline'){
  const hintCheck=await js(`(async()=>{const view=document.querySelector('#viewport'),slot=document.querySelector('#pageHintSlot'),hint=document.querySelector('.text-input-hint'),mcp=document.querySelector('#mcpCanvasNotice'),paused=document.querySelector('#canvasAutoPausedNotice');hint.hidden=true;mcp.hidden=true;view.classList.add('is-navigating');await Promise.resolve();const pan=slot.dataset.navigationHint;view.classList.add('navigation-locked');await Promise.resolve();const locked=slot.dataset.navigationHint;hint.hidden=false;await Promise.resolve();const text=slot.dataset.navigationHint;hint.hidden=true;view.classList.remove('is-navigating','navigation-locked');paused.hidden=false;await Promise.resolve();const hiddenTools=getComputedStyle(document.querySelector('#aiToolsSection')).visibility;paused.hidden=true;return {pan,locked,text,hiddenTools};})()`);
  assert.deepEqual(hintCheck,{pan:'pan',locked:'locked',text:'text',hiddenTools:'hidden'});

  await js(`PenEchoStudioNavigator.setOpen(false);motionTest.close()`);await pause(55);await js(`PenEchoStudioNavigator.setOpen(true);motionTest.open()`);await pause(55);await js(`PenEchoStudioNavigator.setOpen(false);motionTest.close()`);await pause(700);
  assert.equal(await js(`document.body.classList.contains('studio-navigator-open')||document.body.classList.contains('canvas-agent-open')||PenEchoShellMotion.isRunning()`),false,'Rapid reversals settle closed');
  await js('PenEchoStudioNavigator.setOpen(true);motionTest.open()');await pause(700);
  assert.equal(await js(`document.querySelector('#canvasAgentPanel').inert`),false,'Agent remains interactive after opening');
  await js('PenEchoStudioNavigator.setOpen(false)');await pause(55);
  const gestureMoving=await js(`(()=>{const frame=document.querySelector('.canvas-frame');frame.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return PenEchoShellMotion.isRunning()||document.querySelector('#viewport').style.flex!==''||[...frame.getAnimations({subtree:true})].some(a=>a.playState==='running'&&a.effect?.target?.id==='screen');})()`);
  if(!allowGaps)assert.equal(gestureMoving,false,'Canvas gestures synchronously restore geometry before reading coordinates');
  await pause(300);
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await js('PenEchoStudioNavigator.setOpen(false);motionTest.close()');
  assert.equal(await js('PenEchoShellMotion.isRunning()'),false,'Reduced motion is immediate');
  await cdp('Emulation.setEmulatedMedia',{features:[]});win.setSize(390,844);await pause(250);await js('PenEchoStudioNavigator.setOpen(true)');await pause(80);await js('motionTest.open()');await pause(700);
  assert.equal(await js('PenEchoShellMotion.isRunning()'),false,'Compact panel handoff settles');
  assert.equal(await js(`document.body.classList.contains('studio-navigator-open')`),false);assert.equal(await js(`document.querySelector('#canvasAgentPanel').inert`),false);
  fs.writeFileSync(path.join(out,label+'-mobile.png'),(await win.webContents.capturePage()).toPNG());
 }
 const errors=await js('motionErrors');assert.deepEqual(errors,[]);
 if(process.env.MOTION_TRACE){const complete=new Promise(resolve=>{const listener=(_e,method)=>{if(method==='Tracing.tracingComplete'){win.webContents.debugger.removeListener('message',listener);resolve();}};win.webContents.debugger.on('message',listener);});await cdp('Tracing.end');await complete;fs.writeFileSync(path.join(out,label+'-trace.json'),JSON.stringify(trace));}
 const work=await js(`({fit:window.motionFitTimes,dock:window.motionDockTimes,nodes:document.querySelectorAll("*").length})`);const report={label,cpuThrottle,runs,geometry,stress,errors,work};fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,runs:runs.map(({positions,...r})=>r)},null,2));
 }catch(e){console.error(e);app.exitCode=1;}finally{win?.destroy();app.exit(app.exitCode||0);}});
