"use strict";
// Run explicitly with the project's Electron binary. Uses an isolated profile,
// real local HTTPS MCP requests, and no model or external client configuration.
const {app,BrowserWindow,nativeTheme}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),https=require("node:https");
const ROOT=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-ip-smoke-"));
const lanHost=require("../src/server/mcp/network-addresses.js").lanAddresses()[0];
if(!lanHost)throw Error("A reachable LAN IPv4 interface is required for IP change acceptance.");
const outputArgument=process.argv.find(value=>value.startsWith("--output="));
const output=path.resolve(ROOT,outputArgument?.slice("--output=".length)||"docs/verification/local-ip-direct-20261002");fs.mkdirSync(output,{recursive:true});
app.setPath("userData",path.join(temporary,"electron"));
app.on("window-all-closed",()=>{});
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"isolated-ip-test",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false"});
// MCP credentials deliberately use a host-wide registry in production. Redirect
// that boundary for this test before loading the canonical server module.
require("../src/server/mcp/records.js").registryStateDirectory=()=>path.join(temporary,"registry");
let server,window;
const report={ok:false,errors:[],checks:[]},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check,label){for(let i=0;i<100;i++){if(await check())return;await pause(100);}throw Error(`Timed out: ${label}`);}
function rpc(status,token,method,params,session,options={}) {
  return new Promise((resolve,reject)=>{
    const endpoint=options.url||status.ipDirect.url;
    const req=https.request(endpoint,{method:"POST",ca:status.certificatePem,agent:false,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(session?{"mcp-session-id":session}:{})}},res=>{
      let bytes="";res.on("data",chunk=>bytes+=chunk);res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:bytes?JSON.parse(bytes):null}));
    });req.setTimeout(5000,()=>req.destroy(Error("MCP request timed out")));req.on("error",reject);req.end(JSON.stringify({jsonrpc:"2.0",id:1,method,params}));
  });
}
app.whenReady().then(async()=>{
  try {
    server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    window=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    window.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    const js=code=>window.webContents.executeJavaScript(code,true);
    const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click()`);
    const text=id=>js(`document.getElementById(${JSON.stringify(id)}).textContent`);
    const status=()=>js("window.PenEchoLocalMcp.api('status')");
    const screenshot=async name=>fs.writeFileSync(path.join(output,name+".png"),(await window.webContents.capturePage()).toPNG());
    const open=async()=>{
      await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelector('#settingsBtn').click();document.querySelector('#settingsNavMcp').click();document.querySelector('#mcpLocalTab').click();document.querySelector('#mcpIpTab').click()");
      await wait(()=>js("!document.querySelector('#mcpIpGenerate').disabled||!document.querySelector('#mcpIpEdit').disabled"),"IP settings loaded");
      await js("window.PenEchoLocalMcp.copy=async value=>{window.ipTestCopied=value;return true;};true");
    };
    await window.loadURL(origin);await wait(()=>js("!!window.PenEchoLocalMcp"),"Canvas started");await open();
    assert.equal(await js("document.querySelector('#mcpAutoPanel').hidden"),true);
    assert.equal(await js("document.querySelector('#mcpIpCopySetup').disabled"),true);
    let current=await status(),port=current.http.ipDirect.listenerPort;
    await js("(async()=>{window.ipInitialStatus=await window.PenEchoLocalMcp.api('status');return true;})()");
    await js(`document.querySelector('#mcpIpHost').value='invalid';document.querySelector('#mcpIpPort').value='${port}';document.querySelector('#mcpIpHost').dispatchEvent(new Event('input'))`);await click("mcpIpGenerate");
    await wait(()=>text("mcpIpStatus").then(value=>value.includes("IPv4")),"IP validation error");
    assert.equal((await status()).http.ipDirect.accessToken,"");
    await js("document.querySelector('#mcpIpHost').value='127.0.0.1';document.querySelector('#mcpIpHost').dispatchEvent(new Event('input'))");
    await screenshot("initial");await click("mcpIpGenerate");
    await wait(()=>js("!document.querySelector('#mcpIpTokenReady').hidden&&!document.querySelector('#mcpIpCopySetup').disabled"),"token generation");
    current=await status();const first=current.http.ipDirect.accessToken,ca=current.http.certificatePem,discoveryToken=current.http.accessToken;
    await js("window.PenEchoMcpSettings.setLocalStatus(window.ipInitialStatus)");assert.equal(await js("document.querySelector('#mcpIpTokenReady').hidden"),false,"a delayed old status cannot erase the newly saved token");
    assert.equal(await js("document.querySelector('#mcpIpToken').type"),"password");assert.equal(current.http.ipDirect.enabled,true);
    await click("mcpIpShowToken");assert.equal(await js("document.querySelector('#mcpIpToken').type"),"text");await click("mcpIpShowToken");
    await click("mcpIpCopySetup");const prompt=await js("window.ipTestCopied");assert.ok(prompt.includes(first)&&prompt.includes(ca)&&prompt.includes(current.http.ipDirect.url));assert.match(prompt,/Do not disable TLS/);
    await click("mcpIpCopyConfig");const config=JSON.parse(await js("window.ipTestCopied"));assert.equal(config.mcpServers["penecho-local"].headers.Authorization,`Bearer ${first}`);
    await click("mcpIpCopyCa");assert.equal(await js("window.ipTestCopied"),ca);
    assert.match(await text("mcpIpBadge"),/Waiting for AI/);await screenshot("configured");
    report.checks.push("initial validation, generation, masked token, prompt/config/CA copy and waiting state");

    const initialized=await rpc(current.http,first,"initialize");assert.equal(initialized.status,200);const session=initialized.headers["mcp-session-id"];
    const listed=await rpc(current.http,first,"tools/list",undefined,session);assert.ok(listed.body.result.tools.length);
    let canvases;await wait(async()=>{canvases=await rpc(current.http,first,"tools/call",{name:"penecho_list_canvases",arguments:{}},session);return canvases.body.result?.structuredContent?.canvases?.length===1;},"Canvas automatically opted in");
    const target=canvases.body.result.structuredContent.canvases[0];
    const call=async(name,args)=>{const response=await rpc(current.http,first,"tools/call",{name,arguments:args},session);assert.equal(response.status,200);assert.equal(response.body.result.isError,undefined,JSON.stringify(response.body.result.structuredContent));return response.body.result.structuredContent;};
    const started=await call("penecho_start_session",{canvasId:target.canvasId,instanceId:target.instanceId,target:"current",title:"IP direct acceptance",client:"IP test",sessionKey:"ip-acceptance"});
    assert.equal(started.imageUpload.url,current.http.ipDirect.url.replace(/\/mcp$/,"/mcp/images"));assert.equal(started.imageUpload.clientPath,undefined);
    const uploadUrl=new URL(started.imageUpload.url);
    for(const [key,value] of Object.entries({canvasId:started.canvasId,documentId:started.documentId,requestId:"ip-image",name:"acceptance.png"}))uploadUrl.searchParams.set(key,value);
    const imageBytes=await require("sharp")({create:{width:8,height:8,channels:3,background:"#4f46e5"}}).png().toBuffer();
    const uploaded=await new Promise((resolve,reject)=>{
      const req=https.request(uploadUrl,{method:"POST",ca,agent:false,headers:{authorization:`Bearer ${first}`,"content-type":"application/octet-stream"}},res=>{let bytes="";res.on("data",chunk=>bytes+=chunk);res.on("end",()=>resolve({status:res.statusCode,body:JSON.parse(bytes)}));});
      req.setTimeout(5000,()=>req.destroy(Error("Image upload timed out")));req.on("error",reject);req.end(imageBytes);
    });assert.equal(uploaded.status,200,JSON.stringify(uploaded.body));assert.match(uploaded.body.source,/^penecho-asset:/);
    const placed=await call("penecho_place_image",{sessionId:started.sessionId,requestId:"place-ip-image",source:uploaded.body.source,width:80});assert.ok(placed);
    const presented=await call("penecho_present_widget",{sessionId:started.sessionId,artifactId:"ip-preview",requestId:"present-ip-preview",title:"Connected by IP",html:"<!doctype html><html><body style='font:16px system-ui;padding:24px'><h2>Connected by IP</h2><p>Real HTTPS MCP acceptance.</p></body></html>",width:480,height:240});assert.ok(presented.objectId);
    await wait(()=>text("mcpIpBadge").then(value=>value.includes("1 AI connected")),"connected status");await screenshot("connected");
    await click("mcpIpOpen");assert.equal(await js("document.querySelector('#settingsLayer').hidden"),true);
    await wait(()=>js("!!document.querySelector('.canvas-widget iframe')"),"Widget rendered");await screenshot("canvas-connected");
    report.checks.push("real initialize/tools/list/start_session/present_widget, HTTPS raw image upload and placement, connected badge and Canvas navigation");

    await open();await click("mcpIpEdit");
    await js("(async()=>{window.ipEditBaseRevision=window.PenEchoLocalMcp.status().http.ipDirect.revision;await window.PenEchoLocalMcp.api('ip-direct',{action:'save-address',revision:window.ipEditBaseRevision,host:window.PenEchoLocalMcp.status().http.ipDirect.host,port:window.PenEchoLocalMcp.status().http.ipDirect.port});await window.PenEchoLocalMcp.refresh();return true;})()");
    await click("mcpIpSave");await wait(()=>text("mcpIpEditError").then(value=>value.includes("another window")),"stale edit rejected");
    await click("mcpIpEditCancel");await click("mcpIpEdit");await js("document.querySelector('#mcpIpNewHost').value='bad'");await click("mcpIpSave");
    await wait(()=>text("mcpIpEditError").then(value=>value.includes("IPv4")),"edit dialog validation");assert.equal(await js("document.querySelector('#mcpIpEditDialog').open"),true);
    await js(`document.querySelector('#mcpIpNewHost').value=${JSON.stringify(lanHost)}`);await click("mcpIpSave");await wait(()=>js("!document.querySelector('#mcpIpEditDialog').open"),"address saved");
    current=await status();assert.equal(current.http.ipDirect.accessToken,first);assert.equal(current.http.certificatePem,ca);assert.equal(new URL(current.http.ipDirect.url).hostname,lanHost);
    assert.equal((await rpc(current.http,first,"ping",undefined,session)).status,404);
    await click("mcpIpCopySetup");const updated=await js("window.ipTestCopied");assert.ok(updated.includes(lanHost));assert.match(updated,/Keep its current Access Token/);assert.ok(updated.includes(first)&&updated.includes(ca));assert.match(updated,/If the entry is missing/);
    const reconnect=await rpc(current.http,first,"initialize");assert.equal(reconnect.status,200);
    report.checks.push("invalid edit recovery, IP update retains token and CA, old session disposed, address update prompt and TLS reconnect");

    const discoverySession=(await rpc(current.http,discoveryToken,"initialize",undefined,undefined,{url:current.http.localUrl})).headers["mcp-session-id"];
    await click("mcpIpEnabled");await wait(()=>js("document.querySelector('#mcpIpEnabled').getAttribute('aria-checked')==='false'&&!document.querySelector('#mcpIpEnabled').disabled"),"service disabled");
    assert.equal((await rpc(current.http,first,"initialize")).status,401);
    assert.equal((await rpc(current.http,discoveryToken,"ping",undefined,discoverySession,{url:current.http.localUrl})).status,200);
    await click("mcpIpEnabled");await wait(()=>js("document.querySelector('#mcpIpEnabled').getAttribute('aria-checked')==='true'&&!document.querySelector('#mcpIpEnabled').disabled"),"service enabled");
    await click("mcpIpRotate");await click("mcpIpRotateCancel");assert.equal((await status()).http.ipDirect.accessToken,first);
    await click("mcpIpRotate");await screenshot("rotate-confirmation");await click("mcpIpRotateConfirm");await wait(()=>js("!document.querySelector('#mcpIpRotateDialog').open"),"token rotated");
    current=await status();assert.notEqual(current.http.ipDirect.accessToken,first);assert.equal(current.http.certificatePem,ca);
    assert.equal((await rpc(current.http,first,"initialize")).status,401);assert.equal((await rpc(current.http,current.http.ipDirect.accessToken,"initialize")).status,200);
    assert.equal((await rpc(current.http,discoveryToken,"ping",undefined,discoverySession,{url:current.http.localUrl})).status,200);
    report.checks.push("service disable/enable, rotation cancel/confirm, old token rejected, new token works, discovery session preserved");

    const revision=current.http.ipDirect.revision,rotated=current.http.ipDirect.accessToken;
    await window.reload();await wait(()=>js("!!window.PenEchoLocalMcp"),"reload");await open();current=await status();assert.equal(current.http.ipDirect.accessToken,rotated);assert.equal(current.http.ipDirect.revision,revision);
    await js("window.ipOriginalFetch=window.fetch;window.fetch=(input,options)=>String(input)==='/api/mcp/status'?Promise.resolve(new Response(JSON.stringify({error:{code:'forbidden'}}),{status:403,headers:{'Content-Type':'application/json'}})):window.ipOriginalFetch(input,options);true");await click("mcpIpRefresh");
    await wait(()=>js("document.querySelector('#mcpIpStatus').classList.contains('error')"),"load failure feedback");await screenshot("load-error");
    await js("window.fetch=window.ipOriginalFetch;delete window.ipOriginalFetch");await click("mcpIpRefresh");await wait(()=>js("!document.querySelector('#mcpIpStatus').classList.contains('error')&&!document.querySelector('#mcpIpRefresh').disabled"),"load retry");
    await click("mcpAutoTab");assert.equal(await js("document.querySelector('#mcpAutoPanel').hidden"),false);assert.equal(await js("document.querySelector('#mcpIpPanel').hidden"),true);
    await click("mcpIpTab");report.checks.push("reload retains configuration, visible request error and retry, automatic discovery tab unchanged");

    // Compare the rendered native frame with an existing product alert. This
    // catches browser-default borders even when the data-pe attributes match.
    report.dialogs=[];
    for(const [name,language,width,zoom,dark,scale,palette] of [
      ["wide-en","en",1440,1,false,1,"indigo"],
      ["wide-zh","zh",1440,1,false,1,"indigo"],
      ["narrow-zh","zh",360,1,false,1,"indigo"],
      ["zoom-en","en",1440,2,false,1,"indigo"],
      ["system-dark-graphite-zh","zh",1440,1,true,1,"graphite"],
      ["scale-zh","zh",1000,1,false,1.25,"indigo"],
    ]) {
      window.setSize(width,1000);window.webContents.setZoomFactor(zoom);nativeTheme.themeSource=dark?"dark":"light";
      await js(`document.querySelector('[data-language=${language}]').click();document.querySelector('[data-studio-palette=${palette}]').click();window.PenEchoPageScale.apply(${scale});window.PenEchoMcpSettings.open();window.PenEchoMcpSettings.select('local');document.querySelector('#mcpIpTab').click()`);
      await pause(250);
      for(const [kind,trigger,cancel] of [["Edit","mcpIpEdit","mcpIpEditCancel"],["Rotate","mcpIpRotate","mcpIpRotateCancel"]]) {
        await js(`document.getElementById('${trigger}').focus()`);
        await click(trigger);
        // Native dialogs enter the top layer synchronously; allow the offscreen
        // compositor to paint it before saving visual evidence.
        await pause(200);
        const metrics=await js(`(()=>{
          const dialog=document.getElementById('mcpIp${kind}Dialog'),reference=document.getElementById('historyDeleteDialog');
          const frameKeys=['borderTopWidth','borderTopStyle','borderTopColor','borderRadius','backgroundColor','boxShadow','padding','backdropFilter'];
          const style=node=>Object.fromEntries(frameKeys.map(key=>[key,getComputedStyle(node)[key]]));
          const backdrop=node=>({background:getComputedStyle(node,'::backdrop').backgroundColor,filter:getComputedStyle(node,'::backdrop').backdropFilter});
          const rect=dialog.getBoundingClientRect(),viewport={width:innerWidth,height:innerHeight};
          return {frame:style(dialog),reference:style(reference),backdrop:backdrop(dialog),referenceBackdrop:backdrop(reference),
            interfaceZoom:getComputedStyle(document.documentElement).zoom,systemDark:matchMedia('(prefers-color-scheme: dark)').matches,
            rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},viewport,
            overflow:dialog.scrollWidth>dialog.clientWidth+1,
            buttons:[...dialog.querySelectorAll('button')].map(node=>{const r=node.getBoundingClientRect();return {id:node.id,x:r.x,y:r.y,width:r.width,height:r.height,overflow:node.scrollWidth>node.clientWidth+1};})};
        })()`);
        assert.deepEqual(metrics.frame,metrics.reference,`${kind} frame matches the product alert in ${name}`);
        assert.equal(Number(metrics.interfaceZoom),scale,"requested interface scale is actually rendered");
        assert.equal(metrics.systemDark,dark,"requested OS appearance preference is active");
        assert.deepEqual(metrics.backdrop,metrics.referenceBackdrop,`${kind} scrim matches the product alert in ${name}`);
        assert.ok(Math.abs(parseFloat(metrics.frame.borderTopWidth)*scale-1)<.01,"system hairline border stays thin at the active interface scale");assert.equal(metrics.frame.borderRadius,"12px");
        assert.ok(metrics.rect.width<=440*scale+1&&metrics.rect.x>=0&&metrics.rect.y>=0,`${kind} bounded frame in ${name}`);
        assert.ok(metrics.rect.x+metrics.rect.width<=metrics.viewport.width+1&&metrics.rect.y+metrics.rect.height<=metrics.viewport.height+1,`${kind} fits the viewport in ${name}`);
        assert.equal(metrics.overflow,false,`${kind} has no horizontal overflow in ${name}`);
        for(const control of metrics.buttons) {
          assert.equal(control.overflow,false,`${control.id} label fits in ${name}`);
          assert.ok(control.x>=metrics.rect.x&&control.x+control.width<=metrics.rect.x+metrics.rect.width+1&&control.y+control.height<=metrics.viewport.height+1,`${control.id} remains reachable in ${name}`);
        }
        report.dialogs.push({name,kind,...metrics});await screenshot(`dialog-${kind.toLowerCase()}-${name}`);
        if(name==="wide-en") {
          window.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});window.webContents.sendInputEvent({type:"keyUp",keyCode:"Escape"});
          await wait(()=>js(`!document.getElementById('mcpIp${kind}Dialog').open`),"Escape closes the dialog");
          assert.equal(await js("document.getElementById('settingsLayer').hidden"),false,"Escape keeps the parent Settings surface open");
          assert.equal(await js(`document.activeElement.id`),trigger,"focus returns to the dialog trigger");
        } else await click(cancel);
      }
    }
    assert.equal((await status()).http.ipDirect.accessToken,rotated,"visual checks and dismissals do not rotate the token");
    report.checks.push("both native dialogs match the system alert frame and scrim in English, Chinese, Indigo/Graphite palettes, light/dark OS preference, 360px width, 200 percent browser zoom and 125 percent interface scale; Escape restores focus and buttons fit");
    window.webContents.setZoomFactor(1);await js("window.PenEchoPageScale.apply(1)");
    await js("document.querySelector('[data-language=zh]').click();document.querySelector('#settingsNavMcp').click()");await click("mcpLocalTab");await click("mcpIpTab");
    for(const [name,width,zoom,dark] of [["wide-zh",1440,1,false],["narrow-zh",700,1,false],["zoom-zh",1440,2,false],["dark-zh",1440,1,true]]) {
      window.setSize(width,1000);window.webContents.setZoomFactor(zoom);nativeTheme.themeSource=dark?"dark":"light";await pause(250);
      await js("document.querySelector('#mcpIpPanel').scrollIntoView({block:'start'})");await pause(100);
      // Read-only token inputs intentionally scroll long values internally.
      // Check containment and actionable controls instead of input text width.
      const overflowing=await js("[...document.querySelectorAll('#mcpIpPanel button,#mcpIpPanel .mcp-ip-flow,#mcpIpPanel .mcp-ip-fields,#mcpIpPanel .mcp-ip-token')].filter(e=>e.getBoundingClientRect().width>0&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.className)");assert.deepEqual(overflowing,[],`no overflow in ${name}`);
      assert.equal(await text("mcpIpTab"),"IP 直连");await screenshot(name);
    }
    window.webContents.setZoomFactor(1);window.setSize(1440,1000);nativeTheme.themeSource="light";
    await js("window.ipTestRuntime=window.PENECHO_CONFIG.runtime;window.PENECHO_CONFIG.runtime='cloud';window.PENECHO_REMOTE_CLOUD_STATUS={deviceOnline:true};window.PenEchoMcpSettings.select('local')");
    assert.equal(await js("document.querySelector('#mcpLocalMethods').hidden&&document.querySelector('#mcpIpPanel').hidden&&!document.querySelector('#mcpLocalCloudHelp').hidden"),true);
    await js("window.PENECHO_CONFIG.runtime=window.ipTestRuntime;window.PenEchoMcpSettings.select('local')");
    report.checks.push("Chinese wide/narrow/200 percent zoom/dark rendering without overflow; Cloud runtime keeps local host guidance");
    assert.deepEqual(report.errors,[],"no renderer console errors");report.ok=true;
  } catch(error) {
    report.error=error.stack;process.exitCode=1;
    if(window)fs.writeFileSync(path.join(output,"failure.png"),(await window.webContents.capturePage()).toPNG());
  } finally {
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,dialogs:report.dialogs?.map(({name,kind,rect})=>({name,kind,rect}))},null,2));
    window?.destroy();if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
    await pause(100);fs.rmSync(temporary,{recursive:true,force:true});app.exit(report.ok?0:1);
  }
});
