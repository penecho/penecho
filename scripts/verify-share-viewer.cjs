'use strict';
// Run against tools/preview-live-share.mjs in the Cloud owner repository.
// That helper serves canonical mirrored viewer assets and memory-only test data.
const {chromium}=require(process.env.PENECHO_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const url=process.env.PENECHO_SHARE_TEST_URL;
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('An isolated localhost share preview URL is required');
const out=path.resolve(__dirname,'../test-results/ui-recovery');
(async()=>{
 const browser=await chromium.launch({headless:true}),report={checks:[],errors:[]};
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
 page.on('pageerror',e=>report.errors.push(e.message));
 try{
  await page.route('https://**',r=>r.abort());
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.viewer-primary');
  await page.waitForFunction(()=>document.querySelector('.viewer-status')?.hidden===true);
  assert.equal(await page.locator('.viewer-primary').innerText(),'Edit in my space');
  assert.equal(await page.locator('.viewer-account-action').isVisible(),true);
  assert.equal(await page.locator('.canvas-widget').count(),1,'Shared Widget is imported by the real viewer');
  await page.screenshot({path:path.join(out,'share-viewer-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
  const narrow=await page.locator('.viewer-actions').evaluate(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};});
  assert.ok(narrow.left>=0&&narrow.right<=narrow.width+1);
  await page.screenshot({path:path.join(out,'share-viewer-mobile.png')});
  report.checks.push('Real Cloud share response imports the widget, renders account and primary action, desktop and narrow layouts stay in bounds');
  await page.route('**/api/v1/shares/*',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.viewer-retry');
  assert.equal(await page.locator('.viewer-primary').count(),0,'Cannot copy before content loads');
  await page.screenshot({path:path.join(out,'share-viewer-retry.png')});
  await page.unroute('**/api/v1/shares/*');await page.locator('.viewer-retry').click();
  await page.waitForFunction(()=>document.querySelector('.viewer-status')?.hidden===true);
  report.checks.push('Temporary failure shows retry; retry loads content and restores the primary action');
  assert.deepEqual(report.errors,[]);
 }catch(e){report.failure=e.stack;await page.screenshot({path:path.join(out,'share-viewer-failure.png')});}
 finally{fs.writeFileSync(path.join(out,'share-viewer-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();if(report.failure)process.exitCode=1;}
})();
