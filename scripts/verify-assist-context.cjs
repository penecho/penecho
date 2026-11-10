"use strict";
// Capture real browser payloads with isolated state and local mock responses.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), sharp = require("sharp");
const SMART = require("../public/smart-suggest.js"), JEVISION = require("../src/server/jevision.js");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-assist-context-"));
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory,"state"),
  PENECHO_CONFIG_FILE:path.join(directory,"config.env"), HOST:"127.0.0.1", PORT:"0",
  AI_PROVIDER:"api", AI_API_KEY:"test", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false",
});
const server = require("../server.js");
const inside = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w + .01 && inner.y + inner.h <= outer.y + outer.h + .01;
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1440,height:1100}}), errors = [], commands = [], classifications = [], refinements = [];
    let releaseRefine;
    page.on("pageerror", error => errors.push(error.message));
    const source = fs.readFileSync(path.resolve(__dirname,"../public/app.js"),"utf8").replace(/\}\)\(\);\s*$/, `
      window.assistTest={state,smartSuggest,stroke,save,render,executeAssistAction,assistAsk,smartSuggestDrawingFinished,
        runSmartSuggest,hideAssist,planViewportImage,buildViewportImage,prepareVisibleWidgetSnapshots,viewportRect,
        acceptPending,acceptPendingItem,rejectPendingItem,acceptPendingWidget,startPendingBatch,offscreen,
        settings,loadCanvasSettings,storeAiConnectionSelection,canvasDocumentsReady,showWidgetHeader,canvasViewportMetrics};
    })();`);
    await page.route(/^https:\/\//, route => route.abort());
    await page.route("**/app.js*", route => route.fulfill({contentType:"application/javascript",body:source}));
    await page.route("**/api/suggest", route => {
      classifications.push(route.request().postDataJSON());
      return route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,answers:JEVISION.mockAnswers(SMART.buildQuestions(),"","answer")})});
    });
    await page.route("**/api/ai/command", async route => {
      const body=route.request().postDataJSON();commands.push(body);
      if (body.widgetEdit) await new Promise(resolve => { releaseRefine=resolve; });
      const widget={tool:"html_widget",pluginId:"general",x:500,y:400,w:360,h:300,title:"Context test",refreshSeconds:0,
        html:'<!doctype html><html><body style="margin:0;background:white"><svg width="100%" height="100%" viewBox="0 0 360 300" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="340" height="130" fill="#e02020"/><rect x="10" y="220" width="340" height="70" fill="#2020e0"/></svg></body></html>'};
      return route.fulfill({contentType:"application/json",body:JSON.stringify({requestId:`context-${commands.length}`,commands:commands.length===1?[widget]:[]})});
    });
    await page.addInitScript(() => { if (window.top === window) localStorage.setItem("penecho-language","en"); });
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => Boolean(window.assistTest));
    await page.evaluate(async () => {
      const t=assistTest,s=t.state;
      await t.canvasDocumentsReady;await t.loadCanvasSettings();
      t.storeAiConnectionSelection(t.settings.connections[0].id);
      s.auto=false;s.scale=1;s.panX=0;s.panY=0;
      t.smartSuggest.available=false;
      t.stroke({x:100,y:100},{x:400,y:140},false,8,true,"#111111");t.save();
      s.dirty={x:96,y:96,w:308,h:48};s.lastUserBox={...s.dirty};
      t.executeAssistAction({id:"answer"},{box:{...s.dirty},newBox:{...s.dirty},strokes:[]});
    });
    await page.locator('.assist-bar[data-mode="result"]').waitFor();
    // Moving a draft after its bar appears must change the follow-up target.
    await page.evaluate(() => {Object.assign(assistTest.state.pendingWidget,{x:550,y:500});assistTest.render();});
    await page.locator('.assist-bar[data-mode="result"] [data-suggestion="explain"]').click();
    await page.waitForFunction(() => !assistTest.state.activeAI && !assistTest.state.busy);
    assert.equal(commands.length,2);
    const widgetBox={x:550,y:500,w:360,h:300};
    assert.ok(inside(commands[1].sourceRect,widgetBox),"the entire visible widget belongs to the screenshot");
    assert.ok(inside(commands[1].changedBox,widgetBox),"follow-up attention follows the accepted, moved widget");
    assert.equal(await page.evaluate(() => assistTest.state.dirty),null,"AI output does not become user dirty input");
    async function checkImage(image,name) {
      const bytes=Buffer.from(image.split(",")[1],"base64");fs.writeFileSync(path.join(directory,`${name}.png`),bytes);
      const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
      let red=0,blue=0;
      for(let i=0;i<data.length;i+=info.channels){const [r,g,b]=data.subarray(i,i+3);if(r>g+25&&r>b+25)red++;if(b>r+25&&b>g+25)blue++;}
      assert.ok(red>100&&blue>100,`${name}: both top and bottom of the widget are visible (${red}, ${blue})`);
      return {width:info.width,height:info.height,red,blue};
    }
    const followup=await checkImage(commands[1].atlasImage,"followup");
    // An explicit Ask survives viewport clipping of the original target.
    await page.evaluate(() => assistTest.assistAsk("Explain the blue part",{box:{x:550,y:500,w:360,h:900},strokes:[]}));
    await page.waitForFunction(() => !assistTest.state.activeAI && !assistTest.state.busy);
    assert.equal(commands.length,3);
    assert.equal(commands[2].typedInput.text,"Explain the blue part");
    assert.ok(inside(commands[2].sourceRect,commands[2].typedInput.box));
    // Classification stays close to new handwriting; execution keeps its own context.
    await page.evaluate(async () => {
      const t=assistTest,s=t.state;t.hideAssist("test");s.mode="pen";
      const a={x:930,y:610},b={x:1040,y:650},box={x:926,y:606,w:118,h:48};
      t.stroke(a,b,false,8,true,"#111111");t.save();s.dirty={...box};
      t.smartSuggest.available=true;
      t.smartSuggestDrawingFinished({samples:[{point:a,size:8},{point:b,size:8}],bbox:box,size:8});
      await t.runSmartSuggest();
      t.smartSuggest.available=false;clearTimeout(t.smartSuggest.timer);clearTimeout(t.smartSuggest.localTimer);
      t.executeAssistAction({id:"explain"},{box,newBox:box,strokes:[]});
    });
    await page.waitForFunction(() => !assistTest.state.activeAI && !assistTest.state.busy);
    assert.equal(classifications.length,1);
    const nearbyBytes=Buffer.from(classifications[0].image.split(",")[1],"base64");
    fs.writeFileSync(path.join(directory,"nearby-classifier.webp"),nearbyBytes);
    const nearby=await sharp(nearbyBytes).metadata();
    assert.ok(nearby.width<160&&nearby.height<100,"classifier does not import the adjacent widget");
    assert.equal(commands.length,4);
    assert.ok(inside(commands[3].sourceRect,widgetBox));
    assert.deepEqual(commands[3].changedBox,{x:926,y:606,w:118,h:48});
    await checkImage(commands[3].atlasImage,"nearby-request");
    // Exercise the actual header panel: explicit Ask, suggestion, and marks.
    for (const mode of ["ask","action","marks"]) {
      const dirty=mode==="action"?null:{x:926,y:606,w:118,h:48},count=commands.length;
      await page.evaluate(dirty => {
        const t=assistTest,s=t.state;t.hideAssist("test");s.mode="pen";s.dirty=dirty;
        s.lastUserBox={x:96,y:96,w:308,h:48};s.summonEnabled=true;
        t.showWidgetHeader(s.widgets[0]);t.render();
      },dirty);
      await page.locator('[data-object-chrome-key$=":tool-refine"]').click();
      await page.locator('.widget-refine-panel').waitFor();
      if(mode==="ask") {
        await page.locator('.widget-refine-panel-ask input').fill("Make the blue part lighter");
        await page.locator('.widget-refine-panel-ask button').click();
      } else if(mode==="action") {
        await page.locator('.widget-refine-panel-suggest').click();
        await page.locator('.widget-refine-panel-chip.kind-refine').first().click();
      }
      else await page.locator('.widget-refine-panel-marks').click();
      await page.waitForFunction(() => Boolean(assistTest.state.activeAI));
      await page.waitForFunction(() => document.querySelector('#summonLayer')?.dataset.effect==="spatial-echo");
      // The request stays in flight while the scan is inspected.
      const deadline=Date.now()+10000;
      while(commands.length===count&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25));
      assert.equal(commands.length,count+1);
      const payload=commands.at(-1),scan=await page.evaluate(() => {
        const {state:s,canvasViewportMetrics}=assistTest,transform={...canvasViewportMetrics(),scale:s.scale,panX:s.panX,panY:s.panY};
        return {anchor:s.summonAnchor,layout:PENECHO_SUMMON.echoLayout(PENECHO_SUMMON.projectRegion(s.summonAnchor,transform),transform)};
      });
      assert.ok(inside(payload.sourceRect,widgetBox),`${mode}: full widget in screenshot`);
      assert.ok(inside(scan.anchor,widgetBox)&&inside(scan.layout.outer,widgetBox),`${mode}: scan surrounds the full widget`);
      assert.deepEqual(payload.changedBox,dirty||widgetBox);
      assert.ok(payload.sourceRect.x>400&&payload.sourceRect.y>350,`${mode}: old distant ink is outside the crop`);
      assert.equal(payload.widgetEdit.html,await page.evaluate(()=>assistTest.state.widgets[0].html));
      assert.deepEqual(payload.widgetEdit.box,widgetBox);
      if(dirty) assert.ok(inside(payload.sourceRect,dirty)&&inside(scan.anchor,dirty));
      if(mode==="ask") assert.equal(payload.widgetEdit.instruction,"Make the blue part lighter");
      if(mode==="action") assert.ok(payload.widgetEdit.instruction&&payload.widgetEdit.actionId);
      if(mode==="marks") assert.equal(payload.widgetEdit.instructionMode,"viewport-dirty");
      await checkImage(payload.atlasImage,`refine-${mode}-request`);
      await page.waitForTimeout(650);
      await page.screenshot({path:path.join(directory,`refine-${mode}-scan.png`)});
      refinements.push({mode,sourceRect:payload.sourceRect,changedBox:payload.changedBox,scan});
      releaseRefine();releaseRefine=null;
      await page.waitForFunction(() => !assistTest.state.activeAI && !assistTest.state.busy);
    }
    // A canvas containing only widgets must still have a capture plan.
    const onlyWidget=await page.evaluate(() => {
      const t=assistTest;t.state.panY=-400;t.state.panX=-500;
      return t.planViewportImage({x:550,y:500,w:360,h:300});
    });
    assert.ok(onlyWidget&&inside(onlyWidget.sourceRect,widgetBox));
    await page.screenshot({path:path.join(directory,"canvas.png")});
    assert.deepEqual(errors,[]);
    const report={directory,requests:commands.length,classifications:classifications.length,followup,nearby,refinements,errors};
    fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {
    await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
})().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
