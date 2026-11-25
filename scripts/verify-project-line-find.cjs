#!/usr/bin/env node
"use strict";
// Real-browser check of project search, against its own server and a scratch folder.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-line-find.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");

const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-find-browser-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
let passed = 0;
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`ok ${label}`); };
const pause = ms => new Promise(r => setTimeout(r, ms));

const agents = { available:() => [{ id:"claude", name:"Claude", mono:"Cl", color:"#a8502a", available:false }], nameOf:id => id, desktop:() => null, terminal:() => "" };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Find", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();

const work = (who, body) => F.workStep({ who, done:true, took:"5 min", body:`${body}\n\n[Details](x.md)` });
const detail = (slug, n, result, who = "claude", started = "2026-11-07 09:00") => s.store.writeText(p, `works/${slug}/work-${n}.md`, F.setResult(F.initialDetail({ slug, title:slug, label:`Work ${n}`, who, started, now:"" }), result));
s.writeDoc(p, "colours", F.initialLine({ title:"Status colours", status:"done", steps:[
  F.askStep({ words:"Running must not be red. Please arrange these colours, especially for status.", when:"2026-11-06 13:10" }),
  work("claude", "Running is teal now."),
  F.askStep({ words:"把分支的颜色改成灰色", when:"2026-11-06 14:00" }),
  work("codex", "Done."),
] }));
detail("colours", 1, "Running is **teal** now, and red is kept for what failed or stopped.", "claude", "2026-11-06 13:12");
detail("colours", 2, "分支现在是深灰色。", "codex", "2026-11-06 14:02");
const many = [];
for (let i = 1; i <= 5; i++) many.push(F.askStep({ words:`Merge question ${i}: what happens to the branch?`, when:`2026-11-07 0${i}:00` }), work("claude", `Merge answer ${i}.`));
s.writeDoc(p, "merge", F.initialLine({ title:"How will this merge take place", status:"done", steps:many }));
for (let i = 1; i <= 5; i++) detail("merge", i, `Merge answer ${i}: the whole branch goes into main.`, "claude", `2026-11-07 0${i}:01`);
s.writeDoc(p, "old", F.initialLine({ title:"An archived line", status:"closed", steps:[F.askStep({ words:"An old merge idea we put away", when:"2026-11-01 10:00" })] }));
s.activity.add(p, "colours", { kind:"say", text:"Checking the hover colour on the map before I change anything.", step:"work-1" });
const filterAsk = via => F.askStep({ words:"Filterneedle in your Ask", via, when:"2026-11-08 09:00" });
for (const [slug, title, status] of [["run", "Running", "working"], ["stop", "Stopped", "stopped"], ["wait", "Waiting for your answer", "waiting"]]) {
  s.writeDoc(p, slug, F.initialLine({ title, status, steps:[filterAsk(), F.workStep({ who:"claude", done:false, body:"" })] }));
}
for (const slug of ["review", "todo"]) {
  s.writeDoc(p, slug, F.initialLine({ title:slug === "todo" ? "Todo result" : "Review result", status:"done", steps:[filterAsk(), work("claude", "Filterneedle in the result")] }));
}
s.writeDoc(p, "todo", F.setFront(s.readDoc(p, "todo"), { todo:"yes" }));
s.writeDoc(p, "send", F.initialLine({ title:"Draft Ask to send", status:"notes", steps:[filterAsk(F.NOT_SENT)] }));
s.sync(p);

const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp" };
let browser, server;
(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, "public", `.${url.pathname}`);
    if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type":mime[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } }), page = await context.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const tabs = () => page.locator(".subnav button").evaluateAll(list => list.map(b => b.dataset.view));
  const typeIn = async q => { await page.fill("#findInput", q); await page.waitForFunction(q2 => FIND.data?.q === q2.trim() || !q2.trim(), q); await pause(60); };
  const counts = () => page.locator(".find-tabs button em").allTextContents();
  const settled = () => page.waitForFunction(() => !FIND.busy && FIND.data?.requestTab === FIND.tab && FIND.data?.requestStatus === FIND.status);

  await page.goto(`${base}/projects.html#${p.id}`); await page.reload();
  await page.waitForSelector(".subnav");
  const order = await tabs();
  check("Search is visible outside the project tabs", !order.includes("find") && await page.locator(".bar-search").isVisible());
  check("Agents remains directly available", order.includes("agents"));
  await page.click('.bar-right [data-view="find"]');
  await page.waitForSelector("#findInput");
  check("the header marks Search as the current page", await page.locator('.bar-right [data-view="find"]').getAttribute("aria-current") === "page");
  check("the box is ready to type in", await page.evaluate(() => document.activeElement?.id === "findInput"));
  check("there is no Ask button", await page.locator(".find-page button.primary, .fd-ask").count() === 0);
  check("an empty box shows nothing to wade through", (await page.locator("#findBody").textContent()).trim() === "");

  await typeIn("merge");
  check("words are found as you type, grouped by line", await page.locator(".fl").count() === 2);
  check("All, Your Asks and Agents' work count what was found", JSON.stringify(await counts()) === JSON.stringify(["11", "6", "5"]));
  check("the number of lines is shown", /2 lines/.test(await page.locator(".find-count").textContent()));
  check("all six status filters are visible, including Need you, Todo and To send", await page.locator('.find-status [data-status]:not([data-status="all"])').count() === 6 && await page.locator('.find-status [data-status="send"]').isVisible());
  check("status counts describe unique matching lines", /1 to review/.test(await page.locator('.find-status [data-status="review"]').textContent()));
  await page.click('.find-status [data-status="review"]'); await settled();
  check("To review removes the archived line", await page.locator('.fl').count() === 1 && !/An archived line/.test(await page.locator('#findBody').textContent()));
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter'); await settled();
  check("the selected status keeps keyboard focus and toggles off in one activation", await page.locator('.fl').count() === 2 && await page.locator('.find-status [data-status="review"]').getAttribute('aria-pressed') === 'false');
  check("the word is marked where it was found", await page.locator(".fh mark").first().textContent() === "merge" || await page.locator(".fh mark").first().textContent() === "Merge");
  check("each line shows three at first", await page.locator('.fl:has-text("How will this merge") .fh').count() === 3);
  await page.click('.fl:has-text("How will this merge") .fl-more');
  check("More shows the rest of that line", await page.locator('.fl:has-text("How will this merge") .fh').count() === 10);
  check("an archived line is found and says so", /Archived/.test(await page.locator('.fl:has-text("An archived line")').textContent()));
  await page.click('.find-tabs [data-tab="yours"]'); await settled();
  check("Your Asks keeps only what you wrote", await page.locator(".fh-work").count() === 0 && await page.locator(".fh-ask").count() > 0);
  await page.click('.find-tabs [data-tab="work"]'); await settled();
  check("Agents' work keeps only Works", await page.locator(".fh-ask").count() === 0 && await page.locator(".fh-work").count() > 0);
  await page.click('.find-tabs [data-tab="all"]'); await settled();
  await page.screenshot({ path:path.join(shots, "1-merge.png") });

  // Live project updates must leave the input node, focus, selection and selected filters alone.
  await page.focus("#findInput");
  await page.evaluate(() => { window.heldFindInput = document.querySelector('#findInput'); heldFindInput.setSelectionRange(1, 4, 'backward'); });
  s.writeDoc(p, "old", F.setFront(s.readDoc(p, "old"), { priority:"3" })); s.sync(p);
  await page.evaluate(() => poll()); await settled();
  check("a real state poll preserves the search input, focus and selection", await page.evaluate(() => heldFindInput === document.querySelector('#findInput') && document.activeElement === heldFindInput && heldFindInput.selectionStart === 1 && heldFindInput.selectionEnd === 4 && heldFindInput.selectionDirection === 'backward'));

  // Open Find from the lighter Home state, then keep typing while its full state arrives.
  let releaseState, stateRequested;
  const stateHeld = new Promise(resolve => { releaseState = resolve; });
  const stateSeen = new Promise(resolve => { stateRequested = resolve; });
  await page.route(`**/api/lines/projects/${p.id}/state*`, async route => { stateRequested(); await stateHeld; await route.continue(); }, { times:1 });
  await page.evaluate(() => { project().partial = 'home'; go({ view:'find', q:'merge' }); });
  await stateSeen;
  await page.fill('#findInput', 'merg');
  await page.evaluate(() => { window.heldFindInput = document.querySelector('#findInput'); heldFindInput.setSelectionRange(1, 3, 'backward'); });
  releaseState();
  await page.waitForFunction(() => !project().partial); await pause(80);
  check("delayed full-state loading preserves the input node, focus and caret", await page.evaluate(() => heldFindInput === document.querySelector('#findInput') && document.activeElement === heldFindInput && heldFindInput.value === 'merg' && heldFindInput.selectionStart === 1 && heldFindInput.selectionEnd === 3 && heldFindInput.selectionDirection === 'backward'));

  await typeIn('filterneedle');
  check("status counts cover all matching lines", await page.locator('.fl').count() === 6 && await page.locator('.find-status button:not(.find-clear)').evaluateAll(buttons => buttons.every(b => /^1 /.test(b.textContent))));
  for (const status of ['working', 'stopped', 'you', 'todo', 'review', 'send']) {
    const offBackground = await page.locator(`.find-status [data-status="${status}"]`).evaluate(el => getComputedStyle(el).backgroundColor);
    await page.click(`.find-status [data-status="${status}"]`); await settled();
    check(`${status} selects its matching line in one activation`, await page.locator('.fl').count() === 1 && await page.locator(`.find-status [data-status="${status}"]`).getAttribute('aria-pressed') === 'true');
    check(`${status} visibly marks the selected filter`, await page.locator(`.find-status [data-status="${status}"]`).evaluate(el => getComputedStyle(el).backgroundColor) !== offBackground);
    if (status === 'todo') {
      await page.screenshot({ path:path.join(shots, 'todo-light.png') });
      await page.evaluate(() => linesTheme.set('dark'));
      check('Todo stays visibly selected in dark mode', await page.locator('.find-status [data-status="todo"]').evaluate(el => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'));
      await page.screenshot({ path:path.join(shots, 'todo-dark.png') });
      await page.evaluate(() => linesTheme.set('light'));
    }
  }
  await page.click('.find-tabs [data-tab="work"]'); await settled();
  check("To send intersects with Agents' work and explains an empty result", await page.locator('.find-empty').isVisible() && await page.locator('.find-clear').isVisible());
  await page.click('.find-tabs [data-tab="yours"]'); await settled();
  check("To send intersects with Your Asks", await page.locator('.fl[data-line="send"] .fh-ask').count() === 1);
  await page.screenshot({ path:path.join(shots, '2-to-send-desktop.png') });

  await typeIn("failed or stopped");
  check("a Work's whole result is searched, not only its first lines", await page.locator(".fh-work").count() === 1 && /failed or stopped/.test(await page.locator(".fh-work .fh-text").textContent()));
  await typeIn("hover");
  check("what an agent said on the way is searched", await page.locator(".fh-work").count() === 1);
  await typeIn("分支");
  check("Chinese is found", await page.locator(".fh").count() === 2);
  await page.screenshot({ path:path.join(shots, "2-chinese.png") });
  await typeIn("nothing like this anywhere");
  check("nothing found says so", /Nothing found/.test(await page.locator("#findBody").textContent()));

  // From a result to the line, and back.
  await typeIn("teal");
  const before = page.url();
  check("the address keeps what you looked for", decodeURIComponent(before).endsWith("/find/teal"));
  await page.click(".fh-work");
  await page.waitForSelector("#lpPanel:not([hidden])");
  check("a Work opens on its line with its panel", page.url().includes("/line/colours/work-1") && /Work 1/.test(await page.locator("#lpPanel").textContent()));
  await page.screenshot({ path:path.join(shots, "3-opened.png") });
  await page.goBack();
  await page.waitForSelector("#findInput");
  await page.waitForSelector(".fh");
  check("Back returns to Find with the same words and results", await page.inputValue("#findInput") === "teal" && await page.locator(".fh").count() >= 1);
  await typeIn("arrange");
  await page.click(".fh-ask");
  await page.waitForSelector("#item-ask-1");
  check("an Ask opens on its line, at that Ask", page.url().includes("/line/colours/ask-1"));
  await page.goto(`${base}/projects.html#${p.id}/find/${encodeURIComponent("分支")}`); await page.reload();
  await page.waitForSelector(".fh");
  check("a saved address opens Find with its words", await page.inputValue("#findInput") === "分支" && await page.locator(".fh").count() === 2);
  await page.fill("#findInput", ""); await page.dispatchEvent("#findInput", "input"); await pause(100);
  check("searches you opened are kept as Recent", /teal/.test(await page.locator(".find-recent").textContent()) && /arrange/.test(await page.locator(".find-recent").textContent()));
  await page.click('.find-row:has-text("teal")');
  await page.waitForSelector(".fh");
  check("a Recent search runs again", await page.inputValue("#findInput") === "teal");
  await page.focus("#findInput"); await page.keyboard.press("Escape"); await pause(80);
  check("Escape clears the box", await page.inputValue("#findInput") === "");

  // A server from before Find still finds what the page has.
  await page.route("**/find?*", route => route.fulfill({ status:404, contentType:"application/json", body:JSON.stringify({ error:"Not found." }) }));
  await typeIn("red");
  check("with an older server, your Asks are still found", await page.locator(".fh-ask").count() === 1);
  await typeIn('filterneedle'); await page.click('.find-status [data-status="send"]'); await settled();
  check('with an older server, To send still selects unsent Asks', await page.locator('.fl').count() === 1 && await page.locator('.fl').getAttribute('data-line') === 'send');
  await page.unroute("**/find?*");

  // A phone.
  await page.setViewportSize({ width:420, height:820 }); await typeIn("merge"); await pause(100);
  check("nothing spills sideways on a phone", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll(".fl")].every(n => n.scrollWidth <= n.clientWidth + 1)));
  await page.screenshot({ path:path.join(shots, "4-phone.png") });
  await page.click('.find-status [data-status="send"]'); await settled();
  check("an empty status keeps all filters and an immediate way back", await page.locator('.find-empty').isVisible() && await page.locator('.find-empty [data-status="all"]').isVisible());
  await page.click('.find-empty [data-status="all"]'); await settled();
  check("clearing the empty status restores the results", await page.locator('.fl').count() === 2);

  const touch = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, deviceScaleFactor:1, reducedMotion:'reduce' });
  const phone = await touch.newPage(); phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(`${base}/projects.html#${p.id}/find/filterneedle`); await phone.waitForSelector('.fl');
  check('touch search does not open the keyboard automatically', await phone.evaluate(() => document.activeElement?.id !== 'findInput'));
  check('all status controls have 44px touch targets and fit the phone', await phone.locator('.find-status [data-status]').evaluateAll(buttons => buttons.length === 6 && buttons.every(b => { const r = b.getBoundingClientRect(); return r.height >= 44 && r.width >= 44 && r.x >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })));
  check('the working indicator respects reduced motion', await phone.locator('.find-status .spin').evaluate(el => getComputedStyle(el).animationName === 'none'));
  await phone.locator('.find-status [data-status="send"]').tap();
  await phone.waitForFunction(() => !FIND.busy && FIND.data?.status === 'send');
  check('one tap selects To send on touch', await phone.locator('.fl[data-line="send"]').count() === 1 && await phone.locator('.fl').count() === 1);
  await phone.screenshot({ path:path.join(shots, 'touch-to-send.png') });
  await phone.setViewportSize({ width:320, height:740 });
  check('search controls and results fit a 320px screen', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.find-tabs, .find-status, .fl')].every(el => el.scrollWidth <= el.clientWidth + 1)));
  await phone.screenshot({ path:path.join(shots, 'touch-narrow.png') });
  await touch.close();

  check("no page errors", errors.length === 0);
  console.log(`${passed} checks passed. Pictures in ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server?.close(); s.close?.(); fs.rmSync(temp, { recursive:true, force:true });
});
