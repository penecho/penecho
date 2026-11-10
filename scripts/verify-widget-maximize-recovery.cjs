"use strict";
// Exercise presentation transitions with isolated Canvas data and real browser
// input. The optional failure mode reproduces an interrupted top-layer entry.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), cloud = process.argv.includes("--cloud"), failure = process.argv.includes("--failure");
const clientRoot = cloud ? path.resolve(root, "../penecho_cloud/public/canvas") : path.join(root, "public");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "widget-maximize-recovery-"));
const output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9)
  || path.join(root, "docs/verification/widget-maximize-recovery-20261006", cloud ? "cloud" : "local"));
fs.mkdirSync(output, { recursive:true });
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"),
  PENECHO_CLOUD_STATE_DIR:path.join(temporary, "cloud"), PENECHO_CONFIG_FILE:path.join(temporary, "config.env"),
  HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1",
  AI_API_MODEL:"test", PENECHO_JEVISION_ENABLED:"false", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false",
});
const injection = `
  markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);markChangelogSeen();
  if (${cloud}) Object.assign(window.PENECHO_CONFIG, {runtime:'cloud',connectionAccountId:'test-only'});
  window.maximizeTest = {state,restoreWidgets,canvasDocumentsReady,loadCanvasSettings,render,setCanvasMode,
    setWidgetInteraction,enterWidgetInteraction,setWidgetMaximized,switchWidgetPresentation,setSmartSuggestEnabled,
    read(){const w=state.widgets.find(w=>w.id==='widget-1000'),s=w.shell,f=w.frame,c=getComputedStyle(s);
      return {interacting:state.interactingWidgetId,maximized:w.maximized===true,popover:s.matches(':popover-open'),
        className:s.className,popoverAttribute:s.getAttribute('popover'),frameInert:f.inert,
        frameSame:f===maximizeTest.originalFrame,contentVersion:w.contentVersion,hostReady:w.hostReady,
        frameReloads:maximizeTest.frameReloads||0,rect:s.getBoundingClientRect().toJSON(),
        frameRect:f.getBoundingClientRect().toJSON(),display:c.display,visibility:c.visibility,
        mode:state.mode,geometry:{x:w.x,y:w.y,w:w.w,h:w.h},
        properties:['--widget-page-scale','--widget-presentation-frame-height','--widget-presentation-frame-top'].map(k=>w.styleRule.style.getPropertyValue(k))};}
  };
`;
const client = fs.readFileSync(path.join(clientRoot, "app.js"), "utf8");
const app = client.replace(/\}\)\(\);\s*$/, injection + "})();");
const server = require("../server.js");
(async () => {
  let browser,page;
  const report = {runtime:cloud ? "cloud-mirror" : "local",clientSha256:crypto.createHash('sha256').update(client).digest('hex'),failureInjected:failure,checks:[],errors:[]};
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listening?resolve():server.once('listening',resolve);});
    browser = await chromium.launch({headless:true});
    page = await browser.newPage({viewport:{width:1200,height:900}});
    page.setDefaultTimeout(10000);
    await page.addInitScript(()=>{window.widgetAcceptanceState=null;addEventListener('message',event=>{if(event.data?.type==='penecho-widget-state')window.widgetAcceptanceState=event.data;});});
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.route(/^https:\/\//,route=>route.abort());
    if(cloud)await page.route('**/*',route=>{
      const url=new URL(route.request().url()),file=path.join(clientRoot,url.pathname.replace(/^\/canvas\//,'/'));
      if(url.origin.startsWith('http://127.0.0.1:')&&url.pathname!=='/'&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});
      return route.fallback();
    });
    await page.route('**/app.js*',route=>route.fulfill({contentType:'application/javascript',body:app}));
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.maximizeTest);
    await page.evaluate(async()=>{
      const t=maximizeTest,s=t.state;await t.canvasDocumentsReady();await t.loadCanvasSettings();
      document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
      s.auto=false;t.setSmartSuggestEnabled(false);Object.assign(s,{scale:.5,panX:0,panY:0,language:'en'});
      const html='<!doctype html><style>html,body{margin:0;height:100%;background:#e9f8ee;font:24px system-ui}body{padding:24px;box-sizing:border-box}h2{font-size:36px}button{padding:16px}</style><h2>DNA Widget</h2><p>Presentation must preserve this live document.</p><button onclick="this.textContent=\'Clicked\'">Live control</button><script>window.documentInstance=Math.random();<\/script>';
      t.restoreWidgets([0,1].map(i=>({id:`widget-${1000+i}`,pluginId:'general',widgetType:'html_widget',x:160+i*700,y:240,w:400,h:560,contentW:400,contentH:560,title:i?'Second Widget':'DNA Widget',refreshSeconds:0,html})));
      t.setCanvasMode('hand');t.render();document.querySelector('#canvasWelcome').hidden=true;
      const w=s.widgets[0];t.targetWidget=w;t.originalFrame=w.frame;t.frameReloads=0;w.frame.addEventListener('load',()=>t.frameReloads++);
      localStorage.setItem('penecho.widgetInteractionPresentation','maximized');
    });
    await page.waitForFunction(()=>maximizeTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0));
    const initial=await page.evaluate(()=>maximizeTest.read()),geometry=initial.geometry;
    const hostFrame=await (await page.locator('[data-widget-id="widget-1000"] iframe').elementHandle()).contentFrame();
    const documentFrame=hostFrame.childFrames()[0];
    const documentInstance=await documentFrame.evaluate(()=>window.documentInstance);
    const shell=page.locator('[data-widget-id="widget-1000"]');
    const doubleClick=async()=>{const r=await shell.boundingBox();await page.mouse.dblclick(r.x+r.width*.4,r.y+r.height*.4);};
    const capture=async(name)=>{await page.screenshot({path:path.join(output,`${name}.png`)});report.checks.push({name,...await page.evaluate(()=>maximizeTest.read())});};
    const assertCanvas=async()=>{
      const r=await page.evaluate(()=>maximizeTest.read());
      assert.equal(r.maximized,false);assert.equal(r.popover,false);assert.equal(r.popoverAttribute,null);
      assert.equal(r.frameSame,true);assert.deepEqual(r.geometry,geometry);assert.deepEqual(r.properties,['','','']);
      assert.equal(r.display,'block');assert.ok(r.frameRect.width>0&&r.frameRect.height>0);
    };
    const assertMaximized=async()=>{
      await page.waitForFunction(()=>maximizeTest.read().popover);
      const r=await page.evaluate(()=>maximizeTest.read());
      assert.equal(r.maximized,true);assert.equal(r.interacting,'widget-1000');assert.equal(r.frameInert,false);
      assert.equal(r.frameSame,true);assert.deepEqual(r.geometry,geometry);assert.ok(r.frameRect.width>500);
      assert.equal(await shell.locator('.widget-presentation-scroll-extent').count(),1);
    };
    await capture('initial');
    if(failure){
      await page.evaluate(()=>{maximizeTest.targetWidget.shell.showPopover=()=>{throw new DOMException('Interrupted presentation','InvalidStateError');};});
      await doubleClick();
      await capture('interrupted-entry');
      // The Widget must remain usable inline; a second attempt can maximize it.
      await assertCanvas();
      await page.evaluate(()=>{delete maximizeTest.targetWidget.shell.showPopover;});
      await page.evaluate(()=>maximizeTest.switchWidgetPresentation(maximizeTest.targetWidget,true));
      await assertMaximized();await capture('recovered-entry');
    }else{
      await doubleClick();await capture('after-double-click');await assertMaximized();await capture('maximized');
    }
    await shell.locator('.widget-presentation-toolbar button[aria-label="Interact on canvas"]').click();
    await assertCanvas();await capture('returned-to-canvas');
    for(let i=0;i<12;i++){
      await page.evaluate(()=>{maximizeTest.setWidgetInteraction(null);localStorage.setItem('penecho.widgetInteractionPresentation','maximized');});
      await doubleClick();await assertMaximized();
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!maximizeTest.state.interactingWidgetId);await assertCanvas();
    }
    await capture('repeated-exit');
    await page.evaluate(()=>{maximizeTest.enterWidgetInteraction(maximizeTest.targetWidget);maximizeTest.targetWidget.shell.hidePopover();});
    await page.waitForFunction(()=>!maximizeTest.read().maximized);await assertCanvas();await capture('native-dismissed');
    await page.evaluate(()=>{const t=maximizeTest,w=t.targetWidget;t.setWidgetMaximized(w,true);t.setWidgetMaximized(w,false);t.setWidgetMaximized(w,true);});
    await assertMaximized();await capture('rapid-reopened');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!maximizeTest.state.interactingWidgetId);await assertCanvas();
    await page.evaluate(()=>{const t=maximizeTest,w=t.targetWidget;t.enterWidgetInteraction(w);w.shell.hidePopover();t.enterWidgetInteraction(w);});
    await assertMaximized();await capture('reopened-before-toggle');
    await hostFrame.waitForFunction(()=>window.widgetAcceptanceState?.interactive);
    await page.evaluate(()=>maximizeTest.targetWidget.frame.focus());
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!maximizeTest.state.interactingWidgetId);await assertCanvas();
    await page.evaluate(()=>{localStorage.setItem('penecho.widgetInteractionPresentation','canvas');maximizeTest.enterWidgetInteraction(maximizeTest.targetWidget);});
    await hostFrame.waitForFunction(()=>window.widgetAcceptanceState?.interactive&&!window.widgetAcceptanceState.maximized);
    await documentFrame.locator('button').click();
    assert.equal(await documentFrame.locator('button').textContent(),'Clicked','authored controls remain live after recovery');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!maximizeTest.state.interactingWidgetId);await assertCanvas();await capture('live-control-and-exit');
    assert.equal(await documentFrame.evaluate(()=>window.documentInstance),documentInstance,'authored document is not reloaded');
    assert.equal((await page.evaluate(()=>maximizeTest.read())).frameReloads,initial.frameReloads,'host iframe is not reloaded');
    assert.deepEqual(report.errors,[]);report.ok=true;
  }catch(error){report.ok=false;report.failure=error.stack;process.exitCode=1;
    if(page)try{report.failedState=await page.evaluate(()=>maximizeTest.read());await page.screenshot({path:path.join(output,'failed.png')});}catch{}
  }
  finally{
    await browser?.close();await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temporary,{recursive:true,force:true});
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({ok:report.ok,runtime:report.runtime,checks:report.checks.map(c=>c.name),errors:report.errors,failure:report.failure,output}));
  }
})();
