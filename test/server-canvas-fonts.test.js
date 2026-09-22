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

const fonts = ["ui-rounded, system-ui, sans-serif", "Bradley Hand, Segoe Print, Comic Sans MS, cursive", "Georgia, serif", "system-ui, sans-serif"];
for (const version of [1,2]) test(`v${version} preserves supported typography through disk save and reopen`, t => {
  const server = harness(t);
  for (const fontFamily of fonts) {
    const value = snapshot();
    value.textBoxes = [{id:"text-box-1",x:20,y:20,w:240,h:40,maxWidth:240,fontSize:20,fontFamily,color:"#112233",text:"Local serif text"}];
    const restored = saveAndRead(server,value,version).textBoxes[0];
    assert.equal(restored.fontFamily,fontFamily);assert.equal(restored.text,"Local serif text");assert.equal(restored.color,"#112233");
  }
});
test("legacy handwriting is normalized and missing or unsupported families retain the default", t => {
  const server = harness(t);
  for (const fontFamily of [undefined,"", "Arial", "x".repeat(1000),42,"Segoe Print, Comic Sans MS, cursive"]) {
    const value = snapshot();
    value.textBoxes = [{id:"text-box-1",x:20,y:20,w:240,h:40,maxWidth:240,fontSize:20,fontFamily,color:"#112233",text:"Legacy text"}];
    const restored = saveAndRead(server,value,2).textBoxes[0];
    assert.equal(restored.fontFamily,fontFamily === "Segoe Print, Comic Sans MS, cursive" ? fonts[1] : undefined);
    assert.equal(restored.text,"Legacy text");
  }
});
