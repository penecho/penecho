'use strict';
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(__dirname, '../test-results/color-picker');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.PENECHO_TEST_URL || 'http://127.0.0.1:4397', { waitUntil: 'domcontentloaded' });
    if (process.env.PENECHO_TEST_SETUP_ACCESS === '1' && await page.locator('#accessConfirmOpen').count()) {
      await page.getByRole('button', { name: 'Continue without a code', exact: false }).click();
      await page.locator('#accessConfirmOpen').click();
    }
    await page.waitForSelector('body[data-shell-dock-layout]');
    if (await page.locator('#settingsClose').isVisible()) await page.locator('#settingsClose').click();
    await page.evaluate(() => {
      for (const id of ['configurationLayer', 'featureTourLayer', 'changelogLayer']) {
        const node = document.getElementById(id); if (node) node.hidden = true;
      }
    });
    for (const kind of ['ink', 'ai']) {
      const trigger = page.locator(`[data-color-control="${kind}"] .color-orb-trigger`);
      const panel = page.locator(`#${kind}ColorPopover`);
      await trigger.click();
      await panel.locator(`[data-${kind}-color="#16a34a"]`).click();
      await trigger.click();
      assert.equal(await panel.locator('[data-color-value]').textContent(), '#16A34A');
      const radial = await panel.locator('.orbit-swatch').evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, radius:getComputedStyle(node).borderRadius };
      }));
      assert.ok(new Set(radial.map(item => Math.round(item.y))).size >= 5, 'presets form a wheel');
      assert.ok(radial.every(item => item.radius === '50%'));
      if (kind === 'ink') await panel.screenshot({ path:path.join(output, 'presets.png') });
      await panel.locator('[data-custom-color-open]').click();
      assert.equal(await panel.locator('[data-custom-color-open]').isVisible(), false);
      const hex = panel.locator('[data-custom-color]');
      await hex.fill('#aa12ef');
      assert.equal(await panel.locator('[data-color-channel="0"]').inputValue(), '170');
      await panel.locator('[data-custom-color-cancel]').click();
      assert.equal(await panel.locator('[data-color-value]').textContent(), '#16A34A', 'cancel discards draft');
      await panel.locator('[data-custom-color-open]').click();
      assert.equal(await hex.inputValue(), '#16a34a');
      await hex.fill('#zzzzzz');
      await panel.locator('button[type="submit"]').click();
      assert.ok(await panel.isVisible(), 'invalid input cannot commit');
      await hex.fill('#2563eb');
      const spectrum = panel.locator('[data-color-spectrum]');
      const rect = await spectrum.boundingBox();
      await page.mouse.move(rect.x + rect.width * .72, rect.y + rect.height * .18);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width * .62, rect.y + rect.height * .24);
      await page.mouse.up();
      const draft = await hex.inputValue();
      assert.notEqual(draft, '#2563eb', 'spectrum drag updates draft');
      if (kind === 'ink') await panel.screenshot({ path:path.join(output, 'custom.png') });
      await panel.locator('button[type="submit"]').click();
      assert.equal(await panel.isVisible(), false);
      assert.equal(await trigger.evaluate(node => getComputedStyle(node).getPropertyValue('--selected-color').trim()), draft);
      await trigger.click();
      await panel.locator('[data-custom-color-open]').click();
      assert.equal(await hex.inputValue(), draft);
      await page.keyboard.press('ArrowRight');
      assert.notEqual(await hex.inputValue(), draft, 'hue responds to keyboard');
      await page.keyboard.press('Escape');
      assert.equal(await panel.locator('.custom-color-editor').isVisible(), false);
      await page.keyboard.press('Escape');
      assert.equal(await panel.isVisible(), false);
      assert.ok(await trigger.evaluate(node => document.activeElement === node), 'Escape restores trigger focus');
    }
    for (const [width, height, scale] of [[760, 700, 1], [390, 844, 1], [1440, 900, 1.25], [900, 520, 1]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(scale => window.PenEchoPageScale.apply(scale, { persist: false }), scale);
      await page.waitForTimeout(200);
      const trigger = page.locator('[data-color-control="ink"] .color-orb-trigger');
      await trigger.click();
      const panel = page.locator('#inkColorPopover');
      await panel.locator('[data-custom-color-open]').click();
      const bounds = await panel.boundingBox();
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `panel stays horizontally visible at ${width}/${scale}`);
      assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= height + 1, `panel stays vertically visible at ${width}/${scale}: ${JSON.stringify(bounds)}`);
      await panel.locator('button[type="submit"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path:path.join(output, `viewport-${width}-${scale}.png`) });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
    const touchPage = await browser.newPage({ viewport: { width:390, height:844 }, hasTouch:true, isMobile:true });
    await touchPage.goto(process.env.PENECHO_TEST_URL || 'http://127.0.0.1:4397', { waitUntil:'domcontentloaded' });
    if (await touchPage.locator('#settingsClose').isVisible()) await touchPage.locator('#settingsClose').click();
    await touchPage.evaluate(() => { for (const id of ['configurationLayer', 'featureTourLayer', 'changelogLayer']) { const n = document.getElementById(id); if (n) n.hidden = true; } });
    await touchPage.locator('[data-color-control="ink"] .color-orb-trigger').tap();
    const touchPanel = touchPage.locator('#inkColorPopover');
    assert.ok((await touchPanel.locator('.orbit-swatch').first().boundingBox()).width >= 44);
    await touchPanel.locator('[data-custom-color-open]').tap();
    await touchPanel.locator('[data-color-spectrum]').tap({ position:{ x:120, y:50 } });
    const touchDraft = await touchPanel.locator('[data-custom-color]').inputValue();
    await touchPanel.locator('button[type="submit"]').tap();
    assert.equal(await touchPanel.isVisible(), false);
    await touchPage.locator('[data-color-control="ink"] .color-orb-trigger').tap();
    assert.equal(await touchPanel.locator('[data-color-value]').textContent(), touchDraft.toUpperCase());
    await touchPage.close();
    assert.deepEqual(errors, []);
    console.log('Color picker: presets, draft/apply/cancel, RGB/HEX, pointer, keyboard and responsive checks passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
