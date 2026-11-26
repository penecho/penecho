"use strict";
// Real-browser check for the line page with fewer buttons (PE-478). Uses canonical public/ and server code; never runs an agent.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-line-fewer-buttons.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-fewer-buttons-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
const agents = { available:() => [], nameOf:id => id, desktop:() => null, terminal:() => "" };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Fewer buttons", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();
s.writeDoc(p, "safe", F.setFront(F.initialLine({ title:"Safe project folders", status:"done", steps:[
  F.askStep({ words:"Refuse a folder that is already a project.", when:"2026-11-15 13:00" }),
  F.workStep({ who:"codex", done:true, took:"15 min", body:"Implemented locally." }),
  F.askStep({ words:"No, it's not finished.", when:"2026-11-15 13:34" }),
  F.workStep({ who:"claude", done:true, took:"8 min", body:"The running server was not restarted." }),
] }), { finished:"2026-11-15 13:42" }));
for (const n of [1, 2]) s.store.writeText(p, `topics/safe/work-${n}.md`, F.setResult(F.initialDetail({ slug:"safe", title:"Safe project folders", label:`Work ${n}`, who:n === 1 ? "codex" : "claude", started:"2026-11-15 13:00", now:"" }), `**Diagnosed** why the folder was accepted.\n\n- One\n- Two`));
s.sync(p);
let browser, server, passed = 0;
const check = (label, ok, info = "") => { assert.ok(ok, `${label} ${info}`); passed++; console.log(`ok ${label}`); };
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp" };
(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, "public", `.${url.pathname}`);
    if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type":mime[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1600, height:950 }, reducedMotion:"reduce" }), page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const opacity = async (loc, on = page) => { await on.waitForTimeout(250); return loc.evaluate(n => +getComputedStyle(n).opacity); };
  await page.goto(`${base}/projects.html#${p.id}/line/safe`); await page.reload();
  await page.locator("#lpThread .lp-end").waitFor();

  // 1. Top bar: six tabs (Statistics shows while it fits, PE-431), then More; no totals.
  const views = await page.$$eval("#projbar .subnav [data-view]", els => els.map(e => e.dataset.view));
  check("the bar keeps the project views and a separate Search control", ["memory", "vault", "archive", "deleted", "find"].every(v => !views.includes(v)) && ["home", "stats"].every(v => views.includes(v)) && await page.locator(".bar-search").isVisible(), views.join());
  check("the bar shows no totals while no agent runs", await page.locator("#projbar .subnav em").count() === 0);
  await page.click("#projbar .subnav-more");
  check("More lists Memory, Vault, Archive and Deleted", (await page.locator("#menu").innerText()).replace(/\s+/g, " ").trim() === "Memory Vault Archive Deleted", await page.locator("#menu").innerText());
  await page.locator("#menu button", { hasText:"Memory" }).click();
  await page.waitForFunction(() => S.route.view === "memory");
  check("on Memory, More says Memory and is marked", (await page.locator("#projbar .subnav-more").innerText()).trim() === "Memory" && await page.locator("#projbar .subnav-more.on").count() === 1);
  await page.screenshot({ path:path.join(shots, "bar-more-memory.png"), clip:{ x:0, y:0, width:1600, height:70 } });

  // 2. Keep in Cloud is under Share.
  await page.goto(`${base}/projects.html#${p.id}/line/safe`); await page.locator("#lpThread .lp-end").waitFor();
  check("signed out, Share opens the share dialog straight away", await page.getAttribute(".bar-share", "data-act") === "project-share" && await page.locator(".bar-keep").count() === 0);
  await page.evaluate(() => { S.cloudAccount = { signedIn:true }; cloudBar(); });
  check("signed in, Share becomes Share ▾", await page.getAttribute(".bar-share", "data-act") === "share-menu" && await page.locator(".bar-share .bar-share-caret").count() === 1);
  await page.click(".bar-share");
  check("Share ▾ has the link and Keep in Cloud", (await page.locator("#menu").innerText()).replace(/\s+/g, " ").trim() === "Share link… Keep in Cloud");
  await page.screenshot({ path:path.join(shots, "share-menu.png"), clip:{ x:1000, y:0, width:600, height:200 } });
  await page.keyboard.press("Escape");
  await page.evaluate(() => { S.cloudAccount = null; cloudBar(); });

  // 3. Line header: one face button for the conversations, a star, the file in ⋯.
  check("the line file is not a button in the header", await page.locator(".lp-file").count() === 0);
  check("Pin is a star with no word", (await page.locator(".lp-pin").innerText()).trim() === "" && await page.getAttribute(".lp-pin", "aria-label") === "Pin this line");
  await page.evaluate(() => { const l = lineById(project(), "safe"); l.conversations = { codex:{ agent:"codex", terminal:"codex resume 1" }, claude:{ agent:"claude", terminal:"claude --resume 2" } }; refreshLine(); });
  check("two conversations are one button", await page.locator(".lp-acts .chat-direct").count() === 1 && await page.locator(".lp-acts .chat-faces").count() === 1);
  await page.click(".lp-acts .chat-faces");
  check("its menu has both agents", await page.locator("#menu button").count() === 2);
  await page.keyboard.press("Escape");
  await page.click('.lp-acts [data-act="line-menu"]');
  const thisLine = page.getByRole("group", { name:"This Line", exact:true });
  check("⋯ starts with the Line reference and includes the Line file", (await thisLine.getByRole("menuitem").first().innerText()).includes("Copy Line reference") && await thisLine.getByRole("menuitem", { name:/Open Line file.*safe.md/s }).count() === 1);
  await page.keyboard.press("Escape");

  // 4–5. The Finished row and the end of the line.
  const end = page.locator("#lpThread .lp-end"), todo = end.locator(".lp-todo");
  check("the Finished row has no Mark outdated", await end.locator(".lp-outdated").count() === 0);
  await page.mouse.move(5, 500);
  check("Mark todo stays visible beside Mark all reviewed at rest", await opacity(todo) === 1 && await end.locator(".lp-all-reviewed").isVisible());
  await end.hover();
  check("and stays visible on hover", await opacity(todo) === 1);
  await end.screenshot({ path:path.join(shots, "finished-hover.png") });
  check("the end of the line has New canvas and no Make with AI", await page.locator(".lp-newcv").count() === 1 && await page.locator(".lp-newmake").count() === 0);

  // 6–7. The Work panel.
  await page.click("#item-work-2"); await page.locator("#lppResult .result-text").waitFor();
  check("the panel head has no Good / Not good", await page.locator(".lpp-tools .lp-rate").count() === 0);
  check("Good / Not good are at the end of the result", await page.locator("#lppResult .lpp-rate-box .lp-rate-btn").count() === 2);
  const tools = page.locator(".lpp-result-tools");
  await page.mouse.move(5, 500);
  check("Copy and </> are hidden at rest", await opacity(tools) === 0 && await page.locator(".lpp-result-tools .seg").count() === 0);
  await page.hover("#lppResult .result-text");
  check("and show on the result", await opacity(tools) === 1);
  await page.locator(".lp-panel").screenshot({ path:path.join(shots, "panel-hover.png") });
  await page.click(".lpp-src");
  await page.locator("#lppResult .src").waitFor();
  check("</> shows the Markdown source and stays shown", await page.getAttribute(".lpp-src", "aria-pressed") === "true" && await page.locator(".lpp-result-tools.is-held").count() === 1);
  await page.click(".lpp-src");
  await page.evaluate(() => { const l = lineById(project(), "safe"); for (const st of l.stations) if (st.kind === "work") st.tokens = { inputTokens:200000, cacheReadInputTokens:180000, outputTokens:3000 }; refreshLine(); });
  // PE-562: the hover tools share the top summary row, never the result's first line.
  const position = async on => on.evaluate(() => {
    const box = sel => document.querySelector(sel).getBoundingClientRect();
    const tools = box('.lpp-result-tools'), tokens = box('#lppTokens'), text = box('#lppResult .result-text'), scroll = box('#lppScroll');
    const scroller = document.querySelector('#lppScroll');
    return tools.bottom <= text.top && tokens.bottom <= text.top && tokens.right <= tools.left && Math.abs(tools.right - (scroll.right - 16)) < 2 && scroller.clientWidth >= scroller.scrollWidth;
  });
  for (const width of [1600, 1024, 390]) {
    await page.setViewportSize({ width, height:950 });
    await page.hover('#lppResult .result-text');
    check(`at ${width}px Copy is at the top right, clear of tokens and result text`, await position(page));
    await page.waitForFunction(() => +getComputedStyle(document.querySelector('.lpp-result-tools')).opacity === 1);
    await page.locator('.lp-panel').screenshot({ path:path.join(shots, `panel-copy-${width}.png`) });
  }
  await page.setViewportSize({ width:1600, height:950 });
  await page.mouse.move(5, 500);
  await page.locator('.lpp-src').focus();
  await page.keyboard.press('Shift+Tab');
  check('keyboard focus reveals Copy without hovering', await opacity(tools) === 1 && await page.locator('.lpp-result-tools .lp-copy-btn').evaluate(n => n === document.activeElement));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Copied'));
  check('keyboard Copy puts the complete Markdown result on the clipboard', await page.evaluate(async () => (await navigator.clipboard.readText()).trim() === '**Diagnosed** why the folder was accepted.\n\n- One\n- Two'));
  const tok = page.locator("#item-work-1 .token-work");
  check("the token line is the Details button", await tok.getAttribute("data-act") === "token-proof" && await page.locator('#lpThread .token-work [data-act="token-proof"]').count() === 0);
  const tokBox = await tok.boundingBox(), rowBox = await page.locator("#item-work-1 .lpp-sub").boundingBox();
  check("the token button stays sized to its text", tokBox.width < rowBox.width - 40);
  await page.mouse.click(rowBox.x + rowBox.width - 10, tokBox.y + tokBox.height / 2);
  check("clicking blank space on the token row opens the Work, not token details", await page.locator(".token-proof-dialog[open]").count() === 0 && await page.getAttribute("#item-work-1", "aria-pressed") === "true");
  await tok.click(); await page.waitForSelector(".token-proof-dialog[open]");
  check("clicking it opens the token details", true);
  await page.keyboard.press("Escape");
  await page.mouse.move(5, 500);
  await page.screenshot({ path:path.join(shots, "line-page.png") });

  // Touch: the hidden ones stay.
  const touch = await browser.newContext({ viewport:{ width:1280, height:900 }, hasTouch:true, isMobile:true, reducedMotion:"reduce" }), tab = await touch.newPage();
  tab.on("pageerror", e => errors.push(e.message));
  await tab.goto(`${base}/projects.html#${p.id}/line/safe`); await tab.locator("#lpThread .lp-todo").waitFor();
  check("on a touch screen Mark todo stays visible", await opacity(tab.locator("#lpThread .lp-todo"), tab) === 1);
  await tab.click('#item-work-2'); await tab.locator('#lppResult .result-text').waitFor();
  await tab.evaluate(() => { const l = lineById(project(), 'safe'); for (const st of l.stations) if (st.kind === 'work') st.tokens = { inputTokens:200000, cacheReadInputTokens:180000, outputTokens:3000 }; refreshLine(); });
  await tab.setViewportSize({ width:390, height:844 });
  check('on a narrow touch screen Copy stays visible without hovering', await opacity(tab.locator('.lpp-result-tools'), tab) === 1);
  check('on touch Copy stays clear of tokens and result text', await position(tab));
  await tab.locator('.lp-panel').screenshot({ path:path.join(shots, 'panel-copy-touch.png') });
  await touch.close();
  check("no browser errors", errors.length === 0, errors.join(" | "));
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server?.close(); s.close(); fs.rmSync(temp, { recursive:true, force:true });
});
