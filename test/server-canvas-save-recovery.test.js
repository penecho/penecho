"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const source = fs.readFileSync(path.join(__dirname, "../src/server/main.js"), "utf8");
function extract(name) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf("\nfunction ", start + 1);
  assert.ok(start >= 0, name); return source.slice(start, end < 0 ? undefined : end);
}
function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-roundtrip-"));
  const events = [];
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  const context = vm.createContext({ fs, path, crypto, Buffer, process, CANVAS_SIZE:20000, SHARED_CANVAS_DIRECTORY:directory,
    CANVAS_SNAPSHOT_ID_PATTERN:/^\d{10,16}-[a-zA-Z0-9-]{8,64}$/, MAX_SHARED_CANVAS_BYTES:96*1024*1024,
    DEFAULT_CANVAS_PROJECT_ID:"uncategorized", normalizeCanvasTheme:value=>value, sharedCanvasProject:()=>true,
    events, log:entry=>events.push(entry) });
  for (const name of ["canvasSnapshotPath", "atomicJsonWrite", "sharedCanvasMetadata", "validCanvasDocumentId", "validSnapshotDataUrl", "canonicalSharedCanvasV1", "plainObject", "bundleDataUrl", "dataUrlParts", "canvasBundleAssetKey", "canvasBundleToV1", "v1ToCanvasBundle", "sharedCanvasLogicalSnapshot", "canonicalSharedCanvas", "canonicalSharedCanvasMetadata", "sharedCanvasFiles", "listSharedCanvases", "readSharedCanvas", "saveSharedCanvas"])
    vm.runInContext(extract(name), context);
  return context;
}
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABEElEQVR4nO3UsQkAMBDDwN9/aWWIFELg4nphPrk7GD422ID8bbAB2YBnfkO7QDbg7QLpvgQ9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gDg9gLQHKjvQ4BzHEKAAAAAASUVORK5CYII=';
function snapshot() {
  const now = Date.now();
  return { version:1, id:now+"-"+crypto.randomUUID(), createdAt:now, updatedAt:now, name:"Local fixture", theme:"studio",
    view:{scale:2,panX:0,panY:0}, widgets:[], animations:[], textBoxes:[], images:[], tiles:[], preview:pixel };
}
function payload(server, value, version) {
  return version === 1 ? value : {...server.v1ToCanvasBundle(value),id:value.id,name:value.name,createdAt:value.createdAt,updatedAt:value.updatedAt};
}
function pair(server, id) {
  const content=server.canvasSnapshotPath(id), metadata=server.canvasSnapshotPath(id,true);
  return {content:fs.readFileSync(content),metadata:fs.readFileSync(metadata),
    read:JSON.stringify(server.readSharedCanvas(id)),list:JSON.stringify(server.listSharedCanvases())};
}
function samePair(actual, expected) {
  assert.deepEqual(actual.content,expected.content);
  assert.deepEqual(actual.metadata,expected.metadata);
  assert.equal(actual.read,expected.read);
  assert.equal(actual.list,expected.list);
}
function fixtures(server, version) {
  const old=snapshot();old.name="Previous name";
  old.textBoxes=[{id:"text-box-1",text:"Previous text",x:100,y:100,w:240,h:40,maxWidth:240,fontSize:20,color:"#111111"}];
  server.saveSharedCanvas(payload(server,old,version));
  const next=structuredClone(old);next.name="New name";next.textBoxes[0].text="New text";next.updatedAt++;
  return {old,next,before:pair(server,old.id)};
}
function recoveryFiles(server,id) {
  return fs.readdirSync(path.dirname(server.canvasSnapshotPath(id))).filter(name=>name.startsWith(`${id}.json.`)&&name.endsWith(".recovery"));
}
function fault(server, overrides) {
  server.fs=Object.assign(Object.create(fs),overrides);
}

for (const version of [1,2]) test(`v${version} normal overwrite updates content and metadata without recovery debris`,t=>{
  const server=harness(t),{old,next}=fixtures(server,version);
  server.saveSharedCanvas(payload(server,next,version),old.id);
  const read=server.readSharedCanvas(old.id);
  assert.equal(read.name,"New name");
  assert.equal((version===1?read:server.canvasBundleToV1(read)).textBoxes[0].text,"New text");
  assert.equal(server.listSharedCanvases()[0].name,"New name");
  assert.deepEqual(recoveryFiles(server,old.id),[]);
});

for (const version of [1,2]) test(`v${version} metadata replacement failure restores exact previous content and permits retry`,t=>{
  const server=harness(t),{old,next,before}=fixtures(server,version);
  fault(server,{renameSync(from,to){if(to.endsWith(".meta.json"))throw Object.assign(Error("synthetic metadata failure"),{code:"ENOSPC"});return fs.renameSync(from,to);}});
  assert.throws(()=>server.saveSharedCanvas(payload(server,next,version),old.id),/synthetic metadata failure/);
  server.fs=fs;samePair(pair(server,old.id),before);
  assert.deepEqual(recoveryFiles(server,old.id),[]);
  server.saveSharedCanvas(payload(server,next,version),old.id);
  assert.equal(server.readSharedCanvas(old.id).name,"New name");
  assert.deepEqual(recoveryFiles(server,old.id),[]);
});

test("content replacement failure keeps the previous pair and removes staging",t=>{
  const server=harness(t),{old,next,before}=fixtures(server,1);
  fault(server,{renameSync(from,to){if(to===server.canvasSnapshotPath(old.id))throw Error("synthetic content failure");return fs.renameSync(from,to);}});
  assert.throws(()=>server.saveSharedCanvas(next,old.id),/synthetic content failure/);
  server.fs=fs;samePair(pair(server,old.id),before);
  assert.deepEqual(recoveryFiles(server,old.id),[]);
});

test("failed recovery-copy preparation leaves the previous pair untouched",t=>{
  const server=harness(t),{old,next,before}=fixtures(server,1);
  fault(server,{copyFileSync(_from,to){fs.writeFileSync(to,"partial copy");throw Object.assign(Error("synthetic copy failure"),{code:"ENOSPC"});}});
  assert.throws(()=>server.saveSharedCanvas(next,old.id),/synthetic copy failure/);
  server.fs=fs;samePair(pair(server,old.id),before);
  assert.deepEqual(recoveryFiles(server,old.id),[]);
});

test("metadata staging failure restores the old pair",t=>{
  const server=harness(t),{old,next,before}=fixtures(server,1);
  fault(server,{writeFileSync(file,value,options){
    if(file.includes(".meta.json.")&&file.endsWith(".tmp"))throw Object.assign(Error("synthetic metadata staging failure"),{code:"ENOSPC"});
    return fs.writeFileSync(file,value,options);
  }});
  assert.throws(()=>server.saveSharedCanvas(next,old.id),/synthetic metadata staging failure/);
  server.fs=fs;samePair(pair(server,old.id),before);
  assert.deepEqual(recoveryFiles(server,old.id),[]);
});

test("oversized existing content is rejected before any recovery copy",t=>{
  const server=harness(t),{old,next,before}=fixtures(server,1),content=server.canvasSnapshotPath(old.id);
  fault(server,{statSync(file){
    const stat=fs.statSync(file);
    return file===content?{isFile:()=>true,size:96*1024*1024+1}:stat;
  },copyFileSync(){assert.fail("oversized old content must not be copied");}});
  assert.throws(()=>server.saveSharedCanvas(next,old.id),error=>error.status===500);
  server.fs=fs;samePair(pair(server,old.id),before);
});

test("failed rollback reports incomplete recovery and retains the old content copy",t=>{
  const server=harness(t),{old,next,before}=fixtures(server,1),content=server.canvasSnapshotPath(old.id);
  fault(server,{renameSync(from,to){
    if(to.endsWith(".meta.json"))throw Error("synthetic metadata failure");
    if(to===content&&from.endsWith(".recovery"))throw Error("synthetic rollback failure");
    return fs.renameSync(from,to);
  }});
  assert.throws(()=>server.saveSharedCanvas(next,old.id),error=>error.code==="CANVAS_RECOVERY_REQUIRED"&&error.status===500);
  server.fs=fs;
  const copies=recoveryFiles(server,old.id);
  assert.equal(copies.length,1);
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(content),copies[0])),before.content);
  assert.deepEqual(fs.readFileSync(server.canvasSnapshotPath(old.id,true)),before.metadata);
  assert.equal(server.listSharedCanvases()[0].name,"Previous name");
  assert.ok(server.events.some(event=>event.canvasId===old.id));
});

test("recovery-copy cleanup failure does not turn a committed save into failure",t=>{
  const server=harness(t),{old,next}=fixtures(server,1);
  fault(server,{unlinkSync(file){if(file.endsWith(".recovery"))throw Error("synthetic cleanup failure");return fs.unlinkSync(file);}});
  assert.doesNotThrow(()=>server.saveSharedCanvas(next,old.id));
  server.fs=fs;
  assert.equal(server.readSharedCanvas(old.id).name,"New name");
  assert.equal(server.listSharedCanvases()[0].name,"New name");
  assert.ok(server.events.some(event=>event.canvasId===old.id));
  assert.equal(recoveryFiles(server,old.id).length,1);
});

test("new save metadata failure leaves no readable or listed half-save",t=>{
  const server=harness(t),value=snapshot();
  fault(server,{renameSync(from,to){if(to.endsWith(".meta.json"))throw Error("synthetic metadata failure");return fs.renameSync(from,to);}});
  assert.throws(()=>server.saveSharedCanvas(value),/synthetic metadata failure/);
  server.fs=fs;
  assert.equal(fs.existsSync(server.canvasSnapshotPath(value.id)),false);
  assert.equal(fs.existsSync(server.canvasSnapshotPath(value.id,true)),false);
  assert.deepEqual(JSON.parse(JSON.stringify(server.listSharedCanvases())),[]);
});

test("invalid overwrite input does not touch either existing file",t=>{
  const server=harness(t),{old,next,before}=fixtures(server,1);
  next.images=[{id:"invalid",x:0,y:0,w:80,h:80,naturalW:80,naturalH:80,data:pixel}];
  assert.throws(()=>server.saveSharedCanvas(next,old.id),error=>error.status===400);
  samePair(pair(server,old.id),before);
});
