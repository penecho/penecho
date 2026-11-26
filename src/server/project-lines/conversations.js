"use strict";
const { ImportState, events } = require("./import-state.js");
const L = require("./layout.js");
const F = require("./format.js");
const fs = require("node:fs");
const os = require("node:os");
const readline = require("node:readline");
const path = require("node:path");
const Git = require("./git.js");
const { parseLine, parseAppServer } = require("./activity.js");
const { writeAtomic } = require("./store.js");
const { CodexServer } = require("./codex-server.js");
const { rolloutLines, rolloutTurnTimes, rolloutTurnEnds, secondsToMs } = require("./codex-history.js");
const { openCodeDatabase } = require("./opencode-db.js");
const { humanWords, piLine, dshLine, readPlain, readFrames, newestDshFile, opencodeUserChanges, opencodePartChanges, opencodePartState } = require("./agent-sessions.js");
const { kimiStores, inDesktop, kimiFolders, kimiFiles, kimiHead, kimiLine, kimiTitle, kimiHolds } = require("./kimi-sessions.js");
const { WORKBUDDY, workbuddyHome, workbuddyFolders, workbuddyFiles, workbuddyLine, workbuddyFile, workbuddyTitle } = require("./workbuddy-sessions.js");
const { listAntigravityConversations, antigravityTitle, antigravityHasSession, antigravityTranscript, antigravityDbStamp, parseAntigravityStep } = require("./antigravity-sessions.js");
const { antigravityTranscriptState } = require("./run-watch.js");
const { checkpointOf, alreadyHandled } = require("./pi-checkpoint.js");

// Conversations people have with their agents anywhere else, in a folder linked to a project.
// Codex and OpenCode offer their own commands to list and read them. Claude Code, Pi, dsh, Kimi and WorkBuddy keep a file for each one,
// so only a few plain fields are read from those, and anything unexpected is skipped rather than guessed at.
// Only folders linked to a project are looked at, and only what is said after the project was linked is recorded.
const IDLE_MS = 45000, TURN_OPEN_MS = 300000, PENDING_TASK_MS = 30 * 60000, READ_LIMIT = 8 * 1024 * 1024, ROOTS_MS = 60000, CODEX_MS = 6000, CODEX_LIST = 60, CODEX_SCAN_PAGES = 3, OPENCODE_MS = 6000, OPENCODE_IDLE_MS = 60000, OPENCODE_LIST = "30", CLI_MS = 20000;
const LABELS = { claude:{ "claude-desktop":"Claude desktop", cli:"Claude Code", "claude-vscode":"Claude in VS Code" }, codex:{ "Codex Desktop":"Codex desktop", codex_cli_rs:"Codex", codex_vscode:"Codex in VS Code" } };
// An agent waiting on your answer has not finished, however long you take. A conversation closed without answering says nothing, so a day later it no longer counts.
const QUESTION_OPEN_MS = 24 * 3600000, STALE_MS = 60000;
const AG_IDLE_AGE_MS = 5 * 60000, AG_IDLE_RECHECK_MS = 60000, STALE_IDLE_AGE_MS = 10 * 60000, STALE_RECHECK_MS = 60000, MOST_SETTLED = 20000;
const INTERRUPTED_WHY = "PenEcho closed while this was running. Retry to continue from the saved conversation and files.";
// A look that has got no further for this long waits on something that will never answer, such as a Codex app-server that stopped replying: it is given up so the next look runs.
const LOOK_STUCK_MS = 180000;
const openQuestion = rec => (rec.asking && Date.now() - rec.asking.at < QUESTION_OPEN_MS ? rec.asking : null);
const plainWindowsPath = value => value.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\(?=[a-z]:\\)/i, "");
const inside = (folder, root) => { const rel = path.relative(process.platform === "win32" ? plainWindowsPath(root) : root, process.platform === "win32" ? plainWindowsPath(folder) : folder); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
const realFolder = folder => { try { return fs.realpathSync(folder); } catch { return folder; } };
// When any transcript in a folder last changed, or 0.
const newestTranscript = dir => { let names; try { names = fs.readdirSync(dir); } catch { return 0; } return names.filter(n => n.endsWith(".jsonl")).reduce((most, n) => { try { return Math.max(most, fs.statSync(path.join(dir, n)).mtimeMs); } catch { return most; } }, 0); };
// The repository a checkout really belongs to. A copied folder keeps the original's list of worktrees, though those still belong to the original.
function checkoutOf(folder) {
  const dotGit = path.join(folder, ".git");
  try {
    if (fs.statSync(dotGit).isDirectory()) return realFolder(dotGit);
    // A worktree's file points into <repository>/worktrees/<name>. A submodule's points straight at its repository.
    const linked = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m)?.[1].trim(), real = linked ? realFolder(path.resolve(folder, linked)) : "";
    return real && path.basename(path.dirname(real)) === "worktrees" ? path.dirname(path.dirname(real)) : real;
  } catch { return ""; }
}
const encodeFolder = folder =>String(folder).replace(/[^a-zA-Z0-9]/g, "-");
// Pi and omp write the same transcripts, and PenEcho remembers how far it has read either the same way.
const PI_FAMILY = new Set(["pi", "omp"]);
// omp names a folder in your home by its path from there, slashes as dashes: ~/workspace/my_app is -workspace-my_app. Elsewhere it is matched as Pi's are, and the transcript's own folder settles the rest.
function ompFolders(home, roots, names) {
  const wanted = roots.flatMap(root => { const rel = path.relative(home, root); return [encodeFolder(root), ...(rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? [encodeFolder(`-${rel}`)] : [])]; });
  return names.filter(name => { const plain = encodeFolder(name).replace(/^-+(?=-)/, ""); return wanted.some(e => plain === e || plain.startsWith(`${e}-`)); }).map(name => ({ name, cwd:"" }));
}

// What a person typed and attached, however the transcript holds it: plain words, or a list of words and pictures.
// Pictures come with their data, so they can be kept. One that somehow has none is at least counted.
function claudeSaid(content) {
  const parts = Array.isArray(content) ? content : [{ type:"text", text:content }];
  const words = humanWords(parts.filter(p => p?.type === "text").map(p => p.text).join("\n")), images = parts.filter(p => p?.type === "image");
  const pictures = images.map(p => ({ type:p.source?.media_type || "image/png", data:p.source?.data })).filter(p => typeof p.data === "string" && p.data), lost = images.length - pictures.length;
  const text = [words, lost ? `[${lost} ${lost === 1 ? "picture" : "pictures"}]` : ""].filter(Boolean).join("\n");
  return text || pictures.length ? [{ me:text, ...(pictures.length ? { pictures } : {}) }] : [];
}
// One line of a Claude Code transcript. Scripted runs and helpers are not conversations with a person.
function claudeLine(line) {
  let o; try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== "object" || o.isSidechain || o.isMeta) return null;
  // The short title Claude gives the conversation itself, as it shows in its list. A name the person gave it (custom-title) is not the agent's.
  if (o.type === "ai-title") return typeof o.aiTitle === "string" && o.aiTitle.trim() ? { at:0, title:o.aiTitle.trim(), changes:[] } : null;
  const at = Date.parse(o.timestamp) || 0, meta = { at, cwd:o.cwd, branch:o.gitBranch, entrypoint:o.entrypoint };
  if (String(o.entrypoint || "").startsWith("sdk")) return { ...meta, scripted:true, changes:[] };
  // Something said while the agent was working. With a picture attached, it is a list rather than plain words.
  if (o.type === "attachment" && o.attachment?.type === "queued_command") return { ...meta, changes:o.attachment.origin?.kind && o.attachment.origin.kind !== "human" ? [] : claudeSaid(o.attachment.prompt) };
  if (o.type === "user") {
    // Claude Code writes its summary of a long conversation as a user message. Nobody typed it.
    if (o.isCompactSummary || o.isVisibleInTranscriptOnly || (o.origin?.kind && o.origin.kind !== "human")) return { ...meta, changes:[] };
    return { ...meta, changes:[...claudeSaid(o.message?.content), ...parseLine(line).filter(c => c.patch)], turnOpen:true };
  }
  if (o.type === "assistant") {
    const changes = parseLine(line).filter(c => c.add || c.said);
    return { ...meta, changes, turnOpen:(o.message?.content || []).some(p => p?.type === "tool_use") };
  }
  return null;
}
// Codex's app puts a list of attached files in front of what was typed. The words are what was typed, and the files are named after them.
// A picture kept with the message needs no name as well: by its file, or all of them when every picture came as data.
function codexWords(value, kept = new Set(), allKept = false) {
  const text = humanWords(value), found = text.match(/^#\s*Files (?:mentioned|pasted) by the user:\s*\n([\s\S]*?)^##\s*My request(?: for Codex)?:[ \t]*\n?([\s\S]*)$/im);
  const stripReq = s => s.replace(/^(?:#{1,3}\s*My request(?: for Codex)?:[ \t]*\n?)+/i, "").trim();
  if (!found) return stripReq(text);
  const files = [...found[1].matchAll(/^##\s*(.+?):\s(.*)$(\nImage attachment: true$)?/gm)].filter(m => !kept.has(m[2].trim()) && !(allKept && m[3])).map(m => m[1].replace(/^"(.{0,40}).*"$/, "$1"));
  return [stripReq(found[2]), files.length ? `[Attached: ${files.join(", ")}]` : ""].filter(Boolean).join("\n\n");
}
// A picture pasted into Codex is a file it saved for the message, usually in a temporary folder, and its data is also in Codex's own record of the conversation.
const PICTURE_TYPES = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp" }, PICTURE_MOST = 20 * 1024 * 1024;
// What an Antigravity conversation's last read saw: its transcript's size and time, and the summary's status, title and time.
function antigravityStamp(entry, stat = fs.statSync(entry.file, { throwIfNoEntry:false })) {
  return stat ? `${stat.size}|${stat.mtimeMs}|${entry.busy ? 1 : 0}|${entry.status || ""}|${entry.title}|${entry.updated}` : "";
}
function pictureFile(file) {
  const type = PICTURE_TYPES[path.extname(String(file || "")).slice(1).toLowerCase()];
  try { const stat = fs.statSync(file); return type && stat.isFile() && stat.size <= PICTURE_MOST ? { type, data:fs.readFileSync(file).toString("base64") } : null; } catch { return null; }
}
// Any other file attached in Codex is only named in the message. It is kept with the Topic as a picture is, so it is still there to open when the place it came from is not.
const FILE_MOST = 25 * 1024 * 1024;
const keepableFile = file => { try { const stat = fs.statSync(file); return stat.isFile() && stat.size <= FILE_MOST; } catch { return false; } };
function attachedFiles(value) {
  const list = String(value ?? "").match(/^#\s*Files (?:mentioned|pasted) by the user:\s*\n([\s\S]*?)^##\s*My request/im)?.[1] || "";
  return [...list.matchAll(/^##\s*.+?:\s(.*)$(\nImage attachment: true$)?/gm)].filter(m => !m[2] && path.isAbsolute(m[1].trim()) && keepableFile(m[1].trim())).map(m => m[1].trim());
}
const dataPicture = url => { const m = String(url || "").match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/); return m ? { type:m[1], data:m[2] } : null; };
const missingPicture = item => item?.type === "userMessage" && (item.content || []).some(p => p?.type === "localImage" && !fs.existsSync(String(p.path || "")));
// The pictures people sent, from Codex's record, by the file each was saved as. Only needed once that file has gone.
async function rolloutPictures(file) {
  const found = new Map();
  if (!file) return found;
  for await (const line of rolloutLines(file)) {
    if (!line.includes('"input_image"') || !line.includes('"role":"user"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const content = o?.type === "response_item" && o.payload?.type === "message" && o.payload.role === "user" && Array.isArray(o.payload.content) ? o.payload.content : [];
    // Each picture follows a note naming its file. Without one, they come in the order the list of files gives.
    const listed = content.filter(p => p?.type === "input_text").flatMap(p => [...String(p.text).matchAll(/^##\s*.+?:\s(.+)\nImage attachment: true$/gm)].map(m => m[1].trim()));
    let named = "";
    for (const part of content) {
      if (part?.type === "input_text") { named = String(part.text).match(/^<image\b[^>]*\bpath="([^"]+)"/)?.[1] || named; continue; }
      if (part?.type !== "input_image") continue;
      const at = named || listed[0], pic = dataPicture(part.image_url);
      if (listed.includes(at)) listed.splice(listed.indexOf(at), 1);
      if (at && pic) found.set(at, pic);
      named = "";
    }
  }
  return found;
}
// One item of a Codex thread.
function codexChanges(item, finished = true, found = new Map()) {
  if (item?.type === "userMessage") {
    const parts = item.content || [], kept = new Set(), pictures = [];
    let lost = 0;
    for (const p of parts) {
      if (p?.type === "localImage") { const pic = pictureFile(p.path) || found.get(p.path); if (pic) { pictures.push(pic); kept.add(String(p.path).trim()); } else lost++; }
      else if (p?.type === "image") { const pic = dataPicture(p.url); if (pic) pictures.push(pic); else lost++; }
      else if (/image/i.test(p?.type || "")) lost++;
    }
    const text = parts.filter(p => p?.type === "text").map(p => p.text).join("\n"), files = attachedFiles(text);
    for (const file of files) kept.add(file);
    const words = codexWords(text, kept, pictures.length > 0 && !lost), counted = /\[Attached: /.test(words) ? 0 : lost;
    const me = [words, counted ? `[${counted} ${counted === 1 ? "picture" : "pictures"}]` : ""].filter(Boolean).join("\n");
    return me || pictures.length || files.length ? [{ me, ...(pictures.length ? { pictures } : {}), ...(files.length ? { files } : {}) }] : [];
  }
  return parseAppServer({ method:finished ? "item/completed" : "item/started", params:{ item } });
}

// Every line of a transcript, for one look back over it.
async function* wholeFile(source, file) {
  if (file.endsWith(".zstd")) yield* source.read(file, 0, fs.statSync(file).size, Infinity).lines;
  else yield* readline.createInterface({ input:fs.createReadStream(file), crlfDelay:Infinity });
}
const RECENT_WORK_MS = 15 * 60 * 1000, SYNC_MOST = 50, BRANCH_MS = 5000, LIVE_MS = 10 * 60 * 1000;
class Conversations {
  constructor({ directory, service, env = process.env, home = os.homedir(), codex = null, opencode = null, idleMs = IDLE_MS, saveDebounceMs = 750 }) {
    this.service = service;
    this.shared = new ImportState(service);
    this.idleMs = idleMs; this.saveDebounceMs = saveDebounceMs;
    this.afterSave = new Set();
    this.env = env;
    this.file = path.join(directory, "conversations.json");
    this.home = home;
    this.claudeProjects = path.join(env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "projects");
    // The agents that keep one file for each conversation, in a folder named after where it happened.
    const dshHome = env.DSH_HOME || path.join(home, ".dsh");
    this.dirMemo = null;
    const inFolder = dir => {
      if (this.dirMemo?.has(dir)) return this.dirMemo.get(dir);
      let names; try { names = fs.readdirSync(dir); } catch { names = []; }
      const out = names.map(name => path.join(dir, name));
      this.dirMemo?.set(dir, out);
      return out;
    };
    // <time>_<id>.jsonl. omp also keeps a lock file beside one it is writing, whose name starts with a dot.
    const piFiles = dir => inFolder(dir).filter(f => f.endsWith(".jsonl") && !path.basename(f).startsWith(".")).map(full => ({ id:path.basename(full, ".jsonl").split("_").pop(), full }));
    this.kimi = kimiStores(env, home);
    this.workbuddy = workbuddyHome(env, home);
    this.fileAgents = [
      // Claude Code writes each helper's transcript in a folder named after the conversation, and nothing in the conversation's own until the helper is done.
      { agent:"claude", root:this.claudeProjects, line:claudeLine, read:readPlain, files:dir => inFolder(dir).filter(f => f.endsWith(".jsonl")).map(full => ({ id:path.basename(full, ".jsonl"), full })), helpers:full => newestTranscript(path.join(full.slice(0, -".jsonl".length), "subagents")) },
      { agent:"pi", via:"Pi", root:path.join(env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent"), "sessions"), line:piLine, read:readPlain, files:piFiles },
      { agent:"omp", via:"omp", root:path.join(home, ".omp", "agent", "sessions"), line:piLine, read:readPlain, folders:(roots, names) => ompFolders(home, roots, names), files:piFiles },
      { agent:"dsh", via:"dsh", root:path.join(dshHome, "sessions"), line:row => dshLine(row, dshHome), read:(full, ...rest) => (full.endsWith(".zstd") ? readFrames : readPlain)(full, ...rest), files:dir => inFolder(dir).map(sub => ({ id:path.basename(sub), full:newestDshFile(sub) })).filter(f => f.full) },
      // Kimi keeps the same log in its desktop app's store and in its command line's. Neither log says where it happened: the folder it is filed under does.
      ...[this.kimi.desktop, this.kimi.cli].map(store => ({ agent:"kimi", via:store.via, root:path.join(store.home, "sessions"), line:kimiLine, read:readPlain, folders:(roots, names) => kimiFolders(store.home, roots, names), files:dir => kimiFiles(dir, store.prefix), ...(store === this.kimi.cli ? { head:kimiHead } : {}) })),
      ...(WORKBUDDY.hidden ? [] : [{ agent:"workbuddy", via:"WorkBuddy", root:path.join(this.workbuddy, "projects"), line:workbuddyLine, read:readPlain, folders:workbuddyFolders, files:workbuddyFiles }]),
    ];
    this.opencodeData = path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "opencode");
    this.opencodeOverride = opencode;
    this.opencodeAt = 0;
    this.opencodeLook = { stamp:"", at:0 };
    this.codexOverride = codex;
    this.rootsCache = new Map();
    this.branchSeen = new Map();
    this.agDbStamp = "";
    this.agChecked = new Map();
    this.staleSettled = new Map();
    this.codexAt = 0;
    this.codexCursor = "";
    this.codexFailures = 0;
    this.codexBackoffUntil = 0;
    this.closed = false;
    this.loadError = null;
    try { this.records = JSON.parse(fs.readFileSync(this.file, "utf8")); }
    catch (error) {
      this.records = {};
      if (error?.code !== "ENOENT") this.loadError = error;
    }
    // Held folders (the desktop app, http.js openFolders) are not read yet: the runtime reconciles them when it starts (reload).
    if (!service?.foldersHeld) this.shared.reconcile(this.records);
    this.saved = JSON.stringify(this.records);
    this.dirty = false;
    this.saveAfter = 0;
    this.lookId = 0;
    this.unreadable = 0;
  }
  reload() {
    this.flush();
    if (this.dirty && !this.loadError) throw Error("Cannot reload unsaved conversation bindings.");
    let loaded;
    try {
      loaded = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") loaded = {};
      else throw Object.assign(new Error(`Could not read conversation bindings: ${error.message}`), { code:"CONVERSATIONS_UNREADABLE", cause:error });
    }
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
      throw Object.assign(new Error("Conversation bindings file has an invalid shape."), { code:"CONVERSATIONS_CORRUPT" });
    }
    this.records = loaded;
    this.loadError = null;
    this.shared.reconcile(this.records);
    this.saved = JSON.stringify(this.records);
    this.dirty = false;
    this.saveAfter = 0;
  }
  // Never throws: failed saves leave the records dirty. Unchanged records do not touch the disk, and a full disk is retried once a minute.
  save(force = false) {
    if (this.loadError || !this.dirty || (!force && Date.now() < (this.saveAfter || 0))) return;
    const data = JSON.stringify(this.records);
    try {
      if (data !== this.saved) writeAtomic(this.file, data);
      this.saved = data;
      this.dirty = false;
      this.saveAfter = 0;
      if (this.saveFailed) { this.saveFailed = ""; console.warn("[PenEcho] Saving the conversations from other apps works again."); }
    } catch (error) {
      const code = error.code || "failed", retry = code === "ENOSPC" ? "in a minute" : "on the next look";
      this.saveAfter = code === "ENOSPC" ? Date.now() + 60000 : 0;
      if (this.saveFailed !== code) console.warn(`[PenEcho] Could not save the conversations from other apps (${error.code || error.message}); trying again ${retry}.`);
      this.saveFailed = code;
      return;
    }
    for (const notify of this.afterSave) notify();
    this.afterSave.clear();
  }
  // One look at a time. Each step a look gets through counts as progress; a look gone LOOK_STUCK_MS without any is given up,
  // so one that waits forever never stops every later look. A given-up look ends at its next step and leaves busy to the new one.
  begin() { this.busy = true; this.lookAt = Date.now(); return ++this.lookId; }
  flush() { clearTimeout(this.saveTimer); this.saveTimer = null; this.save(true); }
  end(look) { if (look === this.lookId) this.busy = false; this.flush(); }
  stuck() { return this.busy && Date.now() - (this.lookAt || 0) > LOOK_STUCK_MS; }
  giveUp() {
    console.warn(`[PenEcho] A look at the conversations from other apps got no further for ${Math.round((Date.now() - this.lookAt) / 1000)} s; starting a new one.`);
    // A request Codex never answers is the likely wait: closing its app-server ends it, and the next look starts a new one.
    this.codexServer?.close();
    this.busy = false; this.syncing = false;
  }
  moved(look) { if (look !== this.lookId) return true; this.lookAt = Date.now(); return false; }
  key(agent, id) { return `${agent}:${id}`; }
  recordOf(agent, id, fields = {}) {
    const key = this.key(agent, id);
    const deleted = !this.records[key] && Object.values(this.service.store.deleted).find(d => d.bindings?.some(b => b.agent === agent && b.id === id));
    const rec = this.records[key] ||= { agent, id, offset:0, doneTurns:{}, lastAt:0, lastSay:"", active:false, ...(deleted ? { projectId:deleted.projectId, slug:deleted.slug } : {}) };
    Object.assign(rec, fields);
    this.dirty = true;
    return rec;
  }
  // A conversation PenEcho started belongs to its Topic. What PenEcho ran is already recorded, so only what comes later is read.
  bind(agent, id, project, slug, cwd, stepId = "") {
    const known = this.records[this.key(agent, id)];
    if (known?.slug && (known.slug !== slug || known.projectId !== project.id)) return;
    this.recordOf(agent, id, { projectId:project.id, slug, cwd, ...(known?.slug ? {} : { via:"", startedHere:true, skipUntil:PI_FAMILY.has(agent) ? 0 : Date.now() }), ...(stepId ? { stepId } : {}), interrupted:false });
    this.shared.bind(project, this.records[this.key(agent, id)], Boolean(this.service.isSessionRunning(agent, id)));
    this.flush();
  }
  isIgnored(agent, id, rec = this.records[this.key(agent, id)]) {
    return Boolean((rec?.penechoRun && !rec.startedHere) || this.service.isInternalSession?.(agent, id));
  }
  // A session PenEcho started for its own internal use (such as a Work reviewer or Ask-tab query)
  // belongs to that UI feature, never to a separate imported Line.
  ignoreSession(agent, id) {
    if (!agent || !id) return;
    const known = this.records[this.key(agent, id)];
    if (known?.slug || known?.startedHere || known?.penechoRun) return;
    this.recordOf(agent, id, { penechoRun:true });
    this.flush();
  }
  // Only a message that reached the activity log is handled. Equal timestamps can
  // contain several parallel tool results, so remember each message at that edge.
  checkpointPi(id, checkpoint, agent = "pi") {
    const rec = this.records[this.key(agent, id)];
    if (!rec || !checkpoint || checkpoint.at < (rec.piCheckpoint?.at || 0)) return;
    const hashes = checkpoint.at === rec.piCheckpoint?.at ? rec.piCheckpoint.hashes : [];
    rec.piCheckpoint = { at:checkpoint.at, hashes:[...new Set([...hashes, ...(checkpoint.hash ? [checkpoint.hash] : [])])] };
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, this.saveDebounceMs);
    this.saveTimer.unref();
    return true;
  }
  caughtUp(agent, id, { release = true } = {}) {
    const rec = this.records[this.key(agent, id)];
    if (!rec) return;
    if (!(PI_FAMILY.has(agent) && rec.piCheckpoint)) this.recordOf(agent, id, { skipUntil:Math.max(rec.skipUntil || 0, Date.now() + 1000) });
    const project = this.service.store.projects.find(p => p.id === rec.projectId);
    if (release && project) this.shared.ended(project, rec);
    this.flush();
  }
  // PenEcho stopped its run. What the agent wrote while it was being stopped is that run's last breath, never someone carrying on
  // elsewhere: a killed turn has no end, so read as one it held the line at Working and undid "Stopped by you" (PE-1160).
  stoppedRun(agent, id, { until = Date.now(), interrupted = false } = {}) {
    const rec = this.records[this.key(agent, id)];
    if (!rec) return;
    // Message times are when each began, so the moment it ended covers the last one, whether or not it was whole.
    if (PI_FAMILY.has(agent) && (rec.piCheckpoint?.at || 0) < until) rec.piCheckpoint = { at:until, hashes:[] };
    Object.assign(rec, { active:false, turnOpen:false, asking:null, now:"", ...(interrupted ? { interrupted:true } : {}) });
    this.dirty = true;
    this.caughtUp(agent, id);
  }
  // The linked folders, with any other checkouts of the same repository, wherever they are kept.
  async rootsOf(project) {
    const cached = this.rootsCache.get(project.id);
    if (cached && Date.now() - cached.at < ROOTS_MS) return cached.roots;
    const roots = new Set([project.docsPath, ...(project.codePaths || [])].filter(Boolean).flatMap(p => [p, realFolder(p)]));
    for (const code of project.codePaths || []) {
      // A code folder that is gone or unreadable has no other checkouts to find; it never stops the rest of the project's folders being used.
      try {
        const listed = await Git.git(code, ["worktree", "list", "--porcelain"]), common = realFolder(await Git.commonDir(code));
        for (const line of listed.ok ? listed.stdout.split("\n") : []) if (line.startsWith("worktree ")) { const p = line.slice(9).trim(); if (common && checkoutOf(p) === common) { roots.add(p); roots.add(realFolder(p)); } }
      } catch { /* Left to the folder itself. */ }
    }
    const list = [...roots];
    this.rootsCache.set(project.id, { at:Date.now(), roots:list });
    return list;
  }
  // The Topics of the conversations lately at work in this folder, the most recent first.
  topicsWorkingIn(project, root) {
    const inside = cwd => { if (!cwd) return false; let real = cwd; try { real = fs.realpathSync(cwd); } catch { /* It may have gone. */ } return real === root || real.startsWith(root + path.sep); };
    const recent = Object.values(this.records).filter(r => r.projectId === project.id && r.slug && inside(r.cwd) && Date.now() - (r.lastAt || 0) < RECENT_WORK_MS);
    return [...new Set(recent.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)).map(r => r.slug))];
  }
  sinceOf(project) { return Number(project.followSince) || Number(project.createdAt) || 0; }
  async tick() {
    if (this.busy && !this.stuck()) return;
    if (this.busy) this.giveUp();
    const look = this.begin(), over = () => this.moved(look) || this.syncWaiting;
    this.dirMemo = new Map();
    try {
      const followed = this.service.store.projects.filter(p => p.follow !== false);
      if (!followed.length) return;
      this.releaseGone();
      const linked = [];
      // A project whose docs folder is gone, or whose folders cannot be read, is passed over: it never stops the others being followed.
      for (const project of followed) {
        if (project.docsPath && !fs.existsSync(project.docsPath)) continue;
        try { linked.push({ project, roots:await this.rootsOf(project) }); } catch { /* Tried again at the next look. */ }
      }
      // A sync someone is waiting for goes first. What this look leaves undone, the next one does.
      for (const source of this.fileAgents) {
        let names = [];
        try { names = fs.readdirSync(source.root); } catch { continue; /* This agent has not been used here. */ }
        for (const entry of linked) { if (over()) return; await this.scanFiles(source, entry, names).catch(() => {}); }
      }
      if (over()) return;
      if (Date.now() - this.codexAt >= CODEX_MS) { this.codexAt = Date.now(); await this.scanCodex(linked).catch(() => {}); }
      if (over()) return;
      if (Date.now() - this.opencodeAt >= OPENCODE_MS) { this.opencodeAt = Date.now(); await this.scanOpencode(linked).catch(() => {}); }
      if (over()) return;
      await this.scanAntigravity(linked).catch(() => {});
      for (const entry of linked) { if (over()) return; await this.settle(entry.project, { fromTick:true }).catch(() => {}); }
      for (const entry of linked) { if (over()) return; await this.fillPictures(entry.project).catch(() => {}); }
      for (const entry of linked) { if (over()) return; await this.fillCodexPictures(entry.project).catch(() => {}); }
      for (const entry of linked) { if (over()) return; try { this.service.fillMentionedFiles?.(entry.project); } catch { /* Tried again after the next restart. */ } }
    } finally { this.dirMemo = null; this.end(look); }
  }
  // Each agent names these folders a little differently. The folder inside each file settles which conversations really belong.
  // Pi and dsh wrap the path in two dashes. Claude Code turns every character but a plain letter or digit into a dash, so a folder named in Chinese ends in dashes that are its name, not a wrapper.
  *filesIn(source, roots, names) {
    if (source.folders) { for (const { name, cwd } of source.folders(roots, names)) for (const found of source.files(path.join(source.root, name))) yield { ...found, cwd }; return; }
    const encoded = roots.map(encodeFolder);
    for (const name of names) {
      const plain = encodeFolder(name).replace(/^-+(?=-)/, "");
      if (encoded.some(e => plain === e || plain.startsWith(`${e}-`))) yield* source.files(path.join(source.root, name));
    }
  }
  // Where a conversation happened, for an agent whose log does not say and whose folder does.
  placeAt(rec, cwd, project) { if (cwd && !rec.cwd) Object.assign(rec, { cwd, startedIn:rec.startedIn || cwd, here:rec.here || project.id }); }
  // Two folders can share one name here, as 线性代数 and 物理学习 both become four dashes. A conversation another project has taken, or that happens in another project's folder, stays there.
  // One pasted from another project's line still happens in this folder, so it is still read here.
  ownedElsewhere(project, rec) { const owner = rec?.readBy || rec?.projectId || rec?.here; return Boolean(owner && owner !== project.id); }
  // A deleted project leaves its conversations behind. They are nobody's now, so a project linked to their folder can take them, read from the start.
  releaseGone() {
    const ids = new Set(this.service.store.projects.map(p => p.id));
    if (!ids.size) return;
    for (const rec of Object.values(this.records)) {
      const owners = [rec.readBy, rec.projectId, rec.here].filter(Boolean);
      if (!owners.length || owners.some(id => ids.has(id)) || this.service.isSessionRunning(rec.agent, rec.id)) continue;
      for (const field of ["readBy", "here", "foreign", "projectId", "slug", "stepId", "appStep", "updated", "seq", "piCheckpoint", "settled", "agStamp", "explicitIdle", "heardAt"]) delete rec[field];
      Object.assign(rec, { offset:0, size:0, doneTurns:{}, openItems:{}, lastSay:"", skipUntil:0, elsewhere:false, active:false });
      this.dirty = true;
    }
  }
  // Kimi Code names a conversation only as it ends, so meanwhile a run PenEcho started has none, and its log would come in as a line of its own.
  // The service binds such a log to its run instead (claimUnnamed); one whose first Ask is not written yet waits for the next look.
  takenByRun(source, id, cwd, full) { return Boolean(source.head && this.service.awaitsName?.(source.agent) && this.service.claimUnnamed(source.agent, id, cwd, source.head(full))); }
  async scanFiles(source, { project, roots }, names) {
    const since = this.sinceOf(project);
    for (const { id, full, cwd } of this.filesIn(source, roots, names)) {
      this.lookAt = Date.now();
      let stat; try { stat = fs.statSync(full); } catch { continue; }
      const known = this.records[this.key(source.agent, id)];
      if (this.ownedElsewhere(project, known) || this.isIgnored(source.agent, id, known)) continue;
      if (!known?.slug && this.takenByRun(source, id, cwd, full)) continue;
      // Already read for another project with a folder of the same name, and found to have happened here: read it again for this one.
      if (known?.foreign && !known.slug && roots.some(root => inside(known.foreign, root))) Object.assign(known, { offset:0, size:0, seq:undefined, doneTurns:{}, openItems:{}, foreign:"", elsewhere:false });
      if (known && known.file && known.file !== full) { known.file = full; known.offset = 0; known.size = 0; }
      if (known && (known.size === stat.size || this.service.isSessionRunning(source.agent, id))) { if (known.size === stat.size) known.mtime = Math.max(stat.mtimeMs, this.waitsOnHelpers(known) && source.helpers ? source.helpers(full) : 0); continue; }
      // A conversation untouched since before this project was linked stays out of it.
      if (!known && stat.mtimeMs < since) continue;
      const rec = known || this.recordOf(source.agent, id);
      rec.file = full;
      this.placeAt(rec, cwd, project);
      // One conversation that cannot be read stays out of this look; the others after it are still read.
      try { await this.readFile(source, project, roots, rec, stat, since); } catch { /* Tried again at the next look. */ }
    }
  }
  // ---------- Bringing in what was said before ----------
  // Only when someone asks. Each conversation not already here becomes its own line, latest first, and no agent is woken or asked anything.
  async syncRecent(project) {
    this.flush();
    this.syncWaiting = (this.syncWaiting || 0) + 1;
    try { while (this.busy && !this.stuck()) await new Promise(resolve => setTimeout(resolve, 25)); }
    finally { this.syncWaiting--; }
    if (this.busy) this.giveUp();
    const look = this.begin();
    this.syncing = true;
    let added = 0, elsewhere = [];
    const warnings = [];
    try {
      // The latest ones, however old: newest first, until 50 are in. The folders as they are now, not as they were a minute ago: one linked just before is looked in too.
      this.rootsCache.delete(project.id);
      this.releaseGone();
      // Each agent is looked in on its own: one that fails says so, and the others are still brought in.
      const since = 0, entry = { project, roots:await this.rootsOf(project).catch(() => [project.docsPath, ...(project.codePaths || [])].filter(Boolean)) };
      const found = [
        this.recentFiles(entry, since, warnings),
        await this.recentCodex(entry, since, warnings).catch(error => { warnings.push(`Codex: ${error.message}`); return []; }),
        await this.recentOpencode(entry, since, warnings).catch(error => { warnings.push(`OpenCode: ${error.message}`); return []; }),
        (() => { try { return this.recentAntigravity(entry, since); } catch (error) { warnings.push(`Antigravity: ${error.message}`); return []; } })(),
      ].flat().sort((a, b) => b.at - a.at);
      for (const item of found) {
        if (added >= SYNC_MOST) break;
        const known = this.records[this.key(item.agent, item.id)];
        if (known?.slug || this.isIgnored(item.agent, item.id, known)) continue;
        // An earlier look may have read past all of this, because it was from before the project was linked.
        const rec = this.recordOf(item.agent, item.id, { resync:true, offset:0, size:0, seq:undefined, doneTurns:{}, openItems:{}, updated:undefined, elsewhere:false, agStamp:undefined, explicitIdle:false, heardAt:0 });
        try { await item.read(rec, since); } catch (error) { warnings.push(`${item.agent} conversation ${item.id}: ${error.message}`); }
        if (rec.slug) added++;
        if (this.moved(look)) break;
      }
      await this.settle(project).catch(() => {});
      this.flush();
      // Nothing new, but these folders may have conversations another project already took. Say which, rather than that there are none.
      if (!added) {
        const owners = new Set(Object.values(this.records).filter(r => r.slug && r.projectId && r.projectId !== project.id && r.cwd && entry.roots.some(root => inside(r.cwd, root))).map(r => r.projectId));
        elsewhere = this.service.store.projects.filter(p => owners.has(p.id)).map(p => p.name);
      }
    } finally { if (look === this.lookId) this.syncing = false; this.end(look); }
    return { added, most:SYNC_MOST, elsewhere, ...(warnings.length ? { warnings } : {}) };
  }
  recentFiles({ project, roots }, since, warnings = []) {
    const found = [];
    for (const source of this.fileAgents) {
      let names; try { names = fs.readdirSync(source.root); } catch { continue; }
      // An agent whose folder cannot be walked leaves the others in.
      try {
        for (const { id, full, cwd } of this.filesIn(source, roots, names)) {
          let stat; try { stat = fs.statSync(full); } catch { continue; }
          const known = this.records[this.key(source.agent, id)];
          if (stat.mtimeMs < since || this.service.isSessionRunning(source.agent, id) || this.ownedElsewhere(project, known) || this.isIgnored(source.agent, id, known)) continue;
          if (!known?.slug && this.takenByRun(source, id, cwd, full)) continue;
          found.push({ agent:source.agent, id, at:stat.mtimeMs, read:rec => { this.placeAt(rec, cwd, project); return this.readWhole(source, project, roots, rec, stat, since, full); } });
        }
      } catch (error) { warnings.push(`${source.agent}: ${error.message}`); }
    }
    return found;
  }
  // All of it now, rather than a piece at each look. If it fails part way, the rest stays out rather than coming twice.
  async readWhole(source, project, roots, rec, stat, since, full) {
    rec.file = full;
    for (let before = -1; rec.offset < stat.size && rec.offset !== before;) { before = rec.offset; await this.readFile(source, project, roots, rec, stat, since); }
  }
  async recentCodex(entry, since, warnings = []) {
    if (!this.codexOverride && !this.service.agents.available().some(a => a.id === "codex" && a.available)) return [];
    const client = this.codexClient({ force:true });
    if (!client) return [];
    const found = new Map(), cursors = new Set();
    let cursor;
    do {
      let page;
      try { page = await client.call("thread/list", { limit:CODEX_LIST, sortKey:"updated_at", ...(cursor ? { cursor } : {}) }); }
      catch (error) { warnings.push(`Codex history listing is incomplete: ${error.message}`); break; }
      for (const thread of Array.isArray(page?.data) ? page.data : []) {
        try {
          if (!thread || typeof thread.id !== "string" || !thread.id || typeof thread.cwd !== "string" || !thread.cwd) continue;
          const known = this.records[this.key("codex", thread.id)];
          if (!entry.roots.some(root => inside(thread.cwd, root)) || (Number(thread.updatedAt) || 0) * 1000 < since || this.service.isSessionRunning("codex", thread.id) || this.ownedElsewhere(entry.project, known) || this.isIgnored("codex", thread.id, known)) continue;
          if (!found.has(thread.id)) found.set(thread.id, { agent:"codex", id:thread.id, at:Number(thread.updatedAt) * 1000, read:rec => this.readCodex(client, entry, thread, rec, since) });
        } catch { continue; }
      }
      // Codex lists the latest first, so once 50 not yet here are found, no older one could be among the 50 a sync brings in.
      if ([...found.keys()].filter(id => !this.records[this.key("codex", id)]?.slug).length >= SYNC_MOST) break;
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) { warnings.push("Codex history listing repeated a page; sync again to retry the remaining conversations."); break; }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...found.values()];
  }
  async recentOpencode({ project, roots }, since, warnings = []) {
    const client = this.opencodeClient(), found = new Map();
    if (!client) return [];
    for (const folder of [project.docsPath, ...project.codePaths].filter(p => p && fs.existsSync(p))) {
      let sessions;
      try { sessions = await client.list(folder); }
      catch (error) { warnings.push(`OpenCode (${folder}): ${error.message}`); continue; }
      for (const session of Array.isArray(sessions) ? sessions : []) {
        try {
          if (!session || typeof session.id !== "string" || !session.id || typeof session.directory !== "string" || !session.directory) continue;
          const updated = Number(session.updated) || 0;
          const known = this.records[this.key("opencode", session.id)];
          if (session.parent || found.has(session.id) || !roots.some(root => inside(session.directory, root)) || updated < since || this.service.isSessionRunning("opencode", session.id) || this.ownedElsewhere(project, known) || this.isIgnored("opencode", session.id, known)) continue;
          found.set(session.id, { agent:"opencode", id:session.id, at:updated, read:rec => this.readOpencode(client, project, session, folder, rec, updated, since) });
        } catch { continue; }
      }
    }
    return [...found.values()];
  }
  // Pictures sent before PenEcho kept them are only counted in the Topic, as "[2 pictures]". The transcript still has them, so each one is looked for once.
  async fillPictures(project) {
    for (const rec of Object.values(this.records)) {
      const source = this.fileAgents.find(s => s.agent === rec.agent);
      if (!source || this.service.store.isDeleted(project, rec.slug) || rec.picturesFilled || rec.projectId !== project.id || !rec.slug || !rec.file) continue;
      rec.picturesFilled = true; this.dirty = true;
      // One conversation that cannot be read has its pictures left as counted; the others are still filled.
      try {
        if (!this.service.hasCountedPictures(project, rec.slug) || !fs.existsSync(rec.file)) continue;
        for await (const line of wholeFile(source, rec.file)) {
          if (!line.includes('"image"')) continue;
          for (const change of source.line(line)?.changes || []) if (change.pictures) this.service.fillCountedPictures(project, rec.slug, change.me, change.pictures);
        }
      } catch { /* Left as counted. */ }
    }
  }
  // Pictures sent in Codex were only named before, as "[Attached: codex-clipboard-….png]". Codex still has them, so each conversation is looked at once.
  async fillCodexPictures(project) {
    if (!this.codexOverride && !this.service.agents.available().some(a => a.id === "codex" && a.available)) return;
    for (const rec of Object.values(this.records)) {
      if (rec.agent !== "codex" || rec.picturesFilled || rec.projectId !== project.id || !rec.slug || this.service.store.isDeleted(project, rec.slug)) continue;
      rec.picturesFilled = true; this.dirty = true;
      try {
        if (!this.service.hasCountedPictures(project, rec.slug)) continue;
        const client = this.codexClient();
        const { thread } = await client.call("thread/read", { threadId:rec.id, includeTurns:true }).catch(() => ({}));
        let found = null;
        for (const item of (thread?.turns || []).flatMap(turn => turn.items || [])) {
          if (item?.type !== "userMessage" || !(item.content || []).some(p => /image/i.test(p?.type || ""))) continue;
          if (!found && missingPicture(item)) found = await rolloutPictures(thread.path).catch(() => new Map());
          for (const change of codexChanges(item, true, found || undefined)) if (change.pictures) this.service.fillCountedPictures(project, rec.slug, change.me, change.pictures, change.files);
        }
      } catch { /* Left as counted. */ }
    }
  }
  async readFile(source, project, roots, rec, stat, since) {
    const file = rec.file;
    return this.shared.run(project, rec, async () => {
      if (rec.file !== file) { rec.file = file; rec.offset = 0; rec.size = 0; }
      await this.readFileOwned(source, project, roots, rec, stat, since);
    });
  }
  async readFileOwned(source, project, roots, rec, stat, since) {
    if (stat.size <= rec.offset) { rec.offset = stat.size; return; }
    const { lines, next } = source.read(rec.file, rec.offset, stat.size, READ_LIMIT);
    if (next === rec.offset) return;
    rec.mtime = stat.mtimeMs; this.dirty = true;
    const changes = [];
    let byteAt = rec.offset;
    for (const line of lines) {
      const atByte = byteAt; byteAt += Buffer.byteLength(line) + 1;
      if (!line.trim()) continue;
      const row = source.line(line);
      if (!row) continue;
      if (row.title) { rec.title = row.title; continue; }
      const away = Boolean(row.cwd && !roots.some(root => inside(row.cwd, root)));
      // Where it happened instead, so a project linked to that folder can still take it.
      if (away) rec.foreign = row.cwd;
      else if (row.cwd) rec.here = project.id;
      if (row.header) { if (row.cwd) rec.cwd = row.cwd; rec.elsewhere = Boolean(row.helper) || away; continue; }
      if (rec.elsewhere || row.scripted || row.at < since || (PI_FAMILY.has(source.agent) && rec.piCheckpoint ? alreadyHandled(rec.piCheckpoint, checkpointOf(line)) : row.at <= (rec.skipUntil || 0))) continue;
      // A newer version of a dsh file repeats what the older one said.
      if (row.seq !== undefined) { if (row.seq <= (rec.seq ?? -1)) continue; rec.seq = row.seq; }
      if (away) continue;
      if (row.cwd) { rec.startedIn ||= row.cwd; rec.cwd = row.cwd; }
      if (row.branch && row.branch !== "HEAD") rec.branch = row.branch;
      if (row.entrypoint) rec.via = LABELS.claude[row.entrypoint] || rec.via || "Claude Code";
      else if (source.via) rec.via ||= source.via;
      rec.lastAt = Math.max(rec.lastAt || 0, row.at);
      if (row.turnOpen !== undefined) rec.turnOpen = row.turnOpen;
      changes.push(...events(rec, `file:${row.seq ?? atByte}`, row.changes, { at:row.at }));
      // Read all at once, each message still needs its own time on the line.
      if (this.syncing && changes.length) await this.deliver(project, rec, changes.splice(0));
    }
    if (changes.length) await this.deliver(project, rec, changes);
    this.named(rec);
    // Only what has safely reached the project counts as read, so nothing is lost if that fails.
    rec.offset = next; rec.size = next === stat.size ? stat.size : 0;
  }
  // A new line from another app is called by its first words until its agent names it: the title the app gave the conversation, once.
  named(rec) {
    if (!rec?.slug || !rec.title || rec.titled === rec.title) return;
    const project = this.service.store.projects.find(p => p.id === rec.projectId);
    if (!project) return;
    rec.titled = rec.title; this.dirty = true;
    this.service.nameLine(project, rec.slug, rec.title, rec.agent);
  }
  // Codex's own names for its threads, newest last in <CODEX_HOME>/session_index.jsonl. Read again only when it changes.
  codexName(id) {
    const file = path.join(this.env.CODEX_HOME || path.join(this.home || os.homedir(), ".codex"), "session_index.jsonl");
    let stat; try { stat = fs.statSync(file); } catch { return ""; }
    if (this.codexNames?.mtime !== stat.mtimeMs) {
      const names = new Map();
      try {
        for (const line of fs.readFileSync(file, "utf8").split("\n")) {
          if (!line.includes('"thread_name"')) continue;
          try { const o = JSON.parse(line); if (o?.id && typeof o.thread_name === "string" && o.thread_name.trim()) names.set(o.id, o.thread_name.trim()); } catch { /* A line still being written. */ }
        }
      } catch { return ""; }
      this.codexNames = { mtime:stat.mtimeMs, names };
    }
    return this.codexNames.names.get(id) || "";
  }
  // A conversation that hands work to a helper writes nothing of its own until the helper is done. While its turn is open, what the helper does is that conversation at work.
  waitsOnHelpers(rec) { return Boolean(rec?.slug && rec.active && rec.turnOpen); }
  helperWorked(agent, parentId, at) {
    // A helper's helper counts for the conversation at the top.
    for (let id = parentId, seen = new Set(); id && !seen.has(id); id = this.records[this.key(agent, id)]?.parent) {
      seen.add(id);
      const rec = this.records[this.key(agent, id)];
      if (!rec?.parent) { if (this.waitsOnHelpers(rec) && at > (rec.lastAt || 0)) { rec.lastAt = at; this.dirty = true; } return; }
    }
  }
  // The name an agent's app shows for a conversation, to pick it there. OpenCode's, Kimi's, WorkBuddy's and Antigravity's apps are picked by title.
  async titleOf(agent, id) {
    if (agent === "kimi") return inDesktop(id) ? kimiTitle(this.kimi.desktop.titles, id) : "";
    if (agent === "workbuddy") return workbuddyTitle(this.workbuddy, id);
    if (agent === "antigravity") return antigravityTitle(this.env, id, this.home);
    if (agent !== "opencode") return "";
    try { return String(await openCodeDatabase(this.opencodeData)?.title(id) || "").trim(); } catch { return ""; }
  }
  // How large a conversation's own transcript is, in bytes, where PenEcho can read it (N7): the file it follows, Claude Code's
  // ~/.claude/projects/<folder>/<id>.jsonl, or a Codex rollout ~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl. A compacted .zst says nothing true of it, so 0.
  transcriptBytes(agent, id) {
    if (!id) return 0;
    const size = file => { try { const stat = fs.statSync(file); return stat.isFile() ? stat.size : 0; } catch { return 0; } };
    const names = dir => { try { return fs.readdirSync(dir); } catch { return []; } };
    const rec = this.records[this.key(agent, id)];
    if (rec?.file && !/\.(?:zst|zstd)$/.test(rec.file) && size(rec.file)) return size(rec.file);
    if (agent === "antigravity") return size(antigravityTranscript(id, this.env, this.home));
    if (agent === "claude") {
      for (const folder of names(this.claudeProjects)) { const bytes = size(path.join(this.claudeProjects, folder, `${id}.jsonl`)); if (bytes) return bytes; }
      return 0;
    }
    if (agent === "codex") return size(this.codexRollout(id));
    return 0;
  }
  // Where a Codex thread's rollout is: ~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl, or "" when it is not there. A compacted one is named
  // as it was before (.jsonl), which rolloutLines reads all the same; its size says nothing true of it.
  codexRollout(id) {
    if (!/^[\w-]+$/.test(String(id || ""))) return "";
    const names = dir => { try { return fs.readdirSync(dir); } catch { return []; } };
    const root = path.join(this.env.CODEX_HOME || path.join(this.home || os.homedir(), ".codex"), "sessions"), newest = list => list.sort().reverse();
    for (const y of newest(names(root))) for (const m of newest(names(path.join(root, y)))) for (const d of newest(names(path.join(root, y, m)))) {
      const found = names(path.join(root, y, m, d)).find(n => n.endsWith(`${id}.jsonl`) || n.endsWith(`${id}.jsonl.zst`));
      if (found) return path.join(root, y, m, d, found.replace(/\.zst$/, ""));
    }
    return "";
  }
  // Whether its own app can still open this conversation. Claude's finds the file by its name, in whichever folder it is. Codex answers for itself: a thread it has archived, or one from `codex exec` that its app does not list, does not count. Anything unclear is a no.
  async stillOpens(agent, id) {
    if (agent === "claude") {
      try { return fs.readdirSync(this.claudeProjects).some(folder => fs.existsSync(path.join(this.claudeProjects, folder, `${id}.jsonl`))); } catch { return false; }
    }
    if (agent === "opencode") {
      try { return Boolean(await openCodeDatabase(this.opencodeData)?.holds(id)); } catch { return false; }
    }
    if (agent === "kimi") return kimiHolds(this.kimi, id);
    if (agent === "workbuddy") return Boolean(workbuddyFile(this.workbuddy, id));
    if (agent === "antigravity") return antigravityHasSession(id, this.env);
    const client = agent === "codex" ? this.codexClient() : null;
    if (!client) return false;
    let timer;
    try {
      const { thread } = await Promise.race([client.call("thread/read", { threadId:id }), new Promise((_, fail) => { timer = setTimeout(fail, 5000, new Error("Codex did not answer.")); })]);
      return ["vscode", "cli"].includes(thread?.source) && !String(thread.path || "").split(path.sep).includes("archived_sessions");
    } catch { return false; } finally { clearTimeout(timer); }
  }
  codexClient({ force = false } = {}) {
    if (this.codexOverride) return this.codexOverride;
    if (this.codexServer?.alive) return this.codexServer;
    if (!force && this.codexBackoffUntil > Date.now()) return null;
    const command = this.service.agents.command("codex", { workdir:this.service.directory, docs:this.service.directory, gitDir:"" });
    if (!command || command.protocol !== "app-server") return null;
    const baseEnv = this.service.agents?.env || process.env;
    const env = command.env ? { ...baseEnv, ...command.env } : baseEnv;
    const server = new CodexServer({ command:command.command, args:command.args, cwd:this.service.directory, env, spawnFn:this.service.spawn });
    this.codexServer = server;
    server.ready.then(
      () => {
        if (this.codexServer === server) { this.codexFailures = 0; this.codexBackoffUntil = 0; }
      },
      () => {
        if (this.closed || this.codexServer !== server) return;
        this.codexFailures = Math.min((this.codexFailures || 0) + 1, 5);
        this.codexBackoffUntil = Date.now() + Math.min(300_000, 15_000 * (2 ** (this.codexFailures - 1)));
      },
    );
    return server;
  }
  async scanCodex(linked) {
    if (!this.codexOverride && !this.service.agents.available().some(a => a.id === "codex" && a.available)) return;
    const client = this.codexClient();
    if (!client) return;
    // Paginate with a per-tick cap and continuation cursor so a busy project with >60 threads never starves another project.
    let cursor = this.codexCursor || "";
    const cursors = new Set(cursor ? [cursor] : []);
    for (let pages = 0; pages < CODEX_SCAN_PAGES; pages++) {
      let page;
      try { page = await this.listCodexQuick(client, cursor); }
      catch (error) { this.codexCursor = ""; throw error; }
      for (const thread of Array.isArray(page?.data) ? page.data : []) {
        this.lookAt = Date.now();
        // One malformed or unreadable thread stays out of this look; the threads after it, in every project, are still read.
        try {
          if (!thread || typeof thread.id !== "string" || !thread.id || typeof thread.cwd !== "string" || !thread.cwd) continue;
          const known = this.records[this.key("codex", thread.id)], here = ({ roots }) => roots.some(root => inside(thread.cwd, root));
          // The project that already has it reads it, wherever else its folder is linked.
          const owner = known?.readBy || known?.projectId;
          const entry = (owner && linked.find(e => e.project.id === owner && here(e))) || linked.find(here);
          if (!entry || this.ownedElsewhere(entry.project, known) || this.isIgnored("codex", thread.id, known)) continue;
          const updated = (Number(thread.updatedAt) || 0) * 1000, since = this.sinceOf(entry.project);
          if (updated < since || known?.updated === thread.updatedAt || this.service.isSessionRunning("codex", thread.id)) continue;
          await this.readCodex(client, entry, thread, known || this.recordOf("codex", thread.id), since);
        } catch { /* Tried again at the next look. */ }
      }
      const next = typeof page?.nextCursor === "string" ? page.nextCursor : "";
      if (!next || cursors.has(next)) { cursor = ""; break; }
      cursors.add(next);
      cursor = next;
    }
    this.codexCursor = cursor;
  }
  // The look every few seconds reads Codex's own list only. Without useStateDbOnly, Codex also re-reads old conversation files to repair its list,
  // about a second of work per page with a long history, so two PenEchos kept Codex busy all the time. Sync still does the full repairing list.
  // A Codex that refuses the setting by name is asked once without it, and from then on; any other refusal is passed on, so a passing
  // error never brings the slow list back for the rest of the session. (Codex 0.166 ignores fields it does not know.)
  async listCodexQuick(client, cursor) {
    const params = { limit:CODEX_LIST, sortKey:"updated_at", ...(cursor ? { cursor } : {}) };
    if (this.codexQuickList === false) return client.call("thread/list", params);
    try { return await client.call("thread/list", { ...params, useStateDbOnly:true }); }
    catch (error) {
      if (!error?.rpc || !/useStateDbOnly|unknown field/i.test(error.message || "")) throw error;
      const page = await client.call("thread/list", params);
      this.codexQuickList = false;
      return page;
    }
  }
  async readCodex(client, entry, thread, rec, since) {
    return this.shared.run(entry.project, rec, async () => {
      await this.readCodexOwned(client, entry, thread, rec, since);
    });
  }
  async readCodexOwned(client, entry, thread, rec, since) {
    const updated = (Number(thread.updatedAt) || 0) * 1000;
    const { thread:full } = await client.call("thread/read", { threadId:thread.id, includeTurns:true });
    rec.startedIn ||= thread.cwd;
    Object.assign(rec, { updated:thread.updatedAt, cwd:thread.cwd, via:LABELS.codex[thread.originator] || (thread.originator === "penecho" ? "PenEcho" : "Codex"), lastAt:this.syncing ? 0 : rec.lastAt || 0 });
    if (thread.gitInfo?.branch) rec.branch = thread.gitInfo.branch;
    this.dirty = true;
    const changes = [];
    const turns = full?.turns || [];
    const recovered = turns.some(turn => !secondsToMs(turn.startedAt)) ? await rolloutTurnTimes(full?.path).catch(() => new Map()) : new Map();
    // Validate before delivering anything: a partial thread must remain retryable.
    if (turns.some(turn => !rec.doneTurns[turn.id] && turn.items?.length && !(secondsToMs(turn.startedAt) ?? recovered.get(turn.id)))) {
      delete rec.updated;
      throw Error("The conversation's original timestamps could not be read. Restore its Codex history file and sync again.");
    }
    let found = null;
    for (const turn of turns) {
      // A turn still running in another app reads as interrupted from here. Only its own end, or a later turn, says it is over, or the rest of it would never be read.
      const started = secondsToMs(turn.startedAt) ?? recovered.get(turn.id), finished = turn.status !== "inProgress" && (turn.status !== "interrupted" || turn !== turns[turns.length - 1]);
      // An earlier version took a running turn for finished. The rest of it is still to read, and what was asked in it has been heard.
      const carriedOn = !finished && rec.doneTurns[turn.id] && Date.now() - updated < LIVE_MS;
      if (carriedOn) delete rec.doneTurns[turn.id];
      if (!started) continue;
      if (rec.doneTurns[turn.id] || started < since || started <= (rec.skipUntil || 0)) { if (finished) rec.doneTurns[turn.id] = 1; continue; }
      rec.turnOpen = !finished;
      const open = rec.openItems ||= {};
      for (const item of turn.items || []) {
        const state = `${item.status || ""}|${item.type}`;
        if (carriedOn && item.type === "userMessage") open[item.id] = state;
        if (open[item.id] === state) continue;
        const again = item.id in open;
        open[item.id] = state;
        if (!found && !again && missingPicture(item)) found = await rolloutPictures(full?.path).catch(() => new Map());
        for (const change of events(rec, `codex:${turn.id}:${item.id}`, codexChanges(item, finished || item.status !== "inProgress", found || undefined), { at:started })) if (!again || change.upsert) changes.push(change);
      }
      if (turn.status === "failed") changes.push({ codexFailure:turn.error?.message || "Codex reported a failed turn.", at:secondsToMs(turn.completedAt) || started });
      if (finished) { rec.doneTurns[turn.id] = 1; rec.openItems = {}; }
      if (this.syncing && changes.length) { rec.lastAt = started; await this.deliver(entry.project, rec, changes.splice(0)); }
    }
    // A conversation whose last turn is over was last heard when that turn ended, not at thread.updatedAt: that is its file's time,
    // and Codex rewrites old files long after (PE-571). A turn still going, or one with no end of its own (an interrupted one may still run elsewhere), is heard until now.
    const last = turns[turns.length - 1], over = last && last.status !== "inProgress";
    const ended = over ? secondsToMs(last.completedAt) ?? (await rolloutTurnEnds(full?.path).catch(() => new Map())).get(last.id) : null;
    rec.lastAt = ended ? Math.min(Math.max(ended, secondsToMs(last.startedAt) ?? recovered.get(last.id) ?? 0), updated || Infinity) : Math.max(rec.lastAt || 0, updated);
    if (changes.length) await this.deliver(entry.project, rec, changes);
    if (last) rec.turnError = last.status === "failed" ? (last.error?.message || "Codex reported a failed turn.") : "";
    rec.title = String(thread.name || full?.name || "").trim() || this.codexName(thread.id) || rec.title;
    this.named(rec);
  }
  openCodeModels(id, attempt) {
    try { return openCodeDatabase(this.opencodeData, undefined, 50)?.models(id, attempt) || []; }
    catch { return []; }
  }
  // OpenCode keeps conversations in a database. Reading it needs no process. Its commands are for when that cannot be done.
  opencodeClient() {
    if (this.opencodeOverride) return this.opencodeOverride;
    const direct = openCodeDatabase(this.opencodeData);
    if (direct) return direct;
    const launch = this.service.agents.launch?.("opencode");
    if (!launch) return null;
    const env = launch.env ? { ...(this.service.agents?.env || process.env), ...launch.env } : undefined;
    const run = (cwd, args) => new Promise((resolve, reject) => {
      let output = "", child;
      try { child = this.service.spawn(launch.command, [...launch.prefixArgs, ...args], { cwd, ...(env ? { env } : {}), stdio:["ignore", "pipe", "ignore"], windowsHide:true }); }
      catch (error) { reject(error); return; }
      const timer = setTimeout(() => { try { child.kill(); } catch { /* It already ended. */ } reject(new Error("OpenCode took too long.")); }, CLI_MS);
      child.stdout?.on("data", chunk => { output += chunk; });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => { clearTimeout(timer); if (code !== 0) { reject(new Error(`OpenCode stopped with code ${code}.`)); return; } try { resolve(JSON.parse(output.slice(Math.max(0, output.search(/[[{]/))))); } catch (error) { reject(error); } });
    });
    return { list:folder => run(folder, ["session", "list", "--format", "json", "-n", OPENCODE_LIST]), read:(id, folder) => run(folder, ["export", id]) };
  }
  // Starting OpenCode to ask takes a moment, so it is only asked when its database has changed, or now and then if that cannot be seen.
  opencodeChanged() {
    if (this.opencodeOverride) return true;
    if (!fs.existsSync(this.opencodeData)) return false;
    const stamp = ["opencode.db", "opencode.db-wal"].map(name => { try { return fs.statSync(path.join(this.opencodeData, name)).mtimeMs; } catch { return 0; } }).join("|");
    if (stamp === "0|0" ? Date.now() - this.opencodeLook.at < OPENCODE_IDLE_MS : stamp === this.opencodeLook.stamp) return false;
    this.opencodeLook = { stamp, at:Date.now() };
    return true;
  }
  async scanOpencode(linked) {
    if (!this.opencodeChanged()) return;
    const client = this.opencodeClient();
    if (!client) return;
    let all = null;
    for (const entry of linked) {
      const { project, roots } = entry, since = this.sinceOf(project), seen = new Set();
      for (const folder of [project.docsPath, ...project.codePaths].filter(p => p && fs.existsSync(p))) {
        const sessions = client.everywhere ? all ||= await client.list().catch(() => []) : await client.list(folder).catch(() => []);
        for (const session of Array.isArray(sessions) ? sessions : []) {
          this.lookAt = Date.now();
          try {
            if (!session || typeof session.id !== "string" || !session.id || typeof session.directory !== "string" || !session.directory) continue;
            if (seen.has(session.id) || !roots.some(root => inside(session.directory, root))) continue;
            seen.add(session.id);
            const known = this.records[this.key("opencode", session.id)], updated = Number(session.updated) || 0;
            if (session.parent) { if (known?.updated !== updated) { this.recordOf("opencode", session.id, { updated, parent:session.parent }); this.helperWorked("opencode", session.parent, updated); } continue; }
            if (this.ownedElsewhere(project, known) || this.isIgnored("opencode", session.id, known) || updated < since || known?.updated === updated || this.service.isSessionRunning("opencode", session.id)) continue;
            await this.readOpencode(client, project, session, folder, known, updated, since);
          } catch { /* Tried again at the next look. */ }
        }
      }
    }
  }
  async readOpencode(client, project, session, folder, known, updated, since) {
    const rec = known || this.recordOf("opencode", session.id);
    return this.shared.run(project, rec, async () => {
      await this.readOpencodeOwned(client, project, session, folder, rec, updated, since);
    });
  }
  async readOpencodeOwned(client, project, session, folder, known, updated, since) {
    const full = await client.read(session.id, folder, { after:known?.settled || 0 });
    // A helper one conversation started is part of that conversation, not one of its own.
    if (full?.info?.parentID) { this.recordOf("opencode", session.id, { updated, parent:full.info.parentID }); this.helperWorked("opencode", full.info.parentID, updated); return; }
    const rec = known || this.recordOf("opencode", session.id), messages = full?.messages || [], changes = [], open = rec.openItems ||= {};
    rec.startedIn ||= session.directory;
    Object.assign(rec, { updated, cwd:session.directory, lastAt:this.syncing ? 0 : Math.max(rec.lastAt || 0, updated) });
    rec.via ||= "OpenCode";
    this.dirty = true;
    for (const message of messages) {
      const info = message.info || {}, id = info.id, at = Number(info.time?.created) || 0, finished = info.role === "user" || Boolean(info.time?.completed);
      if (!id || rec.doneTurns[id]) continue;
      if (at < since || at <= (rec.skipUntil || 0)) { if (finished) rec.doneTurns[id] = 1; continue; }
      if (info.role === "user") { changes.push(...events(rec, `opencode:${id}`, opencodeUserChanges(message.parts || []), { at })); }
      else for (const part of message.parts || []) {
        const state = opencodePartState(part);
        if (open[part.id] === state) continue;
        const list = opencodePartChanges(part, finished);
        if (list.length) open[part.id] = state;
        changes.push(...events(rec, `opencode:${id}:${part.id}`, list, { at }));
      }
      if (finished) { rec.doneTurns[id] = 1; for (const part of message.parts || []) delete open[part.id]; }
      if (this.syncing && changes.length) { rec.lastAt = at; await this.deliver(project, rec, changes.splice(0)); }
    }
    rec.lastAt = Math.max(rec.lastAt || 0, updated);
    const last = messages[messages.length - 1]?.info;
    rec.turnOpen = full?.busy ?? (Boolean(last) && (last.role === "user" || !last.time?.completed));
    if (full?.settled) rec.settled = full.settled;
    if (changes.length) await this.deliver(project, rec, changes);
  }
  // Antigravity keeps Desktop and CLI summaries in SQLite (`workspace_uris`, status, title) and each conversation's steps in `brain/<id>/.system_generated/logs/transcript_full.jsonl`.
  async scanAntigravity(linked) {
    if (!linked.length) return;
    const dbStamp = antigravityDbStamp(this.env, this.home), dbChanged = dbStamp !== this.agDbStamp, now = Date.now();
    for (const entry of listAntigravityConversations(this.env, this.home)) {
      const known = this.records[this.key("antigravity", entry.id)];
      if (entry.parent) {
        if (entry.parent !== "__subagent__" && known?.updated !== entry.updated) {
          this.recordOf("antigravity", entry.id, { updated:entry.updated, parent:entry.parent });
          this.helperWorked("antigravity", entry.parent, entry.updated);
        }
        continue;
      }
      if (!entry.file) continue;
      const owner = known?.readBy || known?.projectId;
      let match = owner ? linked.find(e => e.project.id === owner && entry.folders.some(f => e.roots.some(r => inside(f, r)))) : null;
      if (!match) for (const f of entry.folders) { match = linked.find(e => e.roots.some(r => inside(f, r))); if (match) break; }
      if (!match || this.ownedElsewhere(match.project, known) || this.isIgnored("antigravity", entry.id, known) || this.service.isSessionRunning("antigravity", entry.id)) continue;
      const since = this.sinceOf(match.project);
      if (entry.updated < since && !known?.slug && !entry.busy) continue;
      // Idle historical Antigravity conversations are re-checked once a minute while neither summary DB changed (PE-988);
      // active, busy, recent, or DB-updated conversations are still checked on every tick.
      const idleOld = !this.syncing && !dbChanged && known?.agStamp && !entry.busy && !known.active && !known.turnOpen && !known.pendingTask
        && now - Math.max(entry.updated || 0, known.lastAt || 0) > AG_IDLE_AGE_MS
        && now - (this.agChecked.get(entry.id) || 0) < AG_IDLE_RECHECK_MS;
      if (idleOld) continue;
      // Unchanged since it was last read: skip it before taking its shared lock. Locking 85 idle conversations every 3 s wrote
      // 170 lock files into the docs folders, and each moved the folder's watcher so every page look made the whole state again.
      if (!this.syncing && known?.agStamp && known.agStamp === antigravityStamp(entry)) {
        if (this.agChecked.size >= MOST_SETTLED) this.agChecked.clear();
        this.agChecked.set(entry.id, now);
        continue;
      }
      await this.readAntigravity(match.project, match.roots, entry, known, since).catch(() => {});
      if (this.agChecked.size >= MOST_SETTLED) this.agChecked.clear();
      this.agChecked.set(entry.id, now);
    }
    this.agDbStamp = dbStamp;
  }
  recentAntigravity({ project, roots }, since) {
    const found = [];
    for (const entry of listAntigravityConversations(this.env, this.home)) {
      if (entry.parent || !entry.file || !entry.folders.some(f => roots.some(r => inside(f, r)))) continue;
      if (entry.updated < since || this.service.isSessionRunning("antigravity", entry.id)) continue;
      const known = this.records[this.key("antigravity", entry.id)];
      if (this.ownedElsewhere(project, known) || this.isIgnored("antigravity", entry.id, known)) continue;
      found.push({ agent:"antigravity", id:entry.id, at:entry.updated, read:(rec, from) => this.readAntigravity(project, roots, entry, rec, from) });
    }
    return found;
  }
  async readAntigravity(project, roots, entry, known, since) {
    const rec = known || this.recordOf("antigravity", entry.id, { offset:0, size:0 });
    return this.shared.run(project, rec, () => this.readAntigravityOwned(project, roots, entry, rec, since));
  }
  async readAntigravityOwned(project, roots, entry, known, since) {
    const stat = fs.statSync(entry.file, { throwIfNoEntry:false });
    if (!stat) return;
    const stamp = antigravityStamp(entry, stat);
    if (!this.syncing && known && known.agStamp === stamp) return;
    const rec = known || this.recordOf("antigravity", entry.id, { offset:0, size:0 });
    const matchedCwd = entry.folders.find(f => roots.some(r => inside(f, r))) || entry.folders[0] || "";
    if (rec.file && rec.file !== entry.file) rec.offset = 0;
    if (stat.size < (rec.offset || 0)) rec.offset = 0;
    if (matchedCwd) { rec.startedIn ||= matchedCwd; rec.cwd = matchedCwd; }
    rec.file = entry.file;
    rec.via ||= entry.store.via;
    rec.updated = entry.updated;
    rec.turnOpen = Boolean(entry.busy);
    this.dirty = true;
    const changes = [];
    for (let before = -1; (rec.offset || 0) < stat.size && rec.offset !== before;) {
      const start = rec.offset || 0;
      before = start;
      const bytes = Math.min(stat.size - start, READ_LIMIT);
      const buf = Buffer.allocUnsafe(bytes), fd = fs.openSync(entry.file, "r");
      let got = 0;
      try { got = fs.readSync(fd, buf, 0, bytes, start); } finally { fs.closeSync(fd); }
      const raw = buf.subarray(0, got), cut = raw.lastIndexOf(10);
      let slice = null, next = start;
      if (cut >= 0) { slice = raw.subarray(0, cut + 1); next = start + cut + 1; }
      else if (!entry.busy && start + got === stat.size) {
        try { JSON.parse(raw.toString("utf8")); slice = raw; next = stat.size; } catch { /* Wait for complete JSON line. */ }
      }
      if (!slice) break;
      let lineAt = 0;
      while (lineAt < slice.length) {
        const nl = slice.indexOf(10, lineAt), end = nl >= 0 ? nl : slice.length;
        const line = slice.subarray(lineAt, end).toString("utf8");
        const stepOffset = start + lineAt;
        lineAt = end + 1;
        const parsed = parseAntigravityStep(line, { readPicture:pictureFile, key:String(stepOffset) });
        const at = parsed.at || entry.updated || stat.mtimeMs;
        if (parsed.scripted || at < since || at <= (rec.skipUntil || 0)) continue;
        changes.push(...events(rec, `antigravity:${stepOffset}`, parsed.changes));
        if (this.syncing && changes.length) { rec.lastAt = 0; await this.deliver(project, rec, changes.splice(0)); }
      }
      rec.offset = next;
    }
    const hasHuman = changes.some(c => c.me);
    const newest = changes.reduce((m, c) => Math.max(m, c.at || 0), 0);
    // Antigravity marks conversation_summaries CASCADE_RUN_STATUS_IDLE as soon as the model pauses for a
    // background task wakeup (PE-758, PE-792). Inspect the current turn in transcript_full.jsonl so a
    // pending non-daemon task or unanswered wakeup never settles the Work early as Done.
    const turnState = antigravityTranscriptState(entry.file);
    rec.pendingTask = Boolean(turnState.pending || turnState.unansweredWakeup);
    rec.turnError = turnState.error || "";
    rec.turnDoneAnswer = turnState.done?.answer || "";
    rec.turnOpen = Boolean(entry.busy || rec.pendingTask);
    // If an oversized (>READ_LIMIT) transcript row pinned the incremental reader before the final answer,
    // deliver the verified final answer from the backward turn reader so we never settle with stale "Waiting..." text.
    if ((rec.offset || 0) < stat.size && rec.turnDoneAnswer && rec.turnDoneAnswer !== rec.lastSay && !changes.some(c => c.said === rec.turnDoneAnswer)) {
      const doneAt = turnState.done.at || entry.updated || stat.mtimeMs;
      if (doneAt >= since && doneAt > (rec.skipUntil || 0)) {
        changes.push(...events(rec, `antigravity:done:${stat.size}:${doneAt}`, [{ at:doneAt, said:rec.turnDoneAnswer, add:{ kind:"say", text:rec.turnDoneAnswer } }]));
      }
    }
    if (this.syncing) rec.lastAt = 0;
    else if (entry.busy || changes.length) rec.lastAt = Math.max(rec.lastAt || 0, newest, entry.updated || 0, entry.busy ? Date.now() : 0);
    rec.explicitIdle = Boolean(entry.status === "CASCADE_RUN_STATUS_IDLE" && !hasHuman && !rec.pendingTask);
    if (changes.length) await this.deliver(project, rec, changes);
    if (entry.title) rec.title = entry.title;
    this.named(rec);
    rec.size = (rec.offset || 0) === stat.size ? stat.size : 0;
    rec.agStamp = stamp;
  }
  async deliver(project, rec, changes) {
    await this.realBranch(rec, changes[changes.length - 1]?.at);
    const owner = this.ownerOf(project, rec);
    await this.shared.writing(owner, () => this.service.conversationChanges(owner, rec, changes));
    this.dirty = true;
  }
  // A conversation pasted from another project's line is read in the folder where it happens and goes to that line's project. If that project has gone, it is this folder's again.
  ownerOf(reader, rec) {
    if (!rec.readBy || rec.readBy !== reader.id || rec.projectId === reader.id) return reader;
    const owner = this.service.store.projects.find(p => p.id === rec.projectId);
    if (owner) return owner;
    Object.assign(rec, { projectId:reader.id, slug:"", stepId:"", appStep:"" });
    delete rec.readBy;
    return reader;
  }
  // A transcript can go on naming the branch a conversation started on after it moves to another checkout, so the folder itself is asked.
  // Something said days ago, in the folder it started in, keeps what the transcript says: that folder may be on another branch by now.
  async realBranch(rec, at = 0) {
    if (!rec.cwd || (Date.now() - at > LIVE_MS && rec.cwd === rec.startedIn)) return;
    let seen = this.branchSeen.get(rec.cwd);
    if (!seen || Date.now() - seen.at > BRANCH_MS) { seen = { at:Date.now(), branch:await Git.currentBranch(rec.cwd) }; this.branchSeen.set(rec.cwd, seen); }
    if (seen.branch) rec.branch = seen.branch;
  }
  // A conversation goes quiet when its agent has finished its turn, or long after it last did anything.
  // A pending non-daemon background task gets a dedicated 30-minute window (matching RunWatch.STUCK_MS) so legitimate 10-15 min waits stay Working.
  isActive(rec) {
    if (openQuestion(rec)) return true;
    if (rec.agent === "antigravity" && rec.explicitIdle) return false;
    const last = Math.max(rec.lastAt || 0, rec.mtime || 0);
    const limit = rec.pendingTask ? Math.max(PENDING_TASK_MS, this.idleMs)
      : rec.turnOpen ? Math.max(TURN_OPEN_MS, this.idleMs)
      : this.idleMs;
    return Date.now() - last < limit;
  }
  async settle(project, { fromTick = false } = {}) {
    for (const rec of Object.values(this.records)) {
      // One conversation that cannot be settled now stays as it is; the others, and the stale ones after them, are still settled.
      try {
        if (rec.projectId !== project.id || !rec.slug || this.service.store.isDeleted(project, rec.slug)) continue;
        const active = this.isActive(rec);
        if (rec.active && !active) await this.shared.run(project, rec, async () => {
          if (this.isActive(rec)) return;
          // Another PenEcho on this folder ended it first: its result is written, and this PenEcho only lets go of it.
          if (!rec.active) { await this.service.conversationEndedElsewhere?.(project, rec); return; }
          await this.shared.writing(project, async () => { if (await this.service.conversationQuiet(project, rec) !== false && !this.service.ownerLost?.()) rec.active = false; });
          this.dirty = true;
        });
        else if (rec.active) this.service.conversationStillGoing(project, rec);
        else if (!active) await this.service.conversationEndedElsewhere?.(project, rec);
      } catch { /* Settled at the next look. */ }
    }
    await this.settleStale(project, { fromTick });
  }
  // A line can go on saying its Work is running after the conversation behind it has finished: its file was put back from an older copy,
  // or was away when the conversation ended, so the end could not be written. Each look finishes such a Work as that end would have.
  // Only for a conversation this PenEcho follows, once it is quiet, nothing here runs on the line, and the file has not changed for a minute.
  async settleStale(project, { fromTick = false } = {}) {
    const now = Date.now(), watch = this.service.store.watch;
    for (const rec of Object.values(this.records)) {
      let key;
      try {
        if (rec.active || rec.projectId !== project.id || !rec.slug || !rec.stepId || this.isActive(rec) || this.service.store.isDeleted(project, rec.slug)) continue;
        key = this.service.key(project, rec.slug);
      } catch { continue; }
      if (this.service.runs.has(key) || this.service.heldWorks(project, rec.slug).length || this.service.live.get(key)?.size) continue;
      const lineRel = L.linePath(rec.slug), sKey = `${project.id}\0${rec.agent}:${rec.id}`, settled = this.staleSettled.get(sKey);
      const sameSettled = settled && settled.slug === rec.slug && settled.stepId === rec.stepId;
      // Already confirmed finished and quiet for >10 min: while the watcher says its Line file is untouched, re-check once a minute (PE-988).
      if (fromTick && sameSettled && now - Math.max(settled.mtime, rec.lastAt || 0, rec.runEndedAt || 0) > STALE_IDLE_AGE_MS
          && now - settled.at < STALE_RECHECK_MS && watch?.still(project.docsPath, [lineRel, `${L.ARCHIVE}/${lineRel}`], settled.mark)) continue;
      const mark = watch?.mark(project.docsPath) ?? null;
      let file; try { file = this.service.store.readText(project, lineRel, { trust:true }); } catch { continue; }
      if (rec.staleSeen === file.hash || (sameSettled && settled.hash === file.hash)) {
        if (sameSettled && settled.hash === file.hash && mark !== null) { settled.at = now; settled.mark = mark; settled.mtime = file.mtime; }
        continue;
      }
      if (now - Math.max(file.mtime, rec.runEndedAt || 0) < STALE_MS) continue;
      let doc, step;
      try { doc = file.doc || (file.doc = F.parseLine(file.text)); step = doc.steps.find(s => s.id === rec.stepId); } catch { continue; }
      // Also a Work stopped as cut off that went on and finished since: its end was never written either.
      if (!step || step.done || (doc.status !== "working" && !this.service.cutOffStep?.(project, rec))) {
        const mayContinueLater = step && !step.done && doc.status === "stopped" && doc.front.why === INTERRUPTED_WHY;
        if (!mayContinueLater) {
          if (this.staleSettled.size >= MOST_SETTLED) this.staleSettled.clear();
          this.staleSettled.set(sKey, { hash:file.hash, slug:rec.slug, stepId:rec.stepId, mtime:file.mtime, at:now, mark });
        }
        continue;
      }
      try {
        await this.shared.run(project, rec, async () => {
          let fresh; try { fresh = this.service.store.readText(project, lineRel); } catch { return; }
          if (rec.staleSeen === fresh.hash || Date.now() - Math.max(fresh.mtime, rec.runEndedAt || 0) < STALE_MS) return;
          await this.shared.writing(project, () => this.service.conversationQuiet(project, rec));
          rec.staleSeen = fresh.hash; this.dirty = true;
        });
      } catch { continue; }
    }
  }
  close() { this.closed = true; this.codexServer?.close(); this.flush(); this.shared.close(); }
}

module.exports = { Conversations, openQuestion, antigravityStamp, PENDING_TASK_MS, claudeLine, codexChanges, codexWords, humanWords, encodeFolder, ompFolders, PI_FAMILY, LABELS };
