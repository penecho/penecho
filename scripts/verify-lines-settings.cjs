#!/usr/bin/env node
"use strict";
// Settings for all of PenEcho (PE-301), in a real browser against a real server: the sidebar's Settings from a project, saved agents
// (one runner twice, with another model and effort, one of them the default), API keys only (an old CLI connection says it is no longer used),
// Run with listing the saved agents, the project's own settings, #setup from older links, and on the Canvas: no Library, and
// AI & connections opening this page.
//   PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-lines-settings.cjs [screenshot-folder]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) fs.mkdirSync(shots, { recursive:true });
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-settings-")));
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
const bin = path.join(temp, "bin"), state = path.join(temp, "state");
fs.mkdirSync(bin, { recursive:true });
const script = (name, body) => { const file = path.join(bin, name); fs.writeFileSync(file, `#!/bin/sh\n${body}\n`); fs.chmodSync(file, 0o755); return file; };
script("claude", 'echo "2.3.0 (Claude Code)"');
script("opencode", 'echo "1.19.5"');
// A Codex CLI connection saved by an older PenEcho.
fs.mkdirSync(state, { recursive:true });
fs.writeFileSync(path.join(state, "connections.json"), JSON.stringify({ version:1, connections:[{ id:"old-cli", provider:"codex-cli", cliModel:"", cliPath:"codex", effort:"medium" }] }));
fs.mkdirSync(path.join(state, "project-lines"), { recursive:true });
fs.writeFileSync(path.join(state, "project-lines", "agent-models.json"), JSON.stringify({ claude:{ model:"opus", effort:"high" } }));

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_LINES_EXAMPLES:"0", HOME:temp, SHELL:"/bin/sh", PENECHO_STATE_DIR:state, PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", PI_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:`${bin}:/usr/bin:/bin` } });
let log = ""; server.stdout.on("data", d => { log += d; }); server.stderr.on("data", d => { log += d; });

(async () => {
  let browser, page;
  try {
    await until(() => fetch(`${base}/api/lines/projects`).then(r => r.ok), "the server");
    const docs = path.join(temp, "Alpha docs");
    const { project:alpha } = await api("/projects", { method:"POST", body:{ name:"Alpha", docsPath:docs } });
    fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
    fs.writeFileSync(path.join(docs, "lines", "claude-follow-up.md"), `---\nid: T-1\nstatus: notes\ncreated: 2026-11-15 10:00\n---\n\n# Claude follow-up\n\n## Ask · 2026-11-15 10:00\n\nEarlier work.\n\n## [x] Work 1 · @claude · 1 min\n\nDone.\n\n## Ask · 2026-11-15 10:02 · Not sent\n\nContinue this Claude line.\n`);

    browser = await chromium.launch({ channel:"chrome" });
    const context = await browser.newContext({ viewport:{ width:1440, height:960 }, hasTouch:true });
    page = await context.newPage();
    const errors = []; page.on("pageerror", e => errors.push(`${e.message} @ ${page.url()} ${String(e.stack || "").split("\n").slice(1, 6).join(" <- ")}`));
    await page.goto(`${base}/projects.html#${alpha.id}`);
    const link = page.locator("#railAccount .rail-gear");
    await until(() => link.isVisible(), "the gear in the sidebar");
    check("the sidebar's foot keeps only New project, then the account row with the gear", await page.locator("#railShelf, #railSetup, .rail-agents, .rail-providers, .rail-setup, [data-act='open-archived']").count() === 0 && await page.locator(".rail-new[data-act='new-project']").count() === 1 && await link.getAttribute("aria-label") === "Settings");
    const beneath = await page.locator("#view > *").first().getAttribute("class");
    await link.click();
    await until(() => page.locator(".sysm").isVisible(), "the Settings window");
    check("Settings opens as one window over the page, which stays beneath", await page.locator(".sysm[role='dialog'][aria-modal='true']").count() === 1 && await page.locator("#view > *").first().getAttribute("class") === beneath && await page.locator(".sys-page").count() === 0);
    const tabNames = (await page.locator(".sysm-tabs [role='tab'] > span").allTextContents()).map(t => t.trim());
    check("its tabs: Agents, Canvas AI, MCP, Providers, then Canvas, General, then Archived", tabNames.join() === "Agents,Canvas AI,MCP,Providers,Canvas,General,Archived" && await page.locator(".sysm-tabs hr").count() === 2, tabNames.join());
    check("it opens on Agents by default", new URL(page.url()).hash === "#agents" && await page.locator("#sysTab-agents[aria-selected='true']").count() === 1 && (await page.locator(".sysm-head h3").textContent()) === "Agents" && await page.locator("#sysAgents").isVisible(), page.url());
    await page.locator("#sysTab-canvas").click();
    await until(() => page.locator("#sysCanvasView").isVisible(), "the Canvas tab");
    check("Canvas tab shows view preferences only", new URL(page.url()).hash === "#settings/canvas" && await page.locator("#sysTab-canvas[aria-selected='true']").count() === 1 && await page.locator('[data-canvas-ai], #sysApps').count() === 0 && await page.locator('#sysCanvasView').isVisible());
    if (shots) await page.screenshot({ path:path.join(shots, "settings-window-canvas.png") });
    await page.locator("#sysTab-agents").click();
    await until(() => page.locator("#sysAgents").isVisible(), "the Agents tab");
    check("the address is #agents", new URL(page.url()).hash === "#agents" && (await page.locator(".sysm-head h3").textContent()) === "Agents", page.url());
    await until(async () => (await page.locator(".sys-sec[aria-labelledby='sysAgents'] .sys-row").count()) >= 2, "the agents here");
    const rows = await page.locator(".sys-sec[aria-labelledby='sysAgents'] .sys-row strong").allTextContents();
    check("with nothing saved, each runner here is offered as itself", rows.includes("Claude Code") && rows.includes("OpenCode"), rows.join(" | "));
    check("API keys are not on Agents: they are on Providers", await page.locator("#sysKeys").count() === 0 && !/runs on dsh/i.test(await page.locator("#sysPanel").textContent()));
    await until(() => page.locator("#installed .setup-row").first().isVisible(), "the agents on this computer");
    check("the agents installed here are on the same page", await page.locator("#installed .setup-row[data-agent='claude']").count() === 1);
    if (shots) await page.screenshot({ path:path.join(shots, "settings-empty.png"), fullPage:true });

    // Claude Code twice: Haiku at max effort as the default, Opus at high.
    async function addAgent(model, effort, makeDefault) {
      await page.locator("[data-act='preset-new']").click();
      const form = page.locator(".sys-form[data-form='preset']");
      await form.locator("select[name='agent']").selectOption("claude");
      await form.locator("select[name='modelChoice']").selectOption(model);
      await until(async () => (await form.locator("select[name='effortChoice'] option").allTextContents()).includes(effort), `the ${effort} effort`);
      await form.locator("select[name='effortChoice']").selectOption(effort);
      if (makeDefault) await form.locator("input[name='makeDefault']").check();
      return form;
    }
    let form = await addAgent("haiku", "max", true);
    check("the name follows the runner, model and effort, and says effort", await form.locator("input[name='name']").getAttribute("placeholder") === "Claude Code · haiku · max effort", await form.locator("input[name='name']").getAttribute("placeholder"));
    if (shots) await page.screenshot({ path:path.join(shots, "settings-new-agent.png"), fullPage:true });
    // Any effort can be typed: Type another effort… opens a box under the list.
    await form.locator("select[name='effortChoice']").selectOption({ label:"Type another effort…" });
    await until(() => form.locator("input[name='effort']").isVisible(), "the typed effort box");
    check("Type another effort opens a box", true);
    if (shots) await form.screenshot({ path:path.join(shots, "settings-new-agent-typed-effort.png") });
    await form.locator("input[name='effort']").fill("max");
    await form.locator("input[name='effort']").blur();
    await form.locator("button[type='submit']").click();
    await until(() => page.locator(".sys-row[data-preset]", { hasText:"Claude Code · haiku · max effort" }).isVisible(), "the saved agent");
    form = await addAgent("opus", "high", false);
    await form.locator("button[type='submit']").click();
    await until(() => page.locator(".sys-row[data-preset]", { hasText:"Claude Code · opus · high effort" }).isVisible(), "the second saved agent");
    check("the default is marked on its row", /Default/.test(await page.locator(".sys-row[data-preset]", { hasText:"Claude Code · haiku · max effort" }).textContent()) && !/Default/.test(await page.locator(".sys-row[data-preset]", { hasText:"Claude Code · opus · high effort" }).locator(".sys-default").count() ? "Default" : ""));
    const saved = await api("/agent-presets");
    check("the server keeps both, one of them the default", saved.presets.filter(x => x.agent === "claude" && !x.auto).length === 2 && saved.presets.find(x => x.id === saved.default)?.model === "haiku", JSON.stringify(saved));
    if (shots) await page.screenshot({ path:path.join(shots, 'agents-line-work.png'), fullPage:true });

    // Access (PE-485): Claude Code may be opened up to Full access, with a warning; OpenCode already runs every tool and offers no choice.
    await page.locator("[data-act='preset-new']").click();
    form = page.locator(".sys-form[data-form='preset']");
    await form.locator("select[name='agent']").selectOption("opencode");
    await until(async () => await form.locator("select[name='access']").isDisabled(), "OpenCode's fixed access");
    check("OpenCode shows Full access with no choice", (await form.locator("select[name='access'] option").allTextContents()).join() === "Full access");
    await form.locator("select[name='agent']").selectOption("claude");
    await until(async () => !(await form.locator("select[name='access']").isDisabled()), "Claude Code's access choice");
    check("Claude Code offers Reviewed, then Full access", (await form.locator("select[name='access'] option").allTextContents()).join() === "Reviewed,Full access");
    check("no warning while Reviewed", await form.locator(".sys-warn").count() === 0);
    await form.locator("select[name='access']").selectOption("full");
    await until(() => form.locator(".sys-warn").isVisible(), "the Full access warning");
    check("Full access is named and warned about", await form.locator("input[name='name']").getAttribute("placeholder") === "Claude Code · full access" && /without asking/.test(await form.locator(".sys-warn").textContent()));
    if (shots) await page.screenshot({ path:path.join(shots, "settings-agent-access.png"), fullPage:true });
    await form.locator("button[type='submit']").click();
    await until(() => page.locator(".sys-row[data-preset]", { hasText:"Claude Code · full access" }).isVisible(), "the Full access agent");
    const opened = (await api("/agent-presets")).presets.find(x => x.access === "full");
    check("the server keeps its Access", opened?.agent === "claude", JSON.stringify(opened));
    await page.locator(".sys-row[data-preset]", { hasText:"Claude Code · full access" }).locator("[data-act='preset-remove']").click();
    await until(async () => await page.locator(".sys-row[data-preset]", { hasText:"Claude Code · full access" }).count() === 0, "the Full access agent removed");

    // Providers: a tab of its own. An API key for Canvas AI.
    await page.locator("#sysTab-providers").click();
    await until(() => new URL(page.url()).hash === "#providers", "the Providers tab");
    check("Providers is a tab of Settings", (await page.locator(".sysm-head h3").textContent()) === "Providers" && await page.locator("#sysTab-providers[aria-selected='true']").count() === 1);
    await until(() => page.locator(".sys-row.is-off", { hasText:"Codex CLI" }).isVisible(), "the old CLI connection");
    check("an old CLI connection is shown as no longer used, with Remove", /No longer used/.test(await page.locator(".sys-row.is-off", { hasText:"Codex CLI" }).textContent()) && await page.locator(".sys-row.is-off", { hasText:"Codex CLI" }).locator("[data-act='key-remove']").count() === 1);
    check("API keys are the only kind of connection to add", await page.locator("[data-act='key-new']").textContent() === "Add API key");
    if (shots) await page.screenshot({ path:path.join(shots, "providers.png"), fullPage:true });
    // Add a provider (PE-446): well-known providers as logo tiles under Partners (PE-533), Vendors, Relays and On this computer, a find box and Custom.
    await page.locator("[data-act='key-new']").click();
    const picker = page.locator(".sys-picker");
    await until(() => picker.isVisible(), "Add a provider");
    const kinds = await picker.locator(".pk-kind h4").allTextContents();
    check("providers are grouped as Partners, Vendors, Relays and On this computer", kinds.join(",") === "Partners,Vendors,Relays,On this computer", kinds.join(","));
    const partners = await picker.locator(".pk-kind").first().locator(".pk-tile").allTextContents();
    check("Kimi and LinkModel are the partners, at the top", partners.join(",") === "Kimi,Kimi Code,LinkModel", partners.join(","));
    const tiles = await picker.locator(".pk-tile").allTextContents();
    check("only well-known providers are offered", ["Anthropic", "OpenAI", "Google Gemini", "DeepSeek", "OpenRouter", "Ollama"].every(n => tiles.includes(n)) && tiles.length <= 20, tiles.join(" | "));
    const logos = await until(() => picker.locator(".pk-tile img").evaluateAll(list => list.length && list.every(img => img.complete) && list), "the logos", 5000).catch(() => null);
    check("each tile shows its logo, and every logo loads", await picker.locator(".pk-tile img").evaluateAll(list => list.length === 18 && list.every(img => img.complete && img.naturalWidth > 0)), logos ? "" : "not loaded");
    await until(() => page.evaluate(() => document.activeElement?.id === "pkFind"), "the find box's focus", 3000).catch(() => {});
    check("the find box has the focus", await page.evaluate(() => document.activeElement?.id === "pkFind"), await page.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}.${document.activeElement?.className}`));
    await page.keyboard.type("kimi");
    const found = await picker.locator(".pk-tile:not([hidden])").allTextContents();
    check("finding keeps only the providers it names", found.join(",") === "Kimi,Kimi Code" && await picker.locator(".pk-kind:not([hidden])").count() === 1, found.join(","));
    await page.keyboard.press("Enter");
    const keyForm = page.locator(".sys-form[data-form='key']");
    await until(() => keyForm.isVisible(), "Kimi's form");
    await until(() => page.evaluate(() => document.activeElement?.name === 'key'), "the key field's focus");
    check("Enter takes the first one found, Global first", await keyForm.locator("input[name='url']").inputValue() === "https://api.moonshot.ai/v1" && await page.evaluate(() => document.activeElement?.name === "key"), `${await keyForm.locator("input[name='url']").inputValue()} focus=${await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.name || document.activeElement?.className}`)}`);
    check("Get a key opens the Kimi Global referral through PenEcho Cloud", await keyForm.locator(".sys-get-key").getAttribute("href") === "https://penecho.ai/go/kimi-global");
    await keyForm.locator("[data-act='key-region'][data-value='1']").click();
    check("its China region moves the address", await keyForm.locator("input[name='url']").inputValue() === "https://api.moonshot.cn/v1");
    check("Get a key opens the Kimi China referral through PenEcho Cloud", await keyForm.locator(".sys-get-key").getAttribute("href") === "https://penecho.ai/go/kimi-china");
    if (shots) await page.screenshot({ path:path.join(shots, "providers-region.png") });
    for (const [service, path] of [["kimi-coding", "kimi-code"], ["linkmodel", "linkmodel"]]) {
      await keyForm.locator("[data-act='key-change']").click();
      await picker.locator(`.pk-tile[data-service='${service}']`).click();
      check(`Get a key opens the ${service} referral through PenEcho Cloud`, await keyForm.locator(".sys-get-key").getAttribute("href") === `https://penecho.ai/go/${path}`);
    }
    await keyForm.locator("[data-act='key-change']").click();
    await picker.locator(".pk-tile[data-service='ollama']").click();
    check("a model server on this computer asks for no key", await keyForm.locator("input[name='url']").inputValue() === "http://localhost:11434/v1" && await keyForm.locator("input[name='key']").count() === 0);
    await keyForm.locator("[data-act='key-change']").click();
    await picker.locator(".pk-tile[data-service='deepseek']").click();
    check("a provider fills in its address", await keyForm.locator("input[name='url']").inputValue() === "https://api.deepseek.com/v1");
    check("a provider with no key page shows no Get a key", await keyForm.locator(".sys-get-key").count() === 0);
    await keyForm.locator("input[name='model']").fill("deepseek-v4-flash");
    await keyForm.locator("input[name='key']").fill("sk-test-not-real");
    if (shots) await page.screenshot({ path:path.join(shots, "settings-new-key.png"), fullPage:true });
    // Saving must repaint even while the follow-up agent scan has not answered.
    let releaseScan;
    const scanGate = new Promise(resolve => { releaseScan = resolve; });
    const holdScan = async route => { await scanGate; await route.continue(); };
    await page.route('**/api/lines/agents/check?fresh=1', holdScan);
    const saveStart = Date.now();
    await keyForm.locator("button[type='submit']").click();
    try {
      await until(() => page.locator(".sys-row[data-key]", { hasText:"deepseek-v4-flash" }).isVisible(), "the saved key before agent scan completes", 2000);
      check("saving shows the row before the agent scan finishes", await keyForm.count() === 0, `${Date.now() - saveStart} ms`);
      console.log(`  save-to-visible: ${Date.now() - saveStart} ms (agent scan held)`);
    } finally { releaseScan(); await page.unrouteAll({ behavior:'wait' }); }
    const stored = JSON.parse(fs.readFileSync(path.join(state, "connections.json"), "utf8")).connections.find(c => c.apiModel === "deepseek-v4-flash");
    check("the key is saved as an API connection for DeepSeek", stored?.provider === "api" && stored.apiPreset === "deepseek-global-api" && stored.apiKey === "sk-test-not-real", JSON.stringify(stored && { ...stored, apiKey:"…" }));
    check("the key never comes back to the page", !(await page.content()).includes("sk-test-not-real"));
    const savedRow = page.locator(".sys-row[data-key]", { hasText:"deepseek-v4-flash" });
    check("the saved key shows its provider's logo and name", await savedRow.locator(".sys-mark img[src$='deepseek-color.svg']").count() === 1 && /DeepSeek · key saved/.test(await savedRow.textContent()), await savedRow.textContent());
    const identities = await page.evaluate(() => ['gpt-6.1-terra', 'kimi-k3.1-pro', 'claude-sonnet-5-5', 'unknown-model'].map(apiModel => {
      const c = { id:'fixture', provider:'api', apiUrl:'https://api.linkmodel.ai/v1', apiFormat:'openai', apiModel, hasApiKey:true };
      const node = document.createElement('div'); node.innerHTML = keyRowHTML(c);
      return { icon:node.querySelector('img').getAttribute('src'), text:node.textContent, service:keyFormFor(c).service };
    }));
    check("relayed models show their makers and keep LinkModel as their editable connection", identities.every((r, i) => r.icon.endsWith(['openai.svg', 'kimi.svg', 'claude-color.svg', 'linkmodel.svg'][i]) && r.service === 'linkmodel' && r.text.includes(i < 3 ? 'via LinkModel' : 'LinkModel · key saved')), JSON.stringify(identities));
    if (shots) {
      await page.evaluate(() => {
        const list = document.querySelector('.sys-row[data-key]').parentElement;
        for (const apiModel of ['gpt-6.1-terra', 'kimi-k3.1-pro', 'claude-sonnet-5-5']) list.insertAdjacentHTML('beforeend', keyRowHTML({ id:`fixture-${apiModel}`, provider:'api', apiUrl:'https://api.linkmodel.ai/v1', apiFormat:'openai', apiModel, hasApiKey:true, removable:true }));
      });
      await page.screenshot({ path:path.join(shots, 'model-identities.png'), fullPage:true });
      await page.evaluate(() => document.querySelectorAll('[data-key^="fixture-"]').forEach(row => row.remove()));
    }
    await page.locator("[data-act='key-new']").click();
    await until(() => picker.isVisible(), "Add a provider again");
    check("a provider with a saved key has a dot", await picker.locator(".pk-tile[data-service='deepseek'] .pk-dot").count() === 1 && await picker.locator(".pk-dot").count() === 1);
    if (shots) {
      await page.screenshot({ path:path.join(shots, "providers-picker.png"), fullPage:true });
      await page.evaluate(() => window.linesTheme.set("dark"));
      await page.screenshot({ path:path.join(shots, "providers-picker-dark.png") });
      await page.evaluate(() => window.linesTheme.set("system"));
    }
    await until(() => page.evaluate(() => document.activeElement?.id === "pkFind"), "the find box's focus again");
    await page.keyboard.press("Escape");
    await until(async () => !(await picker.count()), "the picker closed by Escape");
    check("Escape in the find box closes only the picker, not Settings", await page.locator(".sysm").isVisible());
    // Canvas AI, keeping the entries the Canvas reads.
    await page.locator('#sysTab-canvas-ai').click();
    await until(() => new URL(page.url()).hash === "#agents/canvas", "Canvas AI on Agents");
    await until(() => page.locator("select[data-canvas-ai]").isVisible(), "the Canvas AI choice");
    const aiPicked = await page.evaluate(() => localStorage.getItem(`penecho-ai-connection-id:local:${location.origin}`));
    check("Canvas AI uses the new key, chosen on Agents", aiPicked === stored?.id && await page.locator("select[data-canvas-ai]").inputValue() === stored?.id, `${aiPicked} vs ${stored?.id}`);
    // Thinking effort sits beside the model, and is the very entry the Canvas AI bar reads.
    await page.locator("select[data-canvas-effort]").selectOption("high");
    await until(async () => await page.evaluate(() => localStorage.getItem("penecho-ai-effort")) === "high", "the effort saved");
    check("Canvas AI's thinking effort is chosen beside its model", await page.locator("select[data-canvas-effort]").inputValue() === "high");
    check('all AI preferences moved together, leaving View in Settings', await page.locator('#sysCanvasAi, #sysCanvasDraw, #sysSuggestSpend').count() === 3 && await page.locator('#sysCanvasView').count() === 0);
    await page.reload();
    await until(() => page.locator('[data-canvas-effort]').isVisible(), 'Canvas AI after reload');
    check('Canvas AI deep link and effort survive reload', new URL(page.url()).hash === '#agents/canvas' && await page.locator('[data-canvas-effort]').inputValue() === 'high');
    if (shots) await page.screenshot({ path:path.join(shots, "agents-canvas-ai.png"), fullPage:true });
    await page.locator('#sysTab-canvas-ai').focus();
    await page.keyboard.press('ArrowDown');
    await until(() => page.locator('#sysApps').isVisible(), 'MCP opened by keyboard');
    await until(() => page.getByText('Copy URL', { exact:true }).isVisible(), 'MCP status arrives');
    check('the arrow keys move between tabs, and the tab keeps the focus after status loads', new URL(page.url()).hash === '#agents/apps' && await page.locator('#sysTab-apps').evaluate(el => document.activeElement === el && el.getAttribute('aria-selected') === 'true'));
    if (shots) await page.screenshot({ path:path.join(shots, 'agents-ai-apps.png') });
    await page.goBack();
    await until(async () => !(await page.locator('.sysm').count()), 'Back closing Settings');
    check('Back closes Settings, since tabs replace its address', new URL(page.url()).hash.startsWith(`#${alpha.id}`), page.url());
    await page.goForward();
    await until(() => page.locator('#sysApps').isVisible(), 'Forward to MCP');
    check('Forward opens it again on MCP', new URL(page.url()).hash === '#agents/apps');
    await page.locator('#sysTab-canvas-ai').click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height:960 });
      await wait(50);
      const fits = await page.locator('.sysm').evaluate(el => {
        const within = node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1; };
        const box = el.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && [...el.querySelectorAll('[data-canvas-ai], [data-canvas-effort], .sysm-tabs [aria-selected="true"], .sysm-x')].every(within) && document.documentElement.scrollWidth <= innerWidth;
      });
      check(`the window, its chosen tab and model/effort fit at ${width}px`, fits);
      if (shots && (width === 390 || width === 768)) await page.screenshot({ path:path.join(shots, `settings-window-${width}.png`) });
    }
    await page.setViewportSize({ width:390, height:844 });
    await page.locator('#sysTab-apps').tap();
    await until(() => page.locator('#sysApps').isVisible(), 'MCP opened by touch');
    check('touch opens MCP directly', new URL(page.url()).hash === '#agents/apps');
    await page.setViewportSize({ width:1440, height:960 });

    // Archived projects are a tab of Settings, not a row in the sidebar.
    const { project:beta } = await api("/projects", { method:"POST", body:{ name:"Beta", docsPath:path.join(temp, "Beta docs") } });
    await api(`/projects/${beta.id}`, { method:"PATCH", body:{ archived:true } });
    await page.goto(`${base}/projects.html#${alpha.id}`);
    await page.reload();
    await until(() => page.locator("#railAccount .rail-gear").isVisible(), "the project again");
    check("an archived project adds no row to the sidebar", await page.locator(".rail .rail-shelf:not(.rail-account)").count() === 0);
    await page.locator("#railAccount .rail-gear").click();
    await page.locator("#sysTab-archived").click();
    await until(() => page.locator(".sys-archived .shelf-row", { hasText:"Beta" }).isVisible(), "Beta in Archived");
    check("Archived is a Settings tab with its count", new URL(page.url()).hash === "#archived" && (await page.locator("#sysTab-archived em").textContent()) === "1");
    if (shots) await page.screenshot({ path:path.join(shots, "settings-window-archived.png") });
    await page.keyboard.press("Escape");
    await until(async () => !(await page.locator(".sysm").count()), "Escape closing Settings");
    check("Escape closes Settings onto the project's page", new URL(page.url()).hash.startsWith(`#${alpha.id}`) && await page.locator("#view > *").first().getAttribute("class") === beneath, page.url());
    await page.locator(".rail-new").click();
    await until(() => page.locator(".np-page").isVisible(), "New project");
    await page.locator("#railAccount .rail-gear").click();
    await until(() => page.locator(".sysm").isVisible(), "Settings over New project");
    await page.locator(".sysm-x").click();
    await until(async () => !(await page.locator(".sysm").count()), "the close button");
    check("Settings opened from New project closes back onto it", new URL(page.url()).hash === "#new" && await page.locator(".np-page").isVisible(), page.url());
    await page.goto(`${base}/projects.html#archived`);
    await until(() => page.locator(".sys-archived .shelf-open").isVisible(), "#archived");
    await page.locator(".sys-archived .shelf-open").click();
    await until(async () => !(await page.locator(".sysm").count()) && new URL(page.url()).hash.startsWith(`#${beta.id}`), "the archived project");
    check("a row in Archived opens that project and closes Settings", await page.evaluate(id => window.__lines.S.cur === id && !window.__lines.S.shelfPage, beta.id));

    // Run with lists the saved agents, the default first in the button. An Ask made now has no agent of its own yet.
    const made = await api(`/projects/${alpha.id}/topics`, { method:"POST", body:{ text:"Fix the title on the start page", topic:"new", unsent:true } });
    check("a new Ask goes to the default's runner", Boolean(made.slug));
    await page.goto(`${base}/projects.html#${alpha.id}`);
    await page.reload();
    await until(() => page.getByText("Fix the title on the start page").last().isVisible(), "the new line");
    await page.getByText("Fix the title on the start page").last().click();
    await until(() => page.locator(".run-main").isVisible(), "Run with");
    check("Run uses the default saved agent", (await page.locator(".run-main").textContent()).trim() === "Run with Claude Code · haiku · max effort", await page.locator(".run-main").textContent());
    await page.locator(".run-pick").click();
    await until(() => page.locator("#menu.run-menu").isVisible(), "the Run with menu");
    const items = await page.locator("#menu.run-menu button").allTextContents();
    check("the menu lists each saved agent and Manage agents", items.some(t => t.endsWith("Claude Code · opus · high effort")) && items.some(t => t.includes("OpenCode")) && items.some(t => t.includes("Manage agents")), items.join(" | "));
    if (shots) await page.screenshot({ path:path.join(shots, "run-with-menu.png") });
    await page.keyboard.press("Escape");

    // An existing Claude line has no explicit preset. Its label must show the runner's own settings,
    // even when the check arrives after first paint, without changing the preset sent to the server.
    await api("/agent-presets/default", { method:"POST", body:{ id:"auto:opencode" } });
    let releaseCheck;
    const checked = new Promise(resolve => { releaseCheck = resolve; });
    await page.route("**/api/lines/agents/check", async route => {
      const response = await route.fetch();
      await checked;
      await route.fulfill({ response });
    });
    await page.goto(`${base}/projects.html#${alpha.id}/line/claude-follow-up`);
    await page.reload();
    await until(() => page.locator(".run-main").isVisible(), "the existing Claude line");
    const runButton = await page.locator(".run-main").elementHandle();
    const input = page.locator(".lp-dock .cmp-input");
    await input.fill("Keep this draft while the settings arrive");
    await page.locator(".run-main").focus();
    releaseCheck();
    await until(async () => (await page.locator(".run-main").textContent()).trim() === "Run with Claude Code · opus · high effort", "the runner's model and effort");
    check("late agent metadata updates the same button and preserves focus and draft", await runButton.evaluate(el => el.isConnected && document.activeElement === el) && await input.inputValue() === "Keep this draft while the settings arrive");
    check("showing the runner's settings does not select a saved preset", await page.locator(".run-main").getAttribute("data-preset") === "");
    await page.unroute("**/api/lines/agents/check");
    await page.locator(".run-pick").click();
    check("both Claude configurations remain distinguishable", await page.getByRole("menuitem", { name:"Claude Code · haiku · max effort" }).isVisible() && await page.getByRole("menuitem", { name:"Claude Code · opus · high effort" }).isVisible());
    if (shots) await page.screenshot({ path:path.join(shots, "run-labels-desktop.png") });
    await page.keyboard.press("Escape");

    const requests = [];
    await page.route("**/topics/claude-follow-up/run-unsent", route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json:{} });
    });
    await page.locator(".run-main").click();
    await until(() => requests.length === 1, "the runner-only request");
    check("running the displayed fallback sends no arbitrary saved preset", requests[0].agent === "claude" && !requests[0].preset);
    await page.locator(".run-pick").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await until(() => requests.length === 2, "the keyboard preset choice");
    const opus = saved.presets.find(x => x.model === "opus");
    check("keyboard selection sends the exact Opus preset", requests[1].preset === opus.id);
    await until(async () => await page.locator(".run-main").getAttribute("data-preset") === opus.id, "the picked preset on the button");

    await page.setViewportSize({ width:390, height:844 });
    await page.locator(".run-pick").tap();
    await until(() => page.locator("#menu.run-menu").isVisible(), "the narrow Run menu");
    const readable = await page.locator("#menu").evaluate(menu => {
      const r = menu.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && [...menu.querySelectorAll("button span:not(.av)")].every(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1);
    });
    check("narrow menu keeps the full labels inside the viewport", readable);
    check("narrow Run button wraps without clipping", await page.locator(".run-main").evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1));
    if (shots) await page.screenshot({ path:path.join(shots, "run-labels-mobile.png") });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width:1440, height:960 });

    // The project's own settings keep only the project's things (no Agents, Every project, or MeetCue rows).
    await page.goto(`${base}/projects.html#${alpha.id}/settings`);
    await until(() => page.locator(".settings-page h1").isVisible(), "the project's settings");
    check("the gear opens Project settings", (await page.locator(".settings-page h1").textContent()) === "Project settings");
    check("appearance, agents, every project, and meetcue rows are out of Project settings",
      await page.locator(".settings-page .set-theme").count() === 0
      && await page.locator('.settings-page [aria-label="Agents"]').count() === 0
      && await page.locator('.settings-page [aria-label="Every project"]').count() === 0
      && await page.locator('.settings-page [aria-label="MeetCue"]').count() === 0
      && await page.locator(".settings-page [data-act='open-settings']").count() === 0
      && await page.locator(".settings-page [data-act='open-agents']").count() === 0);

    // Older links to Agent setup and to Settings' Agents tab open the Agents page.
    await page.goto(`${base}/projects.html#setup`);
    await until(() => page.locator("#installed").isVisible(), "#setup");
    await until(() => new URL(page.url()).hash === "#agents", "#setup becoming #agents");
    check("#setup opens Settings on Agents at the agents here", await page.locator("#sysTab-agents[aria-selected='true']").count() === 1);
    await page.goto(`${base}/projects.html#settings/agents`);
    await until(() => new URL(page.url()).hash === "#agents" && page.locator(".sysm #sysAgents").isVisible(), "#settings/agents becoming #agents");
    check("#settings/agents opens Settings on Agents", true);
    await page.goto(`${base}/projects.html#settings/apps`);
    await until(() => new URL(page.url()).hash === '#agents/apps' && page.locator('#sysApps').isVisible(), 'legacy MCP link');
    check('#settings/apps redirects to MCP on Agents', true);

    // The Canvas: no way into the Library, and AI & connections opens Providers.
    const created = await api(`/projects/${alpha.id}/canvases`, { method:"POST", body:{ title:"Settings Check Canvas" } });
    await page.goto(`${base}/?linesProject=${encodeURIComponent(alpha.id)}&linesCanvas=${encodeURIComponent(created.source)}`);
    await page.waitForLoadState("load");
    await wait(2000);
    console.log(`      (the Canvas page is at ${page.url()})`);
    await until(() => page.locator("#settingsBtn").count().then(n => n === 1), "the Canvas page", 30000);
    check("the Canvas shows no Library button", !(await page.locator("#historyBtn").isVisible()) && !(await page.locator("#studioNavigatorManage").isVisible()));
    check("the Canvas's menus have no Library entries", await page.locator("[data-library-entry]").evaluateAll(list => list.every(el => getComputedStyle(el).display === "none")));
    await page.locator('#aiModelButton').click();
    await page.locator('#aiModelMenu .ai-model-settings').click();
    await page.waitForURL(url => url.pathname === '/projects.html' && url.hash === '#agents/canvas');
    await until(() => page.locator('[data-canvas-effort]').isVisible(), 'Canvas AI settings from its bar');
    check('Canvas AI bar opens Agents with the saved model and effort', await page.locator('[data-canvas-ai]').inputValue() === stored.id && await page.locator('[data-canvas-effort]').inputValue() === 'high');
    await page.locator('[data-canvas-effort]').selectOption('medium');
    await page.locator('.sys-back').click();
    await page.waitForURL(url => url.pathname !== '/projects.html');
    await page.waitForLoadState('load');
    await until(() => page.locator('#effortControl').getAttribute('data-effort').then(t => t === 'medium'), 'returned Canvas uses Medium effort');
    check('Back to Canvas restores the same Canvas with its updated effort', new URL(page.url()).searchParams.get('linesCanvas') === created.source);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("penecho:show-settings", { detail:{ page:"connections" } })));
    await page.waitForURL(url => url.pathname === "/projects.html" && url.hash === "#providers", { timeout:20000 });
    check("AI & connections on the Canvas opens Providers", true);
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
