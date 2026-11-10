"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const NOTE = require("../public/note-card.js");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const cards = read("src/client/app/note-cards.js"), host = read("public/widget-host.js"), runtime = read("src/client/app/canvas-runtime.js");
function extract(source, name, indent = "  ", async = false) {
  const start = source.indexOf(`${indent}${async ? "async " : ""}function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf(`\n${indent}}`, start) + indent.length + 2;
  return source.slice(start, end);
}
test("higher resolution media survives source, document and independent library round trips", () => {
  const src = `data:image/png;base64,${"A".repeat(360000)}`;
  const note = NOTE.normalize({title:"Original handwriting", blocks:[{type:"ink", src, w:1760, h:1320}]});
  const copyText = NOTE.formatSource(note), html = NOTE.documentFor(note);
  assert.ok(copyText.length > 190000 && copyText.length <= NOTE.MAX_SOURCE_CHARS);
  assert.ok(html.length > 200000 && html.length <= NOTE.MAX_DOCUMENT_CHARS);
  assert.deepEqual(NOTE.parseSource(copyText).blocks[0], note.blocks[0]);
  const entry = NOTE.libraryEntry({id:"high-resolution",note});
  assert.equal(NOTE.libraryEntry(JSON.parse(JSON.stringify(entry))).note.blocks[0].src, src);
  assert.throws(() => NOTE.normalize({title:"Too large",blocks:[{type:"image",src:`data:image/png;base64,${"A".repeat(600000)}`}]}), /keep them under/);
});
test("the Canvas resolves only maximized Note image indices from its own trusted source", async () => {
  const calls = [], frame = {}, note = {blocks:[{type:"ink",src:"data:image/png;base64,AAAA"}]}, widget = {frame:{contentWindow:frame},maximized:true};
  const context = {state:{widgets:[widget]},location:{origin:"https://canvas.test"},noteCardWidget:()=>true,noteCardSource:()=>note,noteImageOpen:(...args)=>calls.push(args)};
  const handle = vm.runInNewContext(`(${extract(runtime,"handleWidgetMessage","  ",true)})`, context);
  await handle({source:frame,origin:"https://canvas.test",data:{type:"penecho-note-image-open",index:0,src:"https://untrusted.test/image"}});
  assert.deepEqual(calls, [[note,0]]);
  widget.maximized=false;
  await handle({source:frame,origin:"https://canvas.test",data:{type:"penecho-note-image-open",index:0}});
  widget.maximized=true;
  await handle({source:{},origin:"https://canvas.test",data:{type:"penecho-note-image-open",index:0}});
  await handle({source:frame,origin:"https://other.test",data:{type:"penecho-note-image-open",index:0}});
  assert.equal(calls.length,1);
});
test("host enables focus, click, Enter and Space only for maximized Note images", () => {
  const messages = [], attrs = new Map(), image = {setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)}, images = [image];
  let note=true;
  const widgetState = {maximized:true,interactive:true}, context = {widgetState,runtimeVersion:4,document:{documentElement:{lang:"zh-CN"},querySelector:()=>note?{}:null,querySelectorAll:()=>images},parent:{postMessage:m=>messages.push(m)}};
  const setup = vm.runInNewContext(`(${extract(host,"setNoteImageInteraction","    ")})`,context), open = vm.runInNewContext(`(${extract(host,"openNoteImage","    ")})`,context);
  setup(); assert.equal(attrs.get("role"),"button"); assert.equal(image.tabIndex,0); assert.match(image.title,/放大/);
  let prevented=0;
  for (const [type,key] of [["click",""],["keydown","Enter"],["keydown"," "]]) open({type,key,target:{closest:()=>image},preventDefault:()=>prevented++});
  assert.equal(messages.length,3); assert.equal(prevented,3);
  assert.ok(messages.every(m=>m.index===0 && m.runtimeVersion===4 && m.src===undefined));
  open({type:"keydown",key:"Escape",target:{closest:()=>image},preventDefault:()=>assert.fail()});
  widgetState.maximized=false; setup(); assert.equal(attrs.has("role"),false);
  open({type:"click",target:{closest:()=>image}});
  widgetState.maximized=true; widgetState.interactive=false; open({type:"click",target:{closest:()=>image}});
  widgetState.interactive=true; note=false; open({type:"click",target:{closest:()=>image}});
  assert.equal(messages.length,3);
});
test("invalid image indices cannot create a viewer", () => {
  const open = vm.runInNewContext(`(${extract(cards,"noteImageOpen")})`,{document:{querySelector:()=>assert.fail("No dialog should be accessed")}});
  for (const index of [-1,1,1.5,"0",NaN]) open({blocks:[{type:"ink",src:"data:image/png;base64,AAAA"}]},index);
});
