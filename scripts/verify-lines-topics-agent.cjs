#!/usr/bin/env node
"use strict";
// The agent Build and Rebuild Topics run with (PE-447), in a real browser against a real server: Settings > Agents has no Jobs row
// for Build Topics; the Rebuild box lists Default and every saved agent, keeps the pick, and its line runs with it.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-topics-agent.cjs [screenshot-folder]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) fs.mkdirSync(shots, { recursive:true });
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-topics-agent-")));
const PORT = 4700 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 300)}` : ""}`); }
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
// The page redraws while it loads; a picture of an element is taken again until it holds still.
const picture = (locator, file) => (shots ? until(() => locator.screenshot({ path:path.join(shots, file) }).then(() => true), file) : null);
async function api(route, { method = "GET", body } = {}) {
  const res = await fetch(`${base}/api/lines${route}`, { method, headers:{ "content-type":"application/json", origin:base }, body:body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const bin = path.join(temp, "bin"), state = path.join(temp, "state");
fs.mkdirSync(bin, { recursive:true });
const script = (name, body) => { const file = path.join(bin, name); fs.writeFileSync(file, `#!/bin/sh\n${body}\n`); fs.chmodSync(file, 0o755); return file; };
script("claude", 'echo "2.3.0 (Claude Code)"');
script("opencode", 'echo "1.19.5"');
fs.mkdirSync(state, { recursive:true });

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_LINES_EXAMPLES:"0", HOME:temp, SHELL:"/bin/sh", PENECHO_STATE_DIR:state, PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", PI_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:`${bin}:/usr/bin:/bin` } });
let log = ""; server.stdout.on("data", d => { log += d; }); server.stderr.on("data", d => { log += d; });

(async () => {
  let browser, page;
  try {
    await until(() => fetch(`${base}/api/lines/projects`).then(r => r.ok), "the server");
    const docs = path.join(temp, "Garden docs");
    fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
    fs.mkdirSync(path.join(docs, "topics"), { recursive:true });
    fs.writeFileSync(path.join(docs, "lines", "fix-login.md"), "---\nid: G-1\nstatus: done\nwho: @claude\ncreated: 2026-11-15 10:00\n---\n\n# Fix the login\n\n## Ask · 2026-11-15 10:00\n\nFix the login.\n");
    fs.writeFileSync(path.join(docs, "topics", "accounts.md"), "---\nrecord_type: topic\nid: topic-ab12\ntitle: Accounts\n---\n\n# Accounts\n\n**People sign in once.**\n");
    const { project } = await api("/projects/import", { method:"POST", body:{ docsPath:docs } });
    const quick = (await api("/agent-presets", { method:"POST", body:{ agent:"opencode", model:"small", effort:"" } })).preset;
    await api("/agent-presets", { method:"POST", body:{ agent:"claude", model:"opus", effort:"high", default:true } });

    browser = await chromium.launch({ channel:"chrome" });
    page = await (await browser.newContext({ viewport:{ width:1440, height:960 } })).newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${base}/projects.html#settings/agents`);
    await until(() => page.locator("#sysAgents").isVisible(), "the Agents section");
    check("Settings > Agents has no Jobs / Build Topics row", await page.locator("select[data-job-agent='topics']").count() === 0 && !/Build Topics/.test(await page.locator(".sys-sec[aria-labelledby='sysAgents']").textContent()));
    await picture(page.locator(".sys-sec[aria-labelledby='sysAgents']"), "settings-agents.png");

    await page.goto(`${base}/projects.html#${project.id}`);
    await until(() => page.locator(".hm-all[data-view='topics']").isVisible(), "the Topics card");
    await page.locator(".hm-all[data-view='topics']").click();
    await until(() => page.locator(".topics-page [data-act='rebuild-topics']").isVisible(), "Rebuild");
    await page.locator(".topics-page [data-act='rebuild-topics']").click();
    const box = page.locator("dialog[aria-labelledby='rebuildTopicsTitle']");
    await until(() => box.isVisible(), "the Rebuild box");
    const pick = box.locator("select[name='preset']");
    const options = await pick.locator("option").allTextContents();
    check("Rebuild offers Default (naming it) and every saved agent", options[0] === "Default (Claude Code · opus · high effort)" && options.includes(quick.name), options.join(" | "));
    check("the Rebuild box starts on Default", await pick.inputValue() === "");
    await picture(box, "rebuild-box.png");
    await pick.selectOption(quick.id);
    await box.locator("[type='submit']").click();
    await until(async () => !(await box.isVisible()), "the box to close");
    check("the pick in the Rebuild box is kept", (await api("/agent-presets")).jobs.topics === quick.id);
    const line = fs.readdirSync(path.join(docs, "lines")).find(n => n.startsWith("rebuild-topics"));
    const md = line ? fs.readFileSync(path.join(docs, "lines", line), "utf8") : "";
    check("the Rebuild line runs with the picked agent's runner", /## \[.\] Work 1 · @opencode/.test(md), md.slice(0, 600));
    check("no page errors", !errors.length, errors.join(" | "));
  } catch (error) {
    failures.push(error.message); console.log(`FAIL  ${error.message}`);
    if (shots && page) await page.screenshot({ path:path.join(shots, "failure.png"), fullPage:true }).catch(() => {});
  } finally {
    await browser?.close();
    server.kill();
    fs.rmSync(temp, { recursive:true, force:true });
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) { console.log(log.slice(-2000)); process.exitCode = 1; }
  }
})();
