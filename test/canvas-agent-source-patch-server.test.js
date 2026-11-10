"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { widgetSourceHash } = require("../src/server/widget-patch.js");

const OLD_HTML = "<!doctype html>\n<main>\n  <h1>Old</h1>\n</main>\n";
const NEW_HTML = "<!doctype html>\n<main>\n  <h1>New</h1>\n</main>\n";
const PATCH = "--- a/widget.html\n+++ b/widget.html\n@@ -1,4 +1,4 @@\n <!doctype html>\n <main>\n-  <h1>Old</h1>\n+  <h1>New</h1>\n </main>\n";

function widgetEdit(overrides = {}) {
  return {
    mode:"replace",
    widgetType:"html_widget",
    pluginId:"general",
    title:"Existing Widget",
    instructionMode:"implicit-polish",
    box:{x:100,y:200,w:1200,h:700},
    refreshSeconds:0,
    html:OLD_HTML,
    sourceFormat:"penecho-visual-explorer+html",
    frameworkVersion:"penecho-visual-explorer/1",
    source:OLD_HTML,
    sourceMirrorsHtml:true,
    copyLabel:"",
    ...overrides,
  };
}

async function sourcePatchRuntime(current, rpcCalls) {
  const { createCanvasTools, freshCanvasAgentTurnBudget, freshVisualExplorerBudget } = await import("../src/server/canvas-agent/runtime.mjs");
  const visualExplorerBudget=freshVisualExplorerBudget();
  visualExplorerBudget.objectIds.add("widget-1");
  visualExplorerBudget.deliveryModes.set("widget-1","oneShot");
  const session={
    projectRuntimeDirectory:path.join(os.tmpdir(),"penecho-source-patch-test"),
    widgetCapabilities:{fingerprint:"test",professionalEnabled:false,privatePlugins:[]},
    generalHtmlContract:{hash:"a".repeat(64),document:"general"},
    professionalDiagramsContract:null,
    visualExplorerContract:{hash:"b".repeat(64),document:"visual"},
    visualSkillContracts:{},
    widgetContractsLoaded:new Set(),
    visualSkillsLoaded:new Set(),
    nextWidgetContractOrder:500,
    webSearch:{enabled:false},
    canvasTurnBudget:freshCanvasAgentTurnBudget(),
    canvasAgentTurnLimit:100,
    visualExplorerBudget,
    widgetPatchAttempts:new Map(),
    canvasLayoutReviewRequired:true,
    stateDigest:{revision:99,counts:{widgets:1},canvas:{contentBounds:{x:0,y:0,width:1200,height:700}}},
  };
  session.rpc=async(name,args)=>{
    rpcCalls.push({name,args});
    if(name==="canvas_internal_widget")return current;
    if(name==="canvas_internal_replace_widget")return {ok:true,revision:100,changeId:"source-change",sourceHash:"browser-authoritative-new-source"};
    throw new Error(`Unexpected browser tool ${name}`);
  };
  const tools=createCanvasTools(session,{saveImages:async()=>[]});
  const runtime={
    tools,
    tool(name) { return tools.find(tool=>tool.name===name)||null; },
    instructions() { return tools.map(tool=>tool.description).join("\n\n"); },
    turnAdditionalContext() { return []; },
  };
  return {runtime,session};
}

test("legacy kernel sourceHash dispatch preserves geometry, bypasses visual review, and returns bounded source receipts",async()=>{
  const edit=widgetEdit(), sourceHash=widgetSourceHash(edit), rpcCalls=[], {runtime}=await sourcePatchRuntime({
    revision:99,
    hash:"legacy-widget-hash",
    sourceHash,
    widgetEdit:edit,
  },rpcCalls);
  const result=await runtime.tool("canvas_patch_widget").execute({objectId:"widget-1",sourceHash,patch:PATCH},{callId:"source-patch",signal:new AbortController().signal});
  assert.deepEqual(rpcCalls.map(call=>call.name),["canvas_internal_widget","canvas_internal_replace_widget"]);
  const write=rpcCalls[1].args;
  assert.equal(write.expectedSourceHash,sourceHash);
  assert.equal(Object.hasOwn(write,"baseRevision"),false);
  assert.equal(Object.hasOwn(write,"expectedHash"),false);
  assert.deepEqual({x:write.command.x,y:write.command.y,w:write.command.w,h:write.command.h},edit.box);
  assert.equal(write.command.html,NEW_HTML);
  assert.deepEqual(result.changedResources,["widget.html"]);
  assert.deepEqual(result.appliedRanges,[{path:"widget.html",oldStart:1,oldLines:4,newStart:1,newLines:4}]);
  assert.equal(result.afterWindows.length,1);
  assert.match(result.afterWindows[0].content,/<h1>New<\/h1>/);
  assert.equal(result.newSourceHash,"browser-authoritative-new-source");
  assert.match(runtime.instructions(),/sourceHash[\s\S]*receipt\.newSourceHash[\s\S]*afterWindows/);
});

test("legacy kernel sourceHash conflict stops before replacement and baseRevision keeps the old dispatch",async()=>{
  const edit=widgetEdit({sourceFormat:"",frameworkVersion:""}), currentSourceHash=widgetSourceHash(edit), conflictCalls=[], {runtime:conflictRuntime}=await sourcePatchRuntime({
    revision:7,hash:"legacy-hash",sourceHash:currentSourceHash,widgetEdit:edit,
  },conflictCalls);
  await assert.rejects(
    conflictRuntime.tool("canvas_patch_widget").execute({objectId:"widget-1",sourceHash:"c".repeat(64),patch:PATCH},{callId:"conflict",signal:new AbortController().signal}),
    error=>error?.code==="SOURCE_CONFLICT",
  );
  assert.deepEqual(conflictCalls.map(call=>call.name),["canvas_internal_widget"]);

  const legacyCalls=[], {runtime:legacyRuntime}=await sourcePatchRuntime({revision:7,hash:"legacy-hash",widgetEdit:edit},legacyCalls);
  await legacyRuntime.tool("canvas_patch_widget").execute({objectId:"widget-1",baseRevision:7,patch:PATCH},{callId:"legacy",signal:new AbortController().signal});
  assert.equal(legacyCalls[1].args.baseRevision,7);
  assert.equal(legacyCalls[1].args.expectedHash,"legacy-hash");
  assert.equal(Object.hasOwn(legacyCalls[1].args,"expectedSourceHash"),false);
});

test("legacy kernel sourceHash dispatch accepts the browser fallback fingerprint as an opaque capability",async()=>{
  const edit=widgetEdit({sourceFormat:"",frameworkVersion:""}), sourceHash="fallback-widget-source-123", rpcCalls=[], {runtime}=await sourcePatchRuntime({
    revision:7,hash:"legacy-hash",sourceHash,widgetEdit:edit,
  },rpcCalls);
  await runtime.tool("canvas_patch_widget").execute({objectId:"widget-1",sourceHash,patch:PATCH},{callId:"fallback-source",signal:new AbortController().signal});
  assert.equal(rpcCalls[1].args.expectedSourceHash,sourceHash);
});

test("legacy kernel same-target patch tracing does not impose the removed twenty-attempt terminal stop",async()=>{
  const edit=widgetEdit({sourceFormat:"",frameworkVersion:""}), rpcCalls=[], {runtime,session}=await sourcePatchRuntime({revision:7,hash:"legacy-hash",widgetEdit:edit},rpcCalls);
  session.widgetPatchAttempts.set("widget-1\u0000",{attempt:20,lastError:{code:"OLD_FAILURE",message:"retry"}});
  const result=await runtime.tool("canvas_patch_widget").execute({objectId:"widget-1",baseRevision:7,patch:PATCH},{callId:"attempt-21",signal:new AbortController().signal});
  assert.equal(result.ok,true);
  assert.equal(session.widgetPatchAttempts.get("widget-1\u0000").attempt,21);
});

test("native guidance is read on demand from the shared source without the old loader",async()=>{
  const edit=widgetEdit(), rpcCalls=[], {runtime,session}=await sourcePatchRuntime({revision:1,hash:"legacy",sourceHash:widgetSourceHash(edit),widgetEdit:edit},rpcCalls);
  const { createCanvasAgentNativeRuntime } = await import("../src/server/canvas-agent/runtime.mjs");
  const native=await createCanvasAgentNativeRuntime({attachments:{saveImages:async()=>[]},session});
  const { getAuthoringGuidance } = require("../src/server/mcp/authoring-guidance.js");
  const expected=getAuthoringGuidance("general-html"), exec={callId:"guidance",signal:new AbortController().signal};
  const first=await native.tool("penecho_get_guidance").execute({id:"general-html"},exec);
  assert.deepEqual(first,expected);
  const repeated=await native.tool("penecho_get_guidance").execute({id:"general-html"},{...exec,callId:"guidance-again"});
  assert.deepEqual(repeated,expected);
  assert.equal(native.tool("load_widget_contract"),null);
  assert.equal(rpcCalls.length,0,"guidance is read from the shared source without a browser RPC");
});
