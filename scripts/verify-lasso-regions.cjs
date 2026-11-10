"use strict";
// Isolated acceptance: real pointer input and Widget snapshots, intercepted model transport.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), sharp = require("sharp");
const SMART = require("../public/smart-suggest.js"), JEVISION = require("../src/server/jevision.js");
const root = path.resolve(__dirname, ".."), directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lasso-regions-"));
const output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/lasso-regions-20260930"));
fs.mkdirSync(output, { recursive:true });
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory,"state"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const server = require("../server.js"), report = { checks:[], pixels:{}, errors:[] };
(async () => {
  let browser, page;
  try {
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    browser = await chromium.launch({headless:true});
    page = await browser.newPage({viewport:{width:1440,height:900}});
    page.on("pageerror", error => report.errors.push(error.message));
    const classifications = [], commands = [], injected = `
      window.lassoRegions={state,tiles,settings,smartSuggest,canvasAgent,canvasDocumentsReady,loadCanvasSettings,storeAiConnectionSelection,restoreWidgets,render,captureSelection,captureInkSelection,cancelSelection,commitSelection,deleteSelection,setCanvasMode,stroke,save,undo,buildSelectionImage,prepareVisibleWidgetSnapshots,executeAssistAction,assistAgentRun,assistAsk,calls:[]};
      canvasAgentSubmitMessage=async options=>{lassoRegions.calls.push(options);return true;};
      canvasAgentConnect=async()=>{};canvasAgentStartNewConversation=async()=>{};
    `;
    const source = fs.readFileSync(path.join(root,"public/app.js"),"utf8").replace(/\}\)\(\);\s*$/, injected + "})();");
    await page.route(/^https:\/\//, route => route.abort());
    await page.route("**/app.js*", route => route.fulfill({contentType:"application/javascript",body:source}));
    await page.route("**/api/suggest/status", route => route.fulfill({json:{configured:true,model:"PenEchoLLM"}}));
    await page.route("**/api/suggest", route => {
      const body=route.request().postDataJSON();classifications.push(body);
      return route.fulfill({json:{ok:true,answers:body.mode === "route" ? {execution:{type:"choice",choice:"canvas_ai"}} : JEVISION.mockAnswers(SMART.buildQuestions({selection:true}),"","explain")}});
    });
    await page.route("**/api/ai/command", route => {
      commands.push(route.request().postDataJSON());
      return route.fulfill({status:503,json:{error:"Isolated acceptance: model payload captured"}});
    });
    await page.addInitScript(() => {if (top===window) localStorage.setItem("penecho-language","en");});
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => Boolean(window.lassoRegions));
    const widget={id:"region-widget",pluginId:"general",widgetType:"html_widget",x:100,y:100,w:300,h:240,contentW:300,contentH:240,title:"Partial Widget capture",refreshSeconds:0,
      html:'<!doctype html><html><body style="margin:0;width:300px;height:240px;background:white"><div id="inside" style="position:absolute;left:20px;top:20px;width:30px;height:30px;background:#00a000"></div><div style="position:absolute;left:110px;top:110px;width:30px;height:30px;background:#ff0000"></div><div style="position:absolute;left:210px;top:20px;width:30px;height:30px;background:#0000ff"></div></body></html>'};
    await page.evaluate(async widget => {
      const t=lassoRegions;await t.canvasDocumentsReady;await t.loadCanvasSettings();t.storeAiConnectionSelection(t.settings.connections[0].id);
      t.state.auto=false;t.smartSuggest.available=true;t.state.scale=1;t.state.panX=120;t.state.panY=80;
      document.querySelector("#tourSkip")?.click();document.querySelector("#changelogClose")?.click();
      t.restoreWidgets([widget]);t.render();t.setCanvasMode("select");
    },widget);
    await page.waitForFunction(() => lassoRegions.state.widgets[0]?.hostReady);
    const contentState = () => page.evaluate(() => {
      const s=lassoRegions.state,w=s.widgets[0];
      return {revision:s.userRevision,history:s.history.length,source:w.html,geometry:{x:w.x,y:w.y,w:w.w,h:w.h}};
    });
    const before = await contentState();
    const point = (x,y) => page.evaluate(({x,y}) => {const s=lassoRegions.state,r=document.querySelector("#screen").getBoundingClientRect();return {x:r.x+s.panX+x*s.scale,y:r.y+s.panY+y*s.scale};},{x,y});
    const start=await point(110,110);await page.mouse.move(start.x,start.y);await page.mouse.down();
    for (const [x,y] of [[250,110],[110,250],[110,110]]) {const p=await point(x,y);await page.mouse.move(p.x,p.y,{steps:8});}
    await page.mouse.up();
    await page.waitForFunction(() => lassoRegions.state.selection?.phase === "active");
    assert.equal(await page.evaluate(() => lassoRegions.state.selection.regionOnly),true);
    assert.equal(await page.evaluate(() => lassoRegions.state.selection.fragments.length),0);
    assert.equal(await page.evaluate(() => lassoRegions.smartSuggest.strokes.length),0);
    await page.waitForFunction(() => document.querySelector('.assist-bar[data-source="penecho-llm"]'));
    const classified=classifications.find(body=>body.mode==="selection");assert.ok(classified);
    const bar=page.locator('#smartSuggestLayer > .assist-bar[data-mode="suggest"]');
    await bar.locator(".assist-more > button").click();
    assert.equal(await bar.locator('[data-selection-action="delete"]').count(),0);
    await bar.locator(".assist-more > button").click();
    async function inspect(image,name,color) {
      const bytes=Buffer.from(image.split(",")[1],"base64");
      fs.writeFileSync(path.join(output,`${name}.png`),bytes);
      const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
      const counts={green:0,purple:0,red:0,blue:0};
      for(let i=0;i<data.length;i+=info.channels){const [r,g,b]=data.subarray(i,i+3);if(g>110&&r<70&&b<70)counts.green++;if(r>90&&b>90&&g<70)counts.purple++;if(r>180&&g<70&&b<70)counts.red++;if(b>180&&r<70&&g<70)counts.blue++;}
      assert.ok(counts[color]>400,`${name}: enclosed live Widget pixels are present`);
      assert.equal(counts.red,0,`${name}: content inside the bounds but outside the polygon is masked`);
      assert.equal(counts.blue,0,`${name}: content outside the bounds is excluded`);
      const at=(x,y)=>Array.from(data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3));
      assert.deepEqual(at(info.width-15,info.height-15),[255,255,255],`${name}: the polygon exterior is blank`);
      report.pixels[name]={width:info.width,height:info.height,...counts};
    }
    await inspect(classified.image,"penecho-llm-widget-only","green");
    assert.deepEqual(await contentState(),before);
    const z=await page.evaluate(()=>Object.fromEntries(["interactionLayer","widgetLayer","inkLayer","textContentLayer","placedContentLayer","objectChromeLayer"].map(id=>[id,Number(getComputedStyle(document.getElementById(id)).zIndex)])));
    assert.ok(z.interactionLayer>Math.max(z.widgetLayer,z.inkLayer,z.textContentLayer,z.placedContentLayer,z.objectChromeLayer));
    report.layers=z;
    await page.screenshot({path:path.join(output,"widget-only-lasso.png")});
    report.checks.push("Pointer lasso over a Widget without strokes remains active, renders above content and sends only enclosed pixels to PenEchoLLM");
    let widgetFrame;
    for (const frame of page.frames()) if(await frame.locator("#inside").count()) {widgetFrame=frame;break;}
    assert.ok(widgetFrame);await widgetFrame.evaluate(()=>document.querySelector("#inside").style.background="#800080");
    await page.evaluate(async()=>{const t=lassoRegions,s=t.state;await t.executeAssistAction({id:"explain"},{box:s.selection.box,selection:s.selection,selectionKey:`selection:${t.smartSuggest.selectionVersion}`,strokes:[]});});
    await page.waitForFunction(() => !lassoRegions.state.busy && !lassoRegions.state.selection?.aiRequest);
    assert.equal(commands.length,1);
    await inspect(commands[0].atlasImage,"canvas-ai-fresh-widget","purple");
    assert.deepEqual(commands[0].sourceRect,{x:110,y:110,w:140,h:140});
    assert.equal(commands[0].selectionContext.closed,true);assert.equal(commands[0].typedInput,undefined);
    assert.deepEqual(await contentState(),before);
    report.checks.push("Canvas AI refreshes the live Widget snapshot and excludes out-of-lasso pixels without changing content or history");
    await page.evaluate(async()=>{const t=lassoRegions,s=t.state;await t.assistAsk("Explain this part only",{box:s.selection.box,selection:s.selection,selectionKey:`selection:${t.smartSuggest.selectionVersion}`,strokes:[]});});
    await page.waitForFunction(() => !lassoRegions.state.busy && !lassoRegions.state.selection?.aiRequest);
    await inspect(classifications.find(body=>body.mode==="route").image,"ask-routing-mask","purple");
    await inspect(commands[1].atlasImage,"ask-model-mask","purple");
    const result=await page.evaluate(async()=>{const t=lassoRegions,s=t.state;return t.assistAgentRun("animate",{box:s.selection.box,selection:s.selection,selectionKey:`selection:${t.smartSuggest.selectionVersion}`,strokes:[]});});
    assert.equal(result,"submitted");
    const agent=await page.evaluate(()=>lassoRegions.calls[0]);
    await inspect(`data:${agent.imageOverrides[0].mediaType};base64,${agent.imageOverrides[0].data}`,"agent-widget-mask","purple");
    assert.equal(agent.omitInitialCapture,true);assert.deepEqual(agent.referencesOverride.objectIds,[]);
    report.checks.push("Ask routing, Ask model payload and Agent handoff all use the masked Widget portion");
    await page.evaluate(()=>{lassoRegions.cancelSelection(true);lassoRegions.stroke({x:128,y:160},{x:150,y:160},false,6,true,"#111111");lassoRegions.save();});
    const inkBefore=await page.evaluate(()=>({history:lassoRegions.state.history.length,revision:lassoRegions.state.userRevision}));
    await page.evaluate(()=>{lassoRegions.captureSelection([{x:110,y:110},{x:250,y:110},{x:110,y:250},{x:110,y:110}]);});
    const a=await point(142,152),b=await point(162,167);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();
    const moved=await page.evaluate(()=>({...lassoRegions.state.selection.box}));assert.equal(moved.x,130);assert.equal(moved.y,125);
    const corner=await point(270,265);await page.mouse.move(corner.x,corner.y);await page.mouse.down();await page.mouse.move(corner.x+20,corner.y+20,{steps:8});await page.mouse.up();
    const resized=await page.evaluate(()=>({...lassoRegions.state.selection.box}));assert.ok(resized.w>moved.w&&resized.h>moved.h);
    await page.evaluate(()=>lassoRegions.commitSelection());
    const inkAfter=await page.evaluate(()=>({history:lassoRegions.state.history.length,revision:lassoRegions.state.userRevision}));
    assert.equal(inkAfter.history,inkBefore.history+1);assert.ok(inkAfter.revision>inkBefore.revision);
    await page.evaluate(()=>lassoRegions.captureSelection([{x:110,y:140},{x:170,y:140},{x:170,y:180},{x:110,y:180}]));
    const sourceAlpha=await page.evaluate(()=>lassoRegions.tiles.get("0,0")?.getContext("2d").getImageData(136,160,1,1).data[3]||0);
    assert.equal(sourceAlpha,0,"moving and resizing the selection removes the original stroke from its source");
    await page.evaluate(()=>{lassoRegions.deleteSelection();lassoRegions.captureSelection([{x:800,y:400},{x:900,y:400},{x:900,y:500},{x:800,y:500}]);});
    assert.equal(await page.evaluate(()=>lassoRegions.state.selection?.phase),"active","blank regions are valid");
    await page.evaluate(()=>lassoRegions.cancelSelection());
    assert.deepEqual(await page.evaluate(()=>({history:lassoRegions.state.history.length,revision:lassoRegions.state.userRevision})),inkAfter);
    await page.evaluate(()=>lassoRegions.undo());
    report.checks.push("Moving and resizing the lasso transforms enclosed ink in one undoable edit; Widget state stays intact and blank regions remain valid");
    const internal=await page.evaluate(()=>{
      const t=lassoRegions,points=[{x:110,y:140},{x:170,y:140},{x:170,y:180},{x:110,y:180}];
      const before=t.state.history.length;
      assertInternal(t.captureInkSelection(points));
      const lifted={regionOnly:!!t.state.selection.regionOnly,fragments:t.state.selection.fragments.length,image:t.buildSelectionImage(t.state.selection).atlasImage};
      t.cancelSelection(true);assertInternal(t.captureInkSelection(points));t.deleteSelection();
      const removed=t.state.history.length;t.undo();
      assertInternal(t.captureSelection(points));const restored=t.buildSelectionImage(t.state.selection).atlasImage;t.cancelSelection(true);
      return {before,removed,lifted,restored};
      function assertInternal(value){if(!value)throw Error("Internal ink edit could not capture ink");}
    });
    assert.equal(internal.lifted.regionOnly,false);assert.ok(internal.lifted.fragments>0);assert.equal(internal.removed,internal.before+1);
    for(const [name,image] of [["internal-ink-input",internal.lifted.image],["internal-ink-undo",internal.restored]]){
      const {data,info}=await sharp(Buffer.from(image.split(",")[1],"base64")).removeAlpha().raw().toBuffer({resolveWithObject:true});
      let dark=0;for(let i=0;i<data.length;i+=info.channels)if(data[i]<70&&data[i+1]<70&&data[i+2]<70)dark++;
      assert.ok(dark>60,name);
    }
    report.checks.push("Internal Typeset/scratch-out ink extraction remains separate from Lasso and keeps cancellation and deletion Undo working");
    assert.deepEqual(report.errors,[]);report.requests={classifications:classifications.length,canvasAI:commands.length,agent:1};
    console.log(JSON.stringify({output,...report},null,2));
  } catch(error) {
    report.failure=error.stack;
    if(page)await page.screenshot({path:path.join(output,"failure.png")}).catch(()=>{});
    throw error;
  } finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
})().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
