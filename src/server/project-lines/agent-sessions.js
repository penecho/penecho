"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { toolRow, partsText, tail, jsonOf, said, clip, cleanThinking, OUTPUT_MAX, TEXT_MAX } = require("./activity.js");
const { messageTime } = require("./pi-checkpoint.js");

const { unwrapReplies } = require("../../../public/lines/line-status.js");

// How to read conversations that OpenCode, Pi and dsh keep for themselves. Everything here only reads,
// and anything unexpected is skipped rather than guessed at.
const NOT_WORDS = /^\s*<(task-notification|agent-message|system-reminder|command-name|command-message|command-args|local-command|bash-input|bash-stdout|user-memory|ide_|tool_use_error|side-sessions-event|cross-session-message|ci-monitor-event|in-app-browser-context|artifact-view-context)/i;
const INJECTED_CONTEXT = /<(system-reminder|in-app-browser-context|artifact-view-context|side-sessions-event|cross-session-message|ci-monitor-event)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const SELF_INJECTED = /<(artifact-content-authored-by-others|in-app-browser-context|artifact-view-context|side-sessions-event|cross-session-message|ci-monitor-event)\b[^>]*\/>/gi;
const INTERRUPTED = /\[Request interrupted by user[^\]]*\]/gi;

// An agent's app writes its own summary of a long conversation as if the person had said it, and what PenEcho sends an agent is PenEcho talking, not the person.
const NOT_A_PERSON = /^(?:This session is being continued from a previous conversation|A person using PenEcho asked for this in the project|The person says:|The person decided: |The person approved the prototype|That is enough questions\. Do the work now|PenEcho could not use |They changed what they asked|Carry on where you stopped\.$)/;
// What a person actually typed, without what the agent's app added around it.
function humanWords(value) {
  // Unwrap structured question replies, strip app ambient/notification wrappers and paste tags, and drop synthetic markers.
  const text = unwrapReplies(value)
    .replace(SELF_INJECTED, "")
    .replace(INJECTED_CONTEXT, "")
    .replace(/<\/?pasted_content\b[^>]*>/g, "")
    .replace(INTERRUPTED, "")
    .trim();
  return !text || NOT_WORDS.test(text) || NOT_A_PERSON.test(text) || /^Caveat: /.test(text) ? "" : text;
}
const parseJson = line => { try { const o = JSON.parse(line); return o && typeof o === "object" ? o : null; } catch { return null; } };
const withPictures = (words, images) => [words, images ? `[${images} ${images === 1 ? "picture" : "pictures"}]` : ""].filter(Boolean).join("\n");
// Pictures kept with the words. One that cannot be found is at least counted.
const saying = (words, images, pictures) => {
  const me = withPictures(words, images - pictures.length);
  return me || pictures.length ? [{ me, ...(pictures.length ? { pictures } : {}) }] : [];
};
const textIn = value => typeof value === "string" ? value : Array.isArray(value) ? value.map(textIn).filter(Boolean).join("\n") : value && typeof value === "object" ? textIn(value.text ?? value.content ?? "") : "";

// ---------- Pi: one JSON line per event in a plain file ----------
// Pi puts the whole of a file you attach in front of what you typed. The words are what you typed, and the files are named after them.
function piWords(value) {
  const files = [], words = humanWords(String(value ?? "").replace(/<file name="([^"]*)">[\s\S]*?<\/file>\s*/g, (_, name) => { files.push(name.split(/[\\/]/).pop()); return ""; }));
  return [words, files.length ? `[Attached: ${files.join(", ")}]` : ""].filter(Boolean).join("\n\n");
}
function piLine(line) {
  const o = parseJson(line);
  if (!o) return null;
  if (o.type === "session") return { header:true, cwd:o.cwd };
  if (o.type !== "message" || !o.message) return null;
  const m = o.message, at = messageTime(m, o.timestamp), parts = Array.isArray(m.content) ? m.content : [{ type:"text", text:m.content }];
  if (m.role === "user") {
    const words = piWords(partsText(parts)), images = parts.filter(p => p?.type === "image");
    const pictures = images.filter(p => typeof p.data === "string" && p.data).map(p => ({ type:p.mimeType || "image/png", data:p.data }));
    return { at, turnOpen:true, changes:saying(words, images.length, pictures) };
  }
  if (m.role === "toolResult") return { at, turnOpen:true, changes:[{ patch:{ id:m.toolCallId, state:m.isError ? "failed" : "done", output:tail(partsText(parts), OUTPUT_MAX) } }] };
  if (m.role !== "assistant") return null;
  const changes = [];
  const hasText = parts.some(p => p?.type === "text" && p.text?.trim());
  const hasTool = parts.some(p => p?.type === "toolCall");
  if (!hasText && hasTool) {
    const thought = cleanThinking(parts.filter(p => p?.type === "thinking").map(p => p.thinking || "").join("\n\n"));
    if (thought) changes.push({ add:{ kind:"say", thinking:true, text:clip(thought, TEXT_MAX) } });
  }
  for (const part of parts) {
    if (part?.type === "text" && part.text?.trim()) changes.push(...said(part.text));
    if (part?.type === "toolCall") changes.push({ add:{ kind:"tool", id:part.id, state:"running", ...toolRow(part.name, part.arguments) } });
  }
  if (m.stopReason === "error" && m.errorMessage) changes.push({ add:{ kind:"note", text:m.errorMessage } });
  if (["error", "aborted"].includes(m.stopReason)) changes.push({ failed:m.errorMessage || "Pi stopped before finishing." });
  return { at, turnOpen:m.stopReason === "toolUse" || parts.some(p => p?.type === "toolCall"), changes };
}

// ---------- dsh: the same idea, as an event log in compressed frames ----------
// dsh keeps a picture in its own store, named by its hash, and the transcript names that.
const DSH_PICTURE_MOST = 32 * 1024 * 1024;
function dshPicture(part, home) {
  const hash = /^sha256:([0-9a-f]{64})$/.exec(String(part?.attachment?.attachmentId))?.[1];
  if (!home || !hash) return null;
  try {
    const file = path.join(home, "attachments", "v1", "objects", hash.slice(0, 2), hash);
    return fs.statSync(file).size > DSH_PICTURE_MOST ? null : { type:part.attachment.mediaType || "image/png", data:fs.readFileSync(file).toString("base64") };
  } catch { return null; }
}
function dshLine(line, home = "") {
  const o = parseJson(line);
  if (!o) return null;
  // A helper one conversation started is part of that conversation, not one of its own.
  if (o.type === "session") return { header:true, cwd:o.cwd, helper:Number(o.delegationDepth) > 0 };
  const at = Number(o.time) || 0, d = o.data || {}, seq = o.seq;
  switch (o.type) {
    case "turn/start": return { at, seq, turnOpen:true, changes:[] };
    case "turn/end": return { at, seq, turnOpen:false, changes:[] };
    case "user/message": {
      if (d.source?.kind && d.source.kind !== "user") return { at, seq, changes:[] };
      const parts = Array.isArray(d.content) ? d.content : [], words = humanWords(partsText(parts)), images = parts.filter(p => p?.type === "image");
      return { at, seq, turnOpen:true, changes:saying(words, images.length, images.map(p => dshPicture(p, home)).filter(Boolean)) };
    }
    case "assistant/message": {
      const content = Array.isArray(d.message?.content) ? d.message.content : [];
      const text = partsText(content);
      if (text.trim()) return { at, seq, changes:said(text) };
      const thought = cleanThinking(content.filter(p => p?.type === "reasoning" || p?.type === "thinking").map(p => p.text ?? p.thinking ?? "").join("\n\n"));
      return { at, seq, changes:thought ? [{ add:{ kind:"say", thinking:true, text:clip(thought, TEXT_MAX) } }] : [] };
    }
    case "tool/call": return { at, seq, turnOpen:true, changes:[{ add:{ kind:"tool", id:d.callId, state:"running", ...toolRow(d.name, jsonOf(d.arguments)) } }] };
    case "tool/result": {
      // A long result is sometimes replaced with a shorter one later. That is history, not more work.
      const surface = o.surfaceOp ?? d.surfaceOp;
      if (surface && surface !== "append") return { at, seq, changes:[] };
      const message = d.message || {}, first = (message.content || []).find(p => p?.type === "tool-result") || {}, id = message.toolCallId || first.toolCallId || message.source?.callId;
      return id ? { at, seq, turnOpen:true, changes:[{ patch:{ id, state:message.isError || first.isError ? "failed" : "done", output:tail(textIn(first.content ?? message.content), OUTPUT_MAX) } }] } : null;
    }
    default: return null;
  }
}
// Where one Zstandard frame ends, from what the format itself says, or -1 if it has not all been written yet.
function frameEnd(buffer, start) {
  if (start + 5 > buffer.length) return -1;
  const magic = buffer.readUInt32LE(start);
  if ((magic & 0xfffffff0) === 0x184d2a50) {
    if (start + 8 > buffer.length) return -1;
    const end = start + 8 + buffer.readUInt32LE(start + 4);
    return end <= buffer.length ? end : -1;
  }
  if (magic !== 0xfd2fb528) throw new Error("Not a Zstandard frame.");
  const flags = buffer[start + 4], single = (flags >> 5) & 1;
  let at = start + 5 + (single ? 0 : 1) + [0, 1, 2, 4][flags & 3] + [single ? 1 : 0, 2, 4, 8][flags >> 6];
  for (;;) {
    if (at + 3 > buffer.length) return -1;
    const head = buffer[at] | (buffer[at + 1] << 8) | (buffer[at + 2] << 16), type = (head >> 1) & 3, size = head >> 3;
    at += 3 + (type === 1 ? 1 : size);
    if (at > buffer.length) return -1;
    if (head & 1) break;
  }
  if ((flags >> 2) & 1) at += 4;
  return at <= buffer.length ? at : -1;
}
function readBytes(full, offset, length) {
  const buffer = Buffer.alloc(length), fd = fs.openSync(full, "r");
  try { return buffer.subarray(0, fs.readSync(fd, buffer, 0, length, offset)); } finally { fs.closeSync(fd); }
}
// New complete lines of a plain file, from a point in it. A line still being written waits for the next look.
function readPlain(full, offset, size, limit) {
  const length = Math.min(size - offset, limit);
  if (length <= 0) return { lines:[], next:offset };
  const buffer = readBytes(full, offset, length), end = buffer.lastIndexOf(10);
  return end < 0 ? { lines:[], next:offset } : { lines:buffer.subarray(0, end).toString("utf8").split("\n"), next:offset + end + 1 };
}
// The same from finished frames. Node before 22.15 cannot read these, and then there is simply nothing new.
function readFrames(full, offset, size, limit) {
  const length = Math.min(size - offset, limit);
  if (length <= 0 || typeof zlib.zstdDecompressSync !== "function") return { lines:[], next:offset };
  const buffer = readBytes(full, offset, length), lines = [];
  let at = 0;
  for (;;) {
    let end;
    try { end = frameEnd(buffer, at); } catch { return { lines, next:offset + at }; }
    if (end < 0) break;
    try { lines.push(...zlib.zstdDecompressSync(buffer.subarray(at, end)).toString("utf8").split("\n")); } catch { /* A damaged frame is passed over. */ }
    at = end;
  }
  return { lines, next:offset + at };
}
// The newest version of a dsh conversation's file: session.jsonl, session.v4.jsonl.zstd and so on.
function newestDshFile(dir) {
  const version = name => { const m = name.match(/^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/); return m ? Number(m[1] || 0) : -1; };
  let names; try { names = fs.readdirSync(dir); } catch { return null; }
  const best = names.filter(name => version(name) >= 0).sort((a, b) => version(b) - version(a))[0];
  return best ? path.join(dir, best) : null;
}

// ---------- OpenCode: its own commands list conversations and read one back ----------
function opencodeUserChanges(parts) {
  const typed = parts.filter(p => p?.type === "text" && !p.synthetic && !p.ignored), images = parts.filter(p => p?.type === "file" && /^image\//.test(p.mime || "")).length;
  const words = humanWords(typed.map(p => p.text).join("\n"));
  return words || images ? [{ me:withPictures(words, images) }] : [];
}
function opencodePartChanges(part, finished) {
  if (part?.type === "text") return part.synthetic || !part.text?.trim() || !(finished || part.time?.end) ? [] : said(part.text);
  if (part?.type === "reasoning") {
    if (!(finished || part.time?.end)) return [];
    const thought = cleanThinking(part.text);
    return thought ? [{ add:{ kind:"say", thinking:true, text:clip(thought, TEXT_MAX) } }] : [];
  }
  if (part?.type !== "tool") return [];
  const state = part.state || {}, status = state.status;
  return [{ upsert:{ id:part.callID || part.id, state:status === "completed" ? "done" : status === "error" ? "failed" : finished ? "lost" : "running", output:tail(state.output ?? state.error ?? "", OUTPUT_MAX), ...toolRow(part.tool, state.input) } }];
}
// A part changes as it goes, so what was already passed on is remembered by how it looked then.
const opencodePartState = part => `${part.type}|${part.state?.status || (part.time?.end ? "end" : "")}`;

module.exports = { humanWords, piWords, piLine, dshLine, frameEnd, readPlain, readFrames, newestDshFile, opencodeUserChanges, opencodePartChanges, opencodePartState };
