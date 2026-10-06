"use strict";
// Reproduce ranked input -> Suggest / Auto AI with real ink and capture geometry.
// Model replies are intercepted; every run uses an isolated local document.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = path.resolve(__dirname, ".."), baseline = process.argv.includes("--baseline"), cloud = process.argv.includes("--cloud"),
  clientRoot = path.resolve(process.env.PENECHO_VERIFY_CLIENT_ROOT || (cloud ? path.join(root, "../penecho_cloud/public/canvas") : path.join(root, "public"))),
  output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/summon-request-target-20261006", baseline ? "before" : cloud ? "cloud" : "after")),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-summon-request-"));
fs.mkdirSync(output, { recursive:true });
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_JEVISION_ENABLED:"false", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const injection = `
  if (${cloud}) window.PENECHO_CONFIG.runtime='cloud';
  markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);markChangelogSeen();
  requireAiConnectionSelection=()=>true;selectedAiConnectionId=()=>"test-connection";aiConnectionScope=()=>"test-scope";
  window.anchorAudit={state,smartSuggest,penIntel,canvasDocumentsReady,loadCanvasSettings,closeFeatureTour,smartSuggestSyncDocument,runSmartSuggest,smartSuggestCluster,launchAutomaticAI,setCanvasMode,render,stopActiveAIRequests,commands:[]};
  anchorAudit.stopTimers=()=>{clearTimeout(state.timer);clearTimeout(smartSuggest.timer);clearTimeout(smartSuggest.localTimer);smartSuggest.timer=smartSuggest.localTimer=state.timer=0;smartSuggest.localReadyAt=smartSuggest.inkReadyAt=0;assistRefreshRank();};
  anchorAudit.draw=points=>{
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),box={x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)},drawing={start:points[0],last:points.at(-1),bbox:box,size:5,color:'#202938',samples:points.map(point=>({point,size:5}))};
    state.drawing=drawing;smartSuggestDrawingStarted(drawing);
    for(let i=1;i<points.length;i++)stroke(points[i-1],points[i],false,5,true,'#202938');
    state.drawing=null;state.userRevision++;state.autoEligible=true;save();smartSuggestDrawingFinished(drawing);anchorAudit.stopTimers();render();
  };
  const glyphs={D:[[[0,0],[0,40]],[[0,0],[18,2],[30,15],[30,27],[18,40],[0,40]]],r:[[[0,40],[0,20],[0,29],[8,18],[16,20]]],a:[[[18,22],[6,20],[0,29],[2,40],[13,38],[18,22],[18,40]]],w:[[[0,20],[5,40],[14,25],[22,40],[30,20]]],f:[[[24,0],[14,2],[8,12],[8,40]],[[0,18],[23,18]]],'(':[[[15,0],[7,7],[3,20],[7,33],[15,40]]],')':[[[3,0],[11,7],[15,20],[11,33],[3,40]]],x:[[[0,20],[23,40]],[[22,20],[0,40]]],'=':[[[0,18],[24,18]],[[0,30],[24,30]]],s:[[[22,20],[10,17],[2,22],[4,28],[19,32],[22,37],[13,41],[1,38]]],i:[[[8,22],[8,40]],[[8,10],[8,12]]],n:[[[0,40],[0,20],[0,28],[12,18],[22,24],[22,40]]]};
  anchorAudit.write=(text,x,y)=>{for(const char of text){for(const line of glyphs[char]||[])anchorAudit.draw(line.map(([px,py])=>({x:x+px*1.7,y:y+py*1.7})));x+=(char===' '?20:char==='i'?18:char==='('?22:char===')'?22:32)*1.7;}};
  const actualFetch=window.fetch;
  window.fetch=(url,options)=>{
    if(String(url).endsWith('/suggest'))return Promise.resolve(new Response(JSON.stringify({ok:true,model:'intercepted-test-response',answers:{kind:{type:'choice',choice:'math',probabilities:{math:1}},action:{type:'choice',choice:'plot',confidence:1,probabilities:{plot:1}},finished:{noul:1},execution_plot:{type:'choice',choice:'canvas_ai'}}}),{headers:{'Content-Type':'application/json'}}));
    if(url==='/api/ai/command'){
      anchorAudit.commands.push(JSON.parse(options.body));
      return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled test request','AbortError')),{once:true}));
    }
    return actualFetch(url,options);
  };
`;
const client=fs.readFileSync(path.join(clientRoot,"app.js"),"utf8").replace(/\}\)\(\);\s*$/,injection+"})();");
const report={baseline,clientRoot,runtime:cloud?"cloud-mirror":"local",mockedInference:true,checks:[],errors:[]};
let server,browser;
(async()=>{
  try {
    server=require("../server.js");
    await new Promise((resolve,reject)=>{server.once("error",reject);server.listening?resolve():server.once("listening",resolve);});
    browser=await chromium.launch({headless:true});
    for(const trigger of ["suggest","auto"]) {
      const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2,reducedMotion:"reduce"});
      page.on("pageerror",error=>report.errors.push(error.message));
      await page.route(/^https:\/\//,route=>route.abort());
      await page.route("**/app.js*",route=>route.fulfill({contentType:"application/javascript",body:client}));
      for(const file of ["summon.js","style.css"])await page.route(`**/${file}*`,route=>route.fulfill({contentType:file.endsWith("css")?"text/css":"application/javascript",body:fs.readFileSync(path.join(clientRoot,file),"utf8")}));
      await page.route("**/suggest/status",route=>route.fulfill({json:{configured:true}}));
      await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:"domcontentloaded"});
      await page.waitForFunction(()=>Boolean(window.anchorAudit));
      await page.evaluate(async()=>{
        const t=anchorAudit,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();t.closeFeatureTour({retry:false,changelog:false});document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true;
        Object.assign(s,{auto:false,mode:'pen',scale:1,panX:0,panY:0,language:'en',viewInitialized:true,summonEnabled:true});t.penIntel.settings.gestures=false;t.penIntel.settings.stepCheck=false;t.smartSuggest.enabled=true;t.smartSuggest.available=true;t.smartSuggestSyncDocument();
        t.write('Draw f(x)=x sin x',80,240);await t.runSmartSuggest();t.stopTimers();
      });
      await page.waitForFunction(()=>anchorAudit.smartSuggest.jev);
      const ranked=await page.evaluate(()=>({dirty:anchorAudit.state.dirty,box:anchorAudit.smartSuggestCluster().box}));
      assert.equal(ranked.dirty,null,"successful ranking consumed its input before AI starts");
      if(trigger==="suggest")await page.locator('[data-suggestion="plot"]').click();
      else await page.evaluate(()=>{anchorAudit.state.auto=true;anchorAudit.launchAutomaticAI('test-auto-deadline');});
      await page.waitForFunction(()=>anchorAudit.commands.length===1&&!!document.querySelector('.summon-copy'));
      const measure=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
        const t=anchorAudit,s=t.state,copy=document.querySelector('.summon-copy'),style=getComputedStyle(copy),transform={scale:s.scale,panX:s.panX,panY:s.panY,width:document.querySelector('#viewport').clientWidth,height:document.querySelector('#viewport').clientHeight};
        resolve({anchor:s.summonAnchor,changedBox:t.commands[0].changedBox,caption:{x:parseFloat(style.left),y:parseFloat(style.top)},expected:PENECHO_SUMMON.echoLayout(PENECHO_SUMMON.projectRegion(t.commands[0].changedBox,transform),transform),transform});
      }))));
      const initial=await measure();
      assert.deepEqual(initial.changedBox,ranked.box,"the model request focuses the complete ranked input");
      await page.screenshot({path:path.join(output,`${trigger}-request.png`)});
      if(baseline) {
        assert.equal(initial.anchor,null,"production loses the animation anchor after ranking");
        assert.ok(Math.abs(initial.caption.x-initial.expected.status.x)>100,"production caption is visibly detached from its request target");
      } else {
        assert.deepEqual(initial.anchor,ranked.box,"animation and request share the same target");
        for(const axis of ["x","y"])assert.ok(Math.abs(initial.caption[axis]-initial.expected.status[axis])<0.1,"caption sits below the complete input");
        await page.evaluate(()=>{const t=anchorAudit;t.state.panX=-160;t.state.panY=80;t.render();});
        const panned=await measure();assert.equal(panned.caption.x,initial.caption.x-160);assert.equal(panned.caption.y,initial.caption.y+80);
        await page.evaluate(()=>{const t=anchorAudit;t.state.scale=0.7;t.render();});
        const zoomed=await measure();for(const axis of ["x","y"])assert.ok(Math.abs(zoomed.caption[axis]-zoomed.expected.status[axis])<0.1);
        await page.screenshot({path:path.join(output,`${trigger}-pan-zoom.png`)});
      }
      report.checks.push({trigger,ranked,initial});
      await page.evaluate(()=>anchorAudit.stopActiveAIRequests());
      await page.waitForFunction(()=>document.querySelector('#summonLayer').hidden&&!document.querySelector('.summon-copy'));
      await page.close();
    }
    assert.deepEqual(report.errors,[]);
  } finally {
    await browser?.close();server?.closeAllConnections?.();if(server)await new Promise(resolve=>server.close(resolve));report.serverClosed=!server?.listening;
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));fs.rmSync(temporary,{recursive:true,force:true});
  }
  console.log(JSON.stringify({output,checks:report.checks.length,errors:report.errors,serverClosed:report.serverClosed}));
})().catch(error=>{console.error(error);process.exitCode=1;});
