#!/usr/bin/env node
"use strict";
// Real-browser check: clicking an image in the Ask box opens its preview in #lightbox; only clicking "Click to draw on it" opens Canvas.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) fs.mkdirSync(shots, { recursive:true });
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-box-image-")));
const PORT = 4500 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 400)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) {
    let value; try { value = await fn(); } catch { value = false; }
    if (value) return value;
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`);
    await wait(60);
  }
}
async function api(route, { method = "GET", body } = {}) {
  const res = await fetch(`${base}/api/lines${route}`, { method, headers:{ "content-type":"application/json", origin:base }, body:body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const server = spawn(process.execPath, [path.join(root, "server.js")], {
  cwd:root,
  stdio:["ignore", "pipe", "pipe"],
  env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_LINES_EXAMPLES:"0", HOME:temp, SHELL:"/bin/sh", PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" },
});
let log = ""; server.stdout.on("data", d => { log += d; }); server.stderr.on("data", d => { log += d; });

(async () => {
  await until(async () => (await fetch(`${base}/api/lines/projects`)).ok, "server ready", 20000);
  const docs = path.join(temp, "docs");
  fs.mkdirSync(docs, { recursive:true });
  const proj = await api("/projects", { method:"POST", body:{ name:"BoxImage", docsPath:docs } });

  const sharp = require("sharp");
  const pngA = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#dbeafe"/><rect x="60" y="60" width="680" height="380" rx="18" fill="#ffffff" stroke="#93c5fd" stroke-width="6"/><text x="400" y="275" font-size="72" text-anchor="middle" fill="#1e3a8a">Image One</text></svg>')).png().toBuffer();
  const pngB = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#dcfce7"/><rect x="60" y="60" width="680" height="380" rx="18" fill="#ffffff" stroke="#86efac" stroke-width="6"/><text x="400" y="275" font-size="72" text-anchor="middle" fill="#14532d">Image Two</text></svg>')).png().toBuffer();
  const svgC = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250"><rect width="400" height="250" fill="#fef3c7"/><text x="200" y="135" font-size="40" text-anchor="middle" fill="#92400e">Vector</text></svg>');

  const browser = await chromium.launch({ channel:"chrome" });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport:{ width:1280, height:840 }, reducedMotion:"reduce" });
    const page = await context.newPage();
    page.on("pageerror", err => errors.push(err.message));

    await page.goto(`${base}/projects.html#${proj.id}`);
    await page.waitForSelector(".composer .cmp-input");

    // 1. Attach a single PNG image in Home Ask box
    await page.locator("#filePick").setInputFiles({ name:"screenshot-with-a-long-filename-check.png", mimeType:"image/png", buffer:pngA });
    const card = page.locator(".composer .cmp-file.can-draw").first();
    await card.waitFor();
    const picBtn = card.locator(".cmp-file-pic");
    const editBtn = card.locator(".cmp-file-edit");
    check("thumbnail has zoom-in cursor and no pen badge overlay", await picBtn.evaluate(el => getComputedStyle(el).cursor) === "zoom-in" && await picBtn.locator("svg").count() === 0);
    check("Click to draw on it is its own button with pen icon", (await editBtn.locator("span").textContent()) === "Click to draw on it" && await editBtn.locator("svg").count() === 1);

    const cardBox = await card.boundingBox();
    const editBox = await editBtn.boundingBox();
    const strongBox = await card.locator(".cmp-file-text strong").boundingBox();
    const textBox = await card.locator(".cmp-file-text").boundingBox();
    check("Click to draw on it button stays compact under a long filename", editBox.width < strongBox.width - 10 && editBox.height >= 16 && (editBox.x + editBox.width) < (cardBox.x + cardBox.width), JSON.stringify({ editBox, strongBox, textBox }));
    if (shots) await page.locator(".composer").screenshot({ path:path.join(shots, "home-box-attached.png") });

    // 2. Click filename -> nothing opens
    await card.locator(".cmp-file-text strong").click();
    await wait(120);
    check("clicking filename opens neither preview nor Canvas", await page.locator("#lightbox").isHidden() && page.url().includes("projects.html"));

    // 3. Click empty space to the right of Click to draw on it -> nothing opens
    if ((textBox.x + textBox.width) - (editBox.x + editBox.width) > 12) {
      await page.mouse.click(editBox.x + editBox.width + 8, editBox.y + editBox.height / 2);
      await wait(120);
      check("clicking space beside Click to draw on it does not open Canvas", await page.locator("#lightbox").isHidden() && page.url().includes("projects.html"));
    }

    // 4. Click the image thumbnail -> opens image preview in #lightbox
    await picBtn.click();
    await until(async () => await page.locator("#lightbox .lb-image-viewport img").evaluate(img => img.naturalWidth > 0), "lightbox image");
    check("clicking image opens #lightbox preview without leaving page", page.url().includes("projects.html") && await page.locator("#lightbox").isVisible() && (await page.locator("#lightbox .lb-image-card header strong").textContent()) === "screenshot-with-a-long-filename-check.png");
    check("single image preview has no cycle counter", await page.locator("#lightbox .lb-count").count() === 0);
    if (shots) await page.screenshot({ path:path.join(shots, "home-image-preview.png") });
    await page.keyboard.press("Escape");
    check("Escape closes preview", await page.locator("#lightbox").isHidden());

    // 5. Attach a second PNG and a non-drawable SVG -> clicking cycles 1 / 3 .. 3 / 3
    await page.locator("#filePick").setInputFiles([
      { name:"second.png", mimeType:"image/png", buffer:pngB },
      { name:"diagram.svg", mimeType:"image/svg+xml", buffer:svgC },
    ]);
    await until(async () => await page.locator(".composer .cmp-file").count() === 3, "three attachments");
    const svgCard = page.locator(".composer .cmp-file", { hasText:"diagram.svg" });
    check("SVG attachment has clickable preview thumbnail and no Click to draw on it", await svgCard.locator(".cmp-file-pic").count() === 1 && await svgCard.locator(".cmp-file-edit").count() === 0);
    await svgCard.locator(".cmp-file-pic").click();
    await until(async () => await page.locator("#lightbox .lb-image-viewport img").evaluate(img => img.naturalWidth > 0), "svg lightbox");
    check("clicking SVG opens preview at 3 / 3", (await page.locator("#lightbox .lb-count").textContent()) === "3 / 3");
    await page.keyboard.press("ArrowRight");
    check("ArrowRight cycles back to first image 1 / 3", (await page.locator("#lightbox .lb-count").textContent()) === "1 / 3");
    await page.keyboard.press("Escape");

    // 6. Click "Click to draw on it" -> opens Canvas
    await page.locator(".composer .cmp-file", { hasText:"second.png" }).locator(".cmp-file-edit").click();
    await page.waitForURL(/linesDraft=1/);
    check("clicking Click to draw on it opens Canvas", page.url().includes("linesDraft=1") && page.url().includes("linesSeed="));
    await page.waitForSelector("[data-project-lines-link]");
    await page.locator("[data-project-lines-link]").first().click();
    await page.waitForURL(/projects\.html/);
    await page.waitForSelector(".composer .cmp-file");
    check("returning without drawing keeps all attachments in box", await page.locator(".composer .cmp-file").count() === 3);

    // 7. Dark mode & phone viewport check
    await page.evaluate(() => { document.documentElement.dataset.mode = "dark"; });
    await page.waitForTimeout(80);
    if (shots) await page.locator(".composer").screenshot({ path:path.join(shots, "home-box-dark.png") });
    await page.evaluate(() => { delete document.documentElement.dataset.mode; });
    await page.setViewportSize({ width:390, height:844 });
    await page.waitForTimeout(80);
    const phoneOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check("phone viewport has no horizontal overflow", !phoneOverflow);
    const phoneClear = await card.evaluate(el => {
      const e = el.querySelector(".cmp-file-edit").getBoundingClientRect();
      const x = el.querySelector('[data-act="cmp-remove"]').getBoundingClientRect();
      return e.right <= x.left + 1;
    });
    check("phone viewport Click to draw on it stays clear of remove button", phoneClear);
    if (shots) await page.locator(".composer").screenshot({ path:path.join(shots, "home-box-phone.png") });

    check("no browser errors", errors.length === 0, errors.join("; "));
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err.stack || err);
  console.error(log);
  process.exitCode = 1;
}).finally(() => {
  server.kill();
  fs.rmSync(temp, { recursive:true, force:true });
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
