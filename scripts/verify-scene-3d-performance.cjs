"use strict";
// Verify the real Zdog runtime at high DPI without touching user documents.
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),directory=path.join(root,"docs/verification/graph-animation-performance-20261005"),
  profile=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-scene-3d-")),report={samples:[],checks:[],errors:[]};
app.setPath("userData",profile);app.commandLine.appendSwitch("force-device-scale-factor","2");
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),read=file=>fs.readFileSync(path.join(root,file),"utf8").replace(/<\/script/gi,"<\\/script"),
  SCENE=require("../public/scene-spec.js"),scene=SCENE.normalize({engine:"3d",size:[960,640],spin:[0,20,0],shapes:Array.from({length:12},(_,i)=>({id:`box-${i}`,type:"box",width:70,height:70,depth:70,translate:[(i%4-1.5)*120,(Math.floor(i/4)-1)*120,0]}))});
let win;
app.whenReady().then(async()=>{
  try {
    win=new BrowserWindow({show:false,width:960,height:640,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on("console-message",event=>{if(event.level==="error")report.errors.push(event.message);});
    const js=code=>win.webContents.executeJavaScript(code,true);
    for(const before of [true,false]) {
      const runtime=read(before?"docs/verification/graph-animation-performance-20261005/scene-runtime-before.js":"public/scene-runtime.js"),
        html=`<!doctype html><html lang="en"><style>html,body{margin:0;width:100%;height:100%}#penecho-scene{position:relative;width:100%;height:100%;overflow:hidden}.pes-controls{position:absolute;bottom:10px;left:10px;display:flex}.pes-controls button{width:40px;height:40px}.pes-controls svg{width:20px;height:20px}</style><div id="penecho-scene"></div><script type="application/json" data-penecho-scene>${JSON.stringify(scene)}</script><script>${read("public/scene-spec.js")}</script><script>${read("public/vendor/scene/zdog-1.1.3.dist.min.js")}</script><script>
        const Illustration=Zdog.Illustration;window.sceneAudit={times:[],sizes:0};
        Zdog.Illustration=function(options){const illo=new Illustration(options);sceneAudit.illo=illo;const render=illo.updateRenderGraph.bind(illo),setSize=illo.setSize.bind(illo);
          illo.updateRenderGraph=()=>{const started=performance.now();render();sceneAudit.times.push(performance.now()-started);};
          illo.setSize=(...args)=>{sceneAudit.sizes++;return setSize(...args);};return illo;};
        </script><script>${runtime}</script></html>`;
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      for(const [label,width,height] of [["inline",960,640],["maximized",1920,1200]]) {
        win.setContentSize(width,height);await pause(200);await js("sceneAudit.times=[]");await pause(500);
        const sample=await js(`(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),a=sceneAudit,mean=a.times.reduce((s,v)=>s+v,0)/(a.times.length||1);return {dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],css:[r.width,r.height],backing:[c.width,c.height],logical:[a.illo.width,a.illo.height],zoom:a.illo.zoom,meanRenderMs:mean,frames:a.times.length,angle:a.illo.rotate.y,errors:[...document.querySelectorAll('[role=alert]')].map(n=>n.textContent)}})()`);
        report.samples.push({before,label,...sample});assert.deepEqual(sample.errors,[]);assert.ok(sample.frames>5);
        if(!before) {
          assert.deepEqual(sample.css,sample.viewport);assert.deepEqual(sample.logical,sample.viewport);
          assert.deepEqual(sample.backing,sample.viewport.map(v=>v*sample.dpr));
          const angle=sample.angle;await js("document.querySelector('[aria-label=Pause]').click()");await pause(80);
          const paused=await js("sceneAudit.illo.rotate.y");await pause(100);assert.equal(await js("sceneAudit.illo.rotate.y"),paused);
          assert.ok(Math.abs(paused-angle)<.1);await js("document.querySelector('[aria-label=Replay]').click()");await pause(80);
          assert.ok(Math.abs(await js("sceneAudit.illo.rotate.y")-scene.view[1]*Math.PI/180)<.1);
          const sizes=await js("sceneAudit.sizes");await js("dispatchEvent(new Event('resize'))");await pause(80);assert.equal(await js("sceneAudit.sizes"),sizes,"unchanged resize must not reallocate the canvas");
        }
        if(label==="maximized")fs.writeFileSync(path.join(directory,`scene-3d-${before?"before":"after"}.png`),(await win.webContents.capturePage()).toPNG());
      }
    }
    report.checks.push("3D scenes use CSS dimensions once and allocate exactly DPR-scaled backing pixels at inline and maximized sizes","Playback, pause and replay remain live; unchanged resize avoids canvas reallocation");
    assert.deepEqual(report.errors,[]);report.ok=true;
  }catch(error){report.failure=error.stack||String(error);}
  finally {win?.destroy();fs.rmSync(profile,{recursive:true,force:true});fs.writeFileSync(path.join(directory,"scene-3d.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.ok?0:1);}
});
