"use strict";
// Real Chromium layout, iframe presentation and Undo checks with isolated data.
// Run: tools/electron/node_modules/.bin/electron scripts/graph-widget-smoke.cjs
const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream");
const SMART = require("../public/smart-suggest.js");
const root = path.resolve(__dirname, ".."), directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-graph-")), baseline = process.argv.includes("--baseline"), legacy = process.argv.includes("--legacy"), canvasZoom = process.argv.includes("--canvas-zoom"), savedV2 = process.argv.includes("--saved-v2");
app.setPath("userData", path.join(directory, "profile"));
app.commandLine.appendSwitch("force-device-scale-factor", "2");
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory, "state"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" });
const readStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    const code = fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, "window.graphTest={state,startPendingWidget,acceptPendingWidget,setCanvasMode,render,setWidgetMaximized,enterWidgetInteraction,setWidgetInteraction,setWidgetPresentationZoom,undo,redo,startPending,textImage,acceptPending,serializedWidgets,restoreWidgets,requestWidgetSnapshot};})();");
    return Readable.from([code]);
  }
  return readStream.call(this, file, ...args);
};
const report = { directory, baseline, legacy, canvasZoom, savedV2, checks:[], samples:[], errors:[] };
const phase = label => { report.phase=label; console.log(label); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await pause(100); }
  throw Error(`Timed out: ${label}`);
}
let server, win;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({ show:false, width:1240, height:980, webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    phase("Loading isolated Canvas");
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    phase("Canvas loaded");
    await until(() => js("!!window.graphTest"), "application startup");
    await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();graphTest.state.auto=false;graphTest.setCanvasMode('pen');graphTest.state.scale=1;graphTest.state.panX=0;graphTest.state.panY=0;");
    const command = SMART.graphWidgetCommand({ expression:"x^2-2*x+8" }, { language:"en" });
    Object.assign(command, { x:70, y:160, w:1000, h:650, contentW:1000, contentH:650 });
    if (legacy || baseline) command.html=fs.readFileSync(path.join(root,"test/fixtures/graph-legacy.html"),"utf8");
    if (savedV2) {
      const html=fs.readFileSync(path.join(root,"test/fixtures/graph-v2-before-interactions.html"),"utf8");
      // Keep the saved runtime, but use the parabola required by layout checks.
      command.html=SMART.updateGraphDocument(html,{...SMART.graphDocumentData(html).data,expressions:["y = x^2-2*x+8"],window2:null}).html;
    }
    if (baseline) {
      await js("void(window.PENECHO_SMART_SUGGEST={...window.PENECHO_SMART_SUGGEST,upgradeGraphWidgetHtml:html=>html})");
      // Bound the known runaway allocation so the pre-fix evidence is safe.
      command.html=command.html.replace('new ResizeObserver(resize).observe(cv);','let passes=0;new ResizeObserver(()=>{if(++passes<=3)resize()}).observe(cv);');
    }
    if(legacy)command.html=SMART.upgradeGraphWidgetHtml(command.html);
    // Expose runtime state for numeric view checks without changing its layout.
    command.html = command.html.replace('const $ = id =>', 'window.graphView = () => JSON.parse(JSON.stringify(state, (key, value) => ["label", "fn", "r", "out"].includes(key) ? undefined : value)); const $ = id =>');
    phase("Inserting graph");
    await js(`window.insertResult=null;void graphTest.startPendingWidget(${JSON.stringify(command)},graphTest.state.userRevision).then(value=>window.insertResult=value);`);
    await until(() => js("window.insertResult===true && graphTest.state.widgets[0]?.contentVersion>0"), "committed graph");
    phase("Graph ready");
    await js("window.graphInsertionHistory=graphTest.state.history.length");
    let frame;
    await until(async () => {
      for (const candidate of win.webContents.mainFrame.framesInSubtree) {
        if (candidate.url !== "about:srcdoc") continue;
        const found = await candidate.executeJavaScript("({title:document.title,graph:typeof window.graphView,canvas:!!document.querySelector('#c')})");
        report.frames ||= [];report.frames.push(found);
        if (found.graph === "function") { frame=candidate;return true; }
      }
      return false;
    }, "graph runtime");
    const measure = () => frame.executeJavaScript(`(()=>{const c=document.querySelector('#c'),p=c.parentElement,r=c.getBoundingClientRect(),v=graphView().view2;return {viewport:[innerWidth,innerHeight],plot:[p.clientWidth,p.clientHeight],canvas:[c.clientWidth,c.clientHeight],backing:[c.width,c.height],rect:[r.width,r.height],dpr:devicePixelRatio,view:v,window:v?[v.cx-c.clientWidth/2/v.sx,v.cx+c.clientWidth/2/v.sx,v.cy-c.clientHeight/2/v.sy,v.cy+c.clientHeight/2/v.sy]:null}})()`);
    const sample = async label => {
      phase(label);const m=await measure();
      m.host=await js("(()=>{const w=graphTest.state.widgets[0],s=w.shell,r=w.frame.getBoundingClientRect(),t=w.presentationToolbar?.getBoundingClientRect();return {maximized:!!w.maximized,viewport:!!w.presentationViewport,frameTop:r.top,frameBottom:r.bottom,toolbarBottom:t?.bottom??null,height:innerHeight,scrollHeight:s.scrollHeight,clientHeight:s.clientHeight}})()");
      report.samples.push({label,...m});return m;
    };
    const checkLayout = m => {
      assert.ok(Math.abs(m.canvas[1]-m.plot[1])<=1 && m.canvas[1]<=m.viewport[1]+1,"plot fills its responsive grid area without intrinsic canvas growth (allowing CSS pixel rounding)");
      assert.ok(Math.abs(m.backing[0]-m.canvas[0]*m.dpr)<=1 && Math.abs(m.backing[1]-m.canvas[1]*m.dpr)<=1,"backing pixels use logical CSS size");
      assert.ok(m.window[2]<0 && m.window[3]>8,"origin and parabola vertex stay visible");
      if(m.host.maximized) {
        assert.ok(m.host.frameTop>=m.host.toolbarBottom-1 && m.host.frameBottom<=m.host.height+1,"the entire graph fits below the toolbar on screen");
        assert.ok(m.host.scrollHeight<=m.host.clientHeight+1,"viewport graphs do not create an outer scroll track");
      }
    };
    await pause(700);
    const initial=await sample("inline");
    fs.writeFileSync(path.join(directory,"inline.png"),(await win.webContents.capturePage()).toPNG());
    if (canvasZoom) {
      await js("window.originalGraphFrame=graphTest.state.widgets[0].frame");
      const layout = () => frame.executeJavaScript(`(()=>{const app=document.querySelector('.app'),side=document.querySelector('.side'),c=document.querySelector('#c'),e=document.querySelector('.expression'),css=getComputedStyle(app);return {viewport:[innerWidth,innerHeight],narrow:app.classList.contains('narrow'),columns:css.gridTemplateColumns,rows:css.gridTemplateRows,font:getComputedStyle(e).fontSize,side:[side.offsetLeft,side.offsetTop,side.clientWidth,side.clientHeight],plot:[c.parentElement.offsetLeft,c.parentElement.offsetTop,c.clientWidth,c.clientHeight],backing:[c.width,c.height],state:graphView()}})()`);
      for (const mode of ["2d", "3d"]) {
        await frame.executeJavaScript(`document.getElementById('${mode}').click()`);
        await pause(250);
        const before=await layout(), stored=await js("graphTest.serializedWidgets()"), history=await js("graphTest.state.history.length");
        for (const scale of [.35,.7,1.5,2,1]) {
          await js(`graphTest.state.scale=${scale};graphTest.render()`);await pause(250);
          const current=await layout(),host=await js("(()=>{const w=graphTest.state.widgets[0],r=w.frame.getBoundingClientRect();return {width:r.width,height:r.height,w:w.w,h:w.h}})()");
          report.samples.push({label:`${mode}-canvas-${scale}`,layout:current,host});
          assert.deepEqual(current,before,"Canvas zoom preserves internal layout, formula font, backing pixels and graph camera");
          assert.ok(Math.abs(host.width-host.w*scale)<1 && Math.abs(host.height-host.h*scale)<1,"the existing iframe scales as one Canvas object");
          assert.deepEqual(await js("graphTest.serializedWidgets()"),stored,"Canvas zoom does not rewrite graph source or geometry");
          assert.equal(await js("graphTest.state.history.length"),history,"Canvas zoom does not create Undo entries");
          assert.equal(await js("graphTest.state.widgets[0].frame===originalGraphFrame"),true,"Canvas zoom keeps the live iframe");
          fs.writeFileSync(path.join(directory,`${mode}-canvas-${scale}.png`),(await win.webContents.capturePage()).toPNG());
        }
      }
      // Actual document resizing still reflows the graph, independently of Canvas zoom.
      await js("(()=>{const w=graphTest.state.widgets[0];w.w=w.contentW=500;graphTest.render()})()");await pause(250);
      assert.equal((await layout()).narrow,true,"a genuinely narrow iframe retains responsive layout");
      await js("(()=>{const w=graphTest.state.widgets[0];w.w=w.contentW=1000;graphTest.render()})()");await pause(250);
      assert.equal((await layout()).narrow,false,"a wider iframe restores side-by-side layout");
      report.checks.push("2D/3D Canvas zoom at 35%, 70%, 100%, 150% and 200% preserves layout, camera, live iframe, saved source and Undo history; actual iframe resize remains responsive");
      assert.deepEqual(report.errors,[]);report.ok=true;return;
    }
    if (!baseline) {
      checkLayout(initial);
      assert.deepEqual(await js("({pending:!!graphTest.state.pendingWidget,mode:graphTest.state.mode,toolbar:!!document.querySelector('.object-chrome-button.refine'),interacting:graphTest.state.interactingWidgetId})"),{pending:false,mode:"pen",toolbar:true,interacting:null});
      assert.equal(await js("document.querySelector('.widget-interact-label')?.textContent"),"Interact");
      report.checks.push("New widget is committed with its toolbar, preserves Pen mode and does not enter interaction");
    }
    await js("window.originalGraphFrame=graphTest.state.widgets[0].frame;graphTest.enterWidgetInteraction(graphTest.state.widgets[0])");
    await pause(500);
    const maximized=await sample("maximized");
    fs.writeFileSync(path.join(directory,"maximized.png"),(await win.webContents.capturePage()).toPNG());
    if (!baseline) checkLayout(maximized);
    await pause(600);
    const settled=await sample("maximized-settled");
    if (!baseline) assert.deepEqual(settled,maximized,"layout and coordinate window settle without vertical drift");
    if (baseline) { report.ok=true; return; }
    // Set a deliberate view using actual graph controls and pointer handlers.
    await frame.executeJavaScript(`document.querySelector('#zin').click();(()=>{const c=document.querySelector('#c');c.setPointerCapture=()=>{};c.dispatchEvent(new PointerEvent('pointerdown',{clientX:250,clientY:180,pointerId:7}));c.dispatchEvent(new PointerEvent('pointermove',{clientX:275,clientY:165,pointerId:7}));c.dispatchEvent(new PointerEvent('pointerup',{pointerId:7}));})()`);
    const chosen=await sample("user-pan-zoom");
    const sameWindow = m => m.window.forEach((value,i)=>assert.ok(Math.abs(value-chosen.window[i])<1e-6,"resize retains the chosen mathematical window"));
    for (const [label,width,height] of [["short",1100,620],["tall",900,1100],["phone",390,844]]) {
      win.setSize(width,height);await pause(400);
      const m=await sample(label);checkLayout(m);sameWindow(m);
      fs.writeFileSync(path.join(directory,`${label}.png`),(await win.webContents.capturePage()).toPNG());
    }
    win.setSize(1240,980);await pause(300);
    await js("graphTest.setWidgetPresentationZoom(graphTest.state.widgets[0],70)");await pause(300);
    sameWindow(await sample("presentation-70"));
    await js("graphTest.setWidgetInteraction(null)");await pause(300);
    sameWindow(await sample("return-inline"));
    assert.equal(await js("graphTest.state.widgets[0].frame===originalGraphFrame"),true);
    await js("graphTest.requestWidgetSnapshot(graphTest.state.widgets[0],10000,true,null,true).then(()=>true)");
    sameWindow(await sample("after-snapshot"));
    // Exercise high-density backing-store sizing inside the actual iframe too.
    await frame.executeJavaScript("Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:2});dispatchEvent(new Event('resize'))");
    const highDensity=await sample("dpr-2");checkLayout(highDensity);sameWindow(highDensity);assert.equal(highDensity.dpr,2);
    report.checks.push("Inline, maximized, short/tall/phone, presentation zoom and DPR 2 preserve the graph view and live iframe; snapshot does not move the graph");
    await js("while(graphTest.state.history.length>graphInsertionHistory)graphTest.undo();graphTest.undo()");
    assert.deepEqual(await js("({widgets:graphTest.state.widgets.length,pending:!!graphTest.state.pendingWidget})"),{widgets:0,pending:false});
    await js("graphTest.redo()");
    await until(() => js("graphTest.state.widgets[0]?.contentVersion>0"),"redo graph");
    assert.equal(await js("!!graphTest.state.pendingWidget"),false);
    report.checks.push("Undo removes the inserted widget and Redo restores it without a confirmation draft");
    // Ordinary canvas text still has its editable confirmation draft.
    await js("(()=>{const n=graphTest,s=n.state,c={tool:'write_text',text:'Draft text',x:60,y:60,fontSize:24,maxWidth:400,lineHeight:1.3,color:'#123456'};n.startPending(n.textImage(c.text,c.fontSize,c.color,c.maxWidth,c.lineHeight,s.aiFont),c.x,c.y,s.userRevision,{},c);})()");
    assert.equal(await js("!!graphTest.state.pending"),true);
    await js("graphTest.acceptPending()");
    assert.equal(await js("!!graphTest.state.pending"),false);
    report.checks.push("Canvas text retains its confirmation step");
    // The same renderer also hosts 3D plots and parameter controls.
    for (const candidate of win.webContents.mainFrame.framesInSubtree) {
      if (candidate.url === "about:srcdoc" && await candidate.executeJavaScript("typeof window.graphView==='function'")) frame=candidate;
    }
    await frame.executeJavaScript("(()=>{const input=document.querySelector('.expression');document.getElementById('3d').click();input.textContent='z = a*sin(x)*cos(y)';input.dispatchEvent(new Event('input'));document.querySelector('#zin').click();const slider=document.querySelector('input[type=range]');slider.value='2';slider.dispatchEvent(new Event('input'));})()");
    const surface=await frame.executeJavaScript("({mode:graphView().mode,view:graphView().view3,a:graphView().params.a})");
    assert.equal(surface.mode,"3d");assert.equal(surface.a,2);
    await js("graphTest.enterWidgetInteraction(graphTest.state.widgets[0])");
    win.setSize(1100,620);await pause(400);
    assert.deepEqual(await frame.executeJavaScript("({mode:graphView().mode,view:graphView().view3,a:graphView().params.a})"),surface);
    fs.writeFileSync(path.join(directory,"surface.png"),(await win.webContents.capturePage()).toPNG());
    report.checks.push("3D surface and parameter values survive maximization and resize");
    const longFormula = "sin(x)+cos(2*x)+sin(3*x)+cos(4*x)+sin(5*x)+cos(6*x)+sin(7*x)+cos(8*x)+sin(9*x)+0.731";
    async function editFormula(value) {
      await frame.executeJavaScript(`(()=>{const e=document.querySelector('.expression');e.textContent=${JSON.stringify(value)};e.dispatchEvent(new Event('input'));document.querySelector('#home').click();})()`);
      await pause(200);
    }
    async function checkFormula(label, expected) {
      const hostScale=await js("(()=>{const w=graphTest.state.widgets[0];return w.frame.getBoundingClientRect().width/w.frame.clientWidth})()");
      const metrics=await frame.executeJavaScript(`(()=>{const e=document.querySelector('.expression'),s=document.querySelector('.side'),r=e.getBoundingClientRect(),style=getComputedStyle(e),range=document.createRange();range.selectNodeContents(e);const lines=Array.from(range.getClientRects()).filter(r=>r.width>0);return {text:e.innerText,font:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight),height:r.height,width:r.width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,sideWidth:s.clientWidth,sideScroll:s.scrollHeight,sideHeight:s.clientHeight,lines:lines.length,contained:lines.every(l=>l.right<=r.right+1&&l.bottom<=r.bottom+1),narrow:document.querySelector('.app').classList.contains('narrow'),bad:!!e.closest('.bad')}})()`);
      report.samples.push({label,hostScale,...metrics});
      assert.equal(metrics.text,expected);assert.ok(!metrics.bad,"wrapped/newline expressions still parse");
      assert.ok(metrics.font>=15.9,"formula text is at least 16 logical pixels inside the Widget");
      assert.ok(metrics.contained && metrics.scrollWidth<=metrics.clientWidth+1,"all formula glyphs wrap within the editor");
      assert.ok(metrics.lines>1 && metrics.height>metrics.lineHeight,"long expressions grow to multiple lines");
      fs.writeFileSync(path.join(directory,`${label}.png`),(await win.webContents.capturePage()).toPNG());
    }
    async function exportFormula(label, expectedTail="731") {
      // Record actual raster text calls, then inspect the resulting PNG artifact.
      await frame.executeJavaScript("window.exportText=[];window.originalFillText=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){exportText.push(String(text));return originalFillText.call(this,text,...args)}");
      await frame.executeJavaScript("window.prepareGraphSnapshot=window.__penechoPrepareGraphSnapshot;window.__penechoPrepareGraphSnapshot=()=>{const restore=prepareGraphSnapshot();window.exportGlyphs=[...document.querySelectorAll('.expression')].flatMap(e=>{const r=document.createRange();r.setStart(e.firstChild,e.firstChild.length-3);r.setEnd(e.firstChild,e.firstChild.length);return [...r.getClientRects()].map(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))});return restore}");
      const before=await frame.executeJavaScript("({view:graphView(),scroll:document.querySelector('.side').scrollTop,focus:document.activeElement.className})");
      const snapshot=await js("graphTest.requestWidgetSnapshot(graphTest.state.widgets[0],18000,true,null,true,true).then(s=>({dataUrl:s.dataUrl,width:s.contentWidth,height:s.contentHeight,overflow:s.overflow}))");
      const text=await frame.executeJavaScript("(()=>{CanvasRenderingContext2D.prototype.fillText=originalFillText;return exportText.join('')})()");
      const glyphs=await frame.executeJavaScript("(()=>{window.__penechoPrepareGraphSnapshot=prepareGraphSnapshot;return exportGlyphs})()");
      fs.writeFileSync(path.join(directory,`${label}.png`),Buffer.from(snapshot.dataUrl.split(',')[1],"base64"));
      report.samples.push({label,width:snapshot.width,height:snapshot.height,overflow:snapshot.overflow,text});
      assert.ok(text.includes(expectedTail),"PNG contains the final formula term");
      const png=nativeImage.createFromDataURL(snapshot.dataUrl), size=png.getSize(), pixels=png.toBitmap(), factor=size.width/snapshot.width;
      for(const r of glyphs) {
        let ink=0;
        for(let y=Math.max(0,Math.floor(r.y*factor));y<Math.min(size.height,Math.ceil((r.y+r.h)*factor));y++)
          for(let x=Math.max(0,Math.floor(r.x*factor));x<Math.min(size.width,Math.ceil((r.x+r.w)*factor));x++) {
            const p=(y*size.width+x)*4;
            if(pixels[p+3]>200 && Math.max(pixels[p],pixels[p+1],pixels[p+2])<150) ink++;
          }
        assert.ok(ink>2,`exported last-term glyphs are visible pixels, not clipped text calls (${label})`);
      }
      assert.deepEqual(await frame.executeJavaScript("({view:graphView(),scroll:document.querySelector('.side').scrollTop,focus:document.activeElement.className})"),before,"download retains graph view, formula state, focus and sidebar scroll");
    }
    await frame.executeJavaScript("document.getElementById('2d').click()");
    await editFormula(longFormula);
    for(const [label,width,height] of [["ipad-portrait",834,1194],["ipad-landscape",1194,834],["phone-formula",390,844]]) {
      win.setSize(width,height);await pause(400);await checkFormula(label,longFormula);
    }
    win.setSize(834,1194);await pause(300);
    await exportFormula("download-2d");
    await js("graphTest.setWidgetInteraction(null);(()=>{const w=graphTest.state.widgets[0];w.w=w.contentW=1600;w.h=w.contentH=1000;graphTest.state.scale=.45;graphTest.render()})()");
    await pause(400);await checkFormula("ipad-canvas-45",longFormula);
    await exportFormula("download-canvas-45");
    await frame.executeJavaScript("document.getElementById('3d').click()");
    await editFormula("z = "+longFormula.replaceAll("x)","x)*cos(y)"));
    await exportFormula("download-3d");
    await editFormula("sin(x)+\ncos(x)+731");
    assert.equal(await frame.executeJavaScript("!!document.querySelector('.row.bad')"),false,"explicit newlines remain valid math");
    await frame.executeJavaScript("document.querySelector('#add').click()");
    assert.equal(await frame.executeJavaScript("document.activeElement.matches('.row:last-child .expression')"),true,"Add focuses the accessible multiline editor");
    // Scroll the live formula panel so exports must also include offscreen rows.
    await frame.executeJavaScript(`(()=>{document.querySelector('#add').click();document.querySelector('#add').click();document.querySelectorAll('.expression').forEach((e,i)=>{e.textContent=${JSON.stringify(longFormula.repeat(3))}+'+'+(901+i);e.dispatchEvent(new Event('input'))});const s=document.querySelector('.side');s.scrollTop=s.scrollHeight;document.querySelector('#home').click()})()`);
    await pause(300);
    assert.ok(await frame.executeJavaScript("document.querySelector('.side').scrollTop>0"));
    await exportFormula("download-all-formulas","904");
    await js("graphTest.enterWidgetInteraction(graphTest.state.widgets[0])");
    win.setSize(390,844);await pause(400);
    await frame.executeJavaScript("document.querySelector('.side').scrollTop=200");
    await exportFormula("download-narrow-all-formulas","904");
    report.checks.push("iPad portrait/landscape, narrow screen and 45% Canvas zoom retain logical formula sizing and wrap every glyph; 2D/3D downloads include the final term and preserve live state");
    phase("Complete equations and persistent edits");
    win.setSize(1194,834);
    await js("graphTest.state.scale=1;graphTest.setWidgetPresentationZoom(graphTest.state.widgets[0],100);graphTest.render()");
    await pause(300);
    async function rows(sources) {
      await frame.executeJavaScript(`(()=>{while(document.querySelectorAll('.expression').length>1)document.querySelector('.row:last-child button').click();for(let i=1;i<${sources.length};i++)document.querySelector('#add').click();document.querySelectorAll('.expression').forEach((e,i)=>{e.textContent=${JSON.stringify(sources)}[i];e.dispatchEvent(new Event('input'))});document.querySelector('.side').scrollTop=0;})()`);
      await pause(100);
    }
    const summary=()=>frame.executeJavaScript("({mode:graphView().mode,rows:graphView().rows.map(r=>({src:r.src,axis:r.axis,kind:r.kind,error:r.error})),params:graphView().params})");
    await rows(["z = a sin(x) cos(y)",""]);
    assert.equal(await frame.executeJavaScript("document.querySelectorAll('.row b').length"),0,"the entire equation is editable");
    assert.equal(await frame.executeJavaScript("document.querySelector('.row:last-child').classList.contains('bad')"),false,"a blank expression is not an error");
    assert.equal((await summary()).mode,"3d");
    fs.writeFileSync(path.join(directory,"equations-blank-3d.png"),(await win.webContents.capturePage()).toPNG());
    await rows(["z = 2"]);
    assert.equal((await summary()).mode,"3d","a constant plane does not switch to 2D");
    await rows([""]);
    assert.equal((await summary()).mode,"3d","clearing the last equation does not change dimension");
    await rows(["x = y² + z²","y = x + z"]);
    assert.deepEqual((await summary()).rows.map(r=>r.axis),["x","y"]);
    assert.ok((await summary()).rows.every(r=>!r.error));
    fs.writeFileSync(path.join(directory,"equations-axes.png"),(await win.webContents.capturePage()).toPNG());
    await rows(["x² + y² + z² = a²","a = 2"]);
    await frame.executeJavaScript("document.querySelector('#home').click();document.querySelector('#zin').click();document.querySelector('#zin').click()");
    const pixels=await frame.executeJavaScript("(()=>{const c=document.querySelector('#c'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i+3]>200&&p[i+2]>p[i]+40&&p[i+2]>p[i+1]+30)n++;return n})()");
    assert.ok(pixels>1000,"the implicit sphere actually draws colored pixels");
    fs.writeFileSync(path.join(directory,"equations-sphere.png"),(await win.webContents.capturePage()).toPNG());
    await frame.executeJavaScript("(()=>{const s=document.querySelector('input[type=range]');s.value='1.5';s.dispatchEvent(new Event('input'))})()");
    assert.equal((await summary()).params.a,1.5);
    assert.equal((await summary()).rows[1].src,"a = 1.5","a slider edits its parameter definition too");
    await rows(["z = a*x","a = 2","b = a+1"]);
    assert.equal((await summary()).params.b,3);
    await frame.executeJavaScript("(()=>{const s=document.querySelector('#parameter-a');s.value='3';s.dispatchEvent(new Event('input'))})()");
    assert.equal((await summary()).params.b,4,"dependent parameters follow a slider");
    await rows(["z = a*x","a = b","b = a"]);
    assert.ok((await summary()).rows.every(r=>r.error),"circular definitions cannot draw stale values");
    await rows(["z = a*x","a = 1","a = 2"]);
    assert.ok((await summary()).rows.every(r=>r.error),"duplicate parameters cannot draw stale values");
    await rows(["z = a*x","a ="]);
    assert.ok((await summary()).rows.every(r=>r.error),"an incomplete parameter definition invalidates dependent graphs");
    await rows(["z = sin("]);
    assert.ok((await summary()).rows[0].error);
    await rows(["z > x"]);
    assert.match((await summary()).rows[0].error,/not supported/);
    await rows(["z = sin(x)"]);
    await frame.executeJavaScript("document.getElementById('2d').click()");
    assert.equal((await summary()).mode,"2d");assert.match((await summary()).rows[0].error,/Switch to 3D/);
    await rows(["x² + y² = 4","x = 1"]);
    assert.ok((await summary()).rows.every(r=>!r.error));
    await frame.executeJavaScript("document.querySelector('#home').click()");
    fs.writeFileSync(path.join(directory,"equations-circle.png"),(await win.webContents.capturePage()).toPNG());
    await frame.executeJavaScript("document.getElementById('3d').click()");
    await rows(["x² + y² + z² = a²","a = 1.5"]);
    await until(()=>js("PENECHO_SMART_SUGGEST.graphDocumentData(graphTest.state.widgets[0].html).data.expressions[0]==='x² + y² + z² = a²'"),"full equations saved in canonical widget HTML");
    const saved=await js("graphTest.serializedWidgets()"),expected=await summary();
    assert.match(saved[0].copyText,/x² \+ y² \+ z² = a²/);
    assert.equal(SMART.graphDocumentData(saved[0].html).data.mode,"3d");
    await frame.executeJavaScript("(()=>{const e=document.querySelector('.expression');e.textContent='z = 7';e.dispatchEvent(new Event('input'))})()");
    await until(()=>js("PENECHO_SMART_SUGGEST.graphDocumentData(graphTest.state.widgets[0].html).data.expressions[0]==='z = 7'"),"equation edit persisted");
    await js("graphTest.undo()");
    assert.equal(await js("PENECHO_SMART_SUGGEST.graphDocumentData(graphTest.state.widgets[0].html).data.expressions[0]"),"x² + y² + z² = a²","Undo restores the original equation");
    await js("graphTest.redo()");
    assert.equal(await js("PENECHO_SMART_SUGGEST.graphDocumentData(graphTest.state.widgets[0].html).data.expressions[0]"),"z = 7","Redo restores the edited equation");
    await js(`graphTest.restoreWidgets([]);graphTest.restoreWidgets(${JSON.stringify(saved)});graphTest.render();graphTest.enterWidgetInteraction(graphTest.state.widgets[0]);`);
    await until(async()=>{for(const candidate of win.webContents.mainFrame.framesInSubtree)if(candidate.url==="about:srcdoc"&&await candidate.executeJavaScript("typeof window.graphView==='function'")){frame=candidate;return true;}return false;},"saved graph reopened");
    assert.deepEqual(await summary(),expected,"save/reopen retains equations, parameters and chosen dimension");
    const storedView=SMART.graphDocumentData(saved[0].html).data;
    assert.deepEqual(await frame.executeJavaScript("graphView().view3"),storedView.view3,"the saved 3D camera is restored");
    const loadedWindow=(await measure()).window;
    loadedWindow.forEach((v,i)=>assert.ok(Math.abs(v-storedView.window2[i])<1e-6,"the saved 2D coordinate window is restored"));
    report.checks.push("Full equations, explicit axes, implicit sphere/circle, empty rows, dimension errors, parameter dependencies, persistent edits, Undo/Redo and save/reopen passed");
    assert.deepEqual(report.errors,[]);
    report.ok=true;
  } catch(error) { report.failure=error.stack||String(error); }
  finally {
    win?.destroy();
    if(server) { server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve)); }
    report.serverClosed=!server?.listening;
    fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    app.exit(report.ok?0:1);
  }
});
