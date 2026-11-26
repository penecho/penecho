#!/usr/bin/env node
"use strict";
// Mark outdated (PE-425), in a real browser: in the line's ⋯ menu (no longer a button on the Finished row, PE-478), archiving it marked Outdated,
// Undo, the Archive and the line saying Outdated, the `…` menu on any line, and Back to lines taking the mark off.
//   NODE_PATH=/path/to/node_modules node scripts/verify-line-outdated.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-outdated-"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 6100 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`, docs = path.join(temp, "docs");
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

// Two finished lines about the login: the old one not yet reviewed, the newer one reviewed.
function writeLine(slug, n, title, reviewed) {
  fs.mkdirSync(path.join(docs, "lines", slug), { recursive:true });
  fs.writeFileSync(path.join(docs, "lines", `${slug}.md`), `---\nid: T-${n}\nstatus: ready\ncreated: 2026-11-10 09:00\nwho: @codex\nfinished: 2026-11-10 09:20\n---\n\n# ${title}\n\n## Ask · 2026-11-10 09:00\n\nPlease do this: ${title.toLowerCase()}.\n\n## [x] Work 1 · @codex · 6 min\n\n**Done.** ${title} is in place.\n\n[Details](${slug}/work-1.md)\n\n`);
  fs.writeFileSync(path.join(docs, "works", slug, "work-1.md"), `---\nline: ../${slug}.md\nstep: Work 1\nwho: @codex\nstarted: 2026-11-10 09:01\nended: 2026-11-10 09:07\ntook: 6 min\n${reviewed ? "reviewed: 2026-11-10 09:30\n" : ""}---\n\n# Work 1: ${title}\n\n## Result\n\nDone.\n`);
}
writeLine("old-login", 1, "Old login page", false);
writeLine("new-login", 2, "New login page", true);
const front = slug => { const m = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(docs, "lines", `${slug}.md`), "utf8")); return Object.fromEntries(m[1].split("\n").map(l => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()])); };
const topicText = slug => fs.readFileSync(path.join(docs, "lines", `${slug}.md`), "utf8");

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const post = async (address, data) => (await context.request.post(`${base}/api/lines${address}`, { data, headers:{ origin:base } })).json();
  const id = (await post("/projects", { name:"Login", docsPath:docs, offerSkill:false })).project.id;
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const openLine = async slug => { await page.goto(`${base}/projects.html#${id}/line/${slug}`); await page.waitForFunction(line => window.__lines?.S.route.line === line && document.querySelector("#linePage"), slug); await wait(500); };
  const toastText = () => page.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden ? t.textContent : ""; });
  const menuItems = () => page.$$eval("#menu [role=menuitem]", items => items.map(i => i.textContent.trim()));

  // ---------- In the line's ⋯ menu only; the Finished row keeps Mark all reviewed (PE-478) ----------
  await openLine("old-login");
  check("a finished line's last row has no Mark outdated button", await page.$(".lp-end .lp-outdated") === null && await page.$(".lp-end .lp-all-reviewed") !== null);
  await (await page.$(".lp-end")).screenshot({ path:path.join(shots, "1-end-row.png") });
  const markOutdated = async () => { await page.click('.lp-acts [data-act="line-menu"]'); await page.click('#menu [role=menuitem]:has-text("Mark outdated")'); };
  await page.click('.lp-acts [data-act="line-menu"]'); await page.waitForSelector("#menu");
  check("⋯ offers Mark outdated and says what it does", (await menuItems()).some(t => t.startsWith("Mark outdated") && t.includes("It goes to the Archive")), JSON.stringify(await menuItems()));
  await page.screenshot({ path:path.join(shots, "2-line-page.png") });
  await page.keyboard.press("Escape");

  // ---------- Click: archived, marked, home; Undo puts it back ----------
  await markOutdated();
  await until(async () => (await page.evaluate(() => window.__lines.S.route.view)) === "home", "the home");
  check("clicking it says so, with Undo", /Outdated and archived/.test(await toastText()) && /Undo/.test(await toastText()), await toastText());
  check("the line's file is archived and marked outdated", front("old-login").status === "closed" && front("old-login").outdated === "yes" && front("old-login")["before archive"] === "ready", JSON.stringify(front("old-login")));
  check("its status block tells anyone who opens it", /> \[!status\] Outdated and archived: no longer valid, or replaced by newer work/.test(topicText("old-login")));
  check("the home no longer shows it", !(await page.evaluate(() => window.__lines.project().lines.some(l => l.id === "old-login"))));
  await page.click("#toastAct");
  // The status block is written just after the front matter.
  await until(() => front("old-login").status === "ready" && !/Outdated/.test(topicText("old-login")), "Undo").catch(() => {});
  check("Undo brings it back as it was, with no mark", front("old-login").outdated === undefined && !/Outdated/.test(topicText("old-login")), topicText("old-login").slice(0, 400));

  // ---------- The Archive, and the line itself, say Outdated ----------
  await openLine("old-login");
  await markOutdated();
  await until(() => front("old-login").outdated === "yes", "the mark again");
  await page.evaluate(() => window.__lines.go({ view:"archive" }));
  await page.waitForSelector(".ar-row");
  const archived = await page.$$eval(".ar-row", rows => rows.map(r => ({ title:r.querySelector(".row-name")?.textContent, meta:r.querySelector(".ar-meta")?.textContent, outdated:r.classList.contains("is-outdated") })));
  check("the Archive says Outdated", archived.some(r => r.title === "Old login page" && r.meta === "Outdated" && r.outdated), JSON.stringify(archived));
  await page.screenshot({ path:path.join(shots, "3-archive.png") });
  await openLine("old-login");
  check("the line's own page says Outdated", (await page.$eval("#lpTitle + .lp-meta", el => el.textContent)).includes("Outdated"));
  check("and offers no Mark outdated again", !(await page.$(".lp-outdated")));
  await page.click('.lp-acts [data-act="line-menu"]'); await page.waitForSelector("#menu");
  check("nor in its menu", !(await menuItems()).some(t => t.startsWith("Mark outdated")), JSON.stringify(await menuItems()));
  await page.keyboard.press("Escape");
  await page.screenshot({ path:path.join(shots, "4-outdated-line.png") });
  await page.click('[data-act="reopen-line"]');
  await until(() => front("old-login").status === "ready", "Back to lines");
  check("Back to lines takes the mark off", front("old-login").outdated === undefined, JSON.stringify(front("old-login")));

  // ---------- The menu, on any line ----------
  await openLine("new-login");
  await page.click('.lp-acts [data-act="line-menu"]'); await page.waitForSelector("#menu");
  const items = await menuItems();
  check("the line's menu has Mark outdated, under Archive", items.findIndex(t => t.startsWith("Mark outdated")) === items.indexOf("Archive") + 1, JSON.stringify(items));
  await page.screenshot({ path:path.join(shots, "5-menu.png") });
  await page.click('#menu [role=menuitem]:has-text("Mark outdated")');
  await until(() => front("new-login").outdated === "yes", "the menu's Mark outdated");
  check("from the menu it is archived and marked too", front("new-login").status === "closed");

  check("no page errors", !errors.length, errors.join(" | "));
  await browser.close();
})().catch(error => { failures.push(error.message); console.log(`FAIL  ${error.stack}`); }).finally(() => {
  server.kill();
  console.log(`\n${passed} passed, ${failures.length} failed. Screenshots: ${shots}`);
  if (!failures.length) fs.rmSync(path.join(temp, "state"), { recursive:true, force:true });
  process.exitCode = failures.length ? 1 : 0;
});
