"use strict";
// Replay DNA -> heart architecture -> new drawing in the built renderer.
// Canvas content and dirty masks are real; inference responses are intercepted.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = path.resolve(__dirname, ".."), baseline = process.argv.includes("--baseline"), cloud = process.argv.includes("--cloud"),
  clientRoot = cloud ? path.resolve(root, "../penecho_cloud/public/canvas") : path.join(root, "public"),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "suggest-dirty-lifecycle-")),
  output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || path.join(root, "docs/verification/suggest-dirty-lifecycle-20261006", baseline ? "before" : cloud ? "cloud" : "after"));
fs.mkdirSync(output, { recursive:true });
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_JEVISION_ENABLED:"false", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const injection = `
  if (${cloud}) window.PENECHO_CONFIG.runtime='cloud';
  markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);markChangelogSeen();
  requireAiConnectionSelection=()=>true;selectedAiConnectionId=()=>"test-connection";aiConnectionScope=()=>"test-scope";
  window.lifecycle={acceptPending,launchAutomaticAI,closeFeatureTour,state,smartSuggest,penIntel,canvasDocumentsReady,loadCanvasSettings,runSmartSuggest,smartSuggestSyncDocument,smartSuggestCluster,smartSuggestCropRegion,smartSuggestCrop,smartSuggestObjectsChanged,renderedTextBoxRecord,offscreen,executeAssistAction,assistView,cancelSmartSuggest,clearDirtyContributionTracking,tiles,save,undo,redo,captureSelection,cancelSelection,dirtyInputSnapshots,render,requests:[],commands:[],replyMode:'success',held:[]};
  lifecycle.stopTimers=()=>{clearTimeout(smartSuggest.timer);clearTimeout(smartSuggest.localTimer);smartSuggest.timer=smartSuggest.localTimer=0;smartSuggest.localReadyAt=smartSuggest.inkReadyAt=0;assistRefreshRank();};
  lifecycle.draw=(points,at=performance.now())=>{
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),box={x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
    const drawing={start:points[0],last:points.at(-1),bbox:box,size:6,color:'#202938',samples:points.map(point=>({point,size:6}))};
    state.drawing=drawing;smartSuggestDrawingStarted(drawing);
    for(let i=1;i<points.length;i++)stroke(points[i-1],points[i],false,6,true,'#202938');
    state.drawing=null;state.userRevision++;state.autoEligible=true;save();smartSuggestDrawingFinished(drawing);
    const record=smartSuggest.strokes.at(-1);record.at=at;lifecycle.stopTimers();render();return record.id;
  };
  const glyphs={D:[[[0,0],[0,40]],[[0,0],[18,2],[30,15],[30,27],[18,40],[0,40]]],N:[[[0,40],[0,0],[30,40],[30,0]]],A:[[[0,40],[15,0],[30,40]],[[6,25],[25,25]]],h:[[[0,0],[0,40],[0,24],[10,18],[18,24],[18,40]]],e:[[[0,30],[18,30],[17,22],[8,20],[0,27],[2,37],[18,40]]],a:[[[18,22],[6,20],[0,29],[2,40],[13,38],[18,22],[18,40]]],r:[[[0,40],[0,22],[0,29],[8,20],[16,22]]],t:[[[10,8],[10,36],[18,40]],[[0,22],[20,22]]],c:[[[18,22],[8,20],[0,28],[1,38],[18,40]]],i:[[[8,22],[8,40]],[[8,10],[8,12]]],u:[[[0,22],[0,38],[8,40],[18,33],[18,22],[18,40]]]};
  lifecycle.word=(text,x,y,at)=>{const ids=[];for(const char of text){for(const line of glyphs[char]||[])ids.push(lifecycle.draw(line.map(([px,py])=>({x:x+px,y:y+py})),at));x+=char===' '?22:char==='i'?18:char===char.toUpperCase()?40:28;}return ids;};
  lifecycle.read=()=>{
    const c=smartSuggestCluster(),r=c&&smartSuggestCropRegion(c);let pixels=0;
    for(const mask of state.dirtyInkTiles.values()){const d=mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data;for(let i=3;i<d.length;i+=4)if(d[i])pixels++;}
    return {dirty:state.dirty,dirtyPixels:pixels,dirtyTexts:[...state.dirtyTextBoxIds],dirtyImages:[...state.dirtyImageIds],snapshots:dirtyInputSnapshots.size,scope:c&&{key:c.key,box:c.box,strokes:c.strokes.map(r=>r.id),objects:c.objects?.map(o=>o.item.id)},region:r,rank:smartSuggest.bar?.view?.source,barVisible:!!smartSuggest.bar&&!smartSuggest.bar.element.hidden};
  };
  lifecycle.reset=()=>{
    cancelSmartSuggest('test-reset');cancelSelection(true);tiles.clear();state.inkBounds.clear();clearDirtyContributionTracking();
    state.history=[];state.future=[];state.historyBefore.clear();state.dirtyHistoryBefore=null;state.images=[];state.textBoxes=[];state.hotspotTrail=[];state.latestTypedInput=null;state.dirty=null;state.autoEligible=false;
    Object.assign(smartSuggest,{strokes:[],consumedStrokeId:0,dismissedStrokeId:0,evaluatedStrokeId:0,jev:null,nextCandidate:null,lastKey:'',pausedUntil:0,failures:0,writingMs:0});
    lifecycle.replyMode='success';lifecycle.replyAction='create_visual';lifecycle.requests=[];lifecycle.commands=[];lifecycle.held=[];
  };
  const actualFetch=window.fetch;
  window.fetch=(url,options)=>{
    if(String(url).endsWith('/suggest')){
      const payload=JSON.parse(options.body),scope=smartSuggestCluster(),region=scope&&smartSuggestCropRegion(scope);
      lifecycle.requests.push({payload,region,scope:scope&&{box:scope.box,strokes:scope.strokes.map(s=>s.id)},dirtyAtSend:state.dirty});
      const response=()=>new Response(JSON.stringify(lifecycle.replyMode==='failure'?{ok:false,reason:'test-failure'}:{ok:true,model:'intercepted-test-response',answers:{kind:{type:'choice',choice:'notes',probabilities:{notes:1}},action:{type:'choice',choice:lifecycle.replyAction,confidence:1,probabilities:{[lifecycle.replyAction]:1}},finished:{noul:1},execution_create_visual:{type:'choice',choice:'canvas_ai'}}}),{status:lifecycle.replyMode==='failure'?503:200,headers:{'Content-Type':'application/json'}});
      return lifecycle.replyMode==='hold'?new Promise(resolve=>lifecycle.held.push(()=>resolve(response()))):Promise.resolve(response());
    }
    if(url==='/api/ai/command'){
      lifecycle.commands.push(JSON.parse(options.body));
      return Promise.resolve(new Response(JSON.stringify({commands:[{tool:'write_text',text:lifecycle.commands.length===1?'DNA result (test)':'Heart result (test)',x:lifecycle.commands.length===1?180:470,y:350,w:260,h:45,maxWidth:260,fontSize:24,color:'#2563eb'}]}),{headers:{'Content-Type':'application/json'}}));
    }
    return actualFetch(url,options);
  };
`;
const client = fs.readFileSync(path.join(clientRoot,"app.js"),"utf8").replace(/\}\)\(\);\s*$/, injection+"})();");
const report = {baseline,runtime:cloud?"cloud-mirror":"local",mockedInference:true,checks:[],errors:[]};
let browser,server;
async function capture(page,name){await page.screenshot({path:path.join(output,name+".png")});}
async function state(page){return page.evaluate(()=>lifecycle.read());}
(async()=>{
  try{
    server=require('../server.js');await new Promise((resolve,reject)=>{server.once('error',reject);server.listening?resolve():server.once('listening',resolve);});
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
    page.on('pageerror',e=>report.errors.push(e.message));
    await page.route(/^https:\/\//,route=>route.abort());
    await page.route('**/app.js*',route=>route.fulfill({contentType:'application/javascript',body:client}));
    await page.route('**/suggest/status',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({configured:true})}));
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
    await page.evaluate(async()=>{const t=lifecycle;await t.canvasDocumentsReady();await t.loadCanvasSettings();t.closeFeatureTour({retry:false,changelog:false});document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true;Object.assign(t.state,{auto:false,mode:'pen',scale:1,panX:0,panY:0,language:'en',viewInitialized:true});t.penIntel.settings.gestures=false;t.penIntel.settings.stepCheck=false;t.smartSuggest.enabled=true;t.smartSuggest.available=true;t.smartSuggestSyncDocument();t.reset();});
    await page.evaluate(async()=>{lifecycle.word('DNA',180,180,1000);await lifecycle.runSmartSuggest();lifecycle.stopTimers();});
    report.dnaRanked=await state(page);await capture(page,'01-dna-ranked');
    const execute=()=>page.evaluate(async()=>{const t=lifecycle,c=t.smartSuggestCluster(),target={box:c.box,newBox:c.newBox,strokes:c.strokes,routing:t.assistView(c).routing};await t.executeAssistAction({id:'create_visual'},target);if(target.requestPromise){let done=false;target.requestPromise.finally(()=>done=true);for(let i=0;i<500&&!done;i++){if(t.state.pending)t.acceptPending({restoreMode:false});await new Promise(r=>setTimeout(r,10));}if(!done)throw Error('Action did not complete');await target.requestPromise;}t.state.mode='pen';t.stopTimers();});
    await execute();report.dnaCompleted=await state(page);
    const heartIds=await page.evaluate(async()=>{const heart=lifecycle.word('heart',180,250,2000),architecture=lifecycle.word('architecture',420,250,16000);await lifecycle.runSmartSuggest();lifecycle.stopTimers();return {heart,architecture};});
    report.heartIds=heartIds;report.heartRanked=await state(page);await capture(page,'02-heart-ranked');
    await execute();report.heartCompleted=await state(page);await capture(page,'03-heart-completed');
    await page.evaluate(async()=>{const t=lifecycle;t.draw(Array.from({length:49},(_,i)=>({x:1080+95*Math.cos(i/48*Math.PI*2),y:370+70*Math.sin(i/48*Math.PI*2)})),30000);t.draw([{x:1060,y:350},{x:1062,y:352}],30100);t.draw([{x:1100,y:350},{x:1102,y:352}],30200);await t.runSmartSuggest();t.stopTimers();});
    report.nextRanked=await state(page);await capture(page,'04-next-ranked');
    const requests=await page.evaluate(()=>lifecycle.requests.map(r=>({...r,payload:{...r.payload}})));
    report.requests=requests.map((r,i)=>{const {image,...payload}=r.payload;fs.writeFileSync(path.join(output,'request-'+(i+1)+'.webp'),Buffer.from(image.split(',')[1],'base64'));return {...r,payload:{...payload,image:'request-'+(i+1)+'.webp'}};});
    assert.equal(requests.length,3);assert.equal((await page.evaluate(()=>lifecycle.commands.length)),2);
    assert.equal(report.dnaCompleted.dirty,null,'completed DNA action clears its input');
    if(baseline){
      assert.ok(report.dnaRanked.dirtyPixels>0,'baseline Suggest success keeps dirty input');
      assert.ok(report.heartCompleted.dirtyPixels>0,'baseline heart action leaves the excluded word dirty');
      assert.ok(report.heartRanked.scope.strokes.every(id=>!heartIds.heart.includes(id)),'baseline recent/proximity clustering excludes heart');
      assert.ok(requests[2].region.x<250,'baseline new drawing is expanded back to heart');
      report.checks.push('Reproduced success retaining dirty','Reproduced heart excluded from action scope','Reproduced completed heart result leaving old dirty','Reproduced next request expanded to old heart');
    }else{
      assert.ok(report.dnaRanked.dirtyPixels>0);assert.ok(report.heartRanked.dirtyPixels>0);assert.equal(report.heartCompleted.dirty,null);assert.ok(report.nextRanked.dirtyPixels>0);
      assert.ok(heartIds.heart.every(id=>report.heartRanked.scope.strokes.includes(id)),'all words share one dirty input scope');
      assert.ok(requests[2].region.x>900,'new request no longer includes old heart');
      assert.equal(report.nextRanked.rank,'penecho-llm');assert.equal(await page.locator('.assist-bar[data-rank="ranked"]').isVisible(),true);
      report.checks.push('Successful Suggest preserves its complete dirty input','No grouping by stroke time or distance','Completed Canvas actions consume their complete input','New drawing request excludes completed old heart');
      // Ranking preserves input on success, failure and cancellation races.
      await page.evaluate(async()=>{lifecycle.reset();lifecycle.word('heart',180,250,1000);lifecycle.replyMode='failure';await lifecycle.runSmartSuggest();lifecycle.stopTimers();});
      report.failure=await state(page);assert.ok(report.failure.dirtyPixels>0);assert.equal(report.failure.snapshots,0);
      await page.evaluate(()=>{lifecycle.reset();lifecycle.draw([{x:180,y:250},{x:280,y:250}],1000);lifecycle.replyMode='hold';window.heldRun=lifecycle.runSmartSuggest();});
      await page.waitForFunction(()=>lifecycle.held.length===1);
      await page.evaluate(async()=>{lifecycle.draw([{x:230,y:250},{x:260,y:250}],2000);lifecycle.draw([{x:1050,y:500},{x:1150,y:500}],2100);lifecycle.replyMode='success';lifecycle.held[0]();await heldRun;lifecycle.stopTimers();});
      report.race=await state(page);assert.ok(report.race.dirtyPixels>0);assert.ok(report.race.dirty.x<180);assert.equal(report.race.snapshots,0);
      await page.evaluate(async()=>{await lifecycle.runSmartSuggest();lifecycle.stopTimers();});assert.deepEqual((await state(page)).dirty,report.race.dirty);
      report.checks.push('Failures preserve pending input','Cancellation race preserves earlier, overlapping and distant new strokes','Follow-up ranking leaves the complete dirty input unchanged');
      await page.evaluate(async()=>{const t=lifecycle;t.reset();t.replyAction='none';t.word('heart',180,250,1000);await t.runSmartSuggest();t.stopTimers();});
      report.none=await state(page);assert.ok(report.none.dirtyPixels>0);assert.equal(report.none.rank,'penecho-llm');
      await page.evaluate(async()=>{const t=lifecycle;t.reset();const text=await t.renderedTextBoxRecord({id:'manual-text',text:'Heart architecture',x:180,y:250,w:300,h:50,maxWidth:300,fontSize:24,color:'#202938'}),image={id:'manual-image',x:900,y:250,w:80,h:80,image:t.offscreen(80,80)};image.image.getContext('2d').fillRect(0,0,80,80);t.state.textBoxes.push(text);t.state.images.push(image);t.state.dirtyTextBoxIds.add(text.id);t.state.dirtyImageIds.add(image.id);t.state.dirty={x:180,y:250,w:800,h:80};t.state.mode='hand';t.smartSuggestObjectsChanged();t.stopTimers();await t.runSmartSuggest();t.stopTimers();});
      report.objects=await state(page);assert.ok(report.objects.dirty);assert.equal(report.objects.dirtyTexts.length,1);assert.equal(report.objects.dirtyImages.length,1);assert.equal(report.objects.scope.objects.length,2);assert.equal(report.objects.rank,'penecho-llm');
      await page.evaluate(async()=>{const t=lifecycle;t.reset();t.state.mode='pen';t.draw([{x:180,y:250},{x:280,y:250}],1000);t.draw([{x:1000,y:250},{x:1100,y:250}],1100);t.captureSelection([{x:150,y:220},{x:310,y:220},{x:310,y:280},{x:150,y:280}]);t.stopTimers();await t.runSmartSuggest();t.stopTimers();});
      report.selection=await state(page);assert.ok(report.selection.dirty.x<180);assert.ok(report.selection.dirty.x+report.selection.dirty.w>1100);assert.equal(report.selection.snapshots,0);
      await page.evaluate(async()=>{const t=lifecycle;t.reset();t.state.mode='pen';t.draw([{x:180,y:250},{x:280,y:250}],1000);await t.runSmartSuggest();t.stopTimers();t.draw([{x:1000,y:250},{x:1100,y:250}],2000);t.undo();t.stopTimers();});
      report.undo=await state(page);assert.ok(report.undo.dirtyPixels>0);assert.ok(report.undo.dirty.x+report.undo.dirty.w<900);
      await page.evaluate(()=>{lifecycle.redo();lifecycle.stopTimers();});report.redo=await state(page);assert.ok(report.redo.dirty.x<180);assert.ok(report.redo.dirty.x+report.redo.dirty.w>1100);
      report.checks.push('A none verdict preserves submitted dirty','Manual text and images stay dirty while their Hand-mode actions remain usable','Lasso ranking leaves selected and unrelated dirty input unchanged','Undo and Redo preserve the earlier pending input');
      await page.evaluate(async()=>{const t=lifecycle;t.reset();t.state.auto=false;t.state.mode='pen';t.word('heart',180,250,1000);await t.runSmartSuggest();t.stopTimers();if(!t.state.dirty)throw Error('Auto fixture lost dirty input during ranking');t.state.auto=true;t.launchAutomaticAI('test-auto-deadline');});
      await page.waitForFunction(()=>lifecycle.state.pending,null,{timeout:5000});
      await page.evaluate(()=>lifecycle.acceptPending({restoreMode:false}));
      await page.waitForFunction(()=>!lifecycle.state.activeAI);
      report.auto=await state(page);assert.equal(await page.evaluate(()=>lifecycle.commands.length),1);
      await page.evaluate(()=>lifecycle.launchAutomaticAI('test-repeated-deadline'));
      assert.equal(await page.evaluate(()=>lifecycle.commands.length),1,'ranked input is executed only once by Auto AI');
      report.checks.push('Auto AI follows its original dirty eligibility and consumes input on completion');
    }
    assert.deepEqual(report.errors,[]);
  }finally{
    await browser?.close();server?.closeAllConnections?.();if(server)await new Promise(resolve=>server.close(resolve));report.serverClosed=!server?.listening;
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({output,baseline,checks:report.checks,errors:report.errors}));
})().catch(error=>{console.error(error);process.exitCode=1;});
