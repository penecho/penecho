"use strict";
// What an agent reads only when its work needs it: making a picture, seeing the open Canvas, a headless browser check.
// It stays out of every run's instructions, so a Work that needs none of it pays nothing for it (PE-916).
// PenEcho puts it in the docs folder's .penecho folder, beside ppt-slides.md and design-prototype.md.
const fs = require("fs");
const path = require("path");
const F = require("./format.js");

const NAME = "agent-help.md";
function text() {
  return `# PenEcho help for agents

<!-- PenEcho puts this file here and replaces it when it updates. -->

Read only the part your work needs.

## Pictures, cards, slides and prototypes

${F.pictureHelp("the Line's files folder (files/<line>/ in the docs folder)", "ppt-slides.md next to this file", "design-prototype.md next to this file")}

Check the <name>.png PenEcho writes beside the file a few seconds after you write it.

## The Canvas the person has open

Run \`curl -s "$PENECHO_DRAW_URL?view=1" -H "x-penecho-token: $PENECHO_DRAW_PASS"\` (on Windows PowerShell: \`curl.exe -s "$env:PENECHO_DRAW_URL?view=1" -H "x-penecho-token: $env:PENECHO_DRAW_PASS"\`): its png is a picture of what is on their screen, with Canvas coordinates on a grid. Read that picture; no browser or image code is needed. Without those variables, take url and token from ~/.penecho/draw.json.

## Browser checks

When the person says they opened Chrome, Edge or another browser for you, or asks for computer use, Playwright or CDP, use your own tools as asked. Never refuse it or use PenEcho's headless browser instead. If your own environment can run Playwright or control Chrome/Edge and that fits the task, PenEcho does not block it.

When the person did not ask to use their own open browser (do not disturb their Chrome/Edge window unasked) and you need a headless check (a screenshot, console or page errors, DOM text, layout, or using a local HTML file, static folder, localhost app or URL), especially in a sandbox where Chrome crashes or listen is blocked, use PenEcho's hosted browser: \`node "$PENECHO_BROWSER_HELPER" '{...}'\` (on Windows PowerShell: \`'{...}' | node "$env:PENECHO_BROWSER_HELPER"\`, as it drops the quotes of JSON given as an argument; preferred because it survives restarts and port changes) or \`curl -s "$PENECHO_BROWSER_URL" -H "x-penecho-token: $PENECHO_BROWSER_PASS" -H "content-type: application/json" -d '{...}'\`. Without those variables, read url and token from ~/.penecho/browser.json. The JSON names one of url, file, html or dir (a folder with an index.html), such as {"dir":"/absolute/folder"}; {"action":"help"} lists the rest. The answer names the screenshot.
`;
}
// A copy is read and compared only when its file is not as PenEcho last left it, or the text changed: every project's 3-second look read
// each copy again (slides.js, prototype-rules.js and agent-help.js keep their copies the same way, each on its own for PenEcho Cloud's copy).
const versionOf = stat => (stat ? `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}` : "");
const copies = new Map();
function keepCopy(file, text) {
  const before = versionOf(fs.statSync(file, { throwIfNoEntry:false })), known = copies.get(file);
  if (before && known?.version === before && known.text === text) return false;
  let now = null;
  try { now = fs.readFileSync(file, "utf8"); } catch { /* Not there yet. */ }
  const write = now !== text;
  if (write) { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, text); copies.delete(file); return true; }
  // Remembered only once it was read holding the text and did not change while read; a copy just written is read at the next look.
  const after = versionOf(fs.statSync(file, { throwIfNoEntry:false }));
  if (after && after === before) { if (copies.size > 2000) copies.clear(); copies.set(file, { version:after, text }); } else copies.delete(file);
  return false;
}
function install(dir) {
  return keepCopy(path.join(dir, NAME), text());
}

module.exports = { NAME, text, install };
