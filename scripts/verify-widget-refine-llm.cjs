"use strict";
// Real Chromium input with isolated Canvas data and controlled responses.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-widget-refine-llm.cjs [--cloud]
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict"), { Readable } = require("node:stream");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-refine-llm-"));
const runtime = process.argv.includes("--cloud") ? "cloud" : "local";
const output = path.resolve(process.env.PENECHO_VERIFY_OUTPUT || path.join(root, "docs/verification/widget-refine-options-20261002"));
fs.mkdirSync(output, { recursive:true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false" });
const originalStream = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root, "public/app.js")) {
    return Readable.from([fs.readFileSync(file, "utf8").replace(/\}\)\(\);\s*$/, `
      window.refineTest={state,smartSuggest,widgetAssist,restoreWidgets,render,showWidgetHeader,
        setSmartSuggestEnabled,setCanvasMode,loadCanvasSettings,refreshSmartSuggestAvailability,resumeWidgetAssistSuggestions,canvasDocumentsReady};
      window.refineRequests=[];
      window.refineExecutions=[];
      requestWidgetRefinement=(widget,mode,options)=>{refineExecutions.push({widgetId:widget.id,mode,options});return true;};
      const originalFetch=window.fetch;
      window.fetch=(url,options)=>{
        if(url==='/api/suggest/status'||url==='/api/v1/apps/penecho-llm/suggest/status')
          return Promise.resolve(new Response(JSON.stringify({configured:true}),{status:200,headers:{'Content-Type':'application/json'}}));
        if(url==='/api/suggest'||url==='/api/v1/apps/penecho-llm/suggest') {
          return new Promise(resolve=>refineRequests.push({url,body:JSON.parse(options.body),signal:options.signal,
            resolve:(data,status=200)=>resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}))}));
        }
        return originalFetch(url,options);
      };
    })();`)]);
  }
  return originalStream.call(this, file, ...args);
};
const report = { runtime, source:"071 canonical client with local Widget host; local and Cloud suggestion API routes use mock responses", checks:[], errors:[] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server;
app.whenReady().then(async () => {
  try {
    server = require("../server.js");
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    win = new BrowserWindow({show:false,width:1100,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on("console-message", (_event,level,message) => { if (level >= 3 && !message.startsWith("ResizeObserver loop")) report.errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code, true);
    const until = async (code, label) => {
      for (let i=0;i<100;i++) { if (await js(code)) return; await pause(100); }
      throw Error(`Timed out: ${label}`);
    };
    const capture = async name => { await pause(150); fs.writeFileSync(path.join(output,`${runtime}-${name}.png`),(await win.webContents.capturePage()).toPNG()); };
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until("!!window.refineTest", "startup");
    await js("refineTest.canvasDocumentsReady().then(()=>true)");
    await js("refineTest.loadCanvasSettings().then(()=>true)");
    await js("refineTest.refreshSmartSuggestAvailability().then(()=>true)");
    await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#canvasWelcome').hidden=true");
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled",{enabled:true});
    const click = async selector => {
      const point=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type:"mouseMoved",...point,button:"none"});
      await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type:"mousePressed",...point,button:"left",clickCount:1});
      await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type:"mouseReleased",...point,button:"left",clickCount:1});
      await pause(100);
    };
    const html='<!doctype html><style>html,body{margin:0;height:100%;background:transparent}svg{width:100%;height:100%}</style><svg viewBox="0 0 500 460" xmlns="http://www.w3.org/2000/svg"><g stroke="#27334c" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M140 35H30V380H220M195 35H470V380H295M30 130H270M145 380V225H270M190 280H335V65M280 390V445m-15-20 15 20 15-20"/></g><text x="155" y="24" fill="#8a94aa" font-family="system-ui" font-size="18">START</text><text x="255" y="458" fill="#8a94aa" font-family="system-ui" font-size="18">END</text></svg>';
    await js(`(()=>{const t=refineTest,s=t.state;s.language='en';s.auto=false;s.scale=1;s.panX=0;s.panY=0;s.viewInitialized=true;t.setCanvasMode('pen');t.smartSuggest.available=true;t.restoreWidgets(${JSON.stringify([{id:"widget-1",widgetType:"html_widget",pluginId:"general",x:180,y:180,w:500,h:460,contentW:500,contentH:460,title:"Maze",refreshSeconds:0,html}])});t.render();})()`);
    await until("refineTest.state.widgets.length===1&&refineTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0)", "Widget rendering");
    await js(`window.PENECHO_CONFIG.runtime=${JSON.stringify(runtime)}`);
    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",{type:"mouseMoved",x:400,y:350,button:"none"});
    await until("!!document.querySelector('.object-chrome-button.refine')", "hover header");
    await js("refineTest.resumeWidgetAssistSuggestions()");
    assert.equal(await js("refineRequests.length"),0);
    await click(".object-chrome-button.refine");
    await until("refineRequests.length===1", "opening Refine automatically requests ranking");
    const payload=await js("({url:refineRequests[0].url,mode:refineRequests[0].body.mode,actions:refineRequests[0].body.context.actions,image:refineRequests[0].body.image.slice(0,32)})");
    assert.equal(payload.url,runtime==="cloud"?"/api/v1/apps/penecho-llm/suggest":"/api/suggest");
    assert.equal(payload.mode,"widget");
    assert.ok(payload.actions.includes("note"));
    assert.ok(!payload.actions.includes("add_labels"));
    assert.ok(!payload.actions.includes("make_interactive")&&!payload.actions.includes("animate")&&!payload.actions.includes("larger_text"));
    assert.match(payload.image,/^data:image\/(png|webp);base64,/);
    assert.equal(await js("document.querySelector('.widget-refine-panel-suggest').tagName"),"SPAN");
    assert.equal(await js("document.querySelectorAll('.widget-refine-panel-chip[data-source=local]').length"),0);
    assert.equal(await js("document.querySelector('[data-action-id=vivid]').textContent"),"Make it vivid");
    await js("document.querySelector('.widget-refine-panel-ask input').value='Keep the maze walls';document.querySelector('.widget-refine-panel-ask input').focus();refineTest.resumeWidgetAssistSuggestions()");
    assert.equal(await js("refineRequests.length"),1,"recovery cannot duplicate the automatic request");
    await capture("loading");
    await js("refineTest.setSmartSuggestEnabled(false)");
    assert.equal(await js("refineRequests[0].signal.aborted"),false,"automatic toggle does not cancel Refine ranking");
    const answer={ok:true,answers:{action:{choice:"note",probabilities:{note:.40,fix_layout:.25,larger_text:.15,simplify:.10,match_theme:.08,present:.02}}}};
    await js(`refineRequests[0].resolve(${JSON.stringify(answer)})`);
    await until("refineTest.widgetAssist.inflight.size===0&&document.querySelector('.widget-refine-panel-chip[data-source=penecho-llm]')", "ranked result");
    assert.deepEqual(await js("[...document.querySelectorAll('.widget-refine-panel-chip[data-source=penecho-llm]')].map(e=>e.textContent)"),["Make notes","Fix layout","Simplify"]);
    assert.equal(await js("document.querySelector('.widget-refine-panel-ask input').value"),"Keep the maze walls");
    assert.equal(await js("document.activeElement===document.querySelector('.widget-refine-panel-ask input')"),true);
    await capture("ranked");
    report.checks.push("Hover makes no request; opening Refine automatically requests once; removed actions are absent from the payload; only three model recommendations appear; Make it vivid is a default; typed draft and input focus survive completion.");
    await click(".widget-refine-panel-close");
    await js("refineTest.showWidgetHeader(refineTest.state.widgets[0]);refineTest.render()");
    await click(".object-chrome-button.refine");
    await until("!!document.querySelector('.widget-refine-panel-chip[data-source=penecho-llm]')", "reopening displays cached ranking");
    assert.equal(await js("refineRequests.length"),1);
    await click(".widget-refine-panel-close");
    await js("refineTest.state.widgets[0].html+='<!-- edited -->';refineTest.showWidgetHeader(refineTest.state.widgets[0]);refineTest.render()");
    await click(".object-chrome-button.refine");
    await until("refineRequests.length===2", "new content automatically requests with automatic suggestions off");
    await js("refineRequests[1].resolve({ok:true,answers:{action:{choice:'none',probabilities:{none:1}}}})");
    await until("!!document.querySelector('.widget-refine-panel-status')&&!document.querySelector('.widget-refine-panel-chip[data-source=penecho-llm]')", "empty result");
    assert.equal(await js("!!document.querySelector('[data-action-id=vivid]')"),true);
    await capture("empty");
    report.checks.push("Reopening reuses matching cached results without spending a new request; changed content automatically requests on open; none suppresses ranked suggestions while the vivid shortcut remains.");
    await click(".widget-refine-panel-close");
    await js("refineTest.state.widgets[0].html+='<!-- next edit -->';refineTest.showWidgetHeader(refineTest.state.widgets[0]);refineTest.render()");
    await click(".object-chrome-button.refine");
    await until("refineRequests.length===3", "failure request");
    await js("refineRequests[2].resolve({ok:false,reason:'suggestions_unavailable'},503)");
    await until("document.querySelector('.widget-refine-panel-status')?.textContent.includes('retry')", "retry message");
    await capture("failure");
    await click("button.widget-refine-panel-suggest");await until("refineRequests.length===4", "manual retry");
    await click(".widget-refine-panel-close");
    assert.equal(await js("refineRequests[3].signal.aborted"),true);
    await js("refineRequests[3].resolve({ok:true,answers:{action:{choice:'note',probabilities:{note:1}}}})");
    await pause(100);assert.equal(await js("refineTest.widgetAssist.cache.size"),2);
    assert.equal(await js("refineTest.widgetAssist.retries.size"),0);
    report.checks.push("A failed request has a retry button; closing Refine aborts requests and timers; late responses cannot publish suggestions.");
    await js("refineTest.state.dirty={x:720,y:300,w:90,h:100};refineTest.state.userRevision++;refineTest.state.widgetRefineCandidate=null;refineTest.showWidgetHeader(refineTest.state.widgets[0]);refineTest.render()");
    await click(".object-chrome-button.refine");
    await until("refineRequests.length===5", "viewport dirty ranking");
    assert.equal(await js("refineRequests[4].body.context.marks"),true);
    assert.ok(await js("refineRequests[4].body.context.actions.includes('apply_marks')"));
    assert.equal(await js("document.querySelector('.widget-refine-panel-marks').textContent"),"Refine with my marks");
    await js("refineRequests[4].resolve({ok:true,answers:{action:{choice:'none',probabilities:{none:1}}}})");
    await until("refineTest.widgetAssist.inflight.size===0", "dirty none result");
    assert.equal(await js("!!document.querySelector('.widget-refine-panel-marks')"),true);
    await capture("dirty");
    await click(".widget-refine-panel-marks");
    assert.deepEqual(await js("refineExecutions.at(-1)"),{widgetId:"widget-1",mode:"viewport-dirty",options:{instructionMode:"viewport-dirty"}});
    assert.equal(await js("!!refineTest.state.dirty"),true);
    await js("refineTest.showWidgetHeader(refineTest.state.widgets[0]);refineTest.render()");
    await click(".object-chrome-button.refine");
    await until("!!document.querySelector('[data-action-id=vivid]')", "vivid shortcut");
    await click("[data-action-id=vivid]");
    const vivid=await js("refineExecutions.at(-1)");
    assert.equal(vivid.widgetId,"widget-1");assert.equal(vivid.mode,"action");assert.equal(vivid.options.actionId,"vivid");assert.match(vivid.options.instruction,/vivid/);
    report.checks.push("Viewport dirty marks are included without a nearby Widget candidate; dirty Refine remains present even for none and targets the existing Widget; vivid invokes focused refinement of that same Widget.");
    win.setContentSize(390,844);await pause(200);
    await js("refineTest.state.language='zh';refineTest.state.panX=-150;refineTest.state.dirty={x:300,y:240,w:50,h:40};refineTest.state.userRevision++;refineTest.showWidgetHeader(refineTest.state.widgets[0]);refineTest.render()");
    await click(".object-chrome-button.refine");
    await until("!!document.querySelector('.widget-refine-panel-suggest')", "narrow Chinese panel");
    assert.equal(await js("document.querySelector('.widget-refine-panel-marks')?.textContent"),"根据新笔迹完善");
    const bounds=await js("(()=>{const e=document.querySelector('.widget-refine-panel'),r=e.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:e.scrollWidth,client:e.clientWidth,label:e.querySelector('.widget-refine-panel-suggest').textContent}})()");
    assert.ok(bounds.x>=0&&bounds.right<=bounds.width&&bounds.bottom<=bounds.height);
    assert.ok(bounds.scroll<=bounds.client);assert.equal(bounds.label,"✦PenEchoLLM 正在排序…");
    await until("refineRequests.length===6", "Chinese ranking request");
    await js("refineRequests[5].resolve({ok:true,answers:{action:{choice:'match_theme',probabilities:{match_theme:.4,note:.3,fix_layout:.2,larger_text:.1}}}})");
    await until("document.querySelectorAll('.widget-refine-panel-chip[data-source=penecho-llm]').length===3", "Chinese ranked suggestions");
    const fits = () => js("(()=>{const e=document.querySelector('.widget-refine-panel'),r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth})()");
    assert.ok(await fits());
    await capture("narrow-zh");
    win.setContentSize(1100,900);win.webContents.setZoomFactor(2);await pause(250);
    assert.ok(await fits());
    await capture("zoom-200");
    report.checks.push("Chinese Refine with dirty, vivid and three ranked suggestions fits a 390 px viewport and 200 percent page zoom without horizontal overflow.");
    const beforeNote=await js("({html:refineTest.state.widgets[0].html,dirty:JSON.stringify(refineTest.state.dirty)})");
    await js("hasSelectedAiConnection=()=>false;true");
    await click("[data-action-id=note]");
    await until("refineTest.state.widgets.some(w=>w.sourceFormat==='penecho-note-card+json')", "Make notes creates a real note card");
    const made=await js("(()=>{const s=refineTest.state,w=s.widgets.find(w=>w.sourceFormat==='penecho-note-card+json');return {sourceHtml:s.widgets.find(w=>w.id==='widget-1').html,note:JSON.parse(w.copyText),dirty:JSON.stringify(s.dirty),panelOpen:!!s.widgetRefineConfirmation}})()");
    assert.equal(made.sourceHtml,beforeNote.html);assert.equal(made.dirty,beforeNote.dirty);assert.equal(made.panelOpen,false);
    assert.ok(made.note.blocks.some(block=>block.type==='image'&&block.src.startsWith('data:image/')));
    await capture("made-note");
    report.checks.push("Make notes creates a real note card with the original Widget image, closes Refine, and preserves the source Widget and pending ink.");
    report.payload=payload;report.bounds=bounds;assert.deepEqual(report.errors,[]);report.ok=true;
  } catch(error) {
    report.failure=error.stack;console.error(error);if(win)fs.writeFileSync(path.join(output,`${runtime}-failure-test.png`),(await win.webContents.capturePage()).toPNG());
  } finally {
    win?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));
    report.serverClosed=!server?.listening;fs.writeFileSync(path.join(output,`${runtime}-report.json`),JSON.stringify(report,null,2));
    fs.rmSync(temporary,{recursive:true,force:true});console.log(JSON.stringify(report));app.exit(report.ok?0:1);
  }
});
