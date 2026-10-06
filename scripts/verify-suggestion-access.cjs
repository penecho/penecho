"use strict";
// Render real Canvas assets with isolated allowance responses and local state.
const {chromium}=require(process.env.PENECHO_PLAYWRIGHT||"playwright"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-suggest-access-"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:path.join(directory,"state"),HOST:"127.0.0.1",PORT:"0",AI_PROVIDER:"api",AI_API_KEY:"test",AI_API_URL:"http://127.0.0.1:1/v1",AI_API_MODEL:"test",PENECHO_CANVAS_AGENT_AUTO_OPEN:"false",PENECHO_REQUEST_TRACE:"false",PENECHO_JEVISION_ENABLED:"false"});
const server=require("../server.js");
(async()=>{let browser;const errors=[],checks=[];
try {
  await new Promise(resolve=>server.listening?resolve():server.once("listening",resolve));browser=await chromium.launch({headless:true});
  const preferences=[];
  const page=await browser.newPage({viewport:{width:1100,height:900},reducedMotion:"reduce"});page.on("pageerror",e=>errors.push(e.message));
  const source=fs.readFileSync(path.resolve(__dirname,"../public/app.js"),"utf8").replace(/\}\)\(\);\s*$/,"window.allowanceTest={state,smartSuggest,stroke,save,setCanvasMode,captureSelection,render,updateSuggestionAccess,assistRefresh};})();");
  await page.route(/^https:\/\//,route=>route.abort());await page.route("**/app.js*",route=>route.fulfill({contentType:"application/javascript",body:source}));
  await page.route("**/api/suggest/status",route=>route.fulfill({json:{configured:true,model:"PenEchoLLM"}}));
  await page.route("**/api/suggest/preferences",route=>{preferences.push(route.request().postDataJSON());return route.fulfill({json:{access:{signedIn:true,subscribed:false,freeLimit:500,used:500,remaining:0,price:.1,paidEnabled:true,dailyCreditLimit:50,spentToday:0,resetsAt:Date.now()+86400000,reason:null}}});});
  await page.route("**/api/suggest",route=>route.fulfill({json:{ok:false}}));
  await page.addInitScript(()=>{if(window.top===window)localStorage.setItem("penecho-language","zh");});
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:"domcontentloaded"});await page.waitForFunction(()=>!!window.allowanceTest);
  await page.evaluate(()=>{
    document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();
    const t=allowanceTest,s=t.state;s.language='zh';s.auto=false;s.scale=1;s.panX=40;s.panY=80;
    t.smartSuggest.available=true;t.smartSuggest.enabled=true;
    t.stroke({x:120,y:150},{x:220,y:150},false,6,true,'#111111');t.save();
    t.setCanvasMode('select');t.captureSelection([{x:100,y:120},{x:260,y:120},{x:260,y:200},{x:100,y:200}]);t.render();
  });
  const access={signedIn:false,subscribed:false,freeLimit:200,used:200,remaining:0,price:.1,paidEnabled:false,dailyCreditLimit:50,spentToday:0,resetsAt:Date.now()+86400000,reason:'sign_in_required'};
  for(const width of [1100,390]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(access=>{allowanceTest.updateSuggestionAccess({access});allowanceTest.assistRefresh('test');},access);
    const notice=page.locator('.assist-bar .assist-access-notice');await notice.waitFor();assert.match(await notice.innerText(),/200.*500/s);assert.equal(await notice.getByRole('button',{name:'登录',exact:true}).count(),1);
    const rect=await notice.boundingBox();await page.screenshot({path:path.join(directory,`guest-${width}.png`)});assert.ok(rect.x>=0&&rect.x+rect.width<=width+1,JSON.stringify({directory,width,rect}));
    await page.screenshot({path:path.join(directory,`guest-${width}.png`)});checks.push(`guest allowance at ${width}px`);
  }
  await page.evaluate(access=>{allowanceTest.updateSuggestionAccess({access:{...access,signedIn:true,freeLimit:500,used:500,reason:'paid_consent_required'}});allowanceTest.assistRefresh('test');},access);
  const notice=page.locator('.assist-bar .assist-access-notice');assert.match(await notice.innerText(),/500.*0.1/s);assert.equal(await notice.getByRole('button',{name:'开启积分续用'}).count(),1);
  assert.equal(await page.locator('#suggestionSpendingControl').evaluate(el=>el.hidden),false);
  assert.equal(await page.locator('#suggestionSpendingControl input[type=checkbox]').isChecked(),false);
  await page.screenshot({path:path.join(directory,'account-390.png')});checks.push('free account notice and opt-in default');
  await notice.getByRole('button',{name:'开启积分续用'}).click();
  await page.waitForFunction(()=>allowanceTest.smartSuggest.access?.paidEnabled===true);
  assert.deepEqual(preferences,[{paidEnabled:true}]);checks.push('paid continuation requires an explicit click');
  await page.evaluate(access=>{allowanceTest.updateSuggestionAccess({access:{...access,signedIn:true,subscribed:true,freeLimit:null,remaining:null,price:0,reason:null}});allowanceTest.assistRefresh('test');},access);
  assert.equal(await page.locator('.assist-bar .assist-access-notice').count(),0);assert.equal(await page.locator('#suggestionSpendingControl').evaluate(el=>el.hidden),true);assert.equal(await page.locator('#suggestionSpendingControl').evaluate(el=>getComputedStyle(el).display),'none');checks.push('subscriber has no paywall');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({directory,checks,errors}));
} finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
