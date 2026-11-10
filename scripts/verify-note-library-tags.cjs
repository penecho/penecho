"use strict";
// Exercise the canonical client and local Notes API with synthetic data only.
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict"),{Readable}=require("node:stream");
const root=path.resolve(__dirname,".."),output=path.join(root,"docs/verification/note-library-cascade-20261004"),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-note-tags-"));
fs.mkdirSync(output,{recursive:true});app.setPath("userData",path.join(temporary,"profile"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(temporary,"state"),PENECHO_CONFIG_FILE:path.join(temporary,"config.env"),HOST:"127.0.0.1",PORT:"0",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false"});
const readStream=fs.createReadStream;
fs.createReadStream=function(file,...args){
  if(path.resolve(String(file))===path.join(root,"public/app.js"))return Readable.from([fs.readFileSync(file,"utf8").replace(/\}\)\(\);\s*$/,`
    window.noteTagTest={state,noteCards,canvasDocumentsReady,noteLibraryLoad,noteLibraryPut,noteLibraryPersist,noteLibraryRender,openNoteLibrary,closeNoteLibrary,noteReviewStop,applyLanguage,applyTheme,applyStudioPalette,applyPageScale};
  })();`)]);
  return readStream.call(this,file,...args);
};
const report={checkedAt:new Date().toISOString(),checks:[],layouts:[],errors:[],requests:[]},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let server,win;
async function until(check,label){for(let n=0;n<100;n++){if(await check())return;await pause(100);}throw Error(`Timed out: ${label}`);}
app.whenReady().then(async()=>{try{
  server=require("../server.js");await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));
  const visible=process.argv.includes("--visible");
  win=new BrowserWindow({show:visible,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:!visible}});
  win.webContents.on("console-message",event=>{if(event.level==="error")report.errors.push(event.message);});
  win.webContents.session.webRequest.onCompleted(details=>{
    const url=new URL(details.url);if(url.pathname==="/api/notes"||url.pathname==="/api/suggest")report.requests.push({path:url.pathname,query:Object.fromEntries(url.searchParams),status:details.statusCode});
  });
  const js=code=>win.webContents.executeJavaScript(code,true),ids=()=>js("[...noteTagTest.noteCards.panel.grid.querySelectorAll('.note-tile')].map(tile=>tile.dataset.noteId)"),
    settled=()=>until(()=>js("Boolean(noteTagTest.noteCards.panel&&!noteTagTest.noteCards.panel.page.pending)"),"page settled"),
    click=async(selector)=>{assert.equal(await js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),true,selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await settled();},
    shot=async name=>{await js("document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click()");await pause(250);assert.equal(await js("document.querySelector('#changelogLayer').hidden"),true);fs.writeFileSync(path.join(output,`${name}.png`),(await win.webContents.capturePage()).toPNG());};
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await js(`(async()=>{const t=noteTagTest;await t.canvasDocumentsReady();await t.noteLibraryLoad();t.state.auto=false;t.state.language='en';t.applyLanguage();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();const now=Date.now();for(let i=0;i<30;i++)t.noteLibraryPut(PENECHO_NOTE_CARD.libraryEntry({id:'card-'+String(i).padStart(2,'0'),createdAt:now-(30-i)*60000,updatedAt:now-i*60000,note:{title:'Derivative methods '+String(i).padStart(2,'0'),category:i<15?'concept':'idea',style:'card',bookmarked:i%7===0,tags:i===29?['Archive','跨页标签']:i%2===0?['Research','微积分']:['Basics'],blocks:[{type:'markdown',text:'## Chain rule\\nA saved knowledge card with complete source.'},{type:'formula',latex:'(f\\\\circ g)^{\\\\prime}(x)=f^{\\\\prime}(g(x))g^{\\\\prime}(x)'}]}}));await t.noteLibraryPersist();await t.openNoteLibrary();})()`);
  await settled();assert.equal(await js("noteTagTest.noteCards.panel.sort.value"),"recent");
  assert.equal(await js("noteTagTest.noteCards.panel.sort.selectedOptions[0].textContent"),"Recently edited");
  assert.deepEqual(await ids(),Array.from({length:12},(_,i)=>`card-${String(i).padStart(2,'0')}`));
  assert.equal(await js("noteTagTest.noteCards.panel.input===document.activeElement"),false);
  assert.equal(await js("document.querySelector('[data-tag-id=archive] small').textContent"),'1');
  assert.equal(await js("noteTagTest.noteCards.panel.categorySidebar.nextElementSibling===noteTagTest.noteCards.panel.tagSidebar"),true);
  report.checks.push("Opening defaults to Recently edited, requests one page, leaves search unfocused and lists tags found only beyond that page.");
  await shot('wide-recent');
  await click('[data-category-id="concept"]');
  assert.deepEqual(await js("noteTagTest.noteCards.panel.page.tags.map(tag=>tag.id)"),['basics','research','微积分']);
  assert.equal(await js("document.querySelector('[data-tag-id=archive]')===null"),true);
  assert.equal(await js("document.querySelector('[data-tag-id=research] small').textContent"),'8');
  assert.equal(await js("document.querySelector('[data-tag-id=\"\"] small').textContent"),'15');
  await shot('wide-category-first');await click('[data-tag-id="research"]');
  assert.deepEqual(await ids(),Array.from({length:8},(_,i)=>`card-${String(i*2).padStart(2,'0')}`));
  assert.equal(await js("document.querySelector('[data-tag-id=research]').getAttribute('aria-pressed')"),'true');
  assert.equal(await js("document.querySelector('[data-category-id=concept] small').textContent"),'8');
  assert.equal(await js("document.querySelector('[data-category-id=idea] small').textContent"),'7');
  assert.equal(await js("document.querySelector('[data-category-id=\"\"] small').textContent"),'15');
  await shot('wide-combined');
  await click('.note-library-review');
  await until(()=>js("Boolean(noteTagTest.noteCards.review)"),"review queue ready");
  assert.equal(await js("noteTagTest.noteCards.review.filter.tag"),'research');
  assert.equal(await js("noteTagTest.noteCards.review.queue.every(id=>{const n=noteTagTest.noteCards.entries.find(e=>e.id===id).note;return n.category.id==='concept'&&n.tags.includes('Research');})"),true);
  await js("noteTagTest.noteReviewStop()");await settled();
  await js("noteTagTest.noteCards.panel.input.value='14';noteTagTest.noteCards.panel.input.dispatchEvent(new Event('input'))");await pause(200);await settled();
  await click('.note-library-filters .note-filter');assert.deepEqual(await ids(),['card-14']);
  await click('.note-library-filters .note-filter');
  await js("noteTagTest.noteCards.panel.input.value='NoSuchDerivative';noteTagTest.noteCards.panel.input.dispatchEvent(new Event('input'))");await pause(200);await settled();
  assert.deepEqual(await ids(),[]);
  assert.equal(await js("document.querySelector('.note-library-empty strong').textContent"),'No matching cards');
  await js("noteTagTest.noteCards.panel.input.value='';noteTagTest.noteCards.panel.input.dispatchEvent(new Event('input'))");await pause(200);await settled();
  await click('[data-category-id=""]');
  assert.equal(await js("noteTagTest.noteCards.panel.tag"),'research');
  assert.equal(await js("document.querySelector('[data-tag-id=research] small').textContent"),'15');
  await click('[data-tag-id="archive"]');assert.deepEqual(await ids(),['card-29']);
  assert.deepEqual(await js("[...document.querySelectorAll('.note-category-nav:not(.note-tag-nav) [data-category-id]')].map(button=>button.dataset.categoryId)"),['','idea']);
  await shot('wide-tag-first');await click('[data-category-id="idea"]');
  assert.equal(await js("document.querySelector('[data-tag-id=research] small').textContent"),'7');
  assert.equal(await js("document.querySelector('[data-tag-id=\"\"] small').textContent"),'15');
  assert.deepEqual(await ids(),['card-29']);await shot('wide-reverse-combined');
  await click('[data-category-id=""]');assert.deepEqual(await ids(),['card-29']);
  assert.equal(await js("noteTagTest.noteCards.panel.tag"),'archive');
  await click('[data-tag-id="archive"]');assert.equal(await js("noteTagTest.noteCards.panel.tag"),'');assert.equal((await ids()).length,12);
  await click('[data-category-id="concept"]');await click('[data-tag-id="research"]');await click('[data-tag-id=""]');
  assert.equal(await js("noteTagTest.noteCards.panel.category"),'concept');assert.equal((await ids()).length,12);
  assert.equal(await js("document.querySelector('[data-category-id=concept] small').textContent"),'15');
  assert.equal(await js("document.querySelector('[data-tag-id=archive]')===null"),true);
  await click('[data-category-id=""]');assert.equal(await js("document.querySelector('[data-tag-id=archive] small').textContent"),'1');
  report.checks.push("Category-first filtering narrows the tag list and counts; tag-first filtering narrows categories. Combining them preserves valid alternatives within the opposite condition, and each clear operation expands the opposite list. Search, bookmark and review retain the combination.");
  await js("(async()=>{const t=noteTagTest;t.closeNoteLibrary({library:true});const entry=t.noteCards.entries.find(e=>e.id==='card-29');entry.updatedAt=Date.now()+1000;t.noteLibraryPut(entry);await t.noteLibraryPersist();await t.openNoteLibrary();})()");
  await settled();assert.equal((await ids())[0],'card-29');report.checks.push("Editing an older card moves it to the top on the next library read.");
  for(const [name,width,language,palette,zoom,scale] of [['narrow-en',390,'en','indigo',1,1],['narrow-zh',390,'zh','indigo',1,1],['zoom-200',1440,'en','indigo',2,1],['scale-125',1024,'en','indigo',1,1.25],['graphite',1440,'en','graphite',1,1]]){
    win.webContents.setZoomFactor(zoom);win.setContentSize(width,1000);
    await js(`(async()=>{const t=noteTagTest;t.closeNoteLibrary({library:true});t.state.language=${JSON.stringify(language)};t.applyLanguage();t.applyTheme('studio');t.applyStudioPalette(${JSON.stringify(palette)});t.applyPageScale(${scale});await t.openNoteLibrary();})()`);await settled();
    await click('[data-category-id="concept"]');await click('[data-tag-id="research"]');
    const tagScroll=await js("(()=>{const t=noteTagTest,nav=t.noteCards.panel.tagNav;nav.querySelector('[aria-pressed=true]').scrollIntoView({block:'nearest',inline:'nearest'});const before=nav.scrollLeft;t.noteLibraryRender();return {before,after:nav.scrollLeft};})()");
    assert.equal(tagScroll.after,tagScroll.before,'refresh keeps the chosen tag in view');
    const layout=await js(`(()=>{const p=noteTagTest.noteCards.panel,r=p.element.getBoundingClientRect(),sidebar=p.tagSidebar,nav=p.tagNav,s=p.tagSidebar.parentElement.getBoundingClientRect(),n=nav.getBoundingClientRect();return {width:innerWidth,right:r.right,bottom:r.bottom,scrollWidth:p.element.scrollWidth,clientWidth:p.element.clientWidth,tagNavWidth:nav.clientWidth,tagNavScroll:nav.scrollWidth,tagHeading:sidebar.firstChild.textContent,tagsVisible:n.height>0&&n.top>=s.top&&n.bottom<=s.bottom+1,sort:p.sort.value,palette:document.body.dataset.studioPalette};})()`);
    report.layouts.push({name,...layout});assert.ok(layout.right<=layout.width+1,JSON.stringify(layout));assert.ok(layout.scrollWidth<=layout.clientWidth+1,JSON.stringify(layout));assert.equal(layout.tagsVisible,true,JSON.stringify(layout));assert.equal(layout.sort,'recent');assert.equal(layout.palette,palette);await shot(name);
    if(name==='zoom-200'){
      const content=await js("(()=>{const p=noteTagTest.noteCards.panel,browser=p.element.closest('.history-library-browser');browser.scrollTop=browser.scrollHeight-browser.clientHeight;const b=browser.getBoundingClientRect(),s=p.sort.getBoundingClientRect(),g=p.grid.getBoundingClientRect();return {sortVisible:s.top>=b.top&&s.bottom<=b.bottom,gridHeight:g.height,scrollable:browser.scrollHeight>browser.clientHeight};})()");
      assert.equal(content.sortVisible,true);assert.equal(content.scrollable,true);assert.ok(content.gridHeight>=100);await shot('zoom-200-content');
    }
  }
  assert.equal(report.requests.filter(request=>request.path==='/api/suggest').length,0);
  assert.ok(report.requests.filter(request=>request.path==='/api/notes').every(request=>request.query.limit==='12'));
  await js("noteTagTest.closeNoteLibrary({library:true})");assert.equal(await js("document.querySelectorAll('.note-category-sidebar').length"),0);
  assert.deepEqual(report.errors,[]);report.checks.push("English/Chinese narrow layouts, 200% zoom, 125% page scale and Graphite palette fit without clipping tag rows. Default sorting and filtering issue no ranking requests. Closing removes both sidebar sections.");
}catch(error){report.failure=error.stack;process.exitCode=1;console.error(error);}finally{
  fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({checks:report.checks,layouts:report.layouts,errors:report.errors,failure:report.failure},null,2));if(win&&!win.isDestroyed())win.destroy();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});app.exit(process.exitCode||0);
}});
