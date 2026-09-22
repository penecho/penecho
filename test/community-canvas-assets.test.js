"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const source = fs.readFileSync(path.join(__dirname, "../src/client/app/persistence.js"), "utf8");

function declaration(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  const rest = source.slice(start), end = rest.indexOf("\n  }") + 4;
  return rest.slice(0, end);
}

function harness(assets, html) {
  const widget = { id:"widget-1", pluginId:"general", html };
  const context = vm.createContext({
    Blob, crypto:crypto.webcrypto, SIZE:20000, TILE:512, SERVER_DEFAULT_PROJECT_ID:"uncategorized",
    state:{ images:[], textBoxes:[], preservedSnapshotAnimations:[], animations:[], currentSnapshotPreservedAssets:assets,
      currentSnapshotBundleExtensions:{}, currentSnapshotManifestExtensions:{}, theme:"light", scale:1, panX:0, panY:0 },
    tiles:new Map(), selectionAIBusy:()=>false, finalizeCanvasForSnapshot:async()=>{}, prepareVisibleWidgetSnapshots:async()=>{},
    pluginEnabled:()=>true, visibleWidgets:()=>[widget], snapshotPreview:()=>({width:10,height:10}),
    communityImagesForCanvas:async()=>({}), serializedAnimations:()=>[], serializedWidgets:()=>[widget],
    storedTextBoxes:()=>[], storedImages:()=>[], snapshotPreviewBlob:async()=>new Blob(["preview"],{type:"image/png"}),
    blobDataUrl:async blob=>`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`,
    dataUrlBlob:value=>{ const [header,data]=value.split(",");return new Blob([Buffer.from(data,"base64")],{type:header.slice(5,-7)}); },
  });
  for (const name of ["snapshotExtensionObject", "snapshotPreservedAssets", "snapshotCanvasObjectExtensions", "snapshotBundleAsset", "snapshotBundleAssetBlob", "serverSnapshotPayload", "communityCanvasArtifact", "readSnapshotBundle"])
    vm.runInContext(declaration(name), context);
  return context;
}

test("community Canvas images and extension assets survive bundle sharing and reopening", async () => {
  const id = "a".repeat(64), assets = [
    { kind:"resource", contentType:"image/png", metadata:{resourceType:"image-attachment",resourceId:id}, dataBase64:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6KsAAAAAASUVORK5CYII=" },
    { kind:"attachment", contentType:"text/plain", metadata:{id:"notes"}, dataBase64:Buffer.from("Diagram notes").toString("base64") },
  ];
  const before = JSON.stringify(assets), html = `<img src="penecho-asset:${id}">`, context = harness(assets, html);
  const shared = await context.communityCanvasArtifact("Diagram"), reopened = await context.readSnapshotBundle(shared);
  assert.equal(JSON.stringify(reopened.item.preservedAssets), before);
  assert.equal(reopened.item.widgets[0].html, html);
  assert.ok(reopened.item.preservedAssets.some(asset=>html.includes(`penecho-asset:${asset.metadata.resourceId}`)));
  assert.equal(JSON.stringify(assets), before, "sharing does not mutate the live assets");
  const savedAgain = await context.serverSnapshotPayload(reopened.item, reopened.tileEntries);
  const reloadedAgain = await context.readSnapshotBundle(savedAgain);
  assert.equal(JSON.stringify(reloadedAgain.item.preservedAssets), before);
});

test("sharing a legacy Canvas without preserved assets adds no resource placeholders", async () => {
  const context = harness(undefined, "<main>Plain diagram</main>");
  const shared = await context.communityCanvasArtifact("Legacy");
  assert.equal(shared.assets.filter(asset=>asset.kind==="resource"||asset.kind==="attachment").length, 0);
  const reopened = await context.readSnapshotBundle(shared);
  assert.equal(reopened.item.widgets[0].html, "<main>Plain diagram</main>");
  assert.equal(reopened.item.preservedAssets.length, 0);
});
