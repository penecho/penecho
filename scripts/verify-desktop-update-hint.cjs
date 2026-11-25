#!/usr/bin/env node
"use strict";
// The desktop app's update hint on the Projects page (public/lines/desktop-update.js), in a real browser with the
// desktop preload's update bridge stood in: nothing shows until a newer release is found; Update downloads it in the
// background with its progress at the sidebar's foot; Restart to update installs it, and asks first while agents work;
// a failure opens the update window; Settings → About shows the installed version and the same next step.
// The browser and penecho.ai, with no bridge, never show it.
//   NODE_PATH=/path/to/node_modules node scripts/verify-desktop-update-hint.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-update-hint-"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 6000 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
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

// What desktop/canvas-preload.js puts on the page, driven from the test.
function bridge() {
  const listeners = new Set();
  let state = { status:"idle", visible:false, currentVersion:"1.5.0", version:"", progress:null, error:"", ready:false, updateAvailable:false };
  window.__updateCalls = [];
  window.__updatePush = next => { state = { ...state, ...next }; listeners.forEach(fn => fn(state)); };
  const call = name => async () => { window.__updateCalls.push(name); return true; };
  window.penechoDesktopUpdate = Object.freeze({
    getState:async () => state,
    check:call("check"), showWindow:call("showWindow"), download:call("download"), dismiss:call("dismiss"), install:call("install"),
    onStateChange:fn => { listeners.add(fn); return () => listeners.delete(fn); },
  });
}

const docs = path.join(temp, "docs");
fs.mkdirSync(docs, { recursive:true });
const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  let browser;
  try {
    await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
    const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
    const made = await (await context.request.post(`${base}/api/lines/projects`, { data:{ name:"Garden", docsPath:docs, offerSkill:false }, headers:{ origin:base } })).json();
    const id = made.project?.id;
    check("a project to open", Boolean(id), JSON.stringify(made));

    // ---------- In a plain browser there is no bridge, so no hint ----------
    const plain = await context.newPage();
    const errors = [];
    plain.on("pageerror", e => errors.push(e.message));
    await plain.goto(`${base}/projects.html#p/${id}`);
    await until(() => plain.evaluate(() => Boolean(document.querySelector("#railAccount"))), "the sidebar");
    await wait(400);
    check("no bridge: the sidebar has no update hint", await plain.evaluate(() => !document.querySelector("#railUpdate")?.innerHTML));
    await plain.close();

    // ---------- In the desktop app ----------
    await context.addInitScript(bridge);
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    page.on("dialog", d => { page.__dialogs = (page.__dialogs || []).concat(d.message()); void (page.__accept ? d.accept() : d.dismiss()); });
    await page.goto(`${base}/projects.html#p/${id}`);
    await until(() => page.evaluate(() => Boolean(document.querySelector("#railUpdate"))), "the sidebar slot");
    const hint = () => page.evaluate(() => { const b = document.querySelector("#railUpdate .rail-update"); return b ? { text:b.textContent.trim(), cls:b.className, act:b.dataset.act || "", disabled:b.disabled, title:b.title } : null; });
    const push = state => page.evaluate(s => window.__updatePush(s), state);
    const calls = () => page.evaluate(() => window.__updateCalls.slice());

    check("nothing found: no hint", (await hint()) === null);
    await push({ status:"checking" });
    check("a check alone shows nothing", (await hint()) === null);
    await push({ status:"up-to-date", version:"1.5.0" });
    check("up to date: no hint", (await hint()) === null);

    await push({ status:"available", version:"1.6.0", updateAvailable:true, notes:"- Faster Home" });
    let h = await hint();
    check("found: Update to v1.6.0", h?.text === "Update to v1.6.0" && h.act === "update-download", JSON.stringify(h));
    const box = await page.locator("#railUpdate").boundingBox(), foot = await page.locator("#railAccount").boundingBox();
    check("the hint sits just above the sidebar's foot", box && foot && box.y + box.height <= foot.y + 1 && foot.y - (box.y + box.height) < 20, JSON.stringify({ box, foot }));
    await page.screenshot({ path:path.join(shots, "1-available.png") });
    await page.click("#railUpdate .rail-update");
    check("Update starts the download without a window", JSON.stringify(await calls()) === '["download"]', JSON.stringify(await calls()));

    await push({ status:"downloading", progress:null });
    h = await hint();
    check("downloading, size unknown: a moving bar, no percent", h?.text === "Downloading update" && /is-busy/.test(h.cls) && await page.locator(".rail-update-bar.is-unknown").count() === 1, JSON.stringify(h));
    await push({ status:"downloading", progress:42.6 });
    h = await hint();
    check("downloading: percent and bar", h?.text === "Downloading update43%" && await page.evaluate(() => document.querySelector(".rail-update").style.getPropertyValue("--p")) === "43%", JSON.stringify(h));
    await page.screenshot({ path:path.join(shots, "2-downloading.png") });
    await page.click("#railUpdate .rail-update");
    check("clicking the download opens the update window", (await calls()).at(-1) === "showWindow");

    await push({ status:"ready", progress:100, ready:true });
    h = await hint();
    check("ready: Restart to update", h?.text === "Restart to update" && /is-ready/.test(h.cls) && h.act === "update-restart", JSON.stringify(h));
    await page.screenshot({ path:path.join(shots, "3-ready.png") });
    await page.click("#railUpdate .rail-update");
    check("no agent working: restart at once", (await calls()).at(-1) === "install" && !page.__dialogs);

    // An agent at work: asked first, and nothing happens on Cancel.
    const before = (await calls()).length;
    // Two agents at work in another project, as the list the server sends every few seconds has them.
    await page.evaluate(() => { S.projects.push({ id:"other", name:"Other", lines:[{ id:"a", status:"working" }, { id:"b", status:"working" }] }); });
    page.__accept = false;
    await page.click("#railUpdate .rail-update");
    check("agents working: asks before restarting", /2 agents are still working/.test((page.__dialogs || []).at(-1) || ""), JSON.stringify(page.__dialogs));
    check("Cancel keeps PenEcho running", (await calls()).length === before);
    page.__accept = true;
    await page.click("#railUpdate .rail-update");
    check("OK restarts", (await calls()).at(-1) === "install");
    await page.evaluate(() => { S.projects = S.projects.filter(p => p.id !== "other"); });

    await push({ status:"installing" });
    h = await hint();
    check("installing: Restarting…, not clickable", h?.text === "Restarting…" && h.disabled, JSON.stringify(h));

    await push({ status:"error", ready:false, error:"PenEcho could not check GitHub Releases. HTTP 503." });
    h = await hint();
    check("failed: Update failed, Retry, the reason on hover", h?.text === "Update failedRetry" && /HTTP 503/.test(h.title), JSON.stringify(h));
    await page.screenshot({ path:path.join(shots, "4-error.png") });
    await page.click("#railUpdate .rail-update");
    check("a failure opens the update window", (await calls()).at(-1) === "showWindow");

    // ---------- Settings → About ----------
    await push({ status:"ready", ready:true, progress:100, error:"" });
    await page.evaluate(() => { location.hash = "#settings/general"; });
    await until(() => page.evaluate(() => Boolean(document.querySelector(".sys-update-row"))), "the About row");
    const about = () => page.evaluate(() => { const r = document.querySelector(".sys-update-row"); return { title:r.querySelector("strong").textContent, note:r.querySelector("small").textContent, buttons:[...r.querySelectorAll(".sys-acts > *")].map(b => b.textContent.trim()) }; });
    let a = await about();
    check("About: version and Restart to update", a.title === "PenEcho 1.5.0" && a.note === "Version 1.6.0 is ready to install." && a.buttons.join("|") === "What’s new|Restart to update|Changelog", JSON.stringify(a));
    check("About: the old fixed version row is gone", await page.evaluate(() => ![...document.querySelectorAll("#sysPanel strong")].some(s => s.textContent === "PenEcho 1.5.0" && !s.closest(".sys-update-row"))));
    await page.locator("#sysPanel").screenshot({ path:path.join(shots, "5-about-ready.png") });
    await push({ status:"up-to-date", version:"1.5.0", ready:false, updateAvailable:false });
    a = await about();
    check("About follows the state: up to date, Check for updates", a.note === "You have the latest version." && a.buttons.join("|") === "Check for updates|Changelog", JSON.stringify(a));
    await page.click(".sys-update-row [data-act='update-check']");
    check("Check for updates asks the app", (await calls()).at(-1) === "check");
    check("the sidebar hint left with the update", (await hint()) === null);

    check("no page errors", errors.length === 0, errors.join(" | "));
  } catch (error) {
    failures.push(error.message);
    console.log(`FAIL  ${error.stack || error.message}`);
  } finally {
    await browser?.close();
    server.kill();
    console.log(`\n${passed} passed, ${failures.length} failed. Screenshots: ${shots}`);
    process.exitCode = failures.length ? 1 : 0;
  }
})();
