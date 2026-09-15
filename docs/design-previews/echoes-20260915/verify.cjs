const { chromium } = require('/Users/heack/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless:true});
  const checks = [];
  for (const theme of ['a','b']) {
    const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.join(__dirname,`echoes-${theme}.html`));
    await page.locator('.card').first().waitFor();
    await page.screenshot({path:path.join(__dirname,`${theme}-browse-desktop.png`)});
    assert.equal(await page.locator('.card').count(),6);
    await page.locator('#search').fill('calculus');
    assert.equal(await page.locator('.card').count(),1);
    await page.locator('#search').fill('');
    await page.locator('[data-kind="widget"]').click();
    assert.equal(await page.locator('.card').count(),3);
    await page.locator('[data-kind=""]').click();
    await page.locator('[data-detail="0"]').first().click();
    await page.screenshot({path:path.join(__dirname,`${theme}-detail-desktop.png`)});
    await page.locator('[data-save="0"]').first().click();
    await page.locator('[data-share]').click();
    assert.equal(await page.locator('dialog[open]').count(),1);
    await page.keyboard.press('Escape');
    await page.locator('[data-step="1"]').last().click();
    assert.match(await page.locator('#step-label').textContent(),/Step 2/);
    await page.locator('#comment').fill('A clearer flow.');
    await page.locator('[data-comment-submit]').click();
    assert.match(await page.locator('#comment-list').textContent(),/A clearer flow/);
    await page.locator('#state').selectOption('legacy');
    assert.equal(await page.locator('[data-echo]').isDisabled(),true);
    await page.locator('#state').selectOption('normal');
    for (const width of [1939,768,390]) {
      await page.setViewportSize({width,height:width===1939?1134:844});
      for (const screen of ['list','detail']) {
        await page.locator(`.reviewbar [data-page="${screen}"]`).click();
        const overflow = await page.evaluate(() => ({width:innerWidth, scroll:document.documentElement.scrollWidth}));
        assert.ok(overflow.scroll<=overflow.width+1,`${theme} ${screen} ${width}: horizontal overflow ${JSON.stringify(overflow)}`);
        if(width===390)await page.screenshot({path:path.join(__dirname,`${theme}-${screen}-mobile.png`)});
      }
    }
    await page.locator('.reviewbar [data-page="list"]').click();
    for (const state of ['no-image','empty','loading','error']) {
      await page.locator('#state').selectOption(state);
      const screenshotText=await page.locator('#main').innerText();
      assert.ok(screenshotText.length>10);
    }
    assert.deepEqual(errors,[]);
    checks.push({theme,passed:true,viewports:[1440,1939,768,390],checks:['search','type filters','detail navigation','favorites','share dialog','Escape','lineage selection','comment','legacy Echo disabled','empty/loading/error/image fallback','no horizontal overflow','no JavaScript errors']});
    await page.close();
  }
  fs.writeFileSync(path.join(__dirname,'validation.json'),JSON.stringify(checks,null,2)+'\n');
  console.log(JSON.stringify(checks));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
