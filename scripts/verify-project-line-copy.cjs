#!/usr/bin/env node
"use strict";
// Real-browser check of Copy on an Ask and on a Work's detail. Needs Playwright: PLAYWRIGHT_PATH=... node scripts/verify-project-line-copy.cjs <shots>
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");

const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "line-copy-browser-"));
const shots = path.resolve(process.argv[2] || path.join(temp, "shots")); fs.mkdirSync(shots, { recursive:true });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64");
let here = true, browser, server, passed = 0;
const errors = [], copiedFiles = [], copiedWords = [];
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`ok ${label}`); };
const same = (label, actual, expected) => { assert.equal(actual, expected, label); passed++; console.log(`ok ${label}`); };
const agents = { available:() => [{ id:"claude", name:"Claude", mono:"Cl", color:"#334155", available:false }], nameOf:() => "Claude" };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} }, clipboardFiles:files => copiedFiles.push(files), clipboard:text => copiedWords.push(text) }, isThisComputer:() => here, authorizeRead:() => null, authorizeWrite:() => null, readJson:async req => { let body = ""; for await (const part of req) body += part; return JSON.parse(body || "{}"); }, send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Copy", docsPath:path.join(temp, "Project docs") }); p.follow = false; p.offerSkill = false; s.store.save();
const put = (slug, name, body = PNG) => { const file = path.join(p.docsPath, "files", slug, name); fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, body); return { rel:`files/${slug}/${name}`, full:path.join(fs.realpathSync(p.docsPath), "files", slug, name), link:`![${name}](../files/${slug}/${name})` }; };
const LONG = Array.from({ length:30 }, (_, i) => `Line ${i + 1} of a long Ask`).join("\n");
const one = put("copy", "one.png"), a = put("copy", "a.png"), b = put("copy", "b.png"), drawn = put("copy", "drawn.png"), notes = put("copy", "notes.txt", "notes"), only = put("copy", "only.png");
const work = body => F.workStep({ who:"claude", done:true, took:"1 min", body });
const RAW = "**Bold first.** Then a [link](https://example.com).\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
s.writeDoc(p, "copy", F.initialLine({ title:"Copying", status:"done", created:"2026-11-07 09:00", steps:[
  F.askStep({ words:"Plain words only", when:"2026-11-07 09:00", via:"Claude desktop" }),
  work("Short note 1"),
  F.askStep({ words:`<in-app-browser-context>hidden</in-app-browser-context>\n<pasted_content id="n">One picture here</pasted_content id="n">\n\n${one.link}`, when:"2026-11-07 09:10" }),
  work("Short note 2"),
  F.askStep({ words:`Two pictures here\n\n${a.link}\n\n${b.link}`, when:"2026-11-07 09:20" }),
  work(`Short note 3\n\n${drawn.link}`),
  F.askStep({ words:LONG, when:"2026-11-07 09:30" }),
  work(only.link),
] }));
for (const [work, result] of [["work-1", RAW], ["work-3", `See [the notes](../../files/copy/notes.txt).\n\n${RAW}`]]) {
  const file = path.join(p.docsPath, "works", "copy", `${work}.md`); fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, `---\nline: ../copy.md\nstep: Work ${work.at(-1)}\nwho: @claude\n---\n\n# ${work}\n\n## Result\n\n<!-- result: the agent's last message -->\n${result}\n<!-- /result -->\n\n## How it was done\n\n- Ran a thing\n`);
}
s.sync(p);
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp" };
const pause = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, "public", `.${url.pathname}`);
    if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type":mime[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel:"chrome" });
  const ctx = await browser.newContext({ viewport:{ width:1440, height:900 }, reducedMotion:"reduce", permissions:["clipboard-read", "clipboard-write"] }), page = await ctx.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${base}/projects.html#${p.id}`);
  await page.waitForFunction(() => window.__lines?.project()?.lines.length === 1);
  await page.evaluate(() => window.__lines.go({ view:"line", line:"copy" }));
  await page.waitForSelector("#linePage .lp-ask");
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  const clipTypes = () => page.evaluate(async () => (await navigator.clipboard.read()).flatMap(item => [...item.types]));
  const askAt = i => page.locator(".lp-ask").nth(i);
  const press = async i => { await askAt(i).hover(); await askAt(i).locator("[data-act='copy-step']").click(); await pause(150); };

  // The Ask's footer: beside Refer, waiting for a hover as Refer does.
  check("an Ask's Copy waits for a hover, like Refer", await askAt(0).locator("[data-act='copy-step']").evaluate(e => getComputedStyle(e).opacity) === "0");
  await askAt(0).hover(); await page.waitForFunction(() => getComputedStyle(document.querySelector(".lp-ask .lp-copy-btn")).opacity === "1");
  const copyBox = await askAt(0).locator("[data-act='copy-step']").boundingBox(), referBox = await askAt(0).locator(".lp-refer-btn").boundingBox();
  check("Copy sits just before Refer on the same row", Math.abs(copyBox.y - referBox.y) < 2 && copyBox.x + copyBox.width <= referBox.x);
  await page.screenshot({ path:path.join(shots, "ask-hover.png") });

  await press(0);
  same("words alone are copied as they are", await clip(), "Plain words only");
  check("and there is nothing more to press", await askAt(0).locator("[data-act='copy-files'], [data-act='copy-apart']").count() === 0);

  // One picture: Claude's box keeps only the picture from a paste holding both, so they never share one.
  await askAt(1).hover(); await pause(200);
  same("one picture: the first button says text", (await askAt(1).locator("[data-act='copy-step']").innerText()).trim(), "Copy text");
  same("one picture: the second says the picture", (await askAt(1).locator("[data-act='copy-files']").innerText()).trim(), "Copy the picture");
  await press(1);
  same("the clipboard holds only words, so no box can drop them", (await clipTypes()).join(), "text/plain");
  same("what apps wrap around your words stays out", await clip(), "One picture here");
  await page.screenshot({ path:path.join(shots, "ask-one-picture.png") });
  await askAt(1).locator("[data-act='copy-files']").click(); await pause(150);
  check("the picture itself goes on the clipboard, by full path", JSON.stringify(copiedFiles.at(-1)) === JSON.stringify([one.full]));
  await page.mouse.move(5, 5); await pause(200);

  // Two pictures, the case in the owner's screenshot: no paste holds the words and both, so both buttons are there from the start.
  const more = askAt(2).locator("[data-act='copy-files']");
  await askAt(2).hover(); await pause(200);
  same("two pictures: the first button says text", (await askAt(2).locator("[data-act='copy-step']").innerText()).trim(), "Copy text");
  same("two pictures: the second says how many, before anything is pressed", (await more.innerText()).trim(), "Copy 2 pictures");
  await page.screenshot({ path:path.join(shots, "ask-two-pictures-hover.png") });
  await page.mouse.move(5, 5); await pause(200);
  check("both wait for a hover, like Refer", await more.evaluate(e => getComputedStyle(e).opacity) === "0");
  await press(2);
  same("Copy text is the words alone", await clip(), "Two pictures here");
  await page.mouse.move(5, 5); await pause(200);
  check("after Copy text the picture button stays for when you come back", await more.evaluate(e => getComputedStyle(e).opacity) === "1");
  await page.screenshot({ path:path.join(shots, "ask-two-pictures.png") });
  await more.click(); await pause(150);
  check("both files go on the clipboard", JSON.stringify(copiedFiles.at(-1)) === JSON.stringify([a.full, b.full]));
  await page.mouse.move(5, 5); await pause(200);

  const before2 = s.readDoc(p, "copy");
  s.writeDoc(p, "copy", before2.replace("Two pictures here\n\n", ""));
  s.sync(p); await page.evaluate(async () => { await loadState(S.cur, { force:true }); refreshAfterChange(); }); await pause(200);
  await askAt(2).hover(); await pause(200);
  check("pictures with no words have only the picture button", await askAt(2).locator("[data-act='copy-step']").count() === 0 && await askAt(2).locator("[data-act='copy-files']").count() === 1);
  s.writeDoc(p, "copy", before2); s.sync(p); await page.evaluate(async () => { await loadState(S.cur, { force:true }); refreshAfterChange(); }); await pause(200);

  await press(3);
  same("a long Ask copies whole, not what is clamped", await clip(), LONG);

  // A quote above an Ask goes with it.
  const before = s.readDoc(p, "copy");
  s.writeDoc(p, "copy", before.replace("Plain words only", `Plain words only\n\n> Refers to [Work 3](copy/work-3.md): Short note 3`));
  s.sync(p); await page.evaluate(async () => { await loadState(S.cur, { force:true }); refreshAfterChange(); }); await pause(200);
  await press(0);
  const quoted = await clip();
  check("a quote goes with it, in the form an agent is told", quoted.startsWith("For context only, not a new request: this refers to Work 3 in ") && quoted.includes(path.join("works", "copy", "work-3.md")) && quoted.endsWith(", which said:\n> Short note 3\n\nPlain words only"));
  const parsed = F.parseHandoff(quoted, fs.realpathSync(p.docsPath));
  check("and comes back from an agent as just the words", parsed.words === "Plain words only");
  const parsedFiles = F.parseHandoff(`Two pictures here\n\nAttached:\n${a.full}\n${b.full}`, fs.realpathSync(p.docsPath));
  check("the list of files is read back too", parsedFiles.words === "Two pictures here" && parsedFiles.files.length === 2);
  s.writeDoc(p, "copy", before); s.sync(p); await page.evaluate(async () => { await loadState(S.cur, { force:true }); refreshAfterChange(); });

  // The Work's detail.
  const openWork = n => page.evaluate(step => window.__lines.go({ view:"line", line:"copy", step }), `work-${n}`);
  await openWork(1); await page.waitForSelector("#lppResult .lpp-copy .lp-copy-btn");
  // Copy and the </> switch show while the pointer is on the result (PE-478).
  const tools = page.locator("#lppResult .lpp-result-tools"), onResult = () => page.locator("#lppResult .result-text").hover().then(() => pause(200));
  await onResult();
  const src = await tools.locator(".lpp-src").boundingBox(), copy = await tools.locator("[data-act='copy-step']").boundingBox();
  check("a Work's Copy sits beside the </> switch", Math.abs((copy.y + copy.height / 2) - (src.y + src.height / 2)) < 3 && copy.x < src.x);
  await page.screenshot({ path:path.join(shots, "work.png") });
  await tools.locator("[data-act='copy-step']").click(); await pause(150);
  same("from Reading it copies the raw Markdown", await clip(), RAW);
  await tools.locator(".lpp-src").click(); await pause(100);
  await page.locator("#lppResult [data-act='copy-step']").click(); await pause(150);
  same("from Source the same", await clip(), RAW);
  same("what it copied is what Source shows, without the line numbers", (await page.locator("#lppResult .src").innerText()).replace(/[\s\d]+/g, ""), RAW.replace(/[\s\d]+/g, ""));
  await page.locator("#lppResult .lpp-src").click(); await pause(100);

  // Words and files apart: one Copy ▾ with both.
  await openWork(3); await page.waitForSelector("#lppResult .lp-copy-btn"); await pause(300); await onResult();
  await page.locator("#lppResult [data-act='copy-menu']").click();
  same("a Work with attachments offers Copy text first", (await page.locator("#menu button").first().innerText()).trim(), "Copy text");
  await page.locator("#menu button").first().click(); await pause(200);
  same("and copies its raw words alone", await clip(), `See [the notes](../../files/copy/notes.txt).\n\n${RAW}`);
  const workMore = page.locator("#lppResult [data-act='copy-files']");
  check("then the files are one click away, and are called files", /Copy 2 files/.test(await workMore.innerText()));
  await page.screenshot({ path:path.join(shots, "work-attachments.png") });
  await workMore.click(); await pause(150);
  check("both reach the clipboard", JSON.stringify(copiedFiles.at(-1)) === JSON.stringify([drawn.full, notes.full]));

  await openWork(4); await page.waitForSelector("#lppResult .lp-copy-btn"); await pause(200);
  check("a Work that left only a picture still has Copy", await page.locator("#lppResult .lp-copy-btn").first().isVisible());

  await page.locator("[data-act='panel-close']").click(); await pause(150);

  // From another computer the files cannot be put on this one's clipboard.
  here = false; await page.evaluate(() => loadAgents());
  await press(2);
  same("from another computer the paths are how the files go along", await clip(), `Two pictures here\n\nAttached:\n${a.full}\n${b.full}`);
  same("and the button just says Copy", (await askAt(2).locator("[data-act='copy-step']").innerText()).trim(), "Copy");
  check("and no button offers what it cannot do", await askAt(2).locator("[data-act='copy-files']").count() === 0);
  here = true; await page.evaluate(() => loadAgents());

  // A window that denies the page's clipboard, as the Claude desktop app's Browser pane does.
  const lightbox = () => page.locator("#lightbox .lb-card").count();
  const refused = () => page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("denied")); navigator.clipboard.write = () => Promise.reject(new Error("denied")); });
  const realWords = s.clipboard;
  await refused();
  await page.evaluate(() => navigator.clipboard.readText()).catch(() => {});
  copiedWords.length = 0; await press(0);
  check("denied: an Ask's words reach the clipboard through PenEcho, with no popup", copiedWords[0] === "Plain words only" && await lightbox() === 0);
  copiedWords.length = 0; await openWork(1); await page.waitForSelector("#lppResult [data-act='copy-step']"); await pause(200);
  await page.locator("#lppResult [data-act='copy-step']").click(); await pause(200);
  check("denied: a Work's result does too, with no popup", copiedWords[0] === RAW && await lightbox() === 0);
  await page.locator("[data-act='panel-close']").click(); await pause(150);
  // PenEcho cannot either: the browser's older command still can.
  s.clipboard = () => { throw new Error("no pbcopy"); };
  await press(0);
  check("PenEcho also failing: the older command copies it, with no popup", await lightbox() === 0 && await clip() === "Plain words only");
  // From another computer it goes straight to the older command.
  here = false; await page.evaluate(() => loadAgents()); s.clipboard = realWords; copiedWords.length = 0;
  await press(0);
  check("another computer: PenEcho's clipboard is not touched", copiedWords.length === 0 && await lightbox() === 0 && await clip() === "Plain words only");
  here = true; await page.evaluate(() => loadAgents());
  // Only when every way has failed.
  await page.evaluate(() => { document.execCommand = () => false; }); s.clipboard = () => { throw new Error("no pbcopy"); };
  await press(0);
  check("every way failing: only then the box opens", await lightbox() === 1 && await page.locator("#copyArea").inputValue() === "Plain words only");
  await page.locator("#lightbox [data-act='lb-close']").click();
  // The files cannot go, so where they are does.
  await page.reload(); await page.waitForSelector("#linePage .lp-ask"); await pause(300);
  s.clipboard = realWords;
  const realFiles = s.clipboardFiles; s.clipboardFiles = () => { throw new Error("no osascript"); };
  await page.locator("[data-act='panel-close']").click().catch(() => {}); await pause(150);
  await askAt(2).hover(); await more.click(); await pause(200);
  same("files failing: their paths are copied instead", await clip(), `${a.full}\n${b.full}`);
  s.clipboardFiles = realFiles;

  // Archived: nothing can be referred to, and words can still be copied.
  s.writeDoc(p, "copy", s.readDoc(p, "copy").replace(/^status: .*$/m, "status: closed")); s.sync(p);
  await page.evaluate(async () => { await loadState(S.cur, { force:true }); refreshAfterChange(); }); await pause(200);
  await askAt(0).hover();
  check("a closed line has no Refer, and keeps Copy", await askAt(0).locator(".lp-refer-btn").count() === 0 && await askAt(0).locator("[data-act='copy-step']").count() === 1);
  s.writeDoc(p, "copy", before); s.sync(p); await page.evaluate(async () => { await loadState(S.cur, { force:true }); refreshAfterChange(); });

  // Phone width.
  await page.setViewportSize({ width:390, height:844 }); await pause(250);
  await press(2);
  check("on a phone width the Ask's buttons fit", await page.evaluate(() => { const v = document.documentElement; const ask = document.querySelectorAll(".lp-ask")[2].querySelector(".lp-from"); return v.scrollWidth <= v.clientWidth && ask.scrollWidth <= ask.clientWidth + 1; }));
  await page.screenshot({ path:path.join(shots, "narrow.png") });

  check("no page errors", errors.length === 0);
  console.log(`${passed} checks passed`);
})().catch(error => { console.error(error); console.error(errors); process.exitCode = 1; }).finally(async () => {
  await browser?.close().catch(() => {});
  server?.close();
  api.close?.();
  fs.rmSync(temp, { recursive:true, force:true });
});
