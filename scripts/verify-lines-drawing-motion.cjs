#!/usr/bin/env node
"use strict";
// PE-318: real Canvas strokes survive Done, and the Home's nodes/title travel to the line and back.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-drawing-motion.cjs [screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-drawing-motion-"));
const docs = path.join(temp, "docs"), shots = process.argv[2] || path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
fs.mkdirSync(path.join(docs, "lines", "garden"), { recursive:true });
fs.mkdirSync(path.join(docs, "files", "garden"), { recursive:true });
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
const title = "New project document folder is too short, so users cannot see the whole folder name or choose the right location";
const pictures = path.join(root, "src/server/project-lines/examples/notebook/docs/files/garden-plan");
for (const name of ["garden.png", "garden.penecho.json"]) fs.copyFileSync(path.join(pictures, name), path.join(docs, "files", "garden", name));
fs.copyFileSync(path.join(pictures, "garden.png"), path.join(docs, "files", "garden", "attachment.png"));
fs.writeFileSync(path.join(docs, "lines", "garden.md"), `---\nid: T-1\nstatus: ready\ncreated: ${stamp}\nwho: @codex\nlabels: document folder, name\n---\n\n# ${title}\n\n## Canvas · ${stamp}\n\n![Garden drawing](../files/garden/garden.png)\n\n## Ask · ${stamp}\n\nShow the complete garden plan.\n\n![Attached photo](../files/garden/attachment.png)\n\n## [x] Work 1 · @codex · 4 min\n\nThe garden plan is ready.\n\n![Garden](../files/garden/garden.png)\n\n[Details](garden/work-1.md)\n`);
fs.writeFileSync(path.join(docs, "works", "garden", "work-1.md"), `---\nline: ../garden.md\nstep: Work 1\nwho: @codex\nstarted: ${stamp}\nended: ${stamp}\n---\n\n# Work 1\n\n## Result\n\nThe complete garden plan is ready.\n`);
fs.writeFileSync(path.join(docs, "lines", "long.md"), `---\nid: T-2\nstatus: ready\ncreated: ${stamp}\nwho: @codex\n---\n\n# A longer line with earlier steps\n\n` + Array.from({ length:5 }, (_, i) => `## Ask · ${stamp}\n\nPart ${i + 1}.\n\n## [x] Work ${i + 1} · @codex · 2 min\n\nPart ${i + 1} is complete.\n\n`).join(""));
let server, browser, passed = 0;
const failures = [], errors = [];
const check = (name, ok, detail = "") => { if (ok) { passed++; console.log(`  ok  ${name}`); } else { failures.push(name); console.log(`FAIL  ${name} ${detail}`); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 20000) {
  const start = Date.now();
  for (;;) { if (await fn()) return; if (Date.now() - start > ms) throw Error(`Timed out: ${label}`); await wait(80); }
}
(async () => {
  const port = 6600 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud"), PORT:String(port), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
  let log = ""; server.stdout.on("data", d => { log += d; }); server.stderr.on("data", d => { log += d; });
  await until(() => log.includes("PenEcho:"), "server start").catch(e => { throw Error(`${e.message}\n${log}`); });
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const request = async (method, endpoint, data) => (await context.request[method](`${base}/api/lines${endpoint}`, { data, headers:{ origin:base } })).json();
  const { project } = await request("post", "/projects", { name:"Drawing checks", docsPath:docs });
  const id = project.id;
  await request("patch", `/projects/${id}`, { offerSkill:false });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.stack || e.message));
  page.on("dialog", d => d.accept());
  await page.addInitScript(() => { try { localStorage.setItem("penecho-lines-test-run", "1"); } catch { /* Sandboxed preview frames have no storage. */ } });
  const home = async () => { await page.goto(`${base}/projects.html#${id}`); await page.waitForFunction(() => window.__lines?.project()); await page.waitForSelector(".hl-row"); };
  const box = ".dock-wrap .composer", row = '.hl-row[data-row="garden"]';
  const screenshot = name => page.screenshot({ path:path.join(shots, `${name}.png`) });
  const stroke = async (offset = 0) => {
    await page.mouse.move(420, 300 + offset); await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(420 + i * 14, 300 + offset + Math.sin(i / 2) * 40, { steps:2 });
    await page.mouse.up(); await wait(300);
    await page.waitForFunction(() => document.querySelector("#canvasDocumentSaveLabel")?.textContent === "Saved to project", { timeout:30000 });
    await wait(300);
  };
  const ready = async () => {
    await page.waitForURL(/linesCanvas/);
    try {
      await page.waitForSelector("[data-project-lines-link]", { state:"visible" });
      await page.waitForFunction(() => Boolean(sessionStorage.getItem("penecho-lines-drawing")));
    } catch (error) {
      await screenshot("canvas-not-ready");
      const state = await page.evaluate(() => ({ url:location.href, label:document.querySelector("#canvasDocumentSaveLabel")?.textContent, handoff:sessionStorage.getItem("penecho-lines-drawing"), text:document.body.innerText.slice(0, 1200) }));
      throw Error(`${error.message}\n${JSON.stringify(state)}`);
    }
    await wait(300);
  };
  const drawFromBox = async selector => { await page.locator(`${selector} [data-act="cmp-plus"]`).click(); await page.locator('#menu button').filter({ hasText:/^Draw$/ }).click(); await ready(); };
  const done = async selector => { await page.locator("[data-project-lines-link]").first().click(); await page.waitForURL(/projects\.html/); await page.waitForSelector(`${selector} .cmp-input`); };
  await home();
  await page.locator(`${box} .cmp-input`).fill("Keep my Home words with this drawing");
  await drawFromBox(box);
  await done(box);
  check("blank Done keeps the words without adding an attachment", await page.locator(`${box} .cmp-input`).inputValue() === "Keep my Home words with this drawing" && await page.locator(`${box} .cmp-file`).count() === 0);
  await drawFromBox(box);
  await stroke();
  await done(box);
  const incoming = () => fs.readdirSync(path.join(docs, "files", "_incoming")).filter(n => n.endsWith(".png"));
  check("Done saved the drawing PNG in the folder", incoming().length === 1);
  check("Home Done attaches the saved picture beside the original words", await page.locator(`${box} .cmp-file.is-drawing`).count() === 1 && await page.locator(`${box} .cmp-input`).inputValue() === "Keep my Home words with this drawing");
  await screenshot("home-drawing");
  if (await page.locator(`${box} .cmp-file-edit`).count()) {
    const first = fs.statSync(path.join(docs, "files", "_incoming", incoming()[0])).mtimeMs;
    await page.locator(`${box} .cmp-file-edit`).click(); await ready(); await stroke(100); await done(box);
    check("editing keeps one attachment and updates the same drawing", await page.locator(`${box} .cmp-file.is-drawing`).count() === 1 && incoming().length === 1 && fs.statSync(path.join(docs, "files", "_incoming", incoming()[0])).mtimeMs > first);
    await page.reload(); await page.waitForSelector(`${box} .cmp-input`);
    check("refresh keeps the drawing and its words", await page.locator(`${box} .cmp-file.is-drawing`).count() === 1 && await page.locator(`${box} .cmp-input`).inputValue() === "Keep my Home words with this drawing");
    await page.locator(`${box} [type="submit"]`).click();
    await page.waitForSelector("#linePage");
    check("only Send puts the picture and words on a line", fs.readdirSync(path.join(docs, "lines")).filter(n => n.endsWith(".md")).some(n => { const t = fs.readFileSync(path.join(docs, "lines", n), "utf8"); return t.includes("Keep my Home words") && /drawing.*\.png/.test(t); }));
  }
  await home(); await wait(850);
  await page.locator(row).scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(() => ({ home:lineOnHome("garden"), title:document.querySelector('.hl-row[data-row="garden"] .hl-title').getBoundingClientRect().toJSON() }));
  check("Home animation measures the visible step nodes and title", Object.keys(geometry.home?.stops || {}).length >= 2 && geometry.home.title?.width > 0, JSON.stringify(geometry.home));
  const connector = await page.evaluate(() => {
    const track = document.querySelector('.hl-row[data-row="garden"] .hl-track'), curve = getComputedStyle(track, "::before");
    return { edge:parseFloat(curve.left) + parseFloat(curve.width), line:curve.left };
  });
  check("branch curve reaches the horizontal track", connector.edge >= 0, JSON.stringify(connector));
  const titleState = await page.locator(`${row} .hl-title`).evaluate(el => ({ height:el.offsetHeight, line:parseFloat(getComputedStyle(el).lineHeight), text:el.textContent }));
  check("a long title stays on its lane's one line", titleState.height <= titleState.line + 1, JSON.stringify(titleState));
  // The pictures show under the lane, once it is opened: the last Ask's and the last result's.
  await page.locator(`${row} .hl-hit`).click();
  const imageState = await page.locator(`${row} .hd-ask .st-pic img`).first().evaluate(img => { const b = img.getBoundingClientRect(); return { fit:getComputedStyle(img).objectFit, position:getComputedStyle(img).objectPosition, width:b.width, height:b.height, natural:img.naturalHeight, ready:img.complete, action:img.closest('button')?.dataset.act }; });
  check("Canvas thumbnail keeps the compact design and opens its picture", imageState.ready && imageState.natural > 0 && imageState.fit === "cover" && imageState.position === "0% 0%" && imageState.width === 46 && imageState.height === 34 && imageState.action === "home-picture", JSON.stringify(imageState));
  const askPictureLayout = () => page.locator(`${row} .hd-ask`).evaluate(step => {
    const picture = step.querySelector(".st-pic").getBoundingClientRect(), words = step.querySelector("p").getBoundingClientRect();
    return { sameTop:Math.abs(picture.top + picture.height / 2 - words.top - words.height / 2) <= 2, beside:picture.right <= words.left, pictureWidth:picture.width, wordsWidth:words.width };
  });
  const pictureLayout = await askPictureLayout();
  check("an Ask attachment sits beside its words", pictureLayout.sameTop && pictureLayout.beside && pictureLayout.pictureWidth > 0 && pictureLayout.wordsWidth > 0, JSON.stringify(pictureLayout));
  await page.locator(`${row} .st-pic`).first().hover();
  await wait(400);
  check("Home thumbnails and work details have no hover popup", await page.locator("#stopCard").count() === 0);
  const attachment = `${row} .hd-ask .st-pic`, workPicture = `${row} .hd-result .st-pic`;
  const homeHash = await page.evaluate(() => location.hash);
  await page.evaluate(() => { __lines.S.fl = { kind:'document', who:'all', by:'time', q:'no matching file', open:null, openPlace:'', entered:'' }; });
  for (const [name, selector] of [["Ask attachment", attachment], ["Work result", workPicture]]) {
    await page.locator(selector).click();
    await page.waitForSelector("#lightbox .fv-view img");
    await page.waitForFunction(() => { const img = document.querySelector("#lightbox .fv-view img"); return img?.complete && img.naturalWidth > 0; });
    check(`${name} opens in the shared viewer without leaving Home`, await page.evaluate(hash => location.hash === hash, homeHash) && await page.locator("#lightbox .fv-side").count() === 1);
    check(`${name} retains its exact step link`, await page.locator("#lightbox [data-act='open-step']").getAttribute("data-step") === await page.locator(selector).getAttribute("data-step"));
    await screenshot(`viewer-${name.toLowerCase().replaceAll(" ", "-")}`);
    await page.keyboard.press("Escape");
    check(`${name} closes back to the same thumbnail`, await page.locator("#lightbox").evaluate(el => el.hidden) && await page.locator(selector).evaluate(el => el === document.activeElement));
  }
  await page.locator(attachment).focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#lightbox .fv-view img");
  await page.locator("#lightbox [data-zoom='in']").click();
  check("keyboard activation opens the image and zoom controls work", await page.locator("#lightbox output").textContent() === "125%");
  await page.keyboard.press("ArrowRight");
  check("viewer navigation visits visible Home pictures, ignoring Files filters", await page.locator("#lightbox .fv-view img").getAttribute("src") === await page.locator(`${workPicture} img`).getAttribute("src"));
  await page.locator("#lightbox [data-act='fv-close']").click();
  await page.locator(attachment).focus();
  await page.keyboard.press("Space");
  await page.waitForSelector("#lightbox .fv");
  check("Space also opens the focused thumbnail", await page.locator("#lightbox .fv-view").count() === 1);
  await page.keyboard.press("Escape");
  // Open line, under the pictures, goes to the line.
  await page.locator(`${row} .hd-open`).click();
  await page.waitForSelector("#linePage");
  check("Open line opens the line", await page.evaluate(() => __lines.S.route.view === "line"));
  await page.evaluate(() => __lines.go({ view:"home" }));
  await wait(850);
  await screenshot("home-preview-title");
  await page.locator(`${row} .hl-main`).click();
  await page.waitForSelector(".fly-layer");
  check("opening a line animates its title", await page.locator("#lpTitle").evaluate(el => el.getAnimations().some(a => a.effect.getKeyframes().some(f => f.transform?.includes("translate")))));
  await wait(850);
  await page.locator(".lp-dock .cmp-input").fill("Keep my line words");
  await drawFromBox(".lp-dock"); await stroke(); await done(".lp-dock");
  check("line Done keeps the attachment and the original words", await page.locator(".lp-dock .cmp-file.is-drawing").count() === 1 && await page.locator(".lp-dock .cmp-input").inputValue() === "Keep my line words");
  await page.evaluate(() => __lines.go({ view:"home" }));
  check("return animates the line back to its Home nodes", await page.locator(".fly-layer").count() === 1);
  check("return animates the title back to its Home row", await page.locator(`${row} .hl-title`).evaluate(el => el.getAnimations().some(a => a.effect.getKeyframes().some(f => f.transform?.includes("translate")))));
  await wait(800);
  await page.evaluate(() => __lines.go({ view:"line", line:"garden" }));
  await page.evaluate(() => __lines.go({ view:"home" }));
  await wait(850);
  check("quick navigation clears motion layers and hidden nodes", await page.locator(".fly-layer,.fly-ghost").count() === 0 && await page.locator(`${row} .hl-track`).evaluate(el => getComputedStyle(el).visibility === "visible"));
  await page.emulateMedia({ reducedMotion:"reduce" });
  await page.locator(`${row} .hl-main`).click();
  check("reduced motion opens immediately without flight", await page.locator("#linePage").count() === 1 && await page.locator(".fly-layer").count() === 0);
  await page.evaluate(() => __lines.go({ view:"home" }));
  await page.setViewportSize({ width:390, height:844 });
  await page.locator(row).scrollIntoViewIfNeeded();
  check("narrow Home has no horizontal overflow", await page.locator("#view").evaluate(el => el.scrollWidth <= el.clientWidth));
  // The page was loaded again on the way back from the Canvas, so the lane is opened again.
  if (!await page.locator(`${row} .hl-detail`).count()) await page.locator(`${row} .hl-hit`).click();
  const narrowPictureLayout = await askPictureLayout();
  check("narrow Home keeps the Ask attachment beside its words", narrowPictureLayout.sameTop && narrowPictureLayout.beside && narrowPictureLayout.pictureWidth > 0 && narrowPictureLayout.wordsWidth > 0, JSON.stringify(narrowPictureLayout));
  await screenshot("phone");
  const touch = await browser.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, storageState:await context.storageState() });
  const touchPage = await touch.newPage();
  touchPage.on("pageerror", e => errors.push(e.stack || e.message));
  await touchPage.goto(`${base}/projects.html#${id}`);
  await touchPage.locator(`${row} .hl-hit`).tap();
  await touchPage.waitForSelector(attachment);
  await touchPage.locator(attachment).tap();
  await touchPage.waitForSelector("#lightbox .fv-view img");
  check("one tap opens the image on a narrow touch screen", await touchPage.locator("#lightbox .fv").isVisible());
  await touchPage.screenshot({ path:path.join(shots, "phone-viewer.png") });
  await touchPage.locator("#lightbox [data-act='fv-close']").tap();
  check("touch Close returns to Home without a hover popup", await touchPage.locator("#lightbox").evaluate(el => el.hidden) && await touchPage.locator("#stopCard").count() === 0);
  await touch.close();
  check("no browser errors", errors.length === 0, errors.join(" | "));
})().catch(e => { failures.push(e.message); console.log(e.stack); }).finally(async () => {
  await browser?.close(); server?.kill();
  fs.rmSync(temp, { recursive:true, force:true });
  console.log(`${passed} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
});
