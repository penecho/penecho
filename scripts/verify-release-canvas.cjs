"use strict";
// Isolated release smoke: no user profile, Cloud saves, or real model requests.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-release-canvas-"));
const output = path.resolve(process.env.RELEASE_CANVAS_OUTPUT || path.join(root, "docs/verification/release-canvas"));
const report = { version:require("../package.json").version, checks:[], pageErrors:[], aiExamplesExecuted:false };
fs.mkdirSync(output, { recursive:true });
fs.writeFileSync(path.join(temporary, "config.env"), "");
const server = spawn(process.execPath, [path.join(root, "server.js")], {
  cwd:root,
  env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOST:"127.0.0.1", PORT:"0",
    PENECHO_STATE_DIR:path.join(temporary, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temporary, "state"),
    PENECHO_CONFIG_FILE:path.join(temporary, "config.env"), AI_PROVIDER:"api", AI_API_KEY:"fixture",
    AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"fixture", PENECHO_JEVISION_ENABLED:"false",
    PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false" },
  stdio:["ignore", "pipe", "pipe"],
});
let browser, activePage;
(async () => {
  try {
    const origin = await new Promise((resolve, reject) => {
      let log = "";
      const timer = setTimeout(() => reject(Error("Isolated server startup timed out")), 15000);
      server.stdout.on("data", chunk => {
        log += chunk;
        const match = log.match(/PenEcho: http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
      });
      server.once("exit", code => { clearTimeout(timer); reject(Error(`Isolated server exited: ${code}`)); });
    });
    browser = await chromium.launch({ headless:true });
    for (const [language, width, height] of [["en", 1440, 900], ["zh", 390, 844]]) {
      const context = await browser.newContext({ viewport:{ width, height } });
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        const local = ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === new URL(origin).port;
        return local ? route.continue() : route.abort();
      });
      // Exercise a first-time profile without a selected model, even though
      // the local execution service itself is available.
      await context.route(/\/api\/settings(?:\/connections)?$/, async route => {
        const response = await route.fetch(), body = await response.json();
        await route.fulfill({ response, json:{ ...body, connections:[], hasApiKey:false } });
      });
      await context.addInitScript(language => {
        if (window !== window.top || location.protocol !== "http:") return;
        localStorage.setItem("penecho-language", language);
        localStorage.setItem("penecho-changelog-seen", "1.4.0");
        localStorage.setItem("penecho-canvas-agent-auto-open", "false");
      }, language);
      const page = await context.newPage();
      activePage = page;
      page.on("pageerror", error => report.pageErrors.push(error.message));
      await page.goto(origin);
      await page.locator("#canvasWelcomeExamples").waitFor({ state:"visible" });
      const skipTour = page.getByRole("button", { name:/^(Skip tour|跳过导览)$/ });
      await skipTour.waitFor({ state:"visible" });
      await skipTour.click();
      await page.locator("#canvasWelcomeExampleList .example-card").first().waitFor();
      assert.equal(await page.locator("#canvasWelcomeExampleList .example-card").count(), 4);
      const photo = page.locator('#canvasWelcomeExampleList img[src="examples/qed-blackboard.jpg"]');
      await photo.waitFor();
      await photo.evaluate(image => image.decode());
      await page.screenshot({ path:path.join(output, `${language}-welcome.png`) });
      await page.locator("#canvasWelcomeExamplesAll").click();
      await page.locator("#examplesDialog[open]").waitFor();
      assert.equal(await page.locator("#examplesDialog .examples-dialog-group").count(), 4);
      const images = page.locator("#examplesDialog img");
      for (const image of await images.all()) await image.evaluate(element => element.decode());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path:path.join(output, `${language}-examples.png`) });
      await page.locator('#examplesDialog [data-example-id="photo-note"]').click();
      await page.locator("#exampleCoachSetup").waitFor({ state:"visible" });
      await page.screenshot({ path:path.join(output, `${language}-ai-setup-coach.png`) });
      await page.locator("#exampleCoachSetup").click();
      await page.locator("#settingsPageConnections").waitFor({ state:"visible" });
      assert.equal(await page.locator("#settingsNavConnections").getAttribute("aria-selected"), "true");
      await page.locator("#settingsClose").click();
      await page.locator('#smartSuggestLayer [data-suggestion="note"]').click();
      await page.locator("#settingsPageConnections").waitFor({ state:"visible" });
      assert.equal(await page.locator("#exampleDone").isVisible(), false);
      await page.locator("#settingsClose").click();
      await page.locator("#exampleCoachAll").click();
      await page.locator('#examplesDialog [data-example-id="agent-diagrams"]').click();
      await page.locator("#exampleCoachSetup").waitFor({ state:"visible" });
      // Submit through the real form event to verify the capture guard, even
      // when the ordinary Send button is disabled without a model.
      const submitAllowed = await page.locator("#canvasAgentForm").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles:true, cancelable:true })));
      assert.equal(submitAllowed, false);
      await page.locator("#settingsPageConnections").waitFor({ state:"visible" });
      assert.equal(await page.locator("#exampleDone").isVisible(), false);
      await page.locator("#settingsClose").click();
      await page.locator("#exampleCoachAll").click();
      await page.locator('#examplesDialog [data-example-id="functions"]').click();
      await page.locator('#smartSuggestLayer [data-suggestion="plot"]').waitFor({ state:"visible" });
      await page.locator('#smartSuggestLayer [data-suggestion="plot"]').click();
      await page.locator('#exampleDone[data-example-id="functions"]').waitFor({ state:"visible" });
      await page.locator(".canvas-widget-frame").waitFor({ state:"visible" });
      const graph = page.frameLocator(".canvas-widget-frame").frameLocator("iframe").locator("#c");
      await graph.waitFor({ state:"visible" });
      await graph.evaluate(canvas => {
        if (!canvas.width || !canvas.height) throw Error("Graph has no pixel buffer");
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        if (!data.some((value, index) => index % 4 === 3 && value)) throw Error("Graph pixel buffer is empty");
      });
      await page.waitForFunction(() => [...document.querySelectorAll(".canvas-widget")].some(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.top < innerHeight && rect.right > 0 && rect.bottom > 0;
      }));
      await page.screenshot({ path:path.join(output, `${language}-instant-graph.png`) });
      report.checks.push(`${language} ${width}px: welcome cards, both photo assets, four categories, no page overflow, AI setup button and note action, Agent submit guard, instant graph result without a model`);
      await context.close();
    }
    assert.deepEqual(report.pageErrors, []);
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = String(error.message || error);
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path:path.join(output, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close();
    if (server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolve => server.once("exit", resolve));
      server.kill();
      await exited;
    }
    fs.rmSync(temporary, { recursive:true, force:true });
    fs.writeFileSync(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
  }
})();
