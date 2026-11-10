'use strict';
// Local acceptance with intercepted AI transport and real Canvas rendering.
const {chromium}=require(process.env.PENECHO_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),sharp=require('sharp');
const {validateToolArguments}=require('../src/server/mcp/schema.js');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'assist-agent-'));
const output=path.resolve(process.env.PENECHO_VERIFY_OUTPUT||'docs/verification/assist-agent-routing-20260929');fs.mkdirSync(output,{recursive:true});
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(dir,'state'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false'});
const server=require('../server.js');
(async()=>{let browser;try{
 await new Promise(r=>server.listening?r():server.once('listening',r));
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],commands=[],classifications=[];
 page.on('pageerror',e=>errors.push(e.message));
 const injected=`
 const realAgentSubmit=canvasAgentSubmitMessage;
 window.assistAudit={state,settings,smartSuggest,assistAgent,canvasAgent,canvasDocumentsReady,loadCanvasSettings,storeAiConnectionSelection,stroke,save,captureSelection,setCanvasMode,render,executeAssistAction,assistAsk,assistAgentRun,assistAgentShow,runWidgetAssistAction,canvasAgentSetRunning,canvasAgentDocumentOperation,canvasDocumentsCurrent,canvasDocumentsExecute,cancelSelection,undo,redo,viewportRect,calls:[],envelopes:[],wire:[],enableTransportAudit(){
   canvasAgentSubmitMessage=realAgentSubmit;
   canvasAgentConnect=async()=>{canvasAgent.socket={readyState:WebSocket.OPEN};canvasAgent.sessionReady=true;canvasAgent.sessionId='context-audit';};
   canvasAgentEnsureSearchSession=async()=>{};
   canvasAgentSendRequest=(type,payload)=>assistAudit.wire.push({type,payload});
 }};
 canvasAgentSubmitMessage=async options=>{window.assistAudit.calls.push(options);canvasAgentSetRunning(true);return true;};
 canvasAgentSendEnvelope=(type)=>{window.assistAudit.envelopes.push(type);};
 canvasAgentConnect=async()=>{};
 canvasAgentStartNewConversation=async()=>{};
 `;
 const app=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8').replace(/\}\)\(\);\s*$/,injected+'})();');
 await page.route(/^https:\/\//,r=>r.abort());await page.route('**/app.js*',r=>r.fulfill({contentType:'application/javascript',body:app}));
 await page.route('**/api/suggest/status',r=>r.fulfill({json:{configured:true,model:'PenEchoLLM'}}));
 await page.route('**/api/suggest',r=>{const b=r.request().postDataJSON();classifications.push(b);return r.fulfill({json:{ok:true,answers:{execution:{type:'choice',choice:b.context?.instruction?.includes('dashboard')?'penecho_agent':'canvas_ai'}}}});});
 await page.route('**/api/ai/command',r=>{commands.push(r.request().postDataJSON());return r.fulfill({json:{commands:[]}});});
 await page.addInitScript(()=>{if(top===window)localStorage.setItem('penecho-language','zh');});
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.assistAudit);
 await page.evaluate(async()=>{const t=assistAudit;await t.canvasDocumentsReady;await t.loadCanvasSettings();t.storeAiConnectionSelection(t.settings.connections[0].id);t.state.auto=false;t.smartSuggest.enabled=false;t.smartSuggest.available=true;t.state.scale=1;t.state.panX=100;t.state.panY=100;
 t.stroke({x:135,y:150},{x:175,y:170},false,8,true,'#111111');t.stroke({x:220,y:225},{x:250,y:225},false,8,true,'#ff0000');t.save();t.setCanvasMode('select');t.captureSelection([{x:100,y:100},{x:260,y:100},{x:100,y:260},{x:100,y:100}]);t.render();
 await t.executeAssistAction({id:'animate'},{box:t.state.selection.box,selection:t.state.selection,selectionKey:'selection:'+t.smartSuggest.selectionVersion,strokes:[]});});
 await page.locator('#assistAgentMini').waitFor();
 const first=await page.evaluate(()=>assistAudit.calls[0]);assert.ok(first);assert.equal(first.omitInitialCapture,true);assert.equal(first.includeDraftMedia,false);assert.equal(first.clearInput,false);assert.deepEqual(first.referencesOverride.objectIds,[]);assert.equal(first.imageOverrides.length,1);assert.equal(await page.locator('#canvasAgentPanel').isVisible(),false);
 const pixels=await sharp(Buffer.from(first.imageOverrides[0].data,'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});let black=0,red=0;for(let i=0;i<pixels.data.length;i+=pixels.info.channels){const [r,g,b]=pixels.data.subarray(i,i+3);if(r<100&&g<100&&b<100)black++;if(r>160&&g<100&&b<100)red++;}assert.ok(black>20);assert.equal(red,0);
 await page.evaluate(()=>{const row=document.createElement('div');row.className='canvas-agent-tool running';const label=document.createElement('span');label.className='canvas-agent-tool-intent';label.textContent='正在生成动画场景';row.append(label);document.querySelector('#canvasAgentTranscript').append(row);});
 await page.waitForFunction(()=>document.querySelector('.assist-agent-mini-status').textContent.includes('正在生成动画场景'));
 const screens=[];for(const size of [{width:1440,height:900},{width:390,height:844}]){await page.setViewportSize(size);await page.waitForTimeout(120);const box=await page.locator('#assistAgentMini').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=size.width+1);assert.ok(box.y>=0&&box.y+box.height<=size.height);await page.screenshot({path:path.join(output,`mini-${size.width}.png`)});screens.push({size,box});}
 await page.locator('#assistAgentMini button').first().click();await page.waitForFunction(()=>!document.querySelector('#canvasAgentPanel').hidden);assert.equal(await page.locator('#assistAgentMini').isVisible(),false);
 await page.evaluate(()=>{assistAudit.assistAgentShow('动画讲解');});await page.locator('#assistAgentMini button').last().click();assert.equal(await page.locator('#assistAgentMini').isVisible(),false);assert.ok(await page.evaluate(()=>assistAudit.envelopes.includes('cancel')));await page.evaluate(()=>{assistAudit.canvasAgent.running=false;assistAudit.canvasAgent.requestPending=false;assistAudit.canvasAgentSetRunning(false);assistAudit.cancelSelection();});
 const before=commands.length;
 await page.evaluate(()=>assistAudit.executeAssistAction({id:'answer'},{box:{x:100,y:100,w:150,h:100},strokes:[]}));await page.waitForFunction(()=>!assistAudit.state.activeAI&&!assistAudit.state.busy);assert.equal(commands.length,before+1);assert.equal(await page.evaluate(()=>assistAudit.calls.length),1);
 await page.evaluate(()=>assistAudit.assistAsk('Build a dashboard with linked charts and filters',{box:{x:100,y:100,w:150,h:100},strokes:[]}));assert.equal(await page.evaluate(()=>assistAudit.calls.length),2);assert.equal(commands.length,before+1);assert.equal(classifications.at(-1).mode,'route');
 await page.evaluate(()=>{assistAudit.canvasAgent.running=false;assistAudit.canvasAgent.requestPending=false;assistAudit.canvasAgentSetRunning(false);});
 const compiled=validateToolArguments('penecho_present_widget',{sessionId:'agent-'+ 'a'.repeat(64),requestId:'scene-create',artifactId:'ball',title:'弹跳小球',scene:{engine:'physics',bodies:[{id:'ball',shape:'circle',x:200,y:80,r:25,fill:'blue'},{id:'floor',shape:'segment',x:50,y:420,to:[850,420]}]}});
 const receipt=await page.evaluate(async args=>{const agent=assistAudit.canvasAgent,previous=agent.socket;agent.socket={readyState:WebSocket.OPEN};try{return await assistAudit.canvasAgentDocumentOperation({operation:'mcp_present_widget',bindingKey:args.sessionId,arguments:args},{socket:agent.socket,sessionId:agent.sessionId,generation:agent.sessionGeneration,controller:new AbortController()});}finally{agent.socket=previous;}},compiled);assert.ok(receipt.sourcePath.endsWith('widget.source'));
 const record=await page.evaluate(id=>{const w=assistAudit.state.widgets.find(w=>w.id===id);return {format:w.sourceFormat,source:w.copyText,html:w.html};},receipt.objectId);assert.equal(record.format,'penecho-scene+json');assert.equal(record.source,compiled.copyText);assert.match(record.html,/data-penecho-scene/);
 await page.evaluate(id=>assistAudit.runWidgetAssistAction(assistAudit.state.widgets.find(w=>w.id===id),{id:'animate'}),receipt.objectId);
 const widgetRequest=await page.evaluate(()=>assistAudit.calls.at(-1));assert.deepEqual(widgetRequest.referencesOverride.objectIds,[receipt.objectId]);assert.ok(widgetRequest.textOverride.includes('Edit only existing widget '+receipt.objectId));assert.equal(await page.locator('#assistAgentMini').isVisible(),true);assert.equal(await page.locator('#canvasAgentPanel').isVisible(),false);
 const agentRequests=await page.evaluate(()=>assistAudit.calls.length);assert.equal(agentRequests,3);
 // Exercise the real submission function through the final wire boundary.
 await page.setViewportSize({width:1440,height:900});
 const expected=await page.evaluate(async()=>{
   const t=assistAudit;t.canvasAgent.running=false;t.canvasAgent.requestPending=false;t.canvasAgentSetRunning(false);t.enableTransportAudit();
   t.state.scale=1;t.state.panX=100;t.state.panY=100;
   t.stroke({x:5000,y:5000},{x:5050,y:5050},false,8,true,'#ff0000');t.save();
   t.state.dirty={x:130,y:145,w:4930,h:4920};
   const viewport={...t.viewportRect()},target={box:{x:120,y:135,w:75,h:55},newBox:{x:130,y:145,w:50,h:35},strokes:[{id:99,historyEntry:t.state.history.at(-1)}]};
   await t.executeAssistAction({id:'animate_sketch'},target);
   return {viewport,box:target.box};
 });
 const sent=await page.evaluate(()=>assistAudit.wire[0]);assert.ok(sent,'real Agent submission must reach the wire');
 assert.equal(sent.type,'user_turn');assert.equal(sent.payload.initialState,null);assert.equal(sent.payload.images.length,1);
 assert.deepEqual(sent.payload.references.region,{x:120,y:135,width:4940,height:4930});
 assert.match(sent.payload.text,/Dirty region.*x=130, y=145, width=4930, height=4920/);
 assert.match(sent.payload.text,/Recent stroke region.*x=130, y=145, width=50, height=35/);
 assert.ok(sent.payload.text.includes(`Viewport at invocation in Canvas world coordinates: x=${expected.viewport.x}, y=${expected.viewport.y}, width=${expected.viewport.w}, height=${expected.viewport.h}.`));
 assert.match(sent.payload.text,/report completion and stop/);assert.match(sent.payload.text,/Animate the same subject and composition/);
 const targetPixels=await sharp(Buffer.from(sent.payload.images[0].data,'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});let targetBlack=0,targetRed=0;
 for(let i=0;i<targetPixels.data.length;i+=targetPixels.info.channels){const [r,g,b]=targetPixels.data.subarray(i,i+3);if(r<100&&g<100&&b<100)targetBlack++;if(r>160&&g<100&&b<100)targetRed++;}
 assert.ok(targetBlack>20);assert.ok(targetRed>20,'ordinary Agent input includes the distant pending stroke');
 const scopedHandoff={prompt:sent.payload.text,references:sent.payload.references,viewport:expected.viewport,image:{width:targetPixels.info.width,height:targetPixels.info.height,black:targetBlack,red:targetRed},initialState:sent.payload.initialState};
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({screens,maskedSelection:{black,red},scopedHandoff,canvasAiRequests:commands.length,agentRequests:agentRequests+1,scene:receipt,errors},null,2));console.log(JSON.stringify({output,canvasAiRequests:commands.length,agentRequests:agentRequests+1,errors}));
}finally{await browser?.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
