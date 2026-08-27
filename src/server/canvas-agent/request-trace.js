"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_TRACE_STRING_CHARS = 500_000;
const MAX_TRACE_DIAGNOSTIC_CHARS = MAX_TRACE_STRING_CHARS;
const MAX_TRACE_DIAGNOSTICS = 32;
const MAX_TRACE_IMAGE_DIAGNOSTICS = 32;
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

function nativeTraceEvent(event,connection) {
  if (!event?.kind || event.type) return event;
  const turn=Number.isSafeInteger(event.turn)?event.turn:null,step=Number.isSafeInteger(event.step)?event.step:1,
    nativeData={turn,step,engine:"codex-native"},provider=connection?.provider||"codex-cli",model=connection?.model||null;
  if (event.kind === "turn_start") return {type:"turn/start",data:nativeData};
  if (event.kind === "user_message") return {type:"user/message",data:{...nativeData,source:{kind:"user"},role:"user",content:[{type:"text",text:String(event.text||"")}]}};
  if (event.kind === "assistant_message") return {type:"assistant/message",data:{...nativeData,message:{role:"assistant",source:{provider,model},content:[{type:"text",text:String(event.text||"")}]},interrupted:Boolean(event.interrupted),usage:event.usage||null}};
  if (event.kind === "tool_call") return {type:"tool/call",data:{...nativeData,callId:event.callId||null,name:event.name||null,arguments:typeof event.arguments==="string"?event.arguments:JSON.stringify(event.arguments||{})}};
  if (event.kind === "tool_result") return {type:"tool/result",data:{...nativeData,message:{role:"tool",source:{callId:event.callId||null},content:[{type:"text",text:String(event.text||"")}]},error:event.error||null}};
  if (event.kind === "token_usage") return {type:"request/usage",data:{...nativeData,usage:event.tokenUsage||null}};
  if (event.kind === "compaction") return {type:"compaction/summary",data:{...nativeData,mode:event.mode||"native"}};
  if (event.kind === "turn_end") return {type:"turn/end",data:{...nativeData,reason:event.reason||{kind:"unknown"}}};
  return {type:`codex-native/${String(event.kind)}`,data:{...nativeData,event}};
}

function apiTraceTokenCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

function apiTraceRatio(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1_000_000) / 1_000_000 : 0;
}

function enrichApiUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value || null;
  if (!Object.hasOwn(value,"inputTokens")) return value;
  const inputTokens=apiTraceTokenCount(value.inputTokens),cacheReadTokens=apiTraceTokenCount(value.cacheReadTokens),
    cacheWriteTokens=apiTraceTokenCount(value.cacheWriteTokens),promptTokens=inputTokens+cacheReadTokens+cacheWriteTokens;
  return { ...value, promptTokens, cacheReadRatio:apiTraceRatio(cacheReadTokens,promptTokens), cacheWriteRatio:apiTraceRatio(cacheWriteTokens,promptTokens) };
}

function summarizeApiUsage(events) {
  const calls=new Map();
  events.forEach((event,index)=>{
    const usage=event?.data?.usage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage) || !Object.hasOwn(usage,"inputTokens")) return;
    const turn=event.data?.turn,step=event.data?.step,key=Number.isSafeInteger(turn)&&Number.isSafeInteger(step)?`${turn}:${step}`:`event:${index}`;
    calls.set(key,usage);
  });
  if (!calls.size) return null;
  let inputTokens=0,cacheReadTokens=0,cacheWriteTokens=0,promptTokens=0,outputTokens=0,reasoningTokens=0,cacheHitCalls=0;
  for (const usage of calls.values()) {
    const read=apiTraceTokenCount(usage.cacheReadTokens),write=apiTraceTokenCount(usage.cacheWriteTokens),input=apiTraceTokenCount(usage.inputTokens);
    inputTokens+=input;
    cacheReadTokens+=read;
    cacheWriteTokens+=write;
    promptTokens+=apiTraceTokenCount(usage.promptTokens) || input+read+write;
    outputTokens+=apiTraceTokenCount(usage.outputTokens);
    reasoningTokens+=apiTraceTokenCount(usage.reasoningTokens);
    if (read>0) cacheHitCalls++;
  }
  return {
    calls:calls.size,
    cacheHitCalls,
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    promptTokens,
    outputTokens,
    reasoningTokens,
    cacheReadRatio:apiTraceRatio(cacheReadTokens,promptTokens),
    cacheWriteRatio:apiTraceRatio(cacheWriteTokens,promptTokens),
    cacheHitRatio:apiTraceRatio(cacheHitCalls,calls.size),
  };
}

function turnStatus(reason) {
  if (reason?.kind === "aborted" || reason?.kind === "cancelled") return "cancelled";
  if (reason?.kind === "error" || reason?.kind === "failed" || reason?.kind === "timeout") return "failed";
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

  function persistImageDiagnostic(trace, image) {
    const data = Buffer.isBuffer(image?.data) ? image.data : image?.data instanceof Uint8Array ? Buffer.from(image.data) : null,
      stage=bounded(image?.stage,64) || "unknown", attachmentId=bounded(image?.attachmentId,256) || null,
      variantId=bounded(image?.variantId,256) || null, digest=data?.length ? crypto.createHash("sha256").update(data).digest("hex") : bounded(image?.sha256,64) || null,
      existing=trace.data.imageDiagnostics.find(record=>record.stage===stage&&record.attachmentId===attachmentId&&record.variantId===variantId&&record.sha256===digest);
    if (existing) {
      existing.uses += 1;
      existing.lastRecordedAt = isoTime(now());
      return existing;
    }
    let file=null;
    if (data?.length) {
      const ordinal=trace.data.imageDiagnostics.length+1,extension=imageExtension(image.mediaType),token=safeFileToken(image.attachmentId || trace.data.requestId,trace.data.requestId);
      file=`image-debug-${String(ordinal).padStart(2,"0")}-${safeFileToken(stage,"image")}-${token}-${digest.slice(0,12)}.${extension}`;
      fs.writeFileSync(path.join(trace.directory,file),data,{mode:0o600});
    }
    const { data:_data, ...details }=image && typeof image === "object" ? image : {};
    const safeDetails=safeValue(details),metadata={
      ...(safeDetails && typeof safeDetails === "object" && !Array.isArray(safeDetails) ? safeDetails : {}),
      file, sha256:digest, uses:1, recordedAt:isoTime(now()), lastRecordedAt:isoTime(now()),
    };
    trace.data.imageDiagnostics.push(metadata);
    if (trace.data.imageDiagnostics.length > MAX_TRACE_IMAGE_DIAGNOSTICS) trace.data.imageDiagnostics.splice(0,trace.data.imageDiagnostics.length-MAX_TRACE_IMAGE_DIAGNOSTICS);
    return metadata;
  }

  function begin(entry, event, state) {
    const requestId = createRequestId(), timestamp = now(), name = `${String(timestamp).padStart(13,"0")}-${requestId}`, directory = traceChild(name);
    if (!directory) throw new Error("Invalid PenEcho Agent request trace path.");
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
      ...(state.connection?.provider === "api" ? { apiUsage:null } : {}),
      steps:[],
      screenshots:[],
      imageDiagnostics:[],
      events:[],
      diagnostics:[],
      patchProtocol:[],
      final:null,
      error:null,
      note:"PenEcho Agent server trace; sessionId is a non-resumable debug correlation ID.",
    } };
    state.active = trace;
    for (const asset of state.pendingAssets.splice(0)) persistAsset(state,trace,asset);
    for (const image of state.pendingImageDiagnostics.splice(0)) persistImageDiagnostic(trace,image);
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
      state = { connection:safeValue(entry.connection), active:null, header:null, context:null, pendingAssets:[], pendingImageDiagnostics:[], unassignedVision:[], pendingEvents:[], engine:null, usage:null };
      conversations.set(entry.conversationId,state);
    }
    return state;
  }

  function record(entry) {
    if (!entry?.conversationId) return;
    if (entry.phase === "start") {
      conversations.set(entry.conversationId,{ connection:safeValue(entry.connection), active:null, header:null, context:null, pendingAssets:[], pendingImageDiagnostics:[], unassignedVision:[], pendingEvents:[], engine:null, usage:null });
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
    if (entry.phase === "image-debug") {
      if (state.active) { persistImageDiagnostic(state.active,entry.image); write(state.active); }
      else {
        state.pendingImageDiagnostics.push(entry.image);
        if (state.pendingImageDiagnostics.length > MAX_TRACE_IMAGE_DIAGNOSTICS) state.pendingImageDiagnostics.splice(0,state.pendingImageDiagnostics.length-MAX_TRACE_IMAGE_DIAGNOSTICS);
      }
      return;
    }
    if (entry.phase === "patch-protocol") {
      if (!state.active) return;
      const pendingStep = state.active.data.steps.findLast(item=>item.status==="in-flight"), record = safeValue(entry.record || {});
      state.active.data.patchProtocol.push({
        recordedAt:isoTime(now()),
        turn:pendingStep?.turn ?? null,
        step:pendingStep?.step ?? null,
        ...(record && typeof record === "object" && !Array.isArray(record) ? record : { value:record }),
      });
      write(state.active);
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
    if (entry.phase !== "event" || !entry.event) return;
    const event = safeValue(nativeTraceEvent(entry.event,state.connection));
    if (!event?.type || event.type === "assistant/chunk") return;
    if (state.connection?.provider === "api" && event.data?.usage) event.data.usage = enrichApiUsage(event.data.usage);
    if (!state.active && event.type === "user/message" && event.data?.engine === "codex-native") {
      state.pendingEvents.push(event);
      if (state.pendingEvents.length > 10) state.pendingEvents.splice(0,state.pendingEvents.length-10);
      return;
    }
    if (event.type === "turn/start") {
      if (state.active) complete(state.active,"abandoned",{ kind:"superseded-turn" });
      state.unassignedVision.length = 0;
      state.engine = event.data?.engine || null;
      state.usage = null;
      begin(entry,event,state);
    }
    const trace = state.active;
    if (!trace) return;
    if (event.type === "turn/start") {
      const turn=event.data?.turn;
      trace.data.events.push(...state.pendingEvents.splice(0).filter(item=>item.data?.turn===turn));
      if (state.engine === "codex-native") stepFor(trace,{...event,data:{...event.data,step:event.data?.step??1}},state,true);
    }
    trace.data.events.push(event);
    if (state.connection?.provider === "api" && event.data?.usage) trace.data.apiUsage = summarizeApiUsage(trace.data.events);
    if (event.type === "request/header") {
      state.header = event.data?.header || null;
      const pendingStep = trace.data.steps.findLast(item=>item.status==="in-flight");
      if (pendingStep) Object.assign(pendingStep,tracedEffort(state));
    } else if (event.type === "request/context") {
      state.context = event.data || null;
    } else if (event.type === "request/usage") {
      state.usage = event.data?.usage || null;
      const step = stepFor(trace,event,state,false);
      if (step?.response) step.response.usage = safeValue(state.usage);
    } else if (event.type === "step/start") {
      stepFor(trace,event,state,true);
    } else if (event.type === "assistant/message") {
      const step = stepFor(trace,event,state,true), message = event.data?.message || null;
      step.completedAt = isoTime(event.time);
      step.status = "completed";
      const messages=state.engine === "codex-native"
        ? trace.data.events.flatMap(item=>item.type === "user/message" ? [{role:"user",content:item.data?.content||[]}] : item.type === "tool/result" ? [item.data?.message].filter(Boolean) : [])
        : safeValue(entry.messages || []);
      step.payload = { messages:safeValue(messages) };
      step.outbound = {
        connection:safeValue(state.connection),
        config:safeValue(state.header?.config || state.context),
        system:safeValue(state.header?.system || null),
        tools:safeValue(state.header?.tools || []),
        messages:safeValue(messages),
        visionFiles:step.visionAssets.map(image=>image.file),
      };
      step.response = {
        provider:state.connection?.provider || message?.source?.provider || null,
        adapterProvider:message?.source?.provider || state.context?.provider || null,
        model:state.connection?.model || message?.source?.model || state.context?.model || null,
        status:200,
        upstream:null,
        usage:safeValue(event.data?.usage || state.usage || null),
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
      state.engine = null;
      state.usage = null;
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
