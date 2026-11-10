"use strict";
// Real client capture, Agent submission and completion; only remote transport is
// intercepted. Isolated profiles and temporary documents never use live models.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const root=path.resolve(__dirname,'..'),cloud=process.argv.includes('--cloud'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'agent-dirty-')),
  output=path.resolve(process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||temporary),
  clientFile=path.resolve(root,cloud?'../penecho_cloud/public/canvas/app.js':'public/app.js');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(temporary,'profile'));app.disableHardwareAcceleration();
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temporary,'state'),PENECHO_CONFIG_FILE:path.join(temporary,'config.env'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test-only',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false',PENECHO_JEVISION_ENABLED:'false'});
const injection=`
  window.agentDirtyTest={state,smartSuggest,assistAgent,canvasAgent,wire:[],assistAgentRun,canvasAgentSubmitMessage,smartSuggestResultCluster,dirtyInputSnapshots};
  canvasAgentConnect=async()=>{canvasAgent.socket={readyState:WebSocket.OPEN};canvasAgent.sessionReady=true;canvasAgent.sessionId='dirty-audit';};
  canvasAgentEnsureSearchSession=async()=>{};
  canvasAgentSendRequest=(type,payload)=>{agentDirtyTest.wire.push({type,payload});canvasAgentHandleEvent({kind:'turn_start',turn:agentDirtyTest.wire.length});};
  canvasAgentSendEnvelope=()=>{};
  canvasAgentWaitForReady=async send=>{send();canvasAgent.sessionReady=true;canvasAgent.sessionId='dirty-audit';};
  const originalCapture=canvasAgentCapture;
  canvasAgentCapture=async(...args)=>{const result=await originalCapture(...args);if(agentDirtyTest.pauseCapture)await new Promise(resolve=>agentDirtyTest.resumeCapture=resolve);return result;};
  agentDirtyTest.init=async()=>{
    await canvasDocumentsReady();await loadCanvasSettings();storeAiConnectionSelection(settings.connections[0].id);
    markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);closeFeatureTour({retry:false,changelog:false});markChangelogSeen();document.querySelector('#canvasWelcome').hidden=true;
    state.auto=false;smartSuggest.enabled=false;state.language='en';state.scale=1;state.panX=state.panY=0;state.viewInitialized=true;
  };
  agentDirtyTest.add=(x,y,color='#111111')=>{
    const points=[{x,y},{x:x+80,y}];stroke(points[0],points[1],false,10,true,color);state.userRevision++;
    const historyEntry=save(),record={id:smartSuggest.nextStrokeId++,points,box:{x,y,w:80,h:0},at:performance.now(),size:10,historyEntry};smartSuggestRecordStroke(record);return record;
  };
  agentDirtyTest.reset=async()=>{
    assistAgentRetireTurn();canvasAgentHandleEvent({kind:'turn_end',reason:{kind:'stopped'}});cancelSelection(true);hideAssist('test-reset');
    assistAgent.active=false;assistAgent.card&&(assistAgent.card.hidden=true);canvasAgent.currentConversation.items=[];
    tiles.clear();state.inkBounds.clear();clearDirtyContributionTracking();state.dirty=null;state.history=[];state.future=[];state.historyBefore.clear();state.dirtyHistoryBefore=null;state.widgetHistoryBefore=null;
    state.widgets.forEach(unmountWidget);state.widgets=[];state.images=[];state.textBoxes=[];state.hotspotTrail=[];state.latestTypedInput=null;state.mode='pen';
    smartSuggest.strokes=[];smartSuggest.consumedStrokeId=0;smartSuggest.dismissedStrokeId=0;smartSuggest.enabled=false;
    agentDirtyTest.left=agentDirtyTest.add(120,110);agentDirtyTest.cutout=agentDirtyTest.add(120,210);agentDirtyTest.right=agentDirtyTest.add(820,110,'#dc2626');agentDirtyTest.far=agentDirtyTest.add(1800,600,'#16a34a');
    const ink=offscreen(30,30);ink.getContext('2d').fillRect(0,0,30,30);
    const image={id:'user-image',x:500,y:330,w:30,h:30,image:ink};state.images.push(image);state.dirtyImageIds.add(image.id);mergeDirtyBox(image);
    const text=await renderedTextBoxRecord({id:'user-text',text:'pending words',x:400,y:270,w:180,h:40,maxWidth:180,fontSize:24,color:'#111111'});state.textBoxes.push(text);state.dirtyTextBoxIds.add(text.id);mergeDirtyBox(text);
    agentDirtyTest.target={box:{x:810,y:95,w:100,h:30},newBox:{x:810,y:95,w:100,h:30},strokes:[agentDirtyTest.right]};render();
  };
  agentDirtyTest.lasso=()=>{
    captureSelection([{x:80,y:80},{x:250,y:80},{x:250,y:250},{x:220,y:250},{x:220,y:160},{x:80,y:160}]);
    return {box:{...state.selection.box},selection:state.selection,selectionKey:'selection:'+smartSuggest.selectionVersion,strokes:[]};
  };
  agentDirtyTest.read=()=>{
    const alpha=(x,y)=>{const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE),mask=state.dirtyInkTiles.get(tx+','+ty);return mask?mask.getContext('2d').getImageData(Math.floor((x-tx*TILE)*DIRTY_MASK_SCALE),Math.floor((y-ty*TILE)*DIRTY_MASK_SCALE),1,1).data[3]:0;};
    return {left:alpha(150,110),cutout:alpha(150,210),right:alpha(850,110),far:alpha(1830,600),fresh:alpha(400,700),overlap:alpha(850,110),images:[...state.dirtyImageIds],texts:[...state.dirtyTextBoxIds],dirty:state.dirty,snapshots:dirtyInputSnapshots.size};
  };
  agentDirtyTest.finish=(kind='completed',result=false)=>{
    if(result){const region={x:300,y:440,w:250,h:80};stroke({x:region.x,y:region.y},{x:region.x+region.w,y:region.y+region.h},false,5,false,'#2563eb');save();assistAgentRecordResult('mcp_draw',{region},{documentId:canvasDocumentsCurrent().id});}
    canvasAgentHandleEvent({kind:'turn_end',turn:agentDirtyTest.wire.length,reason:{kind}});
  };
  agentDirtyTest.pixels=async()=>{
    const sent=agentDirtyTest.wire.at(-1),capture=sent.payload.images[0],image=new Image();image.src='data:'+capture.mediaType+';base64,'+capture.data;await image.decode();
    const out=offscreen(image.width,image.height),ctx=out.getContext('2d');ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,out.width,out.height).data;let black=0,red=0,green=0;
    for(let i=0;i<rgba.length;i+=4){const [r,g,b]=rgba.subarray(i,i+3);if(r<100&&g<100&&b<100)black++;if(r>140&&g<110&&b<110)red++;if(g>95&&g>r*1.5&&g>b*1.2)green++;}
    return {black,red,green,width:out.width,height:out.height};
  };
`;
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){return path.resolve(String(file))===path.join(root,'public/app.js')?Readable.from([fs.readFileSync(clientFile,'utf8').replace(/\}\)\(\);\s*$/,injection+'})();')]):readStream.call(this,file,...args);};
const report={runtime:cloud?'cloud-client':'local',clientFile,checks:[],errors:[],limitations:['Isolated local renderer with intercepted Agent transport; no live model, physical pen or deployed Cloud verification.']};
let server,win;
app.whenReady().then(async()=>{
 try{
  server=require('../server.js');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  if(cloud)server.prependListener('request',request=>{if(request.url.startsWith('/canvas/'))request.url=request.url.slice(7);});
  win=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message',event=>{if(event.level==='error')report.errors.push(event.message);});
  const js=async code=>{let timer;try{return await Promise.race([win.webContents.executeJavaScript(code,true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Renderer audit timed out')),30000);})]);}finally{clearTimeout(timer);}},check=(name,pass,details)=>{report.checks.push({name,pass:Boolean(pass),details});assert.ok(pass,name+': '+JSON.stringify(details));};
  await win.loadURL('http://127.0.0.1:'+server.address().port);await js('agentDirtyTest.init()');
  for(const scenario of ['result','text','stopped','error','superseded','new-input','lasso-result','lasso-text','sidebar']){
   await js('agentDirtyTest.reset()');
   const submitted=await js(`(async()=>{const t=agentDirtyTest;return ${scenario==='sidebar'?"await t.canvasAgentSubmitMessage({textOverride:'Answer the pending input',clearInput:false,includeDraftMedia:false})":`await t.assistAgentRun('answer',${scenario.startsWith('lasso')?'t.lasso()':'t.target'})`};})()`);
   check(scenario+': real submission reaches intercepted transport',submitted===true||submitted==='submitted',{submitted});
   const sent=await js('agentDirtyTest.wire.at(-1)'),pixels=scenario==='sidebar'?null:await js('agentDirtyTest.pixels()');
   if(scenario==='result'){
    check('Request image includes distant dirty groups even outside the viewport',pixels.black>20&&pixels.red>20&&pixels.green>20,pixels);
    check('Request prompt and references cover the entire input, without the Suggest group restriction',sent.payload.references.region.x<=115&&sent.payload.references.region.x+sent.payload.references.region.width>=1885&&/all pending user content/.test(sent.payload.text),{region:sent.payload.references.region});
    fs.writeFileSync(path.join(output,'all-input-request.webp'),Buffer.from(sent.payload.images[0].data,'base64'));
    await js('agentDirtyTest.smartSuggest.enabled=true');
   }
   if(scenario==='lasso-result')check('Lasso request image excludes the other dirty groups',pixels.black>20&&pixels.red===0&&pixels.green===0,pixels);
   if(scenario==='superseded')await js('agentDirtyTest.assistAgent.generation++');
   if(scenario==='new-input')await js("agentDirtyTest.add(370,700);agentDirtyTest.add(820,110)");
   await js(`agentDirtyTest.finish(${JSON.stringify(['stopped','error'].includes(scenario)?scenario:'completed')},${scenario==='result'||scenario==='lasso-result'})`);
   const value=await js('agentDirtyTest.read()');
   if(['result','text','sidebar'].includes(scenario))check(scenario+': completion clears every submitted user dirty contribution',!value.dirty&&!value.left&&!value.right&&!value.far&&!value.images.length&&!value.texts.length,value);
   if(['stopped','error','superseded'].includes(scenario))check(scenario+': unsuccessful work retains all dirty input',value.left&&value.right&&value.far&&value.images.length===1&&value.texts.length===1,value);
   if(scenario.startsWith('lasso'))check(scenario+': completion clears only the polygon, preserving its concave cutout and outside dirty',!value.left&&value.cutout&&value.right&&value.far&&value.images.length===1&&value.texts.length===1,value);
   if(scenario==='new-input')check('Later new and overlapping input survives successful old-input consumption',!value.left&&!value.far&&value.fresh&&value.overlap&&!value.images.length&&!value.texts.length,value);
   if(scenario==='result'){
    const result=await js('(()=>{const r=agentDirtyTest.smartSuggestResultCluster();return r&&{result:r.result,box:r.box};})()');check('Generated result keeps next-suggestion state independently of user dirty',result?.result&&!value.dirty,{box:result?.box});
    const followup=await js("(async()=>{const t=agentDirtyTest,cluster=t.smartSuggestResultCluster();t.add(2200,700);const submitted=await t.assistAgentRun('explain',{box:cluster.box,followUp:true,strokes:[]});return {submitted,region:t.wire.at(-1).payload.references.region};})()");
    check('A generated-result follow-up still submits its own clean target',followup.submitted==='submitted'&&followup.region.x===300&&followup.region.width===250,followup);
    await js('agentDirtyTest.finish()');
    const later=await js('agentDirtyTest.read()');
    check('Clean-result follow-up preserves unrelated new user input',later.dirty?.x>=2190&&!later.snapshots,later);

   }
   check(scenario+': input snapshots are released',value.snapshots===0,value);
  }
  await js("(async()=>{const t=agentDirtyTest;await t.reset();t.pauseCapture=true;t.pending=t.assistAgentRun('answer',t.target);})()");
  for(let i=0;!await js('Boolean(agentDirtyTest.resumeCapture)');i++){if(i>200)throw Error('Capture did not pause');await new Promise(resolve=>setTimeout(resolve,20));}
  const count=await js('agentDirtyTest.wire.length');
  const cancelled=await js("(async()=>{const t=agentDirtyTest;t.assistAgent.generation++;t.pauseCapture=false;t.resumeCapture();return await t.pending;})()");
  const after=await js('({count:agentDirtyTest.wire.length,...agentDirtyTest.read()})');
  check('Cancelled capture sends no request and preserves input',cancelled==='blocked'&&after.count===count&&after.left&&after.right&&after.far&&!after.snapshots,after);
  assert.deepEqual(report.errors,[]);
 }catch(error){report.failure=error.stack;process.exitCode=1;}
 finally{win?.destroy();server?.closeAllConnections?.();if(server)await new Promise(resolve=>server.close(resolve));report.serverClosed=!server?.listening;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
 console.log(JSON.stringify(report));app.exit(process.exitCode||0);
});
