#!/usr/bin/env node
"use strict";
// The box's bar (PE-445, PE-519), in a real browser against a real server: + then the five chips, then the branch and Send to AI.
// Always one row ("two lines are not acceptable"). When it does not fit, make.js fitBar gives up room step by step: the keys,
// then letters from a long branch's middle, then the chips' words (the chosen one keeps its word), then Send's words, then the chips go
// inside +, then the branch's name. Nothing is cut off or on top of another at any width, on the Home, on a line, with a chip chosen.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-box-bar.cjs [screenshot-folder]
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) fs.mkdirSync(shots, { recursive:true });
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-box-bar-")));
const PORT = 4400 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 600)}` : ""}`); }
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
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding:"utf8", stdio:["ignore", "pipe", "pipe"] }).trim();

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_LINES_EXAMPLES:"0", HOME:temp, SHELL:"/bin/sh", PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let log = ""; server.stdout.on("data", d => { log += d; }); server.stderr.on("data", d => { log += d; });

// Where each thing in the bar is, and whether it is on one row, whole, inside the box and clear of the others.
const laid = (page, sel) => page.evaluate(sel => {
  const form = document.querySelector(sel), bar = form.querySelector(".cmp-bar"), frame = form.getBoundingClientRect();
  const shown = el => Boolean(el) && el.getClientRects().length > 0;
  const els = [form.querySelector(".cmp-plus"), ...form.querySelectorAll(".cmp-chip"), form.querySelector(".box-branch"), form.querySelector(".send-split")].filter(shown);
  const r = els.map(e => e.getBoundingClientRect());
  const inside = r.every(a => a.width > 0 && a.left >= frame.left - 1 && a.right <= frame.right + 1);
  const apart = r.every((a, i) => r.every((b, j) => j <= i || a.right <= b.left + .5 || b.right <= a.left + .5 || a.bottom <= b.top + .5 || b.bottom <= a.top + .5));
  const mid = a => (a.top + a.bottom) / 2, oneRow = r.every(a => Math.abs(mid(a) - mid(r[0])) < 4);
  const whole = [...form.querySelectorAll(".cmp-chip span, .box-branch .bb-name:not(:has(.bb-head)), .box-branch .bb-tail, .send-btn > span")].filter(shown).every(s => s.scrollWidth <= s.clientWidth + 1);
  const send = form.querySelector(".send-split")?.getBoundingClientRect(), words = form.querySelector(".send-btn > span");
  const steps = ["no-keys", "short-branch", "icon-chips", "icon-send", "fold-chips", "icon-branch"].filter(k => bar.classList.contains(k));
  return { ok:inside && apart && whole && oneRow, inside, apart, whole, oneRow, steps, sendRight:send ? frame.right - send.right < 30 : false,
    words:[...form.querySelectorAll(".cmp-chip span")].filter(shown).map(s => s.textContent), chips:[...form.querySelectorAll(".cmp-chip")].filter(shown).length,
    branch:[...form.querySelectorAll(".box-branch .bb-name")].filter(shown).map(s => s.textContent).join(""),
    // How much of a long name shows: its start up to where it is cut, then its end.
    seen:(() => { const head = form.querySelector(".box-branch .bb-head"), tail = form.querySelector(".box-branch .bb-tail"); if (!shown(head)) return ""; const r = document.createRange(), box = head.getBoundingClientRect(); let n = 0; for (; n < head.textContent.length; n++) { r.setStart(head.firstChild, n); r.setEnd(head.firstChild, n + 1); if (r.getBoundingClientRect().right > box.right + .5) break; } return n === head.textContent.length ? head.textContent + tail.textContent : head.textContent.slice(0, n) + "…" + tail.textContent; })(),
    send:shown(words) ? words.textContent : "", where:form.querySelectorAll(".cmp-where").length, width:Math.round(frame.width) };
}, sel);
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

(async () => {
  let browser;
  try {
    await until(() => fetch(`${base}/api/lines/projects`).then(r => r.ok), "the server", 30000);
    const code = path.join(temp, "Alpha code"), docs = path.join(temp, "Alpha docs");
    fs.mkdirSync(code, { recursive:true });
    fs.writeFileSync(path.join(code, "README.md"), "# Alpha\n");
    git(code, "init", "-q", "-b", "main"); git(code, "config", "user.name", "Test"); git(code, "config", "user.email", "test@example.com");
    git(code, "add", "-A"); git(code, "commit", "-q", "-m", "first");
    // A long branch with work of its own, so it is not merged.
    git(code, "checkout", "-q", "-b", "claude/one-row-ask-box-design");
    fs.writeFileSync(path.join(code, "box.md"), "# Box\n");
    git(code, "add", "-A"); git(code, "commit", "-q", "-m", "box");
    git(code, "checkout", "-q", "main");
    const { project:alpha } = await api("/projects", { method:"POST", body:{ name:"Alpha", docsPath:docs, codePath:code } });
    fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
    fs.writeFileSync(path.join(docs, "lines", "sign-in-flow.md"), `---\nid: T-1\nstatus: done\ncreated: 2026-11-15 10:00\n---\n\n# Sign-in flow\n\n## Ask · 2026-11-15 10:00\n\nDraw the sign-in flow.\n\n## [x] Work 1 · @claude · 1 min\n\nDone.\n`);

    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
    const context = await browser.newContext({ viewport:{ width:1440, height:900 }, hasTouch:true });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    const box = ".dock-wrap .composer";
    await page.goto(`${base}/projects.html#${alpha.id}`);
    await until(() => page.locator(`${box} .cmp-chip`).count().then(n => n === 4 || n === 5), "the chips");
    await until(() => page.locator(`${box} .box-branch`).isVisible(), "the branch");
    await wait(200);
    const snap = async name => { if (shots) await page.locator(box).screenshot({ path:path.join(shots, `${name}.png`) }); };
    const at = async width => { await page.setViewportSize({ width, height:900 }); await frames(page); await wait(40); return laid(page, box); };

    const wide = await laid(page, box);
    check("on a wide Home the bar is one row: +, the chips with their words, the branch and Send to AI, nothing given up", wide.ok && !wide.steps.length && wide.sendRight && wide.send === "Send to AI" && wide.branch === "main", JSON.stringify(wide));
    check("the chips say what you can get back", ["Diagram", "Explorer", "Slides", "Note card"].every(w => wide.words.includes(w)), wide.words.join(" | "));
    check("no New line tag: the placeholder says it", wide.where === 0 && /new line/i.test(await page.getAttribute(`${box} .cmp-input`, "placeholder")));
    check("the branch is quiet: not a dark pill beside Send", await page.locator(`${box} .box-branch`).evaluate(el => { const c = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number); return c[0] + c[1] + c[2] > 600; }));
    await snap("home-1440");

    // Every 4 px from a wide window to a phone: one row, whole, and the steps only ever grow as the box narrows.
    const bad = [], seen = new Map();
    let last = -1;
    for (let width = 1440; width >= 320; width -= 4) {
      const now = await at(width);
      if (!now.ok || !now.sendRight) bad.push({ viewport:width, ...now });
      if (now.steps.length < last) bad.push({ viewport:width, wentBack:true, ...now });
      last = now.steps.length;
      if (!seen.has(now.steps.join(" "))) seen.set(now.steps.join(" "), width);
    }
    check("one row at every 4 px step from 1440 to 320 px, nothing cut off or on top of another", !bad.length, JSON.stringify(bad.slice(0, 4)));
    check("the steps come in order as the box narrows", [...seen.keys()].every((k, i, all) => i === 0 || k.startsWith(all[i - 1])), JSON.stringify([...seen]));
    console.log(`      widest viewport of each step: ${JSON.stringify([...seen].map(([k, w]) => [k || "full", w]))}`);
    check("main is never shortened", (await at(390)).branch === "main");

    for (const width of [1100, 900, 700, 560, 390, 320]) { await at(width); await snap(`home-${width}`); }
    const phone = await at(390);
    check("on a phone the chips are inside +", phone.chips === 0 && phone.steps.includes("fold-chips"), JSON.stringify(phone));
    await page.click(`${box} .cmp-plus`);
    await until(() => page.locator("#menu").isVisible(), "the + menu");
    const menu = await page.locator("#menu").innerText();
    check("  and + offers the kinds", ["Diagram", "Explorer", "Slides", "Note card"].every(w => menu.includes(w)), menu);
    await page.locator("#menu button", { hasText:"Slides" }).click();
    await wait(150);
    const phoneSlides = await laid(page, box);
    check("  a kind chosen from + stays in the bar, with its word", phoneSlides.ok && phoneSlides.chips === 1 && phoneSlides.words.join() === "Slides", JSON.stringify(phoneSlides));
    await snap("home-390-slides");
    await page.click(`${box} .cmp-chip[data-kind="slides"]`);

    await at(900);
    await page.evaluate(() => { document.documentElement.dataset.mode = "dark"; });
    await frames(page);
    check("dark mode: one row, every control whole", (await laid(page, box)).ok);
    await snap("home-900-dark");
    await page.evaluate(() => { delete document.documentElement.dataset.mode; });

    await at(1440);
    await page.locator(`${box} .box-branch`).focus();
    await page.keyboard.press("Enter");
    await until(() => page.locator("#menu.branch-menu").isVisible(), "keyboard branch picker");
    check("the branch picker opens from the keyboard", await page.locator("#menu .branch-trunk").getAttribute("aria-checked") === "true");
    await page.keyboard.press("Escape");
    check("Escape closes branch options and returns focus to the picker", await page.locator("#menu.branch-menu").count() === 0 && await page.locator(`${box} .box-branch`).evaluate(el => el === document.activeElement));

    // A long branch: whole when there is room, then its start and end, never on a row of its own.
    const long = "claude/one-row-ask-box-design";
    await page.locator(`${box} .box-branch`).click();
    await until(() => page.locator(`#menu [data-branch="${long}"]`).isVisible(), "the long branch in the menu");
    await page.locator(`#menu [data-branch="${long}"]`).click();
    await wait(800);
    const longWide = await laid(page, box);
    check("on the widest Home box a long branch shows as much of its name as fits, its end whole, and the chips keep their words", longWide.ok && longWide.words.length >= 4 && longWide.seen.startsWith("claude/one-") && longWide.seen.endsWith("-design"), JSON.stringify(longWide));
    await snap("home-1440-long-branch");
    const longBad = [], longSeen = new Map();
    for (let width = 1440; width >= 320; width -= 8) {
      const now = await at(width);
      if (!now.ok || !now.sendRight) longBad.push({ viewport:width, ...now });
      if (!longSeen.has(now.steps.join(" "))) longSeen.set(now.steps.join(" "), [width, now.seen]);
    }
    check("with a long branch: one row at every 8 px step from 1440 to 320 px", !longBad.length, JSON.stringify(longBad.slice(0, 3)));
    console.log(`      long branch, widest viewport of each step: ${JSON.stringify([...longSeen].map(([k, v]) => [k || "full", ...v]))}`);
    const shortened = [...longSeen].find(([k]) => k.split(" ").includes("short-branch"));
    check("  shortened, it keeps its start and its end, before any chip loses its word", shortened && /^claude\/\S*…-design$/.test(shortened[1][1]) && !shortened[0].includes("icon-chips"), JSON.stringify(shortened));
    for (const width of [900, 700, 390]) { await at(width); await snap(`home-${width}-long-branch`); }
    await at(1440);
    await page.locator(`${box} .box-branch`).click();
    await page.locator("#menu .branch-off").click();
    await wait(800);
    const off = await laid(page, box);
    check("Off main keeps its complete label", off.ok && off.branch === "Off main", JSON.stringify(off));
    await page.locator(`${box} .box-branch`).click();
    await page.locator("#menu .branch-trunk").click();
    await wait(800);

    // A chip chosen: one row, wide and narrow; when the words go, the chosen one keeps its word.
    await page.click(`${box} .cmp-chip[data-kind="slides"]`);
    await wait(150);
    const chosen = await laid(page, box);
    check("with Slides chosen, the bar is still one row", chosen.ok && await page.locator(`${box} .cmp-chip.on[data-kind="slides"]`).count() === 1, JSON.stringify(chosen));
    await snap("home-1440-slides");
    const chosenNarrow = await at(640);
    check("and narrow, still one row, Slides keeping its word", chosenNarrow.ok && chosenNarrow.words.includes("Slides"), JSON.stringify(chosenNarrow));
    await snap("home-640-slides");
    await page.click(`${box} .cmp-chip[data-kind="slides"]`);

    // Save as note: the same one row.
    await at(700);
    await page.click(`${box} .send-pick`);
    await page.locator("#menu button", { hasText:"Save as note" }).click();
    await wait(100);
    check("Save as note: still one row", (await laid(page, box)).ok);
    await snap("home-700-note");
    await page.click(`${box} .send-pick`);
    await page.locator("#menu button", { hasText:"Send to AI" }).click();

    // On a line: no branch, the chips and Send.
    await page.setViewportSize({ width:1440, height:900 });
    await page.goto(`${base}/projects.html#${alpha.id}/line/sign-in-flow`);
    const lineBox = ".lp-dock .composer";
    await until(() => page.locator(`${lineBox} .cmp-chip`).count().then(n => n >= 4), "the line's chips");
    await wait(200);
    const onLine = await laid(page, lineBox);
    check("on a line the bar is one row, with no branch, nothing given up", onLine.ok && !onLine.steps.length && await page.locator(`${lineBox} .box-branch`).count() === 0, JSON.stringify(onLine));
    if (shots) await page.locator(lineBox).screenshot({ path:path.join(shots, "line-1440.png") });
    const lineBad = [];
    for (let width = 1440; width >= 320; width -= 8) {
      await page.setViewportSize({ width, height:900 }); await frames(page);
      const now = await laid(page, lineBox); if (!now.ok || !now.sendRight) lineBad.push({ viewport:width, ...now });
      if (shots && [600, 392].includes(width)) await page.locator(lineBox).screenshot({ path:path.join(shots, `line-${width}.png`) });
    }
    check("on a line: one row at every 8 px step from 1440 to 320 px", !lineBad.length, JSON.stringify(lineBad.slice(0, 3)));

    // The end of a line: only New canvas. The box right below has the same five as chips, so Make with AI is gone (PE-478).
    await page.setViewportSize({ width:1440, height:900 });
    await wait(250);
    const ends = await page.locator(".lp-thread-adds button").allTextContents();
    check("the end of a line has one button: New canvas", ends.length === 1 && /new canvas/i.test(ends[0]), ends.join(" | "));
    await page.click(`${lineBox} .cmp-chip[data-kind="meetcue"]`);
    await until(() => page.locator(`${lineBox} .cmp-mc`).isVisible(), "MeetCue in the box");
    await until(() => page.locator(`${lineBox} .cmp-mc .btn.primary`).count().then(n => n === 1), "the way to link");
    const mcSays = await page.locator(`${lineBox} .cmp-mc`).innerText();
    check("MeetCue, not linked, says so and offers the way to link", /sign in|link meetcue/i.test(mcSays), mcSays);
    await page.click(`${lineBox} .cmp-mc .cmp-make-x`);
    await wait(100);
    check("closing MeetCue empties the box's top again", await page.locator(`${lineBox} .cmp-mc`).count() === 0);
    await Promise.all([page.waitForURL(/view=canvas|\/canvas|draft/, { timeout:10000 }).catch(() => null), page.click(".lp-newcv")]);
    await wait(300);
    check("New canvas opens the Canvas", /canvas/i.test(page.url()), page.url());

    check("no page errors", !errors.length, errors.join(" | "));
  } catch (error) {
    failures.push(error.message); console.log(`FAIL  ${error.stack || error.message}`);
  } finally {
    await browser?.close().catch(() => {});
    server.kill();
    fs.rmSync(temp, { recursive:true, force:true });
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) { console.log(log.slice(-2000)); process.exitCode = 1; }
  }
})();
