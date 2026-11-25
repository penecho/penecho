#!/usr/bin/env node
"use strict";
// A Canvas opened from a project saves itself to the project's folder. This checks when it does, in a real browser:
// it waits for a still pen, writes the picture a little later, never sends while you draw, and leaves nothing behind when you go.
//   NODE_PATH=/path/to/node_modules node scripts/verify-project-canvas-save.cjs
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-canvas-save-"));
const PORT = 5100 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "docs"), source = "files/canvases/canvas-1.penecho.json";
const file = path.join(docs, source), picture = file.replace(/\.penecho\.json$/, ".png");
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 300)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(80); }
}
const tilesIn = () => { try { return (fs.readFileSync(file, "utf8").match(/"kind":"tile"/g) || []).length; } catch { return 0; } };
const stamp = target => { try { return fs.statSync(target).mtimeMs; } catch { return 0; } };

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  // The rail beside the Canvas has its own check (verify-canvas-rail.cjs). Hidden here, every stroke below lands where it always did.
  await context.addInitScript(() => { try { localStorage.setItem("penecho-lines-projects-hidden", "1"); } catch { /* The rail is then shown. */ } });
  const made = await (await context.request.post(`${base}/api/lines/projects`, { data:{ name:"Saving", docsPath:docs }, headers:{ origin:base } })).json();
  const id = made.project.id, url = `${base}/?${new URLSearchParams({ linesProject:id, linesCanvas:source, linesTitle:"Canvas 1", linesBack:id })}`;
  const page = await context.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  // When each save was sent, and whether it carried the picture.
  const sent = []; let penDown = false;
  page.on("request", request => { if (request.method() === "POST" && /\/api\/lines\/projects\/[^/]+\/canvas$/.test(new URL(request.url()).pathname)) sent.push({ at:Date.now(), drawing:penDown, picture:/"png":"data:image\/png/.test(request.postData() || "") }); });
  const stroke = async (x, y, dx, dy, steps = 24, pace = 8) => {
    await page.mouse.move(x, y); await page.mouse.down(); penDown = true;
    for (let i = 1; i <= steps; i++) { await page.mouse.move(x + dx * i / steps, y + dy * i / steps); if (pace) await wait(pace); }
    await page.mouse.up(); penDown = false;
  };
  await page.goto(url);
  await page.waitForSelector("#viewport");
  await wait(2500);
  await page.keyboard.press("Escape");
  for (const closer of [page.getByRole("button", { name:"Skip tour" }), page.locator("#changelogLayer button").first()]) if (await closer.isVisible().catch(() => false)) { await closer.click().catch(() => {}); await wait(300); }
  await page.keyboard.press("p");

  console.log("\nA still pen");
  check("an empty new Canvas writes nothing", !fs.existsSync(file));
  // Above the eight example cards of an empty Canvas, which take a press as a click.
  await stroke(300, 110, 400, 60);
  const drawn = Date.now();
  await wait(1500);
  check("nothing is sent in the first moment after a stroke", sent.length === 0 && !fs.existsSync(file), `${sent.length} sent`);
  await until(() => fs.existsSync(file), "the Canvas file", 6000);
  check("the Canvas is in the folder soon after the pen stops", Date.now() - drawn < 5000 && tilesIn() >= 1, `${Date.now() - drawn} ms, ${tilesIn()} tiles`);
  check("that first save leaves the picture for later", sent.length === 1 && !sent[0].picture && !fs.existsSync(picture));
  await until(() => fs.existsSync(picture), "the picture", 9000);
  check("the picture follows once the pen has been still longer", Date.now() - drawn >= 5500 && fs.readFileSync(picture).subarray(1, 4).toString("latin1") === "PNG", `${Date.now() - drawn} ms`);
  check("the header says it is saved to the project", await page.locator("#canvasDocumentSaveLabel").textContent() === "Saved to project");

  console.log("\nWhile you draw");
  const before = sent.length;
  // Short strokes with pauses shorter than the wait, for longer than the wait: handwriting.
  for (let i = 0; i < 14; i++) { await stroke(320 + i * 40, 520, 30, 60, 12); await wait(600); }
  check("nothing is sent while you keep writing", sent.length === before, `${sent.length - before} sent`);
  // A save that has started gives way to a long stroke.
  await wait(2300);
  await stroke(300, 700, 900, 20, 150, 14);
  check("no save is sent with the pen down", !sent.some(s => s.drawing), JSON.stringify(sent.filter(s => s.drawing)));
  await until(() => sent.length > before, "the save after writing", 8000);
  const tilesAfter = tilesIn();
  check("what you wrote is in the folder afterwards", tilesAfter >= 2, `${tilesAfter} tiles`);

  console.log("\nAn agent draws on the open Canvas");
  // What an agent does with no browser of its own: one call with a file. The page that has the Canvas open takes the drawing in.
  const token = JSON.parse(fs.readFileSync(path.join(temp, "state", "draw-token.json"), "utf8")).token;
  const diagram = JSON.stringify({ type:"workflow", title:"Two steps", nodes:[{ id:"a", label:"Draw" }, { id:"b", label:"Ask" }], edges:[{ from:"a", to:"b" }] });
  const drawn2 = await context.request.post(`${base}/api/draw`, { headers:{ "x-penecho-token":token }, multipart:{ project:id, canvas:"canvases/canvas-1", file:{ name:"steps.diagram.json", mimeType:"application/json", buffer:Buffer.from(diagram) } } });
  const drew = await drawn2.json().catch(() => ({}));
  check("the call draws onto the Canvas that is open", drawn2.ok() && drew.path === source, JSON.stringify(drew).slice(0, 200));
  const widgetsIn = () => { try { return (fs.readFileSync(file, "utf8").match(/"kind":"widget"/g) || []).length; } catch { return 0; } };
  check("the agent's drawing is in the file", widgetsIn() === 1 && tilesIn() >= tilesAfter, `${widgetsIn()} widgets, ${tilesIn()} tiles`);
  await until(() => page.evaluate(() => /AI drew on this Canvas/.test(document.querySelector("#status")?.textContent || "")), "the page to take the drawing", 12000).catch(() => {});
  check("the open page shows it without a reload", await page.evaluate(() => /AI drew on this Canvas/.test(document.querySelector("#status")?.textContent || "")), await page.evaluate(() => document.querySelector("#status")?.textContent || ""));
  // A stroke after that must keep the drawing: the page's next save carries both.
  await stroke(260, 240, 220, 60);
  const sentBefore = sent.length;
  await until(() => sent.length > sentBefore && !penDown, "the save after the agent's drawing", 9000);
  await wait(800);
  check("your next stroke and the agent's drawing are both kept", widgetsIn() === 1 && tilesIn() >= tilesAfter, `${widgetsIn()} widgets, ${tilesIn()} tiles`);
  check("the save did not fail", await page.locator("#canvasDocumentSaveLabel").textContent() !== "Not saved to project", await page.evaluate(() => document.querySelector("#status")?.textContent || ""));

  console.log("\nAn Ask from the line beside the Canvas, and a drawing with only its line");
  // The panel sends the Ask with the open Canvas. An agent told its line (PenEcho's own runs are) draws with line= alone, and it lands here.
  const asked = await (await context.request.post(`${base}/api/lines/projects/${id}/topics`, { data:{ text:"Draw the login flow.", canvas:source }, headers:{ origin:base } })).json();
  check("the Ask goes on this Canvas's line", Boolean(asked.slug), JSON.stringify(asked).slice(0, 200));
  await page.evaluate(() => { const status = document.querySelector("#status"); if (status) status.textContent = ""; });
  const login = JSON.stringify({ type:"workflow", title:"Login", nodes:[{ id:"a", label:"Email" }, { id:"b", label:"Signed in" }], edges:[{ from:"a", to:"b" }] });
  const byLine = await context.request.post(`${base}/api/draw`, { headers:{ "x-penecho-token":token }, multipart:{ project:id, line:asked.slug || "", file:{ name:"login.diagram.json", mimeType:"application/json", buffer:Buffer.from(login) } } });
  const lined = await byLine.json().catch(() => ({}));
  check("a drawing with only line= lands on the Canvas the Ask came from", byLine.ok() && lined.path === source && widgetsIn() === 2, `${JSON.stringify(lined).slice(0, 200)} ${widgetsIn()} widgets`);
  await until(() => page.evaluate(() => /AI drew on this Canvas/.test(document.querySelector("#status")?.textContent || "")), "the page to take the second drawing", 12000).catch(() => {});
  check("the open page shows that one too", await page.evaluate(() => /AI drew on this Canvas/.test(document.querySelector("#status")?.textContent || "")), await page.evaluate(() => document.querySelector("#status")?.textContent || ""));

  console.log("\nLeaving");
  await stroke(900, 250, 200, 200);
  const pictureBefore = stamp(picture), fileBefore = stamp(file);
  // The rail is the way back to the project.
  await page.locator("#projectLinesRailShow").click();
  await page.frameLocator("#projectLinesRail iframe").locator(".rail-row.on").click();
  await page.waitForURL(/projects\.html/, { timeout:20000 });
  check("leaving at once still writes the last stroke", stamp(file) > fileBefore);
  check("leaving writes the picture too", stamp(picture) > pictureBefore);

  console.log("\nComing back");
  const again = await context.newPage();
  const sentAgain = []; again.on("request", request => { if (request.method() === "POST" && /\/canvas$/.test(new URL(request.url()).pathname)) sentAgain.push(1); });
  await again.goto(url);
  await again.waitForSelector("#viewport");
  await wait(6500);
  check("opening it again changes nothing in the folder", sentAgain.length === 0 && stamp(file) > fileBefore && tilesIn() >= tilesAfter, `${sentAgain.length} sent, ${tilesIn()} tiles`);
  check("the page had no errors", errors.length === 0, errors.join(" | "));

  console.log("\nTwo pages on one Canvas");
  // `again` has the Canvas open. A second page opens it too, draws and saves. Then `again` draws: its save must not replace the other's.
  const draw = async (on, x, y) => { await on.bringToFront(); await on.keyboard.press("Escape"); await on.keyboard.press("p"); await on.mouse.move(x, y); await on.mouse.down(); for (let i = 1; i <= 20; i++) { await on.mouse.move(x + i * 12, y + i * 3); await wait(8); } await on.mouse.up(); };
  const other = await context.newPage();
  await other.goto(url);
  await other.waitForSelector("#viewport");
  await wait(2500);
  const beforeOther = stamp(file);
  await draw(other, 400, 420);
  await until(() => stamp(file) > beforeOther, "the second page's save", 12000);
  await wait(8000);   // its picture follows a little later and writes the file once more
  const kept = fs.readFileSync(file, "utf8"), tilesKept = tilesIn();
  await draw(again, 700, 300);
  const told = await again.waitForSelector("#projectLinesElsewhere", { timeout:15000 }).then(() => true, () => false);
  check("the page that saves second is told another page saved", told);
  await wait(4000);
  check("and the folder still holds the other page's save, untouched", fs.readFileSync(file, "utf8") === kept && tilesIn() === tilesKept);
  await again.locator("#projectLinesElsewhere button").first().click();
  await again.waitForURL(/linesCanvas=files%2Fcanvas-1-copy/, { timeout:20000 }).catch(() => {});
  const copy = path.join(docs, "files/canvas-1-copy/canvas.penecho.json");
  check("its own work is kept as a Canvas of its own", fs.existsSync(copy) && /canvas-1-copy/.test(decodeURIComponent(again.url())), again.url());
  check("the copy holds what that page had drawn", fs.existsSync(copy) && (fs.readFileSync(copy, "utf8").match(/"kind":"tile"/g) || []).length >= 1);
  check("and the first Canvas is still as the other page saved it", fs.readFileSync(file, "utf8") === kept);
  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const name of failures) console.log(`  - ${name}`);
  process.exitCode = failures.length ? 1 : 0;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => { server.kill(); try { fs.rmSync(temp, { recursive:true, force:true }); } catch { /* Left for the system to clear. */ } });
