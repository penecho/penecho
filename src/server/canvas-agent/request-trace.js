"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_TRACE_STRING_CHARS = 500_000;
const MAX_TRACE_DIAGNOSTIC_CHARS = 64_000;
const MAX_TRACE_DIAGNOSTICS = 32;
const TRACE_SECRET_KEY = /(?:^|[-_])(?:authorization|proxy[-_]?authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|resume[-_]?token|cookie|password|secret)(?:$|[-_])/i;
const TRACE_SECRET_TEXT = /((?:authorization|proxy[-_]?authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|resume[-_]?token|cookie|password|secret|claude_code_oauth_token)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi;

function bounded(value, limit = MAX_TRACE_STRING_CHARS) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0,limit)}\n…[truncated]` : text;
}

function safeValue(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value,(key,item)=>{
      if (TRACE_SECRET_KEY.test(key)) return "<redacted>";
      if (item instanceof Error) return { name:item.name, message:bounded(item.message,65536), stack:bounded(item.stack,32768) };
      if (typeof item !== "string") return item;
      if (/^data:[^;,]+;base64,/i.test(item)) return "<encoded attachment omitted>";
      return bounded(item);
    });
  } catch (error) {
    return { serializationError:String(error?.message||error||"Could not serialize trace value.").slice(0,1000) };
  }
  return serialized === undefined ? null : JSON.parse(serialized);
}

function redactDiagnosticText(value) {
  return bounded(value,MAX_TRACE_DIAGNOSTIC_CHARS)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,"$1<redacted>")
    .replace(TRACE_SECRET_TEXT,"$1<redacted>")
    .replace(/([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|resume[-_]?token)=)[^&#\s]+/gi,"$1<redacted>")
    .replace(/\b(?:sk|xox[baprs]|gh[pousr])[-_][A-Za-z0-9_-]{12,}\b/g,"<redacted-token>");
}

function safeDiagnosticValue(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value,(key,item)=>{
      if (TRACE_SECRET_KEY.test(key)) return "<redacted>";
      if (typeof item === "string") return redactDiagnosticText(item);
      return item;
    });
  } catch (error) {
    return { serializationError:String(error?.message||error||"Could not serialize provider diagnostic.").slice(0,1000) };
  }
  return serialized === undefined ? null : JSON.parse(serialized);
}

function safeProviderDiagnostic(value) {
  const raw = bounded(value,MAX_TRACE_DIAGNOSTIC_CHARS);
  try { return { format:"json", value:safeDiagnosticValue(JSON.parse(raw)) }; }
  catch { return { format:"text", value:redactDiagnosticText(raw) }; }
}

function tracedEffort(state) {
  const mapping = state.connection?.effortMapping || null,
    requestedEffort = mapping?.requested || state.connection?.effort || state.header?.config?.reasoningEffort || null,
    providerEffort = mapping && Object.hasOwn(mapping,"value") ? mapping.value : state.header?.config?.reasoningEffort ?? requestedEffort;
  return { requestedEffort, providerEffort, effortMapping:safeValue(mapping) };
}

function isoTime(value, fallback = Date.now()) {
  const time = new Date(value ?? fallback);
  return Number.isNaN(time.getTime()) ? new Date(fallback).toISOString() : time.toISOString();
}

function assistantText(message) {
  return Array.isArray(message?.content)
    ? message.content.filter(block=>block?.type==="text").map(block=>String(block.text||"")).join("")
    : "";
}

function turnStatus(reason) {
  if (reason?.kind === "aborted") return "cancelled";
  if (reason?.kind === "error") return "failed";
  return "completed";
}

function imageExtension(mediaType) {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/gif") return "gif";
  return "webp";
}

function safeFileToken(value, fallback) {
  return String(value||fallback).replace(/[^A-Za-z0-9_-]+/g,"-").slice(0,64) || fallback;
}

function createCanvasAgentRequestTracer({ requestTraceDirectory, logger = () => {}, prune = () => {}, now = () => Date.now(), createRequestId = () => crypto.randomUUID() }) {
  const root = path.resolve(requestTraceDirectory);
  const conversations = new Map();

  function traceChild(name) {
    const target = path.resolve(root,name);
    return path.dirname(target) === root ? target : null;
  }

  function write(trace) {
    trace.data.updatedAt = isoTime(now());
    fs.writeFileSync(path.join(trace.directory,"trace.json"),JSON.stringify(trace.data,null,2),{encoding:"utf8",mode:0o600});
  }

  function complete(trace, status, reason, error = null) {
    if (!trace) return;
    trace.data.status = status;
    trace.data.completedAt = isoTime(now());
    trace.data.final = { httpStatus:null, body:{ reason:safeValue(reason) } };
    trace.data.error = error ? safeValue(error) : null;
    write(trace);
  }

  function persistAsset(state, trace, asset) {
    const data = Buffer.isBuffer(asset?.data) ? asset.data : asset?.data instanceof Uint8Array ? Buffer.from(asset.data) : null;
    if (!data?.length) return null;
    const ordinal = trace.data.screenshots.length + 1, extension = imageExtension(asset.mediaType), token = safeFileToken(asset.callId || asset.attachmentId,trace.data.requestId),
      file = `vision-${String(ordinal).padStart(2,"0")}-${token}.${extension}`;
    fs.writeFileSync(path.join(trace.directory,file),data,{mode:0o600});
    const metadata = {
      file,
      source:asset.source === "user" ? "user-attachment" : "canvas-capture",
      callId:asset.callId || null,
      attachmentId:asset.attachmentId || null,
      mimeType:asset.mediaType,
      bytes:data.length,
      width:Number(asset.width)||null,
      height:Number(asset.height)||null,
      cacheHit:Boolean(asset.cacheHit),
      reusedActiveImage:Boolean(asset.reusedActiveImage),
      capture:safeValue(asset.capture || null),
    };
    trace.data.screenshots.push(metadata);
    state.unassignedVision.push(metadata);
    return metadata;
  }

  function begin(entry, event, state) {
    const requestId = createRequestId(), timestamp = now(), name = `${String(timestamp).padStart(13,"0")}-${requestId}`, directory = traceChild(name);
    if (!directory) throw new Error("Invalid Canvas Agent request trace path.");
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const startedAt = isoTime(event?.time,timestamp), turn = event?.data?.turn ?? null, trace = { directory, data:{
      version:2,
      kind:"canvas-conversation-turn",
      requestId,
      startedAt,
      updatedAt:startedAt,
      completedAt:null,
      status:"in-flight",
      client:{ sessionId:entry.conversationId, turnId:turn === null ? null : `turn-${turn}`, connectionId:entry.connectionId },
      connection:safeValue(state.connection),
      qualityReviewEnabled:null,
      steps:[],
      screenshots:[],
      events:[],
      diagnostics:[],
      final:null,
      error:null,
      note:"DeepSeek Harness server trace; sessionId is a non-resumable debug correlation ID.",
    } };
    state.active = trace;
    for (const asset of state.pendingAssets.splice(0)) persistAsset(state,trace,asset);
    write(trace);
    prune();
    return trace;
  }

  function stepFor(trace, event, state, create = false) {
    const turn = event?.data?.turn ?? null, stepNumber = event?.data?.step ?? null;
    let step = trace.data.steps.find(item=>item.turn===turn&&item.step===stepNumber);
    if (!step && create) {
      const requestId = trace.data.steps.length ? createRequestId() : trace.data.requestId, efforts = tracedEffort(state), visionAssets = state.unassignedVision.splice(0);
      step = {
        requestId,
        kind:"agent",
        turn,
        step:stepNumber,
        startedAt:isoTime(event?.time),
        completedAt:null,
        status:"in-flight",
        ...efforts,
        payload:null,
        vision:visionAssets[0] || null,
        visionAssets,
        outbound:null,
        response:null,
        final:null,
        error:null,
      };
      trace.data.steps.push(step);
    }
    return step;
  }

  function stateFor(entry) {
    let state = conversations.get(entry.conversationId);
    if (!state) {
      state = { connection:safeValue(entry.connection), active:null, header:null, context:null, pendingAssets:[], unassignedVision:[] };
      conversations.set(entry.conversationId,state);
    }
    return state;
  }

  function record(entry) {
    if (!entry?.conversationId) return;
    if (entry.phase === "start") {
      conversations.set(entry.conversationId,{ connection:safeValue(entry.connection), active:null, header:null, context:null, pendingAssets:[], unassignedVision:[] });
      return;
    }
    const state = stateFor(entry);
    if (entry.phase === "resume") {
      if (entry.connection) state.connection = safeValue(entry.connection);
      return;
    }
    if (entry.phase === "asset") {
      if (state.active) { persistAsset(state,state.active,entry.asset); write(state.active); }
      else state.pendingAssets.push(entry.asset);
      return;
    }
    if (entry.phase === "diagnostic") {
      if (!state.active || !entry.diagnostic?.traceDiagnostic) return;
      const pendingStep = state.active.data.steps.findLast(item=>item.status==="in-flight"), diagnostic = entry.diagnostic;
      state.active.data.diagnostics.push({
        kind:"cli-provider",
        recordedAt:isoTime(now()),
        turn:pendingStep?.turn ?? null,
        step:pendingStep?.step ?? null,
        provider:bounded(diagnostic.provider,128),
        model:bounded(diagnostic.model,256) || null,
        error:safeValue(diagnostic.error || null),
        trace:safeProviderDiagnostic(diagnostic.traceDiagnostic),
      });
      if (state.active.data.diagnostics.length > MAX_TRACE_DIAGNOSTICS) state.active.data.diagnostics.splice(0,state.active.data.diagnostics.length-MAX_TRACE_DIAGNOSTICS);
      write(state.active);
      return;
    }
    if (entry.phase === "end") {
      if (state.active) complete(state.active,"abandoned",{ kind:"conversation-ended" });
      conversations.delete(entry.conversationId);
      return;
    }
    if (entry.phase !== "event" || !entry.event || entry.event.type === "assistant/chunk") return;
    const event = safeValue(entry.event);
    if (event.type === "turn/start") {
      if (state.active) complete(state.active,"abandoned",{ kind:"superseded-turn" });
      state.unassignedVision.length = 0;
      begin(entry,event,state);
    }
    const trace = state.active;
    if (!trace) return;
    trace.data.events.push(event);
    if (event.type === "request/header") {
      state.header = event.data?.header || null;
      const pendingStep = trace.data.steps.findLast(item=>item.status==="in-flight");
      if (pendingStep) Object.assign(pendingStep,tracedEffort(state));
    } else if (event.type === "request/context") {
      state.context = event.data || null;
    } else if (event.type === "step/start") {
      stepFor(trace,event,state,true);
    } else if (event.type === "assistant/message") {
      const step = stepFor(trace,event,state,true), message = event.data?.message || null;
      step.completedAt = isoTime(event.time);
      step.status = "completed";
      step.payload = { messages:safeValue(entry.messages || []) };
      step.outbound = {
        connection:safeValue(state.connection),
        config:safeValue(state.header?.config || state.context),
        system:safeValue(state.header?.system || null),
        tools:safeValue(state.header?.tools || []),
        messages:safeValue(entry.messages || []),
        visionFiles:step.visionAssets.map(image=>image.file),
      };
      step.response = {
        provider:state.connection?.provider || message?.source?.provider || null,
        adapterProvider:message?.source?.provider || state.context?.provider || null,
        model:state.connection?.model || message?.source?.model || state.context?.model || null,
        status:200,
        upstream:null,
        usage:safeValue(event.data?.usage || null),
        rawContent:assistantText(message),
        parsed:safeValue(message),
        interrupted:Boolean(event.data?.interrupted),
      };
      step.final = { httpStatus:null, body:{ interrupted:Boolean(event.data?.interrupted) } };
    } else if (event.type === "turn/end") {
      const reason = event.data?.reason || { kind:"unknown" }, status = turnStatus(reason), pendingStep = trace.data.steps.findLast(item=>item.status==="in-flight");
      if (pendingStep && status !== "completed") {
        pendingStep.completedAt = isoTime(event.time);
        pendingStep.status = status;
        pendingStep.payload ||= { messages:safeValue(entry.messages || []) };
        pendingStep.error = safeValue(reason.error || reason.reason || reason);
      }
      complete(trace,status,reason,status === "failed" ? reason.error || reason : null);
      state.active = null;
      state.unassignedVision.length = 0;
      return;
    }
    write(trace);
  }

  return entry=>{
    try { record(entry); }
    catch (error) { logger({ type:"canvas-agent-request-trace-error", error:String(error?.message||error).slice(0,2000) }); }
  };
}

module.exports = { createCanvasAgentRequestTracer };
