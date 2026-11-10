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

for (const version of [1, 2]) for (const axis of ["x", "y"]) for (const fractional of [false, true]) {
  test(`v${version} reopens a ${fractional ? "fractional" : "integer"} image at the ${axis} boundary`, t => {
    const server = harness(t), value = snapshot(), size = fractional ? 80.5 : 80;
    value.images = [{ id:"image-1", x:axis === "x" ? 20000 - size : 100,
      y:axis === "y" ? 20000 - size : 100, w:size, h:size,
      naturalW:80, naturalH:80, data:pixel }];
    const restored = saveAndRead(server, value, version).images[0];
    assert.ok(restored.x >= 0 && restored.y >= 0);
    assert.ok(restored.x + restored.w <= 20000 && restored.y + restored.h <= 20000);
    assert.equal(restored.data, pixel);
  });
}

test("client image restore retains an accepted fractional boundary frame", () => {
  const clientSource = fs.readFileSync(path.join(__dirname, "../src/client/app/canvas-runtime.js"), "utf8");
  const start = clientSource.indexOf("  function imageRecord("), end = clientSource.indexOf("\n  }", start) + 4;
  const client = vm.createContext({ Blob, state:{nextImageId:1}, SIZE:20000,
    MAX_IMAGE_SOURCE_BYTES:32*1024*1024, MAX_IMAGE_DIMENSION:2048, MAX_IMAGE_PIXELS:16*1024*1024,
    n:(value,min=0,max=20000)=>Number.isFinite(value)&&value>=min&&value<=max });
  vm.runInContext(clientSource.slice(start,end), client);
  for (const fractional of [false, true]) {
    const size = fractional ? 80.5 : 80;
    const restored = client.imageRecord({ x:20000-size, y:20000-size, w:size, h:size,
      naturalW:80, naturalH:80, image:{width:80,height:80},
      blob:new Blob([Buffer.from(pixel.split(",")[1],"base64")],{type:"image/png"}) });
    assert.ok(restored);
    assert.ok(restored.x + restored.w <= 20000 && restored.y + restored.h <= 20000);
  }
});
