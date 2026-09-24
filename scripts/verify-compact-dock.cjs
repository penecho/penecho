'use strict';
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || 'playwright');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const out = path.resolve(__dirname, '../test-results/compact-dock');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.PENECHO_TEST_URL || 'http://127.0.0.1:4391', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body[data-shell-dock-layout]');
    if (await page.locator('#settingsClose').isVisible()) await page.locator('#settingsClose').click();
    await page.evaluate(() => {
      document.body.classList.remove('studio-navigator-open', 'studio-agent-docked', 'canvas-agent-open');
      for (const id of ['configurationLayer', 'featureTourLayer', 'changelogLayer']) {
        const node = document.getElementById(id); if (node) node.hidden = true;
      }
    });
    for (const width of [1440, 1100, 900, 760, 701]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(350);
      const layout = await page.evaluate(() => {
        const rect = selector => {
          const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height, right, bottom };
        };
        return { mode: document.body.dataset.shellDockLayout, dock: rect('.primary-tools'), ai: rect('#aiToolsSection'), zoom: rect('#canvasZoomControls'), lock: rect('#canvasNavigationLock'), space: rect('.shell-dock-space') };
      });
      console.log(JSON.stringify({ width, ...layout }));
      assert.ok(['horizontal','vertical','rows'].includes(layout.mode));
      await page.screenshot({ path: path.join(out, `${width}.png`) });
      await page.screenshot({ path: path.join(out, `${width}-toolbar.png`), clip: { x: 0, y: 700, width, height: 200 } });
      assert.ok(layout.ai.right <= width, 'AI controls stay in viewport');
      const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1, `${label}: ${actual} vs ${expected}`);
      close(layout.ai.right, layout.space.right, 'AI anchors to right edge');
      close(layout.zoom.x, layout.space.x, 'view anchors to left edge');
      assert.ok(layout.dock.x >= layout.space.x && layout.dock.right <= layout.space.right, 'drawing dock stays in available canvas');
      const viewCenter = (layout.zoom.y + layout.zoom.bottom) / 2;
      close((layout.ai.y + layout.ai.bottom) / 2, viewCenter, 'side groups share a center line');
      if (layout.mode !== 'rows') close((layout.dock.y + layout.dock.bottom) / 2, viewCenter, 'all three groups share a center line');
      assert.equal(await page.locator('.primary-tools .view-tools').evaluate(node => getComputedStyle(node).borderRightWidth), '0px');
      if (layout.mode !== 'rows') {
        assert.ok(layout.zoom.right <= layout.dock.x, 'left controls do not overlap dock');
        assert.ok(layout.dock.right <= layout.ai.x, 'dock does not overlap AI');
      } else assert.ok(layout.ai.bottom < layout.dock.y, 'second row clears dock');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const scenario of ["sidebar", "scale125"]) {
      await page.evaluate(scenario => {
        document.body.classList.toggle('studio-navigator-open', scenario === 'sidebar');
        document.body.classList.toggle('studio-agent-docked', scenario === 'sidebar');
        document.body.classList.toggle('canvas-agent-open', scenario === 'sidebar');
        window.PenEchoPageScale.apply(scenario === 'scale125' ? 1.25 : 1, { persist: false });
      }, scenario);
      await page.waitForTimeout(350);
      const bounds = await page.evaluate(() => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom }; };
        return { ai: box('#aiToolsSection'), dock: box('.primary-tools'), zoom: box('#canvasZoomControls'), space: box('.shell-dock-space'), mode: document.body.dataset.shellDockLayout };
      });
      assert.ok(bounds.ai.right <= bounds.space.right + 1, `${scenario}: AI stays in available canvas`);
      assert.ok(bounds.zoom.x >= bounds.space.x - 1, `${scenario}: zoom stays in available canvas`);
      if (bounds.mode !== 'rows') {
        assert.ok(bounds.zoom.right <= bounds.dock.x && bounds.dock.right <= bounds.ai.x, `${scenario}: groups do not overlap`);
      }
      await page.screenshot({ path: path.join(out, `${scenario}.png`) });
    }
    await page.evaluate(() => window.PenEchoPageScale.apply(1, { persist: false }));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#craftsButton').isVisible(), false);
    assert.equal(await page.locator('#aiOrb').isVisible(), false);
    await page.evaluate(() => {
      window.manualAIClicks = 0;
      document.querySelector('#aiOrb').addEventListener('click', event => { event.stopImmediatePropagation(); window.manualAIClicks++; }, true);
    });
    await page.locator('#aiToolbarRun').click();
    assert.equal(await page.evaluate(() => window.manualAIClicks), 1);
    await page.evaluate(() => {
      document.querySelector('#aiEmbodiment').setAttribute('aria-busy', 'true');
      document.querySelector('#aiOrb').setAttribute('aria-label', 'Stop AI request');
      document.querySelector('#aiOrb').setAttribute('title', 'Stop AI request');
    });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#aiToolbarRun').getAttribute('aria-label'), 'Stop AI request');
    assert.equal(await page.locator('#aiToolbarRun').getAttribute('data-busy'), 'true');
    await page.locator('#aiToolbarRun').click();
    assert.equal(await page.evaluate(() => window.manualAIClicks), 2);
    await page.locator('#aiEffortButton').click();
    const menu = await page.locator('#effortPopover').boundingBox(), ai = await page.locator('#aiToolsSection').boundingBox();
    assert.ok(menu && menu.y + menu.height <= ai.y, 'effort menu opens above AI controls');
    assert.deepEqual(errors, []);
    console.log('Compact dock layout and merged AI action checks passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
