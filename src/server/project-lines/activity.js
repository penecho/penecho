"use strict";
const { openCodeModel } = require("./agent-model.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const StopWhy = require("./stop-why.js");

// What an agent is doing, in plain rows, from the JSON lines each agent prints as it works.
// Rows live in PenEcho's own state, never in the docs folder: the Markdown stays small enough for the next agent to read.
const OUTPUT_MAX = 6000, TEXT_MAX = 20000, LOG_MAX = 8 * 1024 * 1024, KEEP_MAX = 4000;
const clip = (value, max) => { const text = String(value ?? ""); return text.length > max ? `${text.slice(0, max)}…` : text; };
const tail = (value, max) => { const text = String(value ?? ""); return text.length > max ? `…${text.slice(-max)}` : text; };
const oneLine = (value, max = 160) => clip(String(value ?? "").replace(/\s+/g, " ").trim(), max);
// Normalize a model's block-thinking summary: collapse excessive blank lines and strip repetitive boilerplate headers.
function cleanThinking(value) {
  let text = String(value ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const stripped = text.replace(/^I['’]m thinking through how to approach this\.\s*\n+/i, "").trim();
  if (stripped) text = stripped;
  return text;
}
function reasoningSummary(item) {
  const list = Array.isArray(item?.summary) ? item.summary : [];
  const parts = list.map(entry => (typeof entry === "string" ? entry : typeof entry?.text === "string" ? entry.text : "")).map(s => s.trim()).filter(Boolean);
  return cleanThinking(parts.join("\n\n"));
}

// Pictures a tool handed back, such as a screenshot it read. Claude Code nests the bytes in a source, Pi does not.
const PICTURE_TYPES = { "image/png":"png", "image/jpeg":"jpg", "image/gif":"gif", "image/webp":"webp" }, PICTURES_MAX = 4;
const imagesOf = content => (Array.isArray(content) ? content : []).filter(part => part?.type === "image").map(part => ({ type:part.source?.media_type || part.mimeType, data:part.source?.data ?? part.data })).filter(image => PICTURE_TYPES[image.type] && typeof image.data === "string" && image.data).slice(0, PICTURES_MAX);
const withImages = (patch, content) => { const images = imagesOf(content); return images.length ? { ...patch, images } : patch; };
const textOf = content => typeof content === "string" ? content : Array.isArray(content) ? content.map(part => typeof part === "string" ? part : part?.type === "text" ? part.text : "").join("\n") : "";
// One word as a POSIX shell quotes it ('a'"b"c); text that is not one whole word comes back as it is.
function shellWord(text) {
  if (!/^(?:'[^']*'|"(?:\\[\s\S]|[^"\\])*"|\\[\s\S]|[^\s'"\\])+$/.test(text)) return text;
  return text.replace(/'([^']*)'|"((?:\\[\s\S]|[^"\\])*)"|\\([\s\S])/g, (_, single, double, one) => single ?? double?.replace(/\\(["\\$`])/g, "$1") ?? one);
}
// Splits a command on unquoted `;` and newlines (plus `&&` after a directory change).
// Returns null when unquoted pipes, redirects, subshells, logical OR or backgrounding are present.
function splitSimpleStatements(command) {
  const parts = [];
  let cur = "", quote = "", i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (quote) {
      cur += ch;
      if (ch === "\\" && quote === '"' && i + 1 < command.length && (command[i + 1] === '"' || command[i + 1] === "\\")) { cur += command[++i]; }
      else if (ch === quote) quote = "";
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; i++; continue; }
    if (ch === "\\" && i + 1 < command.length) { cur += ch + command[++i]; i++; continue; }
    if (ch === ";" || ch === "\n" || ch === "\r") {
      if (cur.trim()) parts.push({ text:cur.trim(), op:";" });
      cur = ""; i++; continue;
    }
    if (ch === "&" && command[i + 1] === "&") {
      if (!cur.trim()) return null;
      parts.push({ text:cur.trim(), op:"&&" });
      cur = ""; i += 2; continue;
    }
    if (ch === "|" || ch === "&" || ch === "<" || ch === ">" || ch === "`" || ch === "(" || ch === ")" || ch === "{" || ch === "}") return null;
    if (ch === "$" && command[i + 1] === "(") return null;
    cur += ch; i++;
  }
  if (quote) return null;
  if (cur.trim()) parts.push({ text:cur.trim(), op:"" });
  return parts;
}
const SEARCH_CMD = /^(?:(?:rg|grep)(?:\.exe)?|git(?:\.exe)?\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)\s+)*grep)\s/i;
const CD_CMD = /^(?:cd|set-location)(?:\s|$)/i;
const READ_ONLY_CMD = /^(?:(?:cd|set-location|pwd|get-location|ls|dir|get-childitem|cat|head|tail|wc|stat|get-content|echo|printf|write-output)(?:\.exe)?(?:\s|$)|git(?:\.exe)?\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)\s+)*(?:(?:status|rev-parse|log|show|ls-files)\b|branch(?:\s+(?:--show-current|-a|--all|-r|--remotes|-v|-vv|--verbose|-l|--list|--contains|--merged|--no-merged))*\s*$))/i;
const BENIGN_GIT_WARNING = /^\s*warning:\s+unable to access\s+[^\n]*git[\\/]ignore['"]?:\s*Permission denied\s*$/i;
const CMD_ERROR_LINE = /(?:^|\n)\s*(?:(?:rg|grep|git|cat|ls|cd|head|tail|stat|wc|sh|bash|zsh|dash|fatal|error|usage|get-content|get-childitem|get-location|set-location)(?:\.exe)?\s*:|at line:\d+\s+char:\d+\b|[+]\s*(?:CategoryInfo|FullyQualifiedErrorId)\s*:|[^\n]*(?:\bis not recognized as the name of\b|\bcommand not found\b|\bcannot find path\b|\bno such file or directory\b|\bnot a git repository\b|\bpermission denied\b))/i;
// A search that found nothing ends with 1, which is an answer and not a failure.
// Only when the command is a simple search (optionally preceded by pure read-only inspection or `cd`) and produced no error output.
function foundNothing(command, code, output) {
  if (code !== 1) return false;
  const parts = splitSimpleStatements(plainCommand(command).trim());
  if (!parts || !parts.length) return false;
  const last = parts[parts.length - 1];
  if (!SEARCH_CMD.test(last.text)) return false;
  const before = parts.slice(0, -1);
  if (before.some(p => (p.op === "&&" ? !CD_CMD.test(p.text) : !READ_ONLY_CMD.test(p.text)))) return false;
  const cleaned = String(output || "").replace(/\r\n?/g, "\n").split("\n").filter(line => !BENIGN_GIT_WARNING.test(line)).join("\n").trim();
  if (before.every(p => CD_CMD.test(p.text))) return cleaned === "";
  return !CMD_ERROR_LINE.test(cleaned);
}
const SHELL_TOKEN = /^((?:'[^']*'|"(?:\\[\s\S]|[^"\\])*"|\\[\s\S]|[^\s'"\\])+)\s+([\s\S]+)$/;
const PS_FLAG = /^(?:-(?:ExecutionPolicy|EP|WindowStyle|W|InputFormat|IF|OutputFormat|OF|WorkingDirectory|WD)\s+(?:'[^']*'|"(?:\\[\s\S]|[^"\\])*"|\S+)|-(?!Command\b|c\b)\w+)\s+/i;
// Codex wraps every command in a login shell. The command is what a person wants to read.
function plainCommand(command) {
  const text = String(command || ""), head = text.match(SHELL_TOKEN);
  if (!head) return text;
  const exe = shellWord(head[1]).split(/[\\/]/).pop().toLowerCase();
  let rest = head[2].trim();
  if (/^(?:powershell|pwsh)(?:\.exe)?$/.test(exe)) {
    while (PS_FLAG.test(rest)) rest = rest.replace(PS_FLAG, "");
    const m = rest.match(/^-(?:Command|c)\s+([\s\S]+)$/i);
    return m ? shellWord(m[1].trim()) : text;
  }
  if (/^(?:ba|z|da)?sh(?:\.exe)?$/.test(exe)) {
    const m = rest.match(/^(?:-l?c|-l\s+-c)\s+([\s\S]+)$/);
    return m ? shellWord(m[1].trim()) : text;
  }
  if (/^cmd(?:\.exe)?$/.test(exe)) {
    const m = rest.match(/^(?:\/[a-z]\s+)*\/c\s+([\s\S]+)$/i);
    return m ? shellWord(m[1].trim()) : text;
  }
  return text;
}
// A question an agent stopped to ask. Its tool does not come back until you answer it in that agent's app.
function questionsOf(input) {
  const list = Array.isArray(input?.questions) ? input.questions : input?.question ? [input] : [];
  return list.map(q => ({ text:oneLine(q?.question ?? q?.text ?? "", 500), options:(Array.isArray(q?.options) ? q.options : []).map(o => oneLine(typeof o === "string" ? o : o?.label ?? "", 200)).filter(Boolean).slice(0, 12) })).filter(q => q.text);
}
// Structured questions for interactive UI answering (preserves ids, headers, original keys/values, isSecret, and multiSelect).
function richQuestionsOf(input) {
  const list = Array.isArray(input?.questions) ? input.questions : input?.question ? [input] : [];
  return list.map((q, idx) => {
    const rawKey = String(q?.question ?? q?.text ?? "");
    const text = oneLine(rawKey, 500);
    const rawOpts = Array.isArray(q?.options) ? q.options : [];
    const options = [];
    const optionValues = [];
    for (const o of rawOpts) {
      const rawVal = typeof o === "string" ? o : String(o?.value ?? o?.label ?? "");
      const label = oneLine(typeof o === "string" ? o : (o?.label ?? o?.value ?? ""), 200);
      if (!label) continue;
      options.push(label);
      optionValues.push(rawVal || label);
      if (options.length >= 12) break;
    }
    return {
      id:String(q?.id || q?.header || `q-${idx + 1}`),
      ...(rawKey ? { key:rawKey } : {}),
      ...(q?.header ? { header:oneLine(q.header, 120) } : {}),
      text,
      multiSelect:Boolean(q?.multiSelect || q?.multi_select),
      ...(q?.isSecret || q?.is_secret ? { isSecret:true } : {}),
      options,
      ...(optionValues.some((v, i) => v !== options[i]) ? { optionValues } : {}),
    };
  }).filter(q => q.text);
}
function parseTodos(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (typeof item === "string") {
      const text = oneLine(item, 140);
      if (text) out.push({ text, status:"pending" });
    } else if (item && typeof item === "object") {
      const text = oneLine(item.content || item.subject || item.step || item.title || item.text || "", 140);
      if (!text) continue;
      const raw = String(item.status || (item.completed ? "completed" : "pending")).toLowerCase();
      const status = raw === "done" || raw === "completed" ? "completed" : raw === "in_progress" || raw === "in-progress" || raw === "running" || raw === "active" ? "in_progress" : "pending";
      out.push({ text, status });
    }
    if (out.length >= 20) break;
  }
  return out;
}
function claudeTool(block) {
  const name = String(block.name || "Tool"), input = block.input || {};
  switch (name) {
    case "Read": case "NotebookRead": return { verb:"Read", target:input.file_path || input.notebook_path };
    case "Write": return { verb:"Wrote", target:input.file_path };
    case "Edit": case "MultiEdit": case "NotebookEdit": return { verb:"Edited", target:input.file_path || input.notebook_path };
    case "Bash": {
      const summary = typeof input.description === "string" ? oneLine(input.description, 160) : "";
      return { verb:"Ran", target:input.command, code:true, ...(summary ? { summary } : {}) };
    }
    case "Grep": return { verb:"Searched for", target:input.pattern };
    case "Glob": return { verb:"Looked for", target:input.pattern };
    case "List": return { verb:"Listed", target:input.file_path ?? "." };
    case "WebSearch": return { verb:"Searched the web for", target:input.query };
    case "WebFetch": return { verb:"Opened", target:input.url };
    case "AskUserQuestion": return { verb:"Asked you", target:"", questions:questionsOf(input) };
    case "Task": case "Agent": return { verb:"Asked a helper to", target:input.description || input.prompt };
    case "TodoWrite": case "TaskCreate": case "TaskUpdate": {
      const todos = parseTodos(input.todos);
      const target = typeof input.subject === "string" ? oneLine(input.subject, 140) : "";
      return { verb:"Updated its plan", target, ...(todos.length ? { todos } : {}) };
    }
    // A tool from an MCP server keeps the server's name, so the live picture can tell a browser from the Canvas from a calendar.
    default: { const mcp = name.match(/^mcp__(.+?)__(.+)$/); return mcp ? { verb:`Used ${mcp[2]}`, target:"", via:mcp[1] } : { verb:`Used ${name}`, target:"" }; }
  }
}
// One line of agent output becomes zero or more changes to the rows. Either agent's shape is recognised, so nothing depends on which one ran.
// The row a page shows while a model call is tried again: "Trying again (2 of 4)", with why in plain words.
function retryRow({ attempt, of, why = "", waitMs } = {}) {
  const n = value => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0);
  const row = { kind:"retry", attempt:n(attempt), of:n(of), why:clip(String(why || ""), 300), ...(n(waitMs) ? { waitMs:n(waitMs) } : {}) };
  // A page that does not know this kind yet shows its text as a note.
  return { ...row, text:`${row.why ? `${row.why.replace(/[.\s]+$/, "")}. ` : ""}Trying again${row.attempt && row.of ? ` (${row.attempt} of ${row.of})` : ""}.` };
}
function parseLine(line, o = eventOf(line)) {
  const text = typeof line === "string" ? line.trim() : "";
  if (typeof line === "string" && !text) return [];
  if (!o || typeof o !== "object") return [{ add:{ kind:"note", text:clip(text, TEXT_MAX) } }];
  switch (o.type) {
    // Claude Code
    // A background task of its own finishing wakes it for another turn. Nobody asked for that one.
    // Claude thinking before its next step: { type:"system", subtype:"thinking_tokens", estimated_tokens }, many times over.
    // A model call being tried again: { type:"system", subtype:"retry", attempt, of, why } (PenEcho's own agent, on a computer or on penecho.ai).
    case "system": return o.subtype === "init" && o.session_id ? [{ session:o.session_id, ...(typeof o.model === "string" && o.model ? { model:o.model } : {}) }] : o.subtype === "task_notification" ? [{ aside:true }] : o.subtype === "thinking_tokens" ? [{ now:"Thinking" }] : o.subtype === "retry" ? [{ add:retryRow(o) }] : [];
    case "assistant": {
      // With thinking shown as "updates", Claude's progress lines while it works arrive as thinking and its own app shows them. They are not its answer.
      const out = [], updates = (o.thinkingDisplay || o.thinking_display) === "updates";
      for (const block of o.message?.content || []) {
        if (updates && block.type === "thinking" && block.thinking?.trim()) out.push({ add:{ kind:"say", text:clip(block.thinking.trim(), TEXT_MAX) } });
        if (block.type === "text" && block.text?.trim()) out.push({ add:{ kind:"say", text:clip(block.text.trim(), TEXT_MAX) } }, { said:block.text.trim() });
        if (block.type === "tool_use") out.push({ add:{ kind:"tool", id:block.id, state:"running", ...claudeTool(block) } });
      }
      return out;
    }
    case "user": {
      const out = [];
      for (const block of Array.isArray(o.message?.content) ? o.message.content : []) {
        if (block.type === "tool_result") out.push({ patch:withImages({ id:block.tool_use_id, state:block.is_error ? "failed" : "done", output:tail(textOf(block.content), OUTPUT_MAX) }, block.content) });
      }
      return out;
    }
    case "result": return [{ session:o.session_id, turnEnd:true, clearAsking:true, ...(o.is_error ? { failed:textOf(o.result) || (o.errors || []).join(" ") || "" } : {}) }];
    case "control_request": return o.request?.subtype === "can_use_tool" ? [{ controlRequest:{ id:String(o.request_id || ""), subtype:o.request.subtype, toolName:String(o.request.tool_name || ""), input:o.request.input || {} } }] : [];
    case "control_cancel_request": return o.request_id ? [{ cancelControlRequest:String(o.request_id) }] : [];
    // Codex
    case "thread.started": return o.thread_id ? [{ session:o.thread_id }] : [];
    case "turn.failed": return [{ failed:o.error?.message || "" }];
    // Codex also reports a connection it is retrying this way, so only the exit code decides that a run failed.
    case "error": return [{ add:{ kind:"note", text:clip(o.message, 1000) } }];
    case "item.started": case "item.updated": case "item.completed": return codexItem(o.item || {}, o.type === "item.completed");
    default: return [];
  }
}
function codexItem(item, finished) {
  switch (item.type) {
    case "agent_message": return finished && item.text?.trim() ? [{ add:{ kind:"say", text:clip(item.text.trim(), TEXT_MAX) } }, { said:item.text.trim() }] : [];
    case "reasoning": {
      if (!finished) return [];
      const summary = reasoningSummary(item);
      return summary ? [{ add:{ kind:"say", thinking:true, ...(item.id ? { id:`codex-reason-${item.id}` } : {}), text:clip(summary, TEXT_MAX) } }] : [];
    }
    case "command_execution": {
      const row = { id:item.id, verb:"Ran", target:plainCommand(item.command), code:true, state:!finished ? "running" : item.exit_code === 0 || foundNothing(item.command, item.exit_code, item.aggregated_output) ? "done" : "failed", output:tail(item.aggregated_output, OUTPUT_MAX) };
      return [{ upsert:row }];
    }
    case "file_change": {
      const changes = item.changes || [], first = changes[0]?.path || "", more = changes.length > 1 ? ` and ${changes.length - 1} more` : "";
      const files = changes.length > 1 ? changes.slice(0, 20).map(c => c?.path).filter(Boolean) : [];
      return [{ upsert:{ id:item.id, verb:"Edited", target:`${first}${more}`, ...(files.length ? { files } : {}), state:finished ? item.status === "failed" ? "failed" : "done" : "running" } }];
    }
    case "mcp_tool_call": return [{ upsert:{ id:item.id, verb:`Used ${item.tool || "a tool"}`, target:"", ...(item.server ? { via:item.server } : {}), state:finished ? item.status === "failed" ? "failed" : "done" : "running" } }];
    case "web_search": return [{ upsert:{ id:item.id, verb:"Searched the web for", target:item.query || "", state:finished ? "done" : "running" } }];
    case "todo_list": {
      const todos = parseTodos(item.items || item.todos || item.steps);
      return [{ upsert:{ id:item.id, verb:"Updated its plan", target:"", ...(todos.length ? { todos } : {}), state:"done" } }];
    }
    // Codex prints its own start-up warnings as items. They are not about this work.
    case "error": return /under-development features/i.test(item.message || "") ? [] : [{ add:{ kind:"note", text:clip(item.message, 1000) } }];
    default: return [];
  }
}
// The same rows from Codex's app-server, whose notifications name things differently from `codex exec`.
function parseAppServer(note) {
  const p = note?.params || {};
  switch (note?.method) {
    case "item/started": return appItem(p.item || {}, false);
    case "item/completed": return appItem(p.item || {}, true);
    // Codex says this too about a connection it is retrying, so only the turn's own end decides that it failed.
    case "error": return p.error?.message ? [{ add:{ kind:"note", text:clip(p.error.message, 1000) } }] : [];
    default: return [];
  }
}
function appItem(item, finished) {
  const open = !finished || item.status === "inProgress", failed = item.status === "failed" || item.status === "declined";
  switch (item.type) {
    case "agentMessage": return finished && item.text?.trim() ? [{ add:{ kind:"say", text:clip(item.text.trim(), TEXT_MAX) } }, { said:item.text.trim() }] : [];
    case "reasoning": {
      if (!finished) return [];
      const summary = reasoningSummary(item);
      return summary ? [{ add:{ kind:"say", thinking:true, ...(item.id ? { id:`codex-reason-${item.id}` } : {}), text:clip(summary, TEXT_MAX) } }] : [];
    }
    case "commandExecution": return [{ upsert:{ id:item.id, verb:"Ran", target:plainCommand(item.command), code:true, state:open ? "running" : (failed || (item.exitCode !== 0 && item.exitCode !== undefined && item.exitCode !== null)) && (item.status === "declined" || !foundNothing(item.command, item.exitCode, item.aggregatedOutput)) ? "failed" : "done", output:tail(item.aggregatedOutput, OUTPUT_MAX) } }];
    case "fileChange": {
      const changes = item.changes || [], first = changes[0]?.path || "", more = changes.length > 1 ? ` and ${changes.length - 1} more` : "";
      const files = changes.length > 1 ? changes.slice(0, 20).map(c => c?.path).filter(Boolean) : [];
      return [{ upsert:{ id:item.id, verb:"Edited", target:`${first}${more}`, ...(files.length ? { files } : {}), state:open ? "running" : failed ? "failed" : "done" } }];
    }
    case "mcpToolCall": return [{ upsert:{ id:item.id, verb:`Used ${item.tool || "a tool"}`, target:"", ...(item.server ? { via:item.server } : {}), state:open ? "running" : failed ? "failed" : "done" } }];
    case "webSearch": return [{ upsert:{ id:item.id, verb:"Searched the web for", target:item.query || "", state:open ? "running" : "done" } }];
    case "todoList": case "plan": {
      const todos = parseTodos(item.items || item.todos || item.steps || item.plan);
      return [{ upsert:{ id:item.id, verb:"Updated its plan", target:"", ...(todos.length ? { todos } : {}), state:"done" } }];
    }
    default: return [];
  }
}
// Codex's Windows sandbox could not start, so none of its commands run: it must set folder permissions for its sandbox account before each
// one, and Windows refuses that on a folder owned by another account (a .git made from an admin terminal), or its sandbox account cannot
// start the shell. Its own words for that, as its log and codex.exe say them. Full access runs no sandbox, so it is the way out.
const CODEX_SANDBOX_BROKEN = /setup refresh had errors|Failed to create unified exec process: (?:helper|orchestrator)_[a-z_]+|Windows sandbox setup failed|windows sandbox failed|elevated Windows sandbox provisioning (?:is incomplete|recorded a structured failure)|sandbox provisioning: (?:failed|incomplete)|CreateProcessAsUserW failed|failed to prepare (?:process|MXC) sandbox/i;
const isCodexSandboxBroken = text => CODEX_SANDBOX_BROKEN.test(String(text || ""));
// A row that says so: a command that failed with those words, or Codex's own note.
const codexSandboxBrokeIn = row => Boolean(row) && ((row.kind === "tool" && row.state === "failed" && isCodexSandboxBroken(row.output)) || ((row.kind === "note" || row.kind === "error") && isCodexSandboxBroken(row.text)));
// OpenCode, Pi and dsh name their tools alike, in lower case, with a few spellings between them.
function toolRow(name, value) {
  const input = value && typeof value === "object" ? value : {}, tool = String(name || "tool"), file = input.file_path || input.filePath || input.path || input.file;
  switch (tool.toLowerCase()) {
    case "read": case "read_file": return { verb:"Read", target:file };
    case "write": case "write_file": return { verb:"Wrote", target:file };
    case "edit": case "edit_file": case "apply_patch": case "patch": case "multiedit": return { verb:"Edited", target:file };
    case "bash": case "shell": case "exec": {
      const summary = typeof (input.description || input.summary || input.toolSummary) === "string" ? oneLine(input.description || input.summary || input.toolSummary, 160) : "";
      return { verb:"Ran", target:input.command, code:true, ...(summary ? { summary } : {}) };
    }
    case "execute": return { verb:"Ran", target:String(input.code || "").trim().split("\n")[0], code:true };
    case "grep": return { verb:"Searched for", target:input.pattern };
    case "glob": case "find": case "ls": case "list": return { verb:"Looked for", target:input.pattern || file };
    case "websearch": case "web_search": return { verb:"Searched the web for", target:input.query || (input.queries || []).join(", ") };
    case "webfetch": case "web_fetch": return { verb:"Opened", target:input.url };
    case "ask_user_question": case "askuserquestion": case "question": case "request_user_input": return { verb:"Asked you", target:"", questions:questionsOf(input) };
    case "task": case "subagent": return { verb:"Asked a helper to", target:input.description || input.prompt };
    case "todowrite": case "todo_write": case "update_goal": {
      const todos = parseTodos(input.todos || input.items);
      return { verb:"Updated its plan", target:"", ...(todos.length ? { todos } : {}) };
    }
    default: return { verb:`Used ${tool}`, target:"" };
  }
}
const said = text => [{ add:{ kind:"say", text:clip(text.trim(), TEXT_MAX) } }, { said:text.trim() }];
const eventOf = value => { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return null; } };
const jsonOf = value => { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return {}; } };
const partsText = content => (Array.isArray(content) ? content : []).filter(part => part?.type === "text").map(part => part.text).join("\n");
const PI_UI_DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
function piUiQuestion(o) {
  const id = String(o.id || "ui-1");
  if (o.method === "select") {
    const options = (Array.isArray(o.options) ? o.options : []).map(x => oneLine(typeof x === "string" ? x : x?.label ?? "", 200)).filter(Boolean).slice(0, 12);
    return { id, text:oneLine(o.title || "Choose an option", 500), multiSelect:false, options };
  }
  if (o.method === "confirm") {
    const text = oneLine([o.title, o.message].filter(Boolean).join(": ") || "Confirm", 500);
    return { id, text, multiSelect:false, options:["Yes", "No"] };
  }
  return { id, text:oneLine(o.title || o.placeholder || "Enter a reply", 500), multiSelect:false, options:[] };
}
// OMP can end an attempt while it is still retrying the turn or awaiting async work. Legacy Pi/OMP omit the flags on their final event.
const isPiTurnEnd = event => event?.type === "agent_end" && event.isTerminal !== false && event.yielded !== false && event.willContinue !== true;
function parsePi(o, state = {}) {
  switch (o.type) {
    case "session": return o.id ? [{ session:o.id }] : [];
    case "response": {
      if (o.command === "get_state" && o.success && o.data) {
        const out = [];
        const session = typeof o.data.sessionId === "string" ? o.data.sessionId : "";
        const model = typeof o.data.model === "string" ? o.data.model : (typeof o.data.model?.id === "string" ? o.data.model.id : "");
        if (session || model) out.push({ ...(session ? { session } : {}), ...(model ? { model } : {}) });
        return out;
      }
      if (o.command === "prompt" || o.command === "steer") {
        const id = String(o.id || "");
        const err = String(o.error || `Pi ${o.command} failed.`);
        const out = [{ rpcResponse:{ id, command:o.command, success:Boolean(o.success), error:o.success === false ? err : "" } }];
        // Only an initial prompt rejection fails the Work and closes stdin; a rejected steer command reports back to its caller without marking the running Work failed.
        if (o.success === false && o.command === "prompt" && !id.startsWith("steer-")) out.push({ failed:err, promptRejected:true });
        return out;
      }
      return [];
    }
    case "agent_start": state.rpcStreaming = true; return [];
    case "agent_end":
      if (!isPiTurnEnd(o)) return [];
      state.rpcStreaming = false;
      return [{ turnEnd:true, keepFailed:true, clearAsking:true }];
    case "extension_ui_cancel":
    case "extension_ui_timeout":
    case "extension_ui_dismiss":
      return o.id ? [{ cancelAsking:String(o.id), cancelReason:o.type === "extension_ui_timeout" ? "Timed out" : "Cancelled" }] : [];
    case "extension_ui_request": {
      if (o.id && (o.method === "cancel" || o.cancelled === true)) return [{ cancelAsking:String(o.id), cancelReason:"Cancelled" }];
      if (!PI_UI_DIALOG_METHODS.has(o.method) || !o.id) return [];
      const q = piUiQuestion(o);
      const timeout = Number(o.timeout) > 0 ? Number(o.timeout) : 0;
      return [
        { add:{ kind:"tool", id:`ui-${o.id}`, state:"running", verb:"Asked you", target:"", questions:[{ text:q.text, options:q.options }] } },
        { asking:{ id:String(o.id), kind:"extension_ui", method:o.method, rowId:`ui-${o.id}`, ...(timeout ? { timeout } : {}), questions:[q] } },
      ];
    }
    case "tool_execution_start": return [{ add:{ kind:"tool", id:o.toolCallId, state:"running", ...toolRow(o.toolName, o.args) } }];
    case "tool_execution_end": return [{ patch:withImages({ id:o.toolCallId, state:o.isError ? "failed" : "done", output:tail(partsText(o.result?.content), OUTPUT_MAX) }, o.result?.content) }];
    case "message_end": {
      const m = o.message || {};
      if (m.role !== "assistant") return [];
      if (m.stopReason === "error" || m.stopReason === "aborted") return [{ failed:m.errorMessage || "" }];
      // A new answer means an earlier attempt that failed was retried and got through.
      const text = partsText(m.content);
      if (text.trim()) return [{ recovered:true }, ...said(text)];
      const blocks = Array.isArray(m.content) ? m.content : [];
      const hasTools = blocks.some(part => part?.type === "toolCall");
      const thought = hasTools ? cleanThinking(blocks.filter(part => part?.type === "thinking").map(part => part.thinking || "").join("\n\n")) : "";
      return [{ recovered:true }, ...(thought ? [{ add:{ kind:"say", thinking:true, text:clip(thought, TEXT_MAX) } }] : [])];
    }
    default: return [];
  }
}
function parseOpencode(o) {
  const part = o.part || {};
  switch (o.type) {
    case "step_start":
    case "step_finish": {
      const session = o.sessionID || part.sessionID;
      const messageId = typeof part.messageID === "string" ? part.messageID : "";
      const model = openCodeModel(part) || openCodeModel(o);
      return session || messageId || model ? [{ ...(session ? { session } : {}), ...(messageId ? { openCodeMessageId:messageId } : {}), ...(model ? { model } : {}) }] : [];
    }
    case "text": return part.text?.trim() ? said(part.text) : [];
    case "reasoning": { const thought = cleanThinking(part.text); return thought ? [{ add:{ kind:"say", thinking:true, text:clip(thought, TEXT_MAX) } }] : []; }
    case "tool_use": { const state = part.state || {}; return [{ upsert:{ id:part.callID || part.id, state:state.status === "error" ? "failed" : "done", output:tail(state.output ?? state.error, OUTPUT_MAX), ...toolRow(part.tool, state.input) } }]; }
    case "error": return [...(o.sessionID ? [{ session:o.sessionID }] : []), { failed:o.error?.data?.message || o.error?.message || o.error?.name || "" }];
    default: return [];
  }
}
// dsh's own list of these is in packages/bundle/headless/src/json-stream.ts of deepseek-ai/deepseek-harness.
function parseDsh(o) {
  switch (o.type) {
    case "session": return o.sessionId ? [{ session:o.sessionId }] : [];
    case "text": return o.text?.trim() ? said(o.text) : [];
    case "reasoning":
    case "thinking": { const thought = cleanThinking(o.text ?? o.thinking ?? ""); return thought ? [{ add:{ kind:"say", thinking:true, text:clip(thought, TEXT_MAX) } }] : []; }
    case "tool_call": return [{ add:{ kind:"tool", id:o.callId, state:"running", ...toolRow(o.tool, jsonOf(o.input)) } }];
    case "tool_result": return [{ patch:{ id:o.callId, state:o.status === "error" ? "failed" : "done", output:tail(textOf(o.result), OUTPUT_MAX) } }];
    case "status": return o.phase === "turn_end" && o.reason && o.reason.kind !== "completed" ? [{ failed:o.reason.message || o.reason.error?.message || o.reason.kind || "" }] : [];
    case "error": return [{ failed:o.message || "" }];
    default: return [];
  }
}
// Kimi names a few tools its own way. The rest are spelled as the others spell them.
const KIMI_TOOLS = { readmediafile:"read", fetchurl:"webfetch", kimi_fetch_v2:"webfetch", searchweb:"websearch", kimi_search_v2:"websearch", agent:"task", agentswarm:"task", todolist:"todowrite" };
const kimiTool = (name, args) => toolRow(KIMI_TOOLS[String(name || "").toLowerCase()] || name, args);
// What `kimi --prompt … --output-format stream-json` prints, as read from Kimi Code 0.35: chat messages, then a note naming the session, which comes only at the end.
// A request that fails ends the program with a message on stderr. Before that it may only say it is trying again.
function parseKimi(o) {
  if (o.role === "assistant") {
    const text = typeof o.content === "string" ? o.content : partsText(o.content), out = text.trim() ? said(text) : [];
    for (const call of Array.isArray(o.tool_calls) ? o.tool_calls : []) out.push({ add:{ kind:"tool", id:call.id, state:"running", ...kimiTool(call.function?.name, jsonOf(call.function?.arguments)) } });
    return out;
  }
  if (o.role === "tool") return o.tool_call_id ? [{ patch:{ id:o.tool_call_id, state:(o.is_error || o.status === "error") ? "failed" : "done", output:tail(textOf(o.content), OUTPUT_MAX) } }] : [];
  if (o.role !== "meta") return [];
  if (o.type === "session.resume_hint" && o.session_id) return [{ session:o.session_id }];
  if (o.type === "turn.step.retrying") return [{ add:{ kind:"note", text:clip(`Trying again: ${o.error_message || o.error_name || "the request failed"}`, 1000) } }];
  return [];
}
// Antigravity names its tools in snake case and its arguments in PascalCase. Its app's own transcripts hold each argument as a JSON string, its command line as plain values, so both are read.
const AGY_TOOLS = { run_command:["bash", "CommandLine", "command"], command_status:["bash", "CommandId", "command"], send_command_input:["bash", "CommandId", "command"],
  view_file:["read", "AbsolutePath", "path"], read_file:["read", "Path", "path"], view_file_outline:["read", "AbsolutePath", "path"], view_code_item:["read", "AbsolutePath", "path"],
  write_to_file:["write", "TargetFile", "path"], write_file:["write", "Path", "path"],
  replace_file_content:["edit", "TargetFile", "path"], multi_replace_file_content:["edit", "TargetFile", "path"], edit_file:["edit", "Path", "path"],
  grep_search:["grep", "Query", "pattern"], find_by_name:["find", "Pattern", "pattern"], list_dir:["ls", "DirectoryPath", "path"], search_web:["websearch", "query", "query"], read_url_content:["webfetch", "Url", "url"], browser_subagent:["task", "Task", "description"] };
const agyValue = value => (typeof value === "string" && /^".*"$/s.test(value) ? jsonOf(value) : value);
function agyTool(name, parameters = {}) {
  const toolName = String(name || "").toLowerCase();
  if (toolName === "update_steps") {
    const rawSteps = agyValue(parameters?.steps);
    const todos = parseTodos(typeof rawSteps === "string" ? jsonOf(rawSteps) : rawSteps);
    return { verb:"Updated its plan", target:"", ...(todos.length ? { todos } : {}) };
  }
  const known = AGY_TOOLS[toolName];
  const rawSummary = agyValue(parameters?.toolSummary ?? parameters?.Summary ?? parameters?.Description);
  const summary = typeof rawSummary === "string" ? oneLine(rawSummary, 160) : "";
  const row = known ? toolRow(known[0], { [known[2]]:agyValue(parameters?.[known[1]]), ...(summary ? { summary } : {}) }) : toolRow(name, summary ? { summary } : {});
  if (row.verb === "Read") {
    const start = Number(agyValue(parameters?.StartLine)), end = Number(agyValue(parameters?.EndLine));
    if (Number.isSafeInteger(start) && start > 0 && Number.isSafeInteger(end) && end >= start) row.range = `${start}-${end}`;
  }
  return row;
}
// Antigravity reports non-zero shell exit codes in the output header ("Command exited with code 1.") while keeping step.state === "DONE" and tool_info.error empty.
const AGY_NONZERO_EXIT = /(?:^|\n)Command exited with code [1-9]\d*\.?(?:\r?\n|$)/;
// Google OAuth 2 access token expiry mid-run in `agy` (HTTP 401 UNAUTHENTICATED). `agy` auto-refreshes the token on the next turn or resume.
const AGY_OAUTH_EXPIRED = /\bUNAUTHENTICATED\b[^\n]*(?:\b401\b|invalid authentication credentials|OAuth 2 access token)|invalid authentication credentials[^\n]*OAuth 2 access token|"status"\s*:\s*"UNAUTHENTICATED"[^\n]*"error_code"\s*:\s*401|"error_code"\s*:\s*401[^\n]*"status"\s*:\s*"UNAUTHENTICATED"/i;
const isAntigravityOAuthError = text => {
  const raw = String(text || "");
  return Boolean(raw) && AGY_OAUTH_EXPIRED.test(raw) && !StopWhy.isLimit(raw);
};
// What `agy --output-format stream-json` prints, as its headless page shows it: init with the conversation, then step_update for each step while it runs, then result.
// Its words come as pieces of one step, so they are kept on the run until that step is done. A failed run says so only in its result's status.
// `agy` can latch an earlier recovered mid-turn `error_message` step onto its final `result` (`status: "ERROR"`), so track step order per turn to tell recovery from real failure.
const resetAgyTurn = state => {
  state.agySaid = false;
  state.agyText = {};
  state.agyErrorStep = -1;
  state.agyErrorText = "";
  state.agyToolStep = -1;
  state.agyAnswerStep = -1;
  state.recoveredTurn = false;
};
function parseAntigravity(o, state = {}) {
  if (o.event === "init") {
    resetAgyTurn(state);
    return o.conversation_id ? [{ session:o.conversation_id, ...(typeof o.init?.model === "string" && o.init.model ? { model:o.init.model } : {}) }] : [];
  }
  if (o.event === "result") {
    const r = o.result || {}, failed = Boolean(r.status && r.status !== "SUCCESS");
    const errorStep = Number.isInteger(state.agyErrorStep) ? state.agyErrorStep : -1;
    const toolStep = Number.isInteger(state.agyToolStep) ? state.agyToolStep : -1;
    const answerStep = Number.isInteger(state.agyAnswerStep) ? state.agyAnswerStep : -1;
    const recoveredError = errorStep >= 0 && answerStep > errorStep && answerStep > toolStep && !StopWhy.isLimit(r.error);
    const recovered = (failed && recoveredError) || (!failed && recoveredError);
    // Its answer is there too, for a turn whose words never came as a step.
    const answer = !state.agySaid && typeof r.response === "string" && r.response.trim() ? said(r.response) : [];
    const priorError = state.agyErrorText || "";
    resetAgyTurn(state);
    const note = failed && recoveredError ? [{ add:{ kind:"note", text:clip(`Recovered after: ${r.error || r.status}`, 1000) } }] : [];
    return [...(r.conversation_id ? [{ session:r.conversation_id }] : []), ...answer, ...note, { turnEnd:true, ...(recovered ? { recovered:true } : failed ? { failed:r.error || priorError || r.status } : {}) }];
  }
  const step = o.step_update;
  if (o.event !== "step_update" || !step) return [];
  if (step.step_type === "user_input") { state.recoveredTurn = false; return []; }
  const idx = Number.isInteger(step.step_index) ? step.step_index : -1;
  const id = `agy-${step.step_index}`, done = step.state === "DONE";
  if (step.step_type === "error_message") {
    const sameStep = idx >= 0 && state.agyErrorStep === idx;
    if (idx >= 0) state.agyErrorStep = Math.max(Number.isInteger(state.agyErrorStep) ? state.agyErrorStep : -1, idx);
    const raw = String(step.error?.message || (typeof step.error === "string" ? step.error : "") || step.text || step.message || "").trim();
    const delta = typeof step.text_delta === "string" ? step.text_delta : "";
    const msg = raw || (sameStep && state.agyErrorText ? state.agyErrorText + delta : delta).trim();
    if (msg) state.agyErrorText = msg;
    return [];
  }
  if (step.step_type === "agent_response") {
    state.agyText ||= {};
    state.agyText[id] = (state.agyText[id] || "") + (step.text_delta || "");
    if (!done) return [];
    const text = state.agyText[id]; delete state.agyText[id];
    if (!text.trim()) return [];
    state.agySaid = true;
    if (idx >= 0) state.agyAnswerStep = Math.max(Number.isInteger(state.agyAnswerStep) ? state.agyAnswerStep : -1, idx);
    return said(text);
  }
  if (step.step_type !== "tool") return [];
  if (idx >= 0) state.agyToolStep = Math.max(Number.isInteger(state.agyToolStep) ? state.agyToolStep : -1, idx);
  const info = step.tool_info || {}, error = info.error?.message || "";
  const tool = agyTool(step.tool_name || info.name, info.parameters);
  const rawOut = textOf(info.output);
  const exitCode = info.exit_code ?? info.exitCode;
  const cmdFailed = Boolean(error) || (typeof exitCode === "number" && exitCode !== 0) || (done && tool.verb === "Ran" && AGY_NONZERO_EXIT.test(rawOut));
  return [{ upsert:{ id, state:!done ? "running" : cmdFailed ? "failed" : "done", ...(done ? { output:tail(error || rawOut, OUTPUT_MAX) } : {}), ...tool } }];
}
const DIALECTS = { pi:parsePi, opencode:parseOpencode, dsh:parseDsh, kimi:parseKimi, antigravity:parseAntigravity };
// Each of these agents has its own words for the same few things, so a line is read knowing which agent printed it.
// `state` is the run's own, for an agent whose words come in pieces.
function parseDialect(dialect, line, state) {
  const o = eventOf(line);
  return o && typeof o === "object" ? DIALECTS[dialect](o, state) : [];
}
// The line an agent reading JSON on stdin takes as your words: Claude Code's shape, or Antigravity's.
const userLine = (text, dialect = "") => `${JSON.stringify(dialect === "antigravity" ? { event:"user", message:{ content:text } } : { type:"user", message:{ role:"user", content:[{ type:"text", text }] } })}\n`;
// Pi / OMP RPC mode commands over NDJSON stdio.
// OMP's RPC mode defaults to full-message snapshots on every streamed token (O(N^2) stdout + disk spooling).
// Request compact delta message updates and drop high-volume frames PenEcho ignores anyway, while keeping
// delta `message_update` frames so the keeper's `stdoutActivityAt` still sees live streaming progress.
const OMP_RPC_EVENT_FILTER = Object.freeze({
  events:Object.freeze([
    "session",
    "agent_start",
    "agent_end",
    "message_update",
    "message_end",
    "tool_execution_start",
    "tool_execution_end",
    "auto_retry_start",
    "auto_retry_end",
    "auto_compaction_start",
    "auto_compaction_end",
    "manual_compaction_start",
    "manual_compaction_end",
    "retry_fallback_applied",
    "retry_fallback_succeeded",
    "notice",
  ]),
  messageUpdates:"delta",
});
const PI_NOISE_TYPES = new Set(["message_update", "message_start", "turn_start", "turn_end", "tool_execution_update"]);
const PI_NOISE_HINT = /"(?:message_update|message_start|turn_start|turn_end|tool_execution_update)"|\\u/;
function isPiNoiseLine(line) {
  if (typeof line !== "string" || !line.includes("{") || !PI_NOISE_HINT.test(line)) return false;
  const event = eventOf(line);
  return Boolean(event && typeof event === "object" && PI_NOISE_TYPES.has(event.type));
}
function ompLogError(pid, { started = 0, home = os.homedir() } = {}) {
  const pidNum = Number(pid);
  if (!Number.isInteger(pidNum) || pidNum <= 0 || !home) return "";
  const dates = [new Date().toISOString().slice(0, 10)];
  if (started > 0) {
    const startDate = new Date(started).toISOString().slice(0, 10);
    if (!dates.includes(startDate)) dates.push(startDate);
  }
  const logDir = path.join(home, ".omp", "logs");
  for (const date of dates) {
    const file = path.join(logDir, `omp.${date}.${pidNum}.log`);
    let fd;
    try { fd = fs.openSync(file, "r"); } catch { continue; }
    let text = "";
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= 0) continue;
      const len = Math.min(size, 32768);
      const buf = Buffer.alloc(len);
      const got = fs.readSync(fd, buf, 0, len, size - len);
      text = buf.subarray(0, got).toString("utf8");
    } catch { continue; } finally { try { fs.closeSync(fd); } catch {} }
    const lines = text.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw || !raw.startsWith("{")) continue;
      let entry; try { entry = JSON.parse(raw); } catch { continue; }
      if (!entry || entry.level !== "error") continue;
      if (entry.pid != null && Number(entry.pid) !== pidNum) continue;
      if (started > 0) {
        const ts = Date.parse(entry.timestamp);
        if (!Number.isFinite(ts) || ts < started - 5000) continue;
      }
      const msg = String(entry.message || "").trim(), err = String(entry.error || "").trim();
      const combined = msg && err && !err.includes(msg) ? `${msg}: ${err}` : (err || msg);
      if (combined) return combined;
    }
  }
  return "";
}
const piRpcInit = (prompt, { eventFilter = null } = {}) => {
  const frames = [];
  if (eventFilter) frames.push(JSON.stringify({ id:"init-filter", type:"set_event_filter", ...eventFilter }));
  frames.push(JSON.stringify({ id:"init-state", type:"get_state" }));
  frames.push(JSON.stringify({ id:"init-prompt", type:"prompt", message:prompt }));
  return `${frames.join("\n")}\n`;
};
const piRpcSteer = (text, streaming = true, id = "") => `${JSON.stringify({ ...(id ? { id:String(id) } : {}), type:streaming ? "steer" : "prompt", message:text })}\n`;
const piRpcUiResponse = (id, method, answer, cancelled = false) => {
  if (cancelled) return `${JSON.stringify({ type:"extension_ui_response", id:String(id), cancelled:true })}\n`;
  if (method === "confirm") {
    const confirmed = /^(?:y|yes|true|ok|confirm|approve|1)$/i.test(String(answer ?? "").trim());
    return `${JSON.stringify({ type:"extension_ui_response", id:String(id), confirmed })}\n`;
  }
  return `${JSON.stringify({ type:"extension_ui_response", id:String(id), value:String(answer ?? "") })}\n`;
};
const claudeControlResponse = (requestId, response) => `${JSON.stringify({ type:"control_response", response:{ subtype:"success", request_id:String(requestId), response } })}\n`;
// Its turn has ended when it gives its result, in any streaming shape (Claude, Antigravity, Pi/OMP RPC).
const isResult = line => { try { const o = eventOf(line); return o?.type === "result" || o?.event === "result" || isPiTurnEnd(o); } catch { return false; } };
// How many commands Claude Code still has running in the background, when it says (null otherwise).
const backgroundOf = line => { try { const o = eventOf(line); return o?.type === "system" && o.subtype === "background_tasks_changed" && Array.isArray(o.tasks) ? o.tasks.length : null; } catch { return null; } };
function stripCdPrefix(command) {
  let text = String(command || "").trim();
  while (/^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/.test(text)) {
    text = text.replace(/^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/, "").trim();
  }
  return text;
}
// A few plain words for the map and the work's detail file: what is it doing right now?
function nowFrom(row) {
  if (row.kind === "say") return oneLine(row.text.split("\n")[0], 140);
  if (row.kind !== "tool") return "";
  if (row.summary) return oneLine(row.summary, 120);
  if (row.verb === "Ran" && row.target) {
    const clean = stripCdPrefix(row.target);
    if (/\$(?:env:)?PENECHO_ORCH_HELPER|process\.env\.PENECHO_ORCH_HELPER|orch-call\.js/.test(clean)) return "Updating Orchestrator";
    if (/\$(?:env:)?PENECHO_BROWSER_HELPER|process\.env\.PENECHO_BROWSER_HELPER|browser-call\.js|playwright|chromium/i.test(clean)) return "Checking page in browser";
    if (/node --test|npm (?:run )?test|pytest|jest|vitest|cargo test|go test/.test(clean)) return "Running tests";
    if (/npm run (?:build|check|lint|typecheck)|node --check|\btsc\b/.test(clean)) return "Checking build";
    const git = clean.match(/^git\s+(?:-[Cc]\s+\S+\s+|--[\w-]+(?:=\S+)?\s+)*([a-z][\w-]*)/);
    if (git) return `Checking git ${git[1]}`;
    if (/^(?:rg|grep)\b/.test(clean)) return "Searching code";
    return `Running ${oneLine(clean, 80)}`;
  }
  const target = row.target ? (row.code ? oneLine(stripCdPrefix(row.target), 80) : oneLine(String(row.target).split(/[\\/]/).pop(), 80)) : "";
  const verb = { Read:"Reading", Wrote:"Writing", Edited:"Editing", Ran:"Running", "Searched for":"Searching for", "Looked for":"Looking for", "Searched the web for":"Searching the web for", Opened:"Opening", "Asked a helper to":"Asking a helper to", "Updated its plan":"Planning" }[row.verb] || row.verb;
  return target ? `${verb} ${target}` : verb;
}

class ActivityLog {
  constructor(directory) { this.directory = directory; this.logs = new Map(); this.seqs = new Map(); }
  fileOf(project, slug) { return path.join(this.directory, "runs", project.id, `${String(slug).replace(/[^\p{L}\p{N}-]/gu, "_")}.activity.jsonl`); }
  // The pictures sit in files beside the rows, so the rows stay small. A file the agent read may be gone by the time you look.
  picturesOf(project, slug) { return this.fileOf(project, slug).replace(/\.activity\.jsonl$/, ".pictures"); }
  pictureFile(project, slug, name) { return /^[0-9a-f]{16}-\d\.(?:png|jpg|gif|webp)$/.test(String(name)) ? path.join(this.picturesOf(project, slug), name) : ""; }
  savePictures(project, slug, id, images) {
    const folder = this.picturesOf(project, slug), stem = crypto.createHash("sha1").update(String(id)).digest("hex").slice(0, 16), names = [];
    try {
      fs.mkdirSync(folder, { recursive:true });
      images.forEach((image, n) => { const name = `${stem}-${n}.${PICTURE_TYPES[image.type]}`; fs.writeFileSync(path.join(folder, name), Buffer.from(image.data, "base64")); names.push(name); });
    } catch { /* The step still shows, only without its picture. */ }
    return names;
  }
  // Just the latest seq number for a Line, without loading and holding hundreds of MB of historical activity rows in RAM (PE-988).
  // Once loaded (or mutated in this process), the live log's seq is returned directly; otherwise read from the file's tail once.
  seqOf(project, slug) {
    const key = `${project.id}/${slug}`;
    const loaded = this.logs.get(key);
    if (loaded) return loaded.seq;
    if (this.seqs.has(key)) return this.seqs.get(key);
    let seq = 0, fd = null;
    try {
      fd = fs.openSync(this.fileOf(project, slug), "r");
      const size = fs.fstatSync(fd).size;
      if (size > 0) {
        let win = Math.min(size, 65536);
        while (win <= size) {
          const buf = Buffer.allocUnsafe(win), got = fs.readSync(fd, buf, 0, win, size - win);
          const lines = buf.subarray(0, got).toString("utf8").split("\n");
          let parsedAny = false;
          for (let i = win < size ? 1 : 0; i < lines.length; i++) {
            if (!lines[i]) continue;
            try { const row = JSON.parse(lines[i]); parsedAny = true; if ((row?.seq || 0) > seq) seq = row.seq; } catch { /* Partial or corrupt line. */ }
          }
          if (parsedAny || win === size) break;
          win = Math.min(size, win * 4);
        }
      }
    } catch { /* No run has happened yet. */ }
    finally { if (fd !== null) { try { fs.closeSync(fd); } catch {} } }
    if (this.seqs.size >= 50000) this.seqs.clear();
    this.seqs.set(key, seq);
    return seq;
  }
  // A row changes as a tool finishes, so the file keeps every version and the newest one wins when it is read back.
  load(project, slug, { keepRunning = false } = {}) {
    const key = `${project.id}/${slug}`;
    let log = this.logs.get(key);
    if (log) return log;
    log = { rows:[], byId:new Map(), byStepId:new Map(), seq:0, file:this.fileOf(project, slug), written:0 };
    try {
      const raw = fs.readFileSync(log.file, "utf8");
      log.written = raw.length;
      for (const line of raw.split("\n")) {
        if (!line) continue;
        let row; try { row = JSON.parse(line); } catch { continue; }
        log.rows[row.i] = row; log.seq = Math.max(log.seq, row.seq || 0);
        if (row.id) {
          log.byId.set(row.id, row);
          log.byStepId.set(`${row.step || ""}\0${row.id}`, row);
        }
      }
      log.rows = log.rows.filter(Boolean);
      // A run PenEcho lost when it closed is not still running.
      if (!keepRunning) for (const row of log.rows) if (row.state === "running") row.state = "lost";
    } catch { /* No run has happened yet. */ }
    this.logs.set(key, log);
    this.seqs.set(key, log.seq);
    return log;
  }
  persist(log, row) {
    if (log.written > LOG_MAX) return;
    try {
      const line = `${JSON.stringify(row)}\n`;
      fs.mkdirSync(path.dirname(log.file), { recursive:true });
      fs.appendFileSync(log.file, line);
      log.written += line.length;
    } catch { /* The work matters more than the record of it. */ }
  }
  findById(project, slug, id, step = "") {
    if (!id) return null;
    const log = this.load(project, slug);
    return step ? log.byStepId.get(`${step}\0${id}`) || null : log.byId.get(id) || null;
  }
  add(project, slug, fields) {
    const log = this.load(project, slug);
    const row = { i:log.rows.length, at:Date.now(), ...fields, seq:++log.seq };
    log.rows.push(row);
    if (row.id) {
      log.byId.set(row.id, row);
      log.byStepId.set(`${row.step || ""}\0${row.id}`, row);
    }
    this.persist(log, row);
    return row;
  }
  patch(project, slug, id, fields, step = "") {
    const log = this.load(project, slug);
    const row = step ? log.byStepId.get(`${step}\0${id}`) : log.byId.get(id);
    if (!row) return null;
    const { images, ...rest } = fields;
    if (images?.length) rest.pictures = this.savePictures(project, slug, step ? `${step}:${id}` : id, images);
    Object.assign(row, rest, { seq:++log.seq });
    this.persist(log, row);
    return row;
  }
  // Why a run stopped. An agent often says it once as it happens and again as it exits, and once is enough.
  fail(project, slug, text, step = "", at = 0) {
    const log = this.load(project, slug), last = log.rows[log.rows.length - 1];
    if (last?.kind === "note" && last.text === text) { last.kind = "error"; if (at) last.at = at; last.seq = ++log.seq; this.persist(log, last); return last; }
    return this.add(project, slug, { kind:"error", text, step, ...(at ? { at } : {}) });
  }
  // A failure that turned out not to be one reads as a plain note instead.
  renote(project, slug, text, note, step = "") {
    const log = this.load(project, slug), row = [...log.rows].reverse().find(r => r.kind === "error" && r.text === text && (!step || r.step === step));
    if (row) { Object.assign(row, { kind:"note", text:note, seq:++log.seq }); this.persist(log, row); }
  }
  // Says which piece of work each row belongs to, in one go, for rows written before they said so themselves.
  tag(project, slug, tags) {
    const log = this.load(project, slug);
    if (!log.rows.length) return;
    let changed = false;
    for (const row of log.rows) {
      const step = tags.get(row.i);
      if (step && row.step !== step) { row.step = step; row.seq = ++log.seq; changed = true; }
    }
    if (!changed) return;
    log.byStepId.clear();
    for (const row of log.rows) if (row.id) log.byStepId.set(`${row.step || ""}\0${row.id}`, row);
    this.seqs.set(`${project.id}/${slug}`, log.seq);
    try {
      const text = `${log.rows.map(row => JSON.stringify(row)).join("\n")}\n`;
      fs.writeFileSync(log.file, text);
      log.written = text.length;
    } catch { /* The rows still show. They just cannot be split by work after a restart. */ }
  }
  // Rows of one piece of work move to another name, so a later Work with the same number starts clean.
  retag(project, slug, from, to) {
    const log = this.load(project, slug), tags = new Map(log.rows.filter(row => row.step === from).map(row => [row.i, to]));
    if (tags.size) this.tag(project, slug, tags);
  }
  // Anything still open when a run ends did not finish.
  closeOpen(project, slug, step = "") {
    const log = this.load(project, slug);
    for (const row of log.rows.slice(-200)) if (row.state === "running" && (!step || row.step === step)) { row.state = "lost"; row.seq = ++log.seq; this.persist(log, row); }
  }
  since(project, slug, after = 0) {
    const log = this.load(project, slug);
    return { rows:log.rows.filter(row => row.seq > after).slice(-KEEP_MAX), seq:log.seq };
  }
  forget(project, slug) { const key = `${project.id}/${slug}`; this.logs.delete(key); this.seqs.delete(key); }
}

module.exports = { eventOf, retryRow, ActivityLog, parseLine, parseAppServer, parseDialect, userLine, OMP_RPC_EVENT_FILTER, isPiNoiseLine, ompLogError, piRpcInit, piRpcSteer, piRpcUiResponse, claudeControlResponse, isPiTurnEnd, isResult, backgroundOf, toolRow, kimiTool, agyTool, AGY_OAUTH_EXPIRED, isAntigravityOAuthError, isCodexSandboxBroken, codexSandboxBrokeIn, questionsOf, richQuestionsOf, nowFrom, plainCommand, oneLine, partsText, textOf, imagesOf, clip, tail, jsonOf, said, cleanThinking, OUTPUT_MAX, TEXT_MAX };
