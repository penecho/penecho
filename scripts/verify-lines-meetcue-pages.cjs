#!/usr/bin/env node
"use strict";
// MeetCue inside the Lines pages, in a real browser: the row in the rail, the page signed out, not connected, connected,
// and with MeetCue not answering; one meeting's minutes; delete; Add to project; the meeting step on its line; Use in MeetCue.
// The app's own server runs from this checkout with real projects. Only PenEcho Cloud is a stand-in: the one the tests use
// (test/fake-cloud-lines.js), behind a small front that also answers the sign-in the local server makes. So every request
// the page sends reaches the real server, and the server's own MeetCue code talks to the stand-in.
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/verify-lines-meetcue-pages.cjs
// A screenshot of each state, at 1440 and 900 wide, is left in a temporary folder named at the end.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { fakeCloud } = require("../test/fake-cloud-lines.js");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-meetcue-pages-"));
const shots = path.join(temp, "shots"); fs.mkdirSync(shots);
const PORT = 5400 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
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

// The stand-in Cloud. `linked` and `down` are what this script turns: an account with no MeetCue, and MeetCue not answering.
async function standInCloud() {
  const cloud = await fakeCloud(), front = { cloud, linked:false, down:false, asked:[] };
  const account = { id:"acct-1", name:"Ann Lee", credits:1500 };
  const json = (res, status, body) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", c => chunks.push(c)).on("end", async () => {
      const url = new URL(req.url, "http://x"), body = Buffer.concat(chunks);
      front.asked.push(`${req.method} ${url.pathname}`);
      if (url.pathname === "/api/v1/local-access/session") {
        if (req.method === "GET" && req.headers.authorization !== "Bearer account-token") return json(res, 401, { error:"invalid_local_session", message:"Sign in." });
        return json(res, 200, { accessToken:"account-token", expiresAt:Date.now() + 86400000, account });
      }
      if (url.pathname.startsWith("/api/v1/meetcue")) {
        if (front.down) return json(res, 502, { error:"meetcue_unreachable", message:"MeetCue did not answer." });
        if (req.method === "DELETE" && url.pathname === "/api/v1/meetcue/link") {
          if (!front.linked) return json(res, 404, { error:"not_linked", message:"This account has no MeetCue link." });
          front.linked = false;
          return json(res, 200, { linked:false, meetcueNotified:true });
        }
        if (!front.linked) return url.pathname === "/api/v1/meetcue" ? json(res, 200, { available:true, linked:false }) : json(res, 404, { error:"not_linked", message:"This account has no MeetCue link." });
      }
      try {
        const answer = await fetch(`${cloud.origin}${url.pathname}${url.search}`, { method:req.method, headers:Object.fromEntries(Object.entries(req.headers).filter(([k]) => ["authorization", "content-type", "accept"].includes(k))), body:["GET", "HEAD"].includes(req.method) ? undefined : body });
        res.writeHead(answer.status, { "content-type":answer.headers.get("content-type") || "application/json" });
        res.end(Buffer.from(await answer.arrayBuffer()));
      } catch { res.writeHead(502); res.end(); }
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  front.origin = `http://127.0.0.1:${server.address().port}`;
  front.close = async () => { server.close(); await cloud.close(); };
  return front;
}

(async () => {
  const front = await standInCloud(), cloud = front.cloud;
  // Three meetings, newest first. The stand-in already has m-1 (Supplier call: two actions, minutes with a Decisions section).
  const first = cloud.meetings.get("m-1"); cloud.meetings.clear();
  cloud.meetings.set("m-2", { meeting:{ id:"m-2", title:"Weather app: weekly sync", status:"ended", started_at:"2026-11-10T14:00:00.000Z", ended_at:"2026-11-10T15:05:00.000Z", duration_ms:3900000, minutes_ready:true, action_count:1, gist:"The forecast cards ship this week." },
    markdown:"# Weather app: weekly sync\n\nThe forecast cards ship this week.\n\n## Actions\n\n- Write the release note\n", actions:[{ task:"Write the release note" }] });
  // MeetCue's map comes with it: two topics with boxes, drawn as two pictures on the meeting's card.
  cloud.meetings.set("m-1", { ...first, diagrams:[
    { topic:"Price", status:"done", sofar:["$10.50 agreed"], ahead:["Volume discount?"], nodes:[{ id:"n1", label:"Acme", kind:"org", note:"" }, { id:"n2", label:"Unit price", kind:"metric", note:"$10.50" }], edges:[{ from:"n1", to:"n2", label:"sets" }] },
    { topic:"Delivery", status:"upcoming", sofar:[], ahead:[], nodes:[{ id:"n3", label:"Truck", kind:"system", note:"Tuesdays" }, { id:"n1", label:"Acme", kind:"org", note:"" }], edges:[{ from:"n1", to:"n3", label:"sends" }] },
  ] });
  cloud.meetings.set("m-3", { meeting:{ id:"m-3", title:"Study group: exam plan", status:"ended", started_at:"2026-11-03T09:00:00.000Z", ended_at:"2026-11-03T09:25:00.000Z", duration_ms:1500000, minutes_ready:true, action_count:0, gist:"We split chapters 1 to 4 between us." },
    markdown:"# Study group: exam plan\n\nWe split chapters 1 to 4 between us and meet again on 14 November.\n", actions:[] });

  const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PENECHO_CLOUD_ORIGIN:front.origin, PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
  let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });
  let browser;
  const stop = async () => { await browser?.close().catch(() => {}); server.kill(); await front.close().catch(() => {}); };
  try {
    await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
    const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
    const post = async (route, data) => { const r = await context.request.post(`${base}${route}`, { data, headers:{ origin:base } }); return { status:r.status(), body:await r.json().catch(() => ({})) }; };
    const supplies = (await post("/api/lines/projects", { name:"Supplies", docsPath:path.join(temp, "docs", "Supplies") })).body.project;
    const weather = (await post("/api/lines/projects", { name:"Weather app", docsPath:path.join(temp, "docs", "Weather app") })).body.project;
    // A finished line, which Use in MeetCue sends with the memory.
    fs.writeFileSync(path.join(temp, "docs", "Supplies", "lines", "price-list.md"), "---\nid: SU-9\nstatus: done\n---\n\n# Price list\n\n## Ask · 2026-11-08 09:00\n\nMake the price list.\n");

    const page = await context.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const popups = []; context.on("page", p => { if (p !== page) { popups.push(p.url()); p.close().catch(() => {}); } });
    const sent = []; page.on("request", r => { if (r.method() !== "GET" && /\/api\/lines\//.test(r.url())) sent.push({ method:r.method(), path:new URL(r.url()).pathname, body:r.postData() || "" }); });
    const text = sel => page.locator(sel).first().innerText().catch(() => "");
    const toastText = () => page.locator("#toast:not([hidden])").innerText().catch(() => "");
    const shot = async name => {
      await page.screenshot({ path:path.join(shots, `${name}-1440.png`) });
      // A menu closes when the window is resized; keep it open for the next step.
      if (await page.locator("#menu").count()) return;
      await page.setViewportSize({ width:900, height:900 }); await wait(250);
      await page.screenshot({ path:path.join(shots, `${name}-900.png`) });
      await page.setViewportSize({ width:1440, height:900 }); await wait(250);
    };
    const noBox = async () => !(await page.locator("dialog[open], .command-error:not([hidden])").count());

    console.log("\nSigned out");
    await page.goto(`${base}/projects.html#${supplies.id}`);
    await page.waitForSelector("#railMine .rail-meetcue");
    check("the rail has a MeetCue row immediately below My Canvases, above the projects", await page.evaluate(() => {
      const mine = document.querySelector("#railMine"), myRow = mine.querySelector(".rail-mine"), mcRow = mine.querySelector(".rail-meetcue");
      return Boolean(myRow && mcRow) && myRow.nextElementSibling === mcRow && mcRow.nextElementSibling?.classList.contains("rail-rule") && document.querySelectorAll("#railList .rail-row[data-p]").length === 2;
    }));
    check("the row carries MeetCue's official logo image", await page.evaluate(() => {
      const g = document.querySelector(".rail-meetcue img.mglyph");
      return Boolean(g) && /meetcue-icon\.png$/.test(g.getAttribute("src") || "") && g.complete && g.naturalWidth > 0;
    }));
    check("a project offers nothing of MeetCue's with no account", !(await page.locator('[data-act="use-in-meetcue"]').count()));
    await page.click(".rail-meetcue .rail-row");
    await page.waitForSelector(".mc-connect");
    check("signed out, the page introduces PenEcho MeetCue", /PenEcho MeetCue/i.test(await text(".mc-connect")) && /See your meeting as a live map/.test(await text(".mc-connect h1")) && await page.locator(".mc-features li").count() === 3 && page.url().endsWith("#meetcue"));
    check("its button signs in", (await text(".mc-connect .btn.primary")) === "Sign in to connect");
    check("the App Store and Google Play links are shown", await page.locator('.mc-connect a.btn[href="https://apps.apple.com/app/id6822044727"]').count() === 1 && await page.locator('.mc-connect a.btn[href="https://play.google.com/store/apps/details?id=ai.penecho.meeting"]').count() === 1);
    check("the card links to MeetCue's page on penecho.ai", await page.locator('.mc-connect a.mc-site[href="https://penecho.ai/meetcue.html"][target="_blank"]').count() === 1);
    check("example meetings are shown when signed out so users can explore MeetCue", await page.locator(".mc-examples .mc-row.is-example").count() === 2);
    check("nothing says anything went wrong", await noBox() && !(await toastText()) && !(await page.locator(".mc-line").count()));
    check("the row is lit while its page is open", await page.locator('.rail-meetcue .rail-row.on[aria-current="page"]').count() === 1);
    await shot("1-signed-out");
    await page.click('.mc-examples .mc-row [data-m="example-launch-sync"].shelf-open');
    await page.waitForSelector(".mc-hero .mc-hero-desc");
    check("clicking an example opens the redesigned detail page with title, description, whole map and topic maps", (await text(".mc-hero h1")) === "Product launch & Q4 pricing sync" && /Pro and Team pricing tiers/.test(await text(".mc-hero-desc")) && await page.locator(".mc-diagram-card.is-whole").count() === 1 && await page.locator(".mc-diagram-list .mc-diagram-card").count() === 3 && await page.locator(".mc-actions-card li").count() === 3);
    await shot("1b-example-detail");
    await page.click('[data-act="open-meetcue"].mc-back');
    await page.waitForSelector(".mc-connect");
    await page.click('.mc-connect [data-act="meetcue-sign-in"]');
    await until(() => popups.length === 1, "the sign-in page to open");
    check("Sign in to connect is the rail's sign-in: it opens PenEcho Cloud's sign-in", sent.some(r => r.method === "POST" && r.path === "/api/lines/cloud/sign-in") && popups[0].startsWith(`${front.origin}/dashboard.html?local_callback=`), popups[0]);

    console.log("\nSigned in, MeetCue not connected");
    // What the browser sign-in ends with: the local server takes its session from Cloud.
    const signed = await post("/api/cloud/sign-in", { origin:front.origin, code:"local-sign-in-code-0123456789abcdef" });
    check("the local server signs in to the stand-in Cloud", signed.status === 200 && signed.body.accountSession?.signedIn === true, JSON.stringify(signed.body).slice(0, 300));
    await page.waitForSelector('.mc-connect [data-act="meetcue-connect"]', { timeout:15000 });
    check("the page notices, and its button is now Connect MeetCue", (await text(".mc-connect .btn.primary")) === "Connect MeetCue" && await page.locator(".mc-connect a.btn").count() === 2);
    await wait(3800);
    await shot("2-not-connected");
    await page.click('.mc-connect [data-act="meetcue-connect"]');
    await until(() => popups.length === 2, "the dashboard to open");
    check("Connect MeetCue opens the account's dashboard at #meetcue", popups[1] === `${front.origin}/dashboard.html#meetcue`, popups[1]);

    console.log("\nConnected");
    front.linked = true;
    await page.waitForSelector(".mc-list .mc-row", { timeout:15000 });
    check("once MeetCue is connected on penecho.ai the page shows the meetings by itself", /MeetCue is connected/.test(await toastText()));
    const rows = await page.locator(".mc-row").evaluateAll(list => list.map(r => ({ title:r.querySelector("strong").textContent, facts:r.querySelector("small").textContent, add:r.querySelector(".mc-add span")?.textContent || "" })));
    check("three meetings, newest first", rows.map(r => r.title).join("|") === "Weather app: weekly sync|Supplier call|Study group: exam plan", JSON.stringify(rows));
    check("each says its date, length and number of actions", /^\d{1,2} Nov · 1 h 5 min · 1 action$|^Nov \d{1,2} · 1 h 5 min · 1 action$/.test(rows[0].facts) && / · 30 min · 2 actions$/.test(rows[1].facts) && / · 25 min$/.test(rows[2].facts), JSON.stringify(rows.map(r => r.facts)));
    check("each has Add to project", rows.every(r => r.add === "Add to project"));
    await wait(3800);
    await shot("3-connected");

    console.log("\nMeetCue not answering");
    front.down = true;
    await page.click(".rail-meetcue .rail-row");
    await page.waitForSelector('.mc-line [data-act="meetcue-retry"]');
    check("the list's place says so in one line, with Try again", /^MeetCue is not answering\.\s*Try again$/.test((await text(".mc-line")).replace(/\n/g, " ")) && !(await page.locator(".mc-row").count()), await text(".mc-line"));
    check("no error box, and no toast that stays", await noBox() && !(await toastText()));
    await shot("4-not-answering");
    front.down = false;
    await page.click('[data-act="meetcue-retry"]');
    await page.waitForSelector(".mc-list .mc-row");
    check("Try again brings the meetings back", await page.locator(".mc-row").count() === 3);

    console.log("\nOne meeting");
    await page.click('.mc-row [data-m="m-1"].shelf-open');
    await page.waitForSelector(".mc-minutes");
    check("it has its own address", page.url().endsWith("#meetcue/m-1"));
    check("its title, description, date and length are at the top", (await text(".mc-hero h1")) === "Supplier call" && /Prices agreed for next year\./.test(await text(".mc-hero-desc")) && / · 30 min · 2 actions/.test(await text(".mc-facts")), await text(".mc-facts"));
    check("the minutes are rendered Markdown, without a second title", (await text(".mc-minutes .md-h2")) === "Decisions" && /Prices agreed\./.test(await text(".mc-minutes .md-list li")) && !(await page.locator(".mc-minutes .md-title").count()));
    check("the meeting detail page shows whole meeting map AND split topic diagrams with switcher", await page.locator(".mc-diagram-card.is-whole").count() === 1 && await page.locator(".mc-diagram-list .mc-diagram-card").count() === 2 && (await page.locator(".mc-diagram-list .mc-diagram-head strong").allInnerTexts()).join("|") === "Price|Delivery" && await page.locator(".mc-seg button").count() === 3 && /\$10\.50 agreed/.test(await text(".mc-diagrams")));
    await page.click('.mc-seg button[data-view="whole"]');
    check("Whole map filter shows only the full meeting map", await page.locator(".mc-diagram-card.is-whole").count() === 1 && await page.locator(".mc-diagram-list .mc-diagram-card").count() === 0);
    await page.click('.mc-seg button[data-view="all"]');
    check("with Add to project and a delete button", await page.locator(".mc-bar .mc-add").count() === 1 && await page.locator(".mc-bar .mc-delete").count() === 1);
    await shot("5-one-meeting");
    front.down = true;
    await page.goto(`${base}/projects.html#meetcue/m-2`);
    await page.waitForSelector('.mc-sheet [data-act="meetcue-retry"]');
    check("a meeting that cannot be read says so in one line", /MeetCue is not answering\./.test(await text(".mc-sheet .mc-line")) && await noBox());
    front.down = false;
    await page.click('[data-act="meetcue-retry"]');
    await page.waitForSelector(".mc-minutes");
    check("and Try again reads it", (await text(".mc-sheet h1")) === "Weather app: weekly sync");

    console.log("\nDelete");
    await page.click('[data-act="open-meetcue"].mc-back');
    await page.waitForSelector(".mc-list");
    await page.click('.mc-row [data-m="m-3"].shelf-open');
    await page.waitForSelector(".mc-minutes");
    await page.click(".mc-delete");
    await page.waitForSelector("dialog[open]");
    check("delete asks first, and says it deletes the meeting in MeetCue", /Delete meeting\?/.test(await text("dialog[open] h2")) && /Study group: exam plan will be deleted in MeetCue/.test(await text("dialog[open] p")) && cloud.meetings.has("m-3") && !sent.some(r => r.method === "DELETE"));
    await shot("6-delete-asks");
    await page.click("dialog[open] [data-cancel]");
    check("Cancel deletes nothing", !(await page.locator("dialog[open]").count()) && cloud.meetings.has("m-3"));
    await page.click(".mc-delete");
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForSelector(".mc-list");
    await until(async () => await page.locator(".mc-row").count() === 2, "the list without it");
    check("Delete meeting deletes it in MeetCue and goes back to the list", !cloud.meetings.has("m-3") && sent.some(r => r.method === "DELETE" && r.path === "/api/lines/meetcue/meetings/m-3") && /Meeting deleted/.test(await toastText()) && page.url().endsWith("#meetcue"));

    check("the meetings page links to MeetCue's page on penecho.ai and offers Disconnect", await page.locator('.mc-head a.mc-site[href="https://penecho.ai/meetcue.html"]').count() === 1 && await page.locator('.mc-head [data-act="meetcue-disconnect"]').count() === 1);

    console.log("\nAdd to project");
    await page.click('.mc-row .mc-add[data-m="m-1"]');
    await page.waitForSelector("#menu");
    check("the menu lists the projects on this computer", (await page.locator("#menu button").allInnerTexts()).map(t => t.trim()).sort().join("|") === "Supplies|Weather app" && /Add as a line in/.test(await text("#menu .menu-head")));
    await shot("7-add-menu");
    const before = sent.length;
    await page.locator("#menu button", { hasText:"Supplies" }).click();
    await page.waitForSelector(".lp-meeting");
    const add = sent.slice(before).find(r => r.path === `/api/lines/projects/${supplies.id}/meetings`);
    check("choosing one asks the server to add that meeting to that project", add?.method === "POST" && JSON.parse(add.body).meetingId === "m-1", JSON.stringify(sent.slice(before)));
    check("then opens the new line", page.url().endsWith(`#${supplies.id}/line/supplier-call`) && /Supplier call/.test(await text("#linePage h1, .lp-title")), page.url());
    const topic = path.join(temp, "docs", "Supplies", "lines", "supplier-call.md");
    check("the real server made the line: the meeting, its minutes beside it, two Asks not sent", /^meeting: m-1$/m.test(fs.readFileSync(topic, "utf8")) && (fs.readFileSync(topic, "utf8").match(/^## Ask · .* · Not sent$/gm) || []).length === 2 && fs.existsSync(path.join(temp, "docs", "Supplies", "files", "supplier-call", "minutes.md")));
    check("the line shows a meeting step: the title line and the gist on a card", (await text(".lp-meeting h4 strong")) === "Supplier call" && / · 30 min$/.test(await text(".lp-meeting h4")) && /Prices agreed for next year\./.test(await text(".lp-meeting .lp-note-words")), await text(".lp-meeting"));
    check("above it, MeetCue's official mark and Meeting", /Meeting/.test(await text(".lp-kl.k-meeting")) && await page.evaluate(() => { const mark = getComputedStyle(document.querySelector(".lp-kl.k-meeting .mk")); return /meetcue-icon\.png/.test(mark.backgroundImage) && mark.width === "18px"; }));
    check("the actions are Asks that are not sent", await page.locator(".lp-ask.is-unsent").count() === 2 && /Send the quote \(Dana, by Friday\)/.test(await text(".lp-ask.is-unsent")), `${await page.locator(".lp-ask").count()} asks`);
    await until(() => page.evaluate(() => { const imgs = [...document.querySelectorAll(".lp-meeting .lp-mc-pics img")]; return imgs.length === 3 && imgs.every(img => img.complete && img.naturalWidth > 100); }), "the meeting's whole + two topic diagrams on its card");
    check("MeetCue's diagrams (whole + per-topic) are on the meeting's card, each a picture with Edit on canvas", (await page.locator(".lp-meeting .lp-mc-pics .lp-draw-foot strong").allInnerTexts()).join("|") === "Full meeting map|Price|Delivery" && await page.locator('.lp-meeting .lp-mc-pics [data-act="open-canvas"]').count() === 3 && await page.evaluate(() => [...document.querySelectorAll(".lp-meeting .lp-mc-pics img")].every(img => img.complete && img.naturalWidth > 100)));
    check("the meeting is not Work to review", !(await page.locator(".lp-work").count()) && !/To review/.test(await text("#linePage")));
    await wait(400);
    await shot("8-line-with-meeting");
    await page.click('.lp-meeting [data-act="open-doc"]');
    await page.waitForSelector(".reader");
    check("Open the minutes opens the copy kept beside the line", /Decisions/.test(await text(".reader")) && page.url().includes("/doc/"), page.url());
    await shot("9-minutes-on-the-line");
    await page.goto(`${base}/projects.html#${supplies.id}`);
    // On its lane the meeting is a violet mark, before the two Asks not sent.
    await page.waitForSelector('.hl-row[data-row="supplier-call"] .dm-meeting', { state:"attached" });
    check("on the project's home the meeting is a violet stop", await page.evaluate(() => getComputedStyle(document.querySelector('.hl-row[data-row="supplier-call"] .dm-meeting .nd'), "::before").backgroundColor === "rgb(106, 92, 246)") && /Supplier call/.test(await text('.hl-row[data-row="supplier-call"] .hl-title')) && await page.locator('.hl-row[data-row="supplier-call"] .dm-unsent').count() === 2);
    await shot("10-project-home");

    console.log("\nThe same meeting again and cross-project links");
    await page.click(".rail-meetcue .rail-row");
    await page.waitForSelector(".mc-list");
    check("the meeting row shows its link in Supplies and keeps Add to project", /Supplies · Supplier call/.test(await text(`.mc-row:has([data-m="m-1"]) .mc-link-chip`)) && await page.locator('.mc-row .mc-add[data-m="m-1"]').count() === 1, await text(`.mc-row:has([data-m="m-1"])`));
    await shot("11-on-a-line");
    const again = sent.length;
    await page.click(`.mc-link-chip[data-p="${supplies.id}"][data-slug="supplier-call"]`);
    await page.waitForSelector(".lp-meeting");
    check("clicking the link opens that line instead of adding it", page.url().endsWith(`#${supplies.id}/line/supplier-call`) && !sent.slice(again).some(r => /\/meetings$/.test(r.path)));
    // Another browser visit with cleared localStorage still gets links from the server.
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${base}/projects.html#meetcue`);
    await page.reload();
    await page.waitForSelector(`.mc-link-chip[data-p="${supplies.id}"][data-slug="supplier-call"]`);
    const mtime = fs.statSync(topic).mtimeMs, third = sent.length;
    await page.click('.mc-row .mc-add[data-m="m-1"]');
    await page.waitForSelector("#menu");
    check("Add to project marks Supplies as already linked", await page.locator('#menu button.on', { hasText:"Supplies" }).count() === 1);
    await page.locator("#menu button", { hasText:"Supplies" }).click();
    await page.waitForSelector(".lp-meeting");
    const readd = sent.slice(third).find(r => /\/meetings$/.test(r.path));
    check("picking Supplies again opens its line and writes nothing", Boolean(readd) && page.url().endsWith(`#${supplies.id}/line/supplier-call`) && fs.statSync(topic).mtimeMs === mtime && fs.readdirSync(path.dirname(topic)).filter(f => /^supplier-call/.test(f)).length === 1);
    await page.click(".rail-meetcue .rail-row");
    await page.waitForSelector('.mc-row .mc-add[data-m="m-1"]');
    // Add the same meeting to Weather app too -> both projects appear on list and detail page.
    await page.click('.mc-row .mc-add[data-m="m-1"]');
    await page.locator("#menu button", { hasText:"Weather app" }).click();
    await page.waitForSelector(".lp-meeting");
    check("the same meeting in Weather app becomes another line", page.url().includes(`#${weather.id}/line/`) && await page.locator(".lp-ask.is-unsent").count() === 2 && /Added to Weather app/.test(await toastText()));
    await page.click(".rail-meetcue .rail-row");
    await page.waitForSelector(".mc-list");
    check("MeetCue shows links from both Supplies and Weather app", await page.locator(`.mc-row:has([data-m="m-1"]) .mc-link-chip`).count() === 2 && /Supplies/.test(await text(`.mc-row:has([data-m="m-1"])`)) && /Weather app/.test(await text(`.mc-row:has([data-m="m-1"])`)));
    await page.click('.mc-row [data-m="m-1"].shelf-open');
    await page.waitForSelector(".mc-hero-links .mc-link-chip");
    check("the meeting detail page lists Linked lines across projects in the hero card", await page.locator(".mc-hero-links .mc-link-chip").count() === 2 && /Linked lines/i.test(await text(".mc-hero-links-label")));
    await shot("11b-meeting-cross-project-links");

    console.log("\nAdd meeting as a node on an existing line & click to see details");
    await page.goto(`${base}/projects.html#${supplies.id}/line/price-list`);
    await page.waitForSelector('.lp-dock .cmp-chip[data-act="make-meetcue"]');
    await page.click('.lp-dock .cmp-chip[data-act="make-meetcue"]');
    await page.waitForSelector(".lp-dock .cmp-mc-row");
    check("MeetCue in the box lists the meetings", await page.locator(".lp-dock .cmp-mc-row").count() >= 2);
    await page.locator(".lp-dock .cmp-mc-row", { hasText:"Weather app: weekly sync" }).click();
    await page.waitForSelector(".lp-meeting");
    await page.waitForSelector("#lppMeeting .mc-minutes");
    check("adding a meeting adds a node, opens #lpPanel with minutes and MeetCue link", /Weather app: weekly sync/.test(await text("#lppHead h2")) && /The forecast cards ship this week/.test(await text("#lppMeeting")) && /Write the release note/.test(await text("#lppMeeting")) && await page.locator('#lppMeeting [data-act="open-meeting"][data-m="m-2"]').count() === 1);
    const priceTopic = fs.readFileSync(path.join(temp, "docs", "Supplies", "lines", "price-list.md"), "utf8");
    check("the line kept its own status and added the meeting node", /^status: done$/m.test(priceTopic) && !/^meeting:/m.test(priceTopic) && /<!-- penecho-meeting: m-2 -->/.test(priceTopic) && fs.existsSync(path.join(temp, "docs", "Supplies", "files", "price-list", "minutes.md")));
    await shot("11c-line-meeting-panel");
    await page.click('#lppHead [data-act="panel-close"]');
    check("panel closes on close click", await page.locator("#lpPanel").isHidden());
    await page.click(".lps.k-meeting");
    await page.waitForSelector("#lppMeeting .mc-minutes");
    check("clicking the meeting stop in the rail opens its detail panel again", /Weather app: weekly sync/.test(await text("#lppHead h2")));
    await page.click('#lppMeeting [data-act="open-meeting"][data-m="m-2"]');
    await page.waitForSelector(".mc-hero-links .mc-link-chip");
    check("Open in MeetCue goes to that meeting page showing the line link", page.url().endsWith("#meetcue/m-2") && /Supplies[\s\S]*Price list/.test(await text(".mc-hero-links")));
    await page.click(`.mc-hero-links .mc-link-chip[data-p="${supplies.id}"][data-slug="price-list"]`);
    await page.waitForSelector("#lppMeeting .mc-minutes");
    check("clicking the linked-line chip goes straight back to that meeting node and opens details", page.url().includes(`#${supplies.id}/line/price-list/`) && /Weather app: weekly sync/.test(await text("#lppHead h2")));
    await page.click('#lppHead [data-act="panel-close"]');
    await page.waitForSelector("#lpPanel", { state: "hidden" });
    // The box's MeetCue chip on the line marks the meeting already on it
    await page.click('.lp-dock .composer .cmp-chip[data-act="make-meetcue"]');
    await page.waitForSelector(".lp-dock .cmp-mc-row");
    check("the box's MeetCue chip marks the meeting already on this line", await page.locator(".lp-dock .cmp-mc-row.on", { hasText:"Weather app: weekly sync" }).count() === 1 && /On this line/.test(await text(".lp-dock .cmp-mc-row.on")));
    await shot("11d-box-meetcue");
    await page.click('.lp-dock .cmp-mc [data-act="make-close"]');
    // Removing and Undoing the meeting node on the line
    await page.hover(".lp-meeting");
    await page.click('.lp-meeting [data-act="yours-drop"]');
    await until(async () => !(await page.locator(".lp-meeting").count()) && /Meeting removed/.test(await toastText()), "the meeting node to leave and toast Undo");
    await page.click("#toast button");
    await page.waitForSelector(".lp-meeting");
    check("Undo brings the meeting node back", await page.locator(".lp-meeting").count() === 1);

    console.log("\nUse in MeetCue");
    // Use in MeetCue is in the project's menu in the sidebar (and no longer a separate MeetCue row in Project settings).
    await page.goto(`${base}/projects.html#${supplies.id}/settings`);
    await page.waitForSelector(".settings-page");
    check("Project settings no longer shows a MeetCue row", await page.locator('.settings-page [aria-label="MeetCue"]').count() === 0 && await page.locator('.settings-page [data-act="use-in-meetcue"]').count() === 0);
    await page.click(`.rail-row[data-p="${supplies.id}"]`, { button:"right" });
    await page.waitForSelector("#menu");
    check("the project's menu in the rail has Use in MeetCue", (await page.locator("#menu button").allInnerTexts()).map(t => t.trim()).join("|") === "Rename|Pin|Use in MeetCue");
    await shot("12-project-menu");
    const use = sent.length;
    await page.locator("#menu button", { hasText:"Use in MeetCue" }).click();
    await until(async () => /MeetCue can now read/.test(await toastText()), "the toast");
    const usePost = sent.slice(use).find(r => r.path === `/api/lines/projects/${supplies.id}/meetcue`);
    check("the project's rail menu sends it to MeetCue", usePost?.method === "POST");
    check("the toast says what happened", (await toastText()) === "MeetCue can now read this project's memory", await toastText());
    await shot("13-use-in-meetcue-toast");
    const there = [...cloud.mcFiles.values()].filter(f => f.done).map(f => f.name).sort();
    check("MeetCue has the memory only, not the lines, in a project of the same name", there.join("|") === "MEMORY.md" && [...cloud.mcProjects.values()].map(p => p.name).join("|") === "Supplies", there.join("|"));
    await page.click(`.rail-row[data-p="${supplies.id}"]`, { button:"right" });
    await page.waitForSelector("#menu");
    await shot("14-project-menu");
    await page.locator("#menu button", { hasText:"Use in MeetCue" }).click();
    await until(async () => /MeetCue already has/.test(await toastText()), "the second toast");
    check("sent again with nothing changed, it says MeetCue already has it", (await toastText()) === "MeetCue already has this project's memory" && [...cloud.mcFiles.values()].filter(f => f.done).length === 1);

    console.log("\nMeeting notes in the box");
    // Meeting input lives with Note card inputs, not in the + menu.
    front.linked = false;
    const box = ".dock-wrap .composer";
    const meetingInput = async (scope = box) => {
      if (!await page.locator(`${scope} [data-act="cmp-meeting"][data-give="meeting"]`).isVisible()) await page.locator(`${scope} .cmp-chip[data-kind="card"]`).click();
      await page.locator(`${scope} [data-act="cmp-meeting"][data-give="meeting"]`).click();
    };
    await page.goto(`${base}/projects.html#${supplies.id}`);
    await page.reload();
    await page.waitForSelector(`${box} .cmp-plus`);
    await until(() => page.evaluate(() => MC.status?.linked === false), "MeetCue to say it is not connected");
    await page.click(`${box} .cmp-plus`);
    check("the box's + menu no longer offers meeting notes", await page.locator("#menu button", { hasText:"Add meeting notes from MeetCue" }).count() === 0);
    await page.keyboard.press("Escape");
    await meetingInput();
    await page.waitForSelector("#menu .menu-head");
    check("not connected, the meeting picker offers example meetings plus Connect MeetCue", /Example meetings/.test(await text("#menu .menu-head")) && await page.locator("#menu button", { hasText:"Product launch & Q4 pricing sync" }).count() === 1 && await page.locator("#menu button", { hasText:"Connect MeetCue" }).count() === 1);
    await page.locator("#menu button", { hasText:"Connect MeetCue" }).click();
    await page.waitForSelector('.mc-connect [data-act="meetcue-connect"]');
    await until(() => popups.length === 3, "the link page to open");
    check("clicking Connect MeetCue opens the MeetCue page and penecho.ai's link page", page.url().endsWith("#meetcue") && popups[2] === `${front.origin}/dashboard.html#meetcue`, `${page.url()} | ${popups[2]}`);
    await shot("15-notes-connect-first");
    front.linked = true;
    await until(() => page.url().endsWith(`#${supplies.id}`), "the way back to the box", 15000);
    await page.waitForSelector("#menu .menu-head");
    const picks = (await page.locator("#menu button:not([disabled])").allInnerTexts()).map(t => t.split("\n")[0].trim());
    check("once connected it goes back to the box, with the meetings to choose from", (await text("#menu .menu-head")) === "MeetCue" && picks.join("|") === "Weather app: weekly sync|Supplier call|All meetings" && /MeetCue is connected/.test(await toastText()), picks.join("|"));
    await shot("16-notes-pick");
    await page.locator("#menu button", { hasText:"Weather app: weekly sync" }).click();
    await page.waitForSelector(`${box} .cmp-file`);
    check("a meeting goes into the box as its minutes, a Markdown file", (await text(`${box} .cmp-file strong`)) === "Weather app weekly sync.md");
    await shot("17-notes-in-box");
    // Exercise duplicate protection after the input hints hide behind the attached file.
    await page.evaluate(() => ACT['cmp-meeting'](document.querySelector('.dock-wrap .cmp-plus')));
    await page.locator("#menu button", { hasText:"Weather app: weekly sync" }).click();
    await wait(400);
    check("the same meeting twice is in the box once", await page.locator(`${box} .cmp-file`).count() === 1);
    await page.fill(`${box} .cmp-input`, "Plan the release from this meeting.");
    await page.click(`${box} .send-pick`);
    await page.locator("#menu button", { hasText:"Save as note" }).click();
    await page.click(`${box} .send-btn`);
    await until(() => page.url().includes(`#${supplies.id}/line/`) && !page.url().includes("/line/saving-"), "the note's line");
    // A note keeps what came with it in its line's own folder.
    const slug = page.url().split("/line/")[1], notes = path.join(temp, "docs", "Supplies", "files", slug, "Weather app weekly sync.md"), saved = fs.existsSync(notes) ? fs.readFileSync(notes, "utf8") : "";
    check("sent, the minutes are a file in the project: title, when and how long, then the minutes", /^# Weather app: weekly sync\n\n.*2026.* · 1 h 5 min\n\nThe forecast cards ship this week\.[\s\S]*Write the release note/.test(saved), saved.slice(0, 300));
    check("and the line links them", fs.readFileSync(path.join(temp, "docs", "Supplies", "lines", `${slug}.md`), "utf8").includes(`(../files/${slug}/Weather app weekly sync.md)`));

    console.log("\nDisconnect MeetCue");
    await page.goto(`${base}/projects.html#meetcue`);
    await page.waitForSelector('.mc-head [data-act="meetcue-disconnect"]');
    await page.click('.mc-head [data-act="meetcue-disconnect"]');
    await page.waitForSelector("dialog[open]");
    check("disconnect asks first before unlinking", /Disconnect MeetCue\?/.test(await text("dialog[open] h2")) && front.linked === true);
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForSelector('.mc-connect [data-act="meetcue-connect"]');
    check("confirming Disconnect unlinks MeetCue and returns to the PenEcho MeetCue intro page", front.linked === false && sent.some(r => r.method === "DELETE" && r.path === "/api/lines/meetcue/link") && /MeetCue disconnected/.test(await toastText()));

    console.log("\nSigned out again");
    await post("/api/lines/cloud/sign-out", {});
    await until(async () => !(await toastText()), "the last toast to go");
    await page.goto(`${base}/projects.html#meetcue/m-1`);
    await page.waitForSelector(".mc-connect");
    check("a meeting's address shows the card too, and no error", (await text(".mc-connect .btn.primary")) === "Sign in to connect" && page.url().endsWith("#meetcue") && await noBox() && !(await toastText()), `${await text(".mc-connect .btn.primary")} | ${page.url()} | ${await toastText()}`);
    await page.goto(`${base}/projects.html#${supplies.id}/line/supplier-call`);
    await page.waitForSelector(".lp-meeting");
    check("the line keeps its meeting and its minutes with no account", await page.locator('.lp-meeting [data-act="open-doc"]').count() === 1 && !(await page.locator('[data-act="use-in-meetcue"]').count()));
    const opened = popups.length;
    await meetingInput(".lp-dock .composer");
    await page.waitForSelector("#menu .menu-head");
    check("signed out, Add meeting notes offers example meetings and Sign in to connect", /Example meetings/.test(await text("#menu .menu-head")) && await page.locator("#menu button", { hasText:"Sign in to connect MeetCue" }).count() === 1 && popups.length === opened);
    await page.locator("#menu button", { hasText:"Product launch & Q4 pricing sync" }).click();
    await page.waitForSelector(".lp-dock .composer .cmp-file");
    check("picking an example meeting while signed out attaches its minutes in the input box", /Product launch/.test(await text(".lp-dock .composer .cmp-file strong")));
    check("the page raised no error", errors.length === 0, errors.join(" | "));
  } catch (error) {
    failures.push(error.message); console.log(`FAIL  ${error.stack || error.message}`);
    if (!serverLog.includes("PenEcho:")) console.log(serverLog.slice(-2000));
  } finally { await stop(); }
  console.log(`\n${passed} passed, ${failures.length} failed. Screenshots: ${shots}`);
  process.exit(failures.length ? 1 : 0);
})();
