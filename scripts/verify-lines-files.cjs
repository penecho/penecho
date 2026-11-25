#!/usr/bin/env node
"use strict";
// Canvases & files (docs/design/one-penecho/NEXT-FEATURES.md, N3). This checks the page in a real browser, on a project whose files are known one by one:
// the kinds and their counts (a kind with nothing is not offered), Everyone / Made by AI / From you, By time and By kind, pictures of one line and day
// in one stack, the search box, the viewer (PE-323: zoom, ← and →, Copy, Download, the line, a page, a document, a Canvas and the way back to it),
// the sheet for a link, renaming and deleting a file with Undo and recovery from Deleted,
// Add files, a file an agent adds while the page is open, #canvases landing on Canvases, and a Canvas card's own menu.
//   NODE_PATH=/path/to/node_modules node scripts/verify-lines-files.cjs [folder for screenshots]
// Optional: PENECHO_PAGE_PREVIEW_FIXTURE points to the real All lines prototype to inspect in its card.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lines-files-"));
const shots = process.argv[2] && !process.argv[2].startsWith("--") ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 6100 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "garden"), sketches = path.join(temp, "sketches");
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, browser = null; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 400)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(80); }
}

// ---------- The project: line files written as PenEcho writes them, and the files they hold ----------
const pad = n => String(n).padStart(2, "0");
const NOW = new Date(), day = 864e5;
const at = daysAgo => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, 10, 30).getTime();
const stamp = daysAgo => { const d = new Date(at(daysAgo)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// A picture big enough to zoom: soft bands with a dark frame, written as a real PNG.
function bigPng(width, height) {
  const zlib = require("node:zlib"), rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (width * 3 + 1) + 1 + x * 3, edge = x < 8 || y < 8 || x >= width - 8 || y >= height - 8, band = Math.floor(y / (height / 5)) % 2;
    rows[at] = edge ? 30 : band ? 219 : 241; rows[at + 1] = edge ? 41 : band ? 234 : 245; rows[at + 2] = edge ? 59 : band ? 254 : 249;
  }
  const crcTable = Array.from({ length:256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4), sum = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
const BIG = bigPng(1200, 760);
const { newBundle } = require("../src/server/project-lines/canvas-file.js");
const BUNDLE = (id, name = "") => JSON.stringify(newBundle({ id, name }));
function put(folder, rel, data, daysAgo) {
  const file = path.join(folder, rel);
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, data);
  if (daysAgo !== undefined) fs.utimesSync(file, new Date(at(daysAgo)), new Date(at(daysAgo)));
}
const front = fields => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n`;
function seed() {
  // Today: your Ask with three pasted pictures (one also kept as .webp), and Claude's Work that drew a Canvas, wrote a page, a report and costs, and linked an Artifact.
  put(docs, "lines/beds.md", `${front({ id:"G-1", status:"done", who:"@claude", created:stamp(0) })}# Plan the beds

## Ask · ${stamp(0)}

Plan the beds from these.

![picture.png](../files/beds/picture.png)

![picture-2.png](../files/beds/picture-2.png)

![picture-3.png](../files/beds/picture-3.png)

## [x] Work 1 · @claude · 3 min

The plan is on the Canvas, and on a design canvas: [Garden design](https://claude.ai/artifact/GardenDesign01).

![Bed plan](../files/beds/bed-plan.png)

[Details](beds/work-1.md)
`, 0);
  put(docs, "works/beds/work-1.md", `${front({ line:"../beds.md", step:"Work 1", who:"@claude", started:stamp(0), took:"3 min" })}# Work 1: Plan the beds

## Result

The report is [here](../../files/beds/report.md), and the costs are in [costs](../../files/beds/costs.xlsx).
`, 0);
  for (const name of ["picture.png", "picture-2.png", "picture-3.png", "picture.webp", "bed-plan.png"]) put(docs, `files/beds/${name}`, name === "picture.png" ? BIG : PNG, 0);
  put(docs, "files/beds/bed-plan.penecho.json", BUNDLE("bed-plan"), 0);
  put(docs, "files/beds/bed-plan.explorer.html", process.env.PENECHO_PAGE_PREVIEW_FIXTURE ? fs.readFileSync(process.env.PENECHO_PAGE_PREVIEW_FIXTURE, "utf8") : `<!doctype html><title>Bed plan</title>
    <style>body{margin:0;padding:64px;background:#e7f3eb;font:24px system-ui;color:#174832}h1{font-size:64px}#beds{padding:32px;background:white;border:2px solid #174832}</style>
    <h1>Bed plan</h1><div id="beds"></div><script>
    document.querySelector('#beds').textContent='Four beds · Spring planting';
    addEventListener('message', e => {
      if (e.data !== 'preview-focus-probe') return;
      setTimeout(() => {
        const input = document.createElement('input'); document.body.append(input);
        input.focus(); window.focus();
        document.documentElement.dataset.focusAttempted = 'yes';
      }, 120);
    });</script>`, 0);
  put(docs, "files/beds/report.md", "# Report\n\nFour beds.\n", 0);
  put(docs, "files/beds/costs.xlsx", "x", 0);
  // Yesterday: Codex's deck.
  put(docs, "lines/talk.md", `${front({ id:"G-2", status:"done", who:"@codex", created:stamp(1) })}# Spring talk

## Ask · ${stamp(1)}

Make slides for the spring talk.

## [x] Work 1 · @codex · 4 min

The deck is [spring.pptx](../files/talk/spring.pptx).
`, 1);
  put(docs, "files/talk/spring.pptx", "x", 1);
  // Three days ago: a meeting from MeetCue, its minutes beside the line.
  put(docs, "lines/standup.md", `${front({ id:"G-3", status:"done", created:stamp(3), meeting:"m-1" })}# Weekly standup

## Note · ${stamp(3)} · Meeting

**Weekly standup** · ${stamp(3)} · 30 min

We agreed on four beds.

[Minutes](../files/standup/minutes.md)
`, 3);
  put(docs, "files/standup/minutes.md", "# Weekly standup\n\nFour beds.\n", 3);
  // Forty days ago: a Canvas of your own on no line, and a file outside every line.
  put(docs, "files/sketch/canvas.penecho.json", BUNDLE("sketch", "Sketch"), 40);
  put(docs, "files/sketch/canvas.png", BIG, 40);
  put(docs, "files/notes.txt", "Seeds to buy.", 40);
  // A second project with nothing but one Canvas.
  put(sketches, "files/doodle/canvas.penecho.json", BUNDLE("doodle", "Doodle"), 2);
  put(sketches, "files/doodle/canvas.png", PNG, 2);
}

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000).catch(error => { throw new Error(`${error.message}\n${serverLog}`); });
  seed();
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const errors = [];
  const send = async (method, address, data) => (await context.request[method](`${base}/api/lines${address}`, { data, headers:{ origin:base } })).json();
  const post = (address, data) => send("post", address, data);
  const id = (await post("/projects", { name:"Garden", docsPath:docs })).project.id;
  const sketchId = (await post("/projects", { name:"Sketches", docsPath:sketches })).project.id;
  for (const project of [id, sketchId]) await send("patch", `/projects/${project}`, { offerSkill:false });

  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|Permissions policy violation: focus-without-user-activation/.test(m.text())) errors.push(m.text()); });
  const count = selector => page.locator(selector).count();
  const text = async selector => ((await page.locator(selector).first().textContent()) || "").replace(/\s+/g, " ").trim();
  const texts = async selector => (await page.locator(selector).allTextContents()).map(t => t.replace(/\s+/g, " ").trim());
  const shot = name => page.screenshot({ path:path.join(shots, `${name}.png`) });
  const open = async (hash, project = id) => {
    await page.goto(`${base}/projects.html#${project}/${hash}`);
    await page.waitForSelector(".fl-page #flBody .fl-card, .fl-page #flBody .empty-line", { timeout:30000 });
    await wait(200);
  };
  const chips = async () => Object.fromEntries((await page.locator(".fl-chip").evaluateAll(els => els.map(e => [e.dataset.kind, +e.querySelector("em").textContent]))));
  const cardNames = () => texts(".fl-card .fl-tx b");
  const card = name => page.locator(".fl-card").filter({ has:page.locator(".fl-tx b", { hasText:name }) }).first();
  const kind = async k => { await page.click(`.fl-chip[data-kind="${k}"]`); await wait(60); };
  const opened = [];
  await page.exposeFunction("__opened", url => opened.push(url));
  await page.addInitScript(() => { window.open = url => { window.__opened(String(url)); return null; }; });

  console.log("\nLatest files: the same viewer, linked to its node");
  await page.goto(`${base}/projects.html#${id}`);
  const latestPicture = '#hmFiles .lf[data-kind="image"]';
  await page.waitForSelector(latestPicture);
  check("a fresh Home uses its lighter state", await page.evaluate(() => window.__lines.project().partial) === "home");
  // Hold the full file list so the user can start typing in the page mounted from Home's lighter state.
  let releaseFiles;
  const pendingFiles = new Promise(resolve => { releaseFiles = resolve; });
  const statePattern = `**/api/lines/projects/${id}/state*`;
  const delayFiles = async route => {
    if (!new URL(route.request().url()).searchParams.has("for")) await pendingFiles;
    await route.continue();
  };
  await page.route(statePattern, delayFiles);
  await page.click('.subnav [data-view="files"]');
  await page.locator("#flQ").waitFor();
  await page.locator("#flQ").evaluate(el => { el.dataset.kept = "yes"; });
  await page.click("#flQ");
  await page.keyboard.type("li", { delay:100 });
  releaseFiles();
  await until(() => page.evaluate(() => !window.__lines.project().partial), "the complete Files state");
  await page.keyboard.type("nes", { delay:100 });
  check("typing lines survives delayed file-list hydration without replacing the search", await page.inputValue("#flQ") === "lines" && await page.getAttribute("#flQ", "data-kept") === "yes" && await page.evaluate(() => document.activeElement?.id === "flQ"));
  await page.unroute(statePattern, delayFiles);
  await page.goto(`${base}/projects.html#${id}`);
  await page.waitForSelector(latestPicture);
  const latestPath = await page.getAttribute(latestPicture, "data-path");
  await page.locator(latestPicture).first().press("Enter");
  await page.waitForSelector("#lightbox .fv");
  check("one activation opens the same picture viewer over Home", await count(".home") === 1 && await count(".fv .lb-image-viewport img") === 1 && await text(".fv-side h3") === path.basename(latestPath));
  check("its line and exact Ask node are visible without another action", await page.locator(".fv-side .fl-line").isVisible() && await text(".fv-side .fl-line") === "Plan the beds" && await page.getAttribute(".fv-side .fl-line", "data-step") === "ask-1" && /Added with your Ask/.test(await text(".fv-side .fl-from")));
  await shot("00-home-picture");
  await page.keyboard.press("Escape");
  check("Escape returns keyboard focus to the Latest files picture", await page.locator("#lightbox").isHidden() && await page.evaluate(p => document.activeElement?.matches('#hmFiles .lf') && document.activeElement.dataset.path === p, latestPath));
  await page.locator(`${latestPicture}[data-path="${latestPath}"]`).click();
  await page.click(".fv-side .fl-line");
  await page.waitForURL(url => decodeURIComponent(url.hash) === `#${id}/line/beds/ask-1`);
  await until(async () => await page.locator("#lightbox").isHidden(), "the Home viewer to close at its Ask");
  check("the visible line link opens the exact Ask in one activation", true);
  await page.goBack();
  await page.waitForSelector("#lightbox .fv");
  check("Back returns to Home with the same picture open", await count(".home") === 1 && await text(".fv-side h3") === path.basename(latestPath));
  await page.keyboard.press("Escape");

  console.log("\nThe tab and the kinds");
  await open("files");
  check("the tab is called Canvases & files, with everything it shows as its count", await text('.subnav button[data-view="files"] span') === "Canvases & files" && await text('.subnav button[data-view="files"] em') === "12", await text(".subnav"));
  check("the tab is the one on", await count('.subnav button[data-view="files"].on') === 1);
  check("the page is called Canvases & files, with a search box, Add files and New canvas", await text(".fl-bar h2") === "Canvases & files" && await count("#flQ") === 1 && await count('.fl-bar [data-act="file-add"]') === 1 && await count('.fl-bar [data-act="new-canvas"]') === 1);
  const counted = await chips();
  check("each kind with its count", JSON.stringify(counted) === JSON.stringify({ all:12, canvas:2, page:1, artifact:1, slides:1, document:2, picture:3, meeting:1, other:1 }), JSON.stringify(counted));
  check("the chips say what they are", JSON.stringify((await texts(".fl-chip")).map(t => t.replace(/\s*\d+$/, ""))) === JSON.stringify(["All", "Canvases", "Pages and prototypes", "Claude Artifacts", "Slides", "Documents", "Pictures", "Meetings", "Other"]));
  check("it opens on All", await count('.fl-chip.on[data-kind="all"]') === 1);
  await shot("01-all-by-time");

  console.log("\nPage card previews");
  const previewCard = card("bed-plan.explorer.html"), preview = previewCard.locator(".fl-page-frame.is-ready");
  await previewCard.scrollIntoViewIfNeeded();
  await preview.waitFor();
  const previewContent = page.frameLocator('.fl-card[data-key="files/beds/bed-plan.explorer.html"] iframe');
  if (process.env.PENECHO_PAGE_PREVIEW_FIXTURE) await previewContent.locator("#linesList > *").first().waitFor();
  else check("the thumbnail renders JavaScript-generated page content", await previewContent.locator("#beds").textContent() === "Four beds · Spring planting");
  check("the preview is decorative, sandboxed and cannot receive clicks or keyboard focus", await preview.getAttribute("sandbox") === "allow-scripts" && await preview.getAttribute("tabindex") === "-1" && await previewCard.locator(".fl-page-preview").getAttribute("aria-hidden") === "true" && await previewCard.locator(".fl-page-preview").getAttribute("inert") !== null && await preview.evaluate(el => getComputedStyle(el).pointerEvents) === "none");
  await preview.evaluate(el => { el.dataset.kept = "yes"; });
  await page.evaluate(() => window.__lines.poll());
  check("an unchanged poll keeps the same preview", await preview.getAttribute("data-kept") === "yes");
  await previewCard.focus();
  await page.keyboard.press("Tab");
  check("Tab skips the decorative preview", !await page.evaluate(() => document.activeElement?.matches(".fl-page-frame")));
  await previewCard.press("Enter");
  await page.waitForSelector("#lightbox .fv-frame");
  check("one keyboard activation still opens the page viewer", await text(".fv-side h3") === "bed-plan.explorer.html");
  await page.keyboard.press("Escape");
  await shot("01-page-preview");

  console.log("\nStacks, By time and By kind");
  check("three pictures pasted into one line on one day are one card with a count", await count(".fl-card.fl-stack") === 1 && await text(".fl-stack .fl-stack-n") === "3" && await text(".fl-stack .fl-tx b") === "3 pictures");
  check("the .webp copy of a picture is not a fourth", !(await cardNames()).some(n => /\.webp$/.test(n)));
  const timeGroups = await page.locator(".fl-sec h3").evaluateAll(els => els.map(e => `${e.firstChild.textContent}|${e.querySelector("em").textContent}`));
  const month = new Date(at(40)).toLocaleDateString([], { month:"long", year:"numeric" });
  check("By time: Today, Yesterday, This week, then the month", JSON.stringify(timeGroups.map(t => t.split("|")[0])) === JSON.stringify(["Today", "Yesterday", "This week", month]), timeGroups.join(" | "));
  check("each section counts what is in it, a stack by its pictures", timeGroups[0] === "Today|8", timeGroups.join(" | "));
  await page.click('[data-act="file-by"][data-v="kind"]');
  const kindGroups = (await texts(".fl-sec h3")).map(t => t.replace(/\d+$/, ""));
  check("By kind: a section for each kind, in the chips' order", JSON.stringify(kindGroups) === JSON.stringify(["Canvases", "Pages and prototypes", "Claude Artifacts", "Slides", "Documents", "Pictures", "Meetings", "Other"]), kindGroups.join(" | "));
  await shot("02-by-kind");
  await page.click('[data-act="file-by"][data-v="time"]');
  await kind("picture");
  check("Pictures shows each picture by itself", await count(".fl-card") === 3 && await count(".fl-card.fl-stack") === 0);
  await kind("canvas");
  check("Canvases shows the two Canvases", JSON.stringify((await cardNames()).sort()) === JSON.stringify(["Bed plan", "Sketch"]), (await cardNames()).join(", "));
  await kind("other");
  check("Other holds the spreadsheet", JSON.stringify(await cardNames()) === JSON.stringify(["costs.xlsx"]));
  await kind("meeting");
  check("a meeting's minutes are a Meeting, by its title", JSON.stringify(await cardNames()) === JSON.stringify(["Weekly standup"]));
  await kind("all");

  console.log("\nWho made it");
  await page.click('[data-act="file-who"][data-v="ai"]');
  const made = (await cardNames()).sort();
  check("Made by AI: what the agents made", JSON.stringify(made) === JSON.stringify(["Bed plan", "Garden design", "bed-plan.explorer.html", "costs.xlsx", "report.md", "spring.pptx"]), made.join(", "));
  check("each card shows the agent's face", await count('.fl-card .fl-by .av[title="You"]') === 0 && await count(".fl-card .fl-by .av") === 6);
  await page.click('[data-act="file-who"][data-v="you"]');
  const yours = (await cardNames()).sort();
  check("From you: your pictures, your Canvas, your file and the meeting", JSON.stringify(yours) === JSON.stringify(["3 pictures", "Sketch", "Weekly standup", "notes.txt"]), yours.join(", "));
  check("and says You", await count('.fl-card .fl-by .av[title="You"]') === 4);
  await page.click('[data-act="file-who"][data-v="all"]');

  console.log("\nFinding");
  if (!process.env.PENECHO_PAGE_PREVIEW_FIXTURE) {
    await kind("page");
    await page.click("#flQ");
    for (const ch of "beds") {
      await page.keyboard.type(ch);
      const frame = page.locator(".fl-page-frame.is-ready");
      await frame.waitFor();
      await frame.evaluate(el => el.contentWindow.postMessage("preview-focus-probe", "*"));
      await until(() => page.frameLocator(".fl-page-frame").locator("html").getAttribute("data-focus-attempted").then(value => value === "yes"), "the preview's delayed focus attempt");
      check(`the search keeps focus after a preview tries to take it at ${await page.inputValue("#flQ")}`, await page.evaluate(() => document.activeElement?.id === "flQ"));
    }
    check("all characters arrive while live previews redraw", await page.inputValue("#flQ") === "beds" && await page.frameLocator(".fl-page-frame").locator("#beds").textContent() === "Four beds · Spring planting");
    await page.fill("#flQ", "");
    await kind("all");
  }
  await page.fill("#flQ", "spring");
  await wait(100);
  check("the search finds names", JSON.stringify(await cardNames()) === JSON.stringify(["spring.pptx"]));
  check("and keeps the cursor in the box", await page.evaluate(() => document.activeElement?.id === "flQ"));
  await page.fill("#flQ", "plan the beds");
  await wait(100);
  check("and line titles", (await cardNames()).length === 6, (await cardNames()).join(", "));
  await page.fill("#flQ", "");
  await wait(100);

  console.log("\nThe viewer: a picture");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin:base });
  check("nothing is open until a card is clicked", await page.locator("#flSheet").isHidden() && await page.locator("#lightbox").isHidden());
  await card("3 pictures").click();
  await page.waitForSelector("#lightbox .fv");
  check("a stack opens over the page on its first picture", /^picture/.test(await text(".fv-side h3")) && await count(".fv .lb-image-viewport img") === 1, await text(".fv-side h3"));
  check("the panel on its right: the kind, who and when, and the line it came from", /^Picture · You added it/.test(await text(".fv-side .fl-meta")) && /Added with your Ask/.test(await text(".fv-side .fl-from")) && await text(".fv-side .fl-line") === "Plan the beds", await text(".fv-side .fl-meta"));
  check("Download, Copy, Delete and More, with no project Cloud control", await count('.fv-side [data-act="fv-cloud"]') === 0 && await count(".fv-side a[download]") === 1 && await count('.fv-side [data-act="fv-copy"]') === 1 && await page.locator('.fv-side [data-act="fv-delete"]').isVisible() && await count('.fv-side [data-act="fv-more"]') === 1);
  check("the other pictures of its stack are a strip, this one marked", await count(".fv-strip button") === 3 && await count(".fv-strip button.on") === 1);
  const zoomed = [await text(".fv output")];
  await page.click('.fv [data-zoom="in"]'); zoomed.push(await text(".fv output"));
  await page.click('.fv [data-zoom="out"]'); await page.click('.fv [data-zoom="out"]'); zoomed.push(await text(".fv output"));
  const stageAt = await page.locator(".fv .lb-image-viewport").boundingBox();
  await page.mouse.move(stageAt.x + stageAt.width / 2, stageAt.y + stageAt.height / 2);
  await page.mouse.wheel(0, -400); await wait(120); zoomed.push(await text(".fv output"));
  await page.click('.fv [data-zoom="fit"]'); zoomed.push(await text(".fv output"));
  check("it zooms in and out, by the buttons and the wheel, and Fit puts it back", parseInt(zoomed[1]) > parseInt(zoomed[0]) && parseInt(zoomed[2]) < parseInt(zoomed[0]) && parseInt(zoomed[3]) > parseInt(zoomed[2]) && zoomed[4] === zoomed[0], zoomed.join(" "));
  await page.click(".fv-strip button >> nth=2");
  check("a picture of the strip opens in its place", await page.locator(".fv-strip button").nth(2).getAttribute("aria-pressed") === "true");
  const first = await text(".fv-side h3");
  await page.keyboard.press("ArrowRight");
  const second = await text(".fv-side h3");
  await page.keyboard.press("ArrowLeft");
  check("→ and ← go through what the page shows", second !== first && await text(".fv-side h3") === first, `${first} → ${second}`);
  check("and so do the arrows on its sides", await count(".fv-nav.prev") === 1 && await count(".fv-nav.next") === 1);
  await page.click('.fv-side [data-act="fv-copy"]');
  await until(async () => /Copied/.test(await text("#toast span")), "the copy");
  const pasted = await page.evaluate(async () => (await navigator.clipboard.read())[0]?.types || []);
  check("Copy puts the picture itself on the clipboard", pasted.includes("image/png"), pasted.join(", "));
  await shot("03-viewer-picture");
  // Signing in never adds a project-wide Cloud control to this file's viewer.
  await page.evaluate(() => { window.__lines.S.cloudAccount = { signedIn:true, name:"Test" }; });
  await page.evaluate(() => fvRefresh());
  check("signed in: the viewer still has no Cloud control", await count('.fv-side [data-act="fv-cloud"]') === 0 && !/Keep in Cloud|In Cloud/.test(await text('.fv-side')));
  await page.evaluate(() => { window.__lines.S.cloudAccount = null; });
  await page.click('.fv-strip button[data-key="files/beds/picture.png"]');
  await page.click('.fv-side [data-act="fv-delete"]');
  await until(() => !fs.existsSync(path.join(docs, 'files/beds/picture.png')), "the picture to be deleted");
  await until(async () => await text('#toastAct') === 'Undo' && await count('.fv-strip button') === 2, "the remaining pictures and Undo");
  check("Delete removes the picture, its webp copy and its Ask link", !fs.existsSync(path.join(docs, 'files/beds/picture.webp')) && !/!\[picture\.png\]/.test(fs.readFileSync(path.join(docs, 'lines/beds.md'), 'utf8')));
  await page.click('#toastAct');
  await until(async () => fs.existsSync(path.join(docs, 'files/beds/picture.png')) && await count('.fv-strip button') === 3, "the picture to return");
  check("Undo restores the original picture, its webp copy and its Ask link", fs.readFileSync(path.join(docs, 'files/beds/picture.png')).equals(BIG) && fs.existsSync(path.join(docs, 'files/beds/picture.webp')) && /!\[picture\.png\]/.test(fs.readFileSync(path.join(docs, 'lines/beds.md'), 'utf8')));
  // Return to the stack's first picture so Escape's focus check uses its original card.
  await page.click('.fv-strip button[data-key="files/beds/picture.png"]');
  await page.keyboard.press("Escape");
  check("Escape closes it, back on the card it came from", await page.locator("#lightbox").isHidden() && await page.evaluate(() => document.activeElement?.classList.contains("fl-stack")));

  console.log("\nThe viewer: a page and a document");
  await card("bed-plan.explorer.html").click();
  await page.waitForSelector("#lightbox .fv-frame");
  check("a page runs inside the viewer, sandboxed", await page.getAttribute(".fv-frame", "sandbox") === "allow-scripts" && /\/file\?path=files%2Fbeds%2Fbed-plan\.explorer\.html$/.test(await page.getAttribute(".fv-frame", "src")));
  const meta = await text(".fv-side .fl-meta");
  check("the panel says the kind, who made it and when", /^Page · Claude\b.* made it · Today \d\d:\d\d$/.test(meta), meta);
  const download = await page.getAttribute(".fv-side a[download]", "href");
  check("Download is the file itself, as a download", /\/file\?path=files%2Fbeds%2Fbed-plan\.explorer\.html&download=1$/.test(download), download);
  await page.click('.fv-side [data-act="fv-tab"]');
  await until(() => opened.length === 1, "the page to open");
  check("Open in a new tab: served by PenEcho", /\/api\/lines\/projects\/[^/]+\/file\?path=files%2Fbeds%2Fbed-plan\.explorer\.html$/.test(opened[0]), opened[0]);
  const served = await context.request.get(`${base}${new URL(opened[0], base).pathname}${new URL(opened[0], base).search}`);
  check("and PenEcho serves it as a page, sandboxed", served.status() === 200 && /text\/html/.test(served.headers()["content-type"]) && /sandbox/.test(served.headers()["content-security-policy"]));
  await shot("04-viewer-page");
  await page.keyboard.press("Escape");

  await card("report.md").click();
  await until(async () => await text(".fv-doc-in h1") === "Report", "the document to show");
  check("a document is read in the viewer", /Four beds/.test(await text(".fv-doc-in")));
  check("a Work's file: made in that Work", /Made in Work 1/.test(await text(".fv-side .fl-from")), await text(".fv-side .fl-from"));
  await page.click(".fv-side .fl-line");
  await page.waitForURL(url => decodeURIComponent(url.hash) === `#${id}/line/beds/work-1`);
  await until(async () => await page.locator("#lightbox").isHidden(), "the viewer to go");
  check("From the line opens the line at that step, and the viewer is gone", true);
  await page.goBack();
  await page.waitForSelector("#lightbox .fv");
  check("Back opens the viewer again on the same file", await text(".fv-side h3") === "report.md");
  await page.keyboard.press("Escape");
  await page.click('.subnav button[data-view="home"]');
  await page.click('.subnav button[data-view="files"]');
  await page.waitForSelector(".fl-page #flBody .fl-card");
  await wait(200);
  check("coming to the tab another way opens nothing", await page.locator("#lightbox").isHidden());

  console.log("\nA link opens in the sheet");
  await card("Garden design").click();
  await page.waitForSelector("#flSheet:not([hidden])");
  check("a Claude Artifact opens in the sheet on the right, not the viewer", await page.locator("#lightbox").isHidden() && await count(".fl-card.on") === 1 && await text("#flSheet h3") === "Garden design");
  check("no Download; Open on claude.ai and Copy link", await count('#flSheet [data-act="file-download"]') === 0 && await text('#flSheet [data-act="file-open"]') === "Open on claude.ai" && await count('#flSheet [data-act="file-copy-link"]') === 1);
  await page.click('#flSheet [data-act="file-open"]');
  await until(() => opened.length === 2, "the Artifact to open");
  check("at its own address", opened[1] === "https://claude.ai/artifact/GardenDesign01", opened[1]);
  check("it was found in Claude's Work, with its link's words as its name", /Claude\b.* made it/.test(await text("#flSheet .fl-meta")) && await text("#flSheet .fl-line") === "Plan the beds");
  await page.click('#flSheet [data-act="file-copy-link"]');
  await until(async () => await page.evaluate(() => navigator.clipboard.readText()) === "https://claude.ai/artifact/GardenDesign01", "the link to be copied");
  check("Copy link copies its address", true);
  await page.keyboard.press("Escape");
  check("Escape closes the sheet", await page.locator("#flSheet").isHidden());

  console.log("\nA Canvas: its picture first, then the Canvas, then back");
  await card("Sketch").click();
  await page.waitForSelector("#lightbox .fv");
  check("a Canvas shows as its picture first", /^Canvas · You drew it/.test(await text(".fv-side .fl-meta")) && await count(".fv .lb-image-viewport img") === 1 && await text('.fv-side [data-act="fv-canvas"]') === "Open Canvas", await text(".fv-side .fl-meta"));
  await page.click('.fv-side [data-act="fv-more"]');
  const sketchMenu = await texts("#menu button");
  check("More is the Canvas's own menu", sketchMenu.includes("Rename") && sketchMenu.includes("Delete"), sketchMenu.join(", "));
  await page.keyboard.press("Escape");
  await page.click('.fv-side [data-act="fv-canvas"]');
  await page.waitForURL(url => url.searchParams.get("linesCanvas") === "files/sketch/canvas.penecho.json", { timeout:30000 });
  const backTo = new URL(page.url()).searchParams.get("linesBack");
  check("Open Canvas opens the Canvas page, which knows its way back", backTo === `${id}/files`, backTo);
  const backLink = page.locator("[data-project-lines-link]");
  await backLink.waitFor({ state:"visible", timeout:30000 });
  check("the Canvas shows Back", ((await backLink.textContent()) || "").trim() === "Back", await backLink.textContent());
  await shot("05-canvas-back");
  // The seeded Canvas has no picture of its own, so the Canvas says it did not open, over the top bar.
  await backLink.evaluate(link => link.click());
  await page.waitForSelector("#lightbox .fv", { timeout:30000 });
  check("Back is the files page, with the Canvas open in the viewer again", (await text(".fv-side h3")) === "Sketch" && /projects\.html$/.test(new URL(page.url()).pathname));
  await page.keyboard.press("Escape");

  console.log("\nA file's menu and visible Delete button, Undo and Deleted");
  await card("notes.txt").click();
  await page.waitForSelector("#lightbox .fv");
  await page.click('.fv-side [data-act="fv-more"]');
  check("the menu has Show in Vault and Rename; Delete is directly visible", JSON.stringify(await texts("#menu button")) === JSON.stringify(["Show in Vault", "Rename"]) && await page.locator('.fv-side [data-act="fv-delete"]').isVisible(), (await texts("#menu button")).join(", "));
  check("over the viewer", await page.evaluate(() => +getComputedStyle(document.querySelector("#menu")).zIndex > +getComputedStyle(document.querySelector("#lightbox")).zIndex));
  await page.click("#menu button:has-text('Rename')");
  check("Rename keeps the extension out of the box", await page.inputValue("#fileNameInput") === "notes" && await text(".fl-ext") === ".txt");
  await page.fill("#fileNameInput", "seeds");
  await page.click("dialog button[type=submit]");
  await until(async () => fs.existsSync(path.join(docs, "files/seeds.txt")) && (await cardNames()).includes("seeds.txt"), "the new name");
  await until(async () => await text(".fv-side h3") === "seeds.txt", "the viewer to follow");
  check("the file has its new name, and the viewer stays on it", !fs.existsSync(path.join(docs, "files/notes.txt")));
  await page.locator('.fv-side [data-act="fv-delete"]').focus();
  await page.keyboard.press("Enter");
  await until(async () => !(await cardNames()).includes("seeds.txt"), "the card to go");
  check("Delete takes it to the project's Trash", !fs.existsSync(path.join(docs, "files/seeds.txt")) && fs.readdirSync(path.join(docs, ".trash/files")).length === 1 && await text("#toast span") === "seeds.txt deleted" && await text("#toastAct") === "Undo");
  check("and the viewer moves on to the next file", await page.locator("#lightbox .fv").isVisible() && await text(".fv-side h3") !== "seeds.txt");
  await page.click("#toastAct");
  await until(async () => (await cardNames()).includes("seeds.txt"), "the card to come back");
  check("Undo brings it back", fs.existsSync(path.join(docs, "files/seeds.txt")));
  await page.keyboard.press("Escape");
  await card("seeds.txt").click();
  await page.click('.fv-side [data-act="fv-delete"]');
  await until(async () => !(await cardNames()).includes("seeds.txt"), "the file to move to Deleted");
  await page.keyboard.press("Escape");
  // Deleted is a tab in My Canvases and under More in a project (PE-478).
  const openDeleted = async () => { if (await count('.subnav button[data-view="deleted"]')) await page.click('.subnav button[data-view="deleted"]'); else { await page.click(".subnav-more"); await page.click('#menu button:has-text("Deleted")'); } };
  await openDeleted();
  const deletedFile = page.locator('.deleted-page .del-row').filter({ has:page.locator('strong', { hasText:'seeds.txt' }) });
  await deletedFile.waitFor();
  check("the Deleted page visibly offers file recovery", await deletedFile.locator('[data-act="file-restore"]').isVisible() && /7 days/.test(await text('.del-why')));
  check("Deleted identifies the text file by its contents and original location", /Seeds to buy\./.test(await deletedFile.locator('.del-excerpt').textContent()) && await deletedFile.locator('.del-location').textContent() === 'files/seeds.txt');
  await shot("05-deleted-file");
  await deletedFile.locator('[data-act="file-restore"]').click();
  await until(async () => fs.existsSync(path.join(docs, "files/seeds.txt")) && await count('.deleted-page [data-act="file-restore"]') === 0, "the file to restore from Deleted");
  check("Restore from Deleted returns the file with its contents", fs.readFileSync(path.join(docs, "files/seeds.txt"), "utf8") === "Seeds to buy.");
  await page.click('.subnav button[data-view="files"]');
  await card("seeds.txt").click();
  await page.waitForSelector("#lightbox .fv");
  await page.click('.fv-side [data-act="fv-more"]');
  await page.click("#menu button:has-text('Show in Vault')");
  await page.waitForSelector(".vault-page");
  check("Show in Vault opens the Vault on it, with its folders open", await page.evaluate(() => window.__lines.S.vaultSel[window.__lines.S.cur]) === "files/seeds.txt" && await page.locator('.tree-file.on[data-path="files/seeds.txt"]').isVisible());
  await until(async () => await page.locator("#lightbox").isHidden(), "the viewer to go");
  check("and the viewer is gone", true);
  await page.goBack();
  await page.waitForSelector("#lightbox .fv");
  check("Back from the Vault opens the viewer again on it", await text(".fv-side h3") === "seeds.txt");
  await page.keyboard.press("Escape");

  console.log("\nA Canvas card keeps its own menu");
  await card("Bed plan").hover();
  await page.click('.fl-card:has(.fl-tx b:text-is("Bed plan")) .fl-more');
  const canvasMenu = await texts("#menu button");
  check("Open, Open its line, Rename, Move, Take off its line, Delete", ["Open", "Open its line", "Rename", "Delete"].every(t => canvasMenu.includes(t)) && canvasMenu.some(t => /^Move/.test(t)), canvasMenu.join(", "));
  await page.click("#menu button:has-text('Rename')");
  await page.fill("#canvasTitleInput", "Bed plan v2");
  await page.click("dialog button[type=submit]");
  await until(async () => (await cardNames()).includes("Bed plan v2"), "the Canvas's new name");
  check("Rename renames the Canvas", true);
  await card("Bed plan v2").hover();
  await page.click('.fl-card:has(.fl-tx b:text-is("Bed plan v2")) .fl-more');
  await page.click("#menu button:has-text('Delete')");
  await until(async () => !(await cardNames()).includes("Bed plan v2"), "the Canvas to go");
  check("Delete takes the Canvas away, with Undo", await text("#toast span") === "Canvas deleted" && await text("#toastAct") === "Undo");
  await page.click("#toastAct");
  await until(async () => (await cardNames()).includes("Bed plan v2"), "the Canvas to come back");
  check("and Undo brings it back", true);

  await card("Bed plan v2").click();
  await page.click('.fv-side [data-act="fv-delete"]');
  await until(async () => !(await cardNames()).includes("Bed plan v2"), "the Canvas to leave its viewer");
  await page.keyboard.press("Escape");
  await openDeleted();
  const deletedCanvas = page.locator('.deleted-page .del-row').filter({ has:page.locator('strong', { hasText:'Bed plan v2' }) });
  await deletedCanvas.waitFor();
  check("a Canvas deleted from the viewer can be recovered from Deleted", await deletedCanvas.locator('[data-act="canvas-restore"]').isVisible());
  const deletedThumb = deletedCanvas.locator('[data-act="deleted-preview"]');
  await until(() => deletedThumb.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), "the deleted Canvas thumbnail");
  check("Deleted previews the preserved Canvas picture", /\.trash%2Fcanvases%2F/.test(await deletedThumb.locator('img').getAttribute('src')));
  await deletedThumb.click();
  await page.waitForSelector('.deleted-image-preview');
  check("one activation enlarges the deleted image without restoring it", await page.locator('.deleted-image-preview img').isVisible() && !fs.existsSync(path.join(docs, 'files/beds/bed-plan.penecho.json')));
  await page.keyboard.press('Escape');
  check("Escape returns focus to the Deleted thumbnail", await page.locator('#lightbox').isHidden() && await deletedThumb.evaluate(el => el === document.activeElement));
  await deletedCanvas.locator('[data-act="canvas-restore"]').click();
  await until(async () => fs.existsSync(path.join(docs, 'files/beds/bed-plan.penecho.json')) && await count('.deleted-page [data-act="canvas-restore"]') === 0, "the Canvas to restore from Deleted");
  await page.click('.subnav button[data-view="files"]');
  check("Restore returns the Canvas and its picture to the files page", (await cardNames()).includes('Bed plan v2') && fs.existsSync(path.join(docs, 'files/beds/bed-plan.png')));

  console.log("\nWhat arrives while the page is open");
  await page.fill("#flQ", "plan the beds");
  await wait(100);
  const before = (await cardNames()).length;
  put(docs, "files/beds/planting-plan.md", "# Planting\n");
  await until(async () => (await cardNames()).includes("planting-plan.md"), "the new file to show", 20000);
  check("a file an agent writes into the line's folder shows where you are, the search kept", (await cardNames()).length === before + 1 && await page.inputValue("#flQ") === "plan the beds");
  await page.fill("#flQ", "");
  await wait(100);

  console.log("\nAdd files");
  const chooser = page.waitForEvent("filechooser");
  await page.click('.fl-bar [data-act="file-add"]');
  const picked = path.join(temp, "seed-list.md");
  fs.writeFileSync(picked, "# Seeds\n");
  await (await chooser).setFiles(picked);
  await until(async () => (await cardNames()).includes("seed-list.md"), "the added file");
  await page.waitForSelector("#lightbox .fv");
  check("an added file is in the project, from you, and open in the viewer", fs.existsSync(path.join(docs, "files/added/seed-list.md")) && await text(".fv-side h3") === "seed-list.md" && /You added it/.test(await text(".fv-side .fl-meta")));
  await page.keyboard.press("Escape");

  console.log("\n#canvases, and a project with only a Canvas");
  await open("canvases");
  check("#canvases opens the page on Canvases", await count('.fl-chip.on[data-kind="canvas"]') === 1 && (await cardNames()).every(n => ["Bed plan v2", "Sketch"].includes(n)) && await count('.subnav button[data-view="files"].on') === 1);
  await open("files", sketchId);
  check("a kind with nothing is not offered", JSON.stringify(Object.keys(await chips())) === JSON.stringify(["all", "canvas"]));
  await shot("04-only-canvases");

  console.log("\nDark, and narrower");
  await page.emulateMedia({ colorScheme:"dark" });
  await open("files");
  await card("Garden design").click();
  check("dark: the sheet is on dark paper", await page.evaluate(() => getComputedStyle(document.querySelector("#flSheet")).backgroundColor) === "rgb(22, 28, 37)");
  await shot("06-dark-sheet");
  await page.keyboard.press("Escape");
  await card("Bed plan").click();
  await page.waitForSelector("#lightbox .fv");
  check("dark: the viewer's panel is on dark paper", await page.evaluate(() => getComputedStyle(document.querySelector(".fv-side")).backgroundColor) === "rgb(22, 28, 37)");
  await shot("07-dark-viewer");
  await page.keyboard.press("Escape");
  await card("Garden design").click();
  await page.setViewportSize({ width:390, height:844 });
  await wait(300);
  const sheetBox = await page.locator("#flSheet").boundingBox();
  check("on a phone the sheet takes the screen", sheetBox && sheetBox.width === 390 && sheetBox.height > 700, JSON.stringify(sheetBox));
  check("and the page does not scroll sideways", await page.evaluate(() => document.querySelector("#view").scrollWidth <= document.querySelector("#view").clientWidth));
  await shot("08-phone-sheet");
  await page.keyboard.press("Escape");
  await card("Bed plan").click();
  await page.waitForSelector("#lightbox .fv");
  const stageBox = await page.locator(".fv-stage").boundingBox(), sideBox = await page.locator(".fv-side").boundingBox();
  check("on a phone the viewer takes the screen, its panel under the picture", stageBox && sideBox && Math.round(stageBox.width) === 390 && sideBox.y >= stageBox.y + stageBox.height - 1, JSON.stringify({ stageBox, sideBox }));
  const deleteBox = await page.locator('.fv-side [data-act="fv-delete"]').boundingBox();
  check("on a phone Delete is visible without opening a menu", deleteBox && deleteBox.x >= 0 && deleteBox.x + deleteBox.width <= 390 && deleteBox.y >= 0 && deleteBox.y + deleteBox.height <= 844);
  await shot("09-phone-viewer");

  console.log("\nPreview resource lifetime");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme:"light" });
  await page.setViewportSize({ width:1440, height:900 });
  // A realistic list with many page cards: only those in the visible Files area run.
  const html = fs.readFileSync(path.join(docs, "files/beds/bed-plan.explorer.html"));
  for (let i = 0; i < 80; i++) put(docs, `files/previews/page-${String(i).padStart(2, "0")}.html`, html, 0);
  await open("files");
  await kind("page");
  await page.locator('[data-act="file-section"]').click();
  await until(async () => await count(".fl-card") === 81 && await count(".fl-page-frame.is-ready") > 0, "the page cards to render");
  const active = await count(".fl-page-frame");
  check("a long list starts only its visible page previews", active > 0 && active < 30, String(active));
  await page.locator(".fl-card").first().evaluate(el => { el.dataset.firstPreview = "yes"; });
  await page.locator(".fl-card").last().scrollIntoViewIfNeeded();
  await until(async () => await count('.fl-card[data-first-preview="yes"] .fl-page-frame') === 0, "the first offscreen preview to stop");
  check("scrolling away releases offscreen pages", await count(".fl-page-frame") < 30);
  await page.setViewportSize({ width:390, height:844 });
  await page.locator(".fl-card").last().scrollIntoViewIfNeeded();
  const phonePreview = page.locator(".fl-page-frame.is-ready").last();
  await phonePreview.waitFor();
  const fitted = await phonePreview.evaluate(el => { const frame = el.getBoundingClientRect(), card = el.parentElement.getBoundingClientRect(); return Math.abs(frame.width - card.width) < 1 && frame.height >= card.height - 1; });
  check("the desktop page fits a narrow thumbnail without leaving a gap", fitted);
  await shot("10-phone-page-preview");
  await page.locator('.subnav [data-act="go-view"][data-view="home"]').click();
  await until(async () => await count(".fl-page-frame") === 0, "page previews to stop outside Files");
  check("leaving Files releases its previews", true);

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close(); browser = null;
})().catch(error => { failures.push(error.message); console.log(`FAIL  ${error.stack || error.message}`); }).finally(async () => {
  await browser?.close().catch(() => {});
  server.kill();
  try { fs.rmSync(temp, { recursive:true, force:true }); } catch { /* Left for the system to clear. */ }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
});
