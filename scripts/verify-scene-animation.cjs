'use strict';
// Replays a scene through the canonical Canvas and Widget host in isolated state.
const {chromium}=require(process.env.PENECHO_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),sharp=require('sharp');
const {validateToolArguments}=require('../src/server/mcp/schema.js');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-scene-'));
const output=path.resolve(process.env.PENECHO_VERIFY_OUTPUT||'docs/verification/scene-animation-20261004');
fs.mkdirSync(output,{recursive:true});
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temporary,'state'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false'});
const server=require('../server.js');
(async()=>{let browser;try{
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const injected='window.sceneAudit={state,canvasAgent,canvasDocumentsReady,canvasAgentDocumentOperation,requestWidgetSnapshot,sendWidgetHostState,setWidgetInteraction};';
 const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8').replace(/\}\)\(\);\s*$/,injected+'})();');
 await page.route('**/app.js*',route=>route.fulfill({contentType:'application/javascript',body:app}));
 await page.route(/^https:\/\//,route=>route.abort());
 await page.addInitScript(()=>{if(top===window)localStorage.setItem('penecho-language','zh');});
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.sceneAudit);
 await page.evaluate(async()=>{await sceneAudit.canvasDocumentsReady;sceneAudit.state.auto=false;document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();});
 const scene=JSON.parse(fs.readFileSync(process.argv[2]||path.join(__dirname,'../test/fixtures/pythagoras-motion.json'),'utf8'));
 const args=validateToolArguments('penecho_present_widget',{sessionId:'agent-'+'a'.repeat(64),requestId:'motion-create',artifactId:'pythagoras-animation',title:'勾股定理动画讲解',scene,capture:false});
 const receipt=await page.evaluate(async args=>{const agent=sceneAudit.canvasAgent,previous=agent.socket;agent.socket={readyState:WebSocket.OPEN};try{return await sceneAudit.canvasAgentDocumentOperation({operation:'mcp_present_widget',bindingKey:args.sessionId,arguments:args},{socket:agent.socket,sessionId:agent.sessionId,generation:agent.sessionGeneration,controller:new AbortController()});}finally{agent.socket=previous;}},args);
 await page.waitForTimeout(1200);
 const widgets=await page.evaluate(()=>sceneAudit.state.widgets.map(w=>({id:w.id,sourceFormat:w.sourceFormat,contentW:w.contentW,contentH:w.contentH,w:w.w,h:w.h,fitContentAxes:w.fitContentAxes,renderActive:w.renderActive,hostReady:w.hostReady,initialized:w.initialized,runtimeDiagnostics:w.runtimeDiagnostics})));
 const frames=[];for(const frame of page.frames())if(frame.url()==='about:srcdoc')frames.push(await frame.evaluate(()=>({root:document.querySelector('#penecho-scene')?.getBoundingClientRect().toJSON(),html:document.body.innerHTML.slice(0,800),text:document.body.innerText.slice(0,400),svg:document.querySelector('.pes-stage')?.getBoundingClientRect().toJSON(),actors:document.querySelectorAll('.pes-actor').length,paused:document.documentElement.classList.contains('penecho-widget-paused')})));
 const measured=frames.find(frame=>frame.root);
 assert.ok(measured.root.height>200,'Scene stage must have a nonzero viewport height');
 assert.equal(measured.svg.height,measured.root.height);
 assert.ok(!widgets[0].fitContentAxes,'Scenes must not acquire a flow-fit marker');
 let frame;for(const candidate of page.frames())if(await candidate.locator('#penecho-scene').count())frame=candidate;
 assert.ok(frame);
 await page.evaluate(id=>{const w=sceneAudit.state.widgets.find(w=>w.id===id);sceneAudit.setWidgetInteraction(w,{inPlace:true});},receipt.objectId);
 await frame.locator('#penecho-scene').hover();
 await frame.getByRole('button',{name:'暂停',exact:true}).click();
 const paused=await frame.locator('.pes-progress > i').evaluate(element=>element.style.width);
 await page.waitForTimeout(250);
 assert.equal(await frame.locator('.pes-progress > i').evaluate(element=>element.style.width),paused,'Pause must stop the timeline');
 await frame.getByRole('button',{name:'重播',exact:true}).click();
 await page.waitForTimeout(150);
 const replayed=await frame.locator('.pes-progress > i').evaluate(element=>parseFloat(element.style.width));
 assert.ok(replayed<5,'Replay must restart the sequence');
 await frame.getByRole('button',{name:'暂停',exact:true}).click();
 const actorState=()=>frame.locator('.pes-actor').evaluateAll(elements=>elements.map(element=>({id:element.getAttribute('data-actor'),style:element.getAttribute('style'),text:element.textContent,stroke:element.getAttribute('stroke-dashoffset')})));
 const initialActors=await actorState();
 await frame.locator('.pes-progress').evaluate(element=>{const box=element.getBoundingClientRect();element.dispatchEvent(new PointerEvent('pointerdown',{clientX:box.right,clientY:box.top}));});
 assert.notDeepEqual(await actorState(),initialActors,'The timed proof must change visible actors');
 const generic=process.argv.includes('--generic');
 if(!generic){
  assert.match(await frame.locator('[data-actor="tri1"]').getAttribute('style'),/translate\(0px, 168px\)/,'The triangle must move to its final proof position');
  assert.equal(await frame.locator('[data-actor="numA"]').textContent(),'9');
  assert.equal(await frame.locator('[data-actor="numB"]').textContent(),'16');
 }
 await page.screenshot({path:path.join(output,'canvas.png')});
 async function capture(name){
  const dataUrl=await page.evaluate(async id=>{const w=sceneAudit.state.widgets.find(w=>w.id===id);await sceneAudit.requestWidgetSnapshot(w,15000,true);return w.snapshotDataUrl;},receipt.objectId);
  assert.ok(dataUrl);const bytes=Buffer.from(dataUrl.split(',')[1],'base64');
  fs.writeFileSync(path.join(output,name+'.png'),bytes);
  const pixels=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});let painted=0;
  for(let i=3;i<pixels.data.length;i+=4)if(pixels.data[i]>32)painted++;
  assert.ok(painted>pixels.info.width*pixels.info.height*.01,'Captured Scene must contain visible pixels');
  return {width:pixels.info.width,height:pixels.info.height,painted};
 }
 const snapshot=await capture('snapshot');
 // Existing documents may already have the bad auto-fit marker saved. The
 // Widget host must recover their viewport without rewriting the scene source.
 await page.evaluate(id=>{const w=sceneAudit.state.widgets.find(w=>w.id===id);w.fitContentAxes='height';sceneAudit.sendWidgetHostState(w,undefined,undefined,true);},receipt.objectId);
 await page.waitForTimeout(100);
 const legacyHeight=await frame.locator('#penecho-scene').evaluate(element=>element.getBoundingClientRect().height);
 assert.equal(legacyHeight,measured.root.height);
 const legacySnapshot=await capture('legacy-fit-snapshot');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({receipt,widgets,frames,playback:{paused,replayed,meaningfulMotion:true,...(!generic?{finalTriangleOffset:[0,168],counts:[9,16]}:{})},snapshot,legacyHeight,legacySnapshot,errors},null,2));
 console.log(JSON.stringify({output,stageHeight:measured.root.height,legacyHeight,snapshot,playback:true,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
