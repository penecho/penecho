"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { commandFromWidgetPatch, resolveWidgetEditPatchCommands, widgetPatchFileContent, widgetPatchContract } = require("../src/server/widget-patch.js");

const HTML = "<!doctype html>\n<html>\n<body>\n<h1>Old</h1>\n<p>Keep</p>\n<footer>v1</footer>\n</body>\n</html>\n";
const SOURCE = "graph LR\nA --> B\nB --> C\n";

function htmlEdit(overrides = {}) {
  return {
    mode:"replace",
    widgetType:"html_widget",
    pluginId:"general",
    title:"Existing widget",
    instructionMode:"implicit-polish",
    box:{ x:100, y:200, w:1200, h:700 },
    refreshSeconds:900,
    html:HTML,
    sourceFormat:"mermaid",
    source:SOURCE,
    copyLabel:"Copy mermaid",
    ...overrides,
  };
}

function patchCommand(patch) {
  return { tool:"widget_patch", patch };
}

test("widget patch baseline conditionally adds one final newline", () => {
  assert.equal(widgetPatchFileContent(""), "");
  assert.equal(widgetPatchFileContent("one line"), "one line\n");
  assert.equal(widgetPatchFileContent("one line\n"), "one line\n");
  assert.equal(widgetPatchFileContent("one line\r\n"), "one line\r\n");
  assert.equal(widgetPatchFileContent("one line\r"), "one line\r");
  assert.equal(widgetPatchFileContent(undefined), "");
});

test("widget patch applies multiple exact hunks and preserves trusted metadata", () => {
  const patch = [
    "--- a/widget.html",
    "+++ b/widget.html",
    "@@ -1,4 +1,4 @@",
    " <!doctype html>",
    " <html>",
    " <body>",
    "-<h1>Old</h1>",
    "+<h1>New</h1>",
    "@@ -5,4 +5,4 @@",
    " <p>Keep</p>",
    "-<footer>v1</footer>",
    "+<footer>v2</footer>",
    " </body>",
    " </html>",
    "",
  ].join("\n"), result = commandFromWidgetPatch(patchCommand(patch), htmlEdit());
  assert.equal(result.tool, "html_widget");
  assert.equal(result.pluginId, "general");
  assert.deepEqual({ x:result.x, y:result.y, w:result.w, h:result.h }, { x:100, y:200, w:1200, h:700 });
  assert.equal(result.title, "Existing widget");
  assert.equal(result.refreshSeconds, 900);
  assert.match(result.html, /<h1>New<\/h1>/);
  assert.match(result.html, /<footer>v2<\/footer>/);
  assert.equal(result.copyText, SOURCE);
});

test("widget patch applies HTML and source files atomically", () => {
  const patch = [
    "--- a/widget.html",
    "+++ b/widget.html",
    "@@ -2,3 +2,3 @@",
    " <html>",
    " <body>",
    "-<h1>Old</h1>",
    "+<h1>Architecture</h1>",
    "--- a/widget.source",
    "+++ b/widget.source",
    "@@ -1,3 +1,4 @@",
    " graph LR",
    " A --> B",
    " B --> C",
    "+C --> D",
    "",
  ].join("\n"), result = commandFromWidgetPatch(patchCommand(patch), htmlEdit());
  assert.match(result.html, /Architecture/);
  assert.equal(result.copyText, "graph LR\nA --> B\nB --> C\nC --> D\n");

  const staleSource = patch.replace(" B --> C", " B --> Missing");
  assert.equal(commandFromWidgetPatch(patchCommand(staleSource), htmlEdit()), null);
});

test("widget patch repairs redundant counts and uniquely relocates exact context", () => {
  const patch = [
    "--- a/widget.html",
    "+++ b/widget.html",
    "@@ -2,99 +2,42 @@",
    " <html>",
    " <body>",
    "-<h1>Old</h1>",
    "+<h1>Recounted</h1>",
    "--- a/widget.source",
    "+++ b/widget.source",
    "@@ -1,50 +1,70 @@",
    " graph LR",
    "-A --> B",
    "+A --> Updated",
    " B --> C",
    "",
  ].join("\n"), result = commandFromWidgetPatch(patchCommand(patch), htmlEdit());
  assert.match(result.html, /Recounted/);
  assert.match(result.copyText, /A --> Updated/);

  const shiftedStart = patch.replace("@@ -2,99 +2,42 @@", "@@ -3,99 +3,42 @@");
  assert.match(commandFromWidgetPatch(patchCommand(shiftedStart), htmlEdit()).html, /Recounted/);
});

test("widget patch repairs one omitted source-indent space only at a unique target", () => {
  const widgetEdit = htmlEdit({
      html:".button {\n color:red;\n padding:0;\n}\nrun();\n if (ready) {\n  fire();\n }\n",
      source:"",
      sourceFormat:"",
    }),
    patch = [
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -1,4 +1,4 @@",
      " .button {",
      "-color:red;",
      "+ color:blue;",
      " padding:0;",
      " }",
      "@@ -5,4 +5,4 @@",
      " run();",
      " if (ready) {",
      "- fire();",
      "+  launch();",
      "  }",
      "",
    ].join("\n"), result = commandFromWidgetPatch(patchCommand(patch), widgetEdit);
  assert.equal(result.html, ".button {\n color:blue;\n padding:0;\n}\nrun();\n if (ready) {\n  launch();\n }\n");
});

test("widget patch rejects broader or ambiguous whitespace repair", () => {
  const twoSpaces = htmlEdit({ html:".button {\n  color:red;\n}\n", source:"", sourceFormat:"" }),
    twoSpacePatch = "--- a/widget.html\n+++ b/widget.html\n@@ -1,3 +1,3 @@\n .button {\n-color:red;\n+ color:blue;\n }\n";
  assert.equal(commandFromWidgetPatch(patchCommand(twoSpacePatch), twoSpaces), null);

  const ambiguous = htmlEdit({ html:"start\n indented\nold\nmiddle\n indented\nold\nend\n", source:"", sourceFormat:"" }),
    ambiguousPatch = "--- a/widget.html\n+++ b/widget.html\n@@ -1,2 +1,2 @@\n indented\n-old\n+new\n";
  assert.equal(commandFromWidgetPatch(patchCommand(ambiguousPatch), ambiguous), null);
});

test("widget patch reconstructs bare hunk headers only from unique exact context", () => {
  const patch = [
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@",
      " <html>",
      " <body>",
      "-<h1>Old</h1>",
      "+<h1>Reconstructed</h1>",
      "@@",
      " <p>Keep</p>",
      "-<footer>v1</footer>",
      "+<footer>v2</footer>",
      " </body>",
      " </html>",
      "",
    ].join("\n"),
    result = commandFromWidgetPatch(patchCommand(patch), htmlEdit());
  assert.match(result.html, /<h1>Reconstructed<\/h1>/);
  assert.match(result.html, /<footer>v2<\/footer>/);

  const ambiguousEdit = htmlEdit({
      html:"start\nrepeat\nold\nend\nmiddle\nrepeat\nold\nend\n",
      source:"",
      sourceFormat:"",
    }),
    ambiguousPatch = "--- a/widget.html\n+++ b/widget.html\n@@\n repeat\n-old\n+new\n end\n",
    unlocatedInsertion = "--- a/widget.html\n+++ b/widget.html\n@@\n+<script>prepend()</script>\n";
  assert.equal(commandFromWidgetPatch(patchCommand(ambiguousPatch), ambiguousEdit), null);
  assert.equal(commandFromWidgetPatch(patchCommand(unlocatedInsertion), htmlEdit()), null);
});

test("HTML-backed copy source is implicit and never becomes a duplicate patch file", () => {
  const widgetEdit = htmlEdit({
      source:HTML,
      sourceFormat:"html",
      copyLabel:"Copy HTML",
      sourceMirrorsHtml:true,
    }),
    patch = [
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -2,3 +2,3 @@",
      " <html>",
      " <body>",
      "-<h1>Old</h1>",
      "+<h1>New</h1>",
      "",
    ].join("\n"),
    result = commandFromWidgetPatch(patchCommand(patch), widgetEdit);
  assert.deepEqual(widgetPatchContract(widgetEdit), [{ path:"widget.html", widgetEditField:"html" }]);
  assert.match(result.html, /<h1>New<\/h1>/);
  assert.equal("copyText" in result, false);
  assert.equal("copyLabel" in result, false);
});

test("diagram patch reconstructs a complete diagram command", () => {
  const widgetEdit = htmlEdit({ widgetType:"diagram_source", pluginId:"flowchart", sourceFormat:"mermaid", diagramKind:"process" });
  delete widgetEdit.html;
  const patch = "--- a/widget.source\n+++ b/widget.source\n@@ -1,3 +1,4 @@\n graph LR\n A --> B\n B --> C\n+C --> D\n",
    result = commandFromWidgetPatch(patchCommand(patch), widgetEdit);
  assert.deepEqual(result, {
    tool:"diagram_source",
    pluginId:"flowchart",
    x:100,
    y:200,
    w:1200,
    h:700,
    title:"Existing widget",
    refreshSeconds:0,
    sourceFormat:"mermaid",
    source:"graph LR\nA --> B\nB --> C\nC --> D\n",
    diagramKind:"process",
  });
  assert.deepEqual(widgetPatchContract(widgetEdit), [{ path:"widget.source", widgetEditField:"source" }]);
});

test("widget patch preserves CRLF and applies against a normalized final newline", () => {
  const widgetEdit = htmlEdit({ html:"first\r\nsecond\r\n", source:"", sourceFormat:"" }),
    crlfPatch = "--- a/widget.html\r\n+++ b/widget.html\r\n@@ -1,2 +1,2 @@\r\n first\r\n-second\r\n+updated\r\n",
    crlfResult = commandFromWidgetPatch(patchCommand(crlfPatch), widgetEdit);
  assert.equal(crlfResult.html, "first\r\nupdated\r\n");

  const eofPatch = "--- a/widget.html\n+++ b/widget.html\n@@ -1,2 +1,2 @@\n first\n-second\n+updated\n",
    eofResult = commandFromWidgetPatch(patchCommand(eofPatch), htmlEdit({ html:"first\nsecond", source:"", sourceFormat:"" }));
  assert.equal(eofResult.html, "first\nupdated\n");
});

test("widget patch accepts standard zero-line insertion coordinates", () => {
  const widgetEdit = htmlEdit({ html:"<!doctype html><main>Existing</main>", source:"old source", sourceFormat:"text" }),
    prependPatch = [
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -0,0 +1 @@",
      "+<script>prepend()</script>",
      "--- a/widget.source",
      "+++ b/widget.source",
      "@@ -1 +1 @@",
      "-old source",
      "+new source",
      "",
    ].join("\n"),
    prependResult = commandFromWidgetPatch(patchCommand(prependPatch), widgetEdit);
  assert.equal(prependResult.html, "<script>prepend()</script>\n<!doctype html><main>Existing</main>\n");
  assert.equal(prependResult.copyText, "new source\n");

  const appendPatch = "--- a/widget.html\n+++ b/widget.html\n@@ -1,0 +2 @@\n+<script>append()</script>\n",
    appendResult = commandFromWidgetPatch(patchCommand(appendPatch), htmlEdit({ html:"<!doctype html><main>Existing</main>", source:"", sourceFormat:"" }));
  assert.equal(appendResult.html, "<!doctype html><main>Existing</main>\n<script>append()</script>\n");
});

test("widget patch rejects location drift even when jsdiff could find matching text elsewhere", () => {
  const widgetEdit = htmlEdit({
    html:"start\nrepeat\nold\nend\nmiddle\nrepeat\nold\nend\n",
    source:"",
    sourceFormat:"",
  });
  const patch = "--- a/widget.html\n+++ b/widget.html\n@@ -4,3 +4,3 @@\n repeat\n-old\n+new\n end\n";
  assert.equal(commandFromWidgetPatch(patchCommand(patch), widgetEdit), null);
});

test("widget patch rejects untrusted envelopes and full replacements", () => {
  const validHunk = "@@ -3,3 +3,3 @@\n <body>\n-<h1>Old</h1>\n+<h1>New</h1>\n <p>Keep</p>\n",
    rejected = [
      `diff --git a/widget.html b/widget.html\n--- a/widget.html\n+++ b/widget.html\n${validHunk}`,
      `--- a/other.html\n+++ b/other.html\n${validHunk}`,
      `--- a/widget.html\n+++ b/renamed.html\n${validHunk}`,
      `--- a/widget.html\n+++ b/widget.html\n${validHunk}\ntrailing prose`,
      "--- a/widget.source\n+++ b/widget.source\n@@ -1,3 +1,3 @@\n graph LR\n-A --> B\n+A --> D\n B --> C\n",
    ];
  for (const patch of rejected) assert.equal(commandFromWidgetPatch(patchCommand(patch), htmlEdit()), null, patch);
  assert.deepEqual(resolveWidgetEditPatchCommands([{ tool:"html_widget", html:"replacement" }], htmlEdit()), []);
  assert.deepEqual(resolveWidgetEditPatchCommands([patchCommand(`--- a/widget.html\n+++ b/widget.html\n${validHunk}`), patchCommand(`--- a/widget.html\n+++ b/widget.html\n${validHunk}`)], htmlEdit()), []);
  assert.equal(commandFromWidgetPatch({ tool:"widget_patch", patch:`--- a/widget.html\n+++ b/widget.html\n${validHunk}`, title:"model metadata" }, htmlEdit()), null);
});
