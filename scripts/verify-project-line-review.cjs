#!/usr/bin/env node
"use strict";
// Real-browser check of marking a Work reviewed on the line page, against its own server and a scratch folder.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-line-review.cjs [screenshot-folder]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");

const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-review-browser-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
let passed = 0;
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`ok ${label}`); };
const pause = ms => new Promise(r => setTimeout(r, ms));

const agents = { available:() => [{ id:"claude", name:"Claude", mono:"Cl", color:"#a8502a", available:false }], nameOf:id => id, desktop:() => null, terminal:() => "" };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Review", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();

const said = "Fixed the header so it no longer wraps, moved the button beside it, and checked both widths. Nothing is committed yet, and main is untouched, so this can wait for you to look at it.";
const done = (body, took) => F.workStep({ who:"claude", done:true, took, body:`${body}\n\n[Details](one/x.md)` });
const steps = [
  F.askStep({ words:"First ask", when:"2026-11-07 09:00" }), done(said, "5 min"),
  F.askStep({ words:"Second ask", when:"2026-11-07 09:10" }), { ...done(said, "7 min"), body:`${said}\n\n![Map](../files/one/map.png)` },
  F.askStep({ words:"Third ask", when:"2026-11-07 09:20" }), done(said, "2 min"),
  F.askStep({ words:"Fourth ask", when:"2026-11-07 09:30" }), F.workStep({ who:"claude" }),
];
s.writeDoc(p, "one", F.initialLine({ title:"One line", status:"working", steps }));
fs.mkdirSync(path.join(p.docsPath, "files/one"), { recursive:true });
fs.writeFileSync(path.join(p.docsPath, "files/one/map.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7yMK/gAAAABJRU5ErkJggg==", "base64"));
for (const [n, changes] of [[1, "+12 -3 2"], [2, ""], [3, ""]]) s.store.writeText(p, `works/one/work-${n}.md`, F.setFront(F.initialDetail({ slug:"one", title:"One line", label:`Work ${n}`, who:"claude", started:"2026-11-07 09:00", now:"" }), changes ? { changes } : {}));
// Lines that have ended, for To review.
const ended = (slug, title, status, works, front = {}) => {
  const all = Array.from({ length:works }, (_, i) => [F.askStep({ words:`Ask ${i + 1}`, when:`2026-11-07 10:${i}0` }), done(`Did part ${i + 1}.`, "1 min")]).flat();
  s.writeDoc(p, slug, F.setFront(F.initialLine({ title, status, steps:all }), front));
  for (let n = 1; n <= works; n++) s.store.writeText(p, `works/${slug}/work-${n}.md`, F.initialDetail({ slug, title, label:`Work ${n}`, who:"claude", started:"2026-11-07 10:00", now:"" }));
};
ended("two", "Two Works ended", "ready", 2);
ended("plain", "One Work ended", "done", 1);
ended("merged", "Already merged", "done", 1, { commit:"abc1234" });
ended("gone", "Put away", "closed", 1);
s.sync(p);

const topicFile = path.join(p.docsPath, "lines/one.md"), detailOf = n => fs.readFileSync(path.join(p.docsPath, `works/one/work-${n}.md`), "utf8");
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

  // Going to the same address, with only the # changed, would not load the page again.
  const open = async () => { await page.goto(`${base}/projects.html#${p.id}/line/one`); await page.reload(); await page.waitForSelector("#lpThread .lp-work"); await pause(250); };
  const box = n => page.locator(`#item-work-${n}`), mark = n => box(n).locator(".lp-mark"), inPanel = page.locator("#lpPanel .lp-mark");
  const opacity = l => l.evaluate(n => getComputedStyle(n).opacity);
  const selected = () => page.locator("#lpThread .lp-work.on").getAttribute("data-step").catch(() => null);
  const fresh = () => page.evaluate(async () => { await loadState(S.cur, { force:true }); refreshAfterChange(); });
  const topic = fs.readFileSync(topicFile, "utf8");
  await open();

  // At rest, nothing about an unreviewed Work has changed.
  check("the mark is hidden on a Work at rest", await opacity(mark(1)) === "0");
  await page.mouse.move(2, 2); await pause(200);
  const rest = await box(1).boundingBox(), withMark = await box(1).screenshot();
  await page.evaluate(() => document.querySelectorAll("#item-work-1 .lp-mark").forEach(n => { n.style.display = "none"; }));
  const without = await box(1).screenshot(), bare = await box(1).boundingBox();
  check("an unreviewed box is the same size with or without the mark", rest.height === bare.height && rest.width === bare.width);
  check("an unreviewed box has the same pixels with or without the mark", withMark.equals(without));
  await page.evaluate(() => document.querySelectorAll("#item-work-1 .lp-mark").forEach(n => { n.style.display = ""; }));

  check("a Work still running has no mark", await page.locator("#item-work-4 .lp-mark").count() === 0);
  check("the end of the line has no mark", await page.locator(".lp-end .lp-mark").count() === 0);
  check("the count says none of three", (await page.locator("#lpProg").innerText()).replace(/\s/g, "") === "0/3");

  // One click, without opening the Work.
  await box(1).hover(); await pause(200);
  check("pointing at the box shows the mark", await opacity(mark(1)) === "1");
  await page.screenshot({ path:path.join(shots, "1-hover.png") });
  const was = await selected(), tall = (await box(1).boundingBox()).height, wordsAt = await box(1).locator(".lp-sum").boundingBox();
  await mark(1).click();
  check("one click marks it at once", await box(1).evaluate(n => n.classList.contains("is-reviewed")));
  check("the click does not change which Work is open", await selected() === was);
  await pause(350);
  check("the box keeps its height: nothing folds", (await box(1).boundingBox()).height === tall);
  const wordsNow = await box(1).locator(".lp-sum").boundingBox();
  check("its words stay, exactly where they were", await box(1).locator(".lp-sum").isVisible() && wordsNow.x === wordsAt.x && wordsNow.width === wordsAt.width);
  check("a green edge down its side says it is reviewed", await box(1).evaluate(n => { const c = getComputedStyle(n); return c.borderLeftWidth === "3px" && c.borderLeftColor === "rgb(22, 163, 74)"; }));
  check("the tick stays when you point away", await page.mouse.move(2, 2).then(() => pause(200)).then(() => opacity(mark(1))) === "1");
  check("the line down the side follows", await page.locator('.lps[data-step="work-1"]').evaluate(n => n.classList.contains("is-reviewed")));
  check("the count follows", (await page.locator("#lpProg").innerText()).replace(/\s/g, "") === "1/3");
  await until(() => /^reviewed: /m.test(detailOf(1)), "the mark saved");
  check("it is saved in the Work's detail file", /^reviewed: \d{4}-\d\d-\d\d \d\d:\d\d$/m.test(detailOf(1)));
  check("the Topic file is untouched", fs.readFileSync(topicFile, "utf8") === topic);
  await page.screenshot({ path:path.join(shots, "2-marked.png") });

  // A Work with a picture keeps it, at the same size.
  check("a Work with a picture shows it before marking", await box(2).locator(".lp-pics").isVisible());
  const picAt = await box(2).locator(".lp-pics").boundingBox();
  await box(2).hover(); await mark(2).click(); await pause(300);
  const picNow = await box(2).locator(".lp-pics").boundingBox();
  check("marking keeps the picture, at the same size", await box(2).locator(".lp-pics").isVisible() && picNow.width === picAt.width && picNow.height === picAt.height);

  // The right panel does the same.
  await box(3).click(); await pause(250);
  check("clicking the box itself still opens it", await selected() === "work-3");
  check("the panel shows the mark without pointing", await opacity(inPanel) === "1" && await inPanel.locator(".lp-word").isVisible());
  await page.mouse.move(2, 2);
  await inPanel.click();
  check("the panel marks the Work in the thread", await box(3).evaluate(n => n.classList.contains("is-reviewed")));
  check("the panel reads checked, and stays on that Work", await inPanel.getAttribute("aria-checked") === "true" && await selected() === "work-3");
  check("all three: the count is full", await page.locator("#lpProg").evaluate(n => n.classList.contains("is-done") && n.innerText.replace(/\s/g, "") === "3/3"));
  await pause(300);
  await page.screenshot({ path:path.join(shots, "3-panel.png") });
  await box(3).locator(".lp-mark").click(); await pause(100);
  check("the box unchecks the panel", await inPanel.getAttribute("aria-checked") === "false");
  await inPanel.click(); await pause(150);

  // It survives a reload, and does not make the line read as new.
  await until(() => /^reviewed: /m.test(detailOf(3)), "the third saved");
  await open();
  check("marks are there after a reload", await box(1).evaluate(n => n.classList.contains("is-reviewed")) && await box(3).evaluate(n => n.classList.contains("is-reviewed")));
  await page.locator('[data-act="line-back"]').first().click(); await page.waitForSelector('[data-row="one"]', { state:"attached" }); await pause(200);
  check("marking did not make the line read as Unread", await page.locator('.is-unread[data-row="one"]').count() === 0);
  await open();

  // Undo takes the edge away, and a selected reviewed Work is still clearly selected.
  await box(1).hover(); await mark(1).click(); await pause(300);
  check("a second click undoes it", !(await box(1).evaluate(n => n.classList.contains("is-reviewed"))) && (await box(1).boundingBox()).height === tall && await box(1).evaluate(n => getComputedStyle(n).borderLeftWidth) === "1px");
  // Its picture is in the middle of the box now, and a picture opens large, so this clicks the Work's name.
  await box(2).locator("header strong").click(); await pause(250);
  check("a reviewed Work can be opened, and shows the selected look", await selected() === "work-2" && await box(2).locator(".lp-sum").isVisible() && await box(2).evaluate(n => getComputedStyle(n).borderLeftWidth) === "1px");
  await page.screenshot({ path:path.join(shots, "4-selected.png") });

  // Keyboard.
  await box(1).focus();
  check("focus shows the mark", await pause(200).then(() => opacity(mark(1))) === "1");
  await page.keyboard.press("Tab");
  check("Tab reaches it", await page.evaluate(() => document.activeElement?.classList.contains("lp-mark")));
  await page.keyboard.press("Space"); await pause(100);
  check("Space marks it, and focus stays on it", await box(1).evaluate(n => n.classList.contains("is-reviewed")) && await page.evaluate(() => document.activeElement?.classList.contains("lp-mark")));
  await page.keyboard.press("Space"); await pause(100);

  // A save that fails goes back and says so.
  await page.route("**/review", route => route.fulfill({ status:500, json:{ error:"Could not save that." } }));
  await box(1).hover(); await mark(1).click(); await pause(300);
  check("a failed save goes back", !(await box(1).evaluate(n => n.classList.contains("is-reviewed"))));
  check("and says so", (await page.locator("body").innerText()).includes("Could not save that."));
  await page.unroute("**/review");

  // New work on a reviewed Work clears it.
  await box(1).hover(); await mark(1).click();
  await until(() => /^reviewed: /m.test(detailOf(1)), "marked again");
  s.resumeWork(p, { slug:"one", stepId:"work-1" }); await fresh(); await pause(200);
  check("work that opens again loses its mark", !(await box(1).evaluate(n => n.classList.contains("is-reviewed"))) && await page.locator("#item-work-1 .lp-mark").count() === 0);
  s.writeDoc(p, "one", F.updateSteps(s.readDoc(p, "one"), all => { F.closeStep(all[1], { slug:"one", took:"6 min", summary:"Did more." }); })); await fresh(); await pause(200);

  // A page ahead of its server offers nothing rather than something that fails.
  const stateCall = /\/api\/lines\/projects\/[^/]+\/state/;
  await page.route(stateCall, async route => { const res = await route.fetch(), state = await res.json(); for (const key of ["lines", "landed", "backlog"]) for (const l of state[key] || []) for (const st of l.stations) delete st.reviewed; await route.fulfill({ response:res, json:state }); });
  await open();
  check("an older server shows no mark and no count", await page.locator(".lp-mark").count() === 0 && !(await page.locator("#lpProg").isVisible()));
  await page.unroute(stateCall);

  // The counts over the thread are filters, as on the home.
  await open();
  const bar = page.locator("#lpFilters"), pressF = f => bar.locator(`[data-f="${f}"]`).click().then(() => pause(200));
  const shownIds = () => page.evaluate(() => [...document.querySelectorAll("#lpThread [id^=item-]")].filter(n => !n.closest(".lf-out")).map(n => n.id.slice(5)));
  const shownWorks = async () => (await shownIds()).filter(id => /^work-/.test(id));
  const sideShown = () => page.evaluate(() => [...document.querySelectorAll("#lpList .lps")].filter(n => !n.closest(".lf-out")).map(n => n.dataset.step));
  const barWords = () => bar.innerText().then(x => x.replace(/\s+/g, " ").trim());
  check("the counts sit over the thread", await barWords() === "1 working 1 to review 2 finished");
  await page.locator("#lpScroll").evaluate(n => { n.scrollTop = n.scrollHeight; }); await pause(150);
  check("and stay at its top as it scrolls", await page.evaluate(() => Math.abs(document.querySelector("#lpFilters").getBoundingClientRect().top - document.querySelector("#lpScroll").getBoundingClientRect().top) < 1));
  await pressF("review");
  check("to review shows only the Work waiting, with the Ask it answered", JSON.stringify(await shownWorks()) === '["work-1"]' && await page.locator("#lpThread .lp-ask:visible").count() === 1 && (await page.locator("#lpThread .lp-ask:visible").innerText()).includes("First ask"));
  check("pressed, in its own colour", await bar.locator('[data-f="review"]').getAttribute("aria-pressed") === "true" && await bar.locator('[data-f="review"]').evaluate(n => getComputedStyle(n).backgroundColor) !== "rgba(0, 0, 0, 0)");
  check("the line down the side follows", !(await sideShown()).includes("work-2") && (await sideShown()).includes("work-1"));
  check("it starts from the top", await page.locator("#lpScroll").evaluate(n => n.scrollTop) === 0);
  await page.screenshot({ path:path.join(shots, "9-filter-review.png") });
  await box(1).hover(); await mark(1).click(); await pause(250);
  check("a Work marked under the filter stays until you change it", JSON.stringify(await shownWorks()) === '["work-1"]' && await box(1).evaluate(n => n.classList.contains("is-reviewed")));
  check("the counts follow, and the pressed one stays at 0", await barWords() === "1 working 0 to review 3 finished");
  await pressF("review");
  check("pressing it again shows the whole line", (await shownWorks()).length === 4 && await page.locator("#lpThread .lf-out, #lpList .lf-out").count() === 0 && !(await barWords()).includes("to review"));
  await box(3).locator("header strong").click(); await pause(800);
  await pressF("done");
  check("finished shows the reviewed Works", JSON.stringify(await shownWorks()) === '["work-1","work-2","work-3"]');
  check("the panel's arrows step through what is shown", await page.locator('#lppHead [aria-label="Later work"]').isDisabled() && !(await page.locator('#lppHead [aria-label="Earlier work"]').isDisabled()));
  // Showing everything again keeps your place. (A short filtered page can't always keep it the other way, because it may not scroll that far.)
  const top3 = await box(3).evaluate(n => n.getBoundingClientRect().top);
  await pressF("done");
  check("the Work you were reading stays where it was", Math.abs(await box(3).evaluate(n => n.getBoundingClientRect().top) - top3) < 2 && (await shownWorks()).length === 4);
  await pressF("done");
  await pressF("working");
  check("working shows the Work at work", JSON.stringify(await shownWorks()) === '["work-4"]' && await bar.locator('[data-f="done"]').getAttribute("aria-pressed") === "false");
  await page.evaluate(() => scrollToItem("work-2", { smooth:false })); await pause(150);
  check("going to a Work the filter hides shows the whole line again", (await shownWorks()).length === 4 && await bar.locator('[aria-pressed="true"]').count() === 0);
  await page.screenshot({ path:path.join(shots, "10-filter-cleared.png") });
  await box(1).locator(".lp-mark").click();
  await until(() => !/^reviewed: /m.test(detailOf(1)), "work 1 unmarked");

  // To review: a line says Finished only once every finished Work is marked.
  const AMBER = "rgb(217, 138, 31)";
  const home = async () => { await page.goto(`${base}/projects.html#${p.id}`); await page.reload(); await page.waitForSelector('[data-row="two"]', { state:"attached" }); await pause(300); };
  const openLine = async id => { await page.goto(`${base}/projects.html#${p.id}/line/${id}`); await page.reload(); await page.waitForSelector("#linePage"); await pause(300); };
  const said = l => l.innerText().then(x => x.trim());
  const paint = l => l.evaluate(n => getComputedStyle(n, "::before").backgroundColor);
  const mapEnd = id => page.locator(`.row[data-row="${id}"] .st.k-end`), mapWord = id => said(mapEnd(id).locator(".st-words"));
  const foot = page.locator("#lpThread .lp-end"), footWord = () => said(foot.locator("strong")), sideWord = () => page.locator("#lpList .lps.k-end .lps-end").textContent(), headWord = () => said(page.locator("#lpHead .chip").first());
  await home();
  check("the map's end says To review until the Works are marked", await mapWord("two") === "To review" && await mapWord("plain") === "To review");
  check("in amber", await paint(mapEnd("two").locator(".nd")) === AMBER);
  check("a line still at work says Not finished, as before", await mapWord("one") === "Not finished");
  check("a merged line does not ask for it", await mapWord("merged") !== "To review");
  const counts = await said(page.locator("#panoSum"));
  check("the summary counts them apart", /2 to review/.test(counts) && /1 finished/.test(counts));
  check("Recent says it too", (await said(page.locator(".rl-recent"))).includes("To review: Two Works ended"));
  await page.screenshot({ path:path.join(shots, "5-map-to-review.png") });

  await mapEnd("two").click(); await page.waitForSelector("#linePage"); await pause(900);
  check("clicking it opens the first Work still waiting", await selected() === "work-1");
  check("the foot of the page says To review", await footWord() === "To review");
  check("so does the line down the side", await sideWord() === "To review");
  check("and the head of the page", await headWord() === "To review");
  check("the foot is amber", await paint(foot.locator(".nd")) === AMBER);
  await page.screenshot({ path:path.join(shots, "6-line-to-review.png") });
  await box(1).hover(); await mark(1).click(); await pause(200);
  check("one of two is not enough", await footWord() === "To review" && await headWord() === "To review");
  await foot.click(); await pause(250);
  check("clicking the foot goes on to the next one", await selected() === "work-2");
  await inPanel.click(); await pause(250);
  check("marking the last says Finished at once, everywhere", await footWord() === "Finished" && await sideWord() === "Finished" && await headWord() === "Finished");
  check("no longer amber", await paint(foot.locator(".nd")) !== AMBER);
  await page.screenshot({ path:path.join(shots, "7-line-finished.png") });
  await box(2).locator(".lp-mark").click(); await pause(200);
  check("undoing one says To review again", await footWord() === "To review" && await sideWord() === "To review" && await headWord() === "To review");
  await box(2).locator(".lp-mark").click();
  await until(() => /^reviewed: /m.test(fs.readFileSync(path.join(p.docsPath, "works/two/work-2.md"), "utf8")), "the last mark saved");
  await home();
  const after = await said(page.locator("#panoSum"));
  check("the map says Finished after a reload, and in green", await mapWord("two") === "Finished" && await paint(mapEnd("two").locator(".nd")) === "rgb(22, 163, 74)");
  check("the summary moves it across", /1 to review/.test(after) && /2 finished/.test(after));
  await page.screenshot({ path:path.join(shots, "8-map-finished.png") });

  // It only changes what the line says. Merge is still there.
  await page.route(stateCall, async route => { const res = await route.fetch(), state = await res.json(); for (const l of state.lines || []) if (l.id === "plain") { l.status = "ready"; l.landed = false; l.branch = "feature/x"; l.base = "main"; } await route.fulfill({ response:res, json:state }); });
  await openLine("plain");
  check("a branch's line can still be merged while it says To review", await headWord() === "To review");
  await page.locator('#lpHead [data-act="merge-now"]').click(); await pause(250);
  check("Merge opens the merge, under its own name", await page.locator('[data-act="merge-ask"]').first().isVisible() && await said(page.locator(".lpp-title h2")) === "Merge");
  await foot.click(); await pause(250);
  check("and To review still goes to the Work", await selected() === "work-1");
  await page.unroute(stateCall);

  await openLine("merged");
  check("a merged line says Merged at its head", await headWord() === "Merged");
  await openLine("gone");
  check("an archived line says Archived, marked or not", await headWord() === "Archived" && await foot.count() === 0);
  // A question comes first. Answer is the only amber on the row, and the line still never says Finished.
  await page.route(stateCall, async route => { const res = await route.fetch(), state = await res.json(); for (const l of state.lines || []) if (l.id === "plain") l.asking = { kind:"reply", agent:"claude", since:Date.now(), step:"work-1", questions:[{ text:"Which one?", options:[] }] }; await route.fulfill({ response:res, json:state }); });
  await home();
  check("a question comes first: Answer leads the row", await said(page.locator('.row[data-row="plain"] .line-hint')) === "Answer");
  check("and the review word steps back, without saying Finished", await mapWord("plain") === "To review" && await paint(mapEnd("plain").locator(".nd")) !== AMBER && await mapEnd("plain").locator(".st-words").evaluate(n => getComputedStyle(n).color) !== "rgb(143, 84, 16)");
  await page.unroute(stateCall);
  await page.route(stateCall, async route => { const res = await route.fetch(), state = await res.json(); for (const key of ["lines", "landed", "backlog"]) for (const l of state[key] || []) for (const st of l.stations) delete st.reviewed; await route.fulfill({ response:res, json:state }); });
  await home();
  check("an older server has no marks, so it says Finished as before", await mapWord("plain") === "Finished");
  await page.unroute(stateCall);

  // Tighter windows.
  for (const [w, h] of [[1280, 800], [1190, 800], [1100, 800], [860, 700]]) {
    await page.setViewportSize({ width:w, height:h }); await open(); await box(2).scrollIntoViewIfNeeded(); await pause(150);
    const over = await page.evaluate(() => [...document.querySelectorAll(".lp-work.is-reviewed > header, .lpp-head")].filter(n => n.offsetParent && n.scrollWidth > n.clientWidth + 2).map(n => n.closest("[id]").id));
    check(`${w}px: nothing spills out of a header`, over.length === 0);
    await page.screenshot({ path:path.join(shots, `w${w}.png`) });
  }
  await page.setViewportSize({ width:1440, height:900 });

  const touch = await browser.newContext({ viewport:{ width:420, height:800 }, hasTouch:true, isMobile:true }), phone = await touch.newPage();
  await phone.goto(`${base}/projects.html#${p.id}/line/one`); await phone.waitForSelector("#lpThread .lp-work"); await pause(250);
  check("on a touch screen the mark always shows", await phone.locator("#item-work-3 .lp-mark").evaluate(n => getComputedStyle(n).opacity) === "1");
  await phone.screenshot({ path:path.join(shots, "phone.png") });
  await touch.close();

  check("no page errors", errors.length === 0);
  console.log(`${passed} checks passed. Pictures in ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server?.close(); s.close?.(); fs.rmSync(temp, { recursive:true, force:true });
});
async function until(test, label, ms = 5000) { const start = Date.now(); while (!test()) { if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await pause(40); } }
