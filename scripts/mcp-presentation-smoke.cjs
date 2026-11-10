"use strict";
// Opt-in isolated Electron acceptance. Never imports a user profile or calls a model.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-presentation-"));
app.setPath("userData",path.join(directory,"browser"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(directory,"state"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false"});
let server,window;const report={directory,checks:[],errors:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(check,label){for(let i=0;i<100;i++){if(await check())return;await pause(100);}throw Error(`Timed out: ${label}`);}
app.whenReady().then(async()=>{
 try{
  server=require("../server.js");await new Promise(r=>server.listening?r():server.once("listening",r));
  report.port=server.address().port;
  window=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  window.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
  await window.loadURL(`http://127.0.0.1:${report.port}`);
  const js=code=>window.webContents.executeJavaScript(code,true);
  await waitFor(()=>js("!!document.querySelector('#settingsBtn')"),"startup");
  await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#settingsBtn').click();document.querySelector('#settingsNavMcp').click()");
  await waitFor(()=>js("document.querySelector('#mcpConfig').textContent.includes('stdio.js')"),"MCP config");
  await js("document.querySelector('#mcpEnabled').click()");
  const {readRecords,recordsDirectory}=require("../src/server/mcp/records.js"),{bridgeRequest}=require("../src/server/mcp/stdio.js");
  const record=readRecords(recordsDirectory(process.env.PENECHO_STATE_DIR))[0],ownerId=crypto.randomUUID();
  const call=(name,args)=>bridgeRequest(record,{ownerId,operation:"call",name,arguments:args});
  let listed;await waitFor(async()=>{listed=await call("penecho_list_canvases",{});return listed.canvases.length===1;},"discovery");
  const target=listed.canvases[0],session=await call("penecho_start_session",{instanceId:target.instanceId,canvasId:target.canvasId,title:"展示与反馈验收",client:"Test",sessionKey:"presentation-smoke"});
  assert.equal(session.boardObjectId,null);assert.equal(await js("document.querySelectorAll('.canvas-widget').length"),0);
  await js("document.querySelector('#settingsClose').click()");
  const html=title=>`<!doctype html><html lang="zh"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#fff;color:#202124;font:16px/1.6 system-ui}h1{font-size:26px;line-height:1.3;margin:0 0 16px}button{font:inherit;min-height:36px;line-height:1.8;padding:4px 12px;margin-top:16px}p{overflow-wrap:anywhere}</style><h1>${title}</h1><p>查看方案，直接标注需要调整的地方。选择后，外部对话读取指令并继续修改。</p><button data-penecho-action="choose" data-penecho-prompt="保留当前布局，并简化说明文字">采用这个方案并继续修改</button></html>`;
  const main=await call("penecho_present_widget",{sessionId:session.sessionId,artifactId:"main",title:"主要方案",html:html("主要方案"),presentation:{intent:"review",size:"base"}});
  await pause(1300);
  const compare=await call("penecho_present_widget",{sessionId:session.sessionId,artifactId:"alternative",title:"备选方案",html:html("备选方案"),presentation:{intent:"compare",role:"alternative",relativeTo:"main",relation:"beside"}});
  const inspected=await call("penecho_inspect_session",{sessionId:session.sessionId});
  const artifacts=inspected.artifacts||inspected.canvas?.artifacts||inspected.render?.artifacts;
  report.inspect=inspected;
  // Public source geometry provides independent layout evidence.
  const geometry=async objectId=>{const file=await call("penecho_read_file",{sessionId:session.sessionId,path:`objects/${objectId}/geometry.json`});return JSON.parse(file.content);};
  const a=await geometry(main.objectId),b=await geometry(compare.objectId);assert.equal(a.w,480);assert.equal(a.h,360);assert.equal(a.y,b.y);assert.equal(b.x,a.x+a.w+32);
  fs.writeFileSync(path.join(directory,"wide.png"),(await window.webContents.capturePage()).toPNG());
  const before=await call("penecho_read_file",{sessionId:session.sessionId,path:"canvas.json"});
  for(const [name,width,height] of [["mobile",390,844],["desktop",1200,800]]){
   const capture=await call("penecho_present_widget",{sessionId:session.sessionId,artifactId:`inspect-${name}`,title:`检查 ${name}`,html:html(`检查 ${name}`),width,height,presentation:{intent:"inspect"},capture:true});
   assert.equal(capture.ephemeral,true);assert.equal(capture.pixelVerified,true);assert.equal(capture.objectId,undefined);assert.equal(capture.viewport.width,width);
   fs.writeFileSync(path.join(directory,`inspect-${name}.webp`),Buffer.from(capture.image.data,"base64"));
   assert.equal(await js("document.querySelectorAll('.canvas-widget').length"),2);
  }
  const after=await call("penecho_read_file",{sessionId:session.sessionId,path:"canvas.json"});assert.equal(before.contentHash,after.contentHash);
  const source=await call("penecho_present_widget",{sessionId:session.sessionId,artifactId:"main",title:"主要方案",html:html("修订后的方案"),width:390});assert.equal(source.objectId,main.objectId);assert.deepEqual(await geometry(main.objectId),a);
  report.checks.push("boardless session","base size and related comparison","inspect at mobile and desktop sizes without persistence","stable HTML updates preserve geometry");
  for(const [name,width,zoom] of [["narrow",700,1],["zoom",1440,2]]){
   window.setSize(width,1000);window.webContents.setZoomFactor(zoom);await pause(250);
   const next=await call("penecho_present_widget",{sessionId:session.sessionId,artifactId:name,title:"继续对比",html:html("继续对比"),presentation:{intent:"compare",relativeTo:"main",relation:"beside",attention:"quiet"}});
   const c=await geometry(next.objectId);assert.equal(c.x,a.x);assert.ok(c.y>=a.y+a.h+32);
   assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"),true);
   fs.writeFileSync(path.join(directory,`${name}.png`),(await window.webContents.capturePage()).toPNG());
  }
  report.checks.push("narrow and 200% layout fall below without page overflow");report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;if(window)fs.writeFileSync(path.join(directory,"failure.png"),(await window.webContents.capturePage()).toPNG());}
 finally{window?.destroy();if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}report.closed=!server?.listening;fs.writeFileSync(path.join(directory,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);}
});
