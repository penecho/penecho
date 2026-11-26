#!/usr/bin/env node
"use strict";
// A line's Topic (docs/design/one-penecho/NEXT-FEATURES.md, P4), in a real browser, on lines written by hand: the line's Topic in the
// right panel while no Work is open (PE-457, PE-459: counts, goal, what is left; no other lines, no Merge, no Similar lines, since merging
// lines is gone), a line merged before then still reading as it did, two Topics merged from the Topics page; dark mode and a phone.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-merge.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lines-merge-"));
const shots = process.argv[2] && !process.argv[2].startsWith("--") ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 6400 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "docs");
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 400)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) { let v; try { v = await fn(); } catch { v = false; } if (v) return v; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(80); }
}

// ---------- Lines written as PenEcho writes them ----------
const pad = n => String(n).padStart(2, "0");
const stamp = minutesAgo => { const d = new Date(Date.now() - minutesAgo * 60000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const front = fields => `---\n${Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n`;
fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
// steps: { ask, at } | { note, at } | { work, at, tags, open }
function line(slug, title, steps, fields = {}) {
  let body = "", n = 0;
  for (const s of steps) {
    if (s.ask) body += `## Ask · ${stamp(s.at)}\n\n${s.ask}\n\n`;
    else if (s.note) body += `## Note · ${stamp(s.at)}\n\n${s.note}\n\n`;
    else {
      n++;
      if (s.open) { body += `## [ ] Work ${n} · @tester\n\n`; continue; }
      body += `## [x] Work ${n} · @tester · 6 min\n\n${s.work}\n\n[Details](../works/${slug}/work-${n}.md)\n\n`;
      fs.mkdirSync(path.join(docs, "works", slug), { recursive:true });
      fs.writeFileSync(path.join(docs, "works", slug, `work-${n}.md`), front({ line:`../${slug}.md`, step:`Work ${n}`, who:"@tester", started:stamp(s.at), took:"6 min", tags:s.tags }) + `# Work ${n}: ${title}\n\n## Result\n\n<!-- result: the agent's last message -->\n${s.work}\n<!-- /result -->\n`);
    }
  }
  fs.writeFileSync(path.join(docs, "lines", `${slug}.md`), front({ id:slug.toUpperCase(), status:"done", who:"@tester", created:stamp(steps[0].at), ...fields }) + `# ${title}\n\n${body}`);
}
line("login-page", "Login page redesign", [{ ask:"Make the login page simpler.", at:300 }, { work:"The login form is simpler now.", at:299, tags:"login page, sign in form" }, { ask:"Add a remember me box.", at:200 }, { work:"Remember me is added.", at:199, tags:"login page, remember me" }]);
line("login-errors", "Login errors", [{ ask:"Show a clear message when the password is wrong.", at:250 }, { work:"A clear message shows now.", at:249, tags:"login page, error message" }, { note:"Check the wording with Ann.", at:150 }]);
line("sign-in-button", "Sign in button colour", [{ ask:"The sign in button should be blue.", at:120 }, { work:"It is blue now.", at:119, tags:"sign in form, login page" }], { branch:"feature/sign-in", status:"ready" });
line("login-help", "Login help link", [{ ask:"Add a help link under the login form.", at:40 }, { work:"The help link is there.", at:39, tags:"login page, help link" }, { ask:"Make the help link bigger.", at:20 }, { open:true, at:19 }], { status:"working" });
line("invoices", "Monthly invoices", [{ ask:"Send the invoices every month.", at:400 }, { work:"Invoices go out on the 1st.", at:399, tags:"invoices, billing" }]);
line("billing-emails", "Billing emails", [{ ask:"Email a receipt with each invoice.", at:380 }, { work:"Receipts are emailed.", at:379, tags:"billing, invoices" }]);
line("garden-plan", "Garden plan", [{ ask:"Plan the vegetable beds.", at:500 }, { work:"Four beds, planned.", at:499, tags:"vegetable beds" }]);
// A line merged before merging lines was removed: a step it took in says where it came from.
fs.writeFileSync(path.join(docs, "lines", "old-merge.md"), front({ id:"OLD-MERGE", status:"done", who:"@tester", created:stamp(600), "merged from":"old-gone" }) + `# Old merged line\n\n## Ask · ${stamp(600)}\n\nFirst words.\n\n## Ask · ${stamp(590)}\n\nWords from the other line.\n\n> From [Old gone line](old-gone.md)\n\n`);
line("loose-idea", "Loose idea", [{ ask:"Write down the idea about login page colours.", at:60 }, { work:"Written down.", at:59, tags:"login page, colours" }]);
// Three knowledge Topics, as agents write them (topics-guide.md): Login holds the four login lines, Billing the two billing lines, Garden
// the garden plan. The loose idea is in none.
const knowledgeTopic = (name, id, title, goal, slugs, left = []) => { fs.mkdirSync(path.join(docs, "topics"), { recursive:true }); fs.writeFileSync(path.join(docs, "topics", `${name}.md`), `---\nrecord_type: topic\nid: ${id}\ntitle: ${title}\nparent_id: null\n---\n\n# ${title}\n\n**${goal}**\n\n${left.length ? `## What is left, in order\n\n${left.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\n` : ""}## Lines\n\n| Line | What |\n| --- | --- |\n${slugs.map(s => `| [${s}](../lines/${s}.md) | x |`).join("\n")}\n`); };
knowledgeTopic("login", "topic-log1", "Login", "Signing in is quick and clear.", ["login-page", "login-errors", "sign-in-button", "login-help"], ["Check the [wording](../lines/login-errors.md) with Ann (R2).", "Ship the **new** form (R1, R3)."]);
knowledgeTopic("billing", "topic-bill1", "Billing", "Customers get their invoices and receipts on time.", ["invoices", "billing-emails"]);
knowledgeTopic("garden", "topic-gard1", "Garden", "The garden is planned a season ahead.", ["garden-plan"]);
// A line's file, in lines/ or, once archived (as a merged line is), in archive/lines/.
const topic = slug => { const here = path.join(docs, "lines", `${slug}.md`); return fs.readFileSync(fs.existsSync(here) ? here : path.join(docs, "archive", "lines", `${slug}.md`), "utf8"); };
const plain = md => md.replace(/<!-- status:[\s\S]*?<!-- \/status -->\n\n/, "");

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1600, height:900 } });
  const send = async (method, address, data) => (await context.request[method](`${base}/api/lines${address}`, { data, headers:{ origin:base } })).json();
  const id = (await send("post", "/projects/import", { docsPath:docs })).project.id;
  await send("patch", `/projects/${id}`, { offerSkill:false });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const requested = [];
  page.on("request", r => requested.push(r.url()));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const shot = name => page.screenshot({ path:path.join(shots, `${name}.png`) });
  const count = sel => page.locator(sel).count();
  const text = async sel => ((await page.locator(sel).first().textContent()) || "").replace(/\s+/g, " ").trim();
  const texts = async sel => (await page.locator(sel).allTextContents()).map(t => t.replace(/\s+/g, " ").trim());
  const home = async () => { await page.goto(`${base}/projects.html#${id}`); await page.waitForFunction(p => window.__lines?.S.cur === p && window.__lines.project() && document.querySelector("#panoRows .hl-row"), id); await wait(300); };
  const openLine = async slug => { await page.goto(`${base}/projects.html#${id}/line/${slug}`); await page.waitForFunction(l => window.__lines?.S.route.line === l && document.querySelector("#linePage"), slug); await wait(600); };

  console.log("\nThe line's Topic beside a line");
  await openLine("login-page");
  await page.waitForSelector("#lpPanel .sim-topic");
  check("with no Work open, the right panel shows the line's Topic by name", await text("#lpPanel .sim-topic h2") === "Login");
  check("with how many of its lines are open and done", /open/.test(await text("#lpPanel .sim-head .tp-n")));
  check("its goal under the name", await text("#lpPanel .sim-goal") === "Signing in is quick and clear.");
  check("what is left, from the Topic, in plain words", JSON.stringify(await texts("#lpPanel .sim-left li")) === JSON.stringify(["Check the wording with Ann.", "Ship the new form."]), (await texts("#lpPanel .sim-left li")).join(" | "));
  check("no other lines, no Merge and no Merge all", await count("#lpPanel .sim-card") === 0 && await count('#lpPanel [data-act="line-merge"], #lpPanel [data-act="merge-all"]') === 0 && !/Other lines|Merge/.test(await text("#lpPanel")));
  check("no Similar lines, and no Topic merge here (that is on the Topics page)", !/Similar lines/.test(await text("#lpPanel")) && await count('#lpPanel [data-act="topic-merge"]') === 0 && await count("#lpPanel .sim-tags") === 0);
  await shot("01-topic-panel");
  await page.click("#lpThread .lp-work >> nth=0");
  await page.waitForSelector("#lpPanel .lpp-head");
  check("opening a Work puts it in the panel instead", await count("#lpPanel .sim") === 0 && /Work 1/.test(await text("#lpPanel .lpp-title h2")));
  await page.click('#lpPanel [data-act="panel-close"]');
  await page.waitForSelector("#lpPanel .sim-topic");
  check("closing the Work brings the Topic back", await text("#lpPanel .sim-topic h2") === "Login");
  await openLine("loose-idea");
  await page.waitForSelector("#lpPanel .lpp-head");
  check("a line in no Topic shows no Similar lines: its latest Work opens", await count("#lpPanel .sim") === 0 && await count("#lpTopic .sim, #lpTopicSide .sim") === 0 && /Work 1/.test(await text("#lpPanel .lpp-title h2")));
  check("and the page never asks the server for similar lines", !requested.some(u => /\/related$/.test(u)), requested.filter(u => /related/.test(u)).join(" "));
  console.log("\nA line merged before merging lines was removed");
  await openLine("old-merge");
  const edge = await page.$eval('#lpThread [data-from="old-gone"]', el => [getComputedStyle(el).borderLeftWidth, el.title]);
  check("the step it took in is still edged in a colour, with where it came from on hover", edge[0] === "4px" && edge[1] === "From Old gone line", edge.join(" | "));
  check("and the old merge routes are refused, changing nothing", (await (await context.request.post(`${base}/api/lines/projects/${id}/topics/old-merge/merge/undo`, { data:{}, headers:{ origin:base } })).status()) === 410 && /^merged from: old-gone$/m.test(topic("old-merge")));

  console.log("\nDark mode and a phone");
  await page.evaluate(() => linesTheme.set("dark"));
  await wait(300);
  await openLine("login-page");
  await page.waitForSelector("#lpPanel .sim-topic");
  const darkName = await page.$eval("#lpPanel .sim-topic-name span", el => getComputedStyle(el).color);
  check("dark mode: the Topic's name is light on the dark panel", /2[0-9]{2}, 2[0-9]{2}/.test(darkName), darkName);
  await shot("07-dark-topic");
  await page.evaluate(() => linesTheme.set("light"));
  await page.setViewportSize({ width:390, height:844 });
  await openLine("login-page");
  await page.waitForSelector("#lpTopic .sim-topic");
  check("on a phone the Topic is under the line, not in a panel", await page.$eval("#lpPanel", el => el.hidden) && await count("#lpTopic .sim-left li") === 2);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll("#lpTopic .sim-topic")].every(c => c.getBoundingClientRect().right <= innerWidth + 1));
  check("and fits the width", fits);
  await page.locator("#lpTopic .sim-topic").scrollIntoViewIfNeeded();
  await shot("09-phone-topic");
  console.log("\nAnother line's Topic (PE-457)");
  await page.setViewportSize({ width:1600, height:900 });
  await openLine("invoices");
  await page.waitForSelector("#lpPanel .sim-topic");
  check("its Topic by name, with its goal, and no What is left when the Topic has none", await text("#lpPanel .sim-topic h2") === "Billing" && await text("#lpPanel .sim-goal") === "Customers get their invoices and receipts on time." && await count("#lpPanel .sim-left") === 0);
  check("no Work opens by itself while the Topic shows", await count("#lpPanel .lpp-head") === 0);
  await shot("11-topic-panel-billing");
  await page.click('#lpPanel .sim-topic-name');
  await until(async () => /Customers get their invoices/.test(await page.evaluate(() => document.body.innerText)) && await page.evaluate(() => /billing\.md/.test(location.hash + document.body.innerText)), "the Topic's file to open");
  check("the Topic's name opens its file", true);
  console.log("\nMerge two Topics, on the Topics page");
  await page.goto(`${base}/projects.html#${id}/topics/${encodeURIComponent("topics/billing.md")}`);
  await page.waitForSelector('.tpx-doc[data-doc="topics/billing.md"]');
  check("the chosen Topic's page has Merge, and only that one", await count('.tpx-hero [data-act="topic-merge"]') === 1 && await count('.tpx-hero [data-act="topic-merge"][data-topic="topics/billing.md"]') === 1);
  await page.click('.tpx-hero [data-act="topic-merge"]');
  await page.waitForSelector("#menu");
  check("Merge on a Topic offers the other Topics", JSON.stringify(await texts("#menu button span")) === JSON.stringify(["Garden", "Login"]) && /Merge into Billing/.test(await text("#menu .menu-head")));
  await page.click("#menu button >> nth=0");
  await page.waitForSelector("#lightbox .mg");
  check("the two Topics side by side: name, goal and lines", JSON.stringify(await texts("#lightbox .mg-col h3")) === JSON.stringify(["Billing", "Garden"]) && /planned a season ahead/.test(await text("#lightbox .mg-col:nth-child(2) .mg-goal"))
    && JSON.stringify(await texts("#lightbox .mg-col:nth-child(1) .mg-tline strong")) === JSON.stringify(["Billing emails", "Monthly invoices"]) && await count('#lightbox [data-act="topic-merge-accept"]') === 1);
  await shot("12-topics-side-by-side");
  await page.click('#lightbox [data-act="merge-cancel"]');
  const overlap = await page.$eval(".tpx-hero", w => { const b = w.querySelector(".sim-merge").getBoundingClientRect(), n = w.querySelector(".tp-n").getBoundingClientRect(); return !n.width || n.bottom <= b.top || n.top >= b.bottom || n.right <= b.left || n.left >= b.right; });
  check("and Merge does not cover the counts", overlap);
  await shot("13-topics-page");
  await page.click('.tpx-tree [data-act="tp-show"][data-topic="topics/garden.md"]');
  await page.waitForSelector('.tpx-doc[data-doc="topics/garden.md"]');
  await page.click('.tpx-hero [data-act="topic-merge"]');
  await page.waitForSelector("#menu");
  await page.click("#menu button");
  await page.waitForSelector("#lightbox .mg");
  await page.click('#lightbox [data-act="topic-merge-accept"]');
  await page.waitForFunction(() => window.__lines.S.route.view === "line");
  const job = await page.evaluate(() => window.__lines.lineById(window.__lines.project(), window.__lines.S.route.line));
  check("Accept merge opens a Topics line asking an agent to merge Billing into Garden", job?.job === "build-topics" && /Merge Billing into Garden/.test(job.title), JSON.stringify([job?.job, job?.title]));
  check("both Topics were copied aside first, for Recover", fs.readdirSync(path.join(docs, ".penecho", "topics-history")).some(d => fs.existsSync(path.join(docs, ".penecho", "topics-history", d, "topics", "billing.md"))));
  await shot("14-topic-merge-line");

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
})().catch(error => { failures.push(error.message); console.log(`FAIL  ${error.stack || error.message}`); }).finally(() => {
  server.kill();
  try { fs.rmSync(temp, { recursive:true, force:true }); } catch { /* Left for the system to clear. */ }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
});
