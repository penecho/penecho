"use strict";
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-palettes-"));
Object.assign(process.env, {
  NODE_ENV: "test", PENECHO_TEST_OPEN_ACCESS: "1", PENECHO_STATE_DIR: path.join(directory, "state"),
  PENECHO_CLOUD_STATE_DIR: path.join(directory, "cloud"), HOST: "127.0.0.1", PORT: "0",
  AI_PROVIDER: "api", AI_API_KEY: "test", AI_API_URL: "http://127.0.0.1:1/v1", AI_API_MODEL: "test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN: "false", PENECHO_REQUEST_TRACE: "false",
});
const server = require("../server.js");
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1228, height: 918 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      document.querySelector("#tourSkip")?.click();
      document.querySelector("#changelogClose")?.click();
    });
    await page.locator("#settingsBtn").click();
    const cards = page.locator(".studio-palette-option");
    const palettes = await cards.evaluateAll(elements => elements.map(el => el.dataset.studioPalette));
    assert.equal(palettes.length, 12);
    assert.equal(new Set(palettes).size, 12);
    const accents = new Set();
    for (const palette of palettes) {
      await page.locator(`.studio-palette-option[data-studio-palette="${palette}"]`).click();
      const applied = await page.evaluate(() => ({
        selected: [...document.querySelectorAll('.studio-palette-option[aria-checked="true"]')].map(el => el.dataset.studioPalette),
        body: document.body.dataset.studioPalette,
        stored: localStorage.getItem("penecho-studio-palette"),
        accent: getComputedStyle(document.body).getPropertyValue("--studio-accent").trim(),
      }));
      assert.deepEqual(applied.selected, [palette]);
      assert.equal(applied.body, palette);
      assert.equal(applied.stored, palette);
      assert.ok(applied.accent.startsWith("#"));
      accents.add(applied.accent);
    }
    assert.equal(accents.size, 12);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("body").getAttribute("data-studio-palette"), "olive");
    await page.locator("#settingsBtn").click();
    await page.locator('.studio-palette-option[data-studio-palette="teal"]').click();
    await page.locator('#settingsPanel [data-language="en"]').click();
    await page.screenshot({ path: path.join(directory, "appearance-en.png") });
    await page.locator('#settingsPanel [data-language="zh"]').click();
    assert.equal(await page.locator('[data-i18n="studioPalettePlum"]').textContent(), "梅紫");
    await page.screenshot({ path: path.join(directory, "appearance-zh.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.studio-palette-option[data-studio-palette="olive"]').click();
    assert.equal(await page.locator('.studio-palette-option[aria-checked="true"]').count(), 1);
    const overflow = await page.locator(".studio-palette-grid").evaluate(el => el.scrollWidth > el.clientWidth);
    assert.equal(overflow, false, "Palette grid fits a narrow viewport");
    await page.screenshot({ path: path.join(directory, "appearance-mobile.png") });
    console.log(JSON.stringify({ passed: true, palettes: palettes.length, screenshots: directory }));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(path.join(directory, "state"), { recursive: true, force: true });
    fs.rmSync(path.join(directory, "cloud"), { recursive: true, force: true });
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
