"use strict";

const { INVOCATION_INSTRUCTIONS, VISUAL_TOOL_INSTRUCTIONS } = require("./guidance.js");

const { GUIDANCE_IDS } = require("./authoring-guidance.js");

const MAX_TITLE_CHARS = 120;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_HTML_CHARS = 200_000;
const MAX_HTML_BYTES = 800_000;
const MAX_STEPS = 24;
const MAX_EVENTS_PER_UPDATE = 20;
const MAX_FEEDBACK_ENTRIES = 50;
const MAX_DRAW_ITEMS = 24;
const MAX_DRAW_POINTS = 256;
const MAX_DRAW_POINTS_TOTAL = 2_048;
const MAX_FILE_BYTES = 800_000;
const MAX_FILES_PER_PAGE = 100;
const MAX_MESSAGES_PER_PAGE = 50;
const MAX_REQUEST_IDS = 50;
const DRAW_TYPES = new Set(["text", "rect", "ellipse", "line", "arrow", "path"]);
const DRAW_NODE_TYPES = new Set(["text", "rect", "ellipse"]);
const COLOR_PATTERN = /^(?:#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8}|transparent)$/;
const COMPLETION_STATUSES = new Set(["done","waiting","error"]);
const SESSION_STATUSES = new Set(["working", "waiting", "done", "error"]);
const STEP_STATUSES = new Set(["pending", "working", "done", "error"]);
const EVENT_KINDS = new Set(["progress", "evidence", "info", "warning", "error"]);
const STORAGE_LOCATIONS = new Set(["device", "server", "cloud"]);
const EDIT_ACTIONS = new Set(["create_text", "move", "resize", "delete", "erase_ink", "draw_ink", "replace_image", "show"]);
// Share action-specific fields between advertised JSON Schema and runtime validation.
const EDIT_FIELDS = {
  create_text:{required:["text"],optional:["region"]},
  move:{required:["objectId","region","baseRevision"]},
  resize:{required:["objectId","width","height","baseRevision"]},
  delete:{required:["objectId","baseRevision"]},
  erase_ink:{required:["region","baseRevision"]},
  draw_ink:{required:["strokes","baseRevision"]},
  replace_image:{required:["objectId","source","baseRevision"],optional:["width","height"]},
  show:{required:[],optional:["objectId"]},
};
const EDIT_ARGUMENT_FIELDS = ["objectId","text","source","region","width","height","baseRevision","strokes"];
const MESSAGE_STATUSES = new Set(["received", "working", "done", "error"]);
const CAPTURE_TARGETS = new Set(["canvas", "viewport", "selection", "region", "object", "artifact"]);
const CAPTURE_QUALITIES = new Set(["basic", "detail"]);
const PRESENTATION_INTENTS = new Set(["explain", "deliver", "compare", "review", "inspect"]);
const PRESENTATION_ROLES = new Set(["primary", "supporting", "alternative"]);
const PRESENTATION_SIZES = new Set(["base", "wide", "tall", "large", "page"]);
const PRESENTATION_RELATIONS = new Set(["below", "beside"]);
const PRESENTATION_ATTENTION = new Set(["quiet", "normal", "request"]);
const PRESENTATION_VIEWPORTS = Object.freeze({
  base:Object.freeze({width:480,height:360}),
  wide:Object.freeze({width:992,height:360}),
  tall:Object.freeze({width:480,height:752}),
  large:Object.freeze({width:992,height:752}),
  page:Object.freeze({width:1_200,height:800}),
});

class McpBridgeError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "McpBridgeError";
    this.code = code;
    this.status = status;
  }
}

function invalid(message) {
  throw new McpBridgeError("invalid_arguments", message, 400);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) invalid(`${label} contains an unsupported field: ${key}.`);
}

function string(value, label, { min = 1, max = 128, optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(`${label} is invalid.`);
  return value;
}

function finiteNumber(value, label, { min, max, optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    const range = min !== undefined && max !== undefined ? ` in range ${min}..${max} (inclusive)` : min !== undefined ? ` >= ${min}` : max !== undefined ? ` <= ${max}` : "";
    const actual = typeof value === "number" ? String(value) : value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    invalid(`${label} must be a finite number${range}; received ${actual}.`);
  }
  return value;
}

function integer(value, label, { min, max, optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`${label} is invalid.`);
  return value;
}

function enumValue(value, values, label, optional = false) {
  if (value === undefined && optional) return undefined;
  if (!values.has(value)) invalid(`${label} is invalid.`);
  return value;
}

function drawText(value, label) {
  if (typeof value !== "string" || !value.length || value.length > 1_000 || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(value)) invalid(`${label} is invalid.`);
  return value;
}

function color(value, label, optional = false) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) invalid(`${label} is invalid.`);
  return value;
}

function validatePoint(value, label) {
  object(value, label);
  exactKeys(value, new Set(["x", "y"]), label);
  return {
    x:finiteNumber(value.x, `${label}.x`, { min:0, max:2_400 }),
    y:finiteNumber(value.y, `${label}.y`, { min:0, max:2_400 }),
  };
}

function validatePoints(value, label, { exact } = {}) {
  if (!Array.isArray(value)) invalid(`${label} must be an array of ${exact !== undefined ? `exactly ${exact}` : `2..${MAX_DRAW_POINTS}`} points.`);
  if (value.length < 2 || value.length > MAX_DRAW_POINTS || exact !== undefined && value.length !== exact) invalid(`${label} has ${value.length} points; expected ${exact !== undefined ? `exactly ${exact}` : `2..${MAX_DRAW_POINTS} (inclusive)`}.`);
  return value.map((entry, index) => validatePoint(entry, `${label}[${index}]`));
}

function optionalPair(input, first, second, label) {
  if ((input[first] === undefined) !== (input[second] === undefined)) invalid(`${label} must be provided together.`);
}

function validateDrawItems(value) {
  if (!Array.isArray(value)) invalid(`items must be an array with 1..${MAX_DRAW_ITEMS} entries.`);
  if (!value.length || value.length > MAX_DRAW_ITEMS) invalid(`items has ${value.length} entries; expected 1..${MAX_DRAW_ITEMS} (inclusive).`);
  const ids = new Set();
  let totalPoints = 0;
  const items = value.map((entry, index) => {
    const label = `items[${index}]`;
    object(entry, label);
    const type = enumValue(entry.type, DRAW_TYPES, `${label}.type`);
    const common = new Set(["id", "type", "color", "fill", "strokeWidth"]);
    const allowed = DRAW_NODE_TYPES.has(type)
      ? new Set([...common, "text", "x", "y", "width", "height", "fontSize"])
        : type === "path"
          ? new Set([...common, "points"])
          : new Set([...common, "points", "from", "to"]);
    exactKeys(entry, allowed, label);
    const id = string(entry.id, `${label}.id`, { max:64 });
    if (ids.has(id)) invalid(`Duplicate item id: ${id}.`);
    ids.add(id);
    const output = { id, type };
    if (entry.color !== undefined) output.color = color(entry.color, `${label}.color`);
    if (entry.fill !== undefined) output.fill = color(entry.fill, `${label}.fill`);
    if (entry.strokeWidth !== undefined) output.strokeWidth = finiteNumber(entry.strokeWidth, `${label}.strokeWidth`, { min:1, max:12 });
    if (DRAW_NODE_TYPES.has(type)) {
      optionalPair(entry, "x", "y", `${label}.x and ${label}.y`);
      if (entry.x !== undefined) {
        output.x = finiteNumber(entry.x, `${label}.x`, { min:0, max:2_400 });
        output.y = finiteNumber(entry.y, `${label}.y`, { min:0, max:2_400 });
      }
      const minimumSize = type === "text" ? 8 : 80;
      if (entry.width !== undefined) output.width = finiteNumber(entry.width, `${label}.width`, { min:minimumSize, max:1_200 });
      if (entry.height !== undefined) output.height = finiteNumber(entry.height, `${label}.height`, { min:minimumSize, max:1_200 });
      if (type === "text" || entry.text !== undefined) output.text = drawText(entry.text, `${label}.text`);
      if (entry.fontSize !== undefined) output.fontSize = finiteNumber(entry.fontSize, `${label}.fontSize`, { min:12, max:64 });
    } else if (type === "path") {
      output.points = validatePoints(entry.points, `${label}.points`);
      totalPoints += output.points.length;
    } else {
      optionalPair(entry, "from", "to", `${label}.from and ${label}.to`);
      if (entry.from !== undefined) {
        if (entry.points !== undefined) invalid(`${label}.points cannot be combined with from and to.`);
        output.from = string(entry.from, `${label}.from`, { max:64 });
        output.to = string(entry.to, `${label}.to`, { max:64 });
        if (output.from === output.to) invalid(`${label}.from and ${label}.to must refer to different items.`);
      } else {
        output.points = validatePoints(entry.points, `${label}.points`, { exact:2 });
        totalPoints += output.points.length;
      }
    }
    return output;
  });
  if (totalPoints > MAX_DRAW_POINTS_TOTAL) invalid(`items contain ${totalPoints} total points; maximum is ${MAX_DRAW_POINTS_TOTAL}.`);
  const nodes = new Map(items.filter(item => DRAW_NODE_TYPES.has(item.type)).map(item => [item.id, item]));
  for (const [index, item] of items.entries()) {
    if (item.from === undefined) continue;
    if (!nodes.has(item.from) || !nodes.has(item.to)) invalid(`items[${index}].from and items[${index}].to must refer to text, rect, or ellipse items in this batch.`);
  }
  return items;
}

function validateDomainPair(input, minKey, maxKey) {
  optionalPair(input, minKey, maxKey, `${minKey} and ${maxKey}`);
  if (input[minKey] === undefined) return {};
  const minimum = finiteNumber(input[minKey], minKey, { min:-1_000_000, max:1_000_000 });
  const maximum = finiteNumber(input[maxKey], maxKey, { min:-1_000_000, max:1_000_000 });
  if (minimum >= maximum || maximum - minimum < 0.000001) invalid(`${minKey} and ${maxKey} define an invalid domain.`);
  return { [minKey]:minimum, [maxKey]:maximum };
}

function validateSteps(value) {
  if (!Array.isArray(value) || value.length > MAX_STEPS) invalid("steps is invalid.");
  return value.map((entry, index) => {
    object(entry, `steps[${index}]`);
    exactKeys(entry, new Set(["id", "label", "status"]), `steps[${index}]`);
    return {
      id:string(entry.id, `steps[${index}].id`, { max:64 }),
      label:string(entry.label, `steps[${index}].label`, { max:160 }),
      ...(entry.status === undefined ? {} : { status:enumValue(entry.status, STEP_STATUSES, `steps[${index}].status`) }),
    };
  });
}

function validateEvents(value) {
  if (!Array.isArray(value) || value.length > MAX_EVENTS_PER_UPDATE) invalid("events is invalid.");
  return value.map((entry, index) => {
    object(entry, `events[${index}]`);
    exactKeys(entry, new Set(["id", "text", "kind"]), `events[${index}]`);
    return {
      id:string(entry.id, `events[${index}].id`, { max:64 }),
      text:string(entry.text, `events[${index}].text`, { max:500 }),
      ...(entry.kind === undefined ? {} : { kind:enumValue(entry.kind, EVENT_KINDS, `events[${index}].kind`) }),
    };
  });
}

function bool(value, label, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") invalid(`${label} is invalid.`);
  return value;
}

function validatePresentation(value, { kind, capture, hasExplicitDimensions = false } = {}) {
  const supplied = value !== undefined;
  if (!supplied) return undefined;
  const input = supplied ? object(value, "presentation") : {};
  exactKeys(input, new Set(["intent", "role", "size", "relativeTo", "relation", "attention"]), "presentation");
  const intent = input.intent === undefined ? "deliver" : enumValue(input.intent, PRESENTATION_INTENTS, "presentation.intent");
  const role = input.role === undefined ? "primary" : enumValue(input.role, PRESENTATION_ROLES, "presentation.role");
  if (intent === "inspect" && kind !== "widget") invalid("presentation.intent inspect is valid only for widgets.");
  if (intent === "inspect" && capture !== true) invalid("presentation.intent inspect requires capture to be true.");
  if (kind === "draw" && input.size !== undefined) invalid("presentation.size is not valid for drawings.");
  if (input.size !== undefined && hasExplicitDimensions) invalid("presentation.size cannot be combined with explicit width or height.");
  const size = kind === "draw" || hasExplicitDimensions
    ? undefined
    : input.size === undefined ? (kind === "widget" ? "page" : "base") : enumValue(input.size, PRESENTATION_SIZES, "presentation.size");
  const relativeTo = input.relativeTo === undefined ? undefined : string(input.relativeTo, "presentation.relativeTo", {max:128});
  if (input.relation !== undefined && relativeTo === undefined) invalid("presentation.relation requires presentation.relativeTo.");
  if (intent === "inspect" && (relativeTo !== undefined || input.relation !== undefined)) invalid("presentation.intent inspect cannot use relativeTo or relation.");
  const relation = intent === "inspect" || relativeTo === undefined ? undefined : input.relation === undefined
    ? intent === "compare" ? "beside" : "below"
    : enumValue(input.relation, PRESENTATION_RELATIONS, "presentation.relation");
  const defaultAttention = intent === "inspect" ? "quiet" : intent === "review" ? "request" : role === "primary" ? "normal" : "quiet";
  const attention = input.attention === undefined ? defaultAttention : enumValue(input.attention, PRESENTATION_ATTENTION, "presentation.attention");
  if (intent === "inspect" && attention !== "quiet") invalid("presentation.intent inspect requires quiet attention.");
  return {
    intent,
    role,
    ...(size === undefined ? {} : {size}),
    ...(relativeTo === undefined ? {} : {relativeTo}),
    ...(relation === undefined ? {} : {relation}),
    attention,
  };
}

function presentationDimensions(input, presentation, {maxWidth,maxHeight}) {
  const preset = presentation?.size === undefined ? PRESENTATION_VIEWPORTS.page : PRESENTATION_VIEWPORTS[presentation.size];
  const width = input.width === undefined ? preset.width : Math.round(finiteNumber(input.width, "width", {min:300,max:maxWidth}));
  const height = input.height === undefined ? preset.height : Math.round(finiteNumber(input.height, "height", {min:200,max:maxHeight}));
  if (width > maxWidth || height > maxHeight) invalid("presentation.size exceeds this tool's viewport limits.");
  return {width,height};
}

function region(value, label = "region", optional = false) {
  if (value === undefined && optional) return undefined;
  object(value, label);
  exactKeys(value, new Set(["x", "y", "w", "h"]), label);
  return {
    x:finiteNumber(value.x, `${label}.x`, { min:-1_000_000_000, max:1_000_000_000 }),
    y:finiteNumber(value.y, `${label}.y`, { min:-1_000_000_000, max:1_000_000_000 }),
    w:finiteNumber(value.w, `${label}.w`, { min:0.001, max:1_000_000_000 }),
    h:finiteNumber(value.h, `${label}.h`, { min:0.001, max:1_000_000_000 }),
  };
}

function virtualPath(value, label = "path", { defaultValue } = {}) {
  if (value === undefined && defaultValue !== undefined) value = defaultValue;
  if (typeof value !== "string" || !value.length || value.length > 1_024 || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) invalid(`${label} is invalid.`);
  const normalized = value.replace(/^\/+/, "");
  if (!normalized) return "/";
  if (normalized.split("/").some(part => part === ".." || part === "." || !part)) invalid(`${label} is invalid.`);
  let decoded;
  try { decoded = decodeURIComponent(normalized); } catch { invalid(`${label} is invalid.`); }
  if (/%(?:00|2f|5c)/i.test(normalized) || decoded.includes("\\") || decoded.includes("\0") || decoded.split("/").some(part => part === ".." || part === "." || !part)) invalid(`${label} is invalid.`);
  return normalized ? `/${normalized}` : "/";
}

function locator(value) {
  object(value, "locator");
  exactKeys(value, new Set(["location", "id"]), "locator");
  return { location:enumValue(value.location, STORAGE_LOCATIONS, "locator.location"), id:string(value.id, "locator.id", { max:512 }) };
}

function boundedContent(value, label) {
  if (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value, "utf8") > MAX_FILE_BYTES) invalid(`${label} is invalid or too large.`);
  return value;
}

function imageSource(value) {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value, "utf8") > MAX_FILE_BYTES) invalid("source is invalid or too large.");
  if (/^penecho-ref:objects\/[A-Za-z0-9._~%-]{1,512}\/image$/.test(value)) return value;
  if (/^penecho-asset:[a-f0-9]{64}$/.test(value)) return value;
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) invalid("source must be a PNG/JPEG/WebP base64 Data URL or an authorized same-document penecho-ref:objects/<id>/image or penecho-asset:<sha256> reference. For files, use the imageUpload transport returned by penecho_start_session; host paths are not upload content. Existing attachment Data URLs remain supported.");
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString("base64").replace(/=+$/, "") !== match[1].replace(/=+$/, "")) invalid("source is invalid or too large.");
  return value;
}

const validators = {
  penecho_get_guidance(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["id","detail"]), "arguments");
    return { id:enumValue(input.id, new Set(GUIDANCE_IDS), "id"),...(input.detail===undefined?{}:{detail:enumValue(input.detail,new Set(["brief","full"]),"detail")}) };
  },
  penecho_list_canvases(input) {
    object(input, "arguments");
    exactKeys(input, new Set(), "arguments");
    return {};
  },
  penecho_open_canvas(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["instanceId", "canvasId", "documentId", "locator", "create", "title", "requestId", "show"]), "arguments");
    const output = {
      instanceId:string(input.instanceId, "instanceId"),
      canvasId:string(input.canvasId, "canvasId"),
      requestId:string(input.requestId, "requestId", { max:128 }),
      show:bool(input.show, "show", false),
    };
    if (input.documentId !== undefined) output.documentId = string(input.documentId, "documentId", { max:256 });
    if (input.locator !== undefined) output.locator = locator(input.locator);
    if (input.create !== undefined) output.create = bool(input.create, "create", false);
    if (input.title !== undefined) output.title = string(input.title, "title", { max:MAX_TITLE_CHARS });
    const targets = Number(output.documentId !== undefined) + Number(output.locator !== undefined);
    if (output.create !== true && targets === 0) invalid("Provide create:true, documentId, or locator.");
    if (output.create === true && targets !== 0) invalid("create cannot be combined with documentId or locator.");
    if (output.create !== true && output.title !== undefined) invalid("title is valid only with create:true.");
    return output;
  },
  penecho_rename_canvas(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["instanceId", "canvasId", "documentId", "title", "requestId"]), "arguments");
    // Reject controls before trimming so a trailing newline cannot disappear.
    const title = string(input.title, "title", {max:48}).trim();
    if (!title) invalid("title must not be blank.");
    return {instanceId:string(input.instanceId,"instanceId"),canvasId:string(input.canvasId,"canvasId"),documentId:string(input.documentId,"documentId",{max:256}),title,requestId:string(input.requestId,"requestId")};
  },
  penecho_find_canvases(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["instanceId", "canvasId", "documentId"]), "arguments");
    return {
      instanceId:string(input.instanceId, "instanceId"),
      canvasId:string(input.canvasId, "canvasId"),
      ...(input.documentId === undefined ? {} : {documentId:string(input.documentId, "documentId", { max:256 })}),
    };
  },
  penecho_start_session(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["canvasId", "instanceId", "documentId", "target", "takeover", "title", "client", "sessionKey", "restore", "show"]), "arguments");
    if (input.target !== undefined && input.target !== "current") invalid("target must be current.");
    if (input.target !== undefined && input.documentId !== undefined) invalid("target cannot be combined with documentId.");
    return {
      ...(input.canvasId === undefined ? {} : {canvasId:string(input.canvasId, "canvasId")}),
      ...(input.instanceId === undefined ? {} : {instanceId:string(input.instanceId, "instanceId")}),
      title:string(input.title, "title", { max:MAX_TITLE_CHARS }),
      ...(input.target === undefined ? {} : {target:input.target}),
      ...(input.documentId === undefined ? {} : { documentId:string(input.documentId, "documentId", { max:256 }) }),
      ...(input.takeover === undefined ? {} : { takeover:bool(input.takeover, "takeover", false) }),
      ...(input.client === undefined ? {} : { client:string(input.client, "client", { max:120 }) }),
      ...(input.sessionKey === undefined ? {} : { sessionKey:string(input.sessionKey, "sessionKey", { max:128 }) }),
      ...(input.restore === undefined ? {} : {restore:bool(input.restore, "restore", true)}),
      ...(input.show === undefined ? {} : {show:bool(input.show, "show", false)}),
    };
  },
  penecho_list_files(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "path", "region", "offset", "limit"]), "arguments");
    return {
      sessionId:string(input.sessionId, "sessionId"),
      path:virtualPath(input.path, "path", { defaultValue:"/" }),
      ...(input.region === undefined ? {} : {region:region(input.region)}),
      offset:input.offset === undefined ? 0 : integer(input.offset, "offset", {min:0,max:Number.MAX_SAFE_INTEGER}),
      limit:input.limit === undefined ? 50 : integer(input.limit, "limit", {min:1,max:MAX_FILES_PER_PAGE}),
    };
  },
  penecho_read_file(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "path", "startLine", "endLine"]), "arguments");
    const output = { sessionId:string(input.sessionId, "sessionId"), path:virtualPath(input.path) };
    if (input.startLine !== undefined) output.startLine = integer(input.startLine, "startLine", {min:1,max:Number.MAX_SAFE_INTEGER});
    if (input.endLine !== undefined) output.endLine = integer(input.endLine, "endLine", {min:1,max:Number.MAX_SAFE_INTEGER});
    if (output.endLine !== undefined && output.startLine !== undefined && output.endLine < output.startLine) invalid("endLine must be greater than or equal to startLine.");
    return output;
  },
  penecho_patch_file(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "path", "contentHash", "patch", "requestId"]), "arguments");
    return {
      sessionId:string(input.sessionId, "sessionId"),
      path:virtualPath(input.path),
      contentHash:string(input.contentHash, "contentHash", { max:256 }),
      patch:boundedContent(input.patch, "patch"),
      requestId:string(input.requestId, "requestId", { max:128 }),
    };
  },
  penecho_upload_image(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "requestId", "name", "source"]), "arguments");
    return {sessionId:string(input.sessionId,"sessionId"),requestId:string(input.requestId,"requestId",{max:128}),name:string(input.name,"name",{max:200}),source:imageSource(input.source)};
  },
  penecho_place_image(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "requestId", "source", "width", "height", "region"]), "arguments");
    const output={sessionId:string(input.sessionId,"sessionId"),requestId:string(input.requestId,"requestId",{max:128}),source:imageSource(input.source)};
    for (const key of ["width","height"]) if(input[key]!==undefined) output[key]=finiteNumber(input[key],key,{min:80,max:1_000_000_000});
    if(input.region!==undefined)output.region=region(input.region);
    return output;
  },
  penecho_edit_canvas(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "requestId", "action", "objectId", "text", "source", "region", "width", "height", "baseRevision", "strokes"]), "arguments");
    const action = enumValue(input.action, EDIT_ACTIONS, "action");
    const output = {sessionId:string(input.sessionId, "sessionId"),requestId:string(input.requestId, "requestId", {max:128}),action};
    if (input.strokes !== undefined) {
      if (!Array.isArray(input.strokes) || input.strokes.length < 1 || input.strokes.length > 16) invalid("strokes requires 1–16 strokes.");
      let count=0;
      output.strokes=input.strokes.map((entry,index)=>{
        const label=`strokes[${index}]`; object(entry,label); exactKeys(entry,new Set(["points","color","width"]),label);
        if (!/^#[0-9a-fA-F]{6}$/.test(entry.color)) invalid(`${label}.color requires #RRGGBB.`);
        const width=finiteNumber(entry.width,`${label}.width`,{min:1,max:64});
        if (!Array.isArray(entry.points)||entry.points.length<1||entry.points.length>256) invalid(`${label}.points requires 1–256 points.`);
        count+=entry.points.length;if(count>1024)invalid("draw_ink allows at most 1024 total points.");
        return {color:entry.color,width,points:entry.points.map(point=>{object(point,"point");exactKeys(point,new Set(["x","y"]),"point");return {x:finiteNumber(point.x,"point.x",{min:width/2,max:20000-width/2}),y:finiteNumber(point.y,"point.y",{min:width/2,max:20000-width/2})};})};
      });
      const points=output.strokes.flatMap(stroke=>stroke.points);
      if(Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))>2048||Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))>2048)invalid("draw_ink points must fit within a 2048 × 2048 world-coordinate region.");
    }
    if (input.objectId !== undefined) output.objectId = string(input.objectId, "objectId", {max:128});
    if (input.text !== undefined) output.text = boundedContent(input.text, "text");
    if (input.source !== undefined) output.source = imageSource(input.source);
    if (input.region !== undefined) output.region = region(input.region);
    if (input.width !== undefined) output.width = finiteNumber(input.width, "width", {min:1,max:1_000_000_000});
    if (input.height !== undefined) output.height = finiteNumber(input.height, "height", {min:1,max:1_000_000_000});
    if (input.baseRevision !== undefined) output.baseRevision = integer(input.baseRevision, "baseRevision", {min:0,max:Number.MAX_SAFE_INTEGER});
    const keys = new Set(Object.keys(output).filter(key => !["sessionId", "requestId", "action"].includes(key)));
    const requireOnly = (required, optional = []) => {
      for (const key of required) if (!keys.has(key)) invalid(`${key} is required for ${action}.`);
      for (const key of keys) if (![...required, ...optional].includes(key)) invalid(`${key} is not valid for ${action}.`);
    };
    requireOnly(EDIT_FIELDS[action].required, EDIT_FIELDS[action].optional);
    if (action === "replace_image" && (keys.has("width") !== keys.has("height"))) invalid("width and height must be provided together.");
    return output;
  },
  penecho_capture_canvas(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "target", "objectId", "artifactId", "region", "quality"]), "arguments");
    const target = input.target === undefined ? "viewport" : enumValue(input.target, CAPTURE_TARGETS, "target");
    const output = {
      sessionId:string(input.sessionId, "sessionId"),
      target,
      quality:input.quality === undefined ? "basic" : enumValue(input.quality, CAPTURE_QUALITIES, "quality"),
    };
    if (input.objectId !== undefined) output.objectId = string(input.objectId, "objectId", {max:128});
    if (input.artifactId !== undefined) output.artifactId = string(input.artifactId, "artifactId");
    if (target === "artifact" && !output.artifactId) invalid("artifactId is required for artifact capture.");
    if (target !== "artifact" && output.artifactId !== undefined) invalid("artifactId is valid only for artifact capture.");
    if (input.region !== undefined) output.region = region(input.region);
    if (target === "object" && output.objectId === undefined) invalid("objectId is required for object capture.");
    if (target === "region" && output.region === undefined) invalid("region is required for region capture.");
    if (target !== "object" && output.objectId !== undefined) invalid("objectId is valid only for object capture.");
    if (target !== "region" && output.region !== undefined) invalid("region is valid only for region capture.");
    return output;
  },
  penecho_inbox(input) {
    object(input, "arguments");
    const mode = input.mode === undefined ? "read" : enumValue(input.mode, new Set(["read","ack"]), "mode");
    const sessionId = string(input.sessionId,"sessionId");
    if (mode === "ack") {
      exactKeys(input,new Set(["sessionId","mode","ids","status","message"]),"arguments");
      if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > MAX_REQUEST_IDS) invalid("ids is invalid.");
      const ids=input.ids.map((id,i)=>string(id,`ids[${i}]`));
      if(new Set(ids).size!==ids.length) invalid("ids contains duplicates.");
      return {sessionId,mode,ids,status:enumValue(input.status,MESSAGE_STATUSES,"status"),...(input.message===undefined?{}:{message:string(input.message,"message",{min:0,max:1000})})};
    }
    exactKeys(input,new Set(["sessionId","mode","messageAfter","feedbackAfter","limit","capture","quality"]),"arguments");
    if(input.capture!==undefined && typeof input.capture!=="boolean") invalid("capture is invalid.");
    if(input.quality!==undefined && input.capture!==true) invalid("quality requires capture:true.");
    return {sessionId,mode,messageAfter:input.messageAfter===undefined?0:integer(input.messageAfter,"messageAfter",{min:0,max:Number.MAX_SAFE_INTEGER}),...(input.feedbackAfter===undefined?{}:{feedbackAfter:integer(input.feedbackAfter,"feedbackAfter",{min:0,max:Number.MAX_SAFE_INTEGER})}),limit:input.limit===undefined?10:integer(input.limit,"limit",{min:1,max:MAX_MESSAGES_PER_PAGE}),capture:input.capture===true,...(input.quality===undefined?{}:{quality:enumValue(input.quality,CAPTURE_QUALITIES,"quality")})};
  },
  penecho_update_session(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "title", "status", "summary", "steps", "events"]), "arguments");
    const output = { sessionId:string(input.sessionId, "sessionId") };
    if (input.title !== undefined) output.title = string(input.title, "title", { max:MAX_TITLE_CHARS });
    if (input.status !== undefined) output.status = enumValue(input.status, SESSION_STATUSES, "status");
    if (input.summary !== undefined) output.summary = string(input.summary, "summary", { min:0, max:MAX_SUMMARY_CHARS });
    if (input.steps !== undefined) output.steps = validateSteps(input.steps);
    if (input.events !== undefined) output.events = validateEvents(input.events);
    if (Object.keys(output).length === 1) invalid("At least one session update field is required.");
    return output;
  },
  penecho_present_widget(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "artifactId", "title", "html", "width", "height", "capture", "quality", "presentation"]), "arguments");
    const html = typeof input.html === "string" ? input.html : invalid("html is invalid.");
    if (!html || html.length > MAX_HTML_CHARS || Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) invalid("html is invalid or too large.");
    if (input.capture !== undefined && typeof input.capture !== "boolean") invalid("capture is invalid.");
    if (input.quality !== undefined && input.capture !== true) invalid("quality requires capture to be true.");
    const capture = input.capture === true;
    const presentation = validatePresentation(input.presentation, {kind:"widget",capture,hasExplicitDimensions:input.width !== undefined || input.height !== undefined});
    const dimensions = presentationDimensions(input, presentation, {maxWidth:4096,maxHeight:4096});
    return {
      sessionId:string(input.sessionId, "sessionId"),
      artifactId:string(input.artifactId, "artifactId"),
      title:string(input.title, "title", { max:MAX_TITLE_CHARS }),
      html,
      ...dimensions,
      ...(presentation === undefined ? {} : {presentation}),
      ...(input.capture === undefined ? {} : { capture:input.capture }),
      ...(input.quality === undefined ? {} : { quality:enumValue(input.quality, new Set(["basic", "detail"]), "quality") }),
    };
  },
  penecho_draw(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "artifactId", "title", "items", "capture", "presentation"]), "arguments");
    if (input.capture !== undefined && typeof input.capture !== "boolean") invalid("capture is invalid.");
    return {
      sessionId:string(input.sessionId, "sessionId"),
      artifactId:string(input.artifactId, "artifactId"),
      title:string(input.title, "title", { max:MAX_TITLE_CHARS }),
      items:validateDrawItems(input.items),
      ...(input.presentation === undefined ? {} : {presentation:validatePresentation(input.presentation, {kind:"draw",capture:input.capture === true})}),
      ...(input.capture === undefined ? {} : { capture:input.capture }),
    };
  },
  penecho_plot(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId", "artifactId", "title", "expression", "width", "height", "xMin", "xMax", "yMin", "yMax", "color", "capture", "presentation"]), "arguments");
    if (input.capture !== undefined && typeof input.capture !== "boolean") invalid("capture is invalid.");
    const xDomain = validateDomainPair(input, "xMin", "xMax");
    const yDomain = validateDomainPair(input, "yMin", "yMax");
    if (input.yMin !== undefined && input.xMin === undefined) invalid("yMin and yMax require xMin and xMax.");
    const presentation = validatePresentation(input.presentation, {kind:"plot",capture:input.capture === true,hasExplicitDimensions:input.width !== undefined || input.height !== undefined});
    const dimensions = presentationDimensions(input, presentation, {maxWidth:1_600,maxHeight:1_200});
    return {
      sessionId:string(input.sessionId, "sessionId"),
      artifactId:string(input.artifactId, "artifactId"),
      title:string(input.title, "title", { max:MAX_TITLE_CHARS }),
      expression:string(input.expression, "expression", { max:180 }),
      ...dimensions,
      ...(presentation === undefined ? {} : {presentation}),
      ...xDomain,
      ...yDomain,
      ...(input.color === undefined ? {} : { color:color(input.color, "color") }),
      ...(input.capture === undefined ? {} : { capture:input.capture }),
    };
  },
  penecho_inspect_session(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId"]), "arguments");
    return { sessionId:string(input.sessionId, "sessionId") };
  },
  penecho_close_session(input) {
    object(input, "arguments");
    exactKeys(input, new Set(["sessionId"]), "arguments");
    return { sessionId:string(input.sessionId, "sessionId") };
  },
};

function presentationSchema({allowSize = true,allowInspect = false} = {}) {
  const properties = {
    intent:{type:"string",enum:[...PRESENTATION_INTENTS].filter(value => allowInspect || value !== "inspect"),default:"deliver"},
    role:{type:"string",enum:[...PRESENTATION_ROLES],default:"primary"},
    ...(allowSize ? {size:{type:"string",enum:[...PRESENTATION_SIZES],default:"page",description:"Preferred CSS viewport: base480×360, wide992×360, tall480×752, large992×752, page1200×800. Widget page/default fits available viewport; other dimensions are capped. Presets exclude width/height; source updates preserve geometry."}} : {}),
    relativeTo:{type:"string",minLength:1,maxLength:128},
    relation:{type:"string",enum:[...PRESENTATION_RELATIONS]},
    attention:{type:"string",enum:[...PRESENTATION_ATTENTION]},
  };
  return {
    type:"object",
    additionalProperties:false,
    properties,
    allOf:[
      {if:{required:["relation"]},then:{required:["relativeTo"]}},
      ...(allowInspect ? [{
        if:{properties:{intent:{const:"inspect"}},required:["intent"]},
        then:{properties:{attention:{const:"quiet"}},not:{anyOf:[{required:["relativeTo"]},{required:["relation"]}]}},
      }] : []),
    ],
  };
}

const TOOLS = [
  {name:"penecho_inbox",description:"Read independent message/feedback pages; preserve both cursors. Only mode:ack marks IDs. Screenshots are opt-in.",inputSchema:{type:"object",additionalProperties:false,required:["sessionId"],properties:{sessionId:{type:"string",minLength:1,maxLength:128},mode:{type:"string",enum:["read","ack"],default:"read"},messageAfter:{type:"integer",minimum:0,default:0},feedbackAfter:{type:"integer",minimum:0},limit:{type:"integer",minimum:1,maximum:50,default:10},capture:{type:"boolean",default:false},quality:{type:"string",enum:["basic","detail"]},ids:{type:"array",minItems:1,maxItems:50,uniqueItems:true,items:{type:"string",minLength:1,maxLength:128}},status:{type:"string",enum:[...MESSAGE_STATUSES]},message:{type:"string",maxLength:1000}},allOf:[{if:{properties:{mode:{const:"ack"}},required:["mode"]},then:{required:["ids","status"],properties:{messageAfter:false,feedbackAfter:false,limit:false,capture:false,quality:false}},else:{properties:{ids:false,status:false,message:false}}},{if:{required:["quality"]},then:{required:["capture"],properties:{capture:{const:true}}}}]}},
  {
    name:"penecho_get_guidance",
    description:"Read task-specific authoring guidance. Visual Explorer always includes the complete design contract; other guides are brief by default, full for complete examples and rules. Reuse unchanged version/hash.",
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    inputSchema:{type:"object",additionalProperties:false,required:["id"],properties:{id:{type:"string",enum:[...GUIDANCE_IDS]},detail:{type:"string",enum:["brief","full"],default:"brief"}}},
  },
  {
    name:"penecho_list_canvases",
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    description:"List every open document published by opted-in, MCP-enabled browser connections. Entries match the browser MCP list; closed documents are excluded. Use exact instanceId/canvasId/documentId values.",
    inputSchema:{ type:"object", additionalProperties:false, properties:{} },
  },
  { name:"penecho_open_canvas", description:"Open an exact saved document or create one. show:true changes the view only on user request. requestId is idempotent.", inputSchema:{type:"object",additionalProperties:false,required:["instanceId","canvasId","requestId"],properties:{instanceId:{type:"string",minLength:1,maxLength:128},canvasId:{type:"string",minLength:1,maxLength:128},documentId:{type:"string",minLength:1,maxLength:256},locator:{type:"object",additionalProperties:false,required:["location","id"],properties:{location:{type:"string",enum:[...STORAGE_LOCATIONS]},id:{type:"string",minLength:1,maxLength:512}}},create:{type:"boolean",default:false},title:{type:"string",minLength:1,maxLength:MAX_TITLE_CHARS},requestId:{type:"string",minLength:1,maxLength:128},show:{type:"boolean",default:false}},allOf:[{if:{properties:{create:{const:true}},required:["create"]},then:{properties:{documentId:false,locator:false}},else:{anyOf:[{required:["documentId"]},{required:["locator"]}],properties:{title:false}}}]} },
  { name:"penecho_rename_canvas", description:"Rename an already open document by exact instanceId, canvasId and documentId. No session is created. title is trimmed and limited to 48 characters. requestId is idempotent; saved reports whether existing saved metadata was renamed (false means workspace-only).", inputSchema:{type:"object",additionalProperties:false,required:["instanceId","canvasId","documentId","title","requestId"],properties:{instanceId:{type:"string",minLength:1,maxLength:128},canvasId:{type:"string",minLength:1,maxLength:128},documentId:{type:"string",minLength:1,maxLength:256},title:{type:"string",minLength:1,maxLength:48,pattern:"^(?!.*[\\u0000-\\u001f\\u007f])(?=.*\\S).*$"},requestId:{type:"string",minLength:1,maxLength:128}}} },
  { name:"penecho_find_canvases", description:"Query the open documents in one exact browser MCP list, optionally by documentId. Closed documents are excluded.", inputSchema:{type:"object",additionalProperties:false,required:["instanceId","canvasId"],properties:{instanceId:{type:"string",minLength:1,maxLength:128},canvasId:{type:"string",minLength:1,maxLength:128},documentId:{type:"string",minLength:1,maxLength:256}}} },
  {
    name:"penecho_start_session",
    description:"Use unique stable sessionKey/client; retain sessionId/documentId. New sessions get a background Canvas on the latest opted-in browser; target:current binds the visible document. documentId restores an exact document; existing bindings stay. Only confirmed missing documents permit replacement; restore:false forbids it. show:true changes view.",
    inputSchema:{ type:"object", additionalProperties:false, required:["title"], not:{required:["target","documentId"]}, properties:{ canvasId:{type:"string",minLength:1,maxLength:128}, instanceId:{type:"string",minLength:1,maxLength:128}, documentId:{type:"string",minLength:1,maxLength:256}, target:{type:"string",enum:["current"]}, takeover:{type:"boolean",default:false}, title:{type:"string",minLength:1,maxLength:MAX_TITLE_CHARS}, client:{type:"string",minLength:1,maxLength:120}, sessionKey:{type:"string",minLength:1,maxLength:128}, restore:{type:"boolean",default:true}, show:{type:"boolean",default:false} } },
  },
  { name:"penecho_list_files", description:"Page virtual Canvas files, optionally in a region. Paths are virtual, never host paths.", inputSchema:{type:"object",additionalProperties:false,required:["sessionId"],properties:{sessionId:{type:"string",minLength:1,maxLength:128},path:{type:"string",default:"/",maxLength:1024},region:{type:"object",additionalProperties:false,required:["x","y","w","h"],properties:{x:{type:"number"},y:{type:"number"},w:{type:"number",exclusiveMinimum:0},h:{type:"number",exclusiveMinimum:0}}},offset:{type:"integer",minimum:0,default:0},limit:{type:"integer",minimum:1,maximum:MAX_FILES_PER_PAGE,default:50}}} },
  { name:"penecho_read_file", description:"Read virtual source and contentHash; optional line range. Runtime files are observations, not editable source.", inputSchema:{type:"object",additionalProperties:false,required:["sessionId","path"],properties:{sessionId:{type:"string",minLength:1,maxLength:128},path:{type:"string",minLength:1,maxLength:1024},startLine:{type:"integer",minimum:1},endLine:{type:"integer",minimum:1}}} },
  { name:"penecho_patch_file", description:"Apply one strict unified diff to the read path/contentHash. Use --- a/<path>, +++ b/<path> and exact @@ hunk counts; no Begin Patch envelopes or line-number prefixes. SOURCE_CONFLICT needs a fresh read and requestId; unknown outcomes need identical retries.", inputSchema:{type:"object",additionalProperties:false,required:["sessionId","path","contentHash","patch","requestId"],properties:{sessionId:{type:"string",minLength:1,maxLength:128},path:{type:"string",minLength:1,maxLength:1024},contentHash:{type:"string",minLength:1,maxLength:256},patch:{type:"string",maxLength:MAX_FILE_BYTES},requestId:{type:"string",minLength:1,maxLength:128}}} },
  { name:"penecho_upload_image", description:"Save an image without placement. Existing chat attachment Data URLs remain supported. For files use configured client.js --upload-image with canvasId/documentId (server converts); source cannot be a filesystem path. Reuse returned source in Widget HTML or place_image. requestId is idempotent.", inputSchema:{type:"object",additionalProperties:false,required:["sessionId","requestId","name","source"],properties:{sessionId:{type:"string",minLength:1,maxLength:128},requestId:{type:"string",minLength:1,maxLength:128},name:{type:"string",minLength:1,maxLength:200},source:{type:"string",maxLength:MAX_FILE_BYTES,description:"Full PNG/JPEG/WebP base64 Data URL, at most 800000 UTF-8 bytes including prefix; or authorized same-document penecho-asset:<64 lowercase hex sha256> / penecho-ref:objects/<id>/image. No host paths or remote URLs. The bridge must be installed at ~/.penecho/mcp/client.js (macOS/Linux) or %USERPROFILE%/.penecho/mcp/client.js (Windows), not the skill/application directory. Do not choose another location. The PenEcho MCP configuration and upload commands must use this same fixed path expanded against the current user home; reuse the configured Node executable and host ID. For a file on the agent computer, instead run the configured bridge: node \"<absolute client.js>\" --host-id HOST_ID --upload-image \"<absolute image path>\" --canvas-id CANVAS_ID --document-id DOCUMENT_ID --request-id UNIQUE_ID. Reuse the configured Node executable, environment and --state-directory when present. Get HOST_ID and ready-to-use upload args from penecho_start_session result.imageUpload. New conversations need no setup history or configuration lookup. HOST_ID identifies the PenEcho server. It is NOT canvasId, documentId or sessionId. Copy it exactly; never guess or derive it. client.js resolves the current HTTPS address/port automatically from its state and discovery; do not inspect source code or manually select a port. Obtain canvasId and documentId from penecho_start_session with target:current; keep that exact Canvas document open/current. The CLI uploads original bytes using the same MCP HTTPS port and authentication; server-side processing needs no client converter or Base64. Maximum input 32 MiB; supports PNG, WebP, JPG/JPEG, GIF, TIFF, AVIF (HEIC/HEIF codec-dependent). Prefer WebP generally, PNG for lossless diagrams/transparency, JPEG for photos. Reuse returned source verbatim in Widget img src/CSS url() or penecho_place_image; never invent an asset hash. Retry uncertain uploads with identical target/file/requestId."}}} },
  { name:"penecho_place_image", description:"Place an authorized image. Omit region for auto-layout; region positions, width/height size (minimum80). One dimension preserves aspect ratio. Reuse requestId on uncertain outcomes.", inputSchema:{type:"object",additionalProperties:false,required:["sessionId","requestId","source"],properties:{sessionId:{type:"string",minLength:1,maxLength:128},requestId:{type:"string",minLength:1,maxLength:128},source:{type:"string",maxLength:MAX_FILE_BYTES},width:{type:"number",minimum:80,maximum:1_000_000_000},height:{type:"number",minimum:80,maximum:1_000_000_000},region:{type:"object",additionalProperties:false,required:["x","y","w","h"],properties:{x:{type:"number"},y:{type:"number"},w:{type:"number",exclusiveMinimum:0},h:{type:"number",exclusiveMinimum:0}}}}} },
  { name:"penecho_edit_canvas", description:"One idempotent edit. create_text without region uses auto-layout; annotate existing content with evidenced world region. Existing geometry/destructive edits require baseRevision. draw_ink requires world points, #RRGGBB and width1\u201364, at most1024 points in2048\u00d72048. Image sources must be document-owned references or data URLs.", inputSchema:{type:"object",additionalProperties:false,required:["sessionId","requestId","action"],properties:{sessionId:{type:"string",minLength:1,maxLength:128},requestId:{type:"string",minLength:1,maxLength:128},action:{type:"string",enum:[...EDIT_ACTIONS]},objectId:{type:"string",minLength:1,maxLength:128},text:{type:"string",maxLength:MAX_FILE_BYTES},source:{description:"replace_image: PNG/JPEG/WebP data URL (800000 bytes), or same-document penecho-ref:objects/<id>/image / penecho-asset:<64 lowercase hex sha256>. No raw Base64, host paths or remote URLs.",type:"string",maxLength:MAX_FILE_BYTES},region:{description:"World coordinates (not screen/scene). move/erase_ink require region. create_text annotations use existing geometry; standalone text omits region. x/y position text; w/h do not size it.",type:"object",additionalProperties:false,required:["x","y","w","h"],properties:{x:{type:"number"},y:{type:"number"},w:{type:"number",exclusiveMinimum:0},h:{type:"number",exclusiveMinimum:0}}},width:{type:"number",exclusiveMinimum:0},height:{type:"number",exclusiveMinimum:0},strokes:{type:"array",minItems:1,maxItems:16,items:{type:"object",additionalProperties:false,required:["points","color","width"],properties:{color:{type:"string",pattern:"^#[0-9a-fA-F]{6}$"},width:{type:"number",minimum:1,maximum:64},points:{type:"array",minItems:1,maxItems:256,items:{type:"object",additionalProperties:false,required:["x","y"],properties:{x:{type:"number",minimum:0,maximum:20000},y:{type:"number",minimum:0,maximum:20000}}}}}}},baseRevision:{description:"Current canvas.json revision for edits to existing content and draw_ink. Forbidden for create_text and show.",type:"integer",minimum:0}},allOf:Object.entries(EDIT_FIELDS).map(([action,{required,optional=[]}])=>({if:{properties:{action:{const:action}},required:["action"]},then:{...(required.length?{required}:{}),properties:Object.fromEntries(EDIT_ARGUMENT_FIELDS.filter(key=>![...required,...optional].includes(key)).map(key=>[key,false])),...(action==="replace_image"?{dependencies:{width:["height"],height:["width"]}}:{})}}))} },
  { name:"penecho_capture_canvas", description:"Capture unresolved visual evidence only; reuse unchanged images. Hidden documents return CANVAS_NOT_VISIBLE without navigation. target:artifact requires artifactId; object/region require matching selector. Default basic; detail only for legibility.", inputSchema:{type:"object",additionalProperties:false,required:["sessionId"],properties:{sessionId:{type:"string",minLength:1,maxLength:128},target:{type:"string",enum:[...CAPTURE_TARGETS],default:"viewport"},objectId:{type:"string",minLength:1,maxLength:128},region:{type:"object",additionalProperties:false,required:["x","y","w","h"],properties:{x:{type:"number"},y:{type:"number"},w:{type:"number",exclusiveMinimum:0},h:{type:"number",exclusiveMinimum:0}}},quality:{type:"string",enum:[...CAPTURE_QUALITIES],default:"basic"}},allOf:[{if:{properties:{target:{const:"object"}},required:["target"]},then:{required:["objectId"]},else:{properties:{objectId:false}}},{if:{properties:{target:{const:"region"}},required:["target"]},then:{required:["region"]},else:{properties:{region:false}}}]} },


  {
    name:"penecho_update_session",
    description:"Queue public progress/status when useful. Response is acceptance, not paint proof. Prefer mutation completion for final status; no routine progress round trips.",
    inputSchema:{ type:"object", additionalProperties:false, required:["sessionId"], properties:{ sessionId:{type:"string",minLength:1,maxLength:128}, title:{type:"string",minLength:1,maxLength:MAX_TITLE_CHARS}, status:{type:"string",enum:[...SESSION_STATUSES]}, summary:{type:"string",maxLength:MAX_SUMMARY_CHARS}, steps:{type:"array",maxItems:MAX_STEPS,items:{type:"object",additionalProperties:false,required:["id","label"],properties:{id:{type:"string",minLength:1,maxLength:64},label:{type:"string",minLength:1,maxLength:160},status:{type:"string",enum:[...STEP_STATUSES]}}}}, events:{type:"array",maxItems:MAX_EVENTS_PER_UPDATE,items:{type:"object",additionalProperties:false,required:["id","text"],properties:{id:{type:"string",minLength:1,maxLength:64},text:{type:"string",minLength:1,maxLength:500},kind:{type:"string",enum:[...EVENT_KINDS]}}}} },anyOf:["title","status","summary","steps","events"].map(key=>({required:[key]})) },
  },
  {
    name:"penecho_present_widget",
    description:"Render rich explanations, sequence/flow diagrams (including static diagrams), and product UI as an HTML/CSS/SVG Widget. Create/update stable artifactId, preserving geometry; returned viewport is actual CSS size. relativeTo is a known artifactId. inspect requires capture:true and renders exact dimensions without saving an object. Capture failures may leave applied:true. Format source for patches.",
    inputSchema:{ type:"object", additionalProperties:false, required:["sessionId","artifactId","title","html"], properties:{sessionId:{type:"string",minLength:1,maxLength:128},artifactId:{type:"string",minLength:1,maxLength:128},title:{type:"string",minLength:1,maxLength:MAX_TITLE_CHARS},html:{type:"string",minLength:1,maxLength:MAX_HTML_CHARS},width:{type:"number",minimum:300,maximum:4096,description:"CSS width: capped on creation, exact for inspect."},height:{type:"number",minimum:200,maximum:4096,description:"CSS height: independently capped on creation, exact for inspect."},capture:{type:"boolean",default:false},quality:{type:"string",enum:["basic","detail"]},presentation:presentationSchema({allowInspect:true})}, allOf:[{if:{required:["quality"]},then:{required:["capture"],properties:{capture:{const:true}}}},{if:{properties:{presentation:{properties:{intent:{const:"inspect"}},required:["intent"]}},required:["presentation"]},then:{required:["capture"],properties:{capture:{const:true}}}},{if:{properties:{presentation:{required:["size"]}},required:["presentation"]},then:{not:{anyOf:[{required:["width"]},{required:["height"]}]}}}] },
  },

  {
    name:"penecho_draw",
    description:"Create/update a few simple native raster shapes/text or explicitly requested native drawing using stable artifactId. Prefer present_widget for rich explanations and sequence diagrams. Item coordinates are local scene coordinates; omit for auto-layout. Rect/ellipse minimum80. Host places the artifact. No editable vector handles; capture is opt-in.",
    inputSchema:{ type:"object", additionalProperties:false, required:["sessionId","artifactId","title","items"], properties:{ sessionId:{type:"string",minLength:1,maxLength:128}, artifactId:{type:"string",minLength:1,maxLength:128}, title:{type:"string",minLength:1,maxLength:MAX_TITLE_CHARS}, items:{type:"array",minItems:1,maxItems:MAX_DRAW_ITEMS,items:{type:"object",additionalProperties:false,required:["id","type"],properties:{id:{type:"string",minLength:1,maxLength:64},type:{type:"string",enum:[...DRAW_TYPES]},text:{type:"string",minLength:1,maxLength:1_000},x:{type:"number",minimum:0,maximum:2_400},y:{type:"number",minimum:0,maximum:2_400},width:{type:"number",minimum:8,maximum:1_200},height:{type:"number",minimum:8,maximum:1_200},color:{type:"string",pattern:COLOR_PATTERN.source},fill:{type:"string",pattern:COLOR_PATTERN.source},fontSize:{type:"number",minimum:12,maximum:64},strokeWidth:{type:"number",minimum:1,maximum:12},points:{type:"array",minItems:2,maxItems:MAX_DRAW_POINTS,items:{type:"object",additionalProperties:false,required:["x","y"],properties:{x:{type:"number",minimum:0,maximum:2_400},y:{type:"number",minimum:0,maximum:2_400}}}},from:{type:"string",minLength:1,maxLength:64},to:{type:"string",minLength:1,maxLength:64}},allOf:[{if:{required:["type"],properties:{type:{enum:["rect","ellipse"]}}},then:{properties:{width:{minimum:80},height:{minimum:80}}}}]}}, capture:{type:"boolean",default:false}, presentation:presentationSchema({allowSize:false}) } },
  },
  {
    name:"penecho_plot",
    description:"Create/update a native raster function plot safely from expression. Stable artifactId; no editable vector handles. Host places it. Capture is opt-in.",
    inputSchema:{ type:"object", additionalProperties:false, required:["sessionId","artifactId","title","expression"], properties:{sessionId:{type:"string",minLength:1,maxLength:128},artifactId:{type:"string",minLength:1,maxLength:128},title:{type:"string",minLength:1,maxLength:MAX_TITLE_CHARS},expression:{type:"string",minLength:1,maxLength:180},width:{type:"number",minimum:300,maximum:1_600},height:{type:"number",minimum:200,maximum:1_200},xMin:{type:"number",minimum:-1_000_000,maximum:1_000_000},xMax:{type:"number",minimum:-1_000_000,maximum:1_000_000},yMin:{type:"number",minimum:-1_000_000,maximum:1_000_000},yMax:{type:"number",minimum:-1_000_000,maximum:1_000_000},color:{type:"string",pattern:COLOR_PATTERN.source},capture:{type:"boolean",default:false},presentation:presentationSchema()}, allOf:[{if:{properties:{presentation:{required:["size"]}},required:["presentation"]},then:{not:{anyOf:[{required:["width"]},{required:["height"]}]}}}] },
  },

  { name:"penecho_inspect_session", description:"Inspect state/attention to diagnose an issue; no pixels or idle polling.", inputSchema:{type:"object",additionalProperties:false,required:["sessionId"],properties:{sessionId:{type:"string",minLength:1,maxLength:128}}} },
  { name:"penecho_close_session", description:"Close the bound session; retain its document content.", inputSchema:{type:"object",additionalProperties:false,required:["sessionId"],properties:{sessionId:{type:"string",minLength:1,maxLength:128}}} },
];

const COMMON_TOOL_NAMES = Object.freeze(["penecho_start_session","penecho_present_widget","penecho_read_file","penecho_patch_file","penecho_edit_canvas","penecho_inbox"]);
const MUTATION_TOOLS = new Set(["penecho_present_widget","penecho_patch_file","penecho_edit_canvas","penecho_upload_image","penecho_place_image","penecho_draw","penecho_plot"]);
for (const tool of TOOLS) {
  if(!COMMON_TOOL_NAMES.includes(tool.name))tool._meta={"penecho/usage":"specialized"};
  if(MUTATION_TOOLS.has(tool.name)) Object.assign(tool.inputSchema.properties,{
    output:{type:"string",enum:["concise","detailed"],default:"concise"},
    completion:{type:"object",additionalProperties:false,required:["status"],properties:{status:{type:"string",enum:[...COMPLETION_STATUSES]},summary:{type:"string",maxLength:600},handledMessageIds:{type:"array",maxItems:50,uniqueItems:true,items:{type:"string",minLength:1,maxLength:128}}}},
  });
  if(["penecho_present_widget","penecho_draw","penecho_plot"].includes(tool.name)) {tool.inputSchema.properties.requestId={type:"string",minLength:1,maxLength:128};tool.inputSchema.required.push("requestId");}
  if(["penecho_patch_file","penecho_edit_canvas","penecho_place_image","penecho_draw","penecho_plot"].includes(tool.name)) {
    tool.inputSchema.properties.capture={type:"boolean",default:false};
    tool.inputSchema.properties.quality={type:"string",enum:[...CAPTURE_QUALITIES]};
    (tool.inputSchema.allOf ||= []).push({if:{required:["quality"]},then:{required:["capture"],properties:{capture:{const:true}}}});
  }
  if(tool.name==="penecho_capture_canvas") {
    tool.inputSchema.properties.target.enum=[...CAPTURE_TARGETS];
    tool.inputSchema.allOf.push({if:{properties:{target:{const:"artifact"}},required:["target"]},then:{required:["artifactId"]},else:{properties:{artifactId:false}}});
    tool.inputSchema.properties.artifactId={type:"string",minLength:1,maxLength:128};
  }
}

function validateToolArguments(name, input) {
  const validate = validators[name];
  if (!validate) throw new McpBridgeError("tool_not_found", `Unknown tool: ${String(name || "")}.`, 404);
  if (!MUTATION_TOOLS.has(name)) return validate(input);
  object(input,"arguments");
  const {output,completion,...operation}=input;
  const extendedCapture=["penecho_patch_file","penecho_edit_canvas","penecho_place_image","penecho_draw","penecho_plot"].includes(name);
  const quality=extendedCapture?operation.quality:undefined;
  if(extendedCapture)delete operation.quality;
  const newCapture=["penecho_patch_file","penecho_edit_canvas","penecho_place_image"].includes(name);
  const capture=newCapture?operation.capture:undefined;
  if(newCapture)delete operation.capture;
  const artifactMutation=["penecho_present_widget","penecho_draw","penecho_plot"].includes(name);
  const requestId=artifactMutation?operation.requestId:undefined;
  if(artifactMutation)delete operation.requestId;
  const result=validate(operation);
  if(newCapture&&capture!==undefined){if(typeof capture!=="boolean")invalid("capture is invalid.");result.capture=capture;}
  if(extendedCapture&&quality!==undefined){if(result.capture!==true)invalid("quality requires capture to be true.");result.quality=enumValue(quality,CAPTURE_QUALITIES,"quality");}
  if(artifactMutation)result.requestId=string(requestId,"requestId");
  if(completion!==undefined && !result.requestId)invalid("completion requires requestId.");
  if(output!==undefined) result.output=enumValue(output,new Set(["concise","detailed"]),"output");
  if(completion!==undefined) {
    object(completion,"completion");exactKeys(completion,new Set(["status","summary","handledMessageIds"]),"completion");
    result.completion={status:enumValue(completion.status,COMPLETION_STATUSES,"completion.status")};
    if(completion.summary!==undefined)result.completion.summary=string(completion.summary,"completion.summary",{min:0,max:600});
    if(completion.handledMessageIds!==undefined){
      if(!Array.isArray(completion.handledMessageIds)||completion.handledMessageIds.length>MAX_REQUEST_IDS)invalid("completion.handledMessageIds is invalid.");
      const ids=completion.handledMessageIds.map(id=>string(id,"message ID"));if(new Set(ids).size!==ids.length)invalid("completion.handledMessageIds contains duplicates.");result.completion.handledMessageIds=ids;
    }
  }
  return result;
}

module.exports = {
  MAX_EVENTS_PER_UPDATE,
  MAX_FEEDBACK_ENTRIES,
  MAX_HTML_CHARS,
  MAX_HTML_BYTES,
  MAX_FILE_BYTES,
  McpBridgeError,
  TOOLS,
  COMMON_TOOL_NAMES,
  MUTATION_TOOLS,
  validateToolArguments,
};
