// Task-owned, loopback-only Chromium renderer for isolated benchmark captures.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-reasoning-renderer-'));
app.setPath('userData',path.join(directory,'profile'));
const port=Number(process.env.PENECHO_REASONING_RENDER_PORT||18096);
let win,server,queue=Promise.resolve();
const cleanup=()=>{server?.close();win?.destroy();fs.rmSync(directory,{recursive:true,force:true});app.quit();};
process.on('SIGTERM',cleanup);process.on('SIGINT',cleanup);
app.whenReady().then(()=>{
 win=new BrowserWindow({show:false,width:1000,height:750,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 server=http.createServer((request,response)=>{
  if(request.method==='GET'&&request.url==='/healthz'){response.end(JSON.stringify({ok:true,purpose:'isolated-reasoning-benchmark'}));return;}
  if(request.method!=='POST'||request.url!=='/render'){response.writeHead(404);response.end();return;}
  let body='';request.on('data',chunk=>{body+=chunk;if(body.length>900000)request.destroy();});
  request.on('end',()=>{
   queue=queue.then(async()=>{
    try{
     const input=JSON.parse(body),width=Math.round(input.width||942),height=Math.round(input.height||551);
     if(typeof input.html!=='string'||width<100||height<100||width>1600||height>1200)throw Error('Invalid isolated render');
     win.setSize(width,height);
     await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(input.html));
     await new Promise(done=>setTimeout(done,80));
     const metrics=await win.webContents.executeJavaScript(`({viewport:{width:innerWidth,height:innerHeight},contentSize:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},horizontalOverflow:document.documentElement.scrollWidth>innerWidth+2,svgCount:document.querySelectorAll('svg').length})`);
     const image=(await win.webContents.capturePage()).toPNG();
     response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({image:image.toString('base64'),mimeType:'image/png',width,height,metrics}));
    }catch(e){response.writeHead(500,{'content-type':'application/json'});response.end(JSON.stringify({error:e.message}));}
   });
  });
 });
 server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({ready:true,port,pid:process.pid})));
});
