"use strict";

const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-mcp-toggle-"));
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:path.join(directory,"state"),
  HOST:"127.0.0.1", PORT:"0", AI_PROVIDER:"api", AI_API_KEY:"test",
  AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"test",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false"
});
const server = require("../server.js");

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    const source = fs.readFileSync(path.join(__dirname,"../public/app.js"),"utf8")
      .replace(/\}\)\(\);\s*$/, "window.mcpToggleTest={mcpRuntime,mcpRenderToolbar};})();");
    await page.route("**/app.js", route => route.fulfill({contentType:"application/javascript",body:source}));
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:"networkidle"});
    await page.waitForFunction(() => !!window.mcpToggleTest);
    await page.evaluate(() => {
      document.querySelector("#tourSkip")?.click();
      document.querySelector("#changelogClose")?.click();
      const {mcpRuntime, mcpRenderToolbar} = window.mcpToggleTest;
      mcpRuntime.socket={readyState:1,availability:{local:true,cloud:false},close(){}};
      mcpRuntime.ready=true; mcpRuntime.wanted=true;
      mcpRuntime.status={http:{localUrl:"https://localhost:8080/mcp"}};
      mcpRenderToolbar();
    });
    const button = page.locator("#mcpToolbarToggle");
    const open = () => page.locator("#mcpStatusPopover").evaluate(panel => panel.matches(":popover-open"));
    await button.click();
    assert.equal(await open(),true,"First click opens MCP details");
    await button.click();
    assert.equal(await open(),false,"Second click closes MCP details");
    assert.equal(await button.getAttribute("aria-expanded"),"false");
    assert.equal(await page.evaluate(() => window.mcpToggleTest.mcpRuntime.wanted),true,"Closing details preserves MCP connection");
    await button.click();
    assert.equal(await open(),true,"Third click reopens MCP details");
    await page.keyboard.press("Escape");
    assert.equal(await open(),false,"Escape closes MCP details");
    await button.focus();
    await page.keyboard.press("Enter");
    assert.equal(await open(),true,"Enter opens MCP details");
    await page.keyboard.press("Enter");
    assert.equal(await open(),false,"Enter closes MCP details");
    console.log("MCP pointer and keyboard toggle, connection state, and Escape: passed");
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
