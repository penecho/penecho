"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const SMART = require("../public/smart-suggest.js"),
  source = fs.readFileSync(require.resolve("../src/client/app/persistence.js"), "utf8"),
  start = source.indexOf("  async function exportSelectionPng("), end = source.indexOf("  function imageFromBlob(", start);

function harness() {
  const selection = { phase:"active", box:{x:100,y:200,w:300,h:200}, path:[{x:100,y:200},{x:400,y:200},{x:100,y:400}] },
    target = { selection, selectionKey:"selection:1" }, button = {disabled:false}, calls = [],
    canvas = {width:450,height:300}, link = {click:()=>calls.push("download"),remove(){}},
    context = { documentId:"one", activeTarget:target, selectionPathFor:s=>s.path,
      assistSelectionTargetValid:t=>t===context.activeTarget && t.selectionKey==="selection:1",
      canvasDocumentsCurrent:()=>({id:context.documentId}),
      renderExportCanvas:async(s,assertCurrent)=>{assert.equal(s,selection);assertCurrent();return canvas;},
      canvasBlob:async()=>({}),URL:{createObjectURL:()=>"blob:selection",revokeObjectURL:()=>calls.push("revoke")},
      document:{createElement:()=>link,body:{append(){}}}, exportFilename:()=>"penecho-20261004-120000.png",
      setTimeout:fn=>{fn();},setStatusKey:key=>calls.push(key),setStatus:message=>calls.push(message),t:key=>key };
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  return {context,selection,target,button,calls,canvas,link};
}

test("Download image stays outside the LLM action space, local ranking and remote answers", () => {
  assert.equal(SMART.actionById("download"),null);
  const answers = {action:{type:"choice",choice:"download",probabilities:{download:1}}};
  for (const selection of [false,true]) {
    assert.equal(SMART.buildQuestions({selection}).action.criteria.download,undefined);
    const local = SMART.localPredict({selection});
    for (const view of [SMART.rankActions({local,answers}),SMART.rankResultActions(answers)])
      assert.ok([...view.items,...view.more].every(item=>item.id!=="download"));
  }
});

test("selection download uses a PNG filename, preserves its target and releases resources", async () => {
  const h = harness(), before = JSON.stringify(h.target);
  assert.equal(await h.context.exportSelectionPng(h.target,h.button),true);
  assert.equal(h.link.href,"blob:selection");
  assert.equal(h.link.download,"penecho-selection-20261004-120000.png");
  assert.equal(JSON.stringify({...h.target,selection:{...h.selection,downloadBusy:undefined}}),before);
  assert.equal(h.canvas.width,1); assert.equal(h.canvas.height,1);
  assert.equal(h.button.disabled,false); assert.equal(h.selection.downloadBusy,false);
  assert.deepEqual(h.calls,["download","revoke","exportComplete"]);
});

test("pending downloads reject duplicate clicks and release the button after encoding failure", async () => {
  const h = harness(); let reject;
  h.context.canvasBlob = () => new Promise((_,fail)=>{reject=fail;});
  const pending = h.context.exportSelectionPng(h.target,h.button);
  await Promise.resolve();
  assert.equal(h.button.disabled,true);
  assert.equal(await h.context.exportSelectionPng(h.target),false);
  reject(Error("PNG encoding failed"));
  assert.equal(await pending,false);
  assert.equal(h.button.disabled,false); assert.equal(h.selection.downloadBusy,false);
  assert.equal(h.calls.includes("download"),false);
});

test("cancelled, moved, resized or replaced selections and switched documents cannot download stale pixels", async () => {
  for (const change of [h=>h.context.activeTarget=null,h=>h.selection.box.x++,h=>h.selection.box.w++,
    h=>h.selection.path[0].y++,h=>h.context.activeTarget={...h.target},h=>h.context.documentId="two",h=>h.target.selectionKey="selection:2"]) {
    for (const stage of ["snapshot","encoding"]) {
      const h = harness();
      if (stage==="snapshot") h.context.renderExportCanvas = async(s,assertCurrent)=>{change(h);assertCurrent();return h.canvas;};
      else h.context.canvasBlob = async()=>{change(h);return {};};
      assert.equal(await h.context.exportSelectionPng(h.target,h.button),false,stage);
      assert.equal(h.calls.includes("download"),false,stage);
      assert.equal(h.button.disabled,false); assert.equal(h.selection.downloadBusy,false);
    }
  }
});
