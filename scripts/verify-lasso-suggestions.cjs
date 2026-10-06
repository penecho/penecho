"use strict";
// Isolated browser acceptance: capture model-bound payloads without contacting models.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict"), sharp = require("sharp");
const SMART = require("../public/smart-suggest.js"), JEVISION = require("../src/server/jevision.js");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lasso-suggestions-"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory,"state"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const server = require("../server.js");
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listening ? resolve() : server.once("listening",resolve));
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1440,height:900}}), errors = [], classifications = [], commands = [], heldTypesets = [], heldPlots = [], thinking = [];
    page.on("pageerror", error => { errors.push(error.message);console.error(error.stack); });
    const source = fs.readFileSync(path.resolve(__dirname,"../public/app.js"),"utf8")
      .replace(/\}\)\(\);\s*$/, "window.lassoTest={state,smartSuggest,stroke,save,setCanvasMode,captureSelection,cancelSelection,render,buildSelectionImage,setSmartSuggestEnabled,undo};})();");
    await page.route(/^https:\/\//, route => route.abort());
    await page.route("**/app.js*", route => route.fulfill({contentType:"application/javascript",body:source}));
    await page.route("**/api/suggest/status",route=>route.fulfill({json:{configured:true,model:"PenEchoLLM"}}));
    await page.route("**/api/suggest", route => {
      const body = route.request().postDataJSON(); classifications.push(body);
      return route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,model:"test",answers:JEVISION.mockAnswers(SMART.buildQuestions({selection:true}),"","plot")})});
    });
    await page.route("**/api/ai/command", route => {
      const body=route.request().postDataJSON();
      commands.push(body);
      if (body.userAction === "normalize") { heldTypesets.push(route);return; }
      if (body.suggestion === "plot") { heldPlots.push(route);return; }
      return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Isolated test: payload captured"})});
    });
    await page.addInitScript(() => { if (window.top === window) localStorage.setItem("penecho-language","en"); });
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => Boolean(window.lassoTest));
    await page.evaluate(() => {
      const t=lassoTest,s=t.state;
      s.auto=false;s.scale=1;s.panX=300;s.panY=120;
      t.smartSuggest.available=true;
      // No stroke log: this also covers ink loaded from an existing canvas.
      t.stroke({x:135,y:150},{x:175,y:170},false,8,true,"#111111");
      t.stroke({x:220,y:225},{x:250,y:225},false,8,true,"#ff0000");
      t.stroke({x:320,y:160},{x:360,y:160},false,8,true,"#0000ff");
      t.save();
      s.latestTypedInput={text:"OUTSIDE PRIVATE TEXT",box:{x:100,y:100,w:160,h:160}};
      t.smartSuggest.profile={diagram:1};t.smartSuggest.recent=["OUTSIDE RECENT ACTION"];
      t.setCanvasMode("select");
      t.captureSelection([{x:100,y:100},{x:260,y:100},{x:100,y:260},{x:100,y:100}]);
      t.render();
    });
    const bar = page.locator('#smartSuggestLayer > .assist-bar[data-mode="suggest"]');
    await bar.waitFor();
    await page.waitForFunction(() => document.querySelector('.assist-bar[data-source="penecho-llm"]'));
    assert.equal(classifications.length,1);
    assert.equal(classifications[0].mode,"selection");
    assert.equal(classifications[0].facts,undefined);
    assert.equal(classifications[0].questions,undefined);
    async function checkMasked(image, name) {
      const bytes=Buffer.from(image.split(",")[1],"base64");
      fs.writeFileSync(path.join(directory,`${name}.png`),bytes);
      const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
      let ink=0,red=0,blue=0;
      for(let i=0;i<data.length;i+=info.channels){const [r,g,b]=data.subarray(i,i+3);if(r<100&&g<100&&b<100)ink++;if(r>160&&g<100&&b<100)red++;if(b>160&&r<100&&g<100)blue++;}
      assert.ok(ink>40,`${name}: selected ink is present`);
      assert.equal(red,0,`${name}: ink inside the bounding box but outside the polygon is absent`);
      assert.equal(blue,0,`${name}: ink beyond the bounding box is absent`);
      return {width:info.width,height:info.height,ink,red,blue};
    }
    const jevision = await checkMasked(classifications[0].image,"jevision-input");
    const scopes = [];
    for (const [width,height] of [[1440,900],[760,900],[390,844]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(() => {lassoTest.state.panX=20;lassoTest.state.panY=120;lassoTest.render();});
      await page.waitForTimeout(250);
      const a=await bar.boundingBox();
      assert.ok(a);
      const inkBottom=await page.evaluate(()=>{const s=lassoTest.state,viewport=document.querySelector('#viewport').getBoundingClientRect();return viewport.top+(s.selection.box.y+s.selection.box.h)*s.scale+s.panY;});
      assert.ok(a.y-inkBottom>=31,`${width}: suggestions leave a touch-safe gap below the ink`);
      assert.equal(await page.locator("#selectionToolbar").isVisible(),false,`${width}: the upper toolbar stays hidden`);
      assert.ok(a.x>=0&&a.x+a.width<=width+1,`${width}: suggestions fit viewport`);
      const close=await bar.locator(".assist-close").boundingBox();
      assert.ok(close&&close.x+close.width<=width,`${width}: the last action stays reachable`);
      await bar.locator(".assist-more > button").click();
      assert.equal(await bar.locator('[data-selection-action="delete"]').count(),0,"a screenshot region has no content Delete action");
      const cancel=await bar.locator('[data-selection-action="cancel"]').boundingBox();
      assert.ok(cancel&&cancel.x>=0&&cancel.x+cancel.width<=width&&cancel.y>=0&&cancel.y+cancel.height<=height,`${width}: selection menu is reachable`);
      await bar.locator(".assist-more > button").click();
      scopes.push({width,bar:a});
      await page.screenshot({path:path.join(directory,`selection-${width}.png`)});
    }
    await page.evaluate(()=>{const s=lassoTest.state;s.panY=document.querySelector('#viewport').clientHeight-20-(s.selection.box.y+s.selection.box.h)*s.scale;lassoTest.render();});
    await page.waitForTimeout(250);
    const edge=await bar.boundingBox(),inkTop=await page.evaluate(()=>{const s=lassoTest.state;return document.querySelector('#viewport').getBoundingClientRect().top+s.selection.box.y*s.scale+s.panY;});
    assert.ok(inkTop-edge.y-edge.height>=31,'suggestions keep the same gap when they move above bottom-edge ink');
    await page.screenshot({path:path.join(directory,'selection-bottom-edge.png')});
    await page.evaluate(()=>{lassoTest.state.panY=120;lassoTest.render();});
    await page.setViewportSize({width:1440,height:900});
    async function checkThinking(name) {
      await page.waitForFunction(() => lassoTest.state.busy && !document.querySelector("#summonLayer").hidden && document.querySelector(".summon-copy"));
      await page.waitForTimeout(100);
      const geometry = await page.evaluate(() => {
        const s=lassoTest.state, viewport=document.querySelector("#viewport"), copy=document.querySelector(".summon-copy"),
          transform={scale:s.scale,panX:s.panX,panY:s.panY,width:viewport.clientWidth,height:viewport.clientHeight},
          layout=PENECHO_SUMMON.echoLayout(PENECHO_SUMMON.projectRegion(s.selection.box,transform),transform), style=getComputedStyle(copy);
        return {anchor:s.summonAnchor,selection:s.selection.box,fallback:layout.fallback,status:layout.status,caption:{x:parseFloat(style.left),y:parseFloat(style.top)}};
      });
      assert.deepEqual(geometry.anchor,geometry.selection,`${name}: loading surrounds this lasso`);
      assert.equal(geometry.fallback,false,`${name}: no centered fallback`);
      assert.ok(Math.abs(geometry.caption.x-geometry.status.x)<1 && Math.abs(geometry.caption.y-geometry.status.y)<1,`${name}: rendered caption follows the projected selection`);
      thinking.push({name,...geometry});
      await page.screenshot({path:path.join(directory,`${name}.png`)});
    }
    await page.evaluate(() => {lassoTest.state.dirty=null;lassoTest.state.lastUserBox=null;});
    await Promise.all([
      page.waitForRequest(request => request.url().endsWith("/api/ai/command")),
      bar.locator('[data-suggestion="plot"]').click(),
    ]);
    await checkThinking("plot-saved-ink");
    await page.evaluate(() => {const s=lassoTest.state;s.scale=1.6;s.panX=180;s.panY=100;lassoTest.render();});
    await checkThinking("plot-pan-zoom");
    assert.equal(heldPlots.length,1);
    await heldPlots.shift().fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Isolated test: payload captured"})});
    await page.waitForFunction(() => !lassoTest.state.activeAI && !lassoTest.state.selection?.aiRequest);
    assert.equal(commands.length,1);
    assert.equal(commands[0].suggestion,"plot");
    assert.deepEqual(commands[0].sourceRect,{x:100,y:100,w:160,h:160});
    assert.equal(commands[0].selectionContext.closed,true);
    assert.equal(commands[0].typedInput,undefined,"unrelated typed input is excluded even if its box overlaps");
    assert.deepEqual(commands[0].hotspotGrid.hotspots,[]);
    const llm=await checkMasked(commands[0].atlasImage,"llm-input");
    await bar.waitFor();
    await bar.getByRole("button",{name:"Ask",exact:true}).click();
    await bar.locator("input").fill("Explain only this selection");
    await bar.locator("input").press("Enter");
    await page.waitForFunction(() => !lassoTest.state.activeAI && !lassoTest.state.selection?.aiRequest);
    assert.equal(commands.length,2);
    assert.equal(commands[1].typedInput.text,"Explain only this selection");
    assert.deepEqual(commands[1].selectionContext,commands[0].selectionContext);
    await checkMasked(commands[1].atlasImage,"question-input");
    await page.waitForFunction(() => document.querySelector("#summonLayer").hidden);
    await bar.waitFor();
    await page.evaluate(() => {
      const s=lassoTest.state;s.scale=1;s.panX=20;s.panY=120;
      s.dirty={x:900,y:450,w:200,h:160};s.lastUserBox={...s.dirty};lassoTest.render();
    });
    await bar.locator('[data-suggestion="plot"]').click();
    await checkThinking("plot-unrelated-recent-ink");
    assert.equal(heldPlots.length,1);
    await page.locator('.assist-bar[data-mode="working"]').getByRole("button",{name:"Stop",exact:true}).click();
    await page.waitForFunction(() => !lassoTest.state.busy && !lassoTest.state.selection?.aiRequest && !lassoTest.state.summonAnchor && document.querySelector("#summonLayer").hidden);
    await heldPlots.shift().abort();
    // Only the lower bar owns progress, including a failed or stopped request.
    await page.evaluate(() => {
      window.typesetEchoShown=false;
      window.typesetEchoObserver=new MutationObserver(() => {
        if (!document.querySelector("#summonLayer").hidden) window.typesetEchoShown=true;
      });
      window.typesetEchoObserver.observe(document.querySelector("#summonLayer"),{attributes:true,attributeFilter:["hidden"]});
    });
    for (const entry of ["failure","stop"]) {
      // Reselect after each mocked failure to exercise the normal entry flow.
      await page.evaluate(() => {
        lassoTest.cancelSelection(true);
        lassoTest.captureSelection([{x:100,y:100},{x:260,y:100},{x:100,y:260},{x:100,y:100}]);
        lassoTest.state.panX=280;lassoTest.state.panY=130;lassoTest.render();
      });
      await bar.waitFor();
      await bar.locator('[data-suggestion="typeset"]').click();
      await page.waitForFunction(() => lassoTest.state.busy && lassoTest.state.selection?.aiRequest?.action === "normalize");
      await page.waitForTimeout(350);
      assert.equal(await page.locator("#summonLayer").evaluate(node => node.hidden && !node.dataset.effect),true,`${entry}: no Canvas thinking frame during Typeset`);
      assert.equal(await page.locator(".summon-copy").count(),0,`${entry}: no Understanding caption`);
      assert.equal(await page.locator("#selectionToolbar").isVisible(),false);
      assert.equal(await page.locator('.assist-bar[data-mode="working"] .assist-status').textContent(),"Typeset…");
      assert.equal(await page.locator('.assist-bar[data-mode="working"] .assist-close').getAttribute("aria-label"),"Cancel");
      assert.equal(commands.at(-1).userAction,"normalize");
      await checkMasked(commands.at(-1).atlasImage,`typeset-${entry}-input`);
      await page.screenshot({path:path.join(directory,`typeset-${entry}-pending.png`)});
      const route=heldTypesets.shift();assert.ok(route);
      if (entry === "failure") {
        await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Isolated test: payload captured"})});
        await page.waitForFunction(() => !lassoTest.state.busy && !lassoTest.state.selection?.aiRequest);
      } else {
        await page.locator('.assist-bar[data-mode="working"]').getByRole("button",{name:"Stop",exact:true}).click();
        await page.waitForFunction(() => !lassoTest.state.busy && !lassoTest.state.selection?.aiRequest);
        await route.abort();
      }
    }
    assert.equal(await page.evaluate(() => window.typesetEchoShown),false,"Typeset never flashes the global frame");
    await page.evaluate(() => window.typesetEchoObserver.disconnect());
    await bar.waitFor();
    await page.evaluate(() => lassoTest.setSmartSuggestEnabled(false));
    await bar.waitFor();
    assert.equal(await bar.locator('[data-suggestion="typeset"]').isVisible(),true,"manual selection controls survive disabling suggestions");
    const beforeDisabled=classifications.length;
    await page.waitForTimeout(600);
    assert.equal(classifications.length,beforeDisabled,"disabled suggestions do not call JeVision");
    await bar.locator(".assist-more > button").click();
    await bar.locator('[data-selection-action="cancel"]').click();
    assert.equal(await page.evaluate(() => lassoTest.state.selection),null);
    const restored=await page.evaluate(() => {
      const captured=lassoTest.captureSelection([{x:100,y:100},{x:260,y:100},{x:100,y:260},{x:100,y:100}]);
      return captured?lassoTest.buildSelectionImage(lassoTest.state.selection).atlasImage:null;
    });
    assert.ok(restored,"closing a screenshot region leaves the source ink available");
    await checkMasked(restored,"restored-selection");
    await bar.waitFor();
    await bar.locator(".assist-more > button").click();
    await bar.locator('[data-selection-action="cancel"]').click();
    assert.equal(await page.evaluate(() => lassoTest.state.selection),null);
    await bar.waitFor({state:"hidden"});
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify({jevision,llm,scopes,thinking,requests:commands.length,errors},null,2));
    console.log(JSON.stringify({directory,jevision,llm,thinking,requests:commands.length,errors}));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().then(() => process.exit(0),error=>{console.error(error);process.exit(1);});
