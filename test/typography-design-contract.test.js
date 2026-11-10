"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("PenEcho typography is embedded incrementally with no design stylesheet import", () => {
  const files = [
    "public/style.css",
    "public/canvas-agent-activity.css",
    "public/cloud-connect.css",
    "public/access.css",
    "public/remote-canvas.css",
    "public/viewer.css",
  ];
  const css = files.map(read).join("\n");
  const html = read("public/index.html");

  assert.doesNotMatch(html, /penecho-design-language\.css/);
  assert.doesNotMatch(css, /@import\b/);
  assert.match(css, /--pe-font-ui:\s*-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif/);
  assert.match(css, /--pe-font-mono:\s*ui-monospace, SFMono-Regular, Menlo, Consolas, monospace/);
  assert.match(css, /--pe-font-hand:\s*"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive/);
});

test("the closed system type ramp matches the PenEcho design catalog", () => {
  const css = read("public/style.css");
  const expected = {
    page:"20px",
    dialog:"17px",
    section:"13.5px",
    label:"13px",
    body:"13px",
    description:"13px",
    meta:"11.5px",
    overline:"10.5px",
    regular:"400",
    medium:"500",
    semibold:"600",
  };

  for (const [token, value] of Object.entries(expected)) {
    assert.match(css, new RegExp(`--pe-type-${token}:\\s*${value.replace(".", "\\.")}`), token);
  }
  assert.match(css, /\.settings-section-heading h3[\s\S]*font-size:\s*var\(--pe-type-page\)[\s\S]*font-weight:\s*var\(--pe-type-semibold\)[\s\S]*line-height:\s*1\.25/);
  assert.match(css, /\.plugin-modal-header h2[\s\S]*font-size:\s*var\(--pe-type-dialog\)[\s\S]*line-height:\s*1\.3/);
  assert.match(css, /Descriptions follow the system role: 13 \/ 400 \/ 1\.45/);
});

test("the canonical type contract wins after the button and legacy surface rules", () => {
  const css = read("public/style.css");
  assert.ok(css.indexOf("PenEcho typography contract") > css.indexOf("PenEcho button + semantic tint contract"));
  assert.match(css, /:is\(#pe-type-contract, body\[data-theme="studio"\]\)/);
  assert.match(css, /:is\(#pe-button-contract, \[data-pe-button\]\) > :where\(span, strong, small, b, em\)[^}]*font:\s*inherit/);
  assert.match(css, /\.canvas-agent-message-body[\s\S]*font:\s*var\(--pe-type-regular\) 14px\/1\.58 var\(--pe-font-ui\)/);
  assert.match(read("public/canvas-agent-activity.css"), /PenEcho typography contract[\s\S]*13\.5px\/1\.3/);
  assert.match(read("public/cloud-connect.css"), /PenEcho typography contract[\s\S]*\.cloud-content-heading h3[\s\S]*font-size:\s*20px/);
});

test("Studio uses one UI family with only handwriting and technical exceptions", () => {
  const css = read("public/style.css"), cloud = read("public/cloud-connect.css");

  assert.match(css, /\.summon-caption\s*\{[^}]*font-family:\s*var\(--pe-font-ui/);
  assert.doesNotMatch(css, /font-family:\s*ui-rounded/);
  assert.match(css, /\.canvas-welcome-kicker\s*\{[^}]*font:\s*600 2rem\/1\.05 var\(--pe-font-hand/);
  assert.match(css, /html:lang\(zh\)[^}]*\.canvas-welcome-kicker\s*\{[^}]*font-family:\s*var\(--pe-font-ui[^}]*font-weight:\s*500[^}]*letter-spacing:\s*normal[^}]*transform:\s*none/);
  assert.match(css, /h1\s*\{[^}]*font:\s*600[^}]*var\(--pe-font-ui/);
  assert.match(css, /h1 strong\s*\{[^}]*font-weight:\s*600/);
  assert.match(css, /\.canvas-welcome strong\s*\{[^}]*font-weight:\s*600/);
  assert.match(css, /\.canvas-welcome > span:last-child\s*\{[^}]*font-weight:\s*400/);
  assert.match(css, /\.text-editor-title\s*\{[^}]*font:\s*500[^}]*var\(--pe-font-ui/);
  assert.match(css, /\.text-editor-button\s*\{[^}]*font:\s*500[^}]*var\(--pe-font-ui/);
  assert.match(css, /\.canvas-agent-file-type\s*\{[^}]*font:\s*600[^}]*var\(--pe-font-mono/);
  assert.match(css, /\.canvas-agent-reference-chip\s*\{[^}]*font-weight:\s*500/);
  assert.match(css, /\.canvas-agent-reference-chip em::before\s*\{[^}]*font:\s*700 15px\/16px var\(--pe-font-ui/);
  assert.match(cloud, /\.cloud-dialog-mark\s*\{[^}]*font-weight:\s*600/);
  assert.match(cloud, /\.cloud-avatar\s*\{[^}]*font-weight:\s*600/);
  assert.match(cloud, /\.cloud-published-mark\s*\{[^}]*font-weight:\s*600/);
});

test("Agent activity reserves heavier emphasis for parsed Markdown", () => {
  const css = read("public/style.css"), activity = read("public/canvas-agent-activity.css");

  assert.match(activity, /:is\(#pe-type-contract, \.canvas-agent-dialog-progress\) strong\s*\{[^}]*font:\s*400 11\.5px\/1\.3/);
  assert.match(activity, /:is\(#pe-type-contract, \.canvas-agent-dialog-progress\) small\s*\{[^}]*font:\s*400 10px\/1\.35/);
  assert.match(activity, /:is\(#pe-type-contract, \.canvas-agent-dialog-progress\) \.canvas-agent-dialog-progress-meta\s*\{[^}]*font:\s*400 9\.5px\/1\.25/);
  assert.match(css, /Activity and tool-call copy is ordinary transcript chrome[\s\S]*?font-weight:\s*var\(--pe-type-regular\)/);
  assert.match(css, /\.canvas-agent-message-body\.is-markdown strong\s*\{[^}]*font-weight:\s*500/);
  assert.match(css, /\.canvas-agent-message-body\.is-markdown \.canvas-agent-markdown-heading\s*\{[^}]*font-size:\s*\.875rem;[^}]*font-weight:\s*600/);
});

test("scaled dialogs use the logical viewport instead of clipping enlarged text", () => {
  const scale = read("public/page-scale.js"), css = read("public/style.css"), cloud = read("public/cloud-connect.css");
  assert.match(scale, /root\.dataset\.penechoPageScale/);
  assert.doesNotMatch(scale, /root\.style/);
  assert.match(css, /data-penecho-page-scale="90"[\s\S]*?--penecho-canvas-page-viewport-width/);
  assert.match(css, /\.settings-panel[^}]*--penecho-canvas-page-viewport-width/);
  assert.match(css, /html\.penecho-web-page-scale \.crafts-modal[\s\S]*--penecho-canvas-page-dynamic-height/);
  assert.match(cloud, /html\.penecho-web-page-scale \.penecho-cloud-dialog\.cloud-center[\s\S]*--penecho-canvas-page-dynamic-height/);
});
