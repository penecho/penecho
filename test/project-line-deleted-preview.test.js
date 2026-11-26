"use strict";
require("./helpers/safety.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const { Store } = require("../src/server/project-lines/store.js");
const { deletedPreview } = require("../src/server/project-lines/deleted-preview.js");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-deleted-previews-"));
after(() => fs.rmSync(temp, { recursive:true, force:true }));
let seq = 0;
function fixture(kind = "files") {
  const docs = path.join(temp, `docs-${++seq}`), directory = path.join(temp, `state-${seq}`);
  fs.mkdirSync(directory, { recursive:true });
  const store = new Store({ directory });
  const project = store.create({ name:"Garden", docsPath:docs });
  const id = "aabbccddeeff", dir = `.trash/${kind}/${id}`;
  fs.mkdirSync(path.join(docs, dir), { recursive:true });
  const write = (relative, content) => { const file = path.join(docs, relative); fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, content); return file; };
  return { docs, store, project, id, dir, write, preview:rec => deletedPreview(store, project, kind, id, rec) };
}

test("legacy Canvas and image records preview their preserved copy, even when the original path is reused", () => {
  for (const kind of ["files", "canvases"]) {
    const f = fixture(kind), picture = "files/garden/photo.png", source = "files/garden/canvas.penecho.json";
    f.write(`${f.dir}/0-photo.png`, "old picture");
    f.write(`${f.dir}/1-canvas.penecho.json`, "old canvas");
    f.write(picture, "new picture");
    const rec = { path:picture, source, picture, files:[{ from:picture, name:"0-photo.png" }, { from:source, name:"1-canvas.penecho.json" }] };
    const info = f.preview(rec);
    assert.deepEqual(info.preview, { kind:"image", path:`${f.dir}/0-photo.png` });
    assert.equal(fs.readFileSync(path.join(f.docs, info.preview.path), "utf8"), "old picture");
    assert.equal(fs.readFileSync(path.join(f.docs, picture), "utf8"), "new picture");
    assert.ok(info.downloadPath.startsWith(f.dir + "/"));
  }
});

test("text reads are bounded and HTML is reduced to non-executable content", t => {
  const f = fixture(), original = "files/report.html";
  f.write(`${f.dir}/0-report.html`, '<h1>Garden report</h1><script>window.stolen = true</script><style>body{}</style><p>Basil &amp; mint</p>' + " seeds".repeat(20000));
  const read = fs.readSync, lengths = [];
  t.mock.method(fs, "readSync", function(fd, buffer, offset, length, position) { lengths.push(length); return read.call(fs, fd, buffer, offset, length, position); });
  const info = f.preview({ path:original, files:[{ from:original, name:"0-report.html" }] });
  assert.deepEqual(lengths, [16 * 1024]);
  assert.ok(info.preview.text.length <= 800);
  assert.match(info.preview.text, /^Garden report Basil & mint/);
  assert.doesNotMatch(info.preview.text, /stolen|body\{|<script|<h1/);
});

test("a known entry document in a deleted page folder gets an excerpt", () => {
  const f = fixture();
  f.write(`${f.dir}/0-site/index.html`, "<h1>Planting plan</h1><p>Four spring beds</p>");
  const info = f.preview({ path:"files/site/index.html", files:[{ from:"files/site", name:"0-site" }] });
  assert.equal(info.downloadPath, `${f.dir}/0-site/index.html`);
  assert.equal(info.preview.text, "Planting plan Four spring beds");
});

test("unsupported, binary and absent files retain identity without fabricated previews", () => {
  const f = fixture();
  f.write(`${f.dir}/0-report.pdf`, "%PDF-binary");
  const pdf = f.preview({ path:"files/report.pdf", files:[{ from:"files/report.pdf", name:"0-report.pdf" }] });
  assert.equal(pdf.fileType, "PDF");
  assert.equal(pdf.size, 11);
  assert.equal(pdf.downloadPath, `${f.dir}/0-report.pdf`);
  assert.equal(pdf.preview, undefined);
  f.write(`${f.dir}/1-binary.txt`, Buffer.from([0, 1, 2, 3]));
  assert.equal(f.preview({ path:"files/binary.txt", files:[{ from:"files/binary.txt", name:"1-binary.txt" }] }).preview, undefined);
  assert.equal(f.preview({ path:"files/missing.png", files:[{ from:"files/missing.png", name:"missing.png" }] }).preview, undefined);
});

test("edited manifests cannot preview another item, an active file or an escaping symlink", () => {
  const f = fixture();
  f.write("files/private.txt", "private");
  f.write(`${f.dir}/safe.txt`, "kept");
  const cases = [
    { path:"files/private.txt", files:[{ from:"files/private.txt", name:"../../../files/private.txt" }] },
    { path:"files/../private.txt", files:[{ from:"files/../private.txt", name:"safe.txt" }] },
    { path:"/files/private.txt", files:[{ from:"/files/private.txt", name:"safe.txt" }] },
    { path:"files/private.txt", files:[{ from:"files/private.txt", name:"..\\private.txt" }] },
    { path:"files/private.txt", files:[{ from:"files/private.txt", name:"bad\0name" }] },
  ];
  fs.symlinkSync(path.join(f.docs, "files/private.txt"), path.join(f.docs, f.dir, "linked.txt"));
  cases.push({ path:"files/private.txt", files:[{ from:"files/private.txt", name:"linked.txt" }] });
  for (const rec of cases) {
    const info = f.preview(rec);
    assert.equal(info.preview, undefined);
    assert.equal(info.downloadPath, undefined);
  }
  assert.deepEqual(deletedPreview(f.store, f.project, "other", f.id, {}), {});
  assert.deepEqual(deletedPreview(f.store, f.project, "files", "../other", {}), {});
});
