#!/usr/bin/env node
"use strict";
// The Canvas after the old PenEcho Agent panel was taken out. This checks, in a real browser against a real server:
// the panel and its launcher are gone and the buttons that shared its toolbar group are still there; the page raises
// no error on load, on a stroke, or on opening the line beside the Canvas; a lasso and an Ask still run the Agent's
// engine, show what it is doing, can be stopped, and land their result on the Canvas; and the chats the panel had
// saved in this browser are still there, byte for byte.
//
// The model is a stand-in: the engine's socket (/api/canvas-agent/socket) is answered by this script, which plays
// the server's side of one turn (ready, turn start, a tool call the page really runs, the turn's end). The page,
// its files, the project, the Canvas file and the line beside it all come from the real server.
//   NODE_PATH=/path/to/node_modules node scripts/verify-canvas-without-agent-panel.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createHash } = require("node:crypto");
const { validateToolArguments } = require("../src/server/mcp/schema.js");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-no-agent-panel-"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 5700 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "docs"), source = "files/canvases/canvas-1.penecho.json", file = path.join(docs, source);
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 400)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(80); }
}
const soon = async (fn, ms = 8000) => { try { await until(fn, "", ms); return true; } catch { return false; } };

// What the panel had saved in this browser: two chats on one Canvas, with spacing and an order no code of ours would write.
const HISTORY_KEY = "penecho-canvas-agent-history-v1";
const HISTORY = `{"version":1,  "canvases":{"workspace:doc-kept":[{"id":"chat-1","createdAt":1730000000000,"updatedAt":1730000100000,"title":"Plan the launch","items":[{"id":"m1","type":"message","role":"user","text":"Plan the launch","attachmentCount":0,"eventKey":""},{"id":"m2","type":"message","role":"assistant","text":"Three steps.","attachmentCount":0,"eventKey":"1:0:a","final":true,"copyable":true}]},{"id":"chat-2","createdAt":1729000000000,"updatedAt":1729000100000,"title":"旧的对话","items":[{"id":"m3","type":"message","role":"user","text":"旧的对话","attachmentCount":0,"eventKey":""}]}]},"canvasMeta":{"workspace:doc-kept":{"name":"Launch","updatedAt":1730000100000}}}`;

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PENECHO_CONFIG_FILE:path.join(temp, "config.env"), PORT:String(PORT), HOST:"127.0.0.1", AI_PROVIDER:"api", AI_API_KEY:"test-only", AI_API_URL:"http://127.0.0.1:1/v1", AI_API_MODEL:"stand-in", PENECHO_REQUEST_TRACE:"false", PENECHO_JEVISION_ENABLED:"false", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

// ---------- The stand-in for the model and the server's side of the Agent's socket ----------
// One object per page socket. `plan` says what the next turn does: "answer" runs a tool and ends; "hold" starts a
// tool and waits to be stopped.
const standIn = { sockets:0, turns:[], heard:[], plan:"answer", cancels:0, toolResults:[], held:null };
function playAgent(ws) {
  standIn.sockets++;
  let seq = 0, sessionId = `stand-in-${standIn.sockets}`, turn = 0;
  const waiting = new Map();
  const send = (type, payload = {}) => ws.send(JSON.stringify({ version:1, type, canvasSessionId:sessionId, seq:++seq, payload }));
  const event = payload => send("session_event", payload);
  const ready = said => send("ready", { handshakeId:said.payload.handshakeId, resumeToken:"stand-in", connectionId:said.payload.connectionId, engine:"harness", model:"stand-in", channel:"api", accessMode:"controlled", webSearchConfigured:false, webSearchEnabled:false });
  const tool = (callId, name, args, step) => new Promise(resolve => {
    const requestId = `${callId}-request`;
    event({ kind:"tool_call", callId, name, arguments:args, turn, step });
    waiting.set(requestId, resolve);
    send("tool_request", { requestId, callId, name, arguments:args });
  });
  async function runTurn(said) {
    turn++;
    standIn.turns.push({ text:said.payload.text, images:(said.payload.images || []).length, references:said.payload.references });
    event({ kind:"turn_start", turn });
    await wait(150);
    event({ kind:"assistant_delta", turn, step:0, text:"Progress: Reading what you circled" });
    await wait(500);
    event({ kind:"assistant_message", turn, step:0, text:"Progress: Reading what you circled" });
    const seen = await tool(`call-${turn}-look`, "canvas_inspect", { scope:"viewport" }, 1);
    event({ kind:"tool_result", callId:`call-${turn}-look`, text:"ok" });
    if (standIn.plan === "hold") {
      // A long tool: it only ends when the person stops the turn.
      event({ kind:"tool_call", callId:`call-${turn}-search`, name:"research_search", arguments:{ query:"a slow question" }, turn, step:2 });
      standIn.held = () => { event({ kind:"tool_result", callId:`call-${turn}-search`, error:"cancelled" }); event({ kind:"assistant_message", turn, step:3, text:"Stopped.", interrupted:true }); event({ kind:"turn_end", turn, reason:{ kind:"cancelled" } }); };
      return;
    }
    await wait(700);
    // The same call the real engine makes for penecho_edit_canvas: checked by the server's own schema, then run by the page.
    const binding = `agent-${"a".repeat(64)}`, edit = validateToolArguments("penecho_edit_canvas", { sessionId:binding, requestId:`answer-${standIn.sockets}-${turn}`, action:"create_text", text:"Stand-in answer: two strokes" });
    event({ kind:"tool_call", callId:`call-${turn}-write`, name:"penecho_edit_canvas", arguments:edit, turn, step:2 });
    const made = await new Promise(resolve => { waiting.set(`call-${turn}-write-request`, resolve); send("tool_request", { requestId:`call-${turn}-write-request`, callId:`call-${turn}-write`, name:"canvas_document", arguments:{ operation:"mcp_edit_canvas", bindingKey:binding, arguments:edit } }); });
    standIn.toolResults.push({ ...made, inspected:seen.ok === true });
    event({ kind:"tool_result", callId:`call-${turn}-write`, ...(made.ok ? { text:"created" } : { error:made.error }) });
    await wait(300);
    event({ kind:"assistant_message", turn, step:3, text:"Done. I wrote the answer beside what you circled." });
    event({ kind:"turn_end", turn, reason:{ kind:"completed" } });
  }
  ws.onMessage(message => {
    let said; try { said = JSON.parse(message); } catch { return; }
    standIn.heard.push(said.type);
    if (["hello", "new_conversation", "change_connection", "change_context"].includes(said.type)) ready(said);
    else if (said.type === "user_turn") runTurn(said).catch(error => { standIn.error = String(error); });
    else if (said.type === "tool_result") { const resolve = waiting.get(said.payload.requestId); waiting.delete(said.payload.requestId); resolve?.(said.payload); }
    else if (said.type === "cancel") { standIn.cancels++; const held = standIn.held; standIn.held = null; held?.(); }
  });
}

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const errors = [], signedOut = [];
  const watch = (page, tag) => {
    page.on("pageerror", e => errors.push(`${tag}: ${e.message}`));
    page.on("console", m => {
      if (m.type() !== "error") return;
      const said = `${tag} console: ${m.text()} ${m.location()?.url || ""}`;
      // Nobody is signed in to PenEcho Cloud here, and the browser itself notes each 401 the Cloud routes answer with.
      // That note is there on main too and is not the page failing; it is counted and said at the end.
      if (/status of 401/.test(m.text()) && /\/api\/cloud\//.test(m.location()?.url || "")) signedOut.push(said); else errors.push(said);
    });
  };
  const settle = async (page, ms = 2500) => {
    await page.waitForSelector("#viewport");
    await wait(ms);
    await page.keyboard.press("Escape");
    for (const closer of [page.getByRole("button", { name:"Skip tour" }), page.getByRole("button", { name:"跳过导览" }), page.locator("#changelogLayer button").first()]) if (await closer.isVisible().catch(() => false)) { await closer.click().catch(() => {}); await wait(300); }
  };
  const drag = async (page, points, pause = 8) => {
    await page.mouse.move(points[0][0], points[0][1]); await page.mouse.down();
    for (const [x, y] of points.slice(1)) { await page.mouse.move(x, y); await wait(pause); }
    await page.mouse.up();
  };
  const line = (x, y, dx, dy, steps = 20) => Array.from({ length:steps + 1 }, (_, i) => [x + dx * i / steps, y + dy * i / steps]);
  const loop = (cx, cy, rx, ry, steps = 48) => Array.from({ length:steps + 2 }, (_, i) => [cx + rx * Math.cos(i / steps * 2 * Math.PI), cy + ry * Math.sin(i / steps * 2 * Math.PI)]);
  const post = async (context, address, data) => (await context.request.post(`${base}${address}`, { data, headers:{ origin:base } })).json();
  const shown = (page, selector) => page.evaluate(s => { const el = document.querySelector(s); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden"); }, selector);
  const stored = page => page.evaluate(key => localStorage.getItem(key), HISTORY_KEY);
  const textIn = target => { try { return fs.readFileSync(target, "utf8").includes("Stand-in answer: two strokes"); } catch { return false; } };
  // The ink of a Canvas file, as one value: it changes when a stroke is added.
  const inkIn = target => { try { const bundle = JSON.parse(fs.readFileSync(target, "utf8")); return createHash("sha256").update(JSON.stringify((bundle.assets || []).filter(asset => asset.kind === "tile"))).digest("hex"); } catch { return ""; } };

  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  await context.routeWebSocket(/\/api\/canvas-agent\/socket/, playAgent);
  // The classifier that decides who answers an Ask is a stand-in too: it always sends the Ask to the Agent's engine.
  await context.route("**/api/suggest/status", route => route.fulfill({ json:{ configured:true, model:"stand-in" } }));
  await context.route("**/api/suggest", route => route.fulfill({ json:{ ok:true, model:"stand-in", answers:{ execution:{ type:"choice", choice:"penecho_agent" } } } }));
  await context.addInitScript(([key, value]) => {
    if (window.top !== window) return;
    try {
      localStorage.setItem("penecho-language", "en");
      if (!localStorage.getItem("penecho-lines-panel")) localStorage.setItem("penecho-lines-panel", "0");
      // Put there once, before any page code runs; never again, so a page that rewrote it would be caught.
      if (!localStorage.getItem("verify-history-seeded")) { localStorage.setItem(key, value); localStorage.setItem("verify-history-seeded", "1"); }
    } catch { /* The checks below say so. */ }
  }, [HISTORY_KEY, HISTORY]);

  const made = await post(context, "/api/lines/projects", { name:"Weather app", docsPath:docs });
  const id = made.project.id;
  const first = await post(context, `/api/lines/projects/${id}/yours`, { kind:"note", text:"Forecast screen layout\n\nThree cards across.", topic:"new" });
  const canvasAddress = `${base}/?${new URLSearchParams({ linesProject:id, linesCanvas:source, linesTitle:"Canvas 1", linesBack:id, linesDoc:`lines/${first.slug}.md` })}`;

  console.log("\nThe page");
  const page = await context.newPage(); watch(page, "canvas");
  await page.goto(canvasAddress);
  await settle(page);
  check("there is no Agent panel in the page", await page.locator("#canvasAgentPanel").count() === 0);
  check("there is no Agent launcher in the toolbar", await page.locator("#canvasAgentToggle").count() === 0);
  check("nothing else of the panel is left in the page", await page.evaluate(() => document.querySelectorAll('[id^="canvasAgent"]:not(#canvasAgentControl):not(#canvasAgentToolbarHome):not(#canvasAgentActivityOverlay), [data-shell-forward="#canvasAgentToggle"], #studioNavigatorAgentTab, #studioNavigatorAgentPanel, #canvasWelcomeAgent').length) === 0,
    await page.evaluate(() => [...document.querySelectorAll('[id^="canvasAgent"]:not(#canvasAgentControl):not(#canvasAgentToolbarHome):not(#canvasAgentActivityOverlay), [data-shell-forward="#canvasAgentToggle"], #studioNavigatorAgentTab, #studioNavigatorAgentPanel, #canvasWelcomeAgent')].map(el => el.id || el.outerHTML.slice(0, 60)).join(", ")));
  check("the MCP button is still in the toolbar", await shown(page, "#mcpToolbarToggle"));
  check("the saved chats are as they were after the page loaded", await stored(page) === HISTORY);
  check("the page loaded without an error", errors.length === 0, errors.join(" | "));

  console.log("\nA stroke, and the line beside the Canvas");
  const before = errors.length;
  const box = await page.locator("#viewport").boundingBox();
  // Above the example cards an empty Canvas shows, where a press is a stroke and not a click. The line's panel is open beside it.
  const cx = Math.round(box.x + box.width * 0.42), cy = Math.round(box.y + 90);
  await soon(() => inkIn(file) !== "", 15000);
  const inkBefore = inkIn(file);
  await page.locator("#penToolBtn").click();
  await drag(page, line(cx - 60, cy - 20, 120, 30));
  await drag(page, line(cx - 50, cy + 30, 100, -10));
  check("the stroke is saved to the project folder", await soon(() => inkIn(file) !== inkBefore, 20000), inkBefore ? "" : "the Canvas file was never written");
  check("drawing raised no error", errors.length === before, errors.slice(before).join(" | "));
  check("the saved chats are as they were after the Canvas saved", await stored(page) === HISTORY);
  const beforePanel = errors.length;
  // The line opens with the Canvas; the button only closes and opens it again.
  const panelOpened = await soon(() => shown(page, "#projectLinesPanel"));
  check("the line opens beside the Canvas", panelOpened);
  if (panelOpened) {
    const frame = page.frameLocator("#projectLinesPanel iframe");
    check("and it shows the line", await frame.locator("body").evaluate(body => body.innerText.includes("Forecast screen layout")).catch(() => false) || await soon(() => frame.locator("body").evaluate(body => body.innerText.includes("Forecast screen layout")).catch(() => false)));
    await wait(600);
    await page.screenshot({ path:path.join(shots, "line-panel-open-1440.png") });
  }
  check("opening the line raised no error", errors.length === beforePanel, errors.slice(beforePanel).join(" | "));
  await page.locator(".project-lines-panel-button").click();
  await soon(async () => !(await shown(page, "#projectLinesPanel")));

  console.log("\nLasso, then Ask");
  const beforeAsk = errors.length;
  const ask = async text => {
    await page.locator("#lassoToolBtn").click();
    await drag(page, loop(cx, cy + 5, 130, 80), 6);
    const open = page.locator("#smartSuggestLayer .assist-ask button").first();
    await open.waitFor({ timeout:10000 });
    await open.click();
    const input = page.locator("#smartSuggestLayer .assist-ask input");
    await input.waitFor({ timeout:5000 });
    await input.fill(text);
    await input.press("Enter");
  };
  await ask("What did I draw?");
  // The last thing the card says when a turn has ended (the activity layer's words for "done").
  const card = page.locator("#assistAgentMini"), finished = /Leaving the canvas view|Finished/;
  check("the Ask starts the Agent's engine", await soon(() => standIn.turns.length === 1, 20000), `heard: ${standIn.heard.join(",")} ${standIn.error || ""}`);
  check("the Ask reached it with the picture of what was circled", standIn.turns[0]?.text.includes("What did I draw?") && standIn.turns[0]?.images === 1, JSON.stringify(standIn.turns[0] || {}).slice(0, 300));
  check("a card on the Canvas says the Agent is working", await soon(() => card.isVisible()));
  check("the card has a Stop button, and no button that opens a panel", await card.locator("button").count() === 1 && await card.locator('button[aria-label="Stop and close"]').count() === 1, await card.locator("header").innerHTML().catch(() => ""));
  check("the card shows the model's own progress line", await soon(async () => (await card.locator(".assist-agent-mini-status").innerText()).includes("Reading what you circled"), 5000), await card.locator(".assist-agent-mini-status").innerText().catch(() => ""));
  await page.screenshot({ path:path.join(shots, "lasso-ask-working-1440.png") });
  check("then the tool it is running", await soon(async () => /Inspect|Edit/i.test(await card.locator(".assist-agent-mini-status").innerText()), 5000), await card.locator(".assist-agent-mini-status").innerText().catch(() => ""));
  check("the tools ran on the page and wrote to the Canvas", await soon(() => standIn.toolResults.length === 1, 15000) && standIn.toolResults[0]?.ok === true && standIn.toolResults[0]?.inspected === true, JSON.stringify(standIn.toolResults[0] || {}).slice(0, 400));
  check("the card says when the turn has ended", await soon(async () => finished.test(await card.locator(".assist-agent-mini-status").innerText()), 8000), await card.locator(".assist-agent-mini-status").innerText().catch(() => ""));
  await page.screenshot({ path:path.join(shots, "lasso-ask-done-1440.png") });
  check("the answer is in the Canvas file", await soon(() => textIn(file), 20000));
  check("the run raised no error", errors.length === beforeAsk, errors.slice(beforeAsk).join(" | "));
  await card.locator("button").click();
  check("the card closes", await soon(async () => !(await card.isVisible())));

  console.log("\nStop");
  const beforeStop = errors.length;
  standIn.plan = "hold";
  await page.keyboard.press("Escape");
  await ask("Look this up for me");
  check("a second Ask starts a second turn", await soon(() => standIn.turns.length === 2, 20000), `heard: ${standIn.heard.slice(-8).join(",")}`);
  check("the card shows the tool that is running", await soon(async () => /Search/i.test(await card.locator(".assist-agent-mini-status").innerText()), 8000), await card.locator(".assist-agent-mini-status").innerText().catch(() => ""));
  await page.screenshot({ path:path.join(shots, "lasso-ask-stop-1440.png") });
  await card.locator("button").click();
  check("Stop tells the engine to cancel the turn", await soon(() => standIn.cancels === 1, 8000), `cancels: ${standIn.cancels}`);
  check("and the card is gone", await soon(async () => !(await card.isVisible())));
  await wait(800);
  check("stopping raised no error", errors.length === beforeStop, errors.slice(beforeStop).join(" | "));
  standIn.plan = "answer";
  await page.keyboard.press("Escape");
  await ask("And again, after a stop");
  check("an Ask after a stop runs again", await soon(() => standIn.turns.length === 3, 20000) && await soon(() => standIn.toolResults.length === 2 && standIn.toolResults[1]?.ok === true, 15000), JSON.stringify(standIn.toolResults[1] || {}).slice(0, 300));
  await soon(async () => finished.test(await card.locator(".assist-agent-mini-status").innerText()), 8000);
  await card.locator("button").click().catch(() => {});

  console.log("\nThe chats the panel had saved");
  await wait(1500);
  check("they are still there, byte for byte, after three runs", await stored(page) === HISTORY, (await stored(page) || "(gone)").slice(0, 200));
  await page.reload(); await settle(page, 1500);
  check("and after the page is opened again", await stored(page) === HISTORY);
  check("no request went to the panel's server routes", !/\/api\/canvas-agent\/(?:projects|files|roots|history)/.test(serverLog), (serverLog.match(/\/api\/canvas-agent\/\S+/g) || []).join(" "));
  const asked = [];
  page.on("request", request => { if (/\/api\/canvas-agent\/(?!socket)/.test(request.url())) asked.push(request.url()); });
  await page.reload(); await settle(page, 1500);
  check("the page asks the server for nothing of the panel's", asked.length === 0, asked.join(" "));

  console.log("\nThe toolbar");
  for (const [width, lang] of [[1440, "en"], [900, "en"], [1440, "zh"], [900, "zh"]]) {
    const look = await browser.newContext({ viewport:{ width, height:900 } });
    await look.routeWebSocket(/\/api\/canvas-agent\/socket/, playAgent);
    await look.addInitScript(language => { if (window.top !== window) return; try { localStorage.setItem("penecho-language", language); localStorage.setItem("penecho-lines-panel", "0"); } catch { /* Only the language. */ } }, lang);
    const view = await look.newPage(); watch(view, `toolbar ${lang} ${width}`);
    await view.goto(canvasAddress); await settle(view);
    const group = await view.evaluate(() => {
      const rect = selector => { const el = document.querySelector(selector); if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { left:Math.round(r.left), right:Math.round(r.right), top:Math.round(r.top), bottom:Math.round(r.bottom) }; };
      const toolbar = document.querySelector(".toolbar");
      return { mcp:rect("#mcpToolbarToggle"), control:rect("#canvasAgentControl"), toolbar:rect(".toolbar"), overflow:toolbar ? toolbar.scrollWidth - toolbar.clientWidth : null, width:innerWidth, launcher:Boolean(document.querySelector("#canvasAgentToggle")) };
    });
    check(`the MCP button is whole and inside the window (${lang}, ${width})`, Boolean(group.mcp) && group.mcp.left >= 0 && group.mcp.right <= group.width && group.mcp.bottom - group.mcp.top >= 24 && !group.launcher, JSON.stringify(group));
    check(`the toolbar does not scroll sideways (${lang}, ${width})`, group.overflow !== null && group.overflow <= 1, JSON.stringify(group));
    await view.screenshot({ path:path.join(shots, `toolbar-${lang}-${width}.png`) });
    await look.close();
  }

  check("no page had an error in the whole run", errors.length === 0, errors.join(" | "));
  if (signedOut.length) console.log(`  (not counted: ${signedOut.length} notes from the browser that /api/cloud answered 401, as it does for anyone not signed in)`);
  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  console.log(`Screenshots: ${shots}`);
  if (failures.length) { console.log(failures.map(f => ` - ${f}`).join("\n")); process.exitCode = 1; }
})().catch(error => { console.error(error); console.log(serverLog.slice(-1500)); process.exitCode = 1; }).finally(() => { server.kill(); try { fs.rmSync(path.join(temp, "state"), { recursive:true, force:true }); } catch { /* A temp folder. */ } });
