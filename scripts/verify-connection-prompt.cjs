"use strict";
// Exercise the canonical bundle in isolated local and Cloud-configured shells.
// Test hooks and mocked services exist only in the browser's intercepted responses.
const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-connection-prompt-"));
Object.assign(process.env, {
  NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_STATE_DIR:directory, PENECHO_CLOUD_STATE_DIR:directory,
  PENECHO_CONFIG_FILE:path.join(directory, "config.env"), HOST:"127.0.0.1", PORT:"0",
  AI_PROVIDER:"", AI_API_KEY:"", AI_API_URL:"", AI_API_MODEL:"", PENECHO_OPEN_CONNECTIONS:"false",
  PENECHO_CANVAS_AGENT_AUTO_OPEN:"false", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false",
});
const server = require("../server.js");
const hostedId = "22222222-2222-4222-8222-222222222222";
const source = fs.readFileSync(path.resolve(__dirname, "../public/app.js"), "utf8").replace(/\}\)\(\);\s*$/, `
  window.connectionTest = {
    state, settings, hostedSettings, requestAI, launchAutomaticAI, closeSettings, loadCanvasSettings, loadHostedModels,
    canvasDocumentsReady, canvasDocumentsCurrent, canvasAgentSubmitMessage, selectedAiConnectionId, storeAiConnectionSelection, canvasAgent,
    async mcpOpen(args) {
      const previous = mcpRuntime.socket, socket = { readyState:WebSocket.OPEN, send(){} };
      mcpRuntime.socket = socket;
      try { return await canvasDocumentsExecute("mcp_open_canvas", args, { kind:"mcp", socket, generation:mcpRuntime.generation, controller:new AbortController() }); }
      finally { mcpRuntime.socket = previous; }
    },
    bindExternal() {
      canvasDocumentsCurrent().processor = { kind:"external", bindingKey:"test-binding", client:"Acceptance MCP" };
      canvasDocumentsRender();
    },
  };
})();`);
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listening ? resolve() : server.once("listening", resolve));
    browser = await chromium.launch({ headless:true });
    const checks = [];
    for (const runtime of ["local", "cloud"]) {
      const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
      const page = await context.newPage(), errors = [], requests = [];
      let staleResponse = false;
      page.on("pageerror", error => errors.push(error.message));
      await page.route(/^https:\/\//, route => route.abort());
      await page.route("**/api/config.js", async route => {
        const response = await route.fetch();
        await route.fulfill({ contentType:"application/javascript", body:await response.text() + `
          Object.assign(window.PENECHO_CONFIG, ${JSON.stringify({ runtime, connectionAccountId:"test-account", canvasAgent:runtime === "local", hostedCanvasAgent:true, browserCanvasEditing:runtime === "cloud", linkedDeviceOnline:false, remoteCanvasNativeReads:true, smartSuggestions:false })});` });
      });
      await page.route("**/app.js*", route => route.fulfill({ contentType:"application/javascript", body:source }));
      await page.route(/\/api\/(cloud\/models|v1\/models)$/, route => route.fulfill({ json:{ accountId:"test-account", models:[{ id:hostedId, displayName:"Test hosted model", available:true, enabled:true, multiplier:1, sortOrder:5 }], credits:{ available:10 } } }));
      await page.route("**/api/ai/command", route => {
        requests.push(route.request().headers()["x-penecho-connection"]);
        return route.fulfill(staleResponse
          ? { status:409, json:{ error:"AI service rejected the request (HTTP 409).", errorCode:"CONNECTION_STALE" } }
          : { status:400, json:{ message:"Acceptance request received" } });
      });
      await page.addInitScript(() => { if (window.top === window) { localStorage.setItem("penecho-language", "en"); localStorage.setItem("penecho-theme", "studio"); } });
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil:"domcontentloaded" });
      await page.waitForFunction(() => Boolean(window.connectionTest));
      await page.evaluate(async () => { await connectionTest.canvasDocumentsReady(); await connectionTest.loadCanvasSettings(); await connectionTest.loadHostedModels(); });
      const modal = page.locator("#settingsLayer");
      assert.equal(await modal.isVisible(), false, `${runtime}: startup does not prompt`);

      const first = await page.evaluate(() => connectionTest.mcpOpen({ create:true, requestId:"test-first", title:"MCP first canvas", show:true }));
      const second = await page.evaluate(() => connectionTest.mcpOpen({ create:true, requestId:"test-second", title:"MCP second canvas", show:true }));
      await page.evaluate(id => connectionTest.mcpOpen({ documentId:id, show:true }), first.documentId);
      await page.evaluate(() => connectionTest.loadCanvasSettings());
      assert.equal(await modal.isVisible(), false, `${runtime}: MCP new/open/switch does not prompt`);
      assert.notEqual(first.documentId, second.documentId);
      checks.push(`${runtime}: startup and MCP new/open/switch remain quiet`);

      for (const id of ["11111111-1111-4111-8111-111111111111", "hosted:11111111-1111-4111-8111-111111111111"]) {
        await page.evaluate(id => { connectionTest.storeAiConnectionSelection(id); return connectionTest.requestAI("assist"); }, id);
        assert.equal(await modal.isVisible(), true, `${runtime}: removed selection opens Connections`);
        assert.deepEqual(requests, []);
        await page.locator("#settingsClose").click();
      }
      checks.push(`${runtime}: saved IDs absent from the catalog prompt before sending`);

      await page.evaluate(() => connectionTest.requestAI("assist"));
      assert.equal(await modal.isVisible(), true);
      assert.equal(await page.evaluate(() => connectionTest.settings.activePage), "connections");
      assert.deepEqual(requests, []);
      await page.locator("#settingsClose").click();
      await page.evaluate(() => { Object.assign(connectionTest.state, { auto:true, autoEligible:true, mode:"pen", dirty:{ x:20, y:20, w:50, h:50 } }); connectionTest.launchAutomaticAI("test-auto"); });
      assert.equal(await modal.isVisible(), true, `${runtime}: Auto AI opens Connections`);
      await page.locator("#settingsClose").click();
      await page.evaluate(() => connectionTest.launchAutomaticAI("same-ink"));
      assert.equal(await modal.isVisible(), false, `${runtime}: same ink does not reopen it`);
      assert.equal(await page.evaluate(() => Boolean(connectionTest.state.dirty)), true);
      checks.push(`${runtime}: manual and Auto AI prompt before sending, preserving ink`);

      await page.locator("#canvasAgentToggle").click();
      await page.waitForFunction(() => document.querySelector("#canvasAgentPanel").getAttribute("aria-hidden") === "false" && !document.querySelector("#canvasAgentPanel").inert);
      await page.locator("#canvasAgentInput").fill("Keep this Agent draft");
      await page.waitForFunction(() => !document.querySelector("#canvasAgentSend").disabled).catch(async error => {
        console.error(JSON.stringify(await page.evaluate(() => ({
          value:document.querySelector("#canvasAgentInput").value, inputDisabled:document.querySelector("#canvasAgentInput").disabled,
          selected:connectionTest.selectedAiConnectionId(), attachmentBusy:connectionTest.canvasAgent.attachmentBusy,
          projectUploadBusy:connectionTest.canvasAgent.projectUploadBusy, config:window.PENECHO_CONFIG,
        }))), runtime, errors);
        throw error;
      });
      await page.locator("#canvasAgentSend").click();
      assert.equal(await modal.isVisible(), true);
      assert.equal(await page.locator("#canvasAgentInput").inputValue(), "Keep this Agent draft");
      const screenshot = process.env.PENECHO_CONNECTION_SCREENSHOT;
      if (screenshot && runtime === "cloud") await page.screenshot({ path:screenshot });
      await page.locator("#settingsClose").click();
      await page.evaluate(() => connectionTest.bindExternal());
      await page.locator("#canvasAgentInput").fill("Queue this for external MCP");
      await page.locator("#canvasAgentSend").click();
      await page.waitForFunction(() => connectionTest.canvasDocumentsCurrent().messages.some(message => message.text === "Queue this for external MCP" && message.status === "queued"));
      assert.equal(await modal.isVisible(), false);
      assert.deepEqual(requests, []);
      checks.push(`${runtime}: Agent preserves drafts and external MCP queues without prompting`);

      await page.evaluate(() => connectionTest.requestAI("assist"));
      await page.locator(`[data-connection-activate="hosted:${hostedId}"]`).click();
      assert.equal(await modal.isVisible(), false);
      await page.evaluate(() => connectionTest.requestAI("assist", { changedBox:{ x:20, y:20, w:50, h:50 }, sourceRect:{ x:0, y:0, w:100, h:100 } }));
      assert.deepEqual(requests, [`hosted:${hostedId}`]);
      assert.equal(await modal.isVisible(), false);
      assert.deepEqual(errors, []);
      checks.push(`${runtime}: selecting a model allows the next manual request`);
      staleResponse = true;
      await page.evaluate(() => connectionTest.requestAI("assist", { changedBox:{ x:20, y:20, w:50, h:50 }, sourceRect:{ x:0, y:0, w:100, h:100 } }));
      assert.equal(await modal.isVisible(), true, `${runtime}: server-side deletion reopens Connections`);
      assert.equal(await page.evaluate(() => connectionTest.state.statusKey), "canvasAgentChooseConnection");
      assert.equal(requests.length, 2);
      checks.push(`${runtime}: a stale-connection 409 opens the chooser instead of a generic error`);
      await context.close();
    }
    console.log(JSON.stringify({ checks }, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    fs.rmSync(directory, { recursive:true, force:true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
