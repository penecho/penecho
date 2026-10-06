"use strict";
// Real Canvas pixel acceptance with synthetic ink and intercepted model calls.
// Run with tools/electron/node_modules/.bin/electron.
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{Readable}=require("node:stream"),sharp=require("sharp");
const root=path.resolve(__dirname,".."),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-suggest-dirty-"));
const cloud=process.argv.includes("--cloud"),clientFile=cloud?path.resolve(root,"../penecho_cloud/public/canvas/app.js"):path.join(root,"public/app.js");
const output=process.argv.find(value=>value.startsWith("--output="));
const directory=output?path.resolve(output.slice(9)):temporary;
fs.mkdirSync(directory,{recursive:true});
app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test-only",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(clientFile,"utf8").replace(/\}\)\(\);\s*$/,`
    if(${cloud})window.PENECHO_CONFIG.runtime='cloud';
    window.dirtyTest={state,smartSuggest,canvasDocumentsReady,smartSuggestCluster,smartSuggestCropRegion,smartSuggestCrop,smartSuggestRecordStroke,runSmartSuggest,stroke,recomputeDirtyBounds,clearDirtyContributionTracking,offscreen,render};
    window.dirtyRequests=[];
    const originalFetch=window.fetch;
    window.fetch=(url,options)=>{
      if(url===${JSON.stringify(cloud?"/api/v1/apps/penecho-llm/suggest":"/api/suggest")}){
        dirtyRequests.push(JSON.parse(options.body));
        return Promise.resolve(new Response(JSON.stringify({ok:true,model:'PenEchoLLM',answers:{kind:{choice:'notes',probabilities:{notes:1}},action:{choice:'organize',probabilities:{organize:1}},finished:{noul:1}}}),{status:200,headers:{'Content-Type':'application/json'}}));
      }
      return originalFetch(url,options);
    };
  })();`)]);
  return readStream.call(this,file,...args);
};
let server,win;
const report={directory,runtime:cloud?'cloud':'local',clientFile,checks:[],errors:[]};
app.whenReady().then(async()=>{
  try{
    server=require("../server.js");
    await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on("console-message",(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const t=dirtyTest,s=t.state,a=t.smartSuggest;
      await t.canvasDocumentsReady();
      document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
      s.auto=false;s.mode='pen';s.scale=1;s.panX=0;s.panY=0;
      a.enabled=true;a.available=true;
      // Synchronize before recording synthetic strokes, just as pointerdown does.
      t.smartSuggestCluster();await t.runSmartSuggest();
      const add=(pairs,at)=>{
        const points=pairs.map(([x,y])=>({x,y})),entry={};s.history.push(entry);
        for(let i=1;i<points.length;i++)t.stroke(points[i-1],points[i],false,8,true,'#111827');
        const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);
        t.smartSuggestRecordStroke({id:a.nextStrokeId++,points,box:{x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y},at,size:8,historyEntry:entry});
      };
      const captures={};
      const capture=name=>{const cluster=t.smartSuggestCluster(),region=t.smartSuggestCropRegion(cluster);captures[name]={image:t.smartSuggestCrop(cluster,region),region};return captures[name];};
      add([[100,100],[100,200],[100,165],[125,150],[145,170],[145,200]],1000);
      add([[205,180],[170,180],[170,162],[193,155],[207,166],[199,180],[171,180],[179,200],[205,200]],1100);
      add([[233,100],[222,190],[231,201],[248,196]],1200);
      add([[270,100],[260,190],[270,201],[286,196]],1300);
      add([[312,159],[295,168],[295,190],[310,202],[332,194],[337,175],[326,159],[312,159]],1400);
      // A clean mark is context only, even when it lies within dirty bounds.
      t.stroke({x:120,y:130},{x:180,y:130},false,6,false,'#111827');
      const before=capture('before-rank');
      await t.runSmartSuggest();
      const after=capture('after-rank');
      const rankingPreservesDirty=before.image===after.image&&Boolean(s.dirty)&&s.dirtyInkTiles.size>0;
      // A later writing unit is distant in both time and space.
      add([[130,610],[130,500],[175,500]],60000);
      add([[100,555],[168,555]],60100);
      add([[250,500],[190,500],[235,555],[190,610],[255,610]],60200);
      add([[300,515],[340,595]],60300);add([[340,515],[300,595]],60400);
      const long=capture('whole-dirty');await t.runSmartSuggest();
      const gesture={box:{x:130,y:555,w:38,h:2},strokes:[],recentIds:new Set()};
      const gestureRegion=t.smartSuggestCropRegion(gesture);
      captures.gesture={image:t.smartSuggestCrop(gesture,gestureRegion),region:gestureRegion};
      // Simulate another line arriving during asynchronous snapshot preparation.
      const staleRegion={...long.region};
      add([[900,1100],[1020,1100],[1020,1160]],61000);
      const expanded={x:Math.min(staleRegion.x,s.dirty.x),y:Math.min(staleRegion.y,s.dirty.y)};
      expanded.w=Math.max(staleRegion.x+staleRegion.w,s.dirty.x+s.dirty.w)-expanded.x;
      expanded.h=Math.max(staleRegion.y+staleRegion.h,s.dirty.y+s.dirty.h)-expanded.y;
      captures['late-dirty']={image:t.smartSuggestCrop(t.smartSuggestCluster(),staleRegion),region:expanded};
      // Neither of the bounded in-memory logs retains hello after this.
      for(let i=0;i<80;i++)add([[900,1100+i*.25],[1020,1100+i*.25]],62000+i*100);
      s.history.splice(0,s.history.length-30);
      capture('evicted-history');
      const retainedVectors=a.strokes.length,oldestVectorY=Math.min(...a.strokes.map(v=>v.box.y));
      // Stale vector records must not redraw an erased portion of the h.
      t.stroke({x:100,y:108},{x:100,y:152},true,24,true);
      t.recomputeDirtyBounds();
      captures.erased={image:t.smartSuggestCrop({box:before.region},before.region,false),region:before.region};
      // A manually bounded route does not expand to unrelated dirty input.
      const scoped={x:850,y:1050,w:230,h:150};
      captures.scoped={image:t.smartSuggestCrop({box:scoped},scoped,false),region:scoped};
      // An explicit lasso remains authoritative over dirty input elsewhere.
      const selected=t.offscreen(40,30),q=selected.getContext('2d');q.fillStyle='#111827';q.fillRect(0,0,40,30);
      const selection={phase:'active',originalBox:{x:900,y:1100,w:40,h:30},box:{x:900,y:1100,w:40,h:30},fragments:[{x:900,y:1100,w:40,h:30,image:selected}]};
      captures.selection={image:t.smartSuggestCrop({selection}),region:selection.box};
      t.clearDirtyContributionTracking();s.dirty=null;
      captures.clean={image:t.smartSuggestCrop({box:before.region},before.region,false),region:before.region};
      a.available=false;
      return {captures,rankingPreservesDirty,retainedVectors,oldestVectorY,requests:dirtyRequests.map(r=>({mode:r.mode,image:r.image}))};
    })()`,true);
    assert.equal(result.rankingPreservesDirty,true,"LLM completion preserves its submitted dirty pixels and bounds");
    assert.equal(result.retainedVectors,64);assert.ok(result.oldestVectorY>1000);
    const darkPixels=async(capture,box)=>{
      const {data,info}=await sharp(Buffer.from(capture.image.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});
      let dark=0,gray=0;const r=capture.region,sx=info.width/r.w,sy=info.height/r.h;
      for(let y=Math.max(0,Math.floor((box.y-r.y)*sy));y<Math.min(info.height,Math.ceil((box.y+box.h-r.y)*sy));y++)for(let x=Math.max(0,Math.floor((box.x-r.x)*sx));x<Math.min(info.width,Math.ceil((box.x+box.w-r.x)*sx));x++){
        const i=(y*info.width+x)*info.channels;if(data[i]<75&&data[i+1]<75&&data[i+2]<75)dark++;
        else if(data[i]>90&&data[i]<160&&data[i+1]>90&&data[i+1]<160)gray++;
      }
      return {dark,gray};
    };
    const hello={x:90,y:95,w:260,h:112};
    report.pixels={};
    for(const [name,capture]of Object.entries(result.captures)){
      const bytes=Buffer.from(capture.image.split(',')[1],'base64'),meta=await sharp(bytes).metadata();
      assert.ok(meta.width<=512&&meta.height<=512&&capture.image.length<=256*1024);
      fs.writeFileSync(path.join(directory,name+'.webp'),bytes);
      report.pixels[name]={region:capture.region,width:meta.width,height:meta.height,...await darkPixels(capture,hello)};
    }
    assert.ok(report.pixels['before-rank'].dark>100,'pending hello is emphasized before ranking');
    assert.equal(report.pixels['after-rank'].dark,report.pixels['before-rank'].dark,'ranked hello remains pending input');
    for(const name of ['whole-dirty','gesture','late-dirty','evicted-history'])assert.ok(report.pixels[name].dark>0,name+': unprocessed hello remains dirty across new input and cache eviction');
    const erased=await darkPixels(result.captures.erased,{x:95,y:115,w:10,h:27});assert.equal(erased.dark,0,"erased ink cannot reappear from vector history");
    assert.equal(report.pixels.clean.dark,0,"clearing actual dirty state removes emphasis");
    assert.ok(report.pixels.clean.gray>100,"clean ink is retained as context");
    assert.equal(report.pixels.scoped.width,230);assert.equal(report.pixels.scoped.height,150);
    assert.equal(report.pixels.selection.width,40);assert.equal(report.pixels.selection.height,30);
    assert.equal(result.requests.length,2);
    assert.equal(result.requests[1].image,result.captures['whole-dirty'].image,"the actual request contains the verified complete image");
    assert.deepEqual(report.errors,[]);
    report.checks.push('Ranking preserves all submitted dirty pixels and bounds','Later requests include all unprocessed input','Gesture classification includes all pending ink','New dirty input after snapshot preparation is included','Viewport, 64-stroke and 30-history limits do not clip pending dirty input','Erased raster pixels are never reconstructed','Manual routes and masked selections retain scope','Clean source remains readable context','Actual POST payload matches the verified image');
  }finally{
    win?.destroy();server?.closeAllConnections?.();if(server)await new Promise(resolve=>server.close(resolve));report.serverClosed=!server?.listening;
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report));
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
