'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PENECHO_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'../..'),out=__dirname;
const source=fs.readFileSync(path.join(root,'src/client/app/core.js'),'utf8');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
function fn(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`)),rest=source.slice(start),end=rest.indexOf('\n  }');assert.ok(start>=0&&end>0,name);return rest.slice(0,end+4);}
const names=['apiPresetForConnection','selectedApiPreset','updateKimiSignup','apiModelSuggestions','updateApiModelChoices','updateApiModelSelection','clearFetchedApiModels','hideApiModelOptions','showApiModelOptions','chooseApiModel','handleApiModelKeydown','handleApiModelOptionKeydown','updateApiPresetFields','fillApiEditor','connectionEditorPayload','connectionModelDiscoverySignature','updateConnectionModelFetchState','normalizeFetchedApiModels','fetchConnectionModels'];
const bootstrap=read('src/client/app/ui-bootstrap.js');
const modelEvents=bootstrap.slice(bootstrap.indexOf('  settingsApiUrl?.addEventListener("input"'),bootstrap.indexOf('  settingsTraceToggle?.addEventListener'));
assert.ok(modelEvents.includes('handleApiModelOptionKeydown'));
const english=Object.fromEntries([...source.matchAll(/^      (settings(?:Preset\w+|OpenCodePresetHelp|FetchModels|FetchingModels)): ("(?:[^"\\]|\\.)*"),$/gm)].map(([,key,value])=>[key,JSON.parse(value)]));
const fixture=read('public/index.html').replace(/<script\b[\s\S]*?<\/script>/g,'');
const settingsCode=`
window.PENECHO_CONFIG={};
const settings={configurationMode:'api',fetchedApiModels:[],cli:{},editingConnectionId:null};
const t=key=>window.PENECHO_LOCALES?.zh?.[key]||${JSON.stringify(english)}[key]||key;
const peButton=(node,kind,density)=>{node.dataset.peButton=kind;if(density)node.dataset.peDensity=density};
const authenticatedApiHeaders=x=>x;
const setConnectionTestBusy=x=>{settings.connectionActionBusy=x;updateConnectionModelFetchState()};
const setSettingsStatus=(message='',kind='')=>{document.getElementById('settingsSaveStatus').textContent=message};
${source.slice(source.indexOf('  const API_PRESETS ='),source.indexOf('  const AI_FONT_STORAGE_KEY'))}
${names.map(fn).join('\n')}
const settingsFetchModelsLabel=settingsFetchModels.querySelector('span');
settingsProvider.value='api';settingsApiRegion.value='global';settingsApiService.value='api';settingsEffort.value='medium';
configurationBody.append(canvasSettingsForm);configurationLayer.hidden=false;configurationLayer.setAttribute('aria-hidden','false');
canvasSettingsForm.hidden=false;canvasSettingsForm.dataset.editorHidden='false';connectionManager.hidden=true;
canvasSettingsForm.querySelectorAll('.settings-system-group,.settings-search-group').forEach(e=>e.hidden=true);
settingsCliFields.hidden=true;settingsInstallCli.hidden=true;settingsTestSearch.hidden=true;
configurationTitle.textContent='AI connections';configurationSubtitle.textContent='Choose a service, enter your key, then enter or choose a model.';
settingsApiFormat.onchange=()=>updateApiPresetFields(true,true);
settingsFetchModels.onclick=fetchConnectionModels;
${modelEvents}
settingsApiFormat.value='openrouter';updateApiPresetFields(true,true);
window.fixturePayload=connectionEditorPayload;
`;
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage(),errors=[],requests=[];
 let discoveryGate=null,failDiscovery=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/settings/connections/models'){
   requests.push(route.request().postDataJSON());
   if(discoveryGate)await discoveryGate;
   return failDiscovery?route.fulfill({status:502,json:{error:'Fixture upstream error'}}):route.fulfill({json:{models:['glm-5.3-flash','minimax-m3','qwen3.8-max']}});
  }
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fixture});
  const file=path.join(root,'public',u.pathname);
  if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({path:file});
 });
 await page.goto('http://presets.test/',{waitUntil:'domcontentloaded'});
 await page.addScriptTag({content:read('src/providers/api-presets.js')});
 await page.addScriptTag({content:settingsCode});
 const model=page.locator('#settingsApiModel'),fetchButton=page.locator('#settingsFetchModels');
 await page.locator('#settingsApiFormat').selectOption('opencode-go');
 await model.fill('deepseek-custom-before-fetch');
 await page.locator('#settingsApiKey').fill('fixture-key-only');
 assert.equal(await model.inputValue(),'deepseek-custom-before-fetch');
 assert.equal((await page.evaluate(()=>window.fixturePayload())).apiModel,'deepseek-custom-before-fetch');
 await fetchButton.click();
 await page.locator('#settingsApiModelOptions').waitFor({state:'visible'});
 assert.equal(await model.inputValue(),'deepseek-custom-before-fetch');
 await page.locator('[data-api-model-value="minimax-m3"]').click();
 const payload=await page.evaluate(()=>window.fixturePayload());
 assert.equal(payload.apiFormat,'anthropic');assert.equal(payload.apiUrl,'https://opencode.ai/zen/go/v1/messages');
 await page.locator('#settingsApiModel').click();
 assert.equal(await page.locator('#settingsApiModelOptions').isVisible(),true);
 await page.locator('[data-api-model-value="glm-5.3-flash"]').click();
 assert.equal((await page.evaluate(()=>window.fixturePayload())).apiFormat,'openai');
 await model.fill('minimax-manual-after-fetch');
 assert.equal((await page.evaluate(()=>window.fixturePayload())).apiUrl,'https://opencode.ai/zen/go/v1/messages');
 await model.press('ArrowDown');
 await page.keyboard.press('End');
 await page.keyboard.press('Enter');
 assert.equal(await model.inputValue(),'qwen3.8-max');
 // Model text may change protocols or be incomplete while discovery is in flight.
 let releaseDiscovery;
 discoveryGate=new Promise(resolve=>{releaseDiscovery=resolve});
 await fetchButton.click();
 await page.waitForFunction(()=>settingsFetchModels.getAttribute('aria-busy')==='true');
 await model.fill('unfinished-model-id');
 releaseDiscovery();discoveryGate=null;
 await page.waitForFunction(()=>settingsFetchModels.getAttribute('aria-busy')==='false');
 assert.equal(await model.inputValue(),'unfinished-model-id');
 assert.equal(await page.locator('[data-api-model-value]').count(),3);
 assert.equal(requests.at(-1).connection.apiUrl,'https://opencode.ai/zen/go/v1');
 failDiscovery=true;
 await fetchButton.click();
 await page.waitForFunction(()=>settingsSaveStatus.textContent==='Fixture upstream error');
 assert.equal(await model.inputValue(),'unfinished-model-id');
 failDiscovery=false;
 for(const family of ['opencode-zen','deepseek','openrouter','openai','anthropic','kimi','minimax']){
  await page.locator('#settingsApiFormat').selectOption(family);
  await model.fill('deepseek-manual-model');
  await page.locator('#settingsApiKey').fill('fixture-key-only');
  await fetchButton.click();
  await page.waitForFunction(()=>settingsFetchModels.getAttribute('aria-busy')==='false');
  assert.equal(await model.inputValue(),'deepseek-manual-model',family);
  assert.equal((await page.evaluate(()=>window.fixturePayload())).apiModel,'deepseek-manual-model');
 }
 await page.locator('#settingsApiKey').fill('');
 const reports=[];
 for(const [label,width,height,scale,zh,dark] of [['wide-en',1280,960,1,false,false],['narrow-zh',390,844,1,true,false],['zoom200-zh-dark',1280,960,2,true,true]]){
  await page.setViewportSize({width:width/scale,height:height/scale});
  await page.emulateMedia({colorScheme:dark?'dark':'light'});
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:width/scale,height:height/scale,deviceScaleFactor:scale,mobile:false});
  if(zh)await page.addScriptTag({content:read('public/locales/zh.js')});
  await page.evaluate(({scale,zh,dark})=>{
   document.documentElement.style.zoom='1';
   document.body.dataset.theme='studio';
   if(zh){document.querySelectorAll('[data-i18n]').forEach(e=>{const value=window.PENECHO_LOCALES?.zh?.[e.dataset.i18n];if(value)e.textContent=value});configurationTitle.textContent='AI 连接';configurationSubtitle.textContent='选择服务、填写密钥，再填写或选择模型。'}
   settingsApiFormat.value='opencode-go';settingsApiFormat.dispatchEvent(new Event('change'));settingsSaveStatus.textContent='';settingsApiKey.blur();
  },{scale,zh,dark});
  await model.fill('deepseek-manual-model');
  await page.evaluate(()=>{settings.fetchedApiModels=['deepseek-flash','deepseek-v4-pro'];updateApiModelChoices();showApiModelOptions()});
  if(scale===2)await page.locator('[data-api-model-value="deepseek-v4-pro"]').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,label+'.png')});
  const overflow=await page.evaluate(()=>[document.documentElement,configurationPanel,configurationBody,canvasSettingsForm,settingsApiFields,settingsApiPresetHint].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({id:e.id||e.tagName,scroll:e.scrollWidth,client:e.clientWidth})));
  reports.push({label,cssViewport:{width:width/scale,height:height/scale},deviceScaleFactor:scale,systemColorScheme:dark?'dark':'light',overflow});assert.deepEqual(overflow,[]);
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'ui-report.json'),JSON.stringify({fixture:'Actual settings markup, CSS and functions; mocked models endpoint; no PenEcho service started',reports,errors},null,2));
 console.log(JSON.stringify(reports));
 } finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
