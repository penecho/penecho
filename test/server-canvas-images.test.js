"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const source = fs.readFileSync(path.join(__dirname, "../src/server/main.js"), "utf8");
function extract(name) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf("\nfunction ", start + 1);
  assert.ok(start >= 0, name); return source.slice(start, end < 0 ? undefined : end);
}
function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-roundtrip-"));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const context = vm.createContext({ fs, path, crypto, Buffer, process, CANVAS_SIZE:20000, SHARED_CANVAS_DIRECTORY:directory,
    CANVAS_SNAPSHOT_ID_PATTERN:/^\d{10,16}-[a-zA-Z0-9-]{8,64}$/, MAX_SHARED_CANVAS_BYTES:96*1024*1024,
    DEFAULT_CANVAS_PROJECT_ID:"uncategorized", normalizeCanvasTheme:value=>value, sharedCanvasProject:()=>true });
  for (const name of ["canvasSnapshotPath", "atomicJsonWrite", "sharedCanvasMetadata", "validCanvasDocumentId", "validSnapshotDataUrl", "canonicalSharedCanvasV1", "plainObject", "bundleDataUrl", "dataUrlParts", "canvasBundleAssetKey", "canvasBundleToV1", "v1ToCanvasBundle", "sharedCanvasLogicalSnapshot", "canonicalSharedCanvas", "canonicalSharedCanvasMetadata", "readSharedCanvas", "saveSharedCanvas"])
    vm.runInContext(extract(name), context);
  return context;
}
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABEElEQVR4nO3UsQkAMBDDwN9/aWWIFELg4nphPrk7GD422ID8bbAB2YBnfkO7QDbg7QLpvgQ9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gLQHKjvQ4BzHEKAAAAAASUVORK5CYII=';
function snapshot() {
  const now = Date.now();
  return { version:1, id:now+"-"+crypto.randomUUID(), createdAt:now, updatedAt:now, name:"Local fixture", theme:"studio",
    view:{scale:2,panX:0,panY:0}, widgets:[], animations:[], textBoxes:[], images:[], tiles:[], preview:pixel };
}
function saveAndRead(server, value, version) {
  const payload = version === 1 ? value : {...server.v1ToCanvasBundle(value),id:value.id,createdAt:value.createdAt,updatedAt:value.updatedAt};
  server.saveSharedCanvas(payload);
  const saved = server.readSharedCanvas(value.id);
  return saved.version === 1 ? saved : server.canvasBundleToV1(saved);
}

for (const version of [1,2]) for (const size of [1,40,79,80]) test(`v${version} saves and reopens a ${size}-unit image frame`, t => {
  const server = harness(t), value = snapshot();
  value.images = [{id:"image-1",x:10,y:10,w:size,h:size,naturalW:80,naturalH:80,data:pixel}];
  const restored = saveAndRead(server,value,version).images[0];
  assert.deepEqual([restored.w,restored.h,restored.naturalW,restored.naturalH],[size,size,80,80]);
  assert.equal(restored.data,pixel);
});
test("small-image support retains geometry, raster and data validation", t => {
  const server = harness(t), base = {id:"image-1",x:10,y:10,w:40,h:40,naturalW:80,naturalH:80,data:pixel};
  for (const change of [{w:0},{h:-1},{w:0.5},{x:-1},{x:19990},{y:19990},{w:Infinity},{naturalW:0},{naturalW:2049},{naturalH:2049},{data:"invalid"},{data:"data:text/plain;base64,eA=="}]) {
    const value = snapshot(); value.images = [{...base,...change}];
    assert.equal(server.canonicalSharedCanvasV1(value),null,JSON.stringify(change));
    assert.throws(()=>server.saveSharedCanvas(value),error=>error.status===400);
  }
});
