"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { toolRow, textOf, tail, jsonOf, said, clip, OUTPUT_MAX } = require("./activity.js");
const { humanWords } = require("./agent-sessions.js");

// Tencent's WorkBuddy is a desktop app with CodeBuddy Code inside it. It keeps one log per conversation, <id>.jsonl,
// under ~/.workbuddy/projects/<the folder's path with every other character a dash, and no dash in front>.
// Every line names the folder it happened in. Everything here only reads. It was read from WorkBuddy 5.2.6; anything unexpected is skipped rather than guessed at.

// WorkBuddy is hidden for now: not looked for on this computer, not listed and not followed. Work it already did stays as it is.
const WORKBUDDY = { hidden:true };
const workbuddyHome = (env, home) => String(env.WORKBUDDY_HOME || "").trim() || path.join(home, ".workbuddy");
const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const dashed = folder => String(folder).replace(/[^a-zA-Z0-9]/g, "-");

// ---------- Which conversations happened in a folder ----------
// /Users/me/app is Users-me-app. A folder inside it starts the same way, and the folder each line names settles the rest.
function workbuddyFolders(roots, names) {
  const key = value => dashed(value).replace(/^-+/, "");
  const wanted = roots.flatMap(root => {
    const plain = String(root).replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\(?=[a-z]:[\\/])/i, "");
    const windows = /^[a-z]:[\\/]/i.test(plain) || /^\\\\/.test(plain);
    // Windows WorkBuddy removes the drive colon and keeps underscores and Unicode.
    // Normalize both keys for candidate discovery; each row's cwd still proves ownership.
    return [key(root), ...(windows ? [key(plain.replace(/^([a-z]):/i, "$1"))] : [])].map(value => ({ value:windows ? value.toLowerCase() : value, windows }));
  });
  return names.filter(name => wanted.some(({ value, windows }) => {
    const plain = windows ? key(name).toLowerCase() : key(name);
    return plain === value || plain.startsWith(`${value}-`);
  })).map(name => ({ name, cwd:"" }));
}
// Beside each log is a folder of the same name with the tool results kept aside, which is not a conversation.
function workbuddyFiles(dir) {
  let names; try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(name => name.endsWith(".jsonl")).map(name => ({ id:name.slice(0, -".jsonl".length), full:path.join(dir, name) })).filter(f => isFile(f.full));
}

// ---------- One line of a conversation's log ----------
// WorkBuddy wraps what was typed in its own notes: the time, the connectors, who it is. What the person typed is in <user_query>.
const REMINDER = /<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/g, QUERY = /<user_query>([\s\S]*?)<\/user_query>/g;
const dataPicture = url => { const m = String(url || "").match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/); return m ? { type:m[1], data:m[2] } : null; };
function workbuddySaid(parts) {
  const text = parts.filter(p => p?.type === "input_text" || p?.type === "text").map(p => String(p.text ?? "")).join("\n");
  const queries = [...text.matchAll(QUERY)].map(m => m[1].trim());
  const words = humanWords(queries.length ? queries.join("\n") : text.replace(REMINDER, ""));
  const images = parts.filter(p => /image/i.test(p?.type || "")), pictures = images.map(p => dataPicture(typeof p.image_url === "string" ? p.image_url : p.image_url?.url ?? p.image)).filter(Boolean), lost = images.length - pictures.length;
  const me = [words, lost ? `[${lost} ${lost === 1 ? "picture" : "pictures"}]` : ""].filter(Boolean).join("\n");
  return me || pictures.length ? [{ me, ...(pictures.length ? { pictures } : {}) }] : [];
}
function workbuddyLine(line) {
  let o; try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const at = Number(o.timestamp) || 0, base = { at, cwd:typeof o.cwd === "string" ? o.cwd : "" };
  const parts = Array.isArray(o.content) ? o.content : [];
  switch (o.type) {
    case "message":
      if (o.role === "user") {
        // When a conversation grows long, WorkBuddy writes its own summary of it as a message from the person. Nobody typed it.
        const pd = o.providerData || {};
        if (pd.isCompacted || pd.isCompactInternal || pd.isSummary || /^\s*<cb_summary>/.test(parts.map(p => String(p?.text ?? "")).join(""))) return { ...base, changes:[] };
        return { ...base, turnOpen:true, changes:workbuddySaid(parts) };
      }
      if (o.role === "assistant") {
        const text = parts.filter(p => p?.type === "output_text").map(p => String(p.text ?? "")).join("\n").trim();
        // A turn that stopped part way says why in its place: stopped by the person, or an error from the service.
        if (o.status === "incomplete") return { ...base, turnOpen:false, changes:text && !/^Interrupted by user$/i.test(text) ? [{ add:{ kind:"note", text:clip(text, 1000) } }] : [] };
        // A tool call that follows on its own line opens the turn again.
        return { ...base, turnOpen:false, changes:text ? said(text) : [] };
      }
      return null;
    case "function_call":
      return o.callId ? { ...base, turnOpen:true, changes:[{ add:{ kind:"tool", id:o.callId, state:"running", ...toolRow(o.name, jsonOf(o.arguments)) } }] } : null;
    case "function_call_result":
      return o.callId ? { ...base, turnOpen:true, changes:[{ patch:{ id:o.callId, state:o.status === "completed" ? "done" : "failed", output:tail(typeof o.output === "string" ? o.output : textOf([o.output].flat().filter(Boolean)), OUTPUT_MAX) } }] } : null;
    default: return null;
  }
}

// ---------- What the app shows ----------
// The log of one conversation, wherever it is filed. Its id is a plain UUID.
function workbuddyFile(home, id) {
  if (!/^[\w-]+$/.test(String(id || ""))) return "";
  const projects = path.join(home, "projects");
  let names; try { names = fs.readdirSync(projects); } catch { return ""; }
  return names.map(name => path.join(projects, name, `${id}.jsonl`)).find(isFile) || "";
}
// The title WorkBuddy lists a conversation under, to pick it there: nothing opens WorkBuddy on one conversation. The latest one it wrote wins.
function workbuddyTitle(home, id) {
  const file = workbuddyFile(home, id);
  if (!file) return "";
  let text; try { text = fs.readFileSync(file, "utf8"); } catch { return ""; }
  let title = "";
  for (const line of text.split("\n")) {
    if (!line.includes('"ai-title"')) continue;
    try { const o = JSON.parse(line); if (o?.type === "ai-title" && typeof o.aiTitle === "string" && o.aiTitle.trim()) title = o.aiTitle.trim(); } catch { /* A line still being written. */ }
  }
  return title;
}

module.exports = { WORKBUDDY, workbuddyHome, workbuddyFolders, workbuddyFiles, workbuddyLine, workbuddySaid, workbuddyFile, workbuddyTitle };
