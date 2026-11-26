#!/usr/bin/env node
"use strict";
// PenEcho Cloud inside the Lines pages (public/lines/cloud.js), in a real browser against the app's own server and real projects.
// There is no Cloud to sign in to here, so only Cloud's answers are stood in for: the account, the account's projects, a project's
// Cloud state, and `conflicts` / `held` added to the real state. Where no agent is installed, the agent list is stood in for too.
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/verify-lines-cloud-pages.cjs
// A picture of every state is kept in SHOTS (default: a folder in the system's temp folder), at 1440 and 900 px wide, and in the dark.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-lines-cloud-"));
const shots = process.env.SHOTS || path.join(os.tmpdir(), "penecho-lines-cloud-shots");
fs.mkdirSync(shots, { recursive:true });
const PORT = 5400 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`, ORIGIN = "https://cloud.example";
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0; const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 400)}` : ""}`); }
}
let dump = async () => "", testBrowser;
async function until(fn, label, ms = 10000) {
  const start = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}\n${await dump().catch(() => "")}`); await wait(60); }
}

const server = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, stdio:["ignore", "pipe", "pipe"], env:{ ...process.env, NODE_ENV:"test", PENECHO_TEST_OPEN_ACCESS:"1", HOME:temp, PENECHO_STATE_DIR:path.join(temp, "state"), PENECHO_CLOUD_STATE_DIR:path.join(temp, "cloud-state"), PORT:String(PORT), HOST:"127.0.0.1", CLAUDE_CLI_PATH:"/nonexistent", CODEX_CLI_PATH:"/nonexistent", PATH:"/usr/bin:/bin" } });
let serverLog = ""; server.stdout.on("data", d => { serverLog += d; }); server.stderr.on("data", d => { serverLog += d; });

// What Cloud would say. Each part is changed by the checks below.
const SIGNED_OUT = { signedIn:false, name:"", plan:"", origin:"", storage:null, credits:null, kept:null };
const cloud = {
  account:SIGNED_OUT,     // GET /api/lines/cloud/account; "fail" answers 500
  projects:[],            // GET /api/lines/cloud/projects
  status:{},              // project id → { sync, shared, remote }
  limit:null,             // { kept, limit }: turning Keep on answers 409 project_limit
  conflicts:{},           // project id → [{ path, otherPath, line?, at }]
  held:{},                // "<project id>/<line slug>" → held
  agents:null,            // extra agents for GET /api/lines/agents
  sent:[],                // every request that went to a stood-in route: { method, path, body }
};
const json = (route, status, body) => route.fulfill({ status, contentType:"application/json", body:JSON.stringify(body) });
const account = (name, plan, credits, kept) => ({ signedIn:true, name, plan, origin:ORIGIN, storage:null, credits:{ available:credits }, kept });
const statusOf = id => ({ signedIn:cloud.account.signedIn === true, name:cloud.account.name || "", plus:["plus", "pro"].includes(cloud.account.plan), sync:false, shared:false, remote:null, origin:ORIGIN, link:"", maxBytes:209715200, progress:null, error:"", ...(cloud.status[id] || {}) });

(async () => {
  await until(() => serverLog.includes("PenEcho:"), "the server to start", 30000);
  const browser = testBrowser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:"chrome" });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
  const real = { post:async (p, data) => (await context.request.post(`${base}/api/lines${p}`, { data, headers:{ origin:base } })).json(), get:async p => (await context.request.get(`${base}/api/lines${p}`)).json() };

  // ---------- Real projects and lines ----------
  const docs = name => path.join(temp, "docs", name);
  const weather = (await real.post("/projects", { name:"Weather app", docsPath:docs("Weather app") })).project;
  const algebra = (await real.post("/projects", { name:"Linear algebra", docsPath:docs("Linear algebra") })).project;
  const dark = (await real.post(`/projects/${weather.id}/unsent`, { text:"Add a dark mode that follows the system setting.", topic:"new" })).slug;
  const wind = (await real.post(`/projects/${weather.id}/unsent`, { text:"Show the wind speed on the map.", topic:"new" })).slug;
  const notes = (await real.post(`/projects/${weather.id}/unsent`, { text:"Summarise the notes, please.", topic:"new" })).slug;
  await real.post(`/projects/${algebra.id}/unsent`, { text:"Find the eigenvalues of this matrix.", topic:"new" });
  const topicFile = slug => path.join(docs("Weather app"), "lines", `${slug}.md`);

  // ---------- Cloud's answers ----------
  const answer = async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname.slice("/api/lines".length), method = request.method();
    const body = () => { try { return request.postDataJSON(); } catch { return null; } };
    const note = () => cloud.sent.push({ method, path:p, body:method === "GET" ? undefined : body() });
    if (cloud.account === "real") return route.continue();
    if (p === "/cloud/account") { note(); return cloud.account === "fail" ? json(route, 500, { error:"Something went wrong." }) : json(route, 200, cloud.account); }
    if (p === "/cloud/projects") { note(); return cloud.account.signedIn ? json(route, 200, { projects:cloud.projects, kept:cloud.account.kept?.projects ?? null, limit:cloud.account.kept?.limit ?? null }) : json(route, 401, { error:"Sign in to PenEcho Cloud first.", code:"SIGN_IN" }); }
    if (p === "/cloud/sign-in" && method === "POST") { note(); return json(route, 200, { authorizationUrl:`${ORIGIN}/authorize?device=1` }); }
    if (p === "/cloud/sign-out" && method === "POST") { note(); cloud.account = SIGNED_OUT; cloud.projects = []; return json(route, 200, SIGNED_OUT); }
    let m = /^\/cloud\/projects\/([^/]+)\/copy$/.exec(p);
    if (m && method === "POST") {
      note();
      // The copy is a real project on this computer, as the server would make it.
      const entry = cloud.projects.find(c => c.key === decodeURIComponent(m[1]));
      const made = await real.post("/projects", { name:entry.name, docsPath:docs(entry.name) });
      Object.assign(entry, { here:true, id:made.project.id });
      cloud.status[made.project.id] = { sync:true, remote:{ key:entry.key, sizeBytes:entry.sizeBytes, updatedAt:entry.updatedAt } };
      return json(route, 200, { project:made.project, existed:false });
    }
    m = /^\/projects\/([^/]+)\/cloud$/.exec(p);
    if (m) {
      note();
      const id = decodeURIComponent(m[1]);
      if (method === "POST") {
        const on = Boolean(body()?.sync);
        if (on && cloud.limit) return json(route, 409, { error:"project_limit", message:"A free account keeps 3 projects in Cloud.", details:cloud.limit });
        const name = [weather, algebra].find(x => x.id === id)?.name || "Project";
        cloud.status[id] = on ? { sync:true, remote:{ key:id, name, sizeBytes:3463, updatedAt:new Date().toISOString() } } : { sync:false, remote:null };
        cloud.projects = cloud.projects.filter(c => c.id !== id);
        if (on) cloud.projects.push({ key:id, name, lines:1, sizeBytes:3463, updatedAt:new Date().toISOString(), here:true, id });
      }
      return json(route, 200, statusOf(id));
    }
    m = /^\/projects\/([^/]+)\/conflicts$/.exec(p);
    if (m && method === "POST") {
      note();
      // What the server does with the two files: keep ours, take Cloud's, or keep Cloud's as a file of its own.
      const id = decodeURIComponent(m[1]), sent = body(), entry = (cloud.conflicts[id] || []).find(c => c.path === sent.path);
      if (!entry) return json(route, 404, { error:"There is no choice waiting for that file.", code:"NOT_FOUND" });
      const folder = docs("Weather app"), mine = path.join(folder, entry.path), other = path.join(folder, entry.otherPath);
      let kept = "";
      if (sent.keep === "theirs") { fs.copyFileSync(other, mine); fs.rmSync(other); }
      else if (sent.keep === "both") { kept = entry.path.replace(/(\.[^./]+)$/, "-2$1"); fs.renameSync(other, path.join(folder, kept)); }
      else fs.rmSync(other);
      cloud.conflicts[id] = cloud.conflicts[id].filter(c => c !== entry);
      return json(route, 200, { ok:true, ...(kept ? { kept } : {}), conflicts:cloud.conflicts[id] });
    }
    m = /^\/projects\/([^/]+)\/state$/.exec(p);
    if (m) {
      // The real state, with what Cloud's sync would have added. Always asked in full, so a change here is never answered "same".
      const id = decodeURIComponent(m[1]), asked = url.searchParams.get("rev");
      const got = await route.fetch({ url:`${url.origin}${url.pathname}` });
      if (!got.ok()) return route.fulfill({ response:got });
      const state = await got.json(), added = { conflicts:cloud.conflicts[id] || [], held:Object.fromEntries(Object.entries(cloud.held).filter(([k]) => k.startsWith(`${id}/`))) };
      state.rev = `${state.rev}:${JSON.stringify(added)}`;
      if (asked === state.rev) return json(route, 200, { same:true, rev:state.rev });
      state.conflicts = added.conflicts;
      for (const line of [...state.lines, ...state.landed, ...state.backlog]) { const held = cloud.held[`${id}/${line.slug}`], ask = held && line.stations.find(s => s.unsent); if (ask) ask.held = held; }
      return json(route, 200, state);
    }
    // No credits: the server keeps the Ask, Not sent and held, and answers 402 with Cloud's body.
    m = /^\/projects\/([^/]+)\/topics(?:\/([^/]+)\/run-unsent)?$/.exec(p);
    if (m && method === "POST" && cloud.noCredits) {
      note();
      const id = decodeURIComponent(m[1]), slug = m[2] ? decodeURIComponent(m[2]) : (await real.post(`/projects/${id}/unsent`, { text:body().text, topic:"new" })).slug;
      cloud.held[`${id}/${slug}`] = { reason:"credits", balance:0, required:1 };
      return json(route, 402, { error:"insufficient_credits", details:{ balance:0, reserved:0, required:1 } });
    }
    if (p === "/agents" && method === "GET" && cloud.agents) {
      const list = await (await route.fetch()).json();
      list.agents = [...list.agents.filter(a => !cloud.agents.some(x => x.id === a.id)), ...cloud.agents];
      return json(route, 200, list);
    }
    return route.continue();
  };
  await context.route("**/api/lines/**", route => answer(route).catch(() => route.abort().catch(() => {})));

  const page = await context.newPage();
  const errors = [], thrown = [];   // errors: since the page was last opened; thrown: every exception of the whole run
  page.on("pageerror", e => { errors.push(e.message); thrown.push(e.message); });
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(() => { window.__opened = []; window.open = url => { window.__opened.push(String(url)); return null; }; });
  dump = () => page.evaluate(() => `toast: ${document.querySelector("#toast")?.hidden ? "" : document.querySelector("#toast")?.innerText}\nview: ${document.querySelector("#view")?.innerText.slice(0, 900)}`);
  // What the page opened in the browser since this was last asked. It may come a moment after the click.
  const opened = async () => { await page.waitForFunction(() => window.__opened.length > 0, null, { timeout:5000 }).catch(() => {}); return page.evaluate(() => window.__opened.splice(0)); };
  const sent = (method, test) => cloud.sent.filter(r => r.method === method && test.test(r.path));
  const text = selector => page.locator(selector).first().innerText();
  const count = selector => page.locator(selector).count();
  async function open(hash) {
    cloud.sent.length = 0; errors.length = 0;
    await page.goto("about:blank");
    await page.goto(`${base}/projects.html#${hash}`);
    await page.waitForFunction(() => window.__lines && S.cloudLoaded && document.querySelector("#view")?.children.length);
    await wait(250);
  }
  // Keep in Cloud is under Share ▾ (PE-478): the Share button says on or off, and its menu opens the box.
  const keepState = () => page.locator(".bar-share").getAttribute("data-keep");
  const openKeep = async () => { await page.click(".bar-share"); await page.click("#menu button:has-text('in Cloud')"); };
  // The page asks again, as it does by itself every minute and every two seconds.
  const again = () => page.evaluate(async () => { await loadCloudAccount(); await window.__lines.poll(); });
  // Nothing may be wider than the window, and nothing in a Cloud box may be cut off.
  const fits = () => page.evaluate(() => {
    const wide = document.documentElement.scrollWidth > innerWidth + 1 ? ["the page scrolls sideways"] : [];
    for (const el of document.querySelectorAll(".cloud-banner, .cloud-pop, .bar-share, .rail-account, .held-wait, .cloud-compare, #menu")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) wide.push(`${el.className} leaves the window`);
      for (const b of el.querySelectorAll("button")) { const q = b.getBoundingClientRect(); if (q.width && (q.right > r.right + 1 || q.left < r.left - 1 || b.scrollWidth > b.clientWidth + 1)) wide.push(`${b.textContent.trim()} is cut off in ${el.className}`); }
    }
    return wide;
  });
  async function shot(name, menu = "") {
    const problems = [];
    for (const [width, height] of [[1440, 900], [900, 700]]) {
      await page.setViewportSize({ width, height });
      await wait(200);
      if (menu) { await page.keyboard.press("Escape"); await page.click(menu); await wait(120); }
      await page.screenshot({ path:path.join(shots, `${name}-${width}.png`) });
      problems.push(...(await fits()).map(x => `${width}px: ${x}`));
    }
    await page.setViewportSize({ width:1440, height:900 });
    await wait(120);
    if (menu) { await page.keyboard.press("Escape"); await page.click(menu); await wait(120); }
    // The same state in the dark, for the eye only.
    await page.evaluate(() => window.linesTheme.set("dark"));
    await wait(120);
    await page.screenshot({ path:path.join(shots, `${name}-dark.png`) });
    await page.evaluate(() => window.linesTheme.set("system"));
    check(`${name}: nothing overflows at 1440 or 900 px`, problems.length === 0, problems.join("; "));
  }

  // ---------- Signed out ----------
  console.log("\nSigned out");
  // First with nothing stood in for: this server's own answers, on a computer that never signed in.
  cloud.account = "real";
  await open(weather.id);
  check("with the server's own answers: Sign in, no Keep in Cloud, nothing failed", (await text("#railAccount")).trim() === "Sign in" && await count('.bar-share[data-act="share-menu"], .rail-cloud, .rail-away, .cloud-banner') === 0 && errors.length === 0 && await page.locator("#toast").isHidden(), errors.join(" | "));
  cloud.account = SIGNED_OUT;
  await open(weather.id);
  check("the rail offers Sign in", (await text("#railAccount")).trim() === "Sign in");
  check("there is no Keep in Cloud button, cloud mark or Cloud project", await count('.bar-share[data-act="share-menu"]') === 0 && await count(".rail-cloud") === 0 && await count(".rail-away") === 0);
  check("the page did not ask for the account's projects", sent("GET", /^\/cloud\/projects$/).length === 0);
  check("nothing failed, nothing spins and no message shows", errors.length === 0 && await count("#rail .spin, #projbar .spin") === 0 && await page.locator("#toast").isHidden(), errors.join(" | "));
  await shot("01-signed-out");
  await page.click("#railAccount button");
  await until(async () => sent("POST", /^\/cloud\/sign-in$/).length === 1, "the sign-in request");
  check("Sign in opens the browser at the address the server gave", (await opened()).join() === `${ORIGIN}/authorize?device=1`);
  await page.evaluate(() => clearInterval(cloudSignIn.timer));
  await open(`${weather.id}/line/${dark}`);
  check("a line page is as it was: Not sent, no Cloud banner", await count(".unsent-box") === 1 && await count(".cloud-banner, .held-wait") === 0 && errors.length === 0, errors.join(" | "));
  cloud.account = { signedIn:false, unavailable:true };
  await open(weather.id);
  check("a server with no Cloud shows no account row and no error", (await text("#railAccount")).trim() === "" && errors.length === 0, errors.join(" | "));
  cloud.account = "fail";
  await open(weather.id);
  check("an account answer that fails shows no row, and the page still works", (await text("#railAccount")).trim() === "" && await count(".subnav button") > 3 && await page.locator("#toast").isHidden());

  // ---------- Signed in, free ----------
  console.log("\nSigned in, free");
  const day = 86400000, minutesAgo = n => new Date(Date.now() - n * 60000).toISOString();
  cloud.account = account("yang kong", "free", 1500, { projects:1, limit:3 });
  cloud.projects = [
    { key:weather.id, name:"Weather app", lines:3, sizeBytes:184 * 1048576, updatedAt:minutesAgo(2), here:true, id:weather.id },
    { key:"psupplier0001", name:"Supplier talks", lines:1, sizeBytes:12 * 1048576, updatedAt:new Date(Date.now() - 6 * day).toISOString(), here:false },
  ];
  cloud.status[weather.id] = { sync:true, remote:{ key:weather.id, name:"Weather app", sizeBytes:184 * 1048576, updatedAt:minutesAgo(2) } };
  await open(weather.id);
  check("the row shows the name and a Free chip", (await text("#railAccount button > span")).trim() === "yang kong" && (await text("#railAccount .acct-plan")).trim() === "Free" && await count("#railAccount .acct-plan.paid") === 0, await text("#railAccount"));
  await page.click("#railAccount button");
  check("its menu says the credits left, then Plan & credits and Sign out", (await text("#menu")).replace(/\s+/g, " ").trim() === "1,500 credits left Plan & credits Sign out", await text("#menu"));
  await shot("02-account-free-menu", "#railAccount button");
  await page.click("#menu button:has-text('Plan & credits')");
  check("Plan & credits opens the account's billing page", (await opened()).join() === `${ORIGIN}/dashboard.html#billing`);

  // ---------- A project kept in Cloud ----------
  console.log("\nA project kept in Cloud");
  check("the kept project has a cloud mark in the rail, the other has none", await count(`.rail-row[data-p="${weather.id}"] .rail-cloud`) === 1 && await count(`.rail-row[data-p="${algebra.id}"] .rail-cloud`) === 0);
  check("the project bar says In Cloud", await keepState() === "on");
  await openKeep();
  await until(async () => /184 MB/.test(await text(".cloud-pop")), "the kept state");
  check("the box says it is kept, up to date, when and how big", (await text(".cloud-pop")).replace(/\s+/g, " ").trim() === "Kept in PenEcho Cloud Up to date · 2 minutes ago · 184 MB Open on penecho.ai" && await page.locator(".cloud-pop .switch").getAttribute("aria-checked") === "true", await text(".cloud-pop"));
  await shot("03-project-kept");
  cloud.status[weather.id].skipped = [{ path:'files/builds/PenEcho-1.5.0-mac-arm64.dmg', size:237 * 1048576, reason:'too_large' }];
  cloud.status[weather.id].notice = '1 file was skipped because it is over 64 MB. It stays on this computer; any existing Cloud copy is unchanged. files/builds/PenEcho-1.5.0-mac-arm64.dmg (237 MB).';
  await page.keyboard.press("Escape"); await openKeep();
  await until(async () => /Synced with 1 skipped file/.test(await text('.cloud-pop')), 'the partial sync notice');
  check('partial sync names the skipped file and does not claim everything is up to date', /64 MB/.test(await text('.cloud-pop')) && /237 MB/.test(await text('.cloud-pop')) && !/Up to date/.test(await text('.cloud-pop')) && await count('.cloud-pop .is-bad') === 0);
  await shot('03a-project-skipped-file');
  await page.setViewportSize({ width:390, height:844 });
  await page.waitForTimeout(100);
  check('the skipped notice fits a phone width', await page.locator('.cloud-pop').evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth));
  await page.screenshot({ path:path.join(shots, '03a-project-skipped-file-390.png') });
  await page.setViewportSize({ width:1440, height:900 });
  cloud.status[weather.id].error = 'Sign in again to continue syncing.';
  await page.keyboard.press('Escape'); await openKeep();
  await until(async () => /Sign in again/.test(await text('.cloud-pop')), 'the actual failure');
  check('an actual error never reports successful partial sync', !/Synced with|Up to date/.test(await text('.cloud-pop')) && await count('.cloud-pop [role=alert]') === 1);
  delete cloud.status[weather.id].error; delete cloud.status[weather.id].skipped; delete cloud.status[weather.id].notice;
  await page.keyboard.press('Escape'); await openKeep();
  await until(async () => /Up to date/.test(await text('.cloud-pop')), 'skipped status clears');
  check('complete sync clears the skipped notice', !/skipped/.test(await text('.cloud-pop')));
  if (process.env.CLOUD_KEEP_ONLY === '1') {
    check('the Cloud panel threw no page errors', thrown.length === 0, thrown.join(' | '));
    console.log(`${passed} passed, ${failures.length} failed`);
    process.exitCode = failures.length ? 1 : 0;
    return;
  }
  await page.keyboard.press("Escape");
  await page.click(".bar-share"); await page.click("#menu button:has-text('Share link')");
  await until(async () => await count(".share-dialog [data-share-create]") === 1, "the Share dialog");
  check("Share is only about the link now: no second switch for keeping", /People with the link can read this project/.test(await text(".share-dialog")) && await count(".share-dialog input[type=checkbox]") === 0 && !/Keep in Cloud/.test(await text(".share-dialog")));
  await page.click(".share-dialog [data-cancel]");
  await openKeep();
  await until(async () => await count(".cloud-pop .switch") === 1, "the box again");
  await page.click(".cloud-pop .switch");
  // Turning it off deletes the copy in Cloud, so it asks first; "Keep it" changes nothing.
  await until(async () => await count(".cloud-pop [data-keep-out]") === 1, "the question before it is taken out");
  check("turning the switch off asks first and sends nothing yet", /Its copy in Cloud is deleted\. The project on this computer stays\./.test(await text(".cloud-pop")) && sent("POST", /\/cloud$/).length === 0);
  await page.click(".cloud-pop [data-keep-stay]");
  await until(async () => await count(".cloud-pop .switch.on") === 1, "the switch again, still on");
  check("Keep it leaves the project in Cloud", sent("POST", /\/cloud$/).length === 0 && await keepState() === "on");
  await page.click(".cloud-pop .switch");
  await until(async () => await count(".cloud-pop [data-keep-out]") === 1, "the question again");
  await page.click(".cloud-pop [data-keep-out]");
  await until(async () => await keepState() === "off", "the button to say Keep in Cloud");
  check("Take it out sends { sync:false }", JSON.stringify(sent("POST", /\/cloud$/).map(r => r.body)) === '[{"sync":false}]');
  check("the mark leaves the rail at once", await count(`.rail-row[data-p="${weather.id}"] .rail-cloud`) === 0);

  // ---------- Only here ----------
  console.log("\nA project that is only here");
  await page.keyboard.press("Escape");
  await open(algebra.id);
  check("the project bar offers Keep in Cloud", await keepState() === "off");
  await openKeep();
  await until(async () => await count(".cloud-pop .switch") === 1, "the box");
  check("the box has one switch, off, and one line", (await text(".cloud-pop")).replace(/\s+/g, " ").trim() === "Keep in PenEcho Cloud Your code stays on this computer." && await page.locator(".cloud-pop .switch").getAttribute("aria-checked") === "false", await text(".cloud-pop"));
  await shot("04-project-only-here");
  await page.click(".cloud-pop .switch");
  await until(async () => await keepState() === "on", "the button to say In Cloud");
  check("turning it on sends { sync:true }", JSON.stringify(sent("POST", /\/cloud$/).map(r => r.body)) === '[{"sync":true}]');
  await until(async () => await count(`.rail-row[data-p="${algebra.id}"] .rail-cloud`) === 1, "the mark in the rail");
  check("the project gets its mark, and the box now says Kept", /^Kept in PenEcho Cloud/.test((await text(".cloud-pop")).trim()));
  await page.keyboard.press("Escape");
  check("Escape closes the box", await count(".cloud-pop") === 0);

  // ---------- The free limit ----------
  console.log("\nThe free limit");
  cloud.status[algebra.id] = { sync:false, remote:null };
  cloud.projects = [...cloud.projects.filter(c => c.id !== algebra.id), { key:"pcalculus00001", name:"Calculus 101", lines:2, sizeBytes:5 * 1048576, updatedAt:minutesAgo(300), here:false }, { key:"pnotebook00001", name:"Notebook", lines:4, sizeBytes:1048576, updatedAt:minutesAgo(900), here:false }];
  cloud.account = account("yang kong", "free", 1500, { projects:3, limit:3 });
  await open(algebra.id);
  await openKeep();
  await until(async () => await count(".cloud-pop button") === 1, "the box");
  check("a free account that keeps 3 is told so, with no switch", (await text(".cloud-pop")).replace(/\s+/g, " ").trim() === "Free keeps 3 projects in Cloud You have 3. Any plan keeps every project. See the plans" && await count(".cloud-pop .switch") === 0, await text(".cloud-pop"));
  await shot("05-project-free-limit");
  await page.click(".cloud-pop button");
  check("See the plans opens the billing page", (await opened()).join() === `${ORIGIN}/dashboard.html#billing`);
  // The page thought there was room; Cloud says there is not.
  cloud.account = account("yang kong", "free", 1500, { projects:2, limit:3 });
  cloud.limit = { kept:3, limit:3 };
  await open(algebra.id);
  await openKeep();
  await until(async () => await count(".cloud-pop .switch") === 1, "the box");
  await page.click(".cloud-pop .switch");
  await until(async () => /Free keeps 3 projects/.test(await text(".cloud-pop")), "the limit from Cloud's 409");
  check("Cloud's 409 project_limit shows the same message, and the project is not marked kept", await keepState() === "off" && /You have 3\./.test(await text(".cloud-pop")) && JSON.stringify(sent("POST", /\/cloud$/).map(r => r.body)) === '[{"sync":true}]');
  cloud.limit = null;
  await page.keyboard.press("Escape");

  // ---------- A project that is only in Cloud ----------
  console.log("\nA project that is only in Cloud");
  cloud.status[weather.id] = { sync:true, remote:{ key:weather.id, name:"Weather app", sizeBytes:184 * 1048576, updatedAt:minutesAgo(2) } };
  cloud.projects = cloud.projects.filter(c => c.key !== weather.id).concat({ key:weather.id, name:"Weather app", lines:3, sizeBytes:184 * 1048576, updatedAt:minutesAgo(2), here:true, id:weather.id });
  await open(weather.id);
  const rail = await page.locator("#railList").evaluate(el => [...el.children].map(x => x.tagName === "HR" ? "—" : x.classList.contains("rail-lines") || x.classList.contains("rail-sec") || x.classList.contains("rail-pins") ? "" : `${x.querySelector(".rail-name").textContent}${x.querySelector(".rail-cloud") ? " ☁" : ""}${x.classList.contains("rail-away") ? " (away)" : ""}`).filter(Boolean).join(" | "));
  // MeetCue's row, where the MeetCue pages are loaded, comes last, below a rule of its own.
  check("Cloud-only projects come after the local ones, below a rule, each with the mark", /^(Weather app ☁ \| Linear algebra|Linear algebra \| Weather app ☁) \| — \| Supplier talks ☁ \(away\) \| Calculus 101 ☁ \(away\) \| Notebook ☁ \(away\)( \| — \| MeetCue)?$/.test(rail), rail);
  await shot("06-rail-cloud-projects");
  await page.click(".rail-away .rail-row:has-text('Supplier talks')");
  check("the sidebar opens the Cloud project directly on the web", (await opened()).join() === `${ORIGIN}/lines/psupplier0001`);
  await open('cloud/psupplier0001');
  await until(async () => await count(".cloud-page") === 1, "the saved Cloud project's page");
  check("its saved page has the name and only the web action", (await text(".cloud-page h1 span:last-child")).trim() === "Supplier talks" && (await text(".cloud-page .cloud-banner")).replace(/\s+/g, " ").trim() === "This project is in PenEcho Cloud. Open it on the web to view it on this computer. Open on penecho.ai", await text(".cloud-page"));
  check("its row in the rail is the one that is on, and the project bar is gone", await count(".rail-away .rail-row.on") === 1 && await count(".rail-row.on") === 1 && await count('.bar-share[data-act="share-menu"]') === 0);
  await shot("07-cloud-only-project");
  await page.click(".cloud-page button:has-text('Open on penecho.ai')");
  check("Open on penecho.ai opens this project", (await opened()).join() === `${ORIGIN}/lines/psupplier0001`);
  // To another page outside the projects and back: each is drawn again, never left showing the other.
  for (const [button, selector] of [["#railAccount .rail-gear", ".sysm"], [".rail-meetcue .rail-row", ""]]) {
    if (!await count(button)) continue;
    await page.click(button);
    await until(async () => (selector === ".sysm" || await count(".cloud-page") === 0) && (!selector || await count(selector) === 1), `the page behind ${button}`);
    await page.goBack();
    await until(async () => await count(".cloud-page") === 1, "the Cloud project's page again");
  }
  check("going to Settings or MeetCue and back shows the Cloud project again", (await text(".cloud-page h1 span:last-child")).trim() === "Supplier talks" && await count(".rail-away .rail-row.on") === 1);
  await page.reload();
  await page.waitForFunction(() => window.__lines && S.cloudLoaded);
  await until(async () => await count(".cloud-page") === 1, "the page after a reload");
  check("the page is still there after a reload", (await text(".cloud-page h1 span:last-child")).trim() === "Supplier talks");
  check("there is no copy action or request", await count('[data-act="cloud-copy"]') === 0 && sent("POST", /\/copy$/).length === 0);
  check("the project remains only in Cloud", cloud.projects.find(c => c.key === "psupplier0001").here === false);
  await page.goto(`${base}/projects.html#cloud/nothing-here`);
  await page.reload();
  await page.waitForFunction(() => window.__lines && S.cloudLoaded);
  await wait(400);
  check("a link to a Cloud project that is not there opens a real project instead", await count(".cloud-page") === 0 && await count(".subnav button") > 3);

  // ---------- Signed in, Plus ----------
  console.log("\nSigned in, Plus");
  cloud.account = account("Alexandra Konstantinopoulou-Whitfield", "plus", 3120, { projects:5, limit:null });
  await open(algebra.id);
  check("a plan shows as its own chip, and a long name is cut, not the chip", (await text("#railAccount .acct-plan")).trim() === "Plus" && await count("#railAccount .acct-plan.paid") === 1 && await page.locator("#railAccount .acct-plan").evaluate(el => el.getBoundingClientRect().right <= el.closest("button").getBoundingClientRect().right));
  await openKeep();
  await until(async () => await count(".cloud-pop .switch") === 1, "the box");
  check("a plan is never told about the free limit", !/Free keeps/.test(await text(".cloud-pop")));
  await page.keyboard.press("Escape");
  await page.click("#railAccount button");
  await shot("08-account-plus-menu", "#railAccount button");
  await page.click("#menu button:has-text('Sign out')");
  await until(async () => (await text("#railAccount")).trim() === "Sign in", "the row to say Sign in");
  check("Sign out sends POST /cloud/sign-out and everything of Cloud leaves the page", sent("POST", /^\/cloud\/sign-out$/).length === 1 && await count('.bar-share[data-act="share-menu"], .rail-cloud, .rail-away') === 0);
  for (const [plan, chip] of [["starter", "Starter"], ["pro", "Pro"], ["max", "Max"]]) {
    cloud.account = account("yang kong", plan, 100, { projects:1, limit:null });
    await again();
    check(`the ${chip} plan shows as ${chip}`, (await text("#railAccount .acct-plan")).trim() === chip);
  }

  // ---------- Two versions of a file ----------
  console.log("\nTwo versions of a file");
  cloud.account = account("yang kong", "plus", 3120, { projects:5, limit:null });
  cloud.projects = [{ key:weather.id, name:"Weather app", lines:3, sizeBytes:184 * 1048576, updatedAt:minutesAgo(2), here:true, id:weather.id }];
  const otherPath = `lines/${dark}.cloud-20261110-194530.md`, minePath = `lines/${dark}.md`;
  const original = fs.readFileSync(topicFile(dark), "utf8");
  const clash = () => {
    fs.writeFileSync(topicFile(dark), original);
    fs.writeFileSync(path.join(docs("Weather app"), otherPath), original.replaceAll("follows the system setting", "can be switched by hand"));
    cloud.conflicts[weather.id] = [{ path:minePath, otherPath, line:dark, at:Date.now() }];
  };
  clash();
  await open(`${weather.id}/line/${dark}`);
  check("the line says it changed in two places, with Compare and Choose", (await text("#lpCloud")).replace(/\s+/g, " ").trim() === "This line changed here and on penecho.ai, and the two could not be joined. Compare Choose", await text("#lpCloud"));
  // The rail lists the newest five lines of the open project, so with three lines it lists three: Cloud's version is none of them.
  const lineCount = () => page.evaluate(() => window.__lines.project().lines.length);
  const railCount = () => page.evaluate(() => document.querySelector("#railList .rail-row.on").closest(".rail-item").nextElementSibling.querySelectorAll(".rail-line").length);
  check("Cloud's version is not listed as a line of its own", await lineCount() === 3 && await railCount() === 3, `${await lineCount()} lines, ${await railCount()} in the rail`);
  await shot("09-line-two-versions");
  await page.click("#lpCloud button:has-text('Compare')");
  await until(async () => /can be switched by hand/.test(await text('.cloud-compare pre[data-side="theirs"]')), "both files in the dialog");
  check("Compare shows both files side by side, as plain text", /follows the system setting/.test(await text('.cloud-compare pre[data-side="mine"]')) && /^---/.test((await text('.cloud-compare pre[data-side="mine"]')).trim()) && await page.locator(".cloud-compare").evaluate(el => { const [a, b] = el.querySelectorAll("pre"); return a.getBoundingClientRect().right <= b.getBoundingClientRect().left; }));
  await shot("10-compare");
  await page.click(".cloud-compare [data-cancel]");
  await page.click("#lpCloud button:has-text('Choose')");
  check("Choose offers the three answers", (await text("#menu")).replace(/\s+/g, " ").trim() === "Keep this one Keep the other Keep both", await text("#menu"));
  await shot("11-line-choose", "#lpCloud button:has-text('Choose')");
  const settled = () => JSON.stringify(sent("POST", /\/conflicts$/).map(r => r.body));
  await page.click("#menu button:has-text('Keep this one')");
  await until(async () => await count("#lpCloud .cloud-banner") === 0, "the banner to go");
  check("Keep this one sends { path, keep:\"mine\" } and the banner goes", settled() === JSON.stringify([{ path:minePath, keep:"mine" }]) && /follows the system setting/.test(await text("#lpThread")), settled());
  clash(); cloud.sent.length = 0;
  await again();
  await until(async () => await count("#lpCloud .cloud-banner") === 1, "the banner to come back");
  check("a new clash shows on the open line by itself", true);
  await page.click("#lpCloud button:has-text('Choose')");
  await page.click("#menu button:has-text('Keep the other')");
  await until(async () => await count("#lpCloud .cloud-banner") === 0 && /can be switched by hand/.test(await text("#lpThread")), "the other version on the page");
  check("Keep the other sends keep:\"theirs\" and the line shows Cloud's words", settled() === JSON.stringify([{ path:minePath, keep:"theirs" }]), settled());
  clash(); cloud.sent.length = 0;
  await again();
  await until(async () => await count("#lpCloud .cloud-banner") === 1, "the banner to come back");
  await page.click("#lpCloud button:has-text('Compare')");
  await page.click(".cloud-compare button:has-text('Keep both')");
  await until(async () => await count(".cloud-compare") === 0 && await count("#lpCloud .cloud-banner") === 0, "the dialog to close");
  check("Keep both, from the Compare dialog, sends keep:\"both\"", settled() === JSON.stringify([{ path:minePath, keep:"both" }]), settled());
  await until(async () => await lineCount() === 4, "the other version as a line of its own");
  check("and Cloud's version is now a line of its own", true);
  // A file that is not a line's own: on the project's home.
  fs.writeFileSync(path.join(docs("Weather app"), "MEMORY.cloud-20261110-194531.md"), "# Memory\n\n- From penecho.ai\n");
  cloud.conflicts[weather.id] = [{ path:"MEMORY.md", otherPath:"MEMORY.cloud-20261110-194531.md", at:Date.now() }];
  await open(weather.id);
  check("a file that is no line's own is one row on the project's home", (await text("#cloudConflicts")).replace(/\s+/g, " ").trim() === "MEMORY.md has two versions Compare Choose" && await count("#cloudConflicts .cloud-banner.is-row") === 1, await text("#cloudConflicts"));
  await shot("12-home-two-versions");
  await page.click("#cloudConflicts button:has-text('Choose')");
  await page.click("#menu button:has-text('Keep the other')");
  await until(async () => await count("#cloudConflicts .cloud-banner") === 0, "the row to go");
  check("its choice is sent the same way", settled() === JSON.stringify([{ path:"MEMORY.md", keep:"theirs" }]), settled());

  // ---------- An Ask that is held ----------
  console.log("\nAn Ask that is held");
  cloud.held[`${weather.id}/${wind}`] = { reason:"busy", where:"penecho.ai", since:new Date().toISOString() };
  cloud.held[`${weather.id}/${notes}`] = { reason:"credits", balance:0, required:1 };
  await open(`${weather.id}/line/${wind}`);
  check("a busy line says where it is working and that the Ask waits", (await text(".held-wait")).replace(/\s+/g, " ").trim() === "This line is working on penecho.ai. Your Ask is sent when it finishes. Take it back" && await count(".unsent-box") === 0, await text(".lp-ask"));
  await shot("13-ask-busy");
  await page.click(".held-wait button");
  await until(async () => await count(".held-wait") === 0, "the Ask to leave the line");
  await until(async () => /Show the wind speed on the map\./.test(await page.locator(".cmp-input").first().inputValue().catch(() => "")), "the words in the box");
  check("Take it back takes the Ask off the line, and its words are in the box", !fs.existsSync(topicFile(wind)) || !/Show the wind speed/.test(fs.readFileSync(topicFile(wind), "utf8")));
  await page.locator(".cmp-input").first().fill("");
  await open(`${weather.id}/line/${notes}`);
  check("out of credits says so, with Get credits", (await text(".held-credits")).replace(/\s+/g, " ").trim() === "You are out of credits. This Ask is kept, not sent. Get credits" && await count(".lp-ask.is-unsent .unsent-box") === 1, await text(".lp-ask"));
  await shot("14-ask-out-of-credits");
  await page.click(".held-credits button:has-text('Get credits')");
  check("Get credits opens the billing page", (await opened()).join() === `${ORIGIN}/dashboard.html#billing`);
  // Asking with no credits: the server's 402 is not shown as an error. The Ask is on its line, saying why it did not go.
  cloud.noCredits = true;
  await open(weather.id);
  await page.locator(".dock-wrap .cmp-input").fill("Write the release note for the forecast.");
  // Enter sends to AI on every page now (the button says so); Command or Ctrl with it would save a note.
  await page.keyboard.press("Enter");
  await until(async () => await count(".held-credits") === 1, "the new Ask on its line, held");
  check("a new Ask that gets Cloud's 402 opens on its line with the credits banner, and no error shows", sent("POST", /\/topics$/).length === 1 && /Write the release note for the forecast\./.test(await text(".lp-ask.is-unsent")) && !/insufficient|credits/i.test(await page.locator("#toast").innerText()) && new URL(page.url()).hash.includes("/line/"), `${page.url()} ${await page.locator("#toast").innerText()}`);
  await page.goBack();
  await until(async () => await count(".dock-wrap .cmp-input") === 1 && await count("#linePage") === 0, "the home again");
  check("and its words are not left in the box to be sent twice", await page.locator(".dock-wrap .cmp-input").inputValue() === "");

  // ---------- Run with ----------
  console.log("\nRun with");
  const agent = (id, name, mono, color) => ({ id, name, mono, color, role:"Build", available:true, runs:true, app:"", opens:false });
  cloud.agents = [agent("codex", "Codex", "Cx", "#2b303a"), agent("penecho", "PenEcho", "Pe", "#2563eb")];
  delete cloud.held[`${weather.id}/${notes}`];
  await open(`${weather.id}/line/${notes}`);
  await page.click(".run-pick");
  const rows = () => page.locator("#menu button").evaluateAll(list => list.map(b => b.querySelector("span:not(.av)").innerText.replace(/\s+/g, " ").trim()).join(" | "));
  check("PenEcho's own agent shows the balance under its name", await rows() === "Codex | PenEcho PenEcho Cloud · 3,120 credits", await rows());
  await shot("15-run-with", ".run-pick");
  cloud.sent.length = 0;
  await page.click("#menu button:has-text('PenEcho')");
  await until(async () => await count(".held-credits") === 1, "the credits banner after Run");
  check("Run with PenEcho and no credits: the Ask stays, says why, and no error shows", sent("POST", /\/run-unsent$/).map(r => r.body.agent).join() === "penecho" && await count(".lp-ask.is-unsent .run-main") === 1 && await page.locator("#toast").isHidden());
  cloud.noCredits = false;
  await page.click(".run-pick");
  await page.keyboard.press("Escape");
  cloud.account = SIGNED_OUT;
  await again();
  await page.click(".run-pick");
  check("signed out, it shows only its name", await rows() === "Codex | PenEcho", await rows());
  await page.keyboard.press("Escape");

  check("the pages threw nothing in the whole run", thrown.length === 0, thrown.join(" | "));
  await browser.close();
  console.log(`\nPictures: ${shots}`);
  console.log(`${passed} passed, ${failures.length} failed`);
  for (const name of failures) console.log(`  - ${name}`);
  process.exitCode = failures.length ? 1 : 0;
})().catch(error => { console.error(error.stack || error); console.log(serverLog.slice(-1500)); process.exitCode = 1; }).finally(async () => { await testBrowser?.close().catch(() => {}); server.kill(); try { fs.rmSync(temp, { recursive:true, force:true }); } catch { /* Left for the system to clear. */ } });
