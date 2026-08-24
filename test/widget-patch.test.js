"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { commandFromWidgetPatch, resolveWidgetEditPatchCommands, widgetPatchFileContent, widgetPatchContract, widgetPatchFiles } = require("../src/server/widget-patch.js");

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

test("widget patch applies multiple exact hunks and preserves host identity and geometry", () => {
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

test("widget patch removes only exact repeated context between adjacent hunks", () => {
  const widgetEdit = htmlEdit({
      html:"start\none\nkeep-a\nkeep-b\ntwo\nend\n",
      source:"",
      sourceFormat:"",
    }),
    overlappingContext = [
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -1,4 +1,4 @@",
      " start",
      "-one",
      "+ONE",
      "+inserted",
      " keep-a",
      " keep-b",
      "@@ -3,4 +3,4 @@",
      " keep-a",
      " keep-b",
      "-two",
      "+TWO",
      " end",
      "",
    ].join("\n"),
    result = commandFromWidgetPatch(patchCommand(overlappingContext),widgetEdit);
  assert.equal(result.html,"start\nONE\ninserted\nkeep-a\nkeep-b\nTWO\nend\n");

  for (const invalidPatch of [
    overlappingContext.replace(" keep-b\n-two", " keep-X\n-two"),
    overlappingContext.replace(" keep-a\n keep-b\n-two", "-keep-a\n+KEEP-A\n keep-b\n-two"),
  ]) {
    const diagnostics = {};
    assert.equal(commandFromWidgetPatch(patchCommand(invalidPatch),widgetEdit,diagnostics),null);
    assert.equal(diagnostics.reason,"overlapping-hunk-context");
  }
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

test("widget patch narrowly normalizes common Update File markers", () => {
  const patch = [
      "*** Begin Patch",
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -2,3 +2,3 @@",
      " <html>",
      " <body>",
      "-<h1>Old</h1>",
      "+<h1>Compatible</h1>",
      "*** Update File: widget.source",
      "@@ -1,3 +1,4 @@",
      " graph LR",
      " A --> B",
      " B --> C",
      "+C --> D",
      "*** End Patch",
      "",
    ].join("\n"),
    result = commandFromWidgetPatch(patchCommand(patch), htmlEdit());
  assert.match(result.html, /<h1>Compatible<\/h1>/);
  assert.equal(result.copyText, "graph LR\nA --> B\nB --> C\nC --> D\n");

  const updateFileOnly = patch
    .replace("--- a/widget.html\n+++ b/widget.html", "*** Update File: widget.html");
  assert.deepEqual(commandFromWidgetPatch(patchCommand(updateFileOnly), htmlEdit()), result);

  const unlisted = patch.replace("*** Update File: widget.source", "*** Update File: other.source");
  assert.equal(commandFromWidgetPatch(patchCommand(unlisted), htmlEdit()), null);
  assert.equal(commandFromWidgetPatch(patchCommand(`*** Delete File: widget.source\n${patch}`), htmlEdit()), null);
});

test("widget patch reports unsupported manifest fields precisely", () => {
  const patch = [
      "--- a/widget.json",
      "+++ b/widget.json",
      "@@ -5,6 +5,7 @@",
      "   \"refreshSeconds\": 900,",
      "   \"diagramKind\": null,",
      "   \"sourceFormat\": \"mermaid\",",
      "+  \"background\": \"transparent\",",
      "   \"frameworkVersion\": null,",
      "   \"htmlFile\": \"widget.html\",",
      "   \"copyTextFile\": \"widget.source\",",
      "",
    ].join("\n"), diagnostics = {};
  assert.equal(commandFromWidgetPatch(patchCommand(patch),htmlEdit(),diagnostics),null);
  assert.equal(diagnostics.reason,"unsupported-manifest-field:background");
});

test("widget patch never exposes or accepts community lineage fields", () => {
  const fields = ["communityOriginItemId", "communityRootItemId", "communityOriginName", "communityOriginGeneration"],
    manifest = widgetPatchFiles(htmlEdit(Object.fromEntries(fields.map(field => [field, `private-${field}`]))))
      .find(file => file.path === "widget.json").content;
  for (const field of fields) assert.doesNotMatch(manifest, new RegExp(field));

  const patch = [
      "--- a/widget.json",
      "+++ b/widget.json",
      "@@ -5,6 +5,7 @@",
      "   \"refreshSeconds\": 900,",
      "   \"diagramKind\": null,",
      "   \"sourceFormat\": \"mermaid\",",
      "+  \"communityOriginItemId\": \"123e4567-e89b-42d3-a456-426614174099\",",
      "   \"frameworkVersion\": null,",
      "   \"htmlFile\": \"widget.html\",",
      "   \"copyTextFile\": \"widget.source\",",
      "",
    ].join("\n"), diagnostics = {};
  assert.equal(commandFromWidgetPatch(patchCommand(patch), htmlEdit(), diagnostics), null);
  assert.equal(diagnostics.reason, "unsupported-manifest-field:communityOriginItemId");
});

test("widget patch accepts the standard dual-file prompt example", () => {
  const widgetEdit = htmlEdit({
      html:"<main>\n  <h1>Old</h1>\n</main>\n",
      source:"page:\n  title: Old\n  enabled: true\n",
      sourceFormat:"yaml",
    }),
    patch = [
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -1,3 +1,3 @@",
      " <main>",
      "-  <h1>Old</h1>",
      "+  <h1>New</h1>",
      " </main>",
      "--- a/widget.source",
      "+++ b/widget.source",
      "@@ -1,3 +1,3 @@",
      " page:",
      "-  title: Old",
      "+  title: New",
      "   enabled: true",
      "",
    ].join("\n"),
    result = commandFromWidgetPatch(patchCommand(patch), widgetEdit);
  assert.equal(result.html, "<main>\n  <h1>New</h1>\n</main>\n");
  assert.equal(result.copyText, "page:\n  title: New\n  enabled: true\n");
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

test("widget patch coalesces repeated file sections without adding content", () => {
  const widgetEdit = htmlEdit({
      html:"start\none\nmiddle\ntwo\nend",
      source:"",
      sourceFormat:"",
    }),
    patch = [
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -2,1 +2,1 @@",
      "-one",
      "+ONE",
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -4,1 +4,1 @@",
      "-two",
      "+TWO",
      "",
    ].join("\n"),
    result = commandFromWidgetPatch(patchCommand(patch), widgetEdit);
  assert.equal(result.html, "start\nONE\nmiddle\nTWO\nend");
  assert.equal(result.html.includes("--- a/widget.html"), false);

  const reversed = patch.replace(
    "@@ -2,1 +2,1 @@\n-one\n+ONE\n--- a/widget.html\n+++ b/widget.html\n@@ -4,1 +4,1 @@\n-two\n+TWO",
    "@@ -4,1 +4,1 @@\n-two\n+TWO\n--- a/widget.html\n+++ b/widget.html\n@@ -2,1 +2,1 @@\n-one\n+ONE",
  );
  assert.equal(commandFromWidgetPatch(patchCommand(reversed), widgetEdit), null);
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

test("widget patch narrowly removes one copied nl metadata TAB from a complete hunk", () => {
  const widgetEdit = htmlEdit({
      html:"<section>\n\t<p>Old</p>\n</section>\n",
      source:"",
      sourceFormat:"",
    }),
    patch = [
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -1,3 +1,3 @@",
      " \t<section>",
      "-\t\t<p>Old</p>",
      "+\t\t<p>New</p>",
      " \t</section>",
      "",
    ].join("\n"),
    result = commandFromWidgetPatch(patchCommand(patch),widgetEdit);
  assert.equal(result.html,"<section>\n\t<p>New</p>\n</section>\n");
});

test("widget patch keeps real TAB indentation and rejects partial or ambiguous metadata repair", () => {
  const tabIndented = htmlEdit({ html:"\told\n",source:"",sourceFormat:"" }),
    exactPatch = "--- a/widget.html\n+++ b/widget.html\n@@ -1 +1 @@\n-\told\n+\tnew\n";
  assert.equal(commandFromWidgetPatch(patchCommand(exactPatch),tabIndented).html,"\tnew\n");

  const plain = htmlEdit({ html:"<section>\nold\n</section>\n",source:"",sourceFormat:"" }),
    partialLeak = "--- a/widget.html\n+++ b/widget.html\n@@ -1,3 +1,3 @@\n \t<section>\n-\told\n+new\n \t</section>\n";
  assert.equal(commandFromWidgetPatch(patchCommand(partialLeak),plain),null);

  const wrongCoordinate = "--- a/widget.html\n+++ b/widget.html\n@@ -2,3 +2,3 @@\n \t<section>\n-\told\n+\tnew\n \t</section>\n";
  assert.equal(commandFromWidgetPatch(patchCommand(wrongCoordinate),plain),null);

  const repeated = htmlEdit({ html:"start\nold\nend\nstart\nold\nend\n",source:"",sourceFormat:"" }),
    ambiguousLeak = "--- a/widget.html\n+++ b/widget.html\n@@ -1,3 +1,3 @@\n \tstart\n-\told\n+\tnew\n \tend\n";
  assert.equal(commandFromWidgetPatch(patchCommand(ambiguousLeak),repeated),null);
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
  assert.deepEqual(widgetPatchContract(widgetEdit), [{ path:"widget.json" },{ path:"widget.html" },{ path:"widget.source" }]);
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
  assert.deepEqual(widgetPatchContract(widgetEdit), [{ path:"widget.json" },{ path:"widget.source" }]);
});

test("widget manifest patch updates all editable diagram metadata without changing host fields", () => {
  const widgetEdit = htmlEdit({
      widgetType:"diagram_source",
      pluginId:"flowchart",
      title:"Aspirin",
      sourceFormat:"smiles",
      diagramKind:"molecular-structure",
      source:"CC(=O)OC1=CC=CC=C1C(=O)O",
    });
  delete widgetEdit.html;
  const patch = [
      "--- a/widget.json",
      "+++ b/widget.json",
      "@@ -3,6 +3,6 @@",
      '   "pluginId": "flowchart",',
      '-  "title": "Aspirin",',
      '+  "title": "Compact aspirin",',
      '   "refreshSeconds": 0,',
      '-  "diagramKind": "molecular-structure",',
      '+  "diagramKind": "molecular-structure-compact",',
      '   "sourceFormat": "smiles",',
      '   "sourceFile": "widget.source"',
      "",
    ].join("\n"),
    result = commandFromWidgetPatch(patchCommand(patch),widgetEdit);
  assert.equal(result.title,"Compact aspirin");
  assert.equal(result.diagramKind,"molecular-structure-compact");
  assert.equal(result.sourceFormat,"smiles");
  assert.equal(result.source,widgetEdit.source);
  assert.equal(result.pluginId,widgetEdit.pluginId);
  assert.deepEqual({ x:result.x,y:result.y,w:result.w,h:result.h },widgetEdit.box);
});

test("widget manifest patch may change diagram source format with its source", () => {
  const widgetEdit = htmlEdit({
      widgetType:"diagram_source",
      pluginId:"flowchart",
      sourceFormat:"smiles",
      diagramKind:"molecular-structure",
      source:"CCO",
    });
  delete widgetEdit.html;
  const patch = [
      "--- a/widget.json",
      "+++ b/widget.json",
      "@@ -5,4 +5,4 @@",
      '   "refreshSeconds": 0,',
      '-  "diagramKind": "molecular-structure",',
      '-  "sourceFormat": "smiles",',
      '+  "diagramKind": "process",',
      '+  "sourceFormat": "mermaid",',
      '   "sourceFile": "widget.source"',
      "--- a/widget.source",
      "+++ b/widget.source",
      "@@ -1 +1,2 @@",
      "-CCO",
      "+flowchart LR",
      "+A --> B",
      "",
    ].join("\n"),
    result = commandFromWidgetPatch(patchCommand(patch),widgetEdit);
  assert.equal(result.sourceFormat,"mermaid");
  assert.equal(result.diagramKind,"process");
  assert.equal(result.source,"flowchart LR\nA --> B");
});

test("widget manifest patch can add and remove a distinct copy source", () => {
  const withoutSource = htmlEdit({ source:"",sourceFormat:"",copyLabel:"",html:"<main>Visible</main>" }),
    emptySourceReference = [
      "--- a/widget.json",
      "+++ b/widget.json",
      "@@ -9,3 +9,3 @@",
      '   "htmlFile": "widget.html",',
      '-  "copyTextFile": null,',
      '+  "copyTextFile": "widget.source",',
      '   "copyLabel": null',
      "",
    ].join("\n"),
    addPatch = [
      "--- a/widget.json",
      "+++ b/widget.json",
      "@@ -5,7 +5,7 @@",
      '   "refreshSeconds": 900,',
      '   "diagramKind": null,',
      '-  "sourceFormat": null,',
      '+  "sourceFormat": "yaml",',
      '   "frameworkVersion": null,',
      '   "htmlFile": "widget.html",',
      '-  "copyTextFile": null,',
      '-  "copyLabel": null',
      '+  "copyTextFile": "widget.source",',
      '+  "copyLabel": "Copy YAML"',
      "--- a/widget.source",
      "+++ b/widget.source",
      "@@ -0,0 +1,2 @@",
      "+page:",
      "+  title: Visible",
      "",
    ].join("\n"),
    added = commandFromWidgetPatch(patchCommand(addPatch),withoutSource);
  assert.equal(commandFromWidgetPatch(patchCommand(emptySourceReference),withoutSource),null);
  assert.equal(added.sourceFormat,"yaml");
  assert.equal(added.copyText,"page:\n  title: Visible");
  assert.equal(added.copyLabel,"Copy YAML");

  const removePatch = [
      "--- a/widget.json",
      "+++ b/widget.json",
      "@@ -8,4 +8,4 @@",
      '   "frameworkVersion": null,',
      '   "htmlFile": "widget.html",',
      '-  "copyTextFile": "widget.source",',
      '-  "copyLabel": "Copy mermaid"',
      '+  "copyTextFile": null,',
      '+  "copyLabel": null',
      "",
    ].join("\n"),
    removed = commandFromWidgetPatch(patchCommand(removePatch),htmlEdit());
  assert.equal("copyText" in removed,false);
  assert.equal("copyLabel" in removed,false);
});

test("widget manifest keeps host identity references immutable", () => {
  const widgetEdit = htmlEdit(), files = widgetPatchFiles(widgetEdit), manifest = files.find(file => file.path === "widget.json").content,
    changedPlugin = manifest.replace('"pluginId": "general"','"pluginId": "other"'),
    patch = `--- a/widget.json\n+++ b/widget.json\n@@ -2,3 +2,3 @@\n   "tool": "html_widget",\n-  "pluginId": "general",\n+  "pluginId": "other",\n   "title": "Existing widget",\n`;
  assert.notEqual(changedPlugin,manifest);
  assert.equal(commandFromWidgetPatch(patchCommand(patch),widgetEdit),null);
});

test("widget patch preserves CRLF and applies against a normalized final newline", () => {
  const widgetEdit = htmlEdit({ html:"first\r\nsecond\r\n", source:"", sourceFormat:"" }),
    crlfPatch = "--- a/widget.html\r\n+++ b/widget.html\r\n@@ -1,2 +1,2 @@\r\n first\r\n-second\r\n+updated\r\n",
    crlfResult = commandFromWidgetPatch(patchCommand(crlfPatch), widgetEdit);
  assert.equal(crlfResult.html, "first\r\nupdated\r\n");

  const eofPatch = "--- a/widget.html\n+++ b/widget.html\n@@ -1,2 +1,2 @@\n first\n-second\n+updated\n",
    eofResult = commandFromWidgetPatch(patchCommand(eofPatch), htmlEdit({ html:"first\nsecond", source:"", sourceFormat:"" }));
  assert.equal(eofResult.html, "first\nupdated");
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
  assert.equal(prependResult.html, "<script>prepend()</script>\n<!doctype html><main>Existing</main>");
  assert.equal(prependResult.copyText, "new source");

  const appendPatch = "--- a/widget.html\n+++ b/widget.html\n@@ -1,0 +2 @@\n+<script>append()</script>\n",
    appendResult = commandFromWidgetPatch(patchCommand(appendPatch), htmlEdit({ html:"<!doctype html><main>Existing</main>", source:"", sourceFormat:"" }));
  assert.equal(appendResult.html, "<!doctype html><main>Existing</main>\n<script>append()</script>");

  const middlePatch = "--- a/widget.html\n+++ b/widget.html\n@@ -1,0 +2 @@\n+<script>middle()</script>\n",
    middleSource = htmlEdit({ html:"first\nsecond\nthird", source:"", sourceFormat:"" });
  assert.equal(commandFromWidgetPatch(patchCommand(middlePatch), middleSource), null);
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

test("widget patch diagnoses shortened long-line context and incomplete HTML tags", () => {
  const widgetEdit = htmlEdit({
      html:[
        "<section>",
        "  <canvas id=\"c\" width=\"1100\" height=\"560\"></canvas>",
        "  <div class=\"legend\"><span>Re(ψ)</span><span>|ψ|²</span></div>",
        "  </ol>",
        "  <canvas id=\"w\" width=\"1100\" height=\"430\"></canvas>",
        "  <div class=\"chips\">",
        "</section>",
        "",
      ].join("\n"),
      source:"",
      sourceFormat:"",
    }),
    shortenedLongLine = [
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -1,3 +1,3 @@",
      " <section>",
      "-  <canvas id=\"c\" width=\"1100\" height=\"560\"></canvas>",
      "+  <canvas id=\"c\" width=\"1100\" height=\"480\"></canvas>",
      "   <div class=\"legend\">",
      "",
    ].join("\n"),
    unchangedMainCanvasDiagnostics = {},
    shortenedDiagnostics = {includeLocationDetails:true};
  assert.equal(commandFromWidgetPatch(patchCommand(shortenedLongLine),widgetEdit,unchangedMainCanvasDiagnostics),null);
  assert.deepEqual(unchangedMainCanvasDiagnostics,{});
  assert.equal(commandFromWidgetPatch(patchCommand(shortenedLongLine),widgetEdit,shortenedDiagnostics),null);
  assert.deepEqual(shortenedDiagnostics,{
    includeLocationDetails:true,
    reason:"context-mismatch",
    path:"widget.html",
    hunk:1,
    oldStart:1,
    sourceLine:3,
    submittedLine:'  <div class="legend">',
    currentLine:'  <div class="legend"><span>Re(ψ)</span><span>|ψ|²</span></div>',
  });

  const incompleteTag = [
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -4,3 +4,3 @@",
      "   </ol>",
      "-  <canvas id=\"w\" width=\"1100\" height=\"430\">",
      "+  <canvas id=\"w\" width=\"1100\" height=\"360\">",
      "   <div class=\"chips\">",
      "",
    ].join("\n"),
    tagDiagnostics = {includeLocationDetails:true};
  assert.equal(commandFromWidgetPatch(patchCommand(incompleteTag),widgetEdit,tagDiagnostics),null);
  assert.equal(tagDiagnostics.reason,"context-mismatch");
  assert.equal(tagDiagnostics.path,"widget.html");
  assert.equal(tagDiagnostics.hunk,1);
  assert.equal(tagDiagnostics.sourceLine,5);
  assert.equal(tagDiagnostics.submittedLine,'  <canvas id="w" width="1100" height="430">');
  assert.equal(tagDiagnostics.currentLine,'  <canvas id="w" width="1100" height="430"></canvas>');
});

test("widget patch strips non-diff boundary lines but rejects unsafe envelopes and full replacements", () => {
  const validHunk = "@@ -3,3 +3,3 @@\n <body>\n-<h1>Old</h1>\n+<h1>New</h1>\n <p>Keep</p>\n",
    rejected = [
      `--- a/other.html\n+++ b/other.html\n${validHunk}`,
      `--- a/widget.html\n+++ b/renamed.html\n${validHunk}`,
      `--- a/widget.html\n+++ b/widget.html\n@@ -3,4 +3,4 @@\n <body>\n*** invalid inside a hunk\n-<h1>Old</h1>\n+<h1>New</h1>\n <p>Keep</p>\n`,
    ];
  for (const patch of rejected) assert.equal(commandFromWidgetPatch(patchCommand(patch), htmlEdit()), null, patch);
  const wrapped = `Here is the requested change:\n\`\`\`diff\ndiff --git a/widget.html b/widget.html\n--- a/widget.html\n+++ b/widget.html\n${validHunk}*** generated footer\n\`\`\`\n`,
    wrappedResult = commandFromWidgetPatch(patchCommand(wrapped), htmlEdit());
  assert.match(wrappedResult.html, /<h1>New<\/h1>/);
  assert.deepEqual(resolveWidgetEditPatchCommands([{ tool:"html_widget", html:"replacement" }], htmlEdit()), []);
  assert.deepEqual(resolveWidgetEditPatchCommands([patchCommand(`--- a/widget.html\n+++ b/widget.html\n${validHunk}`), patchCommand(`--- a/widget.html\n+++ b/widget.html\n${validHunk}`)], htmlEdit()), []);
  assert.equal(commandFromWidgetPatch({ tool:"widget_patch", patch:`--- a/widget.html\n+++ b/widget.html\n${validHunk}`, title:"model metadata" }, htmlEdit()), null);
});

test("widget patch diagnoses bare file headers with the exact canonical headers", () => {
  const diagnostics={includeLocationDetails:true}, patch=[
    "--- widget.html",
    "+++ widget.html",
    "@@ -3,3 +3,3 @@",
    " <body>",
    "-<h1>Old</h1>",
    "+<h1>New</h1>",
    " <p>Keep</p>",
    "",
  ].join("\n");
  assert.equal(commandFromWidgetPatch(patchCommand(patch),htmlEdit(),diagnostics),null);
  assert.deepEqual(diagnostics,{
    includeLocationDetails:true,
    reason:"invalid-file-header-prefix",
    path:"widget.html",
    submittedOldHeader:"--- widget.html",
    submittedNewHeader:"+++ widget.html",
    expectedOldHeader:"--- a/widget.html",
    expectedNewHeader:"+++ b/widget.html",
  });
});

test("widget patch accepts non-diff tool boundary lines", () => {
  const patch = [
      "*** Begin Patch",
      "--- a/widget.html",
      "+++ b/widget.html",
      "@@ -3,3 +3,3 @@",
      " <body>",
      "-<h1>Old</h1>",
      "+<h1>Compatible</h1>",
      " <p>Keep</p>",
      "*** End Patch",
      "",
    ].join("\n"),
    result = commandFromWidgetPatch(patchCommand(patch), htmlEdit());
  assert.match(result.html, /<h1>Compatible<\/h1>/);
});
