"use strict";
require("./helpers/safety.js");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const PrototypeRules = require("../src/server/prototype-rules.js");
const C = require("../src/server/project-lines/canvas-file.js");
const { pagePictureChecked, canRenderPages } = require("../src/server/project-lines/page-picture.js");
const requireBrowserTests = process.env.PENECHO_REQUIRE_BROWSER_TESTS === "1";
const F = require("../src/server/project-lines/format.js");
const { GUIDANCE_IDS, CANVAS_RENDERING_ROUTING, ROUTING, DESIGN_PROTOTYPE_ROUTING, getAuthoringGuidance } = require("../src/server/mcp/authoring-guidance.js");
const { VISUAL_INSTRUCTIONS, WORKSPACE_INSTRUCTIONS, PUBLIC_INSTRUCTIONS } = require("../src/server/mcp/guidance.js");
const { INSTRUCTIONS } = require("../src/server/mcp/stdio.js");
const commandPrompt = require("../src/server/canvas-command-prompt.js");

const DARK_PROTOTYPE = `<!doctype html>
<html lang="en" data-penecho-prototype>
<head>
<meta charset="utf-8">
<title>Dark Prototype Fixture</title>
<style>
html, body { margin: 0; padding: 0; background: #112233; color: #f8fafc; color-scheme: dark; font-size: 16px; }
.tile { width: 10rem; height: 80px; background: #ff5500; }
</style>
</head>
<body><div class="tile" id="tile">Tile</div></body>
</html>`;

const UNMARKED_TWIN = DARK_PROTOTYPE.replace(" data-penecho-prototype", "");

const INHERITED_FONT_PROTOTYPE = `<!doctype html>
<html lang="en" data-penecho-prototype>
<head>
<meta charset="utf-8">
<title>Inherited Font Fixture</title>
<style>
body { margin: 0; background: #112233; }
.tile { width: 10rem; height: 80px; background: #22c55e; }
</style>
</head>
<body><div class="tile" id="tile">Inherited</div></body>
</html>`;

const INHERITED_UNMARKED = INHERITED_FONT_PROTOTYPE.replace(" data-penecho-prototype", "");

test("isPrototypeHtml detects only the opening <html> root attribute, is quote-aware, and stays linear-time on adversarial comments", () => {
  assert.equal(PrototypeRules.isPrototypeHtml(DARK_PROTOTYPE), true);
  assert.equal(PrototypeRules.isPrototypeHtml('\uFEFF<!-- note --><!DOCTYPE html>\n<HTML lang="zh-CN" data-penecho-prototype=""><body></body></html>'), true);
  assert.equal(PrototypeRules.isPrototypeHtml('<html data-penecho-prototype="1"><body></body></html>'), true);
  assert.equal(PrototypeRules.isPrototypeHtml('<html title=">" data-penecho-prototype><body></body></html>'), true, "quote-aware scanner handles > inside quoted attributes");
  assert.equal(PrototypeRules.isPrototypeHtml('<html title=" data-penecho-prototype "><body></body></html>'), false, "attribute-like text inside another quoted value must not match");
  assert.equal(PrototypeRules.isPrototypeHtml('<html-x data-penecho-prototype><body></body></html-x>'), false, "custom <html-x> tag must not match <html>");
  assert.equal(PrototypeRules.isPrototypeHtml(UNMARKED_TWIN), false);
  assert.equal(PrototypeRules.isPrototypeHtml('<html data-penecho-prototype="false"><body></body></html>'), false);
  assert.equal(PrototypeRules.isPrototypeHtml('<html data-penecho-prototype="0"><body></body></html>'), false);
  assert.equal(
    PrototypeRules.isPrototypeHtml('<!doctype html><html><body><pre>&lt;html data-penecho-prototype&gt;</pre><script>const s = "<html data-penecho-prototype>";</script></body></html>'),
    false,
    "mentions in body text or scripts must not flip ordinary Explorers"
  );
  assert.equal(PrototypeRules.isPrototypeHtml("<div>fragment</div>"), false);

  // ReDoS regression guard: 20,000 leading HTML comments with no <html> tag must finish linearly in milliseconds.
  const manyComments = "<!-- a -->".repeat(20000) + "<div>fragment</div>";
  const t0 = Date.now();
  assert.equal(PrototypeRules.isPrototypeHtml(manyComments), false);
  assert.ok(Date.now() - t0 < 200, "isPrototypeHtml must not backtrack exponentially on leading comments");
});

test("inCanvas skips the 36-52px Explorer font clamp for marked prototypes and keeps it for unmarked Explorers", () => {
  assert.equal(C.inCanvas(DARK_PROTOTYPE), DARK_PROTOTYPE);
  assert.doesNotMatch(C.inCanvas(DARK_PROTOTYPE), /clamp\(36px,1\.2cqw,52px\)/);

  const unmarkedOut = C.inCanvas(UNMARKED_TWIN);
  assert.match(unmarkedOut, /<style>html,body\{font-size:clamp\(36px,1\.2cqw,52px\)\}<\/style><\/head>/);

  // Reimport preserves <html data-penecho-prototype> in the saved widget HTML even though sourceFormat is cleared.
  assert.match(DARK_PROTOTYPE, /^<!doctype html>\n<html lang="en" data-penecho-prototype>/);
});

test("hosted inline preview passes marked prototypes through verbatim, is quote-aware, and stays linear-time", () => {
  const hostedSource = fs.readFileSync(path.join(ROOT, "public/lines/hosted.js"), "utf8");
  const start = hostedSource.indexOf("function hostedIsPrototypeHtml(");
  const end = hostedSource.indexOf("const hostedPageText =", start);
  assert.ok(start > 0 && end > start, "hostedPageHtml helper must exist in public/lines/hosted.js");
  const ctx = {};
  vm.runInNewContext(`${hostedSource.slice(start, end)}\nthis.hostedPageHtml = hostedPageHtml;`, ctx);

  assert.equal(ctx.hostedPageHtml(DARK_PROTOTYPE), DARK_PROTOTYPE);
  assert.equal(ctx.hostedPageHtml(INHERITED_FONT_PROTOTYPE), INHERITED_FONT_PROTOTYPE);
  assert.equal(ctx.hostedPageHtml('<html title=">" data-penecho-prototype><body></body></html>'), '<html title=">" data-penecho-prototype><body></body></html>');
  assert.match(ctx.hostedPageHtml('<html title=" data-penecho-prototype "><body></body></html>'), /^<style>html,body\{font-size:clamp\(36px,1\.2cqw,52px\)\}<\/style>/);
  assert.match(ctx.hostedPageHtml('<html-x data-penecho-prototype><body></body></html-x>'), /^<style>html,body\{font-size:clamp\(36px,1\.2cqw,52px\)\}<\/style>/);
  assert.equal(
    ctx.hostedPageHtml(UNMARKED_TWIN),
    `<style>html,body{font-size:clamp(36px,1.2cqw,52px)}</style>${UNMARKED_TWIN}`
  );
  assert.equal(
    ctx.hostedPageHtml(INHERITED_UNMARKED),
    `<style>html,body{font-size:clamp(36px,1.2cqw,52px)}</style>${INHERITED_UNMARKED}`
  );
  const t0 = Date.now();
  assert.match(ctx.hostedPageHtml("<!-- a -->".repeat(20000) + "<div>x</div>"), /^<style>html,body\{font-size:clamp\(36px,1\.2cqw,52px\)\}<\/style>/);
  assert.ok(Date.now() - t0 < 200, "hostedPageHtml must not backtrack exponentially on leading comments");
});

test("widget-host preserves authored background, color-scheme and font-size for marked prototypes while keeping MCP separate", () => {
  const hostSource = fs.readFileSync(path.join(ROOT, "public/widget-host.js"), "utf8");
  assert.match(hostSource, /const prototypeAttr = parsed\.documentElement\.getAttribute\("data-penecho-prototype"\)/);
  assert.match(hostSource, /if \(mcpPreview \|\| prototypePage\) bridgeStyle\.textContent = "html,body\{overscroll-behavior:contain\}" \+ bridgeShared;/);
  // MCP still exclusively controls form retention and data-penecho-action clicks.
  assert.match(hostSource, /parsed\.querySelectorAll\(mcpPreview \? "base, iframe, object, embed, meta\[http-equiv\]" : "base, iframe, object, embed, form, meta\[http-equiv\]"\)/);
  assert.match(hostSource, /if\(mcpPreview\)\s*\{\s*const actions=parsed\.createElement\("script"\)/);
});

test("draw receipt preview hashes inCanvas(widget.html) so marked and unmarked renders never share stale cache keys", () => {
  const drawSource = fs.readFileSync(path.join(ROOT, "src/server/draw.js"), "utf8");
  assert.match(drawSource, /const renderedHtml = inCanvas\(widget\.html\);[\s\S]*?JSON\.stringify\(\[widget\.contentW, widget\.contentH, renderedHtml\]\)/);
  assert.match(drawSource, /if \(!drawn \|\| !drawn\.png\) bytes = await pagePicture\(renderedHtml, \{ width:widget\.contentW, height:widget\.contentH \}\);/);
});

test("single-source design-prototype contract installs identically to .penecho and skill folders and matches MCP guidance", () => {
  assert.ok(GUIDANCE_IDS.includes("design-prototype"));
  const full = getAuthoringGuidance("design-prototype", "full");
  const brief = getAuthoringGuidance("design-prototype");
  assert.equal(brief.document, full.document, "default read returns the full design-prototype contract");
  assert.equal(brief.hash, full.hash);
  assert.equal(full.hash, crypto.createHash("sha256").update(full.document).digest("hex"));
  assert.equal(full.document, PrototypeRules.contractText());

  // Key Claude-Design-derived craft and PenEcho runtime rules must be present.
  for (const snippet of [
    "<!doctype html>",
    "data-penecho-prototype",
    "Tweaks",
    "bottom-left",
    "bottom-right",
    "Plan before writing HTML",
    "Existing product",
    "zero network requests",
    "penecho-widget-updated",
    "Visual self-check",
  ]) {
    assert.match(full.document, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), snippet);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-proto-rules-"));
  try {
    assert.equal(PrototypeRules.installPrototypeRules(tmp), true);
    assert.equal(fs.readFileSync(path.join(tmp, "design-prototype.md"), "utf8"), full.document);
    assert.equal(PrototypeRules.installPrototypeRules(tmp), false, "second install is a no-op when up to date");
  } finally {
    fs.rmSync(tmp, { recursive:true, force:true });
  }
});

test("prompt isolation: non-prototype Lines and Canvas commands receive zero design-prototype contract body", () => {
  const contractHeading = "# PenEcho Design Prototypes";
  const toolsHeading = "## Working with project files and previews";

  // Route A: Lines Make choices
  const protoSay = F.makeSay({ kind:"explorer", sub:"prototype" }, "/d/files/x", "/d/.penecho/ppt-slides.md", "CONTRACT", "/d/.penecho/design-prototype.md");
  assert.match(protoSay, /Read \/d\/\.penecho\/design-prototype\.md first/);
  assert.match(protoSay, /<html data-penecho-prototype>/);
  assert.doesNotMatch(protoSay, new RegExp(contractHeading));

  for (const make of [
    { kind:"explorer", sub:"explain" },
    { kind:"explorer", sub:"try" },
    { kind:"diagram", sub:"architecture" },
    { kind:"slides", sub:"investor" },
    { kind:"card", sub:"knowledge" },
  ]) {
    const out = F.makeSay(make, "/d/files/x", "/d/.penecho/ppt-slides.md", "CONTRACT", "/d/.penecho/design-prototype.md");
    assert.doesNotMatch(out, /design-prototype\.md|data-penecho-prototype|# PenEcho Design Prototypes/, JSON.stringify(make));
  }

  // Generic pictureHelp / drawingSkill only contain a conditional pointer, never the guide body.
  const help = F.pictureHelp("/d/files/x", "/d/.penecho/ppt-slides.md", "/d/.penecho/design-prototype.md");
  assert.match(help, /Only when asked to design or revise a clickable UI prototype or mockup, read \/d\/\.penecho\/design-prototype\.md first/);
  assert.doesNotMatch(help, new RegExp(`${contractHeading}|${toolsHeading}`));

  const skill = F.drawingSkill({ name:"Demo", drop:"/tmp/demo/.penecho/drawings" });
  assert.match(skill, /design-prototype\.md in this skill's folder/);
  assert.doesNotMatch(skill, new RegExp(`${contractHeading}|${toolsHeading}`));

  // Route C: One-shot Canvas Pen -> Build prototype loads lazily ONLY for suggestion === "prototype".
  const basePayload = {
    trigger:"manual",
    userAction:"plot",
    uiTheme:"studio",
    changedBox:{ x:80, y:120, w:600, h:400 },
    sourceRect:{ x:0, y:0, w:2000, h:1500 },
    visibleRect:{ x:0, y:0, w:4000, h:3000 },
    captureRect:{ x:0, y:0, w:2000, h:1500 },
    atlasSize:{ w:2000, h:1500 },
    imageScale:1,
    plugins:[{ id:"general", name:"General", document:"test" }],
  };
  const protoInput = commandPrompt.canvasCommandModelInput({ ...basePayload, suggestion:"prototype" });
  const shared = PrototypeRules.canvasCommandPrompt();
  assert.equal(protoInput.widgetRenderingPolicy, shared);
  assert.equal(JSON.stringify(protoInput).split(contractHeading).length - 1, 1, "send the design rules exactly once");
  assert.match(protoInput.actionMeaning, /wireframe/);

  const edit = { widgetType:"html_widget", pluginId:"general", title:"Proto", html:DARK_PROTOTYPE, sourceMirrorsHtml:true };
  for (const plugins of [basePayload.plugins, []]) {
    const marked = commandPrompt.canvasCommandModelInput({ ...basePayload, plugins, userAction:"answer", widgetEdit:edit });
    assert.equal(marked.widgetRenderingPolicy, shared);
    assert.match(marked.actionMeaning, /widget_patch/);
    assert.doesNotMatch(marked.actionMeaning, /wireframe/);
  }
  const editUnmarked = commandPrompt.canvasCommandModelInput({ ...basePayload, userAction:"answer", widgetEdit:{ ...edit, html:UNMARKED_TWIN } });
  assert.match(editUnmarked.widgetRenderingPolicy, /clamp\(36px,1\.2cqw,52px\)/);

  for (const [userAction, suggestion] of [
    ["auto", undefined],
    ["plot", "plot"],
    ["plot", "diagram"],
    ["plot", "create_visual"],
    ["explain", "explain"],
    ["answer", "answer"],
  ]) {
    const other = commandPrompt.canvasCommandModelInput({ ...basePayload, userAction, ...(suggestion ? { suggestion } : {}) });
    assert.doesNotMatch(other.actionMeaning, new RegExp(`${contractHeading}|${toolsHeading}`), `${userAction}/${suggestion}`);
    assert.match(other.widgetRenderingPolicy, /clamp\(36px,1\.2cqw,52px\)/, `${userAction}/${suggestion} keeps ordinary canvas widget policy`);
    assert.doesNotMatch(other.widgetRenderingPolicy, /data-penecho-prototype/, `${userAction}/${suggestion}`);
  }
  for (const flags of [[false, false, false], [true, true, true]]) {
    assert.doesNotMatch(commandPrompt.activeSystemPrompt(...flags), new RegExp(`${contractHeading}|${toolsHeading}`));
  }

  // Route D: MCP & Canvas Agent startup/routing stays compact and lazy.
  assert.ok(INSTRUCTIONS.length < 5000, `MCP INSTRUCTIONS length ${INSTRUCTIONS.length} must stay < 5000`);
  for (const text of [PUBLIC_INSTRUCTIONS, INSTRUCTIONS, WORKSPACE_INSTRUCTIONS, VISUAL_INSTRUCTIONS, CANVAS_RENDERING_ROUTING, ROUTING]) {
    assert.doesNotMatch(text, new RegExp(`${contractHeading}|${toolsHeading}`));
  }
  for (const routing of [CANVAS_RENDERING_ROUTING, ROUTING]) {
    assert.ok(routing.includes(DESIGN_PROTOTYPE_ROUTING));
    assert.match(routing, /penecho_get_guidance\(\{id:"design-prototype"\}\)/);
  }
  assert.match(VISUAL_INSTRUCTIONS, /design-prototype for UI prototypes\/mockups/);
});

test("real PNG rendering at 1200x750 renders marked 10rem tile at 160px with dark background vs 360px unmarked, surviving reimport", async t => {
  if (!requireBrowserTests && !canRenderPages()) { t.skip("PenEcho's page renderer is unavailable here"); return; }
  const sharp = require("sharp");
  const pixelAt = async (png, x, y) => {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
    const offset = (y * info.width + x) * 4;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };

  const marked = await C.makePicture({ source:"files/proto/dark.explorer.html", text:DARK_PROTOTYPE, existing:null, name:"dark" });
  assert.equal(marked.rendered, true, "marked fixture must render real pixels, not a title-card fallback");
  assert.deepEqual(await pixelAt(marked.png, 150, 40), [0xff, 0x55, 0x00], "inside 160px tile");
  assert.deepEqual(await pixelAt(marked.png, 170, 40), [0x11, 0x22, 0x33], "outside 160px tile on authored dark background");

  // Reimport the same file over an existing bundle (which clears stored sourceFormat) and confirm the HTML marker still holds.
  const reimported = await C.makePicture({ source:"files/proto/dark.explorer.html", text:DARK_PROTOTYPE, existing:JSON.stringify(marked.bundle), name:"dark" });
  assert.equal(reimported.rendered, true);
  assert.deepEqual(await pixelAt(reimported.png, 150, 40), [0xff, 0x55, 0x00]);
  assert.deepEqual(await pixelAt(reimported.png, 170, 40), [0x11, 0x22, 0x33]);
  const savedWidget = JSON.parse(Buffer.from(reimported.bundle.assets.find(a => a.kind === "widget").dataBase64, "base64").toString("utf8"));
  assert.equal(C.isPrototypeHtml(savedWidget.html), true);

  const unmarked = await C.makePicture({ source:"files/proto/unmarked.explorer.html", text:UNMARKED_TWIN, existing:null, name:"unmarked" });
  assert.equal(unmarked.rendered, true, "unmarked twin must render real pixels");
  assert.deepEqual(await pixelAt(unmarked.png, 350, 40), [0xff, 0x55, 0x00], "unmarked 10rem tile stays 360px under 36px Explorer clamp");
  assert.deepEqual(await pixelAt(unmarked.png, 370, 40), [0x11, 0x22, 0x33], "outside 360px tile");
});

test("same-Line prompt isolation: prototype Ask gets design-prototype.md pointer while unrelated follow-up Ask on the same Line gets none", async () => {
  const { createAgents } = require("../src/server/project-lines/agents.js");
  const { createProjectLines } = require("../src/server/project-lines/http.js");
  const http = require("node:http");

  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-proto-iso-")));
  const prompts = [];
  const agentScript = path.join(temp, "agent.js");
  fs.writeFileSync(agentScript, `
const fs = require("fs");
const say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  const n = fs.readdirSync(${JSON.stringify(temp)}).filter(f => f.startsWith("prompt-")).length + 1;
  fs.writeFileSync(${JSON.stringify(temp)} + "/prompt-" + n + ".txt", prompt);
  say({ type:"system", subtype:"init", session_id:"s-" + n });
  say({ type:"result", subtype:"success", is_error:false, result:"Done " + n, session_id:"s-" + n });
});
`);

  const directory = path.join(temp, "state"), docsBase = path.join(temp, "base"), home = path.join(temp, "home");
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(home, { recursive:true });
  const agents = createAgents({
    env:{ PATH:"" },
    extra:{ fake:{ name:"Fake", mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }) } },
  });
  const lines = createProjectLines({
    directory, agents, agentPaths:{ home },
    serviceOptions:{ autoWatch:false, docsBase },
    authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); },
  });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const call = async (method, route, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/lines${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) });
    return { status:res.status, ...await res.json() };
  };
  const until = async (check, label) => {
    const start = Date.now();
    for (;;) {
      const v = await check();
      if (v) return v;
      if (Date.now() - start > 15000) throw new Error(`Timed out waiting for ${label}`);
      await new Promise(r => setTimeout(r, 25));
    }
  };

  try {
    const p = lines.service.store.create({ name:"ProtoIso", docsPath:path.join(docsBase, "ProtoIso") });
    p.defaultAgent = "fake";
    assert.ok(fs.existsSync(path.join(p.docsPath, ".penecho", "design-prototype.md")), "project creation installs .penecho/design-prototype.md");

    // Work 1: Prototype Make choice
    const first = await call("POST", `/projects/${p.id}/unsent`, { text:"Mock up a billing settings screen", topic:"new", make:{ kind:"explorer", sub:"prototype" } });
    assert.equal(first.status, 200, first.error);
    const ran1 = await call("POST", `/projects/${p.id}/topics/${first.slug}/run-unsent`, { step:first.step });
    assert.equal(ran1.status, 200, ran1.error);
    await until(() => !lines.service.runs.size && fs.existsSync(path.join(temp, "prompt-1.txt")), "first run");
    const p1 = fs.readFileSync(path.join(temp, "prompt-1.txt"), "utf8");
    assert.match(p1, /They chose a clickable prototype\. Read .*design-prototype\.md first, then write it as one name\.explorer\.html/);
    assert.doesNotMatch(p1, /# PenEcho Design Prototypes/, "Lines prototype Ask lazy-loads by pointer rather than inlining the contract body");

    // Work 2: Unrelated follow-up Ask on the exact same Line (no Make choice)
    const follow = await call("POST", `/projects/${p.id}/unsent`, { topic:first.slug, text:"Explain why the database query took 400ms" });
    assert.equal(follow.status, 200, follow.error);
    const ran2 = await call("POST", `/projects/${p.id}/topics/${first.slug}/run-unsent`, { step:follow.step });
    assert.equal(ran2.status, 200, ran2.error);
    await until(() => !lines.service.runs.size && fs.existsSync(path.join(temp, "prompt-2.txt")), "follow-up run");
    const p2 = fs.readFileSync(path.join(temp, "prompt-2.txt"), "utf8");
    assert.doesNotMatch(p2, /They chose a clickable prototype/, "unrelated follow-up on same Line must not inherit prior prototype Make instruction");
    assert.doesNotMatch(p2, /# PenEcho Design Prototypes|## Working with project files and previews/, "unrelated follow-up gets zero prototype-guide body");
    prompts.push(p1, p2);
  } finally {
    server.close();
    lines.close();
    fs.rmSync(temp, { recursive:true, force:true });
  }
});


// ---------- Layout check (v2): the defects a small preview picture hides ----------
const Check = require("../src/server/project-lines/prototype-check.js");

const BUGGY_PROTOTYPE = `<!doctype html>
<html lang="en" data-penecho-prototype>
<head><meta charset="utf-8"><title>Buggy</title>
<style>
html, body { margin: 0; background: #fff; font: 14px -apple-system, sans-serif; }
.bar { display: flex; height: 17px; background: #ddd; }
.ic { display: grid; place-items: center; width: 30px; height: 30px; background: #eee; }
.card span { display: block; }
.rail-btn { position: absolute; left: 6px; bottom: 12px; width: 32px; height: 32px; }
.tweaks { position: fixed; left: 16px; bottom: 16px; height: 28px; padding: 0 12px; }
.ok { display: inline-grid; place-items: center; width: 30px; height: 30px; }
</style></head>
<body>
<div class="bar" id="parentBar" hidden></div>
<div class="card"><span class="ic"><svg width="14" height="14" viewBox="0 0 14 14"><rect width="14" height="14"/></svg></span>Example</div>
<span class="ok"><svg width="14" height="14" viewBox="0 0 14 14"><rect width="14" height="14"/></svg></span>
<button class="rail-btn" type="button" aria-label="Toggle sidebar">=</button>
<button class="tweaks" type="button" data-proto-chrome>Tweaks</button>
</body></html>`;

const CLEAN_PROTOTYPE = BUGGY_PROTOTYPE
  .replace(".card span { display: block; }", "[hidden] { display: none !important; }")
  .replace("left: 16px; bottom: 16px;", "left: 60px; bottom: 16px;");

test("one-shot creation and revisions share only the source-grounded core of the full authoring guide", () => {
  const core = PrototypeRules.canvasCommandPrompt();
  assert.ok(PrototypeRules.contractText().startsWith(core));
  for (const rule of ["edit the supplied source in place", "chronological order", "[hidden] { display: none !important; }", "footer buttons", "data-penecho-prototype", "keyboard-accessible"]) {
    assert.ok(core.includes(rule), rule);
  }
  assert.doesNotMatch(core, /Working with project files|matching freshly rendered PNG|MCP|penecho_present_widget/);
  assert.ok(Buffer.byteLength(core) < 2500, "keep one-shot guidance compact");
  assert.match(PrototypeRules.contractText(), /Compare with the original/);
  assert.match(PrototypeRules.contractText(), /PenEcho's layout check/);
});

test("layout check: the probe script goes before </body>, its console line is read back, and findings are capped and trimmed", () => {
  const html = Check.withProbe("<html><body><p>x</p></body></html>");
  assert.match(html, /<p>x<\/p><script>\(\(\)=>\{let told=false;const W=0,H=0;/);
  assert.match(Check.withProbe("<body></body>", { width:1200, height:750 }), /const W=1200,H=750;/);
  assert.ok(html.endsWith("</script></body></html>"));
  assert.ok(Check.withProbe("<p>no body</p>").startsWith("<p>no body</p><script>"));
  assert.doesNotMatch(Check.PROBE, /<\/script/i, "the probe can be inlined in a page");

  const found = [{ kind:"hidden-shown", where:"div#parentBar", detail:"x".repeat(500) }, ...Array.from({ length:12 }, (_, i) => ({ kind:"icon-off-center", where:`span.i${i}`, detail:"off" }))];
  const line = `[1:2:INFO:CONSOLE:1] "${Check.MARK}${Buffer.from(JSON.stringify(found)).toString("base64")}", source: file:///page.html (1)`;
  const read = Check.readProbe(`noise\n${line}\nmore noise`);
  assert.equal(read.length, Check.MAX_CHECKS);
  assert.equal(read[0].detail.length, 240);
  assert.equal(Check.readProbe("no mark here"), null);
  assert.equal(Check.readProbe(`${Check.MARK}!!!`), null);
  assert.equal(Check.describeChecks("a.explorer.html", []), "");
  assert.match(Check.describeChecks("a.explorer.html", [{ kind:"k", where:"div.x", detail:"is off" }]), /^a\.explorer\.html: div\.x — is off$/);
});

test("layout check finds a shown hidden bar, an off-center icon and a Tweaks pill on a rail button, and nothing in the fixed page", { skip:!requireBrowserTests && !canRenderPages() && "PenEcho's page renderer is unavailable here" }, async () => {
  const buggy = await pagePictureChecked(C.inCanvas(BUGGY_PROTOTYPE), { width:600, height:400 });
  assert.ok(buggy.png, "still draws the picture");
  const kinds = buggy.checks.map(c => c.kind).sort();
  assert.deepEqual(kinds, ["floating-overlap", "hidden-shown", "icon-off-center"], JSON.stringify(buggy.checks));
  assert.match(buggy.checks.find(c => c.kind === "hidden-shown").where, /div#parentBar/);
  assert.match(buggy.checks.find(c => c.kind === "icon-off-center").where, /span\.ic/);
  assert.match(buggy.checks.find(c => c.kind === "floating-overlap").where, /Toggle sidebar/);

  const clean = await pagePictureChecked(C.inCanvas(CLEAN_PROTOTYPE), { width:600, height:400 });
  assert.deepEqual(clean.checks, []);

  // makePicture measures marked prototypes only.
  const made = await C.makePicture({ source:"files/proto/buggy.explorer.html", text:BUGGY_PROTOTYPE, existing:null, name:"buggy" });
  assert.equal(made.checks.length, 3);
  const plain = await C.makePicture({ source:"files/proto/plain.explorer.html", text:BUGGY_PROTOTYPE.replace(" data-penecho-prototype", ""), existing:null, name:"plain" });
  assert.equal(plain.checks, null);
});

test("an agent that leaves layout defects in its prototype hears them once, then the Work closes", { skip:!requireBrowserTests && !canRenderPages() && "PenEcho's page renderer is unavailable here" }, async () => {
  const { createAgents } = require("../src/server/project-lines/agents.js");
  const { createProjectLines } = require("../src/server/project-lines/http.js");
  const http = require("node:http");

  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "penecho-proto-check-")));
  const directory = path.join(temp, "state"), docsBase = path.join(temp, "base"), home = path.join(temp, "home"), docs = path.join(docsBase, "ProtoCheck");
  fs.mkdirSync(directory, { recursive:true }); fs.mkdirSync(home, { recursive:true });
  const agentScript = path.join(temp, "agent.js");
  fs.writeFileSync(agentScript, `
const fs = require("fs");
const say = o => console.log(JSON.stringify(o));
let prompt = "";
process.stdin.on("data", d => prompt += d).on("end", () => {
  const n = fs.readdirSync(${JSON.stringify(temp)}).filter(f => f.startsWith("prompt-")).length + 1;
  fs.writeFileSync(${JSON.stringify(temp)} + "/prompt-" + n + ".txt", prompt);
  const m = prompt.match(new RegExp(${JSON.stringify(docs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))} + "/files/([a-z0-9-]+)"));
  if (m) { const dir = ${JSON.stringify(docs)} + "/files/" + m[1]; fs.mkdirSync(dir, { recursive:true }); fs.writeFileSync(dir + "/screen.explorer.html", n === 1 ? ${JSON.stringify(BUGGY_PROTOTYPE)} : ${JSON.stringify(CLEAN_PROTOTYPE)}); }
  say({ type:"system", subtype:"init", session_id:"s-" + n });
  say({ type:"result", subtype:"success", is_error:false, result:"Done " + n, session_id:"s-" + n });
});
`);
  const agents = createAgents({
    env:{ PATH:"" },
    extra:{ fake:{ name:"Fake", mono:"Fk", color:"#000", role:"Build", resolve:() => ({ command:process.execPath, prefixArgs:[agentScript] }), command:(launch, { workdir }) => ({ command:launch.command, args:launch.prefixArgs, cwd:workdir, stdin:true }) } },
  });
  const lines = createProjectLines({
    directory, agents, agentPaths:{ home },
    serviceOptions:{ autoWatch:false, docsBase },
    authorizeRead:() => null, authorizeWrite:() => null, isThisComputer:() => true,
    readJson:req => new Promise((resolve, reject) => { let s = ""; req.on("data", d => { s += d; }).on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (error) { reject(error); } }); }),
    send:(res, code, data) => { res.writeHead(code, { "content-type":"application/json" }); res.end(JSON.stringify(data)); },
  });
  const server = http.createServer(async (req, res) => { if (!await lines.handle(req, res, new URL(req.url, "http://x"))) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const call = async (method, route, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/lines${route}`, { method, ...(body ? { headers:{ "content-type":"application/json" }, body:JSON.stringify(body) } : {}) });
    return { status:res.status, ...await res.json() };
  };
  const until = async (check, label) => {
    const start = Date.now();
    for (;;) {
      const v = await check();
      if (v) return v;
      if (Date.now() - start > 30000) throw new Error(`Timed out waiting for ${label}`);
      await new Promise(r => setTimeout(r, 50));
    }
  };
  try {
    const p = lines.service.store.create({ name:"ProtoCheck", docsPath:docs });
    p.defaultAgent = "fake";
    const first = await call("POST", `/projects/${p.id}/unsent`, { text:"Mock up a billing settings screen", topic:"new", make:{ kind:"explorer", sub:"prototype" } });
    assert.equal(first.status, 200, first.error);
    const ran = await call("POST", `/projects/${p.id}/topics/${first.slug}/run-unsent`, { step:first.step });
    assert.equal(ran.status, 200, ran.error);
    await until(() => fs.existsSync(path.join(temp, "prompt-2.txt")) && !lines.service.runs.size, "the layout follow-up run");
    const followUp = fs.readFileSync(path.join(temp, "prompt-2.txt"), "utf8");
    assert.match(followUp, /PenEcho's layout check of your prototype found: screen\.explorer\.html: /);
    assert.match(followUp, /div#parentBar/);
    assert.match(followUp, /span\.ic/);
    await new Promise(r => setTimeout(r, 500));
    assert.equal(fs.existsSync(path.join(temp, "prompt-3.txt")), false, "one follow-up only");
    assert.ok(fs.existsSync(path.join(docs, "files", first.slug, "screen.png")));
  } finally {
    server.close();
    lines.close();
    fs.rmSync(temp, { recursive:true, force:true });
  }
});
