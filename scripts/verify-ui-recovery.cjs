'use strict';
// Canonical UI, isolated profile and test-only transport hooks. No paid AI calls.
const {chromium}=require(process.env.PENECHO_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../test-results/ui-recovery');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),report={checks:[],layouts:[],errors:[]};
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>report.errors.push(e.message));
 try{
  await page.route('https://**',r=>r.abort());
  const source=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8').replace(/\}\)\(\);\s*$/,`window.recoveryTest={state,canvasAgent,setStudioNavigatorOpen,openCanvasAgent,closeCanvasAgent,canvasAgentClearInkDraft,canvasAgentSyncSendAvailability,restoreWidgets,render,setCanvasMode,mcpRuntime,mcpRenderCanvasStatus};})();`);
  await page.route('**/app.js',r=>r.fulfill({contentType:'application/javascript',body:source}));
  await page.goto(process.env.PENECHO_TEST_URL||'http://127.0.0.1:4399',{waitUntil:'networkidle'});
  await page.waitForSelector('body[data-shell-dock-layout]');
  const shot=async name=>page.screenshot({path:path.join(out,name+'.png')});
  await shot('restored-home');
  for(const width of [1440,1100,900,760,701])for(const nav of [false,true])for(const agent of [false,true]){
   await page.setViewportSize({width,height:1000});
   await page.evaluate(({nav,agent})=>{recoveryTest.setStudioNavigatorOpen(nav);if(agent)recoveryTest.openCanvasAgent({focus:false});else recoveryTest.closeCanvasAgent({focus:false});},{nav,agent});
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
 }catch(e){report.failure=e.stack;await page.screenshot({path:path.join(out,"integration-failure.png")});}
 finally{fs.writeFileSync(path.join(out,'integration-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();if(report.failure)process.exitCode=1;}
})();
