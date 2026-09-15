"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const sharp = require("sharp");
const { communityMetadataInput, communityMetadataFromModel, communityMetadataPrompt } = require("../src/server/community-metadata.js");
const { imageDataUrlParts, completeTopLevelJsonObjects } = require("../src/server/model-content.js");

test("shared metadata validation accepts bounded WebP thumbnails and rejects mismatched or oversized previews", async () => {
  for (const lossless of [false, true]) {
    const data = await sharp({ create:{ width:96, height:64, channels:3, background:"white" } }).webp({ lossless }).toBuffer();
    const preview = { contentType:"image/webp", dataBase64:data.toString("base64"), width:96, height:64 };
    for (const kind of ["widget", "canvas"]) {
      const input = communityMetadataInput({ kind, preview, language:"zh", current:{ name:"  Draft  ", category:"learning", tags:[null, "  diagram  "] } });
      assert.equal(input.current.name, "Draft");
      assert.deepEqual(input.current.tags, ["diagram"]);
      assert.deepEqual(input.preview, preview);
      assert.match(communityMetadataPrompt(input), /Prepare Simplified Chinese metadata/);
      assert.equal(communityMetadataInput({ kind, preview:{ ...preview, width:97 } }), null);
    }
  }
  const data = await sharp({ create:{ width:1201, height:1, channels:3, background:"white" } }).webp().toBuffer();
  assert.equal(communityMetadataInput({ kind:"canvas", preview:{ contentType:"image/webp", dataBase64:data.toString("base64"), width:1201, height:1 } }), null);
  assert.equal(communityMetadataInput({ kind:"widget", preview:{ contentType:"image/webp", dataBase64:"invalid" } }), null);
});

test("metadata output accepts fenced JSON, normalizes tags and keeps optional continuation empty", () => {
  const output = { name:"  Diagram  ", description:"One useful\n  explanation.", category:"LEARNING", tags:["Diagram", "diagram", "中文", "<script>", null] };
  assert.deepEqual(communityMetadataFromModel(`\`\`\`json\n${JSON.stringify(output)}\n\`\`\``), {
    name:"Diagram", description:"One useful explanation.", category:"learning", tags:["Diagram", "中文"], continuationPrompt:"",
  });
  for (const change of [{ name:"" }, { description:"" }, { category:"invalid" }, { tags:"tag" }]) {
    assert.throws(() => communityMetadataFromModel(JSON.stringify({ ...output, ...change })), /valid community metadata/);
  }
});

test("shared model content parsing preserves image types and complete nested JSON with quoted braces", () => {
  const expected = { intent:"answer", commands:[{ text:'Keep { this } and "quotes"' }] };
  assert.deepEqual(completeTopLevelJsonObjects(`prefix {}\n${JSON.stringify(expected)}\n{"unfinished":`), [{}, expected]);
  for (const type of ["png", "webp"]) {
    const image = imageDataUrlParts(`data:image/${type};base64,YWJj`);
    assert.equal(image.mimeType, `image/${type}`);
    assert.equal(image.file, `atlas.${type}`);
    assert.equal(image.buffer.toString(), "abc");
  }
  for (const value of ["https://example.com/image.png", "data:image/svg+xml;base64,YWJj", "data:image/png;base64,<invalid>"]) assert.equal(imageDataUrlParts(value), null);
});
