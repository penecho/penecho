"use strict";
// Run canonical assets with a disposable local server, notes and browser profile.
// Run: tools/electron/node_modules/.bin/electron scripts/verify-note-library-review.cjs
const {app, BrowserWindow} = require("electron"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), {Readable} = require("node:stream");
const root = path.resolve(__dirname, ".."), cloudRoot = path.resolve(root, "../penecho_cloud"), cloudMode = process.argv.includes("--cloud"), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-note-review-")), output = path.resolve(process.argv.find(arg => arg.startsWith("--output="))?.slice(9) || path.join(root, "docs/verification/note-library-review-20261003", cloudMode ? "cloud" : "local"));
fs.mkdirSync(output, {recursive:true}); app.setPath("userData", path.join(temporary, "profile"));
Object.assign(process.env, {NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(temporary,"state"), PENECHO_CONFIG_FILE:path.join(temporary,"config.env"), HOST:"127.0.0.1", PORT:"0", PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false"});
const readStream = fs.createReadStream;
const exposeRuntime = source => source.replace(/\}\)\(\);\s*$/, `
    window.noteReviewTest={state,noteCards,canvasDocumentsReady,noteLibraryLoad,noteLibraryPut,noteLibraryPersist,noteLibraryRender,openNoteLibrary,closeNoteLibrary,applyLanguage,applyTheme,closeCanvasAgent};
    penIntelRemote=()=>false;
  })();`);
fs.createReadStream = function(file, ...args) {
  if (!cloudMode && path.resolve(String(file)) === path.join(root, "public/app.js")) return Readable.from([exposeRuntime(fs.readFileSync(file, "utf8"))]);
  return readStream.call(this, file, ...args);
};
const assetRoot = cloudMode ? path.join(cloudRoot,'public/canvas') : path.join(root,'public');
const report = {runtime:cloudMode ? "isolated Cloud" : "isolated local", inputs:Object.fromEntries(['app.js','cloud-connect.js','style.css','studio-shell.css'].map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(assetRoot,file))).digest('hex')])), checks:[], navigation:[], layouts:[], errors:[]}, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let i=0;i<120;i++) { if (await check()) return; await pause(100); } throw Error(`Timed out: ${label}`); }
let server, win;
app.whenReady().then(async () => { try {
  let url, cookies;
  if (cloudMode) {
    const {pathToFileURL} = require("node:url"), {buildApp} = await import(pathToFileURL(path.join(cloudRoot,"src/app.mjs")).href);
    const reservation = require("node:net").createServer(); await new Promise(resolve => reservation.listen(0,"127.0.0.1",resolve)); const port = reservation.address().port; await new Promise(resolve=>reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    server = await buildApp({logger:false,env:{NODE_ENV:"test",AUTH_MODE:"development",DATA_MODE:"memory",SESSION_MODE:"memory",STORAGE_MODE:"memory",CLOUD_NATIVE_CANVAS_ENABLED:"true",APP_ORIGIN:origin}});
    const mirrored = exposeRuntime(fs.readFileSync(path.join(cloudRoot,"public/canvas/app.js"),"utf8"));
    server.get("/canvas/app.js",{config:{rateLimit:false},compress:false},async(_request,reply)=>reply.type("application/javascript").send(mirrored));
    server.addHook("onSend",async(request,_reply,payload)=>request.url.startsWith("/api/config.js") ? String(payload)+"\nwindow.PENECHO_CONFIG.browserCanvasEditing=true;" : payload);
    const email="review-ui@notes.test",password="Isolated review A9",registration=await server.inject({method:"POST",url:"/api/v1/auth/register",payload:{name:"Review UI",email,password,termsAccepted:true,privacyAccepted:true}});
    await server.inject({method:"POST",url:"/api/v1/auth/verify-email",payload:{email,code:registration.json().developmentCode}});
    const login=await server.inject({method:"POST",url:"/api/v1/auth/login",payload:{email,password}}),account=login.json().account;
    const project=await server.services.repository.createProject(account.id,{name:"Isolated review"}),canvas=await server.services.repository.createCanvas(account.id,project.id,{name:"Review source"});
    await server.listen({port,host:"127.0.0.1"}); url=`${origin}/canvas/${canvas.id}`;
    cookies=[].concat(login.headers["set-cookie"]).map(cookie=>{const [name,value]=cookie.split(";",1)[0].split("=");return {url:origin,name,value,path:"/",httpOnly:name!=="penecho_csrf"};});
  } else {
    server = require("../server.js"); await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve)); url=`http://127.0.0.1:${server.address().port}`;
  }
  win = new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  for (const cookie of cookies || []) await win.webContents.session.cookies.set(cookie);
  win.webContents.on("console-message", event => { if (event.level === "error") report.errors.push(event.message); });
  const js = code => win.webContents.executeJavaScript(code, true), shot = async name => {
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await pause(80);
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  await win.loadURL(url);
  await until(()=>js("!!window.noteReviewTest"),"Canvas startup");
  await js(`(async()=>{const t=noteReviewTest;await t.canvasDocumentsReady();await t.noteLibraryLoad();t.state.auto=false;t.state.language='en';t.applyLanguage();t.applyTheme('studio');t.closeCanvasAgent();document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
    const NOTE=PENECHO_NOTE_CARD,now=Date.now(),image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/ZkAAAAASUVORK5CYII=';
    for(const entry of [
      NOTE.libraryEntry({id:'review-complete',note:{title:'Complete knowledge card',language:'en',style:'card',styleChosen:true,category:'concept',bookmarked:true,blocks:[{type:'qa',question:'What should Reveal display?',answer:'The complete original answer.'},{type:'formula',latex:'E=mc^2'},{type:'graph',expression:'y=sin(x)'},{type:'markdown',text:Array.from({length:15},(_,i)=>'Paragraph '+(i+1)+': The complete text remains readable and can be selected.').join('\\n\\n')},{type:'qa',question:'Is the second answer preserved?',answer:'SECOND ANSWER AT THE END'},{type:'image',src:image,caption:'Original media'},{type:'markdown',text:'END OF COMPLETE CARD'}],updated:now},thumb:image,updatedAt:now}),
      NOTE.libraryEntry({id:'review-formula',note:{title:'Formula card',style:'card',styleChosen:true,category:'formula',blocks:[{type:'formula',latex:'F=ma'}],updated:now},updatedAt:now}),
      NOTE.libraryEntry({id:'review-work',note:{title:'Work note',style:'note',styleChosen:true,category:'meeting',blocks:['Agenda'],updated:now},updatedAt:now}),
      NOTE.libraryEntry({id:'review-imported',note:{title:'Imported category',style:'note',styleChosen:true,category:{id:'remote-category',label:'Remote category',color:'#f43f5e'},blocks:['Saved on another device'],updated:now},updatedAt:now})
    ])t.noteLibraryPut(entry);
    await t.noteLibraryPersist();await t.openNoteLibrary();})()`);
  await until(() => js("document.querySelectorAll('.note-tile').length===4"), "library fixture");
  await pause(250);
  assert.equal(await js("document.activeElement.matches('.note-library-search')"),false,'opening Notes does not focus search');
  const visible = selector => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&e.getClientRects().length>0})()`);
  await js("document.querySelector('#historyFavoritesNav').click();document.querySelector('#historyNotesNav').click()");
  await pause(100);
  assert.equal(await js("document.querySelector('#historyPanel').dataset.libraryView"), "notes", "Favorites → Notes keeps Notes as the active Library view");
  const assertLibraryView = async (expected, label) => {
    const sample = await js(`(()=>{
      const panel=document.querySelector('#historyPanel'),main=panel.querySelector('.history-library-main'),visible=s=>!!document.querySelector(s)?.getClientRects().length;
      return {view:panel.dataset.libraryView||'canvases',notes:visible('#historyNotesView'),favorites:visible('#historyFavoritesView'),canvases:visible('#historyList'),toolbar:visible('.history-toolbar'),locations:visible('.history-library-sidebar > .snapshot-location'),projects:visible('#serverProjectManager'),categories:document.querySelectorAll('.note-category-sidebar').length,notePanels:document.querySelectorAll('.note-library.is-embedded').length,searchFocused:document.activeElement.matches('.note-library-search'),nav:Object.fromEntries(['Recent','Favorites','Notes'].map(name=>[name,document.querySelector('#history'+name+'Nav').getAttribute('aria-current')])),main:main.getBoundingClientRect().toJSON(),note:document.querySelector('.note-library')?.getBoundingClientRect().toJSON()};
    })()`);
    assert.equal(sample.view,expected,`${label}: active view`);
    assert.equal(sample.notes,expected==='notes',`${label}: Notes visibility`);
    assert.equal(sample.favorites,expected==='favorites',`${label}: Favorites visibility`);
    assert.equal(sample.canvases,expected==='canvases',`${label}: Canvas list visibility`);
    assert.equal(sample.toolbar,expected==='canvases',`${label}: Canvas toolbar visibility`);
    assert.equal(sample.categories,expected==='notes'?1:0,`${label}: category sidebar cleanup`);
    assert.equal(sample.notePanels,expected==='notes'?1:0,`${label}: embedded panel cleanup`);
    assert.equal(sample.nav.Notes,expected==='notes'?'page':'false',`${label}: Notes selection`);
    assert.equal(sample.nav.Favorites,expected==='favorites'?'page':'false',`${label}: Favorites selection`);
    if(expected!=='canvases')assert.equal(sample.nav.Recent,'false',`${label}: Recent selection`);
    if(expected==='notes'){
      assert.equal(sample.searchFocused,false,`${label}: switching to Notes does not focus search`);
      assert.equal(sample.locations,false,`${label}: Locations hidden`);assert.equal(sample.projects,false,`${label}: Projects hidden`);
      assert.ok(sample.note.width>=sample.main.width-1,`${label}: Notes fills the content pane`);
      assert.ok(sample.note.right<=sample.main.right+1,`${label}: Notes stays inside the content pane`);
    }
    return sample;
  };
  let navigationChecks=0;
  const switchView = async (selector,expected,label) => {
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await assertLibraryView(expected,label);navigationChecks++;
  };
  for(const [name,width,height] of [['wide',1440,1000],['tablet',1024,768],['narrow',390,844]]){
    win.setContentSize(width,height);await pause(150);
    for(let i=0;i<4;i++){
      await switchView('#historyFavoritesNav','favorites',`${name} ${i}: Favorites`);
      await switchView('#historyNotesNav','notes',`${name} ${i}: Notes`);
      await switchView('#historyRecentNav','canvases',`${name} ${i}: Recent`);
      await switchView('#historyNotesNav','notes',`${name} ${i}: Notes from Recent`);
      await switchView(`input[name=historyStorageLocation][value=${cloudMode?'cloud':'device'}]`,'canvases',`${name} ${i}: Location`);
    }
    await switchView('#historyNotesNav','notes',`${name}: final Notes`);await pause(150);
    report.navigation.push({name,...await assertLibraryView('notes',`${name}: settled Notes`)});await shot(`navigation-${name}`);
  }
  win.setContentSize(1440,1000);await pause(150);
  await switchView('#craftsButton','favorites','Favorites toolbar entry');
  await js('noteReviewTest.openNoteLibrary()');await assertLibraryView('notes','direct Notes entry');navigationChecks++;
  await js("window.dispatchEvent(new CustomEvent('penecho:languagechange'))");
  await assertLibraryView('notes','language refresh preserves Notes');navigationChecks++;
  win.webContents.debugger.attach('1.3');
  const enter = async () => {
    win.webContents.focus();
    for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})});
  };
  await js("document.querySelector('#historyFavoritesNav').focus()");
  await enter();
  await pause(50);await assertLibraryView('favorites','keyboard Favorites');navigationChecks++;
  await js("document.querySelector('#historyNotesNav').focus()");
  await enter();
  await pause(50);await assertLibraryView('notes','keyboard Notes');navigationChecks++;
  await js("for(let i=0;i<10;i++){document.querySelector('#historyFavoritesNav').click();document.querySelector('#historyNotesNav').click()}");
  await assertLibraryView('notes','rapid same-turn switching');navigationChecks++;
  await js("document.querySelector('#historyClose').click()");
  assert.equal(await js('!!noteReviewTest.noteCards.panel'),false,'closing the Library removes Notes');
  await switchView('#craftsButton','favorites','reopen Favorites');
  await switchView('#historyNotesNav','notes','Notes after reopen');
  report.checks.push(`${navigationChecks} Library navigation checks across wide, tablet and narrow windows: repeated Favorites, Notes, Recent and Locations, external entries, keyboard activation, rapid switching, language refresh and close/reopen keep one content view and its matching sidebar.`);
  await js("document.querySelector('#historyNotesNav').focus();document.querySelector('#historyNotesNav').click()");
  assert.equal(await js('document.activeElement.id'),'historyNotesNav','clicking the active Notes destination preserves navigation focus');
  await js('noteReviewTest.openNoteLibrary()');
  assert.equal(await js('document.activeElement.id'),'historyNotesNav','reopening an existing Notes panel does not focus search');
  await js("document.querySelector('.note-library-search').focus()");
  assert.equal(await js("document.activeElement.matches('.note-library-search')"),true,'explicitly focusing search still works');
  await js("document.querySelector('#historyNotesNav').focus()");
  report.checks.push('First opening, repeated navigation and reopening Notes preserve non-editable focus; search accepts focus only when explicitly requested.');
  assert.equal(await visible("#serverProjectManager"), false); assert.equal(await visible(".history-library-sidebar > .snapshot-location"), false);
  assert.equal(await visible(".note-category-sidebar"), true);
  assert.equal(await js("document.querySelector('.note-category-nav-item[data-category-id=\"\"] small').textContent"), "4");
  assert.equal(await js("document.querySelector('.note-category-nav-item[data-category-id=remote-category] small').textContent"), "1");
  assert.ok(await js("document.querySelector('.note-category-heading').getBoundingClientRect().top < document.querySelector('#craftsEchoesLink').getBoundingClientRect().top"));
  await shot("categories-wide");
  await js("document.querySelector('.note-category-nav-item[data-category-id=concept]').focus();document.querySelector('.note-category-nav-item[data-category-id=concept]').click()");
  assert.equal(await js("document.querySelectorAll('.note-tile').length"), 1);
  assert.equal(await js("document.activeElement.dataset.categoryId"), "concept");
  await js("document.querySelector('.note-library-filters .note-filter').click()");
  assert.equal(await js("noteReviewTest.noteCards.panel.bookmarked"), true);
  await js("document.querySelector('.note-library-search').value='no-match';document.querySelector('.note-library-search').dispatchEvent(new Event('input'))");
  await until(() => js("document.querySelectorAll('.note-tile').length===0"), "combined search filter");
  await js("document.querySelector('.note-library-search').value='';document.querySelector('.note-library-search').dispatchEvent(new Event('input'))");
  await until(() => js("document.querySelectorAll('.note-tile').length===1"), "clear search");
  report.checks.push("Categories replace Projects and Locations, include saved remote categories and counts, preserve keyboard focus, and combine with bookmarks and search.");
  await js("document.querySelector('.note-category-add').click();document.querySelector('.note-category-form input[type=text]').value='My category';document.querySelector('.note-category-form').requestSubmit()");
  assert.equal(await js("document.querySelectorAll('.note-tile').length"), 0);
  assert.equal(await js("document.querySelector('.note-category-nav-item[data-category-id=my-category] small').textContent"), "0");
  await js("document.querySelector('.note-category-nav-item[data-category-id=concept]').click()");
  const source = await js("JSON.stringify(noteReviewTest.noteCards.entries.find(e=>e.id==='review-complete').note)");
  await js("document.querySelector('.note-library-review').click()");
  assert.deepEqual(await js("noteReviewTest.noteCards.review.queue"), ["review-complete"]);
  await js("document.querySelector('.note-review-reveal').click()");
  await until(() => js("document.querySelector('.note-review-back')?.dataset.ready==='true'"), "full card document");
  const cardFrame = async () => {
    for (const frame of win.webContents.mainFrame.framesInSubtree.filter(f => f.url === "about:srcdoc")) if (await frame.executeJavaScript("document.documentElement.classList.contains('nc-review')")) return frame;
    throw Error("Missing Review document");
  };
  const content = await cardFrame();
  const inspectContent = () => content.executeJavaScript(`(()=>{const body=document.querySelector('.nc-body'),card=document.querySelector('.nc');return {text:body.textContent,blocks:body.children.length,answers:[...document.querySelectorAll('.nc-qa-back')].map(e=>getComputedStyle(e).display),font:parseFloat(getComputedStyle(card).fontSize)*parseFloat(getComputedStyle(document.documentElement).zoom),scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,card:card.getBoundingClientRect().toJSON(),viewport:{width:innerWidth,height:innerHeight},image:!!body.querySelector('.nc-image img'),graph:!!body.querySelector('.nc-graph svg')};})()`);
  let details = await inspectContent();
  assert.match(details.text, /END OF COMPLETE CARD/); assert.match(details.text, /SECOND ANSWER AT THE END/); assert.equal(details.blocks, 7); assert.deepEqual(details.answers, ["flex","flex"]);
  assert.ok(details.font >= 16); assert.ok(details.scrollHeight > details.clientHeight); assert.equal(details.image,true); assert.equal(details.graph,true);
  assert.equal(await js("document.querySelector('.note-review-back > img')"), null);
  const frameIdentity = await js("window.reviewFrameBefore=document.querySelector('.note-review-back iframe');true"); assert.equal(frameIdentity,true);
  await content.executeJavaScript("document.querySelector('.nc-body').scrollTop=150");
  await js("noteReviewTest.noteLibraryRender()");
  assert.equal(await js("document.querySelector('.note-review-back iframe')===window.reviewFrameBefore"), true);
  assert.ok(await content.executeJavaScript("document.querySelector('.nc-body').scrollTop") >= 149);
  await content.executeJavaScript("document.querySelector('.nc-body').scrollTop=0");
  await pause(150); await shot("review-wide");
  report.layouts.push({name:"review-wide",...details});
  report.checks.push("Reveal renders all seven source blocks, two visible answers, math, graph and media at readable text size; refresh preserves the frame and reading scroll position.");
  const layout = () => js(`(()=>{const library=document.querySelector('.note-library'),grid=document.querySelector('.note-library-grid'),back=document.querySelector('.note-review-back'),grades=document.querySelector('.note-review-grades'),r=library.getBoundingClientRect(),g=grades.getBoundingClientRect();return {width:innerWidth,height:innerHeight,library:r.toJSON(),scrollWidth:library.scrollWidth,clientWidth:library.clientWidth,gridScroll:grid.scrollHeight,gridHeight:grid.clientHeight,back:back.getBoundingClientRect().toJSON(),grades:g.toJSON(),visibleGrades:g.top>=r.top&&g.bottom<=r.bottom+1}})()`);
  for (const [name,width,height] of [["review-narrow",390,844],["review-short",1000,650]]) {
    win.setContentSize(width,height); await pause(250);
    const sample = await layout(); details = await inspectContent();
    assert.ok(sample.scrollWidth <= sample.clientWidth+1,JSON.stringify(sample)); assert.ok(sample.library.x>=-1&&sample.library.right<=width+1,JSON.stringify(sample));
    assert.ok(sample.back.width>150&&sample.back.height>100,JSON.stringify(sample)); assert.ok(sample.visibleGrades,JSON.stringify(sample));
    assert.ok(details.card.width>150&&details.card.right<=details.viewport.width+1,JSON.stringify(details));
    assert.ok(details.font>=16); assert.ok(details.clientHeight>30); report.layouts.push({name,...sample,content:details}); await shot(name);
  }
  await js("document.querySelector('.grade-good').click()");
  assert.equal(await js("noteReviewTest.noteCards.review.done"), 1);
  assert.equal(await js("JSON.stringify(noteReviewTest.noteCards.entries.find(e=>e.id==='review-complete').note)"), source);
  await js("document.querySelector('.note-review-done button').click();document.querySelector('#historyRecentNav').click()");
  assert.equal(await visible(".note-category-sidebar"), false); assert.equal(await js("document.querySelector('#historyPanel').dataset.libraryView==='notes'"), false);
  await js("document.querySelector('#historyNotesNav').click()"); await until(() => visible(".note-category-sidebar"),"reopen");
  assert.equal(await js("document.querySelectorAll('.note-category-sidebar').length"),1);
  assert.equal(await js("document.querySelector('.note-category-nav-item[data-category-id=my-category] small').textContent"),"0");
  report.checks.push("New categories persist across reopen; leaving Notes removes its sidebar. Review respects filters, grading advances Leitner state and preserves the original note. Narrow and short layouts keep grades visible and text readable.");
  assert.deepEqual(report.errors, []);
} catch(error) { report.failure=error.stack; console.error(error); if (win&&!win.isDestroyed()) fs.writeFileSync(path.join(output,"failure.png"),(await win.webContents.capturePage()).toPNG()); }
finally {
  fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2)+"\n"); console.log(JSON.stringify({checks:report.checks,layouts:report.layouts.map(l=>l.name),errors:report.errors,failure:report.failure},null,2));
  win?.destroy(); if (server) { if (cloudMode) await server.close(); else { server.closeAllConnections?.(); await new Promise(resolve=>server.close(resolve)); } } fs.rmSync(temporary,{recursive:true,force:true}); app.exit(report.failure?1:0);
}});
