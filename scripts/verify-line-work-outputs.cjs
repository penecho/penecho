#!/usr/bin/env node
"use strict";
// What a Work made shows on its card (PE-365): on a real line page, a Work whose result links a Canvas of its own, a document, pictures,
// a Claude Artifact, another line and a prototype page in the code folder shows each on its card, and each opens what it should.
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/verify-line-work-outputs.cjs [folder for screenshots]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const { newBundle } = require("../src/server/project-lines/canvas-file.js");

const root = path.resolve(__dirname, "..");
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-work-outputs-")));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : path.join(temp, "shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 6400 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const docs = path.join(temp, "Studio"), code = path.join(temp, "studio-code");
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, browser = null; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 400)}` : ""}`); }
}
async function until(fn, label, ms = 15000) { const start = Date.now(); for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`); await wait(80); } }
const put = (rel, data, folder = docs) => { const file = path.join(folder, rel); fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, data); };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function seed() {
  put("lines/plan-the-shop.md", `---\nid: S-1\nstatus: done\nwho: @claude\ncreated: 2026-11-14 10:00\n---\n\n# Plan the shop\n\n## Ask · 2026-11-14 10:00\n\nPlan the shop and give me a prototype.\n\n## [x] Work 1 · @claude · 4 min\n\nThe plan, a prototype and a map of the flow are ready.\n\n[Details](plan-the-shop/work-1.md)\n`);
  put("works/plan-the-shop/work-1.md", `---\nline: ../plan-the-shop.md\nstep: Work 1\nwho: @claude\nstarted: 2026-11-14 10:00\nended: 2026-11-14 10:04\n---\n\n# Work 1: Plan the shop\n\n[Back to plan-the-shop.md](../plan-the-shop.md)\n\n## Result\n\n![Shop flow](../../files/shop-flow/canvas.png)\n\n- [The plan](../../files/plan-the-shop/plan.md)\n- [Home, light](../../files/plan-the-shop/home-light.png) and [Home, dark](../../files/plan-the-shop/home-dark.png)\n- [Shop design](https://claude.ai/artifact/ShopDesign0001)\n- Next: [Price the shop](../../lines/price-the-shop.md)\n- Prototype: ${path.join(code, "docs/design/shop/index.html")}\n- Tests in ${path.join(code, "src/shop.test.js")}\n`);
  // The two inline references from PE-665, in a Work from each agent.
  const icon = ".claude/worktrees/design/public/icon (blue).svg";
  put(icon, '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect width="22" height="22" fill="#2563eb"/></svg>', code);
  for (const agent of ["codex", "claude"]) {
    const slug = `links-${agent}`, detail = `works/${slug}/work-1.md`;
    put(`lines/${slug}.md`, `---\nid: demo-${agent}\nstatus: done\nwho: @${agent}\n---\n\n# ${agent} links\n\n## [x] Work 1 · @${agent}\n\n[Details](../${detail})\n`);
    put(detail, `# Work 1 from ${agent}\n\n## Result\n\n[View the icon](<${path.join(code, icon)}>) · [Work 1](<${agent === "codex" ? path.join(docs, detail) : "work-1.md"}>) · [Source](src/shop.test.js:1) · [Canvas picture](../../files/shop-flow/canvas.png) · [Website](https://work-links.example.test/shop)\n`);
  }
  put("lines/price-the-shop.md", `---\nid: S-2\nstatus: not-started\ncreated: 2026-11-14 10:05\n---\n\n# Price the shop\n\n## Ask · 2026-11-14 10:05 · Not sent\n\nPrice it.\n`);
  put("files/plan-the-shop/plan.md", "# The plan\n\nThree shelves and a till.\n");
  put("files/plan-the-shop/home-light.png", PNG);
  put("files/plan-the-shop/home-dark.png", PNG);
  put("files/shop-flow/canvas.penecho.json", JSON.stringify(newBundle({ id:"shop-flow", name:"Shop flow" })));
  put("files/shop-flow/canvas.png", PNG);
  put("docs/design/shop/index.html", "<!doctype html><title>Shop prototype</title><p>Shop</p>", code);
  put("src/shop.test.js", "// test", code);
}

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000).catch(error => { throw new Error(`${error.message}\n${serverLog}`); });
  fs.mkdirSync(code, { recursive:true });
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
  const send = async (method, address, data) => (await context.request[method](`${base}/api/lines${address}`, { data, headers:{ origin:base } })).json();
  const made = await send("post", "/projects", { name:"Studio", docsPath:docs, codePath:code });
  if (!made.project) throw new Error(`Could not make the project: ${JSON.stringify(made)}`);
  seed();
  const id = made.project.id;
  await send("patch", `/projects/${id}`, { offerSkill:false });
  const errors = [], opened = [];
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|Permissions policy violation/.test(m.text())) errors.push(m.text()); });
  await page.exposeFunction("__opened", url => opened.push(url));
  await page.addInitScript(() => { window.open = url => { window.__opened(String(url)); return null; }; });
  const work = () => page.locator('#linePage .lp-work[data-step="work-1"]');
  const goLine = async () => { await page.goto(`${base}/projects.html#${id}/line/plan-the-shop`); await page.waitForSelector('#linePage .lp-work[data-step="work-1"]'); await wait(300); };
  await context.route("https://work-links.example.test/shop", route => route.fulfill({ contentType:"text/plain", body:"Shop website" }));

  for (const [agent, width] of [["codex", 1440], ["claude", 390]]) {
    const slug = `links-${agent}`;
    await page.setViewportSize({ width, height:900 });
    const original = `${base}/projects.html#${id}/line/${slug}/work-1`;
    await page.goto(original);
    const result = page.locator("#lppResult .result-text");
    const icon = result.getByRole("link", { name:"View the icon", exact:true });
    await icon.waitFor({ state:"visible" });
    check(`${agent} shows an underlined icon link before interaction`, await icon.evaluate(a => getComputedStyle(a).textDecorationLine.includes("underline")));
    await icon.click();
    await page.waitForFunction(() => document.querySelector("#lightbox .lb-image-viewport img")?.naturalWidth === 22);
    check(`${agent} opens the referenced SVG with one click`, true);
    await page.locator('#lightbox [data-act="lb-close"]').click();
    const record = result.getByRole("link", { name:"Work 1", exact:true });
    await record.focus();
    await page.keyboard.press("Enter");
    const viewer = page.getByRole("dialog", { name:"work-1.md", exact:true });
    await viewer.getByRole("heading", { name:`Work 1 from ${agent}`, exact:true }).waitFor();
    check(`${agent} opens the correct Markdown record with Enter over the original Work`, page.url() === original && await result.isVisible());
    await viewer.getByRole("tab", { name:"Source" }).click();
    await viewer.getByRole("tab", { name:"Reading" }).click();
    await viewer.getByRole("link", { name:"View the icon", exact:true }).click();
    await page.waitForFunction(() => document.querySelector("#lightbox img")?.naturalWidth === 22);
    await page.keyboard.press("Escape");
    check(`${agent} dismisses the nested preview back to the same Work and link`, page.url() === original && await record.evaluate(a => a === document.activeElement));
    await result.getByRole("link", { name:"Source", exact:true }).click();
    const frame = page.frameLocator("#lightbox iframe");
    await frame.getByText("// test", { exact:true }).waitFor();
    check(`${agent} reads the source in a sandboxed preview`, page.url() === original && await page.locator("#lightbox iframe").getAttribute("sandbox") === "");
    await page.locator('#lightbox [data-act="lb-close"]').click();
    await result.getByRole("link", { name:"Canvas picture", exact:true }).click();
    await page.waitForFunction(() => document.querySelector("#lightbox img")?.naturalWidth === 1);
    check(`${agent} previews a linked Canvas picture over the Work`, page.url() === original);
    await page.locator('#lightbox [data-act="lb-close"]').click();
    const [site] = await Promise.all([context.waitForEvent("page"), result.getByRole("link", { name:"Website" }).click()]);
    await site.getByText("Shop website").waitFor();
    check(`${agent} opens the web link in a separate page`, page.url() === original && await site.evaluate(() => window.opener === null));
    await site.close();
    if (agent === "claude") {
      await page.locator("#lppResult .result-files").getByRole("button", { name:"work-1.md", exact:true }).click();
      await viewer.getByRole("heading", { name:`Work 1 from ${agent}`, exact:true }).waitFor();
      check("the duplicate file button opens the same preview", page.url() === original);
      await viewer.getByRole("button", { name:"Close" }).click();
    }
  }
  await page.setViewportSize({ width:1440, height:1000 });

  console.log("\nThe Work card shows what it made");
  await goLine();
  check("its Canvas of its own, large, with Edit on canvas", await work().locator(".lp-big-pic").count() === 1 && /Shop flow/.test(await work().locator(".lp-big-pic").textContent()) && await work().locator('.lp-big-pic [data-act="open-canvas"]').count() === 1);
  check("its two pictures, small", await work().locator(".lp-out-pics .lp-pic img").count() === 2);
  const names = (await work().locator(".lp-out strong").allTextContents()).map(t => t.trim());
  check("a card each for the plan, the Artifact, the line and the prototype, in that order", JSON.stringify(names) === JSON.stringify(["The plan", "Shop design", "Price the shop", "Shop prototype"]), names.join(" | "));
  check("code it only mentioned is not a card", !names.some(n => /shop\.test/.test(n)));
  check("the result's words are still there", /prototype and a map of the flow/.test(await work().locator(".lp-sum").textContent()));
  await work().scrollIntoViewIfNeeded();
  await page.screenshot({ path:path.join(shots, "work-outputs.png"), fullPage:false });

  console.log("\nEach opens what it should");
  const originLine = page.url();
  await work().locator(".lp-out", { hasText:"The plan" }).click();
  const plan = page.getByRole("dialog", { name:"plan.md" });
  await plan.getByText("Three shelves and a till.").waitFor();
  check("the plan card opens its document over the original Line", page.url() === originLine);
  await plan.getByRole("button", { name:"Close" }).click();
  await work().locator(".lp-out", { hasText:"Shop design" }).click();
  await until(() => opened.length > 0, "the Artifact to open");
  check("the Artifact opens at its address", opened[0] === "https://claude.ai/artifact/ShopDesign0001", opened[0]);
  await work().locator(".lp-out", { hasText:"Price the shop" }).click();
  await page.waitForFunction(() => window.__lines?.S.route.line === "price-the-shop");
  check("the line card goes to that line", true);
  await goLine();
  // Answered here, so the check never opens a browser window on this computer; the server side is in test/project-line-work-outputs.test.js.
  let body = null;
  await page.route("**/open-output", route => { body = JSON.parse(route.request().postData() || "{}"); route.fulfill({ status:200, contentType:"application/json", body:"{\"ok\":true}" }); });
  await work().locator(".lp-out", { hasText:"Shop prototype" }).click();
  await until(() => body, "the open request");
  check("the prototype asks the server to open that page, for this Work", body.step === "work-1" && body.path === path.join(fs.realpathSync(code), "docs/design/shop/index.html"), JSON.stringify(body));
  const refused = await context.request.post(`${base}/api/lines/projects/${id}/topics/plan-the-shop/open-output`, { data:{ step:"work-1", path:path.join(code, "src/shop.test.js") }, headers:{ origin:base } });
  check("a file it did not list is refused", refused.status() === 404, String(refused.status()));
  check("no page errors", errors.length === 0, errors.join(" | "));
})().catch(error => { failures.push(error.message); console.error(error); }).finally(async () => {
  await browser?.close().catch(() => {});
  server.kill();
  console.log(`\n${passed} passed, ${failures.length} failed. Screenshots: ${shots}`);
  if (!failures.length) fs.rmSync(path.join(temp, "state"), { recursive:true, force:true });
  process.exitCode = failures.length ? 1 : 0;
});
