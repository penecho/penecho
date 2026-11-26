#!/usr/bin/env node
"use strict";
// Isolated Files cleanup acceptance: size/status filters, selection, recoverable bulk deletion,
// Canvas/source overlap, keyboard controls and desktop/phone layouts. No real project is changed.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-files-cleanup.cjs [screenshots folder]
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
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const errors = [];
  const send = async (method, address, data) => (await context.request[method](`${base}/api/lines${address}`, { data, headers:{ origin:base } })).json();
  const post = (address, data) => send("post", address, data);
  const id = (await post("/projects", { name:"Garden", docsPath:docs })).project.id;
  const sketchId = (await post("/projects", { name:"Sketches", docsPath:sketches })).project.id;
  seed();
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
  const choose = async (id, label) => { await page.click(`#${id}`); await page.locator('#menu button', { hasText:label }).first().click(); await wait(60); };
  const opened = [];
  await page.exposeFunction("__opened", url => opened.push(url));
  await page.addInitScript(() => { window.open = url => { window.__opened(String(url)); return null; }; });

  console.log('Files cleanup');
  put(docs, 'lines/old.md', `${front({id:'G-OLD', status:'closed', created:stamp(3)})}# Old work\n\n## Ask · ${stamp(3)}\n\nOld files.\n`, 3);
  put(docs, 'files/old/large.txt', Buffer.alloc(2 * 1024 * 1024, 65), 3);
  put(docs, 'files/loose.txt', 'Keep until reviewed', 0);
  // A build left in the folder: kinds the page has no name for are files too, so they can be found and deleted.
  put(docs, 'files/build/app.dmg', Buffer.alloc(3 * 1024 * 1024, 66), 0);
  put(docs, 'files/build/build.json', '{}', 0);
  await open('files');
  await shot('cleanup-all');
  check('size visible on cards', (await texts('.fl-size')).some(value => /\d.*B/.test(value)));
  check('current-Line files carry no status word', !(await texts('.fl-tag')).includes('Current Line'));
  await choose('flSize', '1 MB or larger');
  check('size filter finds large file', (await cardNames()).includes('large.txt') && !(await cardNames()).includes('loose.txt'));
  check('size filter finds a file of any kind', (await cardNames()).includes('app.dmg'), (await cardNames()).join(', '));
  await choose('flSize', 'Any size');
  check('All shows other files as one card', (await cardNames()).includes('2 files') && !(await cardNames()).includes('app.dmg'), (await cardNames()).join(', '));
  await card('2 files').click();
  await page.waitForSelector('.fv');
  check('a stack of files opens with each file named in its strip', await count('.fv-strip .fl-strip-file') === 2, await text('.fv-side'));
  await page.keyboard.press('Escape');
  await until(async () => await count('.fv') === 0, 'viewer closed');
  await kind('other');
  check('Other shows them one by one', (await cardNames()).includes('app.dmg') && (await cardNames()).includes('build.json'), (await cardNames()).join(', '));
  await shot('cleanup-other');
  await kind('all');
  await choose('flSize', '1 MB or larger');
  await choose('flSize', 'Any size');
  await choose('flUsage', 'Archived Lines');
  check('archived file tagged', (await texts('.fl-tag')).includes('Archived Line'));
  check('filter summary shows count and total', /1 file · 2 MB/.test(await text('.fl-sum')));
  check('archived filter', (await cardNames()).includes('large.txt') && !(await cardNames()).includes('report.md'));
  await choose('flSort', 'Largest first');
  await shot('cleanup-desktop');
  await page.click('[data-act="file-select-all"]');
  check('select all matching', (await text('.fl-selbar')).includes('1 selected'));
  await shot('cleanup-selected');
  page.once('dialog', d => d.dismiss());
  await page.click('[data-act="file-delete-selected"]');
  check('cancel keeps file', await count('.fl-card') === 1);
  page.once('dialog', d => d.accept());
  await page.click('[data-act="file-delete-selected"]');
  await until(async () => await count('.fl-card') === 0, 'selected file removed');
  check('deleted entry recoverable', await count('[data-act="file-restore"]') > 0);
  check('Deleted says when entries go for good', /removed for good 7 days after/.test(await text('.cv-gone-note')));
  await shot('cleanup-deleted');
  await page.locator('[data-act="file-restore"]').last().click();
  await until(async () => (await cardNames()).includes('large.txt'), 'restore');
  check('restore keeps content', fs.existsSync(path.join(docs, 'archive/files/old/large.txt')) || fs.existsSync(path.join(docs, 'files/old/large.txt')));
  // Work 5's rules: a Topic's link keeps an archived file in use, a Canvas of its own is never offered, and an archived line keeps a note for a deleted picture.
  put(docs, 'lines/older.md', `${front({id:'G-OLDER', status:'closed', created:stamp(4)})}# Older work\n\n## Ask · ${stamp(4)}\n\nLook at this.\n\n![shot.png](../files/older/shot.png)\n\nThanks.\n`, 4);
  put(docs, 'files/older/shot.png', PNG, 4);
  put(docs, 'files/older/plan.md', '# Plan\n', 4);
  put(docs, 'topics/garden.md', '# Garden\n\nThe plan: [plan](../files/older/plan.md).\n', 0);
  await choose('flUsage', 'All files');
  await until(async () => { await open('files'); const all = await cardNames(); return all.includes('plan.md') && all.includes('shot.png'); }, 'the new files on the page');
  await choose('flUsage', 'Could be cleaned up');
  let names = await cardNames();
  check('archived picture and loose file are offered', names.includes('shot.png') && names.includes('notes.txt'), names.join(', '));
  check('a file a Topic links is not offered', !names.includes('plan.md'), names.join(', '));
  check('a Canvas of its own is not offered', !names.includes('Sketch'), names.join(', '));
  await choose('flUsage', 'In use');
  names = await cardNames();
  check('In use holds the Topic-linked file and the Canvas of its own', names.includes('plan.md') && names.includes('Sketch'), names.join(', '));
  await choose('flUsage', 'All files');
  await page.locator('#flQ').fill('plan.md');
  await page.click('[data-act="file-select-all"]');
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.click('[data-act="file-delete-selected"]');
  check('deleting a file in use says so', /It is in use/.test(asked), asked);
  await page.click('[data-act="file-select-clear"]');
  await page.locator('#flQ').fill('shot');
  await page.click('[data-act="file-select-all"]');
  page.once('dialog', d => d.accept());
  await page.click('[data-act="file-delete-selected"]');
  await until(async () => await count('.fl-card') === 0, 'archived picture deleted');
  const olderText = () => { const archived = path.join(docs, 'archive/lines/older.md'); return fs.readFileSync(fs.existsSync(archived) ? archived : path.join(docs, 'lines/older.md'), 'utf8'); };
  check('the archived line keeps a note in the picture\'s place', /Look at this\.\n\n\(File deleted on \d{4}-\d{2}-\d{2}: shot\.png\)\n\nThanks\./.test(olderText()), olderText().slice(-200));
  await page.goto(`${base}/projects.html#${id}/line/older`);
  await until(async () => /File deleted on/.test(await page.locator('body').textContent()), 'the note on the line page');
  await shot('cleanup-archived-note');
  check('the line page shows the note with no Markdown marks', !/\*File deleted/.test(await page.locator('body').textContent()));
  await open('files');
  await page.locator('#flQ').fill('');
  await choose('flUsage', 'All files');
  await page.locator('#flQ').fill('picture');
  await page.click('[data-act="file-select-all"]');
  check('picture stacks select underlying files', await page.locator('.fl-select[aria-checked="true"]').count() >= 3);
  await page.click('[data-act="file-select-clear"]');
  await page.locator('#flQ').fill('');
  await page.locator('#flQ').fill('bed');
  await page.click('[data-act="file-select-all"]');
  page.once('dialog', d => d.accept());
  await page.click('[data-act="file-delete-selected"]');
  await until(async () => await count('.fl-select') === 0, 'Canvas and source deleted together');
  check('Canvas deletion includes its selected source without failure', await count('[role="alert"].fl-cleanup-note') === 0);
  await page.locator('#toast button').click();
  await until(async () => (await cardNames()).length >= 2, 'bulk Undo restores Canvas and page');
  check('bulk Undo restores source file', fs.existsSync(path.join(docs, 'files/beds/bed-plan.explorer.html')));
  await page.locator('#flQ').fill('report');
  const selector = page.locator('.fl-select').first();
  await selector.focus(); await page.keyboard.press('Space');
  check('checkbox selection by keyboard', await page.locator('.fl-select[aria-checked="true"]').count() === 1);
  await page.locator('#flQ').fill('');
  check('boxes hidden until hover or choosing', await page.locator('.fl-select').first().evaluate(el => getComputedStyle(el).opacity) === '0');
  const selectable = page.locator('.fl-card:has(.fl-select)');
  await selectable.nth(0).hover(); await selectable.nth(0).locator('.fl-select').click();
  await selectable.nth(1).click({ position:{ x:20, y:150 } });
  check('a card click chooses it while choosing', await page.locator('.fl-select[aria-checked="true"]').count() === 2 && await count('.fv') === 0);
  await page.click('[data-act="file-select-clear"]');
  await page.locator('#flQ').fill('');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => document.querySelector('#toast')?.setAttribute('hidden', ''));
  await shot('cleanup-phone');
  check('phone has no page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#flUsage').focus(); await page.keyboard.press('Enter');
  check('filter menu opens by keyboard', await count('#menu button') === 6);
  check('Line status menu explains each rule', /Nothing current links to it/.test(await text('#menu')) && await count('#menu button.has-note') === 5);
  await shot('cleanup-menu');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme:'dark' });
  await page.evaluate(() => document.documentElement.dataset.mode = 'dark');
  await shot('cleanup-dark');
  check('no page errors', errors.length === 0, errors.join(' | '));
})().catch(error => { failures.push(error.message); console.log(`FAIL  ${error.stack || error.message}`); }).finally(async () => {
  await browser?.close().catch(() => {});
  server.kill();
  try { fs.rmSync(temp, { recursive:true, force:true }); } catch { /* Left for the system to clear. */ }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
});
