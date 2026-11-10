'use strict';
// Isolated browser acceptance for suggestion cadence, replacement and dirty consumption.
const {chromium}=require(process.env.PENECHO_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),cloud=process.argv.includes('--cloud');
const clientRoot=cloud?path.resolve(root,'../penecho_cloud/public/canvas'):path.join(root,'public');
const recordedReplyPath=process.argv.find(arg=>arg.startsWith('--recorded-reply='))?.slice(17);
const recordedReply=recordedReplyPath?JSON.parse(fs.readFileSync(path.resolve(recordedReplyPath),'utf8')):null;
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'suggest-cadence-'));
const output=path.resolve(process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||path.join(root,'docs/verification/suggest-cadence-20260930'));fs.mkdirSync(output,{recursive:true});
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temporary,'state'),PENECHO_CONFIG_FILE:path.join(temporary,'config.env'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test-only',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_JEVISION_ENABLED:'false',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false'});
const server=require('../server.js');
server.prependListener('request',req=>{if(cloud&&req.url.startsWith('/canvas/'))req.url=req.url.slice('/canvas'.length);});
(async()=>{let browser;try{
  await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],report={runtime:cloud?'cloud':'local',checks:[]};
  page.on('pageerror',error=>errors.push(error.message));
  const injection=`
    const rankingMotions=[],originalAnimate=Element.prototype.animate;
    Element.prototype.animate=function(...args){
      if(this.matches('.assist-bar [data-suggestion]'))rankingMotions.push({id:this.dataset.suggestion,keyframes:args[0]});
      return originalAnimate.apply(this,args);
    };
    if(${cloud})Object.assign(window.PENECHO_CONFIG,{runtime:'cloud',connectionAccountId:'test-only',linkedDeviceId:'test-only',linkedDeviceOnline:true});
    window.cadence={TILE,DIRTY_MASK_SCALE,state,smartSuggest,penIntel,assistAgent,canvasDocumentsReady,loadCanvasSettings,loadHostedModels,aiConnectionScope,settings,storeAiConnectionSelection,smartSuggestDrawingStarted,smartSuggestDrawingFinished,smartSuggestCluster,smartSuggestCropRegion,smartSuggestInputConsumed,assistRefresh,hideAssist,requestAI,stroke,save,render,captureDirtyInput,consumeDirtyInput,releaseDirtyInput,recomputeDirtyBounds,clearDirtyContributionTracking,assistAgentFinishResult,canvasAgent,canvasDocumentsCurrent,openCanvasAgent,closeCanvasAgent,canvasAgentIsOpen,requests:[],commands:[],aborted:[],releases:[],suggestReplies:[],suggestAborted:[],localSchedules:[]};
    const originalSetTimeout=window.setTimeout;
    window.setTimeout=(fn,delay,...args)=>{
      if(fn.name==='showLocal'){
        cadence.localSchedules.push(delay);
        if(cadence.earlyLocalTimer){cadence.earlyLocalTimer=false;return originalSetTimeout(fn,Math.max(0,delay-25),...args);}
      }
      return originalSetTimeout(fn,delay,...args);
    };
    const originalFetch=window.fetch;
    cadence.testConnection={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',provider:'api',hasApiKey:true,apiUrl:'http://127.0.0.1:1/v1',apiModel:'test'};
    window.fetch=(url,options)=>{
      const t=cadence;
      if(url==='/api/v1/models')return Promise.resolve(new Response(JSON.stringify({accountId:'test-only',models:[],credits:{available:1}})));
      if(${cloud}&&url==='/api/settings/connections')return Promise.resolve(new Response(JSON.stringify({connections:[t.testConnection]})));
      if(String(url).endsWith('/suggest/status'))return Promise.resolve(new Response(JSON.stringify({configured:true,model:'PenEchoLLM'})));
      if(String(url).endsWith('/suggest')){
        const index=t.requests.push({at:performance.now(),body:JSON.parse(options.body)})-1;
        const recordedReply=${JSON.stringify(recordedReply)};
        const response=()=>new Response(JSON.stringify(index<2&&recordedReply?recordedReply:{ok:true,answers:{kind:{type:'choice',choice:'notes',probabilities:{notes:1}},action:{type:'choice',choice:'answer',probabilities:{answer:1}},execution_answer:{type:'choice',choice:'canvas_ai'}}}));
        if(t.deferSuggestions)return new Promise(resolve=>{
          options.signal.addEventListener('abort',()=>t.suggestAborted.push(index),{once:true});
          // Deliberately deliver after abort to exercise the response/cancellation race.
          t.suggestReplies[index]=()=>resolve(response());
        });
        return Promise.resolve(response());
      }
      if(url==='/api/ai/command')return new Promise((resolve,reject)=>{
        const index=t.commands.push(JSON.parse(options.body))-1;
        options.signal.addEventListener('abort',()=>{t.aborted.push(index);reject(new DOMException('Aborted','AbortError'));},{once:true});
        t.releases[index]=()=>resolve(new Response(JSON.stringify({commands:[{tool:'html_widget',pluginId:'general',x:150,y:400,w:450,h:240,title:'Completed answer',refreshSeconds:0,html:'<!doctype html><html><body style="background:white"><h1>Answer</h1><p>x = t − 3</p></body></html>'}]})));
      });
      return originalFetch(url,options);
    };
    cadence.rankingMotions=rankingMotions;
    cadence.shown=[];
    const originalRenderAssist=renderAssist;
    renderAssist=model=>{const result=originalRenderAssist(model);if(model.mode==='suggest'&&!state.drawing&&!smartSuggest.bar.element.classList.contains('is-writing'))cadence.shown.push({at:performance.now(),x:model.box.x});return result;};
    cadence.begin=(x,y)=>{
      const drawing={start:{x,y},last:{x,y},bbox:{x,y,w:100,h:60},size:5,color:'#202938',samples:[]};
      state.drawing=drawing;smartSuggestDrawingStarted(drawing);return performance.now();
    };
    cadence.finish=()=>{
      const d=state.drawing,p=d.start,points=[p,{x:p.x+35,y:p.y+60},{x:p.x+65,y:p.y+5},{x:p.x+100,y:p.y+55}];
      for(let i=1;i<points.length;i++)stroke(points[i-1],points[i],false,5,true,d.color);
      d.samples=points.map(point=>({point,size:5}));state.drawing=null;save();smartSuggestDrawingFinished(d);render();return smartSuggest.strokes.at(-1).at;
    };
  `;
  const app=fs.readFileSync(path.join(clientRoot,'app.js'),'utf8').replace(/\}\)\(\);\s*$/,injection+'})();');
  await page.route(/^https:\/\//,route=>route.abort());
  await page.route('**/app.js*',route=>route.fulfill({contentType:'application/javascript',body:app}));
  await page.route('**/style.css*',route=>route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(clientRoot,'style.css'),'utf8')}));
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.cadence);
  await page.evaluate(async()=>{const t=cadence,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();if(window.PENECHO_CONFIG.runtime==='cloud'){await t.loadHostedModels({accountChanged:true});t.settings.connections=[t.testConnection];t.settings.connectionScope=t.aiConnectionScope();}t.storeAiConnectionSelection(t.settings.connections[0].id);document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();s.auto=false;s.mode='pen';s.scale=1;s.panX=0;s.panY=0;t.smartSuggest.enabled=true;t.smartSuggest.available=true;t.penIntel.settings.gestures=false;t.penIntel.settings.stepCheck=false;});
  await page.evaluate(()=>{cadence.openCanvasAgent({focus:false,animate:false,connect:false});cadence.deferSuggestions=true;cadence.localSchedules=[];cadence.earlyLocalTimer=true;});
  assert.equal(await page.evaluate(()=>cadence.canvasAgentIsOpen()),true);
  const first=await page.evaluate(()=>{cadence.begin(300,210);return cadence.finish();});
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.assist-bar[data-mode=suggest]').isVisible(),false,'no bar during the first 500 ms');
  assert.equal(await page.evaluate(()=>cadence.requests.length),0);
  await page.waitForSelector('.assist-bar[data-mode=suggest]');
  const shown=await page.evaluate(()=>cadence.shown[0].at);
  assert.ok(shown-first>=490&&shown-first<800,'local help appears after 500 ms of quiet');
  assert.ok(await page.evaluate(()=>cadence.localSchedules.length>=2&&cadence.localSchedules.some(delay=>delay>0&&delay<50)),'an early browser timer rearms the local deadline');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.assist-bar'),'::after').animationName),'penecho-llm-scan');
  await page.waitForFunction(()=>cadence.requests.length===1);
  const latency=await page.evaluate(first=>cadence.requests[0].at-first,first);assert.ok(latency>=590&&latency<950);
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.assist-bar')).opacity)>.99);
  assert.equal(await page.evaluate(()=>cadence.smartSuggest.bar.view.source),'local','Agent visibility and a held model reply leave local help visible');
  await page.screenshot({path:path.join(output,report.runtime+'-shown.png')});
  report.checks.push('Agent panel open and a forced early timer still show local help at 500 ms while the model response remains pending');
  await page.evaluate(()=>{cadence.deferSuggestions=false;cadence.suggestReplies[0]();cadence.closeCanvasAgent({focus:false,animate:false});});
  await page.waitForFunction(()=>cadence.smartSuggest.bar.view.source==='penecho-llm');
  await page.evaluate(()=>{cadence.smartSuggest.bar.hovered=true;cadence.begin(800,230);});
  await page.waitForTimeout(85);
  const middle=await page.evaluate(()=>Number(getComputedStyle(document.querySelector('.assist-bar')).opacity));assert.equal(middle,0);
  await page.waitForTimeout(160);
  assert.equal(await page.evaluate(()=>Number(getComputedStyle(document.querySelector('.assist-bar')).opacity)),0);
  await page.screenshot({path:path.join(output,report.runtime+'-writing.png')});
  await page.waitForTimeout(3000);
  const second=await page.evaluate(()=>cadence.finish());
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>getComputedStyle(cadence.smartSuggest.bar.element).visibility),'hidden','the existing bar stays hidden after pen-up');
  await page.waitForFunction(()=>cadence.smartSuggest.bar?.box.x>700);
  const moved=await page.evaluate(()=>cadence.shown.find(entry=>entry.x>700).at);assert.ok(moved-second>=490&&moved-second<800,`stale hover cannot defer relocation after 500 ms: ${moved-second} ms`);
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>cadence.requests.length),1);
  await page.waitForFunction(()=>cadence.requests.length===2);
  const continued=await page.evaluate(second=>cadence.requests[1].at-second,second);assert.ok(continued>=990&&continued<1350);
  await page.waitForFunction(()=>cadence.smartSuggest.bar.view.source==='penecho-llm');
  assert.equal(await page.evaluate(()=>cadence.smartSuggest.nextCandidate),null,'final medium reply is shown without another stroke');
  assert.equal(await page.evaluate(()=>cadence.smartSuggest.bar.element.dataset.rank),'ranked');
  if(recordedReply){
    const visible=await page.evaluate(()=>({penDown:!!cadence.state.drawing,source:cadence.smartSuggest.bar.view.source,rank:cadence.smartSuggest.bar.element.dataset.rank,items:[...document.querySelectorAll('.assist-bar [data-suggestion]')].map(button=>button.dataset.suggestion),candidate:!!cadence.smartSuggest.nextCandidate}));
    assert.equal(visible.items[0],recordedReply.answers.action.choice);
    assert.ok(visible.items.includes('solve'));
    report.recordedReply=visible;
    await page.screenshot({path:path.join(output,report.runtime+'-final-reply.png')});
  }
  report.cadence={localMs:shown-first,initialMs:latency,continuedMs:continued,relocationMs:moved-second,fadeMidOpacity:middle};
  report.checks.push('500 ms pen-up display delay; immediate pen-down hiding; relocated after stale hover; 600 ms short / 1000 ms medium request debounce based on pen-down duration');
  await page.evaluate(()=>{cadence.deferSuggestions=true;cadence.begin(820,310);cadence.finish();});
  await page.waitForFunction(()=>cadence.smartSuggest.bar.view.source==='penecho-llm');
  assert.equal(await page.evaluate(()=>cadence.smartSuggest.bar.element.dataset.rank),'refreshing');
  assert.equal(await page.evaluate(()=>getComputedStyle(cadence.smartSuggest.bar.element,'::after').animationName),'penecho-llm-scan');
  await page.waitForFunction(()=>cadence.requests.length===3);
  await page.screenshot({path:path.join(output,report.runtime+'-refreshing.png')});
  await page.evaluate(()=>cadence.begin(840,350));
  assert.deepEqual(await page.evaluate(()=>cadence.suggestAborted),[2]);
  assert.equal(await page.evaluate(()=>cadence.smartSuggest.controller),null);
  await page.evaluate(()=>cadence.suggestReplies[2]());
  await page.waitForFunction(()=>cadence.smartSuggest.nextCandidate);
  const resumed=await page.evaluate(()=>cadence.finish());
  await page.waitForFunction(()=>cadence.smartSuggest.bar.view.source==='penecho-llm'&&cadence.smartSuggest.bar.cluster.strokes.at(-1).id===cadence.smartSuggest.strokes.at(-1).id);
  assert.equal(await page.evaluate(()=>getComputedStyle(cadence.smartSuggest.bar.element,'::after').animationName),'penecho-llm-scan');
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>cadence.requests.length),3);
  await page.waitForFunction(()=>cadence.requests.length===4);
  report.cadence.afterAbortMs=await page.evaluate(resumed=>cadence.requests[3].at-resumed,resumed);
  assert.ok(report.cadence.afterAbortMs>=990&&report.cadence.afterAbortMs<1350);
  await page.evaluate(()=>{cadence.deferSuggestions=false;cadence.suggestReplies[3]();});
  report.checks.push('Final medium answers display immediately; interrupted replies supply the next default; refreshing bars keep the scanning line and the next request respects 1 s of quiet');
  await page.evaluate(()=>{void cadence.requestAI('answer').then(result=>{cadence.manualResult={result,status:cadence.state.statusKey,connectionIds:cadence.settings.connections.map(item=>item.id)};});});
  await page.waitForFunction(()=>cadence.commands.length===1||cadence.manualResult);
  assert.equal(await page.evaluate(()=>cadence.commands.length),1,JSON.stringify(await page.evaluate(()=>cadence.manualResult)));
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.assist-bar [data-suggestion=answer]').isEnabled(),true);
  await page.locator('.assist-bar [data-suggestion=answer]').click();
  await page.waitForFunction(()=>cadence.commands.length===2);
  assert.deepEqual(await page.evaluate(()=>cadence.aborted),[0]);
  await page.evaluate(()=>cadence.releases[1]());
  await page.waitForFunction(()=>cadence.state.widgets.length===1&&!cadence.state.activeAI).catch(async error=>{console.error(await page.evaluate(()=>({status:cadence.state.statusKey,widgets:cadence.state.widgets.length,active:!!cadence.state.activeAI,commands:cadence.commands})));throw error;});
  assert.deepEqual(await page.evaluate(()=>({dirty:cadence.state.dirty,tiles:cadence.state.dirtyInkTiles.size})),{dirty:null,tiles:0});
  await page.evaluate(()=>{cadence.begin(850,650);cadence.finish();});
  await page.waitForFunction(()=>cadence.smartSuggest.bar?.mode==='suggest'&&cadence.smartSuggest.bar.box.y>600);
  const next=await page.evaluate(()=>({dirty:cadence.state.dirty,region:cadence.smartSuggestCropRegion(cadence.smartSuggestCluster())}));
  assert.ok(next.dirty.y>600&&next.dirty.x>800);report.nextDirty=next.dirty;
  report.checks.push('A real enabled button aborts the old Canvas request and starts the selected action; committed Widget clears old dirty masks before new handwriting');
  const masks=await page.evaluate(()=>{
    const t=cadence,s=t.state;t.hideAssist('test');clearTimeout(t.smartSuggest.timer);t.clearDirtyContributionTracking();s.dirty=null;
    const draw=(x,y,x2,y2,erase=false)=>t.stroke({x,y},{x:x2,y:y2},erase,5,true,'#111111');
    draw(100,100,250,100);draw(500,100,650,100);
    const snapshot=t.captureDirtyInput({x:80,y:80,w:200,h:50});
    draw(190,100,230,100);draw(400,200,450,200);draw(400,200,420,200,true);
    const probe=(x,y)=>{const scale=t.DIRTY_MASK_SCALE,size=t.TILE,tile=s.dirtyInkTiles.get(Math.floor(x/size)+','+Math.floor(y/size));return tile?tile.getContext('2d').getImageData(Math.floor((x%size)*scale),Math.floor((y%size)*scale),1,1).data[3]:0;};
    const erasedBefore=probe(405,200);t.consumeDirtyInput(snapshot);const dirty={...s.dirty};
    return {dirty,erasedBefore,old:probe(110,100),overlap:probe(210,100),outside:probe(550,100),erased:probe(405,200),newer:probe(440,200)};
  });
  assert.ok(masks.dirty.x>180&&masks.dirty.x<195,'only newer overlapping ink survives inside consumed scope');
  assert.ok(masks.dirty.x+masks.dirty.w>=650,'unrelated dirty content remains');
  assert.ok(masks.dirty.y+masks.dirty.h>200,'newer input remains');
  assert.equal(masks.old,0);assert.ok(masks.overlap>0&&masks.outside>0&&masks.newer>0);assert.equal(masks.erased,masks.erasedBefore);
  report.scopedDirty=masks;
  report.checks.push('Scoped consumption removes old antialiased pixels while preserving newer overlapping ink, outside dirt and erasure');
  const agent=await page.evaluate(()=>{
    const t=cadence,s=t.state;t.clearDirtyContributionTracking();s.dirty=null;
    t.stroke({x:100,y:100},{x:250,y:100},false,5,true,'#111111');
    const snapshot=t.captureDirtyInput({x:80,y:80,w:200,h:50});
    t.assistAgent.resultTarget={inputSnapshot:snapshot,strokeId:t.smartSuggest.strokes.at(-1).id,box:{x:80,y:80,w:200,h:50},resultBox:{x:200,y:300,w:300,h:200},generation:t.assistAgent.generation,documentId:t.canvasDocumentsCurrent().id,conversationId:t.canvasAgent.currentConversation?.id};
    t.smartSuggest.enabled=false;t.assistAgentFinishResult(true);
    const successful=s.dirty;
    t.stroke({x:500,y:100},{x:650,y:100},false,5,true,'#111111');
    const failed=t.captureDirtyInput({x:480,y:80,w:200,h:50});
    t.assistAgent.resultTarget={inputSnapshot:failed,resultBox:{x:1,y:1,w:1,h:1}};t.assistAgentFinishResult(false);
    return {successful,failed:s.dirty};
  });
  assert.equal(agent.successful,null);assert.ok(agent.failed.x>480);
  report.checks.push('Agent success consumes actual dirty masks even with suggestions disabled; failure preserves input');
  report.rankingMotions=await page.evaluate(()=>cadence.rankingMotions);
  assert.deepEqual(report.rankingMotions,[],'ranked actions update in place without moving from previous screen coordinates');
  report.checks.push('PenEchoLLM updates rendered actions in place without drop-in or reorder motion');
  assert.deepEqual(errors,[]);report.errors=errors;
  fs.writeFileSync(path.join(output,report.runtime+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
