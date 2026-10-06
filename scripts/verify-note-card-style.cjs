"use strict";
// Verify canonical card rendering inside the real Canvas with isolated test data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), { Readable } = require("node:stream"), sharp = require("sharp");
const root = path.resolve(__dirname, ".."), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-card-style-"));
const output = path.join(root, "docs/verification/note-card-style-20261004");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, { NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"true", PENECHO_JEVISION_MOCK:"auto" });
const originalRead = fs.createReadStream;
fs.createReadStream = function(file, ...args) {
  if (path.resolve(String(file)) === path.join(root,"public/app.js")) return Readable.from([fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/, `
    window.noteStyleTest={state,canvasDocumentsReady,noteLibraryLoad,noteCardInsert,noteCardUpdate,fitCanvasContents,applyLanguage,applyTheme};
    penIntelRemote=()=>true;
  })();`)]);
  return originalRead.call(this,file,...args);
};
let server, win, preview;
const report = { checks:[] }, pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(check, label) {
  for (let i=0;i<120;i++) { const result=await check(); if(result)return result; await pause(100); }
  throw Error("Timed out: "+label);
}
app.whenReady().then(async()=>{
  try {
    server=require("../server.js");
    await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
    win=new BrowserWindow({show:false,width:1440,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    preview=new BrowserWindow({show:false,width:900,height:1200,useContentSize:true,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    const js=code=>win.webContents.executeJavaScript(code,true);
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await js(`(async()=>{const t=noteStyleTest;await t.canvasDocumentsReady();await t.noteLibraryLoad();t.state.auto=false;t.state.language='zh';t.applyLanguage();t.applyTheme('studio');document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();})()`);
    const source={title:"含时薛定谔方程与叠加态：相位差 Δφ 引起的 |ψ|² 拍频振荡",subtitle:"笔记第一式 · 动态演示",style:"card",category:"formula",language:"zh",tags:["量子力学","薛定谔方程","叠加态","相位差","拍频"],created:1790985600000,blocks:[
      {type:"formula",latex:"i\\hbar\\frac{\\partial\\psi}{\\partial t}=\\hat H\\psi",caption:"笔记第一式 · 含时薛定谔方程"},
      {type:"markdown",text:"叠加态写成两个本征态的组合：$\\psi=c_1\\psi_1+c_2\\psi_2$，频率差 $\\Delta\\omega=(E_2-E_1)/\\hbar=1.50$。示意取值 $\\hbar=1$，$E_1=1.00$，$E_2=2.50$。"},
      {type:"keypoints",title:"推导五步",items:["① 含时薛定谔方程","② 代入本征态","③ 相位匀速旋转","④ 定态：量不变","⑤ 动态演示：叠加态"]},
      {type:"graph",expression:"y = sin(x)^2",caption:"概率密度示意"}
    ]};
    await js(`(async()=>{const t=noteStyleTest;await t.noteCardInsert(${JSON.stringify(source)});t.fitCanvasContents();})()`);
    await until(()=>js("noteStyleTest.state.widgets[0]?.mcpDocumentLoaded===true"),"card frame load");
    const cardFrame = async () => {
      for(const frame of win.webContents.mainFrame.framesInSubtree.filter(f=>f.url==='about:srcdoc')){
        try { if(await frame.executeJavaScript("!!document.querySelector('.nc')")) return frame; } catch {}
      }
      return null;
    };
    let frame=await until(cardFrame,"card document");
    const inspect=()=>frame.executeJavaScript(`(()=>{const title=document.querySelector('.nc-title'),head=document.querySelector('.nc-head'),style=getComputedStyle(title);return {title:title.textContent,size:style.fontSize,family:style.fontFamily,padding:getComputedStyle(head).padding,titleDecoration:getComputedStyle(title,'::after').content,subtitle:!!document.querySelector('.nc-sub'),category:document.querySelector('.nc-chip').textContent,kind:document.querySelector('.nc-kind').textContent,bodyScrollable:document.querySelector('.nc-body').scrollHeight>document.querySelector('.nc-body').clientHeight,formula:document.querySelector('figcaption').textContent};})()`);
    report.card=await inspect();
    assert.equal(report.card.size,"50px");
    assert.equal(report.card.subtitle,false);
    assert.equal(report.card.titleDecoration,"none");
    assert.equal(report.card.title,source.title);
    assert.equal(report.card.padding,"50px 64px 16px");
    assert.match(report.card.family,/Songti SC/);
    assert.equal(report.card.formula,source.blocks[0].caption);
    report.shell=await js(`(()=>{const s=getComputedStyle(document.querySelector('.canvas-note-card'));return {shadow:s.boxShadow,radius:s.borderRadius,selected:document.querySelector('.canvas-note-card').classList.contains('is-selected')};})()`);
    assert.equal(report.shell.selected,false);
    assert.equal(report.shell.radius,"36px");
    assert.equal(report.shell.shadow,"rgba(24, 31, 45, 0.05) 0px 1px 3px 0px, rgba(24, 31, 45, 0.19) 0px 8px 18px -12px");
    const saved=await js("JSON.parse(noteStyleTest.state.widgets[0].copyText)");
    assert.equal(saved.subtitle,source.subtitle);
    assert.deepEqual(saved.blocks.map(b=>b.type),source.blocks.map(b=>b.type));
    await pause(300);
    fs.writeFileSync(path.join(output,"implemented-card.png"),(await win.webContents.capturePage()).toPNG());
    report.checks.push("Knowledge card uses B's soft shadow and a 50px serif title, with original header padding/radius and no subtitle row; source subtitle and all blocks are retained.");
    const checkAccent = async (name, style, accent) => {
      const scrollTop=await frame.executeJavaScript("document.querySelector('.nc-body').scrollTop");
      await preview.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(await frame.executeJavaScript("document.documentElement.outerHTML")));
      await preview.webContents.executeJavaScript("document.fonts.ready");
      await preview.webContents.executeJavaScript(`document.querySelector('.nc-body').scrollTop=${scrollTop}`);
      await pause(150);
      const png=(await preview.webContents.capturePage()).toPNG();
      fs.writeFileSync(path.join(output,name+".png"),png);
      const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true}), scale=info.width/900;
      const expected=accent.match(/[a-f0-9]{2}/gi).map(value=>parseInt(value,16));
      let samples=0;
      for(let along=40;along<(style==="note"?1160:860);along++){
        const x=Math.floor((style==="note"?4:along)*scale), y=Math.floor((style==="note"?along:4)*scale), offset=(y*info.width+x)*info.channels;
        for(let channel=0;channel<3;channel++)assert.ok(Math.abs(data[offset+channel]-expected[channel])<=1,`${name}: interrupted accent at ${x},${y}`);
        samples++;
      }
      return {samples,width:info.width,height:info.height};
    };
    report.card.accent=await checkAccent("knowledge-card","card",saved.category.color);
    report.workNotes=[];
    for(const category of ["idea","work","meeting","todo"]){
      await js(`void noteStyleTest.noteCardUpdate(noteStyleTest.state.widgets[0],n=>{n.style='note';n.styleChosen=true;n.category=PENECHO_NOTE_CARD.normalizeCategory(${JSON.stringify(category)},{language:n.language});n.subtitle='Everyday situations used when meeting someone';});`);
      await until(async()=>{frame=await cardFrame();if(!frame)return false;try{return await frame.executeJavaScript(`document.querySelector('.nc')?.dataset.category===${JSON.stringify(category)}`)}catch{return false;}},category+" note rerender");
      const note=await inspect();
      assert.equal(note.size,"46px");
      assert.equal(note.subtitle,false);
      note.paper=await frame.executeJavaScript("(()=>{const nc=document.querySelector('.nc'),b=document.querySelector('.nc-body');return {background:getComputedStyle(b).backgroundImage,headBorder:getComputedStyle(document.querySelector('.nc-head')).borderBottomWidth,footBorder:getComputedStyle(document.querySelector('.nc-foot')).borderTopWidth,accent:getComputedStyle(nc).getPropertyValue('--accent').trim(),pointerEvents:getComputedStyle(nc,'::before').pointerEvents}})()");
      assert.equal(note.paper.background,"none");
      assert.equal(note.paper.headBorder,"0px");
      assert.equal(note.paper.footBorder,"0px");
      assert.equal(note.paper.pointerEvents,"none");
      note.accent=await checkAccent(category,"note",note.paper.accent);
      await frame.executeJavaScript("document.querySelector('.nc-body').scrollTop=300");
      note.scrolledAccent=await checkAccent(category+"-scrolled","note",note.paper.accent);
      const retained=await js("JSON.parse(noteStyleTest.state.widgets[0].copyText)");
      assert.equal(retained.subtitle,"Everyday situations used when meeting someone");
      assert.deepEqual(retained.blocks.map(b=>b.type),source.blocks.map(b=>b.type));
      report.workNotes.push({category,...note});
    }
    fs.writeFileSync(path.join(output,"canvas-work-note.png"),(await win.webContents.capturePage()).toPNG());
    report.checks.push("Idea, Work, Meeting and To-do show plain paper without a subtitle or header/footer rules; saved context and content are retained.");
    report.checks.push("Pixel checks confirm continuous note spines before and after body scrolling and a continuous knowledge-card top accent.");
    console.log(JSON.stringify(report,null,2));
  } catch(error) {report.failure=error.stack;console.error(error);} finally {
    fs.writeFileSync(path.join(output,"implemented-card-report.json"),JSON.stringify(report,null,2)+"\n");
    win?.destroy();
    preview?.destroy();
    if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
    fs.rmSync(temporary,{recursive:true,force:true});
    app.exit(report.failure?1:0);
  }
});
