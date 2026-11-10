"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("Codex Native adds the explicit Code Mode capture consumption contract at the host boundary", async () => {
  const {
    CodexNativeHost,
    addCodexNativeCaptureContract,
  } = await import("../src/server/canvas-agent/codex-native-host.mjs");
  const dynamicTools = [{
    type:"namespace",
    name:"penecho",
    description:"namespace",
    tools:[
      { type:"function", name:"canvas_capture", description:"Capture evidence.", inputSchema:{ type:"object" } },
      { type:"function", name:"canvas_inspect", description:"Inspect state.", inputSchema:{ type:"object" } },
    ],
  }];
  const wrapped = addCodexNativeCaptureContract(dynamicTools);
  assert.notEqual(wrapped, dynamicTools);
  assert.notEqual(wrapped[0], dynamicTools[0]);
  assert.equal(wrapped[0].tools[1], dynamicTools[0].tools[1]);
  const description = wrapped[0].tools[0].description;
  assert.match(description, /tools\.penecho__canvas_capture/);
  assert.match(description, /nested result string/);
  assert.match(description, /raw\?\.imageUrl/);
  assert.match(description, /raw\?\.attachment\?\.dataUrl/);
  assert.match(description, /text\(typeof metadata/);
  assert.match(description, /image\(imageUrl\)/);
  assert.match(description, /Do not inspect r\.content/);
  assert.match(description, /text\(raw\)/);
  assert.match(description, /data:image\/(?:png|webp)/);
  assert.equal(addCodexNativeCaptureContract(wrapped)[0].tools[0].description, description);

  const host = Object.create(CodexNativeHost.prototype);
  const fromHost = host.nativeTools({ native:{ dynamicTools:() => dynamicTools } });
  assert.equal(fromHost[0].tools[0].description, description);
});

test("Codex Native forwards one fresh capture image and no image for a reused active capture", async () => {
  const { nativeToolContentItems } = await import("../src/server/canvas-agent/codex-native-host.mjs");
  const attachment = { attachmentId:"capture-1", mediaType:"image/png" };
  const reads = [];
  const readImageRequest = async (ref) => {
    reads.push(ref.attachmentId);
    return { mediaType:"image/png", data:Buffer.from([1, 2, 3]) };
  };
  const fresh = await nativeToolContentItems({
    name:"canvas_capture",
    value:{ attachment, reusedActiveImage:false },
    renderedBlocks:[
      { type:"text", text:'{"width":1,"height":1}' },
      { type:"image", attachment },
    ],
    readImageRequest,
    imagePolicy:{ maxBytes:100 },
  });
  assert.equal(fresh.filter(item => item.type === "inputImage").length, 1);
  assert.equal(fresh.filter(item => item.type === "inputText").length, 1);
  assert.deepEqual(reads, ["capture-1"]);
  assert.match(fresh.find(item => item.type === "inputImage").imageUrl, /^data:image\/png;base64,/);

  reads.length = 0;
  const reused = await nativeToolContentItems({
    name:"canvas_capture",
    value:{ attachment, reusedActiveImage:true },
    renderedBlocks:[{ type:"text", text:'{"width":1,"height":1,"cacheHit":true}' }],
    readImageRequest,
    imagePolicy:{ maxBytes:100 },
  });
  assert.equal(reused.filter(item => item.type === "inputImage").length, 0);
  assert.equal(reused.filter(item => item.type === "inputText").length, 1);
  assert.deepEqual(reads, []);

  const directFallback = await nativeToolContentItems({
    name:"canvas_capture",
    value:{ attachment, reusedActiveImage:false },
    renderedBlocks:[{ type:"text", text:"metadata only" }],
    readImageRequest,
    imagePolicy:{ maxBytes:100 },
  });
  assert.equal(directFallback.filter(item => item.type === "inputImage").length, 1);
  assert.deepEqual(reads, ["capture-1"]);
});

test("Codex Native removes capture metadata image payloads while preserving ordinary text", async () => {
  const {
    nativeToolContentItems,
    sanitizeCodexNativeCaptureMetadataText,
  } = await import("../src/server/canvas-agent/codex-native-host.mjs");
  const encoded = `data:image/webp;base64,${"A".repeat(2048)}`;
  const metadata = `width=1; note=keep this text; image=${encoded}; after=keep this too`;
  const sanitized = sanitizeCodexNativeCaptureMetadataText(metadata);
  assert.match(sanitized, /note=keep this text/);
  assert.match(sanitized, /after=keep this too/);
  assert.doesNotMatch(sanitized, /data:image\/webp;base64/);
  assert.match(sanitized, /\[image forwarded separately\]/);

  const capture = await nativeToolContentItems({
    name:"canvas_capture",
    value:{},
    renderedBlocks:[{ type:"text", text:metadata }],
    readImageRequest:async () => ({ mediaType:"image/webp", data:Buffer.from([1]) }),
  });
  assert.equal(capture.length, 1);
  assert.equal(capture[0].text.includes("data:image/webp;base64"), false);
  assert.equal(capture[0].text.includes("keep this text"), true);

  const ordinaryTool = await nativeToolContentItems({
    name:"canvas_inspect",
    value:{},
    renderedBlocks:[{ type:"text", text:metadata }],
    readImageRequest:async () => ({ mediaType:"image/webp", data:Buffer.from([1]) }),
  });
  assert.equal(ordinaryTool[0].text.includes(encoded), true);
});
