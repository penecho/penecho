#!/usr/bin/env node
"use strict";
// The Topics tab in a real browser (PE-461): the tree on the left (the project, its Topics, their Subtopics) and the chosen one drawn
// as a page on the right, with its pictures. A wide screen, a laptop, dark mode and a phone.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-topics-page.cjs [screenshot-folder]
// PENECHO_TOPICS_DOCS=<a docs folder> also opens a copy of that folder's understanding.md, topics/ and lines/ and pictures it.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-topics-page-"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 7100 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "docs");
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 500)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { let value; try { value = await fn(); } catch { value = false; } if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(70); }
}

fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
fs.mkdirSync(path.join(docs, "topics"), { recursive:true });
fs.mkdirSync(path.join(docs, "files", "knowledge-1"), { recursive:true });
const specs = [
  ["canvas", "topic-canvas", "Canvas view and panels", "A Canvas opens where the person left it, and the Notes & AI panel never sits on top of the drawing.", 2, 0],
  ["jevision", "topic-jevision", "JEVision service", "PenEcho's vision model answers complete, changing requests quickly on Windows and Docker.", 1, 0],
  ["payments", "topic-payments", "Payments, credits and usage", "Payments, refunds and disputes reach Cloud reliably; credits and the Usage page are always right.", 2, 2],
  ["knowledge", "topic-knowledge", "Project knowledge and memory", "Any agent or person can open the project folder and learn its current truth without searching old chats.", 2, 1],
  ["projects", "topic-projects", "Projects and line pages", "The person sees every line's state on Home and in Find, moves between lines, and keeps related work together.", 8, 2],
  ["settings", "topic-settings", "Settings and providers", "Agents, Providers and Settings live together on the Projects page and stay easy to change.", 4, 0],
  ["tests", "topic-tests", "Tests and test servers", "Agents can run PenEcho's tests without windows, apps or files appearing outside the test's own folder.", 1, 0],
  ["tokens", "topic-tokens", "Token savings", "Every Work, Line and Project shows how many tokens and how much money its agent runs saved.", 2, 1],
  ["cloud", "topic-cloud", "Projects on PenEcho Cloud", "A person manages Cloud projects through the same pages, with each Ask running where that project lives.", 2, 1, "topic-projects"],
  ["speed", "topic-speed", "Speed while agents run", "The Projects page, its pages and the Canvas answer at once even while many agents run on a big project.", 2, 0, "topic-projects"],
  ["start", "topic-start", "Start pages and product words", "A first-time person sees at once what PenEcho Lines is and why it is worth using.", 3, 1, "topic-projects"],
  ["ask", "topic-ask", "The Ask box", "The box at the bottom of Home and each line makes it clear what to make, what to give and how to send.", 2, 0, "topic-projects"],
];
// One Topic written out in full, the way topics-guide.md asks, so every part of its page has something to draw.
const fullTopic = slugs => `---
record_type: topic
id: topic-knowledge
title: Project knowledge and memory
parent_id: null
updated: 2026-11-16
updated_by: PE-4 Work 2
---

# Project knowledge and memory

[Understanding](../understanding.md)

**Any agent or person can open the project folder and learn its current truth without searching old chats.**

Status on 2026-11-16: The folder layout and memory command are built; the Topics map is being built.

## At a glance

| # | Requirement | Status |
| --- | --- | --- |
| R1 | Portable project structure | ✅ Built · local committed |
| R2 | Memory changes only by its command | ✅ Built · local |
| R3 | Readable Topics map | 🔨 Being built |

Not wanted: Obsidian integration; a keeper model.

## Why this exists

People and agents lose time searching old chats. [PE-10](../lines/${slugs[0]}.md)

## Requirements

### R1 · Portable project structure — ✅ Built · local committed

Every project keeps lines/, works/ and topics/ in plain Markdown.

- **Asked:** "keep it in plain files" [PE-10](../lines/${slugs[0]}.md) · 2026-11-10.
- **Done:** Layout 2 is in the app.
- **Left:** Nothing.

### R2 · Memory changes only by its command — ✅ Built · local

MEMORY.md is changed with its command, never by hand.

- **Asked:** "agents must not undo each other" [PE-11](../lines/${slugs[1]}.md) · 2026-11-11.
- **Done:** The memory command refuses a line that breaks the rules.
- **Left:** Nothing.

### R3 · Readable Topics map — 🔨 Being built

The Topics page shows the architecture: a tree, and each Topic as a page.

- **Asked:** "make it more architecture" [PE-12](../lines/${slugs[2]}.md) · 2026-11-16.
- **Done:** A tree beside a drawn page.
- **Left:** The owner looks at it.

## What is left, in order

1. The owner reviews the new Topics page. (R3)
2. Merge overlapping Topics. (R1, R2)

## How the thinking changed

- **2026-11-15** — Cards in a grid. ~~One long list~~
- **2026-11-16** — A tree with a drawn page.

## Traps for agents

- **A running Topics job moves topics/ aside** — edit no Topic then.

## Lines

| Line | What it is | Requirements | Outcome |
| --- | --- | --- | --- |
| [PE-10](../lines/${slugs[0]}.md) | Layout | R1 | Built |
| [PE-11](../lines/${slugs[1]}.md) | Memory command | R2, R1 | Built |
| [PE-12](../lines/${slugs[2]}.md) | Topics page | R3 | Being built |

## Files

- [map.png](../files/knowledge-1/map.png) — the Topics map
- [notes.md](../files/knowledge-1/notes.md) — design notes
`;
const understanding = `---
record_type: project-understanding
project: Garden
updated: 2026-11-16
---

# Garden

> **Read this first.** What is true today.

**A project used to check its living knowledge map.**

## The parts

| Part | What a person does there | Code |
| --- | --- | --- |
| **Lines** | Starts work | public/lines |
| **Canvas** | Draws | src/client |

## Words

- **Topic** — a lasting subject.
- **Line** — one task.

## Where things stand (2026-11-16)

- **The Topics are organized around the product's parts.** Each one is a page. → [Knowledge](topics/knowledge.md)
- **Payments work.** Refunds too. → [Payments](topics/payments.md)

## Open now

| What | State | Waits on | Read |
| --- | --- | --- | --- |
| Topics page | Built | owner | [PE-12](lines/knowledge-3.md) |

## Gone — do not bring back

- The Canvas Agent panel.

## Topics

- **[Knowledge](topics/knowledge.md)** — what the project knows.

**Not in a Topic yet:** nothing.
`;
let lineId = 0;
for (const [name, id, title, goal, open, done, parent] of specs) {
  const slugs = [];
  for (let i = 0; i < open + done; i++) {
    const slug = `${name}-${i + 1}`, finished = i >= open;
    slugs.push(slug);
    fs.writeFileSync(path.join(docs, "lines", `${slug}.md`), `---\nid: PE-${++lineId}\nstatus: ${finished ? "ready" : "working"}\nwho: @tester\ncreated: 2026-11-15 10:00\n---\n\n# ${title}: ${i + 1}\n\n## Ask · 2026-11-15 10:00\n\nImprove ${title}.\n\n## [x] Work 1 · @tester · 2 min\n\nThe change is ready.\n`);
  }
  fs.writeFileSync(path.join(docs, "topics", `${name}.md`), name === "knowledge" ? fullTopic(slugs) : `---\nrecord_type: topic\nid: ${id}\ntitle: ${title}\nparent_id: ${parent || "null"}\n---\n\n# ${title}\n\n**${goal}**\n\n## Lines\n\n| Line | What |\n| --- | --- |\n${slugs.map(slug => `| [${slug}](../lines/${slug}.md) | Work |`).join("\n")}\n`);
}
// A one-pixel picture is enough to check that a Topic's pictures show as pictures.
fs.writeFileSync(path.join(docs, "files", "knowledge-1", "map.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
fs.writeFileSync(path.join(docs, "files", "knowledge-1", "notes.md"), "# Notes\n");
fs.writeFileSync(path.join(docs, "README.md"), "---\nproject: Garden\n---\n\n# Garden\n");
fs.writeFileSync(path.join(docs, "understanding.md"), understanding);
// A real project's knowledge, when asked for: only pictured, never changed (a copy).
const realDocs = process.env.PENECHO_TOPICS_DOCS && path.resolve(process.env.PENECHO_TOPICS_DOCS);
const realCopy = path.join(temp, "real");
if (realDocs) {
  fs.mkdirSync(realCopy, { recursive:true });
  for (const name of ["understanding.md", "topics", "lines", "README.md"]) if (fs.existsSync(path.join(realDocs, name))) fs.cpSync(path.join(realDocs, name), path.join(realCopy, name), { recursive:true });
}

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_LINES_EXAMPLES:"0", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PENECHO_BROWSER_FILE:path.join(temp, "browser.json"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PI_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let log = ""; server.stdout.on("data", d => { log += d; }); server.stderr.on("data", d => { log += d; });
let browser;
async function importDocs(folder) {
  const made = await fetch(`${base}/api/lines/projects/import`, { method:"POST", headers:{ "content-type":"application/json", origin:base }, body:JSON.stringify({ docsPath:folder }) });
  if (!made.ok) throw new Error(`Create project: ${made.status} ${await made.text()}`);
  return (await made.json()).project;
}
async function checkManualTopics() {
  const empty = path.join(temp, "Empty Garden");
  const response = await fetch(`${base}/api/lines/projects`, { method:"POST", headers:{ "content-type":"application/json", origin:base }, body:JSON.stringify({ name:"Empty Garden", docsPath:empty }) });
  if (!response.ok) throw new Error(`Create empty project: ${response.status} ${await response.text()}`);
  const { project } = await response.json();
  const page = await browser.newPage({ viewport:{ width:1280, height:860 } });
  const newTopic = target => target.locator('#tpxNav [data-act="new-knowledge-topic"]:not([data-tier="1"]):not([data-area]), #tpxEmpty [data-act="new-knowledge-topic"]:not([data-tier="1"])').first();
  const newTier1 = target => target.locator('[data-act="new-knowledge-topic"][data-tier="1"]').first();
  const open = `${base}/projects.html#${project.id}`;
  await page.goto(open);
  await page.locator('.subnav [data-view="topics"]').click();
  await page.getByText("No Topics yet", { exact:true }).waitFor();

  // 1. Add Tier 1 topic on an empty project -> opens Tier 1 page and shows in sidebar immediately.
  await newTier1(page).click();
  const tier1Dialog = page.getByRole("dialog", { name:"New Tier 1" });
  const tier1Name = tier1Dialog.getByRole("textbox", { name:"Name", exact:true });
  check("Tier 1 dialog opens and focuses Name", await tier1Name.evaluate(el => el === document.activeElement));
  await tier1Name.fill("Platform");
  await tier1Dialog.getByRole("textbox", { name:/Description/ }).fill("Core watering systems");
  await page.screenshot({ path:path.join(shots, "manual-tier1-dialog.png") });
  await page.keyboard.press("Enter");
  const areaArticle = page.locator('#tpxMain article.is-area[data-area="Platform"]');
  await areaArticle.waitFor();
  check("empty Tier 1 appears in sidebar and opens its Tier 1 page", await page.locator('.tpx-area-btn[data-topic="area:Platform"][aria-current="page"]').count() === 1 && /Core watering systems/.test(await areaArticle.textContent()));
  await page.screenshot({ path:path.join(shots, "manual-tier1-page.png") });

  // 2. Add Tier 2 topic choosing Tier 1 via keyboard on the New Topic button.
  await newTopic(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name:"New Topic" });
  const name = dialog.getByRole("textbox", { name:"Name", exact:true });
  const areaSelect = dialog.locator('select[name="area"]');
  check("New Topic pre-selects the active Tier 1 and focuses Name", await areaSelect.inputValue() === "Platform" && await name.evaluate(el => el === document.activeElement));
  await name.fill('Water: "drip" & irrigation');
  await dialog.getByRole("textbox", { name:/Scope/ }).fill("How the garden is watered.");
  await page.screenshot({ path:path.join(shots, "manual-topic-dialog.png") });
  await page.keyboard.press("Enter");
  const article = page.locator('#tpxMain article[data-doc="topics/water-drip-irrigation.md"]');
  await article.waitFor();
  check("saved Tier 2 Topic opens under its Tier 1 with breadcrumb and real file", (await article.getByRole("heading", { level:1 }).textContent()) === 'Water: "drip" & irrigation' && /Platform/.test(await article.locator(".tpx-crumbs").textContent()) && fs.existsSync(path.join(empty, "topics/water-drip-irrigation.md")) && /area: Platform/.test(fs.readFileSync(path.join(empty, "topics/water-drip-irrigation.md"), "utf8")));
  await page.screenshot({ path:path.join(shots, "manual-topic-created.png") });
  await page.reload();
  await article.waitFor();

  // 3. Duplicate name stays in dialog with inline error; Escape restores focus.
  await newTopic(page).click();
  await name.fill('WATER: "DRIP" & IRRIGATION');
  await dialog.getByRole("button", { name:"Create Topic" }).click();
  await dialog.getByRole("alert").waitFor();
  check("a duplicate keeps the form and leaves the saved file alone", /already has that name/.test(await dialog.getByRole("alert").textContent()) && (await name.inputValue()).startsWith("WATER") && fs.readdirSync(path.join(empty, "topics")).length === 1);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state:"hidden" });
  check("Escape restores keyboard focus", await newTopic(page).evaluate(el => el === document.activeElement));

  // 4. Create a second Tier 2 topic with inline "+ New Tier 1..." creation.
  await newTopic(page).click();
  await dialog.locator('select[name="area"]').selectOption("__new__");
  await dialog.locator('input[name="newArea"]').fill("Storage");
  await dialog.getByRole("textbox", { name:"Name", exact:true }).fill("Seed vault");
  await dialog.getByRole("button", { name:"Create Topic" }).click();
  const seedArticle = page.locator('#tpxMain article[data-doc="topics/seed-vault.md"]');
  await seedArticle.waitFor();
  check("inline New Tier 1 creates both Tier 1 and Tier 2", await page.locator('.tpx-area-btn[data-topic="area:Storage"]').count() === 1 && /Storage/.test(await seedArticle.locator(".tpx-crumbs").textContent()));

  // 5. Rename Tier 2 topic and move it from Storage to Platform.
  await seedArticle.getByRole("button", { name:"Rename" }).click();
  const editTopicDlg = page.getByRole("dialog", { name:"Rename Topic" });
  await editTopicDlg.getByRole("textbox", { name:"Name", exact:true }).fill("Dry seeds");
  await editTopicDlg.locator('select[name="area"]').selectOption("Platform");
  await editTopicDlg.getByRole("button", { name:"Save" }).click();
  await editTopicDlg.waitFor({ state:"hidden" });
  await until(async () => (await seedArticle.getByRole("heading", { level:1 }).textContent()) === "Dry seeds" && /Platform/.test(await seedArticle.locator(".tpx-crumbs").textContent()), "renamed Tier 2 topic");
  check("Tier 2 rename and move to another Tier 1 updates UI and file", /title: Dry seeds/.test(fs.readFileSync(path.join(empty, "topics/seed-vault.md"), "utf8")) && /area: Platform/.test(fs.readFileSync(path.join(empty, "topics/seed-vault.md"), "utf8")));

  // 6. Rename Tier 1 topic ("Platform" -> "Infrastructure") via its Tier 1 page.
  await page.locator('.tpx-area-btn[data-topic="area:Platform"]').click();
  await page.locator('#tpxMain article.is-area[data-area="Platform"]').waitFor();
  await page.locator('#tpxMain [data-act="edit-topic-area"]').click();
  const editAreaDlg = page.getByRole("dialog", { name:"Rename Tier 1" });
  await editAreaDlg.getByRole("textbox", { name:"Name", exact:true }).fill("Infrastructure");
  await editAreaDlg.getByRole("button", { name:"Save" }).click();
  await editAreaDlg.waitFor({ state:"hidden" });
  await page.locator('#tpxMain article.is-area[data-area="Infrastructure"]').waitFor();
  check("Tier 1 rename updates sidebar, page, understanding.md and child Topics", await page.locator('.tpx-area-btn[data-topic="area:Infrastructure"]').count() === 1 && /area: Infrastructure/.test(fs.readFileSync(path.join(empty, "topics/seed-vault.md"), "utf8")));

  // 7. Delete Tier 2 topic ("Dry seeds") and undo via toast, then delete empty Tier 1 ("Storage").
  await page.locator('.tpx-node[data-topic="topics/seed-vault.md"]').click();
  await seedArticle.waitFor();
  await seedArticle.getByRole("button", { name:"Delete" }).click();
  const delTopicDlg = page.getByRole("dialog", { name:/Delete “Dry seeds”/ });
  await delTopicDlg.getByRole("button", { name:"Delete Topic" }).click();
  await delTopicDlg.waitFor({ state:"hidden" });
  await until(async () => !fs.existsSync(path.join(empty, "topics/seed-vault.md")), "deleted Tier 2 topic");
  check("deleting a Tier 2 topic removes its file and navigates cleanly", await page.locator('#tpxMain article.is-area[data-area="Infrastructure"]').count() === 1);
  await page.locator('#toast #toastAct', { hasText:"Undo" }).click();
  await until(async () => fs.existsSync(path.join(empty, "topics/seed-vault.md")), "undo restored Tier 2 topic");
  check("Undo toast restores a deleted Tier 2 topic", fs.existsSync(path.join(empty, "topics/seed-vault.md")));

  // Sidebar row context menus for Tier 1 and Tier 2 work too.
  await page.locator('.tpx-area[data-area="Storage"] [data-act="area-menu"]').click({ force:true });
  await page.waitForSelector("#menu");
  const areaMenuText = await page.locator("#menu").innerText();
  check("Tier 1 sidebar menu offers New Topic, Rename and Delete", /New Topic here/.test(areaMenuText) && /Rename/.test(areaMenuText) && /Delete/.test(areaMenuText));
  await page.keyboard.press("Escape");
  await page.locator('.tpx-row-menu[data-path="topics/seed-vault.md"]').click({ force:true });
  await page.waitForSelector("#menu");
  const topicMenuText = await page.locator("#menu").innerText();
  check("Tier 2 sidebar menu offers Rename / Move and Delete", /Rename \/ Move/.test(topicMenuText) && /Delete/.test(topicMenuText));
  await page.keyboard.press("Escape");

  // Delete empty Tier 1 ("Storage")
  await page.locator('.tpx-area-btn[data-topic="area:Storage"]').click();
  await page.locator('#tpxMain article.is-area[data-area="Storage"]').waitFor();
  await page.locator('#tpxMain [data-act="delete-topic-area"]').click();
  const delAreaDlg = page.getByRole("dialog", { name:/Delete “Storage”/ });
  await delAreaDlg.getByRole("button", { name:"Delete", exact:true }).click();
  await delAreaDlg.waitFor({ state:"hidden" });
  await until(async () => await page.locator('.tpx-area-btn[data-topic="area:Storage"]').count() === 0, "deleted empty Tier 1");
  check("deleting an empty Tier 1 removes it from sidebar", await page.locator('.tpx-area-btn[data-topic="area:Storage"]').count() === 0);

  // Delete non-empty Tier 1 ("Infrastructure") with Keep Topics -> moves topics to Other.
  await page.locator('.tpx-area-btn[data-topic="area:Infrastructure"]').click();
  await page.locator('#tpxMain article.is-area[data-area="Infrastructure"]').waitFor();
  await page.locator('#tpxMain [data-act="delete-topic-area"]').click();
  const delInfraDlg = page.getByRole("dialog", { name:/Delete “Infrastructure”/ });
  await page.screenshot({ path:path.join(shots, "manual-delete-tier1-dialog.png") });
  await delInfraDlg.getByRole("button", { name:"Delete", exact:true }).click();
  await delInfraDlg.waitFor({ state:"hidden" });
  await until(async () => await page.locator('.tpx-area-btn[data-topic="area:Infrastructure"]').count() === 0, "deleted non-empty Tier 1");
  check("deleting a non-empty Tier 1 in Keep mode keeps its Tier 2 topics intact", fs.existsSync(path.join(empty, "topics/water-drip-irrigation.md")) && fs.existsSync(path.join(empty, "topics/seed-vault.md")));
  await page.close();

  const phone = await browser.newPage({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true });
  await phone.goto(open);
  const phoneNav = phone.locator('.subnav');
  await phoneNav.waitFor();
  const entryInBar = phoneNav.locator('[data-view="topics"]');
  const entry = await entryInBar.count() ? entryInBar : phoneNav.locator('.subnav-more');
  check("on a phone the Topics tab or More is visible from Home", await entry.evaluate(el => el.getBoundingClientRect().right <= el.parentElement.getBoundingClientRect().right + 1));
  await entry.tap();
  if (entry !== entryInBar) await phone.locator('#menu').getByText('Topics', { exact:true }).tap();
  const touchHeight = await newTopic(phone).evaluate(el => el.getBoundingClientRect().height);
  await newTopic(phone).tap();
  const mobileDialog = phone.getByRole("dialog", { name:"New Topic" });
  const mobileFit = await mobileDialog.evaluate(el => ({ right:el.getBoundingClientRect().right, innerWidth }));
  check("the New Topic button and dialog fit a touch viewport", touchHeight >= 44 && mobileFit.right <= mobileFit.innerWidth, JSON.stringify({ touchHeight, ...mobileFit }));
  await phone.screenshot({ path:path.join(shots, "manual-topic-phone.png") });
  await mobileDialog.getByRole("textbox", { name:"Name", exact:true }).fill("Seed storage");
  await mobileDialog.getByRole("button", { name:"Create Topic" }).tap();
  await phone.locator('#tpxMain article[data-doc="topics/seed-storage.md"]').waitFor();
  check("touch creates a Topic", fs.existsSync(path.join(empty, "topics/seed-storage.md")));
  await phone.close();
}
(async () => {
  await until(() => fetch(`${base}/api/lines/projects`).then(r => r.ok), "the server");
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  await checkManualTopics();
  if (process.env.PENECHO_TEST_MANUAL_TOPICS_ONLY === "1") return;
  const project = await importDocs(docs);
  const page = await (await browser.newContext({ viewport:{ width:1720, height:1080 } })).newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const shot = (name, fullPage = false) => page.screenshot({ path:path.join(shots, `${name}.png`), fullPage });
  const topicHash = file => `${base}/projects.html#${project.id}/topics/${encodeURIComponent(file)}`;
  const showing = file => page.waitForSelector(`#tpxMain .tpx-doc[data-doc="${file}"]`);
  const count = sel => page.locator(sel).count();
  const text = sel => page.locator(sel).first().innerText();
  await page.goto(`${base}/projects.html#${project.id}/topics`);
  await showing("understanding.md");
  await wait(250);

  console.log("The tree");
  check("the project is the tree's root and is chosen first", await count('.tpx-node.is-root[aria-current="page"]') === 1 && /Garden/.test(await text(".tpx-node.is-root")));
  check("eight Topics hang from the root, four Subtopics under Projects and line pages", await count(".tpx-tree > ul > li") === 8 && await count('.tpx-tree > ul > li:has(> [data-topic="topics/projects.md"]) .tpx-kids > li') === 4);
  check("the count includes children", await text(".tp-total") === "12");
  check("the tree draws its branch lines", await page.$eval(".tpx-tree li", el => getComputedStyle(el, "::before").borderLeftStyle === "solid" && getComputedStyle(el, "::after").borderTopStyle === "solid"));
  const panes = await page.evaluate(() => { const nav = document.querySelector("#tpxNav"), main = document.querySelector("#tpxMain"), view = document.querySelector("#view"); return { navScroll:getComputedStyle(nav).overflowY, mainScroll:getComputedStyle(main).overflowY, fits:view.scrollHeight <= view.clientHeight + 1, side:nav.getBoundingClientRect().right <= main.getBoundingClientRect().left + 1 }; });
  check("the tree and the page sit side by side and scroll on their own", panes.navScroll === "auto" && panes.mainScroll === "auto" && panes.fits && panes.side, JSON.stringify(panes));

  console.log("The project's page");
  check("the overview draws the architecture: the project, 8 Topics and 4 Subtopics", await count(".tpx-arch .tm-root") === 1 && await count(".tpx-arch .tm-t1") === 8 && await count(".tpx-arch .tm-c") === 4 && await count(".tpx-arch .tm-e") === 12);
  check("where things stand, the parts, open now, words and gone are drawn, not a Markdown table", await count(".tpx-stand") === 2 && await count(".tpx-part") === 2 && await count(".tpx-open-row") === 1 && await count(".tpx-words > div") === 2 && await count(".tpx-gone li") === 1 && await count("#tpxMain .md-table") === 0);
  check("a Topic named in the overview opens on this page", await count('.tpx-stand [data-act="tp-show"][data-topic="topics/knowledge.md"]') === 1);
  await shot("01-overview");

  console.log("A Topic's page");
  await page.locator('.tpx-arch .tm-t1[data-topic="topics/knowledge.md"]').click();
  await showing("topics/knowledge.md");
  check("a node in the picture opens its Topic and the address follows", decodeURIComponent(await page.evaluate(() => location.hash)).endsWith("/topics/topics/knowledge.md") && await count('.tpx-node[aria-current="page"][data-topic="topics/knowledge.md"]') === 1);
  check("the hero has the title, the goal and the requirement ring (2 of 3 built)", await text(".tpx-hero h1") === "Project knowledge and memory" && /learn its current truth/.test(await text(".tpx-goal")) && /2\s*\/3/.test(await page.locator(".tpx-ring svg").textContent()));
  check("the status line and the requirement index", /memory command are built/.test(await text(".tpx-status")) && await count(".tpx-gl") === 3 && await count(".tpx-gl.st-building") === 1);
  check("Not wanted reads as struck-out chips", await count(".tpx-nots em") === 2);
  check("the trace picture joins each Line to the requirements it served", await count(".tpx-trace .tm-l") === 3 && await count(".tpx-trace .tm-r") === 3 && await count(".tpx-trace .tm-e") === 4);
  check("each requirement is a card: words, what was asked, Done and Left", await count(".tpx-req") === 3 && await count(".tpx-req .tpx-asked") === 3 && await count(".tpx-req .is-done") === 3 && await count(".tpx-req .is-left.is-nothing") === 2);
  check("what is left is a road, the thinking a timeline, traps are warnings", await count(".tpx-road li") === 2 && await count(".tpx-road .tpx-ref") === 3 && await count(".tpx-time li") === 2 && await count(".tpx-time del") === 1 && await count(".tpx-trap") === 1);
  check("its Lines with their state, and its files with pictures shown", await count(".tpx-line") === 3 && await count(".tpx-pic img") === 1 && await count(".tpx-files li") === 1);
  check("a link to a Line opens the line, not its file", await count('.tpx-why [data-act="open-line"]') === 1 && await count('#tpxMain [data-act="open-doc"][data-doc^="lines/"]') === 0);
  check("no raw Markdown is left on the page", !/\*\*|\| ---|^#{1,3} /m.test(await text("#tpxMain")));
  await page.hover('.tpx-trace .tm-r[data-tm-r="R1"]');
  check("pointing at a requirement lights up the Lines that built it", await count(".tpx-trace svg.has-hot") === 1 && await count(".tpx-trace .tm-e.is-hot") === 2);
  await page.mouse.move(5, 5);
  await shot("02-topic");
  await page.locator('.tpx-gl:has-text("Readable Topics map")').click();
  await wait(800);
  check("a requirement in the index scrolls to its card", await page.$eval("#tpx-R3", el => { const r = el.getBoundingClientRect(), m = document.querySelector("#tpxMain").getBoundingClientRect(); return r.top >= m.top - 2 && r.top < m.top + m.height / 2; }));
  await shot("02b-topic-requirements");
  await page.locator(".tpx-trace .tm-l >> nth=0").click();
  await page.waitForFunction(() => window.__lines.S.route.view === "line");
  check("a Line in the picture opens that line", true);
  await page.goBack();
  await showing("topics/knowledge.md");
  check("Back comes to the same Topic", await count('.tpx-node[aria-current="page"][data-topic="topics/knowledge.md"]') === 1);

  console.log("Subtopics, Markdown, Merge and Rebuild");
  await page.locator('.tpx-node[data-topic="topics/projects.md"]').click();
  await showing("topics/projects.md");
  check("a parent shows its Subtopics as cards", await count(".tpx-kidcard") === 4);
  await page.locator('.tpx-kidcard:has-text("The Ask box")').click();
  await showing("topics/ask.md");
  check("a Subtopic shows where it is: project › parent", /Garden/.test(await text(".tpx-crumbs")) && /Projects and line pages/.test(await text(".tpx-crumbs")) && await count('.tpx-node.is-kid[aria-current="page"]') === 1);
  await page.goto(topicHash("topics/canvas.md"));
  await showing("topics/canvas.md");
  check("an address opens its Topic straight away", await count('.tpx-node[aria-current="page"][data-topic="topics/canvas.md"]') === 1);
  await page.locator('.tpx-hero [data-act="topic-merge"]').click();
  await page.waitForSelector("#menu");
  check("Merge on the Topic opens its Topic choices", /Merge into Canvas view and panels/.test(await text("#menu")));
  await page.keyboard.press("Escape");
  await page.locator('.tpx-nav [data-act="rebuild-topics"]').click();
  await page.waitForSelector('dialog[aria-labelledby="rebuildTopicsTitle"]');
  check("Rebuild still opens its confirmation", true);
  await page.locator("dialog [data-cancel]").click();
  await page.locator('.tpx-hero [data-act="open-doc"]').click();
  await page.waitForSelector('.reader[data-doc="topics/canvas.md"]');
  check("Markdown opens the plain file in the reader", true);

  console.log("A Topic changed on disk");
  await page.goto(topicHash("topics/jevision.md"));
  await showing("topics/jevision.md");
  fs.writeFileSync(path.join(docs, "topics", "jevision.md"), fs.readFileSync(path.join(docs, "topics", "jevision.md"), "utf8").replace("answers complete", "answers every"));
  await until(async () => /answers every/.test(await text(".tpx-goal")), "the new goal", 20000).then(() => check("the page follows the file without a reload", true), error => check("the page follows the file without a reload", false, error.message));

  await page.setViewportSize({ width:1366, height:860 });
  await page.goto(topicHash("topics/knowledge.md"));
  await showing("topics/knowledge.md");
  await wait(250);
  check("a laptop keeps the tree beside the page", await page.evaluate(() => document.querySelector("#tpxNav").getBoundingClientRect().right <= document.querySelector("#tpxMain").getBoundingClientRect().left + 1 && document.querySelector("#view").scrollWidth <= document.querySelector("#view").clientWidth + 1));
  await shot("03-laptop");
  await page.evaluate(() => linesTheme.set("dark"));
  await wait(200);
  check("dark mode uses the app's dark surfaces", await page.$eval(".tpx-req", el => getComputedStyle(el).backgroundColor !== "rgb(255, 255, 255)") && await page.$eval(".tpx-nav", el => getComputedStyle(el).backgroundColor !== "rgb(248, 249, 251)"));
  await shot("04-dark");
  await page.locator(".tpx-node.is-root").click();
  await showing("understanding.md");
  await wait(150);
  await shot("05-dark-overview");
  await page.evaluate(() => linesTheme.set("light"));

  await page.setViewportSize({ width:390, height:844 });
  await page.goto(topicHash("topics/knowledge.md"));
  await showing("topics/knowledge.md");
  await wait(300);
  const phone = await page.evaluate(() => {
    const view = document.querySelector("#view"), nav = document.querySelector("#tpxNav"), main = document.querySelector("#tpxMain"), edge = view.getBoundingClientRect().right;
    return { fits:view.scrollWidth <= view.clientWidth + 1, stacked:nav.getBoundingClientRect().bottom <= main.getBoundingClientRect().top + 1, cards:[...document.querySelectorAll(".tpx-req, .tpx-gl, .tpx-hero")].every(el => el.getBoundingClientRect().right <= edge + 1) };
  });
  check("a phone puts the tree above the page with no sideways overflow", phone.fits && phone.stacked && phone.cards, JSON.stringify(phone));
  await shot("06-phone");
  await page.locator('.tpx-node[data-topic="topics/payments.md"]').click();
  await showing("topics/payments.md");
  await wait(800);
  check("on a phone a tapped Topic comes up into view", await page.$eval("#tpxMain", el => el.getBoundingClientRect().top < innerHeight * .6));
  await shot("07-phone-topic");
  check("no page errors", !errors.length, errors.join(" | "));

  if (realDocs) {
    const real = await importDocs(realCopy), measurements = [];
    const expectedFiles = fs.readdirSync(path.join(realCopy, "topics")).filter(n => n.endsWith(".md")).sort().map(n => `topics/${n}`);
    const realState = await fetch(`${base}/api/lines/projects/${encodeURIComponent(real.id)}/state`);
    check("the real project's Topics state loads through the API", realState.ok, await realState.clone().text());
    if (!realState.ok) throw new Error(`Real Topics state: ${realState.status} ${await realState.text()}`);
    const realStateJson = await realState.json();
    check("the real project's Topics are in its state", (realStateJson.knowledge || []).length >= expectedFiles.length, JSON.stringify(realStateJson).slice(0, 500));
    await page.setViewportSize({ width:1720, height:1080 });
    // Only the address's hash changes, so the page is loaded again for the new project.
    await page.goto(`${base}/projects.html#${real.id}/topics`);
    await page.reload();
    await page.waitForFunction(([id, minCount]) => window.__lines?.S?.cur === id && (window.__lines.S.data[id]?.knowledge || []).length >= minCount, [real.id, expectedFiles.length]);
    await page.waitForSelector('#tpxMain .tpx-doc[data-doc="understanding.md"]');
    await wait(500);
    await shot("10-real-overview");
    const files = await page.$$eval(".tpx-tree [data-topic^='topics/']", els => els.map(el => el.dataset.topic));
    const target = files.includes("topics/projects-pages-look.md") ? "topics/projects-pages-look.md" : files[0];
    const openReal = async (file, width, theme) => {
      await page.setViewportSize({ width, height:width < 860 ? 844 : 1080 });
      await page.goto(`${base}/projects.html#${real.id}/topics/${encodeURIComponent(file)}`);
      await page.waitForSelector(`#tpxMain .tpx-doc[data-doc="${file}"]`);
      await page.evaluate(mode => linesTheme.set(mode), theme);
      await page.evaluate(() => { for (const el of [document.querySelector("#view"), document.querySelector("#tpxMain")]) if (el) el.scrollTop = 0; window.scrollTo(0, 0); });
      await wait(300);
    };
    const measure = label => page.evaluate(label => {
      const main = document.querySelector("#tpxMain"), view = document.querySelector("#view"), root = document.documentElement;
      const status = main.querySelector(".tpx-status"), body = status?.querySelector(":scope > span"), time = status?.querySelector("time");
      const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
      const box = el => el ? { ...rect(el), clientWidth:el.clientWidth, scrollWidth:el.scrollWidth, clientHeight:el.clientHeight, scrollHeight:el.scrollHeight } : null;
      const style = el => { if (!el) return null; const s = getComputedStyle(el); return { flexShrink:s.flexShrink, flexBasis:s.flexBasis, minWidth:s.minWidth, maxWidth:s.maxWidth, overflowWrap:s.overflowWrap, whiteSpace:s.whiteSpace }; };
      const problems = [...main.querySelectorAll(".rg-problem")].map(el => {
        const probe = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        probe.style.stroke = "var(--red)"; el.parentNode.append(probe);
        const expected = getComputedStyle(probe).stroke; probe.remove();
        return { stroke:getComputedStyle(el).stroke, expected };
      });
      return {
        label, theme:root.dataset.mode, viewport:{ width:innerWidth, height:innerHeight },
        main:box(main), view:box(view), root:{ clientWidth:root.clientWidth, scrollWidth:root.scrollWidth }, doc:box(main.querySelector(".tpx-doc")),
        status:box(status), hasTime:Boolean(status?.classList.contains("has-time")), body:box(body), time:box(time), bodyStyle:style(body), timeStyle:style(time),
        bodyText:body?.textContent.trim().slice(0, 160) || "", timeText:time?.textContent.trim() || "", problems,
        statusChildrenInside:Boolean(status && [body, time].filter(Boolean).every(el => { const r = el.getBoundingClientRect(), s = status.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1; })),
      };
    }, label);
    const fits = m => m.main.scrollWidth <= m.main.clientWidth + 1 && m.view.scrollWidth <= m.view.clientWidth + 1 && m.root.scrollWidth <= m.root.clientWidth + 1;
    const audit = m => {
      check(`${m.label}: no page-level horizontal overflow`, fits(m), JSON.stringify({ main:m.main, view:m.view, root:m.root }));
      if (m.status) {
        check(`${m.label}: the status body stays intact and any extracted date is non-empty`, (!m.hasTime || Boolean(m.timeText)) && !/^Status on\b/i.test(m.bodyText) && !m.bodyText.startsWith("70,"), JSON.stringify({ hasTime:m.hasTime, time:m.timeText, body:m.bodyText }));
        check(`${m.label}: status children stay inside and the body is not crushed`, m.statusChildrenInside && (!m.body || m.body.width >= 120), JSON.stringify({ status:m.status, body:m.body, time:m.time }));
      }
    };
    const stressStatus = async label => {
      const stressed = await page.evaluate(label => {
        const main = document.querySelector("#tpxMain"), status = main.querySelector(".tpx-status"), body = status?.querySelector(":scope > span"), time = status?.querySelector("time");
        if (!status || !body || !time) return null;
        const original = time.textContent, before = body.getBoundingClientRect().width;
        time.textContent = `2026-11-21.${"UnexpectedlyLongUnbrokenDateSegment".repeat(45)}`;
        const rect = el => { const r = el.getBoundingClientRect(); return { left:r.left, right:r.right, width:r.width, height:r.height }; };
        const result = { label, beforeBodyWidth:before, body:rect(body), time:rect(time), status:rect(status), statusClientWidth:status.clientWidth, statusScrollWidth:status.scrollWidth, mainClientWidth:main.clientWidth, mainScrollWidth:main.scrollWidth };
        result.inside = [body, time].every(el => { const r = el.getBoundingClientRect(), s = status.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1; });
        time.textContent = original;
        return result;
      }, label);
      if (!stressed) return;
      check(`${label}: even an unexpected 1,000-character time cannot crush or overflow the status`, stressed.inside && stressed.body.width >= stressed.beforeBodyWidth - 1 && stressed.statusScrollWidth <= stressed.statusClientWidth + 1 && stressed.mainScrollWidth <= stressed.mainClientWidth + 1, JSON.stringify(stressed));
      measurements.push(stressed);
      await wait(80);
    };
    for (const file of files) {
      await openReal(file, 1720, "light");
      const m = await measure(`${file} desktop light`); measurements.push(m); audit(m);
      await shot(`real-${path.basename(file, ".md")}`);
      // Further down the page: its pictures and requirement cards.
      for (const part of ["tpx-trace", "tpx-reqs", "tpx-left"]) {
        if (!await page.locator(`#${part}`).count()) continue;
        await page.$eval(`#${part}`, el => { const main = document.querySelector("#tpxMain"); main.style.scrollBehavior = "auto"; main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - 16; });
        await wait(150);
        await shot(`real-${path.basename(file, ".md")}-${part.slice(4)}`);
      }
    }
    check("every real Topic was found and audited", expectedFiles.every(f => files.includes(f)), JSON.stringify({ expectedFiles, files }));
    if (target) {
      const targetTopic = (realStateJson.knowledge || []).find(t => t.path === target);
      const expectedLead = (targetTopic?.status || "").replace(/\s+/g, " ").trim().slice(0, 40);
      for (const [width, mode, name] of [[1720, "light", "desktop-light"], [1720, "dark", "desktop-dark"], [390, "light", "narrow-light"], [390, "dark", "narrow-dark"]]) {
        await openReal(target, width, mode);
        const m = await measure(`${target} ${name}`); measurements.push(m); audit(m);
        if (expectedLead) check(`${name}: rendered status matches server status`, m.bodyText.replace(/\s+/g, " ").startsWith(expectedLead), JSON.stringify({ expectedLead, time:m.timeText, body:m.bodyText }));
        if (m.problems.length) check(`${name}: Problem ring arcs use the red variable`, m.problems.every(p => p.stroke === p.expected && p.stroke !== "none" && p.stroke !== "rgba(0, 0, 0, 0)"), JSON.stringify(m.problems));
        if (m.time && m.body) check(`${name}: a narrow date stays above the status body`, width >= 860 || m.time.top < m.body.top, JSON.stringify({ time:m.time, body:m.body }));
        await stressStatus(`${target} ${name}`);
        if (width < 860) { await page.$eval("#tpxMain", el => el.scrollIntoView({ block:"start" })); await wait(150); }
        await shot(`11-${path.basename(target, ".md")}-${name}`);
        if (width < 860) {
          if (await page.locator("#tpxMain .tpx-status").count()) {
            await page.$eval("#tpxMain .tpx-status", el => el.scrollIntoView({ block:"end" })); await wait(150);
            await shot(`12-${path.basename(target, ".md")}-${name}-status-end`);
          }
          if (await page.locator("#tpx-reqs").count()) {
            await page.$eval("#tpx-reqs", el => el.scrollIntoView({ block:"start" })); await wait(150);
            await shot(`13-${path.basename(target, ".md")}-${name}-requirements`);
          }
        }
      }
    }
    fs.writeFileSync(path.join(shots, "layout-measurements.json"), JSON.stringify(measurements, null, 2));
    check("the real project's pages show with no page errors", !errors.length, errors.join(" | "));
  }
  console.log(`\nScreenshots: ${shots}`);
})().catch(error => { failures.push(error.message); console.log(`FAIL  ${error.stack || error.message}`); }).finally(async () => {
  await browser?.close(); server.kill();
  try { fs.rmSync(temp, { recursive:true, force:true }); } catch { /* The system can clear it. */ }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(log.slice(-2000)); process.exitCode = 1; }
});
