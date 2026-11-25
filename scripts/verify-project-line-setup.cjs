#!/usr/bin/env node
"use strict";
// Agent setup, in a real browser against a real server: the sidebar link from any project, which agents are here,
// what is wrong with the rest, and the prompts to fix them.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-project-line-setup.cjs [screenshot-folder]
// The agents are stand-in scripts: an OpenCode that works, a Codex that is signed out, and a Pi whose setting names no file.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) fs.mkdirSync(shots, { recursive:true });
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-line-setup-")));
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
async function api(route, { method = "GET", body } = {}) {
  const res = await fetch(`${base}/api/lines${route}`, { method, headers:{ "content-type":"application/json", origin:base }, body:body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const bin = path.join(temp, "bin");
fs.mkdirSync(bin, { recursive:true });
const script = (name, body) => { const file = path.join(bin, name); fs.writeFileSync(file, `#!/bin/sh\n${body}\n`); fs.chmodSync(file, 0o755); return file; };
script("opencode", 'echo "1.19.5"');
script("agy", 'if [ "$1" = "--version" ]; then echo "1.5.8"; exit 0; fi\nif [ "$1" = "models" ]; then echo "gemini-4-argon-high    Gemini 4 Argon (High)"; echo "gemini-4-argon-medium  Gemini 4 Argon (Medium)"; echo "claude-opus-5-5-high    Claude Opus 5.5 (High)"; echo "gemini-pro-orchestrator-g1-pro  Orchestrator (Argon)"; exit 0; fi\nexit 0');
fs.mkdirSync(path.join(temp, ".codex"), { recursive:true });
fs.writeFileSync(path.join(temp, ".codex", "config.toml"), 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\n');
// OpenCode's settings name models but pick none, so a model can be picked for PenEcho's runs.
fs.mkdirSync(path.join(temp, ".config", "opencode"), { recursive:true });
fs.writeFileSync(path.join(temp, ".config", "opencode", "opencode.json"), JSON.stringify({ provider:{ magpie:{ models:{ "glm-5.3":{} } }, moonshot:{ models:{ "kimi-k3":{ variants:{ low:{}, max:{} } } } } } }));
const codex = script("codex", 'if [ "$1" = "--version" ]; then echo "codex-cli 0.166.0"; exit 0; fi\nif [ "$1" = "login" ]; then echo "Not logged in" >&2; exit 1; fi\nexit 2');

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_LINES_EXAMPLES:"0", HOME:temp, SHELL:"/bin/sh", PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", PI_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:codex, PATH:`${bin}:/usr/bin:/bin` } });
let log = ""; server.stdout.on("data", d => { log += d; }); server.stderr.on("data", d => { log += d; });

(async () => {
  let browser;
  try {
    await until(() => fetch(`${base}/api/lines/projects`).then(r => r.ok), "the server");
    const { project:alpha } = await api("/projects", { method:"POST", body:{ name:"Alpha", docsPath:path.join(temp, "Alpha docs") } });

    const result = await api("/agents/check");
    const byId = Object.fromEntries(result.agents.map(a => [a.id, a]));
    check("the check finds the working OpenCode", byId.opencode?.state === "ready" && byId.opencode.version === "1.19.5", JSON.stringify(byId.opencode));
    check("signed-out Codex is a problem", byId.codex?.state === "problem" && byId.codex.problems[0].title === "Not signed in", JSON.stringify(byId.codex));
    check("Pi's setting naming no file is a problem", byId.pi?.state === "problem" && /PI_CLI_PATH/.test(byId.pi.problems[0].title), JSON.stringify(byId.pi));
    check("agents not installed are listed, not counted", byId.claude?.state === "missing" && result.problems === 2, JSON.stringify({ claude:byId.claude?.state, problems:result.problems }));

    browser = await chromium.launch({ channel:"chrome" });
    const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin:base });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${base}/projects.html#${alpha.id}`);

    const link = page.locator("#railAccount .rail-gear");
    await until(() => link.isVisible(), "the sidebar's gear");
    await until(async () => (await link.locator("em").textContent()) === "2", "the problem count");
    check("the sidebar's gear shows the problems to fix", true);
    await link.click();
    await page.locator("#sysTab-agents").click();
    await until(() => page.locator(".setup-page").isVisible(), "the agents on the Agents tab");
    check("the address is #agents", new URL(page.url()).hash === "#agents", page.url());
    check("the gear is lit while Settings is open", await link.evaluate(el => el.classList.contains("on")));
    check("the project beneath the window stays lit in the sidebar", await page.locator(".rail-row.on").count() === 1);
    const names = await page.locator(".setup-row .setup-text strong").allTextContents();
    check("problems come first, then ready, then not installed", ["Codex", "Pi"].includes(names[0]) && ["Codex", "Pi"].includes(names[1]) && ["OpenCode", "Antigravity"].includes(names[2]) && ["OpenCode", "Antigravity"].includes(names[3]), names.join(", "));
    check("not installed agents are at the end", names.indexOf("OpenCode") < names.indexOf("Claude Code") && names.indexOf("Antigravity") < names.indexOf("Claude Code"), names.join(", "));
    const codexRow = page.locator('.setup-row[data-agent="codex"]');
    check("Codex says what is wrong and how to fix it", /Not signed in/.test(await codexRow.textContent()) && /codex login/.test(await codexRow.textContent()));
    // The model each Ask runs on, from the agent's own settings, and how to change it.
    const codexModel = codexRow.locator(".setup-model");
    // The dropdown defaults to "" while the agent's own setting is in use, and shows that setting as its default choice.
    const codexSelect = codexModel.locator("select[data-model-agent]");
    check("Codex shows its configured model and default effort", await codexSelect.locator("option").first().textContent() === "gpt-6.1-sol" && await codexSelect.inputValue() === "" && await codexModel.locator("select[data-effort-agent] option").first().textContent() === "Default (xhigh)", await codexModel.textContent());
    check("an agent with no model set shows its own default", await page.locator('.setup-row[data-agent="opencode"] select[data-model-agent] option').first().textContent() === "OpenCode's default");
    check("a not installed agent shows no model", !(await page.locator('.setup-row[data-agent="claude"] .setup-model').count()));
    await codexModel.locator('[data-act="setup-model"]').click();
    await until(() => codexRow.locator(".setup-model p").isVisible(), "how to change the model");
    check("Change says where to change it", /Pick a name or type one\. Empty is Codex's own setting\. Pick one with `?\/model`? in Codex, or set model in ~\/\.codex\/config\.toml\./.test(await codexRow.locator(".setup-model p").textContent()), await codexRow.locator(".setup-model p").textContent());
    if (shots) await page.screenshot({ path:path.join(shots, "agent-setup.png"), fullPage:true });
    await codexModel.locator('[data-act="setup-model"]').click();
    await until(async () => !(await codexRow.locator(".setup-model p").count()), "the explanation closes");
    check("Done closes it", true);
    // Antigravity groups tiered variants into base models from `agy models` and shows each model's valid efforts.
    const agyRow = page.locator('.setup-row[data-agent="antigravity"]');
    const agyModel = agyRow.locator('select[data-model-agent]');
    const agyEffort = agyRow.locator('select[data-effort-agent]');
    const agyValues = await agyModel.locator("option").evaluateAll(options => options.map(o => o.value).join("|"));
    check("Antigravity lists base models from agy models", agyValues === "|gemini-4-argon|claude-opus-5-5|gemini-pro-orchestrator-g1-pro|__custom__", agyValues);
    check("Antigravity default shows no speculative effort dropdown", (await agyEffort.count()) === 0);
    await agyModel.selectOption("gemini-4-argon");
    await until(async () => /with gemini-4-argon from the next Ask/.test(await page.locator("#toast").textContent()), "Antigravity model toast");
    check("Antigravity lists valid effort levels for the selected model", (await agyEffort.locator("option").allTextContents()).join("|") === "Default|medium|high", (await agyEffort.locator("option").allTextContents()).join("|"));
    await agyEffort.selectOption("high");
    await until(async () => /runs at high effort from the next Ask/.test(await page.locator("#toast").textContent()), "Antigravity effort toast");
    check("Antigravity keeps picked model and effort", await until(async () => { const m = (await api("/agents/check")).agents.find(a => a.id === "antigravity")?.model; return m?.picked === "gemini-4-argon" && m?.pickedEffort === "high"; }, "Antigravity model and effort saved"));
    await agyModel.selectOption("gemini-pro-orchestrator-g1-pro");
    await until(async () => !(await agyEffort.count()), "Antigravity tierless model hides effort");
    check("Antigravity tierless model drops effort", (await api("/agents/check")).agents.find(a => a.id === "antigravity")?.model?.pickedEffort === "");
    await agyModel.selectOption("gemini-4-argon");
    await until(async () => (await agyEffort.count()) === 1, "Antigravity effort reappears");
    await agyEffort.selectOption("high");
    await until(async () => (await api("/agents/check")).agents.find(a => a.id === "antigravity")?.model?.pickedEffort === "high", "Antigravity effort restored");
    // A model the agent's own settings name can be picked for PenEcho's runs, and is kept.
    const pick = page.locator('.setup-row[data-agent="opencode"] select[data-model-agent]');
    const listed = () => pick.locator("option").evaluateAll(options => options.map(o => o.value).filter(v => v && v !== "__custom__").join("|"));
    check("OpenCode lists the models its settings name", (await listed()) === "magpie/glm-5.3|moonshot/kimi-k3", await listed());
    await pick.selectOption("moonshot/kimi-k3");
    await until(async () => /with moonshot\/kimi-k3 from the next Ask/.test(await page.locator("#toast").textContent()), "the pick's toast");
    check("picking one says it is used from the next Ask", true);
    check("the pick stays shown", await until(async () => (await pick.inputValue()) === "moonshot/kimi-k3" && !(await pick.isDisabled()), "the pick shown"));
    check("the server keeps the pick", (await api("/agents/check")).agents.find(a => a.id === "opencode").model.picked === "moonshot/kimi-k3");
    // The reasoning levels that model takes, its variants, can be picked too.
    const reasoning = page.locator('.setup-row[data-agent="opencode"] select[data-effort-agent]');
    check("the picked model's reasoning levels are listed", (await reasoning.locator("option").allTextContents()).join("|") === "Default|low|max", (await reasoning.locator("option").allTextContents()).join("|"));
    await reasoning.selectOption("max");
    await until(async () => /runs at max effort from the next Ask/.test(await page.locator("#toast").textContent()), "the reasoning toast");
    check("the server keeps the reasoning level", await until(async () => (await api("/agents/check")).agents.find(a => a.id === "opencode").model.pickedEffort === "max", "the level kept"));
    if (shots) await page.locator('.setup-row[data-agent="opencode"]').screenshot({ path:path.join(shots, "agent-setup-model.png") });
    // "Type another…" switches to a box so any unlisted name can be typed and kept as typed.
    await pick.selectOption("__custom__");
    const customInput = page.locator('.setup-row[data-agent="opencode"] input[data-model-agent]');
    await until(() => customInput.isVisible(), "custom model input");
    await customInput.fill("typed/by-hand");
    await customInput.press("Enter");
    check("a typed name is kept", await until(async () => (await api("/agents/check")).agents.find(a => a.id === "opencode").model.picked === "typed/by-hand", "the typed name kept"));
    await page.locator('.setup-row[data-agent="opencode"] select[data-model-agent]').selectOption("");
    await until(async () => (await api("/agents/check")).agents.find(a => a.id === "opencode").model.picked === "", "back to the default");
    check("its own default can be picked again", true);
    check("a model with no levels drops the level and its menu", (await api("/agents/check")).agents.find(a => a.id === "opencode").model.pickedEffort === "" && await until(async () => !(await reasoning.count()), "the menu gone"));
    check("WorkBuddy is hidden", !(await page.locator('.setup-row[data-agent="workbuddy"]').count()));

    await codexRow.locator('[data-act="setup-prompt"]').first().click();
    const copied = await until(() => page.evaluate(() => navigator.clipboard.readText()).then(t => t.includes("Codex has a problem") && t), "the copied prompt");
    check("Copy fix prompt copies a prompt naming the fix", /Run `codex login`/.test(copied), copied);
    check("the toast says where to paste it", /Paste it into (?:OpenCode|Antigravity)/.test(await page.locator("#toast").textContent()), await page.locator("#toast").textContent());
    await codexRow.locator('[data-act="setup-command"]').click();
    await until(() => page.evaluate(() => navigator.clipboard.readText()).then(t => t === "codex login"), "the copied command");
    check("the command copies on its own", true);

    // Signed in now, and Check again sees it.
    fs.writeFileSync(codex, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.166.0"; exit 0; fi\nif [ "$1" = "login" ]; then echo "Logged in using ChatGPT" >&2; exit 0; fi\nexit 2\n');
    await page.locator('[data-act="setup-recheck"]').click();
    await until(async () => /Ready/.test(await codexRow.textContent()), "Codex ready after Check again");
    check("Check again picks up a fix", true);
    await until(async () => (await link.locator("em").textContent()) === "1", "the count drops");
    check("the count drops with it", true);

    await page.goto(`${base}/projects.html#${alpha.id}/settings`);
    await until(() => page.locator(".settings-page").isVisible(), "Project settings");
    check("Project settings omits the Every project Agents link", await page.locator('.settings-page [aria-label="Every project"]').count() === 0 && await page.locator('.settings-page [data-act="open-agents"]').count() === 0);
    await page.locator('.rail [data-act="open-settings"]').click();
    await until(() => page.locator(".setup-page").isVisible(), "Agents from the rail Settings gear");
    check("Rail Settings gear opens Agents directly", true);
    await page.goBack();
    await until(() => page.locator(".settings-page").isVisible(), "back to Settings");
    check("Back returns to the project", true);
    if (shots) { await page.goto(`${base}/projects.html#setup`); await until(() => page.locator(".setup-row").first().isVisible(), "reload"); await page.screenshot({ path:path.join(shots, "agent-setup-after.png"), fullPage:true }); }
    check("no page errors", !errors.length, errors.join(" | "));
  } catch (error) {
    failures.push(error.message); console.log(`FAIL  ${error.message}`); console.log(log.slice(-2000));
  } finally {
    await browser?.close(); server.kill();
    fs.rmSync(temp, { recursive:true, force:true });
    console.log(`\n${passed} passed, ${failures.length} failed`);
    process.exitCode = failures.length ? 1 : 0;
  }
})();
