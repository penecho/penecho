#!/usr/bin/env node
"use strict";
// End-to-end verification of the redesigned Canvas header, Share & nested More menus,
// conditional MCP pill, contextual Add-to-Line strip, local tabbed Settings, and Guest Canvas AI selector.
// Usage: PLAYWRIGHT_PATH=/path/to/playwright node scripts/verify-header-redesign.cjs [screenshot-dir]
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const { newBundle } = require(path.join(root, "src", "server", "project-lines", "canvas-file.js"));
const shots = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), "penecho-redesign-shots-"));
fs.mkdirSync(shots, { recursive: true });
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-header-e2e-")));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 320)}` : ""}`); }
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) {
    let val;
    try { val = await fn(); } catch { val = false; }
    if (val) return val;
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`);
    await wait(70);
  }
}
async function findPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

(async () => {
  const port = await findPort();
  const base = `http://127.0.0.1:${port}`;
  const bin = path.join(temp, "bin"), stateDir = path.join(temp, "state");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const stub = (name, out) => {
    const f = path.join(bin, name);
    fs.writeFileSync(f, `#!/bin/sh\necho "${out}"\n`);
    fs.chmodSync(f, 0o755);
  };
  stub("claude", "2.3.0 (Claude Code)");
  stub("opencode", "1.19.5");

  const api = async (route, { method = "GET", body } = {}) => {
    const res = await fetch(`${base}/api/lines${route}`, {
      method,
      headers: { "content-type": "application/json", origin: base },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  };

  let log = "";
  const server = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      PENECHO_TEST_OPEN_ACCESS: "1",
      PENECHO_LINES_EXAMPLES: "0",
      HOME: temp,
      SHELL: "/bin/sh",
      PENECHO_STATE_DIR: stateDir,
      PENECHO_CLOUD_STATE_DIR: path.join(temp, "cloud-state"),
      PORT: String(port),
      HOST: "127.0.0.1",
      PI_CLI_PATH: "/nonexistent",
      CODEX_CLI_PATH: "/nonexistent",
      PATH: `${bin}:/usr/bin:/bin`,
    },
  });
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });

  let browser;
  const pageErrors = [];
  const attachErrorListener = (p) => { p.on("pageerror", (e) => pageErrors.push(e.message)); };

  try {
    await until(() => fetch(`${base}/api/lines/projects`).then((r) => r.ok), "server readiness", 25000);

    // Seed project with two lines and one valid preview-bearing attached canvas
    const { project } = await api("/projects", { method: "POST", body: { name: "Alpha Studio", docsPath: path.join(temp, "docs") } });
    const lineA = await api(`/projects/${project.id}/topics`, { method: "POST", body: { title: "Forecast layout", text: "First line task." } });
    const lineB = await api(`/projects/${project.id}/topics`, { method: "POST", body: { title: "Alert cards", text: "Second line task." } });
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const seedPng = `data:image/png;base64,${pngBase64}`;
    const seedBundle = newBundle({ id: "weather-cards", name: "Weather cards" });
    seedBundle.manifest.textBoxes = [{ id: "weather-title", x: 1800, y: 1800, w: 420, h: 100, maxWidth: 420, fontSize: 32, color: "#172033", text: "Weather cards" }];
    seedBundle.assets.push({ kind: "preview", contentType: "image/png", metadata: { width: 1, height: 1 }, dataBase64: pngBase64 });
    const createdCanvas = await api(`/projects/${project.id}/canvases`, { method: "POST", body: { title: "Weather cards", source: seedBundle, png: seedPng } });
    await api(`/projects/${project.id}/canvases/attach`, { method: "POST", body: { path: createdCanvas.source, topic: lineA.slug } });

    browser = await chromium.launch({ channel: "chrome" });

    // ---------- FLOW A: Local Project Lines Canvas (Desktop 1440x900) ----------
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    attachErrorListener(page);
    page.on("dialog", (d) => d.accept());

    const canvasUrl = `${base}/?${new URLSearchParams({
      linesProject: project.id,
      linesCanvas: createdCanvas.source,
      linesDoc: `lines/${lineA.slug}.md`,
      linesTitle: "Weather cards",
      linesBack: `${project.id}/line/${lineA.slug}`,
    }).toString()}`;
    await page.goto(canvasUrl);
    await until(() => page.locator("#canvasMoreBtn").isVisible(), "Canvas header ready", 30000);
    await until(() => page.locator("#canvasBreadcrumbParent").textContent().then((s) => s.trim() === "Forecast layout"), "Line breadcrumb title");

    check("Flow A desktop: breadcrumb shows Line name", (await page.locator("#canvasBreadcrumbParent").textContent()).trim() === "Forecast layout");
    check("Flow A desktop: MCP pill starts hidden when MCP is off", !(await page.locator("#headerMcpPill").isVisible()));
    check("Flow A desktop: legacy proxy container stays hidden", !(await page.locator("#canvasCommandProxies").isVisible()));

    // Unified Share menu + coordination with More menu
    await page.locator("#shareCanvasBtn").click();
    await until(() => page.locator("#canvasShareMenu").isVisible(), "Share menu open");
    check("Flow A desktop: unified Share menu shows Draw together & View link",
      await page.locator("#shareDrawTogetherBtn").isVisible() && await page.locator("#shareViewLinkBtn").isVisible());

    // Opening More closes Share menu, Download submenu opens cleanly
    await page.locator("#canvasMoreBtn").click();
    await until(() => page.locator("#canvasMoreMenu").isVisible(), "More menu open");
    check("Flow A desktop: opening More closes Share menu", !(await page.locator("#canvasShareMenu").isVisible()));
    await page.locator("#moreDownloadTrigger").click();
    await until(() => page.locator('[data-more-submenu="download"]').isVisible(), "Download submenu");
    check("Flow A desktop: Download submenu shows PNG and PDF options",
      await page.locator('[data-shell-forward="#exportPngBtn"]').isVisible() && await page.locator("#exportPdfBtn").isVisible());
    await page.screenshot({ path: path.join(shots, "desktop-more.png") });
    await page.keyboard.press("Escape");
    await until(() => page.locator("#canvasMoreMenu").isHidden(), "More closed on Escape");

    // Toggle MCP switch inside More -> header pill appears -> toggle off -> disappears
    await page.locator("#canvasMoreBtn").click();
    await until(() => page.locator("#canvasMoreMcpSwitch").isVisible(), "MCP switch");
    await page.locator("#canvasMoreMcpSwitch").click();
    await until(() => page.locator("#headerMcpPill").isVisible(), "MCP pill appears when enabled");
    check("Flow A desktop: header MCP pill shows when enabled", await page.locator("#headerMcpPill").isVisible());
    await page.locator("#canvasMoreMcpSwitch").click();
    await until(() => page.locator("#headerMcpPill").isHidden(), "MCP pill hides when turned off");
    check("Flow A desktop: header MCP pill hides when turned off", !(await page.locator("#headerMcpPill").isVisible()));
    await page.keyboard.press("Escape");

    // More -> New canvas -> preserves Line right panel & shows disabled Add to Line strip
    await page.locator("#canvasMoreBtn").click();
    await until(() => page.locator("#moreNewCanvasBtn").isVisible(), "New canvas item");
    await page.locator("#moreNewCanvasBtn").click();
    await page.waitForURL((u) => new URL(u).searchParams.get("linesOriginLine") === lineA.slug, { timeout: 20000 });
    await until(() => page.locator("#projectLinesPanel").isVisible(), "Originating Line panel", 20000);
    await until(() => page.locator(".project-lines-strip-text").textContent().then((s) => s.includes("Not added to Forecast layout")), "Context strip on new loose canvas");
    for (const selector of ["#tourSkip", "#changelogClose"]) if (await page.locator(selector).isVisible()) await page.locator(selector).click();
    check("Flow A loose canvas: originating Line panel stays open", await page.locator("#projectLinesPanel").isVisible());
    check("Flow A loose canvas: strip shows Not added + disabled Add to Line",
      (await page.locator(".project-lines-strip-text").textContent()).includes("Not added to Forecast layout") &&
      await page.locator(".project-lines-strip-btn.primary").isDisabled());

    // Draw stroke on canvas center (clear of rail/panel/strip) -> Add to Line enables -> Add to Line -> Added + Undo
    await page.keyboard.press("p");
    const vpBox = await page.locator("#viewport").boundingBox();
    const panelBox = await page.locator("#projectLinesPanel").boundingBox();
    const freeLeft = vpBox.x + 280;
    const freeRight = panelBox ? Math.min(vpBox.x + vpBox.width, panelBox.x) - 40 : vpBox.x + vpBox.width - 80;
    const sx = (freeLeft + freeRight) / 2 - 40, sy = vpBox.y + vpBox.height * 0.55;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 80, sy + 40, { steps: 8 });
    await page.mouse.up();
    await until(() => page.locator(".project-lines-strip-btn.primary").isEnabled(), "Add to Line becomes enabled after ink");
    check("Flow A loose canvas: Add to Line enables after drawing", true);
    await page.locator(".project-lines-strip-btn.primary").click();
    await until(() => page.locator('.project-lines-strip-bar[data-state="added"]').isVisible(), "Added to Line state");
    check("Flow A loose canvas: strip shows Added to Forecast layout + Undo",
      (await page.locator(".project-lines-strip-text").textContent()).includes("Added to Forecast layout") &&
      (await page.locator("#projectLinesContextStrip button").textContent()).trim() === "Undo");
    await page.screenshot({ path: path.join(shots, "desktop-loose-added.png") });

    // Click Undo -> reverts to Not added while preserving ink -> re-attach
    await page.locator("#projectLinesContextStrip button", { hasText: "Undo" }).click();
    await until(() => page.locator('.project-lines-strip-bar[data-state="loose"]').isVisible(), "Reverted to loose state on Undo");
    check("Flow A loose canvas: Undo detaches cleanly keeping Add to Line enabled (ink kept)",
      await page.locator(".project-lines-strip-btn.primary").isEnabled());
    await page.locator(".project-lines-strip-btn.primary").click();
    await until(() => page.locator('.project-lines-strip-bar[data-state="added"]').isVisible(), "Re-attached after Undo");

    // More -> Rename, Open folder (HTTP 200), Move to Line
    await page.locator("#canvasMoreBtn").click();
    await page.locator("#moreRenameCanvasBtn").click();
    await until(() => page.locator("#canvasDocumentNameInput").isVisible(), "Inline rename input");
    await page.locator("#canvasDocumentNameInput").fill("Storm cards");
    await page.locator("#canvasDocumentNameInput").press("Enter");
    await until(() => page.locator("#canvasDocumentNameLabel").textContent().then((s) => s.trim() === "Storm cards"), "Renamed canvas");
    check("Flow A desktop: More -> Rename updates Canvas title", true);

    await page.locator("#canvasMoreBtn").click();
    const openFolderRes = page.waitForResponse((r) => r.url().includes("/open-folder") && r.request().method() === "POST");
    await page.locator("#moreOpenFolderBtn").click();
    const folderResp = await openFolderRes;
    check("Flow A desktop: More -> Open folder calls server endpoint cleanly", folderResp.status() === 200);

    await page.locator("#canvasMoreBtn").click();
    check("Flow A desktop: standalone Take off its line action is removed", await page.locator("#moreDetachCanvasBtn").count() === 0);
    await page.locator("#moreMoveCanvasBtn").click();
    await until(() => page.locator(".project-lines-move-dialog").isVisible(), "Move-to-Line modal");
    await page.locator(".project-lines-move-dialog button", { hasText: "Alert cards" }).click();
    await until(() => page.locator("#canvasBreadcrumbParent").textContent().then((s) => s.trim() === "Alert cards"), "Moved to Alert cards");
    check("Flow A desktop: Move to Line switches canvas onto second Line", true);

    // ---------- FLOW B: Unified Tabbed Settings + Back to Canvas ----------
    await page.locator("#canvasMoreBtn").click();
    await page.locator("#canvasMoreSettingsBtn").click();
    await page.waitForURL((u) => new URL(u).pathname === "/projects.html" && new URL(u).hash === "#settings/canvas", { timeout: 20000 });
    await until(() => page.locator('#sysTab-canvas[aria-selected="true"]').isVisible(), "Tabbed settings loaded on Canvas tab");
    check("Flow B settings: Canvas settings lands on View, with AI configuration on Agents",
      await page.locator('#sysCanvasView').isVisible() && await page.locator('[data-canvas-ai]').count() === 0);

    await page.screenshot({ path: path.join(shots, "settings-canvas.png") });
    await page.locator("#prefWheelZoom").click();
    check("Flow B settings: toggling Scroll to zoom writes localStorage",
      await page.evaluate(() => localStorage.getItem("penecho-wheel-zoom") === "true"));

    check("Flow B settings: one window with Agents, Canvas AI, MCP and Providers beside Canvas", await page.locator(".sysm #sysTab-agents").count() === 1);
    await page.locator("#sysTab-agents").click();
    await until(() => page.locator("#sysAgents").isVisible(), "Agents tab visible");
    const agentsText = await page.locator("#sysPanel").textContent();
    check("Flow B agents: its own tab, no dsh copy and no API keys (they are on Providers), Back still shown",
      new URL(page.url()).hash === "#agents" && !/runs on dsh/i.test(agentsText) && await page.locator("#sysKeys").count() === 0 && await page.locator(".sys-back").isVisible());
    await page.screenshot({ path: path.join(shots, "settings-agents.png") });
    await page.locator('#sysTab-canvas-ai').click();
    await until(() => page.locator('[data-canvas-ai]').isVisible(), 'Canvas AI on Agents');
    check('Flow B agents: Canvas AI opens at its own address', new URL(page.url()).hash === '#agents/canvas');
    await page.locator('#sysTab-apps').click();
    await until(() => page.locator('#sysApps').isVisible(), 'MCP on Agents');
    check('Flow B agents: MCP opens at its own address', new URL(page.url()).hash === '#agents/apps');
    await page.locator("#sysTab-providers").click();
    await until(() => page.locator("#sysKeys").isVisible(), "Providers tab visible");
    const cloudSub = await page.locator("#sysPanel .sys-subsec").first().textContent();
    check("Flow B providers: no Cloud Add API key, Add API key under API keys for Canvas AI, Back still shown",
      !/Add API key/.test(cloudSub) && /Add API key/.test(await page.locator("#sysKeys").textContent()) && await page.locator(".sys-back").isVisible());
    await page.locator("#sysTab-canvas").click();
    await until(() => page.locator("#sysCanvasView").isVisible(), "Canvas tab again");

    await page.locator("#sysTab-general").click();
    await until(() => page.locator("#sysGeneral").isVisible(), "General tab visible");
    check("Flow B settings: General renders cleanly", true);

    // Click Back to <Canvas> returns cleanly
    await page.locator(".sys-back").click();
    await until(() => page.locator("#canvasMoreBtn").isVisible(), "Returned to originating Canvas");
    check("Flow B settings: ‹ Back returns directly to originating Canvas", new URL(page.url()).searchParams.get("linesCanvas") !== null);

    // Draw mode (linesDraft=1) keeps top-right primary Done and empty Done returns safely
    const draftCanvas = await api(`/projects/${project.id}/canvases`, { method: "POST", body: { title: "Quick sketch" } });
    const backTarget = `${project.id}/line/${lineA.slug}`;
    await page.goto(`${base}/?${new URLSearchParams({ linesProject: project.id, linesCanvas: draftCanvas.source, linesDraft: "1", linesBack: backTarget }).toString()}`);
    await until(() => page.locator("body.project-lines-draft .project-lines-link").isVisible(), "Draft Done button visible");
    check("Flow A draw mode: top-right button says Done and More/Share stay hidden",
      (await page.locator(".project-lines-link").textContent()).trim() === "Done" &&
      !(await page.locator("#shareCanvasBtn").isVisible()) && !(await page.locator("#canvasMoreBtn").isVisible()));
    await page.locator(".project-lines-link").click();
    await page.waitForURL((u) => new URL(u).pathname === "/projects.html", { timeout: 15000 });
    check("Flow A draw mode: empty Done returns without error", true);
    await ctx.close();

    // ---------- Responsive Tablet (768x1024) & Mobile (390x844) Layout ----------
    for (const vp of [
      { label: "tablet", width: 768, height: 1024, hasTouch: false },
      { label: "mobile", width: 390, height: 844, hasTouch: true },
    ]) {
      const rCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.hasTouch });
      const rp = await rCtx.newPage();
      attachErrorListener(rp);
      await rp.goto(canvasUrl);
      await until(() => rp.locator(".project-lines-panel-button").isVisible(), `${vp.label} header ready`, 30000);
      const metrics = await rp.evaluate(() => {
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const back = box(".project-lines-back"), share = box("#shareCanvasBtn"), more = box("#canvasMoreBtn"), panel = box(".project-lines-panel-button"), bar = box(".topbar");
        return {
          overflowX: document.documentElement.scrollWidth > window.innerWidth,
          hasErrorBanner: Boolean(document.querySelector(".project-lines-error")),
          back, share, more, panel, bar,
          vw: window.innerWidth,
        };
      });
      const singleRow = !metrics.hasErrorBanner && metrics.back && metrics.share && metrics.more && metrics.panel &&
        Math.abs(metrics.back.top - metrics.more.top) < 16 &&
        metrics.back.right <= metrics.share.left + 1 &&
        metrics.share.right <= metrics.more.left + 1 &&
        metrics.more.right <= metrics.panel.left + 1 &&
        metrics.panel.right <= metrics.vw + 1 &&
        !metrics.overflowX;
      check(`Responsive ${vp.label} (${vp.width}x${vp.height}): single-row non-overlapping header with zero overflow`, singleRow, JSON.stringify(metrics));
      await until(() => rp.evaluate(() => {
        const c = document.querySelector(".project-lines-cover");
        return !c || c.hidden || getComputedStyle(c).opacity === "0";
      }), `${vp.label} transition settled`);
      await rp.screenshot({ path: path.join(shots, `${vp.label}-header.png`) });
      if (vp.label === "mobile") {
        await rp.locator("#canvasMoreBtn").click();
        await until(() => rp.locator("#canvasMoreMenu").isVisible(), "mobile More menu");
        await rp.locator("#moreDownloadTrigger").click();
        await until(() => rp.locator('[data-more-submenu="download"] [data-more-back]').isVisible(), "mobile Download submenu back");
        await rp.screenshot({ path: path.join(shots, "mobile-more-sub.png") });
        const noPan = await rp.evaluate(() => window.scrollX === 0 && document.documentElement.scrollLeft === 0);
        await rp.locator('[data-more-submenu="download"] [data-more-back]').click();
        await until(() => rp.locator("#canvasMoreMenu [data-more-panel='root']").isVisible(), "mobile returned to root menu");
        check("Responsive mobile: ⋯ submenu uses stacked Back navigation cleanly", noPan);
      }
      await rCtx.close();
    }

    // ---------- FLOW C: Guest / Cloud Canvas Modal (#settingsLayer) ----------
    const M1 = "11111111-1111-4111-8111-111111111111";
    const M2 = "22222222-2222-4222-8222-222222222222";
    const gCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const gp = await gCtx.newPage();
    attachErrorListener(gp);
    await gp.route("**/api/config.js", (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: `window.PENECHO_CONFIG=${JSON.stringify({ runtime: "cloud", guestCanvas: true, guestAiModelId: "", cloudOrigin: base, openConnections: false, canvasAgent: false, smartSuggestions: false })};`,
    }));
    await gp.route("**/api/v1/guest/ai", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, remaining: 9, limit: 10, model: { id: M1, name: "PenEcho Flash Free" } }),
    }));
    await gp.route("**/api/v1/models", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        guest: true,
        models: [
          { id: M1, displayName: "PenEcho Flash Free", available: true, enabled: true, freeForGuest: true, multiplier: 0, sortOrder: 1 },
          { id: M2, displayName: "PenEcho Thinker Free", available: true, enabled: true, freeForGuest: true, multiplier: 0, sortOrder: 2 },
        ],
      }),
    }));
    await gp.route("**/api/cloud/status", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ account: null, accountSession: { signedIn: false }, device: { configured: false }, browserSignIn: { pending: false } }),
    }));

    await gp.goto(`${base}/?view=canvas`);
    await until(() => gp.locator("#canvasMoreBtn").isVisible(), "Guest Canvas ready", 30000);
    await gp.locator("#canvasMoreBtn").click();
    await until(() => gp.locator("#canvasMoreMenu").isVisible(), "Guest More menu");
    check("Flow C Guest: More menu hides Delete for guest sessions", !(await gp.locator("#moreDeleteCanvasBtn").isVisible()));
    await gp.locator("#canvasMoreSettingsBtn").click();
    await until(() => gp.locator("#settingsLayer").isVisible(), "Guest Settings modal");
    await until(() => gp.locator("#settingsCanvasAiSelect option").count().then((n) => n === 2), "Two free Guest models populated");

    const guestAgentsCardVisible = await gp.locator('#settingsCanvasWhichAi [data-settings-page-jump="connections"]').isVisible();
    const guestWhichAiText = await gp.locator("#settingsCanvasWhichAi").innerText();
    const guestStatusBefore = await gp.locator("#settingsCanvasAiStatus").textContent();
    check("Flow C Guest: #settingsCanvasWhichAi hides Agents card and shows quota hint",
      !guestAgentsCardVisible && /Canvas AI/.test(guestWhichAiText) && /MCP/.test(guestWhichAiText) && /9 \/ 10 left today/.test(guestStatusBefore));

    await gp.locator("#settingsCanvasAiSelect").selectOption(`hosted:${M2}`);
    await until(() => gp.locator("#settingsCanvasAiModelTag").textContent().then((s) => s.includes("PenEcho Thinker Free")), "Switched to 2nd free model");
    const guestStatusAfter = await gp.locator("#settingsCanvasAiStatus").textContent();
    check("Flow C Guest: switching free models updates PENECHO_CONFIG and preserves daily quota",
      (await gp.evaluate(() => window.PENECHO_CONFIG.guestAiModelId)) === M2 && /9 \/ 10 left today/.test(guestStatusAfter));
    await until(() => gp.evaluate(() => getComputedStyle(document.getElementById("settingsPanel")).opacity === "1"), "Settings panel fade-in settled");
    await gp.screenshot({ path: path.join(shots, "guest-canvas-settings.png") });
    await gp.locator('#settingsClose').click();
    await gp.locator('#aiModelButton').click();
    await gp.locator('#aiModelMenu .ai-model-settings').click();
    await until(() => gp.locator('#settingsPanel [data-settings-page="canvas"]:not([hidden])').isVisible(), 'guest Canvas AI bar settings fallback');
    check('Flow C Guest: Canvas AI bar keeps the working modal fallback and selected model', new URL(gp.url()).pathname !== '/projects.html' && await gp.locator('#settingsCanvasAiSelect').inputValue() === `hosted:${M2}`);
    await gCtx.close();

    check("Zero page errors across all Playwright flows", pageErrors.length === 0, pageErrors.join(" | "));
  } catch (error) {
    failures.push(error.message);
    console.log(`FAIL  ${error.message}`);
  } finally {
    await browser?.close();
    server.kill();
    fs.rmSync(temp, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failures.length} failed (screenshots: ${shots})`);
    if (failures.length) {
      console.log(log.slice(-2000));
      process.exitCode = 1;
    }
  }
})();
