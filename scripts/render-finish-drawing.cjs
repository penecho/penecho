// Render saved model outputs with PenEcho's actual Canvas drawing runtime.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),sharp=require('sharp');
const root=path.resolve(__dirname,'..'),output=path.resolve(root,process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'docs/verification/finish-drawing-20261002');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-finish-drawing-render-'));
app.setPath('userData',profile);
const inputs=process.argv.find(a=>a.startsWith('--inputs='))?.slice(9).split(',')||['pilot','extended','structure'];
const labels={cat:'猫脸：补下轮廓',sailboat:'帆船：补船身',mug:'杯子：补底部',flower:'花朵：补花瓣'};
const rows=[];
for(const name of inputs){const dir=path.join(output,name);if(!fs.existsSync(path.join(dir,'results.json')))continue;for(const row of JSON.parse(fs.readFileSync(path.join(dir,'results.json'),'utf8')).samples||[])if(row.result&&!row.error)rows.push({...row,dir});}
let win;
app.whenReady().then(async()=>{
 try{
  win=new BrowserWindow({show:false,width:640,height:480,webPreferences:{contextIsolation:true,nodeIntegration:false,offscreen:true}});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  await win.loadURL('data:text/html,<html><body></body></html>');
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'public/draw.js'),'utf8'));
  for(const row of rows){
   if(row.invalid)continue;
   const source='data:image/png;base64,'+fs.readFileSync(path.join(row.dir,`${row.case}-source.png`)).toString('base64');
   for(const [kind,color] of [['result','#263443'],['overlay','#008f85']]){
    const payload={source,commands:row.result.commands,color};
    const image=await win.webContents.executeJavaScript(`(async()=>{
      const input=${JSON.stringify(payload)},canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const ctx=canvas.getContext('2d'),source=new Image();source.src=input.source;await source.decode();ctx.drawImage(source,0,0);
      for(const command of input.commands){if(command.tool!=='draw')continue;const made=window.PENECHO_DRAW.render(command,(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;},input.color);if(!made)throw Error('Invalid native draw');ctx.drawImage(made.image,made.x-8000,made.y-5000,made.image.logicalWidth,made.image.logicalHeight);}
      return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    fs.writeFileSync(path.join(row.dir,`${row.id}-${kind}.png`),Buffer.from(image,'base64'));
   }
  }
  for(const model of [...new Set(rows.map(r=>r.model))]){
   const cases=['cat','sailboat','mug','flower'].filter(id=>rows.some(r=>r.model===model&&r.case===id));
   for(const kind of ['overlay','result']){
    const variantNames=['baseline','contour','vectors','structure','integrated'].filter(variant=>rows.some(r=>r.variant===variant));
    const tileW=320,tileH=280,labelH=30,headerH=40,width=tileW*(variantNames.length+1),height=headerH+cases.length*(tileH+labelH),layers=[];
    const variantLabels={baseline:'当前提示',contour:'加强轮廓提示',vectors:'轮廓提示＋笔画坐标',structure:'整体结构＋坐标',integrated:'正式接入提示＋坐标'},titles=['原始输入',...variantNames.map(variant=>variantLabels[variant])];
    layers.push({input:Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f4f6f8"/>${titles.map((t,i)=>`<text x="${i*tileW+12}" y="27" font-size="18" fill="#253047">${t}</text>`).join('')}</svg>`),left:0,top:0});
    for(let i=0;i<cases.length;i++){
     const id=cases[i],samples=rows.filter(r=>r.model===model&&r.case===id),label=`${model==='glm'?'GLM Flash':'DeepSeek Vision'} · ${labels[id]}`;
     layers.push({input:Buffer.from(`<svg width="${width}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><text x="12" y="21" font-size="15" fill="#253047">${label}</text></svg>`),left:0,top:headerH+i*(tileH+labelH)});
     for(let j=0;j<=variantNames.length;j++){
      const sample=j?samples.find(r=>r.variant===variantNames[j-1]):samples[0];if(!sample)continue;
      const file=path.join(sample.dir,j&&!sample.invalid?`${sample.id}-${kind}.png`:`${id}-source.png`);
      let image=await sharp(file).extract({left:120,top:95,width:400,height:385}).resize(tileW,tileH,{fit:'contain',background:'#fff'}).png().toBuffer();
      if(j&&sample.invalid)image=await sharp(image).composite([{input:Buffer.from('<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="210" width="320" height="30" fill="#fff0ee"/><text x="10" y="231" font-size="14" fill="#b42d24">首轮格式错误，未渲染补画</text></svg>'),left:0,top:0}]).png().toBuffer();
      layers.push({input:image,left:j*tileW,top:headerH+i*(tileH+labelH)+labelH});
     }
    }
    fs.writeFileSync(path.join(output,`${model}-comparison-${kind}.png`),await sharp({create:{width,height,channels:4,background:'#fff'}}).composite(layers).png().toBuffer());
   }
  }
  const rendered=rows.filter(r=>!r.invalid).length;
  fs.writeFileSync(path.join(output,'render-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),renderer:'public/draw.js PENECHO_DRAW.render in Electron Chromium',rendered,invalid:rows.length-rendered,network:'blocked',sourcePreservedByCompositing:true},null,2)+'\n');
  console.log(JSON.stringify({rendered,invalid:rows.length-rendered,models:[...new Set(rows.map(r=>r.model))],output}));
 }catch(e){console.error(e);process.exitCode=1;}
 finally{win?.destroy();fs.rmSync(profile,{recursive:true,force:true});app.quit();}
});
