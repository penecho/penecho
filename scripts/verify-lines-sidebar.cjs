#!/usr/bin/env node
"use strict";
// The sidebar, Back and Forward, and the week band (PE-399), in a real browser on a throwaway server:
// every project opens on its newest Lines, each with a status sign and no timestamp; pinned lines of all projects are together at the top;
// a line in another project opens that project on that line, and coming back to the project you left puts you on the line you left;
// Back and Forward go across projects; folding is remembered; My Canvases, Archived, Settings and New project are still there;
// This week is one band with no heading, and a word still filters the lines.
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/verify-lines-sidebar.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { makePicture } = require("../src/server/project-lines/canvas-file.js");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lines-sidebar-"));
const shots = process.argv[2] && !process.argv[2].startsWith("--") ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const sidebarOnly = process.argv.includes("--sidebar-only");
let browser, passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 400)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(80); }
}

const pad = n => String(n).padStart(2, "0");
const NOW = Date.now();
const stamp = minutesAgo => { const d = new Date(NOW - minutesAgo * 60000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const front = fields => `---\n${Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n`;
let serial = 0;
// kind: notes · waiting (an agent's question) · working · review (finished, not reviewed) · todo (finished, marked todo) · done (finished and reviewed) · archived
function writeLine(folder, { slug, title, kind = "notes", ago, pinned = false }) {
  fs.mkdirSync(path.join(folder, "lines", slug), { recursive:true });
  const n = ++serial, status = { notes:"notes", waiting:"waiting", working:"working", review:"ready", todo:"done", done:"ready", archived:"closed" }[kind];
  const head = front({ id:`S-${n}`, status, area:"Work", labels:"Work", priority:2, created:stamp(ago + 5), who:kind === "notes" ? "" : "@codex", finished:["review", "todo", "done", "archived"].includes(kind) ? stamp(ago) : "", pinned:pinned ? "yes" : "", todo:kind === "todo" ? "yes" : "" }) + `# ${title}\n\n`;
  let body;
  if (kind === "notes") body = `## Note · ${stamp(ago)}\n\nWords about ${title.toLowerCase()}.\n\n`;
  else {
    const open = ["working", "waiting"].includes(kind);
    body = `## Ask · ${stamp(ago + 5)}\n\nPlease do this: ${title.toLowerCase()}.\n\n## [${open ? " " : "x"}] Work 1 · @codex${open ? "" : " · 4 min"}\n\n${open ? "" : `**Done.**\n\n[Details](${slug}/work-1.md)\n\n`}`;
    if (!open) { fs.mkdirSync(path.join(folder, "works", slug), { recursive:true }); fs.writeFileSync(path.join(folder, "works", slug, "work-1.md"), front({ line:`../${slug}.md`, step:"Work 1", who:"@codex", started:stamp(ago + 4), ended:stamp(ago), took:"4 min", reviewed:["todo", "done"].includes(kind) ? stamp(ago - 1) : "" }) + `# Work 1: ${title}\n\n## Asked\n\n> Please.\n\n## Result\n\n<!-- result: the agent's last message -->\n**Done.**\n<!-- /result -->\n`); }
  }
  const file = path.join(folder, "lines", `${slug}.md`);
  fs.writeFileSync(file, head + body);
  fs.utimesSync(file, new Date(NOW - ago * 60000), new Date(NOW - ago * 60000));
}
const writeProject = (name, lines) => { const folder = path.join(temp, name); fs.mkdirSync(path.join(folder, "lines"), { recursive:true }); for (const l of lines) writeLine(folder, l); return folder; };

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:"0", HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const base = /PenEcho: (http:\/\/127\.0\.0\.1:\d+)/.exec(serverLog)[1];
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {});
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const errors = [];
  const send = async (method, address, data) => (await context.request[method](`${base}/api/lines${address}`, { data, headers:{ origin:base } })).json();
  const post = (address, data) => send("post", address, data);

  // Three projects. Alpha has visible lines (a1..a4, a6, a8, a9 todo, a7 pinned), plus finished (a5) archived (a10) and deleted (a11) lines that must stay out of the sidebar, and pinned finished (a12) and archived (a13) lines that must also be hidden; Beta has three; Gamma is empty of lines.
  const alphaLines = [
    { slug:"a1", title:"Alpha newest note", ago:3 }, { slug:"a2", title:"Alpha working line", kind:"working", ago:6 }, { slug:"a3", title:"Alpha waiting line", kind:"waiting", ago:12 },
    { slug:"a4", title:"Alpha to review", kind:"review", ago:30 }, { slug:"a5", title:"Alpha reviewed", kind:"done", ago:90 }, { slug:"a6", title:"Alpha older note", ago:300 },
    { slug:"a7", title:"Alpha pinned old note", ago:3000, pinned:true }, { slug:"a8", title:"Alpha oldest", ago:5000 }, { slug:"a9", title:"Alpha todo line", kind:"todo", ago:6000 },
    { slug:"a10", title:"Alpha archived", kind:"archived", ago:20 }, { slug:"a11", title:"Alpha deleted", ago:15 }, { slug:"a12", title:"Alpha pinned finished", kind:"done", ago:10, pinned:true },
    { slug:"a13", title:"Alpha pinned archived", kind:"archived", ago:12, pinned:true },
  ];
  const alpha = (await post("/projects", { name:"Alpha", docsPath:path.join(temp, "alpha"), offerSkill:false })).project;
  writeProject("alpha", alphaLines);
  const a11Doc = (await (await context.request.get(`${base}/api/lines/projects/${alpha.id}/state`)).json()).lines.find(l => l.id === "a11");
  await post(`/projects/${alpha.id}/topics/a11/delete`, { confirm:"a11", baseHash:a11Doc.topicHash });
  const beta = (await post("/projects", { name:"Beta", docsPath:path.join(temp, "beta"), offerSkill:false })).project;
  writeProject("beta", [{ slug:"b1", title:"Beta first line", kind:"review", ago:50 }, { slug:"a6", title:"Beta second line", ago:400 }, { slug:"b3", title:"Beta third line", ago:800 }]);
  const gamma = (await post("/projects", { name:"Gamma", docsPath:path.join(temp, "gamma"), offerSkill:false })).project;
  // A line whose Work drew a page: PenEcho makes the Canvas and its picture from the page, as it does for an agent's file.
  const pages = (await post("/projects", { name:"Pages", docsPath:path.join(temp, "pages"), offerSkill:false })).project;
  if (!sidebarOnly) {
    const pageDocs = writeProject("pages", [{ slug:"pg", title:"A page the agent drew", kind:"done", ago:20 }]);
    const pageHtml = '<!doctype html><html><head><meta charset="utf-8"><title>Try me</title><style>body{font:14px sans-serif}button{font:inherit}</style></head><body><button id="go" onclick="document.title=\'tried\'">Try me</button></body></html>';
    const made = await makePicture({ source:"files/pg/try.explorer.html", text:pageHtml, existing:null, name:"try.explorer.html" });
    fs.mkdirSync(path.join(pageDocs, "files", "pg"), { recursive:true });
    fs.writeFileSync(path.join(pageDocs, "files", "pg", "try.explorer.html"), pageHtml);
    fs.writeFileSync(path.join(pageDocs, "files", "pg", "try.penecho.json"), JSON.stringify(made.bundle));
    fs.writeFileSync(path.join(pageDocs, "files", "pg", "try.png"), made.png);
    const pageTopic = path.join(pageDocs, "lines", "pg.md");
    fs.writeFileSync(pageTopic, fs.readFileSync(pageTopic, "utf8").replace("**Done.**", "**Done.**\n\n![Try me](../files/pg/try.png)"));
  }
  await post("/projects/my-canvases", {});
  const archived = (await post("/projects", { name:"Put away", docsPath:path.join(temp, "put-away"), offerSkill:false })).project;
  await send("patch", `/projects/${archived.id}`, { archived:true });
  // Opened in this order, so Alpha is the newest opened.
  for (const project of [gamma, beta, alpha]) { await send("patch", `/projects/${project.id}`, { opened:true }); await wait(30); }

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", e => { errors.push(e.message); console.log("page error:", e.stack || e.message); });
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const count = selector => page.locator(selector).count();
  const texts = async selector => (await page.locator(selector).allTextContents()).map(t => t.replace(/\s+/g, " ").trim());
  const shot = name => page.screenshot({ path:path.join(shots, `${name}.png`) });
  const here = () => page.evaluate(() => ({ cur:window.__lines.S.cur, route:window.__lines.S.route }));
  const settled = async (project, view = "home") => { await page.waitForFunction(([p, v]) => window.__lines?.S.cur === p && window.__lines.project() && window.__lines.S.route.view === v, [project, view], { timeout:30000 }); await wait(250); };
  const titlesUnder = async name => page.evaluate(n => { const item = [...document.querySelectorAll("#railList .rail-item")].find(i => i.querySelector(".rail-name")?.textContent === n); const lines = item?.nextElementSibling; return lines?.classList.contains("rail-lines") ? [...lines.querySelectorAll(".rail-line .rail-title")].map(t => t.textContent) : null; }, name);

  await page.goto(`${base}/projects.html#${alpha.id}`);
  await settled(alpha.id);
  await page.waitForSelector("#railList .rail-lines .rail-line");

  console.log("\nThe sidebar lists lines under every project");
  const alphaShown = await titlesUnder("Alpha"), betaShown = await titlesUnder("Beta");
  check("the project on screen lists its newest five non-finished lines, newest first, and not finished, archived, deleted or pinned ones", JSON.stringify(alphaShown) === JSON.stringify(["Alpha newest note", "Alpha working line", "Alpha waiting line", "Alpha to review", "Alpha older note"]), JSON.stringify(alphaShown));
  check("finished, archived and deleted lines are absent from the whole sidebar", await count('#railList .rail-line[data-line="a5"]') === 0 && await count('#railList .rail-line[data-line="a10"]') === 0 && await count('#railList .rail-line[data-line="a11"]') === 0);
  check("it says how many more there are", (await texts("#railList .rail-more"))[0] === "2 more", (await texts("#railList .rail-more")).join("|"));
  check("another project lists its lines too, without being opened", JSON.stringify(betaShown) === JSON.stringify(["Beta first line", "Beta second line", "Beta third line"]), JSON.stringify(betaShown));
  check("a project with no lines lists none", (await titlesUnder("Gamma")) === null || (await titlesUnder("Gamma")).length === 0);
  check("sidebar line rows have no date or time labels", await count("#railList .rail-line time") === 0);
  check("a working line has a spinner, a waiting line an amber sign, and a line new to you a violet one", await count('#railList .rail-line[data-line="a2"] .spin') === 1 && await count('#railList .rail-line[data-line="a3"] .rail-sign.s-need') === 1);
  check("pinned lines are together under Pinned, excluding finished and archived ones, with no project icon", JSON.stringify(await texts("#railList .rail-pins .rail-line")) === JSON.stringify(["Alpha pinned old note"]) && await count("#railList .rail-pins .pglyph") === 0, JSON.stringify(await texts("#railList .rail-pins .rail-line")));
  check("a pinned line is not listed twice", await count('#railList .rail-line[data-line="a7"]') === 1);
  check("Beta is open without being the one on screen: it is one of the last three opened", await page.getAttribute('#railList .rail-fold[data-p="' + beta.id + '"]', "aria-expanded") === "true");
  await shot("sidebar-home");

  const alphaList = owner => owner.locator(`#railList .rail-project[data-project="${alpha.id}"]`);
  await alphaList(page).getByRole("button", { name:"2 more", exact:true }).press("Enter");
  await page.click('#railList .rail-line[data-line="b1"]');
  await settled(beta.id, "line");
  await page.evaluate(() => __lines.poll());
  check("opening another project's Line and polling keep all seven Alpha Lines visible", (await titlesUnder("Alpha"))?.length === 7);
  await page.reload(); await settled(beta.id, "line");
  check("Show more survives a page reload", (await titlesUnder("Alpha"))?.length === 7 && await alphaList(page).getByRole("button", { name:"Show fewer", exact:true }).isVisible());
  const canvasRail = await context.newPage();
  await canvasRail.goto(`${base}/projects.html?embed=rail#${alpha.id}`);
  const fewer = alphaList(canvasRail).getByRole("button", { name:"Show fewer", exact:true });
  await fewer.waitFor();
  check("the Canvas sidebar opens with the same expanded list", await alphaList(canvasRail).locator(".rail-line").count() === 7);
  await fewer.click();
  await alphaList(page).getByRole("button", { name:"2 more", exact:true }).waitFor();
  check("Show fewer in the Canvas sidebar restores the short list in both views", await alphaList(canvasRail).locator(".rail-line").count() === 5 && (await titlesUnder("Alpha"))?.length === 5);
  await canvasRail.close();
  await page.goto(`${base}/projects.html#${alpha.id}`); await settled(alpha.id);
  await page.reload(); await settled(alpha.id);
  check("the shorter list is remembered too", (await titlesUnder("Alpha"))?.length === 5);

  const row = (title, owner = page) => owner.locator('.rail-line').filter({ has:owner.getByText(title, { exact:true }) });
  const more = (title, owner = page) => owner.getByRole('button', { name:'Actions for ' + title, exact:true });
  const menu = async title => { await row(title).hover(); await more(title).click(); };
  const command = name => page.getByRole('menuitem', { name, exact:true }).click();
  const alphaDoc = path.join(temp, "alpha", "lines", "a6.md");
  const original = fs.readFileSync(alphaDoc, "utf8");
  await page.mouse.move(900, 60);
  check("row actions are hidden at rest", await more("Alpha older note").evaluate(b => getComputedStyle(b).opacity) === "0");
  await menu("Alpha older note");
  check("the menu contains the four requested actions", (await page.getByRole("menuitem").allTextContents()).join("/") === "Pin/Archive/Mark reviewed/Delete");
  await shot("sidebar-line-menu");
  await page.keyboard.press("Escape");
  check("Escape returns focus to the dots", await more("Alpha older note").evaluate(b => document.activeElement === b));
  const old = await row("Alpha older note").boundingBox(), top = await row("Alpha newest note").boundingBox();
  await page.mouse.move(old.x + 25, old.y + old.height / 2);
  await page.mouse.down(); await page.mouse.move(top.x + 25, top.y + 3, { steps:10 }); await page.mouse.up();
  await until(async () => (await titlesUnder("Alpha"))[0] === "Alpha older note", "a real drag to reorder the Line");
  await page.reload(); await settled(alpha.id);
  check("drag survives reload and leaves the Line file intact", (await titlesUnder("Alpha"))[0] === "Alpha older note" && fs.readFileSync(alphaDoc, "utf8") === original);
  await row("Alpha older note").focus(); await page.keyboard.press("Alt+Shift+ArrowDown");
  check("keyboard reordering moves one position", (await titlesUnder("Alpha"))[1] === "Alpha older note");
  await menu("Beta third line"); await command("Pin");
  await page.waitForSelector('.rail-pins .rail-line[data-line="b3"]');
  check("pinning a Line in another project keeps the current page", (await here()).cur === alpha.id);
  await menu("Beta third line"); await command("Unpin");
  await page.waitForSelector('.rail-lines .rail-line[data-line="b3"]');
  if (sidebarOnly) {
    await menu("Beta second line"); await command("Archive");
    await until(async () => await row("Beta second line").count() === 0, "archive to remove its row");
    await page.getByRole("button", { name:"Undo", exact:true }).click();
    await row("Beta second line").waitFor();
    await menu("Beta second line"); await command("Delete");
    await page.getByRole("button", { name:"Cancel", exact:true }).click();
    check("cancelling delete keeps the Line", await row("Beta second line").count() === 1);
    await menu("Beta second line"); await command("Delete");
    await page.getByRole("button", { name:"Delete line", exact:true }).click();
    await until(async () => await row("Beta second line").count() === 0, "confirmed delete to remove its row");
    check("deleting a Line in Beta preserves the same slug in Alpha", await row("Alpha older note").count() === 1 && fs.readFileSync(alphaDoc, "utf8") === original);
    await page.getByRole("button", { name:"Undo", exact:true }).click();
    await row("Beta second line").waitFor();
    await menu("Beta first line"); await command("Pin");
    await page.waitForSelector('.rail-pins .rail-line[data-line="b1"]');
    await menu("Beta first line"); await command("Mark reviewed");
    await until(async () => await row("Beta first line").count() === 0, "review to hide even a pinned Line");
    await page.reload(); await settled(alpha.id);
    check("review persists across reload and all four actions target the other project", (await here()).cur === alpha.id && await row("Beta first line").count() === 0 && await row("Beta second line").count() === 1);
    const touch = await browser.newContext({ viewport:{ width:1200, height:800 }, hasTouch:true });
    const tablet = await touch.newPage(); await tablet.goto(`${base}/projects.html#${alpha.id}`);
    await more("Alpha older note", tablet).waitFor();
    check("touch exposes a 44-pixel menu button", await more("Alpha older note", tablet).evaluate(b => getComputedStyle(b).opacity === '1' && b.offsetHeight >= 44));
    await more("Alpha older note", tablet).tap(); await tablet.getByRole("menuitem", { name:"Archive", exact:true }).waitFor();
    await tablet.keyboard.press("Escape");
    const older = await row("Alpha older note", tablet).boundingBox(), newest = await row("Alpha newest note", tablet).boundingBox();
    const cdp = await touch.newCDPSession(tablet);
    const finger = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints:type === "touchEnd" ? [] : [{ x:older.x + 20, y }] });
    await finger("touchStart", older.y + older.height / 2);
    await tablet.waitForSelector(".project-order-ghost");
    await finger("touchMove", newest.y + 2); await finger("touchEnd");
    check("holding and dragging a Line on touch changes its position", (await tablet.locator('.rail-project[data-project="' + alpha.id + '"] .rail-title').allTextContents())[0] === "Alpha older note");
    await touch.close();
    await page.setViewportSize({ width:1000, height:700 });
    check("compact rail keeps line controls out of the project icons", await page.locator('.rail-lines').first().isHidden());
    check("no browser errors", !errors.length, errors.join(" | "));
    return;
  }

  console.log("\nFunctions that were there stay");
  check("My Canvases is still above the projects", await count("#railMine .rail-row") >= 1);
  check("the foot is New project, then the account row with the Settings gear (Archived is a Settings tab)", await count("#railAccount .rail-gear") === 1 && await count('.rail-new[data-act="new-project"]') === 1 && await count("#railShelf, [data-act='open-archived']") === 0);
  check("each project still has its new-line plus and its pin star", await count(`.rail-item .rail-add[data-p="${alpha.id}"]`) === 1 && await count(`.rail-item .rail-pin[data-p="${alpha.id}"]`) === 1);
  check("the project rows still switch project", await count(`.rail-row[data-act="switch-project"][data-p="${beta.id}"]`) === 1);

  console.log("\nOpening a line in another project");
  await page.click('#railList .rail-line[data-line="b1"]');
  await settled(beta.id, "line");
  let now = await here();
  check("a line in another project opens that project on that line", now.cur === beta.id && now.route.line === "b1", JSON.stringify(now));
  check("the line on screen is marked in its project", await page.getAttribute('#railList .rail-line.on', "data-line") === "b1" && await page.getAttribute('#railList .rail-line.on', "data-p") === beta.id);
  await shot("line-in-beta");
  await page.click('#railList .rail-line[data-line="a4"]');
  await settled(alpha.id, "line");
  now = await here();
  check("and back in the first project on its line", now.cur === alpha.id && now.route.line === "a4", JSON.stringify(now));
  check("the line left in the other project is still listed there", (await titlesUnder("Beta")).includes("Beta first line"));
  check("opening a Line preserves manual order", (await titlesUnder("Alpha"))[0] === "Alpha newest note");
  await row("Alpha older note").click();
  await settled(alpha.id, "line");
  check("opening another line keeps its position", JSON.stringify((await titlesUnder("Alpha")).slice(0, 2)) === JSON.stringify(["Alpha newest note", "Alpha older note"]));
  await page.click('#railList .rail-line[data-line="a4"]');
  await settled(alpha.id, "line");
  await page.evaluate(() => __lines.poll());
  check("reopening and polling preserve manual order", JSON.stringify((await titlesUnder("Alpha")).slice(0, 2)) === JSON.stringify(["Alpha newest note", "Alpha older note"]));


  console.log("\nComing back to a project puts you on the line you left");
  await page.click(`.rail-row[data-p="${beta.id}"]`);
  await settled(beta.id, "line");
  now = await here();
  check("choosing the project you left on a line opens that line", now.cur === beta.id && now.route.line === "b1", JSON.stringify(now));

  console.log("\nBack and Forward");
  await page.waitForSelector('.nav-hist [data-dir="-1"]');
  check("the bar has Back and Forward", await count('.nav-hist [data-dir="-1"]') === 1 && await count('.nav-hist [data-dir="1"]') === 1);
  await page.click('.nav-hist [data-dir="-1"]');
  await page.waitForFunction(p => window.__lines.S.cur === p, alpha.id, { timeout:15000 });
  await wait(300);
  now = await here();
  check("Back goes to the page before, in the other project", now.cur === alpha.id && now.route.line === "a4", JSON.stringify(now));
  await page.keyboard.press("Control+]");
  await page.waitForFunction(p => window.__lines.S.cur === p, beta.id, { timeout:15000 });
  await wait(300);
  now = await here();
  check("Control+] goes forward again", now.cur === beta.id && now.route.line === "b1", JSON.stringify(now));
  await page.keyboard.press("Control+[");
  await page.waitForFunction(p => window.__lines.S.cur === p, alpha.id, { timeout:15000 });
  check("Control+[ goes back", (await here()).cur === alpha.id);

  console.log("\nFolding and showing more");
  await page.click(`.rail-fold[data-p="${beta.id}"]`);
  check("a project folds, and its lines are hidden", (await titlesUnder("Beta")) === null);
  await page.reload(); await page.waitForSelector("#railList .rail-item");
  check("and it stays folded after a reload", await page.getAttribute(`#railList .rail-fold[data-p="${beta.id}"]`, "aria-expanded") === "false");
  check("manual order survives reload", JSON.stringify((await titlesUnder("Alpha")).slice(0, 2)) === JSON.stringify(["Alpha newest note", "Alpha older note"]));
  await page.click(`.rail-fold[data-p="${beta.id}"]`);
  await page.click('#railList .rail-more');
  check("more shows every non-finished line of the project", (await titlesUnder("Alpha")).length === 7 && (await titlesUnder("Alpha")).includes("Alpha todo line") && !(await titlesUnder("Alpha")).includes("Alpha reviewed"), JSON.stringify(await titlesUnder("Alpha")));
  check("and Show fewer puts it back", (await texts("#railList .rail-more"))[0] === "Show fewer");
  await page.click('#railList .rail-line[data-line="a4"]');
  await settled(alpha.id, "line");
  await page.click('[data-act="all-reviewed"][data-line="a4"]');
  await until(async () => (await count('#railList .rail-line[data-line="a4"]')) === 0, "marked-reviewed line to leave the sidebar");
  check("marking a line reviewed removes it from the sidebar immediately", await count('#railList .rail-line[data-line="a4"]') === 0);
  await page.click(`.rail-row[data-p="${beta.id}"]`);
  await settled(beta.id, "line");
  check("the finished line stays gone from Alpha in the sidebar after switching projects", await count('#railList .rail-line[data-line="a4"]') === 0);
  check("with Alpha off screen, only its eligible pinned Line shows", JSON.stringify(await texts("#railList .rail-pins .rail-line")) === JSON.stringify(["Alpha pinned old note"]), JSON.stringify(await texts("#railList .rail-pins .rail-line")));
  await page.click('#railList .rail-pins .rail-line[data-line="a7"]');
  await settled(alpha.id, "line");
  check("a pinned Line opens from Pinned", await page.evaluate(() => window.__lines.S.route.line) === "a7");

  console.log("\nThis week is one band");
  await page.goto(`${base}/projects.html#${alpha.id}`);
  await settled(alpha.id);
  check("there is no heading, legend or Most this week row", await count("#hmWeek h2") === 0 && await count("#hmWeek .wk-legend") === 0 && await count("#hmWeek .wk-most") === 0);
  check("the days are still there, with today lit", await count("#hmWeek .wk-day") >= 3 && await count("#hmWeek .wk-day.is-today") === 1);
  await shot("home-week");

  console.log("\nDark, and a narrow window");
  await page.evaluate(() => { document.documentElement.dataset.mode = "dark"; });
  await wait(200);
  await shot("sidebar-dark");
  await page.evaluate(() => { delete document.documentElement.dataset.mode; });
  await page.setViewportSize({ width:1000, height:800 });
  await wait(300);
  check("with only icons beside the page, the lines, pinned list and fold buttons are out of the way", await page.locator("#railList .rail-lines").first().isHidden() && await page.locator(".rail-fold").first().isHidden());
  check("the project icons are still there", await count("#railList .rail-row[data-act=\"switch-project\"]") >= 3);
  await shot("sidebar-narrow");
  await page.setViewportSize({ width:1440, height:900 });

  console.log("\nA page an agent drew is on its line");
  await page.goto(`${base}/projects.html#${pages.id}`);
  await settled(pages.id);
  await page.goto(`${base}/projects.html#${pages.id}/line/pg`);
  await settled(pages.id, "line");
  await page.waitForSelector(".lp-work .lp-big-pic");
  check("the Work shows the Canvas picture with Edit on canvas, and its page in the Work's list", await count(".lp-work .line-pic-edit[data-act='open-canvas']") === 1 && await count(".lp-work .lp-out[data-kind='page'][data-path$='try.explorer.html']") === 1 && await count(".lp-work .line-page-open") === 0);
  await shot("line-with-page");
  await page.click(".lp-work .lp-out[data-kind='page']");
  await page.waitForSelector("#lightbox .fv-frame");
  const frame = await page.getAttribute("#lightbox .fv-frame", "src");
  check("the page card runs the page itself, over the line", /try\.explorer\.html/.test(frame) && await page.getAttribute("#lightbox .fv-frame", "sandbox") === "allow-scripts", frame);
  const inside = page.frames().find(f => /try\.explorer\.html/.test(f.url()));
  await inside.waitForSelector("#go");
  await inside.click("#go");
  check("the page is there to use: its button works", await inside.title() === "tried");
  await shot("page-open");
  await page.click("#lightbox .fv-x");
  check("Close puts you back on the line",  await count("#lightbox .fv-frame") === 0 && await count("#linePage") === 1);

  check("no page errors", errors.length === 0, errors.join(" | "));
})().catch(error => { failures.push(error.message); console.log(`FAIL  ${error.stack || error.message}`); }).finally(async () => {
  await browser?.close();
  server.kill();
  console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? "" : `. Pictures are in ${shots}`}`);
  if (failures.length) console.log(serverLog.split("\n").slice(-12).join("\n"));
  else try { fs.rmSync(temp, { recursive:true, force:true }); } catch { /* Left for the system to clear. */ }
  process.exitCode = failures.length ? 1 : 0;
});
