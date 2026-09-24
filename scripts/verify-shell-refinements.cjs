'use strict';
// Run against an isolated local server; expose hooks only in this test response.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve(__dirname, '../test-results/shell-refinements');
fs.mkdirSync(out, {recursive:true});
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    const source=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8').replace(/\}\)\(\);\s*$/, 'window.shellTest={state,render,drawCanvasLineGrid,openCanvasAgent,closeCanvasAgent};})();');
    await page.route('**/app.js', route=>route.fulfill({contentType:'application/javascript',body:source}));
    await page.addInitScript(()=>{if(window.top===window)localStorage.setItem('penecho-language','en');});
    await page.goto(process.env.PENECHO_TEST_URL || 'http://127.0.0.1:4397', {waitUntil:'networkidle'});
    if(await page.locator('#accessChooseOpen').isVisible()) {await page.locator('#accessChooseOpen').click();await page.locator('#accessConfirmOpen').click();}
    await page.waitForSelector('body[data-shell-dock-layout]');
    await page.waitForTimeout(400);
    const expanded=()=>page.locator('#canvasAgentToggle').getAttribute('aria-expanded');
    const sample=async(selector,trigger)=>page.evaluate(async({selector,trigger})=>{
      const target=document.querySelector(selector), view=document.querySelector('#viewport');
      const frames=[];
      document.querySelector(trigger).click();
      const started=performance.now();
      while(performance.now()-started<380) {
        await new Promise(requestAnimationFrame);
        const t=target.getBoundingClientRect(),v=view.getBoundingClientRect();
        frames.push({time:performance.now()-started,x:t.x,width:t.width,viewX:v.x,viewRight:v.right});
      }
      return frames;
    },{selector,trigger});
    const agentFrames=await sample('#canvasAgentPanel','#canvasAgentToggle');
    assert.ok(agentFrames.some(f=>f.x>1030&&f.x<1430),'Agent slides through intermediate positions');
    assert.ok(agentFrames.every(f=>Math.abs(f.x-f.viewRight)<1),'Canvas and Agent stay joined every frame');
    assert.equal(await page.locator('#canvasAgentPanel').evaluate(n=>getComputedStyle(n).transitionDuration.split(',')[0]),'0.3s');
    const navFrames=await sample('#studioNavigator','#studioNavigatorToggle');
    assert.ok(navFrames.some(f=>f.viewX>5&&f.viewX<240),'Navigator slides through intermediate positions');
    assert.ok(navFrames.every(f=>Math.abs(f.x+f.width-f.viewX)<1),'Canvas and navigator stay joined every frame');
    await page.locator('#canvasAgentInput').focus();
    await page.keyboard.press('Tab'); await page.waitForTimeout(380); assert.equal(await expanded(),'false');
    await page.locator('#canvasZoomLevel').focus();
    await page.keyboard.press('Tab'); await page.waitForTimeout(380); assert.equal(await expanded(),'true');
    // Rapid reversal must not let deferred close work hide a newly opened panel.
    await page.keyboard.press('Tab'); await page.waitForTimeout(80); await page.keyboard.press('Tab');
    await page.waitForTimeout(400); assert.equal(await expanded(),'true');
    assert.equal(await page.locator('#canvasAgentPanel').evaluate(n=>n.hidden||n.inert),false);
    const notice=page.locator('#canvasAutoPausedNotice');
    const copy=await notice.textContent();
    await page.evaluate(()=>{window.manualClicks=0;document.querySelector('#aiOrb').addEventListener('click',e=>{manualClicks++;e.stopImmediatePropagation();},true);});
    await notice.click(); assert.equal(await page.evaluate(()=>manualClicks),1);
    await notice.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>manualClicks),2);
    assert.equal(await notice.textContent(),copy);
    assert.equal(await notice.evaluate(n=>getComputedStyle(n).cursor),'pointer');
    await page.locator('#canvasAgentToggle').click();await page.locator('#studioNavigatorToggle').click();await page.waitForTimeout(400);
    const undo=page.locator('[data-action="undo"]'),redo=page.locator('[data-action="redo"]');
    assert.equal(await undo.isDisabled(),true);assert.equal(await redo.isDisabled(),true);
    const disabledColor=await undo.evaluate(n=>getComputedStyle(n).color);
    await page.mouse.move(500,650);await page.mouse.down();await page.mouse.move(600,690,{steps:12});await page.mouse.up();
    assert.equal(await undo.isDisabled(),false);assert.equal(await redo.isDisabled(),true);
    await page.waitForTimeout(220);
    const enabledColor=await undo.evaluate(n=>getComputedStyle(n).color);assert.notEqual(enabledColor,disabledColor);
    await undo.click();assert.equal(await undo.isDisabled(),true);assert.equal(await redo.isDisabled(),false);
    await page.waitForTimeout(220);
    assert.equal(await redo.evaluate(n=>getComputedStyle(n).color),enabledColor);
    await redo.click();assert.equal(await redo.isDisabled(),true);assert.equal(await undo.isDisabled(),false);
    await undo.click();
    await page.mouse.move(500,700);await page.mouse.down();await page.mouse.move(580,720,{steps:8});await page.mouse.up();
    assert.equal(await redo.isDisabled(),true,'New drawing invalidates redo');
    const grid=await page.evaluate(()=>{
      shellTest.state.gridStyle='lines';
      const xs=[],alphas=[],ctx={globalAlpha:1,save(){},restore(){},beginPath(){},moveTo(x,y){if(y===0)xs.push(x);},lineTo(){},stroke(){alphas.push(this.globalAlpha);}};
      shellTest.drawCanvasLineGrid(ctx,{x:0,y:0,w:1000,h:1000},1);
      shellTest.render();return {xs,alphas};
    });
    assert.deepEqual(grid.xs.slice(0,5),[0,250,500,750,1000]);assert.equal(grid.alphas[0],0.65);
    const order=await page.locator('#canvasZoomControls > button').evaluateAll(nodes=>nodes.map(n=>n.id));
    assert.deepEqual(order,['canvasZoomOut','canvasZoomLevel','canvasZoomIn','canvasFitContents','canvasNavigationLock']);
    await page.screenshot({path:path.join(out,'canvas.png')});
    await page.locator('.topbar').screenshot({path:path.join(out,'header.png')});
    await page.locator('#canvasZoomControls').screenshot({path:path.join(out,'view-controls.png')});
    console.log(JSON.stringify({agentFrames:agentFrames.length,navigatorFrames:navFrames.length,enabledColor,disabledColor,grid,styles:await page.evaluate(()=>Object.fromEntries(['#canvasDocumentName','#canvasAgentToggle','#studioNavigatorToggle','#canvasFitContents','#canvasZoomOut'].map(s=>{const n=document.querySelector(s),c=getComputedStyle(n),svg=n.querySelector('svg');return [s,{font:c.fontSize,afterDisplay:getComputedStyle(n,'::after').display,afterContent:getComputedStyle(n,'::after').content,svg:svg?{width:getComputedStyle(svg).width,height:getComputedStyle(svg).height}:null}]}))),errors},null,2));
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);
    assert.equal(await page.locator('#canvasFitContents').evaluate(n=>n.parentElement.id),'viewport');
    assert.equal(await page.locator('#canvasNavigationLock').isVisible(),true);
    await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(400);
    assert.equal(await page.locator('#canvasFitContents').evaluate(n=>n.parentElement.id),'canvasZoomControls');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#canvasAgentToggle').click();await page.waitForTimeout(50);
    assert.ok(await page.locator('#canvasAgentPanel').evaluate(n=>parseFloat(getComputedStyle(n).transitionDuration)<0.001));
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
