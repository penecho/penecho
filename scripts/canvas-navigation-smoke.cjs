'use strict';
// Isolated Electron acceptance. Instrument only the served test copy, never the
// product bundle, user profile, provider credentials, or a real saved canvas.
const {app,BrowserWindow,nativeTheme}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-navigation-'));
app.setPath('userData',path.join(directory,'profile'));
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(directory,'state'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'navigation-test',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false'});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
 if(path.resolve(String(file))===path.join(root,'public/app.js')){
  const code=fs.readFileSync(file,'utf8').replace(/\}\)\(\);\s*$/,`window.navigationTest={state,restoreWidgets,render,setCanvasMode,setCanvasViewMode,setCanvasViewTool,setWidgetInteraction,positionWidgets,syncCanvasNavigation,finishCanvasNavigationPreview,handleCanvasWheel,fitCanvasContents,zoomCanvasAt};})();`);
  return Readable.from([code]);
 }
 return readStream.call(this,file,...args);
};
let server,win;
const report={directory,checks:[],errors:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){for(let i=0;i<100;i++){if(await check())return;await pause(100);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{try{
 server=require('../server.js');await new Promise(r=>server.listening?r():server.once('listening',r));
 win=new BrowserWindow({show:true,width:1200,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:false}});
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)report.errors.push(message);});
 await win.loadURL(`http://127.0.0.1:${server.address().port}`);
 const js=code=>win.webContents.executeJavaScript(code,true);
 await until(()=>js('!!window.navigationTest'),'application startup');
 await js(`document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#studioNavigatorToggle')?.click();if(document.querySelector('#auto').getAttribute('aria-pressed')==='true')document.querySelector('#auto').click();`);
 const camera=()=>js('(()=>{const s=navigationTest.state;return {x:s.panX,y:s.panY,scale:s.scale};})()');
 const html=`<!doctype html><html><head><style>html,body{margin:0;background:#edf2f7;height:100%;font:20px system-ui}button{margin:30px;padding:20px}#map{height:600px;background:#dde8ef;touch-action:none}</style></head><body><button id="action">Test action</button><input id="entry" aria-label="Text"><div id="map">Interactive map surface</div><script>window.counts={click:0,wheel:0,touch:0,pointer:0};document.querySelector('#action').onclick=()=>counts.click++;addEventListener('wheel',e=>{counts.wheel++;e.preventDefault()},{passive:false});addEventListener('touchstart',e=>{counts.touch=Math.max(counts.touch,e.touches.length)},{passive:true});addEventListener('pointerdown',()=>counts.pointer++);<\/script></body></html>`;
 await js(`(()=>{const n=navigationTest,s=n.state;s.scale=1;s.panX=50;s.panY=90;s.auto=false;n.restoreWidgets(${JSON.stringify([0,1].map(i=>({id:'widget-'+(i+1),pluginId:'general',widgetType:'html_widget',x:80+i*200,y:80+i*140,w:600,h:500,contentW:600,contentH:500,title:i?'Front widget':'Rear widget',refreshSeconds:0,html})))});n.setCanvasMode('hand');n.render();})()`);
 await until(()=>js('navigationTest.state.widgets.every(w=>w.hostReady&&w.initialized&&w.contentVersion>0)'),'two live Widget documents');
 const innerFrames=()=>win.webContents.mainFrame.framesInSubtree.filter(f=>f.url==='about:srcdoc');
 const counters=async()=>{const result=[];for(const f of innerFrames()){const count=await f.executeJavaScript('window.counts');if(count)result.push(count);};return result;};
 assert.equal((await counters()).length,2);
 await pause(700);await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click()");await pause(100);
 const identity=await js('navigationTest.state.widgets.map(w=>{w.frame.dataset.identity=w.id;return w.id})');
 const rects=()=>js('navigationTest.state.widgets.map(w=>{const r=w.shell.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})');
 win.webContents.debugger.attach('1.3');
 const click=async(x,y)=>{for(const type of ['mouseMoved','mousePressed','mouseReleased'])await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',clickCount:type==='mouseMoved'?0:1});await pause(100);};
 const drag=async(x,y,dx,dy)=>{await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx,y:y+dy,button:'left',buttons:1});await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+dx,y:y+dy,button:'left',buttons:0,clickCount:1});await pause(100);};
 const rightClick=async(x,y)=>{for(const type of ['mouseMoved','mousePressed','mouseReleased'])await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'right',buttons:type==='mousePressed'?2:0,clickCount:type==='mouseMoved'?0:1});await pause(120);};
 const doubleClick=async(x,y)=>{for(const [type,clickCount,buttons] of [['mouseMoved',0,0],['mousePressed',1,1],['mouseReleased',1,0],['mousePressed',2,1],['mouseReleased',2,0]])await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons,clickCount});await pause(150);};
 const toolbarVisible=()=>js('(()=>{const e=document.querySelector(".object-chrome-button.interact");return Boolean(e)&&getComputedStyle(e).visibility==="visible";})()');
 const statusBar=()=>js('(()=>{const e=document.querySelector(".widget-interaction-status");if(!e||e.hidden)return null;const box=e.getBoundingClientRect();return {text:e.textContent.trim(),bottom:box.bottom,top:box.top};})()');

 let before=await camera(),r=(await rects())[1];
 await drag(r.x+100,r.y+100,45,25);
 let after=await camera();assert.ok(Math.abs(after.x-before.x-45)<1&&Math.abs(after.y-before.y-25)<1,'Hand pans over Widget');assert.equal((await counters()).reduce((n,c)=>n+c.pointer,0),0);
 report.checks.push('Hand drags over live Widget without firing its controls');
 r=(await rects())[1];await click(r.x+120,r.y+130);
 assert.equal(await js('navigationTest.state.mode'),'hand');
 assert.ok(await toolbarVisible(),'Hand click shows visible Widget toolbar');
 assert.equal(await js('!!document.querySelector(".object-chrome-button.accept, .object-chrome-button.cancel")'),false,'Widget toolbar omits accept/cancel decisions');
 assert.equal((await counters()).reduce((n,c)=>n+c.pointer,0),0,'Hand click never reaches Widget content');
 fs.writeFileSync(path.join(directory,'hand-toolbar-desktop.png'),(await win.webContents.capturePage()).toPNG());

 const interactPoint=await js('(()=>{const r=document.querySelector(".object-chrome-button.interact").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
 await click(interactPoint.x,interactPoint.y);
 assert.equal(await js('navigationTest.state.interactingWidgetId'),'widget-2');
 await pause(150);
 let status=await statusBar();
 assert.ok(status&&['Interacting','正在交互中'].includes(status.text),'Interaction shows a localized status bar');
 r=(await rects())[1];assert.ok(status.bottom<=r.y+1,'Interaction status sits above the Widget');
 fs.writeFileSync(path.join(directory,'widget-interaction-status.png'),(await win.webContents.capturePage()).toPNG());
 await js('document.querySelector("#canvasWidgetExit").click()');
 await pause(150);
 assert.equal(await statusBar(),null,'Interaction status hides after leaving interaction');
 await js('navigationTest.setCanvasMode("select");navigationTest.setCanvasMode("hand")');
 await pause(200);
 assert.equal(await toolbarVisible(),false,'Toolbar is hidden before the context-menu check');
 r=(await rects())[1];await rightClick(r.x+120,r.y+130);
 assert.ok(await toolbarVisible(),'Right-click lists the Widget toolbar without a native menu');
 await doubleClick(r.x+120,r.y+130);
 assert.equal(await js('navigationTest.state.mode'),'select','Double-click from Hand selects the tool that owns interaction');
 assert.equal(await js('navigationTest.state.interactingWidgetId'),'widget-2','Double-click from Hand enters Widget interaction');
 await js('document.querySelector("#canvasWidgetExit").click();navigationTest.setCanvasMode("hand")');
 report.checks.push('Hand click opens toolbar without switching tools; Interact explicitly enters Widget; right-click lists it and double-click enters it; a status bar marks interaction');
 assert.equal(await js('!!document.querySelector(".object-chrome-button.refine")'),false,'Hand toolbar never shows AI Refine');
 await js('navigationTest.setCanvasMode("pen")');
 r=(await rects())[1];
 await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+100,y:r.y+100,button:'none'});
 await pause(200);
 assert.ok(await js('!!document.querySelector(".object-chrome-button.refine")'),'Pen hover over Widget shows AI Refine');
 await js('navigationTest.setCanvasMode("hand")');
 await pause(150);
 assert.equal(await js('!!document.querySelector(".object-chrome-button.refine")'),false,'Leaving Pen hides AI Refine immediately');
 report.checks.push('AI Refine appears only in Pen (hover/tap); Hand toolbar has no Refine entry');

 before=await camera();
 await js(`(()=>{const v=document.querySelector('#viewport'),r=v.getBoundingClientRect();v.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:24,deltaY:37,clientX:r.x+200,clientY:r.y+200}));})()`);
 after=await camera();assert.equal(after.scale,before.scale);assert.equal(after.x,before.x-24);assert.equal(after.y,before.y-37);
 await js(`(()=>{const v=document.querySelector('#viewport'),r=v.getBoundingClientRect();v.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-60,clientX:r.x+200,clientY:r.y+200}));})()`);assert.ok((await camera()).scale>after.scale);
 report.checks.push('Two-axis wheel pans; pinch-style Ctrl wheel zooms');
 assert.equal(await js('getComputedStyle(document.querySelector("#screen")).cursor'),'default','wheel uses a visible native cursor');
 const savedCamera=await camera();
 await js('navigationTest.state.scale=.5;navigationTest.state.panX+=500;navigationTest.render()');
 const disturbed=await camera();
 await js('document.querySelector("#canvasFitContents").click()');
 const fitted=await camera();
 assert.ok(Math.abs(fitted.scale-disturbed.scale)>1e-9||Math.abs(fitted.x-disturbed.x)>1e-9||Math.abs(fitted.y-disturbed.y)>1e-9,'fit button reframes the Canvas');
 await js(`Object.assign(navigationTest.state,{panX:${savedCamera.x},panY:${savedCamera.y},scale:${savedCamera.scale}});navigationTest.render()`);
 report.checks.push('Fit-contents button reframes the Canvas; wheel keeps native cursor visible');

 await js(`navigationTest.setCanvasViewMode(true)`);await pause(250);
 assert.equal(await js('navigationTest.state.viewTool'),'hand');
 r=(await rects())[1];before=await camera();
 // View Hand double-click enters interaction directly and marks it with the status bar.
 await doubleClick(r.x+85,r.y+60);
 assert.equal(await js('navigationTest.state.interactingWidgetId'),'widget-2','View Hand double-click enters Widget interaction');
 await pause(150);
 assert.ok(await statusBar(),'View interaction shows the status bar');
 await js('document.querySelector("#canvasWidgetExit").click();navigationTest.setCanvasViewTool("hand")');await pause(150);
 assert.equal(await statusBar(),null,'View status bar hides after exit');
 await drag(r.x+100,r.y+100,20,15);assert.ok((await camera()).x>before.x);
 await js(`document.querySelector('#canvasViewSelect').click()`);
 r=(await rects())[1];await click(r.x+85,r.y+60);
 assert.equal(await js('navigationTest.state.interactingWidgetId'),'widget-2');assert.equal((await counters()).reduce((n,c)=>n+c.click,0),0,'selection must not activate inner button');
 await pause(200);r=(await rects())[1];await click(r.x+85,r.y+60);assert.equal((await counters()).reduce((n,c)=>n+c.click,0),1,'next click reaches only selected Widget');
 before=await camera();await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',x:r.x+100,y:r.y+130,deltaY:40,deltaX:0});await pause(150);
 assert.deepEqual(await camera(),before);assert.ok((await counters()).some(c=>c.wheel>0));
 const p1={x:r.x+100,y:r.y+170,id:1,radiusX:4,radiusY:4},p2={x:r.x+160,y:r.y+170,id:2,radiusX:4,radiusY:4};
 await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p1,p2]});
 await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p1,x:p1.x-15},{...p2,x:p2.x+15}]});
 await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause(150);
 assert.deepEqual(await camera(),before);assert.ok((await counters()).some(c=>c.touch===2),'both fingers reach selected Widget');
 report.checks.push('View selects without click-through; native click, wheel and two-finger gestures reach selected Widget only');
 let entry;
 for(const frame of innerFrames()){
  entry=await frame.executeJavaScript('(()=>{const e=document.querySelector("#entry");if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+12,y:r.y+r.height/2};})()');
  if(entry)break;
 }
 assert.ok(entry,'test Widget input exists');
 await click(r.x+entry.x*r.w/600,r.y+entry.y*r.h/500);
 await win.webContents.debugger.sendCommand('Input.insertText',{text:'h v p native text'});
 const inputValues=await Promise.all(innerFrames().map(f=>f.executeJavaScript('document.querySelector("#entry")?.value')));
 assert.equal(inputValues.filter(value=>value==='h v p native text').length,1,'native text input belongs to selected Widget');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
 win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
 await until(()=>js('navigationTest.state.interactingWidgetId===null'),'Escape from native Widget input');
 assert.equal(await js('navigationTest.state.viewMode'),true,'Escape exits interaction before View');
 report.checks.push('Native text input stays inside Widget; Escape exits interaction and preserves View');
 // Activate the visible part of the rear Widget. Its overlapped part remains
 // blocked by the front shell even though the front iframe is now inactive.
 r=(await rects())[0];await click(r.x+60,r.y+60);assert.equal(await js('navigationTest.state.interactingWidgetId'),'widget-1');
 const rearCounts=await counters();r=(await rects())[1];await click(r.x+85,r.y+60);
 assert.deepEqual(await counters(),rearCounts,'front selecting click never reaches rear');assert.equal(await js('navigationTest.state.interactingWidgetId'),'widget-2');
 assert.deepEqual(await js('navigationTest.state.widgets.map(w=>w.id)'),identity,'View never reorders widgets');
 await js(`document.querySelector('#canvasWidgetExit').click()`);assert.equal(await js('navigationTest.state.interactingWidgetId'),null);
 report.checks.push('Front Widget blocks active rear Widget; explicit exit and stack order preserved');
 await js('navigationTest.setCanvasViewMode(false);navigationTest.setCanvasMode("select")');await pause(200);
 r=(await rects())[1];const geometry=await js('navigationTest.state.widgets[1].x');await drag(r.x+140,r.y+150,30,0);assert.ok(await js(`navigationTest.state.widgets[1].x>${geometry}`));
 assert.ok(await js(`!!document.querySelector('.object-chrome-button.interact')`));
 await js(`document.querySelector('.object-chrome-button.interact').click()`);assert.equal(await js('navigationTest.state.interactingWidgetId'),'widget-2');
 await js(`document.querySelector('#canvasWidgetExit').click();navigationTest.setCanvasMode('pen');document.activeElement?.blur()`);
 before=await camera();win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});await pause(40);
 r=(await rects())[1];await drag(r.x+140,r.y+150,20,0);win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await pause(50);
 assert.ok((await camera()).x>before.x);assert.equal(await js('navigationTest.state.mode'),'pen');assert.equal(await js('navigationTest.state.spacePan'),false);
 assert.deepEqual(await js('navigationTest.state.widgets.map(w=>w.frame.dataset.identity)'),identity);
 report.checks.push('Select drags objects and exposes Interact; Space pans temporarily without changing Pen or iframe identity');
 await js('navigationTest.setCanvasViewMode(true);navigationTest.fitCanvasContents()');await pause(200);
 for(const [name,width,height,dark] of [['desktop',1200,900,false],['tablet',820,1080,false],['phone',390,844,true]]){
  nativeTheme.themeSource=dark?'dark':'light';win.setSize(width,height);await pause(250);
  // The shared button contract paints an intentional ::after hit ring outside
  // each button, which inflates scrollWidth. For the icon-only fit control,
  // assert the glyph itself stays inside the button instead.
  const layout=await js(`['canvasViewActions','canvasFitContents'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();let overflow=e.scrollWidth>e.clientWidth+1;if(id==='canvasFitContents'){const i=e.querySelector('svg').getBoundingClientRect();overflow=i.left<r.left-1||i.right>r.right+1||i.top<r.top-1||i.bottom>r.bottom+1;}return {id,x:r.x,right:r.right,bottom:r.bottom,width:r.width,overflow,viewport:innerWidth,height:innerHeight};})`);
  for(const l of layout){assert.ok(l.x>=0&&l.right<=l.viewport+1&&l.bottom<=l.height+1&&!l.overflow,JSON.stringify(l));}
  fs.writeFileSync(path.join(directory,name+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 report.checks.push('Desktop/tablet/phone navigation stays visible without overflow');
 report.ok=true;
}catch(error){report.ok=false;report.error=error.stack;if(win)fs.writeFileSync(path.join(directory,'failure.png'),(await win.webContents.capturePage()).toPNG());}
finally{fs.createReadStream=readStream;fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));win?.destroy();if(server){server.closeAllConnections?.();server.close();}app.exit(report.ok?0:1);}});
