'use strict';
// Canonical UI, isolated profile and test-only transport hooks. No paid AI calls.
const {chromium}=require(process.env.PENECHO_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../test-results/ui-recovery');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),report={checks:[],layouts:[],errors:[]};
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultTimeout(12000);
 page.on('pageerror',e=>report.errors.push(e.message));
 try{
  await page.route('https://**',r=>r.abort());
  const source=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8').replace(/\}\)\(\);\s*$/,`window.recoveryTest={state,canvasAgent,setStudioNavigatorOpen,openCanvasAgent,closeCanvasAgent,canvasAgentClearInkDraft,canvasAgentSyncSendAvailability,restoreWidgets,render,setCanvasMode,mcpRuntime,mcpRenderCanvasStatus,setWidgetMaximized,setLanguage:value=>{state.language=value;applyLanguage();},
    mockAgentTransport:()=>{window.recoveryEnvelopes=[];canvasAgentConnect=async()=>{canvasAgent.socket={readyState:1,send:value=>window.recoveryEnvelopes.push(JSON.parse(value)),close(){}};canvasAgent.sessionReady=true;canvasAgent.sessionId="ui-recovery";canvasAgent.sessionSearchEnabled=canvasAgent.searchEnabled;};},
    finishRequest:()=>canvasAgentRequestDidNotSend()};})();`);
  await page.route('**/app.js',r=>r.fulfill({contentType:'application/javascript',body:source}));
  await page.goto(process.env.PENECHO_TEST_URL||'http://127.0.0.1:4399',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForSelector('body[data-shell-dock-layout]');
  const shot=async name=>page.screenshot({path:path.join(out,name+'.png')});
  await shot('restored-home');
  for(const width of [1440,1100,900,760,701])for(const nav of [false,true])for(const agent of [false,true]){
   await page.setViewportSize({width,height:1000});
   await page.waitForTimeout(400);
   await page.evaluate(({nav,agent})=>{recoveryTest.setStudioNavigatorOpen(nav,{restoreAgent:false});if(agent)recoveryTest.openCanvasAgent({focus:false});else recoveryTest.closeCanvasAgent({focus:false});},{nav,agent});
   await page.waitForTimeout(450);
   const r=await page.evaluate(()=>{
    const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height,visible:!!e.getClientRects().length};};
    return {mode:document.body.dataset.shellDockLayout,view:rect('#viewport'),dock:rect('.primary-tools'),zoom:rect('#canvasZoomControls'),ai:rect(document.querySelector('#canvasAutoPausedNotice').hidden?'#aiToolsSection':'#canvasAutoPausedNotice'),overflow:document.documentElement.scrollWidth-innerWidth};
   });
   report.layouts.push({width,nav,agent,...r});
   const intersects=(a,b)=>a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1;
   // Preserve usable canvas width when side panels consume most of the window.
   for(const [name,b]of Object.entries({dock:r.dock,zoom:r.zoom,ai:r.ai}))assert.ok(b.x>=r.view.x-1&&b.right<=r.view.right+1,`${width}/${nav}/${agent}: ${name} outside canvas ${JSON.stringify(r)}`);
   assert.ok(!intersects(r.dock,r.zoom)&&!intersects(r.dock,r.ai)&&!intersects(r.zoom,r.ai),`overlap ${width}/${nav}/${agent} ${JSON.stringify(r)}`);
   assert.ok(r.overflow<=1,'No horizontal page overflow');
   if(nav&&agent)await shot(`both-sidebars-${width}`);
  }
  report.checks.push('20 actual sidebar/window layouts: all three dock groups inside canvas without overlap');
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{recoveryTest.closeCanvasAgent({focus:false});recoveryTest.setStudioNavigatorOpen(true);});
  await page.waitForTimeout(600);
  for (const scale of [1.25,1]) {
   await page.evaluate(scale=>PenEchoPageScale.apply(scale,{persist:false}),scale);await page.waitForTimeout(400);
   const geometry=await page.evaluate(()=>{const nodes=['#viewport','.primary-tools','#canvasZoomControls','#aiToolsSection'].map(s=>document.querySelector(s).getBoundingClientRect());return nodes.map(r=>({x:r.x,right:r.right}));});
   for(const r of geometry.slice(1))assert.ok(r.x>=geometry[0].x-1&&r.right<=geometry[0].right+1,'Scaled chrome inside canvas');
   await shot('scale-'+scale);
  }
  const cards=await page.locator('#canvasWelcomeActions > button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {y:r.y,h:r.height};}));
  assert.ok(cards.every(r=>Math.abs(r.y-cards[0].y)<1&&Math.abs(r.h-cards[0].h)<1),'Welcome cards align at both edges');
  for(const id of ['inkColorPopover','aiColorPopover']) {
   const color=await page.locator('[aria-controls="'+id+'"]').evaluate(n=>{const s=getComputedStyle(n,'::before');return {content:s.content,color:s.backgroundColor,w:parseFloat(s.width)};});
   assert.ok(color.content!=='none'&&color.w>10&&color.color!=='rgba(0, 0, 0, 0)','Visible color dot '+id);
  }
  await page.locator('#settingsBtn').click();await page.locator('#settingsNavCanvas').click();
  for(const checked of [true,false,true]) {
   if((await page.locator('#settingsAutoToggle').getAttribute('aria-checked'))!==String(checked))await page.locator('#settingsAutoToggle').click();
   await page.waitForFunction(checked=>{const n=document.querySelector('#settingsAutoToggle'),k=getComputedStyle(n,'::after'),x=parseFloat(k.left),w=parseFloat(k.width);return checked?Math.abs(n.clientWidth-x-w-1)<.5:Math.abs(x-1)<.5;},checked);
   const knob=await page.locator('#settingsAutoToggle').evaluate(n=>{const s=getComputedStyle(n),k=getComputedStyle(n,'::after');return {width:n.clientWidth,x:parseFloat(k.left),knob:parseFloat(k.width),border:parseFloat(s.borderLeftWidth)};});
   assert.ok(checked?Math.abs(knob.width-knob.x-knob.knob-1)<1:Math.abs(knob.x-1)<1,'Switch reaches its edge: '+JSON.stringify(knob));
  }
  await shot('settings-detail');await page.locator('#settingsClose').click();
  await page.locator('#canvasMoreBtn').click();
  const more=await page.locator('#canvasMoreMenu [role="menuitem"]').evaluateAll(nodes=>nodes.filter(n=>!n.hidden).map(n=>({text:n.textContent.trim(),svg:!!n.querySelector('svg')})));
  assert.ok(more.every(n=>n.svg),'Every More entry has its icon');
  assert.ok(more.every(n=>n.text.length<30),'More menu copy remains concise');
  await shot('more-menu');await page.keyboard.press('Escape');
  await page.locator('#shareCanvasBtn').click();await page.waitForTimeout(300);await shot('share');
  await page.keyboard.press('Escape');
  for (const width of [1440,900,701]) {
   await page.setViewportSize({width,height:1000});
   await page.evaluate(()=>{
    const t=recoveryTest;t.openCanvasAgent({focus:false});
    Object.assign(t.mcpRuntime,{ready:true,socket:{readyState:1},activeMutation:'Codex',mutationDocumentId:null});t.mcpRenderCanvasStatus();t.openCanvasAgent({focus:false});
   });await page.waitForTimeout(450);
   const geometry=await page.evaluate(()=>{
    const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,x:r.x,right:r.right};};
    return {notice:rect('#mcpCanvasNotice'),view:rect('#viewport'),tools:['.primary-tools','#canvasZoomControls',document.querySelector('#canvasAutoPausedNotice').hidden?'#aiToolsSection':'#canvasAutoPausedNotice'].map(rect)};
   });
   assert.ok(geometry.notice.x>=geometry.view.x-1&&geometry.notice.right<=geometry.view.right+1,'MCP notice stays in remaining canvas');
   assert.ok(geometry.tools.every(r=>geometry.notice.bottom+7<=r.top),'MCP notice clears every dock group: '+JSON.stringify(geometry));
   assert.equal(await page.locator('#tip').evaluate(n=>getComputedStyle(n).visibility),'hidden','Generic pan/zoom tip yields to contextual MCP activity');
   await shot('mcp-clearance-'+width);
   await page.evaluate(()=>{Object.assign(recoveryTest.mcpRuntime,{ready:false,socket:null,activeMutation:null});recoveryTest.mcpRenderCanvasStatus();recoveryTest.closeCanvasAgent({focus:false});});
  }
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(450);
  report.checks.push('MCP activity notice stays above every dock layout and inside the remaining canvas');
  report.checks.push('125% scale, welcome alignment, visible color dots, full switch travel, More icons and Share rendering');
  await page.locator('#canvasAgentToggle').click();await page.waitForTimeout(450);
  await page.locator('#canvasAgentInkMode').click();
  assert.equal(await page.locator('#canvasAgentSend').isDisabled(),true,'Empty ink cannot send');
  const draw=async()=>{const b=await page.locator('#canvasAgentInkCanvas').boundingBox();await page.mouse.move(b.x+35,b.y+25);await page.mouse.down();await page.mouse.move(b.x+100,b.y+60,{steps:8});await page.mouse.up();};
  await draw();assert.equal(await page.locator('#canvasAgentSend').isEnabled(),true,'First stroke enables send');
  await page.locator('#canvasAgentClearInk').click();assert.equal(await page.locator('#canvasAgentSend').isDisabled(),true,'Clear disables send');
  await draw();await shot('handwriting-ready');
  await page.evaluate(()=>recoveryTest.mockAgentTransport());
  await page.locator('#canvasAgentSend').click();
  await page.waitForFunction(()=>window.recoveryEnvelopes?.some(e=>e.type==='user_turn'));
  const sent=await page.evaluate(()=>recoveryEnvelopes.find(e=>e.type==='user_turn'));
  assert.equal(sent.payload.images.length,1);assert.match(sent.payload.images[0].mediaType,/^image\/(png|webp)$/);assert.ok(sent.payload.images[0].data.length>100);
  assert.equal(await page.evaluate(()=>recoveryTest.canvasAgent.inkPresent),false);
  assert.equal(await page.locator('#canvasAgentSend').isDisabled(),true);
  await shot('handwriting-sent');await page.evaluate(()=>{recoveryTest.finishRequest();recoveryTest.closeCanvasAgent({focus:false});recoveryTest.setStudioNavigatorOpen(false);});
  report.checks.push('Real ink pointer strokes, clear, submit, encoded image envelope, user message and draft cleanup through a test-only transport');
  await page.waitForTimeout(450);
  await page.evaluate(()=>{
   const t=recoveryTest;t.state.panX=-9600;t.state.panY=-9600;t.state.scale=1;
   t.restoreWidgets([{id:'widget-1',pluginId:'general',widgetType:'html_widget',refreshSeconds:0,copyText:'<main>Fixture</main>',copyLabel:'Copy HTML',sourceFormat:'html',title:'Presentation verification',x:9700,y:9800,w:780,h:480,contentW:780,contentH:480,html:'<!doctype html><html><body style="margin:0;background:white;font:16px system-ui"><main style="margin:20px;border:1px solid #bbb;padding:30px">The widget owns this inner border.</main></body></html>'}]);t.setCanvasMode('hand');t.render();t.setWidgetMaximized(t.state.widgets[0],true);
  });
  await page.waitForTimeout(400);
  const outer=await page.locator('.canvas-widget.widget-maximized').evaluate(n=>{const s=getComputedStyle(n);return {border:s.borderWidth,padding:s.padding,shadow:s.boxShadow};});
  assert.equal(outer.border,'0px');assert.equal(outer.padding,'0px');assert.equal(outer.shadow,'none');await shot('maximized-widget');
  report.checks.push('Maximized widget has no outer frame, padding or shadow');
  assert.deepEqual(report.errors,[]);

 }catch(e){report.failure=e.stack;await page.screenshot({path:path.join(out,"integration-failure.png")});}
 finally{fs.writeFileSync(path.join(out,'integration-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,layouts:report.layouts.length,errors:report.errors,failure:report.failure}));await browser.close();if(report.failure)process.exitCode=1;}
})();
