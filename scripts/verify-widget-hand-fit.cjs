"use strict";
// Real input against canonical client files, with an isolated server and data.
// PENECHO_PLAYWRIGHT may point to an existing Playwright installation.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = path.resolve(__dirname, ".."), baseline = process.argv.includes("--baseline");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "widget-hand-fit-"));
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || temporary;
fs.mkdirSync(output, { recursive:true });
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary, "state"),
  PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), HOST:"127.0.0.1", PORT:"0",
  AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false",
});
const injection = `window.handFitTest={state,canvasDocumentsReady,loadCanvasSettings,restoreWidgets,render,
  setCanvasMode,setSpacePan,showHandObjectToolbar,hideHandObjectToolbar,enterWidgetInteraction,
  setWidgetInteraction,setWidgetPresentationZoom,setSmartSuggestEnabled,
  read(){const w=state.widgets[0],s=w.shell,f=w.frame;return {
    geometry:[w.x,w.y,w.w,w.h,w.contentW,w.contentH],camera:[state.scale,state.panX,state.panY],
    mode:state.mode,explicit:state.interactingWidgetId,interactive:canvasWidgetInteractive(w),inert:f.inert,
    maximized:!!w.maximized,autoFit:w.presentationAutoFit,zoom:w.presentationZoom,
    scale:w.presentationScrollMetrics?.scale,outside:w.presentationScrollMetrics?.outside,
    shell:s.getBoundingClientRect().toJSON(),frame:f.getBoundingClientRect().toJSON(),
    overflow:[s.scrollWidth-s.clientWidth,s.scrollHeight-s.clientHeight],
    sameFrame:!this.originalFrame||f===this.originalFrame,history:state.history.length,
  };}};`;
const client = fs.readFileSync(path.join(root, "public/app.js"), "utf8").replace(/\}\)\(\);\s*$/, injection + "})();");
const server = require("../server.js");
const report = { baseline, checks:[], samples:[], errors:[] };
let browser;
(async () => {
  try {
    await new Promise((resolve,reject) => {server.once("error",reject);server.listening ? resolve() : server.once("listening",resolve);});
    browser = await chromium.launch({ headless:true });
    const page = await browser.newPage({ viewport:{width:1200,height:900}, hasTouch:true });
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => report.errors.push(error.message));
    await page.route(/^https:\/\//, route => route.abort());
    await page.route("**/app.js*", route => route.fulfill({contentType:"application/javascript",body:client}));
    await page.goto(`http://127.0.0.1:${server.address().port}`, {waitUntil:"domcontentloaded"});
    // A first open redirects to a blank Canvas in My Canvases; work on the page it settles on.
    await page.waitForURL(url => url.searchParams.has("linesProject"), {timeout:8000}).catch(() => {});
    await page.waitForLoadState("domcontentloaded");
    for (let attempt=0;;attempt++) {
      try {
        await page.waitForFunction(() => window.handFitTest);
        await page.evaluate(async () => {
          const t=handFitTest;await t.canvasDocumentsReady();await t.loadCanvasSettings();
          document.querySelector("#tourSkip")?.click();document.querySelector("#changelogClose")?.click();
          t.state.auto=false;t.setSmartSuggestEnabled(false);
          localStorage.setItem("penecho.widgetInteractionPresentation","maximized");
        });
        break;
      } catch (error) {
        if (attempt>=4 || !/navigation|context was destroyed/i.test(error.message)) throw error;
        await page.waitForLoadState("domcontentloaded");
      }
    }
    const html = `<!doctype html><style>html,body{margin:0;height:100%;font:24px system-ui;background:#edf5ff}
      body{box-sizing:border-box;padding:28px}button,input{font:inherit;padding:12px}#drag{margin-top:24px;height:130px;background:#c6d9ef}
      footer{position:absolute;bottom:24px}</style><h1>Live Widget</h1><button id="action" onclick="this.textContent='Clicked'">Use control</button>
      <input aria-label="Saved input" value="Keep this"><div id="drag">Drag here to select widget content</div><footer>Bottom of page</footer>
      <script>window.instance=Math.random();</script>`;
    const makeWidget = (content=html, extra={}) => ({id:"hand-fit-widget",pluginId:"general",widgetType:"html_widget",
      title:"Live Widget",x:120,y:150,w:600,h:375,contentW:1200,contentH:750,refreshSeconds:0,html:content,...extra});
    const setup = async widget => {
      await page.evaluate(widget => {
        const t=handFitTest;t.setWidgetInteraction(null);t.hideHandObjectToolbar({all:true,animate:false});
        Object.assign(t.state,{scale:1,panX:0,panY:0});t.restoreWidgets([widget]);t.setCanvasMode("hand");t.render();
        document.querySelector("#canvasWelcome").hidden=true;t.originalFrame=t.state.widgets[0].frame;
      }, widget);
      await page.waitForFunction(() => handFitTest.state.widgets[0]?.hostReady && handFitTest.state.widgets[0]?.contentVersion>0);
      const host = await (await page.locator(".canvas-widget-frame").elementHandle()).contentFrame();
      await page.waitForFunction(() => handFitTest.state.widgets[0].initialized);
      const content = host.childFrames()[0];
      await content.waitForLoadState("domcontentloaded");
      return content;
    };
    const read = () => page.evaluate(() => handFitTest.read());
    const snapshot = async name => {report.samples.push({name,...await read()});await page.screenshot({path:path.join(output,`${name}.png`)});};
    const showToolbar = async () => {
      const r=(await read()).frame;
      await page.mouse.move(20,880);
      await page.mouse.move(r.x+50,r.y+50,{steps:4});
      // A very small scaled widget may not reach its hover header from here; the toolbar itself is what the checks need.
      const shown=await page.waitForSelector('.object-toolbar-surface',{state:"visible",timeout:2500}).catch(() => null);
      if(!shown){
        await page.evaluate(() => handFitTest.showHandObjectToolbar("widget",handFitTest.state.widgets[0]));
        await page.waitForSelector('.object-toolbar-surface', {state:"visible"});
      }
    };
    const open = async () => {
      await showToolbar();
      await page.locator('.object-chrome-button.interact').click();
      await page.waitForFunction(() => handFitTest.state.widgets[0].maximized);
      await page.waitForTimeout(250);
    };
    const assertFit = async label => {
      const r=await read();
      assert.ok(r.frame.x>=-.5 && r.frame.right<=r.shell.right+.5,`${label}: full width fits`);
      assert.ok(r.frame.y>=0 && r.frame.bottom<=r.shell.bottom+1,`${label}: full height fits`);
      assert.ok(r.overflow.every(n=>n<=1),`${label}: no outer scroll required: ${r.overflow}`);
      assert.equal(r.sameFrame,true);assert.equal(r.autoFit,true);
      report.checks.push(label);
    };
    let content=await setup(makeWidget());
    const before=await read(),button=await content.locator("#action").boundingBox();
    await page.mouse.click(button.x+button.width/2,button.y+button.height/2);
    await snapshot("hand-direct-input");
    if (baseline) {
      report.buttonText=await content.locator("#action").textContent();
      await page.evaluate(() => handFitTest.enterWidgetInteraction(handFitTest.state.widgets[0]));
      await page.waitForTimeout(300);await snapshot("maximized-baseline");
      return;
    }
    assert.equal(await content.locator("#action").textContent(),"Clicked","Hand directly reaches widget controls");
    await content.locator("input").fill("State survives presentation");
    const instance=await content.evaluate(() => window.instance),drag=await content.locator("#drag").boundingBox();
    await page.mouse.move(drag.x+40,drag.y+30);await page.mouse.down();
    await page.mouse.move(drag.x+130,drag.y+60,{steps:8});await page.mouse.up();
    assert.deepEqual((await read()).geometry,before.geometry,"body dragging never moves the widget");
    assert.deepEqual((await read()).camera,before.camera,"widget body input never pans the canvas");
    report.checks.push("Hand controls and body drag retain widget geometry and camera");
    // Hand never selects on a body press, so the edges stay grabbable by themselves.
    const resizeBy=async (pick,dx,dy)=>{
      const current=await read(),[x,y]=pick(current.frame);
      await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:6});await page.mouse.up();
      const after=await read();assert.equal(after.mode,"hand");return {before:current.geometry,after:after.geometry};
    };
    await page.evaluate(() => {const p=document.querySelector("#projectLinesPanel");if(p)p.style.display="none";});
    let step=await resizeBy(r=>[r.right-3,r.y+r.height/2],60,0);
    assert.ok(Math.abs(step.after[2]-step.before[2]-60)<5&&step.after[3]===step.before[3],"Hand resizes by the right edge "+JSON.stringify(step));
    step=await resizeBy(r=>[r.x+r.width/2,r.bottom-3],0,40);
    assert.ok(Math.abs(step.after[3]-step.before[3]-40)<5&&step.after[2]===step.before[2],"Hand resizes by the bottom edge");
    step=await resizeBy(r=>[r.right,r.bottom],-30,-20);
    assert.ok(step.after[2]<step.before[2]&&step.after[3]<step.before[3],"Hand resizes by the bottom-right corner");
    assert.deepEqual((await read()).camera,before.camera,"resizing never pans the canvas");
    await page.evaluate(() => {const p=document.querySelector("#projectLinesPanel");if(p)p.style.display="";});
    await page.evaluate(size=>{const t=handFitTest;Object.assign(t.state.widgets[0],size);t.render();},{w:before.geometry[2],h:before.geometry[3]});
    report.checks.push("Hand resizes the widget by its right edge, bottom edge and corner");
    await showToolbar();
    // The move control is the top-left grip, even when toolbar attributes change.
    const handle=await page.locator('.object-toolbar-surface').first().boundingBox();
    assert.ok(handle,"top-left grip is visible after entering the widget");
    await page.mouse.move(handle.x+9,handle.y+handle.height/2);await page.mouse.down();
    await page.mouse.move(handle.x+79,handle.y+handle.height/2+40,{steps:8});await page.mouse.up();
    const moved=await read();assert.equal(moved.mode,"hand");
    assert.ok(Math.abs(moved.geometry[0]-before.geometry[0]-70)<1 && Math.abs(moved.geometry[1]-before.geometry[1]-40)<1);
    report.checks.push("Top-left grip moves the widget without changing Hand");
    await open();await assertFit("Interact opens the whole page fitted below its toolbar");
    assert.deepEqual((await read()).geometry,moved.geometry);
    assert.equal(await content.locator("input").inputValue(),"State survives presentation");
    assert.equal(await content.evaluate(() => window.instance),instance);
    await snapshot("desktop-fit");
    await page.setViewportSize({width:1024,height:640});await page.waitForTimeout(250);await assertFit("Short tablet refits automatically");
    await page.setViewportSize({width:390,height:700});await page.waitForTimeout(250);await assertFit("Narrow touch viewport fits automatically");
    await snapshot("narrow-fit");
    await page.locator('.widget-presentation-toolbar button[aria-label="Zoom out"]').click();
    assert.equal((await read()).autoFit,false,"manual zoom takes ownership");
    await page.locator('.widget-presentation-toolbar button[aria-label="Exit interaction"]').click();
    assert.equal((await read()).maximized,false);assert.deepEqual((await read()).geometry,moved.geometry);
    await page.setViewportSize({width:1200,height:900});
    await page.evaluate(() => {handFitTest.setSpacePan(true);});
    assert.equal((await read()).inert,true);await page.evaluate(() => handFitTest.setSpacePan(false));
    assert.equal((await read()).inert,false);
    await page.evaluate(() => handFitTest.setCanvasMode("pen"));assert.equal((await read()).inert,true);
    await page.evaluate(() => handFitTest.setCanvasMode("select"));assert.equal((await read()).inert,true);
    await page.evaluate(() => handFitTest.setCanvasMode("hand"));assert.equal((await read()).inert,false);
    report.checks.push("Temporary pan, Pen and Lasso keep their input ownership");
    const tall=`<!doctype html><style>html,body{margin:0;height:100%}main{height:100%;background:#edf5ff;font:40px system-ui}</style><main>Full authored page</main>`;
    content=await setup(makeWidget(tall,{contentW:900,contentH:3000,w:225,h:750}));
    await open();await assertFit("Tall authored page fits below 40 percent");assert.ok((await read()).zoom<40);
    await snapshot("tall-document-fit");
    const fixture=process.argv.find(arg=>arg.startsWith("--fixture="))?.slice(10);
    if(fixture){
      const bundle=JSON.parse(fs.readFileSync(fixture,"utf8"));
      const asset=bundle.assets.find(a=>a.kind==="widget");assert.ok(asset);
      const widget=JSON.parse(Buffer.from(asset.dataBase64,"base64"));
      await setup({...widget,id:"hand-fit-widget",x:120,y:150,w:600,h:375});
      await open();await assertFit("Original Clock document fits completely");await snapshot("original-clock-fit");
    }
    assert.deepEqual(report.errors,[]);
  } catch(error) {report.failure=error.stack;process.exitCode=1;}
  finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify({output,...report},null,2));
    await browser?.close();await new Promise(resolve=>server.close(resolve));
    fs.rmSync(path.join(temporary,"state"),{recursive:true,force:true});
    if(output!==temporary)fs.rmSync(temporary,{recursive:true,force:true});
  }
})();
