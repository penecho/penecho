#!/usr/bin/env node
"use strict";
// The project's Home, the left panel and the box (docs/design/one-penecho/NEXT-FEATURES.md, H1 and H1b). This checks them in a real browser,
// on a project of 50 lines in every state, each last touched at a different time, and on a small project whose week is known mark by mark:
// This week's marks open the page; compact pending Asks (no large cards, Send, count links and visibility remembered);
// All lines (newest on top, each day a clock whose head sticks while you scroll its lanes, each line a lane with its marks where they happened,
// one lane open at a time, finished out until their count is pressed, the filter box, By topic and My order with evenly spaced marks);
// Latest files alone beside the map: thumbnails, originating lines and direct access to every file; the sidebar lists the five newest Lines of every project, with pinned lines together at the top;
// the box has one button with a dropdown and one + for the four things at its left, on the Home, on a line and beside a Canvas;
// Archive is only in the menu and Undo brings the line back; Move to offers only the projects in the sidebar; a project with no lines shows the empty project page.
//   NODE_PATH=/path/to/node_modules node scripts/verify-lines-home.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lines-home-"));
const shots = process.argv[2] && !process.argv[2].startsWith("--") ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 5700 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "docs"), manyDocs = path.join(temp, "many"), weekDocs = path.join(temp, "week");
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

// ---------- The projects: Topic files written as PenEcho writes them ----------
const pad = n => String(n).padStart(2, "0");
// Minutes before noon two days ago, as the folder writes a time. Everything is placed from there, so the week on the page is always this week.
const NOW = new Date(), NOON = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 2, 12, 0).getTime();
// Today, in the same minutes: three hours ago, or just after midnight when the day is younger than that.
const TODAY0 = Math.round((NOON - Math.max(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 0, 5).getTime(), NOW.getTime() - 3 * 3600000)) / 60000);
const stamp = minutesAgo => { const d = new Date(NOON - minutesAgo * 60000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const at = minutesAgo => NOON - minutesAgo * 60000;
const front = fields => `---\n${Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n`;
// Every line is made a different number of minutes ago, and last touched a different number of minutes ago. `last` is what the page should sort by.
function seedLines() {
  const lines = [], day = 1440;
  const add = (slug, title, kind, made, last, extra = {}) => lines.push({ slug, title, kind, made, last, ...extra });
  // Your own notes: the last note is the last activity, however old the line.
  for (let i = 1; i <= 12; i++) add(`note-${pad(i)}`, `Notes ${i}: ${["Garden plan", "Books to read", "Trip to Lisbon", "Kitchen budget"][i % 4]}`, "notes", (30 - i) * day, (30 - i) * day - 600 - i * 37);
  add("old-line-new-note", "Old line with a new note", "notes", 40 * day, 95);
  add("young-line", "Young line", "notes", 3 * day, 3 * day);
  // A note written today and one yesterday, so the trunk has a tick for each.
  add("today-note", "A note from today", "notes", -2170, -2170);
  add("yesterday-note", "A note from yesterday", "notes", -day, -day);
  // Finished and reviewed: these rest out of sight.
  for (let i = 1; i <= 10; i++) add(`done-${pad(i)}`, `Done ${i}: ${["Fix the login error", "Add a rain chart", "Tidy the settings page"][i % 3]}`, "done", (20 - i) * day, (20 - i) * day - 200 - i * 11, { agent:i % 2 ? "codex" : "claude" });
  // Finished, not yet reviewed.
  for (let i = 1; i <= 6; i++) add(`review-${pad(i)}`, `Review ${i}: ${["Release notes", "Search box", "Dark mode"][i % 3]}`, "review", (9 - i) * day, (9 - i) * day - 300 - i * 13, { agent:"codex" });
  // Finished, not yet reviewed, and its Work drew a Canvas.
  add("review-canvas", "Draw the garden beds", "review", 300, 60, { agent:"claude", canvas:true });
  // An agent's Work that stopped half way: waiting for you, stopped, paused. The Work's own file says when it started, and that is the line's last activity.
  for (let i = 1; i <= 4; i++) add(`waiting-${pad(i)}`, `Waiting ${i}: Choose a colour`, "waiting", 6 * day + i * 50, 4 * day + i * 61, { agent:"claude" });
  for (let i = 1; i <= 3; i++) add(`stopped-${pad(i)}`, `Stopped ${i}: Import the old notes`, "stopped", 5 * day + i * 40, 2 * day + i * 73, { agent:"codex" });
  for (let i = 1; i <= 2; i++) add(`paused-${pad(i)}`, `Paused ${i}: Rewrite the readme`, "paused", 7 * day + i * 30, 5 * day + i * 47, { agent:"codex" });
  // An agent at work.
  add("working-01", "Translate the manual", "working", 120, 20, { agent:"claude" });
  // Today, steps minutes apart: three Asks, each starting a two-minute Work. Finished, not yet reviewed.
  add("crowded-today", "Crowded today", "crowded", TODAY0, TODAY0 - 8, { agent:"claude" });
  // A question with answers to choose from, kept in the line's file, and one the agent asks in its own words.
  add("question-choice", "Header colour", "choice", 200, 150, { agent:"claude" });
  add("question-open", "Plan the newsletter", "grill", 260, 180, { agent:"codex" });
  // An Ask you wrote and have not sent.
  for (let i = 1; i <= 2; i++) add(`unsent-${pad(i)}`, `Unsent ${i}: Ask about the invoice`, "unsent", 2 * day + i * 20, 400 + i * 90);
  // One long line, to show how its nodes fold.
  add("long-line", "Long line: the quarterly report", "long", 12 * day, 30, { agent:"claude" });
  // One to find by its last words alone.
  add("needle", "Plain title", "notes", 8 * day, 8 * day - 15, { words:"The word marzipan is only in this note." });
  return lines;
}
// A small project whose week is known mark by mark. Days are counted back from today; 0 is today.
const dayAt = (daysAgo, hour, minute = 0) => { const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, hour, minute); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function writeWeek(folder) {
  fs.mkdirSync(path.join(folder, "lines"), { recursive:true });
  const head = (n, status, created, extra = {}) => front({ id:`W-${n}`, status, area:"Work", labels:"Work", priority:2, created, ...extra });
  const files = {
    // Yesterday: an Ask, the Work that answers it (which stands at its Ask), and the line finished.
    "asked-yesterday": head(1, "ready", dayAt(1, 10), { who:"@codex", finished:dayAt(1, 10, 20) }) + `# Asked yesterday\n\n## Ask · ${dayAt(1, 10)}\n\nCount the chairs.\n\n## [x] Work 1 · @codex · 4 min\n\n**Twelve chairs.**\n\n`,
    // Three days ago: a drawing, an Ask and its Work. Finished two days ago.
    "drawn-earlier": head(2, "ready", dayAt(3, 9), { who:"@claude", finished:dayAt(2, 8) }) + `# Drawn earlier\n\n## Canvas · ${dayAt(3, 9)}\n\n![Drawing](../files/drawn-earlier/garden.png)\n\n## Ask · ${dayAt(3, 9, 5)}\n\nMake it like my drawing.\n\n## [x] Work 1 · @claude · 7 min\n\n**Done as drawn.**\n\n`,
    // Five days ago: a meeting. Today: an Ask not sent yet.
    "met-monday": head(3, "notes", dayAt(5, 14)) + `# Supplier call\n\n## Note · ${dayAt(5, 14)} · Meeting\n\n**Supplier call** · 30 min\n\nPrices agreed for next year.\n\n## Ask · ${dayAt(0, 0, 5)} · Not sent\n\nWrite to the supplier.\n\n`,
    // Nine days ago: before the week, so no mark.
    "long-ago": head(4, "notes", dayAt(9, 9)) + `# Long ago\n\n## Note · ${dayAt(9, 9)}\n\nAn old thought.\n\n## Ask · ${dayAt(9, 9, 30)} · Not sent\n\nAn old question.\n\n`,
  };
  for (const [slug, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, "lines", `${slug}.md`), text);
  const pictures = path.join(root, "src/server/project-lines/examples/notebook/docs/files/garden-plan");
  fs.mkdirSync(path.join(folder, "files", "drawn-earlier"), { recursive:true });
  for (const name of ["garden.png", "garden.penecho.json"]) fs.copyFileSync(path.join(pictures, name), path.join(folder, "files", "drawn-earlier", name));
}
function topicText(l, n) {
  const status = { notes:"notes", done:"ready", review:"ready", waiting:"waiting", stopped:"stopped", paused:"paused", unsent:"notes", long:"ready", crowded:"ready", choice:"waiting", grill:"waiting", working:"working" }[l.kind];
  const head = front({ id:`T-${n}`, status, area:"Work", labels:"Work", priority:2, created:stamp(l.made), who:l.agent ? `@${l.agent}` : "", finished:["done", "review", "long", "crowded"].includes(l.kind) ? stamp(l.last) : "" }) + `# ${l.title}\n\n`;
  const note = (when, words) => `## Note · ${stamp(when)}\n\n${words}\n\n`, ask = (when, words, more = "") => `## Ask · ${stamp(when)}${more}\n\n${words}\n\n`;
  const work = (num, done, words, took = "6 min") => `## [${done ? "x" : " "}] Work ${num} · @${l.agent}${done ? ` · ${took}` : ""}\n\n${words}\n\n${done ? `[Details](${l.slug}/work-${num}.md)\n\n` : ""}`;
  if (l.kind === "notes") return head + note(l.made, `First thoughts on ${l.title.toLowerCase()}.`) + (l.last < l.made ? note(l.last, l.words || `A later note on ${l.title.toLowerCase()}, written afterwards.`) : "");
  if (l.kind === "unsent") return head + note(l.made, "What I know so far about the invoice.") + ask(l.last, "Ask the supplier why the invoice is 40 euros higher than the quote.", " · Not sent");
  if (l.canvas) return head + note(l.made - 15, "Plan the four garden beds before drawing them.") + ask(l.made, "Draw the four garden beds and say what goes in each.") + work(1, true, `**The garden is drawn.** Four beds, with what grows in each.\n\n![The garden beds](../files/${l.slug}/garden.png)`);
  if (l.kind === "done" || l.kind === "review") return head + ask(l.made, `Please do this: ${l.title.toLowerCase()}.`) + work(1, true, `**Done.** ${l.title} is in place, with two files changed and the tests passing.`);
  if (l.kind === "crowded") return head + [0, 3, 6].map((m, i) => ask(l.made - m, `Step ${i + 1}, quickly.`) + work(i + 1, true, `**Step ${i + 1} is done.**`, "2 min")).join("");
  if (l.kind === "long") return head + [1, 2, 3, 4].map(i => ask(l.made - i * 60, `Part ${i} of the quarterly report, please.`) + work(i, true, `**Part ${i} is written.** It covers the ${["sales", "costs", "people", "plans"][i - 1]} of the quarter.`, `${3 + i} min`)).join("");
  if (l.kind === "choice") return head + `## Questions for you\n\nTick one here, in any Markdown editor, or in PenEcho.\n\n**Which colour for the header?** (@${l.agent})\n\n- [ ] Blue\n- [ ] Green\n\n` + ask(l.made, "Make the header easier to read.") + work(1, false, "");
  if (l.kind === "grill") return head + ask(l.made, "Grill me about the newsletter before you write it.") + `## [ ] Grill me · @${l.agent}\n\nWho reads the newsletter, and how often should it go out?\n\n` + work(1, false, "");
  return head + ask(l.made, `Please start on this: ${l.title.toLowerCase()}.`) + work(1, true, "**The first part is done.** The second needs a decision.") + ask(l.made - 30, "Carry on with the second part.") + work(2, false, "");
}
// A Work's file says when it started and, once it is done, when it ended. `open` is a Work still going or stopped half way: it started at the line's last time and has not ended.
const detailText = (l, num, reviewed, open = false) => front({ line:`../${l.slug}.md`, step:`Work ${num}`, who:`@${l.agent}`, started:stamp(open ? l.last : l.made), ended:open ? "" : stamp(l.last), took:open ? "" : "6 min", reviewed:reviewed ? stamp(l.last - 5) : "" }) + `# Work ${num}: ${l.title}\n\n## Asked\n\n> Please do this.\n\n## Result\n\n<!-- result: the agent's last message -->\n**Done.** ${l.title} is in place.\n<!-- /result -->\n`;
function writeProject(folder, lines) {
  fs.mkdirSync(path.join(folder, "lines"), { recursive:true });
  lines.forEach((l, i) => {
    const file = path.join(folder, "lines", `${l.slug}.md`);
    fs.writeFileSync(file, topicText(l, i + 1));
    // The Work still open on a line that waits, stopped or is working: the second of two, or the only one under a question.
    const openWork = ["waiting", "stopped", "working"].includes(l.kind) ? 2 : l.kind === "choice" ? 1 : 0;
    const works = l.kind === "long" ? [1, 2, 3, 4] : l.kind === "crowded" ? [1, 2, 3] : ["done", "review"].includes(l.kind) ? [1] : l.kind === "paused" ? [1] : openWork === 2 ? [1, 2] : openWork ? [1] : [];
    for (const num of works) {
      fs.mkdirSync(path.join(folder, "works", l.slug), { recursive:true });
      const detail = path.join(folder, "works", l.slug, `work-${num}.md`);
      // An earlier Work of a line still going ended before the Ask that follows it.
      const early = num !== openWork && ["waiting", "stopped", "working", "paused"].includes(l.kind);
      if (l.kind === "crowded") { const m = [0, 3, 6][num - 1]; fs.writeFileSync(detail, detailText({ ...l, made:l.made - m, last:l.made - m - 2 }, num, false)); fs.utimesSync(detail, new Date(at(l.last)), new Date(at(l.last))); continue; }
      fs.writeFileSync(detail, early ? detailText({ ...l, last:l.made - 10 }, num, false) : detailText(l, num, l.kind === "done" || l.kind === "long", num === openWork));
      fs.utimesSync(detail, new Date(at(l.last)), new Date(at(l.last)));
    }
    if (l.canvas) {
      const pictures = path.join(root, "src/server/project-lines/examples/notebook/docs/files/garden-plan");
      fs.mkdirSync(path.join(folder, "files", l.slug), { recursive:true });
      for (const name of ["garden.png", "garden.penecho.json"]) fs.copyFileSync(path.join(pictures, name), path.join(folder, "files", l.slug, name));
    }
    // The file last changed when the line was last touched.
    fs.utimesSync(file, new Date(at(l.last)), new Date(at(l.last)));
  });
}
const MEMORY = `---\nproject: Field notes\n---\n\n# Project memory\n\n## Decisions\n\n- Invoices are checked against the quote before they are paid. (T-40, ${stamp(9000).slice(0, 10)})\n- The newsletter goes out on the first Monday. (T-39, ${stamp(100).slice(0, 10)})\n\n## Facts\n\n- The supplier answers email within a day. (T-12, ${stamp(20000).slice(0, 10)})\n- The garden has four beds. (T-20, ${stamp(-1440).slice(0, 10)})\n`;

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });
// Closed at the end however the check ends: an open browser keeps this script from ever exiting, and an agent waiting on it from ever finishing.
let browser = null;

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const errors = [];
  const send = async (method, address, data) => (await context.request[method](`${base}/api/lines${address}`, { data, headers:{ origin:base } })).json();
  const post = (address, data) => send("post", address, data);

  // ---------- What is in the folders before the page opens ----------
  const seeded = seedLines();
  writeProject(docs, seeded);
  fs.writeFileSync(path.join(docs, "MEMORY.md"), MEMORY);
  writeWeek(weekDocs);
  writeProject(manyDocs, Array.from({ length:120 }, (_, i) => ({ slug:`line-${pad(i + 1)}`, title:`Line ${i + 1}: ${["Fix the login error", "Add a rain chart", "Garden plan", "Write the release notes"][i % 4]}`, kind:["done", "review", "notes", "waiting", "stopped", "paused", "done", "notes"][i % 8], made:(i + 2) * 700, last:(i + 2) * 700 - 90 - i, agent:i % 2 ? "codex" : "claude" })));
  writeProject(path.join(temp, "one"), [{ slug:"only-line", title:"The only line", kind:"notes", made:500, last:200 }]);
  const reviewDocs = path.join(temp, "review-only");
  writeProject(reviewDocs, [1, 2].map(i => ({ slug:`review-${i}`, title:`Result ${i}`, kind:"review", made:500 + i, last:200 + i, agent:"codex" })));
  const reviewOnly = (await post("/projects", { name:"Review only", docsPath:reviewDocs })).project;
  const filterDocs = path.join(temp, "status-filter");
  writeProject(filterDocs, [
    ...Array.from({ length:55 }, (_, i) => ({ slug:`review-${pad(i + 1)}`, title:`Review result ${i + 1}`, kind:"review", made:500 + i, last:200 + i, agent:"codex" })),
    ...Array.from({ length:3 }, (_, i) => ({ slug:`done-${i}`, title:`Reviewed result ${i}`, kind:"done", made:700 + i, last:600 + i, agent:"codex" })),
    ...Array.from({ length:2 }, (_, i) => ({ slug:`note-${i}`, title:`Note ${i}`, kind:"notes", made:900 + i, last:800 + i })),
  ]);
  const filterProject = (await post("/projects", { name:"Status filters", docsPath:filterDocs, offerSkill:false })).project;
  const galleryDocs = path.join(temp, "latest-files"), galleryTitle = "Garden beds and planting schedule for the entire coming season";
  writeProject(galleryDocs, [{ slug:"gallery-origin", title:galleryTitle, kind:"notes", made:500, last:60 }]);
  const galleryFolder = path.join(galleryDocs, "files/gallery-origin");
  fs.mkdirSync(galleryFolder, { recursive:true });
  for (let i = 1; i <= 4; i++) {
    const file = path.join(galleryFolder, `planting-plan-${i}.png`);
    fs.copyFileSync(path.join(root, "src/server/project-lines/examples/notebook/docs/files/garden-plan/garden.png"), file);
    fs.utimesSync(file, new Date(at(5 - i)), new Date(at(5 - i)));
  }
  const galleryLine = path.join(galleryDocs, "lines/gallery-origin.md");
  fs.appendFileSync(galleryLine, "\n" + [1, 2, 3, 4].map(i => `![Planting plan ${i}](../files/gallery-origin/planting-plan-${i}.png)`).join("\n\n") + "\n");
  fs.utimesSync(galleryLine, new Date(at(60)), new Date(at(60)));
  const gallery = (await post("/projects", { name:"Latest files", docsPath:galleryDocs, offerSkill:false })).project;
  // Projects for Move to: more than the sidebar lists, one archived, one whose folder is gone.
  for (const name of ["Old one", "Old two", "Old three"]) await post("/projects", { name, docsPath:path.join(temp, name) });
  const archived = (await post("/projects", { name:"Put away", docsPath:path.join(temp, "put-away") })).project;
  await send("patch", `/projects/${archived.id}`, { archived:true });
  const many = (await post("/projects", { name:"Many lines", docsPath:manyDocs })).project;
  const one = (await post("/projects", { name:"One line", docsPath:path.join(temp, "one") })).project;
  const bare = (await post("/projects", { name:"Brand new", docsPath:path.join(temp, "bare") })).project;
  const week = (await post("/projects", { name:"This week", docsPath:weekDocs })).project;
  await post("/projects", { name:"Second project", docsPath:path.join(temp, "second") });
  const gone = (await post("/projects", { name:"Gone away", docsPath:path.join(temp, "gone") })).project;
  fs.rmSync(path.join(temp, "gone"), { recursive:true, force:true });
  const id = (await post("/projects", { name:"Field notes", docsPath:docs })).project.id;
  await post("/projects/my-canvases", {});
  for (const project of [id, week.id, one.id, many.id, reviewOnly.id]) await send("patch", `/projects/${project}`, { offerSkill:false });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", e => { errors.push(e.message); if (process.argv.includes("--look")) console.log("page error:", e.stack || e.message); });
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // What the page asks the server to do, to see that a button really did it.
  const posts = [];
  page.on("request", r => { if (r.method() === "POST") posts.push({ path:new URL(r.url()).pathname, body:r.postData() || "" }); });
  // Which state each page asked for.
  const states = [];
  const watchStates = (p, into) => p.on("request", r => { const u = new URL(r.url()); if (r.method() === "GET" && /\/state$/.test(u.pathname)) into.push(u.searchParams.get("for") || "whole"); });
  watchStates(page, states);
  const home = async (project = id) => {
    await page.goto(`${base}/projects.html#${project}`);
    await page.waitForFunction(p => window.__lines?.S.cur === p && window.__lines.project() && window.__lines.S.route.view === "home", project, { timeout:30000 });
    await wait(250);
  };
  const reload = async () => { await page.reload(); await page.waitForSelector("#pano .hl-row, #pano .hl-none", { timeout:30000 }); await wait(250); };
  const rows = () => page.evaluate(() => [...document.querySelectorAll("#panoRows .hl-row")].map(r => r.dataset.row));
  const count = selector => page.locator(selector).count();
  const text = async selector => ((await page.locator(selector).first().textContent()) || "").replace(/\s+/g, " ").trim();
  const texts = async selector => (await page.locator(selector).allTextContents()).map(t => t.replace(/\s+/g, " ").trim());
  const row = slug => `.hl-row[data-row="${slug}"]`;
  const shot = name => page.screenshot({ path:path.join(shots, `${name}.png`) });
  const topic = (slug, folder = docs) => fs.readFileSync(path.join(folder, "lines", `${slug}.md`), "utf8");
  const menu = async (slug, label) => {
    await page.hover(`${row(slug)} .hl-main`);
    await page.click(`${row(slug)} .more-btn`);
    await page.waitForSelector("#menu");
    if (label) await page.locator("#menu button").filter({ hasText:label }).click();
  };
  const menuRow = label => page.locator("#menu button").filter({ hasText:label });
  // The lines listed under the project on screen, and the pinned lines of every project at the top of the sidebar.
  const railLines = () => page.evaluate(() => { const box = document.querySelector("#railList .rail-row.on")?.closest(".rail-item")?.nextElementSibling; return box?.classList.contains("rail-lines") ? [...box.querySelectorAll(".rail-line")].map(r => r.dataset.line) : []; });
  const railPins = () => page.evaluate(() => [...document.querySelectorAll("#railList .rail-pins .rail-line")].map(r => r.dataset.line));
  const openLine = async slug => { await page.click(`${row(slug)} .hl-main`); await page.waitForSelector("#linePage"); await wait(750); };
  const openLineAt = async slug => { await page.goto(`${base}/projects.html#${id}/line/${slug}`); await page.waitForFunction(line => window.__lines?.S.route.line === line && document.querySelector("#linePage"), slug); await wait(400); };
  const backHome = async () => { await page.click('#projbar [data-act="go-view"][data-view="home"]'); await page.waitForSelector("#pano .hl-row"); await wait(700); };

  await home();
  await page.waitForFunction(n => window.__lines.project().lines.length >= n, seeded.length, { timeout:30000 });
  // A new browser has read nothing. Here all but three lines have been read, as in a project in use.
  const unread = ["done-03", "review-02", "note-05"];
  await page.evaluate(({ id, unread }) => {
    const reads = {};
    for (const l of __lines.project().lines) if (!unread.includes(l.id)) reads[`${id}:${l.id}`] = l.readRevision;
    localStorage.setItem("penecho-line-reads-v1", JSON.stringify(reads));
  }, { id, unread });
  await reload();
  const facts = await page.evaluate(() => Object.fromEntries(__lines.project().lines.map(l => [l.id, { updatedAt:l.updatedAt, state:__lines.lineState(l) }])));
  if (process.argv.includes("--look")) {
    console.log(await page.evaluate(() => JSON.stringify({ agents:__lines.S.agents.map(a => [a.id, a.available, a.runs]), asking:__lines.project().lines.filter(l => l.asking).map(l => [l.id, l.asking.kind, l.asking.questions]), states:Object.fromEntries(["question-choice", "question-open", "review-canvas", "working-01"].map(k => { const l = __lines.lineById(__lines.project(), k); return [k, l && [__lines.lineState(l), l.stations.map(s => `${s.kind}:${s.state}:${(s.pictures || []).length}`).join(" ")]]; })) })));
    for (const [w, h] of [[1440, 900], [1024, 768], [375, 812]]) for (const mode of ["light", "dark"]) {
      await page.setViewportSize({ width:w, height:h });
      await page.evaluate(m => linesTheme.set(m), mode);
      await home(); await wait(300);
      await page.screenshot({ path:path.join(shots, `look-${w}-${mode}.png`), fullPage:false });
      if (mode === "light") { await page.evaluate(() => { const v = document.querySelector("#view"); v.scrollTop = 520; }); await wait(200); await page.screenshot({ path:path.join(shots, `look-${w}-${mode}-2.png`) }); await page.evaluate(() => { const v = document.querySelector("#view"); v.scrollTop = 1250; }); await wait(200); await page.screenshot({ path:path.join(shots, `look-${w}-${mode}-3.png`) }); }
    }
    await page.setViewportSize({ width:1440, height:900 });
    await page.evaluate(() => linesTheme.set("light"));
    await home(week.id); await wait(300); await page.screenshot({ path:path.join(shots, "look-week.png") });
    console.log("errors:", errors.join(" | "));
    await browser.close();
    return;
  }
  // What the page should sort by, as the dates written in the folder say it: a note, an Ask, when a Work started or ended. A paused line and one the agent grills you on last had an Ask.
  const lastOf = l => (l.kind === "paused" ? at(l.made - 30) : l.kind === "grill" ? at(l.made) : at(l.last));
  const byTime = list => [...list].sort((a, b) => lastOf(b) - lastOf(a) || a.slug.localeCompare(b.slug)).map(l => l.slug);
  const rests = l => (l.kind === "done" || l.kind === "long") && !unread.includes(l.slug), open = seeded.filter(l => !rests(l));
  const kinds = k => seeded.filter(l => l.kind === k).length;
  const toReview = kinds("review") + kinds("crowded"), answers = kinds("choice") + kinds("grill") + kinds("waiting"), needs = answers + kinds("stopped") + toReview + kinds("unsent");

  console.log("\nHome: opens with the week");
  check("every line of the project is read from the folder", Object.keys(facts).length === seeded.length, `${Object.keys(facts).length} of ${seeded.length}`);
  check("the Home asks for the lighter state made for it", states.length > 0 && states.every(v => v === "home"), [...new Set(states)].join(", "));
  check("the project's name stays in the project bar", await text("#projbar .proj-switch span") === "Field notes");
  check("the repeated project heading and status sentence are removed", await count(".desk-top, .hm-top, #hmSay") === 0);
  const opening = await page.evaluate(() => { const home = document.querySelector(".home.desk"), week = document.querySelector("#hmWeek"); return { main:home.firstElementChild?.matches(".desk-main"), first:document.querySelector(".desk-main").firstElementChild?.id, gap:week.getBoundingClientRect().top - home.getBoundingClientRect().top - parseFloat(getComputedStyle(home).paddingTop) }; });
  check("the week opens the home without an empty heading row", opening.main && opening.first === "hmWeek" && Math.abs(opening.gap) < 2, JSON.stringify(opening));
  await home(week.id);
  check("a smaller project has no repeated heading or status", await count(".desk-top, .hm-top, #hmSay") === 0);
  await home(one.id);
  check("a project with one line has no repeated heading or status", await count(".desk-top, .hm-top, #hmSay") === 0);

  console.log("\nHome: compact pending Asks");
  await home();
  check("the large Needs you cards and tabs are removed", await count("#hmNeeds .nc, #hmNeeds .hm-tabs") === 0 && await count("#hmNeeds .nu-box") === 1);
  check("Asks not sent keep their compact rows, dashed nodes and words", await count(".nu-row") === Math.min(3, kinds("unsent")) && /^Ask the supplier why/.test(await text(".nu-row .nu-words")) && await page.evaluate(() => getComputedStyle(document.querySelector(".nu-row .nd"), "::before").borderTopStyle) === "dashed");
  check("the count shows every unsent Ask without an unnecessary more button", await text(".hm-fold em") === String(kinds("unsent")) && await count('[data-act="needs-more"]') === 0);
  check("To review is absent from the compact pending section", await count('#hmNeeds [data-f="review"]') === 0 && !/to review/i.test(await text("#hmNeeds")));
  check("All lines keeps the need-you count before to-review", await text('#panoSum [data-f="you"]') === `${answers} need you` && await text('#panoSum [data-f="review"]') === `${toReview} to review`);
  await page.click('#panoSum [data-f="you"]');
  check("the All lines need-you count opens the lines needing your response first", await page.getAttribute('#panoSum [data-f="you"]', "aria-pressed") === "true" && (await rows()).length === answers);
  await page.click('#panoSum [data-f="you"]');
  await page.click('#panoSum [data-f="review"]');
  check("the All lines review count opens finished lines to review in one press", await page.getAttribute('#panoSum [data-f="review"]', "aria-pressed") === "true" && await page.evaluate(() => document.activeElement?.matches('#panoSum [data-f="review"]')) && (await rows()).length === toReview);
  await page.click('#panoSum [data-f="review"]');
  check("stopped lines are not in the Not sent box", await count('[data-act="needs-lines"], #hmNeeds [data-f="stopped"]') === 0 && !/stopped/i.test(await text("#hmNeeds")));
  await page.click('#panoSum [data-f="stopped"]');
  check("stopped lines stay accessible from their count in All lines", JSON.stringify((await rows()).sort()) === JSON.stringify(seeded.filter(l => l.kind === "stopped").map(l => l.slug).sort()));
  await page.click('#panoSum [data-f="stopped"]');
  await page.evaluate(() => { document.querySelector("#view").scrollTop = 0; });
  await shot("03-compact-pending");
  await page.locator(".hm-fold").press("Enter");
  check("Enter hides the list and leaves a visible Show control", await page.locator("#needsItems").isHidden() && await text(".nu-fold-label") === "Show" && await page.getAttribute(".hm-fold", "aria-expanded") === "false" && await page.evaluate(() => document.activeElement?.matches(".hm-fold")));
  await reload();
  check("hidden is remembered after a reload", await page.locator("#needsItems").isHidden() && await page.getAttribute(".hm-fold", "aria-expanded") === "false");
  await home(week.id);
  check("another project keeps its own visibility choice", await page.getAttribute(".hm-fold", "aria-expanded") === "true" && await count(".nu-row") === 2);
  await home();
  check("returning to the project keeps its list hidden", await page.getAttribute(".hm-fold", "aria-expanded") === "false");
  await page.locator(".hm-fold").press("Space");
  check("Space shows the list and keeps keyboard focus", await page.locator("#needsItems").isVisible() && await text(".nu-fold-label") === "Hide" && await page.evaluate(() => document.activeElement?.matches(".hm-fold")));
  await reload();
  check("shown is remembered after a reload too", await page.getAttribute(".hm-fold", "aria-expanded") === "true" && await count(".nu-row") === kinds("unsent"));
  await home(one.id);
  check("with nothing waiting the section is not drawn", await count(".hm-needs") === 0);
  await home(reviewOnly.id);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height:900 });
    check(`${width} wide: review-only work leaves no Needs you section or count`, await count("#hmNeeds .hm-needs") === 0 && await text("#hmNeeds") === "");
    check(`${width} wide: review results and their filter remain visible in All lines`, (await rows()).length === 2 && await text('#panoSum [data-f="review"]') === "2 to review" && await page.locator('#panoSum [data-f="review"]').isVisible() && await page.evaluate(() => document.querySelector("#view").scrollWidth <= document.querySelector("#view").clientWidth));
    await shot(`03-review-only-${width}`);
  }
  await page.locator('#panoSum [data-f="review"]').focus();
  await page.keyboard.press("Enter");
  check("review remains available by one keyboard activation", await page.getAttribute('#panoSum [data-f="review"]', "aria-pressed") === "true" && (await rows()).length === 2);
  await page.setViewportSize({ width:1440, height:900 });
  await home();

  console.log("\nHome: full width with no right panel or Latest files");
  check("Latest files and the right panel are gone from Home", await count("#deskSide, #hmFiles, #hmRecentLines, #hmMemory, #hmWorking, #hmCanvases") === 0 && await page.evaluate(() => { const home = document.querySelector(".home.desk"), style = getComputedStyle(home), available = home.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight); return Math.abs(document.querySelector(".desk-main").getBoundingClientRect().width - available) < 2; }));
  await home(gallery.id);
  check("a project with pictures also uses full width without Latest files", await count("#deskSide, #hmFiles") === 0);
  await page.setViewportSize({ width:1440, height:900 });
  await home();
  check("the Recent list and the project's card are gone from the home", await count(".rl-recent, .rl-proj, #nowStrip, #needStrip") === 0);
  await page.click("#projbar .subnav-more"); await page.click('#menu button:has-text("Memory")');
  await page.waitForSelector(".memory-page");
  check("Memory remains available from the project navigation, under More", true);
  await page.click('#projbar [data-act="go-view"][data-view="settings"]');
  await page.waitForSelector(".settings-page");
  check("Rename and Archive of the project are in Settings", await count('.settings-page [data-act="project-rename"]') === 1 && await count('.settings-page [data-act="project-archive"]') === 1);
  await home(bare.id);
  check("an empty project has no recent Lines or file cards", await count("#hmRecentLines, #hmFiles") === 0);
  await home();

  console.log("\nAll lines: newest on top, a head for each day");
  let shown = await rows();
  check("the lines are in the order of their last note, Ask or Work, newest first", JSON.stringify(shown) === JSON.stringify(byTime(open)), `got ${shown.slice(0, 8).join(", ")} … wanted ${byTime(open).slice(0, 8).join(", ")}`);
  check("a line with a newer note comes before a line made later", shown.indexOf("old-line-new-note") >= 0 && shown.indexOf("old-line-new-note") < shown.indexOf("young-line"));
  const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  check("a line stands under the day of its last note, not of its making", await page.getAttribute(row("old-line-new-note"), "data-day") === dayKey(at(95)) && dayKey(at(95)) !== dayKey(at(40 * 1440)));
  check("no order tabs or drag grips remain", await count(".pano-sort, [data-act=\"lines-sort\"], .hl-grip") === 0);
  const ticks = await page.evaluate(() => [...document.querySelectorAll("#panoRows .hl-day")].map(d => ({ words:d.querySelector(".hl-day-name").textContent.trim(), day:d.dataset.day, n:d.querySelector("em").textContent.trim() })));
  const seededDays = [...new Set(byTime(seeded).map(slug => dayKey(lastOf(seeded.find(l => l.slug === slug)))))];
  check("a head starts each day: Today, then this week's days as Tue 11, then dates as 6 Oct", ticks[0]?.words === "Today" && /^[A-Z][a-z]{2} \d{1,2}$/.test(ticks[1]?.words || "") && ticks.some(t => /^\d{1,2} [A-Z][a-z]{2}/.test(t.words)) && JSON.stringify(ticks.map(t => t.day)) === JSON.stringify(seededDays.slice(0, ticks.length)), ticks.map(t => t.words).join(" | "));
  check("and under each head are the lines of that day, counted", await page.evaluate(() => [...document.querySelectorAll("#panoRows .hl-dayset")].every(d => d.firstElementChild.matches(".hl-day") && [...d.querySelectorAll(".hl-row")].every(r => r.dataset.day === d.dataset.day))) && /^\d+ lines?$/.test(ticks[0].n), ticks.map(t => t.n).join(" | "));
  check("the trunk's head says how many lines are open", await text("#panoStart .hl-count") === `${open.length + (unread.includes("done-03") ? -1 : 0)} lines open` && await count("#panoStart .trunk-label") === 1, await text("#panoStart .hl-count"));
  const folds = await page.evaluate(() => [...document.querySelectorAll("#panoRows .hl-fold-day")].map(b => ({ day:b.dataset.day, n:+b.textContent.replace(/\D/g, "") })));
  check("finished lines you have read fold into + N finished at the end of their day", folds.length > 0 && folds.every(f => f.n > 0) && await page.evaluate(() => [...document.querySelectorAll("#panoRows .hl-folded")].every(f => !f.nextElementSibling && f.parentElement.matches(".hl-dayset"))), JSON.stringify(folds));
  const foldDay = folds[0]?.day, dayRows = await count(`#panoRows .hl-row[data-day="${foldDay}"]`);
  if (foldDay) await page.click(`.hl-fold-day[data-day="${foldDay}"]`);
  check("and open in place, under that day", await count(`#panoRows .hl-row[data-day="${foldDay}"]`) === dayRows + (folds[0]?.n || 0) && await count(`.hl-fold-day[data-day="${foldDay}"]`) === 0, `${await count(`#panoRows .hl-row[data-day="${foldDay}"]`)} rows that day, ${dayRows} before`);
  await reload();

  console.log("\nAll lines: finished lines are out of the way, and the filters are as they were");
  check("finished lines you have read are not listed", seeded.filter(rests).every(l => !shown.includes(l.slug)) && shown.length === open.length, `${shown.length} rows, ${open.length} open`);
  check("a finished line you have not read is still listed", shown.includes("done-03"));
  check("what needs you is listed: to review, waiting, stopped, not sent", ["review-01", "waiting-01", "stopped-01", "unsent-01"].every(s => shown.includes(s)));
  check("the filters are today's: the count chips and the filter box, without order tabs", await count(".pano-sort") === 0 && await count(".pano-head .sum-work") === 1 && await count(".pano-head .sum-stop") === 1 && await count(".pano-head .sum-you") === 1 && await count(".pano-head .sum-review") === 1 && await count(".pano-head .sum-done") === 1 && await count(".pano-head .sum-unread") === 1 && await count(".pano-head #homeFilter") === 1 && await text(".pano-head h2") === "All lines");
  check("the count of finished lines is one of the chips, not pressed", await text(".sum-done") === "11 finished" && await page.getAttribute(".sum-done", "aria-pressed") === "false", await text(".sum-done"));
  await page.click(".sum-done");
  shown = await rows();
  const finished = byTime(seeded.filter(l => ["done", "long"].includes(l.kind)));
  check("Finished shows only completed, reviewed lines, without folding them away", JSON.stringify(shown) === JSON.stringify(finished) && await page.getAttribute(".sum-done", "aria-pressed") === "true" && await count(".hl-fold-day") === 0, shown.join(", "));
  await reload();
  check("that choice is still there after a reload", await page.getAttribute(".sum-done", "aria-pressed") === "true" && JSON.stringify(await rows()) === JSON.stringify(finished));
  await page.click(".sum-done");
  await reload();
  check("and so is hiding them again", (await rows()).length === open.length && await page.getAttribute(".sum-done", "aria-pressed") === "false");
  await page.click(".sum-review");
  shown = await rows();
  const look = seeded.filter(l => ["review", "crowded"].includes(l.kind)).map(l => l.slug);
  check("to review shows only the finished lines to look at", shown.length > 0 && shown.every(s => look.includes(s)) && await page.getAttribute(".sum-review", "aria-pressed") === "true", shown.join(", "));
  const lookCount = shown.length;
  await reload();
  check("a pressed chip is remembered too", (await rows()).length === lookCount && await page.getAttribute(".sum-review", "aria-pressed") === "true");
  await page.click(".sum-review");
  check("pressing it again shows the open lines", (await rows()).length === open.length);
  await home(one.id);
  check("another project has its own choice and starts on All", await count("#panoRows .hl-row") === 1 && await page.getAttribute('.sum-all', 'aria-pressed') === 'true' && await count('.sum-f:not(.sum-all)[aria-pressed="true"]') === 0);
  await home();

  console.log("\nAll lines: each line a lane, each day a clock");
  const shape = await page.evaluate(() => {
    const all = [...document.querySelectorAll("#panoRows .hl-row")];
    return { parts:all.every(r => r.querySelector(".hl-lane .hl-name .hl-title").textContent.trim() && r.querySelector(".hl-lane > .hl-track") && r.querySelector(".hl-lane > .hl-state")), tall:Math.max(...all.map(r => r.getBoundingClientRect().height)), rows:all.length,
      columns:all.every(r => { const n = r.querySelector(".hl-name").getBoundingClientRect(), t = r.querySelector(".hl-track").getBoundingClientRect(), s = r.querySelector(".hl-state").getBoundingClientRect(); return n.right <= t.left && t.right <= s.left && s.width >= 100 && s.width <= 124; }) };
  });
  check("each line is a lane about 50px high: title and last words, its track, where it stands", shape.parts && shape.columns && shape.tall <= 60, JSON.stringify(shape));
  const clocks = await page.evaluate(() => [...document.querySelectorAll("#panoRows .hl-day")].map(d => { const labels = [...d.querySelectorAll(".hc-l")].map(l => l.getBoundingClientRect()), clock = d.querySelector(".hl-clock").getBoundingClientRect(), track = d.closest(".hl-dayset").querySelector(".hl-track")?.getBoundingClientRect();
    return { day:d.dataset.day, words:labels.length, apart:labels.every((b, i) => !i || b.left >= labels[i - 1].right + 2), inside:labels.every(b => b.left >= clock.left - 1 && b.right <= clock.right + 1), now:d.querySelector(".hl-now").textContent.trim(), ring:Boolean(d.querySelector(".hc-now")), aligned:!track || (Math.abs(track.left - clock.left) < 1 && Math.abs(track.width - clock.width) < 1) }; }));
  const todayHead = clocks.find(c => c.day === dayKey(Date.now()));
  check("each day's head is its clock: hour words that never touch, over the same column as its lanes' tracks", clocks.length > 2 && clocks.every(c => c.words >= 1 && c.apart && c.inside && c.aligned), JSON.stringify(clocks.slice(0, 4)));
  check("today's clock ends at now, with its ring and Now · HH:MM; earlier days have neither", todayHead && /^Now · \d\d:\d\d$/.test(todayHead.now) && todayHead.ring && clocks.filter(c => c !== todayHead).every(c => !c.now && !c.ring), JSON.stringify(todayHead));
  // Titles and the clock share useful room; marks stay in order without hiding another at common and wide desktop sizes.
  const placed = () => page.evaluate(() => [...document.querySelectorAll("#panoRows .hl-dayset .hl-row")].map(r => {
    const l = __lines.lineById(__lines.project(), r.dataset.row), order = new Map(l.stations.map((s, i) => [s.id, i]));
    const marks = [...r.querySelectorAll(".hl-track .dm[data-step]")].map(m => ({ i:order.get(m.dataset.step), b:m.getBoundingClientRect() })), boxes = [...r.querySelectorAll(".hl-track .dm")].map(m => m.getBoundingClientRect()).sort((a, b) => a.left - b.left);
    return { id:r.dataset.row, inOrder:marks.every((m, k) => !k || (m.i > marks[k - 1].i && m.b.left > marks[k - 1].b.left)), apart:boxes.every((b, k) => !k || b.left >= boxes[k - 1].right - .5), n:marks.length };
  }));
  for (const width of [1280, 1440, 2048]) {
    await page.setViewportSize({ width, height:900 });
    // The marks keep their shares while the width settles, and are laid out again 300 ms after it has.
    await wait(700);
    const room = await page.evaluate(() => { const r = document.querySelector("#panoRows .hl-row"), name = r.querySelector(".hl-name").getBoundingClientRect(), track = r.querySelector(".hl-track").getBoundingClientRect(), state = r.querySelector(".hl-state").getBoundingClientRect(); return { name:name.width, track:track.width, aligned:name.right <= track.left && track.right <= state.left, overflow:document.querySelector("#view").scrollWidth - document.querySelector("#view").clientWidth }; });
    check(`${width} wide: titles get more than the old 300px cap while the clock keeps useful room`, room.name >= (width === 2048 ? 480 : 315) && room.track >= 280 && room.aligned && room.overflow <= 0, JSON.stringify(room));
    const lanes = await placed();
    check(`${width} wide: on every lane the marks keep the order of the steps and none hides another`, lanes.length > 20 && lanes.every(x => x.inOrder && x.apart), JSON.stringify(lanes.filter(x => !x.inOrder || !x.apart).slice(0, 3)));
    const crowd = await page.evaluate(() => { const r = document.querySelector('.hl-row[data-row="crowded-today"]'), m = [...r.querySelectorAll(".hl-track > *")].map(e => ({ c:e.className, b:e.getBoundingClientRect() })), asks = m.filter(x => /dm-ask/.test(x.c)), faces = m.filter(x => /dm-face/.test(x.c)), bars = m.filter(x => /dm-bar/.test(x.c));
      return { asks:asks.length, faces:faces.length, tight:asks.every((a, i) => faces[i] && faces[i].b.left - a.b.right >= 0 && faces[i].b.left - a.b.right <= 10), bars:bars.length === 0, end:/dm-face/.test(m[m.length - 1].c) && /e-review/.test(m[m.length - 1].c) }; });
    check(`${width} wide: steps minutes apart stay readable: each Ask beside its face, short Works omit stubby bars, status circles the last face`, crowd.asks === 3 && crowd.faces === 3 && crowd.tight && crowd.bars && crowd.end, JSON.stringify(crowd));
    await page.locator(row("crowded-today")).screenshot({ path:path.join(shots, `04-crowded-lane-${width}.png`) });
  }
  await page.setViewportSize({ width:1440, height:900 });
  await wait(700);
  const marksAt = await page.evaluate(() => { const l = __lines.lineById(__lines.project(), "crowded-today"), r = document.querySelector('.hl-row[data-row="crowded-today"]'), faces = [...r.querySelectorAll(".dm-face")].map(f => f.getBoundingClientRect().left); return { faces, starts:l.stations.filter(s => s.startedAt).map(s => s.startedAt) }; });
  check("a Work's face stands where its file says it started, and its bar runs to where it ended", marksAt.starts.length === 3 && marksAt.faces.length === 3 && marksAt.faces.every((x, i) => !i || x > marksAt.faces[i - 1]), JSON.stringify(marksAt));
  const ends = await page.evaluate(() => Object.fromEntries(["working-01", "review-01", "crowded-today", "waiting-01", "unsent-01", "stopped-01", "paused-01", "note-01", "done-03", "question-open"].map(slug => { const r = document.querySelector(`.hl-row[data-row="${slug}"]`); return [slug, r ? `${r.querySelector(".hl-state").textContent.trim().replace(/ · \d+ (min|h|d)$/, "")}|${r.querySelector(".dm-face.has-end, .dm-end")?.className.match(/e-\w+/)?.[0] || ""}` : "absent"]; })));
  check("where each line stands, in words at the right and as the ring on its agent circle (or mark at its track's end)", JSON.stringify(ends) === JSON.stringify({ "working-01":"Working|e-run", "review-01":"To review|e-review", "crowded-today":"To review|e-review", "waiting-01":"Needs you|e-you", "unsent-01":"Not sent|", "stopped-01":"Stopped|e-bad", "paused-01":"Stopped|e-bad", "note-01":"|", "done-03":"Reviewed|e-done", "question-open":"Answer|e-you" }), JSON.stringify(ends));
  check("an Ask not sent is the dashed amber ring; a Work is its agent's face and a bar in its colour", await page.evaluate(() => { const ring = document.querySelector('.hl-row[data-row="unsent-01"] .dm-unsent .nd'), bar = document.querySelector('.hl-row[data-row="review-01"] .dm-bar'), face = document.querySelector('.hl-row[data-row="review-01"] .dm-face .av'); return getComputedStyle(ring, "::before").borderTopStyle === "dashed" && face && getComputedStyle(bar).backgroundColor === getComputedStyle(face).backgroundColor; }));
  check("a line with steps from an earlier day runs in from the left edge", await page.evaluate(() => { const t = document.querySelector('.hl-row[data-row="waiting-01"] .hl-track'); return parseFloat(getComputedStyle(t, "::before").left) === 0 && parseFloat(getComputedStyle(t, "::before").width) > 0; }));
  check("a line stopped on a question shows its wait as a dashed amber line to the end of the clock", await page.evaluate(() => { const r = document.querySelector('.hl-row[data-row="question-open"]'), t = r.querySelector(".hl-track").getBoundingClientRect(), w = r.querySelector(".dm-wait"), b = w?.getBoundingClientRect(); return Boolean(w) && getComputedStyle(w).borderTopStyle === "dashed" && Math.abs(b.right - t.right) < 1.5 && r.querySelector(".dm-face.e-you.is-asked .dm-q, .dm-end.e-you.is-asked .nd")?.textContent.trim() === "?"; }));
  check("a working line's turning ring circles its agent circle and its bar reaches now", await page.evaluate(() => { const r = document.querySelector('.hl-row[data-row="working-01"]'), t = r.querySelector(".hl-track").getBoundingClientRect(), bars = [...r.querySelectorAll(".dm-bar")], ring = r.querySelector(".dm-face.has-end.e-run"), rb = ring?.getBoundingClientRect(); return Boolean(ring) && !r.querySelector(".dm-end") && bars.length > 0 && Math.abs(bars[bars.length - 1].getBoundingClientRect().left - (rb.left + rb.width / 2)) < 2 && Math.abs(bars[bars.length - 1].getBoundingClientRect().right - t.right) < 1; }));
  check("the day's hour lines run through its lanes", await page.evaluate(() => { const t = document.querySelector("#panoRows .hl-dayset .hl-track"), css = getComputedStyle(t), size = css.backgroundSize.split(' ')[0], pixels = parseFloat(size) * (size.endsWith('%') ? t.getBoundingClientRect().width / 100 : 1); return /linear-gradient/.test(css.backgroundImage) && pixels >= 50; }));
  const lastWords = slug => page.evaluate(s => document.querySelector(`.hl-row[data-row="${s}"] .hl-words`)?.textContent.trim() || "", slug);
  check("under the title, the line's newest words: a later note, an Ask not sent yet, what the agent last said", /^The word marzipan/.test(await lastWords("needle")) && /^Ask the supplier why/.test(await lastWords("unsent-02")) && /^Done\. Review 4/.test(await lastWords("review-04")), `${await lastWords("unsent-02")} | ${await lastWords("review-04")}`);
  check("a line you have not read has a violet dot, and one you have read has none", await count(`${row("note-05")} .hl-new`) === 1 && await count(`${row("note-02")} .hl-new`) === 0 && await page.evaluate(() => getComputedStyle(document.querySelector('.hl-row[data-row="note-05"] .hl-new')).backgroundColor) === "rgb(124, 58, 237)");
  check("a line with a question says Answer before its title, and Answer at the right", /^Answer/.test(await text(`${row("question-open")} .hl-title`)) && await text(`${row("question-open")} .hl-state .hl-answer`) === "Answer");
  await page.hover(`${row("waiting-04")} .hl-track`, { force:true });
  await wait(400);
  check("pointing at a lane's marks opens no popup", await count("#stopCard") === 0);

  console.log("\nAll lines: a lane opens in place");
  await page.click(`${row("stopped-01")} .hl-track`, { force:true });
  check("clicking a lane opens its Ask and actions without a bubble for an empty latest Work", await page.getAttribute(`${row("stopped-01")} .hl-hit`, "aria-expanded") === "true" && await count(`${row("stopped-01")} .hl-detail .hd-ask`) === 1 && await count(`${row("stopped-01")} .hl-detail .hd-result`) === 0 && /Retry/.test(await text(`${row("stopped-01")} .hd-acts`)) && /Open line/.test(await text(`${row("stopped-01")} .hd-acts`)), await text(`${row("stopped-01")} .hl-detail`).catch(() => "none"));
  check("its details show the last Ask in its blue box, the last result, its code, and no tags", await page.evaluate(() => { const r = document.querySelector('.hl-row[data-row="stopped-01"]'), ask = r.querySelector(".hd-ask"); return /Carry on with the second part/.test(ask.textContent) && getComputedStyle(ask).borderTopColor === "rgb(191, 219, 254)" && r.querySelectorAll(".hl-tag").length === 0 && /T-\d+/.test(r.querySelector(".hd-meta .hl-code").textContent); }));
  await shot("04-lane-open");
  await page.click(`${row("review-01")} .hl-words`, { force:true });
  check("one lane is open at a time", await count("#panoRows .hl-detail") === 1 && await count(`${row("review-01")} .hl-detail`) === 1 && /Mark reviewed/.test(await text(`${row("review-01")} .hd-acts`)));
  await page.evaluate(() => { Pano.update(true); });
  check("an open preview stays open when the day map refreshes", await count("#panoRows .hl-detail") === 1 && await page.getAttribute(`${row("review-01")} .hl-hit`, "aria-expanded") === "true");
  await page.click(`${row("review-01")} .hl-state`, { force:true });
  check("clicking it again closes it", await count("#panoRows .hl-detail") === 0 && await page.getAttribute(`${row("review-01")} .hl-hit`, "aria-expanded") === "false");
  await page.locator(`${row("unsent-01")} .hl-hit`).focus();
  await page.keyboard.press("Enter");
  check("a lane is reached with Tab and opened with Enter, keeping the keyboard on it", await count(`${row("unsent-01")} .hl-detail`) === 1 && await page.evaluate(() => document.activeElement?.matches('.hl-row[data-row="unsent-01"] .hl-hit')) && /Send/.test(await text(`${row("unsent-01")} .hd-acts`)));
  await page.keyboard.press("Space");
  check("and closed with Space", await count("#panoRows .hl-detail") === 0);
  await page.click(`${row("review-canvas")} .hl-track`, { force:true });
  check("an opened lane shows the picture its Work made, and the picture opens the viewer", await page.evaluate(() => { const img = document.querySelector('.hl-row[data-row="review-canvas"] .hl-detail .st-pic img'); return Boolean(img && img.complete && img.naturalWidth > 0); }));
  await page.click(`${row("review-canvas")} .hl-detail .st-pic`);
  await page.waitForSelector("#lightbox .fv-x");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#lightbox .fv-x"));
  check("and closing the viewer brings you back to the lane", await page.evaluate(() => document.activeElement?.closest('.hl-row[data-row="review-canvas"]') !== null));
  await page.click(`${row("review-canvas")} .hl-hit`);
  await page.click(`${row("review-02")} .hl-main`);
  await page.waitForSelector("#linePage");
  check("the title goes to the line's own page", await page.evaluate(() => __lines.S.route.view === "line" && __lines.S.route.line === "review-02"));
  await backHome();
  check("and opens no details on the way", await count("#panoRows .hl-detail") === 0);
  await page.locator(`${row("review-02")} .hl-main`).focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#linePage");
  check("Enter on a title goes directly to its detail page too", await page.evaluate(() => __lines.S.route.line === "review-02"));
  await backHome();
  await page.click(`${row("waiting-01")} .hl-hit`);
  await page.click(`${row("waiting-01")} .hd-open`);
  await page.waitForSelector("#linePage");
  check("Open line goes there too", await page.evaluate(() => __lines.S.route.line === "waiting-01"));
  await backHome();
  await page.click(`${row("waiting-01")} .hl-hit`);

  console.log("\nAll lines: the day's head stays in view");
  const sticky = async () => page.evaluate(() => { const top = document.querySelector(".pano-head").getBoundingClientRect().bottom; return { top, heads:[...document.querySelectorAll("#panoRows .hl-day")].map(d => ({ day:d.dataset.day, top:d.getBoundingClientRect().top, bottom:d.getBoundingClientRect().bottom })) }; });
  // The day with the most lanes, scrolled to its second lane, then the day after it, a little way in.
  const big = await page.evaluate(() => { const sets = [...document.querySelectorAll("#panoRows .hl-dayset")], n = sets.map(d => d.querySelectorAll(".hl-row").length); return n.indexOf(Math.max(...n.slice(0, -1))); });
  await page.evaluate(k => { const v = document.querySelector("#view"), set = document.querySelectorAll("#panoRows .hl-dayset")[k]; v.scrollTop += set.querySelectorAll(".hl-row")[1].getBoundingClientRect().top - v.getBoundingClientRect().top; }, big);
  await wait(150);
  let seen = await sticky();
  check("scrolled into a day, its head stays just under the heading, opaque, its date and hours in view", seen.heads.length > big + 1 && Math.abs(seen.heads[big].top - seen.top) <= 1.5 && await page.evaluate(k => { const head = document.querySelectorAll("#panoRows .hl-day")[k]; return getComputedStyle(head).backgroundColor === "rgb(255, 255, 255)" && head.querySelectorAll(".hc-l").length > 0 && document.elementFromPoint(head.querySelector(".hc-l").getBoundingClientRect().left + 3, head.querySelector(".hc-l").getBoundingClientRect().top + 4)?.closest(".hl-day") === head; }, big), JSON.stringify({ big, top:seen.top, heads:seen.heads.slice(0, big + 2) }));
  await page.evaluate(k => { const v = document.querySelector("#view"), next = document.querySelectorAll("#panoRows .hl-dayset")[k + 1], heading = document.querySelector('.pano-head'); v.scrollTop += next.getBoundingClientRect().top - heading.getBoundingClientRect().bottom + 1; }, big);
  await wait(150);
  seen = await sticky();
  check("further down, the next day's head has taken the place, and the one before was pushed away", Math.abs(seen.heads[big + 1].top - seen.top) <= 1.5 && seen.heads.slice(0, big + 1).every(h => h.bottom <= seen.top + 1), JSON.stringify({ top:seen.top, heads:seen.heads.slice(0, big + 2) }));
  await shot("04-sticky-day");
  await page.evaluate(() => { document.querySelector("#view").scrollTop = 0; });

  console.log("\nAll lines: the filter box");
  await page.click("#homeFilter");
  await page.keyboard.type("marz", { delay:20 });
  check("typing narrows the lines at once, by their last words", JSON.stringify(await rows()) === JSON.stringify(["needle"]), (await rows()).join(", "));
  await page.keyboard.press("Escape");
  check("Escape clears it", await page.inputValue("#homeFilter") === "" && (await rows()).length === open.length);
  await page.keyboard.type("old line", { delay:20 });
  check("it looks through titles, whatever the case", JSON.stringify(await rows()) === JSON.stringify(["old-line-new-note"]), (await rows()).join(", "));
  await page.fill("#homeFilter", "Done 7");
  check("it finds a finished line that is not listed", JSON.stringify(await rows()) === JSON.stringify(["done-07"]), (await rows()).join(", "));
  await page.fill("#homeFilter", "no such thing");
  check("and says so when nothing matches", await count("#panoRows .hl-row") === 0 && await text(".hl-none") === "Nothing matches “no such thing”.", await text(".hl-none").catch(() => ""));
  check("the box keeps the cursor while the list changes", await page.evaluate(() => document.activeElement?.id === "homeFilter"));
  await page.fill("#homeFilter", "");
  check("emptied, every open line is back", (await rows()).length === open.length);

  console.log("\nHome: nothing is written again while nothing changes");
  await page.mouse.move(700, 20);
  // Today's clock moves on once a minute, so the watch starts early in a minute.
  await until(() => { const sec = new Date().getSeconds(); return sec >= 1 && sec <= 48; }, "an early second of a minute", 70000);
  await page.evaluate(() => { window.__writes = 0; window.__watch = new MutationObserver(list => { window.__writes += list.length; }); for (const s of ["#panoRows", "#panoSum", "#panoStart", "#railList", "#railMine", "#hmTokens", "#hmWeek", "#hmNeeds"]) window.__watch.observe(document.querySelector(s), { childList:true, subtree:true, characterData:true, attributes:true }); });
  await wait(6500);
  check("three looks at the folder leave the page and the sidebar as they are", await page.evaluate(() => { window.__watch.disconnect(); return window.__writes; }) === 0, `${await page.evaluate(() => window.__writes)} writes`);

  console.log("\nAll lines: saved My order still renders By time");
  const before = await rows();
  await page.evaluate(() => { project().lineSort = "mine"; project().lineOrder = [...project().lines].reverse().map(l => l.id); Pano.update(true); });
  check("saved lineSort=mine keeps By time order and day ticks", JSON.stringify(await rows()) === JSON.stringify(before) && await count("#panoRows .hl-day") === ticks.length, `${await count("#panoRows .hl-day")} ticks`);

  console.log("\nThe sidebar: the newest Lines of every project, pinned lines on top");
  const newest = (n = 5, without = []) => seeded.filter(l => !['done', 'long'].includes(l.kind) && !without.includes(l.slug))
    .sort((a, b) => a.made - b.made || seeded.indexOf(b) - seeded.indexOf(a)).slice(0, n).map(l => l.slug);
  await reload();
  check("the project on screen lists its five newest lines, opened or not, working ones among them by time", JSON.stringify(await railLines()) === JSON.stringify(newest()), (await railLines()).join(", "));
  check("the number of lines that need you stays on the project", /^\d+$/.test(await text("#railList .rail-row.on .tab-badge")), await text("#railList .rail-row.on .tab-badge").catch(() => "none"));
  for (const slug of ["note-01", "note-02", "note-03", "note-04"]) { await openLine(slug); if (slug !== "note-04") await backHome(); }
  states.length = 0;
  await page.evaluate(() => __lines.poll());
  await wait(600);
  check("a line's page asks for the whole state", states.length > 0 && states.every(v => v === "whole") && await page.evaluate(() => !__lines.project().partial), [...new Set(states)].join(", "));
  check("the line on screen is listed and marked", await text("#railList .rail-line.on .rail-title") === seeded.find(l => l.slug === "note-04").title);
  await backHome();
  check("creation order survives returning Home", JSON.stringify(await railLines()) === JSON.stringify(newest()), (await railLines()).join(", "));
  await page.locator(`${row("waiting-02")} [data-act="line-pin"]`).click();
  await wait(150);
  check("Pin is directly available on the row, and a pinned line moves under Pinned, with no project icon", JSON.stringify(await railPins()) === JSON.stringify(["waiting-02"]) && !(await railLines()).includes("waiting-02") && await count('#railList .rail-pins .rail-line[data-line="waiting-02"] .pglyph') === 0, `${(await railPins()).join(", ")} :: ${(await railLines()).join(", ")}`);
  for (const mode of ["light", "dark"]) {
    await page.evaluate(mode => document.documentElement.dataset.mode = mode, mode);
    const looks = await page.evaluate(() => ["#railList .rail-pins .rail-line .rail-title", "#railList .rail-lines .rail-line .rail-title"].map(sel => { const el = document.querySelector(sel), box = el.getBoundingClientRect(); return { sel, color:getComputedStyle(el).color, visible:box.width > 0 && box.height > 0 }; }));
    check(`${mode}: the pinned and unpinned Line titles can be read`, looks.every(l => l.visible && l.color !== "rgba(0, 0, 0, 0)"), JSON.stringify(looks));
    await shot(`05-sidebar-${mode}`);
  }
  await page.evaluate(() => document.documentElement.dataset.mode = "light");
  await page.locator(`${row("working-01")} [data-act="line-pin"]`).click();
  await until(() => page.locator('#railList .rail-pins [data-line="working-01"]').count(), "the working line to be pinned");
  check("a pinned working line is shown once, under Pinned, with its spinner", await count('#railList .rail-line[data-line="working-01"]') === 1 && await count('#railList .rail-pins [data-line="working-01"] .spin') === 1);
  await page.locator(`${row("working-01")} [data-act="line-pin"]`).click();
  await until(async () => !(await page.locator('#railList .rail-pins [data-line="working-01"]').count()), "the unpinned line to leave Pinned");
  const first = newest(1, ["waiting-02"])[0];
  await page.locator(`${row(first)} [data-act="line-pin"]`).click();
  await until(() => page.locator(`#railList .rail-pins [data-line="${first}"]`).count(), "the newest line to be pinned");
  check("pinning one of the newest shows it once, and the next line fills its place", await count(`#railList .rail-line[data-line="${first}"]`) === 1 && JSON.stringify(await railLines()) === JSON.stringify(newest(5, ["waiting-02", first])), (await railLines()).join(", "));
  await page.locator(`${row(first)} [data-act="line-pin"]`).click();
  await until(() => page.locator(`#railList .rail-lines [data-line="${first}"]`).count(), "the unpinned line to return");
  await until(() => /^pinned: yes$/m.test(topic("waiting-02")), "the pin in the line's file");
  check("a pin is kept with the line, in its file, not in the browser", posts.some(p => /\/topics\/waiting-02\/pin$/.test(p.path) && /"pinned":true/.test(p.body)) && await page.evaluate(() => !localStorage.getItem("penecho-line-pins-v1") || localStorage.getItem("penecho-line-pins-v1") === "{}"));
  // A pin made before the server kept pins is in the browser. It is moved to its line once.
  await page.evaluate(id => localStorage.setItem("penecho-line-pins-v1", JSON.stringify({ [id]:["note-12", "no-such-line"] })), id);
  await reload();
  await until(() => /^pinned: yes$/m.test(topic("note-12")), "the old pin to reach its line");
  await until(() => page.evaluate(() => localStorage.getItem("penecho-line-pins-v1") === "{}"), "the browser to forget it");
  check("a pin kept in the browser from before is moved to its line, and forgotten here", (await railPins()).includes("note-12"));
  await page.locator(`${row("note-12")} [data-act="line-pin"]`).click();
  await until(() => !/^pinned:/m.test(topic("note-12")), "the pin to leave the file");
  await reload();
  check("pins and creation order are kept after reload", JSON.stringify(await railPins()) === JSON.stringify(["waiting-02"]) && JSON.stringify(await railLines()) === JSON.stringify(newest(5, ["waiting-02"])), `${(await railPins()).join(", ")} :: ${(await railLines()).join(", ")}`);
  const recentRow = page.locator("#railList .rail-lines .rail-line").first(), recentId = await recentRow.getAttribute("data-line");
  await recentRow.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#linePage");
  check("a sidebar line opens with one keyboard activation and is marked current", await page.getAttribute("#railList .rail-line.on", "data-line") === recentId && await page.getAttribute("#railList .rail-line.on", "aria-current") === "page");
  await backHome();
  await menu("waiting-02");
  check("the menu has no Pin or split action", await menuRow(/^(Pin|Unpin|Plan and split)$/).count() === 0);
  await page.keyboard.press("Escape");
  const unpin = page.locator(`${row("waiting-02")} [data-act="line-pin"]`);
  check("the visible pin button reflects its state", await unpin.getAttribute("aria-pressed") === "true" && /Unpin/.test(await unpin.getAttribute("aria-label")));
  await unpin.focus();
  await page.keyboard.press("Enter");
  await until(() => unpin.getAttribute("aria-pressed").then(value => value === "false"), "the row to be unpinned");
  check("keyboard pinning retains focus after the row updates", await unpin.evaluate(el => document.activeElement === el));
  await wait(150);
  check("Unpin takes it out of Pinned, and it is listed with its project again if it is among the newest", !(await railPins()).includes("waiting-02") && (await railLines()).length === 5);
  await page.click("#railMine .rail-row");
  await page.waitForSelector(".canvases-page");
  check("nothing is listed under My Canvases", await count("#railMine .rail-line") === 0 && await count("#railMine .rail-lines") === 0);
  await home();

  console.log("\nCompact pending Asks: sending and opening");
  check("with no agent to run it, an Ask not sent offers Open line", (await texts(".nu-row .btn")).length >= 2 && (await texts(".nu-row .btn")).every(t => t === "Open line"), `${(await texts(".nu-row .btn")).join(" | ")} :: ${(await text("#hmNeeds").catch(() => "")).slice(0, 300)}`);
  await page.route("**/api/lines/agents", async route => { const r = await route.fetch(), body = await r.json(); for (const a of body.agents) if (a.id === "codex" || a.id === "claude") Object.assign(a, { available:true, runs:true }); await route.fulfill({ response:r, json:body }); });
  await reload();
  check("with agents here, it offers Send, and an arrow to choose who runs it", JSON.stringify(await texts(".nu-row:first-child .send-two .btn")) === JSON.stringify(["Send", ""]) && await count(".nu-row .send-two-pick") === await count(".nu-row"));
  await page.click(".nu-row:first-child .send-two-pick");
  check("the arrow lists the agents that can run it", JSON.stringify(await texts("#menu button span:not(.av)")) === JSON.stringify(["Claude Code", "Codex"]) || (await texts("#menu button")).length === 2, (await texts("#menu button")).join(" | "));
  await page.keyboard.press("Escape");
  await page.click(".nu-row:first-child .send-two .btn:first-child");
  await until(() => posts.some(p => /\/topics\/unsent-0\d\/run-unsent$/.test(p.path)), "the run", 8000).catch(() => false);
  const ran = posts.find(p => /\/run-unsent$/.test(p.path)), sent = JSON.parse(ran?.body || "{}");
  check("Send runs that Ask, as Run with does on the line's page", Boolean(sent.step) && ["codex", "claude"].includes(sent.agent), ran ? ran.body : posts.slice(-4).map(p => p.path).join(" | "));
  await page.unroute("**/api/lines/agents");
  await reload();

  console.log("\nThe box: one button with a dropdown, and one + for what goes with a message");
  const box = ".dock-wrap .composer", says = () => text(`${box} .send-btn span`);
  const lineOnScreen = () => page.evaluate(() => __lines.S.route.line);
  check("the box has one button, Send to AI, with its arrow", await count(`${box} .send-btn`) === 1 && await says() === "Send to AI" && await count(`${box} .send-pick`) === 1 && await count(`${box} .note-btn`) === 0 && /↵/.test(await text(`${box} .send-btn .cmp-key`)));
  check("the four icons at its left are one +", await count(`${box} .cmp-plus`) === 1 && await count(`${box} .cmp-bar [data-act="cmp-attach"], ${box} .cmp-bar [data-act="cmp-draw"], ${box} .cmp-bar [data-act="cmp-slash"], ${box} .cmp-bar [data-act="cmp-ppt"]`) === 0);
  await page.click(`${box} .cmp-plus`);
  check("its menu offers attachments and a new Canvas, each with its icon", JSON.stringify(await texts("#menu button span")) === JSON.stringify(["Add images or files", "Add new canvas"]) && await count("#menu button svg") === 2, (await texts("#menu button span")).join(" | "));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), menuRow(/^Add images or files$/).click()]);
  await chooser.setFiles(path.join(root, "src/server/project-lines/examples/notebook/docs/files/garden-plan/garden.png"));
  await page.waitForSelector(`${box} .cmp-file`);
  check("Add images or files opens the file chooser, and the file goes in the box", /garden\.png/.test(await text(`${box} .cmp-file`)));
  await page.click(`${box} .cmp-file [data-act="cmp-remove"]`);
  await page.click(`${box} .cmp-input`);
  await page.keyboard.type("/");
  check("typing / opens the quick starts", await page.locator(`${box} .slash-menu`).isVisible() && await count(`${box} .slash-menu button`) >= 5);
  await page.keyboard.press("Backspace");
  // What to make is a chip in the bar, never prompt text (PE-404).
  check("the chips say what you can get back", JSON.stringify(await texts(`${box} .cmp-chip span`)) === JSON.stringify(["Diagram", "Explorer", "Slides", "Note card", "MeetCue"]), (await texts(`${box} .cmp-chip span`)).join(" | "));
  await page.click(`${box} .cmp-chip[data-kind="slides"]`);
  check("Slides shows its templates on top of the box, and asks what the deck is for", await count(`${box} .cmp-kinds .cmp-kind`) === 4 && await count(`${box} .cmp-kinds img`) === 3 && /What is the deck for/.test(await page.getAttribute(`${box} .cmp-input`, "placeholder")) && await page.inputValue(`${box} .cmp-input`) === "");
  check("and offers what to give for it", JSON.stringify(await texts(`${box} .cmp-give span`)) === JSON.stringify(["Paste a table from Excel", "Add .xlsx or .csv"]));
  await page.click(`${box} .cmp-kind[data-sub="investor"]`);
  await page.click(`${box} .cmp-input`);
  await page.keyboard.press("Tab");
  check("Tab puts the example in", await page.inputValue(`${box} .cmp-input`) === "Q3 results for the board" && await count(`${box} .cmp-chip.on[data-kind="slides"]`) === 1 && await count(`${box} .cmp-kind.on[data-sub="investor"]`) === 1);
  await page.fill(`${box} .cmp-input`, "");
  await page.click(`${box} .cmp-chip[data-kind="slides"]`);
  check("clicking the chip again clears it", await count(`${box} .cmp-chip.on`) === 0 && await page.locator(`${box} .cmp-make`).isHidden());
  await page.click(`${box} .cmp-input`);
  await page.keyboard.type("Count the apples");
  await page.keyboard.down("Shift"); await page.keyboard.press("Enter"); await page.keyboard.up("Shift");
  await page.keyboard.type("and the pears.");
  check("Shift+Enter is a new line in the box", await page.inputValue(`${box} .cmp-input`) === "Count the apples\nand the pears." && await count("#linePage") === 0);
  await page.keyboard.press("Enter");
  await page.waitForSelector("#linePage");
  const asked = await lineOnScreen();
  await until(() => /## Ask · [^\n]*\n\nCount the apples\nand the pears\./.test(topic(asked)), "the Ask in the new line's file");
  check("Enter sends to AI on the Home: the new line starts with an Ask", !/^## Note/m.test(topic(asked)));
  const lineBox = ".lp-dock .composer";
  check("on a line the box has the same one button and +", await text(`${lineBox} .send-btn span`) === "Send to AI" && await count(`${lineBox} .send-pick`) === 1 && await count(`${lineBox} .cmp-plus`) === 1 && await count(`${lineBox} .note-btn`) === 0);
  await page.click(`${lineBox} .cmp-input`);
  await page.keyboard.type("And the plums.");
  await page.keyboard.press("Enter");
  await until(() => /## Ask · [^\n]*\n\nAnd the plums\./.test(topic(asked)), "the second Ask on the line");
  check("Enter sends to AI on a line too", (topic(asked).match(/^## Ask/gm) || []).length === 2);
  await openLineAt("note-08");
  check("also on a line of notes, where Enter used to save a note", await text(`${lineBox} .send-btn span`) === "Send to AI");
  await page.click(`${lineBox} .send-pick`);
  check("the arrow offers Send to AI and Save as note", JSON.stringify(await texts("#menu button span")) === JSON.stringify(["Send to AI", "Save as note"]));
  await menuRow(/Save as note/).click();
  check("choosing Save as note makes the button say so", await text(`${lineBox} .send-btn span`) === "Save as note" && await page.evaluate(() => document.activeElement?.classList.contains("cmp-input")));
  await page.keyboard.type("Water the beds on Friday.");
  await page.keyboard.press("Enter");
  await until(() => /## Note · [^\n]*\n\nWater the beds on Friday\./.test(topic("note-08")), "the note in the line's file", 8000).catch(async () => console.log("      note not found:", await lineOnScreen(), "|", await text("#toast").catch(() => ""), "|", posts.slice(-3).map(p => `${p.path} ${p.body.slice(0, 160)}`).join(" || "), "|", topic("note-08").slice(-300)));
  check("Enter then saves a note, read by no agent", !/^## Ask/m.test(topic("note-08")));
  await until(async () => await text(`${lineBox} .send-btn span`) === "Send to AI", "the button to go back");
  check("and after that message the button is Send to AI again", true);
  await home();
  await page.click(`${box} .cmp-input`);
  await page.keyboard.type("Buy seeds");
  await page.click(`${box} .send-pick`);
  await menuRow(/Save as note/).click();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#linePage");
  const noted = await lineOnScreen();
  await until(() => /## Note · [^\n]*\n\nBuy seeds/.test(topic(noted)), "the note that starts a line");
  check("from the Home, Save as note starts a line with a note", !/^## Ask/m.test(topic(noted)));
  // Beside a Canvas the line's panel is this same page in a frame.
  const panel = await context.newPage();
  panel.on("pageerror", e => errors.push(`panel: ${e.message}`));
  await panel.goto(`${base}/projects.html?embed=panel&canvas=${encodeURIComponent("files/review-canvas/garden.penecho.json")}#${id}/line/note-10`);
  await panel.waitForSelector("#linePage .lp-dock .composer");
  check("beside a Canvas the box has the same one button and +", ((await panel.locator(".lp-dock .send-btn span").textContent()) || "").trim() === "Send to AI" && await panel.locator(".lp-dock .send-pick").count() === 1 && await panel.locator(".lp-dock .cmp-plus").count() === 1 && await panel.locator(".lp-dock .note-btn").count() === 0);
  await panel.click(".lp-dock .cmp-input");
  await panel.keyboard.type("Make the second bed wider.");
  await panel.keyboard.press("Enter");
  await until(() => /## Ask · [^\n]*\n\nMake the second bed wider\./.test(topic("note-10")), "the Ask from the panel");
  check("and Enter sends to AI there", true);
  await panel.close();
  // The rail beside a Canvas is this page too, and asks only for names and marks.
  const rail = await context.newPage(), railStates = [];
  rail.on("pageerror", e => errors.push(`rail: ${e.message}`));
  watchStates(rail, railStates);
  await rail.goto(`${base}/projects.html?embed=rail&canvas=${encodeURIComponent("files/review-canvas/garden.penecho.json")}#${id}/line/review-canvas`);
  await rail.waitForSelector("#railList .rail-line.on");
  check("the rail beside a Canvas asks for the state made for it, and still lists and marks the Canvas's line", railStates.length > 0 && railStates.every(v => v === "rail") && ((await rail.locator("#railList .rail-line.on .rail-title").textContent()) || "").trim() === "Draw the garden beds", [...new Set(railStates)].join(", "));
  await rail.close();
  await home();

  console.log("\nFewer accidents: Archive");
  check("no row of the home has an Archive button", await count('#pano [data-act="archive-line"]') === 0);
  await openLineAt("note-06");
  check("a line's title bar has no Archive button", await count('#linePage .lp-acts [data-act="archive-line"]') === 0 && await count("#linePage .lp-acts button:has-text('Archive')") === 0);
  await page.click('#linePage .lp-acts [data-act="line-menu"]');
  check("Archive is a row in its menu", await menuRow(/^Archive$/).count() === 1);
  await menuRow(/^Archive$/).click();
  await page.waitForSelector("#pano .hl-row");
  await wait(400);
  check("archiving from the line goes back to the home, and says Archived with Undo", await text("#toast span") === "Archived" && await text("#toastAct") === "Undo" && !(await rows()).includes("note-06"), await text("#toast"));
  await page.click("#toastAct");
  await until(async () => (await rows()).includes("note-06"), "the line to come back");
  check("Undo brings the line back", true);
  await menu("note-07", /^Archive$/);
  await until(async () => !(await rows()).includes("note-07"), "the line to leave");
  check("archiving from a row's menu takes the line off the home and says Archived with Undo", await text("#toast span") === "Archived" && await page.evaluate(() => window.__lines.project().landed.some(l => l.id === "note-07")), await text("#toast"));
  await page.click("#toastAct");
  await until(async () => (await rows()).includes("note-07"), "the line to come back");
  check("and Undo brings it back", await page.evaluate(() => !window.__lines.project().landed.some(l => l.id === "note-07")));

  console.log("\nFewer accidents: Move to");
  await page.reload();
  await page.waitForSelector("#pano .hl-row");
  await wait(300);
  const inRail = await page.evaluate(() => [...document.querySelectorAll("#railList .rail-row")].filter(r => r.dataset.p && !r.classList.contains("gone")).map(r => r.querySelector(".rail-name").textContent));
  const goneInRail = await count("#railList .rail-row.gone");
  await menu("note-09", /^Move to project/);
  await page.waitForSelector("#menu .menu-head");
  const offered = await page.evaluate(() => [...document.querySelectorAll("#menu button span")].map(s => s.textContent));
  check("Move to offers My Canvases and the projects in the sidebar, in its order", JSON.stringify(offered) === JSON.stringify(["My Canvases", ...inRail.filter(n => n !== "Field notes")]), `offered ${offered.join(", ")} · sidebar ${inRail.join(", ")}`);
  check("not an archived project, not one whose folder is gone, not one the sidebar no longer lists", !offered.includes("Put away") && !offered.includes("Gone away") && goneInRail === 1 && !offered.includes("Old one") && offered.includes("Second project"), offered.join(", "));
  await page.keyboard.press("Escape");

  console.log("\nA project with no lines");
  await home(bare.id);
  check("a new project shows the empty project page", await count(".empty-page") === 1 && await count("#pano") === 0);
  check("its box has the one button and the + too", await text(".empty-page .send-btn span") === "Send to AI" && await count(".empty-page .send-pick") === 1 && await count(".empty-page .cmp-plus") === 1);
  await home(one.id);
  check("a project with one line lists it", JSON.stringify(await rows()) === JSON.stringify(["only-line"]));
  await menu("only-line", /^Archive$/);
  await page.waitForSelector(".empty-page");
  check("when its last line is archived, the empty project page shows", await count("#pano") === 0 && await count(".trunk-label") === 0 && await count(".start-two .start-col") === 3 && /Start from the Canvas/.test(await text(".start-two")) && /Sync from code/.test(await text(".start-two")) && /write the first thing/i.test(await text(".start-two")));
  await page.evaluate(() => { document.querySelector(".empty-page").dataset.kept = "1"; });
  fs.mkdirSync(path.join(temp, "one", "files"), { recursive:true });
  fs.writeFileSync(path.join(temp, "one", "files", "list.txt"), "milk\n");
  await until(() => page.evaluate(() => __lines.project().files.some(f => f.path === "files/list.txt")), "the new file to be seen");
  await wait(300);
  check("the empty project page is not drawn again when something else in the folder changes", await page.evaluate(() => document.querySelector(".empty-page")?.dataset.kept === "1"));
  await page.click("#toastAct");
  await page.waitForSelector("#pano .hl-row");
  check("Undo brings back the line and its list", JSON.stringify(await rows()) === JSON.stringify(["only-line"]));
  await menu("only-line", /^Delete$/);
  await page.click(".line-command-dialog button[type=submit]");
  await page.waitForSelector(".empty-page");
  check("when its last line is deleted, the empty project page shows, though a file of its own is still in the folder", await count("#pano") === 0 && await count(".start-two .start-col") === 3);

  console.log("\nLight and dark, at three widths");
  const looks = async (width, height, mode) => {
    await page.setViewportSize({ width, height });
    await page.evaluate(m => linesTheme.set(m), mode);
    await home();
    await page.evaluate(() => { document.querySelector("#toast").hidden = true; document.querySelector("#memoryNote")?.setAttribute("hidden", ""); document.querySelector("#view").scrollTop = 0; });
    await page.mouse.move(width - 5, 5);
    await wait(200);
    const fit = await page.evaluate(() => { const view = document.querySelector("#view"), all = [...document.querySelectorAll("#panoRows .hl-row")], inside = (sel, box) => [...document.querySelectorAll(sel)].every(el => { const b = el.getBoundingClientRect(), o = el.closest(box).getBoundingClientRect(); return b.right <= o.right + 1 && b.left >= o.left - 1; });
      return { wide:view.scrollWidth - view.clientWidth, rows:all.length, cut:all.filter(r => { const t = r.querySelector(".hl-title").getBoundingClientRect(), b = r.getBoundingClientRect(); return t.width < 40 || t.right > b.right; }).length, pending:inside(".nu-row .btn, .nu-words, .hm-fold, .nu-more .btn", ".nu-box"), week:inside(".wk-grid", ".hm-week") && [...document.querySelectorAll(".wk-cloud .wk-w")].filter(w => w.offsetParent).every(w => { const b = w.getBoundingClientRect(), d = w.closest(".wk-day").getBoundingClientRect(); return b.left >= d.left - 1 && b.right <= d.right + 1; }), paper:getComputedStyle(document.querySelector(".nu-box")).backgroundColor, ink:getComputedStyle(document.querySelector(".hl-title .row-title-text")).color }; });
    check(`${width} wide, ${mode}: the page fits, the compact list and every title show`, fit.wide <= 0 && fit.rows > 30 && fit.cut === 0 && fit.pending && fit.week, JSON.stringify(fit));
    await page.screenshot({ path:path.join(shots, `10-home-${width}-${mode}.png`) });
    await page.evaluate(() => { const v = document.querySelector("#view"); v.scrollTop = document.querySelector("#pano").offsetTop - 8; });
    await page.click(`${row("stopped-01")} .hl-hit`);
    await wait(150);
    const opened = await page.evaluate(() => { const r = document.querySelector('.hl-row[data-row="stopped-01"]'), b = r.getBoundingClientRect(), view = document.querySelector("#view"); return { wide:view.scrollWidth - view.clientWidth, inside:[...r.querySelectorAll(".hl-track .dm, .hd-ask, .hd-result, .hd-acts > *")].every(s => s.getBoundingClientRect().right <= b.right + 1 && s.getBoundingClientRect().left >= b.left - 1) }; });
    check(`${width} wide, ${mode}: the lines fit, and an open row fits too`, opened.wide <= 0 && opened.inside, JSON.stringify(opened));
    await page.screenshot({ path:path.join(shots, `12-lines-${width}-${mode}.png`) });
    if (width === 390) {
      const phone = await page.evaluate(() => {
        // By time the trunk's gutter stands left of every lane and head: full width is the width beside it.
        const rows = [...document.querySelectorAll("#panoRows .hl-row")], head = document.querySelector("#panoRows .hl-day");
        const inner = el => { const cs = getComputedStyle(el); return el.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); };
        return { stacked:rows.every(r => { const name = r.querySelector(".hl-name").getBoundingClientRect(), track = r.querySelector(".hl-track").getBoundingClientRect(), lane = r.querySelector(".hl-lane"), state = r.querySelector(".hl-state").getBoundingClientRect(); return track.top >= name.bottom - 1 && track.width >= inner(lane) - 6 && state.top < track.top; }),
          head:Boolean(head.querySelector(".hl-day-name").textContent.trim()) && head.querySelectorAll(".hc-l").length > 0 && head.querySelector(".hl-clock").getBoundingClientRect().width >= inner(head) - 6 };
      });
      check(`${width} wide, ${mode}: a lane stacks, title and state on top and its track full width under them; the day's head keeps its name and hours`, phone.stacked && phone.head, JSON.stringify(phone));
    }
    await page.click(`${row("stopped-01")} .hl-hit`);
    return fit;
  };
  const light = await looks(1440, 900, "light"), dark = await looks(1440, 900, "dark");
  check("dark has its own paper and ink", light.paper === "rgb(255, 255, 255)" && dark.paper === "rgb(22, 28, 37)" && dark.ink === "rgb(230, 233, 239)", `${dark.paper} ${dark.ink}`);
  check("at 1440 Latest files sits beside the week and the lines", light.side < 2, `${light.side}px below the top`);
  const mid = await looks(1024, 768, "light"); await looks(1024, 768, "dark");
  check("on a narrower screen Latest files comes below the lines", mid.side > 400, `${mid.side}px below the top`);
  await looks(390, 844, "light"); await looks(390, 844, "dark");

  console.log("\nDay map: touch follows the same one-activation paths");
  const touchContext = await browser.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true });
  try {
    const touchPage = await touchContext.newPage();
    await touchPage.goto(`${base}/projects.html#${id}`);
    await touchPage.waitForSelector(`${row("stopped-01")} .hl-hit`);
    await touchPage.locator(`${row("stopped-01")} .hl-track`).scrollIntoViewIfNeeded();
    const track = await touchPage.locator(`${row("stopped-01")} .hl-track`).boundingBox();
    await touchPage.touchscreen.tap(track.x + track.width / 2, track.y + track.height / 2);
    check("one tap on a lane opens its Ask, result and actions in the list", await touchPage.locator(`${row("stopped-01")} .hl-detail`).count() === 1 && /Retry/.test(await touchPage.locator(`${row("stopped-01")} .hd-acts`).textContent()));
    await touchPage.locator(`${row("review-02")} .hl-main`).tap();
    await touchPage.waitForSelector("#linePage");
    check("one tap on a title opens its detail page", await touchPage.evaluate(() => __lines.S.route.line === "review-02"));
  } finally { await touchContext.close(); }
  // The whole page, top to bottom, to set beside the design.
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => linesTheme.set("light"));
    await home();
    await page.evaluate(() => { document.querySelector("#toast").hidden = true; document.body.style.overflow = "visible"; document.documentElement.style.height = "auto"; document.body.style.height = "auto"; document.querySelector("#app").style.height = "auto"; document.querySelector(".shell").style.height = "auto"; document.querySelector("#view").style.overflow = "visible"; document.querySelector(".rail").style.height = "100vh"; });
    await page.screenshot({ path:path.join(shots, `20-whole-page-${width}.png`), fullPage:true });
  }
  await page.setViewportSize({ width:1440, height:900 });
  await home();

  console.log("\nStatus filters: a large result, exclusive switching, new lines and legacy preferences");
  await home(filterProject.id);
  await page.click('.sum-review');
  check("a status result larger than 40 shows only matching rows and explains the cap", (await rows()).length === 40 && (await rows()).every(id => id.startsWith('review-')) && await text('#panoResults') === 'To review · 40 of 55 lines shown Show all 55');
  await page.click('#panoResults [data-act="rows-more"]');
  check("Show all reveals the remaining matching rows in one activation", (await rows()).length === 55 && (await rows()).every(id => id.startsWith('review-')) && await text('#panoResults') === 'To review · 55 lines');
  await shot('30-status-review');
  await page.click('.sum-done');
  check("switching from To review to Finished replaces the predicate", (await rows()).length === 3 && (await rows()).every(id => id.startsWith('done-')) && await count('.sum-f[aria-pressed="true"]') === 1 && await text('#panoResults') === 'Finished · 3 lines');
  await shot('31-status-finished');
  writeProject(filterDocs, [{ slug:'late-note', title:'A new note outside Finished', kind:'notes', made:40, last:30 }]);
  await until(() => page.evaluate(() => __lines.project().lines.some(l => l.id === 'late-note')), 'the new note to be read');
  check("a newly created nonmatching line cannot bypass Finished", !(await rows()).includes('late-note') && (await rows()).length === 3);
  writeProject(filterDocs, [{ slug:'late-done', title:'A new reviewed result', kind:'done', made:30, last:20, agent:'codex' }]);
  await until(() => rows().then(ids => ids.includes('late-done')), 'a new matching result to enter Finished');
  check("a newly completed matching line enters Finished and updates its count", (await rows()).length === 4 && await text('#panoResults') === 'Finished · 4 lines');
  writeProject(filterDocs, [{ slug:'late-done', title:'A result needing another review', kind:'review', made:30, last:20, agent:'codex' }]);
  await until(() => rows().then(ids => !ids.includes('late-done')), 'a changed result to leave Finished');
  check("a status change removes a line that no longer matches", (await rows()).length === 3);
  await page.click('.sum-all');
  check("All clears the selected type in one activation", await page.getAttribute('.sum-all', 'aria-pressed') === 'true' && (await rows()).includes('late-note'));
  for (const [old, expected] of [[{ done:true }, 'done'], [{ f:'review', done:true }, 'review']]) {
    await page.evaluate(({ id, old }) => { const key='penecho-lines-home-v1', choices=JSON.parse(localStorage.getItem(key)||'{}'); choices[id]=old; localStorage.setItem(key,JSON.stringify(choices)); }, { id:filterProject.id, old });
    await reload();
    check(`legacy ${JSON.stringify(old)} migrates to one ${expected} status`, await page.getAttribute(`.sum-f[data-f="${expected}"]`, 'aria-pressed') === 'true' && await count('.sum-f[aria-pressed="true"]') === 1 && await page.evaluate(id => !Object.hasOwn(JSON.parse(localStorage.getItem('penecho-lines-home-v1'))[id], 'done'), filterProject.id));
  }
  await page.click('.sum-all');

  console.log("\nSpeed: a project of 120 lines");
  await home(many.id);
  await page.waitForFunction(() => window.__lines.project().lines.length === 120, null, { timeout:30000 });
  await wait(800);
  const speed = await page.evaluate(async () => {
    const draws = [], looks = [], mid = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)], frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let i = 0; i < 12; i++) { const t = performance.now(); render(); void document.body.offsetHeight; draws.push(performance.now() - t); await frame(); }
    for (let i = 0; i < 12; i++) { const t = performance.now(); refreshAfterChange(); void document.body.offsetHeight; looks.push(performance.now() - t); await frame(); }
    return { draw:+mid(draws).toFixed(1), again:+mid(looks).toFixed(1), rows:document.querySelectorAll("#panoRows .hl-row").length, nodes:document.querySelector("#view").querySelectorAll("*").length };
  });
  console.log(`      Home drawn in ${speed.draw} ms, looked at again in ${speed.again} ms, ${speed.rows} rows, ${speed.nodes} elements`);
  check("the Home of 120 lines is drawn in under 60 ms", speed.draw < 60, `${speed.draw} ms`);
  check("and looked at again, with nothing changed, in under 12 ms", speed.again < 12, `${speed.again} ms`);

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
})().catch(error => { failures.push(error.message); console.log(`FAIL  ${error.stack || error.message}`); }).finally(() => {
  browser?.close().catch(() => {});
  server.kill();
  try { fs.rmSync(temp, { recursive:true, force:true }); } catch { /* Left for the system to clear. */ }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
});
