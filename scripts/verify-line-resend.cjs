#!/usr/bin/env node
"use strict";
// Send again (PE-403), in a real browser: a Work that failed, and one that was discarded, each show Send again under them. Pressing it
// takes the Work away and puts its Ask back, Not sent, where it was, with Run with and Paste to choose who does it this time. A Work that
// finished shows no Send again.
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/verify-line-resend.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-line-resend-"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 6000 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "docs");
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

const head = (status, title) => `---\nid: T-1\nstatus: ${status}\narea: Work\nlabels: Work\npriority: 2\ncreated: 2026-11-13 09:00\nwho: @antigravity\n---\n\n# ${title}\n\n`;
const LINES = {
  failed:head("stopped", "Fix the Details footer") + "## Ask · 2026-11-13 09:00\n\nPut the model ID and effort beside the folder path.\n\n## [ ] Work 1 · @antigravity\n\n",
  discarded:head("done", "Rain chart") + "## Ask · 2026-11-13 09:10\n\nAdd a rain chart to the weather page.\n\n## [x] Work 1 · @antigravity · discarded\n\n",
  finished:head("ready", "Settings page") + "## Ask · 2026-11-13 09:20\n\nTidy the settings page.\n\n## [x] Work 1 · @antigravity · 6 min\n\n**Done.** Tidied.\n",
};
fs.mkdirSync(path.join(docs, "lines", "failed"), { recursive:true });
for (const [slug, md] of Object.entries(LINES)) fs.writeFileSync(path.join(docs, "lines", `${slug}.md`), md);
fs.writeFileSync(path.join(docs, "works", "failed", "work-1.md"), "---\nline: ../failed.md\nstep: Work 1\nwho: @antigravity\nstarted: 2026-11-13 09:00\nstop why: error\n---\n\n# Work 1: Fix the Details footer\n\n## Stopped\n\nThe agent exited with an error.\n");

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1280, height:860 } });
  const post = async (address, data) => (await context.request.post(`${base}/api/lines${address}`, { data, headers:{ origin:base } })).json();
  const id = (await post("/projects", { name:"Weather app", docsPath:docs, offerSkill:false })).project.id;
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(20000);
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const openLine = async slug => { await page.goto(`${base}/projects.html#${id}/line/${slug}`); await page.waitForFunction(l => window.__lines?.S.route.line === l && document.querySelector("#linePage"), slug); await wait(600); };
  const lineMd = slug => fs.readFileSync(path.join(docs, "lines", `${slug}.md`), "utf8");

  for (const slug of ["failed", "discarded"]) {
    await openLine(slug);
    const button = page.locator('.lp-work [data-act="resend-work"]');
    check(`${slug}: Send again is under the Work`, await button.count() === 1 && /Send again/.test(await button.innerText()));
    await page.screenshot({ path:path.join(shots, `${slug}-before.png`) });
    await button.click();
    await page.waitForSelector(".lp-ask.is-unsent");
    await wait(500);
    check(`${slug}: the Work is gone from the line`, await page.locator(".lp-work:not(.lp-end)").count() === 0);
    check(`${slug}: the Ask is Not sent where it was`, await page.locator(".lp-ask").count() === 1 && /Not sent yet/.test(await page.locator(".lp-ask").innerText()));
    check(`${slug}: the file says Not sent and has no Work`, /^## Ask · 2026-11-13 09:\d\d · Not sent$/m.test(lineMd(slug)) && !/Work 1/.test(lineMd(slug)), lineMd(slug));
    check(`${slug}: the Work's detail went to the trash`, !fs.existsSync(path.join(docs, "works", slug, "work-1.md")));
    await page.screenshot({ path:path.join(shots, `${slug}-after.png`) });
  }
  await openLine("finished");
  check("finished: no Send again", await page.locator('[data-act="resend-work"]').count() === 0);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
})().catch(error => { failures.push(error.message); console.log(`FAIL  ${error.stack || error.message}`); }).finally(() => {
  server.kill();
  console.log(`\n${passed} passed, ${failures.length} failed. Screenshots: ${shots}`);
  process.exitCode = failures.length ? 1 : 0;
});
