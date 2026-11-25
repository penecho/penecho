#!/usr/bin/env node
"use strict";
// The project card on the home and archived projects, in a real browser against a real server.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-line-info.cjs [screenshot-folder]
// Folder clicks are answered in the browser, so no Finder window opens.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) fs.mkdirSync(shots, { recursive:true });
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-line-info-")));
const PORT = 4700 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 300)}` : ""}`); }
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
const topic = title => `---\nid: T-1\nstatus: notes\narea: Work\nlabels: Work\npriority: 2\ncreated: 2026-11-07 09:00\n---\n\n# ${title}\n\n<!-- status: PenEcho keeps this current -->\n> [!status] Notes and drawings, nothing sent to an agent\n<!-- /status -->\n\n## Note · 2026-11-07 09:00\n\nFirst words.\n`;

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_LINES_EXAMPLES:"0", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let log = ""; server.stdout.on("data", d => { log += d; }); server.stderr.on("data", d => { log += d; });

(async () => {
  let browser;
  try {
    await until(() => fetch(`${base}/api/lines/projects`).then(r => r.ok), "the server");
    const docs = path.join(temp, "Alpha docs"), code = path.join(temp, "alpha-code");
    fs.mkdirSync(code, { recursive:true });
    const { project:alpha } = await api("/projects", { method:"POST", body:{ name:"Alpha", docsPath:docs, codePath:code } });
    await api("/projects", { method:"POST", body:{ name:"Beta", docsPath:path.join(temp, "Beta docs") } });
    fs.writeFileSync(path.join(docs, "lines", "first-words.md"), topic("First words"));

    browser = await chromium.launch({ channel:"chrome" });
    const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    const opened = [];
    await page.route("**/open-folder", route => { opened.push(JSON.parse(route.request().postData() || "{}").which); route.fulfill({ status:200, contentType:"application/json", body:'{"ok":true}' }); });
    await page.goto(`${base}/projects.html#${alpha.id}`);
    const card = page.locator(".rl-proj");
    await until(() => card.isVisible(), "the project card");

    // The card: name, both folders, how far the project has come, and two buttons.
    check("card sits in the right column under Recent", await page.evaluate(() => { const side = document.querySelector("#deskSide"), kids = [...side.children].map(x => x.className); return kids.at(-1).includes("rl-proj") && kids[0].includes("rl-recent"); }));
    check("card names the project", (await card.locator(".pc-head strong").textContent()) === "Alpha");
    const paths = await card.locator(".pc-path span").allTextContents();
    check("card shows the docs and code folders", paths[0] === docs && paths[1] === code, paths.join(" | "));
    check("card says when it started and how many lines", (await card.locator(".pc-facts").textContent()) === "Started today · 1 line", await card.locator(".pc-facts").textContent());
    check("card has Rename and Archive", (await card.locator(".pc-acts .btn").allTextContents()).join("|") === "Rename|Archive");
    check("no Archived row in the sidebar", await page.locator("#railShelf, [data-act='open-archived']").count() === 0);
    if (shots) await page.screenshot({ path:path.join(shots, "1-card.png") });

    await card.locator(".pc-path").nth(0).click();
    await card.locator(".pc-path").nth(1).click();
    await until(() => opened.length === 2, "two folder opens");
    check("folder rows open the docs folder, then the code folder", opened.join(",") === "docs,code", opened.join(","));

    // Rename.
    await card.getByRole("button", { name:"Rename" }).click();
    const dialog = page.locator("dialog.line-command-dialog");
    await until(() => dialog.isVisible(), "the rename dialog");
    await dialog.locator("input").fill("Alpha renamed");
    await dialog.getByRole("button", { name:"Save name" }).click();
    await until(async () => (await page.locator(".rl-proj .pc-head strong").textContent()) === "Alpha renamed", "the new name on the card");
    check("rename reaches the sidebar", (await page.locator(".rail-row.on .rail-name").textContent()) === "Alpha renamed");
    check("rename reaches the window title", (await page.title()) === "Alpha renamed · PenEcho Lines");
    check("rename is saved", (await api("/projects")).projects.find(p => p.id === alpha.id).name === "Alpha renamed");

    // Right-click another project in the sidebar: Rename it without opening it.
    await page.locator(".rail-row", { hasText:"Beta" }).click({ button:"right" });
    await until(() => page.locator("#menu").isVisible(), "the sidebar menu");
    check("sidebar menu offers Rename and Pin", (await page.locator("#menu button").allTextContents()).join("|") === "Rename|Pin", (await page.locator("#menu button").allTextContents()).join("|"));
    await page.locator("#menu").getByRole("menuitem", { name:"Rename" }).click();
    await until(() => dialog.isVisible(), "the rename dialog for Beta");
    check("dialog holds the other project's name", (await dialog.locator("input").inputValue()) === "Beta");
    await dialog.locator("input").fill("Beta renamed");
    await dialog.getByRole("button", { name:"Save name" }).click();
    await until(async () => (await page.locator("#railList").textContent()).includes("Beta renamed"), "Beta's new name in the sidebar");
    check("other project renamed on the server", (await api("/projects")).projects.some(p => p.name === "Beta renamed"));
    check("project on screen keeps its name", (await page.locator(".rl-proj .pc-head strong").textContent()) === "Alpha renamed" && new URL(page.url()).hash === `#${alpha.id}`);

    // Settings has a Name row.
    await page.locator('.bar-settings').click();
    await until(() => page.locator('.settings-page').isVisible(), "Settings");
    const nameRow = page.locator('.set-row[aria-label="Name"]');
    check("Settings starts with the name", (await nameRow.locator("p").textContent()) === "Alpha renamed");
    await nameRow.getByRole("button", { name:"Rename" }).click();
    await until(() => dialog.isVisible(), "the rename dialog from Settings");
    await dialog.locator("input").fill("Alpha");
    await dialog.getByRole("button", { name:"Save name" }).click();
    await until(async () => (await nameRow.locator("p").textContent()) === "Alpha", "the new name in Settings");
    check("rename from Settings reaches the top bar", (await page.locator(".proj-switch span").textContent()) === "Alpha");
    if (shots) await page.screenshot({ path:path.join(shots, "1b-settings-name.png") });
    await api(`/projects/${alpha.id}`, { method:"PATCH", body:{ name:"Alpha renamed" } });
    await page.locator('[data-act="go-view"][data-view="home"]').click();
    await until(() => page.locator(".rl-proj").isVisible(), "the home again");
    await page.reload();
    await until(async () => (await page.locator(".rl-proj .pc-head strong").textContent()) === "Alpha renamed", "the card after reload");

    // Archive from the card: out of the list. Archived is a tab of Settings, not a row in the sidebar.
    await page.locator(".rl-proj").getByRole("button", { name:"Archive" }).click();
    await until(() => page.locator(".archived-note").isVisible(), "the archived project's home");
    check("no Archived row appears in the sidebar", await page.locator("#railShelf, .rail .rail-shelf:not(.rail-account)").count() === 0);
    check("archived project leaves the sidebar list", !(await page.locator("#railList").textContent()).includes("Alpha renamed"));
    check("the home says it is archived", await page.locator(".archived-note").isVisible());
    check("card offers Restore in place of Archive", (await page.locator(".rl-proj .pc-acts .btn").allTextContents()).join("|") === "Rename|Restore");
    check("toast offers Undo", (await page.locator("#toast").textContent()).includes("Undo"));
    if (shots) await page.screenshot({ path:path.join(shots, "2-archived-project.png") });

    // Settings › Archived.
    await page.locator("#railAccount .rail-gear").click();
    await page.locator("#sysTab-archived").click();
    await until(() => page.locator(".sysm .shelf-page").isVisible(), "Settings › Archived");
    check("Archived has its own address", new URL(page.url()).hash === "#archived");
    check("its tab counts one", (await page.locator("#sysTab-archived em").textContent()) === "1");
    check("Archived lists the project with the day", (await page.locator(".shelf-row strong").allTextContents()).join() === "Alpha renamed" && (await page.locator(".shelf-row time").textContent()) === "today");
    check("the page beneath the window stays as it was", await page.locator(".archived-note").count() === 1);
    if (shots) await page.screenshot({ path:path.join(shots, "3-archived-page.png") });

    // A row opens the project; Back returns to the page.
    await page.locator(".shelf-open").click();
    await until(() => page.locator(".archived-note").isVisible(), "the archived project's home");
    check("a row opens the archived project", new URL(page.url()).hash === `#${alpha.id}`);
    await page.goBack();
    await until(() => page.locator(".sysm .shelf-page").isVisible(), "Back to Settings › Archived");
    check("Back opens Settings › Archived again", true);

    // Restore from the page.
    await page.locator(".shelf-row").getByRole("button", { name:"Restore" }).click();
    await until(() => page.locator(".shelf-page .empty-line").isVisible(), "the empty Archived page");
    check("Restore empties the page", (await page.locator(".shelf-page .empty-line").textContent()) === "Nothing archived.");
    check("Restore takes the count off the tab", await page.locator("#sysTab-archived em").count() === 0);
    check("Restore puts the project back in the sidebar", (await page.locator("#railList").textContent()).includes("Alpha renamed"));
    check("restored on the server", (await api("/projects")).projects.find(p => p.id === alpha.id).archived === false);

    // Undo from the card's toast.
    await page.keyboard.press("Escape");
    await until(async () => !(await page.locator(".sysm").count()), "Settings closed");
    await page.locator(".rail-row", { hasText:"Alpha renamed" }).click();
    await until(() => page.locator(".rl-proj").isVisible(), "the card again");
    await page.locator(".rl-proj").getByRole("button", { name:"Archive" }).click();
    await until(() => page.locator("#toast button").isVisible(), "the Undo button");
    await page.locator("#toast button").click();
    await until(async () => (await api("/projects")).projects.find(p => p.id === alpha.id).archived === false, "Undo");
    await until(async () => !(await page.locator(".archived-note").count()), "the note to go");
    check("Undo restores the project", true);

    // An old #archived address opens Settings on Archived, with a narrow sidebar too; the gear stays in it.
    await api(`/projects/${alpha.id}`, { method:"PATCH", body:{ archived:true } });
    await page.setViewportSize({ width:1000, height:800 });
    await page.goto(`${base}/projects.html#archived`);
    await until(() => page.locator(".sysm .shelf-row").isVisible(), "#archived in a narrow window");
    check("#archived opens Settings on Archived, and the narrow sidebar keeps the gear", await page.locator("#sysTab-archived[aria-selected='true']").count() === 1 && await page.locator("#railAccount .rail-gear").isVisible());
    if (shots) await page.screenshot({ path:path.join(shots, "4-narrow.png") });

    // Delete from the page asks first, then takes the project out for good and leaves its folder.
    await page.setViewportSize({ width:1280, height:800 });
    await page.locator(".shelf-row .shelf-delete").click();
    await until(() => page.locator("dialog[open]").isVisible(), "the Delete question");
    check("Delete asks first, saying the folder stays", /Delete project\?/.test(await page.locator("dialog[open] h2").textContent()) && /folders stay where they are/.test(await page.locator("dialog[open]").textContent()));
    if (shots) await page.screenshot({ path:path.join(shots, "5-delete.png") });
    await page.locator("dialog[open]").getByRole("button", { name:"Cancel" }).click();
    check("Cancel keeps it", (await api("/projects")).projects.some(p => p.id === alpha.id));
    await page.locator(".shelf-row .shelf-delete").click();
    await page.locator("dialog[open]").getByRole("button", { name:"Delete project" }).click();
    await until(() => page.locator(".shelf-page .empty-line").isVisible(), "the empty page after Delete");
    check("Delete takes it off the server", !(await api("/projects")).projects.some(p => p.id === alpha.id));
    check("Delete takes the count off the tab", await page.locator("#sysTab-archived em").count() === 0);
    check("Delete leaves the project's folder", fs.existsSync(docs) && fs.existsSync(code));

    check("no page errors", errors.length === 0, errors.join(" | "));
  } catch (error) {
    failures.push(error.message); console.log(`FAIL  ${error.stack}`);
  } finally {
    await browser?.close();
    server.kill();
    fs.rmSync(temp, { recursive:true, force:true });
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(log.slice(-2000)); process.exit(1); }
})();
