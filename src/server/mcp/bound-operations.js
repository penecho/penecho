"use strict";

const crypto = require("node:crypto");
const { validateCanvasFilePatch, applyCanvasFilePatch } = require("../../shared/canvas-file-patch.js");
const { MAX_FILE_BYTES, McpBridgeError, validateToolArguments, MUTATION_TOOLS } = require("./schema.js");

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const MAX_FEEDBACK_CAPTURE_BYTES = 700 * 1024;
const MAX_FEEDBACK_CAPTURE_EDGE = 1024;
const MAX_FEEDBACK_CAPTURE_PIXELS = 520_000;
const INSPECT_CAPTURE_POLICIES = Object.freeze({
  basic:Object.freeze({maxLongEdge:1_024,maxPixels:520_000,maxBytes:700 * 1_024}),
  detail:Object.freeze({maxLongEdge:1_440,maxPixels:1_800_000,maxBytes:1_200 * 1_024}),
});
const MAX_MUTATION_REQUESTS = 32;
const MAX_UNRESOLVED_PATCHES = 4;

function bridgeError(code, message, status = 400) { return new McpBridgeError(code, message, status); }

function safeString(value, max, label) {
  if (typeof value !== "string" || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw bridgeError("invalid_browser_message", `${label} is invalid.`, 400);
  return value;
}

function safeJsonValue(value, label, maximumBytes = MAX_FILE_BYTES) {
  try {
    const json = JSON.stringify(value);
    if (!json || Buffer.byteLength(json, "utf8") > maximumBytes) throw new Error();
    return JSON.parse(json);
  } catch { throw bridgeError("invalid_browser_result", `The PenEcho canvas returned an invalid or oversized ${label}.`, 502); }
}

function browserSessionProgress(value) {
  const progress = safeJsonValue(value, "session progress", 1_048_576);
  const invalid = () => { throw bridgeError("invalid_browser_result", "The PenEcho canvas returned invalid session progress.", 502); };
  const string = (value, maximum, empty = false) => typeof value === "string" && value.length <= maximum && (empty || value.length > 0);
  if (!progress || typeof progress !== "object" || Array.isArray(progress)
    || !string(progress.title, 120, true) || !string(progress.summary, 4000, true)
    || !["working", "waiting", "done", "error"].includes(progress.status)
    || !Array.isArray(progress.steps) || progress.steps.length > 24
    || !Array.isArray(progress.events) || progress.events.length > 40) invalid();
  const steps = progress.steps.map(step => {
    if (!step || !string(step.id, 128) || !string(step.label, 160)
      || step.status !== undefined && !["pending", "working", "done", "error"].includes(step.status)) invalid();
    return {id:step.id,label:step.label,...(step.status === undefined ? {} : {status:step.status})};
  });
  const events = progress.events.map(event => {
    if (!event || !string(event.id, 128) || !string(event.text, 4000)
      || event.kind !== undefined && !["progress", "evidence", "info", "warning", "error"].includes(event.kind)) invalid();
    return {id:event.id,text:event.text,...(event.kind === undefined ? {} : {kind:event.kind})};
  });
  return {title:progress.title,status:progress.status,summary:progress.summary,steps,events};
}

function publicVirtualResult(value, label) {
  const cloned = safeJsonValue(value, label);
  const privatePathKeys = new Set(["absolutePath", "physicalPath", "hostPath", "filesystemPath", "localPath"]);
  const scrub = item => {
    if (Array.isArray(item)) return item.map(scrub);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).filter(([key]) => !privatePathKeys.has(key)).map(([key, nested]) => [key, scrub(nested)]));
  };
  return scrub(cloned);
}

function mutationSignature(args) {
  return crypto.createHash("sha256").update(JSON.stringify(args)).digest("hex");
}

function sharedPatchCall(fn,...args) {
  try{return fn(...args);}catch(error){throw bridgeError(error.code||"invalid_patch",error.message,error.status||400);}
}
const patchVirtualFile = (...args)=>sharedPatchCall(applyCanvasFilePatch,...args);

function browserRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an invalid revision.", 502);
  return value;
}

function browserCursor(value, label = "feedback cursor") {
  if (!Number.isSafeInteger(value) || value < 0) throw bridgeError("invalid_browser_result", `The PenEcho canvas returned an invalid ${label}.`, 502);
  return value;
}

function browserObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bridgeError("invalid_browser_result", `The PenEcho canvas returned an invalid ${label}.`, 502);
  return value;
}

function browserMetadata(result) {
  const output = {};
  if (typeof result?.browserElapsedMs === "number" && Number.isFinite(result.browserElapsedMs) && result.browserElapsedMs >= 0 && result.browserElapsedMs <= 600_000) output.browserElapsedMs = result.browserElapsedMs;
  let remaining = 64 * 1024;
  for (const key of ["runtimeDiagnostics", "viewport", "capture", "mapping", "sourcePath", "contentHash", "completion", "completionFailure", "inboxSummary"]) {
    if (result?.[key] === undefined) continue;
    try {
      const json = JSON.stringify(result[key]);
      if (json && Buffer.byteLength(json, "utf8") <= remaining) {
        output[key] = JSON.parse(json);
        remaining -= Buffer.byteLength(json, "utf8");
      } else output.metadataTruncated = true;
    } catch { output.metadataTruncated = true; }
  }
  return output;
}

function browserArtifactResult(result, artifactId, kind) {
  browserObject(result, `${kind} result`);
  if (result.artifactId !== artifactId) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned a mismatched artifact.", 502);
  if (result.kind !== kind) throw bridgeError("invalid_browser_result", `The PenEcho canvas returned an invalid ${kind} artifact kind.`, 502);
  if (!Array.isArray(result.objectIds) || !result.objectIds.length || result.objectIds.length > 24) {
    throw bridgeError("invalid_browser_result", `The PenEcho canvas returned invalid ${kind} object ids.`, 502);
  }
  const objectIds = result.objectIds.map((value, index) => {
    if (typeof value !== "string" || !value || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
      throw bridgeError("invalid_browser_result", `The PenEcho canvas returned an invalid ${kind} object id at index ${index}.`, 502);
    }
    return value;
  });
  if (new Set(objectIds).size !== objectIds.length) throw bridgeError("invalid_browser_result", `The PenEcho canvas returned duplicate ${kind} object ids.`, 502);
  if (kind === "plot" && objectIds.length !== 1) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned more than one plot object.", 502);
  if (result.objectId !== undefined && result.objectId !== objectIds[0]) throw bridgeError("invalid_browser_result", `The PenEcho canvas returned a mismatched primary ${kind} object id.`, 502);
  return {
    artifactId,
    objectIds,
    objectId:objectIds[0],
    kind,
    revision:browserRevision(result.revision),
    feedbackCursor:browserCursor(result.feedbackCursor),
  };
}

function browserPrimitiveCaptureMetadata(result, image, artifactId) {
  if (result?.artifactId !== artifactId) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned a mismatched primitive capture artifact.", 502);
  const width = result?.width, height = result?.height;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw bridgeError("invalid_capture", "The PenEcho canvas returned invalid primitive screenshot dimensions.", 502);
  }
  if (width > MAX_FEEDBACK_CAPTURE_EDGE || height > MAX_FEEDBACK_CAPTURE_EDGE || width * height > MAX_FEEDBACK_CAPTURE_PIXELS) {
    throw bridgeError("capture_too_large", "The PenEcho primitive screenshot exceeds the safe image dimensions.", 413);
  }
  if (result.encodedBytes !== undefined && (!Number.isSafeInteger(result.encodedBytes) || result.encodedBytes !== image.bytes)) {
    throw bridgeError("invalid_capture", "The PenEcho canvas returned invalid primitive screenshot byte metadata.", 502);
  }
  return {
    width,
    height,
    ...(result.encodedBytes === undefined ? {} : { encodedBytes:result.encodedBytes }),
    ...(result.revision === undefined ? {} : { captureRevision:browserRevision(result.revision) }),
  };
}

function browserCanvasCaptureMetadata(result, image) {
  const width = result?.width, height = result?.height;
  if (!Number.isSafeInteger(width) || width <= 0 || width > 16_384 || !Number.isSafeInteger(height) || height <= 0 || height > 16_384) {
    throw bridgeError("invalid_capture", "The PenEcho canvas returned invalid Canvas screenshot dimensions.", 502);
  }
  if (!Number.isSafeInteger(result.encodedBytes) || result.encodedBytes <= 0 || result.encodedBytes !== image.bytes) {
    throw bridgeError("invalid_capture", "The PenEcho canvas returned invalid Canvas screenshot byte metadata.", 502);
  }
  return { width, height, encodedBytes:result.encodedBytes, revision:browserRevision(result.revision) };
}

function browserFeedbackBounds(value, label) {
  browserObject(value, label);
  const output = {};
  for (const key of ["x", "y", "w", "h"]) {
    const number = value[key];
    if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > 1_000_000_000 || (key === "w" || key === "h") && number < 0) {
      throw bridgeError("invalid_browser_result", `The PenEcho canvas returned invalid ${label}.`, 502);
    }
    output[key] = number;
  }
  return output;
}

function browserFeedbackResult(result, sessionId, requestedAfter, limit) {
  browserObject(result, "feedback result");
  if (result.sessionId !== sessionId) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned mismatched feedback.", 502);
  const after = browserCursor(result.after, "feedback after cursor");
  if (requestedAfter !== undefined && after < requestedAfter) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned feedback from before the requested cursor.", 502);
  const nextCursor = browserCursor(result.nextCursor, "next feedback cursor");
  const latestCursor = browserCursor(result.latestCursor, "latest feedback cursor");
  if (nextCursor < after || nextCursor > latestCursor || typeof result.hasMore !== "boolean" || typeof result.truncated !== "boolean" || !Array.isArray(result.entries) || result.entries.length > limit) {
    throw bridgeError("invalid_browser_result", "The PenEcho canvas returned invalid bounded feedback.", 502);
  }
  if (result.hasMore !== (nextCursor < latestCursor)) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an inconsistent feedback continuation state.", 502);
  let previousCursor = after;
  const entries = result.entries.map((entry, index) => {
    browserObject(entry, `feedback entry ${index}`);
    const cursor = browserCursor(entry.cursor, `feedback entry ${index} cursor`);
    if (cursor <= previousCursor || cursor > nextCursor) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned feedback entries out of cursor order.", 502);
    previousCursor = cursor;
    if (!new Set(["text", "image", "stroke"]).has(entry.kind)) throw bridgeError("invalid_browser_result", `The PenEcho canvas returned an invalid feedback entry ${index}.`, 502);
    const output = {
      cursor,
      kind:entry.kind,
      bounds:browserFeedbackBounds(entry.bounds, `feedback entry ${index} bounds`),
      createdAt:browserCursor(entry.createdAt, `feedback entry ${index} timestamp`),
    };
    if (entry.objectId !== undefined) output.objectId = safeString(entry.objectId, 128, `feedback entry ${index} objectId`);
    if (entry.text !== undefined) {
      if (typeof entry.text !== "string" || entry.text.length > 4_000) throw bridgeError("invalid_browser_result", `The PenEcho canvas returned invalid feedback entry ${index} text.`, 502);
      output.text = entry.text;
    }
    if (entry.textTruncated !== undefined) {
      if (typeof entry.textTruncated !== "boolean") throw bridgeError("invalid_browser_result", `The PenEcho canvas returned invalid feedback entry ${index} truncation state.`, 502);
      output.textTruncated = entry.textTruncated;
    }
    return output;
  });
  if (entries.length && nextCursor !== entries.at(-1).cursor) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an invalid next feedback cursor.", 502);
  if (!entries.length && nextCursor !== after) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an invalid empty feedback cursor.", 502);
  const output = { sessionId, after, nextCursor, latestCursor, hasMore:result.hasMore, truncated:result.truncated, entries };
  if (result.visualContext !== undefined) {
    if (!["current-user-layer-regions", "current-canvas-with-nearby-design"].includes(result.visualContext)) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an invalid feedback visual context.", 502);
    output.visualContext = result.visualContext;
  }
  return output;
}

function browserFeedbackCaptureMetadata(result, image) {
  const width = result.width, height = result.height;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw bridgeError("invalid_capture", "The PenEcho canvas returned invalid feedback screenshot dimensions. Refresh the PenEcho Canvas and try again.", 502);
  }
  if (width > MAX_FEEDBACK_CAPTURE_EDGE || height > MAX_FEEDBACK_CAPTURE_EDGE || width * height > MAX_FEEDBACK_CAPTURE_PIXELS) {
    throw bridgeError("capture_too_large", "The PenEcho feedback screenshot exceeds the safe image dimensions.", 413);
  }
  const output = { width, height };
  if (result.encodedBytes !== undefined) {
    if (!Number.isSafeInteger(result.encodedBytes) || result.encodedBytes <= 0 || result.encodedBytes !== image.bytes) {
      throw bridgeError("invalid_capture", "The PenEcho canvas returned invalid feedback screenshot byte metadata. Refresh the PenEcho Canvas and try again.", 502);
    }
    output.encodedBytes = result.encodedBytes;
  }
  if (result.logicalRegion !== undefined) {
    browserObject(result.logicalRegion, "feedback screenshot logical region");
    const logicalRegion = {};
    for (const key of ["x", "y", "width", "height"]) {
      const number = result.logicalRegion[key];
      if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1_000_000_000 || (key === "width" || key === "height") && number === 0) {
        throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an invalid feedback screenshot logical region.", 502);
      }
      logicalRegion[key] = number;
    }
    output.logicalRegion = logicalRegion;
  }
  if (result.compression !== undefined) {
    browserObject(result.compression, "feedback screenshot compression metadata");
    const allowed = new Set(["policy", "format", "quality", "maxBytes", "automatic"]);
    for (const key of Object.keys(result.compression)) {
      if (!allowed.has(key)) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned unsafe feedback screenshot compression metadata.", 502);
    }
    const compression = {};
    if (result.compression.policy !== undefined) {
      if (typeof result.compression.policy !== "string" || !result.compression.policy || result.compression.policy.length > 128 || /[\u0000-\u001f\u007f]/.test(result.compression.policy)) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned invalid feedback screenshot compression metadata.", 502);
      compression.policy = result.compression.policy;
    }
    if (result.compression.format !== undefined) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(result.compression.format) || result.compression.format !== image.mimeType) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned invalid feedback screenshot compression metadata.", 502);
      compression.format = result.compression.format;
    }
    if (result.compression.quality !== undefined) {
      if (result.compression.quality !== null && (typeof result.compression.quality !== "number" || !Number.isFinite(result.compression.quality) || result.compression.quality < 0 || result.compression.quality > 1)) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned invalid feedback screenshot compression metadata.", 502);
      compression.quality = result.compression.quality;
    }
    if (result.compression.maxBytes !== undefined) {
      if (!Number.isSafeInteger(result.compression.maxBytes) || result.compression.maxBytes <= 0 || result.compression.maxBytes > MAX_FEEDBACK_CAPTURE_BYTES) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned invalid feedback screenshot compression metadata.", 502);
      compression.maxBytes = result.compression.maxBytes;
    }
    if (result.compression.automatic !== undefined) {
      if (typeof result.compression.automatic !== "boolean") throw bridgeError("invalid_browser_result", "The PenEcho canvas returned invalid feedback screenshot compression metadata.", 502);
      compression.automatic = result.compression.automatic;
    }
    output.compression = compression;
  }
  return output;
}

function extractCapture(result, maximumBytes = MAX_CAPTURE_BYTES, label = "widget") {
  const source = typeof result?.dataUrl === "string" ? result.dataUrl : typeof result?.imageUrl === "string" ? result.imageUrl : "";
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(source);
  if (!match) throw bridgeError("invalid_capture", "The PenEcho canvas returned an unsupported capture.", 502);
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > maximumBytes || data.toString("base64").replace(/=+$/, "") !== match[2].replace(/=+$/, "")) throw bridgeError("capture_too_large", `The PenEcho ${label} capture is invalid or too large.`, 413);
  return { mimeType:result?.mediaType && result.mediaType === match[1] ? result.mediaType : match[1], data:match[2], bytes:data.length };
}

const BOUND_CANVAS_TOOL_NAMES = Object.freeze(["penecho_list_files", "penecho_read_file", "penecho_inbox", "penecho_patch_file", "penecho_edit_canvas", "penecho_upload_image", "penecho_place_image", "penecho_capture_canvas", "penecho_present_widget", "penecho_draw", "penecho_plot", "penecho_inspect_session"]);

// Shared document operations. The caller owns authentication and session lifecycle.
async function executeBoundOperation({name,args,session,canvasCall,flushUpdate = async () => {},sessionSnapshot = session => ({sessionId:session.id}),callOptions = {}}) {
  if (!BOUND_CANVAS_TOOL_NAMES.includes(name)) throw bridgeError("tool_not_found", "Unknown bound Canvas tool.", 404);
  if (args.sessionId !== session.id) throw bridgeError("session_mismatch", "The tool must target its bound Canvas session.", 409);
  if (name === "penecho_list_files" || name === "penecho_read_file") {
    const operation = ({penecho_list_files:"mcp_list_files",penecho_read_file:"mcp_read_file"})[name];
    const { result, timing } = await canvasCall(session.connection, operation, args, callOptions);
    browserObject(result, `${name} result`);
    if (result.sessionId !== undefined && result.sessionId !== session.id) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned a mismatched session result.", 502);
    if (name === "penecho_list_files") for (const key of ["files", "entries"]) if (result[key] !== undefined && (!Array.isArray(result[key]) || result[key].length > args.limit)) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an invalid bounded virtual file list.", 502);
    if (name === "penecho_read_file") {
      if (typeof result.content !== "string" || Buffer.byteLength(result.content, "utf8") > MAX_FILE_BYTES || typeof result.contentHash !== "string" || !result.contentHash || result.contentHash.length > 256) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned invalid virtual file content.", 502);
    }
    return {...publicVirtualResult(result, name === "penecho_read_file" ? "virtual file" : "bounded result"),timing};
  }
  if (name === "penecho_patch_file") {
    const signature = mutationSignature({tool:name,...args}), prior = session.mutationRequests.get(args.requestId);
    if (prior && prior.signature !== signature) throw bridgeError("REQUEST_ID_CONFLICT", "requestId was already used with different patch arguments. Use a new requestId.", 409);
    if (prior?.response) return {...prior.response,reused:true};
    let entry = prior;
    if (!entry) {
      if ([...session.mutationRequests.values()].filter(value=>!value.response).length >= MAX_UNRESOLVED_PATCHES) throw bridgeError("request_limit","Resolve pending mutations before another patch.",429);
      if(session.mutationRequests.size >= MAX_MUTATION_REQUESTS) {
        const completed=[...session.mutationRequests].find(([,value])=>value.response);
        if(completed)session.mutationRequests.delete(completed[0]);else throw bridgeError("request_limit","Resolve pending mutations.",429);
      }
      // Validate syntax and exact file scope before dispatch; browser owns the
      // atomic current-source hash check and application to avoid a round trip.
      sharedPatchCall(validateCanvasFilePatch,args.patch,args.path);
      entry={signature,applyArguments:{sessionId:session.id,path:args.path,patch:args.patch,expectedHash:args.contentHash,requestId:args.requestId,...(args.capture!==undefined?{capture:args.capture}:{}),...(args.quality?{quality:args.quality}:{}),...(args.completion?{completion:args.completion}:{})}};
      session.mutationRequests.set(args.requestId,entry);
    }
    try {
      const applied = await canvasCall(session.connection, "mcp_patch_file", entry.applyArguments, callOptions);
      browserObject(applied.result, "patch result");
      const response = mutationBrowserResult(applied.result,applied.timing);
      entry.response = response;
      return response;
    } catch (error) {
      if (["SOURCE_CONFLICT","PATCH_CONFLICT","patch_too_large","invalid_patch","invalid_arguments","FILE_NOT_FOUND","FILE_NOT_EDITABLE","invalid_browser_result"].includes(error?.code)) session.mutationRequests.delete(args.requestId);
      throw error;
    }
  }
  if (["penecho_edit_canvas", "penecho_upload_image", "penecho_place_image"].includes(name)) {
    const signature = mutationSignature({tool:name,...args}), prior = session.mutationRequests.get(args.requestId);
    if (prior && prior.signature !== signature) throw bridgeError("REQUEST_ID_CONFLICT", "requestId was already used with different mutation arguments. Use a new requestId.", 409);
    if (prior?.response) return {...prior.response,reused:true};
    if (!prior && [...session.mutationRequests.values()].filter(value => !value.response).length >= MAX_UNRESOLVED_PATCHES) throw bridgeError("request_limit", "Too many unresolved mutation outcomes are retained for this session. Resolve or retry them before starting another edit.", 429);
    if (!prior && session.mutationRequests.size >= MAX_MUTATION_REQUESTS) {
      const completed = [...session.mutationRequests].find(([, value]) => value.response);
      if (completed) session.mutationRequests.delete(completed[0]);
      else throw bridgeError("request_limit", "Too many unresolved mutation request IDs are retained for this session.", 429);
    }
    const entry = prior || {signature};
    session.mutationRequests.set(args.requestId, entry);
    const applied = await canvasCall(session.connection, name.replace(/^penecho_/, "mcp_"), args, callOptions);
    browserObject(applied.result, "canvas edit result");
    const response = mutationBrowserResult(applied.result,applied.timing);
    entry.response = response;
    return response;
  }
  if (name === "penecho_capture_canvas" && args.target !== "artifact") {
    await flushUpdate(session);
    const { result, timing } = await canvasCall(session.connection, "mcp_capture_canvas", args, callOptions);
    browserObject(result, "Canvas capture result");
    const image = extractCapture(result, MAX_CAPTURE_BYTES, "Canvas");
    return {
      sessionId:session.id,
      target:args.target,
      image,
      pixelVerified:true,
      ...browserCanvasCaptureMetadata(result, image),
      timing,
      ...browserMetadata(result),
    };
  }
  if (name === "penecho_present_widget") {
    await flushUpdate(session);
    const presentationArgs = {
      sessionId:args.sessionId,
      artifactId:args.artifactId,
      title:args.title,
      html:args.html,
      capture:args.capture===true,
      ...(args.quality?{quality:args.quality}:{}),
      ...(args.requestId ? {requestId:args.requestId}:{}),
      ...(args.completion ? {completion:args.completion}:{}),
      width:args.width,
      height:args.height,
      ...(args.presentation === undefined ? {} : {presentation:args.presentation}),
    };
    const inspect = args.presentation?.intent === "inspect";
    if (inspect) {
      presentationArgs.capture = true;
      presentationArgs.quality = args.quality || "basic";
    }
    const { result, timing } = await canvasCall(session.connection, "mcp_present_widget", presentationArgs, callOptions);
    browserObject(result, "widget result");
    if (result.artifactId !== args.artifactId) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned a mismatched artifact.", 502);
    if (inspect) {
      if (result.ephemeral !== true || result.objectId !== undefined) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned an invalid ephemeral inspection result.", 502);
      const quality = args.quality || "basic", policy = INSPECT_CAPTURE_POLICIES[quality];
      const image = extractCapture(result, policy.maxBytes, "inspection");
      const width = Number.isSafeInteger(result.width) && result.width > 0 && result.width <= 16_384 ? result.width : undefined;
      const height = Number.isSafeInteger(result.height) && result.height > 0 && result.height <= 16_384 ? result.height : undefined;
      if (!width || !height) throw bridgeError("invalid_capture", "The PenEcho canvas returned invalid inspection screenshot dimensions.", 502);
      if (width > policy.maxLongEdge || height > policy.maxLongEdge || width * height > policy.maxPixels) throw bridgeError("capture_too_large", "The PenEcho inspection screenshot exceeds the requested quality bounds.", 413);
      if (!Number.isSafeInteger(result.encodedBytes) || result.encodedBytes !== image.bytes) throw bridgeError("invalid_capture", "The PenEcho canvas returned invalid inspection screenshot byte metadata.", 502);
      if (result.viewport !== undefined) {
        browserObject(result.viewport, "inspection viewport");
        if (result.viewport.width !== args.width || result.viewport.height !== args.height) throw bridgeError("invalid_browser_result", "The PenEcho canvas returned a mismatched inspection viewport.", 502);
      }
      return {
        sessionId:session.id,
        artifactId:args.artifactId,
        presentation:args.presentation,
        image,
        width,
        height,
        encodedBytes:result.encodedBytes,
        revision:browserRevision(result.revision),
        ephemeral:true,
        applied:true,
        pixelVerified:true,
        timing,
        ...browserMetadata(result),
      };
    }
    const presentation = { sessionId:session.id, artifactId:args.artifactId, objectId:safeString(result.objectId, 128, "objectId"), revision:browserRevision(result.revision), ...(result.feedbackCursor === undefined ? {} : {feedbackCursor:browserCursor(result.feedbackCursor)}), ...(args.presentation === undefined ? {} : {presentation:args.presentation}), applied:true, pixelVerified:false, timing, ...browserMetadata(result) };
    if (result.captureFailure) return {...presentation,captureFailure:publicCaptureFailure(result.captureFailure,session.id,args.artifactId)};
    if (args.capture !== true) return presentation;
    const image=extractCapture(result);
    return {...presentation,image,pixelVerified:true,...browserCanvasCaptureMetadata(result,image)};
  }
  if (name === "penecho_draw" || name === "penecho_plot") {
    await flushUpdate(session);
    const kind=name==="penecho_draw"?"drawing":"plot";
    const {result,timing}=await canvasCall(session.connection,name.replace(/^penecho_/,"mcp_"),args,callOptions);
    const artifact=browserArtifactResult(result,args.artifactId,kind);
    const applied={sessionId:session.id,...artifact,...(args.presentation?{presentation:args.presentation}:{}),applied:true,pixelVerified:false,timing,...browserMetadata(result)};
    if(result.captureFailure)return {...applied,captureFailure:publicCaptureFailure(result.captureFailure,session.id,args.artifactId)};
    if(args.capture!==true)return applied;
    const image=extractCapture(result,MAX_FEEDBACK_CAPTURE_BYTES,"primitive");
    return {...applied,image,pixelVerified:true,...browserPrimitiveCaptureMetadata(result,image,args.artifactId)};
  }

  if (name === "penecho_capture_canvas" && args.target === "artifact") {
    await flushUpdate(session);
    const { result, timing } = await canvasCall(session.connection, "mcp_capture_canvas", args, callOptions);
    browserObject(result, "capture result");
    const image = extractCapture(result);
    const width = Number.isSafeInteger(result.width) && result.width > 0 && result.width <= 16_384 ? result.width : undefined;
    const height = Number.isSafeInteger(result.height) && result.height > 0 && result.height <= 16_384 ? result.height : undefined;
    return { sessionId:session.id, artifactId:args.artifactId, image, pixelVerified:true, ...(width ? {width} : {}), ...(height ? {height} : {}), ...(result.revision === undefined ? {} : {revision:browserRevision(result.revision)}), timing, ...browserMetadata(result) };
  }
  if (name === "penecho_inbox") {
    const {result,timing}=await canvasCall(session.connection,"mcp_inbox",args,callOptions);
    browserObject(result,"inbox");
    if(result.sessionId!==session.id)throw bridgeError("invalid_browser_result","Inbox session mismatch.",502);
    if(args.mode==="ack") {
      if(!Array.isArray(result.acknowledged)||result.acknowledged.length>args.ids.length||result.acknowledged.some(id=>!args.ids.includes(typeof id==="string"?id:id.requestId)))throw bridgeError("invalid_browser_result","Invalid acknowledgement IDs.",502);
      return {...publicVirtualResult(result,"inbox acknowledgement"),timing};
    }
    const messages=browserObject(result.messages,"message page"), entries=messages.messages;
    if(!Array.isArray(entries)||entries.length>args.limit)throw bridgeError("invalid_browser_result","Invalid bounded message page.",502);
    const after=browserCursor(messages.after,"message after"),nextCursor=browserCursor(messages.nextCursor,"message next"),latestCursor=browserCursor(messages.latestCursor,"message latest");
    if(after<args.messageAfter||nextCursor<after||nextCursor>latestCursor||typeof messages.hasMore!=="boolean")throw bridgeError("invalid_browser_result","Invalid message pagination.",502);
    const feedback=browserFeedbackResult({...result.feedback,sessionId:session.id},session.id,args.feedbackAfter,args.limit);
    const response={sessionId:session.id,messages:publicVirtualResult(messages,"message page"),feedback:publicVirtualResult(feedback,"feedback page"),timing};
    if(args.capture && feedback.entries.length) {
      const image=extractCapture(result.feedback,args.quality==="detail"?INSPECT_CAPTURE_POLICIES.detail.maxBytes:MAX_FEEDBACK_CAPTURE_BYTES,"feedback");
      Object.assign(response,{image,pixelVerified:true,...(args.quality==="detail"?browserCanvasCaptureMetadata(result.feedback,image):browserFeedbackCaptureMetadata(result.feedback,image))});
    }
    return response;
  }
  if (name === "penecho_inspect_session") {
    await flushUpdate(session);
    const { result, timing } = await canvasCall(session.connection, "mcp_inspect_session", args, callOptions);
    return { ...sessionSnapshot(session), browser:result, timing };
  }
}

function publicCaptureFailure(value,sessionId,artifactId) {
  browserObject(value,"capture failure");
  return {code:safeString(value.code,80,"capture failure code"),message:"Content was applied; capture the existing artifact after resolving visibility/readiness.",retryTool:"penecho_capture_canvas",retryArguments:{sessionId,target:"artifact",artifactId}};
}
function mutationBrowserResult(result,timing) {
  const {dataUrl,imageUrl,...metadata}=result;
  return {...safeJsonValue(metadata,"mutation result"),...((dataUrl||imageUrl)?{image:extractCapture(result),pixelVerified:true}:{}),timing};
}
function conciseResult(result) {
  if(!result||typeof result!=="object")return result;
  const {timing,runtimeDiagnostics,presentationMetadata,applicationMetadata,browserElapsedMs,...rest}=result;
  if(rest.sourcePath&&rest.contentHash) {
    // Only the virtual-file contentHash is valid for the next MCP patch. The
    // internal Widget receipt hashes include different state and must not look
    // like alternative edit tokens in the default response.
    const {sourceHash,receipts,changeId,previousRevision,ok,rasterMs,...sourceResult}=rest;
    return sourceResult;
  }
  return rest;
}
async function executeBoundCanvasTool(options) {
  const args=validateToolArguments(options.name,options.args);
  const wasCompleted=!!options.session.mutationRequests.get(args.requestId)?.response;
  if(args.completion&&!wasCompleted)await options.flushUpdate?.(options.session);
  let result;
  const artifactMutation=["penecho_present_widget","penecho_draw","penecho_plot"].includes(options.name);
  if(artifactMutation) {
    const signature=mutationSignature({tool:options.name,...args}),cache=options.session.mutationRequests,prior=cache.get(args.requestId);
    if(prior&&prior.signature!==signature)throw bridgeError("REQUEST_ID_CONFLICT","requestId already has different arguments. Use a new requestId for corrected arguments, even if the previous attempt failed; retain the artifactId for the same content.",409);
    if(prior?.response)result={...prior.response,reused:true};
    else {
      if(prior?.running)throw bridgeError("REQUEST_IN_PROGRESS","Retry the same requestId shortly.",409);
      if(!prior&&cache.size>=MAX_MUTATION_REQUESTS){const completed=[...cache].find(([,v])=>v.response);if(completed)cache.delete(completed[0]);else throw bridgeError("request_limit","Resolve pending mutations.",429);}
      const entry=prior||{signature};entry.running=true;cache.set(args.requestId,entry);
      try {result=await executeBoundOperation({...options,args});entry.response=result;}finally{entry.running=false;}
    }
  } else result=await executeBoundOperation({...options,args});
  if(result?.completion) {
    if(!args.completion||result.completion.status!==args.completion.status)throw bridgeError("invalid_browser_result","Completion does not match the requested status.",502);
    const ids=result.completion.handledMessageIds||[];
    if(!Array.isArray(ids)||ids.length>(args.completion.handledMessageIds||[]).length||ids.some(id=>!args.completion.handledMessageIds?.includes(id)))throw bridgeError("invalid_browser_result","Completion acknowledged unrequested messages.",502);
  }
  if(MUTATION_TOOLS.has(options.name)&&result?.completion?.status==="done"&&(result.captureFailure||result.applied===false))throw bridgeError("invalid_browser_result","Failed work cannot be marked done.",502);
  if(args.completion&&result?.completion&&!result.captureFailure&&!result.completionFailure&&result.applied!==false&&!wasCompleted) {
    options.session.status=result.completion.status;
    if(result.completion.summary!==undefined)options.session.summary=result.completion.summary;
    options.session.updatedAt=Date.now();
  }
  return args.output==="detailed" ? result : conciseResult(result);
}

module.exports = { BOUND_CANVAS_TOOL_NAMES, executeBoundCanvasTool, MAX_CAPTURE_BYTES, MAX_MUTATION_REQUESTS, safeString, safeJsonValue, browserSessionProgress, publicVirtualResult, mutationSignature, patchVirtualFile, browserRevision, browserCursor, browserObject, browserMetadata, browserArtifactResult, browserPrimitiveCaptureMetadata, browserCanvasCaptureMetadata, browserFeedbackBounds, browserFeedbackResult, browserFeedbackCaptureMetadata };
