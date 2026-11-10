"use strict";
// Run with Node and PENECHO_PLAYWRIGHT pointing to an installed Playwright module.
// Uses canonical sources, isolated state, intercepted model calls and local fixtures.
const {chromium}=require(process.env.PENECHO_PLAYWRIGHT||"playwright"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),sharp=require("sharp");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-lasso-frame-")),
  output=path.resolve(process.env.PENECHO_VERIFY_OUTPUT||path.join(root,"docs/verification/lasso-current-frame-20261004"));
fs.mkdirSync(output,{recursive:true});
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const server=require("../server.js"),report={checks:[],scenarios:[],errors:[]};
let browser;
const watchdog=setTimeout(()=>{console.error("Lasso verification exceeded its total deadline");process.exit(1);},90000);
const widget=(id,x,y,html)=>({id,widgetType:"html_widget",pluginId:"general",x,y,w:400,h:300,contentW:400,contentH:300,title:"Current frame fixture",refreshSeconds:0,html});
const fixture=extra=>`<!doctype html><html><head><style>html,body{margin:0;height:100%}.panel{position:absolute;inset:0;background:#d01818}</style></head><body><div class="panel" id="visible-content"></div>${extra}</body></html>`;
(async()=>{try{
  await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:900}}),requests=[],held=[];
  page.on("pageerror",error=>report.errors.push(error.message));
  const inject="window.lassoFrameTest={state,smartSuggest,canvasDocumentsReady,loadCanvasSettings,markFeatureTourStepsSeen,FEATURE_TOUR_STEPS,markChangelogSeen,setCanvasMode,restoreWidgets,positionWidgets,render,captureSelection,syncSelectionSuggestions,requestWidgetSnapshot,renderExportCanvas,downloadWidgetImage};";
  const client=fs.readFileSync(path.join(root,"public/app.js"),"utf8");
  report.clientSha256=require("node:crypto").createHash("sha256").update(client).digest("hex");
  await page.route("**/app.js*",route=>route.fulfill({contentType:"application/javascript",body:client.replace(/\}\)\(\);\s*$/,inject+"})();")}));
  await page.route(/^https:\/\//,route=>route.request().url().includes("lasso-capture.invalid")?held.push(route):route.abort());
  await page.route("**/api/suggest**",route=>{
    if(route.request().method()!=="POST")return route.fulfill({json:{configured:true}});
    requests.push(route.request().postDataJSON());
    return route.fulfill({json:{ok:true,answers:{kind:{type:"choice",choice:"notes",confidence:.9,probabilities:{notes:1}},action:{type:"choice",choice:"explain",confidence:.9,probabilities:{explain:.9,none:.1}}}}});
  });
  await page.route("**/api/ai/command",route=>route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.lassoFrameTest);
  await page.evaluate(async()=>{const t=lassoFrameTest;await t.canvasDocumentsReady();await t.loadCanvasSettings();t.markFeatureTourStepsSeen(t.FEATURE_TOUR_STEPS);t.markChangelogSeen();document.querySelector("#tourSkip")?.click();document.querySelector("#changelogClose")?.click();document.querySelector("#canvasWelcome").hidden=true;t.state.auto=false;t.state.scale=1;t.state.panX=0;t.state.panY=0;t.smartSuggest.enabled=false;t.smartSuggest.available=true;t.setCanvasMode("select");});
  const reset=async widgets=>{await page.evaluate(widgets=>{const t=lassoFrameTest;t.smartSuggest.enabled=false;t.state.selection=null;t.syncSelectionSuggestions();t.restoreWidgets(widgets);t.positionWidgets();t.render();},widgets);requests.length=0;};
  const select=()=>page.evaluate(()=>{const t=lassoFrameTest;t.smartSuggest.enabled=true;t.smartSuggest.available=true;t.captureSelection([{x:90,y:90},{x:510,y:90},{x:90,y:410}]);t.syncSelectionSuggestions();});
  const waitForRequest=async()=>{const until=Date.now()+10000;while(!requests.length&&Date.now()<until)await page.waitForTimeout(50);assert.ok(requests.length,"lasso sends a complete current-frame image");};
  const decode=async(dataUrl,name)=>{const bytes=Buffer.from(dataUrl.split(",")[1],"base64");if(name)fs.writeFileSync(path.join(output,name),bytes);const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});return {info,at:(x,y)=>Array.from(data.subarray((Math.floor(y)*info.width+Math.floor(x))*info.channels,(Math.floor(y)*info.width+Math.floor(x))*info.channels+3))};};
  for(const [name,extra] of [["pending-image",'<img src="https://lasso-capture.invalid/held.png" style="display:none">'],["pending-script",'<script src="https://lasso-capture.invalid/held.js"></script>']]){
    await reset([widget("widget-1",100,100,fixture(extra))]);
    let frame;await page.waitForFunction(()=>lassoFrameTest.state.widgets[0]?.hostReady);
    for(let attempt=0;attempt<60&&!frame;attempt++){for(const candidate of page.frames())if(await candidate.locator("#visible-content").count().catch(()=>0)){frame=candidate;break;}if(!frame)await page.waitForTimeout(50);}
    assert.ok(frame);await frame.locator("#visible-content").waitFor({state:"visible"});
    assert.notEqual(await frame.evaluate(()=>document.readyState),"complete");
    const started=Date.now();await select();await waitForRequest();
    const elapsedMs=Date.now()-started,image=await decode(requests[0].image,`${name}.webp`),inside=image.at(image.info.width*.2,image.info.height*.2),outside=image.at(image.info.width*.85,image.info.height*.85);
    assert.ok(inside[0]>150&&inside[1]<90&&inside[2]<90,`visible red Widget is captured: ${inside}`);
    assert.ok(outside.every(value=>value>235),"outside the lasso remains white");
    const loaded=await page.evaluate(()=>lassoFrameTest.state.widgets[0].mcpDocumentLoaded===true);
    assert.equal(loaded,false,"classification completes while iframe load is still pending");
    report.scenarios.push({name,elapsedMs,loaded,inside,outside,requests:requests.length});
  }
  report.checks.push("Visible Widget pixels reach lasso classification while an image or parser-blocking script never finishes loading; polygon exclusion is preserved.");
  await reset([widget("widget-1",100,100,fixture(""))]);
  await page.waitForFunction(()=>lassoFrameTest.state.widgets[0]?.mcpDocumentLoaded);
  await page.evaluate(()=>lassoFrameTest.requestWidgetSnapshot(lassoFrameTest.state.widgets[0]));
  let frame;for(const candidate of page.frames())if(await candidate.locator("#visible-content").count().catch(()=>0)){frame=candidate;break;}assert.ok(frame);
  await frame.evaluate(()=>{document.querySelector("#visible-content").style.background="#1060d0";window.html2canvas=async()=>{throw Error("Injected renderer failure");};});
  await select();await page.waitForFunction(()=>lassoFrameTest.smartSuggest.status?.reason==="snapshot-unavailable");
  assert.equal(requests.length,0,"old red pixels cannot substitute for the current blue frame after capture fails");
  report.checks.push("A failed current-frame capture sends no old cached pixels and leaves local suggestions available.");
  await reset([widget("widget-1",100,100,fixture("")),widget("widget-2",2000,1300,fixture(""))]);
  await page.waitForFunction(()=>lassoFrameTest.state.widgets.every(widget=>widget.hostReady));
  const before=await page.evaluate(()=>({initialized:lassoFrameTest.state.widgets[1].initialized,active:lassoFrameTest.state.widgets[1].renderActive}));
  assert.equal(before.initialized,false,"off-screen export fixture starts uninitialised");
  const exported=await page.evaluate(async()=>{const canvas=await lassoFrameTest.renderExportCanvas();return canvas.toDataURL("image/png");});
  const exportImage=await decode(exported,"canvas-offscreen.png");
  const {data,info}=await sharp(Buffer.from(exported.split(",")[1],"base64")).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let nearRed=0,farRed=0;for(let y=0;y<info.height;y+=5)for(let x=0;x<info.width;x+=5){const i=(y*info.width+x)*info.channels;if(data[i]>150&&data[i+1]<90&&data[i+2]<90){if(x<info.width/2)nearRed++;else farRed++;}}
  assert.ok(nearRed>100&&farRed>100,"both visible and off-screen Widgets are included in Canvas export");
  const download=page.waitForEvent("download");await page.evaluate(()=>lassoFrameTest.downloadWidgetImage(lassoFrameTest.state.widgets[1]));
  const item=await download;await item.saveAs(path.join(output,"widget-offscreen.png"));
  const downloaded=await sharp(path.join(output,"widget-offscreen.png")).stats();assert.ok(downloaded.channels[0].mean>150&&downloaded.channels[1].mean<90);
  report.scenarios.push({name:"offscreen-exports",before,canvasSize:[exportImage.info.width,exportImage.info.height],nearRed,farRed});
  report.checks.push("Canvas export includes the previously uninitialised off-screen Widget, and its individual PNG download also contains its pixels.");
  assert.deepEqual(report.errors,[]);
  report.passed=true;console.log(JSON.stringify(report,null,2));
}catch(error){report.passed=false;report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{clearTimeout(watchdog);fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));await browser?.close();server.close();process.exit(process.exitCode||0);}})();
