"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {parsePatch, createTwoFilesPatch} = require("diff");
const {validateCanvasFilePatch, applyCanvasFilePatch} = require("../src/shared/canvas-file-patch");
const path = "/widgets/example.html";
const headers = "--- a/widgets/example.html\n+++ b/widgets/example.html\n";
const body = " <section>\n <h1>Example</h1>\n-<p>Version A</p>\n+<p>Version B</p>\n <footer>Footer</footer>\n </section>\n <!-- end -->\n";
const patch = headers + "@@ -42,7 +42,7 @@\n" + body;
const source = "prefix\n".repeat(41) + "<section>\n<h1>Example</h1>\n<p>Version A</p>\n<footer>Footer</footer>\n</section>\n<!-- end -->\n";

test("repairs the observed seven versus six count error without changing body or positions", () => {
  assert.throws(() => parsePatch(patch));
  const parsed = validateCanvasFilePatch(patch,path);
  assert.equal(parsed.hunks[0].oldStart,42);
  assert.equal(parsed.hunks[0].newStart,42);
  assert.equal(parsed.hunks[0].oldLines,6);
  assert.equal(parsed.hunks[0].newLines,6);
  assert.deepEqual(parsed.hunks[0].lines,body.trimEnd().split("\n"));
  assert.equal(applyCanvasFilePatch(source,patch,path),source.replace("Version A","Version B"));
});
test("repaired counts do not bypass genuine source conflicts", () => {
  assert.throws(() => applyCanvasFilePatch(source.replace("Version A","Version C"),patch,path),{code:"PATCH_CONFLICT"});
});
test("rejects ambiguous or malformed fallback inputs", () => {
  const invalid = [
    patch.replaceAll("widgets/example.html","widgets/other.html"),
    patch.replaceAll(",7",",6") + headers + "@@ -1,2 +1,2 @@\n-a\n+b\n",
    patch + "@@ -50,2 +50,2 @@\n-a\n+b\n",
    patch.replace(" <section>","<section>"),
    patch.replace(" <section>","\\ bad marker"),
    patch.replace(" <section>","\\ No newline at end of file"),
    patch.replace(" <h1>Example</h1>","\\ No newline at end of file\n\\ No newline at end of file"),
    patch.replace(" <h1>Example</h1>","\\ No newline at end of file"),
    patch.replace("-42,7","-9007199254740992,7"),
    patch.replace("-42,7","-042,7"),
    patch.replace("-42,7","-0,7"),
  ];
  for(const [index,candidate] of invalid.entries()) assert.throws(() => validateCanvasFilePatch(candidate,path), {code:"invalid_patch"}, `candidate ${index}`);
});
test("valid multi-hunk patches keep existing parser behavior", () => {
  const old = "start\n" + "middle\n".repeat(20) + "end\n";
  const next = old.replace("start","START").replace("end","END");
  const valid = createTwoFilesPatch("a/widgets/example.html","b/widgets/example.html",old,next);
  assert.equal(parsePatch(valid)[0].hunks.length,2);
  assert.deepEqual(validateCanvasFilePatch(valid,path),parsePatch(valid)[0]);
  assert.equal(applyCanvasFilePatch(old,valid,path),next);
});
test("insertion and deletion count repairs preserve zero-count start conventions", () => {
  assert.equal(applyCanvasFilePatch("",headers + "@@ -0,0 +1,2 @@\n+new\n",path),"new\n");
  assert.equal(applyCanvasFilePatch("old\n",headers + "@@ -1,2 +0,0 @@\n-old\n",path),"");
});
test("CRLF body bytes and source line endings are preserved", () => {
  const crlf = patch.replaceAll("\n","\r\n");
  const original = source.replaceAll("\n","\r\n");
  assert.equal(applyCanvasFilePatch(original,crlf,path),original.replace("Version A","Version B"));
  assert.ok(validateCanvasFilePatch(crlf,path).hunks[0].lines.every(line => line.endsWith("\r")));
});
test("valid no-final-newline markers preserve exact EOF semantics", () => {
  const candidate = headers + "@@ -1,2 +1,2 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file";
  assert.equal(applyCanvasFilePatch("old",candidate,path),"new");
});
