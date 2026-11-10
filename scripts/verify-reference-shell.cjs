'use strict';
// Isolated browser acceptance. Only the served test response exposes runtime hooks.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve(__dirname, '../test-results/reference-shell');
fs.mkdirSync(out, {recursive:true});
(async () => {
 const browser = await chromium.launch({headless:true});
 const errors=[], checks=[];
 try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror', e=>errors.push(e.message));
  const source = fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8').replace(/\}\)\(\);\s*$/, 'window.referenceTest={state,restoreWidgets,render,setCanvasMode,canvasAgent,mcpRuntime,mcpRenderCanvasStatus,mcpRenderReconnectStatus,mcpRenderToolbar,updateGridButton,canvasAgentSyncPromptSuggestions,canvasAgentSetStatus};})();');
  await page.route('**/app.js',route=>route.fulfill({contentType:'application/javascript',body:source}));
  await page.addInitScript(()=>{if(window.top===window)localStorage.setItem('penecho-language','en');});
  await page.goto(process.env.PENECHO_TEST_URL || 'http://127.0.0.1:4397', {waitUntil:'networkidle'});
  if(await page.locator('#accessChooseOpen').isVisible()) {
   await page.locator('#accessChooseOpen').click();await page.locator('#accessConfirmOpen').click();
  }
  await page.waitForSelector('body[data-shell-dock-layout]');
  assert.equal(await page.locator('#settingsClose').isVisible(),false,'A fresh canvas never opens connection settings automatically');
  const shot=async name=>{await page.waitForTimeout(200);await page.screenshot({path:path.join(out,`${name}.png`)});};
  const box=selector=>page.locator(selector).boundingBox();
  assert.equal(await page.locator('#canvasAgentToggle').getAttribute('aria-expanded') === 'true',false);
  assert.equal(await page.locator('#saveCanvasBtn').isVisible(),false);
  assert.equal(await page.locator('#canvasWelcomeActions > button').count(),3);
  assert.equal(await page.evaluate(()=>referenceTest.state.gridStyle),'dots');
  await page.waitForTimeout(400);assert.equal(await page.locator('#tourLayer').isVisible(),false,'The welcome canvas remains unobstructed');await shot('home');checks.push('Fresh page: Agent closed, three welcome cards, dots, inline save state');
  await page.locator('#penSizeTrigger').click();assert.equal(await page.locator('#penSize').isVisible(),true);
  await page.locator('#penSize').fill('6');await page.keyboard.press('Escape');
  assert.match(await page.locator('#penSizeValue').textContent(),/6/);
  await page.locator('[aria-controls="aiColorPopover"]').click();
  await page.locator('#aiColorPopover [data-ai-color="#dc2626"]').click();
  assert.equal(await page.evaluate(()=>referenceTest.state.aiColor),'#dc2626');
  await page.keyboard.press('Escape');
  await page.locator('#canvasAgentToggle').click();await page.waitForTimeout(380);
  assert.equal(await page.locator('#canvasAgentConnectionNotice').isVisible(),true);
  assert.equal(await page.locator('#canvasAgentPromptToggle').isVisible(),false);
  assert.equal(await page.locator('#canvasAutoPausedNotice').isVisible(),true);
  assert.ok(await page.locator('.canvas-agent-connection-label-clip').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'Choose model is fully visible');await shot('agent');
  await page.locator('#studioNavigatorToggle').click();await page.waitForTimeout(380);
  const nav=await box('#studioNavigator'),view=await box('#viewport'),agent=await box('#canvasAgentPanel');
  assert.ok(Math.abs(nav.x+nav.width-view.x)<2 && Math.abs(view.x+view.width-agent.x)<2,'Sidebars reserve canvas space');
  for(const selector of ['#studioNavigator','#canvasAgentPanel'])assert.equal(await page.locator(selector).evaluate(n=>getComputedStyle(n).boxShadow),'none');
  await shot('both-sidebars');checks.push('Both sidebars reserve space and have no shadow');
  await page.locator('#settingsBtn').click();await page.locator('#settingsNavCanvas').click();await shot('settings');
  assert.equal(await page.locator('#settingsNavCanvas').getAttribute('aria-selected'),'true');
  await page.locator('#settingsCanvasAutoDelay').selectOption('2');
  assert.equal(await page.evaluate(()=>referenceTest.state.autoDelayMs),2000);
  for(const style of ['lines','none','dots']) {
   await page.locator(`[data-grid-style="${style}"]`).click();
   assert.equal(await page.locator(`[data-grid-style="${style}"]`).getAttribute('aria-pressed'),'true');
   assert.equal(await page.evaluate(()=>referenceTest.state.gridVisible),style!=='none');
  }
  await page.locator('#settingsWidgetShadowToggle').click();
  assert.equal(await page.locator('#settingsWidgetShadowToggle').getAttribute('aria-checked'),'true');
  await page.locator('#settingsWidgetShadowToggle').click();
  await page.locator('#settingsClose').click();
  checks.push('Canvas settings update delay, grid and shadows through the runtime');
  if(await page.locator('#studioNavigatorToggle').getAttribute('aria-expanded')==='true')await page.locator('#studioNavigatorToggle').click();
  if(await page.locator('#canvasAgentToggle').getAttribute('aria-expanded') === 'true')await page.locator('#canvasAgentClose').click();
  for(const width of [1100,900,760]) {
   await page.setViewportSize({width,height:900});await page.waitForTimeout(380);
   const dock=await box('.primary-tools'),ai=await box('#aiToolsSection');
   assert.ok(dock.x>=0 && dock.x+dock.width<=width+1 && ai.x+ai.width<=width+1);
   if(Math.abs(dock.y-ai.y)<45)assert.ok(dock.x+dock.width<=ai.x+1,'Dock clears AI controls');
   await shot(`home-${width}`);
  }
  await page.setViewportSize({width:390,height:844});await shot('mobile');
  assert.ok((await box('#viewport')).width>0);
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{
   const t=referenceTest;t.state.panX=-9600;t.state.panY=-9600;t.state.scale=1;
   t.restoreWidgets([{id:'widget-1',pluginId:'general',widgetType:'html_widget',refreshSeconds:0,copyText:'<html></html>',copyLabel:'Copy HTML',sourceFormat:'html',title:'Checkout service · architecture',x:9740,y:9820,w:780,h:480,contentW:780,contentH:480,html:'<!doctype html><html><body style="margin:0;font:16px system-ui;background:white;color:#20242c"><header style="padding:18px 24px;background:#f7f8fa;border-bottom:1px solid #ddd">Checkout service · architecture</header><main style="display:flex;gap:36px;align-items:center;justify-content:center;height:350px"><div style="border:1px solid #ddd;padding:24px;border-radius:8px">Web client</div>→<div style="border:1px solid #ddd;padding:24px;border-radius:8px">API gateway</div>→<div style="border:1px solid #5846ed;background:#efecff;padding:24px;border-radius:8px">Checkout</div></main></body></html>'}]);
   t.setCanvasMode('hand');t.render();
  });
  await page.waitForTimeout(600);await page.mouse.click(250,400);await shot('widget');
  for(const kind of ['askagent','interact','favorite','copy','echo','share','download','delete'])assert.equal(await page.locator(`.object-chrome-button.${kind}`).isVisible(),true,kind);
  const toolbar=await box('.floating-widget-toolbar'),widget=await box('.canvas-widget');
  assert.ok(toolbar.y+toolbar.height<widget.y,'Toolbar is separate from widget');
  const nw=page.locator('.canvas-widget .resize-nw'),nwBox=await nw.boundingBox();assert.ok(nwBox);
  await page.mouse.move(nwBox.x+6,nwBox.y+6);await page.mouse.down();await page.mouse.move(nwBox.x-44,nwBox.y-24,{steps:6});await page.mouse.up();
  assert.ok(await page.evaluate(()=>referenceTest.state.widgets[0].x<9740),'NW handle resizes toward the upper left');
  await page.locator('.object-chrome-button.askagent').click();
  assert.deepEqual(await page.evaluate(()=>referenceTest.canvasAgent.references),['widget-1']);
  assert.equal(await page.locator('#canvasAgentToggle').getAttribute('aria-expanded') === 'true',true);
  await page.locator('#canvasAgentInkMode').click();
  const activeInk=await page.locator('#canvasAgentInkMode').evaluate(n=>({bg:getComputedStyle(n).backgroundColor,shadow:getComputedStyle(n).boxShadow}));
  assert.match(activeInk.bg,/^(rgba\(0, 0, 0, 0\)|oklab\(0 0 0 \/ 0\))$/);assert.equal(activeInk.shadow,'none');
  await shot('widget-agent');await page.locator('#canvasAgentClose').click();
  checks.push('Widget actions, NW resize, Ask Agent reference and tint-only input selection');
  await page.locator('#canvasDocumentSaveState').click();
  await page.waitForFunction(()=>document.querySelector('#canvasDocumentSaveState').dataset.state==='saved',{},{timeout:20000});
  checks.push('Clicking Not saved saves the canvas through the existing save flow');
  await page.evaluate(()=>{
   const t=referenceTest;Object.assign(t.mcpRuntime,{wanted:true,ready:false,reconnecting:true,reconnectAt:Date.now()+3000,connectionLost:true});
   t.mcpRenderCanvasStatus();t.mcpRenderReconnectStatus();t.mcpRenderToolbar();
  });
  await shot('mcp-reconnect');assert.match(await page.locator('#mcpReconnectCancel').textContent(),/connection lost.*Retrying.*Cancel/);
  await page.locator('#mcpReconnectCancel').click();assert.equal(await page.locator('#mcpReconnectCancel').isVisible(),false);
  checks.push('MCP retry countdown displays and Cancel stops retrying');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
